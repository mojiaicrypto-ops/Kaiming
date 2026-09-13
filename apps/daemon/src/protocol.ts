/**
 * The workbench protocol surface: HTTP `/rpc`, the `/ws` event stream and the
 * commands/queries `protocol.md` defines for the browser.
 *
 * `docs/architecture/protocol.md` §1/§2/§5/§7 is the contract this module
 * implements. It owns three things and no business state:
 *
 * - envelope handling (`{v,type,id,method,projectId?,params}` in, one terminal
 *   response out) plus the HTTP status mapping of the error table;
 * - the read queries the nine workbench pages need, every one of them answered
 *   from the real `ProjectStore`/`EventHub`/services passed in — no mock state and
 *   no invented success;
 * - the WebSocket upgrade (Origin + cookie/credential), `connection.hello`, the
 *   subscription lifecycle with an `afterCursor` watermark and the live event
 *   stream.
 *
 * The transport is Node's built-in HTTP upgrade plus a minimal RFC6455 frame codec
 * in this repository: the dependency policy forbids adding `ws`, and the documented
 * protocol only needs text frames.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import {
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
  PROTOCOL_LIMITS,
  ROLES,
  errorCodeSchema,
  type ErrorCode,
  type FindingSeverity,
  type JsonObject,
  type Plan,
  type ProjectSummary,
  type Ref,
  type Role,
  type Scope,
  type SourceRef,
} from '@agentdev/contracts';
import {
  ProtocolError,
  backupProject,
  createNodeBackupGitPort,
  restoreProject,
  sendMessage,
  userIdFromSubject,
  type BackupGitPort,
  type ConfigStore,
  type DecisionService,
  type DownloadTokenStore,
  type EventHub,
  type FindingService,
  type PlanDraft,
  type PlanGateService,
  type RequirementContinuation,
  type RequirementSaveService,
  type ArtifactService,
  type AttachmentService,
} from '@agentdev/core';
import { withTransaction, type BlobStore, type Event, type ProjectStore } from '@agentdev/storage';

/** One authenticated caller, as the daemon resolved it from cookie or credential. */
export interface WorkbenchCaller {
  /** Audit subject: the session id or the installation credential. */
  readonly subject: string;
  /** Ownership identity for uploads and messages (single-user installation). */
  readonly userId: string;
  /** Role this connection reads artifacts as. */
  readonly role: Role;
}

/** Everything the protocol layer reads or writes; all of it is real Core. */
export interface WorkbenchServices {
  readonly store: ProjectStore;
  readonly blobs: BlobStore;
  readonly events: EventHub;
  readonly attachments: AttachmentService;
  readonly artifacts: ArtifactService;
  readonly tokens: DownloadTokenStore;
  readonly version: string;
  /** Optional real services; a missing one refuses its method instead of guessing. */
  readonly config?: ConfigStore;
  readonly gates?: PlanGateService;
  readonly decisions?: DecisionService;
  readonly findings?: FindingService;
  readonly requirements?: RequirementContinuation;
  readonly requirementSaves?: RequirementSaveService;
  /** Backup/restore port; defaults to the real `git`-backed implementation. */
  readonly backupGit?: BackupGitPort;
  readonly now?: () => number;
}

/** The upgrade decision for one WebSocket request. */
export interface UpgradeDecision {
  readonly ok: boolean;
  readonly caller?: WorkbenchCaller;
  readonly reason?: string;
}

/** The auth seam the daemon passes in, so the protocol never owns sessions. */
export interface WorkbenchAuthPort {
  readonly authenticate: (input: {
    readonly cookie?: string;
    readonly csrfToken?: string;
    readonly origin?: string;
    readonly isWrite: boolean;
  }) => {
    readonly ok: boolean;
    readonly status?: number;
    readonly code?: ErrorCode;
    readonly message?: string;
    readonly userId?: string;
    readonly subject?: string;
  };
  readonly cookieOf: (request: IncomingMessage) => string | undefined;
  readonly bearerOk: (header: string | undefined) => boolean;
}

/** A protocol-shaped HTTP failure with the status the error table implies. */
export class HttpFailure extends Error {
  readonly status: number;
  readonly code: string;
  /**
   * The protocol error envelope's `details`.
   *
   * Typed as the shared JSON object so it passes straight through to
   * `ProtocolError`/`HttpFailure` without a re-shaping step (R-shape: the wire
   * shape is the contract's, not this module's).
   */
  readonly details: JsonObject;

