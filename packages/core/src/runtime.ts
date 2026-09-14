/**
 * Runtime home on disk (WP-11 A1).
 *
 * `docs/architecture/reliability.md` §7 requires `agentdev start` to be a real
 * single-instance daemon: "daemon 获取每 Project 文件锁和 epoch 后加载数据库、迁移、
 * 检查 outbox/Run". This module owns the installation-level half of that — the state
 * directory, the single-instance lock (with epoch fencing), the live runtime record and
 * the project registry — and nothing else. It never touches product state: opening a
 * `ProjectStore`, migrating it and assembling the services is the daemon host's job.
 *
 * Guarantees the callers rely on:
 *
 * - everything is created `0700`/`0600`, because the installation credential lives
 *   beside it and `protocol.md` §2 makes a readable credential a compromised install;
 * - every write is atomic (write a sibling temporary file, then `rename`), so a crash
 *   can never leave a half-written `runtime.json` that `status` would misread;
 * - the lock is *fenced by epoch*: an expired lock whose pid is gone may be taken over
 *   with the next epoch, and a stale owner releasing its lock cannot remove the new
 *   owner's record (`releaseDaemonLock` checks the epoch it wrote).
 */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

import { enforcePrivateMode } from './auth.js';
import {
  daemonLockSchema,
  emptyProjectRegistry,
  projectRegistrySchema,
  runtimePaths,
  runtimeRecordSchema,
  type DaemonLock,
  type ProjectRegistry,
  type ProjectRegistryEntry,
  type RuntimePaths,
  type RuntimeRecord,
} from '@agentdev/contracts';

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/** A runtime-home problem that the CLI reports as an error code, not a stack trace. */
export class RuntimeHomeError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'RuntimeHomeError';
    this.code = code;
  }
}

/** Creates the runtime home (and its log/project directories) if it does not exist. */
export function ensureRuntimeHome(home: string): RuntimePaths {
  const paths = runtimePaths(home);
  for (const dir of [paths.home, paths.logs, paths.projectsDir]) {
    mkdirSync(dir, { recursive: true, mode: DIR_MODE });
    chmodSync(dir, DIR_MODE);
  }
  return paths;
}

/** Writes one file atomically with `0600`. */
function writePrivateFile(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: DIR_MODE });
  const temporary = `${path}.${String(process.pid)}.tmp`;
  writeFileSync(temporary, contents, { mode: FILE_MODE });
  chmodSync(temporary, FILE_MODE);
  renameSync(temporary, path);
}

/**
 * Reads the live runtime record.
 *
 * @returns the parsed record, or `null` when the daemon is not running. A malformed
 * record is an error: silently treating it as "not running" would let a second daemon
 * start on the same ports and database.
 */
export function readRuntimeRecord(home: string): RuntimeRecord | null {
  const path = runtimePaths(home).runtime;
  if (!existsSync(path)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new RuntimeHomeError(
      'RUNTIME_RECORD_INVALID',
      `runtime record ${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const result = runtimeRecordSchema.safeParse(parsed);
  if (!result.success) {
    throw new RuntimeHomeError(
      'RUNTIME_RECORD_INVALID',
      `runtime record ${path} does not match the contract: ${result.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ')}`,
    );
  }
  return result.data;
}

/** Writes the live runtime record atomically. */
export function writeRuntimeRecord(home: string, record: RuntimeRecord): void {
  writePrivateFile(runtimePaths(home).runtime, `${JSON.stringify(record, null, 2)}\n`);
}

/** Removes the live runtime record; missing is not an error. */
export function clearRuntimeRecord(home: string): void {
  rmSync(runtimePaths(home).runtime, { force: true });
}

/** True when the pid exists and this user may signal it. */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to another user; anything else means
    // it is gone. The runtime is a single-user installation, so both are safe to report.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export interface AcquireLockOptions {
  readonly pid: number;
  readonly now?: () => Date;
}

export type AcquireLockResult =
  | { readonly acquired: true; readonly lock: DaemonLock; readonly replacedStale: boolean }
  | { readonly acquired: false; readonly lock: DaemonLock };

/**
 * Acquires the single-instance daemon lock.
 *
 * A lock whose process is gone is replaced with the next epoch and reported through
 * `replacedStale`, so the caller can log that a previous daemon died without stopping
 * cleanly (the recovery scan then runs against the databases it left behind).
 */
