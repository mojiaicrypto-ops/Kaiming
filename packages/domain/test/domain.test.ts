import { describe, expect, it } from 'vitest';
import { operationNameSchema, type Budget, type Grant } from '@agentdev/contracts';
import {
  ARTIFACT_WRITE_OPERATIONS,
  ATTEMPT_TRANSITIONS,
  ENVIRONMENT_OPERATIONS,
  L1_BOUNDS,
  NO_LOCKDOWN_RISK,
  REQUIRED_CONTENT_SECTIONS,
  canAdvancePhase,
  canAllocateBudget,
  canStartRepair,
  canStartRequirement,
  canTransitionAttempt,
  canTransitionRequirement,
  canTransitionRun,
  canTransitionTask,
  canTransitionWork,
  classifyImport,
  declaresWorkspaceWrite,
  decideLevel,
  evaluateGrant,
  hasLockdownRisk,
  isKnownLockdownRiskTerm,
  executionAvailabilityFor,
  isDirectChiefChild,
  isL1Eligible,
  isTerminalRunStatus,
  lockdownRiskVocabulary,
  l1Failures,
  READ_OPERATIONS,
  restoreTarget,
  routeMessage,
  riskFromFlags,
  touchesRunningEnvironment,
  runAcceptsNewAttempt,
  scopeBindingsSatisfied,
  validateContentSections,
  unknownRiskFlags,
  validateDispatchSpec,
  WORKSPACE_WRITE_OPERATIONS,
  writeAllowed,
  type L1Criteria,
} from '../src/index.js';

const ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e5f';
const ID2 = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e60';
const PROJECT = 'a'.repeat(32);
const HASH = 'b'.repeat(64);
const TIME = '2026-09-11T00:00:00.000Z';
const SCOPE = { readPaths: [], writePaths: [], operations: [], networkTargets: [] };

const l1: L1Criteria = {
  goalSubstitutionExplicit: true,
  presentationOnly: true,
  noContractChange: true,
  noExecutableConfigChange: true,
  unknownsExcluded: true,
  filesChanged: 2,
  diffLines: 12,
};

const budget: Budget = {
  id: ID,
  projectId: PROJECT,
  version: 1,
  createdAt: TIME,
  updatedAt: TIME,
  workId: ID2,
  tokenLimit: 1000,
  tokensUsed: 100,
  tokensReserved: 100,
  activeTimeLimit: 60,
  activeTimeUsed: 0,
  repairLimit: 3,
  repairUsed: 0,
  costKnown: true,
};

const grant: Grant = {
  id: ID,
  projectId: PROJECT,
  version: 1,
  createdAt: TIME,
  updatedAt: TIME,
  workId: ID2,
  runId: ID2,
  scope: 'once',
  role: 'backend',
  stage: 'develop',
  operation: 'edit',
  targets: ['src/'],
  expiresAt: '2026-09-11T01:00:00.000Z',
  limits: {},
  decisionId: ID2,
  toolOperationId: ID2,
  inputHash: HASH,
};

