/**
 * Identifier, hash and clock primitives.
 *
 * `data.md` §1 fixes the forms: UUIDv7 for entity ids, SHA256 lowercase hex for
 * hashes, UTC ISO8601 with millisecond precision for times. Generation lives
 * here (not in `contracts`) because validation and generation are different
 * concerns: `contracts` must stay free of Node built-ins.
 */
import { createHash, randomBytes } from 'node:crypto';

/** Encodes the 48-bit millisecond timestamp plus random bits as UUIDv7. */
export function uuidv7(now: number = Date.now()): string {
  const bytes = randomBytes(16);
  // 48-bit big-endian timestamp.
  bytes[0] = Math.floor(now / 2 ** 40) & 0xff;
  bytes[1] = Math.floor(now / 2 ** 32) & 0xff;
  bytes[2] = Math.floor(now / 2 ** 24) & 0xff;
  bytes[3] = Math.floor(now / 2 ** 16) & 0xff;
  bytes[4] = Math.floor(now / 2 ** 8) & 0xff;
  bytes[5] = now & 0xff;
  // Version 7, variant 10xx.
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

/** Lowercase SHA256 of UTF-8 bytes. */
export function sha256(input: string | Uint8Array): string {
  return createHash('sha256').update(input).digest('hex');
}

/** Current time in the contract's UTC millisecond form. */
export function nowIso(now: number = Date.now()): string {
  return new Date(now).toISOString();
}

/** Parses the contract time form back to epoch milliseconds. */
export function parseIso(value: string): number {
  return Date.parse(value);
}

/** Monotonic-ish comparison helper for ISO timestamps. */
export function isAfter(left: string, right: string): boolean {
  return parseIso(left) > parseIso(right);
}

/**
 * The requirement record hash (`requirements.md` §6): SHA256 over
 * `requirement.json\0<metadataHash>\ncontent.md\0<contentHash>\n`.
 */
export function requirementRecordHash(metadataHash: string, contentHash: string): string {
  return sha256(`requirement.json\u0000${metadataHash}\ncontent.md\u0000${contentHash}\n`);
}

/** Project id = first 32 hex digits of SHA256(canonicalRoot) (`ARCHITECTURE.md` §4). */
export function projectIdFromRoot(canonicalRoot: string): string {
  return sha256(canonicalRoot).slice(0, 32);
}
