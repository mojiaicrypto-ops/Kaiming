/**
 * Level routing (`docs/rules/workflow.md` §1–§2).
 *
 * The order below is the document's own decision order, and it is deliberately
 * fail-closed: anything that is not `none` by intent, not an explicit `L3` risk
 * and not a fully satisfied L1 is `L2` — never silently smaller.
 */
import type { Intent, Level, OperationName } from '@agentdev/contracts';

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

/**
 * The documented risk vocabulary of `workflow.md` §2.3, per canonical flag.
 *
 * The document states the criteria in Chinese prose while the code uses camelCase
 * flags, so both spellings (and the obvious English variants) must select the same
 * lockdown risk — a documented term that silently routed to L2 would be a
 * fail-open security gate (DC-62).
 */
export const LOCKDOWN_RISK_TERMS: Readonly<Record<keyof LockdownRisk, readonly string[]>> = {
  identityOrPermission: [
    'identityOrPermission',
    'identity',
    'permission',
    'authentication',
    '授权',
    '权限',
    '身份认证',
    '权限判断',
  ],
  secrets: ['secrets', 'secret', 'Secret', 'credential', '密钥', '凭证'],
  securityBoundary: ['securityBoundary', 'security_boundary', '安全边界'],
  dataDeletionOrMigration: [
    'dataDeletionOrMigration',
    'dataDeletion',
    'migration',
    '数据删除',
    '数据迁移',
    '数据删除/迁移',
  ],
  payment: ['payment', '支付金额', '支付状态', '支付金额/状态', '支付'],
  publicProtocolBreak: ['publicProtocolBreak', 'protocolBreak', '公开协议不兼容', '公开协议变更'],
  deployOrRelease: ['deployOrRelease', 'deploy', 'release', '部署/发布', '部署', '发布'],
  gateRuleChange: ['gateRuleChange', 'gateChange', '项目门禁规则变化', '门禁规则变化'],
};

/** Case- and separator-insensitive form of a risk term. */
function normalizeRiskTerm(term: string): string {
  return term
    .trim()
    .toLowerCase()
    .replace(/[\s_/-]+/gu, '');
}

/** True for a risk flag that names a documented lockdown criterion. */
export function isKnownLockdownRiskTerm(flag: string): boolean {
  const normalized = normalizeRiskTerm(flag);
  return Object.values(LOCKDOWN_RISK_TERMS).some((terms) =>
    terms.some((term) => normalizeRiskTerm(term) === normalized),
  );
}

/**
 * Operations whose effect on a running environment is **irreversible**
 * (`workflow.md` §2.2/§2.3, `docs/architecture/execution.md` §2).
 *
 * The set lives here, next to the routing decision and the risk vocabulary, and is
 * derived from the contract's `operationNameSchema` so a new operation name is a
 * compile-time reminder to classify it. Under the host-first model `bash`, `git` and
 * the network are ordinary development capabilities inside an approved envelope: a
 * build, a test run, a dependency install or a request to a local service must not be
 * forced onto the L3 route or onto a per-occurrence user decision. Only an effect that
 * cannot be undone from the workspace — a remote push, a deployment/publish, a data
 * deletion — is an environment operation here, and it is the same set
 * `permissions.ts` `PERMISSION_OPERATIONS` approves per occurrence.
 *
 * `read`/`search` are read-only; `edit`/`write`/`artifact_write` act on the local
 * workspace; `bash`/`network`/`secret` are the envelope's ordinary execution surface
 * ({@link ENVELOPE_OPERATIONS}). Every one of the twelve contract operations is
 * classified exactly once (R17-05, guarded by the domain test).
 */
export const ENVIRONMENT_OPERATIONS = [
  'push',
  'deploy',
  'delete_data',
] as const satisfies readonly OperationName[];

/**
 * The shell/network/secret operations an approved envelope grants directly.
 *
 * `execution.md` §2 names `bash` (builds, tests, dependency installs, local and public
 * network access) as part of the Plan-time envelope, so these run unprompted inside
 * the path boundary; the two fixed network denials and the hard-refusal list stay.
 * The set is explicit (rather than "everything the environment set does not name") so
 * a new operation name still forces a deliberate classification.
 */
export const ENVELOPE_OPERATIONS = [
  'bash',
  'network',
  'secret',
] as const satisfies readonly OperationName[];

const ENVIRONMENT_OPERATION_SET: ReadonlySet<string> = new Set(ENVIRONMENT_OPERATIONS);

