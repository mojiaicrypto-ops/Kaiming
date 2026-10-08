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
  - path: devagent/test/server-write.test.ts（新增，6 项）
    purpose: 真实 HTTP + 真实 stub 模型：提交→worker 跑完（Pi 历史含 input-marker）、重试幂等/同 id 异内容 REQUEST_CONFLICT、专业会话与空 content 与外来 taskId 被拒、未关联输入排队（claimNextInput=busy）、排队输入停止、活动运行被停止并落 stopped
behavior:
  - "实测：npm test 176/176（15 个文件）；typecheck 0；check:prompts 15/15；SDK 试验 47/47；真实模型 4/4"
  - "提交只写库并唤醒 worker（不阻塞 HTTP）；worker 由 runner 认领，保证同一会话只有一个执行所有者（R3）"
  - "未配置模型时 runner 返回 blocked_config：输入保持 queued，不伪装执行；配置模型后同一个 worker 会继续跑"
  - "停止先保存意图再 abort 并等待空闲；已终态的停止幂等返回当前状态（重复停止不改变历史）"
  - "Task 内优先：会话有未结束 Task 时，未关联该 Task 的输入不会被认领（避免新话题越过当前工作）"
risks_remaining:
  - "task.control / session.cleanup / session.recovery.resolve 属 P4-c2；SSE 通知（input/task invalidate）属 P4-d"
  - "worker 目前以 10ms–250ms 的休眠轮询兜底（外部改库也能被拾起）；事件驱动的唤醒优化随 P4-d 事件总线一并考虑"
```

## 后续切片（计划内，未开始）

```yaml
pending: [P4-c2 task.control/cleanup/recovery.resolve, P4-d SSE, P4-e 交互桥, P4-h0 渲染库试验, P4-f 设计系统与外壳, P4-g 业务页面, P4-h 流式渲染部件, P4-i 浏览器验收]
```
