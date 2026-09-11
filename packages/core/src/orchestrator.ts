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
  professionalDispatchSpecSchema,
  type Assessment,
  type AssessmentPayload,
  type Budget,
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
  canTransitionRun,
  decideLevel,
  isDirectChiefChild,
  PRIMARY_PURPOSE_BY_ROLE,
  type LockdownRisk,
  requiresExplicitAuthorization,
  validateDispatchSpec,
  validateRolePurpose,
  type DispatchDecision,
} from '@agentdev/domain';
import { withTransaction, type ProjectStore } from '@agentdev/storage';
import type { ConfigStore, ProfileLayer, ProfileResolution } from './config.js';
import { ProtocolError, type ProtocolErrorCode } from './errors.js';
import type { ModelGateway } from './model-gateway.js';
import { canonicalJson } from './dispatcher.js';
import { sha256 } from '@agentdev/storage';
import type { SnapshotWriter } from './snapshots.js';

export interface OrchestratorOptions {
  readonly store: ProjectStore;
  readonly config: ConfigStore;
  readonly snapshots: SnapshotWriter;
  readonly gateway: ModelGateway;
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

  constructor(options: OrchestratorOptions) {
    this.store = options.store;
    this.config = options.config;
    this.snapshots = options.snapshots;
    this.gateway = options.gateway;
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
    const spec = input.spec;
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

    const role = spec.role;
    const availability = this.gateway.availability(role, input.runParams ?? {});
    if (!availability.ok) {
      // A Work whose role has no usable model is blocked, never queued on a guess.
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
    const dispatchSnapshot = dispatchSnapshotSchema.parse({
      ...withoutHash,
      hash: frozen.hash,
    });

    return withTransaction(this.store.db, () => {
      // The reservation happens in the same transaction as the Run row, so a
      // concurrent dispatch cannot double-spend the Work budget.
      this.reserveBudget(work.id, spec.budgetAllocation);
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
    return withTransaction(this.store.db, () => {
      const event = this.store.events.append({
        name: 'chief_action_required',
        entityId: chiefRunId,
        entityVersion: run.version,
        data: {
          reason: 'agent_dispatch',
          requestedBy: run.id,
          workId: run.workId,
          role: input.requestedRole,
          purpose,
          goal: input.goal,
          stage: input.stage ?? 'assist',
          requestReason: input.reason ?? null,
          sourceRefs: (input.sourceRefs ?? []).map((ref) => ({
            kind: ref.kind,
            id: ref.id,
            version: ref.version ?? '1',
          })),
          requiredOutputs: [...(input.requiredOutputs ?? [])],
          requiredChild: input.requiredChild ?? false,
          budgetAllocation: input.budgetAllocation ?? 0,
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
    const snapshot = dispatchSnapshotSchema.parse(frozen.payload);
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

  /**
   * Starts an Attempt for a queued Run.
   *
   * This is the Run-side half of the dispatch handshake: Core decides that a Run
   * may execute, records the Attempt and moves the Run `queued → starting →
   * running`. Supervision, heartbeats, leases and recovery build on these rows in
   * WP-05; nothing else here assumes a Runner exists.
   */
  beginAttempt(runId: string, options: { readonly runnerId?: string } = {}): Attempt {
    const run = this.store.runs.find(runId);
    if (run === undefined) fail('NOT_FOUND', `Run ${runId} does not exist`);
    // The documented path is `queued → starting → running` (`workflow.md` §5.3),
    // so a Run that cannot legally start is refused here, before an Attempt row is
    // written.
    const alreadyStarting = run.status === 'starting';
    if (!alreadyStarting && !canTransitionRun(run.status, 'starting')) {
      fail('VALIDATION_ERROR', `Run ${run.id} cannot start from ${run.status}`, {
        runId: run.id,
        status: run.status,
      });
    }
    return withTransaction(this.store.db, () => {
      const previous = this.store.attempts.list({ where: 'run_id = ?', params: [run.id] });
      const attempt = this.store.attempts.insert({
        runId: run.id,
        number: previous.length + 1,
        status: 'starting',
        ownerEpoch: previous.length,
        ...(options.runnerId === undefined ? {} : { runnerId: options.runnerId }),
      });
      const starting = alreadyStarting
        ? run
        : this.store.runs.update(run.id, { status: 'starting' }, run.version);
      const running = this.store.runs.update(starting.id, { status: 'running' }, starting.version);
      // `protocol.md` §7 has one persistent name for a Run that is now executing.
      this.store.events.append({
        name: 'run.started',
        entityId: running.id,
        entityVersion: running.version,
        data: { attemptId: attempt.id, number: attempt.number, runnerId: options.runnerId ?? null },
      });
      return attempt;
    });
  }

  /**
   * Marks a Run terminal.
   *
   * The transition table stays authoritative, the Run's budget reservation is
   * released (`reliability.md` §3), and the terminal event carries the real
   * outcome — clients must not render every `run.ended` as a success.
   */
  settleRun(
    runId: string,
    status: Extract<Run['status'], 'completed' | 'failed' | 'cancelled'>,
  ): Run {
    const run = this.store.runs.find(runId);
    if (run === undefined) fail('NOT_FOUND', `Run ${runId} does not exist`);
    if (!canTransitionRun(run.status, status)) {
      fail('VALIDATION_ERROR', `Run ${run.id} cannot move ${run.status} → ${status}`, {
        runId: run.id,
        status: run.status,
      });
    }
    return withTransaction(this.store.db, () => {
      const updated = this.store.runs.update(run.id, { status }, run.version);
      this.releaseReservation(updated.workId, run.budgetAllocation);
      this.store.events.append({
        name: 'run.ended',
        entityId: updated.id,
        entityVersion: updated.version,
        data: { outcome: status, workId: updated.workId, releasedTokens: run.budgetAllocation },
      });
      return updated;
    });
  }

  /**
   * Reserves tokens for a dispatched Run (`reliability.md` §3).
   *
   * `used + reserved <= limit` is enforced by the Schema, so an over-commit fails
   * at the update rather than at the model call.
   */
  private reserveBudget(workId: string, allocation: number): void {
    if (allocation === 0) return;
    const budget = this.budgetOf(workId);
    this.store.budgets.update(
      budget.id,
      { tokensReserved: budget.tokensReserved + allocation },
      budget.version,
    );
  }

  private releaseReservation(workId: string, allocation: number): void {
    if (allocation === 0) return;
    const budget = this.budgetOf(workId);
    this.store.budgets.update(
      budget.id,
      { tokensReserved: Math.max(0, budget.tokensReserved - allocation) },
      budget.version,
    );
  }

  /** The Work's own budget row (`work.budgetId`), never another Work's. */
  private budgetOf(workId: string): Budget {
    const work = this.requireWork(workId);
    const budget = this.store.budgets.find(work.budgetId);
    if (budget === undefined) {
      fail('INTERNAL_ERROR', `Work ${workId} references missing budget ${work.budgetId}`, {
        workId,
        budgetId: work.budgetId,
      });
    }
    return budget;
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
    const allocated = siblings.reduce((total, sibling) => total + sibling.budgetAllocation, 0);
    if (allocated + spec.budgetAllocation > parent.budgetAllocation) {
      fail(
        'BUDGET_EXCEEDED',
        `children of Run ${parent.id} already hold ${allocated} of ${parent.budgetAllocation} tokens`,
        { parentRunId: parent.id, allocated, requested: spec.budgetAllocation },
      );
    }
    // The Work budget is the authority (`reliability.md` §3); the parent Run's
    // allocation is a second, run-level ceiling.
    enforce(
      canAllocateBudget(this.budgetOf(parent.workId), spec.budgetAllocation),
      'dispatch budget',
    );
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
  return professionalDispatchSpecSchema.parse({ ...input, kind: 'professional' });
}
