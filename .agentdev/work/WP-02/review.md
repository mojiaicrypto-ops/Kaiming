# WP-02 独立 Review 报告（第二轮）

- 评审对象：工作包 WP-02「主管与独立Agent调度」
- 评审轮次：**第二轮**（复核第一轮 Review 的 R-01..R-13 是否真修，并找新问题）
- 冻结点：git `c4763d5`（`fix(core): WP-02 independent review round 1 findings (RE-01..RE-13)`），前置 `785bdd6`
- 工作树：`git status --porcelain` 无输出（`pnpm build` 只写被忽略的 `dist/`，复核后仍无输出）
- 评审角色：Review（独立上下文，未读取开发对话；只依据仓库文件与实跑命令）
- 权威依据：`docs/rules/{workflow,agents}.md`、`docs/architecture/{data,protocol,reliability,context,ARCHITECTURE}.md`、`docs/delivery/{implementation,acceptance}.md`、`.agentdev/work/WP-02/{plan,implementation,discovery}.md`
- 方法：回到代码与测试，另在 `/tmp/wp02-r2/` 自建 5 个脚本用 `packages/*/dist` 复现（`exp.mjs`、`exp2.mjs`、`exp3.mjs`、`exp4.mjs`、`exp5.mjs`），不修改产品代码、测试、`docs/**`、plan/implementation/discovery。

---

## 0. 第一轮结论摘要（保留，供对照）

> 第一轮（冻结点 `785bdd6`）判 **FAIL**：1×P1、5×P2、7×P3。P1 为 `stage.submit` 无终态/epoch 守卫（终态 Run 仍接受交付并落 `stage_result` 行）；P2 为「父等待可接消息」证据空洞、`joinPolicy=none` 未实现、持久事件名偏离 `protocol.md` §7、越界写入 Plan、`run.ts` 快照引用改哈希与 `data.md` 冲突；P3 为 R-07..R-13。第一轮命令全部通过（unit 202 / integration 124），失败原因是行为与证据，不是构建。

---

## 1. 结论

**FAIL（Review Failed）——0 个 P1（原 P1 已按终态/epoch 语义修复但留有残余）、5 个 P2、6 个 P3。**

- 第一轮的 **R-05、R-09、R-10、R-11、R-12 已真实修好**；**R-01、R-03、R-07、R-08、R-13 为部分修复**；**R-02 实际上仍是无效证据**；**R-04 部分修复且 DC-37 的修复陈述与代码不符**；**R-06 已按流程记录为待产品确认的偏离，但未消解**。
- 本轮实测到 3 个会改变行为的缺陷，其中 2 个与第一轮 P1/P2 同类：
  1. **预算预留泄漏**：Run 经 `contract_violation` 终态时 `tokensReserved` 永不释放，Work 预算被永久占用，后续合法派发被拒（实测）。
  2. **`stage.submit` 只排除终态**：`paused`/`waiting_permission`/`interrupted`/`recovery_required` 的 Run 仍接受交付并写 `stage_result` 行（实测），违反 `reliability.md` §2 迟到事件检查。
  3. **DC-37 RE-04 声称已删除的 `run.waiting_children`/`run.children_joined` 仍在发出**（实测），且无 DC 承接方案——修复记录与代码不符。
- `docs/INDEX.md` 仍只写 WP-00/WP-01 且称 Work/Run 编排「仍未实现」，`acceptance.md` 无 WP-02 证据登记——`implementation.md` T9 自述为待办，属结算未完成（不单独计 Finding，但阻断 Completed）。

按 `workflow.md` §6「P2/P3 影响验收则阻断」：R-02 是 `implementation.md` WP-02 点名的**必需失败测试**，其证据仍无效；N-01/N-02 为可靠性/终局性缺陷。本包**不具备进入独立 Test 的条件**，须先返工。

---

## 2. 验证命令与原始结果

环境：`export PATH="$HOME/.local/bin:$PATH"`，工作目录 `/Users/huyaohua/huyh/work/aigrouptool`，全部在 `c4763d5`、干净工作树上执行。

