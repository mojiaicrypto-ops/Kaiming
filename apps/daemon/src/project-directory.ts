/**
 * The installation's project directory: registry, lifecycle and per-root locks
 * (WP-12 T5, `docs/architecture/ARCHITECTURE.md` §4/§5, `reliability.md` §7).
 *
 * One installation runs several projects; this module is the single owner of which
 * roots are served, which are merely registered, and what each project's real state
 * is. It implements the port the BFF routes through (`@agentdev/web` `projects.ts`)
 * so the switching model stays **one BFF, one origin, route per request by
 * `projectId`**, and it is the only writer of the registry, the per-root locks and the
 * in-process instance table.
 *
 * Binding rulings realised here (WP-12 T5 §15):
 *
 * - **Q1** `project.create`'s `name` is persisted in the registry entry;
 * - **Q2** a damaged registry entry is skipped and reported, never fatal;
 * - **Q3** `project.close` is navigation-level and refuses while a live Run exists;
 * - **Q4** `project.clone` consumes an explicit installation-level once-Grant;
 * - **Q5** the per-Git-root lock lives under `~/.agentdev/locks/<hash>.lock`;
 * - **Q8** the initialize mode is derived from the real root state;
 * - **Q9** `project.created` goes into the new project's own event stream.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join, resolve } from 'node:path';

import type { JsonObject, RuntimeHost, RuntimeInstance } from '@agentdev/contracts';
import {
  acquireProjectRootLock,
  consumeInstallationGrant,
  installationGrantInputHash,
  mintInstallationGrant,
  readProjectRegistryReport,
  registerProject,
  releaseProjectRootLock,
  resolveProjectIdentity,
  type ProjectRegistryProblem,
} from '@agentdev/core';
import { ProjectStore } from '@agentdev/storage';
import { createNodeWorktreeGitPort } from '@agentdev/workspace';
import {
  projectNameOf,
  type ProjectCommandResult,
  type ProjectDirectoryPort,
  type ProjectEntry,
  type ProjectTarget,
} from '@agentdev/web';

import {
  InitializeRefused,
  investigateProject,
  runInitialize,
  type InitializeBudget,
  type InitializationEvent,
} from './initialize-driver.js';
import {
  importRequirementsFromDelivery,
  type RequirementImportResult,
} from './requirement-import.js';
import type { WorkbenchProtocol } from './protocol.js';

/** The origin the single BFF is served from; every daemon allowlists exactly this. */
export const SINGLE_WEB_ORIGIN = 'http://127.0.0.1:4317';

/** A lifecycle refusal the protocol/CLI/admin surface reports as a typed error. */
export class ProjectDirectoryError extends Error {
  readonly code: string;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: string, message: string, details: Readonly<Record<string, unknown>> = {}) {
    super(message);
    this.name = 'ProjectDirectoryError';
    this.code = code;
    this.details = details;
  }
}

/** One assembled project runtime, as `main.ts` built it. */
export interface AssembledProject {
  readonly projectId: string;
  readonly root: string;
  readonly gitRoot: string;
  readonly dataDir: string;
  readonly instance: RuntimeInstance;
  readonly store: ProjectStore;
  readonly protocol: WorkbenchProtocol;
  readonly deliveryBranch: string;
  readonly documentRoot: string;
}

/** The unresolved initialization blocker a project currently reports. */
export interface ProjectInitializationFact {
  readonly operationId: string;
  readonly phase: string;
  readonly status: string;
  readonly done: boolean;
  readonly blockerKind: string | null;
  readonly blockerMessage: string | null;
  /** Repo-relative paths of a dirty-workspace hash report (AC-028). */
  readonly dirtyPaths: readonly { readonly path: string; readonly sha256: string | null }[];
  /** Candidate documents written in this record. */
  readonly written: number;
  /** Candidate documents whose bytes already matched (hash-based resume, AC-029). */
  readonly unchanged: number;
}

