# WP-11（运行时与 Runner 执行器）独立 Review 报告（第 4 轮 · 增量）

- 角色：独立 Review（独立上下文；未读取任何开发聊天、transcript 或 session log；仅依据仓库文件、git 对象与本轮自建实验）
- 工作包：WP-11 A1 + A2（第 4 轮修复轮复核，增量 `302b382..bf97473`）
- 冻结点：commit `bf97473332cf1a7a568d94b0e7781c0e771e78ea`，tree `b598d62d2778783e987fab802f2b1a0f94564880`
- 证据目录：`/tmp/wp11rev4/`（自建复现脚本与原始输出日志）
- 唯一写入：`.agentdev/work/WP-11/review-round4.md`（`pnpm test:e2e`/`pnpm test:live` 改写的 `.agentdev/work/WP-10/{e2e,live}*` 已 `git checkout --` 还原；最终工作树干净）
- 环境：macOS，node v24.8.0，pnpm 12.3.4；Provider 凭证仅通过环境变量传给 `pnpm test:live`，未落盘、未回显（`grep -rl` 于 `/tmp/wp11rev4/` 与仓库均为 0 命中）

## 1. 冻结与哈希

```text
$ git rev-parse HEAD
bf97473332cf1a7a568d94b0e7781c0e771e78ea
$ git rev-parse HEAD^{tree}
b598d62d2778783e987fab802f2b1a0f94564880
$ git status --porcelain
(空)
$ git log --oneline -3
bf97473 fix(core): give a parked Run a real product path and close the round-3 findings
302b382 fix(core,daemon,cli): close the WP-11 review round-2 findings
6b0228f fix(core,daemon,cli): close the WP-11 review round-1 findings

$ git diff --stat 302b382..bf97473
 .agentdev/work/WP-11/implementation.md |  16 ++
 .agentdev/work/WP-11/review-round3.md  | 375 +++++++++++++++++++++++++++++++++++
 apps/cli/src/cli.ts                    |   2 +-
 packages/core/src/findings.ts          |   6 +-
 packages/core/src/recovery.ts          |  15 +-
 packages/core/src/supervisor.ts        |  38 +++-
 packages/core/test/findings.test.ts    |  64 ++++
 7 files changed, 507 insertions(+), 9 deletions(-)
```

增量逐行阅读：`findings.ts`（`resumeTx` 去掉 `recovery_required` 硬分支、改用 `newAttemptAdmission`）、`supervisor.ts`（`resumeParkedRun` 新增 `recovery.inspect` 与 `capacityFor` 守卫、`queued()` 改为 `status IN ('queued','running')` 并认领无进程的 `starting` Attempt）、`recovery.ts`（决定行 `targetRef.version=run.version`、hash 取真实事实）、`apps/cli/src/cli.ts`（`START_FAILED` 补 `operationId`）、`findings.test.ts`（AC-020 用例重写）与两份记录。

## 2. 结论

**FAIL（阻断独立 Test）。** 第 3 轮的 5 个条目中 **4 个真实关闭**（WP11R3-02/03/04/05），WP11R3-01 的 **`findings.ts` 一半关闭**（`resumeWork` 已按持久准入放行，无决定拒绝 / 兄弟 Run 的决定不解除 / 本 Run 决定放行三条均复现成功），但该 P1 **端到端未关闭**：为接线而新增的 `claim()` 认领分支会让执行器**必然失败**被 `work.control resume` 唤醒的 Run（含最普通的 pause→resume 路径），既不 spawn，又留下悬空的 `starting` Attempt。`implementation.md` T11「`resumeWork` 打开的 Attempt 会被真实执行器接手并 spawn」在本轮实测下不成立，且是**产品可达回归**。

严重度汇总：

| 严重度 | 数量 | 编号 |
|---|---|---|
| P0 | 0 | — |
| P1 | 1 | WP11R4-01 |
| P2 | 1 | WP11R4-02 |
| P3 | 2 | WP11R4-03、WP11R4-04 |

