# WP-02 独立 Review 报告（第八轮）

- 评审对象：工作包 WP-02「主管与独立Agent调度」
- 评审轮次：**第八轮**（逐条复核第七轮 R7-01..R7-08 与对抗性核验补出的 R7-09 是否真修，并找新问题）
- 冻结点：git `4580c02`（`fix(core): WP-02 review round 7 findings (R7-01..R7-09)`），前置 `f02aca4`
- HEAD 校验：`git rev-parse HEAD` = `4580c02e132f461bbae8d96788cd614f13ab55dd`
- 工作树：复核开始时与本报告写入前 `git status --porcelain` 均无输出（`pnpm build` 只写被 `.gitignore` 忽略的 `dist/`）
- 评审角色：Review（独立上下文，未读取任何开发对话；只依据仓库文件、git 对象与我自己的实验）
- 权威依据：`AGENTS.md`、`docs/INDEX.md`、`docs/rules/{workflow,agents}.md`、`docs/architecture/{ARCHITECTURE,data,protocol,reliability,context}.md`、`docs/delivery/{implementation,acceptance}.md`（WP-02 与 AC-043/044/045/046/047/082）、`.agentdev/work/WP-02/{plan,implementation,discovery}.md`、`packages/core/src` 全部、`packages/domain/src`、`packages/contracts/src/entities/{run,structures}.ts`、`packages/contracts/src/primitives.ts`、`packages/contracts/src/enums.ts`、`packages/core/test`
- 方法：逐行核对「注释/记录声称」与代码；在 `/tmp/wp02-r8/` 自建夹具与 8 组实验脚本（`fixture.mjs`、`exp-a..h.mjs`），用 `pnpm build` 产出的 `packages/*/dist` 独立复现；**不修改产品代码、测试、`docs/**`、`plan/implementation/discovery`**。
- 工具：`node v24.8.0`、`pnpm 12.3.4`

---

## 0. 历史轮次结论摘要（保留，第一至七轮）

**第一轮（`785bdd6`）FAIL：1×P1、5×P2、7×P3（R-01..R-13）。**
P1＝`stage.submit` 无终态/epoch 守卫；P2＝「父等待可接消息」证据空洞、`joinPolicy=none` 未实现、持久事件名偏离 `protocol.md` §7、越界写入 Plan、`run.ts` 快照引用改哈希与 `data.md` 冲突。全文：`git show c4763d5:.agentdev/work/WP-02/review.md`。

**第二轮（`c4763d5`）FAIL：0×P1、5×P2、6×P3（N-01..N-11）。**
含 `contract_violation` 不释放预算、非 running 仍接受交付、自造 Join 事件名、终态父 Run 仍收新子 Run、重复 `chief_action_required`、二次 Schema 失败在 `paused` 抛错等。

**第三轮（`a8daa6d`）FAIL：1×P1、2×P2、2×P3（M-01..M-05）＋对抗性核验 D1..D5。**
M-01（P1）＝父 Run 级预算预留从不释放；M-02＝预算只预留/释放不核销；M-03＝`Work blocked(provider)` 未落地。D1..D5 **不是**第三轮报告条目（口径更正见 `implementation.md:90`）。

**第四轮（`411d04f`）FAIL：0×P1、3×P2、7×P3（Q-01..Q-10）＋对抗性核验 H-01..H-03。**
Q-01（`operationId` 只按键去重不校验载荷）、Q-04（父 Chief Run 可在 `join=all` 子 Run 未终态时被结算）为本包必修。H-01..H-03 只由开发方 T12 登记描述，第四轮报告中没有这三条。

**第五轮（`5a87a86`）FAIL：0×P1、5×P2、9×P3（R5-01..R5-14）＋对抗性核验 M-1..M-4。**
R5-01（指纹漏字段）、R5-02（`settleRun(...,'cancelled')` 绕过守卫）、R5-03（超限 usage 卡死）、R5-04（`reconcile` 不幂等）、R5-05（`join=none` 孤儿待办）为必修；`H-03` 全仓无定义（R5-14）。

**第六轮（`0211ced`）FAIL：1×P1、2×P2、7×P3（R6-01..R6-10）＋对抗性核验另补 3 条观察。**
R6-01（P1）＝`reconcile` 对已按实测结算的 Run 二次核销 → 双重计费 + 吃掉在场 Run 预留 → Work 实际承诺超出 `tokenLimit`；R6-02＝`cost` 只进事件不进 Work 预算且分数金额被拒；R6-03＝`settleRun(...,'cancelled',usage)` 静默丢弃实测用量。全文：`git show 0211ced:.agentdev/work/WP-02/review.md`。

**第七轮（`f02aca4`）FAIL：0×P1、2×P2、6×P3（R7-01..R7-08）＋对抗性核验补出 R7-09（P2）。**
R7-01＝malformed `DispatchSpec` 抛裸 `TypeError`；R7-02＝`reconcile` 幂等比较忽略 `cost`；R7-03＝`measured:false` 带 cost 被静默丢弃；R7-04＝`reconciliation` 计数恒 1；R7-05＝DC-48 仍写 `costKnown`；R7-06＝DC-35 父状态描述不准；R7-07＝被拒 dispatch 仍落快照行；R7-08＝DC-46 枚举与 `workflow.md` §65 引用错误；R7-09＝级联取消不释放「从未启动」子 Run 的预留。全文：`git show f02aca4:.agentdev/work/WP-02/review.md`（本轮覆盖写入后仍存于该提交对象）。

**追溯口径（沿用第五轮 DC-53/DC-56 口径）**：行为/需求缺失＝P1（阻断）；局部质量/维护＝P2；建议＝P3。P2/P3 是否阻断由本轮按 `workflow.md` §6「影响验收则阻断」判定。**本轮沿用以 R7-09 为 P2 的既有标定**（同一缺陷类）。

---

## 1. 本轮结论

**FAIL（Review Failed）——第七轮 9 条中 4 条完全修好（R7-01、R7-02、R7-03、R7-04 的代码部分），5 条只算部分修复（R7-05、R7-06、R7-07、R7-08、R7-09），其中 R7-09 的残留是**预算可用性**缺陷（→ R8-03，P2），R7-07 的残留**证伪**了 DC-58/T15「被拒 dispatch 无副作用」的绝对声明（→ R8-04，P3）。本轮另发现 9 条新问题：0×P1、3×P2、6×P3。**

