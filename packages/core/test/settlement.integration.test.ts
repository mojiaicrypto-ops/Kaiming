/**
 * Settlement against a **real temporary Git repository** and a **real SQLite
 * file**: the final Manifest, the knowledge patch applied through the projection
 * rules, and the crash-after-ref completion (AC-041, AC-063).
 *
 * Nothing here is a stub where the acceptance criteria are about integration
 * state: the delivery branch is a real branch moved by `git update-ref`, the
 * settlement candidate is a real commit in a detached worktree, the frozen
 * `CompletionManifest` lives in the real `snapshot` table, and the knowledge
 * projection cache is the real `feature_projection` table.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CompletionManifest } from '@agentdev/contracts';
import {
  createInMemoryProjectionCache,
  queryFeatureView,
  type FeatureDocumentInput,
} from '@agentdev/knowledge';
import { ProjectStore as Store, projectIdFromRoot, type ProjectStore } from '@agentdev/storage';
import {
  createCasService,
  createMemoryCasEvents,
  createMemoryCasJournal,
  createNodeWorktreeGitPort,
  type CasJournal,
  type GitResult,
} from '@agentdev/workspace';
import {
  SETTLEMENT_COMPLETED_EVENT,
  SettlementService,
  SnapshotWriter,
  applyKnowledgePatch,
  buildFinalManifest,
  buildKnowledgePatch,
  createSqliteProjectionCache,
  deliveredCodeTreeHash,
  freezeFinalManifest,
  readFrozenFinalManifest,
  type VerifiedManifestInput,
} from '../src/index.js';
import { scanEvents } from '../src/events.js';

const created: string[] = [];
const DELIVERY_REF = 'refs/heads/agentdev/main';
const WORK_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e01';
const REQUIREMENT_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e30';
const DECISION_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e50';
const TASK_MANIFEST_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e80';
const SETTLEMENT_RESULT_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e90';
const ARTIFACT_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4a01';
const OPERATION_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4b01';
const FEATURE_ID = 'F-0a1b2c3d';
const OTHER_FEATURE_ID = 'F-0f0f0f0f';
const FEATURE_PATH = `docs/agentdev/features/${FEATURE_ID}/README.md`;
const OTHER_FEATURE_PATH = `docs/agentdev/features/${OTHER_FEATURE_ID}/README.md`;
const HASH = 'c'.repeat(64);
const TIME = '2026-09-11T00:00:00.000Z';

function makeTempDir(prefix = 'agentdev-settle-'): string {
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

/** A valid, non-template Feature document (`context.md` §2). */
function featureMarkdown(input: {
  readonly featureId: string;
  readonly name: string;
  readonly path: string;
  readonly revision: string;
  readonly behaviour: string;
  readonly entries: readonly string[];
  readonly decisionRef: string;
  readonly implementation?: string;
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
    `| design_decision_refs | decision:${input.decisionRef} |`,
    `| implementation | ${input.implementation ?? 'partial'} |`,
    '| verification | unverified |',
    '| verification_evidence_refs | 无 |',
    '| verification_coverage | 无 |',
    '| investigation | investigated |',
    '| investigation_scope | 订单取消路由与状态转换 |',
    `| source_refs | git:${input.revision}:src/orders/cancel.ts |`,
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
    `- decision:${input.decisionRef}：按需求确认的行为处理。`,
    '',
  ].join('\n');
}

interface Harness {
  readonly repo: string;
  readonly store: ProjectStore;
  readonly projectId: string;
  readonly seedRevision: string;
  readonly snapshots: SnapshotWriter;
  readonly settlement: SettlementService;
  readonly journal: CasJournal;
  readonly events: ReturnType<typeof createMemoryCasEvents>;
}

