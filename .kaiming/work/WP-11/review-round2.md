# WP-11（运行时与 Runner 执行器）独立 Review 报告（第 2 轮）

- 角色：独立 Review（独立上下文；未读取任何开发聊天、transcript 或 session log；仅依据仓库文件、git 对象、第 1 轮报告与本轮自建实验）
- 工作包：WP-11 A1 + A2（修复轮复核）
- 冻结点：commit `6b0228f9e7242123ca2a43d73b82e0423283886b`，tree `b8d76f448d63bc398618cbb4789f00a17aef11ad`
- 证据目录：`/tmp/wp11rev2/`（自建复现脚本、攻击脚本与原始输出日志）
- 唯一写入：`.agentdev/work/WP-11/review-round2.md`（测试改写的 `.agentdev/work/WP-10/{e2e,live}*` 已 `git checkout --` 还原；最终工作树干净）
- 环境：macOS，node v24.8.0，pnpm 12.3.4；Docker 可用（`agentdev/exec:0.0.0`）；Provider 凭证仅通过环境变量传给 `pnpm test:live`，未落盘、未回显

## 1. 冻结与哈希

```text
$ git status --porcelain
(空)
$ git rev-parse HEAD
6b0228f9e7242123ca2a43d73b82e0423283886b
$ git rev-parse HEAD^{tree}
b8d76f448d63bc398618cbb4789f00a17aef11ad
$ git log --oneline -1
6b0228f fix(core,daemon,cli): close the WP-11 review round-1 findings
$ ls .agentdev/work/WP-11/
implementation.md  plan.md  review.md
```

- 修复提交 diff 已逐行阅读：`apps/cli/src/cli.ts`、`apps/cli/src/doctor.ts`、`apps/daemon/src/{main,runner-spawn}.ts`、`packages/core/src/{capabilities,execution,gateway-http,runtime,supervisor}.ts`、`scripts/lib/live-drills.mjs` 及两个测试文件；`scripts/e2e.mjs` 与 `scripts/lib/e2e-runtime.mjs` **未被本提交改动**（见 WP11R2-04）。
- 冻结后首次记录：`git status --porcelain` 为空。

## 2. 结论

**PASS（不阻断独立 Test）；但 `implementation.md` T9 的修复并非全部成立，登记 4 个 P2 与 3 个 P3。**

判定依据（全部为本人亲自复现，命令与原始输出见 §7）：

1. 第 1 轮三个 P1 的**原始缺陷本身**均已真实关闭：取消后迟到的 `attempt.result` 不再让 daemon 崩溃（真进程实测 SURVIVED）；真实探针能解析 `pid:<n>`，SIGKILL 后 Run 确实走 `interrupted` 且 `newAttemptAdmission.allowed=true`（e2e/live 证据串均为 `interrupted`）；capability 在停靠/终态/epoch 不符/端点重启后全部失效（401/409，且被撤销）。
2. 但修复轮引入/遗留了 4 个 P2：daemon 级优雅停止仍会留下孤儿 Runner；`recovery_required` 停靠的 Run 在产品内没有恢复路径；迟到结果会把已 `stopped` 的 Attempt 改写成 `completed`（违反 `RUN/ATTEMPT_TRANSITIONS`）；`start` 的两条失败路径仍无 `operationId`。
3. 运行时确实在跑产品代码：`pnpm test:e2e` 的 `runtime.executes-attempt` 与 `pnpm test:live` 的 `drill.runtime-attempt` 都经过真实 supervisor/spawn/网关/真实子进程；本报告用「回声 Runner」与「失明探针」两组对照实验证明其断言具有鉴别力（§4）。
4. 回归与卫生全部通过，工作树干净，无残留进程/端口/凭证。

严重度汇总：

| 严重度 | 数量 | 编号 |
|---|---|---|
| P0 | 0 | — |
| P1 | 0 | — |
| P2 | 4 | WP11R2-01、WP11R2-02、WP11R2-03、WP11R2-04 |
| P3 | 3 | WP11R2-05、WP11R2-06、WP11R2-07 |

是否阻断独立 Test：**否**（无 P0/P1；4 个 P2 均不涉及 fail-open 准入、凭证泄漏、双写者或结算重复，且都留下了可继续推进的路径）。建议在 Test 之前或紧随其后安排一次小修复，并在结算记录中如实登记。

## 3. 第 1 轮发现逐条复核

