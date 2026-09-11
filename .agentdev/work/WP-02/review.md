# WP-02 独立 Review 报告（第六轮）

- 评审对象：工作包 WP-02「主管与独立Agent调度」
- 评审轮次：**第六轮**（逐条复核第五轮 R5-01..R5-14 与对抗性核验 M-1..M-4 是否真修，并找新问题）
- 冻结点：git `0211ced`（`fix(core): WP-02 review round 5 findings (R5-01..R5-14, M-1..M-4)`），前置 `5a87a86`
- HEAD 校验：`git rev-parse HEAD` = `0211ced97eea688f3f03d965f9c9ea5a56c32325`
- 工作树：复核开始时与写入本报告前 `git status --porcelain` 均无输出（`pnpm build` 只写被 `.gitignore` 忽略的 `dist/`）
- 评审角色：Review（独立上下文，未读取任何开发对话；只依据仓库文件、git 对象与实跑命令）
- 权威依据：`AGENTS.md`、`docs/INDEX.md`、`docs/rules/{workflow,agents}.md`、`docs/architecture/{ARCHITECTURE,data,protocol,reliability,context}.md`、`docs/delivery/{implementation,acceptance}.md`（WP-02 与 AC-043/044/045/046/047/082）、`.agentdev/work/WP-02/{plan,implementation,discovery}.md`
- 方法：回到代码逐行核对注释/记录声称，另在 `/tmp/wp02-r6/` 自建脚本（`fixture.mjs`、`exp-a..g.mjs`）用 `pnpm build` 产出的 `packages/*/dist` 独立复现，共 33 组实验（含 11 组对抗性探针）；**不修改产品代码、测试、`docs/**`、plan/implementation/discovery**。
- 工具：`node v24.8.0`、`pnpm 12.3.4`

---

## 0. 历史轮次结论摘要（保留，第一至五轮）

**第一轮（冻结点 `785bdd6`）判 FAIL：1×P1、5×P2、7×P3（R-01..R-13）。**
P1＝`stage.submit` 无终态/epoch 守卫；P2＝「父等待可接消息」证据空洞、`joinPolicy=none` 未实现、持久事件名偏离 `protocol.md` §7、越界写入 Plan、`run.ts` 快照引用改哈希与 `data.md` 冲突。完整报告：`git show c4763d5:.agentdev/work/WP-02/review.md`。

**第二轮（冻结点 `c4763d5`）判 FAIL：0×P1、5×P2、6×P3（N-01..N-11）。**
N-01＝`contract_violation` 终态不释放预算；N-02＝非 running 状态仍接受交付；N-03＝自造 Join 事件名仍在发出；N-04/N-05＝终态父 Run 仍可接收新子 Run；N-06＝重复写 `chief_action_required`；N-07＝阻断事件 data 契约不全；N-08＝二次 Schema 失败在 `paused` 抛错；N-09＝引用不存在的 DC；N-10＝超预算返回 `CONSTRAINT_VIOLATION`；N-11＝`data.md` 与代码的快照引用类型冲突（Product Decision Pending）。完整报告：`git show a8daa6d:.agentdev/work/WP-02/review.md`。

**第三轮（冻结点 `a8daa6d`）判 FAIL：1×P1、2×P2、2×P3（M-01..M-05）＋对抗性核验 D1..D5。**
M-01（P1）＝父 Run 级预算预留从不释放；M-02（P2）＝预算只预留/释放不核销；M-03（P2）＝`Work blocked(provider)` 未落地；M-04/M-05（P3）。D1..D5 来自第三轮对抗性核验（**不是**第三轮报告的条目；口径更正见 `implementation.md:90`）。完整报告：`git show 411d04f:.agentdev/work/WP-02/review.md`。

**第四轮（冻结点 `411d04f`）判 FAIL：0×P1、3×P2、7×P3（Q-01..Q-10）＋对抗性核验 H-01..H-03。**
Q-01（`operationId` 只按键去重不校验载荷）、Q-04（父 Chief Run 可在 `join=all` 子 Run 未终态时被结算）为本包必修。H-01..H-03 只由开发方 T12 登记描述，第四轮报告章节中没有这三条。完整报告：`git show 5a87a86:.agentdev/work/WP-02/review.md`。

**第五轮（冻结点 `5a87a86`）判 FAIL：0×P1、5×P2、9×P3（R5-01..R5-14）＋对抗性核验 M-1..M-4。**
- 完全修好：Q-03、Q-09、Q-10(D5→DC-46)、H-02。
- 部分修复：Q-01（→R5-01）、Q-04（→R5-02）、Q-07（→R5-13）、H-01（→R5-05）。
- 未修：Q-02（→R5-03）、Q-05（→R5-08）、Q-08（→R5-07）；Q-06 为已登记缺口。
- R5-01（指纹漏字段）、R5-02（`settleRun(...,'cancelled')` 绕过守卫）、R5-03（超限 usage 卡死）、R5-04（`reconcile` 不幂等，报告称其为「本轮最严重的正确性问题」）、R5-05（`join=none` 孤儿待办）为 5 条必修 P2；R5-06..R5-14 为 P3。
- 记录事实：`H-03` 全仓无定义（R5-14）。
- 本文件在 `0211ced` 上即第五轮报告原文，可 `git show 0211ced:.agentdev/work/WP-02/review.md` 取回全文；本轮报告覆盖写入后，第五轮全文仍存于该提交对象。

**追溯口径（本轮补充）**：第五轮报告把 4 条影响验收的行为缺陷标为 P2 并称「本轮无 P1」；开发方在 DC-53 中按 `workflow.md` §6「P1 = 错误行为/需求缺失」更正为 P1 级。本轮**沿用该已采纳的口径**（行为/需求缺陷＝P1，局部质量/维护＝P2，建议＝P3），因此本轮不复述「第五轮无 P1」这一标定。

