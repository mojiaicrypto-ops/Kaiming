/**
 * The BFF's daemon client and its WebSocket bridge.
 *
 * `docs/architecture/protocol.md` §2 is the contract: the BFF is the only side that
 * talks to the daemon; the browser holds a BFF cookie and never a daemon credential.
 * Every browser session gets its **own** daemon socket, opened with the installation
 * credential and the exact `Origin` the daemon allowlists. Frames pass through one
 * mapping table so a browser request id keeps its meaning, while the watermark
 * (`batch_end.scannedThrough`, event cursors) is tracked per subscription so a
 * reconnect resumes from where the browser actually got to — the disconnect state
 * `experience.md` §7 promises and AC-071/AC-078 require.
 *
 * The daemon's frame codec and the BFF's are both hand-written RFC6455 subsets: the
 * dependency policy forbids adding `ws`, and only text frames are involved.
 */
import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import {
  WebSocketTransport,
  backoffDelay,
  httpCommand,
  httpLogin,
  httpLogout,
  systemTimers,
  type BackoffPolicy,
  type Timers,
  type Transport,
} from '@agentdev/client';
import type { JsonObject } from '@agentdev/contracts';

/** The daemon's address, the Origin it allowlists and the installation credential. */
export interface DaemonTarget {
  /** e.g. `http://127.0.0.1:4318`. */
  readonly baseUrl: string;
  /** The exact `Origin` the daemon allowlists for this deployment. */
  readonly origin: string;
  /** Installation credential used as a Bearer token. */
  readonly bearer: string;
  /** Overridable for tests; defaults to global `fetch`. */
  readonly fetchImpl?: typeof fetch;
  readonly requestTimeoutMs?: number;
}

/** The daemon's answer to one RPC envelope, already status-mapped. */
export interface RpcAnswer {
  readonly status: number;
  readonly body: JsonObject;
}

export function wsUrlOf(target: DaemonTarget): string {
  const url = new URL('/ws', target.baseUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

/**
 * Forwards one `/rpc` envelope to the daemon.
 *
 * The BFF's own session cookie and CSRF token are attached here — never the
 * browser's — and the daemon decides the status from its error table, which the BFF
 * passes back verbatim.
 */
export async function forwardRpc(
  target: DaemonTarget,
  input: {
    readonly raw: string;
    readonly session: { readonly cookie: string; readonly csrfToken?: string };
  },
): Promise<RpcAnswer> {
  const fetchImpl = target.fetchImpl ?? globalThis.fetch;
  const response = await fetchImpl(`${target.baseUrl.replace(/\/+$/u, '')}/rpc`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      origin: target.origin,
      cookie: `agentdev_session=${input.session.cookie}`,
      ...(input.session.csrfToken === undefined ? {} : { 'x-csrf-token': input.session.csrfToken }),
    },
    body: input.raw,
    ...(target.requestTimeoutMs === undefined
      ? {}
      : { signal: AbortSignal.timeout(target.requestTimeoutMs) }),
  });
  const text = await response.text();
  const parsed: unknown = text === '' ? {} : safeJson(text);
  return { status: response.status, body: asObject(parsed) };
}

/** Reads one query through the same `/rpc` path a browser would use. */
export async function daemonRead<T = JsonObject>(
  target: DaemonTarget,
  session: { readonly cookie: string; readonly csrfToken?: string },
  method: string,
  params: JsonObject = {},
  projectId?: string,
): Promise<T> {
  return httpCommand<T>(
    {
      baseUrl: target.baseUrl,
      origin: target.origin,
      session,
      ...(target.fetchImpl === undefined ? {} : { fetchImpl: target.fetchImpl }),
      ...(projectId === undefined ? {} : { projectId }),
      ...(target.requestTimeoutMs === undefined
        ? {}
        : { requestTimeoutMs: target.requestTimeoutMs }),
    },
    method,
    params,
  );
}

