# WP-11（运行时与 Runner 执行器）独立 Review 报告

- 角色：独立 Review（独立上下文；未读取任何开发聊天、transcript 或 session log；仅依据仓库文件、git 对象、既有工作包记录与本轮自建实验）
- 工作包：WP-11 A1 + A2
- 冻结点：commit `b71c8f59b007a642c9977a87ab1f74160946ab7a`，tree `5f81d2b6856c7e96a5e39fad255decd41d048b7b`
- 证据目录：`/tmp/wp11rev/`（自建攻击/复现脚本与原始输出日志）
- 唯一写入：`.agentdev/work/WP-11/review.md`（其余仓库文件如被测试改写均已 `git checkout --` 还原）

## 1. 冻结与哈希

```text
$ git status --porcelain
(空)
$ git rev-parse HEAD
b71c8f59b007a642c9977a87ab1f74160946ab7a
$ git rev-parse HEAD^{tree}
5f81d2b6856c7e96a5e39fad255decd41d048b7b
$ ls .agentdev/work/WP-11/
implementation.md  plan.md
```

- 包内提交已逐一阅读：`881f85d`（state home + lock）、`2e713ca`（daemon host + CLI）、`5fbfb7e`（RunnerSupervisor + IPC）、`406a2ef`（capability/gateway/HTTP transport/prepare-run/spawn）、`d933442`（daemon wiring）、`60c6139`（e2e 证据）、`b71c8f5`（live 证据）。
- 环境：macOS，node v24.8.0，pnpm 12.3.4；Docker 可用（`docker 28.4.0`，镜像 `agentdev/exec:0.0.0` 存在），本轮未把 Docker 不可用当作失败。
- 证据目录内容：`attack-supervisor.mjs`、`attack-gateway.mjs`、`attack-cap-park.mjs`、`attack-probe.mjs`、`attack-env.mjs`、`attack-stop-hung.mjs`、`crash-parent.mjs`、`fake-runner.mjs`、`a1.sh`…`a5`、`e2e.log`、`live.log`、`unit.log`、`integration.log` 等。

## 2. 结论

**FAIL**（3 个 P1，必须回 Develop 修复后重新独立 Review，再进行独立 Test）。

判定依据（均为本人亲自复现，非静态推断）：

1. **P1 WP11R1-01**：Runner 结果/退出回调没有错误隔离。用户在 Work 运行期间取消（`work.control cancel`）后，Runner 迟到的 `attempt.result` 会把 `ProtocolError` 抛出到真实 spawn 端口的 `readline` 监听器，整个 daemon 进程以 exit 1 崩溃，而不是按 `reliability.md` §2「Late 事件…不覆盖取消…仍保存诊断证据」拒绝并留证。
2. **P1 WP11R1-02**：运行时的进程探针永远无法确认 Runner 死亡。supervisor 写的身份是 `runner-<pid>-<runId>`，而 `parseRunnerPid` 只认 `pid:<n>`/纯数字，于是 `processAlive` 恒为 `null` → 任何心跳超时/进程退出都停靠为 `recovery_required` 且 `newAttemptAllowed=false`。`implementation.md` 与 plan 宣称的「确认进程已死 → `interrupted`（允许重试）」在真实运行时不可达；e2e/live 的 AC-057「与真实进程状态一致」断言因此只走了「不可确认」分支，属于自证式断言。
3. **P1 WP11R1-03**：模型网关的 capability 门禁 fail-open。被取代的旧 Attempt 的 token 仍然有效并被接受（HTTP 200）；Run 被停靠为 `interrupted`/`recovery_required` 后，旧 token 仍可继续调用 Provider。运行时代码从不在 Attempt 结束/停靠/取消时撤销 capability（`reliability.md` §2「撤销Capability」在真实路径上未实现，`execution.md` §2 要求的 attempt/epoch 重校验缺失）。

严重度汇总：

| 严重度 | 数量 | 编号 |
|---|---|---|
| P1 | 3 | WP11R1-01、WP11R1-02、WP11R1-03 |
| P2 | 8 | WP11R1-04 ~ WP11R1-11 |
| P3 | 6 | WP11R1-12 ~ WP11R1-17 |

是否阻断独立 Test：**是**。三个 P1 都是产品运行时代码缺陷（崩溃、不可达分支/自证断言、凭证门禁 fail-open），Test 若在此基础上执行，只能重复证明同一批错误路径。

## 3. 逐项检查

### 3.1 A1 运行时入口（全部亲自运行，临时 `AGENTDEV_HOME` + 真实 Git 仓库）

