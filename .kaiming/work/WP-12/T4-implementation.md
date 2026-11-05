# WP-12 T4 实现记录（WebUI 功能补全）

- 基线：本工作树（`HEAD 7c723ec` + 其他车道的未提交改动）。T4 只改 `apps/web/**`。
- 范围：①修复 T7a 真实浏览器发现的 3 处 UI 缺陷（关 AC-071）；②AC-090 渲染分支/提交/未推送；③需求卡动作 complete/archive/continue/cancel；④语言切换覆盖（cookie + 客户端字典）。
- 不改：`packages/**`、`apps/daemon/**`、`apps/cli/**`、`scripts/**`、`tests/**`、根 `package.json`、`pnpm-lock.yaml`。`apps/daemon/src/protocol.ts` 由其他车道在改，本切片只读。
- 注：`apps/web/**` 工作树里另有 T1 车道未提交的 Provider 编辑器改动（`views.ts` 的 `ProviderEditorView`、`pages.ts` 的 provider 表单、`app.js` 的 `providerUpsertParams` 等）。本切片在其之上追加，未回退任何 T1 代码。

## 1. 修复真实浏览器发现的三处缺陷（AC-071）

### 1a 顶栏没有占满工作区（`apps/web/public/styles.css`）

- 根因：`.shell` 的 `grid-template-areas: 'brand topbar tools' / 'sidebar main dock'` 只给了 `brand`/`tools` 网格区，`header.topbar` 自身不是 `display: contents`，于是整个顶栏落在 220×54 的第一格；`.brand`/`.project-area`/`.topbar-tools` 的 `grid-column/grid-row` 在非网格容器里无效，三组内容在 220px 内堆叠，`#liveDockToggle` 被推到 x≈-59.8。
- 修复：顶栏改为**独占整行**的网格项，三个分组改为它内部的 flex item：
  - `.shell` 的 areas 改为 `'topbar topbar topbar' / 'sidebar main dock'`；`.shell[data-panel-mode='open']` 只保留列宽（`--dock`）声明。
  - 新增 `.topbar { grid-area: topbar; display: flex; min-width: 0 }`；`.brand { flex: 0 0 var(--sidebar) }`（左侧与侧栏对齐）；`.project-area { flex: 1 1 auto; min-width: 0; overflow: hidden }`；`.topbar-tools { flex: 0 1 auto }`（`justify-content: flex-end` 不变）。删掉已无意义的 `grid-column/grid-row` 与 `.shell[...open] .topbar-tools` 规则。
  - 窄屏（≤767px）模板改为 `'topbar' / 'main'`，`.brand`/`.topbar-tools` 改为 `flex: 0 0 auto`，并隐藏冗余的可见 `.language-label`（该 select 仍有 `aria-label`）。
- 三态、`--dock: clamp(360px,38%,560px)` 共享宽度、切换零 `/rpc`、不影响 Run 均未改（见 §5 浏览器证据）。

### 1b 关闭覆盖层后焦点未回到触发按钮（`apps/web/public/app.js`）

- 根因：`#liveDockClose` 只调用 `setPanelMode('compact')`。
- 修复：处理器改为 `setPanelMode('compact'); toggle.focus();`，与 `experience.md` §6「关闭后焦点回到触发按钮」一致；桌面视口也走同一路径，键盘路径与窄屏完全一致。

### 1c `aria-label` 过期（`data-mode="compact"` 却仍为 "Live panel, open"）

- 根因：`setPanelMode` 用 `state.strings[key] || toggle.getAttribute('aria-label') || mode`，daemon `ui.translate` 目录没有 `aria.liveDock*`，于是回退成**旧**标签。
- 修复：新增纯函数 `panelAriaLabel(key, language, strings, dictionary)`，来源顺序固定为「本地字典 → daemon 结果 → key 本身」，**不再从 DOM 读回旧值**；`setPanelMode` 调用 `panelAriaLabel(panelAriaKeys[mode], ...)`。
- 该函数是可被测试直接求值的纯函数（无闭包引用），`client-script.test.ts` 用它做回归断言。

## 2. AC-090 的界面渲染（分支 / 提交 / 未推送）

### 真实字段（读源码确认，未发明）

