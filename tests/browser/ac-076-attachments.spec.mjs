/**
 * AC-076 — attachment limits, in a real browser (WP-12 T7a).
 *
 * `experience.md` §3: at most 5 attachments per message, 20 MiB each, 50 MiB total, and
 * PNG/JPEG/WebP + text/Markdown/HTML/PDF only; an unsupported type is refused. WP-03
 * already proves the server refusal (no residual row); these specs prove the client half
 * in the browser: the composer shows the reason for the over-count, oversize,
 * wrong-type and over-total selections **and issues no upload at all**, while a valid
 * selection really does upload.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';

import { browserFixture, openPage, signIn } from './helpers.mjs';

const MIB = 1024 * 1024;

/** Opens the Chief composer and returns a recorder for real upload requests. */
async function composerHarness(page, fixture) {
  await signIn(page, fixture);
  await openPage(page, fixture, `/projects/${fixture.projectId}/chief`);
  await expect(page.locator('#composerAttachments')).toBeAttached();
  const uploads = [];
  // Q6: the upload URL is project-scoped; an unscoped `/artifacts/upload` no longer
  // exists, so the exact scoped path is what this recorder must observe.
  const uploadPath = `/artifacts/${fixture.projectId}/upload`;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === uploadPath) uploads.push(request.url());
  });
  return uploads;
}

/**
 * Asserts the composer reported exactly `sentence` for the rejected selection.
 *
 * The client owns these limit strings (`chief.attachment*`); since WP-12 T4 they come
 * from the embedded interface dictionary, so the assertion requires the localised
 * sentence — showing the raw key again is a regression, not an accepted wording.
 */
async function expectRejection(page, uploads, sentence) {
  const error = page.locator('#composerError');
  await expect(error).toBeVisible();
  await expect(error).toHaveAttribute('data-code', 'VALIDATION_ERROR');
  const text = (await error.textContent()) ?? '';
  expect(text).toContain('VALIDATION_ERROR');
  expect(text).toContain(sentence);
  expect(text).not.toContain('chief.attachment');
  // No file was staged and no upload was attempted: the client stopped it.
  await expect(page.locator('#stagedAttachments [data-attachment]')).toHaveCount(0);
  expect(uploads).toEqual([]);
  return text;
}

