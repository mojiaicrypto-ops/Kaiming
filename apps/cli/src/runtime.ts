/**
 * CLI runtime control (WP-11 A1-T3).
 *
 * `docs/architecture/reliability.md` §7 fixes the contract this module implements:
 *
 * > CLI命令契约：doctor输出依赖版本/Docker/目录权限/端口状态；start/stop/status；
 * > open <path>；…。失败退出非零并输出error code和operationId；status只读。
 *
 * The CLI never links the daemon: it reads the 0600 installation credential and the
 * live `runtime.json`, spawns the daemon host as a separate process (the documented
 * `agentdev start` starts daemon and web) and talks to its loopback admin surface with
 * the credential as Bearer (`protocol.md` §2). The runtime-control half stays on
 * `@agentdev/contracts` only; the installation-level `agentdev secret` command
 * additionally loads `@agentdev/core` lazily for the durable repository
 * (`ARCHITECTURE.md` §2 permits `core` for installation-level operations).
 */
import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync } from 'node:fs';
import { request } from 'node:http';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runtimePaths, runtimeRecordSchema, type RuntimeRecord } from '@agentdev/contracts';

/** Where the daemon host entry lives, relative to the repository root. */
export const DAEMON_ENTRY = 'apps/daemon/dist/main.js';

/** The env var a development/test run uses to point at the source entry instead. */
export const DAEMON_ENTRY_ENV = 'AGENTDEV_DAEMON_ENTRY';

/** Repository root, derived from this module so the CLI works from any cwd. */
export function repoRootOf(moduleUrl: string): string {
  return resolve(dirname(fileURLToPath(moduleUrl)), '..', '..', '..');
}

/** Resolves the installation home exactly like the daemon does. */
export function cliHome(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  const override = env.AGENTDEV_HOME;
  if (typeof override === 'string' && override.trim().length > 0) return override.trim();
  return join(home, '.agentdev');
}

export interface CliRuntimeRecord {
  readonly record: RuntimeRecord;
  readonly path: string;
}

/** Reads the live record; `null` when the daemon is not running. */
export function readLiveRecord(home: string): CliRuntimeRecord | null {
  const path = runtimePaths(home).runtime;
  if (!existsSync(path)) return null;
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  const result = runtimeRecordSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `runtime record ${path} does not match the contract: ${result.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ')}`,
    );
  }
  return { record: result.data, path };
}

/** Reads the installation credential, refusing a file other users can read. */
export function readCredential(home: string): string {
  const path = runtimePaths(home).installationCredential;
  if (!existsSync(path)) throw new Error(`installation credential ${path} is missing`);
  const mode = statSync(path).mode & 0o777;
  if (mode !== 0o600)
    throw new Error(`installation credential ${path} must be 0600 (found ${mode.toString(8)})`);
  return readFileSync(path, 'utf8').trim();
}

export interface AdminResponse {
  readonly status: number;
  readonly body: unknown;
}

