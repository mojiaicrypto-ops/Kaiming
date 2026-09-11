# WP-02 实现记录

对应 `.agentdev/work/WP-02/plan.md`（planVersion 1）。按任务追加，证据只写已运行的命令与结果。

## T1 配置与继承（AC-043, AC-044）—— 完成

- `packages/core/src/toml.ts`：`~/.agentdev/config.toml` 所需的最小 TOML 子集读写（表头、`[[数组表]]`、点号键、基本字符串与 `\n \t \r \" \\` 转义、整数/浮点/布尔、标量内联数组）；超出子集的语法抛 `TomlError(message, line)`，不做静默兜底。
- `packages/core/src/snapshots.ts`：`SnapshotWriter.freeze(type, payload)` 以 `sha256(canonicalJson(payload))` 为哈希写入 `snapshot` 行（同 type 同 payload 幂等），`read(hash)`、`byType(type)` 读回并用 `snapshotSchema` 校验；见 DC-28。
- `packages/core/src/config.ts`：`ConfigStore.open({globalDir, projectRoot, snapshots})`；全局与 Project 两个 scope 的文档读写（版本号 +1、原子写入、0600 权限）、`update(scope, patch)`（Schema 校验、同 scope 字段级合并）、`upsertProvider`、`provider`、`effectiveLimits`（固定常量不可覆盖）、`resolve(role, runParams)`（Run→Project→全局角色→全局默认，逐字段记录来源）、`freeze(role, runParams)`、`readFrozen(snapshotId)`。
- 能力校验：provider 存在且 enabled、model 属于该 provider、`reasoning ∈ model.reasoningLevels`、`effectiveContextLimit = min(profile.contextLimit, model.contextWindow − maxOutputTokens − 4096) ≥ 4096`；任一不满足返回 `{ok:false, code}`（`PROVIDER_UNAVAILABLE`/`CONFIG_INVALID`），不降级、不换模型。
- `packages/contracts/src/entities/run.ts`：新增 `snapshotRefSchema = hashSchema` 用于 Run 的三个快照引用；`structures.ts` 新增 `providerConfigSchema`、`policyConfigSchema`、`configDocumentSchema`，`configPatchSchema.roleOverrides` 改为 `partialRecord`。见 DC-27、DC-29。
- 测试 `packages/core/test/config.test.ts`（8 条）：TOML 往返与拒绝非法语法、四层继承与逐字段来源、Run 参数覆盖、能力校验失败（缺模型/不支持的 reasoning/未知 provider/禁用 provider）、冻结快照不被后续配置改动影响且存储禁止 UPDATE、patch 边界与固定常量、非法文件拒绝启动、重开进程版本与内容保持。

## T2 模型网关（AC-043, AC-044）—— 完成

- `packages/core/src/model-gateway.ts`：`availability(role, runParams)`（准入判定；不可用时抛 `PROVIDER_UNAVAILABLE` 并保持 Run `queued`。`agents.md` §5 要求此时 Work 为 `blocked(provider)`，但 Work blocker 实体/状态投影属 WP-05，本包**未实现 Work 级 blocked**，见 DC-42）、`frozenProfileOf(run)`（读 Run 的 `config` 快照，缺失抛 `STALE_ARTIFACT`）、`complete(run, messages)`（模型/reasoning/上下文上限只来自冻结快照，签名上不提供任何选择模型的入口）、`testConnection(providerId, modelId)`（最小请求 + 延迟）、`tokensOf`。
- `GatewayTransport`、`SecretResolver` 为注入缝；真实 Provider 调用与 Secret 存储属于 WP-07/WP-10（DC-31）。
- 测试 `packages/core/test/model-gateway.test.ts`（6 条）：按冻结档运行并携带 secret、配置变更后活动 Run 仍用旧模型而新冻结生效、无可用模型时准入失败且不回落、快照缺失/secret 缺失分别报 `STALE_ARTIFACT`/`CONFIG_INVALID` 且不发请求、provider 失败原样上报（retryable）、连接测试成功与未配置模型报错。

### 本任务验证命令

- `pnpm typecheck`：通过（无输出）。
- `pnpm lint`：通过（`All matched files use Prettier code style!`）。
- `pnpm test:unit`：187 passed（新增 14 条）。
- `pnpm test:integration`：10 files / 124 passed（未回退）。

## T3 Assessment 与修改授权（AC-045）—— 完成

- `packages/core/src/orchestrator.ts` 的 `assess()`：Work 必须存在；`requiresExplicitAuthorization(level)` 为真（L3）且无 `authorizationRef` 时 `NOT_AUTHORIZED`；写不可变 `assessment` 行 + `assessment.saved`（含 workId/intent/level/semanticImpact），整段在一个事务内；重复评估是新行而非更新。

## T4 Dispatch 冻结与 Run 建立（AC-043, AC-045, AC-082）—— 完成

- `dispatch()`：`validateDispatchSpec` → purpose×role（DC-32）→ 专业 spec 的父 Run 必须是同 Work 的 Chief Run（`isDirectChiefChild`，孙 Run 在任何写入前拒绝）→ task 必须属于同 Work → Run 级预算与 Work budget（`canAllocateBudget`）→ 角色可用模型与 `profileRevision` 校验（DC-34）→ 冻结 `config`（`ConfigStore.freeze`）、`context`、`dispatch` 快照 → 一个事务内插入 `run`（`queued`）、写 `run.queued`、把子 Run 追加到父的 `childIds`。
- `DispatchSnapshot.hash` 自哈希：身份按「不含 hash 字段」的载荷计算，行哈希与内层 `hash` 相等（`SnapshotWriter.freeze` 的 `identityPayload`）。
- `beginAttempt`/`settleRun`：见 DC-33。

