/**
 * The web BFF: sessions, Origin checks, the `/rpc` and `/ws` proxies, artifact
 * pass-through and the nine server-rendered pages.
 *
 * `docs/architecture/ARCHITECTURE.md` §2 and `protocol.md` §2 fix the split: the
 * BFF listens on loopback, holds the daemon credential and the daemon session, and
 * exposes an `HttpOnly` cookie to the browser. Consequently:
 *
 * - every page and API call is authenticated against the BFF's own session store;
 * - every state-changing call is also Origin-checked and re-validated against the
 *   daemon session, so an expired cookie or a wrong Origin is refused at the server
 *   while the background Work keeps running (AC-078);
 * - the pages read the real protocol only. There is no fixture in this module: a
 *   missing daemon answer renders an honest failure, never invented data.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AuthService } from '@agentdev/core';
import type { JsonObject } from '@agentdev/contracts';
import {
  BrowserSocket,
  daemonLogin,
  daemonLogout,
  daemonPreview,
  daemonRead,
  forwardRpc,
  handleUpgrade,
  type DaemonTarget,
  type PreviewRead,
} from './daemon.js';
import { FileBoundaryError, NodeFilePort, type FilePort } from './files.js';
import { escapeHtml, renderDocument } from './html.js';
import { normaliseLanguage, translator } from './i18n.js';
import { PickerRefused, type FolderPickerPort, type PickerListing } from './picker.js';
import type { ProjectDirectoryPort, ProjectEntry } from './projects.js';
import {
  renderAgentsPage,
  renderBoardPage,
  renderChiefPage,
  renderDocsPage,
  renderFilesPage,
  renderInboxPage,
  renderProjectsPage,
  renderRequirementPage,
  renderRunsPage,
  renderSettingsPage,
} from './pages.js';
import {
  DEFAULT_PANEL_MODE,
  isPanelMode,
  renderShell,
  type PageKey,
  type PanelMode,
  type ShellState,
} from './shell.js';
import {
  WebSessionStore,
  authenticateDaemon,
  cookieValue,
  originAllowed,
  sessionClearCookie,
  sessionSetCookie,
  type WebSession,
} from './sessions.js';
import {
  agentsModel,
  boardModel,
  chiefModel,
  filesModel,
  inboxModel,
  questionKey,
  requirementDetail,
  runDetail,
  runsModel,
  settingsModel,
  type InboxContext,
  type InboxQuestion,
  type InboxWaitingRun,
} from './views.js';

/** The BFF's configuration: where the daemon is, who may talk to the BFF, and how. */
export interface WebAppOptions {
  /**
   * The target a single-project installation serves, and the fallback for the
   * installation-level methods under `projects` (WP-12 T5).
   */
  readonly daemon: DaemonTarget;
  readonly auth: AuthService;
  /** Exact origins a browser write may come from; defaults to the daemon origin. */
  readonly allowedOrigins?: readonly string[];
  readonly sessions?: WebSessionStore;
  readonly files?: FilePort;
  readonly version?: string;
  readonly publicDir?: string;
  /**
   * The installation's project directory (WP-12 T5).
   *
   * With it the BFF is the **single entry point** for every project: each request is
   * routed to the daemon that serves the `projectId` it names (page path, envelope,
   * `/ws?projectId=` or artifact URL), and a request naming a project this
   * installation does not serve fails closed (`NOT_FOUND`) instead of silently
   * answering from another project. Without it the BFF keeps its original
   * single-project behaviour.
   */
  readonly projects?: ProjectDirectoryPort;
  /**
   * The **human-only** folder picker behind "open a folder" (WP-12 project UX).
   *
   * It is a BFF read surface, never a protocol method or a tool: the `/picker/list`
   * GET route below is the only caller, and no daemon method or Runner tool reaches
   * it (`apps/web/src/picker.ts` states the full safety argument). Absent means the
   * route answers `NOT_FOUND`, which is what every test double and single-project
   * stack gets.
   */
  readonly picker?: FolderPickerPort;
  /** Overridable for tests; all four default to the real daemon transport. */
  readonly rpc?: typeof forwardRpc;
  readonly read?: typeof daemonRead;
  readonly login?: typeof daemonLogin;
  readonly logout?: typeof daemonLogout;
  /** Reads one Artifact body; overridable so a page test needs no daemon. */
  readonly preview?: typeof daemonPreview;
}

export interface WebApp {
  readonly server: Server;
  readonly sessions: WebSessionStore;
}

/** The static assets this BFF serves; everything else is a page or an API route. */
const ASSET_TYPES: Readonly<Record<string, string>> = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

/**
 * Methods that do not change state; everything else needs an Origin check.
 *
 * The lifecycle commands are absent on purpose: `project.create/clone/trust/close/
 * initialize` change installation state, so `/rpc` must apply the exact-`Origin`
 * gate before forwarding them. `project.list`/`project.snapshot.get` are reads.
 */
const READ_ONLY = new Set([
  'connection.hello',
  'command.get',
  'project.list',
  'project.snapshot.get',
  'conversation.list',
  'conversation.get',
  'knowledge.list',
  'knowledge.get',
  'board',
  'work.list',
  'work.get',
  'requirement.list',
  'requirement.get',
  'run.list',
  'run.get',
  'artifact.list',
  'artifact.get',
  'inbox',
  'agents',
  'settings',
  'config.get',
  'plan.current',
  'extension.list',
  'ui.translate',
  'project.subscribe',
  'subscription.set',
  'subscription.remove',
  'project.events.ack',
]);
/**
 * `provider.upsert` / `provider.test` (`protocol.md` §5) are deliberately **absent**
 * from `READ_ONLY`: writing a Provider — and its `secret` — is a state change, so
 * `/rpc` must apply the same exact-`Origin` gate as every other write before the
 * envelope is forwarded (WP-12 T1.2b). An unknown method is a write too, because
 * `isWrite` defaults to `true`; adding either name here would silently drop that
 * gate.
 */

/** Resolves the package's `public/` directory for both `src` and `dist` runs. */
export function defaultPublicDir(): string {
  const here = fileURLToPath(new URL('.', import.meta.url));
  for (const candidate of [join(here, '..', 'public'), join(here, '..', '..', 'public')]) {
    try {
      if (statSync(candidate).isDirectory()) return candidate;
    } catch {
      // try the next candidate
    }
  }
  return join(here, '..', 'public');
}

/** The page a pathname names, or `undefined` for an unknown route. */
export function pageOf(pathname: string): PageKey | undefined {
  if (pathname === '/' || pathname === '/projects') return 'projects';
  if (pathname === '/settings') return 'settings';
  const segments = pathname.split('/').filter((part) => part !== '');
  if (segments[0] !== 'projects' || segments[1] === undefined) return undefined;
  if (segments[2] === undefined) return 'chief';
  switch (segments[2]) {
    case 'chief':
      return 'chief';
    case 'requirements':
      return segments[3] === undefined ? 'requirements' : 'requirement';
    case 'docs':
      return 'docs';
    case 'files':
      return 'files';
    case 'agents':
      return 'agents';
    case 'runs':
      return 'runs';
    case 'inbox':
      return 'inbox';
    default:
      return undefined;
  }
}

/**
 * Methods the whole installation answers, so any open project's daemon may serve
 * them (WP-12 T5). Everything else is a Project method and must be routed to the
 * daemon that holds that project.
 */
const INSTALLATION_METHODS = new Set([
  'connection.hello',
  'projects',
  'project.list',
  'project.open',
  'project.create',
  'project.clone',
  'project.trust',
  'project.close',
  'project.initialize',
  'settings',
  'agents',
  'ui.translate',
  'config.get',
  'config.save',
  'config.test',
  'backup.run',
  'restore.run',
  'secret.set',
  'secret.delete',
  'secret.list',
  'provider.upsert',
  'provider.test',
]);

/** True when a method is installation-level and carries no Project scope. */
export function isInstallationMethod(method: string): boolean {
  return INSTALLATION_METHODS.has(method);
}