| 检查项 | 结果 | 证据 |
|---|---|---|
| `start` 幂等、二次 `start` 不能创建第二个 daemon（同一 home、默认端口） | 通过 | `a1.log` §4：CLI 第二次 `start` 返回 `already:true`；另起 daemon 进程返回 `ALREADY_RUNNING` exit 1，现场 lock/runtime.json 保留、pid 存活 |
| `status` 只读、停止时 exit 0 | 通过 | `a1.log` §1/§9b：`{"ok":true,"running":false,...}` exit 0 |
| `open` 按 canonical root 幂等（含子目录归一） | 通过 | `a1.log` §5：两次 `open` 与 `open <repo>/sub` 均返回同一 projectId 与 root |
| `stop` 删除 `runtime.json`+`daemon.lock` 并释放端口 | 通过 | `a1.log` §9：两文件不存在；admin/4318/4317 重新 bind 均 `free` |
| 陈旧锁（死 pid）被接管并推进 epoch | 通过（日志文案有误导，见 P3-14） | 手写 `pid=9999999, epoch=7` 后 `start`：epoch 变为 8、`replacedStale` 生效（`a1.log` §10） |
| admin 面无安装凭证拒绝 | 通过 | `no-cred http=401`、`wrong-cred http=401`、`with-cred http=200`（`a1.log` §6） |
| `doctor` 拒绝非 0600 凭证 | **不通过（生产路径）** | 直接调用 `probeRuntime(home)` 会拒绝，但 `doctor` 命令忽略 `AGENTDEV_HOME`：`AGENTDEV_HOME` 下放 0644 凭证时，doctor 报 `home=/Users/huyaohua/.agentdev, installationToken=missing`、`blockers=[]`、exit 0（见 P2-07） |
| HTTP 面仅回环 | 通过 | `lsof -a -p <pid> -iTCP -sTCP:LISTEN` 全部为 `127.0.0.1:*`；`curl http://172.16.8.76:4718/healthz` → `000`（拒绝），`127.0.0.1` 无头 → 200（`a2.log` §A） |
| 单实例锁并发语义 | **不通过** | 全新 home 上 6 个并发 daemon（不同端口）：2 个报告 `started`（pid 92371/92372，均 epoch 1），失败者在回滚中删除了存活者的 `daemon.lock` 与 `runtime.json`，最终 `NO LOCK` 而两个 daemon 仍在跑（`a2.log` §B）；默认端口并发 CLI `start` 则只起 1 个（`a3.log`） |
| `projects.json` 注册表被 `start` 使用 | **不通过** | `start --root R` → `open R`（注册表已有 1 项）→ `stop` → 直接 `start`：`"instances": []`（`a5` 输出，见 P2-08） |

### 3.2 Supervisor 语义（真实 `ProjectStore`+`RunLifecycle`+`RunRecoveryService`，仅 OS 进程用脚本化端口；另用真实 spawn 端口做端到端复现）

| 检查项 | 结果 | 证据 |
|---|---|---|
| 一个 Run 会不会跑两个 Attempt | 未观察到 | `beginAttempt` 在事务内把 Run 置为 `running`，`queued()` 只取 `queued`，同一 tick 内也不会重复；但 `claim()` 的 `this.live.has(run.id)` 是死代码（live 以 attemptId 为键，见 P3-12） |
| `ownerEpoch`/epoch 围栏对命令/事件/结果生效 | 通过（结果/ready 侧） | 伪造 epoch 的 `attempt.ready` 不改变 Attempt 状态；伪造 epoch 的结果被丢弃，Run 仍 `running`（`attack-supervisor.mjs` T6） |
| 心跳 5s/20s：会跳动的静默 Attempt 不被停靠 | 通过 | 80s 内心跳持续，`parked=[]`，Run 仍 `running`（T5） |
| 静默但进程已确认死亡 → `interrupted`（可重试） | **不可达** | 真实探针无法解析 supervisor 自己写的 runnerId，`processAlive` 恒为 `null`；e2e 实测证据串直接写 `parked it as recovery_required`（见 P1-02） |
| 静默且无法确认 → `recovery_required`、拒绝新 Attempt | 通过（但它是唯一分支） | T4 alive=true：`recovery_required`，`admission.allowed=false`；T4 alive=false（内存探针）→ `interrupted` 且允许重试，说明规则本身正确、只有真实探针坏了 |
| 被杀 Runner 留下合法、不重复的状态 | 部分通过 | T4/`e2e`：Attempt `lost`，Run 停靠一次、无双写者；但代价是 P1-02 的「永远 recovery_required」 |
| `newAttemptAdmission` 在开新 Attempt 前被检查 | 通过 | `run-lifecycle.ts:119-131` 在插入 Attempt 前调用；T4 输出 `allowed=false` |
| 并发上限（project=4、Chief 预留、roleConcurrency=2） | 通过 | T7：1 chief + 2 backend（5 个 backend 排队）；`attack-concurrency.mjs`：2 chief + 2 backend = 4，frontend 不进入，第二 tick 不新增 |
| usage 恰好记账一次（累加后结算） | 通过 | T2：两次网关 usage（10+5）在 `settle` 时一次记入 `budget.tokensUsed=15`，`run.ended` 事件 1 条；重复 result 不会二次计费（会抛错，见 P1-01） |
| Runner 结果在用户取消后到达 | **崩溃** | T3 抛 `VALIDATION_ERROR: cannot move cancelled → completed`；用真实 spawn 端口在独立进程复现 → 进程 exit 1（见 P1-01） |
| 优雅 `stop`：Runner 安全停与进程回收 | **不通过** | 会应答的 Runner → Run 被结算为终态 `cancelled`（T8）；忽略 SIGTERM 的 Runner → SIGKILL 计时器被 `clearKillTimer` 清掉、200ms 后即返回，子进程在 daemon 退出后成为孤儿（`attack-stop-hung.mjs`；daemon 级 `a4.log`：stop 后 runner 子进程仍存活） |

### 3.3 信任边界（真实 `ModelGateway` + 真实 `createModelGatewayProxy` + 真实 `AttemptCapabilityStore`）

| 攻击 | 结果 |
|---|---|
| 缺失 token | 401 `NOT_AUTHORIZED` |
| 伪造 token | 401 `NOT_AUTHORIZED` |
| 过期 token | 403 `AUTH_EXPIRED`，并从 store 移除 |
| Run 终态（completed）后调用 | 409 `INVALID_STATE`，并撤销该 capability |
| 请求与冻结模型不一致 | 409 `CONFIG_INVALID`，绝不替换 |
| 非 JSON / 空 messages / 5MiB 超限 body | 400 `VALIDATION_ERROR` |
| `GET /models` | 200，只返回冻结模型 |
| **被取代的旧 Attempt capability** | **200，仍被接受**（两个 Attempt 的 token 同时有效；见 P1-03） |
| **Run 被停靠为 interrupted / recovery_required 后** | **200，仍被接受并产生真实 Provider 调用**（见 P1-03） |
| Runner 每 Attempt `models.json` | 只含 capability 作 `apiKey`，无 Provider secret（`runner-spawn.ts:47-74`，0600） |
| Runner 子进程环境 | **继承 daemon 全量 `process.env`**：注入哨兵 `AGENTDEV_PROVIDER_SECRET` 后，真实 spawn 端口启动的子进程读到该哨兵（`attack-env.mjs`，见 P2-11） |
| 失败路径遮蔽凭证 | 网关/传输层失败信息只回错误码与消息，日志无 Authorization 值；全仓库与 `/tmp/wp11rev` 扫描 `sk-[A-Za-z0-9]{24,}` 无命中 |

