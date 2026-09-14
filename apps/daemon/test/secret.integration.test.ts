/**
 * Secret entry-point integration test (WP-12 T1.1).
 *
 * This drives the real product: a real state home, a real single-instance daemon, the
 * loopback admin surface and the `/rpc` protocol face. It covers the three seams T1.1
 * adds —
 *
 * - `POST`/`DELETE /secret` on the admin surface (installation Bearer, loopback only);
 * - `secret.set` / `secret.delete` / `secret.list` over `/rpc` (installation caller only);
 * - startup load of the durable repository into the in-memory `SecretStore`, so a
 *   registered Provider secret works for `gateway` audience resolution after a restart.
 *
 * `docs/architecture/execution.md` §4 is the contract: "模型Secret仅在Gateway… 日志做敏感
 * 字段和已知值遮蔽" and registration is not authorization. Every assertion below also
 * checks that the value never appears in a response, an event or a log line.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { projectStateDir } from '@agentdev/contracts';
import {
  ConfigStore,
  createSecretRepository,
  readInstallationCredential,
  secretRepositoryPaths,
} from '@agentdev/core';
import { ProjectStore, sha256 } from '@agentdev/storage';
import { createNodeWorktreeGitPort } from '@agentdev/workspace';

import { startRuntime, type RunningRuntime } from '../src/main.js';

/** The value whose absence from every wire/log surface is the point of the test. */
const DECOY = 'sk-live-decoy-0123456789ABCDEF';
const SECRET_REF = 'provider/main';
const PROVIDER_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e70';
const WEB_ORIGIN = 'http://127.0.0.1:4317';

let home: string;
let repo: string;
let runtime: RunningRuntime | undefined;
let logs: string[];

const gitPort = createNodeWorktreeGitPort();

function seedRepo(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `agentdev-${name}-`));
  const init = gitPort.initRepository(dir, { branch: 'agentdev/main' });
  if (!init.ok) throw new Error(`git init failed: ${init.errors[0]?.message ?? 'unknown'}`);
  writeFileSync(join(dir, 'README.md'), '# seeded\n');
  const commit = gitPort.commitPaths(dir, 'chore: seed', ['README.md']);
  if (!commit.ok) throw new Error(`git commit failed: ${commit.errors[0]?.message ?? 'unknown'}`);
  return dir;
}

/** Writes the global `config.toml` a Provider with a `secretRef` needs. */
function seedProvider(): void {
  const config = ConfigStore.open({ globalDir: home, projectRoot: repo });
  config.upsertProvider({
    providerId: PROVIDER_ID,
    type: 'openai-compatible',
    baseUrl: 'http://127.0.0.1:1234',
    enabled: true,
    secretRef: SECRET_REF,
    models: [
      {
        id: 'test-model',
        contextWindow: 200_000,
        maxOutputTokens: 8_000,
        reasoningLevels: ['off'],
        vision: false,
      },
    ],
  });
}

async function start(): Promise<RunningRuntime> {
  logs = [];
  runtime = await startRuntime({
    home,
    roots: [repo],
    trust: true,
    daemonPort: 0,
    webPort: 0,
    adminPort: 0,
    withWeb: false,
    // Pin the file backend: the test must never read or write the real Keychain.
    secretBackend: 'file',
    log: (line) => logs.push(line),
  });
  return runtime;
}

async function adminFetch(
  target: RunningRuntime,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const token = readInstallationCredential(target.home);
  return fetch(`http://127.0.0.1:${String(target.admin.port)}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(init.headers ?? {}),
    },
  });
}

interface RpcAnswer {
  readonly status: number;
  readonly body: {
    readonly ok?: boolean;
    readonly result?: Record<string, unknown>;
    readonly error?: { readonly code?: string; readonly message?: string };
  };
  readonly text: string;
}

async function rpc(
  target: RunningRuntime,
  method: string,
  params: Record<string, unknown> = {},
  headers: Record<string, string> = {},
  extra: Record<string, unknown> = {},
): Promise<RpcAnswer> {
  const instance = target.instances[0];
  const bearer =
    headers['cookie'] === undefined
      ? { authorization: `Bearer ${readInstallationCredential(home)}` }
      : {};
  const response = await fetch(`http://127.0.0.1:${String(instance?.daemon.port ?? 0)}/rpc`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...bearer,
      ...headers,
    },
    body: JSON.stringify({ v: 1, type: 'request', id: 't-1', method, params, ...extra }),
  });
  const text = await response.text();
  return { status: response.status, body: JSON.parse(text) as RpcAnswer['body'], text };
}

