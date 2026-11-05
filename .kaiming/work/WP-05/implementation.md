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

## T7 独立 Review Round 1 修复（W5R1-01…12）与验证

- Review 依据：`.agentdev/work/WP-05/review.md`（冻结点 `fc4072e`）。
- 修改范围：仅 `packages/core/src/context/**` 与 `packages/core/test/context-*.test.ts`（另加本 T7 记录）；未触碰其他包。
- 修复后 context 用例：ACL **49**、builder **34**、checkpoint **14**、cold-start **20**、ledger **35**、requirements **36**，合计 **188**（修复前 166，新增/改写净增 22 条回归用例）。
- 验证：`prettier --write` 全部 unchanged；`pnpm typecheck` EXIT 0；`pnpm lint` EXIT 0；`pnpm test:unit` **32 文件 / 619 用例** EXIT 0；`pnpm build` **10 workspace 全部 Done** EXIT 0。

### P1

#### W5R1-01 选择（Chief）是权威，`contextSources` 覆盖层不得改写声明身份
- 改动：`builder.ts` 的 `bondSource` 不再整体采用同 `kind:id` 的覆盖层句柄。新增 `overlayConflict`：对同一 ref 的 `version`/`path`/`hash` 与 selection 声明逐字段比对，任一不一致即返回 `VALIDATION_ERROR`（不调用 resolver、不落快照）；一致时覆盖层只允许补 `sender`/`artifactClass`/`ownedRunId`/`projectId`。`refFor` 与 `ResolvedSource` 的 `version`/`path` 一律以声明值优先；resolver 返回的 `version`/`path` 若与声明不一致同样拒绝（防止半读/错归属）。
- 回归：`context-builder.test.ts` 新增 `buildContext — the selection is the authority over its overlay (AC-030)`：`refuses an overlay that rewrites the declared path/version and freezes nothing`（旧行为会 resolve 并冻结 `revision-2/docs/OTHER.md`）、`keeps the declared revision and path when the overlay only adds metadata`（旧行为会因覆盖层无 path 而丢 path、解析错 blob）、`refuses an artifact overlay that names another version`。

#### W5R1-02 冷启动 corpus 读取必须解析 realpath 并留在项目根内
- 改动：`cold-start.ts` 新增 `corpusPathState`（对根与目标都 `realpathSync`，再以 `path.relative` 判包含）与 `denialRefForPath`。`TranscriptGuard.refusal` 与 `read` 对指向根外的符号链接返回 `CONTEXT_FORBIDDEN` 且**不返回任何 content**；根内普通文件仍可读，不存在的路径仍为 `NOT_FOUND`（保持既有负例语义）。
- 回归：`context-cold-start.test.ts` 新增 `refuses a corpus symlink that escapes the project root (W5R1-02)`：真实 `mkdtempSync` 目录 + `symlinkSync` 指向根外文件，断言 `readable=false`、`CONTEXT_FORBIDDEN`、无 content、失败串不含外部正文，并以根内正常文件作对照（`execution.md` §3 符号链接逃逸）。

#### W5R1-03 Chief 会话产物（decision/attachment/log/recovery）对下游阶段可读
- 改动：`types.ts` 新增 `CHIEF_SESSION_ARTIFACT_CLASSES`、`artifactReadRank`（Chief 会话类排在 `initialize` 之前，等价于所有阶段可读）与 `isFutureArtifact`；`acl.artifactClassesFor`、`requirements.referencesFutureArtifact`/`stagePrecedesArtifact` 统一改用 `isFutureArtifact`。未来 *pipeline* 产物（plan/review/test/verification/settlement…）仍受「阶段不得读自身未来产物」约束（AC-079）。
- 回归：`context-acl.test.ts` 新增 `lets a downstream stage read a Chief-session decision or attachment (W5R1-03)`（Product 从 decision 满足 `confirmedSource`；Developer 读 selected attachment）、`still refuses a future pipeline artifact to an earlier stage`；并把原单向包含断言改为等价的并集断言 `derives every declared artifact class from a legal stage (W5R1-03)`（旧实现对专业角色缺 decision/attachment/log/recovery，会失败）。

### P2

