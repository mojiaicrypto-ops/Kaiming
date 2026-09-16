/**
 * Durable secret repository tests (WP-12 T1.1, fix round 2).
 *
 * `docs/architecture/execution.md` §4 fixes the two backends: "Store在macOS使用Keychain，
 * Linux使用0600加密文件，密钥由安装时生成的0600独立主密钥文件或系统credential提供".
 * These cover both behind the injected `security` command runner, so no test ever touches
 * the real Keychain or a real macOS credential.
 *
 * Fix round 2 adds the properties the independent Review flagged: the backends are
 * namespaced on disk (W12T1-01/02), reading is per-record tolerant and never throws, an
 * oversized ref is refused before any write (W12T1-03), and a missing master key is never
 * regenerated while records exist (W12T1-04). Symlink and mode handling are covered too.
 */
import { createHash } from 'node:crypto';
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  KEYCHAIN_SERVICE,
  SECRET_BACKEND_ENV,
  SECURITY_BINARY,
  SecretRepositoryError,
  SecretStore,
  createSecretRepository,
  loadSecretsIntoStore,
  resolveSecretBackend,
  secretEnvName,
  secretRepositoryPaths,
  type SecretCommandRunner,
  type SecretRepository,
} from '../src/index.js';

/** A value that must never appear in metadata, a log line or a record file. */
const DECOY = 'sk-live-decoy-0123456789ABCDEF';

let home: string;
/** A monotonic clock, so `updatedAt` is deterministic and rotation is observable. */
let tick: number;
const now = (): Date => new Date(1_700_000_000_000 + tick++);

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'agentdev-secret-repo-'));
  tick = 0;
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

function fileRepository(): SecretRepository {
  return createSecretRepository({ home, backend: 'file', now });
}

/** The on-disk name of one file-backend record. */
function recordName(ref: string): string {
  return `${createHash('sha256').update(ref, 'utf8').digest('hex')}.json`;
}

