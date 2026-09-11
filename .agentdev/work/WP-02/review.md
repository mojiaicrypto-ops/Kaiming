# WP-02 独立 Review 报告

- 评审对象：工作包 WP-02「主管与独立Agent调度」
- 冻结点：git `785bdd6`（`feat(core): WP-02 T3-T8 ...`，前置 `a047a9f` T1-T2）
- 工作树：`git status --porcelain` 无输出 → 无未提交改动
- 评审角色：Review（独立上下文，不读取开发对话；只依据仓库文件与实跑命令）
- 权威依据：`docs/rules/{workflow,agents}.md`、`docs/architecture/{data,protocol,reliability,context,ARCHITECTURE}.md`、`docs/delivery/{implementation,acceptance}.md`、`.agentdev/work/WP-02/{plan,implementation,discovery}.md`

---

## 1. 结论

**FAIL（Review Failed）**——1 个 P1、5 个 P2、7 个 P3。

依据摘要：

- 工程契约命令全部通过：`typecheck`、`lint`、`test:unit`（17 文件 / 202 用例）、`test:integration`（10 文件 / 124 用例，含真实 Docker）、`docs:check`、`build` 均退出 0；`test:e2e|acceptance|live` 按约定 `NOT_IMPLEMENTED`。T1–T8 的主体实现真实存在，四个快照/派发/Stage/Join 模块可运行，AC-044、AC-082 的证据有效。
- **但必需失败测试③「父等待可接消息」是空洞证据**：`ProjectMailbox.submitCommand` 根本不感知 Run 状态，该断言在任何 Run 状态下都会通过，AC-046「新Chief消息可处理」未被有效验证（R-02）。
- **P1：`StageGate.submit` 没有终态/epoch 守卫**。实跑证明一个已进入终态 `contract_violation` 的 Run 仍能接受合法 `stage.submit`，写入 `stage_result` 行与 `stage.submitted` 事件（R-01）。这违背 `agents.md` §4「结果到达Core后检查attempt/epoch/版本/预算/Scope」与 `workflow.md` §5.3 终态语义。
- **P2：`joinPolicy=none` 语义完全未实现**。`JoinCoordinator` 从不读取 `run.join`；实跑证明两个 `joinPolicy=none` 的子 Run 中一个结算后，Chief Run 被挂到 `waiting_children`，与 `agents.md` §3「none持久分派后Chief可继续」相悖（R-03）。
- **P2：持久事件名偏离 `protocol.md` §7**。文档规定 `run.started`/`run.ended`/`stage.completed|failed`，实现发出 `run.starting`/`run.running`/`run.settled`/`stage.submitted`/`stage.rejected`；文档名一个都没有发出（R-04）。
- **P2：实现超出 Plan 的 writePaths**（新增 `snapshots.ts`、改 `contracts/src/entities/run.ts`、改 `contracts/test/entities.test.ts`），且 `run.ts` 把 Run 快照引用从 `ID` 改成内容哈希，与仍然权威的 `data.md` §2/§3 原文冲突，未获 Plan 授权、未在 Discovery 中作为偏离处理（R-05、R-06）。

由于 R-01 直接违反状态机与 Stage 结果校验契约，R-02 使 AC-046 的关键行为缺少有效证据，R-03/R-04 是接口/语义偏离，按 `workflow.md` §6「影响验收则阻断」，本包**不具备进入独立 Test / Settlement 的条件**；T9（`docs/INDEX.md` 状态与结算材料）本记录也自述为待办，尚未完成。

---

## 2. 验证命令与原始结果

环境：`export PATH="$HOME/.local/bin:$PATH"`，工作目录 `/Users/huyaohua/huyh/work/aigrouptool`，全部在 `785bdd6`、干净工作树上执行。