## T5 Join 与局部失败（AC-046）—— 完成

- `packages/core/src/join.ts`：`JoinCoordinator.state/childrenOf/outcomeOf/onChildSettled`。子未全部终态且父 running → 父转 `waiting_children`（**不发 Join 专用事件**：`protocol.md` §7 没有该事件名，见 DC-39）；全部终态且无 required 失败 → 父回 `running`；有 required 失败 → 父保留在 `waiting_children`，写 `chief_action_required`（携带全部子结果与失败清单），兄弟结果不删除不重写。`join=none` 的父不进入等待。父在 `waiting_children` 时 mailbox 仍可处理命令（测试用 `ProjectMailbox` 验证）。

## T6 request_dispatch 只产生 Chief 待办（AC-045）—— 完成

- `Orchestrator.requestDispatch`：专业 Run 的请求写成 `chief_action_required` 事件（entityId = 其 Chief Run，entityVersion = **Chief Run 版本**），返回 `disposition='chief_action_required'`，绝不建立 Run；指定非自身 Chief 的父被 `NOT_AUTHORIZED` 拒绝；Chief Run 调用被拒；请求者或 Chief Run 已不能行动时 `INVALID_STATE`；同 `operationId` 同载荷幂等返回，同键不同载荷 `IDEMPOTENCY_CONFLICT`。

## T7 Stage 契约与 contract_violation（AC-047）—— 完成

- `packages/core/src/stage.ts`：`StageGate.submit` 校验归属与字段（DC-36），且只在 Run `running` 时接受；第一次 Schema 失败写 `stage.failed(outcome='schema_invalid', rejection=1)` 并允许一次修正，第二次经 `RunLifecycle.contractViolation` 把 Run 置为 `contract_violation` 并写 `run.ended(outcome='contract_violation')`（含预留释放）；接受时写 `stage_result` 行 + `stage.completed`/`stage.failed(outcome=<交付状态>)`「结构化交付」证据。

## T8 重启窄范围（AC-082）—— 完成

- `Orchestrator.recoveryView(runId)`：只读冻结的 `dispatch` 快照（校验行类型与自哈希一致）与 `config` 快照，返回 `effectiveScope`/`requiredOutputSchemas`/profile；Work 后续放宽 scope 不影响已冻结 Run；快照缺失/类型错误/哈希不符均 `STALE_ARTIFACT`。

### 本阶段验证命令

- `pnpm typecheck`：通过；`pnpm lint`：通过。
- `pnpm test:unit`：202 passed；`pnpm test:integration`：124 passed（未回退）。（Review 修复后为 207 passed，见下节。）

## T9 独立 Review 与修复（第一轮 FAIL → 修复）

- 独立 Review（fresh context，见 `review.md`）判 FAIL：1×P1（`stage.submit` 无终态/epoch 守卫）、5×P2（可接消息证据空洞、`joinPolicy=none` 未实现、持久事件名偏离 `protocol.md` §7、越界写入 Plan、`run.ts` 快照引用改哈希与 `data.md` 冲突）、7×P3。
- 修复逐条记录在 `discovery.md` DC-37（RE-01..RE-13）。其中 RE-06（快照引用哈希 vs `data.md` 的 `ID` 记法）保留实现作为**需产品方确认的显式偏离**，不改写 `data.md`。
- 修复后验证：`pnpm typecheck` 通过；`pnpm lint` 通过；`pnpm test:unit` 207 passed；`pnpm test:integration` 124 passed；`pnpm docs:check` ok。

## T10 独立 Review 第二轮与修复（第二轮 FAIL → 修复）

- 第二轮独立 Review（同一 `review.md` 的第二轮章节）判 FAIL：0×P1、5×P2、6×P3。第一轮 P1 已确认修好；R-05/R-09/R-10/R-11/R-12 确认修好；R-01/R-03/R-04/R-07/R-08/R-13 只算部分修复；R-02 未真正修复。
- 新增 `packages/core/src/run-lifecycle.ts`：把「Run 进入终态的唯一下沉路径」和 Work 预算预留收敛到一处，`orchestrator.settleRun` 与 `StageGate` 的 `contract_violation` 共用，因此任何终态都会释放预留（N-01）。
- `StageGate.submit` 改为**只有 `running` 可交付**：`paused`/`waiting_permission`/`interrupted`/`recovery_required` 与终态一律 `INVALID_STATE` 且零写入（N-02、N-08）。
- `dispatch` 校验父 Run 状态（`ACTIVE_PARENT_STATUSES = queued/starting/running/waiting_children`）：终态或暂停的父 Run 不再接收新子 Run（N-04、N-05）；因此「父等待可接消息」测试现在有区分力——`waiting_children` 可继续分派、`completed` 必然被拒。
- `JoinCoordinator` 真正删除未定义事件名，`chief_action_required` 按 `(parent, reason, 失败集合)` 幂等（重算不重复建待办），事件 data 携带完整结果契约（N-03、N-06、N-07）。
- 预算准入对所有 spec（含 Core 构造的 chief spec）在下沉写入前统一判定，超限返回文档规定的 `BUDGET_EXCEEDED` 而非 Schema 约束错误（N-10）。
- 记录修正：DC-37 RE-04 的不实表述已更正；补 DC-38（Run 参数层无授权来源）、DC-39（Join 无协议事件，承接 WP-08）。
- 修复后验证：`pnpm typecheck` 通过；`pnpm lint` 通过；`pnpm test:unit` **210 passed**；`pnpm test:integration` 124 passed；`pnpm docs:check` ok。

