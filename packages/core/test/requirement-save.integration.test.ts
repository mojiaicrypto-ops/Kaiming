/**
 * Requirement instant save against a **real temporary Git repository** and a
 * **real SQLite file** (AC-090, AC-091, AC-093).
 *
 * Nothing in here is a stub for the state the acceptance criteria are about: the
 * delivery branch is a real branch moved by a real `git update-ref`, the record
 * commit is created in a real detached worktree, the projection lives in a real
 * `project.sqlite`, and crash injection happens at the documented fault points
 * (`reliability.md` §5/§9: after the commit, before the projection; between the ref
 * update and the status write).
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { normalizeContentMarkdown, REQUIREMENTS_README, sha256Hex } from '@agentdev/knowledge';
import { ProjectStore as Store, projectIdFromRoot, type ProjectStore } from '@agentdev/storage';
import { runGit, type GitResult } from '@agentdev/workspace';
import {
  createCasService,
  createMemoryCasEvents,
  createNodeWorktreeGitPort,
  runIntegration,
  type CasJournal,
  type CasJournalRecord,
  type RequirementPoolCommit,
  type WorktreeGitPort,
} from '@agentdev/workspace';
import {
  checkCompletionSettlement,
  createRequirementSaveService,
  integrationLockResource,
  ProjectIntegrationLock,
  readRequirementPoolAtRevision,
  REQUIREMENT_SAVED_EVENT,
  REQUIREMENT_SAVE_OPERATION_KIND,
  type RequirementMetadataDraft,
  type RequirementPoolGitPort,
  type RequirementPoolRevisionRecord,
  type RequirementSaveOutcome,
  type RequirementSaveService,
} from '../src/index.js';

const created: string[] = [];
const DELIVERY_REF = 'refs/heads/agentdev/main';
const REQUIREMENT_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e5f';
const SECOND_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e60';
const TIME = '2026-09-11T00:00:00.000Z';

function makeTempDir(prefix = 'agentdev-save-'): string {
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

const port = createNodeWorktreeGitPort();

/** Unwraps a `GitResult`, failing the test loudly when Git refused. */
function requireValue<T>(result: GitResult<T>, what: string): T {
  if (!result.ok) throw new Error(`${what} failed: ${result.errors[0]?.message ?? 'unknown'}`);
  return result.value;
}

/** Reads one blob at a revision; the production pool reader works the same way. */
function gitShow(repoRoot: string, revision: string, path: string): GitResult<string | null> {
  const result = runGit(['show', `${revision}:${path}`], { cwd: repoRoot });
  if (result.ok) return { ok: true, value: result.stdout };
  // `git show` exits 128 for "path does not exist at that revision".
  if (result.status === 128) return { ok: true, value: null };
  return {
    ok: false,
    errors: [
      {
        code: 'INTERNAL_ERROR',
        message: `git show ${revision}:${path} 失败：${result.stderr.trim()}`,
        path: repoRoot,
        command: ['show', `${revision}:${path}`],
        status: result.status,
        stderr: result.stderr,
      },
    ],
  };
}

/** The pool reader needs blobs at a revision; `git show` is the real answer. */
const gitReader: RequirementPoolGitPort = {
  resolveRevision: (repoRoot, revision) => port.resolveRevision(repoRoot, revision),
  listTree: (repoRoot, revision, paths) => port.listTree(repoRoot, revision, paths),
  pathAtRevision: (repoRoot, revision, path) => port.pathAtRevision(repoRoot, revision, path),
  readBlob: (repoRoot, revision, path) => gitShow(repoRoot, revision, path),
};

/** A detached worktree at `baseRevision`, the shape the save path commits in. */
function detachedWorktree(repoRoot: string, name: string, baseRevision: string): string {
  const path = join(makeTempDir('agentdev-save-wt-'), name);
  requireValue(port.addWorktree({ repoRoot, path, baseRevision }), `git worktree add ${name}`);
  return path;
}

/** A real SQLite-backed `CasJournal` (the `operation` table's recovery half). */
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

interface Harness {
  readonly repo: string;
  readonly store: ProjectStore;
  readonly service: RequirementSaveService;
  readonly lock: ProjectIntegrationLock;
  readonly projectId: string;
  readonly baseRevision: string;
  readonly dataDir: string;
  readonly journal: CasJournal;
  readonly events: ReturnType<typeof createMemoryCasEvents>;
  readonly worktreeRoot: string;
}

/** A delivery repository, a Project database and a save service over both. */
function harness(options: { readonly keepWorktree?: boolean } = {}): Harness {
  const repo = makeTempDir();
  writeFileAt(repo, 'src/orders.ts', 'export const orders = [];\n');
  writeFileAt(repo, 'README.md', '# demo\n');
  requireValue(port.initRepository(repo, { branch: 'agentdev/main' }), 'git init');
  writeFileAt(repo, '.gitignore', 'node_modules/\n.agentdev/work/\n');
  const seed = requireValue<{ revision: string }>(
    port.commitPaths(repo, 'chore: seed delivery branch', [
      'src/orders.ts',
      'README.md',
      '.gitignore',
    ]),
    'seed commit',
  );

  const dataDir = makeTempDir('agentdev-save-state-');
  const projectId = projectIdFromRoot(repo);
  const store = Store.open({
    dataDir,
    canonicalRoot: repo,
    migrations: { backup: () => undefined, backupPath: join(dataDir, 'pre.sqlite') },
  });
  store.projects.insert({
    id: projectId,
    root: repo,
    gitRoot: repo,
    codeRoot: 'src',
    documentRoot: 'docs',
    deliveryBranch: 'agentdev/main',
    trust: 'trusted',
    state: 'open',
  });

  const journal = sqliteJournal(join(dataDir, 'cas.sqlite'));
  const events = createMemoryCasEvents();
  const lock = new ProjectIntegrationLock({
    projectId,
    leases: store.leases,
    now: () => TIME,
  });
  const service = createRequirementSaveService({
    store,
    worktrees: port,
    journal,
    events,
    lock,
    worktreeRoot: join(dataDir, 'save-worktrees'),
    now: () => TIME,
    keepWorktree: options.keepWorktree ?? false,
  });
  return {
    repo,
    store,
    service,
    lock,
    projectId,
    baseRevision: seed.revision,
    dataDir,
    journal,
    events,
    worktreeRoot: join(dataDir, 'save-worktrees'),
  };
}

function metadataDraft(overrides: Record<string, unknown> = {}): RequirementMetadataDraft {
  return {
    schemaVersion: 1,
    id: REQUIREMENT_ID,
    version: 1,
    contentFile: 'content.md',
    createdAt: TIME,
    updatedAt: TIME,
    title: '未付款订单可取消',
    goal: '让未付款订单可取消',
    scope: { readPaths: [], writePaths: [], operations: ['edit'], networkTargets: [] },
    lifecycle: 'queued',
    featureIds: [],
    acceptance: [{ id: 'AC-090', given: 'g', when: 'w', then: 't' }],
    openQuestions: [],
    confirmedDecisions: [],
    relatedRequirementIds: [],
    ...overrides,
  };
}

/** A body with the six documented headings (`requirements.md` §6). */
function body(text = '未付款订单可取消。', completion = '待明确'): string {
  return [
    '## 目标与背景',
    '',
    text,
    '',
    '## 范围与行为',
    '',
    '仅订单模块。',
    '',
    '## 验收说明',
    '',
    'AC-090。',
    '',
    '## 已确认决定',
    '',
    '无',
    '',
    '## 未决问题',
    '',
    '无',
    '',
    '## 完成摘要',
    '',
    completion,
    '',
  ].join('\n');
}

function requireSaved(
  outcome: RequirementSaveOutcome,
): Extract<RequirementSaveOutcome, { ok: true }> {
  if (!outcome.ok) {
    throw new Error(`expected a save, got ${outcome.code}: ${outcome.message}`);
  }
  return outcome;
}

function requireRefused(
  outcome: RequirementSaveOutcome,
): Extract<RequirementSaveOutcome, { ok: false }> {
  if (outcome.ok) throw new Error('expected a refusal');
  return outcome;
}

function refHead(repo: string, ref = DELIVERY_REF): string | null {
  return requireValue<string | null>(port.resolveRevision(repo, ref), `resolve ${ref}`);
}

function commitCount(repo: string): number {
  let revision = refHead(repo);
  const seen = new Set<string>();
  while (revision !== null && !seen.has(revision)) {
    seen.add(revision);
    const parent = requireValue<string | null>(
      port.resolveRevision(repo, `${revision}^`),
      'resolve parent',
    );
    revision = parent;
  }
  return seen.size;
}

/**
 * A *well-formed* record for `id` committed by "another server".
 *
 * The pair is internally consistent (the body hash matches), so the pool reader
 * accepts it; what makes it a conflict is that this machine's projection describes a
 * different body for the same `recordVersion` (`AC-093`).
 */