| 命令 | 退出码 | 关键原始输出 |
|---|---|---|
| `pnpm typecheck` | 0 | `$ tsc -p tsconfig.json --pretty false`（无错误输出） |
| `pnpm lint` | 0 | `Checking formatting... All matched files use Prettier code style!` |
| `pnpm test:unit` | 0 | `Test Files  17 passed (17)` / `Tests  202 passed (202)`，耗时 6.76s |
| `pnpm test:integration` | 0 | `Test Files  10 passed (10)` / `Tests  124 passed (124)`，耗时 91.82s（含 `container.integration.test.ts` 真实镜像 9 用例） |
| `pnpm docs:check` | 0 | `docs:check ok — 15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages` |
| `pnpm build` | 0 | 全部 workspace `Done`（contracts/domain/storage/pi-runtime/core/cli/runner） |
| `pnpm test:e2e` | 1（预期） | `NOT_IMPLEMENTED: command test:e2e is not implemented yet; it lands with WP-09` |

新增测试文件与用例数（与 `implementation.md` 自述一致）：`config.test.ts` 8、`model-gateway.test.ts` 6、`orchestrator.test.ts` 10、`join.test.ts` 5；WP-02 前基线为 173（WP-01），本包新增 29 → 202，未回退。

### 2.1 额外独立实验（Review 自建，脚本位于 `/tmp/wp02-review/`，不改产品代码）

**实验 A：joinPolicy=none 是否真的不挂起父 Run**（`join-policy.mjs`，用 `packages/*/dist` 构建产物）

```
child A join = none | child B join = none
after A(join=none) settles, outcome = waiting
parent status = waiting_children (agents.md §3: joinPolicy=none => Chief 可继续, 不应挂起)
parent childIds = 2 | child B join = none
```

结论：两个子 Run 均为 `joinPolicy=none`，A 结算后父 Run 仍被置为 `waiting_children`。`run.join` 字段在 `packages/core/src`、`packages/domain/src` 中**从未被读取**（grep `.join` 无命中）。

**实验 B：终态 Run 是否仍接受 stage.submit**（`stage-terminal.mjs`）

```
1st bad submit: ...{"accepted":false,"code":"VALIDATION_ERROR",...,"correctionsRemaining":0}
2nd bad submit: ...{"accepted":false,"code":"CONTRACT_VIOLATION","runStatus":"contract_violation","rejections":2}
run status now: contract_violation
submit on TERMINAL run accepted? true | stage_results rows = 1
```

结论：Run 已是终态 `contract_violation` 后，一份合法载荷仍被接受并落 `stage_result` 行。

---

## 3. 逐条 AC 与 T1–T8 核对表

### 3.1 Plan T1–T8（T9 未完成）

