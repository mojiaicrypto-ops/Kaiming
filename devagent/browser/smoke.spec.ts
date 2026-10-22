/**
 * Smoke tests for the real browser acceptance harness: prove the page really talks to the
 * workbench, not to a mock. The server runs in-process with a temp data dir; the browser logs in
 * with the generated access password and the shell paints from real server data.
 *
 * Two states are covered, because they exercise different boot paths:
 *  - a first run with no project (login screen, then the empty shell) - what a new user sees;
 *  - a seeded project open (the live session stream, the status bar connected).
 */
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { loginThroughUi, startHarness, waitForConnected, type Harness, type SeededProject } from './harness.ts';

const ARTIFACTS = fileURLToPath(new URL('./artifacts', import.meta.url));

/** Pin the language (and optionally a project/session) before the shell boots. */
async function pinStorage(page: Page, seed: { readonly project?: SeededProject; readonly locale: string }): Promise<void> {
  await page.addInitScript((value: { readonly projectPath: string | null; readonly sessionId: string | null; readonly locale: string }) => {
    if (value.projectPath !== null) localStorage.setItem('agentdev.projectPath', value.projectPath);
    if (value.sessionId !== null) localStorage.setItem('agentdev.sessionId', value.sessionId);
    localStorage.setItem('agentdev.locale', value.locale);
  }, {
    projectPath: seed.project?.projectPath ?? null,
    sessionId: seed.project?.sessionId ?? null,
    locale: seed.locale,
  });
}

async function attachScreenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  mkdirSync(ARTIFACTS, { recursive: true });
  const path = fileURLToPath(new URL(`./artifacts/${name}.png`, import.meta.url));
  await page.screenshot({ path, fullPage: true });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

test('a first run with no project boots: login screen, then the empty shell', async ({ page }, testInfo) => {
  const harness: Harness = await startHarness({ seedProject: false });
  try {
    await pinStorage(page, { locale: 'en' });
    await page.goto(harness.baseUrl, { waitUntil: 'domcontentloaded' });

    // The login screen is the first thing a new user sees.
    await expect(page.locator('[data-testid="password"]')).toBeVisible();
    await loginThroughUi(page, harness.accessPassword);

    // Empty shell from real (absent) state: no project painted, the status bar stays honest, the
    // three navigation labels are the TUI's.
    await expect(page.locator('[data-testid="project-switcher"]')).toContainText('No project');
    await expect(page.locator('.top .nav a')).toHaveCount(3);
    const requirements = page.locator('.nav a[href="/requirements"]');
    await expect(requirements).toHaveText('Requirements');

    // Language changes immediately, without a reload, from the appearance pane.
    await page.locator('.nav a[href="/settings/providers"]').click();
    await page.locator('[data-testid="settings-tab-appearance"]').click();
    await page.locator('[data-testid="language"]').selectOption('zh-CN');
    await expect(requirements).toHaveText('需求');
    await attachScreenshot(page, testInfo, 'shell-first-run');
    await page.locator('[data-testid="language"]').selectOption('en');
    await expect(requirements).toHaveText('Requirements');
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
    await pinStorage(page, { project, locale: 'en' });

    await page.goto(harness.baseUrl, { waitUntil: 'domcontentloaded' });
    await loginThroughUi(page, harness.accessPassword);

    // The seeded project really reached the shell (painted from the RPC response, not the mock).
    await expect(page.locator('[data-testid="project-switcher"]')).toContainText('project');
    await expect(page.locator('.status .path')).toContainText('project');

    // The session rail shows the seeded session, titled from its first message (or untitled).
    await expect(page.locator('[data-testid="session-row"]').first()).toBeVisible({ timeout: 15_000 });

    // The status bar leaves "connecting" because the live session stream applied a real snapshot.
    await expect(page.locator('.top .st')).toHaveText(/Connected/, { timeout: 15_000 });

    // The language switch changes a visible string through the catalog (EN -> 简中 -> EN).
    const requirements = page.locator('.nav a[href="/requirements"]');
    await page.locator('.nav a[href="/settings/providers"]').click();
    await page.locator('[data-testid="settings-tab-appearance"]').click();
    await expect(requirements).toHaveText('Requirements');
    await page.locator('[data-testid="language"]').selectOption('zh-CN');
    await expect(requirements).toHaveText('需求');
    await attachScreenshot(page, testInfo, 'shell-seeded');
    await page.locator('[data-testid="language"]').selectOption('en');
    await expect(requirements).toHaveText('Requirements');
  } finally {
    await harness.close();
  }
});