function harness(): Harness {
  const repo = makeTempDir();
  requireValue(port.initRepository(repo, { branch: 'agentdev/main' }), 'git init');
  const seedRevision = 'a'.repeat(40);
  writeFileAt(repo, 'src/orders/cancel.ts', 'export const cancel = (): boolean => false;\n');
  writeFileAt(
    repo,
    FEATURE_PATH,
    featureMarkdown({
      featureId: FEATURE_ID,
      name: '订单取消',
      path: FEATURE_PATH,
      revision: seedRevision,
      behaviour: '未付款订单可取消。',
      entries: ['src/orders/cancel.ts'],
      decisionRef: DECISION_ID,
    }),
  );
  writeFileAt(
    repo,
    OTHER_FEATURE_PATH,
    featureMarkdown({
      featureId: OTHER_FEATURE_ID,
      name: '支付状态',
      path: OTHER_FEATURE_PATH,
      revision: seedRevision,
      behaviour: '付款状态决定可取消范围。',
      entries: ['src/payments/status.ts'],
      decisionRef: DECISION_ID,
    }),
  );
  const seed = requireValue<{ revision: string }>(
    port.commitPaths(repo, 'chore: seed delivery branch', [
      'src/orders/cancel.ts',
      FEATURE_PATH,
      OTHER_FEATURE_PATH,
    ]),
    'seed commit',
  );

  const dataDir = makeTempDir('agentdev-settle-state-');
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
  const journal = createMemoryCasJournal();
  const events = createMemoryCasEvents();
  const snapshots = new SnapshotWriter({ store });
  const settlement = new SettlementService({
    store,
    worktrees: port,
    cas: createCasService({ git: port, journal, events }),
    journal,
    events,
    snapshots,
    now: () => TIME,
  });
  return {
    repo,
    store,
    projectId,
    seedRevision: seed.revision,
    snapshots,
    settlement,
    journal,
    events,
  };
}

function addWork(h: Harness, status: 'running' | 'completed' = 'running'): void {
  const budget = h.store.budgets.insert({
    projectId: h.projectId,
    workId: WORK_ID,
    tokenLimit: 100_000,
    tokensUsed: 0,
    tokensReserved: 0,
    activeTimeLimit: 600,
    activeTimeUsed: 0,
    repairLimit: 3,
    repairUsed: 0,
    costKnown: true,
  });
  h.store.works.insert({
    id: WORK_ID,
    projectId: h.projectId,
    intent: 'delivery',
    purpose: 'settle WP-08',
    level: 'L2',
    goal: 'settle the delivery',
    scope: {
      readPaths: ['src'],
      writePaths: ['src'],
      operations: ['read', 'edit'],
      networkTargets: [],
    },
    sourceRef: { kind: 'message', id: WORK_ID, version: '1' },
    status,
    blockerIds: [],
    baseRevision: h.seedRevision,
    budgetId: budget.id,
    policyRevision: 1,
  });
}

function addRequirement(h: Harness): void {
  h.store.requirements.insert({
    id: REQUIREMENT_ID,
    projectId: h.projectId,
    workId: WORK_ID,
    title: '未付款订单可取消',
    goal: '让未付款订单可取消',
    lifecycle: 'active',
    phase: 'settle',
    sourceRef: { kind: 'message', id: WORK_ID, version: '1' },
    recordVersion: 1,
    portableRef: {
      path: `.agentdev/requirements/${REQUIREMENT_ID}`,
      revision: h.seedRevision,
      hash: HASH,
    },
    executionAvailability: 'local',
    evidenceAvailability: 'full',
  });
}

/** A real candidate commit in a detached worktree, leaving the branch untouched. */
function candidateCommit(h: Harness, name: string, content: string): string {
  const path = makeTempDir('agentdev-settle-wt-');
  requireValue(
    port.addWorktree({ repoRoot: h.repo, path, baseRevision: h.seedRevision }),
    'git worktree add',
  );
  writeFileAt(path, 'src/orders/cancel.ts', content);
  const commit = requireValue<{ revision: string }>(
    port.commitPaths(path, `feat: ${name}`, ['src/orders/cancel.ts']),
    'candidate commit',
  );
  return commit.revision;
}

function commitCount(repo: string): number {
  let revision = requireValue<string | null>(
    port.resolveRevision(repo, DELIVERY_REF),
    'resolve ref',
  );
  const seen = new Set<string>();
  while (revision !== null && !seen.has(revision)) {
    seen.add(revision);
    revision = requireValue<string | null>(
      port.resolveRevision(repo, `${revision}^`),
      'resolve parent',
    );
  }
  return seen.size;
}

