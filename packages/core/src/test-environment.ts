/**
 * Isolated test environments for Review/Test and command verification.
 *
 * `docs/architecture/execution.md` §5 fixes the promise: "服务端口由Supervisor动态
 * 分配，测试DB以attempt命名，跨Task数据库不共享。Shell超时终止进程组，清理端口/
 * 容器/临时DB；清理失败记录recovery。" This module owns exactly that lifecycle:
 *
 * - **Isolation.** `create` allocates a port from a dedicated range and a database
 *   file inside a fresh temporary directory. Both are checked against the
 *   reserved development values the caller passes, so an environment can never
 *   reuse the dev DB or the dev port by accident.
 * - **Real processes.** `start` spawns the command as a detached process group
 *   and waits until its port accepts a connection; `run` executes a command
 *   inside the environment with `AGENTDEV_TEST_DB`/`PORT` pointing at that
 *   environment only.
 * - **Honest cleanup.** `stop` terminates the process group (SIGTERM, then
 *   SIGKILL) and `cleanup` removes the process, the temporary directory and the
 *   port registration. A cleanup step that fails is reported as
 *   `RECOVERY_REQUIRED` with the concrete failures — it is never swallowed, and
 *   every remaining step is still attempted so one failure does not hide another.
 *
 * The port is injectable for tests, but the default is a real probe of the OS
 * socket.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { uuidv7 } from '@agentdev/storage';
import type { BrokerErrorCode, ProcessResult } from './broker.js';

/** Default port window; deliberately disjoint from the daemon ports 4317/4318. */
export const DEFAULT_TEST_PORT_RANGE = { min: 4600, max: 4699 } as const;

/** Lifecycle states an environment is reported in. */
export type TestEnvironmentState = 'created' | 'running' | 'stopped' | 'failed' | 'cleanup_failed';

export interface TestEnvironment {
  readonly id: string;
  readonly workId: string;
  readonly attemptId: string;
  /** Temporary directory owned by this environment. */
  readonly dir: string;
  /** The environment's own SQLite file; never the dev database. */
  readonly dbPath: string;
  readonly host: string;
  readonly port: number;
  /** Environment handed to every command run inside it. */
  readonly env: Readonly<Record<string, string>>;
  readonly command: readonly string[];
  readonly state: TestEnvironmentState;
  readonly pid?: number;
  /** The dev values this environment must not reuse. */
  readonly reserved: { readonly port?: number; readonly dbPath?: string };
}

export interface SpawnOptions {
  readonly cwd: string;
  readonly env: Record<string, string>;
}

/** One started child, observed but not owned by the manager. */
export interface ProcessHandle {
  readonly pid: number | undefined;
  exited(): boolean;
  exitCode(): number | null;
  stdout(): string;
  stderr(): string;
  onExit(listener: () => void): void;
}

/**
 * The seam every filesystem/process operation goes through.
 *
 * Tests that must prove the cleanup failure path hand in a port whose `removeDir`
 * or `signal` throws, which is deterministic and needs no real broken host.
 */
export interface TestEnvironmentPorts {
  createDir(prefix: string): string;
  removeDir(path: string): void;
  writeFile(path: string, content: string): void;
  spawn(command: readonly string[], options: SpawnOptions): ProcessHandle;
  /** Signals a process *group* (negative pid), as `execution.md` §5 requires. */
  signal(pid: number, signal: NodeJS.Signals): void;
  alive(pid: number): boolean;
  run(
    command: readonly string[],
    options: SpawnOptions & { readonly timeoutMs: number },
  ): ProcessResult;
}

function toResult(result: {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly signal: NodeJS.Signals | null;
  readonly error?: Error;
}): ProcessResult {
  return result.error === undefined
    ? { status: result.status, stdout: result.stdout, stderr: result.stderr, signal: result.signal }
    : {
        status: result.status,
        stdout: result.stdout,
        stderr: result.stderr,
        signal: result.signal,
        error: result.error.message,
      };
}

