/**
 * CLI secret command integration test (WP-12 T1.1).
 *
 * The CLI is driven exactly as a user drives it (`agentdev secret set|list|delete`) and,
 * for the live path, against a **real daemon child process**. `docs/architecture/
 * execution.md` §4 and `docs/architecture/reliability.md` §7 shape what is asserted:
 * the value is read from stdin only, never echoed, resolved through the running daemon's
 * admin surface when one answers and through the durable repository otherwise, and every
 * failure prints an error code plus an `operationId`.
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigStore, createSecretRepository } from '@agentdev/core';
import { createNodeWorktreeGitPort } from '@agentdev/workspace';

import { main } from '../src/cli.js';

/** The value whose absence from every CLI surface is the point of the test. */
const DECOY = 'sk-live-decoy-0123456789ABCDEF';
/** The replacement value used by the rotation tests. */
const DECOY_ROTATED = 'sk-rotated-decoy-FEDCBA9876543210';
const repoRoot = join(import.meta.dirname, '..', '..', '..');
let home: string;
let repo: string;
const originalEnv = { ...process.env };

interface RunResult {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

/** Runs the CLI in-process with captured IO and a scripted stdin. */
async function runCli(args: readonly string[], input = ''): Promise<RunResult> {
  let out = '';
  let err = '';
  let code = 0;
  await main(args, {
    out: (text) => {
      out += text;
    },
    err: (text) => {
      err += text;
    },
    exit: (value) => {
      code = value;
    },
    readStdin: () => Promise.resolve(input),
  });
  return { code, out, err };
}

const gitPort = createNodeWorktreeGitPort();

function seedRepo(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `agentdev-cli-secret-${name}-`));
  const init = gitPort.initRepository(dir, { branch: 'agentdev/main' });
  if (!init.ok) throw new Error(`git init failed: ${init.errors[0]?.message ?? 'unknown'}`);
  writeFileSync(join(dir, 'README.md'), '# seeded\n');
  const commit = gitPort.commitPaths(dir, 'chore: seed', ['README.md']);
  if (!commit.ok) throw new Error(`git commit failed: ${commit.errors[0]?.message ?? 'unknown'}`);
  return dir;
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'agentdev-cli-secret-home-'));
  repo = seedRepo('repo');
  const bootstrap = join(home, 'daemon-entry.mjs');
  writeFileSync(
    bootstrap,
    [
      `import { installSourceResolver } from ${JSON.stringify(join(repoRoot, 'scripts/lib/e2e-runtime.mjs'))};`,
      'installSourceResolver();',
      `const { runAsProcess } = await import(${JSON.stringify(join(repoRoot, 'apps/daemon/src/main.ts'))});`,
      'process.exit(await runAsProcess(process.argv.slice(2), process.env));',
      '',
    ].join('\n'),
  );
  process.env.AGENTDEV_HOME = home;
  process.env.AGENTDEV_DAEMON_ENTRY = bootstrap;
  // Never let a test touch the real macOS Keychain.
  process.env.AGENTDEV_SECRET_BACKEND = 'file';
});

