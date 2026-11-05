/**
 * The operation-feedback contract in a real browser: STOP and a retained message must react on
 * the click, not on the next poll. The harness runs the real workbench and a scripted streaming
 * model; only the stop RPC is delayed, because a stub abort otherwise settles too fast to observe.
 */
import { test, expect, type Page } from '@playwright/test';
import { loginThroughUi, startHarness, waitForConnected, type SeededProject } from './harness.ts';

async function pinStorage(page: Page, project: SeededProject): Promise<void> {
  await page.addInitScript((value: { projectPath: string; sessionId: string }) => {
    localStorage.setItem('kaiming.projectPath', value.projectPath);
    localStorage.setItem('kaiming.sessionId', value.sessionId);
    localStorage.setItem('kaiming.locale', 'en');
  }, { projectPath: project.projectPath, sessionId: project.sessionId });
}

test('a message sent during a run appears immediately in the queue with its text', async ({ page }) => {
  const harness = await startHarness({
    model: [
      { kind: 'slow_text', text: 'first answer '.repeat(240), chunks: 40, delayMs: 150 },
      { kind: 'text', text: 'second answer' },
    ],
  });
  try {
    const project = harness.project;
    if (project === null) throw new Error('the harness did not seed a project');
    await pinStorage(page, project);
    await page.goto(harness.baseUrl, { waitUntil: 'domcontentloaded' });
    await loginThroughUi(page, harness.accessPassword);
    await waitForConnected(page);

    const composer = page.locator('[data-testid="composer"]');
    await composer.fill('first running request');
    await composer.press('Enter');
    await expect(page.locator('[data-testid="stop"]')).toBeVisible({ timeout: 15_000 });

    await composer.fill('queued supplement with readable text');
    await composer.press('Enter');

    const queued = page.locator('[data-testid="queued-inputs"]');
    await expect(queued).toBeVisible({ timeout: 5_000 });
    await expect(queued).toContainText('queued supplement with readable text');
    await expect(queued).toContainText('Handed to the chief after the current step');
    // The internal input id is a record key, not the message: it must not be painted.
    await expect(queued).not.toContainText(/\bc-[a-z0-9-]+/);

    // A reload must rebuild the same row from the prepared snapshot, not lose the message.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await loginThroughUi(page, harness.accessPassword);
    await waitForConnected(page);
    await expect(queued).toContainText('queued supplement with readable text');
  } finally {
    await harness.close();
  }
});

test('clicking STOP immediately shows a disabled stopping state', async ({ page }) => {
  const harness = await startHarness({
    model: [{ kind: 'slow_text', text: 'still running '.repeat(80), chunks: 40, delayMs: 150 }],
  });
  try {
    const project = harness.project;
    if (project === null) throw new Error('the harness did not seed a project');
    await pinStorage(page, project);

    // Hold the stop receipt so the pending label is observable; the real request still runs.
    await page.route('**/api/v1/rpc', async (route) => {
      const body = route.request().postData() ?? '';
      if (body.includes('"session.input.stop"')) {
        await new Promise((resolve) => setTimeout(resolve, 800));
      }
      await route.continue();
    });

    await page.goto(harness.baseUrl, { waitUntil: 'domcontentloaded' });
    await loginThroughUi(page, harness.accessPassword);
    await waitForConnected(page);

    const composer = page.locator('[data-testid="composer"]');
    await composer.fill('a long running request');
    await composer.press('Enter');
    const stop = page.locator('[data-testid="stop"]');
    await expect(stop).toBeVisible({ timeout: 15_000 });
    await stop.click();

    await expect(stop).toContainText(/Stopping|正在停止/);
    await expect(stop).toBeDisabled();
    await expect(stop).toHaveAttribute('aria-busy', 'true');
  } finally {
    await harness.close();
  }
});

test('withdrawing a queued message removes its row immediately', async ({ page }) => {
  const harness = await startHarness({
    model: [{ kind: 'slow_text', text: 'still running '.repeat(240), chunks: 40, delayMs: 150 }],
  });
  try {
    const project = harness.project;
    if (project === null) throw new Error('the harness did not seed a project');
    await pinStorage(page, project);
    await page.goto(harness.baseUrl, { waitUntil: 'domcontentloaded' });
    await loginThroughUi(page, harness.accessPassword);
    await waitForConnected(page);

    const composer = page.locator('[data-testid="composer"]');
    await composer.fill('first long request');
    await composer.press('Enter');
    await expect(page.locator('[data-testid="stop"]')).toBeVisible({ timeout: 15_000 });
    await composer.fill('this queued message will be withdrawn');
    await composer.press('Enter');

    const queued = page.locator('[data-testid="queued-inputs"]');
    await expect(queued).toContainText('this queued message will be withdrawn');
    // The queue row has its own withdraw action; STOP stays bound to the running input.
    await queued.locator('button').click();
    await expect(queued).toHaveCount(0);
  } finally {
    await harness.close();
  }
});

test('STOP follows the queued message when it becomes the running turn', async ({ page }) => {
  const harness = await startHarness({
    model: [
      { kind: 'slow_text', text: 'first turn '.repeat(30), chunks: 10, delayMs: 200 },
      { kind: 'slow_text', text: 'second turn '.repeat(80), chunks: 30, delayMs: 200 },
    ],
  });
  try {
    const project = harness.project;
    if (project === null) throw new Error('the harness did not seed a project');
    await pinStorage(page, project);
    await page.goto(harness.baseUrl, { waitUntil: 'domcontentloaded' });
    await loginThroughUi(page, harness.accessPassword);
    await waitForConnected(page);

    const composer = page.locator('[data-testid="composer"]');
    await composer.fill('first request');
    await composer.press('Enter');
    await expect(page.locator('[data-testid="stop"]')).toBeVisible({ timeout: 15_000 });
    await composer.fill('second request');
    await composer.press('Enter');
    const queued = page.locator('[data-testid="queued-inputs"]');
    await expect(queued).toBeVisible({ timeout: 5_000 });

    // The first turn ends and the queued input becomes the executing one. STOP must now target
    // that input, not the settled first one.
    await expect(queued).toHaveCount(0, { timeout: 15_000 });
    await page.locator('[data-testid="stop"]').click();
    await expect(page.locator('[data-testid="stop"]')).toHaveCount(0, { timeout: 5_000 });
  } finally {
    await harness.close();
  }
});
