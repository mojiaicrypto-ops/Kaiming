/**
 * WP-08 T4 — the end-to-end integration drill.
 *
 * One real temporary Git repository and one real SQLite file carry a Requirement
 * through every documented route (L1, L2, document, initialization), the
 * dependent-Task chain, the compare-and-swap integration, settlement with a
 * knowledge patch, the requirement-save/delivery mutex, pause/resume/cancel and
 * the budget barrier.
 *
 * WP-08's own modules are the real ones (`@agentdev/workspace` worktrees/CAS,
 * `requirement-save`, `settlement`, `recovery`), and so are the WP-04..07
 * implementations they build on (knowledge projection, project initialization,
 * Plan gate, Findings/completion, run recovery). Only two things are stubbed, and
 * exactly because WP-08 documents them as out of scope: no model call is made
 * (Runs are the frozen records of a stage) and no container is started (the
 * process table is a deterministic probe where recovery needs one).
 */
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  completionManifestSchema,
  type CompletionManifest,
  type JsonObject,
  type PlanTask,
  type Ref,
  type Role,
  type RunStatus,
  type Scope,
  type WorkStatus,
} from '@agentdev/contracts';
import {
  classifyChange,
  documentRouteRules,
  evaluateStageChain,
  stageOrderFor,
  type StageManifest,
} from '@agentdev/domain';
import {
  buildProjection,
  createInMemoryProjectionCache,
  queryFeatureView,
  REQUIREMENTS_README,
  sha256Hex,
  type FeatureDocumentInput,
} from '@agentdev/knowledge';
import {
  ProjectStore as Store,
  projectIdFromRoot,
  sha256,
  type ProjectStore,
} from '@agentdev/storage';
import {
  NodeGitPort,
  READY_ENTRY_DOCUMENTS,
  createInitializer,
  createJsonFileInitStateStore,
  createNodeFileSystemPort,
  createCasService,
  createMemoryCasEvents,
  createMemoryCasJournal,
  createNodeWorktreeGitPort,
  prepareDependencies,
  verifyTaskStart,
  applyDependencyInputs,
  runIntegration,
  type CasJournal,
  type FileSystemPort,
  type GitResult,
  type TaskDependencyPort,
  type TaskNode,
  type WorktreeGitPort,
} from '@agentdev/workspace';
import {
  ArtifactService,
  FindingService,
  PlanGateService,
  ProjectIntegrationLock,
  RunRecoveryService,
  SettlementService,
  SnapshotWriter,
  applyKnowledgePatch,
  buildFinalManifest,
  buildKnowledgePatch,
  canonicalJson,
  checkCompletionSettlement,
  createMemoryProcessProbe,
  createRequirementSaveService,
  createSqliteProjectionCache,
  deliveredCodeTreeHash,
  freezeFinalManifest,
  professionalSpec,
  readFrozenFinalManifest,
  readRequirementPoolAtRevision,
  requirementPoolCommits,
  type RequirementMetadataDraft,
  type RequirementPoolGitPort,
  type RequirementSaveService,
  type VerifiedManifestInput,
} from '../src/index.js';
import { scanEvents } from '../src/events.js';

const created: string[] = [];
const DELIVERY_REF = 'refs/heads/agentdev/main';
const DECISION_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4d01';
const FEATURE_ID = 'F-0a1b2c3d';
const OTHER_FEATURE_ID = 'F-0f0f0f0f';
const FEATURE_PATH = `docs/agentdev/features/${FEATURE_ID}/README.md`;
const OTHER_FEATURE_PATH = `docs/agentdev/features/${OTHER_FEATURE_ID}/README.md`;
const CODE_PATH = 'src/orders/cancel.ts';
const HASH = 'd'.repeat(64);
const BASE_TIME = Date.parse('2026-09-11T00:00:00.000Z');

function makeTempDir(prefix = 'agentdev-wp08-'): string {
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

/** A deterministic UUIDv7-shaped id derived from a seed (contract `Ref.id`). */
const uuidCache = new Map<string, string>();

function uuidFor(seed: string): string {
  const cached = uuidCache.get(seed);
  if (cached !== undefined) return cached;
  const hex = sha256(seed);
  const value = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-7${hex.slice(13, 16)}-8${hex.slice(
    17,
    20,
  )}-${hex.slice(20, 32)}`;
  uuidCache.set(seed, value);
  return value;
}

function refHead(repo: string, ref = DELIVERY_REF): string | null {
  return gitOk(port.resolveRevision(repo, ref), `resolve ${ref}`);
}

function gitShow(repoRoot: string, revision: string, path: string): GitResult<string | null> {
  const shown = port.pathAtRevision(repoRoot, revision, path);
  if (!shown.ok || shown.value !== true) return { ok: true, value: null };
  const worktree = join(makeTempDir('agentdev-wp08-show-'), 'show');
  gitOk(port.addWorktree({ repoRoot, path: worktree, baseRevision: revision }), 'show worktree');
  const content = readFileSync(join(worktree, path), 'utf8');
  gitOk(port.removeWorktree(repoRoot, worktree, true), 'remove show worktree');
  return { ok: true, value: content };
}

/** The pool reader needs blobs at a revision; the real Git port answers. */
const gitReader: RequirementPoolGitPort = {
  resolveRevision: (repoRoot, revision) => port.resolveRevision(repoRoot, revision),
  listTree: (repoRoot, revision, paths) => port.listTree(repoRoot, revision, paths),
  pathAtRevision: (repoRoot, revision, path) => port.pathAtRevision(repoRoot, revision, path),
  readBlob: (repoRoot, revision, path) => gitShow(repoRoot, revision, path),
};

/** A valid, non-template Feature document (`context.md` §2). */
function featureMarkdown(input: {
  readonly featureId: string;
  readonly name: string;
  readonly path: string;
  readonly revision: string;
  readonly behaviour: string;
  readonly entries: readonly string[];
  readonly implementation?: 'absent' | 'partial' | 'implemented' | 'removed';
  readonly verification?: 'unverified' | 'partial' | 'passed' | 'failed';
}): string {
  return [
    `# ${input.name}`,
    '',
    '| 字段 | 值 |',
    '|---|---|',
    `| feature_id | ${input.featureId} |`,
    `| name | ${input.name} |`,
    '| module | orders |',
    `| owner_document | ${input.path} |`,
    '| design | confirmed |',
    `| design_decision_refs | decision:${DECISION_ID} |`,
    `| implementation | ${input.implementation ?? 'partial'} |`,
    `| verification | ${input.verification ?? 'unverified'} |`,
    '| verification_evidence_refs | 无 |',
    '| verification_coverage | 无 |',
    '| investigation | investigated |',
    '| investigation_scope | 订单取消路由与状态转换 |',
    `| source_refs | git:${input.revision}:${CODE_PATH} |`,
    `| revision | ${input.revision} |`,
    '',
    '## 用途',
    '',
    `${input.name}的能力说明。`,
    '',
    '## 当前行为',
    '',
    input.behaviour,
    '',
    '## 关系',
    '',
    '无',
    '',
    '## 实现入口',
    '',
    ...input.entries.map((entry) => `- ${entry}`),
    '',
    '## 已知差距',
    '',
    '无已登记差距。',
    '',
    '## 关键决定',
    '',
    `- decision:${DECISION_ID}：按需求确认的行为处理。`,
    '',
  ].join('\n');
}

interface Drill {
  readonly repo: string;
  readonly dataDir: string;
  readonly store: ProjectStore;
  readonly projectId: string;
  readonly seedRevision: string;
  readonly port: WorktreeGitPort;
  readonly journal: CasJournal;
  readonly events: ReturnType<typeof createMemoryCasEvents>;
  readonly snapshots: SnapshotWriter;
  readonly artifacts: ArtifactService;
  readonly settlement: SettlementService;
  readonly gates: PlanGateService;
  readonly findings: FindingService;
  readonly lock: ProjectIntegrationLock;
  readonly save: RequirementSaveService;
  now(): string;
}

