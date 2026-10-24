import { useI18n } from '../i18n/I18nProvider';
import { State } from '../app/State';
import { usePhaseLabel } from './task-labels';
import type { TaskDetail } from '../state/slot';

/** The order the phases really happen in (store TaskPhase), used only to sort what the Task did. */
const PHASE_ORDER = ['clarify', 'analyze', 'design', 'plan', 'develop', 'review', 'test', 'settle'] as const;

/**
 * The steps this Task has really taken: every phase one of its members worked in, plus the phase it
 * is in now, in phase order. A document Task therefore reads "clarify → design", not "plan → develop
 * → review → test → settle": a chain that was never run is not progress, and a test step the chief
 * did not ask for (requiresTest=false) is not a step at all.
 */
export function chainOf(phases: readonly string[]): readonly string[] {
  const seen = new Set(phases);
  return PHASE_ORDER.filter((phase) => seen.has(phase));
}

/**
 * Where the Task is, and nothing else. The members of a step are not a toolbar: they are part of the
 * conversation at the point the chief dispatched them, so they render in the transcript (ToolTask's
 * dispatch card) and this strip stays one line. It disappears when the Task is over: a finished Task
 * is history, and history belongs in the transcript, not in a permanent header.
 */
export function TaskStrip({ detail, onOpenTask, onPause, onResume, pendingQuestions }: TaskStripProps) {
  const { t } = useI18n();
  const phaseLabel = usePhaseLabel();
  if (detail === null) return null;

  const { task, members } = detail;
  if (task.status === 'completed' || task.status === 'cancelled') return null;

  const phases = chainOf([...members.map((member) => member.phase), task.phase]);
  const currentIndex = phases.indexOf(task.phase);
  const running = members.filter((member) => member.activity === 'processing').length;

  const state =
    task.status === 'pausing' ? (
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
        <span className="sp" />
        {state}
        {task.status === 'paused' ? (
          <button type="button" className="btn ghost" onClick={onResume}>
            {t('task.resume')}
          </button>
        ) : (
          <button type="button" className="btn ghost" onClick={onPause} data-testid="task-pause">
            {t('task.pause')}
          </button>
        )}
      </div>
    </div>
  );
}

export interface TaskStripProps {
  readonly detail: TaskDetail | null;
  readonly pendingQuestions: number;
  readonly onPause: () => void;
  readonly onResume: () => void;
  /** Opens the Task detail: goal, scope and the reports it produced. */
  readonly onOpenTask: () => void;
}