/**
 * Installation-level project commands the BFF answers itself on a **vacant**
 * installation (WP-12 project UX).
 *
 * `project.open` and friends are normally delegated by a project's daemon to the
 * host's `ProjectDirectoryPort`. A fresh `agentdev start` has no open project, so
 * there is no daemon listener to answer them, and the first "open a folder" from the
 * browser could never succeed. In exactly that window — the installation directory
 * reports no `open` entry — the BFF performs the same delegation in-process, through
 * the port the daemon would have used, and answers the documented shapes. The first
 * project to open takes the documented daemon port, after which every command is
 * forwarded to a daemon again and the host's project directory stays the only writer.
 *
 * Every command here is idempotent on its own (`directory.open` is, `create` refuses
 * a non-empty root, `trust`/`close` are writes of a state); the bootstrap window has
 * no project store to record an idempotency key in, which the record registers.
 */
const BOOTSTRAP_LIFECYCLE = new Set([
  'project.list',
  'project.open',
  'project.create',
  'project.clone',
  'project.trust',
  'project.close',
  'project.initialize',
]);

/** The documented `ProjectSummary` shape for one navigable project. */
function bootstrapSummary(entry: ProjectEntry): Record<string, unknown> {
  return {
    projectId: entry.projectId ?? entry.root,
    name: entry.name,
    root: entry.root,
    trust: entry.trust,
    state: entry.state === 'open' ? 'open' : 'closed',
    version: 0,
    updatedAt: entry.updatedAt === '' ? new Date(0).toISOString() : entry.updatedAt,
    runningRuns: entry.runningRuns,
    executionReady: entry.executionReady,
    lifecycleState: entry.state,
    gitRoot: entry.gitRoot,
    head: entry.head,
    problem: entry.problem,
    initialization: entry.initialization,
    requirementImport: entry.import,
  };
}

/** A typed refusal the bootstrap commands answer with the documented error envelope. */
interface BootstrapFailure {
  readonly status: number;
  readonly code: string;
  readonly message: string;
  readonly details?: Record<string, unknown>;
}

/** The typed code/message of a `ProjectDirectoryError`-shaped throw, if it is one. */
function bootstrapFailureOf(error: unknown): BootstrapFailure {
  const shape = error as { code?: unknown; message?: unknown; details?: unknown };
  const code = typeof shape?.code === 'string' ? shape.code : 'INTERNAL_ERROR';
  const status = code === 'NOT_FOUND' ? 404 : code === 'INTERNAL_ERROR' ? 500 : 422;
  return {
    status,
    code,
    message: error instanceof Error ? error.message : String(error),
    ...(typeof shape?.details === 'object' && shape.details !== null
      ? { details: shape.details as Record<string, unknown> }
      : {}),
  };
}

/**
 * Answers one installation-level project command through the host's directory.
 *
 * @throws never; a refusal comes back as the typed error envelope the client shows.
 */
async function bootstrapProjectCommand(
  directory: ProjectDirectoryPort,
  method: string,
  params: Record<string, unknown>,
  operationId: string,
): Promise<Record<string, unknown>> {
  const required = (key: string): string => {
    const value = params[key];
    if (typeof value !== 'string' || value.trim() === '') {
      throw Object.assign(new Error(`${key} is required`), { code: 'VALIDATION_ERROR' });
    }
    return value;
  };
  try {
    switch (method) {
      case 'project.list':
        return {
          items: directory.list().map((entry) => bootstrapSummary(entry)),
          nextCursor: null,
          problems: directory.problems.map((problem) => ({ ...problem })),
        };
      case 'project.open': {
        const root = required('root');
        const trust = params['trust'];
        if (trust !== undefined && typeof trust !== 'boolean') {
          throw Object.assign(new Error('trust must be a boolean'), { code: 'VALIDATION_ERROR' });
        }
        const entry = await directory.open(root, { trust: trust === true });
        return {
          status: 'applied',
          operationId,
          entityId: entry.projectId,
          version: 0,
          projectId: entry.projectId,
          project: bootstrapSummary(entry),
          gitState: { gitRoot: entry.gitRoot, head: entry.head },
          trust: entry.trust,
        };
      }
      case 'project.create': {
        const entry = await directory.create(required('root'), required('name'));
        return {
          status: 'applied',
          operationId,
          entityId: entry.projectId,
          version: 0,
          projectId: entry.projectId,
          root: entry.root,
          name: entry.name,
          project: bootstrapSummary(entry),
        };
      }
      case 'project.clone': {
        const remoteUrl = required('remoteUrl');
        const root = required('root');
        // Q4: the Grant binds operation + target root + remote URL. When the caller
        // named one, that Grant is the authority and `directory.clone` verifies it;
        // when the browser did not (it has no way to mint one), the BFF mints it here
        // from the user's explicit submit — the same act the admin surface performs
        // for the CLI — and consumes it in the same command.
        const supplied = params['grantId'];
        const grantId =
          typeof supplied === 'string' && supplied !== ''
            ? supplied
            : directory.grantClone({ remoteUrl, root }).grantId;
        const entry = await directory.clone(remoteUrl, root, grantId);
        return {
          status: 'applied',
          operationId,
          entityId: entry.projectId,
          version: 0,
          projectId: entry.projectId,
          root: entry.root,
          name: entry.name,
          project: bootstrapSummary(entry),
        };
      }
      case 'project.trust': {
        const projectId = required('projectId');
        const trusted = params['trusted'];
        if (typeof trusted !== 'boolean') {
          throw Object.assign(new Error('trusted must be a boolean'), { code: 'VALIDATION_ERROR' });
        }
        const entry = directory.trust(projectId, trusted);
        return {
          status: 'applied',
          operationId,
          entityId: projectId,
          version: 0,
          projectId,
          trust: entry.trust,
          admission: entry.trust === 'trusted' ? 'open' : 'stopped',
          project: bootstrapSummary(entry),
        };
      }
      case 'project.close': {
        const projectId = required('projectId');
        const entry = directory.close(projectId);
        return {
          status: 'applied',
          operationId,
          entityId: projectId,
          version: 0,
          projectId,
          state: entry.state,
          project: bootstrapSummary(entry),
        };
      }
      case 'project.initialize':
        // Initialization drives an **open** project's own state machine and emits into
        // its event stream, so in the vacant window there is nothing to initialize;
        // this is the honest typed refusal, not a forward to a listener that is not
        // bound yet.
        throw Object.assign(
          new Error('no project is open on this installation yet; open one before initializing'),
          { code: 'INVALID_STATE' },
        );
      default:
        return errorBody('VALIDATION_ERROR', `${method} is not a bootstrap project command`);
    }
  } catch (error) {
    const failure = bootstrapFailureOf(error);
    return {
      ok: false,
      error: {
        code: failure.code,
        message: failure.message,
        retryable: false,
        details: { ...failure.details, operationId },
      },
    };
  }
}

/** The HTTP status one bootstrap answer is sent with. */
function bootstrapStatus(body: Record<string, unknown>): number {
  const error = body['error'];
  if (typeof error !== 'object' || error === null) return 200;
  const code = (error as { code?: unknown }).code;
  if (code === 'NOT_FOUND') return 404;
  if (code === 'INTERNAL_ERROR') return 500;
  return 422;
}

/** The `projectId` a `/projects/<id>/...` page path names, when it names one. */
export function projectIdOfPath(pathname: string): string | undefined {
  const segments = pathname.split('/').filter((part) => part !== '');
  if (segments[0] !== 'projects' || segments[1] === undefined) return undefined;
  return segments[1];
}

/** Where one browser request is routed: one project's daemon, or the fallback. */
interface Route {
  readonly target: DaemonTarget;
  readonly projectId: string | undefined;
}

/**
 * Builds the BFF server.
 *
 * Pages call the daemon on the caller's own session cookie, so authorization is
 * never widened by the BFF: an unauthenticated browser sees the sign-in page, and an
 * authenticated one only sees what its daemon session may read.
 */
