/**
 * Graded delivery rules (`docs/rules/workflow.md` §2–§7, AC-007…AC-022/AC-083).
 *
 * Everything here is a **pure decision**: no storage, no I/O, no clock. Core
 * persists the result of a decision in the same transaction that reads the input
 * (`reliability.md` §1), so the rules must be answerable before the transaction
 * commits and must never depend on ambient state.
 *
 * The modules this one reuses are the existing domain rules rather than new
 * copies: `routing.ts` already owns the L1 vocabulary and the lockdown risk set
 * (a second table here would drift), and `dispatch.ts` owns the
 * `used + reserved <= limit` admission and the repair-round limit.
 */
import type {
  Budget,
  CheckStatus,
  Level,
  Ref,
  RequirementState,
  Role,
  Scope,
} from '@agentdev/contracts';
import { canAllocateBudget, canStartRepair, type DispatchRejectionCode } from './dispatch.js';
import {
  isL1Eligible,
  l1Failures,
  L1_BOUNDS,
  LOCKDOWN_RISK_TERMS,
  NO_LOCKDOWN_RISK,
  hasLockdownRisk,
  lockdownRiskFlags,
  unknownRiskFlags,
  type L1Criteria,
  type LockdownRisk,
} from './routing.js';

export { L1_BOUNDS };
export type { L1Criteria, LockdownRisk };

// ---------------------------------------------------------------------------
// 1. L1 eligibility, change classification and level upgrade (AC-007/008/009)
// ---------------------------------------------------------------------------

/** The measured size of one real diff. */
export interface DiffLines {
  readonly filesChanged: number;
  /** Non-generated added + deleted lines. */
  readonly diffLines: number;
  /**
   * Characters added + deleted, when the caller measured them.
   *
   * This is what makes the one-character case (AC-008) expressible: a single
   * character edit is tiny by every count and still L3 when it changes a
   * permission, an amount or an interface.
   */
  readonly changedCharacters?: number;
}

/**
 * Signals read off the real diff, not off the request.
 *
 * A one-character edit can still be a behaviour change, so classification never
 * trusts the line count alone (`workflow.md` §2.4 "文件数/行数为保守准入条件，
 * 非安全证明").
 */
export interface CodeSignals {
  /** Pure styling/copy/comment/prose substitution (the L1 material). */
  readonly presentationOnly: boolean;
  /** The replacement target is unambiguous. */
  readonly goalSubstitutionExplicit: boolean;
  /** Touches executable configuration or test assertions. */
  readonly executableConfigChange?: boolean;
  /** Changes control flow, branch conditions or computed results. */
  readonly logicChange?: boolean;
  /** Changes a public interface (signature, schema, protocol). */
  readonly interfaceChange?: boolean;
  /** Changes a permission decision. */
  readonly permissionChange?: boolean;
  /** Changes a payment amount or payment state. */
  readonly paymentChange?: boolean;
  /** Related unknowns were not excluded. */
  readonly unknownsRemain?: boolean;
}

export interface ChangeDiff extends DiffLines {
  readonly signals: CodeSignals;
}

export interface ChangeClassification {
  readonly level: Level;
  /** `true` when a documented lockdown risk decided the level. */
  readonly lockdown: boolean;
  /** The exact reasons the L1 admission test failed, for the Assessment record. */
  readonly reasons: readonly string[];
  /** The measured diff exceeded the L1 file/line bounds. */
  readonly diffOverL1: boolean;
  /** The diff carries a logic change the line count cannot show. */
  readonly logicChange: boolean;
  /**
   * Risk flags the documented vocabulary does not recognize.
   *
   * A non-empty list forces L3: an unknown flag cannot be read as "no risk".
   */
  readonly unknownRiskFlags: readonly string[];
}

/** Turns `CodeSignals` into the documented lockdown vocabulary. */
export function lockdownRiskOf(signals: CodeSignals): LockdownRisk {
  return {
    // Permission *and* public-interface changes are the same L3 class here: both
    // are "身份认证、权限判断…公开协议不兼容" (workflow.md §2.3, AC-008).
    identityOrPermission: signals.permissionChange === true || signals.interfaceChange === true,
    secrets: false,
    securityBoundary: false,
    dataDeletionOrMigration: false,
    payment: signals.paymentChange === true,
    publicProtocolBreak: signals.interfaceChange === true,
    deployOrRelease: false,
    gateRuleChange: false,
  };
}

/** The signals, merged with any risk flags the caller already assessed. */
function lockdownCasesFor(diff: ChangeDiff, riskFlags: readonly string[]): LockdownRisk[] {
  const cases: LockdownRisk[] = [lockdownRiskOf(diff.signals)];
  if (riskFlags.length > 0) {
    cases.push(riskFlagsToRisk(riskFlags));
  }
  return cases;
}

/**
 * Resolves loose risk text onto the canonical risk shape.
 *
 * The vocabulary belongs to `routing.ts`; this only calls it. An unrecognized
 * flag is **not** dropped here — `unknownRiskFlags` reports it and the
 * classification refuses to downgrade (see `classifyChange`), because reading an
 * unknown flag as "no risk" would turn the L3 gate into a fail-open.
 */
function riskFlagsToRisk(flags: readonly string[]): LockdownRisk {
  const risk: Record<string, boolean> = { ...NO_LOCKDOWN_RISK };
  for (const flag of flags) {
    const normalized = normalizeTerm(flag);
    for (const [key, terms] of Object.entries(LOCKDOWN_RISK_TERMS)) {
      if (terms.some((term) => normalizeTerm(term) === normalized)) risk[key] = true;
    }
  }
  return risk as unknown as LockdownRisk;
}

function normalizeTerm(term: string): string {
  return term
    .trim()
    .toLowerCase()
    .replace(/[\s_/-]+/gu, '');
}

/** The `L1Criteria` view of a real diff plus its signals. */
export function l1CriteriaOf(diff: ChangeDiff): L1Criteria {
  return {
    goalSubstitutionExplicit: diff.signals.goalSubstitutionExplicit,
    presentationOnly: diff.signals.presentationOnly,
    noContractChange:
      diff.signals.interfaceChange !== true &&
      diff.signals.logicChange !== true &&
      diff.signals.permissionChange !== true,
    noExecutableConfigChange: diff.signals.executableConfigChange !== true,
    unknownsExcluded: diff.signals.unknownsRemain !== true,
    filesChanged: diff.filesChanged,
    diffLines: diff.diffLines,
  };
}

export type L1Eligibility =
  | { readonly eligible: true; readonly level: 'L1'; readonly reasons: readonly [] }
  | { readonly eligible: false; readonly level: Level; readonly reasons: readonly string[] };

/**
 * AC-007/AC-008: whether an explicit simple fix really is an L1 change.
 *
 * The bounds are the conservative admission conditions of `workflow.md` §2.4
 * (`≤3文件且非生成Diff新增+删除≤20行`, no logic/interface/config change), and the
 * lockdown test runs **first**: a one-character change that alters permission, a
 * payment amount or an interface is L3 and the line count can never downgrade it
 * (AC-008).
 */
