/**
 * Image projection (U6): every path that hands a conversation to the browser goes through here, so
 * the browser never receives base64.
 *
 * Pi keeps images as `{type:'image', data, mimeType}` inside a message; that is what the model needs
 * and what the session file persists. The screen only needs an address: the bytes are already on
 * disk, content-addressed, so the block becomes `{type:'image', id, mimeType}` and the `<img>` reads
 * `/api/v1/attachments/<id>`.
 *
 * Three writers produce image blocks (a user input, a browser screenshot, a tool that read a file),
 * and all three end up in the same store. The projection is idempotent: a block that already carries
 * an id is left alone, so re-reading a projected snapshot cannot rewrite anything.
 */
import { storeBase64Image } from './attachments.ts';

export interface ProjectedImageBlock {
  readonly type: 'image';
  readonly id: string;
  readonly mimeType: string;
}

/** A block that cannot be stored still has to be visible as something: say so, never drop it silently. */
function omitted(reason: string): { readonly type: 'text'; readonly text: string } {
  return { type: 'text', text: `[image omitted: ${reason}]` };
}

/** Project one content block. Anything that is not an image passes through untouched. */
export function projectBlock(block: unknown, agentDir: string | undefined): unknown {
  if (typeof block !== 'object' || block === null) {
    return block;
  }
  const record = block as Record<string, unknown>;
  if (record['type'] !== 'image') {
    return block;
  }
  // Already projected (a snapshot built earlier in the same request): keep the address.
  const existing = record['id'];
  if (typeof existing === 'string' && existing !== '') {
    return { type: 'image', id: existing, mimeType: typeof record['mimeType'] === 'string' ? record['mimeType'] : '' };
  }
  if (agentDir === undefined) {
    return omitted('image storage is not configured');
  }
  const data = record['data'];
  if (typeof data !== 'string' || data === '') {
    return omitted('the image block has no bytes');
  }
  const stored = storeBase64Image(agentDir, data);
  if (stored === undefined) {
    return omitted('the image bytes could not be stored');
  }
  return { type: 'image', id: stored.id, mimeType: stored.mimeType };
}

/** Project a message's `content` (an array of blocks, or a plain string). */
export function projectContentImages(content: unknown, agentDir: string | undefined): unknown {
  if (!Array.isArray(content)) {
    return content;
  }
  return content.map((block) => projectBlock(block, agentDir));
}

/**
 * Project images anywhere inside a live Pi event. The event shapes differ (message_start carries a
 * message, message_end another, tool events carry results), and a new shape must not silently ship
 * base64, so the walk looks for image blocks wherever they are instead of naming each field.
 */
export function projectEventImages(event: unknown, agentDir: string | undefined, depth = 0): unknown {
  if (depth > 8 || typeof event !== 'object' || event === null) {
    return event;
  }
  if (Array.isArray(event)) {
    return event.map((item) => projectEventImages(item, agentDir, depth + 1));
  }
  const record = event as Record<string, unknown>;
  if (record['type'] === 'image' && typeof record['data'] === 'string') {
    return projectBlock(record, agentDir);
  }
  let changed = false;
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    const projected = projectEventImages(value, agentDir, depth + 1);
    next[key] = projected;
    if (projected !== value) changed = true;
  }
  return changed ? next : event;
}
