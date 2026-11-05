# WP-12 T7a 实现记录（真实浏览器验证基础设施：Playwright + 真实 Chromium 套件）

- 基线：本工作树（`HEAD 7c723ec` + 其他车道的未提交改动；T7a 只改 `scripts/**`、`tests/browser/**`、`eslint.config.js`、`package.json`/`pnpm-lock.yaml` 与三份文档）。
- 授权：用户已撤销 WP-10 plan.md §2 D1「不引入 Playwright」的决定，批准把 Playwright 作为**仅开发依赖**引入。
- 范围：安装 Playwright（仅根 devDependency）、把浏览器侧 AC 的真实取证做成 `pnpm test:e2e` 的一部分、让 `browser-absent` 豁免按环境现场判定。
- 明确不做：不改 `packages/**`、不改 `apps/web/**`（缺的 UI 行为只报告不实现）、不改任何 AC 定义、不新增/改名十条工程命令（只新增便于单跑的 `pnpm test:browser`）。

## 1. 安装（真实命令与输出）

```text
$ pnpm add -D -w @playwright/test@1.63.0
✓ Lockfile passes supply-chain policies (verified 1h ago)
Packages: +3
devDependencies:
+ @playwright/test 1.63.0
Done in 10.7s using pnpm v12.3.4
EXIT=0

$ pnpm exec playwright install chromium
Removing unused browser at /Users/huyaohua/Library/Caches/ms-playwright/chromium-1179
Downloading Chrome for Testing 153.0.8010.12 (playwright chromium v1243) from
  https://cdn.playwright.dev/builds/cft/153.0.8010.12/mac-arm64/chrome-mac-arm64.zip
  … 100% of 182.1 MiB
Chrome for Testing 153.0.8010.12 (playwright chromium v1243) downloaded to
  /Users/huyaohua/Library/Caches/ms-playwright/chromium-1243
Downloading Chrome Headless Shell 153.0.8010.12 (playwright chromium-headless-shell v1243) … 100% of 94.3 MiB
EXIT=0
```

- `@playwright/test` 只在根 `devDependencies`；`packages/*`、`apps/*` 的依赖与运行时代码未变。
- macOS 上不需要 `--with-deps`（未执行，浏览器可直接启动）。
- 浏览器二进制放在用户缓存目录（`~/Library/Caches/ms-playwright/chromium-1243`），仓库内只新增 `node_modules/.cache/agentdev-browser/`（被 `.gitignore` 覆盖）与 `tests/browser/**`。

## 2. 新增/修改的文件

### 复用真实栈

- `scripts/lib/e2e-stack.mjs`（新增）：把 `scripts/e2e.mjs` 原有的 `bootStack`、`featureMarkdown`、`readFeatureDocuments`、`seedWork` 与项目常量**原样搬出**，成为「真实栈」的唯一启动入口（临时 Git + 真实 SQLite + 真实 Core + 真实 `createDaemon` + 真实 BFF，全部回环临时端口）。新增 `options.allowedOrigins`（按引用传入）：BFF 的精确 Origin 白名单只有 `listen(0)` 之后才知道真实端口，浏览器套件因此能在启动后把自己那个临时回环 Origin 加入白名单；`scripts/e2e.mjs` 的行为不变（仍只允许 `WEB_ORIGIN`）。
- `scripts/lib/e2e-runtime.mjs`：新增导出 `ensure`（drill 与 stack 共用一个断言助手，避免两份漂移）。

### 浏览器套件（Playwright runner）

