# WP-02 独立 Review 报告（第三轮）

- 评审对象：工作包 WP-02「主管与独立Agent调度」
- 评审轮次：**第三轮**（逐条复核第二轮 N-01..N-10 是否真修，并找修复引入的新问题与第二轮未覆盖的新 Finding）
- 冻结点：git `a8daa6d`（`fix(core): WP-02 review round 2 findings (N-01..N-10)`），前置 `c4763d5`
- HEAD 校验：`git rev-parse HEAD` = `a8daa6d08dfe2604442943e32860a97b0eaaccd0`
- 工作树：`git status --porcelain` 无输出（`pnpm build` 只写被 `.gitignore` 忽略的 `dist/`，复核结束时仍无输出）
- 评审角色：Review（独立上下文，未读取任何开发对话；只依据仓库文件、git 对象与实跑命令）
- 权威依据：`docs/rules/{workflow,agents}.md`、`docs/architecture/{data,protocol,reliability,context,ARCHITECTURE}.md`、`docs/delivery/{implementation,acceptance}.md`（WP-02 与 AC-043/044/045/046/047/082）、`.agentdev/work/WP-02/{plan,implementation,discovery}.md`
- 方法：回到代码逐行核对，另在 `/tmp/wp02-r3/` 自建 8 个脚本（`fixture.mjs` + `exp1..exp8`）用 `pnpm build` 产出的 `packages/*/dist` 独立复现；**不修改产品代码、测试、`docs/**`、plan/implementation/discovery**。

---

## 0. 历史轮次结论摘要（保留）

**第一轮（冻结点 `785bdd6`）判 FAIL：1×P1、5×P2、7×P3（R-01..R-13）。**
P1＝`stage.submit` 无终态/epoch 守卫（终态 Run 仍接受交付并落 `stage_result` 行）；P2＝「父等待可接消息」证据空洞、`joinPolicy=none` 未实现、持久事件名偏离 `protocol.md` §7、越界写入 Plan、`run.ts` 快照引用改哈希与 `data.md` 冲突；P3＝R-07..R-13。第一轮命令全部通过（unit 202 / integration 124），失败原因是行为与证据，不是构建。

**第二轮（冻结点 `c4763d5`）判 FAIL：0×P1、5×P2、6×P3（N-01..N-11）。**
确认 R-05/R-09/R-10/R-11/R-12 已修好；R-01/R-03/R-04/R-07/R-08/R-13 部分修复；R-02 证据仍无效。N-01＝`contract_violation` 终态不释放预算（预算永久泄漏并拒绝后续合法派发）；N-02＝`stage.submit` 只排除终态，`paused`/`waiting_permission`/`interrupted`/`recovery_required` 仍接受交付；N-03＝DC-37 RE-04 声称删除的两个自造 Join 事件名仍在发出（文档与代码不符）；N-04/N-05＝「父等待可接消息」必需失败测试无区分力、终态父 Run 仍可接收新子 Run；N-06＝`onChildSettled` 重算重复写 `chief_action_required`；N-07＝被阻断 Gate 事件 data 结果契约不全；N-08＝二次 Schema 失败在 `paused` 抛 `VALIDATION_ERROR`；N-09＝代码引用不存在的 DC-38；N-10＝超预算返回 `CONSTRAINT_VIOLATION` 而非 `BUDGET_EXCEEDED`；N-11＝`data.md` 与代码的快照引用类型冲突（产品确认未完成）。
> 第二轮完整报告（含 R-01..R-13 逐条表）保存在 git 对象 `git show a8daa6d:.agentdev/work/WP-02/review.md`，本轮只保留上述摘要以免重复。

---

## 1. 结论

**FAIL（Review Failed）——第二轮 N-01..N-10 全部 10 条经独立实跑确认真实修好（0 条残留）；但修复未覆盖同一类的父 Run 级预算预留，本轮新增 1×P1、2×P2、2×P3（M-01..M-05）。**

