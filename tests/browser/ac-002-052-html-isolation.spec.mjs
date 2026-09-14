/**
 * AC-002 / AC-052 — HTML artifact isolation preview, in a real browser (WP-12 T7a).
 *
 * `experience.md` §3 and `execution.md` §6 promise that an HTML explanation renders in
 * an isolated preview and downloads as a file, and that an artifact whose script tries
 * to read the session cookie, reach the network or touch the parent page is stopped.
 *
 * The fixture artifact is a real HTML explanation stored through the real
 * `ArtifactService`; its own inline script runs the three attack samples and writes the
 * outcomes into `#attack-results`. The spec reads that element through Playwright's
 * frame handle, checks the response headers the daemon actually served, and confirms
 * the loopback attack probe observed nothing.
 */
import { readFileSync } from 'node:fs';

import { expect, test } from '@playwright/test';

import { PREVIEW_MARKER } from './constants.mjs';
import {
  browserFixture,
  gitRevision,
  gitStatus,
  openPage,
  previewFrame,
  previewPath,
  signIn,
} from './helpers.mjs';

test.describe('AC-002 / AC-052 HTML 产物隔离预览', () => {
  test('AC-002 · HTML 说明在隔离 iframe 内渲染且一次性下载可用，不写入源码', async ({
    page,
    context,
  }, testInfo) => {
    const fixture = browserFixture();
    const previewResponses = [];
    page.on('response', (response) => {
      if (response.url().includes('/preview')) previewResponses.push(response);
    });

    await signIn(page, fixture);
    await openPage(page, fixture, fixture.requirementPath);

    const card = page.locator(`li.artifact[data-artifact="${fixture.htmlArtifactId}"]`);
    await expect(card).toHaveCount(1);
    await expect(card).toHaveAttribute('data-validity', 'valid');

    const iframe = card.locator('iframe[data-preview-href]');
    await expect(iframe).toHaveCount(1);
    const sandbox = await iframe.getAttribute('sandbox');
    expect(sandbox).toBe('allow-scripts');
    expect(sandbox ?? '').not.toContain('allow-same-origin');

    const frame = await previewFrame(page);
    await expect(frame.locator('#marker')).toHaveText(PREVIEW_MARKER);
    // The frame is a real document with a real body, not an error page.
    expect(await frame.title()).toBe('HTML 说明产物');

    // The real served response: CSP, sandbox and credential policy come from the
    // daemon and are copied through the BFF — never from a test double.
    expect(previewResponses.length).toBeGreaterThan(0);
    const headers = previewResponses[0].headers();
    expect(headers['content-security-policy']).toContain("default-src 'none'");
    expect(headers['content-security-policy']).toContain("connect-src 'none'");
    expect(headers['content-security-policy']).toContain("script-src 'unsafe-inline'");
    expect(headers['x-agentdev-preview-sandbox']).toBe('allow-scripts');
    expect(headers['x-agentdev-preview-credentials']).toBe('omit');
    expect(headers['content-type']).toContain('text/html');
    expect(headers['cache-control']).toBe('no-store');
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(previewResponses[0].status()).toBe(200);

    // The one-time download really returns the artifact's bytes…
    const downloadPromise = page.waitForEvent('download');
    await card.locator('button[data-download-artifact]').click();
    const download = await downloadPromise;
    expect(await download.failure()).toBeNull();
    const downloadPath = await download.path();
    const downloaded = readFileSync(downloadPath, 'utf8');
    expect(downloaded).toContain(PREVIEW_MARKER);
    expect(downloaded).toContain('attack-results');
    expect(download.url()).toContain('/artifacts/download/');
    // …and the token is consumed exactly once: replaying the same URL is refused.
    const replay = await context.request.get(download.url());
    expect(replay.status()).toBe(403);

    // Generating the artifact, previewing it and downloading it changed no source:
    // the browser half of "仅 Artifact 写入、无交付 Gate / 源码变更".
    expect(await context.cookies()).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'agentdev_web' })]),
    );
    expect(gitRevision(fixture.repoRoot)).toBe(fixture.seedRevision);
    expect(gitStatus(fixture.repoRoot)).toBe('');

    const evidence = [
      `artifact ${fixture.htmlArtifactId} 在 ${fixture.requirementPath} 渲染于 sandbox="${sandbox}" 的 iframe`,
      `预览响应 200 CSP[default-src 'none'; connect-src 'none'] x-agentdev-preview-sandbox=allow-scripts x-agentdev-preview-credentials=omit content-type=${String(headers['content-type'])}`,
      `下载下载字节含 ${PREVIEW_MARKER}，URL ${new URL(download.url()).pathname.replace(/\/[^/]+$/u, '/<token>')}，重放同 token 被拒绝 403`,
      `临时项目 HEAD=${gitRevision(fixture.repoRoot).slice(0, 12)}（未变）且 git status 为空`,
    ].join('；');
    await testInfo.attach('evidence', { body: evidence, contentType: 'text/plain' });
  });

  test('AC-052 · 预览内脚本读取 cookie／网络／父页全部被隔离阻止', async ({
    page,
    context,
  }, testInfo) => {
    const fixture = browserFixture();
    // Chromium reports a CSP-blocked XHR/image as a *failed* request (and no response),
    // so "no network" is asserted from the browser's real request lifecycle and from
    // the loopback probe's own counter rather than from "no request event".
    const responses = [];
    const failed = [];
    page.on('response', (response) => responses.push(response.url()));
    page.on('requestfailed', (request) =>
      failed.push({ url: request.url(), errorText: request.failure()?.errorText ?? '' }),
    );

    await signIn(page, fixture);
    await openPage(page, fixture, fixture.requirementPath);
    const frame = await previewFrame(page);
    const topUrlBefore = page.url();

    const resultsElement = frame.locator('#attack-results');
    await expect(resultsElement).not.toBeEmpty();
    const results = JSON.parse((await resultsElement.textContent()) ?? '{}');

    // The artifact's own script ran inside the frame and recorded every attempt.
    expect(results.marker).toBe(true);
    expect(results.origin).toBe('null');

    // Reading the workbench cookie fails (opaque origin), even though the browser
    // session it would steal does exist.
    expect(results.cookie === '' || results.cookieError !== null).toBe(true);
    const sessionCookies = await context.cookies();
    expect(sessionCookies.some((cookie) => cookie.name === 'agentdev_web')).toBe(true);

    // Reaching the parent page fails, and the parent is never navigated.
    expect(results.parentError).not.toBeNull();
    expect(results.parentDocument).toBeNull();
    expect(results.topTitleError).not.toBeNull();
    expect(results.topNavigation).not.toBe('navigated');
    expect(page.url()).toBe(topUrlBefore);

    // Storage is unavailable too: the frame shares no origin with the workbench.
    expect(results.localStorage).toBeNull();
    expect(results.localStorageError).not.toBeNull();

    // Network is blocked by the served CSP for fetch, XHR and images.
    expect(String(results.fetchProbe)).toMatch(/^rejected:/u);
    expect(String(results.fetchSameOrigin)).toMatch(/^rejected:/u);
    expect(String(results.xhrProbe)).not.toMatch(/^loaded:/u);
    expect(String(results.imageProbe)).not.toBe('loaded');
    // No response ever came from the probe, and the attempts Chromium did report were
    // refused by the page's own Content Security Policy.
    expect(responses.filter((url) => url.startsWith(fixture.probeUrl))).toEqual([]);
    const probeFailures = failed.filter((entry) => entry.url.startsWith(fixture.probeUrl));
    expect(probeFailures.length).toBeGreaterThanOrEqual(2);
    expect(probeFailures.every((entry) => entry.errorText === 'csp')).toBe(true);

    // Independent, Playwright-side confirmation of the same facts.
    expect(await frame.evaluate(() => String(window.origin))).toBe('null');
    // Reading `document.cookie` in the sandboxed frame throws outright in Chromium.
    const cookieProbe = await frame.evaluate(() => {
      try {
        return document.cookie;
      } catch (error) {
        return `blocked:${error instanceof Error ? error.name : String(error)}`;
      }
    });
    expect(['', 'blocked:SecurityError']).toContain(cookieProbe);
    expect(
      await frame.evaluate(() => {
        try {
          void window.parent.document.body;
          return 'read';
        } catch (error) {
          return error instanceof Error ? error.name : String(error);
        }
      }),
    ).toBe('SecurityError');

    // The loopback attack probe the artifact tried to reach saw nothing at all.
    const probeAnswer = await context.request.get(`${fixture.probeUrl}/__agentdev_attack_count`);
    const probe = await probeAnswer.json();
    expect(probe.attacks).toBe(0);

    // The normal static explanation is still usable (the marker rendered above).
    const evidence = [
      `frame origin=${String(results.origin)} cookie=${JSON.stringify(results.cookie)} cookieError=${String(results.cookieError)}（会话 cookie agentdev_web 确实存在）`,
      `parent.document=${String(results.parentError)} top.title=${String(results.topTitleError)} topNavigation=${String(results.topNavigation)}（父页 URL 未变）`,
      `fetch(probe)=${String(results.fetchProbe)} fetch(/api/session)=${String(results.fetchSameOrigin)} xhr=${String(results.xhrProbe)} img=${String(results.imageProbe)}`,
      `探针自计数 attacks=${String(probe.attacks)}；探针 URL 的浏览器响应数=0；被 CSP 拒绝的探针请求=${String(probeFailures.length)}（errorText=${[...new Set(probeFailures.map((entry) => entry.errorText))].join(',')}）；localStorage=${String(results.localStorageError)}`,
    ].join('；');
    await testInfo.attach('evidence', { body: evidence, contentType: 'text/plain' });
  });

  test('AC-002 · 预览路由只暴露受权 Artifact（未登录会话被 BFF 拒绝）', async ({
    browser,
  }, testInfo) => {
    const fixture = browserFixture();
    // A fresh context has no session cookie: the preview must not be reachable.
    const anonymous = await browser.newContext();
    const response = await anonymous.request.get(`${fixture.webUrl}${previewPath(fixture)}`);
    expect(response.status()).toBe(401);
    const body = await response.text();
    expect(body).toContain('UNAUTHENTICATED');
    await anonymous.close();
    const evidence = `匿名上下文请求 ${previewPath(fixture)} → ${String(response.status())} ${body.slice(0, 80)}`;
    await testInfo.attach('evidence', { body: evidence, contentType: 'text/plain' });
  });
});