- **逐条复核（§3）**：
  - **完全修好（实跑 verified）**：**R7-01**（9 种畸形 spec 全部 → `ProtocolError/VALIDATION_ERROR`，无 Run/快照增长）、**R7-02**（同量同 cost 重放无操作、只改 cost → `IDEMPOTENCY_CONFLICT`、`cost` 真正入 `budget.cost` 且接受小数）、**R7-03**（`measured:false` 带 cost 在 completed/cancelled 两条路径都 `VALIDATION_ERROR`，Run 不动）、**R7-04**（`reconciliation` 字段已从事件移除，两条 `run.ended` 的 `cursor` 单调可排序）。
  - **部分修复**：**R7-05**（`costKnown`→`runCostKnown` 已改且代码一致，但 DC-48 字段清单仍不完整、DC-52 指向 DC-48 的「entityVersion 会重复已记录」不成立 → R8-06）；**R7-06**（DC-35 的「更正」括注在，但正文 operative 句仍写「required 失败…子 Run 全部终态后才回到 `running`」，实测停留 `waiting_children`；单子 Run 失败时父从未进入 `waiting_children` → R8-05）；**R7-07**（spec 级与准入级拒绝已无副作用，但畸形 `authorizationRef`/`requiredOutputSchemas` 仍在冻结之后才校验，留下 config/context/dispatch 三行快照 → R8-04）；**R7-08**（DC-46 已改为 `workStatusSchema` 真实取值、DC-53 已改 §6，但 DC-56 与 T13 仍写不存在的 `§65` → R8-07）；**R7-09**（级联取消确实释放「从未启动」**子 Run** 的预留，但被取消的 **Run 自身**同样无 Attempt 却仍按未测量保持死预留 → R8-03）。
  - **对第六轮对抗性观察 3 条**：① `measured:false` 带非零用量 → `VALIDATION_ERROR`（实测）；② `settlementOf` 判定在 `withTransaction` 内（静态 + 行为一致）；③ `JoinCoordinator` 仍无生产调用方（`grep` 仅 `join.ts` 定义 + `join.test.ts` 使用）。
- **新问题（§5）**：**R8-01**（P2，`requestDispatch`——协议方法 `agent.request_dispatch`/AC-045 入口——无契约校验：畸形 `sourceRefs`/`requiredOutputs` 抛裸 `TypeError`，非字符串 `goal`/`stage`、负 `budgetAllocation`、非字符串 `operationId` 原样落事件）、**R8-02**（P2，`assess`——协议方法 `assessment.submit`——无契约校验：`payload=null`/`riskFlags`/`uncertainties` 抛裸 `TypeError`，非法枚举抛裸 `StorageError/CONSTRAINT_VIOLATION`，不在 `protocol.md` §7 错误表内）、**R8-03**（P2，R7-09 残留：零消费取消后 Work 永久 `BUDGET_EXCEEDED`，且测试注释「The cancelled parent did run」与夹具事实不符）、**R8-04**（P3，R7-07 残留，falsifies DC-58）、**R8-05**（P3，R7-06 残留）、**R8-06**（P3，R7-04/R7-05 记录残留）、**R8-07**（P3，R7-08 残留）、**R8-08**（P3，失效引用与注释不实：`data.md §5`、`contextSelection.readPaths`、`charges tokensUsed`）、**R8-09**（P3，`dispatch` 的 `contextPayload` 无校验，可写入读不回来的快照行）。
- **判定**：按 `workflow.md` §6，无 P1；但 **R8-01、R8-02、R8-03 是 `packages/core` 本包必修 P2**，且 R8-01/R8-02 正是 T14「Core 入口的契约校验统一转成 `VALIDATION_ERROR`」这一声明的**同类残留**（T15 只修了 `dispatch` 一个入口）。R8-01 命中 `protocol.md` §1「必填参数缺失、未知字段或枚举错误返回 `VALIDATION_ERROR`」与 AC-045 明文点名的 `request_dispatch`；R8-02 命中 `protocol.md` §7「错误表」封闭性；R8-03 命中 `workflow.md` §7 取消语义与 Work 预算可用性（`reliability.md` §3）。**本包不具备进入独立 Test 的条件**，须先返工 R8-01..R8-03，并随返工处理 R8-04..R8-09 或（若坚持「仅按六条 AC 判验收」的口径）在结算材料中显式登记为非阻断遗留。
- 第三轮 N-11（`data.md:30` 的 `:ID` 记法 vs 代码哈希）仍是 **Product Decision Pending**，未消解。
- T9 仍未结算（属 Test 之后的阶段，非本轮代码判定项）：`docs/INDEX.md:26-30` 仍只列 WP-00/WP-01 并称 Work/Run 编排「仍未实现」；`docs/delivery/acceptance.md` 无 WP-02 证据登记；`implementation.md:146-148` 仍留「## T9 待办」。

---

## 2. 验证命令与原始结果

环境：`export PATH="$HOME/.local/bin:$PATH"`，工作目录 `/Users/huyaohua/huyh/work/aigrouptool`，全部在 `4580c02`、干净工作树上执行。原始日志：`/tmp/wp02-r8/cmds.log`（六条命令顺序执行，含退出码）。`node v24.8.0`、`pnpm 12.3.4`。

| 命令 | 退出码 | 关键原始输出 |
|---|---|---|
| `pnpm typecheck` | 0 | `$ tsc -p tsconfig.json --pretty false`（无错误输出） |
| `pnpm lint` | 0 | `Checking formatting...` / `All matched files use Prettier code style!` |
| `pnpm test:unit` | 0 | `Test Files  17 passed (17)` / `Tests  228 passed (228)`（与 T15 自述的 228 一致） |
| `pnpm test:integration` | 0 | `Test Files  10 passed (10)` / `Tests  124 passed (124)`（含真实 Docker 与 doctor 集成用例，未回退） |
| `pnpm docs:check` | 0 | `docs:check ok — 15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages` |
| `pnpm build` | 0 | `packages/contracts\|apps/cli\|packages/domain\|packages/storage\|packages/core\|packages/pi-runtime\|apps/runner build: Done`（7 个 workspace 全部 Done） |

`git log --oneline -3`：

