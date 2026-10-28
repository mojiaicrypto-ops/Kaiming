# 外部 Agent 接入（MCP）实现契约

产品行为唯一依据：[外部 Agent 接入](../productnew/modules/external-agents.md)（X-01～X-08）。本页定义它的实现面：传输、工具、run 标识、状态推导、错误与验证。**它不新增业务规则**：委派就是一次用户输入，Task 类型与阶段由主管按 D-04 判断。

## M1 形态与进程

| 项 | 决定 |
|---|---|
| 入口 | `npm run mcp`（`node src/mcp/main.ts`）：stdio MCP，被 Codex / Claude Code / Grok 作为子进程拉起 |
| 常驻端点 | 同一个 Server 上的 `/mcp`（Streamable HTTP），与浏览器共用进程、router、store |
| 唯一 Server | stdio 进程按顺序找**已有**的实例：显式 `AGENTDEV_MCP_URL` → `${dataDir}/mcp-instance.json` 里活着且应答的实例 → 已服务 `AGENTDEV_PORT` 的 workbench；都没有才自己启动（绑 `AGENTDEV_PORT`，不是临时端口）并在 `mcp-instance.json` 记录 pid+origin，退出时删除。记录在案但不应答的活 pid 一律**拒绝**，不另开一个库 |
| 附着 | `AGENTDEV_MCP_URL` + `AGENTDEV_ACCESS_PASSWORD`；附着时通过回环 RPC 调用，与浏览器同一条公开接口 |
| 项目 | `AGENTDEV_MCP_PROJECT`（stdio）或工具参数 `project_path`；stdio 缺省取进程 `cwd`。`/mcp` 服务多个项目，因此**必须**带 `project_path`（除非部署时设置了 `AGENTDEV_MCP_PROJECT`），不继承服务进程的 cwd。一律走 `project.open` 的 realpath 唯一约束 |
| stdout 纪律 | stdio 的 stdout 只出现 JSON-RPC 消息；诊断只走 stderr（传输规范要求） |
| 固定会话 | 首次委派 `session.open{projectId, channel:'mcp'}`；之后一直复用。这是对「其他话题开新主管 Session」的**产品级例外**，见 X-02 |

代码：`src/mcp/{main,protocol,http,control,runs}.ts`；进度推导 `src/runtime/task-progress.ts`。

## M2 协议版本与能力

| 项 | 值 | 理由 |
|---|---|---|
| 服务版本 | `2025-11-25`、`2025-06-18` | 实测：Codex 0.155.1 协商 `2025-06-18`，Claude Code 2.1.310 先探测 `server/discover` 再协商 `2025-11-25` |
| 版本选择 | 请求版本受支持就用它；否则返回我们支持的**最高**版本（规范：highest ≤ requested） | 不声称支持 `2026-07-28`（去 session 的 draft 世代） |
| `server/discover` | 应答支持的版本、`tools` 能力、`serverInfo` | 让新世代客户端探测后向下协商，而不是握手失败 |
| Server 能力 | `tools.listChanged=false` | 工具表静态 |
| 已实现方法 | `initialize`、`server/discover`、`ping`、`tools/list`、`tools/call` | 无 `resources`、`prompts`、`sampling`、`roots`、MCP server 连接 |
| 通知 | `notifications/progress`（仅当请求带 `_meta.progressToken`；`wait` 在状态变化时发） | 长等待里让宿主看到活的东西 |
| 客户端交互 | 不主动发 `elicitation/create`：无人值守的客户端会 `decline`/`cancel`（实测），提问一律走 `pendingQuestion` + `agentdev_answer` | 不把"没人回答"误当成拒绝 |

## M3 工具面

工具描述与 schema 是模型可见的系统文本，用英文（G4）。全部工具返回 `structuredContent` + 同内容 JSON 文本（老客户端只读文本）。

