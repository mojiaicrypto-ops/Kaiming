import { describe, expect, it } from 'vitest';
import { emptySlot, slotReducer } from '../src/state/slot';
import type { HistoryMessage } from '../src/state/slot';
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

  it('a completion frame whose turn the snapshot already has does not add a second bubble', () => {
    /*
     * The reported bug: the same answer appeared twice — once as the snapshot's entry, once as the
     * live one. A snapshot that lands between message_start and message_end replaces the streaming
     * twin, so the completion frame finds no live entry and used to append blindly.
     */
    let slot = emptySlot();
    slot = slotReducer(slot, {
      type: 'snapshot',
      reason: 'initial',
      snapshot: snapshotOf([
        { entryId: 'u1', role: 'user', content: [{ type: 'text', text: '你好' }] },
        { entryId: 'a1', role: 'assistant', content: [{ type: 'text', text: '先讨论一下。' }] },
      ]),
    });
    slot = slotReducer(slot, {
      type: 'frame',
      frame: {
        type: 'pi',
        seq: 21,
        event: { type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: '先讨论一下。' }] } },
      },
    });
    expect(slot.items).toHaveLength(2);
    expect(slot.items.filter((entry) => entry.role === 'assistant')).toHaveLength(1);
    // The snapshot's copy is the one kept: it is the file's own entry id.
    expect(slot.items[1]?.entryId).toBe('a1');
  });

  it('a resync that carried the finished turn drops the live twin when it completes', () => {
    // The reported case: the connection drops mid-turn, the resync snapshot already contains the
    // file's copy of the answer, and the completion frame then replaces the live entry — leaving the
    // same answer twice unless the snapshot's copy wins.
    let slot = emptySlot();
    slot = slotReducer(slot, {
      type: 'snapshot',
      reason: 'initial',
      snapshot: snapshotOf([{ entryId: 'u1', role: 'user', content: [{ type: 'text', text: '你好' }] }]),
    });
    slot = slotReducer(slot, {
      type: 'frame',
      frame: { type: 'pi', seq: 9, event: { type: 'message_start', message: { role: 'assistant', content: [] } } },
    });
    slot = slotReducer(slot, {
      type: 'frame',
      frame: { type: 'pi', seq: 10, event: { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: '先讨论', contentIndex: 0 } } },
    });
    // Reconnect: the snapshot was read after the provider finished, so it holds the whole answer.
    slot = slotReducer(slot, {
      type: 'snapshot',
      reason: 'resync',
      snapshot: snapshotOf([
        { entryId: 'u1', role: 'user', content: [{ type: 'text', text: '你好' }] },
        { entryId: 'a1', role: 'assistant', content: [{ type: 'text', text: '先讨论一下。' }] },
      ]),
    });
    slot = slotReducer(slot, {
      type: 'frame',
      frame: { type: 'pi', seq: 11, event: { type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: '先讨论一下。' }] } } },
    });
    expect(slot.items.filter((entry) => entry.role === 'assistant')).toHaveLength(1);
    expect(slot.items.at(-1)?.entryId).toBe('a1');
  });

  it('a turn the snapshot does not have yet is still appended on its completion frame', () => {
    // The other half of the rule: dedupe must not swallow a real turn when the stream joined late.
    let slot = emptySlot();
    slot = slotReducer(slot, {
      type: 'snapshot',
      reason: 'initial',
      snapshot: snapshotOf([{ entryId: 'u1', role: 'user', content: [{ type: 'text', text: '你好' }] }]),
    });
    slot = slotReducer(slot, {
      type: 'frame',
      frame: {
        type: 'pi',
        seq: 21,
        event: { type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: '答。' }] } },
      },
    });
    expect(slot.items).toHaveLength(2);
    expect(slot.items[1]?.content[0]).toMatchObject({ type: 'text', text: '答。' });
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