```
4580c02 fix(core): WP-02 review round 7 findings (R7-01..R7-09)
f02aca4 fix(core): WP-02 review round 6 findings (R6-01..R6-10)
0211ced fix(core): WP-02 review round 5 findings (R5-01..R5-14, M-1..M-4)
```

`git status --porcelain`：无输出（复核开始时与本报告写入前各一次；`HEAD=4580c02e132f461bbae8d96788cd614f13ab55dd`）。`pnpm test:e2e|acceptance|live` 仍按契约 `NOT_IMPLEMENTED`，未执行。

### 2.1 本轮独立实验日志（`/tmp/wp02-r8/`）

| 日志 | 覆盖 | 断言结果 |
|---|---|---|
| `exp-a.log` | R7-01 畸形 spec 9 例；R7-07 拒绝副作用；**对抗：畸形 `authorizationRef` / `requiredOutputSchemas`** | 21 passed / **2 failed**（2 条即 R8-04） |
| `exp-b.log` | R7-02 幂等（同量同 cost / 只改 cost / 去 cost / 异 tokens）；R7-03；分数与非法 cost；预算不变式 | 31 passed / 0 failed |
| `exp-c.log` | R7-09 级联取消（未启动 vs 已启动子 Run）；无二次释放；DC-45 核销链路 | 20 passed / **2 failed**（即 R8-03 的对照面） |
| `exp-d.log` | R7-09 残留的预算后果：零消费取消 → 永久 `BUDGET_EXCEEDED`；级联 vs 直接取消的不对称 | 9 passed / 0 failed |
| `exp-e.log` | **对抗**：`requestDispatch` 畸形输入 9 例；`assess` 畸形载荷 6 例；`dispatch(contextPayload)` 非对象 | 8 passed / **13 failed**（即 R8-01/R8-02/R8-09） |
| `exp-f.log` | R7-06（DC-35）三组 Join 场景；R7-04 事件形状/排序 | 12 passed / 0 failed |
| `exp-g.log` | 对抗：required 失败后父可被 `completed`；超预留封顶；双花尝试；重复结算；终态回退 | 10 passed / 0 failed |
| `exp-h.log` | `measured:false` 带非零 tokens；补齐项 | 2 passed / 0 failed |

**实验卫生说明**：进入实验前先执行 `pnpm build` 再取 `dist`；`dist/` 被 `.gitignore` 忽略，不属产品代码改动。实验通过 `/tmp/wp02-r8/node_modules/@agentdev/*` 软链解析 workspace 包，等价复现 `orchestrator.test.ts` 的夹具但**不 import 产品测试文件**。`reconcile` 的公开入口是 `orchestrator.lifecycle.reconcile`（`Orchestrator` 只暴露 `settleRun`/`beginAttempt`），实验按此调用。`exp-a` 首轮有 1 条断言为夹具自身缺陷（`spec=null` 分支漏回传 `runs0`），修正夹具后重跑，产品相关结论不变。

---

## 3. R7-01..R7-09 逐条复核表

| 条目 | 七轮严重度 | T15/DC 修复声明（4580c02） | 复核判定 | 独立实验证据 |
|---|---|---|---|---|
| **R7-01** 畸形 spec 抛裸 `TypeError` | P2 | `dispatch` 先用契约 Schema 校验 spec（DC-58） | **已修复（verified）** | EXP-A：`contextSelection={goal:1}` / `undefined` / `{goal:'g'}`、`requiredOutputs=null` / `"str"`、未知字段、`spec=null`、`scope=null`、缺 `goal` 共 9 例全部 → `ProtocolError/VALIDATION_ERROR`（`name='ProtocolError'`），且 Run 数与三类快照行数均不增。代码：`orchestrator.ts:291` |
| **R7-02** `reconcile` 忽略 `cost` | P2 | 幂等判定同时比对 `tokensUsed` 与 `cost`（含 `null` 归一） | **已修复（verified）** | EXP-B：实测 1000（无 cost）后 `reconcile(1000,cost 5)` → `IDEMPOTENCY_CONFLICT`（预算与事件均不动）；`reconcile(2000,cost 3)` 同量同 cost → 无操作、0 新事件；只改 cost → 冲突（details 带 `recordedCost/requestedCost`）；去 cost → 冲突；未测量结算后 `reconcile(800,cost 0.0025)` → `used+800`、`cost=3.0025`、预留按 allocation 释放、Work `costKnown=true`；小数与 0.5 通过，`-1/NaN/Infinity` → `VALIDATION_ERROR`。**残留**：对已按实测结算的 Run 补录迟到的 cost 现在是硬冲突（R7-02 建议允许的两条路之一，代价是 cost 永久缺失）→ §7 剩余风险 4 |
| **R7-03** `measured:false` 带 cost | P3 | `measured:false` 时不允许携带 `cost` | **已修复（verified）** | EXP-B：`settleRun(completed,{measured:false,cost:9})` 与 `settleRun(cancelled,…)` 均 → `VALIDATION_ERROR`；Run 保持 `running`、该 Run 0 条 `run.ended`。代码：`run-lifecycle.ts:516-520` |
| **R7-04** `reconciliation` 计数恒 1 | P3 | 去掉该字段，事件顺序由 `cursor` 表达（DC-48 更新） | **已修复（代码）/记录残留（→ R8-06）** | EXP-F：未测量结算 + 核销后两条 `run.ended` 的 data 键无 `reconciliation`；`entityVersion` 均为 4、`cursor` 为 26/27（单调可排序）。**但 DC-48 正文并未记录游标/版本语义，「DC-48 更新」名不副实** |
| **R7-05** DC-48 写 `costKnown` | P3 | DC-48 字段名更正为 `runCostKnown` | **部分修复（→ R8-06，P3）** | EXP-F：事件 data 有 `runCostKnown`、无 `costKnown`；`discovery.md:126` 已改名。**但字段清单仍缺 `workId`/`chargedTokens`/`uncoveredTokens`/`cost`/`cancelledWithParent`，且 DC-52 声称的「entityVersion 会重复，这一点在 DC-48 记录」不成立** |
| **R7-06** DC-35 父状态描述 | P3 | 更正 required/非 required 子 Run 失败时父状态的差异 | **部分修复（→ R8-05，P3）** | EXP-F：单 required 子 Run 失败 → 父**停留 `running`**（从未进入 `waiting_children`）；两子 Run 中一个 required 失败、全部终态后 → 父**仍为 `waiting_children`**（`kind=blocked`）。而 `discovery.md:54` 仍写「required 子 Run 失败时父进入 `waiting_children`…子 Run 全部终态后才回到 `running`」，括注还称「原文笼统写父停留在 waiting_children，与实现不符」 |
| **R7-07** 被拒 dispatch 落快照 | P3 | 快照冻结移到全部准入判定之后，被拒无副作用（DC-58） | **部分修复（→ R8-04，P3）** | EXP-A：spec 级畸形与 `profileRevision` 陈旧等准入拒绝确实 0 新增；**但畸形 `authorizationRef`（非 UUIDv7）→ 三行快照 0→1；畸形 `requiredOutputSchemas`（缺 `schemaVersion`）→ dispatch 快照 1→2，两者仍以 `VALIDATION_ERROR` 结束**（校验发生在 `orchestrator.ts:382-386` 的 `dispatchSnapshotSchema`，晚于 `:355`/`:363`/`:377` 的冻结） |
| **R7-08** DC-46 枚举 / `§65` | P3 | 记录中 Work 状态改为真实取值；严重性引用改为 `workflow.md` §6 | **部分修复（→ R8-07，P3）** | 静态：`grep archived\|draft discovery.md` 无匹配，DC-46 六种状态与 `enums.ts:40-49` 的 `workStatusSchema` 一致 ✓；DC-53 已改 §6 ✓。**但 `discovery.md:167`（DC-56）与 `implementation.md:104`（T13）仍写「`workflow.md` §65」，该章节不存在（文件只有 §1..§8，严重性定义在 §6 第 65 行）** |
| **R7-09** 级联取消不释放未启动子 Run 预留 | P2 | 级联取消按「有无 Attempt」区分已知零与未知（DC-57） | **部分修复（→ R8-03，P2）** | EXP-C：父（20000）+ 未启动子（4000）+ 已启动子（4000），取消父后未启动子以 `usageMeasured:true/tokensUsed:0/releasedTokens:4000` 入账、已启动子保持 `measured:false`、预留 28000→24000 ✓。**EXP-C 反例 + EXP-D：直接取消一个同样无 Attempt 的 `queued` Run（例如未启动的 Chief），其自身仍 `usageMeasured:false/releasedTokens:0`，60000 预留永久占住** → 之后任何 60000 派发都 `BUDGET_EXCEEDED`（实际消费为零）；只能靠显式 `reconcile(0)` 解套，而它从未调用模型、不会有 Provider 报告来触发 |

