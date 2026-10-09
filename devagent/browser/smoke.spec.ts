/**
 * Smoke tests for the real browser acceptance harness (P4-i): prove the page really talks to the
 * workbench, not to a mock. The server runs in-process with a temp data dir; the browser logs in with
 * the generated access password and the shell paints from real server data.
 *
 * Two states are covered, because they exercise different boot paths:
 *  - a first run with no project (login dialog, then the empty shell) - the state a new user sees;
 *  - a seeded project open (the seeded project, the live session stream, statusbar connected).
 *
 * Scope is deliberately the shell that exists today (topbar/sidebar/statusbar + language switch) so a
 * sibling slice still landing `views/*` and `components/shell.js` cannot make these tests flaky.
 */
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { STORAGE_KEYS, loginThroughUi, startHarness, type Harness, type SeededProject } from './harness.ts';

const ARTIFACTS = fileURLToPath(new URL('./artifacts', import.meta.url));

/** Pin the language (and optionally a project/session) before `web/app.js` boots. */
async function pinStorage(
  page: Page,
  seed: { readonly project?: SeededProject; readonly language: string },
): Promise<void> {
  await page.addInitScript(
    (value: {
      readonly projectPath: string | null;
      readonly sessionId: string | null;
      readonly language: string;
      readonly keys: typeof STORAGE_KEYS;
    }) => {
      if (value.projectPath !== null) {
        localStorage.setItem(value.keys.projectPath, value.projectPath);
      }
      if (value.sessionId !== null) {
        localStorage.setItem(value.keys.sessionId, value.sessionId);
      }
      localStorage.setItem(value.keys.language, value.language);
    },
    {
      projectPath: seed.project?.projectPath ?? null,
      sessionId: seed.project?.sessionId ?? null,
      language: seed.language,
      keys: STORAGE_KEYS,
    },
  );
}

/** Screenshot evidence saved on disk and attached to the test result. */
async function attachScreenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  mkdirSync(ARTIFACTS, { recursive: true });
  const path = fileURLToPath(new URL(`./artifacts/${name}.png`, import.meta.url));
  await page.screenshot({ path, fullPage: true });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

test('a first run with no project boots: login dialog, then the empty shell', async ({ page }, testInfo) => {
  const harness: Harness = await startHarness({ seedProject: false });
  try {
    await pinStorage(page, { language: 'en' });
    await page.goto(harness.baseUrl, { waitUntil: 'domcontentloaded' });

    // The login dialog is the first thing a new user sees; the shell behind it is already shipped.
    await expect(page.locator('#appDialog #accessPassword')).toBeVisible();
    await expect(page.locator('.sidebar .nav-item[data-view]')).toHaveCount(8);

    await loginThroughUi(page, harness.accessPassword);

    // Empty shell from real (absent) state: no project painted, the statusbar stays honestly
    // "connecting" (there is no session to stream), and the router/language wiring ran without one.
    await expect(page.locator('#projectName')).toHaveText('');
    await expect(page.locator('#statusLed')).toHaveAttribute('data-state', 'connecting');
    const navRequirements = page.locator('.nav-item[data-view="requirements"] .nav-text');
    await expect(navRequirements).toHaveText('Requirements');
    await page.locator('#languageSelect').selectOption('zh-CN');
    await expect(navRequirements).toHaveText('需求');
    await attachScreenshot(page, testInfo, 'shell-first-run');
    await page.locator('#languageSelect').selectOption('en');
    await expect(navRequirements).toHaveText('Requirements');
  } finally {
    await harness.close();
  }
});

test('a seeded project renders the shell from real server data', async ({ page }, testInfo) => {
  const harness: Harness = await startHarness();
  try {
    const project = harness.project;
    if (project === null) {
      throw new Error('the harness did not seed a project');
    }
    await pinStorage(page, { project, language: 'en' });

    await page.goto(harness.baseUrl, { waitUntil: 'domcontentloaded' });
    await loginThroughUi(page, harness.accessPassword);

    // The seeded project really reached the shell (painted from the RPC response, not the mock).
    await expect(page.locator('#projectName')).toHaveText('project');

    // Eight nav items: the shell's sidebar is the shipped structure, not a partial render.
    await expect(page.locator('.sidebar .nav-item[data-view]')).toHaveCount(8);

    // The statusbar leaves "connecting" only because the live session stream applied a real snapshot:
    // the shell merges connection + session activity, so a connected idle session paints "idle".
    await expect(page.locator('#statusLed')).toHaveAttribute('data-state', /^(idle|connected)$/, {
      timeout: 15_000,
    });

    // The language switch changes a visible string through i18n (EN -> 简中 -> EN).
    const navRequirements = page.locator('.nav-item[data-view="requirements"] .nav-text');
    await expect(navRequirements).toHaveText('Requirements');
    await page.locator('#languageSelect').selectOption('zh-CN');
    await expect(navRequirements).toHaveText('需求');
    await attachScreenshot(page, testInfo, 'shell-seeded');
    await page.locator('#languageSelect').selectOption('en');
    await expect(navRequirements).toHaveText('Requirements');
  } finally {
    await harness.close();
  }
});
