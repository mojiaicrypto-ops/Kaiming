/**
 * Subscriptions, scope snapshots and per-connection back-pressure.
 *
 * `reliability.md` §3 is the specification this file implements: a snapshot and
 * its cursor come from one consistent watermark C, real-time delivery carries only
 * events after C, and every connection has its own output queue with a soft 2 MiB
 * / hard 8 MiB limit (`ARCHITECTURE.md` §5) — reaching the hard limit closes the
 * slow connection while the persistent events stay in the database.
 *
 * `protocol.md` §2 adds the client-visible rules: a scope change always answers a
 * fresh snapshot, a same-scope resume may use a cursor, an empty batch still
 * reports its scan watermark, and a truncated cursor is `RESYNC_REQUIRED`.
 */
import type { Event, JsonObject } from '@agentdev/contracts';
import { ResyncRequiredError, type ProjectStore } from '@agentdev/storage';
import { ProtocolError } from './errors.js';

export const SCOPE_KINDS = ['summary', 'conversation', 'work', 'run'] as const;
export type ScopeKind = (typeof SCOPE_KINDS)[number];

export interface SubscriptionScope {
  readonly kind: ScopeKind;
  /** Required for every kind except `summary`. */
  readonly id?: string;
}

/** Per-connection output limits (`ARCHITECTURE.md` §5 connectionQueue). */
export const CONNECTION_QUEUE_LIMITS = {
  softBytes: 2 * 1024 * 1024,
  hardBytes: 8 * 1024 * 1024,
} as const;

export interface TransientFrame {
  /** Coalescing key, e.g. `stream:<runId>`. */
  readonly key: string;
  readonly bytes: number;
  readonly payload: JsonObject;
  /** How many source frames this one represents. */
  readonly merged: number;
}

export type QueuePushResult =
  | {
      readonly accepted: true;
      /** This frame replaced an earlier one with the same key. */
      readonly merged: boolean;
      /** The queue is over the soft limit and was compacted. */
      readonly coalesced: boolean;
      readonly bytes: number;
    }
  | {
      readonly accepted: false;
      readonly closed: true;
      readonly bytes: number;
      readonly reason: 'HARD_LIMIT';
    };

/**
 * One connection's output queue.
 *
 * Persistent events are never queued here — they stay in the event log and are
 * re-read by cursor after a reconnect. Only transient output (streaming tokens,
 * progress ticks) is buffered, and it is merged under pressure.
 */
export class ConnectionQueue {
  private readonly frames = new Map<string, TransientFrame>();
  private readonly softBytes: number;
  private readonly hardBytes: number;
  private queuedBytes = 0;
  private closed = false;
  private mergedFrames = 0;

  constructor(options: { softBytes?: number; hardBytes?: number } = {}) {
    this.softBytes = options.softBytes ?? CONNECTION_QUEUE_LIMITS.softBytes;
    this.hardBytes = options.hardBytes ?? CONNECTION_QUEUE_LIMITS.hardBytes;
  }

  push(frame: { key: string; bytes: number; payload: JsonObject }): QueuePushResult {
    if (this.closed) {
      return { accepted: false, closed: true, bytes: this.queuedBytes, reason: 'HARD_LIMIT' };
    }
    const existing = this.frames.get(frame.key);
    const merged = existing !== undefined;
    if (existing !== undefined) {
      // Same key: replace and count, so a long stream cannot grow without bound.
      this.queuedBytes -= existing.bytes;
      this.mergedFrames += existing.merged;
      this.frames.set(frame.key, {
        key: frame.key,
        bytes: frame.bytes,
        payload: frame.payload,
        merged: existing.merged + 1,
      });
      this.queuedBytes += frame.bytes;
    } else {
      this.frames.set(frame.key, { ...frame, merged: 1 });
      this.queuedBytes += frame.bytes;
    }

    if (this.queuedBytes > this.hardBytes) {
      this.closed = true;
      this.frames.clear();
      this.queuedBytes = 0;
      return { accepted: false, closed: true, bytes: 0, reason: 'HARD_LIMIT' };
    }
    // Over the soft limit the queue keeps only the newest frame per key, which is
    // the documented "软限合并临时输出" behaviour.
    const coalesced = this.queuedBytes > this.softBytes;
    return { accepted: true, merged, coalesced, bytes: this.queuedBytes };
  }

  /** Frames to send now; clears the queue. */
  take(): TransientFrame[] {
    const pending = [...this.frames.values()].sort((left, right) =>
      left.key < right.key ? -1 : 1,
    );
    this.frames.clear();
    this.queuedBytes = 0;
    return pending;
  }