function commitCorruptedRecord(input: {
  readonly repo: string;
  readonly baseRevision: string;
  readonly id: string;
  readonly version: number;
}): string {
  const worktree = detachedWorktree(
    input.repo,
    `corrupt-${input.id.slice(0, 8)}`,
    input.baseRevision,
  );
  const recordPath = `.agentdev/requirements/${input.id}`;
  const contentMarkdown = normalizeContentMarkdown(
    `<!-- record-version: ${input.version} -->\n# body\n\n其他服务器的正文。\n`,
  );
  const metadataJson = `${JSON.stringify(
    {
      schemaVersion: 1,
      id: input.id,
      version: input.version,
      contentFile: 'content.md',
      contentHash: sha256Hex(contentMarkdown),
      createdAt: TIME,
      updatedAt: TIME,
      title: 'other server',
      goal: 'other server',
      scope: { readPaths: [], writePaths: [], operations: ['edit'], networkTargets: [] },
      lifecycle: 'queued',
      featureIds: [],
      acceptance: [],
      openQuestions: [],
      confirmedDecisions: [],
      relatedRequirementIds: [],
    },
    null,
    2,
  )}\n`;
  writeFileAt(worktree, `${recordPath}/requirement.json`, metadataJson);
  writeFileAt(worktree, `${recordPath}/content.md`, contentMarkdown);
  writeFileAt(worktree, REQUIREMENTS_README, '# 需求池索引\n');
  const committed = requireValue<{ revision: string }>(
    port.commitPaths(worktree, 'doc(requirement): other server', [
      `${recordPath}/requirement.json`,
      `${recordPath}/content.md`,
      REQUIREMENTS_README,
    ]),
    'commit corrupted record',
  );
  requireValue(
    port.updateRef({
      repoRoot: input.repo,
      ref: DELIVERY_REF,
      newRevision: committed.revision,
      expectedOldRevision: input.baseRevision,
    }),
    'update-ref for the other server commit',
  );
  // The working tree must match HEAD, which is what the pool reader reads.
  for (const relative of [
    `${recordPath}/requirement.json`,
    `${recordPath}/content.md`,
    REQUIREMENTS_README,
  ]) {
    writeFileAt(input.repo, relative, readFileSync(join(worktree, relative), 'utf8'));
  }
  return committed.revision;
}