是否阻断独立 Test：**是**。WP11R4-01 使 `work.control resume`（普通 pause→resume 与 `interrupted`/`recovery_required` 续跑皆然）在真实 supervisor 下把 Run 打成 `failed`，这是产品回归 + 未兑现的完成声明；WP11R4-02 表明 `recovery_required` 仍然没有产品内可推进的动作（第 3 轮 P1 的后半段未处理）。两者都可用确定命令复现，应在恢复到「resume 后 Run 真正被 spawn」之前维持 Review Failed。

其余判定依据（全部为本人亲自复现，命令与原始输出见 §7）：

- WP11R3-02 关闭：`START_FAILED` 与 `START_TIMEOUT` 均带 `operationId`（真 `apps/cli/dist/cli.js`，exit 1）。
- WP11R3-03 关闭：`resumeParkedRun` 在 spawn 前 `recovery.inspect()`，持久准入放行但 pid 复用存活时返回 `RECOVERY_REQUIRED` 且不 spawn。
- WP11R3-04 关闭：并发上限 2 时第 3 次续跑返回 `BUSY`，live 保持 2。
- WP11R3-05 关闭：`targetRef.version === run.version`，hash 等于 `sha256(canonicalJson({runId,status,runnerId,heartbeatAt}))` 的真实事实摘要（非旧的 `recovery:<id>` 合成值），Row 仍 Run-scoped。
- 早期结论保持关闭：孤儿 Runner 升级到 SIGKILL 且 `stop()` 在观察到 exit 之后才 resolve；迟到结果不改写 `stopped`；`pid:` 探针语义（`pid:pending` / pid 复用 fail-closed）；capability 停靠/epoch/终态/端点重启失效；Runner 子进程环境白名单无 `NODE_OPTIONS`/`AGENTDEV_PROVIDER_*`；e2e AC-057 断言严格且具鉴别力。
- 全部回归门禁绿（typecheck/lint/unit/integration/e2e/docs/build/doctor/live）。

## 3. 增量复核（302b382..bf97473）

| 第 3 轮发现 | 本轮复现方式 | 观测结果 | 结论 |
|---|---|---|---|
| WP11R3-01 `resumeWork` 对 `recovery_required` 硬拒绝 | `r4-01-product-path.mjs` 真 `FindingService` + 真 `RunnerSupervisor` | (a) 无决定 → `RECOVERY_REQUIRED`；(b) 兄弟 Run 决定 → 仍 `RECOVERY_REQUIRED`；(c) 本 Run accepted `recovery`/`resume` → `ok=true`、Run `running`、Attempt #2 `starting` | **`findings.ts` 一半关闭** |
| WP11R3-01 声称「Attempt 会被真实执行器接手并 spawn」 | 同脚本第 3 步 + `r4-02`/`r4-11` | `tick.claimed=[]`、`spawned=0`，日志 `cannot start … cannot start from running`，Run 被 `settle('failed')`，Attempt #2 永久 `starting` | **未关闭 → WP11R4-01（P1）** |
| WP11R3-02 `START_FAILED` 无 `operationId` | 真 CLI：入口缺失 / 入口挂起 | `START_FAILED` 与 `START_TIMEOUT` 均出现 `operationId`（各 1 处），exit 1 | **已关闭** |
| WP11R3-03 `resumeParkedRun` 不复核真实进程 | `r4-03-attacks.mjs` 场景 D（持久准入 allowed=true，pid 复用存活） | `resumeParkedRun → RECOVERY_REQUIRED`，spawned=0，attempts 仍 1 | **已关闭** |
| WP11R3-04 `resumeParkedRun` 绕过并发上限 | `r4-03-attacks.mjs` 场景 E（project=2/role=2） | resume #1/#2 `ok=true`（live 2），#3 `BUSY`（live 仍 2） | **已关闭** |
| WP11R3-05 `targetRef.version`/hash 合成 | `r4-04-targetref.mjs`、`r4-04b-debug.mjs` | `targetRef.version === run.version`；hash = `sha256(canonicalJson({heartbeatAt,runId,runnerId,status}))`（debug 重算完全一致），`targetRef.id === runId` | **已关闭** |
| 第 3 轮 AC-020 用例重写是否仍测其声明规则 | 读 `findings.test.ts:1331-1408` + 跑 unit | 断言「无决定拒绝 / 兄弟决定不解除 / 本 Run 决定放行且 Run 回到 running」，不弱化；但**不检查 Attempt 存在、不驱动 supervisor**，且用例名仍写 "refuses to resume…" | 见 WP11R4-03（P3） |

