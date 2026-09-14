/**
 * CLI runtime command integration test (WP-11 A1-T3).
 *
 * The CLI is driven exactly as a user drives it (`agentdev start/status/open/stop`) and
 * the daemon it starts is a **real child process** loading the repository sources, so
 * the test covers the whole documented path: spawn, single-instance lock, live record,
 * admin surface with the 0600 credential, project opening, graceful stop.
 *
 * `reliability.md` §7: "CLI命令契约：… start/stop/status；open <path>；… 失败退出非零并
 * 输出error code和operationId；status只读".
 */
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createNodeWorktreeGitPort } from '@agentdev/workspace';

import { main } from '../src/cli.js';

const repoRoot = join(import.meta.dirname, '..', '..', '..');
let home: string;
let repo: string;
const originalEnv = { ...process.env };

interface RunResult {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

/** Runs the CLI in-process with captured IO, as `agentdev <args>` would. */
async function runCli(args: readonly string[]): Promise<RunResult> {
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
  });
  return { code, out, err };
}

const gitPort = createNodeWorktreeGitPort();

function seedRepo(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `agentdev-cli-${name}-`));
  const init = gitPort.initRepository(dir, { branch: 'agentdev/main' });
  if (!init.ok) throw new Error(`git init failed: ${init.errors[0]?.message ?? 'unknown'}`);
  writeFileSync(join(dir, 'README.md'), '# seeded\n');
  const commit = gitPort.commitPaths(dir, 'chore: seed', ['README.md']);
  if (!commit.ok) throw new Error(`git commit failed: ${commit.errors[0]?.message ?? 'unknown'}`);
  return dir;
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'agentdev-cli-home-'));
  repo = seedRepo('repo');
  // Point the CLI at the daemon's *source* entry through the repository's own source
  // resolver: this is what a development run uses, and it is the same loader the
  // release drills use. `pnpm build` + the default dist entry is the shipped path.
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
});

