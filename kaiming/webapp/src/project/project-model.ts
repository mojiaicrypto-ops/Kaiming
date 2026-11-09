import { useCallback, useEffect, useState } from 'react';
import type { RpcClient } from '../api/rpc';
import { RpcError } from '../api/rpc';

/**
 * The project page reads the backlog file as it is (BF-3): items, problems and warnings travel
 * together, so a broken entry is shown where it lives instead of being dropped from the list.
 */
export interface BacklogIssueView {
  readonly line: number;
  readonly reason: string;
  readonly excerpt: string;
  readonly id?: string;
}

export interface BacklogTaskRef {
  readonly taskId: string;
  readonly status: string;
  readonly chiefSessionId?: string;
}

export interface BacklogItemView {
  readonly id: string;
  readonly title: string;
  readonly state: 'open' | 'done' | 'dropped';
  readonly ready: boolean;
  readonly specRefs: readonly string[];
  readonly updatedAt?: string;
  readonly line: number;
  readonly body: string;
  readonly digest: string;
  readonly note?: string;
  readonly source?: string;
  readonly createdBy?: string;
  readonly closedBy?: string;
  readonly openTasks: readonly BacklogTaskRef[];
  readonly lastClosedTask?: BacklogTaskRef;
  readonly problems: readonly BacklogIssueView[];
  readonly warnings: readonly BacklogIssueView[];
}

export interface BacklogRead {
  readonly items: readonly BacklogItemView[];
  readonly issues: readonly BacklogIssueView[];
  readonly warnings: readonly BacklogIssueView[];
  readonly nextCursor: string | null;
}

export interface PendingInteractionView {
  readonly interactionId: string;
  readonly taskId: string | null;
  readonly title: string;
  readonly sourceSessionId: string;
}

const POLL_MS = 5_000;

function useVisiblePoll(read: () => Promise<void>): void {
  useEffect(() => {
    void read();
    let timer: number | null = null;
    const start = (): void => {
      if (timer !== null) window.clearInterval(timer);
      timer = window.setInterval(() => {
        if (document.visibilityState === 'visible') void read();
      }, POLL_MS);
    };
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') void read();
    };
    start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      if (timer !== null) window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [read]);
}

