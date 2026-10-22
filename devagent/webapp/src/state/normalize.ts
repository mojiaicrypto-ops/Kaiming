/**
 * Normalization boundary: every Pi message shape entering the slot passes through here, once.
 *
 * Pi reports the same logical message through three channels, each with its own shape:
 *   - the history file / snapshot (toolCall.arguments is an OBJECT, blocks are complete)
 *   - message_start / message_end frames (same object shapes, arriving live)
 *   - message_update deltas (arguments arrive as appended STRING fragments)
 * Slot state only ever holds the normalized view shape (ContentBlock/HistoryMessage below);
 * rendering and dedupe can therefore assume strings and complete fields without knowing
 * which channel a message came from.
 */
import type { ChatRole, ContentBlock, HistoryMessage } from './slot';

export function normalizeBlock(block: unknown): ContentBlock {
  if (typeof block !== 'object' || block === null) {
    return { type: 'text', text: String(block ?? '') };
  }
  const record = block as Record<string, unknown>;
  if (record.type === 'toolCall') {
    // Pi history stores arguments as an object; the live stream appends them as a string.
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
  if (record.type === 'image') {
    // The server sends an attachment id (bytes on disk); `src` may already be a URL.
    const src =
      typeof record.src === 'string' && record.src !== ''
        ? record.src
        : typeof record.id === 'string' && record.id !== ''
          ? `/api/v1/attachments/${record.id}`
          : '';
    if (src === '') return { type: 'text', text: '' };
    return { type: 'image', src, ...(typeof record.mimeType === 'string' ? { alt: record.mimeType } : {}) };
  }
  return { type: 'text', text: typeof record.text === 'string' ? record.text : '' };
}

export function normalizeMessage(message: HistoryMessage): HistoryMessage {
  return {
    ...message,
    content: Array.isArray(message.content) ? message.content.map(normalizeBlock) : [{ type: 'text', text: String(message.content ?? '') }],
  };
}

/** Normalize a raw Pi event message (role/content of unknown shape) into a HistoryMessage. */
export function normalizePiMessage(
  raw: { role?: string; content?: unknown },
  fields: { entryId: string; streaming: boolean; inputId?: string | null; toolCallId?: string; toolName?: string; isError?: boolean; stopReason?: string | null },
): HistoryMessage {
  const role = raw.role === 'user' || raw.role === 'system' || raw.role === 'toolResult' ? raw.role : 'assistant';
  return normalizeMessage({
    entryId: fields.entryId,
    role,
    // A string content (should not occur for Pi messages) still lands as one text block.
    content: Array.isArray(raw.content) ? (raw.content as ContentBlock[]) : [{ type: 'text', text: String(raw.content ?? '') }],
    inputId: fields.inputId ?? null,
    streaming: fields.streaming,
    stopReason: fields.stopReason ?? null,
    ...(fields.toolCallId !== undefined ? { toolCallId: fields.toolCallId } : {}),
    ...(fields.toolName !== undefined ? { toolName: fields.toolName } : {}),
    ...(fields.isError !== undefined ? { isError: fields.isError } : {}),
  });
}
