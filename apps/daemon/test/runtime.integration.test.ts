/**
 * Runtime host integration test (WP-11 A1-T2/A1-T3).
 *
 * This is the first test that starts the *product* the way a user does: a real state
 * home, a real single-instance lock, real per-project listeners, the real BFF and the
 * loopback admin surface the CLI talks to. Nothing is stubbed except the Provider, which
 * no check here calls.
 *
 * `reliability.md` §7 is the contract: "daemon 获取每 Project 文件锁和 epoch 后加载
 * 数据库、迁移、检查 outbox/Run" and the daemon/BFF defaults from `protocol.md` §2.
 */
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createNodeWorktreeGitPort } from '@agentdev/workspace';
import { readInstallationCredential, readRuntimeRecord, RuntimeHomeError } from '@agentdev/core';

import { startRuntime, type RunningRuntime } from '../src/main.js';

let home: string;
let repo: string;
let runtime: RunningRuntime | undefined;

const gitPort = createNodeWorktreeGitPort();

/** Creates a real Git repository with one commit on the delivery branch. */
function seedRepo(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `agentdev-${name}-`));
  const init = gitPort.initRepository(dir, { branch: 'agentdev/main' });
  if (!init.ok) throw new Error(`git init failed: ${init.errors[0]?.message ?? 'unknown'}`);
  writeFileSync(join(dir, 'README.md'), '# seeded\n');
  const commit = gitPort.commitPaths(dir, 'chore: seed', ['README.md']);
  if (!commit.ok) throw new Error(`git commit failed: ${commit.errors[0]?.message ?? 'unknown'}`);
  return dir;
}

