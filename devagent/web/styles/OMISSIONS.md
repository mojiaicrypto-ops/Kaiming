# 设计系统抽取 · 遗漏与偏差登记（P4-f(1)）

来源：`webui/index.html`（上一轮原型 mock）的 `<style>` 块（mock 行 9-1269）。
本文件记录抽取过程中**未搬运或有意偏离**的内容，以及原因。任何新增偏差都必须登记在这里，不现场决定。

## CSS 规则

- **无遗漏**。mock `<style>` 中被解析出的 485 个选择器（含逗号列表展开与 5 个 `@media` 块内的规则）
  全部搬运到 `tokens.css` / `components.css` / `views.css` 三者之一且仅一处，声明逐字节一致。
  证据：`node devagent/web/styles/verify-selectors.mjs` → `missing 0 / duplicated 0 / mismatched 0`。

## 令牌

- **`--font-scale` 未写入 `tokens.css`**。
  - 背景：`webui/DESIGN.md:50` 与 plan §5 要求 `tokens.css（令牌 + --font-scale）`，任务描述也点名该令牌。
  - 事实：mock 的 `:root`（mock 行 10-35）**没有**定义 `--font-scale`；DESIGN.md 属上一轮规格，仅作证据。
  - 决定：`tokens.css` 的 `:root` 必须与 mock 逐字一致（verify 会逐选择器比对声明），因此不新增该令牌
    ——既满足“令牌 verbatim / never invent a token”，也不让 `:root` 出现 mock 之外的声明。
  - 状态：**待决**。密度旋钮（`calc(<mock-px> * var(--font-scale))`）会改写大量 `font-size` 声明，
    与“逐字节保真”互斥，属后续切片（是否引入、如何封装组件级缩放）需主 agent/用户确认的差距。
- 其余 mock 令牌（`--status`、`--header`、`--sidebar`、字体族 `--sans`/`--mono`、颜色与布局变量）全部 verbatim 收录。

## 外壳标记（index.html）

搬运自 mock 行 1270-1746（`<body>`）与对话框区。以下 mock 专有内容未搬运，替换为**同 id/类的空容器**，
数据一律由真实 RPC / 客户端核心填充：

- 项目切换器菜单的三条 mock 项目项（`agentdev-workspace` / `payments-api` / `design-system`）→ 保留 `#projectMenu` 与
  `projects.open` 标签，选项由核心渲染。
- 顶栏/Live/侧栏徽标的 mock 计数（`1`/`24`/`8`/`2`/`3`）→ 徽标保留 `.nav-badge` 类但为空。
- `focus-card` 的 mock 需求标题/进度（`62%` / `Execution · 5 / 8 tasks`）→ 空容器（`#focusPercent/#focusTitle/#focusPhase/#focusDecision`）。
- Chief 会话内的全部 mock 消息体（USER/CHIEF 气泡、需求摘要、决策卡、审计、备忘卡等）→ 保留
  `#projectMessages`、`#messages`、`#createdRequirementMessages`、`#newConversationTemplate` 四个空 `.messages` 容器。
- 文件视图的 mock 文件树、路径/行数/代码 → 保留 `#fileSearch/#fileTree/#fileTreeEmpty/#visibleFileCount/#filePath/#fileMeta/#fileCode/#fileLineCount` 空容器。
- 运行时控制台的 mock 运行摘要、Agent 运行树、命令提示行内容 → 保留 `#runId/#runTitle/#runPath/#agentTree/#terminalLog/#promptProject/#promptCommand` 空容器；交互按钮/标签（Live/Events/Artifacts、ERRORS/PAUSE/STOP、折叠/关闭）与 `data-i18n` 键保留。
- 状态栏 mock 值（`main*`/`18.4k tok`）→ 空容器（`#statusBranch/#statusTokens`）。
- 三个对话框（`#paletteDialog/#profileDialog/#providerDialog`）保留骨架与静态标签；下拉选项数据留空由核心填充。
- 内联 `style`（原 composer 标签的 `position:absolute;…`）删除，改用既有 `.sr-only` 类。

## 结构性偏离（有意）

- **单一 `#genericView` → 八个具名 `.view`**。mock 用一个 `#genericView` 容器 + JS 切换标题来承载
  requirements/docs/agents/runs/inbox/settings。任务要求八个 `.view` 容器（plan §5 亦按 `views/` 每视图一文件），
  故拆为 `#requirementsView/#docsView/#agentsView/#runsView/#inboxView/#settingsView`，各自沿用
  `generic-view`/`generic-heading`/`generic-content` 类名与 `view.<name>.eyebrow|title|subtitle` 的 `data-i18n` 键。
- **`.runtime` 命令行提示行（`.terminal-prompt`）保留但置空**。plan §5 将“命令行 prompt 行”列入“删（进差距表）”；
  本切片按任务“搬运外壳标记”保留骨架为空容器，其去留随差距表统一裁定。
- **导入映射**取自 `devagent/web/vendor/README.md` 的“import map（可选）”，路径改为同源绝对 `/vendor/`；
  P4-h0 已锁定库清单，故不再自拟。
