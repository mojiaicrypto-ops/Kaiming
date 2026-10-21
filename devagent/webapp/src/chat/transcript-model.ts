import type { ContentBlock, HistoryMessage } from '../state/slot';

/** A tool call and its result, paired by call id, ready for one card. */
export interface ToolResultView {
  readonly text: string;
  readonly failed: boolean;
}

export type BlockKind =
  | { readonly kind: 'thinking'; readonly text: string }
  | { readonly kind: 'text'; readonly text: string }
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
    if (message.toolCallId !== undefined) {
      results.set(message.toolCallId, { text, failed: message.isError === true });
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

/** Elapsed time in the prototype's vocabulary: `820ms`, `1.4s`, `1m 02s`. */
export function elapsed(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${String(Math.floor(seconds % 60)).padStart(2, '0')}s`;
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
