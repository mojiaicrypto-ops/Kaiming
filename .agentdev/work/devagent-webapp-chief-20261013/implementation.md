# Implementation：webapp chief 会话视图（v1 进行中）

日期：2026-10-14。Plan 见同目录 plan.md；本记录只写已发生的事实。

## 已落地（commits 1d9b72e、6199228）

### W-a 前置：/app 静态面（属 W-b 但先行）
- `src/server/http.ts`：`appStaticDir` 选项；`/app`、`/app/`、`/app/*` 路由（SPA 回退 index.html）；
  `/app/../state.db` → 404（越界守卫保持）；未构建时明确报 "the /app surface is not built"。
- `src/server/main.ts`：`web-static/app/index.html` 存在才挂载；`web-static/` 已入 `.gitignore`。
- 隔离验证（node 直连 createWorkbenchServer）：`/app/`、`/app`、`/app/index.html` 全部 200 且含 React 资产；越界 404。
- 回归：`npm test` 22 文件 228/228 全绿（两次验证：路由后、修复后）。

### W-b 脚手架 + RPC/SSE 适配
- `webapp/`：React 19.2 + Vite 7 + TS 5.9；`npm run build` 产出到 `web-static/app/`；dev 代理 /api → 4173。
- `src/api/rpc.ts`：信封/CSRF/newRequestId（R1 语义 TS 化）；`src/api/stream.ts`：prepare→SSE→帧（resync→重 prepare，绝不补洞）。
- 登录/项目/会话选择；浏览器实测：登录 → 打开 aisuangua → 历史渲染 26 个 message 节点。

### W-c Transcript v1（部分）
- `state/slot.ts`：每会话 slot reducer；快照按 entryId 合并、**直播尾巴不被快照降级/丢弃**；
  toolCall arguments 归一化（Pi 历史是对象、直播是字符串）；合并顺序=快照权威+live-only 尾巴。
- `components/Transcript.tsx`：user/assistant/thinking/tool 卡；toolResult 翻转匹配卡（callId）。
- `components/Markdown.tsx`：markdown-it + **10 语言注册（模块级）** + agegr 预算队列（移植，MIT 登记于 ported/PORTED.md）。
- `lib/scroll.ts`：autoscroll 锁定语义（上滚锁定/回底解锁/程序滚动标记/跳底）。
- `test/slot.test.ts`：3 项回归（归一化/在飞不丢/孤儿 message_end 保留）。

## 实测发现并当场修复（真实模型 + Chromium，aisuangua 会话）
| 发现 | 根因 | 修复 | 证据 |
|---|---|---|---|
| 登录后永远停在登录页 | cookie HttpOnly，`document.cookie` 判断永假 | `config.get` 探测 + 登录后重开 stored 项目 | 页面进入 topbar/composer |
| 真实历史渲染崩溃 `r.slice is not a function` | 快照 toolCall.arguments 是对象 | slot 归一化 | 26 节点渲染；单测 1 |
| 刷新后尾部消息顺序错乱 | 合并按首次出现排序，快照晚到插到 live 之后 | 快照权威 + live-only 追加 | DOM 尾部 3 条顺序正确；单测 3 |
| json 代码块 0 高亮 + `Unknown language: ""` | 语言注册只在 markdown-it 回调内；空语言直传 hljs | 模块级注册 + 空语言守卫 | json fence 103 个 token span；`window.__errs` 清空 |

## 流式实测（真实模型）
- 提交 markdown 请求：消息节点 27→29，hljs token **流中从 0 → 14 → 40** 增长（预算队列工作），消息未丢（对照旧壳 resync 丢失场景）。
- 刷新后历史完整（55 条服务端消息中可见 28 个渲染节点：system 隐藏、toolResult 折叠进卡）。

### W-a 服务端快照取活会话（完成）
- `src/server/live-snapshot.ts`：`sessionManager.getEntries()` → HistoryRecord 投影（marker 关联 inputId 与文件读一致；非 message 条目不进对话）。
- `stream-methods.ts`：`currentHistory` 选项（registry 活实例优先，空闲回退 readPiHistory）；`pageHistory` 收窄为 `{records}`。
- 测试：`live-snapshot.test.ts` 3 项投影回归；`server-stream.test.ts` harness 注入 currentHistory（活源优先/文件回退），套件 **233/233**。
- commit 6c715cd。