export function acquireDaemonLock(home: string, options: AcquireLockOptions): AcquireLockResult {
  const paths = ensureRuntimeHome(home);
  const now = (options.now ?? (() => new Date()))().toISOString();
  const existing = readDaemonLock(home);
  if (existing !== null && isProcessAlive(existing.pid)) {
    return { acquired: false, lock: existing };
  }
  const lock: DaemonLock = {
    v: 1,
    pid: options.pid,
    epoch: (existing?.epoch ?? 0) + 1,
    startedAt: now,
  };
  if (existing !== null) {
    // A stale lock holder may still be finishing a signal handler; its epoch is lower,
    // so its release (which checks the epoch) cannot remove this record.
    chmodSync(paths.lock, FILE_MODE);
  }
  writePrivateFile(paths.lock, `${JSON.stringify(lock, null, 2)}\n`);
  return { acquired: true, lock, replacedStale: existing !== null };
}

/** Reads the lock record; `null` when absent, throws when malformed. */
export function readDaemonLock(home: string): DaemonLock | null {
  const path = runtimePaths(home).lock;
  if (!existsSync(path)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new RuntimeHomeError(
      'DAEMON_LOCK_INVALID',
      `daemon lock ${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const result = daemonLockSchema.safeParse(parsed);
  if (!result.success) {
    throw new RuntimeHomeError(
      'DAEMON_LOCK_INVALID',
      `daemon lock ${path} does not match the contract: ${result.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ')}`,
    );
  }
  return result.data;
}

/**
 * Releases the lock, but only for the epoch that owns it.
 *
 * @returns `true` when this call removed the lock.
 */
export function releaseDaemonLock(home: string, epoch: number): boolean {
  const existing = readDaemonLock(home);
  if (existing === null || existing.epoch !== epoch) return false;
  rmSync(runtimePaths(home).lock, { force: true });
  return true;
}

/** Reads the project registry; a missing file is an empty installation. */
export function readProjectRegistry(home: string): ProjectRegistry {
  const path = runtimePaths(home).projects;
  if (!existsSync(path)) return emptyProjectRegistry();
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new RuntimeHomeError(
      'PROJECT_REGISTRY_INVALID',
      `project registry ${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const result = projectRegistrySchema.safeParse(parsed);
  if (!result.success) {
    throw new RuntimeHomeError(
      'PROJECT_REGISTRY_INVALID',
      `project registry ${path} does not match the contract: ${result.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ')}`,
    );
  }
  return result.data;
}

/**
 * Adds or refreshes one root in the registry.
 *
 * The registry is keyed by canonical root: registering the same root twice updates
 * `lastOpenedAt` and keeps the original `addedAt`, which is what makes `project.open`
 * idempotent (`protocol.md` §5).
 */
export function registerProject(
  home: string,
  entry: { readonly root: string; readonly projectId: string; readonly at: string },
): ProjectRegistry {
  const registry = readProjectRegistry(home);
  const existing = registry.projects.find((candidate) => candidate.root === entry.root);
  const projects: ProjectRegistryEntry[] =
    existing === undefined
      ? [
          ...registry.projects,
          {
            root: entry.root,
            projectId: entry.projectId,
            addedAt: entry.at,
            lastOpenedAt: entry.at,
          },
        ]
      : registry.projects.map((candidate) =>
          candidate.root === entry.root
            ? { ...candidate, projectId: entry.projectId, lastOpenedAt: entry.at }
            : candidate,
        );
  const next: ProjectRegistry = { v: 1, projects };
  writePrivateFile(runtimePaths(home).projects, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

/** Removes one root from the registry; returns the updated registry. */
export function unregisterProject(home: string, root: string): ProjectRegistry {
  const registry = readProjectRegistry(home);
  const next: ProjectRegistry = {
    v: 1,
    projects: registry.projects.filter((candidate) => candidate.root !== root),
  };
  writePrivateFile(runtimePaths(home).projects, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

/**
 * Reads the 0600 installation credential.
 *
 * `protocol.md` §2 makes this the Bearer both the BFF and the local CLI present to the
 * daemon. The daemon reads it once at start (and refuses a file others can read), so
 * the token never has to be copied into `runtime.json`.
 */
export function readInstallationCredential(home: string): string {
  const path = runtimePaths(home).installationCredential;
  if (!existsSync(path)) {
    throw new RuntimeHomeError(
      'CREDENTIAL_MISSING',
      `installation credential ${path} is missing; start the daemon once to create it`,
    );
  }
  enforcePrivateMode(path);
  const token = readFileSync(path, 'utf8').trim();
  if (token.length === 0) {
    throw new RuntimeHomeError('CREDENTIAL_EMPTY', `installation credential ${path} is empty`);
  }
  return token;
}

/** Path of one project's log file (correlated per project, never per Run). */
export function projectLogPath(home: string, projectId: string): string {
  return join(runtimePaths(home).logs, `${projectId}.log`);
}
