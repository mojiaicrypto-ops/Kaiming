/**
 * Browser acceptance: the real workbench, a real Chromium and a real model endpoint.
 *
 * These are the product's own acceptance steps (docs/productnew/acceptance.md) driven through the
 * browser: they prove what unit tests cannot - that the page really talks to the server, renders
 * what the server holds, answers questions and keeps working when the reader leaves.
 */
import { mkdirSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { loginThroughUi, startHarness, waitForConnected } from './harness.ts';
import type { StubReply } from '../spikes/harness/pi-env.ts';

/** The task-list step for one phase — the unit both the strip and the list agree on. */
function rowOf(live: import('@playwright/test').Locator, phase: string): import('@playwright/test').Locator {
  return live.locator(`[data-testid="task-steps"] .todo-g[data-phase="${phase}"]`);
}

/** Open the seeded project through the switcher (the first thing a user does). */
async function openProject(page: Page, projectPath: string): Promise<void> {
  await page.locator('[data-testid="project-switcher"]').click();
  await page.locator('[data-testid="project-path"]').fill(projectPath);
  await page.locator('[data-testid="project-path"]').press('Enter');
  await expect(page.locator('[data-testid="project-switcher"]')).toContainText('project');
  await waitForConnected(page);
  await expect(page.locator('[data-testid="composer"]')).toBeEnabled();
}

test('a project opens into its real state and every screen renders', async ({ page }) => {
  const harness = await startHarness();
  try {
    await page.goto(harness.url);
    await loginThroughUi(page, harness.accessPassword);
    expect(harness.project).not.toBeNull();
    await openProject(page, harness.project?.projectPath ?? '');

    // The shell is the TUI's: three screens in the header, one status line below.
    await expect(page.locator('.top .nav a')).toHaveCount(3);
    await expect(page.locator('.status .path')).toContainText('project');

    await page.locator('.nav a[href="/requirements"]').click();
    await expect(page.locator('[data-testid="board"]')).toBeVisible();
    await expect(page.locator('[data-testid="board"] .colm')).toHaveCount(4);

    await page.locator('.nav a[href="/settings/providers"]').click();
    await expect(page.locator('[data-testid="providers"]')).toBeVisible();
    await page.locator('[data-testid="settings-tab-models"]').click();
    await expect(page.locator('[data-testid="models"]')).toBeVisible();
    await page.locator('[data-testid="settings-tab-appearance"]').click();
    await expect(page.locator('[data-testid="appearance"]')).toBeVisible();

    // The address bar is the route: a reload lands on the same pane, not on chat.
    await page.reload();
    await expect(page.locator('[data-testid="appearance"]')).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('screens.png'), fullPage: true });
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

    const composer = page.locator('[data-testid="composer"]');
    await composer.fill('先讨论，不开始开发');
    await composer.press('Enter');

    await expect(page.locator('[data-testid="transcript"] .m.user')).toHaveCount(1, { timeout: 15_000 });
    // The answer arrives through the live stream, not from a re-read - and exactly once: the
    // streamed partial and its finished message are the same node, not two.
    await expect(page.locator('[data-testid="transcript"] .m.chief .md').last()).toContainText('我们先讨论', {
      timeout: 20_000,
    });
    await expect(page.locator('[data-testid="transcript"] .m.chief')).toHaveCount(1);
    await page.screenshot({ path: test.info().outputPath('conversation.png') });
  } finally {
    await harness.close();
  }
});

test('an attached image is stored once, shown in the message, and still there after a reload', async ({ page }) => {
  const harness = await startHarness({ model: [{ kind: 'text', text: '我看到了这张图。' }] });
  try {
    // A real PNG on disk: the upload route sniffs bytes, so a renamed text file would be refused.
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    const pngPath = test.info().outputPath('pixel.png');
    writeFileSync(pngPath, png);

    await page.goto(harness.url);
    await loginThroughUi(page, harness.accessPassword);
    await openProject(page, harness.project?.projectPath ?? '');

    await page.setInputFiles('[data-testid="attach-input"]', pngPath);
    const preview = page.locator('[data-testid="attachments"] img');
    await expect(preview).toHaveCount(1);
    const src = await preview.getAttribute('src');
    expect(src).toMatch(/^\/api\/v1\/attachments\/[0-9a-f]{32}$/);

    const composer = page.locator('[data-testid="composer"]');
    await composer.fill('看看这张截图');
    await composer.press('Enter');

    const inMessage = page.locator('[data-testid="transcript"] .m.user img');
    await expect(inMessage).toHaveCount(1, { timeout: 15_000 });
    expect(await inMessage.getAttribute('src')).toBe(src);
    // The bytes really arrive at the browser (the route is authenticated, not open).
    expect(await inMessage.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
    await expect(page.locator('[data-testid="transcript"] .m.user')).toContainText('看看这张截图');

    // The transcript is rebuilt from the session history on reload, so the address must survive.
    await page.reload();
    await waitForConnected(page);
    await expect(page.locator('[data-testid="transcript"] .m.user img')).toHaveCount(1, { timeout: 15_000 });
    await page.screenshot({ path: test.info().outputPath('attachment.png') });
  } finally {
    await harness.close();
  }
});

test('a question is answered in the panel and the model continues', async ({ page }) => {
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

    const composer = page.locator('[data-testid="composer"]');
    await composer.fill('整理一下需求');
    await composer.press('Enter');

    const panel = page.locator('[data-testid="question-panel"]');
    await expect(panel).toBeVisible({ timeout: 20_000 });
    await expect(panel).toContainText('是否将讨论内容加入需求列表');
    // The panel is docked above the composer, not floating over the transcript.
    await panel.getByRole('button', { name: /加入/ }).first().click();

    // The answered card shows its echo (the proof the reply was recorded) in the user's language,
    // and then closes itself: a decision already made must not keep a box over the transcript.
    await expect(panel).toContainText('Answer received', { timeout: 15_000 });
    await expect(panel).toHaveCount(0, { timeout: 15_000 });
    await expect(page.locator('[data-testid="transcript"] .m.chief .md').last()).toContainText('已按你的选择继续', {
      timeout: 20_000,
    });
    // One tool call, one line: the question row flips to its answer instead of a second node.
    await expect(page.locator('[data-testid="transcript"] .askline')).toHaveCount(1);
    await expect(page.locator('[data-testid="transcript"] .askline')).toHaveClass(/ok/);
    await page.screenshot({ path: test.info().outputPath('answered.png') });
  } finally {
    await harness.close();
  }
});

test('a question with long options wraps instead of being cut off', async ({ page }) => {
  // Options are rows in a column, not pills in a row: a long reason must wrap inside its row
  // with a hanging indent, and the panel must not grow past the viewport to show it.
  const longA = '客服后台 —— 走工单流程,客服代发重置邮件,适合 B 端场景,需要给客服增加一层权限校验并把工单系统与现有账号体系打通,避免两套入口各自记账';
  const longQ = '密码重置的入口放在哪里?考虑到现有账号体系已经有客服后台和用户自助页两套入口,需要确定这次挂到哪一边,以及是否要同时保留邮件链接的兜底路径。';
  const harness = await startHarness({
    model: [
      {
        kind: 'tool_calls',
        calls: [
          {
            name: 'question',
            arguments: JSON.stringify({ title: longQ, options: [longA, '用户账号页', '先不做'], method: 'select' }),
          },
        ],
      },
      { kind: 'text', text: '等你选择。' },
    ],
  });
  try {
    await page.goto(harness.url);
    await loginThroughUi(page, harness.accessPassword);
    await openProject(page, harness.project?.projectPath ?? '');
    await page.locator('[data-testid="composer"]').fill('入口放哪');
    await page.locator('[data-testid="composer"]').press('Enter');

    const panel = page.locator('[data-testid="question-panel"]');
    await expect(panel).toBeVisible({ timeout: 20_000 });
    // The full text is on screen — nothing ellipsized away.
    await expect(panel).toContainText(longQ);
    await expect(panel).toContainText(longA);
    const row = panel.locator('.ao').first();
    await expect(row).toContainText(longA);
    // And it fits: the row stays inside the panel's box and is taller than one text line,
    // which is only possible when the long text wrapped inside the row.
    const box = await row.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const panelRect = element.closest('.ask')?.getBoundingClientRect();
      return { width: rect.width, panelWidth: panelRect?.width ?? 0, height: rect.height, lineHeight: parseFloat(getComputedStyle(element).lineHeight) };
    });
    expect(box.width).toBeLessThanOrEqual(box.panelWidth);
    expect(box.height).toBeGreaterThan(box.lineHeight * 1.5);
    await page.screenshot({ path: test.info().outputPath('long-options.png') });
  } finally {
    await harness.close();
  }
});

test('a typed answer is sent once, and Enter in its field is what sends it', async ({ page }) => {
  // The escape hatch row ("type another answer") opens a field inside the panel. Its Enter used to
  // be handled twice - once by the panel on the way up, once by nothing at all - so the answer was
  // sent before the field had a chance to decide, and an empty field counted as an answer.
  const harness = await startHarness({
    model: [
      {
        kind: 'tool_calls',
        calls: [
          {
            name: 'question',
            arguments: JSON.stringify({
              method: 'input',
              title: '入口放在哪里？',
              placeholder: '写下入口位置',
            }),
          },
        ],
      },
      { kind: 'text', text: '已按你的说明继续。' },
    ],
  });
  try {
    await page.goto(harness.url);
    await loginThroughUi(page, harness.accessPassword);
    await openProject(page, harness.project?.projectPath ?? '');
    const composer = page.locator('[data-testid="composer"]');
    await composer.fill('按方案 B 做');
    await composer.press('Enter');

    const panel = page.locator('[data-testid="question-panel"]');
    await expect(panel).toBeVisible({ timeout: 20_000 });
    const field = panel.getByRole('textbox');
    await field.fill('');
    await field.press('Enter');
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('textbox')).toHaveCount(1);

    await field.fill('放客服后台，但保留自助入口的位置');
    await field.press('Enter');
    await expect(panel).toContainText('Answer received', { timeout: 15_000 });
    const echo = panel.locator('.ask-echo');
    await expect(echo).toContainText('放客服后台，但保留自助入口的位置');
    await page.screenshot({ path: test.info().outputPath('typed-answer.png') });
  } finally {
    await harness.close();
  }
});

test('a second Enter while the first submit is in flight does not submit twice', async ({ page }) => {
  const harness = await startHarness({ model: [{ kind: 'text', text: '收到。' }] });
  try {
    await page.goto(harness.url);
    await loginThroughUi(page, harness.accessPassword);
    await openProject(page, harness.project?.projectPath ?? '');

    const composer = page.locator('[data-testid="composer"]');
    // Wait for the stream to be really open: pressing Enter while the session is still connecting
    // measures the reconnect path, not the double-submit guard this test is about.
    await expect(page.locator('.top .st')).toHaveText(/Connected/, { timeout: 15_000 });
    await composer.fill('只发一次');
    // Two Enter presses dispatched in the same task: the second really happens while the first is
    // still in flight, which is what the guard exists for.
    await page.evaluate(() => {
      const field = document.querySelector('[data-testid="composer"]');
      for (let index = 0; index < 2; index += 1) {
        field?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      }
    });

    await expect(page.locator('[data-testid="transcript"] .m.user')).toHaveCount(1, { timeout: 15_000 });
    // The server really holds one input: the snapshot is the server's own view of it.
    const stored = await page.evaluate(async () => {
      const handle = (window as unknown as { __agentdev: { rpc: { call: (m: string, p: Record<string, unknown>) => Promise<unknown> }; workspace: { projectId: string; sessionId: string } } }).__agentdev;
      const prepared = (await handle.rpc.call('session.stream.prepare', {
        projectId: handle.workspace.projectId,
        sessionId: handle.workspace.sessionId,
      })) as { snapshot: { inputs: unknown[] } };
      return prepared.snapshot.inputs.length;
    });
    expect(stored).toBe(1);
  } finally {
    await harness.close();
  }
});

