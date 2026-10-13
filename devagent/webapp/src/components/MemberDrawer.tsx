import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { SessionStream, type PreparedSnapshot, type StreamFrame } from '../api/stream';
import { emptySlot, slotReducer, type HistoryMessage } from '../state/slot';
import { Transcript } from './Transcript';
import { RpcClient } from '../api/rpc';

interface Props {
  rpc: RpcClient;
  projectId: string;
  sessionId: string;
  label: string;
  onClose: () => void;
}

/**
 * A read-only drawer following one professional (sub)session: history + live stream in its own
 * slot (switching slots never clears content — see state/slot.ts). Contract M4: only the user's
 * explicit "view" subscribes; the chief channel is not widened.
 */
export function MemberDrawer({ rpc, projectId, sessionId, label, onClose }: Props) {
  const [slot, dispatch] = useReducer(slotReducer, undefined, emptySlot);
  const [status, setStatus] = useState<'connecting' | 'connected' | 'reconnecting'>('connecting');
  const containerRef = useRef<HTMLDivElement | null>(null);
  const followRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    const onFrame = (frame: StreamFrame): void => { dispatch({ type: 'frame', frame }); };
    const onSnapshot = (snapshot: PreparedSnapshot): void => {
      setStatus('connected');
      dispatch({ type: 'snapshot', snapshot, reason: 'resync' });
    };
    const stream = new SessionStream(rpc, projectId, sessionId, {
      onFrame,
      onSnapshot,
      onError: () => setStatus('reconnecting'),
    });
    void stream.start().catch(() => setStatus('reconnecting'));
    return () => { stream.stop(); };
  }, [rpc, projectId, sessionId]);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    // The container's own box never resizes; observe the content child so streaming growth
    // (scrollHeight change) actually triggers the follow.
    const observer = new ResizeObserver(() => {
      if (container.scrollHeight - container.scrollTop - container.clientHeight < 120) {
        container.scrollTop = container.scrollHeight;
      }
    });
    for (const child of container.children) observer.observe(child);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const messages = useMemo(() => slot.items.filter((entry: HistoryMessage) => entry.role !== 'system'), [slot.items]);
  void followRef;

  return (
    <aside className="member-drawer" data-member-session={sessionId}>
      <header className="drawer-head">
        <span className="drawer-label">{label}</span>
        <span className="drawer-session">{sessionId}</span>
        <span className={`drawer-status drawer-${status}`}>{status}</span>
        <button type="button" className="drawer-close" onClick={onClose}>×</button>
      </header>
      <div className="drawer-body" ref={containerRef}>
        <Transcript items={messages} />
      </div>
      <footer className="drawer-foot">只读跟随 · 输入请回主管会话</footer>
    </aside>
  );
}
