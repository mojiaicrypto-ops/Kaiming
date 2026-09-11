# WP-04 实现记录（知识与新旧项目）

- planVersion: 1（`.agentdev/work/WP-04/plan.md`）
- 依赖：WP-01（数据/状态/协议核心）、WP-02（结算提交 `f9b61e0`）
- 基线：WP-03 结算提交 `5171ef2`（代码树 `7512159`）

## T0 工程脚手架

- 新增 workspace `packages/knowledge`（`@agentdev/knowledge`）与 `packages/workspace`（`@agentdev/workspace`）：`package.json`（`workspace:*` 依赖 `@agentdev/contracts`，workspace 另外依赖 `@agentdev/knowledge`）、`tsconfig.build.json`、空 `src/index.ts`。
- 根 `tsconfig.json` 的 `paths` 与 `vitest.config.ts` 的 alias 同步新增两个包；`pnpm-lock.yaml` 增加对应 link 记录。
- 影响：`pnpm build` 由 8 个 workspace 变为 **10** 个。

## T1 Feature 知识模型、Markdown 解析与校验（AC-040/AC-086/AC-042）

- `packages/knowledge/src/model.ts`：四组状态枚举（design/implementation/verification/investigation）、`RelationKind`、`FEATURE_FIELDS`/`FEATURE_FIELD_KEYS`、`FEATURE_SECTION_HEADINGS`、`RELATION_COLUMNS`、`EMPTY_VALUE_MARKERS`、多值拆分（分号）与空值标记（`无`/`未调查`）、`Feature`/`FeatureRelation`/`FeatureSections`/`FeatureFields` 类型、`FeatureDocumentError{code,message,field?}` 与 `knowledgeError`。
- `packages/knowledge/src/feature-format.ts`：`parseFeatureDocument(markdown,{relativePath,revision,codeTreeRevision?,knownIds?})` 以「首个标题 + 首个字段表 + 固定标题段」解析（不执行内联 HTML）；校验 `context.md` §2 全部规则：字段必填、`owner_document` 与本文件路径一致、枚举已知（否则 `KNOWLEDGE_INVALID`）、`design=confirmed` 需有效 decision/requirement confirmedDecisions 引用、`verification=passed` 需证据与覆盖范围非空且记录的 `revision` 与当前代码树一致、`investigation=investigated` 需 scope/source_refs 非空、空关系/入口必须字面写 `未调查`/`无`（空表是错误）、关系表必须恰为四列、模板占位值（`<真实ID>`、示例 id）无效。`parseFeatureSet` 逐文档报错并识别**跨文档重复 feature_id**（`KNOWLEDGE_INVALID`，绝不静默合并）。
- `packages/knowledge/src/relations.ts`：`resolveSourceRef(ref, ctx)` 解析 `git:<sha>:<path>` / `decision:<id>` / `artifact:<id>@<version>` / `requirement:<id>` / 裸仓库相对路径，返回 `{ok:true,kind,...}` 或 `{ok:false,code,reason}`；`diagnoseLinks(features, ctx)` 输出 `LinkDiagnostic{severity,featureId,field,message,blocksRequirement,ref?,targetFeatureId?}`，覆盖未解析关系目标/关系来源/design/evidence/source 引用、`design=confirmed & implementation=absent` 的差距（warning）与 observed 未确认（warning）。
- 回归网：`packages/knowledge/test/feature-format.test.ts`（43 例）、`relations.test.ts`（11 例）。

## T2 投影、缓存与 stale（AC-037/AC-040）

