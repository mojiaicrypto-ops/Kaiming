import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { JsonObject } from '@agentdev/contracts';
import {
  ResyncRequiredError,
  ProjectStore as Store,
  projectIdFromRoot,
  type ProjectStore,
} from '@agentdev/storage';
import {
  CONNECTION_QUEUE_LIMITS,
  ConnectionQueue,
  EventHub,
  KNOWLEDGE_UPDATED_EVENT,
  ProtocolError,
  RECOVERY_REPORT_READY_EVENT,
  matchesScope,
} from '../src/index.js';

/**
 * AC-060 (scope subscription: snapshot + watermark, scope change, expired cursor)
 * and AC-059 (back-pressure: soft merging, hard disconnect, persistent events
 * survive). Everything runs against a real SQLite file with real event rows.
 */
const TIME = '2026-09-11T00:00:00.000Z';
const ROOT = '/tmp/agentdev-hub-root';
const WORK_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e5f';
const OTHER_WORK_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e60';
const CONVERSATION_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e61';
const MESSAGE_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e62';
const BODY_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e63';

let dataDir: string;
let store: ProjectStore;
let hub: EventHub;
let projectId: string;

const emptyScope = { readPaths: [], writePaths: [], operations: [], networkTargets: [] };

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'agentdev-hub-'));
  store = Store.open({
    dataDir,
    canonicalRoot: ROOT,
    migrations: { backup: () => undefined, backupPath: join(dataDir, 'pre.sqlite') },
  });
  projectId = projectIdFromRoot(ROOT);
  store.projects.insert({
    id: projectId,
    root: ROOT,
    codeRoot: 'src',
    documentRoot: 'docs',
    deliveryBranch: 'agentdev/main',
    trust: 'trusted',
    state: 'open',
  });
  const budget = store.budgets.insert({
    projectId,
    workId: WORK_ID,
    tokenLimit: 1000,
    tokensUsed: 0,
    tokensReserved: 0,
    activeTimeLimit: 600,
    activeTimeUsed: 0,
    repairLimit: 3,
    repairUsed: 0,
    costKnown: true,
  });
  store.works.insert({
    id: WORK_ID,
    projectId,
    intent: 'delivery',
    purpose: 'implement the feature',
    level: 'L2',
    goal: 'ship WP-01',
    scope: emptyScope,
    sourceRef: { kind: 'message', id: MESSAGE_ID, version: '1' },
    status: 'running',
    blockerIds: [],
    budgetId: budget.id,
    policyRevision: 1,
  });
  store.works.insert({
    id: OTHER_WORK_ID,
    projectId,
    intent: 'delivery',
    purpose: 'another work',
    level: 'L2',
    goal: 'ship WP-02',
    scope: emptyScope,
    sourceRef: { kind: 'message', id: MESSAGE_ID, version: '1' },
    status: 'queued',
    blockerIds: [],
    budgetId: budget.id,
    policyRevision: 1,
  });
  store.messageBodies.insert({
    id: BODY_ID,
    projectId,
    ownerKind: 'user',
    ownerUserId: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e64',
    contentHash: 'a'.repeat(64),
    relativeBlobPath: 'blobs/aa/' + 'a'.repeat(64),
    mime: 'text/markdown',
    bytes: 12,
  });
  store.conversations.insert({ projectId, title: 'chat', archived: false, id: CONVERSATION_ID });
  store.messages.insert({
    projectId,
    conversationId: CONVERSATION_ID,
    seq: 1,
    sender: 'user',
    bodyRef: BODY_ID,
    state: 'received',
    resultRefs: [],
  });
  hub = new EventHub({ store, now: () => TIME, batchSize: 10 });
});

afterEach(() => {
  store.close();
  rmSync(dataDir, { recursive: true, force: true });
});

function append(name: string, entityId: string, data: JsonObject = {}): number {
  return store.events.append({ name, entityId, entityVersion: 1, data }).cursor;
}