**小结**：完全修好 4 条（R7-01/R7-02/R7-03/R7-04 代码）；部分修复 5 条（R7-05→R8-06、R7-06→R8-05、R7-07→R8-04、R7-08→R7-08 残留+→R8-07、R7-09→R8-03）。**第七轮的两个 P2 中 R7-02 真正关闭；R7-09 的修复只覆盖了子 Run 一侧，被取消 Run 自身仍留死预留。**「声称已修」与「实际覆盖」的落差集中在三处：`cancel` 自身路径、`authorizationRef`/`requiredOutputSchemas` 的校验时机、以及 `requestDispatch`/`assess` 两个协议入口（后者为新一轮发现）。

---

## 4. 第六/七轮对抗性观察复核

| 观察 | 处置 | 复核判定 | 证据 |
|---|---|---|---|
| ① `measured:false` 带非零 tokens 被静默丢弃 | `VALIDATION_ERROR` | **已修复（verified）** | EXP-H：`settleRun({5, measured:false})` → `VALIDATION_ERROR`，Run 仍 `running`、0 条 `run.ended`。代码 `run-lifecycle.ts:509-515` |
| ② `reconcile` 判定在事务外 | 判定与写入同事务 | **已修复（verified）** | 静态：`run-lifecycle.ts:233-250` 的 `settlementOf` 在 `withTransaction` 回调内；EXP-B 行为一致 |
| ③ `JoinCoordinator` 无生产调用方 | 登记为观察 | **未变（记录准确）** | `grep -rn JoinCoordinator packages apps --include=*.ts` 仅 `join.ts:75` 定义与 `join.test.ts`；无生产消费方，AC-046 目前只由测试驱动 |

---

## 5. 新 Findings（R8-01..R8-09）

### R8-01 [P2] `Orchestrator.requestDispatch`（协议方法 `agent.request_dispatch` / AC-045 入口）完全不校验契约：畸形输入抛裸 `TypeError`，非法字段被原样持久化

- 位置：`packages/core/src/orchestrator.ts:436-576`（`481-494` 的 `(input.sourceRefs ?? []).map(...)` / `[...(input.requiredOutputs ?? [])]`；`551-567` 的事件 data 直接落 `goal`/`stage`/`budgetAllocation`/`operationId`）。
- 事实（EXP-E，均经公开入口 `orchestrator.requestDispatch`）：
  - `sourceRefs: 'oops'` → `TypeError: (input.sourceRefs ?? []).map is not a function`（`isProtocol=false`，无 `code`）；
  - `requiredOutputs: 5` → `TypeError: (input.requiredOutputs ?? []) is not iterable`；
  - `sourceRefs: [null]` → `TypeError: Cannot read properties of null (reading 'kind')`；
  - `goal: 123` → **接受**，`chief_action_required.data.goal === 123`；
  - `stage: 42` → **接受**，`data.stage === 42`；
  - `budgetAllocation: -5` → **接受**，`data.budgetAllocation === -5`；
  - `operationId: 123` → **接受**，`data.operationId === 123`、`operationIdSource='client'`；
  - 对照：未知 `requestedRole` 走 `validateRolePurpose` → `VALIDATION_ERROR`（说明该校验并非遗漏，而是只有这一条）。
