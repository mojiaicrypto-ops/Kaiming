# WP-02 独立 Review 报告（第四轮）

- 评审对象：工作包 WP-02「主管与独立Agent调度」
- 评审轮次：**第四轮**（逐条复核第三轮 M-01..M-05、D1..D5 与「1 万条事件窗口是否击穿 AC-047 二次升级与待办幂等」是否真修，并找新问题）
- 冻结点：git `411d04f`（`fix(core): WP-02 review round 3 findings (M-01..M-05, D1..D5)`），前置 `a8daa6d`
- HEAD 校验：`git rev-parse HEAD` = `411d04ff1056828d24eb4fa2bd7f19293627b52c`
- 工作树：复核开始时与写入本报告前 `git status --porcelain` 均无输出（`pnpm build` 只写被 `.gitignore` 忽略的 `dist/`）
- 评审角色：Review（独立上下文，未读取任何开发对话；只依据仓库文件、git 对象与实跑命令）
- 权威依据：`docs/rules/{workflow,agents}.md`、`docs/architecture/{data,protocol,reliability,context,ARCHITECTURE}.md`、`docs/delivery/{implementation,acceptance}.md`（WP-02 与 AC-043/044/045/046/047/082）、`.agentdev/work/WP-02/{plan,implementation,discovery}.md`
- 方法：回到代码逐行核对，另在 `/tmp/wp02-r4/` 自建 3 个实验脚本（`fixture.mjs`、`exp-a.mjs`、`exp-b.mjs`、`exp-c.mjs`）用 `pnpm build` 产出的 `packages/*/dist` 独立复现，共 24 组实验（含 12,000 条事件窗口）；**不修改产品代码、测试、`docs/**`、plan/implementation/discovery**。

---

## 0. 历史轮次结论摘要（保留）

**第一轮（冻结点 `785bdd6`）判 FAIL：1×P1、5×P2、7×P3（R-01..R-13）。**
P1＝`stage.submit` 无终态/epoch 守卫（终态 Run 仍接受交付并落 `stage_result` 行）；P2＝「父等待可接消息」证据空洞、`joinPolicy=none` 未实现、持久事件名偏离 `protocol.md` §7、越界写入 Plan、`run.ts` 快照引用改哈希与 `data.md` 冲突；P3＝R-07..R-13。第一轮命令全部通过（unit 202 / integration 124）。完整报告：`git show c4763d5:.agentdev/work/WP-02/review.md`。

**第二轮（冻结点 `c4763d5`）判 FAIL：0×P1、5×P2、6×P3（N-01..N-11）。**
确认 R-05/R-09/R-10/R-11/R-12 已修好；R-01/R-03/R-04/R-07/R-08/R-13 部分修复；R-02 证据无效。N-01＝`contract_violation` 终态不释放预算；N-02＝非 running 状态仍接受交付；N-03＝DC-37 RE-04 声称删除的两个自造 Join 事件名仍在发出；N-04/N-05＝「父等待可接消息」测试无区分力、终态父 Run 仍可接收新子 Run；N-06＝`onChildSettled` 重算重复写 `chief_action_required`；N-07＝被阻断 Gate 事件 data 结果契约不全；N-08＝二次 Schema 失败在 `paused` 抛 `VALIDATION_ERROR`；N-09＝代码引用不存在的 DC-38；N-10＝超预算返回 `CONSTRAINT_VIOLATION`；N-11＝`data.md` 与代码的快照引用类型冲突（产品确认未完成）。完整报告：`git show a8daa6d:.agentdev/work/WP-02/review.md`。

**第三轮（冻结点 `a8daa6d`）判 FAIL：1×P1、2×P2、2×P3（M-01..M-05）＋对抗性核验 D1..D5。**
N-01..N-10 全部经独立实跑确认修好（0 条残留）；M-01（P1）＝父 Run 级预算预留从不释放（顺序子 Run 累计触顶后永久 `BUDGET_EXCEEDED`）；M-02（P2）＝预算只预留/释放不核销、`tokensUsed` 无生产写入；M-03（P2）＝`Work blocked(provider)` 未落地而 T2 声称已实现；M-04（P3）＝阻断事件缺 `readLedgerSeq/Hash`；M-05（P3）＝`request_dispatch` 无幂等键。对抗性核验补出 D1..D5（仓库内可核实：D1 事件 `entityVersion` 用错实体版本、D2 终态请求者仍可塞待办、D3 派生读取只看第一页 1 万条窗口；D4 见下；**D5 无仓库定义**），并证伪「N-06/AC-047 已完全修好」。完整报告：`git show 411d04f:.agentdev/work/WP-02/review.md`。

---

## 1. 本轮结论

**FAIL（Review Failed）——第三轮 M-01..M-05 与 D1..D5 全部经独立实跑确认已修复或按记录正确降级为显式缺口（0 条残留“文档声称已修而代码不符”）；但本轮发现 3×P2、7×P3 新问题（Q-01..Q-10），其中 Q-01、Q-04 为本包必修。**

