# WP-11 实现记录（运行时与 Runner 执行器）

- planVersion: 1（`.agentdev/work/WP-11/plan.md`，决定 D1–D5）
- 依赖：WP-00～WP-10（基线 `263aa40`，WP-10 验证代码树 `9f154c3`）
- 本文件按 Task 增量记录；A1（T1–T3）已完成并提交，A2（T4–T6）进行中。

## A1-T1 运行时状态目录与单实例锁

- `packages/contracts/src/runtime.ts`（纯契约）：`AGENTDEV_HOME` 覆盖、`~/.agentdev` 默认、`runtime.json`/`daemon.lock`/`projects.json`/`installation-token`/`logs`/`projects/` 的路径与 zod Schema（拒绝未知键、非回环监听、非 32hex projectId）、`runtimePaths()`/`projectStateDir()`。
- `packages/core/src/runtime.ts`（磁盘侧）：0700/0600 目录与文件、原子写（临时文件 + rename）、**epoch 围栏**的单实例锁（进程已死的陈旧锁可接管并推进 epoch，`releaseDaemonLock` 只允许持有者删除自己的记录）、`runtime.json` 读写清除、按 canonical root 的 Project 注册表（`open` 幂等）、`readInstallationCredential()`（复用 `auth.ts` 的 0600 校验）。
- 测试：`packages/contracts/test/runtime.test.ts`（11 例）+ `packages/core/test/runtime.test.ts`（9 例）：Schema round-trip、二次守护拒绝、陈旧锁接管、epoch 校验释放、损坏记录拒绝、文件模式、注册表幂等。

## A1-T2 daemon 宿主

- `apps/daemon/src/bootstrap.ts`：真实组装一个 Project 的 `ProjectRuntime`——`resolveProjectIdentity`（canonical root/嵌套仓库）→ 每项目状态目录 `~/.agentdev/projects/<projectId>` 下的 `ProjectStore.open`（迁移 + 备份桩）→ `BlobStore`/`ConfigStore`（全局目录 = home）→ Core 服务（Attachment/Artifact/DownloadToken/EventHub/PlanGate/Finding/Decision/RequirementContinuation/CAS/Snapshot/IntegrationLock/Settlement/RequirementSave）→ `WorkbenchProtocol` → `createDaemon`（HTTP+WS）→ `createWebApp`（BFF，Bearer = 安装凭证）。首次打开插入 Project 行（canonical root、gitRoot、`agentdev/main`、`codeRoot=src`、`documentRoot=docs/agentdev`、trust 由调用者决定）。
- `apps/daemon/src/main.ts`：`startRuntime()`——索取单实例锁（陈旧锁记日志）、`AuthService.loadOrCreate`、按注册表或 `--root` 打开项目（首个项目用文档默认端口 4318/4317，其余用系统分配）、写 `runtime.json`、绑定**回环 admin 面**（`GET /health`、`GET /projects`、`POST /projects`、`POST /stop`，全部要求安装凭证 Bearer，恒定时间比较）、SIGTERM/SIGINT 优雅停止（先关 admin 与 BFF，再关各项目监听与数据库，最后清记录 + 按 epoch 释放锁）；`runAsProcess()` 供 dist 入口与开发引导共用；启动失败不留锁与记录；进度日志走 stderr，stdout 只留一条机器可读启动记录。
- 测试：`apps/daemon/test/runtime.integration.test.ts`（5 例）：真实 Git 仓库 + 临时 home 上启动、live 记录、admin 鉴权（无凭证 401）、daemon `/healthz`、真实 `/rpc project.list`、第二个守护拒绝、admin 开第二个项目并落注册表（同 root 幂等）、优雅停止后记录与锁消失、非 Git 目录拒绝且不留锁。

## A1-T3 CLI 命令

