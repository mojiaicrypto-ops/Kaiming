import { test, expect } from '@playwright/test';
import { loginThroughUi, startHarness, waitForConnected } from './harness.ts';

/**
 * P2-2: the rail's fork action copies the open conversation into a new session and selects it.
 * The model is a scripted endpoint, so the source history is real (a run, a reply), not a fixture.
 */
test('forks the open conversation and selects the copy', async ({ page }) => {
  const harness = await startHarness({ model: [{ kind: 'text', text: '收到，先讨论。' }] });
  try {
    const project = harness.project;
    if (project === null) throw new Error('the harness did not seed a project');
    await page.addInitScript((seed: { projectPath: string; sessionId: string }) => {
      sessionStorage.setItem('kaiming.projectPath', seed.projectPath);
      sessionStorage.setItem('kaiming.sessionId', seed.sessionId);
      localStorage.setItem('kaiming.locale', 'en');
    }, { projectPath: project.projectPath, sessionId: project.sessionId });
    await page.goto(harness.baseUrl, { waitUntil: 'domcontentloaded' });
    await loginThroughUi(page, harness.accessPassword);
    await waitForConnected(page);

    // A real turn first: a session without persisted history must refuse the fork.
    const composer = page.locator('[data-testid="composer"]');
    await composer.fill('先聊聊账号模块');
    await composer.press('Enter');
    await expect(page.getByText('收到，先讨论。')).toBeVisible({ timeout: 30_000 });
    // The fork refuses a processing input; message_end lands before the runner finalises the input,
    // so wait for the run indicator to clear instead of trusting the rendered reply.
    await expect(page.locator('[data-testid="chief-working"]')).toHaveCount(0, { timeout: 30_000 });

    const rows = page.locator('[data-testid="session-row"]');
    await expect(rows).toHaveCount(1);
    await page.locator('[data-testid="session-fork"]').first().click();

    // The rail now holds the source and the copy, and the copy is the open conversation.
    await expect(rows).toHaveCount(2, { timeout: 15_000 });
    const forked = rows.filter({ hasText: '(fork)' });
    await expect(forked).toHaveCount(1);
    await expect(forked).toHaveAttribute('aria-current', 'true');
    // The copied history is readable: the reply from the source conversation is in the new one too.
    await expect(page.getByText('收到，先讨论。')).toBeVisible();

    // A refusal surfaces the server reason: a fresh session has no history to copy.
    await page.locator('[data-testid="new-session"]').click();
    await expect(rows).toHaveCount(3, { timeout: 15_000 });
    await page
      .locator('.srow')
      .filter({ hasText: 'New session' })
      .locator('[data-testid="session-fork"]')
      .click();
    await expect(page.locator('.toast.err')).toContainText('Not forked', { timeout: 15_000 });
  } finally {
    await harness.close();
  }
});
