# Plan · UI 一次性重构（TUI 高保真 + 全渲染能力 + 多语言 + 响应式）

```yaml
plan:
  task: ui-refactor-20261021
  status: Awaiting Plan Confirmation
  goal: >
    用 docs/design/tui 的布局与设计语言重建工作台前端，一次性替换现有两套外壳：
    / 即新壳（无 /app 前缀），旧壳 web/ 与 web-static/app 删除；
    保留 webapp 现有 chat 渲染的全部能力；en/zh-CN 双语；五档响应式。
```

## 1. 验收标准（可观察）

| 编号 | 验收 | 观察方式 |
|---|---|---|
| A1 | `/` 打开即新壳；`/app`、`/app/*` 301 到 `/` | curl + 浏览器 |
| A2 | 顶栏含：字标、项目切换按钮（开对话框）、三导航标签、连接态 | 截图 + DOM |
| A3 | 状态栏含：项目路径、分支、运行中 Agent 数、快捷键提示 | 截图 |
| A4 | 会话页：左列会话（派生标题+状态符号+相对时间+新建）、横幅、任务条、转录、问题面板、队列、composer、成员抽屉 | 逐项截图 |
| A5 | 转录渲染 TUI 全部 9 类消息 + 10 类工具/业务对象 | 场景脚本 + 截图 |
| A6 | 保留能力 R1/R5/R6/R9/R11/R13 全部可观察 | 断线重连、上滚锁定、长代码、带 taskId 提交、中文 IME、离线横幅 |
| A7 | 需求页：四列看板 + 解析失败通知 + 两型抽屉字段不同 | 截图 |
| A8 | 设置页：Providers / Models / Appearance 三页；Appearance 含主题+语言+密度 | 截图 |
| A9 | 语言切换即时生效，无刷新；两语键集合差异为 0 | 脚本断言 |
| A10 | 五档视口（1440/1024/860/390/320）无横向溢出、关键操作可达 | 五档截图 |
| A11 | 旧壳目录与旧构建产物不存在；仓库无残留引用 | grep + 构建 |
| A12 | 现有浏览器验收场景迁移后全绿 | playwright |

## 2. 范围

### in_scope
- `devagent/webapp/`：全量重写为 TUI 结构（路由、外壳、三屏、组件层、令牌、i18n）
- `devagent/src/server/http.ts`、`main.ts`：去掉 `/app` 专用分支，`/` 服务新构建
- `devagent/webapp/vite.config.ts`：`base:/`、产物到 `web-static`
- `devagent/browser/`：选择器迁移 + 新增视口与语言用例
- 删除 `devagent/web/`、`devagent/web-static/`

### out_of_scope
- 后端业务语义、RPC 信封、存储结构（**不新增 sessions.title 列**）
- TUI 原型的"原型控制"面板（重播/倍速/注入）
- 文件浏览、文档视图、运行控制台（TUI 无，产品后续阶段）
- 后端缺口：`project.list`、`session.list` 富字段、`config.matrix`

## 3. 页面与路由

| 路径 | 屏 | 来源 |
|---|---|---|
| `/` | 会话 | `app.js` chat 分支 + `chat-*.js` |
| `/requirements` | 需求 | `app.js` reqs 分支 |
| `/settings/providers` | 设置 · Providers | `app.js` settings/providers |
| `/settings/models` | 设置 · Models | `app.js` settings/roles |
| `/settings/appearance` | 设置 · Appearance | `app.js` settings/look + 语言/密度 |
| 其他 | 回 `/` | SPA fallback |

导航标签：Chat / Requirements / Settings（中文：会话 / 需求 / 设置），快捷键 1/2/3。

## 4. 文件级改动

### 4.1 新建 `devagent/webapp/src/`