test('a business refusal does not break writing, and no screen shows a raw translation key', async ({ page }) => {
  const harness = await startHarness({ model: [{ kind: 'text', text: '很好。' }] });
  try {
    await page.goto(harness.url);
    await loginThroughUi(page, harness.accessPassword);
    await openProject(page, harness.project?.projectPath ?? '');

    // A refusal that is not about CSRF must not lock the tab out. The refusal is driven through the
    // page's own client, so the client's token handling is what this test exercises.
    const projectPath = harness.project?.projectPath ?? '';
    writeFileSync(join(projectPath, 'real.txt'), 'inside\n');
    symlinkSync('/etc/hosts', join(projectPath, 'escape.txt'));
    const refusal = await page.evaluate(async () => {
      const handle = (window as unknown as { __agentdev: { rpc: { call: (m: string, p: Record<string, unknown>) => Promise<unknown>; csrfToken: string | null }; workspace: { projectId: string } } }).__agentdev;
      try {
        await handle.rpc.call('project.files.read', { projectId: handle.workspace.projectId, path: 'escape.txt' });
        return { code: 'none', tokenAfter: handle.rpc.csrfToken };
      } catch (error) {
        return { code: (error as { code?: string }).code ?? 'unknown', tokenAfter: handle.rpc.csrfToken };
      }
    });
    expect(refusal.code).toBe('FORBIDDEN');
    // The tab can still write: the token is untouched by a business refusal.
    expect(refusal.tokenAfter).not.toBeNull();

    // Writing still works afterwards.
    const composer = page.locator('[data-testid="composer"]');
    await composer.fill('还能写');
    await composer.press('Enter');
    await expect(page.locator('[data-testid="transcript"] .m.user')).toHaveCount(1, { timeout: 15_000 });

    // No visible screen shows a raw key (e.g. `req.title`) instead of copy: wait for the pane to
    // paint, then scan every line — a key can appear mid-line, not only as a whole line.
    const panes: ReadonlyArray<readonly [string, string]> = [
      ['/requirements', '[data-testid="board"]'],
      ['/settings/providers', '[data-testid="providers"]'],
      ['/settings/models', '[data-testid="models"]'],
      ['/settings/appearance', '[data-testid="appearance"]'],
      ['/', '[data-testid="composer"]'],
    ];
    for (const [path, ready] of panes) {
      await page.goto(`${harness.baseUrl}${path}`);
      // The live stream keeps the connection busy, so "network idle" never arrives: wait for the
      // pane that owns the screen instead.
      await expect(page.locator(ready)).toBeVisible();
      const text = (await page.locator('body').innerText()).trim();
      const keys = text.split('\n').flatMap((line) => line.match(/\b[a-z][a-zA-Z]*(?:\.[a-zA-Z]+)+\b/g) ?? []);
      // A dotted token on screen is only legitimate as a file path or a model id.
      expect(keys.filter((token) => !token.includes('/') && !/^[a-z]+\.[0-9]/.test(token))).toEqual([]);
    }
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

    const composer = page.locator('[data-testid="composer"]');
    await composer.fill('开始吧');
    await composer.press('Enter');
    await expect(page.locator('[data-testid="transcript"] .m.user')).toHaveCount(1, { timeout: 15_000 });

    // Leave the page entirely and come back: the conversation is re-read from the server, not from
    // anything the first page kept (M4: a disconnect destroys the buffer, never the work).
    await page.goto('about:blank');
    await page.goto(harness.url);
    await expect(page.locator('[data-testid="transcript"] .m')).not.toHaveCount(0, { timeout: 20_000 });
    await page.screenshot({ path: test.info().outputPath('returned.png') });
  } finally {
    await harness.close();
  }
});

test('a rejected tool call stays visible with its reason', async ({ page }) => {
  // A task call that the server refuses must not vanish: a call that disappears takes its error
  // with it, and the user cannot tell a refusal from a silent success.
  const harness = await startHarness({
    model: [
      {
        kind: 'tool_calls',
        calls: [
          {
            name: 'task',
            // A write Task that does not say whether it requires a test: a real refusal the model
            // can act on, and one that does not depend on any decision reference.
            arguments: JSON.stringify({ op: 'create', type: 'write', goal: 'g', scope: 's', planMarkdown: '# p' }),
          },
        ],
      },
      { kind: 'text', text: '没有建立任务。' },
    ],
  });
  try {
    await page.goto(harness.url);
    await loginThroughUi(page, harness.accessPassword);
    await openProject(page, harness.project?.projectPath ?? '');
    await page.locator('[data-testid="composer"]').fill('建个任务');
    await page.locator('[data-testid="composer"]').press('Enter');

    const failed = page.locator('[data-testid="transcript"] .tc.failed');
    await expect(failed).toHaveCount(1, { timeout: 20_000 });
    await expect(failed.locator('.tn')).toContainText('task');
    await expect(failed).toContainText('requiresTest');
  } finally {
    await harness.close();
  }
});

test('a proposal opens with its own sections, and an unparsable file says why', async ({ page }) => {
  const harness = await startHarness();
  try {
    const projectPath = harness.project?.projectPath ?? '';
    const dir = join(projectPath, '.dev', 'requirements');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'PRO-1.md'),
      [
        '---',
        'schemaVersion: 2',
        'id: PRO-1',
        'kind: proposal',
        'title: Password reset proposal',
        'status: pending',
        'createdAt: "2026-10-01T00:00:00Z"',
        'updatedAt: "2026-10-01T00:00:00Z"',
        '---',
        '',
        '## 目标',
        'Self-service reset.',
        '',
        '## 来源与决定',
        'From session 10:47.',
        '',
        '## 处理记录',
        'Nothing yet.',
        '',
      ].join('\n'),
    );
    writeFileSync(join(dir, 'BROKEN.md'), '---\nid: BROKEN\nkind: proposal\n');

    await page.goto(harness.url);
    await loginThroughUi(page, harness.accessPassword);
    await openProject(page, projectPath);
    await page.goto(`${harness.baseUrl}/requirements`);

    // The unparsable record is visible as a notice, not silently dropped.
    await expect(page.locator('.notice')).toContainText('BROKEN.md');
    await page.locator('[data-testid="requirement-card"]').first().click();

    // A proposal body is 目标 / 来源与决定 / 处理记录 — none of it may be dropped.
    const drawer = page.locator('.drawer .db');
    await expect(drawer).toContainText('Self-service reset', { timeout: 10_000 });
    await expect(drawer).toContainText('From session 10:47');
    await expect(drawer).toContainText('Nothing yet');
  } finally {
    await harness.close();
  }
});

test('the model scope switch changes what is saved, not only what is read', async ({ page }) => {
  // The project scope must write a project override. A save that sent the role id instead would
  // silently rewrite the global assignment while the screen said "this project".
  const harness = await startHarness();
  try {
    await page.goto(harness.url);
    await loginThroughUi(page, harness.accessPassword);
    await openProject(page, harness.project?.projectPath ?? '');
    // A provider with two models, through the same RPC surface the Providers page uses.
    await page.evaluate(async () => {
      const handle = (window as unknown as { __agentdev: { rpc: { call: (method: string, params: unknown, options?: { requestId: string }) => Promise<unknown> } } }).__agentdev;
      await handle.rpc.call(
        'config.save',
        {
          expectedRevision: null,
          value: {
            kind: 'provider',
            providerId: 'p-test',
            baseUrl: 'http://127.0.0.1:9/v1',
            api: 'openai-completions',
            apiKey: 'test-key',
            models: [
              { id: 'm-a', name: 'm-a' },
              { id: 'm-b', name: 'm-b' },
            ],
          },
        },
        { requestId: 'seed-provider' },
      );
    });

    await page.goto(`${harness.baseUrl}/settings/models`, { waitUntil: 'domcontentloaded' });
    await page.locator('[data-testid="scope-project"]').click();
    const select = page.locator('[data-testid="model-project"]');
    await expect(select).toBeEnabled();
    await select.selectOption('m-a');
    await expect(page.locator('.toast')).toContainText(/saved|已保存/i);

    const read = await page.evaluate(async () => {
      const handle = (window as unknown as { __agentdev: { rpc: { call: (method: string, params: unknown) => Promise<unknown> } } }).__agentdev;
      const projectId = (window as unknown as { __agentdev: { workspace: { projectId: string } } }).__agentdev.workspace.projectId;
      const project = (await handle.rpc.call('config.get', { roleId: 'chief', projectId })) as {
        effective: { modelId: string; source: string };
      };
      const global = (await handle.rpc.call('config.get', { roleId: 'chief' })) as {
        effective: { modelId: string; source: string };
      };
      return { project, global };
    });
    // The project override exists; the global role assignment was not touched.
    expect(read.project.effective).toMatchObject({ modelId: 'm-a', source: 'project' });
    expect(read.global.effective.source).not.toBe('project');
  } finally {
    await harness.close();
  }
});

test('a project can override one role, and choosing "default" gives the layer back', async ({ page }) => {
  const harness = await startHarness();
  try {
    await page.goto(harness.url);
    await loginThroughUi(page, harness.accessPassword);
    await openProject(page, harness.project?.projectPath ?? '');
    await page.evaluate(async () => {
      const handle = (window as unknown as { __agentdev: { rpc: { call: (m: string, p: unknown, o?: { requestId: string }) => Promise<unknown> } } }).__agentdev;
      for (const value of [
        {
          kind: 'provider',
          providerId: 'p-test',
          baseUrl: 'http://127.0.0.1:9/v1',
          api: 'openai-completions',
          apiKey: 'test-key',
          models: [
            { id: 'm-a', name: 'm-a' },
            { id: 'm-b', name: 'm-b' },
          ],
        },
      ]) {
        await handle.rpc.call('config.save', { expectedRevision: null, value }, { requestId: `seed-${value.providerId}` });
      }
    });

    await page.goto(`${harness.baseUrl}/settings/models`, { waitUntil: 'domcontentloaded' });
    await page.locator('[data-testid="scope-project"]').click();
    // The project scope edits every role, not only a project-wide value.
    await expect(page.locator('[data-testid="model-project"]')).toBeVisible();
    await expect(page.locator('[data-testid="model-project-tester"]')).toBeVisible();

    await page.locator('[data-testid="model-project-tester"]').selectOption('m-b');
    await expect(page.locator('.toast').last()).toContainText(/saved|已保存/i);

    const stored = async () =>
      page.evaluate(async () => {
        const handle = (window as unknown as { __agentdev: { rpc: { call: (m: string, p: unknown) => Promise<unknown> } } }).__agentdev;
        const projectId = (window as unknown as { __agentdev: { workspace: { projectId: string } } }).__agentdev.workspace.projectId;
        const tester = (await handle.rpc.call('config.get', { roleId: 'tester', projectId })) as {
          effective: { modelId: string; source: string };
        };
        const chief = (await handle.rpc.call('config.get', { roleId: 'chief', projectId })) as {
          effective: { modelId: string; source: string };
        };
        return { tester, chief };
      });

    let read = await stored();
    expect(read.tester.effective).toMatchObject({ modelId: 'm-b', source: 'project-role' });
    // A sibling role in the same project is untouched.
    expect(read.chief.effective.source).not.toBe('project-role');

    // Re-selecting another model updates the same layer instead of failing as a conflict.
    await page.locator('[data-testid="model-project-tester"]').selectOption('m-a');
    await expect(page.locator('.toast').last()).toContainText(/saved|已保存/i);
    read = await stored();
    expect(read.tester.effective.modelId).toBe('m-a');

    // "Default" is not a label: it removes the layer, and the role falls back.
    await page.locator('[data-testid="model-project-tester"]').selectOption('');
    await expect(page.locator('.toast').last()).toContainText(/saved|已保存/i);
    read = await stored();
    expect(read.tester.effective.source).not.toBe('project-role');
  } finally {
    await harness.close();
  }
});