## T11 独立 Review 第三轮与修复（第三轮 FAIL → 修复）

- 第三轮独立 Review（`review.md` 第三轮章节）判 FAIL：N-01..N-10 全部经对方实跑确认修好（0 条残留），但新增 1×P1、2×P2、2×P3（M-01..M-05）；对抗性核验又补出 D1/D2/D3/D4/D5，并把 M-01 的量级从「无 API 可恢复」修正为「现有 Chief Run 不可恢复，新建 Chief Run 是文档化恢复路径」，同时证伪了「N-06/AC-047 已完全修好」——两者的 10k 窗口可达。
- 修复：
  - 新增 `packages/core/src/events.ts`（`scanEvents`/`findEvent` 全量分页），`StageGate.rejections()` 与 `JoinCoordinator.pageChief()` 改用它，消除 1 万条窗口对 AC-047 二次升级与待办幂等的击穿（M-06/N-06 残留、F1/F2、D3）。
  - `requireBudget` 只统计**非终态**子 Run 的额度（M-01），并补「顺序子 Run 结算后可继续派发」测试。
  - `RunLifecycle.settle` 支持实测用量：释放整笔预留后把 `tokensUsed` 计入用量，`run.ended` 记录 `usageMeasured`；真实用量来源归 WP-10（M-02、DC-41）。
  - `requestDispatch`：`entityVersion` 用 Chief Run 版本（D1）、终态请求者 `INVALID_STATE`（D2）、支持 `operationId` 幂等（M-05）。
  - `ChildOutcome` 与阻断事件 data 补齐 `readLedgerSeq`/`readLedgerHash`（M-04、N-07）。
  - 记录更正：M-03 的 Work `blocked(provider)` 声明改为显式缺口（DC-42），T7/DC 中旧事件名更正（DC-44）。
- 修复后验证：`pnpm typecheck` 通过；`pnpm lint` 通过；`pnpm test:unit` **213 passed**；`pnpm test:integration` 124 passed。

## T12 独立 Review 第四轮与修复（第四轮 FAIL → 修复）

- 第四轮独立 Review（`review.md` 第四轮章节，含对抗性核验）判 FAIL：第三轮 M-01..M-05、D1..D5 的修复主体成立（无「文档声称已修而代码不符」的新条目），但新增 3×P2、7×P3（Q-01..Q-10），对抗性核验另补 H-01..H-03。
- 需要说明的记录事实：**D1..D5 不是第三轮 Review 报告里的条目**（第三轮报告只有 M-01..M-05），它们来自第三轮的对抗性核验与开发方修复提交/DC 记录。第四轮报告把它们当作「第三轮条目」逐条复核，属追溯口径不准确；此处更正，避免后续 Settlement 误引。
- 修复：
  - Q-01：`operationId` 幂等加入载荷指纹，同键不同请求（含不同请求者/goal/role）返回 `IDEMPOTENCY_CONFLICT`，不再静默丢弃（`protocol.md` §1/§7）。
  - Q-04：`RunLifecycle.end` 在 Run 仍有 `join=all` 未终态子 Run 时拒绝终态（`INVALID_STATE`）；`lifecycle.cancel` 作为文档化例外向下传播取消（`agents.md` §3），避免子 Run 结算进无人拥有的 Join、Gate 阻断通知已终态父 Run。
  - Q-03/M-02：未测量 usage 一律**保持预留**并置 `budget.costKnown=false`（`reliability.md` §3「未知usage保持预留…不能按零收费释放额度」），新增 `RunLifecycle.reconcile(runId, {tokensUsed, cost?})` 作为 WP-10 拿到 Provider usage 后的核销路径；`run.ended` 区分 `usageMeasured`/`costKnown`。
  - H-01：`requestDispatch` 同时校验 Chief Run 可行动性，终态 Chief 不再被塞入无人处理的待办。
  - H-02：`run.ended` 两条终态路径 data 形状统一（均含 `outcome/usageMeasured/costKnown/tokensUsed/releasedTokens`）。
  - Q-07：源码注释不再声称 Work 级 `blocked(provider)`（DC-42）。
  - Q-09：`plan.md` 升到 planVersion 3，补入 `events.ts`、`run-lifecycle.ts`。
  - Q-10/D4：T5 记录中的两个未定义 Join 事件名已更正；D5（dispatch 不校验 Work 状态）登记 DC-46。
- 修复后验证：`pnpm typecheck` 通过；`pnpm lint` 通过；`pnpm test:unit` **216 passed**；`pnpm test:integration` 124 passed。

## T13 独立 Review 第五轮与修复（第五轮 FAIL → 修复）

