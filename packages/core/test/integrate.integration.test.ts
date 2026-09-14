/**
 * WP-12 T4b round 3 (step 3/4/5/6): the Accept/Integrate → Settlement chain of the L2
 * route against a **real temporary Git repository**, a **real SQLite file** and the
 * **real services** the daemon assembles (`workflow.md` §3/§7, `reliability.md` §4/§9,
 * AC-010/AC-012/AC-041/AC-081).
 *
 * Nothing here is a seeded result: each Task's candidate commit is produced by
 * `createTaskCandidateService` (the same producer `stage.submit` calls), the integration
 * is the real `runIntegration` under the shared `integration:<projectId>` lock, and the
 * settlement binds the revision the CAS installed. The negative cases are the exit
 * conditions: a Task without a frozen manifest, a Task whose manifest disappears before
 * settlement, and two really conflicting candidates — each must refuse with nothing
 * written and the delivery ref unmoved.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ProjectStore as Store, projectIdFromRoot, type ProjectStore } from '@agentdev/storage';
import {
  createCasService,
  createMemoryCasEvents,
  createMemoryCasJournal,
  createNodeWorktreeGitPort,
  runGit,
  type CasJournal,
  type GitResult,
} from '@agentdev/workspace';
import {
  ProjectIntegrationLock,
  SettlementService,
  SnapshotWriter,
  createIntegrateService,
  createRequirementSaveService,
  createTaskCandidateService,
  deliveredCodeTreeHash,
  deliveredKnowledgeTreeHash,
  readFrozenFinalManifest,
  readFrozenVerificationManifest,
  readRequirementPoolAtRevision,
  type IntegrateService,
  type RequirementSaveService,
  type TaskCandidateService,
} from '../src/index.js';

const created: string[] = [];
const DELIVERY_REF = 'refs/heads/agentdev/main';
const WORK_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d9e01';
const REQUIREMENT_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d9e30';
const TASK_A = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d9e10';
const TASK_B = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d9e11';
const TASK_C = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d9e12';
const PLAN_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d9e20';
const CREATE_OP = 'op-create-requirement';
const INTEGRATE_OP = 'op-integrate';
const HASH = 'c'.repeat(64);
const TIME = '2026-09-12T00:00:00.000Z';

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

const port = createNodeWorktreeGitPort();

function requireValue<T>(result: GitResult<T>, what: string): T {
  if (!result.ok) throw new Error(`${what} failed: ${result.errors[0]?.message ?? 'unknown'}`);
  return result.value;
}

/** The six documented headings (`requirements.md` §6). */
function requirementBody(text: string): string {
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
    'AC-081、AC-041。',
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
    '待明确',
    '',
  ].join('\n');
}

function featureMarkdown(revision: string): string {
  return [
    '# 订单取消',
    '',
    '| 字段 | 值 |',
    '|---|---|',
    '| feature_id | F-0a1b2c3d |',
    '| name | 订单取消 |',
    '| module | orders |',
    '| owner_document | docs/agentdev/features/F-0a1b2c3d/README.md |',
    '| design | confirmed |',
    '| design_decision_refs | 无 |',
    '| implementation | partial |',
    '| verification | unverified |',
    '| verification_evidence_refs | 无 |',
    '| verification_coverage | 无 |',
    '| investigation | investigated |',
    '| investigation_scope | 订单取消路由 |',
    `| source_refs | git:${revision}:src/orders.ts |`,
    `| revision | ${revision} |`,
    '',
    '## 用途',
    '',
    '订单取消能力。',
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
    '- src/orders.ts',
    '',
    '## 已知差距',
    '',
    '无已登记差距。',
    '',
    '## 关键决定',
    '',
    '- 按需求确认的行为处理。',
    '',
  ].join('\n');
}