/**
 * Operations that write inside the workspace.
 *
 * They do not reach a running environment, but they do modify tracked files, so a
 * Work that grants no modification authority (`none`) must not hand them out even
 * when the path list happens to be empty (R13-02).
 */
export const WORKSPACE_WRITE_OPERATIONS = [
  'edit',
  'write',
  // `git` covers commit/checkout/reset, all of which rewrite tracked files
  // (`execution.md` §53 lists it among the modifying operations); the remote half is
  // the separate `push` operation, which the environment set already gates (R14-01).
  'git',
] as const satisfies readonly OperationName[];

/**
 * Writes that only produce the Run's own Artifact.
 *
 * `execution.md` §21/§53 makes `artifact_write` a base tool for every role — a
 * read-only investigation writes its own report — so it is not modification
 * authority over the repository and a `none`-level Work may use it (R16-01).
 * Writing tracked files still needs `writePaths` and a write operation.
 */
export const ARTIFACT_WRITE_OPERATIONS = [
  'artifact_write',
] as const satisfies readonly OperationName[];

const WORKSPACE_WRITE_OPERATION_SET: ReadonlySet<string> = new Set(WORKSPACE_WRITE_OPERATIONS);

/** Operations that read the workspace or the network. */
export const READ_OPERATIONS = ['read', 'search'] as const satisfies readonly OperationName[];

const READ_OPERATION_SET: ReadonlySet<string> = new Set(READ_OPERATIONS);

/** True when any of `operations` can write inside the workspace. */
export function includesWorkspaceWrite(operations: readonly string[]): boolean {
  return operations.some((operation) => WORKSPACE_WRITE_OPERATION_SET.has(operation));
}

/** True when any of `operations` can read. */
export function includesRead(operations: readonly string[]): boolean {
  return operations.some((operation) => READ_OPERATION_SET.has(operation));
}

/** True when the declared scope writes anything, by path or by operation. */
export function declaresWorkspaceWrite(scope: {
  readonly operations: readonly string[];
  readonly writePaths: readonly string[];
}): boolean {
  return (
    scope.writePaths.length > 0 ||
    scope.operations.some((operation) => WORKSPACE_WRITE_OPERATION_SET.has(operation))
  );
}

/** True when the declared scope reaches beyond the local workspace. */
export function touchesRunningEnvironment(scope: {
  readonly operations: readonly string[];
  readonly networkTargets: readonly string[];
}): boolean {
  return (
    scope.networkTargets.length > 0 ||
    scope.operations.some((operation) => ENVIRONMENT_OPERATION_SET.has(operation))
  );
}

/**
 * Risk flags the vocabulary does not recognize.
 *
 * A Chief must classify with the documented terms or the canonical flags; an
 * unknown flag would otherwise be silently treated as "no risk", turning the L3
 * security gate into a fail-open (R10-01). The Core refuses such an assessment and
 * lists the accepted vocabulary instead.
 */
export function unknownRiskFlags(flags: readonly string[]): string[] {
  return flags.filter((flag) => !isKnownLockdownRiskTerm(flag));
}

/** Every accepted risk term, for diagnostics and product review. */
export function lockdownRiskVocabulary(): string[] {
  return Object.values(LOCKDOWN_RISK_TERMS).flat();
}

/** Resolves loose risk text onto the canonical lockdown risk shape. */
export function riskFromFlags(flags: readonly string[]): LockdownRisk {
  const risk: Record<string, boolean> = { ...NO_LOCKDOWN_RISK };
  for (const flag of flags) {
    const normalized = normalizeRiskTerm(flag);
    for (const [key, terms] of Object.entries(LOCKDOWN_RISK_TERMS)) {
      if (terms.some((term) => normalizeRiskTerm(term) === normalized)) risk[key] = true;
    }
  }
  return risk as unknown as LockdownRisk;
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
  // The hard gates come first, before any per-intent shortcut: an `assist` (or
  // `artifact`) request that declares a deployment, a network write or a documented
  // lockdown risk is still an L3 action, and a label must never open the gate
  // (R11-01).
  if (input.operationTouchesEnvironment) {
    return { level: 'L3', reason: 'operation touches a running environment' };
  }
  if (hasLockdownRisk(input.risk)) {
    return {
      level: 'L3',
      reason: `lockdown risk: ${lockdownRiskFlags(input.risk).join(', ')}`,
    };
  }
  if (input.intent === 'assist' || input.intent === 'artifact') {
    return { level: 'none', reason: `${input.intent} routes to level none` };
  }
  if (input.intent === 'delivery' || input.intent === 'document') {
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
