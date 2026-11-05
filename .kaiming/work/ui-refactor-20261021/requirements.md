# UI 重构 · 需求整理（第一批）

日期：2026-10-21。状态：`Understanding` — 只做盘点与需求整理，未改代码。
依据：用户确认的三条约束 + 实地阅读的代码事实。

## 0. 用户的原始要求

> 整体设计严格按 `design/tui` 的 UI/UX 风格做，争取高保真；TUI 里没有的效果，按其设计风格补；
> 保留 webapp 现有 chat 的**渲染效果（不是样式风格）**。

## 1. 权威来源与现状

| 项 | 事实 | 位置 |
|---|---|---|
| 设计基准 | `docs/design/tui/`：394 行 CSS + 6 个 JS，三屏（会话/需求/设置），**无构建、纯静态原型** | `docs/design/tui/` |
| 目标工程 | `devagent/webapp/`：React 19 + Vite 7 + TS，2053 行，**只实现了主对话一页** | `devagent/webapp/src/` |
| 当前线上 | `/` 仍是旧 vanilla 外壳（8 视图），`/app/` 是新 React 外壳 | 见 `docs/technicalnew/architecture.md` A7 |
| 上一轮高保真 | `docs/design/hifi/`（石墨工作台方向）——**与本轮方向冲突，本轮以 TUI 为准** | `docs/design/hifi/` |

## 2. TUI 设计语言（必须照搬的部分）

| 维度 | TUI 规定 | 与现有 webapp 的差异 |
|---|---|---|
| 字体 | 全站等宽（JetBrains Mono / SF Mono / Menlo），全文 14px/1.7 | webapp 用系统无衬线 |
| 形状 | **直角**，无圆角；`.box` 把标题切进上边框 | webapp 用 8px 圆角 |
| 分隔 | 1px 细线；`--line` / `--line-strong` 两级 | 接近，需统一令牌 |
| 密度 | 低密度：一行一个想法，大留白（`--s8`/`--s12`） | webapp 偏紧 |
| 强调色 | **紫色 `#bfa2ff`**（浅色主题 `#5b3fd6`），主按钮用实心紫 | webapp 用蓝 `#4f8cff` |
| 状态 | 符号 + 文字：`● 运行 / ◆ 待决定 / ✓ 完成 / ✗ 失败 / ○ 空闲 / ‖ 暂停 / · 等待` | webapp 是色点 + 色块 |
| 外壳 | 顶栏 44px + 主区 + 状态栏 28px；顶栏含品牌、**项目切换**、导航标签（会话/需求/设置）、连接态 | webapp 无导航 |
| 会话 | 左列 240px 会话列表 + 中栏转录（宽 90%，居中）+ 顶部任务条 + 底部 dock | webapp 单栏 |
| 消息 | `who` 行（角色 + 时间）+ 左侧 1px 竖线正文；用户/主管/Agent 用不同 who 颜色 | webapp 是无边框气泡/段落 |
| 工具调用 | 单行 `▸ name 摘要 耗时`，展开看参数/输出；完成后可退化成一行 | webapp 有卡片，但样式不同 |
| 决定 | 队列式 `.ask` 面板，选项带 `kbd` 序号，悬浮变紫边 | webapp 是卡片按钮 |
| 需求 | 四列看板 + 右侧抽屉（紫左边框） | webapp 无 |
| 设置 | 左列菜单三页：**Providers / 角色模型 / 外观**；`.rl` 三栏网格表单 | webapp 无 |

## 3. 必须保留的 chat 渲染效果（不是样式）

> 外壳布局的逐项核对见 [tui-shell.md](tui-shell.md)：以原型为准，壳代码不看。

用户明确"保留效果，不保留样式"。逐条对照 webapp 现有实现：

