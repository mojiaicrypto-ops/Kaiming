# WP-01 独立 Review

- 复核对象：commit `c3a581ffacf588c56754c505ca16dfd83c79174f`，tree `196f56ffa6a28ae0ca844acfb5c4e76f1df017e6`（已用 `git rev-parse HEAD^{tree}` 核对一致）
- 基线：WP-00 `79d5895`
- Reviewer：独立上下文，未读取任何开发聊天；只读仓库与本文档列出的命令
- 复核日期：2026-09-11

## 复核范围与方法

读取（review 输入）：

- `.agentdev/work/WP-01/plan.md`、`.agentdev/work/WP-01/implementation.md`
- `docs/architecture/{data.md,protocol.md,reliability.md,ARCHITECTURE.md}`、`docs/rules/workflow.md`、`docs/delivery/{implementation.md,acceptance.md}`、`docs/product/requirements.md`、`docs/INDEX.md`、`AGENTS.md`
- 代码：`packages/contracts/src/{primitives,enums}.ts`、`packages/contracts/src/entities/*.ts`、`packages/domain/src/*.ts`、`packages/storage/src/*.ts`、`packages/core/src/*.ts`
- 测试：`packages/contracts/test/entities.test.ts`、`packages/storage/test/{migrations,ledger}.integration.test.ts`、`packages/core/test/{mailbox,auth,dispatcher.integration,events-hub.integration,identity.integration,requirements.integration}.test.ts`、`packages/domain/test/domain.test.ts`
- Diff：`git show --stat c3a581f`、`git diff --stat 79d5895..c3a581f`、`git diff 79d5895..c3a581f -- <逐文件>`
- 未执行 `pnpm test:integration`（按任务约定由 Test 角色执行）

执行的命令与退出码：

| 命令 | 退出码 | 结果 |
|---|---|---|
| `git log --oneline -5` / `git status --short` / `git rev-parse HEAD^{tree}` | 0 | 工作区干净；HEAD=复核对象；tree 一致 |
| `pnpm typecheck` | 0 | `tsc -p tsconfig.json` 无错误 |
| `pnpm lint` | 0 | 格式检查通过 |
| `pnpm docs:check` | 0 | 15 documents / 55 internal links / 94 acceptance cases / 9 requirements / 11 work packages |
| `pnpm test:unit` | 0 | 13 文件 / 173 用例通过 |
| `rg`/`grep` 只读检索（事务、路径、分页常量） | 0/1 | 见证据节 |

## 结论

**FAIL**

理由：存在 2 项 P1（RE-01、RE-02）在复核时仍未修复，均落在 WP-01 的 T8 交付物与 AC-092 上，且实现记录中的对应声明与代码不符。P2 中 RE-03/RE-04/RE-05/RE-06/RE-07/RE-08 为契约或实现记录层面的开放问题，需在结算前处置或明确移交。工作包整体结构、事务边界（dispatcher 侧）、迁移、订阅水位与背压的实现质量较高，测试非空泛。

## 发现

