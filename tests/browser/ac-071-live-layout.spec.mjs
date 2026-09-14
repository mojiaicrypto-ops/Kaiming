/**
 * AC-071 — the Live layout, in a real browser (WP-12 T7a).
 *
 * `experience.md` §6 promises one shared Live Dock with three states (Open/Compact/
 * Hidden), Open clamped to `clamp(360px, 38%, 560px)`, a fixed top-bar count entry that
 * restores it, state preserved across pages, and a closable overlay below 768px whose
 * close returns focus to the triggering control — and none of it may disturb a Run.
 *
 * The specs measure the real computed layout in Chromium, drive the state machine with
 * real interaction (pointer where the control is laid out correctly, keyboard because
 * AC-073 promises every control is keyboard reachable) and read a real running Run row
 * back through the workbench protocol.
 */
import { expect, test } from '@playwright/test';

import { browserFixture, openPage, rpcInBrowser, signIn } from './helpers.mjs';

/** The resolved grid tracks of `#shell`, as numbers. */
async function shellTracks(page) {
  const columns = await page.evaluate(
    () => getComputedStyle(document.getElementById('shell')).gridTemplateColumns,
  );
  return columns.split(/\s+/u).map((value) => Number.parseFloat(value));
}

/** Activates the top-bar Live control with the keyboard (it is a real button). */
async function pressLiveToggle(page) {
  await page.locator('#liveDockToggle').focus();
  await page.keyboard.press('Enter');
}

