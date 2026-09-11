# WP-02 独立 Review 报告（第七轮）

- 评审对象：工作包 WP-02「主管与独立Agent调度」
- 评审轮次：**第七轮**（逐条复核第六轮 R6-01..R6-10 与对抗性核验的 3 条观察是否真修，并找新问题）
- 冻结点：git `f02aca4`（`fix(core): WP-02 review round 6 findings (R6-01..R6-10)`），前置 `0211ced`
- HEAD 校验：`git rev-parse HEAD` = `f02aca4518430e713e0869a33db2e5024b0ccc5c`
- 工作树：复核开始时与本报告写入前 `git status --porcelain` 均无输出（`pnpm build` 只写被 `.gitignore` 忽略的 `dist/`）
- 评审角色：Review（独立上下文，未读取任何开发对话；只依据仓库文件、git 对象与我自己的实验）
- 权威依据：`AGENTS.md`、`docs/INDEX.md`、`docs/rules/{workflow,agents}.md`、`docs/architecture/{ARCHITECTURE,data,protocol,reliability,context}.md`、`docs/delivery/{implementation,acceptance}.md`（WP-02 与 AC-043/044/045/046/047/082）、`.agentdev/work/WP-02/{plan,implementation,discovery}.md`、`packages/core/src` 全部、`packages/domain/src/{dispatch,transitions}.ts`、`packages/contracts/src/entities/{run,structures}.ts`、`packages/contracts/src/enums.ts`、`packages/core/test`
- 方法：逐行核对「注释/记录声称」与代码；在 `/tmp/wp02-r7/` 自建夹具与 4 组实验脚本 + 4 组定向探针（`fixture.mjs`、`exp-a/b/c.mjs`、`probe1..4.mjs`），用 `pnpm build` 产出的 `packages/*/dist` 独立复现；**不修改产品代码、测试、`docs/**`、`plan/implementation/discovery`**。
- 工具：`node v24.8.0`、`pnpm 12.3.4`

---

## 0. 历史轮次结论摘要（保留，第一至六轮）

**第一轮（`785bdd6`）FAIL：1×P1、5×P2、7×P3（R-01..R-13）。**
P1＝`stage.submit` 无终态/epoch 守卫；P2＝「父等待可接消息」证据空洞、`joinPolicy=none` 未实现、持久事件名偏离 `protocol.md` §7、越界写入 Plan、`run.ts` 快照引用改哈希与 `data.md` 冲突。全文：`git show c4763d5:.agentdev/work/WP-02/review.md`。

**第二轮（`c4763d5`）FAIL：0×P1、5×P2、6×P3（N-01..N-11）。**
含 `contract_violation` 不释放预算、非 running 仍接受交付、自造 Join 事件名、终态父 Run 仍收新子 Run、重复 `chief_action_required`、二次 Schema 失败在 `paused` 抛错等。全文：`git show a8daa6d:…`。

**第三轮（`a8daa6d`）FAIL：1×P1、2×P2、2×P3（M-01..M-05）＋对抗性核验 D1..D5。**
M-01（P1）＝父 Run 级预算预留从不释放；M-02＝预算只预留/释放不核销；M-03＝`Work blocked(provider)` 未落地。D1..D5 **不是**第三轮报告条目（口径更正见 `implementation.md:90`）。全文：`git show 411d04f:…`。

**第四轮（`411d04f`）FAIL：0×P1、3×P2、7×P3（Q-01..Q-10）＋对抗性核验 H-01..H-03。**
Q-01（`operationId` 只按键去重不校验载荷）、Q-04（父 Chief Run 可在 `join=all` 子 Run 未终态时被结算）为本包必修。H-01..H-03 只由开发方 T12 登记描述，第四轮报告中没有这三条。全文：`git show 5a87a86:…`。

**第五轮（`5a87a86`）FAIL：0×P1、5×P2、9×P3（R5-01..R5-14）＋对抗性核验 M-1..M-4。**
R5-01（指纹漏字段）、R5-02（`settleRun(...,'cancelled')` 绕过守卫）、R5-03（超限 usage 卡死）、R5-04（`reconcile` 不幂等）、R5-05（`join=none` 孤儿待办）为必修；`H-03` 全仓无定义（R5-14）。全文：`git show 0211ced:` 之前对象即第五轮原文。

**第六轮（`0211ced`）FAIL：1×P1、2×P2、7×P3（R6-01..R6-10）＋对抗性核验另补 3 条观察。**
R6-01（P1）＝`reconcile` 对已按实测结算的 Run 二次核销 → 双重计费 + 吃掉在场 Run 预留 → Work 实际承诺超出 `tokenLimit`（实测超发 4000）；R6-02（P2）＝`cost` 只进事件不进 Work 预算且分数金额被拒；R6-03（P2）＝`settleRun(...,'cancelled',usage)` 静默丢弃实测用量；R6-04..R6-10（P3）。对抗性观察 3 条＝①`measured:false` 带非零用量被静默丢弃、②`reconcile` 判定在事务外、③`JoinCoordinator` 目前无生产调用方。全文：`git show 0211ced:.agentdev/work/WP-02/review.md`（本轮覆盖写入后仍存于该提交对象）。

**追溯口径（沿用第五轮已采纳的 DC-53/DC-56 口径）**：行为/需求缺失＝P1（阻断）；局部质量/维护＝P2；建议＝P3。P2/P3 是否阻断由本轮按 `workflow.md` §6「影响验收则阻断」判定。

---

## 1. 本轮结论

