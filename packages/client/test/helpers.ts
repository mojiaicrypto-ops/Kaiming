/**
 * Offline test doubles for the client package.
 *
 * Nothing here is production code: `FakeTransport` is the in-memory duplex the
 * `Transport` seam exists for, `FakeProtocolServer` speaks the `protocol.md`
 * envelope shapes (cursors, idempotency, the error table), and `TestClock` makes
 * every retry delay deterministic. No socket is opened, so these tests run offline.
 */
import {
  PROTOCOL_VERSION,
  type ErrorCode,
  type EventEnvelope,
  type JsonObject,
} from '@agentdev/contracts';
import {
  ProtocolClient,
  type ClientError,
  type ConnectionStatus,
  type Timers,
  type Transport,
  type TransportListener,
  type TransportState,
  type TransportStatus,
} from '../src/index.js';
import type { ScopeKind } from '../src/subscriptions.js';

/** A clock a test advances by hand; timers due at the same instant fire in order. */
export class TestClock implements Timers {
  private current = 0;
  private nextHandle = 1;
  private readonly timers = new Map<number, { at: number; callback: () => void }>();

  now(): number {
    return this.current;
  }

  setTimeout(callback: () => void, delayMs: number): unknown {
    const handle = this.nextHandle;
    this.nextHandle += 1;
    this.timers.set(handle, { at: this.current + Math.max(0, delayMs), callback });
    return handle;
  }

  clearTimeout(handle: unknown): void {
    if (typeof handle === 'number') this.timers.delete(handle);
  }

  /** Delay until the earliest pending timer, or `undefined` when none is scheduled. */
  nextDelay(): number | undefined {
    let earliest: number | undefined;
    for (const timer of this.timers.values()) {
      if (earliest === undefined || timer.at < earliest) earliest = timer.at;
    }
    return earliest === undefined ? undefined : Math.max(0, earliest - this.current);
  }

  /** Advances the clock to `target`, running every timer that becomes due. */
  async advanceTo(target: number): Promise<void> {
    for (;;) {
      const due = [...this.timers.entries()]
        .filter(([, timer]) => timer.at <= target)
        .sort((left, right) => left[1].at - right[1].at);
      const first = due[0];
      if (first === undefined) break;
      const [handle, timer] = first;
      this.timers.delete(handle);
      this.current = timer.at;
      timer.callback();
      await flush();
    }
    this.current = Math.max(this.current, target);
    await flush();
  }

  /** Advances by `delayMs`, running any timer that becomes due. */
  async advance(delayMs: number): Promise<void> {
    await this.advanceTo(this.current + delayMs);
  }
}

/**
 * Lets queued promise chains and queued transport frames run.
 *
 * A macrotask hop drains the microtask queue completely, including microtasks
 * that queue further microtasks (which a chain of `await Promise.resolve()`
 * would not).
 */
