import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RpcClient, newRequestId } from '../api/rpc';
import { readStored, readTab, removeStored, removeTab, writeStored, writeTab } from '../lib/storage';
import type { SessionActivity } from '../api/stream';

/**
 * The open project and session belong to this tab, not to the browser profile: two tabs may sit on
 * two projects, and switching in one must not move the other. `LAST_PROJECT_KEY` is the one shared
 * value — a default for a tab that has not chosen yet, which is also how a new tab opens what the
 * user was last looking at.
 */
const PROJECT_KEY = 'kaiming.projectPath';
const SESSION_KEY = 'kaiming.sessionId';
const LAST_PROJECT_KEY = 'kaiming.lastProjectPath';
/** One page of the rail; a long list asks for more instead of loading everything up front. */
const SESSION_PAGE = 100;

export interface ProjectSummary {
  readonly projectId: string;
  readonly realPath: string;
  readonly revision: number;
  readonly directoryExists: boolean;
  readonly problem?: string;
  readonly sessions: ReadonlyArray<{ sessionId: string; roleId: string }>;
  /** The knowledge entries the server checked for this project (present or missing). */
  readonly entries?: ReadonlyArray<{ path: string; present: boolean }>;
}

/** One row of the project menu: a registered project, with what the menu needs to describe it. */
export interface ProjectRow {
  readonly projectId: string;
  readonly realPath: string;
  readonly revision: number;
  readonly directoryExists: boolean;
  readonly problem?: string;
  readonly sessionCount: number;
  readonly taskCount: number;
  readonly lastActivityAt: string | null;
  readonly updatedAt: string;
}

/**
 * One row of the session rail. The title comes from the server and is derived there from the first
 * user message (never stored), so the rail needs no history read and a title cannot drift from
 * the conversation it names.
 */
export interface SessionRow {
  readonly sessionId: string;
  readonly roleId: string;
  /** The session revision: cleanup is a compare-and-set on it. */
  readonly revision: number;
  readonly title: string | null;
  /** `'mcp'` when an external agent owns this fixed session, `null` for an ordinary one. */
  readonly channel: string | null;
  readonly activity: SessionActivity;
  readonly updatedAt: string | null;
  readonly currentTaskId: string | null;
  readonly queuedInputs: number;
}

export interface WorkspaceApi {
  readonly projectId: string;
  readonly project: ProjectSummary | null;
  readonly projects: readonly ProjectRow[];
  readonly sessions: readonly SessionRow[];
  readonly hasMoreSessions: boolean;
  readonly sessionId: string;
  readonly loading: boolean;
  readonly openProject: (path: string) => Promise<void>;
  readonly rebindProject: (projectId: string, path: string) => Promise<void>;
  readonly selectSession: (sessionId: string) => void;
  readonly createSession: () => Promise<string | null>;
  readonly loadMoreSessions: () => Promise<void>;
  readonly refresh: () => Promise<void>;
  readonly reloadProjects: () => Promise<void>;
  /** Re-read the rail after the server said the project's sessions changed. */
  readonly refreshSessions: () => Promise<void>;
}

/**
 * Project + session selection. Both lists come from the server (`project.list`, `session.list`);
 * the tab remembers only which project and session it was showing, so two tabs stay independent.
 */