interface Harness {
  readonly repo: string;
  readonly edits: string;
  readonly store: ProjectStore;
  readonly projectId: string;
  readonly snapshots: SnapshotWriter;
  readonly journal: CasJournal;
  readonly requirementSaves: RequirementSaveService;
  readonly candidates: TaskCandidateService;
  readonly integrate: IntegrateService;
  readonly settlement: SettlementService;
  /** The delivery head after the Requirement's `create` commit. */
  readonly requirementHead: string;
}

function harness(): Harness {
  const repo = makeTempDir('agentdev-integrate-repo-');
  const seedRevision = 'a'.repeat(40);
  writeFileAt(repo, 'src/orders.ts', 'export const orders = [];\n');
  writeFileAt(repo, 'docs/agentdev/features/F-0a1b2c3d/README.md', featureMarkdown(seedRevision));
  requireValue(port.initRepository(repo, { branch: 'agentdev/main' }), 'git init');
  requireValue(
    port.commitPaths(repo, 'chore: seed delivery branch', [
      'src/orders.ts',
      'docs/agentdev/features/F-0a1b2c3d/README.md',
    ]),
    'seed commit',
  );

  const dataDir = makeTempDir('agentdev-integrate-state-');
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
    documentRoot: 'docs/agentdev',
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
    purpose: 'integrate and settle the L2 delivery',
    level: 'L2',
    goal: 'deliver the order changes',
    scope: {
      readPaths: ['src'],
      writePaths: ['src'],
      operations: ['read', 'edit'],
      networkTargets: [],
    },
    sourceRef: { kind: 'action', id: PLAN_ID, version: '1' },
    requirementId: REQUIREMENT_ID,
    status: 'running',
    blockerIds: [],
    baseRevision: requireValue<string | null>(
      port.resolveRevision(repo, DELIVERY_REF),
      'seed head',
    ) as string,
    budgetId: budget.id,
    policyRevision: 1,
  });

  const snapshots = new SnapshotWriter({ store });
  const journal = createMemoryCasJournal();
  const events = createMemoryCasEvents();
  const cas = createCasService({ git: port, journal, events });
  const lock = new ProjectIntegrationLock({ projectId, leases: store.leases, now: () => TIME });
  const requirementSaves = createRequirementSaveService({
    store,
    worktrees: port,
    journal,
    events,
    cas,
    lock,
    worktreeRoot: join(dataDir, 'save-worktrees'),
    now: () => TIME,
  });
  const candidates = createTaskCandidateService({
    store,
    worktrees: port,
    snapshots,
    repoRoot: repo,
    worktreeRoot: join(dataDir, 'task-worktrees'),
    now: () => TIME,
  });
  const integrate = createIntegrateService({
    store,
    worktrees: port,
    cas,
    lock,
    projectId,
    repoRoot: repo,
    worktreeRoot: join(dataDir, 'integration-worktrees'),
    snapshots,
    now: () => TIME,
  });
  const settlement = new SettlementService({
    store,
    worktrees: port,
    cas,
    journal,
    events,
    snapshots,
    lock,
    requirementSaves,
    now: () => TIME,
  });

  const h: Harness = {
    repo,
    edits: makeTempDir('agentdev-integrate-edits-'),
    store,
    projectId,
    snapshots,
    journal,
    requirementSaves,
    candidates,
    integrate,
    settlement,
    requirementHead: '',
  };
  // The active Requirement really exists in the pool: the `create` commit moves the
  // delivery ref, so it is the integration baseline every Task starts from.
  const saved = requirementSaves.save({
    operationId: CREATE_OP,
    metadata: {
      schemaVersion: 1,
      id: REQUIREMENT_ID,
      version: 1,
      contentFile: 'content.md',
      createdAt: TIME,
      updatedAt: TIME,
      title: '未付款订单可取消',
      goal: '让未付款订单可取消',
      scope: { readPaths: ['src'], writePaths: ['src'], operations: ['edit'], networkTargets: [] },
      lifecycle: 'active',
      featureIds: ['F-0a1b2c3d'],
      acceptance: [{ id: 'AC-081', given: 'g', when: 'w', then: 't' }],
      openQuestions: [],
      confirmedDecisions: [],
      relatedRequirementIds: [],
    },
    contentMarkdown: requirementBody('未付款订单可取消。'),
    expected: { expectedAbsent: true },
    sourceRef: { kind: 'action', id: CREATE_OP, version: '1' },
    kind: 'create',
    workId: WORK_ID,
  });
  if (!saved.ok) throw new Error(`requirement create failed: ${saved.message}`);
  const head = requireValue<string | null>(port.resolveRevision(repo, DELIVERY_REF), 'head');
  if (head === null) throw new Error('the requirement create commit did not move the ref');
  return { ...h, requirementHead: head };
}

