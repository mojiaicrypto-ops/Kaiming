import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { newRequestId } from '../api/rpc';
import { createAutoscroll } from '../lib/scroll';
import { toast } from '../lib/toast';
import { useChiefSession } from '../state/useChiefSession';
import { Transcript } from './Transcript';
import { InteractionCard } from './InteractionCard';
import { TaskCard } from './TaskCard';
import { MemberDrawer } from './MemberDrawer';
import { ToastHost } from './ToastHost';
import type { TaskDetail } from '../state/slot';

interface LoginViewProps {
  login: (password: string) => Promise<void>;
  onLogin: () => void;
  notice?: string;
}
function LoginView({ login, onLogin, notice }: LoginViewProps) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="login-view"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        void (async () => {
          try {
            await login(password);
            onLogin();
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          }
        })();
      }}
    >
      <h1>AgentDev</h1>
      {notice !== undefined && <p className="login-notice">{notice}</p>}
      <input
        type="password"
        value={password}
        placeholder="访问口令"
        onChange={(event) => setPassword(event.target.value)}
      />
      {error !== null && <p className="login-error">{error}</p>}
      <button type="submit">进入</button>
    </form>
  );
}

export function ChiefApp(): React.ReactElement {
  // Session presence is decided by a cheap authenticated read, not by document.cookie:
  // the cookie is HttpOnly, so it is invisible to the page and the login view would show
  // forever even with a valid session.
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [projectId, setProjectId] = useState(() => localStorage.getItem('agentdev.projectId') ?? '');
  const [sessionId, setSessionId] = useState(() => localStorage.getItem('agentdev.sessionId') ?? '');
  const [pathInput, setPathInput] = useState('');
  const [members, setMembers] = useState<ReadonlyArray<{ sessionId: string; roleId: string }>>([]);
  const [drawer, setDrawer] = useState<{ sessionId: string; label: string } | null>(null);
  const [taskDetail, setTaskDetail] = useState<TaskDetail | null>(null);
  // Auto-follow via the ported handle: it observes the content child (whose scrollHeight
  // changes when messages stream) — the container's own box never resizes, so observing it
  // alone never fired.
  const autoscrollRef = useRef<ReturnType<typeof createAutoscroll> | null>(null);
  const [autoscrollUi, setAutoscrollState] = useState({ locked: false, showJumpButton: false });
  const bodyRef = useCallback((element: HTMLDivElement | null) => {
    autoscrollRef.current = element === null ? null : createAutoscroll(element, setAutoscrollState);
  }, []);
  const session = useMemo(
    () => (projectId !== '' && sessionId !== '' ? { projectId, sessionId, roleId: 'chief' } : null),
    [projectId, sessionId],
  );
  const chief = useChiefSession(session, authed === true);
  const taskId = chief.activeTaskId;
  const messages = useMemo(
    () => chief.slot.items.filter((entry) => entry.role !== 'system'),
    [chief.slot.items],
  );
  const showJump = autoscrollUi.showJumpButton;
  const unresolvedCount = chief.slot.pending.filter((entry) => entry.resolved !== true).length;

  useEffect(() => {
    if (session === null) return;
    void (async () => {
      const read = await chief.rpc.call<{ project: { sessions: ReadonlyArray<{ sessionId: string; roleId: string }> } }>(
        'project.get', { projectId: session.projectId },
      );
      setMembers(read.project.sessions);
    })().catch(() => undefined);
  }, [chief.rpc, session]);

  // Streaming growth follows the ported autoscroll handle (child observation + lock semantics).
  useEffect(() => {
    autoscrollRef.current?.followIfUnlocked();
  }, [chief.slot.items]);

  const openProject = useCallback(async (path: string): Promise<void> => {
    if (path.trim() === '') {
      toast('请输入项目目录路径', 'error');
      return;
    }
    try {
      const opened = await chief.rpc.call<{ project: { projectId: string; sessions: ReadonlyArray<{ sessionId: string; roleId: string }> } }>(
        'project.open', { path },
      );
      localStorage.setItem('agentdev.projectPath', path);
      localStorage.setItem('agentdev.projectId', opened.project.projectId);
      setProjectId(opened.project.projectId);
      const known = localStorage.getItem('agentdev.sessionId');
      const next = opened.project.sessions.find((entry) => entry.sessionId === known) ?? opened.project.sessions[0];
      if (next === undefined) {
        const created = await chief.rpc.call<{ session: { sessionId: string } }>('session.create', { projectId: opened.project.projectId });
        localStorage.setItem('agentdev.sessionId', created.session.sessionId);
        setSessionId(created.session.sessionId);
      } else {
        localStorage.setItem('agentdev.sessionId', next.sessionId);
        setSessionId(next.sessionId);
      }
      toast(`已打开 ${path}`, 'success');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      toast(`打开项目失败: ${message}`, 'error');
    }
  }, [chief.rpc]);

  const refreshTask = useCallback(async (): Promise<TaskDetail | null> => {
    if (taskId === null || session === null) return null;
    const read = await chief.rpc.call<{ task: TaskDetail['task']; members: TaskDetail['members']; results: TaskDetail['results'] }>(
      'task.get', { projectId: session.projectId, taskId },
    );
    const detail: TaskDetail = { task: read.task, members: read.members, results: read.results };
    setTaskDetail(detail);
    return detail;
  }, [chief.rpc, session, taskId]);

  const sourceRoleOf = useCallback((interaction: { taskId: string | null; inputId: string | null }): string | undefined => {
    if (interaction.taskId === null) return undefined;
    // The interaction's input belongs to the member session whose current run it is (M1 fact);
    // matching by taskId alone would label every member interaction with an arbitrary role.
    const member = taskDetail?.members.find((entry) => entry.sessionId !== sessionId && entry.currentInputId === interaction.inputId)
      ?? taskDetail?.members.find((entry) => entry.sessionId !== sessionId);
    return member?.roleId;
  }, [taskDetail, sessionId]);

  // One auth probe on mount decides between the login view and the workbench; a stored
  // project path reopens the project the way the old shell's boot does.
  const probeRef = useRef(false);
  useEffect(() => {
    if (probeRef.current) return;
    probeRef.current = true;
    void (async () => {
      try {
        await chief.rpc.call('config.get', {});
        setAuthed(true);
        const storedPath = localStorage.getItem('agentdev.projectPath');
        if (storedPath !== null && projectId === '') {
          await openProject(storedPath);
        }
      } catch {
        setAuthed(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (authed === null) {
    return <div className="app"><div className="login-view">连接中…</div></div>;
  }
  // Mid-session expiry: any RPC answered UNAUTHORIZED flips needLogin; without this gate the
  // workbench stays up half-dead (submit fails, stream reconnects forever, no way back in).
  if (!authed || chief.needLogin) {
    return (
      <div className="app">
        <LoginView
          login={async (password) => { await chief.rpc.login(password); }}
          onLogin={() => { chief.setNeedLogin(false); setAuthed(true); }}
          notice={authed ? '登录已过期，请重新输入访问口令。' : undefined}
        />
        <ToastHost />
      </div>
    );
  }

  return (
    <div className={`app chief-view status-${chief.status}${drawer !== null ? ' drawer-open' : ''}`}>
      <header className="topbar">
        <span className="brand">AgentDev</span>
        <span className={`conn conn-${chief.status}`} title={chief.status} />
        <form
          className="project-open"
          onSubmit={(event) => {
            event.preventDefault();
            void openProject(pathInput);
          }}
        >
          <input
            value={pathInput}
            placeholder="/path/to/project"
            onChange={(event) => setPathInput(event.target.value)}
          />
          <button type="submit">打开</button>
        </form>
        <button
          type="button"
          onClick={() => {
            void (async () => {
              if (projectId === '') {
                toast('请先打开一个项目，再创建会话。', 'error');
                return;
              }
              const created = await chief.rpc.call<{ session: { sessionId: string } }>('session.create', { projectId });
              localStorage.setItem('agentdev.sessionId', created.session.sessionId);
              setSessionId(created.session.sessionId);
              setTaskDetail(null);
              toast('已创建新会话', 'success');
            })().catch((error: unknown) => {
              toast(`创建会话失败: ${error instanceof Error ? error.message : String(error)}`, 'error');
            });
          }}
        >
          新会话
        </button>
      </header>

      <div className="content">
        <main className="chat-pane">
          {chief.status !== 'connected' && (
            <div className={`stream-banner stream-${chief.status}`} role="status">
              {chief.status === 'reconnecting' ? '连接已断开，正在重连…' : '正在连接…'}
              {chief.status === 'reconnecting' && (
                <button
                  type="button"
                  onClick={() => { setSessionId((current) => current); toast('正在重试连接…', 'info'); }}
                >
                  立即重试
                </button>
              )}
            </div>
          )}
          <div className="chat-body" ref={bodyRef}>
            {session === null ? (
              <div className="empty-state">
                <h2>开始使用</h2>
                <p>在右上角输入项目目录路径并点击「打开」，例如 <code>/Users/you/my-project</code>。</p>
                <p>打开后即可与主管 Agent 自由讨论，或把想法保存为需求。</p>
              </div>
            ) : messages.length === 0 && chief.status === 'connected' ? (
              <div className="empty-state">
                <h2>新的会话</h2>
                <p>和主管聊聊你的想法，例如「我想给账号功能加密码重置，先聊聊有没有必要」。</p>
                <p>确定要做的事情可以保存为需求，交给 Agent 协作完成。</p>
              </div>
            ) : (
              <Transcript items={messages} />
            )}
            {taskId !== null && (
              <TaskCard
                detail={taskDetail}
                visible
                onOpenMember={(memberSessionId, label) => setDrawer({ sessionId: memberSessionId, label })}
                onRefresh={refreshTask}
              />
            )}
            {showJump && (
              <button
                type="button"
                className="jump-latest"
                onClick={() => { autoscrollRef.current?.jumpToBottom(); setAutoscrollState({ locked: false, showJumpButton: false }); }}
              >
                ↓ 回到最新
              </button>
            )}
          </div>

          <div className="pending-region">
            {unresolvedCount > 1 && (
              <p className="pending-count">{unresolvedCount} 个问题等待你的回答</p>
            )}
            {chief.slot.pending.map((interaction, index) => (
              <InteractionCard
                key={interaction.interactionId}
                interaction={interaction}
                index={index}
                total={chief.slot.pending.length}
                sourceRole={sourceRoleOf(interaction)}
                onAnswer={async (response) => { await chief.respond(interaction, response); }}
              />
            ))}
          </div>

          {chief.blocked !== null && (
            <p className="blocked-note">{chief.blocked.code}: {chief.blocked.detail}</p>
          )}
          {chief.historyProblems.length > 0 && (
            <details className="history-problems">
              <summary>历史读取警告 ({chief.historyProblems.length}) — 消息可能不完整</summary>
              <pre>{chief.historyProblems.join('\n')}</pre>
            </details>
          )}

          <form
            className="composer"
            onSubmit={(event) => {
              event.preventDefault();
              const input = event.currentTarget.elements.namedItem('text') as HTMLTextAreaElement | null;
              if (input === null) return;
              const text = input.value.trim();
              if (text === '') return;
              input.value = '';
              void chief.submit(text).catch((error: unknown) => {
                toast(`发送失败: ${error instanceof Error ? error.message : String(error)}`, 'error');
                // Restore the draft so the user's text is not lost on a failed submit.
                input.value = text;
              });
            }}
          >
            <textarea
              name="text"
              rows={2}
              placeholder={chief.slot.busy !== 'idle' ? (chief.slot.busy === 'queued' ? '已进入队列…' : '主管正在处理…') : 'Message Chief…（Enter 发送，Shift+Enter 换行）'}
              disabled={chief.needLogin}
              onKeyDown={(event) => {
                // IME composition: Enter confirms candidate words, never sends.
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  (event.currentTarget.form as HTMLFormElement | null)?.requestSubmit();
                }
              }}
            />
            <div className="composer-actions">
              <button type="submit" className="send-button" title="发送">↑</button>
              {chief.slot.busy !== 'idle' && (
                <button
                  type="button"
                  className="stop-button"
                  title={chief.slot.currentInputId === null ? '没有可停止的运行' : '停止当前运行'}
                  onClick={() => {
                    void chief.stop().catch((error: unknown) => {
                      toast(`停止失败: ${error instanceof Error ? error.message : String(error)}`, 'error');
                    });
                  }}
                >
                  STOP
                </button>
              )}
            </div>
          </form>
        </main>

        {drawer !== null && session !== null && (
          <MemberDrawer
            rpc={chief.rpc}
            projectId={session.projectId}
            sessionId={drawer.sessionId}
            label={drawer.label}
            onClose={() => setDrawer(null)}
          />
        )}
      </div>

      <footer className="statusbar">
        <span>{members.length} session(s)</span>
        <span className={`conn conn-${chief.status}`}>{chief.status}</span>
        <span>{taskId === null ? 'no task' : `task ${taskId}`}</span>
      </footer>
      <ToastHost />
    </div>
  );
}
