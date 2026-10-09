# Implementation Summary · devagent-p4-webui-20261008

计划见 [plan.md](plan.md)。每切片完成后补记本节。

## 切片 P4-a · RPC 骨架与认证（本次）

```yaml
slice: P4-a 同源 HTTP + POST /api/v1/rpc 信封 + requestId 回执 + 口令换 cookie/CSRF + config.get
changed:
  - path: devagent/src/server/rpc.ts（新增）
    purpose: 信封（requestId/method/params → result 或 error）、方法注册表（write 标记）、R6 错误目录与 StoreError 映射、HTTP 状态映射、参数规范化（仅对象键顺序与去 undefined，不归并自然语言）；回执只由 write 方法认领，键空间为 rpc:<requestId>（读调用带 requestId 只回显、不绑定去重）
  - path: devagent/src/server/auth.ts（新增）
    purpose: 本机访问口令（sha256 + timingSafeEqual）换取同源会话 cookie（HttpOnly/SameSite=Strict/Path=/，可 Secure）；空闲 TTL 12h 滑动；CSRF 令牌绑定会话；logout 立即撤销；凭证不进响应/URL
  - path: devagent/src/server/http.ts（新增）
    purpose: node:http 同源服务：POST /api/v1/rpc（来源校验、cookie 认证、写入 CSRF、1MiB 正文上限、JSON 解析错误）、GET 静态目录（web/；先解码再去前导斜杠，用 resolve+包含检查作承载守卫，越根 404；畸形编码 400）、no-store 与 nosniff；auth.login/logout 处理器（cookie 经 context.setCookie 附加）
  - path: devagent/src/server/methods.ts（新增）
    purpose: 已发布方法的唯一注册点；本切片实现 config.get（脱敏有效配置 + 凭证仅以引用形态说明）
  - path: devagent/src/server/main.ts（新增）
    purpose: 可运行入口：AGENTDEV_ACCESS_PASSWORD（缺失即拒绝启动）、AGENTDEV_DATA_DIR、AGENTDEV_PORT/HOST；启动行只打印地址与数据目录
  - path: devagent/src/store/store.ts
    purpose: 通用请求回执 API beginRequest/commitRequest/getRequestReceipt（与原 acceptInput 共用 request_receipts 表；同 key 不同 method/parameters → REQUEST_CONFLICT；pending 重复 → VERSION_CONFLICT；失败同样如实落回执）
  - path: devagent/test/server.test.ts（新增，10 项）
    purpose: 真实 HTTP（fetch + 临时端口）覆盖登录/撤销/CSRF/幂等/冲突/信封校验/跨源/脱敏配置/静态目录越根
behavior:
  - "实测：npm test 153/153（13 个文件）；typecheck 0；check:prompts 15/15"
  - "启动冒烟（node src/server/main.ts，端口 4181）：未认证 401、登录返回 csrfToken 且 Set-Cookie 为 HttpOnly; SameSite=Strict; Path=/、config.get 返回脱敏配置（无 apiKey/password/token 字样）、promptDir 解析到仓库真实提示词目录"
  - "写调用必须带调用方 requestId（否则 INVALID_ARGUMENT）；带 CSRF 头（否则 FORBIDDEN）；同 id 同参数重放回执不重复执行；同 id 不同参数 REQUEST_CONFLICT；失败回执同样重放"
review_rounds:
  - round: 1
    verdict: passed
    findings: 3 non-blocking
    fixed:
      - finding: "登录（无需会话）也会按调用方 requestId 写回执，可被本地调用方占用 requestId，并把口令的规范化摘要落盘成可离线校验的字典条目"
        fix: "只有 write 方法才认领回执；登录等预认证调用不再写参数摘要"
        evidence: "server.test.ts：带 requestId 的登录在回执表中没有任何行"
      - finding: "回执表出现两个认领者且摘要定义不一致：路由用 {method,params}，acceptInput 用输入字段；P4-c 若用客户端 id 作 store requestKey 会必然冲突"
        fix: "路由器回执使用独立键空间 rpc:<requestId>（store 级回执保留原始键），一个客户端 id 可同时键两处而不产生同键不同摘要"
        evidence: "server.test.ts：写回执在 rpc:w-space 下、原始 id 下没有行"
      - finding: "静态路径 decodeURIComponent 未保护，畸形 % 会 500 且错误码与状态不一致"
        fix: "畸形路径返回 400 INVALID_ARGUMENT；顶层异常改用 statusFor 与错误码保持一致"
        evidence: "server.test.ts：GET /% 返回 400 INVALID_ARGUMENT"
residual_notes:
  - "前缀键空间对客户端 id 单射；但 store 级原始键若恰为 rpc:<X>（acceptInput 保留原始键）会与后续 requestId=<X> 的写请求同键，结果是 REQUEST_CONFLICT（拒绝而非损坏，属可接受的失败安全）"
risks_remaining:
  - "P4-c 的 session.input.submit 必须把客户端原始 id 交给 acceptInput（其自身回执），路由重放在 rpc: 前缀空间完成"
  - "静态目录会跟随符号链接：web 根内的符号链接可指向根外并被送达。main.ts 目前不设置 staticDir（P4-a 未暴露该面）；R1 的 realpath 归属规则由 P4-b 的 project.files 接口落实，静态资产接入（P4-f）时按同一规则处理"
  - "回执 pending 不跨重启对账：beginRequest 留下的 pending 行不会被 scanStartup 恢复，写若中断在 claim 与 commit 之间，重启后重试会得到 VERSION_CONFLICT 'still pending'（保守：不重做可能已生效的写）。P4-a 的处理器全部同步，故不可达；P4-c 的异步写必须在此处接上 S7 的恢复对账"
  - "会话为进程内存态：重启即需重新登录（首版可接受；持久化随 S7 恢复接线）"
  - "config.save/test、项目级角色覆盖尚未实现（P4-b）"
  - "SSE 路由与 stream.prepare 尚未实现（P4-d）；浏览器界面尚未接线（P4-f 起）"
```