interface TaskSpec {
  readonly taskId: string;
  readonly dependsOn: readonly string[];
  readonly dependencyRevision: string;
}

function addTask(h: Harness, spec: TaskSpec): void {
  h.store.tasks.insert({
    id: spec.taskId,
    projectId: h.projectId,
    workId: WORK_ID,
    planRef: { id: PLAN_ID, version: 1, hash: HASH },
    role: 'backend',
    dependsOn: [...spec.dependsOn],
    dependencyRevision: spec.dependencyRevision,
    dependencyManifestRefs: [],
    scope: { readPaths: ['src'], writePaths: ['src'], operations: [], networkTargets: [] },
    stage: 'done',
    acceptanceIds: ['AC-081'],
  });
}

function candidateInput(
  h: Harness,
  spec: TaskSpec,
  changedPaths: readonly string[],
): Parameters<TaskCandidateService['commit']>[0] {
  return {
    workId: WORK_ID,
    taskId: spec.taskId,
    runId: h.store.newId(),
    role: 'backend',
    level: 'L2',
    route: 'L2',
    planRef: { id: PLAN_ID, version: 1, hash: HASH },
    dependencyRevision: spec.dependencyRevision,
    dependencyManifestRefs: [],
    acceptanceIds: ['AC-081'],
    policyHash: 'b'.repeat(64),
    configHash: 'c'.repeat(64),
    contextSnapshotId: 'd'.repeat(64),
    readLedgerSeq: 3,
    readLedgerHash: 'e'.repeat(64),
    environmentRef: 'container:agentdev-exec:latest',
    changedPaths: [...changedPaths],
    sourceRoot: h.edits,
    message: `feat(task): ${spec.taskId}`,
  };
}

/** Commits one Task candidate through the real producer and returns its revision. */
function commitCandidate(
  h: Harness,
  spec: TaskSpec,
  changedPaths: readonly string[],
  edit: { readonly path: string; readonly content: string },
): string {
  writeFileAt(h.edits, edit.path, edit.content);
  const result = h.candidates.commit(candidateInput(h, spec, changedPaths));
  if (!result.ok) throw new Error(`candidate ${spec.taskId} failed: ${result.message}`);
  return result.revision;
}

function deliveryHead(h: Harness): string | null {
  return requireValue<string | null>(port.resolveRevision(h.repo, DELIVERY_REF), 'ref head');
}

/** The number of commits between two revisions (`git rev-list --count`). */
function commitCountBetween(h: Harness, from: string, to: string): number {
  const result = runGit(['rev-list', '--count', `${from}..${to}`], { cwd: h.repo });
  if (!result.ok) throw new Error(`rev-list failed: ${result.stderr}`);
  return Number.parseInt(result.stdout.trim(), 10);
}

function integrationOperations(h: Harness) {
  return h.store.operations.list({ where: 'kind = ?', params: ['integrate'] });
}

