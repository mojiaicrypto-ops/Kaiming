# WP-11（运行时与 Runner 执行器）独立 Review 报告（第 5 轮 · 增量）

- 角色：独立 Review（独立上下文；未读取任何开发聊天、transcript 或 session log；仅依据仓库文件、git 对象与本轮自建实验）
- 工作包：WP-11 A1 + A2（第 5 轮修复轮复核，增量 `bf97473..a54ff17`）
- 冻结点：commit `a54ff171330e5b26593825e55f82ba94e8a12c6f`，tree `1ce9579ad00dffd123ab9aacd42a04932383ed2e`
- 证据目录：`/tmp/wp11rev5/`（自建复现脚本、原始输出日志、用于回退实验的 scratch 副本 `/tmp/wp11rev5/scratch/`）
- 唯一写入：`.agentdev/work/WP-11/review-round5.md`。`pnpm test:e2e`/`pnpm test:live` 改写的 `.agentdev/work/WP-10/{e2e,live}*` 已 `git checkout --` 还原；最终工作树干净（`git status --porcelain` 为空）
- 环境：macOS，node v24.8.0，pnpm 12.3.4；Provider 凭证仅通过环境变量传给 `pnpm test:live`，未落盘、未回显（该 Secret 在 `/tmp/wp11rev5/`、仓库及演练产出的 WP-10 记录中命中数均为 0）

## 1. 冻结与哈希

```text
$ git rev-parse HEAD
a54ff171330e5b26593825e55f82ba94e8a12c6f
$ git rev-parse HEAD^{tree}
1ce9579ad00dffd123ab9aacd42a04932383ed2e
$ git status --porcelain
(空)
$ git log --oneline -3
a54ff17 fix(core,daemon): adopt the resumed Attempt and give a parked Run a product action
bf97473 fix(core): give a parked Run a real product path and close the round-3 findings
302b382 fix(core,daemon,cli): close the WP-11 review round-2 findings

$ git diff --stat bf97473..a54ff17
 .agentdev/work/WP-11/implementation.md |  13 ++
 .agentdev/work/WP-11/review-round4.md  | 330 +++++++++++++++++++++++++++++++++++
 apps/daemon/src/main.ts                |   6 +
 apps/daemon/src/protocol.ts            |  82 ++++++++
 packages/core/src/supervisor.ts        |  28 ++-
 packages/core/test/supervisor.test.ts  |  25 +++
 6 files changed, 478 insertions(+), 6 deletions(-)
```

**口径更正（任务描述与本轮实际增量不符）**：增量**没有**改 `packages/core/test/findings.test.ts`，也没有任何用例改名（见 WP11R5-05）。任务描述所称「AC-020 test renamed」与 T12 表格所称「该用例改名」均不成立；实际新增的是 `supervisor.test.ts` 的采纳回归用例。

## 2. 结论

**PASS（不阻断独立 Test）。** 第 4 轮的 P1 已在本人亲自复现的四条产品路径上真实关闭：`resumeWork` 打开的「无进程 Attempt」会被真实 `RunnerSupervisor` 采纳并 spawn，Run 保持 `running`（不再 `failed`），Attempt 有且只有一个新增且记录 `pid:<n>`。第 4 轮 P2 的产品动作也已落地并按任务给定四种情形实测通过；P3 的检测缺口由新增采纳回归用例补上（已在 scratch 副本回退采纳逻辑后实测该用例 FAIL）；P3 残余披露与实际一致。本轮新发现 3 个 P2 / 2 个 P3，均**不是** P0/P1（无假完成声明成立、无 fail-open 可达、无凭证泄漏、无双写者/双结算）。

严重度汇总：

| 严重度 | 数量 | 编号 |
|---|---|---|
| P0 | 0 | — |
| P1 | 0 | — |
| P2 | 3 | WP11R5-01、WP11R5-02、WP11R5-03 |
| P3 | 2 | WP11R5-04、WP11R5-05 |

是否阻断独立 Test：**否**。第 4 轮阻断项（WP11R4-01）已关闭；本轮 P2 为「新落地动作的原子性/协议形状/失败分支可恢复性」缺陷，不改变 WP-11 的已验收行为（AC-020 的「暂停恢复后新 Attempt」、AC-057/AC-061 的停靠与准入闸门）在真实路径上成立。

第 4 轮发现的逐条判定：