/** The summary of the first-open requirement import (AC-087–AC-089). */
export interface ProjectImportFact {
  readonly revision: string | null;
  readonly source: string;
  readonly imported: number;
  readonly conflicts: number;
  readonly writeBlocked: boolean;
}

interface DirectoryHandle {
  readonly assembled: AssembledProject;
  readonly root: string;
  readonly projectId: string;
  trust: 'trusted' | 'untrusted';
  name: string;
  initialization: ProjectInitializationFact | null;
  importFact: ProjectImportFact | null;
}

export interface ProjectDirectoryOptions {
  readonly home: string;
  readonly host: RuntimeHost;
  readonly version: string;
  /** The 0600 installation credential the BFF presents. */
  readonly bearer: () => string;
  /** The daemon epoch, used to fence the per-root lock records. */
  readonly epoch: () => number;
  /** Assembles one project's runtime stack; the host supplies the real one. */
  readonly assemble: (input: {
    readonly root: string;
    readonly trust: 'trusted' | 'untrusted';
    readonly name: string | undefined;
  }) => Promise<AssembledProject>;
  /** Stops one project's listeners and execution stack (`project.close`, Q3). */
  readonly teardown: (projectId: string) => Promise<void>;
  /** Live (non-terminal) Runs of one open project; drives the close refusal (Q3). */
  readonly runningRuns: (projectId: string) => number;
  /** Whether the chief role configuration resolves for one open project. */
  readonly executionReady: (projectId: string) => boolean;
  readonly webOrigin?: string;
  readonly now?: () => Date;
  readonly log?: (line: string) => void;
}

/**
 * The host-side project directory.
 *
 * Reads are synchronous because the protocol's dispatch is (`protocol.md` §1: every
 * documented method answers with a single terminal response; the long lifecycle
 * commands answer `accepted` and finish in the background). Writes that assemble a
 * runtime return a Promise the caller may await — the protocol handler attaches to
 * it and answers `accepted` immediately.
 */
export class ProjectDirectory implements ProjectDirectoryPort {
  private readonly handles = new Map<string, DirectoryHandle>();
  /**
   * Opens in flight, keyed by project id.
   *
   * Two concurrent `project.open` calls for one root must assemble exactly one
   * runtime: the per-root lock is process-wide, so without this map the second caller
   * would see the first one's lock (same pid, still alive) and be refused as
   * `PROJECT_ALREADY_OPEN`. The second caller therefore awaits the same promise.
   */
  private readonly inFlight = new Map<string, Promise<ProjectEntry>>();
  /** Trust of a project whose store is not open right now; read once, then cached. */
  private readonly closedTrust = new Map<string, 'trusted' | 'untrusted'>();
  private readonly options: ProjectDirectoryOptions;

  constructor(options: ProjectDirectoryOptions) {
    this.options = options;
  }

  /** Registry entries this installation refused at load (Q2), reported, never fatal. */
  get problems(): readonly ProjectRegistryProblem[] {
    return readProjectRegistryReport(this.options.home).problems;
  }

  /** The directory's own view of one open project, for the host's own wiring. */
  handleOf(projectId: string): DirectoryHandle | undefined {
    return this.handles.get(projectId);
  }

  /** Every open project id, in insertion order. */
  openProjectIds(): readonly string[] {
    return [...this.handles.keys()];
  }

  /**
   * Releases every open project's per-Git-root lock and forgets the in-process table.
   *
   * `agentdev stop` is a real stop: the daemon's own shutdown must not leave lock
   * files behind, or the next start in the same process (a test suite, a supervisor
   * restart, `restart` in a wrapper) would be refused as `PROJECT_ALREADY_OPEN` by its
   * own predecessor. Releasing is epoch-checked, so a newer owner is never disturbed.
   */
  deactivateAll(): void {
    for (const handle of this.handles.values()) {
      releaseProjectRootLock(this.options.home, handle.root, this.options.epoch());
    }
    this.handles.clear();
  }

  // -------------------------------------------------------------------------
  // Routing
  // -------------------------------------------------------------------------

