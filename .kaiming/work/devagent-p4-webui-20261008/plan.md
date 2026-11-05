# Plan · devagent-p4-webui-20261008

日期：2026-10-08。状态：**已批准**（用户答复四项决定：原生 ES modules + 目标化渲染库、沿用 Pi 内容块、契约优先、照搬 mock + 差异登记）。批准后开始 P4-a。
依据：`docs/technicalnew/` 的 R1–R6、M4/M5、G2（question）、S2/S3/S5；`docs/productnew/` 的 P-01～P-03、C-01～C-04、R-01～R-08、D-01～D-09、K-01～K-04 与 acceptance；`docs/technicalnew/implementation-checks.md` 的 P4 行。
设计源：`webui/index.html`（mock，另见 `webui/DESIGN.md`）。**注意**：mock 与 DESIGN.md 提供的是视觉与交互设计，其中引用的 `docs/architecture/ui.md`、run/work/attempt 等实体属上一轮架构，不作实现依据；协议与实体一律以本轮 `docs/technicalnew` 为准。

## 1. 事实（证据）

- 契约已定死前端入口：`POST /api/v1/rpc`（requestId + method + params，R6 错误目录，写调用 requestId 去重、同 ID 不同参数 REQUEST_CONFLICT）+ SSE 实时输出；认证为本机口令换取同源 cookie + CSRF，SSE 不在 URL 带凭证；API 不接受任意 Pi 工具名或 cwd（`runtime-contract.md:5-9,53-56`）。
- R1 方法表已列全：project.open/get/rebind、session.create/get/messages.list/input.submit/input.get/input.stop/cleanup、task.list/get/control/report.get、requirement.list/get、interaction.respond、session.stream.prepare、config.get/save/test、project.files.list/read、auth.login/logout、session.recovery.inspect/resolve（`runtime-contract.md:21-49`）。
- M4 定死实时语义：每 Session 一个 EventHub，`session.stream.prepare` 先建缓冲再读快照，`GET /api/v1/sessions/<id>/stream?subscriptionId=` 只发 `seq > boundary`；溢出/代次变化→`stream.resync` 后重新 prepare；**SSE 不重放 Last-Event-ID**；事件体 `event` 保持 Pi AgentSessionEvent，另有 `{type:'invalidate',entity,...}` 业务失效通知；断线销毁缓冲但不取消工作与交互（`messaging-and-collaboration.md` M4）。
- M5 定死交互：`session.bindExtensions({uiContext, mode})`，**绑定 UI 适配器是开关**（与 mode 字符串无关），浏览器宿主首版 mode="rpc"；适配器必须是普通对象（类实例原型方法会被 SDK 展开包装丢掉）；答复写 WAL 后返回原调用（`runtime-contract.md:125`）。
- G2 question：移植官方扩展，浏览器版移除 TUI/custom，仅 `confirm/select/input` 三种通用交互，不新增业务确认 kind（`agents-and-tools.md:112`）。
- Pi v1.0.0 自带协议与参考实现：`docs/rpc.md`（"for IDEs and custom user interfaces"）、`docs/rpc-commands.md`、`docs/rpc-extension-ui.md`、`docs/message-types.md`（text/image/thinking/toolCall/toolResult 内容块）、`examples/rpc-client.ts`、`examples/rpc-extension-ui.ts`、导出 `./client`（`RpcClient`）。**但** R4 明确：本项目 Pi 接入走进程内 SDK（`createAgentSession` + `bindExtensions`），**不改造成 RPC 子进程**（`runtime-contract.md:115-125`）。
- 现状代码：`devagent/src/{runtime,store,tools}` 已有 store（project/session/input/task/result/interaction 基础）、runner（认领→Pi→停稳→终态）、角色工具集、`question` 移植工具（未接 WAL/浏览器）。**没有任何 HTTP/SSE/前端代码**，依赖只有 PI SDK。
- mock：`webui/index.html` 8 个视图（chief/requirements/files/docs/agents/runs/inbox/settings）+ `webui/DESIGN.md`（令牌、骨架、组件规格、字号旋钮、差距表、不做浅色主题、不引字体）。

