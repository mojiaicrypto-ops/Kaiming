/**
 * WP-08 T4 — the five required failure tests.
 *
 * Each test is named for the failure `docs/delivery/implementation.md` WP-08
 * requires, and each one runs against a real temporary Git repository and a real
 * SQLite `ProjectStore`:
 *
 * 1. **Task 合并冲突** — two already-passed Tasks conflict at final integration:
 *    an independent repair Task is produced, the final combination must be
 *    verified again, and CAS protects HEAD (`AC-062`).
 * 2. **CAS 失败** — the delivery baseline moved under the writer: the branch is
 *    left exactly as the other writer left it (`VERSION_CONFLICT`).
 * 3. **ref 后崩溃** — the ref moved but the database did not: the restart re-uses
 *    the same commit, completes the state and emits one completion event
 *    (`AC-063`).
 * 4. **取消未知副作用** — a cancel with unconfirmed side effects stops at
 *    `blocked(recovery)` and keeps the Requirement active until the user decides
 *    (`AC-021`).
 * 5. **备份演练** — backup → restore into a new directory keeps hashes, knowledge
 *    and evidence consistent, requires recovery for an active Run and blocks on a
 *    missing Secret (`AC-064`).
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
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ProjectStore as Store,
  projectIdFromRoot,
  sha256,
  type ProjectStore,
} from '@agentdev/storage';
import {
  createCasService,
  createMemoryCasEvents,
  createMemoryCasJournal,
  createNodeWorktreeGitPort,
  runIntegration,
  type CasJournal,
  type CasJournalRecord,
  type GitResult,
} from '@agentdev/workspace';
import {
  BACKUP_MANIFEST_NAME,
  ArtifactService,
  FindingService,
  SettlementService,
  SnapshotWriter,
  backupProject,
  buildFinalManifest,
  createMemoryProcessProbe,
  createNodeBackupGitPort,
  deliveredCodeTreeHash,
  relocateProject,
  restoreProject,
  type BackupManifest,
} from '../src/index.js';
import { scanEvents } from '../src/events.js';

const created: string[] = [];
const DELIVERY_REF = 'refs/heads/agentdev/main';
const CODE_PATH = 'src/orders/cancel.ts';
const HASH = 'a'.repeat(64);
const TIME = '2026-09-11T00:00:00.000Z';

function makeTempDir(prefix = 'agentdev-wp08-fail-'): string {
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

function gitOk<T>(result: GitResult<T>, what: string): T {
  if (!result.ok) throw new Error(`${what}: ${result.errors[0]?.message ?? 'git failed'}`);
  return result.value;
}

function refHead(repo: string): string | null {
  return gitOk(port.resolveRevision(repo, DELIVERY_REF), 'resolve delivery ref');
}

function worktreeAt(repo: string, baseRevision: string, name: string): string {
  const path = join(makeTempDir('agentdev-wp08-fail-wt-'), name);
  gitOk(port.addWorktree({ repoRoot: repo, path, baseRevision }), `worktree ${name}`);
  return path;
}

function commitAt(
  repo: string,
  baseRevision: string,
  name: string,
  path: string,
  content: string,
): string {
  const worktree = worktreeAt(repo, baseRevision, name);
  writeFileAt(worktree, path, content);
  return gitOk<{ revision: string }>(
    port.commitPaths(worktree, `feat: ${name}`, [path]),
    `commit ${name}`,
  ).revision;
}

/** A JSON-file CAS journal, so a "restart" reads exactly what the process wrote. */
function fileJournal(file: string): CasJournal {
  const read = (): Record<string, CasJournalRecord> => {
    try {
      return JSON.parse(readFileSync(file, 'utf8')) as Record<string, CasJournalRecord>;
    } catch {
      return {};
    }
  };
  return {
    load(operationId) {
      return read()[operationId] ?? null;
    },
    save(record) {
      const all = read();
      all[record.operationId] = record;
      writeFileSync(file, `${JSON.stringify(all)}\n`, 'utf8');
    },
    list() {
      return Object.values(read());
    },
  };
}

interface Repo {
  readonly repo: string;
  readonly dataDir: string;
  readonly store: ProjectStore;
  readonly projectId: string;
  readonly seedRevision: string;
}

