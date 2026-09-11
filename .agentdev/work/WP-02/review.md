# WP-02 独立 Review 报告（第五轮）

- 评审对象：工作包 WP-02「主管与独立Agent调度」
- 评审轮次：**第五轮**（逐条复核第四轮 Q-01..Q-10 与对抗性核验 H-01..H-03 是否真修，并找新问题）
- 冻结点：git `5a87a86`（`fix(core): WP-02 review round 4 findings (Q-01..Q-10, H-01..H-03)`），前置 `411d04f`
- HEAD 校验：`git rev-parse HEAD` = `5a87a867335201226f25b4a00e46ad8764ada3ff`
- 工作树：复核开始时与写入本报告前 `git status --porcelain` 均无输出（`pnpm build` 只写被 `.gitignore` 忽略的 `dist/`）
- 评审角色：Review（独立上下文，未读取任何开发对话；只依据仓库文件、git 对象与实跑命令）
- 权威依据：`docs/rules/{workflow,agents}.md`、`docs/architecture/{data,protocol,reliability,context,ARCHITECTURE}.md`、`docs/delivery/{implementation,acceptance}.md`（WP-02 与 AC-043/044/045/046/047/082）、`.agentdev/work/WP-02/{plan,implementation,discovery}.md`
- 方法：回到代码逐行核对，另在 `/tmp/wp02-r5/` 自建脚本（`fixture.mjs`、`exp-a.mjs`、`exp-b.mjs`）用 `pnpm build` 产出的 `packages/*/dist` 独立复现，共 21 组实验（含 12 组对抗性探针）；**不修改产品代码、测试、`docs/**`、plan/implementation/discovery**。
- 工具：`node v24.8.0`、`pnpm 12.3.4`

---

## 0. 历史轮次结论摘要（保留）

**第一轮（冻结点 `785bdd6`）判 FAIL：1×P1、5×P2、7×P3（R-01..R-13）。**
P1＝`stage.submit` 无终态/epoch 守卫；P2＝「父等待可接消息」证据空洞、`joinPolicy=none` 未实现、持久事件名偏离 `protocol.md` §7、越界写入 Plan、`run.ts` 快照引用改哈希与 `data.md` 冲突；P3＝R-07..R-13。完整报告：`git show c4763d5:.agentdev/work/WP-02/review.md`。

**第二轮（冻结点 `c4763d5`）判 FAIL：0×P1、5×P2、6×P3（N-01..N-11）。**
确认 R-05/R-09/R-10/R-11/R-12 修好；R-01/R-03/R-04/R-07/R-08/R-13 部分修复；R-02 证据无效。N-01＝`contract_violation` 终态不释放预算；N-02＝非 running 状态仍接受交付；N-03＝自造 Join 事件名仍在发出；N-04/N-05＝「父等待可接消息」测试无区分力、终态父 Run 仍可接收新子 Run；N-06＝重算重复写 `chief_action_required`；N-07＝阻断事件 data 结果契约不全；N-08＝二次 Schema 失败在 `paused` 抛错；N-09＝引用不存在的 DC-38；N-10＝超预算返回 `CONSTRAINT_VIOLATION`；N-11＝`data.md` 与代码的快照引用类型冲突（Product Decision Pending）。完整报告：`git show a8daa6d:.agentdev/work/WP-02/review.md`。

**第三轮（冻结点 `a8daa6d`）判 FAIL：1×P1、2×P2、2×P3（M-01..M-05）＋对抗性核验 D1..D5。**
N-01..N-10 全部经独立实跑确认修好；M-01（P1）＝父 Run 级预算预留从不释放；M-02（P2）＝预算只预留/释放不核销；M-03（P2）＝`Work blocked(provider)` 未落地；M-04（P3）＝阻断事件缺 `readLedgerSeq/Hash`；M-05（P3）＝`request_dispatch` 无幂等键。对抗性核验补出 D1..D5。完整报告：`git show 411d04f:.agentdev/work/WP-02/review.md`。

**第四轮（冻结点 `411d04f`）判 FAIL：0×P1、3×P2、7×P3（Q-01..Q-10）＋对抗性核验 H-01..H-03。**
M-01/M-04、D1/D2/D3/D4 经实跑确认修好，M-02/M-05 主体修复但各留一个 P2 缺口（即本轮 Q-03/Q-01），M-03 按 DC-42 降级为显式缺口；新 Q-01（`operationId` 只按键去重不校验载荷）、Q-04（父 Chief Run 可在 `join=all` 子 Run 未终态时被结算）为本包必修。完整报告：`git show 5a87a86:.agentdev/work/WP-02/review.md`。

> **追溯口径更正（采纳 DC-47）**：D1..D5 **不是第三轮 Review 报告里的条目**（第三轮报告只有 M-01..M-05）；它们来自第三轮的对抗性核验与开发方修复提交/DC 记录，第四轮报告把它们当作「第三轮条目」逐条复核属口径不准确，本轮沿用 `implementation.md:90` 的更正。同理，H-01..H-03 也不是第四轮 Review 报告（`review.md` 第四轮章节）中的条目，本轮只能依据开发方在 T12/DC 中的登记核对。
>
> **关键记录事实（本轮新增）**：`H-03` 在整个仓库（HEAD 树 + 全部提交对象）**只有 `implementation.md:89` 一句汇总提及，没有任何定义或处置描述**。第四轮无法核对 D5（Q-10），本轮无法核对 H-03（R5-14），同一记录模式连续两轮复现。

---

## 1. 本轮结论

**FAIL（Review Failed）——第四轮 Q-01..Q-10、H-01..H-03 中，仅 Q-03、Q-09、Q-10(D5→DC-46)、H-02 经独立实跑确认修好；Q-01、Q-04、Q-07、H-01 只算部分修复，Q-02、Q-05、Q-08 未修，Q-06 仍是待产品确认缺口，H-03 仓库内无定义无法核对。本轮另发现 14 条新问题（5×P2、9×P3），其中 5 条 P2 为本包必修，且**其中两条正是上一轮两个必修项（Q-01/Q-04）的残留**。**

