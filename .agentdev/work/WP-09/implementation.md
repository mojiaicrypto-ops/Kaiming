# WP-09 实现记录（完整Web工作台）

- planVersion: 1（`.agentdev/work/WP-09/plan.md`）
- 依赖：WP-01/WP-03、WP-04～WP-08（基线 WP-08 结算 `d6c766b`，代码树 `7422646`）
- 新增 workspace：`packages/client`（`@agentdev/client`）、`apps/web`（`@agentdev/web`）⇒ 工程由 10 个 workspace 变为 **12**（pnpm 口径 13 个项目）；UI 为**零依赖**静态资源 + 原生 JS（不引入 React/Fastify/ws）。

## T1 客户端（AC-054/AC-078）

- `packages/client/src/connection.ts`：`Transport` 接缝（内存双工可测）与 `WebSocketTransport`（Node 内建 `WebSocket`，Origin/Cookie 握手头、未开先入队、单次关闭上报）、`SocketSession`（请求-响应关联、可断线重持、畸形信封拒绝）、`ClientError`（原样保留契约错误码 + 传输码）、可注入 `Timers`、有界指数退避（1s/2s/4s）、`closeCodeToError`（1008 ⇒ NOT_AUTHORIZED）。
- `commands.ts`：`ProtocolConnection` 状态机 `connecting → open → reconnecting → closed`；`connection.hello` 每次重连重放；写命令要求 `idempotencyKey` + `expectedVersion`，`BUSY` 退避重试，丢失响应按**同一请求 id 与幂等键**重放并回报 `WriteReceipt.replayed`；`UNAUTHENTICATED`/`AUTH_EXPIRED`/`NOT_AUTHORIZED` 一律不重试且停止重连。
- `subscriptions.ts`：快照 + `afterCursor` 重放、客户端水位去重、`resume(since)` 精确补齐、`batch_end.scannedThrough`、`RESYNC_REQUIRED` 重新订阅、scope 变更取新快照、本地越权/跨 Project 订阅在发出前拒绝。
- 回归网：43 单元 + 6 集成（真实 loopback RFC6455 套接字）。

## T2 daemon 协议面（接真实 Core）

- `apps/daemon/src/protocol.ts`：`WorkbenchProtocol` 负责信封（`{v,type,id,method,projectId?,params}`）、错误码到 HTTP 状态映射、全部查询（projects/project.open/project.snapshot.get/conversation.list|get/knowledge.list|get/board/work.list|get/requirement.list|get/run.list|get/artifact.list|get|download.prepare/inbox/agents/settings/config.get/ui.translate）与命令（conversation.message.send、work.control、requirement.save(+retry)、requirement.continue、plan.approve（过期拒绝并带当前版本）、finding.submit、decision.resolve、config.save、config.test、backup.run、restore.run），全部读写真实 `ProjectStore`/`EventHub`/Core 服务。
- `/ws` 升级先校验 Origin + 会话 Cookie（或 Bearer），`connection.hello` 必须先行；`project.subscribe`/`subscription.set`/`subscription.remove`/`project.events.ack` 基于真实 `EventHub`，按连接水位无重复无缺口重放；跨 Project 订阅拒绝且不产生快照；断连只丢内存簿记，后台 Work 继续。
- 线协议为 Node 内建实现的最小 RFC6455 文本帧编解码（不新增 `ws` 依赖）。`server.ts` 扩展 `/rpc`、`/auth/login`、`/auth/logout`、`upgrade` 监听与关闭钩子；既有路由行为不变（单测证明旧状态码未移动）。
- 回归网：`apps/daemon/test/protocol.integration.test.ts`（21 例，真实 SQLite + 真实 WS）。

## T3 Web BFF 与工作台 UI（AC-068～078、AC-084）

- `apps/web/src/**`：零依赖 BFF（Node 内建 `http`）：HttpOnly BFF 会话 + 精确 Origin 写校验 + `/rpc` 代理 + 每浏览器 `/ws` 桥（id 映射、水位续订、有界重连）+ 只读项目文件访问（`files.ts`：目标 revision、根边界、截断/二进制判定）。
- `apps/web/src/{views,pages,shell,html,i18n}.ts` + `public/{app.js,styles.css}`：九面（Chief/看板/详情/Docs·Files/Agents/Settings/Inbox/Runs/Live）服务端渲染真实数据；面板三态（`#shell[data-panel-mode]`）跨页共享并在顶栏恢复、窄屏焦点顺序、非 Chief 页无创建/切换控件（深链 Chief）、ARIA/键盘/220 条中英词条且项目内容不翻译、决定按目标版本去重与过期禁用、Plan 过期禁用并显示版本、产物截断提示 + 一次性完整下载、Provider 校验失败保留输入且活动 revision 不变、附件首条消息原子绑定。
- 回归网：78 单元 + 17 集成（真实 daemon + 真实 SQLite + 真实 BFF）。

## T4 端到端与必需失败测试

- `apps/web/test/workbench.integration.test.ts`（12 例）与 `workbench-failures.integration.test.ts`（7 例）：九面真实读数、Chief 路由、Queued 无 Work 取消、L1 不入板、过期 Plan 拒绝、截断产物一次性下载、分支预览根边界、Inbox 去重与过期禁用、Provider 失败保留输入、需求保存仅在 Git 与投影一致后可见、AC-087～090 路径；六项必需失败测试逐字命名：**持续对话、过期卡片、窄屏焦点、断连、配置失败、订阅扩大**。

## T5 验证与本轮状态

- 契约命令：`pnpm typecheck` 0；`pnpm lint` 0；`pnpm test:unit` **54 文件 / 1096 用例**；`pnpm build` **12 workspace**；`pnpm test:integration --maxWorkers=4` **25 文件 / 296 用例**（默认并发在宿主高负载下偶发无关超时，已用有界并发复验）。
- 已登记残余（供 Review/Test 判定）：
  1. **T2 协议面缺口**（由 T3/T4 依实现发现，未越权修改）：`conversation.create` 未实现（Chief 新建对话控件不渲染）；`requirement.archive/restore` 未实现（看板归档按钮不渲染）；`file.list`/`file.read` 由 BFF 只读端口实现而非 daemon；Queued 取消依赖 `RequirementSaveService` 未装配（诚实返回 `INVALID_STATE`，不伪造成功）。
  2. `requirement.save` 新建记录须省略 `requirementId`（协议 §8 Core owns the id）；`scope` 必须显式给出；`cancelRequirement` 写出的 `content.md` 缺六段标题导致真实 Git 服务拒绝（诚实拒绝，分支不动）。
  3. `create/save` 的 `expectedAbsent` 与记录版本由协议内部推导，wire 上「同版本异内容」冲突不可达；`conversation.get` 不返回 `attachmentIds`；`requirement` 投影无 `contentMarkdown`，详情页不展示正文。
  4. 浏览器侧 DOM 行为未在真实/无头浏览器执行（仓库无 Playwright/jsdom 且不允许新增依赖）：以投影单测 + 真实 SSR + 真实 HTTP/WS 集成替代；像素/焦点级证据留 WP-10。
  5. `apps/web` 需在接线时声明 `@agentdev/client` 依赖（当前 BFF 用自家桥，未直接依赖 client 包）；`root eslint.config.js` 增加浏览器 globals 块（否则客户端脚本 lint 失败）。