**FAIL（Review Failed）——第六轮 R6-01 这一唯一的 P1 已实测确认修好（无新 P1）；但第六轮的 10 条中有 5 条只算部分修复（R6-02、R6-05、R6-06、R6-08、R6-10），其中 R6-02 与 R6-10 的残留是本包必修代码缺陷（→ R7-02、R7-01），另发现 6 条 P3。本轮共 8 条新 Finding：0×P1、2×P2、6×P3。**

- **逐条复核（§4、§5）**：
  - **完全修好（实跑 verified）**：**R6-01**（同量重放零变化、异量 `IDEMPOTENCY_CONFLICT`、跨事件页仍幂等、兄弟 Run 预留完好、Work 不再超发）、**R6-03**（取消路径实测用量入账并按预留封顶）、**R6-04**（异量 `IDEMPOTENCY_CONFLICT`）、**R6-09**（缺省 `operationId` 派生指纹键：同请求 1 条待办、异请求 2 条、显式键冲突仍拒）。
  - **部分修复**：**R6-02**（首次核销/实测结算确实写入 `budget.cost` 且接受分数，但**同一 `tokensUsed` 下只改 `cost` 的调用被当作「重放」静默丢弃** → R7-02）；**R6-05**（核销事件确实新增 `reconciliation` 字段，但因第二次核销不可能发生，该计数恒为 1，未提供事件间排序能力，`entityVersion` 仍与首次终态事件重复 → R7-04）；**R6-06**（代码已改名 `runCostKnown`、事件内无 `costKnown`，但 **DC-48 正文仍写事件 data 含 `costKnown`** → R7-05）；**R6-08**（DC-35 已改写，但新正文「子 Run 全部终态后才回到 `running`」在 required 子 Run 失败时仍与实现不符 → R7-06）；**R6-10**（ZodError 已转为 `VALIDATION_ERROR`，但 malformed `contextSelection`/`requiredOutputs` 仍抛**裸 `TypeError`**，T14「统一转成 VALIDATION_ERROR」被证伪 → R7-01）。
  - **记录补齐、无法独立核对（记录）**：**R6-07**（M-2）——`discovery.md:167`（DC-56）已给出定义（「`run-lifecycle.ts`/`stage.ts` 注释声称预留已释放、与实现不符」）；我逐条核对了当前源码注释，未发现与「未测量时保持预留」相矛盾的表述（`run-lifecycle.ts:7-13/164-167/215-219/399-403`），与 DC-56 的「已在 T13 修正」自洽；但第五轮对抗性核验的原始清单不在仓库内，**该定义本身无法独立验证**。
  - **对抗性观察 3 条**：① 已修（`measured:false` 且 `tokensUsed>0` → `VALIDATION_ERROR`，实测）；② 已修（`settlementOf` 判定移入 `withTransaction`，`run-lifecycle.ts:233-250`）；③ **未变**（`grep -rn "JoinCoordinator" packages apps` 仅命中 `join.test.ts`，Join 仍无生产调用方；T14 已登记为观察）。
- **新问题（§6）**：**R7-01**（P2，malformed spec 抛裸 `TypeError`，T14 声称已统一为 `VALIDATION_ERROR`）、**R7-02**（P2，`reconcile` 幂等比较忽略 `cost`，只改 cost 的核销被静默丢弃 → `budget.cost` 永久缺失，违反 DC-45/R6-02 的修好声明）；**R7-03..R7-08**（P3：`settle(measured:false, cost>0)` 静默丢 cost、`reconciliation` 恒为 1 且版本重复、DC-48 仍写 `costKnown`、DC-35 在 required 失败时仍不准、被拒 dispatch 仍落一张 dispatch 快照行、DC-46 引用不存在的 Work 状态 `archived`/`draft` 且 DC-53/DC-56 引用不存在的 `workflow.md` §65）。
- **判定**：按 `workflow.md` §6，无 P1；但 R7-01 与 R7-02 是**本包必修**（同一 `packages/core` 代码，且分别是 T14 明文声称已修条目的残留，不是承接包缺口）。R7-01 命中 `protocol.md` §1「未知字段/枚举错误返回 `VALIDATION_ERROR`」，R7-02 命中 DC-45/R6-02 的「计入 `cost`」与 `protocol.md` §1「同键不同载荷拒绝」的反面（`reconcile` 无幂等键却对载荷差异静默无操作，与第六轮判为必修的 R6-04 同类）。**本包不具备进入独立 Test 的条件**，须先返工 R7-01、R7-02，并随返工处理 R7-03..R7-08（记录类）或（若坚持「仅按六条 AC 判验收」的口径）在结算材料中显式登记为非阻断遗留。
- 第三轮 N-11（`data.md:30` 的 `:ID` 记法 vs 代码哈希）仍是 **Product Decision Pending**，未消解（`docs/architecture/data.md:30` 仍写三个 `:ID`，实现仍为内容哈希）。
- T9 仍未结算：`docs/INDEX.md:26-30` 仍只列 WP-00/WP-01 且称 Work/Run 编排「仍未实现」；`docs/delivery/acceptance.md` 中**没有 WP-02 的任何证据登记**（`grep -n "WP-02" docs/delivery/acceptance.md` 无匹配）；`implementation.md:131-133` 仍留「## T9 待办」。

---

## 2. 验证命令与原始结果

环境：`export PATH="$HOME/.local/bin:$PATH"`，工作目录 `/Users/huyaohua/huyh/work/aigrouptool`，全部在 `f02aca4`、干净工作树上执行。原始日志：`/tmp/wp02-r7-cmds.log`（六条命令顺序执行，含退出码）。`node v24.8.0`、`pnpm 12.3.4`。