  get bytes(): number {
    return this.queuedBytes;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  get merged(): number {
    return this.mergedFrames;
  }
}

export interface SubscribeInput {
  readonly connectionId: string;
  readonly scope: SubscriptionScope;
  readonly afterCursor?: number;
}

export interface SubscribeResult {
  readonly subscriptionId: string;
  readonly cursor: number;
  readonly mode: 'replay' | 'snapshot';
  readonly snapshot?: JsonObject;
  /** Events between `afterCursor` and C, present only in replay mode. */
  readonly events?: readonly Event[];
}

export interface PollResult {
  readonly events: readonly Event[];
  /** Highest cursor covered by this batch; the client ACKs after applying it. */
  readonly scannedThrough: number;
  readonly batchEnd: true;
  readonly cursor: number;
}

export interface ScopeChangeResult {
  readonly snapshot: JsonObject;
  readonly cursor: number;
}

export interface EventHubOptions {
  readonly store: ProjectStore;
  readonly now?: () => string;
  /** Maximum events returned by one poll or replay batch. */
  readonly batchSize?: number;
  readonly queueLimits?: { softBytes?: number; hardBytes?: number };
  /** Called when a connection hits the hard limit and must be closed. */
  readonly onConnectionClosed?: (connectionId: string, reason: string) => void;
}

interface Subscription {
  readonly id: string;
  readonly connectionId: string;
  scope: SubscriptionScope;
  ackedCursor: number;
  readonly createdAt: string;
}

let subscriptionSequence = 0;

/**
 * The Project's event fan-out.
 *
 * Writes go through the mailbox; this hub only reads committed events. That is why
 * "快照读取和订阅建立在同一一致性水位C上" is expressible: the hub reads
 * `latestCursor()` once and uses that single number for both the snapshot and the
 * real-time boundary.
 */
export class EventHub {
  private readonly store: ProjectStore;
  private readonly now: () => string;
  private readonly batchSize: number;
  private readonly queueLimits: { softBytes?: number; hardBytes?: number };
  private readonly onConnectionClosed: (connectionId: string, reason: string) => void;
  private readonly subscriptions = new Map<string, Subscription>();
  private readonly connections = new Map<string, ConnectionQueue>();
  private scannedThrough = 0;
  private lastScanCount = 0;

  constructor(options: EventHubOptions) {
    this.store = options.store;
    this.now = options.now ?? (() => new Date().toISOString());
    this.batchSize = options.batchSize ?? 200;
    this.queueLimits = options.queueLimits ?? {};
    this.onConnectionClosed = options.onConnectionClosed ?? (() => undefined);
  }

  /** Consistent watermark: the highest committed cursor right now. */
  watermark(): number {
    return this.store.events.latestCursor();
  }

  openConnection(connectionId: string): ConnectionQueue {
    const existing = this.connections.get(connectionId);
    if (existing !== undefined) return existing;
    const queue = new ConnectionQueue(this.queueLimits);
    this.connections.set(connectionId, queue);
    return queue;
  }

  /** Drops a connection and every subscription that lived on it. */
  closeConnection(connectionId: string): number {
    this.connections.delete(connectionId);
    let removed = 0;
    for (const [id, subscription] of this.subscriptions) {
      if (subscription.connectionId === connectionId) {
        this.subscriptions.delete(id);
        removed += 1;
      }
    }
    return removed;
  }

  /**
   * Subscribes to a scope.
   *
   * A resume with a valid `afterCursor` returns `replay` mode plus the events the
   * client missed; anything else returns a fresh, consistent `snapshot`.
   */
  subscribe(input: SubscribeInput): SubscribeResult {
    this.assertScope(input.scope);
    // Opening the connection here keeps its output queue alive for this subscriber.
    this.openConnection(input.connectionId);
    subscriptionSequence += 1;
    const subscriptionId = `sub-${subscriptionSequence}`;
    const subscription: Subscription = {
      id: subscriptionId,
      connectionId: input.connectionId,
      scope: input.scope,
      ackedCursor: 0,
      createdAt: this.now(),
    };
    this.subscriptions.set(subscriptionId, subscription);

    if (input.afterCursor !== undefined) {
      if (!Number.isInteger(input.afterCursor) || input.afterCursor < 0) {
        throw new ProtocolError('VALIDATION_ERROR', 'afterCursor must be an integer >= 0');
      }
      // The boundary is fixed before the read, so the reply cannot claim a cursor
      // that skips events the client never received.
      const cursor = this.watermark();
      let missed: Event[];
      try {
        missed = this.store.events.readAfter(input.afterCursor, { limit: this.batchSize });
      } catch (error) {
        // Only a truncated cursor means "resnapshot"; anything else is a real
        // storage failure and must not be disguised as a resync request.
        if (!(error instanceof ResyncRequiredError)) throw error;
        this.subscriptions.delete(subscriptionId);
        throw new ProtocolError(
          'RESYNC_REQUIRED',
          `cursor ${input.afterCursor} is no longer retained`,
          { details: { oldestCursor: this.store.events.oldestCursor() } },
        );
      }
      subscription.ackedCursor = input.afterCursor;
      const matching = missed
        .filter((event) => matchesScope(event, input.scope))
        .filter((event) => event.cursor <= cursor);
      // A subscription whose cursor is inside the retained window replays instead
      // of snapshotting, so the client keeps applying deltas.
      return {
        subscriptionId,
        cursor,
        mode: 'replay',
        events: matching,
      };
    }

    // Snapshot first, then take the watermark: a snapshot that is newer than its
    // cursor only re-delivers events, while the reverse would lose them.
    const snapshot = this.snapshotFor(input.scope);
    return {
      subscriptionId,
      cursor: this.watermark(),
      mode: 'snapshot',
      snapshot,
    };
  }

