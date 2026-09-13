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
- 已登记残余（供 Review/Test 判定；§T5 已按第一轮独立 Review 结清下表条目）：
  1. **T2 协议面缺口**（由 T3/T4 依实现发现，未越权修改）：`conversation.create` 未实现（Chief 新建对话控件不渲染）；`requirement.archive/restore` 未实现（看板归档按钮不渲染）；`file.list`/`file.read` 由 BFF 只读端口实现而非 daemon；Queued 取消依赖 `RequirementSaveService` 未装配（诚实返回 `INVALID_STATE`，不伪造成功）。
  2. `requirement.save` 新建记录须省略 `requirementId`（协议 §8 Core owns the id）；`scope` 必须显式给出；`cancelRequirement` 写出的 `content.md` 缺六段标题导致真实 Git 服务拒绝（诚实拒绝，分支不动）。
  3. `create/save` 的 `expectedAbsent` 与记录版本由协议内部推导，wire 上「同版本异内容」冲突不可达；`conversation.get` 不返回 `attachmentIds`；`requirement` 投影无 `contentMarkdown`，详情页不展示正文。
  4. 浏览器侧 DOM 行为未在真实/无头浏览器执行（仓库无 Playwright/jsdom 且不允许新增依赖）：以投影单测 + 真实 SSR + 真实 HTTP/WS 集成替代；像素/焦点级证据留 WP-10。
  5. `apps/web` 需在接线时声明 `@agentdev/client` 依赖（当前 BFF 用自家桥，未直接依赖 client 包）；`root eslint.config.js` 增加浏览器 globals 块（否则客户端脚本 lint 失败）。

## T5 第一轮独立 Review（W9R1-01..12）修复记录

- 输入：`.agentdev/work/WP-09/review.md`（结论 FAIL；2×P1、6×P2、4×P3）。
- 范围：`packages/client/src/**` 未改动；`apps/daemon/src/{protocol,server}.ts`（仅 `protocol.ts`）、`apps/web/src|public|test/**`、两份真实 Git 单元测试文件、`docs/architecture/protocol.md`，本节记录。
- 「回归测试」列均指新增或改写后**在旧行为上会失败**的断言；旧行为被编码进断言的地方在下表「更正」列说明。