  constructor(status: number, code: string, message: string, details: JsonObject = {}) {
    super(message);
    this.name = 'HttpFailure';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** The HTTP status a protocol code maps onto (`protocol.md` §7). */
export function statusForCode(code: string): number {
  switch (code) {
    case 'NOT_FOUND':
    case 'RESYNC_REQUIRED':
      return 404;
    case 'UNAUTHENTICATED':
    case 'AUTH_EXPIRED':
      return 401;
    case 'NOT_AUTHORIZED':
    case 'CONTEXT_FORBIDDEN':
      return 403;
    case 'VERSION_CONFLICT':
    case 'IDEMPOTENCY_CONFLICT':
    case 'INVALID_STATE':
    case 'GATE_NOT_READY':
    case 'STALE_ARTIFACT':
    case 'RECOVERY_REQUIRED':
    case 'BUSY':
      return 409;
    case 'VALIDATION_ERROR':
    case 'MISSING_CONTEXT':
    case 'BUDGET_EXCEEDED':
    case 'ATTACHMENT_ALREADY_BOUND':
    case 'ARTIFACT_MISSING':
    case 'KNOWLEDGE_INVALID':
    case 'PROVIDER_UNAVAILABLE':
    case 'PROTOCOL_MISMATCH':
    case 'REQUIREMENT_CONFLICT':
    case 'REQUIREMENT_PATH_IGNORED':
    case 'LEGACY_REQUIREMENT_FORMAT':
      return 422;
    default:
      return 500;
  }
}

/** Methods served without a Project scope (global configuration etc.). */
const GLOBAL_METHODS: readonly string[] = [
  'connection.hello',
  'projects',
  'settings',
  'agents',
  'ui.translate',
  'config.get',
  'config.save',
  'config.test',
  'backup.run',
  'restore.run',
];

/** Methods that change state and therefore accept an `idempotencyKey`. */
export const WRITE_METHODS: readonly string[] = [
  'project.open',
  'conversation.create',
  'conversation.message.send',
  'work.control',
  'requirement.save',
  'requirement.save.retry',
  'requirement.continue',
  'plan.approve',
  'finding.submit',
  'decision.resolve',
  'config.save',
  'config.test',
  'backup.run',
  'restore.run',
];

/**
 * Write methods whose idempotency ledger entry the generic wrapper owns.
 *
 * `conversation.message.send` and `requirement.save` are deliberately absent: their
 * effects already run inside their own transaction together with a dedicated ledger
 * entry, and nesting a second wrapper there would double-record the same command.
 * `backup.run`/`restore.run` use the non-transactional variant below.
 */
const LEDGER_WRAPPED_METHODS: readonly string[] = [
  'conversation.create',
  'project.open',
  'work.control',
  'requirement.continue',
  'plan.approve',
  'finding.submit',
  'decision.resolve',
  'config.save',
  'config.test',
];

/**
 * Write methods whose ledger entry cannot share a transaction with its effect.
 *
 * `backupProject` snapshots the database with SQLite `VACUUM INTO` on the same
 * connection, and SQLite refuses that inside a transaction (W9R1-04). The ledger
 * row is therefore written and completed around the operation on its own; a crash
 * between the effect and `complete` can only cause a re-run, never a false replay.
 */
const NON_TRANSACTIONAL_LEDGER_METHODS: readonly string[] = ['backup.run', 'restore.run'];

/**
 * The six level-2 headings every `content.md` carries, in order
 * (`requirements.md` §6). The daemon generates a canonical record for a
 * cancellation, so the body is copied here instead of imported from Core's
 * validator; the real `RequirementSaveService` still validates every save.
 */
const REQUIREMENT_CONTENT_HEADINGS = [
  '目标与背景',
  '范围与行为',
  '验收说明',
  '已确认决定',
  '未决问题',
  '完成摘要',
] as const;

/** Placeholder for a requirement section that carries no content yet. */
const REQUIREMENT_EMPTY_SECTION = '待明确';

/** The daemon's own interface-string catalogue; the UI owns its wordings. */
const UI_STRINGS: Record<string, { readonly en: string; readonly zh: string }> = {
  'app.title': { en: 'AgentDev Workspace', zh: 'AgentDev 工作台' },
  'nav.projects': { en: 'Projects', zh: '项目' },
  'nav.chief': { en: 'Chief', zh: '主管' },
  'nav.requirements': { en: 'Requirements', zh: '需求' },
  'nav.docs': { en: 'Docs', zh: '知识' },
  'nav.files': { en: 'Files', zh: '文件' },
  'nav.agents': { en: 'Agents', zh: '角色' },
  'nav.runs': { en: 'Runs', zh: '运行' },
  'nav.inbox': { en: 'Inbox', zh: '待处理' },
  'nav.live': { en: 'Live', zh: '实时' },
  'nav.settings': { en: 'Settings', zh: '设置' },
  'state.received': { en: 'Received', zh: '已接收' },
  'state.processing': { en: 'Processing', zh: '处理中' },
  'state.processed': { en: 'Processed', zh: '已处理' },
  'state.failed': { en: 'Failed', zh: '失败' },
  'state.decision_required': { en: 'Decision required', zh: '需要决定' },
  'board.queued': { en: 'Queued', zh: '需求队列' },
  'board.active': { en: 'Active', zh: '迭代中需求' },
  'board.completed': { en: 'Completed', zh: '已完成' },
  'board.archived': { en: 'Archived', zh: '已归档' },
  'config.invalid': { en: 'The configuration was rejected', zh: '配置未通过校验' },
  disconnected: { en: 'Connection lost; background state pending', zh: '连接中断，后台状态待同步' },
};

interface ParsedEnvelope {
  readonly id: string;
  readonly method: string;
  readonly params: JsonObject;
  readonly projectId?: string;
  readonly idempotencyKey?: string;
  readonly expectedVersion?: number;
}

interface SubscriptionRecord {
  readonly id: string;
  /** The scope this subscription observes; `subscription.set` replaces it. */
  scope: { readonly kind: string; readonly id?: string };
  /** Highest cursor handed to the client (the delivery watermark). */
  cursor: number;
}

/**
 * The workbench protocol over one Project's real Core.
 *
 * One instance per daemon; every method reads or writes the same `ProjectStore`,
 * so a query can never answer from a copy and a command can never skip the real
 * service.
 */
export class WorkbenchProtocol {
  private readonly services: WorkbenchServices;
  private readonly now: () => number;
  private readonly backupGit: BackupGitPort;
  private connectionSequence = 0;
  /** Live WebSocket connections, so a shutdown or failure can close them honestly. */
  private readonly sockets = new Set<ServerWebSocket>();

  constructor(services: WorkbenchServices) {
    this.services = services;
    this.now = services.now ?? (() => Date.now());
    this.backupGit = services.backupGit ?? createNodeBackupGitPort();
  }

  /** The Project this daemon serves; also the ACL boundary of every query. */
  get projectId(): string {
    return this.services.store.projectId;
  }

  /** The HTTP status for one protocol failure. */
  statusOf(code: string): number {
    return statusForCode(code);
  }

  // -------------------------------------------------------------------------
  // HTTP /rpc
  // -------------------------------------------------------------------------

  /**
   * Answers one `/rpc` request.
   *
   * The envelope carries the whole request, including `idempotencyKey` and
   * `expectedVersion`; the response is the single terminal envelope
   * (`protocol.md` §1).
   */
  handleRpc(raw: string, auth: WorkbenchAuthPort, request: IncomingMessage): JsonObject {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new HttpFailure(422, 'VALIDATION_ERROR', 'the request body is not JSON');
    }
    const envelope = parseEnvelope(parsed);
    const caller = this.authenticateRequest(request, auth, WRITE_METHODS.includes(envelope.method));
    // One request yields exactly one terminal response envelope (`protocol.md` §1);
    // a thrown `ProtocolError` is rewritten by the caller with the status its code
    // implies, so this method only builds the success shape.
    return {
      v: 1,
      type: 'response',
      id: envelope.id,
      ok: true,
      result: this.dispatchEnvelope(envelope, caller),
    };
  }

  /** Dispatches a parsed envelope synchronously; every command is synchronous. */
  dispatchEnvelope(envelope: ParsedEnvelope, caller: WorkbenchCaller): JsonObject {
    const result = this.dispatch(envelope.method, envelope.params, {
      caller,
      ...(envelope.idempotencyKey === undefined ? {} : { idempotencyKey: envelope.idempotencyKey }),
      ...(envelope.expectedVersion === undefined
        ? {}
        : { expectedVersion: envelope.expectedVersion }),
      ...(envelope.projectId === undefined ? {} : { projectId: envelope.projectId }),
    });
    // Every documented method answers synchronously; a command that returned a
    // Promise would be a Core contract break, not a slow request.
    if (result instanceof Promise) {
      throw new ProtocolError('INTERNAL_ERROR', `${envelope.method} answered asynchronously`);
    }
    // The result is the documented `result` member of the response envelope; the
    // protocol layer does not reshape domain rows.
    return JSON.parse(JSON.stringify(result ?? null)) as JsonObject;
  }

  /** Resolves the caller from the session cookie / installation credential. */
  authenticateRequest(
    request: IncomingMessage,
    auth: WorkbenchAuthPort,
    isWrite: boolean,
  ): WorkbenchCaller {
    if (auth.bearerOk(request.headers.authorization)) {
      return {
        subject: 'installation:local',
        userId: userIdFromSubject('installation:local'),
        role: 'chief',
      };
    }
    const cookie = auth.cookieOf(request);
    const decision = auth.authenticate({
      ...(cookie === undefined ? {} : { cookie }),
      ...(typeof request.headers['x-csrf-token'] === 'string'
        ? { csrfToken: request.headers['x-csrf-token'] }
        : {}),
      ...(typeof request.headers.origin === 'string' ? { origin: request.headers.origin } : {}),
      isWrite,
    });
    if (!decision.ok) {
      const code = decision.code ?? 'UNAUTHENTICATED';
      throw new HttpFailure(
        decision.status ?? statusForCode(code),
        code,
        decision.message ?? 'the request is not authenticated',
      );
    }
    return {
      subject: decision.subject ?? `user:${cookie ?? 'unknown'}`,
      userId: decision.userId ?? userIdFromSubject('installation:local'),
      role: 'chief',
    };
  }

  // -------------------------------------------------------------------------
  // WebSocket upgrade
  // -------------------------------------------------------------------------

  /**
   * Decides whether an upgrade may proceed.
   *
   * `protocol.md` §2: the WebSocket connect verifies Origin **and** cookie; a
   * Bearer installation credential is accepted for the BFF/CLI. A refusal never
   * reaches `101`, so an unauthenticated peer gets no socket and no event.
   */
  authorizeUpgrade(request: IncomingMessage, auth: WorkbenchAuthPort): UpgradeDecision {
    const origin = typeof request.headers.origin === 'string' ? request.headers.origin : undefined;
    if (origin === undefined || origin === '') {
      return { ok: false, reason: 'the Origin header is required' };
    }
    if (auth.bearerOk(request.headers.authorization)) {
      return {
        ok: true,
        caller: {
          subject: 'installation:local',
          userId: userIdFromSubject('installation:local'),
          role: 'chief',
        },
      };
    }
    const cookie = auth.cookieOf(request);
    const decision = auth.authenticate({
      ...(cookie === undefined ? {} : { cookie }),
      origin,
      // The handshake carries no write; every command still re-checks CSRF over
      // its own envelope.
      isWrite: false,
    });
    if (!decision.ok) {
      return { ok: false, reason: decision.message ?? 'the session is not authorised' };
    }
    return {
      ok: true,
      caller: {
        subject: decision.subject ?? `user:${cookie ?? 'unknown'}`,
        userId: decision.userId ?? userIdFromSubject('installation:local'),
        role: 'chief',
      },
    };
  }

  /**
   * Handles one HTTP upgrade for `/ws`.
   *
   * Exported for the daemon's `upgrade` listener and directly for tests, which
   * drive a real socket over loopback.
   */
  handleUpgrade(request: IncomingMessage, socket: Duplex, auth: WorkbenchAuthPort): boolean {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (url.pathname !== '/ws') return false;
    if (request.headers.upgrade?.toLowerCase() !== 'websocket') {
      socket.end('HTTP/1.1 400 Bad Request\r\nconnection: close\r\n\r\n');
      return true;
    }
    const decision = this.authorizeUpgrade(request, auth);
    if (!decision.ok || decision.caller === undefined) {
      socket.end(
        [
          'HTTP/1.1 401 Unauthorized',
          'connection: close',
          `x-agentdev-reason: ${encodeURIComponent(decision.reason ?? 'unauthorised')}`,
          '\r\n',
        ].join('\r\n'),
      );
      return true;
    }
    const key = request.headers['sec-websocket-key'];
    if (typeof key !== 'string') {
      socket.end('HTTP/1.1 400 Bad Request\r\nconnection: close\r\n\r\n');
      return true;
    }
    const accept = createHash('sha1').update(`${key}${WS_GUID}`).digest('base64');
    socket.write(
      [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${accept}`,
        '\r\n',
      ].join('\r\n'),
    );
    this.connectionSequence += 1;
    const connection = new ServerWebSocket(
      socket,
      this,
      decision.caller,
      `conn-${String(this.connectionSequence)}-${randomBytes(6).toString('hex')}`,
    );
    this.sockets.add(connection);
    return true;
  }

  /** Drops a connection from the registry; called when its socket ends. */
  unregister(connection: ServerWebSocket): void {
    this.sockets.delete(connection);
    this.services.events.closeConnection(connection.connectionId);
  }

  /** Live WebSocket connections; used by tests and diagnostics. */
  get connectionCount(): number {
    return this.sockets.size;
  }

  /** Closes every live connection; the daemon calls this on `close`. */
  closeAll(code = 1001, reason = 'daemon closing'): void {
    for (const connection of [...this.sockets]) connection.close(code, reason);
  }

  // -------------------------------------------------------------------------
  // Command dispatch
  // -------------------------------------------------------------------------

  /**
   * Dispatches one method.
   *
   * Every branch either reads real state or calls a real service; a method whose
   * service is not wired refuses with a protocol code instead of fabricating a
   * success (`NOT_FOUND` for an unknown method, `INVALID_STATE` for a capability
   * this daemon instance does not hold).
   */
  dispatch(
    method: string,
    params: JsonObject,
    options: {
      readonly caller: WorkbenchCaller;
      readonly idempotencyKey?: string;
      readonly expectedVersion?: number;
      readonly projectId?: string;
    },
  ): unknown {
    const needsProject = !GLOBAL_METHODS.includes(method);
    if (needsProject && options.projectId !== undefined && options.projectId !== this.projectId) {
      // `protocol.md` §1: a cross-Project id is NOT_FOUND, never another Project's
      // data. This daemon holds exactly one ProjectRuntime, and the refusal echoes
      // only the id the caller sent — never this installation's own id (W9R1-03).
      throw new ProtocolError(
        'NOT_FOUND',
        `Project ${options.projectId} is not open on this daemon`,
        {
          details: { projectId: options.projectId },
        },
      );
    }
    if (WRITE_METHODS.includes(method)) {
      const key = options.idempotencyKey;
      if (
        key !== undefined &&
        (key.length < PROTOCOL_LIMITS.idempotencyKeyMinChars ||
          key.length > PROTOCOL_LIMITS.idempotencyKeyMaxChars)
      ) {
        throw new ProtocolError(
          'VALIDATION_ERROR',
          `idempotencyKey must be ${PROTOCOL_LIMITS.idempotencyKeyMinChars}–${PROTOCOL_LIMITS.idempotencyKeyMaxChars} characters`,
        );
      }
      if (options.expectedVersion !== undefined && !Number.isInteger(options.expectedVersion)) {
        throw new ProtocolError('VALIDATION_ERROR', 'expectedVersion must be an integer');
      }
    }
    if (LEDGER_WRAPPED_METHODS.includes(method) && options.idempotencyKey !== undefined) {
      // `protocol.md` §1: every `*` method honours the idempotency key. The two
      // methods whose effects own their own transaction keep their dedicated
      // ledger (see `sendMessageCommand`/`saveRequirement`); every other write is
      // recorded here in the same transaction as its answer (W9R1-04).
      return this.withCommandLedger(method, params, options, () =>
        this.dispatchUnwrapped(method, params, options),
      );
    }
    if (NON_TRANSACTIONAL_LEDGER_METHODS.includes(method) && options.idempotencyKey !== undefined) {
      return this.withNonTransactionalCommandLedger(method, params, options, () =>
        this.dispatchUnwrapped(method, params, options),
      );
    }
    return this.dispatchUnwrapped(method, params, options);
  }

  /**
   * Records one write command around `action` (W9R1-04).
   *
   * The ledger row and the command's own effects commit in one transaction, so a
   * crash cannot leave an accepted key without its recorded result. The backing
   * store is SQLite, so this nesting changes atomicity only, never durability.
   */
  private withCommandLedger(
    method: string,
    params: JsonObject,
    options: { readonly caller: WorkbenchCaller; readonly idempotencyKey?: string },
    action: () => unknown,
  ): unknown {
    const store = this.services.store;
    return withTransaction(store.db, () => {
      const key = options.idempotencyKey as string;
      const begun = store.commands.begin({
        subject: options.caller.subject,
        operation: method,
        key,
        payloadHash: sha256Of(params),
      });
      if (begun.kind === 'conflict') {
        throw new ProtocolError('IDEMPOTENCY_CONFLICT', begun.reason, {
          details: { idempotencyKey: key },
        });
      }
      if (begun.kind === 'replay') return begun.response;
      const reply = action();
      store.commands.complete(begun.commandId, reply ?? null);
      return reply;
    });
  }

  /**
   * Records one write command whose effect cannot share this transaction (W9R1-04).
   *
   * The ledger row is durably accepted before the effect runs, so a replay after a
   * lost response returns the recorded result instead of running the operation a
   * second time. A refused effect deletes its accepted row, so a key never pins a
   * failure and a retry with the same key is free to run again.
   */
  private withNonTransactionalCommandLedger(
    method: string,
    params: JsonObject,
    options: { readonly caller: WorkbenchCaller; readonly idempotencyKey?: string },
    action: () => unknown,
  ): unknown {
    const store = this.services.store;
    const key = options.idempotencyKey as string;
    const begun = store.commands.begin({
      subject: options.caller.subject,
      operation: method,
      key,
      payloadHash: sha256Of(params),
    });
    if (begun.kind === 'conflict') {
      throw new ProtocolError('IDEMPOTENCY_CONFLICT', begun.reason, {
        details: { idempotencyKey: key },
      });
    }
    if (begun.kind === 'replay') return begun.response;
    let reply: unknown;
    try {
      reply = action();
    } catch (error) {
      withTransaction(store.db, () => {
        store.db.prepare('DELETE FROM command WHERE id = ?').run(begun.commandId);
      });
      throw error;
    }
    withTransaction(store.db, () => {
      store.commands.complete(begun.commandId, reply ?? null);
    });
    return reply;
  }

  private dispatchUnwrapped(
    method: string,
    params: JsonObject,
    options: {
      readonly caller: WorkbenchCaller;
      readonly idempotencyKey?: string;
      readonly expectedVersion?: number;
      readonly projectId?: string;
    },
  ): unknown {
    switch (method) {
      // ----- project / conversation -----------------------------------------
      case 'projects':
      case 'project.list':
        return this.listProjects(params);
      case 'project.open':
        return this.openProject(params);
      case 'project.snapshot.get':
        return this.projectSnapshot();
      case 'conversation.list':
        return this.listConversations(params);
      case 'conversation.create':
        return this.createConversation(params, options);
      case 'conversation.get':
        return this.getConversation(params);
      case 'conversation.message.send':
        return this.sendMessageCommand(params, options);
      // ----- knowledge -------------------------------------------------------
      case 'knowledge.list':
        return this.listKnowledge(params);
      case 'knowledge.get':
        return this.getKnowledge(params);
      // ----- work / requirement / run ---------------------------------------
      case 'board':
        return this.board();
      case 'work.list':
        return this.listWorks(params);
      case 'work.get':
        return this.getWork(params);
      case 'work.control':
        return this.controlWork(params, options);
      case 'requirement.list':
        return this.listRequirements(params);
      case 'requirement.get':
        return this.getRequirement(params);
      case 'requirement.save':
        return this.saveRequirement(params, options, false);
      case 'requirement.save.retry':
        return this.saveRequirement(params, options, true);
      case 'requirement.continue':
        return this.continueRequirement(params);
      case 'run.list':
        return this.listRuns(params);
      case 'run.get':
        return this.getRun(params);
      // ----- artifacts -------------------------------------------------------
      case 'artifact.list':
        return this.listArtifacts(params);
      case 'artifact.get':
        return this.getArtifact(params);
      case 'artifact.download.prepare':
        return this.prepareDownload(params);
      // ----- inbox / agents / settings / config -----------------------------
      case 'inbox':
        return this.inbox();
      case 'agents':
        return this.agentsView();
      case 'settings':
        return this.settingsView();
      case 'config.get':
        return this.getConfig(params);
      case 'config.save':
        return this.saveConfig(params, options);
      case 'config.test':
        return this.testConfig(params);
      // ----- gates / findings / decisions -----------------------------------
      case 'plan.current':
        return this.currentPlan(params);
      case 'plan.approve':
        return this.approvePlan(params, options);
      case 'finding.submit':
        return this.submitFinding(params);
      case 'decision.resolve':
        return this.resolveDecision(params, options);
      // ----- backup / restore ------------------------------------------------
      case 'backup.run':
        return this.runBackup(params);
      case 'restore.run':
        return this.runRestore(params);
      // ----- i18n ------------------------------------------------------------
      case 'ui.translate':
        return this.translate(params);
      default:
        throw new ProtocolError('NOT_FOUND', `no protocol method named ${method}`, {
          details: { method },
        });
    }
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  private listProjects(params: JsonObject): unknown {
    const limit = boundedLimit(params['limit']);
    const filter = optionalString(params['filter']) ?? 'all';
    const rows = this.services.store.projects.list({ orderBy: 'updated_at DESC' });
    // `filter` narrows the navigation list; `recent`/`all` keep every open Project.
    const openOnly = filter === 'recent' || filter === 'all' ? false : true;
    const items = rows
      .filter(() => (filter === 'running' ? this.runningRunCount() > 0 : true))
      .filter((row) => (openOnly ? row.state === 'open' : true))
      .slice(0, limit)
      .map((row) => this.projectSummaryOf(row.id));
    return { items, nextCursor: null };
  }

  private openProject(params: JsonObject): unknown {
    const root = requiredString(params, 'root');
    const project = this.services.store.projects.find(this.projectId);
    if (project === undefined) {
      throw new ProtocolError('NOT_FOUND', `Project ${this.projectId} is not registered`);
    }
    // Identity normalisation is a real fact (`ARCHITECTURE.md` §4): a subdirectory
    // resolves to the repository root, and any other root belongs to a
    // ProjectRuntime this daemon does not hold, so it is NOT_FOUND rather than a
    // second Project invented on the wire.
    const normalized = normalizeRoot(root);
    const known = [project.root, project.gitRoot].filter(
      (candidate): candidate is string => candidate !== undefined,
    );
    if (!known.some((candidate) => normalizeRoot(candidate) === normalized)) {
      throw new ProtocolError(
        'NOT_FOUND',
        `root ${root} is not the Project this daemon has open (${project.root})`,
        { details: { root, projectId: this.projectId, openRoot: project.root } },
      );
    }
    return {
      status: 'applied',
      entityId: project.id,
      version: project.version,
      projectId: project.id,
      project,
      gitState: { gitRoot: project.gitRoot ?? null, head: project.head ?? null },
      trust: project.trust,
    };
  }

  private projectSnapshot(): unknown {
    const project = this.services.store.projects.find(this.projectId) ?? null;
    return {
      projectId: this.projectId,
      project,
      cursor: this.services.events.watermark(),
      counts: {
        conversations: this.services.store.conversations.count(),
        works: this.services.store.works.count(),
        requirements: this.services.store.requirements.count(),
        runs: this.services.store.runs.count(),
      },
    };
  }

  private listConversations(params: JsonObject): unknown {
    const limit = boundedLimit(params['limit']);
    const rows = this.services.store.conversations.list({ orderBy: 'updated_at DESC' });
    return {
      items: rows.slice(0, limit).map((conversation) => ({
        ...conversation,
        messageCount: this.services.store.messages.count('conversation_id = ?', [conversation.id]),
      })),
      nextCursor: null,
    };
  }

  /**
   * `conversation.create` — a new Chief conversation (`protocol.md` §3).
   *
   * `experience.md` §1 keeps creation and switching on the Chief page; the row is
   * the real one the Chief page then reads, so the control that calls this method
   * is never a dead button (AC-072).
   */
  private createConversation(
    params: JsonObject,
    options: { readonly caller: WorkbenchCaller },
  ): unknown {
    const store = this.services.store;
    const title = optionalString(params['title']) ?? 'Chief conversation';
    const focusWorkId = optionalString(params['focusWorkId']);
    if (focusWorkId !== undefined && store.works.find(focusWorkId) === undefined) {
      throw new ProtocolError('NOT_FOUND', `Work ${focusWorkId} does not exist`, {
        details: { focusWorkId },
      });
    }
    return withTransaction(store.db, () => {
      const conversation = store.conversations.insert({
        title,
        archived: false,
        ...(focusWorkId === undefined ? {} : { focusWorkId }),
      });
      store.events.append({
        name: 'conversation.created',
        entityId: conversation.id,
        entityVersion: conversation.version,
        data: {
          conversationId: conversation.id,
          title: conversation.title,
          focusWorkId: conversation.focusWorkId ?? null,
          ownerUserId: options.caller.userId,
        },
      });
      return {
        status: 'applied',
        entityId: conversation.id,
        version: conversation.version,
        conversationId: conversation.id,
        conversation,
      };
    });
  }

  private getConversation(params: JsonObject): unknown {
    const conversationId = requiredString(params, 'conversationId');
    const conversation = this.services.store.conversations.find(conversationId);
    if (conversation === undefined) {
      throw new ProtocolError('NOT_FOUND', `conversation ${conversationId} does not exist`);
    }
    const limit = boundedLimit(params['limit']);
    const messages = this.services.store.messages
      .list({ where: 'conversation_id = ?', params: [conversationId], orderBy: 'seq ASC' })
      .slice(-limit)
      .map((message) => {
        const body = this.services.store.messageBodies.find(message.bodyRef);
        return {
          ...message,
          // The body text is a user fact returned verbatim; the UI never
          // machine-translates it (`experience.md` §6).
          body: body === undefined ? null : this.readMessageBody(body.relativeBlobPath),
          translatable: false,
        };
      });
    return { conversation, messages, nextCursor: null };
  }

  private listKnowledge(params: JsonObject): unknown {
    const view = knowledgeView(params['view']);
    const projections = this.services.store.featureProjections.list({
      orderBy: 'revision ASC, feature_id ASC',
    });
    const revision =
      optionalString(params['revision']) ?? projections.at(-1)?.revision ?? 'working-tree';
    const rows = projections.filter((row) => row.revision === revision);
    const query = optionalString(params['query'])?.toLowerCase();
    const items = rows
      .map((row) => ({
        featureId: row.featureId,
        documentPath: row.documentPath,
        documentHash: row.documentHash,
        state: row.state,
        // The listing carries the projection fields so a client never has to guess
        // which key belongs to which of the three separated answers.
        fields: row.fields,
        relations: row.relations,
      }))
      .filter((item) =>
        query === undefined
          ? true
          : item.featureId.toLowerCase().includes(query) ||
            item.documentPath.toLowerCase().includes(query),
      );
    return {
      view,
      items,
      sourceRevision: revision,
      projectionState: rows.some((row) => row.state === 'stale') ? 'stale' : 'valid',
      unknown: this.knowledgeUnknowns(revision, rows.length),
      nextCursor: null,
    };
  }

  private getKnowledge(params: JsonObject): unknown {
    const featureId = requiredString(params, 'featureId');
    const view = knowledgeView(params['view']);
    const rows = this.services.store.featureProjections.list({
      where: 'feature_id = ?',
      params: [featureId],
      orderBy: 'revision ASC',
    });
    const row = rows.at(-1);
    if (row === undefined) {
      throw new ProtocolError('NOT_FOUND', `unknown feature ${featureId}`, {
        details: { featureId },
      });
    }
    if (view === 'work') {
      const workId = requiredString(params, 'workId');
      const work = this.services.store.works.find(workId);
      if (work === undefined) {
        throw new ProtocolError('NOT_FOUND', `Work ${workId} does not exist`);
      }
      const declared = Array.isArray(row.fields['featureRefs'])
        ? (row.fields['featureRefs'] as unknown[]).includes(featureId)
        : false;
      return {
        featureId,
        view,
        sourceRevision: row.revision,
        projectionState: row.state,
        baseRevision: work.baseRevision ?? null,
        // The overlay is a target and never changes the delivered answer
        // (`context.md` §3, `experience.md` §4).
        overlay: { workId, featureId, declared },
        delivered: this.featureView(row, 'delivered'),
        notDelivered: true,
        unknowns: [...this.knowledgeUnknowns(row.revision, rows.length), WORK_VIEW_UNKNOWN],
        sourceRefs: this.sourceRefsOf(row),
      };
    }
    return {
      ...this.featureView(row, view),
      unknowns: this.knowledgeUnknowns(row.revision, rows.length),
      sourceRefs: this.sourceRefsOf(row),
    };
  }

  /**
   * The board projection (`experience.md` §4, AC-068).
   *
   * Requirements are read by their own id — no copied object — L1/report-only work
   * stays out of the board, and a Queued requirement with no local Work is still
   * cancellable while a pause on it is refused by `work.control`.
   */
  private board(): unknown {
    const requirements = this.services.store.requirements.list({ orderBy: 'created_at ASC' });
    const columns: Record<string, unknown[]> = {
      queued: [],
      active: [],
      completed: [],
      archived: [],
    };
    for (const requirement of requirements) {
      const work =
        requirement.workId === undefined
          ? undefined
          : this.services.store.works.find(requirement.workId);
      const card = {
        requirementId: requirement.id,
        // The same Requirement id is always the board identity: the execution Work
        // is a projection of it, never a second object (`AC-068`).
        identity: requirement.id,
        title: requirement.title,
        goal: requirement.goal,
        lifecycle: requirement.lifecycle,
        previousLifecycle: requirement.previousLifecycle ?? null,
        phase: requirement.phase ?? null,
        recordVersion: requirement.recordVersion,
        portableRef: requirement.portableRef,
        executionAvailability: requirement.executionAvailability,
        evidenceAvailability: requirement.evidenceAvailability,
        saveState: this.saveStateOf(requirement.id),
        work:
          work === undefined
            ? null
            : {
                id: work.id,
                status: work.status,
                level: work.level,
                intent: work.intent,
                blockers: [...work.blockerIds],
              },
        tasks: work === undefined ? emptyTaskCounts() : this.taskCounts(work.id),
        awaitingDecision: work === undefined ? 0 : this.pendingDecisionCount(work.id),
        // A Queued requirement without local Work can be cancelled from the board;
        // pause is refused with INVALID_STATE (`AC-068`).
        canCancelWithoutWork: work === undefined && requirement.lifecycle === 'queued',
        canPause: work !== undefined,
      };
      if (requirement.lifecycle === 'queued') columns['queued']?.push(card);
      else if (requirement.lifecycle === 'active') columns['active']?.push(card);
      else if (requirement.lifecycle === 'completed') columns['completed']?.push(card);
      else columns['archived']?.push(card);
    }
    // Independent L1 / assist work never enters the board; it is visible in Chief
    // and Runs only (`experience.md` §4).
    const excluded = this.services.store.works
      .list({ orderBy: 'created_at ASC' })
      .filter((work) => work.level === 'L1' || work.level === 'none');
    return {
      columns,
      requirementIds: requirements.map((requirement) => requirement.id),
      excludedWorkIds: excluded.map((work) => work.id),
      rule: {
        l1NotOnBoard: true,
        queuedWithoutWorkCancellable: true,
        pauseQueuedWithoutWork: 'INVALID_STATE',
      },
    };
  }

  private listWorks(params: JsonObject): unknown {
    const limit = boundedLimit(params['limit']);
    const filter = optionalString(params['filter']);
    const rows = this.services.store.works.list({ orderBy: 'created_at DESC' });
    const items = rows
      .filter((work) => (filter === undefined ? true : work.status === filter))
      .slice(0, limit)
      .map((work) => ({
        ...work,
        taskCounts: this.taskCounts(work.id),
        runCount: this.services.store.runs.count('work_id = ?', [work.id]),
      }));
    return { items, nextCursor: null };
  }

  private getWork(params: JsonObject): unknown {
    const workId = requiredString(params, 'workId');
    const work = this.services.store.works.find(workId);
    if (work === undefined) {
      throw new ProtocolError('NOT_FOUND', `Work ${workId} does not exist`);
    }
    return {
      work,
      tasks: this.services.store.tasks.list({ where: 'work_id = ?', params: [workId] }),
      runs: this.services.store.runs.list({
        where: 'work_id = ?',
        params: [workId],
        orderBy: 'created_at ASC',
      }),
      assessment:
        this.services.store.assessments
          .list({ where: 'work_id = ?', params: [workId], orderBy: 'created_at ASC' })
          .at(-1) ?? null,
      requirement:
        work.requirementId === undefined
          ? null
          : (this.services.store.requirements.find(work.requirementId) ?? null),
    };
  }

  private listRequirements(params: JsonObject): unknown {
    const limit = boundedLimit(params['limit']);
    const lifecycle = optionalString(params['lifecycle']);
    const rows = this.services.store.requirements.list({ orderBy: 'created_at DESC' });
    const items = rows
      .filter((row) => (lifecycle === undefined ? true : row.lifecycle === lifecycle))
      .slice(0, limit)
      // `protocol.md` §8: the list carries metadata and the portable ref, never the
      // long Markdown body.
      .map((row) => this.requirementSummary(row));
    return { items, nextCursor: null };
  }

  private getRequirement(params: JsonObject): unknown {
    const requirementId = requiredString(params, 'requirementId');
    const row = this.services.store.requirements.find(requirementId);
    if (row === undefined) {
      throw new ProtocolError('NOT_FOUND', `Requirement ${requirementId} does not exist`);
    }
    const work = row.workId === undefined ? undefined : this.services.store.works.find(row.workId);
    return {
      ...row,
      work: work ?? null,
      saveState: this.saveStateOf(row.id),
      // An imported active record with no local site is honestly "waiting to
      // continue"; it has no Run (`experience.md` §4, `AC-089`).
      waitingToContinue: row.workId === undefined && row.lifecycle === 'active',
      continuationCandidates: this.continuableIds(),
    };
  }

  private listRuns(params: JsonObject): unknown {
    const workId = requiredString(params, 'workId');
    const rows = this.services.store.runs.list({
      where: 'work_id = ?',
      params: [workId],
      orderBy: 'created_at ASC',
    });
    return {
      items: rows.map((run) => ({
        ...run,
        attempts: this.services.store.attempts.list({
          where: 'run_id = ?',
          params: [run.id],
          orderBy: 'number ASC',
        }),
      })),
      nextCursor: null,
    };
  }

  private getRun(params: JsonObject): unknown {
    const runId = requiredString(params, 'runId');
    const run = this.services.store.runs.find(runId);
    if (run === undefined) {
      throw new ProtocolError('NOT_FOUND', `Run ${runId} does not exist`);
    }
    return {
      run,
      attempts: this.services.store.attempts.list({
        where: 'run_id = ?',
        params: [runId],
        orderBy: 'number ASC',
      }),
      stageResults: this.services.store.stageResults.list({
        where: 'run_id = ?',
        params: [runId],
        orderBy: 'created_at ASC',
      }),
      task: run.taskId === undefined ? null : (this.services.store.tasks.find(run.taskId) ?? null),
    };
  }

  private listArtifacts(params: JsonObject): unknown {
    const workId = requiredString(params, 'workId');
    const artifacts = this.services.artifacts.list(workId);
    const latestByKind = new Map<string, number>();
    for (const artifact of artifacts) {
      const current = latestByKind.get(artifact.kind) ?? 0;
      if (artifact.artifactVersion > current) {
        latestByKind.set(artifact.kind, artifact.artifactVersion);
      }
    }
    return {
      items: artifacts.map((artifact) => ({
        ...artifact,
        // History is never presented as current without the version it belongs to
        // (`experience.md` §3, AC-070).
        isLatest: latestByKind.get(artifact.kind) === artifact.artifactVersion,
        versionCount: artifacts.filter((item) => item.kind === artifact.kind).length,
      })),
      nextCursor: null,
    };
  }

  private getArtifact(params: JsonObject): unknown {
    const artifactId = requiredString(params, 'artifactId');
    const version = optionalInteger(params['artifactVersion']);
    const role = optionalString(params['role']) ?? 'chief';
    const artifact = this.services.artifacts.get(artifactId, version);
    if (!isRole(role) || !this.services.artifacts.isReadable(artifact, role)) {
      throw new ProtocolError('NOT_AUTHORIZED', 'the artifact is not readable by this role', {
        details: { artifactId, role },
      });
    }
    const chain = this.services.artifacts
      .list(artifact.workId)
      .filter((item) => item.kind === artifact.kind);
    return {
      artifact,
      latestVersion: chain.at(-1)?.artifactVersion ?? artifact.artifactVersion,
      versions: chain.map((item) => ({
        artifactId: item.id,
        artifactVersion: item.artifactVersion,
        createdAt: item.createdAt,
        validity: item.validity,
      })),
      // The preview contract: a truncated inline body always advertises the
      // download path (`experience.md` §3).
      preview: {
        href: `/artifacts/${artifact.id}/preview`,
        downloadPrepare: { method: 'POST', path: '/artifacts/download.prepare' },
        maxInlineBytes: 1024 * 1024,
      },
    };
  }

  private prepareDownload(params: JsonObject): unknown {
    const artifactId = requiredString(params, 'artifactId');
    const version = optionalInteger(params['artifactVersion']);
    const artifact = this.services.artifacts.get(artifactId, version);
    if (!this.services.artifacts.isReadable(artifact, 'chief')) {
      throw new ProtocolError('NOT_AUTHORIZED', 'the artifact is not readable by this role');
    }
    this.services.tokens.prune();
    const grant = this.services.tokens.issue(artifact);
    return {
      status: 'applied',
      entityId: artifact.id,
      version: artifact.version,
      artifactId: grant.artifactId,
      artifactVersion: grant.artifactVersion,
      downloadToken: grant.token,
      expiresAt: grant.expiresAt,
      validity: artifact.validity,
    };
  }

  /**
   * The Inbox: pending decisions, blocking findings and recovery waits.
   *
   * `experience.md` §5 deduplicates by target + version, so a decision seen in many
   * events is one row, an expired target is not actionable, and non-blocking
   * findings are summarised rather than listed as blocking items.
   */
  private inbox(): unknown {
    const items: unknown[] = [];
    const seen = new Set<string>();
    for (const decision of this.services.store.decisions.list({ orderBy: 'created_at ASC' })) {
      const key = `decision:${decision.targetRef.id}:${decision.targetRef.version}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({
        kind: 'decision',
        id: decision.id,
        workId: decision.workId,
        decisionKind: decision.kind,
        targetRef: decision.targetRef,
        targetVersion: decision.targetRef.version,
        choices: [...decision.choices],
        state: decision.state,
        // An already resolved/expired target stays visible but must not be applied
        // again (`experience.md` §5).
        actionable: decision.state === 'pending',
        createdAt: decision.createdAt,
      });
    }
    const findings = new Map<string, { count: number; workId: string; severity: string }>();
    for (const finding of this.services.store.findings.list({ orderBy: 'created_at ASC' })) {
      if (!finding.blocking) continue;
      if (finding.state === 'verified' || finding.state === 'accepted_risk') continue;
      const key = `finding:${finding.workId}:${finding.severity}`;
      const existing = findings.get(key);
      if (existing === undefined) {
        findings.set(key, { count: 1, workId: finding.workId, severity: finding.severity });
      } else {
        existing.count += 1;
      }
    }
    for (const [key, summary] of findings) {
      items.push({
        kind: 'finding',
        id: key,
        workId: summary.workId,
        severity: summary.severity,
        // "内部修复汇总" — one row per Work+severity with the true count.
        count: summary.count,
        actionable: true,
      });
    }
    for (const run of this.services.store.runs.list({ orderBy: 'created_at ASC' })) {
      if (run.status !== 'recovery_required') continue;
      items.push({
        kind: 'recovery',
        id: run.id,
        workId: run.workId,
        runId: run.id,
        status: run.status,
        actionable: true,
      });
    }
    const actionable = items.filter(
      (item) => (item as { actionable?: boolean }).actionable === true,
    ).length;
    return { items, unread: actionable };
  }

  /** The eight roles with their effective configuration and its provenance. */
  private agentsView(): unknown {
    const config = this.services.config;
    const global = config?.global();
    const project = config?.project();
    const roles = ROLES.map((role) => {
      const resolution = config?.resolve(role);
      return {
        role,
        profile:
          resolution !== undefined && resolution.ok
            ? {
                ...resolution.resolution.profile,
                effectiveContextLimit: resolution.resolution.effectiveContextLimit,
                providerId: resolution.resolution.provider.providerId,
                modelId: resolution.resolution.model.id,
                model: resolution.resolution.model,
                revision: resolution.resolution.revision,
                // `agents.md` §5 inheritance provenance, per field.
                sources: resolution.resolution.sources,
              }
            : null,
        usable: resolution === undefined ? null : resolution.ok,
        unavailableReason: resolution !== undefined && !resolution.ok ? resolution.reason : null,
        overrides: { ...(project?.roleProfiles[role] ?? {}) },
        defaultProfile: global?.defaultProfile ?? null,
      };
    });
    return {
      roles,
      limits: config?.effectiveLimits() ?? null,
      providers: (global?.providers ?? []).map((provider) => ({
        providerId: provider.providerId,
        type: provider.type,
        baseUrl: provider.baseUrl,
        enabled: provider.enabled,
        // A secret value is never echoed; only whether one is configured.
        secretConfigured: provider.secretRef !== undefined,
        models: provider.models.map((model) => model.id),
      })),
      activeRuns: this.runningRunCount(),
    };
  }

  /** `config.get`: one scope's document plus its revision. */
  private getConfig(params: JsonObject): unknown {
    const config = this.requireConfig();
    const scope = configScope(params['scope']);
    const document = scope === 'global' ? config.global() : config.project();
    return {
      scope,
      version: document.version,
      revision: config.versionOf(scope),
      // `protocol.md` §5: providers exist only in the global scope, and a secret
      // value is never echoed — only whether one is configured.
      providers:
        scope === 'global'
          ? document.providers.map((provider) => ({
              ...provider,
              secretRef: provider.secretRef ?? null,
              secretConfigured: provider.secretRef !== undefined,
            }))
          : undefined,
      defaultProfile: document.defaultProfile ?? null,
      roleProfiles: document.roleProfiles,
      limits: document.limits,
      effectiveLimits: config.effectiveLimits(),
      policy: document.policy,
    };
  }

  /** Settings = the workbench's own state, kept separate from Project config. */
  private settingsView(): unknown {
    const config = this.services.config;
    return {
      projectId: this.projectId,
      // The config revision the page displays is the real one, so "unsaved" and
      // "stale" states are never guessed.
      configRevision: config === undefined ? null : config.versionOf('global'),
      projectConfigRevision: config === undefined ? null : config.versionOf('project'),
      // The installation token is shown exactly once at install time and never
      // re-readable through the API (`protocol.md` §2).
      installerTokenVisible: false,
      deployment: { transport: 'loopback', httpsRequired: false },
    };
  }

  // -------------------------------------------------------------------------
  // Commands
  // -------------------------------------------------------------------------

  /**
   * `conversation.message.send` — the same transactional path the HTTP route uses.
   *
   * The message, its Work, the attachment bindings, the user artifacts, the
   * command-ledger entry and the `message.received` event commit together; a
   * failure leaves every upload staged so the client can retry with the same ids.
   */
  private sendMessageCommand(
    params: JsonObject,
    options: { readonly caller: WorkbenchCaller; readonly idempotencyKey?: string },
  ): JsonObject {
    const conversationId = requiredString(params, 'conversationId');
    const body = requiredString(params, 'body');
    const attachmentIds = stringArray(params['attachmentIds']);
    const targetWorkId = optionalString(params['targetWorkId']);
    const commandParams: JsonObject = {
      conversationId,
      body,
      attachmentIds,
      ...(targetWorkId === undefined ? {} : { targetWorkId }),
    };
    const store = this.services.store;
    return withTransaction(store.db, () => {
      let commandId: string | undefined;
      if (options.idempotencyKey !== undefined) {
        const begun = store.commands.begin({
          subject: options.caller.subject,
          operation: 'conversation.message.send',
          key: options.idempotencyKey,
          payloadHash: sha256Of(commandParams),
        });
        if (begun.kind === 'conflict') {
          throw new ProtocolError('IDEMPOTENCY_CONFLICT', begun.reason, {
            details: { idempotencyKey: options.idempotencyKey },
          });
        }
        if (begun.kind === 'replay') return begun.response as JsonObject;
        commandId = begun.commandId;
      }
      const sent = sendMessage(
        {
          projectId: this.projectId,
          store,
          attachments: this.services.attachments,
          artifacts: this.services.artifacts,
          blobs: this.services.blobs,
          now: this.now,
        },
        {
          conversationId,
          body,
          attachmentIds,
          ...(targetWorkId === undefined ? {} : { targetWorkId }),
          ownerUserId: options.caller.userId,
          acl: [options.caller.role],
        },
      );
      const reply: JsonObject = {
        messageId: sent.messageId,
        workId: sent.workId,
        workIds: [...sent.workIds],
        authorizationId: sent.authorizationId,
        state: sent.state,
        version: sent.version,
      };
      store.events.append({
        name: 'message.received',
        entityId: sent.messageId,
        entityVersion: sent.version,
        data: {
          messageId: sent.messageId,
          workId: sent.workId,
          workIds: [...sent.workIds],
          authorizationId: sent.authorizationId,
          attachmentIds: [...sent.attachmentIds],
          artifactIds: [...sent.artifactIds],
        },
      });
      if (commandId !== undefined) store.commands.complete(commandId, reply);
      return reply;
    });
  }

  /**
   * `work.control` — pause / resume / cancel / continue.
   *
   * Every branch calls the real Core service, so a Queued requirement with no Work
   * is cancellable while a pause on it is refused with `INVALID_STATE` (`AC-068`),
   * and a `needs_replan` continuation goes through `RequirementContinuation` (a new
   * Work plus a real local authorization).
   */
  private controlWork(params: JsonObject, options: { readonly expectedVersion?: number }): unknown {
    const action = requiredString(params, 'action');
    const reason = optionalString(params['reason']) ?? '';
    const operationId = optionalString(params['operationId']) ?? this.services.store.newId();
    switch (action) {
      case 'pause': {
        const workId = optionalString(params['workId']);
        if (workId === undefined) {
          // A Queued requirement with no local Work has nothing to pause; saying so
          // is the documented INVALID_STATE rather than a silent success.
          const requirementId = optionalString(params['requirementId']);
          if (
            requirementId !== undefined &&
            this.services.store.requirements.find(requirementId) !== undefined
          ) {
            throw new ProtocolError(
              'INVALID_STATE',
              `Requirement ${requirementId} has no local Work to pause`,
              { details: { requirementId, action } },
            );
          }
          throw new ProtocolError('VALIDATION_ERROR', 'work.control pause needs workId', {
            details: { preservedInput: params },
          });
        }
        const result = this.requireFindings().pauseWork({
          workId,
          ...(reason === '' ? {} : { reason }),
        });
        if (!result.ok) {
          throw new ProtocolError(result.code, result.message, {
            details: { workId, recoveryRunIds: [...result.recoveryRunIds] },
          });
        }
        return {
          status: 'accepted',
          operationId,
          workId,
          version: result.work.version,
          previousStatus: result.previousStatus,
          pausedRunIds: result.pausedRuns.map((run) => run.runId),
          heldRunIds: [...result.heldRunIds],
          attemptsClosed: result.attemptsClosed,
        };
      }
      case 'resume': {
        const workId = requiredString(params, 'workId');
        const work = this.services.store.works.find(workId);
        if (work === undefined) {
          throw new ProtocolError('NOT_FOUND', `Work ${workId} does not exist`);
        }
        // The command's `expectedVersion` is the target Work's version, so a stale
        // one is the documented conflict rather than a generic state refusal
        // (`protocol.md` §1 "版本冲突返回VERSION_CONFLICT和currentVersion").
        const expected = options.expectedVersion ?? work.version;
        if (expected !== work.version) {
          // The caller's Work version is stale; re-reading is the documented next
          // step, so this is an explicit conflict carrying the live version
          // (`protocol.md` §1) rather than a generic state refusal.
          throw new ProtocolError(
            'VERSION_CONFLICT',
            `Work ${workId} is at version ${work.version}, not ${expected}`,
            { details: { workId, currentVersion: work.version, requestedVersion: expected } },
          );
        }
        const result = this.requireFindings().resumeWork({
          workId,
          expectedWorkVersion: expected,
        });
        if (!result.ok) {
          throw new ProtocolError(result.code, result.message, {
            details: { workId, currentVersion: result.currentVersion },
          });
        }
        return {
          status: 'accepted',
          operationId,
          workId,
          version: result.work.version,
          attempts: result.attempts.map((attempt) => ({ ...attempt })),
        };
      }
      case 'cancel': {
        const requirementId = optionalString(params['requirementId']);
        if (requirementId !== undefined && optionalString(params['workId']) === undefined) {
          return this.cancelRequirement(requirementId, reason, operationId, params);
        }
        const workId = requiredString(params, 'workId');
        const result = this.requireFindings().cancelWork({
          workId,
          ...(reason === '' ? {} : { reason }),
          ...(params['sideEffectsUnknown'] === true ? { sideEffectsUnknown: true } : {}),
        });
        if (!result.ok) {
          throw new ProtocolError(result.code, result.message, { details: { workId } });
        }
        return {
          status: 'accepted',
          operationId,
          workId,
          version: result.work.version,
          workStatus: result.status,
          cancelledRunIds: [...result.cancelledRunIds],
          preservedArtifactIds: [...result.preservedArtifactIds],
          requirementStatus: result.requirementStatus,
          recoveryRequired: result.recoveryRequired,
          recoveryDecisionId: result.recoveryDecisionId,
        };
      }
      case 'continue':
        return this.continueRequirement(params);
      default:
        throw new ProtocolError('VALIDATION_ERROR', `unknown work.control action ${action}`, {
          details: { action, accepted: ['pause', 'resume', 'cancel', 'continue'] },
        });
    }
  }

  /**
   * Cancels a Queued requirement that has no local Work (`AC-068`).
   *
   * The Git record is the authority, so the local projection is updated only
   * through the real record service; without it the daemon refuses rather than
   * pretending the Git record changed.
   */
  private cancelRequirement(
    requirementId: string,
    reason: string,
    operationId: string,
    params: JsonObject,
  ): JsonObject {
    const requirement = this.services.store.requirements.find(requirementId);
    if (requirement === undefined) {
      throw new ProtocolError('NOT_FOUND', `Requirement ${requirementId} does not exist`);
    }
    if (requirement.workId !== undefined) {
      throw new ProtocolError(
        'INVALID_STATE',
        `Requirement ${requirementId} has local Work ${requirement.workId}; cancel the Work instead`,
        { details: { requirementId, workId: requirement.workId } },
      );
    }
    if (requirement.lifecycle !== 'queued') {
      throw new ProtocolError(
        'INVALID_STATE',
        `Requirement ${requirementId} is ${requirement.lifecycle}; only a Queued requirement cancels here`,
        { details: { requirementId, lifecycle: requirement.lifecycle } },
      );
    }
    const saves = this.services.requirementSaves;
    if (saves === undefined) {
      throw new ProtocolError(
        'INVALID_STATE',
        'requirement cancellation needs the Git record service, which is not wired on this daemon',
        { details: { requirementId } },
      );
    }
    const now = this.services.store.now();
    const outcome = saves.save({
      operationId,
      metadata: {
        schemaVersion: 1,
        id: requirement.id,
        version: requirement.recordVersion + 1,
        contentFile: 'content.md',
        createdAt: requirement.createdAt,
        updatedAt: now,
        title: requirement.title,
        goal: requirement.goal,
        scope: emptyScope(),
        lifecycle: 'cancelled',
        featureIds: [],
        acceptance: [],
        openQuestions: [],
        confirmedDecisions: [],
        relatedRequirementIds: [],
        cancellation: { cancelledAt: now, reason: reason === '' ? '用户取消' : reason },
      },
      contentMarkdown: canonicalRequirementContent({
        title: requirement.title,
        goal: requirement.goal,
        completion: reason === '' ? '用户取消' : reason,
      }),
      expected: {
        recordVersion: requirement.recordVersion,
        recordHash: requirement.portableRef.hash,
      },
      sourceRef: this.sourceRefOf(params, 'action'),
      kind: 'cancel',
    });
    if (!outcome.ok) {
      throw new ProtocolError(outcome.code, outcome.message, {
        details: {
          requirementId,
          reasons: [...outcome.reasons],
          branchUntouched: outcome.branchUntouched,
          recovery: jsonSafe(outcome.operation ?? null),
        },
      });
    }
    return {
      status: 'accepted',
      operationId,
      version: outcome.row.version,
      requirementId: outcome.requirementId,
      lifecycle: outcome.row.lifecycle,
      git: jsonSafe(outcome.git),
    };
  }

  /**
   * `requirement.save` / `requirement.save.retry`.
   *
   * Git is written first and the projection follows, so this answers only after the
   * real service reports the save (`AC-090/AC-093`). A refused save keeps the
   * caller's input in the error `details`, and the retry path names the original
   * `operationId` (`protocol.md` §8).
   */
  private saveRequirement(
    params: JsonObject,
    options: { readonly idempotencyKey?: string },
    retry: boolean,
  ): JsonObject {
    const saves = this.services.requirementSaves;
    if (saves === undefined) {
      throw new ProtocolError(
        'INVALID_STATE',
        'requirement.save needs the Git record service, which is not wired on this daemon',
      );
    }
    if (retry) {
      const operationId = requiredString(params, 'operationId');
      const existing = this.services.store.operations.find(operationId);
      if (existing === undefined) {
        throw new ProtocolError('NOT_FOUND', `operation ${operationId} does not exist`, {
          details: { operationId },
        });
      }
      if (existing.state === 'completed') {
        // A retry of an already-completed save is idempotent: it reports the
        // current state instead of creating a second Requirement (`protocol.md` §8).
        const row = this.services.store.requirements.find(existing.requirementId ?? '');
        return {
          status: 'applied',
          entityId: row?.id ?? operationId,
          version: row?.version ?? 1,
          requirementId: row?.id ?? null,
          saveState: 'saved',
          reusedCommit: true,
          retry: true,
          idempotent: true,
        };
      }
      const stored = existing.stepResults as Record<string, unknown>;
      const original = stored['input'] as Parameters<RequirementSaveService['save']>[0] | undefined;
      if (original === undefined) {
        throw new ProtocolError(
          'INVALID_STATE',
          `operation ${operationId} has no recorded input to retry`,
          { details: { operationId } },
        );
      }
      // The original payload is replayed unchanged: a retry may not silently change
      // what is being saved (`protocol.md` §8 "旧payload不能重放为新内容").
      return this.requirementSaveResult(saves.retry(original), operationId, params, true);
    }

    const requirementId = optionalString(params['requirementId']);
    const patch = objectField(params, 'patch');
    const sourceMessageId = optionalString(params['sourceMessageId']);
    const existing =
      requirementId === undefined
        ? undefined
        : this.services.store.requirements.find(requirementId);
    if (requirementId !== undefined && existing === undefined) {
      throw new ProtocolError('NOT_FOUND', `Requirement ${requirementId} does not exist`, {
        details: { requirementId, preservedInput: params },
      });
    }
    if (patch['contentMarkdown'] === undefined && existing === undefined) {
      throw new ProtocolError('VALIDATION_ERROR', 'a new requirement needs contentMarkdown', {
        details: { preservedInput: params },
      });
    }
    const now = this.services.store.now();
    const operationId =
      options.idempotencyKey ??
      optionalString(params['operationId']) ??
      this.services.store.newId();
    // A new record's identity is server-created; the client cannot choose it
    // (`protocol.md` §8 "version、contentFile及Hash由Core维护").
    const id = existing?.id ?? this.services.store.newId();
    // A patch that names no scope keeps the empty envelope: a Requirement row has no
    // scope field, so an unnamed scope must never be filled from `sourceRef`, which
    // is a source reference and not a `Scope` (T4 §4.2, W9R1-05).
    const requestedScope = patch['scope'] ?? existing?.sourceRef ?? emptyScope();
    const metadata = {
      schemaVersion: 1 as const,
      id,
      version: (existing?.recordVersion ?? 0) + 1,
      contentFile: 'content.md' as const,
      // `contentHash` is recomputed by the save service from the real body bytes;
      // a client cannot supply it (`protocol.md` §8).
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      title: stringOr(patch, 'title', existing?.title ?? ''),
      goal: stringOr(patch, 'goal', existing?.goal ?? ''),
      scope: isScope(requestedScope) ? requestedScope : emptyScope(),
      lifecycle: (optionalString(patch['lifecycle']) ?? existing?.lifecycle ?? 'queued') as
        'queued' | 'active' | 'completed' | 'cancelled' | 'archived',
      featureIds: stringArray(patch['featureIds']),
      acceptance: arrayField(patch, 'acceptance'),
      openQuestions: stringArray(patch['openQuestions']),
      confirmedDecisions: arrayField(patch, 'confirmedDecisions'),
      relatedRequirementIds: stringArray(patch['relatedRequirementIds']),
    };
    const contentMarkdown =
      optionalString(patch['contentMarkdown']) ?? `# ${metadata.title}\n\n${metadata.goal}\n`;
    const candidate: Parameters<RequirementSaveService['save']>[0] = {
      operationId,
      metadata: metadata as Parameters<RequirementSaveService['save']>[0]['metadata'],
      contentMarkdown,
      expected:
        existing === undefined
          ? { expectedAbsent: true }
          : { recordVersion: existing.recordVersion, recordHash: existing.portableRef.hash },
      sourceRef: this.sourceRefOf(params, sourceMessageId === undefined ? 'action' : 'message'),
      kind: existing === undefined ? 'create' : 'update',
    };
    return this.requirementSaveResult(saves.save(candidate), operationId, params, false);
  }

  private requirementSaveResult(
    outcome: ReturnType<RequirementSaveService['save']>,
    operationId: string,
    params: JsonObject,
    retry: boolean,
  ): JsonObject {
    if (!outcome.ok) {
      throw new ProtocolError(outcome.code, outcome.message, {
        details: {
          operationId,
          retry,
          reasons: [...outcome.reasons],
          branchUntouched: outcome.branchUntouched,
          recovery: jsonSafe(outcome.operation ?? null),
          // Preservation: a refused save still hands the caller's input back so a
          // validation failure never discards an edit.
          preservedInput: params,
        },
      });
    }
    return {
      status: 'applied',
      entityId: outcome.requirementId,
      version: outcome.row.version,
      requirementId: outcome.requirementId,
      recordVersion: outcome.recordVersion,
      recordHash: outcome.recordHash,
      contentHash: outcome.contentHash,
      saveState: 'saved',
      git: jsonSafe(outcome.git),
      portableRef: outcome.row.portableRef,
      reusedCommit: outcome.reusedCommit,
      retry,
    };
  }

  /** `requirement.continue`: turns an imported `needs_replan` record into new Work. */
  private continueRequirement(params: JsonObject): unknown {
    const continuation = this.requireContinuation();
    const requirementId = requiredString(params, 'requirementId');
    const requirement = this.services.store.requirements.find(requirementId);
    if (requirement === undefined) {
      throw new ProtocolError('NOT_FOUND', `Requirement ${requirementId} does not exist`);
    }
    // The continuation needs a real, local user source; a caller that names none
    // gets the action Core records for this very command (never a forged Agent one).
    const named = optionalString(params['authorizationRef']);
    const namedMessage = named === undefined ? undefined : this.services.store.messages.find(named);
    const authorizationRef =
      named === undefined
        ? this.recordUserAction('requirement.continue', requirementId, params).id
        : namedMessage === undefined
          ? named
          : named;
    const result = continuation.continueRequirement({
      requirementId,
      authorizationRef,
      ...(optionalString(params['goal']) === undefined ? {} : { goal: params['goal'] as string }),
      ...(params['scope'] === undefined ? {} : { scope: params['scope'] as Scope }),
      ...(optionalString(params['level']) === undefined
        ? {}
        : { level: params['level'] as 'L1' | 'L2' | 'L3' }),
    });
    if (!result.ok) {
      throw new ProtocolError(result.code, result.message, {
        details: { requirementId, gaps: [...result.gaps] },
      });
    }
    return {
      status: 'applied',
      entityId: result.requirement.id,
      version: result.requirement.version,
      requirementId: result.requirement.id,
      workId: result.work.id,
      authorizationId: result.authorization.id,
      unmetGates: result.unmetGates.map((gate) => ({ ...gate })),
      // Imported history is never reused as local verification (`AC-089`).
      reusedPreviousVerification: result.reusedPreviousVerification,
      reusedManifestIds: [...result.reusedManifestIds],
      requiresReplan: result.requiresReplan,
      firstGate: result.firstGate,
      waitingToContinue: false,
    };
  }

  /**
   * `plan.current` — the Plan a card may approve, read from the real gate.
   *
   * The workbench needs two things before it can call `plan.approve` without
   * guessing (`AC-070`, W9R1-01): the Plan body the gate approved and the local
   * authorization the Plan rests on. Both come from the gate's own approval record
   * and its artifact — never from a second copy — so a card that cannot obtain them
   * reports `approval.enabled=false` with the reason instead of sending a request
   * that must fail.
   */
  private currentPlan(params: JsonObject): unknown {
    const gates = this.requireGates();
    const workId = requiredString(params, 'workId');
    const work = this.services.store.works.find(workId);
    if (work === undefined) {
      throw new ProtocolError('NOT_FOUND', `Work ${workId} does not exist`);
    }
    const revision = optionalString(params['revision']) ?? work.baseRevision ?? 'working-tree';
    const approval = gates.getCurrentPlanApproval(workId, revision);
    const current = approval.current;
    const currentVersion = current?.planRef.version ?? 0;
    const requestedVersion = optionalInteger(params['planVersion']) ?? currentVersion;
    const requested = requestedVersion === currentVersion;
    const response: JsonObject = {
      workId,
      revision,
      currentVersion,
      requestedVersion,
      current: requested,
      // `approved` is the gate's own verdict: a `stale` record is visible but not
      // approvable, so the card must not treat it as live (W9R1-12).
      approved: approval.status === 'approved' && current !== undefined,
      gateStatus: approval.status,
      approvedVersion: current?.planRef.version ?? null,
      approvedAt: current?.approval.at ?? null,
      runId: this.planningRunIdOf(current?.planRef.id),
      authorizationId: null,
      plan: null,
      approval: {
        enabled: false,
        reason: null,
      },
    };
    if (current === undefined) {
      // No approved Plan for this revision: the card renders the gate's own
      // "missing" verdict instead of an approve button that cannot work.
      response['approval'] = {
        enabled: false,
        reason: 'the gate holds no approved Plan for this Work revision',
      };
      return response;
    }
    if (!requested) {
      response['approval'] = {
        enabled: false,
        reason: `Plan version ${requestedVersion} is not the current one (${currentVersion})`,
      };
      return response;
    }
    if (approval.status !== 'approved') {
      response['approval'] = {
        enabled: false,
        reason: `the gate no longer accepts the Plan of version ${currentVersion} (${approval.status})`,
      };
      return response;
    }
    // A legacy approval record that names no authorization leaves the card
    // unusable; saying so is better than approving the Plan with a fabricated ref.
    const authorizationRef =
      current.approval.authorizationRef === undefined || current.approval.authorizationRef === ''
        ? null
        : current.approval.authorizationRef;
    response['authorizationId'] = authorizationRef;
    const draft = this.readPlanBody(workId, current.planRef.id);
    if (draft === null) {
      response['approval'] = {
        enabled: false,
        reason: 'the Plan body could not be read back from the artifact store',
      };
      return response;
    }
    response['plan'] = draft;
    if (authorizationRef === null) {
      response['approval'] = {
        enabled: false,
        reason: 'the approved Plan records no local authorization envelope',
      };
      return response;
    }
    const authorization = this.services.store.authorizations.find(authorizationRef);
    if (authorization === undefined || authorization.workId !== workId) {
      response['approval'] = {
        enabled: false,
        reason: `the local authorization ${authorizationRef} is not readable for this Work`,
      };
      return response;
    }
    response['approval'] = { enabled: true, reason: null };
    return response;
  }

  /**
   * Reads one approved Plan artifact back into a submittable draft.
   *
   * The bytes are the canonical Plan JSON the gate hashed at approval, so the same
   * body re-approves as the next version instead of a re-typed approximation.
   */
  /**
   * The Planning Run that produced the approved Plan artifact.
   *
   * `submitPlan` re-reads the Run and refuses a Plan whose producer belongs to
   * another Work, so the card must name this real run instead of a placeholder.
   */
  private planningRunIdOf(artifactId: string | undefined): string | null {
    if (artifactId === undefined) return null;
    const artifact = this.services.store.artifacts.find(artifactId);
    if (artifact === undefined || artifact.runId === undefined) return null;
    const run = this.services.store.runs.find(artifact.runId);
    if (run === undefined || run.workId !== artifact.workId || run.role !== 'planning') return null;
    return run.id;
  }

  private readPlanBody(workId: string, artifactId: string): JsonObject | null {
    const artifact = this.services.store.artifacts.find(artifactId);
    if (artifact === undefined || artifact.kind !== 'plan' || artifact.workId !== workId) {
      return null;
    }
    let parsed: unknown;
    try {
      const bytes = this.services.artifacts.read(artifact);
      parsed = JSON.parse(Buffer.from(bytes).toString('utf8'));
    } catch {
      return null;
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    const plan = parsed as JsonObject;
    if (!Array.isArray(plan['tasks']) || plan['tasks'].length === 0) return null;
    if (typeof plan['goal'] !== 'string' || plan['goal'] === '') return null;
    return plan;
  }

  /**
   * `plan.approve` — approves a Plan through the real gate.
   *
   * An approval of a superseded version is refused with the version the user is
   * actually looking at, never applied to a different Plan (`AC-070`,
   * `experience.md` §3).
   */
  private approvePlan(
    params: JsonObject,
    options: { readonly expectedVersion?: number },
  ): JsonObject {
    const gates = this.requireGates();
    const workId = requiredString(params, 'workId');
    const work = this.services.store.works.find(workId);
    if (work === undefined) {
      throw new ProtocolError('NOT_FOUND', `Work ${workId} does not exist`);
    }
    const revision = optionalString(params['revision']) ?? work.baseRevision ?? 'working-tree';
    const current = gates.getCurrentPlanApproval(workId, revision);
    const requestedVersion =
      optionalInteger(params['planVersion']) ??
      options.expectedVersion ??
      current.current?.planRef.version ??
      0;
    // The gate is the authority for "this Plan is still the approved one"; the
    // version check here is what makes an expired card an explicit conflict.
    const liveVersion = current.current?.planRef.version ?? 0;
    if (requestedVersion !== liveVersion) {
      throw new ProtocolError(
        'VERSION_CONFLICT',
        `Plan version ${requestedVersion} is not the current one (${liveVersion})`,
        { details: { workId, currentVersion: liveVersion, requestedVersion } },
      );
    }
    const plan = parsePlanDraft(params['plan']);
    const approval = objectField(params, 'approval');
    const requestedTokens = optionalInteger(approval['requestedTokens']);
    const result = gates.submitPlan({
      workId,
      revision,
      plan,
      approval: {
        authorizationRef: requiredString(approval, 'authorizationRef'),
        runId: requiredString(approval, 'runId'),
        productChanged: approval['productChanged'] === true,
        at: optionalString(approval['at']) ?? this.services.store.now(),
        ...(requestedTokens === undefined ? {} : { requestedTokens }),
      },
    });
    if (!result.approved) {
      throw new ProtocolError(protocolCode(result.code), result.message, {
        details: {
          workId,
          gaps: [...result.gaps],
          decisionRequired: result.decisionRequired,
          currentVersion: liveVersion,
        },
      });
    }
    return {
      status: 'applied',
      entityId: result.planRef.id,
      version: result.planRef.version,
      planRef: result.planRef,
      approvalRecordHash: result.approvalRecordHash,
      revision: result.revision,
      currentVersion: result.planRef.version,
    };
  }

  /** `finding.submit` — records a Review/Test finding through the real service. */
  private submitFinding(params: JsonObject): unknown {
    const findings = this.requireFindings();
    const target = objectField(params, 'target');
    const result = findings.submitFinding({
      reviewRunId: requiredString(params, 'reviewRunId'),
      target: {
        targetKind: (optionalString(target['targetKind']) ?? 'task') as
          'task' | 'integration' | 'document',
        ...(optionalString(target['taskId']) === undefined
          ? {}
          : { taskId: target['taskId'] as string }),
        // The binding needs the resolved target version; the caller must name the
        // artifact/task ref it reviewed so the Finding cannot float free.
        targetRef: refField(target, 'targetRef'),
      },
      manifestRef: refField(params, 'manifestRef'),
      finding: {
        description: requiredString(params, 'description'),
        severity: requiredString(params, 'severity') as FindingSeverity,
        ...(typeof params['blocking'] === 'boolean' ? { blocking: params['blocking'] } : {}),
        ...(optionalString(params['path']) === undefined ? {} : { path: params['path'] as string }),
        ...(optionalInteger(params['line']) === undefined
          ? {}
          : { line: params['line'] as number }),
        ...(Array.isArray(params['evidenceRefs'])
          ? { evidenceRefs: stringArray(params['evidenceRefs']) }
          : {}),
      },
      ...(optionalString(params['taskId']) === undefined
        ? {}
        : { taskId: params['taskId'] as string }),
    });
    if (result.ok !== true) {
      throw new ProtocolError(result.code, result.message, {
        details: { gaps: [...result.gaps] },
      });
    }
    return {
      status: 'applied',
      entityId: result.finding.id,
      version: result.finding.version,
      finding: result.finding,
      binding: result.binding,
      routing: result.routing,
      invalidatedEvidenceRefs: [...result.invalidatedEvidenceRefs],
      returnedTaskIds: [...result.returnedTaskIds],
    };
  }

  /**
   * `decision.resolve` — records the user's choice on a pending decision.
   *
   * `experience.md` §5 / `AC-074`: the choice must be one the decision saved, the
   * target version must still be current, an expired decision can never be applied
   * again, and resolving twice with the same choice is idempotent.
   */
  private resolveDecision(
    params: JsonObject,
    options: { readonly expectedVersion?: number },
  ): JsonObject {
    const decisionId = requiredString(params, 'decisionId');
    const choice = requiredString(params, 'choice');
    const targetVersion = optionalInteger(params['targetVersion']) ?? options.expectedVersion;
    const decision = this.services.store.decisions.find(decisionId);
    if (decision === undefined) {
      throw new ProtocolError('NOT_FOUND', `Decision ${decisionId} does not exist`, {
        details: { decisionId },
      });
    }
    if (targetVersion !== undefined && targetVersion !== decision.targetRef.version) {
      throw new ProtocolError(
        'VERSION_CONFLICT',
        `Decision ${decisionId} targets version ${decision.targetRef.version}, not ${targetVersion}`,
        {
          details: {
            decisionId,
            currentVersion: decision.targetRef.version,
            requestedVersion: targetVersion,
          },
        },
      );
    }
    if (!decision.choices.includes(choice)) {
      throw new ProtocolError(
        'VALIDATION_ERROR',
        `choice ${choice} is not one of the saved options`,
        {
          details: { decisionId, choices: [...decision.choices] },
        },
      );
    }
    if (decision.state === 'expired') {
      throw new ProtocolError('INVALID_STATE', `Decision ${decisionId} has expired`, {
        details: { decisionId, state: decision.state, currentVersion: decision.targetRef.version },
      });
    }
    if (decision.state !== 'pending') {
      if (decision.choice === choice) {
        return {
          status: 'applied',
          entityId: decision.id,
          version: decision.version,
          state: decision.state,
          choice,
          effectRefs: [...decision.effectRefs],
          idempotent: true,
        };
      }
      throw new ProtocolError(
        'INVALID_STATE',
        `Decision ${decisionId} is already ${decision.state} as ${decision.choice ?? 'unknown'}`,
        { details: { decisionId, state: decision.state, choice: decision.choice ?? null } },
      );
    }
    // A product decision resolves through the behaviour branch, so the choice's real
    // effect (evidence invalidation, a queued Requirement) is applied by Core.
    if (
      decision.kind === 'product' &&
      this.services.decisions !== undefined &&
      isBehaviourChoice(choice)
    ) {
      const recorded = this.services.decisions.recordBehaviourDecision({
        workId: decision.workId,
        choice,
        summary: optionalString(params['summary']) ?? `user choice ${choice}`,
        decidedAt: optionalString(params['decidedAt']) ?? this.services.store.now(),
      });
      return {
        status: 'applied',
        entityId: recorded.decisionId,
        version:
          this.services.store.decisions.find(recorded.decisionId)?.version ?? decision.version,
        state: recorded.decisionState,
        choice: recorded.choice,
        effectRefs: [...recorded.invalidatedEvidenceRefs],
        newDecisionId: recorded.decisionId,
      };
    }
    const effectRefs = stringArray(params['effectRefs']);
    return withTransaction(this.services.store.db, () => {
      const updated = this.services.store.decisions.update(
        decision.id,
        { state: choice === 'decline' ? 'rejected' : 'accepted', choice, effectRefs },
        decision.version,
      );
      this.services.store.events.append({
        name: 'decision.resolved',
        entityId: updated.id,
        entityVersion: updated.version,
        data: {
          decisionId: updated.id,
          workId: updated.workId,
          kind: updated.kind,
          choice,
          state: updated.state,
          targetVersion: updated.targetRef.version,
          effectRefs: [...effectRefs],
        },
      });
      return {
        status: 'applied',
        entityId: updated.id,
        version: updated.version,
        state: updated.state,
        choice,
        effectRefs: [...effectRefs],
      };
    });
  }

  /**
   * `config.save` — validates the patch, then writes it and bumps the revision.
   *
   * A rejected patch leaves the active configuration untouched and returns the
   * caller's input in the error details (`AC-075`); a stale `expectedVersion` is a
   * `VERSION_CONFLICT` carrying the live revision.
   */
  private saveConfig(
    params: JsonObject,
    options: { readonly expectedVersion?: number },
  ): JsonObject {
    const config = this.requireConfig();
    const scope = configScope(params['scope']);
    const patch = objectField(params, 'patch');
    const expected = optionalInteger(params['expectedVersion']) ?? options.expectedVersion;
    const currentVersion = config.versionOf(scope);
    if (expected !== undefined && expected !== currentVersion) {
      throw new ProtocolError(
        'VERSION_CONFLICT',
        `config ${scope} revision is ${currentVersion}, not ${expected}`,
        { details: { scope, currentVersion, requestedVersion: expected, preservedInput: params } },
      );
    }
    try {
      const applied = config.update(scope, patch);
      return {
        status: 'applied',
        entityId: `${scope}:config`,
        version: applied.version,
        scope,
        revision: applied.version,
        previousVersion: currentVersion,
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'ConfigError') {
        // `ConfigStore.update` validates before it writes, so the active document
        // is provably unchanged when this branch is reached (`AC-075`).
        throw new ProtocolError('VALIDATION_ERROR', error.message, {
          details: { scope, currentVersion, preservedInput: params },
        });
      }
      throw error;
    }
  }

  /**
   * `config.test` — the provider stub.
   *
   * No model call is made: the documented behaviour under test is that an unusable
   * profile (missing provider, disabled provider, unsupported reasoning) is
   * reported clearly with the active configuration unchanged (`AC-075`).
   */
  private testConfig(params: JsonObject): unknown {
    const config = this.requireConfig();
    const role = (optionalString(params['role']) ?? 'chief') as Role;
    const resolution = config.resolve(role);
    const checkedAt = this.services.store.now();
    if (!resolution.ok) {
      throw new ProtocolError('PROVIDER_UNAVAILABLE', resolution.reason, {
        details: {
          role,
          reason: resolution.code,
          revision: config.versionOf('global'),
          preservedInput: params,
          checkedAt,
        },
      });
    }
    const { profile, model, provider, effectiveContextLimit, revision } = resolution.resolution;
    return {
      status: 'applied',
      entityId: provider.providerId,
      version: config.versionOf('global'),
      role,
      providerId: provider.providerId,
      modelId: model.id,
      reasoning: profile.reasoning,
      reasoningSupported: model.reasoningLevels.includes(profile.reasoning),
      effectiveContextLimit,
      revision,
      probe: 'capabilities-only',
      checkedAt,
    };
  }

  /** `backup.run` — a complete backup or an honest refusal. */
  private runBackup(params: JsonObject): unknown {
    const outputDir = requiredString(params, 'outputDir');
    const outcome = backupProject({
      store: this.services.store,
      git: this.backupGit,
      outputDir,
      replace: params['replace'] === true,
      ...(optionalString(params['documentRoot']) === undefined
        ? {}
        : { documentRoot: params['documentRoot'] as string }),
    });
    if (!outcome.ok) {
      throw new ProtocolError(outcome.code, outcome.message, {
        details: { reasons: [...outcome.reasons], incomplete: outcome.incomplete, outputDir },
      });
    }
    return {
      status: 'applied',
      entityId: outcome.backupId,
      version: 1,
      backupId: outcome.backupId,
      directory: outcome.directory,
      manifestPath: outcome.manifestPath,
      manifest: outcome.manifest,
      // A backup that could not include a Git bundle says so rather than claiming a
      // complete delivery snapshot.
      gitIncluded: outcome.manifest.git !== null,
    };
  }

  /** `restore.run` — verifies every hash before writing, then reports readiness. */
  private runRestore(params: JsonObject): unknown {
    const backupDir = requiredString(params, 'backupDir');
    const targetDir = requiredString(params, 'targetDir');
    const outcome = restoreProject({
      backupDir,
      targetDir,
      git: this.backupGit,
      replace: params['replace'] === true,
    });
    if (!outcome.ok) {
      throw new ProtocolError(outcome.code, outcome.message, {
        details: { reasons: [...outcome.reasons], partial: outcome.partial, backupDir, targetDir },
      });
    }
    return {
      status: 'applied',
      entityId: outcome.projectId,
      version: 1,
      projectId: outcome.projectId,
      restoredStatus: outcome.status,
      dataDir: outcome.dataDir,
      repoRoot: outcome.repoRoot,
      revision: outcome.revision,
      consistency: outcome.consistency,
      recovery: outcome.recovery,
      doctor: outcome.doctor,
      provider: outcome.provider,
    };
  }

  /**
   * `ui.translate` — the interface-string catalogue.
   *
   * `experience.md` §6: only the UI's own strings are translated; user messages,
   * project documents and Agent output are returned untouched and flagged
   * `translatable:false`, so project content is never auto-translated.
   */
  private translate(params: JsonObject): unknown {
    const resourceId = requiredString(params, 'resourceId');
    const locale = optionalString(params['locale']) ?? 'en';
    if (locale !== 'en' && locale !== 'zh') {
      throw new ProtocolError('VALIDATION_ERROR', `unsupported interface locale ${locale}`);
    }
    if (params['content'] !== undefined) {
      return {
        resourceId,
        translatable: false,
        source: 'project-content',
        targetLocale: locale,
        content: params['content'],
        reason: 'user messages, project documents and Agent output are never machine-translated',
      };
    }
    const entry = UI_STRINGS[resourceId];
    if (entry === undefined) {
      throw new ProtocolError('NOT_FOUND', `unknown interface string ${resourceId}`, {
        details: { resourceId },
      });
    }
    return {
      resourceId,
      translatable: true,
      source: 'interface',
      targetLocale: locale,
      content: locale === 'zh' ? entry.zh : entry.en,
      original: { en: entry.en, zh: entry.zh },
    };
  }

  // -------------------------------------------------------------------------
  // Event routing (called by the socket layer)
  // -------------------------------------------------------------------------

  /**
   * Delivers every pending event of one connection's subscriptions.
   *
   * The scan watermark is reported for an empty batch as well (`protocol.md` §2),
   * and a disconnect only drops the in-memory bookkeeping: the persistent events
   * stay in the log, so a reconnect replays exactly what was missed.
   */
  pollConnection(
    connection: ServerWebSocket,
    subscriptions: Map<string, SubscriptionRecord>,
  ): void {
    for (const subscription of [...subscriptions.values()]) {
      // The scan watermark is taken before the read, so a `batch_end` never claims
      // a cursor whose events were not handed over (`protocol.md` §2).
      const scannedThrough = this.services.events.watermark();
      let pending: Event[];
      try {
        pending = this.services.store.events
          .readAfter(subscription.cursor, { limit: 200 })
          .filter((event) => event.cursor <= scannedThrough)
          .filter((event) => matchesSubscription(event, subscription.scope));
      } catch (error) {
        connection.sendError(
          null,
          error instanceof ProtocolError
            ? error
            : new ProtocolError('RESYNC_REQUIRED', 'the subscription cursor was truncated', {
                details: { subscriptionId: subscription.id },
              }),
        );
        continue;
      }
      for (const event of pending) {
        connection.sendEvent(event);
        if (event.cursor > subscription.cursor) subscription.cursor = event.cursor;
      }
      // Every scan reports its watermark, an empty batch included.
      connection.sendRaw({
        type: 'batch_end',
        subscriptionId: subscription.id,
        scannedThrough,
      });
    }
  }

  /** Opens one subscription for a connection (`project.subscribe`). */
  subscribe(
    connection: ServerWebSocket,
    params: JsonObject,
    projectId: string | undefined,
    subscriptions: Map<string, SubscriptionRecord>,
  ): JsonObject {
    if (projectId !== undefined && projectId !== this.projectId) {
      // A cross-Project subscription is refused before any snapshot exists; the
      // details echo the requested id only, never this installation's own
      // (`protocol.md` §1, W9R1-03).
      throw new ProtocolError('NOT_FOUND', `Project ${projectId} is not open on this daemon`, {
        details: { projectId },
      });
    }
    const scope = params['scope'];
    if (typeof scope !== 'object' || scope === null || Array.isArray(scope)) {
      throw new ProtocolError('VALIDATION_ERROR', 'scope must be an object');
    }
    const afterCursor = params['afterCursor'];
    if (
      afterCursor !== undefined &&
      (typeof afterCursor !== 'number' || !Number.isInteger(afterCursor))
    ) {
      throw new ProtocolError('VALIDATION_ERROR', 'afterCursor must be an integer');
    }
    const typedScope = scope as { kind: 'summary' | 'conversation' | 'work' | 'run'; id?: string };
    // The hub owns snapshot consistency: a snapshot and its cursor come from one
    // watermark, and a resume from `afterCursor` answers `RESYNC_REQUIRED` when the
    // cursor was truncated. The connection keeps its own delivery watermark, so a
    // replayed event is never delivered twice (`AC-054`).
    const result = this.services.events.subscribe({
      connectionId: connection.connectionId,
      scope: typedScope,
      ...(afterCursor === undefined ? {} : { afterCursor }),
    });
    // A resume replays the events after `afterCursor`; a fresh subscribe starts at
    // the snapshot cursor because everything at or below it is already in the
    // snapshot.
    let watermark = afterCursor === undefined ? result.cursor : afterCursor;
    const record: SubscriptionRecord = {
      id: result.subscriptionId,
      scope: typedScope,
      cursor: watermark,
    };
    // One live subscription per (kind, id): a re-subscribe of the same scope
    // replaces the previous stream instead of leaving a second reader that would
    // replay the same events into the same connection (`AC-054`).
    for (const [id, existing] of [...subscriptions]) {
      if (sameScopeRecord(existing.scope, typedScope)) {
        subscriptions.delete(id);
        this.services.events.remove(id);
      }
    }
    subscriptions.set(result.subscriptionId, record);
    if (result.events !== undefined) {
      for (const event of result.events) {
        connection.sendEvent(event);
        if (event.cursor > watermark) watermark = event.cursor;
      }
      record.cursor = watermark;
    }
    connection.sendRaw({
      type: 'batch_end',
      subscriptionId: result.subscriptionId,
      scannedThrough: afterCursor === undefined ? result.cursor : watermark,
    });
    return {
      subscriptionId: result.subscriptionId,
      cursor: afterCursor === undefined ? result.cursor : watermark,
      mode: result.mode,
      ...(result.snapshot === undefined ? {} : { snapshot: result.snapshot }),
    };
  }

  /** `subscription.set` (`protocol.md` §2). */
  setScope(
    connection: ServerWebSocket,
    params: JsonObject,
    subscriptions: Map<string, SubscriptionRecord>,
  ): JsonObject {
    const subscriptionId = requiredString(params, 'subscriptionId');
    const existing = subscriptions.get(subscriptionId);
    if (existing === undefined) {
      throw new ProtocolError('NOT_FOUND', `subscription ${subscriptionId} does not exist`);
    }
    const scope = params['scope'];
    if (typeof scope !== 'object' || scope === null || Array.isArray(scope)) {
      throw new ProtocolError('VALIDATION_ERROR', 'scope must be an object');
    }
    const result = this.services.events.setScope(
      subscriptionId,
      scope as { kind: 'summary' | 'conversation' | 'work' | 'run'; id?: string },
    );
    // A scope change always answers a fresh snapshot, so the delivery watermark
    // moves to the snapshot cursor and the previous scope's events are not replayed
    // into the enlarged scope.
    existing.cursor = result.cursor;
    existing.scope = scope as { kind: string; id?: string };
    connection.sendRaw({ type: 'batch_end', subscriptionId, scannedThrough: result.cursor });
    return { subscriptionId, snapshot: result.snapshot, cursor: result.cursor };
  }

  /** `subscription.remove` (`protocol.md` §2). */
  removeSubscription(
    params: JsonObject,
    subscriptions: Map<string, SubscriptionRecord>,
  ): JsonObject {
    const subscriptionId = requiredString(params, 'subscriptionId');
    subscriptions.delete(subscriptionId);
    return { removed: this.services.events.remove(subscriptionId).removed };
  }

  /** `project.events.ack` (`protocol.md` §2). */
  ackCursor(params: JsonObject, subscriptions: Map<string, SubscriptionRecord>): JsonObject {
    const subscriptionId = requiredString(params, 'subscriptionId');
    const cursor = params['cursor'];
    if (typeof cursor !== 'number' || !Number.isInteger(cursor)) {
      throw new ProtocolError('VALIDATION_ERROR', 'cursor must be an integer');
    }
    const { acknowledged } = this.services.events.ack(subscriptionId, cursor);
    const existing = subscriptions.get(subscriptionId);
    if (existing !== undefined) existing.cursor = acknowledged;
    return { acknowledged };
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private runningRunCount(): number {
    return this.services.store.runs.count(
      "status IN ('running','starting','waiting_permission','waiting_children')",
    );
  }

  private projectSummaryOf(projectId: string): ProjectSummary {
    const project = this.services.store.projects.find(projectId);
    if (project === undefined) {
      throw new ProtocolError('NOT_FOUND', `Project ${projectId} does not exist`);
    }
    const resolution = this.services.config?.resolve('chief');
    return {
      projectId: project.id,
      name: basename(project.root),
      root: project.root,
      trust: project.trust,
      state: project.state,
      version: project.version,
      updatedAt: project.updatedAt,
      runningRuns: this.runningRunCount(),
      executionReady: resolution === undefined ? true : resolution.ok,
    };
  }

  private taskCounts(workId: string): JsonObject {
    const tasks = this.services.store.tasks.list({ where: 'work_id = ?', params: [workId] });
    return {
      total: tasks.length,
      done: tasks.filter((task) => task.stage === 'done').length,
      develop: tasks.filter((task) => task.stage === 'develop').length,
      review: tasks.filter((task) => task.stage === 'review').length,
      test: tasks.filter((task) => task.stage === 'test').length,
      ready: tasks.filter((task) => task.stage === 'ready').length,
    };
  }

  private pendingDecisionCount(workId: string): number {
    return this.services.store.decisions
      .list({ where: 'work_id = ?', params: [workId] })
      .filter((decision) => decision.state === 'pending').length;
  }

  private requirementSummary(row: {
    readonly id: string;
    readonly title: string;
    readonly goal: string;
    readonly lifecycle: string;
    readonly phase?: string | undefined;
    readonly workId?: string | undefined;
    readonly recordVersion: number;
    readonly portableRef: {
      readonly path: string;
      readonly revision: string;
      readonly hash: string;
    };
    readonly executionAvailability: string;
    readonly evidenceAvailability: string;
    readonly version: number;
    readonly createdAt: string;
    readonly updatedAt: string;
  }): JsonObject {
    return {
      id: row.id,
      title: row.title,
      goal: row.goal,
      lifecycle: row.lifecycle,
      phase: row.phase ?? null,
      workId: row.workId ?? null,
      recordVersion: row.recordVersion,
      portableRef: row.portableRef,
      executionAvailability: row.executionAvailability,
      evidenceAvailability: row.evidenceAvailability,
      waitingToContinue: row.workId === undefined && row.lifecycle === 'active',
      version: row.version,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      saveState: this.saveStateOf(row.id),
    };
  }

  /** The honest save state of one requirement (`protocol.md` §8). */
  private saveStateOf(requirementId: string): 'saved' | 'saving' | 'save_failed' {
    const operations = this.services.store.operations.list({
      where: 'requirement_id = ?',
      params: [requirementId],
      orderBy: 'created_at ASC',
    });
    const latest = operations.at(-1);
    if (latest === undefined) return 'saved';
    if (latest.state === 'completed') return 'saved';
    if (latest.state === 'failed') return 'save_failed';
    return 'saving';
  }

  /** Requirement ids this server imported as active and has not continued yet. */
  private continuableIds(): string[] {
    const continuation = this.services.requirements;
    if (continuation === undefined) return [];
    return continuation.listContinuable().items.map((item) => item.requirementId);
  }

  private featureView(
    row: { readonly fields: Record<string, unknown>; readonly relations: Record<string, unknown> },
    view: string,
  ): JsonObject {
    // The projection fields are contract JSON (`FeatureProjection.fields`), so the
    // serialisation round-trip only proves what the store already guarantees.
    return jsonSafe({
      view,
      fields: row.fields,
      design: row.fields['design'] ?? null,
      implementation: row.fields['implementation'] ?? null,
      verification: row.fields['verification'] ?? null,
      relations: row.relations,
    });
  }

  private sourceRefsOf(row: {
    readonly documentPath: string;
    readonly documentHash: string;
  }): SourceRef[] {
    return [
      {
        kind: 'git',
        id: row.documentPath,
        version: row.documentHash,
        path: row.documentPath,
        hash: row.documentHash,
      },
    ];
  }

  private knowledgeUnknowns(revision: string, featureCount: number): string[] {
    if (featureCount === 0) {
      return [
        `revision ${revision} 没有已发布的 feature 投影；先初始化或导入正式文档后才能回答（AC-025）`,
      ];
    }
    return [];
  }

  private readMessageBody(relativeBlobPath: string): string | null {
    try {
      return Buffer.from(this.services.blobs.read(relativeBlobPath)).toString('utf8');
    } catch {
      // A missing message body is reported as absent rather than invented; the
      // message row and its state stay visible.
      return null;
    }
  }

  private recordUserAction(action: string, targetId: string, payload: JsonObject) {
    return this.services.store.userActions.insert({
      actorId: userIdFromSubject('installation:local'),
      action,
      targetId,
      payload,
      payloadHash: sha256Of(payload),
    });
  }

  private sourceRefOf(
    params: JsonObject,
    kind: 'action' | 'message',
  ): { readonly kind: 'action' | 'message'; readonly id: string; readonly version: string } {
    const explicit = optionalString(params['sourceRefId']);
    if (explicit !== undefined) return { kind, id: explicit, version: '1' };
    const action = this.recordUserAction(
      'requirement.save',
      optionalString(params['requirementId']) ?? this.projectId,
      params,
    );
    return { kind: 'action', id: action.id, version: '1' };
  }

  private requireConfig(): ConfigStore {
    const config = this.services.config;
    if (config === undefined) {
      throw new ProtocolError('INVALID_STATE', 'this daemon was started without a ConfigStore');
    }
    return config;
  }

  private requireGates(): PlanGateService {
    const gates = this.services.gates;
    if (gates === undefined) {
      throw new ProtocolError('INVALID_STATE', 'this daemon was started without the Plan gate');
    }
    return gates;
  }

  private requireFindings(): FindingService {
    const findings = this.services.findings;
    if (findings === undefined) {
      throw new ProtocolError(
        'INVALID_STATE',
        'this daemon was started without the finding service',
      );
    }
    return findings;
  }

  private requireContinuation(): RequirementContinuation {
    const continuation = this.services.requirements;
    if (continuation === undefined) {
      throw new ProtocolError(
        'INVALID_STATE',
        'this daemon was started without the requirement continuation service',
      );
    }
    return continuation;
  }
}

// ---------------------------------------------------------------------------
// The WebSocket connection
// ---------------------------------------------------------------------------

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_FRAME_BYTES = 8 * 1024 * 1024;
const WORK_VIEW_UNKNOWN = 'Work 视图是目标覆盖，不代表已交付行为（experience.md §4）';

/**
 * One accepted WebSocket connection.
 *
 * The socket owns the handshake (`connection.hello` first, nothing else before it),
 * its subscription registry and the frame codec. Anything unexpected still answers
 * a protocol-shaped response, so a client never has to guess why it heard nothing.
 */
export class ServerWebSocket {
  private readonly socket: Duplex;
  private readonly protocol: WorkbenchProtocol;
  readonly caller: WorkbenchCaller;
  readonly connectionId: string;
  readonly subscriptions = new Map<string, SubscriptionRecord>();
  private buffer = Buffer.alloc(0);
  private helloDone = false;
  private closed = false;
  private timer: ReturnType<typeof setInterval> | undefined;
  private pendingPoll: ReturnType<typeof setImmediate> | undefined;
  private frameSequence = 0;

  constructor(
    socket: Duplex,
    protocol: WorkbenchProtocol,
    caller: WorkbenchCaller,
    connectionId: string,
  ) {
    this.socket = socket;
    this.protocol = protocol;
    this.caller = caller;
    this.connectionId = connectionId;
    socket.on('data', (chunk: Buffer) => this.onData(chunk));
    socket.on('close', () => this.onClose());
    socket.on('error', () => this.onClose());
    // The server greets with its identity; `connection.hello` is still required
    // before any other method is accepted (`protocol.md` §2).
    this.sendRaw({
      v: 1,
      type: 'hello',
      connectionId: this.connectionId,
      protocolVersion: 1,
      serverTime: new Date().toISOString(),
    });
  }

  get isClosed(): boolean {
    return this.closed;
  }

  /** Sends one JSON frame to the peer. */
  sendRaw(value: JsonObject): void {
    if (this.closed) return;
    this.writeFrame(0x1, Buffer.from(JSON.stringify(value), 'utf8'));
  }

  /** Sends one event frame (`protocol.md` §7 `Event`). */
  sendEvent(event: Event): void {
    this.sendRaw(
      jsonSafe({
        v: 1,
        type: 'event',
        eventId: event.eventId,
        projectId: this.protocol.projectId,
        cursor: event.cursor,
        name: event.name,
        entityId: event.entityId,
        entityVersion: event.entityVersion,
        data: event.data,
      }),
    );
  }

  sendResult(id: string, result: unknown): void {
    this.sendRaw(jsonSafe({ v: 1, type: 'response', id, ok: true, result }));
  }

  sendError(id: string | null, error: ProtocolError): void {
    this.frameSequence += 1;
    this.sendRaw(
      jsonSafe({
        v: 1,
        type: 'response',
        id: id ?? `server-${String(this.frameSequence)}`,
        ok: false,
        error: error.toBody(),
      }),
    );
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      let decoded: DecodedFrame | undefined;
      try {
        decoded = decodeFrame(this.buffer);
      } catch (error) {
        this.sendError(
          null,
          error instanceof ProtocolError
            ? error
            : new ProtocolError('VALIDATION_ERROR', 'the frame could not be decoded'),
        );
        this.close(1002, 'protocol error');
        return;
      }
      if (decoded === undefined) break;
      this.buffer = this.buffer.subarray(decoded.consumed);
      if (decoded.opcode === 0x8) {
        this.close(1000, 'peer closed');
        return;
      }
      if (decoded.opcode === 0x9) {
        this.writeFrame(0xa, decoded.payload);
        continue;
      }
      if (decoded.opcode !== 0x1) {
        this.sendError(
          null,
          new ProtocolError('VALIDATION_ERROR', 'only text frames are accepted'),
        );
        continue;
      }
      this.handleText(decoded.payload.toString('utf8'));
    }
  }

  private handleText(text: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      this.sendError(null, new ProtocolError('VALIDATION_ERROR', 'the frame is not JSON'));
      return;
    }
    this.handleEnvelope(parsed);
  }

  private handleEnvelope(parsed: unknown): void {
    let envelope: ParsedEnvelope;
    try {
      envelope = parseEnvelope(parsed);
    } catch (error) {
      this.fail(null, error);
      return;
    }
    if (!this.helloDone) {
      if (envelope.method !== 'connection.hello') {
        this.sendError(
          envelope.id,
          new ProtocolError('UNAUTHENTICATED', 'connection.hello must be the first request'),
        );
        this.close(1008, 'connection.hello required');
        return;
      }
      const negotiated = envelope.params['protocolVersion'];
      if (negotiated !== 1) {
        this.sendError(
          envelope.id,
          new ProtocolError(
            'PROTOCOL_MISMATCH',
            `unsupported protocol version ${describeValue(negotiated)}`,
          ),
        );
        this.close(1002, 'protocol mismatch');
        return;
      }
      this.helloDone = true;
      this.sendResult(envelope.id, this.helloResult());
      return;
    }
    try {
      switch (envelope.method) {
        case 'connection.hello':
          this.sendResult(envelope.id, this.helloResult());
          return;
        case 'project.subscribe':
          this.sendResult(
            envelope.id,
            this.protocol.subscribe(this, envelope.params, envelope.projectId, this.subscriptions),
          );
          this.ensurePolling();
          return;
        case 'subscription.set':
          this.sendResult(
            envelope.id,
            this.protocol.setScope(this, envelope.params, this.subscriptions),
          );
          return;
        case 'subscription.remove':
          this.sendResult(
            envelope.id,
            this.protocol.removeSubscription(envelope.params, this.subscriptions),
          );
          return;
        case 'project.events.ack':
          this.sendResult(
            envelope.id,
            this.protocol.ackCursor(envelope.params, this.subscriptions),
          );
          return;
        default: {
          const result = this.protocol.dispatch(envelope.method, envelope.params, {
            caller: this.caller,
            ...(envelope.idempotencyKey === undefined
              ? {}
              : { idempotencyKey: envelope.idempotencyKey }),
            ...(envelope.expectedVersion === undefined
              ? {}
              : { expectedVersion: envelope.expectedVersion }),
            ...(envelope.projectId === undefined ? {} : { projectId: envelope.projectId }),
          });
          this.sendResult(envelope.id, result);
        }
      }
    } catch (error) {
      this.fail(envelope.id, error);
    }
  }

  private helloResult(): JsonObject {
    return {
      connectionId: this.connectionId,
      protocolVersion: 1,
      serverTime: new Date().toISOString(),
    };
  }

  /** Polls the persisted log for this connection's subscriptions and streams it. */
  private ensurePolling(): void {
    if (this.pendingPoll !== undefined || this.closed) return;
    this.pendingPoll = setImmediate(() => {
      this.pendingPoll = undefined;
      this.protocol.pollConnection(this, this.subscriptions);
      if (this.subscriptions.size > 0 && this.timer === undefined && !this.closed) {
        this.timer = setInterval(() => this.protocol.pollConnection(this, this.subscriptions), 50);
      }
    });
  }

  private fail(id: string | null, error: unknown): void {
    const failure =
      error instanceof ProtocolError
        ? error
        : new ProtocolError('INTERNAL_ERROR', 'the request could not be completed');
    if (failure.code === 'AUTH_EXPIRED') {
      // `protocol.md` §2: an expired session closes the socket with AUTH_EXPIRED.
      this.sendRaw({ type: 'close', reason: failure.message, code: 'AUTH_EXPIRED' });
      this.close(1008, failure.message);
      return;
    }
    this.sendError(id, failure);
  }

  private writeFrame(opcode: number, payload: Buffer): void {
    if (this.closed || !this.socket.writable) return;
    const header: number[] = [0x80 | opcode];
    if (payload.byteLength < 126) {
      header.push(payload.byteLength);
    } else if (payload.byteLength < 65_536) {
      header.push(126, (payload.byteLength >> 8) & 0xff, payload.byteLength & 0xff);
    } else {
      header.push(127, 0, 0, 0, 0, 0, 0, 0, 0);
      header[header.length - 4] = (payload.byteLength >>> 24) & 0xff;
      header[header.length - 3] = (payload.byteLength >>> 16) & 0xff;
      header[header.length - 2] = (payload.byteLength >>> 8) & 0xff;
      header[header.length - 1] = payload.byteLength & 0xff;
    }
    this.socket.write(Buffer.concat([Buffer.from(header), payload]));
  }

  close(code: number, reason: string): void {
    if (this.closed) return;
    this.closed = true;
    if (this.timer !== undefined) clearInterval(this.timer);
    if (this.pendingPoll !== undefined) clearImmediate(this.pendingPoll);
    const reasonBytes = Buffer.from(reason, 'utf8').subarray(0, 123);
    const payload = Buffer.alloc(2 + reasonBytes.byteLength);
    payload.writeUInt16BE(code, 0);
    reasonBytes.copy(payload, 2);
    this.writeFrame(0x8, payload);
    this.socket.end();
    // Persistent events stay in the log; a disconnect never changes Work state
    // (`AC-054`). Only the in-memory subscription bookkeeping is dropped.
    this.protocol.unregister(this);
  }

  private onClose(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.timer !== undefined) clearInterval(this.timer);
    if (this.pendingPoll !== undefined) clearImmediate(this.pendingPoll);
    this.protocol.unregister(this);
  }
}

// ---------------------------------------------------------------------------
// Envelope, field and frame helpers
// ---------------------------------------------------------------------------

/** Parses one request envelope and refuses a malformed one with `VALIDATION_ERROR`. */
export function parseEnvelope(parsed: unknown): ParsedEnvelope {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ProtocolError('VALIDATION_ERROR', 'the request envelope must be a JSON object');
  }
  const envelope = parsed as Record<string, unknown>;
  if (envelope['v'] !== 1) {
    throw new ProtocolError(
      'PROTOCOL_MISMATCH',
      `unsupported protocol version ${String(envelope['v'])}`,
    );
  }
  if (envelope['type'] !== 'request') {
    throw new ProtocolError('VALIDATION_ERROR', 'the envelope type must be "request"');
  }
  const id = envelope['id'];
  const method = envelope['method'];
  if (typeof id !== 'string' || id === '') {
    throw new ProtocolError('VALIDATION_ERROR', 'the envelope id must be a non-empty string');
  }
  if (typeof method !== 'string' || method === '') {
    throw new ProtocolError('VALIDATION_ERROR', 'the envelope method must be a non-empty string');
  }
  const paramsValue = envelope['params'];
  if (
    paramsValue !== undefined &&
    (typeof paramsValue !== 'object' || paramsValue === null || Array.isArray(paramsValue))
  ) {
    throw new ProtocolError('VALIDATION_ERROR', 'params must be a JSON object');
  }
  const projectId = envelope['projectId'];
  if (projectId !== undefined && typeof projectId !== 'string') {
    throw new ProtocolError('VALIDATION_ERROR', 'projectId must be a string');
  }
  const idempotencyKey = envelope['idempotencyKey'];
  if (idempotencyKey !== undefined && typeof idempotencyKey !== 'string') {
    throw new ProtocolError('VALIDATION_ERROR', 'idempotencyKey must be a string');
  }
  const expectedVersion = envelope['expectedVersion'];
  if (expectedVersion !== undefined && typeof expectedVersion !== 'number') {
    throw new ProtocolError('VALIDATION_ERROR', 'expectedVersion must be a number');
  }
  return {
    id,
    method,
    params: (paramsValue ?? {}) as JsonObject,
    ...(projectId === undefined ? {} : { projectId }),
    ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
    ...(expectedVersion === undefined ? {} : { expectedVersion }),
  };
}

