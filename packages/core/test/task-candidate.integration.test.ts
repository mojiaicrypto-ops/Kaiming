/**
 * WP-12 T4b round 3 (step 2): per-Task candidate commits and their
 * `VerificationManifest` binding, against a **real temporary Git repository**.
 *
 * The assertions are the exit conditions that do not need the integration step:
 * each Task really commits a candidate (40-hex), the candidate commit is kept alive
 * by its ref, the frozen `VerificationManifest` binds that exact revision and SHA256
 * code tree, `Task.latestManifestId` is readable, and a missing execution environment
 * fails closed instead of freezing a manifest with a fabricated id.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkResultSchema, verificationManifestSchema } from '@agentdev/contracts';
import { ProjectStore as Store, projectIdFromRoot, type ProjectStore } from '@agentdev/storage';
import { createNodeWorktreeGitPort } from '@agentdev/workspace';
import {
  SnapshotWriter,
  buildTestCheckResult,
  createTaskCandidateService,
  deliveredCodeTreeHash,
  taskCandidateRef,
  type TaskCandidateService,
} from '../src/index.js';

const created: string[] = [];
const WORK_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d8e01';
const TASK_A = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d8e10';
const TASK_B = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d8e11';

function makeTempDir(prefix: string): string {
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

const gitPort = createNodeWorktreeGitPort();

interface Harness {
  readonly repo: string;
  readonly edits: string;
  readonly store: ProjectStore;
  readonly service: TaskCandidateService;
  readonly baseRevision: string;
  readonly worktreeRoot: string;
}

function harness(): Harness {
  const repo = makeTempDir('agentdev-candidate-repo-');
  writeFileAt(repo, 'src/orders.ts', 'export const orders = [];\n');
  const init = gitPort.initRepository(repo, { branch: 'agentdev/main' });
  if (!init.ok) throw new Error('git init failed');
  const seed = gitPort.commitPaths(repo, 'chore: seed', ['src/orders.ts']);
  if (!seed.ok) throw new Error('seed commit failed');
  const dataDir = makeTempDir('agentdev-candidate-state-');
  const store = Store.open({
    dataDir,
    canonicalRoot: repo,
    migrations: { backup: () => undefined, backupPath: join(dataDir, 'pre.sqlite') },
  });
  const projectId = projectIdFromRoot(repo);
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
  const budget = store.budgets.insert({
    projectId,
    workId: WORK_ID,
    tokenLimit: 100_000,
    tokensUsed: 0,
    tokensReserved: 0,
    activeTimeLimit: 3_600,
    activeTimeUsed: 0,
    repairLimit: 2,
    repairUsed: 0,
    costKnown: true,
  });
  store.works.insert({
    id: WORK_ID,
    projectId,
    intent: 'delivery',
    purpose: 'task candidates',
    level: 'L2',
    goal: 'commit per-Task candidates',
    scope: {
      readPaths: ['src'],
      writePaths: ['src'],
      operations: ['read', 'edit'],
      networkTargets: [],
    },
    sourceRef: { kind: 'action', id: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d8e30', version: '1' },
    status: 'running',
    blockerIds: [],
    baseRevision: seed.value.revision,
    budgetId: budget.id,
    policyRevision: 1,
  });
  const snapshots = new SnapshotWriter({ store });
  const worktreeRoot = join(dataDir, 'task-worktrees');
  const service = createTaskCandidateService({
    store,
    worktrees: gitPort,
    snapshots,
    repoRoot: repo,
    worktreeRoot,
  });
  return {
    repo,
    edits: makeTempDir('agentdev-candidate-edits-'),
    store,
    service,
    baseRevision: seed.value.revision,
    worktreeRoot,
  };
}

function seedTask(h: Harness, taskId: string, dependencyRevision: string): void {
  h.store.tasks.insert({
    id: taskId,
    projectId: h.store.projectId,
    workId: WORK_ID,
    planRef: { id: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d8e20', version: 1, hash: 'f'.repeat(64) },
    role: 'backend',
    dependsOn: [],
    dependencyRevision,
    dependencyManifestRefs: [],
    scope: { readPaths: ['src'], writePaths: ['src'], operations: [], networkTargets: [] },
    stage: 'develop',
    acceptanceIds: ['AC-081'],
  } as never);
}

function candidateInput(h: Harness, taskId: string, dependencyRevision: string) {
  return {
    workId: WORK_ID,
    taskId,
    runId: h.store.newId(),
    role: 'backend' as const,
    level: 'L2' as const,
    route: 'L2',
    planRef: { id: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d8e20', version: 1, hash: 'f'.repeat(64) },
    dependencyRevision,
    dependencyManifestRefs: [],
    acceptanceIds: ['AC-081'],
    policyHash: 'b'.repeat(64),
    configHash: 'c'.repeat(64),
    // A real `contextSnapshotId` is a row id (`idSchema`), not a hash: the W8-1 case
    // parses the frozen manifest through `verificationManifestSchema`, which the old
    // `'d'.repeat(64)` fixture would fail before W8-1 was even reached.
    contextSnapshotId: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d8e30',
    readLedgerSeq: 3,
    readLedgerHash: 'e'.repeat(64),
    environmentRef: 'container:agentdev-exec:latest',
    changedPaths: [],
    sourceRoot: h.edits,
    message: `feat(task): ${taskId}`,
  };
}

describe('per-Task candidate commit and VerificationManifest (step 2)', () => {
  it('commits each Task candidate, keeps it by ref and binds the frozen manifest', () => {
    const h = harness();
    try {
      seedTask(h, TASK_A, h.baseRevision);
      seedTask(h, TASK_B, h.baseRevision);

      // Task A's Run edits the working copy; its candidate is committed on the base.
      writeFileAt(h.edits, 'src/orders.ts', 'export const orders = ["A"];\n');
      const inputA = {
        ...candidateInput(h, TASK_A, h.baseRevision),
        changedPaths: ['src/orders.ts'],
      };
      const a = h.service.commit(inputA);
      expect(a.ok, a.ok ? '' : a.message).toBe(true);
      if (!a.ok) throw new Error(a.message);
      expect(a.revision).toMatch(/^[0-9a-f]{40}$/u);
      expect(a.reusedBase).toBe(false);
      expect(a.ref).toBe(taskCandidateRef(TASK_A, inputA.runId));
      // The commit is real and the code tree is the measured SHA256, not the OID.
      expect(a.commitTree).not.toBe(a.codeTree);
      expect(a.codeTree).toBe(deliveredCodeTreeHash({ repoRoot: h.repo, revision: a.revision }));
      expect(a.codeTree).toMatch(/^[0-9a-f]{64}$/u);
      // The candidate really *carries* the Run's change: a commit whose tree still equals
      // the base (the un-staged staging bug) would have no diff for the integration to
      // replay, even though the SHA would differ.
      expect(a.codeTree).not.toBe(
        deliveredCodeTreeHash({ repoRoot: h.repo, revision: h.baseRevision }),
      );
      // The ref really exists in the repository.
      const resolved = gitPort.resolveRevision(h.repo, a.ref);
      expect(resolved.ok && resolved.value).toBe(a.revision);
      // Task.latestManifestId is written and the frozen manifest binds the revision.
      expect(h.store.tasks.find(TASK_A)?.latestManifestId).toBe(a.manifestId);
      const frozenA = h.store.snapshots
        .list({ where: "type = 'verification'" })
        .find((row) => (row.payload as { manifestId?: string }).manifestId === a.manifestId);
      expect(frozenA).toBeDefined();
      const manifestA = (
        frozenA?.payload as {
          manifest?: { codeRevision?: string; codeTree?: string; environmentRef?: string };
        }
      ).manifest;
      expect(manifestA?.codeRevision).toBe(a.revision);
      expect(manifestA?.codeTree).toBe(a.codeTree);
      expect(manifestA?.environmentRef).toBe('container:agentdev-exec:latest');

      // Task B is based on A's candidate, so its chain really descends from A.
      writeFileAt(h.edits, 'src/b.ts', 'export const b = true;\n');
      const b = h.service.commit({
        ...candidateInput(h, TASK_B, a.revision),
        changedPaths: ['src/b.ts'],
      });
      expect(b.ok, b.ok ? '' : b.message).toBe(true);
      if (!b.ok) throw new Error(b.message);
      expect(b.revision).toMatch(/^[0-9a-f]{40}$/u);
      expect(b.revision).not.toBe(a.revision);
      const ancestor = gitPort.isAncestor(h.repo, a.revision, b.revision);
      expect(ancestor.ok && ancestor.value).toBe(true);
      // Ancestor dedup: the integration target being B's own revision means A is
      // already contained and must not be replayed.
      const contained = gitPort.isAncestor(h.repo, a.revision, b.revision);
      expect(contained.ok && contained.value).toBe(true);
      expect(h.store.tasks.find(TASK_B)?.latestManifestId).toBe(b.manifestId);

      // A Task whose Run changed nothing reuses the base revision without a commit.
      writeFileAt(h.edits, 'src/orders.ts', 'export const orders = [];\n');
      const noop = h.service.commit({
        ...candidateInput(h, TASK_A, h.baseRevision),
        changedPaths: ['src/orders.ts'],
      });
      expect(noop.ok, noop.ok ? '' : noop.message).toBe(true);
      if (!noop.ok) throw new Error(noop.message);
      expect(noop.reusedBase).toBe(true);
      expect(noop.revision).toBe(h.baseRevision);
    } finally {
      h.store.close();
    }
  });

  it('fails closed when the execution environment is unknown', () => {
    const h = harness();
    try {
      seedTask(h, TASK_A, h.baseRevision);
      writeFileAt(h.edits, 'src/orders.ts', 'export const orders = ["A"];\n');
      const refused = h.service.commit({
        ...candidateInput(h, TASK_A, h.baseRevision),
        environmentRef: '',
        changedPaths: ['src/orders.ts'],
      });
      expect(refused.ok).toBe(false);
      if (refused.ok) throw new Error('unreachable');
      expect(refused.code).toBe('MISSING_CONTEXT');
      // Nothing was frozen and the Task still has no manifest.
      expect(h.store.tasks.find(TASK_A)?.latestManifestId).toBeUndefined();
      expect(h.store.snapshots.list({ where: "type = 'verification'" })).toHaveLength(0);
    } finally {
      h.store.close();
    }
  });

  /**
   * W8-1: the executed Test check and the frozen manifest carry **one** environment
   * descriptor.
   *
   * The single source in production is `Supervisor.environmentRefOf(attemptId)`: the
   * execution stack passes it to the executed `CheckResult` (`execution.ts`) and the
   * control handler passes it to the candidate commit (`control-handler.ts`). This case
   * models that one value and asserts both persisted structures bind it verbatim, and
   * that both parse through the shared contracts (`environmentRefSchema`, widened from
   * `idSchema` by W8-1). The real end-to-end descriptor is produced by the Runner's own
   * `attempt.ready` and is covered by `pnpm test:live` (`drill.message-to-stage`).
   */
  it('binds one environment descriptor in the executed Test check and the frozen manifest (W8-1)', () => {
    const h = harness();
    try {
      seedTask(h, TASK_A, h.baseRevision);
      writeFileAt(h.edits, 'src/orders.ts', 'export const orders = ["A"];\n');
      const attemptEnvironment = 'container:agentdev-exec:latest';
      const checkResult = checkResultSchema.parse(
        buildTestCheckResult({
          executions: [
            {
              command: 'pnpm test:unit',
              exitCode: 0,
              stdout: 'ok\n',
              stderr: '',
              signal: null,
              durationMs: 5,
            },
          ],
          environmentRef: attemptEnvironment,
          executionImage: 'agentdev/exec:0.0.0',
          runnerEnvironment: attemptEnvironment,
          inputTree: 'f'.repeat(64),
          acceptanceIds: ['AC-081'],
          outputRefs: [h.store.newId()],
        }),
      );
      const committed = h.service.commit({
        ...candidateInput(h, TASK_A, h.baseRevision),
        environmentRef: attemptEnvironment,
        changedPaths: ['src/orders.ts'],
      });
      expect(committed.ok, committed.ok ? '' : committed.message).toBe(true);
      if (!committed.ok) throw new Error(committed.message);
      const frozen = h.store.snapshots
        .list({ where: "type = 'verification'" })
        .find(
          (row) => (row.payload as { manifestId?: string }).manifestId === committed.manifestId,
        );
      const manifest = verificationManifestSchema.parse(
        (frozen?.payload as { manifest?: unknown }).manifest,
      );
      // The descriptor, not an Attempt id: a reader compares the two directly.
      expect(checkResult.checks[0]?.environmentRef).toBe(attemptEnvironment);
      expect(manifest.environmentRef).toBe(attemptEnvironment);
      expect(manifest.environmentRef).toBe(checkResult.checks[0]?.environmentRef);
    } finally {
      h.store.close();
    }
  });
});