export function evaluateL1Eligibility(
  diff: ChangeDiff,
  riskFlags: readonly string[] = [],
): L1Eligibility {
  const unknown = unknownRiskFlags(riskFlags);
  if (unknown.length > 0) {
    // Fail-closed: an unrecognized flag is never read as "no risk", so it can
    // neither route the change to L1 nor be silently ignored (R10-01).
    return {
      eligible: false,
      level: 'L3',
      reasons: [`unrecognized risk flags: ${unknown.join(', ')}`],
    };
  }
  const lockdown = lockdownCasesFor(diff, riskFlags).filter((risk) => hasLockdownRisk(risk));
  if (lockdown.length > 0) {
    const flags = [...new Set(lockdown.flatMap((risk) => lockdownRiskFlags(risk)))];
    return {
      eligible: false,
      level: 'L3',
      reasons: flags.map((flag) => `lockdown risk: ${flag}`),
    };
  }
  const criteria = l1CriteriaOf(diff);
  if (criteria.filesChanged < 1 || criteria.diffLines < 1) {
    return {
      eligible: false,
      level: 'L2',
      reasons: ['the measured diff is empty; an L1 change must be observable'],
    };
  }
  if (!isL1Eligible(criteria)) {
    return { eligible: false, level: 'L2', reasons: l1Failures(criteria) };
  }
  return { eligible: true, level: 'L1', reasons: [] };
}

/**
 * AC-007/AC-008/AC-009: classifies a change and explains the level.
 *
 * The order is the document's own decision order: lockdown risk (L3) before the
 * L1 admission test, and L2 as the fail-closed default.
 */
export function classifyChange(
  diff: ChangeDiff,
  riskFlags: readonly string[] = [],
): ChangeClassification {
  const unknown = unknownRiskFlags(riskFlags);
  const eligibility = evaluateL1Eligibility(diff, riskFlags);
  const diffOverL1 =
    diff.filesChanged > L1_BOUNDS.maxFiles || diff.diffLines > L1_BOUNDS.maxDiffLines;
  const logicChange = diff.signals.logicChange === true;
  const base = { diffOverL1, logicChange, unknownRiskFlags: unknown };
  if (unknown.length > 0) {
    // Fail-closed: an unrecognized risk flag is treated as a lockdown risk, so the
    // change can never be routed to the smaller lane on the strength of a typo.
    return {
      level: 'L3',
      lockdown: true,
      reasons: [...eligibility.reasons, `unrecognized risk flags: ${unknown.join(', ')}`],
      ...base,
    };
  }
  if (eligibility.eligible) {
    return {
      level: 'L1',
      lockdown: false,
      reasons: ['L1 conditions all hold'],
      ...base,
    };
  }
  if (eligibility.level === 'L3') {
    return { level: 'L3', lockdown: true, reasons: eligibility.reasons, ...base };
  }
  return {
    level: 'L2',
    lockdown: false,
    reasons: eligibility.reasons,
    ...base,
  };
}

/** Ranks levels so "never downgrade" can be asserted without string compares. */
export function levelRank(level: Level): number {
  switch (level) {
    case 'none':
      return 0;
    case 'L1':
      return 1;
    case 'L2':
      return 2;
    case 'L3':
      return 3;
  }
}

/**
 * The frozen Plan revision a write gate compares against.
 *
 * `hash` is the Artifact content hash (`data.md` §4: transaction references the
 * hash), so "the old Plan is stale" is a hash comparison, not a version guess.
 */
export interface PlanRevision {
  readonly id: string;
  readonly version: number;
  readonly hash: string;
  readonly revision: string;
  readonly stage: string;
  readonly approval?: 'auto' | 'user';
  readonly approvedAt?: string;
}

export interface LevelUpgradeInput {
  readonly previousLevel: Level;
  readonly diff: ChangeDiff;
  /** An executed inspection found a behaviour change the size did not show. */
  readonly logicChange: boolean;
  readonly riskFlags?: readonly string[];
  readonly plan?: PlanRevision;
}

export type LevelUpgradeResult =
  | {
      readonly ok: true;
      readonly level: Level;
      readonly upgradeRequired: false;
      readonly stalePlan: false;
      readonly reasons: readonly string[];
    }
  | {
      readonly ok: false;
      readonly level: Level;
      readonly upgradeRequired: true;
      readonly stalePlan: boolean;
      readonly reasons: readonly string[];
    };

/**
 * AC-008/AC-009: re-evaluates the level once the real diff exists.
 *
 * Three invariants (`workflow.md` §2 last paragraph):
 * 1. an upgrade keeps the same Work and its evidence;
 * 2. a downgrade is never automatic, so a locked L3 cannot fall back to L2;
 * 3. the old Plan is rejected as stale when the level rises, because the write
 *    scope is about to expand and the Plan was approved for the smaller scope.
 */
export function evaluateLevelUpgrade(input: LevelUpgradeInput): LevelUpgradeResult {
  const signals: CodeSignals = {
    ...input.diff.signals,
    ...(input.logicChange ? { logicChange: true } : {}),
  };
  const classified = classifyChange({ ...input.diff, signals }, input.riskFlags ?? []);
  const previousRank = levelRank(input.previousLevel);
  const classifiedRank = levelRank(classified.level);
  const forcedUpgrade = input.logicChange && input.previousLevel === 'L1';
  const upgradeRequired = forcedUpgrade || classifiedRank > previousRank;

  if (classifiedRank < previousRank) {
    // A classification below the recorded level is a refusal, never a silent
    // downgrade: the Work keeps the stronger envelope it already carries and the
    // Plan written for that envelope is rejected as stale.
    return {
      ok: false,
      level: input.previousLevel,
      upgradeRequired: true,
      stalePlan: input.plan !== undefined,
      reasons: [...classified.reasons, `downgrade refused; the Work keeps ${input.previousLevel}`],
    };
  }
  if (!upgradeRequired) {
    return {
      ok: true,
      level: input.previousLevel,
      upgradeRequired: false,
      stalePlan: false,
      reasons: classified.reasons,
    };
  }

  const leveledRank = Math.max(classifiedRank, previousRank + 1);
  const level: Level = leveledRank >= 3 ? 'L3' : leveledRank === 2 ? 'L2' : 'L1';
  const reasons = [...classified.reasons];
  if (forcedUpgrade) reasons.push('a logic change cannot stay L1');
  return {
    ok: false,
    level,
    upgradeRequired: true,
    stalePlan: input.plan !== undefined,
    reasons,
  };
}

// ---------------------------------------------------------------------------
// 2. Stage manifests and routes (AC-010/011/012)
// ---------------------------------------------------------------------------

/** The three delivery routes of `workflow.md` §3. */
export type DeliveryRoute = 'code' | 'document' | 'operation';

