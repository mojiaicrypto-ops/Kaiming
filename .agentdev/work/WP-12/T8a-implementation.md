# WP-12 T8a 实现记录（supervisor / 恢复与 findings / CLI 运行时遗留收口）

- 基线：本工作树（`HEAD 7c723ec` + 其他车道未提交改动）。T8a 只改：
  `packages/core/src/{supervisor,findings,runtime}.ts`、
  `packages/core/test/{supervisor,findings,runtime}.test.ts`、
  `apps/cli/test/runtime.integration.test.ts`。
- 依据：`reliability.md` §2/§6/§7、`workflow.md` §5.3/§6/§7、`protocol.md` §3/§7/§8、
  WP-11 `settlement.md` §4 残余 6/7/8、WP-11 `test.md` §5.4/§6（T-03/T-04）、
  WP-11 `review-round4.md` WP11R4-04。
- 授权范围外（本轮未触碰）：`packages/core/src/{control-http,execution,gateway-http,
  tool-http,tool-handler,permissions,tools,recovery,run-lifecycle}.ts`、
  `apps/daemon/**`、`scripts/**`。因此 `recordResumeDecision`（在 `recovery.ts`）与
  `beginAttempt`（在 `run-lifecycle.ts`）保持原样，T8a 在 supervisor 侧给出等价出口。

## 1. 逐条残余：复现 → 修复 → 复验

### R1 Run 在 Runner ready 前即被报为 `running`（确认成立 → 已修）

- 现状（修复前）：`RunnerSupervisor.claim → spawnRun` 调
  `RunLifecycle.beginAttempt`，后者在**同一事务**里写 `starting` 后立刻写 `running`
  （`run-lifecycle.ts:148-151`），而 Runner 的 `attempt.ready` 只把 Attempt 标 `running`
  （`supervisor.ts` ready 分支）。与 `reliability.md` §2「持久Starting后启动Runner；
  ready确认epoch/进程标识/环境后Running」相冲。
- 失败复现（新用例 `packages/core/test/supervisor.test.ts`：
  `reports the Run as starting until the Runner confirms ready`）：
  ```text
  $ pnpm exec vitest run --project unit packages/core/test/supervisor.test.ts
  FAIL  reports the Run as starting until the Runner confirms ready (reliability.md §2)
  AssertionError: expected 'running' to be 'starting'
  Expected: "starting"  Received: "running"
  ```
- 修复：`spawnRun` 改用 supervisor 自有的 `openAttemptForSpawn`：在同一事务内做准入
  （`newAttemptAdmission`）+ `canTransitionRun(queued|interrupted|recovery_required →
  starting)` + 落 `starting` Attempt，**不**写 `running`；`attempt.ready` 时才把 Run
  `starting → running` 并补发 `run.started`（`protocol.md` §7）。ready 前的 Run 只存在于
  `starting`，`startedCount`/Attempt 语义不变。
- 连带修正（记录在案）：claim 后 Run 停在 `starting`，因此「Runner 从未 ready 就失联/失败」
  的 park 由 `recovery_required` 变为 `interrupted`（`RUN_TRANSITIONS` 无
  `starting → recovery_required` 边，`recovery.ts` 对 `starting` 的 risky 分支本就选
  `park_interrupted`）——verdict 仍 `newAttemptAllowed:false`，仍必须 RecoveryDecision，
  安全性不变。`supervisor.test.ts` 三处旧断言（dropped-tools、心跳超时不可确认、恢复后
  running）按真实规则收紧/改写。
- 复验：
  ```text
  $ pnpm exec vitest run --project unit packages/core/test/supervisor.test.ts
  Test Files 1 passed (1) | Tests 24 passed (24)
  ```

### R2 spawn/prepare 失败停在不可恢复的 `recovery_required`（确认成立 → 已修）

- 现状（修复前）：`claim` 的 catch 把悬空 Attempt 标 failed 后 `park()` 走
  `RunRecoveryService`；失败 Attempt 的 `runnerId` 是 `pid:pending`，真实探针
  `parseRunnerPid → null → processAlive=null`，于是 `park_recovery_required` 且
  `newAttemptAllowed:false`；`recordResumeDecision` 因 `processAlive !== false` 永久拒绝，
  `resumeParkedRun` 同样拒绝（WP11R5-03 死角）。
