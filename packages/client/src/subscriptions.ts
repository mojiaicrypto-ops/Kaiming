/**
 * Event subscriptions, watermark resume and the scope-expansion guard.
 *
 * `docs/architecture/protocol.md` §2 fixes the contract this module implements:
 * `project.subscribe` carries a `scope` plus an optional `afterCursor`; a scope
 * change answers a fresh snapshot while a same-scope resume uses the cursor; an
 * empty batch still reports its scan watermark through `batch_end`
 * (`{subscriptionId, scannedThrough}`); and a truncated cursor answers
 * `RESYNC_REQUIRED`, after which the client re-subscribes without `afterCursor`.
 *
 * The client keeps its own watermark — the highest cursor it has delivered — so
 * `resume(since)` replays exactly the events after that watermark: an event at or
 * below it is a duplicate and is dropped, an event above it continues the stream.
 * A subscription that names another Project, or a scope the caller is not
 * authorised for, is refused before anything reaches the server (AC-078,
 * "订阅扩大"); the server's own refusal (`RESYNC_REQUIRED`/`NOT_FOUND`/
 * `NOT_AUTHORIZED`) is surfaced as a typed `ClientError` as well.
 */
import {
  PROTOCOL_VERSION,
  eventEnvelopeSchema,
  type EventEnvelope,
  type JsonObject,
} from '@agentdev/contracts';
import {
  ClientError,
  asClientError,
  type ConnectionState,
  type SocketSession,
} from './connection.js';

/** Subscription scopes (`protocol.md` §2 `project.subscribe`). */
export const SCOPE_KINDS = ['summary', 'conversation', 'work', 'run'] as const;
export type ScopeKind = (typeof SCOPE_KINDS)[number];

export interface SubscriptionScope {
  readonly kind: ScopeKind;
  /** Required for every kind except `summary`. */
  readonly id?: string;
}

/** `project.subscribe` result (`protocol.md` §2). */
export interface SubscribeResult {
  readonly subscriptionId: string;
  readonly snapshot?: JsonObject;
  readonly cursor: number;
  readonly mode: 'replay' | 'snapshot';
}

/** `project.events.ack` result. */
export interface AckResult {
  readonly acknowledged: number;
}

/** What the server sent along with the subscription. */
export interface SubscriptionBatch {
  readonly mode: 'replay' | 'snapshot';
  /** Cursor of the snapshot: events after it are delivered live. */
  readonly cursor: number;
  readonly snapshot?: JsonObject;
  /** `batch_end.scannedThrough`, when the server reported an empty batch. */
  readonly scannedThrough?: number;
}

export interface SubscriptionAuthOptions {
  /** `true` when the connection may observe that Project at all. */
  readonly isProjectAuthorized?: (projectId: string) => boolean;
  /** Allows one specific scope; overrides the per-kind default when present. */
  readonly isScopeAuthorized?: (scope: SubscriptionScope) => boolean;
  /** Kinds the caller may subscribe to; defaults to all four. */
  readonly allowedKinds?: readonly ScopeKind[];
}

/** The identity of a subscription: same id ⇒ same cursor stream. */
export function scopeKey(projectId: string | undefined, scope: SubscriptionScope): string {
  return `${projectId ?? '*'}/${scope.kind}/${scope.id ?? '*'}`;
}

/** Stable JSON form used to detect a real scope change versus a resume. */
export function sameScope(left: SubscriptionScope, right: SubscriptionScope): boolean {
  return left.kind === right.kind && left.id === right.id;
}

/** Validates a scope the same way the daemon does, before it reaches the wire. */
export function validateScope(scope: SubscriptionScope): void {
  if (!SCOPE_KINDS.includes(scope.kind)) {
    throw ClientError.validation(`unknown subscription scope kind: ${String(scope.kind)}`);
  }
  if (scope.kind !== 'summary' && (scope.id === undefined || scope.id === '')) {
    throw ClientError.validation(`scope ${scope.kind} requires an id`);
  }
  if (scope.kind === 'summary' && scope.id !== undefined) {
    throw ClientError.validation('scope summary does not take an id');
  }
}

/** The subset of the connection a subscription needs. */
export interface SubscriptionHost {
  readonly state: ConnectionState;
  /** The live session, or `undefined` while disconnected. */
  currentSession(): SocketSession | undefined;
  sendRead<T = unknown>(method: string, params: JsonObject, projectId?: string): Promise<T>;
}

/** The server's refusal of a cursor is recoverable by re-subscribing without one. */
export function isResyncRequired(error: unknown): boolean {
  return error instanceof ClientError && error.code === 'RESYNC_REQUIRED';
}