/** The execution stages a Manifest chain must show, in order. */
export const STAGE_ORDER: Readonly<
  Record<DeliveryRoute, Readonly<Record<string, readonly string[]>>>
> = {
  code: {
    L1: ['Develop', 'Review', 'Settlement'],
    L2: ['Plan', 'Develop', 'Review', 'Test', 'Settlement'],
    // L3 adds the migration/recovery step before settlement (AC-011).
    L3: ['Plan', 'Develop', 'Review', 'Test', 'Recovery', 'Settlement'],
  },
  document: {
    L1: ['Product', 'Review', 'Settlement'],
    L2: ['Product', 'Planning', 'Review', 'Settlement'],
    L3: ['Product', 'Planning', 'Review', 'Settlement'],
  },
  operation: {
    L1: ['Plan', 'Execute', 'Review', 'Verify', 'Settlement'],
    L2: ['Plan', 'Execute', 'Review', 'Verify', 'Settlement'],
    L3: ['Plan', 'Execute', 'Review', 'Verify', 'Settlement'],
  },
};

/** The stages of one route/level, or `undefined` for a combination the rules do not define. */
export function stageOrderFor(route: DeliveryRoute, level: Level): readonly string[] | undefined {
  return STAGE_ORDER[route][level];
}

/**
 * Document-route rules (`workflow.md` §3 last paragraph, AC-012).
 *
 * The formal-document lane produces candidate diffs and gets an independent
 * Review plus Settlement. It has no code Test stage and no development
 * Requirement; its Product/Planning work is authorised by the user's own source.
 */
export interface DocumentRouteRules {
  readonly route: 'document';
  readonly stages: readonly string[];
  readonly producesCandidateDiff: true;
  readonly codeTestStage: false;
  readonly developmentRequirement: false;
  readonly independentReview: true;
  readonly settlement: true;
}

/** The document lane's stages; `stageOrderFor` returns the level's own list. */
const DOCUMENT_STAGES_BY_LEVEL: Readonly<Record<'L1' | 'L2' | 'L3', readonly string[]>> = {
  L1: ['Product', 'Review', 'Settlement'],
  L2: ['Product', 'Planning', 'Review', 'Settlement'],
  L3: ['Product', 'Planning', 'Review', 'Settlement'],
};

export function documentRouteRules(level: Exclude<Level, 'none'> = 'L2'): DocumentRouteRules {
  const stages = stageOrderFor('document', level) ?? DOCUMENT_STAGES_BY_LEVEL[level];
  return {
    route: 'document',
    stages,
    producesCandidateDiff: true,
    codeTestStage: false,
    developmentRequirement: false,
    independentReview: true,
    settlement: true,
  };
}

export interface StageManifest {
  readonly stage: string;
  readonly workId: string;
  readonly planRef?: Ref;
  readonly taskId?: string;
  readonly codeRevision?: string;
  readonly codeTree?: string;
  readonly environmentRef?: string;
  readonly acceptanceIds?: readonly string[];
  /** Stages this Manifest consumed as frozen input (`dependencyManifestRefs`). */
  readonly dependsOn?: readonly string[];
  /** Stage-specific evidence: rollback plan, per-item audit, recovery drill. */
  readonly evidence?: readonly string[];
}

export interface StageChainRequirement {
  readonly requirementId?: string;
  readonly existingRequirementId?: string;
  readonly previousLevel?: Level;
}

export interface StageChainInput {
  readonly route: DeliveryRoute;
  readonly level: Level;
  readonly manifests?: readonly StageManifest[];
  readonly requirement?: StageChainRequirement;
}

export type StageChainGapCode = 'MISSING_CONTEXT' | 'GATE_NOT_READY' | 'VALIDATION_ERROR';

export interface StageChainGap {
  readonly code: StageChainGapCode;
  readonly stage?: string;
  readonly message: string;
}

export type StageChainDecision =
  | { readonly ok: true; readonly stages: readonly string[] }
  | {
      readonly ok: false;
      readonly code: StageChainGapCode;
      readonly gaps: readonly StageChainGap[];
    };

/** The code-chain stages that require a bound VerificationManifest. */
const MANIFEST_STAGES = new Set(['Develop', 'Review', 'Test', 'Recovery']);

/**
 * AC-010/AC-011/AC-012: one valid Manifest per stage, each depending on the previous.
 *
 * A missing stage is `GATE_NOT_READY` (a gate is not met), while a gap in the
 * inputs the chain itself needs — no Work binding, or an L3 missing its explicit
 * authorisation — is `MISSING_CONTEXT`.
 */
export function evaluateStageChain(input: StageChainInput): StageChainDecision {
  const stages = stageOrderFor(input.route, input.level);
  const gaps: StageChainGap[] = [];
  if (stages === undefined) {
    return {
      ok: false,
      code: 'VALIDATION_ERROR',
      gaps: [
        { code: 'VALIDATION_ERROR', message: `unknown route/level ${input.route}/${input.level}` },
      ],
    };
  }
  const requirement = input.requirement;
  if (input.route === 'code' && (input.level === 'L2' || input.level === 'L3')) {
    if (requirement?.requirementId === undefined) {
      gaps.push({
        code: 'MISSING_CONTEXT',
        message: 'L2/L3 code delivery needs a Requirement bound to the Work',
      });
    }
  }
  if (input.level === 'L3' && requirement?.previousLevel !== 'L3') {
    gaps.push({
      code: 'MISSING_CONTEXT',
      message: 'L3 requires an explicit authorisation and cannot be auto-approved',
    });
  }

  const byStage = indexManifests(input.manifests ?? []);
  let previous: string | undefined;
  for (const stage of stages) {
    const manifest = byStage.get(stage);
    if (manifest === undefined) {
      gaps.push({ code: 'GATE_NOT_READY', stage, message: `stage ${stage} has no Manifest` });
      previous = undefined;
      continue;
    }
    if (manifest.workId === '') {
      gaps.push({ code: 'VALIDATION_ERROR', stage, message: `stage ${stage} has no Work binding` });
    }
    const dependencies = manifest.dependsOn ?? [];
    if (previous !== undefined && !dependencies.includes(previous)) {
      gaps.push({
        code: 'GATE_NOT_READY',
        stage,
        message: `stage ${stage} does not depend on ${previous}`,
      });
    }
    const missingEvidence = stageEvidenceGaps(stage, manifest);
    gaps.push(...missingEvidence);
    previous = stage;
  }

  if (input.level === 'L3' && input.route !== 'operation') {
    gaps.push(...l3EvidenceGaps(requirement, input));
  }

  if (gaps.length > 0) {
    return { ok: false, code: worstCode(gaps), gaps };
  }
  return { ok: true, stages };
}

function indexManifests(manifests: readonly StageManifest[]): Map<string, StageManifest> {
  const byStage = new Map<string, StageManifest>();
  for (const manifest of manifests) {
    // A duplicate stage is reported by the missing dependency check of the next
    // stage; keeping the first occurrence makes the outcome deterministic.
    if (!byStage.has(manifest.stage)) byStage.set(manifest.stage, manifest);
  }
  return byStage;
}