- 第五轮独立 Review 判 FAIL（0×P1/5×P2/9×P3，编号 R5-01..R5-14），对抗性核验认为报告结论成立但严重度标定偏低（按 `workflow.md` §6（第 65 行）应为 P1），并补出 M-1..M-4。
- 修复：
  - R5-01/Q-01 残留：`operationId` 指纹覆盖全载荷，任一字段不同即 `IDEMPOTENCY_CONFLICT`（DC-51）。
  - R5-02/Q-04 残留：`settleRun(...,'cancelled')` 与 `cancel` 合并为同一路径并向下传播；`cancel` 先校验父迁移、再在单事务内取消子树（DC-49、M-3）。
  - R5-03/Q-02：计费封顶到预留额、超预留记 `uncoveredTokens`，Run 不再卡在 `running`；usage 必须为非负整数（DC-50、M-4）。
  - R5-04：`reconcile` 幂等，重放不重复计费、不动其他 Run 的预留；Work 级 `costKnown` 按全部终态 Run 重算（DC-52）。
  - R5-05/H-01 残留：`JoinCoordinator.pageChief` 对无法行动的 Chief Run 不再写待办；`state()` 的 blocked 结果返回已登记待办游标（R5-07）。
  - R5-09：同键重放先查库，Chief 终态后重放仍返回原结果（DC-51）。
  - M-1：父 Run 二次不合规升级不再被在场子 Run 挡住（DC-49）。
  - R5-10..R5-13：`run.ended` data 统一含 `workId`/`chargedTokens`/`uncoveredTokens`；源码与记录中「Work blocked(provider)」「预留已释放」等注释全部改为与实现一致；DC-42/DC-46 缺口口径不变。
  - 记录更正：见 DC-53（严重度口径与 H-03 性质）。
- 修复后验证：`pnpm typecheck` 通过；`pnpm lint` 通过；`pnpm test:unit` **222 passed**；`pnpm test:integration` 124 passed。

## T14 独立 Review 第六轮与修复（第六轮 FAIL → 修复）

- 第六轮独立 Review 判 FAIL（1×P1、2×P2、7×P3，编号 R6-01..R6-10），对抗性核验确认结论成立（并指出报告严重度口径需修正），另补 3 条观察（`measured:false` 带非零用量被静默丢弃、`reconcile` 判定在事务外、`JoinCoordinator` 目前无生产调用方）。
- 修复：
  - R6-01（P1）：`reconcile` 只对「尚无实测/核销记录」的 Run 生效，判定与写入同一事务；同量重放无操作、异量 `IDEMPOTENCY_CONFLICT`（DC-52）。
  - R6-02：`cost` 真正进入 `budget.cost`（并允许非整数，符合 `data.md` §2 的 `z.number().nonnegative()`）。
  - R6-03：`settleRun(...,'cancelled',{measured:true})` 的实测用量会记账，不再静默丢弃。
  - 对抗性观察1：`measured:false` 且 `tokensUsed>0` 属自相矛盾输入，直接 `VALIDATION_ERROR`，不允许静默写零。
  - R6-04/R6-05/R6-06：核销事件带 `reconciliation: n`；每 Run 事实改名 `runCostKnown`，Work 级 `costKnown` 独立重算。
  - R6-09：`operationId` 缺省时用请求指纹派生，事件记录 `operationIdSource`（DC-54）。
  - R6-10：Core 入口的契约校验统一转成 `VALIDATION_ERROR`，不再抛裸 `ZodError`。
  - 记录：DC-35 父状态描述更正（R6-08）、DC-46 补齐六种 Work 状态（R5-11 残留）、新增 DC-54..DC-56（含 M-2 定义与严重度口径）。
- 修复后验证：`pnpm typecheck` 通过；`pnpm lint` 通过；`pnpm test:unit` **225 passed**；`pnpm test:integration` 124 passed。

## T15 独立 Review 第七轮与修复（第七轮 FAIL → 修复）

- 第七轮独立 Review 判 FAIL（0×P1、2×P2、6×P3，编号 R7-01..R7-08），对抗性核验确认结论成立并补出 R7-09（P2）。
- 修复：
  - R7-01：`dispatch` 先用契约 Schema 校验 spec，畸形输入统一 `VALIDATION_ERROR`（DC-58）。
  - R7-02：`reconcile` 幂等判定同时比对 `tokensUsed` 与 `cost`（含 `null` 归一），只改 cost 不再被静默丢弃。
  - R7-03：`measured:false` 时不允许携带 `cost`。
  - R7-04：去掉恒为 1 的 `reconciliation` 字段，事件顺序由 `cursor` 表达（DC-48 更新）。
  - R7-05：DC-48 字段名更正为 `runCostKnown`。
  - R7-06：DC-35 更正 required/非 required 子 Run 失败时父状态的差异。
  - R7-07：快照冻结移到全部准入判定之后，被拒 dispatch 无副作用（DC-58）。
  - R7-08：记录中 Work 状态改为 `workStatusSchema` 的真实取值；严重性引用改为 `workflow.md` §6（第 65 行）。
  - R7-09：级联取消按「有无 Attempt」区分已知零用量与未知用量（DC-57）。
- 修复后验证：`pnpm typecheck` 通过；`pnpm lint` 通过；`pnpm test:unit` **228 passed**；`pnpm test:integration` 124 passed。

## T16 独立 Review 第八轮与修复（第八轮 FAIL → 修复）