## 切片 P4-b · 只读查询面（本次）

```yaml
slice: P4-b project.open/get/rebind、session.create/get/messages.list/input.get、task.list/get、task.report.get、requirement.list/get、project.files.list/read、session.recovery.inspect
changed:
  - path: devagent/src/server/read-methods.ts（新增）
    purpose: R1 只读方法实现：project.open（realpath 为身份，同目录同一项目；缺失目录 PROJECT_UNAVAILABLE；登记不建会话/模型/项目文件）、project.get（入口存在性、会话与 Task 概要、目录缺失如实报告）、project.rebind（需用户决定引用 + 无在飞工作，CAS 后会话 cwd 跟随）、session.create/get（activity 由真实行派生）、session.messages.list（历史+输入关联+分页）、session.input.get（原文/边界/停止原因）、task.list/get（成员与结果）、task.report.get（正文按记录引用读取，不接受任意路径）、requirement.list/get（复用文件读取服务，含 invalidFiles）、project.files.list/read（realpath 归属与符号链接拒绝）、session.recovery.inspect
  - path: devagent/src/server/history.ts（新增）
    purpose: 读 Pi JSONL：session 头、agentdev.input-marker 关联、message 条目；坏行如实计入 problems；分页游标为条目 id（跨追加稳定），未知游标 INVALID_ARGUMENT
  - path: devagent/src/store/store.ts
    purpose: getProjectByRealPath、projectRebindGaps（会话输入与未结束 Task）、rebindProject（CAS realPath 并同步会话 cwd）
  - path: devagent/src/server/rpc.ts
    purpose: HTTP 状态映射补全（HISTORY_UNAVAILABLE/PI_INPUT_UNCONFIRMED/REPORT_*/COMPLETION_INCOMPLETE/TASK_CONTROLLED → 409）
  - path: devagent/src/server/main.ts
    purpose: 入口注册只读方法
  - path: devagent/test/server-read.test.ts（新增，17 项）
    purpose: 真实 HTTP 覆盖全部只读方法：同目录同项目与入口缺口、目录消失、无模型建会话、历史关联/分页/坏行/缺失历史、输入原文与边界、Task 成员与结果、报告正文与 stale、需求与非法文件、文件读取与越界/符号链接、恢复巡检、重绑的决定与阻挡
behavior:
  - "实测：npm test 170/170（14 个文件）；typecheck 0；check:prompts 15/15"
  - "真实启动冒烟（端口 4182）：project.open→registered（入口缺口如实列出）→ session.create 无模型成功（activity=idle）→ task.list 空 → files.list/read 正常（返回 sha256 与 mtime）"
  - "身份与安全：realpath 是项目身份（同目录不重复登记）；文件读取先解析 realpath 再判包含，越出项目或符号链接指向外部一律 FORBIDDEN；报告正文只按记录引用读取"
  - "诚实性：目录缺失、历史文件缺失、报告正文被改动、非法需求文件都如实报告（PROJECT_UNAVAILABLE/HISTORY_UNAVAILABLE/REPORT_STALE/invalidFiles）"
  - "历史身份校验的边界：绑定历史缺失/为空/无 session 头一律 HISTORY_UNAVAILABLE；但换入另一个 Pi 会话的文件（仍有 session 头）目前无法识别——绑定未记录预期 Pi session id，需随 P4-d 的快照/分支信息补上，记录不声称已做完整身份校验"
review_rounds:
  - round: 1
    verdict: failed
    findings: 1 blocking + 5 non-blocking
    fixed:
      - finding: "requirement.get 未校验 id：`../../../projB/...` 之类可越出需求目录并读到任意 .md（跨项目读取）"
        fix: "id 模式校验下沉到 requirementPath/getRequirement（所有调用者受保护），处理器再显式校验一次"
        evidence: "server-read.test.ts：越界 id → INVALID_ARGUMENT 且响应不含外部内容"
      - finding: "task.list 忽略自己返回的 nextCursor，翻页原地重复"
        fix: "识别 cursor 并校验归属（未知游标 INVALID_ARGUMENT），按 id 续页"
        evidence: "server-read.test.ts：limit=1 连续两页返回不同 Task"
      - finding: "绑定历史存在但为空/无 session 头时被当成空对话（R4 要求 HISTORY_UNAVAILABLE）"
        fix: "绑定且有历史时，文件缺失/空/无 session 头一律 HISTORY_UNAVAILABLE"
        evidence: "server-read.test.ts：清空历史文件 → 409 HISTORY_UNAVAILABLE"
      - finding: "project.files.list 用 statSync 跟随符号链接：悬空链接抛错（503），外部链接泄露 size/mtime"
        fix: "改用 lstatSync，符号链接单列为 type=symlink 且不返回 size"
        evidence: "server-read.test.ts：悬空链接不破坏列表，escape.txt 为 symlink 且 size=null"
      - finding: "statusFor 里 TASK_CONTROLLED 被前一个 403 分支遮蔽，记录的 409 映射未生效"
        fix: "从 403 分组移除，TASK_CONTROLLED 归 409"
      - finding: "requirement.list / project.files.list 未知游标静默回到第一页"
        fix: "未知游标 INVALID_ARGUMENT（与 messages.list 一致）"
    overclaim_fixed:
      - "project.open 会持久化项目行，已改为 write:true（需要 requestId 与 CSRF），记录相应更新"
residual_notes:
  - "HTTP 状态映射把 HISTORY_UNAVAILABLE/PI_INPUT_UNCONFIRMED/REPORT_*/COMPLETION_INCOMPLETE/TASK_CONTROLLED 归为 409（记录冲突，保留记录待检查），而非 503"
  - "project.rebind 的"安全交接"仅覆盖输入停稳与 Task 结束；成果引用/需求版本的核对随 P5 结算"
risks_remaining:
  - "session.messages.list 只列 message 条目（压缩/分支条目计为其他，不混入对话）；Pi 分支历史的完整呈现随 P4-d/d 快照处理"
```