- `packages/knowledge/src/projection.ts`：`buildProjection({documents,revision,codeTreeRevision,knownIds?,documentRoot?,cache?,linkDiagnostics?})`。全部文档合法 ⇒ 发布不可变投影：一行索引（`用途` 首句 + 链接）、`features/README.md`、`PROJECT.md` 导航、`CODE_MAP.md`（汇总各 Feature 的「实现入口」）、关系图、每个 Feature 的渲染文档与内容哈希；任一文档非法 ⇒ **不发布**，经 `ProjectionCache` 取回上一版有效投影并标 `stale`（`state`/`staleSince`/`staleReason`，缓存行同步标 stale），返回 `{published:false,stale:true,diagnostics}`（全部 `KNOWLEDGE_INVALID`）。
- `ProjectionCache` 以 `(revision,featureId)` 为键（`data.md` §2 的 `feature_projection`），本包提供内存实现；SQLite 落地留 WP-08（Port 即接缝）。
- **断链接线（本次补）**：新增 `ProjectionBuildOptions.linkDiagnostics?: LinkDiagnosticsContext`，投影新增 `links: {diagnostics, blockedFeatureIds, deliveryBlocked}` 与 `deliveryBlockedByLinks(projection)`。断链不阻断发布（`断链为诊断`），仅当断链命中**当前需求**涉及的 Feature 时 `deliveryBlocked=true`（`影响当前需求则阻断相关交付`）。
- 回归网：`projection.test.ts`（11 例，含 stale 保留/清除、重复 ID 拒绝、缓存键、哈希漂移、断链门禁）。

## T3 三视图与差距（AC-037/AC-038/AC-042）

- `packages/knowledge/src/views.ts`：`queryFeatureView(projection,{featureId,view:'design'|'delivered'|'work',workOverlay?})` 返回严格分离的三视图（design=已确认意图；delivered=当前行为 + 约束 + 设计/实现/验证 + 已知差距；work=本 Work 覆盖层，标注 `notDelivered` 且不污染其他视图）；不复用旧决策引用、不回退为部分视图（错误即 `NOT_FOUND`/`VALIDATION_ERROR`）。`listGaps(projection)` 与 `observedVsConfirmed(features)` 输出已登记差距与 observed/confirmed 分歧（`mustNotAcceptObserved`）。
- 每个响应带 `sourceRevision`/`projectionState`/`current`/`unknowns`；stale 投影可读但 `current:false`。
- 回归网：`views.test.ts`（9 例）。

## T4 关系与来源诊断

- 见 T1 的 `relations.ts`；投影侧门禁见 T2。诊断 `blocksRequirement` 由调用方传入的当前需求 Feature 集合决定（未传则一律不阻断）。

## T5 工作区扫描、预算与候选知识（AC-026/AC-027/AC-042）

- `packages/workspace/src/git-port.ts`：`GitPort` 接口（`isRepository`/`resolveRoot`/`headRevision`/`statusPorcelain`/`initRepository`/`branchName`/`commit`/`trackedFiles`）+ `NodeGitPort`（`spawnSync('git',args)`，`shell:false`，显式参数）+ `MemoryGitPort`；`WorkspaceError{code,details}`、`runGit`、`parsePorcelainLine`、`sha256Hex`。
- `packages/workspace/src/scan.ts`：realpath + `git rev-parse --show-toplevel` 归一（同一仓库的不同子目录/符号路径 ⇒ 同一 Project，`projectId=sha256(canonicalRoot)[0:32]`）；嵌套仓库独立且父级不再遍历；排除 `.git`/`node_modules`/`vendor`/生成物（`dist|build|out|target|coverage`）/二进制；选择顺序 README → manifest → 构建测试入口 → 路由模型 →（最低优先）其他源文件；预算 **40 个正文文件 / 512 KiB**，命中即输出部分地图 + 显式未知且 `claimsFullUnderstanding:false`；索引上限 **10000** 条并分页（不计入正文预算）；候选 Feature 只记录观察事实（`design=unconfirmed`、`source_refs` 为 `git:<sha>:<path>`，无 revision 时 `file:<path>`），候选文档 PROJECT/INDEX/CODE_MAP/features/README 与每 Feature 文档均 `candidate:true`、`deliveryRef:null`、`updatesDeliveryRef:false`；`detectKnowledgeConflicts` 报告「代码与设计冲突」「实现未观察」等。
- 回归网：`scan.test.ts`（16 例，真实临时目录 + 真实 git）。

