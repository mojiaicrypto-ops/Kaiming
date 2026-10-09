# Test Report · devagent-p4-webui-20261008

## 切片 P4-h0 · 渲染库选型（本次）

```yaml
runs:
  - command: cd devagent && node --experimental-strip-types spikes/web-01-renderers.ts
    result: passed
    exit_code: 0
    evidence: "6/6 通过；内置体积合计 273.3KB 原始 / 91.5KB gzip；2000 行围栏 32.1ms/次；virtual-core 5000 项 600px 区间 0.159ms"
  - command: cd devagent && npx tsc --noEmit
    result: passed
    exit_code: 0
    evidence: "无输出"
  - command: cd devagent && npm test
    result: passed
    exit_code: 0
    evidence: "17 个测试文件、193 项通过"
  - command: cd devagent && cmp 逐文件核对 web/vendor 与 node_modules 上游发布物
    result: passed
    exit_code: 0
    evidence: "identical=69 mismatches=0（逐文件 sha256 见 web/vendor/README.md）"
key_evidence:
  - "试验脚本直接加载 web/vendor/ 下浏览器实际使用的 ESM（非 npm 入口），证明无打包步骤即可被浏览器消费"
  - "markdown-it+highlight.js 渲染 2000 行 javascript 围栏：32.1ms/次（阈值 250ms），输出 374762 字符"
  - "30 行 GFM 表格渲染出 31 个 <tr>"
  - "virtual-core：5000 项 / 24px / 600px 视口，offset 0 → [0,24]、offset 1200 → [50,74]，总高 120000px"
  - "ANSI：anser 仅经 Node CJS 互操作可着色（因此作为浏览器依赖被拒、不内置）；内置 ansi_up 6.0.6 输出 228 字符带 ansi-* 类 HTML"
  - "拒绝并替换：anser（CJS）→ ansi_up；highlight.js 核心包 es/（CJS 包装）→ @highlightjs/cdn-assets 11.11.1"
  - "退出码契约：任一库加载失败或单次 markdown 渲染 >250ms → 非零退出（本次 0）"
not_covered:
  - area: "浏览器内实际加载 vendor ESM 与高亮 CSS 渲染（真实 Chromium）"
    reason: "属 P4-i；本片在 Node 中验证加载边界与脚本，尚未在浏览器验证"
    disposition: pending
  - area: "vendor 体积对首屏/网络的实测影响"
    reason: "属 P4-f 外壳与 P4-i 验收"
    disposition: pending
result: passed
```

## 切片 P4-f/P4-g/P4-h/P4-i · 前端与浏览器验收（本次）

