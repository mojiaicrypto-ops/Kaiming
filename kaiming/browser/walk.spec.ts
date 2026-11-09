import { test, type Page } from '@playwright/test';
import { loginThroughUi, startHarness, waitForConnected } from './harness.ts';

test('walk', async ({ page }) => {
  const harness = await startHarness({
    model: [
      {
        kind: 'tool_calls',
        calls: [
          {
            name: 'question',
            arguments: JSON.stringify({
              method: 'select',
              title: '入口放在哪里？',
              options: ['客服后台', '用户账号页', '先不做'],
            }),
          },
        ],
      },
      { kind: 'text', text: '好的，已按你的选择继续。' },
    ],
  });
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(harness.url);
    await loginThroughUi(page, harness.accessPassword);
    await page.locator('[data-testid="project-switcher"]').click();
    await page.locator('[data-testid="project-path"]').fill(harness.project?.projectPath ?? '');
    await page.locator('[data-testid="project-path"]').press('Enter');
    await waitForConnected(page);
    await page.screenshot({ path: '/tmp/wk-chat-empty.png' });
    const composer = page.locator('[data-testid="composer"]');
    await composer.fill('整理一下需求');
    await composer.press('Enter');
    const panel = page.locator('[data-testid="question-panel"]');
    await expect_visible(panel, page);
    await page.screenshot({ path: '/tmp/wk-chat-ask.png' });
    await page.locator('.nav a[href="/project"]').click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: '/tmp/wk-project.png', fullPage: true });
    await page.locator('.nav a[href="/settings/providers"]').click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: '/tmp/wk-settings.png' });
  } finally {
    await harness.close();
  }
});

async function expect_visible(loc: import('@playwright/test').Locator, page: Page): Promise<void> {
  await loc.waitFor({ state: 'visible', timeout: 20_000 });
}