export function createWebApp(options: WebAppOptions): WebApp {
  const sessions = options.sessions ?? new WebSessionStore();
  const files = options.files ?? new NodeFilePort();
  const publicDir = options.publicDir ?? defaultPublicDir();
  const rpc = options.rpc ?? forwardRpc;
  const read = options.read ?? daemonRead;
  const login = options.login ?? daemonLogin;
  const logout = options.logout ?? daemonLogout;
  const preview = options.preview ?? daemonPreview;
  const allowed =
    options.allowedOrigins === undefined || options.allowedOrigins.length === 0
      ? [options.daemon.origin]
      : options.allowedOrigins;
  const secureCookies = options.daemon.origin.startsWith('https:');
  const projects = options.projects;

  /**
   * Resolves the daemon that serves one project (WP-12 T5's per-request routing).
   *
   * `projectId === undefined` means "no project named": installation-level methods and
   * a single-project installation use the fallback target, and a multi-project
   * installation prefers its default project so `/projects` itself still renders.
   * `undefined` as the *result* means the named project is not served here.
   */
  function routeOf(projectId: string | undefined): Route | undefined {
    if (projects === undefined) return { target: options.daemon, projectId };
    if (projectId !== undefined) {
      const target = projects.targetOf(projectId);
      return target === undefined ? undefined : { target, projectId };
    }
    const fallback = projects.defaultProjectId();
    if (fallback !== undefined) {
      const target = projects.targetOf(fallback);
      if (target !== undefined) return { target, projectId: fallback };
    }
    return { target: options.daemon, projectId: undefined };
  }

  /**
   * The daemon the BFF signs a browser session in through (WP-12 T5).
   *
   * The session is created on a real daemon, so the target has to be resolved **now**,
   * not at construction: the host creates the BFF before it knows which projects will
   * be opened, and a `project.create`/`project.open` that arrives later makes the
   * installation's first daemon reachable. Without this the BFF would keep pointing at
   * the construction-time fallback and refuse every login on a freshly created
   * installation.
   */
  function loginTarget(): DaemonTarget {
    return routeOf(undefined)?.target ?? options.daemon;
  }

  /** Fails closed when a request names a project this installation does not serve. */
  function refuseUnknownProject(response: ServerResponse, projectId: string | undefined): void {
    json(
      response,
      404,
      errorBody('NOT_FOUND', `this installation does not serve project ${projectId ?? ''}`),
    );
  }

  const server = createServer((request, response) => {
    void handle(request, response).catch((error: unknown) => {
      fail(response, error);
    });
  });
  server.on('clientError', (_error, socket) => socket.destroy());
  server.on('upgrade', (request, socket) => {
    const session = sessionOf(request);
    const origin = headerOf(request, 'origin');
    const originOk = origin !== undefined && allowed.includes(origin);
    const authorized =
      session !== undefined &&
      originOk &&
      authenticateDaemon(options.auth, session, { isWrite: false, origin: options.daemon.origin })
        .ok;
    // `protocol.md` §2 + WP-12 T5 D-T5-5: the connection is bound to exactly one
    // project at handshake time, so a cursor can never be replayed against a different
    // project's event stream. A connection naming an unserved project is refused
    // before the upgrade completes.
    const requested = urlOf(request).searchParams.get('projectId') ?? undefined;
    const route = authorized ? routeOf(requested) : undefined;
    handleUpgrade({
      request,
      socket,
      target: route?.target ?? options.daemon,
      ...(route?.projectId === undefined ? {} : { projectId: route.projectId }),
      authorized: authorized && route !== undefined,
      refusalReason:
        session === undefined
          ? 'no valid session cookie'
          : !originOk
            ? 'the Origin header is not allowed'
            : route === undefined
              ? `this installation does not serve project ${requested ?? ''}`
              : 'the daemon session is not valid any more',
    });
  });

  /** The browser's session, resolved through the server-side store only. */
  function sessionOf(request: IncomingMessage): WebSession | undefined {
    return sessions.get(cookieValue(request.headers.cookie, 'agentdev_web'));
  }

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const path = url.pathname;
    const method = request.method ?? 'GET';

    if (path === '/healthz' && method === 'GET') {
      json(response, 200, { version: options.version ?? '0.0.0', ready: true });
      return;
    }

    if (path === '/auth/login' || path === '/api/auth/login') {
      if (method !== 'POST') {
        json(response, 405, errorBody('VALIDATION_ERROR', 'use POST to sign in'));
        return;
      }
      await handleLogin(request, response);
      return;
    }

    if (path === '/auth/logout' || path === '/api/auth/logout') {
      if (method !== 'POST') {
        json(response, 405, errorBody('VALIDATION_ERROR', 'use POST to sign out'));
        return;
      }
      await handleLogout(request, response);
      return;
    }

    if (path.startsWith('/assets/') && (method === 'GET' || method === 'HEAD')) {
      serveAsset(response, publicDir, path.slice('/assets/'.length));
      return;
    }

    if (path === '/api/session' && method === 'GET') {
      const session = sessionOf(request);
      if (session === undefined) {
        json(response, 401, errorBody('UNAUTHENTICATED', 'no valid session cookie'));
        return;
      }
      json(response, 200, {
        authenticated: true,
        expiresAt: new Date(session.expiresAt).toISOString(),
        daemonSessionId: session.daemonSessionId,
        // The browser uses this on its own writes; the daemon's CSRF check still
        // runs on the BFF's server-side session, so a stolen token alone is useless.
        csrfToken: session.csrfToken,
      });
      return;
    }

    const session = sessionOf(request);

    /**
     * The human-only folder picker (WP-12 project UX).
     *
     * A plain BFF GET route, deliberately **not** a `/rpc` method: it never reaches a
     * daemon, it is absent from `INSTALLATION_METHODS`/`READ_ONLY`, and no tool
     * catalogue or control channel names it (`apps/web/src/picker.ts` argues why).
     * It is a read of names, so it needs the browser session but no Origin gate; it is
     * read-only, so a non-GET method is refused rather than forwarded.
     */
    if (path === '/picker/list') {
      if (method !== 'GET') {
        json(response, 405, errorBody('VALIDATION_ERROR', 'the folder picker is read-only'));
        return;
      }
      if (session === undefined) {
        json(response, 401, errorBody('UNAUTHENTICATED', 'sign in to browse folders'));
        return;
      }
      const picker = options.picker;
      if (picker === undefined) {
        json(response, 404, errorBody('NOT_FOUND', 'this installation serves no folder picker'));
        return;
      }
      try {
        // The audit record is written inside `list` **before** it answers, so a
        // listing the trail could not record is refused, not served.
        const listing: PickerListing = picker.list(url.searchParams.get('path') ?? undefined, {
          sessionId: session.id,
        });
        json(response, 200, listing);
      } catch (error) {
        if (error instanceof PickerRefused) {
          json(response, error.status, {
            ok: false,
            error: {
              code: error.code,
              message: error.message,
              retryable: false,
              details: error.details,
            },
          });
          return;
        }
        json(response, 500, errorBody('INTERNAL_ERROR', messageOf(error)));
      }
      return;
    }

    if (path === '/rpc' && method === 'POST') {
      if (session === undefined) {
        json(response, 401, errorBody('UNAUTHENTICATED', 'sign in to use the workbench'));
        return;
      }
      await handleRpc(request, response, session);
      return;
    }

    if (path.startsWith('/artifacts/')) {
      if (session === undefined) {
        json(response, 401, errorBody('UNAUTHENTICATED', 'sign in to use the workbench'));
        return;
      }
      await proxyArtifacts(request, response, session, path, method);
      return;
    }

    if (method !== 'GET' && method !== 'HEAD') {
      json(response, 405, errorBody('VALIDATION_ERROR', `no route for ${method} ${path}`));
      return;
    }

    if (session === undefined) {
      renderLogin(response);
      return;
    }
    const daemonCheck = authenticateDaemon(options.auth, session, {
      isWrite: false,
      origin: options.daemon.origin,
    });
    if (!daemonCheck.ok) {
      // The daemon session behind this cookie is gone: forget the browser session so
      // the next request is refused directly rather than retried forever (AC-078).
      sessions.remove(session.id);
      renderLogin(response, daemonCheck.message);
      return;
    }
    await renderPage(request, response, url, session);
  }

  async function handleLogin(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const origin = headerOf(request, 'origin');
    if (origin !== undefined && !allowed.includes(origin)) {
      json(response, 403, errorBody('NOT_AUTHORIZED', `origin ${origin} is not allowed`));
      return;
    }
    const payload = await readJson(request);
    const token = typeof payload['token'] === 'string' ? payload['token'] : '';
    if (token === '') {
      json(response, 422, errorBody('VALIDATION_ERROR', 'the installation token is required'));
      return;
    }
    let created;
    try {
      created = await login(loginTarget(), token);
    } catch (error) {
      /**
       * The vacant installation (WP-12 project UX).
       *
       * `agentdev start` with no project binds no daemon listener, so there is no
       * `/auth/login` to reach and the first sign-in of a fresh install would fail
       * before the user could pick a folder. In exactly that window — the installation
       * directory reports no `open` entry — the BFF signs the browser in against the
       * `auth` service the host already shares with every project daemon. This is not
       * a bypass: `auth.login` performs the identical constant-time credential check,
       * the same 5/min per-IP limit and the same exact-Origin rule (`protocol.md` §2),
       * and the resulting session is the very session every later project daemon
       * authenticates. As soon as one project is open, the daemon login above is the
       * only path, so a broken daemon is never papered over.
       */
      const vacant =
        projects !== undefined && !projects.list().some((entry) => entry.state === 'open');
      const decision = vacant
        ? options.auth.login({
            token,
            ip: request.socket.remoteAddress ?? 'unknown',
            ...(origin === undefined ? {} : { origin }),
          })
        : undefined;
      if (decision === undefined || !decision.ok) {
        // A wrong token is 401 from the daemon; the BFF never guesses a success.
        json(
          response,
          decision === undefined ? statusOfFailure(error, 401) : decision.status,
          errorBody(
            decision === undefined
              ? codeOfFailure(error, 'UNAUTHENTICATED')
              : decision.status === 429
                ? 'BUSY'
                : 'UNAUTHENTICATED',
            decision === undefined
              ? messageOf(error)
              : decision.status === 429
                ? `too many failed sign-ins; retry after ${String(decision.retryAfterSec)}s`
                : decision.message,
          ),
        );
        return;
      }
      created = { daemonCookie: decision.sessionId, csrfToken: decision.csrfToken };
    }
    const session = sessions.create(created);
    response.setHeader('set-cookie', [sessionSetCookie(session.id, { secure: secureCookies })]);
    json(response, 200, {
      authenticated: true,
      csrfToken: session.csrfToken,
      expiresAt: new Date(session.expiresAt).toISOString(),
    });
  }

  async function handleLogout(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const origin = headerOf(request, 'origin');
    if (origin !== undefined && !allowed.includes(origin)) {
      json(response, 403, errorBody('NOT_AUTHORIZED', `origin ${origin} is not allowed`));
      return;
    }
    const id = cookieValue(request.headers.cookie, 'agentdev_web');
    const session = sessions.get(id);
    sessions.remove(id);
    if (session !== undefined) {
      // Best effort: the browser session is already gone even if the daemon is down,
      // and the daemon session expires on its own.
      await logout(loginTarget()).catch(() => undefined);
    }
    response.setHeader('set-cookie', [sessionClearCookie({ secure: secureCookies })]);
    if (wantsHtml(request)) {
      response.writeHead(303, { location: '/', 'cache-control': 'no-store' });
      response.end();
      return;
    }
    json(response, 200, { authenticated: false });
  }

  async function handleRpc(
    request: IncomingMessage,
    response: ServerResponse,
    session: WebSession,
  ): Promise<void> {
    const raw = (await readBody(request)).toString('utf8');
    const envelope = envelopeOf(raw);
    const method = envelope.method;
    const isWrite = method === undefined ? true : !READ_ONLY.has(method);
    /**
     * CSRF: deliberate BFF deviation, registered (W9R1-09).
     *
     * `protocol.md` §2 requires a CSRF token for same-origin writes. The BFF does
     * not forward or accept a browser-supplied `x-csrf-token`: it owns the daemon
     * session instead, so the write is authenticated with the BFF's own HttpOnly
     * `agentdev_web` cookie (SameSite=Lax) plus an exact-`Origin` check, and the
     * daemon call then carries the *BFF's* `session.csrfToken` — never a value the
     * browser can set. A cross-site form post therefore cannot produce an allowed
     * Origin and cannot reach the daemon at all, and a stolen session cookie is
     * useless without the Origin the daemon allowlists. The browser header is sent
     * for the `/rpc` contract but is not the authority; the deviation is recorded in
     * `implementation.md` §T5.
     */
    if (isWrite && !originAllowed(headerOf(request, 'origin'), allowed)) {
      json(
        response,
        403,
        errorBody('NOT_AUTHORIZED', 'a state-changing request needs an allowed Origin header'),
      );
      return;
    }
    const check = authenticateDaemon(options.auth, session, {
      isWrite,
      origin: options.daemon.origin,
    });
    if (!check.ok) {
      sessions.remove(session.id);
      response.setHeader('set-cookie', [sessionClearCookie({ secure: secureCookies })]);
      json(response, check.status, errorBody(check.code, check.message));
      return;
    }
    /**
     * WP-12 T5 per-request routing (D-T5-6).
     *
     * The route is chosen from the envelope's own `projectId`. An installation-level
     * method (or a request that names none) goes to the default project; a request
     * naming a project this installation does not serve fails closed with
     * `NOT_FOUND` rather than being answered by another project's daemon. When the
     * method is a Project method and the browser omitted the id, the BFF **injects**
     * the routed project's id, so the daemon's own
     * `projectId !== this.projectId` check is the second line of defence.
     */
    const route =
      method !== undefined && isInstallationMethod(method) && envelope.projectId === undefined
        ? routeOf(undefined)
        : routeOf(envelope.projectId);
    if (route === undefined) {
      refuseUnknownProject(response, envelope.projectId);
      return;
    }
    /**
     * The browser's project lifecycle (WP-12 project UX).
     *
     * Two cases are answered in-process against the host's `ProjectDirectoryPort`
     * instead of being forwarded to a daemon:
     *
     * 1. **The vacant installation.** `project.open`/`create`/`trust`/`close`/`list`
     *    are normally delegated by a project's daemon to the same directory, but a
     *    fresh `agentdev start` has no daemon listener yet, so the first folder the
     *    user picks could never be opened. While `projects.list()` reports no `open`
     *    entry the BFF performs that delegation itself.
     * 2. **A clone with no Grant.** `reliability.md` §7 requires an installation-level
     *    once-Grant for the clone's network + out-of-root writes, minted by the
     *    user's explicit act. The CLI mints it through the admin surface; the browser
     *    has neither, so the BFF mints it from the user's own authenticated,
     *    exact-Origin `/rpc` submit and consumes it immediately. A caller that does
     *    supply a `grantId` is forwarded to a daemon unchanged.
     *
     * Once one project is open, every command except the grant-less clone is
     * forwarded again; the host's directory stays the only writer either way.
     */
    const bootstrapParams = paramsOf(raw);
    const cloneWithoutGrant =
      projects !== undefined &&
      method === 'project.clone' &&
      envelope.projectId === undefined &&
      typeof bootstrapParams['grantId'] !== 'string';
    const vacantWindow =
      projects !== undefined &&
      method !== undefined &&
      BOOTSTRAP_LIFECYCLE.has(method) &&
      !projects.list().some((entry) => entry.state === 'open');
    if (projects !== undefined && (cloneWithoutGrant || vacantWindow)) {
      const bootstrap = await bootstrapProjectCommand(
        projects,
        method ?? '',
        bootstrapParams,
        `bootstrap-${String(Date.now())}-${String(Math.random()).slice(2, 8)}`,
      );
      // The answer keeps the documented response envelope (`protocol.md` §1) so a
      // client cannot tell a BFF-answered command from a daemon-answered one.
      const failure = bootstrap['error'];
      json(response, bootstrapStatus(bootstrap), {
        v: 1,
        type: 'response',
        id: envelope.id ?? `bootstrap-${String(Date.now())}`,
        ...(typeof failure === 'object' && failure !== null
          ? { ok: false, error: failure }
          : { ok: true, result: bootstrap }),
      });
      return;
    }
    const forwarded =
      method !== undefined && !isInstallationMethod(method) && route.projectId !== undefined
        ? withProjectId(raw, route.projectId)
        : raw;
    let answer;
    try {
      answer = await rpc(route.target, { raw: forwarded, session: sessionOfDaemon(session) });
    } catch (error) {
      json(response, 503, errorBody('PROVIDER_UNAVAILABLE', messageOf(error)));
      return;
    }
    json(response, answer.status, answer.body);
  }

  /** Pass-through for upload, preview and download: the daemon is the authority. */
  async function proxyArtifacts(
    request: IncomingMessage,
    response: ServerResponse,
    session: WebSession,
    path: string,
    method: string,
  ): Promise<void> {
    // Q6: the artifact URL carries the projectId explicitly
    // (`/artifacts/<projectId>/...`); the unprefixed form stays for a single-project
    // installation and for links a page already rendered. Either way the *routed*
    // project's daemon resolves and authorizes the token, so a token minted by one
    // project can never be redeemed through another project's route.
    const resolved = splitArtifactPath(path);
    if (resolved === undefined) {
      // Fail closed: an artifact URL without an explicit project is not a route any
      // more (WP-12 T5 Q6), so no request can fall back to "whatever project is
      // selected" and redeem another project's token.
      json(
        response,
        404,
        errorBody('NOT_FOUND', 'an artifact URL must name its project: /artifacts/<projectId>/…'),
      );
      return;
    }
    const route = routeOf(resolved.projectId);
    if (route === undefined) {
      refuseUnknownProject(response, resolved.projectId);
      return;
    }
    const isWrite = method !== 'GET' && method !== 'HEAD';
    if (isWrite && !originAllowed(headerOf(request, 'origin'), allowed)) {
      json(
        response,
        403,
        errorBody('NOT_AUTHORIZED', 'a state-changing request needs an allowed Origin header'),
      );
      return;
    }
    const check = authenticateDaemon(options.auth, session, {
      isWrite,
      origin: options.daemon.origin,
    });
    if (!check.ok) {
      sessions.remove(session.id);
      json(response, check.status, errorBody(check.code, check.message));
      return;
    }
    const body = method === 'GET' || method === 'HEAD' ? undefined : await readBody(request);
    const upstream = await fetch(
      `${route.target.baseUrl.replace(/\/+$/u, '')}${resolved.upstreamPath}`,
      {
        method,
        headers: {
          cookie: `agentdev_session=${session.daemonCookie}`,
          origin: route.target.origin,
          accept: String(request.headers.accept ?? '*/*'),
          'x-csrf-token': session.csrfToken,
          ...(request.headers['content-type'] === undefined
            ? {}
            : { 'content-type': String(request.headers['content-type']) }),
        },
        ...(body === undefined ? {} : { body }),
      },
    );
    const headers: Record<string, string> = {};
    for (const [key, value] of upstream.headers) {
      if (key === 'set-cookie' || key === 'connection' || key === 'transfer-encoding') continue;
      headers[key] = value;
    }
    headers['cache-control'] = 'no-store';
    response.writeHead(upstream.status, headers);
    if (method === 'HEAD') {
      response.end();
      return;
    }
    response.end(Buffer.from(await upstream.arrayBuffer()));
  }

  /** Renders one page from real protocol data. */
  async function renderPage(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
    session: WebSession,
  ): Promise<void> {
    const language = normaliseLanguage(cookieValue(request.headers.cookie, 'agentdev_language'));
    const panelValue = cookieValue(request.headers.cookie, 'agentdev_panel');
    const panelMode: PanelMode = isPanelMode(panelValue) ? panelValue : DEFAULT_PANEL_MODE;
    const t = translator(language);
    const segments = url.pathname.split('/').filter((part) => part !== '');
    const page = pageOf(url.pathname);
    if (page === undefined) {
      json(response, 404, errorBody('NOT_FOUND', `no page for ${url.pathname}`));
      return;
    }
    // WP-12 T5: the page path names the project, and every read below runs against
    // that project's daemon. A path naming an unserved project fails closed.
    const route = routeOf(projectIdOfPath(url.pathname));
    if (route === undefined) {
      json(
        response,
        404,
        errorBody('NOT_FOUND', `this installation does not serve ${url.pathname}`),
      );
      return;
    }

    const snapshot = await safeRead(route, session, 'project.snapshot.get');
    const project = snapshot.ok ? asObject(snapshot.value['project']) : {};
    const projectId = typeof project['id'] === 'string' ? project['id'] : 'project';
    const projectName =
      typeof project['name'] === 'string'
        ? project['name']
        : typeof project['root'] === 'string'
          ? project['root']
          : projectId;
    const revision = typeof project['head'] === 'string' ? project['head'] : 'working-tree';
    const branch =
      typeof project['deliveryBranch'] === 'string' ? project['deliveryBranch'] : 'working-tree';
    const root = typeof project['root'] === 'string' ? project['root'] : undefined;

    let body: string;
    let view: unknown = undefined;
    let inboxCount = 0;
    let pageTitle = t('app.title');

    switch (page) {
      case 'projects': {
        // WP-12 T5: the page lists what the *installation* serves — open, closed and
        // discoverable — not only the project this page happens to be routed to.
        const directory = projects?.list() ?? [];
        body = renderProjectsPage({
          projects:
            directory.length > 0
              ? directory.map((entry) => ({
                  id: entry.projectId ?? entry.root,
                  name: entry.name,
                  root: entry.root,
                  head: entry.head ?? '',
                  state: entry.state === 'open' ? 'open' : 'closed',
                  lifecycleState: entry.state,
                  trust: entry.trust,
                  runningRuns: entry.runningRuns,
                  initialization: entry.initialization === null ? '' : entry.initialization.phase,
                  problem:
                    entry.problem === null ? '' : `${entry.problem.code}: ${entry.problem.message}`,
                }))
              : Object.keys(project).length === 0
                ? []
                : [project],
          currentProjectId: projectId,
          counts: snapshot.ok ? numberRecord(snapshot.value['counts']) : {},
          problems:
            projects?.problems.map(
              (problem) =>
                `#${String(problem.index)} ${problem.root ?? '<unknown>'}: ${problem.code} — ${problem.message}`,
            ) ?? [],
          t,
          language,
          panelMode,
        });
        view = snapshot.ok ? snapshot.value : undefined;
        break;
      }
      case 'chief': {
        pageTitle = t('nav.chief');
        const conversations = await safeRead(route, session, 'conversation.list', { limit: 20 });
        const conversationId =
          url.searchParams.get('conversationId') ??
          (conversations.ok ? firstId(conversations.value, 'items') : undefined);
        if (conversationId === undefined) {
          body = renderNoticePage(t, 'chief', 'common.waiting');
          break;
        }
        const conversation = await safeRead(route, session, 'conversation.get', {
          conversationId,
          limit: 100,
        });
        if (!conversation.ok) {
          body = renderErrorPage(t, conversation.code, conversation.message);
          break;
        }
        const providers = await safeRead(route, session, 'agents');
        const providerReady = providers.ok
          ? objectsOf(providers.value, 'roles').some((role) => role['usable'] === true)
          : null;
        body = renderChiefPage({
          model: chiefModel({
            conversation: asObject(conversation.value['conversation']),
            conversations: conversations.ok ? objectsOf(conversations.value, 'items') : [],
            messages: objectsOf(conversation.value, 'messages'),
            ...(providerReady === null ? {} : { providerReady }),
          }),
          projectId,
          t,
        });
        view = conversation.value;
        break;
      }
      case 'requirements': {
        pageTitle = t('nav.requirements');
        const board = await safeRead(route, session, 'board');
        if (!board.ok) {
          body = renderErrorPage(t, board.code, board.message);
          break;
        }
        const model = boardModel(board.value, { branch });
        body = renderBoardPage({ model, projectId, t });
        view = board.value;
        break;
      }
      case 'requirement': {
        pageTitle = t('aria.detail');
        const requirementId = segments[3] ?? '';
        const requirement = await safeRead(route, session, 'requirement.get', { requirementId });
        if (!requirement.ok) {
          body = renderErrorPage(t, requirement.code, requirement.message, requirementId);
          break;
        }
        const workIdRaw = asObject(requirement.value['work'])?.['id'];
        const workId = typeof workIdRaw === 'string' ? workIdRaw : '';
        const artifacts =
          workId === '' ? empty() : await safeRead(route, session, 'artifact.list', { workId });
        const runs =
          workId === '' ? empty() : await safeRead(route, session, 'run.list', { workId });
        const work =
          workId === '' ? empty() : await safeRead(route, session, 'work.get', { workId });
        // The version the user asked for comes from the URL (a historical card keeps
        // its own version); without one the card shows the gate's current version
        // (W9R1-02). The request carries `planVersion` only when the URL named one:
        // `plan.current` answers `requestedVersion` unsolicited otherwise, and an
        // explicit 0 has to stay distinguishable from "no version asked for".
        const requestedPlanVersion = planVersionOf(url.searchParams.get('planVersion'));
        const requestedPlanParams =
          requestedPlanVersion === undefined ? {} : { planVersion: requestedPlanVersion };
        const planCurrent =
          workId === ''
            ? undefined
            : await safeRead(route, session, 'plan.current', {
                workId,
                ...requestedPlanParams,
              });
        const plan =
          workId === ''
            ? undefined
            : planCard({
                work: work.ok ? work.value : {},
                workId,
                revision,
                ...(planCurrent?.ok === true ? { planCurrent: planCurrent.value } : {}),
                ...(requestedPlanVersion === undefined
                  ? {}
                  : { requestedVersion: requestedPlanVersion }),
              });
        const detail = requirementDetail({
          requirement: {
            ...requirement.value,
            tasks: work.ok ? objectsOf(work.value, 'tasks') : [],
          },
          artifacts: artifacts.ok ? objectsOf(artifacts.value, 'items') : [],
          runs: runs.ok ? objectsOf(runs.value, 'items') : [],
          branch,
          projectId,
          ...(plan === undefined ? {} : { plan }),
        });
        body = renderRequirementPage({ detail, projectId, t });
        view = requirement.value;
        break;
      }
      case 'docs': {
        pageTitle = t('nav.docs');
        const activeView = docsViewOf(url.searchParams.get('view'));
        const query = url.searchParams.get('query') ?? '';
        const docs = await safeRead(route, session, 'knowledge.list', {
          view: activeView,
          ...(query === '' ? {} : { query }),
        });
        const views = docsViews();
        if (docs.ok) views[activeView] = docs.value;
        body = renderDocsPage({ views, activeView, query, projectId, t });
        view = docs.ok ? docs.value : undefined;
        break;
      }
      case 'files': {
        pageTitle = t('nav.files');
        const query = url.searchParams.get('query') ?? '';
        const requested = url.searchParams.get('path');
        let listing;
        let preview = null as ReturnType<FilePort['read']> | null;
        let fileError: { code: string; message: string } | null = null;
        try {
          listing = files.list({
            projectId,
            root,
            revision,
            branch,
            ...(query === '' ? {} : { query }),
          });
          if (requested !== null && requested !== '') {
            preview = files.read({ projectId, root, revision, path: requested });
          }
        } catch (error) {
          if (error instanceof FileBoundaryError) {
            fileError = { code: error.code, message: error.message };
            listing = listing ?? {
              root: root ?? '',
              revision,
              branch,
              entries: [],
              truncated: false,
            };
          } else {
            throw error;
          }
        }
        body = renderFilesPage({
          model: filesModel(
            {
              root: listing.root,
              revision: listing.revision,
              branch: listing.branch,
              entries: listing.entries.map((entry) => ({ ...entry })),
              truncated: listing.truncated,
            },
            query,
          ),
          preview:
            preview === null
              ? null
              : {
                  path: preview.path,
                  content: preview.content,
                  truncated: preview.truncated,
                  hash: preview.hash,
                  mime: preview.mime,
                  downloadHref: `/artifacts/${encodeURIComponent(projectId)}/download.prepare`,
                },
          error: fileError,
          projectId,
          t,
        });
        break;
      }
      case 'agents': {
        pageTitle = t('nav.agents');
        const agents = await safeRead(route, session, 'agents');
        if (!agents.ok) {
          body = renderErrorPage(t, agents.code, agents.message);
          break;
        }
        body = renderAgentsPage({ model: agentsModel(agents.value), t });
        view = agents.value;
        break;
      }
      case 'runs': {
        pageTitle = t('nav.runs');
        const works = await safeRead(route, session, 'work.list', { limit: 200 });
        const runId = url.searchParams.get('runId');
        const detail =
          runId === null ? undefined : await safeRead(route, session, 'run.get', { runId });
        body = renderRunsPage({
          model: runsModel(works.ok ? objectsOf(works.value, 'items') : []),
          detail:
            detail !== undefined && detail.ok
              ? runDetail({
                  run: asObject(detail.value['run']),
                  attempts: objectsOf(detail.value, 'attempts'),
                  stageResults: objectsOf(detail.value, 'stageResults'),
                })
              : null,
          projectId,
          t,
        });
        view = works.ok ? works.value : undefined;
        break;
      }
      case 'inbox': {
        pageTitle = t('nav.inbox');
        const inbox = await safeRead(route, session, 'inbox');
        if (!inbox.ok) {
          body = renderErrorPage(t, inbox.code, inbox.message);
          break;
        }
        const model = inboxModel(inbox.value, await inboxContext(route, session, inbox.value));
        inboxCount = model.unread;
        body = renderInboxPage({ model, projectId, t });
        view = inbox.value;
        break;
      }
      case 'settings': {
        pageTitle = t('nav.settings');
        const settings = await safeRead(route, session, 'settings');
        const config = await safeRead(route, session, 'config.get', { scope: 'global' });
        if (!config.ok) {
          body = renderErrorPage(t, config.code, config.message);
          break;
        }
        body = renderSettingsPage({
          model: settingsModel(config.value),
          settings: settings.ok ? settings.value : {},
          t,
        });
        view = config.value;
        break;
      }
      default: {
        body = renderErrorPage(t, 'NOT_FOUND', `no page for ${url.pathname}`);
      }
    }

    const state: ShellState = {
      projectId,
      projectName,
      page,
      language,
      panelMode,
      inboxCount,
      connectionState: 'connecting',
      // WP-12 T5: one switcher for every page, fed by the installation directory so
      // the browser can move between projects with an ordinary same-origin link.
      ...(projects === undefined
        ? {}
        : {
            projects: projects.list().map((entry) => ({
              projectId: entry.projectId,
              name: entry.name,
              root: entry.root,
              state: entry.state,
              problem: entry.problem === null ? null : entry.problem.message,
            })),
          }),
    };
    const html = renderDocument({
      lang: language === 'zh' ? 'zh-CN' : 'en',
      title: pageTitle,
      body: renderShell(state, body, t),
      statusText: 'ready',
    });
    send(
      response,
      200,
      'text/html; charset=utf-8',
      view === undefined
        ? html
        : html.replace(
            '</body>',
            `<script type="application/json" id="viewData">${escapeJson(view)}</script></body>`,
          ),
    );
  }

  /**
   * Runs one protocol read as the caller's own daemon session.
   *
   * A refusal is returned as data so a page can render the real error code instead
   * of guessing an empty state.
   */
  async function safeRead(
    route: Route,
    session: WebSession,
    method: string,
    params: JsonObject = {},
  ): Promise<ReadResult> {
    try {
      const value = await read<JsonObject>(
        route.target,
        sessionOfDaemon(session),
        method,
        params,
        route.projectId,
      );
      return { ok: true, value: value ?? {} };
    } catch (error) {
      return {
        ok: false,
        code: codeOfFailure(error, 'INTERNAL_ERROR'),
        message: messageOf(error),
      };
    }
  }

  /**
   * Resolves what the `inbox` answer itself does not carry (`protocol.md` §4/§6).
   *
   * A `product` decision's question is the markdown body of the Artifact its
   * `targetRef` points at, so it is read through the documented preview endpoint; a
   * failure becomes the explicit reason the card renders instead of an empty
   * question. A `permission` decision parks a Run, and the Inbox must name that Run,
   * so each Work with a pending permission request is read once. Both reads are
   * bounded by the rows actually on the page.
   */
  async function inboxContext(
    route: Route,
    session: WebSession,
    raw: JsonObject,
  ): Promise<InboxContext> {
    const questions: Record<string, InboxQuestion> = {};
    const waitingRuns: Record<string, InboxWaitingRun> = {};
    const workIds = new Set<string>();
    for (const item of objectsOf(raw, 'items')) {
      if (item['kind'] !== 'decision') continue;
      const workId = typeof item['workId'] === 'string' ? item['workId'] : '';
      const decisionKind = typeof item['decisionKind'] === 'string' ? item['decisionKind'] : '';
      if (decisionKind === 'permission' && workId !== '') workIds.add(workId);
      if (decisionKind !== 'product') continue;
      const targetRef = asObject(item['targetRef']);
      const artifactId = typeof targetRef['id'] === 'string' ? targetRef['id'] : '';
      const artifactVersion = typeof targetRef['version'] === 'number' ? targetRef['version'] : 0;
      if (artifactId === '') continue;
      const key = questionKey(artifactId, artifactVersion);
      if (questions[key] !== undefined) continue;
      const answer = await readPreview(route, session, artifactId);
      questions[key] = answer.ok
        ? { text: answer.text, error: null }
        : { text: '', error: `${answer.code}: ${answer.message}` };
    }
    for (const workId of workIds) {
      const runs = await safeRead(route, session, 'run.list', { workId });
      if (!runs.ok) continue;
      const waiting = objectsOf(runs.value, 'items').find(
        (run) => run['status'] === 'waiting_permission',
      );
      if (waiting === undefined) continue;
      waitingRuns[workId] = {
        runId: typeof waiting['id'] === 'string' ? waiting['id'] : '',
        role: typeof waiting['role'] === 'string' ? waiting['role'] : '',
        stage: typeof waiting['stage'] === 'string' ? waiting['stage'] : '',
        status: 'waiting_permission',
      };
    }
    return { questions, waitingRuns };
  }

  /** One Artifact body as the daemon serves it, with the refusal kept as data. */
  async function readPreview(
    route: Route,
    session: WebSession,
    artifactId: string,
  ): Promise<PreviewRead> {
    try {
      return await preview(route.target, sessionOfDaemon(session), artifactId);
    } catch (error) {
      return { ok: false, code: codeOfFailure(error, 'INTERNAL_ERROR'), message: messageOf(error) };
    }
  }

  function renderLogin(response: ServerResponse, reason?: string): void {
    const t = translator('en');
    const body = [
      `<main id="main" class="login">`,
      `<h1 data-i18n="auth.login">${escapeHtml(t('auth.login'))}</h1>`,
      `<form id="loginForm" method="post" action="/auth/login">`,
      `<label for="token" data-i18n="auth.token">${escapeHtml(t('auth.token'))}</label>`,
      `<input id="token" name="token" type="password" autocomplete="off" required>`,
      `<button type="submit" data-i18n="auth.submit">${escapeHtml(t('auth.submit'))}</button>`,
      reason === undefined ? '' : `<p class="alert" role="alert">${escapeHtml(reason)}</p>`,
      '</form>',
      `<p class="hint" data-i18n="auth.showedOnce">${escapeHtml(t('auth.showedOnce'))}</p>`,
      `</main>`,
    ].join('');
    send(
      response,
      401,
      'text/html; charset=utf-8',
      renderDocument({ lang: 'en', title: t('app.title'), body, statusText: 'unauthenticated' }),
    );
  }

  return { server, sessions };
}

