/**
 * AC-073 — keyboard traversal, ARIA names and language switching, in a real browser
 * (WP-12 T7a).
 *
 * `experience.md` §6: every button is keyboard reachable, overlays are labelled, state
 * changes use `aria-live`, the interface language is English/简体中文 persisted on the
 * device, and **project content is never translated** (user messages, project documents
 * and Agent output).
 *
 * The traversal walks real Tab presses and reads `document.activeElement`; the language
 * spec switches the real `<select>` and asserts both the translated interface strings
 * and the untouched project content, with the page's own `/rpc` traffic as evidence that
 * project content was never sent for translation.
 */
import { expect, test } from '@playwright/test';

import { browserFixture, openPage, rpcRequests, signIn } from './helpers.mjs';

/** Describes the currently focused element the way an assertion can reason about it. */
function focusedElementScript() {
  const element = document.activeElement;
  if (element === null) return null;
  const labelledBy = element.getAttribute('aria-labelledby');
  const label =
    element.getAttribute('aria-label') ??
    (labelledBy === null ? null : document.getElementById(labelledBy)?.textContent) ??
    element.textContent ??
    element.getAttribute('title') ??
    element.getAttribute('placeholder') ??
    '';
  return {
    tag: element.tagName.toLowerCase(),
    id: element.id,
    type: element.getAttribute('type'),
    role: element.getAttribute('role'),
    name: label.replace(/\s+/gu, ' ').trim(),
  };
}