## 切片 P4-c1 · 输入接纳与停止（本次）

```yaml
slice: P4-c1 session.input.submit / session.input.stop + worker 唤醒循环 + Task 内输入优先认领（R3）
changed:
  - path: devagent/src/server/write-methods.ts（新增）
    purpose: session.input.submit（只投 chief、content 校验、taskId 必须等于当前 Task、inputId=调用方 requestId 保证重试幂等、返回 queued 与 waitingForTask）与 session.input.stop（保存停止意图后 abort 并等待空闲，未停稳 activity=stopping；已终态幂等返回当前状态）
  - path: devagent/src/server/worker.ts（新增）
    purpose: 唯一把已接纳输入变成真实 Pi 运行的地方：按会话公平轮转、每次由 runner 认领一项；无项可跑（idle/busy/blocked/controlled）则让出并休眠，notify 立即唤醒；stop 优雅退出
  - path: devagent/src/server/rpc.ts / http.ts
    purpose: RpcContext 带调用方 requestId（submit 以它作 inputId/requestKey，stop 以它作停止请求键）
  - path: devagent/src/store/store.ts
    purpose: claimNextInput 的 Task 内优先规则：会话正在协调某项 Task 时，只有该 Task 自己的输入可被认领，其他话题排队等待（R3）
  - path: devagent/src/server/main.ts
    purpose: 入口构建 PiRuntimeFactory/SessionRegistry/InputRunner + worker，注册写方法并启动/优雅关闭；模型由 AGENTDEV_MODEL_PROVIDER/ID 提供（未配置即 blocked_config，输入保持 queued）
  - path: devagent/test/server-write.test.ts（新增，7 项）
    purpose: 真实 HTTP + 真实 stub 模型：提交→worker 跑完（Pi 历史含 input-marker）、重试幂等/同 id 异内容 REQUEST_CONFLICT、专业会话与空 content 与外来 taskId 被拒、未关联输入排队（claimNextInput=busy）、排队输入停止、活动运行被停止并落 stopped
behavior:
  - "实测：npm test 177/177（15 个文件）；typecheck 0；check:prompts 15/15；SDK 试验 47/47；真实模型 4/4"
  - "提交只写库并唤醒 worker（不阻塞 HTTP）；worker 由 runner 认领，保证同一会话只有一个执行所有者（R3）"
  - "未配置模型时 runner 返回 blocked_config：输入保持 queued，不伪装执行；配置模型后同一个 worker 会继续跑"
  - "停止先保存意图再 abort 并等待空闲；已终态的停止幂等返回当前状态（重复停止不改变历史）"
  - "Task 内优先：会话有未结束 Task 时，未关联该 Task 的输入不会被认领（避免新话题越过当前工作）"
review_rounds:
  - round: 1
    verdict: passed
    findings: 1 non-blocking
    fixed:
      - finding: "停止回复沿用 requestStop 返回的旧状态：活动运行已落 stopped 时仍回 status=processing，与 activity=idle 自相矛盾"
        fix: "stopResult 以重新读取的输入行为准，回复状态与 activity 一致"
        evidence: "server-write.test.ts：活动停止回复 status=stopped、activity=idle"
      - finding: "引用了已结束 Task 的输入会成为队头孤儿：Task 终态后 claimNextInput 返回 controlled，该输入永远 queued 并阻塞后续输入"
        fix: "认领时若最早排队输入所属 Task 已 completed/cancelled，则以 TASK_ENDED 关闭该输入并继续取下一个候选（解除阻塞）"
        evidence: "server-write.test.ts：Task 取消后，被引用的输入落 stopped/TASK_ENDED，同一会话的下一条输入被正常认领"
risks_remaining:
  - "task.control / session.cleanup / session.recovery.resolve 属 P4-c2；SSE 通知（input/task invalidate）属 P4-d"
  - "worker 目前以 10ms–250ms 的休眠轮询兜底（外部改库也能被拾起）；事件驱动的唤醒优化随 P4-d 事件总线一并考虑"
```

## 切片 P4-c2 · Task 控制、会话清理与恢复核实（本次）

