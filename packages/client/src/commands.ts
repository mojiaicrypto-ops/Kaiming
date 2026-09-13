/**
 * Commands, the connection state machine and the HTTP command path.
 *
 * Behaviour comes from `docs/architecture/protocol.md`:
 * - §1: one request yields exactly one terminal response; writes carry
 *   `idempotencyKey` + `expectedVersion`; a lost answer is re-sent with the *same*
 *   idempotency key rather than a new one; `BUSY` is the only unconditional retry.
 * - §2: `connection.hello` is the only method accepted before the connection is
 *   ready; an expired session is closed with `AUTH_EXPIRED`.
 * - §7: error codes pass through verbatim, and only retryable failures are retried.
 *
 * The state machine is `connecting → open → reconnecting → … → closed` with a
 * bounded exponential backoff. Writes that were already on the wire when the
 * socket died are queued and replayed after the reconnect; the caller learns from
 * `WriteReceipt.replayed` that the answer came from the replay rather than from a
 * first attempt.
 */
import {
  errorBodySchema,
  isRetryable,
  responseEnvelopeSchema,
  type ErrorBody,
  type JsonObject,
} from '@agentdev/contracts';
import {
  ClientError,
  DEFAULT_BACKOFF,
  REQUEST_ID_PREFIX,
  SocketSession,
  TRANSPORT_ERROR_CODES,
  asClientError,
  backoffDelay,
  systemTimers,
  type BackoffPolicy,
  type ConnectionState,
  type ConnectionStatus,
  type RetryResolver,
  type Timers,
  type Transport,
} from './connection.js';

/** Reads issued by `protocol.md` §2–§6: they carry no idempotency key. */
export const READ_ONLY_METHODS: readonly string[] = [
  'connection.hello',
  'command.get',
  'project.list',
  'project.snapshot.get',
  'conversation.list',
  'conversation.get',
  'work.list',
  'work.get',
  'requirement.list',
  'requirement.get',
  'task.list',
  'task.get',
  'run.list',
  'run.get',
  'knowledge.list',
  'knowledge.get',
  'context.preview',
  'file.list',
  'file.read',
  'artifact.list',
  'artifact.get',
  'config.get',
  'extension.list',
  'runner.heartbeat',
];

const READ_ONLY_SET = new Set(READ_ONLY_METHODS);

/** `true` for a documented read method; every other method is a write. */
export function isReadOnlyMethod(method: string): boolean {
  return READ_ONLY_SET.has(method);
}

/** The write fields every write method must carry (`protocol.md` §1). */
export interface WriteOptions {
  /** 1–128 characters; the same key must be used for a retry of the same payload. */
  readonly idempotencyKey: string;
  /** Version the write targets; `0` means "expect absent" on create. */
  readonly expectedVersion: number;
  /** The Project the write belongs to, when the method is Project-scoped. */
  readonly projectId?: string;
}

/** The outcome of a write, including whether it was a replay of an earlier attempt. */
export interface WriteReceipt<T = unknown> {
  readonly result: T;
  /** `true` when this answer came from replaying a request after a disconnect. */
  readonly replayed: boolean;
  /** Transport sends performed for this write, including the first one. */
  readonly transportAttempts: number;
}

const IDEMPOTENCY_KEY_MIN_CHARS = 1;
const IDEMPOTENCY_KEY_MAX_CHARS = 128;

/** Validates the write fields before anything reaches the wire. */
export function validateWriteOptions(options: WriteOptions): void {
  if (
    typeof options.idempotencyKey !== 'string' ||
    options.idempotencyKey.length < IDEMPOTENCY_KEY_MIN_CHARS ||
    options.idempotencyKey.length > IDEMPOTENCY_KEY_MAX_CHARS
  ) {
    throw ClientError.validation(
      `idempotencyKey must be ${IDEMPOTENCY_KEY_MIN_CHARS}–${IDEMPOTENCY_KEY_MAX_CHARS} characters`,
      { length: options.idempotencyKey.length },
    );
  }
  if (!Number.isInteger(options.expectedVersion) || options.expectedVersion < 0) {
    throw ClientError.validation('expectedVersion must be a non-negative integer', {
      expectedVersion: options.expectedVersion,
    });
  }
}