- **逐条复核结果（§3、§4）**：M-01（P1→P2）实测 5 个 10k 顺序子 Run 在 20k 父 Run 下全部可派发并结算，在场（含 `paused`）子 Run 仍占父额度、终态即释放；M-02 已打通「实测用量→`tokensUsed`」通道与 `usageMeasured` 记录（但默认路径仍按零释放，见 Q-03）；M-03 已改为显式缺口 DC-42（但源码注释仍与记录冲突，见 Q-07）；M-04 阻断事件 `stageResult` 10 个 `agents.md` §4 字段齐全（含 `readLedgerSeq/hash` 实测值 41 / `eeee…`）；M-05 `operationId` 同键同载荷可去重（但同键不同载荷被静默吞掉，见 Q-01）。D1 `entityVersion` = Chief Run 版本（实测 5 == 5，请求者版本 1）；D2 终态/暂停/等待权限/中断/恢复必需 8 种请求者全部 `INVALID_STATE`；D3 在 **12,000 条**事件之后 AC-047 二次升级仍为 `CONTRACT_VIOLATION`、Chief 待办仍幂等为 1 条、`operationId` 去重仍为 1 条，且旧 `readAfter(0,{limit:10_000})` 确实看不到目标事件（证明修复有区分力）；D4 全仓无 `stage.submitted/stage.rejected/run.contract_violation` 旧事件名残留。
- **新问题**：Q-01（P2）`request_dispatch` 的 `operationId` 幂等只按键去重、不校验载荷，同键不同载荷（甚至不同请求者 Run）会静默返回第一条待办游标，第二次请求**丢失**且不报 `IDEMPOTENCY_CONFLICT`，违背 `protocol.md` §1/§7；Q-04（P2）父 Chief Run 可在 `join=all` 子 Run 未终态时被 `settleRun` 直接置 `completed`，随后子 Run 失败会把 `chief_action_required` 写给已终态 Chief Run，AC-046 的 Gate 阻断无人可处理（与 N-05 的对称不变式缺失）。另有 Q-02/Q-03/Q-05..Q-10（P3）。
- **判定**：按 `workflow.md` §6「P0/P1 阻断；P2/P3 由 Review 说明是否影响验收」，本轮无 P1，但 **Q-01 影响 AC-045 与 `protocol.md` §1 的写命令幂等语义，Q-04 影响 AC-046 的 Join 收敛语义**，二者都在本包关联验收内且修复成本低，故**本包仍不具备进入独立 Test 的条件**；须先返工 Q-01、Q-04，并同步处理 Q-09/Q-10 两项记录缺陷。Q-03 若按 DC-41 作为承接 WP-10 的显式缺口获得确认，可不单独阻断（但默认「未测量即全额释放」与 `reliability.md` §3 直接冲突，建议本包内一句话决定）。
- 第三轮 N-11（`data.md` 的 `ID` 记法 vs 代码哈希）仍是 **Product Decision Pending**，未消解。

---

## 2. 验证命令与原始结果

环境：`export PATH="$HOME/.local/bin:$PATH"`，工作目录 `/Users/huyaohua/huyh/work/aigrouptool`，全部在 `411d04f`、干净工作树上执行。原始日志：`/tmp/wp02-r4-cmds.log`（六条命令顺序执行，含退出码）。`node v24.8.0`、`pnpm 12.3.4`。

| 命令 | 退出码 | 关键原始输出 |
|---|---|---|
| `pnpm typecheck` | 0 | `$ tsc -p tsconfig.json --pretty false`（无错误输出） |
| `pnpm lint` | 0 | `Checking formatting...` / `All matched files use Prettier code style!` |
| `pnpm test:unit` | 0 | `Test Files  17 passed (17)` / `Tests  213 passed (213)`，5.03s（与 T11 自述的 213 一致） |
| `pnpm test:integration` | 0 | `Test Files  10 passed (10)` / `Tests  124 passed (124)`（含真实 Docker 容器与 doctor 集成用例，未回退） |
| `pnpm docs:check` | 0 | `docs:check ok — 15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages` |
| `pnpm build` | 0 | `packages/contracts|domain|storage|core|pi-runtime|apps/cli|apps/runner build: Done`（7 个 workspace 全部 Done） |

`git log --oneline -3`：

```
411d04f fix(core): WP-02 review round 3 findings (M-01..M-05, D1..D5)
a8daa6d fix(core): WP-02 review round 2 findings (N-01..N-10)
c4763d5 fix(core): WP-02 independent review round 1 findings (RE-01..RE-13)
```

`git status --porcelain`：无输出（写入本报告前）。`pnpm test:e2e|acceptance|live` 仍按契约 `NOT_IMPLEMENTED`，未执行。

### 2.1 本轮独立实验日志

- `/tmp/wp02-r4/exp-a.log`（M-01..M-05、D1、D2、事件名回归）
- `/tmp/wp02-r4/exp-b.log`（12,000 条事件窗口：AC-047 二次升级、Chief 待办幂等、`operationId` 去重、稀疏 names 扫描与截断 fail-closed）
- `/tmp/wp02-r4/exp-c.log`（对抗性探针：父 Run 提前结算、`operationId` 载荷冲突、usage/costKnown、父额度上限、恢复残差、`releasedTokens` 语义）

