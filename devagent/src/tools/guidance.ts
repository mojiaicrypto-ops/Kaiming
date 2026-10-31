/**
 * Discoverability (stage 4): what the caller may do *now*, what is missing, and who can do it.
 *
 * The program never decides business steps; it reports the facts an operable next call depends on —
 * whether the step has settled, which report kinds are already recorded, whether the review/test
 * preconditions hold, and which roles the current phase accepts. The chief still chooses.
 */
import type { ResultKind, ResultRow, Store, TaskPhase, TaskRow, TaskSessionRow } from '../store/store.ts';
import { deliveryCommitGaps } from './completion-git.ts';

/** Which phase each role may be dispatched in (G2: Review/Test/settler are step-specific). */
export const ROLE_PHASE: Readonly<Record<string, readonly TaskPhase[]>> = {
  designer: ['clarify', 'analyze', 'design', 'plan'],
  developer: ['develop'],
  reviewer: ['review'],
  tester: ['test'],
  settler: ['settle'],
  investigator: ['clarify', 'analyze', 'design', 'plan'],
};

export interface NextAction {
  /** A concrete call the caller can make now (an op name, or a one-line description). */
  readonly action: string;
  /** The operation the action belongs to. */
  readonly op: 'create' | 'update' | 'dispatch' | 'control' | 'end' | 'get' | 'recover';
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
  /** The watchdog code of the member's current input, when it has one. */
  readonly errorCode: string | null;
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
        errorCode: input?.errorCode ?? null,
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
export function guidanceFor(
  store: Store,
  task: TaskRow,
  options: { readonly chief: boolean } = { chief: true },
): TaskGuidance {
  if (task.status === 'completed' || task.status === 'cancelled') {
    return { nextActions: [], gaps: [] };
  }
  const results = latestResults(store, task.id);
  const gaps = completionFacts(store, task, results);
  if (task.status === 'pausing' || task.status === 'paused') {
    return { nextActions: [resumeAction(task.status, options.chief)], gaps: [] };
  }
  if (task.status === 'cancelling') {
    return { nextActions: [], gaps: [] };
  }
  // A specialist may only read its Task (G2): guidance must not advertise calls it cannot express.
  if (!options.chief) {
    return { nextActions: [], gaps };
  }

  const facts = memberFacts(store, task);
  const busy = unfinished(facts);
  const actions: NextAction[] = [];
  if (busy.length > 0) {
    // Waiting cannot settle an interrupted input (settleStep reports it as blocked immediately), so
    // only the recover calls are advertised for those members.
    if (busy.some((entry) => entry.state !== 'interrupted')) {
      actions.push({
        action: 'task(op=dispatch) with no sessions to wait for the step',
        op: 'dispatch',
        reason: `${busy.filter((entry) => entry.state !== 'interrupted').length} member(s) of the current step are still running`,
      });
    }
    for (const entry of busy.filter((member) => member.state === 'interrupted')) {
      actions.push({
        action: `task(op=recover, sessionId=${entry.member.sessionId}, evidenceRefs=[...], resolution=completed|failed|stopped)`,
        op: 'recover',
        reason: `${entry.member.sessionId} was interrupted; its outcome is unknown`,
      });
    }
  } else {
    for (const entry of facts.filter(
      (member) =>
        member.state === 'stopped' &&
        (member.errorCode === 'RUN_STALLED' || member.errorCode === 'RUN_TIMEOUT') &&
        member.resultIds.length === 0,
    )) {
      actions.push({
        action: `task(op=dispatch, sessions=[{sessionId: ${entry.member.sessionId}, instructions: '<continue from the hung command>'}])`,
        op: 'dispatch',
        reason: `${entry.member.sessionId} was stopped by the run watchdog without a report; continuing its session reuses the context, a replacement repeats the investigation`,
      });
    }
    actions.push({
      action: 'task(op=update, phase=...) to record this step and start the next one',
      op: 'update',
      reason: `every member of ${task.phase} has settled`,
    });
    const advice = dispatchAdvice(task, results);
    if (advice !== undefined) {
      actions.push(advice);
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

function resumeAction(status: TaskRow['status'], chief: boolean): NextAction {
  if (!chief) {
    return { action: 'task(op=get) to read the Task state', op: 'get', reason: `the Task is ${status}` };
  }
  return {
    action: status === 'paused' ? 'task(op=control, command=resume) to continue' : 'wait for the pause to settle',
    op: 'control',
    reason: `the Task is ${status}`,
  };
}

/**
 * The one role whose dispatch would be accepted now, if any. Honest by construction: a read Task only
 * accepts the investigator, and a test phase without a passed review needs the review first.
 */
function dispatchAdvice(task: TaskRow, results: Map<ResultKind, ResultRow>): NextAction | undefined {
  if (task.type === 'read') {
    const allowed = ROLE_PHASE['investigator'] ?? [];
    return allowed.includes(task.phase)
      ? {
          action: 'task(op=dispatch, sessions=[{roleId: investigator, instructions: ...}])',
          op: 'dispatch',
          reason: `a read Task in phase ${task.phase} accepts the investigator`,
        }
      : undefined;
  }
  if (task.phase === 'test' && results.get('review')?.verdict !== 'passed') {
    return {
      action: 'task(op=update, phase=review), then dispatch the reviewer',
      op: 'update',
      reason: 'the test phase needs a passed review of the current delivery first',
    };
  }
  const allowed = rolesForPhase(task.phase);
  const role = allowed[0];
  if (role === undefined) {
    return undefined;
  }
  return {
    action: `task(op=dispatch, sessions=[{roleId: ${role}, instructions: ...}])`,
    op: 'dispatch',
    reason: `phase ${task.phase} accepts ${allowed.join(', ')}`,
  };
}

/** The observable facts that stand between the Task and completion (not a decision). */
function completionFacts(store: Store, task: TaskRow, results: Map<ResultKind, ResultRow>): string[] {
  // One algorithm for the hard part: the same blockers `endTask` checks (members, passed review/test,
  // unchanged delivery), plus the commit the host observes. Guidance only adds the completion-report
  // fact it cannot know without an id.
  const gaps = [...store.completionBlockers(task.id), ...deliveryCommitGaps(store, task)];
  if (task.type === 'read') {
    if (!results.has('investigation') && !results.has('recovery')) {
      gaps.push('no investigation or recovery report is recorded');
    }
    return gaps;
  }
  if (!results.has('settlement')) {
    gaps.push('no settlement report is recorded');
  }
  return gaps;
}

/** Roles the current phase accepts, from the same table the dispatch rule uses. */
function rolesForPhase(phase: TaskPhase): string[] {
  return Object.entries(ROLE_PHASE)
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