type ReadResult = { readonly ok: true; readonly value: JsonObject } | ReadFailure;

interface ReadFailure {
  readonly ok: false;
  readonly code: string;
  readonly message: string;
}

function empty(): ReadResult {
  return { ok: true, value: {} };
}

/**
 * Builds the Plan card for a Work.
 *
 * `plan.current` is the authority: it answers the gate's approved version, the
 * requested version and whether the daemon can actually hand over a submittable
 * Plan body plus its local authorization. The card is therefore expired — and the
 * approve control disabled with a visible reason — exactly when the version the user
 * is looking at is not the gate's, or when approval is genuinely unavailable
 * (AC-070, W9R1-01/W9R1-02/W9R1-12).
 */
export function planCard(input: {
  readonly work: JsonObject;
  readonly workId: string;
  readonly revision: string;
  /**
   * The gate's own answer for this Work; without it the card cannot approve.
   *
   * The legacy artifact list is no longer consulted for the current version: a
   * `validity=invalid` or higher historical plan artifact made an expired card look
   * live (W9R1-12).
   */
  readonly planCurrent?: JsonObject;
  readonly requestedVersion?: number;
}): JsonObject {
  const answer = input.planCurrent ?? {};
  const hasAnswer = input.planCurrent !== undefined;
  const work = input.work;
  const assessment = asObject(work['assessment']);
  const assessmentRef = asObject(assessment['planRef']);
  const gateVersion = numberField(answer, 'currentVersion');
  const currentVersion = gateVersion ?? numberField(assessmentRef, 'version') ?? 0;
  const requested = input.requestedVersion ?? gateVersion ?? currentVersion;
  const gateStatus = typeof answer['gateStatus'] === 'string' ? answer['gateStatus'] : null;
  // `approval.enabled` is the daemon's real verdict; a missing answer (an older
  // daemon that does not expose `plan.current`) disables the button rather than
  // promising an approval the page cannot build.
  const approvalRaw = asObject(answer['approval']);
  const approvalEnabled = approvalRaw['enabled'] === true;
  const approvedVersionRaw = answer['approvedVersion'];
  const approvedVersion =
    typeof approvedVersionRaw === 'number'
      ? approvedVersionRaw
      : numberField(assessmentRef, 'version');
  const approvedAt = typeof answer['approvedAt'] === 'string' ? answer['approvedAt'] : null;
  const reasonRaw = approvalRaw['reason'];
  const approvalReason =
    typeof reasonRaw === 'string'
      ? reasonRaw
      : hasAnswer
        ? null
        : 'the Plan gate is not readable for this Work';
  // The daemon's machine-readable half: the page localises this code instead of
  // rendering the English diagnostic (W9R2-05). An answer that carries no code
  // (an older daemon, or a fixture) falls back to the generic "unavailable" text.
  const reasonCodeRaw = approvalRaw['reasonCode'];
  const approvalReasonCode =
    typeof reasonCodeRaw === 'string' && reasonCodeRaw !== ''
      ? reasonCodeRaw
      : hasAnswer
        ? null
        : 'gate_unavailable';
  return {
    workId: input.workId,
    revision: typeof work['baseRevision'] === 'string' ? work['baseRevision'] : input.revision,
    currentVersion,
    requestedVersion: requested,
    approvedVersion:
      approvedVersion === undefined || approvedVersion === 0 ? null : approvedVersion,
    approvedAt,
    expired: requested !== currentVersion || gateStatus === 'stale',
    approvalEnabled,
    approvalReason,
    approvalReasonCode,
    authorizationId:
      typeof answer['authorizationId'] === 'string' ? answer['authorizationId'] : null,
    plan: answer['plan'] ?? null,
  };
}