| 工具 | 内部调用 | 注意 |
|---|---|---|
| `agentdev_delegate` | `project.open` → `session.open{channel:'mcp'}` → `session.input.submit` | 委派正文写清 caller/目标/边界/mode/验收；`authorizationRef` 就是这次 inputId；`wait_seconds` 0–45 |
| `agentdev_status` | `session.input.get{projectId,inputId}` → `session.get` → `task.get`/`task.list` → `interaction.list` | 见 M4 |
| `agentdev_wait` | 每 1s 重读一次 status，状态变化或到点返回 | 结束返回不是错误 |
| `agentdev_tell` | `session.input.submit{taskId}` | 只对已有 Task 的 run 有效 |
| `agentdev_answer` | `interaction.list` → `interaction.respond` | confirm 需 boolean；select/input 用文本 |
| `agentdev_cancel` | `session.input.stop` + `task.control{cancel}` | 两个终态都核对过才回 |
| `agentdev_read` | `task.report.get` / `task.get{includePlan}` / `session.messages.list` / `project.files.list` | transcript 只返回本 run 的条目（固定会话共享，见 M6） |
| `agentdev_runs` | `task.list` → 每项带 `runId`（由 `sourceInputId` 派生） | 断线后找回已接纳的 run，不重复委派；只列 Task——主管直接回答的委派没有 Task，也就没有要续的工作 |
| `agentdev_projects` | `project.list` | 只读，不读项目文件 |
| `agentdev_requirements` | `requirement.list` / `requirement.get` | 非法文件如实列为问题项 |

## M4 run 标识与状态推导

- **runId** = `${projectId}:${inputId}`（不透明；可逆，所以重启后仍可解析，不需要额外映射表）。`projectId`/`inputId` 都不含 `:`。
- **Task 归属**：`session.input.get` 回 `taskId`（该输入创建 Task 时会写入 `tasks.sourceInputId`）；未写入时按 `task.list` 找 `sourceInputId === inputId`。输入仍在跑时退化为会话的 `currentTaskId`。
- **状态**：

| 输入/工作事实 | run 状态 |
|---|---|
| 输入 `queued` | `queued`（`waitingForTask` 说明挡在前面的 Task） |
| 输入 `processing`，Task `paused`/`pausing` | `paused` |
| 输入 `processing`，有 pending question | `waiting_user` |
| 输入 `processing` 否则 | `running` |
| 输入 `completed`，无 Task | `completed`（主管直接回答） |
| 输入 `completed`，Task `completed` | `completed` |
| 输入 `completed`，Task `cancelled` | `cancelled` |
| 输入 `completed`，Task 仍 active/waiting | `waiting_user`（主管结束本轮、任务未收口） |
| 输入 `failed` / `stopped` / `interrupted` | `failed` / `cancelled` / `unknown` |

- **步骤**（`steps`）：`src/runtime/task-progress.ts` 的 `taskProgress`，规则与浏览器任务条/清单完全一致（阶段-轮次、返工即新一轮、计划尾段），`stepsDone/stepsTotal` 由它给出。两个包共用 `test-fixtures/task-progress.json`，各跑一个单测钉住。暂停/取消/完成的 Task 不再列出计划尾段。
- **通过与否**：`memberPassed` 是**共享规则**（`src/runtime/task-progress.ts`，浏览器 `task-flow.ts` 与成员行用同一谓词）——输入正常结束且最新报告不是 `failed`/`blocked` 才算通过；`src/mcp/runs.ts` 只把 `task.get` 的结果映射成每个成员的 `latestVerdict`。因此"输入正常结束但复核未通过"在两个接入面都不会显示成勾，与 X-04「是否有未通过的报告」一致。
- **执行情况未知**：`status=unknown`、`complete=false`，`summary` 明确写「需在浏览器核实真实状态」；不自动重放、不把未知当完成，调用方可以用 `cancel` 收尾。
- **排队说明**：`awaiting` 取 `queued`（会话还有未结束工作）、`blocked`（有阻断原因，如无可用模型）、`user`（有待答问题）、`none`；`waitingForTask` 给出挡在前面的 Task（可取消、可读），`summary` 同时带上 `session.blocked` 的真实原因，不用"等会话空闲"掩盖"缺模型"。

## M5 传输与鉴权

| 传输 | 鉴权 | 细节 |
|---|---|---|
| stdio | 父进程继承 `AGENTDEV_ACCESS_PASSWORD`，用于附着/自启 workbench 与登录回环 RPC | 不落盘、不进工具结果与日志 |
| `/mcp` | `Authorization: Bearer <访问口令>` 或浏览器同源 cookie | 未认证 401；`Origin` 不合法 403（复用同源判断） |
| `/mcp` 方法 | `POST`（单条或 batch）、`DELETE`（结束会话 → 204） | `GET` 返回 405：本实现不在请求之外推送 |
| 会话 | `initialize` 发 `Mcp-Session-Id`；每次带该头的请求都会刷新空闲时间；未知会话 404（客户端重新握手）；60 分钟**空闲**过期 | `MCP-Protocol-Version` 出现但不认识 → 400 |

