import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { loginThroughUi, startHarness, waitForConnected, type Harness } from './harness.ts';

/**
 * The open project belongs to the tab, not to the browser profile: two tabs may sit on two
 * projects, a reload stays where that tab was, and a brand-new tab starts from the project the
 * profile opened last. Before this contract, both tabs read one `localStorage` value, so switching
 * in one tab and reloading the other moved it — the failure this spec locks down.
 */

const switcher = (page: Page) => page.locator('[data-testid="project-switcher"]');

/** Open a project directory the way a user does, and wait until the shell shows it. */
async function openProject(page: Page, projectPath: string): Promise<void> {
  await switcher(page).click();
  await page.locator('[data-testid="project-path"]').fill(projectPath);
  await page.locator('[data-testid="project-path"]').press('Enter');
  await expect(switcher(page)).toContainText(basename(projectPath));
}

/** A tab that may be mid-boot (login screen) or already authenticated in this context. */
async function boot(page: Page, harness: Harness): Promise<void> {
  await page.goto(harness.url);
  await Promise.race([
    page.locator('[data-testid="composer"]').waitFor({ timeout: 15_000 }),
    page.locator('[data-testid="password"]').waitFor({ timeout: 15_000 }),
  ]);
  await loginThroughUi(page, harness.accessPassword);
}

test('two tabs hold two projects and a reload keeps each tab on its own', async ({ browser }) => {
  const harness = await startHarness();
  const secondDir = realpathSync(mkdtempSync(join(tmpdir(), 'kaiming-second-')));
  mkdirSync(secondDir, { recursive: true });
  const firstDir = harness.project?.projectPath ?? '';
  const first = basename(firstDir);
  const second = basename(secondDir);

  try {
    const profile = await browser.newContext();
    const tabA = await profile.newPage();
    await boot(tabA, harness);
    await openProject(tabA, firstDir);
    // The seeded project has a session, so this tab reaches a subscribed stream.
    await waitForConnected(tabA);
    const sessionOfA = await tabA.evaluate(() => sessionStorage.getItem('kaiming.sessionId'));
    expect(sessionOfA).not.toBeNull();

    // A new tab starts from the last project (the profile default), then becomes independent.
    const tabB = await profile.newPage();
    await boot(tabB, harness);
    await expect(switcher(tabB)).toContainText(first, { timeout: 15_000 });
    await openProject(tabB, secondDir);
    await expect(switcher(tabB)).toContainText(second);

    // Tab A reloads into its own project, not into the one tab B chose.
    await tabA.reload();
    await expect(switcher(tabA)).toContainText(first, { timeout: 15_000 });
    await expect
      .poll(async () => tabA.evaluate(() => sessionStorage.getItem('kaiming.sessionId')), { timeout: 15_000 })
      .toBe(sessionOfA);

    // B keeps its own project after a reload too: neither tab overwrites the other.
    await tabB.reload();
    await expect(switcher(tabB)).toContainText(second, { timeout: 15_000 });

    // A tab opened after both choices starts from the most recent project (B).
    const tabC = await profile.newPage();
    await boot(tabC, harness);
    await expect(switcher(tabC)).toContainText(second, { timeout: 15_000 });

    await profile.close();
  } finally {
    await harness.close();
    rmSync(secondDir, { recursive: true, force: true });
  }
});