- **N-01..N-10 逐条为「已修复（verified）」**（证据见 §3）；第二轮点名的「修复说明与代码不符」（N-03）本轮已消除：代码实际发出的持久事件名是 `protocol.md` §7 的子集（EXP1/EXP7）。
- **但 T10 的修复范围有缺口**：本轮把「Work 预算预留」收敛到 `run-lifecycle.ts` 后，**父 Run 自身 allocation 形成的子 Run 累计上限仍然从不释放**（M-01，P1，实测）。其效果与第二轮 N-01 同类：一个 Chief Run 派发过的子 Run allocation 累计达到自身 allocation 后，之后所有新子 Run 永久被 `BUDGET_EXCEEDED` 拒绝，且**提高 Work 预算也无法恢复**（AC-022 文档化的恢复路径失效）。
- 另有 2 个 P2（预算只增不减的 usage 记账缺失 M-02；`agents.md` §5 / `implementation.md` T2 声称的 `Work blocked(provider)` 未落地 M-03）与 2 个 P3（M-04/M-05）。
- 按 `workflow.md` §6「P0/P1 阻断；P2/P3 由 Review 说明是否影响验收」：M-01 为 P1，直接阻断；M-02/M-03 影响 AC-022/AC-043/AC-044 的验收语义，同样阻断。本包**不具备进入独立 Test 的条件**，须先返工 M-01（M-02/M-03 至少需落 Discovery 承接或修正文档声明）。
- 第二轮 N-11（`data.md` 的 `ID` 记法 vs 代码哈希）仍是 **Product Decision Pending**，未消解（§3 表末）。

---

## 2. 验证命令与原始结果

环境：`export PATH="$HOME/.local/bin:$PATH"`，工作目录 `/Users/huyaohua/huyh/work/aigrouptool`，全部在 `a8daa6d`、干净工作树上执行。原始日志：`/tmp/wp02-r3-commands-a.log`（typecheck/lint/docs:check/unit）、`/tmp/wp02-r3-commands-b.log`（integration）、`/tmp/wp02-r3-build.log`（build）。

| 命令 | 退出码 | 关键原始输出 |
|---|---|---|
| `pnpm typecheck` | 0 | `$ tsc -p tsconfig.json --pretty false`（无错误输出） |
| `pnpm lint` | 0 | `Checking formatting...` / `All matched files use Prettier code style!` |
| `pnpm docs:check` | 0 | `docs:check ok — 15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages` |
| `pnpm test:unit` | 0 | `Test Files 17 passed (17)` / `Tests 210 passed (210)`，10.45s（与 T10 自述的 210 一致） |
| `pnpm test:integration` | 0 | `Test Files 10 passed (10)` / `Tests 124 passed (124)`，80.36s；含真实 Docker `apps/cli/test/container.integration.test.ts` 9 用例与 `doctor.integration.test.ts` 8 用例 |
| `pnpm build` | 0 | 全部 workspace `Done`（仅用于本轮独立实验读取 `dist/`；`dist/` 被忽略） |

`git log --oneline -3`：

```
a8daa6d fix(core): WP-02 review round 2 findings (N-01..N-10)
c4763d5 fix(core): WP-02 independent review round 1 findings (RE-01..RE-13)
785bdd6 feat(core): WP-02 T3-T8 orchestration, join, stage contract and restart scope
```

`git status --porcelain`：无输出。`test:e2e|acceptance|live` 保持按契约返回 `NOT_IMPLEMENTED`，未执行。

### 2.1 本轮独立实验结果（`/tmp/wp02-r3/*.mjs`，全量日志 `/tmp/wp02-r3/all.log`）

