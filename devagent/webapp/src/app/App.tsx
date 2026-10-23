import { useCallback, useEffect, useMemo, useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { usePreferences, type PreferencesApi } from './usePreferences';
import { useRoute, useShortcuts, navigate } from './router';
import { TopBar } from './TopBar';
import { StatusBar } from './StatusBar';
import { ProjectDialog } from './ProjectDialog';
import { I18nProvider } from '../i18n/I18nProvider';
import { useSession, type SessionRef } from '../state/useSession';
import { useWorkspace } from '../state/useWorkspace';
import { RpcClient, RpcError, newRequestId } from '../api/rpc';
import { ChatPage } from '../chat/ChatPage';
import { RequirementsPage } from '../requirements/RequirementsPage';
import { SettingsPage } from '../settings/SettingsPage';
import { LoginPage } from '../auth/LoginPage';
import { ToastHost } from '../lib/ToastHost';
import { FileDrawer } from '../files/FileDrawer';
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
  useShortcuts();
  const [rpc] = useState(() => new RpcClient({}));
  // Unknown until a read answers: a cookie may exist (reload) or not (first run). Guessing either
  // way is wrong — guessing "authenticated" hides the password screen, guessing "login" flashes it.
  const [auth, setAuth] = useState<'unknown' | 'ready' | 'required'>('unknown');
  const [projectOpen, setProjectOpen] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  /** A request the board hands to the chat: filled into the composer, never sent on its own. */
  const [draft, setDraft] = useState<string | null>(null);
  /** The project file or directory the read-only viewer is showing; null when it is closed. */
  const [filePath, setFilePath] = useState<string | null>(null);

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
    (window as unknown as { __agentdev?: unknown }).__agentdev = { rpc, workspace, session };
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
        />
        {route.view === 'chat' && (
          <ChatPage
            key={workspace.sessionId}
            draft={draft}
            onDraftConsumed={(inserted) => {
              setDraft(null);
              notify(t(inserted ? 'req.handoffSent' : 'req.handoffKept'), inserted ? 'info' : 'error');
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
            currentSessionId={workspace.sessionId}
            projectId={workspace.projectId}
            hasProject={workspace.projectId !== ''}
            onSelectSession={(sessionId) => {
              workspace.selectSession(sessionId);
              setRailOpen(false);
            }}
            onCreateSession={startSession}
            onOpenRail={() => setRailOpen((open) => !open)}
            railOpen={railOpen}
          />
        )}
        {route.view === 'requirements' && (
          <RequirementsPage
            rpc={rpc}
            projectId={workspace.projectId}
            selected={route.selected}
            onSelect={(id) => navigate(id === null ? '/requirements' : `/requirements?selected=${encodeURIComponent(id)}`)}
            onNotice={notify}
            onHandOff={(text) => {
              setDraft(text);
              navigate('/');
            }}
            onOpenTaskSession={(sessionId) => {
              workspace.selectSession(sessionId);
              navigate('/');
            }}
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
              setFilePath(path);
              setProjectOpen(false);
            }}
            onClose={() => setProjectOpen(false)}
          />
        )}
        {filePath !== null && (
          <FileDrawer
            rpc={rpc}
            projectId={workspace.projectId}
            path={filePath}
            entries={workspace.project?.entries ?? []}
            onClose={() => setFilePath(null)}
          />
        )}
        <ToastHost />
    </div>
  );
}
