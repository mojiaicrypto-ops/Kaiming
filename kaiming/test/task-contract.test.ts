import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Store } from '../src/store/store.ts';
import { createTaskTool, type TaskToolContext } from '../src/tools/task-tools.ts';

const dirs: string[] = [];
const stores: Store[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const PLAN = '# 计划\n\n## 验收\n- 行为可观察。\n';

interface World {
  readonly store: Store;
  readonly cwd: string;
  readonly sessionId: string;
  execute(args: Record<string, unknown>): Promise<{ details: Record<string, unknown>; isError: boolean; text: string }>;
}

function world(): World {
  const root = mkdtempSync(join(tmpdir(), 'kaiming-contract-'));
  dirs.push(root);
  const cwd = join(root, 'project');
  const store = new Store({ path: join(root, 'state.db'), serverEpoch: 1 });
  stores.push(store);
  store.createProject({ id: 'p-1', realPath: cwd });
  store.createSession({ id: 'c-1', projectId: 'p-1', roleId: 'chief', cwd });
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
    sessionId: 'c-1',
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
    goal: '重置密码',
    scope: '账号模块',
    planMarkdown: PLAN,
    requiresTest: false,
    authorizationRef: { inputId: 'i-dec' },
    ...overrides,
  };
}

describe('acceptance gate', () => {
  it('refuses a write Task whose Plan has no acceptance section', async () => {
    const w = world();
    const result = await w.execute(createArgs({ planMarkdown: '# 计划\n只写步骤。\n' }));
    expect(result.isError).toBe(true);
    expect(result.details['code']).toBe('INVALID_ARGUMENT');
    expect(result.details['missing']).toBe('acceptance');
    expect(w.store.listTasks('p-1')).toHaveLength(0);
  });

  it('does not require acceptance from a read Task', async () => {
    const w = world();
    const result = await w.execute(createArgs({ type: 'read', planMarkdown: '# 计划\n', requiresTest: undefined, backlogIds: undefined }));
    expect(result.isError).toBe(false);
  });

  it('accepts an English acceptance heading', async () => {
    const w = world();
    const result = await w.execute(createArgs({ planMarkdown: '# Plan\n\n## Acceptance\n- works\n' }));
    expect(result.isError).toBe(false);
  });

  it('refuses an update that removes the acceptance section', async () => {
    const w = world();
    const created = await w.execute(createArgs());
    const taskId = created.details['taskId'] as string;
    const updated = await w.execute({
      op: 'update',
      taskId,
      changes: { planMarkdown: '# 计划\n没有验收了。\n' },
    });
    expect(updated.details['code']).toBe('INVALID_ARGUMENT');
    expect(updated.details['missing']).toBe('acceptance');
  });

  it('reports acceptanceChanged only when the acceptance text changed', async () => {
    const w = world();
    const created = await w.execute(createArgs());
    const taskId = created.details['taskId'] as string;
    const same = await w.execute({
      op: 'update',
      taskId,
      summary: 'only the summary changed',
      changes: { planMarkdown: `${PLAN}\n## 范围\n\`server/**\`\n` },
    });
    expect(same.details['acceptanceChanged']).toBeUndefined();
    const changed = await w.execute({
      op: 'update',
      taskId,
      changes: { planMarkdown: '# 计划\n\n## 验收\n- 另外一条可观察结果。\n' },
    });
    expect(changed.details['acceptanceChanged']).toBe(true);
    expect(changed.text).toContain('acceptance changed');
  });
});

describe('task identity and operator', () => {
  it('uses a twelve-hex Task id and still reads an old eight-char id', async () => {
    const w = world();
    const created = await w.execute(createArgs());
    expect(created.details['taskId']).toMatch(/^t-[0-9a-f]{12}$/);
    // An old row keeps working: reads are by id, never by its shape.
    w.store.createProject({ id: 'p-2', realPath: join(w.cwd, '..', 'p2') });
    w.store.createSession({ id: 'c-2', projectId: 'p-2', roleId: 'chief', cwd: join(w.cwd, '..', 'p2') });
    w.store.createTask({
      id: 't-abcdef12',
      projectId: 'p-2',
      chiefSessionId: 'c-2',
      ownerEpoch: 1,
      type: 'read',
      requiresTest: false,
      goal: 'old',
      scope: 'x',
      acceptanceRefs: [],
      basisRefs: [],
      planRef: { storage: 'server', path: '/tmp/old.md', sha256: 'old' },
      authorizationRefs: [],
      sourceInputId: 'i-dec',
    });
    expect(w.store.getTask('t-abcdef12')?.id).toBe('t-abcdef12');
  });

  it('records the input actorId, defaulting to local', async () => {
    const w = world();
    w.store.acceptInput({
      inputId: 'i-a',
      projectId: 'p-1',
      sessionId: 'c-1',
      actorId: 'alice',
      sourceKey: 'c-1:i-a',
      requestKey: 'i-a',
      method: 'session.input.submit',
      kind: 'user',
      payload: { content: [{ type: 'text', text: 'x' }] },
    });
    expect(w.store.getInput('i-a')?.actorId).toBe('alice');
    expect(w.store.getInput('i-dec')?.actorId).toBe('local');
  });
});