- 失败复现（新用例 `parks a spawn failure as a resumable Run instead of a dead end`、
  `parks a prepare failure as a resumable Run`）：
  ```text
  $ pnpm exec vitest run --project unit packages/core/test/supervisor.test.ts
  FAIL  parks a spawn failure as a resumable Run instead of a dead end (WP11R5-03)
  AssertionError: expected 'recovery_required' to be 'interrupted'
  FAIL  parks a prepare failure as a resumable Run
  AssertionError: expected 'recovery_required' to be 'interrupted'
  ```
- 修复：新增 `abandonUnstarted`——prepare/spawn 同步抛错意味着**从未创建进程**，因此把
  悬空 Attempt 标 `failed` 后把 Run 落 `interrupted`，并写一条 `run.recovered` verdict
  `{ newAttemptAllowed: true, requiresRecoveryDecision: false, neverStarted: true,
  reason }`（`workflow.md` §5.3：不确定副作用才 `recovery_required`）。`resumeParkedRun`
  以 `neverStartedVerdict(runId)` 读取最新 verdict：命中则跳过进程探针（没有旧写者可确认），
  其它情况一律保留 `recovery.inspect` 的探针闸门（WP11R3-03 不回退）。
- 反向保护：spawn **之后**的登记失败（child 已存在）走
  `registerLiveAttempt` 自身 catch：杀子进程、Attempt 标 failed、`park()` 走真实 recovery
  （绝不写 `neverStarted`）。回归用例 `never claims "no process" when the failure happens
  after the spawn` 断言 `SIGTERM` 已发、verdict 无 `neverStarted`、admission 仍拒。
- 复验：同上 24/24。真实集成 `apps/daemon/test/attempt.integration.test.ts`（真 supervisor
  + 真 `apps/runner` 子进程）2/2 通过。

### R3 `resumeTx` 的准入变成纯证据依赖（确认成立 → 已修，fail-closed）

- 现状（修复前）：`resumeTx` 只问 `newAttemptAdmission`；`recovery.ts` 在没有
  `run.recovered` verdict 时返回 `allowed:true`，所以一个 `recovery_required` 的 Run 在
  **缺 verdict** 时会被 `resumeWork` 直接开新 Attempt（WP11R4-04 的库级 fail-open；
  WP-11 记录为「当前不可达但应在纵深防御上显式化」）。
- 失败复现（新用例 `refuses to resume a recovery_required Run that has no persisted
  verdict (WP11R4-04)`）：
  ```text
  $ pnpm exec vitest run --project unit packages/core/test/findings.test.ts
  FAIL  refuses to resume a recovery_required Run that has no persisted verdict (WP11R4-04)
  AssertionError: expected true to be false
  # 同一用例先断言 newAttemptAdmission(...).allowed === true（证明 fail-open 源），再要求 refusal
  ```
- 修复（规则显式化）：`recovery_required` 的 Run 只有在
  `admission.allowed && admission.resolvedByDecisionId !== null`（即确实有一条覆盖本 Run 的
  accepted recovery 决定）时才可续跑；缺 verdict、verdict 放行但无决定等矛盾态一律
  `RECOVERY_REQUIRED`。其它可恢复状态仍以持久准入为权威（`interrupted` 经探针确认后放行；
  覆盖决定可解除 withholding）。
- 双向测试：
  - 拒绝：上述新用例（无 verdict → 整个 `resumeWork` 在写任何东西前返回
    `RECOVERY_REQUIRED`，Work 仍 `paused`，Attempt 数不变）。
  - 放行：既有 `refuses to resume while a Run still needs recovery (AC-020)` 中的
    「withholding verdict + 覆盖本 Run 的 accepted 决定 → resume 成功」，以及同用例里
    「兄弟 Run 的决定不解除本 Run」。
- 复验：`packages/core/test/findings.test.ts` 37/37；全量单测 72 文件/1365 用例通过。