- **逐条复核（§3、§4）**：
  - **已修（verified）**：Q-03（未测量即保持预留 + `costKnown=false` + `reconcile` 核销，与 `reliability.md` §3 一致；EXP-A3/B9）；Q-09（`plan.md` planVersion 3 已补 `run-lifecycle.ts`/`events.ts`，与 `git diff --name-only b9df25e..HEAD -- packages apps` 的 18 个文件全部吻合）；Q-10/D5（DC-46 已登记「dispatch 不校验 `work.status`」，EXP-A10/B8 实测 `blocked/paused/cancelling/completed/cancelled` 五种 Work 状态全部可建立 Chief Run，与 DC 一致）；H-02（`run.ended` 四条终态路径均含 `outcome/usageMeasured/costKnown/tokensUsed/releasedTokens`，与 DC-48 一致；EXP-H2）。
  - **部分修复**：**Q-01**（同键不同 `goal/role/请求者` 会 `IDEMPOTENCY_CONFLICT`，但同键不同 `reason/sourceRefs/requiredOutputs/requiredChild/budgetAllocation` 仍静默返回旧游标且不新增事件；EXP-A1/B5）；**Q-04**（`completed`/`failed` 被 `INVALID_STATE` 拒绝、`lifecycle.cancel` 正确向子 Run 传播，但公开入口 `settleRun(parent,'cancelled')` 绕过守卫，父 Run 被取消而 `join=all` 子 Run 仍存活；EXP-A4/B7）；**Q-07**（`config.ts:366-373` 已改正，但 `orchestrator.ts:352`、`model-gateway.ts:8` 仍称 Work 被 blocked）；**H-01**（`requestDispatch` 内新增 Chief 可行动性校验有效，但 `join.ts` 的 `pageChief`/`onChildSettled` 仍会把 `fire_and_forget_child_failed` 待办写给已终态 Chief；EXP-B4）。
  - **未修**：**Q-02**（实测用量超过 Work 限额时 `settle`/`reconcile` 抛 `CONSTRAINT_VIOLATION`，事务回滚后 Run 永久停在 `running`、预留不释放、无终态事件；EXP-A2/A2b）；**Q-05**（实测用量下 `releasedTokens` 仍是整笔 allocation；EXP-A5）；**Q-08**（`JoinCoordinator.state()` 在 `blocked` 时 `chiefTodo` 仍为 `''`；EXP-A8）；**Q-06**（父 Run 额度上限仍只存在于 DC-40/DC-47，未进入任何权威契约；EXP-A6）。
  - **H-03**：仓库内无定义，无法核对（R5-14）。
- **新问题（§5）**：**R5-01**（P2，Q-01 残留：`operationFingerprint` 漏字段，同键不同请求静默丢失）；**R5-02**（P2，Q-04 残留：`settleRun(...,'cancelled')` 绕过 live-children 守卫，制造无人处理的 Gate 阻断）；**R5-03**（P2，Q-02：终态不可达 + 预留永久占用，现已落在 DC-45 文档化的 WP-10 核销路径上）；**R5-04**（P2，`reconcile` 不幂等：重复核销会二次计费并吃掉**其他** Run 的预留——`reliability.md` §3「防止双花」）；**R5-05**（P2，H-01 残缺：`pageChief` 不校验父 Run 可行动性，`join=none` 子 Run 失败会给已终态 Chief 写待办）；以及 R5-06..R5-14（P3）。
- **判定**：按 `workflow.md` §6「P0/P1 阻断；P2/P3 由 Review 说明是否影响验收」，本轮**无 P1**，但 **R5-01 影响 AC-045 与 `protocol.md` §1 的写命令幂等语义，R5-02 影响 AC-046 的 Join/取消语义，R5-03/R5-04 影响 `reliability.md` §3 的预算核销与终态可达性，R5-05 影响 AC-045 待办可行动性**，全部落在本包关联验收与 WP-02 代码内，且修复成本低。**结论：本包仍不具备进入独立 Test 的条件**，须先返工 5 条 P2；Q-05/Q-06/Q-07/Q-08 与 R5-06..R5-14 可随返工一并处理或在结算材料中显式登记。
- 第三轮 N-11（`data.md` 的 `ID` 记法 vs 代码哈希）仍是 **Product Decision Pending**，未消解。

---

## 2. 验证命令与原始结果

环境：`export PATH="$HOME/.local/bin:$PATH"`，工作目录 `/Users/huyaohua/huyh/work/aigrouptool`，全部在 `5a87a86`、干净工作树上执行。原始日志：`/tmp/r5-cmds.log`（六条命令顺序执行，含退出码）。`node v24.8.0`、`pnpm 12.3.4`。

| 命令 | 退出码 | 关键原始输出 |
|---|---|---|
| `pnpm typecheck` | 0 | `$ tsc -p tsconfig.json --pretty false`（无错误输出） |
| `pnpm lint` | 0 | `Checking formatting...` / `All matched files use Prettier code style!` |
| `pnpm test:unit` | 0 | `Test Files  17 passed (17)` / `Tests  216 passed (216)`（与 T12 自述的 216 一致） |
| `pnpm test:integration` | 0 | `Test Files  10 passed (10)` / `Tests  124 passed (124)`（含真实 Docker 容器与 doctor 集成用例，未回退） |
| `pnpm docs:check` | 0 | `docs:check ok — 15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages` |
| `pnpm build` | 0 | `packages/contracts|domain|storage|core|pi-runtime|apps/cli|apps/runner build: Done`（7 个 workspace 全部 Done） |

`git log --oneline -3`：

```
5a87a86 fix(core): WP-02 review round 4 findings (Q-01..Q-10, H-01..H-03)
411d04f fix(core): WP-02 review round 3 findings (M-01..M-05, D1..D5)
a8daa6d fix(core): WP-02 review round 2 findings (N-01..N-10)
```

`git status --porcelain`：无输出（写入本报告前）。`pnpm test:e2e|acceptance|live` 仍按契约 `NOT_IMPLEMENTED`，未执行。