function renderErrorPage(
  t: ReturnType<typeof translator>,
  code: string,
  message: string,
  subject?: string,
): string {
  return [
    `<section class="panel" role="alert" data-error-code="${escapeHtml(code)}">`,
    `<h2 data-i18n="common.error">${escapeHtml(t('common.error'))}</h2>`,
    `<p class="mono">${escapeHtml(code)}</p>`,
    `<p>${escapeHtml(message)}</p>`,
    subject === undefined ? '' : `<p class="mono">${escapeHtml(subject)}</p>`,
    `<button type="button" id="retryPage" data-i18n="common.retry">${escapeHtml(t('common.retry'))}</button>`,
    '</section>',
  ].join('');
}

function renderNoticePage(t: ReturnType<typeof translator>, page: string, key: string): string {
  return `<section class="panel" data-page-body="${escapeHtml(page)}"><p class="empty">${escapeHtml(t(key))}</p></section>`;
}

function docsViewOf(value: string | null): 'delivered' | 'design' | 'work' {
  return value === 'design' || value === 'work' ? value : 'delivered';
}

/** A fresh three-view container; each view is a real protocol answer or empty. */
function docsViews(): Record<'delivered' | 'design' | 'work', JsonObject> {
  return {
    delivered: { items: [] },
    design: { items: [] },
    work: { items: [] },
  };
}