| 命令 | 退出码 | 关键原始输出 |
|---|---|---|
| `pnpm typecheck` | 0 | `$ tsc -p tsconfig.json --pretty false`（无错误输出） |
| `pnpm lint` | 0 | `Checking formatting...` / `All matched files use Prettier code style!` |
| `pnpm test:unit` | 0 | `Test Files  17 passed (17)` / `Tests  225 passed (225)`（与 T14 自述的 225 一致） |
| `pnpm test:integration` | 0 | `Test Files  10 passed (10)` / `Tests  124 passed (124)`（含真实 Docker 容器与 doctor 集成用例，未回退） |
| `pnpm docs:check` | 0 | `docs:check ok — 15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages` |
| `pnpm build` | 0 | `packages/contracts\|domain\|storage\|core\|pi-runtime\|apps/cli\|apps/runner build: Done`（7 个 workspace 全部 Done） |

`git log --oneline -3`：

```
f02aca4 fix(core): WP-02 review round 6 findings (R6-01..R6-10)
0211ced fix(core): WP-02 review round 5 findings (R5-01..R5-14, M-1..M-4)
5a87a86 fix(core): WP-02 review round 4 findings (Q-01..Q-10, H-01..H-03)
```

`git status --porcelain`：无输出（写入本报告前）。`pnpm test:e2e|acceptance|live` 仍按契约 `NOT_IMPLEMENTED`，未执行。

### 2.1 本轮独立实验日志（`/tmp/wp02-r7/`）

| 日志 | 覆盖 |
|---|---|
| `exp-a.log` | A1 R6-01 实测结算后同量 `reconcile`（预算零变化、兄弟预留完好）；A2 R6-04 异量冲突；**A3 对抗：同量不同 cost**；A4 R6-05 事件版本/计数；A5 取消后重放；A6 实测 0 与未测量基线；**A7 对抗：贪心派发复现第六轮超发场景** |
| `exp-b.log` / `exp-b2.log` | B1 R6-02 cost 入账与分数/非法值；B2/B2b R6-03 取消记账与级联；**B3 对抗：`measured:false` 带 tokens 与带 cost**；B4 R6-06 事件字段；B5/B5b R6-09 派生键与伪造键；B6/B6b R6-10 错误空间 |
| `exp-c.log` / `exp-c2.log` / `exp-c3.log` | C1/C1b R6-08 父状态；C2 DC-49 守卫；C3 M-3 拒绝取消不动子树；C4 R5-05 无孤儿待办；C5 DC-46 六种真实 Work 状态；C6 M-1 二次不合规；C7 核销 `contract_violation`；C8 跨事件页核销 |
| `probe.log` | 对抗：malformed spec 的裸 `TypeError` 栈（`missingSelectionReasons` / `validateDispatchSpec`） |
| `probe2.log` | 对抗：结算与重放之间插入 1200 条事件，核销幂等仍成立（跨页扫描） |
| `probe3.log` | 对抗：被拒 dispatch 仍写入 dispatch 快照行（1→2→3），Run 数为 1 |
| `probe4.log` | DC-46 列举的 `archived`/`draft` 不是合法 Work 状态 |

**实验卫生说明**：进入实验前 `packages/core/dist` 可能为旧产物，因此先执行 `pnpm build` 再取 `dist`；`dist/` 被 `.gitignore` 忽略，不属产品代码改动。实验通过 `/tmp/wp02-r7/node_modules/@agentdev/*` 软链解析 workspace 包，等价复现 `orchestrator.test.ts` 的夹具但**不 import 产品测试文件**。夹具中 `env.ended()` 为单页读取（`limit:1000`），故 C8 的「settlementEvents」计数是夹具假象，产品侧 `scanEvents` 全量分页已由 `probe2` 单独证明。

---

## 3. R6-01..R6-10 逐条复核表