```yaml
slice: P4-c2 task.control / session.cleanup / session.recovery.resolve（写入面收口）
changed:
  - path: devagent/src/server/write-methods.ts
    purpose: task.control（校验项目/任务/命令与版本，调用与主管工具同一条 runner.controlTask 停止流程，返回最终状态/版本/当前成员）；session.cleanup（被引用或有未结束工作即拒绝并列明原因）；session.recovery.resolve（resolution 枚举、证据必需、CAS 关闭原输入，不调用模型、不重发操作）
  - path: devagent/src/store/store.ts
    purpose: schema v6（session_inputs.recovery 记录核实结论：resolution/evidenceRefs/resolvedBy/resolvedAt，v5→v6 迁移 + 新建库 DDL）；sessionCleanupGaps（未结束输入/绑定 Task/成员关系/被结果引用/被 Task.chiefSessionId 引用）、deleteSession（先删自身行再删会话，revision CAS）、resolveInterruptedInput（要求 interrupted 状态 + 非空证据 + 版本校验）；controlTask 拒绝终态 Task
  - path: devagent/src/server/rpc.ts
    purpose: StoreError.RECOVERY_REQUIRED → 公共码 PI_INPUT_UNCONFIRMED 的映射（存储内码不扩充公共目录）
  - path: devagent/src/server/main.ts
    purpose: 入口注入 runner.controlTask
  - path: devagent/test/server-write.test.ts（新增 5 项）
    purpose: 控制（pause→paused、cancel→cancelled、外来任务 404）；清理（有输入→WORKSPACE_BUSY 且 gaps 指名输入、干净会话删除、版本不符 VERSION_CONFLICT 且不删）；恢复核实（无证据→PI_INPUT_UNCONFIRMED 且保持 interrupted、有证据→completed 并记录 recovery、重复核实被拒）
behavior:
  - "实测：npm test 182/182（15 个文件）；typecheck 0；check:prompts 15/15；SDK 试验 47/47；真实模型 4/4"
  - "task.control 与主管工具共用停止流程：pause 保留排队工作与主管绑定、cancel 停止未开始工作并释放绑定，最终状态在子工作真正停止后才写入"
  - "清理只删除无引用会话：自身输入/绑定/成员关系一并删除；任何未结束输入、绑定 Task、成员关系或已记录结果都会拒绝并列出原因"
  - "恢复核实以证据为前提：证据不足保持 interrupted 并返回 PI_INPUT_UNCONFIRMED，核实后原输入关闭、会话可继续消费剩余工作"
review_rounds:
  - round: 1
    verdict: failed
    findings: 2 blocking + 2 non-blocking
    fixed:
      - finding: "deleteSession 先删父行导致外键失败：任何有过输入/绑定的会话清理都会抛 FOREIGN KEY constraint failed（对外 503），清理实际不可用"
        fix: "同一事务内先删自身行（输入/绑定/成员关系）再 CAS 删除会话；版本不符整体回滚"
        evidence: "server-write.test.ts：带输入与绑定的会话清理成功，且其自身行随之消失"
      - finding: "sessionCleanupGaps 未检测 tasks.chiefSessionId 引用：协调过 Task 的会话被判为可清理但删除时外键失败"
        fix: "把"曾协调 N 个已记录 Task"列为拒绝原因（不级联删除交付记录）"
        evidence: "server-write.test.ts：取消后的 Task 仍使会话清理返回 WORKSPACE_BUSY 且 gaps 指名 coordinated"
      - finding: "task.control 可对终态 Task 改回 paused/active（复活已结束生命周期）"
        fix: "store.controlTask 在写前拒绝 completed/cancelled Task"
        evidence: "server-write.test.ts：对 cancelled Task 再 pause → VERSION_CONFLICT 且状态保持 cancelled"
      - finding: "evidenceRefs 接受空串，等于无证据也能关闭中断输入"
        fix: "处理器与 store 都拒绝空白证据条目"
        evidence: "server-write.test.ts：evidenceRefs=['   '] → PI_INPUT_UNCONFIRMED 且保持 interrupted"
    overclaim_fixed:
      - "rpc.ts 的 RECOVERY_REQUIRED → PI_INPUT_UNCONFIRMED 映射此前实际未生效（补丁静默失配），现已真正落码"
      - "记录中 deleteSession 的顺序描述与代码不符，已随修复统一为"先删自身行再删会话""
      - "恢复核实用例补齐"核实后会话可继续消费剩余工作"（新 continuation 输入被认领）"
collateral_notes:
  - "终态保护同时落到了 setCandidate（同一段锚文本），即终态 Task 不能再冻结新候选；审阅判定无害且语义正确（已结束的 Task 不应产生新候选），此处如实登记"
residual_notes:
  - "resolution=completed 只表示"已核实该输入可以按完成关闭"，不重发操作、不补写历史；剩余工作由主管以新的 continuation 输入继续（S7）"
risks_remaining:
  - "SSE 实时通知（input/task/recovery invalidate）属 P4-d；清理后浏览器端快照刷新依赖 P4-d 的失效通知"
```

## 切片 P4-d · SSE 实时（本次）

