import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { Store, StoreError, type AcceptInputParams, type AcceptResult } from '../src/store/store.ts';

const dirs: string[] = [];
const stores: Store[] = [];

function openStore(serverEpoch = 1): { store: Store; path: string } {
  const dir = mkdtempSync(join(tmpdir(), 'devagent-store-'));
  dirs.push(dir);
  const path = join(dir, 'state.db');
  const store = new Store({ path, serverEpoch });
  stores.push(store);
  return { store, path };
}

function closeStore(store: Store): void {
  store.close();
  stores.splice(stores.indexOf(store), 1);
}

function seed(store: Store): void {
  store.createProject({ id: 'p-1', realPath: '/projects/alpha' });
  store.createSession({ id: 's-1', projectId: 'p-1', roleId: 'chief', cwd: '/projects/alpha' });
  store.createSession({ id: 's-2', projectId: 'p-1', roleId: 'chief', cwd: '/projects/alpha' });
}

function accept(store: Store, overrides: Partial<AcceptInputParams> = {}): AcceptResult {
  return store.acceptInput({
    inputId: 'i-1',
    projectId: 'p-1',
    sessionId: 's-1',
    sourceKey: 'user:req-1',
    requestKey: 'req-1',
    method: 'session.input.submit',
    kind: 'user',
    payload: { content: [{ type: 'text', text: 'hello' }] },
    ...overrides,
  });
}