- `tests/browser/playwright.config.mjs`：`workers: 1`、`retries: 0`、`globalSetup/globalTeardown`、自定义 reporter、`headless` Chromium；产物只写 `node_modules/.cache/agentdev-browser/`。
- `tests/browser/global-setup.mjs` / `global-teardown.mjs` / `stack-runtime.mjs`：启动**真实栈**（沿用 `scripts/e2e.mjs` 的离线 Provider 桩：501 + 计数），把 `AGENTDEV_HOME` 指向临时 state 目录，另起一个回环「攻击探针」服务器（只用于验证预览帧有没有真的发出网络请求），并种下夹具：真实 Work + 真实 Run + 真实 `ArtifactService` 生成的 **text/html 说明产物**（内含攻击脚本，结果写进 `#attack-results`）、真实 Requirement（详情页）、一个 `running` 的 Run（AC-071「不打扰 Run」）。结束关闭全部监听与临时目录。
- `tests/browser/reporter.mjs`：把每个 spec 的标题、AC 编号（只取**用例自身标题**，避免 `describe` 名字把「记录缺口」误挂到某个 AC）、Playwright 状态、`evidence` 附件正文、首个错误与 `fixme` 缺口说明写成 JSON（`AGENTDEV_BROWSER_REPORT`）。
- `tests/browser/helpers.mjs` / `fixtures.mjs`(常量、fixture 路径) / `constants.mjs`：真实登录表单登录、读取夹具、定位隔离预览 frame、在页面内调用真实 `/rpc`、真实 `git` 校验。
- 4 个 spec 文件、16 个用例：
  - `ac-002-052-html-isolation.spec.mjs`：AC-002（隔离 iframe 渲染真实 HTML + 真实响应头 + 一次性下载与重放 403 + 未登录 401 + 临时项目 HEAD/`git status` 未变）、AC-052（页面内脚本读 cookie/`parent.document`/`top`/localStorage/`fetch`/XHR/`img` 全部失败，Playwright 侧 `origin=null`、`SecurityError` 独立复核，攻击探针自计数 `attacks=0`、无一响应来自探针、CSP 拒绝的请求 `errorText=csp`）。
  - `ac-071-live-layout.spec.mjs`：三态与 `--dock=clamp(360px,38%,560px)` 的真实像素/网格轨道、键盘驱动状态机、跨页保持、切换期间零 `/rpc`、`run.get` 前后完全一致；顶栏恢复入口是否在视口内且可指针点击；窄屏覆盖层与关闭后焦点；顶栏按钮 `aria-label` 是否随状态更新。
  - `ac-073-a11y-i18n.spec.mjs`：真实 Tab 遍历（22 个可聚焦控件，全部有可访问名称、无不可聚焦元素进入顺序）、跳转链接与 `#main`、ARIA/`aria-live` 属性、语言切换到 zh 后 `html[lang]`/`data-language`/界面字符串变化、项目内容（需求标题、项目名）逐字不变且 `data-translatable="false"`、`ui.translate` 调用正文不含项目内容、localStorage 持久化 + reload；另有一个**不挂 AC** 的 `fixme` 记录缺口（见 §5）。
  - `ac-076-attachments.spec.mjs`：超 5 个、单文件 21 MiB、`application/zip`、合计 51 MiB 四种客户端拒绝（`#composerError` 可见、`data-code=VALIDATION_ERROR`、`#stagedAttachments` 为空、`/artifacts/upload` 请求数 0），外加一个对照用例（单个合法 `.md` 真实上传且暂存成功）。

### 接入契约命令与豁免判定

- `scripts/e2e.mjs`：`runChecks` 末尾新增 `runBrowserChecks`——浏览器可用时运行 `tests/browser/**`，把每个 AC 的结论用 `CheckList.record()` 记为 `browser.html-preview-and-download` / `browser.html-attack-samples` / `browser.live-layout` / `browser.keyboard-aria-i18n` / `browser.attachment-client-hints`，并把套件里的「记录缺口」打印成 `browser: GAP …` 且追加进演练残余；浏览器确实不可用时才回落到 3 条 `UNVERIFIED`（带缺失输入原因）。仍在本命令内启动，命令名与调用方式未变。
- `scripts/lib/e2e-checks.mjs`：新增 `CheckList.record(name, acs, status, evidence)`（其它 runner 产生的结论；`PASS` 必须有证据文本，首个 `FAIL` 记为 `checks.failure` 供最终原始输出打印）。
- `scripts/lib/browser-suite.mjs`（新增）：`browserAvailability()`（包可解析 **且** Chromium 可执行文件存在）、`runBrowserSuite()`（spawn `node_modules/.bin/playwright`，校验报告、按 AC 取最弱一环、导出 `gaps`）。
- `scripts/lib/drill-acs.mjs`：五个浏览器 AC 的登记项加 `closedBy: 'pnpm test:e2e'`（这正是聚合器关闭豁免的机制，缺它时 PASS 会被 `acceptance-evidence.mjs` 降级为 UNVERIFIED）；`conditionHolds('browser-absent')` 改为现场判定（`browserAvailable()`），`recorded-gap`（AC-066/AC-090）分支一行未改；相关注释与 `decision` 文本更新为「D1 已被 T7a 撤销」。
- `scripts/lib/acceptance-drills.mjs`：`pnpm test:e2e` 的 `allowedExitCodes` 由 `[0]` 改为 `[0,1]`——退出码 1 是 drill 自己「有检查失败」的码，报告里就是逐 AC 的 `FAIL`；同时新增一致性校验（报告的 `exitCode` 必须与进程退出码一致，报告缺失/不可解析仍按基础设施问题失败关闭）。
- `scripts/lib/acceptance-registry.mjs`：`ENVIRONMENT_REASONS.browser` 文案去掉「本仓库不引入 Playwright」。
- `scripts/live.mjs`：删除 `browser.html-rendering` 这条 UNVERIFIED 行（否则配置了真实 Provider 时会把已经 PASS 的 AC-002/052 重新降级），注释说明浏览器侧现由 `pnpm test:e2e` 覆盖。
- `eslint.config.js`：新增 `tests/browser/**/*.mjs` 的 globals 覆盖（Node + 浏览器全局，因为这些 spec 在页面内求值代码片段）。
- `package.json`：`devDependencies` 新增 `@playwright/test: 1.63.0`；新增便捷脚本 `test:browser`（十条契约命令未改名、未删除）。

