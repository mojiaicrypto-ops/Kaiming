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
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createConnection, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { CheckResult } from '@agentdev/contracts';
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
  /**
   * Whether the OS can bind this port right now.
   *
   * `create` must not hand out a port something else already listens on (W7R1-05:
   * the failing probe showed an occupied port reported as a ready environment).
   * The check binds and immediately releases, so it is an observation of the OS,
   * not a reservation — and it is asynchronous because an occupied port is
   * reported by an event, not a thrown error.
   *
   * A probe implementation that throws is treated as a failed probe: `create`
   * returns a `PROVIDER_UNAVAILABLE` result object rather than letting the
   * exception escape, and no port claim is left behind (W7R3-04).
   */
  portAvailable(port: number): Promise<boolean>;
  /**
   * The pid that owns the listening socket on this port, when the OS can say.
   *
   * Readiness must be *proved* to belong to the command this environment started
   * (W7R2-07): a bare connectable port lets any external listener impersonate the
   * environment. `undefined` means ownership could not be proved, which is a
   * refusal rather than a guess.
   */
  listeningPid(port: number, host: string): number | undefined;
  /** Whether `pid` is `ancestor` itself or a descendant of it. */
  processDescends(pid: number, ancestor: number): boolean;
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

/**
 * Whether the OS currently allows binding `host:port`.
 *
 * A successful bind is released immediately; `EADDRINUSE` (and any other bind
 * failure) means the port is not the manager's to hand out.
 *
 * The probe emits a `port` event on success and an `error` event on failure, and
 * `listen` is therefore wrapped in a promise: an occupied port is reported
 * asynchronously by libuv, so a bare `try { listen() }` would claim every port is
 * free and hand out somebody else's socket (W7R1-05).
 */
export function portBindable(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((settle) => {
    const server = createServer();
    const done = (bindable: boolean): void => {
      server.removeAllListeners();
      if (bindable) {
        server.close();
        settle(true);
        return;
      }
      try {
        server.close();
      } catch {
        // Nothing was listening, so there is nothing to release.
      }
      settle(false);
    };
    server.once('error', () => {
      done(false);
    });
    server.once('listening', () => {
      done(true);
    });
    server.listen({ port, host, exclusive: true });
    server.unref();
  });
}

/**
 * The pid owning the listening socket on `port`, when this OS can report it.
 *
 * `lsof` maps a listening socket to its process on macOS/BSD, and Linux is served
 * from `/proc/net/tcp` plus the owning process's descriptor table. `undefined`
 * means the question could not be answered — no listener seen *or* no probe
 * available — and the readiness check refuses rather than trusting the port
 * (W7R2-07).
 */
export function listeningProcess(port: number): number | undefined {
  if (process.platform === 'linux') {
    const fromProc = procListeningProcess(port);
    if (fromProc !== undefined) return fromProc;
  }
  return lsofListeningProcess(port);
}

function lsofListeningProcess(port: number): number | undefined {
  const result = spawnSync('lsof', ['-nP', `-iTCP:${String(port)}`, '-sTCP:LISTEN', '-Fp'], {
    encoding: 'utf8',
    timeout: 5_000,
  });
  if (result.error !== undefined || result.status !== 0) return undefined;
  for (const line of (result.stdout ?? '').split('\n')) {
    const match = /^p(\d+)$/.exec(line.trim());
    if (match !== null) return Number.parseInt(match[1] ?? '', 10);
  }
  return undefined;
}

/** Linux: the socket inode from `/proc/net/tcp{,6}` → the process holding it. */
function procListeningProcess(port: number): number | undefined {
  const inodes = new Set<string>();
  for (const file of ['/proc/net/tcp', '/proc/net/tcp6']) {
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const line of text.split('\n').slice(1)) {
      const fields = line.trim().split(/\s+/);
      const local = fields[1];
      const state = fields[3];
      const inode = fields[9];
      if (local === undefined || state !== '0A' || inode === undefined) continue;
      const localPort = Number.parseInt(local.split(':')[1] ?? '', 16);
      if (localPort !== port) continue;
      inodes.add(inode);
    }
  }
  if (inodes.size === 0) return undefined;
  for (const entry of readDirectory('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    const fdDir = `/proc/${entry}/fd`;
    for (const fd of readDirectory(fdDir)) {
      let link: string;
      try {
        link = readlinkSync(join(fdDir, fd));
      } catch {
        continue;
      }
      const match = /^socket:\[(\d+)\]$/.exec(link);
      if (match !== null && inodes.has(match[1] ?? '')) return Number.parseInt(entry, 10);
    }
  }
  return undefined;
}

