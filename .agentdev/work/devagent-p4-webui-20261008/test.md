# Test Report · devagent-p4-webui-20261008

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
result: passed
```
