# WP-12 文档表面 vs 实现表面 差距审计 2（api-gap-audit-2）

- 版本：2.0（只读审计）。对象：`docs/architecture/protocol.md`（工作树版本，163 行）§2–§8、`docs/operations/installation.md`、`docs/architecture/reliability.md` §7、`docs/delivery/acceptance.md`（AC-001…AC-094）与当前工作树代码。
- 对比基线：`.agentdev/work/WP-12/api-gap-audit.md`（审计 #1：29 缺失 / 13 形状不一致 / 10 文档事件从未发出）。
- 本审计只改写了本文件；`apps/daemon/src/protocol.ts`、`packages/core/src/**`、`apps/web/**` 在审计期间被另外两条车道持续编辑，未做任何改动。

## 0. 方法、证据与诚实声明

**静态结论（占本文 99%）**：逐条把 `protocol.md` §2/§3/§4/§5/§6 表格与 §5 散文 HTTP 端点，对照
`apps/daemon/src/protocol.ts`（`GLOBAL_METHODS` L487–505、`WRITE_METHODS` L508–540、`LEDGER_WRAPPED_METHODS` L558–582、分发表 `dispatchUnwrapped` L1342–1481、WS 分发表 L5909–5931）、
`apps/daemon/src/server.ts`（L147/154/176/200/207/216/220/226/248/268/357）、
`apps/daemon/src/main.ts`（admin 面 L598/616/620/667/729/766）、
`apps/daemon/src/control-handler.ts`、`apps/daemon/src/tool-handler.ts`、
`packages/core/src/control-http.ts`（`CONTROL_PATHS` L198–217、switch L512+）、
`apps/web/src/app.ts`（`READ_ONLY` L116–142、路由 L256–312）、
`apps/cli/src/cli.ts`（USAGE L28–45、分派 L52–132）。
对每条“缺失”结论另做整仓搜索（`grep -rn --include=*.ts "'<method>'" packages/*/src apps/*/src`），因此下文 **“absent” = 生产源码无该名字的实现**，而非只是分发表缺 case。

**唯一执行过的命令**：`grep`、`python3`（解析 JSON 与生成表格）、仓库自带 esbuild 语法解析（`protocol.ts/server.ts/main.ts/control-handler.ts/tool-handler.ts/control-http.ts/app.ts/cli.ts` 八文件全部 OK）。**未运行任何测试套件**；AC 证据结论来自已落盘的 `acceptance-results.json`（`generatedAt 2026-09-14T13:18:40Z`、`gitHead 7c723ec`）、`e2e-results.json`（13:44、同 gitHead）、`live-results.json`（13:06、同 gitHead）与映射文件 `scripts/lib/drill-acs.mjs` / `scripts/lib/acceptance-registry.mjs` / `scripts/lib/acceptance-evidence.mjs`。

**并发写入告知**：审计期间 `apps/daemon/src/protocol.ts` 从 6725 行增长到 6753 行（T4b daemon-surface 车道在写），代码为语法完整、非半写文件；本文所有行号取自读取时刻，最终树可能有 ±30 行漂移。

**重要口径**：`acceptance-results.json` 绑定的是 **已提交 HEAD `7c723ec`**，而当前工作树有 30+ 未提交修改。因此它**不覆盖** T4b 已写入工作树的 daemon 读面（board/requirement.get 的 `git`）等改动——AC-090 的“应关闭”结论属工作树静态判定，须在干净树上重跑 `pnpm test:acceptance` 才算数。

## 1. 摘要计数

| 口径 | 审计 #1 | 现在 | 变化 |
|---|---|---|---|
| 文档化方法名总数（§2 5 + §3 12 + §4 33 + §5 17 + §6 10） | 77 | 77 | — |
| 文档有、实现**完全缺失** | 29 | **11** | −18 |
| 文档名 · 形状 ≠ 实现（别名字形） | 13 | **11** | −2 |
| 文档化方法已实现且名字一致 | 35 | **55** | +20 |
| §7 持久事件名总数 | 29 | 29 | — |
| 文档事件**从未发出**（持久） | 10 | **6** | −4（permission.resolved、tool.invoked、tool.refused 已补；token/log/heartbeat 属临时流另计） |
| 临时流（token.delta/log.delta/heartbeat）无发射 | 3 | **3** | 0 |
| 实现有、文档无的方法名 | 13 | **12** | −1 |
| 实现有、文档无的事件名 | 8 | **9** | +1（新增 `run.control_changed`） |
| 94 AC 中“提交套件内无产品路径证据” | 未统计 | **57**（54 纯库级 + 3 播种行） | — |
| 94 AC 中仅有已执行演练、无应用层用例 | 未统计 | 9 | — |

## 2. Part 1 — 表面差距（只列仍存在者）

### 2.1 仍**完全缺失**的文档化命令（11）

| 文档行 | 文档名 | 实现现状 | 依赖 AC | 阻断可用路径？ | 归属切片 |
|---|---|---|---|---|---|
| protocol.md:41 | `project.create` | absent（整仓 `'project.create'` 0 命中；admin `POST /projects`≠create 语义） | AC-023/025 | **是**：WebUI 无法新建项目 | T5 |
| protocol.md:42 | `project.clone` | absent；`operation.failed` 因此无发射者 | AC-023/087 | **是**：Clone 导入需求池不可达 | T5 |
| protocol.md:43 | `project.trust` | absent；`trust` 只在开户时读出（protocol.ts:1535、5457） | AC-053/028 | 否（开户时定 trust，无法事后撤销） | T5 |
| protocol.md:44 | `project.close` | absent；`project.close()` 仅在停机（main.ts:297） | AC-023 | 否 | T5 |
| protocol.md:45 | `project.initialize` | absent；`packages/workspace/src/initialize.ts` 只被 `packages/workspace/src/index.ts:21` 再导出，**无生产调用方** | AC-025/026/027/028/029/079 | **是**：空/旧项目初始化不可达 | T5 |
| protocol.md:61 | `work.retry` | absent（0 命中） | AC-017 | 否（Finding/Chief 返工链覆盖） | T4b |
| protocol.md:73 | `recovery.inspect` | absent（`RunRecoveryService` 只有 `recordResumeDecision`/`resumeParkedRun`） | AC-057/061/082 | 否（`work.control resume` 旁路） | T4b |
| protocol.md:74 | `recovery.resolve` | absent；findings 决策选项 `resume/accept_cancel/abandon` 只承担一半 | AC-021/057/061 | 否 | T4b |
| protocol.md:75 | `task.list` / `task.get` | absent（仅 `packages/client/src/commands.ts:54-55` 只读名单）。Task **已**能物化（protocol.ts:4148 `tasks.insert`，由 `plan.approve`→`materializePlanTasks` L4307 调用），但无读命令 | AC-081 | **是**：Task 已落库但 UI/协议读不到 | T4b |
| protocol.md:93 | `context.preview` | absent（仅 `commands.ts:60`；`ContextBuilder` 无预览端点） | AC-030/031/032/036/079 | 否（模型侧上下文仍工作） | T4b |

### 2.2 仍**形状不一致**（文档名不存在，实现用另一名字/通道）（11）

| 文档行 | 文档名 | 实现 | 依赖 AC | 阻断？ | 处置 |
|---|---|---|---|---|---|
| protocol.md:60 | `work.pause/resume/cancel` | `work.control`（protocol.ts:1375 → `controlWork` L2744，action=pause/resume/cancel） | AC-020/021 | 否 | 补别名或改文档（plan D8） |
| protocol.md:68 | `requirement.pause/resume/cancel` | `work.control`（带 requirementId 处理无 Work Queued，protocol.ts:2965+）+ `requirement.continue`（needs_replan，L1385/L3868） | AC-020/021/068/089 | 否 | 同上 |
| protocol.md:70 | `decision.submit` | `decision.resolve`（protocol.ts:1461 → L4402） | AC-015/016/074 | 否 | 同上 |
| protocol.md:98 | `config.update` | `config.save`（protocol.ts:1438） | AC-075 | 否 | 同上 |
| protocol.md:123/124/128 | `runner.ready` / `runner.heartbeat` / `runner.stopped` | Runner 父子进程 IPC `attempt.ready` / `attempt.heartbeat` / `attempt.result`（`packages/contracts/src/runner-ipc.ts`；`supervisor.ts:802/814`），**不是** attempt-capability 协议方法 | AC-057/061/082 | 否 | 产品/架构决定：补协议面或把 IPC 写进文档 |

### 2.3 上一轮之后**已补齐**（销项，供 Settlement 引用）

