# WP-11（运行时与 Runner 执行器）独立 Review 报告（第 3 轮 · 增量）

- 角色：独立 Review（独立上下文；未读取任何开发聊天、transcript 或 session log；仅依据仓库文件、git 对象、第 1/2 轮报告与本轮自建实验）
- 工作包：WP-11 A1 + A2（第 2 轮修复轮复核，增量 `6b0228f..302b382`）
- 冻结点：commit `302b3826ca6f59d181a2ac863f9c4f064e729593`，tree `b40f4d2bd2f3036ad99dc8278e2a2f4a4e0d7fb9`
- 证据目录：`/tmp/wp11rev3/`（自建复现脚本、攻击脚本与原始输出日志）
- 唯一写入：`.agentdev/work/WP-11/review-round3.md`（`pnpm test:e2e`/`pnpm test:live` 改写的 `.agentdev/work/WP-10/{e2e,live}*` 已 `git checkout --` 还原；最终工作树干净）
- 环境：macOS，node v24.8.0，pnpm 12.3.4；Provider 凭证仅通过环境变量传给 `pnpm test:live`，未落盘、未回显（实测日志中该凭证出现次数 = 0）

## 1. 冻结与哈希

```text
$ git rev-parse HEAD
302b3826ca6f59d181a2ac863f9c4f064e729593
$ git rev-parse HEAD^{tree}
b40f4d2bd2f3036ad99dc8278e2a2f4a4e0d7fb9
$ git status --porcelain
(空)
$ git log --oneline -2
302b382 fix(core,daemon,cli): close the WP-11 review round-2 findings
6b0228f fix(core,daemon,cli): close the WP-11 review round-1 findings

$ git diff --stat 6b0228f..302b382
 .agentdev/work/WP-11/implementation.md |  16 ++
 .agentdev/work/WP-11/review-round2.md  | 380 ++++++++++++++++++++++++++++++++++++
 apps/cli/src/cli.ts                    |   1 +
 apps/daemon/src/runner-spawn.ts        |   3 +-
 packages/core/src/recovery.ts          |  68 ++++++
 packages/core/src/supervisor.ts        | 152 +++++++++++--
 packages/core/test/supervisor.test.ts  |  92 +++++++-
 scripts/e2e.mjs                        |  24 +--
 8 files changed, 703 insertions(+), 33 deletions(-)
```

增量逐行阅读：`supervisor.ts`（stop 升级链、`entry.exited`、`recordResumeDecision` 委托、`resumeParkedRun`、`finishFromResult` 终态前置、`queued()` 注释）、`recovery.ts`（新 `recordResumeDecision`）、`cli.ts`（仅 `START_TIMEOUT` 一处）、`runner-spawn.ts`（移除 `NODE_OPTIONS`）、`scripts/e2e.mjs`（AC-057 删宽松分支）、`supervisor.test.ts`（+92 行）与两份记录。冻结后首次记录工作树为空。

## 2. 结论

**FAIL（阻断独立 Test）。** 第 2 轮的 6 个可修条目中，4 个已用自建实验真实关闭（WP11R2-01/03/05/07），但 **2 个未关闭，且 `implementation.md` T10「本轮把 4 个 P2 … 全部关闭」的完成声明在本轮实测下不成立**：

1. **WP11R2-02 未关闭（P1，WP11R3-01）**：`recordResumeDecision()`/`resumeParkedRun()` 的守卫与状态迁移本身符合描述，但**产品内没有任何调用者**（全仓 grep 仅命中测试与 `dist`），`work.control resume` 的 `resumeWork` 仍对 `recovery_required` 硬拒绝——即使 Work 已 `paused` 且已存在针对该 Run 的 accepted `kind='recovery'` 决定行。Inbox 仍把该 Run 标为 `actionable: true` 却没有对应动作。也就是说「用户没有任何产品内动作能推进它」这一第 2 轮影响**原样保留**，属于未兑现的完成声明 + 产品回归面。
2. **WP11R2-04 未关闭（P2，WP11R3-02）**：T10 称「两条真实失败路径补上 `operationId`」，实际 diff 只改了 `START_TIMEOUT`；`START_FAILED` 仍输出无 `operationId` 的 JSON（`grep -c operationId` = 0），与 `reliability.md` §7 不符，且记录措辞不实。

