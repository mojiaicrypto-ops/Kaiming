# WP-12 T8a 独立 Review — supervisor / 恢复决定路径 / daemon 锁-epoch

- 评审对象：WP-12 T8a（WP-11 遗留四条的 supervisor、恢复决定、锁 epoch 部分；不读 `T8a-implementation.md` 与开发聊天）
- 评审方式：只读代码 + 自建真实复现（真实 CLI 三循环、真实 SQLite store 探针、targeted vitest）+ 定向 mutation reasoning
- 起始 `HEAD`：`7c723ec`；评审期间工作树含其他 agent 的在制改动（`git status` 112→120 项），本人未改动任何仓库文件（唯一产出为本报告）
- 结论：**PASS**（0×P0 / 0×P1；2×P2 + 3×P3；6 条声明全部独立验证成立）

---

## 1. 阻塞发现（P1）

无。

T8a 的六条声明我都在真实执行的路径上复现成立；未发现假完成、fail-open、双写者、凭证泄漏或数据损坏。

---

## 2. 非阻塞发现

### P2-1（最高优先）`starting` Run 收到 ready 之前的 `attempt.result` 会被静默丢弃，Run 永久停尸在 `starting`

- 位置：`packages/core/src/supervisor.ts:961-995`（`attempt.ready` 才建 `running`）、`:1037-1102`（`finishFromResult`）、`:1091-1099`（`settle`）、`packages/domain/src/transitions.ts:56`（`starting` 无 `completed`/`contract_violation` 出边）、`packages/core/src/run-lifecycle.ts:355`（`end` 校验转换）
- 复现（本人执行，真实 `ProjectStore` + 真实 `RunLifecycle`/`RunRecoveryService`，仅进程被脚本化，`/tmp/t8a-probe/result-before-ready.mjs`）：
  ```
  tick claimed = ["01a09fb4-..."]
  run after spawn = starting
  [log] supervisor: settlement refused for ...: Run ... cannot move starting → completed
  attempt after result = completed
  run after result    = starting
  live attempts       = 0
  second tick claimed = []
  run after retick    = starting
  ```
- 机制：T8a 让 Run 在 `attempt.ready` 前保持 `starting`（正确，见 §4.1）。但 `finishFromResult` 对 `attempt.result:completed` 直接调用 `RunLifecycle.settle('completed')`；`RUN_TRANSITIONS.starting` 只有 `running/failed/cancelled/interrupted`，于是 `end()` 抛 `VALIDATION_ERROR`，被 `this.guarded('settlement', …)` 吞掉并只记日志。结果：Attempt=`completed`、无 live entry、无 `run.ended`、无 `reportSettled`；`queued()`（`supervisor.ts:648`）只捞 `queued`/`running`，`resumeParkedRun`（`:471-477`）只收 `interrupted`/`recovery_required`，因此没有任何 tick 或产品动作会再碰这个 Run。Work 预算预留不释放、由消息驱动的 Run 的 message 永远停在 `processing`（`onAttemptSettled` 只在终态触发）。当前只能靠 `work.control cancel`（`starting→cancelled` 合法）或 daemon 重启（`recoverAfterRestart` 的 `RESUMABLE_STATUSES` 含 `starting`）脱困。
- 可达性：**不是** shipped Runner 的行为——`apps/runner/src/attempt.ts:246` 必先发 `attempt.ready`，且 prompt 只在 ready 之后下发，`apps/runner/src/attempt.ts:296` 的 result 必然晚于 ready。触发条件是非合规/损坏的 Runner 或 `attempt.ready` 那一行在管道/校验中被丢弃（`runner-spawn.ts:145-158` 会静默丢弃 parse/`runnerMessageSchema` 失败的整行）。注意到 `LiveAttempt.ready`（`supervisor.ts:247`）被写入却从未被读取，说明“ready 之前不得交付”这条不变式目前没有落点。
- 影响验收：AC-020/AC-057/AC-061/AC-082 均不受影响（§4.1/§4.5 已实测）；属健壮性/存活性缺口，故不阻断。
- 要求修复（二选一，建议前者）：① `applyMessage` 的 `attempt.result` 分支在 `entry.ready !== false` 时才走 settle，否则转 `park`（保持“ready 确认 epoch/进程/环境后才算 Running”的文档语义）；② 在 `RUN_TRANSITIONS.starting` 补 `completed`/`contract_violation` 出边，并让 `end()` 的语义在“未 ready”时可解释。若判定为可接受风险，须在 T8a 记录中登记为已知缺口并写明触发条件。