interface DecodedFrame {
  readonly opcode: number;
  readonly payload: Buffer;
  readonly consumed: number;
}

/** Decodes one client frame; returns `undefined` when more bytes are needed. */
export function decodeFrame(buffer: Buffer): DecodedFrame | undefined {
  if (buffer.byteLength < 2) return undefined;
  const first = buffer[0] as number;
  const second = buffer[1] as number;
  const opcode = first & 0x0f;
  const masked = (second & 0x80) !== 0;
  let length = second & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (buffer.byteLength < offset + 2) return undefined;
    length = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (length === 127) {
    if (buffer.byteLength < offset + 8) return undefined;
    const high = buffer.readUInt32BE(offset);
    const low = buffer.readUInt32BE(offset + 4);
    if (high !== 0) throw new ProtocolError('VALIDATION_ERROR', 'frame is too large');
    length = low;
    offset += 8;
  }
  if (length > MAX_FRAME_BYTES) {
    throw new ProtocolError('VALIDATION_ERROR', 'frame is too large');
  }
  // RFC6455 §5.1: a client frame must be masked; an unmasked one is a protocol
  // error, which keeps a proxy from injecting unmasked frames.
  if (!masked) {
    throw new ProtocolError('VALIDATION_ERROR', 'client frames must be masked');
  }
  if (buffer.byteLength < offset + 4 + length) return undefined;
  const mask = buffer.subarray(offset, offset + 4);
  offset += 4;
  const payload = Buffer.alloc(length);
  for (let index = 0; index < length; index += 1) {
    payload[index] = (buffer[offset + index] as number) ^ (mask[index % 4] as number);
  }
  return { opcode, payload, consumed: offset + length };
}