### 文档

- `docs/delivery/implementation.md` §3 `pnpm test:e2e` 行：删除「已批准偏差：不引入 Playwright」，写明真实 Chromium 覆盖与「只有确实没有浏览器时才 UNVERIFIED」的通过条件。
- `docs/INDEX.md`：WP-10 段落的豁免说明标注该偏差已被 T7a 撤销，并新增一段 WP-12 T7a 记录。
- `docs/delivery/acceptance.md` §3（**非 AC 文本**）：把「已批准偏差」那条改成「已撤销偏差」，并在 E2E 层描述里加入 `tests/browser/**`。AC-001～AC-094 的 Given/When/Then 与证据行一字未动。

## 3. 真实执行证据（全部本次运行内执行）

### `pnpm test:browser`（单跑套件，真实 Chromium）

```text
12 passed / 3 failed / 1 skipped (10.4s)
FAIL  AC-071 · 顶栏入口的 aria-label 随面板状态更新
FAIL  AC-071 · 顶栏恢复入口位于视口内且可用指针点击
FAIL  AC-071 · 窄屏 Open 为可关闭覆盖层
SKIP  界面语言切换覆盖率缺口（记录，不计入 AC）
EXIT=1
```

### `pnpm test:e2e`（契约命令，含浏览器套件）

```text
PASS  browser.html-preview-and-download   [AC-002]
PASS  browser.html-attack-samples         [AC-052]
FAIL  browser.live-layout                 [AC-071]
PASS  browser.keyboard-aria-i18n          [AC-073]
PASS  browser.attachment-client-hints     [AC-076]
e2e: 22 checks — PASS 21 / FAIL 1 / UNVERIFIED 0
e2e: 23 ACs accounted for by the drill; exit 1
EXIT=1
```

真实观测（摘自 drill 证据）：预览帧 `origin=null`、`document.cookie` 抛 `SecurityError`、`parent.document`/`top` 抛 `SecurityError`、父页 URL 未变、`fetch` 全部 `rejected:`、攻击探针 `attacks=0`；截断下载 200 且重放同 token 403；键盘遍历 22 个控件；`#composerError="VALIDATION_ERROR: chief.attachmentTooMany"` 等四种提示且 `/artifacts/upload` 请求数为 0。

### `pnpm test:acceptance` before / after（逐 AC 真实变化）

本次运行的 `AGENTDEV_PROVIDER_*` 未配置（`pnpm test:live` 正常以 3 退出并记 UNVERIFIED），而 `before` 那份 WP-10 报告是配置了真实 Provider 时产生的，因此除浏览器 AC 外还有环境差异，逐条列出：

```text
AC        before                          after
AC-002    UNVERIFIED（已登记豁免）          PASS     ← T7a：真实 Chromium 攻击样例/预览/下载
AC-052    UNVERIFIED（已登记豁免）          PASS     ← T7a
AC-073    UNVERIFIED（已登记豁免）          PASS     ← T7a
AC-076    UNVERIFIED（已登记豁免）          PASS     ← T7a
AC-071    UNVERIFIED（已登记豁免）          FAIL     ← T7a：真实浏览器暴露 3 处 UI 缺陷（见 §5）
AC-001/007/010/037/041  PASS                UNVERIFIED（已登记豁免） ← 本会话未配置 Provider，live 演练未执行
AC-044/045/082          PASS                FAIL     ← 其他车道未提交的 packages/core 单测失败（与 T7a 无关）
```

