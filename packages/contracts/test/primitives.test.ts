import { describe, expect, it } from 'vitest';
import {
  ABSENT_VERSION,
  MAX_ARRAY_ITEMS,
  emptyScope,
  environmentRefSchema,
  featureIdSchema,
  gitRevisionSchema,
  hashSchema,
  idSchema,
  projectIdSchema,
  refSchema,
  repoPathSchema,
  scopeSchema,
  sourceRefSchema,
  timeSchema,
  versionSchema,
} from '../src/index.js';

const VALID_ID = '018f3f2a-1c4d-7b2e-8a3f-0d1e2f3a4b5c';
const VALID_HASH = 'a'.repeat(64);

describe('identifiers', () => {
  it('accepts lowercase UUIDv7 and rejects other UUID versions or casing', () => {
    expect(idSchema.safeParse(VALID_ID).success).toBe(true);
    expect(idSchema.safeParse('018f3f2a-1c4d-4b2e-8a3f-0d1e2f3a4b5c').success).toBe(false);
    expect(idSchema.safeParse(VALID_ID.toUpperCase()).success).toBe(false);
    expect(idSchema.safeParse('not-an-id').success).toBe(false);
  });

  it('accepts F- plus eight hex digits for features', () => {
    expect(featureIdSchema.safeParse('F-a1b2c3d4').success).toBe(true);
    expect(featureIdSchema.safeParse('F-A1B2C3D4').success).toBe(false);
    expect(featureIdSchema.safeParse('F-a1b2c3d').success).toBe(false);
    expect(featureIdSchema.safeParse('a1b2c3d4').success).toBe(false);
  });

  it('requires 32 hex digits for project ids', () => {
    expect(projectIdSchema.safeParse('0'.repeat(32)).success).toBe(true);
    expect(projectIdSchema.safeParse('0'.repeat(31)).success).toBe(false);
    expect(projectIdSchema.safeParse('0'.repeat(33)).success).toBe(false);
  });

  it('requires lowercase 64 hex digits for hashes', () => {
    expect(hashSchema.safeParse(VALID_HASH).success).toBe(true);
    expect(hashSchema.safeParse('A'.repeat(64)).success).toBe(false);
    expect(hashSchema.safeParse('a'.repeat(63)).success).toBe(false);
  });

  it('accepts sha1 and sha256 git revisions only', () => {
    expect(gitRevisionSchema.safeParse('b'.repeat(40)).success).toBe(true);
    expect(gitRevisionSchema.safeParse('b'.repeat(64)).success).toBe(true);
    expect(gitRevisionSchema.safeParse('b'.repeat(41)).success).toBe(false);
    expect(gitRevisionSchema.safeParse('b'.repeat(39)).success).toBe(false);
  });

  it('requires UTC ISO8601 with millisecond precision', () => {
    expect(timeSchema.safeParse('2026-09-11T00:00:00.000Z').success).toBe(true);
    expect(timeSchema.safeParse('2026-09-11T00:00:00Z').success).toBe(false);
    expect(timeSchema.safeParse('2026-09-11T07:00:00.000+07:00').success).toBe(false);
  });

  it('treats a version as a positive integer and 0 as "absent"', () => {
    expect(versionSchema.safeParse(1).success).toBe(true);
    expect(versionSchema.safeParse(0).success).toBe(false);
    expect(versionSchema.safeParse(1.5).success).toBe(false);
    expect(ABSENT_VERSION).toBe(0);
  });
});

describe('repository paths', () => {
  it('accepts repository-relative POSIX paths', () => {
    for (const value of ['docs/INDEX.md', 'a', 'src/orders/cancel.ts']) {
      expect(repoPathSchema.safeParse(value).success, value).toBe(true);
    }
  });

  it('rejects escapes, absolute paths, drive paths and malformed segments', () => {
    for (const value of [
      '',
      '/etc/passwd',
      'C:/windows',
      '../secret',
      'a/../../b',
      'a\\b',
      'a//b',
      'trailing/',
      'nul\0byte',
    ]) {
      expect(repoPathSchema.safeParse(value).success, value).toBe(false);
    }
  });
});

describe('refs and scopes', () => {
  it('requires id, version and hash on a Ref', () => {
    expect(refSchema.safeParse({ id: VALID_ID, version: 2, hash: VALID_HASH }).success).toBe(true);
    expect(refSchema.safeParse({ id: VALID_ID, version: 2 }).success).toBe(false);
    expect(
      refSchema.safeParse({ id: VALID_ID, version: 2, hash: VALID_HASH, extra: 1 }).success,
    ).toBe(false);
  });

  it('binds a SourceRef to a declared kind', () => {
    expect(
      sourceRefSchema.safeParse({ kind: 'git', id: 'b'.repeat(40), version: 'b'.repeat(40) })
        .success,
    ).toBe(true);
    expect(sourceRefSchema.safeParse({ kind: 'chat', id: 'x', version: '1' }).success).toBe(false);
  });

  it('rejects undeclared tool operations in a scope', () => {
    const scope = emptyScope();
    expect(scopeSchema.safeParse(scope).success).toBe(true);
    expect(scopeSchema.safeParse({ ...scope, operations: ['read', 'sudo'] }).success).toBe(false);
  });

  it('bounds array payloads', () => {
    const tooMany = Array.from({ length: MAX_ARRAY_ITEMS + 1 }, () => 'a.md');
    expect(scopeSchema.safeParse(emptyScope()).success).toBe(true);
    expect(scopeSchema.safeParse({ ...emptyScope(), readPaths: tooMany }).success).toBe(false);
  });

  it('accepts an execution environment descriptor, not only an id (W8-1)', () => {
    // The descriptor the Runner reports in `attempt.ready`; the check and the manifest
    // both bind it verbatim (`data.md` §3 `Env`).
    expect(environmentRefSchema.safeParse('host:darwin/arm64/node-24').success).toBe(true);
    expect(environmentRefSchema.safeParse('container:agentdev/exec:0.0.0').success).toBe(true);
    expect(environmentRefSchema.safeParse('container:undeclared').success).toBe(true);
    // The library-level fixtures that still use an id keep parsing...
    expect(environmentRefSchema.safeParse(VALID_ID).success).toBe(true);
    // ...but an empty environment is never a valid descriptor.
    expect(environmentRefSchema.safeParse('').success).toBe(false);
  });
});
