/**
 * End-to-end integration, settlement and recovery tests for the WP-08 T1 slice
 * (AC-062, AC-081, AC-094; `docs/architecture/reliability.md` §4/§5).
 *
 * Everything runs against real temporary Git repositories (the real `git` binary
 * through `NodeWorktreeGitPort`) and a **real SQLite file** for the CAS operation
 * journal. No stub stands in for the state the acceptance criteria are about:
 *
 * - `worktree` ownership is a real `git worktree` plus a real lease row;
 * - compare-and-swap is a real `git update-ref <ref> <new> <expected>`;
 * - the crash between commit and status update is injected at the journal write,
 *   the documented fault point of `reliability.md` §5 and AC-063/AC-094.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { requirementRecordHash } from '@agentdev/knowledge';
import type { GitResult } from '@agentdev/workspace';
import {
  createCasService,
  createMemoryCasEvents,
  createMemoryWorktreeLeaseStore,
  createNodeWorktreeGitPort,
  createRepairTask,
  createWorktreeManager,
  orderTasks,
  planDependencies,
  repairTaskId,
  requirementPoolPaths,
  runIntegration,
  verifyTaskStart,
  type CasEventPort,
  type CasJournal,
  type CasJournalRecord,
  type CasOutcome,
  type CreateWorktreeOutcome,
  type DependencyResolution,
  type RequirementPoolCommit,
  type TaskDependencyPort,
  type TaskNode,
  type WorktreeGitPort,
} from '@agentdev/workspace';

const created: string[] = [];

function makeTempDir(prefix = 'agentdev-cas-'): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  created.push(dir);
  return dir;
}

function writeFileAt(root: string, relativePath: string, content: string): void {
  const absolute = join(root, relativePath);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, 'utf8');
}

afterEach(() => {
  while (created.length > 0) {
    const dir = created.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

const git: WorktreeGitPort = createNodeWorktreeGitPort();
const DELIVERY_REF = 'refs/heads/agentdev/main';

/** Unwraps a `GitResult`, failing the test loudly when Git refused. */
function requireValue<T>(result: GitResult<T>, what: string): T {
  if (!result.ok) {
    throw new Error(`${what} failed: ${result.errors[0]?.message ?? 'unknown'}`);
  }
  return result.value;
}

/** A repository with the delivery branch and one seed commit. */
function seedDeliveryRepo(files: Readonly<Record<string, string>>): {
  readonly repo: string;
  readonly revision: string;
} {
  const repo = makeTempDir();
  for (const [relativePath, content] of Object.entries(files)) {
    writeFileAt(repo, relativePath, content);
  }
  requireValue(git.initRepository(repo, { branch: 'agentdev/main' }), 'git init');
  const head = requireValue<{ revision: string }>(
    git.commitPaths(repo, 'chore: seed delivery branch', Object.keys(files)),
    'seed commit',
  );
  return { repo, revision: head.revision };
}

/** A per-Task worktree rooted at `baseRevision` with its own commits. */
function taskWorktree(input: {
  readonly repo: string;
  readonly name: string;
  readonly baseRevision: string;
  readonly ownerAttemptId?: string;
}): { readonly path: string; readonly manager: ReturnType<typeof createWorktreeManager> } {
  const manager = createWorktreeManager({
    git,
    leases: createMemoryWorktreeLeaseStore(),
    now: () => '2026-09-11T00:00:00.000Z',
  });
  const path = join(makeTempDir('agentdev-wt-'), input.name);
  const outcome: CreateWorktreeOutcome = manager.create({
    taskId: input.name,
    worktreeId: `wt-${input.name}`,
    repoRoot: input.repo,
    path,
    baseRevision: input.baseRevision,
    branch: `agentdev/${input.name}`,
    ownerAttemptId: input.ownerAttemptId ?? `attempt-${input.name}`,
    epoch: 1,
  });
  if (!outcome.ok) throw new Error(`worktree create failed: ${outcome.message}`);
  return { path: outcome.record.path, manager };
}

function commitIn(worktree: string, message: string, paths: readonly string[]): string {
  return requireValue<{ revision: string }>(git.commitPaths(worktree, message, paths), message)
    .revision;
}

function refHead(repo: string, ref: string): string | null {
  return requireValue<string | null>(git.resolveRevision(repo, ref), `resolve ${ref}`);
}

/** Number of commits on the delivery branch, counted through `rev-parse`. */
function branchCommitCount(repo: string): number {
  let revision = refHead(repo, DELIVERY_REF);
  const seen = new Set<string>();
  while (revision !== null && !seen.has(revision)) {
    seen.add(revision);
    const parent = git.resolveRevision(repo, `${revision}^`);
    revision = parent.ok ? parent.value : null;
  }
  return seen.size;
}

