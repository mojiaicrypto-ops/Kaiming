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
  it('a resync whose snapshot tail advanced keeps shown history before the new tail', () => {
    let slot = emptySlot();
    slot = slotReducer(slot, { type: 'snapshot', reason: 'initial', snapshot: snapshotOf([
      { entryId: 'h1', role: 'user', content: [{ type: 'text', text: 'one' }] },
      { entryId: 'h2', role: 'assistant', content: [{ type: 'text', text: 'two' }] },
      { entryId: 'h3', role: 'user', content: [{ type: 'text', text: 'three' }] },
    ]) });
    // A long-lived page, then a reconnect after the history moved past the snapshot's 100-message
    // tail. h1 is no longer in the snapshot, but it is older than the new tail, not a live tail.
    slot = slotReducer(slot, { type: 'snapshot', reason: 'resync', snapshot: snapshotOf([
      { entryId: 'h2', role: 'assistant', content: [{ type: 'text', text: 'two' }] },
      { entryId: 'h3', role: 'user', content: [{ type: 'text', text: 'three' }] },
      { entryId: 'h4', role: 'assistant', content: [{ type: 'text', text: 'four' }] },
    ]) });
    expect(slot.items.map((entry) => entry.entryId)).toEqual(['h1', 'h2', 'h3', 'h4']);
  });
  it('a reconnect with no shared ids orders old stream entries before newer history', () => {
    let slot = emptySlot();
    slot = slotReducer(slot, { type: 'snapshot', reason: 'initial', snapshot: snapshotOf([
      { entryId: 'h1', role: 'user', content: [{ type: 'text', text: 'one' }], timestamp: '2026-11-02T01:00:00.000Z' },
      { entryId: 'h2', role: 'assistant', content: [{ type: 'text', text: 'two' }], timestamp: '2026-11-02T01:00:01.000Z' },
    ]) });
    // A stream completion was shown before the connection dropped.
    slot = slotReducer(slot, { type: 'frame', frame: { type: 'pi', seq: 3, event: { type: 'message_end', message: {
      id: 'a1', role: 'assistant', content: [{ type: 'text', text: 'three' }], timestamp: '2026-11-02T01:00:02.000Z',
    } } } });
    // The reconnect snapshot advanced past all of it (more than the 100-message tail).
    slot = slotReducer(slot, { type: 'snapshot', reason: 'resync', snapshot: snapshotOf([
      { entryId: 'h4', role: 'user', content: [{ type: 'text', text: 'four' }], timestamp: '2026-11-02T01:00:03.000Z' },
      { entryId: 'h5', role: 'assistant', content: [{ type: 'text', text: 'five' }], timestamp: '2026-11-02T01:00:04.000Z' },
    ]) });
    expect(slot.items.map((entry) => entry.entryId)).toEqual(['h1', 'h2', 'a1', 'h4', 'h5']);
  });
  it('a reconnect with no shared ids keeps entries without timestamps as older history', () => {
    let slot = emptySlot();
    slot = slotReducer(slot, { type: 'snapshot', reason: 'initial', snapshot: snapshotOf([
      { entryId: 'h1', role: 'user', content: [{ type: 'text', text: 'one' }] },
      { entryId: 'h2', role: 'assistant', content: [{ type: 'text', text: 'two' }] },
    ]) });
    // The new backend adds timestamps, but an older running server does not. Position must still
    // keep the page's messages before a snapshot that has moved past all of them.
    slot = slotReducer(slot, { type: 'snapshot', reason: 'resync', snapshot: snapshotOf([
      { entryId: 'h4', role: 'user', content: [{ type: 'text', text: 'four' }] },
      { entryId: 'h5', role: 'assistant', content: [{ type: 'text', text: 'five' }] },
    ]) });
    expect(slot.items.map((entry) => entry.entryId)).toEqual(['h1', 'h2', 'h4', 'h5']);
  });
});

