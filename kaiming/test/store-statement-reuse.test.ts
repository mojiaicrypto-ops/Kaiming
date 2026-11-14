/**
 * The Store caches prepared statements (`stmt`); a cached statement must rebind correctly for
 * every later call. These tests exercise the hot paths repeatedly with different bindings: the
 * classic failure mode (stale parameters or stale data from an earlier bind) shows up as the
 * wrong row or the wrong shape, and must not.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Store } from '../src/store/store.ts';

const dirs: string[] = [];
const stores: Store[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function open(): Store {
  const root = mkdtempSync(join(tmpdir(), 'kaiming-stmt-'));
  dirs.push(root);
  const store = new Store({ path: join(root, 'state.db'), serverEpoch: 1 });
  stores.push(store);
  store.createProject({ id: 'p-1', realPath: root });
  for (const id of ['s-1', 's-2', 's-3']) {
    store.createSession({ id, projectId: 'p-1', roleId: id === 's-3' ? 'reviewer' : 'chief', cwd: root });
  }
  return store;
}

function queue(store: Store, sessionId: string, inputId: string): void {
  store.acceptInput({
    inputId,
    projectId: 'p-1',
    sessionId,
    sourceKey: `${sessionId}:${inputId}`,
    requestKey: inputId,
    method: 'session.input.submit',
    kind: 'user',
    payload: { content: [{ type: 'text', text: 'go' }] },
  });
}

describe('prepared statement reuse', () => {
  it('rebinds per call across repeated interleaved queries', () => {
    const store = open();
    // Same statement, many different ids, interleaved: each call must see its own row.
    for (let round = 0; round < 3; round += 1) {
      for (const id of ['s-1', 's-2', 's-3']) {
        const session = store.getSession(id);
        expect(session?.id).toBe(id);
        expect(session?.roleId).toBe(id === 's-3' ? 'reviewer' : 'chief');
      }
    }
    expect(store.getSession('s-none')).toBeUndefined();
    // A write through a cached statement is visible to the next cached read.
    store.renameSession({ sessionId: 's-2', title: 'renamed', expectedRevision: store.getSession('s-2')?.revision ?? 1 });
    expect(store.getSession('s-2')?.title).toBe('renamed');
  });

  it('keeps claim and finish consistent across repeated calls', () => {
    const store = open();
    queue(store, 's-1', 'i-1');
    queue(store, 's-2', 'i-2');
    // Claim twice per session in different orders; bindings must not leak between calls.
    expect(store.claimNextInput('s-1')).toMatchObject({ kind: 'claimed' });
    expect(store.claimNextInput('s-2')).toMatchObject({ kind: 'claimed' });
    expect(store.claimNextInput('s-1')).toMatchObject({ kind: 'busy' });
    expect(store.claimNextInput('s-2')).toMatchObject({ kind: 'busy' });
    const first = store.getInput('i-1');
    const second = store.getInput('i-2');
    expect(first?.status).toBe('processing');
    expect(second?.status).toBe('processing');
    expect(store.finishInput({ inputId: 'i-1', expectedRevision: first?.revision ?? 0, status: 'completed' })).toBe(true);
    expect(store.claimNextInput('s-1')).toMatchObject({ kind: 'none' });
    expect(store.claimNextInput('s-2')).toMatchObject({ kind: 'busy' });
  });

  it('survives reopening the same database with a fresh cache', () => {
    const store = open();
    queue(store, 's-1', 'i-9');
    const path = `${dirs[dirs.length - 1]}/state.db`;
    const before = store.getSession('s-1');
    store.close();
    stores.pop();
    // A fresh Store instance re-prepares from the same file; results must match the old instance.
    const reopened = new Store({ path, serverEpoch: 2 });
    stores.push(reopened);
    expect(reopened.getSession('s-1')?.revision).toBe(before?.revision);
    expect(reopened.claimNextInput('s-1')).toMatchObject({ kind: 'claimed' });
  });
});