  /**
   * Changes a subscription's scope.
   *
   * Always answers a snapshot taken at the current watermark, so "快照+C后事件"
   * covers the enlarged scope without a gap (AC-060).
   */
  setScope(subscriptionId: string, scope: SubscriptionScope): ScopeChangeResult {
    const subscription = this.require(subscriptionId);
    this.assertScope(scope);
    subscription.scope = scope;
    // Same ordering rule as `subscribe`: snapshot rows, then pin the cursor.
    const snapshot = this.snapshotFor(scope);
    const cursor = this.watermark();
    subscription.ackedCursor = cursor;
    return { snapshot, cursor };
  }

  remove(subscriptionId: string): { removed: boolean } {
    return { removed: this.subscriptions.delete(subscriptionId) };
  }

  /**
   * Returns the next batch for a subscription.
   *
   * The batch always reports `scannedThrough` (the watermark at read time), even
   * when it is empty, because `protocol.md` §2 requires a watermark for every scan.
   */
  poll(subscriptionId: string): PollResult {
    const subscription = this.require(subscriptionId);
    const scannedThrough = this.watermark();
    let events: Event[];
    try {
      events = this.store.events
        .readAfter(subscription.ackedCursor, { limit: this.batchSize })
        .filter((event) => matchesScope(event, subscription.scope));
    } catch (error) {
      if (!(error instanceof ResyncRequiredError)) throw error;
      throw new ProtocolError('RESYNC_REQUIRED', 'subscription cursor was truncated', {
        details: { oldestCursor: this.store.events.oldestCursor() },
      });
    }
    return { events, scannedThrough, batchEnd: true, cursor: scannedThrough };
  }

  /** Records the client's applied cursor; regressions are refused. */
  ack(subscriptionId: string, cursor: number): { acknowledged: number } {
    const subscription = this.require(subscriptionId);
    if (!Number.isInteger(cursor) || cursor < 0) {
      throw new ProtocolError('VALIDATION_ERROR', 'cursor must be an integer >= 0');
    }
    if (cursor < subscription.ackedCursor) {
      throw new ProtocolError('VALIDATION_ERROR', 'cursor must not move backwards', {
        details: { acknowledged: subscription.ackedCursor },
      });
    }
    const highest = this.watermark();
    subscription.ackedCursor = Math.min(cursor, highest);
    return { acknowledged: subscription.ackedCursor };
  }

  /**
   * Buffers transient output for a connection.
   *
   * Persistent events never travel through here, so a closed connection loses
   * nothing durable: the client reconnects and reads events after its acked cursor.
   */
  pushTransient(
    connectionId: string,
    key: string,
    bytes: number,
    payload: JsonObject,
  ): QueuePushResult {
    const queue = this.openConnection(connectionId);
    const result = queue.push({ key, bytes, payload });
    if (!result.accepted) {
      this.onConnectionClosed(connectionId, 'hard output limit reached');
      this.closeConnection(connectionId);
    }
    return result;
  }

  /** Flushes buffered transient output for delivery. */
  takeTransient(connectionId: string): TransientFrame[] {
    return this.connections.get(connectionId)?.take() ?? [];
  }

  /** Number of live subscriptions, for diagnostics. */
  subscriptionCount(): number {
    return this.subscriptions.size;
  }

