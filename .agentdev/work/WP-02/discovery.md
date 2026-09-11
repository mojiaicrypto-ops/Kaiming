# WP-02 Discovery

按 `docs/rules/workflow.md` 记录本包实现中发现的事实、偏离与遗留缺口。编号延续 WP-01（DC-26）。

## DC-27 快照引用是内容哈希，不是实体 id

- 事实：`data.md` §2 的 `snapshot` 主键为 `(type, hash)`，没有 `id` 列；`blobPath=<dataDir>/snapshots/<type>/<hash>.json`。
- 偏离：WP-01 的 `runSchema` 把 `configSnapshotId`/`contextSnapshotId`/`dispatchSnapshotId` 声明为 `idRefSchema`（UUIDv7），`dispatchSnapshotSchema.contextSnapshotId` 同样是 id。若按 id 建 Run，存储层会拒绝或产生永不匹配的引用；AC-044「活动 Run 配置可查」也无法实现。
- 处理（本包内修复）：`contracts/src/entities/run.ts` 新增 `snapshotRefSchema = hashSchema`，三个字段改为哈希；`structures.ts` 的 `dispatchSnapshotSchema.contextSnapshotId` 改为 `hashSchema`；`contracts/test/entities.test.ts` 的 Run 夹具改用 64 位十六进制哈希。
- 影响：storage schema 无 FK，不需要迁移；`src/entities.test.ts` 之外无其他夹具使用 UUID 快照 id。

## DC-28 快照行必须用显式 SQL 读写

- 事实：`snapshot` 表没有 `id`/`version`/`updated_at` 列（只有 `type/hash/payload/blob_path/created_at`），而通用 `EntityRepository.insert` 会注入基础列并校验 `snapshotSchema`。
- 偏离：WP-01 的 `EventHub` 因此改用显式 SQL 读取快照；若 `SnapshotWriter` 走仓储则插入失败（`Unrecognized keys: "version", "updatedAt"`）。
- 处理：`packages/core/src/snapshots.ts` 用显式 SQL 写入/读取/按类型列出，并用 `snapshotSchema` 校验读出的行；哈希为 `sha256(canonicalJson(payload))`，同 type 下同 payload 幂等（`created=false`）。

## DC-29 配置文档格式细节

- `providerId` 是服务端创建的 UUIDv7（`providerInputSchema.providerId?: idSchema`），因此 `config.toml` 中 `[[providers]]` 的 id 必须是 UUIDv7；未提供时由 `ConfigStore.upsertProvider` 生成（不使用 `type` 代替，避免写出非法文档）。
- `configPatchSchema.roleOverrides` 原先用 `z.record(roleSchema, …)`，类型上要求 8 个角色齐全；`data.md` §3 与 `protocol.md` §5 均为补丁语义（只覆盖被点名的角色），故改为 `partialRecord(roleSchema, …)`，与 `configDocumentSchema.roleProfiles` 一致。
- 同一 scope 内的重复 patch 按字段合并（`{...旧, ...新}`），否则只写 `reasoning` 的补丁会清掉同角色其余字段，违背「继承」语义。
- `config.toml` 不支持 `[[array of tables]]` 以外的写法由本包自研 TOML 子集决定：支持表头、数组表、点号键、基本字符串（含 `\n \t \r \" \\` 转义）、整数/浮点/布尔、标量内联数组；显式拒绝多行字符串、嵌套数组、日期等未支持值，报 `CONFIG_INVALID` 而非静默忽略。

## DC-30 ContextSelection 契约缺 provider/model 字段

- 事实：`docs/rules/agents.md` §5 的委派契约含 `contextSelection`，`docs/architecture/context.md` 规定「Chief 决定 ContextSelection」；WP-01 的 `contextSelectionSchema` 只有 `includePaths/excludePaths/budgetTokens/recentMessages/summaryRefs`。
- 处理：本包按现有 Schema 实现（`contextSelectionSchema` 不含 provider/model），ContextSelection 的模型维度由 Run 的 `configSnapshotId` 承担；若后续 WP-06 需要「上下文选择指定模型」，应显式扩展 Schema 并新增 Discovery。

## DC-31 尚无 Provider 真实调用与 Secret 存储

- 本包实现 `ModelGateway` 的解析、冻结、能力校验与失败语义，`GatewayTransport`/`SecretResolver` 为注入缝：测试用 stub；真实 HTTP、`provider.test` 的真实连通与 Secret 加密存储属于 WP-07（Secret）与 WP-10（Provider 纵切）。AC-043 的「独立模型」在本包以「每个角色独立 Provider/Model/Reasoning 且 Run 级冻结」验证。

## DC-32 purpose×role 矩阵由角色职责推导

- 事实：`agents.md` §3 要求「Core校验role与purpose、Stage、权限」，但文档未给出 purpose×role 表；§1 给出每个角色的职责与交付，§2 给出各阶段必需输入。
- 处理：`packages/domain/src/dispatch.ts` 新增 `PURPOSES_BY_ROLE` 与 `purposeAllowedForRole`/`validateRolePurpose`：角色可承载「产出其交付物」的 purpose，外加只读 `analysis`、按职责显式出现的 `operation`/`document_check`，以及无 Project 概览时的 `initialize`（§2 首行）。chief 一律不进入专业 spec。
- 影响：矩阵是可被产品方纠正的显式常量；若后续文档给出正式表，替换该常量并补 Review。

## DC-33 WP-02 提供最小 Attempt 起点

- 事实：`attempt` 行与 Run 的开始/终态迁移属 WP-05（RunnerSupervisor/监督）。但 T5 Join 与 T7 Stage 契约都需要「Run 已 running 且有 Attempt」的前置。
- 处理：`RunLifecycle.beginAttempt(runId, {runnerId?})` 按 `queued → starting → running` 建 Attempt 行并写 `run.started`；`RunLifecycle.settle/contractViolation` 只允许 `canTransitionRun` 允许的终态并写 `run.ended(outcome)`。心跳、租约、崩溃恢复、Attempt 证据不可改写仍属 WP-05，本包不做。
- 影响：WP-05 可在此之上实现监督；若 WP-05 改变建 Attempt 的入口，需同步本包测试。

## DC-34 profileRevision 采用「全局高位 + Project 低位」编码，过期即拒

- `DispatchSpec.profileRevision` 是单个非负整数，而配置有两个 scope；`layerRevision = global.version*1e6 + project.version`，任一 scope 变更都会改变该值（Project 写入不足百万次时无碰撞）。
- Orchestrator 在派发时比较 `spec.profileRevision` 与当前 revision，不一致直接 `VALIDATION_ERROR`（而不是静默按新配置运行），以保证「无隐式换模型」（AC-044）。Chief 通过 `currentProfileRevision(role)` 取值。