```yaml
slice: P4-d 每会话事件总线 + session.stream.prepare（快照与 boundary）+ GET /api/v1/sessions/<id>/stream + 溢出/代次 resync + 业务失效通知
changed:
  - path: devagent/src/server/hub.ts（新增）
    purpose: 每会话单调 seq；prepare 先建缓冲再读快照（boundary=当前 seq）；已认领订阅由 stream 处理器直接投递，未认领进有界缓冲；溢出标记 overflowed 且不阻塞发布方；take 校验会话/主体/过期/重复认领并返回 resync 原因；release 释放
  - path: devagent/src/server/stream-methods.ts（新增）
    purpose: session.stream.prepare：先订阅后读快照（输入状态/activity/当前 Task/最近消息与历史 leaf/problems/待处理交互占位），返回 subscriptionId、streamPath、epoch、boundary 与 snapshot
  - path: devagent/src/server/http.ts
    purpose: GET /api/v1/sessions/:sessionId/stream?subscriptionId=：**cookie 认证（URL 不带凭证）**；订阅不可用（未知/过期/已认领/跨主体）→ 409 STREAM_RESYNC_REQUIRED + 原因；否则发送 boundary 之后的缓冲事件并持续投递；epoch 变化或写背压→发 resync 事件后关闭；断线仅释放缓冲
  - path: devagent/src/runtime/runner.ts
    purpose: onEvent 观察钩子（每 Pi 实例订阅一次、同步投递，不承担持久事务）→ 每事件带 inputId 与 epoch（serverEpoch）
  - path: devagent/src/server/write-methods.ts
    purpose: 提交/停止/控制/清理/恢复核实后发布 {type:'invalidate', entity, id} 业务通知
  - path: devagent/src/server/main.ts
    purpose: 入口创建 hub、接 runner.onEvent、注入写方法与 stream 方法、把 hub 交给 HTTP 层
  - path: devagent/test/server-stream.test.ts（新增，7 项；全部事件驱动等待，无轮询）
    purpose: 快照+boundary 且不重放快照内事实；cookie 认证/跨主体/未知/重复认领；溢出→resync 且不发带洞事件；代次变化→resync；真实 Pi 事件流 + 断线不取消工作
behavior:
  - "实测：npm test 189/189（16 个文件）；typecheck 0；check:prompts 15/15；SDK 试验 47/47；真实模型 4/4"
  - "先订阅后快照：boundary 之前的业务事实只在快照里，boundary 之后的事件只走流，既不丢也不重放（无 Last-Event-ID 依赖）"
  - "阅读者跟不上只会溢出自己的缓冲并收到 resync；Pi 与其他页面不受影响（投递不 await、不阻塞）"
  - "epoch=serverEpoch:Pi 实例代次（注册表在创建/销毁实例时递增）：实例真被重建时活动流发 resync 并关闭，客户端重新 prepare；在尚无实例时取的 boundary 会采纳第一个真实代次（否则首个实例的诞生会被误判为代次变化）"
  - "断线只销毁缓冲：已提交输入仍跑完（测试断言输入 completed 且 hub 订阅归零）"
review_rounds:
  - round: 1
    verdict: passed
    findings: 1 non-blocking
    fixed:
      - finding: "未被接管的 prepare 订阅永不失效：expiresAt 只在 take 时检查 → 订阅表与缓冲无界增长，且每个发布事件都要扫描"
        fix: "hub 在 prepare/publish 时清理过期未接管订阅（TTL 语义成立，无需定时器）"
        evidence: "server-stream.test.ts：可控时钟推进 TTL 后，下一次 prepare 只保留新订阅（size=1）"
      - finding: "epoch 变化在运行时不可达（epoch 恒为不可变 serverEpoch，重启又会断连）"
        fix: "epoch=serverEpoch:实例代次（注册表创建/销毁实例时递增），并加入"无实例时采纳首个真实代次"规则"
        evidence: "server-stream.test.ts：真实 disposeAll 后再次运行 → 活动流 resync reason=epoch"
      - finding: "失效通知嵌套在 event 内且帧类型为 pi，客户端需二次判别（wire-format 歧义）"
        fix: "业务失效通知以帧级 type=invalidate 下发（Pi 事件仍保持 type=pi + event 嵌套）"
        evidence: "server-stream.test.ts：帧级断言 type=invalidate 与 entity/id"
      - finding: "写背压处置过激（write 返回 false 即判溢出），会让正常突发被误判为 resync"
        fix: "按累计未落盘字节设 512KiB 上限，超限才 resync；否则交给 Node 缓冲，不阻塞发布方"
        evidence: "server-stream.test.ts：真实运行的突发事件全部送达且不发生 resync"
risks_remaining:
  - "交互事件与待处理交互快照属 P4-e（当前 snapshot.interactions 恒为空数组，已注明）"
  - "历史 leaf 的 messageKey 去重字段随 P4-f 的对话渲染一并接入（当前快照给 entryId 与 inputId 关联）"
```

## 切片 P4-e · 交互桥（本次）

```yaml
slice: P4-e UIAdapter（普通对象）+ bindExtensions({uiContext,mode:'rpc'}) + 交互 WAL + interaction.respond + question 工具接线
changed:
  - path: devagent/src/store/store.ts
    purpose: schema v7（interactions 表 + 索引，v1→v7 迁移链与新建库 DDL）；createInteraction（展示前先落 pending）、listPendingInteractions/listInteractions、resolveInteraction（resolved 不可覆写：相同答复返回原记录、不同答复 REQUEST_CONFLICT、版本 CAS）、staleInteractionsForInput（源输入停止即置 stale）
  - path: devagent/src/runtime/interactions.ts（新增）
    purpose: InteractionBridge（唯一在进程内唤醒等待者的地方）：ask 先落库再等待、发布 interaction 失效通知、答复到达即用 Pi 原生返回形状回给 ctx.ui；abort 时把交互置 stale 并让 await 退出；createUiAdapter 返回**普通对象**（confirm/select/input/notify + 终端专属面明示为空操作），避免 SDK 展开 uiContext 时丢原型方法
  - path: devagent/src/runtime/runner.ts
    purpose: 每次准备会话时 bindExtensions({uiContext: adapter, mode:'rpc'})（未绑定则 ctx.hasUI=false，模型无法提问）；为所有角色注册移植的 question 工具，并让工具能取回宿主分配的 interactionId
  - path: devagent/src/tools/question-tool.ts
    purpose: 把工具收到的 abort signal 传进 ctx.ui 对话框（G2），被中止时返回可读错误而不是永远等待
  - path: devagent/src/server/write-methods.ts
    purpose: interaction.respond：校验项目/会话路由/版本，先保存答复再回给模型；相同重试幂等、不同答复冲突、过期/已失效 INTERACTION_STALE
  - path: devagent/src/server/stream-methods.ts
    purpose: 快照的 interactions 段改为真实 pending 交互（断线重连能看到未答问题）
  - path: devagent/src/server/main.ts
    purpose: 入口创建 InteractionBridge（发布经 hub）并接 runner 与写方法
  - path: devagent/test/server-interaction.test.ts（新增，4 项）
    purpose: 真实 stub 模型经真实适配器提问→落库→快照可见→浏览器答复→模型继续；答复不可覆写/同答复幂等/异答复冲突/跨会话与版本拒绝；输入停止→交互 stale 且无等待者
behavior:
  - "实测：npm test 193/193（17 个文件）；typecheck 0；check:prompts 15/15"
  - "问题在展示前落库（pending），答复在返回模型前落库（resolved）：崩溃与重连都不丢、不重复决定"
  - "答复路由：只能由该交互所属会话的主管页面回答（跨会话 FORBIDDEN），版本不符 VERSION_CONFLICT"
  - "源输入被停止时其 pending 交互转 stale，等待者立即退出：不会留下永久挂起的调用"
risks_remaining:
  - "父委派等待与子会话交互的联动（M5 要求子问题不解除父委派等待）在 P4-g 的 UI 用例里一并验收；机制上委派等待只看成员输入状态，本切片未改变该逻辑"
```

