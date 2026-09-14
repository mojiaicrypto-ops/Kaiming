/**
 * Project runtime assembly (WP-11 A2 groundwork).
 *
 * `docs/architecture/ARCHITECTURE.md` §1 puts one `ProjectRuntime` per opened project
 * inside the daemon process, each with "SQLite、EventHub 和串行短命令 Mailbox", and §2
 * gives `apps/daemon` the job of assembling them. Until now that assembly only existed
 * inside `scripts/e2e.mjs` / `scripts/live.mjs`; this module is the production version,
 * so the runtime that `agentdev start` serves is the same set of real Components the
 * drills exercise.
 *
 * It opens exactly one project and wires the real services; orchestration (which
 * projects, which ports, the single-instance lock, the admin surface) is
 * `apps/daemon/src/main.ts`.
 */
import { join } from 'node:path';

import type { AuthService } from '@agentdev/core';
import {
  AttachmentService,
  ArtifactService,
  ConfigStore,
  DecisionService,
  DownloadTokenStore,
  EventHub,
  FindingService,
  PlanGateService,
  ProjectIntegrationLock,
  RequirementContinuation,
  SettlementService,
  SnapshotWriter,
  createRequirementSaveService,
  resolveProjectIdentity,
} from '@agentdev/core';
import type { RuntimeHost, TrustState } from '@agentdev/contracts';
import { BlobStore, ProjectStore } from '@agentdev/storage';
import {
  createCasService,
  createMemoryCasEvents,
  createMemoryCasJournal,
  createNodeWorktreeGitPort,
} from '@agentdev/workspace';
import { createWebApp, WebSessionStore, NodeFilePort, type WebApp } from '@agentdev/web';
import type { Server } from 'node:http';

import { createDaemon, type DaemonOptions } from './server.js';
import { WorkbenchProtocol } from './protocol.js';

/** Origin the BFF is served from by default (`protocol.md` §2). */
export const DEFAULT_WEB_ORIGIN = 'http://127.0.0.1:4317';

export interface OpenProjectOptions {
  /** Requested path; a subdirectory normalises to the repository root. */
  readonly root: string;
  readonly home: string;
  readonly auth: AuthService;
  /** Bearer the BFF presents to the daemon (the 0600 installation credential). */
  readonly installationToken: string;
  readonly version: string;
  /** Origins allowed to talk to the BFF; defaults to the loopback web origin. */
  readonly allowedOrigins?: readonly string[];
  readonly trust?: TrustState;
  /** 0 asks the OS for a free port, which is what tests use. */
  readonly daemonPort?: number;
  readonly webPort?: number;
  readonly host?: RuntimeHost;
  /** Disable the BFF (headless daemon, e.g. for the supervisor drills). */
  readonly withWeb?: boolean;
  readonly skillRoots?: readonly string[];
}

export interface OpenedProject {
  readonly projectId: string;
  readonly root: string;
  readonly gitRoot: string;
  readonly dataDir: string;
  readonly store: ProjectStore;
  readonly protocol: WorkbenchProtocol;
  readonly config: ConfigStore;
  readonly snapshots: SnapshotWriter;
  readonly daemon: Server;
  readonly web: WebApp | null;
  readonly ports: {
    readonly daemon: number;
    readonly web: number | null;
  };
  /** Stops both listeners; the store is closed by the caller. */
  close(): Promise<void>;
}

/** A project that cannot be opened, with the reason the CLI prints. */
export class ProjectOpenError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ProjectOpenError';
    this.code = code;
  }
}

async function listen(server: Server, port: number, host: string): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address !== 'object') {
    throw new ProjectOpenError('LISTEN_FAILED', 'the listener reported no address');
  }
  return address.port;
}

function portOf(server: Server): number {
  const address = server.address();
  return address !== null && typeof address === 'object' ? address.port : 0;
}

/**
 * Opens one project: database, migration, real services, protocol surface, daemon and
 * BFF. The caller owns the returned object and must `close()` it.
 */