---

## 3. M-01..M-05、D1..D5 逐条复核表

| 条目 | 三轮严重度 | 修复声明（411d04f） | 复核判定 | 独立实验证据（`/tmp/wp02-r4/`） |
|---|---|---|---|---|
| **M-01** 父 Run 级预留从不释放 | P1→P2 | `requireBudget` 只统计非终态子 Run（`orchestrator.ts:584-586`） | **已修复（verified）** | EXP-A1：20k 父 Run 下 5 个 10k 子 Run 顺序 `beginAttempt→submit→settle(completed)` 全部成功；Work 预留始终 = 40k（两个 Chief Run 自身）+ 在场子 Run。第三个**在场**子 Run 仍 `BUDGET_EXCEEDED: live children … hold 20000 of 20000`；把其中一个置 `paused`（非终态）仍被计；`cancelled` 后立即释放可再派发。第三轮「提高 Work 预算也无用」的场景消失。 |
| **M-02** 预算不核销 | P2 | `RunLifecycle.settle(runId,status,{tokensUsed,measured})` 释放整笔预留后 `tokensUsed += usage`，`run.ended` 记 `usageMeasured`（DC-41） | **部分修复（plumbing 成立，默认路径仍是按零释放 → Q-03）** | EXP-A2/C3/C6：`settle(...,{tokensUsed:12000,measured:true})` → `tokensUsed=12000`、`run.ended={tokensUsed:12000,usageMeasured:true,releasedTokens:40000}`；默认 `settleRun` → `{tokensUsed:0,usageMeasured:false,releasedTokens:…}` 且 `costKnown` 恒 `true`。`Orchestrator.settleRun` 仍只有 2 个形参、不转发 usage（`orchestrator.ts:564-568`），全仓无生产调用方提供用量。 |
| **M-03** `Work blocked(provider)` 未落地 | P2 | `implementation.md` T2 改为显式缺口 DC-42（承接 WP-05） | **已按记录处置（附残余 Q-07）** | EXP-A3：无模型角色派发 → `PROVIDER_UNAVAILABLE`；Work `status='running'`、`blockerIds=[]`、`work.control_changed`=0。`implementation.md:16` 已如实声明未实现；但 `config.ts:370`、`model-gateway.ts:87`、`orchestrator.ts:323` 注释仍称 Work 为 `blocked(provider)`（第三轮 M-03 原文即点名这两处注释）。 |
| **M-04** 阻断事件缺 `readLedgerSeq/Hash` | P3 | `ChildOutcome.stageResult` 与事件投影补齐（`join.ts:36-37,113-114,273-274`） | **已修复（verified）** | EXP-A4：子交付 `readLedgerSeq=41`、`readLedgerHash='e'*64` 后 required 失败 → 事件 `children[0].stageResult` 字段全为 `["artifactRefs","changedPaths","evidenceRefs","findingIds","readLedgerHash","readLedgerSeq","requestedActions","status","summary","unknowns"]`，缺失 §4 字段 `[]`，序列化值命中 41 与 `eeee…`。内存 `outcome.children[0].stageResult` 同步携带。 |
| **M-05** `request_dispatch` 无幂等键 | P3 | 支持 `operationId`，同键重放返回既有游标（`orchestrator.ts:460-474`） | **部分修复（同键同载荷已幂等；同键不同载荷被静默吞 → Q-01）** | EXP-A5：同 run 同键同载荷两次 → `chiefTodo` 均 `"5"`，`operationId='op-1'` 事件 1 条；换 `op-2` 正常新增（游标 6）。但同键 + 不同 goal、以及另一请求者 Run 复用同键，均返回 `"5"` 且不新增、不报错（`protocol.md` §1 要求同键不同载荷拒绝）。 |
| **D1** 事件 `entityVersion` 用请求者版本 | 对抗性 | 改用 Chief Run 版本（DC-44） | **已修复（verified）** | EXP-A6：两次派发子 Run 后 Chief `version=5`、请求者 Run `version=1`；`requestDispatch` 写出的 `chief_action_required` `entityId=chiefRunId`、`entityVersion=5`（= Chief 版本，不是 1）。 |
| **D2** 终态请求者仍可塞待办 | 对抗性 | 请求者须为 `queued/starting/running/waiting_children`（DC-44） | **已修复（verified）** | EXP-A7：`completed/failed/cancelled/timed_out/paused/waiting_permission/interrupted/recovery_required` 8 种请求者全部 `INVALID_STATE … cannot request more work`；`running` 与 `waiting_children` 允许。 |
| **D3** 派生读取只看第一页（1 万条窗口） | 对抗性 | 新增 `events.ts` 全量分页（DC-43） | **已修复（verified，专项见 §4）** | EXP-B1/B2/B3/B4：12,000 条噪音事件后 AC-047 二次升级、Chief 待办幂等、`operationId` 去重全部成立；旧 `readAfter(0,{limit:10_000})` 对目标事件均返回 `false`（证明修复有区分力）；稀疏 names 过滤跨页命中；事件被截断时抛 `ResyncRequiredError` 而非静默返回 0。 |
| **D4** 文档残留旧事件名 | 对抗性 | `implementation.md` T7 与 `discovery.md` 更正为 `stage.completed/stage.failed/run.ended` | **已修复（verified）** | 全仓 `grep -rn "stage\.submitted\|stage\.rejected\|run\.contract_violation\|run\.starting\|run\.running" docs packages apps .agentdev` 仅命中 `discovery.md:110` 自身对旧名的引用句；EXP-A8 全流程实际发出 `["chief_action_required","run.ended","run.queued","run.started","stage.completed","stage.failed"]`，全部属于 `protocol.md` §7。 |
| **D5** （无仓库定义） | 对抗性 | 提交信息未单独列出 | **无法独立核实（证据缺口 Q-10）** | 全库 grep 与 `git cat-file --batch-all-objects` 全 blob 扫描：只有 `implementation.md:77` 一句「对抗性核验又补出 D1/D2/D3/D4/D5」汇总句；`discovery.md` DC-43/DC-44 只定义 D1/D2/D3，提交信息只提 D1/D2/D4。D5 的原文/内容在仓库内不存在，第四轮无法逐条核对。 |