### P2-2 已登记的 `work.control resume` 两项 P2（WP11R5-01 非原子 / WP11R5-02 响应形状+事件）仍未关闭

- 位置：`apps/daemon/src/protocol.ts:1955-1996`
- 事实：`action=resume` 且 Work 非 `paused`、存在 `interrupted`/`recovery_required` Run 时，逐 Run `recordResumeDecision` → `resumeParkedRun`（循环中途失败则前面的 Run 已真实续跑，`:1960-1970`），并在 `:1989-1995` 返回 `{status:'applied', resumedRunIds}`；`docs/architecture/protocol.md:60` 的契约是 `accepted；work.control_changed`，该分支不写任何事件。`grep -rn resumedRunIds` 显示该字段无任何消费方/测试。
- 证据性质：**代码级**（file:line + 契约对照），本轮未构造 daemon 级复现脚本；WP-11 `test.md` §5.2/§5.3 的复现仍成立。
- 说明：这不在 T8a 开发者列出的 6 条声明内（T8a 关闭的是 WP11R5-03 与 WP11R4-04），但计划 T8 行写的是“WP-11 review 的 3 条 P2”，而 `apps/web/public/app.js:1477-1485` 忽略响应体直接 reload，所以当前无 UI 后果。请父 agent 确认 WP11R5-01/02 归属哪个子片；若属 T8a，则本片范围只关闭了 3 条中的 1 条。
- 影响验收：不改变 AC-020/AC-057 的已验收行为（WP-11 结论一致），不阻断。

### P2-3 WP-12 的 acceptance / e2e 证据早于 T8a 代码，不能作为本片证据

- 时间戳实测：`supervisor.ts` 18:27、`supervisor.test.ts` 18:27、`apps/cli/test/runtime.integration.test.ts` 18:14、`runtime.ts` 18:15、`findings.ts` 18:16；而 `.agentdev/work/WP-12/acceptance-results.json` 18:07、`e2e-results.json` 17:54。
- 计划 §5 要求“涉及 UI/运行时：`pnpm test:e2e`”。T8a 改了 supervisor 的启动状态机与 park 语义，`scripts/e2e.mjs:2170-2210`（`runtime.executes-attempt`）虽与新语义兼容（只等待 `interrupted|recovery_required`，不依赖 running-before-ready；我已逐行核对），但**该结论没有被 T8a 之后的真实运行覆盖**。请 Test 阶段重跑 `pnpm test:e2e`（至少 `runtime.executes-attempt`）与 `pnpm test:acceptance`。
- 影响验收：若最终发布证据只引用 18:07 的 acceptance，则 AC-057/AC-061 的 PASS 不能归因于 T8a 代码。不阻断 Review。

### P3-1 `daemon.epoch` 未进入 `packages/contracts` 的文件契约，也未进安装文档