### 2.1 本轮独立实验日志

- `/tmp/wp02-r5/exp-a.log`（Q-01..Q-10、H-01/H-02：A1..A10、H1、H2）
- `/tmp/wp02-r5/exp-b.log`（对抗性：B1 `reconcile` 不幂等、B2 已核销 Run 再核销、B3 `costKnown` 回翻、B4 `join=none` 孤儿待办、B5 Q-01 最小复现、B6 取消后预留累积、B7 三终态对照、B8 终态 Work 分派、B9 未测量预留聚合）

**实验卫生说明**：进入实验前发现工作区 `packages/core/dist` 是 `5a87a86` 之前的旧产物（`dist/run-lifecycle.js` 无 `reconcile`、`dist/orchestrator.js` 无 `fingerprint`，mtime 11:28 < 源码 11:33），因此先执行 `pnpm build` 再取 `dist` 做实验；`dist/` 被 `.gitignore` 忽略，不属产品代码改动。

---

## 3. Q-01..Q-10 逐条复核表

| 条目 | 四轮严重度 | T12 修复声明（5a87a86） | 复核判定 | 独立实验证据（`/tmp/wp02-r5/`） |
|---|---|---|---|---|
| **Q-01** `operationId` 只按键去重 | P2 | 加入载荷指纹，同键不同请求（含不同请求者/goal/role）返回 `IDEMPOTENCY_CONFLICT` | **部分修复（→ R5-01）** | EXP-A1：同键同 + 不同 goal → `IDEMPOTENCY_CONFLICT`（控制组成立）；同键但改 `reason('COMPLETELY DIFFERENT REASON')`+`sourceRefs(id:ZZZ)`+`requiredOutputs(['something-else'])`+`budgetAllocation(99000)`+`requiredChild(true)` → **`OK`，返回旧游标 `"3"`，不新增事件**；`op-shared` 事件只有 1 条，`requestReason='r1'`、`sourceRefs=[a1]`。EXP-B5 最小复现（仅改 reason/sourceRefs）同样静默。指纹字段见 `orchestrator.ts:498-505`（缺 `reason/sourceRefs/requiredOutputs/requiredChild/budgetAllocation`）。 |
| **Q-02** 超限 usage 卡死结算 | P3 | T12 **未提及** | **未修复（→ R5-03）** | EXP-A2：`tokenLimit=100000`、Run `budgetAllocation=40000`、`settle(run,'completed',{tokensUsed:120000,measured:true})` → `CONSTRAINT_VIOLATION: budget update failed its contract schema: tokens used + reserved exceeds the limit`；回滚后 Run 仍 `running`、`tokensReserved=40000`、`tokensUsed=0`、`run.ended` 计数 0。EXP-A2b：先未测量结算再 `reconcile(120000)` → 同样抛错，Run 永久停在「已终态但未核销」。 |
| **Q-03** 未测量即全额释放 | P2 | 未测量一律保持预留并置 `budget.costKnown=false`；新增 `reconcile` | **已修复（verified）** | EXP-A3：未测量结算后 `reserved=30000`、`used=0`、`costKnown=false`，`run.ended` = `{tokensUsed:0,usageMeasured:false,costKnown:false,releasedTokens:0}`；`reconcile({tokensUsed:25000,cost:0.5})` 后 `reserved=0`、`used=25000`、`costKnown=true`、`cost=0.5`。B6/B9 与 `reliability.md` §3 语义一致。 |
| **Q-04** 父 Run 提前结算 | P2 | `end` 拒绝「仍有 `join=all` 未终态子 Run」的终态；`cancel` 向下传播 | **部分修复（→ R5-02）** | EXP-A4a/B7：`settleRun(parent,'completed')` 与 `'failed'` 均 `INVALID_STATE: still has 1 live join=all children`，父保持 `running`。EXP-A4c：`lifecycle.cancel(parent)` → 父子均 `cancelled`。**但 EXP-A4b/B7：`settleRun(parent,'cancelled')` 成功，子 Run 仍 `queued`**；父 `cancelled` 后子 Run 结算 → `onChildSettled` 返回 `blocked`、写出 `chief_action_required`（1 条）给已终态父 Run。 |
| **Q-05** `releasedTokens` 语义 | P3 | T12 **未提及** | **未修复（→ R5-08）** | EXP-A5：`allocation=30000`、`usage=25000` → `run.ended.data={tokensUsed:25000,releasedTokens:30000}`，`released+used=55000>allocation`。`orchestrator.test.ts:597` 只断言 `usageMeasured/tokensUsed`，不覆盖该字段。 |
| **Q-06** 父 Run 额度口径未入契约 | P3 | T12 未提及；DC-47 登记为「本包实现约定，需产品方确认」 | **按记录处置（缺口仍在）** | EXP-A6：`Work.tokenLimit=1000000`、父 `budgetAllocation=5000`，派发 50000 子 Run → `BUDGET_EXCEEDED: live children of Run … hold 0 of 5000 tokens`（0 个在场子 Run 却判定超限），父下无子 Run。`data.md`/`agents.md`/`reliability.md` 均无「父 Run 额度=在场子 Run 之和」明文（DC-40/DC-47）。 |
| **Q-07** 注释仍称 Work `blocked(provider)` | P3 | 「源码注释不再声称 Work 级 `blocked(provider)`（DC-42）」 | **部分修复（→ R5-13）** | `config.ts:366-373` 已改为「The Work-level `blocked(provider)` projection is WP-05 (DC-42)」；但 `orchestrator.ts:352` 仍是「A Work whose role has no usable model is blocked, never queued on a guess.」，`model-gateway.ts:8` 仍是「a Work whose role has no usable model is blocked instead of silently falling back」。EXP-A3（第四轮）已证 Work 保持 `running`、`blockerIds=[]`。 |
| **Q-08** `state()` 的 `chiefTodo` 为空 | P3 | T12 未提及（`join.ts` 本轮未改动：`git diff 411d04f..5a87a86 --stat` 无 `join.ts`） | **未修复（→ R5-07）** | EXP-A8：同一父 Run，`onChildSettled` 返回 `{kind:'blocked',chiefTodo:'6'}`，`state()` 返回 `{kind:'blocked',chiefTodo:''}`（`join.ts:146`）。 |
| **Q-09** 新文件越出 plan writePaths | P3 | `plan.md` 升 planVersion 3，补入 `events.ts`、`run-lifecycle.ts` | **已修复（verified）** | `plan.md:3` `planVersion: 3`；`:25`/`:26` 分别补入 `run-lifecycle.ts` 与 `events.ts`，`:35` 记录授权来源。`git diff --name-only b9df25e..HEAD -- packages apps` 的 18 个文件全部在 writePaths 内，无新增越界文件。 |
| **Q-10** 记录不自洽 / D5 无定义 | P3 | 「D5（dispatch 不校验 Work 状态）登记 DC-46」；T5 旧事件名更正 | **已修复（verified）** | `discovery.md:116-118` DC-46 存在；EXP-A10：`Work.status ∈ {blocked,paused,cancelling,completed,cancelled}` 时 `dispatch(chiefSpec)` 全部 `OK → queued`（DC 描述成立，且比 DC 正文举例更宽，见 R5-11）。T5（`implementation.md:39`）已无旧 Join 事件名。**但 H-03 无定义（R5-14）**。 |