| 事实 | 真实来源 | 是否在读面暴露 |
|---|---|---|
| 交付分支 | `project.snapshot.get` → `project.deliveryBranch` | 是 |
| 提交 | `board` 卡片 / `requirement.get` → `portableRef.revision`（兜底 `sourceRef.version`；`working-tree` 不算提交） | 是 |
| 未推送 | `requirement.save` 结果 → `git.unpushed` | **否**：`board`/`requirement.get`/`project.snapshot.get` 都不带 `git` |

### 实现

- `views.ts`：新增 `commitOf()`（`portableRef.revision`，`working-tree` 视为无提交）、`unpushedOf()`（只有 payload 明确给出 `git.unpushed` 才返回布尔，否则 `null`）、`workVersionOf()`。`boardCardOf(raw, {branch})` / `boardModel(raw, {branch})` / `requirementDetail({..., branch})` 增加 `branch`、`commit`、`unpushed`。
- `pages.ts`：新增 `gitChips()`，在**看板卡片**和**详情 `#requirementMeta`** 渲染「交付分支 / 提交（短 12 位，`title` 为全量）/ 推送状态」；未推送状态为 `null` 时渲染 `board.card.pushUnknown`（「推送状态未上报」），不猜测。
- 可断言属性：卡片与详情元信息都带 `data-git-branch` / `data-git-commit` / `data-git-unpushed="true|false|unreported"`。
- `app.ts`：把 `project.snapshot.get` 得到的 `branch` 传入 `boardModel` 与 `requirementDetail`。
- 新增字典键：`detail.delivery`、`detail.branch`、`detail.commit`、`detail.pushState`、`board.card.unpushed`、`board.card.pushed`、`board.card.pushUnknown`。

**未能渲染项**：`unpushed` 的真实值（读面未暴露）。界面按「未上报」如实显示，见 §7 缺口 1。

## 3. 需求卡动作：complete / archive / continue / cancel

- 看板卡片（`pages.ts` 的 `boardCard`）与详情页新增 `#detailActions` 动作组：`pause`、`resume`、`continue`、`complete`、`archive`、`cancel`，按钮由 `views.ts` 依 payload 计算的可行动作决定（`canPause/canResume/canContinue/canComplete/canArchive/canCancel`）。看板原 `pause`（Queued 无 Work 的 `data-refused="INVALID_STATE"`）与 `cancel` 属性保持不变，既有断言不动。
- 客户端纯函数 `boardActionRequest(action, data)` 负责命令映射：
  - `pause` / `resume` / `cancel` → `work.control`（`reason: workbench`；有 Work 用 `workId`，Queued 无 Work 用 `requirementId`）；
  - `continue` → `requirement.continue`（`requirementId`）；
  - `complete` → `requirement.save`（`patch.lifecycle='completed'`）；
  - `archive` → `requirement.archive`（`protocol.md` §4 记录的命令）；
  - 未知 action → 本地 `VALIDATION_ERROR`，不发请求。
- 版本/幂等：所有写请求带 `idempotencyKey = requirement-<action>-<ts>-<n>`；`work.control` 仅当按钮带 `data-work-version` 时附带 `expectedVersion`（`protocol.md` §1 的 Work 版本语义）。详情页有真实 Work 版本；**看板没有**——daemon `board()` 的 work 投影只有 `id/status/level/intent/blockers`，不含 `version`，故看板 resume 不发 `expectedVersion`（不伪造版本）。
- 拒绝路径：`runRequirementAction` 在 `!answer.ok` 时只 `showError(errorId, answer.error)` 后 `return`——不改卡片数据属性、不清输入、不 reload；仅 `ok` 时 reload，让新状态由服务端读回。看板错误区 `#boardError`，详情错误区 `#detailError`。
- 真实拒绝路径（集成测试，真实 daemon+SQLite+Git）：
  - Queued 无 Work 的 `pause` → `INVALID_STATE`，lifecycle 仍 `queued`；
  - Completed 的 `cancel` → `INVALID_STATE`，lifecycle 仍 `completed`；
  - `requirement.archive` → `NOT_FOUND`（daemon 未实现该命令），lifecycle 仍 `queued`；
  - `complete`（`requirement.save` lifecycle=completed）→ `VALIDATION_ERROR`（缺 completion），lifecycle 仍 `active`；
  - `work.control action=complete` → `VALIDATION_ERROR`（未知 action）。