## 切片 P4-h0 · 渲染库选型（本次）

```yaml
slice: P4-h0 前端渲染库量测（markdown / 高亮 / ANSI / 虚拟化）+ 固定版本 ESM 内置 web/vendor/
changed:
  - path: devagent/package.json
    purpose: 新增 devDependencies（仅浏览器侧，服务器运行时依赖不变）：候选 markdown-it@14.1.0、highlight.js@11.11.1、anser@2.3.2、@tanstack/virtual-core@3.13.12，以及替代品 @highlightjs/cdn-assets@11.11.1、ansi_up@6.0.6
  - path: devagent/spikes/web-01-renderers.ts（新增）
    purpose: 直接加载 web/vendor/ 下浏览器实际使用的 ESM：markdown-it+highlight.js 渲染 2000 行围栏并计时、30 行 GFM 表格、ANSI 着色（anser 作候选对照 + 内置 ansi_up）、virtual-core 对 5000 项/600px 视口的区间计算；任一库加载失败或单次 markdown 渲染 >250ms 即退出非零
  - path: devagent/web/vendor/（新增，69 个已发布 ESM 文件 + README.md，逐文件版本/许可证/导入路径/sha256 见 README）
    purpose: markdown-it 14.1.0（index.mjs + lib/**，53 文件）、@highlightjs/cdn-assets 11.11.1（es/core.min.js + 10 语言 + atom-one-dark 主题，13 文件）、ansi_up 6.0.6（1 文件）、@tanstack/virtual-core 3.13.12（esm index.js+utils.js，2 文件）；全部原样复制（不压缩/不改写/不打包）、逐字节 cmp 核对一致
  - path: .agentdev/work/devagent-p4-webui-20261008/p4h0-renderers.md（新增）
    purpose: 体积 / 计时 / 打包需求结论 / 被拒候选与理由 / 复现命令与实测输出 / sha256 聚合
behavior:
  - "实测：cd devagent && node --experimental-strip-types spikes/web-01-renderers.ts → 退出 0，6/6 通过"
  - "体积（原始/gzip）：markdown-it 161.6/56.8KB、highlight.js 61.6/24.8KB、ansi_up 22.1/3.6KB、virtual-core 27.9/6.3KB；合计 273.3/91.5KB"
  - "计时：2000 行围栏 markdown-it+highlight.js 32.1ms/次；virtual-core 5000 项 600px 区间计算 0.159ms；30 行 GFM 表格 31 <tr>"
  - "打包器：不需要——四个选定库均为原生浏览器 ESM，web/ 保持无构建步骤（未触发 plan §3 的 esbuild 例外）"
  - "拒绝：anser（CJS，需打包）→ 换 ansi_up；highlight.js 核心包的 es/ 是 CJS 包装 → 换官方预编译 @highlightjs/cdn-assets（同版本 11.11.1）"
risks_remaining:
  - "高亮语言包当前内置 10 个；后续切片按需增补语言文件并同步更新 vendor/README.md"
  - "vendor 体积 +91.5KB gzip 未纳入首屏预算核对（浏览器切片 P4-f 的实测网络记录复核）"
```

## 切片 P4-f/P4-g/P4-h · 前端（本次）

