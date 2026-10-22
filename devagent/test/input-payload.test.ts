/**
 * Input payloads with images (U6): the stored payload keeps an attachment id, the title stays text,
 * and an image that was never uploaded is refused before it becomes a queued input.
 */
import { describe, expect, it } from 'vitest';
import { partsOfPayload, textOfPayload } from '../src/runtime/input-text.ts';

describe('payload parts', () => {
  it('reads text and image ids in order', () => {
    const payload = JSON.stringify({
      content: [
        { type: 'text', text: 'look at this' },
        { type: 'image', attachmentId: 'a'.repeat(32) },
        { type: 'image', attachmentId: 'b'.repeat(32) },
      ],
    });
    expect(partsOfPayload(payload)).toEqual({
      text: 'look at this',
      images: ['a'.repeat(32), 'b'.repeat(32)],
    });
    // The title path keeps working, and a message with images only has an empty title text.
    expect(textOfPayload(payload)).toBe('look at this');
    expect(textOfPayload(JSON.stringify({ content: [{ type: 'image', attachmentId: 'c'.repeat(32) }] }))).toBe('');
  });

  it('refuses a block it cannot deliver instead of dropping it', () => {
    expect(partsOfPayload(JSON.stringify({ content: [{ type: 'image' }] }))).toBeUndefined();
    expect(partsOfPayload(JSON.stringify({ content: [{ type: 'audio', data: 'x' }] }))).toBeUndefined();
    expect(partsOfPayload(JSON.stringify({ content: [{ type: 'text', text: 1 }] }))).toBeUndefined();
    expect(partsOfPayload('not json')).toBeUndefined();
    expect(partsOfPayload(JSON.stringify({ content: 'plain' }))).toBeUndefined();
  });

  it('keeps every text block, joined in order', () => {
    const payload = JSON.stringify({ content: [{ type: 'text', text: 'one' }, { type: 'text', text: 'two' }] });
    expect(partsOfPayload(payload)).toEqual({ text: 'one\ntwo', images: [] });
  });
});
