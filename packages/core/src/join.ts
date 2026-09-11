/**
 * Join: how a Chief Run converges its professional children (AC-046).
 *
 * `rules/agents.md` §3 defines `joinPolicy=none|all` and requires that "一个 required
 * 失败时兄弟结果保留、父 Run 获得全部结果、Gate 阻断、新 Chief 消息仍可处理".
 * This module owns exactly that: it never deletes or rewrites a sibling's result,
 * it hands the parent every child outcome (not only the failures), and a failed
 * required child opens a `chief_action_required` todo instead of silently
 * continuing.
 */
import { isTerminalRunStatus } from '@agentdev/domain';
import type { Event, Run, RunStatus, StageResultRow } from '@agentdev/contracts';
import type { ProjectStore } from '@agentdev/storage';
import { withTransaction } from '@agentdev/storage';
import { ProtocolError } from './errors.js';
import { findEvent } from './events.js';

/** One child Run's settled or in-flight outcome, as the parent sees it. */
export interface ChildOutcome {
  readonly runId: string;
  readonly role: Run['role'];
  readonly status: RunStatus;
  readonly requiredChild: boolean;
  /** `all` = the parent waits for it; `none` = fire-and-forget (`agents.md` §3). */
  readonly join: Run['join'];
  readonly stageResult?: {
    readonly status: StageResultRow['status'];
    readonly summary: string;
    readonly artifactRefs: StageResultRow['artifactRefs'];
    readonly evidenceRefs: readonly string[];
    readonly changedPaths: readonly string[];
    readonly findingIds: readonly string[];
    readonly unknowns: readonly string[];
    readonly requestedActions: readonly string[];
    /** Which repository state the delivery is based on (`context.md` §3). */
    readonly readLedgerSeq: number;
    readonly readLedgerHash: string;
  };
}

export type JoinOutcome =
  | { readonly kind: 'orphan'; readonly childRunId: string }
  | {
      readonly kind: 'waiting';
      readonly parentRunId: string;
      readonly pending: readonly string[];
      readonly children: readonly ChildOutcome[];
    }
  | {
      readonly kind: 'ready';
      readonly parentRunId: string;
      readonly children: readonly ChildOutcome[];
    }
  | {
      readonly kind: 'blocked';
      readonly parentRunId: string;
      readonly children: readonly ChildOutcome[];
      readonly failedRequired: readonly ChildOutcome[];
      readonly chiefTodo: string;
    };

/** A child that ended without delivering is a required-child failure. */
const FAILED_STATUSES: readonly RunStatus[] = [
  'failed',
  'cancelled',
  'timed_out',
  'contract_violation',
];

function isFailed(status: RunStatus): boolean {
  return FAILED_STATUSES.includes(status);
}

export class JoinCoordinator {
  private readonly store: ProjectStore;

  constructor(options: { readonly store: ProjectStore }) {
    this.store = options.store;
  }

  /** Every child of a Run, in dispatch order, with its latest stage result. */
  childrenOf(parentRunId: string): ChildOutcome[] {
    return this.store.runs
      .list({ where: 'parent_run_id = ?', params: [parentRunId], orderBy: 'created_at ASC' })
      .map((child) => this.outcomeOf(child));
  }

  outcomeOf(child: Run): ChildOutcome {
    const stageResult = this.store.stageResults.list({
      where: 'run_id = ?',
      params: [child.id],
      orderBy: 'created_at DESC',
      limit: 1,
    })[0];
    return {
      runId: child.id,
      role: child.role,
      status: child.status,
      requiredChild: child.requiredChild,
      join: child.join,
      ...(stageResult === undefined
        ? {}
        : {
            stageResult: {
              status: stageResult.status,
              summary: stageResult.summary,
              artifactRefs: stageResult.artifactRefs,
              evidenceRefs: stageResult.evidenceRefs,
              changedPaths: stageResult.changedPaths,
              findingIds: stageResult.findingIds,
              unknowns: stageResult.unknowns,
              requestedActions: stageResult.requestedActions,
              readLedgerSeq: stageResult.readLedgerSeq,
              readLedgerHash: stageResult.readLedgerHash,
            },
          }),
    };
  }

