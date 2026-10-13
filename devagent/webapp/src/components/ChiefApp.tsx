import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { newRequestId } from '../api/rpc';
import { createAutoscroll } from '../lib/scroll';
import { useChiefSession } from '../state/useChiefSession';
import { Transcript } from './Transcript';
import { InteractionCard } from './InteractionCard';
import { TaskCard } from './TaskCard';
import { MemberDrawer } from './MemberDrawer';
import type { TaskDetail } from '../state/slot';

interface LoginViewProps {
  login: (password: string) => Promise<void>;
  onLogin: () => void;
}
function LoginView({ login, onLogin }: LoginViewProps) {
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
  const [, setAutoscrollState] = useState({ locked: false, showJumpButton: false });
  const bodyRef = useCallback((element: HTMLDivElement | null) => {
    autoscrollRef.current = element === null ? null : createAutoscroll(element, setAutoscrollState);
  }, []);
  const session = useMemo(
    () => (projectId !== '' && sessionId !== '' ? { projectId, sessionId, roleId: 'chief' } : null),
    [projectId, sessionId],
  );
  const chief = useChiefSession(session, authed === true);
  const taskId = chief.activeTaskId;

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
    const member = taskDetail?.members.find((entry) => entry.sessionId !== sessionId);
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
  if (!authed) {
    return <LoginView login={(password) => chief.rpc.login(password)} onLogin={() => setAuthed(true)} />;
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
            void openProject(pathInput).catch(() => undefined);
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
              if (projectId === '') return;
              const created = await chief.rpc.call<{ session: { sessionId: string } }>('session.create', { projectId });
              localStorage.setItem('agentdev.sessionId', created.session.sessionId);
              setSessionId(created.session.sessionId);
              setTaskDetail(null);
            })().catch(() => undefined);
          }}
        >
          新会话
        </button>
      </header>

      <div className="content">
        <main className="chat-pane">
          <div className="chat-body" ref={bodyRef}>
            <Transcript items={chief.slot.items.filter((entry) => entry.role !== 'system')} />
            {taskId !== null && (
              <TaskCard
                detail={taskDetail}
                visible
                onOpenMember={(memberSessionId, label) => setDrawer({ sessionId: memberSessionId, label })}
                onRefresh={refreshTask}
              />
            )}
          </div>

          <div className="pending-region">
            {chief.slot.pending.map((interaction) => (
              <InteractionCard
                key={interaction.interactionId}
                interaction={interaction}
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
              <summary>历史读取警告 ({chief.historyProblems.length})</summary>
              <pre>{chief.historyProblems.join('\n')}</pre>
            </details>
          )}

          <form
            className="composer"
            onSubmit={(event) => {
              event.preventDefault();
              const input = event.currentTarget.elements.namedItem('text') as HTMLTextAreaElement | null;
              if (input === null || input.value.trim() === '') return;
              const text = input.value;
              input.value = '';
              void chief.submit(text).catch(() => undefined);
            }}
          >
            <textarea name="text" rows={2} placeholder="Message Chief…" onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                (event.currentTarget.form as HTMLFormElement | null)?.requestSubmit();
              }
            }} />
            <div className="composer-actions">
              <button type="submit" className="send-button">↑</button>
              <button type="button" className="stop-button" onClick={() => { void chief.stop().catch(() => undefined); }}>STOP</button>
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
    </div>
  );
}
