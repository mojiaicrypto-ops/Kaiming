/**
 * Findings, work completion and the pause/resume/cancel controls
 * (`docs/rules/workflow.md` §5–§7, AC-017…AC-021, AC-083).
 *
 * The *decisions* belong to `@agentdev/domain` (`delivery.ts`): whether a Finding
 * returns to development, who may verify it, whether a Test result blocks
 * completion, and which Run transitions are legal. This module owns the durable
 * half over the real `ProjectStore`:
 *
 * - **Findings** are rows of `finding` (`data.md` §2). A Review/integration
 *   Finding binds the Review Run and the Manifest it came from; only a `task`
 *   target needs a `taskId`, so an integration or document Finding needs no
 *   fabricated task (AC-083). Returning one to development invalidates the
 *   Work's Review/Test evidence and re-opens the affected task (AC-017), and
 *   closure is refused for a developer actor and for any Review/Test that is not
 *   a *new*, independent Run of the fixing revision (AC-018).
 * - **Completion** goes through `findingBlocksCompletion`: a `blocked` Test never
 *   completes and each `not_covered` acceptance id needs an accepted `risk`
 *   Decision (AC-019).
 * - **Pause** walks the Work to `paused` through documented Work transitions,
 *   stops the live Attempts and freezes a Checkpoint barrier; `writeAdmission`
 *   and the Run status then make further writes impossible until `resumeWork`
 *   passes a Work/Task version check and opens a new Attempt (AC-020).
 * - **Cancel** enters `cancelling`, cancels the Run tree through `RunLifecycle`
 *   (which cascades to children and books each Run's budget), preserves the
 *   produced artifacts without integrating them, and only then reaches
 *   `cancelled` — or stops at `blocked(recovery)` with a pending user Decision
 *   when side effects are unknown (AC-021, `reliability.md` §6).
 *
 * Every refusal is a result object and writes nothing; every mutation commits in
 * one transaction together with its event (`reliability.md` §1).
 */
import {
  workStatusSchema,
  type Attempt,
  type CheckStatus,
  type Decision,
  type Finding,
  type FindingSeverity,
  type JsonObject,
  type Ref,
  type RequirementState,
  type Role,
  type Run,
  type RunStatus,
  type Work,
  type WorkStatus,
} from '@agentdev/contracts';
import {
  bindFindingTarget,
  canTransitionAttempt,
  canTransitionRun,
  canTransitionTask,
  canTransitionWork,
  evaluateFindingClosure,
  evaluateFindingRouting,
  findingBlocksCompletion,
  isTerminalRunStatus,
  type FindingBinding,
  type FindingCandidate,
  type FindingTargetBinding,
  type VerificationRun,
} from '@agentdev/domain';
import { BlobStore, sha256, withTransaction, type ProjectStore } from '@agentdev/storage';
import { ArtifactService } from './artifacts.js';
import { canonicalJson } from './dispatcher.js';
import { ProtocolError } from './errors.js';
import { RunLifecycle } from './run-lifecycle.js';

/** Payload schema version of the records this module freezes. */
export const FINDING_RECORD_VERSION = 1;

/** The immutable table the binding/verification evidence is frozen in. */
export const FINDING_EVIDENCE_SNAPSHOT_TYPE = 'verification';

/** The immutable table the pause/cancel barriers are frozen in. */
export const WORK_BARRIER_SNAPSHOT_TYPE = 'checkpoint';

/**
 * Roles that may move a Finding to `addressed`.
 *
 * The implementation lane fixes a task/integration Finding and the document lane
 * fixes a document Finding; none of them may verify it (`workflow.md` §6:
 * only an independent Review closes a Finding).
 */
export const FIXING_ROLES: readonly Role[] = ['backend', 'frontend', 'product', 'planning'];

/** Roles that may verify a Finding at all. */
export const VERIFYING_ROLES: readonly Role[] = ['review', 'test'];

/** The refusal vocabulary this service reports as a result object. */
export type FindingServiceCode =
  | 'VALIDATION_ERROR'
  | 'INVALID_STATE'
  | 'NOT_AUTHORIZED'
  | 'NOT_FOUND'
  | 'GATE_NOT_READY'
  | 'STALE_ARTIFACT'
  | 'VERSION_CONFLICT'
  | 'RECOVERY_REQUIRED'
  | 'BUDGET_EXCEEDED';

export interface ServiceRefusal {
  readonly ok: false;
  readonly code: FindingServiceCode;
  readonly message: string;
  readonly gaps: readonly string[];
}

function refusal(
  code: FindingServiceCode,
  message: string,
  gaps: readonly string[] = [message],
): ServiceRefusal {
  return { ok: false, code, message, gaps };
}

// ---------------------------------------------------------------------------
// Findings (AC-017/AC-018/AC-083)
// ---------------------------------------------------------------------------

/** The caller-supplied content of one Finding; the binding comes from the Run. */
export interface FindingContentInput {
  readonly description: string;
  readonly severity: FindingSeverity;
  /**
   * Whether the Finding blocks. Defaults follow `workflow.md` §6: P0/P1 always
   * block, P2/P3 only when the Review says they affect acceptance.
   */
  readonly blocking?: boolean;
  readonly path?: string;
  readonly line?: number;
  readonly evidenceRefs?: readonly string[];
}

export interface SubmitFindingInput {
  /** The Review/Test Run that raised the Finding; it supplies the Work. */
  readonly reviewRunId: string;
  readonly target: FindingTargetBinding;
  readonly manifestRef: Ref;
  /** Optional explicit task id; a `task` target still requires one somewhere. */
  readonly taskId?: string;
  readonly finding: FindingContentInput;
  readonly at?: string;
}

export interface FindingBindingRecord {
  readonly targetKind: 'task' | 'integration' | 'document';
  readonly taskId?: string;
  readonly manifestRef: Ref;
  readonly targetRef: Ref;
  readonly recordHash: string;
}

export interface FindingRoutingView {
  readonly transition: ReturnType<typeof evaluateFindingRouting>['transition'];
  readonly requiresNewReview: boolean;
  readonly requiresNewTest: boolean;
  readonly reason: string;
}

export interface SubmitFindingResult {
  readonly ok: true;
  readonly finding: Finding;
  readonly binding: FindingBindingRecord;
  readonly routing: FindingRoutingView;
  /** Review/Test artifacts the return-to-development invalidated. */
  readonly invalidatedEvidenceRefs: readonly string[];
  /** Tasks re-opened to `develop` because their Review/Test result was invalid. */
  readonly returnedTaskIds: readonly string[];
}

export interface MarkAddressedInput {
  readonly findingId: string;
  /** The role recording the fix; must be an implementation/document role. */
  readonly actorRole: Role;
  /** The Run that produced the fix; the verification must be a different Run. */
  readonly fixRunId: string;
  readonly at?: string;
}

export type MarkAddressedResult = { readonly ok: true; readonly finding: Finding } | ServiceRefusal;

export interface VerifyFindingInput {
  readonly findingId: string;
  readonly actorRole: Role;
  /** The verification Run; it must be a new, independent Review of the fix. */
  readonly reviewRun: { readonly runId: string };
  readonly testRun?: { readonly runId: string };
  readonly repairUsed?: number;
  readonly repairLimit?: number;
  readonly at?: string;
}

export interface VerifyFindingResult {
  readonly ok: true;
  readonly finding: Finding;
  readonly state: 'verified' | 'accepted_risk';
  readonly reviewRunId: string;
  readonly testRunId: string | null;
  readonly verificationRef: string;
}

export interface VerifyFindingRefusal extends ServiceRefusal {
  readonly requiresNewReview: boolean;
  readonly requiresNewTest: boolean;
}

export interface AcceptFindingRiskInput {
  /** The accepted `risk` Decision that records the user's residual-risk choice. */
  readonly decisionId: string;
  readonly findingId: string;
  readonly at?: string;
}

export type AcceptFindingRiskResult =
  { readonly ok: true; readonly finding: Finding; readonly decisionId: string } | ServiceRefusal;

