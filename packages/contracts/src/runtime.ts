/**
 * Runtime home contract (WP-11 A1).
 *
 * `docs/architecture/reliability.md` §7 fixes the command surface (`agentdev
 * start/stop/status/open …`) and `docs/architecture/protocol.md` §2 fixes the
 * addresses and credential: the daemon defaults to `127.0.0.1:4318`, the BFF to
 * `127.0.0.1:4317`, and "BFF 到 daemon 和本机 CLI 使用 0600 安装凭证 Bearer".
 * `docs/architecture/ARCHITECTURE.md` §5 puts the global config at
 * `~/.agentdev/config.toml`.
 *
 * This module is the single source of truth for the *files* both sides of that
 * contract read and write, so the CLI and the daemon cannot drift: the same names,
 * the same shapes, the same bounds. Anything that touches the filesystem lives in
 * `packages/core/src/runtime.ts` (daemon side) and `apps/cli/src/runtime.ts` (CLI
 * side); this module stays pure.
 */
import { z } from 'zod';

/** Environment variable that relocates the whole installation state directory. */
export const AGENTDEV_HOME_ENV = 'AGENTDEV_HOME';

/** Directory name of the installation state inside the user's home. */
export const RUNTIME_HOME_DIR = '.agentdev';

/** Version of the on-disk runtime records; a mismatch must fail loudly. */
export const RUNTIME_PROTOCOL_VERSION = 1;

/** Files and directories inside the runtime home. */
export const RUNTIME_FILES = {
  /** 0600 installation credential (`protocol.md` §2). */
  installationCredential: 'installation-token',
  /** Live daemon record: pid, epoch, ports, opened projects. */
  runtime: 'runtime.json',
  /** 0600 single-instance lock, written before the daemon binds anything. */
  lock: 'daemon.lock',
  /**
   * 0600 epoch high-water mark, kept across a clean stop (`reliability.md` §7).
   *
   * A clean stop removes the lock, so the fence value must outlive it; the next owner takes
   * `max(installed lock, this) + 1` (WP-11 T-03). `stop` never deletes it, and tools that
   * enumerate the home for cleanup therefore see the same name the daemon writes.
   */
  epoch: 'daemon.epoch',
  /** Registry of the Git roots this installation serves. */
  projects: 'projects.json',
  /** Global configuration (`ARCHITECTURE.md` §5). */
  config: 'config.toml',
  /** Log directory; one file per project plus `daemon.log`. */
  logs: 'logs',
  /** Per-project state directories (`project.sqlite`, blobs, worktrees). */
  projectsDir: 'projects',
} as const;

/** Default host; the daemon never listens on a public interface. */
export const DEFAULT_RUNTIME_HOST = '127.0.0.1';
/** BFF default (`protocol.md` §2). */
export const DEFAULT_WEB_PORT = 4317;
/** Daemon default (`protocol.md` §2). */
export const DEFAULT_DAEMON_PORT = 4318;

const portSchema = z.number().int().min(1).max(65_535);

/** Hosts the runtime may bind: loopback only (`reliability.md` §7). */
export const RUNTIME_HOSTS = ['127.0.0.1', '::1', 'localhost'] as const;
export type RuntimeHost = (typeof RUNTIME_HOSTS)[number];
const hostSchema = z.enum(RUNTIME_HOSTS);
const hexIdSchema = z.string().regex(/^[0-9a-f]{32}$/u, 'projectId is 32 lowercase hex chars');

/** One served Git root. `root` is canonical (realpath + `git rev-parse --show-toplevel`). */
export const projectRegistryEntrySchema = z
  .object({
    root: z.string().min(1),
    projectId: hexIdSchema,
    addedAt: z.string().min(1),
    lastOpenedAt: z.string().min(1),
  })
  .strict();
export type ProjectRegistryEntry = z.infer<typeof projectRegistryEntrySchema>;

/** The registry file. Unknown keys are refused so a hand edit cannot smuggle state. */
export const projectRegistrySchema = z
  .object({
    v: z.literal(RUNTIME_PROTOCOL_VERSION),
    projects: z.array(projectRegistryEntrySchema),
  })
  .strict();