| id | severity | target | 描述 | 证据 | status | blocking |
|---|---|---|---|---|---|---|
| RE-01 | P1 | task T8 / AC-092 | `requirement.portableRef.path` 默认值为 `requirements/<id>/requirement.json`：既指向**单文件**而非需求目录，也缺少仓库根的 `.agentdev/` 前缀。文档明确：`data.md` §6「portableRef.path为目录而非单文件」；`requirements.md` §6「portableRef.path指向需求目录」；§1「固定保存于仓库根目录 `.agentdev/requirements/<requirement-id>/`」。实现记录还把该偏差错误地引用为 `requirements.md` §4 的“Git 位置语义”。 | `packages/core/src/requirements.ts:27-28`（`requirements/${id}/requirement.json`）、`:206`（默认填充）；`packages/core/test/requirements.integration.test.ts:99`（测试把错误值固化为期望）；`docs/architecture/data.md:104`；`docs/product/requirements.md` §1/§6；`.agentdev/work/WP-01/implementation.md:138` | open | yes |
| RE-02 | P1 | task T8 / reliability §1 | `RequirementProjection.import` 的类注释声明「Every write happens inside one transaction」，但代码没有使用任何事务：领域行 `insert`/`update` 与随后的 `events.append` 是两条各自提交的语句。进程在两者之间崩溃会留下“有投影行、无事件”的半写状态；重试因 `classifyImport` 返回 `unchanged` 而提前返回，事件永久缺失。违反 `reliability.md` §1 的原子边界与 AC-092 的事件证据要求。 | `packages/core/src/requirements.ts:76-77`（声明）、`:143-149`（insert + append）、`:160-166`（update + append）；全仓 `withTransaction` 仅 `packages/core/src/dispatcher.ts:261` 一处（`grep -rn "withTransaction\|transact(" packages/core/src`） | open | yes |
| RE-03 | P2 | contracts / migration（data.md §2） | `assessment` 行未被声明为不可变。`data.md` §2 对 assessment 标注「不可变，每次重评新行」，但 `UPDATE_BLOCKED_TABLES` 只含 `event/snapshot/user_action`，无 `assessment` 触发器；方案注释亦未把 assessment 计入不可变集合。 | `packages/storage/src/schema.ts:58-61`、`:456-476`；`packages/storage/test/migrations.integration.test.ts:350-391`（仅断言 event/snapshot/user_action）；`docs/architecture/data.md:25` | open | no |
| RE-04 | P2 | task T3 / AC-065 | `data.md` §5「启动持有Project锁，备份后事务执行」中的“备份”仅在调用方显式传入 `backup` 回调时发生；唯一生产入口 `ProjectStore.open` 传 `options.migrations ?? {}`，默认启动路径迁移前不备份。机制本身已实现且有测试，缺的是默认接线（应由 WP-09 daemon 提供备份目标）。 | `packages/storage/src/store.ts:159-173`；`packages/storage/src/migrations.ts:135-139`；`packages/storage/test/migrations.integration.test.ts:165-182`；`docs/architecture/data.md:90` | open（移交 WP-09） | no |
| RE-05 | P2 | task T8 / AC-092（跨服务器部分） | `metadataHashOf` 对解析后的对象做规范化再序列化后取 Hash，而 `requirements.md` §6 定义 `metadataHash` 为**requirement.json 实际文件字节**的 Hash。二者在文件格式（键序/空白）非规范化时会不同，导致 recordHash 与跨服务器/`expectedRecordHash` 比较不一致。本仓库内自洽，故本地冲突判定可用；Git 往返属 WP-04/WP-08。 | `packages/core/src/requirements.ts:61-63`（`sha256(canonicalJson(metadata))`）、`packages/storage/src/ids.ts:58-60`；`docs/product/requirements.md` §6 | open（移交 WP-04/WP-08） | no |
| RE-06 | P2 | task T2 / workflow.md §5.2 | `TASK_TRANSITIONS` 缺少 `review→develop` 与 `test→develop`。文档：「Review或Test失败返回develop；修复后重新独立Review」。文件注释也自称“Review/Test failure … return to ready/develop”，与表实际内容不符；domain 测试未覆盖失败返工路径。 | `packages/domain/src/transitions.ts:42-49`、`:47`（注释）；`packages/domain/test/domain.test.ts:110-117`；`docs/rules/workflow.md:51` | open | no |
| RE-07 | P2 | task T7 / AC-078 | `installation credential` 的“只显示一次”在重载路径被绕过：文件已存在时 `loadOrCreate` 仍把文件中的 token 赋给实例私有字段，因此 `credential.revealOnce()` 在每次进程启动后都会返回安装凭证。`AuthService.createdToken` 语义正确，但 `credential` 是公开只读属性，仍构成一次性显示契约的旁路。测试只断言了 `createdToken` 为 undefined。 | `packages/core/src/auth.ts:146-165`；`packages/core/test/auth.test.ts:47-52`；`docs/architecture/protocol.md:17` | open | no |
| RE-08 | P2 | task T5 / protocol §1 | 分发器未实现「Project方法必填projectId」：`envelope.projectId` 缺省时直接按本 Project 处理，且 `OperationDefinition` 没有 global/project 区分位，无法在方法级强制。当前无任何真实协议方法注册（属 WP-09），影响被推迟。 | `packages/core/src/dispatcher.ts:165-169`；`docs/architecture/protocol.md:11` | open（移交 WP-09） | no |
| RE-09 | P2 | document（implementation.md） | 实现记录自相矛盾：§1 已标 T6/T7/T8 完成，§2 与文件末行仍写「T6/T7/T8 尚未完成」「EventHub、连接认证与 Project 身份（T6/T7）尚未实现」。结算依据若直接采信该记录会误判范围。另 T1 处称 entities 测试“11 用例”，实测 12 用例。 | `.agentdev/work/WP-01/implementation.md:18`、`:111-117`；`packages/contracts/test/entities.test.ts`（3 + 9 = 12 it） | open | no |
| RE-10 | P3 | task T5 | 冗余死代码：`return outcome.replayed ? outcome.response : outcome.response;`（两分支相同）。无行为影响。 | `packages/core/src/dispatcher.ts:246` | open | no |
| RE-11 | P3 | document（data.md / protocol.md） | `data.md` §2 `project` 表无 `name` 字段，但 `protocol.md` §3 `project.create` 要求 `root,name`，读模型 `ProjectSummary` 也暴露 `name`：文档内部不一致，存储层无处持久化 `name`。实体 Schema 忠实于 `data.md`，故记为文档缺口而非实现偏差。 | `packages/contracts/src/entities/project.ts:139-150`；`docs/architecture/data.md:17`；`docs/architecture/protocol.md:37` | open | no |
| RE-12 | P3 | task T1 / data.md §3 | `planSchema` 未表达「非L1正式代码必须productRef；L3 rollback不能为空」：`productRef` 可选、`rollback` 允许空数组。Schema 与策略分离可接受，但需由后续 Gate/Planning 工作包显式落地。 | `packages/contracts/src/entities/structures.ts:243-255`；`docs/architecture/data.md:66` | open（移交 WP-02/WP-06） | no |
| RE-13 | P3 | task T1（data.md §2 operation.kind） | `operationSchema.kind` 使用自由字符串，未复用已定义的 `operationKindSchema` 七值枚举；DB 的 `kind` CHECK 反而是严格的。Schema 层放行、DB 层拒绝的差异不影响正确性，但削弱“共享 Schema 一次定义”。 | `packages/contracts/src/entities/system.ts:129-140`、`packages/storage/src/schema.ts:391` | open | no |
| RE-14 | P3 | task T6 / protocol §2 | `EventHub.subscribe`（afterCursor 分支）与 `poll` 把 `readAfter` 的任何异常一律翻译为 `RESYNC_REQUIRED`，会掩盖非截断类存储错误，诊断信息不准确。 | `packages/core/src/events-hub.ts:264-275`、`:332-340` | open | no |

