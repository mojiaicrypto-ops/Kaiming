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
import { createToolHandler, executionModeForPermissionMode } from './tool-handler.js';
import {
  AuthService,
  PlanGateService,
  RuntimeHomeError,
  SecretStore,
  createProjectExecution,
  createSecretRepository,
  loadSecretsIntoStore,
  redact,
  type ProjectExecution,
  type SecretBackendName,
  type SecretLoadResult,
  type SecretRepository,
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
import { createControlHandlers } from './control-handler.js';
import { markMessageProcessing, markMessageSettled } from './message-state.js';
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
  /**
   * Durable credential backend (WP-12 T1.1); defaults to `AGENTDEV_SECRET_BACKEND` /
   * the platform rule in `execution.md` §4. Tests pin `file` so they never touch the
   * real Keychain.
   */
  readonly secretBackend?: SecretBackendName;
}

export interface RunningRuntime {
  readonly home: string;
  readonly epoch: number;
  /** Execution stacks of the opened projects (`A2-T6`). */
  readonly executions: readonly ProjectExecution[];
  /**
   * The in-memory credential store the Gateway resolves against, already loaded from
   * {@link secretRepository} (WP-12 T1.1).
   */
  readonly secrets: SecretStore;
  /** The durable credential repository the admin `/secret` surface writes. */
  readonly secretRepository: SecretRepository;
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

/**
 * Largest admin request body the loopback surface buffers, **inclusive** (R2-05).
 *
 * A body of exactly this many bytes is accepted; one byte more is refused with the typed
 * `413 VALIDATION_ERROR` below.
 */
export const ADMIN_BODY_LIMIT_BYTES = 64 * 1024;

/**
 * An admin-surface refusal with the HTTP status it implies (WP-12 T1.1).
 *
 * The admin routes answer an `error.code` like the protocol table; an oversized body is
 * a validation failure at the transport, so it is `413` with `VALIDATION_ERROR` instead
 * of the generic `500` a bare `Error` used to produce.
 */
export class AdminRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'AdminRequestError';
    this.status = status;
    this.code = code;
  }
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    bytes += buffer.length;
    // The admin surface only accepts small JSON documents: a body of exactly
    // `ADMIN_BODY_LIMIT_BYTES` is fine, one byte more is refused without buffering it
    // (requests are loopback-sourced but still untrusted).
    if (bytes > ADMIN_BODY_LIMIT_BYTES) {
      throw new AdminRequestError(
        413,
        'VALIDATION_ERROR',
        `the request body exceeds ${String(ADMIN_BODY_LIMIT_BYTES)} bytes`,
      );
    }
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

  try {
    // `auth` and the credential are read first: a home with a broken credential file must
    // fail before any listener is bound, and the lock taken above must not be left behind.
    const auth = AuthService.loadOrCreate({
      stateDir: home,
      config: { deployment: 'loopback', allowedOrigins: [DEFAULT_WEB_ORIGIN] },
    });
    const installationToken = readInstallationCredential(home);

    const opened: OpenedProject[] = [];
    const instances: RuntimeInstance[] = [];
    const executions: ProjectExecution[] = [];
    // WP-12 T1.1: the durable repository (AES-256-GCM file or macOS Keychain) is loaded
    // into the in-memory store *before* any project execution stack is built, so a
    // registered Provider credential works for `gateway` audience resolution from the
    // first call. Registration is still not authorization: the Grant check is unchanged.
    const secretRepository = createSecretRepository({
      home,
      ...(options.secretBackend === undefined ? {} : { backend: options.secretBackend }),
    });
    const secrets = new SecretStore();
    // The load is tolerant by design (W12T1-01): a corrupt or foreign file is reported and
    // skipped, and the daemon still starts. This try/catch is belt-and-braces so a future
    // backend bug can never turn a bad credential file into an unbootable installation.
    let loadedSecrets: SecretLoadResult = { loaded: 0, failed: [], problems: [] };
    try {
      loadedSecrets = loadSecretsIntoStore(secretRepository, secrets);
    } catch (error) {
      log(
        `agentdevd: the ${secretRepository.backend} secret store could not be read (${
          error instanceof Error && 'code' in error ? String(error.code) : 'SECRET_STORE_FAILED'
        }): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (loadedSecrets.loaded > 0) {
      log(
        `agentdevd: loaded ${String(loadedSecrets.loaded)} secret(s) from the ${secretRepository.backend} backend`,
      );
    }
    for (const failure of loadedSecrets.failed) {
      // Loud, but not fatal: a broken record must not stop the UI from starting. The
      // affected ref is reported `configured:false`/`health:unreadable` by `secret.list`
      // and fails closed if it is used.
      log(
        `agentdevd: secret ${failure.ref} could not be loaded (${failure.code}): ${failure.message}`,
      );
    }
    for (const problem of loadedSecrets.problems) {
      log(`agentdevd: ignoring an unusable secret file (${problem.code}): ${problem.message}`);
    }
    const repoRoot =
      options.repoRoot ?? resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
    let record: RuntimeRecord | null = null;
    let adminServer: Server | null = null;
    let stopping = false;

    const runtime: RunningRuntime = {
      home,
      epoch: lock.lock.epoch,
      admin: { host, port: 0 },
      secrets,
      secretRepository,
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
        secrets,
        secretRepository,
      });
      opened.push(project);
      if (options.execute !== false) {
        // `execution.md` §1 fixes the execution mode per permission policy: Workspace and
        // Autonomous run the tools in Linux containers and refuse admission when Docker is
        // unavailable; Full Access is the explicit, non-root host process. The Broker
        // refuses container mode without Docker and **never** falls back (`broker.ts`), so
        // the mapping is the documented one rather than a silent downgrade.
        const permissionMode = project.config.project().policy.permissionMode;
        const toolMode = executionModeForPermissionMode(permissionMode);
        const execution = await createProjectExecution({
          store: project.store,
          config: project.config,
          snapshots: project.snapshots,
          secrets,
          prepare: ({ capabilities, gatewayUrl, controlUrl }) =>
            createPrepareRun({
              store: project.store,
              config: project.config,
              capabilities,
              gatewayUrl,
              controlUrl,
              projectRoot: project.root,
              attemptsDir: join(project.dataDir, 'attempts'),
              // The real Context plane (`context.md` §1): the same policy, role
              // contract, Git tree and artifacts `context.preview` reads.
              artifacts: project.services.artifacts,
              gitReader: project.git,
              snapshots: project.snapshots,
              readMessageBody: (path) => Buffer.from(project.blobs.read(path)).toString('utf8'),
              snapshotRoot: project.dataDir,
              projectId: project.projectId,
              log,
            }),
          spawn: createChildRunnerSpawnPort({
            repoRoot,
            log,
            ...(options.runnerEnv === undefined ? {} : { env: options.runnerEnv }),
          }),
          // `execution.md` §3: Review/Test may write only their own report/scratch root.
          // `permissionMode` has no runtime consumer yet (T3 F13/D-T3-7), so the tool
          // shells run in the documented default mode (`host` in the handler) and the
          // container mode stays an explicit, registered gap.
          broker: {
            dataDir: project.dataDir,
            writableReportRoots: [join(project.dataDir, 'tool-reports')],
          },
          // The daemon adds the services only the application has: the artifact service,
          // the Plan gate (AC-013) and the workspace resolver (`tool-handler.ts`).
          tools: {
            attach: ({ store, broker, grantService, readLedgers }) =>
              createToolHandler({
                store,
                broker,
                grantService,
                readLedgers,
                // `AC-051`: the store a tool-audience secret is resolved from, under the
                // Run's own `secret` Grant.
                secrets,
                artifacts: project.services.artifacts,
                // The same store and blob root the bootstrap opened
                // (`PlanGateService` defaults its blob store to `store.dataDir`).
                planGate: new PlanGateService({
                  store: project.store,
                  artifacts: project.services.artifacts,
                }),
                mode: toolMode,
                log,
              }),
          },
          // `protocol.md` §6: the Runner's Chief/professional tools land here, and the
          // message behind each Run moves `received → processing → processed/failed`
          // (`experience.md` §22) as the supervisor observes it.
          control: {
            attach: ({ orchestrator, stageGate, readLedgers }) =>
              createControlHandlers({
                store: project.store,
                orchestrator,
                stageGate,
                readLedgers,
                artifacts: project.services.artifacts,
                requirementSaves: project.services.requirementSaves,
                log,
              }),
            onAttemptStarted: ({ runId }) => markMessageProcessing(project.store, runId),
            onRunSettled: ({ runId, status }) => markMessageSettled(project.store, runId, status),
          },
          log,
        });
        executions.push(execution);
        // The workbench's `work.control resume` needs the executor to resolve a parked Run
        // (`WP11R4-02`); the protocol is built before the stack exists, so it is attached now.
        project.protocol.attachRunRecovery({
          recordResumeDecision: ({ runId }) => execution.supervisor.recordResumeDecision(runId),
          resumeParkedRun: (runId) => execution.supervisor.resumeParkedRun(runId),
        });
        // `conversation.message.send` queues the Chief assessment Run and `plan.approve`
        // queues the next professional Run through this same orchestrator (WP-12 T2.1).
        project.protocol.attachOrchestrator(execution.orchestrator);
        project.protocol.attachGateway(execution.gateway);
        // `protocol.md` §4 `permission.request`/`permission.respond` and the cancel
        // cleanup (`reliability.md` §6) come from the stack's own Grant service and Broker.
        project.protocol.attachToolBridge({
          requestPermission: (input) => {
            const decided = execution.grantService.requestPermission(input);
            return {
              decisionId: decided.decisionId,
              version: decided.version,
              state: decided.state,
              blockerAttached: decided.blockerAttached,
              ...(decided.runStatus === undefined ? {} : { runStatus: decided.runStatus }),
            };
          },
          respondPermission: (input) => {
            if (input.choice === 'deny') {
              const denied = execution.grantService.denyPermission(
                input.decisionId,
                input.runId,
                input.reason,
              );
              return {
                decisionId: denied.decisionId,
                version: denied.version,
                state: denied.state,
                blockerAttached: denied.blockerAttached,
                ...(denied.runStatus === undefined ? {} : { runStatus: denied.runStatus }),
              };
            }
            const approved = execution.grantService.approvePermission({
              decisionId: input.decisionId,
              operation: input.operation,
              runId: input.runId,
              role: input.role,
              stage: input.stage,
              targets: input.targets,
              toolOperationId: input.toolOperationId,
              inputHash: input.inputHash,
              expiresAt: input.expiresAt,
              ...(input.scope === undefined ? {} : { scope: input.scope }),
              ...(input.limits === undefined ? {} : { limits: input.limits }),
            });
            return {
              decisionId: approved.decisionId,
              version: approved.version,
              state: approved.state,
              blockerAttached: approved.blockerAttached,
              ...(approved.grant === undefined ? {} : { grantId: approved.grant.id }),
              ...(approved.runStatus === undefined ? {} : { runStatus: approved.runStatus }),
            };
          },
          cleanupRun: (runId) => execution.cleanupRun(runId),
        });
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
          // A typed admin refusal keeps its status/code (an oversized body is 413
          // VALIDATION_ERROR); anything else is the honest 500.
          if (error instanceof AdminRequestError) {
            sendJson(response, error.status, {
              ok: false,
              error: { code: error.code, message: error.message },
            });
            return;
          }
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
      const bearer = authorization.startsWith('Bearer ')
        ? authorization.slice('Bearer '.length)
        : '';
      if (!constantTimeEquals(bearer, installationToken)) {
        sendJson(response, 401, {
          ok: false,
          error: { code: 'UNAUTHENTICATED', message: 'the installation credential is required' },
        });
        return;
      }
      const url = new URL(request.url ?? '/', `http://${host}`);
      if (request.method === 'GET' && (url.pathname === '/health' || url.pathname === '/healthz')) {
        // `protocol.md` §5: health reports readiness and the version, never a path or a
        // secret. Neither the installation home nor any project root appears here (R2-03);
        // the operator reads the full instance list from `GET /projects` or `runtime.json`.
        sendJson(response, 200, {
          ok: true,
          ready: true,
          version,
          epoch: lock.lock.epoch,
          pid: process.pid,
          projects: instances.length,
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
          // An oversized body keeps its own 413/code; only a malformed one is 400.
          if (error instanceof AdminRequestError) throw error;
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
      // WP-12 T1.1: the CLI's live path. A running daemon registers or removes a
      // credential without a restart; the value goes to the durable repository and the
      // in-memory store, and is never echoed back or logged.
      if (request.method === 'POST' && url.pathname === '/secret') {
        let body: unknown;
        try {
          body = JSON.parse(await readBody(request));
        } catch (error) {
          // An oversized body keeps its own 413/code; only a malformed one is 400.
          if (error instanceof AdminRequestError) throw error;
          // Deliberately not the parser's message: it can quote a fragment of the body,
          // which here is a credential.
          sendJson(response, 400, {
            ok: false,
            error: { code: 'VALIDATION_ERROR', message: 'the request body is not JSON' },
          });
          return;
        }
        const ref = (body as { ref?: unknown }).ref;
        const value = (body as { value?: unknown }).value;
        const audience = (body as { audience?: unknown }).audience;
        if (typeof ref !== 'string' || ref.length === 0) {
          sendJson(response, 422, {
            ok: false,
            error: { code: 'VALIDATION_ERROR', message: 'ref is required' },
          });
          return;
        }
        if (typeof value !== 'string') {
          sendJson(response, 422, {
            ok: false,
            error: { code: 'VALIDATION_ERROR', message: 'value is required' },
          });
          return;
        }
        if (audience !== undefined && audience !== 'gateway' && audience !== 'tool') {
          sendJson(response, 422, {
            ok: false,
            error: { code: 'VALIDATION_ERROR', message: 'audience must be gateway or tool' },
          });
          return;
        }
        try {
          const summary = secretRepository.set(ref, value, {
            audience: audience ?? 'gateway',
          });
          secrets.put({ ref, value, audience: audience ?? 'gateway' });
          sendJson(response, 200, { ok: true, secret: summary });
        } catch (error) {
          sendJson(response, 422, {
            ok: false,
            error: {
              code:
                error instanceof Error && 'code' in error ? String(error.code) : 'SECRET_FAILED',
              // `execution.md` §4: a failure message is masked with the store's own helper,
              // so no branch of this route can echo the credential.
              message: redact(
                error instanceof Error ? error.message : 'the secret could not be stored',
                [value],
              ),
            },
          });
        }
        return;
      }
      if (request.method === 'DELETE' && url.pathname === '/secret') {
        let body: unknown;
        try {
          body = JSON.parse(await readBody(request));
        } catch (error) {
          // An oversized body keeps its own 413/code; only a malformed one is 400.
          if (error instanceof AdminRequestError) throw error;
          sendJson(response, 400, {
            ok: false,
            error: { code: 'VALIDATION_ERROR', message: 'the request body is not JSON' },
          });
          return;
        }
        const ref = (body as { ref?: unknown }).ref;
        if (typeof ref !== 'string' || ref.length === 0) {
          sendJson(response, 422, {
            ok: false,
            error: { code: 'VALIDATION_ERROR', message: 'ref is required' },
          });
          return;
        }
        try {
          const deleted = secretRepository.delete(ref);
          secrets.remove(ref);
          sendJson(response, 200, { ok: true, ref, deleted });
        } catch (error) {
          sendJson(response, 422, {
            ok: false,
            error: {
              code:
                error instanceof Error && 'code' in error ? String(error.code) : 'SECRET_FAILED',
              message: error instanceof Error ? error.message : 'the secret could not be deleted',
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
  } catch (error) {
    // Any failure after the lock was taken must release it (W12T1-01/P3-P3): a failed
    // start may never leave a stale `daemon.lock` for the next `agentdev start` to take
    // over. `releaseDaemonLock` is epoch-checked, so a newer owner is untouched.
    releaseDaemonLock(home, lock.lock.epoch);
    throw error;
  }
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
