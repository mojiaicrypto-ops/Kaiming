# Test · tools-and-images-20261022

执行日期 2026-10-22。命令都在 `devagent/` 下运行。

## 自动化

| 命令 | 结果 | 覆盖 |
|---|---|---|
| `npx tsc --noEmit` | 无输出 | 服务端全部改动（含新工具、附件、投影） |
| `cd webapp && npx tsc --noEmit` | 无输出 | 前端图片块与上传 |
| `npx vitest run` | 32 files / 339 tests 通过 | 新增 `attachments`(10)、`http-attachments`(4)、`web-tools`(8，含流式上限)、`browser-tool`(7，含 `file:` 拒绝)、`input-payload`(3)、`external-tools-runtime`(5，含 reviewer 只读、grep 落盘页)、`tool-guard`(+1 工作区豁免)；既有用例全绿 |
| `npm --prefix webapp test` | 26 通过 | 含「工具结果图片与消息图片分块」新断言 |
| `npm run test:browser` | 31 通过（21.6s） | 新增两条：上传图片（缩略图 → 消息内 → 刷新后仍在，`naturalWidth > 0`）、browser 工具截图（真实 Chromium，卡片内图片、认证路由 200、刷新后仍在） |

## 真实模型（`npm run check:tools`，provider deepseek/deepseek-flash）

| 检查 | 结果 |
|---|---|
| 模型真的调用 `web_search` 并拿到真实来源 | PASS —— `provider: deepseek`，返回 playwright.dev URL |
| `web_fetch` 失败如实上报 | PASS —— `Error: … {"code":"STORAGE_UNAVAILABLE","url":"http://127.0.0.1:1/never"}` |
| 模型驱动 browser 打开/观察/截图 | PASS —— `calls=2 observed=true screenshots=1`，回答 `OnlyButton`，截图可从附件存储读回 |
| 图片输入（红块 64×64） | PASS —— 模型回答「红」 |

## 手动核对

| 项 | 观察 |
|---|---|
| 附件路由鉴权 | 无 cookie 401；无 CSRF 403（`test/http-attachments.test.ts`） |
| 路径穿越 | `../../etc/passwd` 不是 id → 404（同上） |
| base64 不泄漏到浏览器 | 快照/历史/实时事件投影后只有 `{id, mimeType}`（`test/attachments.test.ts`、`browser/acceptance.spec.ts` 断言 src 形状） |
| 静默丢图 | 先由真实模型复现（provider 未声明 `input` 时模型说「图片被省略」），修复后同检查通过 |

## 未覆盖 / 未执行

- Linux 服务器上首次安装 Chromium 的路径未实测（本机已有 Playwright 浏览器缓存）。
- `web_search` 的 Brave 分支无凭证，未实测；DuckDuckGo 风控降级只有单测（伪造 anomaly 页面）。
- 浏览器 relay/用户真实浏览器按范围不做，未测。
- 独立 Review/Test Agent 未在本会话内运行（本轮以自动化与真实模型检查为证据）。


## 独立 Review 发现与修复

| 编号 | 现象 | 修复 | 证据 |
|---|---|---|---|
| H1 | `browser open` 接受 `file:`，read Task 可把 `<agentDir>/models.json` 读进转录 | open 仅允许 http/https/data/about，其余 `INVALID_ARGUMENT` | `browser-tool.test.ts`「refuses to open a local file」 |
| H2 | `web_fetch` 落盘在 `<agentDir>/work`，被私有路径守卫拒绝，模型无法 grep | 守卫增加 `readableDirs`（仅文件读取工具；命令仍拒绝）；runner 传 `<agentDir>/work` | `tool-guard.test.ts`、`external-tools-runtime.test.ts`「lets the model grep the page web_fetch saved」 |
| H3 | reviewer 在写 Task 内拿到可点击的浏览器 | readOnly 判定加入 reviewer/investigator 角色 | `external-tools-runtime.test.ts`「keeps a reviewer read-only in a write Task」 |
| M1 | 体积上限在 `arrayBuffer()` 之后才检查（chunked 无 content-length） | 新增 `readCapped` 流式读取并取消；web_fetch 与 DDG 页面都用它 | `web-tools.test.ts`「caps a chunked body while reading」 |