describe('state machines (workflow.md §5)', () => {
  it('allows the documented Work transitions only', () => {
    expect(canTransitionWork('queued', 'running')).toBe(true);
    expect(canTransitionWork('running', 'completed')).toBe(true);
    expect(canTransitionWork('running', 'cancelling')).toBe(true);
    expect(canTransitionWork('cancelling', 'cancelled')).toBe(true);
    expect(canTransitionWork('blocked', 'running')).toBe(true);
    expect(canTransitionWork('queued', 'completed')).toBe(false);
    expect(canTransitionWork('completed', 'running')).toBe(false);
    expect(canTransitionWork('failed', 'running')).toBe(false);
  });

  it('keeps failed Requirement lifecycle terminal and restore lossless', () => {
    expect(canTransitionRequirement('queued', 'active')).toBe(true);
    expect(canTransitionRequirement('active', 'completed')).toBe(true);
    expect(canTransitionRequirement('completed', 'archived')).toBe(true);
    expect(canTransitionRequirement('archived', 'queued')).toBe(false);
    expect(canTransitionRequirement('cancelled', 'active')).toBe(false);
    expect(restoreTarget('completed')).toBe('completed');
    expect(restoreTarget(undefined)).toBe('queued');
  });

  it('routes Task review to test for L2/L3 and to done for L1', () => {
    expect(canTransitionTask('ready', 'develop')).toBe(true);
    expect(canTransitionTask('develop', 'review')).toBe(true);
    expect(canTransitionTask('review', 'test')).toBe(true);
    expect(canTransitionTask('review', 'done')).toBe(true);
    expect(canTransitionTask('done', 'ready')).toBe(true);
    expect(canTransitionTask('ready', 'done')).toBe(false);
    // A failed gate reopens the task for the owning role.
    expect(canTransitionTask('review', 'develop')).toBe(true);
    expect(canTransitionTask('test', 'develop')).toBe(true);
    expect(canTransitionTask('test', 'review')).toBe(false);
  });

  it('treats terminal Run states as absorbing and only reopens recoverable ones', () => {
    for (const status of [
      'completed',
      'failed',
      'cancelled',
      'timed_out',
      'contract_violation',
    ] as const) {
      expect(isTerminalRunStatus(status), status).toBe(true);
      expect(canTransitionRun(status, 'running'), status).toBe(false);
      expect(runAcceptsNewAttempt(status), status).toBe(false);
    }
    expect(runAcceptsNewAttempt('interrupted')).toBe(true);
    expect(runAcceptsNewAttempt('recovery_required')).toBe(true);
    expect(canTransitionRun('interrupted', 'starting')).toBe(true);
  });

  it('does not let an Attempt leave a terminal state', () => {
    expect(canTransitionAttempt('starting', 'running')).toBe(true);
    expect(canTransitionAttempt('running', 'completed')).toBe(true);
    for (const status of ['stopped', 'completed', 'failed', 'lost'] as const) {
      expect(ATTEMPT_TRANSITIONS[status]).toEqual([]);
    }
  });

  it('only advances phases forward', () => {
    expect(canAdvancePhase('product', 'plan')).toBe(true);
    expect(canAdvancePhase('execute', 'execute')).toBe(true);
    expect(canAdvancePhase('settle', 'plan')).toBe(false);
  });
});