// ---------------------------------------------------------------------------
// Completion (AC-019)
// ---------------------------------------------------------------------------

export interface TestResultInput {
  readonly status: CheckStatus;
  readonly uncovered?: readonly {
    readonly acceptanceId: string;
    readonly reason: string;
    readonly riskDecisionId?: string;
  }[];
}

export interface RiskDispositionInput {
  readonly acceptanceId: string;
  /** An accepted `risk` Decision row bound to the same Work. */
  readonly decisionId: string;
}

export interface CompleteWorkInput {
  readonly workId: string;
  /**
   * The Test result bound to the Work. Omitted means "no Test result yet", which
   * is a `GATE_NOT_READY` rather than an assumed pass.
   */
  readonly testResult?: TestResultInput;
  readonly riskDispositions?: readonly RiskDispositionInput[];
  readonly at?: string;
}

export type CompleteWorkResult =
  | {
      readonly ok: true;
      readonly work: Work;
      readonly testStatus: CheckStatus;
      readonly riskDecisionIds: readonly string[];
    }
  | {
      readonly ok: false;
      readonly code: Extract<
        FindingServiceCode,
        'GATE_NOT_READY' | 'VALIDATION_ERROR' | 'INVALID_STATE' | 'NOT_FOUND'
      >;
      readonly message: string;
      readonly reasons: readonly string[];
      readonly needsRiskDisposition: readonly string[];
    };

// ---------------------------------------------------------------------------
// Pause / resume (AC-020)
// ---------------------------------------------------------------------------

export interface PausedRunView {
  readonly runId: string;
  readonly previousStatus: RunStatus;
  /** The safe-point status the Run reached (`paused` or `interrupted`). */
  readonly status: RunStatus;
  readonly stoppedAttemptIds: readonly string[];
  readonly checkpointRef: string;
}

export interface PauseWorkInput {
  readonly workId: string;
  readonly reason?: string;
  readonly at?: string;
}

export interface PauseWorkResult {
  readonly ok: true;
  readonly work: Work;
  readonly previousStatus: WorkStatus;
  readonly pausedRuns: readonly PausedRunView[];
  /** Runs already at a safe point (queued/interrupted/paused): nothing to stop. */
  readonly heldRunIds: readonly string[];
  readonly attemptsClosed: number;
  readonly barrierRef: string;
}

export type PauseWorkRefusalCode = Extract<
  FindingServiceCode,
  'NOT_FOUND' | 'INVALID_STATE' | 'RECOVERY_REQUIRED' | 'GATE_NOT_READY'
>;

export type PauseWorkResultOrRefusal =
  | PauseWorkResult
  | {
      readonly ok: false;
      readonly code: PauseWorkRefusalCode;
      readonly message: string;
      readonly recoveryRunIds: readonly string[];
    };

export interface OpenedAttempt {
  readonly runId: string;
  readonly attemptId: string;
  readonly number: number;
  readonly epoch: number;
}

export interface ResumeWorkInput {
  readonly workId: string;
  /** The Work version the caller last saw; a mismatch is `VERSION_CONFLICT`. */
  readonly expectedWorkVersion: number;
  /** Task versions the caller last saw, checked before anything is resumed. */
  readonly expectedTaskVersions?: Readonly<Record<string, number>>;
  readonly at?: string;
}

export type ResumeWorkResult =
  | {
      readonly ok: true;
      readonly work: Work;
      readonly attempts: readonly OpenedAttempt[];
      readonly taskVersions: readonly { readonly taskId: string; readonly version: number }[];
      readonly barrierRef: string;
    }
  | {
      readonly ok: false;
      readonly code: Extract<
        FindingServiceCode,
        'NOT_FOUND' | 'INVALID_STATE' | 'VERSION_CONFLICT' | 'GATE_NOT_READY' | 'RECOVERY_REQUIRED'
      >;
      readonly message: string;
      readonly currentVersion: number | null;
    };

// ---------------------------------------------------------------------------
// Cancel (AC-021)
// ---------------------------------------------------------------------------

export interface CancelWorkInput {
  readonly workId: string;
  readonly reason?: string;
  /** `true` when the caller cannot rule out external side effects. */
  readonly sideEffectsUnknown?: boolean;
  readonly at?: string;
}

export interface CancellationOutcome {
  readonly ok: true;
  readonly work: Work;
  readonly status: WorkStatus;
  readonly cancelledRunIds: readonly string[];
  readonly stoppedAttemptIds: readonly string[];
  /** Artifacts kept on disk but explicitly not integrated. */
  readonly preservedArtifactIds: readonly string[];
  readonly integrated: false;
  readonly requirementStatus: RequirementState | null;
  readonly recoveryRequired: boolean;
  readonly recoveryDecisionId: string | null;
  readonly recordRef: string;
}

export type CancelWorkResult =
  | CancellationOutcome
  | {
      readonly ok: false;
      readonly code: Extract<FindingServiceCode, 'NOT_FOUND' | 'INVALID_STATE'>;
      readonly message: string;
    };

export interface ResolveCancellationInput {
  readonly workId: string;
  /** The pending `recovery` Decision the blocked Work opened. */
  readonly decisionId: string;
  readonly disposition: 'resume' | 'accept_cancel' | 'abandon';
  readonly at?: string;
}

export type ResolveCancellationResult =
  | CancellationOutcome
  | {
      readonly ok: false;
      readonly code: Extract<FindingServiceCode, 'NOT_FOUND' | 'INVALID_STATE' | 'NOT_AUTHORIZED'>;
      readonly message: string;
    };

/** Whether a Run may still write; the pause barrier must be observable. */
export interface WriteAdmission {
  readonly admitted: boolean;
  readonly code: 'INVALID_STATE' | 'NOT_FOUND' | null;
  readonly reason: string;
}

/**
 * The Finding/completion/pause/cancel service for one Project.
 *
 * Constructed over the same `ProjectStore` as the gate/decision services, and
 * sharing the store's `RunLifecycle` so a cancelled Run takes the documented
 * terminal path (budget booking plus child cascade).
 */
export class FindingService {
  private readonly store: ProjectStore;
  private readonly artifacts: ArtifactService;
  private readonly lifecycle: RunLifecycle;

  constructor(options: {
    readonly store: ProjectStore;
    readonly artifacts?: ArtifactService;
    readonly lifecycle?: RunLifecycle;
    readonly blobs?: BlobStore;
  }) {
    this.store = options.store;
    this.artifacts =
      options.artifacts ??
      new ArtifactService({
        store: options.store,
        blobs: options.blobs ?? new BlobStore({ root: options.store.dataDir }),
      });
    this.lifecycle = options.lifecycle ?? new RunLifecycle({ store: options.store });
  }

  // -------------------------------------------------------------------------
  // Read model
  // -------------------------------------------------------------------------

  getFinding(findingId: string): Finding | undefined {
    return this.store.findings.find(findingId);
  }

  listFindings(workId: string): Finding[] {
    return this.store.findings.list({
      where: 'work_id = ?',
      params: [workId],
      orderBy: 'created_at ASC',
    });
  }

  // -------------------------------------------------------------------------
  // Submit (AC-017/AC-083)
  // -------------------------------------------------------------------------

  submitFinding(input: SubmitFindingInput): SubmitFindingResult | ServiceRefusal {
    // The target binding is a pure decision: an incomplete one must not create a
    // transaction, let alone a row (`data.md` §2 `finding`).
    const binding = bindFindingTarget({
      target: input.target,
      manifestRef: input.manifestRef,
      ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
    });
    if (!binding.ok) return refusal('VALIDATION_ERROR', binding.message);
    if (input.finding.description.trim().length === 0) {
      return refusal('VALIDATION_ERROR', 'a Finding needs a description');
    }
    return withTransaction(this.store.db, () => this.submitTx(input, binding));
  }

