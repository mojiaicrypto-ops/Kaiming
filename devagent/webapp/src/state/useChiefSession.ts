import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { RpcClient, RpcError, newRequestId } from '../api/rpc';
import { SessionStream, type PreparedSnapshot, type StreamFrame, type PendingInteraction } from '../api/stream';
import { emptySlot, slotReducer, type SessionSlot, type TaskDetail } from '../state/slot';
import { toast } from '../lib/toast';

export interface ChiefSession {
  projectId: string;
  sessionId: string;
  roleId: string;
}

type Status = 'connecting' | 'connected' | 'reconnecting' | 'offline';

export function useChiefSession(session: ChiefSession | null, enabled: boolean) {
  const rpc = useMemo(() => new RpcClient({ onUnauthorized: () => setNeedLogin(true) }), []);
  const [slot, dispatch] = useReducer(slotReducer, undefined, emptySlot);
  const [status, setStatus] = useState<Status>('connecting');
  const [needLogin, setNeedLogin] = useState(false);
  const [historyProblems, setHistoryProblems] = useState<readonly string[]>([]);
  const streamRef = useRef<SessionStream | null>(null);
  const [blocked, setBlocked] = useState<{ code: string; detail: string } | null>(null);
  /** The Task bound to this chief session (if any); refreshed on task invalidations. */
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [taskTick, setTaskTick] = useState(0);

  const refreshPending = useCallback(async (): Promise<void> => {
    if (session === null) return;
    const read = await rpc.call<{ snapshot: { interactions: PendingInteraction[] } }>('session.stream.prepare', {
      projectId: session.projectId,
      sessionId: session.sessionId,
    });
    dispatch({ type: 'pendingReplaced', pending: read.snapshot.interactions });
  }, [rpc, session]);

  useEffect(() => {
    if (session === null || !enabled) return;
    dispatch({ type: 'reset' });
    const onFrame = (frame: StreamFrame): void => {
      if (frame.type === 'pi' && frame.event?.type === 'blocked') {
        setBlocked({ code: String(frame.code ?? 'BLOCKED'), detail: String(frame.detail ?? '') });
      }
      // Business notices arrive as top-level frames ({type:'invalidate', entity, id}), not
      // wrapped in event (http.ts publishes the notice object as the frame itself).
      const notice = frame as unknown as { entity?: string; id?: string };
      if (frame.type === 'invalidate' && notice.entity === 'task' && typeof notice.id === 'string') {
        setActiveTaskId(notice.id);
        setTaskTick((tick) => tick + 1);
      }
      if (frame.type === 'invalidate' && notice.entity === 'input' && typeof notice.id === 'string') {
        // The submit's own receipt: this input is now the session's current (queued) input.
        // Without it currentInputId stays null and STOP would no-op on the run just started.
        dispatch({ type: 'inputAccepted', inputId: notice.id });
      }
      if (frame.type === 'invalidate' && notice.entity === 'interaction' && typeof notice.id === 'string') {
        // An interaction changed — created OR resolved. The frame carries no payload, so
        // re-read the pending list (the old shell's refreshInteractions path); dispatching
        // the authoritative list also removes answered cards.
        void refreshPending();
      }
      dispatch({ type: 'frame', frame });
    };
    const onSnapshot = (snapshot: PreparedSnapshot): void => {
      if (snapshot.sessionId !== session?.sessionId) return;
      setStatus('connected');
      setHistoryProblems(snapshot.historyProblems ?? []);
      dispatch({ type: 'snapshot', snapshot, reason: 'resync' });
      // Restore the coordinated Task after (re)connect: the invalidate frames that would set
      // activeTaskId may have fired before this tab subscribed, leaving the Task card absent
      // even though a member is running right now.
      void rpc.call<{ session: { currentTaskId: string | null } }>('session.get', {
        projectId: session.projectId,
        sessionId: session.sessionId,
      }).then((read) => {
        if (read.session.currentTaskId !== null) {
          setActiveTaskId(read.session.currentTaskId);
          setTaskTick((tick) => tick + 1);
        }
      }).catch(() => undefined);
    };
    const stream = new SessionStream(rpc, session.projectId, session.sessionId, {
      onFrame,
      onSnapshot,
      onError: () => setStatus('reconnecting'),
    });
    streamRef.current = stream;
    setStatus('connecting');
    void stream.start().catch((error: unknown) => {
      if (error instanceof RpcError && error.code === 'UNAUTHORIZED') setNeedLogin(true);
      else setStatus('reconnecting');
    });
    return () => {
      stream.stop();
      streamRef.current = null;
    };
  }, [rpc, session?.projectId, session?.sessionId, enabled]);

  const submit = useCallback(async (text: string): Promise<void> => {
    if (session === null) return;
    setBlocked(null);
    // While the session coordinates a Task, the user's message is that Task's supplement and
    // MUST cite its taskId (R2: '当前 Task 的补充须关联原 taskId'). Without it the server
    // treats the message as another topic and retains it until the Task ends — the user's
    // 'input is not accepted any more'. Read the authoritative id right before submitting so
    // a Task created mid-run cannot leave a stale value here.
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
    const accepted = await rpc.call<{ inputId: string; waitingForTask?: string }>('session.input.submit', {
      projectId: session.projectId,
      sessionId: session.sessionId,
      ...(taskId !== null ? { taskId } : {}),
      content: [{ type: 'text', text }],
    }, { requestId: newRequestId('c') });
    if (accepted.waitingForTask !== undefined) {
      // Retained by contract: say so instead of leaving the message silently invisible.
      dispatch({ type: 'inputQueued', inputId: accepted.inputId });
      toast(`这条消息已排队：当前会话正在推进 Task ${accepted.waitingForTask}，其他话题请新建会话，或撤回这条消息。`, 'info');
    }
  }, [rpc, session]);

  const stop = useCallback(async (): Promise<void> => {
    if (session === null || slot.currentInputId === null) return;
    await rpc.call('session.input.stop', {
      projectId: session.projectId,
      sessionId: session.sessionId,
      inputId: slot.currentInputId,
    }, { requestId: newRequestId('stop') });
  }, [rpc, session, slot.currentInputId]);

  /** Withdraw a retained (queued) input: the message never ran, so stopping it is the honest undo. */
  const cancelQueuedInput = useCallback(async (inputId: string): Promise<void> => {
    if (session === null) return;
    await rpc.call('session.input.stop', {
      projectId: session.projectId,
      sessionId: session.sessionId,
      inputId,
    }, { requestId: newRequestId('cancel') });
    dispatch({ type: 'inputRemoved', inputId });
  }, [rpc, session]);

  const respond = useCallback(async (interaction: PendingInteraction, response: unknown): Promise<void> => {
    await rpc.call('interaction.respond', {
      projectId: session?.projectId,
      interactionId: interaction.interactionId,
      expectedRevision: interaction.revision,
      response,
    }, { requestId: newRequestId('answer') });
    // Optimistic local flip: the card shows its echo immediately; the invalidate-driven
    // pendingReplaced refresh corrects the region if the server disagrees.
    dispatch({ type: 'interactionResolved', interactionId: interaction.interactionId });
  }, [rpc, session]);

  const refreshTask = useCallback(async (taskId: string): Promise<TaskDetail | null> => {
    if (session === null) return null;
    const read = await rpc.call<{ task: TaskDetail['task']; members: TaskDetail['members']; results: TaskDetail['results'] }>(
      'task.get', { projectId: session.projectId, taskId },
    );
    const detail: TaskDetail = { task: read.task, members: read.members, results: read.results };
    dispatch({ type: 'taskDetail', detail });
    return detail;
  }, [rpc, session]);

  return { rpc, slot, status, needLogin, setNeedLogin, historyProblems, blocked, submit, stop, cancelQueuedInput, respond, refreshTask, activeTaskId, taskTick };
}