### R4 锁 epoch 跨干净重启不单调（确认成立 → 已修）

- 现状（修复前）：`stop` 删除 `daemon.lock`，`acquireDaemonLock` 用
  `(existing?.epoch ?? 0) + 1`，干净重启回到 1（WP-11 T-03；只有陈旧锁接管才递增）。
- 失败复现：
  ```text
  # 单测（新用例 keeps the epoch strictly increasing across a clean stop and start）
  $ pnpm exec vitest run --project unit packages/core/test/runtime.test.ts
  FAIL  keeps the epoch strictly increasing across a clean stop and start
  AssertionError: expected 1 to be 2

  # 真实 CLI（新用例 keeps the daemon epoch strictly increasing across a clean stop and start）
  $ pnpm exec vitest run --project integration apps/cli/test/runtime.integration.test.ts
  FAIL  keeps the daemon epoch strictly increasing across a clean stop and start
  AssertionError: expected 1 to be greater than 1
  ```
- 修复：`packages/core/src/runtime.ts` 新增安装级高水位文件 `daemon.epoch`（0600、原子写，
  与 `daemon.lock` 同级；文件名为 core 内部实现，未新增/改动 `packages/contracts` 的对外契约）。
  `epoch = max(已装锁 epoch, 高水位) + 1`，并在**取得排他锁之前**写高水位，因此崩溃也不会留下
  「锁 epoch 大于高水位」的窗口；`releaseDaemonLock` 不删高水位文件。文件缺失/损坏按「从未发放」
  处理并立即由本次发放值重建（`readEpochHighWater` 的 JSDoc 说明该边界）。
- 真实证据（`pnpm build` 后的 dist，macOS 真机、三个干净周期）：
  ```text
  $ node apps/cli/dist/cli.js start | ...   # epoch=1 pid=57472
  $ node apps/cli/dist/cli.js stop          # stopped=true
  lock after stop: absent
  $ node apps/cli/dist/cli.js start         # epoch=2 pid=57519
  $ node apps/cli/dist/cli.js stop          # stopped=true
  lock after stop: absent
  $ node apps/cli/dist/cli.js start         # epoch=3 pid=57557
  $ node apps/cli/dist/cli.js stop          # stopped=true
  lock after stop: absent
  high-water=3
  ```
  （更早一次单周期原文：start #1 `"epoch": 1`、stop `"stopped": true`、lock absent、
  start #2 `"epoch": 2`、`daemon.epoch` 内容 `2`。）

### R5 损坏 `runtime.json` 让 `agentdev start` 无 error code / 无 operationId（**已由 WP-12 修复**，本轮补回归测试）

- 复核结论：**当前代码不复现**。`apps/cli/src/runtime.ts` 的 `waitForRuntime` 已把契约错误
  记录为「尚未 ready」，到期限才抛出；`apps/cli/src/cli.ts` 的 `liveRuntimeOr`/`startDaemon`
  已把它转成 `RUNTIME_RECORD_INVALID` + `operationId`（该修复属 WP-12 T1 的未提交改动，不在
  T8a 文件范围）。本轮**没有为此发明代码改动**，只补了一条端到端回归测试：
  `fails a damaged record with a code and operationId and leaves no stale lock`
  （半截 JSON + 不可用凭证目录 → 守护进程取锁后启动失败 → CLI 必须报码并清理锁）。
- 真实证据（新用例在修复前即通过；`pnpm build` 后 dist 复跑）：
  ```text
  $ AGENTDEV_HOME=<tmp> node apps/cli/dist/cli.js status
  {"ok":false,"error":{"code":"RUNTIME_RECORD_INVALID","message":"Expected ',' or '}' after property value…"},"operationId":"7b6817d4-…"}   status_exit=1
  $ AGENTDEV_HOME=<tmp> node apps/cli/dist/cli.js stop
  {"ok":false,"error":{"code":"RUNTIME_RECORD_INVALID",…},"operationId":"6cfc5578-…"}                                                  stop_exit=1
  $ AGENTDEV_HOME=<tmp> node apps/cli/dist/cli.js start
  {"ok":false,"operationId":"1243eda3-…","error":{"code":"RUNTIME_RECORD_INVALID",…}}                                                  start_exit=1
  lock: absent
  ```
