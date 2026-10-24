import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { RpcClient, RpcError, newRequestId } from '../api/rpc';
import { SessionStream, type PreparedSnapshot, type StreamFrame, type PendingInteraction } from '../api/stream';
import { emptySlot, slotReducer, type SessionSlot, type TaskDetail } from '../state/slot';
import { toast } from '../lib/toast';

export interface SessionRef {
  readonly projectId: string;
  readonly sessionId: string;
}

/**
 * 'idle' is the truth before a connection exists: no session is open, so nothing is being followed.
 * Calling that "connecting" told the user something was in progress while the workbench was only
 * waiting for a project to be opened.
 */
export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'offline';

/** The live surface a screen consumes; declared here so screens import a name, not a helper type. */
export interface ChiefSessionApi {
  readonly rpc: RpcClient;
  readonly slot: SessionSlot;
  readonly status: ConnectionStatus;
  readonly historyProblems: readonly string[];
  readonly blocked: { readonly code: string; readonly detail: string } | null;
  readonly dismissBlocked: () => void;
  readonly submit: (text: string, images?: readonly string[]) => Promise<{ queued: boolean; waitingForTask?: string }>;
  /** Store one image immediately; the message then carries only its id (U6). */
  readonly upload: (file: File) => Promise<{ id: string; url: string }>;
  readonly stop: () => Promise<void>;
  readonly cancelQueuedInput: (inputId: string) => Promise<void>;
  readonly respond: (interaction: PendingInteraction, response: unknown) => Promise<void>;
  readonly refreshTask: (taskId: string) => Promise<TaskDetail | null>;
  /**
   * Fetch the page of history older than one entry and put it in front of what is shown.
   * Returns whether anything older still exists.
   */
  readonly loadEarlier: (beforeEntryId: string) => Promise<boolean>;
  /** The model the running (or last) input was claimed with, or null when nothing has run. */
  readonly config: { providerId: string; modelId: string; source: string } | null;
  readonly activeTaskId: string | null;
  readonly retry: () => void;
  readonly notify: (text: string, kind?: 'info' | 'success' | 'error') => void;
}

/**
 * One chief session's live state, driven by the shell's single RPC client: the cookie, the CSRF
 * token and the 401 handling live in exactly one place, so a screen can never hold a stale copy.
 */
