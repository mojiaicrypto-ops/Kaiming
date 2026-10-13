import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { RpcClient, RpcError, newRequestId } from '../api/rpc';
import { SessionStream, type PreparedSnapshot, type StreamFrame, type PendingInteraction } from '../api/stream';
import { emptySlot, slotReducer, type SessionSlot, type TaskDetail } from '../state/slot';

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
      dispatch({ type: 'frame', frame });
    };
    const onSnapshot = (snapshot: PreparedSnapshot): void => {
      setStatus('connected');
      setHistoryProblems(snapshot.historyProblems ?? []);
      dispatch({ type: 'snapshot', snapshot, reason: 'resync' });
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
    await rpc.call('session.input.submit', {
      projectId: session.projectId,
      sessionId: session.sessionId,
      content: [{ type: 'text', text }],
    }, { requestId: newRequestId('c') });
  }, [rpc, session]);

  const stop = useCallback(async (): Promise<void> => {
    if (session === null || slot.currentInputId === null) return;
    await rpc.call('session.input.stop', {
      projectId: session.projectId,
      sessionId: session.sessionId,
      inputId: slot.currentInputId,
    }, { requestId: newRequestId('stop') });
  }, [rpc, session, slot.currentInputId]);

  const respond = useCallback(async (interaction: PendingInteraction, response: unknown): Promise<void> => {
    await rpc.call('interaction.respond', {
      interactionId: interaction.interactionId,
      expectedRevision: interaction.revision,
      response,
    }, { requestId: newRequestId('answer') });
  }, [rpc]);

  const refreshTask = useCallback(async (taskId: string): Promise<TaskDetail | null> => {
    if (session === null) return null;
    const read = await rpc.call<{ task: TaskDetail['task']; members: TaskDetail['members']; results: TaskDetail['results'] }>(
      'task.get', { projectId: session.projectId, taskId },
    );
    const detail: TaskDetail = { task: read.task, members: read.members, results: read.results };
    dispatch({ type: 'taskDetail', detail });
    return detail;
  }, [rpc, session]);

  return { rpc, slot, status, needLogin, setNeedLogin, historyProblems, blocked, submit, stop, respond, refreshTask, activeTaskId, taskTick };
}
