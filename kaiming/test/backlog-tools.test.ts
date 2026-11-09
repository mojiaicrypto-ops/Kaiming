import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { backlogPath, readBacklog } from '../src/runtime/backlog-store.ts';
import { createBacklogTool, type BacklogToolContext } from '../src/tools/backlog-tools.ts';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

interface Fixture {
  readonly cwd: string;
  readonly path: string;
  setRole(roleId: string): void;
  setCurrentTask(taskId: string | undefined): void;
  tool: ReturnType<typeof createBacklogTool>;
}

function fixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'kaiming-backlog-tool-'));
  dirs.push(root);
  const cwd = join(root, 'project');
  mkdirSync(join(cwd, '.dev'), { recursive: true });
  const path = backlogPath(cwd);
  writeFileSync(
    path,
    [
      '# 待办',
      '',
      '## 未完成',
      '',
      '### B-1 账号重置',
      '- 状态: open',
      '- 规格: .dev/product/a.md',
      '',
      '### B-2 导出报表',
      '- 状态: open',
      '',
      '## 已关闭',
      '',
      '### B-3 已关闭',
      '- 状态: done',
      '- 说明: 完成',
      '',
    ].join('\n'),
    'utf8',
  );
  const context: {
    cwd: string;
    roleId: string;
    actorId: string;
    sessionId: string;
    inputId: string;
    currentTaskId?: string;
  } = {
    cwd,
    roleId: 'chief',
    actorId: 'local',
    sessionId: 's-1',
    inputId: 'i-9',
  };
  return {
    cwd,
    path,
    setRole: (roleId) => {
      context.roleId = roleId;
    },
    setCurrentTask: (taskId) => {
      if (taskId === undefined) {
        delete context.currentTaskId;
      } else {
        context.currentTaskId = taskId;
      }
    },
    tool: createBacklogTool(() => context),
  };
}

async function run(
  fixture: Fixture,
  args: Record<string, unknown>,
): Promise<{ text: string; details: Record<string, unknown>; isError: boolean }> {
  const outcome = await fixture.tool.execute('call-1', args);
  return {
    text: outcome.content[0]?.text ?? '',
    details: outcome.details,
    isError: outcome.isError,
  };
}

describe('schema and permissions', () => {
  it('exposes exactly the five model operations and no update/reopen', () => {
    const { tool } = fixture();
    const schema = tool.parameters as { properties: { op: { enum: string[] } }; required: string[] };
    expect(schema.properties.op.enum).toEqual(['list', 'get', 'add', 'close', 'edit']);
    expect(schema.required).toEqual(['op']);
  });

  it('lets developer read but not write, and keeps close away from designer', async () => {
    const f = fixture();
    f.setRole('developer');
    expect((await run(f, { op: 'list' })).isError).toBe(false);
    const add = await run(f, { op: 'add', title: '不该被创建' });
    expect(add.isError).toBe(true);
    expect(add.details['code']).toBe('FORBIDDEN');

    f.setRole('designer');
    const close = await run(f, { op: 'close', id: 'B-1', state: 'done', note: '完成' });
    expect(close.details['code']).toBe('FORBIDDEN');
    const edit = await run(f, { op: 'edit', oldText: '### B-2 导出报表', newText: '### B-2 导出报表（改）' });
    expect(edit.isError).toBe(false);
  });

  it('gives settler add, close and edit', async () => {
    const f = fixture();
    f.setRole('settler');
    const add = await run(f, { op: 'add', title: '遗留问题' });
    expect(add.isError).toBe(false);
    const close = await run(f, { op: 'close', id: 'B-1', state: 'done', note: '完成' });
    expect(close.isError).toBe(false);
  });

  it('refuses the tool for read-only specialist roles', async () => {
    const f = fixture();
    for (const roleId of ['reviewer', 'tester', 'investigator']) {
      f.setRole(roleId);
      const result = await run(f, { op: 'list' });
      expect(result.details['code']).toBe('FORBIDDEN');
    }
  });
});