`command.get`（protocol.ts:1410 → L1955）、`work.budget.update`（L1420 → L2199）、`requirement.create/update`（L1387/1389 → L3275/3300，真实别名走 `RequirementSaveService`）、`requirement.import`（L1391 → L3332）、`requirement.start`（L1393 → L3412）、`requirement.archive/restore`（L1395/1397 → L3082/3117）、`permission.request/respond`（L1464/1466 → L4541/4637）、`run.pause/resume/cancel`（L1403–1408 → `controlRun` L2111）、`file.list/read`（L1412/1414 → L1976/2002）、`extension.list/set`（L1416/1418 → L2045/2067，清单为空但按文档诚实返回空）、`tool.execute`（`control-http.ts:208` → `apps/daemon/src/tool-handler.ts` `createToolHandler`；Runner 侧 `apps/runner/src/tools.ts:64-146` 注册 read/search/write/edit/bash/git/artifact_write，`apps/runner/src/cli.ts:116` 的 `BUILTIN_TOOLS=[]` 只是历史常量、真实工具由 `buildRoleTools` 构造）、`agent.request_dispatch`/`context.request`/`decision.request`（`control-http.ts:212/214/216`，处理器 `control-handler.ts:462/337/517`，均在 `main.ts:404` 装配）。`requirement.get` 已返回 `contentMarkdown` 与 `git`（protocol.ts:1865/1867），`board` 卡片带 `git`（L1751，`gitFactsOf` L5496）。

**CLI/运维面**：`agentdev secret rotate`（installation.md:63/68）与 `agentdev backup/restore/relocate`（reliability.md:65、installation.md:128–145）均已补文档——审计 #1 的两条“CLI 未文档化”已关闭。

### 2.4 实现有、文档无（**新**未文档化面）

| 实现项 | 位置 | 说明 |
|---|---|---|
| 方法 `projects` | protocol.ts:1348 | `project.list` 别名 |
| 方法 `board` / `inbox` / `agents` / `settings` | protocol.ts:1369/1430/1432/1434 | 页面聚合查询；`experience.md` 有行为描述，`protocol.md` §5 无方法 |
| 方法 `config.test` | protocol.ts:1440 → L4860 | 未文档化 |
| 方法 `finding.submit` | protocol.ts:1459 → L4346 | §4 表无 finding 方法 |
| 方法 `ui.translate` | protocol.ts:1474 → L5237 | §5 表无此方法 |
| 方法 `backup.run` / `restore.run` | protocol.ts:1469/1471 | 只在 `reliability.md` §7 有 CLI 面 |
| 方法 `work.control` / `requirement.continue` | protocol.ts:1375/1385 | 真实方法名，文档只有细粒度名（见 2.2） |
| admin HTTP `GET /health`、`GET /projects`、`POST /projects`、`POST /secret`、`DELETE /secret`、`POST /stop` | main.ts:598/616/620/667/729/766 | `installation.md` 只记了 admin `POST /secret` 与 `/health`，其余未文档化 |
| legacy HTTP `POST /artifacts/download.prepare`、`POST /conversation.message.send` | server.ts:248/268 | 与 `/rpc` 并存，未文档化 |
| BFF `POST /api/auth/login`、`/api/auth/logout`、`GET /api/session` | app.ts:261/270/284 | 浏览器兼容别名，未文档化 |

## 3. Part 2 — 事件覆盖

**方法**：在 `packages/*/src` 与 `apps/*/src`（排除 test/dist）里 grep 事件名字面量与事件常量表，再定位每个发射点。**注意**：“某个测试提到”不算发射；“常量定义”不算发射。

### 3.1 文档 §7 持久事件

| 文档事件 | 文档行 | 真实发射点（生产源码） | 判定 |
|---|---|---|---|
| `project.created` | protocol.md:41/145 | **无**（整仓 0 命中） | **从未发出** |
| `message.received` | :145 | `packages/core/src/messages.ts:363`（Dispatcher 命令声明）、`apps/daemon/src/protocol.ts:2611`（`/rpc` 直写）、`apps/daemon/src/server.ts:338`（legacy HTTP 直写） | 已实现；三条路径**各自**一次，但同一转换有 3 处独立实现（漂移风险，非重复发射） |
| `message.processed` / `message.failed` | :145 | `apps/daemon/src/message-state.ts:52`（单一三元，幂等守卫）；`message.failed` 另有 `protocol.ts:2713`（Chief Run 入队失败的转换，状态守卫防重复） | 已实现 |
| `assessment.saved` | :145 | `packages/core/src/orchestrator.ts:525` | 单一发射点 |
| `requirement.changed` | :145 | `gates.ts:1346`、`decisions.ts:592`、`findings.ts:2573`、`requirement-continue.ts:294` | 四个不同转换共用一个名字 |
| `requirement.saved` | :145 | `packages/core/src/requirement-save.ts:88`（常量）→ `:2750` | 单一发射点 |
| `requirement.save_failed` | :145 | `requirement-save.ts:1747`、`:2056`（appendDiagnostic）+ `requirements.ts:147` | 多条失败路径，同名 |
| `requirement.imported` | :145 | `packages/core/src/requirements.ts:174`、`:191` | 逐条 + 汇总两处 |
| `work.control_changed` | :145 | `findings.ts:1597/1762/1853/1963/2613` + `protocol.ts:2871` | 多转换同名 |
| `run.queued` | :145 | `orchestrator.ts:1071` | 单一 |
| `run.started` | :145 | `run-lifecycle.ts:153`（新 claim）、`supervisor.ts:988`（runner.ready 后仍 starting）、`findings.ts:1738`（resume，`resumed:true`） | 三个真实转换；靠 `status==='starting'` 守卫避免重复，但**缺一次/顺序断言**（T9 退出条件要求补） |
| `run.ended` | :145 | `run-lifecycle.ts:291`、`:391` | 终止 + 取消两条 |
| `stage.completed` / `stage.failed` | :145 | `stage.ts:240`（单一三元）+ `stage.ts:285`（schema 拒绝也是 `stage.failed`） | 已实现 |
| `artifact.created` / `artifact.invalidated` | :145 | `artifacts.ts:213` / `:164` | 单一 |
| `decision.created` | :145 | `decisions.ts:327`、`permissions.ts:359`、`gates.ts:704`、`protocol.ts:2260`、`control-handler.ts:559` | 五种来源 |
| `decision.resolved` | :145 | `protocol.ts:4501` | 单一 |
| `permission.resolved` | :145 | `packages/core/src/permissions.ts:47`（常量）→ `:439`（approve）/`:483`（deny） | **新实现**（审计 #1 为缺失） |
| `tool.invoked` / `tool.refused` | :145 | `packages/core/src/broker.ts:128–129`（常量）→ `:2147` / `:2527` | **新实现**（准入后 / 拒绝分支，符合文档） |
| `initialization.progress` / `initialization.completed` | :145 | **无**（0 命中；`packages/workspace/src/initialize.ts` 无生产调用方） | **从未发出** |
| `recovery.report_ready` | :145 | **无**（0 命中） | **从未发出** |
| `knowledge.updated` | :145 | **无**（0 命中；结算走投影 + `requirement.changed`） | **从未发出** |
| `provider.test_completed` | :100/145 | `protocol.ts:5107` | 单一 |
| `operation.failed` | :42/145 | **无**（0 命中） | **从未发出** |
| `chief_action_required` | :145 | `orchestrator.ts:1209`、`join.ts:247`、`control-handler.ts:434/479` | 多来源 |

**剩余从未发出的持久事件（6）与建议归属切片**：`initialization.progress`、`initialization.completed`、`project.created`、`operation.failed` → **T5（多项目/初始化）**；`knowledge.updated`、`recovery.report_ready` → **T9（事件切片）**。

### 3.2 临时流（非持久 cursor）

| 文档名 | 文档行 | 现状 | 判定 |
|---|---|---|---|
| `token.delta` | protocol.md:147 | 仅在注释（`supervisor.ts:263`、`:1003`）出现；Pi 的 `text_delta`（`packages/pi-runtime/src/events.ts:19`）被 supervisor 累积成助手文本（`supervisor.ts:1007`），**未**转成 WS 帧 | 从未发出 |
| `log.delta` | :147 | 0 命中 | 从未发出 |
| `heartbeat` | :147 | 0 命中（`attempt.heartbeat` 是 Runner IPC，不是临时流帧）；daemon 只发 `hello`/`event`/`batch_end`/`response`（protocol.ts:5801/5821/5325/5324） | 从未发出 |

归属 **T9**：按文档语义实现，或在 `protocol.md` §7 明确标注为内部 IPC 通道（plan D9）。

### 3.3 实现有、文档 §7 未列的事件（9）