```yaml
slice: 设计系统抽取 + 客户端内核 + 八个视图 + 流式渲染部件（真实浏览器可运行）
changed:
  - path: devagent/web/styles/{tokens,components,views}.css + web/i18n.json（抽取，字节保真）
    purpose: mock 的 :root 令牌与全部组件/视图规则逐行照搬（393 条规则、485 个展开选择器，校验脚本输出 found 485 / matched 485 / missing 0 / duplicated 0 / mismatched 0）；i18n 字典 en/zh-CN 各 354 键、双向齐全
  - path: devagent/web/index.html（外壳）
    purpose: mock 骨架（topbar/content-shell/sidebar/workspace/runtime/statusbar + 八个视图容器 + 三个 dialog + toast host），无内联样式/脚本，vendor import map，<script type=module src=/app.js>
  - path: devagent/web/core/*.js（内核）
    purpose: rpc.js（信封 + 每用户动作一个 requestId、重试复用、CSRF 头，令牌存 sessionStorage 以便刷新后仍能写）、stream.js（prepare→快照→SSE→resync 重开，不依赖 Last-Event-ID）、store.js（实体缓存 + invalidate 重取 + 会话实时订阅）、session-view.js（消息/流式块/pending 交互，rAF 合并）、i18n.js、router.js（八视图 hash 路由）、dom.js（el/replace/rafSchedule/relativeTime）
  - path: devagent/web/components/*.js
    purpose: shell.js（顶栏/侧栏/状态栏/控制台折叠与页签）、toast.js、dialog.js、data-list.js、board-card.js、interaction-card.js（confirm/select/input 三种问答控件 + 版本化答复）
  - path: devagent/web/components/stream/*.js
    purpose: markdown-stream.js（**半截围栏/表格行/行内标记暂存**，完成时整块重解析并替换，见 test/web-markdown-stream.test.ts 3 项）、thinking-block.js、tool-card.js（参数流式摘要 + 结果/错误翻转）、log-line.js（ansi_up 着色 + 500 行窗口 + 截断计数）
  - path: devagent/web/views/*.js（八个视图）
    purpose: chief（对话流/问答/阶段条/输入框）、requirements、runs（看板 + task.control）、files（目录树 + 预览/版本/二进制/截断）、docs（固定入口存在性与正文）、inbox（待答问答/恢复核实/待处理任务）、agents（按角色的有效配置）、settings（有效配置/项目状态/未实现项）
  - path: devagent/web/vendor/**（内置库）
    purpose: markdown-it 14.1.0、@highlightjs/cdn-assets 11.11.1、ansi_up 6.0.6、@tanstack/virtual-core 3.13.12 及其 ESM 依赖（linkify-it/mdurl/uc.micro/punycode.js/entities），全部原始字节，import map 直连，无构建步骤
  - path: devagent/src/server/http.ts
    purpose: .mjs 以 JavaScript MIME 提供（真实浏览器首次加载即暴露的缺口）
  - path: devagent/browser/**（Playwright）
    purpose: playwright.config.ts（chromium、无重试、单 worker）+ harness.ts（进程内起真实工作台 + 可注入 stub 模型 + 通过 UI 登录 + 经 RPC 预置项目/会话）+ smoke.spec.ts（首开无项目、预置项目渲染外壳）+ acceptance.spec.ts（开项目与八视图、提交→流式回答、浏览器内回答提问→模型继续、离开后再回来）
  - path: devagent/vitest.config.ts（新增）
    purpose: 单元测试只收 test/**，browser/** 由 Playwright 运行（否则 Playwright 规格被 vitest 收集并报错）
behavior:
  - "实测：单元/集成 npm test 198/198（18 个文件）；typecheck 0；check:prompts 15/15；SDK 试验 47/47；真实模型 4/4"
  - "真实浏览器（chromium，无重试）：6 项全绿 —— 首开无项目可登录并渲染空外壳；预置项目渲染外壳（状态栏 connected、语言切换 EN/简中）；开项目后八视图逐一可见；提交输入→用户消息立即出现→助手回答经流式渲染出现；提问在浏览器内回答后模型继续；离开页面再回来仍能重建会话（cookie + 会话级 CSRF 令牌）"
  - "真实浏览器暴露并修复的三处缺口：app.js 缺少变量声明导致整页不启动；http.ts 未把 .mjs 当 JS（内置 ESM 全部被拒）；markdown-it 的传递依赖未内置/未映射（顶层 import 直接失败）"
risks_remaining:
  - "会话 cookie 为进程内存态：服务重启需重新登录（首版可接受）"
  - "无 project.list 方法：项目切换器只能按路径打开（契约内的诚实行为）"
  - "agents/settings 视图只呈现当前有效配置；config.save/test 尚未实现"
```

## 后续切片（计划内，未开始）

```yaml
pending: [P4-f 设计系统与外壳, P4-g 业务页面, P4-h 流式渲染部件, P4-i 浏览器验收]
```

## 切片 P4-f(1) · 设计系统与外壳抽取（本次）

```yaml
slice: P4-f(1) 从 mock 逐字节抽取设计系统（tokens/components/views）+ i18n 字典 + 外壳 index.html
basis: "webui/index.html（mock）：<style> 9-1269、外壳/视图标记 1270-1746、prototype <script> 1747-2976 的 messages 字典"
changed:
  - path: devagent/web/styles/tokens.css（新增，59 行）
    purpose: mock `:root` 自定义属性（mock:10-35）verbatim + 全局元素规则（mock:37-62：`*`、`html, body`、`body`、`button, textarea, input, select`、`button`、`:focus-visible` 组）
  - path: devagent/web/styles/components.css（新增，1008 行 / 253 条规则）
    purpose: 全部组件规则，选择器与声明逐字节照搬，按 mock 顺序分组、每组注释注明 mock 行范围
  - path: devagent/web/styles/views.css（新增，488 行 / 133 条顶层规则，含 @media 内层共 198 个块）
    purpose: 视图专有规则（generic/files/data-list/settings/board/decision/audit）+ 响应式断点（1120/840/700/520px 及 prefers-reduced-motion）
  - path: devagent/web/i18n.json（新增，en 309 键 / zh-CN 309 键）
    purpose: 断言 mock script 里 `messages`（= baseMessages + messages 两段 spread 的合并结果，即 mock 实际生效字典）导出为 {en, zh-CN}，键与 data-i18n/data-i18n-aria 用法一致
  - path: devagent/web/index.html（新增，333 行）
    purpose: 外壳（topbar / content-shell：sidebar + workspace + runtime / statusbar）+ 八个 .view 容器 + 三个 dialog + toast host；类名与 DOM 层级照搬 mock，内联 style/script 去除，mock 专有数据置空为同 id/类容器并带 data-i18n 键；附 /vendor/ import map 与 `<script type="module" src="/app.js">`
  - path: devagent/web/styles/verify-selectors.mjs（新增）
    purpose: 独立解析 mock `<style>` 与三个 CSS 文件，逐 (media 上下文, 选择器) 断言唯一归属且声明忽略空白后一致
  - path: devagent/web/styles/OMISSIONS.md（新增）
    purpose: 登记偏差——`--font-scale` 未收录（mock :root 无此令牌）、mock 数据置空、单一 #genericView 拆为八个 .view、.terminal-prompt 保留待裁
mock_line_ranges:
  tokens.css:
    - [10, 35, ":root 设计令牌"]
    - [37, 62, "全局元素规则"]
  components.css:
    - [64, 272, "topbar · brand / project switcher / top actions"]
    - [274, 330, "shell · sidebar 导航"]
    - [332, 352, "workspace 栅格"]
    - [354, 483, "conversation 外壳 / header / switcher / stage-strip"]
    - [485, 565, "message 列表 / message / context-memory 卡"]
    - [567, 644, "command-chip / run-card / requirement-summary / activity"]
    - [646, 692, "composer"]
    - [951, 1097, "runtime 控制台 · chrome / run-summary / agent-tree / log / prompt"]
    - [1099, 1163, "statusbar / toast / dialog"]
  views.css:
    - [347, 353, "workspace 收起轨 · @media (min-width: 841px)"]
    - [694, 703, "generic-view 容器"]
    - [705, 856, "files 视图 · tree / preview / code / sr-only"]
    - [858, 864, "data-list"]
    - [866, 896, "settings · config / profile / provider"]
    - [898, 919, "requirement-board"]
    - [921, 938, "decision-card"]
    - [940, 949, "workflow-audit"]
    - [1165, 1268, "响应式断点 1120/840/700/520 + prefers-reduced-motion"]
behavior:
  - "node devagent/web/styles/verify-selectors.mjs → 退出 0：found 485 / matched 485 / missing 0 / duplicated 0 / mismatched 0 / extra 0"
  - "node -e \"JSON.parse(...i18n.json)\" → 合法 JSON（en/zh-CN 键集相同，309+309）"
  - "index.html 中 121 个 data-i18n* 键全部在 i18n.json 的 en 与 zh-CN 中命中，无未解析键"
  - "index.html 含 8 个 .view 容器（chief/requirements/docs/agents/runs/inbox/settings/files），无内联 style/script"
  - "选择器总量：mock 共 393 条规则（485 个展开选择器）；tokens 7 / components 253 / views 133 条顶层规则 + 5 个 @media 块，全部归一"
not_covered:
  - area: "app.js 与 core/*、components/*、views/* 渲染逻辑"
    reason: "由同批次其它切片负责；本切片仅外壳与设计系统"
    disposition: pending
  - area: "CSS 逐组件浏览器截图对照与键盘可达性"
    reason: "属 P4-f 的浏览器验收（P4-i）"
    disposition: pending
  - area: "密度旋钮 --font-scale"
    reason: "mock :root 未定义；加入会破坏 :root 逐字节一致。见 OMISSIONS.md"
    disposition: deferred
```