| 命令 | 退出码 | 关键原始输出 |
|---|---|---|
| `pnpm typecheck` | 0 | `$ tsc -p tsconfig.json --pretty false`（无错误输出） |
| `pnpm lint` | 0 | `Checking formatting... All matched files use Prettier code style!` |
| `pnpm docs:check` | 0 | `docs:check ok — 15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages` |
| `pnpm test:unit` | 0 | `Test Files 17 passed (17)` / `Tests 207 passed (207)`，6.53s（首轮 202 → 本树 207，`join.test.ts` 5→7、`orchestrator.test.ts` 10→13） |
| `pnpm test:integration` | 0 | `Test Files 10 passed (10)` / `Tests 124 passed (124)`，82.90s；含真实 Docker `container.integration.test.ts` 9 用例与 `doctor.integration.test.ts` 8 用例 |
| `pnpm build` | 0 | 全部 workspace `Done`（仅用于本轮独立实验读取 `dist/`；`dist/` 在 `.gitignore` 内） |

`git log --oneline -3`：

```
c4763d5 fix(core): WP-02 independent review round 1 findings (RE-01..RE-13)
785bdd6 feat(core): WP-02 T3-T8 orchestration, join, stage contract and restart scope
a047a9f feat(core): WP-02 T1-T2 role configuration, frozen snapshots and model gateway
```

`git status --porcelain`：无输出。`test:e2e|acceptance|live` 本轮未执行（按契约返回 `NOT_IMPLEMENTED`，属 WP-09/WP-10）。

### 2.1 本轮独立实验结果（`/tmp/wp02-r2/*.mjs`）

```
EXP1 实际持久事件名: ["run.children_joined","run.ended","run.queued","run.started","run.waiting_children","stage.completed"]
EXP1 不在 protocol.md §7 清单中的名字: ["run.children_joined","run.waiting_children"]

EXP2 错误 epoch          -> STALE_ARTIFACT | stage_result rows = 0
EXP2 首次 Schema 失败    -> {accepted:false, code:VALIDATION_ERROR, correctionsRemaining:1}
EXP2 二次 Schema 失败    -> {accepted:false, code:CONTRACT_VIOLATION, runStatus:contract_violation, rejections:2}
EXP2 终态 Run 再提交     -> INVALID_STATE | stage_result rows = 0
EXP2 被取代 Attempt 提交 -> STALE_ARTIFACT | stage_result rows = 0
EXP8 被拒提交的事件增量  -> wrong-epoch 0, terminal-submit 0（确实“不产生任何写入”）

EXP3b chief(20k)+child(4k) reserved = 24000
EXP3b child 经 contract_violation 后 reserved = 24000（若释放应为 20000）
EXP4  Work 预算 100k：A(50k)+child(30k) 后 reserved=80000；child contract_violation 后仍 80000
EXP4  此后合法 chief(30k) 派发 -> CONSTRAINT_VIOLATION: budget update failed its contract schema: tokens used + reserved exceeds the limit

EXP4b 对同一个已失败 none 子调用两次 onChildSettled -> chief_action_required 2 条
EXP4b 对同一个已失败 required 子调用两次 onChildSettled -> chief_action_required 2 条
EXP5  把 Chief 父 Run 置为终态 completed 后，测试所用的 mailbox→dispatch 路径仍 accepted:true 并建成子 Run
EXP6  joinPolicy=none 子结算：outcome=ready，父保持 running（不挂起）

EXP7  被阻断 Gate 事件每个子项键: [runId, role, status, requiredChild, join, summary, artifactRefs, unknowns, requestedActions]
      成功兄弟 summary 能带上（"the good sibling"），但 artifactRefs 只剩 id，缺 version/hash，且无 evidenceRefs/changedPaths/findingIds

EXP9  run=paused            提交 -> accepted:true  | stage_result rows = 1
EXP9  run=waiting_permission 提交 -> accepted:true  | stage_result rows = 1
EXP9  run=interrupted        提交 -> accepted:true  | stage_result rows = 1
EXP9  run=recovery_required  提交 -> accepted:true  | stage_result rows = 1
EXP10 paused Run 第二次 Schema 失败 -> THROW VALIDATION_ERROR（无法形成 contract_violation，run 仍 paused，仅 1 条 schema_invalid 事件）
```

---

## 3. R-01..R-13 逐条复核表

