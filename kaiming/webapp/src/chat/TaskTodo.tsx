import { useI18n } from '../i18n/I18nProvider';
import { State } from '../app/State';
import { Markdown } from './Markdown';
import { reportReasonOf, usePhaseLabel, type TaskMemberRow } from './task-labels';
import type { TaskDetail } from '../state/slot';
import { flowOf } from './task-flow';
import { Elapsed } from './Elapsed';
/** One phase-round of the roster: members enter in creation order, and a phase that
 * reappears after a different phase (develop → review → develop) is a new round —
 * that reappearance IS the rework the user asked to see. */
export interface RosterGroup<T> {
  readonly phase: string;
  readonly round: number;
  readonly rows: readonly T[];
}

export function rosterGroupsOf<T extends { readonly phase: string }>(
  members: readonly T[],
  currentPhase: string,
): readonly RosterGroup<T>[] {
  const groups: RosterGroup<T>[] = [];
  const rounds = new Map<string, number>();
  let previous = '';
  for (const row of members) {
    if (row.phase !== previous) {
      rounds.set(row.phase, (rounds.get(row.phase) ?? 0) + 1);
      groups.push({ phase: row.phase, round: rounds.get(row.phase) ?? 1, rows: [row] });
      previous = row.phase;
    } else {
      const last = groups[groups.length - 1];
      if (last !== undefined) groups[groups.length - 1] = { ...last, rows: [...last.rows, row] };
    }
  }
  if (currentPhase !== '' && currentPhase !== previous) {
    // The task's own phase can be ahead of every member (nothing dispatched there yet).
    groups.push({ phase: currentPhase, round: (rounds.get(currentPhase) ?? 0) + 1, rows: [] });
  }
  return groups;
}
export interface TaskTodoProps {
  readonly detail: TaskDetail;
  readonly members: readonly TaskMemberRow[];
  readonly pendingQuestions: number;
  /** The Plan as the chief wrote it at create time; the roster is the steps, this is the intent. */
  readonly planMarkdown?: string | undefined;
  readonly onFollow: (sessionId: string) => void;
  readonly onOpenTask: () => void;
}

/**
 * The running Task, as one list in the conversation. This block is the ONLY place live member
 * state lives: the dispatch cards in the transcript are history (one line each), and this list
 * carries every member the Task ever dispatched — grouped by phase-round, so a rework round
 * reads as "develop ran twice, review failed in between", not as a rewritten roster.
 *
 * The steps come from `flowOf`, the same array the Task strip draws: the strip is the outline,
 * this list is the detail, and neither can invent a step the other does not have. Every step
 * sits on one rail (done → check, running → pulsing node, planned → hollow dotted), so the list
 * reads as a descending flow instead of stacked labels.
 */
