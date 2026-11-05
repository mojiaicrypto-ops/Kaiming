# Plan · tools-and-images-20261022

状态:Approved(用户指令:「按照你的方案进行集成工具安装;还有给主管聊天界面增加上传图片的功能」)
流程:Plan → 实施 → 自查(tsc/vitest/browser acceptance)→ 真实模型与真实浏览器冒烟 → 文档与结算。

```yaml
plan:
  task: tools-and-images-20261022
  goal: >
    按调研结论集成三项基础工具(web_search、web_fetch、browser),并给主管会话增加
    图片上传:本地内容寻址存储、base64 交给 Pi、界面回放。不引入云存储、不新增业务状态。
  in_scope:
    - 附件存储:内容寻址 `<agentDir>/attachments/<sha256>`(png/jpeg/webp/gif,单张 ≤8MB,单条 ≤6 张)
    - 上传与读取路由:POST /api/v1/uploads(cookie + CSRF,原始字节);GET /api/v1/attachments/<id>(cookie)
    - 输入通道:`session.input.submit` 接受 `{type:'image', attachmentId}`;payload 只存引用
    - 运行时:`session.prompt(text, {images})`,图片以 base64 传入(不落 payload)
    - 回放:history / live snapshot / 实时事件把 image 块投影为 `{type:'image', id, mimeType}`
    - 三个工具 + 角色 allowlist + read Task 的浏览器只读降级
    - 前端:附件按钮、草稿缩略图、发送、消息内图片与工具结果图片渲染
  out_of_scope:
    - MCP、skills、语言服务、DAP、GitHub 工具
    - 浏览器 relay / 用户真实 Chrome / 登录态复用
    - 图片编辑、OCR、缩略图服务、云端存储
    - 文件类型的非图片附件
  steps:
    - id: S1
      change: 附件存储与嗅探(内容寻址、mime 校验、大小上限)
      paths: [devagent/src/server/attachments.ts, devagent/test/attachments.test.ts]
      verify: [vitest 通过;重复字节得到同一 id]
    - id: S2
      change: 上传/读取 HTTP 路由,含 cookie 认证、CSRF、大小与 mime 拒绝
      paths: [devagent/src/server/http.ts, devagent/src/server/main.ts, devagent/test/http-attachments.test.ts]
      verify: [未登录 401、无 CSRF 403、超限 413、成功后按 id 取回字节]
    - id: S3
      change: 输入通道接受图片引用;payload 只存 attachmentId;title 只取文本
      paths: [devagent/src/server/write-methods.ts, devagent/src/runtime/input-text.ts, devagent/test/input-payload.test.ts]
      verify: [payload 校验拒绝不存在的 id;文本提取跳过图片]
    - id: S4
      change: runner 以 base64 把图片随 prompt 交给 Pi(每张读盘,无缓存)
      paths: [devagent/src/runtime/runner.ts]
      verify: [真实模型冒烟:上传图片后模型描述图片内容]
    - id: S5
      change: 三处回放统一投影 image 块为附件 id(历史、快照、实时事件)
      paths: [devagent/src/server/history.ts, devagent/src/server/live-snapshot.ts, devagent/src/server/main.ts, devagent/src/server/image-projection.ts, devagent/test/image-projection.test.ts]
      verify: [同一字节落一次盘;快照不含 base64]
    - id: S6
      change: web_search(DeepSeek → DuckDuckGo 降级)
      paths: [devagent/src/tools/web-search.ts, devagent/test/web-tools.test.ts]
      verify: [无网络时返回 Error 文本而非抛异常;真实检索冒烟]
    - id: S7
      change: web_fetch(HTML→文本、上限、全文落盘)
      paths: [devagent/src/tools/web-fetch.ts, devagent/test/web-tools.test.ts]
      verify: [大页面只回上限字符 + 落盘路径]
    - id: S8
      change: browser(单工具多 action、每会话一个 Chromium、read Task 只读、截图进附件存储)
      paths: [devagent/src/tools/browser-tool.ts, devagent/test/browser-tool.test.ts, devagent/package.json]
      verify: [无 Chromium 时 BROWSER_UNAVAILABLE;只读模式拒绝 click;截图可读]
    - id: S9
      change: 角色 allowlist 与运行期注册
      paths: [devagent/src/runtime/tool-sets.ts, devagent/src/runtime/runner.ts, devagent/test/tool-sets.test.ts]
      verify: [read Task 仍只读;settler 没有联网与浏览器]
    - id: S10
      change: 前端附件与图片渲染
      paths: [devagent/webapp/src/chat/Composer.tsx, devagent/webapp/src/chat/ChatPage.tsx, devagent/webapp/src/chat/MessageItem.tsx, devagent/webapp/src/chat/ToolCard.tsx, devagent/webapp/src/chat/transcript-model.ts, devagent/webapp/src/state/slot.ts, devagent/webapp/src/state/normalize.ts, devagent/webapp/src/state/useSession.ts, devagent/webapp/src/api/rpc.ts, devagent/webapp/src/i18n/*]
      verify: [webapp tsc + 既有 vitest;浏览器验收:选图 → 缩略图 → 发送 → 消息内显示]
    - id: S11
      change: 文档同步(工具表、角色边界、UI 契约、gap-register、implementation-checks、README 依赖说明)
      paths: [docs/technicalnew/*, devagent/README.md]
      verify: [文档与实际工具名/授权一致]
  risks:
    - 浏览器二进制缺失或沙箱受限 → 工具返回 BROWSER_UNAVAILABLE,不阻塞其它工作
    - 图片使 Pi 会话文件增大(约 1.33×)→ 只接受图片、单张 ≤8MB,并在文档说明
    - keyless 检索受风控 → 结果标注 provider,失败降级为 Error 文本
```