async function adminFetch(
  runtimeHome: RunningRuntime,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const token = readInstallationCredential(runtimeHome.home);
  return fetch(`http://127.0.0.1:${String(runtimeHome.admin.port)}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(init.headers ?? {}),
    },
  });
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'agentdev-home-'));
  repo = seedRepo('runtime-repo');
});

afterEach(async () => {
  await runtime?.stop();
  runtime = undefined;
  rmSync(home, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
});

describe('startRuntime', () => {
  it('opens the registered project, writes the live record and serves health', async () => {
    runtime = await startRuntime({
      home,
      roots: [repo],
      trust: true,
      daemonPort: 0,
      webPort: 0,
      adminPort: 0,
      log: () => undefined,
    });

    const record = readRuntimeRecord(home);
    expect(record).not.toBeNull();
    expect(record?.pid).toBe(process.pid);
    expect(record?.epoch).toBe(runtime.epoch);
    expect(record?.instances).toHaveLength(1);
    const instance = record?.instances[0];
    // The runtime stores the canonical root (`ARCHITECTURE.md` §4).
    expect(instance?.root).toBe(realpathSync(repo));
    expect(instance?.daemon.port).toBeGreaterThan(0);
    expect(instance?.web?.port).toBeGreaterThan(0);

    // The admin surface is the CLI's entry point and requires the credential.
    const unauthorized = await fetch(`http://127.0.0.1:${String(runtime.admin.port)}/health`);
    expect(unauthorized.status).toBe(401);
    const health = await adminFetch(runtime, '/health');
    expect(health.status).toBe(200);
    const healthText = await health.text();
    const body = JSON.parse(healthText) as {
      ready: boolean;
      projects: number;
      execution: { enabled: boolean; live: number };
    };
    expect(body.ready).toBe(true);
    expect(body.projects).toBe(1);
    // The daemon really owns an executor: one stack per opened project, supervisor
    // running, no Attempt live yet (WP-11 A2-T6).
    expect(body.execution).toEqual({ enabled: true, live: 0 });
    expect(runtime.executions).toHaveLength(1);
    expect(runtime.executions[0]?.liveCount()).toBe(0);

    // R2-03: health carries no filesystem path — no installation home, no project root —
    // at any depth of the response body.
    for (const path of [home, repo, realpathSync(repo)]) {
      expect(healthText).not.toContain(path);
    }
    expect(healthText).not.toContain('"root"');

    // The daemon's own health route reports Core readiness (`protocol.md` §7) and is
    // likewise path-free.
    const daemonHealth = await fetch(
      `http://127.0.0.1:${String(instance?.daemon.port ?? 0)}/healthz`,
    );
    expect(daemonHealth.status).toBe(200);
    const daemonHealthText = await daemonHealth.text();
    const daemonBody = JSON.parse(daemonHealthText) as { ready?: boolean; version?: string };
    expect(daemonBody.ready).toBe(true);
    expect(daemonBody.version).toBeDefined();
    for (const path of [home, repo, realpathSync(repo)]) {
      expect(daemonHealthText).not.toContain(path);
    }

    // A real protocol call answers over the real HTTP surface with the credential.
    const rpc = await fetch(`http://127.0.0.1:${String(instance?.daemon.port ?? 0)}/rpc`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${readInstallationCredential(home)}`,
      },
      body: JSON.stringify({
        v: 1,
        type: 'request',
        id: 'req-1',
        method: 'project.list',
        params: {},
      }),
    });
    expect(rpc.status).toBe(200);
    const answer = (await rpc.json()) as { ok: boolean; result?: { items?: unknown[] } };
    expect(answer.ok).toBe(true);
    expect(answer.result?.items?.length).toBeGreaterThan(0);
  });

  it('refuses a second daemon on the same home', async () => {
    runtime = await startRuntime({
      home,
      roots: [repo],
      daemonPort: 0,
      webPort: 0,
      adminPort: 0,
      log: () => undefined,
    });
    await expect(
      startRuntime({
        home,
        roots: [repo],
        daemonPort: 0,
        webPort: 0,
        adminPort: 0,
        log: () => undefined,
      }),
    ).rejects.toThrowError(RuntimeHomeError);
  });

  it('opens another project through the admin surface and records it', async () => {
    const second = seedRepo('runtime-repo-2');
    try {
      runtime = await startRuntime({
        home,
        roots: [],
        daemonPort: 0,
        webPort: 0,
        adminPort: 0,
        log: () => undefined,
      });
      expect(runtime.instances).toHaveLength(0);
      const opened = await adminFetch(runtime, '/projects', {
        method: 'POST',
        body: JSON.stringify({ root: second, trust: true }),
      });
      expect(opened.status).toBe(200);
      const body = (await opened.json()) as { instance: { root: string; projectId: string } };
      expect(body.instance.root).toBe(realpathSync(second));
      expect(runtime.instances).toHaveLength(1);
      expect(readRuntimeRecord(home)?.instances).toHaveLength(1);

      // Opening the same root twice is idempotent, not a second runtime.
      const again = await adminFetch(runtime, '/projects', {
        method: 'POST',
        body: JSON.stringify({ root: second, trust: true }),
      });
      expect(again.status).toBe(200);
      expect(runtime.instances).toHaveLength(1);
    } finally {
      rmSync(second, { recursive: true, force: true });
    }
  });

  it('stops gracefully: listeners close, the record and the lock are removed', async () => {
    runtime = await startRuntime({
      home,
      roots: [repo],
      daemonPort: 0,
      webPort: 0,
      adminPort: 0,
      log: () => undefined,
    });
    const adminPort = runtime.admin.port;
    await runtime.stop();
    expect(readRuntimeRecord(home)).toBeNull();
    await expect(fetch(`http://127.0.0.1:${String(adminPort)}/health`)).rejects.toThrow();
    runtime = undefined;
  });

  it('reopens the projects recorded in the registry when no root is given', async () => {
    // `agentdev start` with no `--root` must serve what this installation already knows
    // (`WP11R1-08`): stop, drop the in-memory state, start again.
    const first = await startRuntime({
      home,
      roots: [repo],
      trust: true,
      daemonPort: 0,
      webPort: 0,
      adminPort: 0,
      log: () => undefined,
    });
    await first.stop();
    runtime = await startRuntime({
      home,
      daemonPort: 0,
      webPort: 0,
      adminPort: 0,
      log: () => undefined,
    });
    expect(runtime.instances).toHaveLength(1);
    expect(runtime.instances[0]?.root).toBe(realpathSync(repo));
    const health = await adminFetch(runtime, '/health');
    const body = (await health.json()) as { projects: number };
    expect(body.projects).toBe(1);
  });

  it('rejects a root that is not a Git repository', async () => {
    const plain = mkdtempSync(join(tmpdir(), 'agentdev-plain-'));
    try {
      await expect(
        startRuntime({
          home,
          roots: [plain],
          daemonPort: 0,
          webPort: 0,
          adminPort: 0,
          log: () => undefined,
        }),
      ).rejects.toThrowError(/not inside a Git repository/u);
      // A failed start leaves no lock behind.
      expect(readRuntimeRecord(home)).toBeNull();
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });
});
