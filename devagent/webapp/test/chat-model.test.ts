import { describe, expect, it } from 'vitest';
import { argSummary, blocksOf, indexToolResults, parseArgs, streamedField } from '../src/chat/transcript-model';
import { echoOf, responseFor, rowsFor } from '../src/chat/interaction-model';
import type { HistoryMessage } from '../src/state/slot';

/** A tool result must pair with its own call, or a card shows another call's answer (R4). */
describe('tool result pairing', () => {
  const call = (id: string, name = 'read'): HistoryMessage => ({
    entryId: `a-${id}`,
    role: 'assistant',
    content: [{ type: 'toolCall', id, name, arguments: '{"path":"x"}' }],
  });
  const result = (toolCallId: string | undefined, text: string, isError = false): HistoryMessage => ({
    entryId: `r-${toolCallId ?? 'none'}`,
    role: 'toolResult',
    content: [{ type: 'text', text }],
    ...(toolCallId === undefined ? {} : { toolCallId }),
    ...(isError ? { isError: true } : {}),
  });

  it('pairs by call id, including the error flag', () => {
    const index = indexToolResults([call('c1'), result('c1', 'ok'), call('c2'), result('c2', 'boom', true)]);
    expect(index.get('c1')).toEqual({ text: 'ok', failed: false });
    expect(index.get('c2')).toEqual({ text: 'boom', failed: true });
  });

  it('does not attach an id-less result to any call', () => {
    const index = indexToolResults([call('c1'), result(undefined, 'stray')]);
    expect(index.size).toBe(0);
  });

  it('keeps thinking, text and calls in order', () => {
    const blocks = blocksOf({
      entryId: 'e',
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'hmm' },
        { type: 'text', text: 'answer' },
        { type: 'toolCall', id: 'c1', name: 'task', arguments: '{}' },
      ],
    });
    expect(blocks.map((block) => block.kind)).toEqual(['thinking', 'text', 'tool']);
  });
});

describe('argument reading while streaming', () => {
  it('parses complete JSON and refuses partial JSON', () => {
    expect(parseArgs('{"op":"create"}')).toEqual({ op: 'create' });
    expect(parseArgs('{"op":"cre')).toBeNull();
    expect(parseArgs('')).toBeNull();
  });

  it('reads a field from an incomplete argument string', () => {
    expect(streamedField('{"path":"src/a.ts","line":3}', 'path')).toBe('src/a.ts');
    expect(streamedField('{"path":"src/a.ts','path')).toBe('src/a.ts');
    expect(streamedField('{"path":"src/a.ts"}', 'missing')).toBe('');
  });

  it('summarises a call by the argument that says what it acts on', () => {
    expect(argSummary('read', { path: 'src/a.ts' }, '')).toBe('src/a.ts');
    expect(argSummary('task', { op: 'dispatch', taskId: 't-1' }, '')).toBe('dispatch t-1');
    expect(argSummary('custom', null, '{"command":"ls -la"}')).toBe('ls -la');
  });
});

describe('interaction answers', () => {
  it('sends the shape each method expects', () => {
    expect(responseFor('confirm', true)).toEqual({ confirmed: true });
    expect(responseFor('confirm', false)).toEqual({ confirmed: false });
    expect(responseFor('select', '加入')).toEqual({ value: '加入' });
    expect(responseFor('input', 'text')).toEqual({ value: 'text' });
  });

  it('offers the options plus the escape hatch for a selection', () => {
    const rows = rowsFor({
      interactionId: 'i1',
      method: 'select',
      title: 't',
      message: null,
      options: ['a', 'b'],
      placeholder: null,
      inputId: null,
      taskId: null,
      revision: 1,
      createdAt: '',
    });
    expect(rows.map((row) => row.label)).toEqual(['a', 'b', 'other']);
    expect(rows[2]?.input).toBe(true);
  });

  it('echoes what the user actually chose', () => {
    expect(echoOf({ value: '加入' })).toBe('加入');
    expect(echoOf({ confirmed: true })).toBe('yes');
    expect(echoOf({ confirmed: false })).toBe('no');
  });
});