- 结论：`start`/`stop`/`status` 三条都带 error code + 真实 `operationId`（UUID），失败的
  daemon 也没有留下 `daemon.lock`（`main.ts` 的失败释放 + 本测试断言）。

### R6 `apps/cli/src/doctor.ts`（无缺陷，未改）

- 复核：`probeRuntime` 对损坏 `runtime.json` 已 `try/catch`，输出
  `detail: "runtime.json is unreadable: …"`，`doctor --json` exit 0、不误报 `running`：
  ```text
  {"home":"/tmp/t8a-doctor-…","installationToken":"missing","running":false,"instances":0,
   "detail":"runtime.json is unreadable: Unexpected token 'o', \"not json\" is not valid JSON"}
  executionReady=true
  ```
- 因此 doctor.ts 无对应残余可修；未做仅「看起来忙碌」的改动。

## 2. 修改的文件（只列 T8a 自己的改动）

| 文件 | 改动 |
|---|---|
| `packages/core/src/supervisor.ts` | `openAttemptForSpawn`（queued→starting + 准入）、`abandonUnstarted`（neverStarted 停靠）、`neverStartedVerdict`、`registerLiveAttempt`/`markAttemptFailed`（spawn 后失败走真实 recovery）、`attempt.ready` 完成 `starting→running` 并补发 `run.started`、`resumeParkedRun` 的 neverStarted 例外；类头 JSDoc 同步 |
| `packages/core/src/findings.ts` | `resumeTx` 的 `unresolved` 规则显式化：`recovery_required` 必须有覆盖本 Run 的 accepted 决定，缺证据 fail-closed（WP11R4-04） |
| `packages/core/src/runtime.ts` | `daemon.epoch` 高水位 + `acquireDaemonLock` 取 `max(锁, 高水位)+1`；JSDoc 依据 `reliability.md` §7 与 WP-11 T-03 |
| `packages/core/test/supervisor.test.ts` | 新增 4 例（starting-until-ready、spawn 失败可续、prepare 失败可续、spawn 后失败不写 neverStarted）；3 处旧断言按 `starting` 语义收紧 |
| `packages/core/test/findings.test.ts` | 新增 fail-closed 用例（无 verdict 的 `recovery_required` 必须拒绝） |
| `packages/core/test/runtime.test.ts` | 新增干净 stop→start 单调用例（含第三次） |
| `apps/cli/test/runtime.integration.test.ts` | 新增真实 epoch 单调用例与损坏记录+stale lock 回归用例 |

未改（说明）：`apps/cli/src/runtime.ts` 与 `apps/cli/src/doctor.ts` —— R5/R6 的修复/行为已在
工作树中由 T1 完成，T8a 复核后无需再改。

## 3. 命令与真实结果（本轮运行）

```text
$ pnpm typecheck
EXIT=0

$ pnpm test:unit
Test Files  72 passed (72) | Tests  1365 passed (1365)          EXIT=0

$ pnpm exec vitest run --project integration apps/cli/test/runtime.integration.test.ts apps/daemon/test/attempt.integration.test.ts
apps/daemon/test/attempt.integration.test.ts (2 tests) ✓（真 supervisor + 真 apps/runner 子进程）
apps/cli/test/runtime.integration.test.ts (7 tests) ✓
Test Files 2 passed (2) | Tests 9 passed (9)                    EXIT=0

$ pnpm exec vitest run --project integration apps/daemon/test/runtime.integration.test.ts
Test Files 1 passed (1) | Tests 6 passed (6)                    EXIT=0

$ pnpm test:integration -- --maxWorkers=2
Test Files 1 failed | 36 passed (37) | Tests 1 failed | 402 passed (403)   EXIT=1
  # 唯一失败：packages/core/test/grants.integration.test.ts 内部 spawn `pnpm build`（跨进程用例）
  # 报 ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL（与其他车道/本轮并发的 pnpm build 抢同一工作树）。
  # 单跑该文件：Test Files 1 passed (1) | Tests 1 passed (1)  EXIT=0 —— 与本切片无关。

$ pnpm build                                                     EXIT=0（12 workspace）

$ pnpm docs:check
docs:check ok — 16 documents, 65 internal links, 94 acceptance cases, 9 requirements, 11 work packages
EXIT=0

$ pnpm lint
EXIT=1 —— 8 个错误全部位于其他车道正在改的文件：
  apps/daemon/src/protocol.ts:3221,3250（no-unnecessary-type-assertion）
  apps/daemon/test/tool-permission.integration.test.ts:279,282,295,315,332（no-base-to-string）
  packages/core/src/execution.ts:418（no-unnecessary-type-assertion）
  T8a 触碰的 9 个文件单独跑 eslint 与 prettier --check 均 EXIT=0：
  $ ...eslint <T8a 的 4 个 src + 5 个 test 文件>          ESLINT_EXIT=0
  $ ...prettier --check <同上>  All matched files use Prettier code style!  PRETTIER_EXIT=0
```