export interface SubscriptionOptions {
  /** The Project this subscription observes; omitted for global scopes. */
  readonly projectId?: string;
  readonly scope: SubscriptionScope;
  /** Replay strictly after this cursor; omitted means "snapshot me". */
  readonly since?: number;
  /** Seeds the watermark for an idempotent re-subscribe. */
  readonly watermark?: number;
  /** Redirects live events to the connection-level handler as well. */
  readonly onEvent?: (event: EventEnvelope) => void;
  /** Upper bound on buffered events held for a slow reader. */
  readonly maxBuffer?: number;
}

type SubscriptionPhase = 'active' | 'closed';

/**
 * One `project.subscribe` stream.
 *
 * `watermark` is the client's own delivery watermark; `cursor` is what the server
 * last reported. `resume(since)` re-subscribes from the watermark (or an explicit
 * cursor) and never re-delivers an event at or below it.
 */
export class Subscription {
  /** The Project this subscription observes; `undefined` for global scopes. */
  projectId: string | undefined;
  /** The current scope; `setScope` replaces it and asks for a fresh snapshot. */
  scope: SubscriptionScope;
  /** The connection-assigned subscription id; `undefined` until the server answers. */
  subscriptionId: string | undefined;
  private phase: SubscriptionPhase = 'active';
  private serverCursor: number;
  private deliveredWatermark: number;
  private acknowledged = 0;
  private readonly buffer: EventEnvelope[] = [];
  private readonly waiters: (() => void)[] = [];
  private readonly maxBuffer: number;
  private batchValue: SubscriptionBatch | undefined;
  private readyResolve: (() => void) | undefined;
  private readyReject: ((error: ClientError) => void) | undefined;
  private readonly readyPromise: Promise<void>;
  private duplicates = 0;
  private gaps = 0;
  private dropped = 0;
  private readonly onEvent: ((event: EventEnvelope) => void) | undefined;

  constructor(options: SubscriptionOptions) {
    this.projectId = options.projectId;
    this.scope = options.scope;
    this.serverCursor = options.since ?? options.watermark ?? 0;
    this.deliveredWatermark = options.watermark ?? options.since ?? 0;
    this.maxBuffer = options.maxBuffer ?? 1_000;
    this.onEvent = options.onEvent;
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
    // A caller that never awaits `ready()` must not see an unhandled rejection.
    this.readyPromise.catch(() => undefined);
  }

  /** Resolves once the server confirmed the subscription; rejects on refusal. */
  ready(): Promise<void> {
    return this.readyPromise;
  }

  /** Highest cursor delivered to the caller (the watermark for `resume`). */
  get watermark(): number {
    return this.deliveredWatermark;
  }

  /** Cursor the server last reported (the batch/snapshot cursor). */
  get cursor(): number {
    return this.serverCursor;
  }

  /** Highest cursor the caller acknowledged back to the server. */
  get acknowledgedCursor(): number {
    return this.acknowledged;
  }

  get isActive(): boolean {
    return this.phase === 'active';
  }

  /** Delivery diagnostics: duplicates dropped, gaps seen, events dropped by back-pressure. */
  get stats(): {
    readonly duplicates: number;
    readonly gaps: number;
    readonly dropped: number;
    readonly buffered: number;
  } {
    return {
      duplicates: this.duplicates,
      gaps: this.gaps,
      dropped: this.dropped,
      buffered: this.buffer.length,
    };
  }

  /** The batch that opened (or last resumed) this subscription. */
  get batch(): SubscriptionBatch | undefined {
    return this.batchValue;
  }

  /**
   * Marks the server answer; called by the manager.
   *
   * `snapshotReset` discards the old watermark: the server answered a fresh scope
   * snapshot (`protocol.md` §2: a scope change always returns the snapshot), so
   * replaying from the previous cursor would be wrong.
   */
  markActive(result: SubscribeResult, batch: SubscriptionBatch, snapshotReset = false): void {
    this.subscriptionId = result.subscriptionId;
    this.serverCursor = result.cursor;
    if (snapshotReset) {
      this.deliveredWatermark = result.cursor;
      this.buffer.length = 0;
    } else if (this.deliveredWatermark < result.cursor) {
      this.deliveredWatermark = result.cursor;
    }
    this.batchValue = batch;
    this.readyResolve?.();
    this.readyResolve = undefined;
    this.readyReject = undefined;
  }

  /** Fails the subscription before it was ready. */
  markFailed(error: ClientError): void {
    this.readyReject?.(error);
    this.readyResolve = undefined;
    this.readyReject = undefined;
    this.phase = 'closed';
    this.wake();
  }