test.describe('AC-071 Live 布局', () => {
  test('AC-071 · Open/Compact/Hidden 三态与 clamp 共享宽度', async ({ page }, testInfo) => {
    const fixture = browserFixture();
    await signIn(page, fixture);
    await openPage(page, fixture, `/projects/${fixture.projectId}/chief`);

    const shell = page.locator('#shell');
    const dock = page.locator('#liveDock');
    const toggle = page.locator('#liveDockToggle');

    await expect(shell).toHaveAttribute('data-panel-mode', 'open');
    await expect(dock).toHaveAttribute('data-mode', 'open');
    await expect(toggle).toHaveAttribute('data-mode', 'open');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(toggle).toHaveAttribute('aria-controls', 'liveDock');
    await expect(toggle).toHaveAttribute('aria-label', 'Live panel, open');
    await expect(dock).toBeVisible();

    const open = await page.evaluate(() => {
      const shellElement = document.getElementById('shell');
      const dockElement = document.getElementById('liveDock');
      const mainElement = document.getElementById('main');
      const shellBox = shellElement.getBoundingClientRect();
      const dockBox = dockElement.getBoundingClientRect();
      const mainBox = mainElement.getBoundingClientRect();
      return {
        shellWidth: shellBox.width,
        dockWidth: dockBox.width,
        dockLeft: dockBox.left,
        dockRight: dockBox.right,
        mainLeft: mainBox.left,
        mainRight: mainBox.right,
        dockToken: getComputedStyle(shellElement).getPropertyValue('--dock').trim(),
        sidebarToken: getComputedStyle(shellElement).getPropertyValue('--sidebar').trim(),
      };
    });
    expect(open.dockToken).toBe('clamp(360px, 38%, 560px)');
    expect(open.sidebarToken).toBe('220px');
    // `clamp(360px, 38%, 560px)` at 1280px resolves to 38% (486.4px), inside the clamp.
    const expectedDock = open.shellWidth * 0.38;
    expect(expectedDock).toBeGreaterThanOrEqual(360);
    expect(expectedDock).toBeLessThanOrEqual(560);
    expect(Math.abs(open.dockWidth - expectedDock)).toBeLessThanOrEqual(1);
    // The body keeps every pixel outside the dock: the widths are shared, not overlapped.
    expect(Math.abs(open.mainRight - open.dockLeft)).toBeLessThanOrEqual(1);
    expect(Math.abs(open.dockRight - open.shellWidth)).toBeLessThanOrEqual(1);
    expect(open.mainLeft).toBeGreaterThanOrEqual(220 - 1);

    const openTracks = await shellTracks(page);
    expect(openTracks).toHaveLength(3);
    expect(Math.abs(openTracks[2] - open.dockWidth)).toBeLessThanOrEqual(1);

    // Compact: a 44px rail, the Dock content hidden, the restore entry still present.
    await pressLiveToggle(page);
    await expect(shell).toHaveAttribute('data-panel-mode', 'compact');
    await expect(dock).toBeHidden();
    await expect(toggle).toHaveAttribute('data-mode', 'compact');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#liveCount')).toBeVisible();
    const compactTracks = await shellTracks(page);
    expect(compactTracks[2]).toBe(44);

    // Hidden: the rail is released entirely, the restore entry stays present.
    await pressLiveToggle(page);
    await expect(shell).toHaveAttribute('data-panel-mode', 'hidden');
    await expect(dock).toBeHidden();
    await expect(toggle).toHaveAttribute('data-mode', 'hidden');
    await expect(page.locator('#liveCount')).toBeVisible();
    const hiddenTracks = await shellTracks(page);
    expect(hiddenTracks[2]).toBe(0);
    // Releasing the dock gives the body the width back.
    expect(hiddenTracks[1]).toBeGreaterThan(compactTracks[1]);

    // And the cycle returns to Open.
    await pressLiveToggle(page);
    await expect(shell).toHaveAttribute('data-panel-mode', 'open');
    await expect(dock).toBeVisible();

    const evidence = [
      `open: grid=${openTracks.map((n) => n.toFixed(1)).join('px ')}px, --dock=${open.dockToken} ⇒ dock ${open.dockWidth.toFixed(1)}px (38% of ${open.shellWidth.toFixed(0)}px), main 右缘=${open.mainRight.toFixed(1)} dock 左缘=${open.dockLeft.toFixed(1)}`,
      `compact: 第三轨=${compactTracks[2]}px, dock display=none, aria-expanded=false`,
      `hidden: 第三轨=${hiddenTracks[2]}px, main=${hiddenTracks[1].toFixed(1)}px > compact=${compactTracks[1].toFixed(1)}px`,
      '三态由真实键盘操作（focus + Enter）驱动',
    ].join('；');
    await testInfo.attach('evidence', { body: evidence, contentType: 'text/plain' });
  });

  test('AC-071 · 顶栏恢复入口位于视口内且可用指针点击', async ({ page }, testInfo) => {
    const fixture = browserFixture();
    await signIn(page, fixture);
    await openPage(page, fixture, `/projects/${fixture.projectId}/chief`);

    const geometry = await page.evaluate(() => {
      const rectOf = (selector) => {
        const element = document.querySelector(selector);
        if (element === null) return null;
        const rect = element.getBoundingClientRect();
        return {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          right: rect.right,
          bottom: rect.bottom,
        };
      };
      const header = document.querySelector('.topbar');
      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        header: rectOf('.topbar'),
        headerDisplay: header === null ? null : getComputedStyle(header).display,
        brand: rectOf('.brand'),
        projectArea: rectOf('.project-area'),
        tools: rectOf('.topbar-tools'),
        toggle: rectOf('#liveDockToggle'),
      };
    });
    await testInfo.attach('evidence', {
      body: JSON.stringify(geometry, null, 2),
      contentType: 'application/json',
    });

    // The restore control must be inside the viewport to be pointing at.
    expect(
      geometry.toggle?.x,
      `#liveDockToggle 左缘 ${String(geometry.toggle?.x)} 在视口外：顶栏布局把控制推离屏幕（geometry=${JSON.stringify(geometry)})`,
    ).toBeGreaterThanOrEqual(0);
    expect(geometry.toggle?.y).toBeGreaterThanOrEqual(0);
    expect(geometry.toggle?.right).toBeLessThanOrEqual(geometry.viewport.width + 1);
    expect(geometry.toggle?.bottom).toBeLessThanOrEqual(geometry.viewport.height + 1);

    // The top bar spans the workspace, and its three groups share one row.
    expect(geometry.header?.width).toBeGreaterThanOrEqual(geometry.viewport.width - 1);
    expect(geometry.header?.height).toBeLessThanOrEqual(54 + 1);
    expect(geometry.brand?.y).toBeCloseTo(geometry.tools?.y ?? -1, 0);
    expect(geometry.projectArea?.y).toBeCloseTo(geometry.tools?.y ?? -1, 0);

    // And the real pointer path works: one click cycles Open → Compact.
    await page.click('#liveDockToggle');
    await expect(page.locator('#shell')).toHaveAttribute('data-panel-mode', 'compact');
  });

  test('AC-071 · 跨页保持面板状态且切换不发出任何协议请求（不打扰 Run）', async ({
    page,
  }, testInfo) => {
    const fixture = browserFixture();
    await signIn(page, fixture);
    await openPage(page, fixture, `/projects/${fixture.projectId}/chief`);
    const shell = page.locator('#shell');
    const dock = page.locator('#liveDock');
    const toggle = page.locator('#liveDockToggle');

    // A real running Run row, read back through the real protocol before/after.
    const before = await rpcInBrowser(page, fixture, 'run.get', { runId: fixture.runningRunId });
    expect(before.ok).toBe(true);
    expect(before.result.run.status).toBe('running');

    // Switch Open → Compact on the Chief page.
    await pressLiveToggle(page);
    await expect(shell).toHaveAttribute('data-panel-mode', 'compact');
    const stored = await page.evaluate(() => window.localStorage.getItem('agentdev.panel'));
    expect(stored).toBe('compact');

    // No `/rpc` request is issued while the panel changes: the UI cannot disturb a Run.
    const rpcDuringSwitch = [];
    page.on('request', (request) => {
      if (request.url().endsWith('/rpc')) rpcDuringSwitch.push(request.postData() ?? '');
    });
    await pressLiveToggle(page);
    await expect(shell).toHaveAttribute('data-panel-mode', 'hidden');
    await pressLiveToggle(page);
    await expect(shell).toHaveAttribute('data-panel-mode', 'open');
    await pressLiveToggle(page);
    await expect(shell).toHaveAttribute('data-panel-mode', 'compact');
    expect(rpcDuringSwitch).toEqual([]);
    // Snapshot before the navigation below: the listener stays installed, and those
    // later page loads issue `/rpc` calls of their own.
    const rpcDuringSwitchCount = rpcDuringSwitch.length;

    // The state survives a real page navigation (device-local, shared across pages).
    await page.goto(`${fixture.webUrl}/projects/${fixture.projectId}/requirements`);
    await expect(shell).toHaveAttribute('data-panel-mode', 'compact');
    await expect(dock).toBeHidden();
    await expect(toggle).toBeVisible();

    // The running Run's row is byte-identical: nothing about the layout touched it.
    const after = await rpcInBrowser(page, fixture, 'run.get', { runId: fixture.runningRunId });
    expect(after.result).toEqual(before.result);
    expect(after.result.run.status).toBe('running');

    const evidence = [
      '面板状态写入 localStorage(agentdev.panel=compact) 并在导航到 /requirements 后仍为 compact（dock display=none）',
      `三态切换期间 /rpc 请求数=${rpcDuringSwitchCount}`,
      `run.get(${fixture.runningRunId}) 切换前后完全一致，status=${String(after.result.run.status)}`,
    ].join('；');
    await testInfo.attach('evidence', { body: evidence, contentType: 'text/plain' });
  });

  test('AC-071 · 窄屏 Open 为可关闭覆盖层', async ({ page }, testInfo) => {
    const fixture = browserFixture();
    await page.setViewportSize({ width: 600, height: 800 });
    await signIn(page, fixture);
    await openPage(page, fixture, `/projects/${fixture.projectId}/chief`);
    const shell = page.locator('#shell');
    const dock = page.locator('#liveDock');
    const toggle = page.locator('#liveDockToggle');

    await expect(shell).toHaveAttribute('data-panel-mode', 'open');
    const narrow = await page.evaluate(() => {
      const dockElement = document.getElementById('liveDock');
      const mainElement = document.getElementById('main');
      const dockBox = dockElement.getBoundingClientRect();
      const mainBox = mainElement.getBoundingClientRect();
      return {
        position: getComputedStyle(dockElement).position,
        dockLeft: dockBox.left,
        dockRight: dockBox.right,
        dockWidth: dockBox.width,
        mainLeft: mainBox.left,
        mainRight: mainBox.right,
        viewportWidth: window.innerWidth,
      };
    });
    expect(narrow.position).toBe('fixed');
    // The overlay is `min(92vw, 420px)` wide and floats above the full-width body.
    expect(narrow.dockWidth).toBeLessThanOrEqual(420 + 1);
    expect(Math.abs(narrow.dockRight - narrow.viewportWidth)).toBeLessThanOrEqual(1);
    expect(narrow.mainLeft).toBeCloseTo(0, 0);
    expect(narrow.dockLeft).toBeLessThan(narrow.mainRight);

    // The × in the overlay closes it and returns focus to the triggering control.
    await page.click('#liveDockClose');
    await expect(shell).toHaveAttribute('data-panel-mode', 'compact');
    await expect(dock).toBeHidden();
    await expect(toggle).toBeVisible();
    await expect(page.locator('#liveCount')).toBeVisible();
    const focusAfterClose = await page.evaluate(() => document.activeElement?.id ?? '');
    expect(
      focusAfterClose,
      '窄屏关闭覆盖层后，焦点应回到 #liveDockToggle（experience.md §6“关闭后焦点回到触发按钮”）',
    ).toBe('liveDockToggle');

    const evidence = [
      `600px viewport：dock position=${narrow.position} width=${narrow.dockWidth.toFixed(1)}px 右缘=${narrow.dockRight.toFixed(1)} mainLeft=${narrow.mainLeft.toFixed(1)} mainRight=${narrow.mainRight.toFixed(1)}`,
      `#liveDockClose 关闭 → data-panel-mode=compact，dock display=none，关闭后 activeElement=${focusAfterClose}`,
    ].join('；');
    await testInfo.attach('evidence', { body: evidence, contentType: 'text/plain' });
  });
  test('AC-071 · 顶栏入口的 aria-label 随面板状态更新', async ({ page }, testInfo) => {
    const fixture = browserFixture();
    await signIn(page, fixture);
    await openPage(page, fixture, `/projects/${fixture.projectId}/chief`);
    const toggle = page.locator('#liveDockToggle');
    await expect(toggle).toHaveAttribute('aria-label', 'Live panel, open');

    await pressLiveToggle(page);
    await expect(page.locator('#shell')).toHaveAttribute('data-panel-mode', 'compact');
    await expect(toggle).toHaveAttribute('data-mode', 'compact');
    const label = (await toggle.getAttribute('aria-label')) ?? '';
    expect(
      label,
      `切换后按钮声明 aria-label="${label}"，但 data-i18n-aria="${String(await toggle.getAttribute('data-i18n-aria'))}"、data-mode="compact"：可访问名称必须表达当前状态`,
    ).toBe('Live panel, compact');

    const evidence = `open → compact 后 data-mode=compact、data-i18n-aria=aria.liveDockCompact、aria-label="${label}"`;
    await testInfo.attach('evidence', { body: evidence, contentType: 'text/plain' });
  });
});