| 条目 | 首轮严重度 | 复核判定 | 证据（代码/实测） |
|---|---|---|---|
| R-01 `stage.submit` 无终态/epoch 守卫 | P1 | **部分修复（实质部分已修）** | `stage.ts:121-161` 新增终态（`INVALID_STATE`）、`epoch !== attempt.ownerEpoch`（`STALE_ARTIFACT`）、Attempt 非 starting/running（`INVALID_STATE`）、被取代 Attempt（`STALE_ARTIFACT`）、可选 `expectedVersion`（`VERSION_CONFLICT`），全部在写行之前；`stage.ts:64,261` 首错 `correctionsRemaining=1`。EXP2/EXP8 实测：错误 epoch、终态、被取代三种提交均抛错且 `stage_result` 行数与事件增量均为 0。**残余：只排除“终态”，`paused`/`waiting_permission`/`interrupted`/`recovery_required` 仍接受交付（N-02）；第二次失败在这些状态抛 `VALIDATION_ERROR`（N-08）** |
| R-02 「父等待可接消息」证据空洞 | P2 | **未真正修复** | 新测试 `join.test.ts:194-235` 在父 `waiting_children` 时经 mailbox 派发第三子。但 `mailbox.ts:129-147` 仍不读 `subject`/Run 状态，`orchestrator.ts:275-291` 的 `isDirectChiefChild` 也只校验 id/role/workId。EXP5 实测：父 Run 已是终态 `completed`，同一路径仍 `accepted:true` 并建成子 Run → 断言对 `running/waiting_children/completed` 无区分力。见 N-04 |
| R-03 `joinPolicy=none` 未实现 | P2 | **已修复（附残余）** | `join.ts:125-127,164-166` 只把 `join==='all'` 未终态子计入 pending；`join.ts:136-138,205-207` 只把 `all` 子计入 Gate 阻断；`none` 失败写 `chief_action_required(reason='fire_and_forget_child_failed')`。EXP6 实测 none 子结算后 `kind=ready`、父 `running`。`ChildOutcome.join` 已补。残余：重复事件（N-06）、阻断事件 payload 仍不全（N-07） |
| R-04 持久事件名偏离 `protocol.md` §7 | P2 | **部分修复，且 DC-37 陈述不实** | 文档名 `run.started`（`orchestrator.ts:536`）、`run.ended`（`:568`、`stage.ts:273`）、`stage.completed/stage.failed`（`stage.ts:203`）确已发出（EXP1）。但 `join.ts:175 run.waiting_children`、`join.ts:245 run.children_joined` **仍在发出**（EXP1），而 `discovery.md:70`（RE-04）明写这两个名字“已删除”。§7 清单无此二名，且无任何承接方案。见 N-03 |
| R-05 越界写入 Plan writePaths | P2 | **已修复** | `plan.md:24,27,32` 升到 planVersion 2，明确纳入 `snapshots.ts`、`contracts/src/entities/run.ts`、`contracts/test/entities.test.ts` 并列授权来源；`git diff --name-only 785bdd6..c4763d5` 的 13 个文件全部落在更新后的 writePaths 内 |
| R-06 `run.ts` 快照引用改哈希与 `data.md` 冲突 | P2 | **流程上已记录，产品确认未完成** | `plan.md:27` 与 `discovery.md:72`（RE-06）均将“`SnapshotRef=Hash` vs `data.md` §2/§3 `ID`”记为需产品方确认的显式偏离，并说明回退代价。`data.md:30,80` 仍写 `ID`，代码为 `packages/contracts/src/entities/run.ts:39 snapshotRefSchema = hashSchema`。判断：技术理由成立（`snapshot` 主键 `(type,hash)`、无 id 列），**本轮不作为阻断 Finding**，但 `plan.md:32` 的“授权来源”引用的是 Review 发现而非用户决定，属 `Product Decision Pending`，未确认前不得判 Completed。见 N-11 |
| R-07 Work 预算预留未落库 | P3 | **部分修复** | `orchestrator.ts:348` 派发事务内 `reserveBudget`，`:588` 写 `tokensReserved`，`:566` `settleRun` 释放；EXP3b 实测落库、结算释放、第二次同额派发被拒（防双花）。**残余：`contract_violation` 终态不释放，预算泄漏并阻断后续派发（N-01）；chief 规格越 Work 预算时报 `CONSTRAINT_VIOLATION` 而非 `BUDGET_EXCEEDED`（N-10）** |
| R-08 Run 参数层不可达 | P3 | **部分修复** | `orchestrator.ts:296,313` 把 `input.runParams` 传入 `availability`/`freeze`；`orchestrator.test.ts:481-492` 证明冻结快照 `sources.reasoning==='run'` 且重启路径可读。残余：`runParams` 未与 Authorization 绑定，代码注释 `orchestrator.ts:79` 指向 **DC-38**，但 `discovery.md` 只到 DC-37（N-09） |
| R-09 `readFrozen` 返回非法 `ProviderConfig` | P3 | **已修复** | 新增 `FrozenProvider` 投影（`config.ts:67-73`），`freeze` 只写 providerId/type/baseUrl/secretRef（`config.ts:478-500`），`readFrozen` 返回该投影并保留 `sources`（`config.ts:516-535`） |
| R-10 快照幂等对 `type` 不敏感 | P3 | **已修复** | `snapshots.ts:76,97-104` 以 `(type,hash)` 判幂等；同 hash 已属其他 type 时抛 `CONSTRAINT_VIOLATION`/`SNAPSHOT_TYPE_CONFLICT`（`:80-87`） |
| R-11 `decideLevel` 声称复用却未调用 | P3 | **已修复** | `orchestrator.ts:208-222` 调用 `decideLevel`，L3 底线不符即 `VALIDATION_ERROR`，`decidedLevel/decidedReason` 写入 `assessment.saved`（`:252-253`）；`orchestrator.test.ts:494-533` 覆盖 L2+`securityBoundary` 被拒、L3+授权通过。L1/L2 仍由 Chief 承担，代码注释与 DC-37 RE-11 均已明示 |
| R-12 `request_dispatch` 入参偏离 `protocol.md` §6 | P3 | **已修复** | `orchestrator.ts:111-128` 改为 `runId`（capability 绑定）+ `workId/reason/requestedRole/goal/sourceRefs`（余可选）；`:419-446` 记录 `requestReason`/`sourceRefs`，`purpose` 缺省取 `PRIMARY_PURPOSE_BY_ROLE`（`domain/dispatch.ts:139-147`）；测试 `orchestrator.test.ts:535-581` 覆盖 |
| R-13 Discovery 遗漏偏离 | P3 | **部分修复** | DC-37 已为 RE-01..RE-13 建条目，R-01/R-03/R-05/R-06/R-07/R-08 均可追踪。但 RE-04 陈述与代码不符（N-03），RE-08 引用的 DC-38 不存在（N-09），P2 证据问题未作为缺陷记录 |

