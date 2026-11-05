# Plan：新 UI 层（webapp）· 第一版 = Chief 会话视图 + 子会话（agent）渲染

日期：2026-10-14。状态：待独立审阅。
决策背景：UI 层重写为 React（用户决定"早晚要换 React，重来 UI 层"）；后端内核（src/ 10753 行 + 22 个测试文件 8455 行）原样保留。参考成熟实现 `agegr/pi-web`（7301★，MIT，Pi 1.2.0）与 `versot/pi-web`（MIT）的**纯逻辑**，不搬组件树。

## 1. 目标与非目标

### 目标（本包交付）
1. `devagent/webapp/`：React 19 + TypeScript + Vite 新 UI，第一版**只有 Chief 会话视图**（chat 流 + 提问交互卡 + 运行控制 + 子会话渲染）。
2. 子会话（agent）渲染：Task 卡（成员、角色、阶段、状态）+ 成员会话抽屉（点开跟随该子会话流）。
3. 服务端**唯一改动**：`session.stream.prepare` 快照在有活 Pi 实例时改从内存会话取（`handle.session.sessionManager.getEntries()`），消除"在飞消息从快照消失"的根因；旧壳同受益。
4. 验收：真实模型 + 真实浏览器，用 `/Users/huyaohua/huyh/work/aisuangua` 的真实会话端到端跑通（含一个有 createTaskSessions 子会话的 Task）。

### 非目标
- 其余 7 个视图（requirements/runs/files/docs/inbox/agents/settings）仍在旧壳 `web/`，后续逐视图迁移，不在本包。
- 不改 RPC 信封、错误码、WAL/交互桥语义、恢复语义（`docs/technicalnew/` 契约不动）。
- 不引入除 React/Vite 外的重运行时（无 Redux/router 库；状态用 reducer + Context，路由先用 URL hash 一个视图）。

## 2. 事实（调查证据）

### 2a. 服务端能力已具备（本包只补快照一处）
- **子会话流可跟随**：hub 按会话广播，actor = 登录会话；`session.stream.prepare`/`session.messages.list` 只校验会话属于项目（`stream-methods.ts:36`、`read-methods.ts:129`）。实测浏览器登录态可 prepare 任意本项目会话。
- **成员与任务数据**：`task.get` 返回 `members[]{sessionId,roleId,phase,label,expectedKind,currentInputId}` + `results[]`（`read-methods.ts:238-262`）；成员会话 `task_sessions.currentInputId`（`store.ts:449`）；成员输入 `kind='delegation'`（`store.ts:2250`）。
- **成员状态枚举**：`MemberState = queued|working|waiting_user|stopping|completed|failed|stopped|interrupted`（`delegation-tools.ts:14-21`），由 `settleStep` 每 25ms 轮询 DB 得出（`runner.ts:584-613`）——**没有**对 chief 流的 task/成员失效通知（全仓 `invalidate('task')` 仅 write-methods.ts:155 一处，用户手动控制时才发）。
- **子会话提问已带 taskId**（`interactions.ts:71-83`），按契约"经主管通道呈现、保留专业来源"（`messaging-and-collaboration.md:169`：外层含 `chiefSessionId`、`sourceSessionId`）。
- **契约边界**："普通页面订阅主管通道即可获得自己的原生消息、Task 失效通知和已保存交互；**不自动订阅全部子 Session**。用户主动查看专业历史可单独读取"（`messaging-and-collaboration.md:121`）——抽屉按需订阅即符合契约。
- **产品要求**（`delivery.md` D-06）：任务详情至少显示目标、总体 Plan、当前阶段、**参与 Session 与角色**、已提交结果、待处理事项——本包的 Task 卡承接"参与 Session 与角色 + 状态"。
- **快照缺陷**（已实测复现）：快照读 `readPiHistory(binding.piFile)`（`stream-methods.ts:47`），在飞消息未落盘 → resync 整段替换后该消息从视图中**永久消失**直到刷新。活实例可取内存条目：`handle.session.sessionManager` 公开（`agent-session.d.ts:210`），`getEntries()/getBranch()` 存在（`session-manager.d.ts:178,334`）。