/** A write that is waiting for a socket, or being replayed on one. */
interface QueuedWrite {
  readonly method: string;
  readonly params: JsonObject;
  readonly write: WriteOptions;
  /** Retries already spent on this write when it was queued. */
  readonly attempts: number;
  /** `true` when an earlier attempt was already on the wire. */
  readonly wasSent: boolean;
  readonly settle: (result: unknown) => void;
  readonly fail: (error: ClientError) => void;
}

export interface ProtocolConnectionOptions {
  readonly transport: Transport;
  readonly client?: 'web' | 'cli';
  readonly timers?: Timers;
  readonly backoff?: BackoffPolicy;
  /** Reconnect attempts before the client gives up; `Infinity` keeps trying. */
  readonly maxReconnectAttempts?: number;
  /** Re-sends of the same write after `BUSY` or a lost answer. */
  readonly maxWriteRetries?: number;
  readonly requestTimeoutMs?: number;
  /** How long a queued write waits for a socket. */
  readonly connectTimeoutMs?: number;
  readonly retryableFor?: RetryResolver;
}

export const DEFAULT_PROTOCOL_OPTIONS = {
  client: 'web',
  maxReconnectAttempts: 5,
  maxWriteRetries: 3,
  requestTimeoutMs: 30_000,
  connectTimeoutMs: 15_000,
} as const;

/** The default retryability resolver: the shared contract's answer. */
const contractRetryable: RetryResolver = (body) => isRetryable(body.code);

/**
 * The WebSocket protocol client.
 *
 * One instance is a long-lived connection: it owns reconnects, replays queued
 * writes exactly once per retry, and re-runs `connection.hello` on every new socket.
 */
export class ProtocolConnection {
  readonly transport: Transport;
  protected readonly timers: Timers;
  protected readonly backoff: BackoffPolicy;
  protected readonly clientKind: 'web' | 'cli';
  protected readonly maxReconnectAttempts: number;
  protected readonly maxWriteRetries: number;
  protected readonly requestTimeoutMs: number;
  protected readonly connectTimeoutMs: number;
  protected readonly retryableFor: RetryResolver;
  protected activeSession: SocketSession | undefined;
  protected connectionId: string | undefined;
  protected lastError: ClientError | undefined;
  protected attempt = 0;
  /** Writes waiting for a socket, in send order. */
  protected readonly queued: QueuedWrite[] = [];
  private currentState: ConnectionState = 'closed';
  private readonly unsubscribeTransport: () => void;
  private openState: ConnectionState = 'closed';
  private publishedStatus = '';
  private closeCode: number | undefined;
  private closeReason: string | undefined;
  protected halted = true;
  protected started = false;
  private reconnectHandle: unknown;
  private readonly listeners = new Set<(status: ConnectionStatus) => void>();
  private readonly openWaiters = new Set<() => void>();

  constructor(options: ProtocolConnectionOptions) {
    this.transport = options.transport;
    this.timers = options.timers ?? systemTimers;
    this.backoff = options.backoff ?? DEFAULT_BACKOFF;
    this.clientKind = options.client ?? DEFAULT_PROTOCOL_OPTIONS.client;
    this.maxReconnectAttempts =
      options.maxReconnectAttempts ?? DEFAULT_PROTOCOL_OPTIONS.maxReconnectAttempts;
    this.maxWriteRetries = options.maxWriteRetries ?? DEFAULT_PROTOCOL_OPTIONS.maxWriteRetries;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_PROTOCOL_OPTIONS.requestTimeoutMs;
    this.connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_PROTOCOL_OPTIONS.connectTimeoutMs;
    this.retryableFor = options.retryableFor ?? contractRetryable;
    // The transport reports through one listener for the connection's whole life:
    // the live session is looked up per frame, so a reconnect cannot leave a stale
    // listener behind or deliver a frame to the wrong attempt.
    this.unsubscribeTransport = this.transport.subscribe({
      onOpen: () => {
        if (this.openState === 'closed') {
          this.openState = 'connecting';
          this.setState('connecting');
        }
      },
      onMessage: (payload) => this.onFrame(payload),
      onClose: (code, reason) => {
        this.openState = 'closed';
        this.onTransportClosed(code, reason);
      },
      onError: (error) => {
        this.lastError = error;
      },
    });
  }

  /** Detaches from the transport; `end()` calls this. */
  protected detachTransport(): void {
    this.unsubscribeTransport();
  }

  get state(): ConnectionState {
    return this.currentState;
  }

  /** `true` when `method` is a documented read (`protocol.md` §1). */
  static isRead(method: string): boolean {
    return isReadOnlyMethod(method);
  }

