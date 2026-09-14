/**
 * Chief orchestration: assessment, dispatch freezing and Run creation.
 *
 * `rules/agents.md` §3 and `data.md` §3 fix the shape of the loop and the two
 * invariants that are enforced here rather than trusted to callers:
 *
 * - every professional Run is a **direct child of a Chief Run in the same Work**;
 *   a non-Chief parent is refused, which is what makes grandchild Runs impossible
 *   even when a professional Agent asks for one (`request_dispatch` only files a
 *   `chief_action_required` todo);
 * - a Run is created only with its frozen `config`/`context`/`dispatch` snapshots,
 *   so a later configuration edit cannot reach it (AC-044) and the schema/scope a
 *   Runner must honour is recorded before the Run exists (AC-082 reuses it after a
 *   restart).
 */
import {
  assessRequestSchema,
  dispatchExtrasSchema,
  dispatchRequestSchema,
  dispatchSnapshotSchema,
  dispatchSpecSchema,
  professionalDispatchSpecSchema,
  type Assessment,
  type AssessmentPayload,
  type Attempt,
  type DispatchSnapshot,
  type DispatchSpec,
  type JsonObject,
  type Level,
  type OperationName,
  type ProfessionalDispatchSpec,
  type Run,
  type Scope,
  type SourceRef,
  type Work,
} from '@agentdev/contracts';
import {
  canAllocateBudget,
  declaresWorkspaceWrite,
  decideLevel,
  includesRead,
  includesWorkspaceWrite,
  grantsModificationAuthority,
  isDirectChiefChild,
  isTerminalRunStatus,
  PRIMARY_PURPOSE_BY_ROLE,
  requiresExplicitAuthorization,
  lockdownRiskVocabulary,
  riskFromFlags,
  touchesRunningEnvironment,
  unknownRiskFlags,
  validateDispatchSpec,
  validateRolePurpose,
  type DispatchDecision,
} from '@agentdev/domain';
import { withTransaction, type ProjectStore } from '@agentdev/storage';
import type { ConfigStore, ProfileLayer, ProfileResolution } from './config.js';
import { RunLifecycle, type RunUsage } from './run-lifecycle.js';
import { ProtocolError, type ProtocolErrorCode } from './errors.js';
import { findEvent } from './events.js';
import type { ModelGateway } from './model-gateway.js';
import { canonicalJson } from './dispatcher.js';
import { sha256 } from '@agentdev/storage';
import type { SnapshotWriter } from './snapshots.js';

export interface OrchestratorOptions {
  readonly store: ProjectStore;
  readonly config: ConfigStore;
  readonly snapshots: SnapshotWriter;
  readonly gateway: ModelGateway;
  /** Shared lifecycle; a caller may pass its own so `StageGate` shares the path. */
  readonly lifecycle?: RunLifecycle;
}

export interface AssessInput {
  readonly workId: string;
  readonly payload: AssessmentPayload;
  /**
   * Set by `assessAndDispatch` when Core derived this very authorization from the
   * assessment (WP-12 Q1=B), so the work-row check is deferred to `assertDeclaredAuthority`
   * on the declared level instead of being skipped.
   */
  readonly derivedAuthorization?: boolean;
}

/**
 * One Chief assessment that also freezes the professional Run it decided on.
 *
 * `protocol.md` §6 has the Chief submit through `assessment.submit` and then
 * `agent.dispatch`; this input is exactly that pair, with the server-owned fields (the
 * Work, the profile revision, the authorization) left to Core so a Runner cannot name
 * them.
 */
/**
 * The `ProfessionalDispatchSpec` draft an `agent.dispatch` caller may submit.
 *
 * `kind`, `workId` and `profileRevision` are Core's (`data.md` §3 "ProfessionalDispatchSpec
 * 仅由Core根据…构建"), so the draft cannot name them; `parentRunId` is still part of the
 * draft because the Chief must declare the intent, but Core verifies it against the
 * capability's own Run before freezing it.
 */
export type ProfessionalSpecDraft = Omit<
  ProfessionalDispatchSpec,
  'kind' | 'workId' | 'profileRevision'
>;

export interface AssessAndDispatchInput {
  readonly workId: string;
  readonly payload: AssessmentPayload;
  /** The `ProfessionalDispatchSpec` draft the model submitted, minus Core-owned fields. */
  readonly spec: ProfessionalSpecDraft;
  /**
   * The Chief Run the capability belongs to.
   *
   * The parent comes from the caller's own Attempt binding, never from the model: a draft
   * that names another Run is refused rather than followed (`rules/agents.md` §3 "所有子Run为
   * ChiefRun的直接子级").
   */
  readonly parentRunId: string;
  /**
   * The source Core derives the authorization from when the Work has none.
   *
   * `PRODUCT.md` §5: "明确的自然语言执行指令与按钮授权等价", so the message that carried
   * the instruction is the authorization's source (`workflow.md` §1). Absent means the
   * caller already bound the Work's authority and no derivation is attempted.
   */
  readonly sourceRef?: SourceRef;
  readonly contextPayload?: JsonObject;
  readonly requiredOutputSchemas?: readonly { readonly kind: string; readonly schemaVersion: 1 }[];
}

export interface AssessAndDispatchResult {
  readonly assessment: Assessment;
  /** The authorization Core derived or verified, when the Run needed one. */
  readonly authorizationRef: string | undefined;
  readonly dispatch: DispatchResult;
}

export interface DispatchInput {
  readonly spec: DispatchSpec;
  /**
   * The frozen context payload.
   *
   * WP-02 freezes the DispatchSpec's own ContextSelection, which is enough to
   * prove the reference chain; the assembled content (and its token accounting)
   * arrives with ContextBuilder in WP-06, which passes its own payload here.
   */
  readonly contextPayload?: JsonObject;
  /** Output Schema names the Runner must satisfy (`contracts` kinds). */
  readonly requiredOutputSchemas?: readonly { readonly kind: string; readonly schemaVersion: 1 }[];
  readonly authorizationRef?: string;
  /**
   * Authorized Run parameters — the strongest configuration layer (`agents.md` §5).
   *
   * They must come from an authorization the user granted; a later package binds
   * them to the Authorization record (DC-38), and until then Core is their only
   * source.
   */
  readonly runParams?: ProfileLayer;
}

/** What a Run must honour after a restart, all of it from frozen snapshots. */
export interface RunRecoveryView {
  readonly run: Run;
  readonly dispatchSnapshot: DispatchSnapshot;
  /** The narrow, frozen scope; the Work scope never substitutes for it. */
  readonly effectiveScope: DispatchSnapshot['effectiveScope'];
  readonly requiredOutputSchemas: DispatchSnapshot['requiredOutputSchemas'];
  readonly profile: ProfileResolution;
}

export interface DispatchResult {
  readonly run: Run;
  readonly profile: ProfileResolution;
  readonly dispatchSnapshot: DispatchSnapshot;
  readonly configSnapshotId: string;
  readonly contextSnapshotId: string;
}

/**
 * A professional Agent's request; it never creates a Run.
 *
 * The shape follows `protocol.md` §6 `agent.request_dispatch`
 * (`workId,reason,requestedRole,goal,sourceRefs`); `runId` is the capability's
 * Attempt→Run binding, and the optional fields let a caller be more specific
 * without ever gaining the right to create the Run itself.
 */
export interface DispatchRequestInput {
  readonly runId: string;
  readonly workId?: string;
  readonly reason?: string;
  readonly requestedRole: string;
  readonly goal: string;
  readonly sourceRefs?: readonly {
    readonly kind: string;
    readonly id: string;
    /** Required by `sourceRefSchema`; the interface must not be looser (R10-04). */
    readonly version: string;
  }[];
  readonly parentRunId?: string;
  readonly purpose?: string;
  readonly stage?: string;
  readonly requiredOutputs?: readonly string[];
  readonly requiredChild?: boolean;
  readonly budgetAllocation?: number;
  /** Idempotency key for one request (`reliability.md` §1). */
  readonly operationId?: string;
}

