# 基础工具预集成调研(2026-10-22)

目标:回答"作为基础 code agent,除了文件/Shell 之外必须预装什么",范围限定在**需求调研**与**研发/验收过程**两条链路。只做调研与候选清单,不改代码,不新增业务对象。

## 1. 现状盘点(有证据)

| 层 | 已有能力 | 证据 |
|---|---|---|
| Pi 原生 | `read`(文本+图片)、`write`、`edit`、`bash`、`find`(glob)、`grep`、`ls`、`powershell` | `devagent/node_modules/@earendil-works/pi-coding-agent/dist/core/tools/` |
| 原生 `read` 边界 | 只读文件系统:支持 jpg/png/gif/webp/bmp 附件,不支持 http(s) URL | `dist/core/tools/read.js:37` 描述仅"file contents" |
| 域工具 | `task`、`requirement`、`project`、`agent_report`、`question` | `devagent/src/tools/*.ts`、`src/runtime/tool-sets.ts:57` |
| 授权模型 | 角色 × Task 类型的静态 allowlist;read Task 去掉 `write/edit/bash` 与写域工具 | `src/runtime/tool-sets.ts:27-107` |
| 加载点 | `extensionFactories` + `customTools` 已接入,新增工具即注册 | `src/runtime/pi-runtime.ts:150-175` |
| Pi 扩展面 | `registerTool` / `registerMcpServer` / skills / hooks | `docs/extensions.md:69-88`、`docs/mcp.md:32` |
| 缺口 | 无联网检索、无 URL 取文、无浏览器操作、无语言服务/调试器 | 全仓库无相关工具注册 |

结论:**"联网"与"看真实页面"是当前零覆盖**,且测试角色只能自己写 Playwright 脚本(耗轮次、易错);`reviewer`/`investigator` 连 `bash` 都没有,连脚本都跑不了。

## 2. 候选总表

| 优先级 | 工具 | 解决什么 | 个人判断 |
|---|---|---|---|
| **P0** | `web_search` | 需求调研查事实/库文档/报错/选型 | 必须。零成本可用,已在现有 key 下实测 |
| **P0** | `web_fetch` | 把 URL 变成可读文本并落盘给 `grep`/`read` | 必须,与 search 不可分。原生 `read` 不支持 URL |
| **P0** | `browser` | E2E 与 UI 证据(截图/控制台/网络/交互) | 必须。Playwright 已在依赖里,实测可用 |
| P1 | `lsp`(仅 diagnostics) | 编辑后立即拿类型/语法错误 | 暂缓:`bash` 跑项目自带检查已覆盖;多语言服务生命周期成本高 |
| P1 | `repo_diff`(宿主方法,非模型工具) | 给 `reviewer`/`investigator` 看改动 | 值得做:`reviewer` 无 bash,现在只能逐文件读;走 Server 只读方法更安全 |
| P2 | `ast_grep` 结构搜索 | 跨文件精确重构 | 等真实误改证据;`grep`+`read` 足够 |
| P2 | `debug`(DAP) | 断点/变量 | 与"测试+日志即证据"的交付模型不匹配 |
| P2 | `github`(gh CLI 包装) | PR/Issue/Actions | `bash` 调 `gh` 已可用;等用户提出远端协作需求 |
| 不做 | `todo`/`checkpoint`/`rewind` | 规划与回溯 | 宿主已有 Task 阶段/步骤与 Session 结构,重复且会冲突 |
| 不做 | `memory`/`retain`/`recall` | 长期记忆 | 违反 K-01/K-03:项目知识只有唯一权威正文(文档) |
| 不做 | `computer`(桌面控制)、`generate_image`、`tts`、`ida` | — | 与交付目标无关 |

## 3. P0 设计草案

### 3.1 `web_search`

- 参数:`query`(必填,支持 `site:`/`after:` 等 Google 式算子按提供方能力透传)、`recency?`、`limit?`。
- 返回:`title / url / published? / snippet` 列表(每条 ≤240 字符),`provider` 字段如实标注来源;无结果/失败返回 `Error: ...` + 原因,**不抛异常**。
- 提供方链(按可用性降级,规则固定、可解释):
  1. DeepSeek `POST https://api.deepseek.com/v1/tools/search`(复用 `config/model.json` 里的 key;单次 ≤50 条,query ≤128 字符);
  2. 无 key 时 DuckDuckGo HTML 前端(keyless,无需网络凭证);
  3. 预留 `BRAVE_API_KEY` / `TAVILY_API_KEY` 环境变量直连(只读环境变量,不加配置 UI)。
- 每个提供方 30s 上限,失败即降级并记录尝试过的提供方。

### 3.2 `web_fetch`