#### W5R1-04 扩展授权必须保留永久拒绝
- 改动：`ledger.ts` 新增 `coversPathRestrictions`/`coversDenials`；`grantExpansion` 在授予前要求 `deniedPaths` 与 `denied` 逐条（含 reason 相同）被 expandedScope 覆盖，否则 `VALIDATION_ERROR`，且拒绝时不改变 scope/预算。
- 回归：`context-ledger.test.ts` 新增 `refuses a grant that drops the permanent denials (W5R1-04)`：以 `{...scope, pathPrefixes:[''], deniedPaths:[]}` 请求授权被拒，随后 `append('.git/config')` 与 `append('node_modules/x/index.js')` 仍 `CONTEXT_FORBIDDEN`。

#### W5R1-05 补齐开发聊天/Transcript 路径标记
- 改动：`types.ts` 的 `DENIED_SOURCE_PATTERNS` 新增两条（`dev|develop|developer|development|agent` 前缀 + `chat|conversation|transcript`），覆盖 `docs/dev-chat.md`、`docs/developer-transcript.md`、`docs/dev-transcript.json`、`docs/developer-chat-log.md`、`dev-chat/` 目录等；普通源码 `src/developer-chat.ts`、`src/chat.ts` 仍可读。ACL、ledger、corpus guard 三处共用该表。
- 回归：`context-acl.test.ts`（deniedPaths 全角色拒绝 + `rejects the documented path markers…` 正负例 + `refuses the dev-chat markers for a role whose prefixes would admit it`）、`context-ledger.test.ts` `refuses the developer-chat/dev-transcript path markers (W5R1-05)`、`context-cold-start.test.ts` `refuses the dev-chat and developer-transcript path markers (W5R1-05)`。

#### W5R1-06 readBudget 必须落在 agents.md §6 的 4096–2000000 内
- 改动：`types.ts` 新增 `READ_BUDGET_MIN_TOKENS=4096`、`READ_BUDGET_MAX_TOKENS=2000000` 与单一校验器 `readBudgetValueError`（拒绝非整数、负数、1…4095、>2000000；**0 保留**为「本包不得携带任何内容/未授予追加读取」的显式预算，W5R1-07 与 ledger 的 `expansionTokens:0` 语义依赖它）；builder、`createReadLedger`、cold-start limits 全部改用该校验器，因此三处口径一致。
- 回归：`context-builder.test.ts` `refuses a budget outside the documented 4096–2000000 range (AC-036)`（4095 / 2000001 / 4096.5 / 1e15 / MAX_SAFE_INTEGER / 3e6 expansion 全拒，边界 4096 与 2000000 不报 VALIDATION_ERROR）、`context-ledger.test.ts` 扩充 `refuses invalid budget input when the ledger is created` 并新增 `accepts the documented budget boundaries and the explicit empty budget`、`context-cold-start.test.ts` `refuses cold-start limits outside the documented range (W5R1-06)`。
- 旧期望订正（说明）：旧测试用 7/16/100/140/260 等**低于配置下限**的预算来制造溢出，该期望本身不符合 `agents.md` §6，已改为合法上限（4096）+ 更大正文（`DUMP_BODY` 20 000 字符、ledger 首个读取 16 384 字符 = 4096 tokens、cold-start 用重负载投影）来制造真实溢出；断言随之调整。

#### W5R1-07 冷启动 seed 必须计入启动预算，0 预算封闭失败
- 改动：`cold-start.ts` 的 `admit` 改为返回 `{admitted,tokens,shortfall}`；固定规则与 Project 概览的准入结果被记录，任一未准入即返回封闭的 `{ok:false, code:'BUDGET_EXCEEDED', errors:[…]}` 并点名具体文档与 token 缺口（选择的方案：**不交付正文**，而不是把概览/规则降级为可选项），`tokenAccounting.initial.used` 与实际交付保持一致。
- 回归：`context-cold-start.test.ts` `charges the fixed seed against the startup budget and fails closed at zero (W5R1-07)`（`startupTokens:0` ⇒ `BUDGET_EXCEEDED`，失败串不含固定规则正文与概览正文；`coldStartAnswer` 同步封闭）；原 `reports a precise budget gap…` 改用重负载投影（`heavyProjection`）在合法上限 4096 下制造真实的部分预算缺口（旧用例 260 低于下限）。

