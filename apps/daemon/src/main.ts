#!/usr/bin/env node
/**
 * `agentdevd` host (WP-11 A1).
 *
 * `docs/architecture/reliability.md` §7 fixes what starting the product means:
 *
 * > `agentdev start` 启动 daemon 和 web；… daemon 获取每 Project 文件锁和 epoch 后加载
 * > 数据库、迁移、检查 outbox/Run；… 优雅停止：停止准入→持久化 mailbox/outbox→请求
 * > Runner 安全停→保存 Checkpoint→回收容器/进程→关闭数据库。
 *
 * and `protocol.md` §2 fixes the addresses (daemon `127.0.0.1:4318`, BFF
 * `127.0.0.1:4317`) and the credential ("BFF 到 daemon 和本机 CLI 使用 0600 安装凭证
 * Bearer").
 *
 * This module owns that lifecycle: state home, single-instance lock with epoch, per
 * project `ProjectRuntime` assembly (via `bootstrap.ts`), the loopback admin surface the
 * CLI uses, the live `runtime.json` record and graceful shutdown. It performs no
 * business logic — the projects it serves do.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import {
  RUNTIME_PROTOCOL_VERSION,
  DEFAULT_LISTENERS,
  type RuntimeHost,
  type RuntimeInstance,
  type RuntimeRecord,
} from '@agentdev/contracts';
import {
  AuthService,
  RuntimeHomeError,
  SecretStore,
  createProjectExecution,
  type ProjectExecution,
  acquireDaemonLock,
  clearRuntimeRecord,
  ensureRuntimeHome,
  readInstallationCredential,
  readProjectRegistry,
  readRuntimeRecord,
  registerProject,
  releaseDaemonLock,
  resolveProjectIdentity,
  writeRuntimeRecord,
} from '@agentdev/core';

import { DEFAULT_WEB_ORIGIN, openProject, type OpenedProject } from './bootstrap.js';
import { createPrepareRun } from './prepare-run.js';
import { createChildRunnerSpawnPort } from './runner-spawn.js';

/** Version reported by `/healthz`, the runtime record and the admin surface. */
export const RUNTIME_VERSION = '0.1.0';

export interface StartRuntimeOptions {
  readonly home: string;
  readonly version?: string;
  /** Repository checkout holding `apps/runner` (the child process entry). */
  readonly repoRoot?: string;
  /** Run the executor (default true); `false` serves the UI without executing Runs. */
  readonly execute?: boolean;
  /** Test seams for the Runner process. */
  readonly runnerEnv?: NodeJS.ProcessEnv;
  readonly host?: RuntimeHost;
  /** Primary project ports; defaults are `protocol.md` §2's 4318 / 4317. */
  readonly daemonPort?: number;
  readonly webPort?: number;
  readonly adminPort?: number;
  /** Roots to open. When omitted, the registry decides. */
  readonly roots?: readonly string[];
  /** Trust newly registered roots (the CLI's explicit `open` acts as the trust act). */
  readonly trust?: boolean;
  readonly withWeb?: boolean;
  readonly log?: (line: string) => void;
}

export interface RunningRuntime {
  readonly home: string;
  readonly epoch: number;
  /** Execution stacks of the opened projects (`A2-T6`). */
  readonly executions: readonly ProjectExecution[];
  /** Set once the admin listener is bound; `status` reads it from `runtime.json`. */
  admin: { readonly host: RuntimeHost; readonly port: number };
  readonly instances: readonly RuntimeInstance[];
  readonly record: RuntimeRecord;
  /** Opens one more project (idempotent per canonical root) and returns its instance. */
  open(root: string, options?: { readonly trust?: boolean }): Promise<RuntimeInstance>;
  /** Graceful stop: admission first, then listeners, then databases, then the lock. */
  stop(): Promise<void>;
  readonly stopped: boolean;
}