| 第 4 轮发现 | 本轮判定 | 依据 |
|---|---|---|
| WP11R4-01（P1）采纳分支不 spawn 反把 Run 判 failed | **已关闭** | §3.1，A/B/C/C2 四路径 + F1/F2/F4/F5/F6 反证 |
| WP11R4-02（P2）`recovery_required` 无产品动作 | **已关闭（功能）**，但引入 WP11R5-01/02 | §3.2 |
| WP11R4-03（P3）AC-020 用例名不副实且不驱动执行器 | **部分关闭**：检测已补，改名声明不实 → WP11R5-05 | §3.3 |
| WP11R4-04（P3）`resumeTx` 纯证据依赖 | **维持登记，确认不可达** | §3.4 |

## 3. 增量复核（bf97473..a54ff17）

### 3.1 WP11R4-01（P1）：已关闭（四条路径全部复现）

`spawnRun` 现在先读最新 Attempt：`status==='starting' && runnerId===undefined` 时采纳它（`supervisor.ts:613-624`）；`claim()` 失败分支不再 `settle('failed')`，而是把悬空 Attempt 标 `failed` 并 `park()`（`:576-594`）。

`/tmp/wp11rev5/r5-01-paths.mjs` 用真 `ProjectStore` + 真 `FindingService`/`RunRecoveryService` + 注入 spawn 端口，四条路径一致通过：

```text
PATH A（普通 pauseWork → resumeWork → tick）：
  after pause  = {run:"paused", attempts:[{n:1,stopped,pid:424242}]}
  resumeWork   = {ok:true, attempts:[{number:2, epoch:1}]}
  after resume = {run:"running", attempts:[{n:1,stopped},{n:2,starting,runnerId:null}]}
  tick1 = {claimed:[RUN], parked:[], live:1} | spawned=1 | tick2 = {claimed:[],live:1} | spawned=1
  FINAL = {run:"running", attempts:[{n:1,stopped,pid:424242},{n:2,starting,pid:30000}]}

PATH B（已确认进程死亡的 parked interrupted，用真 RunRecoveryService.recoverRun 停靠）：
  recoverRun = {from:"running", to:"interrupted", action:"park_interrupted", processAlive:false}
  admission = true
  resumeParkedRun = {ok:true, attemptId:…} | spawned=1 | tick={claimed:[],live:1} | spawned=1
  FINAL = {run:"running", attempts:[{n:1,lost,pid:424242},{n:2,starting,pid:30000}]}

PATH C（recovery_required + Run-scoped accepted 决定）：
  recoverRun(旧执行存活) = {to:"recovery_required", requiresRecoveryDecision:true, newAttemptAllowed:false}
  recordResumeDecision(存活) = {ok:false, code:"RECOVERY_REQUIRED"} | 决定数=0
  recordResumeDecision(确认死亡、时钟前进) = {ok:true}
  decision row = {kind:"recovery", state:"accepted", choice:"resume", actor:"user",
                  targetRef:{id:RUN_ID, version:<park 时 run.version>, hash:<真实事实 sha256>}}
  targetRef.id===runId=true | targetRef.version===run.version=true | hash 复算一致=true
  admission=true | resumeParkedRun={ok:true} | spawned=1 | tick 不再 spawn（live 1）
  FINAL = {run:"running", attempts:[{n:1,running,pid:55555},{n:2,starting,pid:30000}]}

PATH C2（库级：paused Work + 被强制 recovery_required + Run-scoped 决定 → resumeWork → tick）：
  resumeWork = {ok:true, attempts:[{number:2}]}
  tick1 = {claimed:[RUN], live:1} | spawned=1 | tick2 spawned 仍为 1
  FINAL = {run:"running", 只有一个新增 Attempt, runnerId:"pid:30000"}
```

四条路径断言一致成立：**Run 终态 `running`（不是 `failed`）、只新增 1 个 Attempt、tick/动作后共 spawn 1 个 Runner、被 spawn 的 Attempt 记录 `pid:\d+`、无重复 Attempt**。

采纳规则反证（`/tmp/wp11rev5/r5-02-falsify.mjs`）：

