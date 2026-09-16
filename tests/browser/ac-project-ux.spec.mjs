/**
 * WP-12 project UX: loading and switching projects is a browser-only experience.
 *
 * This spec starts from a **real installation with no project at all** (`agentdev
 * start` with an empty registry, `stack-runtime.mjs` `openEmptyStack`) and drives the
 * whole product flow in a real Chromium:
 *
 * `agentdev start`（零项目）→ 登录 → /projects 首次引导 → 文件夹选择器（粘贴路径/上级/根）
 * → 新建项目目录 → 打开已有仓库 → 一次性信任提示（信任并开始工作 / 暂时只读）
 * → 两个项目之间切换。
 *
 * It also pins the picker's refusals in the browser: a file path is refused with its
 * error code, and no file body ever reaches the entries list.
 */
import { expect, test } from '@playwright/test';
import { browserFixture, signIn } from './helpers.mjs';

/** Signs in on the zero-project installation and lands on `/projects`. */
async function gotoProjects(page, fixture) {
  await page.goto(`${fixture.webUrl}/projects`);
  await expect(page.locator('#shell')).toBeVisible();
}

/** Opens the picker, navigates to one absolute path, and returns the entries text. */
async function pickerGoto(page, path) {
  await expect(page.locator('#folderPicker')).toBeVisible();
  // Let the dialog's own first listing (the home directory) settle before typing: the
  // picker must not see a keystroke racing its own render.
  await expect
    .poll(async () => page.locator('#pickerEntries').getAttribute('data-path'), { timeout: 15_000 })
    .not.toBe(null);
  await page.fill('#pickerPath', path);
  await page.click('#pickerPathForm button[type="submit"]');
  // The list names the directory it represents: that attribute is the deterministic
  // signal that the listing for *this* path rendered (the server canonicalises, e.g.
  // /var → /private/var, so the basename is the stable part).
  const last = path.split('/').filter(Boolean).at(-1) ?? path;
  await expect
    .poll(async () => page.locator('#pickerEntries').getAttribute('data-path'), { timeout: 15_000 })
    .toContain(last);
  return page.locator('#pickerEntries').innerText();
}