## 契约逐项核对

### 1. data.md §2 实体表（逐字段抽样 18 张，要求 ≥8）

| 表 | 结果 | 说明 |
|---|---|---|
| project | ✅ 一致 | root/gitRoot?/codeRoot/documentRoot/deliveryBranch/trust/state/head? 全在；`root UNIQUE`；`id` 为 32hex 项目 id（ARCHITECTURE §4），符合 `data.md` §1“Project使用32hex”。（`name` 见 RE-11，属文档缺口） |
| conversation | ✅ 一致 | title/focusWorkId?/archived |
| message_body | ✅ 一致 | ownerKind/ownerUserId?/producerRunId?/mime/contentHash/relativeBlobPath/bytes；user→ownerUserId、agent→producerRunId、system→无 producerRunId 三重约束齐备 |
| user_action | ✅ 一致 | actorId/action/targetId?/payload/payloadHash；DDL 有禁改+禁删触发器 |
| message | ✅ 一致 | seq/sender/role?/bodyRef/targetWorkId?/targetRole?/state/resultRefs；`UNIQUE(conversation_id,seq)` |
| work | ✅ 一致 | intent/purpose/level/goal/scope/sourceMessageId?/sourceRef/authorizationRef?/requirementId?/status/blockerIds/baseRevision?/budgetId/policyRevision |
| requirement | ⚠️ 字段齐、语义偏差 | 字段与约束齐全，但 `portableRef.path` 默认值违反 §6（RE-01） |
| task | ✅ 一致 | 含 dependencyRevision?/dependencyManifestRefs，符合 §3“Task与VerificationManifest同字段” |
| assessment | ❌ 部分 | 字段齐全，但“不可变，每次重评新行”未落库（RE-03） |
| finding | ✅ 一致 | 含 `targetKind='task' ⇒ taskId 非空` 的 CHECK/refine |
| run | ✅ 一致 | 含 parentRunId?/join/childIds/三个 snapshot 引用；DDL 列名 `join_policy` 由 alias 映射 |
| attempt | ✅ 一致 | `UNIQUE(run_id,number)` |
| artifact | ✅ 一致 | origin=agent⇒runId、origin=user⇒attachmentId 且 runId 空；validity/ACL |
| stage_result | ✅ 一致 | 与 §2/§3 提交形状一致，taskId?/runId/attemptId/manifestId?/checkResult? |
| grant | ✅ 一致 | once⇒runId+toolOperationId+inputHash、run⇒runId、work⇒workId 双向（Schema refine + DDL CHECK） |
| budget | ✅ 一致 | `tokens_used+tokens_reserved<=token_limit` 在 Schema 与 DDL 双处 |
| command | ✅ 一致 | operation/key/payloadHash/state/response；`UNIQUE(operation,key)`；`subject` 为内部列（§2 允许内部优化字段） |
| event | ✅ 一致 | cursor PK 单调、不可变（禁 UPDATE）；DELETE 仅用于 §5 保留期截断 |
| 其余（snapshot/outbox/tool_operation/lease/operation/feature_projection/discovery/decision/authorization/attachment） | ✅ 一致 | 字段、唯一约束（outbox.operationId、lease.resource、feature_projection(revision,feature_id)）、枚举 CHECK、数组 ≤1000、json_valid 均已核对 |

表清单：`SCHEMA_TABLES` 与 `DOCUMENTED_TABLES` 均为 28 张且一致；DDL 列与实体 Schema 由 `migrations.integration.test.ts:235-258` 做双向一致性断言（未声明列会失败）。

### 2. data.md §3 产物结构

Assessment / ContextSelection / ConfigPatch / ProfessionalDispatchSpec / ChiefDispatchSpec / DispatchSpec / DispatchSnapshot / ProductDefinition / Plan / CompactPlan / CheckResult / ReviewResult / TestResult / SettlementResult / VerificationManifest / CompletionManifest / StageResult / Ref / SourceRef / Scope 全部存在且字段与文档一致；`missingSelectionReasons` + `validateContextSelection` 落实“缺 reason 拒绝”；CheckResult“automated check 必有 exitCode”已强制。策略性约束（Plan 的 productRef/rollback）未在 Schema 层表达（RE-12）。

### 3. protocol.md §1/§2/§7

- §1 Envelope 与 `RequestEnvelope`/`ResponseEnvelope` 形状一致；`idempotencyKey` 1–128、`expectedVersion≥0` 校验；写方法经 mailbox 串行；`payloadHashOf` 规范化键序。VER `PROTOCOL_MISMATCH`、未知方法 `NOT_FOUND`、params `VALIDATION_ERROR` 与文档一致。
- §1「Project方法必填projectId」未强制（RE-08）。
- §2 订阅：`project.subscribe`→`{subscriptionId,snapshot?,cursor,mode}`、`subscription.set`→`{snapshot,cursor}`、`subscription.remove`→`{removed}`、`project.events.ack`→`{acknowledged}`、`batch_end` 水位（空批次也发）均已实现；范围改变始终回快照；游标被截断→`RESYNC_REQUIRED`。认证：0600 安装凭证 + timingSafe Bearer、HttpOnly/SameSite=Strict（remote 加 Secure）、CSRF、24h、401、每 IP 每分钟 5 次 429、logout Max-Age=0、Origin 精确匹配均已实现（一次性显示旁路见 RE-07）。
- §7 错误码：25 个代码与文档表逐项对应；`retryable` 默认仅 BUSY，其余可显式覆盖（Provider 瞬时错误路径属 WP-02）。`BLOB_MISSING→ARTIFACT_MISSING`、`VERSION_CONFLICT` 带 `currentVersion` 映射正确。

