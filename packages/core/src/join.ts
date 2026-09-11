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
import type { Run, RunStatus, StageResultRow } from '@agentdev/contracts';
import type { ProjectStore } from '@agentdev/storage';
import { withTransaction } from '@agentdev/storage';
import { ProtocolError } from './errors.js';

/** One child Run's settled or in-flight outcome, as the parent sees it. */
export interface ChildOutcome {
  readonly runId: string;
  readonly role: Run['role'];
  readonly status: RunStatus;
  readonly requiredChild: boolean;
  readonly stageResult?: {
    readonly status: StageResultRow['status'];
    readonly summary: string;
    readonly artifactRefs: StageResultRow['artifactRefs'];
    readonly evidenceRefs: readonly string[];
    readonly changedPaths: readonly string[];
    readonly findingIds: readonly string[];
    readonly unknowns: readonly string[];
    readonly requestedActions: readonly string[];
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
    const pending = children.filter((child) => !isTerminalRunStatus(child.status));
    if (pending.length > 0) {
      return {
        kind: 'waiting',
        parentRunId: parent.id,
        pending: pending.map((child) => child.runId),
        children,
      };
    }
    const failedRequired = children.filter(
      (child) => child.requiredChild && isFailed(child.status),
    );
    if (failedRequired.length > 0) {
      return { kind: 'blocked', parentRunId: parent.id, children, failedRequired, chiefTodo: '' };
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
      const pending = children.filter((entry) => !isTerminalRunStatus(entry.status));
      if (pending.length > 0) {
        if (parent.status === 'running') {
          const updated = this.store.runs.update(
            parent.id,
            { status: 'waiting_children' },
            parent.version,
          );
          this.store.events.append({
            name: 'run.waiting_children',
            entityId: updated.id,
            entityVersion: updated.version,
            data: { pending: pending.map((entry) => entry.runId) },
          });
        }
        return {
          kind: 'waiting',
          parentRunId: parent.id,
          pending: pending.map((entry) => entry.runId),
          children,
        };
      }

      const failedRequired = children.filter(
        (entry) => entry.requiredChild && isFailed(entry.status),
      );
      if (failedRequired.length > 0) {
        // Siblings are untouched and every result travels with the todo, so the
        // Chief can decide with the full picture (AC-046).
        const event = this.store.events.append({
          name: 'chief_action_required',
          entityId: parent.id,
          entityVersion: parent.version,
          data: {
            reason: 'required_child_failed',
            failedRequired: failedRequired.map((entry) => entry.runId),
            children: children.map((entry) => ({
              runId: entry.runId,
              role: entry.role,
              status: entry.status,
              requiredChild: entry.requiredChild,
            })),
          },
        });
        return {
          kind: 'blocked',
          parentRunId: parent.id,
          children,
          failedRequired,
          chiefTodo: String(event.cursor),
        };
      }

      if (parent.status === 'waiting_children') {
        const updated = this.store.runs.update(parent.id, { status: 'running' }, parent.version);
        this.store.events.append({
          name: 'run.children_joined',
          entityId: updated.id,
          entityVersion: updated.version,
          data: { children: children.map((entry) => entry.runId) },
        });
      }
      return { kind: 'ready', parentRunId: parent.id, children };
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
