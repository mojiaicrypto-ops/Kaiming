# WP-05 实现记录（Context隔离与冷启动）

- planVersion: 1（`.agentdev/work/WP-05/plan.md`）
- 依赖：WP-02（`f9b61e0`）、WP-04（结算 `ce8c64d`，代码树 `88a5690`）
- 实现位置：`packages/core/src/context/**`（Core 允许依赖 domain/storage/knowledge/workspace，符合 `ARCHITECTURE.md` §2）

## T1 共享类型、角色 ACL 与阶段必需项表

- `context/types.ts`：`ContextRole`（8 角色）、`ContextStage`（13 个规范阶段 + `normalizeContextStage` 别名）、`SourceKind`（git/artifact/policy/role_contract/knowledge/transcript/message）、`SourceRef`/`ContextSourceRef` 双向转换、`ReadScope`（pathPrefixes/artifactClasses/messageClasses/sourceKinds/denied/deniedPaths/writePaths）、`ResolvedSource`（ref/kind/id/path/revision/version/hash/bytes/reason，**不含 content 字段**）、`ExcludedSource`/`ContextUnknown`/`ContextRequest`/`ContextSnapshot`/`ContextGap`/`ContextError`/`TokenAccounting`、`CONTEXT_INPUT_KEYS`、`ARTIFACT_PRODUCER_STAGE` + `PIPELINE_ORDER`（阶段不能读自己的未来产物）、transcript 拒绝清单 `DENIED_SOURCE_PATTERNS`/`isDeniedSourcePath`。
- `context/acl.ts`：`ROLE_STAGES`、每角色的 artifact/message 类别矩阵、`STAGE_ACCESS`、`ROLE_STAGE` 读写前缀、`DENIED_PATH_MARKERS`；`scopeFor(role,stage,project)` 冻结返回 `ReadScope`；`canRead(...)`/`explainDenial(...)` 的拒绝顺序为**跨 Project → 来源类别 → 路径逃逸/transcript 标记/永久拒绝前缀 → 其他 Run 的 Session/Checkpoint → artifact 类别（未来产物）→ message 类别**。
  - AC-033：transcript 对**所有角色**拒绝（更严于「Reviewer 不可读」）；`review`/`test` 连 message 正文也不可读；`.agentdev/**/chat*`、`transcript*`、`conversation*` 按路径标记一律拒绝，且 `ResolvedSource` 结构上不含正文，聊天内容不可能进入任何 Context 对象。
  - AC-034：跨 Project 在任何路径/类别判断之前拒绝（`CONTEXT_FORBIDDEN`，消息点名另一个 projectId，绝不带内容）。
- `context/requirements.ts`：`INPUT_CATALOG` + `CONTEXT_REQUIREMENTS`（19 个合法 role:stage，逐项 required/optional/allowedAbsent/notApplicable 与 `oneOf` 组），`evaluateRequirements({role,stage,available})`、`selectionGaps(selection)`、`availabilityFromSelection`、`inputKeyForSource`、`referencesFutureArtifact`/`stagePrecedesArtifact`。
  - AC-079 四正例：空项目启动 initialize（`BootstrapObservation` 满足 oneOf）、同一项目跑 Product、有 ProductDefinition 跑 Planning、只有 CompactPlan 跑 L1 Develop；负例：Planning 缺 ProductDefinition、L2 Develop 缺 Plan、Test 缺有效 Review、Settlement 缺最终验证结果 ⇒ `MISSING_CONTEXT` 并给出精确 `input` 键；未来产物进入 `allowedAbsent`，绝不阻断。
- 回归网：`packages/core/test/context-acl.test.ts`、`context-requirements.test.ts`。

## T2 ContextBuilder 与不可变 Snapshot 冻结