### 4. reliability.md §1 与 ARCHITECTURE.md §5

- 事务边界（dispatcher）：`校验→领域行→command response→event→outbox→COMMIT` 在单个 `BEGIN IMMEDIATE` 事务内完成，失败整体回滚；`dispatcher.integration.test.ts:205-270` 证明丢应答重放不重复副作用、VERSION_CONFLICT 不留账、handler 失败全回滚。**但需求投影路径未遵守同一边界（RE-02）。**
- mailbox：串行（峰值并发 1、FIFO）、256 项/4MiB 超限立即 BUSY、>100ms 诊断、长操作 `runEffect` 不入队（AC-056 实测 <1s）。
- outbox：operationId 唯一、30s lease、仅 pending 或租约过期可领取、attempts 自增、done 不重投。
- connectionQueue：soft 2MiB / hard 8MiB 默认值断言；软限合并临时帧、硬限关闭连接且持久事件仍在库、其他订阅不受影响。
- 快照+水位 C：先读快照行再取 `latestCursor()`，保证不丢事件；`setScope` 同样顺序。

### 5. 存储与迁移（data.md §1/§4/§5）

- pragmas：`foreign_keys=ON`、`journal_mode=WAL`、`synchronous=FULL(2)`、`busy_timeout=5000` 在真实文件上断言通过。
- `schema_migrations(version PK,name,checksum,applied_at)`、逐条 checksum 校验、版本超前拒绝、失败迁移回滚且不留部分表、迁移幂等均实现并有测试。
- 备份：`backupDatabase` 用 `VACUUM INTO`，在待迁移时可用且有测试；默认启动路径未接线（RE-04）。
- blob：内容寻址、临时文件+fsync+校验后原子 rename、路径逃逸拒绝、`BLOB_MISSING`/`BLOB_MISMATCH`、离线 GC、删除文件返回 `ARTIFACT_MISSING`（由 dispatcher 映射）。
- 分页上限常量（默认 50 / 最大 200）已定义但无消费方；分页参数校验属 WP-09 协议方法，非 WP-01 缺陷。

## 测试质量抽查（非空泛性）

| 测试 | 断言要点 | 若移除被测行为是否失败 | 结论 |
|---|---|---|---|
| `packages/core/test/mailbox.test.ts:55-94`（AC-056） | `runEffect` 在飞时提交命令，断言结果、`elapsed < 1000`、`activeEffects` 仍含长调用 | 是：若 mailbox 把 effect 纳入串行队列，该命令将永远等待，`<1000ms` 断言失败 | 有效，覆盖“长操作不阻塞”边界 |
| `packages/core/test/mailbox.test.ts:20-53` | 断言 `peak===1` 与精确的 start/end 交错序列 | 是：并发执行会破坏 `peak` 与序列 | 有效，覆盖串行化边界 |
| `packages/storage/test/ledger.integration.test.ts:57-86` | 同键同载荷二次 `begin` 返回 `replay` 且原 response；`effects===1` | 是：若 replay 逻辑缺失会返回 `new` 并产生第二次副作用 | 有效 |
| `packages/core/test/events-hub.integration.test.ts:273-293`（AC-059） | 硬限触发 `HARD_LIMIT`、`closed===['slow']`、随后新订阅能读回持久事件 | 是：若只清队列不关连接或丢弃事件，断言失败 | 有效，覆盖“断开但不丢持久事件”边界 |
| `packages/storage/test/migrations.integration.test.ts:202-229` | 失败迁移抛 `MIGRATION_FAILED` 且 ledger 仍为 `[1]`、无遗留表 | 是：若无事务包裹，`good_table` 会残留 | 有效 |
| `packages/core/test/requirements.integration.test.ts:149-169` | 同版本异内容冲突后行未变、仅 `requirement.save_failed` 事件 | 是：若冲突时写行，断言失败 | 有效（但它同时把 RE-01 的错误路径固化为期望，见 RE-01） |

结论：抽查的 6 个测试均非空泛，能在其声明的边界上捕获回归；但 `requirements` 测试对 `portableRef.path` 的期望值是错的，属“断言方向正确、基准错误”。

## 偏差判定

| 偏差 | 判定 | 依据 |
|---|---|---|
| `project.id = SHA256(canonicalRoot)[0:32]` | **可接受** | `ARCHITECTURE.md` §4 与 `data.md` §1“Project使用32hex”明确要求；`project` 无独立 `project_id` 列也符合该行的 id 即项目标识 |
| `event` 允许 DELETE（保留期截断）、禁止 UPDATE | **可接受** | `data.md` §2 要求 event 不可变，§5 又要求“事件超30天截断”；只禁 UPDATE、DELETE 仅用于截断是二者的最小调和，且被测试固定 |
| `requirement.portableRef.hash` 承载 recordHash | **可接受（hash 部分）** | `requirements.md` §6 原文即“portableRef.hash（也称recordHash）”；`data.md` §2 行内无第二个 Hash 列 |
| `requirement.portableRef.path = requirements/<id>/requirement.json` | **不可接受（缺陷）** | 与同一文档的 path 语义（目录）和 `.agentdev/` 根路径冲突，见 RE-01 |
| storage 以结构化接口描述 Schema、不直接依赖 zod | **可接受** | `ARCHITECTURE.md` §2 限定 storage 依赖为 contracts+better-sqlite3；`ContractSchema` 结构接口 + `fromColumns` 逐行用契约 Schema 校验，保持“共享 Schema 一次定义” |

