/**
 * The worker's idle pass must probe only sessions the store can act on: a session with no
 * queued, running or interrupted input can only be idle, and re-deriving that per pass made
 * idle CPU grow linearly with the session table (see plan worker-idle-scan-20261114).
 *
 * Real timers are used on purpose: the loop under test schedules itself with real timeouts, and
 * the assertion needs several genuine completed passes, not a faked clock.
 */
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

/** Yields to the event loop for one short, real tick (the worker passes are real-time too). */
const tick = (): Promise<void> => {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, 5);
  return promise;
};

/** Polls until the condition holds; bounded so a broken loop fails the test instead of hanging. */
async function until(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('condition was not reached in time');
    await tick();
  }
}

function fixture(): { store: Store } {
  const root = mkdtempSync(join(tmpdir(), 'kaiming-idle-scan-'));
  dirs.push(root);
  const store = new Store({ path: join(root, 'state.db'), serverEpoch: 1 });
  stores.push(store);
  store.createProject({ id: 'p-1', realPath: root });
  const created = new Set<string>();
  const session = (id: string): void => {
    if (created.has(id)) return;
    store.createSession({ id, projectId: 'p-1', roleId: 'chief', cwd: root });
    created.add(id);
  };
  let seq = 0;
  const queue = (id: string): string => {
    session(id);
    seq += 1;
    const inputId = `i-${id}-${seq}`;
    store.acceptInput({
      inputId,
      projectId: 'p-1',
      sessionId: id,
      sourceKey: `${id}:${seq}`,
      requestKey: inputId,
      method: 'session.input.submit',
      kind: 'user',
      payload: { content: [{ type: 'text', text: 'go' }] },
    });
    return inputId;
  };
  // Turn the session's queued row into the named terminal/live state through the real claim path.
  const settle = (id: string, status: 'completed' | 'interrupted' | 'processing'): void => {
    const inputId = queue(id);
    store.claimNextInput(id);
    if (status === 'processing') return;
    store.finishInput({
      inputId,
      expectedRevision: store.getInput(inputId)?.revision ?? 2,
      status,
    });
  };
  // s-queued keeps a queued input for the whole test (the stubbed runner never claims it).
  queue('s-queued');
  // s-processing holds a claimed, never-finished input, exactly like a run that is in flight.
  settle('s-processing', 'processing');
  // s-interrupted is the restart path: claimed once, then interrupted.
  settle('s-interrupted', 'interrupted');
  // s-terminal only ever had a completed input.
  settle('s-terminal', 'completed');
  // s-empty exists but has no input at all.
  session('s-empty');
  return { store };
}

const idle = (): RunOutcome => ({ kind: 'idle' }) as RunOutcome;

describe('worker idle scanning', () => {
  it('probes only sessions the store can act on across idle passes', async () => {
    const { store } = fixture();
    const probes = new Map<string, number>();
    const runner = {
      runNext: (sessionId: string): Promise<RunOutcome> => {
        probes.set(sessionId, (probes.get(sessionId) ?? 0) + 1);
        return Promise.resolve(idle());
      },
    };
    const worker = new WorkbenchWorker({ store, runner, idleDelayMs: 4 });
    worker.start();
    try {
      // Three direct observations of s-queued mean at least two full idle passes have finished;
      // any probe of a work-less session would have happened inside those same passes.
      await until(() => (probes.get('s-queued') ?? 0) >= 3);
      for (const id of ['s-queued', 's-processing', 's-interrupted']) {
        expect(probes.get(id)).toBeGreaterThanOrEqual(2);
      }
      // Negative controls: the old behavior probed every session each pass; it must be gone
      // both for a session with no input and for one with only terminal input.
      expect(probes.get('s-empty')).toBeUndefined();
      expect(probes.get('s-terminal')).toBeUndefined();
    } finally {
      await worker.stop();
    }
  });

  it('keeps the busy and blocked surfaces when those sessions are probed', async () => {
    const { store } = fixture();
    const observed = new Set<string>();
    const runner = {
      runNext: (sessionId: string): Promise<RunOutcome> => {
        observed.add(`${sessionId}:${store.claimNextInput(sessionId).kind}`);
        return Promise.resolve(idle());
      },
    };
    const worker = new WorkbenchWorker({ store, runner, idleDelayMs: 4 });
    worker.start();
    try {
      await until(() => observed.has('s-processing:busy') && observed.has('s-interrupted:blocked'));
      expect(observed.has('s-queued:claimed')).toBe(true);
    } finally {
      await worker.stop();
    }
  });

  it('picks a session up as soon as it gains queued work', async () => {
    const { store } = fixture();
    const probed = new Set<string>();
    const runner = {
      runNext: (sessionId: string): Promise<RunOutcome> => {
        probed.add(sessionId);
        return Promise.resolve(idle());
      },
    };
    const worker = new WorkbenchWorker({ store, runner, idleDelayMs: 4 });
    worker.start();
    try {
      await until(() => (probed.size >= 3));
      expect(probed.has('s-empty')).toBe(false);
      // Fresh work for a previously work-less session: the next idle pass must find it.
      store.acceptInput({
        inputId: 'i-s-empty-late',
        projectId: 'p-1',
        sessionId: 's-empty',
        sourceKey: 's-empty:late',
        requestKey: 'i-s-empty-late',
        method: 'session.input.submit',
        kind: 'user',
        payload: { content: [{ type: 'text', text: 'go' }] },
      });
      await until(() => probed.has('s-empty'));
    } finally {
      await worker.stop();
    }
  });

  it('store.listRunnableSessionIds names exactly the three non-idle statuses, once each', () => {
    const { store } = fixture();
    expect(store.listRunnableSessionIds()).toEqual(['s-interrupted', 's-processing', 's-queued']);
  });
});