## 4. 语言切换覆盖

- `shell.ts` 在 `#shell` 之后嵌入 `#uiStrings` JSON 岛：`clientDictionary()` 输出 `{en:{...},zh:{...}}`，只含界面字符串（不含项目内容、凭证或 `secretRef`）。
- `i18n.ts` 新增 `clientDictionary()`；`index.ts` 导出。
- `app.js`：
  - 启动即解析 `#uiStrings` 到 `state.dictionary`；
  - `translateClient(key)` 用本地字典取词，缺失时以 key 兜底（确定性回退）；
  - `loadStrings` 仍对页面上的键调用 `ui.translate`（保留远程契约与 AC-073 的 `translateCalls>0` 断言），但合并时**本地字典优先**（`{...resolved, ...dictionary[language]}`），避免 daemon 目录里 `nav.docs="知识"` 这类更短的措辞覆盖 UI 自己的 `知识与上下文`；
  - 写 `agentdev_language` cookie：`agentdev_language=<en|zh>; path=/; max-age=31536000; SameSite=Lax`（BFF 早已按该 cookie 渲染首屏，`app.ts` 的 `normaliseLanguage(cookieValue(...,'agentdev_language'))`）；切换与启动 `applyLanguage` 都写，刷新后整页语言一致；
  - 客户端自渲染的动态文案全部改为走字典：`aria.liveDock*`、`connection.*`、`state.received`、`board.pauseQueuedRefused`、`chief.attachmentStaged`、`chief.attachment*` 拒绝文案、`detail.approveReason.*`/`detail.approveExpired`/`detail.approveUnavailable`、`settings.saved`/`settings.testOk`。
- AC-076 文案：`chief.attachmentMime` 英文改为 "That file type is not a supported attachment type."（中文「该文件类型不是受支持的附件类型。」）。这是**补文案**而非放宽断言：浏览器套件原断言 `'not a supported'` 保持原样，之前显示原始 key `chief.attachmentMime`（T7a §5.5 缺口）现在显示真实句子。
- 项目内容仍不翻译：`data-i18n-project` / `data-translatable="false"` 逻辑未改。

## 5. 变更文件（全部 `apps/web/**`）

| 文件 | 变更 |
|---|---|
| `apps/web/public/styles.css` | 顶栏整行布局（§1a）、窄屏调整 |
| `apps/web/public/app.js` | 焦点回归、`panelAriaLabel`、`boardActionRequest`/`runRequirementAction`、字典岛解析、cookie、动态文案走字典 |
| `apps/web/src/i18n.ts` | `clientDictionary()`、新增动作/交付/push 键、`chief.attachmentMime` 文案 |
| `apps/web/src/index.ts` | 导出 `clientDictionary` |
| `apps/web/src/shell.ts` | 嵌入 `#uiStrings` 岛 |
| `apps/web/src/views.ts` | `commitOf`/`unpushedOf`/`workVersionOf`、看板卡与详情的 git/动作字段 |
| `apps/web/src/pages.ts` | `gitChips`/`actionButton`、看板与详情渲染分支·提交·推送与动作组 |
| `apps/web/src/app.ts` | 把 snapshot 的 `branch` 传入看板与详情模型 |
| `apps/web/test/views.test.ts` | git 字段、未上报不臆造、动作可行动作 |
| `apps/web/test/pages.test.ts` | 看板/详情渲染 git 与动作、Continue 仅待继续 |
| `apps/web/test/client-script.test.ts` | 动作命令映射/幂等/拒绝不改状态、cookie、`panelAriaLabel` 回归、关闭焦点回归 |
| `apps/web/test/server.test.ts` | `agentdev_language` cookie 首屏渲染 + `#uiStrings` 岛内容/不含 secretRef |
| `apps/web/test/workbench.integration.test.ts` | 真实栈 AC-090 渲染断言 + 动作真实拒绝码与状态不变 |

## 6. 真实执行证据（全部本次运行内执行）

