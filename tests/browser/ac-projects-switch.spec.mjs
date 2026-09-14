/**
 * AC-023 / AC-024 / AC-034 — 项目切换（真 Chromium，单入口单会话；WP-12 T5.5）。
 *
 * 这一组证据驱动的不是夹具，而是**真实宿主**：`tests/browser/stack-runtime.mjs` 的
 * `openSwitcherStack()` 用 `startRuntime` 起一个安装（一个 home、一个 BFF、每个项目一个
 * 真 daemon + 真 SQLite），两个项目都经由真实 `project.create` 建出（真 `git init` +
 * 初始提交 + `agentdev/main`），各自的 Requirement 与 user Artifact 也都由真实协议命令
 * （`requirement.create`、`/artifacts/<projectId>/upload`、`conversation.message.send`）
 * 写入——**没有任何播种行**。
 *
 * 断言逐条对应 `.agentdev/work/WP-12/hardening-plan.md` G5：
 * 1. 登录一次后不再出现登录表单；`/projects` 同屏列出两个项目；
 * 2. 切换后页面归属正确，且**不存在**另一个项目的 requirement/artifact id 与标题；
 * 3. 用另一个（或未服务的）`projectId` 发 `/rpc`，得到的是**被点名项目自己的**数据，
 *    未服务项目被拒——绝不静默返回“当前项目”的数据；
 * 4. Live 订阅只流当前项目；把 A 的游标交给 B 的 socket 不会回放 A 的事件；
 * 5. 产物 URL 显式带 projectId，跨项目 token 与无项目 URL 被拒。
 */
import { expect, test } from '@playwright/test';

import { browserFixture, rpcInBrowser, signIn } from './helpers.mjs';

/** 打开 BFF 的 socket，hello + 订阅 summary，收集帧直到该订阅的批次水位。 */
async function subscribe(page, webUrl, projectId, afterCursor) {
  return page.evaluate(
    async (input) => {
      const url = `${input.webUrl.replace('http', 'ws')}/ws?projectId=${encodeURIComponent(input.projectId)}`;
      return await new Promise((resolve, reject) => {
        const frames = [];
        let subscriptionId;
        let settled = false;
        const socket = new WebSocket(url);
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          socket.close();
          reject(new Error(`timed out on ${url}`));
        }, 8_000);
        socket.addEventListener('open', () => {
          socket.send(
            JSON.stringify({
              v: 1,
              type: 'request',
              id: 'g5-hello',
              method: 'connection.hello',
              params: { protocolVersion: 1, client: 'web' },
            }),
          );
          socket.send(
            JSON.stringify({
              v: 1,
              type: 'request',
              id: 'g5-sub',
              method: 'project.subscribe',
              params: {
                scope: { kind: 'summary' },
                ...(input.afterCursor === undefined ? {} : { afterCursor: input.afterCursor }),
              },
            }),
          );
        });
        socket.addEventListener('message', (event) => {
          if (typeof event.data !== 'string') return;
          frames.push(event.data);
          const parsed = JSON.parse(event.data);
          if (parsed.id === 'g5-sub') {
            if (parsed.ok !== true) {
              clearTimeout(timer);
              socket.close();
              reject(new Error(event.data));
              return;
            }
            subscriptionId = parsed.result.subscriptionId;
          }
          if (
            subscriptionId !== undefined &&
            parsed.type === 'batch_end' &&
            parsed.subscriptionId === subscriptionId
          ) {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            socket.close();
            resolve({ subscriptionId, frames });
          }
        });
        socket.addEventListener('error', () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(new Error(`socket error on ${url}`));
        });
      });
    },
    { webUrl, projectId, afterCursor },
  );
}

/** 打开 socket 并断言升级被拒（未服务的项目在握手阶段失败关闭）。 */
async function subscribeIsRefused(page, webUrl, projectId) {
  return page.evaluate(
    async (input) => {
      const url = `${input.webUrl.replace('http', 'ws')}/ws?projectId=${encodeURIComponent(input.projectId)}`;
      return await new Promise((resolve, reject) => {
        const socket = new WebSocket(url);
        const timer = setTimeout(
          () => reject(new Error('the refused socket neither opened nor errored')),
          8_000,
        );
        socket.addEventListener('open', () => {
          clearTimeout(timer);
          socket.close();
          resolve({ opened: true });
        });
        socket.addEventListener('error', () => {
          clearTimeout(timer);
          resolve({ opened: false });
        });
        socket.addEventListener('close', (event) => {
          clearTimeout(timer);
          resolve({ opened: false, code: event.code });
        });
      });
    },
    { webUrl, projectId },
  );
}