- 位置：`packages/contracts/src/runtime.ts:29-44`（`RUNTIME_FILES` 无 epoch）、`docs/operations/installation.md:24-33`（安装目录表只有 credential/runtime.json/daemon.lock/projects.json/config.toml/secrets/logs/projects）、`packages/core/src/runtime.ts:60`（名字只在 core 内部硬编码）
- 该文件的实现是正确的（0600、同一 `writePrivateFile` 原子写、停后保留、`readEpochHighWater` 损坏当 0、`max(锁,高水位)+1`，见 §4.4），但契约/文档未同步。
- 遗漏的实际后果（已核实，不是推测）：
  1. `RUNTIME_FILES` 的注释自称“the single source of truth for the *files* both sides of that contract read and write”，`runtimePaths()` 是“no caller re-derives a file name”，现在被 `packages/core/src/runtime.ts:191,199` 的 `join(home,'daemon.epoch')` 打破；CLI 侧无法引用该路径。
  2. `apps/cli/src/runtime.ts:247` 的 `RUNTIME_FILENAMES = RUNTIME_FILES` 现在无任何消费方（`grep` 零命中），既死又残缺——若将来有 cleanup/relocate/uninstall 按契约枚举 home 文件，会静默漏掉高水位，使 epoch 可被重放。
  3. 运维文档的目录表不含该文件，操作者会在 `~/.agentdev` 看到一个未解释的持久 0600 文件。
- 当前无功能缺陷：backup 是 per-project + 安装配置 sidecar（`apps/cli/src/ops.ts`），restore/relocate 不动 home 级文件，因此没有“把 epoch 漏出备份”的可达 bug。建议把 `daemon.epoch` 加进 `RUNTIME_FILES`/`RuntimePaths`（或至少在 installation.md §2 与 reliability.md §7 标注其语义与保留策略）。

### P3-2 doctor 会把「0600 的目录」判成 `credential ok`，且人类可读输出丢弃 `runtime.detail`

- 位置：`apps/cli/src/doctor.ts:266-293`（只判 `mode & 0o777 === 0o600`，不判 `isFile()`）、`:434-442`（渲染 runtime 行时不带 `report.runtime.detail`）
- 复现（本人执行；`AGENTDEV_HOME=/tmp/t8a-rec2-70909/home`，先让一次失败的 `start` 把 `installation-token` 目录 chmod 成 0600——`packages/core/src/auth.ts:116-124` 的 `enforcePrivateMode` 会这么做）：
  ```
  $ stat -f "%Sp %HT" "$HOME/installation-token"
  drw------- Directory        # mode 0600、isdir=true
  $ agentdev doctor --json  → runtime: {"installationToken":"ok", ..., "detail":"runtime.json is unreadable: ..."}
  $ agentdev doctor         → ok   runtime  /tmp/.../home — credential ok, not running
  $ agentdev start          → exit 1, log: START_FAILED: EISDIR: illegal operation on a directory, read
  ```
- 判定：doctor 不崩溃、`--json` 有 detail（T-04 的“未捕获崩溃/无 operationId”确实已修），但“credential ok”与 `start` 的 EISDIR 直接矛盾，人类可读行也看不到 runtime.json 损坏的 detail。属**可诊断性** P3，不影响 AC-048 的执行就绪判定（`runtime` 不参与 blockers）。
- 建议：`existsSync && statSync().isFile() && mode===0600` 才算 ok，否则 `insecure`；渲染行带上 `detail`。顺带把 doctor 里硬编码的 `installation-token`/`runtime.json` 换成 `RUNTIME_FILES`，否则 P3-1 的漂移会再次发生。

### P3-3 一条新断言比声明更宽

- 位置：`apps/cli/test/runtime.integration.test.ts:250`：`expect(['RUNTIME_RECORD_INVALID','START_TIMEOUT']).toContain(body.error.code)`
- 声明（claim 5）是“回归测试断言 `RUNTIME_RECORD_INVALID` + operationId + 无残留 `daemon.lock`”。真实行为在 P3 复现里**确定性**为 `RUNTIME_RECORD_INVALID`（截断记录 + 不可用凭证，daemon 10s 内不会重写记录），因此 `START_TIMEOUT` 这个宽容分支没有必要，且会让“回退成 START_TIMEOUT”这种回归逃过该用例。建议收紧为 `.toBe('RUNTIME_RECORD_INVALID')` 并保留 `daemon.lock` 断言。

---

## 3. 契约/文档核对（是否“该改没改”）