**小结：M-01/M-04 完全修复；D1/D2/D3/D4 完全修复；M-02/M-05 主体修复但各留一个 P2 缺口（Q-03/Q-01）；M-03 按「显式缺口 + DC」处置成立，残留注释不一致（Q-07）；D5 无仓库定义，无法核实（Q-10）。第三轮的「文档声称已修而代码不符」在本轮未复现（T11 的每条声明均与代码一致，唯一措辞需注意处见 Q-05）。**

---

## 4. 专项：「1 万条事件窗口」是否击穿 AC-047 二次升级与待办幂等

**结论：不再击穿。** 修复机制：`EventStore.readAfter` 的 `limit` 取的是**最旧**一页，旧的 `readAfter(0,{limit:10_000})` 在日志超过 1 万条后永远看不到新事件；`packages/core/src/events.ts:29-61` 的 `scanEvents`/`findEvent` 以 1,000 为页长推进到读完（`findEvent` 命中即停），`StageGate.rejections()`（`stage.ts:230-235`）与 `JoinCoordinator.pageChief()`（`join.ts:233-242`）已改用它，`requestDispatch` 的 `operationId` 去重同样走 `findEvent`。

原始输出（`/tmp/wp02-r4/exp-b.log`，节选）：

```
===== EXP-B1 12000 events before AC-047 second-strike =====
B1 appended noise: [12000,"events","958ms"]
B1 first submit: {"accepted":false,"code":"VALIDATION_ERROR",...,"correctionsRemaining":1}
B1 second submit: {"accepted":false,"code":"CONTRACT_VIOLATION","runStatus":"contract_violation","rejections":2}
B1 run status: contract_violation
B1 rejections for this attempt: 2
B1 target visible in old readAfter(0,{limit:10_000}): false
B1 log size: 12007
PASS B1 second non-compliant submission still escalates past 10k window

===== EXP-B2 12000 events before chief-todo idempotency =====
B2 join kinds: ["blocked","blocked","blocked"]
B2 required_child_failed todos: 1
B2 chiefTodo cursors: ["12006","12006","12006"]
B2 first real todo visible in old window: false
PASS B2 todo idempotent past 10k window

===== EXP-B3 12000 events before request_dispatch operationId dedup =====
B3 cursors: ["12005","12005"]
B3 op-x events: 1
B3 op-x visible in old window: false
PASS B3 operationId dedup past 10k window

===== EXP-B4 sparse named scan across pages + truncation fail-closed =====
B4 second submit: CONTRACT_VIOLATION
PASS B4 names-filtered scan paginates across non-matching pages
B4 rejections after truncation: ResyncRequiredError: RESYNC_REQUIRED: the requested cursor was truncated
```

判定：**AC-047 二次升级与 `chief_action_required` / `operationId` 幂等在 1 万条以上日志下均成立**；旧窗口读法对同一目标返回 `false`，说明被修复的缺陷是真实且该回归有区分力。截断场景 fail-closed（`ResyncRequiredError`），不会把「窗口缺失」误判为「无事件」。残余性能提示：`rejections()` 会把全部 `stage.failed` 事件载入内存后再过滤（`stage.ts:231-234`），`findEvent` 每次请求全量扫描，属 O(n) 但正确，未列为 Finding。

---

## 5. 新 Findings（Q-01..Q-10）

### Q-01 [P2] `request_dispatch` 的 `operationId` 幂等只按「Chief + 键」去重，不校验载荷：同键不同请求被静默丢弃