test.describe('AC-023 / AC-024 / AC-034 项目切换（真 Chromium，单入口单会话）', () => {
  test('登录一次即可切换两个真实项目，页面/事件/产物互不串', async ({
    page,
    context,
  }, testInfo) => {
    const fixture = browserFixture();
    const switcher = fixture.switcher;
    expect(switcher, 'the two-project switcher stack fixture is missing').toBeDefined();
    const [alpha, beta] = switcher.projects;
    expect(alpha).toBeDefined();
    expect(beta).toBeDefined();

    // ---- 1. 一次登录；/projects 同屏列出两个项目 --------------------------------
    await signIn(page, switcher);
    expect(await page.locator('#loginForm').count()).toBe(0);
    await page.goto(`${switcher.webUrl}/projects`);
    await expect(page.locator('#shell')).toBeVisible();
    const projectsHtml = await page.content();
    expect(projectsHtml).toContain(`data-project="${alpha.projectId}"`);
    expect(projectsHtml).toContain(`data-project="${beta.projectId}"`);
    expect(projectsHtml).toContain('id="projectSwitcher"');
    expect(await page.locator('#loginForm').count()).toBe(0);

    // ---- 2. 切到 B：页面归属 B，且没有 A 的任何痕迹 -----------------------------
    await page.click(`#projectSwitcher a[data-project="${beta.projectId}"]`);
    await expect(page.locator(`#shell[data-project="${beta.projectId}"]`)).toBeVisible();
    await page.goto(`${switcher.webUrl}/projects/${beta.projectId}/requirements`);
    await expect(page.locator('#shell')).toBeVisible();
    // 切换是普通同源导航：会话复用，不重新登录。
    expect(await page.locator('#loginForm').count()).toBe(0);
    const betaHtml = await page.content();
    expect(betaHtml).toContain(`data-project="${beta.projectId}"`);
    expect(betaHtml).toContain(beta.requirementTitle);
    expect(betaHtml).not.toContain(alpha.requirementTitle);
    expect(betaHtml).not.toContain(alpha.requirementId);
    expect(betaHtml).not.toContain(alpha.artifactId);

    // 反向：切回 A，B 的痕迹消失，A 的回来。
    await page.goto(`${switcher.webUrl}/projects/${alpha.projectId}/requirements`);
    await expect(page.locator(`#shell[data-project="${alpha.projectId}"]`)).toBeVisible();
    const alphaHtml = await page.content();
    expect(alphaHtml).toContain(alpha.requirementTitle);
    expect(alphaHtml).not.toContain(beta.requirementTitle);
    expect(alphaHtml).not.toContain(beta.requirementId);
    expect(alphaHtml).not.toContain(beta.artifactId);
    expect(await page.locator('#loginForm').count()).toBe(0);

    // ---- 3. /rpc 的 projectId 决定答案归属，未服务项目被拒 ----------------------
    // 停在 B 的页面上，点名 A：拿到的必须是 **A 自己** 的数据，而不是“当前页面”的 B。
    const namedAlpha = await rpcInBrowser(
      page,
      switcher,
      'requirement.list',
      {},
      { projectId: alpha.projectId },
    );
    expect(JSON.stringify(namedAlpha)).toContain(alpha.requirementTitle);
    expect(JSON.stringify(namedAlpha)).not.toContain(beta.requirementTitle);
    const namedBeta = await rpcInBrowser(
      page,
      switcher,
      'requirement.list',
      {},
      { projectId: beta.projectId },
    );
    expect(JSON.stringify(namedBeta)).toContain(beta.requirementTitle);
    expect(JSON.stringify(namedBeta)).not.toContain(alpha.requirementTitle);

    // 一个本安装不服务的 projectId：拒绝，且响应体不含任何一方的数据。
    const unserved = await page.evaluate(async () => {
      const session = await (await fetch('/api/session')).json();
      const response = await fetch('/rpc', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-csrf-token': session.csrfToken ?? '' },
        body: JSON.stringify({
          v: 1,
          type: 'request',
          id: `g5-unserved-${String(Date.now())}`,
          method: 'requirement.list',
          projectId: 'f'.repeat(32),
          params: {},
        }),
      });
      return { status: response.status, body: await response.text() };
    });
    expect(unserved.status).toBe(404);
    expect(unserved.body).not.toContain(alpha.requirementTitle);
    expect(unserved.body).not.toContain(beta.requirementTitle);

    // ---- 4. Live 只流当前项目 ---------------------------------------------------
    // 从 0 重放 A 自己的事件日志：事件里的 entityId 就是真实 Requirement/Artifact id。
    const alphaStream = await subscribe(page, switcher.webUrl, alpha.projectId, 0);
    expect(JSON.stringify(alphaStream.frames)).toContain(alpha.requirementId);
    expect(JSON.stringify(alphaStream.frames)).not.toContain(beta.requirementId);
    const alphaCursor = (() => {
      for (const frame of alphaStream.frames) {
        const parsed = JSON.parse(frame);
        if (parsed.id === 'g5-sub' && parsed.result) return parsed.result.cursor ?? 0;
      }
      return 0;
    })();
    expect(alphaCursor).toBeGreaterThan(0);

    const betaFresh = await subscribe(page, switcher.webUrl, beta.projectId, 0);
    expect(JSON.stringify(betaFresh.frames)).toContain(beta.requirementId);
    expect(JSON.stringify(betaFresh.frames)).not.toContain(alpha.requirementId);

    // A 的游标交给 B 的 socket：只回放 B 自己的日志，绝不出现 A 的事件。
    const crossed = await subscribe(page, switcher.webUrl, beta.projectId, alphaCursor);
    expect(JSON.stringify(crossed.frames)).not.toContain(alpha.requirementId);
    expect(JSON.stringify(crossed.frames)).not.toContain(alpha.artifactId);
    expect(betaFresh.subscriptionId).not.toBe(alphaStream.subscriptionId);

    // 未服务项目的 socket 在握手阶段失败关闭。
    const refusedSocket = await subscribeIsRefused(page, switcher.webUrl, 'e'.repeat(32));
    expect(refusedSocket.opened).toBe(false);

    // ---- 5. 产物 URL 显式带 projectId；跨项目 token 与无项目 URL 被拒 -----------
    const ownPreview = await context.request.get(
      `${switcher.webUrl}/artifacts/${alpha.projectId}/${alpha.artifactId}/preview`,
    );
    expect(ownPreview.status()).toBe(200);
    const ownPreviewBody = await ownPreview.text();
    expect(ownPreviewBody).toContain(alpha.requirementTitle);

    const ownDownload = await context.request.get(
      `${switcher.webUrl}/artifacts/${alpha.projectId}/download/${alpha.downloadToken}`,
    );
    expect(ownDownload.status()).toBe(200);
    const downloaded = await ownDownload.text();
    expect(downloaded).toContain(alpha.requirementTitle);
    // 一次性：同一 URL 重放被拒。
    const replay = await context.request.get(
      `${switcher.webUrl}/artifacts/${alpha.projectId}/download/${alpha.downloadToken}`,
    );
    expect(replay.status()).toBe(403);

    // A 的 artifactId / B 的新 token 经 B 的路由：拒绝，且响应体不含 A 的内容。
    const crossedPreview = await context.request.get(
      `${switcher.webUrl}/artifacts/${beta.projectId}/${alpha.artifactId}/preview`,
    );
    expect(crossedPreview.status()).toBeGreaterThanOrEqual(400);
    expect(await crossedPreview.text()).not.toContain(alpha.requirementTitle);

    const betaToken = beta.downloadToken;
    const crossedDownload = await context.request.get(
      `${switcher.webUrl}/artifacts/${alpha.projectId}/download/${betaToken}`,
    );
    expect(crossedDownload.status()).toBeGreaterThanOrEqual(400);
    expect(await crossedDownload.text()).not.toContain(beta.requirementTitle);

    // 无项目段的产物 URL 已不存在（失败关闭，不回退到“当前项目”）。
    const unscoped = await context.request.get(
      `${switcher.webUrl}/artifacts/download/${betaToken}`,
    );
    expect(unscoped.status()).toBe(404);

    const evidence = [
      `一次登录后在两个项目间导航，页面始终没有 #loginForm；/projects 含 data-project="${alpha.projectId}" 与 data-project="${beta.projectId}"`,
      `B 页含 ${beta.requirementTitle}（${beta.requirementId}）且不含 A 的 ${alpha.requirementTitle}/${alpha.requirementId}/${alpha.artifactId}；A 页反向同理`,
      `在 B 页点名 A 的 /rpc 返回 A 自己的 ${alpha.requirementTitle}；未服务 projectId -> ${String(unserved.status)} 且响应体无任一方标题`,
      `Live：B socket 以 A 的 afterCursor=${String(alphaCursor)} 订阅只回放 B 的事件（无 ${alpha.requirementId}），未服务项目 socket opened=${String(refusedSocket.opened)}`,
      `产物：A 自身 preview/download 200，重放 403；A 的 artifactId 经 B 路由 ${String(crossedPreview.status())}，B 的 token 经 A 路由 ${String(crossedDownload.status())}，无项目段 /artifacts/download/<token> ${String(unscoped.status())}`,
    ].join('；');
    await testInfo.attach('evidence', { body: evidence, contentType: 'text/plain' });
  });
});