| 事件 | 发射点 | 建议 |
|---|---|---|
| `conversation.created` | protocol.ts:1592 | 补文档 |
| `finding.created` / `finding.addressed` / `finding.verified` / `finding.accepted_risk` | findings.ts:707 / 843 / 1004（三元）/ 1051 | 补文档 |
| `delivery.write_admitted` / `delivery.level_upgraded` | gates.ts:935 / 1091 | 补文档 |
| `delivery.work_completed` | findings.ts:1369 | 补文档 |
| `run.control_changed` | permissions.ts:524 | **本轮新增**，补文档 |

## 4. Part 3 — 94 条 AC 的现状证据映射

**方法**：逐 AC 取 `acceptance-results.json` 的 `evidence[]`（由 `scripts/lib/acceptance-registry.mjs` 的 `test-name`/`curated` 解析得到，`mapping` 字段标注；84 条 test-name、9 条 curated、1 条 none）与 `drills[]`（`pnpm test:e2e` / `pnpm test:live` 的逐 AC 行），按证据所在层分类：
**应用层** = `apps/*/test/*.integration.test.ts` 等真实 daemon/BFF/CLI/Runner 集成；**库级** = `packages/*/test/**`；**演练** = `scripts/e2e.mjs` / `scripts/live.mjs` 的逐 AC 行（该次运行 `drillsExecuted:true`，证据带真实 id/hash）。
`acceptance-results.json` 当前计数：**PASS 93 / UNVERIFIED 1 / ACCEPTED 1（AC-090）/ FAIL 0 / MISSING 0**，`providerConfigured:true`、`reviewModelConfigured:true`。

