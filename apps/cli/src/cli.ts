#!/usr/bin/env node
/**
 * `agentdev` command line entry point.
 *
 * WP-00 ships exactly one real command — `doctor` — because AC-048 requires the
 * environment to be probed before anything runs. Commands owned by later work
 * packages are not present here: an unimplemented command must fail loudly
 * rather than pretend, which is what the root `test:*` scripts do.
 */
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { PROTOCOL_VERSION } from '@agentdev/contracts';
import { buildDoctorReport, renderDoctorReport, repoRootFrom } from './doctor.js';
import {
  adminRequest,
  cliHome,
  daemonLogTail,
  readLiveRecord,
  repoRootOf,
  spawnDaemon,
  waitForRuntime,
  waitForStop,
} from './runtime.js';

const USAGE = [
  'usage: agentdev <command> [options]',
  '',
  'commands:',
  '  doctor [--json]   probe node/pnpm/git/Pi SDK/Docker, directories and ports',
  '  start [--root <path>]...  start the daemon and the web workbench',
  '  stop              stop them gracefully',
  '  status            read-only: is the runtime up, and where',
  '  open <path>       register and open a project, printing its URL',
  '  version           print the CLI and protocol version',
].join('\n');

export interface CliIo {
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
  readonly exit: (code: number) => void;
}