## T6 初始化状态机（AC-025/AC-028/AC-029）

- `packages/workspace/src/initialize.ts`：`Identifying→Mapping→Confirming→Writing→Ready`（+`Blocked`/`Failed`），`step()` 逐阶段推进并记录证据；`InitStateStore`（内存 + JSON 文件，原子写）；`FileSystemPort`（Node 实现 temp+fsync+rename / 内存实现）。
- Writing 逐文档写回执，重试时按**内容哈希**比对磁盘：一致 ⇒ `unchanged`（不重写），不一致 ⇒ `content-conflict`（报告 disk/candidate 哈希、停止、`resume` 拒绝直到显式处置），文件逐字节不变；脏工作区阻断交付启动并给逐路径哈希报告，只读调查在任何状态都可用；无 Git 目录调查可用、正式写入返回 `Blocked` + `GitInitializationRequest`（`NOT_AUTHORIZED`），经显式授权后 `git init` + 交付分支 `agentdev/main` + 空初始提交；设计/代码冲突阻断 Confirming 直到逐条用户决定；`evaluateReadyGate` 复核 Ready 最小门禁（入口文档按哈希在盘、能力或显式空项目、来源与未知、候选 Feature 可解析、无未决冲突、未触碰交付 ref）。
- 回归网：`initialize.test.ts`（11 例，真实临时仓库；覆盖**初始化中断**与**代码设计冲突**两条必需失败测试）。

## T7 可迁移需求池（AC-087/AC-088/AC-092/AC-093）

- `packages/knowledge/src/requirements-pool.ts`：`parseRequirementPool({repoRoot,...})` 与纯函数 `parseRequirementPoolInput`/`parseRequirementRecordInput` 读取 `.agentdev/requirements/<id>/{requirement.json,content.md}` + 池 `README.md`；`metadataHash`（JSON 字节）/`contentHash`（LF 归一正文）/`recordHash`（§6 组合公式）；正文版本标记 `<!-- record-version: N -->` 与 JSON `version` 一致性校验。
- 逐条诊断：缺 `requirement.json`/`content.md`、哈希不匹配、两文件版本不一致、目录名 ≠ id、重复 id、旧格式（`requirements/<id>.json` 与 `docs/agentdev/requirements/`）⇒ `LEGACY_REQUIREMENT_FORMAT`、被 Git 忽略 ⇒ `REQUIREMENT_PATH_IGNORED`（真实 `git check-ignore` + 规则匹配回退）、同版本异内容 ⇒ `REQUIREMENT_CONFLICT`；坏记录逐条报告且不删除/覆盖。
- `importRequirementPool({records,local,unresolvedIds?,commit?})`：纯函数、幂等（按 `recordVersion`+`recordHash` 判定），本机 `localVersion` 与记录版本分开；同版本异内容/旧版本/批内重复/无法读取 Git 记录逐条 `REQUIREMENT_CONFLICT`；Git 已前进而投影未刷新 ⇒ `stale_projection` 拒绝覆盖；修复 Git 后显式重新导入解除冲突。
- `importedHistorySummary` 暴露完成摘要、功能/代码引用、取消原因与归档前状态，标 `详细证据未迁移` 且 `countsAsLocalVerification:false`（AC-088）；`rebuildPoolReadme` 由记录重建 README（缺 README 不致命）。
- 回归网：`requirements-pool.test.ts`（25 例，真实临时目录与真实 git）。

## T8 验证与残余