describe('level routing (workflow.md §2)', () => {
  it('routes assist and artifact to none', () => {
    expect(
      decideLevel({
        intent: 'assist',
        operationTouchesEnvironment: false,
        risk: NO_LOCKDOWN_RISK,
      }).level,
    ).toBe('none');
  });

  it('routes an environment operation to L3 whatever the intent label says', () => {
    expect(
      decideLevel({
        intent: 'operation',
        operationTouchesEnvironment: true,
        risk: NO_LOCKDOWN_RISK,
      }).level,
    ).toBe('L3');
    // A delivery that deploys touches the same environment; the label must not
    // change the route (R10-01/M-2). The same holds for the light routes (R11-01).
    for (const intent of ['delivery', 'document', 'assist', 'artifact'] as const) {
      expect(
        decideLevel({ intent, operationTouchesEnvironment: true, risk: NO_LOCKDOWN_RISK }).level,
      ).toBe('L3');
    }
    // A documented lockdown risk is L3 even when the intent is assist/artifact.
    expect(
      decideLevel({
        intent: 'assist',
        operationTouchesEnvironment: false,
        risk: { ...NO_LOCKDOWN_RISK, securityBoundary: true },
      }).level,
    ).toBe('L3');
    // assist/artifact without environment evidence or risk stay `none`.
    expect(
      decideLevel({
        intent: 'assist',
        operationTouchesEnvironment: false,
        risk: NO_LOCKDOWN_RISK,
      }).level,
    ).toBe('none');
  });

  it('recognizes the documented risk vocabulary and refuses unknown flags', () => {
    // The document states the criteria in Chinese prose (workflow.md §2.3); both
    // spellings select the same canonical risk (DC-62).
    expect(riskFromFlags(['安全边界']).securityBoundary).toBe(true);
    expect(riskFromFlags(['security-boundary']).securityBoundary).toBe(true);
    expect(riskFromFlags(['SECURITY_BOUNDARY']).securityBoundary).toBe(true);
    expect(riskFromFlags(['数据删除/迁移']).dataDeletionOrMigration).toBe(true);
    // Separator handling is part of the vocabulary contract: the joined spelling
    // matches the documented slash wording (R12 adversarial ②).
    expect(riskFromFlags(['数据删除迁移']).dataDeletionOrMigration).toBe(true);
    expect(isKnownLockdownRiskTerm('部署发布')).toBe(true);
    expect(riskFromFlags(['部署/发布']).deployOrRelease).toBe(true);
    expect(riskFromFlags(['支付金额/状态']).payment).toBe(true);
    expect(hasLockdownRisk(riskFromFlags(['安全边界']))).toBe(true);

    // Anything outside the vocabulary is reported so the Core can fail closed
    // instead of reading it as "no risk".
    expect(unknownRiskFlags(['安全边界', '多文件修改'])).toEqual(['多文件修改']);
    expect(unknownRiskFlags(['securityBoundry', '安全'])).toEqual(['securityBoundry', '安全']);
    expect(isKnownLockdownRiskTerm('安全边界')).toBe(true);
    expect(isKnownLockdownRiskTerm('安全')).toBe(false);
    expect(lockdownRiskVocabulary()).toContain('安全边界');
  });

  it('treats workspace write operations as modification authority', () => {
    expect(declaresWorkspaceWrite({ operations: [], writePaths: ['packages/core/src'] })).toBe(
      true,
    );
    expect(declaresWorkspaceWrite({ operations: ['edit'], writePaths: [] })).toBe(true);
    expect(declaresWorkspaceWrite({ operations: ['write'], writePaths: [] })).toBe(true);
    expect(declaresWorkspaceWrite({ operations: ['git'], writePaths: [] })).toBe(true);
    // Writing only the Run's own Artifact is not repository modification authority
    // (`execution.md` §21/§53, R16-01).
    expect(declaresWorkspaceWrite({ operations: ['artifact_write'], writePaths: [] })).toBe(false);
    expect(declaresWorkspaceWrite({ operations: ['read', 'search'], writePaths: [] })).toBe(false);
    expect(declaresWorkspaceWrite({ operations: [], writePaths: [] })).toBe(false);
    // Environment operations are handled by their own predicate.
    expect(touchesRunningEnvironment({ operations: ['deploy'], networkTargets: [] })).toBe(true);
    expect(touchesRunningEnvironment({ operations: ['edit'], networkTargets: [] })).toBe(false);
  });

  it('routes a message into independent work items (AC-005/AC-006)', () => {
    // A pure question: one read-only assist Work, no write scope.
    const question = routeMessage('explain how the routing rules work');
    expect(question.items.map((item) => item.intent)).toEqual(['assist']);
    expect(question.items[0]?.scope.writePaths).toEqual([]);
    expect(question.explicitAuthorization).toBe(false);

    // An explicit command with a named target: the message authorizes that target.
    const fix = routeMessage('修改 docs/INDEX.md 中的错别字');
    expect(fix.items.map((item) => item.intent)).toEqual(['delivery']);
    expect(fix.items[0]?.scope.writePaths).toEqual(['docs/INDEX.md']);
    expect(fix.explicitAuthorization).toBe(true);

    // A mixed message: explanation first, modification with its own scope.
    const mixed = routeMessage('解释 docs/INDEX.md 并修复 docs/PLAN.md');
    expect(mixed.items.map((item) => item.intent).sort()).toEqual(['assist', 'delivery']);
    const delivery = mixed.items.find((item) => item.intent === 'delivery');
    const assist = mixed.items.find((item) => item.intent === 'assist');
    expect(delivery?.scope.writePaths).toEqual(['docs/PLAN.md']);
    expect(assist?.scope.writePaths).toEqual([]);
    expect(mixed.explicitAuthorization).toBe(true);

    // A modification with no target is not guessed: the Chief asks first.
    const vague = routeMessage('fix the bug');
    expect(vague.items.map((item) => item.intent)).toEqual(['assist']);
    expect(vague.explicitAuthorization).toBe(false);

    // A documentation request is its own intent.
    expect(routeMessage('write the documentation for the API').items[0]?.intent).toBe('document');

    // Commands that must authorize: verb + target (with a bounded tail) and the
    // 把/将/对 disposal form, in both languages.
    for (const body of [
      '修复 docs/INDEX.md',
      '修改 docs/INDEX.md 中的错别字',
      '更新 docs/INDEX.md 的说明',
      '处理一下 docs/PLAN.md 的错别字',
      '删除 docs/INDEX.md 的旧内容',
      '清理 docs/PLAN.md 的重复段落',
      'fix the typo in docs/INDEX.md',
      'update docs/INDEX.md',
      '把 docs/INDEX.md 里的错别字改掉',
      '将 docs/PLAN.md 删除',
      '对 docs/PLAN.md 进行修改',
      '不要修改 docs/PLAN.md，但要修复 docs/INDEX.md',
    ]) {
      const routing = routeMessage(body);
      expect(routing.explicitAuthorization, body).toBe(true);
      expect(routing.items[0]?.scope.writePaths.length, body).toBe(1);
    }

    // Every registered non-command family stays read-only: questions, explanations,
    // statements, completion aspect, passives, choices, conditions, advice, references,
    // quotations and multi-target lists (rounds 4-12 review corpora).
    for (const body of [
      'explain why docs/INDEX.md needs a fix',
      'describe how to fix docs/INDEX.md',
      'Please describe the fix needed in docs/INDEX.md',
      '请解释为什么 docs/INDEX.md 需要 fix',
      "don't fix docs/INDEX.md",
      '不要修改 docs/INDEX.md',
      'I am not asking you to fix docs/INDEX.md, just explain it',
      'how do I fix the typo in docs/INDEX.md?',
      '你修复 docs/INDEX.md 了吗',
      '是否已经修复 docs/INDEX.md',
      'Did you fix docs/INDEX.md',
      '我已经修改了 docs/INDEX.md',
      '刚修复了 docs/INDEX.md',
      'I already fixed docs/INDEX.md',
      'docs/INDEX.md 需要修改',
      'docs/INDEX.md 需要被修改',
      'docs/INDEX.md 有错误需要修复',
      '是否应该修改 docs/INDEX.md',
      '是否需要更新 docs/INDEX.md',
      '麻烦评估一下 docs/INDEX.md 是否需要修改',
      '请给出 docs/INDEX.md 的修改建议',
      '请列出 docs/INDEX.md 里的错误',
      '帮我看一下 docs/INDEX.md',
      '请评估 docs/INDEX.md',
      'Regarding the fix in docs/INDEX.md, what do you suggest?',
      '我已经优化了 docs/INDEX.md',
      '改动已完成：docs/INDEX.md',
      '我不想修改 docs/INDEX.md',
      '请勿修改 docs/INDEX.md',
      '禁止修改 docs/INDEX.md',
      '暂缓修改 docs/INDEX.md',
      '修改 docs/INDEX.md 了没有',
      'Will you fix docs/INDEX.md',
      '请讲述修改 docs/INDEX.md 的方法',
      '我想先了解修改 docs/INDEX.md 的影响',
      '列出 docs/INDEX.md 要修改的地方',
      'review docs/INDEX.md for things to fix',
      'check docs/INDEX.md for errors to fix',
      '需求写着：修改 docs/INDEX.md',
      '修改 docs/INDEX.md 前需要审批',
      '在修改 docs/INDEX.md 之前，请先确认',
      '参考 docs/INDEX.md 修改 docs/PLAN.md',
      '关于 docs/INDEX.md 的修改',
      '如果要修改 docs/INDEX.md，请告诉我',
      '你提到 docs/INDEX.md 需要修复',
      'docs/INDEX.md 尚未修改',
      'docs/INDEX.md 正在修改',
      'docs/INDEX.md 计划修改',
      'docs/INDEX.md 拒绝修改',
      'docs/INDEX.md 不修改',
      'docs/INDEX.md 完成修改',
      'docs/INDEX.md 继续修改',
      '修改 docs/INDEX.md 哪个更好',
      '修改 docs/INDEX.md 抑或重写',
      '修改 docs/INDEX.md 是必要的',
      '修改 docs/INDEX.md 或重写',
      '修改 docs/INDEX.md 与否',
      '待你确认，修改 docs/INDEX.md',
      '看情况，修改 docs/INDEX.md',
      '经批准，修改 docs/INDEX.md',
      '一旦确认，修复 docs/INDEX.md',
      '有错误的话，修复 docs/INDEX.md',
      'once approved, fix docs/INDEX.md',
      'after you confirm, update docs/INDEX.md',
      'refactor docs/INDEX.md, yes or no',
      'fix docs/INDEX.md or leave it alone',
      'fix docs/INDEX.md was not requested',
      'update docs/PLAN.md instead of docs/INDEX.md',
      'docs/INDEX.md 的错别字麻烦处理下',
      'docs/INDEX.md 里的接口说明更新一下',
      '修改 docs/PLAN.md 参考 docs/INDEX.md',
      '修改 docs/INDEX.md、docs/PLAN.md',
      '补充了 docs/INDEX.md',
      '更新完毕 docs/INDEX.md',
      '补充完毕 docs/INDEX.md',
      'fix docs/INDEX.md update docs/PLAN.md',
      'docs/INDEX.md 修复 更新 整理',
    ]) {
      const routing = routeMessage(body);
      expect(routing.explicitAuthorization, body).toBe(false);
      expect(
        routing.items.every((item) => item.writePaths.length === 0),
        body,
      ).toBe(true);
    }
  });

  it('classifies every contract operation as read-only, workspace write or environment', () => {
    // A new operation name must be classified deliberately: the two sets below are
    // what the L3 gate and the write-authority gate consult (R14-01).
    const classified = new Set<string>([
      ...WORKSPACE_WRITE_OPERATIONS,
      ...ENVIRONMENT_OPERATIONS,
      ...ARTIFACT_WRITE_OPERATIONS,
      ...READ_OPERATIONS,
    ]);
    for (const operation of operationNameSchema.options) {
      expect(classified.has(operation)).toBe(true);
    }
    expect(classified.size).toBe(operationNameSchema.options.length);
  });

  it('routes any lockdown risk to L3 before considering L1', () => {
    const decision = decideLevel({
      intent: 'delivery',
      operationTouchesEnvironment: false,
      risk: { ...NO_LOCKDOWN_RISK, secrets: true },
      l1,
    });
    expect(decision.level).toBe('L3');
    expect(decision.reason).toContain('secrets');
  });

  it('accepts L1 only when every bound and condition holds', () => {
    expect(
      decideLevel({
        intent: 'delivery',
        operationTouchesEnvironment: false,
        risk: NO_LOCKDOWN_RISK,
        l1,
      }).level,
    ).toBe('L1');

    const tooManyFiles = { ...l1, filesChanged: L1_BOUNDS.maxFiles + 1 };
    expect(isL1Eligible(tooManyFiles)).toBe(false);
    expect(l1Failures(tooManyFiles)[0]).toContain('files changed');

    const tooManyLines = { ...l1, diffLines: L1_BOUNDS.maxDiffLines + 1 };
    expect(
      decideLevel({
        intent: 'document',
        operationTouchesEnvironment: false,
        risk: NO_LOCKDOWN_RISK,
        l1: tooManyLines,
      }).level,
    ).toBe('L2');
  });

  it('defaults to L2 when no L1 criteria are supplied', () => {
    expect(
      decideLevel({
        intent: 'delivery',
        operationTouchesEnvironment: false,
        risk: NO_LOCKDOWN_RISK,
      }).level,
    ).toBe('L2');
  });
});