## 2. 裁决（关于"PI 协议 90% 复用"）

1. **浏览器说的是我们的协议，不是 Pi 的协议**：R1 的方法、归属校验、requestId 去重、CAS/revision、SSE 快照与 resync、交互 WAL，Pi 的 RPC 一条都没有；且 R1 禁止把任意 Pi 工具名/cwd 暴露给前端。把 Pi RPC 直接给浏览器还会绕过认证与项目归属。**结论：不引入 Pi RPC 作为前端传输层。**
2. **但"90% 是渲染 Pi 的东西"这个直觉是对的**：M4 规定 SSE 的 `event` 就是 Pi AgentSessionEvent，会话历史就是 Pi JSONL（message 条目 + content blocks）。因此**前端渲染的主对象就是 Pi 的内容块形状**（text/thinking/toolCall/toolResult + usage）——这一点直接采用 `docs/message-types.md` 的定义，不再自造第二套消息词汇。
3. **可复用的成熟件（"不踩坑"的正确位置）**：
   - 协议与交互形态：直接照 `docs/rpc-extension-ui.md` + `examples/rpc-extension-ui.ts` 实现**进程内** UIAdapter（我们只借形状与语义，不借子进程传输）。
   - 渲染原语：流式 Markdown（半截 fence/表格回退策略）、语法高亮、ANSI/日志着色、长列表虚拟化、SSE 客户端重连——选小而稳的成熟库，不自研。
   - 不建议套整体 UI 框架来"省事"：mock 是定制的高密度控制台设计（DESIGN.md 明确"mock 即规格"），框架的默认样式与组件语义会和它打架，最终既丢设计又添依赖。
4. **真正需要自建、没有现成可抄的部分**（也是风险所在）：快照+边界+resync 的实时协议（M4 明确禁 Last-Event-ID 重放）、交互 WAL 与原调用归位（M5）、按 revision 的失效通知与页面一致性、Task/Session/Requirement 的业务视图映射。

## 3. 前端技术形态（已确认）

**外壳与业务页面自己写，复杂渲染交给成熟库。** 用户担心"原生组件少、Markdown 等复杂渲染自己写难"——这条界线正好在此：

- **自己写**（不复杂，且必须控保真度）：布局骨架、导航与路由、状态栏/顶栏/侧栏、Toast/对话框/data-list 等组件、8 个业务页面、SSE 客户端与快照/失效处理、交互按钮与答复。全部原生 ES modules + mock 的 CSS，无框架（mock 的类名与 DOM 层级 1:1，框架默认样式会与之冲突）。
- **一律用库，绝不手写**：Markdown 解析与 GFM（表格/围栏/列表）、代码语法高亮、ANSI/日志着色、长列表虚拟化。候选：`markdown-it`（流式增量好接）、`highlight.js` 或 `shiki`（按实际体积与是否需要打包在 P4-h0 里量测后定）、`anser`、`@tanstack/virtual-core`（若仅日志窗口化够用则退化为约 80 行自研窗口化，P4-h0 决定）。
- **交付方式**：`devagent/web/vendor/` 内置固定版本的 ESM 产物 + import map，浏览器直接加载，无构建步骤。若某库无法以 ESM 直接消费，只允许加一条 esbuild 命令（产物提交），**不允许为此手写解析器**。
- **自研只做增量与状态，不做解析**：半截 fence/表格的暂存与完成重排、思考块折叠、工具卡状态翻转、SSE 边界与失效——这些是协议与状态逻辑，属于我们的职责，也不是"重复造轮子"。

## 4. 切片（按"契约优先"顺序；每片单独审阅）

