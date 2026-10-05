import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Dispatcher } from '../src/store/dispatcher.ts';
import { Store } from '../src/store/store.ts';

const dirs: string[] = [];
const stores: Store[] = [];

function openStore(serverEpoch = 1): { store: Store; path: string } {
  const dir = mkdtempSync(join(tmpdir(), 'devagent-dispatcher-'));
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

function seed(store: Store, sessionIds: readonly string[]): void {
  store.createProject({ id: 'p-1', realPath: '/projects/alpha' });
  for (const sessionId of sessionIds) {
    store.createSession({ id: sessionId, projectId: 'p-1', roleId: 'chief', cwd: '/projects/alpha' });
  }
}

function accept(store: Store, sessionId: string, index: number): void {
  store.acceptInput({
    inputId: `${sessionId}-i${index}`,
    projectId: 'p-1',
    sessionId,
    sourceKey: `${sessionId}:req-${index}`,
    requestKey: `${sessionId}-req-${index}`,
    method: 'session.input.submit',
    kind: 'user',
    payload: { content: [{ type: 'text', text: `${sessionId} #${index}` }] },
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

describe('dispatcher rotation', () => {
  it('claims one input per ready session in rotation order', () => {
    const { store } = openStore();
    seed(store, ['s-1', 's-2', 's-3']);
    for (const sessionId of ['s-1', 's-2', 's-3']) {
      accept(store, sessionId, 1);
    }
    const dispatcher = new Dispatcher(store);

    const sessionOf = (outcome: ReturnType<Dispatcher['nextClaim']>): string =>
      outcome.kind === 'claimed' ? outcome.sessionId : outcome.kind;

    expect([
      sessionOf(dispatcher.nextClaim()),
      sessionOf(dispatcher.nextClaim()),
      sessionOf(dispatcher.nextClaim()),
    ]).toEqual(['s-1', 's-2', 's-3']);
    expect(dispatcher.nextClaim()).toEqual({ kind: 'idle' });
  });

  it('skips a session that already has work in flight and serves the others', () => {
    const { store } = openStore();
    seed(store, ['s-1', 's-2']);
    accept(store, 's-1', 1);
    accept(store, 's-1', 2);
    accept(store, 's-2', 1);
    const dispatcher = new Dispatcher(store);

    const first = dispatcher.nextClaim();
    const second = dispatcher.nextClaim();

    expect(first.kind === 'claimed' ? first.sessionId : first.kind).toBe('s-1');
    expect(second.kind === 'claimed' ? second.sessionId : second.kind).toBe('s-2');
    // s-1 still has its first input in flight, so its second input stays queued.
    expect(store.getInput('s-1-i2')?.status).toBe('queued');
  });

  it('reports a session awaiting recovery instead of claiming past it', () => {
    const { store, path } = openStore(1);
    seed(store, ['s-1']);
    accept(store, 's-1', 1);
    const claimed = store.claimNextInput('s-1');
    if (claimed.kind !== 'claimed') {
      throw new Error('expected a claim');
    }
    closeStore(store);

    const restarted = new Store({ path, serverEpoch: 2 });
    stores.push(restarted);
    expect(restarted.scanStartup()).toEqual({ interrupted: 1 });
    const dispatcher = new Dispatcher(restarted);

    expect(dispatcher.nextClaim()).toEqual({
      kind: 'blocked',
      sessionId: 's-1',
      inputId: 's-1-i1',
      code: 'RECOVERY_REQUIRED',
    });
  });

  it('serves a ready session even while another awaits recovery, and reports the block', () => {
    const { store, path } = openStore(1);
    seed(store, ['s-1', 's-3']);
    accept(store, 's-1', 1);
    accept(store, 's-3', 1);
    const claimed = store.claimNextInput('s-1');
    if (claimed.kind !== 'claimed') {
      throw new Error('expected a claim');
    }
    store.close();
    stores.splice(stores.indexOf(store), 1);
    const restarted = new Store({ path, serverEpoch: 2 });
    stores.push(restarted);
    expect(restarted.scanStartup()).toEqual({ interrupted: 1 });
    const dispatcher = new Dispatcher(restarted);

    const outcomes = dispatcher.drain();

    expect(outcomes.map((outcome) => (outcome.kind === 'claimed' ? `claimed:${outcome.sessionId}` : outcome.kind))).toEqual([
      'claimed:s-3',
      'blocked',
    ]);
    expect(restarted.getInput('s-3-i1')?.status).toBe('processing');
  });

  it('surfaces every session awaiting recovery across successive passes', () => {
    const { store, path } = openStore(1);
    seed(store, ['s-1', 's-2', 's-3']);
    accept(store, 's-1', 1);
    accept(store, 's-2', 1);
    for (const sessionId of ['s-1', 's-2']) {
      const claimed = store.claimNextInput(sessionId);
      if (claimed.kind !== 'claimed') {
        throw new Error(`expected a claim for ${sessionId}`);
      }
    }
    closeStore(store);
    const restarted = new Store({ path, serverEpoch: 2 });
    stores.push(restarted);
    expect(restarted.scanStartup()).toEqual({ interrupted: 2 });
    const dispatcher = new Dispatcher(restarted);

    const first = dispatcher.nextClaim();
    const second = dispatcher.nextClaim();

    expect([
      first.kind === 'blocked' ? first.sessionId : first.kind,
      second.kind === 'blocked' ? second.sessionId : second.kind,
    ]).toEqual(['s-1', 's-2']);
  });

  it('drains only currently claimable work', () => {
    const { store } = openStore();
    seed(store, ['s-1', 's-2']);
    accept(store, 's-1', 1);
    accept(store, 's-2', 1);
    const dispatcher = new Dispatcher(store);

    const outcomes = dispatcher.drain();

    // `idle` ends the pass and is not itself a result.
    expect(outcomes.map((outcome) => (outcome.kind === 'claimed' ? outcome.sessionId : outcome.kind))).toEqual([
      's-1',
      's-2',
    ]);
  });
});