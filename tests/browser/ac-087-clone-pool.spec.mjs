/**
 * AC-087 / AC-088 / AC-089 — 克隆项目页面的需求池可见性（真 Chromium，WP-12 clone portability）。
 *
 * 这一组证据来自**真实宿主**：`tests/browser/stack-runtime.mjs` 的 `openSwitcherStack()`
 * 用 `startRuntime` 起一个安装，Alpha 项目的 completed/active 需求都经真实 `/rpc`
 * （`requirement.create` / `requirement.save` / `requirement.start`）写入并提交到
 * `agentdev/main`，随后用真实 `git clone` 复制 Alpha 仓库，并经 admin 的 project open
 * 路径作为**新项目**打开（该项目自己的 SQLite 从空开始，导入结果由首开导入产生）。
 * 没有任何播种行，也没有任何 mock。
 *
 * 断言逐条对应 AC：
 * 1. AC-087：克隆项目的需求页面列出导入的记录，稳定 id/标题随 Git 迁移；
 * 2. AC-088：completed 记录详情展示完成摘要，并诚实显示 `summary_only`（旧报告未迁移）；
 * 3. AC-089：导入的 active 记录显示“待继续”并提供 Continue 控件，且克隆项目没有任何 Run。
 */
import { expect, test } from '@playwright/test';

import { browserFixture, openPage, signIn } from './helpers.mjs';

test.describe('AC-087 / AC-088 / AC-089 克隆项目的需求池（真 Chromium）', () => {
  test('克隆项目的需求页面展示导入的池、完成摘要与待继续，且没有 Run (AC-087/AC-088/AC-089)', async ({
    page,
  }, testInfo) => {
    const switcher = browserFixture().switcher;
    const clone = switcher.clone;
    expect(clone, 'the clone drill fixture is missing').toBeDefined();

    await signIn(page, switcher);

    // ---- AC-087：导入的需求池在项目页面上，稳定 id 与标题随 Git 迁移 --------------
    const requirementsPath = `/projects/${clone.projectId}/requirements`;
    await openPage(page, { webUrl: switcher.webUrl }, requirementsPath);
    const board = await page.content();
    expect(board).toContain('data-column="queued"');
    expect(board).toContain('data-column="completed"');
    expect(board).toContain('data-column="active"');
    for (const record of [clone.queued, clone.completed, clone.active]) {
      expect(board).toContain(`data-identity="${record.id}"`);
      expect(board).toContain(record.title);
    }
    expect(board).toContain('data-lifecycle="completed"');
    expect(board).toContain('data-lifecycle="active"');

    // ---- AC-088：completed 详情展示完成摘要与证据可用性事实 ----------------------
    await openPage(
      page,
      { webUrl: switcher.webUrl },
      `/projects/${clone.projectId}/requirements/${clone.completed.id}`,
    );
    const completed = await page.content();
    expect(completed).toContain(`data-requirement="${clone.completed.id}"`);
    expect(completed).toContain(clone.completionSummary);
    // 旧报告未迁移：界面显示 summary_only，而不是声称本机已验证。
    expect(completed).toContain('summary_only');

    // ---- AC-089：active 记录显示待继续；导入没有启动 Run ------------------------
    await openPage(
      page,
      { webUrl: switcher.webUrl },
      `/projects/${clone.projectId}/requirements/${clone.active.id}`,
    );
    const active = await page.content();
    expect(active).toContain(`data-requirement="${clone.active.id}"`);
    expect(active).toContain('data-i18n="board.card.waitingToContinue"');
    expect(active).toContain('data-action="continue"');

    await openPage(page, { webUrl: switcher.webUrl }, `/projects/${clone.projectId}/runs`);
    const runs = await page.content();
    expect(runs).not.toContain('data-run=');
    expect(runs).not.toContain('class="work-row"');

    const evidence = [
      `克隆项目 ${clone.projectId} 的需求页面含 data-identity=${clone.queued.id}/${clone.completed.id}/${clone.active.id} 与三个列（queued/completed/active）`,
      `completed 详情含完成摘要「${clone.completionSummary}」并显示 summary_only（旧报告未迁移）`,
      `active 详情含 board.card.waitingToContinue 与 data-action="continue"；/runs 页面没有任何 data-run= 或 work-row`,
    ].join('；');
    await testInfo.attach('evidence', { body: evidence, contentType: 'text/plain' });
  });
});
