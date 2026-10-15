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
  | { type: 'inputAccepted'; inputId: string }
  | { type: 'interactionResolved'; interactionId: string }
  | { type: 'taskDetail'; detail: TaskDetail | null }
  | { type: 'reset' };

/** Merge snapshot messages with what the slot already shows: snapshot fills, live tail wins. */
function normalizeBlock(block: unknown): ContentBlock {
  if (typeof block !== 'object' || block === null) {
    return { type: 'text', text: String(block ?? '') };
  }
  const record = block as Record<string, unknown>;
  if (record.type === 'toolCall') {
    // Pi history stores arguments as an object; the live stream appends them as a string.
    // Normalize the snapshot shape here so the renderer only ever sees strings.
    const raw = record.arguments;
    const args = typeof raw === 'string' ? raw : raw === undefined ? '' : JSON.stringify(raw);
    return {
      type: 'toolCall',
      ...(typeof record.id === 'string' ? { id: record.id } : {}),
      ...(typeof record.name === 'string' ? { name: record.name } : {}),
      arguments: args,
    };
  }
  if (record.type === 'thinking') {
    return { type: 'thinking', thinking: typeof record.thinking === 'string' ? record.thinking : '' };
  }
  return { type: 'text', text: typeof record.text === 'string' ? record.text : '' };
}

function normalizeMessage(message: HistoryMessage): HistoryMessage {
  return {
    ...message,
    content: Array.isArray(message.content) ? message.content.map(normalizeBlock) : [{ type: 'text', text: String(message.content ?? '') }],
  };
}

function signatureOf(message: HistoryMessage): string {
  const first = message.content[0];
  const text = first !== undefined && 'text' in first ? first.text : first !== undefined && 'arguments' in first ? (first as { arguments?: string }).arguments ?? '' : '';
  return `${message.role}:${(text ?? '').slice(0, 64)}:${message.toolCallId ?? ''}`;
}

function mergeMessages(current: readonly HistoryMessage[], incoming: readonly HistoryMessage[]): {
  items: readonly HistoryMessage[];
  liveKeys: ReadonlySet<string>;
} {
  // Order rule: the snapshot is chronological authority; live-only entries (streaming, echoes
  // appended before a resync) keep their relative tail order after the snapshot's last entry.
  const incomingKeys = new Set(incoming.map((message) => message.entryId));
  const currentByKey = new Map(current.map((message) => [message.entryId, message]));
  const incomingByKey = new Map<string, HistoryMessage>();
  for (const message of incoming) {
    const normalized = normalizeMessage(message);
    const existing = currentByKey.get(normalized.entryId);
    // A live in-flight entry (streaming) is never downgraded by a lagging snapshot copy.
    if (existing?.streaming === true && normalized.streaming !== true) {
      incomingByKey.set(normalized.entryId, existing);
    } else {
      incomingByKey.set(normalized.entryId, { ...normalized, streaming: normalized.streaming ?? false });
    }
  }
  const items: HistoryMessage[] = [];
  const liveKeys = new Set<string>();
  // 1. Snapshot order first: entries the snapshot knows, in the snapshot's own order.
  for (const message of incomingByKey.values()) {
    items.push(message);
    if (message.streaming === true) liveKeys.add(message.entryId);
  }
  // 2. Live-only entries the snapshot does not know yet (its file read lags the stream),
  //    in their existing tail order. A completed live-only entry whose content matches a
  //    snapshot entry (the stream joined between message_start and message_end, so the
  //    transient live-* key exists while the snapshot knows the real one) is dropped —
  //    otherwise it duplicates the bubble forever.
  const incomingSignatures = new Set(
    incoming.map((message) => signatureOf(normalizeMessage(message))),
  );
  for (const message of current) {
    if (incomingKeys.has(message.entryId)) continue;
    if (message.streaming !== true && incomingSignatures.has(signatureOf(message))) continue;
    items.push(message);
    if (message.streaming === true) liveKeys.add(message.entryId);
  }
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
    case 'inputAccepted':
      // The submit receipt: mark the accepted input as current and the session as queued, so
      // STOP targets the right input before any Pi event arrives.
      return { ...state, currentInputId: action.inputId, busy: state.busy === 'idle' ? 'queued' : state.busy };
    case 'interactionResolved':
      return { ...state, pending: state.pending.filter((entry) => entry.interactionId !== action.interactionId) };
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
              { entryId, role: 'assistant', content: normalizeMessage({ entryId, role: 'assistant', content: (message.content ?? []) as ContentBlock[] }).content, streaming: true, inputId: frame.inputId ?? null },
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
            // message_end carries the same Pi shapes as the snapshot (toolCall arguments are
            // objects): normalize here too, or the tool card crashes on a non-string arg.
            content: normalizeMessage({ entryId: '', role: 'assistant', content: (message.content ?? []) as ContentBlock[] }).content,
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
          // No live entry (e.g. the stream joined between message_start and message_end):
          // keep the completed message — dropping it loses a real turn.
          items.push(completed);
          return { ...state, items };
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