/** A delivery repository, a Project database and every WP-04..08 service. */
function createDrill(): Drill {
  const repo = makeTempDir();
  gitOk(port.initRepository(repo, { branch: 'agentdev/main' }), 'git init');
  // The seed revision is what every route starts from; the knowledge documents and
  // the code are committed together, as the initialization route would leave them.
  const seedPlaceholder = '0'.repeat(40);
  writeFileAt(repo, CODE_PATH, 'export const cancel = (): boolean => false;\n');
  writeFileAt(
    repo,
    FEATURE_PATH,
    featureMarkdown({
      featureId: FEATURE_ID,
      name: '订单取消',
      path: FEATURE_PATH,
      revision: seedPlaceholder,
      behaviour: '未付款订单可取消。',
      entries: [CODE_PATH],
    }),
  );
  writeFileAt(
    repo,
    OTHER_FEATURE_PATH,
    featureMarkdown({
      featureId: OTHER_FEATURE_ID,
      name: '支付状态',
      path: OTHER_FEATURE_PATH,
      revision: seedPlaceholder,
      behaviour: '付款状态决定可取消范围。',
      entries: ['src/payments/status.ts'],
    }),
  );
  const seed = gitOk<{ revision: string }>(
    port.commitPaths(repo, 'chore: seed delivery branch', [
      CODE_PATH,
      FEATURE_PATH,
      OTHER_FEATURE_PATH,
    ]),
    'seed commit',
  );

  const dataDir = makeTempDir('agentdev-wp08-state-');
  const projectId = projectIdFromRoot(repo);
  let clockMs = BASE_TIME;
  const tick = (): number => {
    clockMs += 1_000;
    return clockMs;
  };
  const now = (): string => new Date(tick()).toISOString();
  const store = Store.open({
    dataDir,
    canonicalRoot: repo,
    migrations: { backup: () => undefined, backupPath: join(dataDir, 'pre.sqlite') },
    repository: { now },
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
  const journal = createMemoryCasJournal();
  const events = createMemoryCasEvents();
  const snapshots = new SnapshotWriter({ store });
  const cas = createCasService({ git: port, journal, events });
  const artifacts = new ArtifactService({
    store,
    blobs: store.blobs,
    now: tick,
  });
  const settlement = new SettlementService({
    store,
    worktrees: port,
    cas,
    journal,
    events,
    snapshots,
    now,
  });
  const gates = new PlanGateService({ store, artifacts });
  const findings = new FindingService({ store, artifacts });
  const lock = new ProjectIntegrationLock({ projectId, leases: store.leases, now });
  const save = createRequirementSaveService({
    store,
    worktrees: port,
    journal,
    events,
    cas,
    lock,
    worktreeRoot: join(dataDir, 'save-worktrees'),
    now,
    keepWorktree: false,
  });
  return {
    repo,
    dataDir,
    store,
    projectId,
    seedRevision: seed.revision,
    port,
    journal,
    events,
    snapshots,
    artifacts,
    settlement,
    gates,
    findings,
    lock,
    save,
    now,
  };
}

const SCOPE_CODE: Scope = {
  readPaths: [CODE_PATH],
  writePaths: [CODE_PATH],
  operations: ['read', 'edit'],
  networkTargets: [],
};

function addWork(
  d: Drill,
  input: {
    readonly id: string;
    readonly level: 'L1' | 'L2' | 'L3';
    readonly intent?: 'delivery' | 'document';
    readonly requirementId?: string;
    readonly scope?: Scope;
    readonly baseRevision?: string;
    readonly status?: WorkStatus;
    readonly tokenLimit?: number;
  },
): string {
  const scope = input.scope ?? SCOPE_CODE;
  const budget = d.store.budgets.insert({
    projectId: d.projectId,
    workId: input.id,
    tokenLimit: input.tokenLimit ?? 100_000,
    tokensUsed: 0,
    tokensReserved: 0,
    activeTimeLimit: 600,
    activeTimeUsed: 0,
    repairLimit: 3,
    repairUsed: 0,
    costKnown: true,
  });
  d.store.works.insert({
    id: input.id,
    projectId: d.projectId,
    intent: input.intent ?? 'delivery',
    purpose: 'WP-08 integration drill',
    level: input.level,
    goal: `deliver ${input.id}`,
    scope,
    sourceRef: { kind: 'message', id: input.id, version: '1' },
    authorizationRef: input.id,
    ...(input.requirementId === undefined ? {} : { requirementId: input.requirementId }),
    status: input.status ?? 'running',
    blockerIds: [],
    baseRevision: input.baseRevision ?? d.seedRevision,
    budgetId: budget.id,
    policyRevision: 1,
  });
  d.store.authorizations.insert({
    id: input.id,
    projectId: d.projectId,
    sourceRef: { kind: 'message', id: input.id, version: '1' },
    workId: input.id,
    goal: `authorized scope for ${input.id}`,
    scope,
    operations: [...scope.operations],
    acceptedAt: new Date(BASE_TIME).toISOString(),
  });
  return budget.id;
}

function addRun(
  d: Drill,
  input: {
    readonly id: string;
    readonly workId: string;
    readonly role: Role;
    readonly stage: string;
    readonly status?: RunStatus;
    readonly taskId?: string;
    readonly dispatchSnapshotId?: string;
    readonly createdAt?: string;
  },
): void {
  d.store.runs.insert({
    id: input.id,
    projectId: d.projectId,
    workId: input.workId,
    ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
    role: input.role,
    purpose:
      input.role === 'review'
        ? 'review'
        : input.role === 'test'
          ? 'test'
          : input.role === 'settlement'
            ? 'settlement'
            : input.role === 'planning'
              ? 'artifact'
              : 'implementation',
    stage: input.stage,
    status: input.status ?? 'completed',
    requiredChild: false,
    join: 'none',
    childIds: [],
    configSnapshotId: HASH,
    contextSnapshotId: sha256(`${input.id}:context`),
    dispatchSnapshotId: input.dispatchSnapshotId ?? sha256(`${input.id}:dispatch`),
    budgetAllocation: 1_000,
    ...(input.createdAt === undefined ? {} : { createdAt: input.createdAt }),
  });
}

function planTask(id: string, acceptanceIds: readonly string[]): PlanTask {
  return {
    id: uuidFor(id),
    role: 'backend',
    goal: `deliver ${id}`,
    paths: [CODE_PATH],
    dependsOn: [],
    acceptanceIds: [...acceptanceIds],
    checks: ['pnpm test:unit'],
  };
}

/** A real candidate commit in a detached worktree, leaving the branch untouched. */
function candidateCommit(
  d: Drill,
  input: {
    readonly name: string;
    readonly path: string;
    readonly content: string;
    readonly baseRevision?: string;
  },
): { readonly worktree: string; readonly revision: string } {
  const worktree = join(makeTempDir('agentdev-wp08-wt-'), input.name);
  gitOk(
    port.addWorktree({
      repoRoot: d.repo,
      path: worktree,
      baseRevision: input.baseRevision ?? d.seedRevision,
    }),
    'git worktree add',
  );
  writeFileAt(worktree, input.path, input.content);
  const commit = gitOk<{ revision: string }>(
    port.commitPaths(worktree, `feat: ${input.name}`, [input.path]),
    'candidate commit',
  );
  return { worktree, revision: commit.revision };
}

function approvedPlan(
  d: Drill,
  input: {
    readonly workId: string;
    readonly runId: string;
    readonly level: 'L1' | 'L2';
    readonly requirementId?: string;
    readonly requestedTokens?: number;
    readonly revision?: string;
    readonly tasks?: readonly PlanTask[];
  },
): Ref {
  const revision = input.revision ?? d.seedRevision;
  const result = d.gates.submitPlan({
    workId: input.workId,
    revision,
    plan: {
      goal: `implement ${input.workId}`,
      scope: SCOPE_CODE,
      interfaceChanges: [],
      dataChanges: [],
      risks: [],
      rollback: [],
      tasks: input.tasks ?? [planTask(`${input.workId}-task`, ['AC-081'])],
    },
    approval: {
      authorizationRef: input.workId,
      runId: input.runId,
      productChanged: false,
      ...(input.requestedTokens === undefined ? {} : { requestedTokens: input.requestedTokens }),
      at: d.now(),
    },
    ...(input.requirementId === undefined ? {} : { requirementId: input.requirementId }),
  });
  if (!result.approved) {
    throw new Error(`expected an approved Plan, got ${result.code}: ${result.message}`);
  }
  return result.planRef;
}

function verifiedManifest(input: {
  readonly workId: string;
  readonly revision: string;
  readonly tree: string;
  readonly acceptanceIds: readonly string[];
  readonly dependencyManifestRefs?: readonly string[];
}): VerifiedManifestInput {
  return {
    manifestId: uuidFor(`${input.workId}:${input.revision}:manifest`),
    workId: input.workId,
    kind: 'integration',
    codeRevision: input.revision,
    codeTree: input.tree,
    acceptanceIds: [...input.acceptanceIds],
    valid: true,
  };
}

function stageView(input: {
  readonly stage: string;
  readonly workId: string;
  readonly route: 'code' | 'document';
  readonly revision?: string;
  readonly dependsOn?: readonly string[];
  readonly candidateDiffRef?: Ref;
}): StageManifest {
  const documentRoute = input.route === 'document';
  return {
    stage: input.stage,
    workId: input.workId,
    planRef: { id: sha256(`${input.workId}:plan`), version: 1, hash: HASH },
    acceptanceIds: ['AC-081'],
    ...(documentRoute
      ? {}
      : {
          codeRevision: input.revision ?? HASH,
          codeTree: HASH,
          environmentRef: sha256(`${input.stage}:env`),
        }),
    ...(input.dependsOn === undefined ? {} : { dependsOn: [...input.dependsOn] }),
    ...(input.candidateDiffRef === undefined ? {} : { candidateDiffRef: input.candidateDiffRef }),
  };
}

function metadataDraft(overrides: Record<string, unknown> = {}): RequirementMetadataDraft {
  return {
    schemaVersion: 1,
    id: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4f01',
    version: 1,
    contentFile: 'content.md',
    createdAt: new Date(BASE_TIME).toISOString(),
    updatedAt: new Date(BASE_TIME).toISOString(),
    title: '未付款订单可取消',
    goal: '让未付款订单可取消',
    scope: { readPaths: [], writePaths: [], operations: ['edit'], networkTargets: [] },
    lifecycle: 'queued',
    featureIds: [],
    acceptance: [{ id: 'AC-091', given: 'g', when: 'w', then: 't' }],
    openQuestions: [],
    confirmedDecisions: [],
    relatedRequirementIds: [],
    ...overrides,
  };
}

function requirementBody(text = '未付款订单可取消。'): string {
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
    'AC-091。',
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

function documentsFor(seedRevision: string): readonly FeatureDocumentInput[] {
  return [
    {
      relativePath: FEATURE_PATH,
      markdown: featureMarkdown({
        featureId: FEATURE_ID,
        name: '订单取消',
        path: FEATURE_PATH,
        revision: seedRevision,
        behaviour: '未付款订单可取消。',
        entries: [CODE_PATH],
      }),
    },
    {
      relativePath: OTHER_FEATURE_PATH,
      markdown: featureMarkdown({
        featureId: OTHER_FEATURE_ID,
        name: '支付状态',
        path: OTHER_FEATURE_PATH,
        revision: seedRevision,
        behaviour: '付款状态决定可取消范围。',
        entries: ['src/payments/status.ts'],
      }),
    },
  ];
}

describe('WP-08 T4 end-to-end integration drill', () => {
  // -------------------------------------------------------------------------
  // L1 route
  // -------------------------------------------------------------------------

  it('runs the L1 route from a CompactPlan to a real CAS and a frozen CompletionManifest', () => {
    const d = createDrill();
    try {
      const classification = classifyChange({
        filesChanged: 1,
        diffLines: 1,
        changedCharacters: 2,
        signals: {
          presentationOnly: true,
          goalSubstitutionExplicit: true,
          unknownsRemain: false,
        },
      });
      expect(classification).toMatchObject({ level: 'L1', lockdown: false, logicChange: false });

      addWork(d, { id: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4a01', level: 'L1' });
      addRun(d, {
        id: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4a02',
        workId: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4a01',
        role: 'chief',
        stage: 'CompactPlan',
      });
      const planRef = approvedPlan(d, {
        workId: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4a01',
        runId: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4a02',
        level: 'L1',
      });
      d.store.tasks.insert({
        id: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4a03',
        workId: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4a01',
        planRef,
        role: 'backend',
        dependsOn: [],
        dependencyManifestRefs: [],
        scope: SCOPE_CODE,
        stage: 'develop',
        acceptanceIds: ['AC-081'],
      });
      const admitted = d.gates.requestCodeWrite({
        workId: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4a01',
        revision: d.seedRevision,
        targets: [CODE_PATH],
        planRef,
      });
      expect(admitted.allowed).toBe(true);

      const candidate = candidateCommit(d, {
        name: 'l1-develop',
        path: CODE_PATH,
        content: 'export const cancel = (): boolean => true;\n',
      });
      const tree = deliveredCodeTreeHash({ repoRoot: d.repo, revision: candidate.revision });

      const manifests = stageOrderFor('code', 'L1') ?? [];
      expect(manifests).toEqual(['Develop', 'Review', 'Settlement']);
      const chain = evaluateStageChain({
        route: 'code',
        level: 'L1',
        manifests: manifests.map((stage, index) =>
          stageView({
            stage,
            workId: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4a01',
            route: 'code',
            revision: candidate.revision,
            ...(index === 0 ? {} : { dependsOn: [manifests[index - 1] ?? ''] }),
          }),
        ),
      });
      expect(chain.ok).toBe(true);

      const built = buildFinalManifest({
        workId: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4a01',
        verifiedManifests: [
          verifiedManifest({
            workId: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4a01',
            revision: candidate.revision,
            tree,
            acceptanceIds: ['AC-081'],
          }),
        ],
        finalRevision: candidate.revision,
        finalTree: tree,
        knowledgeTree: sha256Hex('l1 knowledge tree'),
        settlementResultRef: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4a09',
        changedPaths: [{ path: CODE_PATH, change: 'modified' }],
        codeStartRevision: d.seedRevision,
      });
      if (!built.ok) throw new Error(built.message);
      const frozen = freezeFinalManifest({ snapshots: d.snapshots, manifest: built.manifest });
      expect(readFrozenFinalManifest(d.store, frozen.hash)).toEqual(built.manifest);

      const settled = d.settlement.settle({
        operationId: 'op-l1-settle',
        workId: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4a01',
        ref: DELIVERY_REF,
        expectedRevision: d.seedRevision,
        candidateRevision: candidate.revision,
        candidateTree: tree,
        manifest: built.manifest,
      });
      if (!settled.ok) throw new Error(`${settled.code}: ${settled.message}`);
      expect(settled.revision).toBe(candidate.revision);
      expect(settled.refUpdated).toBe(true);
      expect(settled.emittedEvent).toBe(true);
      expect(refHead(d.repo)).toBe(candidate.revision);
      expect(d.store.works.find('018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4a01')?.status).toBe('completed');
      // The L1 route binds no Requirement, so no board row and no Requirement state.
      expect(
        d.store.requirements.list({
          where: 'work_id = ?',
          params: ['018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4a01'],
        }),
      ).toEqual([]);
    } finally {
      d.store.close();
    }
  });

  // -------------------------------------------------------------------------
  // L2 route
  // -------------------------------------------------------------------------

  it('runs the L2 route Plan/Develop/Review/Test/Settlement and settles the Requirement (AC-081)', () => {
    const d = createDrill();
    try {
      const workId = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4b01';
      const requirementId = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4b02';
      addWork(d, { id: workId, level: 'L2', requirementId });
      d.store.requirements.insert({
        id: requirementId,
        projectId: d.projectId,
        workId,
        title: '未付款订单可取消',
        goal: '让未付款订单可取消',
        lifecycle: 'active',
        phase: 'execute',
        sourceRef: { kind: 'message', id: workId, version: '1' },
        recordVersion: 1,
        portableRef: {
          path: `.agentdev/requirements/${requirementId}`,
          revision: d.seedRevision,
          hash: HASH,
        },
        executionAvailability: 'local',
        evidenceAvailability: 'full',
      });
      addRun(d, {
        id: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4b03',
        workId,
        role: 'planning',
        stage: 'Plan',
      });
      const planRef = approvedPlan(d, {
        workId,
        runId: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4b03',
        level: 'L2',
        requirementId,
      });
      const taskId = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4b04';
      d.store.tasks.insert({
        id: taskId,
        workId,
        requirementId,
        planRef,
        role: 'backend',
        dependsOn: [],
        dependencyManifestRefs: [],
        scope: SCOPE_CODE,
        stage: 'develop',
        acceptanceIds: ['AC-081'],
      });
      expect(d.store.requirements.find(requirementId)?.planRef?.hash).toBe(planRef.hash);

      const candidate = candidateCommit(d, {
        name: 'l2-develop',
        path: CODE_PATH,
        content: 'export const cancel = (): boolean => true;\n',
      });
      const tree = deliveredCodeTreeHash({ repoRoot: d.repo, revision: candidate.revision });

      const stages = ['Plan', 'Develop', 'Review', 'Test', 'Settlement'] as const;
      const chain = evaluateStageChain({
        route: 'code',
        level: 'L2',
        manifests: stages.map((stage, index) =>
          stageView({
            stage,
            workId,
            route: 'code',
            revision: candidate.revision,
            ...(index === 0 ? {} : { dependsOn: [stages[index - 1] ?? ''] }),
          }),
        ),
        requirement: { requirementId, previousLevel: 'L2' },
      });
      expect(chain).toEqual({ ok: true, stages: [...stages] });

      // The manifest chain: five frozen stage manifests, each real, bound by the
      // final CompletionManifest.
      const manifestRefs: string[] = [];
      const frozenManifestHashes: string[] = [];
      for (const stage of stages) {
        const frozen = d.snapshots.freeze('verification', {
          kind: 'verification_manifest',
          schemaVersion: 1,
          workId,
          stage,
          manifest: {
            workId,
            taskId,
            level: 'L2',
            route: 'code',
            planRef: planRef as unknown as JsonObject,
            dependencyRevision: d.seedRevision,
            dependencyManifestRefs: [],
            codeRevision: candidate.revision,
            codeTree: tree,
            policyHash: HASH,
            contextSnapshotId: sha256(`${stage}:context`),
            readLedgerSeq: 0,
            readLedgerHash: HASH,
            configHash: HASH,
            environmentRef: sha256(`${stage}:env`),
            acceptanceIds: ['AC-081'],
          },
        });
        manifestRefs.push(uuidFor(`${workId}:${stage}:manifest`));
        frozenManifestHashes.push(frozen.hash);
      }
      expect(manifestRefs).toHaveLength(5);
      expect(frozenManifestHashes).toHaveLength(5);

      const verified = manifestRefs.map((manifestId) => ({
        manifestId,
        workId,
        kind: 'task' as const,
        codeRevision: candidate.revision,
        codeTree: tree,
        acceptanceIds: ['AC-081'],
        valid: true,
      }));
      const built = buildFinalManifest({
        workId,
        requirementId,
        verifiedManifests: verified,
        finalRevision: candidate.revision,
        finalTree: tree,
        knowledgeTree: sha256Hex('l2 knowledge tree'),
        settlementResultRef: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4b09',
        changedPaths: [{ path: CODE_PATH, change: 'modified' }],
        codeStartRevision: d.seedRevision,
      });
      if (!built.ok) throw new Error(built.message);
      expect(built.manifest.verifiedManifestIds).toEqual(manifestRefs);

      const settled = d.settlement.settle({
        operationId: 'op-l2-settle',
        workId,
        requirementId,
        ref: DELIVERY_REF,
        expectedRevision: d.seedRevision,
        candidateRevision: candidate.revision,
        candidateTree: tree,
        manifest: built.manifest,
      });
      if (!settled.ok) throw new Error(`${settled.code}: ${settled.message}`);
      expect(settled.workCompleted).toBe(true);
      expect(settled.requirementCompleted).toBe(true);
      expect(d.store.works.find(workId)?.status).toBe('completed');
      expect(d.store.requirements.find(requirementId)?.lifecycle).toBe('completed');
      expect(d.store.requirements.find(requirementId)?.finalManifestId).toBe(
        built.manifest.settlementResultRef,
      );
      expect(
        scanEvents(d.store, { names: ['settlement.completed'] }).filter(
          (event) => event.data['operationId'] === 'op-l2-settle',
        ),
      ).toHaveLength(1);
    } finally {
      d.store.close();
    }
  });

  // -------------------------------------------------------------------------
  // Document route
  // -------------------------------------------------------------------------

  it('runs the document route with an independent Review and an integration Finding (AC-083)', () => {
    const d = createDrill();
    try {
      const rules = documentRouteRules('L2');
      expect(rules.stages).toEqual(['Product', 'Planning', 'Review', 'Settlement']);
      expect(rules.codeTestStage).toBe(false);

      const workId = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4c01';
      addWork(d, {
        id: workId,
        level: 'L2',
        intent: 'document',
        scope: {
          readPaths: [FEATURE_PATH],
          writePaths: [FEATURE_PATH],
          operations: ['read', 'edit'],
          networkTargets: [],
        },
      });
      // The document route produces candidate documents, not a development Task.
      expect(d.store.tasks.list({ where: 'work_id = ?', params: [workId] })).toEqual([]);
      const chain = evaluateStageChain({
        route: 'document',
        level: 'L2',
        manifests: [
          stageView({ stage: 'Product', workId, route: 'document' }),
          stageView({ stage: 'Planning', workId, route: 'document', dependsOn: ['Product'] }),
          stageView({
            stage: 'Review',
            workId,
            route: 'document',
            dependsOn: ['Planning'],
            candidateDiffRef: { id: sha256('candidate-diff'), version: 1, hash: HASH },
          }),
          stageView({ stage: 'Settlement', workId, route: 'document', dependsOn: ['Review'] }),
        ],
      });
      expect(chain).toEqual({ ok: true, stages: ['Product', 'Planning', 'Review', 'Settlement'] });

      // AC-083: an integration/document Review raises a Finding bound to the Review
      // Run and its Manifest, with no fabricated taskId.
      const reviewRun = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4c02';
      const reviewManifestId = uuidFor('document-review-manifest');
      addRun(d, { id: reviewRun, workId, role: 'review', stage: 'Review' });
      const documentArtifact = d.artifacts.createAgent({
        run: { id: reviewRun, workId, role: 'review' },
        kind: 'review',
        mime: 'text/markdown',
        bytes: Buffer.from('# review: 文档与索引不一致\n', 'utf8'),
        sourceRevision: d.seedRevision,
      });
      const submitted = d.findings.submitFinding({
        reviewRunId: reviewRun,
        target: {
          targetKind: 'document',
          targetRef: {
            id: uuidFor('document-target'),
            version: 1,
            hash: documentArtifact.contentHash,
          },
        },
        manifestRef: { id: reviewManifestId, version: 1, hash: reviewManifestId },
        finding: {
          description: '文档未记录已确认的取消约束',
          severity: 'P1',
          path: FEATURE_PATH,
        },
        at: d.now(),
      });
      expect(submitted.ok).toBe(true);
      if (!submitted.ok) throw new Error(submitted.message);
      expect(submitted.binding.targetKind).toBe('document');
      expect(submitted.binding.taskId).toBeUndefined();
      expect(submitted.binding.manifestRef.id).toBe(reviewManifestId);

      // The fix advances the Work revision; the verifying Review must be a new,
      // independent Run.
      const fixingRevision = candidateCommit(d, {
        name: 'doc-fix',
        path: FEATURE_PATH,
        content: featureMarkdown({
          featureId: FEATURE_ID,
          name: '订单取消',
          path: FEATURE_PATH,
          revision: d.seedRevision,
          behaviour: '未付款订单可取消；已付款订单被拒绝。',
          entries: [CODE_PATH],
        }),
      }).revision;
      const fixRun = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4c03';
      addRun(d, {
        id: fixRun,
        workId,
        role: 'product',
        stage: 'Product',
        createdAt: new Date(BASE_TIME + 10_000).toISOString(),
      });
      d.artifacts.createAgent({
        run: { id: fixRun, workId, role: 'product' },
        kind: 'diff',
        mime: 'text/markdown',
        bytes: Buffer.from('# 文档修复\n', 'utf8'),
        sourceRevision: fixingRevision,
      });
      const addressed = d.findings.markAddressed({
        findingId: submitted.finding.id,
        actorRole: 'product',
        fixRunId: fixRun,
      });
      expect(addressed.ok).toBe(true);
      if (!addressed.ok) throw new Error(addressed.message);
      expect(d.store.works.find(workId)?.baseRevision).toBe(fixingRevision);

      const verifying = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4c04';
      addRun(d, {
        id: verifying,
        workId,
        role: 'review',
        stage: 'Review',
        createdAt: new Date(BASE_TIME + 20_000).toISOString(),
      });
      d.artifacts.createAgent({
        run: { id: verifying, workId, role: 'review' },
        kind: 'review',
        mime: 'text/markdown',
        bytes: Buffer.from('# review: 修复独立核验通过\n', 'utf8'),
        sourceRevision: fixingRevision,
      });
      const verifyingTest = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4c05';
      addRun(d, {
        id: verifyingTest,
        workId,
        role: 'test',
        stage: 'Test',
        createdAt: new Date(BASE_TIME + 25_000).toISOString(),
      });
      d.artifacts.createAgent({
        run: { id: verifyingTest, workId, role: 'test' },
        kind: 'test',
        mime: 'text/markdown',
        bytes: Buffer.from('# test: 最终组合通过\n', 'utf8'),
        sourceRevision: fixingRevision,
      });
      const testAttempt = d.store.attempts.insert({
        runId: verifyingTest,
        number: 1,
        status: 'running',
        ownerEpoch: 0,
      });
      d.store.stageResults.insert({
        runId: verifyingTest,
        attemptId: testAttempt.id,
        status: 'success',
        summary: 'test passed',
        artifactRefs: [],
        evidenceRefs: [],
        changedPaths: [],
        findingIds: [],
        unknowns: [],
        requestedActions: [],
        readLedgerSeq: 0,
        readLedgerHash: HASH,
        checkResult: {
          status: 'passed',
          checks: [
            {
              acceptanceIds: ['AC-083'],
              command: 'pnpm test:unit',
              environmentRef: uuidFor('document-test-env'),
              inputTree: HASH,
              exitCode: 0,
              outputRef: uuidFor('document-test-output'),
              result: 'passed',
            },
          ],
          uncovered: [],
        },
      });
      const verified = d.findings.verifyFinding({
        findingId: submitted.finding.id,
        actorRole: 'review',
        reviewRun: { runId: verifying },
        testRun: { runId: verifyingTest },
        at: d.now(),
      });
      if (!verified.ok) throw new Error(`${verified.code}: ${verified.message}`);
      expect(verified.ok).toBe(true);
      expect(verified.state).toBe('verified');
      expect(d.store.findings.find(submitted.finding.id)?.state).toBe('verified');
    } finally {
      d.store.close();
    }
  });

  // -------------------------------------------------------------------------
  // Initialization route
  // -------------------------------------------------------------------------

  it('runs the initialization route: interrupted writing resumes by hash and a conflict is never overwritten (AC-029)', () => {
    const git = new NodeGitPort();
    const repo = makeTempDir('agentdev-wp08-init-');
    writeFileAt(repo, 'README.md', '# demo\n');
    writeFileAt(repo, 'src/orders/routes.ts', 'export const routes = [];\n');
    writeFileAt(repo, 'src/payments/model.ts', 'export const model = {} as const;\n');
    gitOk(git.initRepository(repo, { branch: 'main' }), 'git init');
    gitOk(
      git.commit(repo, {
        message: 'feat: seed',
        paths: ['README.md', 'src/orders/routes.ts', 'src/payments/model.ts'],
      }),
      'seed commit',
    );

    const stateFile = join(makeTempDir('agentdev-wp08-init-state-'), 'init.json');
    const inner = createNodeFileSystemPort();
    let writes = 0;
    const failing: FileSystemPort = {
      readFile: (path) => inner.readFile(path),
      writeFile: (path, content) => {
        writes += 1;
        if (writes === 3) throw new Error('模拟写入中断');
        inner.writeFile(path, content);
      },
      pathExists: (path) => inner.pathExists(path),
    };
    const first = createInitializer({
      store: createJsonFileInitStateStore(stateFile),
      git,
      fileSystem: failing,
      now: () => new Date(BASE_TIME).toISOString(),
    });
    const start = first.start({ id: 'init-1', root: repo });
    expect(start.ok).toBe(true);
    // Identifying → Mapping → Confirming → Writing.
    first.step('init-1');
    first.step('init-1');
    const confirming = first.step('init-1');
    if (!confirming.ok) {
      expect(confirming.status).toBe('blocked');
      const confirmed = first.confirm('init-1', {
        authorizationRef: 'user-action:init-1',
        by: 'user',
      });
      expect(confirmed.ok).toBe(true);
    }
    const crashed = first.step('init-1');
    expect(crashed.ok).toBe(false);
    if (crashed.ok || crashed.status !== 'failed') throw new Error('expected an interrupted write');
    expect(crashed.failure.kind).toBe('interrupted');
    expect(crashed.failure.recoverable).toBe(true);
    expect(crashed.record.writes.filter((receipt) => receipt.state === 'written')).toHaveLength(2);

    // A fresh process reads the persisted receipts and writes only what is missing.
    const healthy = createNodeFileSystemPort();
    const second = createInitializer({
      store: createJsonFileInitStateStore(stateFile),
      git,
      fileSystem: healthy,
      now: () => new Date(BASE_TIME).toISOString(),
    });
    const resumed = second.resume('init-1');
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) throw new Error(resumed.errors[0]?.message ?? 'resume failed');
    expect(resumed.done).toBe(true);
    expect(resumed.record.deliveryRef).toBeNull();
    const verifiedReady = second.verifyReady('init-1');
    expect(verifiedReady).toMatchObject({ ok: true });
    for (const entry of READY_ENTRY_DOCUMENTS) {
      expect(healthy.readFile(join(repo, 'docs/agentdev', entry))).not.toBeNull();
    }

    // A user-authored entry document is a content conflict: it is reported, never
    // overwritten, and the gate refuses until the user resolves it.
    const conflictRepo = makeTempDir('agentdev-wp08-init-conflict-');
    const userContent = '# 用户自己的导航\n\n用户手工维护内容。\n';
    writeFileAt(conflictRepo, 'docs/agentdev/PROJECT.md', userContent);
    writeFileAt(conflictRepo, 'src/app/main.ts', 'export const main = 1;\n');
    gitOk(git.initRepository(conflictRepo, { branch: 'main' }), 'conflict git init');
    gitOk(
      git.commit(conflictRepo, {
        message: 'feat: seed with user knowledge',
        paths: ['docs/agentdev/PROJECT.md', 'src/app/main.ts'],
      }),
      'conflict seed commit',
    );
    const conflictInit = createInitializer({
      store: createJsonFileInitStateStore(join(makeTempDir('agentdev-wp08-init-c-'), 'init.json')),
      git,
      now: () => new Date(BASE_TIME).toISOString(),
    });
    conflictInit.start({ id: 'init-2', root: conflictRepo });
    conflictInit.step('init-2');
    conflictInit.step('init-2');
    const conflictConfirming = conflictInit.step('init-2');
    if (!conflictConfirming.ok) {
      expect(
        conflictInit.confirm('init-2', { authorizationRef: 'user-action:init-2', by: 'user' }).ok,
      ).toBe(true);
    }
    const conflicted = conflictInit.step('init-2');
    expect(conflicted.ok).toBe(false);
    if (conflicted.ok || conflicted.status !== 'failed') throw new Error('expected a conflict');
    expect(conflicted.failure.kind).toBe('content-conflict');
    expect(conflicted.failure.details?.['path']).toBe('docs/agentdev/PROJECT.md');
    expect(readFileSync(join(conflictRepo, 'docs/agentdev/PROJECT.md'), 'utf8')).toBe(userContent);
    expect(healthy.pathExists(join(conflictRepo, 'docs/agentdev/INDEX.md'))).toBe(false);
    const refused = conflictInit.resume('init-2');
    expect(refused.ok).toBe(false);
    expect(readFileSync(join(conflictRepo, 'docs/agentdev/PROJECT.md'), 'utf8')).toBe(userContent);
  });

  // -------------------------------------------------------------------------
  // Dependent Tasks (AC-081)
  // -------------------------------------------------------------------------

  it('chains dependent Tasks, invalidates on ancestor change and skips a merged ancestor (AC-081)', () => {
    const d = createDrill();
    try {
      const workId = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e01';
      addWork(d, { id: workId, level: 'L2' });
      addRun(d, {
        id: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e03',
        workId,
        role: 'planning',
        stage: 'Plan',
      });
      approvedPlan(d, {
        workId,
        runId: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e03',
        level: 'L2',
      });

      // A adds an interface; B depends on A and uses it.
      const taskA = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e10';
      const taskB = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e11';
      const manifestA = sha256Hex('manifest-A');
      const revisionA = candidateCommit(d, {
        name: 'task-a',
        path: 'src/orders/api.ts',
        content: 'export const api = (): string => "cancel";\n',
      }).revision;
      const revisionB = candidateCommit(d, {
        name: 'task-b',
        path: 'src/orders/handler.ts',
        content: 'export const handler = (): string => "cancel";\n',
        baseRevision: revisionA,
      }).revision;

      const tasks: TaskNode[] = [
        {
          id: taskA,
          dependsOn: [],
          revision: revisionA,
          recordedDependencyManifestRefs: [],
        },
        {
          id: taskB,
          dependsOn: [taskA],
          revision: revisionB,
          recordedDependencyRevision: revisionA,
          recordedDependencyManifestRefs: [manifestA],
        },
      ];
      const dependencyPort: TaskDependencyPort = {
        tasksForWork: () => tasks,
        latestManifestId: (taskId) => (taskId === taskA ? manifestA : null),
      };
      const plan = prepareDependencies({
        workId,
        port: dependencyPort,
        mergeRevision: (_base, revision) => revision,
      });
      expect(plan.order).toEqual([taskA, taskB]);
      const resolutionB = plan.resolutions.find((entry) => entry.taskId === taskB);
      expect(resolutionB?.dependencyRevision).toBe(revisionA);
      expect(resolutionB?.dependencyManifestRefs).toEqual([manifestA]);

      // B starts from A's frozen result, then the fields are written onto the Task.
      const startOk = verifyTaskStart({
        task: tasks[1] as TaskNode,
        expected: resolutionB!,
        git: port,
        repoRoot: d.repo,
        workId,
      });
      expect(startOk.ok).toBe(true);
      const withDeps = applyDependencyInputs(tasks[1] as TaskNode, resolutionB!);
      expect(withDeps.recordedDependencyRevision).toBe(revisionA);
      expect(withDeps.recordedDependencyManifestRefs).toEqual([manifestA]);

      // An ancestor change makes B's snapshot and verification stale.
      const movedResolution = {
        ...resolutionB!,
        dependencyRevision: revisionB,
      };
      const invalidated = verifyTaskStart({
        task: tasks[1] as TaskNode,
        expected: movedResolution,
        git: port,
        repoRoot: d.repo,
        workId,
      });
      expect(invalidated.ok).toBe(false);
      if (invalidated.ok) throw new Error('unreachable');
      expect(invalidated.code).toBe('STALE_ARTIFACT');
      expect(invalidated.invalidated).toBe(true);

      // The final integration runs at a baseline that already contains A, so A is
      // skipped instead of being cherry-picked again.
      const target = candidateCommit(d, {
        name: 'merged-ancestor',
        path: 'src/orders/notes.md',
        content: '# 交付说明：A 的接口已随基线合并\n',
        baseRevision: revisionA,
      });
      gitOk(
        port.updateRef({
          repoRoot: d.repo,
          ref: DELIVERY_REF,
          newRevision: target.revision,
          expectedOldRevision: d.seedRevision,
        }),
        'install merged ancestor',
      );
      const integrationWorktree = join(makeTempDir('agentdev-wp08-wt-'), 'integration');
      gitOk(
        port.addWorktree({
          repoRoot: d.repo,
          path: integrationWorktree,
          baseRevision: target.revision,
        }),
        'integration worktree',
      );
      const integrated = runIntegration({
        git: port,
        repoRoot: d.repo,
        cas: createCasService({ git: port, journal: d.journal, events: d.events }),
        worktreePath: integrationWorktree,
        operationId: 'op-integrate-dependent',
        ref: DELIVERY_REF,
        targetRevision: target.revision,
        tasks: [
          { taskId: taskA, dependsOn: [], revision: revisionA, dependencyRevision: d.seedRevision },
          {
            taskId: taskB,
            dependsOn: [taskA],
            revision: revisionB,
            dependencyRevision: revisionA,
          },
        ],
        workId,
        dependencyManifestRefs: [manifestA],
      });
      if (!integrated.ok) throw new Error(`${integrated.code}`);
      expect(integrated.skippedTaskIds).toContain(taskA);
      expect(integrated.appliedTaskIds).toContain(taskB);
      expect(integrated.applied.find((entry) => entry.taskId === taskA)?.alreadyMerged).toBe(true);
      expect(refHead(d.repo)).toBe(integrated.revision);
      // A is an ancestor of the integrated revision (never replayed); B's own change
      // travelled into the integration as a replayed commit.
      expect(gitOk(port.isAncestor(d.repo, revisionA, integrated.revision), 'is-ancestor A')).toBe(
        true,
      );
      expect(
        gitOk(port.pathAtRevision(d.repo, integrated.revision, 'src/orders/handler.ts'), 'B path'),
      ).toBe(true);
    } finally {
      d.store.close();
    }
  });

  // -------------------------------------------------------------------------
  // Settlement knowledge patch + cold start (AC-041)
  // -------------------------------------------------------------------------

  it('applies the settlement knowledge patch and a cold-start query finds the updated fact (AC-041)', () => {
    const d = createDrill();
    try {
      const workId = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4f01';
      const requirementId = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4f02';
      addWork(d, { id: workId, level: 'L2', requirementId });
      d.store.requirements.insert({
        id: requirementId,
        projectId: d.projectId,
        workId,
        title: '未付款订单可取消',
        goal: '让未付款订单可取消',
        lifecycle: 'active',
        phase: 'settle',
        sourceRef: { kind: 'message', id: workId, version: '1' },
        recordVersion: 1,
        portableRef: {
          path: `.agentdev/requirements/${requirementId}`,
          revision: d.seedRevision,
          hash: HASH,
        },
        executionAvailability: 'local',
        evidenceAvailability: 'full',
      });

      const patchInput = {
        documentPath: FEATURE_PATH,
        currentMarkdown:
          documentsFor(d.seedRevision).find((doc) => doc.relativePath === FEATURE_PATH)?.markdown ??
          '',
        baseRevision: d.seedRevision,
        codeTreeRevision: d.seedRevision,
        knownIds: [DECISION_ID],
        fields: {
          implementation: 'implemented' as const,
          verification: 'passed' as const,
          verificationEvidenceRefs: [`artifact:${HASH}@1`],
          verificationCoverage: ['未付款可取消', '已付款拒绝'],
          revision: d.seedRevision,
        },
        currentBehaviour: { text: '未付款订单可取消；已付款订单返回已确认的拒绝结果。' },
        entries: [CODE_PATH, 'tests/orders/cancel.test.ts'],
        relations: [
          {
            targetFeatureId: OTHER_FEATURE_ID,
            kind: 'constrained_by' as const,
            reason: '付款状态决定可取消范围',
            source: FEATURE_PATH,
          },
        ],
        invalidationNotes: ['原实现入口 src/orders/cancel-old.ts 已失效（AC-041 失效说明）'],
      };
      const built = buildKnowledgePatch(patchInput);
      expect(built.ok).toBe(true);
      if (!built.ok) throw new Error(JSON.stringify(built.errors));
      expect(built.patch.changedFields).toContain('entries');
      expect(built.patch.changedFields).toContain('invalidationNotes');

      // The settlement candidate is a real commit that carries the patched document.
      const candidate = candidateCommit(d, {
        name: 'settle-knowledge',
        path: FEATURE_PATH,
        content: built.patch.markdown,
      });

      const cache = createSqliteProjectionCache({ store: d.store });
      const applied = applyKnowledgePatch({
        patch: built.patch,
        documents: documentsFor(d.seedRevision),
        revision: candidate.revision,
        codeTreeRevision: d.seedRevision,
        documentRoot: 'docs/agentdev',
        knownIds: [DECISION_ID],
        cache,
      });
      expect(applied.ok).toBe(true);
      if (!applied.ok) throw new Error(JSON.stringify(applied.diagnostics));
      expect(cache.get(candidate.revision, FEATURE_ID)?.state).toBe('valid');

      const tree = deliveredCodeTreeHash({ repoRoot: d.repo, revision: candidate.revision });
      const manifest = buildFinalManifest({
        workId,
        requirementId,
        verifiedManifests: [
          verifiedManifest({
            workId,
            revision: candidate.revision,
            tree,
            acceptanceIds: ['AC-041'],
          }),
        ],
        finalRevision: candidate.revision,
        finalTree: tree,
        knowledgeTree: built.patch.sha256,
        settlementResultRef: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4f09',
        changedPaths: [{ path: FEATURE_PATH, change: 'modified' }],
        codeStartRevision: d.seedRevision,
      });
      if (!manifest.ok) throw new Error(manifest.message);
      const settled = d.settlement.settle({
        operationId: 'op-settle-knowledge',
        workId,
        requirementId,
        ref: DELIVERY_REF,
        expectedRevision: d.seedRevision,
        candidateRevision: candidate.revision,
        candidateTree: tree,
        manifest: manifest.manifest,
      });
      if (!settled.ok) throw new Error(`${settled.code}: ${settled.message}`);

      // The final manifest is frozen and bound to the delivered knowledge tree.
      const frozen = freezeFinalManifest({ snapshots: d.snapshots, manifest: manifest.manifest });
      const readBack = readFrozenFinalManifest(d.store, frozen.hash);
      expect(readBack?.knowledgeTree).toBe(built.patch.sha256);
      expect(readBack?.finalRevision).toBe(candidate.revision);

      // A cold start — a brand-new projection built from the delivered documents
      // alone — finds the updated behaviour, the new entry and the invalidation note.
      const patchedDocuments = documentsFor(d.seedRevision).map((doc) =>
        doc.relativePath === FEATURE_PATH ? { ...doc, markdown: built.patch.markdown } : doc,
      );
      const cold = buildProjection({
        documents: patchedDocuments,
        revision: candidate.revision,
        codeTreeRevision: d.seedRevision,
        documentRoot: 'docs/agentdev',
        knownIds: [DECISION_ID],
        cache: createInMemoryProjectionCache(),
      });
      expect(cold.published).toBe(true);
      if (!cold.published) throw new Error(JSON.stringify(cold.diagnostics));
      const view = queryFeatureView(cold.projection, { featureId: FEATURE_ID, view: 'delivered' });
      expect(view.ok).toBe(true);
      if (!view.ok) throw new Error(view.errors[0]?.message ?? 'view failed');
      const delivered = view.view;
      if (delivered.view !== 'delivered') throw new Error('expected the delivered view');
      expect(delivered.current).toBe(true);
      expect(delivered.currentBehaviour.text).toContain('已付款订单返回已确认的拒绝结果');
      expect(delivered.implementationEntries.map((entry) => entry.path)).toContain(
        'tests/orders/cancel.test.ts',
      );
      expect(delivered.gaps.map((gap) => gap.description)).toContain(
        '原实现入口 src/orders/cancel-old.ts 已失效（AC-041 失效说明）',
      );
      expect(
        cold.projection.index.find((entry) => entry.featureId === FEATURE_ID)?.implementation,
      ).toBe('implemented');
    } finally {
      d.store.close();
    }
  });

  // -------------------------------------------------------------------------
  // Requirement save versus delivery (AC-090/091/093/094)
  // -------------------------------------------------------------------------

  it('serializes a requirement save and a code delivery through the shared lock (AC-091)', () => {
    const d = createDrill();
    try {
      const requirementId = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4f01';
      const workId = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4f10';
      // The delivery takes the Project integration lock first.
      const taken = d.lock.acquire({ ownerAttemptId: 'delivery-attempt', epoch: 1, at: d.now() });
      expect(taken.acquired).toBe(true);
      const busy = d.save.save({
        operationId: 'op-save-concurrent',
        metadata: metadataDraft({ id: requirementId }),
        contentMarkdown: requirementBody(),
        expected: { expectedAbsent: true },
        sourceRef: { kind: 'action', id: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4f99' },
      });
      expect(busy.ok).toBe(false);
      if (busy.ok) throw new Error('unreachable');
      expect(busy.code).toBe('BUSY');
      // Nothing was committed while the lock was held.
      expect(refHead(d.repo)).toBe(d.seedRevision);

      // The delivery integrates a Task cut from the seed baseline, on the same lock.
      addWork(d, { id: workId, level: 'L2' });
      const candidate = candidateCommit(d, {
        name: 'delivery-under-lock',
        path: CODE_PATH,
        content: 'export const cancel = (): boolean => true;\n',
      });
      const integrationWorktree = join(makeTempDir('agentdev-wp08-wt-'), 'integration-lock');
      gitOk(
        port.addWorktree({
          repoRoot: d.repo,
          path: integrationWorktree,
          baseRevision: d.seedRevision,
        }),
        'integration worktree',
      );
      const integrated = runIntegration({
        git: port,
        repoRoot: d.repo,
        cas: createCasService({ git: port, journal: d.journal, events: d.events }),
        worktreePath: integrationWorktree,
        operationId: 'op-delivery-under-lock',
        ref: DELIVERY_REF,
        targetRevision: d.seedRevision,
        tasks: [
          {
            taskId: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4f11',
            dependsOn: [],
            revision: candidate.revision,
            dependencyRevision: d.seedRevision,
          },
        ],
        workId,
      });
      if (!integrated.ok) throw new Error(integrated.code);
      expect(d.lock.release('delivery-attempt', 1)).toBe(true);

      // The save now proceeds on the new baseline; the requirement is not lost and
      // the code commit stays an ancestor (nothing was silently overwritten).
      const saved = d.save.save({
        operationId: 'op-save-concurrent',
        metadata: metadataDraft({ id: requirementId }),
        contentMarkdown: requirementBody(),
        expected: { expectedAbsent: true },
        sourceRef: { kind: 'action', id: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4f99' },
        kind: 'create',
      });
      if (!saved.ok) throw new Error(`${saved.code}: ${saved.message}`);
      expect(saved.git.previousCommit).toBe(integrated.revision);
      expect(saved.operationId).toBe('op-save-concurrent');
      expect(
        gitOk(port.isAncestor(d.repo, integrated.revision, saved.git.commit), 'save ancestry'),
      ).toBe(true);
      expect(saved.recordVersion).toBe(1);
      expect(saved.projection.verdict).not.toBe('conflict');

      // The pool reader sees the committed pair at the new revision (AC-093: both
      // files share one version and travel together).
      const pool = readRequirementPoolAtRevision({
        git: gitReader,
        repoRoot: d.repo,
        revision: saved.git.commit,
      });
      expect(pool.records.map((record) => record.id)).toEqual([requirementId]);
      expect(pool.records[0]?.version).toBe(1);
      expect(pool.records[0]?.recordHash).toBe(saved.recordHash);
      const poolCommits = requirementPoolCommits(pool.records);
      expect(poolCommits.map((entry) => entry.readmePath)).toEqual([REQUIREMENTS_README]);

      // A metadata-only change is not code verification (AC-091).
      const tree = deliveredCodeTreeHash({ repoRoot: d.repo, revision: saved.git.commit });
      const metadataOnly = checkCompletionSettlement({
        work: { id: workId, level: 'L2' },
        route: 'code',
        completion: {
          completedAt: new Date(BASE_TIME).toISOString(),
          summary: '需求保存',
          codeRevision: saved.git.commit,
          codeTree: tree,
          featureIds: [],
          verificationSummary: '无',
          remainingIssues: [],
        },
        finalRevision: saved.git.commit,
        finalTree: tree,
        settlement: {
          finalRevision: saved.git.commit,
          codeTree: tree,
          updatedDocs: [],
          unresolved: [],
        },
        verifiedManifests: [
          {
            id: sha256Hex('save-manifest'),
            workId,
            kind: 'integration',
            codeRevision: saved.git.commit,
            codeTree: tree,
            acceptanceIds: ['AC-091'],
            valid: true,
          },
        ],
        changedPaths: [
          { path: saved.recordPath + '/requirement.json', change: 'added' },
          { path: saved.recordPath + '/content.md', change: 'added' },
          { path: REQUIREMENTS_README, change: 'modified' },
        ],
        codeStartRevision: d.seedRevision,
      });
      expect(metadataOnly.ok).toBe(false);
      if (metadataOnly.ok) throw new Error('unreachable');
      expect(metadataOnly.metadataOnly).toBe(true);

      // A stale projection cannot overwrite the Git record (AC-093/AC-094).
      const stale = d.save.save({
        operationId: 'op-save-stale',
        metadata: metadataDraft({ id: requirementId, version: 2, title: '旧投影覆盖' }),
        contentMarkdown: requirementBody('另一份正文。'),
        expected: { recordVersion: 1, recordHash: sha256Hex('not-the-committed-hash') },
        sourceRef: { kind: 'action', id: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4f98' },
        kind: 'update',
      });
      expect(stale.ok).toBe(false);
      if (stale.ok) throw new Error('unreachable');
      expect(stale.code).toBe('REQUIREMENT_CONFLICT');
      expect(refHead(d.repo)).toBe(saved.git.commit);
    } finally {
      d.store.close();
    }
  });

  // -------------------------------------------------------------------------
  // Pause / resume / cancel (AC-020/AC-021)
  // -------------------------------------------------------------------------

  it('still holds pause/resume and unknown-side-effect cancel after an integrated delivery (AC-020, AC-021)', () => {
    const d = createDrill();
    try {
      const workId = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4a10';
      const requirementId = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4a11';
      addWork(d, { id: workId, level: 'L2', requirementId });
      d.store.requirements.insert({
        id: requirementId,
        projectId: d.projectId,
        workId,
        title: '未付款订单可取消',
        goal: '让未付款订单可取消',
        lifecycle: 'active',
        phase: 'execute',
        sourceRef: { kind: 'message', id: workId, version: '1' },
        recordVersion: 1,
        portableRef: {
          path: `.agentdev/requirements/${requirementId}`,
          revision: d.seedRevision,
          hash: HASH,
        },
        executionAvailability: 'local',
        evidenceAvailability: 'full',
      });
      // A real delivery already landed before the pause: the branch must not move.
      const delivered = candidateCommit(d, {
        name: 'delivered-before-pause',
        path: CODE_PATH,
        content: 'export const cancel = (): boolean => true;\n',
      });
      gitOk(
        port.updateRef({
          repoRoot: d.repo,
          ref: DELIVERY_REF,
          newRevision: delivered.revision,
          expectedOldRevision: d.seedRevision,
        }),
        'install delivered revision',
      );

      const runId = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4a12';
      addRun(d, { id: runId, workId, role: 'backend', stage: 'Develop', status: 'running' });
      const attempt = d.store.attempts.insert({
        runId,
        number: 1,
        status: 'running',
        ownerEpoch: 0,
        runnerId: 'pid:4242',
        heartbeatAt: d.now(),
      });
      expect(d.findings.writeAdmission(runId).admitted).toBe(true);

      const paused = d.findings.pauseWork({ workId, reason: '用户暂停', at: d.now() });
      expect(paused.ok).toBe(true);
      if (!paused.ok) throw new Error(paused.message);
      expect(paused.work.status).toBe('paused');
      expect(paused.pausedRuns.map((entry) => entry.runId)).toEqual([runId]);
      expect(paused.attemptsClosed).toBe(1);
      expect(d.store.attempts.find(attempt.id)?.status).not.toBe('running');
      expect(d.findings.writeAdmission(runId).admitted).toBe(false);

      // Resume opens a new Attempt; a write is admitted only once that Attempt is
      // ready (reliability.md §2).
      const resumed = d.findings.resumeWork({
        workId,
        expectedWorkVersion: paused.work.version,
        at: d.now(),
      });
      expect(resumed.ok).toBe(true);
      if (!resumed.ok) throw new Error(resumed.message);
      expect(resumed.attempts).toHaveLength(1);
      expect(d.findings.writeAdmission(runId).admitted).toBe(false);
      const opened = resumed.attempts[0];
      if (opened === undefined) throw new Error('unreachable');
      d.store.attempts.update(opened.attemptId, { status: 'running' }, 1);
      expect(d.findings.writeAdmission(runId).admitted).toBe(true);

      // Cancel with unknown side effects stops at blocked(recovery), keeps the
      // Requirement active, and only `accept_cancel` reaches cancelled.
      const cancelled = d.findings.cancelWork({
        workId,
        reason: '用户取消',
        sideEffectsUnknown: true,
        at: d.now(),
      });
      expect(cancelled.ok).toBe(true);
      if (!cancelled.ok) throw new Error(cancelled.message);
      expect(cancelled.status).toBe('blocked');
      expect(cancelled.recoveryRequired).toBe(true);
      expect(cancelled.integrated).toBe(false);
      expect(cancelled.requirementStatus).toBeNull();
      expect(d.store.requirements.find(requirementId)?.lifecycle).toBe('active');
      expect(refHead(d.repo)).toBe(delivered.revision);

      const decisionId = cancelled.recoveryDecisionId;
      if (decisionId === null) throw new Error('expected a recovery decision');
      const resolved = d.findings.resolveCancellation({
        workId,
        decisionId,
        disposition: 'accept_cancel',
        at: d.now(),
      });
      expect(resolved.ok).toBe(true);
      if (!resolved.ok) throw new Error(resolved.message);
      expect(resolved.status).toBe('cancelled');
      expect(resolved.requirementStatus).toBe('cancelled');
      expect(resolved.integrated).toBe(false);
      expect(d.store.requirements.find(requirementId)?.lifecycle).toBe('cancelled');
      // The earlier delivery is not rolled back.
      expect(refHead(d.repo)).toBe(delivered.revision);
      expect(d.findings.writeAdmission(runId).admitted).toBe(false);
    } finally {
      d.store.close();
    }
  });

  // -------------------------------------------------------------------------
  // Budget (AC-022)
  // -------------------------------------------------------------------------

  it('refuses an over-limit budget reservation atomically and keeps the refusal after integration (AC-022)', () => {
    const d = createDrill();
    try {
      const workId = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4a20';
      const budgetId = addWork(d, { id: workId, level: 'L2', tokenLimit: 100 });
      addRun(d, {
        id: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4a21',
        workId,
        role: 'planning',
        stage: 'Plan',
      });
      const artifactsBefore = d.store.artifacts.count();
      const over = d.gates.submitPlan({
        workId,
        revision: d.seedRevision,
        plan: {
          goal: 'implement',
          scope: SCOPE_CODE,
          interfaceChanges: [],
          dataChanges: [],
          risks: [],
          rollback: [],
          tasks: [planTask('t-over', ['AC-022'])],
        },
        approval: {
          authorizationRef: workId,
          runId: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4a21',
          productChanged: false,
          requestedTokens: 150,
          at: d.now(),
        },
      });
      expect(over.approved).toBe(false);
      if (over.approved) throw new Error('unreachable');
      expect(over.code).toBe('BUDGET_EXCEEDED');
      // Atomic: no reservation, no artifact, no snapshot.
      expect(d.store.budgets.find(budgetId)?.tokensReserved).toBe(0);
      expect(d.store.artifacts.count()).toBe(artifactsBefore);

      const first = approvedPlan(d, {
        workId,
        runId: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4a21',
        level: 'L2',
        requestedTokens: 60,
      });
      expect(first.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(d.store.budgets.find(budgetId)?.tokensReserved).toBe(60);

      const second = d.gates.submitPlan({
        workId,
        revision: d.seedRevision,
        plan: {
          goal: 'implement again',
          scope: SCOPE_CODE,
          interfaceChanges: [],
          dataChanges: [],
          risks: [],
          rollback: [],
          tasks: [planTask('t-second', ['AC-022'])],
        },
        approval: {
          authorizationRef: workId,
          runId: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4a21',
          productChanged: false,
          requestedTokens: 60,
          at: d.now(),
        },
      });
      expect(second.approved).toBe(false);
      expect(d.store.budgets.find(budgetId)?.tokensReserved).toBe(60);

      // After a real integration the same refusal still holds: no silent top-up.
      const candidate = candidateCommit(d, {
        name: 'budget-baseline-move',
        path: CODE_PATH,
        content: 'export const cancel = (): boolean => true;\n',
      });
      const integrationWorktree = join(makeTempDir('agentdev-wp08-wt-'), 'integration-budget');
      gitOk(
        port.addWorktree({
          repoRoot: d.repo,
          path: integrationWorktree,
          baseRevision: d.seedRevision,
        }),
        'integration worktree',
      );
      const integrated = runIntegration({
        git: port,
        repoRoot: d.repo,
        cas: createCasService({ git: port, journal: d.journal, events: d.events }),
        worktreePath: integrationWorktree,
        operationId: 'op-integrate-budget',
        ref: DELIVERY_REF,
        targetRevision: d.seedRevision,
        tasks: [
          {
            taskId: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4a22',
            dependsOn: [],
            revision: candidate.revision,
            dependencyRevision: d.seedRevision,
          },
        ],
        workId,
      });
      if (!integrated.ok) throw new Error(integrated.code);
      const afterIntegration = d.gates.submitPlan({
        workId,
        revision: d.seedRevision,
        plan: {
          goal: 'implement after integration',
          scope: SCOPE_CODE,
          interfaceChanges: [],
          dataChanges: [],
          risks: [],
          rollback: [],
          tasks: [planTask('t-third', ['AC-022'])],
        },
        approval: {
          authorizationRef: workId,
          runId: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4a21',
          productChanged: false,
          requestedTokens: 60,
          at: d.now(),
        },
      });
      expect(afterIntegration.approved).toBe(false);
      expect(d.store.budgets.find(budgetId)?.tokensReserved).toBe(60);
    } finally {
      d.store.close();
    }
  });

  // -------------------------------------------------------------------------
  // Narrow scope across a restart (AC-082)
  // -------------------------------------------------------------------------

  it('preserves the narrow DispatchSnapshot scope across a restart recovery (AC-082)', () => {
    const d = createDrill();
    try {
      const workId = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4a30';
      addWork(d, {
        id: workId,
        level: 'L2',
        scope: {
          readPaths: ['.', 'src'],
          writePaths: ['src'],
          operations: ['read', 'search', 'edit', 'write'],
          networkTargets: [],
        },
      });
      const narrow: Scope = {
        readPaths: [CODE_PATH],
        writePaths: [CODE_PATH],
        operations: ['read', 'edit'],
        networkTargets: [],
      };
      const spec = professionalSpec({
        workId,
        role: 'backend',
        purpose: 'implementation',
        goal: 'investigate one file',
        scope: narrow,
        stage: 'develop',
        contextSelection: {
          goal: 'investigate one file',
          sourceRefs: [],
          reasonPerSource: {},
          featureRefs: [],
          codePaths: [...narrow.readPaths],
          artifactRefs: [],
          excluded: [],
          unknowns: [],
          readBudget: { initialTokens: 1_000, expansionTokens: 1_000 },
        },
        profileRevision: 1,
        requiredOutputs: ['stage.submit'],
        requiredChild: true,
        joinPolicy: 'all',
        budgetAllocation: 1_000,
        parentRunId: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4a31',
      });
      const withoutHash = {
        dispatchSpec: spec,
        effectiveScope: narrow,
        requiredOutputSchemas: [{ kind: 'stage.submit', schemaVersion: 1 as const }],
        profileRevision: 1,
        contextSnapshotId: HASH,
      };
      const dispatchHash = sha256(canonicalJson(withoutHash));
      const dispatchSnapshotId = d.snapshots.freeze(
        'dispatch',
        { ...withoutHash, hash: dispatchHash } as unknown as JsonObject,
        { identityPayload: withoutHash as unknown as JsonObject },
      ).hash;

      const runId = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4a32';
      addRun(d, {
        id: runId,
        workId,
        role: 'backend',
        stage: 'develop',
        status: 'running',
        dispatchSnapshotId,
      });
      const attempt = d.store.attempts.insert({
        runId,
        number: 1,
        status: 'running',
        ownerEpoch: 0,
        runnerId: 'pid:9999',
        heartbeatAt: new Date(BASE_TIME).toISOString(),
      });
      const lease = d.store.leases.acquire({
        resource: `worktree:${runId}`,
        ownerAttemptId: attempt.id,
        epoch: 0,
        expiresAt: new Date(BASE_TIME + 60_000).toISOString(),
        at: new Date(BASE_TIME).toISOString(),
      });
      expect(lease.acquired).toBe(true);

      // A restart: the old process is gone, the heartbeat is stale.
      const recovery = new RunRecoveryService({
        store: d.store,
        probe: createMemoryProcessProbe({ 'pid:9999': false }),
        now: () => new Date(BASE_TIME + 120_000).toISOString(),
        heartbeatTimeoutMs: 20_000,
      });
      const inspected = recovery.inspect(runId);
      expect(inspected.ok).toBe(true);
      if (!inspected.ok) throw new Error(inspected.message);

      expect(inspected.inspection.action).toBe('park_interrupted');
      expect(inspected.inspection.processAlive).toBe(false);

      const restart = recovery.recoverAfterRestart('daemon-epoch-2');
      expect(restart.previousHostEpoch).toBeNull();
      expect(restart.applied.map((entry) => entry.runId)).toContain(runId);
      expect(restart.applied.find((entry) => entry.runId === runId)?.to).toBe('interrupted');
      expect(d.store.runs.find(runId)?.status).toBe('interrupted');
      expect(
        d.store.leases_.list({ where: 'resource = ?', params: [`worktree:${runId}`] }),
      ).toHaveLength(0);

      // The recovered Run keeps its *narrow* snapshot scope: the wider Work scope
      // cannot replace it.
      const scope = recovery.recoveryScope(runId);
      expect(scope.ok).toBe(true);
      if (!scope.ok) throw new Error(scope.message);
      expect(scope.dispatchSnapshotId).toBe(dispatchSnapshotId);
      expect(scope.effectiveScope).toEqual(narrow);
      expect(scope.workScopeIgnored).toBe(true);
      expect(
        recovery.verifyRecoveredScope(runId, { operation: 'read', path: CODE_PATH }).allowed,
      ).toBe(true);
      expect(
        recovery.verifyRecoveredScope(runId, { operation: 'read', path: 'src/payments.ts' })
          .allowed,
      ).toBe(false);
      expect(
        recovery.verifyRecoveredScope(runId, { operation: 'edit', path: 'src/payments.ts' })
          .allowed,
      ).toBe(false);
      expect(recovery.lastHostEpoch()).toBe('daemon-epoch-2');
    } finally {
      d.store.close();
    }
  });

  it('refuses to resume a Work whose Run was parked with an unconfirmed execution (W8R1-04)', () => {
    const d = createDrill();
    try {
      const workId = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4a60';
      addWork(d, { id: workId, level: 'L2' });
      const runId = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4a61';
      addRun(d, { id: runId, workId, role: 'backend', stage: 'develop', status: 'starting' });
      const attempt = d.store.attempts.insert({
        runId,
        number: 1,
        status: 'starting',
        ownerEpoch: 0,
        runnerId: 'pid:8888',
        heartbeatAt: d.now(),
      });
      const lease = d.store.leases.acquire({
        resource: `worktree:${runId}`,
        ownerAttemptId: attempt.id,
        epoch: 0,
        expiresAt: new Date(BASE_TIME + 600_000).toISOString(),
        at: d.now(),
      });
      expect(lease.acquired).toBe(true);

      // `starting` + a live process parks `interrupted` with a new Attempt withheld.
      const recovery = new RunRecoveryService({
        store: d.store,
        probe: createMemoryProcessProbe({ 'pid:8888': true }),
        now: () => d.now(),
        heartbeatTimeoutMs: 20_000,
      });
      const applied = recovery.recoverRun(runId);
      expect(applied.to).toBe('interrupted');
      expect(applied.inspection.newAttemptAllowed).toBe(false);

      // Pausing the Work holds the interrupted Run; resuming it must refuse instead
      // of opening a second Attempt beside the still-live process.
      const paused = d.findings.pauseWork({ workId, reason: '用户暂停', at: d.now() });
      expect(paused.ok).toBe(true);
      if (!paused.ok) throw new Error(paused.message);
      const refused = d.findings.resumeWork({
        workId,
        expectedWorkVersion: paused.work.version,
        at: d.now(),
      });
      expect(refused.ok).toBe(false);
      if (refused.ok) throw new Error('expected a refusal');
      expect(refused.code).toBe('RECOVERY_REQUIRED');
      expect(refused.message).toContain(runId);
      expect(d.store.attempts.list({ where: 'run_id = ?', params: [runId] })).toHaveLength(1);
      expect(d.store.runs.find(runId)?.status).toBe('interrupted');
    } finally {
      d.store.close();
    }
  });

  // -------------------------------------------------------------------------
  // Manifest schema sanity
  // -------------------------------------------------------------------------
  it('validates the final manifest with the shared contract schema', () => {
    const manifest: CompletionManifest = completionManifestSchema.parse({
      workId: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4a40',
      verifiedManifestIds: [uuidFor('m1')],
      finalRevision: 'a'.repeat(40),
      verifiedCodeTree: HASH,
      knowledgeTree: sha256Hex('knowledge'),
      settlementResultRef: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4a41',
      riskDecisionIds: [],
    });
    expect(manifest.verifiedManifestIds).toHaveLength(1);
    expect(
      completionManifestSchema.safeParse({ ...manifest, knowledgeTree: 'short' }).success,
    ).toBe(false);
  });
});