/**
 * Parses `?planVersion=` into the version the card must show (W9R1-02).
 *
 * A malformed or absent parameter leaves the gate's current version in charge; a
 * present one is what makes a historical card render as expired instead of silently
 * presenting the live version as if the user were looking at it.
 */
export function planVersionOf(raw: string | null): number | undefined {
  if (raw === null || raw.trim() === '') return undefined;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function objectsOf(source: JsonObject, key: string): JsonObject[] {
  const value = source[key];
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is JsonObject =>
      typeof entry === 'object' && entry !== null && !Array.isArray(entry),
  );
}

function firstId(source: JsonObject, key: string): string | undefined {
  const id = objectsOf(source, key)[0]?.['id'];
  return typeof id === 'string' ? id : undefined;
}

/** A numeric JSON field, or `undefined` when it is absent or not a number. */
function numberField(source: JsonObject, key: string): number | undefined {
  const value = source[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asObject(value: unknown): JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function numberRecord(value: unknown): Readonly<Record<string, number>> {
  const source = asObject(value);
  const result: Record<string, number> = {};
  for (const [key, entry] of Object.entries(source)) {
    if (typeof entry === 'number') result[key] = entry;
  }
  return result;
}

function envelopeOf(raw: string): { id?: string; method?: string; projectId?: string } {
  try {
    const parsed: unknown = JSON.parse(raw);
    const id = (parsed as { id?: unknown }).id;
    const method = (parsed as { method?: unknown }).method;
    const projectId = (parsed as { projectId?: unknown }).projectId;
    return {
      ...(typeof id === 'string' ? { id } : {}),
      ...(typeof method === 'string' ? { method } : {}),
      ...(typeof projectId === 'string' ? { projectId } : {}),
    };
  } catch {
    return {};
  }
}

/**
 * The `params` object of a request envelope, or `{}`.
 *
 * Used only by the bootstrap project commands the BFF answers itself; everything
 * else is forwarded as raw text so the daemon owns its own validation.
 */
function paramsOf(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    const params = (parsed as { params?: unknown }).params;
    return typeof params === 'object' && params !== null && !Array.isArray(params)
      ? (params as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * Injects the routed `projectId` into an envelope that named none (WP-12 T5 D-T5-6).
 *
 * The daemon still validates `projectId === this.projectId`, so this is a
 * convenience that makes the routing explicit on the wire, never a bypass: a
 * mis-routed request becomes a `NOT_FOUND` at the daemon instead of silently
 * answering from another project. A malformed body is forwarded unchanged so the
 * daemon answers its own `VALIDATION_ERROR`.
 */
export function withProjectId(raw: string, projectId: string): string {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return raw;
    const envelope = parsed as Record<string, unknown>;
    if (typeof envelope['projectId'] === 'string' && envelope['projectId'] !== '') return raw;
    return JSON.stringify({ ...envelope, projectId });
  } catch {
    return raw;
  }
}

/**
 * Splits a BFF artifact path into its project context and the daemon path (Q6).
 *
 * The **only** accepted shape is `/artifacts/<projectId>/<rest>`: under one BFF origin
 * a bare `/artifacts/<id>/preview` or `/artifacts/download/<token>` would have to be
 * resolved from implicit "current project" state, which the ruling forbids and which
 * would make the project-scope check meaningless (a token minted by one project could
 * be redeemed through another project's route). An unprefixed or reserved path returns
 * `undefined`, and the caller fails closed with `NOT_FOUND`.
 *
 * @returns the project and the daemon-relative path, or `undefined` for a path that is
 * not explicitly project-scoped.
 */
export function splitArtifactPath(
  path: string,
): { readonly projectId: string; readonly upstreamPath: string } | undefined {
  const segments = path.split('/').filter((part) => part !== '');
  // Reserved words can never be a project id: they are the daemon's own route names.
  const reserved = new Set(['download', 'download.prepare', 'upload', 'uploads']);
  if (segments[0] !== 'artifacts' || segments.length < 3) return undefined;
  const projectId = segments[1] ?? '';
  if (projectId === '' || reserved.has(projectId)) return undefined;
  return {
    projectId,
    upstreamPath: `/artifacts/${segments.slice(2).join('/')}`,
  };
}

function urlOf(request: IncomingMessage): URL {
  return new URL(request.url ?? '/', 'http://127.0.0.1');
}

function serveAsset(response: ServerResponse, publicDir: string, relative: string): void {
  const base = resolve(publicDir);
  const target = resolve(base, normalize(relative));
  if (target !== base && !target.startsWith(`${base}${sep}`)) {
    json(response, 404, errorBody('NOT_FOUND', 'no such asset'));
    return;
  }
  let bytes: Buffer;
  try {
    bytes = readFileSync(target);
  } catch {
    json(response, 404, errorBody('NOT_FOUND', 'no such asset'));
    return;
  }
  send(
    response,
    200,
    ASSET_TYPES[extname(target).toLowerCase()] ?? 'application/octet-stream',
    bytes,
  );
}

function wantsHtml(request: IncomingMessage): boolean {
  const accept = request.headers.accept;
  return typeof accept === 'string' && accept.includes('text/html');
}

function headerOf(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function send(
  response: ServerResponse,
  status: number,
  contentType: string,
  body: string | Buffer,
): void {
  const payload = typeof body === 'string' ? Buffer.from(body, 'utf8') : body;
  response.writeHead(status, {
    'content-type': contentType,
    'content-length': String(payload.byteLength),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  });
  response.end(payload);
}

function json(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(Buffer.byteLength(payload, 'utf8')),
    'cache-control': 'no-store',
  });
  response.end(payload);
}

function errorBody(code: string, message: string): JsonObject {
  return { ok: false, error: { code, message, retryable: false } };
}

function fail(response: ServerResponse, error: unknown): void {
  if (response.headersSent) {
    response.end();
    return;
  }
  json(response, 500, errorBody(codeOfFailure(error, 'INTERNAL_ERROR'), messageOf(error)));
}

function codeOfFailure(error: unknown, fallback: string): string {
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && code !== '' ? code : fallback;
}

function statusOfFailure(error: unknown, fallback: number): number {
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' ? status : fallback;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'the request could not be completed';
}

async function readBody(request: IncomingMessage, limit = 64 * 1024 * 1024): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    total += buffer.byteLength;
    if (total > limit) {
      const error = new Error('the request body is too large') as Error & {
        status: number;
        code: string;
      };
      error.status = 413;
      error.code = 'VALIDATION_ERROR';
      throw error;
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

async function readJson(request: IncomingMessage): Promise<JsonObject> {
  const body = await readBody(request);
  if (body.byteLength === 0) return {};
  try {
    return asObject(JSON.parse(body.toString('utf8')));
  } catch {
    return {};
  }
}

function escapeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</gu, '\\u003c');
}

/**
 * The daemon's cookie under the name `@agentdev/client` uses.
 *
 * The BFF session keeps the daemon cookie under `daemonCookie` so it can never be
 * confused with the browser's own cookie; the client calls it `cookie`.
 */
function sessionOfDaemon(session: WebSession): { cookie: string; csrfToken: string } {
  return { cookie: session.daemonCookie, csrfToken: session.csrfToken };
}

export { BrowserSocket };
