import { useCallback, useEffect, useMemo, useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { State } from '../app/State';
import type { RpcClient } from '../api/rpc';

import { usePhaseLabel } from '../chat/task-labels';
import { BacklogDrawer } from './BacklogDrawer';
import {
  cellPath,
  groupsOf,
  moduleTable,
  projectNameFrom,
  useBacklog,
  usePendingInteractions,
  useProjectText,
  useTasks,
  type BacklogItemView,
} from './project-model';

export interface ProjectPageProps {
  readonly rpc: RpcClient;
  readonly projectId: string;
  /** The project's directory name and path: the page is about a project, not about a route. */
  readonly projectName: string;
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
  projectName,
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
  const modules = moduleTable(project.text);
  const projectTitle = projectNameFrom(project.text, projectName);
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
    <section className="pp" data-testid="project-page">
      <div className="pp-head">
        <div className="pp-ident">
          <h1>{projectTitle}</h1>
        </div>
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

      <div className="pp-stats" data-testid="project-stats">
        <span className="pp-stat">
          <b>{groups.ready.length}</b>
          {t('backlog.ready')}
        </span>
        <span className="pp-stat">
          <b>{running.length}</b>
          {t('project.progress')}
        </span>
        <span className={`pp-stat${pending.all.length > 0 ? ' decide' : ''}`}>
          <b>{pending.all.length}</b>
          {t('project.deciding')}
        </span>
        <span className="pp-stat">
          <b>{groups.ideas.length}</b>
          {t('backlog.ideas')}
        </span>
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

      {(pending.all.length > 0 || backlog.data.issues.length > 0) && (
        <div
          className="pp-alert"
          data-testid={backlog.data.issues.length > 0 ? 'project-issues' : 'project-attention'}
        >
          <div className="pp-alert-head">
            <span className="pp-alert-icon" aria-hidden="true">
              !
            </span>
            <span>{t('project.attention', { count: pending.all.length + backlog.data.issues.length })}</span>
          </div>
          {backlog.data.issues.length > 0 && (
            <button type="button" className="btn ghost" onClick={() => onOpenFile('.dev/backlog.md')}>
              {t('project.openBacklog')}
            </button>
          )}
          <div className="pp-issues">
            {pending.all.map((question) => (
              <button
                key={question.interactionId}
                type="button"
                className="pp-issue"
                data-testid="project-question"
                onClick={() => onOpenTaskSession(question.sourceSessionId)}
              >
                {t('project.waitingForYou', { title: question.title })}
              </button>
            ))}
            {backlog.data.issues.map((issue) => (
              <button
                key={`${String(issue.line)}-${issue.reason}`}
                type="button"
                className="pp-issue"
                data-testid="project-issue"
                onClick={() => onOpenFile('.dev/backlog.md', issue.line > 0 ? issue.line : undefined)}
              >
                {issue.line === 0 ? issue.reason : t('backlog.lineReason', { line: issue.line, reason: issue.reason })}
              </button>
            ))}
          </div>
        </div>
      )}

      {tasks.tasks.length > 0 && (
      <div className="pp-section" data-testid="project-progress">
        <div className="pp-sec-head">
          <span className="pp-sec-title">{t('project.progress')}</span>
          <span className="pp-count">{running.length}</span>
          {pending.byTask.size > 0 && (
            <span className="pp-tag decide">
              {t('project.deciding')} {pending.byTask.size}
            </span>
          )}
        </div>
        <div className="pp-sec-body">
          {running.length === 0 && <div className="pp-empty">{t('project.progressEmpty')}</div>}
          <div className="pp-list">
            {running.map((task) => {
              const deciding = pending.byTask.get(task.taskId);
              return (
                <button
                  key={task.taskId}
                  type="button"
                  className="pp-row"
                  data-testid="project-task"
                  onClick={() => onOpenTaskSession(deciding?.sourceSessionId ?? task.chiefSessionId)}
                >
                  <span className="pp-id">{task.taskId}</span>
                  <span className="pp-title">{task.goal}</span>
                  <span className="pp-meta">
                    {phaseLabel(task.phase)} · {t(statusKeyOf(task.status))}
                    {deciding !== undefined && (
                      <span className="pp-tag decide" data-testid="project-deciding">
                        {t('project.deciding')}
                      </span>
                    )}
                    <span className="pp-go" aria-hidden="true">›</span>
                  </span>
                </button>
              );
            })}
          </div>
          {recent !== undefined && (
            <div className="pp-note" data-testid="project-recent">
              {t('project.recentDone', { id: recent.taskId, goal: recent.goal })}
            </div>
          )}
          {tasks.tasks.filter((task) => !running.some((row) => row.taskId === task.taskId) && task.taskId !== recent?.taskId).length > 0 && (
            <details className="pp-details" data-testid="project-all-tasks">
              <summary>{t('project.allTasks', { count: tasks.tasks.length })}</summary>
              <div className="pp-list">
                {tasks.tasks
                  .filter((task) => !running.some((row) => row.taskId === task.taskId) && task.taskId !== recent?.taskId)
                  .map((task) => (
                    <button
                      key={task.taskId}
                      type="button"
                      className="pp-row"
                      data-testid="project-task-all"
                      onClick={() => onOpenTaskSession(task.chiefSessionId)}
                    >
                      <span className="pp-id">{task.taskId}</span>
                      <span className="pp-title">{task.goal}</span>
                      <span className="pp-meta">
                        {phaseLabel(task.phase)} · {t(statusKeyOf(task.status))}
                        <span className="pp-go" aria-hidden="true">›</span>
                      </span>
                    </button>
                  ))}
              </div>
            </details>
          )}
        </div>
      </div>
      )}

      <div className="pp-section" data-testid="project-backlog">
        <div className="pp-sec-head">
          <span className="pp-sec-title">{t('project.backlog')}</span>
          <span className="pp-count">{groups.ready.length + groups.ideas.length}</span>
        </div>
        <div className="pp-compose">
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
        <div className="pp-sec-body">
          {groups.ready.length + groups.ideas.length === 0 && <div className="pp-empty">{t('backlog.none')}</div>}
          {groups.ready.length + groups.ideas.length > 0 && [
            { key: 'backlog.ready' as const, rows: groups.ready },
            { key: 'backlog.ideas' as const, rows: groups.ideas },
          ].map((group) => (
            <div key={group.key} className="pp-group">
              <div className="pp-group-head">
                {t(group.key)}
                <span className="pp-count">{group.rows.length}</span>
              </div>
              <div className="pp-list">
                {group.rows.map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    className="pp-row"
                    data-testid="backlog-row"
                    aria-selected={selected === row.id}
                    onClick={() => onSelect(row.id)}
                  >
                    <span className="pp-id">{row.id}</span>
                    <span className="pp-title">{row.title}</span>
                    <span className="pp-meta">
                      {row.openTasks.length > 0 && <span className="pp-tag">{row.openTasks[0]?.status}</span>}
                      {row.problems.length > 0 && (
                        <span className="pp-tag" data-testid="backlog-row-problem">
                          {t('backlog.problems', { count: row.problems.length })}
                        </span>
                      )}
                      {row.lastClosedTask?.status === 'cancelled' && (
                        <span className="pp-tag" data-testid="backlog-row-cancelled">
                          {t('backlog.previousCancelled')}
                        </span>
                      )}
                      <span className="pp-go" aria-hidden="true">›</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}
          {groups.closed.length > 0 && (
            <details className="pp-closed">
              <summary>
                {t('backlog.closed')}
                <span className="pp-count">{groups.closed.length}</span>
              </summary>
              <div className="pp-list">
                {groups.closed.map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    className="pp-row"
                    data-testid="backlog-row"
                    onClick={() => onSelect(row.id)}
                  >
                    <span className="pp-id">{row.id}</span>
                    <span className="pp-title">{row.title}</span>
                    <span className="pp-meta">
                      {row.state === 'dropped' ? t('backlog.stateDropped') : t('backlog.stateDone')}
                      <span className="pp-go" aria-hidden="true">›</span>
                    </span>
                  </button>
                ))}
              </div>
            </details>
          )}
        </div>
      </div>

      {modules !== null && (
        <div className="pp-section" data-testid="project-modules">
          <div className="pp-sec-head">
            <span className="pp-sec-title">{t('project.modules')}</span>
            <span className="sp" />
            <button type="button" className="pp-path" onClick={() => onOpenFile('.dev/PROJECT.md')}>
              {t('project.modulesSource')}
            </button>
          </div>
          <div className="pp-sec-body">
            <div className="pp-table">
              <div className="pp-tr pp-th">
                {modules.headers.map((cell, index) => (
                  <span key={`h-${String(index)}-${cell}`} className="pp-td">
                    {cell}
                  </span>
                ))}
              </div>
              {modules.rows.map((row) => (
                <div key={row.cells.join('|')} className="pp-tr">
                  {row.cells.map((cell, index) => {
                    const target = cellPath(cell);
                    return (
                      <span key={`${String(index)}-${cell}`} className="pp-td">
                        {target === undefined ? (
                          cell
                        ) : (
                          <button
                            type="button"
                            className="pp-path"
                            data-testid="project-module-link"
                            onClick={() => onOpenFile(target)}
                          >
                            {cell.replace(/^`|`$/g, '')}
                          </button>
                        )}
                      </span>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {early.length > 0 && (
        <div className="pp-section" data-testid="project-early">
          <div className="pp-sec-head">
            <span className="pp-sec-title">{t('project.earlyFiles')}</span>
          </div>
          <div className="pp-sec-body">
            <div className="pp-links">
              {early.map((path) => (
                <button key={path} type="button" className="pp-path" onClick={() => onOpenFile(path)}>
                  {path}
                </button>
              ))}
            </div>
          </div>
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
