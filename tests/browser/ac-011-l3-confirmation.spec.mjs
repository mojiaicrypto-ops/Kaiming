/**
 * AC-011 — the explicit L3 confirmation interaction in a real browser.
 *
 * `docs/rules/workflow.md` §2.3 routes the documented lockdown risks to L3 and §3 makes
 * the L3 delivery a high-risk route; `docs/product/experience.md` §5 puts the user's
 * answer in the Inbox. This spec drives the **real page against the real daemon and
 * BFF**: the confirmation the routing raised appears as an Inbox card that states the
 * risk flags, the Work, the revision and the scope, the named confirm/decline controls
 * answer it through the documented `decision.resolve`, and the server's own next read
 * (a fresh page GET) shows the answered outcome.
 *
 * The decline path is exercised too, including the rule that a decline must record a
 * reason: the client refuses to send one without it, and the recorded reason is what the
 * server's next read shows.
 */
import { expect, test } from '@playwright/test';

import { browserFixture, openPage, rpcInBrowser, signIn } from './helpers.mjs';

test.describe('AC-011 L3 显式确认（真 Chromium）', () => {
  test('AC-011 · 出现 → 确认 → 服务端读回已接受，且待办不再可操作', async ({ page }, testInfo) => {
    const fixture = browserFixture();
    await signIn(page);
    const inboxPath = `/projects/${fixture.projectId}/inbox`;
    await openPage(page, fixture, inboxPath);

    const row = page.locator(
      `[data-entry="l3-confirmation"][data-decision="${fixture.l3DecisionId}"]`,
    );
    await expect(row).toBeVisible();
    // The card states what is being confirmed: the routing risk flags, the Work, the
    // revision and the scope the implementation would run under.
    await expect(row).toHaveAttribute('data-l3-confirmation', 'true');
    await expect(row).toHaveAttribute('data-l3-outcome', 'pending');
    await expect(row.locator('[data-l3-risk-flag="数据删除/迁移"]')).toHaveText('数据删除/迁移');
    await expect(row.locator('[data-l3-work-id]')).toHaveText(String(fixture.l3WorkId));
    await expect(row.locator('[data-l3-revision]')).toHaveText(String(fixture.seedRevision));
    await expect(row.locator('[data-l3-write-paths]')).toContainText('src/db');
    await expect(row.locator('[data-l3-operations]')).toContainText('edit');
    // Both documented answers are offered, and the hold is explained in text.
    await expect(row.locator('button[data-choice="confirm"]')).toBeEnabled();
    await expect(row.locator('button[data-choice="decline"]')).toBeEnabled();
    await expect(row.locator('[data-i18n="inbox.l3HoldNote"]')).toBeVisible();

    // The confirm control answers through the real protocol, and the page reads the
    // new state back from the server (the row is settled, not deleted: the Inbox keeps
    // an answered decision visible and disables it, `experience.md` §5).
    await row.locator('button[data-choice="confirm"]').click();
    await expect(page.locator('#inboxStatus')).toBeVisible();
    await expect(row).toHaveAttribute('data-state', 'accepted');

    // The server's own next read agrees: a fresh GET shows the answered outcome, not a
    // recomputed local guess.
    await openPage(page, fixture, inboxPath);
    const settled = page.locator(
      `[data-entry="l3-confirmation"][data-decision="${fixture.l3DecisionId}"]`,
    );
    await expect(settled).toHaveAttribute('data-state', 'accepted');
    await expect(settled).toHaveAttribute('data-l3-outcome', 'accepted');
    await expect(settled.locator('button[data-choice="confirm"]')).toBeDisabled();
    await expect(settled.locator('button[data-choice="decline"]')).toBeDisabled();

    // The Work's own row confirms the hold was lifted: the confirmation Decision is no
    // longer one of its blockers (`workflow.md` §5.1).
    const work = await rpcInBrowser(page, fixture, 'work.get', { workId: fixture.l3WorkId });
    expect(work.result?.work?.status).toBe('running');
    expect(work.result?.work?.blockerIds ?? []).not.toContain(fixture.l3DecisionId);

    const evidence =
      `Inbox 出现 L3 确认卡（work=${String(fixture.l3WorkId)} decision=${String(fixture.l3DecisionId)} ` +
      `riskFlags=数据删除/迁移 scope.writePaths=src/db revision=${String(fixture.seedRevision)}）→ 点击 confirm → ` +
      `#inboxStatus 可见、行状态读回 accepted、两个按钮 disabled → 重新 GET 页面仍为 accepted → ` +
      `work.get 显示 status=running、blockerIds 不含该 decision`;
    await testInfo.attach('evidence', { body: evidence, contentType: 'text/plain' });
  });

  test('AC-011 · 拒绝必须记录原因，且服务端读回拒绝理由', async ({ page }, testInfo) => {
    const fixture = browserFixture();
    await signIn(page);
    const inboxPath = `/projects/${fixture.projectId}/inbox`;
    await openPage(page, fixture, inboxPath);

    const row = page.locator(
      `[data-entry="l3-confirmation"][data-decision="${fixture.l3DeclinedDecisionId}"]`,
    );
    await expect(row).toBeVisible();
    await expect(row.locator('[data-l3-risk-flag="Secret"]')).toHaveText('Secret');

    // Declining without a reason never reaches the server: the card keeps its state and
    // the page states what the command needs.
    await row.locator('button[data-choice="decline"]').click();
    await expect(page.locator('#inboxError')).toBeVisible();
    await expect(row).toBeVisible();
    await expect(row).toHaveAttribute('data-l3-outcome', 'pending');

    // With a reason the refusal is recorded and applied.
    await row
      .locator('textarea[data-l3-reason]')
      .fill('the credential rotation is not acceptable yet');
    await row.locator('button[data-choice="decline"]').click();
    await expect(page.locator('#inboxStatus')).toBeVisible();
    await expect(row).toHaveAttribute('data-state', 'rejected');

    await openPage(page, fixture, inboxPath);
    const settled = page.locator(
      `[data-entry="l3-confirmation"][data-decision="${fixture.l3DeclinedDecisionId}"]`,
    );
    await expect(settled).toHaveAttribute('data-state', 'rejected');
    await expect(settled).toHaveAttribute('data-l3-outcome', 'rejected');
    await expect(settled.locator('[data-l3-decline-reason]')).toContainText(
      'the credential rotation is not acceptable yet',
    );
    // The Work stays blocked: a declined high-risk delivery is not implemented.
    const work = await rpcInBrowser(page, fixture, 'work.get', {
      workId: fixture.l3DeclinedWorkId,
    });
    expect(work.result?.work?.status).toBe('blocked');
    expect(work.result?.work?.blockerIds ?? []).toContain(fixture.l3DeclinedDecisionId);

    const evidence =
      `Inbox 出现第二条 L3 确认卡（work=${String(fixture.l3DeclinedWorkId)} decision=${String(fixture.l3DeclinedDecisionId)} riskFlags=Secret）→ ` +
      `空原因点击 decline 被本地拒绝（#inboxError 可见、行仍在、outcome 仍为 pending）→ 填写原因后 decline → ` +
      `#inboxStatus 可见、行状态读回 rejected → 重新 GET 显示 data-state="rejected" 与拒绝理由 → ` +
      `work.get 显示 status=blocked、blockerIds 含该 decision`;
    await testInfo.attach('evidence', { body: evidence, contentType: 'text/plain' });
  });
});