```yaml
runs:
  - command: cd devagent && npx tsc --noEmit
    result: passed
    exit_code: 0
    evidence: "无输出"
  - command: cd devagent && npm test
    result: passed
    exit_code: 0
    evidence: "18 个测试文件、198 项通过（含 web-markdown-stream 3 项）"
  - command: cd devagent && npm run check:prompts / npm run spikes / node checks/runner-real-model.ts
    result: passed
    exit_code: 0
    evidence: "15/15；47/47；4/4"
  - command: cd devagent && node --experimental-strip-types spikes/web-01-renderers.ts
    result: passed
    exit_code: 0
    evidence: "6/6 渲染库检查（markdown-it 2000 行围栏 32.1ms；表格 31 行；ansi_up 着色；virtual-core 5000 项窗口 0.159ms/range；无需打包器）"
  - command: cd devagent && node web/styles/verify-selectors.mjs
    result: passed
    exit_code: 0
    evidence: "found 485 / matched 485 / missing 0 / duplicated 0 / mismatched 0 / extra 0"
  - command: cd devagent && node -e "JSON.parse(fs.readFileSync('web/i18n.json'))"（键数核对）
    result: passed
    exit_code: 0
    evidence: "en 354 键、zh-CN 354 键、zh 缺键 0"
  - command: cd devagent && npx playwright test --reporter=line
    result: passed
    exit_code: 0
    evidence: "8 passed (6.5s)：acceptance 6 项 + smoke 2 项"
key_evidence:
  - "浏览器（chromium，无重试、单 worker，真实进程内工作台 + 真实 stub 模型端点）：开项目→八视图逐一可见；提交输入→用户消息出现→助手回答经流式渲染出现；提问在浏览器内回答→模型继续产出下文；离开页面再回来（about:blank→回）仍重建同一会话的对话"
  - "首开无项目：登录对话框 → 空外壳可正常显示（smoke）"
  - "外壳由真实数据驱动：项目名/路径来自 project.get；状态栏 connected；语言切换 EN/简中改变可见文案（smoke）"
  - "渲染部件单测：半截围栏/未完成表格行/悬空行内标记被暂存为 pending 文本，完成时整块重解析并替换（最终渲染与一次性渲染一致）"
  - "审阅修复回归（全部走真实浏览器）：助手消息恰好 1 条（不重复）；连续两次 Enter 只产生 1 条用户消息；业务 FORBIDDEN（外部符号链接）后仍可写入；六个视图不出现原始 i18n 键"
  - "i18n 键数：en 399 / zh-CN 399，双向无缺；视图实际引用的键全部命中"
not_covered:
  - area: "P4-f/P4-g/P4-h/P4-i 的独立审阅"
    reason: "子代理模型配额在 2026-10-09 17:14 前耗尽，评审会话无法启动"
    disposition: pending
  - area: "工具卡/思考块的浏览器级视觉核对（截图已存 test-results 附件，逐组件人工比对未做）"
    reason: "组件级渲染已由单测与真实运行覆盖；逐组件视觉对照属 P6 完整验收"
    disposition: pending
result: passed
```

## 切片 P4-e · 交互桥（本次）

```yaml
runs:
  - command: cd devagent && npx tsc --noEmit
    result: passed
    exit_code: 0
    evidence: "无输出"
  - command: cd devagent && npm test
    result: passed
    exit_code: 0
    evidence: "17 个测试文件、193 项通过（server-interaction 4 项）"
  - command: cd devagent && npm run check:prompts
    result: passed
    exit_code: 0
    evidence: "15/15 通过"
key_evidence:
  - "端到端（真实 stub 模型 + 真实适配器）：模型 question(select) → 交互落库 pending（含 options 与 inputId）→ stream.prepare 快照含该交互 → interaction.respond 写 resolved → 原 ctx.ui 调用返回并继续跑完输入"
  - "不可覆写：同答复重试返回原记录；不同答复 → REQUEST_CONFLICT；库中答复保持第一次的值"
  - "路由与版本：跨会话 chiefSessionId → FORBIDDEN；旧版本 → VERSION_CONFLICT；未答时状态仍 pending"
  - "停止即失效：输入被停止 → 交互转 stale、输入落 stopped、bridge 等待者归零（无永久挂起）"
not_covered:
  - area: "子委派期间提问不解除父委派等待（M5）的浏览器级验收"
    reason: "机制未变（委派等待只看成员输入状态）；浏览器用例随 P4-i"
    disposition: pending
result: passed
```

## 切片 P4-d · SSE 实时（本次）