- 依据：`protocol.md` §6 明确 `agent.request_dispatch*（专业） | workId,reason,requestedRole,goal,sourceRefs`；§1「必填参数缺失、**未知字段**或枚举错误返回 `VALIDATION_ERROR`」；AC-045（`acceptance.md:285`）明文点名「调用 `request_dispatch`」。`goal`/`sourceRefs` 都是文档化必填参数。
- 影响：与 R7-01 同类（Core 入口畸形输入以未定义错误形态逃逸）。协议层一旦接线，`agent.request_dispatch` 的坏载荷会抛未捕获异常（通常断连或 500），且 `goal`/`stage`/`budgetAllocation` 的坏值会进入持久事件与后续派生指纹，Chief 侧读到 `goal=123` 之类事实。因 `requestDispatch` 尚未接入 mailbox/协议层（与 R7-01 同一可达性理由），**不判 P1**；但 T14 声称的「Core 入口的契约校验统一转成 `VALIDATION_ERROR`」在此被证伪，故判 **P2 且本包必修**。
- 建议：给 `requestDispatch` 增加 `strictObject` Schema（覆盖 §6 五个文档化参数 + 现有扩展字段），或在函数首行用 `parseOrFail` 校验整包；`budgetAllocation` 复用 `nonNegativeIntSchema`。补负例测试：畸形 `sourceRefs`/`requiredOutputs` → `VALIDATION_ERROR`，非字符串 `goal` → `VALIDATION_ERROR`。

### R8-02 [P2] `Orchestrator.assess`（协议方法 `assessment.submit`）不校验契约：裸 `TypeError` 与协议外的 `StorageError/CONSTRAINT_VIOLATION`

- 位置：`packages/core/src/orchestrator.ts:220-277`（`227-234` 读 `payload.intent`/`payload.riskFlags.includes`；`249-261` 的 `assessments.insert` 直接落字段）。
- 事实（EXP-E）：
  - `payload: null` → `TypeError: Cannot read properties of null (reading 'intent')`；
  - `payload.riskFlags: null` → `TypeError: ... (reading 'includes')`；`riskFlags: 5` → `TypeError: payload.riskFlags.includes is not a function`；
  - `payload.uncertainties: null` → `TypeError: payload.uncertainties is not iterable`；
  - `level: 'B2'` → `StorageError/CONSTRAINT_VIOLATION`（`isProtocol=false`）；`intent: 123` → 同样 `StorageError/CONSTRAINT_VIOLATION`；
  - 对照：合法载荷正常写入 `assessment` + `assessment.saved`。
- 依据：`protocol.md` §6 首行方法即 `assessment.submit* | workId,assessment:Assessment`；§1 要求 `VALIDATION_ERROR`；§7 的**错误表是封闭集合**，其中没有 `CONSTRAINT_VIOLATION`，「一个请求只有一个终结 response：`{ok:false,error:{code,…}}`」要求错误码取自该表。`CONSTRAINT_VIOLATION` 是存储层错误（`StorageError`），不是协议错误。
- 影响：与 R8-01 同类；且错误形态是「存储层内部错误」而非协议错误，协议层无法映射为合法 response。可达性同 R8-01（未接线），判 **P2 且本包必修**。
- 建议：在 `assess` 入口用 `assessmentPayloadSchema`（`structures.ts:36` 已存在）`parseOrFail`，再做路由判定与写库；补负例测试（`payload=null`、`riskFlags` 非数组、非法 `level`/`intent` → `VALIDATION_ERROR`）。

### R8-03 [P2] R7-09 残留：级联取消只释放「子 Run」，被取消的 Run 自身（同样无 Attempt）仍留永久死预留；零消费取消即可让 Work 永久 `BUDGET_EXCEEDED`

- 位置：`packages/core/src/run-lifecycle.ts:193-211`（`cancel` 用默认 `{tokensUsed:0, measured:false}`）、`:428-447`（只有 `cancelDescendants` 做「有无 Attempt」判定）、`:148-158`、`:410-420`；测试 `packages/core/test/orchestrator.test.ts:753-757`；记录 `.agentdev/work/WP-02/discovery.md:169-171`（DC-57）。
- 事实（EXP-C / EXP-D）：
  - 父 Run（20000）+ 未启动子（4000）+ 已启动子（4000）：取消父后未启动子 `usageMeasured:true/tokensUsed:0/releasedTokens:4000`、预留 28000→24000 ✓（R7-09 生效）。
  - **但父 Run 自己也没有 Attempt**（`chiefRun()` 只 dispatch，`attempts.list(run_id=父)` 长度为 0），其事件却是 `usageMeasured:false/runCostKnown:false/releasedTokens:0`，60000 预留原地不动。
  - 后果实测：`tokenLimit=100000`，派发一个 `queued` 的 60000 Chief 后 `settleRun(chief,'cancelled')` → `reserved=60000`；随后任何 60000 的派发 → `BUDGET_EXCEEDED: used 0 + reserved 60000 + 60000 exceeds 100000`。该 Run 从未调用模型，却在 `reconcile(0)` 之前永久占住额度；而 WP-10 的 Provider 用量路径不会有它的报告，`reconcile` 不会被触发。
  - 测试自述与夹具事实不符：`orchestrator.test.ts:753` 注释写「**The cancelled parent did run**, so its own hold stays unknown for reconciliation」并断言 `after === chief.budgetAllocation`；但同测试里 `chief = chiefRun()` 从未 `beginAttempt`，父 Run **没有运行过**。该错误前提正是「两条规则不应共用」这一结论的来源。
- 依据：DC-57 自己给出的规则是「按该 Run 是否有 Attempt 区分——无 Attempt ⇒ `measured:true, tokensUsed:0`（立即释放预留）」，理由正是「否则父 Run 取消后死预留会占住 Work 额度，后续派发被 `BUDGET_EXCEEDED` 拒绝（实际消费为零）」。同一规则未施加于被取消的 Run 本身，规则自相矛盾。`workflow.md` §7 的取消语义与 `reliability.md` §3（未知 usage 才保持预留）都支持「未启动即已知零」。
- 影响：零消费的取消会永久消耗 Work 预算可用性，直到有人显式 `reconcile(0)`（无自然调用方）。这与第七轮把 R7-09 定为 P2 的后果同源，故判 **P2 且本包必修**。
- 建议：把「无 Attempt ⇒ 已知零」判据抽成一处，同时用于 `cancel()` 自身（`started === false` 时把自身 usage 也视为 `{0, measured:true}`）与 `cancelDescendants`；或让 `settle/cancel` 在没有 Attempt 时默认 `measured:true, tokensUsed:0`。同步修正 `orchestrator.test.ts:753` 的注释与断言（父 Run 未启动，其预留也应释放），并补「取消未启动 Chief 后可再次派发同额 Run」的回归测试。