```yaml
- id: P4-a RPC 骨架与认证
  change: node:http 同源服务 + POST /api/v1/rpc 信封（requestId 去重/规范化/REQUEST_CONFLICT/R6 错误形状）+ auth.login/logout（cookie+CSRF，SSE 不带凭证）+ 项目归属与显式控制校验 + config.get（脱敏）
  verify: 真实 HTTP 集成测试（fetch）；重复 requestId 幂等；不同参数 409；未认证 401；跨项目 403；凭证不出现在响应
- id: P4-b 只读查询面
  change: project.open/get、session.create/get/messages.list、task.list/get、requirement.list/get、task.report.get、project.files.list/read、session.recovery.inspect、session.input.get
  verify: 与 store 真值一致；无模型可读；非法文件/缺失目录如实报告；路径归属与符号链接拒绝
- id: P4-c 写入与执行面
  change: session.input.submit（只投 chief、taskId 关联）、input.stop（保存意图后 abort）、task.control、session.cleanup、session.recovery.resolve、project.rebind；接 runner/dispatcher
  verify: stub 模型下真实跑通输入→停稳；stop 后 Input 状态与 activity 一致；CAS 冲突返回当前版本；被引用会话不可清理
- id: P4-d SSE 实时（M4）
  change: 每 Session EventHub + 有界缓冲、stream.prepare（缓冲先行+快照+boundary）、GET stream、invalidate 通知、溢出/代次变化→resync、断线销毁缓冲不取消工作
  verify: 两客户端并发不争抢；慢连接溢出触发 resync 且不影响 Pi；重连重新 prepare；seq 严格递增无洞
- id: P4-e 交互桥（M5 + G2 question）
  change: 普通对象 UIAdapter + bindExtensions({uiContext,mode:'rpc'})；交互请求/答复入 WAL（pending/resolved/stale）；question 工具接同一通道；interaction.respond 路由到主管页面；答复返回原调用；父委派等待不提前结束
  verify: stub 模型调用 question → 快照/SSE 出现 pending 交互 → 响应后模型继续；重复响应幂等；过期响应 INTERACTION_STALE；断线重连仍能答复
- id: P4-f 设计系统与外壳（照 mock）
  change: 令牌与组件样式对齐 mock（含 surface-soft/console/line-strong/dim/accent-soft/blue-soft/cyan/purple/--status）、.app 三段栅格 + statusbar、topbar（项目切换器/⌘K/Live/语言）、sidebar 三组导航、视图路由、Toast、对话框统一、data-list 规范、i18n（中英）
  verify: 与 mock 逐组件对照截图；键盘可达性与 aria-live 不回退；8 视图可达
- id: P4-g 业务页面
  change: Chief（对话流+阶段条+Live 控制台日志）、Requirements、Tasks 看板、Inbox（交互按钮）、Files、Docs、Agents（模型/角色覆盖）、Settings（口令/模型/凭证）、Projects 切换
  verify: 每页数据来自真实 RPC；空态/无模型/无 Git 项目形态正确；交互按钮走 interaction.respond
- id: P4-h0 渲染库选型试验（先做，先于任何 UI 切片）
  change: 安装候选库并用真实会话夹具量测：半截 fence/表格回退、表格与围栏、ANSI 日志着色、5000 行日志虚拟化；记录各库压缩体积、首帧延迟、是否需打包
  verify: 试验脚本输出体积与渲染计时；据结果锁定库清单（含"自研窗口化"的取舍）并写入本 Plan；试验失败或超预算则改选，不开始 UI
- id: P4-h 流式渲染部件
  change: content-block 渲染器（text/thinking/toolCall/toolResult/usage）、MarkdownStream（半截 fence 暂存、完成重排）、ThinkingBlock 折叠、ToolCard 状态翻转、日志三列着色、长列表虚拟化
  verify: 逐块快照测试 + 半截 fence/表格用例；1000+ 行日志不卡顿；滚动与自动跟随正确
- id: P4-i 浏览器验收
  change: 真实 Chromium 走 AC-01/02/03/05/06/07 与断线/暂停/接续场景（无模型只读、有模型全链路）
  verify: 每场景留证据（截图+网络记录+状态对照），失败记失败，未执行记未执行
```

## 5. 客户端基础架构（已确认：手写区域更新 + store 订阅；`devagent/web/`；Playwright）

**与 mock 的对位**（mock 三段式）：CSS `webui/index.html:9-1269` → `web/styles/*`（选择器与令牌逐行照搬）；DOM `:1270-1746` → `web/index.html`（同骨架、同类名，视图容器由 JS 填充）；script `:1747-2976` → 只借**交互行为与 i18n 键名/中英文案**（`messages` 字典约 120 键），其假数据层整体丢弃。