| 发现 | 修改 | 回归测试 | 更正/登记 |
|---|---|---|---|
| W9R1-01 [P1] 批准不可达（`plan:{}` + `authorizationRef:'workbench'` ⇒ 422） | 新增只读查询 `plan.current`（`apps/daemon/src/protocol.ts`）：从 gate 的批准记录与 plan 产物读回可提交正文、`authorizationId`、产出该产物的 planning `runId`，并给出 `approval.enabled/reason`；详情页在渲染时调用它，`public/app.js` 点击时先取 gate 再提交该正文/授权；`approval.enabled=false` 时按钮 `disabled aria-disabled` 且渲染可见原因（`#approveBlocked`/`data-approve-reason`），错误地发请求的路径被移除 | `apps/web/test/workbench.integration.test.ts`「approves the Plan the card shows through the real gate (AC-070, W9R1-01)」：`plan.current` → 真实 `PlanGateService` 批准 200/applied、版本递增、同键同载荷重放同结果；「disables Plan approval with a visible reason when the gate holds no Plan (W9R1-01)」 | T3 §3 关于 AC-070 的表述当时为**过度陈述**，现按本节为准 |
| W9R1-02 [P1] `data-expired` 恒 false（从不传 `requestedVersion`） | `apps/web/src/app.ts` 新增 `planVersionOf()` 解析 `?planVersion=`（非法/缺省回落到 gate 当前版本），详情页把显式版本传给 `plan.current` 与 `planCard`；`requestedVersion !== currentVersion` 时渲染 `data-expired="true"` + 禁用原因 | `apps/web/test/workbench.integration.test.ts`（旧版本过期卡片 + 当前版本可批准）、`apps/web/test/workbench-failures.integration.test.ts`「过期卡片」、`apps/web/test/pages.test.ts`「parses the planVersion query parameter…」 | **更正旧期望**：T4 两处 `?planVersion=<live-1>` 断言 `data-expired="false"`、`data-plan-version="<live>"` 正是把 bug 写进了断言，已改为 `data-requested-version="<live-1>"`/`data-expired="true"`/禁用，并新增当前版本可批准的对照 |
| W9R1-03 [P2] 跨 Project 拒绝回显本机 Project id | `protocol.ts` 的 `dispatch` 与 `subscribe` 两处 `details` 只保留调用方自己的 `projectId`，删除 `openProjectId` | `apps/daemon/test/protocol.integration.test.ts`「does not echo the local Project id in a cross-Project refusal (W9R1-03)」（HTTP 分支 + 真实 `/ws` 订阅分支，断言 `details` 键集合与不含本机 id） | T4 §4.5 的残余已结清 |
| W9R1-04 [P2] 写幂等账本只覆盖 2/6 命令 | `protocol.ts` 新增通用包装 `withCommandLedger`（方法+主体+payloadHash，`begin/complete` 与效果同事务）覆盖 `conversation.create/project.open/work.control/requirement.continue/plan.approve/finding.submit/decision.resolve/config.save/config.test`；`backup.run`/`restore.run` 用 `withNonTransactionalCommandLedger`（效果不能与账本同事务：`VACUUM INTO` 禁止在事务内执行），失败时删除已接受的账本行使键可重试；`conversation.message.send`/`requirement.save` 保留自身专用账本，避免双重记账 | `apps/daemon/test/protocol.integration.test.ts`「replays a recorded write and refuses the same key with a different payload (W9R1-04)」（work.control/config.save/decision.resolve/backup.run/restore.run 各覆盖重放 + `IDEMPOTENCY_CONFLICT`）与「records a command only once for a replayed write and never on a failure (W9R1-04)」；`apps/web/test/workbench.integration.test.ts` 在同键重放上再断言一次 | 无偏差遗留：所有 `*` 方法均入账本；`restore.run` 的真实回放/冲突在同一用例内验证 |
| W9R1-05 [P2] Queued 无 Work 取消恒失败（正文缺六个二级标题） | `protocol.ts` 新增 `canonicalRequirementContent()`：六段标题各一次、顺序固定，取消原因写入「完成摘要」，`cancelRequirement` 用它生成正文；同时修正 `saveRequirement` 的 `scope` 回退（`sourceRef` 不是 `Scope`，改用 `emptyScope()`），使「取消→保存」在真实 Git 上成立 | `apps/web/test/workbench.integration.test.ts`「cancels a Queued requirement with no Work through the real Git record service (AC-068)」：真实 `RequirementSaveService` + 真实 Git 提交，断言 catalog 六标题各一次、`requirement.json.lifecycle=cancelled` 且含取消原因、投影与分支前进 | **更正旧测试**：T4 原用例是 `if (ok) … else …` 双分支，两条路径都断言「不变」，无法失败；已改为无分支断言成功，并按真实 Git 记录生成夹具（投影-only 夹具得到的是诚实的 `REQUIREMENT_CONFLICT`）。T4 §4.3 措辞中的实际错误码为 `VALIDATION_ERROR`，一并更正 |
| W9R1-06 [P2] `pnpm test:unit` 不确定（真实 Git 用例 5s 超时） | `packages/workspace/test/initialize.test.ts` 与 `packages/core/test/wp08-failures.test.ts` 的 `describe` 增加显式 `REAL_GIT_TEST_TIMEOUT = 30_000`（远低于 integration 项目 180s，单个用例实测 <1s） | 直接以契约命令 `pnpm test:unit`（默认 workers）验证：55 文件 / 1102 用例全绿（见下） | 未移动文件到 integration 项目；时间上界保持有界 |
| W9R1-07 [P2] Chief 对话创建/切换控件是死件 | `protocol.ts` 实现 `conversation.create`（校验 `focusWorkId` 存在、写真实 `conversation` 行 + `conversation.created` 事件、入账本）；`public/app.js` 新增 `initConversations()`：`#newConversation`/`#newConversationInline` 调用它并跳转新对话，`#conversationSelect`/`#switchConversation` 执行真实切换；`pages.ts` 增加 `#conversationError` 失败面 | `apps/web/test/workbench-failures.integration.test.ts`「Chief: renders only conversation controls that a real method backs (AC-072, W9R1-07)」：每个渲染出的控件在出厂脚本里有监听、`conversation.create` 真实建行并发事件、切换后页面读取该对话、不存在的 Work 返回 `NOT_FOUND` | T4 §4.1 的「控件已渲染但无实现」登记已结清 |
| W9R1-08 [P2] BFF `/ws` 桥丢弃 `idempotencyKey`/`expectedVersion` | `apps/web/src/daemon.ts` 的 `accept()` 透传两个字段（含类型校验），桥保持传输层语义 | `apps/web/test/workbench-failures.integration.test.ts`「forwards idempotencyKey and expectedVersion over the /ws bridge (W9R1-08)」：经 `/ws` 写入的 `expectedVersion` 触发 `VERSION_CONFLICT`、同键重放、成功写入在账本中可查 | — |
| W9R1-09 [P3] BFF 不校验浏览器 CSRF 头且未登记 | 登记为**有意偏差**：代码注释（`apps/web/src/app.ts` `handleRpc`）与 `docs/architecture/protocol.md` §2 均说明——BFF 持有 daemon 会话，同源写以 HttpOnly SameSite 会话 + 精确 Origin 认证，再以 BFF 自己的 `session.csrfToken` 调 daemon，浏览器提供的该头既非必需也不被信任 | `apps/web/test/server.integration.test.ts`「authenticates a same-Origin write without a browser CSRF header (W9R1-09)」：无头 + 正确 Origin 的写 200、伪造头仍 200（不被信任）、外来 Origin 即使带真 token 也 403 | 偏差本身不改行为，只登记并加测试 |
| W9R1-10 [P3] 浏览器重连固定 2s 无限循环 | `public/app.js` 引入与 `packages/client` 同口径的有界策略 `reconnectPolicy`（1s/2s/4s…上限 30s、最多 6 次）+ `reconnectDelay()`，成功后重置 attempt，耗尽后进入诚实的 `closed` 状态 | 新增 `apps/web/test/client-script.test.ts`（按出厂源码求值 `reconnectDelay`，断言阶梯与上限、attempt 计数与终止分支、不再出现固定 2000ms）；「断连」用例同时断言源码事实 | — |
| W9R1-11 [P3]「断连」用例未覆盖 BFF 桥自动重连 | `apps/web/test/workbench-failures.integration.test.ts`「断连」改为在**同一浏览器 socket** 上等待 `bridge.reconnecting` → `bridge.open(resumed=1)` 与桥自动重放的事件/`batch_end`；桥侧同时修正：`project.events.ack` 的游标进入 resume 基准（`browserCursor`），重订阅不再丢失已确认水位 | 同上用例：断开期间的写入在重连后于同一 socket 上补齐，水位以下零重复（`indexOf` 切分点），并用新 socket 交叉验证同一水位语义 | — |
| W9R1-12 [P3] Plan 卡当前版本取自 plan 产物上限 | `apps/web/src/app.ts` 的 `planCard` 停止读取产物列表，只以 `plan.current`（gate 批准记录）为权威；`gateStatus='stale'` 一律按过期渲染 | `apps/web/test/pages.test.ts`「derives the plan version only from the gate answer, not from plan artifacts (W9R1-12)」：gate 答案决定版本；stale 答案 `expired=true`；缺答案时 `approvalEnabled=false` 且有原因 | — |