/** The default ports: real temp dirs, real process groups, real SQLite file. */
export const defaultTestEnvironmentPorts: TestEnvironmentPorts = {
  createDir: (prefix) => mkdtempSync(join(tmpdir(), prefix)),
  removeDir: (path) => {
    rmSync(path, { recursive: true, force: true });
  },
  writeFile: (path, content) => {
    writeFileSync(path, content, { encoding: 'utf8', mode: 0o600 });
  },
  spawn: (command, options) => {
    const [bin, ...args] = command;
    if (bin === undefined) throw new Error('a test environment needs a command to start');
    const child: ChildProcess = spawn(bin, args, {
      cwd: options.cwd,
      env: options.env,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    const listeners: (() => void)[] = [];
    child.on('exit', () => {
      for (const listener of listeners.splice(0)) listener();
    });
    const exited = (): boolean => child.exitCode !== null || child.signalCode !== null;
    return {
      pid: child.pid,
      exited,
      exitCode: () => child.exitCode,
      stdout: () => stdout,
      stderr: () => stderr,
      onExit: (listener) => {
        if (exited()) listener();
        else listeners.push(listener);
      },
    };
  },
  signal: (pid, signal) => {
    // Negative pid targets the whole group, so a command that spawned helpers is
    // stopped with it (`execution.md` §5).
    process.kill(-pid, signal);
  },
  alive: (pid) => {
    try {
      process.kill(-pid, 0);
      return true;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code !== 'ESRCH';
    }
  },
  run: (command, options) => {
    const [bin, ...args] = command;
    if (bin === undefined) throw new Error('a test environment command needs a program');
    const result = spawnSync(bin, args, {
      cwd: options.cwd,
      env: options.env,
      encoding: 'utf8',
      timeout: options.timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
    });
    return toResult({
      status: result.status,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      signal: result.signal,
      ...(result.error === undefined ? {} : { error: result.error }),
    });
  },
};

export interface TestEnvironmentRequest {
  readonly workId: string;
  readonly attemptId: string;
  /** The command `start` launches; it must listen on `$PORT` to become ready. */
  readonly command: readonly string[];
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly portRange?: { readonly min: number; readonly max: number };
  /** Development port/database this environment must never reuse. */
  readonly reserved?: { readonly port?: number; readonly dbPath?: string };
  readonly readinessTimeoutMs?: number;
  readonly stopGraceMs?: number;
}

export type CreateOutcome =
  | { readonly ok: true; readonly environment: TestEnvironment }
  | { readonly ok: false; readonly code: BrokerErrorCode; readonly reason: string };

export type StartOutcome =
  | { readonly ok: true; readonly environment: TestEnvironment }
  | {
      readonly ok: false;
      readonly code: BrokerErrorCode;
      readonly reason: string;
      readonly environment: TestEnvironment;
    };

export type RunOutcome =
  | {
      readonly ok: true;
      readonly environment: TestEnvironment;
      readonly result: ProcessResult;
    }
  | {
      readonly ok: false;
      readonly code: BrokerErrorCode;
      readonly reason: string;
      readonly result?: ProcessResult;
    };

export type StopOutcome =
  | { readonly ok: true; readonly environment: TestEnvironment }
  | {
      readonly ok: false;
      readonly code: 'RECOVERY_REQUIRED';
      readonly reason: string;
      readonly failures: readonly string[];
      readonly environment: TestEnvironment;
    };

export type CleanupOutcome = StopOutcome;

export interface TestEnvironmentManagerOptions {
  readonly ports?: TestEnvironmentPorts;
  /** Prefix of the temporary directory; namespacing keeps parallel runs apart. */
  readonly prefix?: string;
  readonly readinessTimeoutMs?: number;
  readonly stopGraceMs?: number;
}

/**
 * Owns the lifetime of isolated test environments.
 *
 * Every method is explicit about failure: `create` reports the port pool
 * exhaustion, `start` reports a process that died before listening, and
 * `cleanup` reports each failed step as a recoverable state.
 */
export class TestEnvironmentManager {
  private readonly ports: TestEnvironmentPorts;
  private readonly prefix: string;
  private readonly readinessTimeoutMs: number;
  private readonly stopGraceMs: number;
  private readonly environments = new Map<string, TestEnvironment>();
  private readonly handles = new Map<string, ProcessHandle>();
  /** Ports this manager currently holds, so it never hands one out twice. */
  private readonly usedPorts = new Set<number>();

  constructor(options: TestEnvironmentManagerOptions = {}) {
    this.ports = options.ports ?? defaultTestEnvironmentPorts;
    this.prefix = options.prefix ?? 'agentdev-test-env-';
    this.readinessTimeoutMs = options.readinessTimeoutMs ?? 15_000;
    this.stopGraceMs = options.stopGraceMs ?? 5_000;
  }

  /** The environment with this id, if it is still tracked. */
  get(id: string): TestEnvironment | undefined {
    return this.environments.get(id);
  }

  /** Every tracked environment, oldest first. */
  list(): readonly TestEnvironment[] {
    return [...this.environments.values()];
  }

  /**
   * Creates the environment's directory, database file and port.
   *
   * The port is taken from `portRange` and skips both the reserved development
   * port and every port this manager already holds; the database file lives
   * inside the new temporary directory, so it cannot be the development
   * database. Exhaustion is a refusal, not a reuse.
   */
  create(request: TestEnvironmentRequest): CreateOutcome {
    const range = request.portRange ?? DEFAULT_TEST_PORT_RANGE;
    const reservedPort = request.reserved?.port;
    const port = this.allocatePort(range.min, range.max, reservedPort);
    if (port === undefined) {
      return {
        ok: false,
        code: 'PROVIDER_UNAVAILABLE',
        reason: `no free test port in ${String(range.min)}–${String(range.max)}; refusing to reuse the development port ${String(reservedPort ?? 'n/a')}`,
      };
    }
    const dir = this.ports.createDir(this.prefix);
    const dbPath = join(dir, 'test.sqlite');
    const reservedDb = request.reserved?.dbPath;
    if (reservedDb !== undefined && resolve(reservedDb) === resolve(dbPath)) {
      this.usedPorts.delete(port);
      this.ports.removeDir(dir);
      return {
        ok: false,
        code: 'INVALID_STATE',
        reason: `isolated database resolved to the reserved development database ${reservedDb}`,
      };
    }
    this.ports.writeFile(dbPath, '');
    const id = uuidv7();
    const host = '127.0.0.1';
    const env: Record<string, string> = {
      ...(request.env ?? {}),
      AGENTDEV_TEST_ENV_ID: id,
      AGENTDEV_TEST_DB: dbPath,
      AGENTDEV_TEST_PORT: String(port),
      AGENTDEV_TEST_HOST: host,
      PORT: String(port),
      HOST: host,
    };
    const environment: TestEnvironment = {
      id,
      workId: request.workId,
      attemptId: request.attemptId,
      dir,
      dbPath,
      host,
      port,
      env,
      command: [...request.command],
      state: 'created',
      reserved: {
        ...(reservedPort === undefined ? {} : { port: reservedPort }),
        ...(reservedDb === undefined ? {} : { dbPath: reservedDb }),
      },
    };
    this.environments.set(id, environment);
    return { ok: true, environment };
  }

  /**
   * Starts the environment's command and waits until its port answers.
   *
   * A process that exits before it listens, or that never listens within the
   * timeout, is a failed start with the observed exit code/output — never a
   * "probably running" success.
   */
  async start(
    environment: TestEnvironment,
    options: { readonly readinessTimeoutMs?: number } = {},
  ): Promise<StartOutcome> {
    const current = this.require(environment);
    if (current.state !== 'created' && current.state !== 'failed') {
      return {
        ok: false,
        code: 'INVALID_STATE',
        reason: `test environment ${current.id} is ${current.state}; it cannot be started`,
        environment: current,
      };
    }
    const handle = this.ports.spawn(current.command, {
      cwd: environment.dir,
      env: { ...process.env, ...current.env } as Record<string, string>,
    });
    this.handles.set(current.id, handle);
    const ready = await this.waitForPort(handle, current, options.readinessTimeoutMs);
    if (!ready.ok) {
      if (handle.pid !== undefined) this.signalQuietly(handle.pid, 'SIGKILL');
      const failed = this.replace(current.id, { state: 'failed' });
      return {
        ok: false,
        code: ready.code,
        reason: ready.reason,
        environment: failed ?? current,
      };
    }
    const running = this.replace(current.id, {
      state: 'running',
      ...(handle.pid === undefined ? {} : { pid: handle.pid }),
    });
    return { ok: true, environment: running ?? current };
  }

  /**
   * Runs one command inside the environment.
   *
   * The command receives the environment's own `AGENTDEV_TEST_DB`/`PORT`, so a
   * test that connects to the dev database or port is a test bug the caller can
   * see rather than a silent cross-contamination.
   */
  run(environment: TestEnvironment, command: readonly string[]): RunOutcome {
    const current = this.require(environment);
    if (current.state !== 'running') {
      return {
        ok: false,
        code: 'INVALID_STATE',
        reason: `test environment ${current.id} is ${current.state}; only a running environment executes commands`,
      };
    }
    const result = this.ports.run(command, {
      cwd: current.dir,
      env: { ...process.env, ...current.env } as Record<string, string>,
      timeoutMs: 120_000,
    });
    if (result.status !== 0) {
      return {
        ok: false,
        code: 'INVALID_STATE',
        reason: `command ${command.join(' ')} exited with ${String(result.status)}: ${result.stderr.trim()}`,
        result,
      };
    }
    return { ok: true, environment: current, result };
  }

  /**
   * Stops the process group.
   *
   * SIGTERM first, then SIGKILL after the grace period; a group that survives
   * both is a cleanup failure. Stopping an already-stopped environment is a
   * no-op, so `cleanup` is idempotent.
   */
  async stop(environment: TestEnvironment): Promise<StopOutcome> {
    const current = this.require(environment);
    const pid = current.pid;
    if (pid === undefined || current.state === 'stopped') {
      return { ok: true, environment: this.markStopped(current.id, current) };
    }
    const failures: string[] = [];
    const handle = this.handles.get(current.id);
    try {
      this.ports.signal(pid, 'SIGTERM');
    } catch (error) {
      failures.push(`SIGTERM to process group ${String(pid)} failed: ${messageOf(error)}`);
    }
    if (!(await this.waitForExit(handle, pid, this.stopGraceMs))) {
      try {
        this.ports.signal(pid, 'SIGKILL');
      } catch (error) {
        failures.push(`SIGKILL to process group ${String(pid)} failed: ${messageOf(error)}`);
      }
      if (!(await this.waitForExit(handle, pid, this.stopGraceMs))) {
        failures.push(`process group ${String(pid)} is still alive after SIGKILL`);
      }
    }
    if (failures.length > 0) {
      return {
        ok: false,
        code: 'RECOVERY_REQUIRED',
        reason: `test environment ${current.id} could not be stopped cleanly`,
        failures,
        environment: current,
      };
    }
    this.handles.delete(current.id);
    return { ok: true, environment: this.markStopped(current.id, current) };
  }

  /**
   * Stops the environment and removes everything it owned.
   *
   * Every step runs even when an earlier one failed, and the outcome lists the
   * failures as a `RECOVERY_REQUIRED` state (`execution.md` §5: "清理失败记录
   * recovery").
   */
  async cleanup(environment: TestEnvironment): Promise<CleanupOutcome> {
    const current = this.require(environment);
    const failures: string[] = [];
    const stopped = await this.stop(current);
    if (!stopped.ok) failures.push(...stopped.failures);
    try {
      this.ports.removeDir(current.dir);
    } catch (error) {
      failures.push(`removing ${current.dir} failed: ${messageOf(error)}`);
    }
    this.usedPorts.delete(current.port);
    if (failures.length > 0) {
      const failed = this.replace(current.id, { state: 'cleanup_failed' });
      return {
        ok: false,
        code: 'RECOVERY_REQUIRED',
        reason: `test environment ${current.id} was not cleaned up`,
        failures,
        environment: failed ?? current,
      };
    }
    const done = this.replace(current.id, { state: 'stopped' });
    return { ok: true, environment: done === undefined ? current : clearPid(done) };
  }

  /** Records the stopped state and drops the process id with it. */
  private markStopped(id: string, fallback: TestEnvironment): TestEnvironment {
    const stopped = this.replace(id, { state: 'stopped' });
    if (stopped === undefined) return fallback;
    const cleared = clearPid(stopped);
    this.environments.set(id, cleared);
    return cleared;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private allocatePort(min: number, max: number, reserved: number | undefined): number | undefined {
    for (let port = min; port <= max; port += 1) {
      if (port === reserved) continue;
      if (this.usedPorts.has(port)) continue;
      this.usedPorts.add(port);
      return port;
    }
    return undefined;
  }

  private require(environment: TestEnvironment): TestEnvironment {
    const current = this.environments.get(environment.id);
    if (current === undefined) {
      // Re-register a record the caller still holds: losing track of an
      // environment must not make its process unkillable.
      this.environments.set(environment.id, environment);
      return environment;
    }
    return current;
  }

  private replace(id: string, patch: Partial<TestEnvironment>): TestEnvironment | undefined {
    const current = this.environments.get(id);
    if (current === undefined) return undefined;
    const next: TestEnvironment = { ...current, ...patch };
    this.environments.set(id, next);
    return next;
  }

  private signalQuietly(pid: number, signal: NodeJS.Signals): void {
    try {
      this.ports.signal(pid, signal);
    } catch {
      // Best effort during a failed start; the failure itself is already returned.
    }
  }

  private async waitForPort(
    handle: ProcessHandle,
    environment: TestEnvironment,
    timeoutMs = this.readinessTimeoutMs,
  ): Promise<
    | { readonly ok: true }
    | { readonly ok: false; readonly code: BrokerErrorCode; readonly reason: string }
  > {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await portOpen(environment.host, environment.port)) return { ok: true };
      if (handle.exited()) {
        return {
          ok: false,
          code: 'INVALID_STATE',
          reason: `test environment ${environment.id} exited with code ${String(handle.exitCode())} before listening: ${handle.stderr().trim()}`,
        };
      }
      await delay(50);
    }
    return {
      ok: false,
      code: 'PROVIDER_UNAVAILABLE',
      reason: `test environment ${environment.id} did not accept a connection on ${environment.host}:${String(environment.port)} within ${String(timeoutMs)}ms`,
    };
  }

  private async waitForExit(
    handle: ProcessHandle | undefined,
    pid: number,
    timeoutMs: number,
  ): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!this.ports.alive(pid)) return true;
      if (handle !== undefined && handle.exited()) return true;
      await delay(50);
    }
    return !this.ports.alive(pid);
  }
}

/** Whether a TCP connection to the port succeeds. */
export function portOpen(host: string, port: number, timeoutMs = 500): Promise<boolean> {
  return new Promise((settle) => {
    const socket = createConnection({ host, port });
    const done = (open: boolean): void => {
      socket.removeAllListeners();
      socket.destroy();
      settle(open);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((settle) => {
    setTimeout(settle, ms);
  });
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A stopped record no longer owns a process, so `pid` is removed entirely. */
function clearPid(environment: TestEnvironment): TestEnvironment {
  const { pid: _pid, ...rest } = environment;
  return rest;
}
