/**
 * Run lifecycle and Work-budget reservation.
 *
 * Every path that moves a Run into a terminal state goes through this class, so
 * the budget rules of `reliability.md` §3 hold no matter how a Run ends:
 *
 * - measured usage releases the reservation and charges `tokensUsed`;
 * - unknown usage keeps the hold and marks the Work `costKnown=false`, to be
 *   released later by `reconcile` (the Provider-usage path, WP-10);
 * - a parent never leaves `join=all` children behind that nobody can join:
 *   graceful completion is refused while they are live, while abnormal terminal
 *   states (`failed`, `contract_violation`, `cancelled`) take them down too
 *   (`agents.md` §3).
 *
 * Supervision, heartbeats and crash recovery build on these rows in WP-05.
 */
import type { Attempt, Budget, Event, JsonObject, Run, RunStatus } from '@agentdev/contracts';
import { canTransitionRun, isTerminalRunStatus } from '@agentdev/domain';
import { withTransaction, type ProjectStore } from '@agentdev/storage';
import { ProtocolError, type ProtocolErrorCode } from './errors.js';
import { findEvent, scanEvents } from './events.js';

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
 * `measured: true` means a Provider usage report was available. `measured: false`
 * is the honest "unknown": the hold stays and the Work is marked
 * `costKnown=false` (`reliability.md` §3) — it is never presented as a real zero.
 */
export interface RunUsage {
  readonly tokensUsed: number;
  readonly measured: boolean;
  /** Provider-reported cost, when available (`data.md` §2 `budget.cost`). */
  readonly cost?: number;
}

/** Terminal states a caller may settle a Run into. */
export type TerminalRunStatus = Extract<Run['status'], 'completed' | 'failed' | 'cancelled'>;