| 条目 | 六轮严重度 | T14/DC 修复声明（f02aca4） | 复核判定 | 独立实验证据 |
|---|---|---|---|---|
| **R6-01** 对已实测 Run 二次核销 | P1 | 幂等判定改为「该 Run 是否已有实测/核销记录」，判定与写入同一事务（DC-52） | **已修复（verified）** | EXP-A1：实测 500 → `reconcile(500)` 后 `used=500/reserved=14000` 与结算后**逐字节相同**，兄弟 A 仍 `queued` 且 allocation 4000；`settlements`=1。EXP-A2/A6：异量（4999、10）→ `IDEMPOTENCY_CONFLICT`，预算不动。EXP-A7：贪心派发至 `BUDGET_EXCEEDED`，`used+reserved=20500<=100000`、`reserved == Σ在场 Run allocation`、`overCommitted=false`。PROBE2：结算与重放之间插 1200 条事件仍幂等（跨页）。代码：`run-lifecycle.ts:233-250`、`:287-292` |
| **R6-02** `cost` 不入 Work 预算、分数被拒 | P2 | `cost` 真正进入 `budget.cost` 并允许非整数 | **部分修复（→ R7-02，P2）** | EXP-B1：`reconcile({1000,cost:3})` → `budget.cost=3`；`cost:0.0025` → `3.0025`；`settleRun(measured,cost:0.5)` → `3.5025`；`-1/NaN/Infinity` → `VALIDATION_ERROR`。**EXP-A3：已有实测 1000（无 cost）后再 `reconcile({1000,cost:5})` → 接受但 `budget.cost` 仍 `{}`、事件数仍 1**，cost 被静默丢弃 |
| **R6-03** 取消路径丢弃实测用量 | P2 | `settleRun(...,'cancelled',{measured:true})` 记账 | **已修复（verified）** | EXP-B2：`settleRun(b,'cancelled',{4321,measured})` → `cancelled`、`used=4000`（封顶 allocation）、事件 `{tokensUsed:4321,chargedTokens:4000,uncoveredTokens:321,releasedTokens:0}`；重放 `reconcile(4321)` 无操作。EXP-B2b：Chief 带在场子 Run 被取消 → 自身 700 入账、子 Run 同事务 `cancelled`（未测量、预留保留，属 WP-10 缺口） |
| **R6-04** 同 Run 不同 usage 静默无操作 | P3 | 异量 `IDEMPOTENCY_CONFLICT` | **已修复（verified）** | EXP-A2/A6：`IDEMPOTENCY_CONFLICT`（`ProtocolError`，details 含 `recordedTokens/requested`），预算与事件均不变。**残留：只改 `cost` 仍静默**（→ R7-02） |
| **R6-05** 核销事件复用 `entityVersion` | P3 | 核销事件带 `reconciliation: n` 便于排序 | **部分修复（→ R7-04，P3）** | EXP-A4/C7：`run.ended` 两条 `entityVersion` 均为 4（`duplicate=true`）；核销事件 `reconciliation: 1`；第二次同量 `reconcile` 不再产生事件，故计数**恒为 1**，不能作为排序键 |
| **R6-06** 事件 `costKnown` 与 Work 级同名 | P3 | 每 Run 事实改名 `runCostKnown`，Work 级独立重算 | **部分修复（→ R7-05，P3）** | EXP-B4：实测结算事件 data 键为 `[outcome,workId,tokensUsed,chargedTokens,uncoveredTokens,usageMeasured,runCostKnown,releasedTokens]`，**无 `costKnown`**；同一时刻 Work `costKnown=false`（兄弟未测量），兄弟核销后转 `true`。**但 `.agentdev/work/WP-02/discovery.md:126`（DC-48）仍写事件 data 含 `costKnown`**，且未提 `runCostKnown`/`reconciliation` |
| **R6-07** M-2 无定义 | P3 | DC-56 给出定义并称 T13 已修 | **记录补齐（无法独立核对）** | `discovery.md:165-167` 已定义。静态核对：`run-lifecycle.ts:7-13/164-167/215-219/399-403` 的注释均与「未测量保持预留」一致，无相反声称。第五轮对抗性核验原始清单不在仓库，定义来源不可独立验证 |
| **R6-08** DC-35 父状态描述不符 | P3 | DC-35 正文改写（`discovery.md:54`） | **部分修复（→ R7-06，P3）** | EXP-C1：running Chief + 唯一 required `join=all` 子 Run 失败 → `kind=blocked`、父仍 `running`（改后正文不再声称停留 `waiting_children` ✓）。**EXP-C1b：有在场兄弟时父进入 `waiting_children`，全部终态后因 required 失败仍停留 `waiting_children`，并不回到 `running`**，与改后正文末句「子 Run 全部终态后才回到 `running`」不符 |
| **R6-09** `operationId` 可选导致重复待办 | P3 | 缺省时用请求指纹派生 `derived:<sha256>`，事件记 `operationIdSource`（DC-54） | **已修复（verified）** | EXP-B5：两次同请求 → 同一游标 `3`、待办 1 条、`operationIdSource='derived'`；不同 goal → 2 条；显式键重放返回原游标、异载荷 `IDEMPOTENCY_CONFLICT`。EXP-B5b：客户端复用派生键 → `IDEMPOTENCY_CONFLICT`（fail-closed） |
| **R6-10** 未知字段抛裸 `ZodError` | P3 | Core 入口契约校验统一转 `VALIDATION_ERROR` | **部分修复（→ R7-01，P2）** | EXP-B6/B6b：chief/professional 未知字段、缺 `goal`、坏 purpose 枚举、`scope:null` 均 → `ProtocolError/VALIDATION_ERROR`；`professionalSpec(+bogusField)` 同样 ✓。**`contextSelection` 被破坏时抛裸 `TypeError`（非 `ProtocolError`），`requiredOutputs:null` 亦然**（PROBE1） |

**小结**：完全修好 4 条（R6-01/R6-03/R6-04/R6-09）；部分修复 5 条（R6-02→R7-02、R6-05→R7-04、R6-06→R7-05、R6-08→R7-06、R6-10→R7-01）；记录补齐 1 条（R6-07）。**第六轮唯一的 P1 已真正关闭**；但「声称已修」与「实际覆盖」之间的落差仍集中在两处：`cost` 参与的核销判定、以及 Core 入口对 malformed spec 的校验顺序。

### 3.1 对抗性核验 3 条观察复核

| 观察 | T14 处置 | 复核判定 | 证据 |
|---|---|---|---|
| ① `measured:false` 带非零用量被静默丢弃 | 直接 `VALIDATION_ERROR` | **已修复（verified）** | EXP-B3：`settleRun({5,measured:false})` → `VALIDATION_ERROR`；Run 仍 `running`；0 条 `run.ended`。代码 `run-lifecycle.ts:496-505` |
| ② `reconcile` 判定在事务外 | 判定与写入同事务 | **已修复（verified）** | 静态：`run-lifecycle.ts:233-250` 的 `settlementOf` 在 `withTransaction` 回调内。行为：PROBE2 跨页 + EXP-A1 均一致 |
| ③ `JoinCoordinator` 无生产调用方 | 登记为观察 | **未变（记录准确）** | `grep -rn "JoinCoordinator" packages apps --include=*.ts` 仅 `join.ts` 定义与 `join.test.ts` 使用；`docs/delivery/implementation.md` WP-05 条目仍未点名消费它 |