### W-b/W-c 实机回归修复（commits 123463a、1c4076f）
- 重启后登录流不重订阅：hook 增加 enabled 门（authed===true 才开流）。
- Task 卡改由 chief 流的 `{type:'invalidate', entity:'task', id}` 通知驱动 activeTaskId + 可见时 3s 轮询 `task.get`；成员行 idle/active 取 `task_sessions.currentInputId`（等待集合自身事实）。
- 端到端实测（真实模型，新壳）：发送→流式完成→节点 29→30 稳定不丢→刷新后 30 条齐全（含"第六个问题"）。

## 未完成（下一工作片）
- W-c 剩余：`TaskCard`/`MemberDrawer` 已有实现但未接真实 Task 流（需要一次真实 createTaskSessions 运行）；
  成员状态轮询接的是 `session.get` 占位（`TaskCard.tsx` 内 fetch 待改为 rpc + `task.get` members.currentInputId 状态映射）。
- W-e2 浏览器验收场景化（含"运行中代次变化"对照用例）与结算。


### 交互卡两处断点（2026-10-15，commit 765627e）
用户报告"选择弹框有、交互没反应"。实机驱动真实 select 问题定位：
1. `interaction.respond` 缺 `projectId`（服务端 requireProject）→ 每次答复 409 'projectId is required'，卡片永远挂着。
2. 新建的交互从不出现/消失不通畅：slot 只在快照时替换 pending；interaction invalidate 仅处理了"已答复"分支。现在任意 interaction invalidate 都会经 prepare 重读权威 pending 列表（旧壳 refreshInteractions 路径）并 dispatch `pendingReplaced`。
端到端验证：select 问题 → 点 B → 卡片离开 pending 区域、模型回"已收到你的选择：B"；套件 235/235 + webapp 6/6。
遗留设计缺口（登记）：连续多次选择（多轮 question）目前靠"每张卡独立 + pendingReplaced 全量刷新"支撑，视觉上无"第 N 问/进度"概念；若产品要求更强的多轮选择流（如向导式分步），需另行设计。


### 产品完整性专项（2026-10-16，commit 117e023）
用户反馈"半成品"。走查 13 项 UX 断点（scout 审计 agent://WebappUxAudit），high/med 全部闭环：
- 全局 toast（lib/toast.ts）：openProject/session.create/submit/stop 失败可见、成功有确认。
- 会话过期（needLogin）→ 登录视图 + 提示，不再半死。
- 交互卡完整生命周期：busy → 乐观回显（interactionResolved 保留卡片，pendingReplaced 收走）→ STALE"已被处理" → 网络失败行内重试；多问编号、input autoFocus、空输入防护。
- 断流横幅（重连中/连接中 + 手动重试）；空态（未开项目引导 / 新会话欢迎）；composer IME 保护、失败恢复草稿、busy 占位、STOP 仅运行中显示；回到最新浮动按钮；TaskCard 骨架 + 刷新失败标记；抽屉加载态 + ESC；focus-visible。

实机验收（真实模型，ux-accept tab）：错误口令提示 ✓、两连问（select→confirm）编号与排队 ✓、答"红"→确认→总结 ✓、越权答复后 STALE 路径 ✓（out-of-band respond rev2 后 UI 卡片收走）、空提交不发 ✓、Shift+Enter 换行不发 ✓、坏路径 toast ✓、回到底部按钮出现→点击回尾 ✓、套件 235/235 + webapp 6/6。
遗留：抽屉 ESC 未实测（该会话无成员，逻辑已实现）；错误口令后 csrf 未刷新的边缘（登录成功路径覆盖）。


