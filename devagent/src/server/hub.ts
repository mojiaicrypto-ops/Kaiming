/**
 * Per-session live events (M4): every Pi session event and every business invalidation is published
 * here with a monotonic sequence number, and a subscription is a bounded buffer prepared *before* the
 * snapshot is read, so the browser can continue from a boundary without losing or duplicating events.
 *
 * The hub never blocks the work: a slow or vanished reader overflows its own buffer and is told to
 * resync, while Pi and other readers carry on. A disconnected reader is torn down; the run is not.
 */
import { randomUUID } from 'node:crypto';

export interface StreamEvent {
  readonly seq: number;
  readonly event: unknown;
  /** The input an event belongs to, when the association is real. */
  readonly inputId?: string;
  /** The Pi instance generation this event came from (serverEpoch/claim). */
  readonly epoch?: string;
}

export interface Subscription {
  readonly subscriptionId: string;
  readonly sessionId: string;
  readonly actor: string;
  /** The epoch of the boundary; adopted from the first real event when none existed yet. */
  epoch: string;
  /** Events at or below this sequence are already in the snapshot. */
  readonly boundary: number;
  readonly buffer: StreamEvent[];
  overflowed: boolean;
  expiresAt: number;
  claimed: boolean;
  /**
   * A boundary taken before any Pi instance existed adopts the instance that starts; afterwards a
   * different generation is a real change and the reader resyncs (M4).
   */
  adopted: boolean;
  /** Attached by the stream handler once it owns the subscription. */
  deliver?: (event: StreamEvent) => void;
}

export interface HubOptions {
  /** How many events one subscription may buffer before it is told to resync. */
  readonly bufferLimit?: number;
  /** How long a prepared subscription waits for its stream request. */
  readonly prepareTtlMs?: number;
  readonly now?: () => number;
}

export class SessionEventHub {
  private readonly subscriptions = new Map<string, Subscription>();
  private readonly sequences = new Map<string, number>();
  private readonly bufferLimit: number;
  private readonly prepareTtlMs: number;
  private readonly now: () => number;

  constructor(options: HubOptions = {}) {
    this.bufferLimit = options.bufferLimit ?? 500;
    this.prepareTtlMs = options.prepareTtlMs ?? 30_000;
    this.now = options.now ?? (() => Date.now());
  }

  /** The next sequence number for a session: the snapshot boundary and every later event share it. */
  currentSequence(sessionId: string): number {
    return this.sequences.get(sessionId) ?? 0;
  }

  /**
   * Prepare a subscription: buffering starts now, the caller then reads the snapshot and returns the
   * boundary it captured, so nothing between the two is lost and nothing before it is replayed.
   */
  prepare(params: { sessionId: string; actor: string; epoch: string }): Subscription {
    this.sweepExpired();
    const subscriptionId = randomUUID();
    const subscription: Subscription = {
      subscriptionId,
      sessionId: params.sessionId,
      actor: params.actor,
      epoch: params.epoch,
      boundary: this.currentSequence(params.sessionId),
      buffer: [],
      overflowed: false,
      expiresAt: this.now() + this.prepareTtlMs,
      claimed: false,
      // Generation 0 means no instance existed when the boundary was taken, so the first real
      // epoch is adopted; otherwise the boundary's epoch is already authoritative.
      adopted: !params.epoch.endsWith(':0'),
    };
    this.subscriptions.set(subscriptionId, subscription);
    return subscription;
  }

  /** Publish one live event; only prepared subscriptions for that session receive it. */
  publish(sessionId: string, event: unknown, meta: { inputId?: string; epoch?: string } = {}): StreamEvent {
    this.sweepExpired();
    const seq = this.currentSequence(sessionId) + 1;
    this.sequences.set(sessionId, seq);
    const published: StreamEvent = {
      seq,
      event,
      ...(meta.inputId !== undefined ? { inputId: meta.inputId } : {}),
      ...(meta.epoch !== undefined ? { epoch: meta.epoch } : {}),
    };
    for (const subscription of this.subscriptions.values()) {
      if (subscription.sessionId !== sessionId) {
        continue;
      }
      if (subscription.claimed) {
        // A live reader is fed directly; the stream handler decides what to do with back-pressure.
        subscription.deliver?.(published);
        continue;
      }
      if (subscription.buffer.length >= this.bufferLimit) {
        // A reader that cannot keep up learns to resync instead of slowing the work down.
        subscription.overflowed = true;
        subscription.buffer.length = 0;
        continue;
      }
      subscription.buffer.push(published);
    }
    return published;
  }

  /**
   * Take over a prepared subscription for its stream request. Returns the reason when the caller must
   * resync (unknown, expired, already claimed, other actor or another session) instead of a stream.
   */
  take(params: { subscriptionId: string; sessionId: string; actor: string }):
    | { readonly kind: 'ok'; readonly subscription: Subscription }
    | { readonly kind: 'resync'; readonly reason: 'unknown' | 'expired' | 'taken' | 'forbidden' } {
    const subscription = this.subscriptions.get(params.subscriptionId);
    if (subscription === undefined) {
      return { kind: 'resync', reason: 'unknown' };
    }
    if (subscription.claimed) {
      return { kind: 'resync', reason: 'taken' };
    }
    if (subscription.sessionId !== params.sessionId || subscription.actor !== params.actor) {
      return { kind: 'resync', reason: 'forbidden' };
    }
    if (this.now() > subscription.expiresAt) {
      this.subscriptions.delete(subscription.subscriptionId);
      return { kind: 'resync', reason: 'expired' };
    }
    subscription.claimed = true;
    return { kind: 'ok', subscription };
  }

  /** Drop a subscription (stream closed, resynced or expired). */
  release(subscriptionId: string): void {
    this.subscriptions.delete(subscriptionId);
  }

  /**
   * Drop subscriptions nobody ever took inside their short TTL: a prepared-but-abandoned reader must
   * not grow the map (or cost a scan per published event) for the life of the process (M4).
   */
  private sweepExpired(): void {
    const now = this.now();
    for (const subscription of this.subscriptions.values()) {
      if (!subscription.claimed && now > subscription.expiresAt) {
        this.subscriptions.delete(subscription.subscriptionId);
      }
    }
  }

  /** How many subscriptions are waiting for or holding a stream (diagnostics and tests). */
  get size(): number {
    return this.subscriptions.size;
  }
}