```text
before: 94/94 ACs accounted — PASS 86 / ACCEPTED 8 / FAIL 0 / MISSING 0  (exit 0)
after : 94/94 ACs accounted — PASS 82 / ACCEPTED 8 / FAIL 4 / MISSING 0  (exit 2)
```

`after` 的 exit 2 由两件**非 T7a** 的基础设施问题触发：`vitest unit` 退出 1（其他车道未提交的 `packages/core/test/{dbg,supervisor,orchestrator}.test.ts` 失败，聚合器因此判「证据不可信」）与 `pnpm test:live` 报告的 `codeDigest` 与当前代码树不一致（其他车道在本次聚合运行期间仍在改文件）。AC-071 的 FAIL 与浏览器 AC 的 PASS 都是 drill 逐项结论，不受这两项影响。

### 其余契约命令

```text
$ pnpm docs:check      → docs:check ok — 15 documents, 54 internal links, 94 acceptance cases, 9 requirements, 11 work packages  (exit 0)
$ pnpm typecheck       → exit 1：apps/runner/src/attempt.ts(149,13) TS2322（其他车道未提交改动；T7a 未触碰任何 .ts）
$ pnpm lint            → exit 1：8 个错误全部位于 apps/runner/src/control-client.ts、packages/core/src/control-http.ts、
                         packages/core/test/orchestrator.test.ts（其他车道）；T7a 新增/修改文件经 eslint 与 prettier --check 全绿
$ pnpm test:unit       → exit 1：61 文件/1210 用例，1208 passed / 2 failed（packages/core/test/supervisor.test.ts，其他车道）
```

### 豁免条件的两个方向（现场验证）

```text
$ node -e "…conditionHolds('browser-absent')"                         → {holds:false, why:"Playwright 与 Chromium 已安装…"}
$ PLAYWRIGHT_BROWSERS_PATH=/tmp/empty node -e "…conditionHolds(…)"     → {holds:true,  why:"…Chromium 未下载…需运行 pnpm exec playwright install chromium"}
```

即：浏览器装了就必须真跑（UNVERIFIED 不再被接受），只有本机确实没有可运行 Chromium 时 `browser-absent` 才成立。

## 4. AC 覆盖结论

| AC | 真实浏览器证据 | 结论 |
|---|---|---|
| AC-002 | 隔离 iframe 渲染 HTML 说明、真实 CSP/sandbox/credentials 响应头、一次性下载与重放 403、匿名 401、源码/Git 未变 | **PASS** |
| AC-052 | cookie/网络/父页三类攻击样例全部失败，探针零命中，Playwright 侧独立复核 | **PASS** |
| AC-071 | 三态/clamp 宽度/跨页状态/不打扰 Run 通过；顶栏恢复入口在视口外、窄屏关闭焦点、aria-label 过期三项失败 | **FAIL** |
| AC-073 | 键盘遍历 + ARIA 名称/aria-live + 语言切换不翻译项目内容 | **PASS** |
| AC-076 | 超数量/超大小/错误 mime/超总量客户端提示且零上传；合法附件对照上传成功 | **PASS** |

## 5. 仍然未覆盖 / 需要 UI 修复（诚实清单）

> 更新（收尾轮 1，由 WP-12 T4 修复）：本节第 1～5 条均已修复并经本轮真实浏览器复验通过，逐条对应见 §7「收尾轮 1」。以下保留首轮观察作为问题记录。