| 反证 | 观测 | 结论 |
|---|---|---|
| F1 连续两次 tick | tick1 claimed=[RUN]，tick2 claimed=[]；spawned=1 | 无双 spawn |
| F2 Attempt 已有 `runnerId:'pid:pending'` | tick claimed=[]，spawned=0，Attempt 仍 1 | 不重复采纳已认领 Attempt |
| F4 产品 `cancelWork` 后 | Run=`cancelled`；tick claimed=[]，spawned=0 | 已取消不被采纳 |
| F5 `lifecycle.cancel` 后 | Run=`cancelled`；tick claimed=[]，spawned=0 | 同上 |
| F6 parked + 无主 Attempt 走 `resumeParkedRun` | `RECOVERY_REQUIRED`（inspect 得 processAlive=null），spawned=0 | 停靠 Run 不会被误续跑 |
| F3 `queued` Run + 无主 `starting` Attempt | 被采纳 spawn 1，但 **Run 停在 `queued`**，`attempt.ready` 后 Attempt→running 而 Run 仍 `queued` | 见 WP11R5-04（当前产品不可达） |
| F7 采纳时存在 `newAttemptAllowed:false` verdict | **仍 spawn**（admission=false 却 spawn 1） | 采纳分支不查准入 → WP11R5-04（当前产品不可达） |

### 3.2 WP11R4-02（P2）：产品动作已落地并按四种情形实测

`apps/daemon/src/protocol.ts:1673-1723` 在 `work.control resume` 中新增：对本 Work 的 `interrupted`/`recovery_required` Run 先按持久准入判断，未放行则 `runRecovery.recordResumeDecision`（内部重核真实进程），Work 非 `paused` 时直接 `resumeParkedRun` 并返回 `resumedRunIds`，`paused` 时继续走 `resumeWork`。`apps/daemon/src/main.ts:288-291` 在执行栈建立后 `attachRunRecovery`。真 `WorkbenchProtocol` + 真 supervisor（`/tmp/wp11rev5/r5-03-protocol.mjs`）：

```text
P1 旧 Runner 存活 → work.control resume
   threw=true code=RECOVERY_REQUIRED；after={run:recovery_required, work:running, attempts:1, decisions:0, controlEvents:0}；spawned=0
   → 拒绝且未写入任何状态（与第 4 轮要求一致）

P2 确认死亡 → work.control resume
   result={status:"applied", operationId, workId, version:1,
           resumedRunIds:[RUN]}                ← 见 WP11R5-02：形状/事件与文档不符
   after={run:running, work:running, attempts:2, decisions:1}；spawned=1；tick 不再 spawn
   decision row = {kind:recovery, state:accepted, choice:resume, actor:user,
                   targetRef:{id:RUN_ID, version:<park 时 run.version>, hash:<真实事实>}}
   targetRef.id===runId / version===run.version / hash 复算一致 均为 true

P3 interrupted（准入已放行）→ 不写决定，returns resumedRunIds=[RUN]；Run→running、Attempt 2、spawned=1

P4 paused Work + parked Run → result.status="accepted" + attempts=[{number:2}]；
   走 resumeWork 打开无主 Attempt，tick 采纳并 spawn（spawned=1）

P5 paused Work + recovery_required + 进程已死 → 先记录 Run-scoped 决定再 resumeWork；
   decisions=1，Run→running，tick 采纳 spawn（spawned=1）

P6 未挂载 runRecovery 端口 → INVALID_STATE（"Work … is running, not paused"），无静默成功

P7 同一命令重放（Run 已 running）→ INVALID_STATE，spawned 仍为 1（无双 spawn）
```

对照 `data.md` §2：`decision` 行的 `kind=recovery`、`targetRef:Ref{id,version,hash}` 全部为真实事实（`targetRef.id===runId`、`version===park 时 run.version`、`hash===sha256(canonicalJson({runId,status,runnerId,heartbeatAt}))`）、`state=accepted`、`choice=resume`、`actor=user`；`sourceMessageId` 未写（schema 中为可省略字段）。Inbox 的 `recovery` 行现在确实有产品动作可对应。

但该动作的实现引入两个新问题：**WP11R5-01**（循环内部分写入/部分续跑后整体报错）与 **WP11R5-02**（返回形状与事件偏离 `protocol.md` §3/§4）。

### 3.3 WP11R4-03（P3）：检测已补，但「改名」声明不实

- 增量**未改** `findings.test.ts`；`git blame` 显示第 1331 行用例名 `refuses to resume while a Run still needs recovery (AC-020)` 由 `b6e72678`（更早提交）引入，本轮无 rename。
- 该用例仍以「refuses」为名，却在结尾断言 `afterDecision.ok===true` 且 Run 回到 `running`；名实仍不完全相符（且它仍不检查 Attempt、不驱动 supervisor）。
- 但新增的 `supervisor.test.ts` 用例 `adopts an Attempt that resumeWork opened instead of failing the Run`（`:493-515`）确实覆盖了本轮 P1：在 `/tmp/wp11rev5/scratch/`（仓库副本）把 `spawnRun` 的采纳逻辑回退为无条件 `beginAttempt` 后，该用例 FAIL：