### 3.1 首轮点名的特别复核（任务书 a–f）

- **a) 终态/错误 epoch/被取代提交是否被拒且无写入；首错 `correctionsRemaining`**：✅ 实测全部通过（EXP2/EXP8，行数与事件增量均为 0；首错返回 1）。残余见 N-02/N-08。
- **b) `joinPolicy=none` 是否不再挂起；none 失败是否通知而不阻断；Gate 事件 data 是否带足全部结果**：✅ 不挂起（EXP6）；✅ 通知且不阻断（EXP4b 首次调用、`join.test.ts:249-270`）；⚠️ 事件 data **仍不全**（EXP7）：有 summary/artifactIds/unknowns/requestedActions，**缺 evidenceRefs、changedPaths、findingIds，且 artifactRefs 丢 version/hash**。
- **c) 持久事件名是否只剩 §7 允许的名字**：❌ 仍发出 `run.waiting_children`、`run.children_joined`（EXP1）。无 DC 记录、无承接方案；DC-37 RE-04 反而声称已删除。
- **d) 预算预留是否落库/结算释放/防双花**：✅ 落库与结算释放（EXP3b）、✅ 防双花（`orchestrator.test.ts:454-479`、EXP4）；❌ `contract_violation` 路径泄漏（EXP3b/EXP4）。
- **e) `run.ts` 改哈希是否已在 plan/discovery 记为待确认偏离**：✅ 已记（`plan.md:27`、`discovery.md:72`）。判断：偏离技术理由成立且已上报，但 `data.md` 与代码冲突仍在，属产品决定待定（N-11）。
- **f) DC-37 每条是否与代码一致**：RE-01/03/05/07/09/10/11/12 一致；**RE-04 不一致**（声称删除的两个事件名仍在）；RE-02 的“可接消息”证据仍无效；RE-08 引用的 DC-38 不存在。

