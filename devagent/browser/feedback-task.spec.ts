/**
 * A Task control must acknowledge the click before the Task poll or push arrives. The Task read is
 * real HTTP routed to a deterministic Task row; the control response is held so the pending state
 * is observable, which a fast local read would hide.
 */
import { test, expect } from '@playwright/test';
import { loginThroughUi, startHarness } from './harness.ts';

test('pausing a Task immediately shows a disabled pending control', async ({ page }) => {
  const harness = await startHarness();
  let paused = false;
  try {
    await page.route('**/api/v1/rpc', async (route) => {
      const body = route.request().postData() ?? '';
      const envelope = JSON.parse(body) as { requestId?: string };
      const task = {
        task: {
          taskId: 't-pending',
          type: 'write',
          phase: 'develop',
          status: paused ? 'paused' : 'active',
          revision: paused ? 5 : 4,
          goal: '观察点击反馈',
          scope: '按钮',
          nextStep: null,
          requiresTest: false,
        },
        members: [],
        results: [],
      };
      if (body.includes('"task.get"')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ requestId: envelope.requestId, result: task }),
        });
        return;
      }
      if (body.includes('"task.control"')) {
        await new Promise((resolve) => setTimeout(resolve, 800));
        paused = true;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ requestId: envelope.requestId, result: { status: 'paused', revision: 5, currentSessionIds: [] } }),
        });
        return;
      }
      if (body.includes('"session.get"')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            requestId: envelope.requestId,
            result: {
              session: {
                sessionId: 's',
                projectId: 'p',
                roleId: 'chief',
                currentTaskId: 't-pending',
                revision: 1,
                activity: 'processing',
                currentInputId: null,
                lastActivityAt: null,
              },
            },
          }),
        });
        return;
      }
      await route.continue();
    });

    await page.addInitScript((value: { projectPath: string; sessionId: string }) => {
      localStorage.setItem('agentdev.projectPath', value.projectPath);
      localStorage.setItem('agentdev.sessionId', value.sessionId);
      localStorage.setItem('agentdev.locale', 'en');
    }, { projectPath: harness.project?.projectPath ?? '', sessionId: harness.project?.sessionId ?? '' });
    await page.goto(harness.baseUrl, { waitUntil: 'domcontentloaded' });
    await loginThroughUi(page, harness.accessPassword);
    const pause = page.locator('[data-testid="task-pause"]');
    await expect(pause).toBeVisible({ timeout: 20_000 });
    await pause.click();

    await expect(page.locator('[data-testid="task-strip"]')).toContainText(/Pause requested|暂停请求已收到/);
    await expect(pause).toBeDisabled();
    await expect(pause).toHaveAttribute('aria-busy', 'true');
    await expect(page.locator('[data-testid="task-strip"]')).toContainText(/Paused|已暂停/, { timeout: 5_000 });
  } finally {
    await harness.close();
  }
});
