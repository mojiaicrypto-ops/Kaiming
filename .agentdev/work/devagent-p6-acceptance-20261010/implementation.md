# Implementation · devagent-p6-acceptance-20261010

本轮是产品验收（P6），但仍按交付契约修掉了验收中发现的真实缺陷。以下每条都对应一次真实运行观察，不给推断。

## 1. 交付材料

- 新增 `devagent/README.md`：运行环境、启动命令与环境变量表（`AGENTDEV_ACCESS_PASSWORD` 必填，`DATA_DIR/PORT/HOST/MODEL_PROVIDER/MODEL_ID` 可选）、模型凭证放置（数据目录下 `models.json`/`auth.json`，服务端不读 `config/model.json`）、数据目录内容（`state.db`、`sessions/*.jsonl`、凭证）、备份与恢复步骤、常用命令。
- **实跑验证**：按 README 备份 → 删空数据目录 → 解包恢复 → 用同一 `AGENTDEV_DATA_DIR` 重启。恢复后 `state.db` 与原文件 md5 相同（`ecdfd3e9c8d9e17fdc9d51ab566f465a`），行数一致（projects 1 / sessions 2 / inputs 5 / interactions 3）；浏览器里项目 A、两段主管会话、`REQ-PASSWORD-RESET-001`、入口存在性（`AGENTS.md` present，`.dev/INDEX.md`/`.dev/PROJECT.md` missing）全部照旧。

## 2. 验收中修掉的缺陷

### D1 交付界面里仍有 mock 演示文案与未解析键
- 现象：顶栏胶囊显示 `LOCAL DEMO`；会话切换器选项文案是 `REQ-018 · Pi Runtime foundation`；`#kuai` 调色板提示写 `Try “REQ-018”, “RUN-104”…`；Files 计数后缀 `sample files · 24 indexed`、徽标 `Mock · Read only`；`aria.requirementProgress` 写死 `62%`；`focus.phase` 写死 `5 / 8 tasks`；`toast.consoleMobileHidden` 提到 "mock Run state"。
- 另有两类：Inbox 视图渲染出原始键（`inbox.questions`/`inbox.recovery`/`inbox.blocked` 在字典里不存在）；`data-i18n-placeholder` 属性从未被 i18n 应用，输入框一直显示 HTML 里的旧文案。
- 修复：改真实文案（`header.live`、`focus.*`、`files.*`、`palette.note`、`aria.requirementProgress`、`view.inbox.*`、`view.settings.subtitle` 等）；补 `inbox.*` 段标题与 `inbox.resolution.*` 选项文案；`I18n.apply` 处理 `data-i18n-placeholder`；删除“代码里已无任何渲染路径”的键（mock 的 board/card/audit/decision/run/requirement 演示流）；后经复核实测为 399 → 251 键（删 177、增 29），见 §2b。
- 死键清理过程中的一次真实失误：首版扫描只认 `t('key')`，漏掉“把键当参数传给 helper”（`section('inbox.questions', …)`、`t(cond ? 'a' : 'b')`、`HEADERS` 数组里的键），误删 11 个仍在用的键（`run.pause`/`run.resume`/`runs.column.*`/`section.files*`/`toast.live*`/`aria.runConsoleCollapsed`）。已用“旧字典 × 现网字面量”比对找回，并把扫描改成保守版。
- 新增 `test/web-i18n-keys.test.ts`（19 个测试文件的第 19 个）：代码/标记命名到的键必须两种语言都存在；两语言键集对称且非空；动态前缀（`status.${state}`、`agents.role.${id}`、`inbox.resolution.${v}`）至少有一条命中；没有被渲染路径的键必须为 0。

