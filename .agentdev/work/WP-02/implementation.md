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

- `packages/core/src/model-gateway.ts`：`availability(role, runParams)`（准入判定，失败即 Work `blocked(provider)`）、`frozenProfileOf(run)`（读 Run 的 `config` 快照，缺失抛 `STALE_ARTIFACT`）、`complete(run, messages)`（模型/reasoning/上下文上限只来自冻结快照，签名上不提供任何选择模型的入口）、`testConnection(providerId, modelId)`（最小请求 + 延迟）、`tokensOf`。
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

- `packages/core/src/join.ts`：`JoinCoordinator.state/childrenOf/outcomeOf/onChildSettled`。子未全部终态且父 running → 父转 `waiting_children` + `run.waiting_children`；全部终态且无 required 失败 → 父回 `running` + `run.children_joined`；有 required 失败 → 父保留在 `waiting_children`，写 `chief_action_required`（携带全部子结果与失败清单），兄弟结果不删除不重写。`join=none` 的父不进入等待。父在 `waiting_children` 时 mailbox 仍可处理命令（测试用 `ProjectMailbox` 验证）。

## T6 request_dispatch 只产生 Chief 待办（AC-045）—— 完成

- `Orchestrator.requestDispatch`：专业 Run 的请求写成 `chief_action_required` 事件（entityId = 其 Chief Run），返回 `disposition='chief_action_required'`，绝不建立 Run；指定非自身 Chief 的父被 `NOT_AUTHORIZED` 拒绝；Chief Run 调用被拒。

## T7 Stage 契约与 contract_violation（AC-047）—— 完成

- `packages/core/src/stage.ts`：`StageGate.submit` 校验归属与字段（DC-36），第一次 Schema 失败写 `stage.rejected` 并允许修正，第二次把 Run 置为 `contract_violation`（`canTransitionRun` 校验）并写 `run.contract_violation`；接受时写 `stage_result` 行 + `stage.submitted`「结构化交付」证据。

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

## T9 待办

- 独立 Review 与 Test（独立上下文）、结算与 `docs/INDEX.md` 状态更新、以及 `docs/delivery/acceptance.md` 中本包 AC 的证据登记。