## DC-35 「Gate 阻断」以 Join 结果与 chief_action_required 表达

- 事实：文档要求 required 子 Run 失败时「Gate 阻断」，但当前 Schema 没有 Work 级 Gate 实体/enum。
- 处理：`JoinCoordinator.onChildSettled` 返回 `{kind:'blocked', failedRequired, children, chiefTodo}`，并写 `chief_action_required`（含全部子结果）。父 Run 状态的实际语义（第六轮 R6-08、第七轮 R7-06、第八轮 R8-05 实测更正）：**只有 `join=all` 子 Run 在场时**父进入/保持 `waiting_children`；全部子 Run 终态且无 required 失败时回到 `running`（`kind=ready`）；有 required 失败时保持当前状态（单个 required 子 Run 失败时父从未进入 `waiting_children`，仍是 `running`）并交付 blocked 结果。两种状态都在 `ACTIVE_PARENT_STATUSES` 内，因此新 Chief 消息都能受理（AC-046）。不改 Work.status，避免发明未定义的状态语义。
- 影响：后续若引入 Gate 状态（WP-06/流程 Gate），应消费该返回值并新增 Discovery。

## DC-36 stage.submit 的归属字段与内容校验

- 归属字段（`id/projectId/version/createdAt/updatedAt/runId/attemptId/taskId`）由客户端提交时抛 `NOT_AUTHORIZED`（伪造归属是协议失败，不走「修正一次」路径）；未知字段走可修正的 Schema 拒绝。
- 行 Schema 含服务端列，直接校验客户端载荷会因缺列全部失败，故 `contracts` 新增 `stageResultContentSchema = stageResultRowSchema.omit(服务端列)`，Core 用它校验后再由仓储注入归属列。
- 修正计数由事件日志推导（`stage.failed(outcome='schema_invalid')` 按 attemptId 全量分页计数，见 DC-44），因此重启后仍然成立；第二次失败经 `RunLifecycle.contractViolation` 写 `run.ended(outcome='contract_violation')`，要求 `canTransitionRun` 允许，否则 fail-closed 报错而不是降级。

## DC-37 独立 Review 第一轮的偏离与修复（RE-01..RE-13）

WP-02 第一轮独立 Review（`.agentdev/work/WP-02/review.md`）判 FAIL：1×P1、5×P2、7×P3。以下是逐条处理与留下的显式偏离。

- RE-01（R-01，P1）`stage.submit` 无终态/epoch 守卫：已修。`StageGate.submit` 现在要求 Run 非终态（终态抛 `INVALID_STATE`）、`epoch === attempt.ownerEpoch`（不符抛 `STALE_ARTIFACT`）、Attempt 为该 Run 现行（number 最大）且状态为 starting/running、可选 `expectedVersion` 不符抛 `VERSION_CONFLICT`；首次拒绝的 `correctionsRemaining` 由 0 改为 1（原值语义错误）。`join.test.ts` 新增终态/epoch/越权三类断言，并证明终态 Run 不再产生 `stage_result` 行。
- RE-02（R-02，P2）必需失败测试③「父等待可接消息」空洞：已修。`join.test.ts` 现在在父 `waiting_children` 期间通过 mailbox 真实分派第三个子 Run（若实现把等待当锁则该分派会失败），并在分派后再查 join 状态确认父仍在等待且新增的子进入 pending。
- RE-03（R-03，P2）`joinPolicy=none` 未消费：已修。`JoinCoordinator` 只把 `join==='all'` 的子计入挂起与 Gate 阻断集合；`none` 子失败不阻断但写 `chief_action_required(reason='fire_and_forget_child_failed')`。`ChildOutcome` 增加 `join` 字段，`chief_action_required` 的 data 现在携带每个子 Run 的 `summary/artifactRefs/unknowns/requestedActions`，使「父获全部结果」在仅凭事件重建时也完整。
- RE-04（R-04，P2）持久事件名偏离 `protocol.md` §7：**第一轮修复记录曾不实声称 Join 事件已删除，第二轮 Review（N-03）实测证伪，现已真正删除**（见 DC-39）。改为 `run.started`、`run.ended`（data.outcome）、`stage.completed`/`stage.failed`（Schema 拒绝记为 `outcome='schema_invalid'`）。
- RE-05（R-05，P2）越界写入 Plan：已修。`plan.md` 升到 planVersion 2，明确写入 `snapshots.ts`、`contracts/src/entities/run.ts`、`contracts/test/entities.test.ts` 并给出授权来源。
- RE-06（R-06，P2）`run.ts` 快照引用改哈希与 `data.md` 冲突：**保留哈希实现，作为需产品方确认的显式偏离**。理由：`snapshot` 无 id 列、主键为 `(type,hash)`，按 `ID` 引用必然产生永不匹配的引用；改为内容哈希是唯一自洽解。`data.md` 属权威文档，本包不改写它，已在 `plan.md` 与结算材料中上报，等待确认（若产品方要求回退为 UUID，需为 `snapshot` 增列并提供迁移）。
- RE-07（R-07，P3）Work 预算预留未落库：已修。派发事务内按 Run 的 `budgetAllocation` 增加 Work 预算行的 `tokensReserved`（经 `work.budgetId`，不按 `work_id` 猜测），`settleRun` 释放；`used+reserved<=limit` 由 Schema 保证，超限在更新时失败。新增测试证明 100k 预算下第二次 60k 派发被拒、结算后归零。
- RE-08（R-08，P3）Run 参数层不可达：部分修复。`DispatchInput.runParams` 打通「已授权Run参数」层并在冻结快照中留下 `sources='run'` 证据；**但这些参数尚未与 Authorization 记录绑定**（授权来源与用户确认路径属 WP-04/WP-07），当前只有 Core 调用方可以提供，属显式缺口。
- RE-09（R-09，P3）`readFrozen` 返回非法 `ProviderConfig`：已修。新增 `FrozenProvider` 投影类型，冻结只写 Run 需要的 provider 事实（providerId/type/baseUrl/secretRef），`readFrozen` 返回该投影并保留 `sources` 溯源。
- RE-10（R-10，P3）快照幂等对 type 不敏感：已修。`SnapshotWriter.find(type,hash)` 以 `(type,hash)` 判幂等；同 hash 已存在于其他 type 时抛 `CONSTRAINT_VIOLATION`（`SNAPSHOT_TYPE_CONFLICT`），避免裸哈希引用歧义。
- RE-11（R-11，P3）`decideLevel` 声称复用却未调用：已修。`assess` 现在调用 `decideLevel` 做 L3 底线校验（lockdown risk/环境操作必须 L3），并把 `decidedLevel`/`decidedReason` 写入 `assessment.saved`；L1 vs L2 仍由 Chief 承担，因为评估载荷不含 L1 判定所需标准，测试覆盖「securityBoundary 风险 + L2 → 拒绝」。
- RE-12（R-12，P3）`request_dispatch` 入参偏离 `protocol.md` §6：已修。入参改为 `runId（capability 绑定）+ workId/reason/requestedRole/goal/sourceRefs`（其余可选）；`purpose` 缺省取 `PRIMARY_PURPOSE_BY_ROLE`（domain 新增），事件 data 记录 `requestReason`/`sourceRefs`。
- RE-13（R-13，P3）Discovery 遗漏：本条即为补齐，DC-37 覆盖上述全部偏离。

