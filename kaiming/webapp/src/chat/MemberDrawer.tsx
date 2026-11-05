import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { RpcClient } from '../api/rpc';
import { SessionStream, type PreparedSnapshot, type StreamFrame, type PendingInteraction } from '../api/stream';
import { emptySlot, slotReducer } from '../state/slot';
import { Transcript } from '../chat/Transcript';
import { Drawer } from '../app/Drawer';
import { State } from '../app/State';
import { useI18n } from '../i18n/I18nProvider';
import { createAutoscroll } from '../lib/scroll';
import { Elapsed } from './Elapsed';
import type { TaskMember } from '../state/slot';

export interface MemberDrawerProps {
  readonly rpc: RpcClient;
  readonly projectId: string;
  readonly sessionId: string;
  readonly label: string;
  /** The step this member works in and the result kind it owes: what the user is looking at. */
  readonly phaseLabel?: string;
  readonly expectedKind?: string;
  /** The member row's latest execution window, when the Task detail already knows it. */
  readonly member?: TaskMember | undefined;
  readonly onClose: () => void;
}

/**
 * A read-only follow of one specialist session: it owns its own slot, so opening two members (or
 * closing this one) never disturbs the chief transcript (R12). The contract is unchanged — a page
 * only subscribes to a member when the user explicitly asks to look.
 */
export function MemberDrawer({ rpc, projectId, sessionId, label, phaseLabel, expectedKind, member, onClose }: MemberDrawerProps) {
  const { t } = useI18n();
  const [slot, dispatch] = useReducer(slotReducer, undefined, emptySlot);
  const [status, setStatus] = useState<'connecting' | 'connected' | 'reconnecting'>('connecting');
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const scroll = useRef<{ followIfUnlocked: () => void } | null>(null);

  useEffect(() => {
    const onFrame = (frame: StreamFrame): void => dispatch({ type: 'frame', frame });
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
    return () => stream.stop();
  }, [rpc, projectId, sessionId]);

  useEffect(() => {
    const element = bodyRef.current;
    if (element === null || scroll.current !== null) return;
    const handle = createAutoscroll(element, () => undefined);
    scroll.current = { followIfUnlocked: handle.followIfUnlocked.bind(handle) };
  }, []);

  useEffect(() => {
    scroll.current?.followIfUnlocked();
  }, [slot.items]);

  const settle = useCallback((): void => {
    const element = bodyRef.current;
    if (element !== null) element.scrollTop = element.scrollHeight;
  }, []);

  const busy = slot.busy === 'processing' ? <State kind="run">{t('tool.running')}</State> : <State kind="idle">{t('common.none')}</State>;

  return (
    <Drawer
      className="md-drawer"
      eyebrow={
        phaseLabel === undefined && expectedKind === undefined
          ? `${sessionId} · ${t('chat.role.member')}`
          : `${phaseLabel ?? ''}${phaseLabel === undefined || expectedKind === undefined ? '' : ' · '}${expectedKind ?? ''}`
      }
      title={label}
      aside={
        <>
          <Elapsed
            className="f3 mono"
            testId="member-drawer-elapsed"
            startedAt={member?.executionStartedAt}
            endedAt={member?.executionEndedAt}
          />
          {busy}
        </>
      }
      onClose={onClose}
      footer={<span className="f3">{t('chat.member.onlyRead')}</span>}
    >
      <div ref={bodyRef} className="scroll drawer-tx" style={{ height: '100%' }} onLoadCapture={settle}>
        {slot.items.length === 0 ? (
          <span className="f3">{status === 'connected' ? t('chat.member.none') : t('common.loading')}</span>
        ) : (
          <Transcript items={slot.items} busy={slot.busy} variant="agent" />
        )}
      </div>
    </Drawer>
  );
}
