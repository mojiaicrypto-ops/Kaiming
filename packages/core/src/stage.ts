/**
 * Structured delivery: the `stage.submit` contract (`rules/agents.md` §4, AC-047).
 *
 * A Run delivers through the shared Schema or not at all — a spoken success cannot
 * stand in for it. The correction rule is deliberate: the first Schema failure is
 * answered with a request to correct, and a second failure on the same Attempt is
 * a `contract_violation` that ends the Run. The count is derived from the event
 * log, not from memory, so it survives a restart.
 */
import {
  stageResultContentSchema,
  type CheckResult,
  type StageResultContent,
  type StageResultRow,
} from '@agentdev/contracts';
import { canTransitionRun } from '@agentdev/domain';
import { withTransaction, type ProjectStore } from '@agentdev/storage';
import { ProtocolError } from './errors.js';
import { scanEvents } from './events.js';
import { RunLifecycle } from './run-lifecycle.js';
import type { ReadLedgerRegistry } from './read-ledger.js';
import type { TestEvidenceReader } from './test-environment.js';

/** Server-owned fields a client must never set on `stage.submit`. */
export const OWNERSHIP_FIELDS = [
  'id',
  'projectId',
  'version',
  'createdAt',
  'updatedAt',
  'runId',
  'attemptId',
  'taskId',
] as const;

/** Fields an Attempt may set; the rest are derived from the Run by Core. */
export const STAGE_SUBMIT_FIELDS = [
  'status',
  'summary',
  'artifactRefs',
  'evidenceRefs',
  'changedPaths',
  'findingIds',
  'unknowns',
  'requestedActions',
  'readLedgerSeq',
  'readLedgerHash',
  'manifestId',
  'checkResult',
] as const;

export interface StageSubmitInput {
  readonly runId: string;
  readonly attemptId: string;
  /** Attempt epoch from the capability (`protocol.md` §6 mandatory parameter). */
  readonly epoch: number;
  /** Optimistic version of the Run, when the caller has one. */
  readonly expectedVersion?: number;
  readonly payload: unknown;
}

export type StageSubmitResult =
  | { readonly accepted: true; readonly row: StageResultRow }
  | {
      readonly accepted: false;
      readonly code: 'VALIDATION_ERROR';
      readonly message: string;
      /** The Attempt may submit once more; a second failure is a violation. */
      readonly correctionsRemaining: 1;
    }
  | {
      readonly accepted: false;
      readonly code: 'CONTRACT_VIOLATION';
      readonly message: string;
      readonly runStatus: 'contract_violation';
      readonly rejections: number;
    };

type ContractSchema<T> = {
  safeParse(value: unknown):
    | { readonly success: true; readonly data: T }
    | {
        readonly success: false;
        readonly error: {
          readonly issues: readonly { path: PropertyKey[]; message: string }[];
        };
      };
};