function createRepo(): Repo {
  const repo = makeTempDir();
  writeFileAt(repo, CODE_PATH, 'export const cancel = (): boolean => false;\n');
  writeFileAt(repo, 'README.md', '# demo\n');
  gitOk(port.initRepository(repo, { branch: 'agentdev/main' }), 'git init');
  const seed = gitOk<{ revision: string }>(
    port.commitPaths(repo, 'chore: seed delivery branch', [CODE_PATH, 'README.md']),
    'seed commit',
  );
  const dataDir = makeTempDir('agentdev-wp08-fail-state-');
  const projectId = projectIdFromRoot(repo);
  const store = Store.open({
    dataDir,
    canonicalRoot: repo,
    migrations: { backup: () => undefined, backupPath: join(dataDir, 'pre.sqlite') },
    repository: { now: () => TIME },
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
  return { repo, dataDir, store, projectId, seedRevision: seed.revision };
}

function addWork(
  base: Repo,
  id: string,
  input: {
    readonly level?: 'L1' | 'L2';
    readonly intent?: 'delivery' | 'document';
    readonly status?: 'running' | 'completed';
    readonly baseRevision?: string;
    readonly requirementId?: string;
  } = {},
): void {
  const budget = base.store.budgets.insert({
    projectId: base.projectId,
    workId: id,
    tokenLimit: 100_000,
    tokensUsed: 0,
    tokensReserved: 0,
    activeTimeLimit: 600,
    activeTimeUsed: 0,
    repairLimit: 3,
    repairUsed: 0,
    costKnown: true,
  });
  base.store.works.insert({
    id,
    projectId: base.projectId,
    intent: input.intent ?? 'delivery',
    purpose: 'WP-08 failure drill',
    level: input.level ?? 'L2',
    goal: `deliver ${id}`,
    scope: {
      readPaths: ['src'],
      writePaths: ['src'],
      operations: ['read', 'edit'],
      networkTargets: [],
    },
    sourceRef: { kind: 'message', id, version: '1' },
    ...(input.requirementId === undefined ? {} : { requirementId: input.requirementId }),
    status: input.status ?? 'running',
    blockerIds: [],
    baseRevision: input.baseRevision ?? base.seedRevision,
    budgetId: budget.id,
    policyRevision: 1,
  });
}

// ---------------------------------------------------------------------------
// 1. Task 合并冲突
// ---------------------------------------------------------------------------

describe('required WP-08 failure tests', () => {
  it('Task 合并冲突: two passed Tasks conflict, the repair Task is independent and CAS protects HEAD (AC-062)', () => {
    const base = createRepo();
    try {
      const workId = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d5a01';
      addWork(base, workId);
      const taskA = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d5a10';
      const taskB = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d5a11';
      // Both Tasks were cut from the same frozen baseline and both pass on their
      // own; only the final combination conflicts.
      const revisionA = commitAt(
        base.repo,
        base.seedRevision,
        'task-a',
        CODE_PATH,
        'export const cancel = (): boolean => true;\n',
      );
      const revisionB = commitAt(
        base.repo,
        base.seedRevision,
        'task-b',
        CODE_PATH,
        'export const cancel = (): boolean => 1 as unknown as boolean;\n',
      );
      const integration = worktreeAt(base.repo, base.seedRevision, 'integration-conflict');
      const integrated = runIntegration({
        git: port,
        repoRoot: base.repo,
        cas: createCasService({
          git: port,
          journal: createMemoryCasJournal(),
          events: createMemoryCasEvents(),
        }),
        worktreePath: integration,
        operationId: 'op-conflict',
        ref: DELIVERY_REF,
        targetRevision: base.seedRevision,
        tasks: [
          {
            taskId: taskA,
            dependsOn: [],
            revision: revisionA,
            dependencyRevision: base.seedRevision,
          },
          {
            taskId: taskB,
            dependsOn: [],
            revision: revisionB,
            dependencyRevision: base.seedRevision,
          },
        ],
        workId,
        dependencyManifestRefs: [sha256('manifest-A'), sha256('manifest-B')],
        acceptanceIds: ['AC-062'],
      });
      expect(integrated.ok).toBe(false);
      if (integrated.ok) throw new Error('unreachable');
      expect(integrated.code).toBe('TASK_MERGE_CONFLICT');
      if (integrated.code !== 'TASK_MERGE_CONFLICT') throw new Error('unreachable');
      expect(integrated.branchUntouched).toBe(true);
      expect(integrated.conflict.kind).toBe('task-merge-conflict');
      expect(integrated.conflict.paths).toContain(CODE_PATH);
      expect(integrated.conflict.taskId).toBe(taskB);

      // The independent repair Task: a new unit of work that must be verified again
      // and never reuses the conflicting evidence.
      const repair = integrated.repair;
      expect(repair.repairTask.requiresFreshVerification).toBe(true);
      expect(repair.repairTask.committed).toBe(false);
      expect([...repair.repairTask.dependsOn].sort()).toEqual([taskA, taskB].sort());
      expect(repair.repairTask.dependencyRevision).toBe(base.seedRevision);
      expect(repair.repairTask.conflictPaths).toContain(CODE_PATH);
      expect(repair.repairTask.acceptanceIds).toEqual(['AC-062']);
      expect(repair.repairTask.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      // The same conflict always produces the same repair Task id, so a retry does
      // not spawn a second one.
      const retried = runIntegration({
        git: port,
        repoRoot: base.repo,
        cas: createCasService({
          git: port,
          journal: createMemoryCasJournal(),
          events: createMemoryCasEvents(),
        }),
        worktreePath: worktreeAt(base.repo, base.seedRevision, 'integration-conflict-retry'),
        operationId: 'op-conflict-retry',
        ref: DELIVERY_REF,
        targetRevision: base.seedRevision,
        tasks: [
          {
            taskId: taskA,
            dependsOn: [],
            revision: revisionA,
            dependencyRevision: base.seedRevision,
          },
          {
            taskId: taskB,
            dependsOn: [],
            revision: revisionB,
            dependencyRevision: base.seedRevision,
          },
        ],
        workId,
      });
      expect(retried.ok).toBe(false);
      if (retried.ok || retried.code !== 'TASK_MERGE_CONFLICT') throw new Error('unreachable');
      expect(retried.repair.repairTask.id).toBe(repair.repairTask.id);

      // The conflict report is a real artifact with a checkable hash.
      expect(repair.artifact.markdown).toContain(taskA);
      expect(repair.artifact.markdown).toContain(taskB);
      expect(repair.artifact.sha256).toBe(sha256(repair.artifact.markdown));
      expect(repair.artifact.path.startsWith('.agentdev/integration/conflicts/')).toBe(true);

      // CAS protects HEAD: the delivery branch never moved.
      expect(refHead(base.repo)).toBe(base.seedRevision);
    } finally {
      base.store.close();
    }
  });

  // -------------------------------------------------------------------------
  // 2. CAS 失败
  // -------------------------------------------------------------------------

  it('CAS 失败: a moved baseline refuses the writer and leaves the branch untouched', () => {
    const base = createRepo();
    try {
      const candidate = commitAt(
        base.repo,
        base.seedRevision,
        'cas-candidate',
        CODE_PATH,
        'export const cancel = (): boolean => true;\n',
      );
      // Another writer installs a competing revision first.
      const other = commitAt(
        base.repo,
        base.seedRevision,
        'other-writer',
        'src/orders/other.ts',
        'export const other = true;\n',
      );
      gitOk(
        port.updateRef({
          repoRoot: base.repo,
          ref: DELIVERY_REF,
          newRevision: other,
          expectedOldRevision: base.seedRevision,
        }),
        'other writer ref update',
      );

      const events = createMemoryCasEvents();
      const journal = createMemoryCasJournal();
      const cas = createCasService({ git: port, journal, events });
      const refused = cas.integrate({
        operationId: 'op-cas-stale',
        kind: 'integrate',
        repoRoot: base.repo,
        ref: DELIVERY_REF,
        expectedRevision: base.seedRevision,
        candidateRevision: candidate,
        message: 'feat: stale writer',
      });
      expect(refused.ok).toBe(false);
      if (refused.ok) throw new Error('unreachable');
      expect(refused.code).toBe('VERSION_CONFLICT');
      expect(refused.branchUntouched).toBe(true);
      expect(refused.actualRevision).toBe(other);
      expect(refused.expectedRevision).toBe(base.seedRevision);
      // Nothing was installed, no event was emitted and no journal row claims a commit.
      expect(refHead(base.repo)).toBe(other);
      expect(events.appended).toHaveLength(0);
      expect(journal.load('op-cas-stale')).toBeNull();

      // A baseline that no longer exists at all is `STALE_ARTIFACT`, not a silent
      // fast-forward.
      const missing = cas.integrate({
        operationId: 'op-cas-missing',
        kind: 'integrate',
        repoRoot: base.repo,
        ref: DELIVERY_REF,
        expectedRevision: 'f'.repeat(40),
        candidateRevision: candidate,
        message: 'feat: missing baseline',
      });
      expect(missing.ok).toBe(false);
      if (missing.ok) throw new Error('unreachable');
      expect(missing.code).toBe('STALE_ARTIFACT');
      expect(refHead(base.repo)).toBe(other);

      // The same operation id retried after the failure still refuses, and the
      // completion event count stays at zero.
      const again = cas.integrate({
        operationId: 'op-cas-stale',
        kind: 'integrate',
        repoRoot: base.repo,
        ref: DELIVERY_REF,
        expectedRevision: base.seedRevision,
        candidateRevision: candidate,
        message: 'feat: stale writer',
      });
      expect(again.ok).toBe(false);
      expect(events.appended).toHaveLength(0);
      expect(refHead(base.repo)).toBe(other);
    } finally {
      base.store.close();
    }
  });

  // -------------------------------------------------------------------------
  // 3. ref 后崩溃
  // -------------------------------------------------------------------------

  it('ref 后崩溃: the restart reuses the commit, completes the state and emits one event (AC-063)', () => {
    const base = createRepo();
    try {
      const workId = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d5c01';
      const requirementId = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d5c02';
      addWork(base, workId);
      base.store.requirements.insert({
        id: requirementId,
        projectId: base.projectId,
        workId,
        title: '未付款订单可取消',
        goal: '让未付款订单可取消',
        lifecycle: 'active',
        phase: 'settle',
        sourceRef: { kind: 'message', id: workId, version: '1' },
        recordVersion: 1,
        portableRef: {
          path: `.agentdev/requirements/${requirementId}`,
          revision: base.seedRevision,
          hash: HASH,
        },
        executionAvailability: 'local',
        evidenceAvailability: 'full',
      });
      const candidate = commitAt(
        base.repo,
        base.seedRevision,
        'settle-candidate',
        CODE_PATH,
        'export const cancel = (): boolean => true;\n',
      );
      const tree = deliveredCodeTreeHash({ repoRoot: base.repo, revision: candidate });
      const built = buildFinalManifest({
        workId,
        requirementId,
        verifiedManifests: [
          {
            manifestId: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d5c03',
            workId,
            kind: 'integration',
            codeRevision: candidate,
            codeTree: tree,
            acceptanceIds: ['AC-063'],
            valid: true,
          },
        ],
        finalRevision: candidate,
        finalTree: tree,
        knowledgeTree: sha256('knowledge-tree'),
        settlementResultRef: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d5c04',
        changedPaths: [{ path: CODE_PATH, change: 'modified' }],
        codeStartRevision: base.seedRevision,
      });
      if (!built.ok) throw new Error(built.message);

      const journalFile = join(base.dataDir, 'cas-journal.json');
      const events = createMemoryCasEvents();
      const first = new SettlementService({
        store: base.store,
        worktrees: port,
        cas: createCasService({ git: port, journal: fileJournal(journalFile), events }),
        journal: fileJournal(journalFile),
        events,
        snapshots: new SnapshotWriter({ store: base.store }),
        now: () => TIME,
      });
      const prepared = first.prepareSettlement({
        operationId: 'op-crash-after-ref',
        workId,
        requirementId,
        ref: DELIVERY_REF,
        expectedRevision: base.seedRevision,
        candidateRevision: candidate,
        candidateTree: tree,
        manifest: built.manifest,
      });
      expect(prepared.ok).toBe(true);
      if (!prepared.ok) throw new Error(prepared.message);

      // CRASH POINT: the ref moves (the CAS step completed) and the process dies
      // before any settlement state is written.
      const moved = createCasService({
        git: port,
        journal: fileJournal(journalFile),
        events,
      }).integrate(prepared.prepared.casRequest);
      expect(moved.ok).toBe(true);
      expect(refHead(base.repo)).toBe(candidate);
      expect(scanEvents(base.store, { names: ['settlement.completed'] })).toHaveLength(0);
      const operationRow = base.store.operations.find(prepared.prepared.operationRowId);
      expect(operationRow?.state).toBe('running');

      // The restart: the store is reopened and a brand-new service reads the same
      // durable CAS journal.
      base.store.close();
      const reopened = Store.open({
        dataDir: base.dataDir,
        canonicalRoot: base.repo,
        projectId: base.projectId,
        migrations: { backup: () => undefined, backupPath: join(base.dataDir, 'pre.sqlite') },
        repository: { now: () => TIME },
      });
      try {
        const restarted = new SettlementService({
          store: reopened,
          worktrees: port,
          cas: createCasService({ git: port, journal: fileJournal(journalFile), events }),
          journal: fileJournal(journalFile),
          events,
          snapshots: new SnapshotWriter({ store: reopened }),
          now: () => TIME,
        });
        const recovered = restarted.recover('op-crash-after-ref');
        if (!recovered.ok) throw new Error(`${recovered.code}: ${recovered.message}`);
        expect(recovered.revision).toBe(candidate);
        expect(recovered.tree).toBe(tree);
        expect(recovered.reusedCommit).toBe(true);
        expect(recovered.refUpdated).toBe(false);
        expect(recovered.emittedEvent).toBe(true);
        expect(recovered.workCompleted).toBe(true);
        expect(recovered.requirementCompleted).toBe(true);
        expect(reopened.works.find(workId)?.status).toBe('completed');
        expect(reopened.requirements.find(requirementId)?.lifecycle).toBe('completed');
        expect(reopened.operations.find(prepared.prepared.operationRowId)?.state).toBe('completed');

        // Exactly one completion event; replaying the recovery is a no-op that never
        // creates a second commit.
        const eventsAfter = scanEvents(reopened, { names: ['settlement.completed'] });
        expect(eventsAfter).toHaveLength(1);
        expect(eventsAfter[0]?.data['revision']).toBe(candidate);
        const replay = restarted.recover('op-crash-after-ref');
        expect(replay.ok).toBe(true);
        if (!replay.ok) throw new Error('unreachable');
        expect(replay.emittedEvent).toBe(false);
        expect(scanEvents(reopened, { names: ['settlement.completed'] })).toHaveLength(1);
        expect(refHead(base.repo)).toBe(candidate);
      } finally {
        reopened.close();
      }
    } finally {
      // `base.store` is already closed in the happy path; closing twice is safe.
      base.store.close();
    }
  });

  // -------------------------------------------------------------------------
  // 4. 取消未知副作用
  // -------------------------------------------------------------------------

  it('取消未知副作用: cancel stops at blocked(recovery), keeps the Requirement active and integrates nothing (AC-021)', () => {
    const base = createRepo();
    try {
      const workId = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d5d01';
      const requirementId = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d5d02';
      addWork(base, workId, { requirementId });
      base.store.requirements.insert({
        id: requirementId,
        projectId: base.projectId,
        workId,
        title: '未付款订单可取消',
        goal: '让未付款订单可取消',
        lifecycle: 'active',
        phase: 'execute',
        sourceRef: { kind: 'message', id: workId, version: '1' },
        recordVersion: 1,
        portableRef: {
          path: `.agentdev/requirements/${requirementId}`,
          revision: base.seedRevision,
          hash: HASH,
        },
        executionAvailability: 'local',
        evidenceAvailability: 'full',
      });
      // An earlier delivery already landed and must not be rolled back by the cancel.
      const delivered = commitAt(
        base.repo,
        base.seedRevision,
        'delivered-before-cancel',
        CODE_PATH,
        'export const cancel = (): boolean => true;\n',
      );
      gitOk(
        port.updateRef({
          repoRoot: base.repo,
          ref: DELIVERY_REF,
          newRevision: delivered,
          expectedOldRevision: base.seedRevision,
        }),
        'install delivered revision',
      );

      const runId = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d5d03';
      base.store.runs.insert({
        id: runId,
        projectId: base.projectId,
        workId,
        role: 'backend',
        purpose: 'implementation',
        stage: 'develop',
        status: 'running',
        requiredChild: false,
        join: 'none',
        childIds: [],
        configSnapshotId: HASH,
        contextSnapshotId: HASH,
        dispatchSnapshotId: HASH,
        budgetAllocation: 1_000,
      });
      const attempt = base.store.attempts.insert({
        runId,
        number: 1,
        status: 'running',
        ownerEpoch: 0,
        runnerId: 'pid:4242',
        heartbeatAt: TIME,
      });
      const artifacts = new ArtifactService({
        store: base.store,
        blobs: base.store.blobs,
        now: () => Date.parse(TIME),
      });
      const candidateArtifact = artifacts.createAgent({
        run: { id: runId, workId, role: 'backend' },
        kind: 'diff',
        mime: 'text/markdown',
        bytes: Buffer.from('-false\n+true\n', 'utf8'),
        sourceRevision: delivered,
      });
      const findings = new FindingService({ store: base.store, artifacts });
      expect(findings.writeAdmission(runId).admitted).toBe(true);

      const cancelled = findings.cancelWork({
        workId,
        reason: '用户取消，外部副作用未知',
        sideEffectsUnknown: true,
        at: TIME,
      });
      expect(cancelled.ok).toBe(true);
      if (!cancelled.ok) throw new Error(cancelled.message);
      expect(cancelled.status).toBe('blocked');
      expect(cancelled.recoveryRequired).toBe(true);
      expect(cancelled.integrated).toBe(false);
      expect(cancelled.requirementStatus).toBeNull();
      expect(cancelled.preservedArtifactIds).toContain(candidateArtifact.id);
      expect(cancelled.cancelledRunIds).toContain(runId);
      expect(cancelled.stoppedAttemptIds).toContain(attempt.id);
      expect(cancelled.recoveryDecisionId).not.toBeNull();
      expect(base.store.runs.find(runId)?.status).toBe('cancelled');
      expect(base.store.attempts.find(attempt.id)?.status).not.toBe('running');
      // The Requirement stays active and the candidate is not integrated.
      expect(base.store.requirements.find(requirementId)?.lifecycle).toBe('active');
      expect(refHead(base.repo)).toBe(delivered);
      expect(base.store.artifacts.find(candidateArtifact.id)?.validity).toBe('valid');
      expect(findings.writeAdmission(runId).admitted).toBe(false);

      // Only a user disposition closes the recovery: `resume` keeps the Work alive,
      // `accept_cancel` reaches cancelled.
      const decisionId = cancelled.recoveryDecisionId;
      if (decisionId === null) throw new Error('expected a recovery decision');
      const resume = findings.resolveCancellation({
        workId,
        decisionId,
        disposition: 'resume',
        at: TIME,
      });
      expect(resume.ok).toBe(true);
      if (!resume.ok) throw new Error(resume.message);
      expect(resume.status).toBe('running');
      expect(base.store.requirements.find(requirementId)?.lifecycle).toBe('active');

      const cancelledAgain = findings.cancelWork({
        workId,
        reason: '用户取消',
        sideEffectsUnknown: true,
        at: TIME,
      });
      expect(cancelledAgain.ok).toBe(true);
      if (!cancelledAgain.ok) throw new Error(cancelledAgain.message);
      const secondDecision = cancelledAgain.recoveryDecisionId;
      if (secondDecision === null) throw new Error('expected a recovery decision');
      const accepted = findings.resolveCancellation({
        workId,
        decisionId: secondDecision,
        disposition: 'accept_cancel',
        at: TIME,
      });
      expect(accepted.ok).toBe(true);
      if (!accepted.ok) throw new Error(accepted.message);
      expect(accepted.status).toBe('cancelled');
      expect(accepted.requirementStatus).toBe('cancelled');
      expect(accepted.integrated).toBe(false);
      expect(base.store.requirements.find(requirementId)?.lifecycle).toBe('cancelled');
      expect(refHead(base.repo)).toBe(delivered);
    } finally {
      base.store.close();
    }
  });

  // -------------------------------------------------------------------------
  // 5. 备份演练
  // -------------------------------------------------------------------------

  it('备份演练: backup → restore keeps hashes/knowledge/evidence and blocks a missing Secret (AC-064)', () => {
    const base = createRepo();
    try {
      const doneWorkId = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d5e01';
      const activeWorkId = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d5e02';
      const doneRunId = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d5e10';
      const activeRunId = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d5e11';
      const attemptId = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d5e12';
      const decisionId = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d5e13';
      const secretRef = 'provider:openai';
      addWork(base, doneWorkId, { status: 'completed' });
      addWork(base, activeWorkId);
      // Real knowledge documents the backup must carry.
      writeFileAt(base.repo, 'docs/PROJECT.md', '# PROJECT\n');
      writeFileAt(base.repo, 'docs/features/README.md', '# 功能索引\n');
      // The knowledge commit lands on the delivery branch itself, so the restore's
      // working-tree comparison is meaningful.
      const revision = gitOk<{ revision: string }>(
        port.commitPaths(base.repo, 'chore: knowledge docs', [
          'docs/PROJECT.md',
          'docs/features/README.md',
        ]),
        'knowledge commit',
      ).revision;
      expect(refHead(base.repo)).toBe(revision);

      base.store.runs.insert({
        id: doneRunId,
        projectId: base.projectId,
        workId: doneWorkId,
        role: 'test',
        purpose: 'test',
        stage: 'Test',
        status: 'completed',
        requiredChild: false,
        join: 'none',
        childIds: [],
        configSnapshotId: HASH,
        contextSnapshotId: HASH,
        dispatchSnapshotId: HASH,
        budgetAllocation: 0,
      });
      const blob = base.store.blobs.write('verification evidence\n');
      base.store.artifacts.insert({
        projectId: base.projectId,
        workId: doneWorkId,
        runId: doneRunId,
        origin: 'agent',
        kind: 'evidence',
        artifactVersion: 1,
        contentHash: blob.hash,
        relativeBlobPath: blob.relativePath,
        mime: 'text/plain',
        bytes: blob.bytes,
        validity: 'valid',
        acl: [],
      });
      base.store.runs.insert({
        id: activeRunId,
        projectId: base.projectId,
        workId: activeWorkId,
        role: 'backend',
        purpose: 'implementation',
        stage: 'develop',
        status: 'running',
        requiredChild: false,
        join: 'none',
        childIds: [],
        configSnapshotId: HASH,
        contextSnapshotId: HASH,
        dispatchSnapshotId: HASH,
        budgetAllocation: 1_000,
      });
      base.store.attempts.insert({
        id: attemptId,
        runId: activeRunId,
        number: 1,
        status: 'running',
        ownerEpoch: 0,
        runnerId: 'pid:1000',
        heartbeatAt: TIME,
      });
      base.store.leases.acquire({
        resource: `worktree:${activeRunId}`,
        ownerAttemptId: attemptId,
        epoch: 0,
        expiresAt: '2030-01-01T00:00:00.000Z',
        at: TIME,
      });
      base.store.decisions.insert({
        id: decisionId,
        workId: activeWorkId,
        kind: 'permission',
        targetRef: { id: activeWorkId, version: 1, hash: HASH },
        choices: ['grant', 'deny'],
        state: 'accepted',
        choice: 'grant',
        actor: 'user',
        effectRefs: [],
      });
      base.store.grants.insert({
        projectId: base.projectId,
        workId: activeWorkId,
        runId: activeRunId,
        scope: 'run',
        role: 'backend',
        stage: 'develop',
        operation: 'edit',
        targets: [CODE_PATH],
        expiresAt: '2030-01-01T00:00:00.000Z',
        limits: {},
        decisionId,
      });

      const backupGit = createNodeBackupGitPort();
      const backupDir = makeTempDir('agentdev-wp08-backup-out-');
      const backup = backupProject({
        store: base.store,
        git: backupGit,
        outputDir: backupDir,
        documentRoot: 'docs',
        secretRefs: [secretRef],
        now: () => TIME,
      });
      if (!backup.ok) throw new Error(`${backup.code}: ${backup.message}`);
      expect(backup.manifest.complete).toBe(true);
      expect(backup.manifest.revision).toBe(revision);
      expect(backup.manifest.evidence).toHaveLength(1);
      expect(backup.manifest.secretRefs).toEqual([secretRef]);
      expect(JSON.stringify(backup.manifest)).not.toContain('sk-');

      // Restore into a brand-new directory: hashes, knowledge and evidence stay
      // consistent, and the previously active Run must be recovered.
      const targetDir = makeTempDir('agentdev-wp08-restore-');
      const dataDir = join(targetDir, 'state');
      const repoRoot = join(targetDir, 'repo');
      const restored = restoreProject({
        backupDir,
        targetDir,
        dataDir,
        repoRoot,
        git: backupGit,
        probe: createMemoryProcessProbe({ 'pid:1000': false }),
        secretAvailable: (ref) => ref !== secretRef,
        now: () => TIME,
      });
      if (!restored.ok) throw new Error(`${restored.code}: ${restored.message}`);
      expect(restored.consistency.treeMatches).toBe(true);
      expect(restored.consistency.knowledgeMatchesTree).toBe(true);
      expect(restored.consistency.evidenceVerified).toBe(1);
      // A missing Provider Secret blocks execution rather than silently running.
      expect(restored.status).toBe('blocked');
      expect(restored.provider.missingSecretRefs).toEqual([secretRef]);
      expect(restored.doctor.executionReady).toBe(false);
      expect(restored.recovery.parked.map((entry) => entry.runId)).toEqual([activeRunId]);
      expect(restored.recovery.parked[0]?.to).toBe('interrupted');
      expect(restored.recovery.revokedLeases).toBeGreaterThanOrEqual(1);
      expect(restored.recovery.revokedGrants).toBe(1);
      expect(existsSync(join(repoRoot, 'docs/PROJECT.md'))).toBe(true);

      const reopened = Store.open({ dataDir, projectId: base.projectId, canonicalRoot: repoRoot });
      try {
        expect(reopened.runs.find(activeRunId)?.status).toBe('interrupted');
        expect(reopened.attempts.find(attemptId)?.status).toBe('lost');
        expect(reopened.leases_.list({})).toHaveLength(0);
        // The completed Work is untouched; the evidence blob is present and hashed.
        expect(reopened.works.find(doneWorkId)?.status).toBe('completed');
        expect(readFileSync(join(dataDir, blob.relativePath), 'utf8')).toBe(
          'verification evidence\n',
        );
      } finally {
        reopened.close();
      }

      // With the Secret available the same backup restores as runnable.
      const readyTarget = makeTempDir('agentdev-wp08-restore-ready-');
      const ready = restoreProject({
        backupDir,
        targetDir: readyTarget,
        dataDir: join(readyTarget, 'state'),
        repoRoot: join(readyTarget, 'repo'),
        git: backupGit,
        probe: createMemoryProcessProbe({ 'pid:1000': false }),
        secretAvailable: (ref) => ref === secretRef,
      });
      if (!ready.ok) throw new Error(`${ready.code}: ${ready.message}`);
      expect(ready.status).toBe('ready');
      expect(ready.doctor.executionReady).toBe(true);

      // An incomplete or tampered backup is refused: a restore never guesses.
      const knowledgeFile = join(backupDir, 'knowledge', 'PROJECT.md');
      writeFileSync(knowledgeFile, '# tampered\n', 'utf8');
      const tampered = restoreProject({
        backupDir,
        targetDir: makeTempDir('agentdev-wp08-restore-tampered-'),
        git: backupGit,
      });
      expect(tampered.ok).toBe(false);
      if (tampered.ok) throw new Error('unreachable');
      expect(tampered.code).toBe('STALE_ARTIFACT');
      expect(tampered.partial).toBe(false);

      const manifestPath = join(backupDir, BACKUP_MANIFEST_NAME);
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as BackupManifest;
      writeFileSync(
        manifestPath,
        `${JSON.stringify({ ...manifest, complete: false }, null, 2)}\n`,
        'utf8',
      );
      const incomplete = restoreProject({
        backupDir,
        targetDir: makeTempDir('agentdev-wp08-restore-incomplete-'),
        git: backupGit,
      });
      expect(incomplete.ok).toBe(false);
      if (incomplete.ok) throw new Error('unreachable');
      expect(incomplete.code).toBe('INVALID_STATE');

      // Relocate is the documented third leg of the drill: a moved root keeps the
      // same Project facts and re-checks the doctor.
      const movedRoot = join(targetDir, 'relocated');
      const relocated = relocateProject({
        dataDir,
        newRoot: movedRoot,
        move: true,
        probe: createMemoryProcessProbe({ 'pid:1000': false }),
        now: () => TIME,
      });
      expect(relocated.ok).toBe(true);
      if (!relocated.ok) throw new Error(relocated.message);
      expect(relocated.repoRoot).toBe(movedRoot);
      expect(existsSync(join(movedRoot, 'docs/PROJECT.md'))).toBe(true);
      expect(relocated.doctor.ok).toBe(true);
    } finally {
      base.store.close();
    }
  });
});