#### W5R1-08 `rotateSession` 先校验后写入（原子性）
- 改动：`checkpoint.ts` 把「是否存在 Checkpoint」的校验移到 `runs.set` 之前；无 Checkpoint 时直接 `NOT_FOUND`，不再先把新 session 绑到 Run 上。
- 回归：`context-checkpoint.test.ts` `leaves the stored session unchanged when there is no checkpoint to rotate (W5R1-08)`：拒绝后 `runOf(runId).sessionRef` 仍为旧 session，并验证补上 Checkpoint 后轮换可正常成功。

#### W5R1-09 Checkpoint 不得声称其他 Work
- 改动：`save` 在写入前校验 `checkpoint.workId === run.workId`，不一致返回 `VALIDATION_ERROR` 且不落库（`context.md` §5「Checkpoint 仅来自当前 Run」）。
- 回归：`context-checkpoint.test.ts` `refuses a checkpoint that claims another Work (W5R1-09)`：`workId=WP-99` 被拒且 `load` 仍 `NOT_FOUND`，随后同一 Run 的 `WP-05` 可正常保存。

#### W5R1-10 端口抛异常一律收敛为封闭失败
- 改动：`builder.ts` 对 `gates.current`、`resolver.resolve`、`content.fetch`、`tokenCounter`、`now` 全部 try/catch，失败返回 `{ok:false, code:'INTERNAL_ERROR'}` 且错误信息不回传端口原始 message；`ledger.ts` 新增 `safeTokens`/`safeClock` 包裹计数器与时钟（且在校验/计费/变更前取值，保证拒绝无副作用）；`cold-start.ts` 包裹 `now`。快照 writer 的既有 catch 也改为不回传原始 message。
- 回归：`context-builder.test.ts` `closes a throwing resolver, content or gates port without freezing anything`（三端口抛异常、无快照、无 `secret-token`/`exploded` 泄漏）、`context-ledger.test.ts` `closes a throwing counter or clock instead of escaping (W5R1-10)`、`context-cold-start.test.ts` `closes a throwing cold-start clock instead of escaping (W5R1-10)`；并订正 writer 失败用例的旧断言（原文要求错误信息包含端口原始 `disk full`，与「不回传原始 message」矛盾，改为断言不泄漏）。

#### W5R1-11 legacy `codeRoot='.'` 视为整仓根
- 改动：`types.pathIsInsidePrefix` 与 `acl.pathInPrefix` 把 `'.'`/`'./'` 视为空前缀（整仓）；`acl.scopeFor` 新增 `rootPrefix` 把 codeRoot/documentRoot 的 `'.'`/`'./'` 归一为 `''`，避免 scope 里残留字面 `'.'`。
- 回归：`context-acl.test.ts` 新增 `context ACL — legacy whole-repository root (W5R1-11)`：`'.'` 根项目下 `src/orders/cancel.ts`、`packages/core/src/index.ts`、`docs/agentdev/PROJECT.md` 可读，同时 `.git/config`、`node_modules`、`dist`、`docs/dev-chat.md`、`docs/developer-transcript.md`、`transcripts/**` 仍被拒。

### P3

#### W5R1-12 冻结快照目录不可变（manifest 不被重写）
- 改动：`builder.ts` 的 `createSnapshotDirectoryWriter` 在 `manifest.json` 已存在时直接返回，不再用新 `createdAt` 重写；`snapshotRef` 仍排除 `createdAt`（身份 = 冻结了什么，不含何时冻结），`snapshot.createdAt` 仍是本次构建的时刻并已在注释中明确。
- 回归：`context-builder.test.ts` `leaves the frozen directory byte-identical when re-frozen under a different clock`：两次相同输入、不同时钟冻结，目录字节完全一致且 manifest 保留首次 `createdAt`，同时 `snapshot.createdAt` 反映第二次构建。

### 明确不处理（登记转交）

- **W5R1-13（reader-Run capability 绑定）**：按任务要求不实现，转 WP-01/WP-07（`CheckpointStore.load`/`save` 的 `runId` 需由 Run capability/epoch 注入并校验）。本轮只登记，不改代码。

### 本轮新增残余（承接而非静默）

