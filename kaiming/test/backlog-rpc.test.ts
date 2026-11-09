import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Store } from '../src/store/store.ts';
import { RpcRouter, type RpcContext } from '../src/server/rpc.ts';
import { registerReadMethods } from '../src/server/read-methods.ts';
import { registerWriteMethods } from '../src/server/write-methods.ts';
import { backlogPath } from '../src/runtime/backlog-store.ts';

const dirs: string[] = [];
const stores: Store[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const FILE = [
  '# 待办',
  '',
  '## 未完成',
  '',
  '### B-1 一件事',
  '- 状态: open',
  '- 规格: .dev/product/a.md',
  '',
  '### B-3 写坏了',
  '- 创建: 2026-11-01T09:00:00Z',
  '',
].join('\n');

interface World {
  readonly store: Store;
  readonly router: RpcRouter;
  readonly invalidations: Array<{ sessionId: string; entity: string; id: string }>;
  readonly projectA: string;
  readonly projectB: string;
  readonly pathA: string;
  call(
    method: string,
    params: Record<string, unknown>,
    options?: { requestId?: string; actorId?: string },
  ): Promise<{ result?: unknown; error?: { code: string; details?: unknown } }>;
}

function world(): World {
  const root = mkdtempSync(join(tmpdir(), 'kaiming-backlog-rpc-'));
  dirs.push(root);
  const a = join(root, 'a');
  const b = join(root, 'b');
  for (const dir of [a, b]) {
    mkdirSync(join(dir, '.dev'), { recursive: true });
  }
  writeFileSync(backlogPath(a), FILE, 'utf8');
  writeFileSync(backlogPath(b), '# 待办\n\n## 未完成\n', 'utf8');
  const store = new Store({ path: join(root, 'state.db'), serverEpoch: 1 });
  stores.push(store);
  store.createProject({ id: 'p-a', realPath: realpathSync(a) });
  store.createProject({ id: 'p-b', realPath: realpathSync(b) });
  store.createSession({ id: 'c-a', projectId: 'p-a', roleId: 'chief', cwd: realpathSync(a) });
  store.createSession({ id: 'c-b', projectId: 'p-b', roleId: 'chief', cwd: realpathSync(b) });
  const invalidations: World['invalidations'] = [];
  const router = new RpcRouter();
  registerReadMethods(router, { store });
  registerWriteMethods(router, {
    store,
    notify: () => undefined,
    stopInput: async () => ({ status: 'stopped', stopRequested: true }),
    controlTask: async () => ({ status: 'paused', revision: 1, currentSessionIds: [] }),
    invalidate: (sessionId, entity, id) => {
      invalidations.push({ sessionId, entity, id });
    },
  });
  let counter = 0;
  return {
    store,
    router,
    invalidations,
    projectA: 'p-a',
    projectB: 'p-b',
    pathA: backlogPath(a),
    async call(method, params, options = {}) {
      const context: RpcContext = {
        store,
        actor: 'cookie-session-value',
        actorId: options.actorId ?? 'alice',
        requestId: options.requestId ?? `req-${(counter += 1)}`,
      };
      const response = await router.handle(
        { requestId: context.requestId, method, params },
        context,
        () => context.requestId,
      );
      return response.error === undefined
        ? { result: response.result }
        : { error: response.error as { code: string; details?: unknown } };
    },
  };
}

interface Item {
  id: string;
  state: string;
  createdBy?: string;
  digest: string;
  openTasks: Array<{ taskId: string }>;
}

describe('backlog RPC', () => {
  it('round-trips add/get/list and records the operator, not the cookie value', async () => {
    const w = world();
    const added = await w.call(
      'backlog.add',
      { projectId: w.projectA, title: '新条目', body: '两句。', specRefs: [] },
      { actorId: 'alice' },
    );
    const item = (added.result as { item: Item }).item;
    expect(item.id).toBe('B-4');
    expect(item.createdBy).toBe('alice');
    expect(w.invalidations).toContainEqual({ sessionId: 'c-a', entity: 'backlog', id: 'B-4' });
    expect(w.invalidations.some((entry) => entry.sessionId === 'c-b')).toBe(false);

    const read = await w.call('backlog.get', { projectId: w.projectA, id: 'B-4' });
    expect((read.result as Item).id).toBe('B-4');

    const list = await w.call('backlog.list', { projectId: w.projectA });
    const ids = (list.result as { items: Item[] }).items.map((entry) => entry.id);
    expect(ids).toContain('B-1');
    expect(ids).toContain('B-4');
    expect((list.result as { items: Array<{ openTasks: unknown[] }> }).items.every((entry) => Array.isArray(entry.openTasks))).toBe(true);
  });

  it('refuses a cross-project id instead of reading another project', async () => {
    const w = world();
    const result = await w.call('backlog.get', { projectId: w.projectB, id: 'B-1' });
    expect(result.error?.code).toBe('NOT_FOUND');
    const write = await w.call('backlog.close', {
      projectId: w.projectB,
      id: 'B-1',
      state: 'done',
      note: '完成',
    });
    expect(write.error?.code).toBe('NOT_FOUND');
  });

  it('returns the current entry on a stale digest and leaves the file untouched', async () => {
    const w = world();
    const before = readFileSync(w.pathA, 'utf8');
    const stale = await w.call('backlog.update', {
      projectId: w.projectA,
      id: 'B-1',
      expectedDigest: 'stale',
      title: '改坏',
    });
    expect(stale.error?.code).toBe('VERSION_CONFLICT');
    const current = (stale.error?.details as { current: Item }).current;
    expect(current.id).toBe('B-1');
    expect(current.digest).not.toBe('stale');
    expect(readFileSync(w.pathA, 'utf8')).toBe(before);
  });

  it('closes with a note and reopens with a reason', async () => {
    const w = world();
    const noNote = await w.call('backlog.close', { projectId: w.projectA, id: 'B-1', state: 'done' });
    expect(noNote.error?.code).toBe('INVALID_ARGUMENT');

    const closed = await w.call('backlog.close', {
      projectId: w.projectA,
      id: 'B-1',
      state: 'done',
      note: '完成',
    });
    const item = (closed.result as { item: Item }).item;
    expect(item.state).toBe('done');

    const reopened = await w.call('backlog.reopen', {
      projectId: w.projectA,
      id: 'B-1',
      expectedDigest: item.digest,
      note: '又出现了',
    });
    expect((reopened.result as { item: Item }).item.state).toBe('open');
  });

  it('replays the same requestId without writing twice', async () => {
    const w = world();
    const first = await w.call(
      'backlog.add',
      { projectId: w.projectA, title: '只写一次' },
      { requestId: 'same-request' },
    );
    const second = await w.call(
      'backlog.add',
      { projectId: w.projectA, title: '只写一次' },
      { requestId: 'same-request' },
    );
    expect((first.result as { item: Item }).item.id).toBe((second.result as { item: Item }).item.id);
    const list = await w.call('backlog.list', { projectId: w.projectA, query: '只写一次' });
    expect((list.result as { items: unknown[] }).items).toHaveLength(1);
  });

  it('keeps reads side-effect free and reports problem entries without hiding them', async () => {
    const w = world();
    const before = readFileSync(w.pathA, 'utf8');
    const mtime = statSync(w.pathA).mtimeMs;
    const list = await w.call('backlog.list', { projectId: w.projectA, state: 'all' });
    const broken = (list.result as { items: Array<Record<string, unknown>> }).items.find(
      (entry) => entry['id'] === 'B-3',
    );
    expect((broken?.['problems'] as unknown[]).length).toBeGreaterThan(0);
    await w.call('backlog.get', { projectId: w.projectA, id: 'B-1' });
    expect(readFileSync(w.pathA, 'utf8')).toBe(before);
    expect(statSync(w.pathA).mtimeMs).toBe(mtime);
  });

  it('lists pending questions for the whole project when sessionId is omitted', async () => {
    const w = world();
    const add = (projectId: string, sessionId: string, id: string) =>
      w.store.createInteraction({
        interactionId: id,
        projectId,
        sessionId,
        method: 'confirm',
        title: 'decide',
        requestKey: id,
      });
    add(w.projectA, 'c-a', 'q-a');
    add(w.projectB, 'c-b', 'q-b');
    const all = await w.call('interaction.list', { projectId: w.projectA });
    expect((all.result as { interactions: Array<{ interactionId: string }> }).interactions.map((entry) => entry.interactionId)).toEqual([
      'q-a',
    ]);
    const one = await w.call('interaction.list', { projectId: w.projectA, sessionId: 'c-a' });
    expect((one.result as { interactions: Array<{ interactionId: string }> }).interactions).toHaveLength(1);
  });
});