function constantTimeEquals(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const text = `${JSON.stringify(body)}\n`;
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(text);
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    bytes += buffer.length;
    // The admin surface only accepts small JSON documents; anything larger is refused
    // without buffering it (requests are loopback-sourced but still untrusted).
    if (bytes > 64 * 1024) throw new Error('request body too large');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Starts the runtime: lock, projects, listeners, admin surface, live record.
 *
 * @throws RuntimeHomeError `ALREADY_RUNNING` when another live daemon owns the home.
 */
export async function startRuntime(options: StartRuntimeOptions): Promise<RunningRuntime> {
  const host = options.host ?? DEFAULT_LISTENERS.daemon.host;
  const version = options.version ?? RUNTIME_VERSION;
  // Human progress goes to stderr so stdout carries exactly one machine-readable start
  // record (the CLI reads `runtime.json`, but a shell user piping stdout gets JSON).
  const log = options.log ?? ((line: string) => process.stderr.write(`${line}\n`));
  const home = options.home;
  ensureRuntimeHome(home);

  const lock = acquireDaemonLock(home, { pid: process.pid });
  if (!lock.acquired) {
    throw new RuntimeHomeError(
      'ALREADY_RUNNING',
      `agentdevd is already running for ${home} (pid ${String(lock.lock.pid)}, epoch ${String(lock.lock.epoch)})`,
    );
  }
  if (lock.replacedStale) {
    log(
      `agentdevd: took over a stale lock from pid ${String(lock.replacedStaleFrom?.pid ?? 'unknown')} (epoch ${String(lock.replacedStaleFrom?.epoch ?? 'unknown')}); this daemon now holds epoch ${String(lock.lock.epoch)}`,
    );
  }

  const auth = AuthService.loadOrCreate({
    stateDir: home,
    config: { deployment: 'loopback', allowedOrigins: [DEFAULT_WEB_ORIGIN] },
  });
  const installationToken = readInstallationCredential(home);

  const opened: OpenedProject[] = [];
  const instances: RuntimeInstance[] = [];
  const executions: ProjectExecution[] = [];
  const secrets = new SecretStore();
  const repoRoot =
    options.repoRoot ?? resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  let record: RuntimeRecord | null = null;
  let adminServer: Server | null = null;
  let stopping = false;

  const runtime: RunningRuntime = {
    home,
    epoch: lock.lock.epoch,
    admin: { host, port: 0 },
    get executions() {
      return executions;
    },
    get instances() {
      return instances;
    },
    get record() {
      if (record === null)
        throw new RuntimeHomeError('NOT_STARTED', 'the runtime has no record yet');
      return record;
    },
    get stopped() {
      return stopping;
    },
    open: (root, openOptions) => openImpl(root, openOptions),
    stop: async () => {
      if (stopping) return;
      stopping = true;
      // 1. Stop admission: the admin surface and the BFF stop accepting new work first.
      if (adminServer !== null) {
        await new Promise<void>((resolve) => adminServer?.close(() => resolve()));
        adminServer = null;
      }
      // 2. Stop executing: no new Attempts, runners asked to shut down, gateway closed.
      for (const execution of executions) {
        await execution.stop();
      }
      executions.length = 0;
      // 3. Close every project's listeners and databases.
      for (const project of opened) {
        await project.close();
      }
      opened.length = 0;
      instances.length = 0;
      // 4. Remove the live record only when it is still ours, then release the lock for
      // this epoch only — a peer that took over must not lose its record (WP11R1-10).
      const live = readRuntimeRecord(home);
      if (live === null || (live.pid === process.pid && live.epoch === lock.lock.epoch)) {
        clearRuntimeRecord(home);
      }
      releaseDaemonLock(home, lock.lock.epoch);
      log('agentdevd: stopped');
    },
  };

  /**
   * Opens one project and publishes it in the registry and the live record.
   *
   * Declared as a hoisted function so `runtime.open` can hand it out before the object
   * exists; `project.open` is idempotent for an already-open root (`protocol.md` §5), so
   * the canonical identity decides and a subdirectory resolves to the same instance.
   */
  async function openImpl(
    root: string,
    openOptions?: { readonly trust?: boolean },
  ): Promise<RuntimeInstance> {
    const canonicalRoot = resolveProjectIdentity(root).canonicalRoot;
    const existing = instances.find((candidate) => candidate.root === canonicalRoot);
    if (existing !== undefined) {
      registerProject(home, {
        root: existing.root,
        projectId: existing.projectId,
        at: new Date().toISOString(),
      });
      return existing;
    }
    const instance = await openRoot(root, openOptions?.trust ?? options.trust ?? false);
    registerProject(home, {
      root: instance.root,
      projectId: instance.projectId,
      at: new Date().toISOString(),
    });
    writeRecord();
    return instance;
  }

  const openRoot = async (root: string, trust: boolean): Promise<RuntimeInstance> => {
    const project = await openProject({
      root,
      home,
      auth,
      installationToken,
      version,
      ...(options.withWeb === undefined ? {} : { withWeb: options.withWeb }),
      ...(instances.length === 0
        ? {
            daemonPort: options.daemonPort ?? DEFAULT_LISTENERS.daemon.port,
            webPort: options.webPort ?? DEFAULT_LISTENERS.web.port,
          }
        : {}),
      host,
      trust: trust ? 'trusted' : 'untrusted',
    });
    opened.push(project);
    if (options.execute !== false) {
      const execution = await createProjectExecution({
        store: project.store,
        config: project.config,
        snapshots: project.snapshots,
        secrets,
        prepare: ({ capabilities, gatewayUrl }) =>
          createPrepareRun({
            store: project.store,
            config: project.config,
            capabilities,
            gatewayUrl,
            projectRoot: project.root,
            attemptsDir: join(project.dataDir, 'attempts'),
            log,
          }),
        spawn: createChildRunnerSpawnPort({
          repoRoot,
          log,
          ...(options.runnerEnv === undefined ? {} : { env: options.runnerEnv }),
        }),
        log,
      });
      executions.push(execution);
      // The previous daemon may have died mid-Attempt: reconcile before scheduling
      // (`reliability.md` §7), then start ticking.
      // The host epoch must be strictly newer than the one the previous daemon recorded,
      // so it carries the start time as well as the pid and the lock epoch.
      execution.start(
        `host-${String(process.pid)}-${String(lock.lock.epoch)}-${new Date().toISOString()}`,
      );
    }
    const instance: RuntimeInstance = {
      projectId: project.projectId,
      root: project.root,
      daemon: { host, port: project.ports.daemon },
      web: project.ports.web === null ? null : { host, port: project.ports.web },
    };
    instances.push(instance);
    log(
      `agentdevd: opened ${project.root} (project ${project.projectId}) daemon=${String(project.ports.daemon)} web=${String(project.ports.web ?? '-')}`,
    );
    return instance;
  };

  const writeRecord = (): void => {
    const next: RuntimeRecord = {
      v: RUNTIME_PROTOCOL_VERSION,
      pid: process.pid,
      epoch: lock.lock.epoch,
      startedAt: lock.lock.startedAt,
      version,
      home,
      admin: { host, port: runtime.admin.port },
      instances: [...instances],
    };
    record = next;
    writeRuntimeRecord(home, next);
  };

  try {
    const registry = readProjectRegistry(home);
    // An *empty* `--root` list means "whatever this installation has registered": `??`
    // alone ignored the registry (WP11R1-08).
    const roots =
      options.roots !== undefined && options.roots.length > 0
        ? options.roots
        : registry.projects.map((entry) => entry.root);
    for (const root of roots) {
      // Registered like any other open, so `agentdev start --root <path>` is remembered for
      // the next start (WP11R1-08).
      await openImpl(root, { trust: options.trust ?? false });
    }

    // The admin surface is what `agentdev open/status/stop` talk to. It carries the
    // installation credential as Bearer and never leaves loopback.
    adminServer = createServer((request, response) => {
      void handleAdmin(request, response).catch((error: unknown) => {
        sendJson(response, 500, {
          ok: false,
          error: {
            code: 'INTERNAL_ERROR',
            message: error instanceof Error ? error.message : String(error),
          },
        });
      });
    });
    runtime.admin = { host, port: await listenAdmin(adminServer, options.adminPort ?? 0, host) };
    writeRecord();
  } catch (error) {
    // A failed start must not leave a lock or a live record behind.
    await runtime.stop();
    throw error;
  }

  async function handleAdmin(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const authorization = request.headers.authorization ?? '';
    const bearer = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : '';
    if (!constantTimeEquals(bearer, installationToken)) {
      sendJson(response, 401, {
        ok: false,
        error: { code: 'UNAUTHENTICATED', message: 'the installation credential is required' },
      });
      return;
    }
    const url = new URL(request.url ?? '/', `http://${host}`);
    if (request.method === 'GET' && (url.pathname === '/health' || url.pathname === '/healthz')) {
      sendJson(response, 200, {
        ok: true,
        ready: true,
        version,
        epoch: lock.lock.epoch,
        pid: process.pid,
        home,
        instances,
        execution: {
          enabled: options.execute !== false,
          live: executions.reduce((total, entry) => total + entry.liveCount(), 0),
        },
      });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/projects') {
      sendJson(response, 200, { ok: true, registry: readProjectRegistry(home), instances });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/projects') {
      let body: unknown;
      try {
        body = JSON.parse(await readBody(request));
      } catch (error) {
        sendJson(response, 400, {
          ok: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: error instanceof Error ? error.message : 'invalid body',
          },
        });
        return;
      }
      const root = (body as { root?: unknown }).root;
      if (typeof root !== 'string' || root.trim().length === 0) {
        sendJson(response, 400, {
          ok: false,
          error: { code: 'VALIDATION_ERROR', message: 'root is required' },
        });
        return;
      }
      const trust = (body as { trust?: unknown }).trust;
      try {
        const instance = await runtime.open(root, {
          trust: trust === undefined ? true : trust === true,
        });
        sendJson(response, 200, { ok: true, instance });
      } catch (error) {
        sendJson(response, 422, {
          ok: false,
          error: {
            code:
              error instanceof Error && 'code' in error
                ? String(error.code)
                : 'PROJECT_OPEN_FAILED',
            message: error instanceof Error ? error.message : String(error),
          },
        });
      }
      return;
    }
    if (request.method === 'POST' && url.pathname === '/stop') {
      sendJson(response, 202, { ok: true, stopping: true });
      // Answer first, then stop: the CLI waits for the socket to drop.
      setImmediate(() => {
        void runtime.stop().then(
          () => process.exit(0),
          () => process.exit(1),
        );
      });
      return;
    }
    sendJson(response, 404, { ok: false, error: { code: 'NOT_FOUND', message: url.pathname } });
  }

  return runtime;
}