## 未覆盖与遗留

- **未执行** `pnpm test:integration`（任务约定由 Test 角色负责）。实现记录声称 integration 10 文件/115 用例（14 迁移 + 21 仓储/账本 + 9 分发 + 16 订阅 + 9 身份 + 8 需求投影）；本 Review **未独立复跑**，该数字仅作为开发记录，不作通过证据。
- **未复跑** `pnpm build`、`pnpm install --frozen-lockfile`；better-sqlite3 13.0.3 原生构建在 `pnpm-workspace.yaml` 显式放行，属 WP-00/供应链记录范围。
- 真实端到端（daemon/BFF/WebSocket/UI）不存在，AC-023 的“切换不影响运行”、AC-078 的 WS Origin/cookie 关闭与“后台Work保留”、AC-092 的 Git 往返与冲突解除属 **WP-04/WP-08/WP-09**；AC-092 的跨服务器 recordHash 一致性还依赖 RE-05 的修正。
- RE-04（默认启动备份接线）与 RE-08（projectId 必填）应在 **WP-09** 落实；RE-12 应在 **WP-02/WP-06** 落实。
- 迁移失败后“显示版本、不启动Runner”的守护进程行为属 **WP-09/WP-10**；本包只提供库级异常与回滚。
- `docs/INDEX.md` 未在本 commit 更新（plan 允许在结算时更新），属结算步骤，不计为缺陷。

## 证据

```
$ git log --oneline -5
c3a581f feat(wp-01): 事件订阅/背压、连接认证与 Project 身份、需求投影
...
79d5895 feat: WP-00 工具链与执行底座
$ git status --short          # 空输出（工作区干净）
$ git rev-parse HEAD^{tree}
196f56ffa6a28ae0ca844acfb5c4e76f1df017e6
```

```
### typecheck
$ tsc -p tsconfig.json --pretty false
TYPECHECK_EXIT=0
### lint
$ node scripts/lint.mjs
Checking formatting...
All matched files use Prettier code style!
LINT_EXIT=0
### docs:check
$ node scripts/docs-check.mjs
docs:check ok — 15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages
DOCSCHECK_EXIT=0
```

```
$ pnpm test:unit
 ✓ |unit| packages/contracts/test/entities.test.ts (12 tests)
 ✓ |unit| packages/core/test/auth.test.ts (18 tests)
 ✓ |unit| packages/core/test/mailbox.test.ts (8 tests)
 ✓ |unit| packages/domain/test/domain.test.ts (28 tests)
 ... (13 files)
 Test Files  13 passed (13)
      Tests  173 passed (173)
```

```
$ grep -rn "withTransaction\|transact(" packages/core/src
packages/core/src/dispatcher.ts:12:import { StorageError, sha256, withTransaction } from '@agentdev/storage';
packages/core/src/dispatcher.ts:261:      return withTransaction(this.options.store.db, () => {
# core/src/requirements.ts 无事务包裹（RE-02）

$ grep -rn "agentdev/requirements" packages --include=*.ts | grep -v dist
packages/core/test/requirements.integration.test.ts:99: expect(...portableRef.path).toBe(`requirements/${REQUIREMENT_ID}/requirement.json`);
packages/core/src/requirements.ts:28:  `requirements/${id}/requirement.json`;
packages/contracts/test/entities.test.ts:143: portableRef: { path: '.agentdev/requirements/x', ... }   # RE-01
```

```
$ git diff --name-only 79d5895..c3a581f -- docs apps webui docker package.json
# 空输出：改动全部落在 plan.md writePaths 内
# 共 59 文件、+10233/-1；packages/contracts/src/{index,primitives}.ts 为纯新增导出/类型，
# 未改动 WP-00 既有类型语义
```

## 2. 复评（re-review）

- 复评对象：commit `8e96ee2df29db589653e9fbfedd0569ea3217a96`，tree `f1589696a5938dc83f282d5e929f81976967e6e5`（均以 `git rev-parse HEAD` / `git rev-parse HEAD^{tree}` 实测）。
- 任务书给出的 commit `8e96ee2f9b4d9ffbbd0f2e2c6b6d6a66b0b1b8f9` 在本仓库对象库中**不存在**（`git cat-file -t` 退出 128；`git rev-parse --verify` 只做了形式校验）；复评以实际 `HEAD` 为准，二者均如实记录。
- 首次 Review 对象：commit `c3a581ffacf588c56754c505ca16dfd83c79174f`，tree `196f56ffa6a28ae0ca844acfb5c4e76f1df017e6`。
- 方法：独立上下文，不读开发聊天。读首次报告、`implementation.md` §2 处置表、`git show 8e96ee2` 全量 diff、HEAD 源码/测试与正式文档；在 `/tmp` 的 HEAD 归档副本（`git archive` + `node_modules` 符号链接）中执行“回退修复→复跑测试”的非空泛性实验与升级路径实验。仓库 tracked 文件仅本文追加，复评前后 `git status --short` 为空。