9. **Checkpoint taskId 归属**：`save` 现校验 `workId`；`CheckpointRun` 不携带 Task 列表，因此「taskId 是否属于该 Work」无法在 Core 内存 store 判定，属 Work/Task registry（WP-08 接线）。
10. **extraTokens 上限**：`grantExpansion.extraTokens` 仍只要求非负整数（可为任意大小以放宽 token 上限，符合「扩展只能放宽」）；若需按 Profile/模型窗口设上界，属 WP-08/WP-09 的 Profile 注入。
11. **readBudget 上界的来源**：本轮采用 `agents.md` §6 的固定 4096–2000000；`min(Profile.contextLimit, 模型 contextWindow − maxOutput − 4096)` 的动态钳制仍需 Profile 输入（Review 建议方向），属集成包。
12. **内存 corpus `contents`**：`createTranscriptGuard` 的内存正文分支不做文件系统校验（无真实路径可校验）；真实目录分支已执行 realpath 包含性检查。

## T8 独立 Review Round 2 修复（W5R2-01…14）与验证

- Review 依据：`.agentdev/work/WP-05/review.md` 第 2 轮（冻结点 `3f02b4b`）。
- 修改范围：仅 `packages/core/src/context/**` 与 `packages/core/test/context-*.test.ts`（另加本 T8 记录）；未触碰其他包。
- 修复后 context 用例：ACL **50**、builder **45**、checkpoint **16**、cold-start **23**、ledger **36**、requirements **37**，合计 **207**（T7 为 188，新增 19 条回归用例）。
- 旧行为反证：把 `packages/core/src/context/**` 临时 stash 回 T7 版本后，本轮新增的 **18 条**行为回归用例全部失败（`Test Files 5 failed | 1 passed`，`Tests 18 failed | 189 passed`）；即每条修复都有能在旧实现上失败的回归测试。W5R2-12 无代码改动（见残余 13）。
- 验证：`prettier --write` 全部 unchanged；`pnpm typecheck` EXIT 0；`pnpm lint` EXIT 0（All matched files use Prettier code style）；`pnpm test:unit` **32 文件 / 638 用例** EXIT 0；`pnpm build` **10 workspace 全部 Done** EXIT 0。

### P1

#### W5R2-01 覆盖层不得新增 selection 未声明的 `path`/`hash`；声明 id 即读取目标
- 改动：`builder.ts` 新增 `STRICT_IDENTITY_KINDS=['git','policy','role_contract']`。`overlayConflict` 对这三类要求 `overlay.path === (source.path ?? source.id)`、`overlay.hash === source.hash`（未声明 hash 时覆盖层不得新增），任何不一致 ⇒ `VALIDATION_ERROR` 且不调 resolver、不落快照；`bondSource` 对严格类别只采用声明的 `hash`。`gatherSource` 同步收紧 resolver：严格类别下 `resolved.path` 也必须等于 `source.path ?? source.id`（`data.md` §1 的 `SourceRef.path?` 缺失时读取目标就是 `id`）。
- 回归：`context-builder.test.ts` 新 describe `the overlay may not introduce identity (W5R2-01, W5R2-14)`：`refuses a git overlay that adds a path the selection never declared`（旧行为把声明 `src/a.ts` 读成/冻结 `src/b.ts`）、`refuses a policy overlay that points a declared policy file elsewhere`（旧行为把 `docs/rules/agents.md` 读成 `docs/OTHER.md`）、`refuses an overlay hash the selection never declared`、`refuses a resolver that reads another path for a declared id`、对照 `accepts a matching overlay and freezes the declared bytes`（path/hash 与声明一致时成功且冻结声明字节）。

#### W5R2-02 覆盖层 `artifactClass` 必须与 `artifacts/<class>/` 路径一致
- 改动：`acl.ts` 的 `canRead` 在 artifact 分支先用 `artifactClassFromPath(path)` 推导路径类别；路径可推导出类别且与声明的 `artifactClass` 不一致 ⇒ `CONTEXT_FORBIDDEN`（无内容、resolver 调用前）；一致或未声明时仍按原规则过滤未来产物。原 `classOf` helper 被该逻辑取代并删除。
- 回归：`context-builder.test.ts` `refuses an artifact class that contradicts its blob path (W5R2-02)`（product:product 用 `artifactClass='explanation'` + `path=artifacts/plan/<id>`：`CONTEXT_FORBIDDEN`，artifact 未被 resolver/fetch 触达，无快照；老实的 `plan` 类别仍被拒）；`context-acl.test.ts` `refuses a declared class that contradicts the artifact blob path (W5R2-02)`（欺骗类别被拒、真实类别仍被拒、合法类别 `explanation` 与路径一致时放行、非 `artifacts/` 路径不做类别比对）。