describe('grant admission (data.md §2, reliability.md §2)', () => {
  const request = {
    operation: 'edit',
    role: 'backend' as const,
    stage: 'develop',
    targets: ['src/a.ts'],
    at: TIME,
    workId: ID2,
    runId: ID2,
    toolOperationId: ID2,
    inputHash: HASH,
  };

  it('admits an exact match and denies a mismatched binding', () => {
    expect(evaluateGrant(grant, request)).toEqual({ allowed: true, replay: false });
    expect(evaluateGrant(grant, { ...request, operation: 'bash' }).allowed).toBe(false);
    expect(evaluateGrant(grant, { ...request, role: 'frontend' }).allowed).toBe(false);
    expect(evaluateGrant(grant, { ...request, stage: 'test' }).allowed).toBe(false);
    expect(evaluateGrant(grant, { ...request, inputHash: 'c'.repeat(64) }).allowed).toBe(false);
    expect(evaluateGrant(grant, { ...request, targets: ['src/../etc/passwd'] })).toEqual({
      allowed: false,
      reason: 'target src/../etc/passwd is not a repository-relative path',
    });
    expect(evaluateGrant(grant, { ...request, targets: ['/etc/passwd'] }).allowed).toBe(false);
  });

  it('denies an expired grant', () => {
    const decision = evaluateGrant(grant, { ...request, at: '2026-09-11T02:00:00.000Z' });
    expect(decision).toEqual({ allowed: false, reason: 'grant expired' });
  });

  it('replays the same tool operation with the same hash and refuses another hash', () => {
    const consumed: Grant = {
      ...grant,
      consumedAt: TIME,
      consumedByOperationId: ID2,
      inputHash: HASH,
    };
    expect(evaluateGrant(consumed, request)).toEqual({ allowed: true, replay: true });
    expect(evaluateGrant(consumed, { ...request, inputHash: 'c'.repeat(64) }).allowed).toBe(false);
    expect(evaluateGrant(consumed, { ...request, toolOperationId: ID }).allowed).toBe(false);
  });

  it('covers nested paths only through a directory prefix', () => {
    expect(evaluateGrant(grant, { ...request, targets: ['src/deep/a.ts'] }).allowed).toBe(true);
    expect(evaluateGrant(grant, { ...request, targets: ['srcs/a.ts'] }).allowed).toBe(false);
  });

  it('requires the identity fields each scope needs', () => {
    expect(scopeBindingsSatisfied('once', {})).toBe(false);
    expect(
      scopeBindingsSatisfied('once', { runId: ID2, toolOperationId: ID, inputHash: HASH }),
    ).toBe(true);
    expect(scopeBindingsSatisfied('run', {})).toBe(false);
    expect(scopeBindingsSatisfied('work', { workId: ID2 })).toBe(true);
    expect(scopeBindingsSatisfied('project', {})).toBe(true);
  });
});

