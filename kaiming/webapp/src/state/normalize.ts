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

const DOCUMENT_START = '\u2063kaiming-document ';
const DOCUMENT_END = '\u2063/kaiming-document';

/** The server emits this marker when a document is delivered to Pi; split it back into a card. */
function splitDocumentText(text: string): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const start = text.indexOf(DOCUMENT_START, cursor);
    if (start < 0) {
      const rest = text.slice(cursor);
      if (rest !== '') blocks.push({ type: 'text', text: rest });
      break;
    }
    if (start > cursor) {
      const before = text.slice(cursor, start);
      if (before !== '') blocks.push({ type: 'text', text: before });
    }
    const lineEnd = text.indexOf('\n', start + DOCUMENT_START.length);
    if (lineEnd < 0) {
      blocks.push({ type: 'text', text: text.slice(start) });
      break;
    }
    const rawMeta = text.slice(start + DOCUMENT_START.length, lineEnd);
    const end = text.indexOf(`\n${DOCUMENT_END}`, lineEnd + 1);
    if (end < 0) {
      blocks.push({ type: 'text', text: text.slice(start) });
      break;
    }
    let meta: Record<string, unknown> | null = null;
    try {
      const parsed = JSON.parse(rawMeta) as unknown;
      if (typeof parsed === 'object' && parsed !== null) meta = parsed as Record<string, unknown>;
    } catch {
      meta = null;
    }
    if (meta === null || typeof meta['id'] !== 'string' || typeof meta['name'] !== 'string') {
      blocks.push({ type: 'text', text: text.slice(start, end + 1 + DOCUMENT_END.length) });
    } else {
      blocks.push({
        type: 'document',
        src: `/api/v1/attachments/${meta['id']}`,
        name: meta['name'],
        mimeType: typeof meta['mimeType'] === 'string' ? meta['mimeType'] : 'application/octet-stream',
        text: text.slice(lineEnd + 1, end),
      });
    }
    cursor = end + 1 + DOCUMENT_END.length;
  }
  return blocks;
}

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
  if (record.type === 'document') {
    const src =
      typeof record.src === 'string' && record.src !== ''
        ? record.src
        : typeof record.id === 'string' && record.id !== ''
          ? `/api/v1/attachments/${record.id}`
          : '';
    const name = typeof record.name === 'string' && record.name !== '' ? record.name : 'document';
    return {
      type: 'document',
      src,
      name,
      mimeType: typeof record.mimeType === 'string' ? record.mimeType : 'application/octet-stream',
      ...(typeof record.text === 'string' ? { text: record.text } : {}),
      ...(record.truncated === true ? { truncated: true } : {}),
    };
  }
  return { type: 'text', text: typeof record.text === 'string' ? record.text : '' };
}

export function normalizeMessage(message: HistoryMessage): HistoryMessage {
  return {
    ...message,
    content: Array.isArray(message.content)
      ? message.content.flatMap((block) => (block.type === 'text' ? splitDocumentText(block.text) : [normalizeBlock(block)]))
      : [{ type: 'text', text: String(message.content ?? '') }],
  };
}

/** Normalize a raw Pi event message (role/content of unknown shape) into a HistoryMessage. */
export function normalizePiMessage(
  raw: { role?: string; content?: unknown },
  fields: { entryId: string; streaming: boolean; inputId?: string | null; toolCallId?: string; toolName?: string; isError?: boolean; stopReason?: string | null; timestamp?: string | null },
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
    timestamp: fields.timestamp ?? null,
    ...(fields.toolCallId !== undefined ? { toolCallId: fields.toolCallId } : {}),
    ...(fields.toolName !== undefined ? { toolName: fields.toolName } : {}),
    ...(fields.isError !== undefined ? { isError: fields.isError } : {}),
  });
}
