import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  BlobStore,
  projectIdFromRoot,
  type ProjectStore,
  type StorageError,
} from '../src/index.js';
import { ProjectStore as Store } from '../src/store.js';

/**
 * AC-055 (idempotency), AC-059/060 plumbing and the WP-01 required failure
 * tests, all against a real SQLite file and a real blob directory.
 *
 * The lost-response case is the important one: a caller that retries the same
 * key must observe the original result and must not produce a second effect.
 */
const TIME = '2026-09-11T00:00:00.000Z';
const ROOT = '/tmp/agentdev-project-root';

let dataDir: string;
let store: ProjectStore;
let projectId: string;

function openStore(options: { now?: () => string } = {}): ProjectStore {
  return Store.open({
    dataDir,
    canonicalRoot: ROOT,
    migrations: { backup: () => undefined, backupPath: join(dataDir, 'pre.sqlite') },
    ...(options.now === undefined ? {} : { repository: { now: options.now } }),
  });
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'agentdev-ledger-'));
  store = openStore();
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
});

afterEach(() => {
  store.close();
  rmSync(dataDir, { recursive: true, force: true });
});

describe('command ledger (AC-055)', () => {
  it('replays the original result for the same key and payload', () => {
    let effects = 0;
    const key = {
      subject: 'user:018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e5f',
      operation: 'work.pause',
      key: 'key-1',
      payloadHash: 'a'.repeat(64),
    };

    // First attempt: the command runs and its response is recorded.
    const first = store.commands.begin(key);
    expect(first.kind).toBe('new');
    effects += 1;
    if (first.kind === 'new') {
      store.commands.complete(first.commandId, { status: 'accepted', operationId: 'op-1' });
    }

    // The response never reached the client, so it retries with the same key.
    const retry = store.commands.begin(key);
    expect(retry).toEqual({
      kind: 'replay',
      state: 'completed',
      response: { status: 'accepted', operationId: 'op-1' },
    });
    expect(effects).toBe(1);
    expect(store.commands.lookup(key.subject, key.operation, key.key)).toEqual({
      state: 'completed',
      response: { status: 'accepted', operationId: 'op-1' },
    });
  });

  it('refuses the same key with a different payload or another caller', () => {
    const key = {
      subject: 'user:018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e5f',
      operation: 'work.pause',
      key: 'key-2',
      payloadHash: 'a'.repeat(64),
    };
    expect(store.commands.begin(key).kind).toBe('new');
    expect(store.commands.begin({ ...key, payloadHash: 'b'.repeat(64) })).toEqual({
      kind: 'conflict',
      reason: 'idempotency key key-2 was used with a different payload',
    });
    expect(
      store.commands.begin({ ...key, subject: 'user:018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e60' }),
    ).toEqual({ kind: 'conflict', reason: 'idempotency key key-2 belongs to another caller' });
  });

  it('scopes lookup to the calling subject and prunes old rows', () => {
    const key = {
      subject: 'cli:018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e5f',
      operation: 'project.open',
      key: 'key-3',
      payloadHash: 'c'.repeat(64),
    };
    const begun = store.commands.begin(key);
    if (begun.kind !== 'new') throw new Error('expected a new command');
    store.commands.complete(begun.commandId, {
      status: 'applied',
      entityId: projectId,
      version: 1,
    });
    expect(store.commands.lookup('user:other', key.operation, key.key)).toBeUndefined();
    expect(store.commands.pruneBefore('2999-01-01T00:00:00.000Z')).toBe(1);
    expect(store.commands.lookup(key.subject, key.operation, key.key)).toBeUndefined();
  });
});

