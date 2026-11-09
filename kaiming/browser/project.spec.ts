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

  // Legacy records are offered as an entry, not parsed: the requirements folder is a directory.
  mkdirSync(join(projectPath, '.dev', 'requirements'), { recursive: true });
  writeFileSync(join(projectPath, '.dev', 'issues.md'), '# 遗留问题\n', 'utf8');

  await openProject(page, harness);
  await page.getByRole('link', { name: 'Project' }).click();
  await expect(page.locator('[data-testid="project-page"]')).toBeVisible();

  // The existing entry and the module block are projections of the files, not of a second store.
  await expect(page.locator('[data-testid="backlog-row"]').filter({ hasText: '已有的条目' })).toBeVisible();
  await expect(page.locator('[data-testid="project-modules"]')).toContainText('server/account/');
  await expect(page.locator('[data-testid="project-early"]')).toContainText('.dev/requirements/');

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

  // The old requirements address is rewritten, not just parsed: no dead bookmark left behind.
  await page.goto(`${harness.url}requirements`);
  await expect(page.locator('[data-testid="project-page"]')).toBeVisible();
  await expect.poll(() => new URL(page.url()).pathname).toBe('/project');
});

test('a broken backlog line and a module cell open the file they name', async ({ page }) => {
  const harness = await startHarness();
  const projectPath = harness.project?.projectPath ?? '';
  mkdirSync(join(projectPath, '.dev'), { recursive: true });
  writeFileSync(
    join(projectPath, '.dev', 'backlog.md'),
    ['# 待办', '', '## 未完成', '', '### B-1 正常条目', '- 状态: open', '', '### 坏编号', ''].join('\n'),
    'utf8',
  );
  writeFileSync(
    join(projectPath, '.dev', 'PROJECT.md'),
    [
      '# 项目',
      '',
      '## 模块',
      '',
      '| 模块 | 职责 | 代码位置 |',
      '|---|---|---|',
      '| 账号 | 登录 | `server/account/login.ts` |',
      '',
    ].join('\n'),
    'utf8',
  );
  mkdirSync(join(projectPath, 'server', 'account'), { recursive: true });
  writeFileSync(join(projectPath, 'server', 'account', 'login.ts'), 'export const login = 1;\n', 'utf8');

  await openProject(page, harness);
  await page.getByRole('link', { name: 'Project' }).click();

  // A line the file cannot mean is reported with its number, and opening it lands in source view
  // at that line: the rendered Markdown has no stable positions, so the exact line wins.
  await expect(page.locator('[data-testid="project-issue"]')).toContainText('8');
  await page.locator('[data-testid="project-issue"]').first().click();
  await expect(page.locator('[data-testid="file-path"]')).toHaveText('.dev/backlog.md');
  await expect(page.locator('[data-testid="file-search"]')).toBeVisible();
  await page.locator('[data-testid="file-close"]').click();

  // A code position in the module table opens that file instead of being inert text.
  await page.locator('[data-testid="project-module-link"]').last().click();
  await expect(page.locator('[data-testid="file-path"]')).toHaveText('server/account/login.ts');
  await expect(page.locator('[data-testid="file-text"]')).toContainText('export const login');
  await page.locator('[data-testid="file-close"]').click();
});

test('a session an external agent owns is marked in the rail', async ({ page }) => {
  const harness = await startHarness();
  const projectPath = harness.project?.projectPath ?? '';

  // The MCP client's own call before the browser attaches: the public RPC, same channel the
  // external attach uses. Doing it first means the rail reads it as part of its initial list.
  const origin = harness.url.replace(/\/$/, '');
  const rpc = async (method: string, params: Record<string, unknown>, cookie = '', csrf = ''): Promise<Record<string, unknown>> => {
    const response = await fetch(`${origin}/api/v1/rpc`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(cookie === '' ? {} : { cookie }),
        ...(csrf === '' ? {} : { 'x-kaiming-csrf': csrf }),
      },
      body: JSON.stringify({ requestId: `seed-${method}`, method, params }),
    });
    const body = (await response.json()) as { result?: Record<string, unknown>; error?: { message?: string } };
    if (body.error !== undefined) throw new Error(body.error.message ?? 'rpc failed');
    return { ...body.result, ...(method === 'auth.login' ? { cookie: (response.headers.getSetCookie()[0] ?? '').split(';')[0] } : {}) };
  };
  const login = (await rpc('auth.login', { password: harness.accessPassword })) as { csrfToken: string; cookie: string };
  const projects = (await rpc('project.list', { limit: 10 }, login.cookie, login.csrfToken)) as { projects: Array<{ projectId: string }> };
  const projectId = projects.projects.find((row) => row.projectId !== '')?.projectId ?? '';
  const opened = (await rpc('session.open', { projectId, channel: 'mcp' }, login.cookie, login.csrfToken)) as { created: boolean };
  expect(opened.created).toBe(true);

  await openProject(page, harness);
  await page.getByRole('link', { name: 'Chat' }).click();
  await expect(page.locator('[data-testid="session-external"]')).toHaveText('MCP');
  expect(projectPath).not.toBe('');
});

test('a design Task appears in the designing lane and its slices cannot be implemented yet', async ({ page }) => {
  const harness = await startHarness({
    model: [
      {
        kind: 'tool_calls',
        calls: [
          {
            name: 'task',
            arguments: JSON.stringify({
              op: 'create',
              type: 'write',
              workKind: 'design',
              goal: 'design B-1',
              scope: 'account module',
              planMarkdown: '# design\n\n## 验收\n- slices confirmed\n',
              backlogIds: ['B-1'],
            }),
          },
        ],
      },
      { kind: 'text', text: '设计已开始。' },
    ],
  });
  try {
    const projectPath = harness.project?.projectPath ?? '';
    mkdirSync(join(projectPath, '.dev'), { recursive: true });
    writeFileSync(join(projectPath, '.dev', 'backlog.md'), BACKLOG, 'utf8');
    await page.goto(harness.url);
    await loginThroughUi(page, harness.accessPassword);
    await openProject(page, harness);
    await page.locator('[data-testid="composer"]').fill('先设计 B-1');
    await page.locator('[data-testid="composer"]').press('Enter');
    await expect(page.locator('[data-testid="task-strip"]')).toBeVisible({ timeout: 20_000 });

    await page.goto(`${harness.baseUrl}/project`, { waitUntil: 'domcontentloaded' });
    const lane = page.locator('[data-testid="board-designing"]');
    await expect(lane).toContainText('B-1', { timeout: 15_000 });
    await expect(lane).toContainText(/设计|Design/);
    await lane.locator('[data-testid="backlog-row"]').click();
    const implement = page.locator('[data-testid="backlog-implement"]');
    await expect(implement).toBeVisible();
    await expect(implement).toBeDisabled();
  } finally {
    await harness.close();
  }
});