- 第八轮独立 Review 判 FAIL（0×P1、3×P2、6×P3，编号 R8-01..R8-09）。
- 修复：
  - R8-01/R8-02：新增 `dispatchRequestSchema` 与 `assessRequestSchema`（contracts），`requestDispatch`/`assess` 入口首行校验，畸形输入与非法枚举统一 `VALIDATION_ERROR`，且不留 Chief 待办（DC-59）。
  - R8-03（P2）：`initialUsage(run)` 抽成一处，被取消的 Run 自身与级联子 Run 共用「无 Attempt ⇒ 已知零、立即释放预留」规则；补「取消未启动 Chief 后可再派发同额 Run」回归断言。
  - R8-04/R8-09：新增 `dispatchExtrasSchema` 在任何快照冻结前校验 `authorizationRef`/`requiredOutputSchemas`/`contextPayload`；`SnapshotWriter.freeze` 增加 payload 必须是 JSON 对象的兜底校验（DC-59）。
  - R8-05：DC-35 改写为实测语义（只有 `join=all` 在场才进 `waiting_children`；required 失败保持当前状态）。
  - R8-06：DC-48 改为完整字段表 + 字段层级 + 排序语义；DC-52 指向 DC-48。
  - R8-07：DC-56/T13 的 `§65` 引用改为 `workflow.md` §6（第 65 行）。
  - R8-08：`data.md` §5→§2（事件游标）、`contextSelection.readPaths`→`codePaths`、`charges tokensUsed`→封顶后的 `chargedTokens` 三处注释更正。
- 修复后验证：`pnpm typecheck` 通过；`pnpm lint` 通过；`pnpm test:unit` **230 passed**；`pnpm test:integration` 124 passed。

## T17 独立 Review 第九轮与修复（第九轮 FAIL → 修复）

- 第九轮独立 Review 确认 R8-01..R8-09 全部真修好，但新增 R9-01..R9-06，对抗性核验另补三项（`operation` 的 L3 判定源错误、`authorizationRef` 不核对授权实体、`scope` 也被静默丢弃），并指出 R9-01 与漏项属 P1 级。
- 修复：
  - R9-01 + 对抗性漏项 A（DC-62）：L3 运行环境判定改用载荷的 `scope.operations`/`scope.networkTargets`；风险旗标词表同时识别 `workflow.md` §2.3 的中文文档用词与 camelCase 旗标（归一化大小写与分隔符）；提交等级不得低于底线。
  - 对抗性漏项 B（DC-63）：`requiresExplicitAuthorization` 时按 id 查 `authorization` 行，伪造引用 ⇒ `NOT_AUTHORIZED`。
  - R9-02/漏项 D（DC-61）：`assessRequestSchema` 改用协议字段名 `assessment`；`requestDispatch` 的 `sourceRefs[].version` 死回退删除、`goal`/`reason`/`stage` 去空白、`operationId` 限 1–128。
  - R9-03：`runParams` 纳入 `dispatchExtrasSchema`（非对象 ⇒ `VALIDATION_ERROR`，不再被静默忽略）。
  - R9-04/漏项 C（DC-60）：`goal`/`scope` 未落库属文档口径冲突，登记为 Product Decision Pending。
  - R9-05：`AuthService.secureCookies` 与注释对齐——remote 或任一 allowedOrigin 为 https 时置 `Secure`。
  - R9-06：`JoinCoordinator.pageChief` 改为只跳过**终态**父 Run；paused/interrupted/recovery_required 仍登记待办，恢复后不会丢失 AC-046 的 Chief 待办。
- 修复后验证：`pnpm typecheck` 通过；`pnpm lint` 通过；`pnpm test:unit` **233 passed**；`pnpm test:integration` 124 passed。

## T18 独立 Review 第十轮与修复（第十轮 FAIL → 修复）

- 第十轮独立 Review 确认 R9-05/R9-06 与对抗性 A 已修好，其余部分修复；新增 R10-01..R10-07，对抗性核验另补三项。
- 修复：
  - R10-01（阻断）：未登记风险旗标 fail-closed —— `unknownRiskFlags` 拒绝并返回词表；补上文档原样合并措辞（`数据删除/迁移`、`支付金额/状态`、`部署/发布`）与分隔符归一；`isKnownLockdownRiskTerm` 接入（DC-62/DC-64）。
  - R10-02（阻断）+ 对抗性 M-1（DC-63）：`verifyAuthorization` 统一核对存在性、同 Work、未撤销；任何提供的 `authorizationRef` 都核对；`dispatch` 的引用同样核对后才允许冻结。
  - 对抗性 M-2 / R10-07（DC-62）：环境操作判定与 `intent` 标签解耦，改用 `scope.networkTargets` + 环境副作用操作集合（`bash/network/secret/push/deploy/delete_data`），只读操作不再被过度升级。
  - R10-03：`assessment.saved` 同时记录 `floor`，路由证据自洽。
  - R10-04 + M-3（DC-61）：`DispatchRequestInput.sourceRefs[].version` 改必填；`operationId` 去空白限长、`stage` 限 64 字符。
  - R10-05（DC-59）：`runParams` 按 `profileSchema.partial()` 校验，非法字段报 `VALIDATION_ERROR` 而不是 `PROVIDER_UNAVAILABLE`。
  - R10-06（DC-60）：更正记录——`goal`/`scope` 既不落行也不落事件。
- 修复后验证：`pnpm typecheck` 通过；`pnpm lint` 通过；`pnpm test:unit` **237 passed**；`pnpm test:integration` 124 passed。

