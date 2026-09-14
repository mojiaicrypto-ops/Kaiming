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
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';

import { enforcePrivateMode } from './auth.js';
import {
  daemonLockSchema,
  emptyProjectRegistry,
  projectLockFileName,
  projectRegistryEntrySchema,
  runtimePaths,
  runtimeRecordSchema,
  RUNTIME_PROTOCOL_VERSION,
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

/** Creates the runtime home (and its log/project/lock directories) if it does not exist. */
export function ensureRuntimeHome(home: string): RuntimePaths {
  const paths = runtimePaths(home);
  for (const dir of [paths.home, paths.logs, paths.projectsDir, paths.locks]) {
    mkdirSync(dir, { recursive: true, mode: DIR_MODE });
    chmodSync(dir, DIR_MODE);
  }
  return paths;
}

/**
 * Writes one file atomically with `0600`.
 *
 * `exclusive` uses `O_CREAT|O_EXCL` directly instead of write-then-rename, which is what
 * makes the single-instance lock a real compare-and-set (WP11R1-10).
 *
 * Exported (WP-12 T1.1) so the durable secret repository reuses the same 0600/atomic
 * guarantee for its master key and ciphertext records instead of reimplementing it
 * (`execution.md` §4: the master key is a 0600 file owned by the installer).
 */
export function writePrivateFile(
  path: string,
  contents: string,
  options: { exclusive?: boolean } = {},
): void {
  mkdirSync(dirname(path), { recursive: true, mode: DIR_MODE });
  if (options.exclusive === true) {
    const fd = openSync(path, 'wx', FILE_MODE);
    try {
      writeFileSync(fd, contents);
    } finally {
      closeSync(fd);
    }
    chmodSync(path, FILE_MODE);
    return;
  }
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
  | {
      readonly acquired: true;
      readonly lock: DaemonLock;
      readonly replacedStale: boolean;
      /** The holder this daemon displaced, for an honest start log (WP11R1-14). */
      readonly replacedStaleFrom?: DaemonLock;
    }
  | { readonly acquired: false; readonly lock: DaemonLock };

/**
 * Reads the epoch high-water mark; a missing or damaged file is treated as "never issued".
 *
 * The file is `RUNTIME_FILES.epoch` (`reliability.md` §7, WP-11 T-03), written atomically
 * with `0600`, so damage means an external edit. Ignoring it cannot lower the epoch below the
 * installed lock, and `writeEpochHighWater` re-establishes the mark from the epoch about to
 * be issued.
 */
function readEpochHighWater(home: string): number {
  const path = runtimePaths(home).epoch;
  if (!existsSync(path)) return 0;
  const parsed = Number.parseInt(readFileSync(path, 'utf8').trim(), 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

/** Persists the newest issued epoch so the next owner cannot replay it. */
function writeEpochHighWater(home: string, epoch: number): void {
  writePrivateFile(runtimePaths(home).epoch, `${String(epoch)}\n`);
}

/**
 * Acquires the single-instance daemon lock.
 *
 * A lock whose process is gone is replaced with the next epoch and reported through
 * `replacedStale`, so the caller can log that a previous daemon died without stopping
 * cleanly (the recovery scan then runs against the databases it left behind).
 *
 * The next epoch is `max(installed lock, high-water mark) + 1` (`WP-11 T-03`): a clean stop
 * removes the lock, so the lock alone cannot keep the fence monotonic across restarts. The
 * mark is persisted before the exclusive create, so a crash can never leave a lock whose
 * epoch is ahead of the recorded high-water.
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
    epoch: Math.max(existing?.epoch ?? 0, readEpochHighWater(home)) + 1,
    startedAt: now,
  };
  writeEpochHighWater(home, lock.epoch);
  if (existing !== null) {
    // A stale lock holder may still be finishing a signal handler; its epoch is lower,
    // so its release (which checks the epoch) cannot remove this record.
    chmodSync(paths.lock, FILE_MODE);
  }
  // `wx` is O_CREAT|O_EXCL: the create is atomic, so two daemons racing on a fresh home
  // cannot both believe they won (WP11R1-10). A stale lock (dead pid) is replaced by
  // removing it first and retrying the exclusive create.
  try {
    writePrivateFile(paths.lock, `${JSON.stringify(lock, null, 2)}\n`, { exclusive: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const current = readDaemonLock(home);
    if (current !== null && isProcessAlive(current.pid)) {
      return { acquired: false, lock: current };
    }
    rmSync(paths.lock, { force: true });
    try {
      writePrivateFile(paths.lock, `${JSON.stringify(lock, null, 2)}\n`, { exclusive: true });
    } catch (retryError) {
      if ((retryError as NodeJS.ErrnoException).code !== 'EEXIST') throw retryError;
      const winner = readDaemonLock(home);
      if (winner === null) {
        throw new RuntimeHomeError('LOCK_FAILED', 'the daemon lock could not be created');
      }
      return { acquired: false, lock: winner };
    }
  }
  return {
    acquired: true,
    lock,
    replacedStale: existing !== null,
    ...(existing === null ? {} : { replacedStaleFrom: existing }),
  };
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

/** One registry entry that could not be used, and why (WP-12 T5, Q2). */
export interface ProjectRegistryProblem {
  /** Zero-based position in the file, so the operator can find the entry. */
  readonly index: number;
  /** The `root` the entry claimed, when the entry was an object with a readable root. */
  readonly root: string | null;
  readonly code: 'PROJECT_ENTRY_INVALID' | 'PROJECT_ENTRY_DUPLICATE';
  readonly message: string;
}

export interface ProjectRegistryReport {
  /** Every usable entry, in file order. */
  readonly registry: ProjectRegistry;
  /** The entries that were skipped; never fatal (WP-12 T5, Q2). */
  readonly problems: readonly ProjectRegistryProblem[];
}

/**
 * Reads the project registry, tolerating damaged entries (WP-12 T5, Q2).
 *
 * A container-level problem (unreadable/not JSON/not the documented object) is still
 * an error: the file as a whole carries no trustworthy navigation index. A single
 * entry that does not match the contract, or that duplicates an already accepted
 * root/projectId, is skipped and **reported** instead — one bad record must never
 * keep the whole installation from starting (same policy as the secret repository,
 * WP-12 T1.1).
 */
export function readProjectRegistryReport(home: string): ProjectRegistryReport {
  const path = runtimePaths(home).projects;
  if (!existsSync(path)) return { registry: emptyProjectRegistry(), problems: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new RuntimeHomeError(
      'PROJECT_REGISTRY_INVALID',
      `project registry ${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const container = parsed as { readonly v?: unknown; readonly projects?: unknown };
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    Array.isArray(parsed) ||
    container.v !== RUNTIME_PROTOCOL_VERSION ||
    !Array.isArray(container.projects)
  ) {
    throw new RuntimeHomeError(
      'PROJECT_REGISTRY_INVALID',
      `project registry ${path} does not match the contract: expected {v:1,projects:[]}`,
    );
  }
  const projects: ProjectRegistryEntry[] = [];
  const problems: ProjectRegistryProblem[] = [];
  const seenRoots = new Set<string>();
  const seenIds = new Set<string>();
  for (const [index, raw] of container.projects.entries()) {
    const result = projectRegistryEntrySchema.safeParse(raw);
    const claimedRoot =
      typeof raw === 'object' &&
      raw !== null &&
      typeof (raw as { root?: unknown }).root === 'string'
        ? (raw as { root: string }).root
        : null;
    if (!result.success) {
      problems.push({
        index,
        root: claimedRoot,
        code: 'PROJECT_ENTRY_INVALID',
        message: result.error.issues
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join('; '),
      });
      continue;
    }
    const entry = result.data;
    if (seenRoots.has(entry.root) || seenIds.has(entry.projectId)) {
      problems.push({
        index,
        root: entry.root,
        code: 'PROJECT_ENTRY_DUPLICATE',
        message: `root ${entry.root} / projectId ${entry.projectId} is already registered`,
      });
      continue;
    }
    seenRoots.add(entry.root);
    seenIds.add(entry.projectId);
    projects.push(entry);
  }
  return { registry: { v: RUNTIME_PROTOCOL_VERSION, projects }, problems };
}

/** Reads the project registry, skipping (and reporting) damaged entries (WP-12 T5). */
export function readProjectRegistry(home: string): ProjectRegistry {
  return readProjectRegistryReport(home).registry;
}

/**
 * Adds or refreshes one root in the registry.
 *
 * The registry is keyed by canonical root: registering the same root twice updates
 * `lastOpenedAt` and keeps the original `addedAt`, which is what makes `project.open`
 * idempotent (`protocol.md` §5). `name` is the `project.create` label (WP-12 T5, Q1):
 * omitted keeps the stored one, so reopening a named project never erases its name.
 */
export function registerProject(
  home: string,
  entry: {
    readonly root: string;
    readonly projectId: string;
    readonly at: string;
    readonly name?: string;
  },
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
            ...(entry.name === undefined ? {} : { name: entry.name }),
            addedAt: entry.at,
            lastOpenedAt: entry.at,
          },
        ]
      : registry.projects.map((candidate) =>
          candidate.root === entry.root
            ? {
                ...candidate,
                projectId: entry.projectId,
                ...(entry.name === undefined ? {} : { name: entry.name }),
                lastOpenedAt: entry.at,
              }
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

// ---------------------------------------------------------------------------
// Per-Git-root lock (WP-12 T5, `reliability.md` §7)
// ---------------------------------------------------------------------------

/**
 * The per-Git-root lock record.
 *
 * `reliability.md` §7 makes the daemon take "每 Project 文件锁" before it loads a
 * database. The home-level `daemon.lock` only fences one installation; this record
 * fences one *repository* against a second project entry inside the same host (the
 * same root opened twice through different path spellings, or a root already served
 * under a different home — the latter is reported as a registered limitation,
 * WP-12 T5 Q5, because two homes cannot see each other's lock directory).
 */
export interface ProjectRootLock {
  readonly v: 1;
  readonly root: string;
  readonly pid: number;
  readonly home: string;
  readonly epoch: number;
  readonly acquiredAt: string;
}

export type AcquireProjectRootLockResult =
  | { readonly acquired: true; readonly lock: ProjectRootLock }
  | { readonly acquired: false; readonly holder: ProjectRootLock | null; readonly message: string };

/** Path of the lock file for one canonical Git root. */
export function projectRootLockPath(home: string, canonicalRoot: string): string {
  return join(runtimePaths(home).locks, projectLockFileName(canonicalRoot));
}

/** Reads one root lock; a missing or damaged file reads as absent. */
export function readProjectRootLock(home: string, canonicalRoot: string): ProjectRootLock | null {
  const path = projectRootLockPath(home, canonicalRoot);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<ProjectRootLock>;
    if (
      typeof parsed.root !== 'string' ||
      typeof parsed.pid !== 'number' ||
      typeof parsed.epoch !== 'number'
    ) {
      return null;
    }
    return {
      v: 1,
      root: parsed.root,
      pid: parsed.pid,
      home: typeof parsed.home === 'string' ? parsed.home : '',
      epoch: parsed.epoch,
      acquiredAt: typeof parsed.acquiredAt === 'string' ? parsed.acquiredAt : '',
    };
  } catch {
    return null;
  }
}

/**
 * Takes the per-root lock with an exclusive create, replacing a dead owner.
 *
 * @returns `acquired:false` with the live holder when another process serves the
 * same root; callers report that as `PROJECT_ALREADY_OPEN` naming the holder.
 */
export function acquireProjectRootLock(
  home: string,
  canonicalRoot: string,
  options: { readonly pid: number; readonly epoch: number; readonly now?: () => Date },
): AcquireProjectRootLockResult {
  ensureRuntimeHome(home);
  const path = projectRootLockPath(home, canonicalRoot);
  const existing = readProjectRootLock(home, canonicalRoot);
  if (existing !== null && isProcessAlive(existing.pid)) {
    return {
      acquired: false,
      holder: existing,
      message: `${canonicalRoot} is already served by pid ${String(existing.pid)} (home ${existing.home || 'unknown'})`,
    };
  }
  const lock: ProjectRootLock = {
    v: 1,
    root: canonicalRoot,
    pid: options.pid,
    home,
    epoch: options.epoch,
    acquiredAt: (options.now ?? (() => new Date()))().toISOString(),
  };
  try {
    writePrivateFile(path, `${JSON.stringify(lock, null, 2)}\n`, { exclusive: true });
    return { acquired: true, lock };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    // The file appeared between the read and the create: re-read and judge the winner.
    const current = readProjectRootLock(home, canonicalRoot);
    if (current !== null && isProcessAlive(current.pid)) {
      return {
        acquired: false,
        holder: current,
        message: `${canonicalRoot} is already served by pid ${String(current.pid)} (home ${current.home || 'unknown'})`,
      };
    }
    rmSync(path, { force: true });
    try {
      writePrivateFile(path, `${JSON.stringify(lock, null, 2)}\n`, { exclusive: true });
      return { acquired: true, lock };
    } catch (retryError) {
      if ((retryError as NodeJS.ErrnoException).code !== 'EEXIST') throw retryError;
      return {
        acquired: false,
        holder: readProjectRootLock(home, canonicalRoot),
        message: `${canonicalRoot} is already served by another process`,
      };
    }
  }
}

/** Releases one root lock, but only for the epoch that owns it. */
export function releaseProjectRootLock(
  home: string,
  canonicalRoot: string,
  epoch: number,
): boolean {
  const existing = readProjectRootLock(home, canonicalRoot);
  if (existing === null || existing.epoch !== epoch) return false;
  rmSync(projectRootLockPath(home, canonicalRoot), { force: true });
  return true;
}

// ---------------------------------------------------------------------------
// Installation-level once-Grant (WP-12 T5 Q4)
// ---------------------------------------------------------------------------

/**
 * One installation-level `once` Grant.
 *
 * The field names and semantics mirror the T3 `grant` entity's `once` scope
 * (`contracts/entities/run.ts` §grant): the authority is bound to **one operation**,
 * an explicit target list and an input hash, and it is consumed exactly once. A
 * `project.clone` happens *before* any project database exists, so the T3
 * `GrantStore` (which is keyed by a running Work inside a project) cannot hold it;
 * the row therefore lives in the installation home under the same model rather than
 * introducing a second authorization concept (WP-12 T5 Q4).
 */
export interface InstallationGrant {
  readonly id: string;
  readonly scope: 'once';
  /** The operation the authority is for, e.g. `project.clone`. */
  readonly operation: string;
  /** The bound targets: the destination root and the remote URL. */
  readonly targets: readonly string[];
  readonly inputHash: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly consumedAt?: string;
  readonly consumedByOperationId?: string;
}

interface InstallationGrantFile {
  readonly v: 1;
  readonly grants: readonly InstallationGrant[];
}

/** Path of the installation-level grant ledger. */
export function installationGrantPath(home: string): string {
  return join(runtimePaths(home).home, 'grants.json');
}

/** Reads every installation-level Grant; a damaged file is reported, never guessed at. */
export function readInstallationGrants(home: string): readonly InstallationGrant[] {
  const path = installationGrantPath(home);
  if (!existsSync(path)) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new RuntimeHomeError(
      'INSTALLATION_GRANT_INVALID',
      `installation grant ledger ${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const grants = (parsed as { readonly grants?: unknown }).grants;
  if (!Array.isArray(grants)) {
    throw new RuntimeHomeError(
      'INSTALLATION_GRANT_INVALID',
      `installation grant ledger ${path} does not match the contract: expected {v:1,grants:[]}`,
    );
  }
  return grants.filter(
    (grant): grant is InstallationGrant =>
      typeof grant === 'object' &&
      grant !== null &&
      typeof (grant as InstallationGrant).id === 'string' &&
      typeof (grant as InstallationGrant).operation === 'string' &&
      Array.isArray((grant as InstallationGrant).targets),
  );
}

/** Writes the ledger atomically with `0600`. */
export function writeInstallationGrants(home: string, grants: readonly InstallationGrant[]): void {
  const payload: InstallationGrantFile = { v: 1, grants };
  writePrivateFile(installationGrantPath(home), `${JSON.stringify(payload, null, 2)}\n`);
}

/**
 * Mints one installation-level `once` Grant for an explicit user act.
 *
 * @returns the stored row, so the caller can hand its `id` to `project.clone`.
 */
export function mintInstallationGrant(
  home: string,
  input: {
    readonly id: string;
    readonly operation: string;
    readonly targets: readonly string[];
    readonly inputHash: string;
    readonly ttlMs?: number;
    readonly now?: () => Date;
  },
): InstallationGrant {
  const now = (input.now ?? (() => new Date()))();
  const grant: InstallationGrant = {
    id: input.id,
    scope: 'once',
    operation: input.operation,
    targets: [...input.targets],
    inputHash: input.inputHash,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + (input.ttlMs ?? 15 * 60 * 1000)).toISOString(),
  };
  writeInstallationGrants(home, [...readInstallationGrants(home), grant]);
  return grant;
}

export type ConsumeInstallationGrantResult =
  | { readonly ok: true; readonly grant: InstallationGrant }
  | {
      readonly ok: false;
      readonly code: 'NOT_FOUND' | 'NOT_AUTHORIZED' | 'INVALID_STATE';
      readonly message: string;
    };

/**
 * Consumes one installation-level Grant exactly once.
 *
 * A missing id is `NOT_FOUND`; a mismatched operation/target/input hash or an expired
 * row is `NOT_AUTHORIZED`; an already consumed row is `INVALID_STATE` (a replay is
 * never silently admitted). The consume writes the row's `consumedAt` before the
 * caller's effect runs, so a crash cannot leave a reusable authority behind.
 */
export function consumeInstallationGrant(
  home: string,
  input: {
    readonly id: string;
    readonly operation: string;
    readonly targets: readonly string[];
    readonly inputHash: string;
    readonly byOperationId: string;
    readonly now?: () => Date;
  },
): ConsumeInstallationGrantResult {
  const grants = readInstallationGrants(home);
  const grant = grants.find((candidate) => candidate.id === input.id);
  if (grant === undefined) {
    return {
      ok: false,
      code: 'NOT_FOUND',
      message: `installation grant ${input.id} does not exist`,
    };
  }
  const now = (input.now ?? (() => new Date()))();
  if (grant.consumedAt !== undefined) {
    return {
      ok: false,
      code: 'INVALID_STATE',
      message: `installation grant ${input.id} was already consumed at ${grant.consumedAt}`,
    };
  }
  if (new Date(grant.expiresAt).getTime() <= now.getTime()) {
    return {
      ok: false,
      code: 'NOT_AUTHORIZED',
      message: `installation grant ${input.id} expired at ${grant.expiresAt}`,
    };
  }
  if (
    grant.operation !== input.operation ||
    grant.inputHash !== input.inputHash ||
    !sameTargets(grant.targets, input.targets)
  ) {
    return {
      ok: false,
      code: 'NOT_AUTHORIZED',
      message: `installation grant ${input.id} is not bound to ${input.operation} on the requested inputs`,
    };
  }
  const consumed: InstallationGrant = {
    ...grant,
    consumedAt: now.toISOString(),
    consumedByOperationId: input.byOperationId,
  };
  writeInstallationGrants(
    home,
    grants.map((candidate) => (candidate.id === grant.id ? consumed : candidate)),
  );
  return { ok: true, grant: consumed };
}

function sameTargets(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((value, index) => value === sortedRight[index]);
}

/**
 * The hash an installation-level Grant binds: `sha256` of the canonical JSON of the
 * operation + targets, so the same user act always produces the same binding
 * (`requirements.md`-style input hashing, mirroring T3's `inputHash`).
 */
export function installationGrantInputHash(input: {
  readonly operation: string;
  readonly targets: readonly string[];
}): string {
  return createHash('sha256')
    .update(JSON.stringify({ operation: input.operation, targets: [...input.targets].sort() }))
    .digest('hex');
}