| 路径 | 职责 | 来源证据 |
|---|---|---|
| `main.tsx` | 挂载 | 现有 |
| `app/App.tsx` | 路由 + Providers（I18n/Theme/Layout/Session） | 新 |
| `app/AppLayout.tsx` | 顶栏+主区+状态栏三行网格；三态视口 | `tui.css:58` |
| `app/TopBar.tsx` | 字标 / 项目按钮 / 导航 / 连接态 | `app.js:22-33` |
| `app/StatusBar.tsx` | 路径 / 分支 / 运行数 / 快捷键 | `app.js:34-38` |
| `app/ProjectDialog.tsx` | 项目列表 + 添加目录 | `app.js:117-125` |
| `app/router.ts` | pushState 路由 + 快捷键 | 新 |
| `theme/tokens.css` | 照 `tui.css:1-45` 令牌（深/浅） | `tui.css` |
| `theme/base.css` | 直角、字体分工、断点、滚动 | `tui.css` + 决策 |
| `i18n/catalog.ts` | en/zh-CN 常量（迁移 236 键 + 新增） | `web/i18n.json` |
| `i18n/I18nProvider.tsx` | `t()`、locale、持久化 | 新 |
| `layout/useLayout.ts` | `matchMedia` 三态 | `responsive.md` |
| `chat/ChatPage.tsx` | 会话页骨架 | `chat-mount.js:9-22` |
| `chat/SessionsList.tsx` | 派生标题/时间/新建 | 决策 Q2 |
| `chat/TaskStrip.tsx` | 阶段链/成员/暂停继续 | `chat-view.js:C.strip` |
| `chat/Banner.tsx` | 断线/阻塞/历史警告 | `chat-view.js:C.banner` |
| `chat/Transcript.tsx` | 消息流 + 组内续接 | `chat-view.js:item` |
| `chat/MessageItem.tsx` | who/时间/正文/停止/忙碌 | `chat-view.js` |
| `chat/ThinkingBlock.tsx` | 两态思考 | `chat-view.js` |
| `chat/Markdown.tsx` | 移植现有（拆分 fence + 预算高亮） | `webapp/src/components/Markdown.tsx` |
| `chat/ToolCard.tsx` | 通用工具 + 运行尾输出 | `chat-view.js:generic` |
| `chat/ToolTask.tsx` | create/update/dispatch/end 四态 | `chat-view.js:taskTool` |
| `chat/ToolQuestion.tsx` | 提问行 | `chat-view.js:questionTool` |
| `chat/ToolReport.tsx` | 报告行 | `chat-view.js:reportTool` |
| `chat/ToolRequirement.tsx` | 已保存事件行 | `chat-view.js:tool` |
| `chat/Composer.tsx` | ❯ + textarea + STOP + IME | `chat-view.js` + 现有 |
| `chat/InteractionPanel.tsx` | 数字键/↑↓/Esc/三型/回显 | `chat-view.js:C.popup` |
| `chat/QueuedInputs.tsx` | 排队行 + 撤回 | `chat-view.js:C.dock` |
| `chat/MemberDrawer.tsx` | 响应式抽屉只读跟随 | `MemberDrawer.tsx` + `chat-view.js:C.drawer` |
| `chat/EmptyState.tsx` | 字标+三示例 | `chat-mount.js:empty` |
| `requirements/RequirementsPage.tsx` | 四列看板 + 通知 | `app.js:reqs` |
| `requirements/RequirementDrawer.tsx` | 两型字段/无效件 | `app.js:drawer` |
| `settings/SettingsPage.tsx` | 菜单 + 分页 | `app.js:settings` |
| `settings/ProvidersPage.tsx` | 列表 + 试连 + 添加 | `app.js:90` |
| `settings/ModelsPage.tsx` | 全局/本项目 + 来源 | `app.js:92-95` |
| `settings/AppearancePage.tsx` | 主题 + 语言 + 密度 | `app.js:102` + 新增 |
| `auth/LoginPage.tsx` | 凭证 | 新 |
| `state/*`、`api/*`、`lib/*` | 沿用现有，`useChiefSession` → `useSession`（多会话槽） | 现有 |

### 4.2 修改

| 路径 | 改动 |
|---|---|
| `webapp/index.html` | 语言属性随 locale；标题 |
| `webapp/vite.config.ts` | `base:'/'`、`outDir:'../web-static'`、proxy 去 `/vendor` `/i18n.json` |
| `src/server/http.ts` | 删 `appStaticDir` 分支；`/app`→301 `/`；SPA fallback 到 `staticDir` |
| `src/server/main.ts` | `staticDir` 指向 `web-static`；删探测 |
| `devagent/.gitignore` | 若 `web-static` 仍忽略则调整（新壳产物需存在） |
| `devagent/package.json` | `build` 脚本串联 webapp 构建（若缺） |

### 4.3 删除

| 路径 | 说明 |
|---|---|
| `devagent/web/` | 旧壳全量 |
| `devagent/web-static/app/` | 旧 `/app` 产物 |
| `webapp/src/components/*`（除迁移后的实现） | 被 `chat/` 取代 |
| `webapp/src/styles.css` | 被 `theme/` 取代 |
| `webapp/src/ported/`（若不再引用） | 视引用情况 |

## 5. 关键设计决策

| # | 决策 | 理由 | 备选与为何不选 |
|---|---|---|---|
| D1 | 字体混合：代码/路径/ID/数字等宽，中文散文无衬线 | macOS 等宽中文字形回退成比例，混排断裂 | 全等宽：可读性差 |
| D2 | 会话标题派生自首条 user 消息（24 全角截断） | 无 title 列；id 对用户无意义 | 新增 DB 列：本轮改后端 |
| D3 | 路由用 pushState，服务端 SPA fallback | 深链可分享/刷新不 404 | hash 路由：URL 脏 |
| D4 | 状态沿用 slot reducer，扩展为按 sessionId 分槽 | 已有 15 条行为验证 | 重写：丢 R1 |
| D5 | 3 秒轮询 task.get 保留 | 服务端无 task 失效推送 | 新增推送：改后端 |
| D6 | i18n 用 TS 常量而非 JSON 加载 | 构建期可校验键一致；无运行时 fetch | 运行时 JSON：首屏多一次请求 |
| D7 | 删除旧壳；`/app` 301 | 用户要求一次性，不留并存 | 灰度：用户明确否决 |

