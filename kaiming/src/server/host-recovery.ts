/**
 * Host-side recovery for a chief's own interrupted input.
 *
 * The claim gate refuses every later input of a session that still holds an interrupted one, and a
 * chief cannot resolve its own input (it cannot run at all to do it). The host owns that closure: it
 * records what it really knows (the run was aborted, the process is gone), leaves that evidence on
 * the row, and tells the chief to verify the real state before assuming anything. A recent question
 * is not re-sent: the conversation continues with the user's next message.
 */
import type { Store } from '../store/store.ts';

export interface HostCloseReason {
  /** Short identifier recorded in the recovery evidence (e.g. `process-restart`). */
  readonly code: string;
  /** What the host observed, in the chief's own words. */
  readonly detail: string;
}

export interface HostCloseResult {
  readonly closed: boolean;
  readonly noticeId?: string;
}

/**
 * Close one interrupted input of a chief session (no-op for another role, another status, or an
 * unknown input). Returns whether the row was closed and the notice that explains it.
 */
export function closeInterruptedChiefInput(
  store: Store,
  inputId: string,
  reason: HostCloseReason,
): HostCloseResult {
  const input = store.getInput(inputId);
  if (input === undefined || input.status !== 'interrupted') {
    return { closed: false };
  }
  const session = store.getSession(input.sessionId);
  if (session === undefined || session.roleId !== 'chief') {
    return { closed: false };
  }
  store.resolveInterruptedInput({
    sessionId: session.id,
    inputId,
    expectedRevision: input.revision,
    resolution: 'stopped',
    evidenceRefs: [`host:${reason.code}`],
    resolvedBy: `host:${reason.code}`,
  });
  // The notice is about the run that just died: during a Task it belongs to that Task, or the claim
  // gate would keep it behind the Task it is meant to warn about.
  const noticeTaskId = input.taskId ?? session.currentTaskId;
  const noticeId = `notice-host-closed-${inputId}`;
  if (store.getInput(noticeId) === undefined) {
    store.acceptInput({
      inputId: noticeId,
      projectId: session.projectId,
      sessionId: session.id,
      ...(noticeTaskId !== null ? { taskId: noticeTaskId } : {}),
      sourceKey: `host-closed:${inputId}`,
      requestKey: noticeId,
      method: 'session.system_notice',
      kind: 'system_notice',
      payload: {
        content: [
          {
            type: 'text',
            text:
              `The host closed your interrupted input ${inputId} as stopped (${reason.detail}). ` +
              'Its outcome is unknown, so verify the real state (files, git, results) before ' +
              'continuing, and do not assume it finished.',
          },
        ],
      },
    });
  }
  return { closed: true, noticeId };
}

export interface InterruptedMemberInput {
  readonly inputId: string;
  readonly sessionId: string;
  readonly taskId: string;
  readonly errorCode: string | null;
  readonly chiefSessionId: string;
}

/** The one id both the startup scan and a live watchdog abort use for the same member input. */
export function interruptedMemberNoticeId(inputId: string): string {
  return `notice-${inputId}`;
}

/**
 * Tell the owning chief that a member run has no verified outcome. Only the chief can verify it and
 * close it (`task(op=recover)`); without this notice the step waits forever on unknown work. The id
 * is derived from the member input, so the startup scan and a live watchdog abort agree on one row.
 */
export function queueInterruptedMemberNotice(
  store: Store,
  interrupted: InterruptedMemberInput,
  detail: string,
): { readonly queued: boolean; readonly noticeId: string } {
  const noticeId = interruptedMemberNoticeId(interrupted.inputId);
  if (store.getInput(noticeId) !== undefined) {
    return { queued: false, noticeId };
  }
  const chief = store.getSession(interrupted.chiefSessionId);
  if (chief === undefined) {
    return { queued: false, noticeId };
  }
  store.acceptInput({
    inputId: noticeId,
    projectId: chief.projectId,
    sessionId: interrupted.chiefSessionId,
    taskId: interrupted.taskId,
    sourceKey: `recovery-notice:${interrupted.inputId}`,
    requestKey: noticeId,
    method: 'session.system_notice',
    kind: 'system_notice',
    payload: {
      content: [
        {
          type: 'text',
          text:
            `The host detected an interrupted run. Member input ${interrupted.inputId} ` +
            `(session ${interrupted.sessionId}, Task ${interrupted.taskId}` +
            `${interrupted.errorCode === null ? '' : `, code ${interrupted.errorCode}`}) ${detail}. ` +
            'Its outcome is unknown. Verify the real state (investigator + expectedKind=recovery, or ' +
            'your own read-only checks), then close it with ' +
            `task(op=recover, sessionId=${interrupted.sessionId}, evidenceRefs=[...], ` +
            'resolution=completed|failed|stopped) citing that evidence. Do not assume it finished.',
        },
      ],
    },
  });
  return { queued: true, noticeId };
}