| AC | 状态 | mapping | 证据层 | 提交套件产品路径 | 主要证据 | 演练 | 备注 |
|---|---|---|---|---|---|---|---|
| AC-001 | PASS | none | 库级+演练 | 演练 | — | pnpm test:e2e=UNVERIFIED；pnpm test:live=PASS | 仅演练（无提交套件内应用层用例） |
| AC-002 | PASS | test-name | 应用层 | 是 | `packages/core/test/artifacts.test.ts :: attachments, artifacts and previews (WP-03) versions agent artifacts and keeps the old bytes readable (AC-002)`<br>`packages/core/test/artifacts.test.ts :: attachments, artifacts and previews (WP-03) invalidates an artifact once and keeps the reason (AC-002)`<br>`…(共7条)` | pnpm test:e2e=PASS |  |
| AC-003 | PASS | test-name | 应用层 | 是 | `packages/core/test/artifacts.test.ts :: attachments, artifacts and previews (WP-03) produces an agent explanation artifact for a delegated analysis Run (AC-003)`<br>`apps/daemon/test/assessment-dispatch.integration.test.ts :: message → Chief → DispatchSpec → Requirement → Run → stage result (WP-12 T2) runs the whole path from one message with no seeded row (AC-003/AC-005/AC-069)`<br>`…(共3条)` | pnpm test:e2e=PASS；pnpm test:live=PASS |  |
| AC-004 | PASS | curated | 应用层 | 是 | `packages/domain/test/domain.test.ts :: level routing (workflow.md §2) routes assist and artifact to none`<br>`apps/daemon/test/server.test.ts :: daemon HTTP surface (WP-03) keeps questions, advice and statements read-only end to end` | — |  |
| AC-005 | PASS | test-name | 应用层 | 是 | `packages/domain/test/domain.test.ts :: level routing (workflow.md §2) routes a message into independent work items (AC-005/AC-006)`<br>`packages/core/test/artifacts.test.ts :: attachments, artifacts and previews (WP-03) records the authority an explicit message grants (AC-005)`<br>`…(共4条)` | pnpm test:e2e=PASS；pnpm test:live=PASS |  |
| AC-006 | PASS | test-name | 库级 | 否 | `packages/domain/test/domain.test.ts :: level routing (workflow.md §2) routes a message into independent work items (AC-005/AC-006)`<br>`packages/core/test/artifacts.test.ts :: attachments, artifacts and previews (WP-03) splits one mixed message into the work items it names (AC-006)` | — | 库级证据；无应用层执行 |
| AC-007 | PASS | test-name | 应用层 | 是 | `packages/domain/test/delivery.test.ts :: L1 eligibility and bounds (AC-007/AC-008/AC-009) accepts an explicit typo change inside the L1 bounds (AC-007)`<br>`packages/domain/test/delivery.test.ts :: L1 eligibility and bounds (AC-007/AC-008/AC-009) never downgrades a one-character permission change by its line count (AC-008)`<br>`…(共21条)` | pnpm test:live=PASS |  |
| AC-008 | PASS | test-name | 库级 | 否 | `packages/domain/test/delivery.test.ts :: L1 eligibility and bounds (AC-007/AC-008/AC-009) accepts an explicit typo change inside the L1 bounds (AC-007)`<br>`packages/domain/test/delivery.test.ts :: L1 eligibility and bounds (AC-007/AC-008/AC-009) never downgrades a one-character permission change by its line count (AC-008)`<br>`…(共9条)` | — | 库级证据；无应用层执行 |
| AC-009 | PASS | test-name | 库级 | 否 | `packages/domain/test/delivery.test.ts :: L1 eligibility and bounds (AC-007/AC-008/AC-009) accepts an explicit typo change inside the L1 bounds (AC-007)`<br>`packages/domain/test/delivery.test.ts :: L1 eligibility and bounds (AC-007/AC-008/AC-009) never downgrades a one-character permission change by its line count (AC-008)`<br>`…(共24条)` | — | 库级证据；无应用层执行 |
| AC-010 | PASS | test-name | 库级+演练 | 演练 | `packages/domain/test/delivery.test.ts :: stage manifests and routes (AC-010/AC-011/AC-012) fixes the stage order per route and level (AC-010/AC-012)`<br>`packages/domain/test/delivery.test.ts :: stage manifests and routes (AC-010/AC-011/AC-012) accepts a complete L2 chain and rejects a missing stage (AC-010)`<br>`…(共8条)` | pnpm test:e2e=PASS；pnpm test:live=PASS | 仅演练（无提交套件内应用层用例） |
| AC-011 | PASS | test-name | 库级 | 否 | `packages/domain/test/delivery.test.ts :: stage manifests and routes (AC-010/AC-011/AC-012) fixes the stage order per route and level (AC-010/AC-012)`<br>`packages/domain/test/delivery.test.ts :: stage manifests and routes (AC-010/AC-011/AC-012) accepts a complete L2 chain and rejects a missing stage (AC-010)`<br>`…(共9条)` | — | 库级证据；无应用层执行 |
| AC-012 | PASS | test-name | 库级 | 否 | `packages/domain/test/delivery.test.ts :: stage manifests and routes (AC-010/AC-011/AC-012) fixes the stage order per route and level (AC-010/AC-012)`<br>`packages/domain/test/delivery.test.ts :: stage manifests and routes (AC-010/AC-011/AC-012) accepts a complete L2 chain and rejects a missing stage (AC-010)`<br>`…(共10条)` | — | 库级证据；无应用层执行 |
| AC-013 | PASS | test-name | 应用层 | 是 | `packages/domain/test/delivery.test.ts :: gate readiness (AC-013/AC-014) refuses a write without an approved Plan and leaves the source hash unchanged (AC-013)`<br>`packages/domain/test/delivery.test.ts :: gate readiness (AC-013/AC-014) refuses a Plan for another revision and a changed Plan hash (AC-013 required failure test)`<br>`…(共29条)` | — |  |
| AC-014 | PASS | test-name | 应用层 | 是 | `packages/domain/test/delivery.test.ts :: gate readiness (AC-013/AC-014) refuses a write without an approved Plan and leaves the source hash unchanged (AC-013)`<br>`packages/domain/test/delivery.test.ts :: gate readiness (AC-013/AC-014) refuses a Plan for another revision and a changed Plan hash (AC-013 required failure test)`<br>`…(共23条)` | — |  |
| AC-015 | PASS | test-name | 库级 | 否 | `packages/domain/test/delivery.test.ts :: behaviour choices (AC-015/AC-016) handling now needs a new Product/Plan and invalidates affected evidence (AC-015)`<br>`packages/domain/test/delivery.test.ts :: behaviour choices (AC-015/AC-016) queues a Requirement for later and leaves the acceptance alone (AC-016)`<br>`…(共10条)` | — | 库级证据；无应用层执行 |
| AC-016 | PASS | test-name | 库级 | 否 | `packages/domain/test/delivery.test.ts :: behaviour choices (AC-015/AC-016) handling now needs a new Product/Plan and invalidates affected evidence (AC-015)`<br>`packages/domain/test/delivery.test.ts :: behaviour choices (AC-015/AC-016) queues a Requirement for later and leaves the acceptance alone (AC-016)`<br>`…(共10条)` | — | 库级证据；无应用层执行 |
| AC-017 | PASS | test-name | 库级 | 否 | `packages/domain/test/delivery.test.ts :: findings (AC-017/AC-018/AC-019/AC-083) returns work to development without a human forwarding step (AC-017)`<br>`packages/domain/test/delivery.test.ts :: findings (AC-017/AC-018/AC-019/AC-083) invalidates the old Review/Test after a fix and refuses self-verification (AC-017/AC-018)`<br>`…(共51条)` | — | 库级证据；无应用层执行 |
| AC-018 | PASS | test-name | 库级 | 否 | `packages/domain/test/delivery.test.ts :: findings (AC-017/AC-018/AC-019/AC-083) returns work to development without a human forwarding step (AC-017)`<br>`packages/domain/test/delivery.test.ts :: findings (AC-017/AC-018/AC-019/AC-083) invalidates the old Review/Test after a fix and refuses self-verification (AC-017/AC-018)`<br>`…(共14条)` | — | 库级证据；无应用层执行 |
| AC-019 | PASS | test-name | 库级 | 否 | `packages/domain/test/delivery.test.ts :: findings (AC-017/AC-018/AC-019/AC-083) returns work to development without a human forwarding step (AC-017)`<br>`packages/domain/test/delivery.test.ts :: findings (AC-017/AC-018/AC-019/AC-083) invalidates the old Review/Test after a fix and refuses self-verification (AC-017/AC-018)`<br>`…(共26条)` | — | 库级证据；无应用层执行 |
| AC-020 | PASS | test-name | 应用层 | 是 | `packages/domain/test/delivery.test.ts :: the shared write barrier (AC-020/AC-021, W6R2-07/W6R3-02) admits writes only while the Work is running`<br>`packages/domain/test/delivery.test.ts :: the shared write barrier (AC-020/AC-021, W6R2-07/W6R3-02) never lets a caller expectation replace the approved source hash (W6R2-02)`<br>`…(共14条)` | — |  |
| AC-021 | PASS | test-name | 库级 | 否 | `packages/domain/test/delivery.test.ts :: the shared write barrier (AC-020/AC-021, W6R2-07/W6R3-02) admits writes only while the Work is running`<br>`packages/domain/test/delivery.test.ts :: the shared write barrier (AC-020/AC-021, W6R2-07/W6R3-02) never lets a caller expectation replace the approved source hash (W6R2-02)`<br>`…(共50条)` | — | 库级证据；无应用层执行 |
| AC-022 | PASS | test-name | 库级 | 否 | `packages/domain/test/delivery.test.ts :: gate readiness (AC-013/AC-014) refuses an over-used budget instead of assuming a zero usage (AC-022, W6R1-03)`<br>`packages/domain/test/delivery.test.ts :: findings (AC-017/AC-018/AC-019/AC-083) closes through evaluateFindingClosure and stops at the rework allowance (AC-017/AC-022)`<br>`…(共9条)` | — | 库级证据；无应用层执行 |
| AC-023 | PASS | test-name | 库级 | 否 | `packages/core/test/identity.integration.test.ts :: independent projects (AC-023) gives two real roots distinct ids and independent databases` | — | 库级证据；无应用层执行 |
| AC-024 | PASS | test-name | 库级 | 否 | `packages/core/test/identity.integration.test.ts :: canonical roots (AC-024) normalizes a subdirectory to the repository root`<br>`packages/core/test/identity.integration.test.ts :: canonical roots (AC-024) normalizes a trailing separator and a symlinked path`<br>`…(共8条)` | — | 库级证据；无应用层执行 |
| AC-025 | PASS | test-name | 库级 | 否 | `packages/workspace/test/initialize.test.ts :: empty project (AC-025) creates the initial Git and delivery branch, then confirms an unimplemented project` | — | 库级证据；无应用层执行 |
| AC-026 | PASS | curated | 库级 | 否 | `packages/workspace/test/scan.test.ts :: scanProject budgets stops at 40 body files and reports a partial map with explicit unknowns`<br>`packages/workspace/test/scan.test.ts :: scanProject budgets stops before exceeding 512 KiB of body content`<br>`…(共6条)` | — | 库级证据；无应用层执行 |
| AC-027 | PASS | curated | 库级 | 否 | `packages/workspace/test/initialize.test.ts :: no-Git directory returns Blocked with the Git-initialization authorization request`<br>`packages/workspace/test/initialize.test.ts :: dirty workspace blocks delivery start with a hash report while read-only investigation still works` | — | 库级证据；无应用层执行 |
| AC-028 | PASS | curated | 库级 | 否 | `packages/workspace/test/initialize.test.ts :: dirty workspace blocks delivery start with a hash report while read-only investigation still works` | — | 库级证据；无应用层执行 |
| AC-029 | PASS | test-name | 库级 | 否 | `packages/core/test/wp08.integration.test.ts :: WP-08 T4 end-to-end integration drill runs the initialization route: interrupted writing resumes by hash and a conflict is never overwritten (AC-029)` | — | 库级证据；无应用层执行 |
| AC-030 | PASS | test-name | 库级 | 否 | `packages/core/test/context-builder.test.ts :: buildContext — happy path (AC-030) freezes the documented fields and copies the content into the snapshot directory`<br>`packages/core/test/context-builder.test.ts :: buildContext — happy path (AC-030) accounts tokens with the documented character/4 estimator by default`<br>`…(共11条)` | — | 库级证据；无应用层执行 |
| AC-031 | PASS | test-name | 库级 | 否 | `packages/core/test/context-builder.test.ts :: buildContext — required inputs (AC-031, AC-079) returns MISSING_CONTEXT with the precise gap and no frozen snapshot`<br>`packages/core/test/context-builder.test.ts :: buildContext — required inputs (AC-031, AC-079) does not expand a module to satisfy a gap`<br>`…(共8条)` | — | 库级证据；无应用层执行 |
| AC-032 | PASS | test-name | 库级 | 否 | `packages/core/test/context-ledger.test.ts :: read ledger — append inside readScope (AC-032) appends a reasoned read with its full identity and accounts its tokens`<br>`packages/core/test/context-ledger.test.ts :: read ledger — append inside readScope (AC-032) allocates seq 1..n in append order and never reuses a number`<br>`…(共23条)` | — | 库级证据；无应用层执行 |
| AC-033 | PASS | test-name | 库级 | 否 | `packages/core/test/context-acl.test.ts :: context ACL — transcript isolation (AC-033) denies the transcript kind to every role and stage`<br>`packages/core/test/context-acl.test.ts :: context ACL — transcript isolation (AC-033) denies Review and Test every message body`<br>`…(共23条)` | — | 库级证据；无应用层执行 |
| AC-034 | PASS | test-name | 库级 | 否 | `packages/core/test/context-acl.test.ts :: context ACL — cross-project isolation (AC-034) denies a source that belongs to another Project`<br>`packages/core/test/context-acl.test.ts :: context ACL — cross-project isolation (AC-034) denies another Project source whatever the source class`<br>`…(共12条)` | — | 库级证据；无应用层执行 |
| AC-035 | PASS | test-name | 库级 | 否 | `packages/core/test/context-checkpoint.test.ts :: checkpoint: session rotation (AC-035) recovers role/task/permissions/sources and keeps the approval state`<br>`packages/core/test/context-checkpoint.test.ts :: checkpoint: session rotation (AC-035) leaves the stored session unchanged when there is no checkpoint to rotate (W5R1-08)`<br>`…(共5条)` | — | 库级证据；无应用层执行 |
| AC-036 | PASS | test-name | 库级 | 否 | `packages/core/test/context-builder.test.ts :: buildContext — selection validation (AC-030) refuses a budget outside the documented 4096–2000000 range (AC-036)`<br>`packages/core/test/context-builder.test.ts :: buildContext — budget (AC-036) reports BUDGET_EXCEEDED with the dropped ref and the missing tokens`<br>`…(共19条)` | — | 库级证据；无应用层执行 |
| AC-037 | PASS | test-name | 库级+演练 | 演练 | `packages/knowledge/test/projection.test.ts :: projection build renders a feature body that parses back to the same facts (AC-037)`<br>`packages/knowledge/test/projection.test.ts :: projection build never injects an unrelated document into the feature body or index (AC-037)`<br>`…(共14条)` | pnpm test:e2e=PASS；pnpm test:live=PASS | 仅演练（无提交套件内应用层用例） |
| AC-038 | PASS | test-name | 库级+演练 | 演练 | `packages/knowledge/test/views.test.ts :: knowledge views separates confirmed intent from delivered reality (AC-038, AC-037)`<br>`packages/knowledge/test/views.test.ts :: knowledge views keeps a Work overlay out of the delivered answer and out of another Work (AC-038)` | pnpm test:e2e=PASS | 仅演练（无提交套件内应用层用例） |
| AC-039 | PASS | test-name | 库级 | 否 | `packages/core/test/context-cold-start.test.ts :: cold start: selection order and reasons (AC-039) follows overview → current work → navigation → constraints → bodies, with a reason each`<br>`packages/core/test/context-cold-start.test.ts :: cold start: selection order and reasons (AC-039) is deterministic: the same query selects the same entries in the same order` | — | 库级证据；无应用层执行 |
| AC-040 | PASS | test-name | 库级 | 否 | `packages/knowledge/test/projection.test.ts :: projection build keeps the last valid projection, marks it stale and reports KNOWLEDGE_INVALID (AC-040)`<br>`packages/knowledge/test/projection.test.ts :: projection build republishes and clears stale after a valid document follows an invalid one (AC-040)`<br>`…(共4条)` | — | 库级证据；无应用层执行 |
| AC-041 | PASS | test-name | 库级+演练 | 演练 | `packages/core/test/settlement.integration.test.ts :: Final manifest and settlement consistency (AC-041) builds a manifest that binds the verified revision, tree, knowledge and evidence`<br>`packages/core/test/settlement.integration.test.ts :: Final manifest and settlement consistency (AC-041) refuses an empty, foreign or stale verification set`<br>`…(共7条)` | pnpm test:e2e=PASS；pnpm test:live=PASS | 仅演练（无提交套件内应用层用例） |
| AC-042 | PASS | test-name | 库级 | 否 | `packages/knowledge/test/views.test.ts :: knowledge views lists observed-versus-confirmed gaps without accepting observed behaviour (AC-042)`<br>`packages/workspace/test/initialize.test.ts :: design/code conflict (AC-042) blocks Confirming, never confirms the existing document and keeps candidates observed`<br>`…(共3条)` | — | 库级证据；无应用层执行 |
| AC-043 | PASS | test-name | 库级+演练 | 演练 | `packages/core/test/config.test.ts :: role configuration (AC-043, AC-044) inherits run → project → global role → global default in order`<br>`packages/core/test/config.test.ts :: role configuration (AC-043, AC-044) blocks a role whose model is missing or unsupported instead of downgrading`<br>`…(共18条)` | pnpm test:live=PASS | 仅演练（无提交套件内应用层用例） |
| AC-044 | PASS | test-name | 库级 | 否 | `packages/core/test/config.test.ts :: role configuration (AC-043, AC-044) inherits run → project → global role → global default in order`<br>`packages/core/test/config.test.ts :: role configuration (AC-043, AC-044) blocks a role whose model is missing or unsupported instead of downgrading`<br>`…(共77条)` | — | 库级证据；无应用层执行 |
| AC-045 | PASS | test-name | 库级 | 否 | `packages/core/test/model-gateway.test.ts :: model gateway (AC-043, AC-044, AC-045) runs through the frozen profile of the Run`<br>`packages/core/test/model-gateway.test.ts :: model gateway (AC-043, AC-044, AC-045) runs against a Provider that needs no secret (T-01)`<br>`…(共71条)` | — | 库级证据；无应用层执行 |
| AC-046 | PASS | test-name | 库级 | 否 | `packages/core/test/join.test.ts :: join and structured delivery (AC-046, AC-047) holds the parent in waiting_children and keeps every sibling result`<br>`packages/core/test/join.test.ts :: join and structured delivery (AC-046, AC-047) refuses a new child once the parent Chief Run has ended (N-04, N-05)`<br>`…(共14条)` | — | 库级证据；无应用层执行 |
| AC-047 | PASS | test-name | 库级 | 否 | `packages/core/test/join.test.ts :: join and structured delivery (AC-046, AC-047) holds the parent in waiting_children and keeps every sibling result`<br>`packages/core/test/join.test.ts :: join and structured delivery (AC-046, AC-047) refuses a new child once the parent Chief Run has ended (N-04, N-05)`<br>`…(共14条)` | — | 库级证据；无应用层执行 |
| AC-048 | PASS | test-name | 库级 | 否 | `packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) admission through the Grant service (AC-048) admits a read and records the tool operation and the audit event (AC-048)`<br>`packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) admission through the Grant service (AC-048) refuses an out-of-scope target with no execution and records the refusal (AC-048)`<br>`…(共72条)` | — | 库级证据；无应用层执行 |
| AC-049 | PASS | test-name | 库级 | 否 | `packages/domain/test/permission-delivery.test.ts :: grant admission (AC-049, AC-080) admits the exact once binding and reports no replay for a first use`<br>`packages/domain/test/permission-delivery.test.ts :: grant admission (AC-049, AC-080) replays a consumed once grant for the same operation and input (AC-080)`<br>`…(共68条)` | — | 库级证据；无应用层执行 |
| AC-050 | PASS | test-name | 库级 | 否 | `packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) admission through the Grant service (AC-048) admits a read and records the tool operation and the audit event (AC-048)`<br>`packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) admission through the Grant service (AC-048) refuses an out-of-scope target with no execution and records the refusal (AC-048)`<br>`…(共72条)` | — | 库级证据；无应用层执行 |
| AC-051 | PASS | test-name | 应用层 | 是 | `packages/core/test/secrets.test.ts :: SecretStore resolution (AC-051) resolves a registered ref for the authorized Grantholder (AC-051)`<br>`packages/core/test/secrets.test.ts :: SecretStore resolution (AC-051) refuses an unknown ref with NOT_FOUND for an authorized ref shape (AC-051)`<br>`…(共42条)` | — |  |
| AC-052 | PASS | test-name | 应用层 | 是 | `packages/core/test/artifacts.test.ts :: attachments, artifacts and previews (WP-03) carries the isolation policy on every preview (AC-052)`<br>`apps/daemon/test/server.test.ts :: daemon HTTP surface (WP-03) serves a preview of a hostile document under the same isolation (AC-052)` | pnpm test:e2e=PASS |  |
| AC-053 | PASS | test-name | 库级 | 否 | `packages/pi-runtime/test/trust.test.ts :: untrusted repository (AC-053) never imports, reads or activates a repository resource and reports every skip`<br>`packages/pi-runtime/test/trust.test.ts :: untrusted repository (AC-053) still activates the shipped release whitelist, which is not repository content`<br>`…(共25条)` | — | 库级证据；无应用层执行 |
| AC-054 | PASS | test-name | 应用层 | 是 | `packages/client/test/commands.test.ts :: AC-054 reconnect and bounded backoff reconnects on the documented schedule and replays the hello`<br>`packages/client/test/commands.test.ts :: AC-054 reconnect and bounded backoff applies bounded exponential backoff while every reconnect fails`<br>`…(共5条)` | pnpm test:e2e=PASS |  |
| AC-055 | PASS | test-name | 库级 | 否 | `packages/client/test/commands.test.ts :: AC-055 write retry with the same idempotency key replays a write whose answer was lost and reports the replay`<br>`packages/client/test/commands.test.ts :: AC-055 write retry with the same idempotency key queues a write that never reached the wire and replays it after reconnect`<br>`…(共13条)` | — | 库级证据；无应用层执行 |
| AC-056 | PASS | test-name | 库级 | 否 | `packages/core/test/mailbox.test.ts :: ProjectMailbox answers a new command while a long effect is still running (AC-056)`<br>`packages/core/test/dispatcher.integration.test.ts :: long operations do not block commands (AC-056) answers a command within a second while a model call is in flight` | — | 库级证据；无应用层执行 |
| AC-057 | PASS | test-name | 库级+演练 | 演练 | `packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) withholds a new Attempt while the old execution is unconfirmed (W8R1-04)`<br>`packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) binds a resume decision to its own Run, not to the whole Work (W8R2-03)`<br>`…(共20条)` | pnpm test:e2e=PASS；pnpm test:live=PASS | 仅演练（无提交套件内应用层用例） |
| AC-058 | PASS | test-name | 库级 | 否 | `packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) withholds a new Attempt while the old execution is unconfirmed (W8R1-04)`<br>`packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) binds a resume decision to its own Run, not to the whole Work (W8R2-03)`<br>`…(共20条)` | — | 库级证据；无应用层执行 |
| AC-059 | PASS | test-name | 库级 | 否 | `packages/core/test/events-hub.integration.test.ts :: connection back-pressure (AC-059) coalesces transient frames once the soft limit is crossed`<br>`packages/core/test/events-hub.integration.test.ts :: connection back-pressure (AC-059) closes the connection at the hard limit without dropping durable events`<br>`…(共3条)` | — | 库级证据；无应用层执行 |
| AC-060 | PASS | test-name | 库级+演练 | 演练 | `packages/core/test/events-hub.integration.test.ts :: scope change (AC-060) answers a fresh snapshot at a new watermark and covers later events`<br>`packages/core/test/events-hub.integration.test.ts :: scope change (AC-060) reports an empty batch with its scan watermark`<br>`…(共7条)` | pnpm test:e2e=PASS | 仅演练（无提交套件内应用层用例） |
| AC-061 | PASS | test-name | 库级 | 否 | `packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) withholds a new Attempt while the old execution is unconfirmed (W8R1-04)`<br>`packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) binds a resume decision to its own Run, not to the whole Work (W8R2-03)`<br>`…(共20条)` | — | 库级证据；无应用层执行 |
| AC-062 | PASS | test-name | 库级 | 否 | `packages/core/test/wp08-failures.test.ts :: required WP-08 failure tests Task 合并冲突: two passed Tasks conflict, the repair Task is independent and CAS protects HEAD (AC-062)`<br>`packages/core/test/wp08-failures.test.ts :: required WP-08 failure tests T-01: the repair revision converges and is what the final manifest records (AC-062)`<br>`…(共6条)` | — | 库级证据；无应用层执行 |
| AC-063 | PASS | test-name | 库级 | 否 | `packages/core/test/wp08-failures.test.ts :: required WP-08 failure tests ref 后崩溃: the restart reuses the commit, completes the state and emits one event (AC-063)`<br>`packages/core/test/settlement.integration.test.ts :: Crash after the ref update: reuse the commit, complete once (AC-063) runs the whole settlement path: freeze, CAS and complete once`<br>`…(共6条)` | — | 库级证据；无应用层执行 |
| AC-064 | PASS | test-name | 应用层 | 是 | `packages/core/test/wp08-failures.test.ts :: required WP-08 failure tests 备份演练: backup → restore keeps hashes/knowledge/evidence and blocks a missing Secret (AC-064)`<br>`apps/daemon/test/protocol.integration.test.ts :: workbench protocol over the real Core (WP-09 T2) backs up and restores the real database through the protocol (AC-064 surface)`<br>`…(共8条)` | — |  |
| AC-065 | PASS | curated | 库级 | 否 | `packages/storage/test/migrations.integration.test.ts :: migrations backs up before pending work and writes a usable copy`<br>`packages/storage/test/migrations.integration.test.ts :: migrations rolls a failed migration back and reports its version`<br>`…(共6条)` | — | 库级证据；无应用层执行 |
| AC-066 | PASS | curated | 库级+演练 | 演练 | `packages/pi-runtime/test/session.integration.test.ts :: Pi session lifecycle creates a session with the configured model and no network`<br>`packages/pi-runtime/test/events.test.ts :: SDK event mapping maps assistant text and thinking deltas`<br>`…(共7条)` | pnpm test:live=PASS | 仅演练（无提交套件内应用层用例） |
| AC-067 | PASS | curated | 应用层 | 是 | `packages/pi-runtime/test/extensions.test.ts :: extension activation rejects an id the release does not ship`<br>`packages/pi-runtime/test/extensions.test.ts :: extension activation blocks startup when a critical capability fails`<br>`…(共5条)` | — |  |
| AC-068 | PASS | test-name | 应用层 | 是 | `apps/web/test/pages.test.ts :: board page offers a direct cancel and a refused pause for Queued without Work (AC-068)`<br>`apps/web/test/views.test.ts :: board projection (AC-068) keeps one identity per requirement, in the documented four columns`<br>`…(共18条)` | pnpm test:e2e=PASS |  |
| AC-069 | PASS | test-name | 应用层 | 是 | `apps/web/test/views.test.ts :: run status honesty (AC-069/AC-070) treats only a completed Run as a success`<br>`apps/web/test/views.test.ts :: run status honesty (AC-069/AC-070) separates direct/L1 work from board work in the Runs page`<br>`…(共9条)` | pnpm test:e2e=PASS；pnpm test:live=PASS |  |
| AC-070 | PASS | test-name | 应用层 | 是 | `apps/web/test/views.test.ts :: requirement detail (AC-070) marks the plan card expired when the shown version is not the current one`<br>`apps/web/test/views.test.ts :: requirement detail (AC-070) keeps a current plan card approvable`<br>`…(共17条)` | pnpm test:e2e=PASS |  |
| AC-071 | PASS | test-name | 应用层 | 是 | `apps/web/test/client-script.test.ts :: interface language switching (WP-12 T4) returns focus to the Live restore control when the overlay closes (AC-071)`<br>`apps/web/test/pages.test.ts :: shared shell carries the panel mode on the shell so the top bar restores it (AC-071)`<br>`…(共5条)` | pnpm test:e2e=PASS |  |
| AC-072 | PASS | test-name | 应用层 | 是 | `apps/web/test/pages.test.ts :: shared shell offers no conversation create/switch control outside Chief (AC-072)`<br>`apps/web/test/server.integration.test.ts :: workbench BFF over the real daemon (WP-09 T3) shares the panel mode across pages and keeps Chief-only controls off other pages (AC-071/AC-072)`<br>`…(共4条)` | pnpm test:e2e=PASS |  |
| AC-073 | PASS | test-name | 应用层 | 是 | `apps/web/test/pages.test.ts :: shared shell exposes a language switch that only touches the interface dictionary (AC-073)`<br>`apps/daemon/test/protocol.integration.test.ts :: workbench protocol over the real Core (WP-09 T2) translates only the interface strings and leaves project content untouched (AC-073)`<br>`…(共4条)` | pnpm test:e2e=PASS |  |
| AC-074 | PASS | test-name | 应用层 | 是 | `apps/web/test/pages.test.ts :: inbox page (AC-074) renders one row per target version and disables an expired decision`<br>`apps/web/test/views.test.ts :: inbox projection (AC-074) collapses a decision to one row per target version`<br>`…(共11条)` | pnpm test:e2e=PASS |  |
| AC-075 | PASS | test-name | 应用层 | 是 | `apps/web/test/pages.test.ts :: settings page (AC-075) renders the active revision, the editor and the test control`<br>`apps/web/test/pages.test.ts :: settings page (AC-075) gives every provider row a real editor with a never-pre-filled password field (WP-12 T1.2B)`<br>`…(共10条)` | pnpm test:e2e=PASS |  |
| AC-076 | PASS | test-name | 应用层 | 是 | `apps/web/test/views.test.ts :: attachment limits (AC-076) accepts a documented set`<br>`apps/web/test/views.test.ts :: attachment limits (AC-076) refuses more than five attachments`<br>`…(共9条)` | pnpm test:e2e=PASS |  |
| AC-077 | PASS | test-name | 应用层 | 是 | `apps/web/test/pages.test.ts :: files page (AC-077) shows the branch, the target revision and the read-only boundary`<br>`apps/web/test/pages.test.ts :: files page (AC-077) renders a refused path as an error with its code, not an empty tree`<br>`…(共9条)` | pnpm test:e2e=PASS |  |
| AC-078 | PASS | test-name | 应用层 | 是 | `apps/web/test/server.test.ts :: BFF HTTP surface (AC-078) accepts a read through the BFF cookie and forwards the daemon session`<br>`apps/web/test/server.test.ts :: BFF HTTP surface (AC-078) refuses an unauthenticated write with UNAUTHENTICATED and does not forward it`<br>`…(共32条)` | pnpm test:e2e=PASS |  |
| AC-079 | PASS | test-name | 库级 | 否 | `packages/core/test/context-acl.test.ts :: context ACL — future artifacts (AC-079) denies a future artifact class to an earlier stage`<br>`packages/core/test/context-acl.test.ts :: context ACL — future artifacts (AC-079) denies review/test artifacts to a Developer`<br>`…(共31条)` | — | 库级证据；无应用层执行 |
| AC-080 | PASS | test-name | 库级 | 否 | `packages/domain/test/permission-delivery.test.ts :: grant admission (AC-049, AC-080) admits the exact once binding and reports no replay for a first use`<br>`packages/domain/test/permission-delivery.test.ts :: grant admission (AC-049, AC-080) replays a consumed once grant for the same operation and input (AC-080)`<br>`…(共71条)` | — | 库级证据；无应用层执行 |
| AC-081 | PASS | test-name | 库级 | 否 | `packages/core/test/wp08.integration.test.ts :: WP-08 T4 end-to-end integration drill runs the L2 route Plan/Develop/Review/Test/Settlement and settles the Requirement (AC-081)`<br>`packages/core/test/wp08.integration.test.ts :: WP-08 T4 end-to-end integration drill chains dependent Tasks, invalidates on ancestor change and skips a merged ancestor (AC-081)`<br>`…(共8条)` | — | 库级证据；无应用层执行 |
| AC-082 | PASS | test-name | 库级 | 否 | `packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) records an immutable assessment with the routing evidence`<br>`packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) applies the documented routing floor from the payload alone (R9-01, DC-62)`<br>`…(共80条)` | — | 库级证据；无应用层执行 |
| AC-083 | PASS | test-name | 库级 | 否 | `packages/domain/test/delivery.test.ts :: findings (AC-017/AC-018/AC-019/AC-083) returns work to development without a human forwarding step (AC-017)`<br>`packages/domain/test/delivery.test.ts :: findings (AC-017/AC-018/AC-019/AC-083) invalidates the old Review/Test after a fix and refuses self-verification (AC-017/AC-018)`<br>`…(共53条)` | — | 库级证据；无应用层执行 |
| AC-084 | PASS | test-name | 应用层 | 是 | `packages/core/test/artifacts.test.ts :: attachments, artifacts and previews (WP-03) stages an upload with a 24h TTL and binds it once (AC-084)`<br>`packages/core/test/artifacts.test.ts :: attachments, artifacts and previews (WP-03) sends a message, creates its assist Work and binds uploads atomically (AC-084)`<br>`…(共9条)` | pnpm test:e2e=PASS |  |
| AC-085 | PASS | test-name | 应用层 | 是 | `apps/runner/test/read-ledger.test.ts :: Runner read ledger seal (AC-085, WP-12 R3-2d) seals an empty ledger to the genesis value, not a placeholder`<br>`apps/runner/test/read-ledger.test.ts :: Runner read ledger seal (AC-085, WP-12 R3-2d) chains each read into the accumulator and reports the last seq`<br>`…(共17条)` | — |  |
| AC-086 | PASS | curated | 库级 | 否 | `packages/knowledge/test/feature-format.test.ts :: parseFeatureDocument parses a complete document with real-valued fields`<br>`packages/knowledge/test/feature-format.test.ts :: parseFeatureDocument rejects design=confirmed without one resolvable decision reference`<br>`…(共7条)` | — | 库级证据；无应用层执行 |
| AC-087 | PASS | test-name | 应用层(播种行) | 否 | `apps/daemon/test/protocol.integration.test.ts :: workbench protocol over the real Core (WP-09 T2) keeps an imported requirement identity and its evidence availability honest (AC-087/AC-088/AC-089)`<br>`apps/web/test/workbench.integration.test.ts :: WP-09 T4: the workbench end to end over the real stack reads all nine surfaces from real state in one drill (AC-068–AC-078, AC-084, AC-087–AC-090, AC-093)`<br>`…(共3条)` | — | **播种行**（T5-plan E12）：关键断言读自 `seedRequirement` 直插行，非真实 import/clone 产品路径 |
| AC-088 | PASS | test-name | 应用层(播种行) | 否 | `packages/knowledge/test/requirements-pool.test.ts :: imported history (AC-088) keeps completion, cancellation and pre-archive state without migrating evidence`<br>`apps/daemon/test/protocol.integration.test.ts :: workbench protocol over the real Core (WP-09 T2) keeps an imported requirement identity and its evidence availability honest (AC-087/AC-088/AC-089)` | — | **播种行**（T5-plan E12）：关键断言读自 `seedRequirement` 直插行，非真实 import/clone 产品路径 |
| AC-089 | PASS | test-name | 应用层(播种行) | 否 | `apps/web/test/pages.test.ts :: board page offers Continue only for a record that waits to continue (AC-089)`<br>`packages/core/test/requirement-continue.test.ts :: Requirement continuation (AC-089) lists an imported active Requirement as waiting to continue without starting a Run (AC-089)`<br>`…(共16条)` | — | **播种行**（T5-plan E12）：关键断言读自 `seedRequirement` 直插行，非真实 import/clone 产品路径 |
| AC-090 | UNVERIFIED | test-name | 应用层 | 是 | `apps/web/test/pages.test.ts :: board page renders the branch, commit and push state and offers the lifecycle actions (AC-090)`<br>`apps/web/test/pages.test.ts :: requirement detail page renders the delivery branch, commit, push state and the card actions (AC-090)`<br>`…(共17条)` | pnpm test:e2e=PASS | **应关闭**：daemon 读面已补 `git`/`contentMarkdown`（protocol.ts 1751/1865/1867），`drill-acs.mjs` 的 recorded-gap 已过期 |
| AC-091 | PASS | test-name | 库级 | 否 | `packages/core/test/requirement-save.test.ts :: completion/settlement consistency (AC-091) accepts a completion record that binds the Settlement revision, tree and manifests`<br>`packages/core/test/requirement-save.test.ts :: completion/settlement consistency (AC-091) refuses a completion record whose code revision is not the final revision`<br>`…(共15条)` | — | 库级证据；无应用层执行 |
| AC-092 | PASS | curated | 库级 | 否 | `packages/knowledge/test/requirements-pool.test.ts :: importRequirementPool imports a pool, is idempotent, and keeps local and record versions apart`<br>`packages/knowledge/test/requirements-pool.test.ts :: parseRequirementPool keeps valid records visible next to a broken one and never rewrites the files`<br>`…(共7条)` | — | 库级证据；无应用层执行 |
| AC-093 | PASS | test-name | 应用层 | 是 | `packages/core/test/context-builder.test.ts :: buildContext — excluded and unknown refs (AC-093) records a reference that does not exist and never expands it`<br>`packages/core/test/context-builder.test.ts :: buildContext — excluded and unknown refs (AC-093) keeps the selection’s own excluded and unknowns verbatim`<br>`…(共21条)` | pnpm test:e2e=PASS |  |
| AC-094 | PASS | test-name | 库级 | 否 | `packages/workspace/test/cas.integration.test.ts :: CAS integration against a real Git repository (AC-094) creates the commit with the requirement pool files and moves the branch once`<br>`packages/workspace/test/cas.integration.test.ts :: CAS integration against a real Git repository (AC-094) refuses a stale writer with VERSION_CONFLICT and leaves the branch untouched`<br>`…(共15条)` | — | 库级证据；无应用层执行 |