describe('event log', () => {
  it('assigns increasing cursors and reads after a watermark', () => {
    const first = store.events.append({
      name: 'work.control_changed',
      entityId: projectId,
      entityVersion: 1,
      data: { status: 'running' },
    });
    const second = store.events.append({
      name: 'work.control_changed',
      entityId: projectId,
      entityVersion: 2,
    });
    expect(second.cursor).toBeGreaterThan(first.cursor);
    expect(store.events.latestCursor()).toBe(second.cursor);

    const after = store.events.readAfter(first.cursor);
    expect(after.map((event) => event.cursor)).toEqual([second.cursor]);
    expect(after[0]?.data).toEqual({});
    expect(store.events.readAfter(0).map((event) => event.cursor)).toEqual([
      first.cursor,
      second.cursor,
    ]);
    expect(store.events.readAfter(0, { names: ['work.control_changed'] })).toHaveLength(2);
    expect(store.events.readAfter(0, { names: ['never.emitted'] })).toEqual([]);
  });

  it('refuses to rewrite an event', () => {
    store.events.append({ name: 'a', entityId: projectId, entityVersion: 1 });
    expect(() => store.db.prepare(`UPDATE event SET name = 'b'`).run()).toThrow(/immutable/);
  });

  it('answers RESYNC_REQUIRED once retention truncated the cursor', () => {
    const first = store.events.append({ name: 'a', entityId: projectId, entityVersion: 1 });
    const second = store.events.append({ name: 'a', entityId: projectId, entityVersion: 2 });
    expect(store.events.truncateBefore(second.cursor)).toBe(1);
    expect(() => store.events.readAfter(first.cursor - 1)).toThrowError(
      expect.objectContaining({ code: 'NOT_FOUND' }),
    );
    try {
      store.events.readAfter(0);
    } catch (error) {
      expect((error as StorageError).details['code']).toBe('RESYNC_REQUIRED');
    }
    expect(store.events.oldestCursor()).toBe(second.cursor);
    expect(store.events.readAfter(second.cursor)).toEqual([]);
  });
});

describe('outbox', () => {
  it('enqueues once per operationId and delivers idempotently', () => {
    const operationId = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e5f';
    const first = store.outbox.enqueue({ operationId, kind: 'integrate', payload: { step: 1 } });
    const again = store.outbox.enqueue({ operationId, kind: 'integrate', payload: { step: 2 } });
    expect(again.id).toBe(first.id);
    expect(again.payload).toEqual({ step: 1 });

    const claimed = store.outbox.claim({ at: TIME, leaseSeconds: 30 });
    expect(claimed).toHaveLength(1);
    expect(claimed[0]?.state).toBe('claimed');
    expect(claimed[0]?.attempts).toBe(1);
    expect(claimed[0]?.leaseUntil).toBe('2026-09-11T00:00:30.000Z');

    // A second claim inside the lease window must not double-deliver.
    expect(store.outbox.claim({ at: TIME })).toEqual([]);
    store.outbox.complete(operationId);
    expect(store.outbox.countByState()).toEqual({ done: 1 });
    expect(store.outbox.claim({ at: TIME })).toEqual([]);
  });

  it('reclaims an entry whose lease expired', () => {
    const operationId = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e5f';
    store.outbox.enqueue({ operationId, kind: 'settle' });
    store.outbox.claim({ at: TIME, leaseSeconds: 30 });
    const reclaimed = store.outbox.claim({ at: '2026-09-11T00:01:00.000Z', leaseSeconds: 30 });
    expect(reclaimed).toHaveLength(1);
    expect(reclaimed[0]?.attempts).toBe(2);
  });

  it('returns a failed delivery to the queue and reports pending work', () => {
    const operationId = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e5f';
    store.outbox.enqueue({ operationId, kind: 'backup' });
    store.outbox.claim({ at: TIME });
    store.outbox.release(operationId);
    expect(store.outbox.pending().map((entry) => entry.state)).toEqual(['pending']);
    expect(store.outbox.get(operationId).attempts).toBe(1);
  });
});

