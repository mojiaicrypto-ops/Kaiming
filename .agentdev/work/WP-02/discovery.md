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

- 事实：`attempt` 行与 `run.starting/running` 属 WP-05（RunnerSupervisor/监督）。但 T5 Join 与 T7 Stage 契约都需要「Run 已 running 且有 Attempt」的前置。
- 处理：`Orchestrator.beginAttempt(runId, {runnerId?})` 按 `queued → starting → running` 建 Attempt 行并写 `run.starting`/`run.running`；`settleRun(runId, status)` 只允许 `canTransitionRun` 允许的终态。心跳、租约、崩溃恢复、Attempt 证据不可改写仍属 WP-05，本包不做。
- 影响：WP-05 可在此之上实现监督；若 WP-05 改变建 Attempt 的入口，需同步本包测试。

## DC-34 profileRevision 采用「全局高位 + Project 低位」编码，过期即拒

- `DispatchSpec.profileRevision` 是单个非负整数，而配置有两个 scope；`layerRevision = global.version*1e6 + project.version`，任一 scope 变更都会改变该值（Project 写入不足百万次时无碰撞）。
- Orchestrator 在派发时比较 `spec.profileRevision` 与当前 revision，不一致直接 `VALIDATION_ERROR`（而不是静默按新配置运行），以保证「无隐式换模型」（AC-044）。Chief 通过 `currentProfileRevision(role)` 取值。

## DC-35 「Gate 阻断」以 Join 结果与 chief_action_required 表达

- 事实：文档要求 required 子 Run 失败时「Gate 阻断」，但当前 Schema 没有 Work 级 Gate 实体/enum。
- 处理：`JoinCoordinator.onChildSettled` 返回 `{kind:'blocked', failedRequired, children, chiefTodo}`，并写 `chief_action_required`（含全部子结果）；父 Run 停留在 `waiting_children`，以便新 Chief 消息可处理（AC-046）。不改 Work.status，避免发明未定义的状态语义。
- 影响：后续若引入 Gate 状态（WP-06/流程 Gate），应消费该返回值并新增 Discovery。

## DC-36 stage.submit 的归属字段与内容校验

- 归属字段（`id/projectId/version/createdAt/updatedAt/runId/attemptId/taskId`）由客户端提交时抛 `NOT_AUTHORIZED`（伪造归属是协议失败，不走「修正一次」路径）；未知字段走可修正的 Schema 拒绝。
- 行 Schema 含服务端列，直接校验客户端载荷会因缺列全部失败，故 `contracts` 新增 `stageResultContentSchema = stageResultRowSchema.omit(服务端列)`，Core 用它校验后再由仓储注入归属列。
- 修正计数由事件日志推导（`stage.rejected` 按 attemptId 计数），因此重启后仍然成立；第二次失败写 `run.contract_violation` 要求 `canTransitionRun` 允许，否则 fail-closed 报错而不是降级。