export function useWorkspace(rpc: RpcClient): WorkspaceApi {
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [projects, setProjects] = useState<readonly ProjectRow[]>([]);
  const [sessionId, setSessionId] = useState<string>(() => readTab(SESSION_KEY) ?? '');
  const [sessions, setSessions] = useState<readonly SessionRow[]>([]);
  const [sessionCursor, setSessionCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  /** The loaded project, for stable callbacks that must not depend on a changing prop. */
  const projectRef = useRef<ProjectSummary | null>(null);

  const loadProjects = useCallback(async (): Promise<void> => {
    try {
      const read = await rpc.call<{ projects: readonly ProjectRow[] }>('project.list', { limit: 200 });
      setProjects(read.projects);
    } catch {
      // The menu degrades to the current project instead of hiding the failure behind an empty list.
      setProjects([]);
    }
  }, [rpc]);

  const loadSessions = useCallback(
    async (pid: string, cursor?: string): Promise<{ rows: readonly SessionRow[]; nextCursor: string | null }> => {
      const read = await rpc.call<{
        sessions: readonly (Omit<SessionRow, 'updatedAt'> & { lastActivityAt: string | null })[];
        nextCursor: string | null;
      }>('session.list', {
        projectId: pid,
        limit: SESSION_PAGE,
        ...(cursor === undefined ? {} : { cursor }),
      });
      return {
        // The server names the stamp for what it is; the rail's row keeps one name for "when it
        // last moved", so a missing mapping cannot silently blank every timestamp.
        rows: read.sessions.map((row) => ({
          sessionId: row.sessionId,
          roleId: row.roleId,
          revision: row.revision,
          title: row.title ?? null,
          channel: row.channel ?? null,
          activity: row.activity,
          updatedAt: row.lastActivityAt ?? null,
          currentTaskId: row.currentTaskId,
          queuedInputs: row.queuedInputs,
        })),
        nextCursor: read.nextCursor,
      };
    },
    [rpc],
  );

  projectRef.current = project;

  /**
   * The one rule for "which session is shown": the remembered one if the server still has it,
   * otherwise the newest, otherwise none. A stored id that no longer exists (a wiped database, a
   * cleaned-up session) must be dropped - keeping it made the shell open a session the server does
   * not have and sit in "reconnecting" forever.
   */
  const chooseSession = useCallback((rows: readonly SessionRow[]): void => {
    const known = readTab(SESSION_KEY);
    const next = rows.find((row) => row.sessionId === known)?.sessionId ?? rows[0]?.sessionId ?? '';
    setSessionId(next);
    if (next === '') removeTab(SESSION_KEY);
    else writeTab(SESSION_KEY, next);
  }, []);

  // A project row is a plain fact, so the callback that stores it must not change when a row does:
  // otherwise every open re-creates the shell's session stream.
  const applyProject = useCallback(
    async (summary: ProjectSummary): Promise<void> => {
      projectRef.current = summary;
      setProject(summary);
      // Both scopes are written here, from the one place that knows the project really opened:
      // this tab now shows it, and a tab opened later starts from it.
      writeTab(PROJECT_KEY, summary.realPath);
      writeStored(LAST_PROJECT_KEY, summary.realPath);
      let rows: readonly SessionRow[] = [];
      try {
        const page = await loadSessions(summary.projectId);
        rows = page.rows;
        setSessionCursor(page.nextCursor);
      } catch {
        // A broken list must not look like a project with no sessions.
        setSessionCursor(null);
      }
      setSessions(rows);
      chooseSession(rows);
    },
    [loadSessions, chooseSession],
  );

  const refresh = useCallback(async (): Promise<void> => {
    // This tab's own choice wins; a tab that has not chosen yet starts from the last project the
    // profile opened, which keeps "open the workbench and continue" while tabs stay independent.
    // A tab that has not chosen yet starts from the last project the profile opened. Builds before
    // per-tab scoping kept this very key in localStorage; adopt that value so an upgrade does not
    // land the user on an empty shell. It is cleared only after the project really opened, because
    // this refresh also runs before login and a refused open must not consume the only copy.
    const legacyPath = readStored(PROJECT_KEY);
    const path = readTab(PROJECT_KEY) ?? readStored(LAST_PROJECT_KEY) ?? legacyPath;
    if (path === null) {
      // Nothing remembered here is not "no projects": the registry lives on the server, so a fresh
      // tab or browser must still see what was added. The early return here is why the switcher
      // once read "No project registered yet" while the server held a project.
      setLoading(false);
      await loadProjects();
      return;
    }
    try {
      const opened = await rpc.call<{ project: ProjectSummary }>('project.open', { path }, { requestId: newRequestId('open') });
      await applyProject(opened.project);
      if (legacyPath !== null) removeStored(PROJECT_KEY);
    } catch {
      // An unreadable directory is not fatal: the shell still opens with the empty state. This
      // tab's path stays (so the user can rebind it), but a remembered session cannot belong to a
      // project that did not open - it would outlive its own project and point the shell at nothing.
      setProject(null);
      setSessionId('');
      removeTab(SESSION_KEY);
    } finally {
      setLoading(false);
      void loadProjects();
    }
  }, [rpc, applyProject, loadProjects]);

  useEffect(() => {
    // A stored project path is only a hint: re-open by path, so a moved directory reports itself
    // instead of leaving the shell pointed at a row that no longer resolves.
    void refresh();
  }, []);

  const openProject = useCallback(
    async (path: string): Promise<void> => {
      const opened = await rpc.call<{ project: ProjectSummary }>('project.open', { path }, { requestId: newRequestId('open') });
      await applyProject(opened.project);
      await loadProjects();
    },
    [rpc, applyProject, loadProjects],
  );

  /**
   * Rebind takes the revision the menu row carried: moving a directory is the user's decision, and
   * the server refuses it while work is in flight (the refusal names what must stop first). No
   * decision reference is sent: the browser has none to cite, and no model tool offers this call.
   */
  const rebindProject = useCallback(
    async (targetProjectId: string, path: string): Promise<void> => {
      const row = projects.find((entry) => entry.projectId === targetProjectId);
      const rebound = await rpc.call<{ project: ProjectSummary }>(
        'project.rebind',
        {
          projectId: targetProjectId,
          expectedRevision: row?.revision ?? 0,
          path,
        },
        { requestId: newRequestId('rebind') },
      );
      // The user rebound the project they are looking at, so this tab follows it: the stored path is
      // the new one, and the next boot opens the moved directory instead of failing.
      await applyProject(rebound.project);
      await loadProjects();
    },
    [rpc, projects, applyProject, loadProjects],
  );

  const selectSession = useCallback((next: string): void => {
    setSessionId(next);
    writeTab(SESSION_KEY, next);
  }, []);

  // The project id is derived from the loaded project, never stored twice: two sources of the
  // same fact is how a stale id keeps requesting a project the user already left.
  const projectId = project?.projectId ?? '';

  /**
   * The callbacks below are stable on purpose. The shell pushes this object into effects that
   * open a session stream; an identity that changes every render would restart the stream on
   * every render, which is exactly the hot loop this shape prevents.
   */
  const createSession = useCallback(async (): Promise<string | null> => {
    const current = projectRef.current;
    if (current === null) return null;
    const created = await rpc.call<{ session: { sessionId: string } }>(
      'session.create',
      { projectId: current.projectId },
      { requestId: newRequestId('sess') },
    );
    selectSession(created.session.sessionId);
    try {
      const page = await loadSessions(current.projectId);
      setSessions(page.rows);
      setSessionCursor(page.nextCursor);
    } catch {
      setSessionCursor(null);
    }
    return created.session.sessionId;
  }, [rpc, selectSession, loadSessions]);

  const refreshSessions = useCallback(async (): Promise<void> => {
    const current = projectRef.current;
    if (current === null) return;
    try {
      const page = await loadSessions(current.projectId);
      setSessions(page.rows);
      setSessionCursor(page.nextCursor);
      // A rail that lost the open session (a cleanup, another tab) must move the shell with it.
      chooseSession(page.rows);
    } catch {
      // Leave the rows as they are: a stale rail is better than a rail that empties itself.
    }
  }, [loadSessions, chooseSession]);

  const loadMoreSessions = useCallback(async (): Promise<void> => {
    const current = projectRef.current;
    if (current === null || sessionCursor === null) return;
    try {
      const page = await loadSessions(current.projectId, sessionCursor);
      // Append, never replace: the rows already shown stay in their order.
      setSessions((previous) => [...previous, ...page.rows.filter((row) => !previous.some((shown) => shown.sessionId === row.sessionId))]);
      setSessionCursor(page.nextCursor);
    } catch {
      setSessionCursor(null);
    }
  }, [loadSessions, sessionCursor]);

  return useMemo(
    () => ({
      projectId,
      project,
      projects,
      sessions,
      hasMoreSessions: sessionCursor !== null,
      sessionId,
      loading,
      openProject,
      rebindProject,
      selectSession,
      createSession,
      loadMoreSessions,
      refresh,
      refreshSessions,
      reloadProjects: loadProjects,
    }),
    [
      projectId,
      project,
      projects,
      sessions,
      sessionCursor,
      sessionId,
      loading,
      openProject,
      rebindProject,
      selectSession,
      createSession,
      loadMoreSessions,
      refresh,
      refreshSessions,
      loadProjects,
    ],
  );
}