```text
devagent/web/
  index.html            外壳（topbar / content-shell / workspace / runtime / statusbar + 视图容器 + login）
  styles/               tokens.css（令牌 + --font-scale）、components.css、views.css（含 1120/840/700/520 断点）
  vendor/               固定版本 ESM（markdown-it、高亮、anser、virtual-core；P4-h0 量测后锁定）
  core/
    rpc.js              POST /api/v1/rpc 信封；requestId 首次发送前生成并复用；R6 错误码 → 统一异常
    stream.js           stream.prepare → 快照+boundary → SSE(seq>boundary)；溢出/代次 → resync 重新 prepare
    store.js            实体缓存（project/session/input/task/result/requirement/interaction）+ invalidate 重取；subscribe(entity, cb)
    session-view.js     每会话实时视图状态：消息序列、流式块、pending 交互、activity
    router.js / i18n.js / dom.js
  components/
    shell.js（topbar 项目切换/⌘K/Live/语言、sidebar 三组导航与徽标、statusbar）
    message.js board-card.js data-list.js stage-strip.js tree-line.js log-line.js dialog.js toast.js live-dock.js
    stream/markdown-stream.js（半截 fence/表格暂存 + 完成重排）thinking-block.js tool-card.js bash-block.js
  views/                chief requirements runs inbox files docs agents settings + login
```

**更新规则（无框架的前提）**：区域分三类，各用一种方式——**只追加**（transcript、log；append + 超限窗口化/虚拟化）、**按 invalidate 整体替换**（列表、看板、卡片、状态栏）、**纯本地**（对话框、折叠、滚动跟随、选中；不进 URL）。服务端是唯一真值，**不做乐观改写**；SSE 只提供增量与提示，业务变化一律按实体重读（M4 的 invalidate）。

**从 mock 取 / 换 / 删**：取——选择器与令牌、DOM 层级与类名、i18n 键名与文案、交互模式（视图切换/语言/Live Dock 折叠/四断点/Toast/dialog 三段）；换——假数据（providers/roleOverrides/runs 数组）→ 真实 RPC，`renderActiveView()` 静态渲染 → 视图 `mount/update`；删（进差距表）——`.runtime` 命令行 prompt 行、看板 priority 等无数据支撑装饰。

**交付与开发环**：`index.html` + ES modules 由同一 Node 服务同源托管（R1 同源要求），无构建步骤；第三方库仅用于 markdown/高亮/ANSI/虚拟化，固定版本放 `vendor/` + import map。

**测试分层**：纯逻辑（rpc 信封、stream 边界与 resync、markdown 暂存状态机、i18n、store 归约）用 vitest 无浏览器运行；渲染与点击用 Playwright + 真实 Chromium（P4-i），截图与网络记录作为证据。服务器侧协议用例（P4-a～e）必须能由非浏览器客户端（fetch 脚本）验证，浏览器只额外证明渲染与交互。

## 6. 明确不做

- 不把 Pi 改成 RPC 子进程（R4）；不暴露任意 Pi 工具名/cwd；不在前端建第二套协议或状态机。
- 不做浅色主题、不引字体文件、不做移动端专项（照 mock 的四个断点）。
- 不做多用户/团队权限；不做发布与定时任务。

## 7. 风险

- 体量：8 视图 + 实时协议 + 交互桥是本轮最大交付；按切片独立审阅，避免一次性大改。
- 字号：mock 用 7–11px 展示密度；DESIGN.md 要求原样保留并用 `--font-scale` 旋钮调节。需在真实浏览器里确认可读性与无障碍（可读性例外必须登记差距表）。
- 差距表要重定：DESIGN.md 的差距表基于上一轮实体（runs/work/attempt），必须按本轮实体（Project/Session/Input/Task/Result/Interaction/Requirement）逐条重写，任何偏离都登记、不现场决定。
- SSE 与交互的并发/溢出/重连语义容易"看起来对"：必须有可复现的溢出与 resync 证据。