### 转录双渲染（2026-10-16，commit 133bfe1）
用户报告"聊天内容和思考渲染两次，第二次是一半文字"。根因（实机复现 + 归约确认）：
- `signatureOf` 只读第一个 content block 的 text/arguments；助手消息普遍以 thinking 块开头 → 所有思考消息签名都是 `assistant::`。
- 后果一：resync 时 live-only 完成条目与快照真实条目永远不匹配 → 双气泡（live 那份是流中途拼接的部分内容 = "一半的文字"）。
- 后果二：不同思考消息互相碰撞（误去重风险）。
修复：签名覆盖全部块类型（text/thinking/toolCall id+args）；新增 `matchesTwin` 前缀匹配——流中途加入的 live 副本内容 ≤ 文件权威版本，相等或为前缀即视为陈旧孪生丢弃。
回归测试 ×3（精确孪生、半文孪生、不同思考消息不误删）；235/235 + 9/9；实机 41 条历史 0 相邻重复、修复后完整一轮直播无重复。


### 归一化收敛（2026-10-16，commit 08627c9）
按用户要求"最佳方案收敛"。落地：
- `state/normalize.ts` 成为唯一知道 Pi 三通道形状（历史文件/事件对象/delta 字符串）的地方；snapshot、message_start、message_end 全部经 `normalizePiMessage` 过边界；渲染与去重只面对归一化后的块。
- 归一化过程中暴露并修复一个服务端缺陷：`session.stream.prepare` 快照取历史**前** 100 条（pageHistory 无 cursor），会话超过 100 条后快照静默丢最新轮次——重连后尾部陈旧。改为 `tailHistory` 取**末** 100 条。
- 测试：normalize 逐通道 ×3 + 快照通道回归 + 前轮孪生去重集；服务端 235/235、webapp 13/13；实机 70 条历史 0 相邻重复、count-60 轮在流中重连后恰好一次完整出现。


### 流式渲染"中间断掉"（2026-10-16，commit 3fdc027）
用户报告：md/流程图等长内容流式渲染中间会断，刷新后正常。实机复现与根因：
- 长回复期间 resync（溢出/代次/重进会话）重读历史时运行已完成 → 快照含完整条目；
- 而该轮的 message_end 帧在 resync 中丢失，live 条目永远停在 streaming 状态；
- mergeMessages 的孪生去重只对**非 streaming** 条目生效 → 完整版下面挂着一个半内容幽灵节点（"第二次一半的文字"），且该节点高亮预算耗尽后看起来"渲染断掉"。
- 刷新后无 live 键 → 只剩完整版 → "正常"。与之前双渲染同根，只是发生在 streaming 状态下。
修复：matchesTwin 同样作用于 streaming live 条目——快照（运行完成后读取）里有相等或前缀副本即文件版胜出，丢弃 live 键；真正在飞、文件里还没有内容的条目仍保留。
回归测试 ×2（thinking→text 真实 delta 顺序的 streaming 孪生丢弃；无孪生的在飞条目保留）；235/235 + 15/15；实机 mermaid+TS 长回复流中重载 → 恰好一次完整出现、0 幽灵节点。


### 流式中断真根因：SSE 帧冗余 + 背压计数错误（2026-10-18，commit 49aee33）
用户持续报告"输出一半，刷新后完整"，且无需刷新也会断。线上抓包定位到两层服务端缺陷：
1. Pi 的 message_update 每个增量都**重发两份完整累积消息**（event.message + assistantMessageEvent.partial）。思考重的回合帧涨到 ~3KB，几十秒就 ~500KB，越过服务端 512KB pendingCap → 流被 mid-turn 关闭 → 客户端收不到 message_end/agent_end → live 节点冻结在部分内容（"输出一半"）。此前所有客户端修复都只是在给这个服务端问题兜底。
2. pendingCap 统计的是**累计写入字节**而非未冲刷字节，健康的长时间读者必然被误杀（long turn 累计 1MB+）。
修复：http.ts 发布前剥掉 update 帧里的两份冗余（客户端只读 delta/contentIndex，已有代码证实）；pendingBytes 改为仅在 write() 返回 false 时累计、drain 清零。
线上验证：1MB 累计流量 reader 保持打开；message_end/turn_end/agent_end 全部到达；live 节点完整渲染 5.6KB markdown，与服务端文件逐字一致，无需刷新。服务端 235/235。


