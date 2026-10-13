/**
 * Per-session chat state (the "slot"). Ported model from versot/pi-web `packages/ui-hooks`
 * `session-store.ts` (MIT, © 2026 versot) — reimplemented as a plain reducer; see ported/PORTED.md.
 *
 * The key rule that fixes the live-view bug of the old shell: a snapshot (initial or resync)
 * MERGES into the slot by entry id and never drops a live in-flight entry. The snapshot may lag
 * the stream (the server reads history); the stream tail wins for entries the snapshot cannot
 * describe yet. Switching sessions switches slots: nothing is cleared or reloaded.
 */
import type { PreparedSnapshot, PendingInteraction, StreamFrame } from '../api/stream';

export type ChatRole = 'user' | 'assistant' | 'system' | 'toolResult';

export interface HistoryMessage {
  entryId: string;
  role: ChatRole;
  content: ContentBlock[];
  inputId?: string | null;
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
  streaming?: boolean;
  stopReason?: string | null;
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'toolCall'; id?: string; name?: string; arguments?: string };

export interface TaskMember {
  sessionId: string;
  roleId: string;
  phase: string;
  label: string;
  expectedKind: string;
  currentInputId: string | null;
}

export interface TaskSummaryView {
  taskId: string;
  type: string;
  phase: string;
  status: string;
  revision: number;
}

export interface TaskDetail {
  task: TaskSummaryView;
  members: readonly TaskMember[];
  results: ReadonlyArray<{ resultId: string; kind: string; label?: string }>;
}

export interface SessionSlot {
  items: readonly HistoryMessage[];
  busy: 'idle' | 'queued' | 'processing';
  currentInputId: string | null;
  pending: readonly PendingInteraction[];
  /** Live stream state that must survive snapshot merges. */
  liveKeys: ReadonlySet<string>;
  /** member session ids → their latest member state (from task polling) */
  taskDetail: TaskDetail | null;
}

export const emptySlot = (): SessionSlot => ({
  items: [],
  busy: 'idle',
  currentInputId: null,
  pending: [],
  liveKeys: new Set<string>(),
  taskDetail: null,
});

export type SlotAction =
  | { type: 'snapshot'; snapshot: PreparedSnapshot; reason: 'initial' | 'resync' }
  | { type: 'frame'; frame: StreamFrame }
  | { type: 'taskDetail'; detail: TaskDetail | null }
  | { type: 'reset' };

/** Merge snapshot messages with what the slot already shows: snapshot fills, live tail wins. */
function mergeMessages(current: readonly HistoryMessage[], incoming: readonly HistoryMessage[]): {
  items: readonly HistoryMessage[];
  liveKeys: ReadonlySet<string>;
} {
  const byKey = new Map<string, HistoryMessage>();
  for (const message of current) {
    byKey.set(message.entryId, message);
  }
  for (const message of incoming) {
    const existing = byKey.get(message.entryId);
    // A live in-flight entry (streaming) is never downgraded by a lagging snapshot copy.
    if (existing?.streaming === true && message.streaming !== true) {
      continue;
    }
    byKey.set(message.entryId, { ...message, streaming: message.streaming ?? false });
  }
  const liveKeys = new Set<string>();
  const items: HistoryMessage[] = [];
  for (const message of byKey.values()) {
    if (message.streaming === true) liveKeys.add(message.entryId);
    items.push(message);
  }
  // Keep conversation order stable: server snapshots are chronological; live entries were
  // appended after their snapshot position. Sort by arrival is wrong for tool results (they
  // flip existing cards); a stable order by first appearance is what the old shell relied on.
  return { items, liveKeys };
}