**小结**：Q-03/Q-09/Q-10 完全修复；Q-01/Q-04/Q-07 部分修复；**Q-02/Q-05/Q-08 未修复**；Q-06 为已登记缺口。第四轮的「文档声称已修而代码不符」在本轮**再次出现**：Q-07（注释）、Q-10 之外的 H-01/H-02 声明也有超出实现的措辞（见 §4 与 R5-05/R5-10）。

---

## 4. H-01..H-03 逐条复核表

> 前置事实：`H-01`/`H-02` 仅由 `implementation.md:95-96`（T12）与 `discovery.md:124`（DC-48，只对应 H-02）定义；`H-03` 全仓无定义（`git grep -n "H-03" HEAD` 仅命中 `implementation.md:89` 的汇总句）。第四轮 `review.md` 章节中没有 H-01..H-03。

| 条目 | 开发方描述 | 复核判定 | 独立实验证据 |
|---|---|---|---|
| **H-01** 终态 Chief 不再被塞入无人处理的待办 | `requestDispatch` 同时校验 Chief Run 可行动性 | **部分修复（→ R5-05、R5-09）** | EXP-H1：新请求 → `INVALID_STATE: Chief Run … is completed and cannot take a new dispatch request`（修复生效）。EXP-A4b：经 `settleRun(parent,'cancelled')` 制造的终态 Chief，其子 Run 结算后仍写出 1 条 `chief_action_required`。EXP-B4：`join=none` 子 Run 在父 Run 结算后失败 → `onChildSettled` 返回 `{kind:'ready'}`，却写出 1 条 `chief_action_required(reason='fire_and_forget_child_failed')` 给已 `completed` 的 Chief。EXP-H1：对已受理请求的同键重放（Chief 已终态）抛 `INVALID_STATE` 而非返回原结果。 |
| **H-02** `run.ended` 两条终态路径 data 形状统一 | 均含 `outcome/usageMeasured/costKnown/tokensUsed/releasedTokens` | **已修复（按声明，verified；另见 R5-10）** | EXP-H2：四条路径实测 keys：measured settle / unmeasured settle / `reconcile` 均含 `workId`；`contract_violation` 含全部五个声称字段但**独缺 `workId`**，另带 `attemptId/reason/rejections`（与 DC-48 描述一致）。四条终态路径中 **3 条 `run.ended` 的 `entityVersion` 相同（v4）**，其中 `reconcile` 追加的同版本事件与首次终态事件无法按 `(entityId,entityVersion)` 排序。 |
| **H-03** 无仓库定义 | 无 | **无法核实（→ R5-14）** | `git grep -n "H-03" HEAD` 只命中 `implementation.md:89`；`discovery.md` 的 DC-45..DC-48 均不涉及 H-03；提交信息只描述 H-01/H-02 的行为。第四轮的 D5 模式（Q-10）在本轮复现。 |

---

## 5. 新 Findings（R5-01..R5-14）

### R5-01 [P2] `operationId` 指纹漏字段：同键不同请求仍被静默吞掉

- 位置：`packages/core/src/orchestrator.ts:167-187`（`operationFingerprint` 只含 `requestedBy/role/purpose/goal/stage/workId`）、`:498-505`、`:506-538`（命中即按重放返回旧游标）。
- 事实（EXP-A1/B5）：同 `operationId`、同请求者/角色/purpose/goal/stage，仅 `reason`、`sourceRefs`、`requiredOutputs`、`requiredChild`、`budgetAllocation` 不同 → 返回旧游标、事件不新增、无错误。事件里记录的仍是**第一次**请求的 `requestReason/sourceRefs`，第二个请求永久丢失。
- 依据：`protocol.md` §1「幂等键同载荷返回原结果；**同键不同载荷拒绝**」；§7 错误表 `IDEMPOTENCY_CONFLICT`。
- 影响：AC-045 的重试/复用键场景会漏请求且无诊断；T12 的措辞「同键不同请求…返回 `IDEMPOTENCY_CONFLICT`」超出实现。
- 建议：指纹纳入全部可影响结果的入参（至少 `reason/sourceRefs/requiredOutputs/requiredChild/budgetAllocation`，或对整个规范化入参取哈希）；把去重查询与 `append` 放进同一事务。

### R5-02 [P2] `settleRun(runId,'cancelled')` 绕过 live-children 守卫：取消不传播，制造无人处理的 Gate 阻断