  private submitTx(
    input: SubmitFindingInput,
    binding: Extract<FindingBinding, { ok: true }>,
  ): SubmitFindingResult | ServiceRefusal {
    const reviewRun = this.store.runs.find(input.reviewRunId);
    if (reviewRun === undefined) {
      return refusal('NOT_FOUND', `Run ${input.reviewRunId} does not exist`);
    }
    // Findings come from a Review result (`workflow.md` §6); a developer Run cannot
    // file one against its own delivery.
    if (reviewRun.role !== 'review' && reviewRun.role !== 'test') {
      return refusal(
        'NOT_AUTHORIZED',
        `role ${reviewRun.role} cannot raise a Finding; only a Review/Test Run may`,
      );
    }
    const work = this.store.works.find(reviewRun.workId);
    if (work === undefined) {
      return refusal('NOT_FOUND', `Work ${reviewRun.workId} does not exist`);
    }
    if (work.status === 'cancelled' || work.status === 'failed') {
      return refusal('INVALID_STATE', `Work ${work.id} is ${work.status} and accepts no Finding`);
    }
    if (binding.taskId !== undefined) {
      const task = this.store.tasks.find(binding.taskId);
      if (task === undefined) {
        return refusal('VALIDATION_ERROR', `Task ${binding.taskId} does not exist`);
      }
      if (task.workId !== work.id) {
        return refusal(
          'NOT_AUTHORIZED',
          `Task ${binding.taskId} belongs to another Work and cannot be this Finding's target`,
        );
      }
    }

    const severity = input.finding.severity;
    const blocking = input.finding.blocking ?? (severity === 'P0' || severity === 'P1');
    const row = this.store.findings.insert({
      workId: work.id,
      ...(binding.taskId === undefined ? {} : { taskId: binding.taskId }),
      reviewRunId: reviewRun.id,
      manifestId: binding.manifestRef.id,
      targetKind: binding.targetKind,
      targetRef: binding.targetRef,
      severity,
      blocking,
      ...(input.finding.path === undefined ? {} : { path: input.finding.path }),
      ...(input.finding.line === undefined ? {} : { line: input.finding.line }),
      evidenceRefs: [...(input.finding.evidenceRefs ?? [])],
      description: input.finding.description,
      state: 'open',
    });
    const at = input.at ?? this.store.now();
    const recordHash = this.appendSnapshot(FINDING_EVIDENCE_SNAPSHOT_TYPE, {
      kind: 'finding_binding',
      schemaVersion: FINDING_RECORD_VERSION,
      workId: work.id,
      findingId: row.id,
      reviewRunId: reviewRun.id,
      manifestId: binding.manifestRef.id,
      targetKind: binding.targetKind,
      taskId: binding.taskId ?? null,
      targetRef: refJson(binding.targetRef),
      manifestRef: refJson(binding.manifestRef),
      recordedAt: at,
    });
    const record: FindingBindingRecord = {
      targetKind: binding.targetKind,
      ...(binding.taskId === undefined ? {} : { taskId: binding.taskId }),
      manifestRef: binding.manifestRef,
      targetRef: binding.targetRef,
      recordHash,
    };

    const routing = evaluateFindingRouting(this.candidateOf(row));
    // A Review Finding returns to development automatically: the Review/Test
    // evidence it invalidates can never verify the fix (AC-017).
    const invalidatedEvidenceRefs =
      routing.transition === 'return_to_development'
        ? this.invalidateVerificationEvidence(work.id, row.id)
        : [];
    const returnedTaskIds =
      routing.transition === 'return_to_development' ? this.reopenTasks(work.id, row) : [];

    this.store.events.append({
      name: 'finding.created',
      entityId: row.id,
      entityVersion: row.version,
      data: {
        workId: work.id,
        findingId: row.id,
        reviewRunId: reviewRun.id,
        manifestId: binding.manifestRef.id,
        targetKind: binding.targetKind,
        taskId: binding.taskId ?? null,
        severity,
        blocking,
        transition: routing.transition,
        requiresNewReview: routing.requiresNewReview,
        requiresNewTest: routing.requiresNewTest,
        invalidatedEvidenceRefs: [...invalidatedEvidenceRefs],
        returnedTaskIds: [...returnedTaskIds],
        bindingRef: recordHash,
      },
    });

    return {
      ok: true,
      finding: row,
      binding: record,
      routing: {
        transition: routing.transition,
        requiresNewReview: routing.requiresNewReview,
        requiresNewTest: routing.requiresNewTest,
        reason: routing.reason,
      },
      invalidatedEvidenceRefs,
      returnedTaskIds,
    };
  }

  // -------------------------------------------------------------------------
  // Address and verify (AC-017/AC-018)
  // -------------------------------------------------------------------------

  markAddressed(input: MarkAddressedInput): MarkAddressedResult {
    return withTransaction(this.store.db, () => this.markAddressedTx(input));
  }

  private markAddressedTx(input: MarkAddressedInput): MarkAddressedResult {
    const finding = this.store.findings.find(input.findingId);
    if (finding === undefined) return refusal('NOT_FOUND', `Finding ${input.findingId} is unknown`);
    if (!FIXING_ROLES.includes(input.actorRole)) {
      return refusal(
        'NOT_AUTHORIZED',
        `role ${input.actorRole} cannot address a Finding; an implementation/document role must`,
      );
    }
    if (finding.state !== 'open') {
      return refusal('INVALID_STATE', `Finding ${finding.id} is ${finding.state}, not open`);
    }
    const fixRun = this.store.runs.find(input.fixRunId);
    if (fixRun === undefined) return refusal('NOT_FOUND', `Run ${input.fixRunId} does not exist`);
    if (fixRun.workId !== finding.workId) {
      return refusal('NOT_AUTHORIZED', `Run ${fixRun.id} belongs to another Work`);
    }
    if (!FIXING_ROLES.includes(fixRun.role)) {
      return refusal(
        'NOT_AUTHORIZED',
        `Run ${fixRun.id} has role ${fixRun.role} and cannot be the fixing Run`,
      );
    }
    if (fixRun.status !== 'completed') {
      // An unfinished Run has no frozen result: the fix is not yet a fact.
      return refusal(
        'GATE_NOT_READY',
        `Run ${fixRun.id} is ${fixRun.status}; a completed fixing Run is required`,
      );
    }
    const updated = this.store.findings.update(
      finding.id,
      { state: 'addressed', resolutionRef: fixRun.id },
      finding.version,
    );
    this.store.events.append({
      name: 'finding.addressed',
      entityId: updated.id,
      entityVersion: updated.version,
      data: {
        workId: updated.workId,
        findingId: updated.id,
        fixRunId: fixRun.id,
        actorRole: input.actorRole,
        recordedAt: input.at ?? this.store.now(),
      },
    });
    return { ok: true, finding: updated };
  }

  verifyFinding(input: VerifyFindingInput): VerifyFindingResult | VerifyFindingRefusal {
    return withTransaction(this.store.db, () => this.verifyTx(input));
  }