---

## 4. 新 Findings（R7-01..R7-08）

### R7-01 [P2] malformed `DispatchSpec` 仍从 `Orchestrator.dispatch` 抛裸 `TypeError`，T14「Core 入口的契约校验统一转成 VALIDATION_ERROR」被证伪（R6-10 残留）

- 位置：`packages/core/src/orchestrator.ts:288`（`enforce(validateDispatchSpec(spec), 'dispatch spec')` 在任何 Schema 校验之前执行）→ `packages/domain/src/dispatch.ts:34-40`（`validateContextSelection`/`spec.requiredOutputs.length` 直接做结构读取）→ `packages/contracts/src/entities/structures.ts:69-73`（`selection.sourceRefs.map(...)`）。对比 T14 声明 `implementation.md:127`。
- 事实（PROBE1，均为 `Orchestrator.dispatch` 的公开入口）：
  - `contextSelection: {goal:1}` → `TypeError: Cannot read properties of undefined (reading 'map')`（`structures.ts:70`），`name='TypeError'`、无 `code`；
  - `contextSelection: undefined` → `TypeError: ... (reading 'sourceRefs')`（`structures.ts:70`）；
  - `contextSelection: {goal:'g'}` → 同上；
  - `requiredOutputs: null` → `TypeError: Cannot read properties of null (reading 'length')`（`dispatch.ts:38`）。
  - 对照（已正确转成协议错误）：未知字段、缺 `goal`、坏 purpose 枚举、`scope:null` 均 → `ProtocolError/VALIDATION_ERROR`。
- 依据：`protocol.md` §1「必填参数缺失、**未知字段**或枚举错误返回 `VALIDATION_ERROR`」，且 `protocol.md` §7 错误表只定义协议错误空间；`implementation.md:127` 明文声称已统一。第六轮 R6-10 的同类缺陷（裸 `ZodError`）被判 P3 的可达性理由（`dispatch` 尚未接入 mailbox/协议层）今天依然成立，故**不判 P1**；但本次的失败形态是**未捕获的非协议异常**（崩溃）而非结构化错误，且落在开发者自己声称「已统一」的入口上，故判 **P2 且为本包必修**。
- 影响：WP-05/WP-08 一旦把 `dispatch` 接到协议面，任何 malformed `agent.dispatch` 都会以未定义错误形态逃逸（协议层无法映射为 `{ok:false,error:{code}}`，通常直接断连接或 500）；`validateDispatchSpec` 的其余校验也因此在校验之前崩溃。
- 建议：在 `dispatch` 入口先用 `parseOrFail`/`safeParse` 对 `DispatchSpec` 整包做契约校验（把未知字段/类型错误映射为 `VALIDATION_ERROR`），再做 `validateDispatchSpec` 的结构读取；或让 `validateDispatchSpec` 只在 schema 通过后运行。补一条「malformed `contextSelection`/`requiredOutputs` 返回 `VALIDATION_ERROR`」的负例测试。

### R7-02 [P2] `reconcile` 的幂等比较只覆盖 `tokensUsed`：只改 `cost` 的核销被当作重放静默丢弃，`budget.cost` 永久缺失（R6-02/DC-45 残留）

- 位置：`packages/core/src/run-lifecycle.ts:235-239`（`recorded.data['tokensUsed'] === usage.tokensUsed` 即 `return run`，不比对 `cost`）、`:240-250`（仅比较 tokens 的冲突分支）、`:251-255`（cost 只在真正记账路径传给 `settleBudget`）。对照 `discovery.md:114`（DC-45「计入 `tokensUsed`/`cost`」）、`implementation.md:122`（R6-02「cost 真正进入 `budget.cost`」）。
- 事实（EXP-A3）：Run B（allocation 4000）按 `settleRun(b,'completed',{tokensUsed:1000, measured:true})` 结算（无 cost）→ 随后 `reconcile(b,{tokensUsed:1000, cost:5})` **返回成功且无任何诊断**：`budget.cost` 仍为 `undefined`、`run.ended` 仍只有 1 条、`tokensUsed` 不变。若先核销带 cost 则正常入账（EXP-B1 已证）。
- 依据：DC-45 明确「核销（释放整笔预留、**计入 `tokensUsed`/`cost`**）」；R6-04 已确立「同 Run 载荷不同必须 `IDEMPOTENCY_CONFLICT`，不能静默无操作」（判为必修的原因正是静默吞载荷），而 `cost` 就是载荷的一部分。真实路径自然命中：Runner 先按 token 记账（无价格），Provider 账单随后给出小数金额。
- 影响：Work 级 `budget.cost` 可永久为空/偏小；消费方（UI/预算判断/WP-10 结算）拿到错误的成本事实；且调用方无法从返回值区分「已入账」与「被忽略」。
- 建议：幂等判定改为比较 `(tokensUsed, cost)`：两者都相同才无操作；`tokensUsed` 相同而 `cost` 不同则 `IDEMPOTENCY_CONFLICT`（或允许「补录 cost」并把该分支明确为幂等更新）。补测试：measured settle（无 cost）→ `reconcile(same tokens, cost)` → 断言 `budget.cost` 入账或明确冲突。

### R7-03 [P3] `settle(..., {measured:false, cost>0})` 接受并静默丢弃 `cost`，与刚加入的 `tokensUsed>0` 拒绝不对称