describe('leases', () => {
  const resource = 'integration:project';
  const attemptA = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e5f';
  const attemptB = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e60';

  it('grants the resource to one owner and refuses the second', () => {
    const first = store.leases.acquire({
      resource,
      ownerAttemptId: attemptA,
      epoch: 1,
      expiresAt: '2026-09-11T00:00:20.000Z',
      at: TIME,
    });
    expect(first.acquired).toBe(true);
    const second = store.leases.acquire({
      resource,
      ownerAttemptId: attemptB,
      epoch: 2,
      expiresAt: '2026-09-11T00:00:20.000Z',
      at: TIME,
    });
    expect(second.acquired).toBe(false);
    if (!second.acquired) expect(second.heldBy.ownerAttemptId).toBe(attemptA);
  });

  it('replaces an expired lease and reports the takeover', () => {
    store.leases.acquire({
      resource,
      ownerAttemptId: attemptA,
      epoch: 1,
      expiresAt: '2026-09-11T00:00:20.000Z',
      at: TIME,
    });
    expect(store.leases.expired('2026-09-11T00:00:21.000Z')).toHaveLength(1);
    const takeover = store.leases.acquire({
      resource,
      ownerAttemptId: attemptB,
      epoch: 2,
      expiresAt: '2026-09-11T00:01:00.000Z',
      at: '2026-09-11T00:00:21.000Z',
    });
    expect(takeover).toMatchObject({ acquired: true, replacedExpired: true });
    expect(store.leases.releaseExpired('2026-09-11T00:02:00.000Z')).toEqual([resource]);
    expect(store.leases.find(resource)).toBeUndefined();
  });

  it('only its owner can renew or release', () => {
    store.leases.acquire({
      resource,
      ownerAttemptId: attemptA,
      epoch: 1,
      expiresAt: '2026-09-11T00:00:20.000Z',
      at: TIME,
    });
    expect(store.leases.renew(resource, attemptB, 2, '2026-09-11T00:01:00.000Z', TIME)).toBe(false);
    expect(store.leases.renew(resource, attemptA, 1, '2026-09-11T00:01:00.000Z', TIME)).toBe(true);
    expect(store.leases.release(resource, attemptB, 2)).toBe(false);
    expect(store.leases.release(resource, attemptA, 1)).toBe(true);
    expect(store.leases.release(resource, attemptA, 1)).toBe(false);
  });
});

describe('blob store', () => {
  let blobs: BlobStore;

  beforeEach(() => {
    blobs = new BlobStore({ root: dataDir });
  });

  it('writes content additively and verifies hashes', () => {
    const first = blobs.write('hello');
    const again = blobs.write('hello');
    expect(again.relativePath).toBe(first.relativePath);
    expect(first.relativePath.startsWith('blobs/')).toBe(true);
    expect(existsSync(join(dataDir, first.relativePath))).toBe(true);
    expect(blobs.read(first.relativePath).toString('utf8')).toBe('hello');
    expect(blobs.readVerified(first.relativePath, first.hash).toString('utf8')).toBe('hello');
    expect(blobs.size(first.relativePath)).toBe(5);
  });

  it('reports a missing or corrupted blob explicitly', () => {
    const ref = blobs.write('hello');
    expect(() => blobs.read(join('blobs', 'zz', 'missing'))).toThrowError(
      expect.objectContaining({ code: 'BLOB_MISSING' }),
    );
    expect(() => blobs.readVerified(ref.relativePath, 'f'.repeat(64))).toThrowError(
      expect.objectContaining({ code: 'BLOB_MISMATCH' }),
    );
    expect(() => blobs.read('../escape')).toThrowError(
      expect.objectContaining({ code: 'NOT_FOUND' }),
    );
  });

  it('collects only unreferenced blobs', () => {
    const kept = blobs.write('keep');
    const dropped = blobs.write('drop');
    expect(blobs.list()).toHaveLength(2);
    const removed = blobs.collectGarbage(new Set([kept.relativePath]));
    expect(removed).toEqual([dropped.relativePath]);
    expect(blobs.has(kept.relativePath)).toBe(true);
    expect(blobs.has(dropped.relativePath)).toBe(false);
  });

  it('leaves no temporary file behind after a write', () => {
    const ref = blobs.write('atomic');
    const bucket = join(dataDir, 'blobs', ref.hash.slice(0, 2));
    const names = blobs.list().filter((path) => path.startsWith(`blobs/${ref.hash.slice(0, 2)}`));
    expect(names).toEqual([join('blobs', ref.hash.slice(0, 2), ref.hash)]);
    expect(existsSync(bucket)).toBe(true);
  });
});