| Task | 实现位置 | 证据 | 结论 |
|---|---|---|---|
| T1 配置与继承（AC-043/044） | `packages/core/src/config.ts`、`toml.ts`、`snapshots.ts`；`contracts/src/entities/structures.ts` | `config.test.ts` 8 用例：四层继承 + 逐字段 `sources`、Run 参数覆盖、reasoning 不支持拒绝、`min(profile, window−maxOutput−4096)`、冻结后变更不影响、UPDATE 被触发器拒绝 | 实现真实。但新增 `snapshots.ts` 超出 Plan writePaths（R-05）；`config.ts` 的 Run 参数层在派发路径不可达（R-08） |
| T2 模型网关（AC-043/044） | `packages/core/src/model-gateway.ts` | `model-gateway.test.ts`：`complete()` 签名无模型入口；配置变更后活动 Run 仍用旧 model/reasoning、新冻结用新 model；无可用模型不回落；缺快照/缺 secret 不发请求 | 通过。真实 HTTP/Secret 属 WP-07/WP-10（DC-31 已记录） |
| T3 Assessment（AC-045） | `orchestrator.ts:157-193` | `orchestrator.test.ts`：不可变行 + `assessment.saved`、重复评估新行、L3 无 `authorizationRef` → `NOT_AUTHORIZED` | 通过。但实现记录称「等级判定复用 domain」，`decideLevel` 实际未被调用（R-11） |
| T4 Dispatch 冻结与建 Run（AC-043/045/082） | `orchestrator.ts:203-316` | `orchestrator.test.ts`：三快照真实存在且类型正确、行哈希=内层 `hash`、`snapshot` UPDATE 报 immutable、`run.queued`、孙 Run 拒绝、跨 Work task 拒绝、stale `profileRevision` 拒绝、预算超限拒绝、purpose×role 拒绝 | 主体通过。事件名偏离 protocol §7（R-04）；Work 预算预留未落库（R-07）；`run.ts` 越界改动（R-05/R-06） |
| T5 Join 与局部失败（AC-046） | `packages/core/src/join.ts` | `join.test.ts`：父 `waiting_children`→全终态回 `running`；required 失败→`blocked` + `chief_action_required`；兄弟保留；optional 失败不阻断 | 部分通过。`joinPolicy=none` 未实现（R-03）；「可接消息」证据空洞（R-02） |
| T6 request_dispatch（AC-045） | `orchestrator.ts:325-369` | `orchestrator.test.ts`：只产生 `chief_action_required`、`entityId`=Chief Run、无孙 Run；非自身 Chief 父被拒、Chief 自身调用被拒 | 通过。内核入参与 protocol §6 不一致（R-12） |
| T7 Stage 契约（AC-047） | `packages/core/src/stage.ts` | `join.test.ts`：口头/缺字段提交被拒且无 `stage_result` 行；第一次 `VALIDATION_ERROR`、第二次 `CONTRACT_VIOLATION` 且 Run=`contract_violation`；归属字段伪造抛错、跨 Run attempt 拒绝 | 部分通过。**终态 Run 仍接受合法提交，无 epoch/版本守卫（R-01）**；事件名缺失（R-04） |
| T8 重启窄范围（AC-082） | `orchestrator.ts:379-412` | `orchestrator.test.ts`：Work scope 放宽后 `recoveryView` 仍返回冻结窄 scope 与 `requiredOutputSchemas`；快照缺失 → `STALE_ARTIFACT` | 通过（快照层）。工具层负例按 Plan 归 WP-07，属明示延后 |
| T9 测试与记录 | `implementation.md:59-61` | 自述「待办」：独立 Review/Test、`docs/INDEX.md` 状态、`acceptance.md` 证据登记 | **未完成**。`docs/INDEX.md:26-30` 仍只写 WP-00/WP-01，且称 Work/Run 编排「仍未实现」，与本包代码不符（属 T9 待办，非造假） |

### 3.2 AC 核对

| AC | 要求要点 | 实现/证据 | 结论 |
|---|---|---|---|
| AC-043 独立模型 | 角色配置不同 Provider；实际配置与角色一致；专业 Run 独立 | 每 Run `config.freeze(role)` + 「冻结快照」读取；`model-gateway.test.ts` 证明运行走冻结档 | **部分**：结构成立，但全部测试只用一个 Provider，未直接验证「不同角色不同 Provider」；Run 的独立 Session/工具属 WP-05/WP-07（P3） |
| AC-044 配置冻结 | 修改配置仅新 Run 生效；原 Run 可查；无隐式换模型 | `config.test.ts:206-239` + `model-gateway.test.ts:140-169` 断言有效；`snapshot` UPDATE 触发器保证不可变 | **通过** |
| AC-045 主控分派 | request_dispatch 只产生 Chief 待办；无孙 Run | `orchestrator.test.ts:330-361,453-494`：孙 Run 抛错且子表为 0；request_dispatch 只写事件 | **通过**（入参形状差异见 R-12） |
| AC-046 Join 和失败 | 兄弟保留、父获全部结果、Gate 阻断、新 Chief 消息可处理 | `join.test.ts:188-238`：兄弟保留、`blocked`、`chief_action_required` 有效；「可接消息」断言空洞 | **部分/不通过**（R-02、R-03） |
| AC-047 结构化交付 | 口头不通过；二次 Schema 错误 `contract_violation` | `join.test.ts:252-272` 有效；但终态后仍可提交 | **部分**（R-01、R-04） |
| AC-082 重启保留窄范围 | 按 DispatchSnapshot 保持窄权限与输出 Schema，Work 宽范围不能替代 | `orchestrator.test.ts:412-451`：Work 放宽后 `recoveryView` 仍窄；工具层负例 Plan 明示归 WP-07 | **通过**（快照层） |

---

## 4. Findings