### 3.4 两个 drill 是否真的在跑产品代码（本人静态审计 + 独立子代理复核，结论一致）

- 两个 drill 都调用 `core.createProjectExecution`，并注入 `apps/daemon/src/prepare-run.ts` 的 `createPrepareRun` 与 `apps/daemon/src/runner-spawn.ts` 的 `createChildRunnerSpawnPort`；`execution.start()` → `RunnerSupervisor.tick()` → 真实 `apps/runner` 子进程（源码模式，`AGENTDEV_RUNNER_ENTRY`）→ capability 网关 → 真实 `ModelGateway` → 产品自有 `transport-http.ts`。没有重写 supervisor/spawn/gateway。
- Run 的 `completed` 只能由 Runner 自己的 `attempt.result` 触发（`supervisor.ts:474-478/516-517`）；drill 不直接写 Run 状态。
- 模型调用是真的：e2e 断言本地桩被调用（调用计数增量）且 `tokensUsed >= 13`；live 断言 `tokensUsed > 0`（实测 938 tokens）且真实 Provider HTTP 200。二者都不是「至少一次」以外的强断言（见 P3-16）。
- **但 AC-057 的停靠一致性断言是自证式的**：由于 P1-02，`interrupted` 分支不可能进入，`else` 分支的 `allowed=false && requiresRecoveryDecision=true` 在「进程真的死了」和「身份无法解析」两种情况下完全一样。e2e 证据串本身就写着杀进程后得到 `recovery_required`（与代码注释和 `implementation.md` 的说法相反）。

### 3.5 回归与卫生（命令与计数）

| 命令 | 结果 |
|---|---|
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0（Prettier 全通过） |
| `pnpm docs:check` | exit 0（15 文档 / 54 链接 / 94 AC / 9 需求 / 11 工作包） |
| `pnpm test:unit` | exit 0，**59 files / 1147 tests**（与 implementation.md 一致） |
| `pnpm test:integration -- --maxWorkers=4` | exit 0，**29 files / 322 tests**（一致） |
| `pnpm build` | exit 0 |
| `pnpm test:e2e` | exit 0，**21 checks — PASS 17 / FAIL 0 / UNVERIFIED 4**（一致） |
| `pnpm test:live` | exit 0，**5 passed / 0 failed / 2 unverified，11×HTTP 200**（一致） |
| `pnpm doctor` | exit 0 —— 注意：`pnpm doctor` 命中的是 **pnpm 自带 doctor**，不是产品脚本；产品 doctor 需 `node apps/cli/dist/cli.js doctor`（exit 0，`execution ready: yes`） |
| 临时目录/进程/端口残留 | 无（`/tmp/agentdev-*` 仅有一个 2026-09-13 的旧文件，早于本轮；无 daemon/runner 进程；4317/4318 空闲） |
| 越界写入 | 无：完整 daemon 运行后，种子仓库 `git status --porcelain` 为空；写入全部落在 `AGENTDEV_HOME` 下（`runtime.json`/`daemon.lock`/`projects.json`/`logs`/`projects/<id>`）；doctor 的 `.agentdev-doctor-*` 临时目录已清理 |
| 秘密泄漏 | 仓库与 scratch 中均无 `sk-…` 命中 |

### 3.6 记录诚实性（`implementation.md` vs 实测）

属实且复现：unit 59/1147、integration 29/322、e2e 21（17/0/4）、live 5（0 failed，11×HTTP 200）、daemon runtime 集成 5 例、CLI runtime 集成 4 例、`apps/daemon/test/attempt.integration.test.ts` 断言 `providerCalls === 1`、stale lock 接管、`stop` 清理、admin 401 等。

不实/夸大：

- **line 41**「确认进程已死 → `interrupted`（允许重试），进程状态无法确认 → `recovery_required`」：前半句在真实运行时不可达（P1-02）。
- **line 50**「Provider Secret 从不进入 Runner」：`models.json` 确实只有 capability，但 Runner 子进程继承 daemon 全量环境变量；本轮 live 演练正是用环境变量提供 Provider 凭证（P2-11）。
- **line 16**「按注册表或 `--root` 打开项目」：注册表分支实际不可达（P2-08）。
- **line 11**「并发 start 只允许一个持有者」：单测是顺序的；真实并发会同时存在两个持有者（P2-10）。
- **line 40**「`attempt.error` … 调用 `RunRecoveryService.recoverRun` 按真实进程状态停靠」：代码直接 `settle(failed)`（P2-04）。
- **line 41/plan A2-T5**「SIGTERM→10s→SIGKILL」：`stop()` 里 SIGKILL 计时器被立即清除，且 grace 被压到 200ms（P2-06）。
- 被低估的（true but understated）：`attempt.result` 的正文被丢弃、不落 `stage_result`（P3-15）；capability TTL 1h 与注释不符（P3-17）；live drill 的 `sessionRef` 断言空转（P3-16）。

## 4. 发现清单

### WP11R1-01（P1）Runner 结果/退出回调未隔离错误：取消后到达的结果会让整个 daemon 崩溃

