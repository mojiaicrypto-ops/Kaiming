/**
 * Browser acceptance: the real workbench, a real Chromium and a real model endpoint.
 *
 * These are the product's own acceptance steps (docs/productnew/acceptance.md) driven through the
 * browser: they prove what unit tests cannot - that the page really talks to the server, renders
 * what the server holds, answers questions and keeps working when the reader leaves.
 */
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { loginThroughUi, startHarness } from './harness.ts';

/** Open the seeded project through the switcher (the first thing a user does). */
async function openProject(page: Page, projectPath: string): Promise<void> {
  await page.locator('[data-testid="project-switcher"]').click();
  await page.locator('[data-testid="project-path"]').fill(projectPath);
  await page.locator('[data-testid="project-path"]').press('Enter');
  await expect(page.locator('[data-testid="project-switcher"]')).toContainText('project');
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

    // The answered card stays (its echo is the proof the reply was recorded), in the user's language.
    await expect(panel).toContainText('Answer received', { timeout: 15_000 });
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
