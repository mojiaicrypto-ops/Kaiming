import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { RpcClient, RpcError, newRequestId } from '../api/rpc';
import { SessionStream, type PreparedSnapshot, type StreamFrame, type PendingInteraction } from '../api/stream';
import { emptySlot, slotReducer, type SessionSlot, type TaskDetail } from '../state/slot';
import { toast } from '../lib/toast';

export interface SessionRef {
  readonly projectId: string;
  readonly sessionId: string;
}

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'offline';

/** The live surface a screen consumes; declared here so screens import a name, not a helper type. */
export interface ChiefSessionApi {
  readonly rpc: RpcClient;
  readonly slot: SessionSlot;
  readonly status: ConnectionStatus;
  readonly historyProblems: readonly string[];
  readonly blocked: { readonly code: string; readonly detail: string } | null;
  readonly dismissBlocked: () => void;
  readonly submit: (text: string) => Promise<{ queued: boolean; waitingForTask?: string }>;
  readonly stop: () => Promise<void>;
  readonly cancelQueuedInput: (inputId: string) => Promise<void>;
  readonly respond: (interaction: PendingInteraction, response: unknown) => Promise<void>;
  readonly refreshTask: (taskId: string) => Promise<TaskDetail | null>;
  readonly activeTaskId: string | null;
  readonly retry: () => void;
  readonly notify: (text: string, kind?: 'info' | 'success' | 'error') => void;
}

/**
 * One chief session's live state, driven by the shell's single RPC client: the cookie, the CSRF
 * token and the 401 handling live in exactly one place, so a screen can never hold a stale copy.
 */
