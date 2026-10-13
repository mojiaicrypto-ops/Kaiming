import { describe, expect, it } from 'vitest';
import { emptySlot, slotReducer } from '../src/state/slot';
import type { PreparedSnapshot } from '../src/api/stream';

function snapshotOf(messages: unknown[]): PreparedSnapshot {
  return {
    sessionId: 's-1', projectId: 'p-1', roleId: 'chief', activity: 'idle',
    currentInputId: null, inputs: [], messages: messages as never,
    interactions: [], historyLeaf: null, historyProblems: [],
  };
}

describe('slot merge', () => {
  it('snapshot toolCall arguments objects normalize to strings (the ToolCard crash)', () => {
    let slot = emptySlot();
    slot = slotReducer(slot, {
      type: 'snapshot',
      reason: 'initial',
      snapshot: snapshotOf([
        { entryId: 'a1', role: 'assistant', content: [{ type: 'toolCall', id: 'c1', name: 'ls', arguments: { path: '.' } }] },
      ]),
    });
    const block = slot.items[0]?.content[0] as { arguments: string };
    expect(typeof block.arguments).toBe('string');
    expect(block.arguments).toBe('{"path":"."}');
  });

  it('a resync never drops the live in-flight entry and keeps snapshot order', () => {
    let slot = emptySlot();
    // Live: assistant reply streaming (entry live-9 after user u1).
    slot = slotReducer(slot, { type: 'snapshot', reason: 'initial', snapshot: snapshotOf([
      { entryId: 'u1', role: 'user', content: [{ type: 'text', text: 'hi' }] },
    ]) });
    slot = slotReducer(slot, { type: 'frame', frame: { type: 'pi', seq: 9, event: { type: 'message_start', message: { role: 'assistant', content: [] } } } });
    slot = slotReducer(slot, { type: 'frame', frame: { type: 'pi', seq: 10, event: { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'partial answer', contentIndex: 0 } } } });
    // Resync snapshot read from the history file: does NOT contain the in-flight entry.
    slot = slotReducer(slot, { type: 'snapshot', reason: 'resync', snapshot: snapshotOf([
      { entryId: 'u1', role: 'user', content: [{ type: 'text', text: 'hi' }] },
    ]) });
    const live = slot.items.find((entry) => entry.streaming === true);
    expect(live).toBeDefined();
    expect((live?.content[0] as { text: string }).text).toBe('partial answer');
    // Order: user first, live entry last.
    expect(slot.items.map((entry) => entry.entryId)).toEqual(['u1', 'live-9']);
  });

  it('live-only completed entries stay after the snapshot tail (no reordering)', () => {
    let slot = emptySlot();
    slot = slotReducer(slot, { type: 'snapshot', reason: 'initial', snapshot: snapshotOf([
      { entryId: 'u0', role: 'user', content: [{ type: 'text', text: 'q' }] },
    ]) });
    slot = slotReducer(slot, { type: 'frame', frame: { type: 'pi', seq: 2, event: { type: 'message_end', message: { id: 'a1', role: 'assistant', content: [{ type: 'text', text: 'old' }] } } } });
    // Snapshot arrives late (lagging file) without a1:
    slot = slotReducer(slot, { type: 'snapshot', reason: 'resync', snapshot: snapshotOf([
      { entryId: 'u0', role: 'user', content: [{ type: 'text', text: 'q' }] },
    ]) });
    expect(slot.items.map((entry) => entry.entryId)).toEqual(['u0', 'a1']);
  });
});