---

## 1. 本轮结论

**FAIL（Review Failed）——第五轮 R5-01..R5-14、M-1..M-4 中，10 条确认完全修好（8 条实跑、R5-13/R5-14 为静态与记录核对）；R5-04 与 R5-10 只算部分修复（其中 R5-04 的残留重新打开「预算双花」后果，是本轮阻断项）；R5-11 只修了标题口径、正文未更新；R5-12 三处被点名注释已改但 `reconcile` 的幂等声明仍超出实现；M-2 全仓无定义无法核对。本轮另发现 10 条新问题（1×P1、2×P2、7×P3），其中 R6-01 为 P1。**

- **逐条复核（§3、§4）**：
  - **已修（verified，实跑）**：R5-01、R5-02、R5-03、R5-05、R5-06、R5-07、R5-08、R5-09、M-1、M-3、M-4；R5-13、R5-12 经静态核对（被点名的注释/断言已与代码一致）；R5-14 由 DC-53 明确宣告 H-03 不存在（本轮独立确认全仓无该定义）。
  - **部分修复**：**R5-04**（`reconcile` 重放已幂等，但对**已按实测结算**的 Run 再 `reconcile` 会二次计费并吃掉其他在场 Run 的预留 → R6-01，P1）；**R5-10**（`run.ended` 四条终态路径已统一含 `workId`/`chargedTokens`/`uncoveredTokens`，但 `reconcile` 追加事件的 `entityVersion` 仍与首次终态事件相同 → R6-05）；**R5-11**（DC-46 标题成立、`blocked/paused/cancelling/completed/cancelled/failed` 六种 Work 状态实测均可分派，但 DC-46 正文仍只举例 `blocked`/`paused`）；**R5-12**（旧 JSDoc 已全部替换，但 `run-lifecycle.ts:210-211` 的「it never charges twice or releases another Run's hold」仍与实现不符）。
  - **未定义**：**M-2** 在整个仓库（HEAD 树 + 全部提交对象 + 全部 blob）无任何出现，T13 修复清单也只提 M-1/M-3/M-4 → R6-07。
- **新问题（§5）**：**R6-01**（P1，R5-04 残留：`reconcile` 对已实测 Run 二次核销 → 双重计费 + 泄漏在场 Run 预留 → Work 实际承诺超出 `tokenLimit`，实测超发 4000 tokens）；**R6-02**（P2，`reconcile` 的 `cost` 只进事件不进 Work 预算，且分数金额被拒）；**R6-03**（P2，`settleRun(...,'cancelled',usage)` 静默丢弃实测用量）；**R6-04..R6-10**（P3：不同载荷的 `reconcile` 静默无操作、`run.ended` 版本重复、事件 `costKnown` 与 Work 级 `costKnown` 语义冲突、M-2 无定义、DC-35 描述与实现不符、`operationId` 仍可选、未知字段抛裸 `ZodError`）。
- **判定**：按 `workflow.md` §6，**R6-01 为 P1，直接阻断**；R6-02/R6-03 为本包必修 P2。R6-01 落在 `reliability.md` §3「并行调用共享Work预算事务，防止双花」与 `data.md` §2「used+reserved<=limit才派发」的明文不变式上，且代码注释与 DC-52 的幂等声明与实现不符。**本包不具备进入独立 Test 的条件**，须先返工 R6-01、R6-02、R6-03，并随返工处理 R6-04..R6-10 或（P3）在结算材料中显式登记。
- 第三轮 N-11（`data.md` 的 `ID` 记法 vs 代码哈希）仍是 **Product Decision Pending**，未消解（`docs/architecture/data.md:30` 仍写 `configSnapshotId:ID` 等三个 `:ID`，实现仍为内容哈希）。

---

## 2. 验证命令与原始结果

环境：`export PATH="$HOME/.local/bin:$PATH"`，工作目录 `/Users/huyaohua/huyh/work/aigrouptool`，全部在 `0211ced`、干净工作树上执行。原始日志：`/tmp/wp02-r6-cmds.log`（六条命令顺序执行，含退出码）。`node v24.8.0`、`pnpm 12.3.4`。

| 命令 | 退出码 | 关键原始输出 |
|---|---|---|
| `pnpm typecheck` | 0 | `$ tsc -p tsconfig.json --pretty false`（无错误输出） |
| `pnpm lint` | 0 | `Checking formatting...` / `All matched files use Prettier code style!` |
| `pnpm test:unit` | 0 | `Test Files  17 passed (17)` / `Tests  222 passed (222)`（与 T13 自述的 222 一致） |
| `pnpm test:integration` | 0 | `Test Files  10 passed (10)` / `Tests  124 passed (124)`（含真实 Docker 容器与 doctor 集成用例，未回退） |
| `pnpm docs:check` | 0 | `docs:check ok — 15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages` |
| `pnpm build` | 0 | `packages/contracts|domain|storage|core|pi-runtime|apps/cli|apps/runner build: Done`（7 个 workspace 全部 Done） |

`git log --oneline -3`：

```
0211ced fix(core): WP-02 review round 5 findings (R5-01..R5-14, M-1..M-4)
5a87a86 fix(core): WP-02 review round 4 findings (Q-01..Q-10, H-01..H-03)
411d04f fix(core): WP-02 review round 3 findings (M-01..M-05, D1..D5)
```

`git status --porcelain`：无输出（写入本报告前）。`pnpm test:e2e|acceptance|live` 仍按契约 `NOT_IMPLEMENTED`，未执行。

### 2.1 本轮独立实验日志（`/tmp/wp02-r6/`）

