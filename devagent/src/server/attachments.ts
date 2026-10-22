/**
 * Attachments (U6): the only image storage this product has. There is no cloud service, so bytes
 * live on disk, addressed by their own digest:
 *
 *   <agentDir>/attachments/<sha256[:32]>
 *
 * Content addressing is what makes the three writers agree without a database row: the upload
 * route, a Pi image block read back from a session file, and a browser screenshot all name the same
 * bytes with the same id. Writing twice is a no-op, and a message can never point at a file that the
 * same bytes did not produce.
 *
 * Only images are accepted here. The id comes from the bytes, never from the client, so a request
 * cannot choose a path.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** One image's ceiling. Large enough for a full-resolution screenshot, small enough to stay a message. */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
/** How many images one user input may carry. */
export const MAX_IMAGES_PER_INPUT = 6;

export type ImageMimeType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';

export const IMAGE_MIME_TYPES: readonly ImageMimeType[] = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
];

export interface StoredImage {
  readonly id: string;
  readonly mimeType: ImageMimeType;
  readonly bytes: number;
}

export type StoreImageResult =
  | { readonly ok: true; readonly image: StoredImage }
  | { readonly ok: false; readonly code: 'INVALID_ARGUMENT' | 'TOO_LARGE'; readonly message: string };

const ID_PATTERN = /^[0-9a-f]{32}$/;

export function attachmentsDir(agentDir: string): string {
  return join(agentDir, 'attachments');
}

/** The id is the first 128 bits of the digest: collision-free in practice, short enough to quote. */
export function imageIdOf(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 32);
}

/**
 * Identify the format from the bytes, not from a declared type: a client cannot label HTML as an
 * image and have the server believe it.
 */
export function sniffImageMime(bytes: Uint8Array): ImageMimeType | undefined {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
    return 'image/gif';
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  return undefined;
}

/** Persist bytes and return the id every reader will use. Idempotent. */
export function storeImage(agentDir: string, bytes: Uint8Array): StoreImageResult {
  if (bytes.length === 0) {
    return { ok: false, code: 'INVALID_ARGUMENT', message: 'the image is empty' };
  }
  if (bytes.length > MAX_IMAGE_BYTES) {
    return { ok: false, code: 'TOO_LARGE', message: `the image is larger than ${MAX_IMAGE_BYTES} bytes` };
  }
  const mimeType = sniffImageMime(bytes);
  if (mimeType === undefined) {
    return { ok: false, code: 'INVALID_ARGUMENT', message: 'only png, jpeg, webp or gif images are accepted' };
  }
  const id = imageIdOf(bytes);
  const dir = attachmentsDir(agentDir);
  const path = join(dir, id);
  if (!existsSync(path)) {
    mkdirSync(dir, { recursive: true });
    // A concurrent writer (two projections of the same image) may create it first; the temp name is
    // per process and per call, so the rename stays atomic and the last writer wins with equal bytes.
    const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(temp, bytes);
    renameSync(temp, path);
  }
  return { ok: true, image: { id, mimeType, bytes: bytes.length } };
}

export function imagePath(agentDir: string, id: string): string | undefined {
  if (!ID_PATTERN.test(id)) return undefined;
  return join(attachmentsDir(agentDir), id);
}

export function readImage(agentDir: string, id: string): { readonly mimeType: ImageMimeType; readonly bytes: Buffer } | undefined {
  const path = imagePath(agentDir, id);
  if (path === undefined || !existsSync(path)) return undefined;
  const bytes = readFileSync(path);
  const mimeType = sniffImageMime(bytes);
  if (mimeType === undefined) return undefined;
  return { mimeType, bytes };
}

/** Store bytes that arrived as base64 inside a session file; returns the id or undefined. */
export function storeBase64Image(agentDir: string, data: string): { readonly id: string; readonly mimeType: ImageMimeType } | undefined {
  let bytes: Buffer;
  try {
    bytes = Buffer.from(data, 'base64');
  } catch {
    return undefined;
  }
  if (bytes.length === 0) return undefined;
  const stored = storeImage(agentDir, bytes);
  if (!stored.ok) return undefined;
  return { id: stored.image.id, mimeType: stored.image.mimeType };
}
