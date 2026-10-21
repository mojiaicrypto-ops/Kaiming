import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RpcClient, newRequestId } from '../api/rpc';
import { readStored, writeStored } from '../lib/storage';

const PROJECT_KEY = 'agentdev.projectPath';
const SESSION_KEY = 'agentdev.sessionId';

export interface ProjectSummary {
  readonly projectId: string;
  readonly realPath: string;
  readonly revision: number;
  readonly directoryExists: boolean;
  readonly problem?: string;
  readonly sessions: ReadonlyArray<{ sessionId: string; roleId: string }>;
  readonly tasks: ReadonlyArray<{ taskId: string; phase: string; status: string }>;
}

/** One row of the session rail. The title is derived, never stored: the server has no title column. */
export interface SessionRow {
  readonly sessionId: string;
  readonly roleId: string;
  readonly title: string;
  readonly updatedAt: string | null;
  readonly currentTaskId: string | null;
}

interface RecentProject {
  readonly path: string;
  readonly name: string;
}

const RECENT_KEY = 'agentdev.recentProjects';
/** Titles are cut by display width: a CJK glyph counts double, like the terminal it came from. */
const TITLE_WIDTH = 24;

function displayWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    width += code > 0x2e7f ? 2 : 1;
  }
  return width;
}

/** One line, cut to `TITLE_WIDTH` cells; a long first message must not stretch the rail. */
export function deriveTitle(firstUserText: string | undefined): string {
  if (firstUserText === undefined) return '';
  const line = firstUserText.replace(/\s+/g, ' ').trim();
  if (line === '') return '';
  let out = '';
  let width = 0;
  for (const char of line) {
    const next = displayWidth(char);
    if (width + next > TITLE_WIDTH) return `${out}…`;
    out += char;
    width += next;
  }
  return out;
}

function readRecent(): RecentProject[] {
  try {
    const raw = readStored(RECENT_KEY);
    const parsed = raw === null ? [] : (JSON.parse(raw) as unknown);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is RecentProject => {
      const candidate = entry as Partial<RecentProject>;
      return typeof candidate.path === 'string' && typeof candidate.name === 'string';
    });
  } catch {
    return [];
  }
}

function rememberRecent(path: string): RecentProject[] {
  const next = [{ path, name: path.split('/').filter(Boolean).pop() ?? path }, ...readRecent().filter((entry) => entry.path !== path)].slice(0, 8);
  writeStored(RECENT_KEY, JSON.stringify(next));
  return next;
}

export interface WorkspaceApi {
  readonly projectId: string;
  readonly project: ProjectSummary | null;
  readonly sessions: readonly SessionRow[];
  readonly recent: readonly RecentProject[];
  readonly sessionId: string;
  readonly loading: boolean;
  readonly openProject: (path: string) => Promise<void>;
  readonly selectSession: (sessionId: string) => void;
  readonly createSession: () => Promise<string | null>;
  readonly refresh: () => Promise<void>;
}

/**
 * Project + session selection. The server exposes no `project.list`, so the project menu is the
 * browser's own recent list plus a path field; the session list is `project.get`, and each row's
 * title is derived from the first user message read through `session.stream.prepare`
 * (read-only, no subscription).
 */