| # | 现有能力 | 代码位置 | 必须保留的行为 | TUI 是否已有对应 |
|---|---|---|---|---|
| R1 | 快照合并：按 entryId 合并，**在飞消息不降级** | `state/slot.ts` `mergeMessages` | 断线/重连/代次变化后，正在流式输出的那条不丢、不重复 | TUI 用简化 reducer，**无合并** → 保留 webapp 实现 |
| R2 | 统一归一化边界 | `state/normalize.ts` | 历史/事件/增量三种来源同一套块模型 | TUI 无 → 保留 |
| R3 | 增量流式：thinking / text / toolcall 参数分块追加 | `slot.ts` `message_update` 分支 | 光标只在最后一块；已完成消息不重渲染 | TUI 已有 `chat-live.js`，保留 webapp 语义 |
| R4 | toolResult 按 callId 回填到对应工具卡 | `Transcript.tsx` `toolResults` | 工具卡从 running → 完成/失败；不另起一块 | TUI 用 `s.tools[id]` → 同效果 |
| R5 | 滚动跟随：向上滚即锁定，贴底才恢复 | `lib/scroll.ts` | 用户上翻时不自动跳回；显示"回到最新" | TUI 有 `jump` 按钮但无锁定语义 → 保留 webapp |
| R6 | 高亮预算队列（同步/分帧高亮，不卡流式） | `lib/highlight-queue.ts` | 长代码块不阻塞输入 | TUI 无 → 保留 |
| R7 | 交互生命周期：busy → 本地回显 → STALE → 失败重试 | `InteractionCard.tsx` | 已答复的卡变灰保留；重复回答被拒 | TUI 有 `.ask.done` / `.ask-echo` → 照搬样式，保留状态机 |
| R8 | 队列输入（retained inputs）可见、可撤回 | `ChiefApp.tsx` `queued-inputs` | 会话忙时消息排队并显示原因 | TUI 有 `.queue` → 保留行为 |
| R9 | 提交时向服务端带 `taskId`（当前任务补充） | `useChiefSession.submit` | 不看本地缓存，提交前读 `session.get` | 必须保留（否则消息被当作另一话题滞留） |
| R10 | 失败不丢草稿 | `ChiefApp.tsx` 提交 catch | 发送失败把文本放回输入框 | 保留 |
| R11 | IME 处理：输入法组合中 Enter 不发送 | `ChiefApp.tsx` `isComposing` | 保留 | 保留 |
| R12 | 成员抽屉：独立订阅子会话，独立 slot | `MemberDrawer.tsx` | 打开某成员看它的实时历史，切槽不丢内容 | TUI 有 `md-drawer` → 保留样式 |
| R13 | 连接四态：connecting / connected / reconnecting / offline | `useChiefSession` | 顶部横幅 + 状态栏一致 | TUI 只有 ok/重连 → 补齐 |
| R14 | 历史读取警告可展开 | `ChiefApp.tsx` `history-problems` | 保留 | 补一个折叠行 |
| R15 | Task 卡：phase/status/成员实时状态/3s 轮询 | `TaskCard.tsx` | 保留数据路径 | TUI 是顶部 `.task-strip` → 改样式不改数据 |

## 4. 需要新增的页面对照（TUI 三屏 vs 产品需求）

| TUI 屏 | 页面 | 产品能力 | React 现状 |
|---|---|---|---|
| 会话 | 会话列表 + 转录 + dock | 主管对话、决定、任务条 | 有转录/dock，缺列表 |
| 需求 | 四列看板 + 抽屉 | 提案/实施需求/状态/详情 | 无 |
| 设置 | 左列菜单 + providers/角色模型/项目 | provider、角色模型、项目级覆盖 | 无 |

TUI 没有、但产品要求有的：**项目打开/切换**（TUI 只在顶栏有个项目菜单按钮）、**文件查看**（用户说明后期）。
处理：项目用顶栏 `.proj` 按钮 + 对话框（`app.js` 里已有 `ov:project` 占位）；文件查看不进本轮。

## 5. TUI 复核（第二轮，按用户更正）

上一版把"顶栏没有项目切换""设置只有一页"写错了。重新逐行核对 `app.js` / `data.js`：

| 我此前说 | 实际 | 证据 |
|---|---|---|
| 顶栏只有三标签 | 顶栏是：品牌 → **项目切换按钮**（`data-act="ov:project"`）→ 导航 → 右侧连接态 | `app.js:27` |
| 项目要另做 | 已有"切换项目"对话框：项目列表 + 当前项高亮 + 添加目录输入 + 取消/添加 | `app.js:117-125` |
| 设置只有一个 providers 面板 | 设置左栏三页：`providers` / `roles` / `look` | `app.js:90-105` |
| 无外观设置 | "外观"页含主题切换（深色/浅色） | `app.js:102` |
| 无 | 会话左列列表：4 条会话，带标题与状态符号 | `data.js:10-15` |
| 无 | 设置里的角色模型支持 **全局 / 本项目** 作用域切换，项目页显示"本项目覆盖 / 继承全局" | `app.js:92-94,99` |