## T19 独立 Review 第十一轮与修复（第十一轮 FAIL → 修复）

- 第十一轮独立 Review 确认 R10-01..R10-07 主体全部真修好（词表、授权存在性/同 Work/未撤销、runParams、floor 记录、DC-60 更正、只读操作不升级均 verified），但发现两个 intent 取值仍能整体绕过 L3 门禁，另有 operation 底线与记录/注释问题。
- 修复：
  - R11-01（阻断，DC-65）：`decideLevel` 把环境操作与 lockdown 风险判定提到 `assist`/`artifact` 之前；补 `assist`/`artifact` × `deploy`/`networkTargets`/风险旗标的失败测试。
  - R11-02（DC-65）：`routingFloor` 对 `operation` intent 至少返回 L2；同步更正 docstring。
  - R11-03（阻断，DC-63）：`dispatch` 用 `extras.authorizationRef ?? work.authorizationRef` 与 `work.level` 做授权核对，L3 Work 无有效授权时拒绝建 Run；补 L3 Work（有/无授权）的回归测试。
  - R11-04：把误挂的 `operationFingerprint` JSDoc 移回其函数上方（新常量块不再截断注释）。
  - R11-05：环境操作集合从 core 移到 `domain/routing.ts`（`ENVIRONMENT_OPERATIONS`，按 `operationNameSchema` 分类并说明 `git`/`edit`/`write` 不入选的理由）。
- 修复后验证：`pnpm typecheck` 通过；`pnpm lint` 通过；`pnpm test:unit` **239 passed**；`pnpm test:integration` 124 passed。

## T20 独立 Review 第十二轮与修复（第十二轮 FAIL → 修复）

- 第十二轮独立 Review 确认 R11-01/R11-02/R11-04/R11-05 真修好（R11-03 只覆盖了清单内一半），新增 R12-01..R12-05，对抗性核验另补两项（`none` 级 Work 可派写权限 Run 且 `grantsModificationAuthority` 是死代码、风险词表斜杠归一未生效）。
- 修复：
  - R12-01/R12-02（阻断，DC-66）：`dispatch` 用 `spec.scope` 推出 `runLevel`（环境操作 ⇒ L3），授权核对加入 `operations`/`networkTargets` 覆盖检查，`none` 级 Work 拒绝带 `writePaths` 的 spec（`grantsModificationAuthority` 接入）。
  - R12-03（DC-66）：把实际核对的授权引用（含来自 Work 行）冻结进 DispatchSnapshot，AC-082 恢复可重建授权来源。
  - R12-04：`verifyAuthorization` 的 JSDoc 与签名/调用点对齐（含 `scope` 与返回值）。
  - R12-05：DC-62 明确 `ENVIRONMENT_OPERATIONS` 定义在 `domain/routing.ts`。
  - 对抗性②：`normalizeRiskTerm` 增加 `/` 归一（`数据删除迁移` 与 `数据删除/迁移` 等价），补 domain 断言。
  - 顺带修复：`professionalSpec` 去掉显式 `undefined` 的可选字段，避免把非 JSON 值带进快照 payload。
- 修复后验证：`pnpm typecheck` 通过；`pnpm lint` 通过；`pnpm test:unit` **242 passed**；`pnpm test:integration` 124 passed；`pnpm build` 通过。

## T21 独立 Review 第十三轮与修复（第十三轮 FAIL → 修复）

- 第十三轮独立 Review 确认 R12-01/R12-03/R12-04/R12-05 与对抗性②真修好，R12-02 与对抗性①只修了一半；新增 R13-01..R13-06，对抗性核验另补一项（`none` Work 用本地写操作绕过写权限门禁）。
- 修复：
  - R13-01/对抗性补项（阻断，DC-67/DC-68）：写权限门禁改用 Work 自身等级并计入 `WORKSPACE_WRITE_OPERATIONS`；授权范围覆盖增加 `writePaths`/`readPaths` 路径维度，`assess` 也把自身 `scope` 传入核对。
  - R13-02（阻断，DC-67）：`none` Work 不能靠声明环境操作把 `runLevel` 升到 L3 来获得写权限。
  - R13-03（DC-69）：`dispatch`/`professionalSpec` 用 `jsonClean` 删除显式 `undefined` 可选字段，不再产生 `CONSTRAINT_VIOLATION` 与孤儿快照。
  - R13-04/R13-05：DC-63 重写为与实现一致（含四类覆盖与后续承接）；测试中错误的 `DC-65` 编号与「read-only grant」注释更正（`DC-66`、授权不覆盖该操作）。
  - R13-06（DC-70）：`config.policy.l3Paths`/`l3Keywords` 无消费方登记为 WP-04/WP-05 承接缺口。
- 修复后验证：`pnpm typecheck` 通过；`pnpm lint` 通过；`pnpm test:unit` **246 passed**；`pnpm test:integration` 124 passed。

## T22 独立 Review 第十四轮与修复（第十四轮 FAIL → 修复）