| 文档 | 结论 |
|---|---|
| `docs/architecture/reliability.md` §7 | **无需改**。§7 只固定“启动命令/单实例/epoch 后加载数据/只回环/失败输出 error code+operationId”，不枚举 home 文件、不固定 Run 状态顺序；高水位文件是实现细节。但建议补一句 epoch 高水位语义（配合 P3-1）。 |
| `docs/architecture/protocol.md` §3/§7 | **未改是对的**。§3/§4 不含 Run 状态机；§6 的 `runner.ready* → 产生 run.started` 与本次“ready 后才 running + 发 run.started”完全一致；§7 只要求 data 为实体摘要，svc 发的事件字段差异（`resumed:false`）不违约。 |
| `docs/rules/workflow.md` §5.3 | **未改是对的**。`queued→starting→running` 与“interrupted 可检查后新 Attempt；不确定副作用为 recovery_required”本就如此，本次是让实现回归文档（见 §4.1）。 |
| `docs/delivery/acceptance.md` AC-020/036/056/057/061/082 | **未改是对的**（计划非目标：不改 AC）。已核对 6 条原文；AC-057 写的是 `interrupted/recovery`、AC-061 要求“不按旧字段直接运行”，新语义均满足。AC-036/AC-056 与本片无交集。 |
| `docs/operations/installation.md` §2 | **该改没改**（P3-1）：目录表缺 `daemon.epoch`。 |

另：`protocol.md:60` 的 `work.control resume* → accepted；work.control_changed` 与实现（`applied`、无事件）仍不符（P2-2）。

---

## 4. 已验证的声明（全部为本轮真实执行）

工具链：Node 24.8.0 / pnpm 12.3.4；`PATH="$HOME/.local/bin:$PATH"`。

### 4.0 基础门禁

- `pnpm typecheck` → exit 0（`tsc -p tsconfig.json --pretty false`，无输出）
- `pnpm docs:check` → `docs:check ok — 16 documents, 65 internal links, 94 acceptance cases, 9 requirements, 11 work packages`
- `pnpm lint` → **FAIL**，但 5 个 error 全在 `apps/daemon/src/tool-handler.ts:387`、`packages/core/src/read-ledger.ts:114/129/191/242`，均为**并发 agent 在制文件**，与 T8a 文件（supervisor/findings/runtime/main/cli/contracts-runtime）无关；属性归并发状态，本身不构成本片发现。
- targeted vitest（unit）：`packages/core/test/{supervisor,findings,recovery,runtime}.test.ts` → **91 passed**；`--reporter=verbose` 确认新用例名：
  - `reports the Run as starting until the Runner confirms ready (reliability.md §2)` ✓
  - `parks a spawn failure as a resumable Run instead of a dead end (WP11R5-03)` ✓
  - `parks a prepare failure as a resumable Run` ✓
  - `never claims "no process" when the failure happens after the spawn` ✓
  - `refuses to resume a recovery_required Run that has no persisted verdict (WP11R4-04)` ✓
  - `refuses to resume while a Run still needs recovery (AC-020)` ✓（含“决定覆盖后 resume 成功”方向）
- targeted vitest（integration）：
  - `apps/cli/test/runtime.integration.test.ts` → 7 passed（含 epoch 单调、损坏记录）
  - `apps/daemon/test/{attempt,runtime}.integration.test.ts` → 8 passed（真 `apps/runner` 子进程 + 真 Provider stub：`starts apps/runner, calls the Provider through the Core gateway and settles the Run`）
  - `packages/core/test/{wp08,delivery}.integration.test.ts` → 20 passed（含 `preserves the narrow DispatchSnapshot scope across a restart recovery (AC-082)`、`starting` + live process 的 park 与 `resumeTx` 拒绝）

### 4.1 声明 1：Run 状态语义（最高风险项）——成立

