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
  type StageResultContent,
  type StageResultRow,
} from '@agentdev/contracts';
import { canTransitionRun, isTerminalRunStatus } from '@agentdev/domain';
import { withTransaction, type ProjectStore } from '@agentdev/storage';
import { ProtocolError } from './errors.js';

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

export class StageGate {
  private readonly store: ProjectStore;

  constructor(options: { readonly store: ProjectStore }) {
    this.store = options.store;
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
    // A terminal Run never accepts more evidence (`workflow.md` §5.3), and a late
    // or superseded Attempt may not rewrite it (`reliability.md` §2) — both are
    // checked before anything is written.
    if (isTerminalRunStatus(run.status)) {
      throw new ProtocolError(
        'INVALID_STATE',
        `Run ${run.id} is ${run.status} and accepts no further stage results`,
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

    const parsed = (
      stageResultContentSchema as unknown as ContractSchema<StageResultContent>
    ).safeParse(payload);
    if (!parsed.success) {
      return this.reject(run.id, attempt.id, issuesOf(parsed.error));
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

  /** Schema rejections already recorded for this Attempt, from the event log. */
  rejections(attemptId: string): number {
    return this.store.events
      .readAfter(0, { limit: 10_000, names: ['stage.failed'] })
      .filter(
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
      const updated = this.store.runs.update(run.id, { status: 'contract_violation' }, run.version);
      this.store.events.append({
        name: 'run.ended',
        entityId: updated.id,
        entityVersion: updated.version,
        data: { attemptId, outcome: 'contract_violation', rejections: rejection, reason: message },
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
