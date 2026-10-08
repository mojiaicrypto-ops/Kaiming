# Test Report · devagent-p4-webui-20261008

## 切片 P4-c2 · Task 控制、会话清理与恢复核实（本次）

```yaml
runs:
  - command: cd devagent && npx tsc --noEmit
    result: passed
    exit_code: 0
    evidence: "无输出"
  - command: cd devagent && npm test
    result: passed
    exit_code: 0
    evidence: "15 个测试文件、182 项通过（server-write 12 项）"
  - command: cd devagent && npm run check:prompts / npm run spikes / node checks/runner-real-model.ts
    result: passed
    exit_code: 0
    evidence: "15/15；47/47；4/4"
key_evidence:
  - "task.control：pause→paused、cancel→cancelled（走 runner 停止流程），外来任务 404；版本校验来自同一 CAS"
  - "session.cleanup：仍有输入 → 409 WORKSPACE_BUSY 且 gaps 指名 in-8、会话仍存在；带自身输入与绑定的会话删除成功且行随之消失；协调过 Task 的会话被拒并指名 coordinated；干净会话用错误版本 → 409 VERSION_CONFLICT 且未删除"
  - "task.control 终态保护：对 cancelled Task 再 pause → VERSION_CONFLICT 且状态不变"
  - "证据真实性：evidenceRefs=['   '] → PI_INPUT_UNCONFIRMED 且输入保持 interrupted；核实后同一会话的下一条 continuation 输入可被认领（S7 语义）"
  - "session.recovery.resolve：无 evidenceRefs → 409 PI_INPUT_UNCONFIRMED 且输入保持 interrupted；带证据 → completed 且 recovery 记录 resolution/evidenceRefs；对已关闭输入再次核实 → 400（状态不符）"
  - "schema v6：session_inputs.recovery 列在新建库与 v1→v6 迁移链上都存在（store.test.ts 断言版本 6 与列可读）"
not_covered:
  - area: "SSE 实时通知与浏览器快照刷新"
    reason: "属 P4-d"
    disposition: pending
result: passed
```

## 切片 P4-c1 · 输入接纳与停止（本次）

```yaml
runs:
  - command: cd devagent && npx tsc --noEmit
    result: passed
    exit_code: 0
    evidence: "无输出"
  - command: cd devagent && npm test
    result: passed
    exit_code: 0
    evidence: "15 个测试文件、177 项通过（server-write 7 项）"
  - command: cd devagent && npm run check:prompts / npm run spikes / node checks/runner-real-model.ts
    result: passed
    exit_code: 0
    evidence: "15/15；47/47；4/4"
key_evidence:
  - "提交→真实运行：session.input.submit 返回 queued，worker 用 stub 模型把该输入跑完（状态 completed），Pi 历史文件里存在 agentdev.input-marker 与 inputId"
  - "幂等：同 requestId 同内容重发返回同一 inputId 且只有一行；同 requestId 不同内容 → 409 REQUEST_CONFLICT"
  - "拒绝：专业会话收用户输入 403；空 content 400；外来 taskId 400 且不落任何输入行"
  - "Task 内优先：会话有未结束 Task 时，未关联输入返回 waitingForTask 且 claimNextInput=busy（排队等待，不越过）"
  - "排队停止：输入落 stopped 且 activity=idle（worker 无模型时不会先跑掉，状态可判定）"
  - "活动停止：probe 工具持有运行时停止 → 输入先 processing，stop 回复 status=stopped/activity=idle（与行一致），运行落 stopped、输入落 stopped（真实 abort 与空闲等待）"
  - "孤儿输入：Task 结束后，引用它的排队输入以 TASK_ENDED 关闭，同一会话的下一条输入仍能被认领（不阻塞队列）"
not_covered:
  - area: "task.control / session.cleanup / session.recovery.resolve"
    reason: "属 P4-c2"
    disposition: pending
  - area: "SSE 实时通知（input/task invalidate）"
    reason: "属 P4-d"
    disposition: pending
result: passed
```

## 切片 P4-b · 只读查询面（本次）