async function listenAdmin(server: Server, port: number, host: string): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address !== 'object') {
    throw new RuntimeHomeError('LISTEN_FAILED', 'the admin listener reported no address');
  }
  return address.port;
}

/** Arguments of the `agentdevd` process entry. */
export interface RuntimeCliOptions {
  readonly home: string;
  readonly roots: readonly string[];
  readonly daemonPort?: number;
  readonly webPort?: number;
  readonly adminPort?: number;
  readonly withWeb: boolean;
  readonly trust: boolean;
}

export function parseRuntimeArgs(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
): RuntimeCliOptions {
  const options: {
    home?: string;
    roots: string[];
    daemonPort?: number;
    webPort?: number;
    adminPort?: number;
    withWeb: boolean;
    trust: boolean;
  } = { roots: [], withWeb: true, trust: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = (): string => {
      index += 1;
      const value = argv[index];
      if (value === undefined) throw new Error(`${arg} requires a value`);
      return value;
    };
    if (arg === '--home') options.home = next();
    else if (arg === '--root') options.roots.push(next());
    else if (arg === '--daemon-port') options.daemonPort = Number(next());
    else if (arg === '--web-port') options.webPort = Number(next());
    else if (arg === '--admin-port') options.adminPort = Number(next());
    else if (arg === '--no-web') options.withWeb = false;
    else if (arg === '--trust') options.trust = true;
    else throw new Error(`unknown option: ${arg}`);
  }
  const home = options.home ?? env.AGENTDEV_HOME;
  if (home === undefined || home.length === 0) {
    throw new Error('--home (or AGENTDEV_HOME) is required');
  }
  return {
    home,
    roots: options.roots,
    withWeb: options.withWeb,
    trust: options.trust,
    ...(options.daemonPort === undefined ? {} : { daemonPort: options.daemonPort }),
    ...(options.webPort === undefined ? {} : { webPort: options.webPort }),
    ...(options.adminPort === undefined ? {} : { adminPort: options.adminPort }),
  };
}