/** Signs the browser's installation token in through a real daemon session. */
export async function daemonLogin(
  target: DaemonTarget,
  token: string,
): Promise<{ daemonCookie: string; csrfToken: string }> {
  const session = await httpLogin({
    baseUrl: target.baseUrl,
    origin: target.origin,
    token,
    ...(target.fetchImpl === undefined ? {} : { fetchImpl: target.fetchImpl }),
  });
  return {
    daemonCookie: session.session.cookie,
    csrfToken: session.session.csrfToken ?? session.csrfToken ?? '',
  };
}

/** Ends the daemon session a browser session was signed in with. */
export async function daemonLogout(target: DaemonTarget): Promise<void> {
  await httpLogout({
    baseUrl: target.baseUrl,
    origin: target.origin,
    ...(target.fetchImpl === undefined ? {} : { fetchImpl: target.fetchImpl }),
  });
}

// ---------------------------------------------------------------------------
// RFC6455 framing (BFF side)
// ---------------------------------------------------------------------------

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_FRAME_BYTES = 8 * 1024 * 1024;

export interface DecodedFrame {
  readonly opcode: number;
  readonly payload: Buffer;
  readonly consumed: number;
}

/**
 * Decodes one frame from the front of `buffer`.
 *
 * Returns `undefined` when the frame is incomplete; throws on a protocol violation
 * (an unmasked client frame, a reserved bit, an oversized payload).
 */
export function decodeFrame(buffer: Buffer): DecodedFrame | undefined {
  if (buffer.byteLength < 2) return undefined;
  const first = buffer[0] ?? 0;
  const second = buffer[1] ?? 0;
  const fin = (first & 0x80) !== 0;
  if (!fin) throw new Error('fragmented frames are not supported');
  if ((first & 0x70) !== 0) throw new Error('reserved bits must be zero');
  const opcode = first & 0x0f;
  const masked = (second & 0x80) !== 0;
  if (!masked) throw new Error('client frames must be masked');
  let length = second & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (buffer.byteLength < 4) return undefined;
    length = buffer.readUInt16BE(2);
    offset = 4;
  } else if (length === 127) {
    if (buffer.byteLength < 10) return undefined;
    const high = buffer.readUInt32BE(2);
    const low = buffer.readUInt32BE(6);
    if (high !== 0) throw new Error('frame is too large');
    length = low;
    offset = 10;
  }
  if (length > MAX_FRAME_BYTES) throw new Error('frame is too large');
  if (buffer.byteLength < offset + 4 + length) return undefined;
  const mask = buffer.subarray(offset, offset + 4);
  const start = offset + 4;
  const payload = Buffer.allocUnsafe(length);
  for (let index = 0; index < length; index += 1) {
    payload[index] = (buffer[start + index] ?? 0) ^ (mask[index % 4] ?? 0);
  }
  return { opcode, payload, consumed: start + length };
}

/** Encodes one unmasked server frame. */
export function encodeFrame(opcode: number, payload: Buffer): Buffer {
  const header: number[] = [0x80 | opcode];
  if (payload.byteLength < 126) header.push(payload.byteLength);
  else if (payload.byteLength < 65_536) {
    header.push(126, (payload.byteLength >> 8) & 0xff, payload.byteLength & 0xff);
  } else {
    header.push(127, 0, 0, 0, 0);
    header.push(
      (payload.byteLength >>> 24) & 0xff,
      (payload.byteLength >>> 16) & 0xff,
      (payload.byteLength >>> 8) & 0xff,
      payload.byteLength & 0xff,
    );
  }
  return Buffer.concat([Buffer.from(header), payload]);
}

/** The `Sec-WebSocket-Accept` value for one handshake key. */
export function acceptKey(key: string): string {
  return createHash('sha1').update(`${key}${WS_GUID}`).digest('base64');
}

/**
 * A minimal RFC6455 server connection over one upgraded socket.
 *
 * The BFF serves the browser's `/ws` itself; this owns only the framing, so the
 * bridge above it works with strings and never with bytes.
 */
export class BrowserSocket {
  private readonly socket: Duplex;
  private buffer = Buffer.alloc(0);
  private closed = false;
  private readonly onMessage: (text: string) => void;
  private readonly onClose: () => void;