- 位置：`packages/core/src/orchestrator.ts:460-474`（`findEvent({names:['chief_action_required'], stopAt: entityId===chiefRunId && data.operationId===input.operationId})`，命中即返回既有游标）。
- **事实（实跑，EXP-A5 / EXP-C2）**：Run A 以 `operationId='dup'`、`goal='goal-A'` 请求成功（游标 7）；随后 Run B（不同请求者、`goal='goal-B-totally-different'`）复用同一键 → 返回 `{disposition:'chief_action_required', runId:B, chiefTodo:"7"}`，**不报错、不新增事件**；全日志 `operationId='dup'` 事件只有 1 条且 `requestedBy=A`、`goal='goal-A'`。调用方收到「已受理」外观，但 B 的请求永久丢失。
- **依据**：`protocol.md` §1「幂等键同载荷返回原结果；**同键不同载荷拒绝**」、§7 错误表含 `IDEMPOTENCY_CONFLICT`；`reliability.md` §1「Outbox以operationId至少一次投递；Supervisor先检查已存在的同operationId Runner/结果，避免重复创建」。当前实现把「不同载荷」当作重放。
- **影响**：AC-045 的 `request_dispatch` 在重试/复用键场景静默吞请求；与 M-05 要解决的「重复待办」相反方向的错误（漏待办），且无诊断。
- **建议**：幂等命中时比较规范化载荷（至少 `requestedBy/requestedRole/goal/purpose/sourceRefs` 摘要）；不同则抛 `IDEMPOTENCY_CONFLICT`（`errors.ts` 若缺该 code 需补）；把去重查询放入与 `append` 同一事务（见 §7 并发残余）。

### Q-02 [P3] 实测用量超过 Work 限额时结算必然失败：Run 永久停在 `running`、预留不释放、无终态事件

- 位置：`packages/core/src/run-lifecycle.ts:187-220`（`end` 先 `release` 再 `charge`；`charge` 直接 `tokensUsed + tokensUsed`）；`packages/contracts/src/entities/run.ts:185` 的 `used + reserved <= limit` 不变式。
- **事实（实跑，EXP-A2 第 3 段）**：Work `tokenLimit=100_000`、Run `budgetAllocation=40_000`；`lifecycle.settle(run,'completed',{tokensUsed:120_000,measured:true})` → `CONSTRAINT_VIOLATION: budget update failed its contract schema: tokens used + reserved exceeds the limit`；事务回滚后 Run 仍 `running`、`tokensReserved` 仍含该 Run 的 40k、`tokensUsed=0`，且没有任何终态事件——`settle`/`contractViolation` 两条终态路径都会这样卡住。
- **依据**：`reliability.md` §3「模型调用前预留…扣除实际usage并释放剩余；并行调用共享Work预算事务」；写入前应给出 `BUDGET_EXCEEDED`，终态必须可达。
- **影响**：当前无生产用量来源（DC-41），故为**潜伏**缺陷；一旦 WP-10 接线真实 usage，任何超预留的调用都会把 Run 永久挂住并占用 Work 预算（与 N-01 同类）。修复成本低：`charge` 前 `canAllocateBudget` 判定并返回 `BUDGET_EXCEEDED`，或把超限部分截断并记 `costKnown=false`。

### Q-03 [P2] M-02 残留：默认（未测量）结算仍按零 usage 全额释放，`costKnown` 从无生产写入且生产入口不转发用量

- 位置：`packages/core/src/run-lifecycle.ts:140`（默认 `{tokensUsed:0,measured:false}`）、`:191-192`（先释放整笔再计零）、`packages/core/src/orchestrator.ts:564-568`（`settleRun` 只有 `(runId,status)`）；`packages/contracts/src/entities/run.ts:181` 的 `costKnown` 全仓无写入方。
- **事实（实跑，EXP-A2/C3）**：未测量结算 → `tokensUsed=0`、`tokensReserved` 全额回落、`costKnown` 仍 `true`；`run.ended` 仅以 `usageMeasured:false` 区分。`grep -rn "tokensUsed" packages/*/src apps/*/src` 显示唯一生产写入是 `run-lifecycle.charge`；`settleRun` 形参个数实测 2。
- **依据**：`reliability.md` §3「**未知usage保持预留并标 costKnown=false，不能按零收费释放额度**」；AC-022「无静默加额」。DC-41 已如实登记「当前没有生产调用方提供用量…属显式缺口，承接 WP-10」，但**默认路径的行为本身仍与 reliability.md §3 冲突**——记录承认了缺口，却没有让默认路径 fail-closed。
- **影响**：预算止损在「顺序多 Run」下不成立（同一笔限额可被无限次全额复用）；`costKnown=false` 语义零实现。DC-41 已把真实用量承接 WP-10，故不单独阻断 Test；但本包应至少决定：未测量时保持预留或置 `costKnown=false`，或把「按零释放」写成显式产品决定，而不是仅在 Discovery 记缺口。

### Q-04 [P2] 父 Chief Run 可在 `join=all` 子 Run 未终态时被结算为终态：AC-046 的 Gate 阻断与「新 Chief 消息可处理」被击穿