**分类集合**

- **纯库级（无应用层证据、无已执行演练）54 条**：AC-006 AC-008 AC-009 AC-011 AC-012 AC-015 AC-016 AC-017 AC-018 AC-019 AC-021 AC-022 AC-023 AC-024 AC-025 AC-026 AC-027 AC-028 AC-029 AC-030 AC-031 AC-032 AC-033 AC-034 AC-035 AC-036 AC-039 AC-040 AC-042 AC-044 AC-045 AC-046 AC-047 AC-048 AC-049 AC-050 AC-053 AC-055 AC-056 AC-058 AC-059 AC-061 AC-062 AC-063 AC-065 AC-079 AC-080 AC-081 AC-082 AC-083 AC-086 AC-091 AC-092 AC-094
- **仅已执行演练、无提交套件应用层用例 9 条**：AC-001 AC-010 AC-037 AC-038 AC-041 AC-043 AC-057 AC-060 AC-066
- **应用层证据只有播种行 3 条**：AC-087 AC-088 AC-089（另见 §5）
- 其余 28 条有提交套件内的应用层集成证据（其中 20 条另有已执行演练）。

## 5. Part 3 — AC 红旗清单

**A. 证据只到库级（54 条）**：见 §4 集合。重点（T5-plan E12 点名）：
- `AC-023` 唯一证据 `packages/core/test/identity.integration.test.ts :: independent projects (AC-023) gives two real roots distinct ids and independent databases`——真实 SQLite，但两个 Project 由 Core 库直接开，**不经 daemon/BFF/UI 切换**。
- `AC-024` 8 条全部来自 `packages/core/test/identity.integration.test.ts`（canonical root / 符号路径 / 嵌套仓库）——纯路径库测。
- `AC-025` 仅 `packages/workspace/test/initialize.test.ts :: empty project (AC-025) creates the initial Git and delivery branch…`；而 `initialize.ts` 在生产路径**无人调用**，所以该 PASS 与产品可用性无关。
- `AC-026`（`curated` 映射 + `packages/workspace/test/scan.test.ts` 6 条）、`AC-027`（initialize.test.ts 2 条）、`AC-028`（initialize.test.ts 1 条）同为库级。
- `AC-029` 仅 `packages/core/test/wp08.integration.test.ts :: …runs the initialization route: interrupted writing resumes by hash…（AC-029）`——库级 drill。
- `AC-034` 12 条全部在 `packages/core/test/context-acl.test.ts` / `context-builder.test.ts` / `context-checkpoint.test.ts`——交叉项目隔离只证明库级 ACL，**没有** daemon 层「按 projectId 交叉读全部 NOT_FOUND」的产品路径断言。
- `AC-081` 8 条全在 `packages/core/test/wp08.integration.test.ts` 与 `packages/workspace/test/cas.integration.test.ts`——但 `plan.approve` 现在真的写 `task` 行（protocol.ts:4148，由 L4307 调用），**代码已具备产品路径，缺的是证据改标**。