/** One request to the loopback admin surface, authenticated with the credential. */
export function adminRequest(
  home: string,
  target: { readonly host: string; readonly port: number },
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  payload?: unknown,
): Promise<AdminResponse> {
  const credential = readCredential(home);
  const body = payload === undefined ? undefined : JSON.stringify(payload);
  return new Promise((resolvePromise, reject) => {
    const req = request(
      {
        host: target.host,
        port: target.port,
        method,
        path,
        headers: {
          authorization: `Bearer ${credential}`,
          ...(body === undefined
            ? {}
            : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }),
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let parsed: unknown;
          try {
            parsed = text.length === 0 ? null : JSON.parse(text);
          } catch {
            parsed = { raw: text };
          }
          resolvePromise({ status: response.statusCode ?? 0, body: parsed });
        });
      },
    );
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

export interface SpawnDaemonOptions {
  readonly home: string;
  readonly repoRoot: string;
  readonly daemonPort?: number;
  readonly webPort?: number;
  readonly adminPort?: number;
  readonly roots?: readonly string[];
  readonly trust?: boolean;
  readonly withWeb?: boolean;
  readonly env?: NodeJS.ProcessEnv;
}

/** Starts the daemon host detached, logging into the runtime home's log directory. */
export function spawnDaemon(options: SpawnDaemonOptions): { readonly pid: number | undefined } {
  const env = options.env ?? process.env;
  const entry = env[DAEMON_ENTRY_ENV];
  const script =
    typeof entry === 'string' && entry.length > 0 ? entry : join(options.repoRoot, DAEMON_ENTRY);
  if (!existsSync(script)) {
    throw new Error(
      `${script} does not exist; run \`pnpm build\` first (or set ${DAEMON_ENTRY_ENV} to the source entry)`,
    );
  }
  const logs = runtimePaths(options.home).logs;
  mkdirSync(logs, { recursive: true, mode: 0o700 });
  const logPath = join(logs, 'daemon.log');
  const fd = openSync(logPath, 'a', 0o600);
  const args = [script, '--home', options.home];
  for (const root of options.roots ?? []) args.push('--root', root);
  if (options.daemonPort !== undefined) args.push('--daemon-port', String(options.daemonPort));
  if (options.webPort !== undefined) args.push('--web-port', String(options.webPort));
  if (options.adminPort !== undefined) args.push('--admin-port', String(options.adminPort));
  if (options.withWeb === false) args.push('--no-web');
  if (options.trust === true) args.push('--trust');
  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: ['ignore', fd, fd],
    env: { ...env, AGENTDEV_HOME: options.home },
  });
  child.unref();
  closeSync(fd);
  return { pid: child.pid };
}

/**
 * Polls the live record until the daemon answers or the deadline passes.
 *
 * A record that does not match the contract is treated as "not ready yet" while there is
 * still time: the daemon publishes `runtime.json` before its admin listener is bound, so a
 * record whose `admin.port` is still `0` is a real intermediate state. Only a record that is
 * *still* unreadable at the deadline is reported, as the thrown contract error the caller
 * turns into an `RUNTIME_RECORD_INVALID` failure with an operationId (`reliability.md` §7;
 * WP-11 leftover "损坏 runtime.json 使 agentdev start 无 operationId 崩溃").
 */
export async function waitForRuntime(
  home: string,
  options: { readonly timeoutMs?: number; readonly intervalMs?: number } = {},
): Promise<CliRuntimeRecord | null> {
  const deadline = Date.now() + (options.timeoutMs ?? 10_000);
  const interval = options.intervalMs ?? 100;
  const probe = (): { readonly live: CliRuntimeRecord | null; readonly error: unknown } => {
    try {
      return { live: readLiveRecord(home), error: null };
    } catch (error) {
      return { live: null, error };
    }
  };
  for (;;) {
    const { live, error } = probe();
    if (live !== null) {
      try {
        const health = await adminRequest(home, live.record.admin, 'GET', '/health');
        if (health.status === 200) return live;
      } catch {
        // Not answering yet; keep waiting.
      }
    }
    if (Date.now() >= deadline) {
      if (error !== null && error !== undefined) {
        throw error instanceof Error ? error : new Error('the runtime record is unreadable');
      }
      return null;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, interval));
  }
}

/** Polls until the live record is gone (graceful stop) or the deadline passes. */
export async function waitForStop(
  home: string,
  options: { readonly timeoutMs?: number; readonly intervalMs?: number } = {},
): Promise<boolean> {
  const deadline = Date.now() + (options.timeoutMs ?? 15_000);
  const interval = options.intervalMs ?? 100;
  for (;;) {
    try {
      if (readLiveRecord(home) === null) return true;
    } catch {
      // An unreadable record cannot prove the daemon is gone; keep waiting for the
      // deadline, exactly like a record that is still there.
    }
    if (Date.now() >= deadline) return false;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, interval));
  }
}

/** Tail of the daemon log, used when a start fails. */
export function daemonLogTail(home: string, lines = 12): string {
  const path = join(runtimePaths(home).logs, 'daemon.log');
  if (!existsSync(path)) return '(no daemon log yet)';
  const text = readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0);
  return text.slice(Math.max(0, text.length - lines)).join('\n');
}