### R8-04 [P3] R7-07 残留：畸形 `authorizationRef` / `requiredOutputSchemas` 仍在快照冻结之后才校验，被拒请求留下三行快照——DC-58/T15「被拒 dispatch 无副作用」不成立

- 位置：`packages/core/src/orchestrator.ts:291`（spec 校验）、`:353-354`（注释「only a Run that will really be created may leave snapshots behind」）、`:355`/`:363`/`:377`（config/context/dispatch 冻结）、`:382-386`（`dispatchSnapshotSchema` 校验，**晚于冻结**）；`.agentdev/work/WP-02/discovery.md:173-175`（DC-58）。
- 事实（EXP-A）：spec 完全合法，仅 `authorizationRef: 'not-a-uuid'` → `ProtocolError/VALIDATION_ERROR: dispatch snapshot is invalid: authorizationRef: expected a lowercase UUIDv7`，但快照行 `config 0→1, context 0→1, dispatch 0→1`；`requiredOutputSchemas: [{kind:'x'}]`（缺 `schemaVersion`）→ 同样 `VALIDATION_ERROR`，dispatch 快照 1→2。Run 行数保持 0。
- 依据：`protocol.md` §1「一个请求只有一个终结 response」；DC-58 与 T15（`implementation.md:141`）都把它写成绝对声明「快照冻结移到全部准入判定之后，被拒 dispatch 无副作用」「测试断言被拒后 Run 与快照行数均不变」。`Orchestrator.assess`/`dispatch` 的其他失败面已 fail-closed，此处不是。
- 影响：与 R7-07 同级的持久副作用面（内容寻址行随无效请求增长，`config` 快照还可能因 `runParams` 差异逐次增长）。判 P3。
- 建议：把 `dispatchSnapshotSchema` 的校验（或至少 `authorizationRef`/`requiredOutputSchemas` 的独立 Schema 校验）提到任何 `freeze` 之前；补测试「畸形 `authorizationRef`/`requiredOutputSchemas` 被拒后快照行数不变」。

### R8-05 [P3] R7-06 残留：DC-35 正文在 required 失败时的父状态仍与实现不符，「更正」括注本身也不准确

- 位置：`.agentdev/work/WP-02/discovery.md:54` 对比 `packages/core/src/join.ts:182-222`（`:204-214` 在 `pending.length===0 && failedRequired.length>0` 时提前 `return blocked`，跳过 `:220-222` 的 `waiting_children → running`）。
- 事实（EXP-F）：
  - 单 required 子 Run 失败（父从未因它进入等待）→ 父保持 `running`，`kind=blocked`；
  - 两 required 子 Run 中一个失败、另一个随后完成 → 父先进 `waiting_children`，全部终态后**仍为 `waiting_children`**，`kind=blocked`；
  - 两子 Run 都成功 → 父回 `running`，`kind=ready`。
  - DC-35 现行正文「required 子 Run 失败时父进入 `waiting_children` 并等 Chief 处理，**子 Run 全部终态后才回到 `running`**」在第一个场景下父根本没进 `waiting_children`，在第二个场景下父没有回到 `running`；括注「原文笼统写『父停留在 waiting_children』，与实现不符」与实测（有在场兄弟时确实停留）方向相反。
- 依据：DC-35 是 AC-046「新 Chief 消息可处理」的实现依据；错误的父状态描述会让 WP-05 监督误判。功能上两种状态都仍可受理命令（`ACTIVE_PARENT_STATUSES` 含二者），故 P3。
- 建议：改为「仅有 `join=all` 子 Run 在场时进入/保持 `waiting_children`；全部终态且无 required 失败 → 回 `running`；required 失败 → 保持当前状态并交付 blocked 结果」，并删除不准确的「更正」括注。

### R8-06 [P3] R7-04/R7-05 记录残留：DC-48 字段清单仍不完整，且 DC-52 指向 DC-48 的「已记录」不成立

- 位置：`.agentdev/work/WP-02/discovery.md:126`（DC-48）与 `:150`（DC-52 第三条 bullet）；代码 `packages/core/src/run-lifecycle.ts:352-373`、`:264-283`。
- 事实（EXP-F，实测事件 data 键）：常规终态 `[outcome, workId, tokensUsed, chargedTokens, uncoveredTokens, usageMeasured, runCostKnown, releasedTokens, cost]`；核销补发另有 `reconciled`；级联取消子 Run 另有 `cancelledWithParent`；`contract_violation` 另有 `attemptId/rejections/reason`。而 DC-48 只列 `outcome/usageMeasured/runCostKnown/tokensUsed/releasedTokens`，**缺 `workId`、`chargedTokens`、`uncoveredTokens`、`cost`、`cancelledWithParent`**；第七轮 R7-05 的建议正是「补 `chargedTokens/uncoveredTokens` 与字段层级说明」。
- 同时 DC-52 写「Run 行不变因此 `entityVersion` 会重复，**这一点在 DC-48 记录**」，但 DC-48 全文未提 `cursor`/`entityVersion`/排序语义。
- 依据：DC-48 是「消费方一致性」的实现约定条目，WP-08/WP-09 的 WS/BFF/UI 据此消费事件；字段缺失会让承接方漏读 `chargedTokens`/`cost`。同属「记录声称与仓库不符」。判 P3。
- 建议：DC-48 改为完整字段清单并说明层级（Work 级 `costKnown` vs 每 Run `runCostKnown`、`tokensUsed` vs `chargedTokens` vs `uncoveredTokens`），补「核销事件复用 `entityVersion`、顺序以 `cursor` 为准」一句（该句当前只在 DC-52，且引错了章节，见 R8-08）。

### R8-07 [P3] R7-08 残留：DC-56 与 T13 仍引用不存在的 `workflow.md` §65，而 T15 声称已改为 §6

- 位置：`.agentdev/work/WP-02/discovery.md:167`（DC-56：「第六轮 Review 按 `workflow.md` §65 把 R6-01 定为 P1」）、`.agentdev/work/WP-02/implementation.md:104`（T13：「按 `workflow.md` §65 应为 P1」）对比 `docs/rules/workflow.md`（只有 §1..§8，严重性定义在 §6，位于该文件第 65 行）。
- 事实：`grep -rn "§65" .agentdev docs` 仍命中上述两处（DC-53 已改为 §6）。而 T15（`implementation.md:142`）声明「R7-08：…严重性引用改为 `workflow.md` §6（第 65 行）」。
- 影响：失效章节引用会让承接方找不到定义；`docs:check` 只校验文档间链接，不校验章节号，故未拦住。判 P3。
- 建议：把两处 `§65` 改为 `§6`。