```yaml
runs:
  - command: cd devagent && npx tsc --noEmit
    result: passed
    exit_code: 0
    evidence: "无输出"
  - command: cd devagent && npm test
    result: passed
    exit_code: 0
    evidence: "16 个测试文件、189 项通过（server-stream 7 项）"
  - command: cd devagent && npm run check:prompts / npm run spikes / node checks/runner-real-model.ts
    result: passed
    exit_code: 0
    evidence: "15/15；47/47；4/4"
key_evidence:
  - "prepare：boundary=当前 seq，快照含既有 queued 输入与 activity；streamPath 携带 subscriptionId"
  - "只发 boundary 之后：先 prepare 再发布 2 个事件，客户端收到 seq=1,2 且快照里的输入没有被重放"
  - "认证：无 cookie → 401；跨会话/未知订阅 → 409 STREAM_RESYNC_REQUIRED（原因 forbidden/unknown）；同订阅再取一次 → 原因 taken"
  - "溢出：bufferLimit=3 时连发 6 个事件，客户端收到 event: resync reason=overflow 且 **零事件**（不发带洞数据）"
  - "代次（合成）：活动流收到更高代次事件 → resync reason=epoch，仅收到变化前的事件"
  - "代次（真实）：disposeAll 重建 Pi 实例后再次运行 → 活动流 resync reason=epoch（epoch=serverEpoch:实例代次）"
  - "订阅失效：TTL 过期且从未被接管的订阅在下一次 prepare 时被清理（size 保持 1）"
  - "帧形状：Pi 事件 type=pi + event 嵌套；失效通知为帧级 type=invalidate（entity/id 在顶层）"
  - "真实运行：提交输入→worker 跑完→流中出现 invalidate(input) 与带 inputId 的真实 Pi 事件；客户端断开后输入仍 completed，hub 订阅数归零"
not_covered:
  - area: "交互事件（interaction pending/resolved）与快照中的待处理交互"
    reason: "属 P4-e"
    disposition: pending
  - area: "历史分片的 messageKey 去重字段"
    reason: "随 P4-f 对话渲染接入；当前快照提供 entryId 与 inputId 关联"
    disposition: pending
result: passed
```

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

## 切片 P4-f(1) · 设计系统与外壳抽取（本次）

```yaml
runs:
  - command: node devagent/web/styles/verify-selectors.mjs
    result: passed
    exit_code: 0
    evidence: |
      CSS fidelity check vs webui/index.html <style>
        selectors found in mock : 485
        matched                 : 485
        missing                 : 0
        duplicated              : 0
        mismatched declarations : 0
        extra (not in mock)     : 0
  - command: node -e "JSON.parse(require('fs').readFileSync('devagent/web/i18n.json','utf8'))"
    result: passed
    exit_code: 0
    evidence: "i18n.json: valid JSON"
  - command: node -e "…统计 index.html 的 data-i18n* 键并在 i18n.json 中查 resolve…"
    result: passed
    exit_code: 0
    evidence: "keys in index.html: 121 | unresolved: none | view containers: 8"
  - command: grep -n 'style="' devagent/web/index.html
    result: passed
    exit_code: 0
    evidence: "无匹配（无内联 style）；脚本仅 importmap 与 type=module 外链"
key_evidence:
  - "逐字节保真：mock 的 485 个展开选择器全部出现在且仅出现在 tokens/components/views 之一，声明（去空白后）与 mock 完全一致；无遗漏、无重复、无新增选择器"
  - "i18n：mock 生效字典（baseMessages 与 messages 两段合并结果）导出为 {en, zh-CN}；两语言键集相同（各 309）；130 个 mock 标记键全部可解析"
  - "外壳：八个 .view 容器（chief/requirements/docs/agents/runs/inbox/settings/files）齐备；topbar/content-shell(sidebar+workspace+runtime)/statusbar/三对话框/toast host 类名与嵌套照搬 mock"
  - "导入映射取 vendor/README.md 既定条目（markdown-it / highlight.js / ansi_up / @tanstack/virtual-core），路径改为同源 /vendor/"
not_covered:
  - area: "CSS 渲染截图对照、四断点、键盘可达性与 aria-live"
    reason: "需真实 Chromium，属 P4-i 浏览器验收"
    disposition: pending
  - area: "app.js / core / components / views 运行时接线与数据渲染"
    reason: "同批次其它切片负责；本切片不含 JS 逻辑"
    disposition: pending
result: passed
```

## 切片 P4-g(A) · 需求/看板/文件/文档页（本次）