## DC-38 Run 参数层尚无授权来源（承接：WP-04/WP-07）

`DispatchInput.runParams` 打通了 `agents.md` §5 配置继承中「已授权Run参数」这一层，但本包没有 Authorization 实体可绑定：谁能把哪些参数授权给某个 Run，属用户确认/权限路径（WP-04 消息与授权、WP-07 权限与沙箱）。当前只有 Core 调用方（后续的 chief 处理路径）能提供 `runParams`，因此这是**显式缺口**而非已完成能力：在授权来源落地前，任何把 `runParams` 当作「用户已同意」的结论都不成立。

## DC-39 Join 状态没有协议事件（承接：WP-08 读模型）

`protocol.md` §7 的持久事件清单不含 Join 专用事件名，因此 `JoinCoordinator` **不发明**事件：父 Run 的 `waiting_children`/回到 `running` 只体现在 Run 行版本上，`chief_action_required` 负责需要 Chief 介入的失败路径。前端要看 Join 进度时，由 WP-08 读模型从 Run 行与 `run.ended` 派生，并在那时显式扩展协议（而不是由 Core 私自写未定义事件名）。第一轮修复记录声称「已删除」但代码中仍在发出（Review N-03），第二轮已真正删除。

## DC-40 父 Run 额度的口径：只统计在场子 Run（Review 第三轮 M-01）

第三轮 Review（M-01）实测：Chief Run 20k 顺序派发 3 个 10k 子 Run，前两个 `completed` 后第三个仍被 `BUDGET_EXCEEDED` 永久拒绝（提高 Work 预算也无效）。事实成立，原因在 `requireBudget` 把**全部**子 Run 的 `budgetAllocation`（含已终态）计入父额度。处理：只统计非终态（在场）子 Run 的额度——已终态子 Run 的预留已释放，继续占用父额度会与 Work 层口径矛盾。`agents.md`/`data.md` 未定义父 Run 级上限的细节，本条属于本包的实现约定：父 Run 的 `budgetAllocation` 约束的是**并发在场**子 Run 之和，不是历史累计。对抗性核验另指出「提高 Work 预算无法恢复」被夸大——新建 Chief Run 是文档化的恢复路径（`agents.md` §3），据此 M-01 由 P1 重评为 P2，但功能缺口仍按 P2 修复（已修）。

## DC-41 usage 记账：目前只有零值，真实用量归 WP-10（Review 第三轮 M-02）

`RunLifecycle.settle(runId, status, {tokensUsed, measured})` 现在把实测用量从预留转入 `tokensUsed`（`reliability.md` §3「扣除实际usage并释放剩余」），并在 `run.ended` 里记录 `usageMeasured`。但**当前没有任何生产调用方提供用量**：真实 usage 来自 Provider 响应，属 WP-10（真实调用与 ModelGateway 的响应解析）。因此本包结束时所有 Run 的结算都是 `tokensUsed=0, measured=false`——这是**显式缺口**，事件里已把「未测量」与「实测为零」区分开，不允许把零值当作用量为零的证据。

## DC-42 Work 级 blocked(provider) 未实现（承接：WP-05）

`agents.md` §5 要求「不存在可用模型时 Work 为 blocked(provider)，未准入 Run 保持 queued」。本包实现了「Run 不进入执行 + `PROVIDER_UNAVAILABLE`」这一半；Work 侧的 blocker 需要 WorkBlocker 实体/状态投影与 `work.control_changed` 事件，属 WP-05（Work 控制与监督）。`implementation.md` T2 的原表述「失败即 Work blocked(provider)」已更正，避免文档声称超出实现。

## DC-43 派生读取必须全量分页（Review 第三轮 D3/F1/F2）

`EventStore.readAfter` 是游标流，`limit` 取的是**最旧**的一页。原来 `StageGate.rejections()` 与 `JoinCoordinator.pageChief()` 都用 `readAfter(0,{limit:10_000})`，日志超过一万条后：同一次 Attempt 可以无限次提交不合规载荷（击穿 `protocol.md` §6 的二次升级与 AC-047），Chief 待办幂等也失效（重复待办）。处理：新增 `packages/core/src/events.ts` 的 `scanEvents`/`findEvent`，按页推进直到读完（`findEvent` 命中即停），两处改用它们；新增回归测试在 1200 条噪音事件之后仍要求第二次不合规升级为 `contract_violation`、重复 `onChildSettled` 只产生一条待办。

## DC-44 事件版本语义与 `request_dispatch` 幂等（Review 第三轮 D1/D2/M-05）

- D1：`requestDispatch` 写 `entityId=chiefRunId` 却用**请求者** Run 的 `entityVersion`，按 `(entityId, entityVersion)` 增量消费的一方会拿到 Chief 从未有过的版本（违背 `protocol.md` §7 事件定义）。已改为 Chief Run 的版本。
- D2：终态专业 Run 仍可 `request_dispatch` 持续给 Chief 塞待办。已改为要求请求者处于 `queued/starting/running/waiting_children`，否则 `INVALID_STATE`。
- M-05：`request_dispatch` 无幂等键。已支持 `operationId`：同一 `operationId` 重放返回既有待办游标而不新增事件（`reliability.md` §1）。
- 另：`implementation.md` T7 与 `discovery.md` 中残留的旧事件名（`stage.submitted`/`stage.rejected`/`run.contract_violation`）已按实际代码更正为 `stage.completed`/`stage.failed`/`run.ended`。

## DC-45 usage 核销路径（Review 第四轮 Q-03；承接：WP-10）

`reliability.md` §3：模型调用前预留、扣除实际 usage 并释放剩余；**未知 usage 保持预留并标 `costKnown=false`，不能按零收费释放额度**；结果最终可查 usage 再核销。修复后：`RunLifecycle.settle(..., {measured:false})`（默认）不释放预留，只把 Work 预算置 `costKnown=false` 并在 `run.ended` 记 `usageMeasured=false / releasedTokens=0`；拿到 Provider usage 的一方调用 `RunLifecycle.reconcile(runId, {tokensUsed, cost?})` 完成核销（释放整笔预留、计入 `tokensUsed`/`cost`、置 `costKnown=true`）。**调用方（Provider usage 读取）属 WP-10**；在此之前所有 Run 的预留都会保持为未知成本，这是显式缺口而非泄漏（有明确核销入口与测试覆盖）。