### R-01 [P1] `stage.submit` 无终态/epoch/版本守卫，终态 Run 仍能接受交付

- 位置：`packages/core/src/stage.ts:103-167`（`submit`）、`packages/core/src/stage.ts:183-226`（`reject`）
- 事实（实跑复现，见 §2.1 实验 B）：Run 已是终态 `contract_violation` 后，同一 `attemptId` 提交合法载荷仍返回 `accepted:true` 并写入 `stage_result` 行与 `stage.submitted` 事件。`submit` 只校验 `run` 存在与 `attempt.runId === run.id`，不校验 `run.status`、`attempt.epoch`、`expectedVersion`。
- 违背：`docs/rules/agents.md` §4「结果到达Core后检查attempt/epoch/版本/预算/Scope」；`docs/architecture/protocol.md` §6 `stage.submit* | attemptId,epoch,result:StageResult`（epoch 为必填参数，内核未接收）；`docs/rules/workflow.md` §5.3「completed/failed/cancelled/timed_out/contract_violation终态；后续工作创建新Run」；`docs/architecture/reliability.md` §2「Late事件检查attempt/epoch/expected版本」。
- 影响：终态 Run 可被追加交付证据，`JoinCoordinator.outcomeOf` 取「最新 `stage_result`」时可能把违规后的迟到结果当作该子 Run 的成果；「二次失败即 `contract_violation`」的终局性被绕过。
- 建议：`submit` 在写入前要求 Run 处于允许提交的状态（非终态、非 waiting/Paused 之外），校验 `attemptId` 属于当前 `ownerEpoch`/现行 Attempt，并接收 `epoch`/`expectedVersion`；越界返回 `VALIDATION_ERROR`/`STALE_ATTEMPT` 且不落行不落事件。
- 附带（P3，可并入本项）：`stage.ts:60` 首次拒绝返回 `correctionsRemaining: 0`，与同段注释「The Attempt may submit once more」及 `agents.md` §4「Schema第一次失败允许修正」矛盾，字段语义应为 1。

### R-02 [P2] 必需失败测试③「父等待可接消息」是空洞断言，AC-046 关键行为缺有效证据

- 位置：`packages/core/test/join.test.ts:194-206`；对照 `packages/core/src/mailbox.ts:129-147`
- 事实：测试把父 Run 置入 `waiting_children` 后，调用 `mailbox.submitCommand({subject: chief.id, operation:'join.status', run: () => joins.state(chief.id)})` 并断言 `accepted === true` 与 `completion` 解出 `kind:'waiting'`。`ProjectMailbox.submitCommand` 只检查 `closed`/队列条数/字节数，**从不读取 `subject` 或任何 Run 状态**；因此该断言在任何 Run 状态下都成立，测试无法因「父被阻塞」而失败。全仓 grep 显示产品代码中除 `join.ts` 自身外没有任何地方读取 `waiting_children`，测试也未触及一个「会因等待而被拒绝」的命令路径。
- 违背：`docs/delivery/implementation.md` WP-02「必需失败测试：…父等待可接消息…」；`docs/delivery/acceptance.md` AC-046「新Chief消息可处理」；`docs/rules/workflow.md` §6「报告不能以『应该通过』代替执行」。任务书明确将「只断言不抛错/只看返回对象存在」的测试判为无效证据。
- 建议：补一个真正会在父 Run 阻塞时失败的断言——例如模拟「父 `waiting_children` 时新的用户命令/`request_dispatch` 仍被准入并产生事件」，或让命令处理路径显式校验 Run 状态，使测试在错误实现下必然失败。

### R-03 [P2] `joinPolicy=none` 语义未实现，none 子 Run 仍把 Chief 挂起

