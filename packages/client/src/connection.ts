/**
 * Transport, framing and the connection's error vocabulary.
 *
 * `docs/architecture/ARCHITECTURE.md` §2 gives `packages/client` the WebSocket
 * connection and the command/subscription surface; `docs/architecture/protocol.md`
 * §1/§2/§7 fixes the envelopes, the watermark rules and the error table. This
 * module owns the bottom of that stack only: the `Transport` seam (so tests can
 * substitute an in-memory duplex), the Node `WebSocket` implementation, request /
 * response correlation for one socket, the reconnect clock and the protocol error
 * shape.
 *
 * The package adds no third-party dependency: the wire is Node's global
 * `WebSocket` plus the shared `@agentdev/contracts` envelopes.
 */
import type { ErrorBody, ErrorCode, JsonObject } from '@agentdev/contracts';

/** One serialized frame in either direction. */
export type TransportState = 'connecting' | 'open' | 'closed';

export interface TransportStatus {
  readonly state: TransportState;
  /** Close code once the peer or the client closed the socket. */
  readonly code?: number;
  readonly reason?: string;
  readonly error?: ClientError;
}

export interface TransportListener {
  onOpen(): void;
  onMessage(payload: string): void;
  /** The socket went away; `code`/`reason` come from the peer when it sent them. */
  onClose(code?: number, reason?: string): void;
  onError(error: ClientError): void;
}

/**
 * The transport seam.
 *
 * A transport only moves strings: framing, handshakes and the protocol itself stay
 * in this package. Tests substitute an in-memory duplex; production uses
 * `WebSocketTransport`.
 */
export interface Transport {
  readonly state: TransportState;
  readonly status: TransportStatus;
  open(): void;
  send(payload: string): void;
  close(code?: number, reason?: string): void;
  subscribe(listener: TransportListener): () => void;
}

/** Connection lifecycle exposed to callers (`protocol.md` §2 handshake states). */
export type ConnectionState = 'connecting' | 'open' | 'reconnecting' | 'closed';

/** Connection state plus the transport's own close information. */
export interface ConnectionStatus {
  readonly state: ConnectionState;
  /** Consecutive reconnect attempts since the last open socket. */
  readonly attempt: number;
  readonly code?: number;
  readonly reason?: string;
  readonly error?: ClientError;
}

/** Injectable clock: every retry delay goes through it, so tests stay deterministic. */
export interface Timers {
  /** Schedules `callback` after `delayMs`; returns a handle for `clearTimeout`. */
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const systemTimers: Timers = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** Bounded exponential backoff: `delay(attempt) = min(maxDelayMs, initial * factor^attempt)`. */
export interface BackoffPolicy {
  readonly initialDelayMs: number;
  readonly factor: number;
  readonly maxDelayMs: number;
}

/** The reconnect schedule used unless a caller overrides it (1s, 2s, 4s, 8s … 30s). */
export const DEFAULT_BACKOFF: BackoffPolicy = {
  initialDelayMs: 1_000,
  factor: 2,
  maxDelayMs: 30_000,
};

/** Transport-level failures the client raises itself; server codes stay untouched. */
export const TRANSPORT_ERROR_CODES = {
  transportClosed: 'TRANSPORT_CLOSED',
  transportLost: 'TRANSPORT_LOST',
} as const;

export type TransportErrorCode = (typeof TRANSPORT_ERROR_CODES)[keyof typeof TRANSPORT_ERROR_CODES];

/** Codes the client itself can raise, on top of the shared `ERROR_CODES` table. */
export type ClientErrorCode = ErrorCode | TransportErrorCode | 'TIMEOUT';

/** Decides whether a server error body may be retried for this connection. */
export type RetryResolver = (body: ErrorBody) => boolean;

/**
 * A failed request.
 *
 * Codes that came from the daemon are preserved verbatim (`protocol.md` §7: the
 * client renders the reason and the next step); transport and local validation
 * failures use their own codes. `retryable` mirrors the server's answer, except
 * that a lost transport is always worth another attempt.
 */
export class ClientError extends Error {
  readonly code: ClientErrorCode;
  readonly retryable: boolean;
  readonly details: unknown;
  /** The server error body when the failure came from a protocol response. */
  readonly body?: ErrorBody;