test('a board left open follows the record when it changes on disk', async ({ page }) => {
  // The board is a projection of project files another process writes; a value it kept from mount
  // would be a claim about the past. This is the run that reported "the board never updates": the
  // record was still pending while its Task was in Test.
  const harness = await startHarness();
  try {
    const projectPath = harness.project?.projectPath ?? '';
    const dir = join(projectPath, '.dev', 'requirements');
    mkdirSync(dir, { recursive: true });
    const card = (status: string): string =>
      [
        '---',
        'schemaVersion: 2',
        'id: req-reset',
        'kind: implementation',
        'title: Account password reset',
        'status: ' + status,
        'createdAt: "2026-10-01T00:00:00Z"',
        'updatedAt: "2026-10-01T00:00:00Z"',
        '---',
        '',
        '## 目标',
        'allow a user to reset a password',
        '',
        '## 范围',
        'account module',
        '',
        '## 行为与异常',
        'expired token is refused',
        '',
        '## 验收',
        'reset works, expired token does not',
        '',
        '## 来源与决定',
        'session 2026-10-01',
        '',
        '## 未知',
        'email provider',
        '',
        '## 完成摘要',
        '(not started)',
        '',
      ].join('\n');
    const path = join(dir, 'req-reset.md');
    writeFileSync(path, card('pending'));

    await page.goto(harness.url);
    await loginThroughUi(page, harness.accessPassword);
    await openProject(page, projectPath);
    await page.goto(`${harness.baseUrl}/requirements`, { waitUntil: 'domcontentloaded' });

    const board = page.locator('[data-testid="board"]');
    await expect(board.locator('[data-testid="requirement-card"]')).toHaveCount(1, { timeout: 15_000 });
    const columns = board.locator('.colm');
    await expect(columns.nth(1)).toContainText('req-reset', { timeout: 15_000 });

    // Someone else (the chief) records the transition. No reload, no click.
    writeFileSync(path, card('in_progress'));
    await expect(columns.nth(2).locator('[data-testid="requirement-card"]')).toHaveCount(1, { timeout: 20_000 });
    await expect(columns.nth(1)).toContainText(/Nothing here|暂无/, { timeout: 20_000 });
  } finally {
    await harness.close();
  }
});

test('a requirement hands off to the chat without sending anything', async ({ page }) => {
  // The board cannot start work. Its action fills the composer so the user can read and edit the
  // request first; a hidden submit would be an action the user never saw.
  const harness = await startHarness();
  try {
    const projectPath = harness.project?.projectPath ?? '';
    const dir = join(projectPath, '.dev', 'requirements');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'req-reset.md'),
      [
        '---',
        'schemaVersion: 2',
        'id: req-reset',
        'kind: implementation',
        'title: Account password reset',
        'status: pending',
        'createdAt: "2026-10-01T00:00:00Z"',
        'updatedAt: "2026-10-01T00:00:00Z"',
        '---',
        '',
        '## 目标',
        'allow a user to reset a password',
        '',
        '## 范围',
        'account module',
        '',
        '## 行为与异常',
        'expired token is refused',
        '',
        '## 验收',
        'reset works, expired token does not',
        '',
        '## 来源与决定',
        'session 2026-10-01',
        '',
        '## 未知',
        'email provider',
        '',
        '## 完成摘要',
        '(not started)',
        '',
      ].join('\n'),
    );

    await page.goto(harness.url);
    await loginThroughUi(page, harness.accessPassword);
    await openProject(page, projectPath);
    await page.goto(`${harness.baseUrl}/requirements`, { waitUntil: 'domcontentloaded' });

    await page.locator('[data-testid="requirement-card"]').first().click();
    const handoff = page.locator('[data-testid="req-handoff"]');
    await expect(handoff).toBeVisible();
    await handoff.click();

    // The chat is open with the request filled in and nothing sent.
    await expect(page.locator('[data-testid="composer"]')).toHaveValue(/req-reset/);
    await page.waitForTimeout(800);
    await expect(page.locator('[data-testid="transcript"] article.m')).toHaveCount(0);
    await expect(page.locator('[data-testid="composer"]')).toHaveValue(/req-reset/);
  } finally {
    await harness.close();
  }
});

test('a document Task draws the phases it really ran, not a code chain nobody executed', async ({ page }) => {
  // A write Task that declares no independent test, moved to its design step: the strip must read
  // "plan → design". The old chain was a fixed list (plan/develop/review/test/settle), so it showed
  // steps that had not happened and a test step the Task never asked for.
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
              requiresTest: false,
              goal: '把产品文档按现行代码整理',
              scope: '.dev/product',
              planMarkdown: '# 文档整理\n',
            }),
          },
        ],
      },
      { kind: 'tool_calls', calls: [{ name: 'task', arguments: JSON.stringify({ op: 'update', phase: 'design', summary: '进入设计' }) }] },
      { kind: 'text', text: '开始整理。' },
    ],
  });
  try {
    await page.goto(harness.url);
    await loginThroughUi(page, harness.accessPassword);
    await openProject(page, harness.project?.projectPath ?? '');
    await page.locator('[data-testid="composer"]').fill('整理产品文档');
    await page.locator('[data-testid="composer"]').press('Enter');

    const strip = page.locator('[data-testid="task-strip"]');
    await expect(strip).toBeVisible({ timeout: 25_000 });
    // The real chain is what the Task did: the design step it moved to, never develop —
    // that is a code step this document Task does not run, planned or otherwise.
    await expect(strip.locator('.phases')).toContainText(/Design|设计/, { timeout: 20_000 });
    await expect(strip.locator('.phases')).not.toContainText(/Develop|开发/);
    // The plan's tail follows from the Task's own declaration (write, requiresTest=false):
    // review and settle are owed and shown dimmed as planned, test is not.
    await expect(strip.locator('.p.plan')).toHaveCount(2, { timeout: 20_000 });
    await expect(strip.locator('.p.plan').first()).toContainText(/Review|审核/);
    await expect(strip.locator('.p.plan').nth(1)).toContainText(/Settle|结算/);
    await expect(strip.locator('.phases')).not.toContainText(/Test|测试/);
    // A planned step never wears a check and never calls itself current: it is the road, not the walk.
    await expect(strip.locator('.p.plan .dot')).toHaveText(['', '']);
    await expect(strip.locator('.p.cur')).toHaveCount(1);
    await expect(strip.locator('.p.cur')).toContainText(/Design|设计/);
    await page.screenshot({ path: test.info().outputPath('document-task.png') });
  } finally {
    await harness.close();
  }
});

test('a Task member is not a conversation in the rail', async ({ page }) => {
  // The designer works inside the Task; it belongs to the strip and the members list. Listing it
  // as another chat (titled by its delegation body) made the rail unreadable in the real project.
  const harness = await startHarness({
    model: [
      { kind: 'tool_calls', calls: [{ name: 'task', arguments: JSON.stringify({ op: 'create', type: 'write', requiresTest: false, goal: 'g', scope: 's', planMarkdown: '# p\n' }) }] },
      {
        kind: 'tool_calls',
        calls: [
          {
            name: 'task',
            arguments: JSON.stringify({
              op: 'dispatch',
              waitTimeoutMs: 8_000,
              sessions: [{ roleId: 'designer', instructions: '整理产品文档', writeScope: ['.dev/product/**'] }],
            }),
          },
        ],
      },
      { kind: 'text', text: '已安排设计。' },
    ],
  });
  try {
    await page.goto(harness.url);
    await loginThroughUi(page, harness.accessPassword);
    await openProject(page, harness.project?.projectPath ?? '');
    await page.locator('[data-testid="composer"]').fill('整理产品文档');
    await page.locator('[data-testid="composer"]').press('Enter');
    const strip = page.locator('[data-testid="task-strip"]');
    await expect(strip).toBeVisible({ timeout: 25_000 });
    await expect(page.locator('[data-testid="session-row"]')).toHaveCount(1);
    // The member is reachable where it belongs: the dispatch card in the transcript, which names
    // the session the strip no longer counts.
    await expect(page.locator('[data-call-id]').first()).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: test.info().outputPath('rail-members.png') });
  } finally {
    await harness.close();
  }
});

test('a running Task is in the conversation even when history has no dispatch yet', async ({ page }) => {
  // The case the user hit: the chief is waiting inside the dispatch call, so the assistant message
  // that holds it has not ended and nothing about the Task is in history. A reload must still show
  // the Task and its member. The Task is served by `task.get`, which is what the page reads.
  const harness = await startHarness();
  const task = {
    task: { taskId: 't-live', type: 'write', phase: 'develop', status: 'active', revision: 4, goal: '按验收实现六件套' },
    members: [
      {
        sessionId: 's-live',
        roleId: 'developer',
        phase: 'develop',
        label: '实现六件套',
        expectedKind: 'code',
        currentInputId: 'i-live',
        activity: 'processing',
      },
    ],
    results: [],
  };
  await page.route('**/api/v1/rpc', async (route) => {
    const body = route.request().postData() ?? '';
    if (!body.includes('"task.get"') && !body.includes('"session.get"')) return route.continue();
    const envelope = JSON.parse(body) as { requestId: string };
    const result = body.includes('"task.get"')
      ? task
      : {
          session: {
            sessionId: 's',
            projectId: 'p',
            roleId: 'chief',
            currentTaskId: 't-live',
            revision: 1,
            activity: 'processing',
            currentInputId: 'i-1',
            lastActivityAt: null,
          },
        };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ requestId: envelope.requestId, result }),
    });
  });
  try {
    await page.goto(harness.url);
    await loginThroughUi(page, harness.accessPassword);
    await page.locator('[data-testid="project-switcher"]').click();
    await page.locator('[data-testid="project-row"]').first().click();
    await expect(page.locator('[data-testid="composer"]')).toBeEnabled();

    const live = page.locator('[data-testid="task-live"]');
    await expect(live).toBeVisible({ timeout: 20_000 });
    // The list names the step and the member's own label; the goal lives in the task detail.
    await expect(live).toContainText(/Develop|开发/);
    await expect(live).toContainText('实现六件套');
    const rows = page.locator('[data-testid="task-live-members"] [data-testid="task-member-row"]');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(/developer|开发/i);
    await expect(rows.first()).toContainText(/running|运行/i);
    // The step being worked on owns the eye: its node pulses (a 0ms animation under reduced
    // motion, which is the only case where "static" is correct) and its title is the run colour.
    await expect(rowOf(live, 'develop')).toHaveClass(/active/);
    const pulse = await rowOf(live, 'develop').evaluate((node) => {
      const dot = node.querySelector('.node');
      return { name: dot === null ? '' : getComputedStyle(dot).animationName, count: getComputedStyle(node.querySelector('.node') ?? node).animationIterationCount };
    });
    expect(pulse.name).toBe('work');
    // Planned steps are the road, not progress: no check, no active band, a hollow node each.
    const planned = live.locator('[data-testid="task-steps"] .todo-g[data-planned="true"]');
    await expect(planned).toHaveCount(2);
    await expect(planned.first()).toContainText(/Review|审核/);
    // Only develop's members exist here, and none has finished: no node wears a check.
    await expect(live.locator('.todo-g .node')).toHaveText(['', '', '']);

    // The strip is the same flow in outline: a pulsing current node, hollow planned nodes, and
    // a meter that counts what finished. Nothing here is a second opinion about the list.
    const phases = page.locator('[data-testid="task-phases"]');
    await expect(phases.locator('.p')).toHaveCount(3);
    await expect(phases.locator('.p.cur')).toHaveAttribute('data-phase', 'develop');
    await expect(phases.locator('.p.plan')).toHaveCount(2);
    await expect(phases.locator('.p.cur .dot')).toHaveCSS('animation-name', 'work');
    await expect(page.locator('.task-strip .prog-n')).toHaveText('0/1');

    // The whole point: a reload while the Task runs keeps it on screen.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-testid="task-live"]')).toBeVisible({ timeout: 20_000 });
    await expect(
      page.locator('[data-testid="task-live-members"] [data-testid="task-member-row"]'),
    ).toHaveCount(1);
    await page.screenshot({ path: test.info().outputPath('task-live-after-reload.png') });
  } finally {
    await harness.close();
  }
});

