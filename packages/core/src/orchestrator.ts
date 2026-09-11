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
  dispatchSnapshotSchema,
  dispatchSpecSchema,
  professionalDispatchSpecSchema,
  type Assessment,
  type AssessmentPayload,
  type Attempt,
  type DispatchSnapshot,
  type DispatchSpec,
  type JsonObject,
  type ProfessionalDispatchSpec,
  type Run,
  type Work,
} from '@agentdev/contracts';
import {
  canAllocateBudget,
  decideLevel,
  isDirectChiefChild,
  isTerminalRunStatus,
  PRIMARY_PURPOSE_BY_ROLE,
  type LockdownRisk,
  requiresExplicitAuthorization,
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
    readonly version?: string;
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

/** Maps an assessment's risk flags onto the documented lockdown risk shape. */
function riskFromFlags(flags: readonly string[]): LockdownRisk {
  const risk: Record<string, boolean> = {
    identityOrPermission: false,
    secrets: false,
    securityBoundary: false,
    dataDeletionOrMigration: false,
    payment: false,
    publicProtocolBreak: false,
    deployOrRelease: false,
    gateRuleChange: false,
  };
  for (const flag of flags) {
    if (flag in risk) risk[flag] = true;
  }
  return risk as unknown as LockdownRisk;
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
    const work = this.requireWork(input.workId);
    const payload = input.payload;
    // The documented routing order is re-applied here (`workflow.md` §2) so a Chief
    // cannot record a lower level than the lockdown/operation rules demand. Only
    // the L3 floor is enforced as a hard error: L1 vs L2 depends on criteria the
    // assessment payload does not carry, so a stricter submitted level is allowed.
    const decided = decideLevel({
      intent: payload.intent,
      operationTouchesEnvironment:
        payload.intent === 'operation' && work.level === 'L3'
          ? true
          : payload.riskFlags.includes('operation_touches_environment'),
      risk: riskFromFlags(payload.riskFlags),
    });
    if (decided.level === 'L3' && payload.level !== 'L3') {
      fail(
        'VALIDATION_ERROR',
        `routing rules require L3 (${decided.reason}) but the assessment says ${payload.level}`,
        { workId: work.id, decidedLevel: decided.level, submittedLevel: payload.level },
      );
    }
    if (requiresExplicitAuthorization(payload.level) && payload.authorizationRef === undefined) {
      fail('NOT_AUTHORIZED', `${payload.level} requires an explicit authorizationRef`, {
        workId: work.id,
        level: payload.level,
      });
    }
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
          decidedReason: decided.reason,
        },
      });
      return row;
    });
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
    // `contextSelection.readPaths`, and a malformed spec must fail as
    // `VALIDATION_ERROR` rather than as an uncaught `TypeError` (R7-01).
    const spec = parseOrFail(dispatchSpecSchema, input.spec, 'dispatch spec');
    enforce(validateDispatchSpec(spec), 'dispatch spec');
    const work = this.requireWork(spec.workId);

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
    const availability = this.gateway.availability(role, input.runParams ?? {});
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
    const configSnapshotId = this.config.freeze(role, input.runParams ?? {}).snapshotId;
    // The context payload is plain JSON by construction (`data.md` §3); the cast
    // only bridges `exactOptionalPropertyTypes` on the parsed Schema type.
    const fallbackContext = {
      contextSelection: spec.contextSelection,
      goal: spec.goal,
      workId: work.id,
    } as unknown as JsonObject;
    const contextSnapshotId = this.snapshots.freeze(
      'context',
      input.contextPayload ?? fallbackContext,
    ).hash;

    const withoutHash = {
      dispatchSpec: spec,
      ...(input.authorizationRef === undefined ? {} : { authorizationRef: input.authorizationRef }),
      effectiveScope: spec.scope,
      requiredOutputSchemas: [...(input.requiredOutputSchemas ?? [])],
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
    const run = this.store.runs.find(input.runId);
    if (run === undefined) fail('NOT_FOUND', `Run ${input.runId} does not exist`);
    if (run.role === 'chief') {
      fail('VALIDATION_ERROR', 'a Chief Run dispatches directly; request_dispatch is for agents', {
        runId: run.id,
      });
    }
    const chiefRunId = run.parentRunId;
    if (chiefRunId === undefined) {
      fail('NOT_AUTHORIZED', `Run ${run.id} has no Chief parent`, { runId: run.id });
    }
    if (input.parentRunId !== undefined && input.parentRunId !== chiefRunId) {
      fail('NOT_AUTHORIZED', `Run ${run.id} may only request work from its own Chief Run`, {
        requested: input.parentRunId,
        actual: chiefRunId,
      });
    }
    if (input.workId !== undefined && input.workId !== run.workId) {
      fail('NOT_AUTHORIZED', `Run ${run.id} belongs to Work ${run.workId}, not ${input.workId}`, {
        runId: run.id,
        workId: run.workId,
      });
    }
    // `protocol.md` §6 does not carry a purpose; the role's primary purpose is the
    // honest default, and a caller may name another one it is allowed to carry.
    const purpose =
      input.purpose ??
      (PRIMARY_PURPOSE_BY_ROLE as Record<string, string | undefined>)[input.requestedRole] ??
      '';
    enforce(validateRolePurpose(input.requestedRole, purpose), 'dispatch request');
    const chief = this.store.runs.find(chiefRunId);
    if (chief === undefined) fail('NOT_FOUND', `Chief Run ${chiefRunId} does not exist`);
    // The todo is idempotent per `operationId`: a retried request must not become a
    // second Chief action (reliability.md §1 "至少一次投递、避免重复创建").
    // The fingerprint covers the whole request: a key reused with any different
    // field must be a conflict, not a silently dropped command (`protocol.md` §1).
    const request = {
      requestedBy: run.id,
      workId: run.workId,
      role: input.requestedRole,
      purpose,
      goal: input.goal,
      stage: input.stage ?? 'assist',
      reason: input.reason ?? null,
      sourceRefs: (input.sourceRefs ?? []).map((ref) => ({
        kind: ref.kind,
        id: ref.id,
        version: ref.version ?? '1',
      })),
      requiredOutputs: [...(input.requiredOutputs ?? [])],
      requiredChild: input.requiredChild ?? false,
      budgetAllocation: input.budgetAllocation ?? 0,
      parentRunId: chiefRunId,
    };
    const fingerprint = operationFingerprint(request);
    // Without a caller key an identical request must still not file a second todo,
    // so the fingerprint itself becomes the idempotency key (R6-09).
    const operationId = input.operationId ?? `derived:${fingerprint}`;

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
          operationIdSource: input.operationId === undefined ? 'derived' : 'client',
          fingerprint,
          workId: run.workId,
          role: request.role,
          purpose: request.purpose,
          goal: request.goal,
          stage: request.stage,
          requestReason: request.reason,
          sourceRefs: request.sourceRefs,
          requiredOutputs: request.requiredOutputs,
          requiredChild: request.requiredChild,
          budgetAllocation: request.budgetAllocation,
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
  return parseOrFail(
    professionalDispatchSpecSchema,
    { ...input, kind: 'professional' },
    'professional dispatch spec',
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
