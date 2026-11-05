/**
 * Live snapshot projection (R1): when a session has a live Pi instance, the snapshot reads the
 * instance's in-memory entries (`handle.sessionManager.getEntries()`) instead of the history
 * file. The file lags the stream — an in-flight message is written only when it completes — so
 * a file-based snapshot cannot describe what is on screen, and a resync made it vanish (the old
 * shell's measured data loss). The output shape is exactly `HistoryRecord`-compatible, so the
 * stream snapshot and `session.messages.list` agree.
 */
import type { SessionManager } from '@earendil-works/pi-coding-agent';
import { INPUT_MARKER_CUSTOM_TYPE, type HistoryRecord } from './history.ts';
import { projectContentImages } from './image-projection.ts';

interface EntryLike {
  readonly type: string;
  readonly id: string;
  readonly timestamp?: string;
  readonly customType?: string;
  readonly data?: Record<string, unknown>;
  readonly message?: Record<string, unknown>;
}

function contentOf(message: Record<string, unknown>): unknown {
  return message['content'] ?? null;
}

/**
 * Project live in-memory entries into the browser history shape. Only `message` entries and the
 * host's input markers are conversation; everything else (compaction, usage, model changes) is
 * not listed — the same rule `readPiHistory` applies to file entries.
 */
export function entriesToHistoryRecords(entries: readonly unknown[], agentDir?: string): HistoryRecord[] {
  const records: HistoryRecord[] = [];
  let currentInputId: string | null = null;
  for (const entry of entries as readonly EntryLike[]) {
    const type = typeof entry?.type === 'string' ? entry.type : 'unknown';
    if (type === 'custom' && entry.customType === INPUT_MARKER_CUSTOM_TYPE) {
      const data = (typeof entry.data === 'object' && entry.data !== null ? entry.data : {}) as Record<string, unknown>;
      const inputId = typeof data['inputId'] === 'string' ? data['inputId'] : '';
      currentInputId = inputId === '' ? currentInputId : inputId;
      records.push({
        index: records.length,
        id: typeof entry.id === 'string' ? entry.id : null,
        type,
        role: null,
        content: null,
        toolCallId: null,
        toolName: null,
        isError: null,
        timestamp: typeof entry.timestamp === 'string' ? entry.timestamp : null,
        inputId: currentInputId,
        marker: {
          inputId: currentInputId ?? '',
          ...(typeof data['requestDigest'] === 'string' ? { requestDigest: data['requestDigest'] } : {}),
        },
      });
      continue;
    }
    if (type !== 'message') continue;
    const message = (typeof entry.message === 'object' && entry.message !== null ? entry.message : {}) as Record<string, unknown>;
    const roleRaw = message['role'];
    const role =
      roleRaw === 'user' || roleRaw === 'assistant' || roleRaw === 'system' || roleRaw === 'toolResult'
        ? roleRaw
        : null;
    records.push({
      index: records.length,
      id: typeof entry.id === 'string' ? entry.id : null,
      type,
      role,
      content: projectContentImages(contentOf(message), agentDir),
      toolCallId: typeof message['toolCallId'] === 'string' ? message['toolCallId'] : null,
      toolName: typeof message['toolName'] === 'string' ? message['toolName'] : null,
      isError: typeof message['isError'] === 'boolean' ? message['isError'] : null,
      timestamp: typeof entry.timestamp === 'string' ? entry.timestamp : null,
      inputId: currentInputId,
      marker: null,
    });
  }
  return records;
}

/** A live snapshot source: entries from the session manager when the instance is alive. */
export function liveHistoryRead(sessionManager: SessionManager, agentDir?: string): {
  records: readonly HistoryRecord[];
  problems: readonly string[];
} {
  // The live projection is built from typed entries, not parsed text: nothing to report.
  return {
    records: entriesToHistoryRecords(sessionManager.getEntries() as readonly unknown[], agentDir),
    problems: [],
  };
}