| 编号 | 轮 1 结论 | 本轮复现方式 | 现在的观测结果 | 结论 |
|---|---|---|---|---|
| WP11R1-01 | P1 迟到结果崩溃 daemon | 真 `child_process` spawn 端口 + 真 supervisor，子进程 1.2s 后回报 completed；先 `RunLifecycle.cancel` | `supervisor: ignoring the late result …`；`run.status=cancelled`；父进程 `EXIT=0`（轮 1 为 EXIT=1） | **已关闭**（遗留下游状态问题，另见 WP11R2-03） |
| WP11R1-02 | P1 探针无法确认死亡 | 真 `createNodeProcessProbe` + 真子进程 SIGKILL；外加 `pid:pending` 与「pid 复用」攻击 | `parseRunnerPid('pid:123')=123`；SIGKILL 后 `probe=false`，Run=`interrupted`，admission `allowed=true`；`pid:pending`→`processAlive=null`→`recovery_required`；pid 复用（活体冒名者）→`recovery_required` | **已关闭**（`pid:pending`/复用均 fail-closed，诚实） |
| WP11R1-03 | P1 capability 门禁 fail-open | 真 `AttemptCapabilityStore`+`ModelGateway`+`createModelGatewayProxy`+真 supervisor（`onAttemptEnded` 注入 product 的 `capabilities.revoke`） | 停靠前 200；停靠后同一 token 401 且 store 中已消失；旧 epoch 401；Run 终态 409；已 `completed` 的 Attempt 401；端点重启后旧 token 401；transient 429 后同一 Attempt 仍可重试 200 | **已关闭** |
| WP11R1-04 | P2 `attempt.error` 直接判 failed | 脚本化 spawn 端口 + 真 recovery | `attempt.error` → `run.status=recovery_required`、`run.recovered` 事件、走 recovery 而非直接失败 | **已关闭**（Attempt 记为 `failed` 而非 `lost`，与 `implementation.md` T9 行文略有出入，不单独计缺陷） |
| WP11R1-05 | P2 优雅 stop 把 Run 判 cancelled | 真子进程（会应答 shutdown）+ `stop()` | `run.status=recovery_required`、`attempt.status=stopped`、无 `cancelled` 终态 | **已关闭** |
| WP11R1-06 | P2 忽略 SIGTERM 的 Runner 变孤儿 | 见 §7 的 `a4`（假 stubborn Runner）与 `a4b`（真实 `apps/runner` 源码入口）daemon 级停止 | 真实 Runner：stop 后子进程立即消失（不留孤儿）；**忽略 SIGTERM 的 Runner：`agentdev stop` 后孤儿存活，重启 daemon 后仍存活** | **仍存在（真实 daemon 路径）** → WP11R2-01 |
| WP11R1-07 | P2 `doctor` 忽略 `AGENTDEV_HOME` | `AGENTDEV_HOME=<other> cli doctor --json`，凭证 0644 / 0600 两态 | `home=<other>`、`installationToken=insecure`、`executionReady=false`、blocker 命中 0644 凭证；改 0600 后 `ok/true` | **已关闭** |
| WP11R1-08 | P2 `projects.json` 被 `start` 忽略 | `start --root` → `stop` → 裸 `start`；再 `open` 第二个项目 → `stop` → 裸 `start` | 两次裸 `start` 都重新打开已登记项目（`instances` 含 1 个 / 2 个）；显式 `--root` 也写入 `projects.json` | **已关闭** |
| WP11R1-09 | P2 CLI 失败无 `operationId` | `open`（缺参）、`start --bogus`、`start --root`（缺值）、`AGENTDEV_DAEMON_ENTRY` 缺失、daemon 不答 | 前三条带 `operationId`；**`START_FAILED` 与 `START_TIMEOUT` 仍不带 `operationId`** | **部分关闭** → WP11R2-04 |
| WP11R1-10 | P2 锁非原子/回滚删他人记录 | 全新 home 上 6 个并发 daemon（`--no-web`，不同 admin 端口），2.5s 后观察 | 恰好 1 个 `started`（epoch 1），5 个 `ALREADY_RUNNING`；`daemon.lock`/`runtime.json` 与唯一持有者一致，仅 1 个进程存活、仅 1 个监听端口 | **已关闭** |
| WP11R1-11 | P2 Runner 继承 daemon 全量 env | 真 spawn 端口启动探针子进程，daemon 侧注入 `AGENTDEV_PROVIDER_SECRET/BASE_URL/MODEL` 与第二个哨兵 | 子进程仅 10 个键（`PATH/HOME/TMPDIR/LANG/SHELL/USER/LOGNAME/TERM/AGENTDEV_RUNNER_ENTRY/__CF_USER_TEXT_ENCODING`），无任何 `AGENTDEV_PROVIDER_*`/哨兵 | **已关闭**（白名单仍含 `NODE_OPTIONS`，见 WP11R2-05） |
| WP11R1-12 | P3 `claim()` 死代码 | 代码复核 | 已改为 `[...this.live.values()].some(e => e.runId === run.id)` | **已关闭** |
| WP11R1-13 | P3 Run 先 running 后 ready | 真 supervisor tick 后读行；`packages/core/test/supervisor.test.ts:237-239` | `run.status=running`、`attempt.status=starting`、`runner.commands=[]`（prompt 仍等 ready） | **仍存在（已登记残余，未修复）** |
| WP11R1-14 | P3 陈旧锁日志打印新持有者 | 写 `pid=999999,epoch=7` 后 `start` | `agentdevd: took over a stale lock from pid 999999 (epoch 7); this daemon now holds epoch 8` | **已关闭** |
| WP11R1-15 | P3 结果正文不落 `stage_result` | 真 Attempt 完成/迟到结果后统计 | `stage_result rows = 0`；正文只在内存与日志 | **仍存在（已登记残余，未修复）** → WP11R2-06 |
| WP11R1-16 | P3 drill 空转断言 | 阅读修复 diff + 运行两条命令 | `sessionRef` 恒真断言已删；`runnerId` 断言改为 `/^pid:[0-9]+$/`；live 增加严格 `parked === 'interrupted'` | **已关闭**（e2e 侧未同步收严，见 WP11R2-04 第 3 点） |
| WP11R1-17 | P3 TTL 注释不符、终态后写心跳 | 代码复核 | 注释改为「1 小时 + 每次调用重校验」；心跳仅在 `starting/running` 落库 | **已关闭** |