1. **（P1，AC-071 失败根因）顶栏没有占满工作区。** `apps/web/public/styles.css` 里 `.shell` 定义了 `grid-template-areas: 'brand topbar tools'`，但没有 `.topbar` 规则，`header.topbar` 也不是 `display: contents`，于是它落在网格第一格（220×54）里，`.brand`/`.project-area`/`.topbar-tools` 依次堆叠在这个 220px 宽内。真实几何：`.topbar {x:0,y:0,w:220,h:54}`、`.topbar-tools {y:63,h:47}`、`#liveDockToggle {x:-59.796875,y:63}`——顶栏恢复按钮在视口外，指针完全点不到，顶栏文字还压在侧栏上（截图见 `node_modules/.cache/agentdev-browser/output/…`，套件失败时保留）。修复方向：给 `.topbar` 加 `display: contents`（或把三个分组直接作为 `.shell` 的网格子项），随后必须重跑 `pnpm test:browser` 与相关页面测试。T7a 未改 `apps/web/**`。
2. **（P2，AC-071）窄屏关闭覆盖层后焦点未回到触发按钮。** `apps/web/public/app.js` 的 `#liveDockClose` 处理器只调用 `setPanelMode('compact')`，没有 `toggle.focus()`；实机 `document.activeElement` 是 `#liveDockClose`（或 body）。`experience.md` §6 明确要求「关闭后焦点回到触发按钮」，`shell.ts` 的注释也这么写。
3. **（P2，AC-071）面板切换后顶栏按钮的 `aria-label` 过期。** `setPanelMode()` 用 `state.strings[key] || toggle.getAttribute('aria-label') || mode`，而 daemon `ui.translate` 目录不含 `aria.liveDock*`，`state.strings[key]` 为 `undefined`，于是回退成**旧**标签：实机 `data-mode="compact"` 但 `aria-label="Live panel, open"`。与第 4 条同根因。
4. **（P2，记录缺口，不挂 AC）浏览器内切换界面语言的覆盖率很低。** app.js 的 `loadStrings` 只替换 daemon `ui.translate` 目录里的键，而 `apps/web/src/i18n.ts` 的界面字典远大于该目录，且客户端从不写 `agentdev_language` cookie，因此 `aria.*`/`detail.*`/`settings.*` 等切换后仍是服务端渲染语言（套件里用 `fixme` 记录：`#liveDock` 的 `aria-label` 切到 zh 后仍是 `"Live panel"`）。AC-073 的 Then（焦点/ARIA/标签可用、项目内容不被翻译）已真实通过，这一项作为体验缺口单独登记，未降低任何断言。
5. **（P3，提示文案）AC-076 的客户端拒绝文案显示原始 i18n key。** 实机输出 `VALIDATION_ERROR: chief.attachmentTooMany`——`chief.attachment*` 只在 `apps/web/src/i18n.ts` 里，daemon 目录没有，所以客户端拿不到本地化句子。提示本身存在且区分了四种限制，故 AC-076 判 PASS，但文案需要 UI 侧补齐。
6. **AC-090 的界面渲染仍未实现**（分支/提交/未推送状态展示），继续走它自己的 `recorded-gap` 登记，本切片未触碰。
7. **未做：真实 Provider + 真实浏览器的联合演练。** 浏览器套件用的是离线 Provider 桩 + 种下的 HTML 产物；「真实模型产出 HTML → 真机预览」仍是 `pnpm test:live` 的服务端证据 + 本套件的隔离证据两段，没有合并成一条纵向演练。
8. **未做：浏览器侧的 AC-072/074/075/077/078 等。** 本次只按任务要求覆盖 AC-002/052/071/073/076；其余 UI AC 仍由提交测试与协议演练覆盖，可在后续切片扩充 `tests/browser/**`。
9. **环境性残余（非 T7a）**：`pnpm typecheck`/`pnpm lint`/`pnpm test:unit` 在当前工作树失败，全部来自其他车道未提交的 `apps/runner/**`、`packages/core/**` 改动；`pnpm test:acceptance` 因此 exit 2。需要在其他车道落定后重跑才能得到干净的发布判定。

## 6. 需要的决定

1. **AC-071 是否本切片内修 UI**：三处缺陷都在 `apps/web/**`（T7a 的硬约束禁止修改）。若授权，最小修复是 `.topbar { display: contents }` + 关闭时 `toggle.focus()` + `setPanelMode` 使用服务端渲染的对应标签（或补 daemon 目录）；否则 AC-071 保持 FAIL 并在发布记录中作为已知缺陷。
2. **语言切换覆盖率缺口**（§5.4）是否单开一个 UI 切片：建议让客户端写 `agentdev_language` cookie（服务端已按该 cookie 渲染），这样切换与刷新都能整体生效。
3. **`pnpm test:e2e` 允许退出码 1 的聚合口径**（§2 `acceptance-drills.mjs`）：本切片把它作为「drill 报告里逐 AC 的 FAIL」处理而非「证据不可信」；若 Review 认为应恢复 `[0]`，需同时接受浏览器 AC 一旦 FAIL 就无法在验收表里区分。