- 证据：`packages/core/src/supervisor.ts:474-478`（`attempt.result` → `finishFromResult`）→ `:516-517` `this.lifecycle.settle(entry.runId,'completed')`；`run-lifecycle.ts:54` 的 `fail()` 抛出；异常经 `supervisor.ts:425` → `apps/daemon/src/runner-spawn.ts:109`（`lines.on('line', …)` 内无 try/catch）成为未捕获异常。`work.control cancel` 的真实入口：`apps/daemon/src/protocol.ts:1665` → `packages/core/src/findings.ts:2518` `this.lifecycle.cancel(run.id)`。
- 复现（真实 spawn 端口 + 真实 supervisor + 真实 RunLifecycle，子进程为真实 node runner）：
  ```bash
  node /tmp/wp11rev/crash-parent.mjs; echo "EXIT=$?"
  # parent: cancelled run -> status=cancelled
  # ProtocolError: Run … cannot move cancelled → completed
  #   at RunnerSupervisor.finishFromResult (supervisor.ts:517)
  #   at RunnerSupervisor.onMessage (supervisor.ts:476)
  #   at Interface.<anonymous> (apps/daemon/src/runner-spawn.ts:109)
  # EXIT=1
  ```
  同类现象：同一 Attempt 的重复 `attempt.result` 抛 `cannot move completed → completed`；子进程在 store 关闭后退出时 `onExit`（`supervisor.ts:547`）抛 `TypeError: The database connection is not open`（`/tmp/wp11rev/hung.err`）。
- 影响：任何在 Run 运行期间取消 Work 的用户操作都可能杀死 daemon 进程（该进程服务所有 Project），并让 `runtime.json`/`daemon.lock` 的清理路径中断；这直接违反 `reliability.md` §2「Late 事件检查 attempt/epoch/expected 版本，不覆盖取消…拒绝迟到写入结果时仍保存诊断证据」。
- 修复：`finishFromResult`/`failAttempt` 先读取 Run 当前状态，仅允许从 `running/starting/waiting_*` 结算；迟到/重复结果改走 `RunRecoveryService.acceptAttemptResult` 并把拒绝写为 `stage.result_rejected` 证据；同时在 `runner-spawn.ts` 的 `onMessage`/`onExit` 监听器与 `supervisor.onMessage` 外层加 try/catch（回调绝不能抛出到 EventEmitter）。

### WP11R1-02（P1）真实进程探针无法确认 Runner 死亡：`interrupted`（可重试）分支不可达，AC-057 证据自证

- 证据：`supervisor.ts:382-383` 身份格式 `runner-${pid}-${runId}`（`:404-408` 用子进程 pid 重写）；`recovery.ts:116-121` `parseRunnerPid` 只接受 `^(?:pid:)?[0-9]+$`；`recovery.ts:698/758-768/785` 由 `processAlive===null` 推出 `risky=true → park_recovery_required → newAttemptAllowed=false`。`execution.ts:188-191` 与 drill（`e2e.mjs:2343`、`live-drills.mjs:1483`）都使用默认 `createNodeProcessProbe()`。
- 复现：
  ```bash
  node /tmp/wp11rev/attack-probe.mjs
  # parseRunnerPid("runner-84883-<uuid>") = null
  # 进程被 SIGKILL 后 process.kill(pid,0) = gone (ESRCH)，probe("<pid>") = false
  # 但 probe("runner-<pid>-<runId>") 仍 = null
  # real Run: inspection.processAlive = null -> parked as recovery_required
  # newAttemptAdmission = {"allowed":false,"requiresRecoveryDecision":true}
  ```
  端到端证据（`pnpm test:e2e` 产物，读后已还原）：`runtime.executes-attempt` 证据串为 “…killing the live Runner … parked it as **recovery_required** with Attempt … lost (new Attempt allowed=false)”；live 同样为 `parked it as recovery_required`（938 tokens 那次）。
- 影响：崩溃/心跳超时后 Run 永远不能进入可重试的 `interrupted`，每个被中断的 Run 都需要人工 RecoveryDecision；plan A2-T5 的退出条件（“杀 Runner 进程 → Run `interrupted`”）与 `implementation.md` line 41 均不成立；AC-057 的「stop 状态与真实进程状态一致」断言永远只验证「不可确认」分支，属自证式证据。
- 修复：让运行时自己的身份可解析（`parseRunnerPid` 支持 `runner-<pid>-…`，或 `runnerIdFor` 写 `pid:<n>`）；补一条真实子进程被 SIGKILL 后必须得到 `interrupted` + `allowed=true` 的 drill 断言。

### WP11R1-03（P1）capability 门禁 fail-open：旧 Attempt 的 token 有效，停靠后仍能调用真实 Provider

- 证据：`packages/core/src/capabilities.ts:77-81`（换发只替换**同一 attempt** 的旧 token，不同 Attempt 并存）；`gateway-http.ts:194-210`（只验 token 与 Run 是否终态，不比对 `capability.epoch`/最新 Attempt；`interrupted`/`recovery_required` 不在拒绝集合内）；`supervisor.ts`/`execution.ts` 全程不调用 `revoke`/`revokeRun`（`grep` 结果：真实调用点只有 `gateway-http.ts:207` 的终态撤销与到期自撤销）；`capabilities.ts:52` TTL 1 小时（注释却称 idleSessionTTLsec 量级）。
- 复现：
  ```bash
  node /tmp/wp11rev/attack-gateway.mjs
  # C superseded Attempt-1 capability after Attempt-2 was issued:
  #   cap1 still valid=true; call with the OLD cap1 => {"status":200,...}
  # D  parked interrupted           => {"status":200,...}
  # D2 parked recovery_required     => {"status":200,...}
  node /tmp/wp11rev/attack-cap-park.mjs
  # before park: HTTP 200; capability count=1
  # 被 supervisor 自己停靠（run.status=interrupted, attempt=lost）后：
  # after park: HTTP 200; capability still in store=true; capability count=1
  # Provider calls=2 usage reports=2
  ```