### 2.1 逐项判定

| id | 原级别 | 判定 | 证据与说明 |
|---|---|---|---|
| RE-01 | P1 | **verified（已修复）** | 默认路径改为目录且带 `.agentdev/` 前缀：`packages/core/src/requirements.ts:31`（`REQUIREMENT_RECORD_DIR`）、`:241`（`portableRef.path` 默认）、`:234`（`sourceRef.path`）。与 `docs/architecture/data.md` §6「portableRef.path为目录而非单文件」、`docs/product/requirements.md` §1「.agentdev/requirements/<requirement-id>/」一致。测试期望同步修正：`packages/core/test/requirements.integration.test.ts:100-106`。回退实验（把常量改回 `requirements/<id>/requirement.json`）后该用例失败：`expected 'requirements/018f…' to be '.agentdev/requirements/018f…'`。残留：`ImportRequirementInput.portableRef.path` 仍可被调用方覆盖（`:241` 的 `??`），Git 导入方（WP-04/WP-08）必须传目录。 |
| RE-02 | P1 | **verified（已修复）** | `RequirementProjection.import` 整体包进 `withTransaction`：`packages/core/src/requirements.ts:112-114`（`BEGIN IMMEDIATE` 见 `packages/storage/src/sqlite.ts:62-65`）。新增用例 `packages/core/test/requirements.integration.test.ts:210-226`（事件写入失败→行不存在→重试为 `new`）。回退实验（删去 `withTransaction` 包装）后该用例失败于 `store.requirements.find(...)` 应为 `undefined` 但留下投影行处。另实测嵌套 `withTransaction`（dispatcher 事务内再调 import）以 SAVEPOINT 正常工作，嵌套不会报错。 |
| RE-03 | P2 | **verified（已修复）** | `assessment` 加入 `UPDATE_BLOCKED_TABLES`：`packages/storage/src/schema.ts:58-64`，触发器由 `:467-474` 生成；负例见 `packages/storage/test/migrations.integration.test.ts:384-398`（重评 UPDATE 抛 `immutable`）。观察（非本次发现范围）：`DELETE_BLOCKED_TABLES`（`:65`）未含 assessment，`DELETE FROM assessment` 仍可执行；首次发现只要求 UPDATE 不可变，故记为观察项。 |
| RE-04 | P2 | **verified（默认接线已补齐，但见 NF-01）** | `ProjectStore.open` 默认传 `backupPath`：`packages/storage/src/store.ts:169`（`defaultBackupPath` 定义于 `:52`）；`runMigrations` 在无回调而有 `backupPath` 时调用 `backupDatabase`：`packages/storage/src/migrations.ts:145-149`；用例 `packages/storage/test/ledger.integration.test.ts:327-339`。默认接线成立，但该默认路径在第二次待迁移时必然失败，见 NF-01。 |
| RE-05 | P2 | **verified（能力已具备；调用方义务归 WP-04/WP-08）** | `metadataHashOf/recordHashOf` 接受原始字节：`packages/core/src/requirements.ts:79-88`；输入字段 `rawMetadata` 见 `:46-53`；用例 `packages/core/test/requirements.integration.test.ts:200-208`（`metadataHashOf(...,raw) === sha256(raw)`，且与规范化结果不同）。仓库内尚无 Git 导入调用方传字节（属 WP-04/WP-08），届时必须传 `rawMetadata` 才满足 `requirements.md` §6。 |
| RE-06 | P2 | **verified（已修复）** | `packages/domain/src/transitions.ts:47-48` 补入 `review: ['test','done','develop']`、`test: ['done','develop']`，符合 `docs/rules/workflow.md` §5.2「Review或Test失败返回develop；修复后重新独立Review」；断言 `packages/domain/test/domain.test.ts:118-119`。 |
| RE-07 | P2 | **verified（已修复）** | 重载路径不再保留明文：`packages/core/src/auth.ts:148-153` 返回 `new InstallationCredential(path, undefined)`；`revealOnce()` `:162-166` 因无值返回 `undefined`，`matches()` 每次读文件比对 `:169-173`。断言 `packages/core/test/auth.test.ts:51`。 |
| RE-08 | P2 | **verified（已修复）** | `OperationDefinition.scope` 见 `packages/core/src/dispatcher.ts:52`；缺 `projectId` 的 project 方法返回 `VALIDATION_ERROR` 见 `:172-174`，符合 `docs/architecture/protocol.md` §1「全局方法省略projectId……Project方法必填projectId」；用例 `packages/core/test/dispatcher.integration.test.ts:191-209`（project 方法缺 id 拒绝 + `connection.hello` scope=global 通过）。 |
| RE-09 | P2 | **partially_fixed** | §1/§2 范围矛盾已消除（`implementation.md:132-137`），entities 计数改为 12（`:18`）。但命令证据表仍是旧计数：`:147`「10 文件 / 115 用例（14 迁移 + 21 仓储/账本 + 9 分发 + 16 事件订阅 + 9 身份 + 8 需求投影）」——括注相加为 77，与 115 自相矛盾；实测 WP-01 六个集成文件为 82 用例（14/22/10/17/9/10），加 WP-00 四个文件 38 用例共 120，与 fix commit 信息一致。另 `:65` 称 dispatcher 9 用例、`:109` 称需求投影 8 用例，实测均为 10。见 NF-04。 |
| RE-10 | P3 | **verified（已修复）** | `packages/core/src/dispatcher.ts:253-254` 已改为 `const outcome = …; return outcome.response;`，死三元删除。 |
| RE-11 | P3 | **accepted_risk_deferred（归 WP-09）** | 文档不一致仍在：`docs/architecture/protocol.md:37` `project.create` 要求 `root,name`，`docs/architecture/data.md:17` project 表无 name，`packages/contracts/src/entities/project.ts:139-150` 读模型暴露 name。`implementation.md:127` 声明归 WP-09 处置。但仓库内并无该 Discovery 记录，见 NF-05。 |
| RE-12 | P3 | **accepted_risk_deferred（归 WP-02/WP-06）** | `planSchema` 仍 `productRef?`、`rollback` 允许空：`packages/contracts/src/entities/structures.ts:243-255`；`implementation.md:128` 声明归 WP-02/WP-06 的 Gate 落地。同样缺 Discovery 记录（NF-05）。 |
| RE-13 | P3 | **verified（已修复）** | `packages/contracts/src/entities/system.ts:136` 改用 `operationKindSchema`，其 7 个值（`packages/contracts/src/entities/run.ts:209-217`）与 DDL CHECK（`packages/storage/src/schema.ts:397`）完全一致；无循环依赖（`run.ts` 不反向引用 `system.ts`）。小瑕疵：`system.ts:135` 注释写 “eight operation kinds”，实为 7 个，属注释笔误。 |
| RE-14 | P3 | **verified（代码已修复；其证明用例空泛）** | `subscribe`/`poll` 仅在 `ResyncRequiredError` 时转换：`packages/core/src/events-hub.ts:267-270`、`:338-342`，非截断异常原样抛出。代码行为正确，但新增负例 `packages/core/test/events-hub.integration.test.ts:233-241` 不能证明该修复，见 NF-03。 |