### 3.1 WP11R3-01：`findings.ts` 一半确实关闭

`r4-01` 逐条复现了 §3 表格 (a)(b)(c)：去掉硬分支后，`resumeTx`（`findings.ts:1694-1700`）只以 `newAttemptAdmission` 为权威，accepted、Run-scoped 的决定能解锁；`resumeWork` 对 `recovery_required` Run 走 `beginAttempt`（`:1744-1751`）回到 `running`。这部分与 T11 文字一致。

### 3.2 新增的 `claim()` 认领分支必然失败（P1 根因）

增量把 `queued()`（`supervisor.ts:519-543`）从「只认 `queued`」改成「`queued` + `running` 且最新 Attempt 为 `starting` 且无 `runnerId`」，`claim()`（`:560-588`）随后对选中的 Run 调 `spawnRun`，而 `spawnRun`（`:603-606`）**再次**调用 `lifecycle.beginAttempt(run.id, {runnerId})`：

- `RunLifecycle.beginAttempt`（`run-lifecycle.ts:118-138`）要求 `canTransitionRun(run.status,'starting')`；`RUN_TRANSITIONS.running` 不含 `starting`（`packages/domain/src/transitions.ts:57-68`），且此刻 `run.status === 'running'` → 抛 `VALIDATION_ERROR: Run … cannot start from running`。
- `claim()` 的 catch（`supervisor.ts:576-585`）看到 `run.status !== 'queued'`，于是 `this.lifecycle.settle(run.id, 'failed')`。
- 结果：**认领分支选中后 100% 失败**（除非 Run 是 `queued`，但 `queued` 在过滤时提前 `return true`，永远走正常 `queued→starting` 路径）。被 resume 唤醒的 Run 反而被判 `failed`，且 `beginAttempt` 从没被调用成功，Attempt 保持 `starting`、无 `runnerId`、无对应进程。

### 3.3 影响面：不止 `recovery_required`，最普通的 pause→resume 也中招

`r4-11-normal-resume.mjs`：`pauseWork`（Run `paused`、Attempt `stopped`）→ `resumeWork`（`ok=true`，Attempt #2 `starting`，Run `running`）→ `supervisor.tick()` → `cannot start from running` → Run `failed`，Attempt #2 悬空，Work 停在 `running`。`r4-02`（Run 先停为 `interrupted`、确认进程已死）与 `r4-01`（`recovery_required` + 决定）复现同样结果。`work.control resume` 对用户返回 `accepted`，执行器随即把 Run 打失败——这是 P1 级产品回归。

## 4. 门禁与回归复核

```text
$ pnpm typecheck                        → exit 0
$ pnpm lint                             → exit 0（All matched files use Prettier code style!）
$ pnpm test:unit                        → 59 files / 1154 tests passed，exit 0
$ pnpm test:integration -- --maxWorkers=2 → 29 files / 323 tests passed，exit 0
$ pnpm test:e2e                         → 21 checks — PASS 17 / FAIL 0 / UNVERIFIED 4，exit 0
$ pnpm docs:check                       → ok — 15 documents, 54 internal links, 94 acceptance cases, 9 requirements, 11 work packages，exit 0
$ pnpm build                            → exit 0
$ node apps/cli/dist/cli.js doctor      → execution ready: yes，exit 0
$ pnpm test:live（真实 Provider）        → 5 passed / 0 failed / 2 unverified；11 calls，HTTP 200×11，0 failed，exit 0
```

`runtime.executes-attempt [AC-057]` PASS，证据串为「真实 supervisor + 真实 apps/runner 子进程 + 回环模型完成 Attempt；SIGKILL 活跃 Runner 后 Run 停靠 `interrupted`、Attempt `lost`、新 Attempt `allowed=true`」。该检查只覆盖 `queued` Run 的启动与 SIGKILL 停靠，**不覆盖** resume 后的认领，因此对本轮 P1 无鉴别力。