// ---------------------------------------------------------------------------
// Field helpers
// ---------------------------------------------------------------------------

function requiredString(params: JsonObject, key: string): string {
  const value = params[key];
  if (typeof value !== 'string' || value === '') {
    throw new ProtocolError('VALIDATION_ERROR', `${key} must be a non-empty string`, {
      details: { field: key },
    });
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function optionalInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
}

function stringOr(source: JsonObject, key: string, fallback: string): string {
  const value = source[key];
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || value === '') {
    throw new ProtocolError('VALIDATION_ERROR', `${key} must be a non-empty string`);
  }
  return value;
}

function stringArray(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new ProtocolError('VALIDATION_ERROR', 'expected an array of strings');
  }
  return value.map((entry) => {
    if (typeof entry !== 'string') {
      throw new ProtocolError('VALIDATION_ERROR', 'expected an array of strings');
    }
    return entry;
  });
}

function arrayField(source: JsonObject, key: string): unknown[] {
  const value = source[key];
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new ProtocolError('VALIDATION_ERROR', `${key} must be an array`);
  }
  return value;
}

function objectField(source: JsonObject, key: string): JsonObject {
  const value = source[key];
  if (value === undefined) return {};
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ProtocolError('VALIDATION_ERROR', `${key} must be an object`);
  }
  return value;
}