**B. 应用层证据只有播种行（3 条，T5-plan 结论成立）**：
- `AC-087` / `AC-088` / `AC-089`：`apps/daemon/test/protocol.integration.test.ts:655 :: keeps an imported requirement identity and its evidence availability honest (AC-087/AC-088/AC-089)` 直接 `seedRequirement('active')`（该文件 `seed` 引用 25 处）；`apps/web/test/workbench.integration.test.ts` 的 `seedRequirement/seedWork/seedTask/seedRun`（`seed` 引用 60 处，helper 见 `apps/web/test/helpers.ts`）；`AC-089` 另有 `apps/web/test/pages.test.ts`（纯渲染单测）。即：命令分发是真的，**输入行是直插的**，没有走「空服务器 clone→open→自动导入」。T5-plan §7 的“明确不得作为证据的既有测试”清单与本结论一致。

**C. 只有已执行演练、无提交套件应用层用例（9 条）**：AC-001、AC-010、AC-037、AC-038、AC-041、AC-043、AC-057、AC-060、AC-066。演练本次是真跑（`e2e-results.json`/`live-results.json` 有真实 id/hash），但它们**不在提交的测试套件里**，回归时不会自动重放——建议在 T9/T10 收口时至少把关键断言固化进 `apps/daemon/test/**` 或 `tests/browser/**`。