早期结论快速复核（`r4-05`/`r4-06`/`r4-10` 与既有测试）：

```text
孤儿升级（r4-06，真子进程忽略 shutdown+SIGTERM）：
   ignored SIGTERM; sending SIGKILL
   stop() elapsed ms = 565 | exit observed before resolved = true | exit = {signal:"SIGKILL"}
   child alive right after stop() = false | run=interrupted | attempt=lost
迟到结果（r4-05）：after cancel = run cancelled/attempt stopped；after the late result 不变；live=0
pid 语义（r4-05）：parseRunnerPid('pid:123')=123 / ('pid:pending')=null
   confirmed dead → interrupted, admission=true
   pid:pending   → interrupted, admission=false（fail-closed）
   pid 复用存活  → interrupted, admission=false（fail-closed）
子进程环境（r4-05）：keys=[AGENTDEV_RUNNER_ENTRY,HOME,LANG,PATH]；NODE_OPTIONS=false；AGENTDEV_PROVIDER_*=false
capability（既有 gateway-http.test.ts 11 passed）：valid→200、Attempt 停靠后拒绝、epoch 不符拒绝、终态 Run 拒绝；
   端点重启语义成立：AttemptCapabilityStore 仅内存 Map（capabilities.ts:58-60），新实例不持有旧 token
AC-057 鉴别力（r4-10）：real probe → interrupted（断言会 PASS）；blind probe(null) → recovery_required（断言会 FAIL）
```

## 5. 新发现清单

### WP11R4-01（P1）新增的 `claim()` 认领分支不 spawn 反而把被 resume 的 Run 判 `failed`

- 影响：`work.control resume`（普通 pause→resume、`interrupted` 续跑、`recovery_required` + accepted 决定三种情形）在真实 supervisor 下：返回 `accepted` → 下一次 `tick()` 把 Run `settle('failed')`，不 spawn 任何进程，`beginAttempt` 抛错，Attempt 永远悬在 `starting`。T11 的「会被真实执行器接手并 spawn」不成立；这是产品回归 + 未兑现声明。
- 复现：
  ```bash
  node /tmp/wp11rev4/r4-11-normal-resume.mjs   # 普通 pause → resume → tick
  #   resumeWork = {"ok":true,"attempts":[{...number 2}]}
  #   [supervisor] cannot start …: Run … cannot start from running
  #   tick = {"claimed":[],"parked":[],"live":0} | spawned = 0
  #   FINAL = {"work":"running","run":"failed","attempts":[{"n":1,"status":"stopped"},{"n":2,"status":"starting","runnerId":null}]}
  node /tmp/wp11rev4/r4-02-reachable.mjs       # interrupted（确认进程已死）
  node /tmp/wp11rev4/r4-01-product-path.mjs    # recovery_required + Run-scoped 决定（任务指定路径）
  ```
  三者输出一致：`cannot start from running` → Run `failed`，`spawned=0`。
- 证据：`packages/core/src/supervisor.ts:519-543`（新认领过滤）、`:560-588`（claim）、`:603-606`（spawnRun 再次 `beginAttempt`）；`packages/core/src/run-lifecycle.ts:118-138`（`running→starting` 非法）；`packages/domain/src/transitions.ts:57-68`；`packages/core/src/findings.ts:1744-1751`（resumeWork 已先开 Attempt 并把 Run 置 `running`）；`implementation.md` T11 第 2 行。
- 修复建议（任选其一并补回归测试）：① `spawnRun` 区分「已有无主 `starting` Attempt」——认领时直接以该 Attempt 的 id/epoch spawn，不再调用 `beginAttempt`；② `RunLifecycle.beginAttempt` 在「Run 为 `running` 且最新 Attempt 为 `starting` 且无 `runnerId`」时复用该 Attempt 而非新建；③ 让 `resumeWork` 不预开 Attempt（Run 停在 `starting`/`queued`），由 `claim()` 统一走 `queued→starting` 正常路径。必须新增 `resumeWork → supervisor.tick()` 的端到端用例，断言 `spawned===1`、被认领 Attempt 被 spawn（而非新建第 3 个）、Run 不被 `failed`。

