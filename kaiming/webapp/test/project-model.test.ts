import { describe, expect, it } from 'vitest';
import { RpcError } from '../src/api/rpc';
import {
  groupsOf,
  boardOf,
  flowChain,
  awaitingDesign,
  isVersionConflict,
  cellPath,
  moduleTable,
  projectNameFrom,
  parseSpecRefs,
  type BacklogItemView,
} from '../src/project/project-model';

function item(overrides: Partial<BacklogItemView> & { id: string }): BacklogItemView {
  return {
    id: overrides.id,
    title: overrides.title ?? overrides.id,
    state: overrides.state ?? 'open',
    ready: overrides.ready ?? false,
    specRefs: overrides.specRefs ?? [],
    line: overrides.line ?? 1,
    body: overrides.body ?? '',
    digest: overrides.digest ?? 'd',
    openTasks: overrides.openTasks ?? [],
    ...(overrides.producerTasks === undefined ? {} : { producerTasks: overrides.producerTasks }),
    ...(overrides.relatedTasks === undefined ? {} : { relatedTasks: overrides.relatedTasks }),
    ...(overrides.splitInto === undefined ? {} : { splitInto: overrides.splitInto }),
    problems: overrides.problems ?? [],
    warnings: overrides.warnings ?? [],
  };
}

describe('backlog grouping', () => {
  it('puts open items with a spec reference first and keeps closed ones aside', () => {
    const groups = groupsOf([
      item({ id: 'B-1', ready: true, specRefs: ['a.md'] }),
      item({ id: 'B-2' }),
      item({ id: 'B-3', state: 'done' }),
      item({ id: 'B-4', state: 'dropped' }),
    ]);
    expect(groups.ready.map((entry) => entry.id)).toEqual(['B-1']);
    expect(groups.ideas.map((entry) => entry.id)).toEqual(['B-2']);
    expect(groups.closed.map((entry) => entry.id)).toEqual(['B-3', 'B-4']);
  });
});

describe('module section', () => {
  const markdown = [
    '# 项目',
    '',
    '## 模块',
    '',
    '| 模块 | 职责 | 代码位置 |',
    '|---|---|---|',
    '| 账号 | 登录与重置 | `server/account/` |',
    '| 交易 | 下单 | `server/trade/` |',
    '',
    '## 其他',
    '| 忽略 | 这一行不属于模块 |',
  ].join('\n');

  it('renders the module table with its own headings', () => {
    expect(moduleTable(markdown)).toEqual({
      headers: ['模块', '职责', '代码位置'],
      rows: [
        { cells: ['账号', '登录与重置', '`server/account/`'] },
        { cells: ['交易', '下单', '`server/trade/`'] },
      ],
    });
  });

  it('accepts the English heading and stops at the next section', () => {
    const english = markdown.replace('## 模块', '## Modules');
    expect(moduleTable(english)?.rows).toHaveLength(2);
  });

  it('returns null when the section or its table is absent', () => {
    expect(moduleTable(null)).toBeNull();
    expect(moduleTable('# 项目\n只有几段话。\n')).toBeNull();
    expect(moduleTable('## 模块\n\n没有表格。\n')).toBeNull();
  });

  it('opens only code-shaped cells as paths', () => {
    expect(cellPath('`server/account/`')).toBe('server/account/');
    expect(cellPath('webapp/src/app/App.tsx')).toBe('webapp/src/app/App.tsx');
    expect(cellPath('docs/technicalnew/ui-design.md')).toBe('docs/technicalnew/ui-design.md');
    expect(cellPath('账号')).toBeUndefined();
    expect(cellPath('登录与重置')).toBeUndefined();
    expect(cellPath('https://example.com/a.ts')).toBeUndefined();
    expect(cellPath('/etc/passwd')).toBeUndefined();
    expect(cellPath('server/account/ （负责登录)')).toBeUndefined();
  });
});

describe('project title', () => {
  it('uses the level-1 heading of PROJECT.md', () => {
    expect(projectNameFrom('# 记账服务\n\n## 模块\n', 'repo')).toBe('记账服务');
  });

  it('falls back for a missing or generic title', () => {
    expect(projectNameFrom(null, 'repo')).toBe('repo');
    expect(projectNameFrom('# 项目\n', 'repo')).toBe('repo');
    expect(projectNameFrom('# Project\n', 'repo')).toBe('repo');
    expect(projectNameFrom('## 模块\n', 'repo')).toBe('repo');
  });
});

describe('editing helpers', () => {
  it('treats only VERSION_CONFLICT as a merge prompt', () => {
    expect(isVersionConflict(new RpcError('VERSION_CONFLICT', 'changed'))).toBe(true);
    expect(isVersionConflict(new RpcError('INVALID_ARGUMENT', 'bad'))).toBe(false);
    expect(isVersionConflict(new Error('boom'))).toBe(false);
  });

  it('parses one spec reference per non-empty line', () => {
    expect(parseSpecRefs(' a.md \n\nb.md#标题\n')).toEqual(['a.md', 'b.md#标题']);
  });
});

describe('design board', () => {
  it('separates designing, ready, implementing and completed from derived task facts', () => {
    const board = boardOf([
      item({
        id: 'B-1',
        openTasks: [{ taskId: 't-d', status: 'active', workKind: 'design', phase: 'design' }],
      }),
      item({
        id: 'B-2',
        ready: true,
        specRefs: ['spec.md#x'],
        producerTasks: [{ taskId: 't-d', status: 'active', workKind: 'design', phase: 'design' }],
      }),
      item({
        id: 'B-3',
        openTasks: [{ taskId: 't-i', status: 'active', workKind: 'implement', phase: 'develop' }],
      }),
      item({ id: 'B-4', state: 'done' }),
    ]);
    expect(board.designing.map((card) => card.item.id)).toEqual(['B-1']);
    expect(board.ready.map((card) => card.item.id)).toEqual(['B-2']);
    expect(board.implementing.map((card) => card.item.id)).toEqual(['B-3']);
    expect(board.completed.map((entry) => entry.id)).toEqual(['B-4']);
  });

  it('marks a slice whose producing design Task is unfinished', () => {
    const slice = item({
      id: 'B-7',
      ready: true,
      specRefs: ['spec.md#x'],
      producerTasks: [{ taskId: 't-d', status: 'waiting', workKind: 'design', phase: 'review' }],
    });
    expect(awaitingDesign(slice)).toBe(true);
    expect(awaitingDesign({ ...slice, producerTasks: [{ taskId: 't-d', status: 'completed', workKind: 'design' }] })).toBe(false);
  });

  it('shows the design chain with its user-confirmation gate', () => {
    const design = item({
      id: 'B-1',
      openTasks: [{ taskId: 't-d', status: 'waiting', workKind: 'design', phase: 'review' }],
    });
    expect(flowChain(design, true).map((step) => step.key)).toEqual(['design', 'review', 'gate', 'settle']);
    expect(flowChain(design, true).find((step) => step.gate)?.state).toBe('current');
  });
});
