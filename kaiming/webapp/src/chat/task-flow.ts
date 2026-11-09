import type { StateKind } from '../app/State';
import { rosterGroupsOf, type RosterGroup } from './TaskTodo';

/**
 * One step of the flow, as both the strip and the task list draw it. `plan` is the only
 * derived kind: a step the Task's own declaration still owes, which the chief has not
 * reached yet. Everything else is something that really happened.
 */
export interface FlowStep {
  readonly phase: string;
  readonly round: number;
  /** Real member states in this step, summarised: run > decide > wait > block > done > idle. */
  readonly kind: StateKind | 'plan';
  /** Every member of this step reported completed — the only state that earns a check. */
  readonly done: boolean;
  readonly members: number;
  readonly running: number;
}

/** The canonical phase order: how far along the flow a phase sits, for the planned tail. */
const PHASE_ORDER = ['clarify', 'analyze', 'design', 'plan', 'develop', 'review', 'test', 'settle'] as const;

/** Steps a step's own members imply, in the order that wins when several apply. */
const RANK: readonly (StateKind | 'plan')[] = ['run', 'decide', 'wait', 'paused', 'block', 'done', 'idle', 'plan'];

function rankOf(kind: StateKind | 'plan'): number {
  return RANK.indexOf(kind);
}

export interface FlowInput {
  readonly task: {
    readonly type: string;
    readonly workKind?: string | undefined;
    readonly phase: string;
    readonly status: string;
    readonly requiresTest?: boolean | undefined;
  };
  readonly members: readonly {
    readonly phase: string;
    readonly activity?: string | undefined;
    readonly lastInputStatus?: 'completed' | 'failed' | 'stopped' | 'interrupted' | null;
    readonly reportMissing?: boolean | undefined;
    readonly waitingUser?: boolean | undefined;
    /** Verdict of the member's latest report: an input that ended normally is not a pass. */
    readonly latestVerdict?: string | null | undefined;
  }[];
  /** Open questions anywhere in the Task: they outrank any member state, it is the user's turn. */
  readonly pendingQuestions: number;
}

/** Same predicate as `src/runtime/task-progress.ts`'s `memberPassed`: input ended, report delivered and agrees. */
function memberPassed(member: FlowInput['members'][number]): boolean {
  if (member.reportMissing === true) return false;
  const verdict = member.latestVerdict ?? null;
  return member.lastInputStatus === 'completed' && verdict !== 'failed' && verdict !== 'blocked';
}

function memberKind(member: FlowInput['members'][number]): StateKind {
  if (member.waitingUser === true) return 'decide';
  if (member.activity === 'processing') return 'run';
  if (member.activity === 'queued') return 'wait';
  if (member.reportMissing === true) return 'block';
  if (member.latestVerdict === 'blocked') return 'decide';
  if (member.lastInputStatus === 'failed' || member.latestVerdict === 'failed') return 'block';
  if (memberPassed(member)) return 'done';
  return 'idle';
}

/**
 * The plan's remaining steps, from the Task's own declaration: a write Task ends in review
 * (and test when the chief declared requiresTest) then settle. Only phases AFTER the furthest
 * step really reached are listed, so rework (review ran, develop runs again) never re-plans
 * review. Read Tasks owe nothing: their flow is whatever the chief actually runs.
 */
export function plannedTail(
  task: {
    readonly type: string;
    readonly phase: string;
    readonly requiresTest?: boolean | undefined;
    readonly workKind?: string | undefined;
  },
  phasesSoFar: readonly string[],
): readonly string[] {
  if (task.type !== 'write') return [];
  const test = task.requiresTest === true ? ['test'] : [];
  const kind = task.workKind;
  if (kind === undefined) {
    const index = (phase: string): number => PHASE_ORDER.indexOf(phase as (typeof PHASE_ORDER)[number]);
    const reach = Math.max(index(task.phase), ...phasesSoFar.map(index));
    return ['review', ...test, 'settle'].filter((phase) => index(phase) > reach);
  }
  const sequence =
    kind === 'design'
      ? ['clarify', 'analyze', 'design', 'review', 'settle']
      : kind === 'document'
        ? ['plan', 'design', 'review', 'settle']
        : kind === 'implement'
          ? task.phase === 'design'
            ? ['design', 'develop', 'review', ...test, 'settle']
            : ['plan', 'develop', 'review', ...test, 'settle']
          : [];
  if (sequence.length === 0) return [];
  const positions = [task.phase, ...phasesSoFar]
    .map((phase) => sequence.indexOf(phase))
    .filter((position) => position >= 0);
  const reach = positions.length === 0 ? -1 : Math.max(...positions);
  return sequence.slice(reach + 1);
}

/**
 * THE flow of a running Task. Strip and list both render this array, position by position, so
 * the two can never draw the flow in two different orders: real phase-rounds first (grouped by
 * the same rule that keeps rework legible), the planned tail after them, in canonical order.
 */
export function flowOf({ task, members, pendingQuestions }: FlowInput): readonly FlowStep[] {
  const groups: readonly RosterGroup<FlowInput['members'][number]>[] = rosterGroupsOf(members, task.phase);
  const steps: FlowStep[] = groups.map((group) => {
    const kinds = group.rows.map(memberKind);
    const kind =
      pendingQuestions > 0
        ? 'decide'
        : kinds.reduce<StateKind | 'plan'>((worst, next) => (rankOf(next) < rankOf(worst) ? next : worst), 'done');
    // A group with no rows is the frontier: the chief moved the phase, nothing dispatched there yet.
    const frontier = group.rows.length === 0;
    return {
      phase: group.phase,
      round: group.round,
      kind: frontier ? 'wait' : kind,
      done: !frontier && kind === 'done' && group.rows.every(memberPassed),
      members: group.rows.length,
      running: group.rows.filter((row) => row.activity === 'processing').length,
    };
  });
  // A Task that is not moving (paused, cancelled, already completed) promises nothing further.
  const moving =
    task.status !== 'paused' && task.status !== 'pausing' && task.status !== 'cancelled' && task.status !== 'completed';
  const planned = moving ? plannedTail(task, groups.map((group) => group.phase)) : [];
  return [
    ...steps,
    ...planned.map((phase): FlowStep => ({ phase, round: 1, kind: 'plan', done: false, members: 0, running: 0 })),
  ];
}
