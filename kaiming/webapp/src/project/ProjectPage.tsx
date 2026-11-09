import { useCallback, useEffect, useMemo, useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { State } from '../app/State';
import type { RpcClient } from '../api/rpc';

import { usePhaseLabel } from '../chat/task-labels';
import { BacklogDrawer } from './BacklogDrawer';
import {
  boardOf,
  cellPath,
  directTasks,
  flowChain,
  moduleTable,
  orphanTasks,
  projectNameFrom,
  useBacklog,
  usePendingInteractions,
  useProjectText,
  useTasks,
  type BacklogItemView,
  type BoardItem,
  type ChainStep,
  type TaskRowSummary,
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

function statusKeyOf(
  status: string,
): 'task.status.active' | 'task.status.waiting' | 'task.status.paused' | 'task.status.completed' | 'task.status.cancelled' {
  if (status === 'completed') return 'task.status.completed';
  if (status === 'cancelled') return 'task.status.cancelled';
  if (status === 'paused' || status === 'pausing' || status === 'cancelling') return 'task.status.paused';
  if (status === 'waiting') return 'task.status.waiting';
  return 'task.status.active';
}

function kindKey(
  kind: string | undefined,
): 'task.kind.design' | 'task.kind.document' | 'task.kind.investigate' | 'task.kind.implement' {
  return kind === 'design'
    ? 'task.kind.design'
    : kind === 'document'
      ? 'task.kind.document'
      : kind === 'investigate'
        ? 'task.kind.investigate'
        : 'task.kind.implement';
}

function Chain({ steps }: { readonly steps: readonly ChainStep[] }) {
  const { t } = useI18n();
  const phaseLabel = usePhaseLabel();
  return (
    <span className="pp-chain" aria-label={t('project.chain')}>
      {steps.map((step, index) => (
        <span key={`${step.key}-${String(index)}`} className={`pp-chip ${step.state}`}>
          {step.gate === true ? t('project.confirmStep') : phaseLabel(step.key)}
        </span>
      ))}
    </span>
  );
}

function TaskLine({
  task,
  pending,
  onOpen,
}: {
  readonly task: TaskRowSummary;
  readonly pending: boolean;
  readonly onOpen: () => void;
}) {
  const { t } = useI18n();
  const phaseLabel = usePhaseLabel();
  return (
    <button type="button" className="pp-row" data-testid="project-task" onClick={onOpen}>
      <span className="pp-id">{task.taskId}</span>
      <span className="pp-title">{task.goal}</span>
      <span className="pp-meta">
        {t(kindKey(task.workKind))} · {phaseLabel(task.phase)} · {t(statusKeyOf(task.status))}
        {(task.reworkCount ?? 0) > 0 && <span className="pp-tag">{t('project.rework', { count: task.reworkCount ?? 0 })}</span>}
        {pending && <span className="pp-tag decide" data-testid="project-deciding">{t('project.deciding')}</span>}
        <span className="pp-go" aria-hidden="true">›</span>
      </span>
    </button>
  );
}

function BoardCard({
  item,
  pending,
  onSelect,
}: {
  readonly item: BoardItem;
  readonly pending: boolean;
  readonly onSelect: () => void;
}) {
  const { t } = useI18n();
  const row: BacklogItemView = item.item;
  return (
    <button
      type="button"
      className="pp-card"
      data-testid="backlog-row"
      aria-selected={false}
      onClick={onSelect}
    >
      <span className="pp-card-h">
        <span className="pp-id">{row.id}</span>
        <span className="pp-card-title">{row.title}</span>
      </span>
      <Chain steps={flowChain(row, pending)} />
      <span className="pp-meta">
        {row.openTasks[0] !== undefined && <span className="pp-tag">{t(kindKey(row.openTasks[0]?.workKind))}</span>}
        {(row.splitInto ?? []).length > 0 && <span className="pp-tag">{t('project.sliceCount', { count: (row.splitInto ?? []).length })}</span>}
        {item.awaitingDesign && <span className="pp-tag wait" data-testid="backlog-awaiting-design">{t('project.awaitingDesign')}</span>}
        {pending && <span className="pp-tag decide" data-testid="project-deciding">{t('project.deciding')}</span>}
        {item.reworkCount > 0 && <span className="pp-tag">{t('project.rework', { count: item.reworkCount })}</span>}
        {(row.splitInto ?? []).length > 0 && (
          <span className="pp-tag">{t('project.splitInto', { ids: (row.splitInto ?? []).join(', ') })}</span>
        )}
        {row.problems.length > 0 && <span className="pp-tag">{t('backlog.problems', { count: row.problems.length })}</span>}
        <span className="pp-go" aria-hidden="true">›</span>
      </span>
    </button>
  );
}

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
        setEarly(
          read.entries
            .filter((entry) => entry.name === 'issues.md' || entry.name === 'requirements')
            .map((entry) => (entry.name === 'issues.md' ? '.dev/issues.md' : '.dev/requirements/')),
        );
      })
      .catch(() => setEarly([]));
  }, [rpc, projectId]);

  const board = useMemo(() => boardOf(backlog.data.items), [backlog.data.items]);
  const direct = useMemo(() => directTasks(tasks.tasks), [tasks.tasks]);
  const orphans = useMemo(() => orphanTasks(tasks.tasks, backlog.data.items), [tasks.tasks, backlog.data.items]);
  const modules = moduleTable(project.text);
  const projectTitle = projectNameFrom(project.text, projectName);
  const item: BacklogItemView | undefined =
    selected === null ? undefined : backlog.data.items.find((entry) => entry.id === selected);
  const allCards = [...board.designing, ...board.implementing, ...board.ready, ...board.ideas];
  const pendingFor = (taskId: string | undefined): boolean =>
    taskId !== undefined && pending.byTask.has(taskId);

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
        <span className="pp-stat"><b>{board.ideas.length}</b>{t('project.idea')}</span>
        <span className="pp-stat"><b>{board.designing.length}</b>{t('project.designing')}</span>
        <span className="pp-stat"><b>{board.ready.length}</b>{t('backlog.ready')}</span>
        <span className="pp-stat"><b>{board.implementing.length}</b>{t('project.implementing')}</span>
        <span className="pp-stat"><b>{board.completed.length}</b>{t('project.completed')}</span>
        <span className={`pp-stat${pending.all.length > 0 ? ' decide' : ''}`}>
          <b>{pending.all.length}</b>{t('project.deciding')}
        </span>
      </div>

      {backlog.error !== null && (
        <div className="notice"><State kind="block">{t('project.readFailed', { reason: backlog.error })}</State></div>
      )}
      {tasks.tasksError !== null && (
        <div className="notice"><State kind="block">{t('project.tasksReadFailed', { reason: tasks.tasksError })}</State></div>
      )}

      {(pending.all.length > 0 || backlog.data.issues.length > 0 || orphans.length > 0) && (
        <div
          className="pp-alert"
          data-testid={backlog.data.issues.length > 0 ? 'project-issues' : 'project-attention'}
        >
          <div className="pp-alert-head">
            <span className="pp-alert-icon" aria-hidden="true">!</span>
            <span>{t('project.attention', { count: pending.all.length + backlog.data.issues.length + orphans.length })}</span>
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
            {orphans.map((task) => (
              <button
                key={task.taskId}
                type="button"
                className="pp-issue"
                data-testid="project-orphan-task"
                onClick={() => onOpenTaskSession(task.chiefSessionId)}
              >
                {t('project.orphanTask', { id: task.taskId })}
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
        <button type="button" className="btn" onClick={() => void add()}>{t('common.add')}</button>
      </div>

      <div className="pp-board" data-testid="project-board">
        {([
          ['idea', 'project.idea', board.ideas],
          ['designing', 'project.designing', board.designing],
          ['ready', 'backlog.ready', board.ready],
          ['implementing', 'project.implementing', board.implementing],
        ] as const).map(([key, labelKey, cards]) => (
          <div key={key} className="pp-lane" data-testid={`board-${key}`}>
            <div className="pp-lane-head">
              <span>{t(labelKey)}</span>
              <span className="pp-count">{cards.length}</span>
            </div>
            <div className="pp-lane-body">
              {cards.length === 0 && <div className="pp-empty">{t('project.laneEmpty')}</div>}
              {cards.map((card) => (
                <BoardCard
                  key={card.item.id}
                  item={card}
                  pending={pendingFor(card.item.openTasks[0]?.taskId)}
                  onSelect={() => onSelect(card.item.id)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {direct.length > 0 && (
        <div className="pp-section" data-testid="project-direct">
          <div className="pp-sec-head">
            <span className="pp-sec-title">{t('project.directWork')}</span>
            <span className="pp-count">{direct.length}</span>
          </div>
          <div className="pp-sec-body">
            <div className="pp-list">
              {direct.map((task) => (
                <TaskLine
                  key={task.taskId}
                  task={task}
                  pending={pendingFor(task.taskId)}
                  onOpen={() => onOpenTaskSession(pending.byTask.get(task.taskId)?.sourceSessionId ?? task.chiefSessionId)}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {board.completed.length > 0 && (
        <details className="pp-closed" data-testid="project-completed">
          <summary>{t('project.completed')}<span className="pp-count">{board.completed.length}</span></summary>
          <div className="pp-list">
            {board.completed.map((row) => (
              <button key={row.id} type="button" className="pp-row" data-testid="backlog-row" onClick={() => onSelect(row.id)}>
                <span className="pp-id">{row.id}</span>
                <span className="pp-title">{row.title}</span>
                <span className="pp-meta">
                  {row.state === 'dropped' ? t('backlog.stateDropped') : t('backlog.stateDone')}
                  {(row.splitInto ?? []).length > 0 && (
                    <span className="pp-tag">{t('project.splitInto', { ids: (row.splitInto ?? []).join(', ') })}</span>
                  )}
                  <span className="pp-go" aria-hidden="true">›</span>
                </span>
              </button>
            ))}
          </div>
        </details>
      )}

      {tasks.tasks.length > 0 && (
        <details className="pp-details" data-testid="project-all-tasks">
          <summary>{t('project.allTasks', { count: tasks.tasks.length })}</summary>
          <div className="pp-list">
            {tasks.tasks.map((task) => (
              <TaskLine
                key={task.taskId}
                task={task}
                pending={pendingFor(task.taskId)}
                onOpen={() => onOpenTaskSession(pending.byTask.get(task.taskId)?.sourceSessionId ?? task.chiefSessionId)}
              />
            ))}
          </div>
        </details>
      )}

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
                  <span key={`h-${String(index)}-${cell}`} className="pp-td">{cell}</span>
                ))}
              </div>
              {modules.rows.map((row) => (
                <div key={row.cells.join('|')} className="pp-tr">
                  {row.cells.map((cell, index) => {
                    const target = cellPath(cell);
                    return (
                      <span key={`${String(index)}-${cell}`} className="pp-td">
                        {target === undefined ? cell : (
                          <button type="button" className="pp-path" data-testid="project-module-link" onClick={() => onOpenFile(target)}>
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
          <div className="pp-sec-head"><span className="pp-sec-title">{t('project.earlyFiles')}</span></div>
          <div className="pp-sec-body">
            <div className="pp-links">
              {early.map((path) => (
                <button key={path} type="button" className="pp-path" onClick={() => onOpenFile(path)}>{path}</button>
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
          onOpenTask={onOpenTaskSession}
          onOpenRef={(ref) => onOpenFile(ref.split('#')[0] ?? ref)}
          onNotice={onNotice}
        />
      )}

      {allCards.length === 0 && board.completed.length === 0 && direct.length === 0 && (
        <div className="pp-empty" data-testid="project-empty">{t('backlog.none')}</div>
      )}
    </section>
  );
}