- 位置：`packages/core/src/join.ts:117-136`（`state`）、`packages/core/src/join.ts:155-178`（`onChildSettled`）；`run.join` 全仓无人读取
- 事实（实跑复现，见 §2.1 实验 A）：两个 `joinPolicy=none` 子 Run，A 结算后 `onChildSettled` 返回 `waiting` 且父 Run 变为 `waiting_children`。`dispatch` 已把 `spec.joinPolicy` 存进 `run.join`（`orchestrator.ts:292`），但 Join 判定只看「是否有未终态子 Run」，从不区分 none/all。
- 违背：`docs/rules/agents.md` §3「joinPolicy=none/all；**none持久分派后Chief可继续**，all挂起该ChiefRun直至指定子Run终态」；`docs/rules/workflow.md` §3/§4 隐含的 none 非阻塞语义；`implementation.md:39`「`join=none` 的父不进入等待」与该代码行为不符。
- 影响：当前 `waiting_children` 未被视为锁（`join.ts:115` 注释、R-02），故「Chief 可继续」在消息层面尚能成立；但 Run 状态/事件与实际策略不符，任何后续把 `waiting_children` 当阻塞处理的组件都会升级为真实阻塞。
- 建议：Join 判定只把 `join==='all'` 的子 Run 计入挂起集合（none 子 Run 仅在终态汇总时进入 `children`），并补 `joinPolicy=none` 的测试。
- 附带（P3）：`join.ts:186-200` 写入的 `chief_action_required` 只带 `runId/role/status/requiredChild`，不含兄弟的 `summary/artifactRefs/evidenceRefs`；仅凭持久事件重建时，「父获全部结果」不完整（返回值对象里有，事件里没有）。

### R-04 [P2] 发出的持久事件名与 `protocol.md` §7 不符，文档事件名一个都没有产生

- 位置：`packages/core/src/orchestrator.ts:300`（`run.queued`，符合）、`:445`（`run.starting`）、`:455`（`run.running`）、`:480`（`run.settled`）；`packages/core/src/stage.ts:153`（`stage.submitted`）、`:191`（`stage.rejected`）、`:213`（`run.contract_violation`）；`packages/core/src/join.ts:166`（`run.waiting_children`）、`:213`（`run.children_joined`）
- 事实：`docs/architecture/protocol.md:120` 规定持久事件为 `run.queued/started/ended`、`stage.completed/failed`；实现发出的是 `run.starting`/`run.running`/`run.settled` 与 `stage.submitted`/`stage.rejected`，文档名 `run.started`、`run.ended`、`stage.completed`、`stage.failed` **均未发出**。事件名是自由字符串，无 Schema 校验，因此不会在测试中报错。
- 违背：`docs/architecture/protocol.md` §7 持久事件契约（客户端/WS/BFF 依赖契约名渲染 run 起止与 stage 成败）；`plan.md:50`「按 `protocol.md` §6 实现内核」的对齐要求。
- 影响：后续按文档实现的 WS/UI 消费者收不到 `run.ended`/`stage.completed`，无法正确渲染终态与失败。
- 建议：改用文档事件名（或按流程变更 `protocol.md` 并新增 Discovery）；`stage.submit` 验证后应产生 `stage.completed`/`stage.failed`，并保留 `run.ended` 承载真实 outcome。

### R-05 [P2] 实现对 Plan writePaths 的越界改动，Plan 未修订、Discovery 未作为偏离处理

- 位置：`.agentdev/work/WP-02/plan.md:16-29`（writePaths）对比 `git diff --name-only b9df25e..785bdd6`
- 事实：Plan 明确 writePaths 只含 `core/src/{config,toml,model-gateway,orchestrator,join,stage,index}.ts`、`domain/src/**`、`contracts/src/entities/structures.ts`（仅 Schema 缺口）、`core/test/**`、`.agentdev/work/WP-02/**`，并写明「不可写 `packages/contracts`（除上述缺口）」。实际改动额外包含：
  - `packages/core/src/snapshots.ts`（新增，Plan 未列；`config.ts` 条目只写「ConfigSnapshot 冻结」）
  - `packages/contracts/src/entities/run.ts`（改 `runSchema` 三个快照引用 + 新增 `snapshotRefSchema`）
  - `packages/contracts/test/entities.test.ts`（改 Run 夹具）