test.describe('AC-073 键盘与可访问性', () => {
  test('AC-073 · 键盘可达、ARIA 名称与 aria-live 状态', async ({ page }, testInfo) => {
    const fixture = browserFixture();
    await signIn(page, fixture);
    await openPage(page, fixture, `/projects/${fixture.projectId}/chief`);

    // The skip link is first in DOM order and moves focus into the main landmark.
    await page.keyboard.press('Tab');
    const first = await page.evaluate(focusedElementScript);
    expect(first?.tag).toBe('a');
    expect(first?.name).toBe('Skip to main content');
    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('main');

    // Named landmarks and controls, computed by the browser's accessibility engine.
    await expect(page.locator('#main')).toHaveAccessibleName('Project workspace');
    await expect(page.locator('#liveDock')).toHaveAccessibleName('Live panel');
    await expect(page.locator('#liveDockToggle')).toHaveAccessibleName('Live panel, open');
    await expect(page.locator('#languageSelect')).toHaveAccessibleName('Interface language');
    await expect(page.locator('#composerBody')).toHaveAccessibleName('Message the Chief');
    await expect(page.locator('#composerSend')).toHaveAccessibleName('Send message');
    await expect(page.locator('a[data-page="chief"]')).toHaveAccessibleName('Chief conversation');
    await expect(page.locator('#messages')).toHaveAccessibleName('Conversation messages');
    await expect(page.locator('#liveEvents')).toHaveAccessibleName('Live event stream');

    // Live regions announce connection, messages, staged attachments and the stream.
    await expect(page.locator('#connectionState')).toHaveAttribute('role', 'status');
    await expect(page.locator('#connectionState')).toHaveAttribute('aria-live', 'polite');
    await expect(page.locator('#messages')).toHaveAttribute('aria-live', 'polite');
    await expect(page.locator('#liveEvents')).toHaveAttribute('aria-live', 'polite');
    await expect(page.locator('#stagedAttachments')).toHaveAttribute('aria-live', 'polite');
    await expect(page.locator('#composerError')).toHaveAttribute('role', 'alert');

    // Real keyboard traversal of the whole document: every stop is an interactive
    // control with a name. The page is re-opened first because activating the skip link
    // moved focus past the top bar and the navigation.
    await openPage(page, fixture, `/projects/${fixture.projectId}/chief`);
    const stops = [];
    let reachedLanguageSelect = false;
    let skipSeen = 0;
    for (let index = 0; index < 80; index += 1) {
      await page.keyboard.press('Tab');
      const current = await page.evaluate(focusedElementScript);
      if (current === null || current.tag === 'body' || current.tag === 'html') break;
      if (current.tag === 'a' && current.name === 'Skip to main content') {
        skipSeen += 1;
        if (skipSeen > 1) break;
      }
      stops.push(current);
      if (current.id === 'languageSelect') reachedLanguageSelect = true;
    }
    expect(stops.length).toBeGreaterThanOrEqual(15);
    expect(reachedLanguageSelect).toBe(true);
    const unnamed = stops.filter(
      (stop) =>
        ['a', 'button', 'input', 'select', 'textarea'].includes(stop.tag) && stop.name === '',
    );
    expect(unnamed).toEqual([]);
    const unexpected = stops.filter(
      (stop) => !['a', 'button', 'input', 'select', 'textarea'].includes(stop.tag),
    );
    expect(unexpected).toEqual([]);

    const evidence = [
      `Tab #1 → ${first?.tag}#${first?.id || '(skip-link)'} name="${first?.name}"；Enter → 焦点 #main`,
      `遍历 ${String(stops.length)} 个可聚焦控件（含 #languageSelect=${String(reachedLanguageSelect)}），无未命名控件，无不可聚焦元素进入顺序`,
      `ARIA: #liveDock="Live panel" #liveDockToggle="Live panel, open" #languageSelect="Interface language" #composerBody="Message the Chief"；aria-live 区域 #connectionState/#messages/#liveEvents/#stagedAttachments`,
    ].join('；');
    await testInfo.attach('evidence', { body: evidence, contentType: 'text/plain' });
  });

  test('AC-073 · 界面语言切换生效且不翻译项目内容', async ({ page, context }, testInfo) => {
    const fixture = browserFixture();
    await signIn(page, fixture);
    await openPage(page, fixture, fixture.requirementPath);

    const title = page.locator('#requirementTitle');
    const projectName = page.locator('a.project-name');
    const titleBefore = (await title.textContent()) ?? '';
    const projectBefore = (await projectName.textContent()) ?? '';
    expect(titleBefore).toContain('HTML 说明产物隔离预览');
    expect(projectBefore.length).toBeGreaterThan(0);

    const requests = [];
    page.on('request', (request) => {
      requests.push({ url: request.url(), postData: request.postData() ?? '' });
    });

    await page.selectOption('#languageSelect', 'zh');
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
    await expect(page.locator('#shell')).toHaveAttribute('data-language', 'zh');
    await expect(page.locator('a[data-page="chief"] .nav-text')).toHaveText('主管');

    // The switch reaches the strings the *client* owns, not only the daemon catalogue:
    // the Live panel's accessible names and the dynamically rendered controls follow the
    // chosen language in place (the WP-12 T7a gap showed the previous mode's English
    // label surviving here; the fix is the embedded `#uiStrings` dictionary).
    await expect(page.locator('#liveDock')).toHaveAccessibleName('实时面板');
    await expect(page.locator('#liveDockToggle')).toHaveAccessibleName('实时面板，已展开');
    const download = page.locator('button[data-download-artifact]');
    await expect(download).toHaveText('下载完整产物');
    // The device-local choice is written where the server reads it back.
    const languageCookie = (await context.cookies()).find(
      (cookie) => cookie.name === 'agentdev_language',
    );
    expect(languageCookie?.value).toBe('zh');

    // Project content is untouched and explicitly marked non-translatable.
    await expect(title).toHaveText(titleBefore);
    await expect(title).toHaveAttribute('data-translatable', 'false');
    await expect(projectName).toHaveText(projectBefore);
    await expect(projectName).toHaveAttribute('data-translatable', 'false');

    // The page only ever asked the daemon to translate interface keys.
    const translateCalls = rpcRequests(requests).filter((entry) => entry.method === 'ui.translate');
    expect(translateCalls.length).toBeGreaterThan(0);
    const projectContentLeaked = translateCalls.filter((entry) => {
      const body = JSON.stringify(entry.params ?? {});
      return body.includes(titleBefore) || body.includes(projectBefore);
    });
    expect(projectContentLeaked).toEqual([]);

    // The choice is device-local and is applied again after a real reload — now for the
    // whole page, because the cookie makes the server render the first paint in `zh`.
    expect(await page.evaluate(() => window.localStorage.getItem('agentdev.language'))).toBe('zh');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
    await expect(page.locator('a[data-page="chief"] .nav-text')).toHaveText('主管');
    await expect(page.locator('#requirementTitle')).toHaveText(titleBefore);
    await expect(page.locator('button[data-download-artifact]')).toHaveText('下载完整产物');
    // A page the client never opened still renders from the cookie (server-side path).
    await openPage(page, fixture, '/settings');
    await expect(page.locator('#configSave')).toHaveText('保存配置');

    const evidence = [
      '切换到 zh：html[lang]=zh-CN，nav Chief→主管，cookie agentdev_language=zh，localStorage(agentdev.language)=zh',
      '客户端自有字符串随切换生效：#liveDock aria-label=实时面板、#liveDockToggle=实时面板，已展开、下载按钮=下载完整产物',
      `项目内容未翻译：#requirementTitle="${titleBefore}" 保持不变且 data-translatable="false"；project-name="${projectBefore}" 不变`,
      `ui.translate 调用 ${String(translateCalls.length)} 次，未包含任何项目内容（标题/项目名泄漏=0）`,
      'reload 后整页仍为 zh；未在客户端打开过的 /settings 也由服务端按 cookie 渲染为「保存配置」',
    ].join('；');
    await testInfo.attach('evidence', { body: evidence, contentType: 'text/plain' });
  });
});