/** Abnormal terminal states: they take live children down with them. */
const ABNORMAL_STATUSES: readonly RunStatus[] = ['failed', 'cancelled', 'contract_violation'];

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
    if (allocation <= 0) return;
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
   * Cancellation is the same operation as `cancel` (it propagates to the live
   * children), so a caller cannot end a parent and leave orphans behind.
   */
  settle(
    runId: string,
    status: TerminalRunStatus,
    usage: RunUsage = { tokensUsed: 0, measured: false },
  ): Run {
    validateUsage(usage);
    // Cancellation goes through the propagating path, but a measured usage report
    // for the cancelled Run is still booked (R6-03).
    if (status === 'cancelled') return this.cancel(runId, usage);
    return this.end(runId, status, (run) => ({ outcome: status, workId: run.workId }), usage);
  }

  /**
   * Ends a Run as a contract violation (`protocol.md` §6: two non-compliant
   * submissions in a row).
   *
   * The usage is unknown at this point, so the reservation stays held and the Work
   * is marked `costKnown=false` (`reliability.md` §3); `reconcile` releases it. A
   * violation is an abnormal end, so live children are cancelled with it instead
   * of being left in a Join nobody owns.
   */
  contractViolation(
    runId: string,
    input: { readonly attemptId: string; readonly reason: string; readonly rejections: number },
  ): Run {
    return this.end(
      runId,
      'contract_violation',
      () => ({
        outcome: 'contract_violation',
        attemptId: input.attemptId,
        rejections: input.rejections,
        reason: input.reason,
      }),
      { tokensUsed: 0, measured: false },
    );
  }

  /**
   * Cancels a Run and every non-terminal child, atomically.
   *
   * `agents.md` §3: cancelling a parent propagates to its non-terminal children.
   * The parent's own transition is validated *before* any child is touched, and
   * the whole cascade commits or rolls back together.
   */
  cancel(runId: string, usage: RunUsage = { tokensUsed: 0, measured: false }): Run {
    validateUsage(usage);
    const run = this.requireRun(runId);
    if (!canTransitionRun(run.status, 'cancelled')) {
      fail('VALIDATION_ERROR', `Run ${run.id} cannot move ${run.status} → cancelled`, {
        runId: run.id,
        status: run.status,
      });
    }
    return withTransaction(this.store.db, () => {
      this.cancelDescendants(run);
      return this.applyEnd(
        run,
        'cancelled',
        () => ({ outcome: 'cancelled', workId: run.workId }),
        usage,
      );
    });
  }

  /**
   * Settles a Run whose real usage only became available after it ended.
   *
   * `reliability.md` §3: unknown usage keeps the hold and marks `costKnown=false`;
   * the result is reconciled once the Provider usage report is readable. This is
   * idempotent — replaying the reconciliation returns the Run unchanged, it never
   * charges twice or releases another Run's hold.
   */
  reconcile(runId: string, usage: { readonly tokensUsed: number; readonly cost?: number }): Run {
    const run = this.requireRun(runId);
    if (!isTerminalRunStatus(run.status)) {
      fail('INVALID_STATE', `Run ${run.id} is ${run.status}; usage cannot be reconciled yet`, {
        runId: run.id,
        status: run.status,
      });
    }
    validateUsage({ tokensUsed: usage.tokensUsed, measured: true });
    validateCost(usage.cost);
    // The whole decision happens inside the transaction: two callers racing on the
    // same Run must not both pass the "already settled" check (DC-52).
    return withTransaction(this.store.db, () => {
      const recorded = this.settlementOf(run.id);
      if (recorded !== undefined && recorded.data['tokensUsed'] === usage.tokensUsed) {
        // Replaying the recorded usage is a no-op; anything else must not become a
        // silent second charge that would release another Run's hold (R6-01/R6-04).
        return run;
      }
      if (recorded !== undefined) {
        fail(
          'IDEMPOTENCY_CONFLICT',
          `Run ${run.id} already booked ${JSON.stringify(recorded.data['tokensUsed'])} tokens`,
          {
            runId: run.id,
            recordedTokens: recorded.data['tokensUsed'] ?? 0,
            requested: usage.tokensUsed,
          },
        );
      }
      const { charged, uncovered } = this.settleBudget(run, {
        tokensUsed: usage.tokensUsed,
        measured: true,
        ...(usage.cost === undefined ? {} : { cost: usage.cost }),
      });
      this.store.events.append({
        name: 'run.ended',
        entityId: run.id,
        // The Run row does not change on reconciliation, so the version repeats;
        // `reconciliation` gives consumers an orderable key (DC-48).
        entityVersion: run.version,
        data: {
          outcome: run.status,
          workId: run.workId,
          reconciled: true,
          reconciliation: this.reconciliationCount(run.id) + 1,
          tokensUsed: usage.tokensUsed,
          chargedTokens: charged,
          uncoveredTokens: uncovered,
          usageMeasured: true,
          runCostKnown: true,
          releasedTokens: Math.max(0, run.budgetAllocation - charged),
          ...(usage.cost === undefined ? {} : { cost: usage.cost }),
        },
      });
      this.refreshCostKnown(run.workId);
      return this.requireRun(run.id);
    });
  }

  /**
   * The terminal event that booked a Run's usage, if there is one.
   *
   * A measured settle and a reconciliation both count: the Run's cost is settled
   * either way and must not be booked twice.
   */
  private settlementOf(runId: string): Event | undefined {
    return findEvent(this.store, {
      names: ['run.ended'],
      stopAt: (event) => event.entityId === runId && event.data['usageMeasured'] === true,
    });
  }

  private reconciliationCount(runId: string): number {
    return scanEvents(this.store, { names: ['run.ended'] }).filter(
      (event) => event.entityId === runId && event.data['reconciled'] === true,
    ).length;
  }

  /** Every recorded settlement of one Run — diagnostics and tests. */
  settlements(runId: string): readonly Event[] {
    return scanEvents(this.store, { names: ['run.ended'] }).filter(
      (event) => event.entityId === runId,
    );
  }

  private end(
    runId: string,
    status: RunStatus,
    data: (run: Run) => Record<string, unknown>,
    usage: RunUsage = { tokensUsed: 0, measured: false },
  ): Run {
    const run = this.requireRun(runId);
    validateUsage(usage);
    if (!canTransitionRun(run.status, status)) {
      fail('VALIDATION_ERROR', `Run ${run.id} cannot move ${run.status} → ${status}`, {
        runId: run.id,
        status: run.status,
      });
    }
    const live = this.liveJoinChildren(run);
    if (status === 'completed' && live.length > 0) {
      fail(
        'INVALID_STATE',
        `Run ${run.id} still has ${String(live.length)} live join=all children`,
        {
          runId: run.id,
          pending: live.map((child) => child.id),
        },
      );
    }
    return withTransaction(this.store.db, () => {
      if (ABNORMAL_STATUSES.includes(status)) this.cancelDescendants(run);
      return this.applyEnd(run, status, data, usage);
    });
  }

  /**
   * Applies one terminal transition plus its budget effect. Callers must already
   * be inside a transaction and must have validated `canTransitionRun`.
   */
  private applyEnd(
    run: Run,
    status: RunStatus,
    data: (run: Run) => Record<string, unknown>,
    usage: RunUsage,
  ): Run {
    const updated = this.store.runs.update(run.id, { status }, run.version);
    const { charged, uncovered } = this.settleBudget(run, usage);
    this.store.events.append({
      name: 'run.ended',
      entityId: updated.id,
      entityVersion: updated.version,
      data: {
        ...data(updated),
        workId: updated.workId,
        // `tokensUsed` is what the Provider reported, `chargedTokens` what the
        // Work budget actually absorbed (never more than the reservation), and
        // `releasedTokens` the hold that went back (`reliability.md` §3).
        tokensUsed: usage.measured ? usage.tokensUsed : 0,
        chargedTokens: charged,
        uncoveredTokens: uncovered,
        usageMeasured: usage.measured,
        // Per-Run fact; the Work-level `costKnown` is recomputed separately (R6-06).
        runCostKnown: usage.measured,
        releasedTokens: usage.measured ? Math.max(0, run.budgetAllocation - charged) : 0,
      },
    });
    this.refreshCostKnown(updated.workId);
    return updated;
  }

  /**
   * Recomputes the Work-level `costKnown` flag.
   *
   * The flag is only true when every terminal Run of the Work has a measured (or
   * reconciled) usage: one Run's reconciliation must not claim the whole Work's
   * cost is known while a sibling hold is still unmeasured (`reliability.md` §3).
   */
  private refreshCostKnown(workId: string): void {
    const runs = this.store.runs.list({ where: 'work_id = ?', params: [workId] });
    const terminal = new Set(
      runs.filter((run) => isTerminalRunStatus(run.status)).map((run) => run.id),
    );
    const measured = new Set<string>();
    for (const event of scanEvents(this.store, { names: ['run.ended'] })) {
      if (!terminal.has(event.entityId)) continue;
      if (event.data['usageMeasured'] === true) measured.add(event.entityId);
    }
    const known = terminal.size > 0 && [...terminal].every((id) => measured.has(id));
    const budget = this.budgetOf(workId);
    if (budget.costKnown === known) return;
    this.store.budgets.update(budget.id, { costKnown: known }, budget.version);
  }

  /**
   * Budget effect of one terminal transition.
   *
   * Measured: the reservation is released and the usage charged, capped at the
   * reservation so `used + reserved <= limit` cannot be violated by a report that
   * exceeds it (the excess is surfaced as `uncoveredTokens` instead of making the
   * terminal transition impossible). Unmeasured: the hold stays and the Work is
   * marked cost-unknown.
   */
  private settleBudget(run: Run, usage: RunUsage): { charged: number; uncovered: number } {
    if (!usage.measured) {
      this.markCostUnknown(run.workId);
      return { charged: 0, uncovered: 0 };
    }
    const charged = Math.min(usage.tokensUsed, run.budgetAllocation);
    const uncovered = Math.max(0, usage.tokensUsed - charged);
    this.release(run.workId, run.budgetAllocation);
    this.charge(run.workId, charged, usage.cost);
    return { charged, uncovered };
  }

  /**
   * Cancels the Run's non-terminal descendants, deepest first.
   *
   * Runs inside the caller's transaction; each child is validated before any of
   * its own children are touched.
   */
  private cancelDescendants(run: Run): void {
    const children = this.store.runs
      .list({ where: 'parent_run_id = ?', params: [run.id] })
      .filter((child) => !isTerminalRunStatus(child.status));
    for (const child of children) {
      if (!canTransitionRun(child.status, 'cancelled')) continue;
      this.cancelDescendants(child);
      this.applyEnd(
        child,
        'cancelled',
        () => ({ outcome: 'cancelled', workId: child.workId, cancelledWithParent: run.id }),
        { tokensUsed: 0, measured: false },
      );
    }
  }

  private liveJoinChildren(run: Run): readonly Run[] {
    return this.store.runs
      .list({ where: 'parent_run_id = ?', params: [run.id] })
      .filter((child) => child.join === 'all' && !isTerminalRunStatus(child.status));
  }

  private markCostUnknown(workId: string): void {
    const budget = this.budgetOf(workId);
    if (!budget.costKnown) return;
    this.store.budgets.update(budget.id, { costKnown: false }, budget.version);
  }

  /**
   * Adds already-validated usage to the Work budget.
   *
   * The caller released the matching reservation first, so the Schema invariant
   * (`used + reserved <= limit`) still holds.
   */
  private charge(workId: string, tokensUsed: number, cost?: number): void {
    if (tokensUsed <= 0 && cost === undefined) return;
    const budget = this.budgetOf(workId);
    this.store.budgets.update(
      budget.id,
      {
        tokensUsed: budget.tokensUsed + tokensUsed,
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

/**
 * Usage must be a non-negative integer number of tokens.
 *
 * Without this, a negative report would be clamped in the budget while the event
 * recorded the raw value — two different stories about the same settlement (M-4).
 */
function validateUsage(usage: RunUsage): void {
  if (!Number.isInteger(usage.tokensUsed) || usage.tokensUsed < 0) {
    fail(
      'VALIDATION_ERROR',
      `tokensUsed must be a non-negative integer, got ${String(usage.tokensUsed)}`,
    );
  }
  // An unmeasured usage of N tokens is contradictory: either the report exists
  // (measured) or the amount is unknown (zero). Silently writing zero would drop
  // the caller's number without telling anyone (R6-03 variant).
  if (!usage.measured && usage.tokensUsed > 0) {
    fail(
      'VALIDATION_ERROR',
      'tokensUsed must be 0 when measured is false; unknown usage keeps the reservation',
      { tokensUsed: usage.tokensUsed },
    );
  }
  validateCost(usage.cost);
}

/** `budget.cost` is a non-negative number (`data.md` §2), not necessarily integral. */
function validateCost(cost: number | undefined): void {
  if (cost === undefined) return;
  if (!Number.isFinite(cost) || cost < 0) {
    fail('VALIDATION_ERROR', `cost must be a non-negative number, got ${String(cost)}`);
  }
}