- 违背：`docs/rules/workflow.md` §4 Plan 必需「写入范围」，`plan.md` 自身第 29 行「不可写」清单；skill/交付规则「Developer modifies only approved scope」。DC-27/DC-28 只记录了技术事实，未把「超出 Plan 写入范围」记为偏离，也未修订 Plan。
- 建议：要么将上述文件补入 Plan（planVersion 递增 + 授权确认）并新建 Discovery 条目，要么把改动收敛回授权范围（新增模块可由 `config.ts` 承载）。R-06 的契约变更尤其需要授权。

### R-06 [P2] `run.ts` 快照引用改为内容哈希，与仍然权威的 `data.md` §2/§3 冲突且未获授权

- 位置：`packages/contracts/src/entities/run.ts:31-37,53-55`；`packages/contracts/src/entities/structures.ts` `dispatchSnapshotSchema.contextSnapshotId`
- 事实：`docs/architecture/data.md:30` 明确 `run.configSnapshotId:ID, contextSnapshotId:ID, dispatchSnapshotId:ID`，`:80` 明确 `DispatchSnapshot={..., contextSnapshotId:ID, ...}`。实现把三处改为 `hashSchema`。DC-27 记录「若按 id 建 Run，存储层会拒绝或产生永不匹配的引用」，技术上确有一致性问题（`snapshot` 主键为 `(type,hash)`、无 id 列），但本次同时把 **Run 实体契约**从 UUID 改成 64 位哈希，改变了对外数据契约。
- 违背：`docs/architecture/data.md` §2/§3 原文；`docs/rules/workflow.md` §4/§8（产品/契约语义变更需 Decision 与用户确认）；`plan.md:29`「不可写 `packages/contracts`（除上述缺口）」。
- 影响：`data.md` 与代码/测试现在互相矛盾（`entities.test.ts` 已改为哈希）：后续按文档实现的消费者/迁移会不匹配；知识库中「唯一行为与证据目录」的 `data.md` 与实际契约漂移。
- 建议：本包内走正式偏离流程——补 Plan 授权、在 `settlement` 时更新 `data.md` §2/§3 为 `SnapshotRef:Hash`，或改回 `idRefSchema` 并在 storage 层建映射；二者必居其一，不能长期让文档与代码冲突。

### R-07 [P3] Work 级预算预留从未写库，`canAllocateBudget` 门槛实际失效

- 位置：`packages/core/src/orchestrator.ts:490-510`（`requireBudget`）
- 事实：`requireBudget` 只读取 `budgets` 行调用 `canAllocateBudget(budget, spec.budgetAllocation)`，随后既未增加 `tokensReserved` 也未创建预算预留；派发/结算路径也没有任何地方更新 `budget.tokensReserved`。因此 `tokensUsed + tokensReserved + requested` 恒等于 `requested`，Work 级检查起不到作用，真正的限制只来自父 Run 的 `budgetAllocation` 求和。
- 违背：`docs/architecture/reliability.md` §3「模型调用前预留input估算+maxOutputTokens…并行调用共享Work预算事务，防止双花」；`docs/rules/agents.md` §3 `budgetAllocation` 语义；Plan T4「预算分配」。
- 建议：派发事务内按 allocation 增加 `tokensReserved`（或明确记录该预留属 WP-05 并在 Discovery 标注），并补一个「Work 预算不足以拒绝第二次派发」的有效测试。

### R-08 [P3] 配置继承第一层「已授权 Run 参数」在派发路径不可达

- 位置：`packages/core/src/orchestrator.ts:231`（`gateway.availability(role)`）、`:248`（`this.config.freeze(role)`）；`packages/core/src/model-gateway.ts:90`（`availability(role, runParams={})`）
- 事实：`ConfigStore.resolve` 实现了 Run→Project→globalRole→globalDefault，`config.test.ts:162-165` 也用 `config.resolve('review', {reasoning:'off',contextLimit:10000})` 验证了 run 层；但 `Orchestrator.dispatch`/`currentProfileRevision` 都只传 `role`，`DispatchSpec` 也没有承载 run 参数的位置，因此「已授权Run参数」层在生产路径永远为 `{}`。
- 违背：`docs/rules/agents.md` §5 继承顺序首项「已授权Run参数」；Plan T1 声称的继承解析。
- 建议：明确 Run 参数的来源（授权字段/BFF 入参）并接入 `dispatch`，或记录为「WP-02 只实现解析、接入在后续包」的 Discovery。