describe('scope snapshots and watermarks', () => {
  it('returns a consistent snapshot with the watermark as its cursor', () => {
    append('work.control_changed', WORK_ID, { workId: WORK_ID });
    append('work.control_changed', OTHER_WORK_ID, { workId: OTHER_WORK_ID });

    const subscription = hub.subscribe({
      connectionId: 'c1',
      scope: { kind: 'work', id: WORK_ID },
    });
    expect(subscription.mode).toBe('snapshot');
    expect(subscription.cursor).toBe(2);
    const snapshot = subscription.snapshot as {
      work: { id: string } | null;
      tasks: unknown[];
    };
    expect(snapshot.work?.id).toBe(WORK_ID);
    expect(snapshot.tasks).toEqual([]);
  });

  it('summarises the project for the summary scope', () => {
    const subscription = hub.subscribe({ connectionId: 'c1', scope: { kind: 'summary' } });
    const snapshot = subscription.snapshot as {
      counts: Record<string, number>;
      project: { root: string };
    };
    expect(snapshot.project.root).toBe(ROOT);
    expect(snapshot.counts).toEqual({ works: 2, tasks: 0, requirements: 0, runs: 0 });
  });

  it('replays only the events after the client cursor and only for its scope', () => {
    append('work.control_changed', WORK_ID, { workId: WORK_ID });
    const second = append('work.control_changed', OTHER_WORK_ID, { workId: OTHER_WORK_ID });
    const third = append('work.control_changed', WORK_ID, { workId: WORK_ID });

    const subscription = hub.subscribe({
      connectionId: 'c1',
      scope: { kind: 'work', id: WORK_ID },
      afterCursor: 1,
    });
    expect(subscription.mode).toBe('replay');
    expect(subscription.cursor).toBe(third);
    expect(subscription.events?.map((event) => event.cursor)).toEqual([third]);
    expect(second).toBeLessThan(third);
  });

  it('requires a resync when the cursor was truncated', () => {
    append('work.control_changed', WORK_ID, { workId: WORK_ID });
    const second = append('work.control_changed', WORK_ID, { workId: WORK_ID });
    store.events.truncateBefore(second);

    expect(() =>
      hub.subscribe({ connectionId: 'c1', scope: { kind: 'summary' }, afterCursor: 0 }),
    ).toThrowError(expect.objectContaining({ code: 'RESYNC_REQUIRED' }));
    expect(hub.subscriptionCount()).toBe(0);
  });
});

