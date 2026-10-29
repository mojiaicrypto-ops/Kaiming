import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Store } from '../src/store/store.ts';
import { WorkbenchWorker } from '../src/server/worker.ts';
import type { RunOutcome } from '../src/runtime/runner.ts';

const dirs: string[] = [];
const stores: Store[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixture(): Store {
  const root = mkdtempSync(join(tmpdir(), 'devagent-worker-'));
  dirs.push(root);
  const store = new Store({ path: join(root, 'state.db'), serverEpoch: 1 });
  stores.push(store);
  store.createProject({ id: 'p-1', realPath: root });
  store.createSession({ id: 's-1', projectId: 'p-1', roleId: 'chief', cwd: root });
  store.createSession({ id: 's-2', projectId: 'p-1', roleId: 'chief', cwd: root });
  return store;
}

const completed = (inputId: string): RunOutcome => ({ kind: 'completed', inputId, detail: 'done' });

describe('WorkbenchWorker', () => {
  it('starts a second session while the first run is still in flight', async () => {
    const store = fixture();
    const started: string[] = [];
    const gates = new Map<string, () => void>();
    const runner = {
      runNext: (sessionId: string): Promise<RunOutcome> => {
        started.push(sessionId);
        return new Promise<RunOutcome>((resolve) => {
          gates.set(sessionId, () => resolve(completed(`i-${sessionId}`)));
        });
      },
    };
    const worker = new WorkbenchWorker({ store, runner, idleDelayMs: 5 });
    worker.start();
    try {
      await waitUntil(() => started.length === 2);
      expect(new Set(started)).toEqual(new Set(['s-1', 's-2']));
    } finally {
      for (const resolve of gates.values()) resolve();
      await worker.stop();
    }
  });

  it('never starts the same session twice while its run is in flight', async () => {
    const store = fixture();
    const calls: string[] = [];
    let resolveFirst: (() => void) | undefined;
    let secondRan = false;
    const runner = {
      runNext: (sessionId: string): Promise<RunOutcome> => {
        calls.push(sessionId);
        if (sessionId === 's-1') {
          return new Promise<RunOutcome>((resolve) => {
            resolveFirst = () => resolve(completed('i-1'));
          });
        }
        if (!secondRan) {
          secondRan = true;
          return Promise.resolve(completed('i-2'));
        }
        return Promise.resolve({ kind: 'idle' } as RunOutcome);
      },
    };
    const worker = new WorkbenchWorker({ store, runner, idleDelayMs: 5 });
    worker.start();
    try {
      await waitUntil(() => resolveFirst !== undefined && calls.includes('s-2'));
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(calls.filter((id) => id === 's-1')).toHaveLength(1);
    } finally {
      resolveFirst?.();
      await worker.stop();
    }
  });

  it('waits for every in-flight run before stop resolves', async () => {
    const store = fixture();
    const gates = new Map<string, () => void>();
    const started: string[] = [];
    const runner = {
      runNext: (sessionId: string): Promise<RunOutcome> => {
        started.push(sessionId);
        return new Promise<RunOutcome>((resolve) => {
          gates.set(sessionId, () => resolve(completed(`i-${sessionId}`)));
        });
      },
    };
    const worker = new WorkbenchWorker({ store, runner, idleDelayMs: 5 });
    worker.start();
    try {
      await waitUntil(() => started.length === 2);
      let stopped = false;
      const stopping = worker.stop().then(() => {
        stopped = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(stopped).toBe(false);
      for (const resolve of gates.values()) resolve();
      await stopping;
      expect(stopped).toBe(true);
    } finally {
      for (const resolve of gates.values()) resolve();
      await worker.stop();
    }
  });

  it('isolates one session failure from the other session', async () => {
    const store = fixture();
    const started: string[] = [];
    const errors: string[] = [];
    const outcomes: string[] = [];
    let firstRan = false;
    let failed = false;
    const runner = {
      runNext: (sessionId: string): Promise<RunOutcome> => {
        started.push(sessionId);
        if (sessionId === 's-1' && !firstRan) {
          firstRan = true;
          return Promise.resolve(completed('i-1'));
        }
        if (sessionId === 's-2' && !failed) {
          failed = true;
          return Promise.reject(new Error('boom-s-2'));
        }
        return Promise.resolve({ kind: 'idle' } as RunOutcome);
      },
    };
    const worker = new WorkbenchWorker({
      store,
      runner,
      idleDelayMs: 5,
      onError: (sessionId, error) => errors.push(`${sessionId}:${String(error)}`),
      onOutcome: (sessionId, outcome) => outcomes.push(`${sessionId}:${outcome.kind}`),
    });
    worker.start();
    try {
      await waitUntil(() => errors.length > 0 && outcomes.includes('s-1:completed'));
      expect(errors[0]).toContain('boom-s-2');
    } finally {
      await worker.stop();
    }
  });
});

async function waitUntil(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('condition was not reached in time');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