- `context/builder.ts`：`buildContext(input)`，端口 `SourceResolverPort`/`ContentFetchPort`/`ContextGatesPort`/`SnapshotWriterPort`（含 `createSnapshotDirectoryWriter`），默认 token 估算为「字符数/4」（已文档化）。顺序：校验选择（goal/每条 reason/预算完整性）→ **ACL 授权（先于任何 resolver 调用）** → 解析（git path+revision / artifact id@version / policy revision / role contract，缺失 `NOT_FOUND`、过期版本 `STALE_ARTIFACT`）→ 预算扣减与丢弃记录 → 必需项评估 → 冻结内容寻址快照目录 → 返回 `{ok:true,snapshot,usage,directory}` 或封闭失败。
- AC-030：`ContextSnapshot` 记录 selection、每源 path/ref/hash/bytes/revision/reason、excluded、unknowns、policy/config hash、`readScopeDigest`、`createdAt`、`tokenAccounting`；`snapshotRef = sha256(canonicalJson(identityPayload))`，目录 `snapshots/context/<ref>/<hash>` 带 manifest；相同输入重复冻结幂等（换时钟结果不变）。
- AC-031：真实缺上游输入 ⇒ `MISSING_CONTEXT` 列出输入键，**不冻结任何快照**，且不解析相邻模块。
- AC-036：被预算挡下的**必需**源 ⇒ `BUDGET_EXCEEDED`（点名 dropped ref 与 token 缺口）；可选超限源被丢弃但整包仍可冻结，同时进入 `excluded`/`unknowns`；非法预算上限 ⇒ `VALIDATION_ERROR`。
- Snapshot 失效（必需失败测试）：源文件被编辑后重建 ⇒ `STALE_ARTIFACT`，而**已冻结目录与其字节完全不变**。
- 回归网：`packages/core/test/context-builder.test.ts`（28 例）。

## T3 read ledger、封口与预算

- `context/ledger.ts`：`createReadLedger({runId,role,stage,scope,budget,revision?,tokenCounter?,now?})`。
  - AC-032：`append({path,reason,content,revision?})` 先按 `acl.canRead` 校验 readScope，再要求 reason；记录 `{seq,path,revision,hash,bytes,consumedTokens,remainingTokens}`；seq 从 1 递增、只追加（无更新/删除 API）；越界 `CONTEXT_FORBIDDEN`，缺 reason `VALIDATION_ERROR`。
  - AC-036：先扣 initial 再扣 expansion；不足 ⇒ `BUDGET_EXCEEDED`（点名 path、所需 token、剩余 token）且**不追加**；`requestExpansion` 记录有理由的 `context.request`（pending），`grantExpansion` 授权后 readScope 必须为**超集**且同 Project，额外 token 才可用；拒绝的请求不改变任何 scope/token/entries。
  - AC-085：`seal()` 输出 `{seq,hash}`，哈希输入已固定并文档化（`acc0 = sha256("agentdev.read-ledger.seal.v1")`，`accᵢ = sha256(canonicalJson({prev,seq,path,revision,hash,reason,bytes}))`）；封口后任何 append/expansion ⇒ `INVALID_STATE`（提交后再读被拒）；`verifySeal({seq,hash})` 对旧 seq 或错误 hash ⇒ `STALE_ARTIFACT`（格式非法/超范围 ⇒ `VALIDATION_ERROR`）；重复 seal 幂等；空账本 seal 为 seq 0。
  - `entries()`/`usage()`/`sealedBinding()`/`readScope()`/`expansions()`/`identity()` 返回冻结深拷贝，外部修改抛错且不改写账本。
- 回归网：`packages/core/test/context-ledger.test.ts`（31 例）。

## T4 Checkpoint 与会话轮换

- `context/checkpoint.ts`：`Checkpoint` 字段严格对应 `context.md` §5（workId/taskId?/stage/有效 Manifest/pendingDecisions/artifactRefs/lastToolOutcome/nextAction/recentMessages）+ 归属身份（runId/projectId/role/sessionRef）+ 显式 `approval` 与 `sourceRefs`；`createCheckpointStore()`（内存实现，身份为 `checkpointHash`，对应 `attempt.checkpoint_ref`）。
  - `saveCheckpoint` 对携带**其他 Run 事实**的检查点 ⇒ `CONTEXT_FORBIDDEN` 且不落库；`loadCheckpoint` 对外来 Run（`NOT_FOUND`）、外来 Project/Work、Reviewer/Test 角色（`CONTEXT_FORBIDDEN`）**不返回任何内容字段**。
  - AC-035：`rotateSession` 保留 role/task/stage/nextAction/权限/来源/approval，只重写物理 session；`compactCheckpoint` 只裁剪最旧的 message refs，manifest/decisions/approval 逐字段不变；`summaryOf` **结构上没有 approval 字段**，因此「旧摘要改动批准状态」不可表达。