严重度汇总：

| 严重度 | 数量 | 编号 |
|---|---|---|
| P0 | 0 | — |
| P1 | 1 | WP11R3-01 |
| P2 | 1 | WP11R3-02 |
| P3 | 3 | WP11R3-03、WP11R3-04、WP11R3-05 |

是否阻断独立 Test：**是**。WP11R3-01 使「`recovery_required` 有产品恢复路径」这一被声称为已关闭的行为不可用；WP11R3-02 表明记录对 CLI 修复的陈述与代码不符。两者都是可精确复现的完成声明问题，应有针对性地修复后重新走独立 Review（其余 4 个自建实验已证明增量主体行为正确、门禁与回归全绿，修复面很小）。

其余判定依据（全部为本人亲自复现，命令与原始输出见 §7）：

- WP11R2-01 在单元级、真实子进程级与真实 daemon 级都关闭：忽略 `attempt.shutdown`+SIGTERM 的 Runner 被 SIGKILL 且 `stop()` 在观察到 `exit` 之后才 resolve（`exit=true signal=SIGKILL`），未确认进程被逐条报告；`agentdev stop` 墙钟 13s、无孤儿、Run `interrupted`/Attempt `lost`，日志顺序为「runner exited → agentdevd: stopped」。
- WP11R2-03 关闭：产品取消（`FindingService.cancelWork`）后迟到结果不再改写 `stopped`；`starting` 的迟到结果只降到 `lost`。
- WP11R2-05 关闭：真实子进程只看到 10 个键，无 `NODE_OPTIONS`、无任何 `AGENTDEV_PROVIDER_*`，`--require` 注入未执行。
- WP11R2-07 关闭：代码为 `attempt.error → Attempt failed + Run 停靠`，与 T10 措辞一致。
- `scripts/e2e.mjs` 的 AC-057 断言确为严格（无宽松分支），并用「失明探针」对照证明其有鉴别力。
- 第 1 轮三个 P1 保持关闭（迟到结果不崩溃；`pid:` 探针语义含 `pid:pending`/pid 复用 fail-closed；capability 在停靠/epoch 不符/终态/端点重启后失效）。

## 3. 增量复核（6b0228f..302b382）

| 第 2 轮发现 | 本轮复现方式 | 观测结果 | 结论 |
|---|---|---|---|
| WP11R2-01 忽略 SIGTERM 的 Runner 留孤儿 | 真 spawn 端口 + 真子进程；真实 daemon + `agentdev stop` | 单元级：`stop()` 865ms，`SIGTERM,SIGKILL`，resolve 前已观察 `signal=SIGKILL` 且 `kill(pid,0)` 失败；daemon 级：墙钟 13s、`ORPHAN alive right after stop = no`、`run=interrupted attempt=lost`、无残留端口/进程 | **已关闭** |
| WP11R2-01 未确认进程应被报告 | 假端口（terminate 空操作、永不 exit） | `stop()` 2091ms 后 resolve，日志 `1 Runner process(es) did not confirm exit: <run>#424242`，run `recovery_required`、attempt `stopped` | **已关闭**（诚实报告，未谎称已停） |
| WP11R2-02 提供恢复路径 | `recordResumeDecision`/`resumeParkedRun` + `work.control` 的 `pauseWork`/`resumeWork` | 守卫本身正确（见下），但**无产品调用者**；`resumeWork` 在有 accepted 决定且 Work `paused` 时仍返回 `RECOVERY_REQUIRED` | **未关闭** → WP11R3-01 |
| WP11R2-03 迟到结果改写 `stopped` | 真子进程迟到结果 + 产品 `cancelWork`；`RunLifecycle.cancel` 对照 | `after cancel: run=cancelled attempt=stopped`；`after the late result: run=cancelled attempt=stopped`；对照路径 `starting → lost`（非 `completed`） | **已关闭** |
| WP11R2-04 `start` 两条失败路径带 `operationId` | 真 `apps/cli/dist/cli.js`：入口缺失、入口挂起不答 | `START_TIMEOUT` 带 `operationId`（1 处）；`START_FAILED` 仍为 `{"ok":false,"error":{...}}`，`grep -c operationId` = 0 | **部分关闭** → WP11R3-02 |
| WP11R2-04 e2e AC-057 断言严格性 | 读 `scripts/e2e.mjs:2445-2456` + 失明探针对照 | 文件中已无 `parked === 'recovery_required'` 分支；真探针→`interrupted`（断言 PASS），失明探针→`recovery_required`（断言会 FAIL），具备鉴别力 | **已关闭** |
| WP11R2-05 `NODE_OPTIONS` 透传 | 真 spawn 端口注入 `NODE_OPTIONS="--require inject.cjs"` + Provider 哨兵 | 子进程 10 键、无 `NODE_OPTIONS`/`AGENTDEV_PROVIDER_*`、`injection executed = false` | **已关闭** |
| WP11R2-06 结果正文无持久证据 | 未复核（保持已登记残余） | — | 维持残余 |
| WP11R2-07 `attempt.error` 记录措辞 | 脚本化端口 + 真 recovery | `attempt.error → attempt=failed | run=recovery_required`，与 T10 措辞一致 | **已关闭**（T9 第 94 行「一律按 lost」旧措辞仍在，属被 T10 更正的历史行，未单独计缺陷） |