### D2 外壳有大块静态 mock 铬件，从不反映真实状态
- 现象：`#liveLabel` 恒为 `Local demo`；`#conversationSelect` 恒为两个写死选项；`#focusCard`（ACTIVE REQUIREMENT / 进度条 / phase / decision）从不更新；`#sectionEyebrow/Title/Subtitle` 切视图不跟着变。`web/components/shell.js` 里没有任何代码碰这些元素。
- 修复：shell 新增 `paintLive()`（连接态→`header.live`/`status.connecting`/`status.reconnecting`）、`paintHeader()`（八个视图各自的 eyebrow/title/subtitle，随 router 变化，由 `app.js` 的 onChange 触发 `shell.update()`）、`paintConversations()`（按 `store.sessions` 的真实会话列表生成选项，值为真实 sessionId，切换即 `openSession`）、`paintFocus()`（取唯一未结束的 Task：标题=task.goal、phase=服务端阶段名、`n/8`=阶段序号、decision=blockReason 或 nextStep；无 Task 时整卡隐藏）。`app.js` 新增 `openSession` 上下文钩子，`createSession` 后重新读取会话列表。

### D3 控制台上的按钮是死的
- 现象：`#pauseRun`/`#stopRun`/`#errorFilter` 三个按钮无任何处理函数（`grep` 全 web 无引用），点 STOP 什么也不会发生。
- 修复：`STOP` → `session.input.stop`（先用 `session.stream.prepare` 从服务端快照里找出真正在处理/排队的输入，再按 inputId 请求停止，失败或无可停工作时如实提示）；`ERRORS` → 真实过滤（只显示 `.log-line.is-error`，`aria-pressed` 与条数提示，日志组件新增 `isError` 标记）；删除 `PAUSE`（Task 级暂停/取消属于 Runs 视图上的 Task 控件，会话控制台上再放一个是误导）。

### D4 重启后卡在 `processing` 的输入永远不会被判定
- 现象：服务重启后 `session.recovery.inspect` 返回 `pendingInputs:[{status:'processing'}]`、`interruptedInputs:[]`；该会话此后无法再认领任何输入（一会话一运行），Inbox 也没有任何可处理项。
- 根因：`startWorkbench` 用 `new Store({ serverEpoch: 1 })` 写死代次；`scanStartup()` 只把“代次不同”的 `processing` 判为 `interrupted`，而 `main.ts` 从不调用它。
- 修复：每个进程一个代次（`Date.now() % 2**31-1`，可用 `serverEpoch` 覆盖），启动时调用 `scanStartup()` 并在有中断输入时打印一条说明。SSE epoch 也随之每次重启都变（客户端会正确 resync，而不是信任旧代次的流）。

### D5 被抛弃的提问一直显示为待答复
- 现象：进程死掉、提问的调用方已不存在，Inbox 仍把该 `confirm` 显示为 `pending`。
- 修复：`scanStartup()` 同时把“仍处于 interrupted 的外来代次输入”的 pending 交互置为 `stale`（幂等，可修复早先启动遗留的悬挂状态）；补 `test/store.test.ts` 用例。重启后该提问消失，模型在下一轮按需重新发问（不伪造旧 Promise）。

### D6 交互答复不能作为授权依据 → 整条“保存/启动”链路在真实模型下走不通
- 现象（真实模型，浏览器）：用户点 `Confirm` 后，模型报告「保存工具回报『该 interaction 的决定还不可用』」，只能再问一次；requirement 一直没落盘。
- 根因：`src/runtime/authorization.ts` 对 `{interactionId}` 一律 `return { ok:false, message:'interaction decisions are not available yet' }`（P4 之前的占位），而 P4 已经交付了交互 WAL。
- 修复：`{interactionId}` 现在校验“本项目 + `state==='resolved'` + 答复本身是一条正向决定”（`confirm` 必须 `true`/`{confirmed:true}`；`select`/`input` 必须带用户自己的值；`cancelled`/`false`/空值一律拒绝，`interaction:<id>` 记入 refs）。补 `test/requirement.test.ts` 三组用例（浏览器确认可保存、拒绝否定/待答复/跨项目/不存在、选项与文本答复可用且原有 `{inputId}` 仍可用）。
- 验证：修复后在真实模型 + 真实浏览器里，主管以 `authorizationRef:{interactionId:'q-6ec6f280'}` 调 `requirement` 成功，工具返回 `Requirement REQ-PASSWORD-RESET-001 (proposal, pending) saved`；文件落在项目 A 的 `.dev/requirements/REQ-PASSWORD-RESET-001.md`（front matter 合规、8 条未知项如实保留）。