- 回归网：`packages/core/test/context-checkpoint.test.ts`（12 例）。

## T5 冷启动装配与固定样例

- `context/cold-start.ts`：`assembleColdStart({projection,query,limits})` 产出种子（Chief 固定规则 ref → `docs/rules/agents.md`、Project 概览、当前领域摘要 + 可选 Checkpoint 恢复位）与**有序、逐条有 reason** 的选择（role_contract → project_overview → current_work → feature_navigation → related_constraints → role_bodies）；`coldStartAnswer(...)` 返回 `selectedFeatureIds`、`currentBehaviour`、`constraints`（来自 `constrained_by` 关系，带声明 Feature 与来源）、`entryPaths`（生产/测试分开）、`knownGaps`、归因、token 用量与 excluded。
  - 固定样例（订单/支付/会话三 Feature + 关系 + 两次交付的正文）能召回当前取消行为、支付约束、相关测试路径（`tests/orders/cancel.test.ts`）与已知差距；**20 份无关文档全部进入 excluded**、未被选中、其正文不计入预算。
  - transcript 守卫双重把关（ACL readScope **且** corpus 允许清单）：开发聊天 transcript 既不入选也不可读（`CONTEXT_FORBIDDEN`、无内容），把它放进语料前后答案逐字节相同（误导结论不影响结论）。
  - Core 不依赖 `@agentdev/knowledge`（不在 core 依赖里），因此冷启动声明**结构化投影子集** `ColdStartProjection` 并在运行时校验；测试证明真实 `buildProjection()` 结果可直接赋值消费。
- 回归网：`packages/core/test/context-cold-start.test.ts`（15 例）。

## T6 验证与本轮订正

- 契约命令（本记录时点）：`pnpm typecheck` 0；`pnpm lint` 0；`pnpm test:unit` **32 文件 / 597 用例**；`pnpm build` **10 workspace**；`pnpm docs:check` ok。
- 本轮由集成方（T6）订正的 lint 问题：`context/builder.ts` 的多余类型断言、`context-builder.test.ts` 的未用常量/局部与多余断言（共 5 项），现全部为 0。
- 已登记残余（供 Review/Test 判定，均为承接而非静默）：
  1. **NOT_FOUND 归属**：ACL 只回答「拒绝」（`CONTEXT_FORBIDDEN`/`VALIDATION_ERROR`）；跨 Project 亦可由 resolver 报 `NOT_FOUND`。Builder 已实现解析层 `NOT_FOUND`。
  2. **message 类别口径**：`transcript` 对所有角色拒绝；`message`（用户请求）对 review/test 拒绝、对 chief/product/planning/backend/frontend/settlement 可读（用于满足「用户问题」必需项）。若产品口径更严（仅 Chief 可读 message），是一行矩阵改动。
  3. **ledger revision**：`createReadLedger` 接受可选 `revision`，`append` 可逐条覆盖；两者都缺时记空串。集成时必须传入 Work/Task 冻结 revision。
  4. **计费顺序**：先 initial 后 expansion（已固定并测试）。
  5. **Checkpoint 持久化**：目前为内存 store；`attempt.checkpoint_ref`/`session_ref` 与 `snapshot(type='checkpoint')` 的落库属集成包。
  6. **容器/挂载负例**：AC-033/AC-034 的容器级隔离与挂载负例属 WP-07；本包证明 **API/身份边界**。
  7. **接线**：Builder 的 `snapshotRef` 与 `SnapshotWriter.freeze('context', …, {identityPayload})`、`stage_result.read_ledger_seq/hash` 的封口绑定、冷启动接入真实 Conversation/Chief，均属集成/HTTP 包（WP-08/WP-09）。
  8. **冷启动检索**：CJK 二元组 + 停用词的确定性打分（保守、无嵌入/BM25）；真实两轮交付后的端到端路径属 WP-08/WP-10。