### STAGE_NOT_READY 死锁（t-20a6fbfd，2026-10-18，commit bf07e69）
用户报告：Task 卡在 develop，updateTask 换阶段十几次都 STAGE_NOT_READY，reviewer 派不出去，endTask 关不了。
根因：`currentSessionIds` 只有换阶段才会清空，而换阶段又被"currentSessionIds 非空即拒绝"把守——先有鸡还是先有蛋：一旦某步骤有过成员，阶段切换永久不可能。成员 input 实际早已 completed。
修复：store.updateTask 的就绪判定改为**逐成员 input 状态**（queued/processing/stopping/interrupted → STAGE_NOT_READY 并报出具体成员），与 taskCompletionGaps 的契约注释一致；完成步骤保留 task_sessions 行可追溯，成员随换阶段轮换。另加 busy_timeout=5s（此前并发进程一次撞锁就崩整个 workbench，实际崩过一次）。
回归测试 ×2：processing 成员阻止换阶段；completed 成员放行。237/237。
真任务恢复实录：chief 先后驱动 develop→review（rev 9）→settle（rev 10，chief 自己调 updateTask 成功并回执"Task updated: phase=settle revision=10"）；settler 派发与 endTask 收口链验证中。

端到端验证实录（t-20a6fbfd，修复后）：chief 驱动 develop→review→settle→settlement 报告（r-ec30587e，passed）→ 回到 review → reviewer 独立评审（verdict: failed，6 项必须修改）。全链阶段切换不再受阻；endTask 未被调用是评审正确否决（内容有真问题），不是机制卡死。机制闭环验证完成。


### 子会话运行状态前端可见（2026-10-19，commit 7a042e6）
用户报告：子 session 工作时前端像"已经完成"一样，看不到运行状态。三处改动：
1. `task.get` 成员携带实时会话状态（activity/liveInputId/queuedInputs，经 `liveSessionState` 派生，与 session.get 同源）；此前只有委派时的 currentInputId，永远非空 → 成员永远"active"或信息过期。
2. 成员运行终止时（worker onOutcome terminal）向 chief 流发布 task invalidate → Task 卡即时刷新（此前仅 pause/resume/cancel 才发）。
3. Task 卡：working 行绿色脉冲点 +「· 正在运行」、queued 显示排队数、卡头"N 个成员正在运行/N 个排队输入"；重连后经 session.get 恢复 activeTaskId（失效帧可能在订阅前已发过，卡片会缺席整个运行期）。
实机验证：真实 developer 成员运行中，卡片实时显示"1 个成员正在运行"+ working 行脉冲点，与服务端 input 状态一致；idle→working 翻转已验证，working→idle 走同一 invalidate 路径（本次复核运行较长，等它结束时自然验证）。237/237 + 15/15。
遗留：成员"当前工具调用"预览未做（需要成员流订阅或快照尾部，成本高；跟随抽屉已能看到工具流）。


### agent_report 全 kind 被拒（2026-10-19，commit 22f975b）
用户报告：成员 agent_report 用任何 kind 都被拒——invented kind 'development' 被 schema 枚举拒，其他 legal kind 被 expectedKind 匹配拒，成员永久无法交付。
根因：createTaskSessions 的 expectedKind 是自由字符串（schema `{type:'string'}`），chief 编造了 'development'（服务端源码中不存在该词）；而报告侧 kind 必须等于 member.expectedKind 且属于 RESULT_KINDS。两边枚举不一致 → 成员被夹死。
修复：RESULT_KINDS 收敛到 store 单一来源；delegation-tools schema 枚举 + 工具级守卫（报出合法值）、store.createTaskSessions 创建期校验、report-tools 枚举共用。编造的 kind 现在在**创建时**即报"expectedKind must be one of ..."，不再在报告期卡死成员。
数据修复：live 被夹成员 s-9c840bed 的 expectedKind 手术修正为 implementation（旧洞产生的坏数据）。实机验证：continueTaskSession → agent_report(kind=implementation, verdict=passed) 成功落盘（方向底稿 v0.3，提交 6a3666d + c83e2d5）。239/239。