describe('scope change (AC-060)', () => {
  it('answers a fresh snapshot at a new watermark and covers later events', () => {
    const narrow = hub.subscribe({ connectionId: 'c1', scope: { kind: 'work', id: WORK_ID } });
    // The client catches up on its filter and ACKs it.
    append('work.control_changed', WORK_ID, { workId: WORK_ID });
    const firstBatch = hub.poll(narrow.subscriptionId);
    expect(firstBatch.events).toHaveLength(1);
    expect(firstBatch.scannedThrough).toBe(1);
    expect(firstBatch.batchEnd).toBe(true);
    expect(hub.ack(narrow.subscriptionId, firstBatch.scannedThrough)).toEqual({ acknowledged: 1 });

    // An event that the narrow scope did not match, then a scope change.
    const outside = append('work.control_changed', OTHER_WORK_ID, { workId: OTHER_WORK_ID });
    const widened = hub.setScope(narrow.subscriptionId, { kind: 'summary' });
    expect(widened.cursor).toBe(outside);

    // Snapshot at C already includes the previously filtered-out Work, and C is
    // the new delivery boundary, so the client has no gap and no duplicate.
    const snapshot = widened.snapshot as { counts: Record<string, number>; work: unknown };
    expect(snapshot.counts.works).toBe(2);
    expect(hub.poll(narrow.subscriptionId).events).toEqual([]);

    // Everything after C reaches the enlarged scope.
    const later = append('work.control_changed', OTHER_WORK_ID, { workId: OTHER_WORK_ID });
    const next = hub.poll(narrow.subscriptionId);
    expect(next.events.map((event) => event.cursor)).toEqual([later]);
    expect(next.scannedThrough).toBe(later);
    expect(widened.cursor).toBe(outside);
  });

  it('reports an empty batch with its scan watermark', () => {
    const subscription = hub.subscribe({ connectionId: 'c1', scope: { kind: 'summary' } });
    const batch = hub.poll(subscription.subscriptionId);
    expect(batch.events).toEqual([]);
    expect(batch.scannedThrough).toBe(0);
    expect(batch.batchEnd).toBe(true);
    expect(hub.laggingSubscriptions()).toEqual([]);
  });

  it('refuses a backward ack and clamps to the watermark', () => {
    const subscription = hub.subscribe({ connectionId: 'c1', scope: { kind: 'summary' } });
    append('work.control_changed', WORK_ID, { workId: WORK_ID });
    hub.ack(subscription.subscriptionId, 1);
    expect(() => hub.ack(subscription.subscriptionId, 0)).toThrowError(
      expect.objectContaining({ code: 'VALIDATION_ERROR' }),
    );
    expect(hub.ack(subscription.subscriptionId, 99)).toEqual({ acknowledged: 1 });
    expect(() => hub.ack('sub-999', 1)).toThrowError(
      expect.objectContaining({ code: 'NOT_FOUND' }),
    );
  });

  it('does not disguise a storage failure as a resync request', () => {
    // `watermark()` must succeed so the batch read is the failing call: an
    // unrelated storage error is not a truncated cursor.
    const withFailingRead = (error: Error): ProjectStore =>
      ({
        ...store,
        events: new Proxy(store.events, {
          get: (target, property, receiver) =>
            property === 'readAfter'
              ? () => {
                  throw error;
                }
              : (Reflect.get(target, property, receiver) as unknown),
        }),
      }) as unknown as ProjectStore;
    const broken = new EventHub({
      store: withFailingRead(new Error('disk failure')),
      batchSize: 10,
    });
    const failing = broken.subscribe({ connectionId: 'c1', scope: { kind: 'summary' } });
    expect(() => broken.poll(failing.subscriptionId)).toThrowError('disk failure');
    expect(() => broken.poll(failing.subscriptionId)).not.toThrowError(/RESYNC_REQUIRED/);

    // A genuinely truncated cursor is still translated for the client.
    const truncated = new EventHub({
      store: withFailingRead(new ResyncRequiredError(99, 1)),
      batchSize: 10,
    });
    const stale = truncated.subscribe({ connectionId: 'c2', scope: { kind: 'summary' } });
    expect(() => truncated.poll(stale.subscriptionId)).toThrowError(/no longer retained|truncated/);
  });

  it('classifies errors of a cursor-based subscribe the same way', () => {
    const withFailingRead = (error: Error): ProjectStore =>
      ({
        ...store,
        events: new Proxy(store.events, {
          get: (target, property, receiver) =>
            property === 'readAfter'
              ? () => {
                  throw error;
                }
              : (Reflect.get(target, property, receiver) as unknown),
        }),
      }) as unknown as ProjectStore;
    const broken = new EventHub({
      store: withFailingRead(new Error('disk failure')),
      batchSize: 10,
    });
    expect(() =>
      broken.subscribe({ connectionId: 'c1', scope: { kind: 'summary' }, afterCursor: 1 }),
    ).toThrowError('disk failure');

    const truncated = new EventHub({
      store: withFailingRead(new ResyncRequiredError(99, 1)),
      batchSize: 10,
    });
    expect(() =>
      truncated.subscribe({ connectionId: 'c2', scope: { kind: 'summary' }, afterCursor: 1 }),
    ).toThrowError(/no longer retained|truncated/);
  });

  it('validates scope shape and removes subscriptions', () => {
    expect(() => hub.subscribe({ connectionId: 'c1', scope: { kind: 'work' } })).toThrowError(
      expect.objectContaining({ code: 'VALIDATION_ERROR' }),
    );
    expect(() =>
      hub.subscribe({ connectionId: 'c1', scope: { kind: 'nope' as 'work', id: WORK_ID } }),
    ).toThrowError(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
    const subscription = hub.subscribe({ connectionId: 'c1', scope: { kind: 'summary' } });
    expect(hub.remove(subscription.subscriptionId)).toEqual({ removed: true });
    expect(hub.remove(subscription.subscriptionId)).toEqual({ removed: false });
  });

  it('drops the subscriptions of a closed connection', () => {
    hub.subscribe({ connectionId: 'c1', scope: { kind: 'summary' } });
    hub.subscribe({ connectionId: 'c1', scope: { kind: 'work', id: WORK_ID } });
    hub.subscribe({ connectionId: 'c2', scope: { kind: 'summary' } });
    expect(hub.closeConnection('c1')).toBe(2);
    expect(hub.subscriptionCount()).toBe(1);
  });
});

describe('connection back-pressure (AC-059)', () => {
  it('coalesces transient frames once the soft limit is crossed', () => {
    const queue = new ConnectionQueue({ softBytes: 100, hardBytes: 400 });
    const first = queue.push({ key: 'stream:run-1', bytes: 60, payload: { chunk: 1 } });
    expect(first).toMatchObject({ accepted: true, merged: false, coalesced: false });
    const second = queue.push({ key: 'stream:run-1', bytes: 60, payload: { chunk: 2 } });
    expect(second).toMatchObject({ accepted: true, merged: true, coalesced: false });

    // A second stream key pushes the queue over the soft limit: compaction.
    const third = queue.push({ key: 'stream:run-2', bytes: 60, payload: { chunk: 3 } });
    expect(third).toMatchObject({ accepted: true, merged: false, coalesced: true });

    const frames = queue.take();
    expect(frames).toHaveLength(2);
    expect(frames[0]).toMatchObject({ key: 'stream:run-1', merged: 2, payload: { chunk: 2 } });
    expect(frames[1]).toMatchObject({ key: 'stream:run-2', merged: 1, payload: { chunk: 3 } });
    expect(queue.bytes).toBe(0);
  });

  it('closes the connection at the hard limit without dropping durable events', () => {
    const closed: string[] = [];
    const tightHub = new EventHub({
      store,
      queueLimits: { softBytes: 10, hardBytes: 20 },
      onConnectionClosed: (connectionId) => closed.push(connectionId),
    });

    // A persistent event lands in the log regardless of connection pressure.
    append('work.control_changed', WORK_ID, { workId: WORK_ID });
    tightHub.openConnection('slow');
    expect(tightHub.pushTransient('slow', 'stream:a', 15, { chunk: 1 }).accepted).toBe(true);
    const overflow = tightHub.pushTransient('slow', 'stream:b', 15, { chunk: 2 });
    expect(overflow).toMatchObject({ accepted: false, closed: true, reason: 'HARD_LIMIT' });
    expect(closed).toEqual(['slow']);

    // The slow connection is gone, but the event log and other clients are fine.
    expect(tightHub.subscriptionCount()).toBe(0);
    const healthy = tightHub.subscribe({ connectionId: 'fast', scope: { kind: 'summary' } });
    expect(tightHub.poll(healthy.subscriptionId).events).toHaveLength(1);
  });

  it('keeps default limits at the documented 2 MiB / 8 MiB', () => {
    expect(CONNECTION_QUEUE_LIMITS).toEqual({
      softBytes: 2 * 1024 * 1024,
      hardBytes: 8 * 1024 * 1024,
    });
  });
});

describe('scan watermark and delivery lag', () => {
  it('scans committed events once and reports lagging subscriptions', () => {
    const subscription = hub.subscribe({ connectionId: 'c1', scope: { kind: 'summary' } });
    append('work.control_changed', WORK_ID, { workId: WORK_ID });
    append('work.control_changed', WORK_ID, { workId: WORK_ID });

    expect(hub.scan()).toEqual({ scanned: 2, scannedThrough: 2 });
    expect(hub.scan()).toEqual({ scanned: 0, scannedThrough: 2 });
    expect(hub.laggingSubscriptions()).toEqual([
      { subscriptionId: subscription.subscriptionId, lag: 2 },
    ]);
    hub.ack(subscription.subscriptionId, 2);
    expect(hub.laggingSubscriptions()).toEqual([]);
  });

  it('scans in bounded batches', () => {
    for (let index = 0; index < 5; index += 1) {
      append('work.control_changed', WORK_ID, { workId: WORK_ID });
    }
    const smallHub = new EventHub({ store, batchSize: 2 });
    expect(smallHub.scan()).toEqual({ scanned: 2, scannedThrough: 2 });
    expect(smallHub.scan()).toEqual({ scanned: 2, scannedThrough: 4 });
    expect(smallHub.scan()).toEqual({ scanned: 1, scannedThrough: 5 });
  });
});

describe('scope matching', () => {
  it('routes by entity id, change summary and refs', () => {
    const base = {
      cursor: 1,
      eventId: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e70',
      name: 'x',
      entityId: WORK_ID,
      entityVersion: 1,
      data: {},
      occurredAt: TIME,
    };
    expect(matchesScope(base, { kind: 'summary' })).toBe(true);
    expect(matchesScope(base, { kind: 'work', id: WORK_ID })).toBe(true);
    expect(matchesScope(base, { kind: 'work', id: OTHER_WORK_ID })).toBe(false);
    expect(
      matchesScope(
        { ...base, entityId: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e71', data: { workId: WORK_ID } },
        {
          kind: 'work',
          id: WORK_ID,
        },
      ),
    ).toBe(true);
    expect(
      matchesScope(
        {
          ...base,
          entityId: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e72',
          data: { refs: [{ kind: 'work', id: WORK_ID }] },
        },
        { kind: 'work', id: WORK_ID },
      ),
    ).toBe(true);
  });

  it('never throws for an unknown scope id', () => {
    const event = {
      cursor: 1,
      eventId: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e70',
      name: 'x',
      entityId: WORK_ID,
      entityVersion: 1,
      data: {},
      occurredAt: TIME,
    };
    expect(matchesScope(event, { kind: 'conversation', id: 'nope' })).toBe(false);
    expect(new ProtocolError('BUSY', 'x')).toBeInstanceOf(ProtocolError);
  });
});

describe('new persistent event names (WP-12 T9)', () => {
  /**
   * `protocol.md` §7 keeps adding persistent event names (`knowledge.updated`,
   * `recovery.report_ready`). The hub must not need a code change per name: delivery
   * is a cursor scan plus `matchesScope`, so a name introduced after this file was
   * written is delivered exactly like `work.control_changed`.
   */
  it('delivers an unknown event name through the ordinary cursor path and scopes it by data', () => {
    const RUN_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e77';
    const subscription = hub.subscribe({ connectionId: 'c1', scope: { kind: 'summary' } });

    const knowledgeCursor = append(KNOWLEDGE_UPDATED_EVENT, projectId, {
      projectId,
      revision: 'a'.repeat(40),
      featureIds: ['F-0a1b2c3d'],
      featureCount: 1,
    });
    const reportCursor = append(RECOVERY_REPORT_READY_EVENT, RUN_ID, {
      runId: RUN_ID,
      workId: WORK_ID,
      reportRef: { id: RUN_ID, version: 1, hash: 'b'.repeat(64) },
    });

    const polled = hub.poll(subscription.subscriptionId);
    expect(polled.events.map((event) => event.name)).toEqual([
      KNOWLEDGE_UPDATED_EVENT,
      RECOVERY_REPORT_READY_EVENT,
    ]);
    expect(polled.events.map((event) => event.cursor)).toEqual([knowledgeCursor, reportCursor]);
    expect(polled.scannedThrough).toBe(reportCursor);
    expect(hub.ack(subscription.subscriptionId, polled.scannedThrough)).toEqual({
      acknowledged: reportCursor,
    });

    // Scope routing is data-driven, not name-driven: the project-level knowledge
    // event reaches only the summary scope (there is no `knowledge` scope in §2),
    // while the recovery report also reaches the Work and Run it names.
    const knowledgeEvent = store.events.readAfter(knowledgeCursor - 1, { limit: 1 })[0];
    const reportEvent = store.events.readAfter(reportCursor - 1, { limit: 1 })[0];
    if (knowledgeEvent === undefined || reportEvent === undefined) {
      throw new Error('expected both appended events');
    }
    expect(matchesScope(knowledgeEvent, { kind: 'work', id: WORK_ID })).toBe(false);
    expect(matchesScope(reportEvent, { kind: 'work', id: WORK_ID })).toBe(true);
    expect(matchesScope(reportEvent, { kind: 'run', id: RUN_ID })).toBe(true);
  });
});