- `apps/cli/src/runtime.ts`：`cliHome()`、`readLiveRecord()`、`readCredential()`（0600 校验）、`adminRequest()`（node:http，Bearer）、`spawnDaemon()`（detached，日志写 `~/.agentdev/logs/daemon.log`，入口默认 `apps/daemon/dist/main.js`，可用 `AGENTDEV_DAEMON_ENTRY` 指向源码引导）、`waitForRuntime()`/`waitForStop()`、`daemonLogTail()`；CLI 只依赖 `@agentdev/contracts`（保持 `ARCHITECTURE.md` §2 依赖表）。
- `apps/cli/src/cli.ts`：`start`（幂等；等待 `/health` 就绪；失败输出 `START_TIMEOUT` + 日志尾巴）、`stop`（先请求优雅停，超时 SIGTERM，再超时 SIGKILL，输出 `STOP_TIMEOUT`）、`status`（只读；未运行时 `running:false` 且退出 0）、`open <path>`（未运行时先启动，再经 admin `POST /projects` 打开并打印实例；缺路径 `VALIDATION_ERROR`）。用法文本与 `doctor` 说明同步。
- `apps/cli/src/doctor.ts`：新增 `runtime` 探针（home、凭证模式 ok/missing/insecure、是否在运行、pid/epoch/实例数、损坏记录说明），凭证非 0600 记入 blockers。
- `apps/cli/templates/`：`com.agentdev.daemon.plist`（launchd 用户服务）与 `agentdev.service`（systemd 用户服务），与 `reliability.md` §7 对应。
- 测试：`apps/cli/test/runtime.integration.test.ts`（4 例，真实子进程守护 + 真实 HTTP）：status→start→open（幂等）→status→重复 start→stop 全流程；`start --root`；入口缺失报 `START_FAILED`；`open` 缺参数报 `VALIDATION_ERROR`。`apps/cli/test/doctor.integration.test.ts` 增加运行时探针 3 种状态（新增 1 例）。

## 已跑通的真实路径（开发期手工验证 + 自动化）

- `pnpm build` 后 `node apps/daemon/dist/main.js --home <tmp> --root <git> --trust`：真实启动、写出 `runtime.json`、`/health` 带凭证返回实例、`SIGTERM` 优雅停止后 `runtime.json`/`daemon.lock` 均消失。
- 新增测试：contracts runtime 11、core runtime 9、daemon runtime integration 5、cli runtime integration 4、doctor integration 9（含新增运行时探针）。

## A2-T4/T5 Runner 执行器（Supervisor、心跳与恢复）

- **IPC 上移到契约**：`packages/contracts/src/runner-ipc.ts` 现在是 Runner⇄Core 的唯一契约（`ARCHITECTURE.md` §2「共享Schema一次定义」），并新增 `attempt.heartbeat` 消息（`reliability.md` §2「心跳每5秒」）；`apps/runner/src/ipc.ts` 保留为 Runner 侧的再导出点（`runnerCommandSchema`/`runnerMessageSchema` 以避免与持久实体 `command`/`message` 同名冲突），因此 `attempt.ts`/`cli.ts` 与其测试无需改动。`apps/runner/src/attempt.ts` 现在按 `LIMITS.heartbeatSec` 周期发送心跳（`unref`，终结时清除）。
- **`packages/core/src/supervisor.ts`**（`RunnerSupervisor`）：supervisor 自己不发明状态转换，全部交给已复核的服务——
  - **认领**：按 `createdAt`/id 稳定排序取 `status='queued'` 的 Run，Chief 优先；容量按 `projectConcurrentRunners`（默认 4，保留 1 个 Chief 槽，Chief 已在跑时保留解除）与 `roleConcurrency`（默认 2）计算；
  - **启动**：先 `RunLifecycle.beginAttempt`（持久 Starting + Attempt + `ownerEpoch` + `runnerId`）再 `spawn`（epoch = `ownerEpoch + 1`，1 基）；`prepare` 端口（daemon 注入：冻结 profile、cwd、prompt、tools、capability）构造调用参数；
  - **握手**：`attempt.ready` 校验 attemptId/epoch → 写入 `heartbeatAt`、Attempt 转 `running`，然后才发送 `attempt.prompt`；`droppedTools` 非空按配置错误失败；
  - **围栏**：任何 attemptId/epoch 不匹配的迟到消息一律丢弃（`reliability.md` §2），测试覆盖「迟到结果不改变 Run 状态」；
  - **结果**：`attempt.result` → Attempt 终态 + `RunLifecycle.settle`（completed/failed/cancelled）；`attempt.error` 与「进程退出但无结果」→ Attempt `lost` 并调用 `RunRecoveryService.recoverRun` 按真实进程状态停靠；
  - **心跳/静默**：20 秒无任何消息 → 终止（SIGTERM，`cancelGraceSec` 后 SIGKILL）并停靠 Run；确认进程已死 → `interrupted`（允许重试），进程状态无法确认 → `recovery_required` 且 `newAttemptAdmission.allowed=false`（旧写者未确认终止前不换写者）；
  - **重启核对**：`start(hostEpoch)` 调用 `RunRecoveryService.recoverAfterRestart`，先停靠上一进程遗留的 Run 再开始调度；`stop()` 先发 `attempt.shutdown`，再 SIGTERM。