describe('file backend (0600 AES-256-GCM)', () => {
  it('round-trips one secret and lists metadata only', () => {
    const repository = fileRepository();
    const summary = repository.set('provider/main', DECOY, { audience: 'gateway' });

    expect(summary).toEqual({
      ref: 'provider/main',
      configured: true,
      updatedAt: new Date(1_700_000_000_000).toISOString(),
      backend: 'file',
      health: 'ok',
    });
    expect(repository.backend).toBe('file');

    const stored = repository.get('provider/main');
    expect(stored?.value).toBe(DECOY);
    expect(stored?.metadata).toEqual({ audience: 'gateway' });
    expect(stored?.backend).toBe('file');

    const items = repository.list();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ ref: 'provider/main', configured: true, health: 'ok' });
    expect(repository.problems()).toEqual([]);
    // The query surface and the repository object never carry the value.
    expect(JSON.stringify(items)).not.toContain(DECOY);
    expect(JSON.stringify(repository)).not.toContain(DECOY);
  });

  it('rotates a ref in place and keeps only the newest value', () => {
    const repository = fileRepository();
    repository.set('provider/main', 'first-value', { audience: 'gateway' });
    const first = repository.get('provider/main');
    const second = repository.set('provider/main', 'second-value', { audience: 'gateway' });

    expect(repository.get('provider/main')?.value).toBe('second-value');
    expect(repository.list()).toHaveLength(1);
    expect(second.updatedAt).not.toBe(first?.updatedAt);
  });

  it('deletes a ref and reports whether it existed', () => {
    const repository = fileRepository();
    repository.set('tool/token', DECOY, { audience: 'tool' });
    expect(repository.delete('tool/token')).toBe(true);
    expect(repository.delete('tool/token')).toBe(false);
    expect(repository.get('tool/token')).toBeNull();
    expect(repository.list()).toEqual([]);
  });

  it('persists the registration metadata for a tool secret', () => {
    const repository = fileRepository();
    repository.set('tool/token', DECOY, {
      audience: 'tool',
      envName: 'MY_TOKEN',
      roles: ['backend'],
    });
    const stored = repository.get('tool/token');
    expect(stored?.metadata).toEqual({
      audience: 'tool',
      envName: 'MY_TOKEN',
      roles: ['backend'],
    });
    expect(secretEnvName('tool/token')).toBe('AGENTDEV_SECRET_TOOL_TOKEN');
  });

  it('writes the master key and every record 0600 inside 0700 directories', () => {
    const repository = fileRepository();
    repository.set('provider/main', DECOY, { audience: 'gateway' });
    const paths = secretRepositoryPaths(home);

    expect(statSync(paths.dir).mode & 0o777).toBe(0o700);
    expect(statSync(paths.fileDir).mode & 0o777).toBe(0o700);
    expect(statSync(paths.masterKey).mode & 0o777).toBe(0o600);
    expect(statSync(join(paths.fileDir, recordName('provider/main'))).mode & 0o777).toBe(0o600);
  });

  it('repairs a too-permissive record mode on read instead of failing (P3)', () => {
    const repository = fileRepository();
    repository.set('provider/main', DECOY, { audience: 'gateway' });
    const record = join(secretRepositoryPaths(home).fileDir, recordName('provider/main'));
    chmodSync(record, 0o644);

    expect(repository.get('provider/main')?.value).toBe(DECOY);
    expect(statSync(record).mode & 0o777).toBe(0o600);
  });

  it('refuses to read a record that is a symlink (P3)', () => {
    const repository = fileRepository();
    repository.set('provider/main', DECOY, { audience: 'gateway' });
    const paths = secretRepositoryPaths(home);
    const record = join(paths.fileDir, recordName('provider/main'));
    const target = join(home, 'elsewhere.json');
    writeFileSync(target, readFileSync(record, 'utf8'));
    rmSync(record, { force: true });
    symlinkSync(target, record);

    try {
      repository.get('provider/main');
      throw new Error('expected the read to fail');
    } catch (error) {
      expect((error as SecretRepositoryError).code).toBe('SECRET_RECORD_INVALID');
    }
    expect(repository.list()).toEqual([]);
    expect(repository.problems()).toHaveLength(1);
    // Deleting it is refused too, rather than removing something this backend did not
    // create (R2-02).
    try {
      repository.delete('provider/main');
      throw new Error('expected the delete to fail');
    } catch (error) {
      expect((error as SecretRepositoryError).code).toBe('SECRET_RECORD_INVALID');
      expect((error as Error).message).toContain(record);
    }
  });

  it('reports the three delete outcomes with typed errors (R2-02)', () => {
    const repository = fileRepository();
    // 1. No record at all: an honest `false`, never an error.
    expect(repository.delete('provider/absent')).toBe(false);

    // 2. A directory where the record belongs: typed refusal naming path and reason,
    //    instead of the raw `ERR_FS_EISDIR` that used to become a 500.
    const paths = secretRepositoryPaths(home);
    const directory = join(paths.fileDir, recordName('provider/dir'));
    mkdirSync(directory, { recursive: true });
    try {
      repository.delete('provider/dir');
      throw new Error('expected the delete to fail');
    } catch (error) {
      expect((error as SecretRepositoryError).code).toBe('SECRET_RECORD_INVALID');
      expect((error as Error).message).toContain(directory);
      expect((error as Error).message).toContain('directory');
    }
    expect(statSync(directory).isDirectory()).toBe(true);

    // 3. A symlink where the record belongs: typed refusal, link left untouched.
    const link = join(paths.fileDir, recordName('provider/link'));
    symlinkSync(join(home, 'missing-target.json'), link);
    try {
      repository.delete('provider/link');
      throw new Error('expected the delete to fail');
    } catch (error) {
      expect((error as SecretRepositoryError).code).toBe('SECRET_RECORD_INVALID');
      expect((error as Error).message).toContain(link);
    }
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
  });

  it('never writes the value into the record bytes', () => {
    const repository = fileRepository();
    repository.set('provider/main', DECOY, { audience: 'gateway' });
    const bytes = readFileSync(
      join(secretRepositoryPaths(home).fileDir, recordName('provider/main')),
      'utf8',
    );
    expect(bytes).not.toContain(DECOY);
    // The header is plaintext metadata, which is what `list()` may return.
    expect(bytes).toContain('provider/main');
    expect(bytes).toContain('aes-256-gcm');
  });

  it('fails loudly when the master key changed (wrong key)', () => {
    const repository = fileRepository();
    repository.set('provider/main', DECOY, { audience: 'gateway' });
    const paths = secretRepositoryPaths(home);
    writeFileSync(paths.masterKey, `${Buffer.alloc(32, 7).toString('base64')}\n`, {
      mode: 0o600,
    });

    try {
      repository.get('provider/main');
      throw new Error('expected the read to fail');
    } catch (error) {
      expect((error as SecretRepositoryError).code).toBe('SECRET_DECRYPT_FAILED');
    }
    // The record is still listed, but honestly as unreadable (W12T1-01/03).
    const items = repository.list();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      ref: 'provider/main',
      configured: false,
      health: 'unreadable',
      issue: { code: 'SECRET_DECRYPT_FAILED' },
    });
    expect(JSON.stringify(items)).not.toContain(DECOY);
  });

  it('fails loudly when the master key is absent', () => {
    const repository = fileRepository();
    repository.set('provider/main', DECOY, { audience: 'gateway' });
    rmSync(secretRepositoryPaths(home).masterKey, { force: true });

    try {
      repository.get('provider/main');
      throw new Error('expected the read to fail');
    } catch (error) {
      expect((error as SecretRepositoryError).code).toBe('SECRET_MASTER_KEY_MISSING');
    }
  });

  it('fails loudly when the master key file is corrupt', () => {
    const repository = fileRepository();
    repository.set('provider/main', DECOY, { audience: 'gateway' });
    writeFileSync(secretRepositoryPaths(home).masterKey, 'not-a-key\n', { mode: 0o600 });

    try {
      repository.get('provider/main');
      throw new Error('expected the read to fail');
    } catch (error) {
      expect((error as SecretRepositoryError).code).toBe('SECRET_MASTER_KEY_INVALID');
    }
  });

  it('rejects an unusable ref or value before writing anything', () => {
    const repository = fileRepository();
    expect(() => repository.set('bad ref', DECOY)).toThrowError(SecretRepositoryError);
    expect(() => repository.set('provider/main', '')).toThrowError(SecretRepositoryError);
    expect(() => repository.set('provider/main', 'a\0b')).toThrowError(SecretRepositoryError);
    expect(repository.list()).toEqual([]);
  });

  it('rejects a ref whose derived env name would not fit, before writing (W12T1-03)', () => {
    const repository = fileRepository();
    // `AGENTDEV_SECRET_` is 16 characters, so 112 more fits exactly in 128.
    const longest = 'a'.repeat(112);
    const tooLong = 'a'.repeat(113);
    expect(secretEnvName(longest).length).toBe(128);
    expect(secretEnvName(tooLong).length).toBe(129);

    expect(repository.set(longest, DECOY, { audience: 'gateway' }).configured).toBe(true);
    try {
      repository.set(tooLong, DECOY, { audience: 'gateway' });
      throw new Error('expected the write to fail');
    } catch (error) {
      expect((error as SecretRepositoryError).code).toBe('SECRET_VALUE_INVALID');
    }
    // No partial side effect: only the accepted ref exists on disk.
    expect(repository.list().map((entry) => entry.ref)).toEqual([longest]);
    expect(readdirSync(secretRepositoryPaths(home).fileDir)).toEqual([recordName(longest)]);
  });

  it('never regenerates a missing master key while records exist (W12T1-04)', () => {
    const repository = fileRepository();
    repository.set('provider/main', DECOY, { audience: 'gateway' });
    const paths = secretRepositoryPaths(home);
    rmSync(paths.masterKey, { force: true });

    try {
      repository.set('provider/other', 'another', { audience: 'gateway' });
      throw new Error('expected the write to fail');
    } catch (error) {
      expect((error as SecretRepositoryError).code).toBe('SECRET_MASTER_KEY_MISSING');
      expect((error as Error).message).toContain(paths.masterKey);
    }
    // The refused write left no new record and no new key behind.
    expect(readdirSync(paths.fileDir)).toEqual([recordName('provider/main')]);
    expect(() => statSync(paths.masterKey)).toThrow();
    // The pre-existing record is still there, listed as unreadable.
    expect(repository.list()[0]).toMatchObject({ ref: 'provider/main', health: 'unreadable' });
  });

  it('creates the master key for a fresh store', () => {
    const repository = fileRepository();
    const paths = secretRepositoryPaths(home);
    expect(repository.set('provider/main', DECOY, { audience: 'gateway' }).configured).toBe(true);
    expect(statSync(paths.masterKey).mode & 0o777).toBe(0o600);
    expect(repository.get('provider/main')?.value).toBe(DECOY);
  });
});