test('five viewports render without a horizontal overflow', async ({ page }) => {
  const harness: Harness = await startHarness();
  try {
    const project = harness.project;
    if (project === null) throw new Error('the harness did not seed a project');
    await pinStorage(page, { project, locale: 'en' });
    for (const [width, height] of [[1440, 900], [1024, 768], [860, 700], [390, 844], [320, 700]] as const) {
      await page.setViewportSize({ width, height });
      await page.goto(`${harness.baseUrl}/`, { waitUntil: 'domcontentloaded' });
      await loginThroughUi(page, harness.accessPassword);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${width}px wide`).toBeLessThanOrEqual(1);
      // The rail collapses into a button on narrow screens; the button stays reachable.
      if (width <= 860) {
        await expect(page.locator('[data-testid="rail-toggle"]')).toBeVisible();
        await page.locator('[data-testid="rail-toggle"]').click();
        await expect(page.locator('.sessions.sheet')).toBeVisible();
        await expect(page.locator('[data-testid="new-session"]')).toBeVisible();
        // Every navigation label stays reachable at the narrow end (the header must not clip).
        for (const label of ['Chat', 'Requirements', 'Settings']) {
          await expect(page.locator('.nav a', { hasText: label })).toBeVisible();
        }
        await page.keyboard.press('Escape');
      } else {
        await expect(page.locator('[data-testid="rail-toggle"]')).toBeHidden();
      }
      await page.goto(`${harness.baseUrl}/requirements`, { waitUntil: 'domcontentloaded' });
      const boardOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(boardOverflow, `board at ${width}px`).toBeLessThanOrEqual(1);
    }
  } finally {
    await harness.close();
  }
});

test('the theme can be switched to light and back, without a reload', async ({ page }) => {
  const harness: Harness = await startHarness();
  try {
    const project = harness.project;
    if (project === null) throw new Error('the harness did not seed a project');
    await pinStorage(page, { project, locale: 'en' });
    await page.goto(`${harness.baseUrl}/settings/appearance`, { waitUntil: 'domcontentloaded' });
    await loginThroughUi(page, harness.accessPassword);
    const theme = (): Promise<string | null> => page.evaluate(() => document.documentElement.dataset['theme'] ?? null);
    expect(await theme()).toBe('dark');
    await page.getByRole('button', { name: 'Light' }).click();
    expect(await theme()).toBe('light');
    // The background really changed, not just an attribute: the token is applied by CSS.
    const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(background).not.toBe('rgb(13, 14, 17)');
    await page.getByRole('button', { name: 'Dark' }).click();
    expect(await theme()).toBe('dark');
  } finally {
    await harness.close();
  }
});

test('a long code fence scrolls inside its own box and never widens the transcript', async ({ page }) => {
  // The markdown renderer emits bare <pre><code>; without its own overflow the widest line in a
  // reply becomes the page's width, which is how a chat screen breaks on a phone.
  const longLine = `const value = '${'x'.repeat(400)}';`;
  const harness: Harness = await startHarness({
    model: [{ kind: 'text', text: `示例：\n\n\`\`\`ts\n${longLine}\n\`\`\`\n 结束。` }],
  });
  try {
    const project = harness.project;
    if (project === null) throw new Error('the harness did not seed a project');
    await page.setViewportSize({ width: 390, height: 844 });
    await pinStorage(page, { project, locale: 'en' });
    await page.goto(harness.baseUrl, { waitUntil: 'domcontentloaded' });
    await loginThroughUi(page, harness.accessPassword);
    await waitForConnected(page);
    const composer = page.locator('[data-testid="composer"]');
    await composer.fill('show me a long line');
    await composer.press('Enter');
    await expect(page.locator('[data-testid="transcript"] .md pre').first()).toBeVisible({ timeout: 20_000 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    // The fence really keeps the line: a wrapped or truncated block would also avoid overflow.
    const fence = await page.locator('[data-testid="transcript"] .md pre').first().evaluate((el) => el.scrollWidth > el.clientWidth);
    expect(fence).toBe(true);
  } finally {
    await harness.close();
  }
});