```
===== exp1-events
EXP1 all event names        : ["run.ended","run.queued","run.started","stage.completed"]
EXP1 NOT in protocol §7      : []
EXP1 run.waiting_children    : 0
EXP1 run.children_joined     : 0
EXP1 run.ended data keys     : [["outcome","workId","releasedTokens"], ... x3]

===== exp2-budget
EXP2 reserved after chief(100k)+A(50k)+victim(30k): 180000
EXP2 second schema failure   : {"accepted":false,"code":"CONTRACT_VIOLATION","runStatus":"contract_violation","rejections":2}
EXP2 reserved after violation: 150000   (released 30000, 原为 180000)
EXP2 run.ended data          : [{"outcome":"contract_violation",...,"releasedTokens":30000}]
EXP2 legal chief(30k) dispatch after violation -> OK
EXP2 over-budget chief(200k) dispatch -> THROW BUDGET_EXCEEDED: dispatch budget: used 0 + reserved 180000 + 200000 exceeds 200000
EXP2 settle(a) reserved 180000 -> 130000
EXP2 settle(a) twice -> THROW VALIDATION_ERROR: Run ... cannot move cancelled → cancelled
EXP2 used tokens after all   : 0

===== exp3-nonrunning
EXP3 run=paused              1st=THROW INVALID_STATE: Run ... is paused; only a running Run accepts stage results 2nd=THROW INVALID_STATE rows=0 schema_invalid=0 runNow=paused
EXP3 run=waiting_permission  ... rows=0 schema_invalid=0 runNow=waiting_permission
EXP3 run=interrupted         ... rows=0 schema_invalid=0 runNow=interrupted
EXP3 run=recovery_required   ... rows=0 schema_invalid=0 runNow=recovery_required

===== exp4-parent
EXP4 parent=completed dispatch -> THROW INVALID_STATE: parent Run ... is completed and cannot accept a new dispatch
EXP4 children rows after completed-parent dispatch: 0
EXP4 mailbox admission accepted (completed parent): true
EXP4 mailbox completion -> REJECTED INVALID_STATE
EXP4 parent=paused dispatch -> THROW INVALID_STATE
EXP4 parent status while waiting: waiting_children
EXP4 mailbox admission accepted (waiting parent): true
EXP4 waiting-parent child created: YES
EXP4 join state after dispatch: {"kind":"waiting","pending":[<second>,<third>]}
EXP4 chief still waiting: waiting_children

===== exp5-join
EXP5 required-failure onChildSettled x3 -> kinds: blocked blocked blocked
EXP5 chief_action_required count (required): 1
EXP5 event data top keys     : ["children","failed","failedRequired","reason"]
EXP5 rich stageResult keys   : ["artifactRefs","changedPaths","evidenceRefs","findingIds","requestedActions","status","summary","unknowns"]
EXP5 rich artifactRefs       : [{"id":"...e90","version":3,"hash":"aaaa…"}]
EXP5 rich evidenceRefs/changedPaths/findingIds: present
EXP5 chief_action_required count (none)    : 1

===== exp6-lifecycle
EXP6 beginAttempt queued      : {"n":1,"epoch":0,"run":"running"}
EXP6 beginAttempt while running -> THROW VALIDATION_ERROR: Run ... cannot start from running
EXP6 beginAttempt from starting/interrupted/recovery_required -> OK {"n":2,"epoch":1,"run":"running"}
EXP6 beginAttempt from paused/completed -> THROW VALIDATION_ERROR
EXP6 settle: reserved 104000 -> 100000 run.version 4
EXP6 settle twice / terminal other status -> THROW VALIDATION_ERROR; reserved unchanged
EXP6 lifecycle.release(1e9) clamps -> 0
EXP6 contractViolation from waiting_children -> THROW VALIDATION_ERROR
EXP6 chief(20k) sequential child #1 of 10k -> OK {"workReservedAfterSettle":20000}
EXP6 chief(20k) sequential child #2 of 10k -> OK {"workReservedAfterSettle":20000}
EXP6 chief(20k) sequential child #3 of 10k -> THROW BUDGET_EXCEEDED: children of Run ... already hold 20000 of 20000 tokens
EXP6 siblings (all terminal?) : [["completed",10000],["completed",10000]]

===== exp7-event-sweep
EXP7 all emitted names   : ["chief_action_required","run.ended","run.queued","run.started","stage.completed","stage.failed"]
EXP7 not in protocol §7  : []
EXP7 run.waiting_children: 0 / run.children_joined: 0
EXP7 stage.* outcomes    : [["stage.completed","success"],["stage.failed","failed"],["stage.failed","schema_invalid"],["stage.failed","schema_invalid"],["stage.failed","failed"]]

===== exp8-gaps
EXP8 dispatch with missing model (role=test) -> THROW PROVIDER_UNAVAILABLE: role test has no usable model…
EXP8 Work status after PROVIDER_UNAVAILABLE : running
EXP8 Work blockerIds                        : []
EXP8 work.control_changed events            : 0
EXP8 first attempt epoch 0 -> resumed epoch 1 run running
EXP8 submit with old epoch 0 after resume -> THROW STALE_ARTIFACT
EXP8 submit with new epoch 1 after resume -> OK true
EXP8 §4 fields MISSING from todo payload: ["readLedgerSeq","readLedgerHash"]
EXP8 duplicate requestDispatch todos: 0 -> 2
```

---

## 3. 第二轮 N-01..N-10 逐条复核表