### WP11R4-02（P2）`recovery_required` 仍无产品内动作可推进（第 3 轮 P1 的后半段未处理）

- 影响：第 3 轮已指出「Inbox 标 actionable 但无 RPC」。本轮增量只改了 `resumeTx`，**没有任何产品面能写入 Run-scoped 的 accepted recovery 决定**，且真实 `recovery_required` Run 连 `resumeWork` 的前置条件都达不到：`pauseWork` 对 `recovery_required` 直接拒绝（Work 无法进入 `paused`）。
- 复现：
  ```bash
  node /tmp/wp11rev4/r4-07-reachability.mjs
  # recoverRun: running → recovery_required（pid:pending，requiresRecoveryDecision=true）
  # pauseWork  → {"ok":false,"code":"RECOVERY_REQUIRED","recoveryRunIds":[RUN]}
  # resumeWork → {"ok":false,"code":"INVALID_STATE","message":"Work … is running, not paused"}
  # cancelWork → 打开 Work-scoped pending 决定（targetRef.id === workId, targetRef.id === runId = false）
  # 把该产品决定 resolve 为 accepted/resume 后：admission 仍 {"allowed":false,"resolvedBy":null}
  grep -rn "recordResumeDecision\|resumeParkedRun" apps packages scripts --include=*.ts --include=*.mjs | grep -v /dist/
  #   → 仅 packages/core/src/{supervisor,recovery}.ts 与 packages/core/test/supervisor.test.ts
  ```
- 证据：`packages/core/src/findings.ts:1519-1546`（pauseWork 拒绝 `recovery_required`）、`:1623+`（resumeWork 要求 Work `paused`）；`packages/core/src/recovery.ts:281-329`（admission 只认 `targetRef.id ∈ {runId, verdictEventId}`）；`packages/core/src/findings.ts:2536-2551`（cancel 的 recovery 决定是 Work-scoped、pending）；`apps/daemon/src/protocol.ts:1378-1388`（Inbox 标 `actionable:true`）、`:2352-2364`（`decision.resolve` 只能改已存在的决定，Run 决定会 `NOT_FOUND`）；`apps/daemon/src/protocol.ts:1642-1645`（`work.control resume` 不记录决定）。
- 修复建议：新增产品面（如 `run.resume` / `recovery.decide` RPC 或把 Inbox 的 recovery 行接到 `recordResumeDecision` + `resumeParkedRun`），或在存在此类动作前把 Inbox 的 `actionable` 置 false；同时明确 `recovery_required` Run 的 Work 如何进入可 resume 状态（当前 `pauseWork` 拒绝使其不可达）。在补齐并实测「用户动作 → 决定入库 → 新 Attempt 被 spawn」之前，不应声称该路径端到端可用。

### WP11R4-03（P3）重写的 AC-020 用例名不副实且未覆盖被声称的 spawn

- 影响：用例名仍为 `refuses to resume while a Run still needs recovery`（`findings.test.ts:1331`），但结尾断言 resume 成功；且它用 `store.runs.update` 直接把 `paused` Run 改成 `recovery_required`（`RUN_TRANSITIONS.paused` 无此目标，`transitions.ts:71`），手工 append `run.recovered` 与决定行，只断言 `run.status==='running'`，**不检查 Attempt 是否存在、更不驱动 supervisor**。因此整套 1154 个单测无法发现 WP11R4-01。
- 复现：读 `packages/core/test/findings.test.ts:1331-1408`；`git diff 302b382..bf97473 --stat` 显示 `supervisor.test.ts` 未改动。
- 证据：同上；`implementation.md` T11 声称的「被真实执行器接手并 spawn」在测试中无对应断言。
- 修复建议：改名并在 `supervisor.test.ts` 增加「resumeWork → tick → spawned 1」的回归用例（见 WP11R4-01 修复建议）。

### WP11R4-04（P3）`resumeTx` 的准入守卫变成纯「证据依赖」，缺失 verdict 时 fail-open