describe('slot merge · repeated text across turns', () => {
  const text = (value: string): unknown[] => [{ type: 'text', text: value }];

  it('keeps a new completion whose text repeats an earlier turn', () => {
    let slot = emptySlot();
    slot = slotReducer(slot, {
      type: 'snapshot',
      reason: 'initial',
      snapshot: snapshotOf([
        { entryId: 'u1', role: 'user', content: text('one'), inputId: 'i1' },
        { entryId: 'a1', role: 'assistant', content: text('done'), inputId: 'i1' },
      ]),
    });
    slot = slotReducer(slot, {
      type: 'frame',
      frame: { type: 'pi', seq: 20, inputId: 'i2', event: { type: 'message_start', message: { role: 'assistant', content: [] } } },
    });
    slot = slotReducer(slot, {
      type: 'frame',
      frame: { type: 'pi', seq: 21, inputId: 'i2', event: { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'done', contentIndex: 0 } } },
    });
    slot = slotReducer(slot, {
      type: 'frame',
      frame: { type: 'pi', seq: 22, inputId: 'i2', event: { type: 'message_end', message: { role: 'assistant', content: text('done') } } },
    });

    const assistants = slot.items.filter((entry) => entry.role === 'assistant');
    expect(assistants).toHaveLength(2);
    expect(assistants[0]?.inputId).toBe('i1');
    expect(assistants[1]?.inputId).toBe('i2');
    expect(assistants[1]?.streaming).toBe(false);
  });

  it('a resync keeps a live-only completion that repeats and prefixes an older turn', () => {
    let slot = emptySlot();
    const older = [
      { entryId: 'u1', role: 'user', content: text('one'), inputId: 'i1' },
      { entryId: 'a1', role: 'assistant', content: text('done and more'), inputId: 'i1' },
    ];
    slot = slotReducer(slot, { type: 'snapshot', reason: 'initial', snapshot: snapshotOf(older) });
    // The stream joined at message_end: a new turn with the same opening words, no message_start.
    slot = slotReducer(slot, {
      type: 'frame',
      frame: { type: 'pi', seq: 30, inputId: 'i2', event: { type: 'message_end', message: { role: 'assistant', content: text('done') } } },
    });
    expect(slot.items.filter((entry) => entry.role === 'assistant')).toHaveLength(2);

    // The stale snapshot only knows the older turn. The new one must not be dropped as its twin.
    slot = slotReducer(slot, { type: 'snapshot', reason: 'resync', snapshot: snapshotOf(older) });
    const assistants = slot.items.filter((entry) => entry.role === 'assistant');
    expect(assistants).toHaveLength(2);
    expect(assistants[1]?.inputId).toBe('i2');
  });

  it('still dedupes the same turn when both sides carry the same input id', () => {
    let slot = emptySlot();
    slot = slotReducer(slot, {
      type: 'snapshot',
      reason: 'initial',
      snapshot: snapshotOf([
        { entryId: 'u1', role: 'user', content: text('one'), inputId: 'i1' },
        { entryId: 'a1', role: 'assistant', content: text('done'), inputId: 'i1' },
      ]),
    });
    slot = slotReducer(slot, {
      type: 'frame',
      frame: { type: 'pi', seq: 40, inputId: 'i1', event: { type: 'message_end', message: { role: 'assistant', content: text('done') } } },
    });
    expect(slot.items.filter((entry) => entry.role === 'assistant')).toHaveLength(1);
  });

  it('a replayed older end or delta cannot take over a newer streaming message', () => {
    let slot = emptySlot();
    slot = slotReducer(slot, {
      type: 'snapshot',
      reason: 'initial',
      snapshot: snapshotOf([
        { entryId: 'a1', role: 'assistant', content: text('old'), inputId: 'i1' },
      ]),
    });
    slot = slotReducer(slot, {
      type: 'frame',
      frame: { type: 'pi', seq: 50, inputId: 'i2', event: { type: 'message_start', message: { role: 'assistant', content: [] } } },
    });
    slot = slotReducer(slot, {
      type: 'frame',
      frame: { type: 'pi', seq: 51, inputId: 'i2', event: { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'new', contentIndex: 0 } } },
    });
    // Replayed from the old input's buffer: it must not touch the newer live message.
    slot = slotReducer(slot, {
      type: 'frame',
      frame: { type: 'pi', seq: 52, inputId: 'i1', event: { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'old', contentIndex: 0 } } },
    });
    slot = slotReducer(slot, {
      type: 'frame',
      frame: { type: 'pi', seq: 53, inputId: 'i1', event: { type: 'message_end', message: { role: 'assistant', content: text('old') } } },
    });

    const live = slot.items.find((entry) => entry.streaming === true);
    expect(live?.inputId).toBe('i2');
    expect(live?.content[0]).toMatchObject({ type: 'text', text: 'new' });

    // The real completion for i2 still replaces it with the finished message.
    slot = slotReducer(slot, {
      type: 'frame',
      frame: { type: 'pi', seq: 54, inputId: 'i2', event: { type: 'message_end', message: { role: 'assistant', content: text('new') } } },
    });
    const assistants = slot.items.filter((entry) => entry.role === 'assistant');
    expect(assistants).toHaveLength(2);
    expect(assistants[1]?.content[0]).toMatchObject({ type: 'text', text: 'new' });
    expect(assistants[1]?.streaming).toBe(false);
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
    slot = slotReducer(slot, { type: 'snapshot', reason: 'initial', snapshot: { sessionId: 's', projectId: 'p', roleId: 'chief', activity: 'queued', currentInputId: null, inputs: [{ inputId: 'i-1', kind: 'user', status: 'queued', revision: 1, errorCode: null, text: '排队内容', imageCount: 1 }, { inputId: 'i-2', kind: 'user', status: 'completed', revision: 1, errorCode: null }, { inputId: 'i-notice', kind: 'system_notice', status: 'queued', revision: 1, errorCode: null, text: 'internal' }], messages: [], interactions: [], historyLeaf: null, historyProblems: [] } });
    expect(slot.queuedInputs).toEqual([{ inputId: 'i-1', status: 'queued', text: '排队内容', imageCount: 1 }]);
    slot = slotReducer(slot, { type: 'inputQueued', inputId: 'i-3', content: [{ type: 'text', text: '新消息' }, { type: 'image', src: '/a' }] });
    expect(slot.queuedInputs.map((entry) => entry.inputId)).toEqual(['i-1', 'i-3']);
    expect(slot.queuedInputs[1]).toMatchObject({ text: '新消息', imageCount: 1 });
    slot = slotReducer(slot, { type: 'inputRemoved', inputId: 'i-1' });
    expect(slot.queuedInputs.map((entry) => entry.inputId)).toEqual(['i-3']);
  });

  it('removes the queue row when the input starts its turn', () => {
    const queued = slotReducer(emptySlot(), {
      type: 'inputQueued',
      inputId: 'i-turn',
      content: [{ type: 'text', text: '现在运行' }],
    });
    const started = slotReducer(queued, {
      type: 'frame',
      frame: { type: 'pi', inputId: 'i-turn', event: { type: 'turn_start' } },
    });
    expect(started.queuedInputs).toEqual([]);
    expect(started.busy).toBe('processing');
  });

  it('clears the current input and echo when a retained input is removed', () => {
    let slot = slotReducer(emptySlot(), {
      type: 'inputQueued',
      inputId: 'i-stop',
      content: [{ type: 'text', text: '停止我' }],
    });
    slot = slotReducer(slot, {
      type: 'inputAccepted',
      inputId: 'i-stop',
      content: [{ type: 'text', text: '停止我' }],
    });
    expect(slot.currentInputId).toBe('i-stop');
    expect(slot.pendingEcho?.inputId).toBe('i-stop');
    slot = slotReducer(slot, { type: 'inputRemoved', inputId: 'i-stop' });
    expect(slot.currentInputId).toBeNull();
    expect(slot.pendingEcho).toBeNull();
  });

  it('does not retarget STOP at a message queued behind the running input', () => {
    let slot = slotReducer(emptySlot(), {
      type: 'inputAccepted',
      inputId: 'i-running',
      content: [{ type: 'text', text: '正在运行' }],
    });
    slot = slotReducer(slot, { type: 'busy', activity: 'processing' });
    slot = slotReducer(slot, {
      type: 'inputAccepted',
      inputId: 'i-second',
      content: [{ type: 'text', text: '排队' }],
    });
    expect(slot.currentInputId).toBe('i-running');
    expect(slot.pendingEcho?.inputId).toBe('i-second');
    slot = slotReducer(slot, {
      type: 'inputQueued',
      inputId: 'i-second',
      content: [{ type: 'text', text: '排队' }],
    });
    slot = slotReducer(slot, { type: 'frame', frame: { type: 'pi', inputId: 'i-running', event: { type: 'agent_end' } } });
    expect(slot.currentInputId).toBeNull();
    expect(slot.busy).toBe('queued');
    slot = slotReducer(slot, {
      type: 'frame',
      frame: { type: 'pi', inputId: 'i-second', event: { type: 'turn_start' } },
    });
    expect(slot.currentInputId).toBe('i-second');
    expect(slot.queuedInputs).toEqual([]);
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