## 7. 收尾轮 1（T4 修复后的复核）

背景：WP-12 T4 修好了 AC-073 的语言覆盖缺口（客户端写入 `agentdev_language` cookie、把 `#uiStrings` 界面字典内嵌给 `app.js`），并顺带修掉了首轮由真实浏览器暴露的 AC-071 三处缺陷（`.topbar { grid-area: topbar }` 的顶栏网格、`#liveDockClose` 关闭后 `toggle.focus()`、`panelAriaLabel()` 不再回读旧 `aria-label`）。因此首轮 §5 的第 1～5 条与那条「界面语言切换覆盖率缺口」的 `fixme` 都需要按真实行为重新核对。

本轮只改了 `tests/browser/**` 与本节；未触碰 `apps/web/**`、`packages/**`、`apps/daemon/**`、`scripts/e2e.mjs`、`scripts/lib/*.mjs`。

### 7.1 断言变更（只收紧，未放宽）

- `tests/browser/ac-073-a11y-i18n.spec.mjs`
  - **删除**了不挂 AC 的 `fixme`「界面语言切换覆盖率缺口」：该缺口已由 T4 关闭，保留 skip 只会掩盖真实行为。
  - 把原来的宽松断言（`#liveDock`/`#liveDockToggle` 的 `aria-label` 只要非空）改成真实断言：切换 zh 后 `#liveDock` 可访问名为「实时面板」、`#liveDockToggle` 为「实时面板，已展开」、`button[data-download-artifact]` 文案为「下载完整产物」，并断言 `agentdev_language=zh` cookie 已写入。
  - 追加：reload 后整页仍为 zh；**客户端从未打开过的** `/settings` 也按 cookie 服务端渲染为「保存配置」（证明 cookie 路径，而非只有客户端字典路径）。
  - 项目内容不被翻译的断言保持原样（需求标题、项目名逐字不变且 `data-translatable="false"`；`ui.translate` 请求正文不含项目内容）。
- `tests/browser/ac-076-attachments.spec.mjs`
  - `expectRejection()` 由「接受本地化句子**或**原始 key」收紧为「必须包含本地化句子，且**不得**再出现 `chief.attachment` 原始 key」——首轮那条对原始 key 的容忍是为缺口留的，现按 T4 后的真实行为收紧。
  - 四种限制改为断言精确英文文案；新增一条 zh 用例：切换语言后 6 个附件 → `VALIDATION_ERROR: 每条消息最多 5 个附件。`。
- `tests/browser/ac-071-live-layout.spec.mjs`：仅修正证据口径（`/rpc` 计数改在断言处快照，避免后续导航把计数累加进「切换期间」），断言本身未动。
- `scripts/lib/browser-suite.mjs`、`scripts/lib/e2e-stack.mjs`：本轮无改动。

### 7.2 命令与真实结果

```text
$ pnpm test:browser
16 passed (10.1s)
EXIT=0            # 首轮为 12 passed / 3 failed / 1 skipped

$ pnpm test:e2e
PASS  browser.html-preview-and-download   [AC-002]
PASS  browser.html-attack-samples         [AC-052]
PASS  browser.live-layout                 [AC-071]
PASS  browser.keyboard-aria-i18n          [AC-073]
PASS  browser.attachment-client-hints     [AC-076]
UNVERIFIED provider.fact-and-unknown      [AC-001]
e2e: 23 checks — PASS 22 / FAIL 0 / UNVERIFIED 1
e2e: 24 ACs accounted for by the drill; exit 0
EXIT=0

$ pnpm typecheck
EXIT=0
$ NODE_OPTIONS=--require=scripts/typescript-6-preload.cjs eslint tests/browser scripts/lib/browser-suite.mjs scripts/lib/e2e-stack.mjs
EXIT=0
$ prettier --check "tests/browser/**/*.mjs" scripts/lib/browser-suite.mjs scripts/lib/e2e-stack.mjs
All matched files use Prettier code style!
```

`browser.keyboard-aria-i18n`（AC-073）本轮原文：