| 条目 | 二轮严重度 | 复核判定 | 真实实验与输出摘要（`/tmp/wp02-r3`） |
|---|---|---|---|
| **N-01** `contract_violation` 终态不释放预算 | P2 | **已修复（verified）** | `run-lifecycle.ts:134-165` 的 `contractViolation`/`end` 与 `settle` 共用终止路径，统一 `release`。EXP2：chief(100k)+A(50k)+victim(30k) 后 `reserved=180000`；victim 连续两次 Schema 失败 → `CONTRACT_VIOLATION`，`reserved=150000`，`run.ended.data.releasedTokens=30000`；随后合法 `chief(30k)` 派发成功（第二轮此处报 `CONSTRAINT_VIOLATION`）。测试 `join.test.ts:326-331` 亦断言 `reservedBefore - run.budgetAllocation`。 |
| **N-02** 非 running 状态仍接受交付 | P2 | **已修复（verified）** | `stage.ts:125-131` 改为 `run.status !== 'running'` 即抛 `INVALID_STATE`，在任何写入之前。EXP3：`paused`/`waiting_permission`/`interrupted`/`recovery_required` 四种状态各提交两次均 `THROW INVALID_STATE`，`stage_result` 行数 0、`schema_invalid` 事件 0、Run 状态不变。测试 `join.test.ts:397-425` 覆盖 `paused`，并断言无 `schema_invalid`。 |
| **N-03** 自造 Join 事件名仍在发出（文档与代码不符） | P2 | **已修复（verified）** | `join.ts:167-208` 已删除两个 `events.append`，仅更新 Run 行。EXP1/EXP7 全流程实际事件名 `["chief_action_required","run.ended","run.queued","run.started","stage.completed","stage.failed"]` 全部属于 `protocol.md` §7；`run.waiting_children`=0、`run.children_joined`=0。`discovery.md:70`（RE-04）已改为如实表述并指向 DC-39。 |
| **N-04** 必需失败测试「父等待可接消息」无区分力 | P2 | **已修复（verified，附残余）** | `dispatch` 现校验父状态（`orchestrator.ts:285-293`），使该测试具备区分力。EXP4：父 `waiting_children` 时经 `ProjectMailbox.submitCommand` 派发第三子 `accepted:true` 且子 Run 建成、`joins.state` 仍 `waiting`（pending=[second,third]）、父仍 `waiting_children`；父改 `completed` 后同一 mailbox 路径 `completion` 被 `INVALID_STATE` 拒绝。即「若把等待当锁」该测试必然失败。残余：`mailbox.ts:129-147` 仍完全不读 `subject`，消息级路由（按 Run 选处理器）在 WP-02 未实现——见 §6 剩余风险 1，不单列 Finding（第二轮的 (b) 方案已落地）。 |
| **N-05** 终态父 Run 仍可接收新子 Run | P2 | **已修复（verified）** | `RunLifecycle.canParentDispatch`（`run-lifecycle.ts:16-21,167-170`）= `queued/starting/running/waiting_children`；`orchestrator.ts:287-293` 不满足即 `INVALID_STATE`。EXP4：父 `completed` 与 `paused` 派发均抛 `INVALID_STATE ... cannot accept a new dispatch`，`parent_run_id` 子行数 0。测试 `join.test.ts:249-272`。 |
| **N-06** 重算 `onChildSettled` 重复写 `chief_action_required` | P3 | **已修复（verified）** | `join.ts:219-234` 的 `pageChief` 以 `(entityId=parent, reason, failed 集合)` 查已有事件并复用。EXP5：对同一 required 失败子连续 3 次 `onChildSettled` → `chief_action_required` 1 条；对同一 `none` 失败子连续 2 次 → 1 条。测试 `join.test.ts:427-436`。 |
| **N-07** 被阻断 Gate 的事件 data 结果不全 | P3 | **已修复（达到 N-07 要求，附残余）** | `join.ts:245-263` 的 `stageResult` 直接携带完整数组：EXP5 实测 `artifactRefs=[{"id","version":3,"hash"}]`（不再降为裸 id），`evidenceRefs`/`changedPaths`/`findingIds`/`unknowns`/`requestedActions`/`status`/`summary` 齐全，共 §4 交付字段 8 个。残余：缺 `readLedgerSeq`/`readLedgerHash`（见 M-04）。 |
| **N-08** 二次 Schema 失败在 `paused` 等状态抛 `VALIDATION_ERROR` | P3 | **已修复（构造性消除）** | 由于 N-02 的 `running` 白名单，`reject()` 在非 running 状态根本不会执行。EXP3：四种状态两次提交均为 `INVALID_STATE`，`schema_invalid`=0，不存在「第一次拒绝后无法升级」的中间态。残余（不单列）：若 Run 在两次提交之间离开 `running`，第二次为 `INVALID_STATE` 而非 `contract_violation`，属 fail-closed 可接受。 |
| **N-09** 代码引用不存在的 DC-38 | P3 | **已修复（verified）** | `discovery.md:81-87` 新增 DC-38（Run 参数层无授权来源，承接 WP-04/WP-07）与 DC-39（Join 无协议事件，承接 WP-08）。全仓 `grep DC-38` 只命中 `orchestrator.ts:80` 注释与文档，无悬空引用。 |
| **N-10** 超预算返回 `CONSTRAINT_VIOLATION` 而非 `BUDGET_EXCEEDED` | P3 | **已修复（verified）** | `orchestrator.ts:308-314` 对所有 spec（含 Core 构造的 chief spec）在写入前统一 `canAllocateBudget`。EXP2：chief(200k) → `THROW BUDGET_EXCEEDED: dispatch budget: used 0 + reserved 180000 + 200000 exceeds 200000`。测试 `orchestrator.test.ts:462-469` 已改为断言 `code: 'BUDGET_EXCEEDED'`。 |
| **N-11**（第二轮附带）`data.md` 的 `ID` vs 代码哈希 | P3 | **仍未消解（Product Decision Pending）** | `docs/architecture/data.md:30,80` 仍写 `configSnapshotId:ID / contextSnapshotId:ID / dispatchSnapshotId:ID`、`DispatchSnapshot.contextSnapshotId:ID`；代码 `run.ts:37 snapshotRefSchema = hashSchema`。`discovery.md:72`（RE-06）保留哈希实现并声明待产品确认。**本轮不作为阻断 Finding**（技术理由成立、已显式记录），但未确认前不得判 Completed。 |