export async function flush(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

interface Waiter {
  readonly resolve: () => void;
}

/**
 * An in-memory duplex used as a `Transport`.
 *
 * `dropNextSends(n)` hands the next `n` frames to the peer but withholds them from
 * the client, which models "the request arrived and the response was lost".
 */
export class FakeTransport implements Transport {
  private readonly listeners = new Set<TransportListener>();
  private currentState: TransportState = 'closed';
  private peer: FakeTransport | undefined;
  private readonly onDeliver: (payload: string) => void;
  private readonly dropOutgoing: ((payload: string) => boolean) | undefined;
  private waiters: Waiter[] = [];
  private closeCode: number | undefined;
  private closeReason: string | undefined;
  private lastError: ClientError | undefined;
  private incoming: string[] = [];
  private scheduled = false;
  private dropRemaining = 0;
  /** Frames this end produced, in order. */
  readonly sent: string[] = [];

  constructor(options: {
    onDeliver: (payload: string) => void;
    /** Predicate evaluated at send time: `true` withholds the frame from the peer. */
    dropOutgoing?: (payload: string) => boolean;
  }) {
    this.onDeliver = options.onDeliver;
    this.dropOutgoing = options.dropOutgoing;
  }

  /** Wires the two ends together; the server end auto-accepts incoming opens. */
  static pair(): { client: FakeTransport; server: FakeTransport } {
    const server = new FakeTransport({ onDeliver: () => undefined });
    server.receivesOnly = true;
    const client = new FakeTransport({ onDeliver: () => undefined });
    client.peer = server;
    server.peer = client;
    return { client, server };
  }

  /** Swallows this many of this end's next frames after the peer sees them. */
  dropNextSends(count: number): void {
    this.dropRemaining += count;
  }

  /** `true` for the server end of a duplex, which is driven, not connected. */
  receivesOnly = false;

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
    this.currentState = 'connecting';
    this.waiters.push({
      resolve: () => {
        if (this.currentState === 'closed') return;
        this.currentState = 'open';
        this.emit((listener) => listener.onOpen());
      },
    });
  }

  /** Completes a pending `open()`. */
  accept(): void {
    const waiters = this.waiters;
    this.waiters = [];
    for (const waiter of waiters) waiter.resolve();
  }

  send(payload: string): void {
    const peer = this.peer;
    if (peer === undefined) throw new Error('the transport has no peer');
    // Only the connecting end has a state: it must be open. The server end is
    // driven by the peer, exactly as a real server writes to a live socket.
    if (!this.receivesOnly && this.currentState !== 'open') {
      throw new Error('the transport is not open');
    }
    this.sent.push(payload);
    if (this.dropOutgoing?.(payload) === true) return;
    if (this.dropRemaining > 0) {
      this.dropRemaining -= 1;
      peer.deliver(payload);
      peer.discard();
      return;
    }
    peer.deliver(payload);
  }

  close(code?: number, reason?: string): void {
    this.closeCode = code;
    this.closeReason = reason;
    this.currentState = 'closed';
    queueMicrotask(() => this.emit((listener) => listener.onClose(code, reason)));
  }

  /** Closes the socket as if the peer went away. */
  drop(code = 1006, reason = 'network lost'): void {
    this.closeCode = code;
    this.closeReason = reason;
    this.currentState = 'closed';
    this.waiters = [];
    queueMicrotask(() => this.emit((listener) => listener.onClose(code, reason)));
  }

  /**
   * Delivers a frame to this end, as its peer's `send` would.
   *
   * Delivery is queued onto a microtask: a real socket never invokes an
   * `onMessage` handler inside the sender's `send` call, and a synchronous
   * delivery would reject a request promise before its caller could attach a
   * handler.
   */
  deliver(payload: string): void {
    this.incoming.push(payload);
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      const frames = this.incoming;
      this.incoming = [];
      for (const frame of frames) this.emit((listener) => listener.onMessage(frame));
    });
  }

  /** Drops frames already handed to this end (the peer "never received" them). */
  discard(): void {
    this.incoming = [];
  }

  private emit(visit: (listener: TransportListener) => void): void {
    for (const listener of [...this.listeners]) visit(listener);
  }
}

/** The Project id every fake server uses unless a test overrides it. */
export const DEFAULT_PROJECT_ID = '0123456789abcdef0123456789abcdef';

export interface FakeServerOptions {
  readonly clock?: TestClock;
  readonly connectionId?: string;
  readonly projectId?: string;
  /** Projects this fake server serves; anything else answers NOT_FOUND. */
  readonly knownProjects?: readonly string[];
  /** Alias of `knownProjects`; defaults to the server's own project id. */
  readonly servedProjects?: readonly string[];
  /** Cursors below this answer RESYNC_REQUIRED, like a truncated window would. */
  readonly retainedFrom?: number;
  /** Overrides write results, e.g. to answer BUSY once or AUTH_EXPIRED. */
  readonly onWrite?: (message: FakeRequest) => FakeWriteOutcome | undefined;
  /** Answers a read method directly; return `undefined` for the default handling. */
  readonly onRead?: (message: FakeRequest) => FakeWriteOutcome | undefined;
  /** Withholds matching frames the fake server sends (a lost answer). */
  readonly dropServerFrames?: (frame: string) => boolean;
  /** Client reconnect budget for the harness; defaults to 3. */
  readonly maxReconnectAttempts?: number;
  /** Client write-retry budget for the harness; defaults to 2. */
  readonly maxWriteRetries?: number;
  /** Subscription kinds the harness client is allowed to observe. */
  readonly allowedKinds?: readonly ScopeKind[];
}

export interface FakeRequest {
  readonly id: string;
  readonly method: string;
  readonly params: Record<string, unknown>;
  readonly projectId?: string;
}

export type FakeWriteOutcome =
  | { readonly status: 'ok'; readonly result: unknown }
  | {
      readonly status: 'error';
      readonly code: ErrorCode;
      readonly retryable?: boolean;
      readonly details?: JsonObject;
    };