| 日志 | 覆盖 |
|---|---|
| `exp-a.log` | A1 R5-01 指纹全字段；A2 R5-02 取消传播；A3 M-1 二次不合规升级；A4/E3 M-3 拒绝取消不动子树；A5 `paused` 子 Run 仍被级联 |
| `exp-b.log` | B1 R5-03 超预留封顶（settle/reconcile 两路）；B2 R5-04 重放幂等；**B3 对抗：对已实测 Run `reconcile`**；B4 不同载荷静默；B5/B5b `cost` 记账与分数金额；B6 R5-05；B7 R5-06；B8 R5-07；B8b R5-08；B9 R5-09 |
| `exp-c.log` | C1 R5-10 四路径 data/版本；C2 M-4 负数/小数 usage；C3 R5-11 六种 Work 状态；**C4 对抗：cancel 路径丢 usage**；C5 join=none 级联；C6 `paused` 无法重新起 Attempt；C7 取消后预留长期占用；C8 跨请求者同键 |
| `exp-d.log` | D1 跨 1000 事件分页（findEvent/scanEvents）；D2 DC-35 父状态；D3 事件 `costKnown` vs Work 级；D4 `uncoveredTokens` 无 blocker；D5 未知字段裸 `ZodError`；D6 无 `operationId` 重复待办 |
| `exp-e.log` | E1 running Chief 单位点失败；E2 兄弟在场时的 `waiting_children`；E3 级联原子性；**E4 对抗：`reconcile` 泄漏 sibling 预留**；E5 已取消 Run 可核销 |
| `exp-f.log` / `exp-g.log` | F1/G 精确超发证明（1k 粒度：booked=limit 时真实 `used+outstanding`=104000 → 超出 `tokenLimit` **4000**）；F2 `completed` 仍拒绝在场 `join=all` 子 Run |

**实验卫生说明**：进入实验前 `packages/core/dist` 为 `5a87a86` 之前的旧产物，因此先执行 `pnpm build` 再取 `dist`；`dist/` 被 `.gitignore` 忽略，不属产品代码改动。实验通过 `/tmp/wp02-r6/node_modules/@agentdev/*` 软链解析 workspace 包，等价复现 `orchestrator.test.ts`/`join.test.ts` 的夹具但**不 import 产品测试文件**。

---

## 3. R5-01..R5-14 逐条复核表