function stageEvidenceGaps(stage: string, manifest: StageManifest): StageChainGap[] {
  const gaps: StageChainGap[] = [];
  if (MANIFEST_STAGES.has(stage) && (manifest.codeRevision ?? '') === '') {
    gaps.push({
      code: 'VALIDATION_ERROR',
      stage,
      message: `stage ${stage} must bind a frozen code revision`,
    });
  }
  if (stage === 'Review' || stage === 'Test') {
    if ((manifest.environmentRef ?? '') === '') {
      gaps.push({
        code: 'VALIDATION_ERROR',
        stage,
        message: `stage ${stage} must name its verification environment`,
      });
    }
  }
  return gaps;
}

/** AC-011: L3 needs authorisation, rollback, per-item audit and a recovery drill. */
function l3EvidenceGaps(
  requirement: StageChainRequirement | undefined,
  input: StageChainInput,
): StageChainGap[] {
  const gaps: StageChainGap[] = [];
  const byStage = indexManifests(input.manifests ?? []);
  const plan = byStage.get('Plan');
  const evidence = (stage: string): readonly string[] => byStage.get(stage)?.evidence ?? [];
  const has = (values: readonly string[], needle: string): boolean =>
    values.some((value) => value.toLowerCase().includes(needle));
  if (!has(evidence('Plan'), 'rollback')) {
    gaps.push({ code: 'MISSING_CONTEXT', stage: 'Plan', message: 'L3 needs a rollback plan' });
  }
  const audit = [...evidence('Review'), ...evidence('Test')];
  if (!has(audit, 'audit')) {
    gaps.push({ code: 'MISSING_CONTEXT', stage: 'Review', message: 'L3 needs a per-item audit' });
  }
  const drill = [...evidence('Recovery'), ...(plan?.evidence ?? [])];
  if (!has(drill, 'drill')) {
    gaps.push({
      code: 'MISSING_CONTEXT',
      stage: 'Recovery',
      message: 'L3 needs a recovery drill evidence item',
    });
  }
  if (requirement?.existingRequirementId !== undefined) {
    // Upgrading keeps the same Work and links the Requirement (`workflow.md` §2).
    if (requirement.existingRequirementId !== requirement.requirementId) {
      gaps.push({
        code: 'MISSING_CONTEXT',
        message: 'an upgrade must associate the existing Work with the same Requirement',
      });
    }
  }
  return gaps;
}

function worstCode(gaps: readonly StageChainGap[]): StageChainGapCode {
  if (gaps.some((gap) => gap.code === 'VALIDATION_ERROR')) return 'VALIDATION_ERROR';
  if (gaps.some((gap) => gap.code === 'MISSING_CONTEXT')) return 'MISSING_CONTEXT';
  return 'GATE_NOT_READY';
}

// ---------------------------------------------------------------------------
// 3. Gate readiness (AC-013/014)
// ---------------------------------------------------------------------------

export interface PlanApprovalInput {
  /** `version` is the Plan's own revision; `revision` the Work/code revision. */
  readonly plan: PlanRevision;
  readonly selection: {
    readonly authorizationRef?: string;
    readonly authorizedTargets: readonly string[];
    readonly authorizedOperations: readonly string[];
    readonly workId: string;
    readonly requirementId?: string;
  };
  readonly budget?: {
    readonly tokenLimit: number;
    readonly reserved: number;
    readonly requested: number;
  };
  /** `true` when the Plan selects new product behaviour not in the definition. */
  readonly productChanged: boolean;
}

export type PlanApprovalFailureCode =
  'NOT_AUTHORIZED' | 'GATE_NOT_READY' | 'MISSING_CONTEXT' | 'BUDGET_EXCEEDED' | 'VALIDATION_ERROR';

export interface PlanApprovalEvidence {
  readonly planId: string;
  readonly planVersion: number;
  readonly planHash: string;
  readonly revision: string;
  readonly workId: string;
  readonly authorizationRef?: string;
  readonly approvedBy: 'auto' | 'user';
  readonly at: string;
}

export type PlanApprovalDecision =
  | { readonly ok: true; readonly approval: 'auto'; readonly evidence: PlanApprovalEvidence }
  | {
      readonly ok: false;
      readonly code: PlanApprovalFailureCode;
      readonly message: string;
      /** Present when the caller must ask the user instead of auto-approving. */
      readonly decisionRequired: boolean;
    };

export interface PlanApprovalRequest extends PlanApprovalInput {
  /** The Work revision the Plan was written against. */
  readonly revision: string;
  /** The Plan's own write scope, checked against the authorization envelope. */
  readonly scope?: Scope;
  readonly at: string;
}

/**
 * AC-014: a compliant Plan is auto-approved and the approval is recorded.
 *
 * "范围内明确化可AutoAccepted/AutoApproved：授权引用有效，未新增语义选择/权限/风险，
 * 所有验收映射完整，预算有效" (`workflow.md` §4). A new product choice is never
 * auto-approved — it is a `DecisionRequired` product change.
 */
export function evaluatePlanApproval(request: PlanApprovalRequest): PlanApprovalDecision {
  if (request.productChanged) {
    return {
      ok: false,
      code: 'GATE_NOT_READY',
      message: 'the Plan makes a new product choice; a product Decision is required',
      decisionRequired: true,
    };
  }
  const authorizationRef = request.selection.authorizationRef;
  if (authorizationRef === undefined || authorizationRef === '') {
    return {
      ok: false,
      code: 'NOT_AUTHORIZED',
      message: 'auto-approval requires a valid authorization reference',
      decisionRequired: false,
    };
  }
  if (request.plan.revision !== request.revision) {
    return {
      ok: false,
      code: 'GATE_NOT_READY',
      message: `the Plan targets revision ${request.plan.revision}, not the current ${request.revision}`,
      decisionRequired: false,
    };
  }
  const targets = request.selection.authorizedTargets;
  const outside = request.scope?.writePaths.filter((path) => !isWithinScope(path, targets)) ?? [];
  if (outside.length > 0) {
    return {
      ok: false,
      code: 'NOT_AUTHORIZED',
      message: `write scope is outside the authorization: ${outside.join(', ')}`,
      decisionRequired: false,
    };
  }
  const operations = request.selection.authorizedOperations;
  const ungranted = (request.scope?.operations ?? []).filter(
    (operation) => !operations.includes(operation),
  );
  if (ungranted.length > 0) {
    return {
      ok: false,
      code: 'NOT_AUTHORIZED',
      message: `Plan operations are not authorized: ${ungranted.join(', ')}`,
      decisionRequired: false,
    };
  }
  if (request.budget !== undefined) {
    const decision = canAllocateBudget(
      budgetRowOf({
        tokenLimit: request.budget.tokenLimit,
        tokensUsed: 0,
        tokensReserved: request.budget.reserved,
      }),
      request.budget.requested,
    );
    if (!decision.ok) {
      return {
        ok: false,
        code: 'BUDGET_EXCEEDED',
        message: decision.message,
        decisionRequired: false,
      };
    }
  }
  const evidence: PlanApprovalEvidence = {
    planId: request.plan.id,
    planVersion: request.plan.version,
    planHash: request.plan.hash,
    revision: request.revision,
    workId: request.selection.workId,
    approvedBy: 'auto',
    at: request.at,
    authorizationRef,
  };
  return { ok: true, approval: 'auto', evidence };
}