- 第十四轮独立 Review 确认 R13-01/R13-03/R13-06 真修好，R13-02 主体修好但漏了 `git`，新增 R14-01..R14-05；对抗性核验另补 D-1..D-4（`git` 零授权即可派发、只读授权可为网络目标背书、readPaths 收紧未登记、`assess` 不做 `none` 写门禁）。
- 说明：本轮报告中 R14-04（称 R13-01 新用例的拒绝原因是 operations 维度）的前提不成立——`backendSpec` 默认 `operations: []`，该用例正是由 `uncoveredWritePaths` 拒绝（对抗性核验已复现并更正）；本包仍按结论补强该断言，直接断言 details 的路径维度。
- 修复：
  - R14-01/D-1（阻断，DC-66）：`git` 计入 `WORKSPACE_WRITE_OPERATIONS`，`none` 级 Work 无论是否带授权都不能派发 `git`。
  - D-2（DC-63）：声明 `networkTargets` 的 Run 要求授权带 `network` 操作，只有目标被列举不再足够。
  - R14-02：DC-66 重写为与实现一致（用 Work 等级判写权限、writePaths 覆盖已实现）。
  - R14-03：`verifyAuthorization` 的 JSDoc 补齐路径维度与 `network` 操作要求。
  - R14-04：R13-01 的断言改为检查 `uncoveredWritePaths`（路径维度）而非仅匹配错误消息。
  - D-3/D-4：DC-63 登记路径收紧，DC-66 登记 `assess` 不是 Run 边界与 Work 等级回写缺口。
- 修复后验证：`pnpm typecheck` 通过；`pnpm lint` 通过；`pnpm test:unit` **247 passed**（该修复提交时点数；`088bdd7` 增加分类完备性用例后为 248，第十五轮修复后为 250）；`pnpm test:integration` 124 passed。

## T23 独立 Review 第十五轮与修复（第十五轮 FAIL → 修复）

- 第十五轮独立 Review 确认 R14-01/D-1 真修好（12 种操作 × 写范围在 none 级 Work 上全拒、带授权亦拒）、R14-02/03/05 与 D-2/D-3/D-4 到位；新增 R15-01..R15-04，对抗性核验另补一条（同族的 `readPaths`/`networkTargets` 交叉缺失）。
- 修复：
  - R15-01（阻断，DC-63）：授权能力与声明维度交叉核对——声明 `writePaths` 需授权含写操作、声明 `readPaths` 需授权含读操作（`includesWorkspaceWrite`/`includesRead`），否则 `capabilityGaps` ⇒ `NOT_AUTHORIZED`；只读授权（或空操作授权）不再能为写范围背书。
  - R15-02：`authorizationSchema.operations` 改用契约枚举 `operationNameSchema`，避免拼写错误形成永久死授权。
  - R15-03：补「none 级 Work × `git` × 带本 Work 授权」与「只读授权 × 写范围」用例。
  - R15-04：DC-67 的操作集更正为含 `git`；T22 的 247 标注为修复提交时点数（随后 248）。
- 修复后验证：`pnpm typecheck` 通过；`pnpm lint` 通过；`pnpm test:unit` **250 passed**；`pnpm test:integration` 124 passed。

## T24 独立 Review 第十六轮（Review PASS，对抗性核验异议 → 复核修复）

- 第十六轮独立 Review 判 **PASS**（0×P1、1×P2 非阻断、5×P3），确认 R15-01..R15-04 真修好；对抗性核验认为应判 FAIL，理由是 `artifact_write` 被计入工作区写操作会导致 `none` 级 Work（assist/artifact 路线）无法派发写自己 Artifact 的 Run（与 `execution.md` §21/§53、`workflow.md` §2.1/§3 相反），另补 M-1（`none` Work 可经授权取得环境权限派 L3 Run）与 M-2（`assess` 与 `dispatch` 对同一 scope 结论不一致）。
- 采纳对抗性异议并修复（本轮不新增独立 Review 轮次，改动进入下一轮复核）：
  - R16-01/M-3/M-4（DC-71）：`artifact_write` 移出 `WORKSPACE_WRITE_OPERATIONS`，单列 `ARTIFACT_WRITE_OPERATIONS`；补「`none` Work 派 artifact_write Run」与 `intent:'artifact'` 的端到端用例。
  - M-1（DC-71）：`none` 级 Work 不能取得环境权限（`dispatch` 的写/环境门禁统一）。
  - M-2（DC-71）：`assess` 对同一条件报 `VALIDATION_ERROR`，与 `dispatch` 一致。
  - R16-02（DC-63）：登记「能力交叉核对只约束授权侧、spec 的 `operations` 是工具层允许清单」这一边界。
  - R16-03：`plan.md` planVersion 4 明确列入 `packages/domain/**` 与 `packages/contracts/src/entities/work.ts` 等实际写入文件。
  - R16-04：`verifyAuthorization` JSDoc 补齐能力交叉核对；R16-05：domain 分类测试改用 `READ_OPERATIONS`/`ARTIFACT_WRITE_OPERATIONS`；R16-06：T22 计数标注更正。
- 修复后验证：`pnpm typecheck` 通过；`pnpm lint` 通过；`pnpm test:unit` **251 passed**；`pnpm test:integration` 124 passed。

## T25 独立 Review 第十七轮（Review PASS，含对抗性核验一致 PASS）

- 第十七轮独立 Review 判 **PASS**（0×P1、0×P2、5×P3），对抗性核验同样裁 PASS（另补 N-17-01：`plan.md` 头字段 `planVersion` 未随 planVersion 4 变更条目更新）：
  - R16-01/M-1/M-2 三条异议经独立复现全部闭合（artifact_write 归入 Artifact 输出、`none` 级 Work 写/环境权限 11 例全拒、assess↔dispatch 84 格差分 0 fail-open）；R15-01 未回退（写路径背书者由 4 收紧为 3）。
  - 契约命令：typecheck/lint/unit **251 passed**/integration **124 passed**/docs:check/build 全绿。