  /**
   * Current join state of a parent Run.
   *
   * Read-only, so a parent that is waiting for children can still answer messages
   * and report why it is waiting (`waiting_children` is not a lock).
   */
  state(parentRunId: string): JoinOutcome {
    const parent = this.requireRun(parentRunId);
    const children = this.childrenOf(parent.id);
    // Only `join=all` children hold the parent (`agents.md` §3: a `none` dispatch
    // lets the Chief continue immediately).
    const pending = children.filter(
      (child) => child.join === 'all' && !isTerminalRunStatus(child.status),
    );
    if (pending.length > 0) {
      return {
        kind: 'waiting',
        parentRunId: parent.id,
        pending: pending.map((child) => child.runId),
        children,
      };
    }
    const failedRequired = children.filter(
      (child) => child.join === 'all' && child.requiredChild && isFailed(child.status),
    );
    if (failedRequired.length > 0) {
      // The blocked outcome must carry the todo that was filed, otherwise the
      // caller cannot tell which Chief action is pending (AC-046).
      return {
        kind: 'blocked',
        parentRunId: parent.id,
        children,
        failedRequired,
        chiefTodo: this.existingTodo(parent, 'required_child_failed', failedRequired),
      };
    }
    return { kind: 'ready', parentRunId: parent.id, children };
  }

  /**
   * Recomputes a parent Run after one of its children reached a terminal status.
   *
   * The parent moves to `waiting_children` while anything is outstanding, and back
   * to `running` once every child settled — unless a required child failed, in
   * which case the Gate stays blocked and the Chief is paged.
   */
  onChildSettled(childRunId: string): JoinOutcome {
    const child = this.requireRun(childRunId);
    if (child.parentRunId === undefined) return { kind: 'orphan', childRunId: child.id };
    const parent = this.requireRun(child.parentRunId);
    if (parent.role !== 'chief') {
      throw new ProtocolError('NOT_AUTHORIZED', `Run ${parent.id} is not a Chief Run`, {
        details: { parentRole: parent.role, childRunId: child.id },
      });
    }

    return withTransaction(this.store.db, () => {
      const children = this.childrenOf(parent.id);
      const pending = children.filter(
        (entry) => entry.join === 'all' && !isTerminalRunStatus(entry.status),
      );
      if (pending.length > 0) {
        // The status change is the evidence: `protocol.md` §7 lists no persistent
        // Join event, so none is invented (N-03/DC-39).
        if (parent.status === 'running') {
          this.store.runs.update(parent.id, { status: 'waiting_children' }, parent.version);
        }
        return {
          kind: 'waiting',
          parentRunId: parent.id,
          pending: pending.map((entry) => entry.runId),
          children,
        };
      }

      // A fire-and-forget child that failed does not block the gate, but the Chief
      // is still told about it (`agents.md` §3 `none`).
      const lostFireAndForget = children.filter(
        (entry) => entry.join === 'none' && isFailed(entry.status),
      );
      if (lostFireAndForget.length > 0) {
        this.pageChief(parent, 'fire_and_forget_child_failed', lostFireAndForget);
      }
      const failedRequired = children.filter(
        (entry) => entry.join === 'all' && entry.requiredChild && isFailed(entry.status),
      );
      if (failedRequired.length > 0) {
        // Siblings are untouched and every result travels with the todo, so the
        // Chief can decide with the full picture (AC-046「父获全部结果」).
        const event = this.pageChief(parent, 'required_child_failed', failedRequired, children);
        return {
          kind: 'blocked',
          parentRunId: parent.id,
          children,
          failedRequired,
          chiefTodo: event === undefined ? '' : String(event.cursor),
        };
      }

      if (parent.status === 'waiting_children') {
        this.store.runs.update(parent.id, { status: 'running' }, parent.version);
      }
      return { kind: 'ready', parentRunId: parent.id, children };
    });
  }