### R8-08 [P3] 失效引用与注释不实：事件游标顺序记为 `data.md` §5；`contextSelection.readPaths` 字段不存在；「charges tokensUsed」与封顶实现不符

- 位置与事实：
  1. `packages/core/src/run-lifecycle.ts:268`（注释「the event's own `cursor` is the order ("data.md" §5)」）与 `.agentdev/work/WP-02/discovery.md:150`（「事件顺序由事件自身的 `cursor` 表达（`data.md` §5）」）：`data.md` §5 是「数据迁移与保留」，**游标单调性定义在 §2 第 39 行**（`event | cursor:integer PK … | cursor单调；不可变`）。引用章节错误。
  2. `packages/core/src/orchestrator.ts:289`（注释「`validateDispatchSpec` reads fields such as `contextSelection.readPaths`」）：`contextSelectionSchema`（`structures.ts:51-65`）没有 `readPaths`，只有 `codePaths`（`:57`；`readPaths` 属 `scopeSchema`）。注释指向不存在的字段。
  3. `packages/core/src/run-lifecycle.ts:7`（「measured usage releases the reservation and charges `tokensUsed`」）：自 DC-50 起实际按 `chargedTokens = min(tokensUsed, budgetAllocation)` 封顶计费，`tokensUsed` 只是 Provider 原始值。
- 依据：本轮 required 检查项为「注释/记录声称与代码是否一致」。判 P3（纯记录/注释）。
- 建议：三处分别改为 `data.md` §2、`contextSelection.codePaths`、`charges chargedTokens (capped at the reservation)`。

### R8-09 [P3] `dispatch` 的 `contextPayload` 无任何契约校验：非对象载荷被接受并写入读不回来的 `context` 快照行

- 位置：`packages/core/src/orchestrator.ts:363-366`（`input.contextPayload ?? fallbackContext`，仅用 `as unknown as JsonObject` 过桥，无 Schema）与 `packages/core/src/snapshots.ts:59-92`（`freeze` 不校验 payload）、`:36`（读路径裸 `snapshotSchema.parse`）。
- 事实（EXP-E）：`dispatch({ spec, contextPayload: ['not','an','object'] })` → **接受**，随后 `snapshots.byType('context')` 抛裸 `ZodError`（`payload: expected record`）。该行一旦落库，任何按类型列出/读取 context 快照的路径都会异常。
- 影响：`contextPayload` 由 WP-06 ContextBuilder 提供，当前默认只有 fallback，故可达性有限；但 `freeze` 对 payload 无校验使写路径可以制造非法行，与 round-7 剩余风险 #9（读路径裸 ZodError）叠加。判 P3。
- 建议：`SnapshotWriter.freeze` 对 payload 做 `jsonObjectSchema` 校验（或 `dispatch` 对 `contextPayload` 先 `parseOrFail`），失败时 `VALIDATION_ERROR`。

---

## 6. 本包必修 vs 其他包显式缺口（承接核对）

| 事项 | 归属判定 | 承接登记核对 | 结论 |
|---|---|---|---|
| R8-01 `requestDispatch` 无契约校验（P2） | **本包必修** | — | `orchestrator.ts` 本包代码；AC-045 点名 `request_dispatch` |
| R8-02 `assess` 无契约校验（P2） | **本包必修** | — | `orchestrator.ts` 本包代码；`protocol.md` §6 首行方法 |
| R8-03 取消自身死预留（P2） | **本包必修** | — | `run-lifecycle.ts` + DC-57 规则不一致 |
| R8-04 畸形 ref/schemas 留快照（P3） | **本包必修**（小） | — | `orchestrator.ts:355-386` |
| R8-05 DC-35 正文（P3） | **本包记录缺陷** | — | `discovery.md:54` |
| R8-06 DC-48/DC-52（P3） | **本包记录缺陷** | — | `discovery.md:126/150` |
| R8-07 `§65`（P3） | **本包记录缺陷** | — | `discovery.md:167`、`implementation.md:104` |
| R8-08 失效引用/注释（P3） | **本包记录/注释缺陷** | — | `run-lifecycle.ts:7/268`、`orchestrator.ts:289` |
| R8-09 `contextPayload` 无校验（P3） | **本包必修**（小） | — | `orchestrator.ts:363`、`snapshots.ts:59` |
| R5-11 终态 Work 仍可 dispatch | 承接 **WP-05** | DC-46 标题与正文已覆盖（举例已修正）；`docs/delivery/implementation.md` WP-05 条目仍不含 Work 状态投影/WorkBlocker | **DC 已登记但承接条目未确认**（连续第五轮） |
| Q-06/DC-40/DC-47 父 Run 额度口径 | 待产品确认的实现约定 | `discovery.md:89-91`、`:120-122` | **已登记，等待产品方决定** |
| DC-42 Work `blocked(provider)` | 承接 **WP-05** | DC-42 声明 WP-05；WP-05 条目无该职责 | **承接归属存疑（连续第五轮）** |
| DC-45 真实 usage/成本读取与核销**调用方** | 承接 **WP-10** | DC-45 声明 WP-10；条目未点名 usage/预算核销 | 承接可对应；WP-10 须消费 `reconcile`（并处理 R7-02 残留：已实测 Run 的迟到 cost 现在是硬冲突） |
| DC-55 `uncoveredTokens` 不产生 Work 级预算阻断 | 承接 **WP-05** | `discovery.md:161-163` 已登记 | 已登记 |
| DC-38 `runParams` 无授权来源 | 承接 **WP-04/WP-07** | `discovery.md:81-83` | 归属偏 WP-07，后续包未启动 |
| DC-39 Join 无协议事件（读模型） | 承接 **WP-08** | `discovery.md:85-87` | 归属与 WP-08/WP-09 条目均不完全吻合，跨包风险 |
| N-11（RE-06）`data.md` `ID` vs 哈希 | **Product Decision Pending** | `discovery.md:72` | 未消解前不得判 Completed |

补充事实：除 `.agentdev/work/{WP-00,WP-01,WP-02}` 外，承接包（WP-04..WP-10）均尚无独立过程记录目录，故「承接」仍只能由 DC 条目声明，无法在承接包侧交叉验证。

