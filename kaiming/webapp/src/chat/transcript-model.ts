import type { ContentBlock, HistoryMessage } from '../state/slot';

/** A tool call and its result, paired by call id, ready for one card. */
export interface ToolResultView {
  readonly text: string;
  /** Attachment URLs the tool returned (a browser screenshot); rendered inside the card. */
  readonly images: readonly string[];
  readonly failed: boolean;
}

export type BlockKind =
  | { readonly kind: 'thinking'; readonly text: string }
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'image'; readonly src: string; readonly alt: string }
  | { readonly kind: 'document'; readonly src: string; readonly name: string; readonly mimeType: string; readonly text?: string; readonly truncated?: boolean }
  | { readonly kind: 'tool'; readonly name: string; readonly callId: string; readonly args: string; readonly result: ToolResultView | null };

/**
 * Index tool results by call id so the transcript can flip a running card instead of rendering a
 * second blob (R4). A result with no call id cannot be paired and is not rendered as a blob: the
 * old renderer attached it to the newest running card, which mislabels a result when two calls
 * interleave, so the shell shows the call with a waiting status instead of a wrong answer.
 */
export function indexToolResults(items: readonly HistoryMessage[]): Map<string, ToolResultView> {
  const results = new Map<string, ToolResultView>();
  for (const message of items) {
    if (message.role !== 'toolResult') continue;
    const text = message.content.map((block) => (block.type === 'text' ? block.text : '')).join('');
    const images = message.content.flatMap((block) => (block.type === 'image' ? [block.src] : []));
    if (message.toolCallId !== undefined) {
      results.set(message.toolCallId, { text, images, failed: message.isError === true });
    }
  }
  return results;
}

/** Parse tool arguments once; a partially streamed call is not valid JSON yet. */
/**
 * Best-effort value of a string field while the arguments are still arriving: the closing quote is
 * optional, because an unterminated value is exactly what a streamed call looks like.
 */
export function streamedField(raw: string, key: string): string {
  const match = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"?`).exec(raw);
  return match?.[1] ?? '';
}
/** Parse tool arguments once; a partially streamed call is not valid JSON yet. */
export function parseArgs(raw: string): Record<string, unknown> | null {
  if (raw.trim() === '') return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The member row the transcript hands to a dispatch card. */
export interface DispatchMemberView {
  readonly sessionId: string;
}

/**
 * Which members a dispatch card shows: only the ones that call named, at the point it happened. A
 * call that named none (a resume, an update) inherits the Task's live membership when it is the
 * newest dispatch - otherwise an older card would claim work that had not started yet.
 */
export function membersForDispatch<T extends DispatchMemberView>(
  members: readonly T[] | undefined,
  parsed: Record<string, unknown> | null,
  isNewestDispatch: boolean,
  liveSessions?: ReadonlySet<string>,
): readonly T[] | undefined {
  const named = Array.isArray(parsed?.['sessions'])
    ? new Set(
        (parsed['sessions'] as Array<{ sessionId?: unknown }>)
          .map((entry) => entry.sessionId)
          .filter((id): id is string => typeof id === 'string'),
      )
    : new Set<string>();
  if (named.size > 0) return (members ?? []).filter((member) => named.has(member.sessionId));
  if (!isNewestDispatch) return undefined;
  // Inheriting means "this is the step running now", so it shows the members still working - not
  // every member the Task ever had, whose finished rows belong to their own dispatch card.
  return liveSessions === undefined
    ? members
    : (members ?? []).filter((member) => liveSessions.has(member.sessionId));
}

/** One line describing what a tool call is doing, for the collapsed summary. */
export function argSummary(name: string, parsed: Record<string, unknown> | null, raw: string): string {
  const pick = ['command', 'path', 'pattern', 'title', 'query'];
  if (parsed !== null) {
    for (const key of pick) {
      const value = parsed[key];
      if (typeof value === 'string' && value !== '') return value;
    }
    const op = parsed['op'];
    const target = parsed['requirementId'] ?? parsed['taskId'] ?? parsed['sessionId'];
    if (typeof op === 'string') return typeof target === 'string' ? `${op} ${target}` : op;
  }
  for (const key of pick) {
    const value = streamedField(raw, key);
    if (value !== '') return value;
  }
  return raw.slice(0, 60);
}

/** Split a message into renderable blocks; thinking, text and tool calls keep their order. */
export function blocksOf(message: HistoryMessage): BlockKind[] {
  const blocks: BlockKind[] = [];
  message.content.forEach((block: ContentBlock, index) => {
    if (block.type === 'thinking') {
      blocks.push({ kind: 'thinking', text: block.thinking });
      return;
    }
    if (block.type === 'image') {
      blocks.push({ kind: 'image', src: block.src, alt: block.alt ?? '' });
      return;
    }
    if (block.type === 'document') {
      blocks.push({
        kind: 'document',
        src: block.src,
        name: block.name,
        mimeType: block.mimeType,
        ...(block.text === undefined ? {} : { text: block.text }),
        ...(block.truncated === true ? { truncated: true } : {}),
      });
      return;
    }
    if (block.type === 'toolCall') {
      blocks.push({
        kind: 'tool',
        name: block.name ?? 'tool',
        callId: block.id ?? `block-${index}`,
        args: block.arguments ?? '',
        result: null,
      });
      return;
    }
    blocks.push({ kind: 'text', text: block.text });
  });
  return blocks;
}

/** Elapsed time in the prototype's vocabulary: `820ms`, `1.4s`, `1m 02s`, `1h 05m`, `2d 03h`. */
export function elapsed(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const whole = Math.floor(seconds);
  if (whole < 3600) {
    return `${Math.floor(whole / 60)}m ${String(whole % 60).padStart(2, '0')}s`;
  }
  const hours = Math.floor(whole / 3600);
  if (hours < 24) return `${hours}h ${String(Math.floor((whole % 3600) / 60)).padStart(2, '0')}m`;
  return `${Math.floor(hours / 24)}d ${String(hours % 24).padStart(2, '0')}h`;
}

/** Relative day label for the session rail: today's clock, yesterday, or a short date. */
export function relativeDay(iso: string | null): 'today' | 'yesterday' | 'older' | 'none' {
  if (iso === null || iso === '') return 'none';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'none';
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const time = date.getTime();
  if (time >= startOfToday) return 'today';
  if (time >= startOfToday - 86_400_000) return 'yesterday';
  return 'older';
}