```text
FAIL |unit| … > adopts an Attempt that resumeWork opened instead of failing the Run
AssertionError: expected [] to deeply equal [ Array(1) ]
  ❯ packages/core/test/supervisor.test.ts:508:26   expect(tick.claimed).toEqual([runId])
  → 1 failed | 15 passed (16)
```

原仓库不改动时同一文件 16 passed。故 **WP11R4-03 的实质（套件应能抓住第 4 轮 P1）已关闭**；改名声明不实另记 WP11R5-05。

### 3.4 WP11R4-04（P3）：残余披露与事实一致，确认当前不可达

`run.recovered` 事件全仓库唯一写入点是 `packages/core/src/recovery.ts:923`（`apply`），且 `apply` 在同一事务内把 Run 置为 `interrupted`/`recovery_required`（`:891`）；`recovery_required` 状态也仅由该处写入。因此「处于 `recovery_required` 却无 withholding verdict」的组合无法由产品路径产生。`r4-09-failopen.mjs` 复现的库级 fail-open（无 verdict 时 admission allowed、`resumeWork` 开新 Attempt）因此只作纵深防御残余登记，T12 的披露成立。

## 4. 门禁与回归复核

```text
$ pnpm typecheck                        → exit 0
$ pnpm lint                             → exit 0（All matched files use Prettier code style!）
$ pnpm test:unit                        → 59 files / 1155 tests passed，exit 0
$ pnpm test:integration -- --maxWorkers=2 → 29 files / 323 tests passed，exit 0
$ pnpm test:e2e                         → 21 checks — PASS 17 / FAIL 0 / UNVERIFIED 4，exit 0
$ pnpm docs:check                       → ok — 15 documents, 54 internal links, 94 acceptance cases, 9 requirements, 11 work packages，exit 0
$ pnpm build                            → exit 0
$ node apps/cli/dist/cli.js doctor      → execution ready: yes，exit 0
$ pnpm test:live（真实 DeepSeek Provider）→ 5 passed / 0 failed / 2 unverified；11 calls，HTTP 200×11，0 failed，exit 0
```

早期结论快速复核（对 HEAD 重建后的 dist 重跑第 4 轮脚本）：

```text
r4-05-closures：
  parseRunnerPid(pid:123)=123 / ('pid:pending')=null
  确认死亡 → interrupted，admission=true；pid:pending → interrupted，admission=false；pid 复用存活 → interrupted，admission=false
  cancelWork → run=cancelled/attempt=stopped；迟到结果后不变；live attempts=0
  runnerChildEnv keys=[AGENTDEV_RUNNER_ENTRY,HOME,LANG,PATH]；NODE_OPTIONS=false；AGENTDEV_PROVIDER_*=false
r4-06-orphan（真子进程忽略 shutdown+SIGTERM）：
  ignored SIGTERM; sending SIGKILL | stop() elapsed 553ms | exit observed before resolved=true
  exit={signal:"SIGKILL"} | child alive after stop()=false | run=interrupted | attempt=["lost"]
r4-10-falsify：real probe→interrupted/assertWouldPass=true；blind probe(null)→recovery_required/assertWouldPass=false
gateway-http.test.ts：11 passed（capability 有效→200、Attempt 停靠/epoch/终态拒绝）
e2e AC-057：断言 `parked === 'interrupted'` 且 admission.allowed && !requiresRecoveryDecision，为严格鉴别式（非 interrupted||recovery_required 的宽松式）
```

## 5. 新发现清单

### WP11R5-01（P2）新增的 `work.control resume` 非原子：报错的同时已部分写入 / 部分续跑

- 影响：`protocol.ts:1685-1722` 用两个循环处理同一 Work 的多个 parked Run——第一个循环逐个 `recordResumeDecision`，第二个循环逐个 `resumeParkedRun`；任一 Run 失败即抛错，但此前 Run 的决定已入库、甚至已被 spawn。调用方收到 `RECOVERY_REQUIRED`/`BUSY` 会认为「未生效」，实际状态已改变。
- 复现：
  ```bash
  node /tmp/wp11rev5/r5-04-exposure.mjs
  # X2（两个 parked Run，项目并发上限 1）：
  #   work.control resume = threw=true code=BUSY
  #   after = {A:"running", B:"recovery_required", attemptsA:2, attemptsB:1, decisions:2, spawned:1}
  # X2b（A 已可续、兄弟 B 仍不可确认）：
  #   work.control resume = threw=true code=RECOVERY_REQUIRED（B 的旧进程未确认终止）
  #   after = {A:"recovery_required", B:"recovery_required", attemptsA:1, decisions:1, spawned:0}
  #   → 命令报错，但 A 的 accepted 决定已写入（decisions=1）
  ```
