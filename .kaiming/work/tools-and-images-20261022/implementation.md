# Implementation · tools-and-images-20261022

## 已实现

### 1. 图片输入与附件存储

| 件 | 位置 | 说明 |
|---|---|---|
| 内容寻址存储 | `devagent/src/server/attachments.ts` | `<agentDir>/attachments/<sha256[:32]>`；按字节嗅探 png/jpeg/webp/gif；单张 ≤8MB；同一字节只落一次盘；id 由字节决定，客户端不能选路径 |
| 上传/读取路由 | `devagent/src/server/http.ts`、`main.ts` | `POST /api/v1/uploads`（cookie + CSRF，原始字节）；`GET /api/v1/attachments/<id>`（cookie，`immutable`）。无 cookie 401，无 CSRF 403，非图片/超限 400 并带 `limit` |
| 输入通道 | `write-methods.ts`、`input-text.ts` | `content` 接受 `{type:'image', attachmentId}`（单条 ≤6 张，id 必须已存在）；payload 只存引用；`textOfPayload` 只看文本（标题不受影响） |
| 投递 | `runner.ts` | 读盘 → base64 → `session.prompt(text,{images})`；文件缺失时该输入 failed（`INVALID_ARGUMENT`），不静默丢图 |
| 私有目录豁免 | `tool-guard.ts`、`runner.ts` | `<agentDir>/work` 对文件读取工具放行（web_fetch 落盘页可 grep），凭证/数据库/会话文件仍拒绝，shell 命令仍不得提及私有目录 |
| 回放投影 | `image-projection.ts`、`history.ts`、`live-snapshot.ts`、`main.ts` | 历史、快照、实时事件三处统一把 image 块投影成 `{type:'image', id, mimeType}`；幂等；无法存储时输出 `[image omitted: …]` 而不是丢弃；浏览器响应**不含 base64** |
| 自定义 provider | `provider-store.ts`、`spikes/harness/model-config.ts` | 写入 `models.json` 时声明 `input:["text","image"]`——否则 Pi 按纯文本模型静默丢弃图片（真实模型检查先复现了这个现象） |

### 2. 三个工具（`src/tools/`）

| 工具 | 行为 |
|---|---|
| `web_search` | provider 链：DeepSeek `/v1/tools/search`（复用已配置 key，经 `PiRuntimeFactory.searchKey`）→ `BRAVE_API_KEY` → DuckDuckGo HTML（无凭证）。每个 provider 30s 上限；全部失败返回 `Error:` + 各原因，不抛异常；结果标注 provider |
| `web_fetch` | 仅 http/https；响应 ≤5MB；HTML→文本；全文落盘 `<agentDir>/work/<session>/web/<hash>.txt`，只回前 20k 字符（上限 60k）+ 路径 + 总字符数 |
| `browser` | 单工具 + action：open/observe/click/type/press/wait/screenshot/console/network/close；open 仅 http/https/data/about（拒绝 `file:`）；observe 给元素分配 `eN` 引用，click/type 只接受引用；截图写入附件存储并以 image 块返回；每会话一个 headless Chromium，空闲 10 分钟关闭，可显式 close；缺 Chromium 返回 `BROWSER_UNAVAILABLE` |

角色授权（`tool-sets.ts`）：chief/developer/reviewer/tester/investigator 三项全有，designer 只有 search/fetch，settler 都没有；read Task 保留三项。浏览器只读规则：read Task，或角色为 reviewer/investigator，宿主固定为只读动作（`FORBIDDEN`，且在启动浏览器之前拒绝）。

### 3. 界面

- Composer：添加图片按钮、草稿缩略图（可移除、上限 6）、上传失败显示服务端原因、只有图片也能发送。
- 消息与工具卡：图片以附件 URL 渲染，最大 520×360，点击新标签打开原图；工具结果图片显示在对应卡片里；`slot` 去重签名包含图片地址，`normalize` 把 `{id}` 拼成 `/api/v1/attachments/<id>`。
- i18n：`chat.attach`、`chat.attach.remove`、`chat.attach.limit`、`chat.attach.failed` 双语。

## 设计取舍

- **不存 base64**：payload 与浏览器响应都只有 id；base64 只在 runner 投递给 Pi 的那一刻存在。
- **内容寻址而非附件表**：上传、历史回放、工具截图三个写入方不需要共享状态就得到同一 id；重复写入是幂等 no-op。
- **一个 browser 工具而不是 eval 门面**：产品没有代码执行场景，10 个命名动作覆盖观察/交互/证据。
- **不接用户真实浏览器**：relay 需要扩展与登录态授权，首版不碰。
- **web_fetch 必须落盘**：实测一个 Playwright 文档页 975KB HTML → 158k 字符（≈40k tokens），只回头部、全文给 grep/read。

## 已知边界

- 截图以 base64 进入 Pi 会话文件，JSONL 会按约 1.33× 增长；只接受图片、单张 ≤8MB。
- `web_search` 无 key 时用 keyless DuckDuckGo，受风控时降级为失败说明；不自动重试。
- `browser` 只验证 headless Chromium 路径；Linux 服务器需要先 `npx playwright install chromium`（README 已写）。