### P2

#### W5R2-03 selection 声明的 `hash` 必须与解析/冻结内容一致
- 改动：`builder.ts` 的 `gatherSource` 在取得 `content` 后统一计算 `sha256(content)`：先比对 resolver 的 `resolved.hash`，再比对 selection 声明的 `source.hash`，任一不符 ⇒ `STALE_ARTIFACT`（不落快照）。`ref.hash` 与 `ResolvedSource.hash` 因此不可能互相矛盾。
- 回归：`context-builder.test.ts` 新 describe `the declared hash pins the frozen content (W5R2-03)`：`returns STALE_ARTIFACT when the resolved bytes differ from the declared hash`（resolver 自身 hash 与改动后字节一致，旧行为 `ok:true` 且 `ref.hash` 与 `hash` 矛盾）。

#### W5R2-04 调用方断言不得满足 artifact 类必需输入
- 改动：`requirements.ts` 新增 `isAssertableInputKey(key)`（catalog 中既无 `artifactClass` 也无 `pathPrefixes` 的键才可断言）；`builder.ts` 的 `availabilityOf` 只让可断言的 `contextInputs` 计入必需项表。artifact 类/路径类输入（`productDefinition`/`plan`/`projectOverview`/`roleContract`…）必须来自 resolved source。
- 回归：`context-builder.test.ts` `does not let an asserted artifact-backed input satisfy the table (W5R2-04)`（planning 仅 `contextInputs:['productDefinition','acceptance']` ⇒ `MISSING_CONTEXT` 点名 `productDefinition`、无快照；对照：提供真实 product 产物 + 断言 `acceptance` 仍成功）；`context-requirements.test.ts` `only lets a handle-less input be asserted by the caller (W5R2-04)`。

#### W5R2-05 `grantExpansion` 的 `extraTokens` 与扩展上限必须有界
- 改动：`ledger.ts` 的 `grantExpansion` 用共享 `readBudgetValueError` 同时校验 `extraTokens` 与增量后的 `expansionLimit`（0 或 4096–2000000 的整数），任一非法 ⇒ `VALIDATION_ERROR`，且在改动 scope/预算之前返回（请求保持 pending）。
- 回归：`context-ledger.test.ts` `refuses an expansion grant outside the documented token range (W5R2-05)`（`3_000_000`/`MAX_SAFE_INTEGER`/`2_000_000`（在 4096 基础上溢出）/`4_095`/`24`/`-1`/`1.5` 全拒且 usage/scope 不变、越界读取仍 `CONTEXT_FORBIDDEN`；对照：0 上限 + `2_000_000` 合法，上限恰为 2 000 000）。
- 旧期望订正（说明）：既有 `makes granted extra tokens usable…` 用 `extraTokens: tokensOf(second)=24`（低于 `agents.md` §6 下限）来制造“扩展后可用”，该期望本身与本轮新口径矛盾，已改为最小合法增量 4096，并同步修正 `usage().expansion.limit/remainingTokens`；`does not leak internal state…` 的 `extraTokens: 32` 一并改为 4096。两者仍计入原 619 用例。

#### W5R2-06 冷启动 answer 只报告已入选正文的 Feature
- 改动：`cold-start.ts` 的 `coldStartAnswer` 改为从 `selection` 中 `phase==='role_bodies'` 的条目派生 `selectedFeatureIds`/正文事实；被预算拒绝的 Feature 不进入 behaviour/entryPaths/knownGaps/attribution，其缺口已由 `admit` 记入 `excluded`/`unknowns`。约束事实仍来自已入选 Feature 的 `constrained_by` 关系。
- 回归：`context-cold-start.test.ts` `answers only from budget-admitted Features (W5R2-06)`：重负载 Feature 通过 `constrained_by` 进入选择（`constraints` 仍报告该约束），但其正文未入选 ⇒ 不输出它的当前行为/入口/差距/归属，且缺口被点名。