test.describe('AC-076 附件限制（浏览器侧提示）', () => {
  test('AC-076 · 超过 5 个附件：客户端提示且不上传', async ({ page }, testInfo) => {
    const fixture = browserFixture();
    const uploads = await composerHarness(page, fixture);
    const files = Array.from({ length: 6 }, (_unused, index) => ({
      name: `note-${String(index)}.md`,
      mimeType: 'text/markdown',
      buffer: Buffer.from(`# note ${String(index)}\n`, 'utf8'),
    }));
    await page.setInputFiles('#composerAttachments', files);
    const text = await expectRejection(page, uploads, 'At most 5 attachments per message.');
    const evidence = `选择 6 个 text/markdown → #composerError="${text}"；#stagedAttachments 为空；/artifacts/upload 请求数=0`;
    await testInfo.attach('evidence', { body: evidence, contentType: 'text/plain' });
  });

  test('AC-076 · 单文件超过 20 MiB：客户端提示且不上传', async ({ page }, testInfo) => {
    const fixture = browserFixture();
    const uploads = await composerHarness(page, fixture);
    await page.setInputFiles('#composerAttachments', {
      name: 'huge.txt',
      mimeType: 'text/plain',
      buffer: Buffer.alloc(21 * MIB, 0x61),
    });
    const text = await expectRejection(page, uploads, 'The attachment exceeds 20 MiB.');
    const evidence = `选择 21 MiB 的 text/plain → #composerError="${text}"；#stagedAttachments 为空；/artifacts/upload 请求数=0`;
    await testInfo.attach('evidence', { body: evidence, contentType: 'text/plain' });
  });

  test('AC-076 · 类型不支持：客户端提示且不上传', async ({ page }, testInfo) => {
    const fixture = browserFixture();
    const uploads = await composerHarness(page, fixture);
    await page.setInputFiles('#composerAttachments', {
      name: 'payload.zip',
      mimeType: 'application/zip',
      buffer: Buffer.from('PK\u0003\u0004', 'binary'),
    });
    const text = await expectRejection(
      page,
      uploads,
      'That file type is not a supported attachment type.',
    );
    const evidence = `选择 application/zip → #composerError="${text}"；#stagedAttachments 为空；/artifacts/upload 请求数=0`;
    await testInfo.attach('evidence', { body: evidence, contentType: 'text/plain' });
  });

  test('AC-076 · 合计超过 50 MiB：客户端提示且不上传', async ({ page }, testInfo) => {
    const fixture = browserFixture();
    const uploads = await composerHarness(page, fixture);
    // Playwright refuses >50 MB of in-memory buffers, so the 51 MiB selection is
    // written to disk and handed over by path — the browser still sees three real files.
    const dir = mkdtempSync(join(tmpdir(), 'agentdev-browser-attach-'));
    try {
      const paths = [];
      for (let index = 0; index < 3; index += 1) {
        const file = join(dir, `part-${String(index)}.txt`);
        writeFileSync(file, Buffer.alloc(17 * MIB, 0x62));
        paths.push(file);
      }
      await page.setInputFiles('#composerAttachments', paths);
      const text = await expectRejection(page, uploads, 'Attachments exceed 50 MiB in total.');
      const evidence = `选择 3 个 17 MiB 文件（合计 51 MiB，逐个 <20 MiB）→ #composerError="${text}"；#stagedAttachments 为空；/artifacts/upload 请求数=0`;
      await testInfo.attach('evidence', { body: evidence, contentType: 'text/plain' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('AC-076 · 切换语言后客户端提示使用所选语言', async ({ page }, testInfo) => {
    const fixture = browserFixture();
    const uploads = await composerHarness(page, fixture);
    await page.selectOption('#languageSelect', 'zh');
    // `applyLanguage` sets `data-language` synchronously, but the client dictionary is
    // merged in when the (asynchronous) `loadStrings` round-trips settle; wait for a
    // client-owned string to actually be zh before selecting the invalid files.
    await expect(page.locator('#liveDockToggle')).toHaveAccessibleName('实时面板，已展开');
    const files = Array.from({ length: 6 }, (_unused, index) => ({
      name: `note-${String(index)}.md`,
      mimeType: 'text/markdown',
      buffer: Buffer.from(`# note ${String(index)}\n`, 'utf8'),
    }));
    await page.setInputFiles('#composerAttachments', files);
    const text = await expectRejection(page, uploads, '每条消息最多 5 个附件。');
    const evidence = `语言切到 zh 并等待客户端字典生效后选择 6 个附件 → #composerError="${text}"（本地化文案而非原始 key）；/artifacts/upload 请求数=0`;
    await testInfo.attach('evidence', { body: evidence, contentType: 'text/plain' });
  });

  test('AC-076 · 对照：单个合法附件通过客户端校验并真实上传暂存', async ({ page }, testInfo) => {
    const fixture = browserFixture();
    const uploads = await composerHarness(page, fixture);
    await page.setInputFiles('#composerAttachments', {
      name: 'notes.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from('# notes\n', 'utf8'),
    });
    await expect(page.locator('#stagedAttachments [data-attachment]')).toHaveCount(1);
    await expect(page.locator('#composerError')).toBeHidden();
    await expect.poll(() => uploads.length).toBe(1);
    const stagedId = await page
      .locator('#stagedAttachments [data-attachment]')
      .first()
      .getAttribute('data-attachment');
    expect(stagedId).not.toBeNull();
    const evidence = `选择 1 个 text/markdown → 上传请求 1 次，暂存项 attachmentId=${String(stagedId)}，#composerError 隐藏（证明上一条拒绝针对具体限制而非一律拒绝）`;
    await testInfo.attach('evidence', { body: evidence, contentType: 'text/plain' });
  });
});