```text
$ pnpm typecheck                                          → exit 0（仓库当前全绿；其他车道已落定）
$ pnpm lint                                               → exit 1（6 个 error，全部在本切片之外：
    apps/daemon/src/control-handler.ts:32 no-unused-vars；
    apps/daemon/src/protocol.ts:2605,4111 no-unnecessary-type-assertion；
    packages/core/test/orchestrator.test.ts:2233,2260,2266 no-unnecessary-type-assertion）
$ NODE_OPTIONS=--require=scripts/typescript-6-preload.cjs \
    pnpm exec eslint apps/web/src apps/web/test apps/web/public/app.js   → exit 0
$ pnpm exec prettier --check apps/web/src apps/web/test apps/web/public/app.js apps/web/public/styles.css → exit 0
$ pnpm exec vitest run --project unit apps/web/test        → exit 0，4 文件 / 115 用例全过
$ pnpm exec vitest run --project integration apps/web/test  → exit 0，4 文件 / 49 用例全过
$ pnpm test:browser                                        → exit 0，15 passed / 1 skipped（记录缺口 fixme）/ 0 failed
$ pnpm test:e2e                                            → exit 0，23 checks PASS 22 / FAIL 0 / UNVERIFIED 1
```

`pnpm test:browser` 的 AC-071 五项（`node_modules/.cache/agentdev-browser/report.json`，`pnpm test:browser` 本次运行产生）：

```text
PASS  AC-071 · Open/Compact/Hidden 三态与 clamp 共享宽度
      open: grid=220.0px 573.6px 486.4px, --dock=clamp(360px, 38%, 560px) ⇒ dock 486.4px (38% of 1280px),
      main 右缘=793.6 dock 左缘=793.6；compact 第三轨=44px；hidden 第三轨=0px, main=1060.0px > compact=1016.0px
PASS  AC-071 · 顶栏恢复入口位于视口内且可用指针点击
      header {x:0,y:0,width:1280,height:54,right:1280,bottom:54} headerDisplay=flex；真实 click 后 shell=compact
PASS  AC-071 · 跨页保持面板状态且切换不发出任何协议请求（不打扰 Run）
      三态切换期间 /rpc=0；导航到 /requirements 后仍 compact；run.get 前后完全一致 status=running
PASS  AC-071 · 窄屏 Open 为可关闭覆盖层
      600px：dock position=fixed width=420.0 右缘=600.0 mainLeft=0.0；
      #liveDockClose 关闭 → data-panel-mode=compact，关闭后 activeElement=liveDockToggle
PASS  AC-071 · 顶栏入口的 aria-label 随面板状态更新
      open → compact 后 data-mode=compact、data-i18n-aria=aria.liveDockCompact、aria-label="Live panel, compact"
```

`pnpm test:e2e` 的关键检查行：

```text
PASS  browser.html-preview-and-download     [AC-002]
PASS  browser.html-attack-samples           [AC-052]
PASS  browser.live-layout                   [AC-071]   ← T4 前为 FAIL
PASS  browser.keyboard-aria-i18n            [AC-073]
PASS  browser.attachment-client-hints       [AC-076]   ← T4 前文案显示原始 key
UNVERIFIED provider.fact-and-unknown        [AC-001]  （离线演练，需真实 Provider，非本切片）
e2e: 23 checks — PASS 22 / FAIL 0 / UNVERIFIED 1
e2e: 24 ACs accounted for by the drill; exit 0
```

注：`pnpm test:e2e` 按脚本设计重写了 `.agentdev/work/WP-10/{e2e-results.json,e2e.md}`（运行前这两份文件已被其他车道改动）。

## 7. AC 覆盖结论

| AC | 本切片证据 | 结论 |
|---|---|---|
| AC-068 | 看板身份不变；Queued 无 Work 的 pause 拒绝、cancel 真实落 Git（浏览器+集成） | PASS（维持） |
| AC-069 | `/rpc` 零干扰、消息状态真实（既有+浏览器） | PASS（维持） |
| AC-070 | 过期 Plan 禁用原因、截断/下载（既有） | PASS（维持） |
| AC-071 | 5/5 真实浏览器断言 PASS（§6） | **PASS（本切片转绿）** |
| AC-073 | 键盘/ARIA 不变；语言切换 + 首屏 cookie、`aria.*` 随状态/语言变化（单测+浏览器） | PASS |
| AC-074 | Inbox 去重（既有） | PASS（维持） |
| AC-077 | 文件只读边界（既有） | PASS（维持） |
| AC-088 | 归档/取消的展示字段仍由导入投影渲染（既有）；归档**动作**见缺口 3 | PASS（维持） |
| AC-089 | 待继续展示 + 真实 `requirement.continue`（既有集成） | PASS（维持） |
| AC-090 | 分支/提交已渲染（含真实 Git commit 短/全长）；未推送见缺口 1 | 界面子句**部分**满足 |