test.describe('零项目启动与浏览器内项目加载（WP-12 project UX）', () => {
  test('AC-023 / AC-024 / AC-025：零项目启动 → 选择文件夹 → 信任提示 → 打开 → 切换 (AC-023/AC-024/AC-025)', async ({
    page,
  }, testInfo) => {
    const fixture = browserFixture();
    const empty = fixture.empty;
    expect(empty, 'the zero-project stack fixture is missing').toBeDefined();

    // 1. `agentdev start` with no project: the one UI signs in and guides the user.
    await signIn(page, empty);
    await gotoProjects(page, empty);
    const firstRun = await page.content();
    expect(firstRun).toContain('data-i18n="projects.firstRunTitle"');
    expect(firstRun).toContain('data-i18n="projects.firstRunHint"');
    expect(firstRun).toContain('id="openFolder"');
    expect(firstRun).toContain('id="createFolder"');
    // No project row, no dead project link, and the switcher is honestly absent.
    expect(await page.locator('.project-row').count()).toBe(0);
    expect(await page.locator('a[href="/projects/project/chief"]').count()).toBe(0);

    // 2. Create a new project folder: the picker starts at the human's home directory,
    //    can jump to the filesystem root, and accepts a pasted path.
    await page.click('#createFolder');
    await expect(page.locator('#folderPicker')).toBeVisible();
    await expect.poll(async () => page.inputValue('#pickerPath'), { timeout: 15_000 }).not.toBe('');
    const homePath = await page.inputValue('#pickerPath');
    expect(homePath.startsWith('/')).toBe(true);
    await page.click('#pickerRoot');
    await expect.poll(async () => page.inputValue('#pickerPath')).toBe('/');
    await pickerGoto(page, empty.createRoot);
    // The folder is empty: the only row is the "parent folder" affordance, so no
    // directory entry is offered and "Use this folder" is the creating act.
    await expect(page.locator('#pickerEntries li[data-kind]')).toHaveCount(0);
    await expect(page.locator('#pickerEntries li.picker-empty')).toHaveCount(1);

    await page.fill('#pickerName', 'Browser Created');
    await page.click('#pickerSelect');
    await page.waitForURL(/\/projects\/[^/]+\/chief$/u, { timeout: 30_000 });
    await expect(page.locator('#shell')).toBeVisible();
    const createdId = new URL(page.url()).pathname.split('/').filter(Boolean)[1];

    await gotoProjects(page, empty);
    const createdRow = page.locator(`.project-row[data-project="${createdId}"]`);
    await expect(createdRow).toBeVisible();
    // A folder the user just created is trusted by the creating act itself.
    await expect(createdRow).toHaveAttribute('data-trust', 'trusted');

    // 3. Open an existing folder: the picker lists names only, refuses a file path, and
    //    the selection raises the one-time trust prompt.
    await page.click('#openFolder');
    await expect(page.locator('#folderPicker')).toBeVisible();
    await page.fill('#pickerPath', `${empty.repoRoot}/NOTES.md`);
    await page.click('#pickerPathForm button[type="submit"]');
    await expect(page.locator('#projectsError')).toContainText('VALIDATION_ERROR');
    const refusedText = await page.locator('#projectsError').innerText();
    expect(refusedText).not.toContain(empty.repoMarker);

    const entries = await pickerGoto(page, empty.repoRoot);
    expect(entries).toContain('NOTES.md');
    expect(entries).toContain('.hidden-note');
    // Names only: the marker inside NOTES.md never reaches the browser.
    expect(entries).not.toContain(empty.repoMarker);
    const pickerHtml = await page.locator('#folderPicker').innerHTML();
    expect(pickerHtml).not.toContain(empty.repoMarker);

    await page.click('#pickerSelect');
    await expect(page.locator('#trustPrompt')).toBeVisible();
    const trustHtml = await page.content();
    expect(trustHtml).toContain('data-i18n="projects.trust"');
    expect(trustHtml).toContain('data-i18n="projects.readOnly"');
    await page.click('#trustAccept');
    await page.waitForURL(/\/projects\/[^/]+\/chief$/u, { timeout: 30_000 });
    const openedId = new URL(page.url()).pathname.split('/').filter(Boolean)[1];
    expect(openedId).not.toBe(createdId);

    await gotoProjects(page, empty);
    const openedRow = page.locator(`.project-row[data-project="${openedId}"]`);
    await expect(openedRow).toBeVisible();
    await expect(openedRow).toHaveAttribute('data-trust', 'trusted');

    // 4. Switch between the two projects with the real switcher.
    await expect(page.locator('#projectSwitcher')).toBeVisible();
    await page.click(`#projectSwitcher a[data-project="${createdId}"]`);
    await expect(page.locator(`#shell[data-project="${createdId}"]`)).toBeVisible();
    await page.click(`#projectSwitcher a[data-project="${openedId}"]`);
    await expect(page.locator(`#shell[data-project="${openedId}"]`)).toBeVisible();

    // 5. The recorded trust can be changed later on the project row, and the state is
    //    reported honestly in words.
    await gotoProjects(page, empty);
    await page.click(`.project-row[data-project="${openedId}"] button[data-action="trust"]`);
    await expect
      .poll(
        async () =>
          page.locator(`.project-row[data-project="${openedId}"]`).getAttribute('data-trust'),
        {
          timeout: 20_000,
        },
      )
      .toBe('untrusted');
    await expect(page.locator(`.project-row[data-project="${openedId}"]`)).toContainText(
      'read-only (untrusted)',
    );
    await page.click(`.project-row[data-project="${openedId}"] button[data-action="trust"]`);
    await expect
      .poll(
        async () =>
          page.locator(`.project-row[data-project="${openedId}"]`).getAttribute('data-trust'),
        {
          timeout: 20_000,
        },
      )
      .toBe('trusted');

    const evidence = [
      `零项目启动：BFF ${empty.webUrl} 登录成功并渲染 projects.firstRunTitle；项目行数 0、无 /projects/project/chief 死链`,
      `文件夹选择器：起点 ${homePath}，可跳到 /，粘贴路径后可列出目录名（NOTES.md、.hidden-note）；文件路径被拒 ${refusedText}`,
      `选择器不回显文件内容：条目文本与弹层 HTML 均不含项目文件正文标记`,
      `新建项目 ${createdId}（data-trust=trusted）；打开已有仓库 ${openedId}：一次信任提示后 data-trust=trusted，可后续改回 untrusted 再信任`,
      `切换：projectSwitcher 在两个项目间往返，shell[data-project] 分别为 ${createdId} 与 ${openedId}`,
    ].join('；');
    await testInfo.attach('evidence', { body: evidence, contentType: 'text/plain' });
  });

  test('AC-023：暂时只读的信任选择被真实记录，项目保持未信任 (AC-023)', async ({
    page,
  }, testInfo) => {
    const fixture = browserFixture();
    const empty = fixture.empty;
    await signIn(page, empty);
    await gotoProjects(page, empty);

    await page.click('#openFolder');
    await expect(page.locator('#folderPicker')).toBeVisible();
    await pickerGoto(page, empty.readOnlyRoot);
    await page.click('#pickerSelect');
    await expect(page.locator('#trustPrompt')).toBeVisible();
    await page.click('#trustReadOnly');
    await page.waitForURL(/\/projects\/[^/]+\/chief$/u, { timeout: 30_000 });
    const readOnlyId = new URL(page.url()).pathname.split('/').filter(Boolean)[1];

    await gotoProjects(page, empty);
    const row = page.locator(`.project-row[data-project="${readOnlyId}"]`);
    await expect(row).toBeVisible();
    await expect(row).toHaveAttribute('data-trust', 'untrusted');
    await expect(row).toContainText('read-only (untrusted)');

    const evidence = `暂时只读：打开 ${empty.readOnlyRoot} 后选择 projects.readOnly，project.trust{trusted:false} 落库，项目行 data-trust=untrusted 且显示 “read-only (untrusted)”（只看不改）`;
    await testInfo.attach('evidence', { body: evidence, contentType: 'text/plain' });
  });
});
