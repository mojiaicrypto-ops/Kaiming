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
import { canTransitionRun, isTerminalRunStatus } from '@agentdev/domain';
import { withTransaction, type ProjectStore } from '@agentdev/storage';
import { ProtocolError, type ProtocolErrorCode } from './errors.js';

/** Run states in which a Chief Run may still accept a new professional child. */
export const ACTIVE_PARENT_STATUSES: readonly RunStatus[] = [
  'queued',
  'starting',
  'running',
  'waiting_children',
];

/**
 * What a Run actually consumed.
 *
 * `measured: false` means no provider usage report was available; the amount is
 * still charged as zero but the event records the distinction (DC-41).
 */
export interface RunUsage {
  readonly tokensUsed: number;
  readonly measured: boolean;
}

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
   * Moves a Run to a terminal state.
   *
   * `usage` is the tokens the Run actually consumed. It is charged against the
   * Work budget (`tokensUsed`) and only the remainder of the reservation is
   * released (`reliability.md` §3: "扣除实际usage并释放剩余"). A caller that has
   * no measurement must say so explicitly by passing `measured: false`, which is
   * recorded on the event instead of being presented as a real zero (DC-41).
   */
  settle(
    runId: string,
    status: TerminalRunStatus,
    usage: RunUsage = { tokensUsed: 0, measured: false },
  ): Run {
    return this.end(runId, status, (run) => ({ outcome: status, workId: run.workId }), usage);
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

  private end(
    runId: string,
    status: RunStatus,
    data: (run: Run) => Record<string, unknown>,
    usage: RunUsage = { tokensUsed: 0, measured: false },
  ): Run {
    const run = this.requireRun(runId);
    if (!canTransitionRun(run.status, status)) {
      fail('VALIDATION_ERROR', `Run ${run.id} cannot move ${run.status} → ${status}`, {
        runId: run.id,
        status: run.status,
      });
    }
    this.requireNoLiveChildren(run, status);
    return withTransaction(this.store.db, () => {
      const updated = this.store.runs.update(run.id, { status }, run.version);
      if (usage.measured) {
        // Measured: release the whole reservation, then charge what was really
        // used — keeping the usage inside `reserved` would double-count it.
        this.release(updated.workId, run.budgetAllocation);
        this.charge(updated.workId, usage.tokensUsed);
      } else {
        // Unknown usage keeps the hold and marks the Work cost-unknown
        // (`reliability.md` §3); `reconcile` releases it once usage is known.
        this.markCostUnknown(updated.workId);
      }
      this.store.events.append({
        name: 'run.ended',
        entityId: updated.id,
        entityVersion: updated.version,
        data: {
          ...data(updated),
          tokensUsed: usage.measured ? usage.tokensUsed : 0,
          usageMeasured: usage.measured,
          costKnown: usage.measured,
          releasedTokens: usage.measured ? run.budgetAllocation : 0,
        },
      });
      return updated;
    });
  }

  /**
   * A parent may not end while `join=all` children are still live.
   *
   * Otherwise those children settle into a Join nobody owns, and a Gate block
   * would page a Run that already finished (AC-046). Cancellation is the
   * documented exception: it propagates to the live children (`agents.md` §3).
   */
  private requireNoLiveChildren(run: Run, status: RunStatus): void {
    const live = this.store.runs
      .list({ where: 'parent_run_id = ?', params: [run.id] })
      .filter((child) => child.join === 'all' && !isTerminalRunStatus(child.status));
    if (live.length === 0 || status === 'cancelled') return;
    fail('INVALID_STATE', `Run ${run.id} still has ${String(live.length)} live join=all children`, {
      runId: run.id,
      pending: live.map((child) => child.id),
    });
  }

  /**
   * Cancels a Run and its non-terminal children (`agents.md` §3).
   *
   * Cancellation is the one terminal transition allowed to override the live
   * children guard, and it takes them with it.
   */
  cancel(runId: string): Run {
    const run = this.requireRun(runId);
    const live = this.store.runs
      .list({ where: 'parent_run_id = ?', params: [run.id] })
      .filter((child) => !isTerminalRunStatus(child.status));
    for (const child of live) {
      if (canTransitionRun(child.status, 'cancelled')) {
        this.end(child.id, 'cancelled', () => ({ outcome: 'cancelled', workId: child.workId }), {
          tokensUsed: 0,
          measured: false,
        });
      }
    }
    return this.end(run.id, 'cancelled', () => ({ outcome: 'cancelled', workId: run.workId }), {
      tokensUsed: 0,
      measured: false,
    });
  }

  /**
   * Settles a Run whose real usage only became available after it ended.
   *
   * `reliability.md` §3: unknown usage keeps the hold and marks `costKnown=false`;
   * the result is reconciled once the Provider usage report is readable. The
   * caller is that reconciliation path (WP-10).
   */
  reconcile(runId: string, usage: { readonly tokensUsed: number; readonly cost?: number }): Run {
    const run = this.requireRun(runId);
    if (!isTerminalRunStatus(run.status)) {
      fail('INVALID_STATE', `Run ${run.id} is ${run.status}; usage cannot be reconciled yet`, {
        runId: run.id,
        status: run.status,
      });
    }
    return withTransaction(this.store.db, () => {
      this.release(run.workId, run.budgetAllocation);
      this.charge(run.workId, usage.tokensUsed, usage.cost);
      this.store.events.append({
        name: 'run.ended',
        entityId: run.id,
        entityVersion: run.version,
        data: {
          outcome: run.status,
          workId: run.workId,
          reconciled: true,
          tokensUsed: usage.tokensUsed,
          usageMeasured: true,
          costKnown: true,
          releasedTokens: run.budgetAllocation,
        },
      });
      return this.requireRun(run.id);
    });
  }

  private markCostUnknown(workId: string): void {
    const budget = this.budgetOf(workId);
    if (!budget.costKnown) return;
    this.store.budgets.update(budget.id, { costKnown: false }, budget.version);
  }

  /**
   * Moves measured usage from the reservation into `tokensUsed`.
   *
   * The Work schema invariant (`used + reserved <= limit`) still holds: the
   * reservation was released first and the measured usage is at most it.
   */
  private charge(workId: string, tokensUsed: number, cost?: number): void {
    const budget = this.budgetOf(workId);
    this.store.budgets.update(
      budget.id,
      {
        tokensUsed: budget.tokensUsed + Math.max(0, tokensUsed),
        costKnown: true,
        ...(cost === undefined ? {} : { cost: (budget.cost ?? 0) + cost }),
      },
      budget.version,
    );
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