| 条目 | 五轮严重度 | T13/DC 修复声明（0211ced） | 复核判定 | 独立实验证据（`/tmp/wp02-r6/`） |
|---|---|---|---|---|
| **R5-01** `operationId` 指纹漏字段 | P2/P1① | 指纹覆盖全部字段，任一不同即 `IDEMPOTENCY_CONFLICT`（DC-51） | **已修复（verified）** | EXP-A1：同键分别改 `goal/reason/sourceRefs/requiredOutputs/requiredChild/budgetAllocation/stage/purpose/requestedRole` **9/9 全部** `IDEMPOTENCY_CONFLICT`；同载荷重放返回原游标 `3`；`op-a1` 事件仅 1 条。指纹见 `orchestrator.ts:466-484`（12 个字段全覆盖） |
| **R5-02** `settleRun(...,'cancelled')` 绕过 live-children 守卫 | P2/P1① | 与 `cancel` 合并为同一路径并向子 Run 传播（DC-49/M-3） | **已修复（verified）** | EXP-A2：`settleRun(parent,'cancelled')` → 父与 2 个子 Run 全部 `cancelled`，`chief_action_required`=0；EXP-F2：`completed` 仍 `INVALID_STATE: still has 1 live join=all children`，`failed` 向下传播；EXP-A5：`paused` 子 Run 也被级联 |
| **R5-03** 超限 usage 卡死结算 | P2/P1① | 计费封顶到预留额、超预留记 `uncoveredTokens`，Run 正常终态（DC-50） | **已修复（verified）** | EXP-B1：`allocation=10000`、usage=25000 → `completed`，budget `used=10000/reserved=0`，事件 `{tokensUsed:25000,chargedTokens:10000,uncoveredTokens:15000,releasedTokens:0}`；`reconcile` 路径同样封顶；EXP-C2：负数/小数 usage → `VALIDATION_ERROR` 且 Run 仍 `running`（M-4） |
| **R5-04** `reconcile` 不幂等（二次核销） | P2/P1① | 以「已有 `reconciled:true` 的 `run.ended`」判幂等；`costKnown` 按全部终态 Run 重算（DC-52） | **部分修复（→ R6-01，P1）** | EXP-B2：未测量结算 → `reconcile` → 重放：`used=1000` 不变、`reserved` 不变（重放幂等成立）；**EXP-B3/E4/F1：对已按实测结算的 Run 再 `reconcile` → `used` 500→1000（二次计费）、`reserved` 14000→10000（吃掉在场 Run A 的 4000 预留）；F1：booked `used+reserved=100000`=limit 时真实 `used+outstanding=104000` → 超出 `tokenLimit` 4000**。产品测试只覆盖「重放」子例（`orchestrator.test.ts:665-687`） |
| **R5-05** `join=none` 子 Run 失败仍给终态 Chief 写待办 | P2/P1① | `pageChief` 对无法行动的 Chief Run 不再写待办（`join.ts:244-245`） | **已修复（verified）** | EXP-B6：父 `completed` 后 `join=none` 子 Run `failed` → `onChildSettled` 返回 `{kind:'ready'}`，`chief_action_required` 新增 **0**；失败仍可从返回值的 `children[].status='failed'` 读出，未静默 |
| **R5-06** Work 级 `costKnown` 被回翻 | P3 | 按「所有终态 Run 都有实测/核销记录」重算（DC-52） | **已修复（verified）** | EXP-B7：A 未测量 + B 实测 → Work `costKnown=false`（B 单独实测不再回翻）；A 核销后 → `true`。EXP-D3：事件级 `costKnown` 与 Work 级不一致问题另见 R6-06 |
| **R5-07** `state()` 在 `blocked` 时 `chiefTodo` 为空 | P3 | `state()` 复用已登记待办游标（`join.ts:146-155`） | **已修复（verified）** | EXP-B8：同一父 Run，`onChildSettled.chiefTodo='5'`，`state().chiefTodo='5'`，且 `state()` 零新建事件（`chief_action_required`=1） |
| **R5-08** `releasedTokens` 记整笔 allocation | P3 | 语义固定为「退还的预留余额」，并记 `chargedTokens`/`uncoveredTokens`（DC-50） | **已修复（verified）** | EXP-B8b：`allocation=30000`、usage=25000 → `releasedTokens=5000`（旧值 30000）；reconcile 路径同样 5000 |
| **R5-09** 已受理请求的重放变 `INVALID_STATE` | P3 | 同键重放查库先于双方状态校验（DC-51） | **已修复（verified）** | EXP-B9：Chief 置 `failed` 后重放同键同载荷 → 返回原游标 `3`；不带键的新请求 → `INVALID_STATE`（新请求仍需双方可行动） |
| **R5-10** `run.ended` data 形状/版本 | P3 | data 统一含 `workId`/`chargedTokens`/`uncoveredTokens` | **部分修复（→ R6-05，P3）** | EXP-C1：measured/unmeasured+reconcile/`contract_violation`/`cancelled` 四路径 **全部含 `workId`** ✓；但 reconcile 追加事件与首次终态事件 `entityVersion` 相同（`versions=[4,4]`，duplicate=true） |
| **R5-11** 终态 Work 仍可 dispatch（DC-46 正文窄） | P3 | 「DC-42/DC-46 缺口口径不变」（T13），正文未更新 | **正文未修（残留 P3）** | EXP-C3：`blocked/paused/cancelling/completed/cancelled/failed` 六种状态 `dispatch` 全部 `OK → queued`（比 DC-46 正文举例更宽，与 DC-46 标题一致）。承接 WP-05，非本包必修 |
| **R5-12** `run-lifecycle.ts` JSDoc 与新行为矛盾 | P3 | 源码注释改为与实现一致 | **基本修复（残留 1 处）** | 静态：旧三处（「charged as zero」/「DC-41」/「only the remainder」/「at most it」）已全部消失，`RunUsage`/`settleBudget` 注释与代码一致；但 `run-lifecycle.ts:210-211`「it never charges twice or releases another Run's hold」仍被 EXP-B3/E4/F1 证伪（并入 R6-01） |
| **R5-13** Q-07 残留：注释仍称 Work 级 `blocked(provider)` | P3 | 注释不再声称 Work 级 blocked | **已修复（verified）** | 静态：`orchestrator.ts:333-334`（「The Run is refused rather than queued on a guess; the Work-level `blocked(provider)` projection is WP-05 (DC-42)」）、`model-gateway.ts:8-9`、`config.ts:370-373` 三处均改为指向 WP-05/DC-42，无任何注释再声称已实现 |
| **R5-14** H-03 无定义 | P3 | DC-53：H-03 是第四轮报告的追溯口径问题，仓库内无对应实体 | **已处置（verified）** | `git grep -n "H-03" HEAD` 仅命中 `implementation.md:89`、`review.md` 文本与 DC-53；全 blob 无定义。R5-14 要求的「明确宣告它不存在」已由 `discovery.md:149-151` 完成。遗留：`implementation.md:89` 的「另补 H-01..H-03」措辞未修正（T12 属历史记录，本轮不判为缺陷） |

① 第五轮报告原标 P2，DC-53 按 `workflow.md` §6 更正为 P1 级；本轮沿用。

**小结**：完全修好 10 条（R5-01/02/03/05/06/07/08/09/13/14）；部分修复 3 条（R5-04→R6-01、R5-10→R6-05、R5-12）；正文/口径未闭环 1 条（R5-11）。**第五轮的两条必修残留（R5-04 的实测-核销子例、R5-10 的事件版本）都是「重放幂等」这一处修复的边界外情形**：修复只堵住了「再次 `reconcile`」，没有堵住「对已实测 Run `reconcile`」。

---

## 4. M-1..M-4 逐条复核表

> 前置事实：`M-1..M-4` 由 `implementation.md:104`（T13）声明为「对抗性核验补出」，但**只有 M-1/M-3（DC-49）与 M-4（DC-50）有定义**；`M-2` 在 HEAD 树、全部提交对象与全部 blob 中**无任何出现**（`git grep -n "M-2" HEAD` 无匹配；`git log --all -S"M-2"` 无提交）。

| 条目 | 仓库定义处 | 复核判定 | 独立实验证据 |
|---|---|---|---|
| **M-1** 二次不合规升级被在场 `join=all` 子 Run 挡住 | `discovery.md:134` | **已修复（verified）** | EXP-A3：running Chief + 1 个在场 `join=all` 子 Run，`stage.submit` 两次不合规 → 第 2 次 `CONTRACT_VIOLATION`、父 `contract_violation`、子 Run 一并 `cancelled`、`schema_invalid` 事件 2 条（不再回滚吞掉） |
| **M-2** 无定义 | 无 | **无法核对（→ R6-07）** | 全仓/全历史零出现；T13 修复清单只列 M-1（`:112`）、M-3（`:107`）、M-4（`:108`） |
| **M-3** `cancel` 报错但子 Run 已被取消的部分写入 | `discovery.md:133` | **已修复（verified）** | EXP-A4：父 `completed`、`join=none` 子 Run 仍 `queued`，`cancel(parent)` 抛 `VALIDATION_ERROR: cannot move completed → cancelled`，子 Run **仍 `queued`**；EXP-E3：被拒的取消产生 **0** 条新 `run.ended`。`cancel` 先校验父迁移再进事务（`run-lifecycle.ts:189-203`） |
| **M-4** 负 usage 被预算钳到 0、事件却写原始值 | `discovery.md:138` | **已修复（verified）** | EXP-C2：`{tokensUsed:-5,measured:true}` → `VALIDATION_ERROR: tokensUsed must be a non-negative integer, got -5`，Run 仍 `running`、budget 不变；`1.5` 同样被拒；`0` 正常终态 |