export interface DispatchRequestResult {
  readonly disposition: 'chief_action_required';
  readonly runId: string;
  readonly workId: string;
  readonly chiefTodo: string;
}

/**
 * Stable fingerprint of one dispatch request, used for `operationId` idempotency.
 *
 * Only the request's own fields: a replay with the same key and same content
 * returns the original todo, anything else is a conflict.
 */
function operationFingerprint(request: JsonObject): string {
  return sha256(canonicalJson(request));
}

/**
 * The lowest level the Core can insist on from the assessment payload alone.
 *
 * `workflow.md` §2.4 keeps L1 admission on file/line bounds that only a diff can
 * prove, so a delivery that *claims* the checkable L1 preconditions (no semantic
 * impact, no operation, no network write) may still be routed L1 by the Chief;
 * everything else defaults to L2 and a lockdown risk to L3.
 */
function routingFloor(
  payload: AssessmentPayload,
  decided: 'none' | 'L1' | 'L2' | 'L3',
): 'none' | 'L1' | 'L2' | 'L3' {
  if (decided === 'L3') return 'L3';
  if (payload.intent === 'assist' || payload.intent === 'artifact') return 'none';
  // An operation performs an action even when it stays inside the workspace, and
  // `workflow.md` §2.4 restricts L1 to presentation-only edits, so its floor is L2
  // (R11-02).
  if (payload.intent === 'operation') return 'L2';
  const claimsL1 =
    !payload.semanticImpact &&
    payload.scope.operations.length === 0 &&
    payload.scope.networkTargets.length === 0;
  return claimsL1 ? 'L1' : 'L2';
}

/** Order of the routing levels; `none` is below every modification level. */
function levelRank(level: string): number {
  return level === 'none' ? 0 : level === 'L1' ? 1 : level === 'L2' ? 2 : 3;
}

/**
 * Operations a derived authorization may contain (`WP-12` user decision Q1=B).
 *
 * A natural-language execution instruction authorizes *file* work: reading, searching and
 * editing the project. `bash`, `network`, `secret`, `push`, `deploy` and `delete_data` are
 * environment operations; they still require the explicit path (`workflow.md` §2.2/§2.3,
 * AC-011/AC-080), so derivation never produces them.
 */
export const DERIVABLE_OPERATIONS: readonly OperationName[] = [
  'read',
  'search',
  'edit',
  'write',
  'git',
];

/** Operations that always need an explicit authorization, never a derived one. */
export const ENVIRONMENT_OPERATIONS: readonly OperationName[] = [
  'bash',
  'network',
  'secret',
  'push',
  'deploy',
  'delete_data',
];

/**
 * Rejects a scope that a derived authorization may not carry.
 *
 * Fails closed: an assessment that reaches for an environment operation, a network target or
 * a path outside the project root is refused with a typed error instead of being silently
 * narrowed (a narrower grant the model did not ask for would hide a real escalation).
 */
export function assertDerivableScope(
  workId: string,
  scope: Scope,
  allowed: readonly OperationName[],
): readonly OperationName[] {
  const environment = scope.operations.filter((operation) =>
    (ENVIRONMENT_OPERATIONS as readonly string[]).includes(operation),
  );
  if (environment.length > 0) {
    fail(
      'NOT_AUTHORIZED',
      `a derived authorization never grants environment operations: ${environment.join(', ')}`,
      { workId, operations: [...environment], explicit: [...ENVIRONMENT_OPERATIONS] },
    );
  }
  if (scope.networkTargets.length > 0) {
    fail('NOT_AUTHORIZED', 'a derived authorization never grants network targets', {
      workId,
      networkTargets: [...scope.networkTargets],
    });
  }
  const undecided = scope.operations.filter(
    (operation) => !(allowed as readonly string[]).includes(operation),
  );
  if (undecided.length > 0) {
    fail('NOT_AUTHORIZED', `a derived authorization does not cover: ${undecided.join(', ')}`, {
      workId,
      operations: [...undecided],
    });
  }
  const outside = [...scope.readPaths, ...scope.writePaths].filter(
    (path) => !isProjectRelativePath(path),
  );
  if (outside.length > 0) {
    fail('VALIDATION_ERROR', 'a derived authorization must stay inside the project root', {
      workId,
      outsideProjectRoot: outside,
    });
  }
  return scope.operations;
}

/**
 * True for a repository-relative path that cannot leave the project root.
 *
 * `repoPathSchema` already refuses absolute paths; this is the second, explicit check the
 * derivation makes before it writes authority, so a `..` segment or a Windows drive letter
 * cannot slip through a future schema change.
 */
export function isProjectRelativePath(path: string): boolean {
  if (path.length === 0 || path.startsWith('/') || path.startsWith('~')) return false;
  if (/^[A-Za-z]:/u.test(path)) return false;
  const segments = path.split(/[\\/]+/u);
  return !segments.includes('..');
}

/**
 * The authorization Core derives from an assessment (`WP-12` Q1=B).
 *
 * The evidence is the assessment's own scope: the paths the Chief says the work touches.
 * A scope with no write path derives nothing — authority is only written when there is
 * something to authorize — and the caller keeps the existing explicit-grant path for
 * messages that name paths.
 */
function derivedAuthorization(
  scope: Scope,
  declared: readonly OperationName[],
  allowed: readonly OperationName[],
): { readonly scope: Scope; readonly operations: readonly OperationName[] } | undefined {
  if (scope.writePaths.length === 0) return undefined;
  // A write path is also readable: the derived envelope must cover the read the Run will
  // actually perform, or `verifyAuthorization` refuses its own grant.
  const readPaths = [...new Set([...scope.readPaths, ...scope.writePaths])];
  // The declared scope may name only paths (`workflow.md` §1 has the Chief submit a scope,
  // not a capability list), so the derived envelope also carries the operations its own
  // paths require; `verifyAuthorization` would otherwise refuse the grant Core just wrote
  // ("writePaths without a write operation").
  const operations = [...new Set([...declared, ...operationsForPaths(scope, allowed)])];
  return {
    scope: { readPaths, writePaths: [...scope.writePaths], operations, networkTargets: [] },
    operations,
  };
}

/** The deriable operations a scope's own paths imply, restricted to the allowlist. */
function operationsForPaths(scope: Scope, allowed: readonly OperationName[]): OperationName[] {
  const wants = (operation: OperationName): boolean =>
    (allowed as readonly string[]).includes(operation);
  const operations: OperationName[] = [];
  if ((scope.readPaths.length > 0 || scope.writePaths.length > 0) && wants('read')) {
    operations.push('read');
  }
  if (scope.writePaths.length > 0) {
    for (const operation of ['edit', 'write'] as const) {
      if (wants(operation)) operations.push(operation);
    }
  }
  return operations;
}

function fail(code: ProtocolErrorCode, message: string, details?: JsonObject): never {
  throw new ProtocolError(code, message, details === undefined ? {} : { details });
}

/** Maps a domain admission decision onto the protocol error space. */
function enforce(decision: DispatchDecision | undefined, what: string): void {
  if (decision === undefined || decision.ok) return;
  const code: ProtocolErrorCode =
    decision.code === 'BUDGET_EXCEEDED'
      ? 'BUDGET_EXCEEDED'
      : decision.code === 'NOT_AUTHORIZED'
        ? 'NOT_AUTHORIZED'
        : decision.code === 'MISSING_CONTEXT'
          ? 'MISSING_CONTEXT'
          : 'VALIDATION_ERROR';
  fail(code, `${what}: ${decision.message}`);
}

export class Orchestrator {
  private readonly store: ProjectStore;
  private readonly config: ConfigStore;
  private readonly snapshots: SnapshotWriter;
  private readonly gateway: ModelGateway;
  /** Shared terminal path: Run status plus budget reservation (N-01). */
  readonly lifecycle: RunLifecycle;