  constructor(
    socket: Duplex,
    handlers: { readonly onMessage: (text: string) => void; readonly onClose: () => void },
  ) {
    this.socket = socket;
    this.onMessage = handlers.onMessage;
    this.onClose = handlers.onClose;
    socket.on('data', (chunk: Buffer) => this.onData(chunk));
    socket.on('close', () => this.finish());
    socket.on('error', () => this.finish());
  }

  get isClosed(): boolean {
    return this.closed;
  }

  send(text: string): void {
    if (this.closed || !this.socket.writable) return;
    this.socket.write(encodeFrame(0x1, Buffer.from(text, 'utf8')));
  }

  close(code: number, reason: string): void {
    if (this.closed) return;
    const reasonBytes = Buffer.from(reason, 'utf8').subarray(0, 123);
    const payload = Buffer.alloc(2 + reasonBytes.byteLength);
    payload.writeUInt16BE(code, 0);
    reasonBytes.copy(payload, 2);
    this.closed = true;
    if (this.socket.writable) this.socket.write(encodeFrame(0x8, payload));
    this.socket.end();
    this.onClose();
  }

  /** Completes an HTTP upgrade for one accepted handshake. */
  static upgrade(socket: Duplex, key: string): void {
    socket.write(
      [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${acceptKey(key)}`,
        '\r\n',
      ].join('\r\n'),
    );
  }

  /** Refuses an upgrade before it is accepted, with a reason header. */
  static refuse(socket: Duplex, status: number, reason: string): void {
    const text = status === 401 ? 'Unauthorized' : status === 403 ? 'Forbidden' : 'Bad Request';
    socket.end(
      [
        `HTTP/1.1 ${String(status)} ${text}`,
        'connection: close',
        `x-agentdev-reason: ${encodeURIComponent(reason)}`,
        '\r\n',
      ].join('\r\n'),
    );
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      let decoded: DecodedFrame | undefined;
      try {
        decoded = decodeFrame(this.buffer);
      } catch (error) {
        // A protocol violation is not recoverable on this socket; say why and close.
        this.close(1002, error instanceof Error ? error.message : 'protocol error');
        return;
      }
      if (decoded === undefined) return;
      this.buffer = this.buffer.subarray(decoded.consumed);
      if (decoded.opcode === 0x8) {
        this.close(1000, 'peer closed');
        return;
      }
      if (decoded.opcode === 0x9) {
        if (!this.closed && this.socket.writable) {
          this.socket.write(encodeFrame(0xa, decoded.payload));
        }
        continue;
      }
      if (decoded.opcode !== 0x1) continue;
      this.onMessage(decoded.payload.toString('utf8'));
    }
  }

  private finish(): void {
    if (this.closed) return;
    this.closed = true;
    this.onClose();
  }
}

// ---------------------------------------------------------------------------
// The bridge: browser envelopes ⇄ one daemon socket
// ---------------------------------------------------------------------------

/** One tracked subscription, so a reconnect resumes from the browser's watermark. */
interface TrackedSubscription {
  readonly key: string;
  readonly scope: JsonObject;
  readonly projectId: string | undefined;
  subscriptionId: string | undefined;
  watermark: number;
  /** Requests whose answer still needs to be matched to this scope. */
  awaitingId: string | undefined;
}

export interface BridgeDependencies {
  /** Builds the daemon transport; injectable so a test can drive a fake daemon. */
  readonly transport?: Transport;
  readonly timers?: Timers;
  readonly backoff?: BackoffPolicy;
  readonly maxReconnectAttempts?: number;
}

const DEFAULT_BRIDGE_BACKOFF: BackoffPolicy = {
  initialDelayMs: 1_000,
  factor: 2,
  maxDelayMs: 30_000,
};

/**
 * Bridges one browser socket to one daemon socket.
 *
 * Ids are translated in both directions: the browser keeps the ids it chose while the
 * daemon sees fresh ones, and a daemon answer is rewritten back before it is
 * forwarded. Subscriptions are tracked so a reconnect re-subscribes with
 * `afterCursor` — the browser then receives exactly the events it missed.
 */
export class BridgeConnection {
  private readonly socket: BrowserSocket;
  private readonly target: DaemonTarget;
  private readonly dependencies: BridgeDependencies;
  private readonly transport: Transport;
  private readonly timers: Timers;
  private readonly backoff: BackoffPolicy;
  private readonly maxAttempts: number;
  private halted = false;
  private started = false;
  private attempt = 0;
  private reconnectHandle: unknown;
  private helloId: string | undefined;
  /** daemon request id → the browser request id (or a tracking token). */
  private readonly pending = new Map<string, string>();
  private readonly subscriptions = new Map<string, TrackedSubscription>();
  private counter = 0;

  constructor(socket: BrowserSocket, target: DaemonTarget, dependencies: BridgeDependencies = {}) {
    this.socket = socket;
    this.target = target;
    this.dependencies = dependencies;
    this.transport =
      dependencies.transport ??
      new WebSocketTransport({
        url: wsUrlOf(target),
        headers: {
          origin: target.origin,
          authorization: `Bearer ${target.bearer}`,
        },
        ...(dependencies.timers === undefined ? {} : { timers: dependencies.timers }),
      });
    this.timers = dependencies.timers ?? systemTimers;
    this.backoff = dependencies.backoff ?? DEFAULT_BRIDGE_BACKOFF;
    this.maxAttempts = dependencies.maxReconnectAttempts ?? 20;
    this.transport.subscribe({
      onOpen: () => this.onDaemonOpen(),
      onMessage: (payload) => this.onDaemonFrame(payload),
      onClose: (code, reason) => this.onDaemonClose(code, reason),
      onError: () => {
        // The close that follows carries the code; no diagnosis is invented here.
      },
    });
  }

  get subscriptionCount(): number {
    return this.subscriptions.size;
  }

  get state(): 'open' | 'connecting' | 'reconnecting' | 'closed' {
    return this.transport.state === 'open'
      ? 'open'
      : this.halted
        ? 'closed'
        : this.attempt === 0
          ? 'connecting'
          : 'reconnecting';
  }

  /** Opens the daemon connection and completes `connection.hello`. */
  start(): void {
    if (this.started || this.halted) return;
    this.started = true;
    try {
      this.transport.open();
    } catch (error) {
      this.socket.close(4000, messageOf(error));
    }
  }

  /** Handles one browser frame; the answer goes back on the same socket. */
  accept(raw: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.sendError(null, 'VALIDATION_ERROR', 'the frame is not JSON');
      return;
    }
    const envelope = parsed as {
      id?: unknown;
      method?: unknown;
      params?: unknown;
      projectId?: unknown;
    };
    const id = typeof envelope.id === 'string' ? envelope.id : null;
    const method = typeof envelope.method === 'string' ? envelope.method : undefined;
    if (method === undefined) {
      this.sendError(id, 'VALIDATION_ERROR', 'the envelope needs a method');
      return;
    }
    if (this.halted || this.transport.state === 'closed') {
      this.sendError(id, 'TRANSPORT_CLOSED', 'the daemon connection is not available');
      return;
    }
    const params = asObject(envelope.params);
    const projectId = typeof envelope.projectId === 'string' ? envelope.projectId : undefined;
    this.counter += 1;
    const localId = `bff-${String(this.counter)}`;
    if (id !== null) this.pending.set(localId, id);
    this.trackRequest(localId, method, params, projectId);
    const frame: JsonObject = {
      v: 1,
      type: 'request',
      id: localId,
      method,
      ...(projectId === undefined ? {} : { projectId }),
      params,
    };
    try {
      this.transport.send(JSON.stringify(frame));
    } catch (error) {
      if (id !== null) this.pending.delete(localId);
      this.sendError(id, 'TRANSPORT_CLOSED', messageOf(error));
    }
  }

  /** Ends the bridge and its daemon connection. */
  stop(): void {
    if (this.halted) return;
    this.halted = true;
    this.clearReconnect();
    this.transport.close();
    this.pending.clear();
  }

  /** Resumes every tracked subscription from its watermark, in order. */
  private reattach(): void {
    for (const tracked of this.subscriptions.values()) {
      this.counter += 1;
      const localId = `bff-resume-${String(this.counter)}`;
      tracked.awaitingId = localId;
      try {
        this.transport.send(
          JSON.stringify({
            v: 1,
            type: 'request',
            id: localId,
            method: 'project.subscribe',
            ...(tracked.projectId === undefined ? {} : { projectId: tracked.projectId }),
            params: {
              scope: tracked.scope,
              ...(tracked.watermark > 0 ? { afterCursor: tracked.watermark } : {}),
            },
          }),
        );
      } catch {
        // The socket went away again; the next close schedules another attempt.
        return;
      }
    }
  }

  private onDaemonOpen(): void {
    if (this.halted) return;
    this.attempt = 0;
    this.counter += 1;
    this.helloId = `bff-hello-${String(this.counter)}`;
    try {
      this.transport.send(
        JSON.stringify({
          v: 1,
          type: 'request',
          id: this.helloId,
          method: 'connection.hello',
          params: { protocolVersion: 1, client: 'web' },
        }),
      );
    } catch (error) {
      this.socket.close(4000, messageOf(error));
      return;
    }
    // The browser is told the connection is live again and may keep its
    // subscriptions; the watermark replay happens per subscription below.
    this.send({ type: 'bridge.open', resumed: this.subscriptions.size });
    this.reattach();
  }

  private onDaemonClose(code: number | undefined, reason: string | undefined): void {
    if (this.halted) return;
    // 1008 is "policy violation" — the daemon uses it for an expired session and a
    // refused Origin; the browser's client must not treat that as retryable.
    if (code === 1008) {
      this.halted = true;
      this.socket.send(
        JSON.stringify({ type: 'close', reason: reason ?? 'the daemon refused the session' }),
      );
      this.socket.close(1008, reason ?? 'the daemon refused the session');
      return;
    }
    if (this.attempt >= this.maxAttempts) {
      this.halted = true;
      this.socket.close(4000, reason ?? 'the daemon connection was lost');
      return;
    }
    this.attempt += 1;
    this.send({ type: 'bridge.reconnecting', attempt: this.attempt });
    const delay = backoffDelay(this.backoff, this.attempt - 1);
    this.reconnectHandle = this.timers.setTimeout(() => {
      this.reconnectHandle = undefined;
      if (this.halted) return;
      try {
        this.transport.open();
      } catch {
        this.onDaemonClose(code, reason);
      }
    }, delay);
  }

  /** Every daemon frame passes here before it is forwarded or consumed. */
  private onDaemonFrame(payload: string): void {
    if (this.halted) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      return;
    }
    const frame = asObject(parsed);
    if (frame['type'] === 'response') {
      const daemonId = typeof frame['id'] === 'string' ? frame['id'] : undefined;
      if (daemonId !== undefined && daemonId === this.helloId) {
        this.helloId = undefined;
        return;
      }
      const browserId = daemonId === undefined ? undefined : this.pending.get(daemonId);
      if (daemonId !== undefined) this.pending.delete(daemonId);
      this.trackResponse(daemonId, frame);
      if (browserId !== undefined) {
        this.socket.send(JSON.stringify({ ...frame, id: browserId }));
      }
      return;
    }
    if (frame['type'] === 'batch_end') {
      this.trackBatchEnd(frame);
      this.socket.send(JSON.stringify(frame));
      return;
    }
    if (frame['type'] === 'event' || frame['type'] === 'close') {
      this.socket.send(JSON.stringify(frame));
    }
  }

  private trackRequest(
    localId: string,
    method: string,
    params: JsonObject,
    projectId: string | undefined,
  ): void {
    if (method !== 'project.subscribe' && method !== 'subscription.set') return;
    const scope = asObject(params['scope']);
    if (scope === undefined) return;
    const kind = typeof scope['kind'] === 'string' ? scope['kind'] : '*';
    const id = typeof scope['id'] === 'string' ? scope['id'] : '*';
    const key = `${projectId ?? '*'}/${kind}/${id}`;
    const afterCursor = params['afterCursor'];
    const tracked: TrackedSubscription = {
      key,
      scope,
      projectId,
      subscriptionId: this.subscriptions.get(key)?.subscriptionId,
      watermark: typeof afterCursor === 'number' ? afterCursor : 0,
      awaitingId: localId,
    };
    this.subscriptions.set(key, tracked);
  }

  /** Reads the subscription id and snapshot cursor out of a subscribe answer. */
  private trackResponse(daemonId: string | undefined, frame: JsonObject): void {
    if (frame['ok'] !== true) return;
    const result = asObject(frame['result']);
    const subscriptionId = result['subscriptionId'];
    if (typeof subscriptionId !== 'string') return;
    for (const tracked of this.subscriptions.values()) {
      if (tracked.subscriptionId === subscriptionId) {
        if (typeof result['cursor'] === 'number') {
          tracked.watermark = Math.max(tracked.watermark, result['cursor']);
        }
        tracked.awaitingId = undefined;
        return;
      }
    }
    if (daemonId === undefined) return;
    for (const tracked of this.subscriptions.values()) {
      if (tracked.awaitingId === daemonId) {
        tracked.subscriptionId = subscriptionId;
        if (typeof result['cursor'] === 'number') tracked.watermark = result['cursor'];
        tracked.awaitingId = undefined;
        return;
      }
    }
  }

  private trackBatchEnd(frame: JsonObject): void {
    const subscriptionId = frame['subscriptionId'];
    const scannedThrough = frame['scannedThrough'];
    if (typeof subscriptionId !== 'string' || typeof scannedThrough !== 'number') return;
    for (const tracked of this.subscriptions.values()) {
      if (tracked.subscriptionId === subscriptionId) {
        tracked.watermark = Math.max(tracked.watermark, scannedThrough);
        return;
      }
    }
  }

  private clearReconnect(): void {
    if (this.reconnectHandle !== undefined) {
      this.timers.clearTimeout(this.reconnectHandle);
      this.reconnectHandle = undefined;
    }
  }

  private sendError(id: string | null, code: string, message: string): void {
    this.counter += 1;
    this.socket.send(
      JSON.stringify({
        v: 1,
        type: 'response',
        id: id ?? `bff-${String(this.counter)}`,
        ok: false,
        error: { code, message, retryable: false },
      }),
    );
  }

  private send(value: JsonObject): void {
    this.socket.send(JSON.stringify(value));
  }
}

/** Handles one HTTP upgrade for `/ws`; returns `true` when this module owned it. */
export function handleUpgrade(input: {
  readonly request: IncomingMessage;
  readonly socket: Duplex;
  readonly target: DaemonTarget;
  readonly authorized: boolean;
  readonly refusalReason?: string;
  readonly dependencies?: BridgeDependencies;
}): boolean {
  const url = new URL(input.request.url ?? '/', 'http://127.0.0.1');
  if (url.pathname !== '/ws') return false;
  if (input.request.headers.upgrade?.toLowerCase() !== 'websocket') {
    BrowserSocket.refuse(input.socket, 400, 'expected a WebSocket upgrade');
    return true;
  }
  if (!input.authorized) {
    BrowserSocket.refuse(input.socket, 401, input.refusalReason ?? 'unauthenticated');
    return true;
  }
  const key = input.request.headers['sec-websocket-key'];
  if (typeof key !== 'string') {
    BrowserSocket.refuse(input.socket, 400, 'missing Sec-WebSocket-Key');
    return true;
  }
  BrowserSocket.upgrade(input.socket, key);
  // The bridge is referenced from the socket's own handlers, so it is built in two
  // steps: the socket needs the connection, and the connection needs the socket.
  const holder: { current?: BridgeConnection } = {};
  const socket = new BrowserSocket(input.socket, {
    onMessage: (text) => holder.current?.accept(text),
    onClose: () => holder.current?.stop(),
  });
  const connection = new BridgeConnection(socket, input.target, input.dependencies ?? {});
  holder.current = connection;
  connection.start();
  return true;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function asObject(value: unknown): JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'the operation failed';
}