interface FakeSubscriptionEntry {
  readonly id: string;
  readonly projectId: string | undefined;
  readonly scope: JsonObject;
  cursor: number;
  registered: boolean;
}

interface IdempotentEntry {
  readonly payload: string;
  readonly result: unknown;
}

/**
 * A protocol server over an in-memory transport.
 *
 * It implements the parts of `protocol.md` the client depends on: the hello
 * handshake, `project.subscribe` with `afterCursor`, `project.events.ack`,
 * `subscription.remove`, cursor-ordered events, `batch_end`, idempotent writes and
 * the shared error codes.
 */
export class FakeProtocolServer {
  readonly requests: FakeRequest[] = [];
  /** Every write idempotency key received, in order. */
  readonly writeKeys: string[] = [];
  /** Every frame received, verbatim (so a retry can be compared byte for byte). */
  readonly rawFrames: string[] = [];
  readonly subscriptions: FakeSubscriptionEntry[] = [];
  readonly clock: TestClock;
  readonly projectId: string;
  connectionId: string;
  /** Every event this server may deliver, in cursor order. */
  readonly log: EventEnvelope[] = [];
  private sequence = 0;
  private eventSequence = 0;
  private readonly idempotent = new Map<string, IdempotentEntry>();
  private readonly servedProjects: readonly string[];
  private readonly retainedFrom: number;
  private readonly onWrite: ((message: FakeRequest) => FakeWriteOutcome | undefined) | undefined;
  private readonly onRead: ((message: FakeRequest) => FakeWriteOutcome | undefined) | undefined;
  /** Set to answer the next hello with PROTOCOL_MISMATCH. */
  failHello = false;

  constructor(options: FakeServerOptions = {}) {
    this.clock = options.clock ?? new TestClock();
    this.projectId = options.projectId ?? DEFAULT_PROJECT_ID;
    this.connectionId = options.connectionId ?? 'connection-1';
    this.servedProjects = options.knownProjects ??
      options.servedProjects ?? [options.projectId ?? DEFAULT_PROJECT_ID];
    this.retainedFrom = options.retainedFrom ?? 0;
    this.onWrite = options.onWrite;
    this.onRead = options.onRead;
  }