  constructor(input: {
    code: ClientErrorCode;
    message: string;
    retryable: boolean;
    details?: unknown;
    body?: ErrorBody;
    cause?: unknown;
  }) {
    super(input.message, input.cause === undefined ? undefined : { cause: input.cause });
    this.name = 'ClientError';
    this.code = input.code;
    this.retryable = input.retryable;
    this.details = input.details;
    if (input.body !== undefined) this.body = input.body;
  }

  /** The session is missing or expired: re-authenticate, never retry as-is. */
  get isAuthenticationError(): boolean {
    return this.code === 'UNAUTHENTICATED' || this.code === 'AUTH_EXPIRED';
  }

  /** The session is valid but the request is outside its authorisation. */
  get isAuthorizationError(): boolean {
    return this.code === 'NOT_AUTHORIZED' || this.code === 'CONTEXT_FORBIDDEN';
  }

  /** The request may be re-sent unchanged (`BUSY`, a lost socket, a timeout). */
  get canRetry(): boolean {
    return this.retryable;
  }

  static fromBody(body: ErrorBody, retryableFor: RetryResolver): ClientError {
    return new ClientError({
      code: body.code,
      message: body.message,
      retryable: retryableFor(body),
      details: body.details,
      body,
    });
  }

  static transport(code: TransportErrorCode, message: string, cause?: unknown): ClientError {
    return new ClientError({
      code,
      message,
      retryable: true,
      ...(cause === undefined ? {} : { cause }),
    });
  }

  static validation(message: string, details?: unknown): ClientError {
    return new ClientError({ code: 'VALIDATION_ERROR', message, retryable: false, details });
  }

  static invalidState(message: string): ClientError {
    return new ClientError({ code: 'INVALID_STATE', message, retryable: false });
  }

  static timeout(method: string, timeoutMs: number): ClientError {
    return new ClientError({
      code: 'TIMEOUT',
      message: `no response for ${method} within ${timeoutMs}ms`,
      retryable: true,
      details: { method, timeoutMs },
    });
  }

  static protocol(message: string, details?: unknown): ClientError {
    return new ClientError({ code: 'PROTOCOL_MISMATCH', message, retryable: false, details });
  }
}

/** A readable form of an unknown thrown value, without `[object Object]`. */
function describeUnknown(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value) ?? typeof value;
  } catch {
    return typeof value;
  }
}

/** Raises a `ClientError` unless the value already is one. */
export function asClientError(error: unknown, fallbackMessage: string): ClientError {
  if (error instanceof ClientError) return error;
  return new ClientError({
    code: 'INTERNAL_ERROR',
    message: error instanceof Error ? error.message : fallbackMessage,
    retryable: false,
    ...(error === undefined ? {} : { details: { error: describeUnknown(error) } }),
  });
}

/** The delay for `attempt` (0-based) under a bounded exponential policy. */
export function backoffDelay(policy: BackoffPolicy, attempt: number): number {
  const safeAttempt = Number.isFinite(attempt) && attempt > 0 ? Math.floor(attempt) : 0;
  const raw = policy.initialDelayMs * policy.factor ** safeAttempt;
  return Math.min(policy.maxDelayMs, Math.max(0, Math.round(raw)));
}

/**
 * Maps a WebSocket close onto a protocol error code.
 *
 * RFC6455 1008 is a policy violation — an Origin or credential the server refuses
 * (`protocol.md` §2) — so it maps to `NOT_AUTHORIZED`. Any other close is a lost
 * connection: a peer that goes away is exactly the AC-054 case, and the bounded
 * backoff decides what happens next.
 */
export function closeCodeToError(
  code: number | undefined,
  reason: string | undefined,
): ClientError {
  const detail = reason === undefined || reason === '' ? 'the socket closed' : reason;
  if (code === 1008) {
    return new ClientError({
      code: 'NOT_AUTHORIZED',
      message: `the server refused the connection: ${detail}`,
      retryable: false,
      details: { code, reason },
    });
  }
  return new ClientError({
    code: TRANSPORT_ERROR_CODES.transportLost,
    message: `the connection was lost: ${detail}`,
    retryable: true,
    details: { code, reason },
  });
}

