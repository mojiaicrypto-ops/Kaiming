import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { loginThroughUi, startHarness, type Harness } from './harness.ts';

/**
 * One focused path through the project page: the backlog is the file, a new item survives a reload,
 * the module block comes from PROJECT.md, and saving against a file someone else changed shows the
 * conflict instead of overwriting it.
 */

const BACKLOG = [
  '# 待办',
  '',
  '## 未完成',
  '',
  '### B-1 已有的条目',
  '- 状态: open',
  '',
].join('\n');

const PROJECT = [
  '# 项目',
  '',
  '## 模块',
  '',
  '| 模块 | 职责 | 代码位置 |',
  '|---|---|---|',
  '| 账号 | 登录与重置 | `server/account/` |',
  '',
].join('\n');

async function openProject(page: Parameters<typeof loginThroughUi>[0], harness: Harness): Promise<void> {
  await page.goto(harness.url);
  await Promise.race([
    page.locator('[data-testid="composer"]').waitFor({ timeout: 15_000 }),
    page.locator('[data-testid="password"]').waitFor({ timeout: 15_000 }),
  ]);
  await loginThroughUi(page, harness.accessPassword);
  await page.locator('[data-testid="project-switcher"]').click();
  await page.locator('[data-testid="project-path"]').fill(harness.project?.projectPath ?? '');
  await page.locator('[data-testid="project-path"]').press('Enter');
  await expect(page.locator('[data-testid="project-switcher"] b')).toHaveText(
    (harness.project?.projectPath ?? '').split('/').at(-1) ?? '',
  );
}

test('the project page shows the backlog, adds an item, reports a stale save and renders modules', async ({ page }) => {
  const harness = await startHarness();
  const projectPath = harness.project?.projectPath ?? '';
  mkdirSync(join(projectPath, '.dev'), { recursive: true });
  writeFileSync(join(projectPath, '.dev', 'backlog.md'), BACKLOG, 'utf8');
  writeFileSync(join(projectPath, '.dev', 'PROJECT.md'), PROJECT, 'utf8');

  await openProject(page, harness);
  await page.getByRole('link', { name: 'Project' }).click();
  await expect(page.locator('[data-testid="project-page"]')).toBeVisible();

  // The existing entry and the module block are projections of the files, not of a second store.
  await expect(page.locator('[data-testid="backlog-row"]').filter({ hasText: '已有的条目' })).toBeVisible();
  await expect(page.locator('[data-testid="project-modules"]')).toContainText('server/account/');

  // Adding an item writes the file; a reload reads it back.
  await page.locator('[data-testid="backlog-add"]').fill('浏览器新增');
  await page.locator('[data-testid="backlog-add"]').press('Enter');
  await expect(page.locator('[data-testid="backlog-row"]').filter({ hasText: '浏览器新增' })).toBeVisible();
  await page.reload();
  await expect(page.locator('[data-testid="project-page"]')).toBeVisible();
  await expect(page.locator('[data-testid="backlog-row"]').filter({ hasText: '浏览器新增' })).toBeVisible();

  // A second writer changes the item behind the page; the drawer's save must not overwrite it.
  await page.locator('[data-testid="backlog-row"]').filter({ hasText: '浏览器新增' }).click();
  const drawer = page.locator('[data-testid="backlog-title"]');
  await expect(drawer).toBeVisible();
  await drawer.fill('我的草稿');
  const path = join(projectPath, '.dev', 'backlog.md');
  writeFileSync(path, readFileSync(path, 'utf8').replace('浏览器新增', '别人改过的标题'), 'utf8');
  await page.locator('[data-testid="backlog-save"]').click();
  await expect(page.locator('[data-testid="backlog-conflict"]')).toBeVisible();
  await expect(drawer).toHaveValue('我的草稿');
  await expect.poll(() => readFileSync(path, 'utf8')).toContain('别人改过的标题');
});