### 3.1 WP11R2-02：守卫逐条成立，但「产品路径」不成立

自建脚本（`/tmp/wp11rev3/r2-02-resume-path.mjs`）逐条复核了被声称的行为，全部成立：

```text
### scenario A: unconfirmable process → guarded refusal, then accepted
parked status = recovery_required
resumeParkedRun (no decision)  → {"ok":false,"code":"RECOVERY_REQUIRED", …}
recordResumeDecision (alive)   → {"ok":false,"code":"RECOVERY_REQUIRED","message":"…旧执行（pid:20000）未确认终止…"}
recordResumeDecision (dead)    → ok=true decisionId=…
decision row = {"kind":"recovery","targetRef":{"id":"<runId>","version":1,"hash":"…"},
                "choices":["resume","abandon"],"state":"accepted","choice":"resume",
                "actor":"user","effectRefs":[]}
Run-scoped=true … targetRef.version=1 vs run.version=4
admission after the decision = allowed=true resolvedBy=<decisionId>
resumeParkedRun (decision)     → ok=true | attempts = 2 run=running

### scenario B: confirmed-dead process but an unknown effect
recordResumeDecision → {"ok":false,"code":"RECOVERY_REQUIRED","message":"…有 1 个工具操作结果未知…"}
resumeParkedRun      → {"ok":false,"code":"RECOVERY_REQUIRED", …}

### scenario C: is the decision reachable from the product surface?
pauseWork  → ok=false code=RECOVERY_REQUIRED recoveryRunIds=["<runId>"]
resumeWork → ok=false code=INVALID_STATE message=Work … is running, not paused

### scenario E: Work paused + accepted decision — does resumeWork use it?
recordResumeDecision → ok=true
Work forced to paused; resumeWork → ok=false code=RECOVERY_REQUIRED
  message=Run … needs a recovery decision before the Work resumes
admission now = allowed=true resolvedBy=<decisionId>

### scenario D: automatic claiming stays queued-only
supervisor.tick().claimed = []
```

结论：**守卫与自动认领符合声称（`queued`-only、已确认终止才写决定、未知副作用拒绝、决定 Run-scoped），但决定无法通过产品面写入或消费**：