/** Reads the string payload out of a WebSocket `MessageEvent` without trusting it. */
function messageDataOf(event: unknown): string | undefined {
  if (typeof event !== 'object' || event === null) return undefined;
  const data: unknown = (event as { data?: unknown }).data;
  return typeof data === 'string' ? data : undefined;
}

/** Reads one numeric/string field from a WebSocket close event. */
function closeField(event: unknown, key: 'code' | 'reason'): number | string | undefined {
  if (typeof event !== 'object' || event === null) return undefined;
  const value: unknown = (event as Record<string, unknown>)[key];
  if (key === 'code') return typeof value === 'number' ? value : undefined;
  return typeof value === 'string' ? value : undefined;
}

/** Header bag for the opening handshake (`Origin`, `Cookie`). */
export type HandshakeHeaders = Readonly<Record<string, string>>;

export interface WebSocketTransportOptions {
  readonly url: string;
  /**
   * Headers the Node client sends on the upgrade request. Browsers cannot set
   * these, so a browser deployment authenticates by cookie and the BFF injects the
   * installation credential on its own daemon connection.
   */
  readonly headers?: HandshakeHeaders;
  readonly timers?: Timers;
  /** Milliseconds to wait for the transport to open. */
  readonly openTimeoutMs?: number;
}

const DEFAULT_OPEN_TIMEOUT_MS = 15_000;

/**
 * A `Transport` over Node's built-in `WebSocket`.
 *
 * One instance serves every reconnect: `open()` creates a fresh socket, so the
 * client's backoff policy — not the transport — owns the schedule.
 */
export class WebSocketTransport implements Transport {
  readonly url: string;
  private readonly headers: HandshakeHeaders;
  private readonly timers: Timers;
  private readonly openTimeoutMs: number;
  private readonly listeners = new Set<TransportListener>();
  private socket: WebSocket | undefined;
  private currentState: TransportState = 'closed';
  private closeCode: number | undefined;
  private closeReason: string | undefined;
  private lastError: ClientError | undefined;
  private openTimer: unknown;
  private ending = false;
  /** Frames handed over before the socket opened; flushed in order on `open`. */
  private readonly pendingFrames: string[] = [];
  private closeNotified = false;

  constructor(options: WebSocketTransportOptions) {
    this.url = options.url;
    this.headers = options.headers ?? {};
    this.timers = options.timers ?? systemTimers;
    this.openTimeoutMs = options.openTimeoutMs ?? DEFAULT_OPEN_TIMEOUT_MS;
  }

  get state(): TransportState {
    return this.currentState;
  }

  get status(): TransportStatus {
    return {
      state: this.currentState,
      ...(this.closeCode === undefined ? {} : { code: this.closeCode }),
      ...(this.closeReason === undefined ? {} : { reason: this.closeReason }),
      ...(this.lastError === undefined ? {} : { error: this.lastError }),
    };
  }