**小结：N-01..N-10 全部 10 条经独立实验（非只读测试）确认真实修好，0 条残留；第二轮「文档声称已修而代码不符」的问题（N-03 / DC-37 RE-04）已消除。**

---

## 4. 文档声明 vs 代码交叉核对（第二轮修复说明专项）

逐条核对 `implementation.md` T10 与 `discovery.md` DC-37/DC-38/DC-39 的每一句声明：

| 声明 | 代码事实 | 判定 |
|---|---|---|
| T10：「新增 `run-lifecycle.ts`…任何终态都会释放预留」 | 文件存在；`settle`/`contractViolation` 共用 `end`→`release`；EXP2/EXP6 实测 | ✅ 一致 |
| T10：「`StageGate.submit` 改为只有 `running` 可交付…零写入」 | `stage.ts:125-131`；EXP3 实测四状态 0 行 0 事件 | ✅ 一致 |
| T10：「`dispatch` 校验父 Run 状态 `ACTIVE_PARENT_STATUSES = queued/starting/running/waiting_children`」 | `run-lifecycle.ts:16-21` 与之逐字一致；EXP4 实测 | ✅ 一致 |
| T10：「`JoinCoordinator` 真正删除未定义事件名」 | `join.ts` 无该两处 append；EXP1/EXP7 | ✅ 一致 |
| T10：「`chief_action_required` 按 `(parent, reason, 失败集合)` 幂等」 | `join.ts:225-234`；EXP5 | ✅ 一致 |
| T10：「事件 data 携带**完整结果契约**」 | `join.ts:251-263` 携带 §4 的 8 个交付字段，**缺 `readLedgerSeq`/`readLedgerHash`** | ⚠️ 表述略超范围（N-07 自身要求的两项已满足；缺口见 M-04） |
| T10：「预算准入对所有 spec 在写入前统一判定，超限返回 `BUDGET_EXCEEDED`」 | `orchestrator.ts:308-314`；EXP2 | ✅ 一致 |
| T10：「DC-37 RE-04 不实表述已更正；补 DC-38、DC-39」 | `discovery.md:70`、`:81-87`；grep 无悬空引用 | ✅ 一致 |
| **`implementation.md` T2：「`availability(...)`（准入判定，失败即 Work `blocked(provider)`）」** | **`orchestrator.ts:317-324` 只 `fail('PROVIDER_UNAVAILABLE')`；EXP8 实测 Work 仍 `running`、`blockerIds=[]`、0 条 `work.control_changed`** | ❌ **文档声明与代码不符**（T2 原始声明，非本轮修复声明；见 M-03） |

结论：本轮修复说明与代码**未发现新的不实陈述**；仅 `implementation.md` T2 的 `Work blocked(provider)` 声明与代码不符（M-03），且 T10「完整结果契约」措辞略宽于实现（M-04）。按任务要求，"凡文档声称已修而代码不符，判 FAIL 并单列"——本轮该类问题已消除，故不计 FAIL；M-03 作为独立 Finding 单列。