- 影响：去掉 `recovery_required` 硬分支后，若某 Run 处于 `recovery_required` 而**没有** `run.recovered` verdict 事件（或 verdict 的 `newAttemptAllowed !== false`），`newAttemptAdmission` 返回 allowed，`resumeWork` 会直接开新 Attempt。旧代码的同名硬分支是第二道防线。
- 复现：
  ```bash
  node /tmp/wp11rev4/r4-09-failopen.mjs
  # admission without any run.recovered verdict = {"allowed":true,...}
  # resumeWork = {"ok":true,"attempts":[{...number 2}]} | run status = running
  ```
- 证据：`packages/core/src/recovery.ts:287-295`（无 verdict 即 allowed）、`packages/core/src/findings.ts:1694-1700`；`RunRecoveryService.apply`（`recovery.ts:866,922-942`）对 `park_recovery_required` 必写 `newAttemptAllowed:false`，故**当前产品路径不可达**（状态唯一写入者总是写 verdict）。
- 修复建议：把该不变量显式化（`resumeTx` 对 `recovery_required` 且无 verdict 的 Run 仍判 unresolved，或加断言/测试保证「状态为 `recovery_required` ⇒ 存在 withholding verdict」）。第 3 轮曾建议以 admission 为唯一权威，故此条按防御纵深/潜在 fail-open 记 P3，不单独阻断。

## 6. 未验证项

1. **WP11R2-06（结果正文不落 `stage_result`）**：维持已登记残余，本轮未复核。
2. **`recovery_required` 的完整产品链（用户动作 → 决定 → 新 Attempt → spawn）**：因 WP11R4-02 无对应 RPC，无法在产品面验证；WP11R4-01 又使已实现的库级链在 supervisor 处失败，故该链端到端不可用。
3. **daemon 级 `stop()` 的极端时序**：仅库级/真子进程级复核（`r4-06` 565ms 干净升级），未在慢宿主/高并发下压测。
4. **浏览器类 AC（AC-002/052/071/073/076）与多模型 AC-043**：e2e/live 自报 UNVERIFIED，未复核。
5. **Provider Secret 的持久化/注册路径**（Keychain/0600）：仍是计划登记缺口，不属于本增量。
6. **capability 端点重启**：以 `AttemptCapabilityStore` 纯内存实现（`capabilities.ts:58-60`）+ 既有 11 个 gateway-http 单测论断，未再单起真实回环端点复演。

## 7. 独立复算的命令输出

### 7.1 WP11R4-01（P1）三路径一致失败

```text
$ node /tmp/wp11rev4/r4-11-normal-resume.mjs      # 普通 pause → resume
pauseWork = {"ok":true}
after pause = {"work":"paused","run":"paused","attempts":["stopped"]}
resumeWork = {"ok":true,"attempts":[{"runId":"…aa","attemptId":"…","number":2,"epoch":1}]}
after resume = {"work":"running","run":"running","attempts":[{"n":1,"status":"stopped","runnerId":"pid:424242"},{"n":2,"status":"starting","runnerId":null}]}
   [supervisor] supervisor: cannot start …: Run … cannot start from running
tick = {"claimed":[],"parked":[],"live":0}
spawned = 0
FINAL = {"work":"running","run":"failed","attempts":[{"n":1,"status":"stopped","runnerId":"pid:424242"},{"n":2,"status":"starting","runnerId":null}]}

$ node /tmp/wp11rev4/r4-02-reachable.mjs          # interrupted（确认进程已死）
admission = {"allowed":true,…,"requiresRecoveryDecision":false}
resumeWork = {"ok":true,"attempts":[{"…","number":2,"epoch":1}]}
   [supervisor] supervisor: cannot start …: Run … cannot start from running
tick.claimed = [] | children spawned = 0
run status after tick = "failed"
attempts after tick = [{"number":1,"status":"running","runnerId":"pid:424242"},{"number":2,"status":"starting","runnerId":null}]

$ node /tmp/wp11rev4/r4-01-product-path.mjs       # recovery_required + Run-scoped accepted 决定
canTransitionRun(paused, recovery_required) = false
(a) resumeWork = {"ok":false,"code":"RECOVERY_REQUIRED",…}          ← 无决定仍拒绝
(b) resumeWork = {"ok":false,"code":"RECOVERY_REQUIRED",…}          ← 兄弟 Run 决定不解除
(c) resumeWork = {"ok":true,"attempts":[{…,"number":2,"epoch":1}]}  ← 本 Run 决定放行
    run status = "running" | attempts = [{1,stopped},{2,starting,runnerId null}]
   [supervisor] supervisor: cannot start …: Run … cannot start from running
tick.claimed = [] | children spawned = 0
run status (after tick) = "failed"
```