function readDirectory(path: string): string[] {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}

/**
 * Whether `pid` is `ancestor` or one of its descendants.
 *
 * A command may legitimately bind its port from a helper it spawned, so ownership
 * is a process-tree question rather than an exact pid comparison.
 */
export function processDescends(pid: number, ancestor: number): boolean {
  let current = pid;
  for (let depth = 0; depth < 64; depth += 1) {
    if (current === ancestor) return true;
    const parent = parentProcess(current);
    if (parent === undefined || parent <= 1 || parent === current) return false;
    current = parent;
  }
  return false;
}

function parentProcess(pid: number): number | undefined {
  if (process.platform === 'linux') {
    try {
      const stat = readFileSync(`/proc/${String(pid)}/stat`, 'utf8');
      const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      const parent = Number.parseInt(fields[1] ?? '', 10);
      return Number.isInteger(parent) ? parent : undefined;
    } catch {
      return undefined;
    }
  }
  const result = spawnSync('ps', ['-o', 'ppid=', '-p', String(pid)], {
    encoding: 'utf8',
    timeout: 5_000,
  });
  if (result.error !== undefined || result.status !== 0) return undefined;
  const parent = Number.parseInt((result.stdout ?? '').trim(), 10);
  return Number.isInteger(parent) ? parent : undefined;
}

/**
 * Ports handed out by every manager in this process.
 *
 * Two `TestEnvironmentManager` instances must never receive the same port
 * (W7R1-05): each manager only sees its own `usedPorts`, so the registry is the
 * cross-manager claim. An OS bind check alone cannot catch two managers that both
 * probe a free port before either child binds it.
 */
const claimedPorts = new Set<number>();

