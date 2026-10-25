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
    // The chain is what the Task did: the design step it moved to, never the code chain's steps
    // (develop/review/test/settle), which this document Task never runs.
    await expect(strip.locator('.phases')).toContainText(/Design|设计/, { timeout: 20_000 });
    // A phase the Task did not run is not progress: none of the code chain's steps may appear.
    await expect(strip.locator('.phases')).not.toContainText(/Develop|开发/);
    await expect(strip.locator('.phases')).not.toContainText(/Review|审核/);
    await expect(strip.locator('.phases')).not.toContainText(/Test|测试/);
    await expect(strip.locator('.phases')).not.toContainText(/Settle|结算/);
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
    await expect(live).toContainText('按验收实现六件套');
    const rows = page.locator('[data-testid="task-live-members"] [data-testid="task-member-row"]');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(/developer|开发/i);
    await expect(rows.first()).toContainText(/running|运行/i);

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

    await expect(page.locator('.drawer')).toContainText('账户模块有三个入口');
    // The body comes from the stored report, not from a chat message.
    await expect(page.locator('[data-testid="transcript"]')).not.toContainText('账户模块有三个入口');
  } finally {
    await harness.close();
  }
});

test('the project files open in a read-only viewer, and a binary file says so', async ({ page }) => {
  const harness = await startHarness();
  try {
    const projectPath = harness.project?.projectPath ?? '';
    writeFileSync(join(projectPath, 'AGENTS.md'), '# project rules\n\nKeep it short.\n');
    writeFileSync(join(projectPath, 'blob.bin'), Buffer.from([0, 1, 2, 3]));
    await page.goto(harness.url);
    await loginThroughUi(page, harness.accessPassword);
    await openProject(page, projectPath);

    await page.locator('[data-testid="project-switcher"]').click();
    const entry = page.locator('[data-testid="project-entry"]', { hasText: 'AGENTS.md' });
    await entry.click();
    await expect(page.locator('[data-testid="file-text"]')).toContainText('Keep it short.');
    await page.locator('.drawer .dh button').last().click();

    await page.locator('[data-testid="project-switcher"]').click();
    await page.locator('[data-testid="project-browse"]').click();
    await page.locator('[data-testid="file-entry"]', { hasText: 'blob.bin' }).click();
    // A binary file is not text, and the viewer must say so instead of printing control bytes.
    await expect(page.locator('.drawer')).toContainText(/[Bb]inary/);
  } finally {
    await harness.close();
  }
});

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
    await page.locator('[data-testid="provider-models"]').fill('some-model');
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