  constructor(options: OrchestratorOptions) {
    this.store = options.store;
    this.config = options.config;
    this.snapshots = options.snapshots;
    this.gateway = options.gateway;
    this.lifecycle = options.lifecycle ?? new RunLifecycle({ store: options.store });
  }

  /** The revision a DispatchSpec must name to be accepted (`profileRevision`). */
  currentProfileRevision(role: Parameters<ModelGateway['availability']>[0]): number {
    const availability = this.gateway.availability(role);
    if (!availability.ok) {
      fail('PROVIDER_UNAVAILABLE', `role ${role} has no usable model: ${availability.reason}`);
    }
    return availability.resolution.revision;
  }

  /**
   * Records one routing assessment.
   *
   * `assessment` is immutable and every re-assessment is a new row, so the history
   * of how the Work was routed stays observable (`data.md` §2).
   */
  assess(input: AssessInput): Assessment {
    // `protocol.md` §1/§6: a malformed `assessment.submit` is a `VALIDATION_ERROR`,
    // never a raw TypeError or a storage-layer violation (R8-02); the protocol names
    // the payload field `assessment` (D).
    const { workId, assessment: payload } = parseOrFail(
      assessRequestSchema,
      { workId: input.workId, assessment: input.payload },
      'assessment.submit',
    );
    const work = this.requireWork(workId);
    // The same authority invariant as `dispatch`: a Work that grants nothing cannot declare
    // a scope that writes or acts on an environment, so `assess` and `dispatch` cannot
    // disagree about the same scope (R16-01/M-2).
    //
    // The exception is a *derived* authorization (`WP-12` Q1=B): Core creates it from this
    // very assessment, inside the transaction below, so the Work row has not caught up yet.
    // The declared level is checked instead — a write scope is only reachable when the
    // assessment itself routes L1/L2/L3 — and `deriveAuthorization` never grants an
    // environment operation, so an environment scope still needs a real grant.
    if (input.derivedAuthorization !== true && !grantsModificationAuthority(work.level)) {
      assertDeclaredAuthority(work, payload.authorizationRef, work.level, payload.scope);
    }
    // The documented routing order is re-applied here (`workflow.md` §2) so a Chief
    // cannot record a lower level than the lockdown/operation rules demand. Only
    // the L3 floor is enforced as a hard error: L1 vs L2 depends on criteria the
    // assessment payload does not carry, so a stricter submitted level is allowed.
    // An unrecognized risk flag would be read as "no risk" and silently open the
    // L3 gate, so the assessment is refused with the accepted vocabulary instead
    // (R10-01).
    const unknownRisk = unknownRiskFlags(payload.riskFlags);
    if (unknownRisk.length > 0) {
      fail(
        'VALIDATION_ERROR',
        `unknown riskFlags: ${unknownRisk.join(', ')}; use the documented terms`,
        { workId: work.id, unknownRiskFlags: unknownRisk, vocabulary: lockdownRiskVocabulary() },
      );
    }
    // `workflow.md` §2.2: an operation that touches a running environment, writes
    // over the network or changes data is L3. The evidence is the payload's own
    // scope — never the Work row's current level, which would make the floor
    // circular (DC-62) — and it applies whatever the `intent` label says, so a
    // delivery cannot smuggle a deployment past the gate.
    const decided = decideLevel({
      intent: payload.intent,
      operationTouchesEnvironment: touchesRunningEnvironment(payload.scope),
      risk: riskFromFlags(payload.riskFlags),
    });
    // The Core decision is a floor: a Chief may escalate but never downgrade it
    // (`workflow.md` §2 「自动降级不支持」). The floor is the *hard* requirement —
    // L3 for lockdown/operation work, L2 for a delivery whose L1 preconditions are
    // not even claimed — because L1 vs L2 otherwise depends on diff evidence the
    // Chief owns (DC-62; the conservative L1 file/line bounds stay a Plan gate).
    const floor = routingFloor(payload, decided.level);
    if (levelRank(payload.level) < levelRank(floor)) {
      fail(
        'VALIDATION_ERROR',
        `routing rules require ${floor} (${decided.reason}) but the assessment says ${payload.level}`,
        { workId: work.id, decidedLevel: decided.level, floor, submittedLevel: payload.level },
      );
    }
    // The reported level is the level the write scope is admitted under, so it must carry
    // the authority the scope claims whatever the Work row currently says (`workflow.md`
    // §2 「自动降级不支持」 + DC-62).
    assertDeclaredAuthority(work, payload.authorizationRef, payload.level, payload.scope);
    this.verifyAuthorization(payload.authorizationRef, work.id, payload.level, payload.scope);
    return withTransaction(this.store.db, () => {
      const row = this.store.assessments.insert({
        workId: work.id,
        intent: payload.intent,
        level: payload.level,
        semanticImpact: payload.semanticImpact,
        riskFlags: [...payload.riskFlags],
        uncertainties: [...payload.uncertainties],
        ...(payload.authorizationRef === undefined
          ? {}
          : { authorizationRef: payload.authorizationRef }),
        policyRevision: payload.policyRevision,
        reason: payload.reason,
      });
      // The assessment is the Work's routing decision, so the Work must carry it: a Chief
      // that routes L2 must not leave `work.level` at `none`, or the very next dispatch is
      // refused as `NOT_AUTHORIZED` (WP-12 T2.2 / T2-plan E11). This records the decision
      // the rules already validated — it never downgrades, and the L3 floor above still
      // governs.
      this.applyAssessmentToWork(work, payload);
      this.store.events.append({
        name: 'assessment.saved',
        entityId: row.id,
        entityVersion: row.version,
        data: {
          workId: work.id,
          intent: row.intent,
          level: row.level,
          semanticImpact: row.semanticImpact,
          decidedLevel: decided.level,
          // The floor is what actually admitted the submitted level; without it the
          // event reads as "Core decided L2" next to a stored L1 (R10-03).
          floor,
          decidedReason: decided.reason,
        },
      });
      return row;
    });
  }

  /**
   * Applies one assessment to its Work row, in the assessment's transaction.
   *
   * The level is a floor, not an assignment: an existing higher level stays
   * (`workflow.md` §2 「自动降级不支持」). The scope is written on the same decision, so the
   * Work's declared envelope and the Run's frozen `effectiveScope` cannot drift.
   */
  private applyAssessmentToWork(work: Work, payload: AssessmentPayload): void {
    const nextLevel: Level =
      levelRank(payload.level) > levelRank(work.level) ? payload.level : work.level;
    const declaresScope =
      payload.scope.readPaths.length > 0 ||
      payload.scope.writePaths.length > 0 ||
      payload.scope.operations.length > 0 ||
      payload.scope.networkTargets.length > 0;
    // A derived authorization is bound to the Work here, so a later `dispatch` with no
    // explicit reference still finds the authority the assessment was admitted under.
    const bindsAuthorization =
      payload.authorizationRef !== undefined && payload.authorizationRef !== work.authorizationRef;
    // The assessment is also the Work's routing decision for `intent` (`workflow.md` §1):
    // the Work row must carry it, or every later reader falls back to the message router's
    // guess (`WP-12` fix round 3).
    const writesIntent = work.intent !== payload.intent;
    if (nextLevel === work.level && !declaresScope && !bindsAuthorization && !writesIntent) return;
    this.store.works.update(
      work.id,
      {
        level: nextLevel,
        ...(writesIntent ? { intent: payload.intent } : {}),
        ...(declaresScope ? { scope: payload.scope } : {}),
        ...(bindsAuthorization ? { authorizationRef: payload.authorizationRef } : {}),
      },
      work.version,
    );
  }