### 成员完成态语义澄清（2026-10-19，commit 584716f）
用户问"完成是不是显示 idle"。语义上 idle 只表示"当前无运行中的输入"，但让已完成成员与失败/中止成员看起来一样，是可读性缺陷。task.get 成员现携带 lastInputStatus（最近一次 delegation/continuation 输入的终态），卡片行显示 done（绿✓）/ failed·interrupted（红）/ stopped / queued (N) / working（脉冲）/ idle（尚无终态输入）。实机：t-20a6fbfd 卡片 9 行 done + 1 行 interrupted（早前重启所致，与库一致）。239/239 + 15/15。

### "chat 流不输出"排查（2026-10-19，无代码变更）
用户报告聊天流不输出。实机排查：probe EventSource 在运行前打开 → 16 帧全生命周期（invalidate/agent_start/turn_start/message_start×2/message_update/message_end×2/turn_end/agent_end/agent_settled）全部到达且流保持 open；UI 路径（composer 提交）端到端渲染成功；会话切换重连恢复历史。结论：流管线健康。症状与 13:52-13:53 两次服务重启窗口吻合——重启时在途运行被打断、用户 tab 的流被 epoch close 后自动 resync（该路径此前已验证），表现为"流停了"。属重启副作用，非代码缺陷。
遗留观察：短回复的 assistant 消息保留 live-* entryId（Pi message_end 无 id 时回退），内容完整、快照合并可去重，仅 key 命名不美观，无行为影响。

### "不能接受我的输入"（2026-10-19，commit a65a417）
用户报告：聊天像卡住，输入不被接受。根因**不是流**：webapp 的 `session.input.submit` 从不发送 `taskId`，而契约（R2）规定"当前 Task 的补充须关联原 taskId；普通新话题排队至原 Task 结束或新开主管会话"。于是会话一旦绑定 active Task，用户每条消息都按"新话题"被**保留**（queued 且永不消费）——s-138f42aad205 上已积压 5 条，UI 完全无提示。
修复：submit 前用 `session.get` 取权威 currentTaskId 并关联（避免 Task 中途创建导致的陈旧值）→ 消息作为当前 Task 的补充立即执行；若服务端仍保留（waitingForTask），UI 显示"排队中"条带（来自快照 seeding，刷新后仍在）+ 说明 toast + **撤回**按钮（store.requestStop 支持 queued，实测 stopped）。
实机验证：卡住的 5 条消息现在全部可见；新提交即时执行（chief 已回复）；撤回一条 → 条带 4 条、服务端该 input 为 stopped。webapp 16/16 + 服务端 239/239。

### 异步容错三项（2026-10-19，commit fb924c2 + 9eb721e）
用户指出：Task 卡了很久、应已结束或异常；异步异常不能变成无限等待，要求补容错。查证三处真实缺陷：
1. **运行无上限**：`await handle.session.prompt(text)` 无界——provider/流停摆时永久挂起，该输入永远 processing，成员永不 settle，步骤/Task/用户队列全部堵死。新增运行看门狗（`run-watchdog.ts`）：无 Pi 活动达 runStallMs（默认 15min）或总时长超 runTotalMs（默认 90min）→ abort 该运行，输入落为 interrupted（RUN_STALLED/RUN_TIMEOUT），交主管核实。可用 AGENTDEV_RUN_STALL_MS/AGENTDEV_RUN_TOTAL_MS 配置；单元测试覆盖两种触发与健康路径（注入时钟）。
2. **无人通知主管**：进程消失留下的 interrupted 成员输入只在 stdout 打印，主管不知道、也没法推进。启动时改为向该 Task 的 chief 排一条 system_notice（按 input 幂等、绑定 taskId 可消费），指示核实后 reconcile。
3. **`task.reconcile` 工具不存在**：恢复契约（agents-and-tools）定义了它、chief 提示词也指示调用，但代码里没有——于是 interrupted 成员输入无路可关，步骤永久 STAGE_NOT_READY。已实现：校验 Task owner/成员归属/证据引用（须为本 Task 结果或 file: 前缀）→ 调用既有恢复服务关闭原输入；并对 chief 放行。
另修：requestStop 的"停稳"不等于"终态行已写"，停止回执改为有界等待行离开 processing（契约本就要求回执反映已定稿行）。
实机：重启后 chief 自动消费通知 → 自行核实（引用 recovery 报告 + review 报告）→ reconcile 关闭 i-bd85892d（记录 resolvedBy=s-138f42aad205:reconcile）→ 该 Task 成员无 busy、阶段门禁解除。244/244。