- 影响：`reliability.md` §2「Supervisor 核对进程/容器后撤销 Capability 并终止旧执行」与 `execution.md` §2「Capability 绑定 attempt/epoch…Broker 重新校验」在真实路径上没有实现；被宣布丢失的旧执行（最需要冻结写者/预算的场景）仍可花预算、拿模型输出，直到 1h TTL 结束。
- 修复：`RunnerSupervisor` 在 settle/park/stop/取消时 `capabilities.revokeRun(runId)`（或按 attempt 撤销）；网关在每个请求上核对 `capability.epoch === 最新 Attempt.ownerEpoch+1` 且该 Attempt 非终态；TTL 收到与 `idleSessionTTLsec` 一致的量级。

### WP11R1-04（P2）`attempt.error` 直接判 Run failed，未走 recovery

- 证据：`supervisor.ts:479-482` → `failAttempt`（`:523-532`）设 Attempt `failed` 并 `lifecycle.settle(runId,'failed')`；`grep recovery` 在该分支无调用。而 `implementation.md` line 40 声称 `attempt.error` 会调用 `RunRecoveryService.recoverRun`。
- 复现：`attack-supervisor.mjs` 加一条 `attempt.error` 消息即可看到 Run 直接 `failed`、无 `run.recovered` 事件（本轮 T3/T4 路径同源，`failAttempt` 代码即证据）。
- 影响：Runner 侧错误（可能伴随未知副作用）被记为普通失败而非 `recovery_required`，与 §6/§2 的恢复语义和实现记录不一致。
- 修复：`attempt.error` 统一走 `RunRecoveryService.recoverRun`（或至少按 `newAttemptAdmission`/未知副作用判定停靠状态），并修正实现记录。

### WP11R1-05（P2）优雅 `stop` 把在跑 Run 结算为终态 `cancelled`（不可恢复）

- 证据：`supervisor.ts:239-264` 向活动 Attempt 发 `attempt.shutdown`；`apps/runner/src/attempt.ts:232-235` 对 shutdown 回 `attempt.result{status:'cancelled'}`；`supervisor.ts:514-515` 据此 `settle(runId,'cancelled')`。实测 `attack-supervisor.mjs` T8：`after stop: run.status=cancelled attempt.status=stopped`。
- 复现：`node /tmp/wp11rev/attack-supervisor.mjs`（T8 段），或对真实 daemon 做 `start`→让一个 Run 跑起来→`stop`。
- 影响：用户只是停 daemon，在跑的工作就被终结为 `cancelled`，无法 resume；`reliability.md` §7 要求的是「请求 Runner 安全停→保存 Checkpoint」，而非取消。
- 修复：为 Runner 增加“安全停/Checkpoint”命令（或让 shutdown 回 `interrupted` 语义），由 supervisor 把 Run 停靠为可恢复状态并撤销 capability；只有用户显式 cancel 才走 `cancelled`。

### WP11R1-06（P2）`stop()` 不回收忽略 SIGTERM 的 Runner，并清掉了 SIGKILL 升级计时器

- 证据：`supervisor.ts:245/259`（`graceMs = Math.min(graceMs, 200)`）与 `:260-263`：先 `terminate(entry,'SIGTERM')`（`:566-575` 设置 10s SIGKILL 计时器），随后立即 `clearKillTimer(entry)` 把计时器清掉；`stop()` 也不等待进程退出。
- 复现：
  ```bash
  node /tmp/wp11rev/attack-stop-hung.mjs
  # stop() returned after 201ms; child alive=true
  # run.status after stop=running attempt.status=running
  # child still alive 1.2s after stop=true
  bash /tmp/wp11rev/a4.sh   # daemon 级：stop 后 runner 子进程仍存活=1
  ```
- 影响：`agentdev stop` 会留下孤儿 Runner 进程，Run/Attempt 保持 `running`（仅在下次启动被 recoverAfterRestart 停靠）；与 `reliability.md` §7「回收容器/进程」及 A2-T5 的 SIGTERM→10s→SIGKILL 退出条件不符。
- 修复：删除 `stop()` 末尾的 `clearKillTimer` 循环（或在确认退出后清理），把 grace 用满 `cancelGraceSec`，并在返回前等待/确认子进程退出。

### WP11R1-07（P2）`doctor` 忽略 `AGENTDEV_HOME`，0600 凭证检查作用在错误目录

- 证据：`apps/cli/src/doctor.ts:311` `const dataDir = options.dataDir ?? join(homedir(),'.agentdev')`；`apps/cli/src/cli.ts:66` 只传 `startDir`；集成测试显式传 `dataDir: home`（`apps/cli/test/doctor.integration.test.ts:187`），因此测试不覆盖生产路径。
- 复现：
  ```bash
  AGENTDEV_HOME=/tmp/x node apps/cli/dist/cli.js doctor --json | node -e "…"
  # runtime= {"home":"/Users/huyaohua/.agentdev","installationToken":"missing","running":false,"instances":0}
  # executionReady= true blockers= []
  ```
  （`/tmp/wp11rev/a1/home2/installation-token` 为 0644，daemon/CLI 都会拒绝它，doctor 却 exit 0。）
- 影响：设置 `AGENTDEV_HOME` 的安装上，doctor 的凭证/运行状态结论指向另一个目录——真正的 0644 凭证不被拦，反而可能误报别的 home。
- 修复：doctor 命令用 `runtimeHomePath(process.env, homedir())`（或 `cliHome()`）解析 dataDir，并加一条 `AGENTDEV_HOME` 覆盖下的端到端断言。

### WP11R1-08（P2）`projects.json` 注册表被 `agentdev start` 忽略