export interface WriteGateInput {
  readonly plan?: PlanRevision;
  readonly revision: string;
  readonly work: { readonly id: string; readonly revision: string; readonly level: Level };
  readonly authorizedTargets: readonly string[];
  /** The frozen source hash the caller measured before the write. */
  readonly expectedSourceHash: string;
  /** The hash measured at admission time; a mismatch means the source moved. */
  readonly actualSourceHash: string;
  /** The content hash the approval recorded; a mismatch means the Plan changed. */
  readonly planHash: string;
  readonly diffHash: string;
}

export type WriteGateDecision =
  | {
      readonly ok: true;
      readonly sourceHash: string;
      readonly approvals: { readonly planRef: Ref };
    }
  | {
      readonly ok: false;
      readonly code: 'GATE_NOT_READY';
      readonly message: string;
      readonly gaps: readonly string[];
    };

/**
 * AC-013: a code write without an approved Plan for the current Work revision is
 * `GATE_NOT_READY`.
 *
 * The decision is pure, so the caller can compare `expectedSourceHash` with
 * `actualSourceHash` around the call and report that the source hash is
 * unchanged. Every failing condition is returned, so the caller learns that the
 * Plan is stale *and* that the source moved in one response.
 */
export function evaluateWriteGate(input: WriteGateInput): WriteGateDecision {
  const gaps: string[] = [];
  if (input.work.level === 'none') {
    gaps.push('a level-none Work carries no modification authority');
  }
  if (input.plan === undefined) {
    gaps.push('no Plan is bound to this Work revision');
  } else {
    if (input.plan.approval === undefined) {
      gaps.push(`Plan ${input.plan.id} has no recorded approval`);
    }
    if (input.plan.revision !== input.work.revision) {
      gaps.push(
        `Plan revision ${input.plan.revision} does not match Work revision ${input.work.revision}`,
      );
    }
    if (input.plan.hash !== input.planHash) {
      gaps.push('the Plan content changed after approval');
    }
  }
  if (input.expectedSourceHash !== input.actualSourceHash) {
    gaps.push('the source hash changed since the write request was admitted');
  }
  if (gaps.length > 0) {
    return { ok: false, code: 'GATE_NOT_READY', message: gaps.join('; '), gaps };
  }
  const plan = input.plan as PlanRevision;
  return { ok: true, sourceHash: input.actualSourceHash, approvals: { planRef: refOf(plan) } };
}

function refOf(plan: PlanRevision): Ref {
  return { id: plan.id, version: plan.version, hash: plan.hash };
}

/** Whether one repository path sits inside a set of authorized targets. */
export function isWithinScope(path: string, targets: readonly string[]): boolean {
  return targets.some(
    (target) => path === target || (target.endsWith('/') && path.startsWith(target)),
  );
}

// ---------------------------------------------------------------------------
// 4. Decisions (AC-015/016)
// ---------------------------------------------------------------------------

export type BehaviourChoice = 'now' | 'later' | 'decline';

export interface DecisionEffect {
  readonly kind: 'decision';
  readonly decisionKind: 'product';
  readonly state: 'accepted' | 'rejected';
  readonly summary: string;
}

export interface BehaviourChoiceInput {
  readonly workId: string;
  readonly choice: BehaviourChoice;
  readonly summary: string;
  readonly decidedAt: string;
  /** The evidence the current Work is resting on. */
  readonly evidenceRefs?: readonly string[];
  /** Exactly which of those refs the change invalidates, when the caller knows. */
  readonly affectedEvidenceRefs?: readonly string[];
  /** Or the code paths the change touches, to match against the refs. */
  readonly removeOrChangePaths?: readonly string[];
  readonly sourceRequirementId?: string;
}

export interface BehaviourChoiceDecision {
  readonly choice: BehaviourChoice;
  readonly decision: DecisionEffect;
  readonly newProductRequired: boolean;
  readonly newPlanRequired: boolean;
  /** The evidence refs this choice invalidates (`workflow.md` §6). */
  readonly invalidatedEvidenceRefs: readonly string[];
  /** Evidence outside the affected scope stays valid and is named explicitly. */
  readonly reusableEvidenceRefs: readonly string[];
  /** The Requirement that must be **created** later; absent for `now`/`decline`. */
  readonly queuedRequirement?: { readonly title: string; readonly goal: string };
  /** The Requirement the current acceptance belongs to; unchanged when declined. */
  readonly requirementId?: string;
  /** `true` only for `later`/`decline`: the current acceptance does not move. */
  readonly currentAcceptanceUnchanged: boolean;
  readonly reason?: string;
}

/**
 * Splits the existing evidence into the part a behaviour change invalidates and
 * the part it leaves alone.
 *
 * Three inputs, in order of authority:
 * 1. `affectedRefs` — the caller already knows exactly which evidence the change
 *    touches (the normal case: the Review/Test bound to the changed behaviour);
 * 2. `affectedPaths` — evidence whose ref embeds a changed path is invalidated
 *    (and a Work prefix narrows the rule to that Work's refs);
 * 3. neither — nothing can be proven unaffected, so everything is invalidated.
 *
 * (3) is fail-closed on purpose: an evidence item that survives a product change
 * by accident is a false gate pass.
 */
export function invalidateEvidenceForChoice(
  evidenceRefs: readonly string[] = [],
  options: {
    readonly affectedRefs?: readonly string[];
    readonly affectedPaths?: readonly string[];
    readonly workPrefix?: string;
  } = {},
): { readonly invalidated: readonly string[]; readonly reusable: readonly string[] } {
  const direct = options.affectedRefs;
  if (direct !== undefined) {
    const set = new Set(direct);
    return {
      invalidated: evidenceRefs.filter((ref) => set.has(ref)),
      reusable: evidenceRefs.filter((ref) => !set.has(ref)),
    };
  }
  const prefix = options.workPrefix ?? '';
  const affected = (options.affectedPaths ?? []).filter((path) => path.startsWith(prefix));
  if (affected.length === 0) {
    return { invalidated: [...evidenceRefs], reusable: [] };
  }
  const invalidated: string[] = [];
  const reusable: string[] = [];
  for (const ref of evidenceRefs) {
    const touched = affected.some((path) => ref.includes(path) || path.includes(ref));
    if (touched) invalidated.push(ref);
    else reusable.push(ref);
  }
  return { invalidated, reusable };
}