function refField(source: JsonObject, key: string): Ref {
  const value = objectField(source, key);
  const version = value['version'];
  const hash = value['hash'];
  if (typeof version !== 'number' || !Number.isInteger(version) || version <= 0) {
    throw new ProtocolError('VALIDATION_ERROR', `${key}.version must be a positive integer`);
  }
  if (typeof hash !== 'string' || hash === '') {
    throw new ProtocolError('VALIDATION_ERROR', `${key}.hash must be a non-empty string`);
  }
  return { id: requiredString(value, 'id'), version, hash };
}

function parsePlanDraft(value: unknown): PlanDraft {
  if (value === undefined) {
    throw new ProtocolError('VALIDATION_ERROR', 'plan is required', { details: { field: 'plan' } });
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ProtocolError('VALIDATION_ERROR', 'plan must be an object');
  }
  const draft = value as JsonObject;
  const tasks = draft['tasks'];
  if (!Array.isArray(tasks) || tasks.length === 0) {
    throw new ProtocolError('VALIDATION_ERROR', 'plan.tasks must be a non-empty array');
  }
  return {
    goal: requiredString(draft, 'goal'),
    scope: draft['scope'] as Plan['scope'],
    tasks: JSON.parse(JSON.stringify(tasks)) as PlanDraft['tasks'],
    ...(Array.isArray(draft['interfaceChanges'])
      ? { interfaceChanges: draft['interfaceChanges'] as string[] }
      : {}),
    ...(Array.isArray(draft['dataChanges'])
      ? { dataChanges: draft['dataChanges'] as string[] }
      : {}),
    ...(Array.isArray(draft['risks']) ? { risks: draft['risks'] as string[] } : {}),
    ...(Array.isArray(draft['rollback']) ? { rollback: draft['rollback'] as string[] } : {}),
  };
}