```text
PASS       browser.keyboard-aria-i18n                     [AC-073] Tab #1 → a#(skip-link) name="Skip to main content"；Enter → 焦点 #main；遍历 22 个可聚焦控件（含 #languageSelect=true），无未命名控件，无不可聚焦元素进入顺序；ARIA: #liveDock="Live panel" #liveDockToggle="Live panel, open" #languageSelect="Interface language" #composerBody="Message the Chief"；aria-live 区域 #connectionState/#messages/#liveEvents/#stagedAttachments | 切换到 zh：html[lang]=zh-CN，nav Chief→主管，cookie agentdev_language=zh，localStorage(agentdev.language)=zh；客户端自有字符串随切换生效：#liveDock aria-label=实时面板、#liveDockToggle=实时面板，已展开、下载按钮=下载完整产物；项目内容未翻译：#requirementTitle="HTML 说明产物隔离预览" 保持不变且 data-translatable="false"；project-name="…/agentdev-e2e-repo-2drj2L" 不变；ui.translate 调用 63 次，未包含任何项目内容（标题/项目名泄漏=0）；reload 后整页仍为 zh；未在客户端打开过的 /settings 也由服务端按 cookie 渲染为「保存配置」
```

`browser.live-layout`（AC-071）本轮关键观测：顶栏 `header {x:0,y:0,w:1280,h:54}`、`#liveDockToggle {x:995.1,y:3.5}` 已在视口内；三态切换期间 `/rpc` 请求数=0；`#liveDockClose` 关闭后 `activeElement=liveDockToggle`；切换后 `aria-label="Live panel, compact"`。

> 检查数由首轮 22 变为 23 的原因：首轮 AC-071 失败时 `runBrowserChecks` 在追加 `provider.fact-and-unknown` 之前就抛出，那条 UNVERIFIED（AC-001，本机未配 Provider）没有进报告；本轮它正常计入。

### 7.3 本轮结论

- §5.1（顶栏布局）、§5.2（窄屏关闭焦点）、§5.3（面板 `aria-label` 过期）已在真实 Chromium 中复验通过；§5.4（语言切换覆盖）与 §5.5（附件提示显示原始 key）同样关闭：AC-073 的 `fixme` 已退休并转为真实断言，AC-076 的容忍已收紧为精确本地化文案。**AC-071 由 FAIL 变为 PASS。**
- 新观察（P3，未降低任何断言）：切换语言时 `applyLanguage` 同步写 `data-language` 与 cookie，但客户端字典要等异步的 `loadStrings` 回来后并入 `state.strings`；在这段窗口内触发附件拒绝仍会显示上一语言的文案（本轮实测：切换后立即选文件得到 `VALIDATION_ERROR: At most 5 attachments per message.`）。AC-076 的 zh 用例改为等待一个客户端自有字符串生效后再断言，断言的是承诺的「切换后文案跟随语言」，不是同步性。若希望该窗口也为零，可在 `applyLanguage` 里直接用 `state.dictionary[language]` 兜底（属 UI 侧可选优化）。
- 仍未覆盖（不变）：§5.6 AC-090 界面渲染（父代理表示另开切片，依赖 daemon 暴露 `git.unpushed`）、§5.7 真实 Provider + 真实浏览器的联合纵向演练、§5.8 其余 UI AC 的浏览器侧。

### 7.4 验收聚合复核（本轮附加运行）

```text
$ pnpm test:acceptance
acceptance: project "unit" exit=0 1247 tests, 0 failed
acceptance: project "integration" exit=1 342 tests, 1 failed
acceptance: pnpm test:e2e exit=0 (41896ms)
acceptance: 94/94 ACs accounted — PASS 86 / ACCEPTED 8 / FAIL 0 / MISSING 0
EXIT=2   # 基础设施问题：integration 项目 exit 1 + live 报告 codeDigest 与运行中变化的代码树不一致
```

- 逐 AC：AC-002/052/071/073/076 全部 **PASS**（AC-071 由首轮 FAIL 转为 PASS）；AC-044/045/082 也回到 PASS。**AC 层面 FAIL 0**，唯 8 项 ACCEPTED 均为已登记且有产品决定的豁免（AC-001/007/010/037/041 的 provider-absent、AC-043 的独立模型、AC-066/AC-090 的 recorded-gap）。
- 退出码 2 与 AC 结论无关：`apps/daemon/test/assessment-dispatch.integration.test.ts` 有 1 个未映射失败用例（其他车道），以及 `pnpm test:live` 的报告绑定与运行中仍在变化的代码树不一致（聚合会拒绝该证据）。两者都不涉及本切片改动的文件；本切片自己的 `pnpm test:e2e`、`pnpm test:browser` 均为 exit 0。