## DC-46 dispatch 不校验 Work 状态（Review 第四轮 D5/Q-10；承接：WP-05）

`Orchestrator.dispatch` 只校验 Work 存在与预算、父 Run 状态、role×purpose 等，**不校验 `work.status`**：第六轮实测 `blocked`/`paused`/`completed`/`cancelled`/`queued`/`running` 六种（`workStatusSchema` 的全部取值：queued/running/completed/blocked/paused/cancelling/cancelled/failed，其中 `cancelling`/`failed` 未逐一实测）Work 状态下都能建立 Chief Run。Work 状态机与 `work.control_changed`/blocker 投影属 WP-05（Work 控制与监督）；本包只登记该缺口，未实现。

## DC-47 父 Run 级额度语义（Review 第四轮 Q-06）

父 Run 的 `budgetAllocation` 约束「**在场**（非终态）子 Run 额度之和」这一口径在 `data.md`/`agents.md`/`reliability.md` 中均无明文，属本包实现约定（DC-40）。理由：Run 的 `budgetAllocation` 若不设并发上限，Chief Run 可以把整笔 Work 预算重复授予多个子 Run；而若按历史累计统计，长寿命 Chief Run 会在若干顺序子 Run 后被永久卡死（M-01 实测）。文档未定义，故登记为需产品方确认的实现约定，与 DC-40 一致。

## DC-48 统一的 `run.ended` 事件形状（Review 第四轮 Q-08/H-02、第六轮 R6-05/R6-06、第七轮 R7-04、第八轮 R8-06）

`run.ended` 由 `RunLifecycle.applyEnd` 统一发出，`protocol.md` §7 只要求「终态事件携带真实 outcome 与变更后实体摘要」，字段清单是实现约定（消费方一致性）。实测四种路径的 data 键：

| 路径 | data 字段 |
|---|---|
| 常规终态（`completed`/`failed`/`timed_out`/`interrupted`） | `outcome`、`workId`、`tokensUsed`、`chargedTokens`、`uncoveredTokens`、`usageMeasured`、`runCostKnown`、`releasedTokens`、`cost` |
| `contract_violation` | 同上 + `attemptId`、`rejections`、`reason` |
| 核销补发（`reconcile`） | 常规字段 + `reconciled:true`（`cost` 为 Provider 报告值或 `null`） |
| 级联取消的子 Run | 常规字段 + `cancelledWithParent`（父 Run id） |

字段层级（第六轮 R6-06）：
- `tokensUsed` = Provider 报告的原始用量；`chargedTokens` = Work 预算实际吸收的部分（= `min(tokensUsed, budgetAllocation)`）；`uncoveredTokens` = 超出预留未被吸收的部分；`releasedTokens` = 退还的预留余额；
- `usageMeasured` 与 `runCostKnown` 是**每个 Run** 的事实；Work 级 `costKnown`（`budget` 行）由全部终态 Run 重算，两者同名易混，故事件里不再叫 `costKnown`。

排序语义（第七轮 R7-04）：事件以其自身单调递增的 `cursor` 排序（`data.md` §2）；`entityVersion` 是发出事件时实体的版本，核销补发不会改动 Run 行，因此同一 Run 的两条 `run.ended` 会带相同 `entityVersion`，消费方不得用它排序。

## DC-49 父 Run 非正常终止时子 Run 一并取消（Review 第四/五轮 Q-04、M-1、M-3）

不变式：Run 进入终态后，不能留下无人 Join 的 `join=all` 子 Run。
- `completed`：仍有在场 `join=all` 子 Run 时拒绝终态（`INVALID_STATE`）——完成必须是收敛后的完成。
- `failed`/`cancelled`/`contract_violation`（非正常终态）：**向下传播取消**，子 Run 在同一事务内一并终态，避免子 Run 之后结算进无人拥有的 Join、或把 `chief_action_required` 写给已终态父 Run（AC-046 Gate 阻断无人处理）。
- `settleRun(..., 'cancelled')` 与 `RunLifecycle.cancel` 是同一路径：公开入口无法绕过子 Run 传播；`cancel` 先校验父 Run 迁移合法性，再在同一事务里取消子树（M-3：不会出现「父 Run 报错但子 Run 已被取消」的部分写入）。
- 由此 `contract_violation` 的二次不合规升级不再被在场子 Run 挡住（M-1：原来第二击会被 `INVALID_STATE` 回滚吞掉，必须等子 Run 结算后才升级）。

## DC-50 超预留 usage 的封顶与「未覆盖」记录（Review 第五轮 R5-03/Q-02）

Provider 报告的 usage 可能超过该 Run 的预留（估算偏差）。原实现在结算时先释放预留再计入 usage，一旦 `used + usage` 触碰 Schema 上限就会整笔回滚：Run 永久停在 `running`、无 `run.ended`、预留不放。修复：计费封顶到预留额（`chargedTokens = min(usage, budgetAllocation)`），超出部分记入事件的 `uncoveredTokens`，Run 正常终态；事件字段语义固定为 `tokensUsed`（Provider 原始值）/`chargedTokens`（Work 实际吸收）/`uncoveredTokens`/`releasedTokens`（退还的预留余额）。同时 usage 必须是非负整数，否则 `VALIDATION_ERROR`（M-4：原来负值被预算侧钳到 0、事件却写原始值，两边账不一致）。

## DC-51 request_dispatch 幂等：全载荷指纹 + 重放优先（Review 第五轮 R5-01、R5-09）

- R5-01：指纹覆盖请求的全部字段（requestedBy/workId/role/purpose/goal/stage/reason/sourceRefs/requiredOutputs/requiredChild/budgetAllocation/parentRunId），任一字段不同即 `IDEMPOTENCY_CONFLICT`（原来只比对 6 个字段，改 `reason/sourceRefs/requiredOutputs/budgetAllocation` 会被静默吞掉）。
- R5-09：同键重放的查库**先于**请求者/Chief Run 的状态校验——否则 Chief Run 已终态时重放会得到 `INVALID_STATE` 而不是原结果（`protocol.md` §1「应答丢失先查同幂等键结果」）。新请求仍需双方都可行动。

## DC-52 核销幂等与 Work 级 costKnown 重算（Review 第五轮 R5-04、第六轮 R6-01/R6-04/R6-05/R6-06）