### 2b. 移植件（MIT，逐文件登记于 `webapp/src/ported/PORTED.md`）
| 目标 | 来源 | 体量 |
|---|---|---|
| 视口窗口 + 懒加载 + 滚动锚定 | `agegr/pi-web` `lib/chat-lazy-load.ts`、`lib/chat-scroll-position.ts` | ~2.2KB |
| 流式 markdown 安全块（未闭合 fence 增长渲染、稳定前缀） | 已有 `web-markdown-stream`（保留测试）+ agegr `markdown-blocks.ts` 思路 | 复用+补 |
| 高亮预算队列（首帧 2000 字符预算，其余 idle 分片、最新优先） | agegr `lib/highlight-queue.ts` | ~2KB |
| 会话 slot 状态机（每会话独立、切会话不清空） | versot `packages/ui-hooks` `session-store.ts` 的 **reducer 模式**（自写，非逐行拷贝） | 自写 |
| 自动滚动锁定语义（上滚锁定/解锁阈值/程序滚动标记） | versot `use-autoscroll.ts` 语义，vanilla 实现 | 自写 |

## 3. 设计决策

1. **双壳并存，路由无冲突**：同源服务器按路径分流——`/` 仍由旧壳 `web/` 提供；新壳挂 `/app/`（构建产物静态目录），dev 时 Vite 代理 RPC/SSE 到 4173。旧壳"Chief"导航暂指 `/app/`（后续包再决定替换点）。
2. **状态 = 每会话 slot reducer**：`SessionSlot{ items, busy, pending, members, historyHasMore, historyStartIndex }`；chief 流与每个打开的成员抽屉各一个 slot；**快照/重同步不改写 slot 的在飞尾巴**——快照条目与直播条目按 `entryId` 合并，直播流中未完成条目保留，不因 resync 丢失。
3. **子会话渲染三档**（对齐 D-06 与订阅契约）：
   - **内联 Task 卡**：chief 流中出现 `createTaskSessions` 工具调用时，渲染成员表（角色、label、阶段、状态徽标、结果数），状态从 `task.get` 拉取； chief 流收到聚合回执（工具结果）时刷新。
   - **成员状态实时性（本包内）**：轮询 `task.get`（3s，仅当卡可见），不新增服务端通知——补服务端 task→chief 失效通知是后续包（登记为缺口，不在本包伪造实时性）。
   - **成员会话抽屉**：点成员行打开右侧抽屉，`session.messages.list` 取该子会话历史 + `session.stream.prepare` 跟随直播（同一 slot reducer 复用）；只读（无输入框），关闭即取消订阅。
4. **交互卡**：pending interaction 渲染 confirm/select/input 三形态；子会话来源的卡带 `sourceSessionId` 徽标（"developer 正在询问"），答复仍走 `interaction.respond`（WAL 语义不变）。
5. **在飞消息修复（服务端）**：`stream-methods.ts` 快照 messages 改为：有活实例（registry.get）→ `handle.session.sessionManager.getEntries()` 投影为 HistoryRecord 形状；无实例 → 现行 `readPiHistory`。两者输出同一形状（role/content/toolCallId/toolName/isError/inputId），投影逻辑放 `src/server/history.ts` 旁新增纯函数并单测。
6. **i18n**：沿用 `web/i18n.json` 键位风格，新键加在 `webapp/src/i18n.json`，中英双语。
7. **样式**：以 `web/styles/tokens.css` 令牌为基（设计语言延续 mock），组件样式用 CSS Modules；不引 Tailwind。

## 4. 改动面

### 服务端（一处 + 测试）
- `src/server/stream-methods.ts`：快照 messages 来源切换（见决策 5）；`src/server/history.ts` 增 `entriesToHistoryRecords(entries, inputMarker)` 投影函数；`test/server-stream.test.ts` 增"有活实例时快照包含在飞条目"用例（真实 Pi 实例 + 中途断言）。