export async function openProject(options: OpenProjectOptions): Promise<OpenedProject> {
  const host = options.host ?? '127.0.0.1';
  const allowedOrigins = options.allowedOrigins ?? [DEFAULT_WEB_ORIGIN];
  const withWeb = options.withWeb !== false;

  const identity = resolveProjectIdentity(options.root);
  if (!identity.gitRoot) {
    throw new ProjectOpenError(
      'NOT_A_REPOSITORY',
      `${options.root} is not inside a Git repository; AgentDev is Git-backed`,
    );
  }
  const dataDir = join(options.home, 'projects', identity.projectId);
  const gitPort = createNodeWorktreeGitPort();

  let store: ProjectStore;
  try {
    store = ProjectStore.open({
      dataDir,
      canonicalRoot: identity.canonicalRoot,
      migrations: { backup: () => undefined, backupPath: join(dataDir, 'pre.sqlite') },
      repository: { now: () => new Date().toISOString() },
    });
  } catch (error) {
    throw new ProjectOpenError(
      'STORE_OPEN_FAILED',
      `cannot open the project database at ${dataDir}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const blobs = new BlobStore({ root: dataDir });
  const existing = store.projects.find(identity.projectId);
  if (existing === undefined) {
    const head = gitPort.headRevision(identity.canonicalRoot);
    store.projects.insert({
      id: identity.projectId,
      root: identity.canonicalRoot,
      gitRoot: identity.gitRoot,
      codeRoot: 'src',
      documentRoot: 'docs/agentdev',
      deliveryBranch: 'agentdev/main',
      trust: options.trust ?? 'untrusted',
      state: 'open',
      ...(head.ok && head.value !== null ? { head: head.value } : {}),
    });
  } else if (existing.state === 'closed') {
    store.projects.update(existing.id, { state: 'open' }, existing.version);
  }

  const snapshots = new SnapshotWriter({ store });
  // `snapshots` must be wired before anything freezes a configuration (WP-11 A2-T6).
  const config = ConfigStore.open({ globalDir: options.home, projectRoot: dataDir, snapshots });
  const attachments = new AttachmentService({ store, blobs });
  const artifacts = new ArtifactService({ store, blobs });
  const tokens = new DownloadTokenStore();
  const events = new EventHub({ store });
  const gates = new PlanGateService({ store, artifacts, blobs });
  const findings = new FindingService({ store, artifacts });
  const decisions = new DecisionService({ store, artifacts });
  const requirements = new RequirementContinuation({ store });
  const journal = createMemoryCasJournal();
  const casEvents = createMemoryCasEvents();
  const cas = createCasService({ git: gitPort, journal, events: casEvents });
  const lock = new ProjectIntegrationLock({ projectId: identity.projectId, leases: store.leases });
  // Settlement is part of the protocol surface's real services; it is constructed here
  // so a later stage (the supervisor) can settle through the same instance.
  new SettlementService({
    store,
    worktrees: gitPort,
    cas,
    journal,
    events: casEvents,
    snapshots,
  });
  const requirementSaves = createRequirementSaveService({
    store,
    worktrees: gitPort,
    journal,
    events: casEvents,
    cas,
    lock,
    worktreeRoot: join(dataDir, 'save-worktrees'),
    keepWorktree: false,
  });

  const protocol = new WorkbenchProtocol({
    store,
    blobs,
    events,
    attachments,
    artifacts,
    tokens,
    version: options.version,
    config,
    gates,
    decisions,
    findings,
    requirements,
    requirementSaves,
  });

  const daemonOptions: DaemonOptions = {
    projectId: identity.projectId,
    store,
    blobs,
    auth: options.auth,
    attachments,
    artifacts,
    tokens,
    version: options.version,
    role: 'chief',
    workbench: protocol,
  };
  const daemon = createDaemon(daemonOptions);
  const daemonPort = await listen(daemon, options.daemonPort ?? 0, host);

  let web: WebApp | null = null;
  let webPort: number | null = null;
  if (withWeb) {
    web = createWebApp({
      daemon: {
        baseUrl: `http://${host}:${String(daemonPort)}`,
        origin: allowedOrigins[0] ?? DEFAULT_WEB_ORIGIN,
        bearer: options.installationToken,
      },
      auth: options.auth,
      allowedOrigins: [...allowedOrigins],
      sessions: new WebSessionStore(),
      files: new NodeFilePort(),
      version: options.version,
    });
    webPort = await listen(web.server, options.webPort ?? 0, host);
  }

  return {
    projectId: identity.projectId,
    root: identity.canonicalRoot,
    gitRoot: identity.gitRoot,
    dataDir,
    store,
    protocol,
    config,
    snapshots,
    daemon,
    web,
    ports: { daemon: daemonPort, web: webPort },
    close: async () => {
      await Promise.all([
        new Promise<void>((resolve) => daemon.close(() => resolve())),
        web === null
          ? Promise.resolve()
          : new Promise<void>((resolve) => web.server.close(() => resolve())),
      ]);
      store.close();
    },
  };
}

/** Exposed for the host's `status` read: the port a listener actually bound. */
export { portOf };