  /** The id the server assigned in `connection.hello`, when connected. */
  get connection(): string | undefined {
    return this.connectionId;
  }

  get status(): ConnectionStatus {
    return {
      state: this.currentState,
      attempt: this.attempt,
      ...(this.closeCode === undefined ? {} : { code: this.closeCode }),
      ...(this.closeReason === undefined ? {} : { reason: this.closeReason }),
      ...(this.lastError === undefined ? {} : { error: this.lastError }),
    };
  }

  /** Writes waiting for a socket (a replayed write or one queued during a drop). */
  get queuedWrites(): number {
    return this.queued.length;
  }

  /** Subscribes to connection-state changes; the listener fires on every change. */
  onStateChange(listener: (status: ConnectionStatus) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Opens the connection and completes `connection.hello`. */
  async connect(): Promise<void> {
    if (this.currentState === 'open') return;
    this.halted = false;
    this.started = true;
    this.setState('connecting');
    await this.startSession();
  }

  /** Ends the connection; queued writes fail with `TRANSPORT_CLOSED`. */
  end(): void {
    this.halted = true;
    this.started = false;
    this.clearReconnect();
    const failure = ClientError.transport(
      TRANSPORT_ERROR_CODES.transportClosed,
      'the client closed the connection',
    );
    this.rejectQueue(failure);
    this.activeSession?.close(failure);
    this.activeSession = undefined;
    this.rejectOpenWaiters(failure);
    this.setState('closed');
    this.transport.close();
  }

  /** Resolves when a socket is open; rejects once the connection gives up. */
  async waitUntilOpen(): Promise<void> {
    if (this.currentState === 'open') return;
    const timeout = this.connectTimeoutMs;
    await new Promise<void>((resolve, reject) => {
      let handle: unknown;
      const waiter = (): void => {
        this.timers.clearTimeout(handle);
        this.openWaiters.delete(waiter);
        resolve();
      };
      this.openWaiters.add(waiter);
      if (Number.isFinite(timeout) && timeout > 0) {
        handle = this.timers.setTimeout(() => {
          this.openWaiters.delete(waiter);
          reject(ClientError.timeout('connect', timeout));
        }, timeout);
      }
    });
  }

  /** Sends a read and resolves with the protocol result, bounded by the request limit. */
  command<T = unknown>(method: string, params: JsonObject = {}, projectId?: string): Promise<T> {
    if (isReadOnlyMethod(method)) {
      return this.withTimeout(this.sendRead<T>(method, params, projectId), method);
    }
    return Promise.reject(
      ClientError.validation(
        `${method} is a write; call write() with an idempotencyKey and expectedVersion`,
      ),
    );
  }

  /**
   * Sends a write and resolves with its result plus replay information.
   *
   * The `idempotencyKey` is fixed by the caller and never regenerated: a retry
   * after `BUSY` or a lost answer re-sends the identical envelope, which is what
   * lets the server return the original result instead of applying it twice.
   */
  async write<T = unknown>(
    method: string,
    params: JsonObject,
    write: WriteOptions,
  ): Promise<WriteReceipt<T>> {
    validateWriteOptions(write);
    if (isReadOnlyMethod(method)) {
      throw ClientError.validation(`${method} is a read and takes no idempotency key`);
    }
    return this.dispatchWrite<T>(method, params, write);
  }

  /** The live session, or `undefined` while disconnected. */
  currentSession(): SocketSession | undefined {
    return this.activeSession;
  }

  /** Sends a read now; a closed or reconnecting socket rejects with a lost transport. */
  sendRead<T>(method: string, params: JsonObject, projectId?: string): Promise<T> {
    const session = this.activeSession;
    if (session === undefined || this.currentState !== 'open') {
      return Promise.reject(
        ClientError.transport(TRANSPORT_ERROR_CODES.transportClosed, 'the connection is not open'),
      );
    }
    return session.invoke(
      method,
      params,
      projectId === undefined ? {} : { projectId },
    ) as Promise<T>;
  }

  /**
   * Sends one write, retrying inside the documented bounds.
   *
   * @param retrying `true` when this call is already a retry of an earlier attempt.
   * @param sentBefore `true` when an earlier attempt was already on the wire, so the
   *   answer may be the original result of that attempt.
   */
  protected async dispatchWrite<T>(
    method: string,
    params: JsonObject,
    write: WriteOptions,
    retrying = false,
    sentBefore = false,
  ): Promise<WriteReceipt<T>> {
    const body: JsonObject = {
      ...params,
      idempotencyKey: write.idempotencyKey,
      expectedVersion: write.expectedVersion,
    };
    const projectId = write.projectId;
    let retries = 0;
    let replay = retrying || sentBefore;
    // The request id is chosen by the session and kept for every re-send, so a
    // retry is provably the same request rather than a new one.
    let requestId: string | undefined;
    for (;;) {
      const session = this.activeSession;
      if (session === undefined || this.currentState !== 'open') {
        void session;
        const outcome = await this.enqueueWrite(method, params, write, retries, replay);
        return {
          result: outcome.result as T,
          replayed: outcome.replayed,
          transportAttempts: retries + 1,
        };
      }
      let wasSent = false;
      let response: Promise<unknown>;
      try {
        response = session.invoke(method, body, {
          ...(projectId === undefined ? {} : { projectId }),
          onSend: (id) => {
            wasSent = true;
            requestId = id;
          },
        });
      } catch (error) {
        response = Promise.reject(asClientError(error, 'the write could not be sent'));
      }
      try {
        const result = await this.withTimeout(response, method);
        return {
          result: result as T,
          // `replay` is true only when an earlier attempt was already sent, so a
          // first-attempt answer can never be reported as a replay.
          replayed: replay,
          transportAttempts: retries + 1,
        };
      } catch (error) {
        const failure = asClientError(error, 'the write failed');
        const stillConnected = this.activeSession === session && this.currentState === 'open';
        if (failure.code === 'BUSY' && stillConnected && retries < this.maxWriteRetries) {
          retries += 1;
          replay = true;
          await this.delay(backoffDelay(this.backoff, retries - 1));
          continue;
        }
        const lostResponse =
          failure.code === TRANSPORT_ERROR_CODES.transportClosed ||
          failure.code === TRANSPORT_ERROR_CODES.transportLost ||
          failure.code === 'TIMEOUT';
        if (wasSent && lostResponse && this.mayAutoRetry() && retries < this.maxWriteRetries) {
          if (stillConnected) {
            // The socket still lives but the answer never came: drop the request
            // from this session so the replay is not correlated twice.
            if (requestId !== undefined) session.detach(requestId);
          }
          retries += 1;
          replay = true;
          const outcome = await this.enqueueWrite(method, params, write, retries, replay);
          return {
            result: outcome.result as T,
            replayed: outcome.replayed,
            transportAttempts: retries + 1,
          };
        }
        throw failure;
      }
    }
  }

  /**
   * Queues a write until a socket can carry it.
   *
   * `wasSent` records whether an earlier attempt was already on the wire, so the
   * caller is told whether a successful replay may have reused an original result.
   */
  private async enqueueWrite(
    method: string,
    params: JsonObject,
    write: WriteOptions,
    attempts: number,
    wasSent: boolean,
  ): Promise<{ result: unknown; replayed: boolean }> {
    if (this.halted) {
      throw ClientError.transport(
        TRANSPORT_ERROR_CODES.transportClosed,
        `the connection is closed; ${method} was not sent`,
      );
    }
    return new Promise<{ result: unknown; replayed: boolean }>((resolve, reject) => {
      this.queued.push({
        method,
        params,
        write,
        attempts,
        wasSent,
        settle: (result) => resolve({ result, replayed: wasSent || attempts > 0 }),
        fail: reject,
      });
    });
  }

  /** Replays every queued write on the freshly opened socket, in order. */
  protected async flushQueue(): Promise<void> {
    if (this.queued.length === 0) return;
    const pending = this.queued.splice(0, this.queued.length);
    for (const entry of pending) {
      try {
        const outcome = await this.dispatchWrite<unknown>(
          entry.method,
          entry.params,
          entry.write,
          entry.attempts > 0,
          entry.wasSent,
        );
        entry.settle(outcome.result);
      } catch (error) {
        entry.fail(asClientError(error, 'the queued write failed'));
      }
    }
  }

  /** Fails every queued write; used by `end()` and by an exhausted reconnect budget. */
  protected rejectQueue(error: ClientError): void {
    const pending = this.queued.splice(0, this.queued.length);
    for (const entry of pending) entry.fail(error);
  }

  /** Opens a socket, runs the handshake, then replays queued writes. */
  protected async startSession(): Promise<void> {
    try {
      this.openSocket();
      await this.performHello();
    } catch (error) {
      const failure = asClientError(error, 'the connection handshake failed');
      this.lastError = failure;
      if (
        failure.code === 'UNAUTHENTICATED' ||
        failure.code === 'AUTH_EXPIRED' ||
        failure.code === 'NOT_AUTHORIZED'
      ) {
        // An unauthorised session is never retried (`protocol.md` §7).
        this.halted = true;
        this.started = false;
        const session = this.activeSession;
        this.activeSession = undefined;
        session?.close(failure);
        this.rejectOpenWaiters(failure);
        this.rejectQueue(failure);
        this.setState('closed');
        this.transport.close(1008, 'unauthorised');
        throw failure;
      }
      this.handleClose(failure);
      throw failure;
    }
    this.attempt = 0;
    this.lastError = undefined;
    this.closeCode = undefined;
    this.closeReason = undefined;
    this.setState('open');
    this.resolveOpenWaiters();
    // Writes first: a replay is a caller's in-flight request, not new work.
    await this.flushQueue();
    await this.afterOpen();
  }

  /** Hook for a subclass after the handshake; `index.ts` re-attaches subscriptions here. */
  protected async afterOpen(): Promise<void> {}

  /**
   * Whether an automatic replay is still allowed.
   *
   * `protocol.md` §7 retries only `BUSY` and known side-effect-free failures, and
   * an unauthenticated or unauthorised answer is terminal. A queued replay is
   * paced by the single reconnect schedule rather than an immediate loop, so a
   * reconnecting socket is exactly the case this must permit.
   */
  protected mayAutoRetry(): boolean {
    return !this.halted;
  }

  /** Creates the session object and asks the transport to open. */
  protected openSocket(): void {
    this.openState = 'connecting';
    const session = new SocketSession(this.transport, {
      onFrame: (payload) => this.onFrame(payload),
      onClosed: (error) => this.onSocketClosed(session, error),
      retryableFor: this.retryableFor,
    });
    this.activeSession = session;
    this.transport.open();
    this.openState = this.transport.state;
  }

  /** Replays `connection.hello`; nothing else may precede it. */
  protected async performHello(): Promise<void> {
    const session = this.activeSession;
    if (session === undefined) {
      throw ClientError.transport(TRANSPORT_ERROR_CODES.transportClosed, 'no session');
    }
    const result = await session.invoke('connection.hello', {
      protocolVersion: 1,
      client: this.clientKind,
    });
    const hello = result as { connectionId?: unknown } | null;
    if (typeof hello?.connectionId !== 'string' || hello.connectionId === '') {
      throw ClientError.protocol('connection.hello did not return a connectionId', { result });
    }
    this.connectionId = hello.connectionId;
  }

  /** Delivers one frame from the wire; the transport adapter calls this. */
  dispatchFrame(payload: string): void {
    this.onFrame(payload);
  }

  /**
   * Routes one frame.
   *
   * Anything that is not a request/response envelope for this session is handed to
   * the subclass (`subscriptions.ts` owns events).
   */
  protected onFrame(payload: string): void {
    const session = this.activeSession;
    if (session !== undefined && session.settleResponse(payload)) return;
    this.onOtherFrame(payload);
  }

  /** Events and transient frames; the base client ignores the ones it does not own. */
  protected onOtherFrame(_payload: string): void {}

  protected onSocketClosed(session: SocketSession, error: ClientError): void {
    this.openState = 'closed';
    if (this.activeSession !== session) return;
    this.activeSession = undefined;
    this.handleClose(error);
  }

  /** The transport's own close event, when no session error reported it first. */
  protected onTransportClosed(code: number | undefined, reason: string | undefined): void {
    this.openState = 'closed';
    if (this.halted || !this.started) return;
    if (this.activeSession === undefined && this.currentState === 'reconnecting') return;
    this.closeCode = code;
    this.closeReason = reason;
    const session = this.activeSession;
    if (session === undefined) {
      this.handleClose();
      return;
    }
    // Close the session first so every in-flight request settles: a write whose
    // answer was lost must reach its retry path (AC-054), and the session reports
    // the closure back exactly once, which schedules the reconnect.
    session.close(
      ClientError.transport(
        TRANSPORT_ERROR_CODES.transportLost,
        reason === undefined || reason === '' ? 'the socket closed' : reason,
      ),
    );
  }

  /** Applies the reconnect policy: bounded exponential backoff, then give up. */
  protected handleClose(reason?: ClientError): void {
    if (this.halted || !this.started) {
      // A stopped client never reconnects; `end()` and a refused session both land
      // here, and a reconnect for either would be a wasted attempt.
      this.setState('closed');
      return;
    }
    if (reason !== undefined) this.lastError = reason;
    if (reason?.code === 'NOT_AUTHORIZED' || reason?.code === 'AUTH_EXPIRED') {
      // `protocol.md` §7: an unauthorised session is terminal. Reconnecting with
      // the same credential can only fail, so the connection ends here (AC-078).
      this.halted = true;
      this.started = false;
      this.rejectOpenWaiters(reason);
      this.rejectQueue(reason);
      this.setState('closed');
      return;
    }
    if (this.transport.status.code !== undefined) this.closeCode = this.transport.status.code;
    if (this.transport.status.reason !== undefined) {
      this.closeReason = this.transport.status.reason;
    }
    if (this.transport.status.error !== undefined) this.lastError = this.transport.status.error;
    if (this.attempt >= this.maxReconnectAttempts) {
      this.halted = true;
      this.started = false;
      const failure =
        this.lastError ??
        ClientError.transport(
          TRANSPORT_ERROR_CODES.transportLost,
          'the reconnect limit was reached',
        );
      this.rejectOpenWaiters(failure);
      this.rejectQueue(failure);
      this.setState('closed');
      return;
    }
    this.setState('reconnecting');
    const delay = backoffDelay(this.backoff, this.attempt);
    const nextAttempt = this.attempt + 1;
    this.clearReconnect();
    this.reconnectHandle = this.timers.setTimeout(() => {
      this.reconnectHandle = undefined;
      this.attempt = nextAttempt;
      void this.startSession().catch(() => {
        // `startSession` scheduled the next attempt (or gave up) already.
      });
    }, delay);
  }

  protected clearReconnect(): void {
    if (this.reconnectHandle === undefined) return;
    this.timers.clearTimeout(this.reconnectHandle);
    this.reconnectHandle = undefined;
  }

  protected delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.timers.setTimeout(resolve, ms);
    });
  }

  /** Rejects a request that produced no response inside the request limit. */
  protected withTimeout<T>(promise: Promise<T>, method: string): Promise<T> {
    const timeout = this.requestTimeoutMs;
    if (!Number.isFinite(timeout) || timeout <= 0) return promise;
    return new Promise<T>((resolve, reject) => {
      const handle = this.timers.setTimeout(() => {
        reject(ClientError.timeout(method, timeout));
      }, timeout);
      promise.then(
        (value) => {
          this.timers.clearTimeout(handle);
          resolve(value);
        },
        (error: unknown) => {
          this.timers.clearTimeout(handle);
          reject(error instanceof Error ? error : new Error(String(error)));
        },
      );
    });
  }

  /**
   * Publishes a state change.
   *
   * A new reconnect attempt reports again even though the state string is the same:
   * the attempt number is part of the documented status, so a UI can show how many
   * tries the connection has made.
   */
  protected setState(state: ConnectionState): void {
    const changed = this.currentState !== state;
    this.currentState = state;
    const key = `${state}|${this.attempt}|${String(this.closeCode)}`;
    if (!changed && key === this.publishedStatus) return;
    if (!changed && state !== 'reconnecting') return;
    this.publishedStatus = key;
    for (const listener of [...this.listeners]) listener(this.status);
  }

  protected resolveOpenWaiters(): void {
    const waiters = [...this.openWaiters];
    this.openWaiters.clear();
    for (const waiter of waiters) waiter();
  }

  protected rejectOpenWaiters(error: ClientError): void {
    // Waiters resolve only into `open`; a halted connection fails the next
    // `waitUntilOpen` synchronously, so no second error channel is needed here.
    this.openWaiters.clear();
    void error;
  }
}