- 测试：`packages/core/test/supervisor.test.ts`（10 例，真实 `ProjectStore` + 真实 `RunLifecycle`/`RunRecoveryService`，脚本化 spawn 端口）：认领与 `ready` 后发 prompt、工具未激活即失败、结果结算与槽位释放、迟到 epoch 结果被丢弃、Chief 优先与项目/角色上限、静默转 `lost`（进程已死 → `interrupted` 可重试）、进程不可确认 → `recovery_required` 且拒绝新 Attempt、心跳保活、优雅停止。单元套件 **58 文件 / 1138 用例**全绿。

## A2-T6 真实模型通路与第一次真实 Attempt

- **Attempt capability**：`packages/core/src/capabilities.ts`——每次 Attempt 一枚短期 token（绑定 attempt/epoch/run/role/过期），重新签发即作废旧 token，可按 Attempt 或 Run 撤销。
- **Core 侧模型网关**：`packages/core/src/gateway-http.ts`——回环 OpenAI 兼容端点（`POST /chat/completions` 支持 JSON 与 SSE、`GET /models`、`GET /healthz`）：Bearer capability 校验 → 取 Run → **用冻结快照**调真实 `ModelGateway.complete`（请求里的 `model` 与冻结模型不一致直接 409 拒绝，绝不替换）→ 失败按 OpenAI 形状映射状态码，**每次拒绝都记日志**；usage 通过 `onUsage` 回报；`/models` 只返回冻结模型。
- **真实 Provider 传输**：`packages/core/src/transport-http.ts`——`node:http`/`node:https` 直连（无新依赖），凭证只经 `Authorization` 且在失败信息中遮蔽，reasoning 模型的 `reasoning_content` 回退，429/5xx/网络错误标记 retryable。
- **Runner 侧**：`apps/daemon/src/runner-spawn.ts`（真实 `RunnerSpawnPort`：子进程 + NDJSON IPC + 每 Attempt `models.json`）+ `apps/daemon/src/prepare-run.ts`（`PrepareRun`：冻结 profile → provider/model/tools/cwd/prompt + capability + catalog）。**SDK `models.json` 的 provider 条目支持内联 `apiKey`/`baseUrl`，因此 Provider Secret 从不进入 Runner**，Runner 只拿到 capability。
- **修掉三处真实缺陷**（都是这次真实 Attempt 暴露的）：
  1. `PiSessionHandle` 新增 `isIdle()`，`AttemptRunner` 在 `prompt()` 之后等待会话空闲才结束 Attempt——SDK 的 `prompt()` 只表示「回合已受理」，原先会在模型调用发生前就退出并报 completed；
  2. 网关端点原先只接受 `content: string`，而 Pi SDK 发的是多模态数组（`content: [{type:'text',text}]`）——现在展平文本，并对所有拒绝记录日志（原先拒绝是静默的）；
  3. usage 不能在一次调用里 `reconcile`（`RunLifecycle` 只允许终态结算）——新增 `RunUsageLedger`（累加→`settle` 时一并结算），网关端点内的记账失败不再把已完成的回答变成 500（否则 SDK 重试会让 Provider 被重复计费）。