- 证据：`apps/daemon/src/protocol.ts:1686-1694`（决定循环）、`:1697-1716`（续跑循环与 throw）；`X2` 中 A 的 Run 已 `running` 且 spawn 1、B 未动，命令整体返回 BUSY。对比 `P1`（首个检查即失败）确实「nothing written」，说明同一入口在不同失败次序下语义不一致。
- 修复建议：先完成所有 Run 的准入/决定/容量**预检**再统一提交（或在单事务内执行）；任一 Run 不可续跑时，不写任何决定、不 spawn 任何 Runner，并在 `details` 中列出被拒 Run；至少保证「返回非 2xx/错误 ⇒ 零状态变更」。

### WP11R5-02（P2）执行器续跑分支的返回形状与事件偏离 `protocol.md`

- 影响：`work.control` 在 `protocol.md` §4 被定义为 `accepted；work.control_changed`；§3 规定长操作 `{status:accepted,operationId,workId?,runId?,version}`、同步修改 `{status:applied,entityId,version}`。新分支返回 `{status:"applied", operationId, workId, version, resumedRunIds}`：既不是 `accepted`（非 paused/非长操作），也不满足 `applied` 的 `entityId` 形状；且**不追加 `work.control_changed`**，订阅方无法按文档观察到该次 resume。同一命令的另一分支（`resumeWork`）仍返回 `accepted` 并写事件，行为分裂。
- 复现：`node /tmp/wp11rev5/r5-03-protocol.mjs`，P2/P3：
  ```text
  P2 result = {"status":"applied","operationId":…,"workId":…,"version":1,"resumedRunIds":[…]}；controlEvents=0
  P4/P5（paused 路径）result = {"status":"accepted",…,"attempts":[…]}
  ```
- 证据：`apps/daemon/src/protocol.ts:1713-1721`（`status:'applied'` + `resumedRunIds`，无事件、无 `entityId`）；`docs/architecture/protocol.md:60`（`work.pause/resume/cancel* → accepted；work.control_changed`）、`:9`（两种结果形状）；`apps/daemon/src/protocol.ts:1724-1744`（另一分支 `accepted` 且 `resumeWork` 会写 `work.control_changed`）。
- 修复建议：统一为文档形状之一（建议 `accepted` + `operationId` + `resumedRunIds`），并在续跑成功后追加 `work.control_changed`（`data` 带 `openedRunIds`/`resumedRunIds`）；若要保留 `applied`，则补 `entityId` 并同步更新 `protocol.md`。

### WP11R5-03（P2）spawn/prepare 失败后的 park 分支制造「不可恢复的死角」，T12 的「保留可重试路径」不成立

- 影响：`claim()` 失败分支把悬空 Attempt 标 `failed` 并 `park()`（→ `recovery_required` + `newAttemptAllowed:false`）。但该 Attempt 要么没有 `runnerId`（采纳路径），要么是 `pid:pending`（`beginAttempt` 路径），`RunRecoveryService.inspect` 对二者都得 `processAlive=null`，`recordResumeDecision` 因 `processAlive !== false` **永久拒绝**；`resumeParkedRun` 同样拒绝；`pauseWork` 因存在 `recovery_required` Run 拒绝；`resumeWork` 因 Work 非 `paused` 拒绝。结果：一个可重试的启动/准备失败（真实触发点：`createPrepareRun` 在 config snapshot 缺失时抛错、`mkdirSync`/`writeAttemptCatalog` 落盘失败、`spawn` ENOENT/EAGAIN）把 Work 卡在 `running`，只剩 `cancelWork` 一条出路。T12「把悬空 Attempt 标 failed 并停靠 Run，**保留可重试路径**」与代码注释「so an operator can retry」均未兑现。
- 复现：
  ```bash
  node /tmp/wp11rev5/r5-02-falsify.mjs
  # F8（resumeWork 打开无主 Attempt 后 prepare 抛错）：
  #   cannot start …: config snapshot missing (injected prepare failure) → parked … as recovery_required
  #   after = {run:"recovery_required", attempts:[{n:1,stopped},{n:2,failed,runnerId:null}]}
  #   recordResumeDecision        = {ok:false, RECOVERY_REQUIRED, "旧执行（未知进程）未确认终止"}
  #   recordResumeDecision(later) = {ok:false, RECOVERY_REQUIRED}
  #   resumeParkedRun             = {ok:false, RECOVERY_REQUIRED, "旧执行状态为 null"}
  #   pauseWork                   = {ok:false, RECOVERY_REQUIRED, recoveryRunIds:[RUN]}
  #   resumeWork                  = {ok:false, INVALID_STATE, "Work … is running, not paused"}
  #   FINAL = run recovery_required / work running / spawned 0
  # F9（注入 spawn 抛错，同样是采纳路径）→ 同上，Attempt n:1 failed runnerId null
  # F10（queued Run 的 beginAttempt 路径 prepare 抛错）：
  #   after = {run:"recovery_required", attempts:[{n:1,failed,runnerId:"pid:pending"}]}
  #   recordResumeDecision = {ok:false, RECOVERY_REQUIRED, "旧执行（pid:pending）未确认终止"}
  ```
