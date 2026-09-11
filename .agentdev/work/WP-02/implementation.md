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

## T9 待办

- 独立 Review 与 Test（独立上下文）、结算与 `docs/INDEX.md` 状态更新、以及 `docs/delivery/acceptance.md` 中本包 AC 的证据登记。