### 2.2 两项 P1 的专门核对

- **RE-01 记录目录**：默认值现为 `.agentdev/requirements/<id>`（目录、含 `.agentdev/` 前缀），与 `data.md` §6、`requirements.md` §1 完全一致；测试基准已同步，且回退修复会使用例失败——非空泛。
- **RE-02 原子性**：HEAD 实测「事件 append 抛错 → 投影行不存在 → 重试返回 `new`」通过；回退实验证明该用例确实受被测代码支配（去掉事务即失败）。行→事件顺序见 `requirements.ts:172-178`（new）与 `:189-195`（update），同事务内任一步失败整体回滚；嵌套 `withTransaction` 经 SAVEPOINT 实测可用，dispatcher 外层事务包裹 import 不会冲突。
- 结论：两项 P1 均已真正修复且有非空泛证据。

### 2.3 复评新发现

| id | severity | target | 描述 | 证据 | blocking |
|---|---|---|---|---|---|
| **NF-01** | **P1** | task T3/T4（AC-065；`data.md` §5） | 默认迁移前备份目标固定为 `<stateDir>/backups/pre-migration.sqlite`，而**首次安装**（migration 0001 待应用）就会创建该文件；`backupDatabase` 用 `VACUUM INTO` 且拒绝覆盖，因此下一次有待迁移（如 0002）时在备份处抛裸 `SqliteError: output file already exists`，且该调用位于每迁移 `try` 之外，不以 `MIGRATION_FAILED` 包装，迁移根本不会执行。RE-04 新增的默认接线恰好使其所服务的「版本升级」路径不可用。 | `packages/storage/src/store.ts:169`；`packages/storage/src/migrations.ts:145-149`（备份在 `:155` 的 try 之外）、`:187-190`（`VACUUM INTO`）；`packages/storage/test/ledger.integration.test.ts:327-339` 把「首次安装即备份」固化为期望。实测：首次 `ProjectStore.open` 后备份文件存在；再以 `[...MIGRATIONS, {version:2}]` + 同一默认路径跑 `runMigrations` 得 `SqliteError:output file already exists`（`/tmp` 归档副本复现，未改动仓库）。 | yes |
| **NF-02** | P2 | task T3/T4（AC-065）；`packages/storage/src/schema.ts` | RE-03 通过直接改 `schema.ts` 的 `UPDATE_BLOCKED_TABLES` 实现，而 migration 0001 的 SQL 由该常量派生（`MIGRATIONS[0].sql = CORE_SCHEMA_SQL + IMMUTABILITY_SQL`），导致 migration 0001 checksum 变化：`6224f5a3…`（首次 Review 树 c3a581f）→ `8de04150…`（HEAD）。由 tree `196f56ff` 创建的库在 HEAD 打开时必然 `MIGRATION_CHECKSUM_MISMATCH` 而拒绝启动，既有升级路径被这处就地 schema 编辑破坏。修复应为追加 0002 迁移，或在发布前明确记录「0001 可重发」。注：dab17f9→722b60d 也曾重发 0001，属既有做法，本次再次触发且可实测。 | `packages/storage/src/schema.ts:58-64`、`:467-482`；`packages/storage/src/migrations.ts:23-29`、`:55-57`、`:95-102`。实测跨版本：旧 schema 建库 → HEAD schema 重开，得 `StorageError:MIGRATION_CHECKSUM_MISMATCH`。 | no（但直接影响 AC-065 升级路径） |
| **NF-03** | P3 | test（RE-14 的证明用例） | `events-hub.integration.test.ts:233-241` 无法证明 RE-14：`poll` 在进入 `try` 之前先调用 `watermark()`（`packages/core/src/events-hub.ts:332`），`DROP TABLE event` 使该调用先抛 `SqliteError`，catch 内的过滤逻辑从未执行。实测：把 `poll` 的 catch 回退为「捕获一切」后该文件仍 17/17 通过；探针显示抛出 `{ctor:'SqliteError', code:'SQLITE_ERROR', message:'no such table: event'}`。应改为只让 `readAfter` 抛非 Resync 错误，并补 `subscribe(afterCursor)` 分支同类负例。 | 同上；`/tmp` 归档副本回退实验。 | no |
| **NF-04** | P3 | 文档（`implementation.md`） | RE-09 只修了一部分：`:147` 集成计数 115/括注 77 与实测 120（WP-01 六文件 82）不符；`:65`（dispatcher 9→实际 10）、`:109`（需求投影 8→实际 10）同样过时。结算若直接引用会再次误判范围。 | `.agentdev/work/WP-01/implementation.md:65,109,147`；实测用例数（`grep -cE "^\s*(it|test)\("` 且与运行一致）。 | no |
| **NF-05** | P3 | 文档/流程（Discovery 与 Test 证据绑定） | ① `implementation.md:127-128` 声称 RE-11/RE-12「记为 Discovery（DC-18/DC-19）」，但 `.agentdev/work/WP-01/` 下无 `discovery.md`，DC-18/DC-19 仅出现在 implementation.md，全仓无对应 Discovery 记录。② fix commit 同时提交了 `test-report.md`，而其 §1 绑定 tree `196f56ff`（修复前），T9 的 Test 证据不覆盖 HEAD 树；本次代码变更后按 workflow §7 仍需新的独立 Test。 | `find .agentdev -type f`（WP-01 仅 plan/implementation/review/test-report）；`grep -rn "DC-18\|DC-19" .agentdev`；`.agentdev/work/WP-01/test-report.md:11-12`。 | no |

