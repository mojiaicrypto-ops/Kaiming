import { describe, expect, it } from 'vitest';
import { normalizeBlock, normalizePiMessage } from '../src/state/normalize';

describe('normalize boundary · the three Pi channels', () => {
  it('snapshot file shape: toolCall.arguments object becomes a string', () => {
    const block = normalizeBlock({ type: 'toolCall', id: 'c1', name: 'ls', arguments: { path: '.' } });
    expect(block).toEqual({ type: 'toolCall', id: 'c1', name: 'ls', arguments: '{"path":"."}' });
  });

  it('message_start/end shapes: same object normalization as the snapshot', () => {
    const message = normalizePiMessage(
      { role: 'assistant', content: [{ type: 'toolCall', id: 'c2', name: 'read', arguments: { path: 'x' } }] },
      { entryId: 'live-1', streaming: false, inputId: 'i1' },
    );
    expect(message.content[0]).toEqual({ type: 'toolCall', id: 'c2', name: 'read', arguments: '{"path":"x"}' });
    expect(message.role).toBe('assistant');
  });

  it('non-assistant roles and malformed content fall back safely', () => {
    expect(normalizePiMessage({ role: 'user', content: 'plain string' }, { entryId: 'u', streaming: false }).content)
      .toEqual([{ type: 'text', text: 'plain string' }]);
    expect(normalizeBlock(null)).toEqual({ type: 'text', text: '' });
    expect(normalizeBlock(42)).toEqual({ type: 'text', text: '42' });
    const toolResult = normalizePiMessage({ role: 'toolResult', content: [{ type: 'text', text: 'out' }] }, { entryId: 't', streaming: false });
    expect(toolResult.role).toBe('toolResult');
  });
});