- 位置：`packages/core/src/run-lifecycle.ts:213-222`（`requireNoLiveChildren` 在 `status === 'cancelled'` 时直接 `return`，与「谁进入终态」无关）、`:137-143`（`settle` 的 `TerminalRunStatus` 含 `'cancelled'`）、`:230-247`（只有 `cancel()` 才向子 Run 传播）、`packages/core/src/orchestrator.ts:629-635`（公开入口 `settleRun` 三个状态都可传）。
- 事实（EXP-A4b/B7）：父 Chief Run 有 1 个 `join=all`、`requiredChild=true` 的 `queued` 子 Run；`settleRun(parent,'completed')`/`'failed'` 被拒，但 `settleRun(parent,'cancelled')` **成功**，子 Run 仍 `queued`；随后子 Run `settleRun(child,'failed')` → `joins.onChildSettled(child)` 返回 `kind:'blocked'`，写出 `chief_action_required(entityId=parent(已 cancelled))`。
- 依据：`agents.md` §3「父Run取消传播未终态子Run」；AC-046「相关Gate阻断；新Chief消息可处理」；第四轮 Q-04 的原始不变式。
- 影响：与 Q-04 同类、同严重度，只是走了另一个公开入口；调用方（WP-05 监督）用 `settleRun(...,'cancelled')` 表达取消是自然写法。
- 建议：`end` 不再按目标状态放行——取消语义只允许经 `cancel()`（或让 `end` 在 `status==='cancelled'` 时先执行与 `cancel()` 相同的向下传播），并把守卫写成「任何非 `cancel()` 路径都不得留下未终态 `join=all` 子 Run」。

### R5-03 [P2] 实测用量超过 Work 限额时结算/核销仍永久卡死（Q-02 未修，且落在文档化的 WP-10 核销路径上）

- 位置：`packages/core/src/run-lifecycle.ts:177-204`（`end` 先 `release` 再 `charge`）、`:297-308`（`charge` 直接 `budget.tokensUsed + tokensUsed`，无 `canAllocateBudget` 判定）；不变式见 `packages/contracts/src/entities/run.ts:184-188`。
- 事实（EXP-A2/A2b）：`tokenLimit=100000`、`Run.budgetAllocation=40000`，`settle(...,{tokensUsed:120000,measured:true})` → `CONSTRAINT_VIOLATION`；事务回滚后 Run 停在 `running`、`reserved=40000`、`used=0`、无 `run.ended`。`reconcile` 走同一 `charge`，同样抛错，Run 停在「已终态但 `costKnown=false`、预留不释放」。
- 依据：`reliability.md` §3（核销路径必须可用；预算变化超限应给出明确错误而非 Schema 约束错误）；`workflow.md` §5.3（终态必须可达）。第四轮 Q-02 为 P3（当时无生产用量来源）；本轮 **Q-03 的修复使 `reconcile` 成为 DC-45 明确指定的核销入口**，因此该缺陷不再是纯潜伏——只要 WP-10 传入真实 usage，任何超预留调用都会把一个 Run 永久挂住，同时占用 Work 预算直至人工介入。
- 建议：`charge`/`reconcile` 前置 `canAllocateBudget` 判定并返回 `BUDGET_EXCEEDED`；或对超预留部分截断并显式记 `costKnown=false`；补「超预留 usage 结算后 Run 仍进入终态且预留被处理」的必需测试。`charge` 的 JSDoc「the measured usage is at most it」（`:294-295`）是没有守卫的假设。

### R5-04 [P2] `reconcile` 不幂等：二次核销会二次计费并吃掉其他 Run 的预留

- 位置：`packages/core/src/run-lifecycle.ts:256-283`（无「本 Run 是否已核销」判定、无 `operationId`、无 `reconciled` 标记落库）、`:265-266`（无条件 `release(run.budgetAllocation)` + `charge(usage.tokensUsed)`）、`:79-88`（`release` 只做 `max(0, reserved-allocation)`，不校验预留归属）。
- 事实（EXP-B1）：Run A（10k）未测量结算后 hold=10k、`costKnown=false`，Run B（10k）在场（Work `reserved=20000`）。`reconcile(A,{tokensUsed:1000})` → `reserved=10000, used=1000`；**再次 `reconcile(A,{tokensUsed:1000})` 成功** → `reserved=0, used=2000`，**此时 Run B 仍在场并持有 10k，但 Work 的 `tokensReserved` 已被扣成 0**（后续 B 结算/核销时 `release` 会因 `reserved===0` 提前返回）。EXP-B2：对一个**已按实测结算**的 Run 再 `reconcile` → `used` 从 5000 变 10000。EXP-B1 另显示同一 Run 产生 3 条 `run.ended`，`entityVersion` 全为 v4（Run 版本未变）。
- 依据：`reliability.md` §3「并行调用共享Work预算事务，**防止双花**」；§1「Outbox以operationId至少一次投递…避免重复创建」，无幂等证明的副作用应进入 `recovery_required`；`protocol.md` §1 幂等规则。
- 影响：预算账面失真（少记在场预留）→ 可被后续派发超发；费用可被重复计入。这是本轮最严重的正确性问题。
- 建议：`reconcile` 要求/记录幂等键（`operationId`）或核销状态；已完成核销的 Run 重放时返回原结果，冲突时 `IDEMPOTENCY_CONFLICT`；`release` 只对确实存在的该 Run 预留生效（例如按 Run 维度记账，或校验 `reserved >= allocation` 否则 fail-closed）。

### R5-05 [P2] `join=none` 子 Run 失败仍会给已终态 Chief 写待办（H-01 只修了 `requestDispatch` 一个入口）