- 位置：`packages/core/src/run-lifecycle.ts:137-204`（`settle`/`end` 完全不检查该 Run 是否还有非终态 `join=all` 子 Run）；`packages/core/src/orchestrator.ts:564-568`（公开入口 `settleRun`）。
- **事实（实跑，EXP-C1）**：Chief Run（allocation 60k）派发一个 `joinPolicy='all'`、`requiredChild=true` 的 10k 子 Run 后，子 Run 仍 `queued` 时 `settleRun(parent,'completed')` **成功**（`settleErr=null`，父 `completed`）；随后子 Run `beginAttempt→settle(failed)` → `joins.onChildSettled(kid)` 返回 `kind='blocked'`，并写出 `chief_action_required`，其 `entityId` = 已终态的父 Run；`joins.state(parent)` 也是 `blocked`。而该终态父 Run 既不能再被派发（N-05 的 `canParentDispatch` 校验），也不能处理新消息。
- **依据**：AC-046「父可获全部结果，相关 Gate 阻断；新 Chief 消息可处理」；`agents.md` §3「all 挂起该 ChiefRun 直至指定子 Run 终态」；`orchestrator.ts:289-297` 的注释已把「终态父 Run 的子 Run 永远不会被 Join」当作必须防住的情形，却只防了「终态父接收新派发」这一个方向。
- **影响**：Core 不再是自己不变量的守门人——调用方（WP-05 Supervisor）只要在子 Run 未收敛时结算 Chief Run，就会产生一个永远不会被处理的 Chief 待办（静默丢 Gate 阻断），并提前释放父 Run 的 Work 预留（EXP-C1：父结算后 Work 预留仅剩两个 Chief 自身 + 存活子）。这是本轮唯一的 AC-046 实质缺口。
- **建议**：`settle` 对含非终态 `join='all'` 子 Run 的父 Run 拒绝（`INVALID_STATE`），或将其转入 `waiting_children` 并延迟终态；补「父在子未终态时不可结算」的必需失败测试。

### Q-05 [P3] `run.ended.data.releasedTokens` 在实测用量下仍是整笔 allocation，与 reliability §3「释放剩余」字面不符

- 位置：`packages/core/src/run-lifecycle.ts:193-201`（`releasedTokens: run.budgetAllocation` 恒定，不含 `tokensUsed` 扣减）。
- **事实（实跑，EXP-C6）**：`budgetAllocation=30000`、`usage=25000` → `run.ended.data={tokensUsed:25000, usageMeasured:true, releasedTokens:30000}`；`releasedTokens + tokensUsed = 55000 > allocation`。EXP-A2 同类。
- **依据**：`reliability.md` §3「扣除实际usage并释放剩余」，字面语义下 `releasedTokens` 应为 5000；事件消费方按 `released+used` 记账会高估释放量。`protocol.md` §7 要求 data 是「变更后实体摘要」。
- **建议**：`releasedTokens` 记 `allocation - tokensUsed`（或改名为 `reservedTokens`/`allocation` 以消歧），并同步文档。

### Q-06 [P3] 父 Run 级 allocation 上限只存在于 Discovery DC-40，未进入任何权威契约，且会拒绝文档允许的派发

- 位置：`packages/core/src/orchestrator.ts:572-596`（`requireBudget`：`live children` 之和 + 新分配 ≤ `parent.budgetAllocation`）；依据仅 `discovery.md:89-91`（DC-40，自称「本包的实现约定」）。
- **事实（实跑，EXP-C4）**：Work `tokenLimit=1_000_000`、父 Run `budgetAllocation=5_000`，派发一个 `budgetAllocation=50_000` 的子 Run → `BUDGET_EXCEEDED: live children of Run … hold 0 of 5000 tokens`（0 个在场子 Run 却已判定超限）。`agents.md` §3 只定义 `budgetAllocation` 字段与 Work 级预算，`data.md`/`protocol.md` 未定义「父 Run 额度 = 并发子 Run 之和」这一语义。
- **依据**：`workflow.md`「不重新发明产品字段/授权/行为」；`implementation.md` WP-02 退出条件「代码、Schema、测试和相应文档入口完成结算」。
- **建议**：把 DC-40 的口径写入 `data.md`（Run 级额度语义）或在 `agents.md` §3 补一句；否则该上限属未定义行为，会误拒合法派发。承接核对见 §6。

### Q-07 [P3] M-03 残留：三处源码注释仍声称 Work `blocked(provider)`，与 DC-42 及实测不符

- 位置：`packages/core/src/config.ts:370`、`packages/core/src/model-gateway.ts:87`、`packages/core/src/orchestrator.ts:323`；对照 `discovery.md:97-99`（DC-42「本包未实现 Work 级 blocked」）。
- **事实（实跑，EXP-A3）**：无可用模型时 Work 仍 `running`、`blockerIds=[]`、`work.control_changed`=0；三处注释却写「A Work whose role has no usable model is blocked」「what makes a Work `blocked(provider)`」。第三轮 M-03 原文即点名 `config.ts:370` 与 `model-gateway.ts:87`，本轮只改了 `implementation.md` T2，未改这三处注释。
- **建议**：注释改为「返回 `PROVIDER_UNAVAILABLE`、Run 不创建；Work 级 blocker 承接 WP-05（DC-42）」。