export function useSession(session: SessionRef | null, enabled: boolean, rpc: RpcClient, onUnauthorized: () => void): ChiefSessionApi {
  const [slot, dispatch] = useReducer(slotReducer, undefined, emptySlot);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [historyProblems, setHistoryProblems] = useState<readonly string[]>([]);
  const streamRef = useRef<SessionStream | null>(null);
  const [blocked, setBlocked] = useState<{ code: string; detail: string } | null>(null);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  /** Bumped by a retry button: restarts the effect even when the session did not change. */
  const [retryTick, setRetryTick] = useState(0);

  // Keyed by the ids, not by the object: this callback is an effect dependency, and an
  // identity that changes with the caller's inline literal would restart the stream forever.
  const projectId = session?.projectId ?? null;
  const sessionId = session?.sessionId ?? null;
  const refreshPending = useCallback(async (): Promise<void> => {
    if (projectId === null || sessionId === null) return;
    const read = await rpc.call<{ snapshot: { interactions: PendingInteraction[] } }>('session.stream.prepare', {
      projectId,
      sessionId,
    });
    dispatch({ type: 'pendingReplaced', pending: read.snapshot.interactions });
  }, [rpc, projectId, sessionId]);

  useEffect(() => {
    if (session === null || !enabled) return;
    dispatch({ type: 'reset' });
    setBlocked(null);
    setHistoryProblems([]);
    const onFrame = (frame: StreamFrame): void => {
      const event = frame.event;
      if (frame.type === 'pi' && event?.type === 'blocked') {
        const blockedEvent = event as { code?: unknown; detail?: unknown };
        setBlocked({ code: String(blockedEvent.code ?? 'BLOCKED'), detail: String(blockedEvent.detail ?? '') });
      }
      // Business notices arrive as top-level frames ({type:'invalidate', entity, id}), not
      // wrapped in event (http.ts publishes the notice object as the frame itself).
      const notice = frame as unknown as { entity?: string; id?: string };
      if (frame.type === 'invalidate' && notice.entity === 'task' && typeof notice.id === 'string') {
        setActiveTaskId(notice.id);
      }
      if (frame.type === 'invalidate' && notice.entity === 'input' && typeof notice.id === 'string') {
        // The submit's own receipt: this input is now the session's current (queued) input.
        // Without it currentInputId stays null and STOP would no-op on the run just started.
        dispatch({ type: 'inputAccepted', inputId: notice.id });
      }
      if (frame.type === 'invalidate' && notice.entity === 'interaction' && typeof notice.id === 'string') {
        // An interaction changed — created OR resolved. The frame carries no payload, so re-read
        // the pending list; dispatching the authoritative list also removes answered cards.
        void refreshPending();
      }
      dispatch({ type: 'frame', frame });
    };
    const onSnapshot = (snapshot: PreparedSnapshot): void => {
      if (snapshot.sessionId !== sessionId) return;
      setStatus('connected');
      setHistoryProblems(snapshot.historyProblems ?? []);
      dispatch({ type: 'snapshot', snapshot, reason: 'resync' });
      // Restore the coordinated Task after (re)connect: the invalidate frames that would set
      // activeTaskId may have fired before this tab subscribed, leaving the Task strip absent
      // even though a member is running right now.
      void rpc
        .call<{ session: { currentTaskId: string | null } }>('session.get', {
          projectId,
          sessionId,
        })
        .then((read) => {
          if (read.session.currentTaskId !== null) {
            setActiveTaskId(read.session.currentTaskId);
              }
        })
        .catch(() => undefined);
    };
    const stream = new SessionStream(rpc, session.projectId, session.sessionId, {
      onFrame,
      onSnapshot,
      onError: () => setStatus('reconnecting'),
    });
    streamRef.current = stream;
    setStatus('connecting');
    void stream.start().catch((error: unknown) => {
      if (error instanceof RpcError && error.code === 'UNAUTHORIZED') onUnauthorized();
      else setStatus('reconnecting');
    });
    return () => {
      stream.stop();
      streamRef.current = null;
    };
    // Identity-stable on purpose: the caller passes `{projectId, sessionId}` inline, so depending
    // on the object would restart the stream on every render (a hot loop, not a re-subscribe).
  }, [rpc, projectId, sessionId, enabled, retryTick, refreshPending, onUnauthorized]);

  /** Reconnect now instead of waiting for the next backoff: the user's explicit retry. */
  const retry = useCallback((): void => setRetryTick((tick) => tick + 1), []);

  const submit = useCallback(
    async (text: string): Promise<{ queued: boolean; waitingForTask?: string }> => {
      if (session === null) return { queued: false };
      setBlocked(null);
      // While the session coordinates a Task, the user's message is that Task's supplement and
      // MUST cite its taskId: without it the server treats the message as another topic and
      // retains it until the Task ends. Read the authoritative id right before submitting.
      let taskId: string | null = null;
      try {
        const read = await rpc.call<{ session: { currentTaskId: string | null } }>('session.get', {
          projectId: session.projectId,
          sessionId: session.sessionId,
        });
        taskId = read.session.currentTaskId;
      } catch {
        taskId = null;
      }
      const accepted = await rpc.call<{ inputId: string; waitingForTask?: string }>(
        'session.input.submit',
        {
          projectId: session.projectId,
          sessionId: session.sessionId,
          ...(taskId !== null ? { taskId } : {}),
          content: [{ type: 'text', text }],
        },
        { requestId: newRequestId('c') },
      );
      if (accepted.waitingForTask !== undefined) {
        // Retained by contract: say so instead of leaving the message silently invisible.
        dispatch({ type: 'inputQueued', inputId: accepted.inputId });
        return { queued: true, waitingForTask: accepted.waitingForTask };
      }
      return { queued: false };
    },
    [rpc, session],
  );

  const stop = useCallback(async (): Promise<void> => {
    if (session === null || slot.currentInputId === null) return;
    await rpc.call(
      'session.input.stop',
      { projectId: session.projectId, sessionId: session.sessionId, inputId: slot.currentInputId },
      { requestId: newRequestId('stop') },
    );
  }, [rpc, session, slot.currentInputId]);

  /** Withdraw a retained (queued) input: the message never ran, so stopping it is the honest undo. */
  const cancelQueuedInput = useCallback(
    async (inputId: string): Promise<void> => {
      if (session === null) return;
      await rpc.call(
        'session.input.stop',
        { projectId: session.projectId, sessionId: session.sessionId, inputId },
        { requestId: newRequestId('cancel') },
      );
      dispatch({ type: 'inputRemoved', inputId });
    },
    [rpc, session],
  );

  const respond = useCallback(
    async (interaction: PendingInteraction, response: unknown): Promise<void> => {
      await rpc.call(
        'interaction.respond',
        {
          projectId: session?.projectId,
          interactionId: interaction.interactionId,
          expectedRevision: interaction.revision,
          response,
        },
        { requestId: newRequestId('answer') },
      );
      // Optimistic local flip: the card shows its echo immediately; the invalidate-driven
      // pendingReplaced refresh corrects the region if the server disagrees.
      dispatch({ type: 'interactionResolved', interactionId: interaction.interactionId });
    },
    [rpc, session],
  );

  const refreshTask = useCallback(
    async (taskId: string): Promise<TaskDetail | null> => {
      if (session === null) return null;
      const read = await rpc.call<{
        task: TaskDetail['task'];
        members: TaskDetail['members'];
        results: TaskDetail['results'];
      }>('task.get', { projectId: session.projectId, taskId });
      const detail: TaskDetail = { task: read.task, members: read.members, results: read.results };
      dispatch({ type: 'taskDetail', detail });
      return detail;
    },
    [rpc, session],
  );

  // The server does not push Task member changes, so the strip polls the coordinated Task while
  // one exists (plan D5). A failed poll is ignored on purpose: the next tick retries, and a strip
  // that is one refresh stale is better than a banner for a transient read error.
  // A Task created by the chief's own run publishes no invalidate (creation happens inside the
  // tool), so while the session is working and no Task is known, ask the server whether one now
  // exists. Two seconds is enough for the strip to appear while the chief is still talking.
  const busy = slot.busy !== 'idle';
  useEffect(() => {
    if (projectId === null || sessionId === null || !busy || activeTaskId !== null) return;
    let cancelled = false;
    const read = (): void => {
      void rpc
        .call<{ session: { currentTaskId: string | null } }>('session.get', { projectId, sessionId })
        .then((answer) => {
          if (!cancelled && answer.session.currentTaskId !== null) setActiveTaskId(answer.session.currentTaskId);
        })
        .catch(() => undefined);
    };
    // Read once as soon as the chief starts working (the Task is usually created at the start of a
    // run), then keep asking while the run lasts.
    read();
    const timer = setInterval(read, 2_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [rpc, projectId, sessionId, busy, activeTaskId]);

  const taskStatus = slot.taskDetail?.task.status ?? null;
  useEffect(() => {
    // A finished Task is not polled any more: its strip has nothing left to update, and the
    // interval would keep a timer alive for as long as the tab is open.
    if (activeTaskId === null || taskStatus === 'completed' || taskStatus === 'cancelled') return;
    const read = (): void => {
      void refreshTask(activeTaskId).catch(() => undefined);
    };
    read();
    const timer = setInterval(read, 3_000);
    return () => clearInterval(timer);
  }, [activeTaskId, taskStatus, refreshTask]);

  return {
    rpc,
    slot,
    status,
    historyProblems,
    blocked,
    dismissBlocked: useCallback(() => setBlocked(null), []),
    submit,
    stop,
    cancelQueuedInput,
    respond,
    refreshTask,
    activeTaskId,
    retry,
    notify: toast,
  };
}

export type { SessionSlot, TaskDetail };