---

## 5. 新 Findings

### M-01 [P1] 父 Run 级预算预留从不释放：Chief 派发过的子 Run allocation 累计达上限后永久拒绝新子 Run

- 位置：`packages/core/src/orchestrator.ts:537-556`（`requireBudget`，尤其 `:542-553` 的 `siblings.reduce(...)` 与 `BUDGET_EXCEEDED`）；对照 `packages/core/src/run-lifecycle.ts:68-77`（`release` 只回落 Work 预算行）。
- **事实（实跑，EXP6 第三段）**：Work 预算 1,000,000、Chief allocation 20,000。顺序派发 3 个 `budgetAllocation=10,000`、`requiredChild=true` 的子 Run，每个都 `beginAttempt` → `stage.submit`(success) → `settleRun(completed)`：
  - 子 #1 → OK，结算后 Work `tokensReserved=20000`（仅剩 Chief 自身）
  - 子 #2 → OK，结算后 Work `tokensReserved=20000`
  - 子 #3 → `THROW BUDGET_EXCEEDED: children of Run <chief> already hold 20000 of 20000 tokens`
  - 此时两个既有子 Run 都是 `completed`，Work 预算有 980,000 空闲。
- **依据**：`requireBudget` 的 `siblings` 查询（`:542-545`）按 `parent_run_id` 取**全部**子 Run（含终态），从不排除已结算者；而 `run-lifecycle.ts` 只在 Work 层释放同一笔 reservation。同一笔 allocation 在 Work 层被释放、在父 Run 层被永久占用，两层口径自相矛盾。文档层面：`reliability.md` §3「预留…**扣除实际usage并释放剩余**」；AC-022「Given 并发调用接近限额…原子拒绝；**用户增加预算后继续**，无静默加额」——本缺陷下**增加 Work 预算也无济于事**（上限来自不可变的 `run.budgetAllocation`），文档化的恢复路径失效；`workflow.md` §5.3/`agents.md` §3 的失败重派（required 子失败后 Chief 补派替换子 Run）会在几次重试后触顶。注意 `orchestrator.test.ts:381-399` 只验证 3 个子 Run「并发」时第 3 个被拒，从未结算其中的子 Run，故未暴露此行为。
- **影响**：一个 Chief Run 一旦派发过的子 Run allocation 累计达到自身 allocation，后续**所有**派发（包括必需失败的重试/替换）永久被 `BUDGET_EXCEEDED` 拒绝，无 API 可恢复；与第二轮 N-01 同类（预算泄漏 + 阻断合法派发），但 N-01 的修复只覆盖了 Work 层。
- **建议**：二选一并落文档——(a) `requireBudget` 只统计**未终态**子 Run 的 allocation（终态子 Run 的预留随其结算释放），并补一条「结算后第 N+1 个子 Run 仍可派发」的测试；(b) 若产品意图是「Chief allocation 是子 Run allocation 的终身总额度」，则必须在 `discovery.md` 建 DC 条目、在 `data.md`/`reliability.md` 写明语义（并说明与 Work 层释放的口径差异、以及预算提升为何无效），否则该上限属未定义行为。

### M-02 [P2] 预算只「预留/释放」不「核销」：`tokensUsed` 从无生产写入，结算按零 usage 全额释放

- 位置：`packages/core/src/run-lifecycle.ts:146-165`（`end` 无条件 `release(run.budgetAllocation)`）；`packages/core/src/model-gateway.ts:188`（`tokensOf` 存在但无调用方）。
- **事实（实跑 + 代码检索）**：EXP2 全程结束后 Work `tokensUsed=0`；`grep -rn tokensUsed packages apps --include=*.ts`（排除 dist/test）只命中 Schema 与 `domain/dispatch.ts` 的读取，**没有任何生产代码写 `tokensUsed`**。即每个 Run 结束都把 100% reservation 归还，实际消耗从不计入 `used`。
- **依据**：`reliability.md` §3「模型调用前预留…**扣除实际usage并释放剩余**；未知usage保持预留并标 `costKnown=false`，**不能按零收费释放额度**」；AC-022「无静默加额」。当前行为等价于永远按零 usage 释放，使 `canAllocateBudget` 的 `used+reserved<=limit` 约束在跨 Run 顺序执行时失效（同一笔限额可被无限次全额重复使用）。
- **影响**：预算止损（AC-022）在「顺序多 Run」场景下不成立；`costKnown=false` 语义未实现。真实 usage 需模型调用（DC-31 归 WP-07/WP-10），但把「核销」收敛点放在本轮新增的 `run-lifecycle.end` 内是零成本的（保留 `actualUsage` 入参 + 未提供时 `costKnown=false` 不释放），且注释已引用 `reliability.md` §3。
- **建议**：给 `RunLifecycle.settle/contractViolation` 增加可选 `usage`；有 usage 时 `tokensUsed += usage`、释放 `allocation - usage`；无 usage 时保持预留并置 `costKnown=false`。若本轮不做，至少把该缺口写成 DC（承接 WP-05/WP-10）并修正 `run-lifecycle.ts` 顶部注释「released exactly when the Run ends」的口径。