## 6. 保留能力（必须在组件内实现）

| 编号 | 能力 | 落点 |
|---|---|---|
| R1 | 快照按 entryId 合并，在飞不降级 | `state/slot.ts`（沿用） |
| R2 | 统一归一化边界 | `state/normalize.ts`（沿用） |
| R3 | 增量流式三型 | `state/slot.ts`（沿用） |
| R4 | toolResult 按 callId 回填 | `chat/Transcript.tsx` |
| R5 | 上滚锁定 / 贴底恢复 / 回到最新 | `lib/scroll.ts` ∈ `ChatPage` |
| R6 | 高亮预算队列 | `lib/highlight-queue.ts` ∈ `chat/Markdown.tsx` |
| R7 | 交互生命周期 busy→echo→stale→retry | `chat/InteractionPanel.tsx` |
| R8 | 排队输入可见可撤回 | `chat/QueuedInputs.tsx` |
| R9 | 提交前读 session.get 带 taskId | `state/useSession.ts` |
| R10 | 失败不丢草稿 | `chat/Composer.tsx` |
| R11 | IME 组合不发送 | `chat/Composer.tsx` |
| R12 | 成员抽屉独立槽 | `chat/MemberDrawer.tsx` |
| R13 | 连接四态 | `state/useSession.ts` + `Banner` |
| R14 | 历史读取警告 | `chat/Banner.tsx` |
| R15 | 任务实时状态 | `chat/TaskStrip.tsx` |

## 7. 响应式

| 断点 | 规则 |
|---|---|
| ≥1101 | 240 侧栏 + 90% 居中内容 + 四列看板 + 设置左菜单 |
| 861–1100 | 看板 2 列 |
| ≤860 | 侧栏→顶栏按钮+sheet；看板 1 列；设置菜单横置；内容去 90% 限制；成员行隐备注 |
| ≤640 | 抽屉全宽；工具摘要折行 |
| ≤390 | 顶栏隐项目路径、状态栏只留连接态 |

`useLayout()` 用 `matchMedia` 输出 `{columns:number, mode:'wide'|'mid'|'compact'|'phone'}` 单一来源。

## 8. 验证计划

| 层 | 命令 | 预期 |
|---|---|---|
| 类型 | `npm run typecheck`（webapp） | 0 错误 |
| 单测 | `npx vitest run`（webapp + 仓库） | 全绿 |
| i18n 键一致 | `node webapp/scripts/check-i18n.mjs` | 差异 0 |
| 构建 | `npm run build`（webapp → web-static） | 产物存在 |
| 浏览器 | `npx playwright test` | 迁移后的场景全绿 + 新增 5 档/双语 |
| 手工 | 真服务 + 浏览器走 J-01~J-05 | 会话/需求/设置可完成 |

## 9. 风险与回滚

| 风险 | 缓解 |
|---|---|
| 删除旧壳导致验收全挂 | 浏览器用例与删除在同一任务内迁移（步骤 S7 之前必须先绿） |
| 包体增大 | 依赖仍只有 react + markdown-it + highlight.js |
| 派生标题性能 | 只 prepare 首条，不订阅；失败回退 `新会话` |
| 一次性重构中途失控 | 每步结束可构建、可跑浏览器用例 |

回滚：`git revert` 本轮提交（工作区干净为交付门槛）。

## 10. 执行顺序（dev 单元）

| 步 | 内容 | 自查 |
|---|---|---|
| S1 | 令牌 + i18n + 布局 + 路由 + 顶栏/状态栏/项目对话框 | 三屏空壳可切，双语可换 |
| S2 | 会话屏：会话列 / 任务条 / 横幅 / 转录 / 消息 / 思考 / Markdown | 静态夹具渲染 9 类 |
| S3 | 工具四类 + 问题面板 + 队列 + composer | 静态夹具渲染 10 类 |
| S4 | 会话状态接入（slot/流/提交/停止/答复） | 真服务跑通一轮 |
| S5 | 需求屏 | 看板 + 两型抽屉 + 无效件 |
| S6 | 设置三页 + 登录 | 读写配置 |
| S7 | 响应式五档 + 浏览器用例迁移 | playwright 绿 |
| S8 | 服务端切换 + 删除旧壳 + 全量回归 | A1/A11/A12 绿 |

## 11. 文档影响

- `docs/technicalnew/ui-design.md`：被本轮整体替换（布局/令牌/组件/断点全部改写）
- `docs/technicalnew/architecture.md` A7：外壳合并为单入口
- `docs/technicalnew/validation.md`：记录本轮验证
- `docs/INDEX.md`：若无入口变化则不改

## 12. 审批

```yaml
approval: pending
```