test('the task strip renders the coordinated Task and polls it', async ({ page }) => {
  // The stub model cannot cite the authorization a real Task needs, so this test answers the two
  // reads the strip depends on (`session.get` to restore the Task, `task.get` to poll it) and
  // asserts the strip paints from them. It is a read stub, not a fake product path: the stream,
  // the session and every write still go to the real server.
  const harness: Harness = await startHarness();
  try {
    const project = harness.project;
    if (project === null) throw new Error('the harness did not seed a project');
    await page.addInitScript(() => {
      const original = window.fetch;
      const counters = { taskReads: 0 };
      (window as unknown as { __counters: typeof counters }).__counters = counters;
      window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const body = typeof init?.body === 'string' ? init.body : '';
        if (body.includes('"task.get"')) {
          counters.taskReads += 1;
          const envelope = JSON.parse(body) as { requestId: string };
          return new Response(
            JSON.stringify({
              requestId: envelope.requestId,
              result: {
                task: { taskId: 't-1', type: 'write', phase: 'develop', status: 'active', revision: 3 },
                members: [
                  {
                    sessionId: 's-m1',
                    roleId: 'developer',
                    phase: 'develop',
                    label: 'developer',
                    expectedKind: 'code',
                    currentInputId: 'i-1',
                    activity: 'processing',
                  },
                ],
                results: [],
              },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        if (body.includes('"session.get"')) {
          const envelope = JSON.parse(body) as { requestId: string };
          return new Response(
            JSON.stringify({
              requestId: envelope.requestId,
              result: {
                session: {
                  sessionId: 's',
                  projectId: 'p',
                  roleId: 'chief',
                  currentTaskId: 't-1',
                  revision: 1,
                  activity: 'processing',
                  currentInputId: 'i-1',
                  lastActivityAt: null,
                },
              },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        return original(input, init);
      };
    });
    await pinStorage(page, { project, locale: 'en' });
    await page.goto(harness.baseUrl, { waitUntil: 'domcontentloaded' });
    await loginThroughUi(page, harness.accessPassword);

    const strip = page.locator('[data-testid="task-strip"]');
    await expect(strip).toBeVisible({ timeout: 15_000 });
    await expect(strip).toContainText('t-1');
    await expect(strip).toContainText('Develop');
    await expect(strip).toContainText('Members 1');
    await expect(page.locator('[data-testid="task-pause"]')).toBeVisible();
    // The running member is reported, which is what the status bar counts.
    await expect(strip).toContainText('Running');

    // More than one read proves the poll loop is live rather than a one-off on snapshot.
    const first = await page.evaluate(() => (window as unknown as { __counters: { taskReads: number } }).__counters.taskReads);
    expect(first).toBeGreaterThanOrEqual(1);
    await page.waitForTimeout(3_500);
    const second = await page.evaluate(() => (window as unknown as { __counters: { taskReads: number } }).__counters.taskReads);
    expect(second).toBeGreaterThan(first);
  } finally {
    await harness.close();
  }
});

test('a Task the chief creates mid-run appears without a reload', async ({ page }) => {
  // The Task is created by the chief's own tool call, so nothing polls for it: the strip can only
  // appear if the server pushes the change (the interval starts after the id is known, not before).
  const harness: Harness = await startHarness({
    model: [
      {
        kind: 'tool_calls',
        calls: [
          {
            name: 'task',
            arguments: JSON.stringify({
              op: 'create',
              type: 'read',
              goal: 'survey the account module',
              scope: 'account module',
              planMarkdown: '# survey\n\nread the module.\n',
            }),
          },
        ],
      },
      { kind: 'text', text: '任务已建。' },
    ],
  });
  try {
    const project = harness.project;
    if (project === null) throw new Error('the harness did not seed a project');
    await pinStorage(page, { project, locale: 'en' });
    await page.goto(harness.baseUrl, { waitUntil: 'domcontentloaded' });
    await loginThroughUi(page, harness.accessPassword);
    await waitForConnected(page);

    const composer = page.locator('[data-testid="composer"]');
    await composer.fill('先调查一下账号模块');
    await composer.press('Enter');

    const strip = page.locator('[data-testid="task-strip"]');
    await expect(strip).toBeVisible({ timeout: 20_000 });
    await expect(strip).toContainText('t-');
  } finally {
    await harness.close();
  }
});