/** A validated session cookie plus the CSRF token that authorises writes. */
export interface SessionCookie {
  /** Value of the `agentdev_session` cookie (`protocol.md` §2). */
  readonly cookie: string;
  /** `X-CSRF-Token`, required on every same-origin write. */
  readonly csrfToken?: string;
}

/** The cookie name the daemon sets; exported so callers do not spell it twice. */
export const SESSION_COOKIE_NAME = 'agentdev_session';

/** Builds the `Cookie` header value for a session. */
export function sessionCookieHeader(session: SessionCookie): string {
  return `${SESSION_COOKIE_NAME}=${session.cookie}`;
}

/** Handshake headers for a Node `WebSocket`: Origin plus, when present, the cookie. */
export function handshakeHeaders(options: {
  readonly origin?: string;
  readonly session?: SessionCookie;
  readonly bearer?: string;
}): Record<string, string> {
  const headers: Record<string, string> = {};
  if (options.origin !== undefined) headers['Origin'] = options.origin;
  if (options.session !== undefined) headers['Cookie'] = sessionCookieHeader(options.session);
  if (options.bearer !== undefined) headers['Authorization'] = `Bearer ${options.bearer}`;
  return headers;
}

export interface HttpAuthOptions {
  /** Base URL of the BFF, e.g. `http://127.0.0.1:4317`. */
  readonly baseUrl: string;
  readonly origin?: string;
  /** Injectable for tests; defaults to global `fetch`. */
  readonly fetchImpl?: typeof fetch;
  readonly requestTimeoutMs?: number;
}

