# 浏览器前端设计契约

日期：2026-10-21。定义工作台浏览器界面的布局、视觉、组件与交互行为；产品能力由[产品总览第 6 节](../productnew/README.md#6-用户实际能看到和操作什么)约束，接入方式见 [A7](architecture.md#a7-前端层)。
本页是**已实现**契约：布局与视觉依据 `docs/design/tui/` 原型，实现位置在 `devagent/webapp/src/`。

## U1 范围与现状

| 事实 | 证据 |
|---|---|
| 唯一外壳：React 19 + Vite 7，`npm run build` 产出 `web-static/`，服务端在 `/` 托管 | `devagent/webapp/vite.config.ts`、`src/server/http.ts` |
| 三屏：Chat / Requirements / Settings（Providers · Models · Appearance） | `webapp/src/app/`、`chat/`、`requirements/`、`settings/` |
| 旧的无构建外壳已删除；`/app/*` 301 到同路径 | `src/server/http.ts` |
| 设计基准是 `docs/design/tui/`：`docs/design/tui/index.html` 是可直接打开的高保真原型（含脚本化对话） | `docs/design/tui/{index.html,tui.css,chat-view.js}` |

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
- 断点：`≤1100` 看板 4→2 列；`≤860` 会话列收为顶栏按钮 + 抽屉、设置菜单横置、内容取消 90% 限制、顶栏仅显示连接符号、文件查看器的树移到上方 32%；`≤560` 抽屉全宽、选项行 ≥44px、顶栏连线符号化、composer 压缩留出正文、Toast 抬到 dock 之上；`≤400` 导航标签换成图标（文字仍在 DOM 内，是读屏的可读名称）。
- **移动端形态待重做**（见[缺口登记 M1–M5](gap-register.md#m-移动端方向已定尚未实施)）：当前窄屏是压缩版，不是移动端形态；目标是底部固定 Tab Bar + 全屏会话列表 + 顶栏只留项目与连接。下列约束在重做时必须继续成立（每条都由真实 320/390px 截图与用例锁定）：
  - **外壳栅格列必须是 `minmax(0, 1fr)`**：`.app` 与看板列用裸 `1fr` 时，最小值是内容 min-content，一个宽句子就能把整列撑宽，顶栏随之被推出右边缘。
  - **顶栏控件不参与收缩**：项目按钮有可点击下限（不得缩成 0）、rail 开关与导航 `flex: none`；让位的是项目名与副标题。
  - **一行折叠的控件必须真的一行**：任务区折叠行 `nowrap`，标题让位。
  - **Toast 不盖内容**：手机上不存在既安全又固定的位置，故按屏幕给抬升量（聊天屏避开 composer，其余屏幕贴底），由 `ToastHost` 的 `lift` 传入，不靠后代选择器猜。
  - **查看器头部可换行**：手机上路径独占一行，Download/Esc 保留各自位置。
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
| 字阶 | 12 / 13 / 14 / 16 / 20；正文 14；行高 1.75 |
| 字体 | 全站等宽（JetBrains Mono 起头，中文回退 PingFang SC / Microsoft YaHei 放在同一字族栈内，中文等宽字形本就等宽，混排不破坏对齐）；散文限宽 110ch 软上限，工具行/表格/任务清单用满整列 |
| 形状 | 直角，无圆角；`.box` 把标题切入上边框 |
| 间距 | 4 的倍数（4/8/12/16/24/32/48），紧凑密度整体缩小一档 |
| 动效 | 150ms（颜色/宽度过渡）；进行中节点用唯一常驻循环 `work`（1.6s 呼吸圆环）；`prefers-reduced-motion` 下把 `--t` 归零、循环改为静态圆环（状态由形状 + 文字表达，不依赖动画） |
| 主题 | 深色默认；浅色与"跟随系统"完整可用 |

## U4 组件

`app/`：TopBar、StatusBar、ProjectDialog、Drawer、State（状态符号+词）、router。
`chat/`：SessionsList、Banner、TaskStrip、TaskTodo、Transcript、MessageItem、ThinkingBlock、Markdown、ToolCard、ToolTask、ToolBusiness（question / report / requirement）、InteractionPanel、QueuedInputs、Composer、EmptyState、MemberDrawer、TaskDrawer。
`files/`：FileViewer（唯一文件查看画布）、SourceView（源码视图：行号 + 高亮 + 查找）、MarkdownView（`.md` 渲染/源码两态）、file-kind（按扩展名决定显示方式与语法）、link-target（链接归属解析）、paths（路径与字节地址助手）；`lib/highlight.ts` 是唯一语法注册表。
`requirements/`：RequirementsPage（四列看板）、RequirementDrawer。
`settings/`：SettingsPage、ProvidersPage、ModelsPage、AppearancePage。
`auth/`：LoginPage。

规则：状态一律用 `State` 渲染，不直接写颜色；界面文案一律经 `i18n/catalog.ts`。

信息密度的待改项（消息间距分档、成员状态去重、工具卡默认折叠、执行面板限高）见 [缺口登记 Q1–Q4](gap-register.md#q-待改已决定方向尚未实施)，尚未实施。

## U5 会话面

| 元素 | 规则 |
|---|---|
| 会话列 | 每行 = 状态符号 + 标题（用户自定义名；未命名时取首条用户消息，24 全角截断显示）+ 行尾「✎」改名按钮 + 底部"新建会话"。改名是行内输入框：Enter 保存、Esc 取消、清空回车即恢复默认名；名字只影响显示，不改历史、归属或执行授权。只列用户自己的主管会话；Task 成员 Session 属于该 Task，在派发卡片 / 任务详情里以成员行出现，不重复占用会话列 |
| 消息 | 平铺终端流：无 who 头、无边栏线。**用户行**是 `❯`（accent 加粗）引导的单行输入，带 surface 底色块与 2px accent 左边线，`❯` 与文字同处一行（块级子元素时强制 inline）；主管/成员回复为无底色纯文本。换轮以用户行前 24px 分隔，同轮连续块 8px；主管散文限宽 110ch 软上限（用户行不限），工具行/表格/任务清单用满整列 |
| 思考 | 流式中 `● 思考中` 斜体暗色 + 末尾预览；完成后折叠为字数（斜体） |
| 流式 | 增量追加，光标只在末块；已完成消息不重渲染；仅贴底时自动跟随。**跟随按意图判定、不按距离**：贴底状态下每次「用户发送」「点跳转」「按 Esc（输入框为空）」都钉在尾部，只有用户自己上滑才解除；跟随本身在 layout effect 里执行（React 写入新内容后、浏览器绘制前），因此每帧增长都发生在贴底位置，不会出现「新行先画在尾部下面、下一帧才被拉回」的观感——这是高速输出时「找不到尾部」的根因（旧的 `距离 < 60px` 判定在单帧增量超过 60px 时会误判为用户上滑，从而永久解开跟随）。解除跟随后，dock 上方的胶囊显示 `↓ 回到最新 · 下方还有 N 行`（N 为离开尾部后新增的内容高度换算行数，行首带 run 色呼吸点表示输出仍在继续），点一次即回到底部并重新钉住 |
| 工具卡 | 默认一行（符号 + 名称 + 一句摘要 + 耗时）；展开参数与输出；工具返回的图片在卡内显示为可点开的缩略图；`task create` 折为单行 `✓ Task created · T-x · N 行 Plan`，展开是 Plan 原文 |
| 运行中的 Task | **任务清单（`data-testid=task-live`，TaskTodo）**：转录末尾的一块（头部 Task 号可点 · 当前阶段 · `n/m 已结束` · 状态；可选展开的 Plan；成员清单按**阶段-轮次**分组，画成一条竖向节点轨道：每个步骤一个节点（完成=实心✓、进行中=呼吸圆圈+整行 run 色底带、计划=虚线圈、失败=block 色），步骤间由轨道连线，正在进行的步骤轨道段亮 run 色）。它是成员实时状态的**唯一来源**：派发卡折为单行历史；真实分组之后追加**计划中的后续阶段**（write 任务依 `type + requiresTest` 推导：`review`（+`requiresTest` 时 `test`）+ `settle`，取真实走过的最远阶段之后的部分，暗色显示、组内为「未开始(计划内)」，主管偏离计划时不新增（现实优先））；清单列出该 Task **全部**派发过的成员（`task.get` 按 createdAt 序），同阶段重现即新一轮（`Develop · 第 2 轮`），未通过成员行染 block 保留（触发返工的证据），已在报告后又运行的成员带 `↻ 返工` 前缀；行可点开成员抽屉。刷新/主管等待中恒渲染，不依赖转录里存在派发调用 |
| 任务条 | 只有流程，画成横向节点轨道：一行 = Task 编号 + 步骤节点序列（每步 = 节点圆点 + 名称；完成=实心✓、当前=呼吸圆圈（`work` 动画）、计划=虚线圈；同阶段重复进入显示 `×n`）+ 进度条与 `已完成/真实步骤数`（计划步骤永不计数，窄屏 <1280px 隐去，因与文字同义）+ 当前状态 + 暂停/继续。节点之间的连线由右侧步骤持有：走到当前步骤的那段亮 run 色，计划段全部虚线——「已走到哪」与「还欠什么」一眼可分。步骤来自 `flowOf`，与任务清单返回同一个数组，按位置一一对应，两处永不矛盾。Task 完成或取消后不再显示 |
| 派发卡片 | 恒为单行（符号 + `派发 N 名成员`/`继续 <角色>` + 成员名 + 耗时），展开是调用真实结果（机器 JSON 不铺在行上）；成员实时状态一律在任务清单 |
| 决定面板 | 停靠在输入框上方、不遮盖转录；**选项列排序**（数字槽 + 悬挂缩进，长文案在行内换行、问题标题可换行不省略）；数字键直选、↑↓、Enter、Esc 稍后；答复后显示"答复已收到"回显数秒即自行关闭 |
| 队列 | 保留输入可见并显示排队原因，可撤回 |
| 空态 | 字标 + 一句规则 + 三个示例 |
| 连接 | 尚无会话 / 连接中 / 已连接 / 重连中 / 离线，横幅给出后果与重试。没有会话时顶栏与底栏都是「尚无会话」而不是「连接中」，空对话区给一条安静说明（不是「连接已断开」），并提供「新建会话」；真断线才显示重连横幅。浏览器记着的会话若服务端已没有（清库、清理过），一律丢弃，不得让它把空工作台带进「重连中」——迟到的 prepare 失败也不得改写当前状态 |
| 错误 | 业务拒绝不清 token；历史读取警告可展开 |

## U11 文件与报告查看器

只有一个查看器（`files/FileViewer`），两个入口：项目文件预览区（全屏画布）与任务结果里的报告正文。**它是查看器，不是运行器**：不执行文件、不渲染 HTML、不加载页面子资源、没有沙箱策略。

| 项 | 规则 |
|---|---|
| 形态 | 全屏画布（覆盖顶栏以下、状态栏以上，`data-testid=file-viewer`），左侧 260px 目录树 + 右侧内容区；<861px 时目录树变为上方 32% 的条带。不用 560px 抽屉——报告和两千行源码需要的是整窗 |
| 目录树 | 每行有固定的字形列区分种类：文件夹 `▸`（accent 色 + 名称带 `/`）、文件 `·`、符号链接 `↗`、其他 `?`、上级目录 `↑`；知识条目用 `✓`/`·` 表示存在与否。根目录下列表中与知识条目同名的行不再重复出现（同一条路径只出现一次）。行带 `data-type`，测试据此断言 |
| 入口 | ① **顶栏「文件」标签**（`data-testid=nav-files`，未打开项目时禁用并说明原因；打开的是根目录）——读取项目文件是打开工作台的理由之一，不能藏在对话框里；② 项目对话框的知识条目与目录浏览；③ 任务结果 → 报告正文 → 正文自己的项目路径（`task.report.get` 返回的 `relativePath`）。它是画布不是路由：关闭后回到原屏幕，地址栏不变；**打开期间只有「文件」标签是 current（`aria-current=page`），页面标签在同一时刻不再标 current——同一时刻只能有一个「所在地」**；点击任何页面标签或按 1/2/3 都先关闭画布再切换（否则画面被覆盖层挡住，看起来像点击无效）工具卡保持现状，不做点击 |
| 代码即源码 | 代码、配置、`.html`、`.json` 等文本文件按**源码**显示：等宽、行号栏（`user-select: none`，复制代码不带行号）、`white-space: pre` 不折行 |
| 文档 | `.md` / `.markdown` / `.mdx` 是唯一按**渲染**显示的类别（`files/MarkdownView`）：默认渲染态，`渲染 / 源码` 两个切换页签，源码态复用同一个 `SourceView`；两种视图是同一份字节，切换不编辑内容。文件顶栏之外文档正文限宽 110ch，标题按文档层级（h1 20 / h2 16）而非转录里的紧凑层级 |
| 文档里的链接 | 从不改写文件内容，在**点击时**解析（`files/link-target.ts`）：绝对宿主路径若在项目根之内 → 转成项目相对路径交给同一画布打开；`./`、`../` 相对路径按**所在文档的目录**解析，越过项目根一律视为项目外；`http(s)/mailto` 交给浏览器新标签；`#fragment` 交给页面。项目外的路径明确提示「该路径不在当前项目内」，绝不导航到 404 |
| 聊天里的链接 | 同一条解析规则（`ChatPage.openLink`），转录里任何 `.md` 区块的外链点击都被拦截：宿主绝对路径 → 文件画布；项目外 → 提示；真外链 → 新标签。这就是「报告里写了 `/Users/…/.dev/work/t-x/shots/a.png`」不再跳到 `http://127.0.0.1:4173/Users/…` 的原因 |
| 高亮 | `lib/highlight.ts` 是唯一的语法注册表，转录代码围栏与查看器共用同一份 grammar 列表与同一套 token 颜色；未注册的扩展名保持纯文本，不猜语言 |
| 查找 | 文件内查找：显示匹配**行数**，并列出最多 50 条命中行供跳转（按固定行高换算滚动位置，不建逐行 DOM） |
| 图片/媒体 | 用原生 `<img>/<video>/<audio>`，字节来自 `GET /api/v1/project-files/<projectId>/<path>`；`img` 用 `object-fit: contain` 适配 |
| 二进制/PDF | 明说不能预览 + 下载按钮；不打印控制字符，不做 PDF 预览 |
| 下载 | 同一字节路由加 `?download=1`，响应带 `content-disposition: attachment` |
| 报告 | 报告正文同样走 `SourceView`（报告是文件，不是另一套排版）；write Task 的报告给出**项目相对路径**并可跳进查看器；read Task 的报告在服务端工作区，显示「服务端副本」而不外泄绝对路径 |
| 字节路由 | 只读、cookie 认证、限定项目内、不跟随符号链接、`nosniff`、`no-store`；路径段是 projectId，URL 里不出现服务器路径 |

## U10 图片

- 来源两种，落点一致：用户上传（`POST /api/v1/uploads`，cookie + CSRF，png/jpeg/webp/gif，单张 ≤8MB，单条 ≤6 张）；工具截图（browser 直接写入同一附件存储）。
- 界面只拿地址：`GET /api/v1/attachments/<id>`（cookie 认证，`immutable` 缓存）。消息里的 `image` 块是 `{id, mimeType}`，前端拼成 `/api/v1/attachments/<id>`；浏览器响应里不出现 base64。
- 输入框：添加按钮 + 已选缩略图（可逐个移除，上限 6）；上传失败显示服务端原因（类型/大小）；只有图片没有文字也能发送。
- 消息与工具卡：图片缩略图最大 520×360，点击在新标签打开原图；刷新后从历史重新取到同一地址，不重新上传。
- 尺寸与语言：`chat.attach`、`chat.attach.remove`、`chat.attach.limit`、`chat.attach.failed` 双语键；图片 `alt` 用文件名或 mime。

## U6 需求与设置

- 需求页：四列（提案 / 待实现 / 进行中 / 已完成）是记录状态的投影，因此看板在标签页可见时每 5 秒重读一次（隐藏时不发请求，回到前台立刻读一次）；一次刷新替换第一页，已「显示更多」过的任务列表不再被刷新折叠回第一页。无法解析的文件在通知行显示并可查看原文；抽屉按类型显示各自章节。**任务区默认折叠**：折叠时只占一行（`▸ 任务 · 共 N 个`，有进行中任务时附带 `● 进行中 N`），点击整行才展开列表（`aria-expanded`）；刷新与「显示更多」放在这一行的右侧，不单独占行——需求看板是主体，任务列表是脚注，它的控件不能比它的内容占更多高度。
- 设置页：Providers（显示名 + 技术标识、地址、协议、模型、是否已配置、试连、编辑）、Models（全局 / 本项目作用域 + 来源标记）、Appearance（主题 / 语言 / 密度）。Provider 的技术标识创建后不可改；显示名、地址、协议、模型列表与凭证可改（凭证留空表示不变）。协议是必选下拉（OpenAI chat/completions / OpenAI responses / Anthropic messages），不按地址或名称推断。
- Provider 的模型列表逐行编辑：每行是一个模型（id + 「支持推理」勾选 + 移除），末行「+ 添加模型」。勾选写入 `models.json` 的 `reasoning`，这是自定义端点能出现除「关闭」以外思考级别的唯一途径；不勾时 Models 页对应行的思考下拉如实说明「该模型未声明支持推理」并给出回到本页的入口，不留空下拉。
- Models 两个作用域都是逐行编辑：全局作用域 7 个角色各一行；本项目作用域一行「本项目默认」+ 同样 7 行角色，后者只影响该项目。每行右侧标明当前值来自「项目内角色 / 角色 / 项目默认 / 全局默认」，下拉选「默认」即移除该层覆盖、回到继承。
- Models 每行四个格子：角色名、模型下拉、思考等级下拉、来源徽标。思考等级属于该行的模型指派（Pi 的 thinking level），只列 Pi 为该模型判定的可用级别加「未设置（关闭）」：`<select>` 的选项由服务端按模型能力给出，前端不自己拼清单。行内没有自己的模型（继承）时，等级下拉禁用并显示继承到的级别，`title` 说明由更具体的层决定——和来源徽标同一条语义：继承的值不是本行保存的选择。模型不支持推理时禁用并显示「不支持推理」，`title` 指向 Providers 的模型声明。改等级与改模型走同一个保存与冲突语义（同一行的 revision）。窄屏（≤860）行改为标签独占一行、控件换行，控件保持可点。

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
| 浏览器 | `npm run test:browser`（先构建再跑）：三屏、对话、提问答复、双击防重、业务拒绝、断线返回、被拒工具仍可见、提案分段、任务条与推送、模型范围、思考等级、需求交接、文件/报告阅读、更早历史、重绑定、任务列表、焦点陷阱、错误文案、五档视口、主题切换 |
| 单测 | `npm test` 全绿 |

## U9 方法消费

每个公开方法必须有一个界面消费者，否则它不该存在；没有消费者的方法登记在[缺口登记](gap-register.md)，不是「以后再接」。

| 方法 | 消费界面 |
|---|---|
| `auth.login` / `auth.logout` | 登录屏、顶栏退出 |
| `project.open` / `project.get` / `project.list` | 项目对话框、顶栏、状态栏 |
| `project.rebind` | 项目对话框（目录缺失行） |
| `project.files.list` / `project.files.read` | FileViewer（目录树 + 源码视图） |
| `GET project-files/<projectId>/<path>` | FileViewer 的图片/媒体/下载字节来源（唯一非 RPC 读取面） |
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
| `config.get` / `config.save` / `config.clear` / `config.test` | 设置三页（`clear` = Models 行选「默认」） |
| `session.recovery.resolve` | 无界面：处置由主管的 `task(op=recover)` 执行 |
| `session.cleanup` | 会话列行内清理（两步确认） |
| `POST /api/v1/uploads` | composer 添加图片 |
| `GET /api/v1/attachments/<id>` | 消息、工具卡内的图片 |


新增方法时同步这张表；有任何一行是「无」且未登记缺口，按缺陷处理。