function verifiedManifest(overrides: Partial<VerifiedManifestInput> = {}): VerifiedManifestInput {
  return {
    manifestId: TASK_MANIFEST_ID,
    workId: WORK_ID,
    kind: 'task',
    codeRevision: 'b'.repeat(40),
    codeTree: HASH,
    acceptanceIds: ['AC-041'],
    valid: true,
    evidenceRefs: [ARTIFACT_ID],
    ...overrides,
  };
}

describe('Final manifest and settlement consistency (AC-041)', () => {
  it('builds a manifest that binds the verified revision, tree, knowledge and evidence', () => {
    const built = buildFinalManifest({
      workId: WORK_ID,
      requirementId: REQUIREMENT_ID,
      verifiedManifests: [verifiedManifest()],
      finalRevision: 'b'.repeat(40),
      finalTree: HASH,
      knowledgeTree: 'd'.repeat(64),
      settlementResultRef: SETTLEMENT_RESULT_ID,
      riskDecisionIds: [],
      changedPaths: [{ path: 'src/orders/cancel.ts', change: 'modified' }],
      codeStartRevision: 'a'.repeat(40),
      evidenceRefs: ['artifact:two'],
    });
    expect(built.ok).toBe(true);
    if (!built.ok) throw new Error('unreachable');
    expect(built.manifest).toEqual({
      workId: WORK_ID,
      requirementId: REQUIREMENT_ID,
      verifiedManifestIds: [TASK_MANIFEST_ID],
      finalRevision: 'b'.repeat(40),
      verifiedCodeTree: HASH,
      knowledgeTree: 'd'.repeat(64),
      settlementResultRef: SETTLEMENT_RESULT_ID,
      riskDecisionIds: [],
    });
    expect(built.evidence.casRef).toBe(SETTLEMENT_RESULT_ID);
    expect(built.evidence.changedPaths).toEqual([
      { path: 'src/orders/cancel.ts', change: 'modified' },
    ]);
    expect(built.evidence.evidenceRefs).toEqual(['artifact:two', ARTIFACT_ID].sort());
  });

  it('refuses an empty, foreign or stale verification set', () => {
    const base = {
      workId: WORK_ID,
      finalRevision: 'b'.repeat(40),
      finalTree: HASH,
      knowledgeTree: 'd'.repeat(64),
      settlementResultRef: SETTLEMENT_RESULT_ID,
    };
    const empty = buildFinalManifest({ ...base, verifiedManifests: [] });
    expect(empty.ok).toBe(false);
    if (empty.ok) throw new Error('unreachable');
    expect(empty.code).toBe('GATE_NOT_READY');

    const foreign = buildFinalManifest({
      ...base,
      verifiedManifests: [verifiedManifest({ workId: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e02' })],
    });
    expect(foreign.ok).toBe(false);
    if (foreign.ok) throw new Error('unreachable');
    expect(foreign.code).toBe('STALE_ARTIFACT');

    const invalid = buildFinalManifest({
      ...base,
      verifiedManifests: [verifiedManifest({ valid: false })],
    });
    expect(invalid.ok).toBe(false);

    // Evidence verified on another tree can never be reused for this revision.
    const otherTree = buildFinalManifest({
      ...base,
      verifiedManifests: [verifiedManifest({ codeTree: 'e'.repeat(64) })],
    });
    expect(otherTree.ok).toBe(false);
    if (otherTree.ok) throw new Error('unreachable');
    expect(otherTree.reasons.join('；')).toContain('不是最终');

    const badRevision = buildFinalManifest({
      ...base,
      finalRevision: 'not-an-oid',
      verifiedManifests: [verifiedManifest()],
    });
    expect(badRevision.ok).toBe(false);
    if (badRevision.ok) throw new Error('unreachable');
    expect(badRevision.code).toBe('VALIDATION_ERROR');
  });

  it('freezes and reads a CompletionManifest through the real snapshot table', () => {
    const h = harness();
    try {
      const manifest: CompletionManifest = {
        workId: WORK_ID,
        verifiedManifestIds: [TASK_MANIFEST_ID],
        finalRevision: 'b'.repeat(40),
        verifiedCodeTree: HASH,
        knowledgeTree: 'd'.repeat(64),
        settlementResultRef: SETTLEMENT_RESULT_ID,
        riskDecisionIds: [],
      };
      const frozen = freezeFinalManifest({ snapshots: h.snapshots, manifest });
      expect(frozen.created).toBe(true);
      expect(readFrozenFinalManifest(h.store, frozen.hash)).toEqual(manifest);
      // Freezing the same manifest again is idempotent.
      const again = freezeFinalManifest({ snapshots: h.snapshots, manifest });
      expect(again.hash).toBe(frozen.hash);
      expect(again.created).toBe(false);
    } finally {
      h.store.close();
    }
  });
});

describe('Knowledge patch through the projection rules (AC-041)', () => {
  function documents(h: Harness): readonly FeatureDocumentInput[] {
    return [
      {
        relativePath: FEATURE_PATH,
        markdown: featureMarkdown({
          featureId: FEATURE_ID,
          name: '订单取消',
          path: FEATURE_PATH,
          revision: h.seedRevision,
          behaviour: '未付款订单可取消。',
          entries: ['src/orders/cancel.ts'],
          decisionRef: DECISION_ID,
        }),
      },
      {
        relativePath: OTHER_FEATURE_PATH,
        markdown: featureMarkdown({
          featureId: OTHER_FEATURE_ID,
          name: '支付状态',
          path: OTHER_FEATURE_PATH,
          revision: h.seedRevision,
          behaviour: '付款状态决定可取消范围。',
          entries: ['src/payments/status.ts'],
          decisionRef: DECISION_ID,
        }),
      },
    ];
  }

  const patchInput = (h: Harness) => ({
    documentPath: FEATURE_PATH,
    currentMarkdown: documents(h).find((doc) => doc.relativePath === FEATURE_PATH)?.markdown ?? '',
    baseRevision: h.seedRevision,
    codeTreeRevision: h.seedRevision,
    knownIds: [DECISION_ID],
    fields: {
      implementation: 'implemented' as const,
      verification: 'passed' as const,
      verificationEvidenceRefs: [`artifact:${ARTIFACT_ID}@1`],
      verificationCoverage: ['未付款可取消', '已付款拒绝'],
      revision: h.seedRevision,
    },
    currentBehaviour: { text: '未付款订单可取消；已付款订单返回已确认的拒绝结果。' },
    entries: ['src/orders/cancel.ts', 'tests/orders/cancel.test.ts'],
    relations: [
      {
        targetFeatureId: OTHER_FEATURE_ID,
        kind: 'constrained_by' as const,
        reason: '付款状态决定可取消范围',
        source: FEATURE_PATH,
      },
    ],
    invalidationNotes: ['原实现入口 src/orders/cancel-old.ts 已失效（AC-041 失效说明）'],
  });

  it('updates the body, relations and entries and is found by a cold-start query', () => {
    const h = harness();
    try {
      const built = buildKnowledgePatch(patchInput(h));
      expect(built.ok).toBe(true);
      if (!built.ok) throw new Error(JSON.stringify(built.errors));
      const patch = built.patch;
      expect(patch.changedFields).toContain('entries');
      expect(patch.changedFields).toContain('invalidationNotes');
      expect(patch.entries).toEqual(['src/orders/cancel.ts', 'tests/orders/cancel.test.ts']);
      expect(patch.relations).toHaveLength(1);

      const cache = createSqliteProjectionCache({ store: h.store });
      const applied = applyKnowledgePatch({
        patch,
        documents: documents(h),
        revision: h.seedRevision,
        codeTreeRevision: h.seedRevision,
        documentRoot: 'docs/agentdev',
        knownIds: [DECISION_ID],
        cache,
      });
      expect(applied.ok).toBe(true);
      if (!applied.ok) throw new Error(JSON.stringify(applied.diagnostics));
      expect(applied.projection.state).toBe('valid');

      // The durable cache rows are queryable and valid.
      expect(cache.get(h.seedRevision, FEATURE_ID)?.state).toBe('valid');
      expect(cache.revisions()).toEqual([h.seedRevision]);

      // A cold start — a fresh projection built from the documents alone — finds
      // the new behaviour, entry path and invalidation note.
      const cold = applyKnowledgePatch({
        patch,
        documents: documents(h),
        revision: h.seedRevision,
        codeTreeRevision: h.seedRevision,
        documentRoot: 'docs/agentdev',
        knownIds: [DECISION_ID],
        cache: createInMemoryProjectionCache(),
      });
      expect(cold.ok).toBe(true);
      if (!cold.ok) throw new Error('unreachable');
      const view = queryFeatureView(cold.projection, { featureId: FEATURE_ID, view: 'delivered' });
      expect(view.ok).toBe(true);
      if (!view.ok) throw new Error('unreachable');
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
      expect(delivered.constraints).toEqual(['付款状态决定可取消范围']);
      // The navigation/index a new session reads first also carries the feature.
      const indexed = cold.projection.index.find((entry) => entry.featureId === FEATURE_ID);
      expect(indexed?.summary).toContain('订单取消');
      expect(indexed?.implementation).toBe('implemented');
      expect(indexed?.verification).toBe('passed');
    } finally {
      h.store.close();
    }
  });

  it('refuses invalid knowledge, publishes nothing and keeps the last valid projection stale', () => {
    const h = harness();
    try {
      const built = buildKnowledgePatch(patchInput(h));
      expect(built.ok).toBe(true);
      if (!built.ok) throw new Error('unreachable');
      const cache = createSqliteProjectionCache({ store: h.store });
      const valid = applyKnowledgePatch({
        patch: built.patch,
        documents: documents(h),
        revision: h.seedRevision,
        codeTreeRevision: h.seedRevision,
        documentRoot: 'docs/agentdev',
        knownIds: [DECISION_ID],
        cache,
      });
      expect(valid.ok).toBe(true);

      // A patch whose document breaks the format (unknown enum value) is refused.
      const corrupted = {
        ...built.patch,
        sha256: 'f'.repeat(64),
        markdown: built.patch.markdown.replace(
          '| implementation | implemented |',
          '| implementation | shipped |',
        ),
      };
      const refused = applyKnowledgePatch({
        patch: corrupted,
        documents: documents(h),
        revision: 'f'.repeat(40),
        codeTreeRevision: h.seedRevision,
        documentRoot: 'docs/agentdev',
        knownIds: [DECISION_ID],
        cache,
      });
      expect(refused.ok).toBe(false);
      if (refused.ok) throw new Error('unreachable');
      expect(refused.code).toBe('KNOWLEDGE_INVALID');
      expect(refused.diagnostics.length).toBeGreaterThan(0);
      // The last valid projection is retained and visibly stale, never current.
      expect(refused.retained?.state).toBe('stale');
      expect(refused.retained?.revision).toBe(h.seedRevision);
      const staleRow = cache.get(h.seedRevision, FEATURE_ID);
      expect(staleRow?.state).toBe('stale');
      const retained = refused.retained;
      if (retained === null) throw new Error('expected a retained projection');
      const view = queryFeatureView(retained, {
        featureId: FEATURE_ID,
        view: 'delivered',
      });
      expect(view.ok).toBe(true);
      if (!view.ok) throw new Error('unreachable');
      expect(view.view.current).toBe(false);
      expect(view.view.projectionState).toBe('stale');
    } finally {
      h.store.close();
    }
  });

  it('refuses to patch a document that is not valid knowledge', () => {
    const h = harness();
    try {
      const broken = buildKnowledgePatch({
        documentPath: FEATURE_PATH,
        currentMarkdown: '# 订单取消\n\n没有字段表。\n',
        baseRevision: h.seedRevision,
      });
      expect(broken.ok).toBe(false);
      if (broken.ok) throw new Error('unreachable');
      expect(broken.code).toBe('KNOWLEDGE_INVALID');
      expect(broken.errors.length).toBeGreaterThan(0);
    } finally {
      h.store.close();
    }
  });
});

describe('Crash after the ref update: reuse the commit, complete once (AC-063)', () => {
  it('runs the whole settlement path: freeze, CAS and complete once', () => {
    const h = harness();
    try {
      addWork(h);
      addRequirement(h);
      const candidate = candidateCommit(
        h,
        'settlement candidate',
        'export const cancel = (): boolean => true;\n',
      );
      const tree = deliveredCodeTreeHash({ repoRoot: h.repo, revision: candidate });
      const commitTree = requireValue<string | null>(
        port.mergeTree(h.repo, candidate),
        'merge tree',
      );
      if (commitTree === null) throw new Error('candidate has no Git tree');
      const built = buildFinalManifest({
        workId: WORK_ID,
        requirementId: REQUIREMENT_ID,
        verifiedManifests: [
          verifiedManifest({ codeRevision: candidate, codeTree: tree, acceptanceIds: ['AC-041'] }),
        ],
        finalRevision: candidate,
        finalTree: tree,
        knowledgeTree: HASH,
        settlementResultRef: SETTLEMENT_RESULT_ID,
        changedPaths: [{ path: 'src/orders/cancel.ts', change: 'modified' }],
        codeStartRevision: h.seedRevision,
      });
      if (!built.ok) throw new Error(built.message);

      const outcome = h.settlement.settle({
        operationId: OPERATION_ID,
        workId: WORK_ID,
        requirementId: REQUIREMENT_ID,
        ref: DELIVERY_REF,
        expectedRevision: h.seedRevision,
        candidateRevision: candidate,
        candidateTree: tree,
        manifest: built.manifest,
      });
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) throw new Error(outcome.message);
      expect(outcome.revision).toBe(candidate);
      expect(outcome.refUpdated).toBe(true);
      expect(outcome.emittedEvent).toBe(true);
      // W8R1-08: the direct settle path reports the Git tree OID and the SHA256 code
      // tree as two separate, correctly-valued fields.
      expect(outcome.commitTree).toBe(commitTree);
      expect(outcome.codeTreeHash).toBe(tree);
      expect(
        requireValue<string | null>(port.resolveRevision(h.repo, DELIVERY_REF), 'resolve ref'),
      ).toBe(candidate);
      const settledEvents = scanEvents(h.store, { names: [SETTLEMENT_COMPLETED_EVENT] });
      expect(settledEvents).toHaveLength(1);
      expect(settledEvents[0]?.data['commitTree']).toBe(commitTree);
      expect(settledEvents[0]?.data['codeTreeHash']).toBe(tree);
      // The operation is completed with the real CAS revision.
      const operation = h.store.operations.list({ where: 'kind = ?', params: ['settle'] })[0];
      expect(operation?.state).toBe('completed');
      expect(operation?.candidateRevision).toBe(candidate);
      expect(operation?.stepResults['commitTree']).toBe(commitTree);
      expect(operation?.stepResults['codeTree']).toBe(tree);
      // `workflow.md` §5.1: `phase` only applies to an active Requirement, so
      // completing it clears the phase in the same transaction (W8R1-06).
      const settledRow = h.store.requirements.find(REQUIREMENT_ID);
      expect(settledRow?.lifecycle).toBe('completed');
      expect(settledRow?.phase).toBeUndefined();
    } finally {
      h.store.close();
    }
  });

  it('reuses the committed revision, completes the state and emits one event', () => {
    const h = harness();
    try {
      addWork(h);
      addRequirement(h);
      const candidate = candidateCommit(
        h,
        'settlement candidate',
        'export const cancel = (): boolean => true;\n',
      );
      const tree = deliveredCodeTreeHash({ repoRoot: h.repo, revision: candidate });
      const commitTree = requireValue<string | null>(
        port.mergeTree(h.repo, candidate),
        'merge tree',
      );
      if (commitTree === null) throw new Error('candidate has no Git tree');

      const built = buildFinalManifest({
        workId: WORK_ID,
        requirementId: REQUIREMENT_ID,
        verifiedManifests: [
          verifiedManifest({ codeRevision: candidate, codeTree: tree, acceptanceIds: ['AC-063'] }),
        ],
        finalRevision: candidate,
        finalTree: tree,
        knowledgeTree: HASH,
        settlementResultRef: SETTLEMENT_RESULT_ID,
        changedPaths: [{ path: 'src/orders/cancel.ts', change: 'modified' }],
        codeStartRevision: h.seedRevision,
      });
      if (!built.ok) throw new Error(built.message);

      const prepared = h.settlement.prepareSettlement({
        operationId: OPERATION_ID,
        workId: WORK_ID,
        requirementId: REQUIREMENT_ID,
        ref: DELIVERY_REF,
        expectedRevision: h.seedRevision,
        candidateRevision: candidate,
        candidateTree: tree,
        manifest: built.manifest,
      });
      expect(prepared.ok).toBe(true);
      if (!prepared.ok) throw new Error(prepared.message);
      // The durable intent is already persisted (state `running`) and the manifest
      // is frozen before the ref moves.
      expect(readFrozenFinalManifest(h.store, prepared.prepared.manifestHash)).toEqual(
        built.manifest,
      );

      // CRASH POINT: the ref moves, then the process dies before the state is written.
      const cas = createCasService({
        git: port,
        journal: h.journal,
        events: h.events,
      }).integrate(prepared.prepared.casRequest);
      expect(cas.ok).toBe(true);
      expect(
        requireValue<string | null>(port.resolveRevision(h.repo, DELIVERY_REF), 'resolve ref'),
      ).toBe(candidate);
      const commitsBefore = commitCount(h.repo);
      expect(scanEvents(h.store, { names: [SETTLEMENT_COMPLETED_EVENT] })).toHaveLength(0);

      const recovered = h.settlement.recover(OPERATION_ID);
      expect(recovered.ok).toBe(true);
      if (!recovered.ok) throw new Error(recovered.message);
      expect(recovered.revision).toBe(candidate);
      // W8R1-08: the Git tree OID and the SHA256 code tree stay distinct on both
      // paths, instead of sharing one `tree` field whose meaning depended on the path.
      expect(recovered.codeTreeHash).toBe(tree);
      expect(recovered.commitTree).toBe(commitTree);
      expect(recovered.commitTree).not.toBe(recovered.codeTreeHash);
      expect(recovered.reusedCommit).toBe(true);
      expect(recovered.refUpdated).toBe(false);
      expect(recovered.emittedEvent).toBe(true);
      expect(recovered.workCompleted).toBe(true);
      expect(recovered.requirementCompleted).toBe(true);

      // No duplicate commit and exactly one completion event.
      expect(commitCount(h.repo)).toBe(commitsBefore);
      expect(
        requireValue<string | null>(port.resolveRevision(h.repo, DELIVERY_REF), 'resolve ref'),
      ).toBe(candidate);
      const events = scanEvents(h.store, { names: [SETTLEMENT_COMPLETED_EVENT] });
      expect(events).toHaveLength(1);
      expect(events[0]?.data['revision']).toBe(candidate);
      expect(h.store.works.find(WORK_ID)?.status).toBe('completed');
      expect(h.store.requirements.find(REQUIREMENT_ID)?.lifecycle).toBe('completed');
      // W8R1-06: the completed row carries no stale `phase`.
      expect(h.store.requirements.find(REQUIREMENT_ID)?.phase).toBeUndefined();
      const operation = h.store.operations.list({ where: 'kind = ?', params: ['settle'] })[0];
      expect(operation?.state).toBe('completed');
      expect(operation?.candidateRevision).toBe(candidate);

      // Replaying the recovery is idempotent: same commit, same single event.
      const replay = h.settlement.recover(OPERATION_ID);
      expect(replay.ok).toBe(true);
      if (!replay.ok) throw new Error('unreachable');
      expect(replay.emittedEvent).toBe(false);
      expect(replay.revision).toBe(candidate);
      expect(commitCount(h.repo)).toBe(commitsBefore);
      expect(scanEvents(h.store, { names: [SETTLEMENT_COMPLETED_EVENT] })).toHaveLength(1);
    } finally {
      h.store.close();
    }
  });

  it('installs the existing commit when the ref never moved (crash before the CAS)', () => {
    const h = harness();
    try {
      addWork(h);
      const candidate = candidateCommit(
        h,
        'settlement candidate',
        'export const cancel = (): boolean => true;\n',
      );
      const tree = deliveredCodeTreeHash({ repoRoot: h.repo, revision: candidate });
      const built = buildFinalManifest({
        workId: WORK_ID,
        verifiedManifests: [verifiedManifest({ codeRevision: candidate, codeTree: tree })],
        finalRevision: candidate,
        finalTree: tree,
        knowledgeTree: HASH,
        settlementResultRef: SETTLEMENT_RESULT_ID,
      });
      if (!built.ok) throw new Error(built.message);
      const prepared = h.settlement.prepareSettlement({
        operationId: OPERATION_ID,
        workId: WORK_ID,
        ref: DELIVERY_REF,
        expectedRevision: h.seedRevision,
        candidateRevision: candidate,
        candidateTree: tree,
        manifest: built.manifest,
      });
      expect(prepared.ok).toBe(true);
      const commitsBefore = commitCount(h.repo);

      const recovered = h.settlement.recover(OPERATION_ID);
      expect(recovered.ok).toBe(true);
      if (!recovered.ok) throw new Error(recovered.message);
      expect(recovered.revision).toBe(candidate);
      expect(recovered.refUpdated).toBe(true);
      expect(commitCount(h.repo)).toBe(commitsBefore + 1);
      expect(scanEvents(h.store, { names: [SETTLEMENT_COMPLETED_EVENT] })).toHaveLength(1);
    } finally {
      h.store.close();
    }
  });

  it('refuses to recover onto an unrelated delivery revision', () => {
    const h = harness();
    try {
      addWork(h);
      const candidate = candidateCommit(
        h,
        'settlement candidate',
        'export const cancel = (): boolean => true;\n',
      );
      const tree = deliveredCodeTreeHash({ repoRoot: h.repo, revision: candidate });
      const built = buildFinalManifest({
        workId: WORK_ID,
        verifiedManifests: [verifiedManifest({ codeRevision: candidate, codeTree: tree })],
        finalRevision: candidate,
        finalTree: tree,
        knowledgeTree: HASH,
        settlementResultRef: SETTLEMENT_RESULT_ID,
      });
      if (!built.ok) throw new Error(built.message);
      const prepared = h.settlement.prepareSettlement({
        operationId: OPERATION_ID,
        workId: WORK_ID,
        ref: DELIVERY_REF,
        expectedRevision: h.seedRevision,
        candidateRevision: candidate,
        candidateTree: tree,
        manifest: built.manifest,
      });
      expect(prepared.ok).toBe(true);

      // Someone else moved the branch to a third revision.
      const stranger = candidateCommit(
        h,
        'stranger',
        'export const cancel = (): string => "stranger";\n',
      );
      requireValue(
        port.updateRef({
          repoRoot: h.repo,
          ref: DELIVERY_REF,
          newRevision: stranger,
          expectedOldRevision: h.seedRevision,
        }),
        'stranger ref update',
      );
      const recovered = h.settlement.recover(OPERATION_ID);
      expect(recovered.ok).toBe(false);
      if (recovered.ok) throw new Error('unreachable');
      expect(recovered.code).toBe('VERSION_CONFLICT');
      expect(recovered.branchUntouched).toBe(true);
      expect(
        requireValue<string | null>(port.resolveRevision(h.repo, DELIVERY_REF), 'resolve ref'),
      ).toBe(stranger);
      expect(scanEvents(h.store, { names: [SETTLEMENT_COMPLETED_EVENT] })).toHaveLength(0);
    } finally {
      h.store.close();
    }
  });
});
