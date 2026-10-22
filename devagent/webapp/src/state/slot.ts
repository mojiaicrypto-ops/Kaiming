/**
 * Per-session chat state (the "slot"). Ported model from versot/pi-web `packages/ui-hooks`
 * `session-store.ts` (MIT, © 2026 versot) — reimplemented as a plain reducer; see ported/PORTED.md.
 *
 * The key rule that fixes the live-view bug of the old shell: a snapshot (initial or resync)
 * MERGES into the slot by entry id and never drops a live in-flight entry. The snapshot may lag
 * the stream (the server reads history); the stream tail wins for entries the snapshot cannot
 * describe yet. Switching sessions switches slots: nothing is cleared or reloaded.
 *
 * Normalization: EVERY incoming message (snapshot file shape, message_start/end event shapes,
 * delta accumulation) passes through state/normalize.ts exactly once at the boundary below —
 * the reducer's internals and the renderer only ever see normalized blocks.
 */
import type { PreparedSnapshot, SessionActivity, PendingInteraction, StreamFrame } from '../api/stream';
import { normalizeMessage, normalizePiMessage } from './normalize';

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
  /** Live session state (R2-derived): the member is working right now or not. */
  activity?: SessionActivity;
  liveInputId?: string | null;
  queuedInputs?: number;
  /** How the member's assignment ended (its latest delegation/continuation input). */
  lastInputStatus?: 'completed' | 'failed' | 'stopped' | 'interrupted' | null;
}

export interface TaskSummaryView {
  taskId: string;
  type: string;
  phase: string;
  status: string;
  revision: number;
  goal: string;
  scope: string;
  nextStep: string | null;
}

export interface TaskDetail {
  task: TaskSummaryView;
  members: readonly TaskMember[];
  results: ReadonlyArray<{
    resultId: string;
    kind: string;
    label?: string;
    summary?: string;
    verdict?: string | null;
  }>;
}

export interface SessionSlot {
  items: readonly HistoryMessage[];
  busy: SessionActivity;
  /** Whether the server said older messages exist beyond the snapshot. */
  hasEarlier: boolean;
  currentInputId: string | null;
  pending: readonly PendingInteraction[];
  /** Live stream state that must survive snapshot merges. */
  liveKeys: ReadonlySet<string>;
  /** member session ids → their latest member state (from task polling) */
  taskDetail: TaskDetail | null;
  /** Inputs waiting in this session's queue (submitted while a Task owns the session):
   *  they are real user messages, so the UI must show them instead of swallowing them. */
  queuedInputs: readonly { inputId: string; status: string }[];
}

export const emptySlot = (): SessionSlot => ({
  items: [],
  busy: 'idle',
  hasEarlier: false,
  currentInputId: null,
  pending: [],
  liveKeys: new Set<string>(),
  taskDetail: null,
  queuedInputs: [],
});

export type SlotAction =
  | { type: 'snapshot'; snapshot: PreparedSnapshot; reason: 'initial' | 'resync' }
  | { type: 'frame'; frame: StreamFrame }
  | { type: 'inputAccepted'; inputId: string }
  | { type: 'interactionResolved'; interactionId: string }
  | { type: 'pendingReplaced'; pending: readonly PendingInteraction[] }
  | { type: 'taskDetail'; detail: TaskDetail | null }
  | { type: 'inputQueued'; inputId: string }
  | { type: 'inputRemoved'; inputId: string }
  /** Older history, fetched on demand: inserted before what is already shown, never re-sorted. */
  | { type: 'older'; messages: readonly unknown[] }
  | { type: 'reset' };

/**
 * Content fingerprint for the live-twin dedupe (mergeMessages step 2). Reads every block type
 * (text/thinking/toolCall) — thinking-first assistant messages previously all signed the same,
 * which both failed to dedupe the live twin and over-deduped distinct messages.
 *
 * The stale-twin case is asymmetric: a leftover live-only entry holds the SAME or OLDER
 * (streaming-cut) content than the snapshot's completed entry. `matchesTwin` therefore also
 * accepts a strict prefix, so the partial "second copy with half the text" is dropped in
 * favor of the file's complete version.
 */