## M6 已知边界（与产品文档一致，不许实现偷偷放宽）

1. **固定会话是共享的**：同一项目的多个调用方落在同一条会话里。`read(kind=transcript)` 只返回本 run 的条目（按 `inputId` 过滤；仅当整段条目都没有关联时才退回尾部，绝不把别人的回合当成自己的）；上下文本身对后续委派可见——这是 X-02 的语义。
2. **一个会话同时只有一项未结束 Task**：并发委派排队；卡住的 Task 挡住整个项目，程序不自动取消。
3. **上下文会被压缩**：不作 `usage_update`（没有会话级用量），也不发 `compaction_*`（不声明该能力）；权威事实是报告与 Plan。
4. **只读委派不是硬保证**：`mode` 只是指令，Task 类型由主管判断（X-03）。调用方的沙箱不约束工作台（X-08）。
5. 任务级进度靠 `task.get` 轮询（1s），不消费 SSE：`invalidate` 推送只在浏览器侧使用。轮询成本是一次本地 SQLite 读。

## M7 错误映射

业务拒绝是**工具结果** `{isError:true, content:[{type:'text',text:"CODE: message"}]}`（模型可读、可继续），不是 JSON-RPC 错误：

| R6 code | 表现 |
|---|---|
| `INVALID_ARGUMENT` | 参数或模式不合法（含 channel 名、question 类型不匹配） |
| `NOT_FOUND` | run/input/Task/项目不存在 |
| `INTERACTION_STALE` | 问题已被答复或随输入结束 |
| `REPORT_MISSING` | 没有报告/Plan 可读 |
| `UNAUTHORIZED` | 口令错误（stdio 启动即失败；`/mcp` 401） |
| 其余 | 真实 code + message，不吞 |

协议级错误只用于传输问题：`-32700` parse、`-32600` invalid request、`-32601` unknown method、`-32602` invalid params、`-32603` internal。

## M8 Server 侧的配套改动

| 改动 | 位置 | 说明 |
|---|---|---|
| `sessions.channel`（v14→v15，加列 + 部分唯一索引） | `src/store/store.ts` | 空值不受限；既有行不变 |
| `session.open{projectId, channel}` | `src/server/read-methods.ts` | 幂等；并发靠唯一索引，输的一方返回已存在的那条 |
| `session.list` 返回 `channel` | 同上 | 浏览器可标注固定会话 |
| `interaction.list{projectId, sessionId}` | 同上 | 无需实时订阅即可读到待答问题 |
| `session.input.get` 支持只给 `inputId`，并返回 `sessionId`/`taskId` | 同上 | 外部调用方只有 runId |
| `task.get{includePlan}` 返回 Plan 正文；`task` 摘要含 `sourceInputId` | 同上 | run→Task 归属是保存的事实 |
| `POST /mcp` 与 `AuthService.verifyPassword` | `src/server/http.ts`、`auth.ts` | bearer 与 cookie 并存 |

## M9 验证

| 层 | 入口 | 结果 |
|---|---|---|
| 单元 | `test/mcp-protocol.test.ts`（版本协商、`server/discover`、工具表与注解、未知方法/工具、业务拒绝为工具结果、transcript 过滤、进度 token 门控）、`test/mcp-runs.test.ts`（排队原因、阻断、暂停后取消、报告未通过、未知状态、`/mcp` 必须点名项目） | 8 + 6 passed |
| 迁移与会话 | `test/store.test.ts`（v14→v15）、`test/server-read.test.ts`（`session.open` 幂等/通道名校验/`session.list.channel`、`interaction.list`） | 通过 |
| 端到端（真进程） | `test/mcp.test.ts`：起真 workbench（stub 模型）→ spawn `src/mcp/main.ts` → initialize/tools/list/delegate/status/read；第二条脚本化 `task(op=create)` 验证 Task/Plan/步骤/取消；`test/mcp-instance.test.ts`：重启带未完成工作（stdout 只有协议）、第二个客户端附着同一实例、运行归属可跨客户端读 | 2 + 1 passed |
| HTTP 端点 | `test/mcp-http.test.ts`：401/403、initialize 发会话、tools/list、只读调用、202 通知、未知版本 400、未知会话 404、DELETE、GET 405 | 3 passed |
| 真实客户端（人工门禁） | Codex 0.155.1 与 Claude Code 2.1.310 各委派一次，读回 stub 模型的答复 | 见 validation 记录 |