- 证据：`apps/daemon/src/main.ts:315` `const roots = options.roots ?? registry.projects.map(…)`；`parseRuntimeArgs`（`:457-500`）始终返回 `roots: []`（初始化为 `[]`），`runAsProcess`（`:526-531`）据此传入，`??` 永不回落 → 注册表分支是死代码。
- 复现：
  ```bash
  AGENTDEV_HOME=$B/home node apps/cli/dist/cli.js start --root $B/repo
  AGENTDEV_HOME=$B/home node apps/cli/dist/cli.js open  $B/repo   # projects.json 已注册
  AGENTDEV_HOME=$B/home node apps/cli/dist/cli.js stop
  AGENTDEV_HOME=$B/home node apps/cli/dist/cli.js start
  # {"ok":true,"started":true,…,"instances":[]}
  ```
- 影响：`open` 注册过的项目在下次 `start` 后不会被打开（daemon 零项目），用户必须重新 `open`；与 plan D4/`implementation.md` line 16「按注册表或 `--root` 打开项目」不符。
- 修复：`parseRuntimeArgs` 在未给 `--root` 时返回 `roots: undefined`，或 main 里改为 `options.roots !== undefined && options.roots.length > 0 ? options.roots : registry…`。

### WP11R1-09（P2）CLI 失败输出没有 `operationId`

- 证据：`apps/cli/src/cli.ts:99-102` 的 `failure()` 只输出 `{ok:false,error:{code,message}}`；`START_TIMEOUT`（`:254-266`）也没有 `operationId`。`reliability.md` §7「失败退出非零并输出 error code 和 operationId」、plan A1-T3 退出条件均要求。
- 复现：
  ```bash
  node apps/cli/dist/cli.js open
  # stderr: {"ok":false,"error":{"code":"VALIDATION_ERROR","message":"open requires a path"}}
  node apps/cli/dist/cli.js start   # 入口不存在时
  # stderr: {"ok":false,"error":{"code":"START_FAILED","message":"…"}}
  ```
- 影响：失败无法与 operation/outbox 关联，违反 CLI 契约与可审计性要求。
- 修复：为每个失败命令生成并输出 `operationId`（并在重试语义上与 Core 的 operation 记录对齐）。

### WP11R1-10（P2）单实例锁非原子，且失败启动的回滚会删除存活者的锁/记录

- 证据：`packages/core/src/runtime.ts:148-168` 是「读锁 → 判活 → 写锁」，没有 `O_EXCL`/原子创建；`apps/daemon/src/main.ts:335-339` 启动失败调用 `runtime.stop()`，其中 `:202-203` `clearRuntimeRecord` + `releaseDaemonLock(home, epoch)`；两个并发者在空 home 上都会拿到 epoch 1，失败者的释放会命中存活者的 epoch。
- 复现：
  ```bash
  bash /tmp/wp11rev/a2.sh
  # race-3/race-4 均输出 {"status":"started",…,"epoch":1,…}（pid 92371 / 92372）
  # 之后：daemon.lock 不存在（NO LOCK），runtime.json 只剩 pid 92372，两个 daemon 都在监听
  # race-1/2/6: START_FAILED（project: UNIQUE constraint failed / cannot open the project database）
  ```
  （默认端口并发 CLI 测试 `a3.log`：只起 1 个，被端口占用与顺序 ALREADY_RUNNING 兜住。）
- 影响：plan A1-T1 退出条件「并发 start 只允许一个持有者」不成立；一旦出现（端口覆盖/自定义端口），会出现两个 daemon 共用同一 home/DB，并且存活者的锁与 `runtime.json` 被失败者删除，之后 `start/status/stop` 的判据全部失真。
- 修复：用原子创建（`open(path,'wx')`/`O_EXCL`）或带 mtime 的 flock 实现锁；回滚只在“我持有该 epoch”时释放（当前实现如此），但必须保证不会出现同 epoch 双持有者；并发打开同一 Project 的 `UNIQUE constraint` 也要做幂等处理。

### WP11R1-11（P2）Runner 子进程继承 daemon 全量环境变量

- 证据：`apps/daemon/src/runner-spawn.ts:165-168` `spawn(..., { env: { ...env } })`，`env = options.env ?? process.env`，而 `main.ts:273-277` 默认不注入 `runnerEnv`；`live-harness.mjs` 的 `runnerSpawn()` 也传 `{...process.env, AGENTDEV_RUNNER_ENTRY}`，而 `AGENTDEV_PROVIDER_SECRET` 正由 `scripts/lib/live-transport.mjs` 从环境读取。
- 复现：
  ```bash
  node /tmp/wp11rev/attack-env.mjs
  # {"AGENTDEV_PROVIDER_SECRET":"SENTINEL-DO-NOT-LEAK","PROVIDER_TOKEN":"second-sentinel"}
  ```
- 影响：`execution.md` §2「Provider Secret 只在 Core 受信侧，Runner 只持有短期 attempt capability」；`models.json` 是干净的，但任何存在于 daemon 环境里的凭证都会被 Runner（及其未来工具容器）读到。当前产品没有其它 secret 注册路径，live 演练正是靠环境变量供给，所以这是现实存在的边界弱点。
- 修复：spawn 时使用白名单环境（PATH/HOME/AGENTDEV_RUNNER_ENTRY 等），绝不透传 `process.env`；Provider Secret 只经 `SecretStore` 在 Core 内解析。

### WP11R1-12（P3）`claim()` 的“同一 Run 不重复”判断是死代码

- 证据：`supervisor.ts:362` `if (this.live.has(run.id)) continue;`，而 `this.live` 以 `attemptId` 为键（`:423` `this.live.set(attempt.id, entry)`）。真正的保护来自 `beginAttempt` 把 Run 移出 `queued`。
- 影响：语义误导，未来若 Run 状态机变化会直接变成「一个 Run 多个 Attempt」的漏洞。
- 修复：改用 `[...this.live.values()].some(e => e.runId === run.id)`，或直接以 Run 状态为唯一依据并加注释。