- 位置：`packages/core/src/join.ts:189-194`（`lostFireAndForget` 直接调用 `pageChief`）、`:225-242`（`pageChief` 不校验 `parent.status`）、对照修复点 `packages/core/src/orchestrator.ts:487-495`。
- 事实（EXP-B4）：父 Chief Run（`join=none` 子 Run 在场）`settleRun(parent,'completed')` 成功；子 Run 随后 `failed` → `onChildSettled` 返回 `{kind:'ready'}`（返回结构里完全没有这次失败），同时写出 1 条 `chief_action_required(reason='fire_and_forget_child_failed', entityId=已 completed 的 Chief)`。
- 依据：H-01 自身的原则「A todo is only actionable while its Chief Run can still dispatch」（`orchestrator.ts:487-488`）；AC-045/AC-046「新 Chief 消息可处理」。
- 影响：与 R5-02 同一类「无人处理的待办」，只是路径是 `join=none`。注意 `join=none` 的语义允许父 Run `completed`（`agents.md` §3），所以修法应是 `pageChief`/`onChildSettled` 不再向不可行动父 Run 写待办（并让返回值如实反映失败），而不是禁止父 Run 结算。
- 建议：`pageChief` 增加与 H-01 相同的父 Run 可行动性判定；不可行动时把失败记入事件/返回值但不产生 Chief 待办（或登记为 `lostFireAndForget`）。

### R5-06 [P3] Work 级 `costKnown` 会被后续任一实测结算回翻为 `true`，抹掉尚存的未知成本

- 位置：`packages/core/src/run-lifecycle.ts:303`（`charge` 无条件写 `costKnown: true`）、`:285-289`（`markCostUnknown`）、`:180-189`（未测量分支只 `markCostUnknown`）。
- 事实（EXP-B3）：Run A 未测量结算 → Work `costKnown=false`、hold=10k；Run B 实测结算（usage=1000）→ Work `costKnown=true`，而 A 的未知预留仍在。此后任何读取 Work 成本的一方都会得到「成本已知」的错误结论。
- 依据：`reliability.md` §3「未知usage保持预留并**标 costKnown=false**」；该字段是 Work 级账（`packages/contracts/src/entities/run.ts:181`）。
- 建议：`costKnown` 只能由「所有持有未知预留的 Run 都完成核销」来置真（例如按未核销 Run 数派生），或把该字段的聚合语义写入 `data.md` 后再实现。

### R5-07 [P3] `JoinCoordinator.state()` 在 `blocked` 时仍返回空 `chiefTodo`（Q-08 未修）

- 位置：`packages/core/src/join.ts:145-147`（`{kind:'blocked', …, chiefTodo:''}`）对 `:201-208`（`onChildSettled` 返回真实游标）。
- 事实（EXP-A8）：同一父 Run，`onChildSettled` → `chiefTodo:'6'`，`state()` → `chiefTodo:''`。
- 建议：`state()` 复用 `pageChief` 的查重结果返回既有游标（不发新事件），或把 `chiefTodo` 改为可选并在类型/文档中说明 `state()` 不产生待办。

### R5-08 [P3] `run.ended.data.releasedTokens` 在实测用量下仍是整笔 allocation（Q-05 未修）

- 位置：`packages/core/src/run-lifecycle.ts:199`、`:278`。
- 事实（EXP-A5）：`allocation=30000`、`usage=25000` → `releasedTokens=30000`，`released+used=55000>allocation`。按 `reliability.md` §3「扣除实际usage并释放剩余」的字面语义应为 5000；按 `protocol.md` §7「data包含变更后实体摘要」，消费方按 `released+used` 记账会高估释放量。
- 建议：记 `allocation - tokensUsed`，或改名为 `reservedTokens`/`allocation` 消歧并同步文档。

### R5-09 [P3] 已受理请求的同键重放在 Chief 转为终态后变为 `INVALID_STATE`，而非返回原结果

- 位置：`packages/core/src/orchestrator.ts:478-495`（Chief 可行动性校验）在 `:506-538`（`operationId` 去重）**之前**执行。
- 事实（EXP-H1）：`op-h1` 首次受理成功（游标 `"3"`）；把 Chief 置为 `completed` 后重放同键同载荷 → `INVALID_STATE: Chief Run … cannot take a new dispatch request`。
- 依据：`protocol.md` §1「幂等键同载荷返回原结果」、§7 错误表「应答丢失先查同幂等键结果」；`reliability.md` §1「至少一次投递」。重放不是新请求，不应因实体后来变终态而失败；H-01 的守卫应在重放判定之后生效。
- 建议：先做 `operationId` 命中判定（同载荷 → 返回原结果，异载荷 → `IDEMPOTENCY_CONFLICT`），再对「新请求」做 Chief 可行动性校验。

### R5-10 [P3] `run.ended` data 形状仍未完全统一，且 `reconcile` 复用同一 `entityVersion`

- 位置：`packages/core/src/run-lifecycle.ts:142`（`settle` 的 data 含 `workId`）、`:156-161`（`contractViolation` 的 data **无** `workId`）、`:271-279`（`reconcile` 含 `workId` 但 `entityVersion: run.version` 未变）。
- 事实（EXP-H2）：`contract_violation` 的 `run.ended` 缺 `workId`（其余三条都有）；同一 Run 出现 2~3 条 `run.ended` 而 `entityVersion` 全为 v4（EXP-A3/B1）。
- 依据：`protocol.md` §7「Event={…,entityId,entityVersion,data}」「data包含变更后实体摘要」；DC-48 自称「data 形状统一」。
- 建议：把 `workId` 提为所有终态路径的公共字段；核销事件用新的实体版本或独立事件名/字段（与 R5-04 一并解决）。

### R5-11 [P3] DC-46 的正文比实测窄：终态 Work（`completed`/`cancelled`）同样可建立新 Run

- 位置：`packages/core/src/orchestrator.ts:305-347`（`dispatch` 全程不读 `work.status`）；登记处 `discovery.md:116-118`（DC-46 只举例 `blocked`/`paused`）；规则 `docs/rules/workflow.md` §5.1（`queued→running→completed`；「完成后追问创建关联新Work」）。
- 事实（EXP-A10/B8）：`Work.status ∈ {blocked,paused,cancelling,completed,cancelled}` 时 `dispatch(chiefSpec)` 均成功建 Run；`completed` Work 下还可派发专业子 Run。
- 判定：DC-46 的标题「dispatch 不校验 `work.status`」已覆盖该事实，承接包 WP-05 亦已登记，故**不是新的本包必修项**；但 DC 正文需要把终态 Work 写进去，否则承接方可能只实现 `blocked/paused`。
- 关联缺口：`data.md` 没有 `work_blocker` 表（`grep blocker docs/architecture/data.md` 仅命中 `work.blockerIds` 字段与 `CheckResult.status=blocked`），DC-42 所称「WorkBlocker 实体/状态投影属 WP-05」在 Schema 层也尚无落点，见 §6。