describe('Accept/Integrate and Settlement over real Git (AC-010, AC-012, AC-041, AC-081)', () => {
  it('integrates B-on-A without re-applying the ancestor and settles the Requirement', () => {
    const h = harness();
    try {
      const specA: TaskSpec = {
        taskId: TASK_A,
        dependsOn: [],
        dependencyRevision: h.requirementHead,
      };
      addTask(h, specA);
      const aRevision = commitCandidate(h, specA, ['src/orders.ts'], {
        path: 'src/orders.ts',
        content: 'export const orders = ["A"];\n',
      });
      const specB: TaskSpec = {
        taskId: TASK_B,
        dependsOn: [TASK_A],
        dependencyRevision: aRevision,
      };
      addTask(h, specB);
      const bRevision = commitCandidate(h, specB, ['src/b.ts'], {
        path: 'src/b.ts',
        content: 'import { orders } from "./orders.js";\nexport const b = orders.length;\n',
      });
      // The frozen evidence the integration must consume.
      const manifestA = readFrozenVerificationManifest(
        h.store,
        h.store.tasks.find(TASK_A)?.latestManifestId ?? '',
      );
      const manifestB = readFrozenVerificationManifest(
        h.store,
        h.store.tasks.find(TASK_B)?.latestManifestId ?? '',
      );
      expect(manifestA?.codeRevision).toBe(aRevision);
      expect(manifestB?.codeRevision).toBe(bRevision);

      const integrated = h.integrate.integrate({ workId: WORK_ID, operationId: INTEGRATE_OP });
      expect(integrated.ok, integrated.ok ? '' : integrated.message).toBe(true);
      if (!integrated.ok) throw new Error(integrated.message);
      expect(integrated.revision).toMatch(/^[0-9a-f]{40}$/u);
      expect(integrated.outcome).toBe('integrated');
      // Both Tasks were applied, in dependency order, exactly once each.
      expect(integrated.appliedTaskIds).toEqual([TASK_A, TASK_B]);
      expect(integrated.skippedTaskIds).toEqual([]);
      // AC-081: the integrated tree *is* B's already-verified tree, so A's change was
      // applied once and never re-applied.
      const integratedTree = deliveredCodeTreeHash({
        repoRoot: h.repo,
        revision: integrated.revision,
      });
      const commitsAfterIntegration = commitCountBetween(h, h.requirementHead, integrated.revision);
      expect(commitsAfterIntegration).toBeGreaterThan(0);
      expect(integratedTree).toBe(manifestB?.codeTree);
      expect(integratedTree).not.toBe(manifestA?.codeTree);
      expect(integrated.verificationManifestId).not.toBeNull();
      const integrationManifest = readFrozenVerificationManifest(
        h.store,
        integrated.verificationManifestId ?? '',
      );
      expect(integrationManifest?.codeRevision).toBe(integrated.revision);
      expect(integrationManifest?.codeTree).toBe(integratedTree);
      expect(integrationManifest?.dependencyManifestRefs).toEqual([
        h.store.tasks.find(TASK_B)?.latestManifestId,
      ]);
      // AC-012: the delivery ref moved only through the CAS, to the integrated candidate.
      expect(deliveryHead(h)).toBe(integrated.revision);
      const operations = integrationOperations(h);
      expect(operations).toHaveLength(1);
      expect(operations[0]?.candidateRevision).toBe(integrated.revision);
      expect(operations[0]?.state).toBe('completed');

      // AC-081 again from the other side: integrating the *same* verified results onto the
      // already-integrated target replays no ancestor and creates no new commit.
      const again = h.integrate.integrate({ workId: WORK_ID, operationId: 'op-integrate-dedup' });
      expect(again.ok, again.ok ? '' : again.message).toBe(true);
      if (!again.ok) throw new Error(again.message);
      expect(again.outcome).toBe('noop');
      expect(again.appliedTaskIds).toEqual([]);
      expect(again.applied.every((entry) => entry.alreadyMerged)).toBe(true);
      expect(commitCountBetween(h, h.requirementHead, again.revision)).toBe(
        commitsAfterIntegration,
      );
      expect(deliveryHead(h)).toBe(integrated.revision);

      const settled = h.settlement.settleFromIntegration({
        operationId: INTEGRATE_OP,
        completion: {
          summary: '已完成未付款订单取消',
          verificationSummary: '独立 Test 覆盖 AC-081 与 AC-041',
        },
      });
      expect(settled.ok, settled.ok ? '' : settled.message).toBe(true);
      if (!settled.ok) throw new Error(settled.message);
      expect(settled.revision).toBe(integrated.revision);
      expect(settled.requirementCompleted).toBe(true);
      expect(settled.requirementRecordVersion).toBe(2);

      // The CompletionManifest binds the integrated revision, its code tree and the
      // knowledge tree of the Project's document root.
      const manifest = readFrozenFinalManifest(h.store, settled.manifestHash);
      expect(manifest?.finalRevision).toBe(integrated.revision);
      expect(manifest?.verifiedCodeTree).toBe(integratedTree);
      expect(manifest?.knowledgeTree).toBe(
        deliveredKnowledgeTreeHash({
          repoRoot: h.repo,
          revision: integrated.revision,
          documentRoot: 'docs/agentdev',
        }),
      );
      expect(manifest?.verifiedManifestIds).toEqual([integrated.verificationManifestId]);

      // The Requirement's Git record is completed and the projection agrees with it.
      const row = h.store.requirements.find(REQUIREMENT_ID);
      expect(row?.lifecycle).toBe('completed');
      expect(row?.phase).toBeUndefined();
      expect(row?.recordVersion).toBe(settled.requirementRecordVersion);
      expect(row?.portableRef.hash).toBe(settled.requirementRecordHash);
      const head = deliveryHead(h);
      expect(head).toBe(row?.portableRef.revision);
      if (head === null) throw new Error('the delivery ref has no head after settlement');
      const pool = readRequirementPoolAtRevision({
        git: port,
        repoRoot: h.repo,
        revision: head,
      });
      const record = pool.records.find((entry) => entry.id === REQUIREMENT_ID);
      const metadata = JSON.parse(record?.metadataJson ?? '{}') as {
        lifecycle?: string;
        version?: number;
        completion?: { codeRevision?: string; codeTree?: string };
      };
      expect(metadata.lifecycle).toBe('completed');
      expect(metadata.version).toBe(row?.recordVersion);
      expect(metadata.completion?.codeRevision).toBe(integrated.revision);
      expect(metadata.completion?.codeTree).toBe(integratedTree);
      expect(record?.recordHash).toBe(row?.portableRef.hash);
      expect(record?.contentMarkdown).toContain('已完成未付款订单取消');
    } finally {
      h.store.close();
    }
  });

  it('refuses a Task without a frozen manifest and writes nothing', () => {
    const h = harness();
    try {
      const specA: TaskSpec = {
        taskId: TASK_A,
        dependsOn: [],
        dependencyRevision: h.requirementHead,
      };
      addTask(h, specA);
      commitCandidate(h, specA, ['src/orders.ts'], {
        path: 'src/orders.ts',
        content: 'export const orders = ["A"];\n',
      });
      // A second Task whose Run never froze a manifest: no candidate, no evidence.
      addTask(h, { taskId: TASK_C, dependsOn: [], dependencyRevision: h.requirementHead });

      const refused = h.integrate.integrate({ workId: WORK_ID, operationId: INTEGRATE_OP });
      expect(refused.ok).toBe(false);
      if (refused.ok) throw new Error('unreachable');
      expect(refused.code).toBe('MISSING_CONTEXT');
      expect(refused.branchUntouched).toBe(true);
      // Nothing was written: the ref is still the Requirement head, there is no
      // integration operation and no integration-level manifest.
      expect(deliveryHead(h)).toBe(h.requirementHead);
      expect(integrationOperations(h)).toHaveLength(0);
      expect(
        h.store.snapshots
          .list({ where: "type = 'verification'" })
          .filter((row) => (row.payload as { taskId?: string }).taskId === undefined),
      ).toHaveLength(0);
      const settled = h.settlement.settleFromIntegration({ operationId: INTEGRATE_OP });
      expect(settled.ok).toBe(false);
      if (settled.ok) throw new Error('unreachable');
      expect(settled.code).toBe('NOT_FOUND');
      expect(h.store.requirements.find(REQUIREMENT_ID)?.lifecycle).toBe('active');
    } finally {
      h.store.close();
    }
  });

  it('refuses a real merge conflict and leaves the delivery ref and the manifest untouched', () => {
    const h = harness();
    try {
      const specA: TaskSpec = {
        taskId: TASK_A,
        dependsOn: [],
        dependencyRevision: h.requirementHead,
      };
      const specB: TaskSpec = {
        taskId: TASK_B,
        dependsOn: [],
        dependencyRevision: h.requirementHead,
      };
      addTask(h, specA);
      addTask(h, specB);
      commitCandidate(h, specA, ['src/orders.ts'], {
        path: 'src/orders.ts',
        content: 'export const orders = ["A"];\n',
      });
      commitCandidate(h, specB, ['src/orders.ts'], {
        path: 'src/orders.ts',
        content: 'export const orders = ["B"];\n',
      });

      const refused = h.integrate.integrate({ workId: WORK_ID, operationId: INTEGRATE_OP });
      expect(refused.ok).toBe(false);
      if (refused.ok) throw new Error('unreachable');
      expect(refused.code).toBe('TASK_MERGE_CONFLICT');
      expect(refused.branchUntouched).toBe(true);
      expect(refused.details).toHaveProperty('conflict');
      // The CAS protects HEAD: the ref never moved and no operation/manifest was written.
      expect(deliveryHead(h)).toBe(h.requirementHead);
      expect(integrationOperations(h)).toHaveLength(0);
      expect(
        h.store.snapshots
          .list({ where: "type = 'verification'" })
          .filter((row) => (row.payload as { taskId?: string }).taskId === undefined),
      ).toHaveLength(0);
      expect(h.settlement.settleFromIntegration({ operationId: INTEGRATE_OP }).ok).toBe(false);
      expect(h.store.requirements.find(REQUIREMENT_ID)?.lifecycle).toBe('active');
    } finally {
      h.store.close();
    }
  });

  it('settlement refuses a Task whose manifest vanished before any write', () => {
    const h = harness();
    try {
      const specA: TaskSpec = {
        taskId: TASK_A,
        dependsOn: [],
        dependencyRevision: h.requirementHead,
      };
      addTask(h, specA);
      commitCandidate(h, specA, ['src/orders.ts'], {
        path: 'src/orders.ts',
        content: 'export const orders = ["A"];\n',
      });
      const integrated = h.integrate.integrate({ workId: WORK_ID, operationId: INTEGRATE_OP });
      expect(integrated.ok, integrated.ok ? '' : integrated.message).toBe(true);
      if (!integrated.ok) throw new Error(integrated.message);
      const revisionAfterIntegration = deliveryHead(h);

      // The Task's frozen result is gone: completing the Work would claim evidence that
      // no longer exists.
      const task = h.store.tasks.find(TASK_A);
      h.store.tasks.update(TASK_A, { latestManifestId: undefined }, task?.version ?? 1);

      const refused = h.settlement.settleFromIntegration({ operationId: INTEGRATE_OP });
      expect(refused.ok).toBe(false);
      if (refused.ok) throw new Error('unreachable');
      expect(refused.code).toBe('MISSING_CONTEXT');
      expect(refused.branchUntouched).toBe(true);
      expect(deliveryHead(h)).toBe(revisionAfterIntegration);
      expect(h.store.operations.list({ where: 'kind = ?', params: ['settle'] })).toHaveLength(0);
      expect(h.store.requirements.find(REQUIREMENT_ID)?.lifecycle).toBe('active');
      expect(
        h.store.events
          .readAfter(0, { limit: 500 })
          .some((event) => event.name === 'settlement.completed'),
      ).toBe(false);
    } finally {
      h.store.close();
    }
  });
});