describe('namespaced backend directories (W12T1-01/02)', () => {
  it('ignores a foreign keychain index and stray files outside its namespace', () => {
    const paths = secretRepositoryPaths(home);
    mkdirSync(paths.dir, { recursive: true, mode: 0o700 });
    // The old shared-directory layout plus arbitrary junk: none of it is a file record.
    writeFileSync(join(paths.dir, 'keychain.json'), '{"v":1,"entries":[]}\n');
    writeFileSync(join(paths.dir, 'garbage.json'), 'this is not JSON\n');
    const repository = fileRepository();
    repository.set('provider/main', DECOY, { audience: 'gateway' });

    expect(repository.list().map((entry) => entry.ref)).toEqual(['provider/main']);
    expect(repository.problems()).toEqual([]);
  });

  it('reports a corrupt record inside its own namespace and keeps the others', () => {
    const paths = secretRepositoryPaths(home);
    const repository = fileRepository();
    repository.set('provider/good', DECOY, { audience: 'gateway' });
    writeFileSync(join(paths.fileDir, 'garbage.json'), 'this is not JSON\n');

    const items = repository.list();
    expect(items.map((entry) => entry.ref)).toEqual(['provider/good']);
    const problems = repository.problems();
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ code: 'SECRET_RECORD_INVALID' });
    expect(problems[0]?.path).toContain('garbage.json');
    // The load is per-record tolerant: the good ref loads, the bad file is reported.
    const load = loadSecretsIntoStore(repository, new SecretStore());
    expect(load.loaded).toBe(1);
    expect(load.failed).toEqual([]);
    expect(load.problems).toHaveLength(1);
  });

  it('does not load, report or delete the other backend records on a switch (W12T1-02)', () => {
    const file = fileRepository();
    file.set('provider/fromfile', DECOY, { audience: 'gateway' });

    // Switching to the Keychain (injected runner) must not touch the file namespace.
    const keychain = createSecretRepository({
      home,
      backend: 'keychain',
      commandRunner: () => ({ status: 44, stdout: '', stderr: 'not found' }),
      now,
    });
    expect(keychain.list()).toEqual([]);
    expect(keychain.problems()).toEqual([]);
    const switched = loadSecretsIntoStore(keychain, new SecretStore());
    expect(switched).toEqual({ loaded: 0, failed: [], problems: [] });

    // Back to file: the record is intact and still readable.
    const reopened = fileRepository();
    expect(reopened.list().map((entry) => entry.ref)).toEqual(['provider/fromfile']);
    expect(reopened.get('provider/fromfile')?.value).toBe(DECOY);
  });
});