`RunLifecycle.reconcile` 的幂等判定改为「该 Run 是否已有**实测**（结算时 `usageMeasured:true`）或**核销**（`reconciled:true`）的 `run.ended`」，且判定与写入在**同一个事务内**（第六轮 R6-01：只查 `reconciled:true` 会漏掉已按实测结算的 Run，二次核销会重复计费并把 `tokensReserved` 扣到 0、吃掉其他在场 Run 的预留，使真实承诺超出 `tokenLimit`）：
- 同 Run 同 amount 的重放 → 无操作返回；
- 同 Run 不同 amount → `IDEMPOTENCY_CONFLICT`（R6-04：原来静默无操作）；
- 核销事件不再发明 `reconciliation` 序号（第七轮 R7-04：一个 Run 至多核销一次，该字段恒为 1）；事件顺序与 `entityVersion` 重复的处理见 DC-48；
- 事件字段改名为 `runCostKnown`（每个 Run 的事实），Work 级 `costKnown` 仍按「该 Work 的全部终态 Run 是否都已实测/核销」重算（R6-06：原来事件里的 `costKnown` 与 Work 级标志同名但含义不同）。

## DC-53 第五轮 Finding 的严重度口径（记录更正）

第五轮报告把 4 条影响验收的行为缺陷标为 P2 并称「本轮无 P1」；按 `workflow.md` §6「发现与返工」中的严重性定义（第 65 行：P0 数据/安全或关键不可用，P1 错误行为/需求缺失，P2 局部质量/维护问题，P3 建议），这些条目属 P1 级。本包按其阻断性处理（全部已修），并在记录中更正口径，避免后续 Settlement 按「仅 P2」低估本包返工范围。另：第四轮报告中的 H-03 是**报告质量问题**（对 D1..D5 的追溯口径），不是代码缺陷定义，仓库内无对应实体；D1..D5 的来源更正见 DC-47/T12。

## DC-54 未带 operationId 的重复请求（Review 第六轮 R6-09）

`request_dispatch` 的 `operationId` 仍是可选（`protocol.md` §6 的参数表不含它）。为不让「无键」变成「重复待办」，缺省时由 Core 用请求指纹派生确定性键（`derived:<sha256>`），事件记录 `operationIdSource: 'client' | 'derived'`：同一 Run 的同一请求重复提交只产生一条待办，内容不同则是两条（指纹不同，键也不同）。若产品方要求「同内容也允许重复建待办」，需要显式提供 operationId 或新协议参数。

## DC-55 超预留 usage 不产生 Work 级预算阻断（Review 第六轮观察；承接：WP-05）

结算时超出预留的用量记为 `uncoveredTokens`（DC-50），但不会让 Work 进入 `blocked(budget)`，也没有 `budget` blocker 实体。`reliability.md` §3 只规定「repairUsed 达到限制后在下一次返工前 Blocked(budget)」；预算阻断的 Work 级投影属 WP-05（Work 控制与监督），本包只记录该缺口。

## DC-56 记录级严重度口径（Review 第六轮）

第六轮 Review 按 `workflow.md` §6 的严重性定义（该文件第 65 行）把 R6-01 定为 P1，同时指出第五轮报告把同类的行为缺陷标为 P2 属口径不一致。本包的处理原则：**凡影响 AC-043/044/045/046/047/082 或 `reliability.md` §3、`protocol.md` §1/§6 明文要求的条目，一律按阻断项对待并修复**（本节引用的严重性定义在 `workflow.md` §6 内、位于该文件第 65 行），记录中不再以 P2/P3 低估。R6-07 指出的「M-2 无定义」也已补齐：M-2 是第五轮对抗性核验提出的「`run-lifecycle.ts`/`stage.ts` 注释声称预留已释放、与实现（未测量时保持预留）不符」，已在 T13 修正（DC-53 口径更正同时适用）。

## DC-57 级联取消时「从未启动」子 Run 的用量是已知零（Review 第七轮 R7-09）

`cancelDescendants` 原来对所有子 Run 一律按「未测量」处理（保持预留 + `costKnown=false`），但**没有 Attempt 的 `queued` 子 Run 从未调用模型**，其用量是已知的零，不是未知。修复：把判据抽成 `RunLifecycle.initialUsage(run)` 一处，被取消的 Run 自身与级联子 Run 共用——无 Attempt ⇒ `measured:true, tokensUsed:0`（立即释放预留）；有 Attempt ⇒ 保持 `measured:false`（等 WP-10 的 Provider 用量核销，DC-45）。第八轮 R8-03 指出第七轮只对子 Run 生效：直接取消一个未启动的 Chief Run 同样会留下死预留，使零消费的取消永久占用 Work 额度（后续同额派发被 `BUDGET_EXCEEDED` 拒绝）。

## DC-58 被拒绝的 dispatch 不留任何副作用（Review 第七轮 R7-07）

`Orchestrator.dispatch` 原来的顺序是「校验 → 冻结 config/context/dispatch 快照 → 建 Run」。第七轮探针发现被拒请求仍会留下 dispatch/context 快照行（内容寻址，同载荷幂等，不同载荷逐次增长）。修复：把三类快照的冻结移到**全部准入判定之后**（spec 校验、Work/预算、父 Run、role×purpose、direct-chief-child、provider 可用性、profileRevision）。契约 Schema 校验提到最前，任何畸形 spec 以 `VALIDATION_ERROR` 结束，不再抛裸 `TypeError`（R7-01）。测试断言被拒后 Run 与快照行数均不变。

## DC-59 协议入口的契约校验前移（Review 第八轮 R8-01/R8-02/R8-04/R8-09）

第八轮实测：`dispatch` 已 fail-closed，但另外两个协议入口仍会以非协议形态失败。
- `request_dispatch`（AC-045 点名）：`sourceRefs`/`requiredOutputs` 畸形抛裸 `TypeError`；非字符串 `goal`/`stage`、负 `budgetAllocation`、非字符串 `operationId` 被原样写进 `chief_action_required`。新增 `dispatchRequestSchema`（`contracts`，覆盖 `protocol.md` §6 的 `workId,reason,requestedRole,goal,sourceRefs` 与现有可选扩展字段），入口首行校验。
- `assessment.submit`：`payload=null`/`riskFlags` 非数组/`uncertainties=null` 抛裸 `TypeError`，非法 `level`/`intent` 抛存储层 `StorageError/CONSTRAINT_VIOLATION`（不在 `protocol.md` §7 错误表内）。新增 `assessRequestSchema`，入口首行校验。
- `dispatch` 的冻结输入（四个：`authorizationRef`、`requiredOutputSchemas`、`contextPayload`、`runParams`）：畸形值原先在快照冻结之后才被拒绝，留下不可读的 `config`/`context`/`dispatch` 快照行。新增 `dispatchExtrasSchema` 在任何 `freeze` 之前校验（第十轮 R10-05：`runParams` 按 `profileSchema.partial()` 校验内部字段，非法字段不再误报 `PROVIDER_UNAVAILABLE`）；`SnapshotWriter.freeze` 也加了 payload 必须是 JSON 对象的兜底（`CONSTRAINT_VIOLATION` / `SNAPSHOT_PAYLOAD_INVALID`）。
- 影响：`protocol.md` §1 要求「必填参数缺失、未知字段或枚举错误返回 `VALIDATION_ERROR`」，§7 的错误表是封闭集合；三个入口现在都只在该集合内失败，且失败不留任何持久副作用。

