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

## A2 剩余

把 capability/网关/`RunnerSpawnPort`/`prepareRun`/Supervisor 接入 `startRuntime`（daemon 启动即执行排队 Run、退出即优雅停止并撤销 capability、`status` 暴露执行态），并补 e2e（桩 Provider，断言真实调用）与 live（真实 Provider，一次无播种行 Attempt）证据；随后按 Plan §6 进入独立 Review/Test/结算。

## 与既有记录的说明

WP-11 的代码改动会改变 `scripts/lib/acceptance-binding.mjs` 计算的 `codeDigest`，因此 `.agentdev/work/WP-10/` 下记录的 `codeDigest` 从此指向 WP-10 的验证树 `9f154c3`（历史证据，不变）。WP-11 冻结前会重跑契约命令并在本包内重新生成验收记录。