```yaml
runs:
  - command: node --check devagent/web/views/{requirements,runs,files,docs}.js devagent/web/app.js
    result: passed
    exit_code: 0
    evidence: "五个文件语法检查全部 OK"
  - command: npx tsc --noEmit（devagent/）
    result: passed
    exit_code: 0
    evidence: "TSC_OK；web/*.js 不在 tsconfig include 内，服务端类型面不受影响"
  - command: npx vitest run --exclude "browser/**"（devagent/）
    result: passed
    exit_code: 0
    evidence: "Test Files 17 passed (17) / Tests 195 passed (195)"
  - command: npm test（devagent/，原样）
    result: failed
    exit_code: 1
    evidence: "仅 browser/smoke.spec.ts 与 browser/acceptance.spec.ts 两个 Playwright 规格被 vitest 收集后报错（'Playwright Test did not expect test.beforeAll() to be called here'）；195 个服务端用例全部通过。browser/ 为同批次 P4-i 并发新增（未跟踪），与本切片无关"
  - command: "AGENTDEV_ACCESS_PASSWORD=dev AGENTDEV_DATA_DIR=/tmp/p4-views-a AGENTDEV_PORT=4191 node src/server/main.ts"
    result: passed
    evidence: "workbench listening on http://127.0.0.1:4191（未设置 AGENTDEV_MODEL_*）"
  - command: "真实 Chromium（eval browser 工具）打开 http://127.0.0.1:4191/ → 登录 → 打开夹具项目 /tmp/p4-views-project → 依次访问四视图"
    result: passed
    evidence: |
      console errors: 0 / uncaught pageerrors: 0（全程）
      #/requirements -> 筛选器(All/proposal/implementation, All/pending…archived) + 两条记录 REQ-002(Sample proposal, PENDING)、REQ-001(Sample implementation requirement, IN_PROGRESS) + “Unreadable record files 1” 段：BROKEN.md / “the file must start with a YAML front matter (`---`)” / INVALID。点击 REQ-001 打开对话：KIND/STATUS/UPDATED/VERSION/PATH 元数据 + “Record text” 原文（含 front matter 与七段中文小节）。
      #/runs -> 显式空态 “No Tasks in this project yet.”（无模型、项目无 Task，属预期）。
      #/files -> 树根 .dev/ AGENTS.md/ README.md/ src/，#visibleFileCount=2，#filePath=“Select a file to preview.”；点 AGENTS.md → meta “MD · 122 B · 4930eae484a1”、7 lines、代码正文、active 高亮。展开 .dev→requirements 惰性加载 3 个 md（count=5）；搜索 “REQ-001” 收敛为 1 条；“zzz” 时 #fileTreeEmpty 显示、count=0；清空后恢复。
      #/docs -> 三条固定条目 AGENTS.md=present、.dev/INDEX.md=missing、.dev/PROJECT.md=missing；“Missing entries” 缺口段列出后两者；选中 AGENTS.md 渲染 markdown（<h1>/<p>/<ul>）；选中 .dev/INDEX.md 显示缺口卡片且无 markdown 元素。
key_evidence:
  - "四视图均以真实 RPC 数据渲染；夹具项目含 2 条合法需求 + 1 个非法文件 + 缺失的 .dev/INDEX.md 与 .dev/PROJECT.md，正好覆盖有效/无效/缺口三类真实形态"
  - "Runs 为空态系因无模型时项目没有 Task（read-only 视图仍正常渲染，符合验收前提）"
  - "i18n.json 合法 JSON，en 与 zh-CN 各 357 键、键集对称；四个视图引用的全部键命中，无未解析键"
not_covered:
  - area: "Runs 看板非空与 task.control / task.report.get 的实际点击"
    reason: "无模型 → 无 Task；需真实模型全链路，属 P4-i"
    disposition: pending
  - area: "npm test 原样命令在 browser/ 存在时通过"
    reason: "browser/*.spec.ts 为 P4-i（Playwright）并发产物，被 vitest 默认收集；属该切片范围"
    disposition: pending
result: passed
```