---

## 5. 新 Findings（R6-01..R6-10）

### R6-01 [P1] `reconcile` 对已按实测结算的 Run 二次核销：双重计费并泄漏其他在场 Run 的预留，Work 可超出 `tokenLimit` 派发（R5-04 残留）

- 位置：`packages/core/src/run-lifecycle.ts:225-230`（幂等判定只找 `reconciled === true`，不判断该 Run 是否已有实测用量）、`:355-365`（`settleBudget` 无条件 `release(run.budgetAllocation)` + `charge(charged)`）、`:91-100`（`release` 只做 `max(0, reserved-allocation)`，不校验预留归属）、`:210-211`（JSDoc 声称「it never charges twice or releases another Run's hold」）。
- 事实（EXP-B3/E4/F1）：
  - 场景：Work `tokenLimit=100000`；Chief Run 持 10k；在场子 Run A 持 4k；子 Run B（4k）按实测结算 `{tokensUsed:500}` → `used=500, reserved=14000`（A 的 4k 仍在场）。
  - 对 B 再调 `reconcile(B,{tokensUsed:500})` → **接受**：`used` 500→1000（**二次计费**），`reserved` 14000→10000（**吃掉 A 的 4000 预留**），A 仍 `queued` 且其 allocation 仍为 4000。
  - 之后以 1k 粒度继续派发直到被拒：booked `used+reserved = 100000`（恰好等于 `tokenLimit`），而真实的 `used + 在场 Run allocation 之和 = 104000` → **实际承诺超出 `tokenLimit` 4000 tokens**，无任何错误提示。
- 依据：`reliability.md` §3「并行调用共享Work预算事务，**防止双花**」；`data.md` §2 `budget`「used+reserved<=limit才派发」；DC-52 的幂等声明；`run-lifecycle.ts:210-211` 的 JSDoc。第五轮 R5-04 的 EXP-B2 已把「对一个已按实测结算的 Run 再 `reconcile` → used 从 5000 变 10000」列为该条目的实测现象，故本条是**必修项的残留**，不是纯新问题。
- 影响：Work 账本失真 → 可被后续派发超发（真实支出超出限额）；费用重复计入；`release` 不区分 Run 归属使任一异常调用都能扣减他人的预留。触发路径自然：DC-45/DC-52 把 `reconcile` 描述为幂等核销入口，WP-10 若「结算后一律按 Provider usage 核销」即命中。
- 建议：幂等判定改为「该 Run 已有实测/核销记录」（或按 Run 维度记账 `run.reconciledAt`）；`release` 在 `reserved < allocation` 时 fail-closed 而不是 `Math.max(0,…)`；补必需测试：measured settle → `reconcile` → 断言零变化；带在场兄弟 Run 时 `reconcile` → 断言兄弟预留不变；并加一条「Work 实际承诺 ≤ tokenLimit」的不变式测试。

### R6-02 [P2] `reconcile` 的 `cost` 只写事件不写 Work 预算，且分数金额被拒（DC-45 的 cost 路径不可用）

- 位置：`packages/core/src/run-lifecycle.ts:213`（接受 `cost?`）、`:222-224`（要求 `Number.isInteger(cost)`）、`:232-235`（`settleBudget` 只收 `{tokensUsed, measured}`）、`:250`（`cost` 仅进事件 data）、`:363`（`charge(run.workId, charged)` **不传 cost**）、`:407-419`（`charge` 的 `cost` 形参与 `budget.cost` 写入分支无任何调用方 = 死代码）。契约：`packages/contracts/src/entities/run.ts:182` `cost: z.number().nonnegative().optional()`；`packages/storage/src/schema.ts:164` `cost REAL`；`docs/architecture/data.md:37` 同样声明 `cost?:number`。
- 事实（EXP-B5/B5b）：`reconcile(run,{tokensUsed:1000, cost:3})` 后事件含 `cost:3`，但 Work 预算行 `cost` 仍为 `undefined`（从未被写入）；`reconcile(run,{tokensUsed:10, cost:0.0025})` → `VALIDATION_ERROR: cost must be a non-negative integer, got 0.0025`（真实金额通常为小数）。
- 依据：DC-45「`RunLifecycle.reconcile(runId, {tokensUsed, cost?})` 完成核销（释放整笔预留、**计入 `tokensUsed`/`cost`**、置 `costKnown=true`）」与实际不符；`data.md` §2 允许分数 `cost`。
- 影响：Work 级成本永远为空，消费方（UI/预算判断/`budget.cost`）拿到错误事实；分数价格根本无法核销；`charge` 的 `cost` 分支是不可达代码（局部维护问题）。
- 建议：把已校验的 `cost` 传给 `charge`（并让校验与 `budgetSchema.cost` 的范围一致），或在 `reconcile` 与事件 data 中都删除 `cost`；若保留，补「核销后 `budget.cost` 累加」的测试。

### R6-03 [P2] `settleRun(run,'cancelled', usage)` 静默丢弃实测用量