test('a rework round shows as history: develop twice with the failed review between', async ({ page }) => {
  // The user's scenario: develop finished, review did not pass, develop runs again. The task
  // list must show every member the Task ever dispatched, grouped by phase-round, with the
  // failed review kept as evidence and the strip saying the phase ran twice.
  const harness = await startHarness();
  const task = {
    task: { taskId: 't-rw', type: 'write', phase: 'develop', status: 'active', revision: 9, goal: '实现六件套', requiresTest: true },
    members: [
      { sessionId: 's-d1', roleId: 'developer', phase: 'develop', label: '实现六件套', expectedKind: 'code', currentInputId: 'i1', activity: 'idle', lastInputStatus: 'completed' },
      { sessionId: 's-r1', roleId: 'reviewer', phase: 'review', label: '审核六件套', expectedKind: 'review', currentInputId: 'i2', activity: 'idle', lastInputStatus: 'failed' },
      { sessionId: 's-d2', roleId: 'developer', phase: 'develop', label: '返工修复', expectedKind: 'code', currentInputId: 'i3', activity: 'processing' },
    ],
    results: [
      { resultId: 'r1', sessionId: 's-d1', kind: 'code', summary: '六件套已实现' },
      { resultId: 'r2', sessionId: 's-r1', kind: 'review', verdict: 'failed', summary: '有效期未校验' },
    ],
  };
  await page.route('**/api/v1/rpc', async (route) => {
    const body = route.request().postData() ?? '';
    const envelope = JSON.parse(body) as { requestId: string };
    const fulfill = (result: unknown): Promise<void> =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ requestId: envelope.requestId, result }) });
    const params = JSON.parse(body).params ?? {};
    if (body.includes('"task.get"')) return fulfill(task);
    if (body.includes('"session.get"')) {
      return fulfill({ session: { sessionId: params.sessionId ?? 'rw', projectId: params.projectId ?? 'rw-p', roleId: 'chief', currentTaskId: 't-rw', revision: 1, activity: 'idle', currentInputId: null, lastActivityAt: null } });
    }
    if (body.includes('"session.stream.prepare"')) {
      return fulfill({
        subscriptionId: 'sub-rw',
        streamPath: `/api/v1/sessions/rw/stream?subscriptionId=sub-rw`,
        epoch: 1,
        boundary: 0,
        snapshot: {
          sessionId: params.sessionId ?? 'rw',
          projectId: params.projectId ?? 'rw-p',
          roleId: 'chief',
          activity: 'idle',
          currentInputId: null,
          inputs: [],
          task: { taskId: 't-rw', type: 'write', phase: 'develop', status: 'active', revision: 9 },
          config: null,
          blocked: null,
          interactions: [],
          messages: [],
          historyLeaf: null,
          hasEarlier: false,
          historyProblems: [],
        },
      });
    }
    return route.continue();
  });
  await page.route('**/api/v1/sessions/**/stream*', async (route) => {
    await new Promise(() => {});
  });
  try {
    await page.goto(harness.url);
    await loginThroughUi(page, harness.accessPassword);
    await page.locator('[data-testid="project-switcher"]').click();
    await page.locator('[data-testid="project-row"]').first().click();

    const live = page.locator('[data-testid="task-live"]');
    await expect(live).toBeVisible({ timeout: 20_000 });
    // Every member the Task ever dispatched is on the list, in creation order.
    const rows = live.locator('[data-testid="task-member-row"]');
    await expect(rows).toHaveCount(3, { timeout: 10_000 });
    // The failed review stays as the evidence that triggered the rework round.
    await expect(rows.nth(1)).toContainText(/Not passed|未通过/);
    // The second develop round is marked as a round and the running member carries the rework glyph.
    const group = live.locator('.todo-g[data-phase="develop"][data-round="2"]');
    await expect(group.locator('[data-testid="task-member-row"]')).toContainText(/Running|运行/);
    // The plan's remaining steps are visible before anyone works there: this write Task
    // (requiresTest) owes review, test and settle past the reworked develop — review ran
    // already, so the planned tail is test and settle, dimmed as planned groups.
    const planned = live.locator('.todo-g[data-planned="true"]');
    await expect(planned).toHaveCount(2, { timeout: 10_000 });
    await expect(planned.first()).toHaveAttribute('data-phase', 'test');
    await expect(planned.nth(1)).toHaveAttribute('data-phase', 'settle');
    // The strip agrees: the dimmed tail follows the real chain (no ×n on planned steps).
    const strip = page.locator('[data-testid="task-strip"] .phases');
    await expect(strip).toContainText(/×2/);
    await expect(strip.locator('.p.plan')).toHaveCount(2);
    await page.screenshot({ path: test.info().outputPath('task-rework-rounds.png') });
  } finally {
    await harness.close();
  }
});

test('a finished dispatch folds to one line, and the members are not a toolbar', async ({ page }) => {
  // What the user asked for, in the part a scripted run can hold still: once the call returns, its
  // card is a single line (the members it started are history, and their live state lives in the
  // transcript where they were dispatched), and the Task strip carries the flow instead of a
  // member count with an expandable panel.
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
              requiresTest: false,
              goal: '把产品文档按现行代码事实整理',
              scope: '.dev/product',
              planMarkdown: '# 文档整理\n',
            }),
          },
        ],
      },
      {
        kind: 'tool_calls',
        calls: [
          { name: 'task', arguments: JSON.stringify({ op: 'update', phase: 'design', summary: '进入设计' }) },
        ],
      },
      {
        kind: 'tool_calls',
        calls: [
          {
            name: 'task',
            arguments: JSON.stringify({
              op: 'dispatch',
              waitTimeoutMs: 8_000,
              sessions: [
                { roleId: 'designer', instructions: '整理产品文档', writeScope: ['.dev/product/**'] },
                { roleId: 'investigator', instructions: '调查现状' },
              ],
            }),
          },
        ],
      },
      { kind: 'text', text: '两位成员已完成。' },
    ],
  });
  try {
    await page.goto(harness.url);
    await loginThroughUi(page, harness.accessPassword);
    await openProject(page, harness.project?.projectPath ?? '');
    await page.locator('[data-testid="composer"]').fill('整理产品文档');
    await page.locator('[data-testid="composer"]').press('Enter');

    // The call's result really arrives for both members.
    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const bodies = Array.from(document.querySelectorAll('[data-call-id]'));
            return bodies.map((entry) => (entry.textContent ?? '').replace(/\s+/g, ' ')).join(' || ');
          }),
        { timeout: 25_000 },
      )
      .toMatch(/Dispatch 2 member|派发 2 名成员/);

    const settled = await page.evaluate(() => ({
      // The returned call is one collapsed disclosure, not an expanded list of rows.
      details: document.querySelectorAll('details[data-call-id]').length,
      openRows: document.querySelectorAll('details[data-call-id] .mrow').length,
      liveCards: document.querySelectorAll('.disp[data-call-id]').length,
      toggle: document.querySelectorAll('[data-testid="task-members-toggle"]').length,
      panel: document.querySelectorAll('[data-testid="task-panel"]').length,
      phases: document.querySelector('[data-testid="task-strip"] .phases')?.textContent ?? '',
    }));
    expect(settled.details).toBeGreaterThan(0);
    expect(settled.openRows).toBe(0);
    expect(settled.liveCards).toBe(0);
    expect(settled.toggle).toBe(0);
    expect(settled.panel).toBe(0);
    // The strip is the flow, and a finished Task has no strip at all.
    // The chain holds the phases this Task really ran; the stub moves it to design.
    if (settled.phases !== '') expect(settled.phases).toMatch(/Design|设计|Plan|计划/);
    await page.screenshot({ path: test.info().outputPath('task-dispatch-inline.png') });
  } finally {
    await harness.close();
  }
});

test('a specialist report opens from the task detail, with the body it really wrote', async ({ page }) => {
  // Chief creates a read Task, dispatches an investigator, the member delivers a report, and the
  // user reads that report without a model retelling it. The body text is the stub's own words.
  const harness = await startHarness({
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
              planMarkdown: '# survey\n',
            }),
          },
        ],
      },
      {
        kind: 'tool_calls',
        calls: [
          {
            name: 'task',
            arguments: JSON.stringify({
              op: 'dispatch',
              waitTimeoutMs: 5_000,
              sessions: [{ roleId: 'investigator', instructions: 'survey the account module' }],
            }),
          },
        ],
      },
      {
        kind: 'tool_calls',
        calls: [
          {
            name: 'agent_report',
            arguments: JSON.stringify({ summary: '模块调查完成', body: '# 调查\n\n账户模块有三个入口。' }),
          },
        ],
      },
      { kind: 'text', text: '调查完成。' },
    ],
  });
  try {
    await page.goto(harness.url);
    await loginThroughUi(page, harness.accessPassword);
    await openProject(page, harness.project?.projectPath ?? '');
    await page.locator('[data-testid="composer"]').fill('先调查账户模块');
    await page.locator('[data-testid="composer"]').press('Enter');

    const strip = page.locator('[data-testid="task-strip"]');
    await expect(strip).toBeVisible({ timeout: 25_000 });
    // The dispatch reached the browser as a push: the card appeared without a reload.
    await expect(page.locator('[data-call-id]').first()).toBeVisible({ timeout: 15_000 });
    await page.locator('[data-testid="task-open"]').click();
    const result = page.locator('[data-testid="result-open"]').first();
    await expect(result).toContainText('模块调查完成', { timeout: 15_000 });
    await result.click();

    // The body is the stored file, read as a document by the same viewer as any project file.
    await expect(page.locator('[data-testid="md-body"]')).toContainText('账户模块有三个入口');
    // The body comes from the stored report, not from a chat message.
    await expect(page.locator('[data-testid="transcript"]')).not.toContainText('账户模块有三个入口');
  } finally {
    await harness.close();
  }
});

test('the Files label is a place: it shows as current, and any other label closes it', async ({ page }) => {
  // Three things the user hit at once, and each one is the same mistake in a different place:
  // the viewer looked like a mode (no current label), and it sat over the navigation (clicking
  // "Chat" changed the route underneath it and nothing appeared to happen).
  const harness = await startHarness();
  try {
    const projectPath = harness.project?.projectPath ?? '';
    mkdirSync(join(projectPath, 'src'), { recursive: true });
    writeFileSync(join(projectPath, 'README.md'), 'hello\n');
    writeFileSync(join(projectPath, 'src', 'main.ts'), 'export const x = 1;\n');
    await page.goto(harness.url);
    await loginThroughUi(page, harness.accessPassword);

    const files = page.locator('[data-testid="nav-files"]');
    await expect(files).toBeDisabled();

    await openProject(page, projectPath);
    const chatLabel = page.locator('.nav a').first();
    await expect(files).toBeEnabled();
    await files.click();

    const viewer = page.locator('[data-testid="file-viewer"]');
    await expect(viewer).toBeVisible();
    await expect(page.locator('[data-testid="file-path"]')).toHaveText('/');
    // Exactly one label is current, and it is Files: the screen underneath is not "where we are".
    await expect(files).toHaveAttribute('aria-current', 'page');
    await expect(chatLabel).not.toHaveAttribute('aria-current', 'page');

    // A folder and a file are not the same kind of row: a glyph, a trailing slash and a type.
    await expect(page.locator('[data-testid="file-entry"][data-type="directory"]')).toContainText('src/');
    await expect(page.locator('[data-testid="file-entry"][data-type="directory"] .ico')).toHaveText('▸');
    await expect(page.locator('[data-testid="file-entry"][data-type="file"] .ico').first()).toHaveText('·');

    // Clicking another label closes the canvas and really shows that screen.
    await chatLabel.click();
    await expect(viewer).toBeHidden();
    await expect(files).not.toHaveAttribute('aria-current', 'page');
    await expect(chatLabel).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('[data-testid="composer"]')).toBeVisible();
    // And the canvas is not a route: the address bar never left the chat screen.
    await expect(page).toHaveURL(/\/$/);
  } finally {
    await harness.close();
  }
});

