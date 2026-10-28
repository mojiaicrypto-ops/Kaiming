/**
 * Manual compaction at the runner boundary: the lock serializes it with claims, and the three
 * ordinary refusals (running, interrupted, no live instance) are classified rather than thrown.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { Store } from '../src/store/store.ts';
import { InputRunner } from '../src/runtime/runner.ts';
import type { SessionRegistry } from '../src/runtime/registry.ts';

const dirs: string[] = [];
const stores: Store[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixture(options: { compact?: () => Promise<unknown>; hasHandle?: boolean; percent?: number } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'devagent-compact-'));
  dirs.push(root);
  const store = new Store({ path: join(root, 'state.db'), serverEpoch: 1 });
  stores.push(store);
  store.createProject({ id: 'p-1', realPath: root });
  store.createSession({ id: 's-1', projectId: 'p-1', roleId: 'chief', cwd: root });
  const calls: number[] = [];
  const handle = {
    session: {
      compact: async () => {
        calls.push(1);
        return (await options.compact?.()) ?? { tokensBefore: 1000, estimatedTokensAfter: 200 };
      },
      isCompacting: false,
      getContextUsage: () => ({ tokens: options.percent ?? 700, contextWindow: 1000, percent: options.percent ?? 70 }),
    },
  };
  const registry = {
    get: (sessionId: string) => (sessionId === 's-1' && options.hasHandle !== false ? handle : undefined),
  } as unknown as SessionRegistry;
  const runner = new InputRunner({
    store,
    registry,
    factory: {} as never,
    resolveConfig: () => {
      throw new Error('not used');
    },
  });
  return { store, runner, calls, path: join(root, 'state.db') };
}

function accept(store: Store, inputId = 'i-1'): void {
  store.acceptInput({
    inputId,
    projectId: 'p-1',
    sessionId: 's-1',
    sourceKey: `s-1:${inputId}`,
    requestKey: inputId,
    method: 'session.input.submit',
    kind: 'user',
    payload: { content: [{ type: 'text', text: 'hi' }] },
  });
}

/** A runner whose only real step is compaction: acquiring a Pi instance fails immediately after. */
function runFixture(options: { compact?: () => Promise<unknown>; threshold?: number } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'devagent-compact-run-'));
  dirs.push(root);
  const store = new Store({ path: join(root, 'state.db'), serverEpoch: 1 });
  stores.push(store);
  store.createProject({ id: 'p-1', realPath: root });
  store.createSession({ id: 's-1', projectId: 'p-1', roleId: 'chief', cwd: root });
  const calls: number[] = [];
  const handle = {
    session: {
      compact: async () => {
        calls.push(1);
        return (await options.compact?.()) ?? { tokensBefore: 1000, estimatedTokensAfter: 200 };
      },
      isCompacting: false,
      getContextUsage: () => ({ tokens: 800, contextWindow: 1000, percent: 80 }),
    },
  };
  const registry = {
    get: () => handle,
    acquire: async () => {
      throw new Error('the test stops before creating a Pi instance');
    },
  } as unknown as SessionRegistry;
  const runner = new InputRunner({
    store,
    registry,
    factory: {
      isAvailable: async () => true,
      searchKey: async () => undefined,
    } as never,
    resolveConfig: () =>
      ({
        selection: { providerId: 'stub', modelId: 'stub-1' },
        thinkingLevel: 'off',
        source: 'server',
        agentDir: join(root, 'agent'),
        promptDir: join(root, '..', '..', 'docs', 'technicalnew', 'prompts'),
        tools: [],
      }) as never,
  });
  accept(store);
  return { store, runner, calls };
}

describe('manual compaction', () => {
  it('compacts before delivery only when the live percentage reaches the global threshold', async () => {
    const { store, runner, calls } = fixture();
    expect(await runner.compactIfDue('s-1')).toMatchObject({ status: 'compacted' });
    expect(calls).toHaveLength(1);

    // 70% is the default; a 60% reading must not compact, and turning auto off must not either.
    store.saveCompactionConfig({ auto: true, thresholdPercent: 80, expectedRevision: 1 });
    const quiet = fixture({ percent: 60 });
    expect(await quiet.runner.compactIfDue('s-1')).toBeNull();
    expect(quiet.calls).toHaveLength(0);
    quiet.store.saveCompactionConfig({ auto: false, thresholdPercent: 70, expectedRevision: 1 });
    expect(await quiet.runner.compactIfDue('s-1')).toBeNull();
    expect(quiet.calls).toHaveLength(0);
  });

  it('compacts an idle live session and reports both token counts', async () => {
    const { runner, calls } = fixture();

    await expect(runner.compactManually('s-1')).resolves.toEqual({
      status: 'compacted',
      tokensBefore: 1000,
      estimatedTokensAfter: 200,
    });
    expect(calls).toHaveLength(1);
  });

  it('refuses while an input is running, before calling Pi', async () => {
    const { store, runner, calls } = fixture();
    accept(store);
    store.claimNextInput('s-1');

    await expect(runner.compactManually('s-1')).resolves.toEqual({ status: 'busy' });
    expect(calls).toHaveLength(0);
  });

  it('refuses while an input is interrupted and still awaiting verification', async () => {
    const { store, runner, path } = fixture();
    accept(store);
    store.claimNextInput('s-1');
    const raw = new DatabaseSync(path);
    raw.prepare("UPDATE session_inputs SET status = 'interrupted' WHERE inputId = 'i-1'").run();
    raw.close();

    await expect(runner.compactManually('s-1')).resolves.toEqual({ status: 'recovery' });
  });

  it('refuses without a live instance, so a restart cannot pretend to compact', async () => {
    const { runner } = fixture({ hasHandle: false });
    await expect(runner.compactManually('s-1')).resolves.toEqual({ status: 'unavailable' });
  });

  it('turns Pi "nothing to compact" into an ordinary outcome, not a failure', async () => {
    const { runner } = fixture({
      compact: async () => {
        throw new Error('Nothing to compact (session too small)');
      },
    });
    await expect(runner.compactManually('s-1')).resolves.toEqual({ status: 'nothing' });
  });

  it('reports a real failure without throwing', async () => {
    const { runner } = fixture({
      compact: async () => {
        throw new Error('provider exploded');
      },
    });
    await expect(runner.compactManually('s-1')).resolves.toEqual({
      status: 'failed',
      detail: 'provider exploded',
    });
  });
});

describe('compaction at the claim site', () => {
  it('compacts between the claim and delivery, so the input runs after the summary', async () => {
    const { runner, calls } = runFixture();

    const outcome = await runner.runNext('s-1');

    expect(calls).toHaveLength(1);
    // The test factory refuses to create a Pi instance; the input still ends with a terminal row.
    expect(['failed', 'interrupted']).toContain(outcome.kind);
  });

  it('records a stop that arrives during the summary instead of delivering the input', async () => {
    const gate = Promise.withResolvers<void>();
    const { store, runner, calls } = runFixture({ compact: async () => { await gate.promise; return { tokensBefore: 1000, estimatedTokensAfter: 200 }; } });
    const running = runner.runNext('s-1');
    while (calls.length === 0) await new Promise((resolve) => setTimeout(resolve, 5));
    store.requestStop({ inputId: 'i-1', requestKey: 'stop-during-compaction', reason: 'user' });
    gate.resolve();

    const outcome = await running;

    expect(outcome.kind).toBe('stopped');
    expect(store.getInput('i-1')?.status).toBe('stopped');
  });
});