### R-09 [P3] `readFrozen` 返回的对象不满足 `providerConfigSchema`，并丢失 `sources`

- 位置：`packages/core/src/config.ts:490-508`；冻结写入侧 `config.ts:458-485`
- 事实：`freeze` 只写 `provider:{providerId,type,baseUrl,secretRef}`，缺 `providerConfigSchema` 必需的 `enabled` 与 `models`；`readFrozen` 直接 `as unknown as` 断言成 `ProviderConfig` 返回，并以 `sources:{}` 丢弃逐字段来源。`recoveryView.profile` 因此是一个 Schema 上非法的 `ProviderConfig`。
- 违背：`docs/architecture/data.md` §3 Provider 字段（`enabled`、`models`）；`docs/rules/agents.md` §5「Profile字段…更改配置对后续Run生效」要求恢复时可核对来源。
- 建议：冻结时写入完整 provider 描述或把快照里的 provider 投影单独定义为 `FrozenProvider` 类型；`readFrozen` 保留 `sources` 或用 `providerConfigSchema.parse` 显式校验。

### R-10 [P3] `SnapshotWriter.freeze` 的幂等判定对 `type` 不敏感，可能返回错误类型的快照

- 位置：`packages/core/src/snapshots.ts:52-76`（`this.read(hash)` 按 hash 单查，忽略 type）
- 事实：`snapshot` 主键为 `(type,hash)`，同一 hash 可合法存在于两个 type 下；`freeze` 命中任意 type 的同 hash 行即返回 `created:false` 且不写新行。若 `dispatch` 的载荷哈希恰好与既有 `context`/`config` 行相同，Run 的 `dispatchSnapshotId` 会指向错误类型的行，`recoveryView` 随即报 `STALE_ARTIFACT`（`orchestrator.ts:388-392`）。
- 违背：`docs/architecture/data.md` §2 `snapshot` 主键 `(type,hash)`；`docs/architecture/reliability.md` §1 快照读取一致性。
- 建议：`freeze`/`read` 以 `(type,hash)` 为键，或至少在同 hash 命中但 type 不同时报错而非静默复用。

### R-11 [P3] 实现记录称「等级判定复用 domain」，但 `decideLevel` 从未被调用

- 位置：`packages/core/src/orchestrator.ts:157-165`；`.agentdev/work/WP-02/implementation.md:29`；对照 `packages/domain/src/routing.ts:120`
- 事实：`assess()` 只读取调用方传入的 `payload.level`，仅用 `requiresExplicitAuthorization(payload.level)` 做 L3 授权判断；domain 的 `decideLevel`（`workflow.md` §2 顺序）未被 orchestrator 引用（grep 仅命中 domain 测试）。
- 违背：`implementation.md` T3「等级判定复用 domain」及 `plan.md:37` 同表述的自我陈述；与「以实际证据报告完成情况」（AGENTS.md）冲突。
- 建议：`assess` 调用 `decideLevel` 对 Chief 提交的语义输入做交叉校验（或修正记录措辞为「只做 L3 授权校验，等级语义由 Chief 负责」）。

### R-12 [P3] `request_dispatch` 内核入参偏离 `protocol.md` §6

- 位置：`packages/core/src/orchestrator.ts:92-102`（`DispatchRequestInput`）
- 事实：`docs/architecture/protocol.md:108` 规定 `agent.request_dispatch* | workId,reason,requestedRole,goal,sourceRefs`；实现接收 `runId,role,purpose,goal,stage,parentRunId,requiredOutputs,requiredChild,budgetAllocation`，无 `reason`/`sourceRefs`。`plan.md:50` 声称「`agent.request_dispatch` 按 `protocol.md` §6 实现内核」。
- 违背：`docs/architecture/protocol.md` §6 方法契约；`plan.md:50`。
- 建议：补齐 `workId/reason/sourceRefs`（`runId` 应由 attempt capability 派生），或修订 Plan/协议并记录 Discovery。