export interface HttpLoginOptions extends HttpAuthOptions {
  /** The installation token the installer showed exactly once. */
  readonly token: string;
}

/** A session created by `POST /auth/login`. */
export interface LoginSession {
  readonly session: SessionCookie;
  /** `Set-Cookie` value, for a host that forwards the cookie to a browser. */
  readonly cookieHeader: string;
  /** The CSRF token `protocol.md` §2 requires on same-origin writes. */
  readonly csrfToken?: string;
}

/**
 * Exchanges the installation token for a browser session.
 *
 * `protocol.md` §2: the token is posted once, the answer sets
 * `HttpOnly; SameSite=Strict; Secure` and returns the CSRF token for writes. A
 * wrong token is a `401` and the daemon limits attempts per IP per minute; both
 * surface as typed `ClientError`s and neither is retried here.
 */
export async function httpLogin(options: HttpLoginOptions): Promise<LoginSession> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json',
  };
  if (options.origin !== undefined) headers['origin'] = options.origin;
  let response: Response;
  try {
    response = await fetchImpl(`${options.baseUrl.replace(/\/+$/u, '')}/auth/login`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ token: options.token }),
      ...(options.requestTimeoutMs === undefined
        ? {}
        : { signal: AbortSignal.timeout(options.requestTimeoutMs) }),
    });
  } catch (error) {
    throw ClientError.transport(
      TRANSPORT_ERROR_CODES.transportLost,
      'the login request did not reach the server',
      error,
    );
  }
  const text = await response.text();
  if (!response.ok) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = undefined;
    }
    const body =
      typeof parsed === 'object' && parsed !== null && 'error' in parsed
        ? (parsed as { error?: unknown }).error
        : undefined;
    const failure = errorBodySchema.safeParse(body);
    if (failure.success) throw ClientError.fromBody(failure.data, contractRetryable);
    throw new ClientError({
      code: httpStatusCode(response.status),
      message: `login failed with status ${response.status}`,
      retryable: false,
      details: { status: response.status },
    });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw ClientError.protocol('the login answer was not JSON', { status: response.status });
  }
  const csrfToken = readStringField(parsed, 'csrfToken');
  const cookieHeader = readSetCookie(response) ?? '';
  const cookie = cookieValueOf(cookieHeader);
  if (cookie === undefined) {
    throw ClientError.protocol('the login answer did not set the session cookie', {
      status: response.status,
    });
  }
  return {
    session: { cookie, ...(csrfToken === undefined ? {} : { csrfToken }) },
    cookieHeader,
    ...(csrfToken === undefined ? {} : { csrfToken }),
  };
}