---

## 4. 新 Findings

### N-01 [P2] 预算预留泄漏：Run 经 `contract_violation` 终态时 `tokensReserved` 永不释放

- 位置：`packages/core/src/stage.ts:264-277`（`reject` 直接把 Run 置 `contract_violation` 并发 `run.ended`），对照 `packages/core/src/orchestrator.ts:564-574`（唯一释放点）与 `:593-601`。
- 事实（实跑，EXP3b/EXP4）——A(50k) + child(30k) 后 `tokensReserved=80000`；child 连续两次 Schema 失败进入 `contract_violation` 后仍为 80000（应回落到 50000）。随后一份合法 chief(30k) 派发因 `used+reserved` 超限被拒：`CONSTRAINT_VIOLATION: budget update failed its contract schema`。
- 违背依据：`docs/architecture/reliability.md` §3「模型调用前预留…**扣除实际usage并释放剩余**；并行调用共享Work预算事务，防止双花」；`docs/rules/workflow.md` §5.3 终态语义。
- 影响：任一 Run 一次违规即永久占用 Work 预算；后续派发被误拒，需人工改库才能恢复，且错误码不是文档规定的 `BUDGET_EXCEEDED`。
- 建议：把预留释放收敛到“Run 进入任一终态”的唯一内部入口（`StageGate.reject` 与 `Orchestrator.settleRun` 共用），并在该事件 data 中带上 `releasedTokens`；补一条「contract_violation 后 reserved 回落」的测试。

### N-02 [P2] `stage.submit` 只把“终态”当拒绝条件，非终态但不可交付的 Run 仍接受交付

- 位置：`packages/core/src/stage.ts:121-161`（守卫仅 `isTerminalRunStatus` + epoch + Attempt 现行 + 可选版本，无状态白名单）。
- 事实（实跑）：EXP9——Run 分别为 `paused`、`waiting_permission`、`interrupted`、`recovery_required` 时，一份合法载荷均返回 `accepted:true` 并写入 `stage_result` 行（rows=1）。
- 违背依据：`docs/architecture/reliability.md` §2「**Late事件检查attempt/epoch/expected版本，不覆盖取消、更新后的Plan或新Attempt**」；`docs/rules/workflow.md` §5.3（`interrupted` 需检查后新 Attempt、`recovery_required` 先关闭 RecoveryDecision）；第一轮 R-01 建议原文「要求 Run 处于允许提交的状态（非终态、非 waiting/Paused 之外）」。
- 影响：`interrupted`/`recovery_required`/`paused` 的 Run 仍可被旧 Attempt 追加交付证据，`JoinCoordinator.outcomeOf`（`join.ts:84-112`）按“最新 stage_result”取结果时会把迟到结果当成该子 Run 的成果——与首轮 P1 同类影响，只是状态不同。
- 建议：改为状态白名单（仅 `running`；若 Chief 需在 `waiting_children` 交付须单独论证并落 DC），其余 `INVALID_STATE` 且不写行不写事件；与 N-08 一并处理。

### N-03 [P2] DC-37 RE-04 与代码不符：两个自造 Join 事件名仍在发出，且无承接方案

- 位置：`packages/core/src/join.ts:175`（`run.waiting_children`）、`:245`（`run.children_joined`）；陈述见 `.agentdev/work/WP-02/discovery.md:70`。
- 事实（实跑）：EXP1 在一次 `chief + 2×join=all` 全流程中实际发出的持久事件名为 `["run.children_joined","run.ended","run.queued","run.started","run.waiting_children","stage.completed"]`；`docs/architecture/protocol.md` §7 清单无 `run.waiting_children`/`run.children_joined`。DC-37 RE-04 明写“两个自造事件名**已删除**”，与代码矛盾。
- 违背依据：`docs/architecture/protocol.md` §7 持久事件契约；`docs/rules/workflow.md` §6「Discovery：保存证据、影响、建议、实际路由」；`AGENTS.md`「按实际证据报告完成情况」。
- 影响：事件日志中存在未被协议承认的类型；按文档实现的 WS/BFF 消费者（WP-08/WP-09）无对应契约可依；修复记录不可信会污染后续 Settlement 知识。
- 建议：删除这两个事件（Join 状态仅保留在 Run 行与返回值），或在 `discovery.md` 中作为显式偏离记录并给出承接包（WP-08 读模型）与 `protocol.md` §7 扩展方案；同时修正 DC-37 RE-04 的不实表述。