- 契约命令（本记录时点）：`pnpm typecheck` 0；`pnpm lint` 0；`pnpm test:unit` **26 文件 / 415 用例**；`pnpm test:integration` 124；`pnpm build` **10 workspace**；`pnpm docs:check` ok。
- 已登记残余（供 Review/Test 判定，均为承接而非静默）：
  1. `feature_projection` 的 **SQLite 落地**与交付提交/CAS、候选文档结算留 WP-08；本包只有内存 `ProjectionCache` Port。
  2. 无 Git 目录的候选 `source_refs` 用 `file:<path>`，Git 初始化后不回填为 `git:<sha>:<path>`（如需，WP-08 重扫或结算时替换）。
  3. 扫描在选择顺序后追加了最低优先级的「其他源文件」层（否则仅有源码的旧项目无法产出可观察模块）；层内不挤占已登记层级预算，已在代码注释说明。
  4. 正式 Confirmed 文档只有在调用方给定可解析 decision id 时才判为 `design-code-conflict`，否则先由格式校验报 `invalid-document`（fail-closed，绝不静默信任）。
  5. Writing 的脏工作区门禁会过滤本次初始化自己写入的路径，避免批处理/恢复自锁；`checkDeliveryReadiness` 保持不过滤。
  6. 真实 Provider 纵向、HTTP/WS 接线（`project.initialize` 等）、Docker 集成、Artifact 持久化不在本包。

## T9 独立 Review 第一轮与修复（根级项目 Ready 死锁 + 摘要截断）

- 第一轮独立 Review 判 **FAIL**（0×P0、1×P1、1×P2、4×P3）。P1（W4R1-01）：`moduleKeyOf` 对根级文件返回 `null`，而 `emptyProject` 以 `indexTotal===0` 判定，于是「有文件但无模块能力」的项目既不算「有能力」也不算「明确空项目」，Ready 门禁两个分支同时为假，`step` 永久 `failed/ready-gate`（三种形状 3/3 复现：`README+main.ts`、`README+main.py+test_main.py`、仅 `README.md`）。
- 修复：
  1. `moduleKeyOf` 对根级文件返回新的 `ROOT_MODULE_KEY='root'`（根级文件同样是可观察能力，归入 `root` 模块）。
  2. `emptyProject` 改判为「**未观察到任何候选 Feature**」而非「索引为空」；索引非空但没有可确认能力时，显式记一条「观察到文件但未识别出可确认能力 ⇒ 明确空项目」的观察，PROJECT 候选仍写 `absent`。这样三种根级形状都能走完 `Identifying→…→Ready`，仅 README 的项目按「明确空项目」通过最小门禁。
  3. W4R1-02（P2）：`firstSentence` 的句末判定改为「CJK/全角终止符，或**后接空白/结尾的 ASCII 句点**」，`支持 v1.2 语义与 .ts 扩展名。…` 不再被截断为 `支持 v1`。
  4. W4R1-06 的 fail-open 面：六段固定小节改为**只认二级标题**（`## 用途`），一级标题不再满足格式要求。
- 回归网：`packages/workspace/test/initialize.test.ts` 新增 3 例根级形状（两种有代码 + 仅 README，均须到达 Ready 且 `verifyReady` 通过）；`packages/knowledge/test/projection.test.ts` 新增 1 例摘要截断；`feature-format.test.ts` 新增 1 例一级标题不满足小节。
- 验证：`pnpm typecheck` 0；`pnpm lint` 0；`pnpm test:unit` **26 文件 / 420 用例**；`pnpm test:integration` 124；`pnpm build` 10 workspace。
- 承接（第一轮 P3，均为非阻断，登记如下）：
  1. **W4R1-03**：`plan.md` §5 承诺的 WP-04 端到端集成演练（真实文件系统 + SQLite + 临时 Git 仓库的「扫描 → 候选 → 写入 → 投影 → 查询」串联、需求池 Clone 导入演练）尚未落地，现有 `packages/core` 的 `requirements.integration.test.ts` 走的是 `RequirementProjection` 而非需求池路径。该演练与正式提交/CAS 一并留 WP-08（与 `plan.md` §1 的「正式 Git 提交与初始化写入的最终事务由 WP-08/WP-10 验证」一致），Test 须列入 `not_covered`。
  2. **W4R1-04**：用错处置 API（例如对 `confirmation-required` 调 `resolveConflict`）会把记录写成 `failed/internal`；专用 API 仍可恢复。属调用方误用，登记为已知口径。
  3. **W4R1-05**：`requirement:<id>@<version>` 只校验 id 存在性，不校验版本存在性（需求记录版本信息在需求池侧，WP-05 消费时按 `recordVersion` 复核）。
  4. **W4R1-06 残余**：目录符号链接在索引里记为 `kind:'file'`、池根散落的 `requirement.json` 无专用诊断（不产生错误行为，登记待 WP-08 扫描器增强）。