两个已登记残余的判断：

- **WP11R1-13（Run 早于 ready 变 running）不阻断。** 状态机允许 `queued→starting→running`，`reliability.md` §2 的「ready 确认 epoch/进程标识/环境后 Running」在 Attempt 维度已成立（prompt 仍等 ready）；对外展示偏早是语义精度问题，不是安全或正确性缺口。登记为残余是诚实的。
- **WP11R1-15（结果正文不落 `stage_result`）不阻断。** `data.md` §2 与 `protocol.md` §6 把 `stage_result` 定义为 **`stage.submit` 业务提交**的产物（由 Capability 鉴权的阶段提交路径写入），`attempt.result` 并不是它的写入契约；本切片 Runner 仍是无工具会话，阶段提交路径尚未接线。`plan.md` A2-T4 的「结果落 `stage_result`/Run 终态」表述与最终架构契约有偏差，属计划措辞问题；`implementation.md` T9 已显式登记，不是隐瞒。
- 两项都已如实披露（`implementation.md` 第 106-107 行），未发现「声称已修复」的情形。

## 4. 本轮新检查

1. **e2e/live 两条运行时检查是否真在跑产品路径**：两者都调用 `core.createProjectExecution`，注入 daemon 自己的 `createPrepareRun` 与 `createChildRunnerSpawnPort`，源码模式启动真实 `apps/runner`；Run 的 `completed` 只能由子进程自己的 `attempt.result` 触发。未发现重写 supervisor/spawn/gateway 的桩。
2. **断言鉴别力（对照实验）**：
   - 换成「回声 Runner」（ready 后回 `attempt.result{status:'failed'}`）：`run.status=failed`、`attempt.status=failed` → Run 终态确实由子进程消息驱动（HELD）。
   - 同一「真实 SIGKILL 死进程」场景，把探针换成恒 `null` 的失明探针：Run 变 `recovery_required`、`admission.allowed=false` → 严格 `interrupted` 断言在该场景下会 FAIL（**具备鉴别力，非自证**）。
3. **`recovery_required` 之后有没有恢复路径**（新暴露）：记录一条 accepted 的 RecoveryDecision 后，`newAttemptAdmission` 仍 `requiresRecoveryDecision=true`、`resolvedByDecisionId=null`；supervisor 再 tick 不认领；`FindingService.pauseWork` 直接 `RECOVERY_REQUIRED: … has Runs whose side effects are unresolved`。`interrupted` 场景下 `pauseWork`→`resumeWork` 可以开出新 Attempt（attempts 1→2），但这是间接路径且需要 Work 未处于 blocked/cancelling。
4. **锁的并发语义**：全新 home 上 6 个并发 daemon 直接入口，只有 1 个持有者且失败者不再删他人记录。
5. **子进程环境**：真 spawn 端口 + 探针子进程确认白名单生效；另测 `NODE_OPTIONS` 仍被透传（注入代码确实在 Runner 内执行，但读不到 Provider secret）。
6. **能力门禁的防御纵深**：分别验证 supervisor 侧 `onAttemptEnded` 撤销与端点侧重校验两条独立路径；并验证 transient Provider 错误（429）后同一 Attempt 的合法重试仍返回 200。
7. **daemon 级优雅停止（真 Runner 与 stubborn Runner 两态）**：真实 Runner 立即退出无孤儿；stubborn Runner 在 daemon 退出后仍存活（WP11R2-01）。
8. **医生/入口/失败输出**：`AGENTDEV_HOME`、注册表回落、`operationId` 全覆盖性、陈旧锁接管日志。

## 5. 新发现清单

### WP11R2-01（P2）daemon 级优雅停止对「不响应 shutdown 且忽略 SIGTERM」的 Runner 仍留孤儿进程