---

## 7. 未验证 / 无法验证项与剩余风险

1. **`release` 仍不校验预留归属**（`run-lifecycle.ts:93-102`，`Math.max(0, reserved-allocation)`）：第六轮建议的 fail-closed 未采纳。经本轮全部路径排查（每个 Run 的 allocation 只在 `dispatch` 内 `reserve` 一次；`settleBudget` 的 measured 分支只在「该 Run 尚无 measured 事件」时执行），当前**不可达**重复释放；但 R8-03 若按建议改动（取消自身也按已知零释放），需确保与 `settlementOf` 判定共用同一判据，否则会重新打开超发面。属加固建议。
2. **R7-02 的语义取舍**：对「已按实测结算、但当时没有 cost」的 Run，补录迟到 cost 现在是硬 `IDEMPOTENCY_CONFLICT`，该 Run 的 `budget.cost` 永久缺失。这符合第七轮 R7-02 建议中「或允许补录 cost 并把该分支明确为幂等更新」的**另一条**路的反面，属已接受取舍；WP-10 接线前应确认「先 token 后金额」的真实顺序不会成为常态。
3. **真实并发**：全部实验单线程。`requireBudget`/`canAllocateBudget` 在事务外判定、`reserve` 在事务内（`orchestrator.ts:329-332` vs `:391`），`requestDispatch` 的派生键去重也在事务外（`:496-525`）；单 mailbox 串行下不可达，本轮未做并发压测。
4. **required 失败后父 Run 可被 `completed`**（EXP-G，`settleRun(chief,'completed')` 在 required 子 Run 已失败时成功）：`RunLifecycle.end` 只对「仍有在场 `join=all` 子 Run」拒绝完成，不对「required 子 Run 已失败」fail-closed。这也可以是**产品语义**（Chief 收到 `chief_action_required` 后决定「就此完成」是合法决策），故本轮只作观察、不列编号 Finding；但完成后待办无人可行动（`canParentDispatch(completed)=false`）这一点应在 WP-05/WP-08 明确。
5. **`reconcile` 无幂等键**：`operationId` 未进入 `reconcile` 签名，调用方无法表达「这次核销是哪次请求的重放」；R7-02/R7-04 的语义都源于此。WP-10 接线前应决定是否给它加键。
6. **`JoinCoordinator` 无生产调用方**（对抗性观察 ③）：AC-046 目前只由测试驱动；WP-05 需消费 `onChildSettled`/`state`。
7. **`beginAttempt` 无法恢复 `paused` Run**（第四至七轮未变）：`run-lifecycle.ts:110-118` 对 `paused` 抛 `VALIDATION_ERROR`，而 `domain/transitions.ts:127-129` 的 `runAcceptsNewAttempt` 把 `paused` 视为可新 Attempt。Checkpoint 恢复归 WP-05。
8. **`settleRun` 非幂等**：重复结算抛 `VALIDATION_ERROR`（无 `operationId`）；WP-05 的 at-least-once 监督重放需自行保证只调用一次。
9. **`timed_out` 终态不可达**：`TerminalRunStatus` 只含 `completed/failed/cancelled`；`run.ended` 的写入路径中无 `timed_out`。归 WP-05 监督。
10. **`snapshots.ts:36` 仍用裸 `snapshotSchema.parse`**：读路径（`read`/`find`/`byType`）解析 DB 行，异常形态为 `ZodError`。R8-09 证明它可被写路径触发（非对象 `contextPayload`），不再只是「row 被外部破坏」。
11. **真实 Provider 调用与 Secret**：`GatewayTransport`/`SecretResolver` 仍为注入缝（DC-31），AC-043「不同 Provider」仍只是结构验证。
12. **ContextBuilder/上下文内容与 token 计量**：`dispatch` 的 `contextPayload` 仍只有 fallback（`orchestrator.ts:358-362`），属 WP-06；AC-082 的工具层负例归 WP-07。
13. **`readLedgerHash` 真实性**：`stage.ts` 只做 64 位十六进制 Schema 校验，未与读账本核对（WP-05/WP-06）。
14. **事件消费者端到端兼容性**：R8-06 的字段语义与 WS/BFF/UI（WP-08/WP-09）未实现，本轮只做协议/文档静态判定。
15. **`test:e2e`/`test:acceptance`/`test:live`**：按契约 `NOT_IMPLEMENTED`，未执行。
16. **结算未完成（T9 待办）**：`docs/INDEX.md:26-30` 仍只列 WP-00/WP-01；`docs/delivery/acceptance.md` 无 WP-02 证据登记；`implementation.md:146-148` 仍留「## T9 待办」。本次 Review 只判定「实现是否成立与可否进 Test」，不判定「结算是否完成」。
17. **N-11 产品决定**：`data.md:30` 的三个 `:ID` 快照引用与实现的哈希并存，属 `Product Decision Pending`。

---

## 8. 方法与边界声明

- 本报告只依据仓库文件、`4580c02` 上的 git 对象/差异与实跑命令；未读取任何开发对话、未引用外部同名技能或历史方案。
- 唯一写入文件为本文件 `.agentdev/work/WP-02/review.md`；实验脚本独立写在 `/tmp/wp02-r8/`（`fixture.mjs`、`exp-a..h.mjs` 与对应 `.log`），使用 `pnpm build` 产出的 `packages/*/dist`，通过 `/tmp/wp02-r8/node_modules/@agentdev/*` 软链解析 workspace 包，等价复现 `orchestrator.test.ts` 的夹具但**不 import 产品测试文件**。
- 未修改产品代码、测试、`docs/**`、`plan.md`、`implementation.md`、`discovery.md`；`pnpm build` 只写 `.gitignore` 中的 `dist/`。写入本报告前 `git status --porcelain` 无输出、`HEAD=4580c02e132f461bbae8d96788cd614f13ab55dd`。
- 本报告覆盖了第七轮 `review.md`；第七轮全文可用 `git show f02aca4:.agentdev/work/WP-02/review.md` 取回，第六/五/四/三/二/一轮分别用 `git show 0211ced:…`（即 `0211ced` 树上的本文件，为第六轮原文）、`git show 5a87a86:…`、`git show 411d04f:…`、`git show a8daa6d:…`、`git show c4763d5:…`、`git show 785bdd6:…` 取回。