function signatureOf(message: HistoryMessage): string {
  const parts = message.content.map((block) => {
    if (block.type === 'text') return `t:${block.text}`;
    if (block.type === 'thinking') return `k:${block.thinking}`;
    return `c:${block.id ?? ''}:${block.arguments ?? ''}`;
  });
  return `${message.role}|${message.toolCallId ?? ''}|${parts.join('\u0001')}`;
}

/** A live-only completed message whose content is a prefix of a snapshot entry's content
 *  (same role, same block kinds in order) is that entry's stale twin. */
function matchesTwin(partial: HistoryMessage, complete: HistoryMessage): boolean {
  if (partial.role !== complete.role || partial.content.length > complete.content.length) return false;
  if (partial.toolCallId !== complete.toolCallId) return false;
  for (let index = 0; index < partial.content.length; index += 1) {
    const a = partial.content[index];
    const b = complete.content[index];
    if (a === undefined || b === undefined || a.type !== b.type) return false;
    if (a.type === 'text' && b.type === 'text' && !b.text.startsWith(a.text)) return false;
    if (a.type === 'thinking' && b.type === 'thinking' && !b.thinking.startsWith(a.thinking)) return false;
    if (a.type === 'toolCall' && b.type === 'toolCall') {
      // Argument streams: a partial call has truncated or empty arguments; ids must match.
      if ((a.id ?? '') !== (b.id ?? '')) return false;
      if (a.arguments !== undefined && a.arguments !== '' && !(b.arguments ?? '').startsWith(a.arguments)) return false;
    }
  }
  return true;
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
  //    in their existing tail order. A completed live-only entry that equals OR is a content
  //    prefix of a snapshot entry (the stale twin: the stream joined mid-turn, so the
  //    transient live-* key holds a partial copy) is dropped — otherwise it duplicates the
  //    bubble, the partial copy showing "half the text".
  const incomingSignatures = new Set(
    incoming.map((message) => signatureOf(normalizeMessage(message))),
  );
  for (const message of current) {
    if (incomingKeys.has(message.entryId)) continue;
    if (message.streaming !== true && incomingSignatures.has(signatureOf(message))) continue;
    // A streaming live-only entry whose content equals or prefixes a snapshot entry is the
    // stale twin of a turn whose end frame was lost in the resync: the snapshot read history
    // AFTER the run completed, so the file's copy wins and the live key must not linger
    // (otherwise the transcript "breaks mid-render" with a half-content ghost node).
    if (incoming.some((candidate) => matchesTwin(message, candidate))) continue;
    items.push(message);
    if (message.streaming === true) liveKeys.add(message.entryId);
  }
  return { items, liveKeys };
}