## 8. 缺口清单（诚实）

1. **AC-090「未推送状态」无读面数据源**：`board` / `requirement.get` / `project.snapshot.get` 都不返回 `git`；`git.unpushed` 只出现在 `requirement.save` 命令结果里（`scripts/e2e.mjs` 已断言）。界面因此渲染「推送状态未上报」+ `data-git-unpushed="unreported"`，**不臆造** `unpushed=true`。需要 daemon 侧切片（在 board/requirement.get 里带上 `git`，或让 BFF 读回该 requirement 最近一次成功 save 的 command 结果）。
2. **`complete` 无 daemon 写路径**：`protocol.md` §4 无 `requirement.complete`；`requirement.save` 的 `patch` 也不接受 `completion`/`previousLifecycle`，所以 UI 提交后被 `prepareRequirementSave` 以 `VALIDATION_ERROR`（缺 completion）拒绝。按钮已按既有命令提交并如实显示拒绝；要真正完成需 daemon 切片（补 completion 写入或专用命令）。
3. **`requirement.archive/restore` 未实现**：daemon `dispatchUnwrapped` 没有这两个 case，UI 调用返回 `NOT_FOUND` 并显示。未改用 `requirement.save` 绕过，因为该路径不会写 `previousLifecycle`，会丢 `experience.md` §4 要求的 previous_state。
4. **daemon `ui.translate` 目录缺键（needs a daemon-catalogue slice）**：`apps/web/src/i18n.ts` 共 259 个键，daemon 目录只有 29 个（27 个重叠 + `config.invalid`/`disconnected` 两个 daemon 专有）。缺失 232 个：
   ```text
app.projectWorkspace, nav.workspace, nav.project, nav.system, nav.primary, language.label
language.en, language.zh, language.contentNotice, connection.state, connection.open, connection.connecting
connection.reconnecting, connection.closed, connection.resync, connection.expired, auth.login, auth.token
auth.submit, auth.logout, auth.required, auth.rateLimited, auth.showedOnce, shell.skipToMain
shell.panelMode, shell.panelMode.open, shell.panelMode.compact, shell.panelMode.hidden, shell.panelRestore, shell.panelClose
shell.liveCount, shell.readOnly, shell.discussInChief, shell.chiefOnlyControls, state.queued, state.active
state.completed, state.archived, state.cancelled, state.paused, state.blocked, state.recovery
state.waiting, state.valid, state.invalidated, state.stale, state.unknown, state.actionable
state.expired, board.card.identity, board.card.phase, board.card.role, board.card.tasks, board.card.blockers
board.card.decisions, board.card.saveState, board.card.waitingToContinue, board.card.evidence, board.card.previousState, board.card.open
board.card.unpushed, board.card.pushed, board.card.pushUnknown, board.action.pause, board.action.resume, board.action.continue
board.action.complete, board.action.cancel, board.action.archive, board.actions, board.empty, board.l1Hidden
board.pauseQueuedRefused, detail.goal, detail.scope, detail.acceptance, detail.openQuestions, detail.plan
detail.planVersion, detail.planCurrent, detail.approve, detail.approveExpired, detail.approveUnavailable, detail.approvedAt
detail.delivery, detail.branch, detail.commit, detail.pushState, detail.tasks, detail.runs
detail.settlement, detail.artifacts, detail.versionHistory, detail.previewTruncated, detail.download, detail.previewFailed
files.branch, files.revision, files.search, files.tree, files.preview, files.rootBoundary
files.snapshotUntouched, files.notFound, files.binary, agents.role, agents.profile, agents.tools
agents.source, agents.unavailable, agents.readOnly, settings.providers, settings.defaultProfile, settings.limits
settings.policy, settings.revision, settings.save, settings.test, settings.testOk, settings.testFailed
settings.saved, settings.rejected, settings.unchanged, settings.unsaved, settings.secretConfigured, settings.secretMissing
settings.newProvider, settings.providerId, settings.providerIdHint, settings.providerType, settings.providerTypeOpenai, settings.providerTypeAnthropic
settings.providerTypeGoogle, settings.baseUrl, settings.enabled, settings.models, settings.modelsHint, settings.apiKey
settings.apiKeyHint, settings.providerSave, settings.providerTest, settings.testModel, settings.testNeedsModel, settings.providerSaved
settings.testAccepted, settings.testPending, settings.testCompleted, inbox.decision, inbox.finding, inbox.recovery
inbox.internalRepairs, inbox.dedup, inbox.expiredDisabled, inbox.resolve, inbox.options, inbox.targetVersion
inbox.empty, runs.work, runs.run, runs.attempt, runs.epoch, runs.status
runs.outcome, runs.evidence, runs.tokens, runs.l1, runs.empty, run.topLive
runs.pause, runs.cancel, runs.resume, live.title, live.watermark, live.empty
live.transient, live.reconnect, chief.composer, chief.send, chief.sending, chief.newConversation
chief.switchConversation, chief.opinion, chief.attachments, chief.attach, chief.attachmentLimits, chief.attachmentRejected
chief.attachmentTooMany, chief.attachmentTooLarge, chief.attachmentTotalTooLarge, chief.attachmentMime, chief.attachmentStaged, chief.attachmentBound
chief.attachmentUploading, chief.providerMissing, chief.processRetry, common.error, common.retry, common.reason
common.by, common.at, common.version, common.validity, common.open, common.close
common.refresh, common.loading, common.failed, common.waiting, common.utc, common.localTime
common.none, common.more, common.back, aria.liveDock, aria.liveDockOpen, aria.liveDockCompact
aria.liveDockHidden, aria.chiefConversation, aria.messages, aria.composer, aria.board, aria.detail
aria.docs, aria.agents, aria.settings, aria.inbox, aria.runs, aria.liveStream
aria.projectFiles, aria.status, aria.requirementProgress, aria.focusOrderNote
   ```
   客户端已用内嵌字典对这些键确定性回退，并按字典优先合并；跨端点场景（非本 BFF 的远程客户端）仍需要 daemon 目录补齐，或在协议里明确「UI 自持字典」。
