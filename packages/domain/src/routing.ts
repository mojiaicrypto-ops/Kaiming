/**
 * Level routing (`docs/rules/workflow.md` §1–§2).
 *
 * The order below is the document's own decision order, and it is deliberately
 * fail-closed: anything that is not `none` by intent, not an explicit `L3` risk
 * and not a fully satisfied L1 is `L2` — never silently smaller.
 */
import type { Intent, Level } from '@agentdev/contracts';

/** L1 admission conditions (`workflow.md` §2 step 4). */
export interface L1Criteria {
  /** The replacement target is unambiguous. */
  readonly goalSubstitutionExplicit: boolean;
  /** Only styling, copy, comments or ordinary prose changed. */
  readonly presentationOnly: boolean;
  /** No behaviour, public interface, data structure, dependency/lockfile change. */
  readonly noContractChange: boolean;
  /** No executable configuration or test assertion changed. */
  readonly noExecutableConfigChange: boolean;
  /** Related unknowns are excluded. */
  readonly unknownsExcluded: boolean;
  /** Files touched by the change. */
  readonly filesChanged: number;
  /** Lines added/removed by non-generated diffs. */
  readonly diffLines: number;
}

/** Conservative L1 bounds (`workflow.md` §2: "≤3文件且非生成Diff新增+删除≤20行"). */
export const L1_BOUNDS = { maxFiles: 3, maxDiffLines: 20 } as const;

export function isL1Eligible(criteria: L1Criteria): boolean {
  return (
    criteria.goalSubstitutionExplicit &&
    criteria.presentationOnly &&
    criteria.noContractChange &&
    criteria.noExecutableConfigChange &&
    criteria.unknownsExcluded &&
    criteria.filesChanged <= L1_BOUNDS.maxFiles &&
    criteria.diffLines <= L1_BOUNDS.maxDiffLines
  );
}

/** Rejection reasons, so the Assessment record can explain the level. */
export function l1Failures(criteria: L1Criteria): string[] {
  const failures: string[] = [];
  if (!criteria.goalSubstitutionExplicit) failures.push('goal substitution is ambiguous');
  if (!criteria.presentationOnly) failures.push('change is not presentation-only');
  if (!criteria.noContractChange) failures.push('behaviour/interface/data/dependency change');
  if (!criteria.noExecutableConfigChange) failures.push('executable config or assertion change');
  if (!criteria.unknownsExcluded) failures.push('related unknowns remain');
  if (criteria.filesChanged > L1_BOUNDS.maxFiles) {
    failures.push(`files changed ${criteria.filesChanged} exceeds ${L1_BOUNDS.maxFiles}`);
  }
  if (criteria.diffLines > L1_BOUNDS.maxDiffLines) {
    failures.push(`diff lines ${criteria.diffLines} exceeds ${L1_BOUNDS.maxDiffLines}`);
  }
  return failures;
}

export interface LockdownRisk {
  /** Identity/authentication or permission decisions. */
  readonly identityOrPermission: boolean;
  /** Secret handling. */
  readonly secrets: boolean;
  /** Security boundary. */
  readonly securityBoundary: boolean;
  /** Data deletion or migration. */
  readonly dataDeletionOrMigration: boolean;
  /** Payment amounts or payment state. */
  readonly payment: boolean;
  /** Incompatible public protocol change. */
  readonly publicProtocolBreak: boolean;
  /** Deployment or release. */
  readonly deployOrRelease: boolean;
  /** Change to project Gate rules. */
  readonly gateRuleChange: boolean;
}

export const NO_LOCKDOWN_RISK: LockdownRisk = {
  identityOrPermission: false,
  secrets: false,
  securityBoundary: false,
  dataDeletionOrMigration: false,
  payment: false,
  publicProtocolBreak: false,
  deployOrRelease: false,
  gateRuleChange: false,
};

export function hasLockdownRisk(risk: LockdownRisk): boolean {
  return Object.values(risk).some(Boolean);
}

export function lockdownRiskFlags(risk: LockdownRisk): string[] {
  return Object.entries(risk)
    .filter(([, value]) => value)
    .map(([key]) => key);
}

export interface RoutingInput {
  readonly intent: Intent;
  /** Operation targets a running environment, network write or data operation. */
  readonly operationTouchesEnvironment: boolean;
  readonly risk: LockdownRisk;
  /** Present for `delivery`/`document` requests; absent means L1 is impossible. */
  readonly l1?: L1Criteria;
}

export interface RoutingDecision {
  readonly level: Level;
  readonly reason: string;
}

/**
 * Applies `workflow.md` §2 in order.
 *
 * `none` never carries modification authority; `L3` always requires an explicit
 * operation authorization and cannot be auto-approved.
 */
export function decideLevel(input: RoutingInput): RoutingDecision {
  if (input.intent === 'assist' || input.intent === 'artifact') {
    return { level: 'none', reason: `${input.intent} routes to level none` };
  }
  if (input.intent === 'operation' && input.operationTouchesEnvironment) {
    return { level: 'L3', reason: 'operation touches a running environment' };
  }
  if (input.intent === 'delivery' || input.intent === 'document') {
    if (hasLockdownRisk(input.risk)) {
      return {
        level: 'L3',
        reason: `lockdown risk: ${lockdownRiskFlags(input.risk).join(', ')}`,
      };
    }
    if (input.l1 !== undefined && isL1Eligible(input.l1)) {
      return { level: 'L1', reason: 'L1 conditions all hold' };
    }
  }
  return { level: 'L2', reason: 'default L2 route' };
}

/** True when a level may modify tracked files at all. */
export function grantsModificationAuthority(level: Level): boolean {
  return level === 'L1' || level === 'L2' || level === 'L3';
}

/** L3 is the only level that may auto-approve nothing: it always needs a user. */
export function requiresExplicitAuthorization(level: Level): boolean {
  return level === 'L3';
}