export function useBacklog(rpc: RpcClient, projectId: string): {
  readonly data: BacklogRead;
  readonly loading: boolean;
  readonly error: string | null;
  readonly reload: () => Promise<void>;
  readonly add: (title: string) => Promise<BacklogItemView>;
  readonly update: (
    id: string,
    expectedDigest: string,
    patch: { title?: string; body?: string; specRefs?: string[] },
  ) => Promise<BacklogItemView>;
  readonly close: (id: string, state: 'done' | 'dropped', note: string) => Promise<BacklogItemView>;
  readonly reopen: (id: string, expectedDigest: string, note: string) => Promise<BacklogItemView>;
} {
  const [data, setData] = useState<BacklogRead>({ items: [], issues: [], warnings: [], nextCursor: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    if (projectId === '') {
      setData({ items: [], issues: [], warnings: [], nextCursor: null });
      setLoading(false);
      return;
    }
    try {
      const read = await rpc.call<BacklogRead>('backlog.list', { projectId, state: 'all', limit: 200 });
      setData({ items: read.items, issues: read.issues, warnings: read.warnings, nextCursor: read.nextCursor });
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [rpc, projectId]);
  useVisiblePoll(reload);

  const write = useCallback(
    async <T,>(method: string, params: Record<string, unknown>): Promise<T> => {
      const result = await rpc.call<{ item: T }>(method, { projectId, ...params });
      await reload();
      return result.item;
    },
    [rpc, projectId, reload],
  );

  return {
    data,
    loading,
    error,
    reload,
    add: (title) => write<BacklogItemView>('backlog.add', { title }),
    update: (id, expectedDigest, patch) =>
      write<BacklogItemView>('backlog.update', { id, expectedDigest, ...patch }),
    close: (id, state, note) => write<BacklogItemView>('backlog.close', { id, state, note }),
    reopen: (id, expectedDigest, note) =>
      write<BacklogItemView>('backlog.reopen', { id, expectedDigest, note }),
  };
}

/** Unanswered questions of the whole project: the "waiting for you" marker on a Task row. */
export function usePendingInteractions(
  rpc: RpcClient,
  projectId: string,
): {
  readonly all: readonly PendingInteractionView[];
  readonly byTask: ReadonlyMap<string, PendingInteractionView>;
  readonly reload: () => Promise<void>;
} {
  const [all, setAll] = useState<readonly PendingInteractionView[]>([]);
  const [byTask, setByTask] = useState<ReadonlyMap<string, PendingInteractionView>>(new Map());
  const reload = useCallback(async (): Promise<void> => {
    if (projectId === '') {
      setAll([]);
      setByTask(new Map());
      return;
    }
    try {
      const read = await rpc.call<{ interactions: readonly PendingInteractionView[] }>('interaction.list', {
        projectId,
      });
      const next = new Map<string, PendingInteractionView>();
      for (const interaction of read.interactions) {
        if (interaction.taskId !== null && !next.has(interaction.taskId)) {
          next.set(interaction.taskId, interaction);
        }
      }
      setAll(read.interactions);
      setByTask(next);
    } catch {
      // A failed read must not invent a decision: keep the last known markers and let the next
      // poll replace them.
    }
  }, [rpc, projectId]);
  useVisiblePoll(reload);
  return { all, byTask, reload };
}

/** The project knowledge file, read as text: the module section is rendered from it verbatim. */
export function useProjectText(
  rpc: RpcClient,
  projectId: string,
  path: string,
): { readonly text: string | null; readonly reload: () => Promise<void> } {
  const [text, setText] = useState<string | null>(null);
  const reload = useCallback(async (): Promise<void> => {
    if (projectId === '') {
      setText(null);
      return;
    }
    try {
      const read = await rpc.call<{ text: string }>('project.files.read', { projectId, path });
      setText(read.text);
    } catch {
      setText(null);
    }
  }, [rpc, projectId, path]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { text, reload };
}

/** Ready (has a spec reference) versus idea; closed entries are kept for history, folded in the UI. */
export function groupsOf(items: readonly BacklogItemView[]): {
  readonly ready: readonly BacklogItemView[];
  readonly ideas: readonly BacklogItemView[];
  readonly closed: readonly BacklogItemView[];
} {
  const open = items.filter((item) => item.state === 'open');
  return {
    ready: open.filter((item) => item.ready),
    ideas: open.filter((item) => !item.ready),
    closed: items.filter((item) => item.state !== 'open'),
  };
}

/**
 * The page's name for the project: the first level-1 heading of PROJECT.md, unless it is missing,
 * generic, or absurdly long. The directory name is the honest fallback — a temporary checkout
 * should not turn into a title.
 */
export function projectNameFrom(markdown: string | null, fallback: string): string {
  const line = markdown?.split(/\r?\n/).find((entry) => /^#\s+\S/.test(entry.trim()));
  if (line === undefined) return fallback;
  const title = line.trim().replace(/^#\s+/, '').trim();
  if (title === '' || title.length > 80 || /^(项目|project)$/i.test(title)) return fallback;
  return title;
}

export interface ModuleRow {
  readonly cells: readonly string[];
}

/** The table's own header row plus its body: a table without headings hides what the columns mean. */
export interface ModuleTable {
  readonly headers: readonly string[];
  readonly rows: readonly ModuleRow[];
}

/**
 * The「模块」section of `.dev/PROJECT.md`, as its first Markdown table. Returns null when the
 * section or the table is absent: the page then simply has no module block (BL-04).
 */
export function moduleTable(markdown: string | null): ModuleTable | null {
  if (markdown === null) return null;
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => /^#{2,3}\s+(模块|modules)\s*$/i.test(line.trim()));
  if (start < 0) return null;
  const level = (lines[start]?.match(/^#+/)?.[0] ?? '##').length;
  let index = start + 1;
  const body: string[] = [];
  while (index < lines.length) {
    const heading = lines[index]?.match(/^(#{1,6})\s+/);
    if (heading != null && (heading[1]?.length ?? 0) <= level) break;
    body.push(lines[index] ?? '');
    index += 1;
  }
  const tableStart = body.findIndex((line) => line.trim().startsWith('|'));
  if (tableStart < 0) return null;
  const rows: ModuleRow[] = [];
  for (const line of body.slice(tableStart)) {
    if (!line.trim().startsWith('|')) {
      if (rows.length > 0) break;
      continue;
    }
    const cells = line
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((cell) => cell.trim());
    if (cells.every((cell) => /^:?-{2,}:?$/.test(cell))) continue;
    rows.push({ cells });
  }
  const headers = rows[0];
  return headers === undefined ? null : { headers: headers.cells, rows: rows.slice(1) };
}

/**
 * A module cell that names something openable: a repository path (with or without a trailing
 * slash) or a code/spec file. Prose cells, URLs and absolute paths are not links.
 * `server/account/` is the common case; a plain word like `账号` is not.
 */
export function cellPath(cell: string): string | undefined {
  const token = cell.trim().replace(/^`|`$/g, '');
  if (token === '' || token.includes('`') || /\s/.test(token)) return undefined;
  if (token.startsWith('/') || token.startsWith('~') || /^[a-z]+:\/\//i.test(token)) return undefined;
  if (!/^[\w.@/-]+$/.test(token)) return undefined;
  if (token.endsWith('/')) return token;
  return /\.(tsx?|jsx?|json|md)$/i.test(token) ? token : undefined;
}

/** The same rule the server enforces: a stale digest is a merge prompt, not a crash. */
export function isVersionConflict(error: unknown): error is RpcError {
  return error instanceof RpcError && error.code === 'VERSION_CONFLICT';
}

/** Spec references are one per line in the editor, which is exactly what BF-2 writes. */
export function parseSpecRefs(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

export interface TaskRowSummary {
  readonly taskId: string;
  readonly type: string;
  readonly phase: string;
  readonly status: string;
  readonly goal: string;
  readonly chiefSessionId: string;
  readonly phaseMembers: readonly string[];
  readonly updatedAt: string;
  readonly createdAt?: string;
}

/**
 * The project's Tasks, newest first as the server returns them. The project page shows what is
 * running next to what is requested: "what is happening now" is a question about this project,
 * not only about the conversation that happens to be open.
 */
export function useTasks(rpc: RpcClient, projectId: string) {
  const [tasks, setTasks] = useState<readonly TaskRowSummary[]>([]);
  const [tasksError, setTasksError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const page = useCallback(
    async (after?: string): Promise<{ rows: readonly TaskRowSummary[]; next: string | null }> => {
      const read = await rpc.call<{ tasks: readonly TaskRowSummary[]; nextCursor: string | null }>('task.list', {
        projectId,
        limit: 50,
        ...(after === undefined ? {} : { cursor: after }),
      });
      return { rows: read.tasks, next: read.nextCursor };
    },
    [rpc, projectId],
  );
  const reloadTasks = useCallback(async (): Promise<void> => {
    if (projectId === '') {
      setTasks([]);
      setCursor(null);
      return;
    }
    try {
      const first = await page();
      setTasks(first.rows);
      setCursor(first.next);
      setTasksError(null);
    } catch (cause) {
      setTasksError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [page, projectId]);
  useEffect(() => {
    void reloadTasks();
  }, [reloadTasks]);
  useVisiblePoll(reloadTasks);
  const loadMoreTasks = useCallback(async (): Promise<void> => {
    if (cursor === null) return;
    try {
      const next = await page(cursor);
      setTasks((previous) => [
        ...previous,
        ...next.rows.filter((row) => !previous.some((shown) => shown.taskId === row.taskId)),
      ]);
      setCursor(next.next);
    } catch (cause) {
      setTasksError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [page, cursor]);
  return { tasks, tasksError, reloadTasks, loadMoreTasks, hasMoreTasks: cursor !== null };
}
