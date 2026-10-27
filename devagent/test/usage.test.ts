import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Store } from '../src/store/store.ts';

const dirs: string[] = [];
const stores: Store[] = [];

function openStore(): Store & { path: string } {
  const dir = mkdtempSync(join(tmpdir(), 'devagent-usage-'));
  dirs.push(dir);
  const path = join(dir, 'state.db');
  const store = new Store({ path, serverEpoch: 1 });
  store.createProject({ id: 'p-1', realPath: '/projects/alpha' });
  store.createProject({ id: 'p-2', realPath: '/projects/beta' });
  stores.push(store);
  return Object.assign(store, { path });
}

afterEach(() => {
  for (const store of stores.splice(0)) {
    store.close();
  }
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const entry = (overrides: Partial<Parameters<Store['recordUsage']>[0]['entries'][number]> = {}) => ({
  providerId: 'zai',
  modelId: 'glm-5-3',
  inputTokens: 100,
  outputTokens: 20,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  reasoningTokens: 5,
  costTotal: 0.5,
  responses: 1,
  ...overrides,
});

function record(
  store: Store,
  overrides: Partial<Parameters<Store['recordUsage']>[0]> = {},
): number {
  return store.recordUsage({
    inputId: 'i-1',
    projectId: 'p-1',
    sessionId: 's-1',
    roleId: 'chief',
    startedAt: '2026-10-27T00:00:00.000Z',
    endedAt: '2026-10-27T00:00:01.000Z',
    entries: [entry()],
    ...overrides,
  });
}

describe('usage ledger', () => {
  it('adds one turn to the totals, and the same turn twice is still one turn', () => {
    const store = openStore();
    expect(record(store)).toBe(1);
    // The runner records before the input's terminal write, so a retry after a crash must not count
    // the tokens again. The key is (input, provider, model) — the same input can legitimately have
    // several models, which is why it is not keyed by input alone.
    expect(record(store)).toBe(0);

    const report = store.usageReport();
    expect(report.totals).toMatchObject({
      responses: 1,
      inputTokens: 100,
      outputTokens: 20,
      reasoningTokens: 5,
    });
    expect(report.byRole).toHaveLength(1);
    expect(report.byModel).toHaveLength(1);
  });

  it('keeps several models of one input, and costs them separately', () => {
    const store = openStore();
    record(store, {
      entries: [
        entry({ providerId: 'zai', modelId: 'glm-5-3', inputTokens: 100, costTotal: 0.5 }),
        entry({ providerId: 'deepseek', modelId: 'deepseek-flash', inputTokens: 60, costTotal: 0.2 }),
      ],
    });

    const report = store.usageReport();
    expect(report.totals).toMatchObject({ responses: 2, inputTokens: 160 });
    expect(report.totals.costTotal).toBeCloseTo(0.7);
    // Largest first: the table is read top-down for where the tokens went.
    expect(report.byModel.map((row) => row.modelId)).toEqual(['glm-5-3', 'deepseek-flash']);
  });

  it('separates one project from all projects without counting anything twice', () => {
    const store = openStore();
    record(store, { inputId: 'i-1', projectId: 'p-1', roleId: 'chief' });
    record(store, { inputId: 'i-2', projectId: 'p-1', roleId: 'developer', entries: [entry({ inputTokens: 40 })] });
    record(store, {
      inputId: 'i-3',
      projectId: 'p-2',
      roleId: 'chief',
      entries: [entry({ inputTokens: 7, responses: 1 })],
    });

    const project = store.usageReport({ projectId: 'p-1' });
    expect(project.scope).toBe('project');
    expect(project.totals).toMatchObject({ responses: 2, inputTokens: 140 });
    expect(project.byRole.map((row) => row.roleId).sort()).toEqual(['chief', 'developer']);

    const all = store.usageReport();
    expect(all.scope).toBe('all');
    expect(all.totals).toMatchObject({ responses: 3, inputTokens: 147 });
    // The per-role rows of "all projects" merge the two projects' chief turns.
    expect(all.byRole.find((row) => row.roleId === 'chief')?.inputTokens).toBe(107);
  });

  it('reports an unreported figure as missing, not as zero', () => {
    const store = openStore();
    record(store, {
      entries: [entry({ inputTokens: null, outputTokens: null, costTotal: null, responses: 1 })],
    });
    const report = store.usageReport();
    // The request happened — that is known. What it cost is not, and saying "$0" would be a lie.
    expect(report.totals.responses).toBe(1);
    expect(report.totals.inputTokens).toBeNull();
    expect(report.totals.costTotal).toBeNull();
  });

  it('records nothing when a turn produced no response (refused input, no model call)', () => {
    const store = openStore();
    expect(record(store, { entries: [] })).toBe(0);
    expect(store.usageReport().totals.responses).toBe(0);
  });

  it('survives a reopen: the ledger is on disk, not in memory', () => {
    const store = openStore();
    record(store);
    const path = store.path;
    stores.splice(stores.indexOf(store), 1);
    store.close();
    const reopened = new Store({ path, serverEpoch: 2 });
    stores.push(reopened);
    expect(reopened.usageReport().totals.inputTokens).toBe(100);
  });
});
