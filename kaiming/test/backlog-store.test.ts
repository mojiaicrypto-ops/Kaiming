import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BacklogConflictError,
  BacklogProblemError,
  addItem,
  backlogPath,
  closeItem,
  editRaw,
  parseBacklog,
  readBacklog,
  reopenItem,
  updateItem,
} from '../src/runtime/backlog-store.ts';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function fixtureText(name: string): string {
  return readFileSync(new URL(`../test-fixtures/backlog/${name}`, import.meta.url), 'utf8');
}

/** A project whose `.dev/backlog.md` is a copy of the named fixture. */
function projectWith(name?: string): { cwd: string; path: string } {
  const root = mkdtempSync(join(tmpdir(), 'kaiming-backlog-'));
  dirs.push(root);
  const cwd = join(root, 'project');
  mkdirSync(join(cwd, '.dev'), { recursive: true });
  const path = backlogPath(cwd);
  if (name !== undefined) {
    writeFileSync(path, fixtureText(name), 'utf8');
  }
  return { cwd, path };
}

function readBacklogFrom(text: string) {
  return parseBacklog(text);
}



describe('parsing', () => {
  it('reads entries, states, multi-value specs and notes', () => {
    const read = readBacklogFrom(fixtureText('normal.md'));
    expect(read.issues).toEqual([]);
    expect(read.items.map((item) => item.id)).toEqual(['B-2', 'B-1', 'B-3']);
    const refund = read.items[0];
    expect(refund?.state).toBe('open');
    expect(refund?.specRefs).toEqual([
      '.dev/product/refund.md#部分退款',
      '.dev/technical/payment.md',
    ]);
    const closed = read.items[2];
    expect(closed?.state).toBe('done');
    expect(closed?.note).toContain('交付');
    expect(closed?.taskIds).toEqual(['t-12ab34cd56ef']);
  });

  it('classifies missing state, bad ids, wrong heading levels and duplicated state as problems', () => {
    const read = readBacklogFrom(fixtureText('broken.md'));
    const reasons = read.issues.map((issue) => issue.reason).sort();
    expect(reasons).toEqual(
      [
        '无法识别编号：导出',
        '标题级别应为 ###',
        '缺少状态',
        '状态写入了两次',
      ].sort(),
    );
    expect(read.issues.find((issue) => issue.reason === '缺少状态')?.line).toBe(5);
    expect(read.issues.find((issue) => issue.reason === '标题级别应为 ###')?.line).toBe(11);
    expect(read.items.map((item) => item.id)).toEqual(['B-4', 'B-6', 'B-7']);
  });

  it('reports every occurrence of a duplicate id', () => {
    const read = readBacklogFrom(fixtureText('duplicate.md'));
    expect(read.items).toHaveLength(2);
    const duplicate = read.issues.filter((issue) => issue.reason === '编号重复：B-5');
    expect(duplicate).toHaveLength(2);
    expect(duplicate.map((issue) => issue.line)).toEqual([5, 8]);
  });

  it('reports one file-level problem when nothing reads as an entry', () => {
    const read = readBacklogFrom(fixtureText('table.md'));
    expect(read.items).toEqual([]);
    expect(read.issues).toHaveLength(1);
    expect(read.issues[0]?.line).toBe(0);
    expect(read.issues[0]?.reason).toContain('未识别出任何条目');
  });

  it('warns about a closed entry without a note and about a malformed time', () => {
    const noNote = readBacklogFrom(fixtureText('closed-no-note.md'));
    expect(noNote.issues).toEqual([]);
    expect(noNote.warnings.map((warning) => warning.reason)).toEqual(['关闭了却没有写说明']);

    const times = readBacklogFrom(fixtureText('times.md'));
    expect(times.items).toHaveLength(1);
    expect(times.warnings.some((warning) => warning.reason.startsWith('创建 时间不是 RFC3339'))).toBe(true);
  });

  it('accumulates multi-value keys in order and does not split commas', () => {
    const read = readBacklogFrom(fixtureText('multi-spec.md'));
    expect(read.items[0]?.specRefs).toEqual([
      '.dev/product/a.md',
      '.dev/product/b.md, .dev/product/c.md',
      '.dev/technical/d.md',
    ]);
  });

  it('accepts English keys and keeps the 外部 key verbatim', () => {
    const english = readBacklogFrom(fixtureText('english.md')).items[0];
    expect(english?.state).toBe('open');
    expect(english?.createdBy).toBe('local');

    const external = readBacklogFrom(fixtureText('external.md')).items[0];
    expect(external?.external).toBe('feishu:abc123 https://example.com/t/abc123');
  });

  it('keeps an unknown key in place instead of turning the entry into a problem', () => {
    const text = [
      '# 待办',
      '',
      '## 未完成',
      '',
      '### B-1 未知键在前',
      '- 优先级: 高',
      '- 状态: open',
      '',
      '正文。',
      '',
    ].join('\n');
    const read = readBacklogFrom(text);
    expect(read.issues).toEqual([]);
    expect(read.items[0]?.state).toBe('open');
    expect(read.items[0]?.body).toContain('正文。');
    expect(read.items[0]?.digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('warns when a 规格 reference does not resolve', () => {
    const { cwd, path } = projectWith('normal.md');
    const read = readBacklog(cwd);
    expect(read.warnings.some((warning) => warning.reason.startsWith('规格引用不存在'))).toBe(true);
    expect(readFileSync(path, 'utf8')).toBe(fixtureText('normal.md'));
  });
});

describe('entry-level writes', () => {
  it('adds the first entry to an empty project, then inserts at the top of 未完成', async () => {
    const { cwd, path } = projectWith();
    const first = await addItem(cwd, {
      title: '导出 CSV',
      body: '一两句话。',
      source: 'chief s-1 / i-1',
      actorId: 'local',
    });
    expect(first.id).toBe('B-1');
    expect(first.state).toBe('open');
    const text = readFileSync(path, 'utf8');
    expect(text).toContain('# 待办');
    expect(text).toContain('## 未完成');
    expect(text).toContain('- 状态: open');
    expect(text).toContain('- 创建人: local');

    const second = await addItem(cwd, {
      title: '第二条',
      specRefs: ['.dev/product/none.md'],
      source: '界面',
      actorId: 'local',
    });
    expect(second.id).toBe('B-2');
    const items = readBacklog(cwd).items;
    expect(items.map((item) => item.id)).toEqual(['B-2', 'B-1']);
  });

  it('allocates the next id from closed and readable-broken entries', async () => {
    const text = [
      '# 待办',
      '',
      '## 未完成',
      '',
      '### B-12 损坏但编号可读',
      '- 创建: 2026-11-01T09:00:00Z',
      '',
      '## 已关闭',
      '',
      '### B-9 已关闭',
      '- 状态: done',
      '- 说明: 完成',
      '',
    ].join('\n');
    const { cwd } = projectWith();
    writeFileSync(backlogPath(cwd), text, 'utf8');
    const added = await addItem(cwd, { title: '新条目', source: '界面', actorId: 'local' });
    expect(added.id).toBe('B-13');
  });

  it('rewrites only the touched entry and leaves other lines byte-identical', async () => {
    const { cwd, path } = projectWith('normal.md');
    const before = readFileSync(path, 'utf8').split('\n');
    const target = readBacklog(cwd).items.find((item) => item.id === 'B-2');
    expect(target).toBeDefined();
    await updateItem(cwd, 'B-2', target?.digest ?? '', { title: '部分退款（已评审）' }, 'local');
    const after = readFileSync(path, 'utf8').split('\n');

    const start = before.findIndex((line) => line === '### B-2 部分退款');
    const end = before.findIndex((line, index) => index > start && line.startsWith('### '));
    expect(after[start]).toBe('### B-2 部分退款（已评审）');
    // Every line outside the touched block is unchanged, in the same order.
    const outsideBefore = [...before.slice(0, start), ...before.slice(end)].filter((line) => line !== '');
    const outsideAfter = [...after.slice(0, start), ...after.slice(end)].filter((line) => line !== '');
    expect(outsideAfter).toEqual(outsideBefore);
  });

  it('keeps the metadata order of the rewritten entry (no serializer reordering)', async () => {
    const { cwd, path } = projectWith('normal.md');
    const target = readBacklog(cwd).items.find((item) => item.id === 'B-2');
    expect(target).toBeDefined();
    await updateItem(
      cwd,
      'B-2',
      target?.digest ?? '',
      {
        title: target?.title ?? '',
        body: target?.body ?? '',
        specRefs: target?.specRefs ?? [],
      },
      'local',
    );
    const lines = readFileSync(path, 'utf8').split('\n');
    const start = lines.findIndex((line) => line.startsWith('### B-2 '));
    const end = lines.findIndex((line, index) => index > start && line.startsWith('### '));
    const keys = lines
      .slice(start + 1, end)
      .filter((line) => line.startsWith('- '))
      .map((line) => line.slice(2).split(':')[0]);
    expect(keys).toEqual(['状态', '规格', '规格', '来源', '创建人', '创建', '更新']);
  });

  it('refuses a stale digest and returns the current entry', async () => {
    const { cwd, path } = projectWith('normal.md');
    const before = readFileSync(path, 'utf8');
    await expect(updateItem(cwd, 'B-1', 'stale', { title: '改坏' }, 'local')).rejects.toBeInstanceOf(
      BacklogConflictError,
    );
    expect(readFileSync(path, 'utf8')).toBe(before);
  });

  it('lets two writers update different entries at the same time', async () => {
    const { cwd } = projectWith('normal.md');
    const items = readBacklog(cwd).items;
    const first = items.find((item) => item.id === 'B-1');
    const second = items.find((item) => item.id === 'B-2');
    await Promise.all([
      updateItem(cwd, 'B-1', first?.digest ?? '', { title: 'B-1 改名' }, 'local'),
      updateItem(cwd, 'B-2', second?.digest ?? '', { title: 'B-2 改名' }, 'local'),
    ]);
    const titles = readBacklog(cwd).items.map((item) => `${item.id} ${item.title}`);
    expect(titles).toContain('B-1 B-1 改名');
    expect(titles).toContain('B-2 B-2 改名');
  });

  it('closes an entry: required note, moved into 已关闭 with the real actor and time', async () => {
    const { cwd, path } = projectWith('normal.md');
    await expect(
      closeItem(cwd, 'B-1', undefined, { state: 'done', note: '   ' }, 'local'),
    ).rejects.toThrow(/说明/);
    const closed = await closeItem(
      cwd,
      'B-1',
      undefined,
      { state: 'done', note: '已完成', taskIds: ['t-abc'] },
      'local',
    );
    expect(closed.state).toBe('done');
    expect(closed.note).toBe('已完成');
    expect(closed.closedBy).toBe('local');
    expect(closed.taskIds).toEqual(['t-abc']);
    expect(closed.closedAt).toBeDefined();
    const text = readFileSync(path, 'utf8');
    expect(text.indexOf('### B-1 导出 CSV')).toBeGreaterThan(text.indexOf('## 已关闭'));
  });

  it('refuses to close a broken entry and leaves the file untouched', async () => {
    const { cwd, path } = projectWith('broken.md');
    const before = readFileSync(path, 'utf8');
    await expect(
      closeItem(cwd, 'B-4', undefined, { state: 'dropped', note: '不做了' }, 'local'),
    ).rejects.toBeInstanceOf(BacklogProblemError);
    expect(readFileSync(path, 'utf8')).toBe(before);
  });

  it('reopens a closed entry with a reason and moves it back to 未完成', async () => {
    const { cwd, path } = projectWith('normal.md');
    const closed = readBacklog(cwd).items.find((item) => item.id === 'B-3');
    const reopened = await reopenItem(cwd, 'B-3', closed?.digest ?? '', '又出现了', 'local');
    expect(reopened.state).toBe('open');
    expect(reopened.note).toBe('重开：又出现了');
    const text = readFileSync(path, 'utf8');
    expect(text.indexOf('### B-3 登录页错别字')).toBeLessThan(text.indexOf('## 已关闭'));
  });

  it('fixes a duplicate id through editRaw and clears the problem', async () => {
    const { cwd } = projectWith('duplicate.md');
    expect(readBacklog(cwd).issues).toHaveLength(2);
    const after = await editRaw(cwd, '### B-5 第二条 B-5', '### B-13 第二条 B-5');
    expect(after.issues).toEqual([]);
    expect(after.items.map((item) => item.id).sort()).toEqual(['B-13', 'B-5']);
  });

  it('refuses editRaw when the old text is absent or not unique', async () => {
    const { cwd, path } = projectWith('normal.md');
    const before = readFileSync(path, 'utf8');
    await expect(editRaw(cwd, '不存在的原文', '新文本')).rejects.toThrow(/不存在/);
    await expect(editRaw(cwd, '- 状态: open', '清单')).rejects.toThrow(/出现了/);
    expect(readFileSync(path, 'utf8')).toBe(before);
  });

  it('does not rewrite the file when the replacement text equals the old text', async () => {
    const { cwd, path } = projectWith('normal.md');
    const before = readFileSync(path, 'utf8');
    await editRaw(cwd, '### B-1 导出 CSV', '### B-1 导出 CSV');
    expect(readFileSync(path, 'utf8')).toBe(before);
  });

  it('leaves the file and no temporary file behind when the write cannot happen', async () => {
    const { cwd, path } = projectWith('normal.md');
    const before = readFileSync(path, 'utf8');
    const dir = join(cwd, '.dev');
    chmodSync(dir, 0o500);
    try {
      await expect(
        addItem(cwd, { title: '写不进去', source: '界面', actorId: 'local' }),
      ).rejects.toThrow();
    } finally {
      chmodSync(dir, 0o700);
    }
    expect(readFileSync(path, 'utf8')).toBe(before);
    expect(readdirSync(dir).filter((name) => name.includes('.tmp-'))).toEqual([]);
  });

  it('shows the problem immediately when an edit breaks an entry', async () => {
    const { cwd } = projectWith('normal.md');
    const after = await editRaw(cwd, '### B-1 导出 CSV\n- 状态: open', '### B-1 导出 CSV\n- 状态: nope');
    expect(after.issues.some((issue) => issue.id === 'B-1')).toBe(true);
    expect(after.items.find((item) => item.id === 'B-1')?.state).toBe('open');
  });
});