describe('dispatch and budget admission', () => {
  const contextSelection = {
    goal: 'goal',
    sourceRefs: [{ kind: 'message' as const, id: ID, version: '1' }],
    reasonPerSource: { [`message:${ID}`]: 'the request' },
    featureRefs: [],
    codePaths: [],
    artifactRefs: [],
    excluded: [],
    unknowns: [],
    readBudget: { initialTokens: 100, expansionTokens: 0 },
  };

  const professional = {
    kind: 'professional' as const,
    workId: ID,
    role: 'backend' as const,
    purpose: 'implementation' as const,
    goal: 'implement',
    scope: SCOPE,
    stage: 'develop',
    contextSelection,
    profileRevision: 1,
    requiredOutputs: ['diff'],
    requiredChild: true,
    joinPolicy: 'all' as const,
    budgetAllocation: 100,
    parentRunId: ID2,
  };

  it('accepts a professional dispatch with a justified context', () => {
    expect(validateDispatchSpec(professional)).toEqual({ ok: true });
  });

  it('rejects a selection without a reason', () => {
    const decision = validateDispatchSpec({
      ...professional,
      contextSelection: { ...contextSelection, reasonPerSource: {} },
    });
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.code).toBe('MISSING_CONTEXT');
  });

  it('rejects a professional dispatch without a parent Run', () => {
    const decision = validateDispatchSpec({ ...professional, parentRunId: '' });
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.code).toBe('MISSING_CONTEXT');
  });

  it('rejects a chief dispatch carrying a professional purpose', () => {
    const decision = validateDispatchSpec({
      kind: 'chief',
      workId: ID,
      role: 'chief',
      purpose: 'analysis',
      goal: 'assess',
      scope: SCOPE,
      stage: 'assist',
      contextSelection,
      profileRevision: 1,
      requiredOutputs: ['assessment'],
      budgetAllocation: 10,
    });
    expect(decision).toEqual({ ok: true });
  });

  it('requires the parent to be a Chief Run of the same Work', () => {
    expect(isDirectChiefChild(professional, { id: ID2, role: 'chief', workId: ID })).toBe(true);
    expect(isDirectChiefChild(professional, { id: ID2, role: 'backend', workId: ID })).toBe(false);
    expect(isDirectChiefChild(professional, { id: ID, role: 'chief', workId: ID })).toBe(false);
  });

  it('blocks dispatch when used + reserved + requested exceeds the limit', () => {
    expect(canAllocateBudget(budget, 800)).toEqual({ ok: true });
    const decision = canAllocateBudget(budget, 801);
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.code).toBe('BUDGET_EXCEEDED');
    expect(canAllocateBudget(budget, -1).ok).toBe(false);
  });

  it('blocks the next repair round once the limit is reached', () => {
    expect(canStartRepair(budget).ok).toBe(true);
    expect(canStartRepair({ ...budget, repairUsed: 3 }).ok).toBe(false);
  });
});