#### W5R2-07 Checkpoint resume 事实必须随 `current_work` 入选
- 改动：`cold-start.ts` 的 `admit` 返回值提升为 `positionAdmission`；`seed.domain` 的 `workId`/`taskId`/`resume` 只在 `current_work` 入选时携带，否则不交付（拒绝原因已在 `excluded`/`unknowns`）。
- 回归：`context-cold-start.test.ts` `does not deliver a budget-refused checkpoint resume position (W5R2-07)`：`nextAction` 20 000 字符 + `startupTokens:4096` ⇒ 无 `current_work` 选择项、`seed.domain.resume`/`workId` 均为 undefined，且缺口点名 `checkpoint:<runId>`。

#### W5R2-08 Checkpoint store 注入时钟封闭失败
- 改动：`checkpoint.ts` 新增模块级 `safeClock`；`save` 与 `rotateSession` 的时钟调用改用 `safeClock`，抛异常或非 UTC 返回值 ⇒ `{ok:false, code:'INTERNAL_ERROR'}`，不回传端口原始 message，且不写入任何状态。
- 回归：`context-checkpoint.test.ts` `closes a throwing store clock instead of escaping with its raw message (W5R2-08)`（save 封闭且无落库；`rotateSession` 无 `at` 时封闭且 session/updatedAt 不变）。

### P3

#### W5R2-09 “返回型” `INTERNAL_ERROR` 脱敏
- 改动：`builder.ts` 新增 `portMessage(code,message,internal)`；resolver/content/gates 返回 `INTERNAL_ERROR` 时替换为固定文案，业务码（`NOT_FOUND`/`STALE_ARTIFACT`/`CONTEXT_FORBIDDEN`）保留可诊断 message。
- 回归：`context-builder.test.ts` `redacts a returned INTERNAL_ERROR and keeps a business message (W5R2-09)`（resolver/content/gates 三处返回的泄露串均不出现在结果中；`STALE_ARTIFACT` 的业务 message 仍保留）。

#### W5R2-10 inline（`fetch.kind='none'`）内容必须校验 hash
- 改动：`gatherSource` 把 hash 校验移到 inline/fetch 分支汇合之后，inline 正文同样要求 `sha256(content)===resolved.hash`，否则 `STALE_ARTIFACT`；不再依赖 writer 兜底。
- 回归：`context-builder.test.ts` `refuses inline content that does not hash to the declared identity (W5R2-10)`（内存 writer 下也拒绝，无快照）。

#### W5R2-11 `rotateSession.at` 必须校验
- 改动：`checkpoint.ts` 先 `isTime(input.at)`，非法 ⇒ `VALIDATION_ERROR`；无 `at` 时走 `safeClock`。校验发生在 `runs.set` 之前。
- 回归：`context-checkpoint.test.ts` `refuses an unvalidated rotation timestamp (W5R2-11)`（'NOT-A-TIME'/日期/空串/数字全拒，session 与 `updatedAt` 不变；合法 `T1` 仍被记录）。

#### W5R2-13 预算缺口只登记一次
- 改动：`cold-start.ts` 删除 tier-5 `role_bodies` 未被入选时的第二次 `excluded.push`（`admit` 已按同一 ref 记录一次）。
- 回归：`context-cold-start.test.ts` `records each budget-refused source exactly once (W5R2-13)`（单 Feature 场景下 `excluded` 中 budget 项的 `kind:id` 无重复；多 Feature + `constrained_by` 场景当时仍可重复，T9/W5R3-03 已把该断言变为普遍成立）。

#### W5R2-14 重复覆盖层键必须拒绝
- 改动：`builder.ts` 构建 `fullSources` 时检测同 `kind:id` 重复，命中 ⇒ `VALIDATION_ERROR`（不再 last-wins），不调 resolver、不落快照。
- 回归：`context-builder.test.ts` `refuses duplicate contextSources keys instead of resolving last-wins (W5R2-14)`。

### 明确不处理（登记转交）

- **W5R2-12（命名式 transcript 路径网的固有上限）**：按任务要求不引入语义级聊天分类器；结构性防线（`kind=transcript` 全角色拒绝 + corpus allow-list + realpath 包含性）保持不变。`docs/my-dev-chat.md` 等未入表的名字仍是已知残余，见下方残余 13。

### 本轮新增残余（承接而非静默）