- 位置：`packages/core/src/run-lifecycle.ts:146-153`（`:151` `if (status === 'cancelled') return this.cancel(runId);` 直接丢弃 `usage` 形参）、`:188-203`（`cancel` 固定使用 `{tokensUsed:0, measured:false}`）；公开入口 `packages/core/src/orchestrator.ts:620-626`。
- 事实（EXP-C4）：`settleRun(run,'cancelled',{tokensUsed:4321,measured:true})` → Run `cancelled`，budget `used=0, reserved=5000, costKnown=false`，`run.ended` 记 `usageMeasured:false, tokensUsed:0`，**无任何错误或诊断**；4321 的实测用量被永久丢弃。
- 依据：`reliability.md` §3「模型调用前预留…**扣除实际 usage** 并释放剩余」；`protocol.md` §1 写命令语义（同键同载荷返回原结果、同键不同载荷拒绝，不允许静默无操作）。与 R5-01 属同一「静默吞掉写命令载荷」类。
- 影响：取消路径是真实用量的必经路径（R5-02 的修复正是把取消并入 `settle`），调用方按签名传入用量却得不到任何反馈；Work 账本少记已发生的成本。
- 建议：`cancel` 路径处理已传入的 usage（释放预留 + 计费），或在 `usage` 非零时抛 `VALIDATION_ERROR`，或从 `'cancelled'` 重载中移除 `usage` 以免调用方误以为生效。

### R6-04 [P3] `reconcile` 对「同 Run、不同 usage」的重复调用静默无操作，而非 `IDEMPOTENCY_CONFLICT`

- 位置：`packages/core/src/run-lifecycle.ts:225-230`（命中 `reconciled:true` 即 `return run`，不比对本次 `tokensUsed/cost`）。
- 事实（EXP-B4）：`reconcile(A,{tokensUsed:1000})` 后再 `reconcile(A,{tokensUsed:4999,cost:7})` → 被接受但预算与事件完全不变，无 `IDEMPOTENCY_CONFLICT`。
- 依据：`protocol.md` §1「幂等键同载荷返回原结果；同键不同载荷拒绝」、§7 错误表 `IDEMPOTENCY_CONFLICT`。`reconcile` 目前无 `operationId`，因此这是无幂等键的写命令，调用方无法判断自己的修正是否生效；与 R5-01 同一类问题。
- 建议：为 `reconcile` 增加 `operationId`（或至少比对载荷）→ 命中且载荷不同时 `IDEMPOTENCY_CONFLICT`。

### R6-05 [P3] `reconcile` 追加的 `run.ended` 复用同一 `entityVersion`（R5-10 残留）

- 位置：`packages/core/src/run-lifecycle.ts:239`（`entityVersion: run.version`，与首次终态事件相同）。
- 事实（EXP-C1）：未测量结算 + `reconcile` 的 Run 产生 2 条 `run.ended`，`versions=[4,4]`（duplicate=true）；而 Run 行版本自 `end` 之后未再变化。
- 依据：`protocol.md` §7 `Event={…,entityId,entityVersion,data}`；按 `(entityId, entityVersion)` 增量消费的一方无法排序/区分核销事件（R5-10 的原始第二条）。
- 建议：核销写新的 Run 版本（例如更新时间戳/`reconciled` 标记使 `version+1`），或改用独立事件名/字段承载核销。

### R6-06 [P3] 事件 `costKnown`（单次结算）与 Work 级 `costKnown`（聚合）语义冲突，且同状态可同时为真/假

- 位置：`packages/core/src/run-lifecycle.ts:315`（`costKnown: usage.measured`）、`:248`（`costKnown: true`）、`:330-344`（Work 级按全部终态 Run 重算）。
- 事实（EXP-D3）：Run B 实测结算的事件 `costKnown=true`，同一时刻 Work 预算 `costKnown=false`（兄弟 Run A 未测量）。DC-48/DC-52 只声明「data 形状统一」与「costKnown 是 Work 级标志」，未说明事件字段属于哪一级。
- 影响：消费方（UI/监督）无法从 `run.ended` 判断 Work 成本是否已知，可能误报「成本已确认」。
- 建议：把事件字段改名为 `usageMeasured`（Run 级）并另加 `workCostKnown`（Work 级快照），或在 DC 中明确字段层级。

### R6-07 [P3] `M-2` 在仓库内没有任何定义（连续第三轮出现同一记录模式）

- 位置：`implementation.md:104`（声明对抗性核验补出 M-1..M-4）、`implementation.md:106-113`（T13 修复清单只提 M-1/M-3/M-4）、`discovery.md:128-138`（DC-49/DC-50 只定义 M-1/M-3/M-4）。
- 事实：`git grep -n "M-2" HEAD` 无匹配；`git log --all -S"M-2"` 无提交；遍历全部可达 blob 亦无 `.agentdev` 内出现。
- 影响：任务要求的「逐条核对 M-1..M-4」在 M-2 上不可完成；Review 不能以汇总句替代可核对的 Finding 描述（`workflow.md` §6）。DC-53 在**同一提交**中更正了 H-03 的同类问题，却未处理 M-2，属同类问题的当轮复现。
- 建议：在 `discovery.md` 补齐 M-2 的定义与处置，或明确宣告其不存在/已撤销。

### R6-08 [P3] `discovery.md:54`（DC-35）称父 Run「停留在 `waiting_children`」，与实现不符

- 位置：`docs/../.agentdev/work/WP-02/discovery.md:54`；实现 `packages/core/src/join.ts:182-194`（只有 `pending.length > 0` 且父为 `running` 时才转 `waiting_children`）。
- 事实（EXP-E1）：running Chief + 唯一 required `join=all` 子 Run 失败 → `onChildSettled` 返回 `{kind:'blocked', chiefTodo:'5'}`，但父 Run 状态保持 **`running`**（不是 `waiting_children`）。EXP-E2：有在场兄弟时父为 `waiting_children`，兄弟完成后仍停在 `waiting_children`（`failedRequired>0` 不回落 `running`）。
- 影响：DC-35 是 AC-046「新 Chief 消息可处理」的实现依据；描述为「停留 waiting_children」会让承接方/文档读者以为单子失败也进入该状态。功能上两个状态都可继续受理命令，故为记录准确性问题（P3），与 R5-13 同类。
- 建议：改为「父保持其当前活动状态（原为 running 时保持 running），不因 Gate 阻断而失活；若曾有未终态 `join=all` 子 Run 则处于 waiting_children」。