### WP11R1-13（P3）`ready` 门禁只作用于 Attempt，Run 在 `beginAttempt` 后即为 `running`

- 证据：`packages/core/src/run-lifecycle.ts:144-160` 在一个事务里把 Run `starting → running`；`supervisor.ts:452-467` 的 `attempt.ready` 只把 **Attempt** 置 `running`。实测 T1：`run.status=running attempt.status=starting`（`packages/core/test/supervisor.test.ts` 亦如此断言）。
- 影响：`reliability.md` §2 的「ready 确认 epoch/进程标识/环境后 Running」在 Run 状态上不成立；Runner 未 ready 时对外显示为 running。
- 修复：`beginAttempt` 只置 Run `starting`，在 `attempt.ready` 通过后由 supervisor 把 Run 置 `running`。

### WP11R1-14（P3）陈旧锁接管日志打印的是新持有者

- 证据：`apps/daemon/src/main.ts:141-145` 打印 `lock.lock.pid/epoch`（新锁）。实测：写入 `pid=9999999, epoch=7` 后启动，日志为 `took over a stale lock (pid 84810, epoch 8)`（`a1.log` §10）——`84810` 是新 daemon。
- 修复：记录并打印被替换的旧锁 pid/epoch，便于定位前一次崩溃。

### WP11R1-15（P3）`attempt.result` 的正文被丢弃，不落 `stage_result`

- 证据：`supervisor.ts:474-478/498-521` 只使用 `result.status`；`result.message` 仅存于内存 `entry.result`，无事件/行持久化；plan §2.2「结果落 `stage_result`/Run 终态」只完成后半。
- 影响：Run 完成没有可审计的阶段结果内容（本切片 drill 也只断言状态）。
- 修复：按 `protocol.md` §6 把 stage result 落 `stage_result` 并附 evidenceRefs。

### WP11R1-16（P3）drill 中存在空转/结构性恒真断言

- 证据：`scripts/lib/live-drills.mjs:1603-1606` `ensure(typeof attempt?.sessionRef === 'undefined' || …)` —— Attempt 没有该字段也没有任何写入点，恒真；`:1594-1597` `attempt.runnerId.startsWith('runner-')` 对 supervisor 产生的行恒真；e2e/live 只断言「至少 1 次 Provider 调用」（`localModelCalls` 增量 / `tokensUsed>0`），不是“恰好 1 次”（唯一精确计数在 `apps/daemon/test/attempt.integration.test.ts:292`）。
- 影响：这些断言不构成证据；AC-057 的核心一致性断言又因 P1-02 自证。
- 修复：删除空转断言，把 runnerId 断言改为“等于子进程 pid 且可被真实探针解析”，并对运行时 drill 增加“恰好 1 次 Provider 调用”的计数断言。

### WP11R1-17（P3）capability TTL 与注释不符；终态后的心跳仍改写 `heartbeat_at`

- 证据：`capabilities.ts:46-52` 注释称沿用 `idleSessionTTLsec`（默认 300s）但实现 `CAPABILITY_TTL_MS = 3_600_000`；`supervisor.ts:445-450` 对 `attempt.heartbeat` 只做 1s 节流，不检查 Attempt 是否已终态，已结算 Attempt 的 `heartbeat_at` 仍会被刷新。
- 修复：TTL 与 `LIMITS.idleSessionTTLsec` 对齐；心跳仅在 `starting/running` 时写。

## 5. 未验证 / 无法验证项

1. **P1-01 的 daemon 级崩溃**是用「与 daemon 完全相同的装配（真实 store/supervisor/lifecycle/spawn 端口）」在独立进程中复现的；没有通过真实 HTTP `work.control cancel` 再驱动一次 daemon（需要向 daemon 自己的 DB 播种可由协议触发的在跑 Run）。代码路径是逐行相同的。
2. **`onExit` 在 store 关闭后抛 `TypeError`** 已在独立进程中观测到；真实 daemon 中 `/stop` 后紧接 `process.exit(0)`，该竞态的命中窗口很小，未在 daemon 级复现。
3. **并发锁竞态**用的是“不同端口”的 daemon 直接入口以隔离锁；同端口并发 CLI 的结果是单 daemon（已测）。真实用户若只用默认 CLI 不易触发双 daemon，但锁删除/记录删除的机制真实存在。
4. **`pnpm test:acceptance`（94/94）未运行**：本轮指定命令集中不含它，且它属于 WP-10 的发布证据；`pnpm doctor` 命中的是 pnpm 自带命令，产品 doctor 已单独运行（exit 0）。
5. **浏览器类 AC-002/052/071/073/076 与 provider 多模型 AC-043**：drill 自报 UNVERIFIED，属已登记豁免，本轮未复核浏览器侧。
6. **Provider Secret 持久化（Keychain/0600 加密文件）**：已登记缺口，确认为未实现（`SecretStore` 无注册路径），本轮未把它计为缺陷；但由它派生的 P2-11（环境变量继承）计为缺陷。
7. **Pi SDK 是否先发 `GET /models`**：网关自己应答 `/models`，不会出现在 e2e 的 `localModelCalls` 里，未单独统计。

## 6. 独立复算的命令输出

