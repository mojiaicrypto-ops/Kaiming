/**
 * Browser acceptance (P4-i): the real workbench, a real Chromium and a real model endpoint.
 *
 * These are the product's own acceptance steps (docs/productnew/acceptance.md) driven through the
 * browser: they prove what unit tests cannot - that the page really talks to the server, renders what
 * the server holds, answers questions and keeps working when the reader leaves.
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { STORAGE_KEYS, loginThroughUi, startHarness } from './harness.ts';

test.describe.configure({ mode: 'serial' });

test('a project opens into its real state and the eight views render', async ({ page }) => {
  const harness = await startHarness();
  try {
    await page.goto(harness.url);
    await loginThroughUi(page, harness.accessPassword);
    expect(harness.project).not.toBeNull();

    // Open the project the server already knows (the switcher asks for the real path).
    await page.locator('#projectSwitcher').click();
    await page.locator('#projectPathInput').fill(harness.project?.projectPath ?? '');
    await page.locator('#appDialog .dialog-actions button.primary').click();

    await expect(page.locator('#projectName')).not.toHaveText('');
    await expect(page.locator('#projectBranch')).toContainText(harness.project?.projectPath ?? '');
    await expect(page.locator('.nav-item[data-view]')).toHaveCount(8);

    for (const view of ['requirements', 'runs', 'inbox', 'files', 'docs', 'agents', 'settings']) {
      await page.locator(`.nav-item[data-view="${view}"]`).click();
      await expect(page.locator(`#${view}View`)).toBeVisible();
    }
    await page.screenshot({ path: test.info().outputPath('views.png'), fullPage: true });
  } finally {
    await harness.close();
  }
});

test('a submitted input reaches the transcript and the run answers', async ({ page }) => {
  const harness = await startHarness({ model: [{ kind: 'text', text: '好的，我们先讨论。' }] });
  try {
    await page.goto(harness.url);
    await loginThroughUi(page, harness.accessPassword);
    await openProject(page, harness.project?.projectPath ?? '');

    const composer = page.locator('#messageInput');
    await composer.fill('先讨论，不开始开发');
    await composer.press('Enter');

    await expect(page.locator('#projectMessages .message.user')).toHaveCount(1, { timeout: 15_000 });
    // The assistant answer arrives through the live stream, not from a re-read.
    await expect(page.locator('#projectMessages .message.assistant .markdown-body').last()).toContainText('我们先讨论', {
      timeout: 20_000,
    });
    await page.screenshot({ path: test.info().outputPath('conversation.png') });
  } finally {
    await harness.close();
  }
});

test('a question is answered in the browser and the model continues', async ({ page }) => {
  const harness = await startHarness({
    model: [
      {
        kind: 'tool_calls',
        calls: [
          {
            name: 'question',
            arguments: JSON.stringify({
              method: 'select',
              title: '是否将讨论内容加入需求列表？',
              options: ['加入', '暂不加入'],
            }),
          },
        ],
      },
      { kind: 'text', text: '好的，已按你的选择继续。' },
    ],
  });
  try {
    await page.goto(harness.url);
    await loginThroughUi(page, harness.accessPassword);
    await openProject(page, harness.project?.projectPath ?? '');

    const composer = page.locator('#messageInput');
    await composer.fill('整理一下需求');
    await composer.press('Enter');

    const card = page.locator('.interaction-card').first();
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card).toContainText('是否将讨论内容加入需求列表');
    await card.getByRole('button', { name: '加入', exact: true }).click();

    await expect(page.locator('.interaction-card')).toHaveCount(0, { timeout: 15_000 });
    await expect(page.locator('#projectMessages .message.assistant .markdown-body').last()).toContainText(
      '已按你的选择继续',
      { timeout: 20_000 },
    );
    await page.screenshot({ path: test.info().outputPath('answered.png') });
  } finally {
    await harness.close();
  }
});

test('the reader may leave: the work keeps running and the page can come back', async ({ page }) => {
  const harness = await startHarness({ model: [{ kind: 'text', text: '长一点的回答。' }] });
  try {
    await page.goto(harness.url);
    await loginThroughUi(page, harness.accessPassword);
    await openProject(page, harness.project?.projectPath ?? '');

    const composer = page.locator('#messageInput');
    await composer.fill('开始吧');
    await composer.press('Enter');
    await expect(page.locator('#projectMessages .message.user')).toHaveCount(1, { timeout: 15_000 });

    // Leave the page entirely and come back: the conversation is re-read from the server, not from
    // anything the first page kept (M4: a disconnect destroys the buffer, never the work).
    await page.goto('about:blank');
    await page.goto(harness.url);
    await expect(page.locator('#messages .message, #projectMessages .message')).not.toHaveCount(0, { timeout: 20_000 });
    await page.screenshot({ path: test.info().outputPath('returned.png') });
  } finally {
    await harness.close();
  }
});

/** Open the seeded project through the switcher dialog (the first thing a user does). */
async function openProject(page: Page, projectPath: string): Promise<void> {
  await page.locator('#projectSwitcher').click();
  await page.locator('#projectPathInput').fill(projectPath);
  await page.locator('#appDialog .dialog-actions button.primary').click();
  await expect(page.locator('#projectName')).not.toHaveText('');
}