- 证据：`packages/core/src/supervisor.ts:580-594`（标记 failed + park）、`:613-624`（采纳路径不写 runnerId，故失败后 `runnerId` 仍为空）；`packages/core/src/recovery.ts:373-381`（`processChecked`/`processAlive!==false` 即拒）、`:305-320`（`runnerId===null → processAlive=null`）；`apps/daemon/src/prepare-run.ts:55-59`（真实可抛点）；`.agentdev/work/WP-11/implementation.md` T12 表格第 1 行。
- 修复建议：park 前为「从未启动过进程」的失败 Attempt 落一个可解析的终止事实（例如直接写 `newAttemptAllowed:true` 的 `run.recovered`/或允许 `recordResumeDecision` 对 `runnerId==null && attempt.status==='failed'` 的 Run 放行），或新增产品级 `run.retry` 动作；同时把 T12 的措辞改为与实现一致，并补一条「prepare/spawn 失败 → 可被产品动作续跑」的回归用例。

### WP11R5-04（P3）采纳分支不校验/不推进 Run 状态（当前产品不可达，属纵深防御缺口）

- 影响一：采纳分支只 `prepare`+`spawn`，不推进 Run 状态；若被采纳 Attempt 属于非 `running` Run（如 `queued`），会出现「`queued` Run 下已有真实 Runner」的不一致（F3：`attempt.ready` 后 Attempt→running，Run 仍 `queued`）。
- 影响二：采纳分支绕过 `newAttemptAdmission`（F7：存在 `newAttemptAllowed:false` verdict 时仍 spawn），而 `beginAttempt` 是强制该闸门的。若未来出现「Run 回到可认领状态但 verdict 仍在」的写入者，即成 fail-open。
- 当前不可达：`queued`/`running` Run 的无主 Attempt 只由 `resumeWork`（`findings.ts:1728`，总是把 Run 置 `running`）产生；唯一写 `run.recovered` 的 `apply` 同时把 Run 停靠，使其脱离 `queued()` 的 `status IN ('queued','running')` 集合（§3.4 已证）。
- 复现：`node /tmp/wp11rev5/r5-02-falsify.mjs`（F3、F7）。
- 修复建议：采纳分支断言 `run.status==='running'`，并复用 `newAttemptAdmission` 校验（或要求「无主 starting Attempt ⇒ 该 Attempt 的创建者已校验准入」在类型/契约上显式化）。

### WP11R5-05（P3）T12 关于「AC-020 用例改名」的记录不实

- 影响：`implementation.md` T12 表格称 WP11R4-03 的处置是「该用例改名为『refuses to resume while a Run still needs recovery』」，但增量未触及 `findings.test.ts`，该名字早在 `b6e72678`（2026-09-12）即存在；实际新增/改动只有 `supervisor.test.ts`。记录与 git 事实不符，会误导后续轮次对「已处理项」的判断。
- 复现：
  ```bash
  git show --stat a54ff17 | grep findings.test.ts        # 无输出
  git blame -L 1331,1331 bf97473 -- packages/core/test/findings.test.ts
  #   b6e72678 (yahu 2026-09-12 16:35:09 +0700 1331)  it('refuses to resume while a Run still needs recovery (AC-020)'
  ```
- 证据：`git diff --stat bf97473..a54ff17`（无 `findings.test.ts`）；`.agentdev/work/WP-11/implementation.md` T12 表格「WP11R4-03」行；用例体 `findings.test.ts:1331-1408`（结尾仍断言 `afterDecision.ok===true`）。
- 修复建议：更正 T12 记录（改为「未改名；新增 `supervisor.test.ts` 采纳回归用例覆盖该 P1」），并考虑为该用例补上 Attempt 存在性与 supervisor 驱动断言（其检测目标现由另一用例承担）。

