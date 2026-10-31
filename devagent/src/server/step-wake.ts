/**
 * Host-side wake for a Task step that settled while nobody was waiting.
 *
 * `task(op=dispatch)` waits inside the chief's own Pi turn (`settleStep` polls the store). That wait
 * dies with the turn: a dispatch wait returns a snapshot after `waitTimeoutMs`, the run watchdog
 * aborts a 90-minute turn, or the provider fails the turn outright. Member work keeps running in its
 * own session and delivers its report later — and a report writes no input, so the worker has
 * nothing to schedule and the Task stalls until the user types something.
 *
 * This is the one deliberate host-initiated model turn: when the current step has no unfinished
 * member and the chief is idle, enqueue one factual notice to the chief (once per step, keyed by the
 * step's member inputs). It advances nothing by itself; it only gives the chief the turn it would
 * have had if its wait had survived. A chief that is still running is left alone — its own
 * `settleStep` sees the settled members.
 */
import { createHash } from 'node:crypto';
import type { InputStatus, Store } from '../store/store.ts';

/** Input states that mean "the step is still moving" (a stop request is still `processing`). */
const UNSETTLED: readonly InputStatus[] = ['queued', 'processing'];
/** Chief input states that already own the session: a notice would only queue behind them. */
const CHIEF_BUSY: readonly InputStatus[] = ['queued', 'processing', 'interrupted'];

export interface StepWakeResult {
  readonly woken: boolean;
  readonly noticeId?: string;
  readonly reason:
    | 'woken'
    | 'no-task'
    | 'not-running'
    | 'no-step'
    | 'step-busy'
    | 'chief-busy'
    | 'already-notified';
}

/** One stable id per dispatched step: the sorted member inputs that step waits on. */
export function stepNoticeId(taskId: string, memberInputIds: readonly string[]): string {
  const digest = createHash('sha256')
    .update([...memberInputIds].sort().join('\u0000'))
    .digest('hex')
    .slice(0, 12);
  return `notice-step-${taskId}-${digest}`;
}

/**
 * Wake the chief of `taskId` if its current step has settled and it is idle. Safe to call after any
 * input reaches a terminal state: every check is read from the store, so a stale call does nothing.
 */
export function wakeForSettledStep(store: Store, taskId: string): StepWakeResult {
  const task = store.getTask(taskId);
  if (task === undefined) {
    return { woken: false, reason: 'no-task' };
  }
  if (task.status !== 'active' && task.status !== 'waiting') {
    return { woken: false, reason: 'not-running' };
  }
  const members = store.listTaskSessions(taskId).filter((member) => task.currentSessionIds.includes(member.sessionId));
  const memberInputIds = members
    .map((member) => member.currentInputId)
    .filter((inputId): inputId is string => inputId !== null && inputId !== '');
  if (memberInputIds.length === 0) {
    // Nothing was dispatched for this step, so there is no report to recover: the chief's own turn
    // (or the user) owns what happens next.
    return { woken: false, reason: 'no-step' };
  }
  const unsettled = memberInputIds.filter((inputId) => {
    const input = store.getInput(inputId);
    return input !== undefined && UNSETTLED.includes(input.status);
  });
  if (unsettled.length > 0) {
    return { woken: false, reason: 'step-busy' };
  }
  const noticeId = stepNoticeId(taskId, memberInputIds);
  if (store.getInput(noticeId) !== undefined) {
    // One notice per dispatched step: re-entering this check must not wake the chief twice.
    return { woken: false, reason: 'already-notified' };
  }
  const chiefSessionId = task.chiefSessionId;
  const chief = store.getSession(chiefSessionId);
  if (chief === undefined || chief.roleId !== 'chief') {
    return { woken: false, reason: 'no-task' };
  }
  if (store.listInputs(chiefSessionId).some((input) => CHIEF_BUSY.includes(input.status))) {
    // It is running (its own wait will see the members) or it already has a notice to run.
    return { woken: false, reason: 'chief-busy' };
  }

  const results = store.resultsForInputs(memberInputIds);
  const reported =
    results.length === 0
      ? 'no formal report was recorded'
      : results
          .map(
            (result) =>
              `${result.resultId} (${result.kind}${result.verdict === null ? '' : `, ${result.verdict}`})`,
          )
          .join(', ');

  store.acceptInput({
    inputId: noticeId,
    projectId: task.projectId,
    sessionId: chiefSessionId,
    taskId: task.id,
    sourceKey: `step-settled:${noticeId}`,
    requestKey: noticeId,
    method: 'session.system_notice',
    kind: 'system_notice',
    payload: {
      content: [
        {
          type: 'text',
          text:
            `The host woke you because the Task's current step has settled and your previous turn had ` +
            `already ended: Task ${task.id} (${task.type}, phase ${task.phase}) has no unfinished member ` +
            `work. Results: ${reported}. Read the results before deciding; the host advanced nothing. ` +
            'Continue the Task: dispatch the next step, or complete, pause or cancel it as the facts require.',
        },
      ],
    },
  });
  return { woken: true, noticeId, reason: 'woken' };
}
