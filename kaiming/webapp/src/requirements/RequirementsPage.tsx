import { useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { State } from '../app/State';
import { RequirementDrawer } from './RequirementDrawer';
import { columnOf, useRequirements, useTasks, type Column, type RequirementSummary, type TaskRowSummary } from './requirement-model';
import { usePhaseLabel } from '../chat/task-labels';
import type { RpcClient } from '../api/rpc';
import { Elapsed } from '../chat/Elapsed';
import { taskEndedAt } from '../chat/task-time';

export interface RequirementsPageProps {
  readonly rpc: RpcClient;
  readonly projectId: string;
  readonly selected: string | null;
  readonly onSelect: (id: string | null) => void;
  readonly onNotice: (message: string, kind: 'info' | 'success' | 'error') => void;
  /** Fills the chat composer with a request about one requirement, then switches to the chat. */
  readonly onHandOff: (text: string) => void;
  /** Opens the chief session that coordinates a Task. */
  readonly onOpenTaskSession: (sessionId: string) => void;
}

const COLUMNS: ReadonlyArray<{ column: Column; key: 'req.col.proposal' | 'req.col.todo' | 'req.col.doing' | 'req.col.done'; glyph: 'idle' | 'wait' | 'run' | 'done' }> = [
  { column: 'proposal', key: 'req.col.proposal', glyph: 'idle' },
  { column: 'todo', key: 'req.col.todo', glyph: 'wait' },
  { column: 'doing', key: 'req.col.doing', glyph: 'run' },
  { column: 'done', key: 'req.col.done', glyph: 'done' },
];

/** A Task row's state: the six server statuses, folded onto the four words the board uses. */
function taskState(task: TaskRowSummary): {
  glyph: 'run' | 'wait' | 'paused' | 'done' | 'block';
  key: 'task.status.active' | 'task.status.waiting' | 'task.status.paused' | 'task.status.cancelled' | 'task.status.completed';
} {
  if (task.status === 'completed') return { glyph: 'done', key: 'task.status.completed' };
  if (task.status === 'cancelled') return { glyph: 'block', key: 'task.status.cancelled' };
  if (task.status === 'paused' || task.status === 'pausing' || task.status === 'cancelling') {
    return { glyph: 'paused', key: 'task.status.paused' };
  }
  if (task.status === 'waiting') return { glyph: 'wait', key: 'task.status.waiting' };
  return { glyph: 'run', key: 'task.status.active' };
}

/** Card status word, from the record itself: the board never invents a fifth state. */
function cardState(card: RequirementSummary): { glyph: 'idle' | 'wait' | 'run' | 'done' | 'block'; key: 'req.state.idle' | 'req.state.todo' | 'req.state.done' | 'req.state.paused' } {
  if (card.status === 'completed') return { glyph: 'done', key: 'req.state.done' };
  if (card.status === 'in_progress') return { glyph: 'run', key: 'req.state.todo' };
  if (card.status === 'cancelled' || card.status === 'archived') return { glyph: 'block', key: 'req.state.paused' };
  if (card.kind === 'proposal') return { glyph: 'idle', key: 'req.state.idle' };
  return { glyph: 'wait', key: 'req.state.todo' };
}

/**
 * The requirement board: four columns that are views of one record set, a notice for files that
 * could not be parsed (kept visible — a silently dropped requirement is worse than a warning),
 * and a drawer with the record's own sections.
 */
export function RequirementsPage({ rpc, projectId, selected, onSelect, onNotice, onHandOff, onOpenTaskSession }: RequirementsPageProps) {
  const { t } = useI18n();
  const phaseLabel = usePhaseLabel();
  const { items, invalid, loading, error, reload } = useRequirements(rpc, projectId);
  const { tasks, tasksError, reloadTasks, loadMoreTasks, hasMoreTasks } = useTasks(rpc, projectId);
  /**
   * The board is the screen; Tasks are the one part of it nobody opens most of the time. Closed by
   * default, so the columns get the whole height — and the header says how many are running, which
   * is the only thing worth knowing while it is folded.
   */
  const [tasksOpen, setTasksOpen] = useState(false);
  const runningTasks = tasks.filter((task) => task.status === 'active' || task.status === 'waiting').length;
  const invalidSelection = selected !== null && selected.startsWith('invalid:') ? selected.slice('invalid:'.length) : null;
  const card = selected === null ? undefined : items.find((item) => item.id === selected);

  return (
    <section className="page">
      <div className="page-h">
        <h1>{t('req.title')}</h1>
        <span className="sp" />
        <button type="button" className="btn ghost" onClick={() => void reload()}>
          {t('common.retry')}
        </button>
      </div>
      {error !== null && (
        <div className="notice">
          <State kind="block">{t('req.readFailed', { reason: error })}</State>
        </div>
      )}
      {invalid.length > 0 && (
        <div className="notice">
          <State kind="block">{t('req.invalid', { path: invalid[0]?.file ?? '' })}</State>
          <span className="sp" />
          <button type="button" className="lnk" onClick={() => onSelect(`invalid:${invalid[0]?.file ?? ''}`)}>
            {t('req.invalidView')}
          </button>
        </div>
      )}
      <div className="board" data-testid="board">
        {COLUMNS.map((entry) => {
          const cards = items.filter((item) => columnOf(item) === entry.column);
          return (
            <div className="colm" key={entry.column}>
              <div className="ch">
                {t(entry.key)}
                <span className="n">{cards.length}</span>
              </div>
              <div className="cards scroll">
                {cards.length === 0 && <div className="none">{t('req.none')}</div>}
                {cards.map((item) => {
                  const state = cardState(item);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className="rc"
                      aria-selected={selected === item.id}
                      onClick={() => onSelect(item.id)}
                      data-testid="requirement-card"
                    >
                      <span className="id">{item.id}</span>
                      <span className="tt">{item.title}</span>
                      <span className="mt">
                        <State kind={state.glyph}>{t(state.key)}</State>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <div className={`tasks-sec${tasksOpen ? ' open' : ''}`}>
        <button
          type="button"
          className="tasks-toggle"
          aria-expanded={tasksOpen}
          onClick={() => setTasksOpen((open) => !open)}
          data-testid="tasks-toggle"
        >
          <span className="caret" aria-hidden="true">{tasksOpen ? '▾' : '▸'}</span>
          <h2>{t('task.listTitle')}</h2>
          <span className="f3 tasks-count">
            {tasksOpen || tasks.length > 0 ? t('task.listCount', { count: tasks.length }) : t('task.listEmpty')}
          </span>
          {/* Running is stated even when folded: it is the one fact that makes opening it urgent. */}
          {!tasksOpen && runningTasks > 0 && (
            <State kind="run">{t('task.running', { count: runningTasks })}</State>
          )}
          <span className="sp" />
          {/* Reload and paging live on the header line, not in a row of their own: the list is a
              footnote of the board, and its chrome must not cost more height than its rows. */}
          {tasksOpen && hasMoreTasks && (
            <span
              className="f3 tasks-more"
              role="button"
              tabIndex={0}
              onClick={(event) => {
                event.stopPropagation();
                void loadMoreTasks();
              }}
            >
              {t('files.more')}
            </span>
          )}
          <span
            className="f3 tasks-reload"
            role="button"
            tabIndex={0}
            title={t('common.retry')}
            onClick={(event) => {
              // The header itself toggles; these two only reload, so the toggle must not fire.
              event.stopPropagation();
              void reloadTasks();
            }}
          >
            ↻
          </span>
        </button>
        {tasksOpen && (
          <>
            <div className="tasks-body">
              {tasksError !== null && <State kind="block">{tasksError}</State>}
              <div className="task-rows">
                {tasks.map((task) => (
                  <button
                    key={task.taskId}
                    type="button"
                    className="task-row"
                    onClick={() => onOpenTaskSession(task.chiefSessionId)}
                    data-testid="task-row"
                  >
                    <span className="f3 mono">{task.taskId}</span>
                    <span className="ell">{task.goal}</span>
                    <span className="sp" />
                    <span className="f3">{phaseLabel(task.phase)}</span>
                    <Elapsed
                      className="f3 mono task-time"
                      testId="task-row-elapsed"
                      startedAt={task.createdAt}
                      endedAt={taskEndedAt(task)}
                    />
                    <State kind={taskState(task).glyph}>{t(taskState(task).key)}</State>
                    <span className="f3">{t('task.members', { count: task.phaseMembers.length })}</span>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
      {loading && (
        <div className="none f3" style={{ padding: '0 var(--s8)' }}>
          {t('common.loading')}
        </div>
      )}
      {selected !== null && (
        <RequirementDrawer
          rpc={rpc}
          projectId={projectId}
          card={card}
          invalid={invalid.find((entry) => entry.file === invalidSelection)}
          invalidFile={invalidSelection}
          onClose={() => onSelect(null)}
          onHandOff={onHandOff}
        />
      )}
    </section>
  );
}
