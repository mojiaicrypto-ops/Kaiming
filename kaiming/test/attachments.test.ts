/**
 * Attachments and image projection (U6): the bytes are stored once, named by their digest, and every
 * reader (upload, history, live event) reaches the same id. No base64 ever leaves the server.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  MAX_IMAGE_BYTES,
  imageIdOf,
  imagePath,
  readImage,
  sniffImageMime,
  storeBase64Image,
  storeImage,
} from '../src/server/attachments.ts';
import { projectBlock, projectContentImages, projectEventImages } from '../src/server/image-projection.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function agentDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'kaiming-attach-'));
  dirs.push(dir);
  return dir;
}

/** A 1×1 PNG: the smallest real image, so the sniffer sees real magic bytes. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

describe('attachment store', () => {
  it('names bytes by their digest and returns the same id for the same bytes', () => {
    const dir = agentDir();
    const first = storeImage(dir, PNG);
    const second = storeImage(dir, PNG);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.image.id).toBe(imageIdOf(PNG));
    expect(second.image.id).toBe(first.image.id);
    expect(first.image.mimeType).toBe('image/png');
    const stored = readImage(dir, first.image.id);
    expect(stored?.mimeType).toBe('image/png');
    expect(stored?.bytes.equals(PNG)).toBe(true);
  });

  it('refuses a non-image and an oversized body, and never writes a path the caller chose', () => {
    const dir = agentDir();
    expect(storeImage(dir, Buffer.from('<html>not an image</html>')).ok).toBe(false);
    expect(storeImage(dir, Buffer.alloc(0)).ok).toBe(false);
    const big = Buffer.concat([PNG, Buffer.alloc(MAX_IMAGE_BYTES)]);
    const tooBig = storeImage(dir, big);
    expect(tooBig.ok).toBe(false);
    if (!tooBig.ok) expect(tooBig.code).toBe('TOO_LARGE');
    // An id is a digest, so a traversal attempt simply is not an id.
    expect(imagePath(dir, '../../etc/passwd')).toBeUndefined();
    expect(readImage(dir, '../../etc/passwd')).toBeUndefined();
  });

  it('recognises jpeg, gif and webp by their magic bytes', () => {
    expect(sniffImageMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffImageMime(Buffer.from('GIF89a', 'latin1'))).toBe('image/gif');
    const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')]);
    expect(sniffImageMime(webp)).toBe('image/webp');
    expect(sniffImageMime(Buffer.from('plain text'))).toBeUndefined();
  });

  it('stores base64 exactly like the bytes it decodes to', () => {
    const dir = agentDir();
    const stored = storeBase64Image(dir, PNG.toString('base64'));
    expect(stored?.id).toBe(imageIdOf(PNG));
    expect(readFileSync(join(dir, 'attachments', stored?.id ?? '')).equals(PNG)).toBe(true);
  });

  it('writes only one file for repeated stores', () => {
    const dir = agentDir();
    const first = storeImage(dir, PNG);
    if (!first.ok) throw new Error('store failed');
    // A second write of the same bytes must not create a second name.
    storeImage(dir, PNG);
    const path = imagePath(dir, first.image.id);
    expect(path).toBeDefined();
    expect(readFileSync(path ?? '').byteLength).toBe(PNG.byteLength);
    writeFileSync(`${path ?? ''}.unrelated`, 'x');
    expect(readImage(dir, first.image.id)?.bytes.equals(PNG)).toBe(true);
  });
});

describe('image projection', () => {
  it('replaces base64 with an attachment id, idempotently', () => {
    const dir = agentDir();
    const projected = projectBlock({ type: 'image', data: PNG.toString('base64'), mimeType: 'image/png' }, dir);
    expect(projected).toEqual({ type: 'image', id: imageIdOf(PNG), mimeType: 'image/png' });
    // A second pass over an already projected block keeps the address and writes nothing new.
    expect(projectBlock(projected, dir)).toEqual(projected);
  });

  it('says so instead of dropping an image it cannot store', () => {
    expect(projectContentImages([{ type: 'image', data: 'AAAA' }], undefined)).toEqual([
      { type: 'text', text: '[image omitted: image storage is not configured]' },
    ]);
    const dir = agentDir();
    expect(projectContentImages([{ type: 'image', data: 'bm90IGFuIGltYWdl' }], dir)).toEqual([
      { type: 'text', text: '[image omitted: the image bytes could not be stored]' },
    ]);
  });

  it('leaves text and tool-call blocks untouched', () => {
    const content = [
      { type: 'text', text: 'hello' },
      { type: 'toolCall', id: 'c1', name: 'read', arguments: { path: 'a.ts' } },
    ];
    expect(projectContentImages(content, undefined)).toEqual(content);
  });

  it('projects images anywhere inside a live event', () => {
    const dir = agentDir();
    const event = {
      type: 'message_end',
      message: { role: 'user', content: [{ type: 'text', text: 'look' }, { type: 'image', data: PNG.toString('base64'), mimeType: 'image/png' }] },
    };
    const projected = projectEventImages(event, dir) as typeof event;
    expect(projected.message.content[1]).toEqual({ type: 'image', id: imageIdOf(PNG), mimeType: 'image/png' });
    // Nothing else changes.
    expect(projected.type).toBe(event.type);
    expect(projected.message.content[0]).toEqual({ type: 'text', text: 'look' });
  });

  it('walks arrays and nested tool results', () => {
    const dir = agentDir();
    const event = {
      type: 'agent_end',
      messages: [
        { role: 'toolResult', content: [{ type: 'image', data: PNG.toString('base64'), mimeType: 'image/png' }] },
      ],
    };
    const projected = projectEventImages(event, dir) as { messages: Array<{ content: unknown[] }> };
    expect(projected.messages[0]?.content[0]).toEqual({ type: 'image', id: imageIdOf(PNG), mimeType: 'image/png' });
  });
});