```yaml
runs:
  - command: cd devagent && npx tsc --noEmit
    result: passed
    exit_code: 0
    evidence: "无输出"
  - command: cd devagent && npm test
    result: passed
    exit_code: 0
    evidence: "14 个测试文件、170 项通过（server-read 17 项）"
  - command: cd devagent && npm run check:prompts
    result: passed
    exit_code: 0
    evidence: "15/15 通过"
  - command: cd devagent && AGENTDEV_ACCESS_PASSWORD=… AGENTDEV_DATA_DIR=/tmp/agentdev-read-live AGENTDEV_PORT=4182 node src/server/main.ts + curl
    result: passed
    exit_code: 0
    evidence: "project.open→registered（AGENTS.md:true,.dev/INDEX.md:false,.dev/PROJECT.md:false）；session.create→s-… role=chief activity=idle；task.list→[]；files.list→.dev:directory,AGENTS.md:file；files.read→version=sha256, text="# rules\n""
key_evidence:
  - "未认证调用任一读方法 → 401"
  - "同目录再次 open → opened=existing（realpath 身份）；不存在目录 → PROJECT_UNAVAILABLE"
  - "目录被删除的项目：directoryExists=false + problem 提示重绑（不假装正常）"
  - "无模型可建会话与读取；未知 session/Task/需求 → NOT_FOUND；Task 只能按本项目读取"
  - "历史：marker 关联 inputId 与 inputStatus；分页用条目 id 且第二次翻页只回下一条；坏行进 problems；无历史=空，绑定文件缺失=HISTORY_UNAVAILABLE(409)"
  - "输入：原文 payload 不变，边界/停止原因/错误码按真实行返回"
  - "报告：正文与版本返回；手改正文后 REPORT_STALE(409)"
  - "需求：合法记录与 req-broken.md invalidFiles 同时返回；损坏记录 get 返回 issues 而非抛错"
  - "文件：expectedVersion 不符 → VERSION_CONFLICT；二进制返回 binary=true/text=null；../ 越界与指向项目外的符号链接 → FORBIDDEN"
  - "恢复巡检：列出 interrupted 输入与其错误码、绑定信息（fileExists）、相关 Task 结果"
  - "审阅修复验证：越界需求 id → INVALID_ARGUMENT 且不泄露；task.list 连续两页不同；清空绑定历史 → HISTORY_UNAVAILABLE；悬空/外部符号链接在列表中是 symlink 且无 size；requirement.list/files.list 未知游标 → INVALID_ARGUMENT"
  - "重绑：无决定引用 → FORBIDDEN；有在飞工作 → WORKSPACE_BUSY 且 gaps 指名 t-1 与 i-broken；干净项目重绑成功且会话 cwd 跟随新目录"
not_covered:
  - area: "绑定历史的完整身份校验（换入另一 Pi 会话但仍有 session 头的文件）"
    reason: "绑定未记录预期 Pi session id；随 P4-d 快照/分支信息补上"
    disposition: pending
  - area: "SSE 与快照（session.stream.prepare / stream）"
    reason: "属 P4-d"
    disposition: pending
  - area: "写入面（input.submit/stop、task.control、cleanup、recovery.resolve）"
    reason: "属 P4-c"
    disposition: pending
result: passed
```

## 切片 P4-a · RPC 骨架与认证（本次）

```yaml
runs:
  - command: cd devagent && npx tsc --noEmit
    result: passed
    exit_code: 0
    evidence: "无输出"
  - command: cd devagent && npm test
    result: passed
    exit_code: 0
    evidence: "13 个测试文件、153 项通过（server 10 项）"
  - command: cd devagent && npm run check:prompts
    result: passed
    exit_code: 0
    evidence: "15/15 通过"
  - command: cd devagent && AGENTDEV_ACCESS_PASSWORD=smoke-secret AGENTDEV_DATA_DIR=/tmp/agentdev-smoke3 AGENTDEV_PORT=4181 node src/server/main.ts
    result: passed
    exit_code: 0
    evidence: "启动行：workbench listening on http://127.0.0.1:4181 (data: /tmp/agentdev-smoke3)"
  - command: curl POST /api/v1/rpc（未认证）
    result: passed
    exit_code: 0
    evidence: "401 {\"error\":{\"code\":\"UNAUTHORIZED\",\"message\":\"log in first\"}}"
  - command: curl POST /api/v1/rpc auth.login（正确口令）
    result: passed
    exit_code: 0
    evidence: "200，Set-Cookie: agentdev_session=…; HttpOnly; SameSite=Strict; Path=/，result={csrfToken}"
  - command: curl POST /api/v1/rpc config.get（已认证）
    result: passed
    exit_code: 0
    evidence: "200，effective={providerId,modelId,source,agentDir,promptDir}；promptDir 存在；响应无 apiKey/password/token"
key_evidence:
  - "未认证调用 401；登出后再调用 401（会话立即撤销）"
  - "写调用：无 requestId → INVALID_ARGUMENT；无/错 CSRF → 403；正确 CSRF → 执行且副作用恰好一次"
  - "幂等：同 requestId 同参数第二次返回同一结果，handler 只执行一次；同 requestId 不同参数 → 409 REQUEST_CONFLICT"
  - "失败回执：同 requestId 重试返回同一错误，handler 只执行一次（错误也是真实结果，不回滚重跑）"
  - "信封：未知方法/非对象 params/非 JSON 正文 → INVALID_ARGUMENT；跨源 Origin → FORBIDDEN；同源 Origin 通过并回显 requestId"
  - "config.get：未知 projectId → NOT_FOUND；凭证只以引用形态说明（credentials.inResponse=false）"
  - "静态目录：/ 返回 index.html（text/html；no-store）；越根用例在 web 根外放置哨兵文件并用 /%2e%2e%2fsentinel-outside.txt 访问（400/404 且正文不含哨兵内容）；畸形 % 编码 400 INVALID_ARGUMENT"
  - "变异验证：临时移除根包含检查后该用例失败（返回 200 且泄露哨兵内容），恢复后 10/10 通过——证明用例能捕获守卫回归（不是空断言）"
  - "回执键空间：写回执落在 rpc:<requestId>，原始 id 不被占用；带 requestId 的登录在回执表中不留任何行；读调用带 requestId 只回显不绑定去重"
not_covered:
  - area: "SSE 实时（stream.prepare/GET stream/resync）"
    reason: "属 P4-d"
    disposition: pending
  - area: "交互（interaction.respond / bindExtensions 适配器）"
    reason: "属 P4-e"
    disposition: pending
  - area: "浏览器界面与 Playwright 验收"
    reason: "属 P4-f～P4-i"
    disposition: pending
  - area: "会话 cookie 在服务重启后的持久化"
    reason: "首版为内存会话，重启即需重新登录"
    disposition: allowed
  - area: "静态目录的符号链接跟随"
    reason: "web 根内符号链接可指向根外；该面在 P4-a 未启用（未配置 staticDir），真实资产接入时按 R1 realpath 规则处理"
    disposition: pending
  - area: "pending 回执跨重启对账"
    reason: "P4-a 处理器全同步故不可达；P4-c 异步写接入时按 S7 恢复对账"
    disposition: pending
result: passed
```
