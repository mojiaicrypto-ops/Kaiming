import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Store, TaskRow } from '../src/store/store.ts';
import { designCompletionGaps } from '../src/runtime/design-completion.ts';
import { snapshotDesignDelivery } from '../src/runtime/deliverable.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function project(): string {
  const root = mkdtempSync(join(tmpdir(), 'kaiming-design-'));
  dirs.push(root);
  mkdirSync(join(root, '.dev/product'), { recursive: true });
  writeFileSync(join(root, '.dev/PROJECT.md'), '# Project\n\n## 模块\n', 'utf8');
  writeFileSync(join(root, '.dev/product/account.md'), '# 账号\n\n## 登录\n', 'utf8');
  writeFileSync(
    join(root, '.dev/backlog.md'),
    [
      '# 待办',
      '',
      '## 未完成',
      '',
      '### B-7 切片',
      '- 状态: open',
      '- 规格: .dev/product/account.md#登录',
      '- Task: t-design',
      '',
      '## 已关闭',
      '',
      '### B-1 原想法',
      '- 状态: done',
      '- 说明: 已拆分为 B-7',
      '- Task: t-design',
      '',
    ].join('\n'),
    'utf8',
  );
  return root;
}

function task(overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    id: 't-design',
    projectId: 'p-1',
    chiefSessionId: 'c-1',
    ownerEpoch: 1,
    requirementId: null,
    backlogIds: ['B-1'],
    type: 'write',
    workKind: 'design',
    flowVersion: 1,
    reworkCount: 0,
    requiresTest: false,
    goal: 'design',
    scope: 'x',
    acceptanceRefs: [],
    basisRefs: [],
    planRef: null,
    authorizationRefs: [],
    phase: 'settle',
    currentSessionIds: [],
    status: 'active',
    revision: 1,
    summary: '',
    nextStep: null,
    blockReason: null,
    completionResultId: null,
    sourceInputId: 'i-1',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function storeWith(review: { deliveryState: ReturnType<typeof snapshotDesignDelivery> }): Store {
  return {
    getProject: () => ({ initializationRef: null }),
    listTaskResults: () => [
      {
        resultId: 'r-review',
        kind: 'review',
        verdict: 'passed',
        deliveryState: review.deliveryState,
      },
    ],
  } as unknown as Store;
}

describe('design completion', () => {
  it('accepts a reviewed design whose original item is closed and whose slice has a spec', () => {
    const cwd = project();
    const review = { deliveryState: snapshotDesignDelivery(cwd) };
    expect(designCompletionGaps(storeWith(review), cwd, task())).toEqual([]);
  });

  it('rejects spec changes after review', () => {
    const cwd = project();
    const review = { deliveryState: snapshotDesignDelivery(cwd) };
    writeFileSync(join(cwd, '.dev/product/account.md'), '# 账号\n\n## 登录（改）\n', 'utf8');
    const gaps = designCompletionGaps(storeWith(review), cwd, task());
    expect(gaps.join(' ')).toContain('design artifacts changed');
  });


  it('rejects an original item that is still open', () => {
    const cwd = project();
    const review = { deliveryState: snapshotDesignDelivery(cwd) };
    const file = join(cwd, '.dev/backlog.md');
    writeFileSync(file, readFileSync(file, 'utf8').replace('### B-1 原想法\n- 状态: done', '### B-1 原想法\n- 状态: open'), 'utf8');
    expect(designCompletionGaps(storeWith(review), cwd, task()).join(' ')).toContain('original backlog item B-1 is open');
  });

  it('rejects a slice without a spec reference', () => {
    const cwd = project();
    writeFileSync(
      join(cwd, '.dev/backlog.md'),
      [
        '# 待办',
        '## 未完成',
        '### B-7 切片',
        '- 状态: open',
        '- Task: t-design',
        '## 已关闭',
        '### B-1 原想法',
        '- 状态: done',
        '- 说明: 已拆分',
        '- Task: t-design',
      ].join('\n'),
      'utf8',
    );
    const gaps = designCompletionGaps(storeWith({ deliveryState: snapshotDesignDelivery(cwd) }), cwd, task());
    expect(gaps.join(' ')).toContain('slice B-7 has no spec reference');
  });
});