- 参数:`url`(http/https)、`selector?`(CSS,可选)、`max_chars?`(默认 20000,上限 60000)。
- 行为:抓取 → 去 script/style/nav → 文本化 → **全文写入** `<agentDir>/work/<session>/web/<hash>.txt` → 返回前 `max_chars` 字符 + 落盘路径 + 总字符数。
- 为什么必须落盘:实测一个 Playwright API 页 HTML 975,536 字节 → 正文 158,246 字符(≈40k tokens),直接进上下文会撑爆;落盘后模型用 `grep`/`read` 精读,上下文只付一次摘要范文。
- 安全:只允许 http/https;禁止 `file:`、`data:`;响应上限 5 MB;`Set-Cookie` 不保留、不复用凭证;私有网段允许(本机开发站点需要),但要在工具结果里标注"内网地址"。

### 3.3 `browser`

- 形态:**一个**工具 + `action` 分派(不做 omp 那种 eval 门面,产品没有代码执行场景):
  `open{url,viewport?}` / `observe{selector?}` / `click{ref}` / `type{ref,text}` / `press{key}` / `wait{selector|text,timeout?}` / `screenshot{fullPage?}` / `console{}` / `network{}` / `close`。
- `observe` 返回可交互元素的**编号 + role + name + 文本**,模型用编号操作(不生成脆弱选择器)。
- 截图:PNG 写入 `<agentDir>/work/<session>/browser/<n>.png`,同时以 image 内容块返回(模型能看);尺寸按模型 `inputLimits.images.resize` 缩放,与原生 `read` 一致。
- 生命周期:每会话一个 headless Chromium,`session.dispose()` 关闭;空闲 10 分钟回收;崩溃后重开。**不接**用户真实 Chrome(relay),第一版不碰登录态与用户浏览器。
- 授权:进入 read Task 时降级为只读动作(`open/observe/screenshot/console/network/close`),禁止 `click/type/press`,由宿主在注册时按 `taskType` 固定,模型无法自我提权。
- 依赖:`@playwright/test` 目前是 devDependency,需把运行时浏览器依赖转为 `playwright-core` + 文档化 `npx playwright install chromium`;无 Chromium 时工具返回 `BROWSER_UNAVAILABLE` 而不是假装可用。

### 3.4 角色授权建议

| 角色 | web_search | web_fetch | browser |
|---|---|---|---|
| chief | ✓ | ✓ | ✓ |
| designer | ✓ | ✓ | – |
| developer | ✓ | ✓ | ✓ |
| reviewer | ✓ | ✓ | ✓(只读动作) |
| tester | ✓ | ✓ | ✓ |
| settler | – | – | – |
| investigator | ✓ | ✓ | ✓(只读动作) |

三者都不改项目文件,不参与 `projectReadOnly` 判定;read Task 保留(read Task 去掉的是 shell 与写工具)。

## 4. 实测证据

| 检查 | 结果 |
|---|---|
| DeepSeek 检索(现有 key,`/v1/tools/search`) | 200,返回 `results[]`(title/url/site_name/summary 含 Markdown 正文片段) |
| DuckDuckGo HTML(keyless) | 200,10 条结果,无风控页 |
| Playwright 截图(本机已缓存 Chromium) | headless 启动+导航+截图 1.27s,PNG 62,834 字节 |
| 单页正文体量 | Playwright `Page` 文档页 975 KB HTML → 158,246 字符正文 |
| MCP 备选包存在性 | `@playwright/mcp@0.0.83`、`chrome-devtools-mcp@1.11.0`、`tavily-mcp@0.2.22` |

## 5. 实现形态取舍

| 方案 | 优点 | 代价 | 结论 |
|---|---|---|---|
| 宿主自定义工具(与 `task`/`requirement` 同路) | 可进角色 allowlist、可测试、证据格式统一、无额外进程 | 由我们维护 | **P0 采用** |
| MCP 服务器(Pi 原生,`<agentDir>/mcp.json`) | 零代码,用户可换 | 工具名 `mcp__*` 进不了现有授权表、每会话多进程、认证与失败语义不受控 | 作为**高级开关**写进 README,不做 UI |
| bash + curl / bash + playwright 脚本 | 现在就能用 | 每轮重写脚本、无统一证据、失败排查贵 | 保留为兜底 |

## 6. 需要同步修订的正式文档

1. `docs/technicalnew/agents-and-tools.md` 工具表(新增三工具与角色授予、只读降级规则);
2. `docs/technicalnew/prompts/{chief,designer,developer,reviewer,tester,investigator}.md` 的工具使用边界(何时查外部、证据如何落盘);
3. `docs/technicalnew/ui-design.md` + 前端:转录目前**不渲染工具返回的图片**(`webapp/src/chat/` 无 image 分支),截图要么补图片渲染,要么第一版只给文件路径;
4. `docs/technicalnew/gap-register.md`:新增"N 无联网/无浏览器"条目并在实现后关闭;
5. `docs/technicalnew/implementation-checks.md`:补三条验证(P-07 检索、P-08 取文、P-09 浏览器 E2E)。

## 7. 未决事项(进 Plan 前需定)

1. 截图在界面上怎么呈现:补图片渲染,还是只落盘给路径(第一版更省);
2. `web_search` 是否允许未经用户配置就用 keyless DuckDuckGo(涉及出网与隐私,建议**默认允许并在结果里标注提供方**);
3. `browser` 是否允许访问内网/本机端口(开发验证必需,建议允许)。