describe('slot merge · orphan live keys', () => {
  it('a completed live-only entry whose content matches a snapshot entry is dropped (no duplicate)', () => {
    let slot = emptySlot();
    // Stream joined mid-turn: message_end arrived without message_start → transient key.
    slot = slotReducer(slot, { type: 'frame', frame: { type: 'pi', seq: 4, event: { type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'the answer' }] } } } });
    expect(slot.items.map((entry) => entry.entryId)).toEqual(['live-4']);
    // Snapshot catches up with the real entry id for the same message.
    slot = slotReducer(slot, { type: 'snapshot', reason: 'resync', snapshot: snapshotOf([
      { entryId: 'real-a1', role: 'assistant', content: [{ type: 'text', text: 'the answer' }] },
    ]) });
    expect(slot.items.map((entry) => entry.entryId)).toEqual(['real-a1']);
  });
});

describe('slot merge · live frame shapes', () => {
  it('message_end with object toolCall arguments normalizes to a string (the ToolCard crash)', () => {
    let slot = emptySlot();
    slot = slotReducer(slot, { type: 'frame', frame: { type: 'pi', seq: 7, event: { type: 'message_end', message: { role: 'assistant', content: [{ type: 'toolCall', id: 'c1', name: 'ls', arguments: { path: '.' } }] } } } });
    const block = slot.items[0]?.content[0] as { arguments: unknown };
    expect(typeof block.arguments).toBe('string');
    expect(block.arguments).toBe('{"path":"."}');
  });

  it('message_start with object toolCall arguments normalizes as well', () => {
    let slot = emptySlot();
    slot = slotReducer(slot, { type: 'frame', frame: { type: 'pi', seq: 8, event: { type: 'message_start', message: { role: 'assistant', content: [{ type: 'toolCall', id: 'c2', name: 'ls', arguments: { path: 'x' } }] } } } });
    const block = slot.items[0]?.content[0] as { arguments: unknown };
    expect(typeof block.arguments).toBe('string');
  });
});

describe('slot merge · thinking-first twins', () => {
  const thinkingMsg = (entryId: string, text: string): HistoryMessage => ({
    entryId, role: 'assistant', streaming: false,
    content: [{ type: 'thinking', thinking: 'plan it' }, { type: 'text', text }],
  });

  it('an exact completed live twin with thinking-first content is dropped', () => {
    let slot = emptySlot();
    slot = slotReducer(slot, { type: 'frame', frame: { type: 'pi', seq: 1, event: { type: 'message_start', message: { role: 'assistant', content: [] } } } });
    slot = slotReducer(slot, { type: 'frame', frame: { type: 'pi', seq: 2, event: { type: 'message_end', message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'plan it' }, { type: 'text', text: 'hello' }] } } } });
    // Resync with the snapshot knowing the same turn under its real id.
    slot = slotReducer(slot, { type: 'snapshot', reason: 'resync', snapshot: { sessionId: 's', projectId: 'p', roleId: 'chief', activity: 'idle', currentInputId: null, inputs: [], messages: [thinkingMsg('real-1', 'hello')], interactions: [], historyLeaf: null, historyProblems: [] } });
    expect(slot.items.map((e) => e.entryId)).toEqual(['real-1']);
  });

  it('a partial (half-text) live twin is dropped in favor of the complete snapshot entry', () => {
    let slot = emptySlot();
    slot = slotReducer(slot, { type: 'frame', frame: { type: 'pi', seq: 3, event: { type: 'message_start', message: { role: 'assistant', content: [] } } } });
    slot = slotReducer(slot, { type: 'frame', frame: { type: 'pi', seq: 4, event: { type: 'message_end', message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'plan it' }, { type: 'text', text: 'hel' }] } } } });
    slot = slotReducer(slot, { type: 'snapshot', reason: 'resync', snapshot: { sessionId: 's', projectId: 'p', roleId: 'chief', activity: 'idle', currentInputId: null, inputs: [], messages: [thinkingMsg('real-2', 'hello')], interactions: [], historyLeaf: null, historyProblems: [] } });
    expect(slot.items.map((e) => e.entryId)).toEqual(['real-2']);
  });

  it('distinct thinking messages are NOT deduped against each other (old first-block-only signature bug)', () => {
    let slot = emptySlot();
    slot = slotReducer(slot, { type: 'snapshot', reason: 'resync', snapshot: { sessionId: 's', projectId: 'p', roleId: 'chief', activity: 'idle', currentInputId: null, inputs: [], messages: [thinkingMsg('a', 'one'), thinkingMsg('b', 'two')], interactions: [], historyLeaf: null, historyProblems: [] } });
    expect(slot.items.map((e) => e.entryId)).toEqual(['a', 'b']);
  });
});