## 6. 未验证项

1. **WP11R2-06（结果正文不落 `stage_result`）**：维持已登记残余，本轮未复核。
2. **daemon 级 `stop()` 的极端时序**：仅库级/真子进程级复核（553ms 干净升级），未在慢宿主/高并发下压测。
3. **协议信封层（WS `/rpc`、命令账本幂等）对新分支的端到端行为**：本轮直接调用 `WorkbenchProtocol.controlWork` handler（私有方法在运行时可达）验证分支语义，未再起真实 WS 端点复演 `applied` 结果的账本/幂等重放；WP11R5-01 的「报错但已改状态」与账本重放的相互作用因此未验证。
4. **浏览器类 AC（AC-002/052/071/073/076）与多模型 AC-043**：e2e/live 自报 UNVERIFIED，未复核。
5. **Provider Secret 的持久化/注册路径**（Keychain/0600）：仍是计划登记缺口，不属于本增量。
6. **capability 端点重启**：以 `AttemptCapabilityStore` 纯内存实现 + 既有 11 个 gateway-http 单测论断，未再单起真实回环端点复演。
7. **多 Run 部分续跑的 UI/CLI 呈现**：无当前客户端消费 `work.control resume` 结果（`apps/web/src`、`apps/cli/src`、`packages/client/src` 均无 `work.control` 引用），故 WP11R5-02 只按协议文档判定，未做客户端联调。

## 7. 独立复算的命令输出

### 7.1 增量四路径与反证（WP11R4-01 关闭）

```text
$ node /tmp/wp11rev5/r5-01-paths.mjs         # 原始输出见 /tmp/wp11rev5/r5-01.log
PATH A：pauseWork.ok=true → resumeWork={ok:true,attempts:[{number:2,epoch:1}]}
        after resume={run:"running",attempts:[{n:1,stopped,pid:424242},{n:2,starting,runnerId:null}]}
        tick1={claimed:[RUN],parked:[],live:1} spawned=1；tick2={claimed:[],live:1} spawned=1
        FINAL={run:"running",attempts:[{n:1,stopped,pid:424242},{n:2,starting,pid:30000}]}
PATH B：recoverRun={from:"running",to:"interrupted",action:"park_interrupted",processAlive:false}
        admission=true；resumeParkedRun={ok:true} spawned=1；tick live=1 spawned 仍 1；FINAL run=running
PATH C：recoverRun→recovery_required(newAttemptAllowed:false)
        recordResumeDecision(存活)={ok:false,RECOVERY_REQUIRED} decisions=0
        recordResumeDecision(死亡)={ok:true}
        decision.targetRef={id:RUN_ID,version:2,hash:"6779…0b57"}；id/version/复算 hash 全一致
        admission=true；resumeParkedRun={ok:true} spawned=1；FINAL run=running
PATH C2：resumeWork={ok:true,attempts:[{number:2}]}；tick 采纳 spawn 1；tick2 不重复；FINAL run=running

$ node /tmp/wp11rev5/r5-02-falsify.mjs       # 原始输出见 /tmp/wp11rev5/r5-02.log
F1 两次 tick：spawned=1
F2 runnerId 已存在：claimed=[] spawned=0
F3 queued Run + 无主 Attempt：spawned=1，Run 仍 queued（ready 后仍 queued）
F4 cancelWork：run=cancelled，spawned=0
F5 lifecycle.cancel：run=cancelled，spawned=0
F6 parked + 无主 Attempt：resumeParkedRun={ok:false,RECOVERY_REQUIRED}，spawned=0
F7 verdict 存在（admission=false）：仍 spawned=1
F8 prepare 抛错 → recovery_required + attempts[{n:2,failed,runnerId:null}]；四种产品动作全部拒绝
F9 spawn 抛错 → 同上（n:1 failed runnerId null）
F10 queued + prepare 抛错 → recovery_required，n:1 failed runnerId "pid:pending"，决定仍被拒
```

### 7.2 产品动作（WP11R4-02 关闭）与协议偏离（WP11R5-01/02）