- **首次真实 Attempt 证据**：`apps/daemon/test/attempt.integration.test.ts`——RunnerSupervisor → 真实 `apps/runner` 子进程（源码模式，经验证后的装载器解析 `@agentdev/*` 与 `@earendil-works/*`）→ 真实 Pi 会话 → 网关端点 → 真实 `ModelGateway` → 真实 HTTP 传输 → 回环 Provider 桩；断言 Run/Attempt 完成、**Provider 恰好被调用 1 次**、usage 结算进预算（16 tokens）、catalog 只含 capability 不含 Provider secret。
- 测试增量：capability+网关 9 例、真实 Attempt 1 例、runner 假会话 1 处契约更新；单元 **59 文件 / 1147 用例**、集成 **29 文件 / 322 用例**全绿，typecheck/lint 干净。

## A2-T6 接线：daemon 自己执行 Run

- `packages/core/src/execution.ts`（`createProjectExecution`）：为一个 Project 组装执行栈——capability 存储、usage 账本、`ModelGateway`（真实 HTTP 传输 + **按 Run 的 grants 授权**的 Secret 解析器）、回环网关端点（`authorize` 钩子在每次调用前写入该 Run 的 role/stage/work/grants）、`RunnerSupervisor`（真实进程端口由调用方注入）；`start(hostEpoch)` 先核对上一进程遗留 Run 再开始调度，`stop()` 先停调度再关网关。
- `apps/daemon/src/main.ts`：每个打开的项目都建一个执行栈并在监听就绪后 `start()`；`/health` 返回 `execution:{enabled,live}`；优雅停止时先停执行栈（不再派发、Runner 收到 shutdown、网关关闭）再关监听与数据库；`StartRuntimeOptions` 新增 `repoRoot`/`execute`/`runnerEnv`（测试注入 Runner 入口）。
- `apps/daemon/src/bootstrap.ts`：`SnapshotWriter` 提前创建并注入 `ConfigStore`（否则 `freeze` 不可用），并向宿主暴露 `config`/`snapshots`。
- 测试：`apps/daemon/test/runtime.integration.test.ts` 现在断言 `/health.execution = {enabled:true, live:0}` 且每个项目恰好一个执行栈；`apps/cli/test/runtime.integration.test.ts` 仍全绿（CLI start/status/open/stop 在真实子进程上通过）。**源码模式下 Node 类型擦除不支持参数属性（`constructor(private x)`）**，`SecretContext` 已改为显式字段赋值——这是真实启动路径暴露的又一处细节。
- 单元 59 文件 / 1147 用例、集成 29 文件 / 322 用例全绿。

## A2-T7 发布命令里的执行证据（Plan D1）

`pnpm test:e2e` 新增检查 `runtime.executes-attempt`（映射 **AC-057**，drill 从 20 项检查增至 21 项，覆盖 AC 从 23 增至 24）：