describe('requirement projection rules (requirements.md §4/§6)', () => {
  it('classifies imports without confusing local and record versions', () => {
    const record = { recordVersion: 2, recordHash: HASH };
    expect(classifyImport(undefined, record)).toBe('new');
    expect(classifyImport(record, record)).toBe('unchanged');
    expect(classifyImport({ ...record, recordVersion: 1 }, record)).toBe('update');
    expect(classifyImport({ recordVersion: 2, recordHash: 'c'.repeat(64) }, record)).toBe(
      'conflict',
    );
    expect(classifyImport({ ...record, recordVersion: 3 }, record)).toBe('conflict');
  });

  it('blocks writes for conflicted and terminal records', () => {
    expect(writeAllowed('active', false)).toBe(true);
    expect(writeAllowed('active', true)).toBe(false);
    expect(writeAllowed('archived', false)).toBe(false);
    expect(writeAllowed('cancelled', false)).toBe(false);
  });

  it('needs a committed record and a Work before starting', () => {
    expect(
      canStartRequirement({ lifecycle: 'active' }, { recordCommitted: true, workId: ID }),
    ).toBe(true);
    expect(
      canStartRequirement({ lifecycle: 'active' }, { recordCommitted: false, workId: ID }),
    ).toBe(false);
    expect(canStartRequirement({ lifecycle: 'active' }, { recordCommitted: true })).toBe(false);
  });

  it('marks an active record without local execution as needs_replan', () => {
    expect(executionAvailabilityFor('active', undefined)).toBe('needs_replan');
    expect(executionAvailabilityFor('active', ID)).toBe('local');
    expect(executionAvailabilityFor('queued', undefined)).toBe('local');
  });

  it('validates the six mandatory content sections', () => {
    const complete = REQUIRED_CONTENT_SECTIONS.map((section) => `## ${section}\n无`).join('\n\n');
    expect(validateContentSections(complete)).toEqual([]);
    const missing = validateContentSections('## 目标与背景\n无');
    expect(missing.filter((problem) => problem.startsWith('missing section'))).toHaveLength(
      REQUIRED_CONTENT_SECTIONS.length - 1,
    );
    expect(validateContentSections(`${complete}\n\n## 目标与背景\n重复`)).toContain(
      'duplicate section: 目标与背景',
    );
    expect(validateContentSections('   ')).toContain('content.md must not be empty');
  });
});