  /**
   * Applies a scan watermark.
   *
   * `replay` is `false` only for a deliberate snapshot reset (`RESYNC_REQUIRED`),
   * where the old watermark must be discarded; a normal `batch_end` only moves the
   * watermark forward.
   */
  markScannedThrough(cursor: number, replay = true): void {
    if (replay && cursor <= this.deliveredWatermark) return;
    this.deliveredWatermark = cursor;
  }

  /**
   * Delivers one matching event.
   *
   * Returns `'delivered'`, `'duplicate'` or `'gap'` so the caller can assert the
   * watermark invariants. A duplicate is never re-delivered, which is what makes a
   * reconnect replay exact.
   */
  deliver(event: EventEnvelope): 'delivered' | 'duplicate' | 'gap' {
    if (this.phase !== 'active') return 'duplicate';
    if (event.cursor <= this.deliveredWatermark) {
      this.duplicates += 1;
      return 'duplicate';
    }
    const gap = event.cursor !== this.deliveredWatermark + 1;
    this.deliveredWatermark = event.cursor;
    this.serverCursor = Math.max(this.serverCursor, event.cursor);
    if (gap) this.gaps += 1;
    if (this.buffer.length >= this.maxBuffer) {
      // A slow reader loses the oldest buffered event but the watermark is not
      // advanced past it: the caller can `resume` and replay it.
      const dropped = this.buffer.shift();
      if (dropped !== undefined) {
        this.dropped += 1;
        this.deliveredWatermark =
          this.buffer.length === 0
            ? event.cursor
            : (this.buffer[0]?.cursor ?? this.deliveredWatermark);
      }
    }
    this.buffer.push(event);
    this.onEvent?.(event);
    this.wake();
    return gap ? 'gap' : 'delivered';
  }

  /** Events the caller has not consumed yet. */
  async *events(): AsyncGenerator<EventEnvelope, void, undefined> {
    for (;;) {
      while (this.buffer.length > 0) {
        const next = this.buffer.shift();
        if (next !== undefined) yield next;
      }
      if (!this.isActive) return;
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve);
      });
    }
  }

  /** Ends the subscription and any reader loop. */
  close(): void {
    this.phase = 'closed';
    this.markFailed(
      ClientError.transport('TRANSPORT_CLOSED', 'the subscription was closed by the client'),
    );
    this.wake();
  }

  private wake(): void {
    const waiters = this.waiters.splice(0, this.waiters.length);
    for (const waiter of waiters) waiter();
  }
}

export interface SubscriptionManagerOptions extends SubscriptionAuthOptions {
  readonly host: SubscriptionHost;
  /** `(event) => void` for the connection-level handler. */
  readonly onEvent?: (event: EventEnvelope) => void;
}

/**
 * Owns every subscription of one connection.
 *
 * The manager also enforces the local authorisation guard: a scope naming an
 * unknown Project, or a kind outside the caller's allowlist, is refused with
 * `NOT_AUTHORIZED` and never sent. The server's refusal is still authoritative.
 */
export class SubscriptionManager {
  private readonly host: SubscriptionHost;
  private readonly options: SubscriptionAuthOptions;
  private readonly onEvent: ((event: EventEnvelope) => void) | undefined;
  private readonly subscriptions = new Map<string, Subscription>();
  private sequence = 0;
  private resyncs = 0;

  constructor(options: SubscriptionManagerOptions) {
    this.host = options.host;
    this.options = options;
    this.onEvent = options.onEvent;
  }

  get size(): number {
    return this.subscriptions.size;
  }

  /** Subscriptions that asked for a `RESYNC_REQUIRED` cursor and were re-snapshotted. */
  get resyncCount(): number {
    return this.resyncs;
  }

  list(): readonly Subscription[] {
    return [...this.subscriptions.values()];
  }