### R5-12 [P3] `run-lifecycle.ts` 的 JSDoc 与新行为直接矛盾（文档声称 vs 代码）

- 位置：`packages/core/src/run-lifecycle.ts:23-28`（仍写「`measured:false`…the amount is **still charged as zero** but the event records the distinction (**DC-41**)」）、`:128-136`（「only the **remainder** of the reservation is released」）、`:291-296`（「the measured usage **is at most it**」）。
- 事实：代码在 `measured:false` 时**不释放、不按零计费**并置 `costKnown=false`（DC-45，EXP-A3）；实测路径释放整笔 allocation（`:183`）而 `releasedTokens` 记整笔（`:199`）；`charge` 不校验 usage ≤ allocation（R5-03）。三处注释与 T12/DC-45 及代码均不一致，其中第一处还引用了被 DC-45 取代的 DC-41 口径。
- 建议：同步三处 JSDoc 到 DC-45 语义，并删除「at most it」这类无守卫假设。

### R5-13 [P3] Q-07 残留：两处源码注释仍声称 Work 级 `blocked(provider)`

- 位置：`packages/core/src/orchestrator.ts:352`（「A Work whose role has no usable model is blocked, never queued on a guess.」）、`packages/core/src/model-gateway.ts:8`（「a Work whose role has no usable model is blocked instead of silently falling back」）；对照 `packages/core/src/config.ts:366-373`（已改为指向 DC-42）。
- 事实：EXP-A3（第四轮）实测无可用模型时 Work 仍 `running`、`blockerIds=[]`、`work.control_changed`=0；DC-42 明言本包未实现 Work 级 blocked。T12 的「源码注释不再声称 Work 级 `blocked(provider)`」只对 `config.ts` 成立。
- 建议：两处注释改为「返回 `PROVIDER_UNAVAILABLE`、Run 不创建；Work 级 blocker 承接 WP-05（DC-42）」。

### R5-14 [P3] H-03 在仓库内无任何定义，第五轮无法逐条核对（记录完整性）

- 位置：`implementation.md:89,95-96`（提到 H-01..H-03，只描述 H-01/H-02）、`discovery.md:112-126`（DC-45..DC-48，只对应 H-02）。
- 事实：`git grep -n "H-03" HEAD` 仅命中 `implementation.md:89` 的汇总句；提交信息正文只列 H-01/H-02；无任何 blob 含 H-03 的 Finding 描述。第四轮的 D5（Q-10）问题在 H-03 上复现。
- 影响：第五轮的「逐条核对 H-01..H-03」在 H-03 上不可完成；Review 不能以开发方汇总句替代可核对的 Finding 描述（`workflow.md` §6）。
- 建议：在 `discovery.md` 补齐 H-03 的定义与处置（或明确宣告它不存在/已撤销），并修正 T12 的措辞。

---

## 6. 本包必修 vs 其他包显式缺口（承接核对）

| 事项 | 归属判定 | 承接登记核对 | 结论 |
|---|---|---|---|
| R5-01 `operationId` 指纹漏字段 | **本包必修（P2）** | — | AC-045 与 `protocol.md` §1 均在 WP-02 关联范围内 |
| R5-02 `settleRun(...,'cancelled')` 绕过守卫 | **本包必修（P2）** | — | AC-046 与 `agents.md` §3 取消传播 |
| R5-03 超限 usage 卡死 | **本包必修（P2）** | — | `run-lifecycle.ts` 为本包代码；终态可达性 |
| R5-04 `reconcile` 不幂等 | **本包必修（P2）** | — | 核销入口由本包引入；`reliability.md` §3 防双花 |
| R5-05 `join=none` 孤儿待办 | **本包必修（P2）** | — | H-01 的同一不变式，`join.ts` 为本包代码 |
| R5-06 `costKnown` 回翻 | **本包必修（P3）** | — | 字段写入方只有本包 |
| R5-07 `state().chiefTodo` | **本包必修（P3）** | — | Q-08 直接残留 |
| R5-08 `releasedTokens` | **本包必修（P3）** | — | 事件 data 由本包写 |
| R5-09 重放顺序 | **本包必修（P3）** | — | `protocol.md` §1 语义 |
| R5-10 `run.ended` 形状/版本 | **本包必修（P3）** | — | DC-48 自称本包约定 |
| R5-11 终态 Work 仍可 dispatch | 承接 **WP-05** | `discovery.md:116-118` DC-46（标题已覆盖，正文举例偏窄）；`docs/delivery/implementation.md` WP-05 输出为「ContextBuilder、ACL、Snapshot、read ledger、Checkpoint、预算」，**不含 Work 状态投影/WorkBlocker** | **DC 已登记但承接条目未确认**；且 `data.md` 无 `work_blocker` 表，Work 级 blocker 在 Schema 层亦无落点（DC-42 同） |
| R5-12 JSDoc 矛盾 | **本包必修（P3）** | — | 记录准确性问题 |
| R5-13 Q-07 残留注释 | **本包必修（P3）** | — | 上一轮 Finding 未闭环 |
| R5-14 H-03 无定义 | **本包记录缺陷（P3）** | — | 流程记录完整性 |
| Q-06/DC-40/DC-47 父 Run 额度口径 | 待产品确认的实现约定 | `discovery.md:89-91`（DC-40）、`:120-122`（DC-47） | **已登记，等待产品方决定**；未进入 `data.md`/`agents.md` |
| DC-42 Work `blocked(provider)` | 承接 **WP-05** | DC-42 声明 WP-05；WP-05 条目无该职责 | **承接归属存疑（与第四轮一致）** |
| DC-45 真实 usage 核销 | 承接 **WP-10** | DC-45 声明 WP-10；WP-10 条目「输出：实际演练、全部AC证据…」未显式提 usage/预算核销，但 AC-022/AC-045 在其 AC 列表内 | **承接可对应，但条目文字未点名**；建议结算前在 WP-10 条目补一句「Provider usage 读取与预算核销」 |
| DC-38 `runParams` 无授权来源 | 承接 **WP-04/WP-07** | `discovery.md:81-83` | 归属偏 WP-07，条目未提授权；后续包未启动 |
| DC-39 Join 无协议事件（读模型） | 承接 **WP-08** | `discovery.md:85-87` | 归属与 WP-08/WP-09 条目均不完全吻合，跨包风险 |
| N-11（RE-06）`data.md` `ID` vs 哈希 | **Product Decision Pending** | `discovery.md:72` 保留实现待确认 | 未消解前不得判 Completed |