- 证据：`packages/core/src/supervisor.ts:288-296`（超时后 `this.live.delete(entry.attemptId)` → `terminate(entry,'SIGTERM')` → `markAttemptStopped`/`park`/`ended`），`packages/core/src/supervisor.ts:696-708`（SIGKILL 升级计时器按 `entry.killTimer` 保存，而该 entry 已从 `live` 删除且计时器 `unref()`），`apps/daemon/src/main.ts:193-195`（`for (const execution of executions) await execution.stop()` 后立即进入关闭流程），`apps/daemon/src/main.ts:559-561`（`runtime.stop().then(() => process.exit(0))`）。因此 `stop()` 返回时既没有等待子进程确认退出，也没有任何 SIGKILL 会在 daemon 退出后触发。
- 复现（daemon 级，使用真 spawn 端口 + 忽略 SIGTERM 的 Runner 脚本）：
  ```bash
  bash /tmp/wp11rev2/a4-daemon-stop.sh
  # start exit=0；runner pid before stop: 62346
  # stop exit=0
  # ORPHAN: runner 62346 alive right after stop=yes
  # inspect the Run after stop: {"run":{"status":"recovery_required",…},"attempts":[{"status":"stopped","runnerId":"pid:62346"}]}
  # restart …
  # ORPHAN: runner 62346 still alive after restart=yes
  ```
  对照组（真实 `apps/runner` 源码入口，会正常响应 SIGTERM）：
  ```bash
  bash /tmp/wp11rev2/a4b-daemon-stop-real.sh
  # runner children before stop: 75265
  # stop exit=0 → runner 75265 alive right after stop = no；3s 后仍 no
  ```
  单元/`e2e`/`live` 不会发现它：`packages/core/test/supervisor.test.ts` 的停止用例在断言前保持进程存活，`unref()` 计时器因此能正常触发（本人在独立脚本中也复现了「进程存活时计时器会升级为 SIGKILL、进程随后死亡」）。
- 影响：Runner 进程（及其未来工具容器、工作区挂载）可无限期存活；`reliability.md` §7「回收容器/进程」与 A2-T5 的「SIGTERM→10s→SIGKILL」在真实 daemon 路径上仍未实现。运行被停靠为 `recovery_required`，capability 已被撤销（该 Runner 无法再调用网关），因此不是 fail-open，但确定性残留进程与工作区写者。第 1 轮 P2-06 只关闭了「park 语义」那一半。
- 修复：`RunnerSupervisor.stop()` 在 `SIGTERM` 之后必须等待/轮询子进程退出直至 `cancelGraceSec`，然后 `SIGKILL` 并再次确认（或返回未确认列表由 daemon 在 `process.exit` 前处理）；daemon 侧在 `process.exit(0)` 前核对 `supervisor.liveAttempts()` 为空，否则记 `recovery` 并延迟退出。

### WP11R2-02（P2）`recovery_required` 的 Run 在产品内没有恢复路径：记录 RecoveryDecision 后仍不允许新 Attempt

- 证据：`packages/core/src/recovery.ts`（`newAttemptAdmission` 的 `requiresRecoveryDecision` 分支只看是否存在 accepted 的 recovery decision，且要求端口重新核对进程状态），`packages/core/src/findings.ts:1686-1736`（`resumeTx` 只在 **Work 处于 `paused`** 时被调用，且对 `recovery_required` 的 Run 会先返回 `RECOVERY_REQUIRED`），`packages/core/src/findings.ts:1493-1538`（`pauseTx` 对 `recovery_required` 的 Run 记入 `recoveryRunIds` 并整体拒绝），`packages/core/src/supervisor.ts:421-433`（`claim()` 只认领 `status='queued'`，停靠后的 Run 永不重回 `queued`）。
- 复现：
  ```bash
  node /tmp/wp11rev2/r2-resume-path.mjs
  # parked run.status = recovery_required
  # admission after the decision = {"allowed":false,…,"requiresRecoveryDecision":true,"resolvedByDecisionId":null}
  # a second supervisor tick claimed: [] | attempts 1 → 1
  # pauseWork: {"ok":false,"code":"RECOVERY_REQUIRED","message":"Work … has Runs whose side effects are unresolved"}
  # （对照）parked interrupted：admission allowed=true；pauseWork ok → resumeWork ok → attempts 1 → 2
  ```
- 影响：任何「旧进程仍存活/无法确认」的停靠（包括本轮的 WP11R2-01 孤儿场景、重启后旧 Runner 仍在、`attempt.error` 后进程未及退出）都会让该 Run 永久停在 `recovery_required`：用户没有任何产品内动作能推进它（`work.control resume` 需要 Work 为 `paused`，而 `pauseWork` 又拒绝）。`interrupted` 场景尚有 `pause→resume` 这条间接路径，属可用但未文档化。
- 修复：`newAttemptAdmission` 应在存在 accepted 的、绑定该 Run 的 recovery decision 时重新核对进程状态（不可确认则继续拒绝，可确认终止则改判 `interrupted` 并允许新 Attempt）；或提供 `work.control resume` 对 `recovery_required` 的显式分支：按 decision 重核 → `beginAttempt`/重排队。

### WP11R2-03（P2）用户取消后迟到的 `attempt.result` 会把已 `stopped` 的 Attempt 改写成 `completed`