### 7.2 WP11R3-02（CLI operationId）

```text
$ AGENTDEV_HOME=/tmp/wp11rev4/cli-home AGENTDEV_DAEMON_ENTRY=/tmp/wp11rev4/does-not-exist.mjs \
  node apps/cli/dist/cli.js start --root <repo>       # exit=1，stderr
{"ok":false,"operationId":"8941b5bb-df5f-4325-9e90-d98e5f25ddbf","error":{"code":"START_FAILED",…}}
# grep -c operationId → 1

$ AGENTDEV_HOME=/tmp/wp11rev4/cli-home AGENTDEV_DAEMON_ENTRY=/tmp/wp11rev4/hang-entry.mjs \
  node apps/cli/dist/cli.js start --root <repo>       # exit=1，stderr
{"ok":false,"operationId":"231d7716-eb8c-4993-abeb-b12dae54b400","error":{"code":"START_TIMEOUT",…}}
# grep -c operationId → 1
```

### 7.3 WP11R3-03/04/05 与认领攻击

```text
$ node /tmp/wp11rev4/r4-03-attacks.mjs
=== A: unattended `starting` Attempt on a RUNNING Run ===
   [supervisor] cannot start …: Run … cannot start from running
   tick.claimed = [] | spawned = 0 | run.status = "failed" | attempts = [{1,starting,runnerId null}]
=== B: Attempt with runnerId is not re-adopted ===      tick.claimed=[] | spawned=0 | run.status="running"
=== C: a CANCELLED Run is not adopted ===               run cancelled → tick.claimed=[] | spawned=0 | still cancelled
=== D: resumeParkedRun re-inspects the REAL process === admission.allowed=true（持久 verdict）
   resumeParkedRun = {"ok":false,"code":"RECOVERY_REQUIRED","message":"…旧执行状态为 true；确认终止后才能续跑"}
   spawned = 0 | attempts = 1
=== E: concurrency ceiling ===  resume#1 {"ok":true,"live":1} | resume#2 {"ok":true,"live":2}
   resume#3 {"ok":false,"code":"BUSY",…,"live":2}
=== F: targetRef ===  recordResumeDecision.ok=true
   decision.targetRef = {"id":"…aa","version":1,"hash":"7443f6…2f8d"} | run.version=1 | id===runId=true
=== G: queued Run still claimed ===  tick.claimed=["…"] | spawned=1 | run.status="running"

$ node /tmp/wp11rev4/r4-04b-debug.mjs
inspection = {"runId":"…aa","status":"recovery_required","runnerId":"pid:77777","heartbeatAt":"1970-01-01T00:16:35.000Z","processAlive":false}
canonical  = {"heartbeatAt":"1970-01-01T00:16:35.000Z","runId":"…aa","runnerId":"pid:77777","status":"recovery_required"}
sha        = a1395326a665b30e3c50c4662ed0f605caf8568161071ca45f33d79bc0588d47
decision targetRef = {"id":"…aa","version":1,"hash":"a1395326…8d47"}      ← 完全一致
```

### 7.4 WP11R4-02 可达性