- 代码：`supervisor.ts:744-770` `openAttemptForSpawn` 只写 `starting`；`:961-995` `attempt.ready` 才 `starting→running` 并**在该处**发 `run.started`（`:981-991`）。`RunLifecycle.beginAttempt`（会 `starting→running` 同事务）不再用于 claim 路径。
- 实测（`supervisor.test.ts` 24 passed，含新增用例）：spawn 后 `run=starting`、`attempt=starting`、`run.started=0`；`attempt.ready` 后 `run=running`、`run.started=1`。
- 三条既有断言确实被**改严**而非放宽：
  1. `supervisor.test.ts:247` `running → starting`（并保留 `attempt.commands` 空 → prompt 必须等 ready）——严格更强；
  2. `supervisor.test.ts:409-419`、`supervisor.test.ts:~825-836` 两处 `recovery_required → interrupted`，但每处**新增** `newAttemptAdmission → {allowed:false, requiresRecoveryDecision:true}`，且原有的 `resumeParkedRun → RECOVERY_REQUIRED`、`recordResumeDecision → RECOVERY_REQUIRED`（进程未确认终止）断言不变。我核对了这两条新断言是**有承重**的：`supervisor.resumeParkedRun:486-515` 与 `findings.resumeTx:1696-1708` 都以 `newAttemptAdmission` 为唯一闸门，所以“状态名看起来更松（interrupted 更可恢复）”被“verdict 扣住新 Attempt”补回了安全属性。净效果：安全属性被更显式地断言，不是放宽。
- `RUN_TRANSITIONS` 一致性：`packages/domain/src/transitions.ts:54-79` 未改；`starting: ['running','failed','cancelled','interrupted']` 与“starting 不能直接跳 recovery_required”（`recovery.ts:841-849` 落到 `interrupted` + withheld verdict）一致。唯一不一致是 `starting` 缺 `completed`/`contract_violation` 出边 → P2-1。
- 门禁/预算/租约：`findings.writeAdmission`（`findings.ts:1411-1445`）本来就要求“Run running **且** 最新 Attempt running”，新顺序下窗口内两者都更早为假，结果只会更严；`pauseTx` 显式处理 `starting→interrupted`（`findings.ts:1533-1536`）；`stage.ts:126` 要求 `run.status==='running'`，而现在 prompt 只在 ready（run 已 running）后下发，属收紧；`gateway-http.ts:270`/`control-http.ts:371` 按 Attempt 状态放行；`protocol.ts:3950` 的 active-Run 投影本就包含 `starting`。未发现依赖旧 running-before-ready 的调用方/投影/UI/AC。
- 唯一仍“先 running 后 ready”的是 resume 路径（`findings.ts:1726-1759` 的 `paused` 分支与 `lifecycle.beginAttempt`；`RUN_TRANSITIONS` 无 `paused→starting`）。这与代码内注释（`supervisor.ts:736-738, 975-977`）一致，属保留的既有设计，不是回退。

### 4.2 声明 2：spawn/prepare 失败不再是死角——成立，且两条路径不可混淆

- 代码：`supervisor.ts:783-818` `abandonUnstarted` 写 `run.recovered{newAttemptAllowed:true, neverStarted:true, requiresRecoveryDecision:false, processAlive:null}`；`:486-495` `resumeParkedRun` 对 `neverStartedVerdict` 为真的 Run **跳过** liveness 探针；`:834-873` 一旦 `spawn` 返回进程，登记失败改走 `child.terminate('SIGTERM')` + `markAttemptFailed` + `park()`（真实恢复路径）。
- 实测：`parks a spawn failure as a resumable Run instead of a dead end`（spawn ENOENT → Run `interrupted`、Attempt `failed`、`newAttemptAdmission.allowed=true`、`resumeParkedRun.ok=true`、Attempt 1→2、重开 Run 仍 `starting`）✓；`parks a prepare failure as a resumable Run` ✓。
- 不可混淆的实测证据：`never claims "no process" when the failure happens after the spawn` → `runner.signals` 含 `SIGTERM`、Run `interrupted`、`run.recovered` 恰好 1 条且 `data['neverStarted'] === undefined`、`newAttemptAdmission.allowed === false` ✓。即 post-spawn 路径不会写 `neverStarted`，因此 `resumeParkedRun` 仍必须过真实探针/决定。
- 事件形状：新增字段只多不少（`recovery.ts:922-942` 的 `apply` 版本另带 `hostEpoch`/`reasons`，`abandonUnstarted` 版本不带但带 `neverStarted`）；唯一两个消费方 `recovery.ts:282`、`supervisor.ts:828` 都只按事件名扫描并读 `newAttemptAllowed`/`requiresRecoveryDecision`/`neverStarted`，无 schema 校验，形状差异无破坏。