  subscribe(listener: TransportListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  open(): void {
    if (this.socket !== undefined) {
      throw ClientError.invalidState('the transport is already open');
    }
    const protocol = new URL(this.url).protocol;
    if (protocol !== 'ws:' && protocol !== 'wss:') {
      throw ClientError.validation(`the transport url must use ws: or wss: (found ${protocol})`);
    }
    this.ending = false;
    this.currentState = 'connecting';
    this.closeCode = undefined;
    this.closeReason = undefined;
    this.closeNotified = false;
    const socket = new WebSocket(
      this.url,
      Object.keys(this.headers).length === 0 ? undefined : { headers: { ...this.headers } },
    );
    this.socket = socket;
    socket.addEventListener('open', () => {
      this.timers.clearTimeout(this.openTimer);
      this.openTimer = undefined;
      this.currentState = 'open';
      this.emit((listener) => listener.onOpen());
      // The transport accepts a frame from the moment `open()` is called, so a
      // caller can write immediately; frames sent before the socket was ready are
      // flushed here in order, exactly like a browser's send buffer.
      const queued = this.pendingFrames.splice(0, this.pendingFrames.length);
      for (const payload of queued) socket.send(payload);
    });
    socket.addEventListener('message', (event: unknown) => {
      const payload = messageDataOf(event);
      if (payload === undefined) {
        const failure = ClientError.protocol('the server sent a non-text WebSocket frame', {
          url: this.url,
        });
        this.emit((listener) => listener.onError(failure));
        return;
      }
      this.emit((listener) => listener.onMessage(payload));
    });
    socket.addEventListener('error', () => {
      // The browser API only reports that something failed and the close event that
      // follows carries the code; no diagnosis is invented here.
      this.lastError = ClientError.transport(
        TRANSPORT_ERROR_CODES.transportLost,
        `the WebSocket to ${this.url} reported an error`,
      );
    });
    socket.addEventListener('close', (event: unknown) => {
      this.timers.clearTimeout(this.openTimer);
      this.openTimer = undefined;
      this.socket = undefined;
      this.currentState = 'closed';
      const code = closeField(event, 'code');
      const reason = closeField(event, 'reason');
      if (typeof code === 'number') this.closeCode = code;
      if (typeof reason === 'string' && reason !== '') this.closeReason = reason;
      this.pendingFrames.length = 0;
      // A socket that never opened cannot be connected any more; report the
      // closure once so the owner schedules its bounded reconnect.
      if (!this.ending && !this.closeNotified) {
        this.closeNotified = true;
        this.emit((listener) => listener.onClose(this.closeCode, this.closeReason));
      }
    });
    this.openTimer = this.timers.setTimeout(() => {
      if (this.socket !== socket || this.currentState === 'open') return;
      this.lastError = ClientError.timeout('transport.open', this.openTimeoutMs);
      socket.close(4000, 'open timeout');
    }, this.openTimeoutMs);
  }

  /**
   * Sends a frame, or buffers it until the socket opens.
   *
   * `protocol.md` §2 makes `connection.hello` the first frame on every socket; the
   * client writes it as soon as the socket is requested, so the transport keeps the
   * documented send buffer instead of failing the handshake on a timing detail.
   */
  send(payload: string): void {
    const socket = this.socket;
    if (socket !== undefined && this.currentState === 'open') {
      socket.send(payload);
      return;
    }
    if (this.ending || this.currentState === 'closed') {
      throw ClientError.transport(
        TRANSPORT_ERROR_CODES.transportClosed,
        'the WebSocket is not open',
      );
    }
    this.pendingFrames.push(payload);
  }

  close(code?: number, reason?: string): void {
    this.ending = true;
    this.timers.clearTimeout(this.openTimer);
    this.openTimer = undefined;
    this.pendingFrames.length = 0;
    const socket = this.socket;
    this.socket = undefined;
    this.currentState = 'closed';
    socket?.close(code ?? 1000, reason ?? 'client closed');
  }

  private emit(visit: (listener: TransportListener) => void): void {
    for (const listener of [...this.listeners]) visit(listener);
  }
}

let sessionCounter = 0;
function nextSessionId(): number {
  sessionCounter += 1;
  return sessionCounter;
}

/** The id prefix every request uses, so a response id is recognisably ours. */
export const REQUEST_ID_PREFIX = 'client-';

/** Where a command goes. Implemented by `SocketSession`. */
export interface CommandSender {
  invoke(
    method: string,
    params: JsonObject,
    options?: { readonly projectId?: string; readonly onSend?: SentHook },
  ): Promise<unknown>;
}

/** `onSend` hook a caller passes to `SocketSession.invoke`. */
export type SentHook = (requestId: string) => void;

interface PendingRequest {
  readonly resolve: (result: unknown) => void;
  readonly reject: (error: ClientError) => void;
  /** Set once the caller took ownership of a retry; such a request is not rejected. */
  detached: boolean;
}

export interface SocketSessionOptions {
  readonly onFrame: (payload: string) => void;
  readonly onClosed: (error: ClientError) => void;
  readonly retryableFor?: RetryResolver;
}

/**
 * One live socket.
 *
 * The session owns request/response correlation for exactly one connection: a
 * response is settled only for an id this session sent, and a closed session
 * rejects everything still open — except requests the caller explicitly detached
 * for a bounded retry.
 */
export class SocketSession implements CommandSender {
  private readonly session: Transport;
  private readonly options: SocketSessionOptions;
  private readonly pending = new Map<string, PendingRequest>();
  private sequence = 0;
  private closed = false;