- 证据：`packages/core/src/supervisor.ts:592-601`——`finishFromResult` 在 `isTerminal(entry.runId)` 判断**之前**就把 Attempt 行改成 `completed`，且只排除 `completed`/`failed`（未排除 `stopped`/`lost`）；`packages/domain/src/transitions.ts:87-95` 的 `ATTEMPT_TRANSITIONS` 明确 `stopped: []`（终态不可再迁移）。第 1 轮该路径先抛 `ProtocolError` 崩溃，因此这个状态改写被崩溃掩盖。
- 复现（**产品取消路径**：`FindingService.cancelWork`，即 `work.control cancel`）：
  ```bash
  node /tmp/wp11rev2/r2-01b-product-cancel.mjs
  # cancelWork result: {"ok":true,…}
  # after cancel: run.status = cancelled | attempt.status = stopped | attempt.finishedAt = null
  #   [supervisor] ignoring the late result of …
  # after the late result: run.status = cancelled | attempt.status = completed | attempt.finishedAt = null
  ```
  同现象亦见于直接 `RunLifecycle.cancel`（`node /tmp/wp11rev2/r1-01-late-result.mjs`）。
- 影响：违反 `data.md`/`transitions.ts` 的「Attempt 离开 running 后证据不可重写」与 `reliability.md` §2「迟到事件不覆盖取消」，并给审计/恢复核对留下错误事实（取消的 Run 下挂着 `completed` 的 Attempt，且 `finishedAt` 为空）。Run 终态与准入不受影响（Run 已 `cancelled`），故限 P2。
- 修复：`finishFromResult` 先判 `isTerminal(entry.runId)`，迟到结果只记日志（或按第 1 轮建议走 `RunRecoveryService.acceptAttemptResult` 落 `stage.result_rejected` 证据）；Attempt 改写前先读当前行，只允许从 `starting`/`running` 迁移（可用 `canTransitionAttempt`）。

### WP11R2-04（P2/P3）`start` 的两条失败路径仍无 `operationId`；`implementation.md` 对 e2e 断言收严的描述与代码不符

- 证据：`apps/cli/src/cli.ts:252-255`（`START_FAILED` 直接 `io.err(JSON.stringify({ok:false,error:{code,message}}))`）与 `apps/cli/src/cli.ts:258-269`（`START_TIMEOUT` 同样绕过 `failure()`；只有 `failure()` 在 `:100-106` 加了 `operationId`）；`scripts/e2e.mjs:2478-2492` 仍保留 `if (parked === 'interrupted') … else …` 的宽松分支（该文件在修复提交中未被改动，`git diff b71c8f5 6b0228f -- scripts/e2e.mjs` 为空），而 `implementation.md` 第 92 行称「e2e/live 的 AC-057 断言改为严格要求 `interrupted`」。
- 复现：
  ```bash
  AGENTDEV_DAEMON_ENTRY=/tmp/nope.mjs node apps/cli/dist/cli.js start --root <repo>
  # {"ok":false,"error":{"code":"START_FAILED","message":"Error: /tmp/nope.mjs does not exist; …"}}   ← 无 operationId
  AGENTDEV_DAEMON_ENTRY=<挂起不答的入口> node apps/cli/dist/cli.js start --root <repo>
  # {"ok":false,"error":{"code":"START_TIMEOUT","message":"…","logTail":""}}                        ← 无 operationId
  ```
  （对照：`open` 缺参 / `start --bogus` / `start --root` 缺值都带 `operationId`。）
- 影响：`reliability.md` §7「失败退出非零并输出 error code 和 operationId」在 `start` 的两条真实失败路径上仍不成立，失败无法与 operation/outbox 关联。e2e 侧虽由真实探针兜底（我实测的鉴别力见 §4），但「实现记录称已收严、代码未动」属记录不准。
- 修复：让 `startDaemon` 的两处也走 `failure()`（`START_TIMEOUT` 可把 `logTail` 并入 message 或作为 details）；把 e2e 的 AC-057 断言与 live 对齐为严格 `interrupted`，或修正 `implementation.md` 的表述。

### WP11R2-05（P3）Runner 子进程白名单仍透传 `NODE_OPTIONS`，可在 Runner 内注入任意代码

- 证据：`apps/daemon/src/runner-spawn.ts:22-40` 的 `RUNNER_ENV_ALLOWLIST` 含 `'NODE_OPTIONS'`；`:178-186` 的 `runnerChildEnv` 只是按名单筛选，未做值校验。
- 复现：
  ```bash
  NODE_OPTIONS="--require /tmp/wp11rev2/inject.cjs" node /tmp/wp11rev2/r1-11-env.mjs
  cat /tmp/wp11rev2/inject.log
  # {"where":"runner-child","argv":["…/node","/tmp/wp11rev2/env-runner.mjs",…],"provider":null,"nodeOptions":"--require /tmp/wp11rev2/inject.cjs"}
  ```
- 影响：`execution.md` §2 的边界是「Runner 只持有短期 capability」；`NODE_OPTIONS` 让 daemon 环境中的该变量可在 Runner（及其未来工具容器宿主）里执行任意代码。当前实测读不到 Provider secret（子进程环境已不含它），且该变量源自启动 daemon 的同一用户，因此不是凭证泄漏，属加固缺口。
- 修复：从白名单移除 `NODE_OPTIONS`（如确需，改为显式受控注入并校验取值），或仅允许安全子集（如 `--max-old-space-size` 之类）。