  /**
   * One Chief assessment plus the professional Run it decided on (WP-12 Q1=B).
   *
   * `PRODUCT.md` §5 makes an explicit natural-language execution instruction equivalent to a
   * button grant, so when the Work holds no authorization yet Core derives one from the
   * assessment's own scope and records it with the message as its source. The derivation is
   * deliberately narrow (`assertDerivableScope`): file operations only, inside the project
   * root, plus the test commands the project already configured. Everything else still needs
   * the explicit path and the L3 gate stays authoritative.
   *
   * The professional spec is a *draft*: `workId`, `profileRevision` and `budgetAllocation`
   * are Core's (`data.md` §3 "ProfessionalDispatchSpec仅由Core根据…构建"), so they are
   * overwritten here and the frozen snapshot records what Core actually authorized.
   */
  assessAndDispatch(input: AssessAndDispatchInput): AssessAndDispatchResult {
    // One transaction for the whole command (`protocol.md` §6 `agent.dispatch`): the
    // derived authorization, the assessment, the level/scope update and the frozen Run
    // either all land or none of them do (nested `withTransaction` is a savepoint, so
    // `assess`/`dispatch` keep their own transactional guarantees inside this one).
    return withTransaction(this.store.db, () => {
      const chief = this.requireChiefFor(input.parentRunId, input.workId);
      const draft = this.parseDraft(chief, input.spec);
      const { assessment, authorizationRef } = this.assessWithin({
        workId: chief.workId,
        payload: input.payload,
        ...(input.sourceRef === undefined ? {} : { sourceRef: input.sourceRef }),
      });
      const dispatch = this.dispatch({
        spec: this.freezeDraft(chief, draft),
        ...(authorizationRef === undefined ? {} : { authorizationRef }),
        ...(input.contextPayload === undefined ? {} : { contextPayload: input.contextPayload }),
        ...(input.requiredOutputSchemas === undefined
          ? {}
          : { requiredOutputSchemas: input.requiredOutputSchemas }),
      });
      return { assessment, authorizationRef, dispatch };
    });
  }

  /**
   * Records one assessment, deriving its authority when the Work has none (Q1=B).
   *
   * This is the `assessment.submit` path: the Chief submits the routing decision, and Core
   * — not the model — decides whether a derived authorization is written. It is the same
   * guard the dispatch path uses, so the two can never disagree about the same scope.
   */
  assessWithDerivation(input: {
    readonly workId: string;
    readonly payload: AssessmentPayload;
    readonly sourceRef?: SourceRef;
  }): { readonly assessment: Assessment; readonly authorizationRef: string | undefined } {
    return withTransaction(this.store.db, () => this.assessWithin(input));
  }

  /**
   * Freezes and queues one professional Run for a Chief Run (`protocol.md` §6
   * `agent.dispatch`).
   *
   * The scope is verified by `dispatch` against the Work's authorization — the *same*
   * `verifyAuthorization` guard the assessment path uses, so a derived authorization and an
   * explicit grant are both accepted and an out-of-envelope scope is refused with a typed
   * error before anything is written.
   */
  dispatchProfessional(input: {
    readonly parentRunId: string;
    readonly spec: unknown;
    /** The authority the Run freezes; the Work's own reference is used when absent. */
    readonly authorizationRef?: string;
    readonly contextPayload?: JsonObject;
    readonly requiredOutputSchemas?: readonly {
      readonly kind: string;
      readonly schemaVersion: 1;
    }[];
  }): DispatchResult {
    return withTransaction(this.store.db, () => {
      const chief = this.requireChiefFor(input.parentRunId, undefined);
      const draft = this.parseDraft(chief, input.spec);
      return this.dispatch({
        spec: this.freezeDraft(chief, draft),
        ...(input.authorizationRef === undefined
          ? {}
          : { authorizationRef: input.authorizationRef }),
        ...(input.contextPayload === undefined ? {} : { contextPayload: input.contextPayload }),
        ...(input.requiredOutputSchemas === undefined
          ? {}
          : { requiredOutputSchemas: input.requiredOutputSchemas }),
      });
    });
  }

  /**
   * The Work-row authority check plus the derived authorization, without a transaction.
   *
   * A modification-level assessment with no authority at all is refused: a delivery whose
   * message named no path derives no scope (`workflow.md` §2), and queueing a Run on an
   * empty envelope would be worse than the typed refusal.
   */
  private assessWithin(input: {
    readonly workId: string;
    readonly payload: AssessmentPayload;
    readonly sourceRef?: SourceRef;
  }): { readonly assessment: Assessment; readonly authorizationRef: string | undefined } {
    const parsed = parseOrFail(
      assessRequestSchema,
      { workId: input.workId, assessment: input.payload },
      'assessment.submit',
    );
    const work = this.requireWork(parsed.workId);
    const authorizationRef = this.ensureDerivedAuthorization(
      work,
      parsed.assessment,
      input.sourceRef,
      this.derivableOperations(),
    );
    if (authorizationRef === undefined && parsed.assessment.intent === 'operation') {
      // An operation routes L3 (`workflow.md` §2.2) and L3 always needs the explicit path;
      // there is no derived authority this Core is willing to invent.
      fail('NOT_AUTHORIZED', `${work.id} declares an operation but holds no explicit grant`, {
        workId: work.id,
        intent: parsed.assessment.intent,
      });
    }
    if (authorizationRef === undefined && grantsModificationAuthority(parsed.assessment.level)) {
      fail(
        'NOT_AUTHORIZED',
        `${work.id} routes ${parsed.assessment.level} but has no authorization to derive or reuse`,
        {
          workId: work.id,
          level: parsed.assessment.level,
          writePaths: [...parsed.assessment.scope.writePaths],
        },
      );
    }
    const assessment = this.assess({
      workId: work.id,
      payload: {
        ...parsed.assessment,
        ...(authorizationRef === undefined ? {} : { authorizationRef }),
      },
      ...(authorizationRef === undefined ? {} : { derivedAuthorization: true }),
    });
    return { assessment, authorizationRef };
  }

  /** The Chief Run a control-channel call is bound to (`protocol.md` §6). */
  private requireChiefFor(parentRunId: string, workId: string | undefined): Run {
    const chief = this.store.runs.find(parentRunId);
    if (chief === undefined) {
      fail('NOT_FOUND', `Chief Run ${parentRunId} does not exist`, {
        ...(workId === undefined ? {} : { workId }),
      });
    }
    if (chief.role !== 'chief' || (workId !== undefined && chief.workId !== workId)) {
      fail(
        'NOT_AUTHORIZED',
        `Run ${chief.id} is not the Chief Run of Work ${workId ?? chief.workId}; only the Work's own Chief may call this method`,
        { workId: workId ?? chief.workId, parentRunId: chief.id, parentRole: chief.role },
      );
    }
    return chief;
  }

  /** Parses one model-submitted draft against the Chief Run it claims to come from. */
  private parseDraft(chief: Run, spec: unknown): ProfessionalDispatchSpec {
    const raw = (
      typeof spec === 'object' && spec !== null && !Array.isArray(spec) ? spec : {}
    ) as Record<string, unknown>;
    const claimedParent = raw['parentRunId'];
    const draft = parseOrFail(
      professionalDispatchSpecSchema,
      {
        ...raw,
        kind: 'professional',
        workId: chief.workId,
        // Core owns the revision (injected at freeze time) and the parent binding: the
        // caller's own Run is the default, and naming another one is a refusal below.
        profileRevision: 0,
        parentRunId: claimedParent ?? chief.id,
      },
      'agent.dispatch spec',
    );
    // A draft naming another Work is refused explicitly: the value is injected above, so a
    // check *after* parsing could never fire (WP-12 fix round 2, review P3-4).
    const claimedWork = raw['workId'];
    if (claimedWork !== undefined && claimedWork !== chief.workId) {
      fail(
        'VALIDATION_ERROR',
        `the dispatch spec names Work ${typeof claimedWork === 'string' ? claimedWork : 'an object'}, not ${chief.workId}`,
        { workId: chief.workId, specWorkId: typeof claimedWork === 'string' ? claimedWork : null },
      );
    }
    if (draft.parentRunId !== chief.id) {
      fail(
        'NOT_AUTHORIZED',
        `the dispatch spec names parent Run ${draft.parentRunId}, not the calling Chief Run ${chief.id}`,
        { workId: chief.workId, parentRunId: chief.id, specParentRunId: draft.parentRunId },
      );
    }
    return draft;
  }