describe('operations', () => {
  it('adds an entry with the recorded source, actor and time', async () => {
    const f = fixture();
    const result = await run(f, { op: 'add', title: '新工作', body: '两句说明。' });
    expect(result.isError).toBe(false);
    const item = result.details['item'] as Record<string, unknown>;
    expect(item['id']).toBe('B-4');
    expect(item['state']).toBe('open');
    expect(item['createdBy']).toBe('local');
    expect(item['source']).toBe('chief s-1 / i-9');
    expect(result.text).toContain('已记为 B-4');
    expect(result.text).toContain('"id":"B-4"');
  });

  it('lists open entries by default, with ready and closed filtering', async () => {
    const f = fixture();
    const open = await run(f, { op: 'list' });
    const openItems = open.details['items'] as Array<Record<string, unknown>>;
    expect(openItems.map((item) => item['id'])).toEqual(['B-1', 'B-2']);
    expect(openItems[0]?.['ready']).toBe(true);
    expect(openItems[1]?.['ready']).toBe(false);

    const all = await run(f, { op: 'list', state: 'all' });
    expect((all.details['items'] as unknown[]).length).toBe(3);

    const filtered = await run(f, { op: 'list', query: '账号', state: 'all' });
    expect((filtered.details['items'] as Array<Record<string, unknown>>).map((item) => item['id'])).toEqual([
      'B-1',
    ]);
  });

  it('reports a missing id and a problem entry differently', async () => {
    const f = fixture();
    const missing = await run(f, { op: 'get', id: 'B-99' });
    expect(missing.details['code']).toBe('NOT_FOUND');

    writeFileSync(
      f.path,
      ['# 待办', '', '## 未完成', '', '### B-1 没状态', '- 创建: 2026-11-01T09:00:00Z', ''].join('\n'),
      'utf8',
    );
    const broken = await run(f, { op: 'get', id: 'B-1' });
    expect(broken.isError).toBe(false);
    const problems = broken.details['problems'] as Array<{ reason: string }>;
    expect(problems.map((problem) => problem.reason)).toContain('缺少状态');

    writeFileSync(
      f.path,
      ['# 待办', '', '## 未完成', '', '## B-9 级别不对', '- 状态: open', ''].join('\n'),
      'utf8',
    );
    const unreadable = await run(f, { op: 'get', id: 'B-9' });
    expect(unreadable.details['code']).toBe('BACKLOG_PROBLEM');
  });

  it('closes with the current Task when the settler gives none', async () => {
    const f = fixture();
    f.setRole('settler');
    f.setCurrentTask('t-abcdef123456');
    const result = await run(f, { op: 'close', id: 'B-2', state: 'dropped', note: '不做了' });
    expect(result.isError).toBe(false);
    const item = result.details['item'] as Record<string, unknown>;
    expect(item['state']).toBe('dropped');
    expect(item['note']).toBe('不做了');
    expect(item['taskIds']).toEqual(['t-abcdef123456']);
  });

  it('requires a note to close and reports the edit failure without touching the file', async () => {
    const f = fixture();
    const before = readFileSync(f.path, 'utf8');
    const noNote = await run(f, { op: 'close', id: 'B-1', state: 'done' });
    expect(noNote.details['code']).toBe('INVALID_ARGUMENT');

    const badEdit = await run(f, { op: 'edit', oldText: '不存在', newText: 'x' });
    expect(badEdit.details['code']).toBe('INVALID_ARGUMENT');
    expect(badEdit.text).toContain('不存在');
    expect(readFileSync(f.path, 'utf8')).toBe(before);
  });

  it('returns the re-parsed file after an edit', async () => {
    const f = fixture();
    const result = await run(f, {
      op: 'edit',
      oldText: '### B-2 导出报表',
      newText: '### B-13 导出报表',
    });
    expect(result.isError).toBe(false);
    expect((result.details['items'] as Array<Record<string, unknown>>).map((item) => item['id'])).toContain(
      'B-13',
    );
    expect(readBacklog(f.cwd).items.map((item) => item.id)).toContain('B-13');
  });

  it('exposes associated Tasks when the context provides them', async () => {
    const f = fixture();
    const context = {
      cwd: f.cwd,
      roleId: 'chief',
      actorId: 'local',
      tasksOf: (id: string) =>
        id === 'B-1'
          ? { open: [{ taskId: 't-1', status: 'active' }], lastClosed: { taskId: 't-0', status: 'cancelled' } }
          : { open: [] },
    };
    const tool = createBacklogTool(() => context);
    const outcome = await tool.execute('call-2', { op: 'get', id: 'B-1' });
    const details = outcome.details as {
      openTasks: Array<{ taskId: string; status: string }>;
      lastClosedTask?: { taskId: string; status: string };
    };
    expect(details.openTasks).toEqual([{ taskId: 't-1', status: 'active' }]);
    expect(details.lastClosedTask).toEqual({ taskId: 't-0', status: 'cancelled' });
  });
});


describe('slice producer', () => {
  it('records the current design Task when a designer adds a slice', async () => {
    const f = fixture();
    f.setRole('designer');
    f.setCurrentTask('t-design');
    const added = await run(f, { op: 'add', title: '切片', specRefs: ['spec.md#x'] });
    expect(added.isError).toBe(false);
    expect(readFileSync(f.path, 'utf8')).toContain('- Task: t-design');
  });

  it('does not attach a chief idea to the current Task', async () => {
    const f = fixture();
    f.setCurrentTask('t-chief');
    const added = await run(f, { op: 'add', title: '以后再做' });
    expect(added.isError).toBe(false);
    expect(readFileSync(f.path, 'utf8')).not.toContain('- Task: t-chief');
  });
});