export function slotReducer(state: SessionSlot, action: SlotAction): SessionSlot {
  switch (action.type) {
    case 'reset':
      return emptySlot();
    case 'older': {
      // Backwards paging keeps its own order: the page is older than everything on screen, so it
      // goes in front verbatim. Anything already present (a race with a resync) is skipped.
      const known = new Set(state.items.map((item) => item.entryId));
      const older = (action.messages as unknown[])
        .map((message) =>
          normalizePiMessage(message as { role?: string; content?: unknown }, {
            entryId: typeof (message as { entryId?: unknown }).entryId === 'string' ? (message as { entryId: string }).entryId : '',
            streaming: false,
            inputId: (message as { inputId?: string | null }).inputId ?? null,
            toolCallId: (message as { toolCallId?: unknown }).toolCallId as string | undefined,
            toolName: (message as { toolName?: unknown }).toolName as string | undefined,
            ...(typeof (message as { isError?: unknown }).isError === 'boolean'
              ? { isError: (message as { isError: boolean }).isError }
              : {}),
          }),
        )
        .filter((message) => message.entryId !== '' && !known.has(message.entryId));
      return { ...state, items: [...older, ...state.items] };
    }
    case 'snapshot': {
      const { snapshot } = action;
      // The snapshot's messages come from the history file (Pi shapes); the boundary
      // normalizes them exactly like every other channel before the merge sees them.
      // Each record's own entryId (the server projects record.id) is preserved.
      const merged = mergeMessages(
        state.items,
        (snapshot.messages as unknown[]).map((message) =>
          normalizePiMessage(message as { role?: string; content?: unknown }, {
            entryId: typeof (message as { entryId?: unknown }).entryId === 'string' ? (message as { entryId: string }).entryId : '',
            streaming: false,
            inputId: (message as { inputId?: string | null }).inputId ?? null,
            toolCallId: (message as { toolCallId?: string }).toolCallId,
            toolName: (message as { toolName?: string }).toolName,
            isError: (message as { isError?: boolean }).isError,
          }),
        ),
      );
      return {
        ...state,
        items: merged.items,
        liveKeys: merged.liveKeys,
        busy: snapshot.activity,
        hasEarlier: snapshot.hasEarlier === true,
        currentInputId: snapshot.currentInputId,
        pending: snapshot.interactions,
        // Retained inputs live in the snapshot: a reload must still show what is waiting.
        queuedInputs: snapshot.inputs
          .filter((input) => input.status === 'queued')
          .map((input) => ({ inputId: input.inputId, status: input.status })),
      };
    }
    case 'taskDetail':
      return { ...state, taskDetail: action.detail };
    case 'inputQueued':
      return state.queuedInputs.some((entry) => entry.inputId === action.inputId)
        ? state
        : { ...state, queuedInputs: [...state.queuedInputs, { inputId: action.inputId, status: 'queued' }] };
    case 'inputRemoved':
      return { ...state, queuedInputs: state.queuedInputs.filter((entry) => entry.inputId !== action.inputId) };
    case 'inputAccepted':
      // The submit receipt: mark the accepted input as current and the session as queued, so
      // STOP targets the right input before any Pi event arrives.
      return { ...state, currentInputId: action.inputId, busy: state.busy === 'idle' ? 'queued' : state.busy };
    case 'interactionResolved':
      // Keep the card visible so its echo shows; the authoritative pendingReplaced (which
      // no longer contains it) removes it from the region.
      return { ...state, pending: state.pending.map((entry) => entry.interactionId === action.interactionId ? { ...entry, resolved: true } : entry) };
    case 'pendingReplaced':
      // The server's pending list is authoritative (also covers creations); keep slot state.
      return { ...state, pending: action.pending };
    case 'frame': {
      const { frame } = action;
      if (frame.type !== 'pi' || frame.event === undefined) {
        return state;
      }
      const event = frame.event;
      switch (event.type) {
        case 'message_start': {
          const message = (event.message ?? {}) as { role?: string; content?: unknown };
          if (message.role !== 'assistant') return state;
          const entryId = `live-${frame.seq ?? Date.now()}`;
          if (state.liveKeys.has(entryId)) return state;
          return {
            ...state,
            busy: 'processing',
            items: [
              ...state.items,
              normalizePiMessage(message, { entryId, streaming: true, inputId: frame.inputId ?? null }),
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
            | { id?: string; role?: string; content?: unknown; toolCallId?: string; toolName?: string; isError?: boolean; stopReason?: string }
            | undefined;
          if (message === undefined) return state;
          const items = [...state.items];
          const liveIndex = items.findIndex((entry) => entry.streaming === true);
          const liveKey = items[liveIndex]?.entryId;
          const completed = normalizePiMessage(message, {
            entryId: message.id ?? liveKey ?? `live-${frame.seq}`,
            streaming: false,
            inputId: frame.inputId ?? null,
            toolCallId: message.toolCallId,
            toolName: message.toolName,
            isError: message.isError,
            stopReason: message.stopReason ?? null,
          });
          if (liveIndex >= 0) {
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
