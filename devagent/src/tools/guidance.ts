/**
 * Discoverability (stage 4): what the caller may do *now*, what is missing, and who can do it.
 *
 * The program never decides business steps; it reports the facts an operable next call depends on —
 * whether the step has settled, which report kinds are already recorded, whether the review/test
 * preconditions hold, and which roles the current phase accepts. The chief still chooses.
 */
import type { ResultKind, ResultRow, Store, TaskPhase, TaskRow, TaskSessionRow } from '../store/store.ts';

export interface NextAction {
  /** A concrete call the caller can make now (an op name, or a one-line description). */
  readonly action: string;
  /** The operation the action belongs to. */
  readonly op: 'create' | 'update' | 'dispatch' | 'control' | 'end' | 'get';
  /** Why it is allowed now (usually the fact that blocks everything else). */
  readonly reason: string;
}

export interface TaskGuidance {
  /** Actions allowed right now; empty when the Task cannot be driven further by this role. */
  readonly nextActions: readonly NextAction[];
  /** What is missing before the Task can end, as observable facts. */
  readonly gaps: readonly string[];
}

export interface MemberFact {
  readonly member: TaskSessionRow;
  readonly state: string;
  readonly resultIds: readonly string[];
}

export function memberFacts(store: Store, task: TaskRow): MemberFact[] {
  return store
    .listTaskSessions(task.id)
    .filter((member) => member.phase === task.phase)
    .map((member) => {
      const input = member.currentInputId === null ? undefined : store.getInput(member.currentInputId);
      return {
        member,
        state: input === undefined ? 'none' : input.status,
        resultIds: input === undefined ? [] : store.resultsForInputs([input.inputId]).map((entry) => entry.resultId),
      };
    });
}

/** Open work of the current step: a member whose input has not settled yet. */
function unfinished(members: readonly MemberFact[]): MemberFact[] {
  return members.filter((entry) =>
    ['queued', 'processing', 'stopping', 'interrupted'].includes(entry.state),
  );
}

function latestResults(store: Store, taskId: string): Map<ResultKind, ResultRow> {
  const latest = new Map<ResultKind, ResultRow>();
  for (const result of store.listTaskResults(taskId)) {
    latest.set(result.kind, result);
  }
  return latest;
}

/**
 * The facts a caller needs to pick the next call. `end` readiness is reported as gaps, never as a
 * decision: the chief and independent agents judge whether the work is really done.
 */
export function guidanceFor(store: Store, task: TaskRow): TaskGuidance {
  if (task.status === 'completed' || task.status === 'cancelled') {
    return { nextActions: [], gaps: [] };
  }
  if (task.status === 'pausing' || task.status === 'paused') {
    return {
      nextActions: [
        {
          action: task.status === 'paused' ? 'task(op=control, command=resume) to continue' : 'wait for the pause to settle',
          op: 'control',
          reason: `the Task is ${task.status}`,
        },
      ],
      gaps: [],
    };
  }
  if (task.status === 'cancelling') {
    return { nextActions: [], gaps: [] };
  }

  const members = memberFacts(store, task);
  const busy = unfinished(members);
  const results = latestResults(store, task.id);
  const gaps = completionFacts(store, task, results);
  const actions: NextAction[] = [];
  if (busy.length > 0) {
    const waiting = busy.filter((entry) => entry.state === 'interrupted');
    actions.push({
      action: 'task(op=dispatch) with no sessions to wait for the step',
      op: 'dispatch',
      reason: `${busy.length} member(s) of the current step have not settled`,
    });
    for (const entry of waiting) {
      actions.push({
        action: `task(op=recover, sessionId=${entry.member.sessionId}, evidenceRefs=[...], resolution=completed|failed|stopped)`,
        op: 'get',
        reason: `${entry.member.sessionId} was interrupted; its outcome is unknown`,
      });
    }
  } else {
    actions.push({
      action: `task(op=update, phase=...) to record this step and start the next one`,
      op: 'update',
      reason: `every member of ${task.phase} has settled`,
    });
    const allowed = rolesForPhase(task.phase);
    if (allowed.length > 0) {
      actions.push({
        action: `task(op=dispatch, sessions=[{roleId: ${allowed[0] ?? 'designer'}, ...}])`,
        op: 'dispatch',
        reason: `phase ${task.phase} accepts ${allowed.join(', ')}`,
      });
    }
    // `end` is offered only when the observed facts say the completion checks can pass; otherwise the
    // gaps below are the actionable part.
    if (gaps.length === 0) {
      actions.push({
        action: 'task(op=end, completionResultId=...)',
        op: 'end',
        reason: 'every completion fact is recorded',
      });
    }
  }

  return { nextActions: actions, gaps };
}

/** The observable facts that stand between the Task and completion (not a decision). */
function completionFacts(store: Store, task: TaskRow, results: Map<ResultKind, ResultRow>): string[] {
  const gaps: string[] = [];
  const busy = unfinished(memberFacts(store, task));
  if (busy.length > 0) {
    gaps.push(`${busy.length} member(s) of the current step have not settled`);
  }
  if (task.type === 'read') {
    if (!results.has('investigation') && !results.has('recovery')) {
      gaps.push('no investigation or recovery report is recorded');
    }
    return gaps;
  }
  const settlement = results.get('settlement');
  if (settlement === undefined) {
    gaps.push('no settlement report is recorded');
  }
  if (!results.has('review')) {
    gaps.push('no review report is recorded');
  }
  if (task.requiresTest && !results.has('test')) {
    gaps.push('no test report is recorded (this Task declares requiresTest)');
  }
  if (results.has('review') && !results.has('test') && task.requiresTest) {
    gaps.push('dispatch the tester only after the review passed');
  }
  return gaps;
}

/** Roles the current phase accepts (kept in step with the dispatch rule). */
function rolesForPhase(phase: TaskPhase): string[] {
  const map: Record<string, readonly TaskPhase[]> = {
    designer: ['clarify', 'analyze', 'design', 'plan'],
    developer: ['develop'],
    reviewer: ['review'],
    tester: ['test'],
    settler: ['settle'],
    investigator: ['clarify', 'analyze', 'design', 'plan'],
  };
  return Object.entries(map)
    .filter(([, phases]) => phases.includes(phase))
    .map(([role]) => role);
}

/**
 * The facts a refused dispatch should carry so the caller can act without guessing: who is in the
 * current step, what state each is in, and which roles the phase accepts.
 */
export function dispatchRefusalFacts(store: Store, task: TaskRow): Record<string, unknown> {
  return {
    phase: task.phase,
    status: task.status,
    allowedRoles: rolesForPhase(task.phase),
    members: memberFacts(store, task).map((entry) => ({
      sessionId: entry.member.sessionId,
      roleId: entry.member.roleId,
      label: entry.member.label,
      expectedKind: entry.member.expectedKind,
      state: entry.state,
      resultIds: entry.resultIds,
    })),
  };
}