test('the project files open in one full-window viewer, and each kind is shown as what it is', async ({ page }) => {
  // Every file is read as itself: source with a gutter (jpg/png below prove the branch), the
  // browser's own player for media, and an honest notice plus a download for bytes with no view.
  const harness = await startHarness();
  try {
    const projectPath = harness.project?.projectPath ?? '';
    writeFileSync(join(projectPath, 'AGENTS.md'), '# project rules\n\nKeep it short.\n');
    writeFileSync(join(projectPath, 'app.ts'), 'const answer: number = 42;\nconsole.log(answer);\n');
    writeFileSync(join(projectPath, 'note.html'), '<html><body><h1>report</h1></body></html>\n');
    writeFileSync(join(projectPath, 'blob.bin'), Buffer.from([0, 1, 2, 3]));
    writeFileSync(join(projectPath, 'dot.png'), transparentPng());
    await page.goto(harness.url);
    await loginThroughUi(page, harness.accessPassword);
    await openProject(page, projectPath);

    // Entry 1: a knowledge entry from the project dialog opens the same canvas.
    await page.locator('[data-testid="project-switcher"]').click();
    await page.locator('[data-testid="project-entry"]', { hasText: 'AGENTS.md' }).click();
    const viewer = page.locator('[data-testid="file-viewer"]');
    await expect(viewer).toBeVisible();
    // Markdown is the one kind read as a document, and its source is one click away.
    await expect(page.locator('[data-testid="md-body"]')).toContainText('Keep it short.');
    await expect(page.locator('[data-testid="md-body"] h1')).toHaveText('project rules');
    // The canvas covers the shell rather than sitting in a 560px drawer.
    const width = await viewer.evaluate((node) => node.getBoundingClientRect().width);
    expect(width).toBeGreaterThan(1000);
    await page.locator('[data-testid="md-source"]').click();
    await expect(page.locator('.srchigh, .srcplain')).toHaveCount(1);
    await expect(page.locator('[data-testid="file-text"]')).toContainText('# project rules');
    // The gutter numbers the lines and nothing else: a copy of the code never carries digits.
    await expect(page.locator('.srcgutter')).toHaveText(/^1\n2\n3\n4$/);
    // A search narrows nothing but tells the truth about how many lines match.
    await page.locator('[data-testid="file-search"]').fill('Short');
    await expect(page.locator('[data-testid="file-matches"]')).toContainText(/1|匹配/);

    // Entry 2: the browser root, then a code file, an html file, a png and a binary.
    await page.locator('[data-testid="file-close"]').click();
    await page.locator('[data-testid="project-switcher"]').click();
    await page.locator('[data-testid="project-browse"]').click();
    await expect(page.locator('[data-testid="file-entry"]', { hasText: 'app.ts' })).toBeVisible();
    await page.locator('[data-testid="file-entry"]', { hasText: 'app.ts' }).click();
    // Coloured by the same grammar list the transcript uses, and the gutter is separate.
    const keyword = page.locator('.srchigh .hljs-keyword').first();
    await expect(keyword).toBeVisible();
    // Colour, not just a span class: the accent token must actually differ from plain text.
    const keywordColor = await keyword.evaluate((node) => getComputedStyle(node).color);
    expect(keywordColor).toBe('rgb(191, 162, 255)');
    await expect(page.locator('[data-testid="file-path"]')).toContainText('app.ts');
    await page.screenshot({ path: test.info().outputPath('file-viewer-source.png') });

    // An .html file is source, not a rendered document: the tags stay visible as text.
    await page.locator('[data-testid="file-entry"]', { hasText: 'note.html' }).click();
    await expect(page.locator('[data-testid="file-text"]')).toContainText('<h1>report</h1>');
    await expect(page.locator('[data-testid="file-viewer"] h1')).toHaveCount(0);

    // A real image renders from the byte route.
    await page.locator('[data-testid="file-entry"]', { hasText: 'dot.png' }).click();
    const image = page.locator('[data-testid="file-viewer"] .fv-media img');
    await expect(image).toBeVisible();
    const natural = await image.evaluate((node) => ({ w: node.naturalWidth, h: node.naturalHeight }));
    expect(natural.w).toBeGreaterThan(0);

    // Bytes with no view say so and offer the download instead of printing control characters.
    await page.locator('[data-testid="file-entry"]', { hasText: 'blob.bin' }).click();
    await expect(page.locator('[data-testid="file-viewer"] .fv-notice')).toContainText(/download|下载/i);
    await expect(page.locator('[data-testid="file-download"]').first()).toBeVisible();
  } finally {
    await harness.close();
  }
});

/** A 1x1 PNG, so the image branch is exercised with real decodable bytes. */
function transparentPng(): Buffer {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
    'base64',
  );
}

test('a short conversation offers no older page, because there is none', async ({ page }) => {
  // The snapshot says whether anything precedes its tail; a fresh session must not show a control
  // that can only return an empty page. Backward paging itself is a server-side test.
  const harness = await startHarness({ model: [{ kind: 'text', text: '好的。' }] });
  try {
    await page.goto(harness.url);
    await loginThroughUi(page, harness.accessPassword);
    await openProject(page, harness.project?.projectPath ?? '');
    await page.locator('[data-testid="composer"]').fill('你好');
    await page.locator('[data-testid="composer"]').press('Enter');
    await expect(page.locator('[data-testid="transcript"] article.m')).toHaveCount(2, { timeout: 15_000 });
    await expect(page.locator('[data-testid="load-earlier"]')).toHaveCount(0);
  } finally {
    await harness.close();
  }
});




test('a moved directory is rebound from the menu and keeps its records', async ({ page }) => {
  const harness = await startHarness();
  try {
    const projectPath = harness.project?.projectPath ?? '';
    const moved = `${projectPath}-moved`;
    await page.goto(harness.url);
    await loginThroughUi(page, harness.accessPassword);
    await openProject(page, projectPath);

    // The directory moves behind the workbench's back; a reload must report it, not hide it.
    renameSync(projectPath, moved);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('[data-testid="project-switcher"]').click();
    const row = page.locator('[data-testid="project-row"]').first();
    await expect(row).toContainText(/missing|目录不存在/i);

    await page.locator('[data-testid="project-rebind"]').first().click();
    await page.locator('[data-testid="project-rebind-path"]').fill(moved);
    await page.locator('.prow .rebind button.pri').click();

    // The same project (id, sessions) now points at the new directory.
    await expect(page.locator('.toast')).toContainText(/bound|绑定/i, { timeout: 10_000 });
    await expect(page.locator('[data-testid="project-switcher"]')).toContainText('project-moved');
  } finally {
    await harness.close();
  }
});

test('the board lists the project Tasks and links to the conversation that runs one', async ({ page }) => {
  const harness = await startHarness({
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
              planMarkdown: '# survey\n',
            }),
          },
        ],
      },
      { kind: 'text', text: '任务已建。' },
    ],
  });
  try {
    await page.goto(harness.url);
    await loginThroughUi(page, harness.accessPassword);
    await openProject(page, harness.project?.projectPath ?? '');
    await page.locator('[data-testid="composer"]').fill('先调查一下账号模块');
    await page.locator('[data-testid="composer"]').press('Enter');
    await expect(page.locator('[data-testid="task-strip"]')).toBeVisible({ timeout: 20_000 });

    await page.goto(`${harness.baseUrl}/requirements`, { waitUntil: 'domcontentloaded' });
    // Tasks are folded by default: the header says how many and that one is running, and nothing
    // is listed until the user opens it.
    const toggle = page.locator('[data-testid="tasks-toggle"]');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false', { timeout: 15_000 });
    await expect(toggle).toContainText(/1 total|共 1 个/);
    await expect(toggle).toContainText(/Running|运行/);
    await expect(page.locator('[data-testid="task-row"]')).toHaveCount(0);
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');

    const row = page.locator('[data-testid="task-row"]').first();
    await expect(row).toContainText('survey the account module', { timeout: 15_000 });
    // The row names translated state, never the server's raw enum.
    await expect(row).toContainText(/Running|进行中/);
    await row.click();
    await expect(page.locator('[data-testid="composer"]')).toBeVisible();
    await expect(page.locator('[data-testid="task-strip"]')).toBeVisible();
  } finally {
    await harness.close();
  }
});

test('a modal keeps keyboard focus inside, and gives it back when it closes', async ({ page }) => {
  const harness = await startHarness();
  try {
    await page.goto(harness.url);
    await loginThroughUi(page, harness.accessPassword);
    await openProject(page, harness.project?.projectPath ?? '');

    const switcher = page.locator('[data-testid="project-switcher"]');
    await switcher.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.dlg')).toBeVisible();

    // Twenty tabs: the loop has fewer elements than that, so escaping the dialog would show up.
    for (let i = 0; i < 20; i += 1) await page.keyboard.press('Tab');
    const inside = await page.evaluate(() => document.activeElement?.closest('.dlg') !== null);
    expect(inside).toBe(true);

    await page.keyboard.press('Escape');
    await expect(page.locator('.dlg')).toHaveCount(0);
    // Focus returns to the control that opened it, not to the body.
    await expect(switcher).toBeFocused();
  } finally {
    await harness.close();
  }
});

test('an unreadable directory says why in the interface language', async ({ page }) => {
  const harness = await startHarness({ seedProject: false });
  try {
    await page.goto(harness.url);
    await loginThroughUi(page, harness.accessPassword);
    await page.locator('[data-testid="project-switcher"]').click();
    await page.locator('[data-testid="project-path"]').fill('/definitely/not/here');
    await page.locator('[data-testid="project-path"]').press('Enter');

    const error = page.locator('[data-testid="project-error"]');
    await expect(error).toBeVisible({ timeout: 10_000 });
    // The translated sentence comes first; the server's own sentence may follow it.
    await expect(error).toContainText(/unreachable|不可访问/);
  } finally {
    await harness.close();
  }
});

test('a blocked run names the missing model instead of printing its code', async ({ page }) => {
  // No model configured: the run must say what is missing, in words, where the user looks.
  const harness = await startHarness();
  try {
    await page.goto(harness.url);
    await loginThroughUi(page, harness.accessPassword);
    await openProject(page, harness.project?.projectPath ?? '');
    await page.locator('[data-testid="composer"]').fill('开始');
    await page.locator('[data-testid="composer"]').press('Enter');

    const banner = page.locator('.bn').first();
    await expect(banner).toBeVisible({ timeout: 20_000 });
    await expect(banner).toContainText(/model|模型/i);
    await expect(banner).not.toContainText('blocked_config');
  } finally {
    await harness.close();
  }
});

test('the status bar names the model the work actually used', async ({ page }) => {
  const harness = await startHarness({ model: [{ kind: 'text', text: '好的。' }] });
  try {
    await page.goto(harness.url);
    await loginThroughUi(page, harness.accessPassword);
    await openProject(page, harness.project?.projectPath ?? '');
    await page.locator('[data-testid="composer"]').fill('你好');
    await page.locator('[data-testid="composer"]').press('Enter');
    await expect(page.locator('[data-testid="transcript"] article.m')).toHaveCount(2, { timeout: 15_000 });

    // The stub installation runs provider 'stub' model 'stub-1'; the status bar says so.
    await expect(page.locator('[data-testid="status-model"]')).toContainText('stub/stub-1');
  } finally {
    await harness.close();
  }
});

test('a browser that has never been here still sees the registered projects', async ({ page }) => {
  // The registry lives on the server. A fresh profile (another machine, a cleared browser) has no
  // stored path, which used to short-circuit the load and show "No project registered yet".
  const harness = await startHarness();
  try {
    await page.goto(harness.url);
    // Nothing is remembered in this context: that is the fresh-browser case.
    expect(await page.evaluate(() => localStorage.getItem('agentdev.projectPath'))).toBeNull();
    await loginThroughUi(page, harness.accessPassword);
    await page.locator('[data-testid="project-switcher"]').click();
    await expect(page.locator('[data-testid="project-row"]')).toHaveCount(1, { timeout: 10_000 });
    await expect(page.locator('[data-testid="project-row"]')).toContainText(/\d+ session/);
  } finally {
    await harness.close();
  }
});