### R-13 [P3] Discovery（DC-27..DC-36）本身成立，但遗漏本报告发现的偏离

- 位置：`.agentdev/work/WP-02/discovery.md:5-61`
- 事实：DC-27（快照哈希引用）、DC-28（显式 SQL）、DC-29（config.toml 细节）、DC-30（ContextSelection 缺字段）、DC-31（Provider/Secret 缺口）、DC-32（purpose×role 矩阵）、DC-33（Attempt 起点归 WP-05）、DC-34（profileRevision 编码）、DC-35（Gate 以 join 结果表达）、DC-36（stage.submit 归属）逐条与代码/文档相符，且任务书点名的三项（purpose×role 矩阵、Gate 语义、Attempt 起点归属）均已记录。但以下应当记录的偏离/缺口未记录：joinPolicy=none 未消费（R-03）、持久事件名偏离 protocol §7（R-04）、越界写入 Plan writePaths 与 `run.ts` 契约变更（R-05/R-06）、Work 预算预留未落库（R-07）、Run 参数层不可达（R-08）、stage.submit 缺 epoch/终态守卫（R-01）。
- 违背：`docs/rules/workflow.md` §6 Discovery 要求保存证据、影响、实际路由；`AGENTS.md`「按实际证据报告完成情况」。
- 建议：为 R-01/R-03/R-04/R-05/R-06/R-07/R-08 各补 DC 条目（或将其标记为「归后续包」并给出承接包），使偏离可追踪。

---

## 5. 未验证 / 无法验证项

1. **WL-01 真实 Provider 调用与 Secret 存储**：WP-02 只实现解析/冻结/能力校验，`GatewayTransport`/`SecretResolver` 为注入缝；真实 HTTP 与 Secret 加密属 WP-07/WP-10（DC-31 已记录）。AC-043「不同 Provider」因此只做了结构验证，未做真实连通验证（见 AC-043 结论）。
2. **WL-02 Run 的独立 Session/工具范围**：`agents.md` §1「每次Run有独立Session、Context、模型配置、工具范围及输出Schema」中的 Session/工具执行部分属 WP-05/WP-07；本包只验证了模型配置与三个快照。
3. **WL-03 ContextBuilder/上下文内容与 token 计量**：`dispatch` 的 `contextPayload` 仅有 fallback（`orchestrator.ts:251-259`），`contextSnapshotSchema`/预算计量属 WP-06，AC-082 的工具层负例按 Plan 归 WP-07；本报告只验证快照引用与窄 scope 恢复。
4. **WL-04 `stage.submit` 的 `readLedgerHash` 真实性**：实现只做 64 位十六进制 Schema 校验，未与读账本核对（属 WP-05/WP-06），AC-047 的「结构化交付」未覆盖该语义。
5. **WL-05 事件消费者的兼容性**：R-04 的事件名偏离在 WS/BFF/UI 尚未实现（WP-08/WP-09）时不会暴露；本报告只能从 `protocol.md` §7 静态判定，未做端到端消费验证。
6. **WL-06 `test:e2e`/`test:acceptance`/`test:live`**：按契约返回 `NOT_IMPLEMENTED`，未执行；发布回归统一在 WP-10。
7. **WL-07 T9 未完成**：`docs/INDEX.md` 状态、`acceptance.md` 证据登记、结算材料均未产出，本次 Review 只能判定「实现是否成立」，无法判定「结算是否完成」。

---

## 6. 方法与边界声明

- 本报告只依据仓库文件、`785bdd6` 上的 git 对象/差异与实跑命令；未读取任何开发对话、未引用外部同名技能或历史方案；未修改产品代码、测试、`docs/**` 或 WP-02 的 plan/implementation/discovery。
- 写入仅限本文件 `.agentdev/work/WP-02/review.md` 与检查临时目录 `/tmp/wp02-review/`。
- 额外实验使用 `pnpm build` 产生的 `packages/*/dist` 产物，等价复现 `join.test.ts`/`orchestrator.test.ts` 的夹具；脚本保留在 `/tmp/wp02-review/{join-policy.mjs,stage-terminal.mjs}` 以便复核。