  private verifyTx(input: VerifyFindingInput): VerifyFindingResult | VerifyFindingRefusal {
    const finding = this.store.findings.find(input.findingId);
    if (finding === undefined) {
      return { ...refusal('NOT_FOUND', `Finding ${input.findingId} is unknown`), ...NEW_BOTH };
    }
    // AC-018's negative case, decided before any Run lookup so a developer actor
    // always sees the role refusal rather than a confusing missing-Run error.
    if (!VERIFYING_ROLES.includes(input.actorRole)) {
      return {
        ...refusal(
          'NOT_AUTHORIZED',
          `role ${input.actorRole} cannot verify a Finding; only an independent Review/Test may`,
        ),
        requiresNewReview: true,
        requiresNewTest: true,
      };
    }
    if (finding.state === 'open') {
      return {
        ...refusal('INVALID_STATE', 'an open Finding has not been addressed yet'),
        requiresNewReview: true,
        requiresNewTest: true,
      };
    }
    if (finding.state === 'verified' || finding.state === 'accepted_risk') {
      return {
        ...refusal('INVALID_STATE', `Finding ${finding.id} is already ${finding.state}`),
        requiresNewReview: false,
        requiresNewTest: false,
      };
    }
    const fixRunId = finding.resolutionRef;
    if (fixRunId === undefined) {
      return {
        ...refusal('INVALID_STATE', `Finding ${finding.id} has no recorded fixing Run`),
        requiresNewReview: true,
        requiresNewTest: true,
      };
    }
    const fixRun = this.store.runs.find(fixRunId);
    if (fixRun === undefined) {
      return {
        ...refusal('INVALID_STATE', `the fixing Run ${fixRunId} no longer exists`),
        requiresNewReview: true,
        requiresNewTest: true,
      };
    }
    const reviewRow = this.store.runs.find(input.reviewRun.runId);
    if (reviewRow === undefined) {
      return {
        ...refusal('NOT_FOUND', `Review Run ${input.reviewRun.runId} does not exist`),
        requiresNewReview: true,
        requiresNewTest: true,
      };
    }
    const testRow =
      input.testRun === undefined ? undefined : this.store.runs.find(input.testRun.runId);
    if (input.testRun !== undefined && testRow === undefined) {
      return {
        ...refusal('NOT_FOUND', `Test Run ${input.testRun.runId} does not exist`),
        requiresNewReview: true,
        requiresNewTest: true,
      };
    }

    const outcome = evaluateFindingClosure({
      finding: this.candidateOf(finding),
      actorRole: input.actorRole,
      reviewRun: this.verificationRunOf(reviewRow, 'review', finding, fixRun),
      ...(testRow === undefined
        ? {}
        : { testRun: this.verificationRunOf(testRow, 'test', finding, fixRun) }),
      ...(input.repairUsed === undefined ? {} : { repairUsed: input.repairUsed }),
      ...(input.repairLimit === undefined ? {} : { repairLimit: input.repairLimit }),
    });
    if (!outcome.closed) {
      return {
        ok: false,
        code: outcome.code,
        message: outcome.message,
        gaps: [outcome.message],
        requiresNewReview: outcome.requiresNewReview,
        requiresNewTest: outcome.requiresNewTest,
      };
    }
    const updated = this.store.findings.update(
      finding.id,
      { state: outcome.state, resolutionRef: reviewRow.id },
      finding.version,
    );
    const verificationRef = this.appendSnapshot(FINDING_EVIDENCE_SNAPSHOT_TYPE, {
      kind: 'finding_verification',
      schemaVersion: FINDING_RECORD_VERSION,
      workId: finding.workId,
      findingId: finding.id,
      state: outcome.state,
      fixingRunId: fixRun.id,
      reviewRunId: reviewRow.id,
      testRunId: testRow?.id ?? null,
      reviewRunCreatedAt: reviewRow.createdAt,
      testRunCreatedAt: testRow?.createdAt ?? null,
      recordedAt: input.at ?? this.store.now(),
    });
    this.store.events.append({
      name: outcome.state === 'verified' ? 'finding.verified' : 'finding.accepted_risk',
      entityId: updated.id,
      entityVersion: updated.version,
      data: {
        workId: updated.workId,
        findingId: updated.id,
        state: outcome.state,
        actorRole: input.actorRole,
        reviewRunId: reviewRow.id,
        testRunId: testRow?.id ?? null,
        verificationRef,
      },
    });
    return {
      ok: true,
      finding: updated,
      state: outcome.state,
      reviewRunId: reviewRow.id,
      testRunId: testRow?.id ?? null,
      verificationRef,
    };
  }

  /**
   * Records a user-accepted residual risk for a Finding (AC-019's other half).
   *
   * Risk acceptance is a user decision, so the caller must point at a real
   * accepted `risk` Decision of the same Work; an agent cannot accept it.
   */
  acceptFindingRisk(input: AcceptFindingRiskInput): AcceptFindingRiskResult {
    return withTransaction(this.store.db, () => {
      const finding = this.store.findings.find(input.findingId);
      if (finding === undefined) {
        return refusal('NOT_FOUND', `Finding ${input.findingId} is unknown`);
      }
      if (finding.state === 'verified' || finding.state === 'accepted_risk') {
        return refusal('INVALID_STATE', `Finding ${finding.id} is already ${finding.state}`);
      }
      const checked = this.acceptedRiskDecision(input.decisionId, finding.workId);
      if (!checked.ok) return refusal('VALIDATION_ERROR', checked.message);
      const updated = this.store.findings.update(
        finding.id,
        { state: 'accepted_risk', resolutionRef: checked.decision.id },
        finding.version,
      );
      this.store.events.append({
        name: 'finding.accepted_risk',
        entityId: updated.id,
        entityVersion: updated.version,
        data: {
          workId: updated.workId,
          findingId: updated.id,
          decisionId: checked.decision.id,
          recordedAt: input.at ?? this.store.now(),
        },
      });
      return { ok: true, finding: updated, decisionId: checked.decision.id };
    });
  }

  // -------------------------------------------------------------------------
  // Completion gate (AC-019)
  // -------------------------------------------------------------------------

  completeWork(input: CompleteWorkInput): CompleteWorkResult {
    return withTransaction(this.store.db, () => this.completeTx(input));
  }

  private completeTx(input: CompleteWorkInput): CompleteWorkResult {
    const work = this.store.works.find(input.workId);
    if (work === undefined) {
      return {
        ok: false,
        code: 'NOT_FOUND',
        message: `Work ${input.workId} does not exist`,
        reasons: ['unknown Work'],
        needsRiskDisposition: [],
      };
    }
    if (work.status === 'completed') {
      return {
        ok: false,
        code: 'INVALID_STATE',
        message: `Work ${work.id} is already completed`,
        reasons: ['already completed'],
        needsRiskDisposition: [],
      };
    }
    if (work.status === 'cancelled' || work.status === 'cancelling' || work.status === 'failed') {
      return {
        ok: false,
        code: 'INVALID_STATE',
        message: `Work ${work.id} is ${work.status} and cannot complete`,
        reasons: [`Work is ${work.status}`],
        needsRiskDisposition: [],
      };
    }

    const testResult = input.testResult;
    const dispositions = new Map<string, string>();
    for (const disposition of input.riskDispositions ?? []) {
      if (dispositions.has(disposition.acceptanceId)) {
        return {
          ok: false,
          code: 'VALIDATION_ERROR',
          message: `acceptance ${disposition.acceptanceId} has more than one risk disposition`,
          reasons: ['duplicate risk disposition'],
          needsRiskDisposition: [],
        };
      }
      dispositions.set(disposition.acceptanceId, disposition.decisionId);
    }
    const uncoveredIds = new Set((testResult?.uncovered ?? []).map((entry) => entry.acceptanceId));
    for (const acceptanceId of dispositions.keys()) {
      if (!uncoveredIds.has(acceptanceId)) {
        return {
          ok: false,
          code: 'VALIDATION_ERROR',
          message: `risk disposition for ${acceptanceId} does not match an uncovered acceptance id`,
          reasons: ['risk disposition without a matching uncovered item'],
          needsRiskDisposition: [],
        };
      }
    }

    const riskDecisionIds: string[] = [];
    const uncovered: {
      readonly acceptanceId: string;
      readonly reason: string;
      readonly riskDecisionId?: string;
    }[] = [];
    for (const entry of testResult?.uncovered ?? []) {
      const decisionId = entry.riskDecisionId ?? dispositions.get(entry.acceptanceId);
      if (decisionId === undefined) {
        uncovered.push({ acceptanceId: entry.acceptanceId, reason: entry.reason });
        continue;
      }
      const checked = this.acceptedRiskDecision(decisionId, work.id);
      if (!checked.ok) {
        return {
          ok: false,
          code: 'VALIDATION_ERROR',
          message: checked.message,
          reasons: [checked.message],
          needsRiskDisposition: [entry.acceptanceId],
        };
      }
      riskDecisionIds.push(checked.decision.id);
      uncovered.push({
        acceptanceId: entry.acceptanceId,
        reason: entry.reason,
        riskDecisionId: checked.decision.id,
      });
    }

    const gate = findingBlocksCompletion(
      testResult === undefined ? undefined : { status: testResult.status, uncovered },
    );
    // `workflow.md` §6: a P0/P1 Finding blocks until an independent Review verifies
    // it or the user accepts the residual risk; a passing Test does not close it.
    const blockingFindings = this.store.findings.list({
      where: "work_id = ? AND blocking = 1 AND state IN ('open','addressed')",
      params: [work.id],
      orderBy: 'created_at ASC',
    });
    const reasons = [
      ...(gate.blocked ? gate.reasons : []),
      ...(blockingFindings.length === 0
        ? []
        : [
            `blocking Findings are not closed: ${blockingFindings
              .map((finding) => `${finding.id}(${finding.state})`)
              .join(', ')}`,
          ]),
    ];
    if (reasons.length > 0) {
      return {
        ok: false,
        code: 'GATE_NOT_READY',
        message: reasons.join('; '),
        reasons,
        needsRiskDisposition: gate.blocked ? gate.needsRiskDisposition : [],
      };
    }
    if (!canTransitionWork(work.status, 'completed')) {
      return {
        ok: false,
        code: 'INVALID_STATE',
        message: `Work ${work.id} cannot move ${work.status} → completed`,
        reasons: ['illegal Work transition'],
        needsRiskDisposition: [],
      };
    }
    const updated = this.store.works.update(work.id, { status: 'completed' }, work.version);
    this.store.events.append({
      name: 'delivery.work_completed',
      entityId: updated.id,
      entityVersion: updated.version,
      data: {
        workId: updated.id,
        testStatus: testResult?.status ?? null,
        riskDecisionIds: [...new Set(riskDecisionIds)],
        completedAt: input.at ?? this.store.now(),
      },
    });
    return {
      ok: true,
      work: updated,
      testStatus: testResult?.status ?? 'blocked',
      riskDecisionIds: [...new Set(riskDecisionIds)],
    };
  }

