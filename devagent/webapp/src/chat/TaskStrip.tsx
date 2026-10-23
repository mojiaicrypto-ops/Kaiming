import { useI18n } from '../i18n/I18nProvider';
import { State } from '../app/State';
import { usePhaseLabel, type TaskMemberRow } from './ToolTask';
import type { TaskDetail } from '../state/slot';

/** The order the phases really happen in (store TaskPhase), used only to sort what the Task did. */
const PHASE_ORDER = ['clarify', 'analyze', 'design', 'plan', 'develop', 'review', 'test', 'settle'] as const;

/**
 * The steps this Task has really taken: every phase one of its members worked in, plus the phase it
 * is in now, in phase order. A document Task therefore reads "clarify → design", not "plan → develop
 * → review → test → settle": a chain that was never run is not progress, and a test step the chief
 * did not ask for (requiresTest=false) is not a step at all.
 */
function chainOf(phases: readonly string[]): readonly string[] {
  const seen = new Set(phases);
  return PHASE_ORDER.filter((phase) => seen.has(phase));
}

export interface TaskStripProps {
  readonly detail: TaskDetail | null;
  readonly pendingQuestions: number;
  readonly membersOpen: boolean;
  readonly onToggleMembers: () => void;
  readonly onFollow: (sessionId: string) => void;
  readonly onPause: () => void;
  readonly onResume: () => void;
  /** Opens the Task detail: goal, scope and the reports it produced. */
  readonly onOpenTask: () => void;
  /** The member whose transcript is open on the right, if any: its row stays highlighted. */
  readonly followedSessionId: string | null;
}

/** How a member's assignment really ended; idle alone cannot tell "finished" from "never started". */
function memberOutcomeKey(member: TaskDetail['members'][number]): string {
  if (member.activity === 'processing') return 'tool.running';
  if (member.activity === 'queued') return 'queue.queued';
  if (member.lastInputStatus === 'completed') return 'tool.done';
  if (member.lastInputStatus === 'failed') return 'tool.failed';
  if (member.lastInputStatus === 'stopped') return 'tool.failed';
  if (member.lastInputStatus === 'interrupted') return 'shell.reconnecting';
  return 'common.none';
}

/**
 * The task strip: the Task this session coordinates, how far its real phase chain has got, and who
 * is working on it. With the panel open it is the whole picture of the run — the goal, one row per
 * specialist Session (role, step, live state, result), and the reports those sessions delivered —
 * so the user can see progress and open any member's transcript without leaving the conversation.
 * It disappears entirely when there is no Task: an empty strip is noise.
 */
export function TaskStrip({ detail, pendingQuestions, membersOpen, onToggleMembers, onFollow, onPause, onResume, onOpenTask, followedSessionId }: TaskStripProps) {
  const { t } = useI18n();
  const phaseLabel = usePhaseLabel();
  if (detail === null) return null;

  const { task, members, results } = detail;
  const phases = chainOf([...members.map((member) => member.phase), task.phase]);
  const currentIndex = task.status === 'completed' ? phases.length : phases.indexOf(task.phase);
  const running = members.filter((member) => member.activity === 'processing').length;

  const state =
    task.status === 'completed' ? (
      <State kind="done">{t('task.completed')}</State>
    ) : task.status === 'pausing' ? (
      <State kind="wait">{t('task.pausing')}</State>
    ) : task.status === 'paused' ? (
      <State kind="paused">{t('task.paused')}</State>
    ) : pendingQuestions > 0 ? (
      <State kind="decide">{t('task.waitingYou')}</State>
    ) : running > 0 ? (
      <State kind="run">{t('task.running', { count: running })}</State>
    ) : (
      <State kind="run">{t('task.chiefWorking')}</State>
    );

  return (
    <div className="task-strip" data-testid="task-strip">
      <div className="in">
        <button type="button" className="chip-btn mono" onClick={onOpenTask} data-testid="task-open">
          {task.taskId}
        </button>
        <span className="phases">
          {phases.map((phase, index) => (
            <span key={phase} style={{ display: 'contents' }}>
              {index > 0 && <span className="sep">─</span>}
              <span className={`p${index < currentIndex ? ' done' : index === currentIndex ? ' cur' : ''}`}>
                {index < currentIndex ? '✓ ' : ''}
                {phaseLabel(phase)}
              </span>
            </span>
          ))}
        </span>
        {members.length > 0 && (
          <button type="button" className="chip-btn" onClick={onToggleMembers} aria-expanded={membersOpen} data-testid="task-members-toggle">
            {t('task.members', { count: members.length })} {membersOpen ? '▴' : '▾'}
          </button>
        )}
        <span className="sp" />
        {state}
        {task.status === 'paused' ? (
          <button type="button" className="btn ghost" onClick={onResume}>
            {t('task.resume')}
          </button>
        ) : task.status === 'active' || task.status === 'waiting' ? (
          <button type="button" className="btn ghost" onClick={onPause} data-testid="task-pause">
            {t('task.pause')}
          </button>
        ) : null}
      </div>
      {membersOpen && (
        <div className="strip-panel" data-testid="task-panel">
          <div className="strip-goal">{task.goal}</div>
          {members.length > 0 && (
            <div className="mlist">
              {members.map((member) => {
                const state = member.activity === 'processing' ? 'run' : member.activity === 'queued' ? 'wait' : 'idle';
                const followed = member.sessionId === followedSessionId;
                return (
                  <div key={member.sessionId} className={`mrow${followed ? ' on' : ''}`} data-testid="task-member-row" data-state={state}>
                    <span className="mr">{t(`chat.role.${member.roleId}` as 'chat.role.member')}</span>
                    <span className="ml ell" title={member.label}>{member.label}</span>
                    <span className="mn">{phaseLabel(member.phase)}</span>
                    <span className="ms ell">{member.expectedKind}</span>
                    <State kind={state === 'run' ? 'run' : state === 'wait' ? 'wait' : member.lastInputStatus === 'failed' ? 'block' : member.lastInputStatus === 'completed' ? 'done' : 'idle'}>
                      {t(memberOutcomeKey(member) as 'tool.done')}
                    </State>
                    <button type="button" className="mo" onClick={() => onFollow(member.sessionId)} data-testid="task-member-open">
                      {followed ? t('chat.member.opened') : t('chat.member.open')}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          {results.length > 0 && (
            <div className="strip-results">
              {results.map((result) => (
                <button key={result.resultId} type="button" className="sres" onClick={onOpenTask} data-testid="task-strip-result">
                  <State kind={result.verdict === 'passed' ? 'done' : result.verdict === 'failed' ? 'block' : 'idle'}>
                    {result.kind}
                  </State>
                  <span className="ell">{result.summary ?? result.label ?? result.resultId}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