/** Every `payload_hash` currently in the project's real command ledger. */
function ledgerRows(
  target: RunningRuntime,
  projectId: string,
): { operation: string; hash: string }[] {
  const dataDir = projectStateDir(home, projectId);
  const store = ProjectStore.open({
    dataDir,
    projectId,
    migrations: { backup: () => undefined, backupPath: join(dataDir, 'pre.sqlite') },
  });
  try {
    return (
      store.db.prepare('SELECT operation, payload_hash FROM command').all() as {
        operation: string;
        payload_hash: string;
      }[]
    ).map((row) => ({ operation: row.operation, hash: row.payload_hash }));
  } finally {
    store.close();
  }
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'agentdev-secret-home-'));
  repo = seedRepo('secret-repo');
  seedProvider();
});

afterEach(async () => {
  await runtime?.stop();
  runtime = undefined;
  rmSync(home, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
});

describe('admin secret surface', () => {
  it('registers and removes a secret with the installation credential only', async () => {
    const running = await start();

    const unauthorized = await fetch(`http://127.0.0.1:${String(running.admin.port)}/secret`, {
      method: 'POST',
      body: JSON.stringify({ ref: SECRET_REF, value: DECOY }),
    });
    expect(unauthorized.status).toBe(401);

    const stored = await adminFetch(running, '/secret', {
      method: 'POST',
      body: JSON.stringify({ ref: SECRET_REF, value: DECOY }),
    });
    expect(stored.status).toBe(200);
    const storedText = await stored.text();
    expect(storedText).not.toContain(DECOY);
    const storedBody = JSON.parse(storedText) as {
      ok: boolean;
      secret: { ref: string; configured: boolean; updatedAt: string; backend: string };
    };
    expect(storedBody.ok).toBe(true);
    expect(storedBody.secret).toMatchObject({
      ref: SECRET_REF,
      configured: true,
      backend: 'file',
    });
    expect(typeof storedBody.secret.updatedAt).toBe('string');
    // The running process holds it, so a Gateway call can resolve it immediately.
    expect(running.secrets.has(SECRET_REF)).toBe(true);

    const deleted = await adminFetch(running, '/secret', {
      method: 'DELETE',
      body: JSON.stringify({ ref: SECRET_REF }),
    });
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({ ok: true, ref: SECRET_REF, deleted: true });
    expect(running.secrets.has(SECRET_REF)).toBe(false);
  });

  it('refuses a malformed secret request without echoing the body', async () => {
    const running = await start();
    const broken = await adminFetch(running, '/secret', {
      method: 'POST',
      body: `{"ref":"${SECRET_REF}","value":"${DECOY}"`,
    });
    expect(broken.status).toBe(400);
    expect(await broken.text()).not.toContain(DECOY);

    const noRef = await adminFetch(running, '/secret', {
      method: 'POST',
      body: JSON.stringify({ value: DECOY }),
    });
    expect(noRef.status).toBe(422);
    expect(await noRef.text()).not.toContain(DECOY);
  });

  it('refuses an oversized body with a typed 413 instead of a generic failure', async () => {
    const running = await start();
    // The admin `/health`/`/healthz` answer carries no filesystem path at all (R2-03).
    for (const route of ['/health', '/healthz']) {
      const health = await adminFetch(running, route);
      const healthText = await health.text();
      for (const path of [home, repo]) expect(healthText).not.toContain(path);
      expect(healthText).not.toContain('"root"');
      const healthBody = JSON.parse(healthText) as Record<string, unknown>;
      expect(healthBody).not.toHaveProperty('home');
      expect(healthBody).not.toHaveProperty('instances');
      expect(healthBody['ready']).toBe(true);
      expect(healthBody['projects']).toBe(1);
    }

    // One byte over the documented admin limit; the value is irrelevant, the size is.
    const oversized = `{"ref":"${SECRET_REF}","value":"${'x'.repeat(70 * 1024)}"}`;
    const response = await adminFetch(running, '/secret', { method: 'POST', body: oversized });
    expect(response.status).toBe(413);
    const body = (await response.json()) as {
      ok: boolean;
      error: { code: string; message: string };
    };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toContain('65536');

    // Exactly at the limit is accepted: the cap refuses only what it documents.
    const prefix = `{"ref":"${SECRET_REF}","value":"`;
    const boundary = `${prefix}${'x'.repeat(65_536 - prefix.length - 2)}"}`;
    expect(Buffer.byteLength(boundary)).toBe(65_536);
    const accepted = await adminFetch(running, '/secret', { method: 'POST', body: boundary });
    expect(accepted.status).toBe(200);
    expect(running.secrets.has(SECRET_REF)).toBe(true);
  });
});

describe('secret protocol commands', () => {
  it('sets, lists and deletes metadata without ever returning the value', async () => {
    const running = await start();

    const before = await rpc(running, 'config.get', { scope: 'global' });
    const providersBefore = (before.body.result?.['providers'] ?? []) as {
      secretConfigured: boolean;
    }[];
    expect(providersBefore[0]?.secretConfigured).toBe(false);

    const set = await rpc(running, 'secret.set', {
      ref: SECRET_REF,
      value: DECOY,
      audience: 'gateway',
    });
    expect(set.status).toBe(200);
    expect(set.text).not.toContain(DECOY);
    expect(set.body.result).toMatchObject({
      status: 'applied',
      ref: SECRET_REF,
      configured: true,
      backend: 'file',
    });

    // Honest `secretConfigured`: the ref exists *and* is registered (WP-12 T1.1).
    const after = await rpc(running, 'config.get', { scope: 'global' });
    const providersAfter = (after.body.result?.['providers'] ?? []) as {
      secretConfigured: boolean;
    }[];
    expect(providersAfter[0]?.secretConfigured).toBe(true);
    const agents = await rpc(running, 'agents');
    const agentProviders = (agents.body.result?.['providers'] ?? []) as {
      secretConfigured: boolean;
    }[];
    expect(agentProviders[0]?.secretConfigured).toBe(true);

    const list = await rpc(running, 'secret.list');
    expect(list.text).not.toContain(DECOY);
    expect(list.body.result?.['backend']).toBe('file');
    const items = (list.body.result?.['items'] ?? []) as {
      ref: string;
      configured: boolean;
      updatedAt: string;
      backend: string;
      health: string;
    }[];
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      ref: SECRET_REF,
      configured: true,
      backend: 'file',
      health: 'ok',
    });
    expect(typeof items[0]?.updatedAt).toBe('string');
    expect(list.body.result?.['problems']).toEqual([]);

    const removed = await rpc(running, 'secret.delete', { ref: SECRET_REF });
    expect(removed.text).not.toContain(DECOY);
    expect(removed.body.result).toMatchObject({ ref: SECRET_REF, deleted: true });
    const gone = await rpc(running, 'config.get', { scope: 'global' });
    const providersGone = (gone.body.result?.['providers'] ?? []) as {
      secretConfigured: boolean;
    }[];
    expect(providersGone[0]?.secretConfigured).toBe(false);

    // No log line may carry the value either (`execution.md` §4).
    expect(logs.join('\n')).not.toContain(DECOY);
  });

  it('records no command-ledger row (and no value digest) for secret.set', async () => {
    const running = await start();
    const instance = running.instances[0];
    const projectId = instance?.projectId as string;

    // `idempotencyKey` is accepted like any write (WP-12 decision 2), but a credential
    // must leave no trace in the ledger — not the value, and not a digest of it.
    const set = await rpc(
      running,
      'secret.set',
      { ref: SECRET_REF, value: DECOY, audience: 'gateway' },
      {},
      { idempotencyKey: 'secret-ledger-round-1' },
    );
    expect(set.status).toBe(200);
    expect(running.secrets.has(SECRET_REF)).toBe(true);

    const rows = ledgerRows(running, projectId);
    expect(rows.filter((row) => row.operation.startsWith('secret.'))).toEqual([]);
    // The canonical payload the generic ledger wrapper would have hashed, plus the raw
    // value; none of these digests may exist in the real `command` table.
    const forbidden = new Set([
      sha256(DECOY),
      sha256(`{"audience":"gateway","ref":"${SECRET_REF}","value":"${DECOY}"}`),
      sha256(`{"ref":"${SECRET_REF}","value":"${DECOY}"}`),
    ]);
    for (const row of rows) expect(forbidden.has(row.hash)).toBe(false);

    const removed = await rpc(
      running,
      'secret.delete',
      { ref: SECRET_REF },
      {},
      { idempotencyKey: 'secret-ledger-round-2' },
    );
    expect(removed.status).toBe(200);
    const after = ledgerRows(running, projectId);
    expect(after.filter((row) => row.operation.startsWith('secret.'))).toEqual([]);
  });

  it('refuses a browser session and keeps the installation caller', async () => {
    const running = await start();
    const instance = running.instances[0];
    const login = await fetch(`http://127.0.0.1:${String(instance?.daemon.port ?? 0)}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: WEB_ORIGIN },
      body: JSON.stringify({ token: readInstallationCredential(home) }),
    });
    expect(login.status).toBe(200);
    const session = (await login.json()) as { csrfToken: string };
    const cookie = login.headers.get('set-cookie') ?? '';
    const browserCookie = cookie.split(';')[0] ?? '';

    const refused = await rpc(
      running,
      'secret.set',
      { ref: SECRET_REF, value: DECOY },
      {
        cookie: browserCookie,
        origin: WEB_ORIGIN,
        'x-csrf-token': session.csrfToken,
      },
    );
    expect(refused.status).toBe(403);
    expect(refused.body.error?.code).toBe('NOT_AUTHORIZED');
    expect(refused.text).not.toContain(DECOY);
    expect(running.secrets.has(SECRET_REF)).toBe(false);

    // `secret.list` and `secret.delete` are installation-only too, not just `set`.
    for (const method of ['secret.list', 'secret.delete']) {
      const denied = await rpc(
        running,
        method,
        method === 'secret.delete' ? { ref: SECRET_REF } : {},
        { cookie: browserCookie, origin: WEB_ORIGIN, 'x-csrf-token': session.csrfToken },
      );
      expect(denied.status).toBe(403);
      expect(denied.body.error?.code).toBe('NOT_AUTHORIZED');
    }

    // ...and the installation caller still succeeds right after the refusal.
    const allowed = await rpc(running, 'secret.set', { ref: SECRET_REF, value: DECOY });
    expect(allowed.status).toBe(200);
    expect(running.secrets.has(SECRET_REF)).toBe(true);
  });

  it('accepts a tool-audience secret and refuses an unknown audience', async () => {
    const running = await start();
    const toolRef = 'tool/token';
    const set = await rpc(running, 'secret.set', { ref: toolRef, value: DECOY, audience: 'tool' });
    expect(set.status).toBe(200);
    expect(set.body.result).toMatchObject({ ref: toolRef, configured: true });
    expect(running.secrets.list().find((entry) => entry.ref === toolRef)?.audience).toBe('tool');

    const unknown = await rpc(running, 'secret.set', { ref: toolRef, value: DECOY, audience: 'x' });
    expect(unknown.status).toBe(422);
    expect(unknown.body.error?.code).toBe('VALIDATION_ERROR');
    expect(unknown.text).not.toContain(DECOY);
  });
});

describe('tolerant startup against unusable secret files (W12T1-01)', () => {
  it('starts and lists despite a foreign keychain index and a corrupt record', async () => {
    const paths = secretRepositoryPaths(home);
    mkdirSync(paths.dir, { recursive: true, mode: 0o700 });
    // The old shared-directory layout plus arbitrary junk at the root of the store.
    writeFileSync(join(paths.dir, 'keychain.json'), '{"v":1,"entries":[]}\n');
    writeFileSync(join(paths.dir, 'garbage.json'), 'this is not JSON\n');
    // One real record and one corrupt file *inside* the file namespace.
    createSecretRepository({ home, backend: 'file' }).set(SECRET_REF, DECOY);
    mkdirSync(paths.fileDir, { recursive: true, mode: 0o700 });
    writeFileSync(join(paths.fileDir, 'garbage.json'), 'this is not JSON\n');

    const running = await start();
    expect(running.instances).toHaveLength(1);
    expect(running.secrets.has(SECRET_REF)).toBe(true);
    expect(logs.join('\n')).toContain('ignoring an unusable secret file');
    expect(logs.join('\n')).not.toContain(DECOY);

    const list = await rpc(running, 'secret.list');
    expect(list.status).toBe(200);
    const items = (list.body.result?.['items'] ?? []) as { ref: string }[];
    expect(items.map((entry) => entry.ref)).toEqual([SECRET_REF]);
    const problems = (list.body.result?.['problems'] ?? []) as { code: string; path: string }[];
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ code: 'SECRET_RECORD_INVALID' });
    expect(problems[0]?.path).toContain('garbage.json');
  });

  it('starts with an undecryptable record and reports it as unreadable', async () => {
    const paths = secretRepositoryPaths(home);
    createSecretRepository({ home, backend: 'file' }).set(SECRET_REF, DECOY);
    // A different 32-byte key: the record survives, its value does not.
    writeFileSync(paths.masterKey, `${Buffer.alloc(32, 9).toString('base64')}\n`, {
      mode: 0o600,
    });

    const running = await start();
    expect(running.secrets.has(SECRET_REF)).toBe(false);
    expect(logs.join('\n')).toContain('could not be loaded');
    expect(logs.join('\n')).not.toContain(DECOY);

    const list = await rpc(running, 'secret.list');
    const items = (list.body.result?.['items'] ?? []) as {
      ref: string;
      configured: boolean;
      health: string;
      issue?: { code: string };
    }[];
    expect(items[0]).toMatchObject({
      ref: SECRET_REF,
      configured: false,
      health: 'unreadable',
      issue: { code: 'SECRET_DECRYPT_FAILED' },
    });
    // `config.get` stays honest instead of turning into an error.
    const config = await rpc(running, 'config.get', { scope: 'global' });
    const providers = (config.body.result?.['providers'] ?? []) as { secretConfigured: boolean }[];
    expect(providers[0]?.secretConfigured).toBe(false);
  });
});

describe('startup load from the durable repository', () => {
  it('re-registers a secret registered by a previous daemon', async () => {
    const first = await start();
    const set = await rpc(first, 'secret.set', { ref: SECRET_REF, value: DECOY });
    expect(set.status).toBe(200);
    await first.stop();
    runtime = undefined;

    const second = await start();
    // Loaded before any execution stack was built, so `gateway` resolution works now.
    expect(second.secrets.has(SECRET_REF)).toBe(true);

    const config = await rpc(second, 'config.get', { scope: 'global' });
    const providers = (config.body.result?.['providers'] ?? []) as { secretConfigured: boolean }[];
    expect(providers[0]?.secretConfigured).toBe(true);
    expect(logs.join('\n')).toContain('loaded 1 secret');
    expect(logs.join('\n')).not.toContain(DECOY);
  });
});