- 全仓 `grep -rn "resumeParkedRun\|recordResumeDecision"`：仅 `packages/core/src/{supervisor,recovery}.ts`、`packages/core/test/supervisor.test.ts`、`packages/core/dist/*`；`apps/**` 与 `scripts/**` 无调用者（`ProjectExecution.supervisor` 只被 e2e/live 用于 `liveAttempts()`）。
- `packages/core/src/findings.ts`（`work.control resume` 的 `resumeWork`）未被本增量改动：`resumeTx:1694-1706` 把 `run.status === 'recovery_required'` 无条件计入 `unresolved`，因此**即使已存在覆盖该 Run 的 accepted 决定、admission 已 `allowed=true`，`resumeWork` 仍拒绝**（scenario E）。
- `pauseWork`（`findings.ts:1519-1546`）对 `recovery_required` 的 Run 直接进 `recoveryRunIds` 并整体拒绝，因此「pause→resume」这条间接路径对 `recovery_required` 也不可用。
- Inbox（`apps/daemon/src/protocol.ts:1378-1388`）把 `recovery_required` 的 Run 列为 `kind:'recovery'`、`actionable: true`，但它是即时构造的视图项、并非持久 Decision 行；`decision.resolve` 只更新**已存在的 pending 决定**（`protocol.ts:2346+`），对该 Run 会 `NOT_FOUND`。即：UI 告诉用户「可操作」，而没有 RPC 可操作。

记录对照：`implementation.md` T10 表头写「本轮把 4 个 P2 与 2 个可修 P3 全部关闭」，WP11R2-02 行只描述新增两个方法、未登记「尚未接线」。因此该完成声明不实。

### 3.2 WP11R2-04：e2e 严格性成立，CLI 只补了一半

- `scripts/e2e.mjs:2445-2456` 已是严格断言，且删除了 `else` 宽松分支：真探针下 SIGKILL 的 Runner 必然 `interrupted`+`allowed`；失明探针下同一场景变 `recovery_required`，断言会 FAIL（见 §7 的 `r2-04-falsify`），证明其断言具有鉴别力、非自证。
- `apps/cli/src/cli.ts` 的 `startDaemon`：`START_TIMEOUT`（`:259-269`）已加 `operationId`；`START_FAILED`（`:252-254`）仍是 `{ok:false, error:{code,message}}`。真命令复算：`START_FAILED` 行 `grep -c operationId` = 0，`START_TIMEOUT` 行 = 1。

### 3.3 第 1 轮 P1 保持关闭

- 迟到结果不崩溃：真子进程 + 产品取消后父进程继续运行（`r2-03`），迟到结果只记日志，Run/Attempt 不被改写。
- `pid:` 探针语义（`r1-probe-semantics`）：`parseRunnerPid('pid:123')=123`、`('pid:pending')=null`；确认已死（`pid:999999`）→`interrupted` + `allowed=true`；`pid:pending`→`recovery_required` + 拒绝；pid 复用（指向本进程的活体）→`recovery_required` + 拒绝（fail-closed）。
- capability 门禁（`r1-03-capability`，真 loopback 端点 + 真 `ModelGateway`）：合法 token 200；Attempt 停靠（`stopped`）后 401 且 token 从 store 移除；epoch 不符 401；Run 终态（cancelled）409 并撤销；端点重启（新 capability store）后旧 token 401。本增量未触碰 `capabilities.ts`/`gateway-http.ts`，回归套件亦全绿。

## 4. 门禁与回归复核

```text
$ pnpm typecheck                        → exit 0
$ pnpm lint                             → exit 0（All matched files use Prettier code style!）
$ pnpm docs:check                       → exit 0（15 documents, 54 internal links, 94 acceptance cases,
                                           9 requirements, 11 work packages）
$ pnpm build                            → exit 0
$ pnpm test:unit                        → 59 files / 1154 tests passed（与实现记录一致）
$ pnpm test:integration -- --maxWorkers=4 → 29 files / 323 tests passed
$ pnpm test:e2e                         → 21 checks — PASS 17 / FAIL 0 / UNVERIFIED 4，24 ACs，exit 0
$ node apps/cli/dist/cli.js doctor      → execution ready: yes，exit 0（4317/4318 free）
$ pnpm test:live（真实 Provider）        → 5 passed / 0 failed / 2 unverified；11 calls，HTTP 200×11，
                                           0 failed，exit 0
```

`pnpm test:e2e` 的 `runtime.executes-attempt [AC-057]` PASS，证据串为「真实 supervisor + 真实 apps/runner 子进程 + 回环模型完成 Attempt；SIGKILL 活跃 Runner 后 Run 停靠 `interrupted`、Attempt `lost`、新 Attempt `allowed=true`」。
`pnpm test:live` 的 `drill.runtime-attempt [AC-057]` PASS，证据串为「真实 apps/runner 子进程（runnerId `pid:95770`）经真实 Provider 完成、813 tokens 记账；SIGKILL 活跃 Runner 后 Run 停靠 `interrupted`、Attempt `lost`、新 Attempt `allowed=true`」。