- 在既有真实栈内新增一个**会应答**的回环模型（原 Provider 桩保持「零调用」断言不变），并用匿名 Provider 配置（无 secret）走**真实 HTTP 传输**；
- 用 daemon 自己的模块组装执行栈（`createProjectExecution` + `apps/daemon/src/prepare-run.ts` + `runner-spawn.ts`），源码模式启动真实 `apps/runner` 子进程；
- **阶段 A**：真实 Attempt 全链完成——断言 Run/Attempt `completed`、回环模型确实被调用、usage（13 tokens）结算进预算；
- **阶段 B（AC-057）**：对慢回合（prompt 含 `SLOW`）的活跃 Runner 发 `SIGKILL`，断言 Run 被停靠为 `interrupted` 或 `recovery_required`、Attempt 为 `lost`，且 `newAttemptAdmission` 与停靠状态一致（确认已死 → 允许新 Attempt 且无需决定；不可确认 → 拒绝并要求 RecoveryDecision）。
- 本轮实测：`e2e: 21 checks — PASS 17 / FAIL 0 / UNVERIFIED 4`，退出 0。

顺带修掉两处真实缺陷：Attempt 的 `runnerId` 原先记录的是**daemon 自身的 pid**（`runner-<daemon pid>-<runId>`），恢复探测因此永远看到「进程存活」；现在 spawn 之后改写为**子进程 pid**（`runner-<child pid>-<runId>`），这正是崩溃检测的依据。e2e harness 的 `ConfigStore` 也补上了 `SnapshotWriter`，与 daemon 宿主一致（否则 `freeze` 不可用）。

## A2-T8 live 证据（真实 Provider 经运行时执行）

`pnpm test:live` 新增检查 `drill.runtime-attempt`（映射 AC-057，live 从 4 项增至 **5 项检查**）：在真实 Provider 演练内用 daemon 自己的模块组装执行栈并启动真实 `apps/runner` 子进程——

- **阶段 A**：supervisor 认领 queued Run → 真实子进程 → 真实 Pi 会话 → 网关端点（capability）→ **产品自有 HTTP 传输** → 用户配置的真实 Provider；Run 仅由 Attempt 自身的 result 完成，预算记账来自 Provider 的真实 usage（实测 >0 tokens，runnerId 记录子进程 pid）；
- **阶段 B（AC-057）**：对正在进行真实 Provider 调用的活跃 Runner 发 `SIGKILL`，断言 Run 停靠为 `interrupted`/`recovery_required`、Attempt `lost`，且 `newAttemptAdmission` 与进程确认状态一致；
- Provider 凭据通过 **真实的 `grant` 行 + `decision` 行**授权（`execution.md` §4），不是演练闭包：这是「用户配置即授权」的可审计记录。
- 本轮实测（用户 DeepSeek 凭证）：`live: 5 passed / 0 failed / 2 unverified`，11 次真实 HTTP 200，退出 0。

## T9 独立 Review 第 1 轮（FAIL：3×P1 / 8×P2 / 6×P3）后的修复