### 4.3 声明 3：`resumeTx` fail-closed——成立，双向都有真实用例

- 代码：`packages/core/src/findings.ts:1693-1717`
  ```ts
  const admission = newAttemptAdmission(this.store, run.id);
  if (run.status === 'recovery_required') {
    return !(admission.allowed && admission.resolvedByDecisionId !== null);
  }
  return !admission.allowed;
  ```
  规则显式：`recovery_required` 的 Run 必须“准入放行 **且** 有覆盖本 Run 的决定”才不进入 `unresolved`。
- 拒绝方向（真实执行）：`findings.test.ts:1412-1430` `refuses to resume a recovery_required Run that has no persisted verdict (WP11R4-04)` ✓ —— 先把 Run 改成 `recovery_required`（不写 verdict），断言 `newAttemptAdmission.allowed === true`（证明旧规则的 fail-open），再断言 `resumeWork` 返回 `RECOVERY_REQUIRED`、Work 仍 `paused`、Attempt 数仍为 1。
- 放行方向（真实执行，既有用例）：`findings.test.ts:1332-1410` `refuses to resume while a Run still needs recovery (AC-020)` ✓ —— 无决定/Work-scoped 错误目标时拒绝；写入 `targetRef.id = runId` 的 accepted `resume` 决定后 `resumeWork.ok === true`，Run → `running`。两个方向都在真实 `ProjectStore` 上跑通。

### 4.4 声明 4：epoch 单调（高水位文件）——成立

- 代码：`packages/core/src/runtime.ts:60`（`daemon.epoch`）、`:184-200`（读/写，损坏→0）、`:214-227`（`epoch = max(installedLock, highWater) + 1`，**先** `writeEpochHighWater` 再 `O_CREAT|O_EXCL` 建锁）；`:294-299` `releaseDaemonLock` 只删 `daemon.lock`。
- 真实 CLI 三循环（temp `AGENTDEV_HOME` + 真 `apps/cli/dist/cli.js`，dist 由 18:33 的构建产出且 `grep -c daemon.epoch packages/core/dist/runtime.js = 1`）：
  ```
  cycle 1 start → cli.epoch=1  runtime.json.epoch=1  daemon.epoch=1  mode=-rw-------  lock=yes
  cycle 1 stop  → lock=absent  runtime.json=absent  daemon.epoch=1
  cycle 2 start → cli.epoch=2  runtime.json.epoch=2  daemon.epoch=2
  cycle 2 stop  → daemon.epoch=2
  cycle 3 start → cli.epoch=3  runtime.json.epoch=3  daemon.epoch=3
  cycle 3 stop  → daemon.epoch=3
  ```
  → 跨干净重启严格单调 1→2→3；停止后 **lock 释放、epoch 高水位保留**（正确：围栏必须活过锁）。
- 失败模式实测：
  | 场景 | 结果 |
  |---|---|
  | 高水位缺失、无锁 | 新 epoch = 1（`max(0,0)+1`） |
  | 高水位损坏 `not-a-number` / `0`、无锁 | 新 epoch = 1（忽略损坏，重建高水位） |
  | 陈旧锁 `epoch=9`、高水位损坏 | 新 epoch = 10（被 `max(锁,高水位)` 顶住，不会低于在装锁） |
  | 陈旧锁 `epoch=42`、无高水位 | 新 epoch = 43 |
  | 手工把高水位回滚到 1、无锁 | 新 epoch = 2（**可重放已发过的 epoch**，见下） |
  | 同一 home 两次并发 `start` | 两个 CLI 都输出 `started:true` 且 **同一 pid**；实际只有一个 daemon（不产生双写者），落败者把赢家的记录当自己的报出 |