/** Forgets a session on the server. */
export async function httpLogout(options: HttpAuthOptions): Promise<void> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const headers: Record<string, string> = { accept: 'application/json' };
  if (options.origin !== undefined) headers['origin'] = options.origin;
  try {
    await fetchImpl(`${options.baseUrl.replace(/\/+$/u, '')}/auth/logout`, {
      method: 'POST',
      headers,
      ...(options.requestTimeoutMs === undefined
        ? {}
        : { signal: AbortSignal.timeout(options.requestTimeoutMs) }),
    });
  } catch (error) {
    throw ClientError.transport(
      TRANSPORT_ERROR_CODES.transportLost,
      'the logout request did not reach the server',
      error,
    );
  }
}

/** Reads one string field out of an unknown JSON body. */
function readStringField(value: unknown, key: string): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const field: unknown = (value as Record<string, unknown>)[key];
  return typeof field === 'string' && field !== '' ? field : undefined;
}

/** Extracts the session cookie value from a `Set-Cookie` header, if present. */
export function cookieValueOf(setCookie: string): string | undefined {
  const match = new RegExp(`(?:^|[;,\\s])${SESSION_COOKIE_NAME}=([^;,\\s]+)`, 'u').exec(setCookie);
  return match?.[1];
}

/** Reads a `Set-Cookie` header from a fetch response without a DOM lib. */
function readSetCookie(response: Response): string | undefined {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const list = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [];
  if (list.length > 0) return list.join('; ');
  return response.headers.get('set-cookie') ?? undefined;
}