  /**
   * Applies the Core-owned fields to a draft before it is frozen.
   *
   * `profileRevision` is the current one for the role, and `budgetAllocation` is capped at
   * what the parent Chief Run can still fund: the model's number is a request, not the
   * authority (`data.md` §3, `rules/agents.md` §5).
   */
  private freezeDraft(chief: Run, draft: ProfessionalDispatchSpec): ProfessionalDispatchSpec {
    const allocation = this.effectiveBudget(chief, draft.budgetAllocation);
    if (draft.budgetAllocation > 0 && allocation === 0) {
      // A Chief Run with no unallocated budget cannot fund a child: refusing is honest,
      // whereas queueing a 0-token Run would look accepted and do nothing (WP-12 fix round
      // 2, review P3).
      fail(
        'BUDGET_EXCEEDED',
        `Chief Run ${chief.id} has no unallocated budget left for another Run`,
        { parentRunId: chief.id, requested: draft.budgetAllocation, remaining: 0 },
      );
    }
    return professionalSpec({
      ...draft,
      workId: chief.workId,
      parentRunId: chief.id,
      profileRevision: this.currentProfileRevision(draft.role),
      budgetAllocation: allocation,
    });
  }

  /** How much of one Chief Run's allocation is still unallocated. */
  private liveChildAllocation(chiefRunId: string): number {
    return this.store.runs
      .list({ where: 'parent_run_id = ?', params: [chiefRunId] })
      .filter((sibling) => !isTerminalRunStatus(sibling.status))
      .reduce((total, sibling) => total + sibling.budgetAllocation, 0);
  }

  /** The allocation a child Run actually gets: the request, capped by the parent's hold. */
  private effectiveBudget(chief: Run, requested: number): number {
    const remaining = Math.max(0, chief.budgetAllocation - this.liveChildAllocation(chief.id));
    return Math.min(requested, remaining);
  }

  /**
   * The operations a derived authorization may carry for this project.
   *
   * File work only. The project's configured test commands
   * (`config.ts` `policy.testCommands`) are deliberately *not* turned into an operation
   * here: running a command is the `bash` operation, which this derivation never grants
   * (`workflow.md` §2.2/§2.3). A test command is exercised by the Test role under its own
   * grant, which is the explicit path the user decision preserves.
   */
  derivableOperations(): readonly OperationName[] {
    return [...DERIVABLE_OPERATIONS];
  }

  /**
   * Writes the derived authorization when the Work has none.
   *
   * A Work that already carries authority (an explicit path message, or a resumed
   * Requirement) keeps it: derivation never widens or replaces a real grant. Returns the
   * reference the Run must freeze; the caller's `assess` binds it to the Work in its own
   * transaction, so the Work row is never updated twice from a stale version.
   */
  private ensureDerivedAuthorization(
    work: Work,
    payload: AssessmentPayload,
    sourceRef: AssessAndDispatchInput['sourceRef'],
    allowed: readonly OperationName[],
  ): string | undefined {
    if (payload.authorizationRef !== undefined) return payload.authorizationRef;
    if (work.authorizationRef !== undefined) return work.authorizationRef;
    if (sourceRef === undefined) return undefined;
    const operations = assertDerivableScope(work.id, payload.scope, allowed);
    const derived = derivedAuthorization(payload.scope, operations, allowed);
    if (derived === undefined) return undefined;
    if (!grantsModificationAuthority(payload.level)) {
      fail('VALIDATION_ERROR', `Work ${work.id} declares write paths but routes ${payload.level}`, {
        workId: work.id,
        level: payload.level,
        writePaths: [...payload.scope.writePaths],
      });
    }
    const row = this.store.authorizations.insert({
      sourceRef: sourceRef,
      workId: work.id,
      goal: payload.goal.slice(0, 2_000),
      scope: derived.scope,
      operations: [...derived.operations],
      acceptedAt: new Date().toISOString(),
    });
    return row.id;
  }