- 位置：`packages/core/src/run-lifecycle.ts:405-409`（未测量分支只 `markCostUnknown` 并返回 `{0,0}`，`usage.cost` 从不使用）、`:489-507`（`validateUsage` 只在 `!measured && tokensUsed>0` 时拒绝，不检查 `cost`）。
- 事实（EXP-B3）：`settleRun(b,'completed',{tokensUsed:0, measured:false, cost:9})` → 接受、Run 终态、`budget.cost` 仍 `undefined`、`costKnown=false`；该 cost 之后也无法补录（未测量事件 `usageMeasured:false`，`reconcile({tokensUsed:0})` 会按「0 用量」把事件标成已测量，cost 永久丢失）。
- 依据：本轮新加的 `validateUsage`（T14 对抗性观察 1）把「未测量 + 非零 tokens」判为自相矛盾输入并拒绝，`cost` 同理（未测量意味着成本未知）却静默接受。
- 建议：与 tokens 采用同一口径——`!measured && cost !== undefined` → `VALIDATION_ERROR`；或明确支持「只补 cost」的语义并落到预算。
- 影响：仅信息丢失，不改变预算不变式，故 P3。

### R7-04 [P3] 核销事件的 `reconciliation` 计数恒为 1，未提供声称的排序能力；`entityVersion` 仍与首次终态事件重复（R6-05 残留）

- 位置：`packages/core/src/run-lifecycle.ts:259-261`（`entityVersion: run.version`，注释自承「Run 行不变，版本重复」）、`:266`（`reconciliation: this.reconciliationCount(run.id) + 1`）、`:294-298`。
- 事实（EXP-A4、EXP-C7）：未测量结算 + 核销后，同一 Run 的 `run.ended` 事件 `versions=[4,4]`（`duplicate=true`）；核销事件带 `reconciliation: 1`。由于 `settlementOf` 会命中任何 `usageMeasured:true` 的事件，**第二次核销不可能发生**（同量无操作、异量冲突），因此 `reconciliationCount` 永远为 0 → 该字段恒等于 1，不能充当事件间排序键（首次终态事件根本没有该字段）。
- 依据：`protocol.md` §7 `Event={…,entityId,entityVersion,data}`，按 `(entityId, entityVersion)` 增量消费的一方仍无法区分/排序两条 `run.ended`；DC-52 声称该字段「便于排序」，与实现不符。
- 建议：让核销真正推进 Run 版本（例如写入 `reconciledAt` 使 `version+1`），或改用独立事件名（如 `run.reconciled`）；若保留计数，请把 DC-52 的措辞改为「标记该事件为核销补发」而不是「便于排序」。

### R7-05 [P3] DC-48 正文仍声明 `run.ended` data 含 `costKnown`，与 DC-52/代码不一致（R6-06 记录残留）

- 位置：`.agentdev/work/WP-02/discovery.md:126`（DC-48：「所有终态路径的 data 都包含 `outcome`、`usageMeasured`、**`costKnown`**、`tokensUsed`、`releasedTokens`；…核销补发额外带 `reconciled:true`」）对比 `.agentdev/work/WP-02/discovery.md:151`（DC-52：字段改名为 `runCostKnown`）与 `packages/core/src/run-lifecycle.ts:365`、`:271`。
- 事实（EXP-B4）：事件 data 的实际键为 `[outcome,workId,tokensUsed,chargedTokens,uncoveredTokens,usageMeasured,runCostKnown,releasedTokens]`，**无 `costKnown`**；核销补发另有 `reconciliation` 而 DC-48 未提。同一文件内 DC-48 与 DC-52 互相矛盾。
- 影响：DC-48 是「消费方一致性」的实现约定条目，WP-08/WP-09 的 WS/BFF/UI 会据此消费事件；按 DC-48 写的消费者会读到 `undefined`。属「记录声称与代码不一致」，正是本轮 required 检查项。
- 建议：把 DC-48 的 `costKnown` 改为 `runCostKnown`，并补 `chargedTokens/uncoveredTokens/reconciliation` 与字段层级说明。

### R7-06 [P3] DC-35 更正后的正文在 required 子 Run 失败时仍不准：父 Run 不会「回到 running」

- 位置：`.agentdev/work/WP-02/discovery.md:54`（「…子 Run 全部终态后才回到 `running`」）对比 `packages/core/src/join.ts:182-222`（`pending.length===0 && failedRequired.length>0` 时在 `:204-214` 提前 `return blocked`，**跳过** `:220-222` 的 `waiting_children → running` 更新）。
- 事实（EXP-C1b）：running Chief + 两个 `join=all` 子 Run；第一个失败后父 → `waiting_children`；第二个完成后父**仍为 `waiting_children`**（`kind=blocked`），未回 `running`。EXP-C1（唯一 required 子 Run 失败、父从未进入等待）时父保持 `running`——这一半已与更正后的正文一致。
- 影响：DC-35 是 AC-046「新 Chief 消息可处理」的实现依据；「全部终态即回 `running`」会让承接方误判父 Run 状态。功能上两状态都可继续受理命令，故 P3。
- 建议：改为「仍有 `join=all` 子 Run 在场时进入 `waiting_children`；全部终态且无 required 失败时回到 `running`；required 失败时保持当前状态并交付 blocked 结果」。

### R7-07 [P3] 被拒的 `dispatch` 仍先落一张 `dispatch` 快照行：失败请求留下持久副作用