- 手工回滚判定：`daemon.epoch` 是 0600、仅安装者可改，属显式人为动作；回滚后即便 epoch 重复，`acquireDaemonLock` 仍先 `isProcessAlive(existing.pid)` 拒绝对活着的持有者接管（`:218-220`），且 `recoverAfterRestart` 的围栏值是 `host-<pid>-<epoch>-<ISO时间戳>`（`apps/daemon/src/main.ts:501`），时间戳保证严格递增。因此无实际围栏绕过，属可接受残余（建议在文档中写清“手改该文件即放弃围栏单调性”）。
- 并发 `start` 双 `started:true`：无第二 daemon（锁生效），但响应语义不精确；T8a 之前即存在（`liveRuntimeOr(home,0)` 记录未写时的固有竞态），登记为观察项，不计为 T8a 缺陷。

### 4.5 声明 5：损坏 `runtime.json`——成立（并由我独立复现了三种输入）

- 截断 JSON（`{ "v": 1, "pid": 1`）：`status`、`stop` → exit 1，stderr `{"ok":false,"error":{"code":"RUNTIME_RECORD_INVALID","message":"Expected ',' or '}' after property value in JSON at position 18 ..."},"operationId":"216537f5-..."}` ✓
- 错误类型（`pid:"nope"`, `epoch:0`, `admin.port:0`）：`status`/`stop` → exit 1 且 `RUNTIME_RECORD_INVALID`，message 逐字段列出 `pid/epoch/admin.port`；`doctor --json` 把 `runtime.detail` 完整给出且 exit 0、不崩溃 ✓
- 不可用凭证（`installation-token` 为目录）+ 截断记录：`start` exit 1、`operationId` 存在、code = `RUNTIME_RECORD_INVALID`、**`daemon.lock` 不存在**（无残留锁）、`daemon.epoch` 前进到 1、`logs/daemon.log` 尾部为 `START_FAILED: EISDIR: illegal operation on a directory, read` ✓（耗时 10s = `waitForRuntime` 的 deadline，属预期）
- 截断记录 + 正常凭证：`start` 成功接管并重写为合法记录（`pid=71295 epoch=2`），随后 `status.running=true` ✓
- 合法记录 + 不可用凭证：只能报 `START_TIMEOUT` + `operationId` + `logTail`（记录合法，故不能谎称 INVALID；日志给出 EISDIR 真因），语义正确 ✓
- `readLiveRecord`/`waitForRuntime` 的抛错-包装链路（`apps/cli/src/runtime.ts:56-68,184-215`；`apps/cli/src/cli.ts:156-166,189-199,242-... ,297-305,342-348`）经上述真实调用验证。

### 4.6 声明 6：doctor 无缺陷——基本成立，但见 P3-2

- 不崩溃、退出码/`executionReady` 不受损坏记录影响、`--json` 暴露 `detail`；`probeRuntime` 对缺失记录返回 `running:false`；缺失凭证不算 blocker（首次 `start` 会创建），`insecure` 才算 blocker。
- 例外：`installationToken` 只按 mode 判定，0600 的**目录**被报 `ok`；人类可读行不渲染 `detail`。均已在 P3-2 给出复现。

---

## 5. Mutation reasoning（≥3；推理，本轮**未**执行源码变异——Review 只读）