describe('project store wiring', () => {
  it('takes a pre-migration backup by default (data.md §5)', () => {
    const freshDir = mkdtempSync(join(tmpdir(), 'agentdev-backup-'));
    const fresh = Store.open({ dataDir: freshDir, canonicalRoot: ROOT });
    try {
      expect(fresh.migration.applied).toEqual([1]);
      expect(fresh.migration.backupPath).toBe(join(freshDir, 'backups', 'pre-migration.sqlite'));
      expect(existsSync(fresh.migration.backupPath as string)).toBe(true);
    } finally {
      fresh.close();
      rmSync(freshDir, { recursive: true, force: true });
    }
  });

  it('runs migrations on open and exposes repositories', () => {
    expect(store.migration.applied).toEqual([1]);
    expect(store.projects.get(projectId).root).toBe(ROOT);
    expect(existsSync(join(dataDir, 'project.sqlite'))).toBe(true);
  });

  it('enforces optimistic concurrency on updates', () => {
    const budget = store.budgets.insert({
      projectId,
      workId: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e5f',
      tokenLimit: 1000,
      tokensUsed: 0,
      tokensReserved: 0,
      activeTimeLimit: 60,
      activeTimeUsed: 0,
      repairLimit: 3,
      repairUsed: 0,
      costKnown: true,
    });
    const updated = store.budgets.update(budget.id, { tokensUsed: 10 }, 1);
    expect(updated.version).toBe(2);
    expect(updated.updatedAt).toBeDefined();
    expect(() => store.budgets.update(budget.id, { tokensUsed: 20 }, 1)).toThrowError(
      expect.objectContaining({ code: 'VERSION_CONFLICT' }),
    );
    try {
      store.budgets.update(budget.id, { tokensUsed: 20 }, 1);
    } catch (error) {
      expect((error as StorageError).details['currentVersion']).toBe(2);
    }
    expect(() => store.budgets.get('018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e99')).toThrowError(
      expect.objectContaining({ code: 'NOT_FOUND' }),
    );
  });

  it('rejects a row that violates the database checks', () => {
    expect(() =>
      store.budgets.insert({
        projectId,
        workId: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e5f',
        tokenLimit: 10,
        tokensUsed: 8,
        tokensReserved: 8,
        activeTimeLimit: 60,
        activeTimeUsed: 0,
        repairLimit: 3,
        repairUsed: 0,
        costKnown: true,
      }),
    ).toThrowError(expect.objectContaining({ code: 'CONSTRAINT_VIOLATION' }));
  });

  it('reports a duplicate key explicitly', () => {
    store.conversations.insert({ projectId, title: 'chat', archived: false });
    const id = store.conversations.list()[0]?.id as string;
    expect(() =>
      store.conversations.insert({ id, projectId, title: 'again', archived: false }),
    ).toThrowError(expect.objectContaining({ code: 'DUPLICATE_KEY' }));
  });

  it('keeps blobs addressable through the store facade', () => {
    const ref = store.blobs.write('attachment body');
    const body = store.blobs.readVerified(ref.relativePath, ref.hash);
    expect(body.toString('utf8')).toBe('attachment body');
    writeFileSync(join(dataDir, 'marker'), 'x');
  });
});