/**
 * Runs the host as a process: parse argv, start, print the one-line start record and
 * wait for a signal.
 *
 * Exported (instead of only living behind the `import.meta.url` bin check) so a
 * development/test bootstrap can start the host from the repository sources without a
 * `dist` build; the shipped path calls it through the bin check below.
 *
 * @returns the process exit code; the caller exits with it.
 */
export async function runAsProcess(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
): Promise<number> {
  let options: RuntimeCliOptions;
  try {
    options = parseRuntimeArgs(argv, env);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
  let runtime: RunningRuntime;
  try {
    runtime = await startRuntime({
      home: options.home,
      roots: options.roots,
      withWeb: options.withWeb,
      trust: options.trust,
      ...(options.daemonPort === undefined ? {} : { daemonPort: options.daemonPort }),
      ...(options.webPort === undefined ? {} : { webPort: options.webPort }),
      ...(options.adminPort === undefined ? {} : { adminPort: options.adminPort }),
    });
  } catch (error) {
    const code = error instanceof RuntimeHomeError ? error.code : 'START_FAILED';
    process.stderr.write(`${code}: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
  process.stdout.write(
    `${JSON.stringify({ status: 'started', home: runtime.home, epoch: runtime.epoch, admin: runtime.admin, instances: runtime.instances })}\n`,
  );
  const shutdown = (): void => {
    void runtime.stop().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  // Never resolves: the admin listener keeps the event loop alive and a signal ends the
  // process. The project listeners are owned by `openProject`, closed by `runtime.stop()`.
  return await new Promise<never>(() => undefined);
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  process.exit(await runAsProcess(process.argv.slice(2), process.env));
}