## 4. 未修 / 剩余，与归属

1. **崩溃在 spawn 窗口（daemon 在落 `pid:pending` 后、写真实 pid 前被 SIGKILL）** 仍然会把
   Run 停靠为 withheld 的 `interrupted`/`recovery_required`，且 `recordResumeDecision`
   在真实探针下对不可解析的 `pid:pending` 永久拒绝。这与 R2 不同：此时**可能真的存在孤儿
   进程**，保守拒绝是正确的安全选择；要给出出口需要改 `recovery.ts`（`recordResumeDecision`
   对「确认无进程」的落盘事实放行）或补一条「杀死孤儿后确认」的操作面。归 **recovery 切片
   （WP-12 T4b `recovery.inspect/resolve` 或后续）**，不在 T8a 文件范围。
2. **`RunLifecycle.beginAttempt` 仍是 resume 路径的入口**，`paused → running` 的恢复在 ready
   前即 `running`（`RUN_TRANSITIONS` 无 `paused → starting` 边）。R1 只收口 supervisor 的
   新认领路径；若要彻底统一，需要给 `run-lifecycle.ts` 增加 `starting` 选项（**不在 T8a
   授权文件范围**）。
3. **`daemon.epoch` 未进 `packages/contracts` 的 `RUNTIME_FILES`**（该文件不在 T8a 范围）。
   它是 daemon 侧内部高水位、CLI 不需要读；若 Review 认为所有 home 文件必须由 contracts
   单点声明，需在 `packages/contracts/src/runtime.ts` 补一行并同步 docs（归 contracts/运维
   切片）。当前实现已在 `runtime.ts` 的 JSDoc 说明这一取舍。
4. **`pnpm lint` 的 8 个错误** 全部来自其他车道（见 §3），T8a 文件绿。
5. 未做 `git add`/`git commit`；未改协议形状、未新增运行时依赖、未动 AC 文本。

## 5. 结论

- R1/R2/R3/R4 均**先有失败复现，后有修复与复验**；R5/R6 经真实复核**已由 WP-12（T1）修复
  或本就无缺陷**，本轮只补回归测试与原始证据，未制造改动。
- 全部 T8a 文件 `typecheck`/`unit`/目标 `integration`/`docs:check`/`build` 绿；`lint` 的失败
  可逐条归因到其他车道。

## 6. 修复轮 T8b（独立 Review PASS 后的 P2-1 / P3-1 / P3-2 / P3-3）

依据：`.agentdev/work/WP-12/T8a-review.md`（PASS，0×P1 / 2×P2 / 3×P3）。本轮只做父代理指定的
四条；**P2-2（`work.control resume` 的非原子/响应形状，需改 `apps/daemon/src/protocol.ts`）按
指示留给下一轮**，P2-3（`test:e2e`/`test:acceptance` 证据时效）属 Test 阶段重跑。本节结论
取代 §1-R6 的「doctor 无缺陷」与 §4-3 的「`daemon.epoch` 未进 contracts」。