/**
 * AC-015/AC-016: what "handle it now / later / decline" produces.
 *
 * `now` saves a Decision, requires a new Product/Plan and invalidates the
 * affected evidence. `later` queues a new Requirement and leaves the current
 * acceptance alone. `decline` records a reason and also leaves it alone.
 */
export function evaluateBehaviourChoice(input: BehaviourChoiceInput): BehaviourChoiceDecision {
  const { invalidated, reusable } = invalidateEvidenceForChoice(input.evidenceRefs ?? [], {
    ...(input.affectedEvidenceRefs === undefined
      ? {}
      : { affectedRefs: input.affectedEvidenceRefs }),
    ...(input.removeOrChangePaths === undefined
      ? {}
      : { affectedPaths: input.removeOrChangePaths }),
  });
  const requirementId = input.sourceRequirementId;
  const base = {
    choice: input.choice,
    ...(requirementId === undefined ? {} : { requirementId }),
  };
  if (input.choice === 'now') {
    return {
      ...base,
      decision: {
        kind: 'decision',
        decisionKind: 'product',
        state: 'accepted',
        summary: input.summary,
      },
      newProductRequired: true,
      newPlanRequired: true,
      invalidatedEvidenceRefs: invalidated,
      reusableEvidenceRefs: reusable,
      currentAcceptanceUnchanged: false,
    };
  }
  if (input.choice === 'later') {
    return {
      ...base,
      decision: {
        kind: 'decision',
        decisionKind: 'product',
        state: 'accepted',
        summary: input.summary,
      },
      newProductRequired: false,
      newPlanRequired: false,
      invalidatedEvidenceRefs: [],
      reusableEvidenceRefs: input.evidenceRefs ?? [],
      queuedRequirement: { title: input.summary, goal: input.summary },
      currentAcceptanceUnchanged: true,
    };
  }
  return {
    ...base,
    decision: {
      kind: 'decision',
      decisionKind: 'product',
      state: 'rejected',
      summary: input.summary,
    },
    newProductRequired: false,
    newPlanRequired: false,
    invalidatedEvidenceRefs: [],
    reusableEvidenceRefs: input.evidenceRefs ?? [],
    currentAcceptanceUnchanged: true,
    reason: input.summary,
  };
}

export type RequirementStateForChoice =
  | { readonly kind: 'current'; readonly lifecycle: RequirementState; readonly phase: 'product' }
  | { readonly kind: 'queued'; readonly lifecycle: 'queued' }
  | { readonly kind: 'current'; readonly lifecycle: RequirementState; readonly unchanged: true };

/**
 * AC-016: the Requirement state each branch produces.
 *
 * `now` keeps the current Requirement and moves it back to the product phase;
 * `later` creates a Queued Requirement; `decline` changes no Requirement state.
 */
export function requirementStateForChoice(
  choice: BehaviourChoice,
  current: RequirementState,
): RequirementStateForChoice {
  if (choice === 'now') {
    // An archived/cancelled record cannot be revived by a new choice; a cancelled
    // record needs a fresh Requirement instead (requirements.md §2).
    if (current === 'archived' || current === 'cancelled') {
      return { kind: 'queued', lifecycle: 'queued' };
    }
    return { kind: 'current', lifecycle: current, phase: 'product' };
  }
  if (choice === 'later') return { kind: 'queued', lifecycle: 'queued' };
  return { kind: 'current', lifecycle: current, unchanged: true };
}

// ---------------------------------------------------------------------------
// 5. Findings (AC-017/018/019/083)
// ---------------------------------------------------------------------------

/** The finding fields the rules need; storage rows carry the rest. */
export interface FindingCandidate {
  readonly state: 'open' | 'addressed' | 'verified' | 'accepted_risk';
  readonly severity: 'P0' | 'P1' | 'P2' | 'P3';
  readonly targetKind: 'task' | 'integration' | 'document';
  readonly taskId?: string;
  readonly reviewRunId: string;
  readonly manifestId: string;
  readonly blocking: boolean;
}

export type FindingTransition =
  'return_to_development' | 'await_independent_review' | 'verified' | 'accepted_risk' | 'noop';

export interface FindingDecision {
  readonly transition: FindingTransition;
  readonly requiresNewReview: boolean;
  readonly requiresNewTest: boolean;
  readonly reason: string;
}

/**
 * AC-017/AC-083: a Review finding routes straight back to development.
 *
 * No human forwarding and no `taskId` are required: an integration/document
 * Finding binds to the Review target and its Manifest, which is why the decision
 * is derived from the target kind and the stored Manifest, never from a task.
 */
export function evaluateFindingRouting(finding: FindingCandidate): FindingDecision {
  if (finding.targetKind === 'task' && finding.taskId === undefined) {
    return {
      transition: 'noop',
      requiresNewReview: false,
      requiresNewTest: false,
      reason: 'a task-targeted Finding requires taskId; this is a contract violation',
    };
  }
  if (finding.reviewRunId === '' || finding.manifestId === '') {
    return {
      transition: 'noop',
      requiresNewReview: false,
      requiresNewTest: false,
      reason: 'a Finding must record the Review Run and Manifest it came from',
    };
  }
  if (finding.state === 'open') {
    return {
      transition: 'return_to_development',
      requiresNewReview: true,
      requiresNewTest: true,
      reason: 'a Review Finding returns to development automatically',
    };
  }
  if (finding.state === 'addressed') {
    return {
      transition: 'await_independent_review',
      requiresNewReview: true,
      requiresNewTest: true,
      reason: 'a fix invalidates the old Review/Test; neither may self-certify',
    };
  }
  if (finding.state === 'verified') {
    return {
      transition: 'verified',
      requiresNewReview: false,
      requiresNewTest: false,
      reason: 'the Finding was closed by an independent Review',
    };
  }
  return {
    transition: 'accepted_risk',
    requiresNewReview: false,
    requiresNewTest: false,
    reason: 'the user accepted the residual risk',
  };
}

export interface VerificationRun {
  readonly stage: string;
  /** A verification whose input is the post-fix revision. */
  readonly reviewsCurrentRevision: boolean;
  /** The stage outcome; a Test result is `passed` only when nothing is uncovered. */
  readonly status?: CheckStatus;
}

export interface FindingVerificationInput {
  readonly finding: FindingCandidate;
  readonly actorRole: Role;
  readonly reviewRun?: VerificationRun;
  readonly testRun?: VerificationRun;
}

export type FindingVerificationFailureCode =
  'NOT_AUTHORIZED' | 'INVALID_STATE' | 'GATE_NOT_READY' | 'STALE_ARTIFACT';

export type FindingVerificationDecision =
  | { readonly ok: true; readonly state: 'verified' | 'accepted_risk' }
  | {
      readonly ok: false;
      readonly code: FindingVerificationFailureCode;
      readonly message: string;
    };

