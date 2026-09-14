/**
 * An asynchronous child-process port that owns a **process group**.
 *
 * `docs/architecture/reliability.md` §6 fixes the cancellation contract this module
 * implements — "用户取消：…停止新工具→SIGTERM后10秒SIGKILL工具进程树" — and §5 the
 * timeout rule: "Shell超时终止进程组，清理端口/容器/临时DB". The Broker's historical
 * port (`defaultProcessRunner`) used `spawnSync`, which blocks the daemon's event loop
 * for the whole tool call, cannot be cancelled, and signals only the direct child. This
 * module is the replacement the tool path uses:
 *
 * - **asynchronous** — the daemon keeps answering heartbeats and reading the mailbox
 *   while a shell runs (AC-056's 1s mailbox answer, `reliability.md` §2's 5s heartbeat);
 * - **own process group** — every child is spawned `detached`, so `SIGTERM`/`SIGKILL`
 *   sent to the negative pid reaches the whole tree a shell command built, not only
 *   `/bin/sh`;
 * - **escalating cancellation** — a timeout or an `AbortSignal` sends `SIGTERM`, waits
 *   `cancelGraceMs` (`LIMITS.cancelGraceSec`, 10s), then `SIGKILL`s the group;
 * - **bounded output** — a call that floods stdout is killed and reported with its
 *   partial output and a typed `error`, never buffered without limit.
 *
 * A caller that needs to clean up later registers the returned
 * {@link AsyncProcessHandle} in `tool-processes.ts`, which keys the handles by Attempt
 * so `onAttemptEnded`, a cancel and daemon shutdown all reach them.
 */
import { spawn } from 'node:child_process';
import { LIMITS } from '@agentdev/contracts';
import type { ProcessResult, ProcessRunOptions } from './broker.js';

/**
 * One finished child process.
 *
 * Extends the Broker's {@link ProcessResult} so both ports describe a run the same way;
 * `timedOut`/`cancelled` say **why** the call ended, which the tool result carries back
 * to the model (`reliability.md` §2 keeps the outcome honest instead of pretending a
 * killed command succeeded).
 */
export interface AsyncProcessResult extends ProcessResult {
  /** The process was still running when its deadline passed and was terminated. */
  readonly timedOut?: boolean;
  /** The caller aborted (or the tool was cancelled) while the child was running. */
  readonly cancelled?: boolean;
  /** The process-group leader, for diagnostics and for `kill(-pid)` cleanup. */
  readonly pid?: number;
  /** Process exit time in milliseconds, measured by this module. */
  readonly durationMs: number;
}

export interface AsyncProcessOptions extends ProcessRunOptions {
  /** Aborting cancels the process group with the same SIGTERM→SIGKILL escalation. */
  readonly signal?: AbortSignal | undefined;
  /** Grace between `SIGTERM` and `SIGKILL`; defaults to `LIMITS.cancelGraceSec`. */
  readonly cancelGraceMs?: number;
  /** Ceiling for stdout+stderr before the call is killed. Defaults to 16 MiB. */
  readonly maxBufferBytes?: number;
}

/** One live child process, addressable so a supervisor can cancel it. */
export interface AsyncProcessHandle {
  readonly pid: number | undefined;
  readonly command: string;
  /** Resolves exactly once, when the process tree has been reaped. */
  readonly done: Promise<AsyncProcessResult>;
  /** Whether the process already ended. */
  readonly settled: boolean;
  /**
   * Terminates the process group.
   *
   * Idempotent: a second call on a settled process is a no-op, and the escalation timer
   * is only armed once. `SIGTERM` is sent immediately and `SIGKILL` after the grace
   * period, so a command that ignores the polite signal still dies
   * (`reliability.md` §6).
   */
  cancel(reason?: 'timeout' | 'cancelled'): void;
}

/**
 * The seam the Broker uses for real tool processes.
 *
 * `start` is the cancellation-aware form; `run` is the convenience awaiting it. Tests
 * inject a recorder instead, so "a refusal spawned nothing" is provable.
 */
export interface AsyncProcessRunner {
  start(
    command: string,
    args: readonly string[],
    options?: AsyncProcessOptions,
  ): AsyncProcessHandle;
  run(
    command: string,
    args: readonly string[],
    options?: AsyncProcessOptions,
  ): Promise<AsyncProcessResult>;
}

const DEFAULT_MAX_BUFFER_BYTES = 16 * 1024 * 1024;

/**
 * Stops one process group.
 *
 * A negative pid signals the whole group (`detached: true` makes the child a group
 * leader), which is what reaches a shell's grandchildren. `ESRCH` means the group is
 * already gone and is not an error; anything else is reported to the caller's `log`
 * nowhere — the result itself carries the observable outcome.
 */
function signalGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    // The group is already reaped, or the platform refused the negative pid; either
    // way there is nothing left to kill and the `close` event settles the handle.
  }
}

function groupAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * The production runner: `spawn` with `detached: true`, output caps and cancellation.
 */
export const defaultAsyncProcessRunner: AsyncProcessRunner = {
  start(command, args, options = {}) {
    const startedAt = Date.now();
    const cancelGraceMs = options.cancelGraceMs ?? LIMITS.cancelGraceSec.default * 1000;
    const maxBufferBytes = options.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES;
    const detached = process.platform !== 'win32';
    const child = spawn(command, [...args], {
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      env: options.env === undefined ? process.env : { ...process.env, ...options.env },
      detached,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let overflowed = false;
    let spawnError: Error | undefined;
    let settled = false;
    let terminating = false;
    let timedOut = false;
    let cancelled = false;
    let graceTimer: NodeJS.Timeout | undefined;
    let deadline: NodeJS.Timeout | undefined;

    const collect = (into: Buffer[], chunk: Buffer, kind: 'stdout' | 'stderr'): void => {
      if (kind === 'stdout') {
        stdoutBytes += chunk.length;
      } else {
        stderrBytes += chunk.length;
      }
      into.push(chunk);
      if (stdoutBytes + stderrBytes > maxBufferBytes && !overflowed) {
        overflowed = true;
        terminate('cancelled', `tool output exceeded ${String(maxBufferBytes)} bytes`);
      }
    };

    child.stdout?.on('data', (chunk: Buffer) => {
      collect(stdout, chunk, 'stdout');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      collect(stderr, chunk, 'stderr');
    });
    child.on('error', (error: Error) => {
      spawnError = error;
    });

    const pid = child.pid;

    const terminate = (reason: 'timeout' | 'cancelled', note?: string): void => {
      if (settled || terminating) return;
      terminating = true;
      if (reason === 'timeout') timedOut = true;
      if (reason === 'cancelled') cancelled = true;
      if (note !== undefined) spawnError = new Error(note);
      if (deadline !== undefined) {
        clearTimeout(deadline);
        deadline = undefined;
      }
      if (pid === undefined || !detached) {
        child.kill('SIGTERM');
        return;
      }
      signalGroup(pid, 'SIGTERM');
      graceTimer = setTimeout(() => {
        if (!settled && groupAlive(pid)) signalGroup(pid, 'SIGKILL');
      }, cancelGraceMs);
      graceTimer.unref();
    };

    if (options.signal !== undefined) {
      if (options.signal.aborted) {
        terminate('cancelled');
      } else {
        options.signal.addEventListener('abort', () => {
          terminate('cancelled');
        });
      }
    }

    const timeoutMs = options.timeoutMs;
    if (timeoutMs !== undefined && timeoutMs > 0) {
      deadline = setTimeout(() => {
        terminate('timeout');
      }, timeoutMs);
      deadline.unref();
    }

    if (options.stdin !== undefined && child.stdin !== undefined) {
      child.stdin.end(options.stdin);
    } else {
      child.stdin?.end();
    }

    /** Buffers collected so far, decoded as UTF-8 like the synchronous port did. */
    const textOf = (chunks: readonly Buffer[]): string => Buffer.concat(chunks).toString('utf8');

    const done = new Promise<AsyncProcessResult>((resolve) => {
      child.on('close', (status: number | null, signal: NodeJS.Signals | null) => {
        settled = true;
        if (deadline !== undefined) clearTimeout(deadline);
        if (graceTimer !== undefined) clearTimeout(graceTimer);
        resolve({
          // A child that never started reports no exit status, matching the
          // synchronous port (`spawnSync` returns `status: null` plus `error`); Node's
          // `close` otherwise carries the negative errno as the code.
          status: spawnError === undefined ? status : null,
          stdout: textOf(stdout),
          stderr: textOf(stderr),
          signal,
          ...(spawnError === undefined ? {} : { error: spawnError.message }),
          ...(timedOut ? { timedOut: true } : {}),
          ...(cancelled ? { cancelled: true } : {}),
          ...(pid === undefined ? {} : { pid }),
          durationMs: Date.now() - startedAt,
        });
      });
    });

    return {
      pid,
      command,
      done,
      get settled() {
        return settled;
      },
      cancel: (reason = 'cancelled') => {
        terminate(reason);
      },
    };
  },

  run(command, args, options = {}) {
    return this.start(command, args, options).done;
  },
};