### T8b-1（P2-1，真缺陷）ready 前的 `attempt.result:completed` 把 Run 停尸在 `starting`

- 失败复现（真实 `ProjectStore` + 真实 `Lifecycle`/`Recovery`，仅进程脚本化；新增用例
  `parks a Run whose Runner reports a completed result before 'ready' (T8b P2-1)`）：
  ```text
  $ pnpm exec vitest run --project unit packages/core/test/supervisor.test.ts -t "completed result before"
  FAIL  parks a Run whose Runner reports a completed result before `ready` (T8b P2-1)
  AssertionError: expected 'starting' to be 'interrupted'
  Expected: "interrupted"  Received: "starting"
  ```
  与 Review 一致：`finishFromResult → settle('completed')` 从 `starting` 出发被
  `RUN_TRANSITIONS` 拒绝，`guarded('settlement')` 只记日志；Attempt=`completed`、无 live、
  无 `run.ended`、无 tick 再捞。
- 修复选择：**方案 ①**（`attempt.result` 以 `entry.ready` 为闸门，未 ready 走 park）。理由：
  `reliability.md` §2 的文档语义就是「ready 确认 epoch/进程/环境后才 Running」，方案 ②（给
  `starting` 补 `completed` 出边）会让一个从未确认 ready 的 Run 直接进终态，与文档冲突且要把
  `end()` 的语义改成「未 ready 也可解释」。闸门只针对 `completed`：ready 前的 `failed`
  （`starting→failed` 合法）与 `cancelled`（`starting→cancelled` 合法，且优雅停止依赖
  shutdown 后 Runner 回 cancelled）保持原处理。命中时调 `failAttempt`：Attempt 标 `failed`、
  撤销 capability、SIGTERM、`park()` 走真实进程状态（`interrupted` + withheld verdict）。
- 复验（同一用例改为完整出口断言）：result → Run `interrupted`、Attempt `failed`、live=0；
  探针确认进程已死后 `recordResumeDecision` + `resumeParkedRun` 成功开出第 2 个 Attempt。
  全文件 `Tests 25 passed (25)`。
- 「同类死角」排查（回答 Review 的附加要求）：`entry.ready` 此前只写不读，现已在 result 分支
  成为闸门；其余从 `starting` 出发的状态转移要么合法（`failed`/`cancelled`），要么不经过
  `attempt.result`（`attempt.error` → `failAttempt`；`handleExit` 仅在 `entry.result` 已置位时
  走 settle，而该字段只在闸门通过后写入）。未发现第二条会被 `guarded` 吞掉并永久卡住的路径。

### T8b-2（P3-1）`daemon.epoch` 进 contracts 与安装文档

- `packages/contracts/src/runtime.ts`：`RUNTIME_FILES.epoch = 'daemon.epoch'`（带 `reliability.md`
  §7 语义与「stop 不删」说明），`RuntimePaths.epoch`，`runtimePaths()` 输出该路径。
- `packages/core/src/runtime.ts`：读写高水位改用 `runtimePaths(home).epoch`，删掉 core 内硬编码常量。
- 死导出处理：`apps/cli/src/runtime.ts` 的 `RUNTIME_FILENAMES = RUNTIME_FILES` 零消费方，**删除**
  （连同不再使用的 `RUNTIME_FILES` import）；`apps/cli/src/doctor.ts` 改为直接消费
  `RUNTIME_FILES.installationCredential`/`RUNTIME_FILES.runtime`（真实消费方，避免再次漂移）。
- `packages/contracts/test/runtime.test.ts` 增加 `epoch: '/home/.agentdev/daemon.epoch'` 断言；
  `docs/operations/installation.md` §2 目录表新增 `daemon.epoch` 行（0600，停止后保留、取
  `max(锁,高水位)+1`）。

### T8b-3（P3-2）doctor 把 0600 目录当凭证 + 人类可读输出丢 `detail`

- BEFORE（本轮修改前的 dist，`installation-token` 为 0600 目录 + 截断 `runtime.json`）：
  ```text
  json.installationToken=ok
  json.detail=runtime.json is unreadable: Expected property name or '}' in JSON at position 1 …
  ok   runtime      /tmp/… — credential ok, not running        # 人类可读行没有 detail
  ```