  /**
   * Files one `chief_action_required` todo per (parent, reason, failed set).
   *
   * Recomputing a join (a retried supervisor step, a resumed daemon) must not turn
   * one failure into a stream of duplicate Chief todos, so an identical todo that
   * is already in the log is reused (N-06).
   */
  private pageChief(
    parent: Run,
    reason: 'required_child_failed' | 'fire_and_forget_child_failed',
    failed: readonly ChildOutcome[],
    children: readonly ChildOutcome[] = this.childrenOf(parent.id),
  ): Event | undefined {
    const failedIds = failed.map((entry) => entry.runId).sort();
    const existing = this.todoOf(parent, reason, failedIds);
    if (existing !== undefined) return existing;
    // A Run that already ended can never act, so it gets no todo (R5-05). A Run
    // that is merely paused/interrupted/recovery_required still can — it would
    // otherwise lose the failure permanently once it resumes (R9-06).
    if (isTerminalRunStatus(parent.status)) return undefined;
    return this.store.events.append({
      name: 'chief_action_required',
      entityId: parent.id,
      entityVersion: parent.version,
      data: {
        reason,
        // The whole delivery travels with the todo, so the Chief can act from the
        // event alone without re-reading every child's stage result.
        failed: failedIds,
        failedRequired: reason === 'required_child_failed' ? failedIds : [],
        children: children.map((entry) => ({
          runId: entry.runId,
          role: entry.role,
          status: entry.status,
          requiredChild: entry.requiredChild,
          join: entry.join,
          stageResult:
            entry.stageResult === undefined
              ? null
              : {
                  status: entry.stageResult.status,
                  summary: entry.stageResult.summary,
                  artifactRefs: entry.stageResult.artifactRefs,
                  evidenceRefs: [...entry.stageResult.evidenceRefs],
                  changedPaths: [...entry.stageResult.changedPaths],
                  findingIds: [...entry.stageResult.findingIds],
                  unknowns: [...entry.stageResult.unknowns],
                  requestedActions: [...entry.stageResult.requestedActions],
                  // The read ledger travels too: without it the Chief cannot tell
                  // which repository state the delivery is based on (`context.md` §3).
                  readLedgerSeq: entry.stageResult.readLedgerSeq,
                  readLedgerHash: entry.stageResult.readLedgerHash,
                },
        })),
      },
    });
  }

  /** The cursor of the todo already filed for this failure set, if any. */
  private existingTodo(
    parent: Run,
    reason: 'required_child_failed' | 'fire_and_forget_child_failed',
    failed: readonly ChildOutcome[],
  ): string {
    const found = this.todoOf(parent, reason, failed.map((entry) => entry.runId).sort());
    return found === undefined ? '' : String(found.cursor);
  }

  /**
   * The `chief_action_required` event for one (parent, reason, failed set).
   *
   * A complete scan, so idempotency does not depend on how long the log is.
   */
  private todoOf(
    parent: Run,
    reason: 'required_child_failed' | 'fire_and_forget_child_failed',
    failedIds: readonly string[],
  ): Event | undefined {
    return findEvent(this.store, {
      names: ['chief_action_required'],
      stopAt: (event) => {
        if (event.entityId !== parent.id || event.data['reason'] !== reason) return false;
        const recorded = event.data['failed'] ?? event.data['failedRequired'];
        if (!Array.isArray(recorded)) return false;
        return (recorded as string[]).slice().sort().join(',') === failedIds.join(',');
      },
    });
  }

  private requireRun(runId: string): Run {
    const run = this.store.runs.find(runId);
    if (run === undefined) {
      throw new ProtocolError('NOT_FOUND', `Run ${runId} does not exist`, {});
    }
    return run;
  }
}
