/**
 * AC-074 — the Inbox closes a user-facing sensitive-file todo in a real browser (WP-12 W2).
 *
 * `docs/architecture/protocol.md` §4 `chief.todo.resolve`: the todo the permission phase
 * files when a frozen sensitive file (附录 A.2) is refused is closed by a **user
 * acknowledgement** — no Grant is minted and the sensitive-file tier does not change.
 * This spec drives the real page against the real daemon and BFF: the todo appears, the
 * named "Handled" control closes it, and the server's own next read (a fresh page GET)
 * still omits it. The refused file's content never appears anywhere on the page.
 */
import { expect, test } from '@playwright/test';

import { SENSITIVE_FILE_MARKER } from './constants.mjs';
import { browserFixture, openPage, signIn } from './helpers.mjs';

test.describe('AC-074 敏感文件待办（真 Chromium）', () => {
  test('AC-074 · 出现 → 已处理 → 消失，刷新后仍不出现', async ({ page }, testInfo) => {
    const fixture = browserFixture();
    await signIn(page);
    const inboxPath = `/projects/${fixture.projectId}/inbox`;
    await openPage(page, fixture, inboxPath);

    const row = page.locator(`[data-entry="todo"][data-todo="${String(fixture.inboxTodoId)}"]`);
    await expect(row).toBeVisible();
    // The card states what was refused, which file and rule matched, and which Work/Run
    // it belongs to — every value the daemon reported.
    await expect(row.locator('[data-todo-action]')).toHaveText('read');
    await expect(row.locator('[data-todo-path]')).toHaveText('.env');
    await expect(row.locator('[data-todo-pattern]')).toHaveText('.env*');
    await expect(row.locator('[data-todo-run]')).toHaveText(String(fixture.inboxRunId));
    await expect(row).toHaveAttribute('data-work', String(fixture.inboxWorkId));
    // It states the user's own action, and the refused file's content is nowhere.
    await expect(row.locator('[data-i18n="inbox.todoHandling"]')).toBeVisible();
    expect(await page.content()).not.toContain(SENSITIVE_FILE_MARKER);
    expect(await page.content()).not.toContain('hunter2');

    // The named "Handled" control closes it through the real protocol...
    await row.locator('button[data-todo-disposition="handled"]').click();
    await expect(page.locator('#inboxStatus')).toBeVisible();
    await expect(row).toHaveCount(0);

    // ... and the server's own next read agrees: a fresh GET does not bring the row back
    // (this is a server read-back, not a local deletion).
    await openPage(page, fixture, inboxPath);
    await expect(
      page.locator(`[data-entry="todo"][data-todo="${String(fixture.inboxTodoId)}"]`),
    ).toHaveCount(0);

    const evidence = `Inbox 出现待办（action=read path=.env pattern=.env* work=${String(fixture.inboxWorkId)} run=${String(fixture.inboxRunId)}）→ 点击「Handled」→ 行从 #inboxList 消失且 #inboxStatus 可见 → 重新 GET 页面后仍 0 行；页面不含被拒文件内容（${SENSITIVE_FILE_MARKER}/hunter2）`;
    await testInfo.attach('evidence', { body: evidence, contentType: 'text/plain' });
  });
});
