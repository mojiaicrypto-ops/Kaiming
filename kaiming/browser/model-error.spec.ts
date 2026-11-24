import { test, expect, type Page } from '@playwright/test';
import { loginThroughUi, startHarness, waitForConnected, type Harness, type SeededProject } from './harness.ts';

async function boot(page: Page, harness: Harness): Promise<void> {
  const project: SeededProject = harness.project!;
  await page.addInitScript((p) => {
    sessionStorage.setItem('kaiming.projectPath', p.projectPath);
    sessionStorage.setItem('kaiming.sessionId', p.sessionId);
    localStorage.setItem('kaiming.locale', 'en');
  }, project);
  await page.goto(harness.baseUrl, { waitUntil: 'domcontentloaded' });
  await loginThroughUi(page, harness.accessPassword);
  await waitForConnected(page);
}

test('a quota failure is visible, survives reload, and is not announced as a completion', async ({ page }) => {
  const harness = await startHarness({
    model: [
      {
        kind: 'http_error',
        status: 402,
        message: 'Kiro: usage limit reached: You have reached the limit. (MONTHLY_REQUEST_COUNT)',
      },
    ],
  });
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  try {
    await boot(page, harness);
    await harness.submitInput('hello');

    const banner = page.locator('[data-testid="input-error-banner"]');
    await expect(banner).toBeVisible({ timeout: 20_000 });
    await expect(banner).toContainText('quota');
    await expect(banner).toContainText('Kiro');
    await expect(page.locator('[data-testid="input-error-settings"]')).toBeVisible();
    // A failed input is not a finished conversation: the reminder path must stay quiet.
    await expect(page.locator('body')).not.toContainText('Conversation finished');
    expect(pageErrors).toEqual([]);

    // The snapshot, not just the live frame, carries the reason across a reload.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForConnected(page);
    await expect(page.locator('[data-testid="input-error-banner"]')).toBeVisible();
    await expect(page.locator('[data-testid="input-error-banner"]')).toContainText('Kiro');
    await page.locator('[data-testid="input-error-settings"]').click();
    await expect(page).toHaveURL(/\/settings\/models/);
  } finally {
    await harness.close();
  }
});