  /** Process-unique id, for diagnostics and tests that must compare sessions. */
  readonly sessionId: string = `session-${nextSessionId()}`;

  constructor(session: Transport, options: SocketSessionOptions) {
    this.session = session;
    this.options = options;
  }

  get transport(): Transport {
    return this.session;
  }

  /** `true` when a frame of this payload belongs to a pending request of this session. */
  get isClosed(): boolean {
    return this.closed;
  }

  /** Routes one frame into the session's response correlation. */
  handleFrame(payload: string): boolean {
    return this.settleResponse(payload);
  }

  /** Requests that were sent and are still awaiting a response. */
  get inFlightCount(): number {
    return this.pending.size;
  }

  invoke(
    method: string,
    params: JsonObject,
    options: { readonly projectId?: string; readonly onSend?: SentHook } = {},
  ): Promise<unknown> {
    if (this.closed) {
      return Promise.reject(
        ClientError.transport(TRANSPORT_ERROR_CODES.transportClosed, 'the session is closed'),
      );
    }
    this.sequence += 1;
    const id = `${REQUEST_ID_PREFIX}${this.sequence}`;
    const request = {
      v: 1,
      type: 'request',
      id,
      method,
      ...(options.projectId === undefined ? {} : { projectId: options.projectId }),
      params,
    } satisfies JsonObject;
    let payload: string;
    try {
      payload = JSON.stringify(request);
    } catch (error) {
      return Promise.reject(
        ClientError.validation(`the params of ${method} are not JSON-serializable`, {
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
    const promise = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, detached: false });
    });
    try {
      this.session.send(payload);
    } catch (error) {
      this.pending.delete(id);
      const failure = asClientError(error, 'the request could not be sent');
      return Promise.reject(
        ClientError.transport(
          TRANSPORT_ERROR_CODES.transportLost,
          `the request ${method} could not be sent: ${failure.message}`,
          failure,
        ),
      );
    }
    options.onSend?.(id);
    return promise;
  }

  /**
   * Takes a request out of this session without rejecting it, so a caller can
   * replay it after a reconnect. `detach` is idempotent: a request the session
   * never registered is already detached.
   */
  detach(requestId: string): void {
    const pending = this.pending.get(requestId);
    if (pending === undefined) return;
    pending.detached = true;
    this.pending.delete(requestId);
  }

  /**
   * Rejects everything still open and reports the closure to the owner.
   *
   * Called when the socket goes away or the client ends the connection, so a
   * connection can never keep a dead session in charge of its state.
   */
  close(error: ClientError): void {
    if (this.closed) return;
    this.closed = true;
    const pending = [...this.pending.values()];
    this.pending.clear();
    for (const entry of pending) {
      if (!entry.detached) entry.reject(error);
    }
    this.options.onClosed(error);
  }

  private retryableFor(body: ErrorBody): boolean {
    return this.options.retryableFor?.(body) ?? body.retryable;
  }

  /**
   * Settles the request whose id this frame carries.
   *
   * `true` means the frame was a protocol response belonging to this session — a
   * malformed response envelope also settles its request (as a `PROTOCOL_MISMATCH`)
   * so a bad server answer can never leave a caller hanging.
   */
  settleResponse(payload: string): boolean {
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      return false;
    }
    if (typeof parsed !== 'object' || parsed === null) return false;
    const id: unknown = (parsed as { id?: unknown }).id;
    if (typeof id !== 'string') return false;
    const pending = this.pending.get(id);
    if (pending === undefined) return false;
    this.pending.delete(id);
    const envelope = parsed as { ok?: unknown; result?: unknown; error?: unknown };
    if (envelope.ok === true) {
      pending.resolve(envelope.result);
      return true;
    }
    if (envelope.ok === false && typeof envelope.error === 'object' && envelope.error !== null) {
      const body = envelope.error as ErrorBody;
      pending.reject(ClientError.fromBody(body, (value) => this.retryableFor(value)));
      return true;
    }
    pending.reject(
      ClientError.protocol('the response envelope carried neither a result nor an error', {
        payload,
      }),
    );
    return true;
  }
}