  /**
   * Subscribes to a scope.
   *
   * A repeated scope resolves to the existing subscription; a different scope
   * always asks for a fresh snapshot (`protocol.md` §2: "范围改变始终返回范围快照").
   */
  async subscribe(options: SubscriptionOptions): Promise<Subscription> {
    const { projectId, scope } = options;
    validateScope(scope);
    this.assertAuthorized(projectId, scope);
    const key = scopeKey(projectId, scope);
    const existing = this.subscriptions.get(key);
    if (existing !== undefined && existing.isActive && sameScope(existing.scope, scope)) {
      if (options.since !== undefined && options.since > existing.watermark) {
        throw ClientError.validation(
          `cannot resume subscription ${key} at ${options.since}: the watermark is ${existing.watermark}`,
        );
      }
      return existing;
    }
    const subscription = new Subscription({
      ...options,
      ...(this.onEvent === undefined ? {} : { onEvent: this.onEvent }),
    });
    this.subscriptions.set(key, subscription);
    // A `since` cursor asks for a replay; no cursor asks for a snapshot
    // (`protocol.md` §2 `project.subscribe`).
    const replay = options.since !== undefined;
    try {
      await this.open(key, subscription, replay);
    } catch (error) {
      if (!isResyncRequired(error)) {
        this.subscriptions.delete(key);
        subscription.markFailed(asClientError(error, 'project.subscribe failed'));
        throw error;
      }
      // The cursor was truncated: re-subscribe without `afterCursor`.
      this.resyncs += 1;
      subscription.markScannedThrough(0, false);
      await this.open(key, subscription, false);
    }
    return subscription;
  }

  /**
   * Replaces the scope of an existing subscription and answers a fresh snapshot.
   *
   * `protocol.md` §2: "范围改变始终返回范围快照" — the request carries no
   * `afterCursor`, and the client resets its watermark to the snapshot cursor.
   */
  async setScope(subscription: Subscription, scope: SubscriptionScope): Promise<Subscription> {
    validateScope(scope);
    this.assertAuthorized(subscription.projectId, scope);
    const previousKey = scopeKey(subscription.projectId, subscription.scope);
    subscription.scope = scope;
    const key = scopeKey(subscription.projectId, scope);
    this.subscriptions.delete(previousKey);
    this.subscriptions.set(key, subscription);
    await this.open(key, subscription, false);
    return subscription;
  }

  /** Removes a subscription from the server and from the manager. */
  async remove(subscription: Subscription): Promise<boolean> {
    const key = scopeKey(subscription.projectId, subscription.scope);
    this.subscriptions.delete(key);
    subscription.close();
    if (subscription.subscriptionId === undefined || this.host.state !== 'open') return false;
    const params = { subscriptionId: subscription.subscriptionId };
    const result = await this.host.sendRead<{ removed?: boolean }>(
      'subscription.remove',
      params,
      subscription.projectId,
    );
    return result.removed === true;
  }

  /** Acknowledges a cursor after the whole batch was applied. */
  async ack(subscription: Subscription, cursor: number): Promise<number> {
    if (subscription.subscriptionId === undefined) {
      throw ClientError.invalidState('the subscription has no server id yet');
    }
    const result = await this.host.sendRead<AckResult>(
      'project.events.ack',
      { subscriptionId: subscription.subscriptionId, cursor },
      subscription.projectId,
    );
    subscription.markScannedThrough(cursor);
    return result.acknowledged;
  }

  /**
   * Replays exactly the events after `since` (defaults to the watermark).
   *
   * The server receives the same `afterCursor`, so the replay is gap-free and the
   * client drops anything at or below its watermark. Returns the batch the server
   * answered with, including `RESYNC_REQUIRED` being handled by a snapshot.
   */
  async resume(subscription: Subscription, since?: number): Promise<SubscriptionBatch> {
    const cursor = since ?? subscription.watermark;
    if (cursor > subscription.watermark) {
      throw ClientError.validation(
        `cannot resume at ${cursor}: the watermark is ${subscription.watermark}`,
      );
    }
    if (cursor < subscription.watermark) {
      // Replaying older events would re-deliver already-seen ones; the client
      // drops them, but a caller asking for the past is a bug worth surfacing.
      subscription.markScannedThrough(cursor);
    }
    const key = scopeKey(subscription.projectId, subscription.scope);
    this.subscriptions.set(key, subscription);
    try {
      await this.open(key, subscription, true, cursor);
    } catch (error) {
      if (!isResyncRequired(error)) throw error;
      this.resyncs += 1;
      subscription.markScannedThrough(0, false);
      await this.open(key, subscription, false, 0);
    }
    return subscription.batch ?? { mode: 'snapshot', cursor: subscription.cursor };
  }

  /** Re-subscribes every active subscription after a reconnect, from its watermark. */
  async reattach(): Promise<void> {
    if (this.subscriptions.size === 0) return;
    for (const subscription of [...this.subscriptions.values()]) {
      if (!subscription.isActive) continue;
      const key = scopeKey(subscription.projectId, subscription.scope);
      try {
        await this.open(key, subscription, true, subscription.watermark);
      } catch (error) {
        subscription.markFailed(asClientError(error, 'the subscription could not be restored'));
      }
    }
  }

