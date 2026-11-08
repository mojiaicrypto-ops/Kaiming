import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Store } from '../src/store/store.ts';
import { backlogPath } from '../src/runtime/backlog-store.ts';
import { createTaskTool, type TaskToolContext } from '../src/tools/task-tools.ts';

const dirs: string[] = [];
const stores: Store[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const PLAN = '# 计划\n\n## 验收\n- 行为可观察。\n';

const BACKLOG = [
  '# 待办',
  '',
  '## 未完成',
  '',
  '### B-1 可以实施',
  '- 状态: open',
  '',
  '### B-2 已经关闭',
  '- 状态: done',
  '- 说明: 完成',
  '',
  '### B-3 写坏了',
  '- 创建: 2026-11-01T09:00:00Z',
  '',
].join('\n');

interface World {
  readonly store: Store;
  readonly cwd: string;
  readonly execute: (args: Record<string, unknown>) => Promise<{ details: Record<string, unknown>; isError: boolean; text: string }>;
  readonly path: string;
}

function world(): World {
  const root = mkdtempSync(join(tmpdir(), 'kaiming-task-backlog-'));
  dirs.push(root);
  const cwd = join(root, 'project');
  mkdirSync(join(cwd, '.dev'), { recursive: true });
  const path = backlogPath(cwd);
  writeFileSync(path, BACKLOG, 'utf8');
  const store = new Store({ path: join(root, 'state.db'), serverEpoch: 1 });
  stores.push(store);
  store.createProject({ id: 'p-1', realPath: cwd });
  for (const sessionId of ['c-1', 'c-2']) {
    store.createSession({ id: sessionId, projectId: 'p-1', roleId: 'chief', cwd });
  }
  store.acceptInput({
    inputId: 'i-dec',
    projectId: 'p-1',
    sessionId: 'c-1',
    sourceKey: 'c-1:i-dec',
    requestKey: 'i-dec',
    method: 'session.input.submit',
    kind: 'user',
    payload: { content: [{ type: 'text', text: 'go' }] },
  });
  const tool = createTaskTool(
    (): TaskToolContext => ({
      store,
      sessionId: 'c-1',
      projectId: 'p-1',
      cwd,
      roleId: 'chief',
      inputId: 'i-2',
      serverWorkDir: join(root, 'work'),
      ...(store.getSession('c-1')?.currentTaskId != null
        ? { currentTaskId: store.getSession('c-1')?.currentTaskId as string }
        : {}),
    }),
    { chief: true },
  );
  return {
    store,
    cwd,
    path,
    async execute(args) {
      const outcome = await tool.execute('c1', args);
      return { details: outcome.details, isError: outcome.isError, text: outcome.content[0]?.text ?? '' };
    },
  };
}

function createArgs(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    op: 'create',
    type: 'write',
    goal: '实施 B-1',
    scope: '账号模块',
    planMarkdown: PLAN,
    requiresTest: false,
    backlogIds: ['B-1'],
    authorizationRef: { inputId: 'i-dec' },
    ...overrides,
  };
}

describe('backlog association', () => {
  it('creates a write Task that carries backlogIds', async () => {
    const w = world();
    const result = await w.execute(createArgs());
    expect(result.isError).toBe(false);
    const taskId = result.details['taskId'] as string;
    expect(w.store.getTask(taskId)?.backlogIds).toEqual(['B-1']);
  });

  it('refuses another open Task on the same item and names the existing one', async () => {
    const w = world();
    const result = await w.execute(createArgs());
    const taskId = result.details['taskId'] as string;
    expect(() =>
      w.store.createTask({
        id: 't-000000000001',
        projectId: 'p-1',
        chiefSessionId: 'c-2',
        ownerEpoch: 1,
        type: 'write',
        requiresTest: false,
        goal: 'again',
        scope: 'x',
        acceptanceRefs: [],
        basisRefs: [],
        planRef: { storage: 'server', path: '/tmp/p.md', sha256: 'p' },
        authorizationRefs: [],
        sourceInputId: 'i-dec',
        backlogIds: ['B-1'],
      }),
    ).toThrowError(/already has an open Task/);
    try {
      w.store.createTask({
        id: 't-000000000002',
        projectId: 'p-1',
        chiefSessionId: 'c-2',
        ownerEpoch: 1,
        type: 'write',
        requiresTest: false,
        goal: 'again',
        scope: 'x',
        acceptanceRefs: [],
        basisRefs: [],
        planRef: { storage: 'server', path: '/tmp/p.md', sha256: 'p' },
        authorizationRefs: [],
        sourceInputId: 'i-dec',
        backlogIds: ['B-1'],
      });
    } catch (error) {
      const busy = error as { code?: string; details?: Record<string, unknown> };
      expect(busy.code).toBe('TASK_BUSY');
      expect(busy.details?.['taskId']).toBe(taskId);
    }
    // Cancelling the first Task releases the item.
    w.store.controlTask({ taskId, command: 'cancel' });
    w.store.createTask({
      id: 't-000000000003',
      projectId: 'p-1',
      chiefSessionId: 'c-2',
      ownerEpoch: 1,
      type: 'write',
      requiresTest: false,
      goal: 'after cancel',
      scope: 'x',
      acceptanceRefs: [],
      basisRefs: [],
      planRef: { storage: 'server', path: '/tmp/p.md', sha256: 'p' },
      authorizationRefs: [],
      sourceInputId: 'i-dec',
      backlogIds: ['B-1'],
    });
  });

  it('refuses missing, broken, closed and read Task associations', async () => {
    const w = world();
    const missing = await w.execute(createArgs({ backlogIds: ['B-99'] }));
    expect(missing.details['code']).toBe('NOT_FOUND');

    const broken = await w.execute(createArgs({ backlogIds: ['B-3'] }));
    expect(broken.details['code']).toBe('INVALID_ARGUMENT');
    expect(broken.text).toContain('format problem');

    const closed = await w.execute(createArgs({ backlogIds: ['B-2'] }));
    expect(closed.details['code']).toBe('INVALID_ARGUMENT');
    expect(closed.text).toContain('only open items');

    const read = await w.execute(createArgs({ type: 'read', backlogIds: ['B-1'], requiresTest: undefined }));
    expect(read.details['code']).toBe('INVALID_ARGUMENT');
  });

  it('warns in task.get when an associated item disappears or breaks', async () => {
    const w = world();
    const result = await w.execute(createArgs({ backlogIds: ['B-1'] }));
    expect(result.isError).toBe(false);
    const healthy = await w.execute({ op: 'get', taskId: result.details['taskId'] });
    expect(healthy.details['backlogHints']).toBeUndefined();

    writeFileSync(
      w.path,
      ['# 待办', '', '## 未完成', '', '### B-1 写坏了', '- 创建: 2026-11-01T09:00:00Z', ''].join('\n'),
      'utf8',
    );
    const broken = await w.execute({ op: 'get', taskId: result.details['taskId'] });
    expect(broken.details['backlogHints']).toEqual(['关联的待办需要修复：B-1']);

    writeFileSync(w.path, '# 待办\n\n## 未完成\n', 'utf8');
    const missing = await w.execute({ op: 'get', taskId: result.details['taskId'] });
    expect(missing.details['backlogHints']).toEqual(['关联的待办不存在：B-1']);
  });
});
