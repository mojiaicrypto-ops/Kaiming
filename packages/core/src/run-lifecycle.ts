/**
 * Run lifecycle and Work-budget reservation.
 *
 * Every path that moves a Run into a terminal state goes through this class, which
 * is what makes the budget invariant hold: a reservation is released exactly when
 * the Run it belongs to ends, however it ends — completion, failure or a
 * `contract_violation` from `stage.submit` (`reliability.md` §3). Supervision,
 * heartbeats and recovery build on these rows in WP-05.
 */
import type { Attempt, Budget, JsonObject, Run, RunStatus } from '@agentdev/contracts';
import { canTransitionRun } from '@agentdev/domain';
import { withTransaction, type ProjectStore } from '@agentdev/storage';
import { ProtocolError, type ProtocolErrorCode } from './errors.js';

/** Run states in which a Chief Run may still accept a new professional child. */
export const ACTIVE_PARENT_STATUSES: readonly RunStatus[] = [
  'queued',
  'starting',
  'running',
  'waiting_children',
];

/** Terminal states a caller may settle a Run into. */
export type TerminalRunStatus = Extract<Run['status'], 'completed' | 'failed' | 'cancelled'>;

function fail(code: ProtocolErrorCode, message: string, details?: JsonObject): never {
  throw new ProtocolError(code, message, details === undefined ? {} : { details });
}

export class RunLifecycle {
  private readonly store: ProjectStore;

  constructor(options: { readonly store: ProjectStore }) {
    this.store = options.store;
  }

  /** The Work's own budget row (`work.budgetId`), never another Work's. */
  budgetOf(workId: string): Budget {
    const work = this.store.works.find(workId);
    if (work === undefined) fail('NOT_FOUND', `Work ${workId} does not exist`);
    const budget = this.store.budgets.find(work.budgetId);
    if (budget === undefined) {
      fail('INTERNAL_ERROR', `Work ${workId} references missing budget ${work.budgetId}`, {
        workId,
        budgetId: work.budgetId,
      });
    }
    return budget;
  }

  /**
   * Reserves tokens for a Run before it is queued (`reliability.md` §3).
   *
   * The admission decision (`canAllocateBudget`) is made by the caller inside the
   * same transaction, so this only performs the atomic increment that a Schema
   * invariant guards: `used + reserved <= limit`.
   */
  reserve(workId: string, allocation: number): void {
    if (allocation === 0) return;
    const budget = this.budgetOf(workId);
    this.store.budgets.update(
      budget.id,
      { tokensReserved: budget.tokensReserved + allocation },
      budget.version,
    );
  }

  release(workId: string, allocation: number): void {
    if (allocation === 0) return;
    const budget = this.budgetOf(workId);
    if (budget.tokensReserved === 0) return;
    this.store.budgets.update(
      budget.id,
      { tokensReserved: Math.max(0, budget.tokensReserved - allocation) },
      budget.version,
    );
  }

  /**
   * Starts an Attempt for a queued Run.
   *
   * The documented path is `queued → starting → running` (`workflow.md` §5.3); a
   * Run that cannot legally start is refused before an Attempt row exists.
   */
  beginAttempt(runId: string, options: { readonly runnerId?: string } = {}): Attempt {
    const run = this.requireRun(runId);
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
   * Moves a Run to a terminal state, releasing its budget reservation.
   *
   * The terminal event carries the real outcome: clients must not render every
   * `run.ended` as a success (`protocol.md` §7).
   */
  settle(runId: string, status: TerminalRunStatus): Run {
    return this.end(runId, status, (run) => ({ outcome: status, workId: run.workId }));
  }

  /**
   * Ends a Run as a contract violation (`protocol.md` §6: two non-compliant
   * submissions in a row).
   *
   * This is the same terminal path as `settle`, so the reservation is released
   * here too — otherwise one violation would hold the Work budget forever.
   */
  contractViolation(
    runId: string,
    input: { readonly attemptId: string; readonly reason: string; readonly rejections: number },
  ): Run {
    return this.end(runId, 'contract_violation', () => ({
      outcome: 'contract_violation',
      attemptId: input.attemptId,
      rejections: input.rejections,
      reason: input.reason,
    }));
  }

  private end(runId: string, status: RunStatus, data: (run: Run) => Record<string, unknown>): Run {
    const run = this.requireRun(runId);
    if (!canTransitionRun(run.status, status)) {
      fail('VALIDATION_ERROR', `Run ${run.id} cannot move ${run.status} → ${status}`, {
        runId: run.id,
        status: run.status,
      });
    }
    return withTransaction(this.store.db, () => {
      const updated = this.store.runs.update(run.id, { status }, run.version);
      this.release(updated.workId, run.budgetAllocation);
      this.store.events.append({
        name: 'run.ended',
        entityId: updated.id,
        entityVersion: updated.version,
        data: { ...data(updated), releasedTokens: run.budgetAllocation },
      });
      return updated;
    });
  }

  /** Whether a Chief Run may still take a new professional child. */
  static canParentDispatch(status: RunStatus): boolean {
    return ACTIVE_PARENT_STATUSES.includes(status);
  }

  private requireRun(runId: string): Run {
    const run = this.store.runs.find(runId);
    if (run === undefined) fail('NOT_FOUND', `Run ${runId} does not exist`, { runId });
    return run;
  }
}