  /** Routes one event frame to every matching subscription. */
  handleEvent(event: EventEnvelope): void {
    for (const subscription of [...this.subscriptions.values()]) {
      if (!subscription.isActive) continue;
      if (event.projectId !== subscription.projectId) continue;
      if (subscription.subscriptionId === undefined) continue;
      subscription.deliver(event);
    }
    this.onEvent?.(event);
  }

  /**
   * Routes `batch_end` (`{subscriptionId, scannedThrough}`).
   *
   * The empty-batch watermark belongs to the named subscription; an unknown id is
   * ignored rather than applied to everything.
   */
  handleBatchEnd(subscriptionId: string, scannedThrough: number): void {
    for (const subscription of [...this.subscriptions.values()]) {
      if (!subscription.isActive) continue;
      if (subscription.subscriptionId !== subscriptionId) continue;
      subscription.markScannedThrough(scannedThrough);
      return;
    }
  }

  /** Fails every subscription, e.g. when the connection gives up. */
  closeAll(error?: ClientError): void {
    for (const subscription of [...this.subscriptions.values()]) {
      subscription.markFailed(
        error ?? ClientError.transport('TRANSPORT_CLOSED', 'the connection closed'),
      );
    }
    this.subscriptions.clear();
  }

  private assertAuthorized(projectId: string | undefined, scope: SubscriptionScope): void {
    if (this.options.isScopeAuthorized !== undefined) {
      if (!this.options.isScopeAuthorized(scope)) {
        throw new ClientError({
          code: 'NOT_AUTHORIZED',
          message: `the subscription scope ${scope.kind} is outside this session's authorisation`,
          retryable: false,
          details: { scope },
        });
      }
      return;
    }
    const allowedKinds = this.options.allowedKinds;
    if (allowedKinds !== undefined && !allowedKinds.includes(scope.kind)) {
      throw new ClientError({
        code: 'NOT_AUTHORIZED',
        message: `the subscription kind ${scope.kind} is outside this session's authorisation`,
        retryable: false,
        details: { scope },
      });
    }
    if (
      projectId !== undefined &&
      this.options.isProjectAuthorized !== undefined &&
      !this.options.isProjectAuthorized(projectId)
    ) {
      throw new ClientError({
        code: 'NOT_AUTHORIZED',
        message: `the subscription names project ${projectId}, which this session cannot observe`,
        retryable: false,
        details: { projectId, scope },
      });
    }
  }

  /** Sends one `project.subscribe`, with `afterCursor` only when resuming. */
  private async open(
    key: string,
    subscription: Subscription,
    replay: boolean,
    cursor?: number,
  ): Promise<void> {
    if (this.host.state !== 'open') {
      throw ClientError.transport('TRANSPORT_CLOSED', 'the connection is not open');
    }
    if (subscription.isActive && !replay) {
      // A scope change: the server answers a fresh snapshot and a new id.
      subscription.subscriptionId = undefined;
    }
    const afterCursor = replay ? (cursor ?? subscription.watermark) : undefined;
    const params: JsonObject = {
      scope: {
        kind: subscription.scope.kind,
        ...(subscription.scope.id === undefined ? {} : { id: subscription.scope.id }),
      },
      ...(afterCursor === undefined ? {} : { afterCursor }),
    };
    let result: SubscribeResult;
    try {
      result = await this.host.sendRead<SubscribeResult>(
        'project.subscribe',
        params,
        subscription.projectId,
      );
    } catch (error) {
      const failure = asClientError(error, 'project.subscribe failed');
      // `RESYNC_REQUIRED` is recoverable: the manager re-subscribes without a
      // cursor, so the subscription must stay alive for the retry.
      if (!isResyncRequired(failure)) {
        subscription.markFailed(failure);
        this.subscriptions.delete(key);
      }
      throw failure;
    }
    if (typeof result.subscriptionId !== 'string' || result.subscriptionId === '') {
      const failure = ClientError.protocol('project.subscribe returned no subscriptionId', {
        result,
      });
      subscription.markFailed(failure);
      this.subscriptions.delete(key);
      throw failure;
    }
    const batch: SubscriptionBatch = {
      mode: result.mode,
      cursor: result.cursor,
      ...(result.snapshot === undefined ? {} : { snapshot: result.snapshot }),
    };
    subscription.markActive(result, batch, !replay);
  }
}

/** Parses an event frame and returns `undefined` for anything else. */
export function parseEventFrame(payload: string): EventEnvelope | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return undefined;
  }
  const result = eventEnvelopeSchema.safeParse(parsed);
  return result.success ? result.data : undefined;
}

/** The protocol envelope version this client speaks. */
export const CLIENT_PROTOCOL_VERSION = PROTOCOL_VERSION;