```text
$ node /tmp/wp11rev5/r5-03-protocol.mjs      # 原始输出见 /tmp/wp11rev5/r5-03.log
P1 存活：threw code=RECOVERY_REQUIRED；before/after 均 {run:recovery_required,attempts:1,decisions:0,controlEvents:0}，spawned=0
P2 死亡：result={status:"applied",…,resumedRunIds:[RUN]}；after {run:running,attempts:2,decisions:1,controlEvents:0}；
        targetRef.id===runId=true / version===run.version=true / hash 复算一致=true；spawned=1
P3 interrupted：result={status:"applied",…,resumedRunIds:[RUN]}；decisions=0；spawned=1
P4 paused+interrupted：result={status:"accepted",…,attempts:[{number:2}]}；tick 采纳 spawn 1
P5 paused+recovery_required：result={status:"accepted",…}；decisions=1；tick 采纳 spawn 1
P6 无端口：threw code=INVALID_STATE；run 仍 recovery_required
P7 重放：第二次 INVALID_STATE；spawned 仍 1

$ node /tmp/wp11rev5/r5-04-exposure.mjs      # 原始输出见 /tmp/wp11rev5/r5-04.log、r5-04b.log
X1 blocked Work（cancel 产物）：work.control resume → INVALID_STATE（未误续跑已取消 Work）
X2 两个 parked + 并发上限 1：threw code=BUSY，after={A:"running",B:"recovery_required",attemptsA:2,decisions:2,spawned:1}
X2b A 可续/B 不可确认：threw code=RECOVERY_REQUIRED，after={A:"recovery_required",decisions:1,spawned:0}
X3 parked 与兄弟 live Run 抢唯一槽位：threw code=BUSY，Run 仍 interrupted，spawned 仍 1（未部分变更）
```

### 7.3 采纳逻辑回退的鉴别力（scratch 副本）

```text
$ rsync -a --exclude .git --exclude node_modules --exclude .agentdev ./ /tmp/wp11rev5/scratch/
# 仅在该副本把 spawnRun 的 adopt 判断回退为 `const attempt = this.lifecycle.beginAttempt(run.id,{runnerId});`
$ cd /tmp/wp11rev5/scratch && node_modules/.bin/vitest run --project unit packages/core/test/supervisor.test.ts
 FAIL … > adopts an Attempt that resumeWork opened instead of failing the Run
 AssertionError: expected [] to deeply equal [ Array(1) ]  ❯ supervisor.test.ts:508:26
 Test Files 1 failed (1) | Tests 1 failed | 15 passed (16)

# 仓库原件不改动：
$ npx vitest run --project unit packages/core/test/supervisor.test.ts
 Test Files 1 passed (1) | Tests 16 passed (16)
```

### 7.4 门禁、早期结论与卫生

```text
$ pnpm typecheck → exit 0 ; pnpm lint → exit 0 ; pnpm build → exit 0
$ pnpm test:unit → Test Files 59 passed (59) / Tests 1155 passed (1155) ; exit 0
$ pnpm test:integration -- --maxWorkers=2 → Test Files 29 passed (29) / Tests 323 passed (323) ; exit 0
$ pnpm test:e2e → e2e: 21 checks — PASS 17 / FAIL 0 / UNVERIFIED 4 ; exit 0
$ pnpm docs:check → ok — 15 documents, 54 internal links, 94 acceptance cases, 9 requirements, 11 work packages ; exit 0
$ node apps/cli/dist/cli.js doctor → execution ready: yes ; exit 0
$ pnpm test:live → live: 5 passed / 0 failed / 2 unverified ; 11 call(s), HTTP 200×11, 0 failed ; exit 0
$ node /tmp/wp11rev5/r4-05-closures.mjs → pid 语义/迟到结果/环境白名单 全部复核通过（见 §4）
$ node /tmp/wp11rev5/r4-06-orphan.mjs   → SIGKILL 升级，exit observed before stop() resolved=true，run=interrupted/attempt=lost
$ node /tmp/wp11rev5/r4-10-falsify.mjs  → real→interrupted/true；blind→recovery_required/false
$ npx vitest run --project unit packages/core/test/gateway-http.test.ts → 11 passed
$ ps aux | grep -E "wp11rev5|child-stubborn|runner.mjs|agentdev" → 无残留进程
$ lsof -nP -iTCP:4317 -iTCP:4318 -sTCP:LISTEN → 空
$ ls -d /tmp/wp11rev5-* /tmp/wp11rev4-* → 空（脚本自清理 mkdtemp 目录）
$ grep -c '<secret>' /tmp/wp11rev5/live.log 与 .agentdev/work/WP-10/{live,e2e}* → 全部 0
$ git checkout -- .agentdev/work/WP-10/{e2e-results.json,e2e.md,live-results.json,live.md} → git status --porcelain (空)
```