### 命名调整（采纳用户意见，全部改用行业通用叫法）

| 原 TUI 文案 | 改为 | 理由 |
|---|---|---|
| 模型服务 | **Providers** | 行业通用；与 `config.save(kind=provider)` 一致 |
| 角色模型 | **Models**（页内分组：Role models / Project overrides） | 与 providers 区分层次 |
| 会话 | **Chat** / 会话 | 口语用 Chat，功能名保留"会话" |
| 需求 | **Requirements** | 已通用 |
| 设置 | **Settings** | 通用 |
| 外观 | **Appearance** | 通用 |
| 试连 | **Test connection** / 试连 | 通用 |

### 多语言

| 事实 | 现状 |
|---|---|
| 旧外壳已有 `web/i18n.json`：en / zh-CN 各 **236 键** | 可作词表基线 |
| 旧外壳顶栏有语言下拉（EN / 简中） | 新外壳 **完全没有 i18n**，文案硬编码中文 |
| 键名分组：`nav.* / view.* / stage.* / settings.* / requirements.* / runs.* / files.* / aria.* / common.*` | 新界面沿用同一套键名，减少二次翻译 |

结论：**本轮必须做 i18n**。界面语言作为"外观"页的第二项（主题 + 语言），并记忆在本地；默认跟随浏览器，回退 en。

### 修正后的待决问题

1. **中文等宽**：TUI 全站等宽；macOS 中文会回退成比例字。建议代码/路径/ID 等宽、中文正文用系统无衬线，其余照 TUI。
2. **会话列表标题**：服务端无 `session.list`，`project.get` 只给 `{sessionId, roleId}`。TUI 的会话标题（"密码重置"）在服务端无字段。本轮先用"角色 + 短 id"，标题另记后端缺口。
3. **多项目**：无 `project.list`；顶栏项目菜单只能用本地最近记录 + 手动输入路径。
4. **收口时机**：本轮只做会话屏，还是等需求/设置补齐后再切 `/` → `/app/` 并删旧壳。

## 6. 初步范围（待你确认后进 Plan）

**本轮（P1）**：令牌 + 组件层（照 TUI 类名与规则）+ 外壳（顶栏/状态栏/项目菜单）+ 会话屏（会话列表、转录、工具卡、决定面板、dock、队列、连接态）+ 保留 R1–R15。
**下一轮（P2）**：需求看板 + 抽屉。
**再下一轮（P3）**：设置（providers / 角色模型 / 项目覆盖）。
**收口（P4）**：`/` 跳转 `/app/`，删除旧外壳，Playwright 迁移。

## 7. 后端缺口（与 UI 相关，先记录）

| 编号 | 缺口 | 影响 |
|---|---|---|
| B1 | 无 `session.list`（只有 `project.get.sessions` 的 id/roleId） | 会话列表无标题、时间、最后活动 |
| B2 | 无 `project.list` | 顶栏项目菜单只能用本地记录 |
| B3 | 无 `config.matrix`，角色模型只支持 role / project 两档 | 见 `backend-gaps.md`（项目×角色覆盖） |
| B4 | 任务成员状态靠 3s 轮询（服务端不推 task 失效） | 工作栏/任务条实时性 |

## 8. 术语表（实现时以此为准）

| 概念 | 界面文案（en） | 界面文案（zh-CN） | 代码标识 |
|---|---|---|---|
| 模型接入点 | Providers | Providers | `provider` |
| 一个 provider 下的模型 | Models | 模型 | `model` |
| 角色与模型的绑定 | Role models | 角色模型 | `role override` |
| 项目级绑定 | Project overrides | 项目覆盖 | `project override` |
| 生效来源 | Inherited / Project override | 继承全局 / 本项目覆盖 | `source` |
| 连接测试 | Test connection | 试连 | `config.test` |
| 主管会话 | Chat | 会话 | `chief session` |
| 需求 | Requirements | 需求 | `requirement` |
| 任务与步骤 | Task / Steps | 任务 / 步骤 | `task` / `phase` |
| 待你决定 | Needs your decision | 等你决定 | `interaction` |
| 主题 / 界面语言 | Appearance · Theme / Language | 外观 · 主题 / 语言 | `theme` / `locale` |