/** A real SQLite-backed `CasJournal`, the production shape of `operation`. */
function sqliteJournal(file: string): CasJournal {
  const db = new DatabaseSync(file);
  db.exec(
    'CREATE TABLE IF NOT EXISTS cas_operation (operation_id TEXT PRIMARY KEY, kind TEXT NOT NULL, repo_root TEXT NOT NULL, ref TEXT NOT NULL, expected_revision TEXT NOT NULL, state TEXT NOT NULL, target_revision TEXT, target_tree TEXT, reused INTEGER, completion_event_id TEXT, step_results TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)',
  );
  const toRow = (record: CasJournalRecord): readonly (string | number | null)[] => [
    record.operationId,
    record.kind,
    record.repoRoot,
    record.ref,
    record.expectedRevision,
    record.state,
    record.targetRevision ?? null,
    record.targetTree ?? null,
    record.reused === undefined ? null : record.reused ? 1 : 0,
    record.completionEventId ?? null,
    JSON.stringify(record.stepResults),
    record.createdAt,
    record.updatedAt,
  ];
  return {
    load(operationId) {
      const row = db
        .prepare('SELECT * FROM cas_operation WHERE operation_id = ?')
        .get(operationId) as Record<string, unknown> | undefined;
      if (row === undefined) return null;
      return {
        operationId: String(row['operation_id']),
        kind: String(row['kind']) as CasJournalRecord['kind'],
        repoRoot: String(row['repo_root']),
        ref: String(row['ref']),
        expectedRevision: String(row['expected_revision']),
        state: String(row['state']) as CasJournalRecord['state'],
        ...(typeof row['target_revision'] !== 'string'
          ? {}
          : { targetRevision: row['target_revision'] }),
        ...(typeof row['target_tree'] !== 'string' ? {} : { targetTree: row['target_tree'] }),
        ...(typeof row['reused'] !== 'number' ? {} : { reused: row['reused'] === 1 }),
        ...(typeof row['completion_event_id'] !== 'string'
          ? {}
          : { completionEventId: row['completion_event_id'] }),
        stepResults: JSON.parse(String(row['step_results'])) as CasJournalRecord['stepResults'],
        createdAt: String(row['created_at']),
        updatedAt: String(row['updated_at']),
      };
    },
    save(record) {
      db.prepare(
        'INSERT OR REPLACE INTO cas_operation VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(...toRow(record));
    },
    list() {
      const rows = db.prepare('SELECT operation_id FROM cas_operation').all() as readonly Record<
        string,
        unknown
      >[];
      return rows
        .map((row) => this.load(String(row['operation_id'])))
        .filter((record): record is CasJournalRecord => record !== null);
    },
  };
}

function casFor(input: {
  readonly file: string;
  readonly events?: CasEventPort & { readonly appended: readonly unknown[] };
  readonly journal?: CasJournal;
}): {
  readonly cas: ReturnType<typeof createCasService>;
  readonly events: CasEventPort & { readonly appended: readonly unknown[] };
  readonly journal: CasJournal;
} {
  const journal = input.journal ?? sqliteJournal(input.file);
  const events = input.events ?? createMemoryCasEvents();
  return { cas: createCasService({ git, journal, events }), events, journal };
}

function expectIntegrated(outcome: CasOutcome): Extract<CasOutcome, { ok: true }> {
  if (!outcome.ok) throw new Error(`expected CAS success, got ${outcome.code}: ${outcome.message}`);
  return outcome;
}

function expectRefused(outcome: CasOutcome): Extract<CasOutcome, { ok: false }> {
  if (outcome.ok) throw new Error('expected the CAS to refuse');
  return outcome;
}

/**
 * A `WorktreeGitPort` that moves `ref` to `competitor` immediately before its own
 * `update-ref` — the real "another writer moved the branch between the compare and
 * the swap" race (`W8R1-01`).
 */
function portWithCompetingMove(input: {
  readonly repo: string;
  readonly ref: string;
  readonly expectedOld: string;
  readonly competitor: string;
}): WorktreeGitPort {
  const racing = Object.create(git) as WorktreeGitPort;
  let moved = false;
  racing.updateRef = (request) => {
    if (!moved && request.ref === input.ref) {
      moved = true;
      const outcome = git.updateRef({
        repoRoot: input.repo,
        ref: input.ref,
        newRevision: input.competitor,
        expectedOldRevision: input.expectedOld,
      });
      if (!outcome.ok) throw new Error('the competing ref move failed');
    }
    return git.updateRef(request);
  };
  return racing;
}

/**
 * Creates a commit through a real integration worktree at `baseRevision`.
 *
 * A commit must never be created on the checked-out delivery branch: Git refuses to
 * `update-ref` a branch a worktree has checked out, and a commit made there would have
 * already moved the branch. The worktree owns the write; the CAS owns the ref.
 */
function commitThroughWorktree(input: {
  readonly repo: string;
  readonly name: string;
  readonly baseRevision: string;
  readonly message: string;
  readonly files: Readonly<Record<string, string>>;
}): string {
  const worktree = taskWorktree({
    repo: input.repo,
    name: input.name,
    baseRevision: input.baseRevision,
  });
  for (const [relativePath, content] of Object.entries(input.files)) {
    writeFileAt(worktree.path, relativePath, content);
  }
  return commitIn(worktree.path, input.message, Object.keys(input.files));
}

const REQUIREMENT_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e5f';

/** The file contents of one requirement record, as the commit must contain them. */
function requirementFiles(
  id: string,
  input: { readonly version: number; readonly title: string; readonly body: string },
): { readonly recordPath: string; readonly files: Readonly<Record<string, string>> } {
  const recordPath = `.agentdev/requirements/${id}`;
  const contentMarkdown = `# ${input.title}\n\n${input.body}\n`;
  const metadata = {
    schemaVersion: 1 as const,
    id,
    version: input.version,
    contentFile: 'content.md' as const,
    contentHash: '0'.repeat(64),
    createdAt: '2026-09-11T00:00:00.000Z',
    updatedAt: '2026-09-11T00:00:00.000Z',
    title: input.title,
    goal: input.body,
    scope: { readPaths: [], writePaths: [], operations: ['edit'], networkTargets: [] },
    lifecycle: 'active' as const,
    featureIds: [],
    acceptance: [{ id: 'AC-094', given: 'g', when: 'w', then: 't' }],
    openQuestions: [],
    confirmedDecisions: [],
    relatedRequirementIds: [],
  };
  return {
    recordPath,
    files: {
      [`${recordPath}/content.md`]: contentMarkdown,
      [`${recordPath}/requirement.json`]: `${JSON.stringify(metadata, null, 2)}\n`,
      '.agentdev/requirements/README.md': `# Requirements\n\n- ${id}\n`,
    },
  };
}

/** Writes a requirement record into a worktree and returns the CAS pool entry. */
function commitRequirement(input: {
  readonly repo: string;
  readonly name: string;
  readonly baseRevision: string;
  readonly message: string;
  readonly id: string;
  readonly version: number;
  readonly title: string;
  readonly body: string;
}): { readonly candidate: string; readonly pool: RequirementPoolCommit } {
  const record = requirementFiles(input.id, {
    version: input.version,
    title: input.title,
    body: input.body,
  });
  const candidate = commitThroughWorktree({
    repo: input.repo,
    name: input.name,
    baseRevision: input.baseRevision,
    message: input.message,
    files: record.files,
  });
  return {
    candidate,
    pool: {
      recordPath: record.recordPath,
      metadataPath: `${record.recordPath}/requirement.json`,
      contentPath: `${record.recordPath}/content.md`,
      readmePath: '.agentdev/requirements/README.md',
      recordHash: requirementRecordHash('a', body_fingerprint(input.body)),
      version: input.version,
    },
  };
}

/** A stable per-body marker so two writers produce different record hashes. */
function body_fingerprint(body: string): string {
  return requirementRecordHash(body, body);
}

describe('CAS integration against a real Git repository (AC-094)', () => {
  it('creates the commit with the requirement pool files and moves the branch once', () => {
    const { repo, revision } = seedDeliveryRepo({ 'src/orders.ts': 'export const orders = [];\n' });
    const { cas, events } = casFor({ file: join(makeTempDir(), 'journal.sqlite') });
    // The commit is created in a real integration worktree; the branch itself is only
    // ever moved by `git update-ref <ref> <new> <expected>`.
    const { pool, candidate } = commitRequirement({
      repo,
      name: 'save-1',
      baseRevision: revision,
      message: 'doc(requirement): 保存需求 未付款订单可取消',
      id: REQUIREMENT_ID,
      version: 1,
      title: '未付款订单可取消',
      body: 'Unpaid orders can be cancelled.',
    });

    const result = expectIntegrated(
      cas.integrate({
        operationId: 'op-save-1',
        kind: 'requirement_save',
        repoRoot: repo,
        ref: DELIVERY_REF,
        expectedRevision: revision,
        candidateRevision: candidate,
        message: 'doc(requirement): 保存需求 未付款订单可取消',
        requirementPool: [pool],
        requirementId: REQUIREMENT_ID,
      }),
    );

    expect(result.previousRevision).toBe(revision);
    expect(result.refUpdated).toBe(true);
    // The commit was created in the worktree, so the CAS reused it instead of
    // creating a second one.
    expect(result.reused).toBe(true);
    expect(result.targetRevision).toBe(candidate);
    expect(result.requirementRecordHashes).toEqual([pool.recordHash]);
    expect(refHead(repo, DELIVERY_REF)).toBe(result.targetRevision);
    expect(refHead(repo, DELIVERY_REF)).not.toBe(revision);

    // The commit really contains both files of the record, atomically (AC-093/094).
    const committed = requireValue<readonly string[]>(
      git.listTree(repo, result.targetRevision, ['.agentdev']),
      'ls-tree',
    );
    expect(committed).toEqual(
      expect.arrayContaining([pool.metadataPath, pool.contentPath, pool.readmePath]),
    );
    // One completion event, exactly (reliability.md §5).
    expect(events.appended).toHaveLength(1);
    expect(result.completionEventId).toBe(`cas-completed:op-save-1`);
  });

  it('refuses a stale writer with VERSION_CONFLICT and leaves the branch untouched', () => {
    const { repo, revision } = seedDeliveryRepo({ 'src/orders.ts': 'export const orders = [];\n' });
    const { cas, events } = casFor({ file: join(makeTempDir(), 'journal.sqlite') });
    const { pool: first, candidate } = commitRequirement({
      repo,
      name: 'save-winner',
      baseRevision: revision,
      message: 'doc(requirement): winner',
      id: REQUIREMENT_ID,
      version: 2,
      title: '未付款订单可取消',
      body: 'Second writer content.',
    });
    const committed = expectIntegrated(
      cas.integrate({
        operationId: 'op-save-winner',
        kind: 'requirement_save',
        repoRoot: repo,
        ref: DELIVERY_REF,
        expectedRevision: revision,
        candidateRevision: candidate,
        message: 'doc(requirement): winner',
        requirementPool: [first],
      }),
    );
    const headAfterWinner = refHead(repo, DELIVERY_REF);

    // A second writer still believes the old baseline is current. It has its own
    // candidate commit (created at the same base revision) — a write request without
    // one is now refused before the compare, so the stale-writer protection is only
    // reachable with a real candidate (`W8R1-01`).
    const stale: RequirementPoolCommit = {
      ...first,
      recordHash: requirementRecordHash('stale-writer', 'stale-writer'),
    };
    const staleCandidate = commitThroughWorktree({
      repo,
      name: 'save-stale',
      baseRevision: revision,
      message: 'doc(requirement): stale',
      files: requirementFiles(REQUIREMENT_ID, {
        version: 2,
        title: '未付款订单可取消',
        body: 'Stale writer content.',
      }).files,
    });
    const refused = expectRefused(
      cas.integrate({
        operationId: 'op-save-stale',
        kind: 'requirement_save',
        repoRoot: repo,
        ref: DELIVERY_REF,
        expectedRevision: revision,
        candidateRevision: staleCandidate,
        message: 'doc(requirement): stale',
        requirementPool: [stale],
      }),
    );
    expect(refused.code).toBe('VERSION_CONFLICT');
    expect(refused.branchUntouched).toBe(true);
    expect(refused.actualRevision).toBe(committed.targetRevision);
    // The branch did not move and no second completion event appeared.
    expect(refHead(repo, DELIVERY_REF)).toBe(headAfterWinner);
    expect(events.appended).toHaveLength(1);
    // The winner's content is still what the branch holds; the stale writer's
    // record was never committed.
    expect(
      requireValue<boolean>(
        git.pathAtRevision(repo, committed.targetRevision, first.contentPath),
        'cat-file',
      ),
    ).toBe(true);
  });

  it('re-uses the commit after a crash between the commit and the status write', () => {
    const { repo, revision } = seedDeliveryRepo({ 'src/orders.ts': 'export const orders = [];\n' });
    const journalFile = join(makeTempDir(), 'journal.sqlite');
    const events = createMemoryCasEvents();
    const inner = sqliteJournal(journalFile);

    // Fault injection at the documented crash point: the commit exists and is
    // journaled, the ref update/status write has not happened yet.
    let crashed = false;
    const crashing: CasJournal = {
      load: (operationId) => inner.load(operationId),
      list: () => inner.list(),
      save: (record) => {
        if (!crashed && record.state === 'committed') {
          crashed = true;
          throw new Error('injected crash between commit and status update');
        }
        inner.save(record);
      },
    };
    const { pool, candidate } = commitRequirement({
      repo,
      name: 'crash',
      baseRevision: revision,
      message: 'doc(requirement): crash',
      id: REQUIREMENT_ID,
      version: 1,
      title: '未付款订单可取消',
      body: 'Crash recovery body.',
    });
    // The worktree commit moved its own branch, never the delivery branch.
    expect(refHead(repo, DELIVERY_REF)).toBe(revision);
    expect(candidate).not.toBe(revision);
    const request = {
      operationId: 'op-crash',
      kind: 'requirement_save' as const,
      repoRoot: repo,
      ref: DELIVERY_REF,
      expectedRevision: revision,
      candidateRevision: candidate,
      message: 'doc(requirement): crash',
      requirementPool: [pool],
    };
    const firstCas = createCasService({ git, journal: crashing, events });
    expect(() => firstCas.integrate(request)).toThrow(/injected crash/u);
    expect(crashed).toBe(true);
    // The documented crash point: the commit exists, the ref already points at it, and
    // the operation status/completion event were never written (AC-063).
    const interim = inner.load('op-crash');
    expect(interim?.state).toBe('pending');
    expect(interim?.targetRevision).toBe(candidate);
    expect(refHead(repo, DELIVERY_REF)).toBe(candidate);
    expect(events.appended).toHaveLength(0);

    const retryCas = createCasService({ git, journal: inner, events });
    const retried = expectIntegrated(retryCas.integrate(request));
    expect(retried.targetRevision).toBe(interim?.targetRevision);
    expect(refHead(repo, DELIVERY_REF)).toBe(interim?.targetRevision);
    expect(events.appended).toHaveLength(1);

    // Retrying the *successful* operation again is idempotent: same commit, one event.
    const again = expectIntegrated(retryCas.integrate(request));
    expect(again.reused).toBe(true);
    expect(again.emittedCompletionEvent).toBe(false);
    expect(again.targetRevision).toBe(retried.targetRevision);
    expect(events.appended).toHaveLength(1);
    // Exactly one commit exists between the seed and the branch head.
    expect(branchCommitCount(repo)).toBe(2);
  });

  it('refuses a half requirement pair and commits nothing', () => {
    const { repo, revision } = seedDeliveryRepo({ 'src/orders.ts': 'export const orders = [];\n' });
    const { cas, events } = casFor({ file: join(makeTempDir(), 'journal.sqlite') });
    const { pool } = commitRequirement({
      repo,
      name: 'half',
      baseRevision: revision,
      message: 'doc(requirement): half',
      id: REQUIREMENT_ID,
      version: 1,
      title: 'x',
      body: 'half pair',
    });
    expect(() =>
      requirementPoolPaths([{ ...pool, contentPath: `${pool.recordPath}/other.md` }]),
    ).toThrow(/requirement\.json 与 content\.md/u);

    const refused = expectRefused(
      cas.integrate({
        operationId: 'op-half',
        kind: 'requirement_save',
        repoRoot: repo,
        ref: DELIVERY_REF,
        expectedRevision: revision,
        // A valid candidate, so the refusal is the half pair and nothing else.
        candidateRevision: revision,
        message: 'doc(requirement): half',
        requirementPool: [{ ...pool, contentPath: `${pool.recordPath}/other.md` }],
      }),
    );
    expect(refused.code).toBe('VALIDATION_ERROR');
    expect(refHead(repo, DELIVERY_REF)).toBe(revision);
    expect(events.appended).toHaveLength(0);
  });

  it('refuses a dirty integration worktree before touching the branch', () => {
    const { repo, revision } = seedDeliveryRepo({ 'src/orders.ts': 'export const orders = [];\n' });
    const { cas } = casFor({ file: join(makeTempDir(), 'journal.sqlite') });
    const worktree = taskWorktree({ repo, name: 'task-dirty', baseRevision: revision });
    writeFileAt(worktree.path, 'src/orders.ts', 'export const orders = [1];\n');

    const refused = expectRefused(
      cas.integrate({
        operationId: 'op-dirty',
        kind: 'integrate',
        repoRoot: repo,
        ref: DELIVERY_REF,
        expectedRevision: revision,
        candidateRevision: revision,
        message: 'feat: dirty integration',
        worktreePaths: [worktree.path],
      }),
    );
    expect(refused.code).toBe('INVALID_STATE');
    expect(refHead(repo, DELIVERY_REF)).toBe(revision);
  });

  it('reuses the candidate when another operation already installed it, never force-moving the branch', () => {
    const { repo, revision } = seedDeliveryRepo({ 'src/orders.ts': 'export const orders = [];\n' });
    const { cas, events } = casFor({ file: join(makeTempDir(), 'journal.sqlite') });
    const { pool, candidate } = commitRequirement({
      repo,
      name: 'reuse',
      baseRevision: revision,
      message: 'doc(requirement): reuse',
      id: REQUIREMENT_ID,
      version: 1,
      title: 'a',
      body: 'b',
    });
    const request = {
      operationId: 'op-reuse',
      kind: 'requirement_save' as const,
      repoRoot: repo,
      ref: DELIVERY_REF,
      expectedRevision: revision,
      candidateRevision: candidate,
      message: 'doc(requirement): reuse',
      requirementPool: [pool],
    };

    const first = expectIntegrated(cas.integrate(request));
    expect(first.refUpdated).toBe(true);
    expect(first.reused).toBe(true);
    // Replaying the same operation restores the original event instead of emitting a
    // second one, and moves nothing (reliability.md §5).
    const replay = expectIntegrated(cas.integrate(request));
    expect(replay.refUpdated).toBe(false);
    expect(replay.reused).toBe(true);
    expect(replay.completionEventId).toBe('cas-completed:op-reuse');
    expect(replay.emittedCompletionEvent).toBe(false);
    expect(refHead(repo, DELIVERY_REF)).toBe(candidate);
    expect(events.appended).toHaveLength(1);

    // A *different* operation racing on the same moved baseline is refused: the CAS
    // never overwrites a branch that has moved.
    const raced = expectRefused(cas.integrate({ ...request, operationId: 'op-reuse-2' }));
    expect(raced.code).toBe('VERSION_CONFLICT');
    expect(raced.branchUntouched).toBe(true);
    expect(raced.actualRevision).toBe(candidate);
    expect(refHead(repo, DELIVERY_REF)).toBe(candidate);
    expect(events.appended).toHaveLength(1);
  });

  it('never commits in the delivery working tree: a candidate revision is required (W8R1-01)', () => {
    const { repo, revision } = seedDeliveryRepo({ 'src/orders.ts': 'export const orders = [];\n' });
    const { events, journal } = casFor({ file: join(makeTempDir(), 'journal.sqlite') });
    // The record is already on disk in the delivery worktree, exactly as a save that
    // refreshed the working copy leaves it — which is what the removed fallback
    // `git commit` used to pick up.
    const record = requirementFiles(REQUIREMENT_ID, {
      version: 1,
      title: '未付款订单可取消',
      body: 'Unpaid orders can be cancelled.',
    });
    for (const [relativePath, content] of Object.entries(record.files)) {
      writeFileAt(repo, relativePath, content);
    }
    const pool: RequirementPoolCommit = {
      recordPath: record.recordPath,
      metadataPath: `${record.recordPath}/requirement.json`,
      contentPath: `${record.recordPath}/content.md`,
      readmePath: '.agentdev/requirements/README.md',
      recordHash: requirementRecordHash('a', body_fingerprint('Unpaid orders can be cancelled.')),
      version: 1,
    };
    // A competitor moves the branch between the compare and the write half. The old
    // fallback committed on top of that move and reported success; the branch here
    // must stay exactly where the competitor left it.
    const competitor = commitThroughWorktree({
      repo,
      name: 'competitor-nocandidate',
      baseRevision: revision,
      message: 'chore: competitor',
      files: { 'src/other.ts': 'export const other = 1;\n' },
    });
    const racingCas = createCasService({
      git: portWithCompetingMove({
        repo,
        ref: DELIVERY_REF,
        expectedOld: revision,
        competitor,
      }),
      journal,
      events,
    });

    const refused = expectRefused(
      racingCas.integrate({
        operationId: 'op-no-candidate',
        kind: 'requirement_save',
        repoRoot: repo,
        ref: DELIVERY_REF,
        expectedRevision: revision,
        message: 'doc(requirement): 保存需求 未付款订单可取消',
        requirementPool: [pool],
      }),
    );
    expect(refused.code).toBe('VALIDATION_ERROR');
    expect(refused.branchUntouched).toBe(true);
    // The branch never moved through this service, and no completion event exists.
    expect(refHead(repo, DELIVERY_REF)).toBe(revision);
    expect(events.appended).toHaveLength(0);
    // The competitor's commit was never picked up by a commit in this service.
    expect(branchCommitCount(repo)).toBe(1);
  });

  it('refuses a competing ref move between the compare and the swap (W8R1-01)', () => {
    const { repo, revision } = seedDeliveryRepo({ 'src/orders.ts': 'export const orders = [];\n' });
    const { events, journal } = casFor({ file: join(makeTempDir(), 'journal.sqlite') });
    const { pool, candidate } = commitRequirement({
      repo,
      name: 'candidate-race',
      baseRevision: revision,
      message: 'doc(requirement): race',
      id: REQUIREMENT_ID,
      version: 1,
      title: 'race',
      body: 'race body',
    });
    const competitor = commitThroughWorktree({
      repo,
      name: 'competitor-candidate',
      baseRevision: revision,
      message: 'chore: competitor',
      files: { 'src/other.ts': 'export const other = 2;\n' },
    });
    const racingCas = createCasService({
      git: portWithCompetingMove({
        repo,
        ref: DELIVERY_REF,
        expectedOld: revision,
        competitor,
      }),
      journal,
      events,
    });

    const refused = expectRefused(
      racingCas.integrate({
        operationId: 'op-competing-move',
        kind: 'requirement_save',
        repoRoot: repo,
        ref: DELIVERY_REF,
        expectedRevision: revision,
        candidateRevision: candidate,
        message: 'doc(requirement): race',
        requirementPool: [pool],
      }),
    );
    expect(refused.code).toBe('VERSION_CONFLICT');
    expect(refused.branchUntouched).toBe(true);
    expect(refused.actualRevision).toBe(competitor);
    // The competitor's commit is untouched and no completion event was emitted.
    expect(refHead(repo, DELIVERY_REF)).toBe(competitor);
    expect(events.appended).toHaveLength(0);
  });
});

describe('dependency lineage with real revisions (AC-081)', () => {
  interface Lineage {
    readonly repo: string;
    readonly baseRevision: string;
    readonly taskA: string;
    readonly taskB: string;
    readonly taskC: string;
    readonly revisionForDependency: (dependencyRevision: string) => string;
  }

  /** A adds an export, B uses it, C is an unrelated later Task that also touches A's file. */
  function lineagedRepo(): Lineage {
    const { repo, revision } = seedDeliveryRepo({
      'src/orders.ts': 'export const orders = [];\n',
      'src/index.ts': "export * from './orders.js';\n",
    });
    const a = taskWorktree({ repo, name: 'task-a', baseRevision: revision });
    writeFileAt(
      a.path,
      'src/orders.ts',
      'export const orders = [];\nexport const cancelOrder = (id: string) => id;\n',
    );
    const taskA = commitIn(a.path, 'feat: A adds cancelOrder', ['src/orders.ts']);

    const b = taskWorktree({ repo, name: 'task-b', baseRevision: taskA });
    writeFileAt(
      b.path,
      'src/cancel.ts',
      "import { cancelOrder } from './orders.js';\nexport const cancel = (id: string) => cancelOrder(id);\n",
    );
    const taskB = commitIn(b.path, 'feat: B uses cancelOrder', ['src/cancel.ts']);

    const c = taskWorktree({ repo, name: 'task-c', baseRevision: revision });
    writeFileAt(
      c.path,
      'src/orders.ts',
      'export const orders = [];\nexport const cancelOrder = (id: string) => `late:${id}`;\n',
    );
    const taskC = commitIn(c.path, 'feat: C changes cancelOrder', ['src/orders.ts']);

    return {
      repo,
      baseRevision: revision,
      taskA,
      taskB,
      taskC,
      revisionForDependency: (dependencyRevision: string) =>
        dependencyRevision === taskA ? taskC : dependencyRevision,
    };
  }

  function taskPort(
    tasks: readonly TaskNode[],
    manifests: Readonly<Record<string, string>>,
  ): TaskDependencyPort {
    return {
      tasksForWork: () => tasks,
      latestManifestId: (taskId) => manifests[taskId] ?? null,
    };
  }

  const mergeRevision = (base: string | null, revision: string): string => revision;

  it('orders the DAG deterministically and rejects a cycle', () => {
    const tasks: TaskNode[] = [
      { id: 'b', dependsOn: ['a'], revision: 'r-b', recordedDependencyManifestRefs: [] },
      { id: 'a', dependsOn: [], revision: 'r-a', recordedDependencyManifestRefs: [] },
    ];
    expect(orderTasks(tasks)).toEqual(['a', 'b']);
    expect(() =>
      orderTasks([
        { id: 'a', dependsOn: ['b'], revision: 'r-a', recordedDependencyManifestRefs: [] },
        { id: 'b', dependsOn: ['a'], revision: 'r-b', recordedDependencyManifestRefs: [] },
      ]),
    ).toThrow(/存在环/u);
    expect(() =>
      orderTasks([
        { id: 'a', dependsOn: ['missing'], revision: 'r-a', recordedDependencyManifestRefs: [] },
      ]),
    ).toThrow(/依赖不存在/u);
  });

  it('records dependencyRevision and dependencyManifestRefs, then starts B from A', () => {
    const lineage = lineagedRepo();
    const tasks: TaskNode[] = [
      { id: 'task-a', dependsOn: [], revision: lineage.taskA, recordedDependencyManifestRefs: [] },
      {
        id: 'task-b',
        dependsOn: ['task-a'],
        revision: lineage.taskB,
        recordedDependencyManifestRefs: [],
      },
    ];
    const plan = planDependencies({
      tasks,
      port: taskPort(tasks, { 'task-a': 'manifest-a' }),
      mergeRevision,
    });
    expect(plan.order).toEqual(['task-a', 'task-b']);
    const resolutionB = plan.resolutions.find((entry) => entry.taskId === 'task-b');
    expect(resolutionB).toMatchObject({
      dependencyRevision: lineage.taskA,
      dependencyManifestRefs: ['manifest-a'],
      ancestorTaskIds: ['task-a'],
    });
    const resolutionA = plan.resolutions.find((entry) => entry.taskId === 'task-a');
    expect(resolutionA?.dependencyRevision).toBeNull();

    // Starting B without the recorded dependency input is not allowed.
    const missingInput = verifyTaskStart({
      task: tasks[1] as TaskNode,
      expected: resolutionB as DependencyResolution,
      git,
      repoRoot: lineage.repo,
      workId: 'work-1',
    });
    expect(missingInput.ok).toBe(false);
    if (missingInput.ok) throw new Error('unreachable');
    expect(missingInput.code).toBe('GATE_NOT_READY');
    expect(missingInput.invalidated).toBe(false);

    // With the frozen input recorded, B may start from A's revision.
    const recordedB: TaskNode = {
      id: 'task-b',
      dependsOn: ['task-a'],
      revision: lineage.taskB,
      recordedDependencyRevision: lineage.taskA,
      recordedDependencyManifestRefs: ['manifest-a'],
    };
    const allowed = verifyTaskStart({
      task: recordedB,
      expected: resolutionB as DependencyResolution,
      git,
      repoRoot: lineage.repo,
      workId: 'work-1',
    });
    expect(allowed.ok).toBe(true);
    if (!allowed.ok) throw new Error('unreachable');
    expect(allowed.dependencyRevision).toBe(lineage.taskA);
    expect(allowed.dependencyManifestRefs).toEqual(['manifest-a']);

    // A Task that claims dependencies without recording them cannot start either.
    const noManifest = verifyTaskStart({
      task: { ...recordedB, recordedDependencyManifestRefs: [] },
      expected: resolutionB as DependencyResolution,
      git,
      repoRoot: lineage.repo,
      workId: 'work-1',
    });
    expect(noManifest.ok).toBe(false);
    if (noManifest.ok) throw new Error('unreachable');
    expect(noManifest.code).toBe('GATE_NOT_READY');
  });

  it('invalidates B when its ancestor revision moves', () => {
    const lineage = lineagedRepo();
    // A new commit lands on top of A, so A's frozen result is no longer A's revision.
    const newRevision = lineage.revisionForDependency(lineage.taskA);
    expect(newRevision).not.toBe(lineage.taskA);
    const moved: TaskNode[] = [
      { id: 'task-a', dependsOn: [], revision: newRevision, recordedDependencyManifestRefs: [] },
      {
        id: 'task-b',
        dependsOn: ['task-a'],
        revision: lineage.taskB,
        recordedDependencyManifestRefs: [],
      },
    ];
    const plan = planDependencies({
      tasks: moved,
      port: taskPort(moved, { 'task-a': 'manifest-a' }),
      mergeRevision,
    });
    const resolutionB = plan.resolutions.find((entry) => entry.taskId === 'task-b');
    const recordedB: TaskNode = {
      id: 'task-b',
      dependsOn: ['task-a'],
      revision: lineage.taskB,
      recordedDependencyRevision: lineage.taskA,
      recordedDependencyManifestRefs: ['manifest-a'],
    };
    const check = verifyTaskStart({
      task: recordedB,
      expected: resolutionB as DependencyResolution,
      git,
      repoRoot: lineage.repo,
      workId: 'work-1',
    });
    expect(check.ok).toBe(false);
    if (check.ok) throw new Error('unreachable');
    expect(check.code).toBe('STALE_ARTIFACT');
    expect(check.invalidated).toBe(true);
    expect(check.expectedDependencyRevision).toBe(lineage.taskC);
    expect(check.recordedDependencyRevision).toBe(lineage.taskA);
  });

  it('does not re-apply an already-merged ancestor in the final integration', () => {
    const lineage = lineagedRepo();
    const { cas, events } = casFor({ file: join(makeTempDir(), 'journal.sqlite') });

    // 1. The delivery branch already contains A by the time the final integration
    //    runs: a previous integration pass installed it.
    const first = runIntegration({
      git,
      repoRoot: lineage.repo,
      cas,
      worktreePath: taskWorktree({
        repo: lineage.repo,
        name: 'integration-a',
        baseRevision: lineage.baseRevision,
      }).path,
      operationId: 'op-ancestor-a',
      ref: DELIVERY_REF,
      targetRevision: lineage.baseRevision,
      tasks: [
        { taskId: 'task-a', dependsOn: [], revision: lineage.taskA, dependencyRevision: null },
      ],
      workId: 'work-1',
    });
    if (!first.ok) throw new Error(`first integration failed: ${first.code}`);
    expect(refHead(lineage.repo, DELIVERY_REF)).toBe(first.revision);
    // A's change is now in the delivery branch: Git reports A's own commit as already
    // applied against it (patch identity), which is what the next pass keys on.
    const appliedAgainstBranch = requireValue<readonly string[]>(
      git.cherry(lineage.repo, first.revision, lineage.taskA),
      'cherry',
    );
    expect(appliedAgainstBranch).toEqual([]);

    // B was developed on top of A; integrating it must skip A entirely.
    const integration = runIntegration({
      git,
      repoRoot: lineage.repo,
      cas,
      worktreePath: taskWorktree({
        repo: lineage.repo,
        name: 'integration-b',
        baseRevision: first.revision,
      }).path,
      operationId: 'op-ancestor-b',
      ref: DELIVERY_REF,
      targetRevision: first.revision,
      tasks: [
        { taskId: 'task-a', dependsOn: [], revision: lineage.taskA, dependencyRevision: null },
        {
          taskId: 'task-b',
          dependsOn: ['task-a'],
          revision: lineage.taskB,
          dependencyRevision: lineage.taskA,
        },
      ],
      workId: 'work-1',
    });
    if (!integration.ok) throw new Error(`integration failed: ${JSON.stringify(integration)}`);
    // A's change is already in the target, so A contributes no commit: only B's own
    // diff is replayed, and A's change is not applied a second time.
    expect(integration.applied.find((entry) => entry.taskId === 'task-a')?.alreadyMerged).toBe(
      true,
    );
    expect(integration.appliedTaskIds).toEqual(['task-b']);
    expect(integration.applied.filter((entry) => entry.commit !== null)).toHaveLength(1);
    // Exactly one new commit: B's own diff. A was not cherry-picked again.
    expect(integration.revision).not.toBe(first.revision);
    expect(refHead(lineage.repo, DELIVERY_REF)).toBe(integration.revision);
    const files = requireValue<readonly string[]>(
      git.listTree(lineage.repo, integration.revision, ['src']),
      'ls-tree',
    );
    expect(files).toEqual(expect.arrayContaining(['src/cancel.ts', 'src/orders.ts']));
    // A's change is present exactly as A committed it (no double application).
    expect(
      requireValue<boolean>(
        git.pathAtRevision(lineage.repo, integration.revision, 'src/cancel.ts'),
        'cat-file',
      ),
    ).toBe(true);
    expect(events.appended).toHaveLength(2);

    // The CAS refuses to move the branch again from the stale baseline.
    const stale = expectRefused(
      cas.integrate({
        operationId: 'op-ancestor-stale',
        kind: 'integrate',
        repoRoot: lineage.repo,
        ref: DELIVERY_REF,
        expectedRevision: first.revision,
        candidateRevision: first.revision,
        message: 'feat: stale retry',
      }),
    );
    expect(stale.code).toBe('VERSION_CONFLICT');
    expect(refHead(lineage.repo, DELIVERY_REF)).toBe(integration.revision);
  });

  it('produces an independent repair task when two passed Tasks conflict (AC-062)', () => {
    const lineage = lineagedRepo();
    const { cas, events } = casFor({ file: join(makeTempDir(), 'journal.sqlite') });

    // Task A passed and was integrated: the delivery branch now holds A.
    const first = runIntegration({
      git,
      repoRoot: lineage.repo,
      cas,
      worktreePath: taskWorktree({
        repo: lineage.repo,
        name: 'conflict-a',
        baseRevision: lineage.baseRevision,
      }).path,
      operationId: 'op-conflict-a',
      ref: DELIVERY_REF,
      targetRevision: lineage.baseRevision,
      tasks: [
        { taskId: 'task-a', dependsOn: [], revision: lineage.taskA, dependencyRevision: null },
      ],
      workId: 'work-1',
    });
    if (!first.ok) throw new Error(`first integration failed: ${first.code}`);

    // Task C also passed, from the same base, and changed the same file. The final
    // integration replays C's own diff on top of A and conflicts.
    const integration = runIntegration({
      git,
      repoRoot: lineage.repo,
      cas,
      worktreePath: taskWorktree({
        repo: lineage.repo,
        name: 'conflict-integration',
        baseRevision: first.revision,
      }).path,
      operationId: 'op-conflict-c',
      ref: DELIVERY_REF,
      targetRevision: first.revision,
      tasks: [
        {
          taskId: 'task-a',
          dependsOn: [],
          revision: lineage.taskA,
          dependencyRevision: null,
        },
        {
          taskId: 'task-c',
          dependsOn: ['task-a'],
          revision: lineage.taskC,
          dependencyRevision: lineage.baseRevision,
          acceptanceIds: ['AC-062'],
        },
      ],
      workId: 'work-1',
      requirementId: REQUIREMENT_ID,
      dependencyManifestRefs: ['manifest-a'],
      acceptanceIds: ['AC-062', 'AC-081'],
    });

    expect(integration.ok).toBe(false);
    if (integration.ok) throw new Error('unreachable');
    expect(integration.code).toBe('TASK_MERGE_CONFLICT');
    if (integration.code !== 'TASK_MERGE_CONFLICT') throw new Error('unreachable');
    expect(integration.conflict.paths).toEqual(['src/orders.ts']);
    expect(integration.conflict.kind).toBe('task-merge-conflict');
    // A was already merged, so only C's own commits were replayed.
    expect(integration.appliedTaskIds).toEqual([]);
    expect(integration.branchUntouched).toBe(true);
    // The conflicting attempt moved nothing and emitted no completion event.
    expect(refHead(lineage.repo, DELIVERY_REF)).toBe(first.revision);
    expect(events.appended).toHaveLength(1);

    // The independent repair Task: a new unit of work, depending on both routes, with a
    // fresh verification requirement for the final combination.
    const repair = integration.repair;
    expect(repair.repairTask.dependsOn).toEqual(['task-a', 'task-c']);
    expect(repair.repairTask.role).toBe('backend');
    expect(repair.repairTask.dependencyRevision).toBe(first.revision);
    expect(repair.repairTask.dependencyManifestRefs).toEqual(['manifest-a']);
    expect(repair.repairTask.conflictPaths).toEqual(['src/orders.ts']);
    expect(repair.repairTask.requiresFreshVerification).toBe(true);
    expect(repair.repairTask.committed).toBe(false);
    expect(repair.repairTask.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(repair.artifact.path).toContain('.agentdev/integration/conflicts/');
    expect(repair.artifact.markdown).toContain('最终组合');
    expect(repair.artifact.sha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(repair.repairTask.id).toBe(
      repairTaskId({
        workId: 'work-1',
        taskIds: ['task-a', 'task-c'],
        revision: first.revision,
      }),
    );

    // The repair id is deterministic, so a retried integration cannot create a second one.
    const sameId = createRepairTask({
      conflict: {
        kind: 'task-merge-conflict',
        reason: 'git',
        paths: ['src/orders.ts'],
        message: 'same',
        taskId: 'task-c',
        mergeBase: first.revision,
      },
      workId: 'work-1',
      dependencyRevision: first.revision,
      dependencyManifestRefs: [],
      conflictingTaskIds: ['task-c', 'task-a'],
      acceptanceIds: [],
    });
    expect(sameId.repairTask.id).toBe(repair.repairTask.id);

    // A retried integration produces the *same* repair Task, not a second one.
    const retried = runIntegration({
      git,
      repoRoot: lineage.repo,
      cas,
      worktreePath: taskWorktree({
        repo: lineage.repo,
        name: 'conflict-integration-retry',
        baseRevision: first.revision,
      }).path,
      operationId: 'op-conflict-c',
      ref: DELIVERY_REF,
      targetRevision: first.revision,
      tasks: [
        {
          taskId: 'task-a',
          dependsOn: [],
          revision: lineage.taskA,
          dependencyRevision: null,
        },
        {
          taskId: 'task-c',
          dependsOn: ['task-a'],
          revision: lineage.taskC,
          dependencyRevision: lineage.baseRevision,
        },
      ],
      workId: 'work-1',
    });
    expect(retried.ok).toBe(false);
    if (retried.ok || retried.code !== 'TASK_MERGE_CONFLICT') throw new Error('unreachable');
    expect(retried.repair.repairTask.id).toBe(repair.repairTask.id);
    expect(refHead(lineage.repo, DELIVERY_REF)).toBe(first.revision);
  });

  it('integrates two non-conflicting passed Tasks in dependency order and CASes once', () => {
    const { repo, revision } = seedDeliveryRepo({
      'src/orders.ts': 'export const orders = [];\n',
      'src/money.ts': 'export const money = 0;\n',
    });
    const a = taskWorktree({ repo, name: 'task-a', baseRevision: revision });
    writeFileAt(
      a.path,
      'src/orders.ts',
      'export const orders = [];\nexport const cancel = () => true;\n',
    );
    const taskA = commitIn(a.path, 'feat: A', ['src/orders.ts']);

    const b = taskWorktree({ repo, name: 'task-b', baseRevision: taskA });
    writeFileAt(b.path, 'src/money.ts', 'export const money = 1;\n');
    const taskB = commitIn(b.path, 'feat: B', ['src/money.ts']);

    const { cas, events } = casFor({ file: join(makeTempDir(), 'journal.sqlite') });
    const integration = runIntegration({
      git,
      repoRoot: repo,
      cas,
      worktreePath: taskWorktree({ repo, name: 'integration-two', baseRevision: revision }).path,
      operationId: 'op-integrate-two',
      ref: DELIVERY_REF,
      targetRevision: revision,
      tasks: [
        { taskId: 'task-b', dependsOn: ['task-a'], revision: taskB, dependencyRevision: taskA },
        { taskId: 'task-a', dependsOn: [], revision: taskA, dependencyRevision: null },
      ],
      workId: 'work-1',
    });
    if (!integration.ok) throw new Error(`integration failed: ${JSON.stringify(integration)}`);
    // Dependencies first, ties by Task id (reliability.md §4).
    expect(integration.appliedTaskIds).toEqual(['task-a', 'task-b']);
    expect(integration.skippedTaskIds).toEqual([]);
    expect(integration.cas.refUpdated).toBe(true);
    expect(refHead(repo, DELIVERY_REF)).toBe(integration.revision);
    expect(events.appended).toHaveLength(1);
    const files = requireValue<readonly string[]>(
      git.listTree(repo, integration.revision, ['src']),
      'ls-tree',
    );
    expect(files).toEqual(expect.arrayContaining(['src/orders.ts', 'src/money.ts']));
    // Both Tasks' own changes are present in the final combination.
    expect(
      requireValue<boolean>(
        git.pathAtRevision(repo, integration.revision, 'src/money.ts'),
        'cat-file',
      ),
    ).toBe(true);
    // Replaying the same operation is idempotent: same commit, one completion event.
    const replay = runIntegration({
      git,
      repoRoot: repo,
      cas,
      worktreePath: taskWorktree({
        repo,
        name: 'integration-two-replay',
        baseRevision: integration.revision,
      }).path,
      operationId: 'op-integrate-two',
      ref: DELIVERY_REF,
      targetRevision: revision,
      tasks: [
        { taskId: 'task-b', dependsOn: ['task-a'], revision: taskB, dependencyRevision: taskA },
        { taskId: 'task-a', dependsOn: [], revision: taskA, dependencyRevision: null },
      ],
      workId: 'work-1',
    });
    if (!replay.ok) throw new Error(`replay failed: ${replay.code}`);
    // Nothing was replayed a second time: the branch stays where it is and only the
    // original completion event exists.
    expect(replay.outcome).toBe('noop');
    expect(replay.revision).toBe(integration.revision);
    expect(replay.applied.filter((entry) => entry.commit !== null)).toEqual([]);
    expect(refHead(repo, DELIVERY_REF)).toBe(integration.revision);
    // The replay reused the operation journal entry: still exactly one event.
    expect(replay.cas.reused).toBe(true);
    expect(events.appended).toHaveLength(1);
  });
});

describe('worktree ownership against a real repository (AC-062)', () => {
  it('creates one writer per worktree, refuses dirty removal, then discards on request', () => {
    const { repo, revision } = seedDeliveryRepo({ 'src/orders.ts': 'export const orders = [];\n' });
    const leases = createMemoryWorktreeLeaseStore();
    const manager = createWorktreeManager({ git, leases });
    const path = join(makeTempDir(), 'task-a');
    const first = manager.create({
      taskId: 'task-a',
      worktreeId: 'wt-a',
      repoRoot: repo,
      path,
      baseRevision: revision,
      branch: 'agentdev/task-a',
      ownerAttemptId: 'attempt-1',
      epoch: 1,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error(first.message);
    const listing = requireValue<readonly { readonly path: string }[]>(
      git.listWorktrees(repo),
      'worktree list',
    );
    expect(listing.some((entry) => entry.path === first.record.path)).toBe(true);

    // A second runner must not own the same worktree.
    const second = manager.create({
      taskId: 'task-a',
      worktreeId: 'wt-a',
      repoRoot: repo,
      path: join(makeTempDir(), 'task-a-other'),
      baseRevision: revision,
      ownerAttemptId: 'attempt-2',
      epoch: 2,
    });
    expect(second.ok).toBe(false);
    if (second.ok) throw new Error('unreachable');
    expect(second.code).toBe('BUSY');
    expect(second.heldBy?.ownerAttemptId).toBe('attempt-1');

    // Uncommitted work in the worktree blocks removal until it is explicitly discarded.
    writeFileAt(first.record.path, 'src/scratch.ts', 'export const scratch = 1;\n');
    const refused = manager.remove({ worktreeId: 'wt-a', ownerAttemptId: 'attempt-1' });
    expect(refused.ok).toBe(false);
    if (refused.ok) throw new Error('unreachable');
    expect(refused.code).toBe('INVALID_STATE');
    expect(refused.dirtyPaths).toContain('src/scratch.ts');

    const discarded = manager.remove({
      worktreeId: 'wt-a',
      ownerAttemptId: 'attempt-1',
      discard: true,
    });
    expect(discarded.ok).toBe(true);
    if (!discarded.ok) throw new Error(discarded.message);
    expect(discarded.leaseReleased).toBe(true);
    const after = requireValue<readonly { readonly path: string }[]>(
      git.listWorktrees(repo),
      'worktree list',
    );
    expect(after.some((entry) => entry.path === first.record.path)).toBe(false);
  });
});