  /**
   * Freezes a DispatchSpec and creates the Run.
   *
   * Chief specs come from Core; a professional spec must name an existing Chief
   * Run of the same Work as its parent. The frozen dispatch snapshot carries the
   * spec, the effective scope and the output schemas, and the Run references all
   * three snapshots by hash.
   */
  dispatch(input: DispatchInput): DispatchResult {
    // The contract Schema runs first: `validateDispatchSpec` reads fields such as
    // `contextSelection.codePaths`, and a malformed spec must fail as
    // `VALIDATION_ERROR` rather than as an uncaught `TypeError` (R7-01).
    // `undefined`-valued optional fields mean "absent": zod keeps them in the parsed
    // object, and a frozen payload must be pure JSON (R13-03).
    const spec = jsonClean(parseOrFail(dispatchSpecSchema, input.spec, 'dispatch spec'));
    // The remaining frozen inputs are validated before anything is written, so an
    // invalid `authorizationRef`/`requiredOutputSchemas`/`contextPayload` cannot
    // leave snapshot rows behind (R8-04/R8-09).
    const extras = parseOrFail(
      dispatchExtrasSchema,
      {
        ...(input.authorizationRef === undefined
          ? {}
          : { authorizationRef: input.authorizationRef }),
        ...(input.requiredOutputSchemas === undefined
          ? {}
          : { requiredOutputSchemas: input.requiredOutputSchemas }),
        ...(input.contextPayload === undefined ? {} : { contextPayload: input.contextPayload }),
        ...(input.runParams === undefined ? {} : { runParams: input.runParams }),
      },
      'dispatch input',
    );
    enforce(validateDispatchSpec(spec), 'dispatch spec');
    const work = this.requireWork(spec.workId);
    // The Run's own scope joins the Work level in deciding what authority is
    // needed: a spec that declares environment operations, network writes or data
    // operations is an L3 Run even when its Work row says otherwise, and a Work
    // without modification authority cannot hand out a write scope (R12-01).
    const environmentScope = touchesRunningEnvironment(spec.scope);
    const runLevel: Level = environmentScope ? 'L3' : work.level;
    // Modification authority is the *Work's* level: a spec cannot upgrade it by
    // declaring an authorized environment operation (R13-02), and a local write
    // operation counts even when the path list is empty (R13-01 adversarial).
    if (
      !grantsModificationAuthority(work.level) &&
      (declaresWorkspaceWrite(spec.scope) || environmentScope)
    ) {
      fail(
        'NOT_AUTHORIZED',
        `Work ${work.id} is ${work.level} and cannot create a Run with write or environment authority`,
        {
          workId: work.id,
          workLevel: work.level,
          runLevel,
          writePaths: [...spec.scope.writePaths],
          operations: [...spec.scope.operations],
          environmentScope,
        },
      );
    }
    // A frozen authorization reference must be real authority for this Work and
    // must cover the declared scope; the Work row's own reference is used when the
    // caller passes none, so an L3 Work can always be authorized (R10-02/R11-03/
    // R12-02) and the verified reference is what gets frozen (R12-03).
    const authorizationRef = this.verifyAuthorization(
      extras.authorizationRef ?? work.authorizationRef,
      work.id,
      runLevel,
      spec.scope,
    );
    // Authorized Run parameters are the strongest configuration layer (`agents.md` §5), but
    // they can name another Provider/Model — so they must come with authority, or a model
    // could select the credential its Run resolves (WP-12 fix round 2, G1 precondition).
    if (extras.runParams !== undefined && authorizationRef === undefined) {
      fail(
        'VALIDATION_ERROR',
        `Run for Work ${work.id} passes runParams without an authorizationRef`,
        { workId: work.id, runParams: Object.keys(extras.runParams) },
      );
    }

    if (spec.kind === 'professional') {
      enforce(validateRolePurpose(spec.role, spec.purpose), 'dispatch spec');
      const parent = this.store.runs.find(spec.parentRunId);
      if (parent === undefined) {
        fail('NOT_AUTHORIZED', `parent Run ${spec.parentRunId} does not exist`, {
          workId: work.id,
        });
      }
      // A parent that already ended (or is paused/cancelling) cannot take new
      // work: its children would never be joined (`workflow.md` §5.3).
      if (!RunLifecycle.canParentDispatch(parent.status)) {
        fail(
          'INVALID_STATE',
          `parent Run ${parent.id} is ${parent.status} and cannot accept a new dispatch`,
          { parentRunId: parent.id, parentStatus: parent.status },
        );
      }
      // A grandchild Run is refused here, before any row or snapshot is written.
      if (!isDirectChiefChild(spec, parent)) {
        fail(
          'NOT_AUTHORIZED',
          `Run ${spec.parentRunId} is not a Chief Run of Work ${spec.workId}; only direct Chief children may be dispatched`,
          { parentRole: parent.role, parentWorkId: parent.workId },
        );
      }
      this.requireTask(spec.taskId, work.id);
      this.requireBudget(spec, parent);
    }
    // A Chief spec's purpose/stage pair is already narrowed by the shared Schema
    // and re-checked by `validateDispatchSpec`, so no extra branch is needed.

    // The Work budget is the authority and is checked before anything is written,
    // for Core-built chief specs as well as professional ones (N-10), so an
    // over-commit is reported as BUDGET_EXCEEDED instead of a Schema violation.
    enforce(
      canAllocateBudget(this.lifecycle.budgetOf(work.id), spec.budgetAllocation),
      'dispatch budget',
    );

    const role = spec.role;
    const availability = this.gateway.availability(role, extras.runParams ?? {});
    if (!availability.ok) {
      // The Run is refused rather than queued on a guess; the Work-level
      // `blocked(provider)` projection is WP-05 (DC-42).
      fail('PROVIDER_UNAVAILABLE', `role ${role} has no usable model: ${availability.reason}`, {
        workId: work.id,
        role,
      });
    }
    const resolution = availability.resolution;
    if (spec.profileRevision !== resolution.revision) {
      fail(
        'VALIDATION_ERROR',
        `profileRevision ${spec.profileRevision} is stale; current revision is ${resolution.revision}`,
        { role, currentRevision: resolution.revision },
      );
    }

    // Everything above is admission control; only a Run that will really be
    // created may leave snapshots behind (R7-07).
    const configSnapshotId = this.config.freeze(role, extras.runParams ?? {}).snapshotId;
    // The context payload is plain JSON by construction (`data.md` §3); the cast
    // only bridges `exactOptionalPropertyTypes` on the parsed Schema type.
    const fallbackContext = {
      contextSelection: spec.contextSelection,
      goal: spec.goal,
      workId: work.id,
    } as unknown as JsonObject;
    const contextSnapshotId = this.snapshots.freeze(
      'context',
      extras.contextPayload ?? fallbackContext,
    ).hash;

    const withoutHash = {
      dispatchSpec: spec,
      ...(authorizationRef === undefined ? {} : { authorizationRef }),
      effectiveScope: spec.scope,
      requiredOutputSchemas: [...(extras.requiredOutputSchemas ?? [])],
      profileRevision: spec.profileRevision,
      contextSnapshotId,
    } as const;
    const dispatchHash = sha256(canonicalJson(withoutHash));
    const frozen = this.snapshots.freeze(
      'dispatch',
      { ...withoutHash, hash: dispatchHash } as unknown as JsonObject,
      { identityPayload: withoutHash as unknown as JsonObject },
    );
    const dispatchSnapshot = parseOrFail(
      dispatchSnapshotSchema,
      { ...withoutHash, hash: frozen.hash },
      'dispatch snapshot',
    );

    return withTransaction(this.store.db, () => {
      // The reservation happens in the same transaction as the Run row, so a
      // concurrent dispatch cannot double-spend the Work budget.
      this.lifecycle.reserve(work.id, spec.budgetAllocation);
      const run = this.store.runs.insert({
        workId: work.id,
        ...(spec.kind === 'professional' && spec.taskId !== undefined
          ? { taskId: spec.taskId }
          : {}),
        role,
        purpose: spec.purpose,
        ...(spec.kind === 'professional' ? { parentRunId: spec.parentRunId } : {}),
        stage: spec.stage,
        status: 'queued',
        requiredChild: spec.kind === 'professional' ? spec.requiredChild : false,
        join: spec.kind === 'professional' ? spec.joinPolicy : 'none',
        childIds: [],
        configSnapshotId,
        contextSnapshotId,
        dispatchSnapshotId: frozen.hash,
        budgetAllocation: spec.budgetAllocation,
      } as unknown as Record<string, unknown>);
      this.store.events.append({
        name: 'run.queued',
        entityId: run.id,
        entityVersion: run.version,
        data: {
          workId: work.id,
          role: run.role,
          purpose: run.purpose,
          stage: run.stage,
          parentRunId: run.parentRunId ?? null,
          dispatchSnapshotId: run.dispatchSnapshotId,
          configSnapshotId: run.configSnapshotId,
        },
      });
      if (spec.kind === 'professional') this.attachChild(spec.parentRunId, run.id);
      return { run, profile: resolution, dispatchSnapshot, configSnapshotId, contextSnapshotId };
    });
  }

