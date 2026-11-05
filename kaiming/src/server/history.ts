/**
 * Reading a session's Pi history for the browser (R1 `session.messages.list`).
 *
 * The history file is the authority; this reader is deliberately forgiving about lines it cannot
 * parse (they are reported, never guessed) and correlates each message with the input that produced
 * it through the host's own marker entries - the same correlation the runtime uses to recover.
 */
import { existsSync, readFileSync } from 'node:fs';
import { projectContentImages } from './image-projection.ts';

export const INPUT_MARKER_CUSTOM_TYPE = 'kaiming.input-marker';

export interface HistoryRecord {
  readonly index: number;
  readonly id: string | null;
  readonly type: string;
  readonly role: 'user' | 'assistant' | 'system' | 'toolResult' | null;
  readonly content: unknown;
  /** Tool identity, only for a result message (PI's ToolResultMessage carries them). */
  readonly toolCallId: string | null;
  readonly toolName: string | null;
  readonly isError: boolean | null;
  readonly timestamp: string | null;
  /** The input this entry belongs to, when a host marker precedes it. */
  readonly inputId: string | null;
  readonly marker: { readonly inputId: string; readonly requestDigest?: string } | null;
}

export interface HistoryRead {
  readonly found: boolean;
  readonly header: { readonly sessionId: string | null; readonly cwd: string | null; readonly version: number | null } | null;
  readonly records: readonly HistoryRecord[];
  readonly problems: readonly string[];
}

/**
 * Read the file. `agentDir` is where image bytes live: a message that carries base64 is projected to
 * an attachment address, because the browser must never be handed the bytes themselves.
 */
export function readPiHistory(piFile: string | undefined, agentDir?: string): HistoryRead {
  if (piFile === undefined || !existsSync(piFile)) {
    return { found: false, header: null, records: [], problems: [] };
  }
  const text = readFileSync(piFile, 'utf8');
  const problems: string[] = [];
  const records: HistoryRecord[] = [];
  let header: HistoryRead['header'] = null;
  let currentInputId: string | null = null;
  const lines = text.split('\n');
  for (const [index, raw] of lines.entries()) {
    if (raw.trim() === '') {
      continue;
    }
    let entry: Record<string, unknown>;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (typeof parsed !== 'object' || parsed === null) {
        problems.push(`line ${index + 1}: not a JSON object`);
        continue;
      }
      entry = parsed as Record<string, unknown>;
    } catch {
      problems.push(`line ${index + 1}: not JSON`);
      continue;
    }
    const type = typeof entry['type'] === 'string' ? entry['type'] : 'unknown';
    if (type === 'session') {
      header = {
        sessionId: typeof entry['id'] === 'string' ? entry['id'] : null,
        cwd: typeof entry['cwd'] === 'string' ? entry['cwd'] : null,
        version: typeof entry['version'] === 'number' ? entry['version'] : null,
      };
      continue;
    }
    const id = typeof entry['id'] === 'string' ? entry['id'] : null;
    const timestamp = typeof entry['timestamp'] === 'string' ? entry['timestamp'] : null;
    if (type === 'custom' && entry['customType'] === INPUT_MARKER_CUSTOM_TYPE) {
      const data = (typeof entry['data'] === 'object' && entry['data'] !== null
        ? entry['data']
        : {}) as Record<string, unknown>;
      const inputId = typeof data['inputId'] === 'string' ? data['inputId'] : '';
      currentInputId = inputId === '' ? currentInputId : inputId;
      records.push({
        index,
        id,
        type,
        role: null,
        content: null,
        toolCallId: null,
        toolName: null,
        isError: null,
        timestamp,
        inputId: currentInputId,
        marker: {
          inputId: currentInputId ?? '',
          ...(typeof data['requestDigest'] === 'string' ? { requestDigest: data['requestDigest'] } : {}),
        },
      });
      continue;
    }
    if (type !== 'message') {
      // Other session entries (compaction, branches) are not conversation and are not listed.
      continue;
    }
    const message = (typeof entry['message'] === 'object' && entry['message'] !== null
      ? entry['message']
      : {}) as Record<string, unknown>;
    const role =
      message['role'] === 'user' || message['role'] === 'assistant' || message['role'] === 'system' || message['role'] === 'toolResult'
        ? message['role']
        : null;
    records.push({
      index,
      id,
      type,
      role,
      content: projectContentImages(message['content'] ?? null, agentDir),
      toolCallId: typeof message['toolCallId'] === 'string' ? message['toolCallId'] : null,
      toolName: typeof message['toolName'] === 'string' ? message['toolName'] : null,
      isError: typeof message['isError'] === 'boolean' ? message['isError'] : null,
      timestamp,
      inputId: currentInputId,
      marker: null,
    });
  }
  return { found: true, header, records, problems };
}

/** Page the message records: the cursor is a previous page's last entry id (stable across appends). */
export function pageHistory(
  read: { records: readonly HistoryRecord[] },
  cursor: string | undefined,
  limit: number,
): { readonly records: readonly HistoryRecord[]; readonly nextCursor: string | null; readonly unknownCursor: boolean } {
  const messages = read.records.filter((record) => record.type === 'message');
  let start = 0;
  if (cursor !== undefined) {
    const found = messages.findIndex((record) => record.id === cursor);
    if (found < 0) {
      return { records: [], nextCursor: null, unknownCursor: true };
    }
    start = found + 1;
  }
  const page = messages.slice(start, start + limit);
  const next = start + limit < messages.length ? (page[page.length - 1]?.id ?? null) : null;
  return { records: page, nextCursor: next, unknownCursor: false };
}

/**
 * The page of messages strictly BEFORE one entry, so a reader can walk a long conversation backwards
 * (the forward cursor only ever moves towards the newest message).
 *
 * Returns `previousCursor` = the first entry of this page, or null at the beginning of the history.
 */
export function pageHistoryBefore(
  read: { records: readonly HistoryRecord[] },
  before: string,
  limit: number,
): {
  readonly records: readonly HistoryRecord[];
  readonly previousCursor: string | null;
  readonly unknownCursor: boolean;
} {
  const messages = read.records.filter((record) => record.type === 'message');
  const found = messages.findIndex((record) => record.id === before);
  if (found < 0) {
    return { records: [], previousCursor: null, unknownCursor: true };
  }
  const start = Math.max(found - limit, 0);
  const page = messages.slice(start, found);
  return {
    records: page,
    previousCursor: start > 0 ? (page[0]?.id ?? null) : null,
    unknownCursor: false,
  };
}

/** The LAST `limit` message records: a reconnect snapshot must describe the conversation's
 *  tail — the first-page cut silently dropped the newest turns once history passed the cap. */
export function tailHistory(
  read: { records: readonly HistoryRecord[] },
  limit: number,
): { readonly records: readonly HistoryRecord[] } {
  const messages = read.records.filter((record) => record.type === 'message');
  return { records: messages.slice(Math.max(messages.length - limit, 0)) };
}
