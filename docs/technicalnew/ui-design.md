# 浏览器前端设计契约

日期：2026-10-21。定义工作台浏览器界面的布局、视觉、组件与交互行为；产品能力由[产品总览第 6 节](../productnew/README.md#6-用户实际能看到和操作什么)约束，接入方式见 [A7](architecture.md#a7-前端层)。
本页是**已实现**契约：布局与视觉依据 `docs/design/tui/` 原型，实现位置在 `devagent/webapp/src/`。

## U1 范围与现状

| 事实 | 证据 |
|---|---|
| 唯一外壳：React 19 + Vite 7，`npm run build` 产出 `web-static/`，服务端在 `/` 托管 | `devagent/webapp/vite.config.ts`、`src/server/http.ts` |
| 三屏：Chat / Requirements / Settings（Providers · Models · Appearance） | `webapp/src/app/`、`chat/`、`requirements/`、`settings/` |
| 旧的无构建外壳已删除；`/app/*` 301 到同路径 | `src/server/http.ts` |
| 设计基准是 `docs/design/tui/`，不是旧 mock | `docs/design/tui/tui.css` |

不包含：服务端业务语义、Agent 提示词、模型调度。

## U2 布局

```text
┌ 顶栏 44 ───────────────────────────────────────────────────────────┐
│ ❯ AgentDev │ project ▾ │ Chat  Requirements  Settings │ ● Connected │
├────────────────────────────────────────────────────────────────────┤
│ 屏内容（Chat 为 会话列 240 + 会话区；其余为整页）                    │
└ 状态栏 28 ──────────────────────────────────────────────────────────┘
│ 项目路径 │ ⎇ main │ ● N 个 Agent 运行中 │ 快捷键提示                 │
```

- 导航是顶栏文字标签，当前项由地址决定；`/`、`/requirements`、`/settings/*` 可刷新、可分享。
- Chat 屏区域顺序固定：横幅 → 任务条 → 转录（宽 90% 居中）→ dock（问题面板 / 队列 / 输入框 / 提示）。
- 断点：`≤1100` 看板 4→2 列；`≤860` 会话列收为顶栏按钮 + 抽屉、设置菜单横置、内容取消 90% 限制、顶栏仅显示连接符号；`≤560` 抽屉全宽、选项行 ≥44px。
- 顶栏永不横向溢出：项目名截断、状态词在窄屏只留符号。

## U3 令牌

唯一权威为 `webapp/src/theme/tokens.css`（源自 `docs/design/tui/tui.css`）；组件内不写死颜色、字号、间距。

| 类别 | 取值 |
|---|---|
| 背景 | `bg / surface / raised / inset` 四级 |
| 边界 | `line / line-strong` 两级，1px |
| 文本 | `fg / fg-2 / fg-3` 三级 |
| 强调 | `accent`（深色 `#bfa2ff`，浅色 `#5b3fd6`），用于当前项与主操作 |
| 语义 | `run / decide / done / block / idle / paused`，只表达状态，且必须与符号同现 |
| 字阶 | 12 / 13 / 14 / 16 / 20；正文 14；行高 1.7 |
| 字体 | 代码、路径、ID、耗时用等宽；中文正文与按钮用系统无衬线 |
| 形状 | 直角，无圆角；`.box` 把标题切入上边框 |
| 间距 | 4 的倍数（4/8/12/16/24/32/48），紧凑密度整体缩小一档 |
| 动效 | 150ms；`prefers-reduced-motion` 归零 |
| 主题 | 深色默认；浅色与"跟随系统"完整可用 |

## U4 组件

`app/`：TopBar、StatusBar、ProjectDialog、Drawer、State（状态符号+词）、router。
`chat/`：SessionsList、Banner、TaskStrip、Transcript、MessageItem、ThinkingBlock、Markdown、ToolCard、ToolTask、ToolBusiness（question / report / requirement）、InteractionPanel、QueuedInputs、Composer、EmptyState、MemberDrawer。
`requirements/`：RequirementsPage（四列看板）、RequirementDrawer。
`settings/`：SettingsPage、ProvidersPage、ModelsPage、AppearancePage。
`auth/`：LoginPage。

规则：状态一律用 `State` 渲染，不直接写颜色；界面文案一律经 `i18n/catalog.ts`。

## U5 会话面

| 元素 | 规则 |
|---|---|
| 会话列 | 每行 = 状态符号 + 派生标题（首条用户消息，24 全角截断）+ 底部"新建会话"。只列用户自己的主管会话；Task 成员 Session 属于该 Task，在任务条 / 任务详情里以成员行出现，不重复占用会话列 |
| 消息 | `who`（角色 + 时间）＋左侧竖线正文；同一轮连续消息不重复头部 |
| 思考 | 流式中显示 `● 思考中` + 末尾预览；完成后折叠为字数 |
| 流式 | 增量追加，光标只在末块；已完成消息不重渲染；仅贴底时自动跟随 |
| 工具卡 | 默认一行（符号 + 名称 + 一句摘要 + 耗时）；展开参数与输出；工具返回的图片在卡内显示为可点开的缩略图；`task create` 内联 plan，`dispatch` 显示成员行并可跟随，完成后退化单行 |
| 任务条 | 一行：Task 编号、按真实发生绘制的阶段链（成员用过的阶段 + 当前阶段，按阶段顺序，没走过的阶段不画；文档 Task 显示计划 → 设计，不是"计划—开发—审核—测试—结算"；`requiresTest=false` 不出现测试）、成员数与状态、暂停/继续。点击编号进任务详情；点击成员数展开执行面板 |
| 执行面板 | Task 运行中（active/waiting）且有成员时**自动展开**；用户手动收起后对该 Task 保持收起，不随轮询再次弹开；Task 结束或换 Task 后按新状态判断。展开后显示：Task 目标；每个子 Session 一行 = 角色 + 派发标题 + 所在阶段 + 期望报告类型 + 真实状态（运行中 / 排队 / 已完成 / 失败 / 中断，来自该成员 input 的实际状态）+「打开」。点「打开」在右侧抽屉只读跟随该子 Session 的转录，行保持高亮并显示「已打开」；抽屉抬头显示该成员的阶段与期望报告类型。已产出的报告列在面板底部，点击进任务详情。窄屏（≤860）省略阶段与类型两列，保留角色、标题、状态与入口 |
| 派发卡片 | 调用结束后显示「已派发」及真实结果（含被拒绝的原因），不长期停留在"正在派发" |
| 决定面板 | 停靠在输入框上方、不遮盖转录；数字键直选、↑↓、Enter、Esc 稍后；答复后显示"答复已收到"回显数秒即自行关闭，不要求用户再手动关掉一个已经做完的决定 |
| 输入框 | Enter 发送、Shift+Enter 换行、IME 组合不发送；失败保留草稿；运行中提供 STOP；可添加图片（见 U10） |
| 队列 | 保留输入可见并显示排队原因，可撤回 |
| 空态 | 字标 + 一句规则 + 三个示例 |
| 连接 | 尚无会话 / 连接中 / 已连接 / 重连中 / 离线，横幅给出后果与重试。没有会话时顶栏与底栏都是「尚无会话」而不是「连接中」，空对话区给一条安静说明（不是「连接已断开」），并提供「新建会话」；真断线才显示重连横幅。浏览器记着的会话若服务端已没有（清库、清理过），一律丢弃，不得让它把空工作台带进「重连中」——迟到的 prepare 失败也不得改写当前状态 |
| 错误 | 业务拒绝不清 token；历史读取警告可展开 |

## U10 图片

- 来源两种，落点一致：用户上传（`POST /api/v1/uploads`，cookie + CSRF，png/jpeg/webp/gif，单张 ≤8MB，单条 ≤6 张）；工具截图（browser 直接写入同一附件存储）。
- 界面只拿地址：`GET /api/v1/attachments/<id>`（cookie 认证，`immutable` 缓存）。消息里的 `image` 块是 `{id, mimeType}`，前端拼成 `/api/v1/attachments/<id>`；浏览器响应里不出现 base64。
- 输入框：添加按钮 + 已选缩略图（可逐个移除，上限 6）；上传失败显示服务端原因（类型/大小）；只有图片没有文字也能发送。
- 消息与工具卡：图片缩略图最大 520×360，点击在新标签打开原图；刷新后从历史重新取到同一地址，不重新上传。
- 尺寸与语言：`chat.attach`、`chat.attach.remove`、`chat.attach.limit`、`chat.attach.failed` 双语键；图片 `alt` 用文件名或 mime。

## U6 需求与设置

- 需求页：四列（提案 / 待实现 / 进行中 / 已完成）是记录状态的投影；无法解析的文件在通知行显示并可查看原文；抽屉按类型显示各自章节。
- 设置页：Providers（地址、模型、是否已配置、试连）、Models（全局 / 本项目作用域 + 来源标记）、Appearance（主题 / 语言 / 密度）。

## U7 可访问性与文案

- 焦点可见；图标按钮有可读名称；浮层（对话框、抽屉、问题面板）可用 Esc 关闭。
- 对比度不低于 4.5:1。
- 全部文案来自 `i18n/catalog.ts`，两语键集合、占位符集合必须一致；语言切换不刷新页面。

## U8 门禁

| 门禁 | 检查 |
|---|---|
| 类型 | `npm run typecheck`（服务端）、`npm --prefix webapp run typecheck` |
| 文案 | `test/web-i18n-keys.test.ts`：键一致、无缺失、无空值、占位符一致 |
| 构建 | `npm run build` 成功产出 `web-static/index.html` |
| 浏览器 | `npm run test:browser`（先构建再跑）：三屏、对话、提问答复、双击防重、业务拒绝、断线返回、被拒工具仍可见、提案分段、任务条与推送、模型范围、需求交接、文件/报告阅读、更早历史、重绑定、任务列表、焦点陷阱、错误文案、五档视口、主题切换 |
| 单测 | `npm test` 全绿 |

## U9 方法消费

每个公开方法必须有一个界面消费者，否则它不该存在；没有消费者的方法登记在[缺口登记](gap-register.md)，不是「以后再接」。

| 方法 | 消费界面 |
|---|---|
| `auth.login` / `auth.logout` | 登录屏、顶栏退出 |
| `project.open` / `project.get` / `project.list` | 项目对话框、顶栏、状态栏 |
| `project.rebind` | 项目对话框（目录缺失行） |
| `project.files.list` / `project.files.read` | 文件阅读器 |
| `session.create` / `session.list` / `session.get` | 会话列、新建、当前会话 |
| `session.messages.list` | 转录「加载更早」 |
| `session.recovery.inspect` | 会话横幅（未确认结束的运行） |
| `session.stream.prepare` | 会话流（连一次，只读快照） |
| `session.input.get` | 无——登记为缺口（U8 已由 `session.get.config` 覆盖） |
| `session.input.submit` / `session.input.stop` | composer、队列撤回、STOP |
| `task.get` / `task.list` | 任务条、成员抽屉、任务详情、需求屏任务段 |
| `task.control` | 任务条暂停/继续 |
| `task.report.get` | 任务详情里的报告 |
| `requirement.list` / `requirement.get` | 需求看板、抽屉 |
| `interaction.respond` | 问题面板 |
| `config.get` / `config.save` / `config.test` | 设置三页 |
| `session.recovery.resolve` | 无界面：处置由主管的 `task(op=recover)` 执行 |
| `session.cleanup` | 会话列行内清理（两步确认） |
| `POST /api/v1/uploads` | composer 添加图片 |
| `GET /api/v1/attachments/<id>` | 消息、工具卡内的图片 |


新增方法时同步这张表；有任何一行是「无」且未登记缺口，按缺陷处理。