### WP11R2-06（P3）Run 完成后的结果正文没有任何持久证据（WP11R1-15 残余）

- 证据：`packages/core/src/supervisor.ts:589-628` 只用 `result.status`；`entry.result.message` 只存内存。`data.md` §2 / `protocol.md` §6 把 `stage_result` 定义为 `stage.submit` 的提交形状，本切片的 Runner 走 `attempt.result`，因此没有对应的落库路径。
- 复现：`node /tmp/wp11rev2/r2-01b-product-cancel.mjs` → `stage_result rows = 0`；完成的 Attempt 只有 `status`/`heartbeat_at`。
- 影响：Run 完成没有可审计的阶段结果内容，`plan.md` A2-T4 的「结果落 `stage_result`」在实现记录中被降级为「Run 终态」，属计划与架构契约的措辞偏差；已如实登记。
- 修复：按 `protocol.md` §6 接线 `stage.submit`（Capability 鉴权 + 读账本封口），或把 `attempt.result` 的正文作为诊断证据落 Artifact/事件。

### WP11R2-07（P3）`attempt.error` 把 Attempt 记为 `failed` 而非 `lost`，与 T9 行文不一致

- 证据：`packages/core/src/supervisor.ts:640-653`（`failAttempt` 先 `attempts.update(…, {status:'failed'})`，再 `park`）；`implementation.md` 第 94 行称「无结果的 Attempt 一律按 lost 处理」。
- 复现：`node /tmp/wp11rev2/r2-error-and-resume.mjs` → `run.status = recovery_required | attempt.status = failed`（Run 停靠正确，仅 Attempt 词法不同）。
- 影响：审计上无法区分「Runner 报告错误」与「Attempt 丢失」；不影响 Run 语义与准入。
- 修复：`attempt.error` 走 `markAttemptLost`（或新增 `AttemptStatus='failed'` 的明确语义说明并修正 T9 行文）。

## 6. 未验证 / 无法验证项

1. **真实 daemon + 真实 Provider 的孤儿场景未复现**：WP11R2-01 的孤儿用「忽略 SIGTERM 的 Runner 桩」在 daemon 级复现（这是 `RunnerSpawnPort` 契约内的合法子进程）；真实 `apps/runner` 会响应 SIGTERM，因此真实 Provider 演练中不会留孤儿。缺陷是「停止不等确认」，与 Runner 实现无关。
2. **`stop` 时 Runner 正在长模型调用**：真实 `apps/runner` 在调用中不处理 stdin 的 `attempt.shutdown`，实测 3s 宽限后走 SIGTERM；未逐帧确认「Checkpoint 保存」是否发生（本切片 Runner 无 Checkpoint 实现，属计划非目标）。
3. **`restore`/`backup` 的 capability 撤销与 Run 标 interrupted**（`reliability.md` §8）不属于 WP-11 范围，未复核。
4. **浏览器类 AC（AC-002/052/071/073/076）与多模型 AC-043**：drill 自报 UNVERIFIED，本轮未复核浏览器侧。
5. **Provider Secret 的持久化/注册路径**（Keychain/0600 加密文件）仍是登记缺口：`agentdev start` 下没有注册途径，真实 Provider Attempt 只能由测试注入解析器；未计为本轮缺陷。
6. **`pnpm test:acceptance`（94/94）未运行**：不在本轮指定命令集内；`pnpm doctor` 命中 pnpm 自带命令，产品 doctor 已单独运行。

## 7. 独立复算的命令输出

### 7.1 回归与卫生

```text
$ pnpm typecheck   → exit 0
$ pnpm lint        → exit 0（"All matched files use Prettier code style!"）
$ pnpm docs:check  → exit 0（"docs:check ok — 15 documents, 54 internal links, 94 acceptance cases, 9 requirements, 11 work packages"）
$ pnpm build       → exit 0

$ pnpm test:unit
 Test Files  59 passed (59)
      Tests  1151 passed (1151)          （与 implementation.md T9 一致）

$ pnpm test:integration -- --maxWorkers=4
 Test Files  29 passed (29)
      Tests  323 passed (323)            （一致）

$ pnpm test:e2e
 PASS runtime.executes-attempt [AC-057] runtime executed a real Attempt: Run … completed with Attempt … through the supervisor, a real apps/runner child process and the loopback model (1 Provider call(s), 13 tokens booked);
      killing the live Runner of Run … (pid 71097) parked it as interrupted with Attempt … lost (new Attempt allowed=true)
 e2e: 21 checks — PASS 17 / FAIL 0 / UNVERIFIED 4
 e2e: 24 ACs accounted for by the drill; exit 0

$ pnpm test:live     （真实 Provider https://api.deepseek.com / deepseek-flash）
 PASS provider.connectivity / drill.html-explanation / drill.l1-typo / drill.l2-delivery / drill.runtime-attempt
 drill.runtime-attempt [AC-057]: … runnerId pid:74078 … 799 tokens booked from the Provider usage; killing the live Runner (pid 74129) … parked it as interrupted with Attempt … lost (new Attempt allowed=true)
 live: 5 passed / 0 failed / 2 unverified; 11 call(s), HTTP 200×11, 0 failed; exit 0

$ node apps/cli/dist/cli.js doctor
 ok node 24.8.0 / pnpm 12.3.4 / git 2.39.3 / pi-sdk 0.85.1 / docker 28.4.0 (agentdev/exec:0.0.0)
 ok dir /Users/huyaohua/.agentdev ; info port 4317 free ; info port 4318 free
 ok runtime /Users/huyaohua/.agentdev — credential missing, not running
 execution ready: yes ; exit 0

$ git status --porcelain   （报告写入前）
(空)
```