export function useWorkspace(rpc: RpcClient): WorkspaceApi {
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [sessionId, setSessionId] = useState<string>(() => readStored(SESSION_KEY) ?? '');
  const [sessions, setSessions] = useState<readonly SessionRow[]>([]);
  const [recent, setRecent] = useState<readonly RecentProject[]>(() => readRecent());
  const [loading, setLoading] = useState(true);
  /** sessionId → derived title, so a refresh does not re-read every history. */
  const titleCache = useRef(new Map<string, string>());
  /** The loaded project, for stable callbacks that must not depend on a changing prop. */
  const projectRef = useRef<ProjectSummary | null>(null);

  const loadTitles = useCallback(
    async (pid: string, rows: ReadonlyArray<{ sessionId: string; roleId: string }>): Promise<SessionRow[]> => {
      const enriched = await Promise.all(
        rows.map(async (row) => {
          const cached = titleCache.current.get(row.sessionId);
          try {
            const prepared = await rpc.call<{
              snapshot: {
                messages: ReadonlyArray<{ role?: string; content?: unknown }>;
                currentInputId: string | null;
              };
            }>('session.stream.prepare', { projectId: pid, sessionId: row.sessionId });
            const firstUser = prepared.snapshot.messages.find((message) => message.role === 'user');
            const text = Array.isArray(firstUser?.content)
              ? (firstUser.content as Array<{ type?: string; text?: string }>).map((block) => (block.type === 'text' ? block.text ?? '' : '')).join('')
              : typeof firstUser?.content === 'string'
                ? firstUser.content
                : '';
            const title = deriveTitle(text) || cached || '';
            titleCache.current.set(row.sessionId, title);
            // `lastActivityAt` is derived by the server from the session's own input rows: it is
            // the only activity stamp available, and the rail's relative day is derived from it.
            const read = await rpc.call<{
              session: { currentTaskId: string | null; lastActivityAt: string | null };
            }>('session.get', { projectId: pid, sessionId: row.sessionId });
            return {
              sessionId: row.sessionId,
              roleId: row.roleId,
              title,
              updatedAt: read.session.lastActivityAt,
              currentTaskId: read.session.currentTaskId,
            } satisfies SessionRow;
          } catch {
            return {
              sessionId: row.sessionId,
              roleId: row.roleId,
              title: cached ?? '',
              updatedAt: null,
              currentTaskId: null,
            } satisfies SessionRow;
          }
        }),
      );
      // Sessions without a first message are the newest: they sort first, like a fresh chat list.
      return enriched.sort((left, right) => {
        const leftEmpty = left.title === '' ? 0 : 1;
        const rightEmpty = right.title === '' ? 0 : 1;
        if (leftEmpty !== rightEmpty) return leftEmpty - rightEmpty;
        return 0;
      });
    },
    [rpc],
  );

  projectRef.current = project;

  // Same rule as above: a project row is a plain fact, so the callback that stores it must not
  // change when a row does — otherwise every open re-creates the shell's session stream.
  const applyProject = useCallback(
    async (summary: ProjectSummary): Promise<void> => {
      projectRef.current = summary;
      setProject(summary);
      writeStored('agentdev.projectId', summary.projectId);
      const rows = await loadTitles(summary.projectId, summary.sessions);
      setSessions(rows);
      const known = readStored(SESSION_KEY);
      const next = rows.find((row) => row.sessionId === known)?.sessionId ?? rows[0]?.sessionId ?? '';
      if (next !== '') {
        setSessionId(next);
        writeStored(SESSION_KEY, next);
      }
    },
    [loadTitles],
  );

  const refresh = useCallback(async (): Promise<void> => {
    const path = readStored(PROJECT_KEY);
    if (path === null) {
      setLoading(false);
      return;
    }
    try {
      const opened = await rpc.call<{ project: ProjectSummary }>('project.open', { path }, { requestId: newRequestId('open') });
      writeStored(PROJECT_KEY, opened.project.realPath);
      setRecent(rememberRecent(opened.project.realPath));
      await applyProject(opened.project);
    } catch {
      // An unreadable directory is not fatal: the shell still opens with the empty state.
      setProject(null);
    } finally {
      setLoading(false);
    }
  }, [rpc, applyProject]);

  useEffect(() => {
    // A stored project id is only a hint: re-open by path, so a moved directory reports itself
    // instead of leaving the shell pointed at a row that no longer resolves.
    void refresh();
  }, []);

  const openProject = useCallback(
    async (path: string): Promise<void> => {
      const opened = await rpc.call<{ project: ProjectSummary }>('project.open', { path }, { requestId: newRequestId('open') });
      writeStored(PROJECT_KEY, opened.project.realPath);
      setRecent(rememberRecent(opened.project.realPath));
      await applyProject(opened.project);
    },
    [rpc, applyProject],
  );

  const selectSession = useCallback((next: string): void => {
    setSessionId(next);
    writeStored(SESSION_KEY, next);
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
    const read = await rpc.call<{ project: ProjectSummary }>('project.get', { projectId: current.projectId });
    const rows = await loadTitles(current.projectId, read.project.sessions);
    setSessions(rows);
    return created.session.sessionId;
  }, [rpc, selectSession, loadTitles]);

  return useMemo(
    () => ({ projectId, project, sessions, recent, sessionId, loading, openProject, selectSession, createSession, refresh }),
    [projectId, project, sessions, recent, sessionId, loading, openProject, selectSession, createSession, refresh],
  );
}