/**
 * AC-018: only an independent Review verifies a Finding.
 *
 * The negative case is explicit: a developer (any implementation role) that moved
 * the Finding to `addressed` cannot verify it, and the fix path additionally
 * needs a new independent Review *and* a new Test before it closes.
 */
export function findingCanBeVerified(input: FindingVerificationInput): FindingVerificationDecision {
  const { finding, actorRole } = input;
  if (finding.state === 'open') {
    return {
      ok: false,
      code: 'INVALID_STATE',
      message: 'an open Finding has not been addressed yet',
    };
  }
  if (finding.state === 'verified') {
    return { ok: false, code: 'INVALID_STATE', message: 'the Finding is already verified' };
  }
  if (actorRole !== 'review' && actorRole !== 'test') {
    return {
      ok: false,
      code: 'NOT_AUTHORIZED',
      message: `role ${actorRole} cannot verify a Finding; only an independent Review/Test may`,
    };
  }
  if (finding.state === 'accepted_risk') {
    // Risk acceptance is a user decision, never an agent's; the state is recorded
    // by the caller, so a reviewer presenting it needs a valid Review.
    if (!runIsIndependent(input.reviewRun, false)) {
      return {
        ok: false,
        code: 'GATE_NOT_READY',
        message: 'accepted_risk requires the independent Review that recorded it',
      };
    }
    return { ok: true, state: 'accepted_risk' };
  }
  if (!runIsIndependent(input.reviewRun, true)) {
    return {
      ok: false,
      code: 'GATE_NOT_READY',
      message: 'the addressed Finding needs a new independent Review of the current revision',
    };
  }
  if (!runIsIndependent(input.testRun, true)) {
    return {
      ok: false,
      code: 'GATE_NOT_READY',
      message: 'the fix also needs a new Test of the current revision',
    };
  }
  return { ok: true, state: 'verified' };
}

function runIsIndependent(run: VerificationRun | undefined, requireNewTest: boolean): boolean {
  if (run === undefined) return false;
  if (!run.reviewsCurrentRevision) return false;
  // A re-run of the old Run is not a new verification: the caller marks the new
  // Run explicitly. `Stale` input is precisely what must not be accepted.
  if (run.stage !== 'review' && run.stage !== 'test') return false;
  if (requireNewTest && run.status === undefined) return false;
  return run.status === undefined || run.status === 'passed';
}

export interface TestResultLike {
  readonly status: CheckStatus;
  readonly uncovered: readonly {
    readonly acceptanceId: string;
    readonly reason: string;
    readonly riskDecisionId?: string;
  }[];
}

export type CompletionBlock = {
  readonly blocked: true;
  readonly code: 'GATE_NOT_READY';
  readonly reasons: readonly string[];
  /** Acceptance ids that keep the block until the user disposes of the risk. */
  readonly needsRiskDisposition: readonly string[];
};

export type CompletionAllowance = { readonly blocked: false };

/**
 * AC-019: `blocked` never completes; `not_covered` needs an explicit risk
 * disposition before the Gate can open.
 */
export function findingBlocksCompletion(
  testResult: TestResultLike | undefined,
): CompletionBlock | CompletionAllowance {
  if (testResult === undefined) {
    return {
      blocked: true,
      code: 'GATE_NOT_READY',
      reasons: ['no Test result is bound'],
      needsRiskDisposition: [],
    };
  }
  if (testResult.status === 'blocked') {
    return {
      blocked: true,
      code: 'GATE_NOT_READY',
      reasons: ['the Test result is blocked; the Work cannot complete'],
      needsRiskDisposition: [],
    };
  }
  if (testResult.status === 'failed') {
    return {
      blocked: true,
      code: 'GATE_NOT_READY',
      reasons: ['the Test result failed and must return to development'],
      needsRiskDisposition: [],
    };
  }
  if (testResult.status === 'not_covered') {
    const missing = testResult.uncovered
      .filter((entry) => entry.riskDecisionId === undefined)
      .map((entry) => entry.acceptanceId);
    if (missing.length === 0 && testResult.uncovered.length > 0) {
      return { blocked: false };
    }
    return {
      blocked: true,
      code: 'GATE_NOT_READY',
      reasons: ['not_covered requires an explicit risk disposition for every acceptance id'],
      needsRiskDisposition: missing,
    };
  }
  return { blocked: false };
}

export interface FindingClosureInput {
  readonly finding: FindingCandidate;
  readonly actorRole: Role;
  readonly reviewRun?: VerificationRun;
  readonly testRun?: VerificationRun;
  /** The number of repair rounds already used against `repairLimit`. */
  readonly repairUsed?: number;
  readonly repairLimit?: number;
}

export type FindingClosureOutcome =
  | { readonly closed: true; readonly state: 'verified' | 'accepted_risk' }
  | {
      readonly closed: false;
      readonly transition: FindingTransition;
      readonly code: FindingVerificationFailureCode | 'BUDGET_EXCEEDED';
      readonly message: string;
      readonly requiresNewReview: boolean;
      readonly requiresNewTest: boolean;
    };

/**
 * AC-017/AC-018: one call for the whole closure decision.
 *
 * Routing first (does this return to development?), then the rework allowance,
 * then the independent-verification test. The old Review/Test of a fixed Finding
 * are invalid by construction, so a caller cannot close it with the pre-fix
 * evidence.
 */
export function evaluateFindingClosure(input: FindingClosureInput): FindingClosureOutcome {
  const routing = evaluateFindingRouting(input.finding);
  if (input.finding.state === 'open' || input.finding.state === 'addressed') {
    const repairUsed = input.repairUsed ?? 0;
    const repairLimit = input.repairLimit;
    if (repairLimit !== undefined && repairUsed >= repairLimit) {
      return {
        closed: false,
        transition: routing.transition,
        code: 'BUDGET_EXCEEDED',
        message: `repair rounds ${repairUsed}/${repairLimit} exhausted; the user must raise the budget`,
        requiresNewReview: true,
        requiresNewTest: true,
      };
    }
  }
  const verification = findingCanBeVerified({
    finding: input.finding,
    actorRole: input.actorRole,
    ...(input.reviewRun === undefined ? {} : { reviewRun: input.reviewRun }),
    ...(input.testRun === undefined ? {} : { testRun: input.testRun }),
  });
  if (!verification.ok) {
    return {
      closed: false,
      transition: routing.transition,
      code: verification.code,
      message: verification.message,
      requiresNewReview: routing.requiresNewReview,
      requiresNewTest: routing.requiresNewTest,
    };
  }
  return { closed: true, state: verification.state };
}

export interface FindingTargetBinding {
  readonly targetKind: 'task' | 'integration' | 'document';
  readonly taskId?: string;
  readonly targetRef: Ref;
}

export interface FindingBindingInput {
  readonly target: FindingTargetBinding;
  readonly manifestRef: Ref;
  /** Optional: a task target must carry one; an integration/document target need not. */
  readonly taskId?: string;
}

