import { describe, expect, it } from 'vitest';
import { entriesToHistoryRecords } from '../src/server/live-snapshot.ts';
import { INPUT_MARKER_CUSTOM_TYPE } from '../src/server/history.ts';

describe('entriesToHistoryRecords (live in-memory snapshot)', () => {
  const base = { type: 'message', id: 'e1', parentId: null, timestamp: '2026-10-14T00:00:00Z' };

  it('projects message entries with role/content/tool identity — same shape as the file read', () => {
    const records = entriesToHistoryRecords([
      { ...base, id: 'u1', message: { role: 'user', content: [{ type: 'text', text: 'q' }], timestamp: 1 } },
      {
        ...base, id: 'a1',
        message: {
          role: 'assistant',
          content: [{ type: 'toolCall', id: 'c1', name: 'ls', arguments: { path: '.' } }],
          stopReason: 'toolUse', timestamp: 2,
        },
      },
      {
        ...base, id: 't1',
        message: { role: 'toolResult', toolCallId: 'c1', toolName: 'ls', content: [{ type: 'text', text: 'out' }], isError: false, timestamp: 3 },
      },
    ]);
    expect(records.map((r) => r.role)).toEqual(['user', 'assistant', 'toolResult']);
    expect(records[1]?.content).toEqual([{ type: 'toolCall', id: 'c1', name: 'ls', arguments: { path: '.' } }]);
    expect(records[2]?.toolCallId).toBe('c1');
    expect(records[2]?.isError).toBe(false);
  });

  it('input markers correlate following messages with their inputId and stay in the list', () => {
    const records = entriesToHistoryRecords([
      { type: 'custom', id: 'm1', customType: INPUT_MARKER_CUSTOM_TYPE, timestamp: 't', data: { inputId: 'i-9', requestDigest: 'd' } },
      { ...base, id: 'u1', message: { role: 'user', content: 'hello', timestamp: 1 } },
      { type: 'usage', id: 'x', timestamp: 't', kind: 'cache', provider: 'p' },
      { ...base, id: 'a1', message: { role: 'assistant', content: [], timestamp: 2 } },
    ]);
    expect(records).toHaveLength(3);
    expect(records[0]?.marker?.inputId).toBe('i-9');
    expect(records[1]?.inputId).toBe('i-9');
    expect(records[2]?.inputId).toBe('i-9');
  });

  it('non-message non-marker entries are not conversation (compaction/usage/model changes)', () => {
    const records = entriesToHistoryRecords([
      { type: 'compaction', id: 'c', timestamp: 't' },
      { type: 'model_change', id: 'mc', timestamp: 't', provider: 'p', modelId: 'm' },
      { ...base, id: 'u1', message: { role: 'user', content: 'x', timestamp: 1 } },
    ]);
    expect(records).toHaveLength(1);
    expect(records[0]?.role).toBe('user');
  });
});
