import { useI18n } from '../i18n/I18nProvider';
import { State } from '../app/State';
import { usePhaseLabel } from './task-labels';
import { flowOf } from './task-flow';
import type { TaskDetail } from '../state/slot';

/**
 * The flow of the running Task, as one line. The steps are `flowOf` — the very array the task
 * list below draws — so the strip is the outline of the list, never a second opinion: same
 * order, same rounds, same planned tail, same position count.
 *
 * Each position is a dot and its word (U3: a colour is never the only state, and here the dot
 * shape carries it too): finished → filled with a check, the step being worked on → a hollow dot
 * that pulses in the run colour, planned → a dim hollow dot. The segments between dots light up
 * as far as the Task really got; the planned part stays a dashed line, so the road ahead is
 * visibly not progress.
 *
 * The whole strip disappears when the Task is over: a finished Task is history, and history
 * belongs in the transcript.
 */
export function TaskStrip({ detail, onOpenTask, onPause, onResume, pendingQuestions }: TaskStripProps) {
  const { t } = useI18n();
  const phaseLabel = usePhaseLabel();
  if (detail === null) return null;

  const { task, members } = detail;
  if (task.status === 'completed' || task.status === 'cancelled') return null;

  const flow = flowOf({ task, members, pendingQuestions });
  const doneSteps = new Set(flow.filter((step) => step.done));
  const running = members.filter((member) => member.activity === 'processing').length;
  // Everything before the first unfinished real step is past; a paused Task holds its place.
  const active = flow.findIndex((step) => step.kind !== 'plan' && !step.done);
  // How far along the drawn road the Task really is: finished steps only, planned never counts.
  const real = flow.filter((step) => step.kind !== 'plan');

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
        <ol className="phases" data-testid="task-phases">
          {flow.map((step, index) => {
            const plan = step.kind === 'plan';
            const here = index === active;
            const classes = ['p'];
            if (plan) classes.push('plan');
            else if (step.done) classes.push('done');
            if (here) classes.push('cur', step.kind);
            return (
              <li
                key={`${step.phase}-${step.round}`}
                className={classes.join(' ')}
                data-phase={step.phase}
                data-state={plan ? 'plan' : step.done ? 'done' : here ? step.kind : 'idle'}
                {...(here ? { 'aria-current': 'step' } : {})}
              >
                {/* A check only on a step that finished: a dot that has not earned it stays hollow. */}
                <span className="dot" aria-hidden="true">
                  {step.done ? '✓' : undefined}
                </span>
                <span className="nm">
                  {phaseLabel(step.phase)}
                  {step.round > 1 ? <span className="x"> ×{step.round}</span> : undefined}
                </span>
              </li>
            );
          })}
        </ol>
        <span className="sp" />
        {/* Progress is what finished, not where the cursor is: the current step is still owed. */}
        <span className="prog" aria-hidden="true">
          <span className="bar" style={{ width: `${String(real.length === 0 ? 0 : Math.round((doneSteps.size / real.length) * 100))}%` }} />
        </span>
        <span className="f3 prog-n mono">
          {doneSteps.size}/{real.length}
        </span>
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