/** The ports currently claimed by any manager in this process (diagnostics/tests). */
export function claimedTestPorts(): readonly number[] {
  return [...claimedPorts];
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
  portAvailable: (port) => portBindable(port, '127.0.0.1'),
  listeningPid: (port) => listeningProcess(port),
  processDescends: (pid, ancestor) => processDescends(pid, ancestor),
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
   * The port is taken from `portRange`, skips the reserved development port, every
   * port this manager already holds and every port a sibling manager holds, and is
   * probed against the OS before it is promised (W7R1-05). The database file lives
   * inside the new temporary directory, so it cannot be the development database.
   * Exhaustion is a refusal, not a reuse.
   *
   * Every step after the port claim runs inside a `try`: a failure (for example a
   * full disk while creating the directory) releases the claim and is returned as a
   * `PROVIDER_UNAVAILABLE` result, so it can never leak the port permanently or
   * escape as an exception (W7R2-08). The OS availability probe runs before the
   * claim and is wrapped as well: a probe that throws is a refused creation, not an
   * exception out of `create` (W7R3-04).
   */
  async create(request: TestEnvironmentRequest): Promise<CreateOutcome> {
    const range = request.portRange ?? DEFAULT_TEST_PORT_RANGE;
    const reservedPort = request.reserved?.port;
    let port: number | undefined;
    try {
      port = await this.allocatePort(range.min, range.max, reservedPort);
    } catch (error) {
      // The throw happens before any claim is recorded (`allocatePort` claims only
      // after a successful probe), so there is nothing to release here; the point
      // is that the caller gets the same structured refusal as every other
      // creation failure instead of an exception.
      return {
        ok: false,
        code: 'PROVIDER_UNAVAILABLE',
        reason: `test environment port probe failed for ${String(range.min)}–${String(range.max)}: ${messageOf(error)}`,
      };
    }
    if (port === undefined) {
      return {
        ok: false,
        code: 'PROVIDER_UNAVAILABLE',
        reason: `no free test port in ${String(range.min)}–${String(range.max)}; refusing to reuse the development port ${String(reservedPort ?? 'n/a')}`,
      };
    }
    let dir: string | undefined;
    try {
      dir = this.ports.createDir(this.prefix);
      const dbPath = join(dir, 'test.sqlite');
      const reservedDb = request.reserved?.dbPath;
      if (reservedDb !== undefined && resolve(reservedDb) === resolve(dbPath)) {
        this.releasePort(port);
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
    } catch (error) {
      // Release the claim on **every** failure path: a process-level port claim
      // that outlives its environment makes the port permanently unusable.
      this.releasePort(port);
      if (dir !== undefined) {
        try {
          this.ports.removeDir(dir);
        } catch {
          // The directory could not be removed either; the failure below is the
          // one the caller needs, and the port is already released.
        }
      }
      return {
        ok: false,
        code: 'PROVIDER_UNAVAILABLE',
        reason: `test environment could not be created on port ${String(port)}: ${messageOf(error)}`,
      };
    }
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
    claimedPorts.delete(current.port);
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

  /**
   * The first port in the window the OS can actually bind and no manager holds.
   *
   * Two independent conditions, because each covers a hole the other has: the OS
   * bind probe skips an external listener (the review's occupied-port probe), and
   * the process-wide claim set stops a second manager from handing out a port a
   * sibling has already promised but whose child has not bound yet (W7R1-05).
   */
  private async allocatePort(
    min: number,
    max: number,
    reserved: number | undefined,
  ): Promise<number | undefined> {
    for (let port = min; port <= max; port += 1) {
      if (port === reserved) continue;
      if (this.usedPorts.has(port) || claimedPorts.has(port)) continue;
      if (!(await this.ports.portAvailable(port))) continue;
      this.usedPorts.add(port);
      claimedPorts.add(port);
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

  /** Releases this manager's and the process-wide claim on a port. */
  private releasePort(port: number): void {
    this.usedPorts.delete(port);
    claimedPorts.delete(port);
  }

  /**
   * Waits until this environment's own command is ready, and never reports
   * another process's listener as its own.
   *
   * Readiness needs three facts, not one: the port answers, the spawned command is
   * still alive after a settle window (W7R1-05), and the listening socket is
   * **owned** by that command or one of its descendants (W7R2-07). The third is
   * what stops an external listener from impersonating the environment: a live
   * child that never listened would otherwise be reported `running` on somebody
   * else's socket. When ownership cannot be proved the start fails with
   * `INVALID_STATE` rather than guessing.
   */
  private async waitForPort(
    handle: ProcessHandle,
    environment: TestEnvironment,
    timeoutMs = this.readinessTimeoutMs,
  ): Promise<
    | { readonly ok: true }
    | { readonly ok: false; readonly code: BrokerErrorCode; readonly reason: string }
  > {
    const deadline = Date.now() + timeoutMs;
    const dead = (): {
      readonly ok: false;
      readonly code: BrokerErrorCode;
      readonly reason: string;
    } => ({
      ok: false,
      code: 'INVALID_STATE',
      reason: `test environment ${environment.id} exited with code ${String(handle.exitCode())} before it owned ${environment.host}:${String(environment.port)}: ${handle.stderr().trim()}`,
    });
    while (Date.now() < deadline) {
      if (handle.exited()) return dead();
      if (await portOpen(environment.host, environment.port)) {
        // The port answered. Confirm ownership: the command must still be alive,
        // must stay alive across a settle window, and must be the process the OS
        // names as the socket's owner before readiness is claimed.
        await delay(50);
        if (handle.exited()) return dead();
        const ownership = this.verifyOwnership(handle, environment);
        if (ownership !== undefined) return ownership;
        return { ok: true };
      }
      await delay(50);
    }
    return {
      ok: false,
      code: 'PROVIDER_UNAVAILABLE',
      reason: `test environment ${environment.id} did not accept a connection on ${environment.host}:${String(environment.port)} within ${String(timeoutMs)}ms`,
    };
  }

  /** Proves the listening socket belongs to this environment's command. */
  private verifyOwnership(
    handle: ProcessHandle,
    environment: TestEnvironment,
  ): { readonly ok: false; readonly code: BrokerErrorCode; readonly reason: string } | undefined {
    const pid = handle.pid;
    if (pid === undefined) {
      return {
        ok: false,
        code: 'INVALID_STATE',
        reason: `test environment ${environment.id} has no process id, so ownership of ${environment.host}:${String(environment.port)} cannot be proved`,
      };
    }
    const owner = this.ports.listeningPid(environment.port, environment.host);
    if (owner === undefined) {
      return {
        ok: false,
        code: 'INVALID_STATE',
        reason: `test environment ${environment.id} readiness could not be proved: the OS did not report which process owns ${environment.host}:${String(environment.port)}`,
      };
    }
    if (owner === pid || this.ports.processDescends(owner, pid)) return undefined;
    return {
      ok: false,
      code: 'INVALID_STATE',
      reason: `test environment ${environment.id} reported ${environment.host}:${String(environment.port)} ready, but the listening socket is owned by pid ${String(owner)}, not by the started command (pid ${String(pid)})`,
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

// ---------------------------------------------------------------------------
// Declared acceptance commands → executed `CheckResult` evidence
// ---------------------------------------------------------------------------

/**
 * How much of a command's stdout/stderr is kept as evidence, per stream.
 *
 * `execution.md` §5 requires the output to be captured but bounded: a suite that
 * prints a megabyte must not turn a `check_result` row into a log store. The full
 * output is not lost either — the bounded text is the evidence `result`, and the
 * truncation marker says what was dropped.
 */
export const TEST_OUTPUT_LIMIT_BYTES = 8 * 1024;

/** Truncates one stream to {@link TEST_OUTPUT_LIMIT_BYTES}, marking the cut. */
export function boundTestOutput(text: string, limit = TEST_OUTPUT_LIMIT_BYTES): string {
  if (text.length <= limit) return text;
  const dropped = text.length - limit;
  return `${text.slice(0, limit)}\n… [${String(dropped)} characters truncated]`;
}

/**
 * One real execution of one project-declared acceptance command.
 *
 * `exitCode` is the process's own status (`null` when it was signalled or could not
 * start); the caller turns it into the contract's integer `exitCode` with
 * {@link buildTestCheckResult}.
 */
export interface DeclaredCommandExecution {
  readonly command: string;
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly signal: NodeJS.Signals | null;
  readonly durationMs: number;
  /** Why the command never produced a status, when it could not start at all. */
  readonly error?: string;
}

/** The contract's integer exit code for one execution, or a documented substitute. */
export function recordedExitCode(execution: DeclaredCommandExecution): number {
  if (execution.exitCode !== null) return execution.exitCode;
  // A process killed by a signal has no exit status. `checkEntry` requires an
  // integer whenever a `command` is present, so the documented shell convention
  // (128 + signal) is recorded instead; `result` still names the real signal, so
  // the evidence is explicit rather than a guessed success.
  const signalNumber = execution.signal === null ? undefined : SIGNAL_NUMBERS[execution.signal];
  return signalNumber === undefined ? -1 : 128 + signalNumber;
}

const SIGNAL_NUMBERS: Readonly<Record<string, number>> = {
  SIGHUP: 1,
  SIGINT: 2,
  SIGQUIT: 3,
  SIGKILL: 9,
  SIGTERM: 15,
};

/** The bounded, human-readable result the evidence row records. */
export function describeExecution(execution: DeclaredCommandExecution): string {
  const parts = [
    `exit=${String(execution.exitCode)}${execution.signal === null ? '' : ` signal=${execution.signal}`}`,
    `${String(execution.durationMs)}ms`,
  ];
  if (execution.error !== undefined) parts.push(`error=${execution.error}`);
  const out = boundTestOutput(execution.stdout).trim();
  const err = boundTestOutput(execution.stderr).trim();
  if (out !== '') parts.push(`stdout: ${out}`);
  if (err !== '') parts.push(`stderr: ${err}`);
  return parts.join(' | ');
}

/** What the gate needs to know about the executed evidence of one Attempt. */
export type TestEvidenceState =
  { readonly state: 'pending' } | { readonly state: 'ready'; readonly checkResult: CheckResult };

/** The read-only half `StageGate` consults; a registry, a stub or a double. */
export interface TestEvidenceReader {
  get(attemptId: string): TestEvidenceState | undefined;
}

/**
 * The executed evidence of every live Test Attempt (`data.md` §3 `CheckResult`).
 *
 * The evidence is produced by **Core** when the Test Attempt becomes ready (the
 * declared commands are executed through the Broker's isolated container) and is
 * read back when that Attempt submits its stage result. It is deliberately
 * in-memory: it belongs to one Attempt of one live Run. A daemon restart loses it,
 * and the gate then refuses a `success` the evidence can no longer support — the
 * fail-closed direction, never a remembered claim.
 */
export class TestEvidenceRegistry implements TestEvidenceReader {
  private readonly entries = new Map<string, TestEvidenceState>();

  /** Marks the Attempt's evidence as being executed; a memory of "not yet". */
  begin(attemptId: string): void {
    this.entries.set(attemptId, { state: 'pending' });
  }

  /** Records the executed evidence of one Attempt. */
  record(attemptId: string, checkResult: CheckResult): void {
    this.entries.set(attemptId, { state: 'ready', checkResult });
  }

  get(attemptId: string): TestEvidenceState | undefined {
    return this.entries.get(attemptId);
  }

  /** Drops one Attempt's evidence once its Run is gone. */
  release(attemptId: string): void {
    this.entries.delete(attemptId);
  }

  /** Every Attempt this registry still tracks (diagnostics/tests). */
  attempts(): readonly string[] {
    return [...this.entries.keys()];
  }
}

export interface TestCheckResultInput {
  readonly executions: readonly DeclaredCommandExecution[];
  /**
   * The execution environment descriptor the check binds (`W8-1`).
   *
   * Production passes the Attempt's real `attempt.ready` observation — the same
   * `host:<platform>/<arch>/node-<major>` / `container:<image>` string the frozen
   * `VerificationManifest` records — so the executed check and the manifest carry one
   * comparable descriptor. The container image and the Runner descriptor are still
   * written into the human-readable `result` as well.
   */
  readonly environmentRef: string;
  /**
   * The execution base the command ran on (`docs/architecture/execution.md` §1/§5).
   *
   * Recorded as a human-readable `mode=host|container` fact next to
   * {@link TestCheckResultInput.environmentRef}: the host is the default, the container is
   * the optional run environment, and a reader must be able to tell which one produced the
   * exit code.
   */
  readonly executionMode?: 'host' | 'container';
  /**
   * The image the command really executed in (`Broker` `EXEC_IMAGE`), when it ran in one.
   *
   * It is recorded in the human-readable `result` (`image=… | runner=…`) alongside
   * {@link TestCheckResultInput.environmentRef}, so a reader sees the concrete command
   * facts next to the environment descriptor the manifest binds. A host run passes none:
   * there is no image to name (`data.md` §3 `Env`).
   */
  readonly executionImage?: string;
  /** The Runner's environment descriptor (`attempt.ready`), when it reported one. */
  readonly runnerEnvironment?: string;
  /** The frozen candidate's code-tree hash the commands ran against. */
  readonly inputTree: string;
  /** The acceptance ids this evidence covers (`Task.acceptanceIds`). */
  readonly acceptanceIds: readonly string[];
  /** One artifact id per execution, in the same order. */
  readonly outputRefs: readonly string[];
}

/**
 * The `CheckResult` an executed command set produces (`data.md` §3).
 *
 * The status is derived **only** from the real exit codes: every command exiting 0
 * is `passed`, any other outcome is `failed`, and no command at all is
 * `not_covered` — never `passed`. The uncovered list names the acceptance ids an
 * unconfigured project left unverified, so "no commands" is visible in the evidence
 * rather than being silently equivalent to a green run.
 */
export function buildTestCheckResult(input: TestCheckResultInput): CheckResult {
  const { executions, environmentRef, inputTree, acceptanceIds, outputRefs } = input;
  if (executions.length === 0) {
    return {
      status: 'not_covered',
      checks: [],
      uncovered: acceptanceIds.map((acceptanceId) => ({
        acceptanceId,
        reason:
          'no acceptance command is configured for this project (policy.testCommands is empty), so no executed check exists',
      })),
    };
  }
  const facts = [
    ...(input.executionMode === undefined ? [] : [`mode=${input.executionMode}`]),
    ...(input.executionImage === undefined ? [] : [`image=${input.executionImage}`]),
    ...(input.runnerEnvironment === undefined ? [] : [`runner=${input.runnerEnvironment}`]),
  ].join(' | ');
  const checks = executions.map((execution, index) => ({
    acceptanceIds: [...acceptanceIds],
    command: execution.command,
    exitCode: recordedExitCode(execution),
    environmentRef,
    inputTree,
    outputRef: outputRefs[index] ?? environmentRef,
    result:
      facts === '' ? describeExecution(execution) : `${facts} | ${describeExecution(execution)}`,
  }));
  const passed = executions.every(
    (execution) => execution.exitCode === 0 && execution.error === undefined,
  );
  return { status: passed ? 'passed' : 'failed', checks, uncovered: [] };
}

/**
 * The evidence of a command set that could not be executed at all.
 *
 * A missing container runtime, a refused workspace or a vanished frozen tree means
 * there is no exit code to record. The result says exactly that in `uncovered` and
 * carries **no** check entry (a check entry with a `command` must record an exit
 * code, so inventing a `command` here would fabricate evidence). The status is
 * `blocked`, which the gate treats like any other non-`passed` evidence: a `success`
 * claim is refused with the reason.
 */
export function buildBlockedTestCheckResult(input: {
  readonly reason: string;
  readonly acceptanceIds: readonly string[];
}): CheckResult {
  return {
    status: 'blocked',
    checks: [],
    uncovered: input.acceptanceIds.map((acceptanceId) => ({
      acceptanceId,
      reason: input.reason,
    })),
  };
}