- 位置：`packages/core/src/orchestrator.ts:371-380`（先 `snapshots.freeze('dispatch', …)`，后 `parseOrFail` 校验；`freeze` 在事务之外）与 `packages/core/src/snapshots.ts:88-92`（裸 `INSERT INTO snapshot`，不随失败回滚）。
- 事实（PROBE3）：`dispatch({spec:{...chiefSpec, bogusField:1}})` → 抛 `VALIDATION_ERROR`，但 `snapshot` 表 `dispatch` 类型行数 1→2（再跑一次 `scope:null` → 3），Run 行数保持 1。`context` 快照因 fallback 载荷相同而幂等（1→1）。
- 依据：`protocol.md` §1 只允许「一个终结 response」；失败写命令不应留下实体副作用。快照是内容寻址的持久行，虽无 Run 引用，但会随无效请求无界增长（一旦 `dispatch` 接入协议面无准入限流，即为可被放大的存储增长面）。
- 建议：先校验 spec 再 `freeze`，或把 `freeze` 纳入同一事务；补测试「被拒 dispatch 不新增 snapshot 行」。

### R7-08 [P3] 记录引用与仓库不符：DC-46 列举不存在的 Work 状态；DC-53/DC-56 引用不存在的 `workflow.md` §65

- 位置：`.agentdev/work/WP-02/discovery.md:118`（DC-46：「第六轮实测 `blocked`/`paused`/`completed`/`cancelled`/**`archived`**/**`draft`** 六种 Work 状态下都能建立 Chief Run」）、`:155` 与 `:167`（「按 `workflow.md` **§65** 的定义」）。
- 事实：`packages/contracts/src/enums.ts:40-49` 的 `workStatusSchema` 只有 `queued/running/completed/blocked/paused/cancelling/cancelled/failed`；`archived` 属 `requirementStateSchema`（`enums.ts:62-68`），`draft` 不是 Work 状态。PROBE4：`store.works.update(id,{status:'archived'|'draft'})` → `CONSTRAINT_VIOLATION`（值为非法枚举），根本到不了 `dispatch`。EXP-C5：真实可用的六种（`blocked/paused/cancelling/completed/cancelled/failed`）确实都能建立 Chief Run（DC-46 的**结论**成立，**举例**错误）。`docs/rules/workflow.md` 只有 §1..§8，严重度定义在 §6，「§65」不存在。
- 影响：DC-46 是 R5-11 残留的承接依据（WP-05），错误的枚举会让承接方以为 Work 状态机含 `archived`/`draft`；`§65` 是失效引用（`docs:check` 只校验文档间链接，不校验章节号，故未拦住）。同属「记录声称与仓库不符」。
- 建议：DC-46 的举例改回 `blocked/paused/cancelling/completed/cancelled/failed`；DC-53/DC-56 的 `§65` 改为 `§6`。

---

## 5. 本包必修 vs 其他包显式缺口（承接核对）

| 事项 | 归属判定 | 承接登记核对 | 结论 |
|---|---|---|---|
| R7-01 裸 `TypeError`（P2） | **本包必修** | — | `orchestrator.ts`/`domain/dispatch.ts` 为本包代码；T14 声称已统一 |
| R7-02 `cost` 静默丢弃（P2） | **本包必修** | — | `run-lifecycle.ts` + DC-45/`data.md:37` `cost?:number` |
| R7-03 `measured:false` 带 cost（P3） | **本包必修**（小） | — | 与本轮新加的校验口径对称性 |
| R7-04 `reconciliation` 恒 1（P3） | **本包必修**（记录+可选代码） | — | R6-05 残留 |
| R7-05 DC-48 `costKnown`（P3） | **本包记录缺陷** | — | `discovery.md:126` 与 DC-52/代码冲突 |
| R7-06 DC-35 末句（P3） | **本包记录缺陷** | — | `discovery.md:54` 与 `join.ts:182-222` 不符 |
| R7-07 失败 dispatch 落快照（P3） | **本包必修**（小） | — | `orchestrator.ts:371-380` |
| R7-08 记录引用/枚举（P3） | **本包记录缺陷** | — | 同属「记录须与仓库一致」 |
| R5-11 终态 Work 仍可 dispatch | 承接 **WP-05** | DC-46 标题已覆盖、正文已补真实状态（举例错误见 R7-08）；`docs/delivery/implementation.md` WP-05 条目仍不含 Work 状态投影/WorkBlocker | **DC 已登记但承接条目未确认**（与第五、六轮一致） |
| Q-06/DC-40/DC-47 父 Run 额度口径 | 待产品确认的实现约定 | `discovery.md:89-91`、`:120-122` | **已登记，等待产品方决定** |
| DC-42 Work `blocked(provider)` | 承接 **WP-05** | DC-42 声明 WP-05；WP-05 条目无该职责 | **承接归属存疑（连续第四轮）** |
| DC-45 真实 usage/成本读取与核销**调用方** | 承接 **WP-10** | DC-45 声明 WP-10；条目未点名 usage/预算核销 | 承接可对应；WP-10 须消费 `reconcile` 并处理 R7-02 的 cost 语义 |
| DC-55 `uncoveredTokens` 不产生 Work 级预算阻断 | 承接 **WP-05** | `discovery.md:161-163` 已登记 | 已登记（第六轮观察） |
| DC-38 `runParams` 无授权来源 | 承接 **WP-04/WP-07** | `discovery.md:81-83` | 归属偏 WP-07，后续包未启动 |
| DC-39 Join 无协议事件（读模型） | 承接 **WP-08** | `discovery.md:85-87` | 归属与 WP-08/WP-09 条目均不完全吻合，跨包风险 |
| N-11（RE-06）`data.md` `ID` vs 哈希 | **Product Decision Pending** | `discovery.md:72` | 未消解前不得判 Completed |