export function TaskTodo({ detail, members, pendingQuestions, planMarkdown, onFollow, onOpenTask }: TaskTodoProps) {
  const { t } = useI18n();
  const phaseLabel = usePhaseLabel();
  const { task } = detail;
  const running = members.filter((member) => member.activity === 'processing').length;
  // Same grouping the flow summarises, so step i is group i: the flow only adds the tail.
  const groups = rosterGroupsOf(members, task.phase);
  const flow = flowOf({ task, members, pendingQuestions });
  const settledCount = members.filter(
    (member) => member.lastInputStatus === 'completed' || member.lastInputStatus === 'failed' || member.lastInputStatus === 'stopped' || member.lastInputStatus === 'interrupted',
  ).length;

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

  const planLines = planMarkdown === undefined ? 0 : planMarkdown.split('\n').filter((line) => line.trim() !== '').length;
  // The step being worked on: the first real step that is not finished.
  const activeStep = flow.findIndex((step) => step.kind !== 'plan' && !step.done);
  // The last step that really ran (planned steps never carry members).
  const lastReal = flow.reduce((last, step, index) => (step.kind === 'plan' ? last : index), -1);

  return (
    <div
      className={`todo${running > 0 || pendingQuestions > 0 ? ' running' : ''}`}
      data-testid="task-live"
    >
      <div className="todo-h">
        <button type="button" className="chip-btn mono" onClick={onOpenTask} data-testid="todo-open">
          {task.taskId}
        </button>
        <span className="f2">{phaseLabel(task.phase)}</span>
        <span className="f3">{t('task.todoProgress', { done: settledCount, total: members.length })}</span>
        <span className="sp" />
        <State kind={state.kind}>{state.label}</State>
      </div>
      {planLines > 0 && (
        <details className="todo-plan">
          <summary>
            <State kind="done" />
            {t('task.planLines', { count: planLines })}
          </summary>
          <div className="obj-b">
            <Markdown text={planMarkdown ?? ''} />
          </div>
        </details>
      )}
      {/* The flow, all of it: a real step is a node on the rail, a planned one is a hollow node
          past the last real step — the road ahead, dim, and it never claims progress. */}
      <ol className="steps steps-head" data-testid="task-steps">
        {flow.map((step, index) => {
          const group = step.kind === 'plan' ? undefined : groups[index];
          const classes = ['todo-g', 'step', step.kind];
          if (step.done) classes.push('done');
          if (index === activeStep) classes.push('active');
          return (
            <li
              key={group === undefined ? `plan-${step.phase}` : `${step.phase}-${step.round}`}
              className={classes.join(' ')}
              data-phase={step.phase}
              {...(group === undefined ? { 'data-planned': 'true' } : { 'data-round': step.round })}
            >
              <span className="node" aria-hidden="true">
                {step.done ? '✓' : undefined}
              </span>
              <div className="todo-g-h">
                <span className="nm">
                  {phaseLabel(step.phase)}
                  {step.round > 1 ? <span className="rnd"> · {t('task.round', { n: step.round })}</span> : undefined}
                </span>
                {step.members > 0 ? <span className="mt">{t('task.stepMembers', { count: step.members })}</span> : undefined}
              </div>
              {group === undefined ? (
                <div className="todo-empty">{t('task.notStarted')}</div>
              ) : group.rows.length === 0 ? (
                <div className="todo-empty" data-testid={`todo-${step.phase}-empty`}>
                  {t('task.waitingDispatch')}
                </div>
              ) : (
                <div className="mlist" data-testid={index === lastReal ? 'task-live-members' : undefined}>
                  {group.rows.map((row) => (
                    <TodoMemberRow key={row.sessionId} row={row} laterRound={step.round > 1} onFollow={onFollow} />
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** One member row's glyph and word. A finished input is not a pass on its own: the latest report's
 * verdict decides, the same predicate `task-flow.ts` uses for steps (X-04: the two must agree).
 */
export function memberRowState(row: TaskMemberRow): {
  readonly kind: 'decide' | 'run' | 'wait' | 'block' | 'done' | 'idle';
  readonly note: 'asking' | 'running' | 'queued' | 'failed' | 'missingReport' | 'done' | 'idle';
} {
  const verdict = row.latestVerdict ?? null;
  if (row.waitingUser === true) return { kind: 'decide', note: 'asking' };
  if (row.activity === 'processing') return { kind: 'run', note: 'running' };
  if (row.activity === 'queued') return { kind: 'wait', note: 'queued' };
  if (row.reportMissing === true) return { kind: 'block', note: 'missingReport' };
  if (verdict === 'blocked') return { kind: 'decide', note: 'asking' };
  if (row.lastInputStatus === 'failed' || verdict === 'failed') return { kind: 'block', note: 'failed' };
  if (row.lastInputStatus === 'completed') return { kind: 'done', note: 'done' };
  return { kind: 'idle', note: 'idle' };
}

function TodoMemberRow({
  row,
  laterRound,
  onFollow,
}: {
  readonly row: TaskMemberRow;
  readonly laterRound: boolean;
  readonly onFollow: (sessionId: string) => void;
}) {
  const { t } = useI18n();
  // A member back at work after its report already exists is rework, not a first pass; and a
  // failed assignment is the evidence that triggered whatever round follows it.
  const rework = laterRound && row.activity === 'processing';
  const state = memberRowState(row);
  const kind = state.kind;
  // A member that failed names its reason when the terminal code has a sentence — for a plain
  // failure and for a missing report (WHY it is missing reads differently per code). Rows
  // without a resolvable code keep the generic note; an unknown failed code stays visible.
  const reason =
    state.note === 'failed' || state.note === 'missingReport' ? reportReasonOf(row, t) : null;
  const label =
    state.note === 'asking'
      ? t('task.note.asking', { title: row.note === '' ? '' : row.note })
      : reason !== null
        ? reason
        : state.note === 'failed' && row.errorCode !== null && row.errorCode !== undefined && row.errorCode !== ''
          ? row.errorCode
          : t(`task.state.${state.note}` as 'task.state.missingReport');
  return (
    <button type="button" className="mrow" data-testid="task-member-row" onClick={() => onFollow(row.sessionId)}>
      <State kind={kind} />
      <span className="ml">
        {rework ? <span className="rw" title={t('task.rework')}>↻ </span> : undefined}
        <b>{row.label}</b>
        {row.assignment === '' ? '' : <span className="mn"> — {row.assignment}</span>}
      </span>
      <Elapsed
        className="mdur f3 mono"
        testId="member-elapsed"
        startedAt={row.executionStartedAt}
        endedAt={row.executionEndedAt}
      />
      <span className="mo" title={label}>{label}</span>
    </button>
  );
}