### 其他更正与登记

- 删除 `public/app.js` 中已无调用者的 `viewData()`（旧批准链是唯一调用点）；页面数据岛 `#viewData` 仍由服务端渲染，测试对其的断言不变。该项在修复前使 `pnpm lint` 报 `viewData is defined but never used`。
- `docs/architecture/protocol.md` §2 登记 BFF CSRF 偏差；§4 增补 `plan.current`/`plan.approve` 两行与「审批链以 `plan.current` 为唯一权威」「Queued 取消的正文模板」两条注记。
- T4 §4.1（`conversation.create` 缺失）、§4.3（取消正文不合规）、§4.5（`openProjectId`）三项残余均已修复；§4.2 已一并修正（`scope` 回退）。§4.6/§4.7/§4.8 仍属 Core/T2 现状，不在本轮范围。
- `implementation.md` §T5 原残余 5（`@agentdev/client` 依赖与浏览器 globals 块）**已过时**：两者在冻结点前已完成，现予清除。

### 验证数字（本轮修复后）

| 命令 | 结果 |
|---|---|
| `prettier --write <改动文件>` | 全部文件符合 Prettier（`pnpm lint` 的格式检查通过） |
| `pnpm typecheck` | 退出 0，无输出 |
| `pnpm lint` | 退出 0（ESLint + Prettier check） |
| `pnpm test:unit`（默认 workers，契约命令原文） | **55 文件 / 1102 用例**全部通过（13.5s） |
| `node_modules/.bin/vitest run --project integration --maxWorkers=4` | **25 文件 / 304 用例**全部通过（254s，本次修复后首轮全绿）；仅含本片改动文件的 4 个文件（daemon 协议 + BFF 三份）单跑 **65 用例全绿（5.7s）** |
| `pnpm build` | 12 个 workspace 全部 `Done` |

并发说明：宿主在一次 JSON 复跑（`--reporter=json`）期间处于高负载，出现 4 例与本片无关的既有用例失败（`apps/cli` Docker 容器写边界、`packages/core` 需求保存/WP-08 演练、`packages/workspace` 依赖血缘），均在 `apps/daemon`/`apps/web`/两份单元测试之外；同一命令在前一次运行 304/304 全绿。本片新增/改写的用例在两次运行中均通过。