export function useSession(
  session: SessionRef | null,
  enabled: boolean,
  rpc: RpcClient,
  onUnauthorized: () => void,
  /** Called when the server says the project's session list changed (a dispatch created members). */
  onSessionsChanged?: () => void,
): ChiefSessionApi {
  const [slot, dispatch] = useReducer(slotReducer, undefined, emptySlot);
  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [historyProblems, setHistoryProblems] = useState<readonly string[]>([]);
  const streamRef = useRef<SessionStream | null>(null);
  /** Which session the stream callbacks belong to; bumped whenever the shell opens or closes one. */
  const generation = useRef(0);
  const [blocked, setBlocked] = useState<{ code: string; detail: string } | null>(null);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  /** When the last pushed Task change arrived: the fallback poll skips a tick right after it. */
  const lastPushAt = useRef(0);
  /**
   * The configuration the work really used. The snapshot carries it while a run is live; after a
   * run the settings may already have changed, so the value is re-read when the session goes idle
   * instead of being inferred from the current settings.
   */
  const [config, setConfig] = useState<{ providerId: string; modelId: string; source: string } | null>(null);
  /** Bumped by a retry button: restarts the effect even when the session did not change. */
  const [retryTick, setRetryTick] = useState(0);
  /**
   * Callbacks the stream effect reaches for. They change with the loaded session, so putting them
   * in the effect's dependencies would restart the stream on every render - a hot loop, not a
   * re-subscribe. The ref is updated during render, so the effect always calls the current one.
   */
  const handlers = useRef<{
    refreshTask: (taskId: string) => Promise<TaskDetail | null>;
    onSessionsChanged?: () => void;
  }>({
    refreshTask: async () => null,
    ...(onSessionsChanged === undefined ? {} : { onSessionsChanged }),
  });

  // Keyed by the ids, not by the object: this callback is an effect dependency, and an
  // identity that changes with the caller's inline literal would restart the stream forever.
  const projectId = session?.projectId ?? null;
  const sessionId = session?.sessionId ?? null;
  const refreshTask = useCallback(
    async (taskId: string): Promise<TaskDetail | null> => {
      if (session === null) return null;
      const read = await rpc.call<{
        task: TaskDetail['task'];
        members: TaskDetail['members'];
        results: TaskDetail['results'];
      }>('task.get', { projectId: session.projectId, taskId }).catch(() => null);
      if (read === null) {
        // An unreadable Task is not "this session has no Task": keeping the last real detail beats
        // blanking the strip and the cards that read their member rows from it.
        return null;
      }
      // Belt as well as braces: a refresh is itself the authority on which Task this session runs.
      setActiveTaskId(taskId);
      const detail: TaskDetail = { task: read.task, members: read.members, results: read.results };
      dispatch({ type: 'taskDetail', detail });
      return detail;
    },
    [rpc, session],
  );

  const loadEarlier = useCallback(
    async (beforeEntryId: string): Promise<boolean> => {
      if (session === null) return false;
      const read = await rpc.call<{ messages: readonly unknown[]; previousCursor: string | null }>(
        'session.messages.list',
        { projectId: session.projectId, sessionId: session.sessionId, before: beforeEntryId, limit: 100 },
      );
      dispatch({ type: 'older', messages: read.messages });
      return read.previousCursor !== null;
    },
    [rpc, session],
  );

  const refreshPending = useCallback(async (): Promise<void> => {
    if (projectId === null || sessionId === null) return;
    const read = await rpc.call<{ snapshot: { interactions: PendingInteraction[] } }>('session.stream.prepare', {
      projectId,
      sessionId,
    });
    dispatch({ type: 'pendingReplaced', pending: read.snapshot.interactions });
  }, [rpc, projectId, sessionId]);

  useEffect(() => {
    if (session === null || !enabled) {
      // Nothing is open: that is the truth, not a connection that dropped. A failure belongs to the
      // session it happened to, so leaving one clears the word instead of carrying it into the void.
      setStatus('idle');
      // A prepare that was in flight when the last session went away must not report its 404 as
      // this (empty) shell's connection state.
      generation.current += 1;
      return;
    }
    const generationHere = (generation.current += 1);
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
        // The server announces every change to the Task (created, updated, dispatched), so the
        // strip updates on the event itself; the interval is only a fallback for a lost frame.
        // Not every announcement is a Task change: a member publishing its report names the chief
        // session as the target, and reading that id as a taskId would blank the card.
        setActiveTaskId(notice.id);
        lastPushAt.current = Date.now();
        void handlers.current.refreshTask(notice.id).catch(() => undefined);
      }
      if (frame.type === 'invalidate' && notice.entity === 'session') {
        handlers.current.onSessionsChanged?.();
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
      setConfig(snapshot.config ?? null);
      // The snapshot is the authority on "is something blocking this session": an event that
      // arrived before this tab subscribed would otherwise be lost forever.
      setBlocked(snapshot.blocked ?? null);
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
          if (read.session.currentTaskId === null) return;
          setActiveTaskId(read.session.currentTaskId);
          // A reload must show the Task straight away, not after the first 3s poll: the strip is
          // how the user sees what is running.
          void handlers.current.refreshTask(read.session.currentTaskId).catch(() => undefined);
        })
        .catch(() => undefined);
    };
    // Every state write from here on belongs to this session: a late answer from the previous one
    // (a prepare that 404s after the session was dropped) must not repaint the chip.
    const alive = (): boolean => generation.current === generationHere;
    const stream = new SessionStream(rpc, session.projectId, session.sessionId, {
      onFrame,
      onSnapshot,
      onError: () => {
        if (alive()) setStatus('reconnecting');
      },
    });
    streamRef.current = stream;
    setStatus('connecting');
    void stream.start().catch((error: unknown) => {
      if (!alive()) return;
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
    async (text: string, images: readonly string[] = []): Promise<{ queued: boolean; waitingForTask?: string }> => {
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
          content: [
            ...(text !== '' ? [{ type: 'text', text }] : []),
            ...images.map((attachmentId) => ({ type: 'image', attachmentId })),
          ],
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


  // The server does not push Task member changes, so the strip polls the coordinated Task while
  // one exists (plan D5). A failed poll is ignored on purpose: the next tick retries, and a strip
  // that is one refresh stale is better than a banner for a transient read error.
  /**
   * An input is queued and nothing is running: either the user's message waits behind a Task, or a
   * run cannot start (a missing model, a role that is not configured). The server knows which; the
   * client asks, because the event that said so may have been published before this tab subscribed.
   * Polling stops as soon as the state changes — it is not a heartbeat.
   */
  useEffect(() => {
    if (slot.busy !== 'queued' || projectId === null || sessionId === null) return;
    let cancelled = false;
    const ask = (): void => {
      if (document.visibilityState !== 'visible') return;
      void rpc
        .call<{ session: { blocked: { code: string; detail: string } | null; config: { providerId: string; modelId: string; source: string } | null } }>(
          'session.get',
          { projectId, sessionId },
        )
        .then((read) => {
          if (cancelled) return;
          setBlocked(read.session.blocked);
          if (read.session.config !== null) setConfig(read.session.config);
        })
        .catch(() => undefined);
    };
    ask();
    const timer = window.setInterval(ask, 1_500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [slot.busy, projectId, sessionId, rpc]);

  // A run ended: read what it actually used, once, instead of polling for a value that changes
  // at most once per run.
  const wasBusy = useRef(false);
  useEffect(() => {
    const busyNow = slot.busy !== 'idle';
    if (wasBusy.current && !busyNow && projectId !== null && sessionId !== null) {
      void rpc
        .call<{
          session: {
            config: { providerId: string; modelId: string; source: string } | null;
            blocked: { code: string; detail: string } | null;
          };
        }>('session.get', {
          projectId,
          sessionId,
        })
        .then((read) => {
          setConfig(read.session.config);
          // The run ended without starting, or it failed: the same read says which.
          setBlocked(read.session.blocked);
        })
        .catch(() => undefined);
    }
    wasBusy.current = busyNow;
  }, [slot.busy, projectId, sessionId, rpc]);

  handlers.current = {
    refreshTask,
    ...(onSessionsChanged === undefined ? {} : { onSessionsChanged }),
  };

  const taskStatus = slot.taskDetail?.task.status ?? null;
  useEffect(() => {
    // A finished Task is not polled any more: its strip has nothing left to update, and the
    // interval would keep a timer alive for as long as the tab is open.
    if (activeTaskId === null || taskStatus === 'completed' || taskStatus === 'cancelled') return;
    let timer: number | null = null;
    const read = (): void => {
      // A push already answered this question within the last second; a second read would only
      // duplicate the work the event just did.
      if (Date.now() - lastPushAt.current < 1_000) return;
      void refreshTask(activeTaskId).catch(() => undefined);
    };
    const visible = (): boolean => document.visibilityState === 'visible';
    const start = (): void => {
      if (timer !== null || !visible()) return;
      read();
      timer = window.setInterval(read, 3_000);
    };
    const stop = (): void => {
      if (timer === null) return;
      window.clearInterval(timer);
      timer = null;
    };
    // A hidden tab asks the server nothing: the user cannot see the answer, and a laptop that
    // sleeps for an hour should not wake up to an hour of queued polls.
    const onVisibility = (): void => (visible() ? start() : stop());
    document.addEventListener('visibilitychange', onVisibility);
    start();
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      stop();
    };
  }, [activeTaskId, taskStatus, refreshTask]);

  return {
    rpc,
    slot,
    status,
    historyProblems,
    blocked,
    dismissBlocked: useCallback(() => setBlocked(null), []),
    submit,
    upload: useCallback((file: File) => rpc.upload(file), [rpc]),
    stop,
    cancelQueuedInput,
    respond,
    refreshTask,
    loadEarlier,
    config,
    activeTaskId,
    retry,
    notify: toast,
  };
}

export type { SessionSlot, TaskDetail };