### M-03 [P2] `Work blocked(provider)` 未落地，`implementation.md` T2 与代码不符

- 位置：`packages/core/src/orchestrator.ts:317-324`（只 `fail('PROVIDER_UNAVAILABLE')`）；对照 `docs/delivery/implementation.md:16`（T2「失败即 Work `blocked(provider)`」）、`docs/rules/agents.md` §5「不存在可用模型时Work为blocked(provider)」、`packages/core/src/config.ts:370`、`packages/core/src/model-gateway.ts:87` 注释。
- **事实（实跑，EXP8）**：角色 `test` 无可用模型时 `dispatch` 抛 `PROVIDER_UNAVAILABLE: role test has no usable model: …`；随后 Work `status='running'`、`blockerIds=[]`、`work.control_changed` 事件 0 条。全仓检索无任何生产代码写入 `work.status='blocked'` 或 blocker。
- **依据**：`agents.md` §5、`implementation.md` WP-02 退出条件「缺配置/上下文明确阻断」；`workflow.md` §6「报告不能以『应该通过』代替执行」。测试 `orchestrator.test.ts:401-411` 名为 "blocks the dispatch…" 但仅断言抛错，未验证 Work 状态。
- **影响**：Work 的持久状态不反映 provider 阻断，消费方（Chief/UI/恢复）无法从 Work 行判断「为何没有 Run」；文档三处声明与实现不一致，会污染 Settlement 知识。
- **建议**：二选一——(a) 实现 `Work.status='blocked'` + `work.control_changed`（`blockerIds` 目前无 blocker 实体表，需同步承接 WP-06）；(b) 修正 `implementation.md` T2 与相关注释为「返回 `PROVIDER_UNAVAILABLE`、Run 不创建；Work 级 blocker 承接 WP-06」，并补 DC。二者必居其一。

### M-04 [P3] 被阻断 Gate 事件 data 仍缺 `readLedgerSeq`/`readLedgerHash`（`agents.md` §4 结果契约不全）

- 位置：`packages/core/src/join.ts:25-34`（`ChildOutcome.stageResult` 类型）与 `:251-263`（事件投影）；对照 `docs/rules/agents.md` §4 必需字段（`status/summary/artifactRefs/evidenceRefs/changedPaths/findingIds/unknowns/requestedActions/readLedgerSeq/readLedgerHash`）。
- **事实（实跑，EXP8）**：todo payload 的 `stageResult` 缺失字段 = `["readLedgerSeq","readLedgerHash"]`（其余 8 个齐全，`artifactRefs` 已带 id/version/hash）。
- **依据**：AC-046「父可获**全部结果**」；`agents.md` §4。N-07 的最小要求已满足，故本轮只判 P3。
- **建议**：`ChildOutcome.stageResult` 与事件投影补 `readLedgerSeq`/`readLedgerHash`（`stageResultRow` 已持有），或明确记录「读账本凭据不随事件下发」的理由。

### M-05 [P3] `request_dispatch` 无幂等键，重试重复生成 Chief 待办

- 位置：`packages/core/src/orchestrator.ts:414-476`（每次调用无条件 `events.append({name:'chief_action_required', …})`，无 `operationId`/幂等去重）。
- **事实（实跑，EXP8）**：对同一专业 Run、同一入参调用两次 `requestDispatch` → `chief_action_required` 从 0 变为 **2** 条。
- **依据**：`reliability.md` §1「Outbox以operationId至少一次投递；Supervisor先检查已存在的同operationId Runner/结果，**避免重复创建**」；`protocol.md` §7 错误表含 `IDEMPOTENCY_CONFLICT`。与 N-06 同类影响（重复 Chief 待办 → 重复派发/重复计费），但 Join 侧已幂等、请求侧没有。
- **建议**：给 `DispatchRequestInput` 增加幂等键（`operationId` 或 capability 派生的 `(runId, requestedRole, goal, sourceRefs)` 摘要），写事件前按同键查重；或声明该命令的幂等由上游 mailbox operationId 承担并落 DC。