### D7 没有模型时提交输入完全静默
- 现象：无模型实例里提交消息后，输入停在 `queued`，对话区没有用户消息、没有助手回复、界面不说明原因。
- 修复：worker 的 `onOutcome` 在 `blocked_config`/`blocked_role`/`blocked_project` 时把原因发布到该会话的流；客户端把它显示为错误 toast（并自然进入 Live 控制台）。验证：无模型实例提交后出现 `MODEL_UNAVAILABLE: unset/unset has no usable credential`，助手消息数为 0。

## 2b. 独立审阅后追加的修复（第二轮）

首轮独立复核（`review.md`）指出 1 项阻断 + 若干过度声明，逐条处理：

- **阻断：AC-01 的 B/N 分支当时并未执行**（记录却写成通过）。已在真实浏览器补做：B → `p-617c79822375` 独立项目/路径/会话，N → `p-3508b410d2a6` 同样独立，同实例三项目互不串内容；`test.md` 按此重写。
- **D7 的残留缺陷（复核发现）**：worker 每个空闲轮询都重发被阻塞事件 → 约 4 帧/秒、toast 反复触发、控制台无界增长。修复：`main.ts` 记住每个会话最后一次阻塞签名，只在变化时发布（14 秒约 50 次轮询内实测 `blocked` 帧 = 1、toast 1 条、控制台 1 行）。
- **外壳残留（复核发现）**：`run.topLive` 写死 `Live · 1`、`aria.liveDockOpen` 写死“1 running”，而相邻胶囊显示真实连接态；阶段条把阶段 id（`clarify/analyze/…`）直接印出。修复：`run.topLive` 改为无数字的 `Live`、aria 文案去掉假数量、阶段条改用 `t('phase.<id>')`。
- **字典契约用例可被绕过（复核发现）**：原“键解析”断言只查 `t('key')`，而 `section('inbox.questions', …)` 这类“把键当参数”的写法只落在字面量集合里，删掉这些键仍会绿。修复：解析断言改为覆盖“落在字典自有命名空间里的字面量”，并显式列出四个 RPC 方法名（`auth.login`/`auth.logout`/`requirement.get`/`requirement.list`；其中 `auth.login` 同时是真实文案键）作为唯一的白名单——新的命名冲突会立刻被测试要求做出决定。变异验证：删掉 `inbox.questions` 后该断言失败。
- **记录数字纠正**：字典 399 → 251（删 177、增 29，不是“删 147”）；测试数 209/209（不是 208/208）。“53 条”原为渲染消息数而非记录总数，已在 `test.md` 中改为按记录数（102）与消息数（19/21）分别写明。

## 3. 记录但本轮未修的观察

- **记录 createdAt 由调用方提供**：新建需求记录保留主管传入的 `createdAt`（`requirement-tools.ts`），本轮保存的文件因此写着更早的时间（真实落盘时间是后来）。属工具设计选择，但模型可以借此写错日期。
- **只读 Task 的工具集与 Plan 承诺不一致**：主管在只读调查 Plan 里写「允许只读运行 `node --test`」，但 `tool-sets.ts` 对 read Task 收掉了 bash，investigator 只能如实报告「无执行能力，not_run」。模型没有伪造输出（好），但产品侧应明确“只读 Task 不能取命令证据”，或在只读白名单里给出受限执行。
- **首次渲染异常（未复现）**：某次“刚通过对话框打开项目后立即提交”的运行里，服务端已完成该输入（`session.messages.list` 有 17 条），浏览器 `sessionView.messages` 却为 0，且控制台有事件日志；手动 `applySnapshot` 立即恢复，之后两次同类复现均正常。当时页面刚在编辑 `web/` 文件后被 reload，怀疑是模块图与磁盘不一致；未定位，按未复现记录。
- **无浏览器入口的服务端方法**：`project.rebind`、`session.cleanup` 只有服务端（`session.input.stop` 已由 D3 接上控制台）；`webui/index.html` 里没有它们的入口。
- **知识入口未建立**：`.dev/INDEX.md`、`.dev/PROJECT.md` 仍不存在（`project.get` 如实报 missing）。按设计它们由主管在用户同意后写入，本轮没有走到那一步。
- **会话交接**未实现（无 handover 方法）；主管提示词引用的 `task.reconcile` 在代码里不存在。