## T10 独立 Review 第二轮与修复（预算耗尽≠空项目）

- 第二轮独立 Review 判 **FAIL**（0×P0、1×P1、1×P2、3×P3）：T9 的根级修复成立（六种形状全部 Ready），但 `emptyProject = features.length===0` 引入同类新 fail-open。
- **W4R2-01 [P1]**：默认预算下的 41 包 monorepo（正文预算 40 全被 README 占满、84 项跳过、`features=0`）被判为 `emptyProject=true`，**无任何 blocker 直达 Ready**，PROJECT.md 写「absent（未实现，明确空项目）」，等于把「预算耗尽、未知」谎称为「确认无能力」。
  修复：
  1. `emptyProject` 改判为 `features.length === 0 && !scan.partial`（只有**完整**扫描一无所获才算可信的空项目），并新增 `partialWithoutCapability` 字段。
  2. 新增 `InitBlocker` 种类 `investigation-budget`（错误码 `MISSING_CONTEXT`）：Confirming 阶段在 `featureCount===0 && !emptyProjectConfirmed` 时阻断，且**重复 step 不会自行通过**（无用户动作不可解）。
  3. 新增两条可处置 API：`investigateMore(id,{maxBodyFiles?,maxBodyBytes?})`（记录 `budgetOverride`，回到 Mapping 以扩大后的预算重扫）与 `confirmNoCapability(id,{authorizationRef,by,note?})`（用户显式确认项目确无能力）。
  4. Ready 门禁的能力分支改为 `featureCount>0 || (emptyProject && emptyProjectConfirmed)`，并更新 detail 文案；`confirmNoCapability` 同时置 `emptyProject=true`、`emptyProjectConfirmed=true`。
  5. 候选 PROJECT.md 措辞三分：有能力 ⇒ `partial（观察到代码，未经确认）`；完整扫描无能力 ⇒ `absent（未实现，明确空项目）`；预算耗尽未确认 ⇒ `未调查（预算耗尽的扫描未观察到能力，尚不能断言项目为空）`（不再写 absent）。
- **W4R2-02 [P2]**：`ROOT_MODULE_KEY` 由 `'root'` 改为 `'(root)'`——括号不可能出现在被扫描的路径键里，因此不会与真实顶层 `root/` 目录合并成一个（虚假）能力。
- **W4R2-03/04 [P3]**：`moduleKeyOf` 返回类型收紧为 `string`（删除已死的 `null` 分支与调用点 `?? null`）；`firstSentence` 跳过「单字母缩写后的句点」（`见 e.g. 说明`、`Use e.g. this form.`），并删掉归一化后不可达的 `\n` 分支。
- **W4R2-05**：T8 残余 3 的措辞随 T9/T10 更新（根级文件现归 `(root)` 模块；其余残余见 T9 承接列表）。
- 回归网：`initialize.test.ts` 新增 2 例（41 README 无代码 ⇒ `investigation-budget` 阻断、重复 step 仍阻断、`confirmNoCapability` 后 Ready 且 PROJECT 不写 absent；41 README + `src/mod.ts` ⇒ 扩大批次后观察到能力、走确认流程到 Ready）；`projection.test.ts` 新增 1 例缩写句点。
- 验证：`pnpm typecheck` 0；`pnpm lint` 0；`pnpm test:unit` **26 文件 / 423 用例**；`pnpm test:integration` 124；`pnpm build` 10 workspace。