  /** Handles one frame from the client. */
  receive(payload: string): void {
    this.rawFrames.push(payload);
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      return;
    }
    if (typeof parsed !== 'object' || parsed === null) return;
    const frame = parsed as {
      type?: unknown;
      id?: unknown;
      method?: unknown;
      params?: unknown;
      projectId?: unknown;
    };
    if (
      frame.type !== 'request' ||
      typeof frame.id !== 'string' ||
      typeof frame.method !== 'string'
    ) {
      return;
    }
    const params =
      typeof frame.params === 'object' && frame.params !== null
        ? (frame.params as Record<string, unknown>)
        : {};
    const message: FakeRequest = {
      id: frame.id,
      method: frame.method,
      params,
      ...(typeof frame.projectId === 'string' ? { projectId: frame.projectId } : {}),
    };
    this.requests.push(message);
    const key = message.params['idempotencyKey'];
    if (typeof key === 'string') this.writeKeys.push(key);
    const injected = this.onWrite?.(message) ?? this.onRead?.(message);
    if (injected !== undefined) {
      if (injected.status === 'error') {
        this.respondError(
          message.id,
          injected.code,
          `injected ${injected.code}`,
          injected.details ?? {},
          injected.retryable,
        );
        return;
      }
      this.respond(message.id, injected.result);
      return;
    }
    switch (message.method) {
      case 'connection.hello':
        this.respondHello(message);
        return;
      case 'project.subscribe':
        this.respondSubscribe(message);
        return;
      case 'project.events.ack':
        this.respond(message.id, { acknowledged: numberField(message.params, 'cursor') });
        return;
      case 'subscription.remove':
        this.subscriptions.splice(
          0,
          this.subscriptions.length,
          ...this.subscriptions.filter(
            (entry) => entry.id !== stringField(message.params, 'subscriptionId'),
          ),
        );
        this.respond(message.id, { removed: true });
        return;
      case 'subscription.set':
        this.respond(message.id, { snapshot: {}, cursor: this.eventSequence });
        return;
      default:
        this.respondWrite(message);
    }
  }

  /** Appends an event but delivers nothing: the test decides when to push it. */
  record(name: string, data: JsonObject = {}, entityId?: string): EventEnvelope {
    return this.append(name, data, entityId);
  }

  /** Appends an event and delivers it to every registered subscription. */
  emit(name: string, data: JsonObject = {}, entityId?: string): EventEnvelope {
    const event = this.append(name, data, entityId);
    this.broadcast(event);
    return event;
  }

  private append(name: string, data: JsonObject, entityId?: string): EventEnvelope {
    this.eventSequence += 1;
    const uuid = `00000000-0000-7000-8000-${String(this.eventSequence).padStart(12, '0')}`;
    const event: EventEnvelope = {
      v: PROTOCOL_VERSION,
      type: 'event',
      eventId: uuid,
      projectId: this.projectId,
      cursor: this.eventSequence,
      name,
      entityId: entityId ?? uuid,
      entityVersion: this.eventSequence,
      data,
    };
    this.log.push(event);
    return event;
  }

  /** Sends a `batch_end` watermark for one subscription. */
  batchEnd(subscriptionId: string, scannedThrough: number): void {
    this.deliverToClient({
      v: PROTOCOL_VERSION,
      type: 'batch_end',
      subscriptionId,
      scannedThrough,
    });
    const entry = this.subscriptions.find((candidate) => candidate.id === subscriptionId);
    if (entry !== undefined && scannedThrough > entry.cursor) entry.cursor = scannedThrough;
  }

  private respondHello(message: FakeRequest): void {
    if (this.failHello) {
      this.failHello = false;
      this.respondError(message.id, 'PROTOCOL_MISMATCH', 'unsupported protocol version');
      return;
    }
    if (message.params['protocolVersion'] !== PROTOCOL_VERSION) {
      this.respondError(message.id, 'PROTOCOL_MISMATCH', 'unsupported protocol version');
      return;
    }
    this.respond(message.id, {
      connectionId: this.connectionId,
      protocolVersion: PROTOCOL_VERSION,
      serverTime: '2026-01-01T00:00:00.000Z',
    });
  }

  private respondSubscribe(message: FakeRequest): void {
    const scopeValue = message.params['scope'];
    const scope: JsonObject =
      typeof scopeValue === 'object' && scopeValue !== null ? (scopeValue as JsonObject) : {};
    const afterCursor = message.params['afterCursor'];
    const since = typeof afterCursor === 'number' ? afterCursor : undefined;
    if (since !== undefined && since < this.retainedFrom) {
      this.respondError(message.id, 'RESYNC_REQUIRED', 'the cursor was truncated', {
        oldestCursor: this.retainedFrom,
      });
      return;
    }
    const projectId = message.projectId ?? this.projectId;
    if (!this.servedProjects.includes(projectId)) {
      // A cross-Project id is NOT_FOUND, never a leak of the other project.
      this.respondError(message.id, 'NOT_FOUND', 'the project does not exist');
      return;
    }
    this.sequence += 1;
    const id = `sub-${this.sequence}`;
    const replay = since !== undefined;
    const entry: FakeSubscriptionEntry = {
      id,
      projectId,
      scope,
      cursor: since ?? this.eventSequence,
      registered: false,
    };
    this.subscriptions.push(entry);
    this.respond(message.id, {
      subscriptionId: id,
      snapshot: replay ? undefined : { scope },
      cursor: entry.cursor,
      mode: replay ? 'replay' : 'snapshot',
    });
    entry.registered = true;
    if (replay) {
      for (const event of this.log) {
        if (event.cursor > entry.cursor) {
          entry.cursor = event.cursor;
          this.deliverEvent(id, event);
        }
      }
      this.batchEnd(id, this.eventSequence);
    }
  }

  private respondWrite(message: FakeRequest): void {
    const key = message.params['idempotencyKey'];
    if (typeof key !== 'string') {
      this.respondError(message.id, 'VALIDATION_ERROR', 'idempotencyKey is required');
      return;
    }
    const payload = JSON.stringify(message.params);
    const existing = this.idempotent.get(key);
    if (existing !== undefined) {
      if (existing.payload !== payload) {
        this.respondError(
          message.id,
          'IDEMPOTENCY_CONFLICT',
          'the key was used with another payload',
        );
        return;
      }
      // Same key and payload: the original result, exactly as `protocol.md` §1 says.
      this.respond(message.id, existing.result);
      return;
    }
    const result = {
      status: 'applied',
      entityId: this.projectId,
      version: this.idempotent.size + 1,
    };
    this.idempotent.set(key, { payload, result });
    this.respond(message.id, result);
  }

  private broadcast(event: EventEnvelope): void {
    for (const entry of [...this.subscriptions]) {
      if (!entry.registered) continue;
      if (event.cursor <= entry.cursor) continue;
      entry.cursor = event.cursor;
      this.deliverEvent(entry.id, event);
      this.batchEnd(entry.id, event.cursor);
    }
  }

  private deliverEvent(subscriptionId: string, event: EventEnvelope): void {
    this.deliverToClient({ ...event, subscriptionId });
  }

  private respond(id: string, result: unknown): void {
    this.deliverToClient({ v: PROTOCOL_VERSION, type: 'response', id, ok: true, result });
  }

  private respondError(
    id: string,
    code: ErrorCode,
    message: string,
    details: JsonObject = {},
    retryable = false,
  ): void {
    this.deliverToClient({
      v: PROTOCOL_VERSION,
      type: 'response',
      id,
      ok: false,
      error: { code, message, retryable, details },
    });
  }

  /** Set by the harness to hand frames to the client transport. */
  deliverToClient: (frame: unknown) => void = () => {};
}