补充事实：除 `.agentdev/work/{WP-00,WP-01,WP-02}` 外，承接包（WP-04..WP-10）均尚无独立过程记录目录，故「承接」目前只能由 DC 条目声明，无法在承接包侧交叉验证。

---

## 7. 未验证 / 无法验证项与剩余风险

1. **H-03 内容**：仓库无定义（R5-14），本轮无法逐条核对。
2. **真实并发**：全部实验为单线程。`requireBudget`/`canAllocateBudget` 在事务外判定；`requestDispatch` 的 `operationId` 去重也在事务外（`orchestrator.ts:506-538` 查到即 return，未与 `append` 同事务）；`release`/`charge` 按 Work 行记账、不区分 Run归属（R5-04 的放大器）。单 mailbox 串行下部分不可达，本轮未做真实并发压测。
3. **`reconcile` 的生产调用方**：DC-45 声明承接 WP-10，但当前全仓无调用方，也没有协议方法暴露核销；WP-10 若不实现，则所有未测量结算的预留（包括 `contract_violation`/`cancelled` 路径）永久占用 Work 预算，`reliability.md` §3「结果最终可查usage再核销」不可达（EXP-B6/B9：30k 限额下取消一对父子后无法再派发；100k 限额下 3 个 30k 未测量 Run 后第 4 个被拒）。
4. **消息级路由**：`ProjectMailbox` 仍不读 `subject`，无法在 mailbox 层验证「消息投递到等待中的父 Run」；区分力由 `dispatch` 的父状态校验提供（第三轮已证），消息按 Run 选处理器仍属 WP-05/WP-08。
5. **`beginAttempt` 无法恢复 `paused` Run**（第四轮 §7 项 5 未变）：`run-lifecycle.ts:99-104` 对 `paused` 抛 `VALIDATION_ERROR: cannot start from paused`，而 `domain/transitions.ts:127-130` 的 `runAcceptsNewAttempt` 把 `paused` 视为可新 Attempt。Checkpoint 恢复归 WP-05。
6. **`settleRun` 非幂等**：重复结算抛 `VALIDATION_ERROR`；WP-05 的 at-least-once 监督重放需 `operationId` 保证只调用一次。
7. **`timed_out` 终态不可达**：`TerminalRunStatus` 只含 `completed/failed/cancelled`，`contract_violation` 走专用路径；`timed_out` 无生产写入方（归 WP-05 监督），本轮未判为 Finding。
8. **真实 Provider 调用与 Secret**：`GatewayTransport`/`SecretResolver` 仍为注入缝（DC-31），AC-043「不同 Provider」仍只是结构验证。
9. **ContextBuilder/上下文内容与 token 计量**：`dispatch` 的 `contextPayload` 仍只有 fallback（`orchestrator.ts:370-378`），属 WP-06；AC-082 的工具层负例归 WP-07。
10. **`readLedgerHash` 真实性**：`stage.ts` 只做 64 位十六进制 Schema 校验，未与读账本核对（WP-05/WP-06）。
11. **事件消费者端到端兼容性**：R5-08/R5-10 的字段语义与 WS/BFF/UI（WP-08/WP-09）未实现，本轮只做协议/文档静态判定。
12. **`test:e2e`/`test:acceptance`/`test:live`**：按契约 `NOT_IMPLEMENTED`，未执行。
13. **结算未完成（T9 待办）**：`docs/INDEX.md:26-30` 仍只列 WP-00/WP-01 且称 Work/Run 编排「仍未实现」；`docs/delivery/acceptance.md` 无 WP-02 证据登记；`implementation.md:102-104` 仍留「## T9 待办」。本次 Review 只判定「实现是否成立」，不判定「结算是否完成」；在本轮 5 条 P2 关闭前也不应结算。
14. **N-11 产品决定**：`data.md` 的 `ID` 记法与代码哈希仍并存，属 `Product Decision Pending`。

---

## 8. 方法与边界声明

- 本报告只依据仓库文件、`5a87a86` 上的 git 对象/差异与实跑命令；未读取任何开发对话、未引用外部同名技能或历史方案。
- 唯一写入文件为本文件 `.agentdev/work/WP-02/review.md`；实验脚本独立写在 `/tmp/wp02-r5/`（`fixture.mjs`、`exp-a.mjs`、`exp-b.mjs`、`exp-a.log`、`exp-b.log`），使用 `pnpm build` 产出的 `packages/*/dist`，通过 `/tmp/wp02-r5/node_modules/@agentdev/*` 软链解析 workspace 包，等价复现 `orchestrator.test.ts`/`join.test.ts` 的夹具但**不 import 产品测试文件**。
- 未修改产品代码、测试、`docs/**`、`plan.md`、`implementation.md`、`discovery.md`；`pnpm build` 只写 `.gitignore` 中的 `dist/`。写入本报告前 `git status --porcelain` 无输出。
- 本报告覆盖了第四轮 `review.md`（`git show 5a87a86:.agentdev/work/WP-02/review.md` 可取回）；第一/二/三轮完整报告可分别通过 `git show c4763d5:…`、`git show a8daa6d:…`、`git show 411d04f:…` 取回。