describe('slot merge · snapshot channel normalization', () => {
  it('snapshot messages with object toolCall arguments normalize through the same boundary', () => {
    let slot = emptySlot();
    slot = slotReducer(slot, { type: 'snapshot', reason: 'initial', snapshot: { sessionId: 's', projectId: 'p', roleId: 'chief', activity: 'idle', currentInputId: null, inputs: [], messages: [{ entryId: 'r1', role: 'assistant', content: [{ type: 'toolCall', id: 'c1', name: 'ls', arguments: { path: '.' } }] }] as never, interactions: [], historyLeaf: null, historyProblems: [] } });
    const block = slot.items[0]?.content[0] as { arguments: unknown };
    expect(typeof block.arguments).toBe('string');
    expect(block.arguments).toBe('{"path":"."}');
    expect(slot.items[0]?.entryId).toBe('r1');
  });
});

describe('slot merge · lost message_end under resync', () => {
  const thinkingMsg = (entryId: string, text: string, streaming = false): HistoryMessage => ({
    entryId, role: 'assistant', streaming,
    content: [{ type: 'thinking', thinking: 'plan it' }, { type: 'text', text }],
  });

  it('a STILL-STREAMING live entry whose completed twin is in the snapshot is dropped (no ghost half-render)', () => {
    let slot = emptySlot();
    // The live entry started streaming (thinking, then partial text) and its end frame was
    // lost in the resync.
    slot = slotReducer(slot, { type: 'frame', frame: { type: 'pi', seq: 1, event: { type: 'message_start', message: { role: 'assistant', content: [] } } } });
    slot = slotReducer(slot, { type: 'frame', frame: { type: 'pi', seq: 2, event: { type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', contentIndex: 0, delta: 'plan it' } } } });
    slot = slotReducer(slot, { type: 'frame', frame: { type: 'pi', seq: 3, event: { type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 1, delta: 'hel' } } } });
    // Resync: the run had completed, the snapshot carries the finished turn.
    slot = slotReducer(slot, { type: 'snapshot', reason: 'resync', snapshot: { sessionId: 's', projectId: 'p', roleId: 'chief', activity: 'idle', currentInputId: null, inputs: [], messages: [thinkingMsg('real-9', 'hello')], interactions: [], historyLeaf: null, historyProblems: [] } });
    expect(slot.items.map((e) => e.entryId)).toEqual(['real-9']);
    expect(slot.liveKeys.size).toBe(0);
  });

  it('a genuinely in-flight live entry with NO snapshot twin survives the merge (content not in file yet)', () => {
    let slot = emptySlot();
    slot = slotReducer(slot, { type: 'frame', frame: { type: 'pi', seq: 3, event: { type: 'message_start', message: { role: 'assistant', content: [] } } } });
    slot = slotReducer(slot, { type: 'frame', frame: { type: 'pi', seq: 4, event: { type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'brand new content' } } } });
    slot = slotReducer(slot, { type: 'snapshot', reason: 'resync', snapshot: { sessionId: 's', projectId: 'p', roleId: 'chief', activity: 'processing', currentInputId: 'i1', inputs: [], messages: [], interactions: [], historyLeaf: null, historyProblems: [] } });
    expect(slot.items).toHaveLength(1);
    expect(slot.items[0]?.streaming).toBe(true);
  });
});

describe('slot · retained inputs', () => {
  it('a snapshot seeds the queued inputs and inputQueued/inputRemoved track local adds/withdrawals', () => {
    let slot = emptySlot();
    slot = slotReducer(slot, { type: 'snapshot', reason: 'initial', snapshot: { sessionId: 's', projectId: 'p', roleId: 'chief', activity: 'queued', currentInputId: null, inputs: [{ inputId: 'i-1', kind: 'user', status: 'queued', revision: 1, errorCode: null }, { inputId: 'i-2', kind: 'user', status: 'completed', revision: 1, errorCode: null }], messages: [], interactions: [], historyLeaf: null, historyProblems: [] } });
    expect(slot.queuedInputs.map((entry) => entry.inputId)).toEqual(['i-1']);
    slot = slotReducer(slot, { type: 'inputQueued', inputId: 'i-3' });
    expect(slot.queuedInputs.map((entry) => entry.inputId)).toEqual(['i-1', 'i-3']);
    slot = slotReducer(slot, { type: 'inputRemoved', inputId: 'i-1' });
    expect(slot.queuedInputs.map((entry) => entry.inputId)).toEqual(['i-3']);
  });
});

describe('slot · compaction state', () => {
  it('tracks compaction_start/end and restores it from a snapshot', () => {
    let slot = slotReducer(emptySlot(), {
      type: 'frame',
      frame: { type: 'pi', event: { type: 'compaction_start', reason: 'manual' } },
    });
    expect(slot.compacting).toBe(true);
    slot = slotReducer(slot, { type: 'frame', frame: { type: 'pi', event: { type: 'compaction_end' } } });
    expect(slot.compacting).toBe(false);

    slot = slotReducer(slot, {
      type: 'snapshot',
      reason: 'resync',
      snapshot: { ...snapshotOf([]), compacting: true },
    });
    expect(slot.compacting).toBe(true);
    slot = slotReducer(slot, { type: 'snapshot', reason: 'initial', snapshot: snapshotOf([]) });
    expect(slot.compacting).toBe(false);
  });
});

describe('slot · context occupancy', () => {
  const context = {
    tokens: 616_855,
    contextWindow: 1_000_000,
    percent: 61.6855,
    autoCompaction: true,
    live: true,
  };

  it('takes the snapshot reading and then follows context notices', () => {
    let slot = emptySlot();
    slot = slotReducer(slot, {
      type: 'snapshot',
      reason: 'initial',
      snapshot: { ...snapshotOf([]), context },
    });
    expect(slot.context).toEqual(context);

    const next = { tokens: 700_000, contextWindow: 1_000_000, percent: 70, autoCompaction: true, live: true };
    slot = slotReducer(slot, { type: 'frame', frame: { type: 'context', context: next } });
    expect(slot.context).toEqual(next);
  });

  it('a snapshot without a reading clears it, and a notice without a payload changes nothing', () => {
    let slot = slotReducer(emptySlot(), {
      type: 'snapshot',
      reason: 'initial',
      snapshot: { ...snapshotOf([]), context },
    });
    slot = slotReducer(slot, { type: 'snapshot', reason: 'resync', snapshot: snapshotOf([]) });
    expect(slot.context).toBeNull();

    slot = slotReducer(slot, { type: 'frame', frame: { type: 'context' } });
    expect(slot.context).toBeNull();
  });

  it('reset clears the reading with the rest of the per-session state', () => {
    let slot = slotReducer(emptySlot(), {
      type: 'snapshot',
      reason: 'initial',
      snapshot: { ...snapshotOf([]), context },
    });
    slot = slotReducer(slot, { type: 'reset' });
    expect(slot.context).toBeNull();
  });
});