**D. AC-090 应可关闭，但登记仍为 accepted**：代码侧已闭环——`board` 卡片 `git`（protocol.ts:1751）、`requirement.get` 的 `git` 与 `contentMarkdown`（L1867/L1865）、`gitFactsOf` 真的比较 upstream（L5496–5536，无法比较时 `unpushed:true`），Web 侧渲染见 `apps/web/src/views.ts:151-153/212`、`apps/web/src/pages.ts:95-109`，并有 `apps/web/test/pages.test.ts:348`、`apps/web/test/views.test.ts:144/549` 与 `pnpm test:e2e` 的 `requirement.save-git` PASS。但 `scripts/lib/drill-acs.mjs:163-169` 仍把 AC-090 登记为 `recorded-gap`（`residual: WP-10-D4/AC-090`，理由写着“Web 界面尚未渲染”），于是聚合器把它降为 UNVERIFIED/ACCEPTED。**这是过期登记，不是实现缺口**；须由 T4b/T9 删除该条并在干净树上重跑验收。另：`acceptance-results.json` 绑定 HEAD `7c723ec`，工作树的 git 读面属未提交改动，因此“现在就能 PASS”是静态判断。

**E. 其它**：`AC-043` 为 `review-model-absent` 登记项（本次 `reviewModelConfigured:true`，`pnpm test:live` PASS，按 `drill-acs.mjs:121-126` 条件已失效，应随之销项）；`AC-001/007/010/037/041/066` 的 `provider-absent` 条件在 `providerConfigured:true` 时同样失效，本次 live 全 PASS，聚合结果已按 PASS 计入。