5. **`tests/browser/ac-073-a11y-i18n.spec.mjs` 的 fixme 文案已过期**（不在本切片范围）：它仍写着「客户端不写 `agentdev_language` cookie、`aria.*` 不随语言切换」。行为已在 T4 修复（单测断言 cookie 与 `panelAriaLabel`），该 spec 仍是 `test.fixme` 并出现在 `pnpm test:browser` 的 `1 skipped` 与 e2e 的 `browser: GAP` 行。需要 T7a 车道退役该缺口文本（或把 cookie/aria 断言加进 AC-073 用例）。
6. **`pnpm lint` 仍红**：6 个 error 全在 `apps/daemon/src/control-handler.ts`、`apps/daemon/src/protocol.ts`、`packages/core/test/orchestrator.test.ts`（其他车道）。
7. **`pnpm test:e2e` 的 1 条 UNVERIFIED**：`provider.fact-and-unknown`（AC-001）需要真实 Provider（`pnpm test:live`），离线演练按设计记 UNVERIFIED，非本切片。
8. **未做**：真实 Provider + 真实浏览器的联合演练；浏览器侧的 AC-072/074/075/077/078/088/089/090（T7a 的后续切片）。

## 9. 需要的决定

1. AC-090 的「未推送」是否由 daemon 读面补 `git`（推荐：`board`/`requirement.get` 附带最近一次 save 的 `git.branch/commit/unpushed`），否则该 Then 子句在界面上只能是「未上报」。
2. `complete`/`archive`/`restore` 是否新增 daemon 命令（本切片按 `protocol.md` §4 的 `requirement.archive` 与 `requirement.save` 提交，并把真实拒绝码显示出来）。若接受「暂无写路径」，可保持现状并在验收记录里登记。
3. 是否让 T7a 车道退役 `ac-073` 的过期 fixme 文案（行为已修复）。