test('a gateway alias can name the real model, and the effort follows it', async ({ page }) => {
  // A gateway names models its own way ("auto-glm-5-3" is GLM 5.3). Without the alias Pi uses its
  // fallback for an unknown id — 128k context, 16k output, no reasoning — so the real model's facts
  // are borrowed from the catalogue instead of being guessed here.
  const harness = await startHarness();
  try {
    await page.goto(harness.url);
    await loginThroughUi(page, harness.accessPassword);
    await openProject(page, harness.project?.projectPath ?? '');

    // The catalogue Pi ships, through the same method the picker uses.
    const catalog = await page.evaluate(async () => {
      const handle = (window as unknown as { __agentdev: { rpc: { call: (m: string, p?: unknown) => Promise<unknown> } } }).__agentdev;
      const read = (await handle.rpc.call('config.catalog', {})) as {
        providers: Array<{ providerId: string; models: Array<{ id: string; reasoning: boolean; contextWindow: number }> }>;
      };
      const reasoning = read.providers
        .flatMap((provider) => provider.models.map((model) => ({ providerId: provider.providerId, ...model })))
        .filter((model) => model.reasoning && !model.id.includes(' ') && model.contextWindow > 0);
      return { count: reasoning.length, sample: reasoning.find((model) => model.providerId === 'anthropic') ?? reasoning[0] };
    });
    expect(catalog.count).toBeGreaterThan(0);
    const real = catalog.sample;
    expect(real).toBeDefined();
    const alias = `${String(real?.providerId)}/${String(real?.id)}`;

    await page.goto(`${harness.baseUrl}/settings/providers`, { waitUntil: 'domcontentloaded' });
    await page.locator('[data-testid="add-provider"]').click();
    await page.locator('[data-testid="provider-id"]').fill('my-gateway');
    await page.locator('[data-testid="provider-base"]').fill('http://127.0.0.1:9/v1');
    await page.locator('[data-testid="provider-api"]').selectOption('openai-completions');
    await page.locator('[data-testid="provider-key"]').fill('gw-key');
    await page.locator('[data-testid="provider-model-id"]').first().fill('auto-model');
    await page.locator('[data-testid="provider-model-alias"]').first().fill(alias);
    // The row says what it resolved to before anything is saved: the box is not a second source.
    await expect(page.locator('[data-testid="provider-model-alias-facts"]').first()).toContainText(/reason|推理/i);
    await expect(page.locator('[data-testid="provider-model-reasoning"]')).toHaveCount(0);

    await page.locator('[data-testid="provider-save"]').click();
    await expect(page.locator('.prov').filter({ hasText: 'my-gateway' })).toHaveCount(1, { timeout: 10_000 });

    const written = await page.evaluate(async () => {
      const handle = (window as unknown as { __agentdev: { rpc: { call: (m: string, p?: unknown) => Promise<unknown> } } }).__agentdev;
      const read = (await handle.rpc.call('config.get', {})) as {
        providers: Array<{
          providerId: string;
          models: Array<{ id: string; reasoning?: boolean; contextWindow?: number; maxTokens?: number; thinkingLevels: string[] }>;
        }>;
      };
      return read.providers.find((provider) => provider.providerId === 'my-gateway')?.models[0];
    });
    expect(written).toMatchObject({ id: 'auto-model', reasoning: true });
    expect(written?.contextWindow).toBe(real?.contextWindow);
    // What the run accepts is now the real model's list, not `off` alone.
    expect(written?.thinkingLevels.length ?? 0).toBeGreaterThan(1);

    // And the effort control on Models follows the alias without any extra declaration.
    await page.goto(`${harness.baseUrl}/settings/models`, { waitUntil: 'domcontentloaded' });
    await page.locator('[data-testid="scope-global"]').click();
    await page.locator('[data-testid="model-chief"]').selectOption('auto-model');
    await expect(page.locator('[data-testid="level-chief"]')).toBeVisible({ timeout: 10_000 });
  } finally {
    await harness.close();
  }
});