## 5. 新发现清单

### WP11R3-01（P1）`recovery_required` 仍无产品恢复路径；T10 的「全部关闭」声明不成立

- 影响：任何被停靠为 `recovery_required` 的 Run（旧进程未确认终止、`pid:pending`、未知副作用）在产品内**仍无任何用户动作可推进**：`pauseWork`、`resumeWork` 均拒绝，Inbox 却标 `actionable: true`。新增的 `recordResumeDecision`/`resumeParkedRun` 只有测试会调用。
- 复现：
  ```bash
  node /tmp/wp11rev3/r2-02-resume-path.mjs
  # scenario A：守卫成立（alive 拒绝 / dead 接受 / admission allowed / resume → attempts 2）
  # scenario E：Work forced to paused + accepted decision →
  #   resumeWork → ok=false code=RECOVERY_REQUIRED
  #   message=Run … needs a recovery decision before the Work resumes
  #   admission now = allowed=true resolvedBy=<decisionId>   ← admission 已放行，产品路径仍拒绝
  grep -rn "resumeParkedRun\|recordResumeDecision" apps packages scripts --include=*.ts --include=*.mjs | grep -v dist
  #   → 仅 packages/core/src/{supervisor,recovery}.ts 与 packages/core/test/supervisor.test.ts
  ```
- 证据：`packages/core/src/findings.ts:1694-1706`（`resume_required` 无条件进 `unresolved`）、`:1519-1546`（`pauseWork` 无条件拒绝）、`apps/daemon/src/protocol.ts:1378-1388`（Inbox 标 actionable 但无落库决定）、`:2346+`（`decision.resolve` 只改已有 pending 行）；`implementation.md` T10 表头与其 WP11R2-02 行。
- 修复建议：在 `resumeTx` 把 `recovery_required` 的判定改为「无覆盖本 Run 的 accepted `kind='recovery'`/`choice='resume'` 决定才算 `unresolved`」（`newAttemptAdmission` 已是唯一权威，可直接用 `admission.allowed`），或在 `work.control resume` 增加显式 recovery 分支：先 `recordResumeDecision` 再 `resumeParkedRun`；同时把 T10 的措辞改为「API 已具备，产品接线待办」，或补齐接线后再声称关闭。

### WP11R3-02（P2）`START_FAILED` 仍无 `operationId`；T10 称「两条真实失败路径」已补

- 影响：`reliability.md` §7「失败退出非零并输出 error code 和 operationId」在 `start` 的入口缺失路径上仍不成立；失败无法与 operation/outbox 关联。记录对修复范围的陈述不实。
- 复现：
  ```bash
  AGENTDEV_HOME=/tmp/wp11rev3/cli-home \
  AGENTDEV_DAEMON_ENTRY=/tmp/wp11rev3/does-not-exist.mjs \
  node apps/cli/dist/cli.js start --root /Users/huyaohua/huyh/work/aigrouptool
  # {"ok":false,"error":{"code":"START_FAILED","message":"Error: … does not exist; …"}}   ← 无 operationId
  # grep -c operationId = 0
  # 对照 START_TIMEOUT（挂起入口）→ {"ok":false,"operationId":"e53dd23c-…","error":{…}}   ← 有
  ```
- 证据：`apps/cli/src/cli.ts:252-254`；增量 diff 只含 `START_TIMEOUT` 一处（§1）；`implementation.md` T10 的 WP11R2-04 行「两条真实失败路径补上 `operationId`」。
- 修复建议：`START_FAILED` 也走 `failure()` 或在 JSON 中补 `operationId: randomUUID()`；修正 T10 措辞。

### WP11R3-03（P3）`resumeParkedRun` 不复核真实进程状态：窗口内 pid 复用/探针翻转可开第二个写者