```text
$ node /tmp/wp11rev4/r4-07-reachability.mjs
recoverRun = {"from":"running","to":"recovery_required","requiresRecoveryDecision":true,"newAttemptAllowed":false}
admission = {"allowed":false} | work status = "running"
pauseWork  = {"ok":false,"code":"RECOVERY_REQUIRED","recoveryRunIds":["…aa"]}
resumeWork = {"ok":false,"code":"INVALID_STATE","message":"Work … is running, not paused"}
cancelWork = {"ok":true,"status":"blocked","recoveryRequired":true,"recoveryDecisionId":"…"}
work-scoped decision = {"kind":"recovery","state":"pending","targetRef":{"id":"<workId>","version":2,…},"choices":["resume","accept_cancel","abandon"]}
after resolving the product decision = {"state":"accepted","choice":"resume"}
admission (still?) = {"allowed":false,"resolvedBy":null} | targetRef.id === runId = false
run status = "cancelled" | work status = "blocked"

$ grep -rn "recordResumeDecision\|resumeParkedRun" apps packages scripts --include=*.ts --include=*.mjs | grep -v /dist/
packages/core/test/supervisor.test.ts:487,503,506,513,514
packages/core/src/supervisor.ts:344,347,350,351,362,365
packages/core/src/recovery.ts:379
```

### 7.5 WP11R4-04 fail-open（无 verdict）

```text
$ node /tmp/wp11rev4/r4-09-failopen.mjs
admission without any run.recovered verdict = {"allowed":true,"verdictEventId":null,…}
resumeWork = {"ok":true,"attempts":[{"…","number":2,"epoch":1}]}
run status = "running" | attempts = [{1,lost,pid:424242},{2,starting,null}]
```

### 7.6 早期结论复核

```text
$ node /tmp/wp11rev4/r4-05-closures.mjs
parseRunnerPid(pid:123) = 123 | parseRunnerPid(pid:pending) = null
confirmed dead → {"to":"interrupted","processAlive":false,"admission":true}
pid:pending    → {"to":"interrupted","processAlive":null,"admission":false}
pid reuse live → {"to":"interrupted","processAlive":true,"admission":false}
cancelWork.ok = true | after cancel = {"run":"cancelled","attempt":"stopped"}
after the late result = {"run":"cancelled","attempt":"stopped"} | live attempts = 0
runnerChildEnv keys = ["AGENTDEV_RUNNER_ENTRY","HOME","LANG","PATH"]
has NODE_OPTIONS = false | has any AGENTDEV_PROVIDER_* = false

$ node /tmp/wp11rev4/r4-06-orphan.mjs
   supervisor: … ignored SIGTERM; sending SIGKILL
   supervisor: … runner exited (code null, signal SIGKILL) without a result
stop() elapsed ms = 565 | exit observed before stop() resolved = true | exit = {"signal":"SIGKILL"}
child alive right after stop() = false | run status = "interrupted" | attempt status = ["lost"]

$ node /tmp/wp11rev4/r4-10-falsify.mjs
real probe  = {"parked":"interrupted","assertWouldPass":true,"admission":true}
blind probe = {"parked":"recovery_required","assertWouldPass":false,"admission":false}

$ npx vitest run --project unit packages/core/test/gateway-http.test.ts
✓ 11 tests passed（valid→200、Attempt 停靠/epoch/终态拒绝；AttemptCapabilityStore 内存实现）
```

### 7.7 门禁与卫生

```text
$ pnpm typecheck → exit 0 ; pnpm lint → exit 0 ; pnpm build → exit 0
$ pnpm test:unit → Test Files 59 passed (59) / Tests 1154 passed (1154) ; exit 0
$ pnpm test:integration -- --maxWorkers=2 → Test Files 29 passed (29) / Tests 323 passed (323) ; exit 0
$ pnpm test:e2e → e2e: 21 checks — PASS 17 / FAIL 0 / UNVERIFIED 4 ; exit 0
$ pnpm docs:check → ok — 15 documents, 54 internal links, 94 acceptance cases, 9 requirements, 11 work packages ; exit 0
$ node apps/cli/dist/cli.js doctor → execution ready: yes ; exit 0
$ pnpm test:live → live: 5 passed / 0 failed / 2 unverified ; 11 call(s), HTTP 200×11, 0 failed ; exit 0
$ ps … | grep -E "child-stubborn|wp11rev4|hang-entry" → none（无残留探针进程）
$ lsof -nP -iTCP:4317/4318 -sTCP:LISTEN → free
$ grep -rl '<secret>' /tmp/wp11rev4/ 与仓库 → 0（凭证未落盘）
$ git checkout -- .agentdev/work/WP-10/{e2e,live}* → git status --porcelain (空，报告写入前)
```