| 发现 | 严重度 | 处置 |
|---|---|---|
| WP11R1-01 Runner 结果/退出回调无错误隔离，迟到结果使 daemon 崩溃 | P1 | 子进程监听器里的每一次状态转换都经 `guarded()` 包裹并记录拒绝原因；Run 已终态时迟到结果只记日志、不再结算（新增「用户取消后迟到结果」测试） |
| WP11R1-02 进程探针无法解析 supervisor 写的 runnerId，`interrupted` 不可达 | P1 | runnerId 改为探针能解析的 `pid:<n>`（spawn 前为 `pid:pending`，此时不可确认 → `recovery_required`，fail-closed）；e2e/live 的 AC-057 断言改为**严格**要求 `interrupted`，不再接受「任一状态」 |
| WP11R1-03 capability 门禁 fail-open（停靠后旧 token 仍可用） | P1 | 网关端点在每次调用时**重新校验 Attempt**：存在、状态为 `starting`/`running`、`epoch` 与 `ownerEpoch+1` 一致，否则撤销并拒绝；supervisor 通过 `onAttemptEnded` 钩子在结果/错误/退出/超时/停止时撤销；新增「Attempt 已停靠」「epoch 不匹配」两个测试 |
| WP11R1-04 `attempt.error` 直接判 failed、未走恢复 | P2 | 无结果的 Attempt 一律按 lost 处理并停靠 Run（`interrupted`/`recovery_required`）；测试期望同步更新 |
| WP11R1-05 优雅 stop 把在跑 Run 结算为终态 cancelled | P2 | 停止期间到达的 cancelled 结果改为「Attempt `stopped` + Run 停靠」，符合「优雅停止→可恢复」；测试断言 Run 处于 interrupted/recovery_required |
| WP11R1-06 忽略 SIGTERM 的 Runner 变孤儿 | P2 | `stop()` 等待子进程自行结束（默认 3s）、随后 SIGTERM 并**保留** `cancelGraceSec` 后的 SIGKILL 升级；不再清除升级计时器 |
| WP11R1-07 doctor 忽略 `AGENTDEV_HOME` | P2 | doctor 默认数据目录改用 `runtimeHomePath(process.env, homedir())` |
| WP11R1-08 `projects.json` 注册表被忽略 | P2 | 空 `--root` 时回落到注册表；显式 `--root` 的项目也会登记（新增「无 root 重启后重新打开已登记项目」测试）；顺带修正 host epoch 需严格递增（带启动时间戳） |
| WP11R1-09 CLI 失败无 `operationId` | P2 | 所有 `start/stop/open/status` 失败输出带 `operationId` |
| WP11R1-10 单实例锁非原子、失败回滚删他人记录 | P2 | 锁文件用 `O_CREAT|O_EXCL` 原子创建（陈旧锁先删除再独占重建）；失败启动只清除**属于自己**的 `runtime.json` |
| WP11R1-11 Runner 子进程继承 daemon 全量 env（含 Provider secret） | P2 | 子进程只拿显式白名单（PATH/HOME/TMPDIR/NODE_OPTIONS 等 + `AGENTDEV_RUNNER_ENTRY`），Provider 变量不传递 |
| WP11R1-12 `claim()` 死代码 | P3 | 删除，改为按 runId 检查活跃 Attempt |
| WP11R1-14 陈旧锁接管日志打印新持有者 | P3 | `acquireDaemonLock` 返回 `replacedStaleFrom`，日志打印被替换者 |
| WP11R1-16 drill 空转断言 | P3 | 删除恒真断言（`sessionRef`、`startsWith('runner-')`），runnerId 断言改为 `^pid:[0-9]+$`，AC-057 断言改为严格 |
| WP11R1-17 capability TTL 注释不符、终态后仍写心跳 | P3 | 注释改为实际 1 小时并说明「状态每次调用重校验，TTL 是兜底」；心跳只在 Attempt 处于 starting/running 时落库 |
| WP11R1-13 Run 在 `beginAttempt` 即 running，`ready` 只作用于 Attempt | P3 | **未修复，登记残余**：需要 `RunLifecycle` 新增 `confirmRunning`（Run 侧 queued→starting→ready→running），属下一轮 |
| WP11R1-15 `attempt.result` 正文不落 `stage_result` | P3 | **未修复，登记残余**：真正写入 `stage_result` 的仍是 Capability 鉴权的阶段提交路径；Runner 的结果正文用于日志与 Run 终态 |

修复后实测：单元 **59 文件 / 1151 用例**、集成 **29 文件 / 323 用例**、`pnpm test:e2e` 21 项检查（PASS 17/FAIL 0/UNVERIFIED 4，24 AC，exit 0）、`pnpm test:live` 5 项检查（真实 Provider，5 passed/0 failed，exit 0）、typecheck/lint 干净。

## T10 独立 Review 第 2 轮（PASS，4×P2 / 3×P3）后的修复

第 2 轮判定 **PASS**（0 P1，不阻断 Test），登记 4 个 P2 与 3 个 P3；本轮把 4 个 P2 与 2 个可修 P3 全部关闭：