### 角色分配与子会话提问（2026-10-19，commit 93810db + c71fc37）
**Q1 设计文档派给 developer**：契约明确（delivery.md:13/141、G1 表）设计由 designer 承担、developer 做实现；但**主管提示词全文 0 次提到 designer**，唯一流程示例只有代码流 develop→review→test→settle，且 createTaskSessions 的 roleId 是自由字符串。于是"write Task → updateTask(develop) → developer"成为唯一被强化的路径，设计文档也走 developer。修复：chief 提示词加角色-步骤表 + 设计流程示例（design→review→settle）+ 明确"设计不是开发"；工具枚举 roleId，阶段不匹配时返回该阶段可派角色（designer/developer 提示）。
**Q2 子会话提问到不了人**：三处断链——(a) 桥把失效通知发到成员自己的流（用户只看主管流）；(b) 主管快照按 sessionId 过滤 pending 交互，成员提问根本不在其中；(c) 应答鉴权只认交互自身会话。修复：通知路由到 Task 的 chief；快照改为"自己的 + 本 Task 成员的"（带 sourceSessionId）；应答接受 Task 主管；成员被提问时向委派等待报 waiting_user + interactionIds。
**真正让 chat 卡死的根因**（用户症状"卡在这里"）：主管会话有一条自己被进程重启打断的输入 → claim 以 RECOVERY_REQUIRED 拒绝整个会话，而主管**无法自行关闭**（它跑不起来），于是后续所有输入（含用户消息、恢复通知、委派返回）全部冻结。R4 早就规定"主管自身中断时由宿主核实并直接关闭"。修复：启动时宿主把主管自己的 interrupted 输入按 stopped 关闭（证据 host:process-restart），并投一条 notice 说明"进程已消失、请先核实真实状态"。实测：启动日志 "host closed interrupted chief input c-mvf3w9sr-445-eea81d"，主管恢复消费。
246/246 + 15/15 提示词检查。

### requirement.save 永远不合法（2026-10-19，commit afe4532）
用户报告：requirement.save 连续报 "the record is not valid"，改 id/kind/status/markdown 结构都无效。
**证据（该轮自己的历史）**：模型提交的 markdown **完全没有 YAML front matter**——它写的是一份看似合理的中文文档（`# 需求 · …`，自创 `## 用户能看到的` / `## 不做` 等小节）。严格解析器的第一条规则就拒绝（"the file must start with a YAML front matter"）。根因：`requirement` 工具描述只有一句"save a proposal or implementation requirement"，**格式契约只在设计文档里**（docs/technicalnew/requirements-format.md），运行期模型读不到 → 只能猜，猜不中就反复改无关字段。
修复：
- `requirement-store` 增加 `requirementTemplate(kind,id)` 与 `requirementFormatRules()`，**由解析器同一批常量派生**（不会漂移）；
- 工具描述内嵌完整模板 + 规则（front matter 字段、schemaVersion、id=文件名、各 kind 的 status 取值、UTC RFC3339、implementation 七节顺序、modules 必须存在）；
- 保存失败时返回 issues + 模板 + 规则（并在 message 里点明第一条问题），一次重试即可合规；
- expectedVersion 收到字符串 "null"（模型对可空字段的常见写法）按 null 处理。
测试：描述里的模板就是解析器接受的模板（同源）；被拒保存携带模板。248/248。