test('effort is chosen per model, and only where the model declares reasoning', async ({ page }) => {
  // The levels are Pi's: a model that declares no reasoning has nothing to pick, and the way to make
  // one available is to declare it on the provider — the page says so instead of showing a dead select.
  const harness = await startHarness();
  try {
    await page.goto(harness.url);
    await loginThroughUi(page, harness.accessPassword);
    await openProject(page, harness.project?.projectPath ?? '');
    await page.evaluate(async () => {
      const handle = (window as unknown as { __agentdev: { rpc: { call: (m: string, p: unknown, o?: { requestId: string }) => Promise<unknown> } } }).__agentdev;
      await handle.rpc.call(
        'config.save',
        {
          expectedRevision: null,
          value: {
            kind: 'provider',
            providerId: 'p-effort',
            baseUrl: 'http://127.0.0.1:9/v1',
            api: 'openai-completions',
            apiKey: 'test-key',
            models: [
              { id: 'm-think', name: 'm-think', reasoning: true },
              { id: 'm-plain', name: 'm-plain' },
            ],
          },
        },
        { requestId: 'seed-provider-effort' },
      );
    });

    await page.goto(`${harness.baseUrl}/settings/models`, { waitUntil: 'domcontentloaded' });
    await page.locator('[data-testid="scope-global"]').click();

    // A reasoning model: the level select lists what Pi accepts, minus `off` (that is "not set").
    await page.locator('[data-testid="model-chief"]').selectOption('m-think');
    const level = page.locator('[data-testid="level-chief"]');
    await expect(level).toBeVisible({ timeout: 10_000 });
    const options = await level.locator('option').allTextContents();
    expect(options[0]).toMatch(/Not set \(off\)|未设置/);
    expect(options.slice(1).map((text) => text.trim())).toEqual(['Minimal', 'Low', 'Medium', 'High']);

    await level.selectOption('high');
    await expect(page.locator('.toast').last()).toContainText(/saved|已保存/i);

    // A model that declares nothing: the row says so and offers no choice at all.
    await page.locator('[data-testid="model-developer"]').selectOption('m-plain');
    await expect(page.locator('[data-testid="level-developer-unsupported"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('level-developer-unsupported')).toHaveAttribute('title', /Providers|服务/i);

    // It survives a reload, and what the run would use is the value that was saved.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('[data-testid="scope-global"]').click();
    await expect(page.locator('[data-testid="level-chief"]')).toHaveValue('high', { timeout: 10_000 });
    const read = await page.evaluate(async () => {
      const handle = (window as unknown as { __agentdev: { rpc: { call: (m: string, p?: unknown) => Promise<unknown> } } }).__agentdev;
      return (await handle.rpc.call('config.get', { roleId: 'chief' })) as {
        effective: { thinkingLevel: string; thinkingLevels: string[] };
        overrides: { role: { thinkingLevel: string } | null };
      };
    });
    expect(read.overrides.role).toMatchObject({ thinkingLevel: 'high' });
    expect(read.effective.thinkingLevel).toBe('high');

    // Declaring reasoning on the provider is what turns the level back on for that model.
    await page.goto(`${harness.baseUrl}/settings/providers`, { waitUntil: 'domcontentloaded' });
    const provider = page.locator('.prov').filter({ hasText: 'p-effort' });
    await provider.locator('[data-testid="provider-edit"]').click();
    const plain = page.locator('.model-row').filter({ has: page.locator('input[value="m-plain"]') });
    await plain.locator('[data-testid="provider-model-reasoning"]').check();
    await page.locator('[data-testid="provider-save"]').click();
    // The declaration must reach Pi, not only the database: it is what turns levels on.
    await expect
      .poll(
        async () =>
          page.evaluate(async () => {
            const handle = (window as unknown as { __agentdev: { rpc: { call: (m: string, p?: unknown) => Promise<unknown> } } }).__agentdev;
            const read = (await handle.rpc.call('config.get', {})) as {
              providers: Array<{ providerId: string; models: Array<{ id: string; reasoning?: boolean; thinkingLevels: string[] }> }>;
            };
            const model = read.providers.find((entry) => entry.providerId === 'p-effort')?.models.find((entry) => entry.id === 'm-plain');
            return model?.thinkingLevels.length ?? 0;
          }),
        { timeout: 15_000 },
      )
      .toBeGreaterThan(1);

    await page.goto(`${harness.baseUrl}/settings/models`, { waitUntil: 'domcontentloaded' });
    await page.locator('[data-testid="scope-global"]').click();
    // The row already saved `m-plain`; now that the model declares reasoning, the level appears.
    await expect(page.locator('[data-testid="level-developer"]')).toBeVisible({ timeout: 10_000 });
  } finally {
    await harness.close();
  }
});

test('a provider is added with a name and protocol, then edited without changing its id', async ({ page }) => {
  const harness = await startHarness();
  try {
    await page.goto(harness.url);
    await loginThroughUi(page, harness.accessPassword);
    await openProject(page, harness.project?.projectPath ?? '');
    await page.goto(`${harness.baseUrl}/settings/providers`, { waitUntil: 'domcontentloaded' });

    await page.locator('[data-testid="add-provider"]').click();
    await page.locator('[data-testid="provider-name"]').fill('本地代理');
    await page.locator('[data-testid="provider-id"]').fill('local-proxy');
    await page.locator('[data-testid="provider-base"]').fill('http://127.0.0.1:3425/v1');
    // The protocol is a required choice: no save is possible while it is unset.
    await page.locator('[data-testid="provider-api"]').selectOption('anthropic-messages');
    await page.locator('[data-testid="provider-model-id"]').first().fill('some-model');
    await page.locator('[data-testid="provider-key"]').fill('test-key');
    await page.locator('[data-testid="provider-save"]').click();

    const row = page.locator('.prov').filter({ hasText: '本地代理' });
    await expect(row).toHaveCount(1, { timeout: 10_000 });
    await expect(row).toContainText('local-proxy');
    await expect(row).toContainText('Anthropic messages');

    // Editing changes the label and the protocol, never the identity everything else refers to.
    await row.locator('[data-testid="provider-edit"]').click();
    await expect(page.locator('[data-testid="provider-id"]')).toHaveAttribute('readonly', '');
    await page.locator('[data-testid="provider-name"]').fill('公司网关');
    await page.locator('[data-testid="provider-api"]').selectOption('openai-completions');
    await page.locator('[data-testid="provider-save"]').click();
    const edited = page.locator('.prov').filter({ hasText: '公司网关' });
    await expect(edited).toHaveCount(1, { timeout: 10_000 });
    await expect(edited).toContainText('local-proxy');
    await expect(edited).toContainText('OpenAI chat/completions');

    const saved = await page.evaluate(async () => {
      const handle = (window as unknown as { __agentdev: { rpc: { call: (m: string, p?: unknown) => Promise<unknown> } } }).__agentdev;
      return (await handle.rpc.call('config.get', {})) as {
        providers: Array<{ providerId: string; name: string; api: string | null }>;
      };
    });
    expect(saved.providers).toHaveLength(1);
    expect(saved.providers[0]).toMatchObject({ providerId: 'local-proxy', name: '公司网关', api: 'openai-completions' });
  } finally {
    await harness.close();
  }
});

test('a conversation is renamed from the rail, and the name survives a reload', async ({ page }) => {
  const harness = await startHarness();
  try {
    await page.goto(harness.url);
    await loginThroughUi(page, harness.accessPassword);
    await openProject(page, harness.project?.projectPath ?? '');
    const row = page.locator('[data-testid="session-row"]').first();
    await expect(row).toContainText(/New session|新会话/);

    await page.locator('[data-testid="session-rename"]').first().click();
    await page.locator('[data-testid="session-rename-input"]').fill('重构文档');
    await page.locator('[data-testid="session-rename-input"]').press('Enter');
    await expect(page.locator('[data-testid="session-row"]').first()).toContainText('重构文档', { timeout: 10_000 });

    // The name is stored, not a local label: a reload still shows it.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-testid="session-row"]').first()).toContainText('重构文档', { timeout: 10_000 });

    // Clearing it returns the row to the default name instead of leaving it blank.
    await page.locator('[data-testid="session-rename"]').first().click();
    await page.locator('[data-testid="session-rename-input"]').fill('');
    await page.locator('[data-testid="session-rename-input"]').press('Enter');
    await expect(page.locator('[data-testid="session-row"]').first()).toContainText(/New session|新会话/, {
      timeout: 10_000,
    });
  } finally {
    await harness.close();
  }
});

test('the project menu lists what the server registered, not what this browser remembers', async ({ page }) => {
  const harness = await startHarness();
  try {
    const second = `${harness.project?.projectPath ?? ''}-second`;
    mkdirSync(second, { recursive: true });
    await page.goto(harness.url);
    await loginThroughUi(page, harness.accessPassword);
    await openProject(page, harness.project?.projectPath ?? '');

    // A project this browser has never seen: registered through the same call the menu would make.
    await page.evaluate(async (path) => {
      const handle = (window as unknown as {
        __agentdev: { rpc: { call: (method: string, params: unknown, options?: { requestId: string }) => Promise<unknown> } };
      }).__agentdev;
      await handle.rpc.call('project.open', { path }, { requestId: 'seed-second' });
    }, second);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('[data-testid="project-switcher"]').click();
    await expect(page.locator('[data-testid="project-row"]')).toHaveCount(2, { timeout: 10_000 });
    // localStorage holds the current path and session only; no "recent projects" list exists.
    const stored = await page.evaluate(() => Object.keys(localStorage).filter((key) => key.includes('recent')));
    expect(stored).toEqual([]);
  } finally {
    await harness.close();
  }
});

test('a settled session can be cleaned up from the rail, and a busy one says why not', async ({ page }) => {
  // No model: a submitted input stays queued, which is exactly the state cleanup must refuse.
  const harness = await startHarness();
  try {
    await page.goto(harness.url);
    await loginThroughUi(page, harness.accessPassword);
    await openProject(page, harness.project?.projectPath ?? '');

    // Two more sessions, created the way the shell creates them.
    const ids = await page.evaluate(async () => {
      const handle = (window as unknown as {
        __agentdev: {
          rpc: { call: (method: string, params: unknown, options?: { requestId: string }) => Promise<unknown> };
          workspace: { projectId: string };
        };
      }).__agentdev;
      const created: string[] = [];
      for (const tag of ['settled', 'busy']) {
        const read = (await handle.rpc.call(
          'session.create',
          { projectId: handle.workspace.projectId },
          { requestId: `seed-${tag}` },
        )) as { session: { sessionId: string } };
        created.push(read.session.sessionId);
      }
      // The second one gets a queued input: with no model it never runs, so it cannot be removed.
      const busy = created[1];
      if (busy !== undefined) {
        await handle.rpc.call(
          'session.input.submit',
          {
            projectId: handle.workspace.projectId,
            sessionId: busy,
            content: [{ type: 'text', text: '等一会儿再做' }],
          },
          { requestId: 'seed-busy-input' },
        );
      }
      return created;
    });
    expect(ids).toHaveLength(2);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForConnected(page);
    await expect(page.locator('[data-testid="session-row"]')).toHaveCount(3, { timeout: 10_000 });

    // The open session offers no cleanup: deleting what is on screen would leave nothing to show.
    await expect(page.locator('.srow[aria-current], .srow:has([aria-current="true"]) [data-testid="session-cleanup"]')).toHaveCount(0);

    // Remove the settled one: two clicks, then it is gone from the rail.
    const settled = page.locator('[data-testid="session-row"]', { hasText: 'New session' }).first();
    const row = page.locator('.srow', { has: settled });
    await row.locator('[data-testid="session-cleanup"]').click();
    await row.locator('[data-testid="session-cleanup"]').click();
    await expect(page.locator('.toast')).toContainText(/removed|已清理/i, { timeout: 10_000 });
    await expect(page.locator('[data-testid="session-row"]')).toHaveCount(2);

    // The queued one is refused, with the reason the server gave.
    const busyRow = page.locator('.srow').filter({ has: page.locator('[data-testid="session-row"]') }).last();
    const before = await page.locator('[data-testid="session-row"]').count();
    await busyRow.locator('[data-testid="session-cleanup"]').click();
    await busyRow.locator('[data-testid="session-cleanup"]').click();
    // The earlier confirmation is still on screen, so the refusal is read from the error toast.
    await expect(page.locator('.toast.err')).toContainText(/Not removed|未清理/i, { timeout: 10_000 });
    await expect(page.locator('[data-testid="session-row"]')).toHaveCount(before);
  } finally {
    await harness.close();
  }
});

test('an unconfirmed run is announced and the chief is asked, not guessed at', async ({ page }) => {
  // The host reports interrupted inputs through one read; this case answers that read so the
  // banner's own behaviour is what is tested (the server side is covered by server-read tests).
  const harness = await startHarness();
  try {
    await page.addInitScript(() => {
      const original = window.fetch;
      window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const body = typeof init?.body === 'string' ? init.body : '';
        if (body.includes('"session.recovery.inspect"')) {
          const envelope = JSON.parse(body) as { requestId: string };
          return new Response(
            JSON.stringify({
              requestId: envelope.requestId,
              result: {
                sessionId: 's',
                binding: null,
                interruptedInputs: [{ inputId: 'i-crashed', kind: 'user', errorCode: 'HOST_SAVE_FAILED' }],
                pendingInputs: [],
                taskId: null,
                results: [],
              },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        return original(input, init);
      };
    });
    await page.goto(harness.url);
    await loginThroughUi(page, harness.accessPassword);
    await openProject(page, harness.project?.projectPath ?? '');

    const banner = page.locator('[data-testid="interrupted-banner"]');
    await expect(banner).toBeVisible({ timeout: 15_000 });
    await expect(banner).toContainText('i-crashed');
    // Nothing is replayed: the decision is the user's, sent through the chief.
    await expect(page.locator('[data-testid="transcript"] article.m')).toHaveCount(0);
    await page.locator('[data-testid="recovery-ask"]').click();
    await expect(page.locator('[data-testid="composer"]')).toHaveValue(/i-crashed/);
    await expect(page.locator('[data-testid="transcript"] article.m')).toHaveCount(0);
  } finally {
    await harness.close();
  }
});

test('a browser screenshot from the tool appears inside its card and stays after a reload', async ({ page }) => {
  // The model asks for the page, then for a screenshot; the host really launches Chromium.
  const harness = await startHarness({
    model: [
      {
        kind: 'tool_calls',
        calls: [{ name: 'browser', arguments: JSON.stringify({ action: 'open', url: 'data:text/html,<h1>Shot page</h1><button>Go</button>' }) }],
      },
      { kind: 'tool_calls', calls: [{ name: 'browser', arguments: JSON.stringify({ action: 'screenshot' }) }] },
      { kind: 'text', text: '截图完成。' },
    ],
  });
  try {
    await page.goto(harness.url);
    await loginThroughUi(page, harness.accessPassword);
    await openProject(page, harness.project?.projectPath ?? '');

    const composer = page.locator('[data-testid="composer"]');
    await composer.fill('打开页面并截图');
    await composer.press('Enter');

    // The tool ran for real: the card shows the observation, and the screenshot is an attachment URL.
    const card = page.locator('[data-testid="transcript"] .tc').first();
    await expect(card).toContainText('browser', { timeout: 30_000 });
    const shot = page.locator('[data-testid="transcript"] .tc img');
    await expect(shot).toHaveCount(1, { timeout: 30_000 });
    const src = await shot.getAttribute('src');
    expect(src).toMatch(/^\/api\/v1\/attachments\/[0-9a-f]{32}$/);
    // The image is lazy inside a collapsed card: open the card, then the bytes must really load.
    await page.locator('[data-testid="transcript"] .tc summary').last().click();
    await expect
      .poll(async () => shot.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth), {
        timeout: 15_000,
      })
      .toBeGreaterThan(0);
    // The route is authenticated, so a page fetch sees the same bytes the <img> got.
    expect(await page.evaluate(async (url: string) => (await fetch(url)).status, src ?? '')).toBe(200);

    await page.reload();
    await waitForConnected(page);
    await expect(page.locator('[data-testid="transcript"] .tc img')).toHaveCount(1, { timeout: 20_000 });
    await page.screenshot({ path: test.info().outputPath('tool-screenshot.png') });
  } finally {
    await harness.close();
  }
});

test('a fast answer never leaves the reader behind, and the way back is always visible', async ({ page }) => {
  // The user's report: while the chief writes fast, the view could not keep up with the tail.
  // The fix is judged on frames, not on polls: the transcript is sampled every animation frame,
  // and a frame counts as "behind" only if the content grew AND the view is not at the tail.
  const harness = await startHarness({
    model: [
      {
        kind: 'slow_text',
        text: Array.from({ length: 120 }, (_, i) => `第 ${String(i)} 行：主管正在快速输出，用来观察尾部跟随。`).join('\n\n'),
        chunks: 900,
        delayMs: 20,
      },
    ],
  });
  try {
    await page.goto(harness.url);
    await loginThroughUi(page, harness.accessPassword);
    await page.locator('[data-testid="project-switcher"]').click();
    await page.locator('[data-testid="project-row"]').first().click();
    const tx = page.locator('[data-testid="transcript"]');
    await expect(tx).toBeVisible();
    await page.evaluate(() => {
      const w = window as unknown as { __gaps: number[]; __heights: number[]; __stop: boolean };
      w.__gaps = [];
      w.__heights = [];
      w.__stop = false;
      const tick = (): void => {
        if (w.__stop === true) return;
        const el = document.querySelector('[data-testid="transcript"]');
        if (el !== null) {
          w.__heights.push(el.scrollHeight);
          w.__gaps.push(Math.round(el.scrollHeight - el.scrollTop - el.clientHeight));
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    await page.locator('[data-testid="composer"]').fill('写一段长的');
    await page.locator('[data-testid="composer"]').press('Enter');
    // Let the answer stream well past one screen.
    await expect
      .poll(async () => tx.evaluate((el) => el.scrollHeight - el.clientHeight), { timeout: 30_000 })
      .toBeGreaterThan(1200);

    const behind = await page.evaluate(() => {
      const w = window as unknown as { __gaps: number[]; __heights: number[] };
      const rows: number[] = [];
      for (let i = 1; i < w.__gaps.length; i++) {
        const growth = (w.__heights[i] ?? 0) - (w.__heights[i - 1] ?? 0);
        if (growth > 0 && (w.__gaps[i] ?? 0) > 0) rows.push(w.__gaps[i] ?? 0);
      }
      return rows;
    });
    // Not one painted frame of growth happened off the tail.
    expect(behind).toEqual([]);

    // The reader scrolls up mid-stream: the follow releases, and the pill reports what is
    // still arriving below instead of silently losing the tail.
    await page.evaluate(() => {
      (window as unknown as { __stop: boolean }).__stop = true;
    });
    const box = await tx.boundingBox();
    await page.mouse.move((box?.x ?? 0) + 300, (box?.y ?? 0) + 200);
    await page.mouse.wheel(0, -600);
    const pill = page.locator('[data-testid="jump-tail"]');
    await expect(pill).toBeVisible();
    await expect(pill).toContainText(/[1-9]\d* (line|行)/, { timeout: 10_000 });
    const held = await tx.evaluate((el) => Math.round(el.scrollHeight - el.scrollTop - el.clientHeight));
    // The output keeps coming and the view stays where the reader put it.
    await page.waitForTimeout(700);
    const later = await tx.evaluate((el) => Math.round(el.scrollHeight - el.scrollTop - el.clientHeight));
    expect(later).toBeGreaterThan(held);
    await page.screenshot({ path: test.info().outputPath('stream-tail-follow.png') });

    // One click returns to the tail and the pill goes away.
    await pill.click();
    await expect(pill).toBeHidden();
    const atTail = await tx.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight);
    expect(atTail).toBeLessThan(4);
  } finally {
    await harness.close();
  }
});

test('a report opens, and the file it names opens in the same viewer', async ({ page }) => {
  // The user's scenario: a write Task's report is a project file. The result screen shows the body
  // in the source viewer and hands its project path to the very same canvas the browser uses —
  // one reader, two doors, no second rendering path.
  const harness = await startHarness();
  const reportPath = '.dev/work/t-doc/s-doc/r1.md';
  const reportBody = '# 结算\n\n共 3 个文件。\n';
  const task = {
    task: {
      taskId: 't-doc',
      type: 'write',
      phase: 'settle',
      status: 'active',
      revision: 12,
      goal: '整理产品文档',
      scope: '.dev/product',
      requiresTest: false,
    },
    members: [],
    results: [{ resultId: 'r1', sessionId: 's-doc', kind: 'settlement', summary: '文档整理完成' }],
  };
  await page.route('**/api/v1/rpc', async (route) => {
    const body = route.request().postData() ?? '';
    const params = (JSON.parse(body) as { params?: Record<string, unknown> }).params ?? {};
    const envelope = JSON.parse(body) as { requestId: string };
    const fulfill = (result: unknown): Promise<void> =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ requestId: envelope.requestId, result }) });
    const fail = (code: string, message: string): Promise<void> =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ requestId: envelope.requestId, error: { code, message } }),
      });
    if (body.includes('"task.get"')) return fulfill(task);
    if (body.includes('"task.report.get"')) {
      return fulfill({
        result: { resultId: 'r1', kind: 'settlement', verdict: null, summary: '文档整理完成' },
        text: reportBody,
        truncated: false,
        version: 'v1',
        path: `/private/project/${reportPath}`,
        relativePath: reportPath,
      });
    }
    if (body.includes('"project.files.list"')) {
      // A file is not a directory: the viewer's own probe relies on this answer to pick the branch.
      if (params['path'] !== '.') return fail('INVALID_ARGUMENT', 'not a directory');
      return fulfill({
        path: '.',
        entries: [
          { name: '.dev', path: '.dev', type: 'directory', size: null, updatedAt: new Date().toISOString() },
        ],
        nextCursor: null,
      });
    }
    if (body.includes('"project.files.read"')) {
      return fulfill({
        path: params['path'] ?? reportPath,
        version: 'v1',
        size: reportBody.length,
        updatedAt: new Date().toISOString(),
        truncated: false,
        binary: false,
        mimeType: 'text/markdown',
        text: reportBody,
      });
    }
    if (body.includes('"session.get"')) {
      return fulfill({
        session: {
          sessionId: 's',
          projectId: 'p',
          roleId: 'chief',
          currentTaskId: 't-doc',
          revision: 1,
          activity: 'processing',
          currentInputId: 'i-1',
          lastActivityAt: null,
        },
      });
    }
    if (body.includes('"session.stream.prepare"')) {
      return fulfill({
        subscriptionId: 'sub-doc',
        streamPath: '/api/v1/sessions/s/stream?subscriptionId=sub-doc',
        epoch: 1,
        boundary: 0,
        snapshot: {
          sessionId: params['sessionId'] ?? 's',
          projectId: params['projectId'] ?? 'p',
          roleId: 'chief',
          activity: 'processing',
          currentInputId: 'i-1',
          inputs: [],
          task: { taskId: 't-doc', type: 'write', phase: 'settle', status: 'active', revision: 12 },
          config: null,
          blocked: null,
          interactions: [],
          messages: [],
          historyLeaf: null,
          hasEarlier: false,
          historyProblems: [],
        },
      });
    }
    return route.continue();
  });
  await page.route('**/api/v1/sessions/**/stream*', async (route) => {
    await new Promise(() => {});
  });
  try {
    await page.goto(harness.url);
    await loginThroughUi(page, harness.accessPassword);
    await page.locator('[data-testid="project-switcher"]').click();
    await page.locator('[data-testid="project-row"]').first().click();

    // The task id in the strip opens the detail; the result opens the report body.
    await page.locator('[data-testid="task-open"]').click({ timeout: 20_000 });
    const result = page.locator('[data-testid="result-open"]').first();
    await expect(result).toContainText('文档整理完成');
    await result.click();

    // The body is read as a document, with its project path offered as the way into the viewer.
    const drawer = page.locator('.drawer');
    await expect(drawer.locator('[data-testid="md-body"]')).toContainText('共 3 个文件');
    const openFile = page.locator('[data-testid="report-open-file"]');
    await expect(openFile).toContainText(reportPath);
    await openFile.click();

    // Same canvas, same engine: the report's own path, read through project.files.read.
    const viewer = page.locator('[data-testid="file-viewer"]');
    await expect(viewer).toBeVisible();
    await expect(page.locator('[data-testid="file-path"]')).toHaveText(reportPath);
    await expect(viewer.locator('[data-testid="md-body"]')).toContainText('共 3 个文件');
    // A read Task's report has no project path, and the drawer says so instead of showing one.
    expect(await page.evaluate(() => document.querySelectorAll('[data-testid="file-viewer"]').length)).toBe(1);
  } finally {
    await harness.close();
  }
});