| 发现 | 处置 |
|---|---|
| WP11R2-01 优雅停止仍可能留下忽略 SIGTERM 的孤儿 Runner | `stop()` 现在按真实退出信号推进：等协作退出（`graceMs`）→ SIGTERM → 等 `cancelGraceSec` → SIGKILL → 再确认；只有子进程确认退出（`entry.exited`）才继续关闭流程，未确认的 pid 会被逐条记录而不是谎称已停止。新增「stubborn Runner 必须被 SIGKILL」与「协作 Runner 不应收到信号」两个测试 |
| WP11R2-02 `recovery_required` 的 Run 在产品内没有恢复路径 | 新增 `RunRecoveryService.recordResumeDecision()`（先**重新核对真实进程状态**：旧进程未确认终止或存在未知副作用则拒绝；通过后写入 accepted 的 `kind='recovery'`/`choice='resume'` 决定行）与 `RunnerSupervisor.resumeParkedRun()`（读持久准入：`interrupted` 且已确认终止 → 开新 Attempt；`recovery_required` 必须先有覆盖本 Run 的决定）。自动认领仍然只针对 `queued`，崩溃后不会静默重试（`reliability.md` §6「恢复由人触发」）。新增两个测试（未确认 → 拒绝；确认 + 决定 → attempt 1→2） |
| WP11R2-03 用户取消后迟到的 result 把 `stopped` 的 Attempt 改写成 `completed` | `finishFromResult` 先判 Run 是否终态：迟到结果不再改写 Attempt（`stopped`/`lost` 为终态）；只有 `starting`/`running` 才可迁移 |
| WP11R2-04 `START_FAILED`/`START_TIMEOUT` 缺 `operationId`；记录误称 e2e 已收严 | 两条真实失败路径补上 `operationId`；`scripts/e2e.mjs` 的 AC-057 断言**真正**改为严格（`interrupted` + `allowed`），记录同步更正 |
| WP11R2-05 白名单仍含 `NODE_OPTIONS`（可注入 `--require`） | 从子进程环境白名单移除 `NODE_OPTIONS` |
| WP11R2-07 `attempt.error` 记 Attempt `failed` 而记录称 `lost` | 以代码为准更正记录措辞（`attempt.error` → Attempt `failed` + Run 停靠） |
| WP11R2-06 结果正文无持久证据（`stage_result`） | 保持已登记残余（阶段结果由 Capability 鉴权的提交路径写入） |

修复后实测：单元 **59 文件 / 1154 用例**、集成 **29 文件 / 323 用例**、`pnpm test:e2e` 21 项检查（PASS 17 / FAIL 0 / UNVERIFIED 4，exit 0）、`pnpm test:live` 5 项检查（真实 Provider，exit 0）、typecheck/lint 干净。

## A2 剩余

1. **Provider Secret 的持久化与注册路径**：`SecretStore` 目前只在进程内（WP-07 的实现），`agentdev start` 下没有 CLI/UI 途径注册 Provider 凭据，因此真实 Provider 的 Attempt 只能由测试注入解析器；`execution.md` §4 要求的 Keychain/0600 加密文件与备份单独导出仍是缺口。
2. **证据已就绪**：`pnpm test:e2e` 21 项检查（PASS 17/FAIL 0/UNVERIFIED 4，24 AC）与 `pnpm test:live` 5 项检查（真实 Provider，5 PASS、退出 0）都包含运行时执行证据。
3. 随后按 Plan §6 进入独立 Review/Test/结算。

## 与既有记录的说明

WP-11 的代码改动会改变 `scripts/lib/acceptance-binding.mjs` 计算的 `codeDigest`，因此 `.agentdev/work/WP-10/` 下记录的 `codeDigest` 从此指向 WP-10 的验证树 `9f154c3`（历史证据，不变）。WP-11 冻结前会重跑契约命令并在本包内重新生成验收记录。