  list(): readonly ProjectEntry[] {
    const { registry, problems } = readProjectRegistryReport(this.options.home);
    const entries: ProjectEntry[] = [];
    for (const entry of registry.projects) {
      const handle = this.handles.get(entry.projectId);
      if (handle !== undefined) {
        entries.push(this.entryFromHandle(handle));
        continue;
      }
      if (!existsSync(entry.root)) {
        entries.push(
          this.closedEntry(
            entry.root,
            entry.projectId,
            entry.name,
            'missing',
            {
              code: 'NOT_FOUND',
              message: `project root ${entry.root} does not exist`,
            },
            entry.lastOpenedAt,
          ),
        );
        continue;
      }
      entries.push(
        this.closedEntry(
          entry.root,
          entry.projectId,
          entry.name,
          'closed',
          null,
          entry.lastOpenedAt,
        ),
      );
    }
    for (const problem of problems) {
      entries.push({
        projectId: null,
        name: problem.root ?? `registry entry #${String(problem.index)}`,
        root: problem.root ?? '',
        trust: 'untrusted',
        state: 'unreadable',
        updatedAt: '',
        runningRuns: 0,
        executionReady: false,
        gitRoot: null,
        head: null,
        problem: { code: problem.code, message: problem.message },
        initialization: null,
        import: null,
      });
    }
    return entries;
  }

  entryOf(projectId: string): ProjectEntry | undefined {
    const handle = this.handles.get(projectId);
    if (handle !== undefined) return this.entryFromHandle(handle);
    const entry = readProjectRegistryReport(this.options.home).registry.projects.find(
      (candidate) => candidate.projectId === projectId,
    );
    if (entry === undefined) return undefined;
    return this.list().find((candidate) => candidate.projectId === projectId);
  }

  findByRoot(root: string): ProjectEntry | undefined {
    const requested = safeCanonical(root);
    const entry = readProjectRegistryReport(this.options.home).registry.projects.find(
      (candidate) => candidate.root === requested || candidate.root === resolve(root),
    );
    return entry === undefined ? undefined : this.entryOf(entry.projectId);
  }

  targetOf(projectId: string): ProjectTarget | undefined {
    const handle = this.handles.get(projectId);
    if (handle === undefined) return undefined;
    const { host } = this.options;
    return {
      baseUrl: `http://${host}:${String(handle.assembled.instance.daemon.port)}`,
      origin: this.options.webOrigin ?? SINGLE_WEB_ORIGIN,
      bearer: this.options.bearer(),
    };
  }