- 修复：`probeRuntime` 用 `statSync(path).isFile() && mode===0o600` 才判 `ok`；`renderDoctorReport`
  的 runtime 行追加 `report.runtime.detail`。
- AFTER（`pnpm build` 后同一输入）：
  ```text
  json.installationToken=insecure
  json.detail=runtime.json is unreadable: Expected property name or '}' in JSON at position 1 …
  FAIL runtime      /tmp/… — credential insecure, not running — runtime.json is unreadable: …   doctor_exit=0
  ```
- 回归用例：`apps/cli/test/doctor.integration.test.ts` 新增「0600 目录 → `insecure`」与
  「人类可读输出含 `runtime.json is unreadable`」两条断言。

### T8b-4（P3-3）收紧损坏记录的期望码

- `apps/cli/test/runtime.integration.test.ts`：`['RUNTIME_RECORD_INVALID','START_TIMEOUT']`
  宽松匹配改为 `.toBe('RUNTIME_RECORD_INVALID')`（daemon 失败后截断记录不会被重写，行为确定），
  保留 `daemon.lock` 不残留断言。

### T8b 本轮文件

`packages/core/src/supervisor.ts`、`packages/core/test/supervisor.test.ts`、
`packages/contracts/src/runtime.ts`、`packages/contracts/test/runtime.test.ts`、
`packages/core/src/runtime.ts`、`apps/cli/src/runtime.ts`、`apps/cli/src/doctor.ts`、
`apps/cli/test/doctor.integration.test.ts`、`apps/cli/test/runtime.integration.test.ts`、
`docs/operations/installation.md`。未触碰 `apps/daemon/src/protocol.ts`、`control-http/execution/
tool-*/permissions/read-ledger/stage.ts`、`apps/daemon/**`、`scripts/**`。

### T8b 命令与真实结果

```text
$ pnpm typecheck                                                  EXIT=0
$ pnpm test:unit
Test Files 1 failed | 72 passed (73) | Tests 1 failed | 1370 passed (1371)   EXIT=1
  # 唯一失败：packages/contracts/test/entities.test.ts > accepts one valid row per table
  # （tool_operation.targets 缺失），来自其他车道在制的 packages/contracts/src/entities/run.ts；
  # T8b 文件（supervisor/runtime/contracts-runtime/doctor）全部通过。
$ pnpm exec vitest run --project unit packages/core/test/{supervisor,runtime}.test.ts packages/contracts/test/runtime.test.ts
Test Files 3 passed (3) | Tests 47 passed (47)                     EXIT=0
$ pnpm exec vitest run --project integration apps/cli/test/doctor.integration.test.ts apps/cli/test/runtime.integration.test.ts
Test Files 2 passed (2) | Tests 16 passed (16)                     EXIT=0
$ pnpm exec vitest run --project integration apps/daemon/test/attempt.integration.test.ts
Test Files 1 passed (1) | Tests 2 passed (2)                       EXIT=0   # 真 supervisor + 真 apps/runner
$ pnpm build                                                       EXIT=0
$ pnpm docs:check
docs:check ok — 16 documents, 65 internal links, 94 acceptance cases, 9 requirements, 11 work packages   EXIT=0
$ eslint <T8b 的 4 个 src + 4 个 test 文件>                         ESLINT_EXIT=0
$ prettier --check <同上>   All matched files use Prettier code style!   PRETTIER_EXIT=0
```

### T8b 仍未做（归属明确）

1. **P2-2**：`work.control resume` 的非原子与 `applied`/无事件偏离 `protocol.md` §4——按父代理
   指示留到下一轮（需改 T3 在制的 `apps/daemon/src/protocol.ts`）。
2. **P2-3**：`pnpm test:e2e`/`pnpm test:acceptance` 需在 Test 阶段用 T8a+T8b 之后的代码树重跑。
3. 既有残余（§4.1 崩溃在 spawn 窗口、§4.2 resume 路径 `paused→running`）不变，归属照旧。