### 前端新目录 `devagent/webapp/`
```
webapp/
  package.json          react/react-dom；vite；"build"产出到 ../web-static/app/（服务端按 /app 静态托管，另加一行 main.ts 路由）
  vite.config.ts        proxy /api → 4173；build.outDir
  src/
    main.tsx / App.tsx  hash 路由：#/chief
    api/rpc.ts          信封/CSRF/newRequestId（移植 web/core/rpc.js 语义，TS 重写）
    api/stream.ts       prepare→SSE→帧解析（含 resync 事件→重 prepare；不自动补洞）
    state/slot.ts       SessionSlot reducer（合并快照与直播；entryId 去重；在飞保留）
    state/project.ts    登录/项目/会话选择（localStorage 键沿用 agentdev.*）
    lib/scroll.ts       autoscroll 锁定语义 + 跳底按钮状态（移植语义）
    lib/lazy-history.ts 视口窗口 + 向上翻页
    lib/highlight-queue.ts  高亮预算队列（移植 agegr，MIT）
    components/
      Transcript.tsx    消息流（user/assistant/thinking/tool/system）
      Markdown.tsx      markdown-it + 预算高亮（复用 vendor/markdown-it、highlight.js core+10 语言注册）
      ToolCard.tsx      参数默认折叠、状态翻转、diff 展示（edit/write）
      InteractionCard.tsx  confirm/select/input + 来源徽标
      TaskCard.tsx      成员表 + 轮询刷新 + 打开抽屉
      MemberDrawer.tsx  子会话跟随（只读，独立 slot）
      Composer.tsx      发送 + STOP + blocked 展示
    ported/PORTED.md    移植来源/版本/许可登记
  test/                 vitest：slot 合并、scroll、lazy-history、markdown 块；Playwright： chief v1 e2e
```
- `src/server/main.ts`：+2 行静态托管 `/app`（仅当 `../web-static/app` 存在）。

## 5. 切片（每片独立可验证；按序）

```yaml
- id: W-a 服务端快照取活会话
  改: history.ts 投影 + stream-methods.ts 切换 + server-stream.test.ts 用例
  验: 单测（真实 Pi 实例中途断言快照含在飞条目）；旧壳回归 22 文件全绿
- id: W-b webapp 脚手架 + RPC/SSE 适配
  改: webapp/ 脚手架、rpc.ts、stream.ts、main.ts 静态托管 2 行
  验: 浏览器打开 /app/ 能登录、能看到 chief 历史（复用现有实例与 stub/真模型）
- id: W-c Transcript v1（消息/流式/思考块/工具卡/Markdown+高亮）
  改: Transcript/Markdown/ToolCard + slot reducer + scroll/lazy
  验: 真实模型多轮（含工具调用与长 markdown）；resync 中途不断流（替代旧壳失败场景）
- id: W-d 交互卡 + Composer（发送/STOP/blocked）
  改: InteractionCard/Composer
  验: question confirm/select/input 三形态往返（复用 P6 的真实模型场景）
- id: W-e TaskCard + MemberDrawer（子会话渲染）
  改: TaskCard/MemberDrawer + task.get 轮询（3s 仅当可见）
  验: 真实 createTaskSessions Task：成员状态推进可见、抽屉能跟随子会话流、chief 流聚合回执后卡片刷新
- id: W-e2 浏览器验收 + 结算
  改: Playwright 场景；结算/复核
  验: aisuangua 会话端到端（含一个带子会话的 Task）；"运行中代次变化"场景（旧壳丢消息处新壳不丢）
```

## 6. 验收标准（本包完成条件）

1. W-a~W-e 每片可观察验证通过并留证据于本目录。
2. 真实模型 + Chromium：aisuangua 项目新建 chief 会话，完成一次带子会话（createTaskSessions）的 read 或 write Task：成员卡片状态 queued→working→completed 推进可见；抽屉能打开并跟随成员流；chief 聚合回执后卡片含结果数。
3. 运行中刷新/重连：刷新后历史完整；运行中触发 resync（config.save 重载运行时）时，正在流式的消息**不消失**（对照旧壳的实测丢失）。
4. `npm test`（含新增用例）与 `npx playwright test`（新场景）全绿；旧壳 8 场景不回归（保留的 playwright 用例不动）。
5. PORTED.md 登记每个移植文件的来源 commit、许可证；`web/i18n.json` 不删除旧键。

## 7. 风险与缺口（如实登记）

- **成员状态实时性靠轮询**（3s）：不伪造实时。服务端 task→chief 流的失效通知是真实缺口，登记为后续包；不影响本包"卡片可见、状态正确"。
- 子会话抽屉开启期间与 chief 流并存两条 SSE：连接数 2，hub 支持多订阅（广播不竞争消费，`messaging-and-collaboration.md:121`），无冲突。
- React 引入构建步骤：违反 P4 §3"无构建"确认形态——本包即为该决策的修订，需独立审阅确认（P4 例外条款原文允许"一条 esbuild 命令"级例外，Vite 构建属同一性质，本包 Plan 明示修订理由：chat 流效果需求 + 成熟实现均为 React 生态）。
- 旧壳 `/` 首页仍指向旧 Chief 视图：切换点不在本包，避免旧证据失效范围扩大。