export type FindingBinding =
  | {
      readonly ok: true;
      readonly targetKind: 'task' | 'integration' | 'document';
      readonly taskId?: string;
      readonly manifestRef: Ref;
      readonly targetRef: Ref;
    }
  | { readonly ok: false; readonly code: 'VALIDATION_ERROR'; readonly message: string };

/**
 * AC-083: a Finding may bind to a Review target/Manifest with no `taskId`.
 *
 * An integration or document Finding binds the Manifest that names the frozen
 * revision under review; only a `task` target requires a real task id (and it may
 * come from either the target or the explicit `taskId`).
 */
export function bindFindingTarget(input: FindingBindingInput): FindingBinding {
  const taskId = input.taskId ?? input.target.taskId;
  if (input.target.targetKind === 'task' && taskId === undefined) {
    return {
      ok: false,
      code: 'VALIDATION_ERROR',
      message: 'a task-targeted Finding requires taskId',
    };
  }
  if (input.manifestRef.id === '' || input.manifestRef.hash === '') {
    return { ok: false, code: 'VALIDATION_ERROR', message: 'the Manifest reference is incomplete' };
  }
  return {
    ok: true,
    targetKind: input.target.targetKind,
    ...(taskId === undefined ? {} : { taskId }),
    manifestRef: input.manifestRef,
    targetRef: input.target.targetRef,
  };
}

// ---------------------------------------------------------------------------
// 6. Budget reservation (AC-022)
// ---------------------------------------------------------------------------

/** The subset of `contracts.Budget` the reservation rules read. */
export interface ReservationBudget {
  readonly tokenLimit: number;
  readonly tokensUsed: number;
  readonly tokensReserved: number;
}

/**
 * Adapts the documented admission helpers, which take a whole `contracts.Budget`
 * row, to the three counters this rule actually reads.
 *
 * The adapter is deliberately local: widening `canAllocateBudget`/`canStartRepair`
 * to a `Pick<Budget, …>` would be a change to `dispatch.ts`, which this work
 * package does not own, and a caller can always hand these helpers a real row.
 */
function budgetRowOf(
  budget: ReservationBudget,
  repair: { readonly repairUsed: number; readonly repairLimit: number } = {
    repairUsed: 0,
    repairLimit: 0,
  },
): Budget {
  return {
    id: 'domain-admission',
    projectId: 'domain-admission',
    version: 1,
    createdAt: '1970-01-01T00:00:00.000Z',
    updatedAt: '1970-01-01T00:00:00.000Z',
    workId: 'domain-admission',
    tokenLimit: budget.tokenLimit,
    tokensUsed: budget.tokensUsed,
    tokensReserved: budget.tokensReserved,
    activeTimeLimit: 0,
    activeTimeUsed: 0,
    repairLimit: repair.repairLimit,
    repairUsed: repair.repairUsed,
    costKnown: false,
  };
}

export interface AtomicBudgetDecision {
  readonly ok: boolean;
  readonly code?: 'BUDGET_EXCEEDED' | 'VALIDATION_ERROR';
  readonly message: string;
  /** `true` only when the caller must obtain an explicit budget increase first. */
  readonly requiresUserTopUp: boolean;
  /** The budget the caller must persist; unchanged from the input when refused. */
  readonly budgetAfter: ReservationBudget;
}

function unchangedBudget(budget: ReservationBudget): ReservationBudget {
  return {
    tokenLimit: budget.tokenLimit,
    tokensUsed: budget.tokensUsed,
    tokensReserved: budget.tokensReserved,
  };
}

/**
 * AC-022: reserve tokens or refuse the whole request.
 *
 * Refusal is atomic and total: `budgetAfter` is returned unchanged, so a caller
 * cannot accidentally persist a partial charge. The admission itself is the
 * existing `canAllocateBudget` rule from `dispatch.ts`; a user-sourced increase is
 * the only way to continue, which is why a refusal always sets
 * `requiresUserTopUp` ("预算提高必须用户来源", `reliability.md` §3).
 */
export function canReserveBudget(
  input: { readonly budget: ReservationBudget; readonly requested: number },
  authorizesTopUp = false,
): AtomicBudgetDecision {
  const { budget, requested } = input;
  if (!Number.isInteger(requested) || requested < 0) {
    return {
      ok: false,
      code: 'VALIDATION_ERROR',
      message: 'requested reservation must be a non-negative integer',
      requiresUserTopUp: false,
      budgetAfter: unchangedBudget(budget),
    };
  }
  const decision = canAllocateBudget(budgetRowOf(budget), requested);
  if (!decision.ok) {
    return {
      ok: false,
      code: codeOf(decision.code),
      message: authorizesTopUp
        ? `${decision.message}; the user must increase the Work budget explicitly`
        : decision.message,
      requiresUserTopUp: true,
      budgetAfter: unchangedBudget(budget),
    };
  }
  return {
    ok: true,
    message: `reserved ${requested}`,
    requiresUserTopUp: false,
    budgetAfter: { ...budget, tokensReserved: budget.tokensReserved + requested },
  };
}

/**
 * AC-022: whether another repair/rework round is still allowed.
 *
 * The allowance is the existing `canStartRepair` rule; a refusal likewise demands
 * an explicit user decision instead of a silent top-up.
 */
export interface ReworkAllowanceDecision {
  readonly ok: boolean;
  readonly code?: 'BUDGET_EXCEEDED';
  readonly message: string;
  readonly requiresUserTopUp: boolean;
  readonly repairUsed: number;
  readonly repairLimit: number;
}

export function evaluateReworkAllowance(budget: {
  readonly repairUsed: number;
  readonly repairLimit: number;
}): ReworkAllowanceDecision {
  const decision = canStartRepair(budgetRowOf(unlimitedBudget(), budget));
  if (!decision.ok) {
    return {
      ok: false,
      code: 'BUDGET_EXCEEDED',
      message: decision.message,
      requiresUserTopUp: true,
      repairUsed: budget.repairUsed,
      repairLimit: budget.repairLimit,
    };
  }
  return {
    ok: true,
    message: `repair round ${budget.repairUsed + 1}/${budget.repairLimit}`,
    requiresUserTopUp: false,
    repairUsed: budget.repairUsed,
    repairLimit: budget.repairLimit,
  };
}

/** A zeroed counter set for the admission helpers' unused token fields. */
function unlimitedBudget(): ReservationBudget {
  return { tokenLimit: 0, tokensUsed: 0, tokensReserved: 0 };
}

/**
 * Maps a `dispatch.DispatchRejectionCode` onto the reservation verdict.
 *
 * Only the two codes `canAllocateBudget` can return are meaningful here; anything
 * else fails closed rather than being reported as success.
 */
function codeOf(code: DispatchRejectionCode): 'BUDGET_EXCEEDED' | 'VALIDATION_ERROR' {
  return code === 'VALIDATION_ERROR' ? 'VALIDATION_ERROR' : 'BUDGET_EXCEEDED';
}