不使用：模型服务、模型配置、AI 设置、工作台模式等含糊叫法。

## 9. 多语言实现要求

| 项 | 要求 |
|---|---|
| 键表 | 以 `devagent/web/i18n.json`（en/zh-CN 各 236 键）为基线迁移到 `webapp/src/i18n/`，键名不改 |
| 缺失 | 两语键集合必须一致；CI/脚本检查差异为 0 |
| 格式 | 支持 `{count}`、`{name}` 占位；不用拼接造句 |
| 首访 | 默认按 `navigator.language`，`zh*` → zh-CN，其余 → en；用户选择存本地 |
| 运行时 | 切换语言不刷新页面；时间/数字用 `Intl` |
| 范围 | 所有界面文案，包括空态、错误、提示、aria-label、placeholder |


## 10. 三个问题的推荐方案（第一性 + 体验）

### Q1 中文等宽

第一性问题：等宽字体存在的理由是**字符对齐有意义**——代码、路径、diff、ID、表格列。
散文没有对齐语义，等宽散文只损失可读性：中文全角字在 macOS 等宽字体族里回退到比例字，
结果是"英数等宽 + 中文比例"混排，行内节奏断裂；长中文段落行宽失控时更难扫读。

推荐：**混合排版**
- 等宽：代码块、行内代码、路径、ID、耗时、快捷键、表格数字
- 无衬线：中文散文正文、按钮、标题
- 尺寸：正文 14px（与 TUI 一致），代码 13px
- 保留 TUI 的**几何特征**（直角、1px 线、低密度、符号状态），这些才是 TUI 的识别度

### Q2 会话标题

第一性问题：用户识别一段对话，靠的是**它谈了什么**，不是它的内部 id。
`session id` 是无意义哈希，展示它等于让用户用数据库主键工作。

事实核对：`sessions` 表无 title 列；`project.get` 只返回 `{sessionId, roleId}`；
旧壳同样没有标题，靠"最近一个/第一个"自动选。

推荐：**派生标题，零后端改动**
1. 标题 = 该会话**第一条用户输入**的前 N 个字符（按宽度截断，默认 24 全角）
2. 首条消息为空（新会话）→ 显示 `新会话`
3. 左列副行显示相对时间（今天 10:47 / 昨天 / 10/18）
4. 数据来源：`session.stream.prepare` 已返回 `messages`，取首条 role=user 即可；
   首次渲染会话列表时并行 prepare 各会话（只取首条，不订阅流）
5. 排序：最近活动优先（`session_inputs` 的最新 updatedAt）

不做：让用户手动命名、让模型生成标题——首版没有这些的必要，派生已足够。

### Q3 收口时机

第一性问题：两套界面并存期间，**每一处需求都要改两遍**，且用户会走到没有新能力的旧页。

推荐：**会话屏达标即切换，按屏切，不按轮切**
1. P1（会话屏）验收通过 → `/` 301 到 `/app/`，旧壳保留为 `/legacy/` 只读回退，不删除
2. P2（需求）、P3（设置）各屏通过 → 各自在 `/app/` 内替换，`/legacy/` 相应视图置灰
3. 三屏齐全 + 响应式档位全部通过 → 删除 `/legacy/`

理由：会话屏是唯一有真实数据的核心路径，先切收益最大；按屏灰度让每一步都可回退。

## 11. 决策记录（用户已确认）

| # | 决策 | 时间 |
|---|---|---|
| D-01 | 一次性重构，不留并存壳，不灰度 | 2026-10-21 |
| D-02 | 界面按 `docs/design/tui` 严格实现；TUI 没有的按其风格补 | 2026-10-21 |
| D-03 | 保留 webapp 现有 chat 的**渲染效果**（不保留其样式） | 2026-10-21 |
| D-04 | 术语改行业通用叫法：Providers / Models / Appearance / Test connection | 2026-10-21 |
| D-05 | 必须多语言（en / zh-CN） | 2026-10-21 |
| D-06 | 必须响应式 | 2026-10-21 |