  // -------------------------------------------------------------------------
  // Write admission (AC-020)
  // -------------------------------------------------------------------------

  /**
   * Whether one Run may still write.
   *
   * The barrier is the persisted Work/Run state, not a flag: a paused or
   * cancelling Work admits nothing, and a Run that is not `running` admits
   * nothing (`workflow.md` §5.3, `reliability.md` §2).
   */
  writeAdmission(runId: string): WriteAdmission {
    const run = this.store.runs.find(runId);
    if (run === undefined) {
      return { admitted: false, code: 'NOT_FOUND', reason: `Run ${runId} does not exist` };
    }
    const work = this.store.works.find(run.workId);
    if (work === undefined) {
      return { admitted: false, code: 'NOT_FOUND', reason: `Work ${run.workId} does not exist` };
    }
    if (work.status === 'paused') {
      return {
        admitted: false,
        code: 'INVALID_STATE',
        reason: `Work ${work.id} is paused; no write is admitted until it resumes`,
      };
    }
    if (work.status === 'cancelling' || work.status === 'cancelled') {
      return {
        admitted: false,
        code: 'INVALID_STATE',
        reason: `Work ${work.id} is ${work.status}; no write is admitted`,
      };
    }
    if (run.status !== 'running') {
      return {
        admitted: false,
        code: 'INVALID_STATE',
        reason: `Run ${run.id} is ${run.status}; only a running Run may write`,
      };
    }
    return { admitted: true, code: null, reason: `Run ${run.id} is running under ${work.status}` };
  }

  // -------------------------------------------------------------------------
  // Pause / resume (AC-020)
  // -------------------------------------------------------------------------

  pauseWork(input: PauseWorkInput): PauseWorkResultOrRefusal {
    return withTransaction(this.store.db, () => this.pauseTx(input));
  }

  private pauseTx(input: PauseWorkInput): PauseWorkResultOrRefusal {
    const work = this.store.works.find(input.workId);
    if (work === undefined) {
      return {
        ok: false,
        code: 'NOT_FOUND',
        message: `Work ${input.workId} does not exist`,
        recoveryRunIds: [],
      };
    }
    if (work.status === 'paused') {
      return {
        ok: false,
        code: 'INVALID_STATE',
        message: `Work ${work.id} is already paused`,
        recoveryRunIds: [],
      };
    }
    if (
      work.status === 'completed' ||
      work.status === 'failed' ||
      work.status === 'cancelled' ||
      work.status === 'cancelling' ||
      // `blocked` returns to `running` through its own recovery, never through the
      // pause path (`workflow.md` §5.1); pausing it would silently resume it first.
      work.status === 'blocked'
    ) {
      return {
        ok: false,
        code: 'INVALID_STATE',
        message: `Work ${work.id} is ${work.status} and cannot pause`,
        recoveryRunIds: [],
      };
    }
    const runs = this.store.runs.list({
      where: 'work_id = ?',
      params: [work.id],
      orderBy: 'created_at ASC',
    });
    // Plan the whole safe point before writing: a Run that cannot be frozen makes
    // the pause a `RECOVERY_REQUIRED` refusal with no partial state.
    const plans: { readonly run: Run; readonly target: RunStatus }[] = [];
    const heldRunIds: string[] = [];
    const recoveryRunIds: string[] = [];
    for (const run of runs) {
      if (isTerminalRunStatus(run.status)) continue;
      if (run.status === 'recovery_required') {
        recoveryRunIds.push(run.id);
        continue;
      }
      if (run.status === 'paused' || run.status === 'interrupted' || run.status === 'queued') {
        heldRunIds.push(run.id);
        continue;
      }
      if (canTransitionRun(run.status, 'paused')) {
        plans.push({ run, target: 'paused' });
        continue;
      }
      if (run.status === 'starting' && canTransitionRun(run.status, 'interrupted')) {
        plans.push({ run, target: 'interrupted' });
        continue;
      }
      recoveryRunIds.push(run.id);
    }
    if (recoveryRunIds.length > 0) {
      return {
        ok: false,
        code: 'RECOVERY_REQUIRED',
        message: `Work ${work.id} has Runs whose side effects are unresolved; inspect them first`,
        recoveryRunIds,
      };
    }

    const previousStatus = work.status;
    const reason = input.reason ?? 'user paused the Work';
    const at = input.at ?? this.store.now();
    const paused = this.walkWorkTo(work, 'paused', 'pause', reason);
    const pausedRuns: PausedRunView[] = [];
    let attemptsClosed = 0;
    for (const plan of plans) {
      const stoppedAttemptIds = this.stopAttempts(plan.run.id, at);
      attemptsClosed += stoppedAttemptIds.length;
      const updatedRun = this.store.runs.update(
        plan.run.id,
        { status: plan.target },
        plan.run.version,
      );
      const checkpointRef = this.appendSnapshot(WORK_BARRIER_SNAPSHOT_TYPE, {
        kind: 'run_checkpoint',
        schemaVersion: FINDING_RECORD_VERSION,
        workId: work.id,
        runId: plan.run.id,
        previousStatus: plan.run.status,
        status: plan.target,
        stoppedAttemptIds: [...stoppedAttemptIds],
        reason,
        checkpointedAt: at,
      });
      pausedRuns.push({
        runId: updatedRun.id,
        previousStatus: plan.run.status,
        status: plan.target,
        stoppedAttemptIds,
        checkpointRef,
      });
    }
    const barrierRef = this.appendSnapshot(WORK_BARRIER_SNAPSHOT_TYPE, {
      kind: 'work_pause',
      schemaVersion: FINDING_RECORD_VERSION,
      workId: work.id,
      workVersion: paused.version,
      previousStatus,
      reason,
      pausedRuns: pausedRuns.map((entry) => ({
        runId: entry.runId,
        previousStatus: entry.previousStatus,
        status: entry.status,
      })),
      heldRunIds: [...heldRunIds],
      pausedAt: at,
    });
    this.store.events.append({
      name: 'work.control_changed',
      entityId: paused.id,
      entityVersion: paused.version,
      data: {
        workId: paused.id,
        control: 'pause',
        previousStatus,
        status: paused.status,
        reason,
        barrierRef,
        pausedRunIds: pausedRuns.map((entry) => entry.runId),
        heldRunIds: [...heldRunIds],
        attemptsClosed,
      },
    });
    return {
      ok: true,
      work: paused,
      previousStatus,
      pausedRuns,
      heldRunIds,
      attemptsClosed,
      barrierRef,
    };
  }