afterEach(async () => {
  // Never leave a daemon behind, even when an assertion failed mid-test.
  await runCli(['stop']);
  process.env = { ...originalEnv };
  rmSync(home, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
});

describe('agentdev runtime commands', () => {
  it('starts, reports status, opens a project and stops', async () => {
    const status0 = await runCli(['status']);
    expect(status0.code).toBe(0);
    expect(JSON.parse(status0.out)).toMatchObject({ running: false });

    const started = await runCli(['start']);
    expect(started.code).toBe(0);
    const startBody = JSON.parse(started.out) as {
      started: boolean;
      pid: number;
      instances: unknown[];
    };
    expect(startBody.started).toBe(true);
    expect(startBody.pid).toBeGreaterThan(0);

    const opened = await runCli(['open', repo]);
    expect(opened.code).toBe(0);
    const openedBody = JSON.parse(opened.out) as {
      instance: {
        projectId: string;
        root: string;
        daemon: { port: number };
        web: { port: number };
      };
    };
    expect(openedBody.instance.root).toBe(realpathSync(repo));
    expect(openedBody.instance.daemon.port).toBeGreaterThan(0);
    expect(openedBody.instance.web.port).toBeGreaterThan(0);

    // `open` on the same root is idempotent (`protocol.md` §5).
    const again = await runCli(['open', repo]);
    expect(again.code).toBe(0);
    expect((JSON.parse(again.out) as { instance: { projectId: string } }).instance.projectId).toBe(
      openedBody.instance.projectId,
    );

    const status1 = await runCli(['status']);
    expect(status1.code).toBe(0);
    const statusBody = JSON.parse(status1.out) as {
      running: boolean;
      runtime: { instances: unknown[] };
    };
    expect(statusBody.running).toBe(true);
    expect(statusBody.runtime.instances).toHaveLength(1);

    // A second `start` is idempotent, not a second daemon.
    const second = await runCli(['start']);
    expect(second.code).toBe(0);
    expect((JSON.parse(second.out) as { already?: boolean }).already).toBe(true);

    const stopped = await runCli(['stop']);
    expect(stopped.code).toBe(0);
    expect((JSON.parse(stopped.out) as { stopped: boolean }).stopped).toBe(true);

    const status2 = await runCli(['status']);
    expect(status2.code).toBe(0);
    expect(JSON.parse(status2.out)).toMatchObject({ running: false });
  }, 60_000);

  it('starts with a root directly and reports the web URL', async () => {
    const started = await runCli(['start', '--root', repo]);
    expect(started.code).toBe(0);
    const body = JSON.parse(started.out) as {
      instances: { root: string; web: { port: number } }[];
    };
    expect(body.instances).toHaveLength(1);
    expect(body.instances[0]?.root).toBe(realpathSync(repo));
    expect(body.instances[0]?.web.port).toBeGreaterThan(0);
  }, 60_000);

  it('fails with an error code when the daemon entry cannot be found', async () => {
    process.env.AGENTDEV_DAEMON_ENTRY = join(home, 'missing-entry.mjs');
    const started = await runCli(['start']);
    expect(started.code).toBe(1);
    const body = JSON.parse(started.err.trim()) as { error: { code: string } };
    expect(body.error.code).toBe('START_FAILED');
  });

  it('reports open without a path as a validation error', async () => {
    const opened = await runCli(['open']);
    expect(opened.code).toBe(1);
    expect((JSON.parse(opened.err.trim()) as { error: { code: string } }).error.code).toBe(
      'VALIDATION_ERROR',
    );
  });

  it('reports an unreadable runtime record with an operationId instead of crashing', async () => {
    // The daemon publishes `runtime.json` before its admin listener binds, so a record
    // whose `admin.port` is still 0 is a real intermediate state. Neither `status`, `stop`
    // nor `start` may die with a raw stack trace (WP-11 leftover; `reliability.md` §7).
    writeFileSync(
      join(home, 'runtime.json'),
      `${JSON.stringify({
        v: 1,
        pid: 1,
        epoch: 1,
        startedAt: '2026-09-14T00:00:00.000Z',
        version: '0.0.0',
        home,
        admin: { host: '127.0.0.1', port: 0 },
        instances: [],
      })}\n`,
    );

    for (const command of [['status'], ['stop']] as const) {
      const result = await runCli([...command]);
      expect(result.code).toBe(1);
      const body = JSON.parse(result.err.trim()) as {
        error: { code: string };
        operationId: string;
      };
      expect(body.error.code).toBe('RUNTIME_RECORD_INVALID');
      expect(body.operationId).toMatch(/^[0-9a-f-]{36}$/u);
    }

    // `start` takes over the stale record and publishes a valid one.
    const started = await runCli(['start']);
    expect(started.code).toBe(0);
    expect(JSON.parse(started.out)).toMatchObject({ started: true });
    const status = await runCli(['status']);
    expect(JSON.parse(status.out)).toMatchObject({ running: true });
  }, 60_000);

  it('keeps the daemon epoch strictly increasing across a clean stop and start', async () => {
    // `reliability.md` §7 fences an old writer by epoch. A clean `stop` removes the lock,
    // so the next start used to reuse epoch 1 (WP-11 T-03); the installation's high-water
    // mark makes the fence monotonic across real process lifecycles.
    const first = await runCli(['start']);
    expect(first.code).toBe(0);
    const firstEpoch = (JSON.parse(first.out) as { epoch: number }).epoch;
    expect(firstEpoch).toBeGreaterThan(0);

    const stopped = await runCli(['stop']);
    expect(stopped.code).toBe(0);

    const second = await runCli(['start']);
    expect(second.code).toBe(0);
    const secondEpoch = (JSON.parse(second.out) as { epoch: number }).epoch;
    expect(secondEpoch).toBeGreaterThan(firstEpoch);
  }, 60_000);

  it('fails a damaged record with a code and operationId and leaves no stale lock', async () => {
    // A previous daemon died after publishing a half-written `runtime.json`, and its
    // credential file is unusable (a directory where the token should be), so the next
    // daemon refuses to start after taking the lock. Every failure must still carry the
    // established error code and an operationId, and the lock the failing daemon took must
    // not be left behind (WP-11 T-04; `reliability.md` §7).
    writeFileSync(join(home, 'runtime.json'), '{ "v": 1, "pid": 1');
    mkdirSync(join(home, 'installation-token'), { recursive: true });

    const started = await runCli(['start']);
    expect(started.code).toBe(1);
    const body = JSON.parse(started.err.trim()) as {
      error: { code: string };
      operationId: string;
    };
    expect(body.operationId).toMatch(/^[0-9a-f-]{36}$/u);
    // Deterministic: the failing daemon never rewrites the truncated record, so the probe
    // stays unreadable for the whole deadline. A tolerant match would let a regression back
    // to `START_TIMEOUT` slip through (T8b P3-3).
    expect(body.error.code).toBe('RUNTIME_RECORD_INVALID');
    expect(existsSync(join(home, 'daemon.lock'))).toBe(false);
  }, 60_000);
});