export interface HttpCommandOptions {
  /** Base URL of the BFF, e.g. `http://127.0.0.1:4317`. */
  readonly baseUrl: string;
  /** Injectable for tests; defaults to global `fetch`. */
  readonly fetchImpl?: typeof fetch;
  readonly session?: SessionCookie;
  readonly origin?: string;
  readonly projectId?: string;
  readonly requestTimeoutMs?: number;
}

/**
 * Sends one command over HTTP.
 *
 * `protocol.md` §2: the browser holds an `HttpOnly` session cookie and a CSRF
 * token for same-origin writes. A 401/403 is surfaced as a typed `ClientError`
 * carrying the protocol code and is never retried — only a transport failure is
 * retryable, so an unauthorised request stays a single attempt.
 */
export async function httpCommand<T = unknown>(
  options: HttpCommandOptions,
  method: string,
  params: JsonObject,
): Promise<T> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const body: JsonObject = {
    v: 1,
    type: 'request',
    id: `${REQUEST_ID_PREFIX}http-${Date.now().toString(36)}`,
    method,
    ...(options.projectId === undefined ? {} : { projectId: options.projectId }),
    params,
  };
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json',
    'x-requested-with': 'agentdev-client',
  };
  if (options.origin !== undefined) headers['origin'] = options.origin;
  if (options.session !== undefined) {
    headers['cookie'] = sessionCookieHeader(options.session);
    if (options.session.csrfToken !== undefined) {
      headers['x-csrf-token'] = options.session.csrfToken;
    }
  }
  const timeout = options.requestTimeoutMs;
  let response: Response;
  try {
    response = await fetchImpl(`${options.baseUrl.replace(/\/+$/u, '')}/rpc`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      ...(timeout === undefined ? {} : { signal: AbortSignal.timeout(timeout) }),
    });
  } catch (error) {
    throw ClientError.transport(
      TRANSPORT_ERROR_CODES.transportLost,
      `the ${method} request did not reach the server`,
      error,
    );
  }
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ClientError({
      code:
        response.status === 401 || response.status === 403
          ? httpStatusCode(response.status)
          : 'INTERNAL_ERROR',
      message: `the server answered ${response.status} without a protocol envelope`,
      retryable: false,
      details: { status: response.status, method },
    });
  }
  const envelope = responseEnvelopeSchema.safeParse(parsed);
  if (!envelope.success) {
    throw new ClientError({
      code:
        response.status === 401 || response.status === 403
          ? httpStatusCode(response.status)
          : 'PROTOCOL_MISMATCH',
      message: `the server answered ${response.status} with an invalid response envelope`,
      retryable: false,
      details: { status: response.status, method },
    });
  }
  if (envelope.data.ok) return envelope.data.result as T;
  const failure = errorBodySchema.safeParse(envelope.data.error);
  const body_ = failure.success
    ? failure.data
    : {
        code: 'INTERNAL_ERROR' as const,
        message: 'the server sent a malformed error body',
        retryable: false,
      };
  throw ClientError.fromBody(body_, (value) => isRetryable(value.code));
}

/** Maps an HTTP status onto the protocol code that status implies. */
export function httpStatusCode(
  status: number,
): 'UNAUTHENTICATED' | 'NOT_AUTHORIZED' | 'INTERNAL_ERROR' {
  if (status === 401) return 'UNAUTHENTICATED';
  if (status === 403) return 'NOT_AUTHORIZED';
  return 'INTERNAL_ERROR';
}

/** Retryability of a server error body as the client sees it. */
export function bodyRetryable(body: ErrorBody): boolean {
  return isRetryable(body.code);
}