describe('backend selection', () => {
  it('honours AGENTDEV_SECRET_BACKEND and refuses an unknown value', () => {
    expect(resolveSecretBackend({ home, env: { [SECRET_BACKEND_ENV]: 'file' } })).toBe('file');
    expect(resolveSecretBackend({ home, env: { [SECRET_BACKEND_ENV]: 'keychain' } })).toBe(
      'keychain',
    );
    expect(() =>
      resolveSecretBackend({ home, env: { [SECRET_BACKEND_ENV]: 'keyring' } }),
    ).toThrowError(SecretRepositoryError);
  });

  it('defaults to the file backend on every platform; keychain is opt-in', () => {
    // WP-12 decision 3: no darwin auto-detection — the `security` CLI would expose the
    // value in argv, so the Keychain must be asked for explicitly.
    expect(resolveSecretBackend({ home, env: {} })).toBe('file');
    expect(createSecretRepository({ home, env: {} }).backend).toBe('file');
    expect(resolveSecretBackend({ home, env: { [SECRET_BACKEND_ENV]: 'keychain' } })).toBe(
      'keychain',
    );
  });
});

describe('keychain adapter (injected command runner)', () => {
  /** An in-memory Keychain: enough to drive add/find/delete without macOS. */
  function fakeKeychain(): { readonly run: SecretCommandRunner; readonly calls: string[][] } {
    const calls: string[][] = [];
    const items = new Map<string, string>();
    const run: SecretCommandRunner = (command, args) => {
      expect(command).toBe(SECURITY_BINARY);
      calls.push([...args]);
      const [verb, ...rest] = args;
      const value = (flag: string): string | undefined => {
        const index = rest.indexOf(flag);
        return index === -1 ? undefined : rest[index + 1];
      };
      const account = value('-a') as string;
      expect(value('-s')).toBe(KEYCHAIN_SERVICE);
      if (verb === 'add-generic-password') {
        items.set(account, value('-w') as string);
        return { status: 0, stdout: '', stderr: '' };
      }
      if (verb === 'find-generic-password') {
        const secret = items.get(account);
        return secret === undefined
          ? { status: 44, stdout: '', stderr: 'could not be found' }
          : { status: 0, stdout: `${secret}\n`, stderr: '' };
      }
      if (verb === 'delete-generic-password') {
        return items.delete(account)
          ? { status: 0, stdout: '', stderr: '' }
          : { status: 44, stdout: '', stderr: 'could not be found' };
      }
      return { status: 1, stdout: '', stderr: 'unsupported' };
    };
    return { run, calls };
  }

  function keychainRepository(): { repository: SecretRepository; calls: string[][] } {
    const fake = fakeKeychain();
    return {
      repository: createSecretRepository({
        home,
        backend: 'keychain',
        commandRunner: fake.run,
        now,
      }),
      calls: fake.calls,
    };
  }

  it('stores, reads, lists and deletes through the security CLI', () => {
    const { repository, calls } = keychainRepository();
    const summary = repository.set('provider/main', DECOY, { audience: 'gateway' });
    expect(summary.backend).toBe('keychain');
    expect(calls[0]).toEqual([
      'add-generic-password',
      '-a',
      'provider/main',
      '-s',
      KEYCHAIN_SERVICE,
      '-w',
      DECOY,
      '-U',
    ]);

    expect(repository.get('provider/main')?.value).toBe(DECOY);
    expect(calls[1]).toEqual([
      'find-generic-password',
      '-a',
      'provider/main',
      '-s',
      KEYCHAIN_SERVICE,
      '-w',
    ]);
    expect(repository.list()).toEqual([
      {
        ref: 'provider/main',
        configured: true,
        updatedAt: new Date(1_700_000_000_000).toISOString(),
        backend: 'keychain',
        health: 'ok',
      },
    ]);
    expect(repository.delete('provider/main')).toBe(true);
    expect(repository.delete('provider/main')).toBe(false);
    expect(repository.get('provider/main')).toBeNull();
  });

  it('decodes the hex form `security -w` uses for non-ASCII values (real macOS behaviour)', () => {
    // A fake that reproduces `/usr/bin/security` exactly as observed on this macOS host:
    // `-w` prints printable ASCII verbatim but hex-encodes anything else, and `-g` quotes
    // the former while printing `0x…` for the latter. The Keychain stores raw bytes, so
    // reading the `-w` hex answer as the value is what corrupted non-ASCII credentials.
    const items = new Map<string, string>();
    const run: SecretCommandRunner = (_command, args) => {
      const rest = args.slice(1);
      const flag = (name: string): string | undefined => {
        const index = rest.indexOf(name);
        return index === -1 ? undefined : rest[index + 1];
      };
      const account = flag('-a') as string;
      if (args[0] === 'add-generic-password') {
        items.set(account, flag('-w') as string);
        return { status: 0, stdout: '', stderr: '' };
      }
      const stored = items.get(account);
      if (stored === undefined) return { status: 44, stdout: '', stderr: 'could not be found' };
      const bytes = Buffer.from(stored, 'utf8');
      const printable = bytes.every((byte) => byte >= 0x20 && byte < 0x7f);
      if (args.includes('-w')) {
        return {
          status: 0,
          stdout: `${printable ? stored : bytes.toString('hex')}\n`,
          stderr: '',
        };
      }
      if (args.includes('-g')) {
        return {
          status: 0,
          stdout: '',
          stderr: printable
            ? `password: "${stored}"\n`
            : `password: 0x${bytes.toString('hex').toUpperCase()}\n`,
        };
      }
      return { status: 1, stdout: '', stderr: 'unsupported' };
    };
    const repository = createSecretRepository({
      home,
      backend: 'keychain',
      commandRunner: run,
      now,
    });

    // Non-ASCII and control bytes both come back as the bytes that were stored.
    for (const [ref, value] of [
      ['provider/unicode', '值é🔑-token'],
      ['provider/multiline', 'line1\nline2'],
    ] as const) {
      repository.set(ref, value, { audience: 'gateway' });
      expect(repository.get(ref)?.value).toBe(value);
    }
    // A printable ASCII value that merely *looks* like hex stays itself.
    repository.set('provider/hexlike', 'c3a9', { audience: 'gateway' });
    expect(repository.get('provider/hexlike')?.value).toBe('c3a9');
  });

  it('keeps the index metadata-only, namespaced and 0600', () => {
    const { repository } = keychainRepository();
    repository.set('provider/main', DECOY, { audience: 'gateway' });
    const paths = secretRepositoryPaths(home);
    const index = readFileSync(paths.keychainIndex, 'utf8');
    expect(index).not.toContain(DECOY);
    expect(index).toContain('provider/main');
    expect(statSync(paths.keychainIndex).mode & 0o777).toBe(0o600);
    expect(statSync(paths.keychainDir).mode & 0o777).toBe(0o700);
    expect(JSON.stringify(repository.list())).not.toContain(DECOY);
  });

  it('reports a corrupt index instead of throwing (W12T1-01)', () => {
    const { repository } = keychainRepository();
    const paths = secretRepositoryPaths(home);
    repository.set('provider/seed', DECOY, { audience: 'gateway' });
    writeFileSync(paths.keychainIndex, 'not JSON\n', { mode: 0o600 });

    expect(repository.list()).toEqual([]);
    expect(repository.problems()).toHaveLength(1);
    expect(repository.problems()[0]).toMatchObject({ code: 'SECRET_RECORD_INVALID' });
    const load = loadSecretsIntoStore(repository, new SecretStore());
    expect(load.loaded).toBe(0);
    expect(load.failed).toEqual([]);
    expect(load.problems).toHaveLength(1);
  });

  it('validates stale and unreadable index rows, and cleans them on delete (R2-01)', () => {
    const paths = secretRepositoryPaths(home);
    mkdirSync(paths.keychainDir, { recursive: true, mode: 0o700 });
    const writeIndex = (refs: readonly string[]): void => {
      writeFileSync(
        paths.keychainIndex,
        `${JSON.stringify({
          v: 1,
          entries: refs.map((ref) => ({
            ref,
            audience: 'gateway',
            updatedAt: '2026-01-01T00:00:00.000Z',
          })),
        })}\n`,
        { mode: 0o600 },
      );
    };
    // The row exists but the Keychain has no item for it (a manual delete or a failed
    // write): it used to be listed `health: ok` and silently skipped by the load.
    writeIndex(['provider/gone']);
    const { repository } = keychainRepository();

    const items = repository.list();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      ref: 'provider/gone',
      configured: false,
      health: 'missing',
      issue: { code: 'SECRET_NOT_FOUND' },
    });
    expect(repository.problems()).toHaveLength(1);
    expect(repository.problems()[0]).toMatchObject({
      code: 'SECRET_NOT_FOUND',
      path: paths.keychainIndex,
    });

    const load = loadSecretsIntoStore(repository, new SecretStore());
    expect(load.loaded).toBe(0);
    expect(load.failed).toHaveLength(1);
    expect(load.failed[0]?.code).toBe('SECRET_NOT_FOUND');
    expect(load.problems).toHaveLength(1);

    // `delete` must converge the index, not just report `false`.
    expect(repository.delete('provider/gone')).toBe(true);
    expect(repository.list()).toEqual([]);
    expect(repository.problems()).toEqual([]);
    expect(repository.delete('provider/gone')).toBe(false);
  });

  it('marks an index row the Keychain refuses to read as unreadable (R2-01)', () => {
    const paths = secretRepositoryPaths(home);
    mkdirSync(paths.keychainDir, { recursive: true, mode: 0o700 });
    writeFileSync(
      paths.keychainIndex,
      `${JSON.stringify({
        v: 1,
        entries: [
          { ref: 'provider/locked', audience: 'gateway', updatedAt: '2026-01-01T00:00:00.000Z' },
        ],
      })}\n`,
      { mode: 0o600 },
    );
    const run: SecretCommandRunner = (_command, args) =>
      args[0] === 'find-generic-password'
        ? { status: 51, stdout: '', stderr: 'interaction not allowed' }
        : { status: 1, stdout: '', stderr: 'denied' };
    const repository = createSecretRepository({ home, backend: 'keychain', commandRunner: run });

    expect(repository.list()[0]).toMatchObject({
      ref: 'provider/locked',
      configured: false,
      health: 'unreadable',
      issue: { code: 'SECRET_KEYCHAIN_FAILED' },
    });
    expect(repository.problems()[0]?.code).toBe('SECRET_KEYCHAIN_FAILED');
    // A failed delete (not "not found") is typed, and the index row stays.
    expect(() => repository.delete('provider/locked')).toThrowError(SecretRepositoryError);
    expect(repository.list()).toHaveLength(1);
  });

  it('surfaces a Keychain refusal as a typed error', () => {
    const run: SecretCommandRunner = () => ({ status: 1, stdout: '', stderr: 'denied' });
    const repository = createSecretRepository({
      home,
      backend: 'keychain',
      commandRunner: run,
      now,
    });
    try {
      repository.set('provider/main', DECOY);
      throw new Error('expected the write to fail');
    } catch (error) {
      expect((error as SecretRepositoryError).code).toBe('SECRET_KEYCHAIN_FAILED');
      expect((error as Error).message).not.toContain(DECOY);
    }
  });
});