  defaultProjectId(): string | undefined {
    const first = this.openProjectIds()[0];
    if (first !== undefined) return first;
    return readProjectRegistryReport(this.options.home).registry.projects[0]?.projectId;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /** The project id a root resolves to, without opening anything (AC-024). */
  projectIdFor(root: string): string {
    return resolveProjectIdentity(root).projectId;
  }

  async open(
    root: string,
    options: { readonly trust?: boolean; readonly name?: string } = {},
  ): Promise<ProjectEntry> {
    const identity = resolveProjectIdentity(root);
    if (identity.gitRoot === undefined) {
      throw new ProjectDirectoryError(
        'NOT_A_REPOSITORY',
        `${identity.canonicalRoot} is not inside a Git repository; AgentDev is Git-backed`,
        { root: identity.canonicalRoot },
      );
    }
    const existing = this.handles.get(identity.projectId);
    if (existing !== undefined) {
      // `protocol.md` §3: opening an already-open project is idempotent and refreshes
      // the navigation timestamp (and the explicit name, when one is supplied).
      registerProject(this.options.home, {
        root: existing.root,
        projectId: existing.projectId,
        at: this.timestamp(),
        ...(options.name === undefined ? {} : { name: options.name }),
      });
      if (options.name !== undefined) existing.name = options.name;
      return this.entryFromHandle(existing);
    }
    const pending = this.inFlight.get(identity.projectId);
    if (pending !== undefined) return pending;
    const promise = this.assembleOpen(identity, options);
    this.inFlight.set(identity.projectId, promise);
    try {
      return await promise;
    } finally {
      this.inFlight.delete(identity.projectId);
    }
  }

  /** Assembles one not-yet-open project under its per-root lock. */
  private async assembleOpen(
    identity: ReturnType<typeof resolveProjectIdentity>,
    options: { readonly trust?: boolean; readonly name?: string },
  ): Promise<ProjectEntry> {
    const lock = acquireProjectRootLock(this.options.home, identity.canonicalRoot, {
      pid: process.pid,
      epoch: this.options.epoch(),
      ...(this.options.now === undefined ? {} : { now: this.options.now }),
    });
    if (!lock.acquired) {
      throw new ProjectDirectoryError('PROJECT_ALREADY_OPEN', lock.message, {
        root: identity.canonicalRoot,
        holder: lock.holder ?? null,
      });
    }
    let assembled: AssembledProject;
    try {
      assembled = await this.options.assemble({
        root: identity.canonicalRoot,
        trust: options.trust === false ? 'untrusted' : 'trusted',
        name: options.name,
      });
    } catch (error) {
      releaseProjectRootLock(this.options.home, identity.canonicalRoot, lock.lock.epoch);
      throw error;
    }
    const handle: DirectoryHandle = {
      assembled,
      root: assembled.root,
      projectId: assembled.projectId,
      trust: assembled.store.projects.find(assembled.projectId)?.trust ?? 'untrusted',
      name: projectNameOf(assembled.root, options.name),
      initialization: null,
      importFact: null,
    };
    this.handles.set(assembled.projectId, handle);
    registerProject(this.options.home, {
      root: assembled.root,
      projectId: assembled.projectId,
      at: this.timestamp(),
      ...(options.name === undefined ? {} : { name: options.name }),
    });
    // `protocol.md` §8: a new project's first open starts the known-directory
    // requirement import, needs no Provider, and never starts a Run (AC-087–089).
    this.runFirstOpenImport(handle);
    this.options.log?.(
      `agentdevd: opened ${assembled.root} (project ${assembled.projectId}) daemon=${String(assembled.instance.daemon.port)}`,
    );
    return this.entryFromHandle(handle);
  }

  /**
   * Creates a project in an **empty** directory (`protocol.md` §3, AC-025).
   *
   * The mode is derived from the real root state (Q8): an empty, non-Git directory is
   * initialized with an initial commit and the `agentdev/main` delivery branch, and
   * the create act itself is the explicit authorization for that Git initialization.
   * A non-empty directory is refused with the observed facts — `ARCHITECTURE.md` §52
   * forbids automatic cleanup, so replacing content is never implicit.
   */
  async create(root: string, name: string): Promise<ProjectEntry> {
    const requested = resolve(root);
    if (!existsSync(requested) || !statSync(requested).isDirectory()) {
      throw new ProjectDirectoryError(
        'INVALID_STATE',
        `${requested} is not an existing directory`,
        {
          root: requested,
        },
      );
    }
    const entries = readdirSync(requested);
    if (entries.length > 0) {
      throw new ProjectDirectoryError(
        'INVALID_STATE',
        `${requested} is not empty (${String(entries.length)} entries); project.create only initializes an empty directory`,
        { root: requested, entryCount: entries.length },
      );
    }
    const identity = resolveProjectIdentity(requested);
    const dataDir = join(this.options.home, 'projects', identity.projectId);
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    const operationId = newOperationId('create');
    const result = runInitialize(
      {
        dataDir,
        documentRoot: 'docs/agentdev',
        branch: 'agentdev/main',
        ...(this.options.now === undefined ? {} : { now: () => this.timestamp() }),
      },
      {
        operationId,
        root: identity.canonicalRoot,
        sourceMessageId: operationId,
        mode: 'new',
        authorizeGitInit: true,
        confirmObservedFacts: true,
        authorizationRef: `project.create:${operationId}`,
      },
    );
    if (!result.done) {
      const code = result.blocker === null ? 'INITIALIZE_FAILED' : 'INITIALIZE_BLOCKED';
      throw new ProjectDirectoryError(code, `project.create did not reach Ready: ${operationId}`, {
        root: identity.canonicalRoot,
        operationId,
        phase: result.phase,
        blocker: result.blocker,
        failure: result.failure,
      });
    }
    const entry = await this.open(identity.canonicalRoot, { trust: true, name });
    const handle = this.handles.get(identity.projectId);
    if (handle !== undefined) {
      handle.initialization = this.initializationFact(handle, result.record);
      // Q9: `project.created` is emitted into the **new project's own** stream once it
      // exists — never into an installation-level stream, which does not exist.
      this.appendEvent(handle, 'project.created', 1, {
        projectId: handle.projectId,
        root: handle.root,
        name: handle.name,
        trust: handle.trust,
        source: 'create',
      });
    }
    return entry;
  }

  /**
   * Clones a remote into a new root (`protocol.md` §3, Q4).
   *
   * `grantId` must name an installation-level `once` Grant bound to this operation,
   * the destination root and the remote URL. The grant's `consumedAt` is written
   * before `git` runs, so a crash cannot leave a reusable authority behind.
   */
  async clone(remoteUrl: string, root: string, grantId: string): Promise<ProjectEntry> {
    const destination = resolve(root);
    if (existsSync(destination) && readdirSync(destination).length > 0) {
      throw new ProjectDirectoryError(
        'INVALID_STATE',
        `${destination} already exists and is not empty`,
        { root: destination },
      );
    }
    if (grantId.trim() === '') {
      throw new ProjectDirectoryError(
        'NOT_AUTHORIZED',
        'project.clone requires an installation-level Grant id (Q4)',
        { root: destination, remoteUrl },
      );
    }
    const operation = 'project.clone';
    const targets = [destination, remoteUrl];
    const consumed = consumeInstallationGrant(this.options.home, {
      id: grantId,
      operation,
      targets,
      inputHash: installationGrantInputHash({ operation, targets }),
      byOperationId: newOperationId('clone'),
      ...(this.options.now === undefined ? {} : { now: this.options.now }),
    });
    if (!consumed.ok) {
      throw new ProjectDirectoryError(consumed.code, consumed.message, {
        grantId,
        root: destination,
        remoteUrl,
      });
    }
    try {
      execFileSync('git', ['clone', '--no-tags', '--', remoteUrl, destination], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
        timeout: 300_000,
      });
    } catch (error) {
      throw new ProjectDirectoryError(
        'CLONE_FAILED',
        `git clone ${remoteUrl} → ${destination} failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { root: destination, remoteUrl },
      );
    }
    const entry = await this.open(destination, { trust: true });
    const identity = resolveProjectIdentity(destination);
    const handle = this.handles.get(identity.projectId);
    if (handle !== undefined) {
      this.appendEvent(handle, 'project.created', 1, {
        projectId: handle.projectId,
        root: handle.root,
        name: handle.name,
        trust: handle.trust,
        source: 'clone',
        remoteUrl,
      });
    }
    return entry;
  }

  /** Mints the installation-level once-Grant a later `project.clone` consumes (Q4). */
  grantClone(input: {
    readonly remoteUrl: string;
    readonly root: string;
    readonly ttlMs?: number;
  }): { readonly grantId: string; readonly expiresAt: string } {
    const operation = 'project.clone';
    const targets = [resolve(input.root), input.remoteUrl];
    const grant = mintInstallationGrant(this.options.home, {
      id: newOperationId('grant'),
      operation,
      targets,
      inputHash: installationGrantInputHash({ operation, targets }),
      ...(input.ttlMs === undefined ? {} : { ttlMs: input.ttlMs }),
      ...(this.options.now === undefined ? {} : { now: this.options.now }),
    });
    return { grantId: grant.id, expiresAt: grant.expiresAt };
  }

  trust(projectId: string, trusted: boolean): ProjectEntry {
    const handle = this.handles.get(projectId);
    const next: 'trusted' | 'untrusted' = trusted ? 'trusted' : 'untrusted';
    if (handle !== undefined) {
      const row = handle.assembled.store.projects.find(projectId);
      if (row === undefined) {
        throw new ProjectDirectoryError('NOT_FOUND', `Project ${projectId} is not registered`, {
          projectId,
        });
      }
      handle.assembled.store.projects.update(projectId, { trust: next }, row.version);
      handle.trust = next;
      return this.entryFromHandle(handle);
    }
    const store = this.closedStore(projectId);
    try {
      const row = store.projects.find(projectId);
      if (row === undefined) {
        throw new ProjectDirectoryError('NOT_FOUND', `Project ${projectId} is not registered`, {
          projectId,
        });
      }
      store.projects.update(projectId, { trust: next }, row.version);
    } finally {
      store.close();
    }
    this.closedTrust.set(projectId, next);
    const entry = this.entryOf(projectId);
    if (entry === undefined) {
      throw new ProjectDirectoryError('NOT_FOUND', `Project ${projectId} is not registered`, {
        projectId,
      });
    }
    return entry;
  }

  /**
   * Navigation-level close (Q3).
   *
   * The durable `projects.state` becomes `closed` and the project leaves the active
   * set, so the switcher no longer offers it; its registry entry, database and Git
   * working tree stay untouched. A live Run refuses the close with `INVALID_STATE`
   * instead of implicitly stopping the background work — stopping processes is
   * `agentdev stop`'s job.
   */
  close(projectId: string): ProjectEntry {
    const handle = this.handles.get(projectId);
    if (handle === undefined) {
      const entry = this.entryOf(projectId);
      if (entry === undefined) {
        throw new ProjectDirectoryError('NOT_FOUND', `Project ${projectId} is not registered`, {
          projectId,
        });
      }
      return entry;
    }
    const live = this.options.runningRuns(projectId);
    if (live > 0) {
      throw new ProjectDirectoryError(
        'INVALID_STATE',
        `Project ${projectId} has ${String(live)} live Run(s); project.close only removes navigation`,
        { projectId, runningRuns: live },
      );
    }
    const row = handle.assembled.store.projects.find(projectId);
    if (row !== undefined) {
      handle.assembled.store.projects.update(projectId, { state: 'closed' }, row.version);
    }
    this.handles.delete(projectId);
    releaseProjectRootLock(this.options.home, handle.root, this.options.epoch());
    // Listeners/databases close right after the answer; navigation has already moved.
    void this.options.teardown(projectId).catch((error: unknown) => {
      this.options.log?.(
        `agentdevd: closing ${projectId} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
    return {
      projectId,
      name: handle.name,
      root: handle.root,
      trust: handle.trust,
      state: 'closed',
      updatedAt: row?.updatedAt ?? this.timestamp(),
      runningRuns: 0,
      executionReady: false,
      gitRoot: handle.assembled.gitRoot,
      head: row?.head ?? null,
      problem: null,
      initialization: handle.initialization,
      import: handle.importFact,
    };
  }

  /**
   * Drives `project.initialize` for an open project (`protocol.md` §3, T5.3).
   *
   * The mode is derived from the real root state (Q8); `budget.files/bytes` map onto
   * the scanner's documented budget; every phase emits `initialization.progress` and
   * Ready emits `initialization.completed` **into this project's own stream** (Q9).
   */
  initialize(
    projectId: string,
    input: {
      readonly sourceMessageId: string;
      readonly mode?: 'new' | 'legacy';
      readonly budget?: InitializeBudget;
    },
  ): Promise<ProjectEntry> {
    const handle = this.handles.get(projectId);
    if (handle === undefined) {
      // A rejected promise, not a synchronous throw: the caller attaches a `.catch`
      // to report `operation.failed` after the `accepted` answer.
      return Promise.reject(
        new ProjectDirectoryError(
          'INVALID_STATE',
          `Project ${projectId} is not open; open it before initializing`,
          { projectId },
        ),
      );
    }
    const operationId = newOperationId('init');
    let result;
    try {
      result = runInitialize(
        {
          dataDir: handle.assembled.dataDir,
          documentRoot: handle.assembled.documentRoot,
          branch: handle.assembled.deliveryBranch,
          ...(input.budget === undefined ? {} : { budget: input.budget }),
          emit: (event) => this.forwardInitializationEvent(handle, event),
          ...(this.options.now === undefined ? {} : { now: () => this.timestamp() }),
        },
        {
          operationId,
          root: handle.root,
          sourceMessageId: input.sourceMessageId,
          ...(input.mode === undefined ? {} : { mode: input.mode }),
          ...(input.budget === undefined ? {} : { budget: input.budget }),
          // Q8: `mode:'new'` is the explicit initializing act, so it may authorize
          // `git init`; an implicit/`legacy` initialize must surface the request instead.
          authorizeGitInit: input.mode === 'new',
          // The command itself is the authenticated user action (`protocol.md` §8).
          confirmObservedFacts: true,
          authorizationRef: `project.initialize:${input.sourceMessageId}`,
        },
      );
    } catch (error) {
      // A refusal (an existing repository with `mode:'new'`, a contradictory hint) is a
      // rejected promise, never a synchronous throw: the protocol's caller attaches
      // `.catch` to report `operation.failed` after its `accepted` answer.
      return Promise.reject(
        error instanceof Error
          ? error
          : new ProjectDirectoryError('INVALID_STATE', String(error), { projectId }),
      );
    }
    handle.initialization = this.initializationFact(handle, result.record);
    // The drive itself is synchronous (real files, real Git, real state file); the
    // Promise only matches the port's shape so the protocol can answer `accepted`.
    const pending = this.entryFromHandle(handle);
    return Promise.resolve(pending);
  }

  /** Read-only investigation of one project; never writes (`ARCHITECTURE.md` §4). */
  investigate(projectId: string, budget?: InitializeBudget): unknown {
    const handle = this.handles.get(projectId);
    if (handle === undefined) {
      throw new ProjectDirectoryError(
        'INVALID_STATE',
        `Project ${projectId} is not open; open it before investigating`,
        { projectId },
      );
    }
    return investigateProject({
      root: handle.root,
      documentRoot: handle.assembled.documentRoot,
      ...(budget === undefined ? {} : { budget }),
    });
  }

  /** Opens a registry entry's store for a non-servable (closed) project. */
  private closedStore(projectId: string): ProjectStore {
    const entry = readProjectRegistryReport(this.options.home).registry.projects.find(
      (candidate) => candidate.projectId === projectId,
    );
    if (entry === undefined) {
      throw new ProjectDirectoryError('NOT_FOUND', `Project ${projectId} is not registered`, {
        projectId,
      });
    }
    const dataDir = join(this.options.home, 'projects', projectId);
    return ProjectStore.open({
      dataDir,
      canonicalRoot: entry.root,
      migrations: { backup: () => undefined, backupPath: join(dataDir, 'pre.sqlite') },
      repository: { now: () => this.timestamp() },
    });
  }

  private entryFromHandle(handle: DirectoryHandle): ProjectEntry {
    const row = handle.assembled.store.projects.find(handle.projectId);
    return {
      projectId: handle.projectId,
      name: projectNameOf(handle.root, handle.name),
      root: handle.root,
      trust: handle.trust,
      state: 'open',
      updatedAt: row?.updatedAt ?? this.timestamp(),
      runningRuns: this.options.runningRuns(handle.projectId),
      executionReady: this.options.executionReady(handle.projectId),
      gitRoot: handle.assembled.gitRoot,
      head: row?.head ?? handle.assembled.store.projects.find(handle.projectId)?.head ?? null,
      problem: null,
      initialization: handle.initialization,
      import: handle.importFact,
    };
  }

  private closedEntry(
    root: string,
    projectId: string,
    name: string | undefined,
    state: 'closed' | 'missing',
    problem: { readonly code: string; readonly message: string } | null,
    updatedAt: string,
  ): ProjectEntry {
    const cached = this.closedTrust.get(projectId);
    let trust: 'trusted' | 'untrusted' = cached ?? 'untrusted';
    if (cached === undefined && state === 'closed') {
      try {
        const store = this.closedStore(projectId);
        try {
          trust = store.projects.find(projectId)?.trust ?? 'untrusted';
        } finally {
          store.close();
        }
        this.closedTrust.set(projectId, trust);
      } catch {
        // A store that cannot be opened is reported through `executionReady:false`
        // rather than by inventing a trust value.
        trust = 'untrusted';
      }
    }
    return {
      projectId,
      name: projectNameOf(root, name),
      root,
      trust,
      state,
      updatedAt,
      runningRuns: 0,
      executionReady: false,
      gitRoot: null,
      head: null,
      problem,
      initialization: null,
      import: null,
    };
  }

  private runFirstOpenImport(handle: DirectoryHandle): void {
    try {
      const result: RequirementImportResult = importRequirementsFromDelivery({
        store: handle.assembled.store,
        repoRoot: handle.assembled.gitRoot,
        git: createNodeWorktreeGitPort(),
        branch: handle.assembled.deliveryBranch,
      });
      handle.importFact = {
        revision: result.revision,
        source: result.source,
        imported: result.imported.length,
        conflicts: result.conflicts.length,
        writeBlocked: result.writeBlocked,
      };
      this.options.log?.(
        `agentdevd: requirement import for ${handle.projectId} read ${result.revision ?? 'nothing'} (${result.source}): ${String(result.imported.length)} imported, ${String(result.conflicts.length)} conflicted`,
      );
    } catch (error) {
      // The import is a convenience over a real Git read; a failure must not make the
      // project unopenable, but it must be visible rather than silently absent.
      handle.importFact = {
        revision: null,
        source: 'error',
        imported: 0,
        conflicts: 0,
        writeBlocked: false,
      };
      this.options.log?.(
        `agentdevd: requirement import for ${handle.projectId} failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private forwardInitializationEvent(handle: DirectoryHandle, event: InitializationEvent): void {
    this.appendEvent(handle, event.name, 1, event.data);
  }

  private appendEvent(
    handle: DirectoryHandle,
    name: string,
    entityVersion: number,
    data: JsonObject,
  ): void {
    handle.assembled.store.events.append({
      name,
      entityId: handle.projectId,
      entityVersion,
      data,
    });
  }

  private initializationFact(
    handle: DirectoryHandle,
    record: {
      readonly id: string;
      readonly phase: string;
      readonly status: string;
      readonly blocked: unknown;
      readonly writes?: readonly { readonly state: string }[];
    } | null,
  ): ProjectInitializationFact | null {
    if (record === null) return null;
    const blocked = record.blocked as {
      readonly kind?: string;
      readonly message?: string;
      readonly hashReport?: readonly { readonly path: string; readonly sha256: string | null }[];
    } | null;
    const writes = record.writes ?? [];
    return {
      operationId: record.id,
      phase: record.phase,
      status: record.status,
      done: record.status === 'ready',
      blockerKind: blocked?.kind ?? null,
      blockerMessage: blocked?.message ?? null,
      dirtyPaths: (blocked?.hashReport ?? []).map((entry) => ({
        path: entry.path,
        sha256: entry.sha256,
      })),
      written: writes.filter((write) => write.state === 'written').length,
      unchanged: writes.filter((write) => write.state === 'unchanged').length,
    };
  }

  private timestamp(): string {
    return (this.options.now ?? (() => new Date()))().toISOString();
  }
}

/** A random operation id; the durable record is keyed by it, so it must be unique. */
function newOperationId(prefix: string): string {
  return `${prefix}-${randomBytes(8).toString('hex')}`;
}

/** `realpath` without throwing, for a root that may have disappeared. */
function safeCanonical(root: string): string {
  try {
    return resolveProjectIdentity(root).canonicalRoot;
  } catch {
    return resolve(root);
  }
}

export type { ProjectCommandResult, ProjectEntry, ProjectTarget };
export { InitializeRefused };