function knowledgeView(value: unknown): 'design' | 'delivered' | 'work' {
  const view = optionalString(value);
  if (view !== 'design' && view !== 'delivered' && view !== 'work') {
    throw new ProtocolError('VALIDATION_ERROR', `unknown knowledge view ${String(value)}`, {
      details: { accepted: ['design', 'delivered', 'work'] },
    });
  }
  return view;
}

function configScope(value: unknown): 'global' | 'project' {
  const scope = optionalString(value) ?? 'global';
  if (scope !== 'global' && scope !== 'project') {
    throw new ProtocolError('VALIDATION_ERROR', `unknown config scope ${scope}`);
  }
  return scope;
}

/** `BehaviourChoice` guard: a product decision only accepts the three branches. */
function isBehaviourChoice(value: string): value is 'now' | 'later' | 'decline' {
  return value === 'now' || value === 'later' || value === 'decline';
}

function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

function boundedLimit(value: unknown): number {
  const limit = optionalInteger(value);
  if (limit === undefined) return DEFAULT_PAGE_LIMIT;
  if (limit < 1 || limit > MAX_PAGE_LIMIT) {
    throw new ProtocolError('VALIDATION_ERROR', `limit must be 1–${MAX_PAGE_LIMIT}`);
  }
  return limit;
}