  /**
   * A professional Agent asking its Chief for another Run.
   *
   * No Run is created and no grandchild is possible: the request becomes a
   * `chief_action_required` todo for the Chief Run (AC-045). A request that names
   * a parent other than the caller's own Chief is refused outright.
   */
  requestDispatch(input: DispatchRequestInput): DispatchRequestResult {
    // The whole request is validated up front (`protocol.md` §1/§6): malformed
    // source refs or output lists must not escape as a raw TypeError, and bad field
    // values must not be persisted into `chief_action_required` (R8-01).
    const request = parseOrFail(dispatchRequestSchema, input, 'request_dispatch request');
    const run = this.store.runs.find(request.runId);
    if (run === undefined) fail('NOT_FOUND', `Run ${request.runId} does not exist`);
    if (run.role === 'chief') {
      fail('VALIDATION_ERROR', 'a Chief Run dispatches directly; request_dispatch is for agents', {
        runId: run.id,
      });
    }
    const chiefRunId = run.parentRunId;
    if (chiefRunId === undefined) {
      fail('NOT_AUTHORIZED', `Run ${run.id} has no Chief parent`, { runId: run.id });
    }
    if (request.parentRunId !== undefined && request.parentRunId !== chiefRunId) {
      fail('NOT_AUTHORIZED', `Run ${run.id} may only request work from its own Chief Run`, {
        requested: request.parentRunId,
        actual: chiefRunId,
      });
    }
    if (request.workId !== undefined && request.workId !== run.workId) {
      fail('NOT_AUTHORIZED', `Run ${run.id} belongs to Work ${run.workId}, not ${request.workId}`, {
        runId: run.id,
        workId: run.workId,
      });
    }
    // `protocol.md` §6 does not carry a purpose; the role's primary purpose is the
    // honest default, and a caller may name another one it is allowed to carry.
    const purpose =
      request.purpose ??
      (PRIMARY_PURPOSE_BY_ROLE as Record<string, string | undefined>)[request.requestedRole] ??
      '';
    enforce(validateRolePurpose(request.requestedRole, purpose), 'dispatch request');
    const chief = this.store.runs.find(chiefRunId);
    if (chief === undefined) fail('NOT_FOUND', `Chief Run ${chiefRunId} does not exist`);
    // The todo is idempotent per `operationId`: a retried request must not become a
    // second Chief action (reliability.md §1 "至少一次投递、避免重复创建").
    // The fingerprint covers the whole request: a key reused with any different
    // field must be a conflict, not a silently dropped command (`protocol.md` §1).
    const frozenRequest = {
      requestedBy: run.id,
      workId: run.workId,
      role: request.requestedRole,
      purpose,
      goal: request.goal,
      stage: request.stage ?? 'assist',
      reason: request.reason ?? null,
      sourceRefs: (request.sourceRefs ?? []).map((ref) => ({
        kind: ref.kind,
        id: ref.id,
        version: ref.version,
      })),
      requiredOutputs: [...(request.requiredOutputs ?? [])],
      requiredChild: request.requiredChild ?? false,
      budgetAllocation: request.budgetAllocation ?? 0,
      parentRunId: chiefRunId,
    };
    const fingerprint = operationFingerprint(frozenRequest);
    // Without a caller key an identical request must still not file a second todo,
    // so the fingerprint itself becomes the idempotency key (R6-09).
    const operationId = request.operationId ?? `derived:${fingerprint}`;

    const existing = findEvent(this.store, {
      names: ['chief_action_required'],
      stopAt: (event) => event.entityId === chiefRunId && event.data['operationId'] === operationId,
    });
    if (existing !== undefined) {
      // The same key must mean the same request: a replayed command returns the
      // original result, a different request under a used key is a conflict
      // (`protocol.md` §1/§7 `IDEMPOTENCY_CONFLICT`), never a silent no-op.
      if (existing.data['fingerprint'] !== fingerprint) {
        fail(
          'IDEMPOTENCY_CONFLICT',
          `operationId ${operationId} was already used for a different dispatch request`,
          {
            operationId,
            chiefRunId,
            existingFingerprint:
              typeof existing.data['fingerprint'] === 'string'
                ? existing.data['fingerprint']
                : null,
            requestedFingerprint: fingerprint,
          },
        );
      }
      return {
        disposition: 'chief_action_required' as const,
        runId: run.id,
        workId: run.workId,
        chiefTodo: String(existing.cursor),
      };
    }

    // A replay is answered from the log above; only a *new* request needs both the
    // requester and the Chief Run to be able to act (`workflow.md` §5.3). A todo is
    // actionable only while its Chief Run can still dispatch (AC-045).
    if (!RunLifecycle.canParentDispatch(run.status)) {
      fail('INVALID_STATE', `Run ${run.id} is ${run.status} and cannot request more work`, {
        runId: run.id,
        status: run.status,
      });
    }
    if (!RunLifecycle.canParentDispatch(chief.status)) {
      fail(
        'INVALID_STATE',
        `Chief Run ${chief.id} is ${chief.status} and cannot take a new dispatch request`,
        { chiefRunId: chief.id, status: chief.status },
      );
    }
    return withTransaction(this.store.db, () => {
      const event = this.store.events.append({
        name: 'chief_action_required',
        // The event describes the Chief Run, so it carries the Chief's version —
        // consumers keying on (entityId, entityVersion) would otherwise see a
        // version the entity never had (D1).
        entityId: chiefRunId,
        entityVersion: chief.version,
        data: {
          reason: 'agent_dispatch',
          requestedBy: run.id,
          operationId,
          operationIdSource: request.operationId === undefined ? 'derived' : 'client',
          fingerprint,
          workId: run.workId,
          role: frozenRequest.role,
          purpose: frozenRequest.purpose,
          goal: frozenRequest.goal,
          stage: frozenRequest.stage,
          requestReason: frozenRequest.reason,
          sourceRefs: frozenRequest.sourceRefs,
          requiredOutputs: frozenRequest.requiredOutputs,
          requiredChild: frozenRequest.requiredChild,
          budgetAllocation: frozenRequest.budgetAllocation,
        },
      });
      return {
        disposition: 'chief_action_required' as const,
        runId: run.id,
        workId: run.workId,
        chiefTodo: String(event.cursor),
      };
    });
  }

  /**
   * Everything a restarted daemon must restore for one Run (AC-082).
   *
   * The frozen dispatch snapshot is the whole authority: the scope and output
   * schemas come from it, never from the (wider) Work scope, so a restart cannot
   * widen what a Run is allowed to touch. A missing snapshot is a hard failure —
   * the Run cannot be resumed on a guess.
   */
  recoveryView(runId: string): RunRecoveryView {
    const run = this.store.runs.find(runId);
    if (run === undefined) fail('NOT_FOUND', `Run ${runId} does not exist`);
    const frozen = this.snapshots.read(run.dispatchSnapshotId);
    if (frozen === undefined) {
      fail('STALE_ARTIFACT', `dispatch snapshot ${run.dispatchSnapshotId} is missing`, {
        runId: run.id,
      });
    }
    if (frozen.type !== 'dispatch') {
      fail('STALE_ARTIFACT', `snapshot ${run.dispatchSnapshotId} is a ${frozen.type} snapshot`, {
        runId: run.id,
      });
    }
    const snapshot = parseOrFail(
      dispatchSnapshotSchema,
      frozen.payload,
      'frozen dispatch snapshot',
    );
    if (snapshot.hash !== run.dispatchSnapshotId) {
      fail('STALE_ARTIFACT', `dispatch snapshot hash mismatch for Run ${run.id}`, {
        runId: run.id,
      });
    }
    const profile = this.config.readFrozen(run.configSnapshotId);
    if (profile === undefined) {
      fail('STALE_ARTIFACT', `config snapshot ${run.configSnapshotId} is missing`, {
        runId: run.id,
      });
    }
    return {
      run,
      dispatchSnapshot: snapshot,
      effectiveScope: snapshot.effectiveScope,
      requiredOutputSchemas: snapshot.requiredOutputSchemas,
      profile,
    };
  }

  /** Starts an Attempt for a queued Run (see `RunLifecycle.beginAttempt`). */
  beginAttempt(runId: string, options: { readonly runnerId?: string } = {}): Attempt {
    return this.lifecycle.beginAttempt(runId, options);
  }

  /**
   * Marks a Run terminal through the shared lifecycle, so the budget reservation
   * is released exactly once (N-01).
   */
  settleRun(
    runId: string,
    status: Extract<Run['status'], 'completed' | 'failed' | 'cancelled'>,
    usage?: RunUsage,
  ): Run {
    return this.lifecycle.settle(runId, status, usage);
  }

