import { useCallback, useEffect, useMemo, useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { usePreferences, type PreferencesApi } from './usePreferences';
import { useRoute, useShortcuts, navigate } from './router';
import { TopBar } from './TopBar';
import { StatusBar } from './StatusBar';
import { ProjectDialog } from './ProjectDialog';
import { I18nProvider } from '../i18n/I18nProvider';
import { useSession, type SessionRef } from '../state/useSession';
import { useSessionReminders } from '../state/reminders';
import { useWorkspace } from '../state/useWorkspace';
import { RpcClient, RpcError, newRequestId } from '../api/rpc';
import { ChatPage } from '../chat/ChatPage';
import { ProjectPage } from '../project/ProjectPage';
import { SettingsPage } from '../settings/SettingsPage';
import { LoginPage } from '../auth/LoginPage';
import { ToastHost } from '../lib/ToastHost';
import { FileViewer } from '../files/FileViewer';
import { downloadUrl } from '../files/paths';
import { toast } from '../lib/toast';
import { errorText } from '../lib/errors';

/**
 * The application shell. One RPC client, one workspace (project + sessions), one chief session,
 * and three screens behind the address bar. Nothing here renders content: it decides which screen
 * is mounted and hands each the state it needs.
 */
export function App() {
  const preferences = usePreferences();
  return (
    <I18nProvider locale={preferences.locale} onLocale={preferences.setLocale}>
      <Shell preferences={preferences} />
    </I18nProvider>
  );
}

function Shell({ preferences }: { preferences: PreferencesApi }) {
  const { t } = useI18n();
  const route = useRoute();
  /** The project file or directory the read-only viewer is showing; null when it is closed. */
  const [filePath, setFilePath] = useState<string | null>(null);
  /** The line the viewer should reveal; it belongs to one opening, not to the file selection. */
  const [fileLine, setFileLine] = useState<number | undefined>(undefined);
  const openFile = useCallback((path: string | null, line?: number) => {
    setFilePath(path);
    setFileLine(line);
  }, []);
  /** The viewer is a canvas over one screen; asking for any screen closes it first. */
  const go = useCallback((path: string) => {
    setFilePath(null);
    setFileLine(undefined);
    navigate(path);
  }, []);
  useShortcuts(go);
  const [rpc] = useState(() => new RpcClient({}));
  // Unknown until a read answers: a cookie may exist (reload) or not (first run). Guessing either
  // way is wrong — guessing "authenticated" hides the password screen, guessing "login" flashes it.
  const [auth, setAuth] = useState<'unknown' | 'ready' | 'required'>('unknown');
  const [projectOpen, setProjectOpen] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  /** A request the board hands to the chat: filled into the composer, never sent on its own. */
  const [draft, setDraft] = useState<string | null>(null);
  /**
   * The viewer is a canvas over ONE screen, so changing screens closes it. Leaving it open would
   * put the new screen behind an overlay: the navigation would look like it did nothing.
   */
  useEffect(() => {
    setFilePath(null);
    setFileLine(undefined);
    // The requirements board was replaced by the project page: one address must not keep a dead
    // screen, so the legacy path is rewritten instead of only being parsed to the same view.
    if (route.view === 'project' && window.location.pathname === '/requirements') {
      window.history.replaceState(null, '', `/project${window.location.search}`);
    }
  }, [route.view]);

  // A 401 from any call takes over the screen: the cookie is gone, not the work.
  useEffect(() => {
    rpc.onUnauthorized = (): void => setAuth('required');
    return () => {
      rpc.onUnauthorized = null;
    };
  }, [rpc]);

  const workspace = useWorkspace(rpc);
  // A stable identity: the session stream restarts when the ids change, never when the shell
  // re-renders — an inline literal here is what once turned one open into thousands of prepares.
  const sessionRef = useMemo<SessionRef | null>(
    () =>
      workspace.projectId === '' || workspace.sessionId === ''
        ? null
        : { projectId: workspace.projectId, sessionId: workspace.sessionId },
    [workspace.projectId, workspace.sessionId],
  );
  const onUnauthorized = useCallback(() => setAuth('required'), []);
  // A dispatch creates member sessions, and the server announces it: the rail re-reads instead of
  // waiting for a reload to show work that is already happening.
  const session = useSession(sessionRef, auth === 'ready' && sessionRef !== null, rpc, onUnauthorized, () => {
    void workspace.refreshSessions();
  });
  const activateChat = useCallback(() => go('/'), [go]);
  useSessionReminders({
    sessionId: sessionRef?.sessionId ?? null,
    slot: session.slot,
    active: auth === 'ready',
    onScreen: route.view === 'chat' && filePath === null,
    onActivate: activateChat,
  });

  const notify = useCallback((message: string, kind: 'info' | 'success' | 'error' = 'info'): void => {
    toast(message, kind);
  }, []);

  /** Start a chief session: the rail's button and the "no session yet" banner share this answer. */
  const startSession = useCallback((): void => {
    void workspace
      .createSession()
      .then(() => notify(t('toast.sessionCreated'), 'success'))
      .catch((error: unknown) =>
        notify(t('toast.sessionCreateFailed', { reason: errorText(error, t) }), 'error'),
      );
  }, [workspace, notify, t]);

  // Debug handle for the acceptance harness: the same client the page uses, so a test drives the
  // real token handling instead of re-implementing it. Not used by product code.
  useEffect(() => {
    (window as unknown as { __kaiming?: unknown }).__kaiming = { rpc, workspace, session };
  }, [rpc, workspace, session]);

  const runningMembers = session.slot.taskDetail?.members.filter((member) => (member.activity ?? 'idle') === 'processing').length ?? 0;
  const pendingQuestions = session.slot.pending.filter((entry) => entry.resolved !== true).length;

  // The first read decides: `auth.login` is the only method allowed without a session, so a
  // successful no-op read means the cookie is valid. A second pass happens after login, because
  // the bearer token the login response returned lives in the client, not in a fresh one.
  useEffect(() => {
    if (auth !== 'unknown') return;
    rpc.refreshCsrf();
    let cancelled = false;
    void rpc
      .call('config.get', { roleId: 'chief' })
      .then(() => {
        if (!cancelled) setAuth('ready');
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setAuth(error instanceof RpcError && error.code === 'UNAUTHORIZED' ? 'required' : 'ready');
      });
    return () => {
      cancelled = true;
    };
  }, [auth, rpc]);

  if (auth === 'unknown') {
    return <div className="login" />;
  }

  if (auth === 'required') {
    return (
      <LoginPage
        rpc={rpc}
        onSuccess={() => {
          setAuth('ready');
          void workspace.refresh();
        }}
      />
    );
  }

  return (
    <div className="app">
        <TopBar
          route={route}
          project={workspace.project}
          status={session.status}
          pendingQuestions={pendingQuestions}
          onOpenProject={() => setProjectOpen(true)}
          onOpenRail={() => setRailOpen((open) => !open)}
          railOpen={railOpen}
          onOpenFiles={() => openFile('.')}
          filesOpen={filePath !== null}
          onNavigate={go}
        />
        {route.view === 'chat' && (
          <ChatPage
            draft={draft}
            onDraftConsumed={(inserted) => {
              setDraft(null);
              notify(t(inserted ? 'project.handoffSent' : 'project.handoffKept'), inserted ? 'info' : 'error');
            }}
            session={session}
            sessions={workspace.sessions}
            hasMoreSessions={workspace.hasMoreSessions}
            onLoadMoreSessions={() => void workspace.loadMoreSessions()}
            onAskChief={(text) => setDraft(text)}
            onNewSession={startSession}
            onCleanupSession={async (sessionId, revision) => {
              try {
                await rpc.call(
                  'session.cleanup',
                  { projectId: workspace.projectId, sessionId, expectedRevision: revision },
                  { requestId: newRequestId('cleanup') },
                );
                await workspace.refreshSessions();
                notify(t('session.cleanupDone'), 'success');
                return true;
              } catch (error) {
                // A refused cleanup says what still refers to the session; that list is the answer.
                const gaps =
                  error instanceof RpcError && typeof error.details === 'object' && error.details !== null
                    ? ((error.details as { gaps?: unknown }).gaps ?? [])
                    : [];
                const reason = errorText(error, t);
                notify(
                  t('session.cleanupRefused', {
                    reason: Array.isArray(gaps) && gaps.length > 0 ? `${reason}: ${gaps.join('; ')}` : reason,
                  }),
                  'error',
                );
                return false;
              }
            }}
            onArchiveSession={async (sessionId, revision, archived) => {
              try {
                await rpc.call(
                  'session.archive',
                  { projectId: workspace.projectId, sessionId, expectedRevision: revision, archived },
                  { requestId: newRequestId('archive') },
                );
                await workspace.refreshSessions();
                notify(t(archived ? 'session.archivedDone' : 'session.unarchivedDone'), 'success');
                return true;
              } catch (error) {
                const gaps =
                  error instanceof RpcError && typeof error.details === 'object' && error.details !== null
                    ? ((error.details as { gaps?: unknown }).gaps ?? [])
                    : [];
                const reason = errorText(error, t);
                notify(
                  t('session.archiveRefused', {
                    reason: Array.isArray(gaps) && gaps.length > 0 ? `${reason}: ${gaps.join('; ')}` : reason,
                  }),
                  'error',
                );
                return false;
              }
            }}
            onRenameSession={async (sessionId, title, revision) => {
              const write = async (expectedRevision: number): Promise<{ title: string | null; revision: number }> =>
                (await rpc.call(
                  'session.rename',
                  { projectId: workspace.projectId, sessionId, title, expectedRevision },
                  { requestId: newRequestId('rename') },
                )) as { title: string | null; revision: number };
              try {
                const updated = await write(revision);
                workspace.applySessionRename(sessionId, updated.title, updated.revision);
                await workspace.refreshSessions();
                return true;
              } catch (error) {
                // A concurrent Task/input transition bumps the session revision. The name itself is
                // independent of that transition, so retry once with the revision the server now has
                // instead of making the user reopen the editor.
                if (error instanceof RpcError && error.code === 'VERSION_CONFLICT') {
                  try {
                    const listed = await rpc.call<{
                      sessions: Array<{ sessionId: string; revision: number }>;
                    }>('session.list', { projectId: workspace.projectId, limit: 200 });
                    const latest = listed.sessions.find((row) => row.sessionId === sessionId);
                    if (latest !== undefined && latest.revision !== revision) {
                      const updated = await write(latest.revision);
                      workspace.applySessionRename(sessionId, updated.title, updated.revision);
                      await workspace.refreshSessions();
                      return true;
                    }
                  } catch {
                    // Fall through to the original refusal below.
                  }
                }
                // A refused rename is a fact about this row (someone else changed it), not a silent
                // no-op: the user typed a name and needs to know it was not kept.
                notify(errorText(error, t), 'error');
                return false;
              }
            }}
            currentSessionId={workspace.sessionId}
            projectId={workspace.projectId}
            projectRealPath={workspace.project?.realPath ?? ''}
            hasProject={workspace.projectId !== ''}
            onSelectSession={(sessionId) => {
              workspace.selectSession(sessionId);
              setRailOpen(false);
            }}
            onCreateSession={startSession}
            onOpenRail={() => setRailOpen((open) => !open)}
            railOpen={railOpen}
            onOpenFile={openFile}
          />
        )}
        {route.view === 'project' && (
          <ProjectPage
            rpc={rpc}
            projectId={workspace.projectId}
            projectName={(workspace.project?.realPath ?? '').split('/').filter(Boolean).at(-1) ?? t('project.pageTitle')}
            selected={route.selected}
            onSelect={(id) => navigate(id === null ? '/project' : `/project?selected=${encodeURIComponent(id)}`)}
            onNotice={notify}
            onHandOff={(text) => {
              setDraft(text);
              navigate('/');
            }}
            onOpenTaskSession={(sessionId) => {
              workspace.selectSession(sessionId);
              navigate('/');
            }}
            onOpenFile={openFile}
          />
        )}
        {route.view === 'settings' && (
          <SettingsPage
            route={route}
            rpc={rpc}
            projectId={workspace.projectId}
            locale={preferences.locale}
            onLocale={preferences.setLocale}
            theme={preferences.themePreference}
            onTheme={preferences.setThemePreference}
            density={preferences.density}
            onDensity={preferences.setDensity}
            onNotice={notify}
          />
        )}
        <StatusBar
          project={workspace.project}
          runningMembers={runningMembers}
          connection={session.status}
          activity={session.slot.busy}
          config={session.config}
          context={session.slot.context}
          compacting={session.slot.compacting}
          onCompact={session.compact}
        />
        {projectOpen && (
          <ProjectDialog
            current={workspace.project}
            projects={workspace.projects}
            onOpen={async (path) => {
              await workspace.openProject(path);
              notify(t('project.added'), 'success');
            }}
            onRebind={async (projectId, path) => {
              await workspace.rebindProject(projectId, path);
              notify(t('project.rebindDone'), 'success');
            }}
            onOpenFile={(path) => {
              openFile(path);
              setProjectOpen(false);
            }}
            browse={(path) => rpc.call('fs.browse', path === undefined ? {} : { path })}
            onClose={() => setProjectOpen(false)}
          />
        )}
        {filePath !== null && (
          <FileViewer
            rpc={rpc}
            projectId={workspace.projectId}
            path={filePath}
            focusLine={fileLine}
            entries={workspace.project?.entries ?? []}
            onOpenPath={(path) => openFile(path)}
            onClose={() => openFile(null)}
            projectRealPath={workspace.project?.realPath ?? ''}
            onOutside={() => notify(t('files.outside'), 'error')}
            onDownload={(path) => {
              // A download is the browser's job: an anchor click keeps the shell mounted and lets
              // the response's own content-disposition name the saved file.
              const anchor = document.createElement('a');
              anchor.href = downloadUrl(workspace.projectId, path);
              anchor.download = path.split('/').pop() ?? 'file';
              anchor.click();
            }}
          />
        )}
        {/* 88px on chat: the composer plus its hint. Everywhere else the toast may sit at the edge. */}
        <ToastHost lift={route.view === 'chat' ? 88 : 0} />
    </div>
  );
}
