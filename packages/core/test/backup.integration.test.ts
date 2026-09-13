/**
 * Backup, restore and relocate against a **real temporary Git repository**, a
 * **real SQLite file** and a **real blob directory** (AC-064).
 *
 * The drill is the documented one (`reliability.md` §8): back up a project that has
 * both a completed Work with evidence and an active Run, restore it into a *new*
 * directory, and prove that hashes, knowledge and evidence stayed consistent, that
 * the active Run must be recovered rather than silently continued, and that a
 * missing Provider Secret blocks the restored project.
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
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ProjectStore as Store, projectIdFromRoot, type ProjectStore } from '@agentdev/storage';
import { createNodeWorktreeGitPort, type GitResult } from '@agentdev/workspace';
import {
  BACKUP_MANIFEST_NAME,
  backupProject,
  createMemoryProcessProbe,
  createNodeBackupGitPort,
  relocateProject,
  restoreProject,
  type BackupManifest,
} from '../src/index.js';

const created: string[] = [];
const DELIVERY_REF = 'refs/heads/agentdev/main';
const ROOT_SEED = '/tmp/agentdev-backup-root';
const WORK_DONE_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e01';
const WORK_ACTIVE_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e02';
const RUN_DONE_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e20';
const RUN_ACTIVE_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e21';
const ATTEMPT_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e60';
const DECISION_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e50';
const FEATURE_ID = 'F-0a1b2c3d';
const FEATURE_PATH = `docs/agentdev/features/${FEATURE_ID}/README.md`;
const HASH = 'a'.repeat(64);
const SECRET_REF = 'provider:openai';
const TIME = '2026-09-11T00:00:00.000Z';

function makeTempDir(prefix = 'agentdev-backup-'): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  created.push(dir);
  return dir;
}

afterEach(() => {
  while (created.length > 0) {
    const dir = created.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

const port = createNodeWorktreeGitPort();

function requireValue<T>(result: GitResult<T>, what: string): T {
  if (!result.ok) throw new Error(`${what} failed: ${result.errors[0]?.message ?? 'unknown'}`);
  return result.value;
}

interface Harness {
  readonly repo: string;
  readonly dataDir: string;
  readonly store: ProjectStore;
  readonly projectId: string;
  readonly seedRevision: string;
  readonly artifactBlobPath: string;
  readonly artifactHash: string;
}

/** A project with a completed Work plus evidence and one active Run. */
function harness(): Harness {
  const repo = makeTempDir();
  requireValue(port.initRepository(repo, { branch: 'agentdev/main' }), 'git init');
  writeFileSync(join(repo, 'README.md'), '# demo\n', 'utf8');
  mkdirp(join(repo, 'docs/agentdev/features', FEATURE_ID));
  writeFileSync(
    join(repo, FEATURE_PATH),
    [
      '# 订单取消',
      '',
      '| 字段 | 值 |',
      '|---|---|',
      `| feature_id | ${FEATURE_ID} |`,
      '| name | 订单取消 |',
      '| module | orders |',
      `| owner_document | ${FEATURE_PATH} |`,
      '| design | unconfirmed |',
      '| design_decision_refs | 无 |',
      '| implementation | partial |',
      '| verification | unverified |',
      '| verification_evidence_refs | 无 |',
      '| verification_coverage | 无 |',
      '| investigation | unexplored |',
      '| investigation_scope | 无 |',
      '| source_refs | 无 |',
      `| revision | ${'a'.repeat(40)} |`,
      '',
      '## 用途',
      '',
      '允许用户取消未付款订单。',
      '',
      '## 当前行为',
      '',
      '未付款订单可取消。',
      '',
      '## 关系',
      '',
      '无',
      '',
      '## 实现入口',
      '',
      '- src/orders/cancel.ts',
      '',
      '## 已知差距',
      '',
      '无已登记差距。',
      '',
      '## 关键决定',
      '',
      '无',
      '',
    ].join('\n'),
    'utf8',
  );
  mkdirp(join(repo, 'src/orders'));
  writeFileSync(
    join(repo, 'src/orders/cancel.ts'),
    'export const cancel = (): boolean => true;\n',
    'utf8',
  );
  const seed = requireValue<{ revision: string }>(
    port.commitPaths(repo, 'chore: seed', ['README.md', FEATURE_PATH, 'src/orders/cancel.ts']),
    'seed commit',
  );

  const dataDir = makeTempDir('agentdev-backup-state-');
  const projectId = projectIdFromRoot(ROOT_SEED);
  const store = Store.open({
    dataDir,
    canonicalRoot: ROOT_SEED,
    migrations: { backup: () => undefined, backupPath: join(dataDir, 'pre.sqlite') },
    repository: { now: () => TIME },
  });
  store.projects.insert({
    id: projectId,
    root: repo,
    gitRoot: repo,
    codeRoot: 'src',
    documentRoot: 'docs/agentdev',
    deliveryBranch: 'agentdev/main',
    trust: 'trusted',
    state: 'open',
  });
  addWork(store, projectId, WORK_DONE_ID, 'completed');
  addWork(store, projectId, WORK_ACTIVE_ID, 'running');
  store.runs.insert({
    id: RUN_DONE_ID,
    workId: WORK_DONE_ID,
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
  const blob = store.blobs.write('verification evidence\n');
  store.artifacts.insert({
    projectId,
    workId: WORK_DONE_ID,
    runId: RUN_DONE_ID,
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

  store.runs.insert({
    id: RUN_ACTIVE_ID,
    workId: WORK_ACTIVE_ID,
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
  store.attempts.insert({
    id: ATTEMPT_ID,
    runId: RUN_ACTIVE_ID,
    number: 1,
    status: 'running',
    ownerEpoch: 0,
    runnerId: 'pid:1000',
    heartbeatAt: TIME,
  });
  store.leases.acquire({
    resource: `worktree:${RUN_ACTIVE_ID}`,
    ownerAttemptId: ATTEMPT_ID,
    epoch: 0,
    expiresAt: '2030-01-01T00:00:00.000Z',
    at: TIME,
  });
  store.decisions.insert({
    id: DECISION_ID,
    workId: WORK_ACTIVE_ID,
    kind: 'permission',
    targetRef: { id: WORK_ACTIVE_ID, version: 1, hash: HASH },
    choices: ['grant', 'deny'],
    state: 'accepted',
    choice: 'grant',
    actor: 'user',
    effectRefs: [],
  });
  store.grants.insert({
    projectId,
    workId: WORK_ACTIVE_ID,
    runId: RUN_ACTIVE_ID,
    scope: 'run',
    role: 'backend',
    stage: 'develop',
    operation: 'edit',
    targets: ['src/orders/cancel.ts'],
    expiresAt: '2030-01-01T00:00:00.000Z',
    limits: {},
    decisionId: DECISION_ID,
  });
  return {
    repo,
    dataDir,
    store,
    projectId,
    seedRevision: seed.revision,
    artifactBlobPath: blob.relativePath,
    artifactHash: blob.hash,
  };
}

function addWork(
  store: ProjectStore,
  projectId: string,
  workId: string,
  status: 'running' | 'completed',
): void {
  const budget = store.budgets.insert({
    projectId,
    workId,
    tokenLimit: 100_000,
    tokensUsed: 0,
    tokensReserved: 0,
    activeTimeLimit: 600,
    activeTimeUsed: 0,
    repairLimit: 3,
    repairUsed: 0,
    costKnown: true,
  });
  store.works.insert({
    id: workId,
    projectId,
    intent: 'delivery',
    purpose: 'backup drill',
    level: 'L2',
    goal: 'backup and restore',
    scope: {
      readPaths: ['src'],
      writePaths: ['src'],
      operations: ['read', 'edit'],
      networkTargets: [],
    },
    sourceRef: { kind: 'message', id: workId, version: '1' },
    status,
    blockerIds: [],
    baseRevision: HASH,
    budgetId: budget.id,
    policyRevision: 1,
  });
}

function mkdirp(path: string): void {
  mkdirSync(path, { recursive: true });
}

/** The real Git port behind backup/restore. */
function createBackupGit(): ReturnType<typeof createNodeBackupGitPort> {
  return createNodeBackupGitPort();
}

describe('Backup, restore and relocate (AC-064)', () => {
  it('restores a backup into a new directory with consistent hashes, knowledge and evidence', () => {
    const h = harness();
    try {
      const backupDir = makeTempDir('agentdev-backup-out-');
      const backup = backupProject({
        store: h.store,
        git: createBackupGit(),
        outputDir: backupDir,
        secretRefs: [],
        now: () => TIME,
      });
      if (!backup.ok) throw new Error(`${backup.code}: ${backup.message}`);
      expect(backup.ok).toBe(true);
      expect(backup.manifest.complete).toBe(true);
      expect(backup.manifest.revision).toBe(h.seedRevision);
      expect(backup.manifest.evidence).toHaveLength(1);
      expect(backup.manifest.knowledge.files.map((file) => file.path)).toContain(
        `features/${FEATURE_ID}/README.md`,
      );
      expect(backup.manifest.git?.bytes).toBeGreaterThan(0);

      const targetDir = makeTempDir('agentdev-restore-');
      const dataDir = join(targetDir, 'state');
      const repoRoot = join(targetDir, 'repo');
      const restored = restoreProject({
        backupDir,
        targetDir,
        dataDir,
        repoRoot,
        git: createBackupGit(),
        probe: createMemoryProcessProbe({ 'pid:1000': false }),
        now: () => TIME,
      });
      if (!restored.ok) throw new Error(`${restored.code}: ${restored.message}`);
      expect(restored.ok).toBe(true);
      expect(restored.status).toBe('ready');
      expect(restored.consistency.treeMatches).toBe(true);
      expect(restored.consistency.knowledgeMatchesTree).toBe(true);
      expect(restored.consistency.evidenceVerified).toBe(1);
      expect(restored.doctor.ok).toBe(true);
      expect(restored.doctor.executionReady).toBe(true);
      expect(restored.revision).toBe(h.seedRevision);

      // The restored files really exist in the new directory.
      expect(existsSync(join(repoRoot, 'src/orders/cancel.ts'))).toBe(true);
      expect(existsSync(join(repoRoot, 'docs/agentdev/features', FEATURE_ID, 'README.md'))).toBe(
        true,
      );
      expect(
        requireValue<string | null>(port.resolveRevision(repoRoot, DELIVERY_REF), 'restored ref'),
      ).toBe(h.seedRevision);

      // The restored database is the same Project, remapped to the new root, with
      // its evidence blob present and hash-verified.
      const reopened = Store.open({ dataDir, projectId: h.projectId, canonicalRoot: repoRoot });
      try {
        const project = reopened.projects.find(h.projectId);
        expect(project?.gitRoot).toBe(repoRoot);
        expect(project?.root).toBe(repoRoot);
        const artifacts = reopened.artifacts.list({});
        expect(artifacts).toHaveLength(1);
        const blob = readFileSync(join(dataDir, h.artifactBlobPath));
        expect(blob.toString('utf8')).toBe('verification evidence\n');
      } finally {
        reopened.close();
      }
    } finally {
      h.store.close();
    }
  });

  it('requires recovery for the active Run and revokes every old lease and grant', () => {
    const h = harness();
    try {
      const backupDir = makeTempDir('agentdev-backup-out-');
      const backup = backupProject({
        store: h.store,
        git: createBackupGit(),
        outputDir: backupDir,
      });
      if (!backup.ok) throw new Error(`${backup.code}: ${backup.message}`);
      expect(backup.ok).toBe(true);

      const targetDir = makeTempDir('agentdev-restore-');
      const dataDir = join(targetDir, 'state');
      const repoRoot = join(targetDir, 'repo');
      const restored = restoreProject({
        backupDir,
        targetDir,
        dataDir,
        repoRoot,
        git: createBackupGit(),
        probe: createMemoryProcessProbe({ 'pid:1000': false }),
      });
      if (!restored.ok) throw new Error(`${restored.code}: ${restored.message}`);
      expect(restored.ok).toBe(true);
      expect(restored.recovery.parked.map((entry) => entry.runId)).toEqual([RUN_ACTIVE_ID]);
      expect(restored.recovery.parked[0]?.to).toBe('interrupted');
      expect(restored.recovery.interruptedRunIds).toEqual([RUN_ACTIVE_ID]);
      expect(restored.recovery.revokedLeases).toBeGreaterThanOrEqual(1);
      expect(restored.recovery.revokedGrants).toBe(1);

      const reopened = Store.open({ dataDir, projectId: h.projectId, canonicalRoot: repoRoot });
      try {
        expect(reopened.runs.find(RUN_ACTIVE_ID)?.status).toBe('interrupted');
        expect(reopened.attempts.find(ATTEMPT_ID)?.status).toBe('lost');
        expect(reopened.leases_.list({})).toHaveLength(0);
        const grants = reopened.grants.list({});
        expect(grants).toHaveLength(1);
        expect(grants[0]?.consumedAt).toBeDefined();
        // The completed Work was left alone.
        expect(reopened.works.find(WORK_DONE_ID)?.status).toBe('completed');
      } finally {
        reopened.close();
      }
    } finally {
      h.store.close();
    }
  });

  it('blocks a restored project whose required Secret is missing', () => {
    const h = harness();
    try {
      const backupDir = makeTempDir('agentdev-backup-out-');
      const backup = backupProject({
        store: h.store,
        git: createBackupGit(),
        outputDir: backupDir,
        secretRefs: [SECRET_REF],
      });
      if (!backup.ok) throw new Error(`${backup.code}: ${backup.message}`);
      expect(backup.ok).toBe(true);
      expect(backup.manifest.secretRefs).toEqual([SECRET_REF]);
      // The backup never carries a secret *value*.
      expect(JSON.stringify(backup.manifest)).not.toContain('sk-');

      const blockedTarget = makeTempDir('agentdev-restore-');
      const blockedData = join(blockedTarget, 'state');
      const blocked = restoreProject({
        backupDir,
        targetDir: blockedTarget,
        dataDir: blockedData,
        repoRoot: join(blockedTarget, 'repo'),
        git: createBackupGit(),
        secretAvailable: () => false,
      });
      if (!blocked.ok) throw new Error(`${blocked.code}: ${blocked.message}`);
      expect(blocked.ok).toBe(true);
      expect(blocked.status).toBe('blocked');
      expect(blocked.provider.blocked).toBe(true);
      expect(blocked.provider.missingSecretRefs).toEqual([SECRET_REF]);
      expect(blocked.doctor.executionReady).toBe(false);

      const blockedStore = Store.open({
        dataDir: blockedData,
        projectId: h.projectId,
        canonicalRoot: join(blockedTarget, 'repo'),
      });
      try {
        const operations = blockedStore.operations.list({ where: 'kind = ?', params: ['recover'] });
        expect(operations).toHaveLength(1);
        expect(operations[0]?.state).toBe('failed');
        expect(operations[0]?.error?.['code']).toBe('PROVIDER_UNAVAILABLE');
      } finally {
        blockedStore.close();
      }

      // With the Secret available the same backup restores as runnable.
      const readyTarget = makeTempDir('agentdev-restore-');
      const ready = restoreProject({
        backupDir,
        targetDir: readyTarget,
        dataDir: join(readyTarget, 'state'),
        repoRoot: join(readyTarget, 'repo'),
        git: createBackupGit(),
        secretAvailable: (ref) => ref === SECRET_REF,
      });
      if (!ready.ok) throw new Error(`${ready.code}: ${ready.message}`);
      expect(ready.ok).toBe(true);
      expect(ready.status).toBe('ready');
      expect(ready.provider.blocked).toBe(false);
      expect(ready.doctor.executionReady).toBe(true);
    } finally {
      h.store.close();
    }
  });

  it('refuses an incomplete or tampered backup', () => {
    const h = harness();
    try {
      const backupDir = makeTempDir('agentdev-backup-out-');
      const backup = backupProject({
        store: h.store,
        git: createBackupGit(),
        outputDir: backupDir,
      });
      if (!backup.ok) throw new Error(`${backup.code}: ${backup.message}`);
      expect(backup.ok).toBe(true);

      // 1. A tampered knowledge file fails the hash check.
      const knowledgeFile = join(backupDir, 'knowledge', 'features', FEATURE_ID, 'README.md');
      writeFileSync(
        knowledgeFile,
        readFileSync(knowledgeFile, 'utf8').replace('取消', '删除'),
        'utf8',
      );
      const tampered = restoreProject({
        backupDir,
        targetDir: makeTempDir('agentdev-restore-'),
        git: createBackupGit(),
      });
      expect(tampered.ok).toBe(false);
      if (tampered.ok) throw new Error('unreachable');
      expect(tampered.code).toBe('STALE_ARTIFACT');
      expect(tampered.partial).toBe(false);

      // 2. An `incomplete` manifest is refused outright.
      const manifestPath = join(backupDir, BACKUP_MANIFEST_NAME);
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as BackupManifest;
      writeFileSync(
        manifestPath,
        `${JSON.stringify({ ...manifest, complete: false }, null, 2)}\n`,
        'utf8',
      );
      const incomplete = restoreProject({
        backupDir,
        targetDir: makeTempDir('agentdev-restore-'),
        git: createBackupGit(),
      });
      expect(incomplete.ok).toBe(false);
      if (incomplete.ok) throw new Error('unreachable');
      expect(incomplete.code).toBe('INVALID_STATE');
    } finally {
      h.store.close();
    }
  });

  it('relocates a restored project to a new root and re-checks the doctor', () => {
    const h = harness();
    try {
      const backupDir = makeTempDir('agentdev-backup-out-');
      const backup = backupProject({
        store: h.store,
        git: createBackupGit(),
        outputDir: backupDir,
      });
      if (!backup.ok) throw new Error(`${backup.code}: ${backup.message}`);
      expect(backup.ok).toBe(true);

      const targetDir = makeTempDir('agentdev-restore-');
      const dataDir = join(targetDir, 'state');
      const repoRoot = join(targetDir, 'repo');
      const restored = restoreProject({
        backupDir,
        targetDir,
        dataDir,
        repoRoot,
        git: createBackupGit(),
        probe: createMemoryProcessProbe({ 'pid:1000': false }),
      });
      if (!restored.ok) throw new Error(`${restored.code}: ${restored.message}`);
      expect(restored.ok).toBe(true);

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
      expect(relocated.previousRoot).toBe(repoRoot);
      expect(relocated.repoRoot).toBe(movedRoot);
      expect(existsSync(join(movedRoot, 'src/orders/cancel.ts'))).toBe(true);
      expect(existsSync(repoRoot)).toBe(false);
      expect(relocated.doctor.ok).toBe(true);
      expect(relocated.doctor.executionReady).toBe(true);

      const reopened = Store.open({ dataDir, projectId: h.projectId, canonicalRoot: movedRoot });
      try {
        expect(reopened.projects.find(h.projectId)?.gitRoot).toBe(movedRoot);
        expect(reopened.leases_.list({})).toHaveLength(0);
      } finally {
        reopened.close();
      }
    } finally {
      h.store.close();
    }
  });

  it('refuses a relocate onto a directory that is not this repository, leaving the mapping (W8R1-05)', () => {
    const h = harness();
    try {
      const backupDir = makeTempDir('agentdev-backup-out-');
      const backup = backupProject({
        store: h.store,
        git: createBackupGit(),
        outputDir: backupDir,
      });
      if (!backup.ok) throw new Error(`${backup.code}: ${backup.message}`);

      const targetDir = makeTempDir('agentdev-restore-');
      const dataDir = join(targetDir, 'state');
      const repoRoot = join(targetDir, 'repo');
      const restored = restoreProject({
        backupDir,
        targetDir,
        dataDir,
        repoRoot,
        git: createBackupGit(),
        probe: createMemoryProcessProbe({ 'pid:1000': false }),
      });
      if (!restored.ok) throw new Error(`${restored.code}: ${restored.message}`);

      // An existing directory that is *not* this project's Git repository: the
      // relocate must be refused before the Project row is rewritten.
      const notARepo = makeTempDir('agentdev-relocate-not-a-repo-');
      const refused = relocateProject({ dataDir, newRoot: notARepo, move: false });
      expect(refused.ok).toBe(false);
      if (refused.ok) throw new Error('expected the relocate to be refused');
      expect(refused.code).toBe('INVALID_STATE');
      expect(refused.message).toContain('根映射未改写');

      const reopened = Store.open({ dataDir, projectId: h.projectId, canonicalRoot: repoRoot });
      try {
        expect(reopened.projects.find(h.projectId)?.root).toBe(repoRoot);
        expect(reopened.projects.find(h.projectId)?.gitRoot).toBe(repoRoot);
      } finally {
        reopened.close();
      }

      // A relocate onto the *same* repository still works, so the guard is not
      // vacuous.
      const relocated = relocateProject({
        dataDir,
        newRoot: repoRoot,
        move: false,
        probe: createMemoryProcessProbe({ 'pid:1000': false }),
      });
      expect(relocated.ok).toBe(true);
      if (!relocated.ok) throw new Error(relocated.message);
      expect(relocated.repoRoot).toBe(repoRoot);
      expect(relocated.doctor.ok).toBe(true);
    } finally {
      h.store.close();
    }
  });
});