function stringField(params: Record<string, unknown>, key: string): string {
  const value = params[key];
  return typeof value === 'string' ? value : '';
}

function numberField(params: Record<string, unknown>, key: string): number {
  const value = params[key];
  return typeof value === 'number' ? value : 0;
}

/**
 * Makes the server end withhold frames that match `drop`.
 *
 * The transport seam is the substitution point, so this wraps `send` rather than
 * teaching the fake server about loss.
 */
function installDropFilter(transport: FakeTransport, drop: (frame: string) => boolean): void {
  const send = transport.send.bind(transport);
  transport.send = (payload: string) => {
    if (drop(payload)) return;
    send(payload);
  };
}

export interface Harness {
  readonly client: ProtocolClient;
  readonly server: FakeProtocolServer;
  readonly clientTransport: FakeTransport;
  readonly serverTransport: FakeTransport;
  readonly clock: TestClock;
  readonly states: ConnectionStatus[];
}

/**
 * Wires a `ProtocolClient` to a `FakeProtocolServer` over the in-memory duplex.
 *
 * The client's retry limits are small on purpose so a test can exhaust them and
 * assert the documented behaviour; the clock is manual so backoff is exact.
 */
export function createHarness(options: FakeServerOptions = {}): Harness {
  const clock = options.clock ?? new TestClock();
  const server = new FakeProtocolServer({ ...options, clock });
  const states: ConnectionStatus[] = [];
  const { client: clientTransport, server: serverTransport } = FakeTransport.pair();
  if (options.dropServerFrames !== undefined) {
    const drop = options.dropServerFrames;
    installDropFilter(serverTransport, drop);
  }
  // The in-memory socket "connects" as soon as the client asks for it: this
  // listener runs before the client's own `onOpen`, so the open resolves first.
  clientTransport.subscribe({
    onOpen: () => undefined,
    onMessage: () => undefined,
    onClose: () => undefined,
    onError: () => undefined,
  });
  // The in-memory socket "connects" as soon as the client asks for it.
  const originalOpen = clientTransport.open.bind(clientTransport);
  clientTransport.open = () => {
    originalOpen();
    clientTransport.accept();
  };
  const client = new ProtocolClient({
    transport: clientTransport,
    timers: clock,
    client: 'web',
    backoff: { initialDelayMs: 1_000, factor: 2, maxDelayMs: 30_000 },
    maxReconnectAttempts: options.maxReconnectAttempts ?? 3,
    maxWriteRetries: options.maxWriteRetries ?? 2,
    requestTimeoutMs: 60_000,
    connectTimeoutMs: 60_000,
    ...(options.knownProjects === undefined
      ? {}
      : { isProjectAuthorized: (projectId) => options.knownProjects!.includes(projectId) }),
    ...(options.allowedKinds === undefined ? {} : { allowedKinds: options.allowedKinds }),
  });
  server.deliverToClient = (frame) => {
    serverTransport.send(JSON.stringify(frame));
  };
  serverTransport.subscribe({
    onOpen: () => undefined,
    onMessage: (payload) => server.receive(payload),
    onClose: () => undefined,
    onError: () => undefined,
  });
  client.onStateChange((status) => states.push(status));
  return { client, server, clientTransport, serverTransport, clock, states };
}