## DC-60 Assessment 的 `goal`/`scope` 未落库（Review 第九轮 R9-04/漏项 C；Product Decision Pending）

`data.md` §3 的 Assessment 结构含 `goal`/`scope`，`assessRequestSchema` 也校验它们，但 `assessment` 表没有对应列（`data.md` §2 的行定义里只有 `intent/level/semanticImpact/riskFlags/uncertainties/authorizationRef/policyRevision/reason`），因此 Core 校验后静默丢弃。两种文档口径不一致：行定义不含，结构定义含。属产品决定，当前实现是第三种状态——**`goal`/`scope` 既不落行也不落事件**（第十轮 R10-06 更正：原文误称「只进 `assessment.saved` 事件」）。候选方案：
- 方案 A：按 §2 行定义，把 `goal`/`scope` 加入 `assessment.saved` 事件（未实施），文档明确它们不是行字段；
- 方案 B：追加迁移 0002 增加列，`data.md` §2 同步更新（迁移 0001 已冻结，只能追加）。
`scope` 目前只用于 DC-62 的路由判定，不持久化。等待产品方确认方案后再改代码。

## DC-61 协议参数名与 Core 方法入参的映射（Review 第九轮 漏项 D/R9-02）

`protocol.md` §6 的 `assessment.submit` 参数写作 `assessment:Assessment`，`agent.request_dispatch` 写作 `workId,reason,requestedRole,goal,sourceRefs`（无 `?`）。Core 内部 API 使用 `payload`，且 `workId/reason/sourceRefs` 在内部可选（Run 已绑定 Work 与父 Run，reason/sourceRefs 允许省略）。处理：`assessRequestSchema` 用协议名 `assessment`，在 `assess` 入口做一次显式映射；`requestDispatch` 保持内部可选性，但 `goal`/`requestedRole` 必填、`operationId` 去空白且限 1–128 字符、`stage` 去空白且限 64 字符、`DispatchRequestInput.sourceRefs[].version` 改为必填以与 `sourceRefSchema` 一致（第十轮 R10-04：原接口标 `?` 而运行期拒绝，TS 调用方会在运行期才失败）。`stage` 目前仍是自由字符串（取值集合由 WP-04 定义），本包只做长度兜底。协议层（WP-04）接线时应按 §6 的必填性做参数校验并在缺失时报 `VALIDATION_ERROR`，本包登记该差异。

## DC-62 L3 路由底线只依赖载荷本身（Review 第九轮 R9-01、对抗性漏项 A）

原实现 `operationTouchesEnvironment` 取 `payload.intent === 'operation' && work.level === 'L3'`——循环依赖（`assess` 从不写 `work.level`），另加一个未文档化的魔法串。修复：
- 运行环境判定使用载荷自身证据（`packages/domain/src/routing.ts` 的 `touchesRunningEnvironment(scope)`；集合 `ENVIRONMENT_OPERATIONS` **定义在 `domain/routing.ts`**，core 只调用）：`scope.networkTargets` 非空，或 `scope.operations` 命中环境副作用集合 `ENVIRONMENT_OPERATIONS`（`['bash','network','secret','push','deploy','delete_data']`，按 `operationNameSchema` 逐个分类，`git`/`edit`/`write`/`artifact_write` 属工作区本地操作故不入选——远端写入由 `push` 表达）⇒ L3（`workflow.md` §2.2）。只读调查（`read`/`search`）不在此列，仍走 L2（第十轮 R10-07）。**判定顺序**（第十一轮 R11-01）：环境操作与 lockdown 风险两个硬门禁在 `assist`/`artifact` 的 `none` 短路**之前**执行，因此任何 intent 取值都无法用标签打开 L3 门禁（`decideLevel` 的 `delivery`/`document` 分支只保留 L1 准入判定）。第十轮的「与 intent 标签无关」表述在第十轮时并不成立（当时 `assist`/`artifact` 仍提前返回 `none`），本轮才真正成立；
- 风险旗标识别 `workflow.md` §2.3 的**文档用词**（含 `/` 合并措辞「数据删除/迁移」「支付金额/状态」「部署/发布」）与 camelCase 旗标（大小写与空白/`_`/`-`/`/` 无关，`数据删除迁移` 与 `数据删除/迁移` 等价），词表在 `packages/domain/src/routing.ts` 的 `LOCKDOWN_RISK_TERMS`；
- **未登记旗标 fail-closed**（第十轮 R10-01）：`unknownRiskFlags` 非空 ⇒ `VALIDATION_ERROR` 并在 details 中返回可接受词表，不再把未登记拼写静默读成「无风险」；`isKnownLockdownRiskTerm` 由此有了真实调用方；
delivery/document 若未声明可核查的 L1 前提（`semanticImpact=false`、无 operation、无 networkTargets）⇒ 不低于 L2；assist/artifact ⇒ none。L1 的文件数/行数准入仍属 Plan/Review 门禁（DC-19、WP-04），Core 不从载荷推断。
- 接受的评估在 `assessment.saved` 里同时记录 `decidedLevel`、`floor` 与 `decidedReason`（第十轮 R10-03：原来只记 `decidedLevel`，与「L1 被接受」的记录互相矛盾）。
- 词表当前是实现级的（`routing.ts` + 本记录），是否提为 `data.md`/contracts 的正式枚举属产品决定（第十轮 R10-01 的选项 a）；在确认前，未登记旗标一律拒绝而不是放行。

## DC-63 授权核对：存在性、同一 Work、未撤销、范围覆盖（Review 第九/十/十二/十三轮）