afterEach(() => {
  for (const store of stores.splice(0)) {
    store.close();
  }
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('store pragmas and schema', () => {
  it('applies the required pragmas and migrates to the current schema version', () => {
    const { store } = openStore();

    expect(store.pragmas()).toEqual({
      journalMode: 'wal',
      synchronous: 2,
      foreignKeys: 1,
      userVersion: 5,
    });
  });

  it('migrates a v1 database by adding the P2 columns', () => {
    const { store, path } = openStore();
    seed(store);
    accept(store);
    closeStore(store);

    // Emulates a v1 database: the two P2 columns absent, version rolled back.
    const raw = new DatabaseSync(path);
    raw.exec('ALTER TABLE session_inputs DROP COLUMN effectiveConfig');
    raw.exec('ALTER TABLE session_inputs DROP COLUMN checkpoint');
    raw.exec('PRAGMA user_version = 1');
    raw.close();

    const migrated = new Store({ path, serverEpoch: 1 });
    stores.push(migrated);

    expect(migrated.pragmas().userVersion).toBe(5);
    const input = migrated.getInput('i-1');
    expect(input).toMatchObject({ status: 'queued', effectiveConfig: null, checkpoint: null });
    expect(migrated.claimNextInput('s-1').kind).toBe('claimed');
    expect(migrated.listTaskResults('t-none')).toEqual([]);
  });

  it('refuses to open a database that already has two running inputs in one session', () => {
    const { store, path } = openStore();
    seed(store);
    accept(store);
    accept(store, {
      inputId: 'i-2',
      sourceKey: 'user:req-2',
      requestKey: 'req-2',
      payload: { content: [{ type: 'text', text: 'second' }] },
    });
    closeStore(store);

    // Simulate a database written before the invariant existed: index absent, two running rows.
    const raw = new DatabaseSync(path);
    raw.exec('DROP INDEX idx_inputs_one_processing');
    raw.exec("UPDATE session_inputs SET status = 'processing'");
    raw.close();

    expect(() => new Store({ path, serverEpoch: 2 })).toThrowError(
      expect.objectContaining({ name: 'StoreError', code: 'VERSION_CONFLICT' }),
    );
  });

  it('recreates the one-running-input index on a database written without it', () => {
    const { store, path } = openStore();
    seed(store);
    closeStore(store);

    // Emulates a database created by an earlier revision (version 1, index absent).
    const raw = new DatabaseSync(path);
    raw.exec('DROP INDEX idx_inputs_one_processing');
    raw.close();

    const reopened = new Store({ path, serverEpoch: 1 });
    stores.push(reopened);
    const inspector = new DatabaseSync(path);
    const index = inspector
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_inputs_one_processing'")
      .get();
    inspector.close();

    expect(index).toBeDefined();
  });
});

describe('input acceptance', () => {
  it('stores a queued input with a receipt and assigns per-session sequence numbers', () => {
    const { store } = openStore();
    seed(store);

    const first = accept(store);
    const second = accept(store, {
      inputId: 'i-2',
      sourceKey: 'user:req-2',
      requestKey: 'req-2',
      payload: { content: [{ type: 'text', text: 'second' }] },
    });
    const otherSession = accept(store, {
      inputId: 'i-3',
      sessionId: 's-2',
      sourceKey: 'user:req-3',
      requestKey: 'req-3',
      payload: { content: [{ type: 'text', text: 'other' }] },
    });

    expect(first).toEqual({ inputId: 'i-1', status: 'queued', revision: 1, deduped: false });
    expect(store.listInputs('s-1').map((row) => row.seq)).toEqual([1, 2]);
    expect(store.listInputs('s-2').map((row) => row.seq)).toEqual([1]);
    expect(second.deduped).toBe(false);
    expect(otherSession.deduped).toBe(false);
  });

  it('reuses the original result for a repeated requestKey and rejects changed parameters', () => {
    const { store } = openStore();
    seed(store);
    accept(store);

    const retry = accept(store, { inputId: 'ignored-id' });

    expect(retry).toEqual({ inputId: 'i-1', status: 'queued', revision: 1, deduped: true });
    expect(store.listInputs('s-1')).toHaveLength(1);
    expect(() =>
      accept(store, { payload: { content: [{ type: 'text', text: 'changed' }] } }),
    ).toThrowError(expect.objectContaining({ code: 'REQUEST_CONFLICT' }));
  });

  it('rejects a repeated requestKey that points at another session, project or task', () => {
    const { store } = openStore();
    seed(store);
    accept(store);

    // Same id, same payload, different attribution must conflict instead of silently deduping.
    expect(() => accept(store, { sessionId: 's-2' })).toThrowError(
      expect.objectContaining({ code: 'REQUEST_CONFLICT' }),
    );
    expect(() => accept(store, { taskId: 't-1' })).toThrowError(
      expect.objectContaining({ code: 'REQUEST_CONFLICT' }),
    );
    expect(() => accept(store, { projectId: 'p-2' })).toThrowError(
      expect.objectContaining({ code: 'REQUEST_CONFLICT' }),
    );
    expect(store.listInputs('s-2')).toHaveLength(0);
  });

  it('refuses inputs for an unknown session', () => {
    const { store } = openStore();

    expect(() => accept(store)).toThrow(StoreError);
  });
});

describe('claiming', () => {
  it('claims the earliest queued input and refuses a second run for the same session', () => {
    const { store } = openStore();
    seed(store);
    accept(store);
    accept(store, {
      inputId: 'i-2',
      sourceKey: 'user:req-2',
      requestKey: 'req-2',
      payload: { content: [{ type: 'text', text: 'second' }] },
    });

    const claimed = store.claimNextInput('s-1');

    expect(claimed.kind).toBe('claimed');
    if (claimed.kind !== 'claimed') {
      throw new Error('unreachable');
    }
    expect(claimed.input.inputId).toBe('i-1');
    expect(claimed.input.status).toBe('processing');
    expect(claimed.input.claim).toBe(1);
    expect(claimed.input.serverEpoch).toBe(1);
    expect(store.claimNextInput('s-1')).toEqual({ kind: 'busy', inputId: 'i-1' });
  });

  it('claims the next queued input after the running one finishes', () => {
    const { store } = openStore();
    seed(store);
    accept(store);
    accept(store, {
      inputId: 'i-2',
      sourceKey: 'user:req-2',
      requestKey: 'req-2',
      payload: { content: [{ type: 'text', text: 'second' }] },
    });
    const claimed = store.claimNextInput('s-1');
    if (claimed.kind !== 'claimed') {
      throw new Error('expected a claim');
    }

    expect(
      store.finishInput({
        inputId: 'i-1',
        expectedRevision: claimed.input.revision,
        status: 'completed',
      }),
    ).toBe(true);
    const next = store.claimNextInput('s-1');

    expect(next.kind).toBe('claimed');
    if (next.kind !== 'claimed') {
      throw new Error('unreachable');
    }
    expect(next.input.inputId).toBe('i-2');
  });

  it('keeps at most one running input per session, even for a direct claim call', () => {
    const { store, path } = openStore();
    seed(store);
    accept(store);
    accept(store, {
      inputId: 'i-2',
      sourceKey: 'user:req-2',
      requestKey: 'req-2',
      payload: { content: [{ type: 'text', text: 'second' }] },
    });
    const claimed = store.claimNextInput('s-1');
    expect(claimed.kind).toBe('claimed');

    // The storage layer refuses a second running input for the same session (WHERE NOT EXISTS +
    // the partial unique index), so bypassing claimNextInput cannot break the rule.
    expect(store.tryClaimInput('i-2')).toBe(false);
    expect(store.listInputs('s-1').filter((row) => row.status === 'processing')).toHaveLength(1);

    // A second connection sees the same committed fact and reports the session as busy.
    const other = new Store({ path, serverEpoch: 1 });
    stores.push(other);
    expect(other.claimNextInput('s-1')).toEqual({ kind: 'busy', inputId: 'i-1' });
  });

  it('rejects a finish that carries a stale revision', () => {
    const { store } = openStore();
    seed(store);
    accept(store);
    const claimed = store.claimNextInput('s-1');
    if (claimed.kind !== 'claimed') {
      throw new Error('expected a claim');
    }

    expect(
      store.finishInput({ inputId: 'i-1', expectedRevision: 1, status: 'completed' }),
    ).toBe(false);
    expect(
      store.finishInput({
        inputId: 'i-1',
        expectedRevision: claimed.input.revision,
        status: 'failed',
        errorCode: 'MODEL_UNAVAILABLE',
        errorMessage: 'no usable model',
      }),
    ).toBe(true);
    expect(store.getInput('i-1')).toMatchObject({
      status: 'failed',
      errorCode: 'MODEL_UNAVAILABLE',
      errorMessage: 'no usable model',
    });
  });
});

describe('stop intent', () => {
  it('stops queued work outright and only records the intent for running work', () => {
    const { store } = openStore();
    seed(store);
    accept(store);
    accept(store, {
      inputId: 'i-2',
      sourceKey: 'user:req-2',
      requestKey: 'req-2',
      payload: { content: [{ type: 'text', text: 'second' }] },
    });

    expect(store.requestStop({ inputId: 'i-2', requestKey: 'stop-2', reason: 'user' })).toEqual({
      status: 'stopped',
      stopRequested: true,
    });
    // Retrying the same requestId reports the same recorded outcome.
    expect(store.requestStop({ inputId: 'i-2', requestKey: 'stop-2', reason: 'user' })).toEqual({
      status: 'stopped',
      stopRequested: true,
    });
    const claimed = store.claimNextInput('s-1');
    if (claimed.kind !== 'claimed') {
      throw new Error('expected a claim');
    }
    expect(claimed.input.inputId).toBe('i-1');

    expect(store.requestStop({ inputId: 'i-1', requestKey: 'stop-1', reason: 'user' })).toEqual({
      status: 'processing',
      stopRequested: true,
    });
    expect(store.getInput('i-1')).toMatchObject({
      status: 'processing',
      stopRequestKey: 'stop-1',
      stopReason: 'user',
    });
  });

  it('bumps the version when the intent is recorded, is idempotent, and leaves terminal rows alone', () => {
    const { store } = openStore();
    seed(store);
    accept(store);
    const claimed = store.claimNextInput('s-1');
    if (claimed.kind !== 'claimed') {
      throw new Error('expected a claim');
    }

    expect(store.requestStop({ inputId: 'i-1', requestKey: 'stop-1', reason: 'user' })).toEqual({
      status: 'processing',
      stopRequested: true,
    });
    const afterStop = store.getInput('i-1');
    expect(afterStop?.revision).toBe(claimed.input.revision + 1);

    // Retrying the same stop request changes nothing.
    expect(store.requestStop({ inputId: 'i-1', requestKey: 'stop-1', reason: 'user' })).toEqual({
      status: 'processing',
      stopRequested: true,
    });
    expect(store.getInput('i-1')?.revision).toBe(afterStop?.revision);

    // A late stop against a finished input is reported but cannot rewrite history.
    if (afterStop === undefined) {
      throw new Error('unreachable');
    }
    expect(
      store.finishInput({
        inputId: 'i-1',
        expectedRevision: afterStop.revision,
        status: 'completed',
      }),
    ).toBe(true);
    const completed = store.getInput('i-1');
    expect(store.requestStop({ inputId: 'i-1', requestKey: 'stop-2', reason: 'late' })).toEqual({
      status: 'completed',
      stopRequested: false,
    });
    expect(store.getInput('i-1')).toMatchObject({
      revision: completed?.revision,
      stopRequestKey: 'stop-1',
      stopReason: 'user',
    });
  });

  it('never resurrects stopped work when the session is scanned', () => {
    const { store } = openStore();
    seed(store);
    accept(store);
    accept(store, {
      inputId: 'i-2',
      sourceKey: 'user:req-2',
      requestKey: 'req-2',
      payload: { content: [{ type: 'text', text: 'second' }] },
    });
    store.requestStop({ inputId: 'i-2', requestKey: 'stop-2', reason: 'user' });

    store.scanStartup();

    expect(store.getInput('i-2')?.status).toBe('stopped');
    const claimed = store.claimNextInput('s-1');
    expect(claimed.kind).toBe('claimed');
  });
});

describe('restart classification', () => {
  it('leaves work owned by the current generation alone', () => {
    const { store } = openStore(1);
    seed(store);
    accept(store);
    const claimed = store.claimNextInput('s-1');
    if (claimed.kind !== 'claimed') {
      throw new Error('expected a claim');
    }

    // A later scan in the same process (periodic scan, or a second Store on this file) must not
    // destroy a live run, and the live run must still be closable.
    expect(store.scanStartup()).toEqual({ interrupted: 0 });
    const live = store.getInput('i-1');
    expect(live?.status).toBe('processing');
    if (live === undefined) {
      throw new Error('unreachable');
    }
    expect(
      store.finishInput({ inputId: 'i-1', expectedRevision: live.revision, status: 'completed' }),
    ).toBe(true);
  });

  it('marks work left running by a previous process as interrupted and blocks the session', () => {
    const { store, path } = openStore(1);
    seed(store);
    accept(store);
    const claimed = store.claimNextInput('s-1');
    if (claimed.kind !== 'claimed') {
      throw new Error('expected a claim');
    }
    store.close();
    stores.splice(stores.indexOf(store), 1);

    const restarted = new Store({ path, serverEpoch: 2 });
    stores.push(restarted);
    const scan = restarted.scanStartup();

    expect(scan).toEqual({ interrupted: 1 });
    expect(restarted.getInput('i-1')?.status).toBe('interrupted');
    expect(restarted.claimNextInput('s-1')).toEqual({
      kind: 'blocked',
      inputId: 'i-1',
      code: 'RECOVERY_REQUIRED',
    });
  });
});