describe('requirement instant save (AC-090)', () => {
  it('commits requirement.json, content.md and the rebuilt README in one commit', () => {
    const h = harness();
    const saved = requireSaved(
      h.service.save({
        operationId: 'op-save-1',
        metadata: metadataDraft(),
        contentMarkdown: body(),
        expected: { expectedAbsent: true },
        sourceRef: { kind: 'action', id: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e99' },
        kind: 'create',
      }),
    );

    expect(saved.status).toBe('saved');
    expect(saved.requirementId).toBe(REQUIREMENT_ID);
    expect(saved.recordVersion).toBe(1);
    expect(saved.git.branch).toBe('agentdev/main');
    expect(saved.git.ref).toBe(DELIVERY_REF);
    expect(saved.git.commit).not.toBe(h.baseRevision);
    expect(saved.git.previousCommit).toBe(h.baseRevision);
    expect(saved.git.createdCommit).toBe(true);
    expect(saved.git.refUpdated).toBe(true);
    // Nothing was pushed anywhere: the commit exists only on the local branch.
    expect(saved.git.unpushed).toBe(true);
    expect(saved.git.upstreamRevision).toBeNull();
    expect(refHead(h.repo)).toBe(saved.git.commit);
    expect(commitCount(h.repo)).toBe(2);

    // Both files and the index really are in the commit (`AC-093`).
    const tree = requireValue<readonly string[]>(
      port.listTree(h.repo, saved.git.commit, ['.agentdev']),
      'ls-tree',
    );
    expect(tree).toEqual(
      expect.arrayContaining([
        saved.recordPath + '/requirement.json',
        saved.recordPath + '/content.md',
        REQUIREMENTS_README,
      ]),
    );
    const committedMetadata = requireValue<string | null>(
      gitShow(h.repo, saved.git.commit, `${saved.recordPath}/requirement.json`),
      'git show requirement.json',
    );
    expect(sha256Hex(committedMetadata ?? '')).toBe(saved.metadataHash);
    const committedBody = requireValue<string | null>(
      gitShow(h.repo, saved.git.commit, `${saved.recordPath}/content.md`),
      'git show content.md',
    );
    expect(sha256Hex(committedBody ?? '')).toBe(saved.contentHash);

    // Git and the projection agree, and only then is `saved` reported.
    expect(saved.row.portableRef.hash).toBe(saved.recordHash);
    expect(saved.row.portableRef.revision).toBe(saved.git.commit);
    expect(saved.row.recordVersion).toBe(1);
    expect(saved.projection).toEqual({
      verdict: 'new',
      revision: saved.git.commit,
      repaired: false,
    });
    expect(saved.recovery).toBeNull();

    // The on-disk pool is readable and self-consistent.
    const pool = readRequirementPoolAtRevision({
      git: gitReader,
      repoRoot: h.repo,
      revision: saved.git.commit,
    });
    expect(pool.records.map((record) => record.id)).toEqual([REQUIREMENT_ID]);
    expect(pool.records[0]?.recordHash).toBe(saved.recordHash);
    const storedReadme = readFileSync(join(h.repo, REQUIREMENTS_README), 'utf8');
    expect(storedReadme).toContain(REQUIREMENT_ID);
    expect(storedReadme).toContain('未付款订单可取消');

    // One completion event and one `requirement_save` operation row.
    expect(h.store.events.latestForEntity(REQUIREMENT_ID)?.name).toBe(REQUIREMENT_SAVED_EVENT);
    const operations = h.store.operations.list({
      where: 'kind = ?',
      params: [REQUIREMENT_SAVE_OPERATION_KIND],
    });
    expect(operations).toHaveLength(1);
    expect(operations[0]?.state).toBe('completed');
    h.store.close();
  });

  it('reports the unpushed state against a configured remote (`AC-090`)', () => {
    const h = harness();
    const first = requireSaved(
      h.service.save({
        operationId: 'op-unpushed-1',
        metadata: metadataDraft(),
        contentMarkdown: body(),
        expected: { expectedAbsent: true },
        sourceRef: { kind: 'action', id: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e99' },
      }),
    );
    // A remote-tracking ref exists but has not received the save yet.
    requireValue(
      port.updateRef({
        repoRoot: h.repo,
        ref: 'refs/remotes/origin/agentdev/main',
        newRevision: h.baseRevision,
        expectedOldRevision: null,
      }),
      'create the remote-tracking ref',
    );
    const second = requireSaved(
      h.service.save({
        operationId: 'op-unpushed-2',
        metadata: metadataDraft({ version: 2, title: '未付款订单可取消 v2' }),
        contentMarkdown: body('第二版。'),
        expected: { recordVersion: 1, recordHash: first.recordHash },
        sourceRef: { kind: 'action', id: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e99' },
      }),
    );
    expect(second.git.upstreamRevision).toBe(h.baseRevision);
    expect(second.git.unpushed).toBe(true);

    // After the branch is pushed the same report says so.
    requireValue(
      port.updateRef({
        repoRoot: h.repo,
        ref: 'refs/remotes/origin/agentdev/main',
        newRevision: second.git.commit,
        expectedOldRevision: h.baseRevision,
      }),
      'advance the remote-tracking ref',
    );
    const third = requireSaved(
      h.service.save({
        operationId: 'op-unpushed-3',
        metadata: metadataDraft({ version: 3, title: '未付款订单可取消 v3' }),
        contentMarkdown: body('第三版。'),
        expected: { recordVersion: 2, recordHash: second.recordHash },
        sourceRef: { kind: 'action', id: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e99' },
      }),
    );
    expect(third.git.upstreamRevision).toBe(second.git.commit);
    expect(third.git.unpushed).toBe(true);
    h.store.close();
  });

  it('leaves the branch untouched when the integration lock is held by a delivery', () => {
    const h = harness();
    const held = h.lock.acquire({ ownerAttemptId: 'delivery-attempt-1', epoch: 1 });
    expect(held.acquired).toBe(true);
    expect(h.lock.resource).toBe(integrationLockResource(h.projectId));

    // The requirement save and the code delivery contend for the *same* resource.
    const busy = requireRefused(
      h.service.save({
        operationId: 'op-locked',
        metadata: metadataDraft(),
        contentMarkdown: body(),
        expected: { expectedAbsent: true },
        sourceRef: { kind: 'action', id: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e99' },
      }),
    );
    expect(busy.code).toBe('BUSY');
    expect(busy.branchUntouched).toBe(true);
    expect(busy.message).toContain('delivery-attempt-1');
    expect(refHead(h.repo)).toBe(h.baseRevision);
    expect(h.store.requirements.list()).toEqual([]);

    // Once the delivery releases the lock the same save goes through.
    expect(h.lock.release('delivery-attempt-1', 1)).toBe(true);
    const saved = requireSaved(
      h.service.save({
        operationId: 'op-locked',
        metadata: metadataDraft(),
        contentMarkdown: body(),
        expected: { expectedAbsent: true },
        sourceRef: { kind: 'action', id: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e99' },
      }),
    );
    expect(saved.git.commit).not.toBe(h.baseRevision);
    expect(commitCount(h.repo)).toBe(2);
    h.store.close();
  });

  it('refuses a second create for the same id and writes nothing', () => {
    const h = harness();
    const first = requireSaved(
      h.service.save({
        operationId: 'op-create-1',
        metadata: metadataDraft(),
        contentMarkdown: body(),
        expected: { expectedAbsent: true },
        sourceRef: { kind: 'action', id: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e99' },
      }),
    );
    const conflict = requireRefused(
      h.service.save({
        operationId: 'op-create-2',
        metadata: metadataDraft({ version: 1 }),
        contentMarkdown: body('第二次创建。'),
        expected: { expectedAbsent: true },
        sourceRef: { kind: 'action', id: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e99' },
      }),
    );
    expect(conflict.code).toBe('REQUIREMENT_CONFLICT');
    expect(conflict.branchUntouched).toBe(true);
    expect(conflict.operation?.kind).toBe('requirement.save.retry');
    expect(refHead(h.repo)).toBe(first.git.commit);
    expect(commitCount(h.repo)).toBe(2);
    h.store.close();
  });

  it('updates an existing record with a new version and includes both records in the pool', () => {
    const h = harness();
    const first = requireSaved(
      h.service.save({
        operationId: 'op-update-1',
        metadata: metadataDraft(),
        contentMarkdown: body(),
        expected: { expectedAbsent: true },
        sourceRef: { kind: 'action', id: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e99' },
      }),
    );
    const second = requireSaved(
      h.service.save({
        operationId: 'op-update-2',
        metadata: metadataDraft({ version: 2, title: '未付款订单可取消（修订）' }),
        contentMarkdown: body('修订后的背景说明。'),
        expected: { recordVersion: 1, recordHash: first.recordHash },
        sourceRef: { kind: 'action', id: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e99' },
      }),
    );
    expect(second.recordVersion).toBe(2);
    expect(second.recordHash).not.toBe(first.recordHash);
    expect(second.projection.verdict).toBe('update');
    // A second record in the pool does not disturb the first (`AC-091`).
    const third = requireSaved(
      h.service.save({
        operationId: 'op-update-3',
        metadata: metadataDraft({ id: SECOND_ID, version: 1, title: '第二条需求' }),
        contentMarkdown: body('第二条。'),
        expected: { expectedAbsent: true },
        sourceRef: { kind: 'action', id: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e99' },
      }),
    );
    const pool = readRequirementPoolAtRevision({
      git: gitReader,
      repoRoot: h.repo,
      revision: third.git.commit,
    });
    expect(pool.records.map((record) => record.id)).toEqual([REQUIREMENT_ID, SECOND_ID]);
    expect(pool.records[0]?.recordHash).toBe(second.recordHash);
    expect(pool.records[0]?.version).toBe(2);
    h.store.close();
  });
});

describe('requirement save failure and retry (AC-090)', () => {
  it('hands back the original operation when the baseline moved, and retries onto it', () => {
    const h = harness();
    // Another server moves the delivery branch between the save's read and its
    // compare-and-swap: the CAS must refuse and the branch must stay where the other
    // writer put it.
    const otherRevision = commitCorruptedRecord({
      repo: h.repo,
      baseRevision: h.baseRevision,
      id: SECOND_ID,
      version: 1,
    });
    const failed = requireRefused(
      h.service.save({
        operationId: 'op-cas-fail',
        metadata: metadataDraft({ id: SECOND_ID, version: 1 }),
        contentMarkdown: body(),
        expected: { expectedAbsent: true },
        sourceRef: { kind: 'action', id: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e99' },
      }),
    );
    expect(failed.code).toBe('REQUIREMENT_CONFLICT');
    expect(failed.branchUntouched).toBe(true);
    expect(failed.operation?.operationId).toBe('op-cas-fail');
    expect(failed.operation?.kind).toBe('requirement.save.retry');
    expect(failed.operation?.repairOnly).toBe(false);
    expect(refHead(h.repo)).toBe(otherRevision);
    expect(commitCount(h.repo)).toBe(2);

    // The explicit repair retry proceeds onto the repaired Git state.
    const retried = requireSaved(
      h.service.retry({
        operationId: 'op-recovered',
        metadata: metadataDraft({ id: SECOND_ID, version: 1 }),
        contentMarkdown: body(),
        expected: { expectedAbsent: true },
        explicitRepair: true,
        sourceRef: { kind: 'action', id: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e99' },
      }),
    );
    expect(retried.status).toBe('saved');
    expect(retried.git.previousCommit).toBe(otherRevision);
    expect(refHead(h.repo)).toBe(retried.git.commit);
    h.store.close();
  });

  it('reports RECOVERY_REQUIRED with a repair-only retry when the projection fails after the commit', () => {
    const h = harness();
    // Fault injection at the documented point (`AC-090`): the commit and the ref
    // update both succeeded, the projection refresh is the step that fails.
    h.store.close();

    const dataDir = makeTempDir('agentdev-save-crash-');
    const projectId = projectIdFromRoot(h.repo);
    const store = Store.open({
      dataDir,
      canonicalRoot: h.repo,
      migrations: { backup: () => undefined, backupPath: join(dataDir, 'pre.sqlite') },
    });
    store.projects.insert({
      id: projectId,
      root: h.repo,
      gitRoot: h.repo,
      codeRoot: 'src',
      documentRoot: 'docs',
      deliveryBranch: 'agentdev/main',
      trust: 'trusted',
      state: 'open',
    });
    const journal = sqliteJournal(join(dataDir, 'cas.sqlite'));
    const lock = new ProjectIntegrationLock({ projectId, leases: store.leases, now: () => TIME });
    // Git and the CAS succeed, and the *projection's* own step is the resource that
    // becomes unavailable: the commit and the ref move both stand while the local row
    // does not, which is exactly the state `AC-090`'s retry has to repair.
    const healthy = createMemoryCasEvents();
    const failing = createRequirementSaveService({
      store,
      worktrees: port,
      journal,
      events: healthy,
      lock,
      worktreeRoot: join(dataDir, 'save-worktrees'),
      now: () => TIME,
      keepWorktree: false,
    });
    // The projection write is the step that fails: the requirement row it would write
    // throws while Git and the CAS have already succeeded. The lock release and the
    // event log stay real, so only the projection is behind.
    const realRequirements = store.requirements;
    const failingRequirements = new Proxy(realRequirements, {
      get(target, property, receiver) {
        const value: unknown = Reflect.get(target, property, receiver);
        if (property === 'update' || property === 'insert') {
          return () => {
            throw new Error('projection write unavailable');
          };
        }
        return value;
      },
    });
    (store as unknown as { requirements: unknown }).requirements = failingRequirements;

    const first = failing.save({
      operationId: 'op-projection-fail',
      metadata: metadataDraft(),
      contentMarkdown: body(),
      expected: { expectedAbsent: true },
      sourceRef: { kind: 'action', id: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e99' },
    });
    expect(first.ok).toBe(false);
    if (first.ok) throw new Error('expected the projection failure');
    expect(first.code).toBe('RECOVERY_REQUIRED');
    // The commit and the ref move both happened; only the projection is behind, so the
    // refusal may not claim the branch is untouched.
    expect(first.branchUntouched).toBe(false);
    expect(first.message).toContain('投影');
    expect(first.operation?.repairOnly).toBe(true);
    expect(first.operation?.expectedRevision).toBeNull();
    expect(first.operation?.targetRevision).toBe(refHead(h.repo));
    // Git really holds the commit and the branch really moved.
    const committed = refHead(h.repo);
    expect(committed).not.toBe(h.baseRevision);
    expect(commitCount(h.repo)).toBe(2);
    expect(first.operation?.targetRevision).toBe(committed);
    expect(refHead(h.repo)).toBe(committed);

    // Restore the projection repository: the retry repairs only the projection.
    (store as unknown as { requirements: unknown }).requirements = realRequirements;
    const repairService = createRequirementSaveService({
      store,
      worktrees: port,
      journal,
      events: healthy,
      lock,
      worktreeRoot: join(dataDir, 'save-worktrees'),
      now: () => TIME,
      keepWorktree: false,
    });
    const repaired = requireSaved(
      repairService.retry({
        operationId: 'op-projection-fail',
        metadata: metadataDraft(),
        contentMarkdown: body(),
        expected: { expectedAbsent: true },
        sourceRef: { kind: 'action', id: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e99' },
      }),
    );
    expect(repaired.status).toBe('projection_repaired');
    expect(repaired.reusedCommit).toBe(true);
    expect(repaired.git.createdCommit).toBe(false);
    expect(repaired.git.commit).toBe(committed);
    expect(repaired.projection.repaired).toBe(true);
    expect(refHead(h.repo)).toBe(committed);
    expect(commitCount(h.repo)).toBe(2);
    expect(repaired.row.portableRef.hash).toBe(repaired.recordHash);
    expect(repaired.row.portableRef.revision).toBe(committed);

    // Replaying the repaired operation is idempotent: the same commit, the same
    // record hash, and no fresh Git work. The caller now holds the projected
    // version, so the replay names it instead of declaring the record absent.
    const again = requireSaved(
      repairService.retry({
        operationId: 'op-projection-fail',
        metadata: metadataDraft(),
        contentMarkdown: body(),
        expected: { recordVersion: repaired.recordVersion, recordHash: repaired.recordHash },
        sourceRef: { kind: 'action', id: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e99' },
      }),
    );
    expect(again.status).toBe('projection_repaired');
    expect(again.git.commit).toBe(committed);
    expect(again.recordHash).toBe(repaired.recordHash);
    expect(commitCount(h.repo)).toBe(2);
    store.close();
  });
});

/**
 * "Another server" commits one record pair and moves the delivery ref **without**
 * refreshing the delivery working tree (`W8R1-02/03`).
 *
 * That is the real state after a fetch/other clone lands on a branch this checkout
 * has not switched to: the ref (and therefore the pool a save must compare against)
 * is ahead of the bytes on disk. Nothing is written back to `repoRoot`.
 */
function commitRemoteRecord(input: {
  readonly repo: string;
  readonly baseRevision: string;
  readonly id: string;
  readonly version: number;
  readonly body: string;
}): string {
  const worktree = detachedWorktree(
    input.repo,
    `remote-${input.id.slice(0, 8)}-${String(input.version)}`,
    input.baseRevision,
  );
  const recordPath = `.agentdev/requirements/${input.id}`;
  const contentMarkdown = normalizeContentMarkdown(
    `<!-- record-version: ${String(input.version)} -->\n# body\n\n${input.body}\n`,
  );
  const metadataJson = `${JSON.stringify(
    {
      schemaVersion: 1,
      id: input.id,
      version: input.version,
      contentFile: 'content.md',
      contentHash: sha256Hex(contentMarkdown),
      createdAt: TIME,
      updatedAt: TIME,
      title: 'other server',
      goal: 'other server',
      scope: { readPaths: [], writePaths: [], operations: ['edit'], networkTargets: [] },
      lifecycle: 'queued',
      featureIds: [],
      acceptance: [],
      openQuestions: [],
      confirmedDecisions: [],
      relatedRequirementIds: [],
    },
    null,
    2,
  )}\n`;
  writeFileAt(worktree, `${recordPath}/requirement.json`, metadataJson);
  writeFileAt(worktree, `${recordPath}/content.md`, contentMarkdown);
  writeFileAt(worktree, REQUIREMENTS_README, '# 需求池索引\n');
  const committed = requireValue<{ revision: string }>(
    port.commitPaths(worktree, 'doc(requirement): other server', [
      `${recordPath}/requirement.json`,
      `${recordPath}/content.md`,
      REQUIREMENTS_README,
    ]),
    'commit remote record',
  );
  requireValue(
    port.updateRef({
      repoRoot: input.repo,
      ref: DELIVERY_REF,
      newRevision: committed.revision,
      expectedOldRevision: input.baseRevision,
    }),
    'update-ref for the other server commit',
  );
  return committed.revision;
}

describe('stale projection refuses to overwrite (AC-093)', () => {
  it('refuses a same-version record whose body another server changed', () => {
    const h = harness();
    const first = requireSaved(
      h.service.save({
        operationId: 'op-stale-1',
        metadata: metadataDraft(),
        contentMarkdown: body(),
        expected: { expectedAbsent: true },
        sourceRef: { kind: 'action', id: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e99' },
      }),
    );
    expect(h.store.requirements.find(REQUIREMENT_ID)?.portableRef.hash).toBe(first.recordHash);

    // Another server commits a *different* directory for the same recordVersion.
    const otherRevision = commitCorruptedRecord({
      repo: h.repo,
      baseRevision: first.git.commit,
      id: REQUIREMENT_ID,
      version: 1,
    });
    expect(refHead(h.repo)).toBe(otherRevision);

    const refused = requireRefused(
      h.service.save({
        operationId: 'op-stale-2',
        metadata: metadataDraft({ version: 2, title: '本机修订' }),
        contentMarkdown: body('本机修订。'),
        expected: { recordVersion: 1, recordHash: first.recordHash },
        sourceRef: { kind: 'action', id: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e99' },
      }),
    );
    expect(refused.code).toBe('REQUIREMENT_CONFLICT');
    expect(refused.branchUntouched).toBe(true);
    expect(refused.message).toContain('拒绝覆盖');
    // Nothing was written: the branch did not move and the projection is untouched.
    expect(refHead(h.repo)).toBe(otherRevision);
    expect(commitCount(h.repo)).toBe(3);
    expect(h.store.requirements.find(REQUIREMENT_ID)?.portableRef.hash).toBe(first.recordHash);
    expect(refused.operation?.kind).toBe('requirement.save.retry');

    // An explicit repair retry proceeds onto the repaired Git state, and the new
    // commit carries the repaired record as the latest pool content.
    const repaired = requireSaved(
      h.service.retry({
        operationId: 'op-stale-3',
        metadata: metadataDraft({ version: 2, title: '本机修订' }),
        contentMarkdown: body('本机修订。'),
        expected: { recordVersion: 1, recordHash: first.recordHash },
        explicitRepair: true,
        sourceRef: { kind: 'action', id: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e99' },
      }),
    );
    expect(repaired.recordVersion).toBe(2);
    expect(repaired.git.commit).not.toBe(otherRevision);
    const pool = readRequirementPoolAtRevision({
      git: gitReader,
      repoRoot: h.repo,
      revision: repaired.git.commit,
    });
    expect(pool.records[0]?.version).toBe(2);
    expect(pool.records[0]?.recordHash).toBe(repaired.recordHash);
    h.store.close();
  });

  it('refuses a create when Git already holds a record the projection does not know', () => {
    const h = harness();
    const otherRevision = commitCorruptedRecord({
      repo: h.repo,
      baseRevision: h.baseRevision,
      id: SECOND_ID,
      version: 1,
    });
    const refused = requireRefused(
      h.service.save({
        operationId: 'op-import-conflict',
        metadata: metadataDraft({ id: SECOND_ID, version: 1 }),
        contentMarkdown: body('本机新建。'),
        expected: { expectedAbsent: true },
        sourceRef: { kind: 'action', id: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e99' },
      }),
    );
    expect(refused.code).toBe('REQUIREMENT_CONFLICT');
    expect(refused.message).toContain('已存在');
    expect(refHead(h.repo)).toBe(otherRevision);
    expect(h.store.requirements.list()).toEqual([]);
    h.store.close();
  });

  it('refuses a stale local expectation when it cannot satisfy the projection version', () => {
    const h = harness();
    const first = requireSaved(
      h.service.save({
        operationId: 'op-version-1',
        metadata: metadataDraft(),
        contentMarkdown: body(),
        expected: { expectedAbsent: true },
        sourceRef: { kind: 'action', id: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e99' },
      }),
    );
    // The caller's expectedVersion is the local row's own version; a caller that
    // names another one is refused before Git is touched at all.
    const refused = requireRefused(
      h.service.save({
        operationId: 'op-version-2',
        metadata: metadataDraft({ version: 5, title: '越过版本' }),
        contentMarkdown: body('跳过版本。'),
        expected: { recordVersion: 5, recordHash: first.recordHash },
        sourceRef: { kind: 'action', id: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e99' },
      }),
    );
    expect(refused.code).toBe('VERSION_CONFLICT');
    expect(refused.branchUntouched).toBe(true);
    expect(refHead(h.repo)).toBe(first.git.commit);
    h.store.close();
  });

  it('reads the pool at the delivery ref, never the stale working tree (W8R1-02)', () => {
    const h = harness();
    const first = requireSaved(
      h.service.save({
        operationId: 'op-stale-worktree-1',
        metadata: metadataDraft(),
        contentMarkdown: body(),
        expected: { expectedAbsent: true },
        sourceRef: { kind: 'action', id: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e99' },
      }),
    );
    // The other server moves the ref to v2; the checked-out bytes stay at v1.
    const remoteRevision = commitRemoteRecord({
      repo: h.repo,
      baseRevision: first.git.commit,
      id: REQUIREMENT_ID,
      version: 2,
      body: '其他服务器的 v2 正文。',
    });
    expect(refHead(h.repo)).toBe(remoteRevision);
    expect(readFileSync(join(h.repo, `${first.recordPath}/content.md`), 'utf8')).not.toContain(
      '其他服务器的 v2 正文。',
    );
    const commitsBefore = commitCount(h.repo);

    const refused = requireRefused(
      h.service.save({
        operationId: 'op-stale-worktree-2',
        metadata: metadataDraft({ version: 2, title: '本机 v2' }),
        contentMarkdown: body('本机 v2 正文。'),
        expected: { recordVersion: 1, recordHash: first.recordHash },
        sourceRef: { kind: 'action', id: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e99' },
      }),
    );
    expect(refused.code).toBe('REQUIREMENT_CONFLICT');
    expect(refused.branchUntouched).toBe(true);
    expect(refused.message).toContain('已前进');
    // The stale projection did not overwrite the newer record: the branch still
    // carries v2 and no commit was created.
    expect(refHead(h.repo)).toBe(remoteRevision);
    expect(commitCount(h.repo)).toBe(commitsBefore);
    const pool = readRequirementPoolAtRevision({
      git: gitReader,
      repoRoot: h.repo,
      revision: remoteRevision,
    });
    expect(pool.records[0]?.version).toBe(2);
    expect(pool.records[0]?.contentMarkdown).toContain('其他服务器的 v2 正文。');
    h.store.close();
  });

  it('reports a HEAD-only record as a per-record conflict instead of an ENOENT (W8R1-03)', () => {
    const h = harness();
    const first = requireSaved(
      h.service.save({
        operationId: 'op-head-only-1',
        metadata: metadataDraft(),
        contentMarkdown: body(),
        expected: { expectedAbsent: true },
        sourceRef: { kind: 'action', id: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e99' },
      }),
    );
    // Another server adds SECOND_ID and moves the ref; this working tree never sees
    // the file, so a working-tree read would raise ENOENT for it.
    const remoteRevision = commitRemoteRecord({
      repo: h.repo,
      baseRevision: first.git.commit,
      id: SECOND_ID,
      version: 1,
      body: 'HEAD 独有记录。',
    });
    expect(existsSync(join(h.repo, `.agentdev/requirements/${SECOND_ID}/requirement.json`))).toBe(
      false,
    );
    expect(refHead(h.repo)).toBe(remoteRevision);

    // No exception escapes `save()`; the caller sees the precise per-record conflict.
    const outcome = h.service.save({
      operationId: 'op-head-only-2',
      metadata: metadataDraft({ id: SECOND_ID, version: 1 }),
      contentMarkdown: body('本机新建。'),
      expected: { expectedAbsent: true },
      sourceRef: { kind: 'action', id: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e99' },
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('expected a refusal');
    expect(outcome.code).toBe('REQUIREMENT_CONFLICT');
    expect(outcome.message).toContain(`.agentdev/requirements/${SECOND_ID}`);
    expect(outcome.branchUntouched).toBe(true);
    expect(refHead(h.repo)).toBe(remoteRevision);
    h.store.close();
  });

  it('returns a structured INTERNAL_ERROR when the committed blob cannot be read (W8R1-03)', () => {
    const h = harness();
    const first = requireSaved(
      h.service.save({
        operationId: 'op-unreadable-blob-1',
        metadata: metadataDraft(),
        contentMarkdown: body(),
        expected: { expectedAbsent: true },
        sourceRef: { kind: 'action', id: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e99' },
      }),
    );
    // A port whose committed-blob reader fails: the comparison must report that
    // instead of letting the error escape the save API.
    const failing = Object.create(port) as WorktreeGitPort;
    failing.readBlob = () => ({
      ok: false,
      errors: [{ code: 'INTERNAL_ERROR', message: 'injected blob read failure', path: h.repo }],
    });
    const broken = createRequirementSaveService({
      store: h.store,
      worktrees: failing,
      journal: sqliteJournal(join(h.dataDir, 'unreadable.sqlite')),
      events: createMemoryCasEvents(),
      lock: new ProjectIntegrationLock({
        projectId: h.projectId,
        leases: h.store.leases,
        now: () => TIME,
      }),
      worktreeRoot: join(h.dataDir, 'unreadable-worktrees'),
      now: () => TIME,
      keepWorktree: false,
    });

    const outcome = broken.save({
      operationId: 'op-unreadable-blob-2',
      metadata: metadataDraft({ version: 2, title: '读不到 blob' }),
      contentMarkdown: body('读不到 blob。'),
      expected: { recordVersion: 1, recordHash: first.recordHash },
      sourceRef: { kind: 'action', id: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e99' },
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('expected a refusal');
    expect(outcome.code).toBe('INTERNAL_ERROR');
    expect(outcome.message).toContain('读取 Git blob 失败');
    expect(outcome.message).toContain(`${first.recordPath}/requirement.json`);
    expect(outcome.branchUntouched).toBe(true);
    expect(refHead(h.repo)).toBe(first.git.commit);
    h.store.close();
  });
});

describe('requirement save versus code delivery (AC-091)', () => {
  it('carries the latest requirement pool into a code integration built on an older baseline', () => {
    const h = harness();
    // The Task starts from the seed baseline and changes only code.
    const taskWorktree = detachedWorktree(h.repo, 'task-old-baseline', h.baseRevision);
    writeFileAt(taskWorktree, 'src/orders.ts', 'export const orders = ["cancel"];\n');
    const taskRevision = requireValue<{ revision: string }>(
      port.commitPaths(taskWorktree, 'feat: cancel unpaid orders', ['src/orders.ts']),
      'task commit',
    ).revision;

    // A requirement is saved after the Task was cut, so the delivery baseline moves.
    const saved = requireSaved(
      h.service.save({
        operationId: 'op-concurrent-save',
        metadata: metadataDraft(),
        contentMarkdown: body(),
        expected: { expectedAbsent: true },
        sourceRef: { kind: 'action', id: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e99' },
      }),
    );
    expect(saved.git.commit).not.toBe(h.baseRevision);

    // The delivery is integrated at the *current* baseline, so the latest pool is
    // read at that revision and travels with the new code commit.
    const pool = readRequirementPoolAtRevision({
      git: gitReader,
      repoRoot: h.repo,
      revision: saved.git.commit,
    });
    const requirementPool = requirementPoolCommitsOf(pool.records);
    const integrationWorktree = detachedWorktree(h.repo, 'integration', saved.git.commit);
    const integrated = runIntegration({
      git: port,
      repoRoot: h.repo,
      cas: createCasService({
        git: port,
        journal: sqliteJournal(join(h.dataDir, 'integration.sqlite')),
        events: createMemoryCasEvents(),
      }),
      lock: h.lock,
      projectId: h.projectId,
      worktreePath: integrationWorktree,
      operationId: 'op-integrate-concurrent',
      ref: DELIVERY_REF,
      targetRevision: saved.git.commit,
      tasks: [
        {
          taskId: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e80',
          dependsOn: [],
          revision: taskRevision,
          dependencyRevision: h.baseRevision,
        },
      ],
      workId: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e81',
      requirementId: REQUIREMENT_ID,
      requirementPool,
    });
    if (!integrated.ok) {
      throw new Error(`integration failed: ${integrated.code}`);
    }
    expect(integrated.outcome).toBe('integrated');
    expect(integrated.revision).not.toBe(saved.git.commit);

    // The new code commit contains the code change *and* the latest requirement pool.
    expect(
      requireValue<boolean>(
        port.pathAtRevision(h.repo, integrated.revision, 'src/orders.ts'),
        'code path',
      ),
    ).toBe(true);
    expect(
      requireValue<boolean>(
        port.pathAtRevision(h.repo, integrated.revision, `${saved.recordPath}/requirement.json`),
        'requirement path',
      ),
    ).toBe(true);
    const integratedMetadata = requireValue<string | null>(
      gitShow(h.repo, integrated.revision, `${saved.recordPath}/requirement.json`),
      'git show integrated requirement.json',
    );
    expect(sha256Hex(integratedMetadata ?? '')).toBe(saved.metadataHash);
    expect(refHead(h.repo)).toBe(integrated.revision);

    // The completion record must bind this settlement, and a metadata-only save is
    // not code verification (`AC-091`).
    const finalTree = requireValue<string | null>(
      port.mergeTree(h.repo, integrated.revision),
      'final tree',
    );
    const settlement = {
      finalRevision: integrated.revision,
      codeTree: finalTree ?? '',
      updatedDocs: [],
      unresolved: [],
    };
    const completion = {
      completedAt: TIME,
      summary: '需求随代码交付',
      codeRevision: integrated.revision,
      codeTree: finalTree ?? '',
      featureIds: [],
      verificationSummary: 'Review + Test 通过',
      remainingIssues: [],
    };
    const manifest = {
      id: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e82',
      workId: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e81',
      kind: 'integration' as const,
      codeRevision: integrated.revision,
      codeTree: finalTree ?? '',
      acceptanceIds: ['AC-091'],
      valid: true,
    };
    const accepted = checkCompletionSettlementForTest({
      finalRevision: integrated.revision,
      finalTree: finalTree ?? '',
      settlement,
      completion,
      manifest,
      // The delivery's own change set: code plus requirement metadata.
      changedPaths: [
        { path: 'src/orders.ts', change: 'modified' as const },
        { path: `${saved.recordPath}/requirement.json`, change: 'added' as const },
        { path: `${saved.recordPath}/content.md`, change: 'added' as const },
        { path: REQUIREMENTS_README, change: 'modified' as const },
      ],
      codeStartRevision: h.baseRevision,
    });
    expect(accepted.ok).toBe(true);

    // The same completion record over a metadata-only change is refused.
    const metadataOnly = checkCompletionSettlementForTest({
      finalRevision: integrated.revision,
      finalTree: finalTree ?? '',
      settlement,
      completion,
      manifest,
      changedPaths: [
        { path: `${saved.recordPath}/requirement.json`, change: 'modified' as const },
        { path: `${saved.recordPath}/content.md`, change: 'modified' as const },
      ],
      codeStartRevision: h.baseRevision,
    });
    expect(metadataOnly.ok).toBe(false);
    if (metadataOnly.ok) throw new Error('expected a refusal');
    expect(metadataOnly.metadataOnly).toBe(true);

    // Exactly one requirement save commit and one integration commit exist.
    expect(h.store.requirements.find(REQUIREMENT_ID)?.portableRef.revision).toBe(saved.git.commit);
    h.store.close();
  });

  it('serializes a save and a delivery through the same integration lock (W8R2-02)', () => {
    const h = harness();
    const taskWorktree = detachedWorktree(h.repo, 'task-serialized', h.baseRevision);
    writeFileAt(taskWorktree, 'src/orders.ts', 'export const orders = ["a"];\n');
    const taskRevision = requireValue<{ revision: string }>(
      port.commitPaths(taskWorktree, 'feat: serialized', ['src/orders.ts']),
      'task commit',
    ).revision;

    // The delivery takes the lock first.
    const delivery = h.lock.acquire({ ownerAttemptId: 'delivery-1', epoch: 1 });
    expect(delivery.acquired).toBe(true);
    const busy = requireRefused(
      h.service.save({
        operationId: 'op-serialized-save',
        metadata: metadataDraft(),
        contentMarkdown: body(),
        expected: { expectedAbsent: true },
        sourceRef: { kind: 'action', id: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e99' },
      }),
    );
    expect(busy.code).toBe('BUSY');

    // `W8R2-02`: the *delivery path itself* must contend for the same lock, so while
    // the lock is held it is refused before it touches the integration worktree. The
    // old expectation here asserted the opposite (the delivery integrated while the
    // lock was held), which is exactly the half-implemented mutex the review found.
    const integrationWorktree = detachedWorktree(h.repo, 'integration-serialized', h.baseRevision);
    const refusedDelivery = runIntegration({
      git: port,
      repoRoot: h.repo,
      cas: createCasService({
        git: port,
        journal: sqliteJournal(join(h.dataDir, 'serialized.sqlite')),
        events: createMemoryCasEvents(),
      }),
      lock: h.lock,
      projectId: h.projectId,
      worktreePath: integrationWorktree,
      operationId: 'op-integration-serialized',
      ref: DELIVERY_REF,
      targetRevision: h.baseRevision,
      tasks: [
        {
          taskId: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e83',
          dependsOn: [],
          revision: taskRevision,
          dependencyRevision: h.baseRevision,
        },
      ],
      workId: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e84',
    });
    expect(refusedDelivery.ok).toBe(false);
    if (refusedDelivery.ok) throw new Error('expected the held lock to refuse the delivery');
    expect(refusedDelivery.code).toBe('BUSY');
    expect(refusedDelivery.branchUntouched).toBe(true);
    expect(refHead(h.repo)).toBe(h.baseRevision);

    // The release path: once the holder releases, the very same delivery integrates
    // and takes the lock itself.
    expect(h.lock.release('delivery-1', 1)).toBe(true);
    const integrated = runIntegration({
      git: port,
      repoRoot: h.repo,
      cas: createCasService({
        git: port,
        journal: sqliteJournal(join(h.dataDir, 'serialized.sqlite')),
        events: createMemoryCasEvents(),
      }),
      lock: h.lock,
      projectId: h.projectId,
      worktreePath: integrationWorktree,
      operationId: 'op-integration-serialized',
      ref: DELIVERY_REF,
      targetRevision: h.baseRevision,
      tasks: [
        {
          taskId: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e83',
          dependsOn: [],
          revision: taskRevision,
          dependencyRevision: h.baseRevision,
        },
      ],
      workId: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e84',
    });
    if (!integrated.ok) throw new Error(`integration failed: ${integrated.code}`);
    // The delivery released the lock on success, so the save can take it next.
    expect(h.lock.release('delivery-1', 1)).toBe(false);

    // Now the save proceeds on the *new* baseline, so the requirement is not lost.
    const saved = requireSaved(
      h.service.save({
        operationId: 'op-serialized-save',
        metadata: metadataDraft(),
        contentMarkdown: body(),
        expected: { expectedAbsent: true },
        sourceRef: { kind: 'action', id: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e99' },
      }),
    );
    expect(saved.git.previousCommit).toBe(integrated.revision);
    expect(
      requireValue<boolean>(
        port.pathAtRevision(h.repo, saved.git.commit, 'src/orders.ts'),
        'code path after save',
      ),
    ).toBe(true);
    // The code commit itself is still in the history the save built on.
    const ancestry = requireValue<boolean>(
      port.isAncestor(h.repo, integrated.revision, saved.git.commit),
      'is-ancestor',
    );
    expect(ancestry).toBe(true);
    h.store.close();
  });
});

// ---------------------------------------------------------------------------
// Crash recovery and the delivery working copy (W8R2-01/05/06)
// ---------------------------------------------------------------------------

/** A code-delivery commit for `files`, installed on the delivery ref. */
function commitCodeDelivery(input: {
  readonly repo: string;
  readonly baseRevision: string;
  readonly name: string;
  readonly files: Readonly<Record<string, string>>;
}): string {
  const worktree = detachedWorktree(input.repo, input.name, input.baseRevision);
  for (const [path, content] of Object.entries(input.files)) writeFileAt(worktree, path, content);
  const committed = requireValue<{ revision: string }>(
    port.commitPaths(worktree, `feat: ${input.name}`, Object.keys(input.files)),
    `commit ${input.name}`,
  );
  requireValue(
    port.updateRef({
      repoRoot: input.repo,
      ref: DELIVERY_REF,
      newRevision: committed.revision,
      expectedOldRevision: input.baseRevision,
    }),
    `update-ref ${input.name}`,
  );
  return committed.revision;
}

/**
 * A port that fails the first `update-ref` for the delivery ref — the documented
 * "crash between journaling the commit and swapping the ref" window
 * (`reliability.md` §5, `W8R2-05`).
 */
function portCrashingBeforeSwap(repo: string): WorktreeGitPort {
  const crashing = Object.create(port) as WorktreeGitPort;
  let crashed = false;
  crashing.updateRef = (request) => {
    if (!crashed && request.ref === DELIVERY_REF) {
      crashed = true;
      return {
        ok: false,
        errors: [
          { code: 'INTERNAL_ERROR', message: 'injected crash before the ref swap', path: repo },
        ],
      };
    }
    return port.updateRef(request);
  };
  return crashing;
}

describe('requirement save crash recovery and working copy (W8R2-01/05/06)', () => {
  it('never reuses a save worktree parked at another base (W8R2-01)', () => {
    const h = harness();
    const operationId = 'op-crash-stale-worktree';
    const saveWorktree = join(h.worktreeRoot, operationId);
    // The residue a crashed attempt leaves behind: a detached worktree still parked at
    // the *old* base. The old code reused it by path alone and committed from there.
    requireValue(
      port.addWorktree({ repoRoot: h.repo, path: saveWorktree, baseRevision: h.baseRevision }),
      'leftover save worktree',
    );
    // Meanwhile a code delivery integrates on the branch.
    const delivered = commitCodeDelivery({
      repo: h.repo,
      baseRevision: h.baseRevision,
      name: 'delivery-advance',
      files: { 'src/orders.ts': 'export const orders = ["delivery"];\n' },
    });
    expect(refHead(h.repo)).toBe(delivered);

    const saved = requireSaved(
      h.service.save({
        operationId,
        metadata: metadataDraft(),
        contentMarkdown: body(),
        expected: { expectedAbsent: true },
        sourceRef: { kind: 'action', id: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e99' },
      }),
    );
    // FALSIFY (W8R2-01): the delivery commit must still be an ancestor and its code
    // must survive; the branch may not jump back to the old base.
    expect(
      requireValue<boolean>(port.isAncestor(h.repo, delivered, saved.git.commit), 'ancestry'),
    ).toBe(true);
    expect(refHead(h.repo)).toBe(saved.git.commit);
    expect(
      requireValue<string | null>(port.readBlob(h.repo, saved.git.commit, 'src/orders.ts'), 'code'),
    ).toBe('export const orders = ["delivery"];\n');
    // seed + delivery + save
    expect(commitCount(h.repo)).toBe(3);
    h.store.close();
  });

  it('installs the journaled commit exactly once after a crash before the ref swap (W8R2-05)', () => {
    const h = harness();
    const operationId = 'op-crash-before-swap';
    const original = {
      operationId,
      metadata: metadataDraft(),
      contentMarkdown: body('崩溃前写好的正文。'),
      expected: { expectedAbsent: true },
      sourceRef: { kind: 'action' as const, id: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e99' },
    };
    const crashingService = createRequirementSaveService({
      store: h.store,
      worktrees: portCrashingBeforeSwap(h.repo),
      journal: h.journal,
      events: h.events,
      lock: h.lock,
      worktreeRoot: h.worktreeRoot,
      now: () => TIME,
      keepWorktree: false,
    });

    const failed = requireRefused(crashingService.save(original));
    expect(failed.code).toBe('INTERNAL_ERROR');
    expect(failed.branchUntouched).toBe(true);
    expect(refHead(h.repo)).toBe(h.baseRevision);
    // The crash landed *after* the journal recorded the commit: the ref never moved.
    const journal = h.journal.load(operationId);
    expect(journal?.state).toBe('pending');
    const recorded = journal?.targetRevision ?? '';
    expect(recorded).not.toBe('');

    // Same body, same operationId: the retry installs the *recorded* commit.
    const retried = requireSaved(h.service.retry(original));
    expect(retried.status).toBe('saved');
    expect(refHead(h.repo)).toBe(recorded);
    expect(commitCount(h.repo)).toBe(2);
    expect(h.journal.load(operationId)?.state).toBe('completed');
    expect(h.events.appended.filter((event) => event.operationId === operationId)).toHaveLength(1);
    expect(retried.row.portableRef.revision).toBe(recorded);
    // The installed commit carries exactly the bytes this body prepared.
    const committedMetadata = requireValue<string | null>(
      port.readBlob(h.repo, recorded, `${retried.recordPath}/requirement.json`),
      'committed metadata',
    );
    expect(sha256Hex(committedMetadata ?? '')).toBe(retried.metadataHash);

    // Replaying is projection repair only: no second commit and no second event.
    const replay = requireSaved(
      h.service.retry({
        ...original,
        expected: { recordVersion: retried.recordVersion, recordHash: retried.recordHash },
      }),
    );
    expect(replay.status).toBe('projection_repaired');
    expect(replay.git.commit).toBe(recorded);
    expect(commitCount(h.repo)).toBe(2);
    expect(h.events.appended.filter((event) => event.operationId === operationId)).toHaveLength(1);
    h.store.close();
  });

  it('reports a precise conflict when the retried body differs from the journaled commit (W8R2-05)', () => {
    const h = harness();
    const operationId = 'op-crash-before-swap-changed';
    const original = {
      operationId,
      metadata: metadataDraft(),
      contentMarkdown: body('崩溃前写好的正文。'),
      expected: { expectedAbsent: true },
      sourceRef: { kind: 'action' as const, id: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e99' },
    };
    const crashingService = createRequirementSaveService({
      store: h.store,
      worktrees: portCrashingBeforeSwap(h.repo),
      journal: h.journal,
      events: h.events,
      lock: h.lock,
      worktreeRoot: h.worktreeRoot,
      now: () => TIME,
      keepWorktree: false,
    });
    expect(requireRefused(crashingService.save(original)).code).toBe('INTERNAL_ERROR');
    const recorded = h.journal.load(operationId)?.targetRevision ?? '';

    // A changed body cannot be installed under the same operationId, and the refusal
    // names exactly why instead of leaving the operation permanently stuck.
    const changed = requireRefused(
      h.service.retry({ ...original, contentMarkdown: body('另一份正文。') }),
    );
    expect(changed.code).toBe('IDEMPOTENCY_CONFLICT');
    expect(changed.message).toContain('recordHash');
    expect(changed.message).toContain(recorded);
    expect(changed.message).toContain('operationId');
    expect(changed.branchUntouched).toBe(true);
    expect(refHead(h.repo)).toBe(h.baseRevision);
    expect(commitCount(h.repo)).toBe(1);

    // The original body still installs the recorded commit, so the operation is not
    // permanently stuck.
    const recovered = requireSaved(h.service.retry(original));
    expect(recovered.status).toBe('saved');
    expect(refHead(h.repo)).toBe(recorded);
    expect(commitCount(h.repo)).toBe(2);
    h.store.close();
  });

  it('refuses to overwrite uncommitted local edits in the delivery working tree (W8R2-06)', () => {
    const h = harness();
    const first = requireSaved(
      h.service.save({
        operationId: 'op-dirty-v1',
        metadata: metadataDraft(),
        contentMarkdown: body('第一版。'),
        expected: { expectedAbsent: true },
        sourceRef: { kind: 'action', id: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e99' },
      }),
    );
    const contentPath = join(h.repo, first.recordPath, 'content.md');
    const edited = '# 本地未提交的正文（不得被静默覆盖）\n';
    writeFileSync(contentPath, edited, 'utf8');

    const second = requireRefused(
      h.service.save({
        operationId: 'op-dirty-v2',
        metadata: metadataDraft({ version: 2, title: '第二版' }),
        contentMarkdown: body('第二版。'),
        expected: { recordVersion: 1, recordHash: first.recordHash },
        sourceRef: { kind: 'action', id: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e99' },
      }),
    );
    // FALSIFY (W8R2-06): the local edit must survive; the old code replaced it with
    // the committed bytes and still reported `saved`.
    expect(second.code).toBe('RECOVERY_REQUIRED');
    expect(second.branchUntouched).toBe(false);
    expect(second.operation?.repairOnly).toBe(true);
    expect(second.message).toContain(`${first.recordPath}/content.md`);
    expect(readFileSync(contentPath, 'utf8')).toBe(edited);
    // Git did move: the committed bytes are the second version.
    const moved = refHead(h.repo);
    expect(moved).not.toBe(first.git.commit);
    expect(
      requireValue<string | null>(
        port.readBlob(h.repo, moved ?? '', `${first.recordPath}/content.md`),
        'committed',
      ),
    ).toContain('第二版');

    // Once the caller resolves the local edit, the repair-only retry writes the
    // committed bytes back.
    const baselineBytes = requireValue<string | null>(
      port.readBlob(h.repo, first.git.commit, `${first.recordPath}/content.md`),
      'baseline content',
    );
    writeFileSync(contentPath, baselineBytes ?? '', 'utf8');
    const repaired = requireSaved(
      h.service.retry({
        operationId: 'op-dirty-v2',
        metadata: metadataDraft({ version: 2, title: '第二版' }),
        contentMarkdown: body('第二版。'),
        expected: { recordVersion: 1, recordHash: first.recordHash },
        sourceRef: { kind: 'action', id: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e99' },
      }),
    );
    expect(repaired.status).toBe('projection_repaired');
    expect(readFileSync(contentPath, 'utf8')).toBe(
      requireValue<string | null>(
        port.readBlob(h.repo, repaired.git.commit, `${first.recordPath}/content.md`),
        'final content',
      ),
    );
    h.store.close();
  });
});

// ---------------------------------------------------------------------------
// Local helpers built on the public surface
// ---------------------------------------------------------------------------

function requirementPoolCommitsOf(
  records: readonly RequirementPoolRevisionRecord[],
): readonly RequirementPoolCommit[] {
  return records.map((record) => ({
    recordPath: record.recordPath,
    metadataPath: record.metadataPath,
    contentPath: record.contentPath,
    recordHash: record.recordHash,
    version: record.version,
    readmePath: REQUIREMENTS_README,
  }));
}

function checkCompletionSettlementForTest(input: {
  readonly finalRevision: string;
  readonly finalTree: string;
  readonly settlement: {
    readonly finalRevision: string;
    readonly codeTree: string;
    readonly updatedDocs: string[];
    readonly unresolved: string[];
  };
  readonly completion: {
    readonly completedAt: string;
    readonly summary: string;
    readonly codeRevision: string;
    readonly codeTree: string;
    readonly featureIds: readonly string[];
    readonly verificationSummary: string;
    readonly remainingIssues: readonly string[];
  };
  readonly manifest: {
    readonly id: string;
    readonly workId: string;
    readonly kind: 'integration';
    readonly codeRevision: string;
    readonly codeTree: string;
    readonly acceptanceIds: readonly string[];
    readonly valid: boolean;
  };
  readonly changedPaths: readonly {
    readonly path: string;
    readonly change: 'added' | 'modified' | 'deleted';
  }[];
  /**
   * The revision the change set was measured from. A null/equal-to-final revision is
   * an empty range and is now refused (`W8R1-07`), so callers pass a real start.
   */
  readonly codeStartRevision: string;
}): ReturnType<typeof checkCompletionSettlement> {
  return checkCompletionSettlement({
    work: { id: input.manifest.workId, level: 'L2' },
    route: 'code',
    completion: input.completion,
    finalRevision: input.finalRevision,
    finalTree: input.finalTree,
    settlement: input.settlement,
    verifiedManifests: [input.manifest],
    changedPaths: input.changedPaths,
    codeStartRevision: input.codeStartRevision,
  });
}

// ---------------------------------------------------------------------------
// Round-3 findings: journal identity, write-back failure, stale checkouts and the
// per-record pool conflicts (W8R3-01..03, T-03/T-05)
// ---------------------------------------------------------------------------

describe('requirement save working copy and journal identity (W8R3-01..03, T-03/T-05)', () => {
  const sourceRef = { kind: 'action' as const, id: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e99' };

  it('refuses a journaled install when the operation recorded another record (W8R3-01)', () => {
    const h = harness();
    const operationId = 'op-journal-other-record';
    const first = {
      operationId,
      metadata: metadataDraft(),
      contentMarkdown: body('记录 A 的正文。'),
      expected: { expectedAbsent: true },
      sourceRef,
    };
    const crashingService = createRequirementSaveService({
      store: h.store,
      worktrees: portCrashingBeforeSwap(h.repo),
      journal: h.journal,
      events: h.events,
      lock: h.lock,
      worktreeRoot: h.worktreeRoot,
      now: () => TIME,
      keepWorktree: false,
    });
    expect(requireRefused(crashingService.save(first)).code).toBe('INTERNAL_ERROR');
    const recorded = h.journal.load(operationId)?.targetRevision ?? '';
    expect(recorded).not.toBe('');

    // The same operationId is reused for a *different* requirement: the journaled
    // commit is not this record's, so it must never be installed under its name.
    const refused = requireRefused(
      h.service.save({
        operationId,
        metadata: metadataDraft({ id: SECOND_ID }),
        contentMarkdown: body('记录 B 的正文。'),
        expected: { expectedAbsent: true },
        sourceRef,
      }),
    );
    // FALSIFY (W8R3-01): the old hash lookup returned null for the other path, skipped
    // the check and reported `saved` while installing record A's commit.
    expect(refused.code).toBe('IDEMPOTENCY_CONFLICT');
    expect(refused.message).toContain(`.agentdev/requirements/${SECOND_ID}`);
    expect(refused.branchUntouched).toBe(true);
    expect(refHead(h.repo)).toBe(h.baseRevision);
    expect(commitCount(h.repo)).toBe(1);
    expect(h.store.requirements.find(SECOND_ID)).toBeUndefined();
    expect(h.events.appended.filter((event) => event.operationId === operationId)).toHaveLength(0);
    h.store.close();
  });

  it('reports RECOVERY_REQUIRED when the working copy write-back really fails (W8R3-02)', () => {
    const h = harness();
    const contentPath = join(h.repo, '.agentdev', 'requirements', REQUIREMENT_ID, 'content.md');
    // A directory where the committed content.md must be written: a real `EISDIR`.
    mkdirSync(contentPath, { recursive: true });
    const input = {
      operationId: 'op-write-back-fails',
      metadata: metadataDraft(),
      contentMarkdown: body('写回失败的正文。'),
      expected: { expectedAbsent: true },
      sourceRef,
    };
    const refused = requireRefused(h.service.save(input));
    // FALSIFY (W8R3-02): the old code only logged a diagnostic and still reported
    // `saved`, claiming a working copy that was never written.
    expect(refused.code).toBe('RECOVERY_REQUIRED');
    expect(refused.operation?.repairOnly).toBe(true);
    expect(refused.branchUntouched).toBe(false);
    expect(refused.message).toContain('写回失败');
    // Git moved, the projection did not.
    expect(refHead(h.repo)).not.toBe(h.baseRevision);
    expect(commitCount(h.repo)).toBe(2);
    expect(h.store.requirements.find(REQUIREMENT_ID)).toBeUndefined();

    // Once the path is a file again the same operation repairs only the projection.
    rmSync(contentPath, { recursive: true, force: true });
    const repaired = requireSaved(h.service.retry(input));
    expect(repaired.status).toBe('projection_repaired');
    expect(existsSync(contentPath)).toBe(true);
    expect(readFileSync(contentPath, 'utf8')).toContain('写回失败的正文。');
    h.store.close();
  });

  it('rewinds a clean checkout parked at another revision instead of calling it dirty (W8R3-03)', () => {
    const h = harness();
    const first = requireSaved(
      h.service.save({
        operationId: 'op-parked-v1',
        metadata: metadataDraft(),
        contentMarkdown: body('第一版。'),
        expected: { expectedAbsent: true },
        sourceRef,
      }),
    );
    const second = requireSaved(
      h.service.save({
        operationId: 'op-parked-v2',
        metadata: metadataDraft({ version: 2, title: '第二版' }),
        contentMarkdown: body('第二版。'),
        expected: { recordVersion: 1, recordHash: first.recordHash },
        sourceRef,
      }),
    );
    // The delivery working tree is cleanly parked at v1 while the delivery ref is v2.
    const detached = runGit(['checkout', '-f', '--detach', first.git.commit], { cwd: h.repo });
    expect(detached.ok).toBe(true);
    expect(requireValue(port.statusPorcelain(h.repo), 'porcelain')).toEqual([]);

    const third = requireSaved(
      h.service.save({
        operationId: 'op-parked-v3',
        metadata: metadataDraft({ version: 3, title: '第三版' }),
        contentMarkdown: body('第三版。'),
        expected: { recordVersion: 2, recordHash: second.recordHash },
        sourceRef,
      }),
    );
    // FALSIFY (W8R3-03): the byte check saw the v1 bytes and refused with a
    // "未提交的本地修改" message that never converged.
    expect(third.status).toBe('saved');
    const contentPath = join(h.repo, third.recordPath, 'content.md');
    expect(readFileSync(contentPath, 'utf8')).toBe(
      requireValue<string | null>(
        port.readBlob(h.repo, third.git.commit, `${third.recordPath}/content.md`),
        'committed content',
      ),
    );
    // The clean checkout was rewound to the new delivery revision.
    expect(requireValue(port.headRevision(h.repo), 'head')).toBe(third.git.commit);

    // The next save still converges: the repair did not leave the branch ahead.
    const fourth = requireSaved(
      h.service.save({
        operationId: 'op-parked-v4',
        metadata: metadataDraft({ version: 4, title: '第四版' }),
        contentMarkdown: body('第四版。'),
        expected: { recordVersion: 3, recordHash: third.recordHash },
        sourceRef,
      }),
    );
    expect(fourth.status).toBe('saved');
    expect(requireValue(port.headRevision(h.repo), 'head')).toBe(fourth.git.commit);
    h.store.close();
  });

  it('treats a ref that moved without a checkout as a stale projection, not local edits (T-05)', () => {
    const h = harness();
    const first = requireSaved(
      h.service.save({
        operationId: 'op-stale-projection-v1',
        metadata: metadataDraft(),
        contentMarkdown: body('第一版。'),
        expected: { expectedAbsent: true },
        sourceRef,
      }),
    );
    // Another server commits v2 and moves the ref; this working tree stays at v1.
    const remoteRevision = commitRemoteRecord({
      repo: h.repo,
      baseRevision: first.git.commit,
      id: REQUIREMENT_ID,
      version: 2,
      body: '其他服务器的 v2 正文。',
    });
    expect(refHead(h.repo)).toBe(remoteRevision);

    const saved = requireSaved(
      h.service.save({
        operationId: 'op-stale-projection-repair',
        metadata: metadataDraft({ version: 3, title: '本机 v3' }),
        contentMarkdown: body('本机 v3 正文。'),
        expected: { recordVersion: 1, recordHash: first.recordHash },
        explicitRepair: true,
        sourceRef,
      }),
    );
    // FALSIFY (T-05): the stale checkout used to be diagnosed as uncommitted local
    // modifications and left the branch ahead of the working copy.
    expect(saved.status).toBe('saved');
    expect(saved.git.previousCommit).toBe(remoteRevision);
    const contentPath = join(h.repo, `${first.recordPath}/content.md`);
    expect(readFileSync(contentPath, 'utf8')).toBe(
      requireValue<string | null>(
        port.readBlob(h.repo, saved.git.commit, `${first.recordPath}/content.md`),
        'committed content',
      ),
    );
    h.store.close();
  });

  it('reports a half pair as a per-record conflict instead of dropping it (T-03)', () => {
    const h = harness();
    const recordPath = `.agentdev/requirements/${SECOND_ID}`;
    const worktree = detachedWorktree(h.repo, 'half-pair', h.baseRevision);
    writeFileAt(
      worktree,
      `${recordPath}/requirement.json`,
      `${JSON.stringify({ ...metadataDraft({ id: SECOND_ID }), contentHash: 'f'.repeat(64) }, null, 2)}\n`,
    );
    const committed = requireValue<{ revision: string }>(
      port.commitPaths(worktree, 'doc(requirement): half pair', [`${recordPath}/requirement.json`]),
      'commit half pair',
    );
    requireValue(
      port.updateRef({
        repoRoot: h.repo,
        ref: DELIVERY_REF,
        newRevision: committed.revision,
        expectedOldRevision: h.baseRevision,
      }),
      'move the delivery ref to the half pair',
    );

    const pool = readRequirementPoolAtRevision({
      git: gitReader,
      repoRoot: h.repo,
      revision: committed.revision,
    });
    // FALSIFY (T-03): the reader used to `continue` with no conflict and no record.
    expect(pool.records).toEqual([]);
    expect(pool.conflicts).toHaveLength(1);
    expect(pool.conflicts[0]?.recordPath).toBe(recordPath);
    expect(pool.conflicts[0]?.reason).toBe('missing-content');
    expect(pool.conflicts[0]?.paths).toContain(`${recordPath}/content.md`);

    // The save path surfaces it as a per-record conflict, not a silent overwrite.
    const refused = requireRefused(
      h.service.save({
        operationId: 'op-half-pair-save',
        metadata: metadataDraft({ id: SECOND_ID }),
        contentMarkdown: body('本机正文。'),
        expected: { expectedAbsent: true },
        sourceRef,
      }),
    );
    expect(refused.code).toBe('REQUIREMENT_CONFLICT');
    expect(refused.message).toContain(recordPath);
    expect(refHead(h.repo)).toBe(committed.revision);
    h.store.close();
  });

  it('reports a metadata/body hash mismatch per record (T-03)', () => {
    const h = harness();
    const recordPath = `.agentdev/requirements/${SECOND_ID}`;
    const worktree = detachedWorktree(h.repo, 'hash-mismatch', h.baseRevision);
    const contentMarkdown = `${normalizeContentMarkdown('# body\n\n正文。\n')}`;
    writeFileAt(worktree, `${recordPath}/content.md`, contentMarkdown);
    writeFileAt(
      worktree,
      `${recordPath}/requirement.json`,
      `${JSON.stringify({ ...metadataDraft({ id: SECOND_ID }), contentHash: 'f'.repeat(64) }, null, 2)}\n`,
    );
    const committed = requireValue<{ revision: string }>(
      port.commitPaths(worktree, 'doc(requirement): hash mismatch', [
        `${recordPath}/content.md`,
        `${recordPath}/requirement.json`,
      ]),
      'commit hash mismatch',
    );

    const pool = readRequirementPoolAtRevision({
      git: gitReader,
      repoRoot: h.repo,
      revision: committed.revision,
    });
    expect(pool.records.map((record) => record.id)).toEqual([SECOND_ID]);
    expect(pool.conflicts.map((conflict) => conflict.reason)).toEqual(['hash-mismatch']);
    expect(pool.conflicts[0]?.recordPath).toBe(recordPath);
    h.store.close();
  });
});