补充事实：除 `.agentdev/work/{WP-00,WP-01,WP-02}` 外，承接包（WP-04..WP-10）均尚无独立过程记录目录，故「承接」仍只能由 DC 条目声明，无法在承接包侧交叉验证。

---

## 6. 未验证 / 无法验证项与剩余风险

1. **`release` 仍不校验预留归属**（`run-lifecycle.ts:93-102`，`Math.max(0, reserved-allocation)`）：第六轮报告建议的 fail-closed 未采纳。经本轮全部路径排查（每个 Run 的 allocation 只在 `dispatch` 内 `reserve` 一次，`settleBudget` 的 measured 分支只在「该 Run 尚无 measured 事件」时执行一次），当前**不可达**重复释放；但任何未来的新终态路径若绕过 `settlementOf` 判定，就会重新打开第六轮的超发后果。属加固建议。
2. **M-2 定义来源**：DC-56 的定义无法与第五轮对抗性核验的原始清单对照（仓库无该清单）。
3. **真实并发**：全部实验单线程。`requireBudget`/`canAllocateBudget` 在事务外判定、`reserve` 在事务内（`orchestrator.ts:325-328` vs `:385`），`requestDispatch` 的派生键去重也在事务外（`:490-519`）；单 mailbox 串行下不可达，本轮未做并发压测。
4. **`reconcile` 无幂等键**：`operationId` 未进入 `reconcile` 签名，调用方无法表达「这次核销是哪次请求的重放」，R7-02/R7-04 都源于此。WP-10 接线前应决定是否给它加键。
5. **`JoinCoordinator` 无生产调用方**（对抗性观察 ③）：AC-046 目前只由测试驱动；WP-05 需消费 `onChildSettled`/`state`。
6. **`beginAttempt` 无法恢复 `paused` Run**（第四/五/六轮未变）：`run-lifecycle.ts:110-118` 对 `paused` 抛 `VALIDATION_ERROR`，而 `domain/transitions.ts:128-130` 的 `runAcceptsNewAttempt` 把 `paused` 视为可新 Attempt。Checkpoint 恢复归 WP-05。
7. **`settleRun` 非幂等**：重复结算抛 `VALIDATION_ERROR`（无 `operationId`）；WP-05 的 at-least-once 监督重放需自行保证只调用一次。
8. **`timed_out` 终态不可达**：`TerminalRunStatus` 只含 `completed/failed/cancelled`；`run.ended` 的写入路径中无 `timed_out`。归 WP-05 监督。
9. **`snapshots.ts:36` 仍用裸 `snapshotSchema.parse`**：读路径（`read`/`find`/`byType`）解析 DB 行，异常形态为 `ZodError`。仅当 `snapshot` 行被外部破坏时可达，非协议输入；本轮未构造该场景。
10. **真实 Provider 调用与 Secret**：`GatewayTransport`/`SecretResolver` 仍为注入缝（DC-31），AC-043「不同 Provider」仍只是结构验证。
11. **ContextBuilder/上下文内容与 token 计量**：`dispatch` 的 `contextPayload` 仍只有 fallback（`orchestrator.ts:352-360`），属 WP-06；AC-082 的工具层负例归 WP-07。
12. **`readLedgerHash` 真实性**：`stage.ts` 只做 64 位十六进制 Schema 校验，未与读账本核对（WP-05/WP-06）。
13. **事件消费者端到端兼容性**：R7-04/R7-05 的字段语义与 WS/BFF/UI（WP-08/WP-09）未实现，本轮只做协议/文档静态判定。
14. **`test:e2e`/`test:acceptance`/`test:live`**：按契约 `NOT_IMPLEMENTED`，未执行。
15. **结算未完成（T9 待办）**：`docs/INDEX.md:26-30` 仍只列 WP-00/WP-01；`docs/delivery/acceptance.md` 无 WP-02 证据登记；`implementation.md:131-133` 仍留「## T9 待办」。本次 Review 只判定「实现是否成立与可否进 Test」，不判定「结算是否完成」。
16. **N-11 产品决定**：`data.md:30` 的三个 `:ID` 快照引用与实现的哈希并存，属 `Product Decision Pending`。

---

## 7. 方法与边界声明

- 本报告只依据仓库文件、`f02aca4` 上的 git 对象/差异与实跑命令；未读取任何开发对话、未引用外部同名技能或历史方案。
- 唯一写入文件为本文件 `.agentdev/work/WP-02/review.md`；实验脚本独立写在 `/tmp/wp02-r7/`（`fixture.mjs`、`exp-a/b/c.mjs`、`probe*.mjs` 与对应 `.log`），使用 `pnpm build` 产出的 `packages/*/dist`，通过 `/tmp/wp02-r7/node_modules/@agentdev/*` 软链解析 workspace 包，等价复现 `orchestrator.test.ts` 的夹具但**不 import 产品测试文件**。
- 未修改产品代码、测试、`docs/**`、`plan.md`、`implementation.md`、`discovery.md`；`pnpm build` 只写 `.gitignore` 中的 `dist/`。写入本报告前 `git status --porcelain` 无输出、`HEAD=f02aca4518430e713e0869a33db2e5024b0ccc5c`。
- 本报告覆盖了第六轮 `review.md`；第六轮全文可用 `git show 0211ced:.agentdev/work/WP-02/review.md` 取回全文，第五/四/三/二/一轮分别用 `git show 0211ced~1:…`（即 `5a87a86`）、`git show 411d04f:…`、`git show a8daa6d:…`、`git show c4763d5:…`、`git show 785bdd6:…` 取回。