- 影响：`recordResumeDecision` 会重核进程状态，但 `resumeParkedRun` 只看持久 verdict（`interrupted` 直接 `allowed=true`）。若 park 之后旧执行身份重新变为存活（pid 复用，或一次瞬时 `ESRCH` 误判），resume 会在旧进程仍存活时开出第二个 Attempt。
- 复现：
  ```bash
  node /tmp/wp11rev3/r3-resume-toctou.mjs
  # parked → run=interrupted admission.allowed=true
  # the latest Attempt now points at a live process: pid:93667 (probe=true)
  # newAttemptAdmission still reads the old verdict → allowed=true (process state not consulted)
  # resumeParkedRun → ok=true | attempts=2 run=running
  ```
- 证据：`packages/core/src/supervisor.ts:365-398`（只查 `live` map + 持久 admission，不调用 `recovery.inspect`）。
- 修复建议：`resumeParkedRun` 在 `spawnRun` 前调用 `recovery.inspect(runId)`，`processAlive !== false` 时 fail-closed（与 `recordResumeDecision` 同一把尺）。

### WP11R3-04（P3）`resumeParkedRun` 绕过并发上限

- 影响：`claim()` 用 `capacityFor()` 强制 `projectConcurrentRunners`/`roleConcurrency`；`resumeParkedRun` 直接调用 `spawnRun`，不查容量。若按 WP11R3-01 的建议接入产品面，操作者可在容量已满时继续开启 Attempt。
- 复现：
  ```bash
  node /tmp/wp11rev3/r3-resume-capacity.mjs
  # concurrency limits = project 4 / role 2; this supervisor uses project=2 role=2
  # resume #1 → ok=true | live attempts now = 1
  # resume #2 → ok=true | live attempts now = 2
  # resume #3 → ok=true | live attempts now = 3      ← 超过 project=2
  ```
- 证据：`packages/core/src/supervisor.ts:365-398` vs `:515-528`（`capacityFor`）。
- 修复建议：resume 前复用 `capacityFor(run.role, chiefQueued)`，或把恢复请求排队交给 `claim()`。

### WP11R3-05（P3）恢复决定行的 `targetRef.version` 为硬编码 `1`，hash 为合成值

- 影响：`decision.targetRef` 语义上应指向「作出选择时」的目标版本（`data.md` §2 `Ref={id,version,hash}`、「目标过期为 expired」）。实测 `targetRef.version=1` 恒等于 1，而同仓其它 decision writer 使用真实 `work.version`/`requirement.recordVersion`；`hash=sha256('recovery:<runId>')` 也不是内容摘要。当前消费方（`newAttemptAdmission`）只读 `target_ref.id`，故不影响放行，但审计/过期语义不精确。
- 复现：见 `r2-02-resume-path.mjs` 输出的 `targetRef.version=1 vs run.version=4`；对照 `packages/core/src/findings.ts:2533-2546`、`packages/core/src/decisions.ts:532-535`。
- 修复建议：写入时取 `run.version` 与基于决定上下文的 `canonicalJson` 摘要。
- 说明：`kind='recovery'`、`state='accepted'`、`choice='resume'`、`actor='user'`、`effectRefs=[]`、Run-scoped（`targetRef.id=runId`）均符合 `data.md` §2 与 `decisionSchema`。

## 6. 未验证项

1. **WP11R2-06（结果正文不落 `stage_result`）**：本轮按第 2 轮结论维持「已登记残余」，未复核；`data.md` §2/`protocol.md` §6 把 `stage_result` 定义为 `stage.submit` 的产物，本切片 Runner 仍无该路径。
2. **`recordResumeDecision`/`resumeParkedRun` 的真实产品接线后的端到端行为**：由于当前无调用者（WP11R3-01），无法在产品面验证「用户点击→决定入库→新 Attempt」全链；scenario A/E 只验证了库级行为。
3. **daemon `stop()` 的极端时序**：单/双 stubborn Runner 实测 13–14s（CLI `waitForStop` 默认 15s）。若宿主更慢，daemon 可能越过 15s 被 CLI 升级为 `SIGKILL`；但 `terminate('SIGTERM')` 设置的 10s `killTimer`（`supervisor.ts:814-826`）已在 ~13s 对所有 straggler 发出 SIGKILL，因此实测未留孤儿。未在更高并发/更慢宿主上压测，登记为观察项而非缺陷。
4. **浏览器类 AC（AC-002/052/071/073/076）与多模型 AC-043**：e2e/live 自报 UNVERIFIED，未复核。
5. **Provider Secret 的持久化/注册路径**（Keychain/0600）：仍是计划登记缺口，不属于本增量。

