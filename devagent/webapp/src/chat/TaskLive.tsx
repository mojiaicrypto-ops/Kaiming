import { useI18n } from '../i18n/I18nProvider';
import { State } from '../app/State';
import { usePhaseLabel, type TaskMemberRow } from './task-labels';
import type { TaskDetail } from '../state/slot';

/**
 * The members of a step, one row each: what that Session is doing right now, where it works, and a
 * way into its own transcript. Shared by the dispatch card (where the step was ordered) and the live
 * block (what is running now), so the two can never describe the same member differently.
 */
export function TaskMemberRows({
  rows,
  onFollow,
  testId,
}: {
  readonly rows: readonly TaskMemberRow[];
  readonly onFollow: (sessionId: string) => void;
  readonly testId?: string;
}) {
  const { t } = useI18n();
  // Compact left column, the way the design reads: a glyph and two or three characters, never a
  // sentence that pushes the name of the member out of its column.
  const stateOf = (row: TaskMemberRow): { kind: 'decide' | 'run' | 'wait' | 'done' | 'block' | 'idle'; label: string } => {
    if (row.waitingUser === true) return { kind: 'decide', label: t('task.state.waiting') };
    if (row.activity === 'processing') return { kind: 'run', label: t('task.state.running') };
    if (row.activity === 'queued') return { kind: 'wait', label: t('task.state.queued') };
    if (row.lastInputStatus === 'completed') return { kind: 'done', label: t('task.state.done') };
    if (row.lastInputStatus === 'failed') return { kind: 'block', label: t('task.state.failed') };
    if (row.lastInputStatus === 'stopped' || row.lastInputStatus === 'interrupted') {
      return { kind: 'block', label: t('task.state.stopped') };
    }
    return { kind: 'idle', label: t('task.state.idle') };
  };
  return (
    <div className="mlist" data-testid={testId}>
      {rows.map((row) => {
        const state = stateOf(row);
        return (
          <button
            key={row.sessionId}
            type="button"
            className="mrow"
            onClick={() => onFollow(row.sessionId)}
            data-testid="task-member-row"
            data-state={state.kind}
          >
            <State kind={state.kind}>{state.label}</State>
            <span className="ml">{row.label}</span>
            <span className="mn ell" title={row.note || row.assignment}>
              {row.note || row.assignment}
            </span>
            <span className="mo">{t('chat.member.follow')}</span>
          </button>
        );
      })}
    </div>
  );
}

export interface TaskLiveProps {
  readonly detail: TaskDetail;
  readonly members: readonly TaskMemberRow[];
  readonly pendingQuestions: number;
  readonly onFollow: (sessionId: string) => void;
  readonly onOpenTask: () => void;
}

/**
 * The Task that is running right now, in the conversation.
 *
 * The dispatch card cannot carry this on its own: while the chief waits inside the tool call, the
 * assistant message that holds the call has not ended, so it is not in history and a reload has
 * nothing to render. The run is still real, so the live frontier has to say so - which Task, what
 * it is for, where it is, and who is working on it. As soon as the call returns its own card appears
 * in the transcript and this block steps aside (the caller decides, see ChatPage).
 */
export function TaskLive({ detail, members, pendingQuestions, onFollow, onOpenTask }: TaskLiveProps) {
  const { t } = useI18n();
  const phaseLabel = usePhaseLabel();
  const { task } = detail;
  const running = members.filter((member) => member.activity === 'processing').length;
  const state =
    pendingQuestions > 0
      ? { kind: 'decide' as const, label: t('task.waitingYou') }
      : task.status === 'paused'
        ? { kind: 'paused' as const, label: t('task.paused') }
        : task.status === 'pausing'
          ? { kind: 'wait' as const, label: t('task.pausing') }
          : running > 0
            ? { kind: 'run' as const, label: t('task.running', { count: running }) }
            : { kind: 'run' as const, label: t('task.chiefWorking') };

  return (
    <div className="obj live-run" data-testid="task-live">
      <div className="row">
        <button type="button" className="chip-btn mono" onClick={onOpenTask} data-testid="task-live-open">
          {task.taskId}
        </button>
        <b>{phaseLabel(task.phase)}</b>
        <span className="sp" />
        <State kind={state.kind}>{state.label}</State>
      </div>
      <div className="live-goal">{task.goal}</div>
      {members.length > 0 && <TaskMemberRows rows={members} onFollow={onFollow} testId="task-live-members" />}
    </div>
  );
}