describe('startup load into the in-memory store', () => {
  it('re-registers every stored ref under its audience', () => {
    const repository = fileRepository();
    repository.set('provider/main', DECOY, { audience: 'gateway' });
    repository.set('tool/token', 'tool-decoy', { audience: 'tool' });

    const store = new SecretStore();
    const result = loadSecretsIntoStore(repository, store);

    expect(result).toEqual({ loaded: 2, failed: [], problems: [] });
    expect(store.refs()).toEqual(['provider/main', 'tool/token']);
    expect(store.list().find((entry) => entry.ref === 'tool/token')?.audience).toBe('tool');
  });

  it('reports an unreadable record per ref instead of failing the whole load', () => {
    const repository = fileRepository();
    repository.set('provider/main', DECOY, { audience: 'gateway' });
    // Corrupt the master key: the record stays, its value becomes unreadable.
    writeFileSync(
      secretRepositoryPaths(home).masterKey,
      `${Buffer.alloc(32, 3).toString('base64')}\n`,
    );
    const store = new SecretStore();
    const result = loadSecretsIntoStore(repository, store);
    expect(result.loaded).toBe(0);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]?.code).toBe('SECRET_DECRYPT_FAILED');
    expect(result.problems).toEqual([]);
    expect(store.refs()).toEqual([]);
  });
});