## 7. 独立复算的命令输出

### 7.1 WP11R2-01（stop 升级 / 未确认报告 / 真实 daemon）

```text
$ node /tmp/wp11rev3/r2-01-core-stop.mjs
### stubborn child (ignores shutdown + SIGTERM)
   stop() took 865ms
   child pid 34918 alive after stop() resolved = false
   exit observed before stop() resolved = true (exit={"code":null,"signal":"SIGKILL"})
   run.status=interrupted attempt.status=lost runnerId=pid:34918
### cooperative child (answers shutdown)
   stop() took 130ms
   child pid 35959 alive after stop() resolved = false
   exit observed before stop() resolved = true (exit={"code":0,"signal":null})
   run.status=interrupted attempt.status=lost runnerId=pid:35959

$ node /tmp/wp11rev3/r2-01-unconfirmable.mjs
stop() resolved after 2091ms (never observed an exit)
signals sent = ["SIGTERM","SIGKILL"]
run.status=recovery_required attempt.status=stopped
unconfirmed report lines:
   supervisor: 1 Runner process(es) did not confirm exit: <run>#424242
mentions the pid = true

$ bash /tmp/wp11rev3/a-daemon-stop.sh
seed: runId=01a09e4e-f0c6-709b-a650-418aa04eb0bc
start exit=0 ; runner pid before stop: 67069
stop exit=0 ; stop wall seconds: 13
ORPHAN alive right after stop = no
{"run":{"status":"interrupted"},"attempt":{"status":"lost","runnerId":"pid:67069"}}
daemon log tail:
    … did not stop in time; terminating
    … ignored SIGTERM; sending SIGKILL
    … parked … as interrupted
    … runner exited (code null, signal SIGKILL) without a result
    agentdevd: stopped
ports 4317/4318 free ; no stubborn children left

$ bash /tmp/wp11rev3/a2-daemon-stop-multi.sh     # 2 个 stubborn Runner（role 上限 2）
stubborn children before stop: [84218 84220]
stop exit=0 ; stop wall seconds: 14
ORPHAN 84218 alive=no ; ORPHAN 84220 alive=no ; no stubborn children left
```

### 7.2 WP11R2-03（迟到结果）

```text
$ node /tmp/wp11rev3/r2-03-late-result.mjs     # 真子进程 + FindingService.cancelWork
cancelWork ok=true
after cancel:            run=cancelled attempt=stopped finishedAt=null
   [supervisor] supervisor: ignoring the late result of … (Run already ended)
after the late result:   run=cancelled attempt=stopped finishedAt=null
live attempts = 0

$ node /tmp/wp11rev3/r2-03b-direct-cancel.mjs  # 对照：RunLifecycle.cancel
after tick: run= running attempt= starting
after RunLifecycle.cancel: run= cancelled attempt= starting
after the late result:     run= cancelled attempt= lost
```

### 7.3 WP11R2-04（e2e 严格性鉴别力 / CLI operationId）

```text
$ node /tmp/wp11rev3/r2-04-falsify.mjs
### real probe (the e2e drill)
parked = interrupted | attempt = lost | admission.allowed = true requiresDecision = false
   -> the strict e2e assert (`parked === 'interrupted'`) would PASS here
### blind probe (always null)
parked = recovery_required | attempt = lost | admission.allowed = false requiresDecision = true
   -> the strict e2e assert (`parked === 'interrupted'`) would FAIL here

$ grep -n "parked === 'interrupted'" scripts/e2e.mjs
2449:        parked === 'interrupted',

$ AGENTDEV_DAEMON_ENTRY=/tmp/wp11rev3/does-not-exist.mjs node apps/cli/dist/cli.js start --root <repo>
{"ok":false,"error":{"code":"START_FAILED","message":"Error: /tmp/wp11rev3/does-not-exist.mjs does not exist; …"}}
# grep -c operationId = 0
$ AGENTDEV_DAEMON_ENTRY=/tmp/wp11rev3/hang-entry.mjs node apps/cli/dist/cli.js start --root <repo>
{"ok":false,"operationId":"e53dd23c-94ca-4b8f-a137-3fc04c9d8180","error":{"code":"START_TIMEOUT", …}}
# grep -c operationId = 1
```