/** A readable form of an arbitrary JSON value for an error message. */
function describeValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined) return 'undefined';
  try {
    return JSON.stringify(value) ?? typeof value;
  } catch {
    return typeof value;
  }
}

/** Re-serialises a value into the contract's JSON shape (drops `undefined`). */
function jsonSafe(value: unknown): JsonObject {
  return JSON.parse(JSON.stringify(value ?? null)) as JsonObject;
}

/**
 * Whether one event belongs to a subscription scope.
 *
 * The routing input is the change summary in `event.data` plus the entity id, so
 * an event about a Task still reaches its Work's subscribers — the same rule the
 * EventHub applies server-side, kept here because the watermark read is per
 * connection.
 */
/** Whether two subscription scopes observe the same stream. */
function sameScopeRecord(
  left: { readonly kind: string; readonly id?: string },
  right: { readonly kind: string; readonly id?: string },
): boolean {
  return left.kind === right.kind && left.id === right.id;
}

function matchesSubscription(
  event: Event,
  scope: { readonly kind: string; readonly id?: string },
): boolean {
  if (scope.kind === 'summary') return true;
  if (scope.id === undefined) return false;
  if (event.entityId === scope.id) return true;
  const data = event.data as Record<string, unknown>;
  const field =
    scope.kind === 'conversation' ? 'conversationId' : scope.kind === 'work' ? 'workId' : 'runId';
  return data[field] === scope.id;
}