```text
$ pnpm typecheck   → exit 0
$ pnpm lint        → exit 0   ("All matched files use Prettier code style!")
$ pnpm docs:check  → exit 0   ("docs:check ok — 15 documents, 54 internal links, 94 acceptance cases, 9 requirements, 11 work packages")
$ pnpm build       → exit 0

$ pnpm test:unit
 Test Files  59 passed (59)
      Tests  1147 passed (1147)

$ pnpm test:integration -- --maxWorkers=4
 Test Files  29 passed (29)
      Tests  322 passed (322)

$ pnpm test:e2e
PASS       runtime.executes-attempt  [AC-057] … Run … completed … (1 Provider call(s), 13 tokens booked);
          killing the live Runner of Run … (pid 89894) parked it as recovery_required with Attempt … lost (new Attempt allowed=false)
UNVERIFIED browser.rendering-and-isolation / browser.viewport-and-keyboard / browser.upload-client-hints / provider.fact-and-unknown
e2e: 21 checks — PASS 17 / FAIL 0 / UNVERIFIED 4
e2e: 24 ACs accounted for by the drill; exit 0

$ pnpm test:live   (真实 Provider https://api.deepseek.com / deepseek-flash)
PASS provider.connectivity / drill.html-explanation / drill.l1-typo / drill.l2-delivery / drill.runtime-attempt
drill.runtime-attempt: … 938 tokens booked from the Provider usage; killing the live Runner (pid 92222) … parked it as recovery_required
        with Attempt … lost (new Attempt allowed=false)
UNVERIFIED browser.html-rendering / provider.independent-models
live: 5 passed / 0 failed / 2 unverified; 11 call(s), HTTP 200×11, 0 failed; exit 0

$ node apps/cli/dist/cli.js doctor        # 产品 doctor（`pnpm doctor` 命中 pnpm 自带 doctor，非产品脚本）
ok node 24.8.0 / pnpm 12.3.4 / git 2.39.3 / pi-sdk 0.85.1 / docker 28.4.0 (agentdev/exec:0.0.0)
ok dir /Users/huyaohua/.agentdev ; info port 4317 free ; info port 4318 free
ok runtime /Users/huyaohua/.agentdev — credential missing, not running
execution ready: yes ; exit 0

$ bash /tmp/wp11rev/a1.sh    # 入口全流程
status(running:false, exit0) → start(started pid 84474 epoch 1) → second start(already:true)
second daemon: "ALREADY_RUNNING: … (pid 84474, epoch 1)" exit 1，lock/record 保留、pid 存活
open×2 与 open <repo>/sub → 同一 projectId a5c0562d…，root=/private/tmp/wp11rev/a1/repo
admin: no-cred 401 / wrong-cred 401 / with-cred 200
cred 0644 → CLI status exit 1（readCredential 拒绝）；doctor（AGENTDEV_HOME 下）仍 exit 0
stop → runtime.json/daemon.lock 均消失；admin/4318/4317 重新 bind 全部 free；status exit 0
stale lock(pid 9999999, epoch 7) → start 成功，新 epoch 8

$ bash /tmp/wp11rev/a2.sh    # 回环 + 并发
lsof -a -p <pid>：TCP 127.0.0.1:4718 / 4717 / 51706 / 51707（仅回环）
curl http://172.16.8.76:4718/healthz → 000（拒绝）
并发 6 daemon（不同端口）：2 个 started（pid 92371/92372, epoch 1），最终 NO LOCK，两个 daemon 仍在监听

$ node /tmp/wp11rev/attack-supervisor.mjs
T1 after tick: run.status=running attempt.status=starting commands=[]
T2 run.status=completed budget.tokensUsed=15 run.ended events=1
T2b 重复 result → VALIDATION_ERROR: cannot move completed → completed
T3 cancel → cancelled；current-epoch result → THREW ProtocolError/VALIDATION_ERROR
T4 probe.alive=false → interrupted + allowed=true；probe.alive=true → recovery_required + allowed=false
T5 80s 心跳 → parked=[] run.status=running
T6 伪造 epoch 的 ready/result 被丢弃，run 仍 running
T7 claimed=3 spawnedRoles=["chief","backend","backend"]
T8 stop 后：run.status=cancelled attempt.status=stopped

$ node /tmp/wp11rev/crash-parent.mjs   # 真实 spawn 端口 + 真实 supervisor
parent: cancelled run -> status=cancelled
ProtocolError: Run … cannot move cancelled → completed
  at RunnerSupervisor.finishFromResult (packages/core/src/supervisor.ts:517)
  at Interface.<anonymous> (apps/daemon/src/runner-spawn.ts:109)
EXIT=1

$ node /tmp/wp11rev/attack-probe.mjs
parseRunnerPid("runner-84883-<uuid>") = null
process.kill(pid,0) after SIGKILL = gone (ESRCH)
probe("runner-<pid>-<runId>") after死亡 = null；probe("<pid>") = false
real Run: processAlive=null → parked as recovery_required → admission allowed=false

$ node /tmp/wp11rev/attack-cap-park.mjs
before park HTTP 200（capability count=1）
parked=[…] run.status=interrupted attempt.status=lost
after park HTTP 200（capability still in store=true, count=1）；Provider calls=2

$ node /tmp/wp11rev/attack-gateway.mjs
missing 401 / garbage 401 / expired 403 / terminal 409（并撤销）/ other-model 409 / non-JSON 400 / empty 400 / 5MiB 400 / GET /models 200
旧 Attempt cap1 still valid=true and OLD cap1 => 200
parked interrupted => 200 ; recovery_required => 200

$ node /tmp/wp11rev/attack-env.mjs
{"AGENTDEV_PROVIDER_SECRET":"SENTINEL-DO-NOT-LEAK","PROVIDER_TOKEN":"second-sentinel"}

$ bash /tmp/wp11rev/a4.sh    # daemon 级 stop（忽略 SIGTERM 的 Runner）
daemon pid=94283 …；stop exit=0 took 1s；runtime.json left: no；lock left: no；daemon alive: 0
runner child still alive after stop? 1   ← 孤儿进程

$ git status --porcelain   # 本报告写入前
(空)
```