### 7.4 WP11R2-05（子进程环境）

```text
$ node /tmp/wp11rev3/r2-05-env.mjs
runnerChildEnv keys = ["AGENTDEV_RUNNER_ENTRY","HOME","LANG","LOGNAME","PATH","SHELL","TERM","TMPDIR","USER"]
runnerChildEnv has NODE_OPTIONS = false
runnerChildEnv has any AGENTDEV_PROVIDER_* = false
--- the REAL child saw ---
count = 10 keys = ["AGENTDEV_RUNNER_ENTRY","HOME","LANG","LOGNAME","PATH","SHELL","TERM","TMPDIR","USER","__CF_USER_TEXT_ENCODING"]
interesting = {"AGENTDEV_RUNNER_ENTRY":"/tmp/wp11rev3/child-env.mjs"}
NODE_OPTIONS injection executed in the child = false
```

### 7.5 WP11R2-07 / 第 1 轮 P1 复核

```text
$ node /tmp/wp11rev3/r2-07-error.mjs
after attempt.error: attempt.status = failed | run.status = recovery_required
signals sent = ["SIGTERM"]

$ node /tmp/wp11rev3/r1-probe-semantics.mjs
parseRunnerPid('pid:123') = 123 ; parseRunnerPid('pid:pending') = null
confirmed-dead pid 999999 → parked interrupted | processAlive=false | allowed=true requiresDecision=false
pid:pending            → parked recovery_required | processAlive=null | allowed=false requiresDecision=true
pid reuse (live 93475) → parked recovery_required | processAlive=true  | allowed=false requiresDecision=true

$ node /tmp/wp11rev3/r1-03-capability.mjs
A  live Attempt, valid capability      → HTTP 200
B1 parked Attempt (stopped)            → HTTP 401 | token still in store = false
C  epoch mismatch (expected 6)         → HTTP 401
D  terminal Run (cancelled)            → HTTP 409
E  old token on a restarted endpoint   → HTTP 401
```

### 7.6 新暴露项

```text
$ node /tmp/wp11rev3/r3-resume-toctou.mjs
parked → run=interrupted admission.allowed=true
the latest Attempt now points at a live process: pid:93667 (probe=true)
newAttemptAdmission still reads the old verdict → allowed=true (process state not consulted)
resumeParkedRun → ok=true | attempts=2 run=running

$ node /tmp/wp11rev3/r3-resume-capacity.mjs
parked statuses = ["interrupted","interrupted","interrupted"]
concurrency limits = project 4 / role 2; this supervisor uses project=2 role=2
resume #1 → ok=true | live attempts now = 1
resume #2 → ok=true | live attempts now = 2
resume #3 → ok=true | live attempts now = 3
```

### 7.7 门禁与卫生

```text
$ pnpm test:unit            → Test Files 59 passed (59) / Tests 1154 passed (1154)
$ pnpm test:integration -- --maxWorkers=4 → Test Files 29 passed (29) / Tests 323 passed (323)
$ pnpm test:e2e             → e2e: 21 checks — PASS 17 / FAIL 0 / UNVERIFIED 4 ; exit 0
$ pnpm test:live            → live: 5 passed / 0 failed / 2 unverified ; 11 call(s), HTTP 200×11, 0 failed ; exit 0
$ node apps/cli/dist/cli.js doctor → ok … info port 4317 free ; info port 4318 free ; execution ready: yes ; exit 0
$ ps … | grep -E "node .*(child-stubborn|child-result|child-cooperative|hang-entry)"  → no probe children
$ lsof … :(4317|4318)        → free
$ grep -rl 'sk-7a2539' /tmp/wp11rev3/ → 0（凭证未出现在任何日志）
$ git status --porcelain     → (空，报告写入前)
```