### Q-08 [P3] `JoinCoordinator.state()` 在 `blocked` 时返回空 `chiefTodo`，与 `onChildSettled` 的同一契约不一致

- 位置：`packages/core/src/join.ts:145-147`（`{kind:'blocked', …, chiefTodo: ''}`）。
- **事实（实跑，EXP-C5）**：`onChildSettled` 对同一父 Run 返回真实游标（EXP-B2：`"12006"`），而只读的 `state()` 返回 `""`；读取方无法从 `state()` 定位 Chief 待办，易被当成「无待办」。
- **建议**：`state()` 复用 `pageChief` 的查重结果返回既有游标（不发新事件），或把 `chiefTodo` 改为可选字段并在类型/文档中说明 `state()` 不产生待办。

### Q-09 [P3] 过程：411d04f 新增生产文件 `packages/core/src/events.ts` 不在 `plan.md`（planVersion 2）writePaths 内，plan 未升版

- 位置：`packages/core/src/events.ts`（本轮新增）与 `packages/core/src/run-lifecycle.ts`（第二轮新增）；`plan.md:16-29` 的 writePaths 未包含二者，本轮提交也未更新 `plan.md`。
- **依据**：`workflow.md`「Plan 决定函数与文件内部结构；代码修改先有适用 Plan」；第一轮 RE-05 正是因 `snapshots.ts` 越界而补 planVersion 2。`events.ts` 是本轮修复 D3 的关键新模块，属实质性写入范围变化。
- **建议**：升 planVersion 3，把 `run-lifecycle.ts`、`events.ts` 补入 writePaths 并注明授权来源；这是记录完整性问题，不影响代码正确性。

### Q-10 [P3] 记录不自洽：T11 声称对抗性核验补出 D1..D5，仓库内只定义 D1/D2/D3，D5 无任何痕迹

- 位置：`implementation.md:77,79,82`（D1/D2/D3/D4/D5 汇总）；`discovery.md:101-110`（DC-43 只含 D3，DC-44 只含 D1/D2）；普通提交信息只列 D1/D2/D4。
- **事实**：`grep -rn "D5" .agentdev docs` 无定义；`git cat-file --batch-all-objects` 扫描全部 891 个 blob，除实现记录的汇总句外无「对抗性核验」正文；本轮无法独立核实 D5。
- **影响**：第四轮的「逐条核对 D1..D5」在 D5 上不可完成；Review 报告不能以开发方汇总句替代可核对的 Finding 描述（`workflow.md` §6「报告不能以『应该』代替执行」）。
- **建议**：在 `discovery.md` 补齐 D4/D5 的完整定义与处置（D4 至少应按本报告 §3 补一条 DC），并修正 T11 的措辞。

---

## 6. 本包必修 vs 其他包显式缺口（承接核对）

| 事项 | 归属判定 | 承接登记核对 | 结论 |
|---|---|---|---|
| Q-01 `operationId` 载荷冲突 | **本包必修（P2）** | — | `request_dispatch` 与 `protocol.md` §1 幂等规则同属 WP-02 输出 |
| Q-04 父 Run 提前结算击穿 AC-046 | **本包必修（P2）** | — | AC-046 在 WP-02 关联验收内 |
| Q-02 超限 usage 卡死结算 | **本包必修（P3，低成本）** | — | `charge` 为本轮新增代码路径，应在包内 fail-closed |
| Q-03 未测量即全额释放 / `costKnown` | 部分本包、主体承接 **WP-10** | `discovery.md:93-95` DC-41 明确承接 WP-10；但 `docs/delivery/implementation.md:131-141` WP-10 条目未出现「usage/预算核销」，且 `.agentdev/work/WP-10/` 尚不存在 | **显式缺口已登记（DC-41），但承接包条目未确认**；建议结算前在 WP-10/WP-05 条目补一句 |
| M-03 Work `blocked(provider)` | 承接 **WP-05** | `discovery.md:97-99` DC-42 承接 WP-05；`implementation.md:71-81` WP-05 输出为「ContextBuilder、ACL、Snapshot、read ledger、Checkpoint、预算」，**不含 WorkBlocker/Work 状态投影**，`work.control_changed` 亦无包认领 | **承接归属存疑**：DC 声明了 WP-05，但 WP-05 条目未登记该职责 |
| DC-38 `runParams` 无授权来源 | 承接 **WP-04/WP-07** | `discovery.md:81-83`；WP-04 条目（`:59-69`）为知识/初始化，WP-07 条目（`:95-105`）为权限/工具/Secret | 归属偏 WP-07，WP-04 条目未提授权；后续包未启动，无法进一步核实 |
| DC-39 Join 无协议事件（读模型） | 承接 **WP-08** | `discovery.md:85-87`；WP-08 条目（`:107-117`）为集成/结算/恢复，WS/读模型更贴 WP-09 | 归属与条目不一致，属跨包风险 |
| M-04 剩余同类（其他事件缺 §4 字段） | 本包已按最小要求修复 | — | 无剩余 |
| N-11 `data.md` `ID` vs 哈希 | **Product Decision Pending** | `discovery.md:72`（RE-06）保留实现并等待产品确认 | 未消解前不得判 Completed |