### 7.2 WP11R1-01（迟到结果；真 spawn 端口）

```text
$ node /tmp/wp11rev2/r1-01-late-result.mjs
   [supervisor] … attempt … started (pid 75642, epoch 1)
attempt row before cancel: {"status":"running","runnerId":"pid:75642"}
after user cancel: run.status= cancelled attempt.status= running attempt.finishedAt= null
   [supervisor] supervisor: ignoring the late result of … (Run already ended)
SURVIVED; run.status= cancelled
attempt row AFTER the late result: {"status":"completed","finishedAt":null,"error":null,"version":5}
events: ["run.started","run.ended"]
stage_result rows: 0
EXIT=0
```

### 7.3 WP11R1-02（探针 / `pid:pending` / pid 复用）

```text
$ node /tmp/wp11rev2/r1-02-probe.mjs
parseRunnerPid("pid:123")   = 123
parseRunnerPid("pid:pending") = null
probe("pid:pending")        = null
attempt.runnerId = pid:97571 parsed pid = 97571
probe(runnerId) before kill = true
after SIGKILL: run.status = interrupted attempt.status = lost
probe(runnerId) after kill = false
admission = {"allowed":true,…,"requiresRecoveryDecision":false}

$ node /tmp/wp11rev2/r1-02b-into-park.mjs
inspect(pid:pending): {"processAlive":null,"action":"park_recovery_required","requiresDecision":true,"newAttemptAllowed":false,
                       "why":"进程 pid:pending 状态无法确认（非本机 PID），按未确认终止处理"}
impostor pid = 25078; inspect with that pid: {"processAlive":true,"action":"park_recovery_required","requiresDecision":true,
                       "newAttemptAllowed":false,"why":"旧执行进程 pid:25078 仍存活，未确认终止前不把工作区授予新写者"}
```

### 7.4 WP11R1-03（capability 门禁）

```text
$ node /tmp/wp11rev2/r1-03-capability.mjs
A1 live Attempt, first call (Provider 429): HTTP 500 {"error":{"message":"rate limited"}}
    capability still valid after a 429 = true
A2 same Attempt retries with the same capability: HTTP 200
B  parked = ["…"] run.status = interrupted attempt.status = lost
   revoked via onAttemptEnded = ["…"]
B1 the SAME capability after the park: HTTP 401 {"code":"NOT_AUTHORIZED","message":"the capability is not valid"}
    capability still in store = false count = 0
C1 correct epoch (ownerEpoch+1=4): HTTP 200
C2 wrong epoch 9 for the same Attempt: HTTP 401 (epoch mismatch)
D2 after the Run was cancelled by the user: HTTP 409 INVALID_STATE（并撤销）
E1 capability of a completed Attempt: HTTP 401
F2 the old token on the restarted endpoint: HTTP 401
```

### 7.5 WP11R1-05/06 与 WP11R2-01（优雅停止 / 孤儿）

```text
$ node /tmp/wp11rev2/r1-05-06-stop.mjs
### cooperative runner
stop() took 27 ms; run.status = recovery_required attempt.status = stopped
runner pid = 60609 alive right after stop = true；1.5s 后 = false
### SIGTERM-ignoring runner
stop() took 813 ms; run.status = recovery_required attempt.status = stopped
runner pid = 60777 alive right after stop = true（进程存活时 unref 计时器正常升级）
1.5s 后 = true；10.5s 后 = false（SIGKILL 升级）

$ bash /tmp/wp11rev2/a4-daemon-stop.sh          # daemon 级 + stubborn Runner
stop exit=0
ORPHAN: runner 62346 alive right after stop=yes
{"run":{"status":"recovery_required","version":4},"attempts":[{"status":"stopped","runnerId":"pid:62346"}]}
ORPHAN: runner 62346 still alive after restart=yes

$ bash /tmp/wp11rev2/a4b-daemon-stop-real.sh     # daemon 级 + 真实 apps/runner 源码入口
runner children before stop: 75265
stop exit=0 → runner 75265 alive right after stop = no；3s 后 = no
```

### 7.6 锁 / 环境 / 入口 / 失败输出