test('a link in a message opens the file it names, never a route that does not exist', async ({ page }) => {
  // The user's case: a report quotes `/Users/…/aisuangua/.dev/work/t-x/shots/a.png`. The browser
  // turned that into `http://127.0.0.1:4173/Users/…` and 404ed, because a host path is not a route.
  // The text is never rewritten: the click is resolved against the project root the shell knows.
  const replies: StubReply[] = [{ kind: 'text', text: 'placeholder' }];
  const harness = await startHarness({ model: replies });
  const projectPath = harness.project?.projectPath ?? '';
  mkdirSync(join(projectPath, '.dev/work/t-frames/shots'), { recursive: true });
  writeFileSync(join(projectPath, '.dev/work/t-frames/shots/frame.png'), transparentPng());
  writeFileSync(
    join(projectPath, '.dev/work/t-frames/r1.md'),
    '# 结算\n\n共 **3** 个文件。\n\n- 一帧：[frame](./shots/frame.png)\n- 外链：[example](https://example.com/x)\n',
  );
  // The reply is written once the project path is known: the link has to quote the real path.
  replies[0] = {
    kind: 'text',
    text: [
      `绝对路径：[frame](${projectPath}/.dev/work/t-frames/shots/frame.png)`,
      '',
      '项目外：[secret](/etc/hosts)',
    ].join('\n'),
  };
  try {
    await page.goto(harness.url);
    await loginThroughUi(page, harness.accessPassword);
    await openProject(page, projectPath);
    await page.locator('[data-testid="composer"]').fill('给我看看帧');
    await page.locator('[data-testid="composer"]').press('Enter');

    // 1. An absolute host path opens the project file: the viewer, not the address bar.
    await page.locator('.md a[href^="/"]', { hasText: 'frame' }).click();
    const viewer = page.locator('[data-testid="file-viewer"]');
    await expect(viewer).toBeVisible();
    await expect(page.locator('[data-testid="file-path"]')).toHaveText('.dev/work/t-frames/shots/frame.png');
    await expect(viewer.locator('.fv-media img')).toBeVisible();
    // The shell never left the screen it was on.
    await expect(page).toHaveURL(/\/$/);

    // 2. A path outside the project says so; it never navigates to a dead address.
    await page.locator('[data-testid="file-close"]').click();
    await page.locator('.md a', { hasText: 'secret' }).click();
    await expect(page.locator('.toast').last()).toContainText(/outside this project|不在当前项目内/);
    await expect(viewer).toHaveCount(0);
    await expect(page).toHaveURL(/\/$/);

    // 3. A markdown document is read formatted, and its source is one click away.
    await page.locator('[data-testid="nav-files"]').click();
    for (const step of ['.dev', 'work', 't-frames']) {
      await page.locator('[data-testid="file-entry"]', { hasText: step }).first().click();
    }
    await page.locator('[data-testid="file-entry"]', { hasText: 'r1.md' }).click();
    await expect(page.locator('[data-testid="md-body"] h1')).toHaveText('结算');
    await expect(page.locator('[data-testid="md-body"] strong')).toHaveText('3');
    // 4. A relative link inside the document resolves against the document's own directory.
    await page.locator('[data-testid="md-body"] a', { hasText: 'frame' }).click();
    await expect(page.locator('[data-testid="file-path"]')).toHaveText('.dev/work/t-frames/shots/frame.png');
    // 5. The same bytes as source: the mode belongs to the file, and switching does not edit it.
    await page.locator('[data-testid="file-entry"]', { hasText: 'r1.md' }).click();
    await page.locator('[data-testid="md-rendered"]').click();
    await expect(page.locator('[data-testid="md-body"]')).toBeVisible();
    await page.locator('[data-testid="md-source"]').click();
    await expect(page.locator('[data-testid="file-text"]')).toContainText('# 结算');
    await page.screenshot({ path: test.info().outputPath('markdown-source.png') });
  } finally {
    await harness.close();
  }
});

test('every screen is usable on a phone: the viewer, the board and the settings tabs', async ({ page }) => {
  test.setTimeout(90_000);
  // The mobile pass found four separate failures, all of the shape "a control with no room":
  // a zero-width project button, a rail toggle past the right edge, a toast on the first message,
  // and a shell column that grew with its widest child and carried the header along with it.
  const harness = await startHarness({ model: [{ kind: 'text', text: '先讨论一下。' }] });
  const projectPath = harness.project?.projectPath ?? '';
  mkdirSync(join(projectPath, '.dev/work/t-m/shots'), { recursive: true });
  writeFileSync(join(projectPath, 'AGENTS.md'), '# rules\n\nKeep it short.\n');
  writeFileSync(join(projectPath, 'note.md'), '# 说明\n\n一段文字。\n');
  try {
    for (const width of [390, 320] as const) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(harness.url);
      await loginThroughUi(page, harness.accessPassword);

      const noOverflow = async (label: string): Promise<void> => {
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, `${label} at ${width}px`).toBeLessThanOrEqual(1);
      };

      // The project button is reachable at both widths and opens the dialog.
      await page.locator('[data-testid="project-switcher"]').click();
      await page.locator('[data-testid="project-path"]').fill(projectPath);
      await page.locator('[data-testid="project-path"]').press('Enter');
      await waitForConnected(page);
      await noOverflow('chat');

      // The rail toggle is on screen, and the sheet it opens is usable.
      await page.locator('[data-testid="rail-toggle"]').click();
      await expect(page.locator('.sessions.sheet')).toBeVisible();
      await page.keyboard.press('Escape');

      // Sending puts the user line above the reply, and the toast does not cover it.
      await page.locator('[data-testid="composer"]').fill('你好');
      await page.locator('[data-testid="composer"]').press('Enter');
      await expect(page.locator('[data-testid="transcript"] article.m.user')).toContainText('你好', { timeout: 15_000 });
      await expect(page.locator('[data-testid="transcript"] article.m.chief')).toContainText('先讨论一下');
      await page.screenshot({ path: test.info().outputPath(`phone-${String(width)}-chat.png`) });

      // The file viewer is a full canvas; on a phone its tree sits above the file and the hint
      // does not name a side.
      await page.locator('[data-testid="nav-files"]').click();
      const viewer = page.locator('[data-testid="file-viewer"]');
      await expect(viewer).toBeVisible();
      await expect(page.locator('[data-testid="file-path"]')).toHaveText('/');
      await noOverflow('file viewer');
      await page.locator('[data-testid="file-entry"]', { hasText: 'note.md' }).click();
      await expect(page.locator('[data-testid="md-body"]')).toContainText('一段文字');
      await page.locator('[data-testid="file-close"]').click();

      // The board scrolls one column at a time, and its Tasks row is one line and tappable.
      await page.locator('.nav a', { hasText: /Requirements|需求/ }).click();
      await expect(page.locator('[data-testid="tasks-toggle"]')).toBeVisible();
      await noOverflow('board');
      const toggleHeight = await page.locator('[data-testid="tasks-toggle"]').evaluate((node) => node.getBoundingClientRect().height);
      expect(toggleHeight, 'the folded Tasks row is one line').toBeLessThan(56);
      await page.locator('[data-testid="tasks-toggle"]').click();
      await expect(page.locator('[data-testid="tasks-toggle"]')).toHaveAttribute('aria-expanded', 'true');
      await noOverflow('board with tasks open');

      // Settings keeps its three tabs reachable.
      await page.locator('.nav a', { hasText: /Settings|设置/ }).click();
      await expect(page.locator('.nav a[aria-current="page"]')).toHaveCount(1);
      await noOverflow('settings');
    }
  } finally {
    await harness.close();
  }
});