export async function main(
  argv: readonly string[],
  io: CliIo = {
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
    exit: (code) => process.exit(code),
  },
): Promise<void> {
  const [command, ...rest] = argv;

  if (command === undefined || command === 'help' || command === '--help' || command === '-h') {
    io.out(`${USAGE}\n`);
    io.exit(command === undefined ? 2 : 0);
    return;
  }

  if (command === 'version') {
    io.out(`agentdev 0.0.0 (protocol ${PROTOCOL_VERSION})\n`);
    io.exit(0);
    return;
  }

  if (command === 'doctor') {
    const json = rest.includes('--json');
    const report = await buildDoctorReport({ startDir: repoRootFrom(import.meta.url) });
    if (json) {
      io.out(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      io.out(`${renderDoctorReport(report)}\n`);
    }
    io.exit(report.executionReady ? 0 : 1);
    return;
  }

  if (command === 'start' || command === 'stop' || command === 'status' || command === 'open') {
    const home = cliHome();
    const repoRoot = repoRootOf(import.meta.url);
    io.exit(await runRuntimeCommand({ command, rest, home, repoRoot, io }));
    return;
  }

  io.err(`unknown command: ${command}\n${USAGE}\n`);
  io.exit(2);
}

/** Implements `start`, `stop`, `status` and `open` (`reliability.md` §7). */
async function runRuntimeCommand(input: {
  readonly command: 'start' | 'stop' | 'status' | 'open';
  readonly rest: readonly string[];
  readonly home: string;
  readonly repoRoot: string;
  readonly io: CliIo;
}): Promise<number> {
  const { command, rest, home, repoRoot, io } = input;
  const print = (value: unknown): void => {
    io.out(`${JSON.stringify(value, null, 2)}\n`);
  };
  const failure = (code: string, message: string): number => {
    // `reliability.md` §7: a failing command reports an error code *and* an operationId.
    io.err(
      `${JSON.stringify({ ok: false, error: { code, message }, operationId: randomUUID() })}\n`,
    );
    return 1;
  };

  if (command === 'status') {
    // A stopped runtime is a valid, successful answer: `status` is read-only.
    let live;
    try {
      live = readLiveRecord(home);
    } catch (error) {
      return failure(
        'RUNTIME_RECORD_INVALID',
        error instanceof Error ? error.message : String(error),
      );
    }
    if (live === null) {
      print({ ok: true, running: false, home });
      return 0;
    }
    try {
      const health = await adminRequest(home, live.record.admin, 'GET', '/health');
      print({
        ok: true,
        running: health.status === 200,
        home,
        runtime: live.record,
        health: health.body,
      });
      return health.status === 200 ? 0 : 1;
    } catch (error) {
      // The record exists but nothing answers: report it instead of pretending the
      // runtime is healthy (a crashed daemon leaves no record, so this is a race).
      print({ ok: true, running: false, home, runtime: live.record, unreachable: String(error) });
      return 1;
    }
  }

  if (command === 'stop') {
    const live = readLiveRecord(home);
    if (live === null) {
      print({ ok: true, stopped: true, already: true, home });
      return 0;
    }
    let asked: boolean;
    try {
      const response = await adminRequest(home, live.record.admin, 'POST', '/stop', {});
      asked = response.status === 202 || response.status === 200;
    } catch {
      asked = false;
    }
    if (!asked) {
      // The admin surface is gone but the record remains: fall back to a signal, which
      // the host handles the same way (`SIGTERM` → graceful stop).
      try {
        process.kill(live.record.pid, 'SIGTERM');
      } catch (error) {
        return failure(
          'STOP_FAILED',
          `cannot signal pid ${String(live.record.pid)}: ${String(error)}`,
        );
      }
    }
    if (await waitForStop(home)) {
      print({ ok: true, stopped: true, home, pid: live.record.pid });
      return 0;
    }
    try {
      process.kill(live.record.pid, 'SIGKILL');
    } catch {
      // Already gone between the wait and the kill.
    }
    if (await waitForStop(home, { timeoutMs: 5_000 })) {
      print({ ok: true, stopped: true, forced: true, home, pid: live.record.pid });
      return 0;
    }
    return failure(
      'STOP_TIMEOUT',
      `agentdevd (pid ${String(live.record.pid)}) did not stop in time`,
    );
  }

  if (command === 'open') {
    const path = rest[0];
    if (path === undefined || path.trim().length === 0)
      return failure('VALIDATION_ERROR', 'open requires a path');
    let live;
    try {
      live = readLiveRecord(home);
    } catch (error) {
      return failure(
        'RUNTIME_RECORD_INVALID',
        error instanceof Error ? error.message : String(error),
      );
    }
    if (live === null || (await waitForRuntime(home, { timeoutMs: 0 })) === null) {
      const started = await startDaemon({ home, repoRoot, io, roots: [], trust: false });
      if (started !== 0) return started;
      live = readLiveRecord(home);
      if (live === null)
        return failure('START_FAILED', 'the daemon did not publish a runtime record');
    }
    try {
      const opened = await adminRequest(home, live.record.admin, 'POST', '/projects', {
        root: path,
        trust: true,
      });
      io.out(`${JSON.stringify(opened.body, null, 2)}\n`);
      return opened.status === 200 ? 0 : 1;
    } catch (error) {
      return failure('PROJECT_OPEN_FAILED', error instanceof Error ? error.message : String(error));
    }
  }

  // start
  const roots: string[] = [];
  let trust = false;
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === '--root') {
      index += 1;
      const value = rest[index];
      if (value === undefined) return failure('VALIDATION_ERROR', '--root requires a path');
      roots.push(value);
      trust = true;
    } else {
      return failure('VALIDATION_ERROR', `unknown option: ${arg}`);
    }
  }
  const existing = await waitForRuntime(home, { timeoutMs: 0 });
  if (existing !== null) {
    print({ ok: true, started: false, already: true, home, runtime: existing.record });
    return 0;
  }
  return startDaemon({ home, repoRoot, io, roots, trust });
}

/** Spawns the daemon host and waits until it answers, or reports why it did not. */
async function startDaemon(input: {
  readonly home: string;
  readonly repoRoot: string;
  readonly io: CliIo;
  readonly roots: readonly string[];
  readonly trust: boolean;
}): Promise<number> {
  const { home, repoRoot, io, roots, trust } = input;
  try {
    spawnDaemon({ home, repoRoot, roots, trust });
  } catch (error) {
    io.err(
      `${JSON.stringify({ ok: false, error: { code: 'START_FAILED', message: String(error) } })}\n`,
    );
    return 1;
  }
  const live = await waitForRuntime(home);
  if (live === null) {
    io.err(
      `${JSON.stringify({
        ok: false,
        operationId: randomUUID(),
        error: {
          code: 'START_TIMEOUT',
          message: 'the daemon did not become ready; see the log tail',
          logTail: daemonLogTail(home),
        },
      })}\n`,
    );
    return 1;
  }
  io.out(
    `${JSON.stringify(
      {
        ok: true,
        started: true,
        home,
        pid: live.record.pid,
        epoch: live.record.epoch,
        instances: live.record.instances,
      },
      null,
      2,
    )}\n`,
  );
  return 0;
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  await main(process.argv.slice(2));
}