```text
$ bash /tmp/wp11rev2/a2-lock-race.sh
daemon 5 (65009): out={"status":"started",…,"epoch":1,…} | err=
daemon 1/2/3/4/6: err=ALREADY_RUNNING: agentdevd is already running for … (pid 65009, epoch 1)
daemon.lock: {"v":1,"pid":65009,"epoch":1,…}；runtime.json: {"v":1,"pid":65009,"epoch":1,…}
alive daemons: 1；仅 127.0.0.1:56005 在监听

$ node /tmp/wp11rev2/r1-11-env.mjs   （NODE_OPTIONS 未设置）
runnerChildEnv: {"PATH":…,"HOME":…,"TMPDIR":…,"LANG":…,"SHELL":…,"USER":…,"LOGNAME":…,"TERM":"dumb","AGENTDEV_RUNNER_ENTRY":"…"}
--- what the REAL child saw --- {"count":10,"keys":[…],"interesting":{"AGENTDEV_RUNNER_ENTRY":"…"}}   ← 无任何 AGENTDEV_PROVIDER_*

$ NODE_OPTIONS="--require /tmp/wp11rev2/inject.cjs" node /tmp/wp11rev2/r1-11-env.mjs
{"where":"runner-child","argv":["…/node","/tmp/wp11rev2/env-runner.mjs","--attempt-id"],"provider":null,"nodeOptions":"--require /tmp/wp11rev2/inject.cjs"}

$ bash /tmp/wp11rev2/a1-entries.sh
status(未运行) exit=0；start --root → instances=[repo]；二次 start already:true
projects.json 已含显式 --root；stop→裸 start → instances=[repo]；open repo2→stop→裸 start → instances=[repo,repo2]
doctor(AGENTDEV_HOME=otherhome, 0644)：{"home":"…/otherhome","installationToken":"insecure","running":false,"instances":0}
     executionReady=false，blocker=「installation credential … is readable by others」；改 0600 → {"installationToken":"ok"} executionReady=true
陈旧锁：took over a stale lock from pid 999999 (epoch 7); this daemon now holds epoch 8；epoch=8
stop → runtime.json/daemon.lock 均 absent；4317/4318 free；无残留进程

$ node apps/cli/dist/cli.js open                → {"ok":false,…,"operationId":"8940c4f2-…"} exit=1
$ node apps/cli/dist/cli.js start --bogus       → {"ok":false,…,"operationId":"5a3bcadc-…"} exit=1
$ node apps/cli/dist/cli.js start --root        → {"ok":false,…,"operationId":"0ffe7945-…"} exit=1
$ AGENTDEV_DAEMON_ENTRY=<missing> … start       → {"ok":false,"error":{"code":"START_FAILED",…}}          ← 无 operationId
$ AGENTDEV_DAEMON_ENTRY=<hang>    … start       → {"ok":false,"error":{"code":"START_TIMEOUT",…}}         ← 无 operationId
```

### 7.7 断言鉴别力 / 恢复路径 / `attempt.error`

```text
$ node /tmp/wp11rev2/r2-falsify.mjs
--- (1) the child result drives the Run status ---
run.status = failed | attempt.status = failed | 子进程报 failed → Run must be failed: HELD
--- (2) a probe that cannot confirm death must NOT yield interrupted ---
real probe,  genuinely dead child → run.status = interrupted      | admission.allowed = true
blind probe, same dead child      → run.status = recovery_required | admission.allowed = false
   → the strict `interrupted` assertion would FAIL here: YES (discriminating)

$ node /tmp/wp11rev2/r2-error-and-resume.mjs
run.status = recovery_required | attempt.status = failed | admission={"allowed":false,…,"requiresRecoveryDecision":true}
events = ["run.started","run.recovered"]
记录 accepted 的 RecoveryDecision 后：admission={"allowed":true,…,"requiresRecoveryDecision":true,"resolvedByDecisionId":"…"}

$ node /tmp/wp11rev2/r2-resume-path.mjs
parked interrupted      : admission allowed=true；supervisor 再 tick claimed=[]；pauseWork ok → resumeWork ok → attempts 1→2、run.status=running
parked recovery_required: admission allowed=false/requiresDecision=true；再 tick claimed=[]；
                          pauseWork: {"ok":false,"code":"RECOVERY_REQUIRED","message":"Work … has Runs whose side effects are unresolved"}

$ node /tmp/wp11rev2/r2-01b-product-cancel.mjs
cancelWork result: {"ok":true,…}
after cancel: run.status = cancelled | attempt.status = stopped
after the late result: run.status = cancelled | attempt.status = completed
stage_result rows = 0
```

### 7.8 残留物与凭证

```text
$ ps -ax -o pid=,command= | grep -E "stubborn-runner|fake-runner|env-runner|daemon-entry|silent-entry"
（无匹配）
$ lsof -nP -iTCP -sTCP:LISTEN | grep -E ":(4317|4318|5600[1-6])"
（无匹配）
$ grep -rl "sk-7a2539" /tmp/wp11rev2/ .        # 仅自建哨兵字符串，无真实凭证
（无真实凭证命中）
$ git status --porcelain
(空)
```