`workflow.md` §1「Core 检查角色、字段、授权、权限和版本」、`data.md` §2「Core 核对来源与权限」、`data.md` §3（`effectiveScope` 必须在授权范围内）。`Orchestrator.verifyAuthorization(ref, workId, level, scope?)` 统一核对，返回实际核对的引用（供 DispatchSnapshot 冻结）：
- `ref` 缺省：`requiresExplicitAuthorization(level)` ⇒ `NOT_AUTHORIZED`；否则无授权需求（`assess` 传入等级，`dispatch` 传入由 Work 等级与 spec scope 推出的 `runLevel`）；
- `ref` 指向不存在的行 ⇒ `NOT_AUTHORIZED`；属于其他 Work ⇒ `NOT_AUTHORIZED`；已 `revokedAt` ⇒ `NOT_AUTHORIZED`；
- 只要提供了 `ref`（即便该等级不要求）都会核对，伪造 id 不能落库；
- 提供 `scope` 时逐项核对覆盖：`operations` ⊆ 授权 `operations`；`networkTargets` ⊆ 授权 `scope.networkTargets` **且授权必须带 `network` 操作**（只把目标列进 scope 不等于网络写授权，第十四轮 D-2）；`writePaths`/`readPaths` 必须位于授权 `scope.writePaths`/`readPaths` 之内（路径前缀包含）。未被覆盖 ⇒ `NOT_AUTHORIZED`，details 列出各未覆盖项。
- 能力交叉核对（第十五轮 R15-01，限定在**授权侧**）：spec 声明 `writePaths` 时授权必须含至少一个工作区写操作（`WORKSPACE_WRITE_OPERATIONS`），声明 `readPaths` 时授权必须含读操作（`read`/`search`），声明 `networkTargets` 时授权必须含 `network`。否则即使路径在授权 scope 之内也判 `NOT_AUTHORIZED`（details 的 `capabilityGaps`/`networkTargetsWithoutGrant`）。原因：只读授权（或空操作授权）不得为写范围背书并把它冻结进 `effectiveScope`。
- `artifact_write` 不参与能力交叉核对（第十六轮 R16-01 后它不在 `WORKSPACE_WRITE_OPERATIONS` 内）：一张只含 `artifact_write` 的授权不能为 `writePaths` 背书（R17-03）。
- 边界（第十六轮 R16-02）：该核对只约束**授权**，不约束 spec 自己的 `operations` 列表——`spec.scope.operations` 是工具层的允许清单，Core 不因「声明了路径」就替 Chief 推断操作意图；因此 `writePaths` + `operations: []` 的 spec 在授权具备写能力时被接受，冻结出的 `effectiveScope` 就是 Chief 声明的样子（写入是否执行由 Runner 的工具门禁按 `operations` 判定，WP-04/WP-06 落线）。这是有意的最小惊讶边界，登记于此而非静默。
- 授权的能力清单取自 `Authorization.operations`（契约枚举 `operationNameSchema`，第十五轮 R15-02），路径/网络目标信封取自 `Authorization.scope`；两者是不同维度，本包不做「`scope.operations` 与 `operations` 求交」的额外规则（授权 schema 的 `operations` 是授权操作清单）。
- 路径维度是对既有行为的收紧（第十四轮 D-3）：L3 Work 拿一张 `scope.readPaths` 为空的授权后，声明 `readPaths` 的 Run 也会被拒；这一收紧是有意的 fail-closed，登记于此。
- `dispatch` 用 `extras.authorizationRef ?? work.authorizationRef`，因此 L3 Work 始终有可核对的授权来源（第十一轮 R11-03），并把核对通过的引用冻结进 DispatchSnapshot（第十二轮 R12-03）。
- 仍属后续工作（承接 WP-04/WP-05）：授权的 `acceptedAt`/来源消息核对、`once` 类授权的消费记账、`work.level` 的写入（`assess` 目前不回写 Work 行，`works.update` 全仓无调用点）。


## DC-64 风险旗标词表的归属与未登记值处理（Review 第十轮 R10-01；Product Decision Pending）

`workflow.md` §2.3 用中文散文列出 L3 风险，`assessmentPayloadSchema.riskFlags` 是自由字符串。第十轮前实现只认一张等价拼写表，未登记值被静默忽略——文档化安全门禁 fail-open。当前处理：词表在 `packages/domain/src/routing.ts`（`LOCKDOWN_RISK_TERMS`），未登记值由 Core 以 `VALIDATION_ERROR` 拒绝并返回可接受词表。待产品决定：是否把该词表提升为 `data.md`/contracts 的正式枚举（则 Chief 与协议的取值集合被固定），以及是否允许 Chief 使用词表外的自定义旗标（当前不允许）。

## DC-65 路由底线与硬门禁的顺序（Review 第十一轮 R11-01/R11-02）

- 硬门禁优先：`decideLevel` 先判环境操作与 lockdown 风险，再判 `assist`/`artifact` ⇒ `none`。此前 `assist`/`artifact` 的提前返回使这两条 L3 门禁对两个 intent 取值 fail-open（声明 `deploy`/`bash`/`networkTargets` 或文档化风险旗标仍可落 `none`/L1/L2），本轮修复并补 `assist`/`artifact` × 环境操作 × 风险旗标的失败测试。lockdown 风险门禁对全部 intent 生效（`workflow.md` §2.3 字面只写 delivery/document，本包按 fail-closed 推广到所有 intent，属保守偏离，登记于此）。
- 底线（`routingFloor`）：`decideLevel` 判 L3 ⇒ L3；`assist`/`artifact` ⇒ none；`operation` ⇒ 至少 L2（`workflow.md` §2.4 的 L1 只允许样式/文案/注释类改动，操作类工作不满足）；`delivery`/`document` 未声明可核查的 L1 前提 ⇒ 至少 L2，否则允许 L1。因此 `operation` 不能落 L1/none（第十一轮 R11-02）。

## DC-66 Run 建立边界的独立授权/等级底线（Review 第十二轮 R12-01..R12-03、第十三轮 R13-01/R13-02、第十四轮 R14-01）

Run 建立的 Core 唯一入口（`Orchestrator.dispatch`）按下列顺序判定，`assess` 不是 Run 边界（它只记录路由；`work.level` 的回写属 WP-04/WP-05）：
1. **修改授权**：`!grantsModificationAuthority(work.level) && declaresWorkspaceWrite(spec.scope)` ⇒ `NOT_AUTHORIZED`。判据用 **Work 自己的等级**（spec 不能靠声明环境操作把派生等级升到 L3 来取得写权限，R13-02），"是否修改"由 `writePaths` 非空**或**命中 `WORKSPACE_WRITE_OPERATIONS = ['edit','write','git']` 判定（R13-01/R14-01 补入 `git`；第十六轮 R16-01 把 `artifact_write` 移到 `ARTIFACT_WRITE_OPERATIONS`，见 DC-71——它只写自己的 Artifact，`push` 属环境操作集合）。
2. **等级底线**：`runLevel = touchesRunningEnvironment(spec.scope) ? 'L3' : work.level`；环境操作/网络目标⇒ L3，与 Work 等级和 intent 标签都无关（DC-62）。
3. **授权核对**：`verifyAuthorization(extras.authorizationRef ?? work.authorizationRef, work.id, runLevel, spec.scope)`，四类覆盖面（`operations`、`networkTargets` 且必须有 `network` 操作、`writePaths`、`readPaths`）见 DC-63；核对通过的引用冻结进 DispatchSnapshot（AC-082 可重建来源）。
4. 仍属后续工作（承接 WP-04/WP-05/WP-07）：授权的 `acceptedAt`/来源消息核对、`once` 类授权的消费记账、`work.level` 的回写（`assess` 目前不回写 Work 行，`works.update` 全仓无调用点，因此 Work 等级在评估后可能过期）、`writePaths` 之外的文件级授权粒度。
## DC-67 本地写操作也属修改授权（Review 第十三轮 R13-01/R13-02）

