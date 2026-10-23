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
}

/**
 * The task strip: which Task this session coordinates, how far the phase chain has got, who is
 * working and the one control that matters (pause / resume). It sits above the transcript and
 * disappears entirely when there is no Task — an empty strip is noise.
 */
export function TaskStrip({ detail, pendingQuestions, membersOpen, onToggleMembers, onFollow, onPause, onResume, onOpenTask }: TaskStripProps) {
  const { t } = useI18n();
  const phaseLabel = usePhaseLabel();
  if (detail === null) return null;

  const { task, members } = detail;
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
          <button type="button" className="chip-btn" onClick={onToggleMembers} aria-expanded={membersOpen}>
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
      {membersOpen && members.length > 0 && (
        <div className="mlist strip-m">
          {members.map((member) => (
            <button key={member.sessionId} type="button" className="mrow" onClick={() => onFollow(member.sessionId)}>
              <MemberGlyph member={member} />
              <span className="ml">{member.label}</span>
              <span className="mn ell">{phaseLabel(member.phase)}</span>
              <span className="mo">{t('chat.member.follow')}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function MemberGlyph({ member }: { member: TaskDetail["members"][number] }) {
  const { t } = useI18n();
  if (member.activity === 'processing') return <State kind="run">{t('tool.running')}</State>;
  if (member.activity === 'queued') return <State kind="wait">{t('queue.queued')}</State>;
  if (member.lastInputStatus === 'completed') return <State kind="done">{t('tool.done')}</State>;
  if (member.lastInputStatus === 'failed') return <State kind="block">{t('tool.failed')}</State>;
  return <State kind="idle">{t('common.none')}</State>;
}