### 2.4 命令证据（复评实测）

| 命令 | 退出码 | 结果 |
|---|---|---|
| `git rev-parse HEAD` / `HEAD^{tree}` / `git status --short` | 0 | HEAD=`8e96ee2df29db589653e9fbfedd0569ea3217a96`；tree=`f1589696a5938dc83f282d5e929f81976967e6e5`；工作区干净 |
| `git cat-file -t 8e96ee2f9b4d9ffbbd0f2e2c6b6d6a66b0b1b8f9` | 128 | 任务书 commit 不存在于对象库 |
| `pnpm typecheck` | 0 | 无错误 |
| `pnpm lint` | 0 | `All matched files use Prettier code style!` |
| `pnpm test:unit` | 0 | 13 文件 / 173 用例通过 |
| `pnpm docs:check` | 0 | 15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages |
| `pnpm vitest run --project integration <requirements,migrations,ledger,events-hub,dispatcher,identity>` | 0 | 6 文件 / 82 用例通过（14 迁移 + 22 账本 + 10 分发 + 17 事件订阅 + 9 身份 + 10 需求投影） |
| `/tmp` 归档副本：RE-01/RE-02 回退实验 | 1 | 各自对应用例失败（非空泛性成立） |
| `/tmp` 归档副本：RE-14 回退实验 | 0 | 全部 17 用例仍通过（证明该负例空泛） |
| `/tmp` 归档副本：跨版本 checksum 与默认备份升级探针 | 0 | `MIGRATION_CHECKSUM_MISMATCH`；第二次迁移 `SqliteError:output file already exists` |

### 2.5 未覆盖与遗留

- 未执行 `pnpm test:integration` 全量（按约定属 Test 角色）；仅复跑 WP-01 六个集成文件，CLI/runner/pi-runtime 的 4 个集成文件与 `pnpm build` 未复跑。
- NF-01 用合成 0002 迁移复现；仓库当前只有 0001，故现有测试不会暴露该缺陷。
- 真实端到端（daemon/BFF/WebSocket/UI）与 Git 往返仍不存在，属 WP-04/WP-08/WP-09；与首次 Review 一致。

### 2.6 复评结论

**FAIL**

理由：首次两项 P1 确已修复且证据非空泛（RE-01、RE-02，回退实验均可让对应用例失败）；12 项 P2/P3 中 RE-03/04/05/06/07/08/10/13/14 已修复、RE-09 部分修复、RE-11/RE-12 合理移交后续工作包。但本次修复提交引入了一项新的 P1（NF-01：默认迁移备份路径使 AC-065 的「版本升级」路径不可用）及一项直接关联 AC-065 升级路径的新 P2（NF-02：就地编辑 migration 0001 改变 checksum，使首次 Review 树创建的库无法打开）。按 `workflow.md` §6，P1 阻断、影响验收的 P2 亦阻断，故不能 PASS。

建议处置：① 默认备份改为按版本/时间命名，并在无既有 schema 的首次安装跳过备份；② RE-03 的 schema 改动改为追加 0002 迁移；③ 修正实现记录用例计数；④ 修复 RE-14 的空泛用例并补 `subscribe` 分支负例；⑤ 在 WP-01 记录中创建实际 Discovery 记录并明确 T9 Test 需绑定修复后树。完成后重新独立 Review 与 Test。