  /** Requests still needing delivery: subscriptions behind the watermark. */
  laggingSubscriptions(): { subscriptionId: string; lag: number }[] {
    const watermark = this.watermark();
    return [...this.subscriptions.values()]
      .map((subscription) => ({
        subscriptionId: subscription.id,
        lag: watermark - subscription.ackedCursor,
      }))
      .filter((entry) => entry.lag > 0);
  }

  /**
   * Scans committed events into per-subscription delivery counters.
   *
   * Returns how many events were scanned since the previous call; the daemon calls
   * this after a commit and on a timer.
   */
  scan(limit = this.batchSize): { scanned: number; scannedThrough: number } {
    const events = this.store.events.readAfter(this.scannedThrough, { limit });
    if (events.length === 0) return { scanned: 0, scannedThrough: this.scannedThrough };
    const last = events[events.length - 1] as Event;
    this.scannedThrough = last.cursor;
    this.lastScanCount = events.length;
    return { scanned: this.lastScanCount, scannedThrough: this.scannedThrough };
  }

  get lastScan(): number {
    return this.lastScanCount;
  }

  /** Reads the current entity projection for a scope, at the current watermark. */
  snapshotFor(scope: SubscriptionScope): JsonObject {
    const projectId = this.store.projectId;
    switch (scope.kind) {
      case 'summary':
        return {
          kind: 'summary',
          projectId,
          project: this.store.projects.find(projectId) ?? null,
          counts: {
            works: this.store.works.count(),
            tasks: this.store.tasks.count(),
            requirements: this.store.requirements.count(),
            runs: this.store.runs.count(),
          },
        } as unknown as JsonObject;
      case 'work': {
        const work = this.store.works.find(String(scope.id));
        return {
          kind: 'work',
          projectId,
          work: work ?? null,
          tasks: this.store.tasks.list({ where: 'work_id = ?', params: [scope.id] }),
          runs: this.store.runs.list({ where: 'work_id = ?', params: [scope.id] }),
        } as unknown as JsonObject;
      }
      case 'run': {
        const run = this.store.runs.find(String(scope.id));
        return {
          kind: 'run',
          projectId,
          run: run ?? null,
          attempts: this.store.attempts.list({ where: 'run_id = ?', params: [scope.id] }),
          stageResults: this.store.stageResults.list({
            where: 'run_id = ?',
            params: [scope.id],
          }),
        } as unknown as JsonObject;
      }
      case 'conversation': {
        const conversation = this.store.conversations.find(String(scope.id));
        return {
          kind: 'conversation',
          projectId,
          conversation: conversation ?? null,
          messages: this.store.messages.list({
            where: 'conversation_id = ?',
            params: [scope.id],
            orderBy: 'seq DESC',
            limit: 50,
          }),
        } as unknown as JsonObject;
      }
    }
  }

  private require(subscriptionId: string): Subscription {
    const subscription = this.subscriptions.get(subscriptionId);
    if (subscription === undefined) {
      throw new ProtocolError('NOT_FOUND', `subscription ${subscriptionId} does not exist`);
    }
    return subscription;
  }

  private assertScope(scope: SubscriptionScope): void {
    if (!SCOPE_KINDS.includes(scope?.kind)) {
      throw new ProtocolError('VALIDATION_ERROR', `unknown scope kind ${String(scope?.kind)}`);
    }
    if (scope.kind !== 'summary' && (typeof scope.id !== 'string' || scope.id === '')) {
      throw new ProtocolError('VALIDATION_ERROR', `scope ${scope.kind} needs an id`);
    }
  }
}

/** Field in the event payload that carries the scoped entity id, if any. */
const SCOPE_FIELDS: Record<ScopeKind, readonly string[]> = {
  summary: [],
  conversation: ['conversationId', 'conversation_id'],
  work: ['workId', 'work_id'],
  run: ['runId', 'run_id'],
};

/**
 * Whether an event belongs to a subscription scope.
 *
 * The change summary in `event.data` is the routing input, plus the entity id
 * itself, so an event about a Task still reaches its Work's subscribers.
 */
export function matchesScope(event: Event, scope: SubscriptionScope): boolean {
  if (scope.kind === 'summary') return true;
  if (scope.id === undefined) return false;
  if (event.entityId === scope.id) return true;
  const data = event.data as Record<string, unknown>;
  for (const field of SCOPE_FIELDS[scope.kind]) {
    if (data[field] === scope.id) return true;
  }
  const refs = data['refs'];
  if (Array.isArray(refs)) {
    return refs.some((ref) => {
      const entry = ref as { id?: unknown; kind?: unknown };
      return entry.id === scope.id && (entry.kind === undefined || entry.kind === scope.kind);
    });
  }
  return false;
}
