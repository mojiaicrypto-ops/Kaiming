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

## 后续切片（计划内，未开始）

```yaml
pending: [P4-b 只读查询面, P4-c 写入与执行面, P4-d SSE, P4-e 交互桥, P4-h0 渲染库试验, P4-f 设计系统与外壳, P4-g 业务页面, P4-h 流式渲染部件, P4-i 浏览器验收]
```