`dispatch` 的写权限门禁原先只看 `spec.scope.writePaths`，于是两处 fail-open：`none` 级 Work 用 `operations:['edit']`（空 `writePaths`）即可建 Run；`none` 级 Work 声明一个被授权的环境操作（如 `deploy`）后，派生的 `runLevel='L3'` 会覆盖 Work 等级，从而也能带 `writePaths`。修复：
- 门禁改用 **Work 自己的等级**（`grantsModificationAuthority(work.level)`），spec 不能靠声明环境操作升级修改权；
- 「是否修改」由 `declaresWorkspaceWrite(scope)` 判定：`writePaths` 非空 **或** 命中工作区写操作集合 `WORKSPACE_WRITE_OPERATIONS = ['edit','write','git']`（定义在 `domain/routing.ts`；`git` 于第十四轮 R14-01 补入，`artifact_write` 于第十六轮 R16-01 移出，`push` 属环境操作集合）。
`data.md` §2「none不产生修改授权」由此在 Run 建立边界真正生效。

## DC-68 授权范围覆盖的路径维度（Review 第十三轮 R13-01）

原先范围覆盖只查 `operations`/`networkTargets`，只读授权（`scope.writePaths: []`）可以为声明 `writePaths:['packages/core/src']` 的 Run 背书并把该路径冻结为「生效范围」。修复：`verifyAuthorization` 增加路径覆盖（`writePaths`/`readPaths` 必须位于授权 scope 之内，按路径前缀包含判定，`isInsideScope`）；`assess` 也把自己的 `scope` 传入核对（此前只核对引用存在性）。

## DC-69 `undefined` 可选字段的清理（Review 第十三轮 R13-03）

zod 的解析结果会保留调用方显式传入的 `undefined` 可选字段（如 `taskId: undefined`），这种键在冻结快照时被 `jsonObjectSchema` 拒绝，产生 `StorageError/CONSTRAINT_VIOLATION` 且留下 `config`/`context` 快照（违反 `protocol.md` §1 的封闭错误表与 DC-58 的零副作用）。修复：`dispatch` 在解析后用 `jsonClean` 递归删除 `undefined` 值属性（`professionalSpec` 同样处理），使「可选字段=undefined」等价于「缺省」。

## DC-70 `config.policy.l3Paths`/`l3Keywords` 无消费方（Review 第十三轮 R13-06；承接：WP-04/WP-05）

全局配置 schema 有 `policy.l3Paths`/`l3Keywords`（`ARCHITECTURE.md` §5 的可覆盖限制项），但全仓无读取点，`workflow.md` 也未定义「L3 路径/关键词」的判定语义；当前 L3 判定只依据 `workflow.md` §2.2/§2.3 的明文判据（DC-62/DC-65）。按用户策略扩展 L3 判定（例如把 `l3Paths` 命中视为 L3）属 WP-04/WP-05 的策略落线工作，本包只登记缺口，未实现。

## DC-71 `artifact_write` 不是工作区修改权（Review 第十六轮 R16-01/M-1..M-4）

`execution.md` §21/§53：`artifact_write` 是所有角色的基础工具（Chief/只读调查「写：自己的 Artifact」），修改角色才「另有 edit/write/bash/git」。因此 `artifact_write` 移出 `WORKSPACE_WRITE_OPERATIONS`（现为 `['edit','write','git']`），单独归入 `ARTIFACT_WRITE_OPERATIONS`：`none` 级 Work（assist/artifact 路线）可以派发只写自己 Artifact 的 Run，但**不能**写跟踪文件（`writePaths` 仍受门禁）也不能取得环境权限。派生不变式（第十六轮 M-1/M-2）：
- `dispatch`：`!grantsModificationAuthority(work.level) && (declaresWorkspaceWrite(spec.scope) || touchesRunningEnvironment(spec.scope))` ⇒ `NOT_AUTHORIZED`（授权不能把 `none` Work 变成 L3 执行者）；
- `assess`：同一条件 ⇒ `VALIDATION_ERROR`（评估与 Run 边界对同一 scope 的结论必须一致）；
- 操作分类完备性由 `packages/domain/test/domain.test.ts` 的用例守卫：12 个契约取值分别是环境操作（6）、工作区写（3）、Artifact 写（1）、只读（2）。

## DC-72 `none` 级 Work 的等级只能由 Work 控制面变更（Review 第十七轮 R17-01）

`assess` 现在对「`none` 级 Work + 声明写/环境 scope」报 `VALIDATION_ERROR`（与 `dispatch` 一致，DC-71）。副作用：由于 `assess` 从不回写 `work.level`（`works.update` 全仓无生产调用点），一个已经落成 `none` 的 Work **无法**通过后续 Assessment 升级到 L2/L3——升级必须走 Work 控制面（重路由或新建 Work，属 WP-05）。这是有意的 fail-closed 边界（错误地放行写范围比要求重新建 Work 更危险），登记于此；WP-05 落线 Work 等级回写时应一并考虑「重新评估→升级等级」的合法路径。

## DC-73 Provider 无 Secret 的合法端点与凭证可用性（Test T-01、Review R18-01/R18-02/R18-05）

- 冻结投影的单一定义：`frozenProviderOf(provider)` 是 `FrozenProvider` 的唯一来源（`resolve` 与 `freeze` 共用），`secretRef` 缺省时**省略键**而不是写 `null`；`readFrozen` 把历史/外来快照里的 `null` 归一为「无 Secret」，`complete()` 也按 `?? undefined` 归一（Test T-01：写 `null` 而读取端只认 `undefined`，会使无鉴权端点每次都 `CONFIG_INVALID`）。
- 可用性包含凭证：`ModelGateway.availability` 在注入了 `SecretResolver` 时解析 `secretRef`，取不到即视为不可用（`agents.md` §5：不存在可用模型时不排队）。未注入 resolver 时 Secret 存储未知（WP-07/DC-31），保持放行。
- 冻结的 `model` 投影保留 `inputPricePerMTokens`/`outputPricePerMTokens`（可选字段，存在才写），使 `resolve()` 与 `readFrozen()` 形状一致，并为成本核算保留依据。
- 承接：真实 Secret 存储与解析（`SecretResolver` 的实现、`once` 授权消费）属 WP-07；`readFrozen` 对任意畸形载荷的完整 Schema 校验在 WP-08/WP-09 的读取面统一处理（当前已归一 `secretRef` 并保证不因此崩溃）。