### R6-09 [P3] `request_dispatch` 的 `operationId` 仍为可选，缺键时重复请求产生重复 Chief 待办

- 位置：`packages/core/src/orchestrator.ts:131-132`（`operationId?: string`）、`:485-517`（仅当传入时才查重）；`protocol.md` §6「所有调用带 operationId 以便重派去重」。
- 事实（EXP-D6）：同一专业 Run 两次完全相同的 `requestDispatch`（不带 `operationId`）→ 2 条 `chief_action_required`。EXP-C8：两个不同请求者用同一 key → `IDEMPOTENCY_CONFLICT`（fail-closed，行为可接受）。
- 建议：把 `operationId` 提为必填，或在缺失时由 Core 生成键并记录，避免 at-least-once 重派产生重复待办。

### R6-10 [P3] 未知字段的 Chief `DispatchSpec` 抛裸 `ZodError` 而不是 `ProtocolError`

- 位置：`packages/core/src/orchestrator.ts:286-288`（`validateDispatchSpec` 不做整包 Schema 解析）、`:376-379`（`dispatchSnapshotSchema.parse` 抛出 ZodError）。
- 事实（EXP-D5）：`dispatch({spec: {...chiefSpec, bogusField: 1}})` → 抛 `ZodError: unrecognized_keys … "bogusField"`（`name='ZodError'`，无 `code`），不是 `VALIDATION_ERROR` 的 `ProtocolError`。
- 依据：`protocol.md` §1「必填参数缺失、**未知字段**或枚举错误返回 VALIDATION_ERROR」。当前 `Orchestrator.dispatch` 尚未接入 mailbox/协议层，故不可经协议触达（`packages/core/src` 与 `apps/*/src` 内均无 `Orchestrator` 调用方，`index.ts:20` 只做导出）；一旦 WP-05/WP-08 接线即成为协议面缺陷。
- 建议：`dispatch` 入口先对 spec 做一次 Schema 校验并把失败映射为 `VALIDATION_ERROR`，与 `professionalSpec()` 的既有做法一致。

---

## 6. 本包必修 vs 其他包显式缺口（承接核对）

| 事项 | 归属判定 | 承接登记核对 | 结论 |
|---|---|---|---|
| R6-01 `reconcile` 二次核销/泄漏预留（P1） | **本包必修** | — | `run-lifecycle.ts`/`reconcile` 为本包代码；`reliability.md` §3、`data.md` §2 |
| R6-02 `cost` 不入 Work 预算（P2） | **本包必修** | — | `run-lifecycle.ts` + `data.md:37` `cost?:number` |
| R6-03 取消路径丢 usage（P2） | **本包必修** | — | 同上；`reliability.md` §3 |
| R6-04 `reconcile` 载荷冲突静默（P3） | **本包必修** | — | `protocol.md` §1 |
| R6-05 `run.ended` 版本重复（P3） | **本包必修** | — | R5-10 残留 |
| R6-06 事件 `costKnown` 层级（P3） | **本包必修** | — | 事件 data 由本包写；DC-48 需补充层级说明 |
| R6-07 M-2 无定义（P3） | **本包记录缺陷** | — | 流程记录完整性（`workflow.md` §6） |
| R6-08 DC-35 描述不符（P3） | **本包记录缺陷** | — | `discovery.md:54` 与 `join.ts` 不符 |
| R6-09 `operationId` 可选（P3） | **本包必修** | — | `protocol.md` §6 |
| R6-10 裸 ZodError（P3） | **本包必修**（潜在） | — | 协议接线后转正面缺陷，建议现在修 |
| R5-11 终态 Work 仍可 dispatch | 承接 **WP-05** | `discovery.md:116-118` DC-46（标题已覆盖，正文举例仍只有 `blocked`/`paused`）；`docs/delivery/implementation.md:76` WP-05 输出仍为「ContextBuilder、ACL、Snapshot、read ledger、Checkpoint、预算」，**不含 Work 状态投影/WorkBlocker** | **DC 已登记但承接条目未确认**（与第五轮一致） |
| Q-06/DC-40/DC-47 父 Run 额度口径 | 待产品确认的实现约定 | `discovery.md:89-91`（DC-40）、`:120-122`（DC-47） | **已登记，等待产品方决定**；未进入 `data.md`/`agents.md` |
| DC-42 Work `blocked(provider)` | 承接 **WP-05** | DC-42 声明 WP-05；WP-05 条目无该职责 | **承接归属存疑（连续第三轮）**；`data.md` 亦无 `work_blocker` 表 |
| DC-45 真实 usage 读取/核销**调用方** | 承接 **WP-10** | DC-45 声明 WP-10；WP-10 条目未点名 usage/预算核销 | 承接可对应，建议结算前在 WP-10 条目补一句「Provider usage 读取与预算核销」 |
| 新增观察：`uncoveredTokens`（真实花费超出限额）不产生 Work 级 `budget` blocker，也无「预算提高需用户来源」的后续动作 | **未在任何 DC 登记** | 无 | 建议在 `discovery.md` 登记为承接 WP-05 的显式缺口（EXP-D4：limit=20k、上报 100k → `charged=5k/uncovered=95k`，`work.blockerIds=[]`，下一次派发照常成功） |
| DC-38 `runParams` 无授权来源 | 承接 **WP-04/WP-07** | `discovery.md:81-83` | 归属偏 WP-07，条目未提授权；后续包未启动 |
| DC-39 Join 无协议事件（读模型） | 承接 **WP-08** | `discovery.md:85-87` | 归属与 WP-08/WP-09 条目均不完全吻合，跨包风险 |
| N-11（RE-06）`data.md` `ID` vs 哈希 | **Product Decision Pending** | `discovery.md:72` | 未消解前不得判 Completed |