## 6. 仍需完成（有序，带归属切片）

1. **T5 — 单入口多项目 + 初始化（最高优先）**：实现 `project.create/clone/trust/close/initialize`；把 `packages/workspace/src/initialize.ts` 接到生产路径；首次 open 自动导入需求池；补发 `project.created` / `operation.failed` / `initialization.progress|completed`。闭合 AC-023/024/025/026/027/028/029/034/087/088/089 的**产品路径**，并把 §5-B 的播种行证据替换掉。**当前整条“WebUI 内切换项目 / 空项目初始化”的产品路径完全不可达。**
2. **T9 — 事件与临时流收口**：补发 `knowledge.updated`、`recovery.report_ready`；对 `token.delta`/`log.delta`/`heartbeat` 二选一（实现或文档降级）；把 9 个未文档化事件补进 §7；为 `run.started`/`message.received` 等多发射点事件补“恰好一次 + 顺序”断言。闭合 AC-041/057/059/061/071/073 的文档一致性。
3. **T4b — daemon 文档面残余**：`work.retry`、`recovery.inspect/resolve`、`task.list/task.get`、`context.preview`；`work.pause|resume|cancel`、`requirement.pause|resume|cancel`、`decision.submit`、`config.update` 的别名或文档裁决（plan D8）。`task.list/get` 是新缺口：Task 能落库却读不到。
4. **T9/T4b — AC 证据重标与重跑**：删除 `drill-acs.mjs` 的 AC-090 recorded-gap 与已失效的 `provider-absent`/`review-model-absent` 条件；把 AC-023/024/025/026/027/028/029/034/087/088/089 的映射从库级/播种测试改到真实产品路径（T5-plan §T5.6 已列出目标测试文件）；在**干净树**上重跑 `pnpm test:acceptance`。没有这一步，`acceptance-results.json` 的 93 PASS 不能代表工作树。
5. **T4b/T2 — AC-081 证据升级**：`plan.approve` 已写 `task` 行，但产品路径断言仍只在库级 `wp08/cas.integration`；补 daemon 层「Plan→Task 行→dependencyRevision/Manifest→祖先变化失效」用例，并补 `task.list/get`。
6. **§6 形状裁决（架构/产品决定，不代决）**：`runner.ready/heartbeat/stopped` 是补 attempt-capability 协议面，还是把 Runner IPC 写进 `protocol.md` §6。影响 AC-057/061/082 的口径。
7. **文档补齐（低风险，可与上并行）**：§5 补 `projects/board/inbox/agents/settings/config.test/finding.submit/ui.translate/backup.run/restore.run/work.control/requirement.continue`；`installation.md` 补 admin `GET /projects`/`POST /projects`/`POST /stop`、legacy `POST /conversation.message.send` 与 `POST /artifacts/download.prepare`、BFF `/api/auth/*`、`/api/session`。
8. **T10 — AC-043 独立 Review/Test 模型**：本次 `reviewModelConfigured:true`，按 `drill-acs.mjs` 条件应销项；若提供方不支持第二模型则保留豁免并写明原因。

## 7. 开放问题（文档/代码冲突，不代决）

1. `work.control` / `requirement.save` / `requirement.continue` 与 §4 细粒度命令名，谁权威？（plan D8 倾向“实现补别名 + 文档保留细粒度名”。）
2. §6 的 `runner.*` 三方法是否必须是 capability 协议面，还是 Runner IPC 即可？
3. `token.delta` / `log.delta` / `heartbeat`：实现临时流，还是标注为内部 IPC 通道并移出 §7？
4. `extension.list/set` 已实现但 `services.extensions` 无装配点（protocol.ts:174/2046/2075，`BUILTIN_EXTENSIONS` 为空）：本轮是否接受“空清单 + 不可写”的诚实空实现？AC-067 的库级证据是否足够？
5. `message.received` 在 core 命令声明、daemon `/rpc`、legacy HTTP 三处各自实现：是否收敛为一条路径？（当前不构成重复发射，属漂移风险。）
6. `work.retry` 是否真有必要（AC-017 已由 Finding 链覆盖）？若要，是否用 `work.control retry` 别名即可？

## 附录 A — 复跑命令（只读）

```bash
# 分发表
grep -n "case '" apps/daemon/src/protocol.ts | sed -n '1,120p'
# 缺失方法是否整仓真的没有
for m in project.create project.clone project.trust project.close project.initialize \
         work.retry recovery.inspect recovery.resolve task.list task.get context.preview; do
  printf '%-24s %s\n' "$m" "$(grep -rn --include=*.ts "'$m'" packages/*/src apps/*/src | wc -l)"
done
# 事件发射点
grep -rn --include=*.ts "'permission.resolved'\|'tool.invoked'\|'tool.refused'" packages/*/src apps/*/src
grep -rn --include=*.ts "'initialization.progress'\|'knowledge.updated'\|'recovery.report_ready'\|'project.created'\|'operation.failed'" packages/*/src apps/*/src
# AC 证据分层（本文件 §4 表的原始口径）
python3 - <<'PY'
import json
d=json.load(open('.agentdev/work/WP-12/acceptance-results.json'))
for x in d['results']:
    lib=sum(1 for e in x['evidence'] if e.startswith('packages/'))
    app=sum(1 for e in x['evidence'] if e.startswith('apps/'))
    print(x['id'], x['status'], x['mapping'], 'lib=%d app=%d' % (lib, app),
          [(t['tool'],t['status']) for t in x['drills']])
PY
```