afterEach(async () => {
  await runCli(['stop']);
  process.env = { ...originalEnv };
  rmSync(home, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
});

describe('agentdev secret', () => {
  it('writes through the repository directly when no daemon is running', async () => {
    const set = await runCli(['secret', 'set', 'provider/main'], `${DECOY}\n`);
    expect(set.code).toBe(0);
    expect(set.out).not.toContain(DECOY);
    expect(set.err).not.toContain(DECOY);
    const setBody = JSON.parse(set.out) as {
      path: string;
      backend: string;
      ref: string;
      configured: boolean;
    };
    expect(setBody).toMatchObject({
      ok: true,
      path: 'repository',
      backend: 'file',
      ref: 'provider/main',
      configured: true,
    });

    const list = await runCli(['secret', 'list']);
    expect(list.code).toBe(0);
    expect(list.out).not.toContain(DECOY);
    const listBody = JSON.parse(list.out) as {
      path: string;
      items: { ref: string; configured: boolean; updatedAt: string; backend: string }[];
    };
    expect(listBody.path).toBe('repository');
    expect(listBody.items).toHaveLength(1);
    expect(listBody.items[0]).toMatchObject({
      ref: 'provider/main',
      configured: true,
      backend: 'file',
    });
    expect(typeof listBody.items[0]?.updatedAt).toBe('string');

    const removed = await runCli(['secret', 'delete', 'provider/main']);
    expect(removed.code).toBe(0);
    const removedBody = JSON.parse(removed.out) as { path: string; deleted: boolean };
    expect(removedBody).toMatchObject({ path: 'repository', deleted: true });
    expect(
      (JSON.parse((await runCli(['secret', 'list'])).out) as { items: unknown[] }).items,
    ).toEqual([]);
  });

  it('writes through the running daemon admin surface when one answers', async () => {
    const started = await runCli(['start']);
    expect(started.code).toBe(0);

    const set = await runCli(['secret', 'set', 'provider/main'], `${DECOY}\n`);
    expect(set.code).toBe(0);
    expect(set.out).not.toContain(DECOY);
    expect(JSON.parse(set.out)).toMatchObject({
      ok: true,
      path: 'daemon',
      backend: 'file',
      ref: 'provider/main',
      configured: true,
    });

    // The CLI reads the durable repository directly (there is no admin read route), and
    // the value never reaches the CLI surfaces.
    const list = await runCli(['secret', 'list']);
    expect(list.out).not.toContain(DECOY);
    expect((JSON.parse(list.out) as { items: { ref: string }[] }).items[0]?.ref).toBe(
      'provider/main',
    );

    const removed = await runCli(['secret', 'delete', 'provider/main']);
    expect(removed.code).toBe(0);
    expect(removed.out).not.toContain(DECOY);
    expect(JSON.parse(removed.out)).toMatchObject({ path: 'daemon', deleted: true });

    // The daemon wrote a sealed record: no plaintext file in the file namespace may
    // contain the value (`execution.md` §4).
    const fileDir = join(home, 'secrets', 'file');
    for (const name of readdirSync(fileDir)) {
      expect(readFileSync(join(fileDir, name), 'utf8')).not.toContain(DECOY);
    }
  });

  it('accepts --stdin, the flag plan.md §4 T1 documents', async () => {
    const set = await runCli(['secret', 'set', 'provider/main', '--stdin'], `${DECOY}\n`);
    expect(set.code).toBe(0);
    expect(set.out).not.toContain(DECOY);
    expect(JSON.parse(set.out)).toMatchObject({ ok: true, path: 'repository', configured: true });
  });

  it('stays green when the store holds foreign and corrupt files (W12T1-01)', async () => {
    const secrets = join(home, 'secrets');
    mkdirSync(secrets, { recursive: true, mode: 0o700 });
    // The reviewer's repro: a leftover Keychain index in the shared directory, plus junk.
    writeFileSync(join(secrets, 'keychain.json'), '{"v":1,"entries":[]}\n');
    writeFileSync(join(secrets, 'garbage.json'), 'this is not JSON\n');
    await runCli(['secret', 'set', 'provider/main'], `${DECOY}\n`);
    writeFileSync(join(secrets, 'file', 'garbage.json'), 'this is not JSON\n');

    const list = await runCli(['secret', 'list']);
    expect(list.code).toBe(0);
    expect(list.out).not.toContain(DECOY);
    const body = JSON.parse(list.out) as {
      items: { ref: string }[];
      problems: { code: string }[];
    };
    expect(body.items.map((entry) => entry.ref)).toEqual(['provider/main']);
    expect(body.problems).toHaveLength(1);
    expect(body.problems[0]?.code).toBe('SECRET_RECORD_INVALID');

    // `agentdev start` must not be blocked by the same files.
    const started = await runCli(['start']);
    expect(started.code).toBe(0);
    expect(JSON.parse(started.out)).toMatchObject({ started: true });
  });

  it('rotates an existing credential atomically and says what the new value affects', async () => {
    const config = ConfigStore.open({ globalDir: home });
    config.upsertProvider({
      providerId: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e77',
      type: 'openai-compatible',
      baseUrl: 'http://127.0.0.1:1/v1',
      enabled: true,
      secretRef: 'provider/main',
      models: [
        {
          id: 'rotate-model',
          contextWindow: 8_192,
          maxOutputTokens: 1_024,
          reasoningLevels: ['off'],
          vision: false,
        },
      ],
    });

    const set = await runCli(['secret', 'set', 'provider/main'], `${DECOY}\n`);
    expect(set.code).toBe(0);

    const rotated = await runCli(['secret', 'rotate', 'provider/main'], `${DECOY_ROTATED}\n`);
    expect(rotated.code).toBe(0);
    expect(rotated.out).not.toContain(DECOY_ROTATED);
    expect(rotated.err).not.toContain(DECOY_ROTATED);
    const body = JSON.parse(rotated.out) as {
      path: string;
      ref: string;
      rotated: boolean;
      atomicSwap: boolean;
      previousUpdatedAt: string;
      updatedAt: string;
      affected: { secretRef: string; providers: { providerId: string; models: string[] }[] };
      capabilities: { revoked: number; note: string };
    };
    expect(body).toMatchObject({
      ok: true,
      command: 'secret rotate',
      path: 'repository',
      ref: 'provider/main',
      rotated: true,
      atomicSwap: true,
      affected: {
        secretRef: 'provider/main',
        providers: [
          { providerId: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e77', models: ['rotate-model'] },
        ],
      },
      capabilities: { revoked: 0 },
    });
    expect(typeof body.previousUpdatedAt).toBe('string');
    expect(typeof body.updatedAt).toBe('string');
    // The honest scope: rotation does not revoke an already-issued capability.
    expect(body.capabilities.note).toContain('不会');
    // The stored value really changed.
    expect(createSecretRepository({ home }).get('provider/main')?.value).toBe(DECOY_ROTATED);
  });

  it('rotates through the live daemon so the running process resolves the new value', async () => {
    expect((await runCli(['secret', 'set', 'provider/main'], `${DECOY}\n`)).code).toBe(0);
    expect((await runCli(['start'])).code).toBe(0);

    const rotated = await runCli(['secret', 'rotate', 'provider/main'], `${DECOY_ROTATED}\n`);
    expect(rotated.code).toBe(0);
    expect(rotated.out).not.toContain(DECOY_ROTATED);
    expect(JSON.parse(rotated.out)).toMatchObject({
      ok: true,
      command: 'secret rotate',
      path: 'daemon',
      ref: 'provider/main',
      rotated: true,
    });
    expect(createSecretRepository({ home }).get('provider/main')?.value).toBe(DECOY_ROTATED);
  }, 60_000);

  it('refuses to rotate a ref that was never registered', async () => {
    const rotated = await runCli(['secret', 'rotate', 'provider/missing'], `${DECOY_ROTATED}\n`);
    expect(rotated.code).toBe(1);
    const body = JSON.parse(rotated.err.trim()) as {
      error: { code: string };
      operationId: string;
    };
    expect(body.error.code).toBe('SECRET_NOT_FOUND');
    expect(body.operationId).toMatch(/^[0-9a-f-]{36}$/u);
    expect(rotated.err).not.toContain(DECOY_ROTATED);
    expect(createSecretRepository({ home }).get('provider/missing')).toBeNull();

    const empty = await runCli(['secret', 'rotate', 'provider/main'], '\n');
    expect(empty.code).toBe(1);
    expect((JSON.parse(empty.err.trim()) as { error: { code: string } }).error.code).toBe(
      'VALIDATION_ERROR',
    );
  });

  it('fails with an error code and operationId, never echoing the value', async () => {
    const empty = await runCli(['secret', 'set', 'provider/main'], '\n');
    expect(empty.code).toBe(1);
    const emptyBody = JSON.parse(empty.err.trim()) as {
      ok: boolean;
      error: { code: string; message: string };
      operationId: string;
    };
    expect(emptyBody.ok).toBe(false);
    expect(emptyBody.error.code).toBe('VALIDATION_ERROR');
    expect(emptyBody.operationId).toMatch(/^[0-9a-f-]{36}$/u);
    expect(empty.err).not.toContain(DECOY);
    expect(empty.out).toBe('');

    const missingRef = await runCli(['secret', 'set'], `${DECOY}\n`);
    expect(missingRef.code).toBe(1);
    expect((JSON.parse(missingRef.err.trim()) as { error: { code: string } }).error.code).toBe(
      'VALIDATION_ERROR',
    );
    expect(missingRef.err).not.toContain(DECOY);

    const badOption = await runCli(
      ['secret', 'set', 'provider/main', '--audience', 'keychain'],
      `${DECOY}\n`,
    );
    expect(badOption.code).toBe(1);
    expect((JSON.parse(badOption.err.trim()) as { error: { code: string } }).error.code).toBe(
      'VALIDATION_ERROR',
    );
    expect(badOption.err).not.toContain(DECOY);
  });
});
