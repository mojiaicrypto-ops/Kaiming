/**
 * Real macOS Keychain integration test (WP-12 keychain real verification).
 *
 * `packages/core/test/secret-repository.test.ts` drives the Keychain backend through an
 * injected command runner, which is portable but cannot catch a mismatch between our
 * assumptions and what `/usr/bin/security` really does. This file closes that gap on a real
 * macOS host: it stores real items in the login keychain and reads them back through the
 * production repository.
 *
 * It is deliberately **opt-in** (`AGENTDEV_KEYCHAIN_IT=1`) so an ordinary
 * `pnpm test:integration` never writes to the operator's keychain, and it is **skipped**
 * when the real `security` client is unavailable or not usable (non-darwin host, missing
 * binary, locked keychain), so the suite stays portable. On a host where the client *is*
 * available and opted in it fails loudly instead of silently skipping a regression.
 *
 * Run with:
 *   AGENTDEV_KEYCHAIN_IT=1 pnpm vitest run --project integration \
 *     packages/core/test/secret-repository.keychain.integration.test.ts
 */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  KEYCHAIN_SERVICE,
  SECURITY_BINARY,
  SecretStore,
  createSecretRepository,
  loadSecretsIntoStore,
  secretRepositoryPaths,
  type SecretRepository,
} from '../src/index.js';

const OPTED_IN = process.env['AGENTDEV_KEYCHAIN_IT'] === '1';

/** Runs the real client; a timeout keeps a locked keychain from hanging the suite. */
function security(args: readonly string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(SECURITY_BINARY, [...args], {
    encoding: 'utf8',
    timeout: 15_000,
  });
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

/**
 * Whether the real client can be driven non-interactively here.
 *
 * A lookup for an account that cannot exist must answer `44` (`errSecItemNotFound`). Any
 * other outcome — a non-darwin host, a missing binary, a locked keychain, an authorization
 * prompt — means this host cannot run the test, so it is skipped rather than failed.
 */
function keychainUsable(): boolean {
  if (process.platform !== 'darwin') return false;
  if (!existsSync(SECURITY_BINARY)) return false;
  const probe = security([
    'find-generic-password',
    '-a',
    `agentdev-it-probe-${randomBytes(8).toString('hex')}`,
    '-s',
    KEYCHAIN_SERVICE,
    '-w',
  ]);
  return probe.status === 44;
}

const ENABLED = OPTED_IN && keychainUsable();

describe.skipIf(!ENABLED)('macOS Keychain backend against the real security client', () => {
  const prefix = `agentdev-it-${process.pid.toString()}-${randomBytes(6).toString('hex')}`;
  /** Every account this suite created, so cleanup is unconditional. */
  const created = new Set<string>();
  let home: string;
  let repository: SecretRepository;

  const ref = (name: string): string => `${prefix}/${name}`;

  beforeAll(() => {
    home = mkdtempSync(join(tmpdir(), 'agentdev-keychain-it-'));
    repository = createSecretRepository({ home, backend: 'keychain' });
  });

  afterAll(() => {
    // Remove the real keychain items directly: a failing assertion must not leave a
    // credential behind, and the repository may be unusable after a deliberate corruption
    // test.
    for (const account of created) {
      security(['delete-generic-password', '-a', account, '-s', KEYCHAIN_SERVICE]);
    }
    if (home !== undefined) rmSync(home, { recursive: true, force: true });
  });

  function set(refName: string, value: string): void {
    created.add(refName);
    repository.set(refName, value, { audience: 'gateway' });
  }

  it('round-trips ASCII, non-ASCII and control bytes through the real Keychain', () => {
    const cases: readonly (readonly [string, string])[] = [
      ['provider/ascii', 'sk-real-keychain-0123456789'],
      // `security -w` hex-encodes anything non-printable: reading that hex as the value is
      // the decode mismatch this test guards against.
      ['provider/unicode', '值é🔑-token'],
      ['provider/multiline', 'line1\nline2'],
      // A printable value that is itself all hex must stay itself, not be decoded.
      ['provider/hexlike', 'c3a9'],
    ];
    for (const [name, value] of cases) {
      const refName = ref(name);
      set(refName, value);
      expect(repository.get(refName)?.value).toBe(value);
    }
  });

  it('lists metadata only, with health ok', () => {
    const refName = ref('provider/listed');
    const value = `sk-listed-${randomBytes(8).toString('hex')}`;
    set(refName, value);

    const row = repository.list().find((item) => item.ref === refName);
    expect(row).toMatchObject({
      ref: refName,
      configured: true,
      health: 'ok',
      backend: 'keychain',
    });
    // The query surface and the whole repository object never carry the value.
    expect(JSON.stringify(repository.list())).not.toContain(value);
    expect(JSON.stringify(repository)).not.toContain(value);
    expect(repository.problems()).toEqual([]);
  });

  it('overwrites an existing ref in place', () => {
    const refName = ref('provider/overwrite');
    set(refName, 'first-real-value');
    set(refName, 'second-real-value');

    expect(repository.get(refName)?.value).toBe('second-real-value');
    expect(repository.list().filter((item) => item.ref === refName)).toHaveLength(1);
  });

  it('deletes the item and reports an absent ref as null', () => {
    const refName = ref('provider/deleted');
    set(refName, 'delete-me-real');
    expect(repository.delete(refName)).toBe(true);
    created.delete(refName);

    expect(repository.get(refName)).toBeNull();
    expect(
      security(['find-generic-password', '-a', refName, '-s', KEYCHAIN_SERVICE, '-w']).status,
    ).toBe(44);
    expect(repository.delete(refName)).toBe(false);
  });

  it('reports a stale index row as missing instead of silently skipping it', () => {
    const refName = ref('provider/stale');
    set(refName, 'stale-real-value');
    // Remove the Keychain item by hand, leaving the index row: the item is now gone while
    // the repository still believes the ref is registered.
    expect(
      security(['delete-generic-password', '-a', refName, '-s', KEYCHAIN_SERVICE]).status,
    ).toBe(0);
    created.delete(refName);

    const row = repository.list().find((item) => item.ref === refName);
    expect(row).toMatchObject({
      ref: refName,
      configured: false,
      health: 'missing',
      issue: { code: 'SECRET_NOT_FOUND' },
    });
    expect(repository.problems().some((problem) => problem.code === 'SECRET_NOT_FOUND')).toBe(true);

    const load = loadSecretsIntoStore(repository, new SecretStore());
    expect(load.failed.some((failure) => failure.ref === refName)).toBe(true);

    // `delete` converges the index instead of leaving the row behind forever.
    expect(repository.delete(refName)).toBe(true);
    expect(repository.list().some((item) => item.ref === refName)).toBe(false);
  });

  it('keeps the index namespaced under the installation home, not in the Keychain', () => {
    const refName = ref('provider/namespaced');
    const value = `sk-namespaced-${randomBytes(8).toString('hex')}`;
    set(refName, value);

    const paths = secretRepositoryPaths(home);
    const index = readFileSync(paths.keychainIndex, 'utf8');
    expect(index).toContain(refName);
    expect(index).not.toContain(value);
  });
});