补充事实：除 `.agentdev/work/{WP-00,WP-01,WP-02}` 外，承接包（WP-04..WP-10）均尚无独立过程记录目录，故「承接」目前只能由 DC 条目声明，无法在承接包侧交叉验证。

---

## 7. 未验证 / 无法验证项与剩余风险

1. **M-2 内容**：仓库无定义（R6-07），本轮无法逐条核对。
2. **真实并发**：全部实验单线程。`requireBudget`/`canAllocateBudget` 在事务外判定、`reserve` 在事务内（`orchestrator.ts:325-328` vs `:384`），`requestDispatch` 的 `operationId` 去重也在事务外（`:485-517` 查到即 return）。单 mailbox 串行下不可达，本轮未做并发压测；`release` 不区分 Run 归属（`:91-100`）是 R6-01 的放大器。
3. **`reconcile` 的生产调用方**：DC-45 声明承接 WP-10，当前全仓无调用方（`grep -rn "reconcile(" packages/*/src` 仅本类定义）。WP-10 若不实现，所有未测量/取消/`contract_violation` 终态的预留保持占用（EXP-C7：取消一对父子的 100k Work 下 `reserved=14000` 永久保留），`reliability.md` §3「结果最终可查 usage 再核销」不可达。
4. **消息级路由**：`ProjectMailbox` 仍不读 `subject`，无法在 mailbox 层验证「消息投递到等待中的父 Run」；区分力由 `dispatch` 的父状态校验提供（第三轮已证）。
5. **`beginAttempt` 无法恢复 `paused` Run**（第四/五轮未变）：`run-lifecycle.ts:111-116` 对 `paused` 抛 `VALIDATION_ERROR: cannot start from paused`，而 `domain/transitions.ts:128-130` 的 `runAcceptsNewAttempt` 把 `paused` 视为可新 Attempt（EXP-C6：`interrupted` 可起新 Attempt，`paused` 不可）。Checkpoint 恢复归 WP-05。
6. **`settleRun` 非幂等**：重复结算抛 `VALIDATION_ERROR`（无 `operationId`）；WP-05 的 at-least-once 监督重放需自行保证只调用一次。
7. **`timed_out` 终态不可达**：`TerminalRunStatus` 只含 `completed/failed/cancelled`，`run.ended` 的四条写入路径中无 `timed_out`；归 WP-05 监督，本轮未判为 Finding。
8. **真实 Provider 调用与 Secret**：`GatewayTransport`/`SecretResolver` 仍为注入缝（DC-31），AC-043「不同 Provider」仍只是结构验证。
9. **ContextBuilder/上下文内容与 token 计量**：`dispatch` 的 `contextPayload` 仍只有 fallback（`orchestrator.ts:349-360`），属 WP-06；AC-082 的工具层负例归 WP-07。
10. **`readLedgerHash` 真实性**：`stage.ts` 只做 64 位十六进制 Schema 校验，未与读账本核对（WP-05/WP-06）。
11. **事件消费者端到端兼容性**：R6-05/R6-06 的字段语义与 WS/BFF/UI（WP-08/WP-09）未实现，本轮只做协议/文档静态判定。
12. **`test:e2e`/`test:acceptance`/`test:live`**：按契约 `NOT_IMPLEMENTED`，未执行。
13. **结算未完成（T9 待办）**：`docs/INDEX.md:26-30` 仍只列 WP-00/WP-01 且称 Work/Run 编排「仍未实现」；`docs/delivery/acceptance.md` 中 **没有 WP-02 的任何证据登记**（`grep -n "WP-02" docs/delivery/acceptance.md` 无匹配）；`implementation.md:117-119` 仍留「## T9 待办」。本次 Review 只判定「实现是否成立」，不判定「结算是否完成」；在 R6-01 关闭前也不应结算。
14. **N-11 产品决定**：`data.md:30` 的三个 `:ID` 快照引用与实现的哈希并存，属 `Product Decision Pending`。

---

## 8. 方法与边界声明

- 本报告只依据仓库文件、`0211ced` 上的 git 对象/差异与实跑命令；未读取任何开发对话、未引用外部同名技能或历史方案。
- 唯一写入文件为本文件 `.agentdev/work/WP-02/review.md`；实验脚本独立写在 `/tmp/wp02-r6/`（`fixture.mjs`、`exp-a..g.mjs`、对应 `.log`），使用 `pnpm build` 产出的 `packages/*/dist`，通过 `/tmp/wp02-r6/node_modules/@agentdev/*` 软链解析 workspace 包，等价复现 `orchestrator.test.ts`/`join.test.ts` 的夹具但**不 import 产品测试文件**。
- 未修改产品代码、测试、`docs/**`、`plan.md`、`implementation.md`、`discovery.md`；`pnpm build` 只写 `.gitignore` 中的 `dist/`。写入本报告前 `git status --porcelain` 无输出、`HEAD=0211ced`。
- 本报告覆盖了第五轮 `review.md`；第五轮全文可用 `git show 0211ced:.agentdev/work/WP-02/review.md` 取回，第四/三/二/一轮分别用 `git show 5a87a86:…`、`git show 411d04f:…`、`git show a8daa6d:…`、`git show c4763d5:…` 取回。