  /**
   * Verifies that an authorization reference is real authority for this Work.
   *
   * `workflow.md` §1 / `data.md` §2: the Core checks the authorization, and
   * `Authorization` is documented as revocable and never forged, so existence
   * alone is not enough — it must belong to the same Work, must not have been
   * revoked (DC-63), and when a `scope` is supplied it must cover that scope:
   * every `operations` entry and every `writePaths`/`readPaths` entry must be inside
   * the grant, every network target must be granted *and* backed by the `network`
   * operation, a declared path requires the matching read/write operation in the
   * grant, and a network target alone never grants a write
   * (R12-02/R13-01/R14/R15).
   * A reference provided on a level that does not require one is still verified, so
   * a fabricated id can never be persisted. Returns the reference that was actually
   * verified, for freezing.
   */
  private verifyAuthorization(
    authorizationRef: string | undefined,
    workId: string,
    /** `undefined` when no level is known yet (an assessment checks what it has). */
    level: Level | undefined,
    scope?: Scope,
  ): string | undefined {
    if (authorizationRef === undefined) {
      if (level !== undefined && requiresExplicitAuthorization(level)) {
        fail('NOT_AUTHORIZED', `${level} requires an explicit authorizationRef`, {
          workId,
          level,
        });
      }
      return undefined;
    }
    const authorization = this.store.authorizations.find(authorizationRef);
    if (authorization === undefined) {
      fail('NOT_AUTHORIZED', `authorizationRef ${authorizationRef} does not exist`, {
        workId,
        level: level ?? null,
        authorizationRef,
      });
    }
    if (authorization.workId !== workId) {
      fail(
        'NOT_AUTHORIZED',
        `authorizationRef ${authorizationRef} belongs to Work ${authorization.workId}, not ${workId}`,
        { workId, level: level ?? null, authorizationRef, authorizedWorkId: authorization.workId },
      );
    }
    if (authorization.revokedAt !== undefined) {
      fail('NOT_AUTHORIZED', `authorizationRef ${authorizationRef} was revoked`, {
        workId,
        level: level ?? null,
        authorizationRef,
        revokedAt: authorization.revokedAt,
      });
    }
    if (scope !== undefined) {
      const granted = new Set(authorization.operations);
      const uncoveredOperations = scope.operations.filter((operation) => !granted.has(operation));
      const grantedTargets = new Set(authorization.scope.networkTargets);
      const uncoveredNetworkTargets = scope.networkTargets.filter(
        (target) => !grantedTargets.has(target),
      );
      // The authorization's own scope is the envelope: every path the Run declares
      // must be inside it (`data.md` §3 `effectiveScope`), for reads as well as
      // writes (R13-01).
      // Reaching a network target is a network write: the grant must carry the
      // `network` operation, not merely list the target (R14 D-2).
      const networkTargetsWithoutGrant =
        scope.networkTargets.length > 0 && !granted.has('network') ? [...scope.networkTargets] : [];
      // Declaring a path is declaring the capability: a grant that lists write paths
      // but no write operation (or read paths but no read operation) would let a Run
      // freeze a scope it was never authorized to exercise (R15-01/R15 D-1).
      const capabilityGaps: string[] = [];
      if (scope.writePaths.length > 0 && !includesWorkspaceWrite(authorization.operations)) {
        capabilityGaps.push('writePaths without a write operation');
      }
      if (scope.readPaths.length > 0 && !includesRead(authorization.operations)) {
        capabilityGaps.push('readPaths without a read operation');
      }
      const uncoveredWritePaths = scope.writePaths.filter(
        (path) => !isInsideScope(path, authorization.scope.writePaths),
      );
      const uncoveredReadPaths = scope.readPaths.filter(
        (path) => !isInsideScope(path, authorization.scope.readPaths),
      );
      if (
        uncoveredOperations.length > 0 ||
        uncoveredNetworkTargets.length > 0 ||
        networkTargetsWithoutGrant.length > 0 ||
        capabilityGaps.length > 0 ||
        uncoveredWritePaths.length > 0 ||
        uncoveredReadPaths.length > 0
      ) {
        fail(
          'NOT_AUTHORIZED',
          `authorizationRef ${authorizationRef} does not cover the declared scope`,
          {
            workId,
            level: level ?? null,
            authorizationRef,
            uncoveredOperations: [...uncoveredOperations],
            uncoveredNetworkTargets: [...uncoveredNetworkTargets],
            networkTargetsWithoutGrant,
            capabilityGaps,
            uncoveredWritePaths: [...uncoveredWritePaths],
            uncoveredReadPaths: [...uncoveredReadPaths],
          },
        );
      }
    }
    return authorization.id;
  }

  /** Rejects a professional spec whose parent cannot fund it. */
  private requireBudget(spec: Extract<DispatchSpec, { kind: 'professional' }>, parent: Run): void {
    if (spec.budgetAllocation < 0) {
      fail('VALIDATION_ERROR', 'budgetAllocation must be >= 0');
    }
    const siblings = this.store.runs.list({
      where: 'parent_run_id = ?',
      params: [parent.id],
    });
    // Only children that can still spend their allocation count against the
    // parent's own allocation: a settled child released its reservation, and
    // counting it forever would make a long-lived Chief Run unable to dispatch
    // after a few sequential children (M-01).
    const allocated = siblings
      .filter((sibling) => !isTerminalRunStatus(sibling.status))
      .reduce((total, sibling) => total + sibling.budgetAllocation, 0);
    if (allocated + spec.budgetAllocation > parent.budgetAllocation) {
      fail(
        'BUDGET_EXCEEDED',
        `live children of Run ${parent.id} hold ${allocated} of ${parent.budgetAllocation} tokens`,
        { parentRunId: parent.id, allocated, requested: spec.budgetAllocation },
      );
    }
    // The parent Run's own allocation is a second, run-level ceiling on top of the
    // Work budget that `dispatch` already checked before writing anything.
  }

  /** Appends the child to its Chief Run's `childIds`. */
  private attachChild(parentRunId: string, childRunId: string): void {
    const parent = this.store.runs.find(parentRunId);
    if (parent === undefined) fail('NOT_FOUND', `parent Run ${parentRunId} does not exist`);
    this.store.runs.update(
      parent.id,
      { childIds: [...parent.childIds, childRunId] },
      parent.version,
    );
  }

  private requireWork(workId: string): Work {
    const work = this.store.works.find(workId);
    if (work === undefined) fail('NOT_FOUND', `Work ${workId} does not exist`);
    return work;
  }

  private requireTask(taskId: string | undefined, workId: string): void {
    if (taskId === undefined) return;
    const task = this.store.tasks.find(taskId);
    if (task === undefined) fail('NOT_FOUND', `Task ${taskId} does not exist`);
    if (task.workId !== workId) {
      fail('VALIDATION_ERROR', `Task ${taskId} does not belong to Work ${workId}`);
    }
  }
}

/** Builds the professional spec a Chief Run dispatches from real records. */
export function professionalSpec(
  input: Omit<ProfessionalDispatchSpec, 'kind'>,
): ProfessionalDispatchSpec {
  return jsonClean(
    parseOrFail(
      professionalDispatchSpecSchema,
      { ...input, kind: 'professional' },
      'professional dispatch spec',
    ),
  );
}

/**
 * Drops `undefined`-valued object properties recursively.
 *
 * An optional field set to `undefined` means "absent", but zod keeps the key in its
 * parsed output, which would put a non-JSON value into a frozen snapshot payload
 * (R13-03).
 */
function jsonClean<T>(value: T): T {
  if (Array.isArray(value)) {
    const items: unknown[] = value as unknown[];
    return items.map((entry: unknown) => jsonClean(entry)) as unknown as T;
  }
  if (value !== null && typeof value === 'object') {
    const cleaned: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (entry === undefined) continue;
      cleaned[key] = jsonClean(entry);
    }
    return cleaned as unknown as T;
  }
  return value;
}

/** True when `path` is `root` itself or lives under it. */
function isInsideScope(path: string, roots: readonly string[]): boolean {
  const normalized = path.replace(/\/+$/u, '');
  return roots.some((root) => {
    const candidate = root.replace(/\/+$/u, '');
    return normalized === candidate || normalized.startsWith(`${candidate}/`);
  });
}

/**
 * Refuses a declared scope the given level may not carry.
 *
 * `dispatch` reads the *Work's* level, so the two must agree: an assessment that says
 * `none` (or an L3 Work without a grant) may not declare a write, and nothing below L3 may
 * declare an environment operation (`workflow.md` §2.2/§2.4, DC-62/R16-01).
 */
function assertDeclaredAuthority(
  work: Work,
  authorizationRef: string | undefined,
  level: Level,
  scope: Scope,
): void {
  const environment = touchesRunningEnvironment(scope);
  const write = declaresWorkspaceWrite(scope);
  if ((!write && !environment) || grantsModificationAuthority(level)) return;
  fail(
    'VALIDATION_ERROR',
    `Work ${work.id} is ${level} and cannot declare a write or environment scope`,
    {
      workId: work.id,
      workLevel: work.level,
      declaredLevel: level,
      authorizationRef: authorizationRef ?? null,
      writePaths: [...scope.writePaths],
      operations: [...scope.operations],
      environmentScope: environment,
    },
  );
}

/**
 * Parses with a contract Schema, reporting problems in the protocol error space.
 *
 * `protocol.md` §1 requires `VALIDATION_ERROR` (with the offending fields) for bad
 * input; letting a raw `ZodError` escape would hand callers an error shape the
 * protocol does not define (R6-10).
 */
function parseOrFail<T>(
  schema: {
    safeParse(value: unknown):
      | { readonly success: true; readonly data: T }
      | {
          readonly success: false;
          readonly error: { readonly issues: readonly { path: PropertyKey[]; message: string }[] };
        };
  },
  value: unknown,
  what: string,
): T {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  const issues = parsed.error.issues.map(
    (issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`,
  );
  fail('VALIDATION_ERROR', `${what} is invalid: ${issues.join('; ')}`, { issues });
}