### N-04 [P2] 必需失败测试「父等待可接消息」仍无区分力（R-02 未真正修复）

- 位置：`packages/core/test/join.test.ts:194-235`；`packages/core/src/mailbox.ts:129-147`；`packages/core/src/orchestrator.ts:275-291`。
- 事实（实跑）：EXP5——把 Chief 父 Run 置为终态 `completed` 后，测试所用的 `ProjectMailbox.submitCommand({subject: chief.id, operation:'agent.dispatch', run: …})` → `orchestrator.dispatch` 路径仍 `accepted:true` 并成功创建子 Run。即断言“父等待时能接命令”对 `running`/`waiting_children`/`completed` 无区分力；`submitCommand` 仍不读 `subject` 或任何 Run 状态。
- 违背依据：`docs/delivery/implementation.md` WP-02「必需失败测试：…父等待可接消息…」；`docs/rules/workflow.md` §6「报告不能以『应该通过』代替执行」；`docs/delivery/acceptance.md` AC-046「新Chief消息可处理」。
- 建议：二选一——(a) 在命令处理路径显式校验 Run 状态，使测试在“把等待当锁”的实现下必然失败；(b) 改用真正依赖父状态的路径断言（例如 `waiting_children` 时对同一父 Run 提交 `stage.submit`/`request_dispatch` 应被 `INVALID_STATE` 拒绝，而消息类命令仍准入），并断言“新 Chief 对话 Run 独立于等待中的父 Run”。

### N-05 [P2] `dispatch` 不校验父 Chief Run 状态，终态父 Run 仍可接收新子 Run

- 位置：`packages/core/src/orchestrator.ts:273-291`（`isDirectChiefChild`，`domain/src/dispatch.ts:101-108` 只校验 `id/role/workId`）。
- 事实（实跑）：EXP5——父 Chief Run 已 `completed`，`orchestrator.dispatch({spec: professionalSpec({parentRunId: <completed chief>})})` 仍成功创建 `queued` 子 Run。
- 违背依据：`docs/rules/workflow.md` §5.3「completed/…、contract_violation 终态；**后续工作创建新Run**」；`docs/rules/agents.md` §3「所有子Run为ChiefRun的直接子级」「父Run取消传播未终态子Run」；AC-045 主控分派。
- 影响：终态 Chief 下的孤儿子 Run 永远不会被 Join 收敛（父不再运行），结果丢失；破坏“终态后新建 Run”的领域语义。
- 建议：`dispatch` 在父子校验中增加 `parent.status` 允许集（如 `starting/running/waiting_children` 等执行态），终态父返回 `INVALID_STATE`；补负例测试。

### N-06 [P3] Join 重算非幂等：重复调用 `onChildSettled` 重复写 `chief_action_required`

- 位置：`packages/core/src/join.ts:191-204`（`none` 失败）与 `:205-232`（required 失败）。
- 事实（实跑）：EXP4b——对同一个已失败的 `none` 子 Run 调用两次 `onChildSettled`，`chief_action_required` 写 2 条；对同一个已失败的 required `all` 子 Run 同样 2 条。判定基于“当前所有子 Run 的失败集合”，不携带幂等键。
- 违背依据：`docs/architecture/reliability.md` §1「Outbox以operationId至少一次投递；Supervisor先检查已存在的同operationId Runner/结果，**避免重复创建**」；`protocol.md` §7（`chief_action_required` 是驱动 Chief 待办的持久事件）。
- 影响：重放/重算（WP-05 监督、WP-08 恢复）会把同一失败重复变成多条 Chief 待办，造成重复派发与重复计费风险。
- 建议：以 `(parentRunId, reason, 失败子Run集合)` 做幂等判定，或在写事件前查是否已存在同集合的同类待办。

### N-07 [P3] 被阻断 Gate 的事件 data 仍未带足「全部结果」

