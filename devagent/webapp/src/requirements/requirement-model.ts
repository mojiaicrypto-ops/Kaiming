import { useCallback, useEffect, useRef, useState } from 'react';
import type { RpcClient } from '../api/rpc';

export interface RequirementSummary {
  readonly id: string;
  readonly kind: 'proposal' | 'implementation';
  readonly title: string;
  readonly status: string;
  readonly updatedAt: string;
  readonly sourceRequirementIds: readonly string[];
  readonly linkedTaskIds: readonly string[];
}

export interface InvalidRequirementFile {
  readonly file: string;
  readonly issues: readonly string[];
}

export interface RequirementRead {
  readonly requirementId: string;
  readonly path: string;
  readonly text: string;
  readonly metadata?: Record<string, unknown>;
  readonly issues: readonly string[];
}

export type Column = 'proposal' | 'todo' | 'doing' | 'done';

/**
 * Which board column a record belongs to: a projection of its own status, never a second status.
 * A proposal is always a proposal; an implementation requirement moves when the server says so.
 */
export function columnOf(record: RequirementSummary): Column {
  if (record.kind === 'proposal') return 'proposal';
  if (record.status === 'completed') return 'done';
  if (record.status === 'in_progress') return 'doing';
  return 'todo';
}

/** The `## heading` sections the requirement format defines, in document order. */
export function sectionsOf(text: string): Record<string, string> {
  const body = text.replace(/^---\n[\s\S]*?\n---\n?/, '');
  const out: Record<string, string> = {};
  for (const part of body.split(/^##\s+/m).slice(1)) {
    const newline = part.indexOf('\n');
    if (newline < 0) continue;
    out[part.slice(0, newline).trim()] = part.slice(newline + 1).trim();
  }
  return out;
}

/**
 * Reads again while the tab is visible. The board is a projection of files another process writes —
 * a value kept from mount is a claim about the past, and the user's own Task can move a card while
 * the board is open. A hidden tab asks nothing: nobody can see the answer.
 */
function useVisibleRefresh(read: () => Promise<void>, intervalMs: number): void {
  useEffect(() => {
    let timer: number | null = null;
    const visible = (): boolean => document.visibilityState === 'visible';
    const tick = (): void => {
      void read().catch(() => undefined);
    };
    const start = (): void => {
      if (timer !== null || !visible()) return;
      tick();
      timer = window.setInterval(tick, intervalMs);
    };
    const stop = (): void => {
      if (timer === null) return;
      window.clearInterval(timer);
      timer = null;
    };
    const onVisibility = (): void => {
      if (visible()) start();
      else stop();
    };
    document.addEventListener('visibilitychange', onVisibility);
    start();
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      stop();
    };
  }, [read, intervalMs]);
}

/** How often the board re-reads the records. Files change when a person or the chief writes them. */
const BOARD_POLL_MS = 5_000;

export function useRequirements(rpc: RpcClient, projectId: string) {
  const [items, setItems] = useState<readonly RequirementSummary[]>([]);
  const [invalid, setInvalid] = useState<readonly InvalidRequirementFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async (): Promise<void> => {
    if (projectId === '') {
      setLoading(false);
      return;
    }
    try {
      const read = await rpc.call<{ items: RequirementSummary[]; invalidFiles: InvalidRequirementFile[] }>(
        'requirement.list',
        { projectId, limit: 200 },
      );
      setItems(read.items);
      setInvalid(read.invalidFiles);
      setError(null);
    } catch (cause) {
      // Keep whatever was on screen and say the read failed: an empty board would read as "no
      // requirements", which is a different and much worse statement.
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [rpc, projectId]);
  useEffect(() => {
    void reload().catch(() => setLoading(false));
  }, [reload]);
  useVisibleRefresh(reload, BOARD_POLL_MS);
  return { items, invalid, loading, error, reload };
}

/** One Task row for the board: the same summary `task.get` returns, without the detail payload. */
export interface TaskRowSummary {
  readonly taskId: string;
  readonly type: string;
  readonly phase: string;
  readonly status: string;
  readonly goal: string;
  readonly chiefSessionId: string;
  readonly phaseMembers: readonly string[];
  readonly updatedAt: string;
}

/**
 * The project's Tasks, newest first as the server returns them. The board lists what is running
 * next to what is requested: "what is happening now" is a question about this project, not only
 * about the conversation that happens to be open.
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
      // A failed read must not look like "no Tasks": the section says it could not read them.
      setTasksError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [page, projectId]);
  useEffect(() => {
    void reloadTasks();
  }, [reloadTasks]);
  // A refresh replaces the first page, so it would collapse rows the user asked for with "show more".
  const extended = useRef(false);
  const stableReload = useCallback(async (): Promise<void> => {
    if (extended.current) return;
    await reloadTasks();
  }, [reloadTasks]);
  useVisibleRefresh(stableReload, BOARD_POLL_MS);
  const loadMoreTasks = useCallback(async (): Promise<void> => {
    if (cursor === null) return;
    extended.current = true;
    try {
      const next = await page(cursor);
      setTasks((previous) => [...previous, ...next.rows.filter((row) => !previous.some((shown) => shown.taskId === row.taskId))]);
      setCursor(next.next);
    } catch (cause) {
      setTasksError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [page, cursor]);
  return { tasks, tasksError, reloadTasks, loadMoreTasks, hasMoreTasks: cursor !== null };
}