- 本轮记录级修正（不改运行行为）：R17-02（DC-66/DC-67 三元素写集合）、R17-03（`artifact_write` 不参与能力交叉核对）、R17-04（`assess` 拒绝 details 补 `environmentScope`）、R17-05（环境操作集合注释随分类更新）、N-17-01（`planVersion: 4`）、R17-01（新增 DC-72 登记 `none` Work 的升级路径限制）。
- 结论：WP-02 进入独立 Test。

## T26 独立 Test 第一轮（FAIL：T-01）与修复

- 独立 Test（第十七轮 Review PASS 后）判定 **FAIL**：AC-043 不通过（T-01，P1）。其余 5 条 AC（AC-044/045/046/047/082）通过，自建实验 51 断言 0 失败；契约命令全绿（unit 251、integration 124）。
- T-01：`ConfigStore.freeze` 把「Provider 没有 `secretRef`」（合法的本地/无鉴权端点）冻结成 JSON `null`，而 `ModelGateway.complete` 以 `secretRef === undefined` 判断「无需 Secret」，于是 `null !== undefined` 被当成「Secret 不可用」，每个 Run 的每次模型调用都返回 `CONFIG_INVALID: secret null is not available`。产品测试夹具全部使用 `secretRef: 'local-secret'`，故 251 单测未覆盖。
- 修复：冻结投影在 `secretRef === undefined` 时省略该键（不再写 `null`）；补「无 secretRef 的 Provider 可完成调用且冻结快照不含该键」的正例（`model-gateway.test.ts`）。
- 修复后验证：`pnpm typecheck` 通过；`pnpm lint` 通过；`pnpm test:unit` **252 passed**；`pnpm test:integration` 124 passed。
- 后续：按失败路由进入独立 Review（第十八轮），通过后重新独立 Test（`test.md` 将记录第二轮）。

## T27 独立 Review 第十八轮（PASS）与对抗性核验补项修复

- 第十八轮独立 Review 判 **PASS**（0×P1、2×P2、2×P3），对抗性核验也裁 PASS（有条件），并补出三条：`availability()` 不解析 `secretRef` → 悬空凭证的 Run 仍被准入（R18-05，P2）、`freeze` 的 `model` 投影丢掉可选价格字段、`readFrozen` 无形状校验（畸形载荷会抛原生 `TypeError`）。
- 修复：
  - R18-01：`FrozenProvider` 投影收敛为 `frozenProviderOf` 单一实现（`resolve`/`freeze` 共用）。
  - R18-02：`readFrozen` 把历史 `secretRef: null` 归一为缺省，`complete()` 同样按 `?? undefined` 处理。
  - R18-05（DC-73）：`availability` 在注入了 `SecretResolver` 时解析 `secretRef`，取不到即不可用（不注入时保持放行，真实 Secret 存储属 WP-07）。
  - 对抗性 3.2：`model` 冻结投影保留可选价格字段，`resolve()` 与 `readFrozen()` 形状一致。
  - R18-03/R18-04：补匿名 `testConnection` 用例与冻结 provider 形状断言（形状守卫在 `model-gateway.test.ts`；`config.test.ts` 未被本提交触碰——第十九轮 R19-02 更正原记录口径）；新增 DC-73 登记。
- 修复后验证：`pnpm typecheck` 通过；`pnpm lint` 通过；`pnpm test:unit` **255 passed**；`pnpm test:integration` 124 passed。

## T9 待办

- 独立 Review 与 Test（独立上下文）、结算与 `docs/INDEX.md` 状态更新、以及 `docs/delivery/acceptance.md` 中本包 AC 的证据登记。

## T28 独立 Review 第十九轮（PASS，覆盖 cbf7471 的 R18 补修）

- 第十九轮独立 Review 判 **PASS**（0×P1、1×P2、2×P3），对抗性核验同样裁 PASS（有条件），并闭合了第二轮 Test 提出的 O1（`cbf7471` 的代码改动此前无 Review 覆盖）。
- 复核：R18-01（单一 `FrozenProvider` 投影，`resolve`/`freeze`/`readFrozen` 三路一致）、R18-02（历史 `secretRef:null` 归一）、R18-05（`availability` 校验凭证，悬空引用时 `PROVIDER_UNAVAILABLE` 且零写入）、model 价格投影四项全部真修好、无回归；契约命令 typecheck/lint/unit **255**/integration **124**/docs:check/build 全绿。
- 新增非阻断项：R19-01（P2，`readFrozen` 对缺 `provider`/`model` 的畸形载荷抛原生 `TypeError`，承接 WP-08/WP-09）、R19-02（P3，T27 记录口径，已更正）、R19-03（P3，`SecretResolver` 隐式契约与双重解析，已登记 DC-73）。
- 对抗性核验的记录级更正：`frozenProviderOf` 注释不再引用 `data.md` 中不存在的 `FrozenProvider` 结构（注释级修正，不改变行为）；R19-01/R19-03 已按上述登记。
- 结论：WP-02 具备结算条件（0×P1、6/6 AC 有有效 Test 证据、代码树冻结）。
