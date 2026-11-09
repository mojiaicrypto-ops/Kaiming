import { useCallback, useEffect, useMemo, useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { State } from '../app/State';
import type { RpcClient } from '../api/rpc';

import { usePhaseLabel } from '../chat/task-labels';
import { BacklogDrawer } from './BacklogDrawer';
import {
  cellPath,
  groupsOf,
  moduleRows,
  useBacklog,
  usePendingInteractions,
  useProjectText,
  useTasks,
  type BacklogItemView,
} from './project-model';

export interface ProjectPageProps {
  readonly rpc: RpcClient;
  readonly projectId: string;
  readonly selected: string | null;
  readonly onSelect: (id: string | null) => void;
  readonly onNotice: (message: string, kind: 'info' | 'success' | 'error') => void;
  /** Fills the chief composer with a request about one item; never sends it. */
  readonly onHandOff: (text: string) => void;
  /** Opens the chief session that coordinates a Task. */
  readonly onOpenTaskSession: (sessionId: string) => void;
  /** Opens a project file in the one file canvas. */
  readonly onOpenFile: (path: string, line?: number) => void;
}

const FINISHED = new Set(['completed', 'cancelled']);
const HOLDS_SLOT = new Set(['active', 'waiting', 'pausing', 'paused', 'cancelling']);

/** The record's own state, in the user's language: the raw enum never reaches the screen. */
function statusKeyOf(
  status: string,
): 'task.status.active' | 'task.status.waiting' | 'task.status.paused' | 'task.status.completed' | 'task.status.cancelled' {
  if (status === 'completed') return 'task.status.completed';
  if (status === 'cancelled') return 'task.status.cancelled';
  if (status === 'paused' || status === 'pausing' || status === 'cancelling') return 'task.status.paused';
  if (status === 'waiting') return 'task.status.waiting';
  return 'task.status.active';
}

/**
 * The project page answers three questions in order: what is wrong, what is running, what to do
 * next (BL-04). Everything is a projection of project files and work records; nothing here is a
 * second state.
 */
export function ProjectPage({
  rpc,
  projectId,
  selected,
  onSelect,
  onNotice,
  onHandOff,
  onOpenTaskSession,
  onOpenFile,
}: ProjectPageProps) {
  const { t } = useI18n();
  const phaseLabel = usePhaseLabel();
  const backlog = useBacklog(rpc, projectId);
  const tasks = useTasks(rpc, projectId);
  const pending = usePendingInteractions(rpc, projectId);
  const project = useProjectText(rpc, projectId, '.dev/PROJECT.md');
  const [title, setTitle] = useState('');
  const [early, setEarly] = useState<readonly string[]>([]);

  useEffect(() => {
    if (projectId === '') {
      setEarly([]);
      return;
    }
    void rpc
      .call<{ entries: ReadonlyArray<{ name: string; type: string }> }>('project.files.list', {
        projectId,
        path: '.dev',
      })
      .then((read) => {
        // `.dev/requirements` is a directory, `issues.md` a file: the entry is the legacy record,
        // whatever its kind. Only the two known names are ever offered.
        setEarly(
          read.entries
            .filter((entry) => entry.name === 'issues.md' || entry.name === 'requirements')
            .map((entry) => (entry.name === 'issues.md' ? '.dev/issues.md' : '.dev/requirements/')),
        );
      })
      .catch(() => setEarly([]));
  }, [rpc, projectId]);

  const groups = useMemo(() => groupsOf(backlog.data.items), [backlog.data.items]);
  const running = tasks.tasks.filter((task) => HOLDS_SLOT.has(task.status));
  const recent = tasks.tasks.find((task) => FINISHED.has(task.status));
  const modules = moduleRows(project.text);
  const item: BacklogItemView | undefined =
    selected === null ? undefined : backlog.data.items.find((entry) => entry.id === selected);

  const add = useCallback(async () => {
    const value = title.trim();
    if (value === '') return;
    try {
      await backlog.add(value);
      setTitle('');
    } catch (error) {
      onNotice(error instanceof Error ? error.message : String(error), 'error');
    }
  }, [backlog, title, onNotice]);

  if (projectId === '') {
    return (
      <section className="page">
        <div className="page-h">
          <h1>{t('project.pageTitle')}</h1>
        </div>
        <div className="notice">
          <State kind="idle">{t('project.noProject')}</State>
        </div>
      </section>
    );
  }

  return (
    <section className="page" data-testid="project-page">
      <div className="page-h">
        <h1>{t('project.pageTitle')}</h1>
        <span className="sp" />
        <button
          type="button"
          className="btn ghost"
          onClick={() => {
            void backlog.reload();
            void tasks.reloadTasks();
          }}
        >
          {t('common.retry')}
        </button>
      </div>

      {backlog.error !== null && (
        <div className="notice">
          <State kind="block">{t('project.readFailed', { reason: backlog.error })}</State>
        </div>
      )}
      {tasks.tasksError !== null && (
        <div className="notice">
          <State kind="block">{t('project.tasksReadFailed', { reason: tasks.tasksError })}</State>
        </div>
      )}

      {backlog.data.issues.length > 0 && (
        <div className="notice" data-testid="project-issues">
          <State kind="block">{t('project.issues', { count: backlog.data.issues.length })}</State>
          <span className="sp" />
          <button type="button" className="lnk" onClick={() => onOpenFile('.dev/backlog.md')}>
            {t('project.openBacklog')}
          </button>
          <div className="f3">
            {backlog.data.issues.map((issue) => (
              <button
                key={`${String(issue.line)}-${issue.reason}`}
                type="button"
                className="lnk"
                data-testid="project-issue"
                onClick={() => onOpenFile('.dev/backlog.md', issue.line > 0 ? issue.line : undefined)}
              >
                {issue.line === 0 ? issue.reason : t('backlog.lineReason', { line: issue.line, reason: issue.reason })}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="sec" data-testid="project-progress">
        <div className="sh">{t('project.progress')}</div>
        {running.length === 0 && <div className="f3">{t('project.progressEmpty')}</div>}
        {running.map((task) => {
          const deciding = pending.byTask.get(task.taskId);
          return (
            <button
              key={task.taskId}
              type="button"
              className="rc"
              data-testid="project-task"
              onClick={() => onOpenTaskSession(task.chiefSessionId)}
            >
              <span className="id">{task.taskId}</span>
              <span className="tt">{task.goal}</span>
              <span className="mt">
                {phaseLabel(task.phase)} · {t(statusKeyOf(task.status))}
                {deciding !== undefined && (
                  <span className="tag" data-testid="project-deciding">
                    {t('project.deciding')}
                  </span>
                )}
              </span>
            </button>
          );
        })}
        {recent !== undefined && (
          <div className="f3" data-testid="project-recent">
            {t('project.recentDone', { id: recent.taskId, goal: recent.goal })}
          </div>
        )}
        {tasks.tasks.filter((task) => !running.some((row) => row.taskId === task.taskId) && task.taskId !== recent?.taskId).length > 0 && (
          <details className="sec" data-testid="project-all-tasks">
            <summary className="f3">{t('project.allTasks', { count: tasks.tasks.length })}</summary>
            {tasks.tasks
              .filter((task) => !running.some((row) => row.taskId === task.taskId) && task.taskId !== recent?.taskId)
              .map((task) => (
                <button
                  key={task.taskId}
                  type="button"
                  className="rc"
                  data-testid="project-task-all"
                  onClick={() => onOpenTaskSession(task.chiefSessionId)}
                >
                  <span className="id">{task.taskId}</span>
                  <span className="tt">{task.goal}</span>
                  <span className="mt">
                    {phaseLabel(task.phase)} · {t(statusKeyOf(task.status))}
                  </span>
                </button>
              ))}
          </details>
        )}
      </div>

      <div className="sec" data-testid="project-backlog">
        <div className="sh">{t('project.backlog')}</div>
        <div className="row">
          <input
            className="inp"
            value={title}
            placeholder={t('project.backlogPlaceholder')}
            data-testid="backlog-add"
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void add();
              }
            }}
          />
          <button type="button" className="btn" onClick={() => void add()}>
            {t('common.add')}
          </button>
        </div>
        {[
          { key: 'backlog.ready' as const, rows: groups.ready },
          { key: 'backlog.ideas' as const, rows: groups.ideas },
        ].map((group) => (
          <div key={group.key} className="sub">
            <div className="ch">
              {t(group.key)}
              <span className="n">{group.rows.length}</span>
            </div>
            {group.rows.length === 0 && <div className="f3">{t('backlog.none')}</div>}
            {group.rows.map((row) => (
              <button
                key={row.id}
                type="button"
                className="rc"
                data-testid="backlog-row"
                aria-selected={selected === row.id}
                onClick={() => onSelect(row.id)}
              >
                <span className="id">{row.id}</span>
                <span className="tt">{row.title}</span>
                <span className="mt">
                  {row.openTasks.length > 0 && <span className="tag">{row.openTasks[0]?.status}</span>}
                  {row.problems.length > 0 && (
                    <span className="tag" data-testid="backlog-row-problem">
                      {t('backlog.problems', { count: row.problems.length })}
                    </span>
                  )}
                  {row.lastClosedTask?.status === 'cancelled' && (
                    <span className="tag" data-testid="backlog-row-cancelled">
                      {t('backlog.previousCancelled')}
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>
        ))}
        {groups.closed.length > 0 && (
          <details>
            <summary>
              {t('backlog.closed')} <span className="n">{groups.closed.length}</span>
            </summary>
            {groups.closed.map((row) => (
              <button
                key={row.id}
                type="button"
                className="rc"
                data-testid="backlog-row"
                onClick={() => onSelect(row.id)}
              >
                <span className="id">{row.id}</span>
                <span className="tt">{row.title}</span>
                <span className="mt">
                  {row.state === 'dropped' ? t('backlog.stateDropped') : t('backlog.stateDone')}
                </span>
              </button>
            ))}
          </details>
        )}
      </div>

      {modules !== null && (
        <div className="sec" data-testid="project-modules">
          <div className="sh">{t('project.modules')}</div>
          {modules.map((row) => (
            <div key={row.cells.join('|')} className="row">
              {row.cells.map((cell, index) => {
                const target = cellPath(cell);
                return target === undefined ? (
                  <span key={`${String(index)}-${cell}`} className={index === 0 ? '' : 'f3'}>
                    {cell}
                  </span>
                ) : (
                  <button
                    key={`${String(index)}-${cell}`}
                    type="button"
                    className={`lnk ${index === 0 ? '' : 'f3'}`}
                    data-testid="project-module-link"
                    onClick={() => onOpenFile(target)}
                  >
                    {cell}
                  </button>
                );
              })}
            </div>
          ))}
          <button type="button" className="lnk" onClick={() => onOpenFile('.dev/PROJECT.md')}>
            {t('project.modulesSource')}
          </button>
        </div>
      )}

      {early.length > 0 && (
        <div className="sec" data-testid="project-early">
          <div className="sh">{t('project.earlyFiles')}</div>
          {early.map((path) => (
            <button key={path} type="button" className="lnk" onClick={() => onOpenFile(path)}>
              {path}
            </button>
          ))}
        </div>
      )}

      {item !== undefined && (
        <BacklogDrawer
          item={item}
          onClose={() => onSelect(null)}
          onSave={backlog.update}
          onCloseItem={backlog.close}
          onReopen={backlog.reopen}
          onHandOff={(text) => {
            onHandOff(text);
            onSelect(null);
          }}
          onOpenRef={(ref) => onOpenFile(ref.split('#')[0] ?? ref)}
          onNotice={onNotice}
        />
      )}
    </section>
  );
}