13. **Transcript 路径网仍是命名式（W5R2-12）**：`DENIED_SOURCE_PATTERNS` 只覆盖已文档化的命名族；任意改名（如 `docs/my-dev-chat.md`）仍可读，除非被 `kind=transcript` 或 corpus allow-list 截住。要彻底闭合需要内容头/来源元数据识别，属后续语义/DLP 能力，本轮不实现。
14. **`extraTokens` 与扩展上限的最终上界**：本轮只按 `agents.md` §6 的固定 4096–2000000 校验（含增量后的 ceiling），因此 T7 残余 10「`extraTokens` 可为任意大小」的说法自本轮起不再成立；`min(Profile.contextLimit, 模型 contextWindow − maxOutput − 4096)` 的动态钳制仍需 Profile 输入（WP-08/WP-09）。
15. **冷启动 `domainSummary` 的计费口径**：`summary` 由已入选的选择条目派生（未入选的 checkpoint 位置不再出现在其中），但其文本本身不单独计费；如需按 token 精确计账，属冷启动预算模型细化。

## T9 独立 Review Round 3 修复（W5R3-01…03）与验证

- Review 依据：`.agentdev/work/WP-05/review.md` 第 3 轮（冻结点 `909f95b`；R3.6 Findings W5R3-01/02/03）。
- 修改范围：仅 `packages/core/src/context/**` 与 `packages/core/test/context-*.test.ts`（另加本 T9 记录）；未触碰其他包。
- 旧行为反证：先写回归用例、后改实现；**6 条**新用例在未修复代码上全部失败（仅跑三个 context 文件：`Test Files 3 failed (3)`、`Tests 6 failed | 84 passed (90)`）——W5R3-01 两条（伪造 revision 被冻结、resolver 省略 revision 时冻结值缺失）、W5R3-02 三条（`save` / 注入时钟 / `rotateSession.at` 各一条）、W5R3-03 一条（同一 ref 在 `excluded` 出现两次）。
- 修复后 context 用例：ACL **50**、builder **47**、checkpoint **19**、cold-start **24**、ledger **36**、requirements **37**，合计 **213**（T8 为 207，新增 6 条回归用例）。

### P2

#### W5R3-01 selection 是 revision 的权威：resolver 返回另一 revision ⇒ 拒绝；声明值写入 ResolvedSource
- 改动：`builder.ts` 的 `gatherSource` 在原有 `version` 校验之后增加 `resolved.revision !== undefined && resolved.revision !== source.version ⇒ VALIDATION_ERROR`（位于 fetch、token 计数与冻结之前，与既有 `version`/`path` 校验同级）；新增 `frozenRevision(source, resolved)`：`git`/`policy`/`role_contract` 一律采用声明的 `source.version`（resolver 省略 `revision` 时也写入声明值），其余类别保留已证明等于声明的 resolver 值。`ResolvedSource.revision` 由此不可能与 `ref.version` 互相矛盾；`gatherResolved`（门禁内联角色契约，`revision` 为 policy revision）不走该分支，语义不变。
- 回归：`context-builder.test.ts` 新 describe `the selection is the authority over the frozen revision (W5R3-01)`：`refuses a resolver that advances the revision while returning the declared bytes`（resolver 返回声明字节与 hash、同时声称 `revision-2` ⇒ `VALIDATION_ERROR`、无 fetch、无快照；旧行为 `ok:true` 且快照自相矛盾）、对照 `freezes the declared revision when the resolver reports none`（resolver 省略 `revision` 时冻结值仍为声明的 `revision-1`；旧行为 `undefined`）。

### P3

#### W5R3-02 `isTime` 必须要求真实历法时刻
- 改动：`checkpoint.ts` 的 `isTime` 在 `TIME_PATTERN` 之后追加 `Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value`；一处修正即覆盖 `save`（`createdAt`/`updatedAt` 及 decision/approval/tool 时间）、`safeClock`（注入时钟）与 `rotateSession.at` 全部调用点。字形合法但月 13/日 45/时 99、`2026-02-30`、`9999-99-99`、`0000-00-00` 一律不再是有效 `Time`：显式入参 ⇒ `VALIDATION_ERROR`，注入时钟 ⇒ 封闭 `INTERNAL_ERROR`，且不落库、不绑定新 session。
- 回归：`context-checkpoint.test.ts` 新 describe `a stamp must name a real instant (W5R3-02)`：`refuses an impossible createdAt/updatedAt instead of persisting it`（四例 `VALIDATION_ERROR`，随后 `load` 仍 `NOT_FOUND`）、`closes an injected clock that returns an impossible instant`（`INTERNAL_ERROR`、无落库）、`refuses an impossible rotation stamp and keeps the previous one`（四例 `VALIDATION_ERROR`，session 与 `updatedAt` 保持 `T0`；合法 `T1` 仍被记录）。旧行为把四例全部接受并持久化。