- 位置：`packages/core/src/join.ts:218-230`。
- 事实（实跑）：EXP7/exp5——子项键为 `[runId, role, status, requiredChild, join, summary, artifactRefs, unknowns, requestedActions]`；`artifactRefs` 被 `.map(ref => ref.id)` 降为裸 id（丢 `version/hash`），且**完全没有** `evidenceRefs`、`changedPaths`、`findingIds`，而 `ChildOutcome`（`join.ts:25-34`）本身持有这些字段。
- 违背依据：`docs/delivery/acceptance.md` AC-046「父可获**全部结果**」；`docs/rules/agents.md` §4 结果契约字段清单（status/summary/artifactRefs/evidenceRefs/changedPaths/findingIds/unknowns/requestedActions）。
- 建议：事件 data 直接携带完整 `stageResult`（至少补齐 evidenceRefs/changedPaths/findingIds 与 artifactRefs 全字段）。

### N-08 [P3] 第二次 Schema 失败在 `paused` 等状态抛 `VALIDATION_ERROR`，无法形成 `contract_violation`

- 位置：`packages/core/src/stage.ts:242-270`（先写 `stage.failed`，再以 `canTransitionRun(run.status,'contract_violation')` 校验；不满足即抛错回滚）。
- 事实（实跑）：EXP10——`paused` Run 第一次失败返回 `VALIDATION_ERROR`（写 1 条 `schema_invalid` 事件），第二次失败抛 `VALIDATION_ERROR: Run … cannot record a contract violation from paused`，Run 仍 `paused`，`schema_invalid` 事件仅 1 条。
- 违背依据：`docs/architecture/protocol.md` §6「普通文本结束没有该结果时Run等待提交提示，**连续两次不合规为contract_violation**」；`RUN_TRANSITIONS`（`domain/src/transitions.ts:69-73`）中 `waiting_permission/paused/waiting_children` 均无到 `contract_violation` 的迁移。
- 影响：fail-closed（未静默降级）可接受，但“二次失败即 `contract_violation`”的终局性在多个非运行态不成立，且已落 1 条拒绝事件后停止升级，语义不完整。
- 建议：与 N-02 合并——不可交付状态应直接拒绝提交（不产生修正计数），或在迁移表中补齐这些状态到 `contract_violation` 的路径并明确终局语义。

### N-09 [P3] 代码引用不存在的 `DC-38`，Run 参数层与 Authorization 的绑定缺口未落 Discovery

- 位置：`packages/core/src/orchestrator.ts:79`（`… binds them to the Authorization record (DC-38) …`）；`discovery.md` 仅到 DC-37。
- 事实：全仓 `grep DC-38` 仅命中该注释，`.agentdev/work/WP-02/discovery.md` 无该条目。
- 违背依据：`docs/rules/workflow.md` §6 Discovery 要求（偏离与缺口须有可追踪条目）；首轮 R-13。
- 建议：补 DC-38（记录 `runParams` 尚无授权来源、归 WP-04/WP-07）或改用已存在的 DC 编号。

### N-10 [P3] Chief 规格超出 Work 预算时返回 `CONSTRAINT_VIOLATION` 而非 `BUDGET_EXCEEDED`

- 位置：`packages/core/src/orchestrator.ts:345-348`（所有 kind 都走 `reserveBudget`）、`:583-591`；Work 预算准入 `canAllocateBudget` 只在 `requireBudget`（`:617-639`，professional 专用）被调用。
- 事实（实跑）：EXP4——chief 规格超 Work 预算时抛 `CONSTRAINT_VIOLATION: budget update failed its contract schema: tokens used + reserved exceeds the limit`；`orchestrator.test.ts:462-464` 仅断言 `/exceeds/`，未断言错误码。
- 违背依据：`docs/architecture/protocol.md` §7 错误表（预算不足应为 `BUDGET_EXCEEDED`）；`plan.md` T4 预算分配。
- 建议：对 `chief`/`professional` 统一在写库前跑 `canAllocateBudget(workBudget, allocation)`，`reserveBudget` 只做已准入的原子写入。

### N-11 [P3] `data.md` 与代码的 Run 快照引用类型冲突未消解（R-06 残余，产品确认未完成）