补充事实：除 `.agentdev/work/{WP-00,WP-01,WP-02}` 外，承接包（WP-04/05/06/07/08/10）均尚无独立过程记录目录，故「承接」目前只能由 DC 条目声明，无法在承接包侧交叉验证。

---

## 7. 未验证 / 无法验证项与剩余风险

1. **D5 内容**：仓库无定义（Q-10），本轮无法逐条核对。
2. **真实并发**：全部实验为单线程；`requireBudget`/`canAllocateBudget` 在事务外判定、`requestDispatch` 的 `operationId` 去重也在事务外（`orchestrator.ts:460-474` 查到即 return，未与 `append` 同事务），并发下可能重复建待办或把预算失败降级为 `CONSTRAINT_VIOLATION`。单 mailbox 串行下不可达，本轮未做真实并发压测。
3. **D1 版本竞态**：`entityVersion` 取自 `requestDispatch` 事务前读到的 `chief.version`；若同进程并发派发（`attachChild` 会 +1）可能写出略旧的版本。未做并发验证。
4. **消息级路由**：`ProjectMailbox` 仍不读 `subject`，无法在 mailbox 层验证「消息投递到等待中的父 Run」；该区分力由 `dispatch` 的父状态校验提供（第三轮已证），消息按 Run 选处理器仍属 WP-05/WP-08。
5. **`beginAttempt` 无法恢复 `paused` Run**（EXP-C5：`VALIDATION_ERROR: cannot start from paused`），而 `domain/transitions.ts:128-130` 的 `runAcceptsNewAttempt` 把 `paused` 视为可新 Attempt——第三轮残余，非本轮回归，Checkpoint 恢复路径归 WP-05。
6. **`settleRun` 非幂等**：重复结算抛 `VALIDATION_ERROR`；WP-05 的 at-least-once 监督重放需 operationId 保证只调用一次。
7. **真实 Provider 调用与 Secret**：`GatewayTransport`/`SecretResolver` 仍为注入缝（DC-31），AC-043「不同 Provider」仍只是结构验证。
8. **ContextBuilder/上下文内容与 token 计量**：`dispatch` 的 `contextPayload` 仅有 fallback（`orchestrator.ts:341-348`），属 WP-06；AC-082 的工具层负例归 WP-07。
9. **`readLedgerHash` 真实性**：`stage.ts` 只做 64 位十六进制 Schema 校验，未与读账本核对（WP-05/WP-06）。
10. **事件消费者端到端兼容性**：Q-05/Q-08 的事件字段语义与 WS/BFF/UI（WP-08/WP-09）未实现，本轮只做协议/文档静态判定。
11. **`test:e2e`/`test:acceptance`/`test:live`**：按契约 `NOT_IMPLEMENTED`，未执行。
12. **结算未完成（T9 待办）**：`docs/INDEX.md:26-30` 仍只列 WP-00/WP-01 且称 Work/Run 编排「仍未实现」；`docs/delivery/acceptance.md` 无 WP-02 证据登记；`implementation.md` 仍留「## T9 待办」。本次 Review 只判定「实现是否成立」，不判定「结算是否完成」；在 Q-01/Q-04 关闭前也不应结算。
13. **N-11 产品决定**：`data.md` 的 `ID` 记法与代码哈希仍并存，属 `Product Decision Pending`。

---

## 8. 方法与边界声明

- 本报告只依据仓库文件、`411d04f` 上的 git 对象/差异与实跑命令；未读取任何开发对话、未引用外部同名技能或历史方案。
- 唯一写入文件为本文件 `.agentdev/work/WP-02/review.md`；实验脚本独立写在 `/tmp/wp02-r4/`（`fixture.mjs`、`exp-a.mjs`、`exp-b.mjs`、`exp-c.mjs`、`exp-*.log`），使用 `pnpm build` 产出的 `packages/*/dist`，通过 `/tmp/wp02-r4/node_modules/@agentdev/*` 软链解析 workspace 包，等价复现 `join.test.ts`/`orchestrator.test.ts` 的夹具但**不 import 产品测试文件**。
- 未修改产品代码、测试、`docs/**`、`plan.md`、`implementation.md`、`discovery.md`；`pnpm build` 只写 `.gitignore` 中的 `dist/`，写入本报告结束时 `git status --porcelain` 仅显示本文件本身。
- 第一/二/三轮完整报告可分别通过 `git show c4763d5:.agentdev/work/WP-02/review.md`、`git show a8daa6d:.agentdev/work/WP-02/review.md`、`git show 411d04f:.agentdev/work/WP-02/review.md` 取回。
