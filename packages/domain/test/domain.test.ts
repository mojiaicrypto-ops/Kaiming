import { describe, expect, it } from 'vitest';
import type { Budget, Grant } from '@agentdev/contracts';
import {
  ATTEMPT_TRANSITIONS,
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
  restoreTarget,
  riskFromFlags,
  touchesRunningEnvironment,
  runAcceptsNewAttempt,
  scopeBindingsSatisfied,
  validateContentSections,
  unknownRiskFlags,
  validateDispatchSpec,
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
    expect(declaresWorkspaceWrite({ operations: ['read', 'search'], writePaths: [] })).toBe(false);
    expect(declaresWorkspaceWrite({ operations: [], writePaths: [] })).toBe(false);
    // Environment operations are handled by their own predicate.
    expect(touchesRunningEnvironment({ operations: ['deploy'], networkTargets: [] })).toBe(true);
    expect(touchesRunningEnvironment({ operations: ['edit'], networkTargets: [] })).toBe(false);
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