- 位置：`docs/architecture/data.md:30,80`（`configSnapshotId:ID, contextSnapshotId:ID, dispatchSnapshotId:ID`、`DispatchSnapshot.contextSnapshotId:ID`）对照 `packages/contracts/src/entities/run.ts:39`（`snapshotRefSchema = hashSchema`）与 `structures.ts` 的 `dispatchSnapshotSchema.contextSnapshotId`。
- 事实：偏离已在 `plan.md:27`（planVersion 2）与 `discovery.md:72`（RE-06）记录，代码与测试一致地使用 64 位哈希；但权威文档 `data.md` 未改，`docs:check` 不做“代码 vs 文档契约”交叉校验，因此冲突不会被任何命令发现。`plan.md:32` 的“授权来源”引用的是 Review R-05 与用户「继续」，并非产品方对契约变更的确认。
- 违背依据：`docs/rules/workflow.md` §4/§8（产品/契约语义变更需 Decision 与用户确认）；`reliability.md` §5（产品语义变更需 Decision 并回对应 Gate）。
- 判断：本轮**不判为阻断**（理由充分、已显式记录、回退代价已说明），但属 `Product Decision Pending`。若不加确认，后续按 `data.md` 实现的消费者/迁移会与代码不匹配。
- 建议：在 Settlement 前取得产品方 Decision：确认 `SnapshotRef=Hash` 并更新 `data.md` §2/§3，或回退为 `ID` 并为 `snapshot` 增列 + 迁移。二者必居其一，不能长期并存。

---

## 5. 未验证 / 无法验证项

1. **WL-01 真实 Provider 调用与 Secret 存储**：`ModelGateway` 的 `GatewayTransport`/`SecretResolver` 仍为注入缝，真实 HTTP 与 Secret 加密属 WP-07/WP-10（DC-31）。AC-043「不同 Provider」仍只是结构验证（所有测试只用一个 Provider）。
2. **WL-02 Run 的独立 Session/工具范围**：`agents.md` §1 的 Session/工具执行部分归 WP-05/WP-07，本包只验证模型配置与三个快照。
3. **WL-03 ContextBuilder/上下文内容与 token 计量**：`dispatch` 的 `contextPayload` 仅有 fallback（`orchestrator.ts:316-324`），属 WP-06；AC-082 的工具层负例按 Plan 归 WP-07。
4. **WL-04 `readLedgerHash` 真实性**：`stage.ts` 只做 64 位十六进制 Schema 校验，未与读账本核对（属 WP-05/WP-06）。
5. **WL-05 事件消费者的端到端兼容性**：N-03 的残留事件名在 WS/BFF/UI 尚未实现（WP-08/WP-09）时不会暴露；本轮只从 `protocol.md` §7 静态判定。
6. **WL-06 `test:e2e`/`test:acceptance`/`test:live`**：按契约 `NOT_IMPLEMENTED`，未执行。
7. **WL-07 T9 未完成**：`docs/INDEX.md:26-30` 仍只列 WP-00/WP-01 且称 Work/Run 编排「仍未实现」；`docs/delivery/acceptance.md` 无 WP-02 证据登记；无 Settlement 材料。本次 Review 只能判定“实现是否成立”，不能判定“结算是否完成”。
8. **WL-08 并发**：`reserveBudget` 与 Run 行写入同一事务、预算更新走版本 CAS，未见双花；但本轮未做真实并发压测（WP-05/WP-10 范围）。

---

## 6. 方法与边界声明

- 本报告只依据仓库文件、`c4763d5` 上的 git 对象/差异与实跑命令；未读取任何开发对话、未引用外部同名技能或历史方案；未修改产品代码、测试、`docs/**` 或 WP-02 的 plan/implementation/discovery。
- 唯一写入文件为本文件 `.agentdev/work/WP-02/review.md`；实验脚本独立写在 `/tmp/wp02-r2/`（`exp.mjs`、`exp2.mjs`、`exp3.mjs`、`exp4.mjs`、`exp5.mjs`），使用 `pnpm build` 产出的 `packages/*/dist`，等价复现 `join.test.ts`/`orchestrator.test.ts` 的夹具。
- `pnpm build` 只写 `.gitignore` 中的 `dist/`，复核结束时 `git status --porcelain` 仍无输出。