function issuesOf(error: {
  readonly issues: readonly { path: PropertyKey[]; message: string }[];
}): string {
  return error.issues
    .map((issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
}

/**
 * A one-line summary of executed Test evidence for a refusal message.
 *
 * The model that claimed success needs the real commands and exit codes to correct
 * itself honestly; the summary is therefore the evidence itself, not a re-description.
 */
function describeExecutedCheck(checkResult: CheckResult): string {
  if (checkResult.checks.length === 0) {
    const uncovered = checkResult.uncovered.map((entry) => entry.reason).join('; ');
    return uncovered === '' ? 'no executed check was recorded' : uncovered;
  }
  return checkResult.checks
    .map(
      (check) =>
        `${check.command ?? check.procedure ?? 'check'} → exit ${String(check.exitCode ?? 'n/a')}`,
    )
    .join('; ');
}

export class StageGate {
  private readonly store: ProjectStore;
  private readonly lifecycle: RunLifecycle;
  /** The Attempt read ledgers, when the stack has the tool bridge (`AC-085`). */
  private readonly readLedgers: ReadLedgerRegistry | undefined;
  /**
   * The executed Test evidence of the live Attempts (WP-12 W5).
   *
   * When it is wired, a `test` Run's stage result can only be recorded with the
   * `CheckResult` Core really produced by executing the project's declared commands
   * (`execution.md` §5, `workflow.md` §3): the model's own `checkResult` is replaced,
   * and a `success` claim without a `passed` executed result is refused. Absent means
   * the stack has no executor — the library-level stage gate stays usable, and the
   * production stack always wires it (`execution.ts`).
   */
  private readonly testEvidence: TestEvidenceReader | undefined;

  constructor(options: {
    readonly store: ProjectStore;
    readonly lifecycle?: RunLifecycle;
    /** Supplied by the execution stack so `stage.submit` can verify the read seal. */
    readonly readLedgers?: ReadLedgerRegistry;
    /** Supplied by the execution stack; see {@link StageGate.testEvidence}. */
    readonly testEvidence?: TestEvidenceReader;
  }) {
    this.store = options.store;
    this.lifecycle = options.lifecycle ?? new RunLifecycle({ store: options.store });
    this.readLedgers = options.readLedgers;
    this.testEvidence = options.testEvidence;
  }

  /**
   * Accepts one `stage.submit`.
   *
   * Ownership is never taken from the payload: `runId`/`attemptId` come from the
   * capability, and `taskId` from the Run, so a client cannot claim another Run's
   * delivery.
   */
  submit(input: StageSubmitInput): StageSubmitResult {
    const run = this.store.runs.find(input.runId);
    if (run === undefined) {
      throw new ProtocolError('NOT_FOUND', `Run ${input.runId} does not exist`, {});
    }
    const attempt = this.store.attempts.find(input.attemptId);
    if (attempt === undefined || attempt.runId !== run.id) {
      throw new ProtocolError('NOT_AUTHORIZED', 'the attempt does not belong to this Run', {
        details: { runId: run.id, attemptId: input.attemptId },
      });
    }
    // Only an executing Run accepts delivery. Terminal Runs are history
    // (`workflow.md` §5.3) and `paused`/`waiting_permission`/`interrupted`/
    // `recovery_required` Runs must not be rewritten by a late Attempt
    // (`reliability.md` §2); both are refused before anything is written (N-02).
    if (run.status !== 'running') {
      throw new ProtocolError(
        'INVALID_STATE',
        `Run ${run.id} is ${run.status}; only a running Run accepts stage results`,
        { details: { runId: run.id, status: run.status } },
      );
    }
    if (attempt.ownerEpoch !== input.epoch) {
      throw new ProtocolError(
        'STALE_ARTIFACT',
        `attempt epoch ${input.epoch} is not the current epoch ${attempt.ownerEpoch}`,
        { details: { attemptId: attempt.id, expectedEpoch: attempt.ownerEpoch } },
      );
    }
    if (attempt.status !== 'starting' && attempt.status !== 'running') {
      throw new ProtocolError(
        'INVALID_STATE',
        `Attempt ${attempt.id} is ${attempt.status} and cannot submit`,
        { details: { attemptId: attempt.id, status: attempt.status } },
      );
    }
    const latest = this.store.attempts.list({
      where: 'run_id = ?',
      params: [run.id],
      orderBy: 'number DESC',
      limit: 1,
    })[0];
    if (latest !== undefined && latest.id !== attempt.id) {
      throw new ProtocolError(
        'STALE_ARTIFACT',
        `Attempt ${attempt.id} was superseded by ${latest.id}`,
        { details: { attemptId: attempt.id, currentAttemptId: latest.id } },
      );
    }
    if (input.expectedVersion !== undefined && input.expectedVersion !== run.version) {
      throw new ProtocolError(
        'VERSION_CONFLICT',
        `expected Run version ${input.expectedVersion} but found ${run.version}`,
        { details: { runId: run.id, version: run.version } },
      );
    }

    const payload = input.payload;
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
      return this.reject(run.id, attempt.id, 'stage.submit expects an object');
    }
    // Forged ownership is a protocol failure, not a correctable typo: the client
    // must not set who a delivery belongs to (`data.md` §3).
    const forged = Object.keys(payload).filter((key) =>
      (OWNERSHIP_FIELDS as readonly string[]).includes(key),
    );
    if (forged.length > 0) {
      throw new ProtocolError(
        'NOT_AUTHORIZED',
        `stage.submit must not set ${forged.join(', ')}; ownership comes from the capability`,
        { details: { runId: run.id, attemptId: attempt.id, forged } },
      );
    }
    const unexpected = Object.keys(payload).filter(
      (key) => !(STAGE_SUBMIT_FIELDS as readonly string[]).includes(key),
    );
    if (unexpected.length > 0) {
      return this.reject(run.id, attempt.id, `unexpected fields: ${unexpected.join(', ')}`);
    }

    // `workflow.md` §3/§6 makes the Test stage the route's executed evidence, and
    // `execution.md` §7 keeps the Test model shell-less, so the `CheckResult` cannot come
    // from the model. When the stack wired an executor, Core's own result is the only one
    // that may be recorded and a `success` claim must be supported by it (WP-12 W5).
    const effectivePayload = this.effectiveTestPayload(run, attempt, payload);

    const parsed = (
      stageResultContentSchema as unknown as ContractSchema<StageResultContent>
    ).safeParse(effectivePayload);
    if (!parsed.success) {
      return this.reject(run.id, attempt.id, issuesOf(parsed.error));
    }
    // `AC-085`: the reported `readLedgerSeq`/`readLedgerHash` must be the binding of the
    // reads this Attempt really made. Core recomputes it (`ReadLedgerRegistry.verify`) and
    // refuses a disagreement instead of storing a claim it cannot confirm. A stack without
    // the tool bridge has no ledger and therefore nothing to verify (registered gap).
    if (this.readLedgers !== undefined) {
      const verdict = this.readLedgers.verify({
        attemptId: attempt.id,
        seq: parsed.data.readLedgerSeq,
        hash: parsed.data.readLedgerHash,
      });
      if (!verdict.ok) {
        throw new ProtocolError(verdict.code, verdict.message, {
          details: {
            attemptId: attempt.id,
            readLedgerSeq: parsed.data.readLedgerSeq,
            readLedgerHash: parsed.data.readLedgerHash,
          },
        });
      }
      // The delivery is sealed against exactly these reads; a later read cannot change what
      // it was verified against (`AC-085`).
      this.readLedgers.seal(attempt.id);
    }

    return withTransaction(this.store.db, () => {
      const row = this.store.stageResults.insert({
        ...parsed.data,
        runId: run.id,
        attemptId: attempt.id,
        ...(run.taskId === undefined ? {} : { taskId: run.taskId }),
      });
      // `protocol.md` §7 fixes the persistent names: a successful delivery is
      // `stage.completed`, anything else is `stage.failed`, each with its outcome.
      this.store.events.append({
        name: row.status === 'success' ? 'stage.completed' : 'stage.failed',
        entityId: run.id,
        entityVersion: run.version,
        data: {
          attemptId: attempt.id,
          stageResultId: row.id,
          outcome: row.status,
          changedPaths: row.changedPaths.length,
          evidenceRefs: row.evidenceRefs.length,
          readLedgerSeq: row.readLedgerSeq,
        },
      });
      return { accepted: true as const, row };
    });
  }

  /**
   * The payload a Test Attempt may actually record, with Core's executed evidence bound.
   *
   * `workflow.md` §6: "报告不能以'应该通过'代替执行" — a Test result whose success rests on
   * the model's own judgement is exactly that. When the stack wired an executor
   * (`execution.ts`), this method
   *
   * - refuses while the declared commands are still running (`GATE_NOT_READY`: retry the
   *   tool call) rather than recording an unverifiable result,
   * - refuses a `success` that the executed evidence does not support, naming the real
   *   exit codes so the model can deliver an honest `failed`/`needs_input`, and
   * - replaces whatever `checkResult` the payload carried with Core's executed one, so the
   *   persisted evidence is the command's real command/exit code/output, never a claim.
   *
   * A stack without an executor keeps the previous behaviour; the production stack always
   * supplies one.
   */
  private effectiveTestPayload(
    run: { readonly id: string; readonly role: string },
    attempt: { readonly id: string },
    payload: object,
  ): object {
    if (run.role !== 'test' || this.testEvidence === undefined) return payload;
    const evidence = this.testEvidence.get(attempt.id);
    if (evidence === undefined) {
      // `execution.md` §5 / `data.md` §3 W5: the executed evidence is produced by Core for one
      // live Attempt and read back when that Attempt delivers. It is deliberately
      // **Attempt-scoped and in-memory** (`test-environment.ts` `TestEvidenceRegistry`): a
      // daemon restart loses it, and the durable half of the evidence is the `evidence`
      // Artifact, the `test.command_executed` audit event and the `stage_result` that is only
      // written once this gate accepts. Persisting the verdict across a restart would let a
      // dead Attempt's evidence stand in for a new one, which `reliability.md` §2 (late
      // events) and §6 (recovery opens a new Attempt) forbid. The refusal therefore says
      // exactly that instead of reporting a command that is not running.
      throw new ProtocolError(
        'GATE_NOT_READY',
        `Run ${run.id} has no executed acceptance evidence registered for Attempt ${attempt.id} in this daemon process: either the declared commands have not started yet (the Attempt has not reported ready) or the daemon that executed them restarted. The evidence is Attempt-scoped and not persisted, so it does not survive a restart; this Attempt can only be re-run (a new Attempt re-executes policy.testCommands) or deliver needs_input/failed. A success cannot be recorded without it (execution.md §5).`,
        { details: { runId: run.id, attemptId: attempt.id, evidence: 'missing' } },
      );
    }
    if (evidence.state === 'pending') {
      throw new ProtocolError(
        'GATE_NOT_READY',
        `Run ${run.id} is still executing the project's declared acceptance commands; the executed evidence is not ready, so no stage result is recorded yet. Call stage_yield again when the commands finish.`,
        { details: { runId: run.id, attemptId: attempt.id, evidence: 'pending' } },
      );
    }
    const checkResult = evidence.checkResult;
    const claimed = (payload as Record<string, unknown>)['status'];
    if (claimed === 'success' && checkResult.status !== 'passed') {
      throw new ProtocolError(
        'GATE_NOT_READY',
        `Run ${run.id} claims success, but the executed acceptance evidence is ${checkResult.status}: ${describeExecutedCheck(checkResult)}. A Test stage records success only when the real commands passed; report needs_input/failed with the observed outcome instead.`,
        {
          details: {
            runId: run.id,
            attemptId: attempt.id,
            evidence: checkResult.status,
          },
        },
      );
    }
    return { ...payload, checkResult };
  }

  /**
   * Schema rejections already recorded for this Attempt, from the event log.
   *
   * Scanned to the end of the log (not the first page): the two-strike rule in
   * `protocol.md` §6 must not degrade into "unlimited strikes" once the log grows.
   */
  rejections(attemptId: string): number {
    return scanEvents(this.store, { names: ['stage.failed'] }).filter(
      (event) =>
        event.data['attemptId'] === attemptId && event.data['outcome'] === 'schema_invalid',
    ).length;
  }

  /**
   * Records a Schema rejection; the second one is a contract violation.
   *
   * The Run only leaves `running` for `contract_violation` when the documented
   * transition allows it, and the failure is reported rather than downgraded
   * otherwise.
   */
  private reject(runId: string, attemptId: string, message: string): StageSubmitResult {
    return withTransaction(this.store.db, () => {
      const run = this.store.runs.find(runId);
      if (run === undefined) {
        throw new ProtocolError('NOT_FOUND', `Run ${runId} does not exist`, {});
      }
      const prior = this.rejections(attemptId);
      const rejection = prior + 1;
      this.store.events.append({
        name: 'stage.failed',
        entityId: run.id,
        entityVersion: run.version,
        data: {
          attemptId,
          outcome: 'schema_invalid',
          reason: message,
          rejection,
          correctionsRemaining: rejection === 1 ? 1 : 0,
        },
      });
      if (prior === 0) {
        return {
          accepted: false as const,
          code: 'VALIDATION_ERROR' as const,
          message,
          correctionsRemaining: 1 as const,
        };
      }
      if (!canTransitionRun(run.status, 'contract_violation')) {
        throw new ProtocolError(
          'VALIDATION_ERROR',
          `Run ${run.id} cannot record a contract violation from ${run.status}`,
          { details: { runId: run.id, status: run.status } },
        );
      }
      // The shared terminal path records the violation and keeps the Work
      // reservation held as unknown cost (`reliability.md` §3, DC-45); a live
      // join=all child is cancelled with its parent (DC-49).
      this.lifecycle.contractViolation(run.id, {
        attemptId,
        reason: message,
        rejections: rejection,
      });
      return {
        accepted: false as const,
        code: 'CONTRACT_VIOLATION' as const,
        message,
        runStatus: 'contract_violation' as const,
        rejections: rejection,
      };
    });
  }
}