## 切片 P4-g(A) · 需求/看板/文件/文档页（本次）

```yaml
slice: P4-g(A) 业务页面四分之一：Requirements / Runs(Task 看板) / Files / Docs 四个视图 + app.js 接线
basis: "R1 只读方法表（requirement.list/get、task.list/get/report.get、task.control、project.get 的 entries、project.files.list/read）；plan.md §5 视图 mount/update 与 store 订阅；webui/index.html（mock）的 board/data-list/files/docs 结构与类名"
changed:
  - path: devagent/web/views/requirements.js（新增，约 200 行）
    purpose: "requirement.list 记录渲染为 .data-list/.data-row（id/title/kind·updatedAt·version/status），kind+status 两个筛选 <select>（客户端筛选已加载列表）；行点击经 requirement.get 打开对话展示元数据、格式问题（issues）与记录原文（.code-pre）；invalidFiles 作为独立 .data-list 段落展示文件与各条 issue；无任何记录时显式空态并点名 .dev/requirements/"
  - path: devagent/web/views/runs.js（新增，约 200 行）
    purpose: "store.tasks 经 board-card.js 渲染进 .requirement-board，按真实 status 分入四列（active/pausing、waiting、paused/cancelling、completed/cancelled）；卡片点击经 task.get 打开详情（phase/status/revision/goal/scope/members/results）；pause/resume/cancel 调 store.rpc.call('task.control',{taskId,command,expectedRevision}, { requestId:newRequestId() })，成功后 refreshTasks 并关窗；结果行点击经 task.report.get 展示报告原文；无 Task 时显式空态"
  - path: devagent/web/views/files.js（新增，约 260 行）
    purpose: "project.files.list 惰性构建目录树（每目录一次、按 nextCursor 翻页取全），目录为 <details> 首次展开时加载；文件点击经 project.files.read 填充 #filePath/#fileMeta(size·sha256 版本)/#fileLineCount/#fileCode，binary 与 truncated 如实标注；#fileSearch 只过滤已加载树、并切换 #fileTreeEmpty 与 #visibleFileCount"
  - path: devagent/web/views/docs.js（新增，约 160 行）
    purpose: "project.get 的 entries（AGENTS.md/.dev/INDEX.md/.dev/PROJECT.md）逐条列出 present/missing，缺失条目单列“Missing entries”缺口段；选中存在条目经 project.files.read 取文并以 context.markdownIt 渲染（.markdown-body）；选中缺失条目报缺口卡片且不发起读取"
  - path: devagent/web/app.js（修改，仅两处）
    purpose: "import 四个工厂；createView(id) 增加 requirements/runs/files/docs 四个 case。placeholder 兜底未改，保留给 inbox/agents/settings（P4-g(B)）"
  - path: devagent/web/i18n.json（修改）
    purpose: "为四个视图新增 45 键（requirements.* / runs.* / docs.* / files.* / common.loading），en 与 zh-CN 对称"
behavior:
  - "四视图全部只用真实 RPC/ store 数据；空态、缺失、非法文件、binary/truncated 均如实呈现，绝不编造数值"
  - "视图生命周期照 chief.js：createXView(context) 返回 { id, mount, update, destroy? }；requirements/docs/files 在 'requirement'/'project' 失效通知上重绘，runs 复用 app.js 既有的 task/session 全量 update 派发"
not_covered:
  - area: "Runs 看板非空形态与 task.control/report.get 的实际交互"
    reason: "无模型时项目尚无 Task，看板落在空态；有模型的全链路交互属 P4-i"
    disposition: pending
  - area: "inbox / agents / settings 三视图"
    reason: "属同批次 P4-g(B)（另一并发切片）"
    disposition: pending
```