---

## 6. 未验证 / 无法验证项与剩余风险

1. **消息级路由**：`ProjectMailbox` 不读 `subject`，无法在 mailbox 层验证「消息确实投递到等待中的父 Run」。N-04 的区分力现由 `dispatch` 的父状态校验提供（EXP4 已证），但消息按 Run 选处理器属更上层（WP-05/WP-08），本轮未验证。
2. **并发**：`reserve` 与 Run 行同事务、预算更新走版本 CAS，未见双花；但本轮未做真实并发压测（EXP 为单线程）。`canAllocateBudget` 在事务外判定、`reserve` 在事务内，理论上并发下第二个事务可能以 `CONSTRAINT_VIOLATION` 而非 `BUDGET_EXCEEDED` 失败（单 mailbox 串行下不可达）。
3. **`settleRun` 非幂等**：重复调用抛 `VALIDATION_ERROR`（EXP6）。若 WP-05 的 at-least-once 监督步骤重放结算，需以 operationId 保证只调用一次；本轮未验证。
4. **`beginAttempt` 无法恢复 `paused` Run**：EXP6 显示 `paused` 抛 `VALIDATION_ERROR`（`RUN_TRANSITIONS.paused` 只有 →`running`，而 `beginAttempt` 要求可 →`starting`），而 `domain/transitions.ts:128-130` 的 `runAcceptsNewAttempt` 把 `paused` 视为可新 Attempt。该行为在 `c4763d5` 已存在（**非本轮回归**），Checkpoint 恢复路径归 WP-05；本轮未验证。
5. **真实 Provider 调用与 Secret**：`GatewayTransport`/`SecretResolver` 仍为注入缝（DC-31），AC-043「不同 Provider」仍只是结构验证（测试只用单一 Provider）。
6. **ContextBuilder/上下文内容与 token 计量**：`dispatch` 的 `contextPayload` 仅有 fallback（`orchestrator.ts:337-341`），属 WP-06；AC-082 的工具层负例归 WP-07。
7. **`readLedgerHash` 真实性**：`stage.ts` 只做 64 位十六进制 Schema 校验，未与读账本核对（WP-05/WP-06）。
8. **事件消费者端到端兼容性**：M-04 的字段缺口与 M-03 的 Work 状态缺口在 WS/BFF/UI（WP-08/WP-09）未实现时不会暴露，本轮只做协议/文档静态判定。
9. **`test:e2e`/`test:acceptance`/`test:live`**：按契约 `NOT_IMPLEMENTED`，未执行。
10. **结算未完成（T9 待办）**：`docs/INDEX.md:26-30` 仍只列 WP-00/WP-01 且称 Work/Run 编排「仍未实现」；`docs/delivery/acceptance.md` 无 WP-02 证据登记；`implementation.md` 仍留「## T9 待办」。本次 Review 只判定「实现是否成立」，不判定「结算是否完成」；该状态在 M-01..M-03 关闭前也不应结算。
11. **N-11 产品决定**：`data.md` §2/§3 的 `ID` 记法与代码哈希仍并存，属 `Product Decision Pending`（§3 表末）。

---

## 7. 方法与边界声明

- 本报告只依据仓库文件、`a8daa6d` 上的 git 对象/差异与实跑命令；未读取任何开发对话、未引用外部同名技能或历史方案。
- 唯一写入文件为本文件 `.agentdev/work/WP-02/review.md`；实验脚本独立写在 `/tmp/wp02-r3/`（`fixture.mjs`、`exp1-events.mjs`…`exp8-gaps.mjs`、`all.log`），使用 `pnpm build` 产出的 `packages/*/dist`，等价复现 `join.test.ts`/`orchestrator.test.ts` 的夹具，并通过 `/tmp/wp02-r3/node_modules/@agentdev/*` 软链解析 workspace 包。
- 未修改产品代码、测试、`docs/**`、`plan.md`、`implementation.md`、`discovery.md`；`pnpm build` 只写 `.gitignore` 中的 `dist/`，复核结束时 `git status --porcelain` 仍无输出。
- 第二轮完整报告可通过 `git show a8daa6d:.agentdev/work/WP-02/review.md` 取回。