  resumeWork(input: ResumeWorkInput): ResumeWorkResult {
    return withTransaction(this.store.db, () => this.resumeTx(input));
  }

  private resumeTx(input: ResumeWorkInput): ResumeWorkResult {
    const work = this.store.works.find(input.workId);
    if (work === undefined) {
      return {
        ok: false,
        code: 'NOT_FOUND',
        message: `Work ${input.workId} does not exist`,
        currentVersion: null,
      };
    }
    if (work.status !== 'paused') {
      return {
        ok: false,
        code: 'INVALID_STATE',
        message: `Work ${work.id} is ${work.status}, not paused`,
        currentVersion: work.version,
      };
    }
    if (work.version !== input.expectedWorkVersion) {
      return {
        ok: false,
        code: 'VERSION_CONFLICT',
        message: `Work ${work.id} is at version ${work.version}, not ${input.expectedWorkVersion}`,
        currentVersion: work.version,
      };
    }
    // The pause barrier records the Work version the safe point was taken at; a
    // Work that moved while paused is a changed semantic baseline and must be
    // re-planned rather than silently resumed (`reliability.md` §6).
    const barrier = this.latestPauseBarrier(work.id);
    if (barrier !== undefined && barrier.workVersion !== work.version) {
      return {
        ok: false,
        code: 'VERSION_CONFLICT',
        message: `Work ${work.id} changed while paused (barrier ${barrier.workVersion}, now ${work.version}); re-plan before resuming`,
        currentVersion: work.version,
      };
    }
    const tasks = this.store.tasks.list({ where: 'work_id = ?', params: [work.id] });
    const taskVersions: { readonly taskId: string; readonly version: number }[] = [];
    for (const [taskId, expected] of Object.entries(input.expectedTaskVersions ?? {})) {
      const task = tasks.find((entry) => entry.id === taskId);
      if (task === undefined) {
        return {
          ok: false,
          code: 'NOT_FOUND',
          message: `Task ${taskId} does not exist in Work ${work.id}`,
          currentVersion: work.version,
        };
      }
      if (task.version !== expected) {
        return {
          ok: false,
          code: 'VERSION_CONFLICT',
          message: `Task ${taskId} is at version ${task.version}, not ${expected}`,
          currentVersion: work.version,
        };
      }
      taskVersions.push({ taskId, version: task.version });
    }
    // A Run whose side effects are unresolved needs a RecoveryDecision, not a fresh
    // Attempt (`workflow.md` §5.3, `reliability.md` §6). Refused before any resume
    // write so the Work is left exactly as the pause left it.
    const unresolved = this.store.runs
      .list({ where: 'work_id = ?', params: [work.id] })
      .filter((run) => !isTerminalRunStatus(run.status) && run.status === 'recovery_required');
    if (unresolved.length > 0) {
      return {
        ok: false,
        code: 'RECOVERY_REQUIRED',
        message: `Run ${unresolved.map((run) => run.id).join(', ')} needs a recovery decision before the Work resumes`,
        currentVersion: work.version,
      };
    }

    const resumed = this.walkWorkTo(work, 'running', 'resume', 'pause barrier released');
    const attempts: OpenedAttempt[] = [];
    const runs = this.store.runs.list({
      where: 'work_id = ?',
      params: [work.id],
      orderBy: 'created_at ASC',
    });
    for (const run of runs) {
      if (isTerminalRunStatus(run.status)) continue;
      if (run.status === 'paused') {
        // `RUN_TRANSITIONS` allows `paused → running` but not `paused → starting`,
        // so the resumed Run's new Attempt is appended directly: Attempt rows are
        // per-Run (`UNIQUE(run_id, number)`) with an incrementing epoch
        // (`reliability.md` §2).
        const running = this.store.runs.update(run.id, { status: 'running' }, run.version);
        const attempt = this.openAttempt(running);
        attempts.push({
          runId: running.id,
          attemptId: attempt.id,
          number: attempt.number,
          epoch: attempt.ownerEpoch,
        });
        continue;
      }
      if (run.status === 'interrupted' || run.status === 'recovery_required') {
        const attempt = this.lifecycle.beginAttempt(run.id);
        attempts.push({
          runId: run.id,
          attemptId: attempt.id,
          number: attempt.number,
          epoch: attempt.ownerEpoch,
        });
      }
    }
    this.store.events.append({
      name: 'work.control_changed',
      entityId: resumed.id,
      entityVersion: resumed.version,
      data: {
        workId: resumed.id,
        control: 'resume',
        previousStatus: 'paused',
        status: resumed.status,
        expectedWorkVersion: input.expectedWorkVersion,
        openedRunIds: attempts.map((entry) => entry.runId),
        barrierRef: barrier?.recordHash ?? null,
      },
    });
    return {
      ok: true,
      work: resumed,
      attempts,
      taskVersions,
      barrierRef: barrier?.recordHash ?? '',
    };
  }

  // -------------------------------------------------------------------------
  // Cancel (AC-021)
  // -------------------------------------------------------------------------

  cancelWork(input: CancelWorkInput): CancelWorkResult {
    return withTransaction(this.store.db, () => this.cancelTx(input));
  }

  private cancelTx(input: CancelWorkInput): CancelWorkResult {
    const work = this.store.works.find(input.workId);
    if (work === undefined) {
      return { ok: false, code: 'NOT_FOUND', message: `Work ${input.workId} does not exist` };
    }
    if (work.status === 'cancelled' || work.status === 'completed' || work.status === 'failed') {
      return {
        ok: false,
        code: 'INVALID_STATE',
        message: `Work ${work.id} is ${work.status} and cannot be cancelled`,
      };
    }
    const reason = input.reason ?? 'user cancelled the Work';
    const at = input.at ?? this.store.now();
    const before = this.store.runs.list({ where: 'work_id = ?', params: [work.id] });
    const unknownSideEffects =
      input.sideEffectsUnknown === true ||
      before.some((run) => !isTerminalRunStatus(run.status) && run.status === 'recovery_required');

    // 1. Enter `cancelling` first: no new dispatch is admitted from here on.
    const cancelling = this.walkWorkTo(work, 'cancelling', 'cancel', reason);
    const { cancelledRunIds, stoppedAttemptIds } = this.cancelRuns(work.id, at);
    const preservedArtifactIds = this.store.artifacts
      .list({ where: 'work_id = ?', params: [work.id], orderBy: 'created_at ASC' })
      .map((artifact) => artifact.id);

    let current = cancelling;
    let requirementStatus: RequirementState | null = null;
    let recoveryDecisionId: string | null = null;
    if (unknownSideEffects) {
      // 2a. `cancelling → blocked(recovery)`: the Requirement stays active until the
      // user closes the recovery decision (`reliability.md` §6).
      const decision = this.openRecoveryDecision(current, reason, at);
      recoveryDecisionId = decision.id;
      current = this.walkWorkTo(current, 'blocked', 'cancel', reason);
      current = this.store.works.update(
        current.id,
        { blockerIds: [...current.blockerIds, decision.id] },
        current.version,
      );
    } else {
      // 2b. Safe to finish: `cancelling → cancelled`, artifacts kept, nothing integrated.
      current = this.walkWorkTo(current, 'cancelled', 'cancel', reason);
      requirementStatus = this.cancelRequirement(current, reason, at);
    }

    const recordRef = this.appendSnapshot(WORK_BARRIER_SNAPSHOT_TYPE, {
      kind: 'work_cancellation',
      schemaVersion: FINDING_RECORD_VERSION,
      workId: work.id,
      status: current.status,
      reason,
      sideEffectsUnknown: unknownSideEffects,
      cancelledRunIds: [...cancelledRunIds],
      stoppedAttemptIds: [...stoppedAttemptIds],
      preservedArtifactIds: [...preservedArtifactIds],
      integrated: false,
      recoveryDecisionId,
      recordedAt: at,
    });
    this.store.events.append({
      name: 'work.control_changed',
      entityId: current.id,
      entityVersion: current.version,
      data: {
        workId: work.id,
        control: 'cancel',
        status: current.status,
        reason,
        cancelledRunIds: [...cancelledRunIds],
        preservedArtifactIds: [...preservedArtifactIds],
        integrated: false,
        recoveryDecisionId,
        recordRef,
      },
    });

    return {
      ok: true,
      work: current,
      status: current.status,
      cancelledRunIds,
      stoppedAttemptIds,
      preservedArtifactIds,
      integrated: false,
      requirementStatus,
      recoveryRequired: unknownSideEffects,
      recoveryDecisionId,
      recordRef,
    };
  }