function emptyScope(): Scope {
  return { readPaths: [], writePaths: [], operations: [], networkTargets: [] };
}

/** Whether a JSON value is a `Scope` envelope rather than some other object. */
function isScope(value: unknown): value is Scope {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    Array.isArray(candidate['readPaths']) &&
    Array.isArray(candidate['writePaths']) &&
    Array.isArray(candidate['operations']) &&
    Array.isArray(candidate['networkTargets'])
  );
}

/**
 * The canonical `content.md` body of a generated requirement record.
 *
 * `requirements.md` §6 requires the six level-2 headings, each exactly once and in
 * order, with real content under them; the daemon generates this body when it
 * cancels a Queued requirement, so the save is a real Git record instead of the
 * structurally invalid body that made every cancellation fail (W9R1-05).
 */
function canonicalRequirementContent(input: {
  readonly title: string;
  readonly goal: string;
  readonly completion: string;
}): string {
  const sections: Record<(typeof REQUIREMENT_CONTENT_HEADINGS)[number], string> = {
    目标与背景: input.goal === '' ? REQUIREMENT_EMPTY_SECTION : input.goal,
    范围与行为: REQUIREMENT_EMPTY_SECTION,
    验收说明: REQUIREMENT_EMPTY_SECTION,
    已确认决定: REQUIREMENT_EMPTY_SECTION,
    未决问题: REQUIREMENT_EMPTY_SECTION,
    完成摘要: input.completion === '' ? REQUIREMENT_EMPTY_SECTION : input.completion,
  };
  const body = REQUIREMENT_CONTENT_HEADINGS.flatMap((heading) => [
    `## ${heading}`,
    '',
    sections[heading],
    '',
  ]);
  return [`# ${input.title}`, '', ...body].join('\n');
}

function emptyTaskCounts(): JsonObject {
  return { total: 0, done: 0, develop: 0, review: 0, test: 0, ready: 0 };
}

/** Maps a service refusal code onto the protocol error table. */
function protocolCode(code: string): ErrorCode {
  const parsed = errorCodeSchema.safeParse(code);
  return parsed.success ? parsed.data : 'VALIDATION_ERROR';
}

/** SHA256 over the canonical JSON of a payload, for command idempotency. */
function sha256Of(payload: unknown): string {
  return createHash('sha256').update(canonicalJson(payload)).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(',')}}`;
}

function basename(path: string): string {
  const parts = path.split('/').filter((part) => part !== '');
  return parts.at(-1) ?? path;
}

/** Normalizes a root for identity comparison without inventing a second id. */
function normalizeRoot(root: string): string {
  const withoutTrailing = root.replace(/\/+$/u, '');
  return withoutTrailing === '' ? '/' : withoutTrailing;
}
