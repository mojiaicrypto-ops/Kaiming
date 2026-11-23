/**
 * The status bar reports the live service sandbox state, not a value left over from an old input.
 * `off` must say protection is off; `auto` must show the mode or, when no backend is available, the
 * explicit unavailable state. Both are read from the real workbench over HTTP.
 */
import { test, expect, type Page } from '@playwright/test';
import { loginThroughUi, startHarness, waitForConnected, type Harness, type SeededProject } from './harness.ts';

async function pinStorage(
  page: Page,
  seed: { readonly project?: SeededProject; readonly locale: string },
): Promise<void> {
  await page.addInitScript(
    (value: { readonly projectPath: string | null; readonly sessionId: string | null; readonly locale: string }) => {
      if (value.projectPath !== null) sessionStorage.setItem('kaiming.projectPath', value.projectPath);
      if (value.sessionId !== null) sessionStorage.setItem('kaiming.sessionId', value.sessionId);
      localStorage.setItem('kaiming.locale', value.locale);
    },
    {
      projectPath: seed.project?.projectPath ?? null,
      sessionId: seed.project?.sessionId ?? null,
      locale: seed.locale,
    },
  );
}

async function boot(page: Page, harness: Harness): Promise<void> {
  const project = harness.project;
  if (project === null) throw new Error('the harness did not seed a project');
  await pinStorage(page, { project, locale: 'en' });
  await page.goto(harness.baseUrl, { waitUntil: 'domcontentloaded' });
  await loginThroughUi(page, harness.accessPassword);
  await waitForConnected(page);
}

test('off shows that protection is off', async ({ page }) => {
  const harness = await startHarness({ sandboxMode: 'off' });
  try {
    await boot(page, harness);
    const badge = page.locator('[data-testid="status-sandbox"]');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveAttribute('data-state', 'inactive');
    await expect(badge).toHaveText(/Protection off/);
  } finally {
    await harness.close();
  }
});

test('auto shows the current sandbox state or the explicit unavailable state', async ({ page }) => {
  const harness = await startHarness({ sandboxMode: 'auto' });
  try {
    await boot(page, harness);
    const badge = page.locator('[data-testid="status-sandbox"]');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText(/Sandbox: auto|Sandbox unavailable/);
  } finally {
    await harness.close();
  }
});