| # | 变异 | 预期失败断言 | 强度 |
|---|---|---|---|
| M1 | `packages/core/src/runtime.ts:227` 删掉 `writeEpochHighWater(...)`（或 `:224` 改回 `(existing?.epoch ?? 0)+1`） | `apps/cli/test/runtime.integration.test.ts:231` `expect(secondEpoch).toBeGreaterThan(firstEpoch)` 失败（第二次回到 1） | 强。旁证：我实测“高水位缺失/损坏”时新 epoch 恒为 1（§4.4），说明该用例确实由高水位文件驱动 |
| M2 | `packages/core/src/supervisor.ts:767` 把 `{status:'starting'}` 改回 `running`（旧 `beginAttempt` 语义） | `packages/core/test/supervisor.test.ts:247` 的 `.toBe('starting')`、`:279-281` 的 `.toBe('starting')` + `run.started` 长度为 0 全部失败 | 强，且直接锁住本片最高风险语义 |
| M3 | `packages/core/src/supervisor.ts:811` 把 `neverStarted: true` 改成 `false`/删除 | `packages/core/test/supervisor.test.ts:329-330` `expect(resumed.ok).toBe(true)` 失败——`resumeParkedRun` 会回落到探针，`pid:pending` 不可确认 → `RECOVERY_REQUIRED` | 强，正好证明 `neverStarted` 是让 WP11R5-03 死角消失的唯一事实 |
| M4 | `packages/core/src/findings.ts:1705-1707` 改回 `return !admission.allowed;` | `packages/core/test/findings.test.ts:1429` `expect(resumed.ok).toBe(false)` 失败（verdict 缺失时 admission.allowed=true → 放行） | 强，证明 claim 3 的新规则有真实约束力；拒绝/放行两向都被覆盖 |
| M5 | `apps/cli/src/runtime.ts:56-68` 把 `readLiveRecord` 的失败改成 `return null` | `apps/cli/test/runtime.integration.test.ts:199` `expect(result.code).toBe(1)` 失败（status 会成功返回 running:false） | 中强（第二处 `start` 用例因 `:250` 宽容而漏检 → 见 P3-3） |

---

## 6. 未验证 / 不确定

1. **未执行 `pnpm test:e2e` / `pnpm test:acceptance` / `pnpm test:live`**：并发 agent 正在改进 `apps/daemon/src/{main,protocol,prepare-run,control-handler}.ts`、`packages/core/src/{control-http,execution,gateway-http,tool-*}.ts`、`scripts/**`，且全套运行昂贵；我只做了逐行核对（`scripts/e2e.mjs:2170-2210` 与新语义兼容）与 target 集成测试。P2-3 的证据时效问题因此仍未消除。
2. **P2-1 的可达性未在真实 Runner 上触发**：我用真实 `ProjectStore` 复现了“ready 前 result → 停尸”，但 shipped Runner 不会发出该序列；触发条件（ready 行丢失/非合规 Runner）未做端到端注入。
3. **P2-2（WP11R5-01/02）为代码级判定**，未另写 daemon 级复现脚本；依据为 `protocol.ts:1955-1996` 与 `protocol.md:60` 的对照，以及 `grep -rn resumedRunIds` 零消费方。
4. **`stage_result` 持久化与 AC-066** 不在本片 6 条声明内，未审。
5. `pnpm lint` 的 5 个 error 归因于并发在制文件（tool-handler/read-ledger），我未逐一确认其作者/子片；若其中任一项属 T8a 会改变本结论，但按文件归属不成立。
6. 未审 `.agentdev/work/WP-12/T8a-implementation.md` 及任何开发聊天（按要求）。

---

## 7. 结论

**PASS**。6 条声明全部在真实执行路径上成立；运行状态语义的改动与 `RUN_TRANSITIONS`、写准入、暂停、预算/租约、门禁及 AC-020/057/061/082 的现有测试一致，且三条被调整的既有断言是收紧（新增的 `newAttemptAdmission` 断言是承重的）。无 P1。需在 Test/结算前处置：P2-1（ready 前 result 停尸，建议按 `entry.ready` 闸门或补 `starting` 终态出边）、P2-2（WP11R5-01/02 归属确认）、P2-3（重跑 e2e/acceptance 取证），以及 P3-1/P3-2/P3-3。