  resolveCancellation(input: ResolveCancellationInput): ResolveCancellationResult {
    return withTransaction(this.store.db, () => this.resolveTx(input));
  }

  private resolveTx(input: ResolveCancellationInput): ResolveCancellationResult {
    const work = this.store.works.find(input.workId);
    if (work === undefined) {
      return { ok: false, code: 'NOT_FOUND', message: `Work ${input.workId} does not exist` };
    }
    if (work.status !== 'blocked' && work.status !== 'cancelling') {
      return {
        ok: false,
        code: 'INVALID_STATE',
        message: `Work ${work.id} is ${work.status}; only a cancelling/recovery Work can be resolved`,
      };
    }
    const decision = this.store.decisions.find(input.decisionId);
    if (decision === undefined) {
      return {
        ok: false,
        code: 'NOT_FOUND',
        message: `Recovery decision ${input.decisionId} does not exist`,
      };
    }
    if (decision.workId !== work.id || decision.kind !== 'recovery') {
      return {
        ok: false,
        code: 'NOT_AUTHORIZED',
        message: `Decision ${decision.id} is not this Work's recovery decision`,
      };
    }
    if (!work.blockerIds.includes(decision.id) && work.status !== 'cancelling') {
      return {
        ok: false,
        code: 'NOT_AUTHORIZED',
        message: `Decision ${decision.id} is not an open blocker of Work ${work.id}`,
      };
    }
    const at = input.at ?? this.store.now();
    const resolved = this.store.decisions.update(
      decision.id,
      {
        state: input.disposition === 'resume' ? 'rejected' : 'accepted',
        choice: input.disposition,
      },
      decision.version,
    );
    const cleared = this.store.works.update(
      work.id,
      { blockerIds: work.blockerIds.filter((id) => id !== resolved.id) },
      work.version,
    );
    let current = cleared;
    let requirementStatus: RequirementState | null = null;
    let cancelledRunIds: readonly string[] = [];
    let stoppedAttemptIds: readonly string[] = [];
    if (input.disposition === 'resume') {
      current = this.walkWorkTo(
        current,
        'running',
        'recovery',
        'recovery decision resumed the Work',
      );
    } else {
      const cancelled = this.cancelRuns(work.id, at);
      cancelledRunIds = cancelled.cancelledRunIds;
      stoppedAttemptIds = cancelled.stoppedAttemptIds;
      current = this.walkWorkTo(
        current,
        'cancelled',
        'recovery',
        `recovery closed as ${input.disposition}`,
      );
      requirementStatus = this.cancelRequirement(
        current,
        `cancellation recovery closed as ${input.disposition}`,
        at,
      );
      this.store.events.append({
        name: 'work.control_changed',
        entityId: current.id,
        entityVersion: current.version,
        data: {
          workId: work.id,
          control: 'cancel',
          status: current.status,
          reason: input.disposition,
          cancelledRunIds: [...cancelledRunIds],
          stoppedAttemptIds: [...stoppedAttemptIds],
          integrated: false,
          recoveryDecisionId: resolved.id,
        },
      });
    }
    const preservedArtifactIds = this.store.artifacts
      .list({ where: 'work_id = ?', params: [work.id], orderBy: 'created_at ASC' })
      .map((artifact) => artifact.id);
    const recordRef = this.appendSnapshot(WORK_BARRIER_SNAPSHOT_TYPE, {
      kind: 'work_cancellation_resolution',
      schemaVersion: FINDING_RECORD_VERSION,
      workId: work.id,
      status: current.status,
      disposition: input.disposition,
      decisionId: resolved.id,
      preservedArtifactIds: [...preservedArtifactIds],
      integrated: false,
      recordedAt: at,
    });
    return {
      ok: true,
      work: current,
      status: current.status,
      cancelledRunIds,
      stoppedAttemptIds,
      preservedArtifactIds,
      integrated: false,
      requirementStatus,
      recoveryRequired: false,
      recoveryDecisionId: resolved.id,
      recordRef,
    };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private candidateOf(finding: Finding): FindingCandidate {
    return {
      state: finding.state,
      severity: finding.severity,
      targetKind: finding.targetKind,
      ...(finding.taskId === undefined ? {} : { taskId: finding.taskId }),
      reviewRunId: finding.reviewRunId,
      manifestId: finding.manifestId,
      blocking: finding.blocking,
    };
  }

  /**
   * The domain view of one verification Run.
   *
   * Independence is a fact read from the store, not a claim from the caller: the
   * Run must belong to the same Work, carry the verifying role, have completed,
   * differ from both the fixing Run and the Review that raised the Finding, and
   * have been created *after* the fix (so the evidence is of the post-fix tree).
   */
  private verificationRunOf(
    run: Run,
    expectedRole: 'review' | 'test',
    finding: Finding,
    fixRun: Run,
  ): VerificationRun {
    const completed = run.status === 'completed';
    const independent =
      completed &&
      run.workId === finding.workId &&
      run.role === expectedRole &&
      run.id !== finding.reviewRunId &&
      run.id !== fixRun.id &&
      run.createdAt > fixRun.createdAt;
    return {
      stage: expectedRole,
      reviewsCurrentRevision: independent,
      status: completed ? 'passed' : 'blocked',
    };
  }

  /** Marks every valid Review/Test artifact of a Work invalid. */
  private invalidateVerificationEvidence(workId: string, findingId: string): string[] {
    const rows = this.store.artifacts.list({
      where: "work_id = ? AND kind IN ('review','test') AND validity = 'valid'",
      params: [workId],
      orderBy: 'created_at ASC',
    });
    const invalidated: string[] = [];
    for (const artifact of rows) {
      this.artifacts.invalidate(
        artifact.id,
        `Finding ${findingId} returned the Work to development; this result is superseded`,
      );
      invalidated.push(artifact.id);
    }
    return invalidated;
  }

  /** Re-opens the targeted task, or the whole verification stage for a task-less target. */
  private reopenTasks(workId: string, finding: Finding): string[] {
    const taskIds = new Set<string>();
    if (finding.taskId !== undefined) {
      taskIds.add(finding.taskId);
    } else {
      // An integration/document Finding has no task of its own, so every task whose
      // result fed the invalidated Review/Test goes back to development.
      for (const task of this.store.tasks.list({ where: 'work_id = ?', params: [workId] })) {
        if (task.stage === 'review' || task.stage === 'test') taskIds.add(task.id);
      }
    }
    const reopened: string[] = [];
    for (const taskId of taskIds) {
      const task = this.store.tasks.find(taskId);
      if (task === undefined || task.workId !== workId) continue;
      if (!canTransitionTask(task.stage, 'develop')) continue;
      const updated = this.store.tasks.update(task.id, { stage: 'develop' }, task.version);
      reopened.push(updated.id);
    }
    return reopened;
  }

  /** Verifies an accepted `risk` Decision of the Work; refusal is a message. */
  private acceptedRiskDecision(
    decisionId: string,
    workId: string,
  ):
    | { readonly ok: true; readonly decision: Decision }
    | { readonly ok: false; readonly message: string } {
    const decision = this.store.decisions.find(decisionId);
    if (decision === undefined) {
      return { ok: false, message: `risk decision ${decisionId} does not exist` };
    }
    if (decision.workId !== workId) {
      return { ok: false, message: `risk decision ${decision.id} belongs to another Work` };
    }
    if (decision.kind !== 'risk') {
      return {
        ok: false,
        message: `decision ${decision.id} is ${decision.kind}, not a risk decision`,
      };
    }
    if (decision.state !== 'accepted') {
      return {
        ok: false,
        message: `risk decision ${decision.id} is ${decision.state}, not accepted`,
      };
    }
    return { ok: true, decision };
  }

  /** Stops every live Attempt of a Run; returns the ids it closed. */
  private stopAttempts(runId: string, at: string): string[] {
    const stopped: string[] = [];
    for (const attempt of this.store.attempts.list({ where: 'run_id = ?', params: [runId] })) {
      if (attempt.status !== 'starting' && attempt.status !== 'running') continue;
      if (!canTransitionAttempt(attempt.status, 'stopped')) continue;
      this.store.attempts.update(
        attempt.id,
        { status: 'stopped', heartbeatAt: at },
        attempt.version,
      );
      stopped.push(attempt.id);
    }
    return stopped;
  }

  /**
   * Cancels every non-terminal Run of a Work and reports the whole cascade.
   *
   * Cancelling a parent already takes its children down (`RunLifecycle.cancel`),
   * so the result is computed from the before/after states rather than from the
   * Runs this loop happened to call: a child that a parent's cascade cancelled is
   * still part of the Work's cancellation evidence.
   */
  private cancelRuns(
    workId: string,
    at: string,
  ): {
    readonly cancelledRunIds: readonly string[];
    readonly stoppedAttemptIds: readonly string[];
  } {
    const pending = this.store.runs
      .list({ where: 'work_id = ?', params: [workId], orderBy: 'created_at ASC' })
      .filter((run) => !isTerminalRunStatus(run.status));
    for (const snapshot of pending) {
      const run = this.store.runs.find(snapshot.id);
      if (run === undefined || isTerminalRunStatus(run.status)) continue;
      this.lifecycle.cancel(run.id);
    }
    const cancelledRunIds: string[] = [];
    const stoppedAttemptIds: string[] = [];
    for (const snapshot of pending) {
      const run = this.store.runs.find(snapshot.id);
      if (run === undefined || run.status !== 'cancelled') continue;
      cancelledRunIds.push(run.id);
      stoppedAttemptIds.push(...this.stopAttempts(run.id, at));
    }
    return { cancelledRunIds, stoppedAttemptIds };
  }

  /** Opens a pending user `recovery` Decision and returns it. */
  private openRecoveryDecision(work: Work, reason: string, at: string): Decision {
    return this.store.decisions.insert({
      workId: work.id,
      kind: 'recovery',
      targetRef: {
        id: work.id,
        version: work.version,
        hash: sha256(canonicalJson([work.id, 'recovery', reason, at])),
      },
      choices: ['resume', 'accept_cancel', 'abandon'],
      state: 'pending',
      actor: 'user',
      effectRefs: [],
    });
  }

  /** Cancels the bound Requirement when it is still active/queued. */
  private cancelRequirement(work: Work, reason: string, at: string): RequirementState | null {
    if (work.requirementId === undefined) return null;
    const requirement = this.store.requirements.find(work.requirementId);
    if (requirement === undefined) return null;
    if (requirement.lifecycle !== 'active' && requirement.lifecycle !== 'queued') {
      return requirement.lifecycle;
    }
    const updated = this.store.requirements.update(
      requirement.id,
      { lifecycle: 'cancelled', recordVersion: requirement.recordVersion + 1 },
      requirement.version,
    );
    this.store.events.append({
      name: 'requirement.changed',
      entityId: updated.id,
      entityVersion: updated.version,
      data: {
        workId: work.id,
        requirementId: updated.id,
        lifecycle: updated.lifecycle,
        reason,
        cancelledAt: at,
      },
    });
    return updated.lifecycle;
  }

  /** Appends one Attempt to a resumed Run (see `resumeTx`). */
  private openAttempt(run: Run): Attempt {
    const previous = this.store.attempts.list({ where: 'run_id = ?', params: [run.id] });
    const attempt = this.store.attempts.insert({
      runId: run.id,
      number: previous.length + 1,
      status: 'starting',
      ownerEpoch: previous.length,
    });
    this.store.events.append({
      name: 'run.started',
      entityId: run.id,
      entityVersion: run.version,
      data: { attemptId: attempt.id, number: attempt.number, resumed: true },
    });
    return attempt;
  }

  /** Walks a Work to `target` through documented transitions, logging each step. */
  private walkWorkTo(work: Work, target: WorkStatus, control: string, reason: string): Work {
    const path = statusPath(work.status, target);
    if (path === undefined) {
      throw new ProtocolError(
        'INVALID_STATE',
        `Work ${work.id} cannot move ${work.status} → ${target}`,
        { details: { workId: work.id, from: work.status, to: target } },
      );
    }
    let current = work;
    for (const status of path) {
      const previousStatus = current.status;
      current = this.store.works.update(current.id, { status }, current.version);
      this.store.events.append({
        name: 'work.control_changed',
        entityId: current.id,
        entityVersion: current.version,
        data: { workId: current.id, control, previousStatus, status, reason },
      });
    }
    return current;
  }

  /** The newest `work_pause` barrier of a Work, when one exists. */
  private latestPauseBarrier(
    workId: string,
  ): { readonly workVersion: number; readonly recordHash: string } | undefined {
    const rows = this.store.db
      .prepare('SELECT payload FROM snapshot WHERE type = ? ORDER BY rowid ASC')
      .all(WORK_BARRIER_SNAPSHOT_TYPE) as { payload: string }[];
    let found: { readonly workVersion: number; readonly recordHash: string } | undefined;
    for (const row of rows) {
      let payload: JsonObject;
      try {
        payload = JSON.parse(row.payload) as JsonObject;
      } catch {
        continue;
      }
      if (payload['kind'] !== 'work_pause' || payload['workId'] !== workId) continue;
      const workVersion = payload['workVersion'];
      if (typeof workVersion !== 'number') continue;
      found = { workVersion, recordHash: sha256(canonicalJson(payload)) };
    }
    return found;
  }

  /**
   * Freezes one barrier/evidence record in the immutable `snapshot` table.
   *
   * Raw SQL because `snapshot` is keyed by `(type, hash)` rather than `id` and has
   * no row version; the same payload under the same type is one row.
   */
  private appendSnapshot(type: 'checkpoint' | 'verification', payload: JsonObject): string {
    const serialized = canonicalJson(payload);
    const hash = sha256(serialized);
    this.store.db
      .prepare(
        'INSERT OR IGNORE INTO snapshot (type, hash, payload, blob_path, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(type, hash, serialized, `snapshots/${type}/${hash}.json`, this.store.now());
    return hash;
  }
}

/** A new Finding is always awaiting a new Review and Test (`workflow.md` §6). */
const NEW_BOTH = { requiresNewReview: true, requiresNewTest: true } as const;

/** Shortest path of legal Work transitions, or `undefined` when none exists. */
function statusPath(from: WorkStatus, to: WorkStatus): WorkStatus[] | undefined {
  if (from === to) return [];
  const queue: WorkStatus[][] = [[from]];
  const seen = new Set<WorkStatus>([from]);
  while (queue.length > 0) {
    const path = queue.shift();
    if (path === undefined) break;
    const last = path[path.length - 1];
    if (last === undefined) continue;
    for (const status of workStatusSchema.options) {
      if (seen.has(status) || !canTransitionWork(last, status)) continue;
      const next = [...path, status];
      if (status === to) return next.slice(1);
      seen.add(status);
      queue.push(next);
    }
  }
  return undefined;
}

/** A `Ref` as plain JSON, so it survives `snapshot.payload`. */
function refJson(ref: Ref): JsonObject {
  return { id: ref.id, version: ref.version, hash: ref.hash };
}