export type ProjectRegistry = z.infer<typeof projectRegistrySchema>;

/** One opened project's listeners. `web` is null when the BFF is not started. */
export const runtimeInstanceSchema = z
  .object({
    projectId: hexIdSchema,
    root: z.string().min(1),
    daemon: z.object({ host: hostSchema, port: portSchema }).strict(),
    web: z.object({ host: hostSchema, port: portSchema }).strict().nullable(),
  })
  .strict();
export type RuntimeInstance = z.infer<typeof runtimeInstanceSchema>;

/** The live daemon record, written after the listeners bind and removed on stop. */
export const runtimeRecordSchema = z
  .object({
    v: z.literal(RUNTIME_PROTOCOL_VERSION),
    pid: z.number().int().positive(),
    epoch: z.number().int().positive(),
    startedAt: z.string().min(1),
    version: z.string().min(1),
    home: z.string().min(1),
    /** Loopback admin surface the CLI uses to open/close projects (`open <path>`). */
    admin: z.object({ host: hostSchema, port: portSchema }).strict(),
    instances: z.array(runtimeInstanceSchema),
  })
  .strict();
export type RuntimeRecord = z.infer<typeof runtimeRecordSchema>;

/** The single-instance lock. An expired/dead pid may be taken over with a new epoch. */
export const daemonLockSchema = z
  .object({
    v: z.literal(RUNTIME_PROTOCOL_VERSION),
    pid: z.number().int().positive(),
    epoch: z.number().int().positive(),
    startedAt: z.string().min(1),
  })
  .strict();
export type DaemonLock = z.infer<typeof daemonLockSchema>;

/** Listener defaults, overridable through `~/.agentdev/config.toml`. */
export const DEFAULT_LISTENERS = {
  daemon: { host: DEFAULT_RUNTIME_HOST, port: DEFAULT_DAEMON_PORT },
  web: { host: DEFAULT_RUNTIME_HOST, port: DEFAULT_WEB_PORT },
} as const;

/**
 * Resolves the runtime home.
 *
 * `AGENTDEV_HOME` wins over the default so tests and a second installation can use a
 * temporary directory without touching the user's state.
 *
 * @param env process environment (injected so tests stay deterministic)
 * @param homeDir the user's home directory (usually `os.homedir()`)
 */
export function runtimeHomePath(env: NodeJS.ProcessEnv, homeDir: string): string {
  const override = env[AGENTDEV_HOME_ENV];
  if (typeof override === 'string' && override.trim().length > 0) return override.trim();
  return `${homeDir}/${RUNTIME_HOME_DIR}`;
}

/** Every path inside the runtime home, so no caller re-derives a file name. */
export interface RuntimePaths {
  readonly home: string;
  readonly installationCredential: string;
  readonly runtime: string;
  readonly lock: string;
  /** Epoch high-water mark that survives a clean stop (`RUNTIME_FILES.epoch`). */
  readonly epoch: string;
  readonly projects: string;
  readonly config: string;
  readonly logs: string;
  readonly projectsDir: string;
}

/** Builds the path set of one runtime home. */
export function runtimePaths(home: string): RuntimePaths {
  const join = (name: string): string =>
    home.endsWith('/') ? `${home}${name}` : `${home}/${name}`;
  return {
    home,
    installationCredential: join(RUNTIME_FILES.installationCredential),
    runtime: join(RUNTIME_FILES.runtime),
    lock: join(RUNTIME_FILES.lock),
    epoch: join(RUNTIME_FILES.epoch),
    projects: join(RUNTIME_FILES.projects),
    config: join(RUNTIME_FILES.config),
    logs: join(RUNTIME_FILES.logs),
    projectsDir: join(RUNTIME_FILES.projectsDir),
  };
}

/** State directory of one project (`project.sqlite`, blobs and worktrees live here). */
export function projectStateDir(home: string, projectId: string): string {
  return `${runtimePaths(home).projectsDir}/${projectId}`;
}

/** An empty registry for a fresh installation. */
export function emptyProjectRegistry(): ProjectRegistry {
  return { v: RUNTIME_PROTOCOL_VERSION, projects: [] };
}