#### W5R3-03 budget 排除记录按 ref 身份（`kind:id`）幂等并合并原因
- 改动：`cold-start.ts` 的 `admit` 新增 `budgetGapIndex`（`kind:id` → `excluded`/`unknowns` 首次写入位置）。同一 ref 被多个 tier 拒绝时不再二次 push，而是把后一条原因以 `；` 合并进首条（保留首条 ref 实例），并同步更新对应的 `unknowns` 行；`excluded` 条目仍逐条冻结，`unknowns`/`excluded` 的语义（每次拒绝都报告具体缺口）不变。
- 回归：`context-cold-start.test.ts` 新增 `duplicatedRefusalProjection()`（订单取消 Feature 的 `constrained_by` 关系体与其自身正文各 20 000 字，均超 4096 启动预算，取消文档因此在 tier-4 `related_constraints` 与 tier-5 `role_bodies` 各被拒一次）与用例 `records a shared budget-refused ref once and merges its reasons (W5R3-03)`：每个 budget 项的 `kind:id` 唯一、取消文档只有一条且原因同时含 `relation:F-1a2b3c4d->F-9e8d7c6b` 与 `git:features/F-1a2b3c4d/README.md`、`unknowns` 同 ref 仅一行且文本一致（失败信息会打印实际 `budget refusals` 键序列；旧行为该 ref 出现 2 次）。

### 记录订正

- T8 第 198 行原述「`excluded` 中 budget 项的 `kind:id` 无重复」在多 Feature + `constrained_by` 场景下不成立（review R3.6 记录核对）；W5R3-03 的修复已把该断言变为普遍成立，并在 T8 原文处补注单 Feature 的历史口径与 T9 指向。

### 验证

- `node_modules/.bin/prettier --write`：`builder.ts`/`checkpoint.ts`/`cold-start.ts` 与三个测试文件共 6 个文件全部 **unchanged**（无二次改动）。
- `pnpm typecheck`：**EXIT 0**（无输出错误）。
- `pnpm lint`：**EXIT 0**（`All matched files use Prettier code style!`）。
- `pnpm test:unit`：**32 文件 / 644 用例** 全过 **EXIT 0**（T8 为 638，+6）。
- `pnpm build`：**10 workspace 全部 Done**（contracts/domain/storage/workspace/knowledge/core/pi-runtime 与 apps/cli/daemon/runner）**EXIT 0**。
- 独立复跑第 3 轮 Review 探针（只消费重建后的 `packages/core/dist`，不 import 产品测试）：`/tmp/wp05r3/closure3.mjs` 151/151、`hunt3.mjs` 27/27、`ac3d.mjs` 72/72、`ac.patched.mjs` 90/90、`closure.patched.mjs` 218/218、`/tmp/wp05r2/fail4.mjs` 34/34，合计 **592/592** 通过，`gitvariant.mjs` 仍复现既定的 path 拒绝；即 R3 记录的 6 个失败断言（W5R3-01/02/03）全部转为通过（closure3 由 147/151 变 151/151，hunt3 由 26/27 变 27/27）。

### 本轮残余（承接而非静默）

16. **W5R3-01 的下游影响仍未量化**：`ResolvedSource.revision` 在工作包/账本落库路径上的实际消费属 WP-08/WP-09 接线后才可验证；本轮只保证冻结层内部一致。
17. **W5R3-02 只做历法校验**：`isTime` 现在拒绝不存在的历法时刻，但不做时区归一化（非 `Z` 偏移在正则阶段已被拒），也不接受闰秒 `:60`（符合 `data.md` §1 的毫秒 UTC 口径）。
18. **W5R3-03 的合并文本形态**：同 ref 的多条原因以 `；` 连接并保留首条 ref 实例；未评估真实两轮交付后的 `excluded` 规模分布（承接 R3.9 第 6 项）。
