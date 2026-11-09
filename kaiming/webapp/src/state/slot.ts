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
import type { ContextView, PreparedSnapshot, SessionActivity, PendingInteraction, StreamFrame } from '../api/stream';
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
  /** ISO stamp from Pi history or the frame; ordering aid, never shown. */
  timestamp?: string | null;
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'toolCall'; id?: string; name?: string; arguments?: string }
  /** `src` is an attachment URL the server serves; the bytes never travel inside a message. */
  | { type: 'image'; src: string; alt?: string }
  /** An uploaded document; `text` is the extracted body, when the history marker carries it. */
  | { type: 'document'; src: string; name: string; mimeType: string; text?: string; truncated?: boolean };

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
  /** When the latest delegation/continuation was delivered to the member. */
  executionStartedAt?: string | null;
  /** When that input settled; null while it is still running or has not started. */
  executionEndedAt?: string | null;
  /** The input settled without the formal report this member was dispatched for. */
  reportMissing?: boolean;
  errorCode?: string | null;
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
  /** Task creation and last recorded state: the wall-clock execution window. */
  createdAt?: string;
  updatedAt?: string;
  requiresTest?: boolean;
}

export interface TaskDetail {
  task: TaskSummaryView;
  members: readonly TaskMember[];
  results: ReadonlyArray<{
    resultId: string;
    /** The member that delivered it: the row for that member shows this report. */
    sessionId?: string;
    kind: string;
    label?: string;
    summary?: string;
    verdict?: string | null;
  }>;
  /** What the Plan declares and which changed files fall outside it (host-computed). */
  scopeCheck?: {
    declared: readonly string[] | null;
    outOfScope: readonly string[];
  };
}
export interface QueuedInput {
  inputId: string;
  status: string;
  /** The user's own message. Empty is legal (an image-only message). */
  text: string;
  imageCount: number;
  documentCount: number;
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
   *  they are real user messages, so the UI shows their text instead of swallowing them. */
  queuedInputs: readonly QueuedInput[];
  /** How full the model's window is; the snapshot and every `context` notice keep it current. */
  context: ContextView | null;
  /** Pi's summary call is running; the manual action is disabled until it settles. */
  compacting: boolean;
  /**
   * A message this tab submitted that has not reached the history yet. Pi writes the user turn only
   * when the run starts, so between "accepted" and "delivered" neither the stream nor a reload
   * snapshot can show it: the reader typed "continue" and saw nothing. The echo closes that gap and
   * is dropped the moment the real entry arrives.
   */
  pendingEcho: { inputId: string; content: readonly ContentBlock[] } | null;
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
  pendingEcho: null,
  context: null,
  compacting: false,
});

/**
 * Whether the history already carries the message an echo stands for. The entry's own `inputId` is
 * the truth; a live entry for that input (or one still streaming) counts too, because Pi writes the
 * user turn and the assistant reply under the same input.
 */
function echoArrived(
  echo: SessionSlot['pendingEcho'],
  snapshot: PreparedSnapshot,
  items: readonly HistoryMessage[],
): boolean {
  if (echo === null) return false;
  if (snapshot.currentInputId === echo.inputId) return true;
  if (snapshot.inputs.some((input) => input.inputId === echo.inputId && input.status === 'processing')) return true;
  return items.some((item) => item.inputId === echo.inputId);
}

export type SlotAction =
  | { type: 'snapshot'; snapshot: PreparedSnapshot; reason: 'initial' | 'resync' }
  | { type: 'frame'; frame: StreamFrame }
  | { type: 'inputAccepted'; inputId: string; content?: readonly ContentBlock[] }
  /** Adopt the server's activity verbatim (a read, not a guess): used when a queued session turns out to be running. */
  | { type: 'busy'; activity: SessionActivity }
  | { type: 'interactionResolved'; interactionId: string }
  | { type: 'pendingReplaced'; pending: readonly PendingInteraction[] }
  | { type: 'taskDetail'; detail: TaskDetail | null }
  | { type: 'inputQueued'; inputId: string; content?: readonly ContentBlock[] }
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
    if (block.type === 'image') return `i:${block.src}`;
    if (block.type === 'document') return `d:${block.src}`;
    return `c:${block.id ?? ''}:${block.arguments ?? ''}`;
  });
  return `${message.role}|${message.toolCallId ?? ''}|${parts.join('\u0001')}`;
}

/**
 * Whether two entries can describe the SAME turn. The input id is the identity the stream and the
 * snapshot both carry; content is not identity. A new turn that repeats an older reply (or starts
 * with the same words) must not be deduped against it. Two entries without an input id are the
 * legacy history case, where content is the only available signal.
 */