export function slotReducer(state: SessionSlot, action: SlotAction): SessionSlot {
  switch (action.type) {
    case 'reset':
      return emptySlot();
    case 'snapshot': {
      const { snapshot } = action;
      const merged = mergeMessages(state.items, snapshot.messages as HistoryMessage[]);
      return {
        ...state,
        items: merged.items,
        liveKeys: merged.liveKeys,
        busy: snapshot.activity,
        currentInputId: snapshot.currentInputId,
        pending: snapshot.interactions,
      };
    }
    case 'taskDetail':
      return { ...state, taskDetail: action.detail };
    case 'frame': {
      const { frame } = action;
      if (frame.type !== 'pi' || frame.event === undefined) {
        if (frame.type === 'invalidate') {
          // Business notices re-read through RPC elsewhere; nothing to change in the tail.
          return state;
        }
        return state;
      }
      const event = frame.event;
      switch (event.type) {
        case 'message_start': {
          const message = (event.message ?? {}) as { role?: string; content?: ContentBlock[] };
          if (message.role !== 'assistant') return state;
          const entryId = `live-${frame.seq ?? Date.now()}`;
          if (state.liveKeys.has(entryId)) return state;
          return {
            ...state,
            busy: 'processing',
            items: [
              ...state.items,
              { entryId, role: 'assistant', content: message.content ?? [], streaming: true, inputId: frame.inputId ?? null },
            ],
            liveKeys: new Set([...state.liveKeys, entryId]),
          };
        }
        case 'message_update': {
          const delta = event.assistantMessageEvent as
            | { type?: string; delta?: string; contentIndex?: number }
            | undefined;
          if (delta === undefined) return state;
          const items = [...state.items];
          for (let index = items.length - 1; index >= 0; index -= 1) {
            const entry = items[index];
            if (entry === undefined || entry.streaming !== true) continue;
            const content = [...entry.content];
            const blockIndex = delta.contentIndex ?? Math.max(content.length - 1, 0);
            while (content.length <= blockIndex) content.push({ type: 'text', text: '' });
            const block = { ...content[blockIndex] } as ContentBlock & Record<string, unknown>;
            switch (delta.type) {
              case 'text_delta':
                block.type = 'text';
                (block as { text: string }).text = ((block as { text?: string }).text ?? '') + (delta.delta ?? '');
                break;
              case 'thinking_delta':
                block.type = 'thinking';
                (block as { thinking: string }).thinking =
                  ((block as { thinking?: string }).thinking ?? '') + (delta.delta ?? '');
                break;
              case 'toolcall_delta':
                block.type = 'toolCall';
                (block as { arguments?: string }).arguments =
                  ((block as { arguments?: string }).arguments ?? '') + (delta.delta ?? '');
                break;
              default:
                return state;
            }
            content[blockIndex] = block as ContentBlock;
            items[index] = { ...entry, content };
            return { ...state, items };
          }
          return state;
        }
        case 'message_end': {
          const message = event.message as
            | { id?: string; role?: ChatRole; content?: ContentBlock[]; toolCallId?: string; toolName?: string; isError?: boolean; stopReason?: string }
            | undefined;
          if (message === undefined) return state;
          const items = [...state.items];
          const liveIndex = items.findIndex((entry) => entry.streaming === true);
          const completed: HistoryMessage = {
            entryId: message.id ?? items[liveIndex]?.entryId ?? `live-${frame.seq}`,
            role: message.role ?? 'assistant',
            content: message.content ?? [],
            inputId: frame.inputId ?? null,
            streaming: false,
            stopReason: message.stopReason ?? null,
            ...(message.toolCallId !== undefined ? { toolCallId: message.toolCallId } : {}),
            ...(message.toolName !== undefined ? { toolName: message.toolName } : {}),
            ...(message.isError !== undefined ? { isError: message.isError } : {}),
          };
          if (liveIndex >= 0) {
            const liveKey = items[liveIndex]?.entryId;
            items[liveIndex] = completed;
            const liveKeys = new Set(state.liveKeys);
            if (liveKey !== undefined) liveKeys.delete(liveKey);
            return { ...state, items, liveKeys };
          }
          if (message.role === 'user' || message.role === 'toolResult') {
            items.push(completed);
            return { ...state, items };
          }
          return state;
        }
        case 'agent_start':
          return { ...state, busy: 'processing' };
        case 'agent_settled':
        case 'agent_end':
          return { ...state, busy: 'idle' };
        default:
          return state;
      }
    }
  }
}