function sameTurn(left: HistoryMessage, right: HistoryMessage): boolean {
  if (left.entryId !== '' && left.entryId === right.entryId && !left.entryId.startsWith('live-')) {
    return true;
  }
  const leftInput = left.inputId ?? null;
  const rightInput = right.inputId ?? null;
  if (leftInput === null && rightInput === null) return true;
  return leftInput !== null && rightInput !== null && leftInput === rightInput;
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
    // An image is either the same attachment or the message is not the same message.
    if (a.type === 'image' && b.type === 'image' && a.src !== b.src) return false;
  }
  return true;
}

function mergeMessages(current: readonly HistoryMessage[], incoming: readonly HistoryMessage[]): {
  items: readonly HistoryMessage[];
  liveKeys: ReadonlySet<string>;
} {
  // Order rule: the snapshot is chronological authority; live-only entries (streaming, echoes
  // appended before a resync) keep their relative tail order after the snapshot's last entry.
  const normalizedIncoming = incoming.map(normalizeMessage);
  const incomingKeys = new Set(normalizedIncoming.map((message) => message.entryId));
  const currentByKey = new Map(current.map((message) => [message.entryId, message]));
  const incomingByKey = new Map<string, HistoryMessage>();
  for (const normalized of normalizedIncoming) {
    const existing = currentByKey.get(normalized.entryId);
    // A live in-flight entry (streaming) is never downgraded by a lagging snapshot copy.
    if (existing?.streaming === true && normalized.streaming !== true) {
      incomingByKey.set(normalized.entryId, existing);
    } else {
      incomingByKey.set(normalized.entryId, { ...normalized, streaming: normalized.streaming ?? false });
    }
  }
  const incomingItems: HistoryMessage[] = [];
  const liveKeys = new Set<string>();
  for (const message of incomingByKey.values()) {
    incomingItems.push(message);
    if (message.streaming === true) liveKeys.add(message.entryId);
  }
  /*
   * Entries the snapshot no longer carries are not all "live tail". A long-lived page can have
   * older history that a newer snapshot's 100-message tail has already cut off; appending that
   * after the new tail made the transcript jump back to old content (the reported "messages
   * disappeared after a reconnect"). Prefer the entry's own timestamp against the snapshot
   * range; fall back to the current array's position against the shared entries. Only entries
   * newer than the snapshot belong after it.
   */
  const sharedPositions = current
    .map((message, index) => (incomingKeys.has(message.entryId) ? index : -1))
    .filter((index) => index >= 0);
  const firstShared = sharedPositions.length === 0 ? -1 : Math.min(...sharedPositions);
  const lastShared = sharedPositions.length === 0 ? -1 : Math.max(...sharedPositions);
  const incomingTimes = incomingItems
    .map((message) => message.timestamp)
    .filter((time): time is string => typeof time === 'string' && time !== '');
  const firstIncomingTime = incomingTimes[0] ?? null;
  const lastIncomingTime = incomingTimes.at(-1) ?? null;
  const earlier: HistoryMessage[] = [];
  const tail: HistoryMessage[] = [];
  for (const [index, message] of current.entries()) {
    if (incomingKeys.has(message.entryId)) continue;
    if (
      message.streaming !== true &&
      normalizedIncoming.some(
        (candidate) => sameTurn(message, candidate) && signatureOf(candidate) === signatureOf(message),
      )
    ) {
      continue;
    }
    // A streaming live-only entry whose content equals or prefixes a snapshot entry is the
    // stale twin of a turn whose end frame was lost in the resync: the snapshot read history
    // AFTER the run completed, so the file's copy wins and the live key must not linger
    // (otherwise the transcript "breaks mid-render" with a half-content ghost node). The same
    // input check keeps a new turn with a matching opening fragment.
    if (normalizedIncoming.some((candidate) => sameTurn(message, candidate) && matchesTwin(message, candidate))) continue;
    const time = message.timestamp;
    const newerThanSnapshot =
      time !== null && time !== undefined && firstIncomingTime !== null && time < firstIncomingTime
        ? false
        : time !== null && time !== undefined && lastIncomingTime !== null && time > lastIncomingTime
          ? true
          : firstShared < 0
            ? false
            : index > lastShared;
    if (newerThanSnapshot) tail.push(message);
    else earlier.push(message);
    if (message.streaming === true) liveKeys.add(message.entryId);
  }
  return { items: [...earlier, ...incomingItems, ...tail], liveKeys };
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
            timestamp: typeof (message as { timestamp?: unknown }).timestamp === 'string' ? (message as { timestamp: string }).timestamp : null,
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
            timestamp: typeof (message as { timestamp?: unknown }).timestamp === 'string' ? (message as { timestamp: string }).timestamp : null,
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
        // The real entry now exists (its own id or a live one for the same input): the echo is done.
        pendingEcho: echoArrived(state.pendingEcho, snapshot, merged.items) ? null : state.pendingEcho,
        busy: snapshot.activity,
        hasEarlier: snapshot.hasEarlier === true,
        currentInputId: snapshot.currentInputId,
        pending: snapshot.interactions,
        // Retained inputs live in the snapshot: a reload must still show what is waiting.
        queuedInputs: snapshot.inputs
          .filter((input) => input.status === 'queued' && input.kind === 'user')
          .map((input) => ({
            inputId: input.inputId,
            status: input.status,
            text: input.text ?? '',
            imageCount: input.imageCount ?? 0,
            documentCount: input.documentCount ?? 0,
          })),
        // The boundary copy is authoritative on connect: a missed notice cannot leave a stale meter.
        context: snapshot.context ?? null,
        compacting: snapshot.compacting === true,
      };
    }
    case 'taskDetail':
      return { ...state, taskDetail: action.detail };
    case 'inputQueued': {
      const existing = state.queuedInputs.find((entry) => entry.inputId === action.inputId);
      const text = action.content === undefined
        ? existing?.text ?? ''
        : action.content
            .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
            .map((block) => block.text)
            .join('\n');
      const imageCount = action.content === undefined
        ? existing?.imageCount ?? 0
        : action.content.filter((block) => block.type === 'image').length;
      const documentCount = action.content === undefined
        ? existing?.documentCount ?? 0
        : action.content.filter((block) => block.type === 'document').length;
      const entry = { inputId: action.inputId, status: 'queued', text, imageCount, documentCount };
      return existing === undefined
        ? { ...state, queuedInputs: [...state.queuedInputs, entry] }
        : { ...state, queuedInputs: state.queuedInputs.map((item) => item.inputId === action.inputId ? entry : item) };
    }
    case 'inputRemoved':
      return {
        ...state,
        queuedInputs: state.queuedInputs.filter((entry) => entry.inputId !== action.inputId),
        currentInputId: state.currentInputId === action.inputId ? null : state.currentInputId,
        pendingEcho: state.pendingEcho?.inputId === action.inputId ? null : state.pendingEcho,
      };
    case 'inputAccepted':
      // The submit receipt: adopt the input before any Pi event arrives, but do not retarget STOP
      // while another run is executing. A second message accepted during that run belongs to the
      // queue; its row has its own withdraw action. The echo shows the accepted message.
      const running = state.busy === 'processing' || state.busy === 'stopping';
      return {
        ...state,
        currentInputId: running ? state.currentInputId : action.inputId,
        busy: state.busy === 'idle' ? 'queued' : state.busy,
        pendingEcho: action.content === undefined ? state.pendingEcho : { inputId: action.inputId, content: action.content },
      };
    case 'busy':
      return state.busy === action.activity ? state : { ...state, busy: action.activity };
    case 'interactionResolved':
      // Keep the card visible so its echo shows; the authoritative pendingReplaced (which
      // no longer contains it) removes it from the region.
      return { ...state, pending: state.pending.map((entry) => entry.interactionId === action.interactionId ? { ...entry, resolved: true } : entry) };
    case 'pendingReplaced':
      // The server's pending list is authoritative (also covers creations); keep slot state.
      return { ...state, pending: action.pending };
    case 'frame': {
      const { frame } = action;
      // A context notice carries the number itself: no re-read, and it stays current between
      // snapshots even while a run streams several responses.
      if (frame.type === 'context') {
        return frame.context === undefined ? state : { ...state, context: frame.context };
      }
      if (frame.type !== 'pi' || frame.event === undefined) {
        return state;
      }
      const event = frame.event;
      switch (event.type) {
        case 'message_start': {
          const message = (event.message ?? {}) as { role?: string; content?: unknown; timestamp?: string };
          if (message.role !== 'assistant') return state;
          const entryId = `live-${frame.seq ?? Date.now()}`;
          if (state.liveKeys.has(entryId)) return state;
          return {
            ...state,
            busy: 'processing',
            // This input is the one executing now: STOP follows it across a queue handoff.
            currentInputId: frame.inputId ?? state.currentInputId,
            items: [
              ...state.items,
              normalizePiMessage(message, { entryId, streaming: true, inputId: frame.inputId ?? null, timestamp: message.timestamp ?? new Date().toISOString() }),
            ],
            liveKeys: new Set([...state.liveKeys, entryId]),
            // The queue row is only for work that has not started; this input now has a live
            // assistant entry, so showing it as queued too would be a duplicate.
            queuedInputs: frame.inputId === undefined
              ? state.queuedInputs
              : state.queuedInputs.filter((entry) => entry.inputId !== frame.inputId),
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
            // A late delta for an older input must not be appended to the newer live message.
            if (frame.inputId !== undefined && entry.inputId !== frame.inputId && entry.inputId != null) continue;
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
            | { id?: string; role?: string; content?: unknown; toolCallId?: string; toolName?: string; isError?: boolean; stopReason?: string; timestamp?: string }
            | undefined;
          if (message === undefined) return state;
          const items = [...state.items];
          // A replayed old message_end must not take over the live entry of a newer input: match the
          // streaming entry by this event's input id before considering any other started message.
          const exactLive = frame.inputId === undefined
            ? items.findIndex((entry) => entry.streaming === true)
            : items.findIndex((entry) => entry.streaming === true && entry.inputId === frame.inputId);
          const nullLive = frame.inputId === undefined
            ? -1
            : items.findIndex((entry) => entry.streaming === true && (entry.inputId === null || entry.inputId === undefined));
          const liveIndex = exactLive >= 0 ? exactLive : nullLive;
          const liveKey = items[liveIndex]?.entryId;
          const completed = normalizePiMessage(message, {
            entryId: message.id ?? liveKey ?? `live-${frame.seq}`,
            streaming: false,
            inputId: frame.inputId ?? null,
            toolCallId: message.toolCallId,
            toolName: message.toolName,
            isError: message.isError,
            stopReason: message.stopReason ?? null,
            timestamp: message.timestamp ?? new Date().toISOString(),
          });
          /*
           * The turn exists once, no matter which path brought it here.
           *
           * Three orders are possible and all of them must end with a single bubble: the live entry
           * is present (stream joined normally); a resync snapshot already carries the file's copy
           * (the connection dropped mid-turn and merged); or neither is (the stream joined between
           * message_start and message_end). The same input and signature mean the same message, so
           * the snapshot's own entry id wins and the transient live one is dropped.
           */
          const signature = signatureOf(completed);
          const duplicate = items.findIndex(
            (entry, index) =>
              index !== liveIndex &&
              entry.streaming !== true &&
              sameTurn(entry, completed) &&
              signatureOf(entry) === signature,
          );
          // A null input on the selected live entry is the legacy shape: if it was the only
          // candidate, the completion belongs to it. A genuinely different input never does.
          const liveIsSameTurn =
            liveIndex >= 0 &&
            (sameTurn(items[liveIndex]!, completed) || items[liveIndex]!.inputId == null);
          const liveKeys = new Set(state.liveKeys);
          let next: readonly HistoryMessage[];
          if (liveIsSameTurn && duplicate >= 0) {
            // The snapshot already has this turn: keep it, drop the live twin we just completed.
            next = items.filter((_, index) => index !== liveIndex);
            if (liveKey !== undefined) liveKeys.delete(liveKey);
          } else if (liveIsSameTurn) {
            next = items.map((entry, index) => (index === liveIndex ? completed : entry));
            if (liveKey !== undefined) liveKeys.delete(liveKey);
          } else if (duplicate >= 0) {
            // A stale completion for a turn already in the snapshot: do not touch another input's
            // live entry that happens to be streaming now.
            return state;
          } else {
            next = [...items, completed];
          }
          return { ...state, items: next, liveKeys };
        }
        case 'agent_start':
          return { ...state, busy: 'processing' };
        case 'compaction_start':
          return { ...state, compacting: true };
        case 'compaction_end':
          return { ...state, compacting: false };
        case 'agent_settled':
        case 'agent_end':
          // A settled agent is not always an idle session: a queue still holds inputs waiting for
          // the slot, and a reload snapshot says `queued`. Showing idle here made the working marker
          // (and the STOP button) disappear between two turns of the same queue. The settled input
          // is no longer stoppable; the next `turn_start` adopts the queue's executing input.
          return {
            ...state,
            busy: state.queuedInputs.length > 0 ? 'queued' : 'idle',
            currentInputId: state.queuedInputs.length > 0 ? null : state.currentInputId,
            compacting: false,
          };
        case 'turn_start':
          // Pi announces the input it is about to run before any assistant message exists. This is
          // the earliest honest "working" signal, the echo has now been delivered, and the input
          // that is now running - not the last accepted one - is what STOP must target.
          return {
            ...state,
            busy: 'processing',
            pendingEcho: null,
            currentInputId: frame.inputId ?? state.currentInputId,
            queuedInputs: frame.inputId === undefined
              ? state.queuedInputs
              : state.queuedInputs.filter((entry) => entry.inputId !== frame.inputId),
          };
        default:
          return state;
      }
    }
  }
}
