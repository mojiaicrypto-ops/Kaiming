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

## 3. 复评二（re-review 2）

- 复评对象：commit `9c634f0ed6232902c5aa46820ccc64c839873849`，tree `981746cbd665339a1ecdf09bbb627b1bfb0ab38a`（`git rev-parse HEAD` / `git rev-parse HEAD^{tree}` 实测）。
- 工作区：`git status --short` 无输出（复评前后均干净）；仓库 tracked 文件仅本文追加。
- 上游对象：`8e96ee2`（§2 复评对象，tree `f1589696…`）、`c3a581f`（首次 Review 对象，tree `196f56ff…`）。
- 方法：独立上下文，不读开发聊天。读 §1/§2、`git show 9c634f0` 全量（397 行、8 文件）、HEAD 源码/测试与正式文档（`data.md` §5、`reliability.md` §8、`acceptance.md` AC-065）；在 `/tmp/wp01-r2/{head,old,mut,noguard}` 的 HEAD / `8e96ee2` / `196f56ff` 归档副本（`git archive` + `node_modules` 符号链接）中执行探针与「回退修复」实验，仓库未改动。

### 3.1 首次 Review 发现逐项判定（RE-01…RE-14，HEAD 复核）

| id | 原级别 | 判定 | HEAD 证据 |
|---|---|---|---|
| RE-01 | P1 | **verified** | 默认目录 `.agentdev/requirements/<id>`：`packages/core/src/requirements.ts:31`（`REQUIREMENT_RECORD_DIR`）、`:234`（`sourceRef.path`）、`:241`（`portableRef.path`）。与 `data.md` §6、`requirements.md` §1 一致；§2 回退实验（改回单文件路径即失败）仍成立。 |
| RE-02 | P1 | **verified** | `RequirementProjection.import` 事务化：`requirements.ts:113` `withTransaction(this.store.db, …)`；`BEGIN IMMEDIATE` 见 `packages/storage/src/sqlite.ts:67`；用例 `packages/core/test/requirements.integration.test.ts:210-226`。 |
| RE-03 | P2 | **verified** | `assessment` 在 `UPDATE_BLOCKED_TABLES`：`packages/storage/src/schema.ts:58-64`，触发器由 `:468-474` 生成；负例 `packages/storage/test/migrations.integration.test.ts`（重评 UPDATE 抛 immutable）。观察：`DELETE_BLOCKED_TABLES`（`schema.ts:65`）仍不含 assessment（原发现只要求 UPDATE 不可变，非本次范围）。 |
| RE-04 | P2 | **verified（默认接线成立；但伴生 NF2-01）** | `ProjectStore.open` 传 `backupDir: defaultBackupDir(options.dataDir)`：`packages/storage/src/store.ts:173`（定义 `:56`）；`runMigrations` 无 hook 时用 `backupDir` 落盘：`packages/storage/src/migrations.ts:153-158`。本次 5 项探针实测升级路径可用（见 §3.3）。 |
| RE-05 | P2 | **verified** | `metadataHashOf/recordHashOf(…, rawMetadata?)`：`requirements.ts:79-88`；输入 `rawMetadata` `:53`；用例 `requirements.integration.test.ts:200-208`。Git 导入方义务仍归 WP-04/WP-08（DC-23）。 |
| RE-06 | P2 | **verified** | `packages/domain/src/transitions.ts:47-48` 含 `review: ['test','done','develop']`、`test: ['done','develop']`，符合 `workflow.md` §5.2。 |
| RE-07 | P2 | **verified** | 重载不保留明文：`packages/core/src/auth.ts:152` `new InstallationCredential(path, undefined)`；`revealOnce()` `:162`、`matches()` `:169-173` 每次读文件。 |
| RE-08 | P2 | **verified** | `OperationDefinition.scope`：`packages/core/src/dispatcher.ts:52`；缺 `projectId` 的项目方法返回 `VALIDATION_ERROR`：`:172`。 |
| RE-09 | P2 | **partially_fixed** | §1/§2 范围矛盾已消除；但 `implementation.md:147` 命令证据表仍是「115 用例（14+21+9+16+9+8=77）」——本项未修，见 **NF-04 / §3.6**。 |
| RE-10 | P3 | **verified** | 死三元已删：`dispatcher.ts:253-254` `const outcome = …; return outcome.response;`。 |
| RE-11 | P3 | **accepted_risk_deferred（归 WP-09）** | 文档不一致仍在（`protocol.md:37` 要 `name`、`data.md:17` 无该列、`entities/project.ts` 读模型暴露 `name`）；已有实际 Discovery 记录 `discovery.md` DC-18（含证据/影响/路由/关联），路由 WP-09。 |
| RE-12 | P3 | **accepted_risk_deferred（归 WP-02/WP-06）** | `planSchema` 仍 `productRef?`、`rollback` 可空；已由 `discovery.md` DC-19 记录并路由 WP-02/WP-06 的 Gate 层。 |
| RE-13 | P3 | **verified** | `packages/contracts/src/entities/system.ts:136` 用 `operationKindSchema`（`run.ts:209-217` 共 7 值，与 DDL CHECK 一致）。残留：`system.ts:135` 注释写 “eight operation kinds”，实为 7，属注释笔误（§2 已记录，未新增）。 |
| RE-14 | P3 | **verified（poll 分支负例已非空泛）** | `packages/core/src/events-hub.ts:270`（subscribe）、`:339`（poll）仅转换 `ResyncRequiredError`；回退 poll 分支后新负例失败（§3.4）。残留：`subscribe(afterCursor)` 分支仍无同类负例，见 **NF2-03**。 |

### 3.2 §2 复评新发现逐项判定（NF-01…NF-05）

| id | 原级别 | 判定 | 证据与说明 |
|---|---|---|---|
| NF-01 | P1 | **verified（已修复）** | 备份改为按来源版本命名 `<stateDir>/backups/pre-migration-v<currentVersion>.sqlite`（`migrations.ts:155-158`），`ProjectStore.open` 传 `backupDir`（`store.ts:173`）。本人在 scratch 复刻「首次打开 → 第二次升级」路径：不再抛 `SqliteError`；同版本重试复用已有副本；副本可打开且持有升级前 schema（§3.3）。 |
| NF-02 | P2 | **verified（以发布前冻结 + 护栏处置）** | 冻结常量 `8de04150…` 与 HEAD 实测一致（§3.5）；旧 tree `196f56ff` 实测为 `6224f5a3…`，与 DC-20 记录相符；`schema.ts` 是 0001 SQL 的唯一来源，改动它会使护栏用例失败（实测）。无 tag/发布（`git tag -l` 空），故「首个发布前就地修正」的理由成立，护栏可阻止无意识复发。 |
| NF-03 | P3 | **verified（poll 分支已非空泛）** | 回退 `poll` 的 `instanceof` 过滤为「捕获一切」后，`events-hub.integration.test.ts` 由 17/17 变为 1 failed/16 passed；恢复后 17/17（§3.4）。 |
| NF-04 | P3 | **not_fixed** | `implementation.md:147` 仍为「10 文件 / 115 用例通过（14 迁移 + 21 仓储/账本 + 9 分发 + 16 事件订阅 + 9 身份 + 8 需求投影）」（括注合计 77）；实测 integration 共 **10 文件 / 122 用例**（WP-01 六文件 84 + WP-00 四文件 38），且 `:41` 迁移 14→16、`:55` 账本 21→22、`:78` 事件订阅 16→17。commit message 声称「NF-04 按实测更新」，实际只改了 `:65`（分发 9→10）与 `:109`（需求投影 8→10）。 |
| NF-05 | P3 | **verified** | `discovery.md` 已建立，含 DC-18…DC-25，每条有证据/影响/实际路由/关联，归属正确：DC-18→WP-09（RE-11）、DC-19→WP-02/WP-06（RE-12）、DC-21/DC-22→本次修复、DC-23→WP-04/WP-08/WP-10、DC-24→WP-09、DC-25→WP-09/WP-10。§2 第②点（Test 报告未绑定修复后 tree）在本复评读取时属实（`test-report.md` 仍绑定 `c3a581f`/`196f56ff`）；复评期间另一 Test 角色 Run 并发将其完整替换为绑定 HEAD `9c634f0`/`981746c` 的报告（见 §3.10），该报告不在本 Review 的验证范围（全量 `test:integration` 归 Test 角色），故不作为 WP-01 阻断项。 |

### 3.3 NF-01 专门取证（自建探针，非空泛）

**使用的确切 API**（HEAD scratch，`tz`：`packages/storage/src/index.ts` 导出）：

1. 首次打开：`ProjectStore.open({ dataDir, canonicalRoot })` → 迁移 0001，生成 `defaultBackupDir(dataDir)/pre-migration-v0.sqlite`。
2. 第二次升级（同仓库默认 API）：`openDatabase({ file: join(dataDir,'project.sqlite') })` 后 `runMigrations(db, [...MIGRATIONS, synthetic0002], { backupDir: defaultBackupDir(dataDir) })`。

**观测结果**（探针 5 项全过，退出 0）：

- A `applied === [2]`、**无 `SqliteError`**、`backupPath === …/pre-migration-v1.sqlite`；对照：同一目标连续 `backupDatabase` 第二次抛 `SqliteError: output file already exists`，证明按版本命名是必要的。
- B 同来源版本重试：先跑一条失败迁移 0002（`MIGRATION_FAILED`，ledger 仍为 v1）→ 再重跑成功，`backupPath` 仍为 `pre-migration-v1.sqlite`，**文件字节与首次完全相同**（复用而非重写；去掉 `existsSync` 护栏后同一场景抛 `SqliteError: output file already exists`）。
- C 备份可用：以只读打开 `pre-migration-v1.sqlite`，`PRAGMA integrity_check = ok`、`readAppliedMigrations = [1]`、含 `project/event` 表、**不含**升级后新增的 `probe_step2`。
- E 名称不误导：0001→(合成)0002 成功、0003 失败后 ledger=`[1,2]`；重跑时生成 `pre-migration-v2.sqlite`，其内部 `readAppliedMigrations=[1,2]`、含 `probe_step2`、不含 `probe_step3`——即「部分迁移后的库」确实以其真实来源版本命名，未出现误导名。
- D/F 见 NF2-01。

### 3.4 NF-03 非空泛性（回退实验，scratch，仓库未动）

- scratch 方法：`git archive <commit> | tar -x` 到 `/tmp/wp01-r2/head`，符号链接各 `node_modules`；用 `perl -0777 -pi` 就地改副本再跑 vitest，之后用 `git archive <commit> <file> | tar -x` 还原。
- 基线：`events-hub.integration.test.ts` 17 passed。
- 回退 `poll` 过滤（`} catch { throw new ProtocolError('RESYNC_REQUIRED', 'subscription cursor was truncated', …) }`）→ **1 failed / 16 passed**，失败点 `expect(() => broken.poll(...)).toThrowError('disk failure')` 实得 `'subscription cursor was truncated'`。恢复后 17 passed。
- 回退 `subscribe(afterCursor)` 过滤（同一 scratch）→ **17 pass**，说明该分支无对应负例（NF2-03）。

### 3.5 NF-02 冻结校验和与护栏

- HEAD：`migrationChecksum(MIGRATIONS[0])` = `8de041504378a4caf4292a38f6d542100c7b97fe90a4e560d43a623fc98e2dff`，与 `migrations.integration.test.ts` 冻结常量**逐字节一致**。
- 旧 tree `196f56ff`（`c3a581f`）：同一函数 = `6224f5a3353a6f6552dfa452d1a52cce7cdfb150b60c86bd552bfbf8fef9127f`，与 DC-20 记载的 `6224f5a3…` 相符；`git diff 196f56ff HEAD -- schema.ts` 唯一变化就是 `UPDATE_BLOCKED_TABLES` 加入 `assessment`（+7/-1）。
- 护栏有效性：在 scratch 中向 `UPDATE_BLOCKED_TABLES` 加一项模拟「后续就地改 0001」→ 冻结用例失败（实得 `028d5f84…`）；还原后通过。即此后任何 0001 SQL 变化都会被测试拦住，必须追加新迁移。
- 理由可接受性：`git tag -l` 为空、无发布记录，WP-01 仍在实现/复评阶段，不存在已发布或用户持有的库；将一次性开发库按删除重建处理属合理技术修正，且已写入 `discovery.md` DC-20。护栏是测试级而非机制级，但足以强制「改 0001」成为一次有意识的动作。

### 3.6 复评二新发现（NF2-xx）

| id | severity | target | 描述 | 证据 | blocking |
|---|---|---|---|---|---|
| **NF2-01** | **P2（影响 AC-065 验收）** | `packages/storage/src/migrations.ts:158`；AC-065；`data.md` §5；`reliability.md` §8 | `if (!existsSync(backupPath)) backupDatabase(…)` 对**已存在的文件不做任何校验即静默信任**。若上一次备份被中断/失败（SQLite `sqlite3RunVacuum` 的 `end_of_vacuum` 路径**并不删除**输出文件——已读本机 better-sqlite3 13.0.3 amalgamation `sqlite3.c:161602-161885`，无 `sqlite3OsDelete(zOut)`），会留下 0 字节或半写的 `pre-migration-v<version>.sqlite`；下次升级时备份被跳过，`result.backupPath` 仍指向该文件，而它不是升级前副本（0 字节 = 可打开的空库，无 `schema_migrations`/`project` 表）。这是**静默**的安全网失效：调用方被告知有备份，实际没有，与 `reliability.md` §8「中断备份标 incomplete、restore 拒绝」的原则相悖。 | scratch 探针 F（HEAD，退出 0）：预置 0 字节 `pre-migration-v1.sqlite` → `runMigrations(..., {backupDir})` 正常 `applied=[2]`、`backupPath` 指向该文件、`size=0`、`sqlite_master` 为空；同一 0 字节目标直接 `backupDatabase`（无护栏语义）会写出 344064 字节的真实 v1 副本——即护栏使本可自愈的情形变为静默失效。去掉护栏的对照副本上探针 F 失败于 `expected 344064 to be +0`。 | **yes** |
| **NF2-02** | P3 | `packages/storage/test/migrations.integration.test.ts:311-313` | 新增用例中「A resumed attempt for the same version reuses its copy」这一步**空泛**：第三次 `runMigrations` 因为已无 pending 迁移而在 `migrations.ts:147` 提前返回，从不触碰备份逻辑；删除 `existsSync` 护栏后该文件仍 **16/16 通过**（scratch 实测）。该断言无法证明「复用已有副本」，真正的复用以本复评探针 B 为准（去掉护栏即抛 `SqliteError`）。 | scratch `/tmp/wp01-r2/noguard`（HEAD 去掉护栏）：`migrations.integration.test.ts` 16 passed；自建探针 B 抛 `SqliteError: output file already exists`。 | no |
| **NF2-03** | P3 | `packages/core/test/events-hub.integration.test.ts`；RE-14 的 `subscribe` 分支 | §2 NF-03 建议「补 `subscribe(afterCursor)` 分支同类负例」未落实。`events-hub.ts:270` 的过滤逻辑本身正确，但没有用例约束：把该分支回退为「捕获一切」后整个文件仍 **17/17 通过**。 | scratch 回退 `subscribe` 过滤 → 17 passed；恢复 → 17 passed。 | no |

### 3.7 命令证据（复评二实测）

| 命令 | 退出码 | 结果 |
|---|---|---|
| `git rev-parse HEAD` / `HEAD^{tree}` / `git status --short` | 0 | HEAD=`9c634f0ed6232902c5aa46820ccc64c839873849`；tree=`981746cbd665339a1ecdf09bbb627b1bfb0ab38a`；工作区干净 |
| `git show 9c634f0` | 0 | 397 行、8 文件、+236/-19；`implementation.md` 仅改 `:65`/`:109` 两处计数，未改 `:147` |
| `pnpm typecheck` | 0 | `tsc -p tsconfig.json --pretty false` 无错误 |
| `pnpm lint` | 0 | `All matched files use Prettier code style!` |
| `pnpm test:unit` | 0 | 13 文件 / 173 用例通过 |
| `pnpm docs:check` | 0 | 15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages |
| `pnpm vitest run --project integration <6 个目标文件>` | 0 | 6 文件 / **84** 用例通过（16 迁移 + 22 账本 + 17 事件订阅 + 10 需求投影 + 10 分发 + 9 身份） |
| scratch HEAD：NF-01 探针（A/B/C/D/E） | 0 | 5 passed（A 第二次升级无 `SqliteError`；B 复用；C 备份可用；D/F 见 NF2-01；E 名称准确） |
| scratch HEAD：NF-01 探针 F（0 字节遗留） | 0 | 复现 NF2-01（备份被跳过、文件仍 0 字节、空库） |
| scratch noguard：NF-01 探针（去护栏） | 1 | 2 failed：B `SqliteError: output file already exists`、D `SqliteError: file is not a database`；探针 F 失败于 `expected 344064 to be +0` |
| scratch noguard：`migrations.integration.test.ts`（去护栏） | 0 | **16 passed**（证明 NF2-02 空泛） |
| scratch：回退 `poll` 过滤 | 1 | 1 failed / 16 passed（RE-14/NF-03 非空泛性成立） |
| scratch：恢复后 `events-hub` | 0 | 17 passed |
| scratch：回退 `subscribe` 过滤 | 0 | 17 passed（NF2-03：该分支无负例） |
| scratch：HEAD `migrationChecksum(MIGRATIONS[0])` | 0 | `8de04150…` == 冻结常量 |
| scratch：tree `196f56ff` 同函数 | 0 | `6224f5a3…`（与 DC-20 相符） |
| scratch：改 `UPDATE_BLOCKED_TABLES` 后冻结用例 | 1 | 失败（实得 `028d5f84…`）；还原后通过 |

### 3.8 未覆盖与遗留

- 未执行 `pnpm test:integration` 全量（按约定属 Test 角色）；仅复跑任务指定的 6 个文件 + 自建 scratch 探针。WP-00 四文件计数由 `grep -cE "^\s*(it|test)\("` 取得（9+8+10+11=38），未复跑。
- `pnpm build`、`pnpm install --frozen-lockfile` 未复跑；`packages/storage/dist/**` 为未跟踪构建产物，本次未使用（探针走源码）。
- NF2-01 的触发依赖「同版本路径上已存在文件」；仓库当前只有 0001，正常路径不会产生该文件，故现有 16 个迁移用例无法暴露它。探针以中断备份最可能的残留（0 字节文件）复现，并以 SQLite 源码确认失败不清理输出。
- 真实端到端（daemon/BFF/WebSocket/UI）、Git 往返与真实 Provider 仍属 WP-04/WP-08/WP-09/WP-10（DC-23/24/25），与 §1/§2 一致。

### 3.9 复评二结论

**FAIL**

理由：§2 的一项 P1（NF-01）与一项 P2（NF-02）、一项 P3（NF-03）已真正修复并取得非空泛证据（RFC 探针可让去掉护栏的副本失败），首次 RE-01…RE-14 中 12 项 verified、RE-11/RE-12 合理移交（且已有 DC-18/DC-19），NF-05 的 Discovery 归档到位。但本次修复在默认备份路径上引入了新的 **P2（NF2-01）**：`existsSync` 护栏无条件信任既有文件，一次中断的备份会使其静默跳过，`backupPath` 指向不可用的空/半写副本，直接削弱 AC-065「备份后事务迁移」的可验收性；另 `implementation.md:147` 的用例计数（NF-04）与 commit message 自述不符，`poll` 之外的 `subscribe` 分支负例缺失（NF2-03）。按 `workflow.md` §6，影响验收的 P2 阻断，故不能 PASS。

建议处置：① 备份前校验既有副本（如 `PRAGMA integrity_check` + `schema_migrations` 版本匹配，或对 0 字节/非法文件直接重取），或改用带时间戳的独立文件名，使重试必然产生新副本；② 修正 `implementation.md` 的 `:147`（并同步 `:41/:55/:78`）为实测 122；③ 为 `subscribe(afterCursor)` 补非 Resync 错误负例，并把「复用副本」断言改为「失败迁移后重跑且不抛错」；④ 完成后重新独立 Review 与 Test（Test 报告须重新绑定修复后 tree）。

### 3.10 复评期间的并发写入说明

- 复评开始时 `git status --short` 无输出（工作区干净），满足任务前置；HEAD/tree 实测为 `9c634f0…` / `981746c…`。
- 复评期间（09:19:32）**另一 Test 角色 Run 并发完整替换** `.agentdev/work/WP-01/test-report.md`，新内容绑定 HEAD `9c634f0`/`981746c`。该文件非代码或契约文档；`packages/**`、`apps/**`、`docs/**`、`package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`、`vitest.config.ts`、`tsconfig.json` 在复评前后均无改动（`git diff --name-only -- <上述路径>` 为空），因此本复评的代码对象仍是 HEAD tree `981746c…`。
- 本人未修改 `test-report.md`，也不回退它（属另一角色的写入边界）。复评结束时工作区仅 ` M .agentdev/work/WP-01/review.md`（本文）与 ` M .agentdev/work/WP-01/test-report.md`（Test 角色写入）。

## 4. 复评三（re-review 3）

- 复评对象：commit `e02fb8e6c4972e41f5aba9695d765a9f25723eec`，tree `c201f4276c1507fd41f0dd860df91d915c86ac6c`（`git rev-parse HEAD` / `git rev-parse HEAD^{tree}` 实测）。
- 工作区：`git status --short` 无输出（复评开始与结束时均干净）；仓库 tracked 文件仅本文追加。
- 上游对象：`9c634f0`/`981746c`（§3 复评对象）、`8e96ee2`/`f1589696…`（§2）、`c3a581f`/`196f56ff…`（§1）。
- 方法：独立上下文，不读开发聊天。读 §1–§3、`implementation.md` 处置表（§2 的 RE/NF2 表）、`git show e02fb8e` 全量 diff（6 文件、+505/−197）、HEAD 源码/测试与 `data.md` §5、`reliability.md` §8、AC-065；在 `/tmp/wp01-r3/head` 的 HEAD `git archive` 副本（`node_modules` 符号链接）中运行 **12 项自建探针** 与 **4 组「回退修复」变异实验**，仓库代码未改动（每次变异后用 `git show HEAD:<file>` 比对还原，逐字节一致）。
- 本轮 commit 的改动面：`packages/storage/src/migrations.ts`（备份护栏与原子发布）、两个测试文件、`implementation.md`；`schema.ts`、`requirements.ts`、`events-hub.ts`（除测试注入目标外）等 RE 相关源码未动。

### 4.1 重点项 NF2-01：备份校验与原子发布（任务书 a–e，自建探针）

探针文件：`/tmp/wp01-r3/head/packages/storage/test/r3-probe.integration.test.ts`（12 用例全绿，退出 0；仅在 scratch，不入库）。命令：`node_modules/.bin/vitest run --project integration packages/storage/test/r3-probe.integration.test.ts`。

| 探针 | 场景 | 实测结果 | 判定 |
|---|---|---|---|
| a | 预置 **0 字节** `pre-migration-v0.sqlite` | `applied=[1]`；目标被替换为 8192 字节真库；目录内仅该文件 | ✅ 修复成立 |
| b | 预置 **4096 字节 'A' 垃圾**（非空、非库） | 被替换；重开副本 `integrity_check=ok`、ledger=[]；大小 8192 | ✅ |
| b2 | 预置**真实多页库截断一半**（331776→截到 4096 边界） | 被拒绝并替换为 8192 字节新副本；副本 `integrity_check=ok`、ledger=[] | ✅ 说明护栏不只看「文件存在」 |
| c | 源版本（v1）上预置**带哨兵表的有效副本** | v1→v2 升级后副本**字节完全不变**（`after.equals(before)`）、哨兵表仍在、`step_1` 不存在、`backupPath` 指向该副本 | ✅ 复用而非重写 |
| c2 | 另一个已存在的有效副本（v0 命名） | 第二次升级（不同目标名）后仍存在且字节不变 | ✅ 有效副本不被 `rmSync` |
| d | 预置陈旧 `pre-migration-v0.sqlite.partial` | 成功运行后备份目录 = `["pre-migration-v0.sqlite"]`，无 `.partial` 残留 | ✅（替换分支；复用分支见 NF3-03） |
| e | 成功迁移后的副本可读性与状态 | 只读打开 `integrity_check=ok`、有 `schema_migrations`、**无** `step_1`、ledger=[]；同刻 live 库 ledger=[1] | ✅ 副本确为迁移前状态 |
| g | **无待迁移**时备份目标是否被触碰 | 待迁移时 0 字节/垃圾目标被修复；随后把同一目标写成 `garbage-2` 再跑（`applied=[]`、无 `backupPath`）→ 文件仍为 `garbage-2` | ✅ 整个备份块（含 `integrity_check`）只在待迁移路径执行，**不在每次启动执行** |

结论：NF2-01 的核心缺陷（中断的 `VACUUM INTO` 残留使升级前备份被静默跳过）已真正修复；副本先写 `.partial` 再 `rename` 发布，成功路径不残留 `.partial`，复用前先验证可读性与完整性。`integrity_check` 开销仅在待迁移路径、且仅在目标已存在时发生；实测 52.8 MiB 副本约 **110 ms**（`sqlite-cost-probe.mjs`），可接受。

### 4.2 NF2-02 / NF2-03：新用例的非空泛性（回退修复实验）

变异均在 scratch 副本进行，`packages/storage/src/migrations.ts` 与 `packages/core/src/events-hub.ts` 变异后用 `git show HEAD:<file>` 逐字节还原。

| 实验 | 变异 | 结果 | 说明 |
|---|---|---|---|
| A（回退 NF2-01） | `if (isUsableBackup(target))` → `if (existsSync(target))` | `migrations.integration.test.ts` **1 failed / 16 passed**，失败在 `:316`（0 字节副本上 `schema_migrations` 期望 defined 实得 undefined） | 证明「0 字节残留被替换」断言受被测代码支配 |
| C（反向变异） | `if (isUsableBackup(target))` → `if (false)`（永远重取备份） | 同文件 **1 failed / 16 passed**，失败在 `:334`（哨兵表期望 defined 实得 undefined） | 证明哨兵断言确实约束「复用而非重写」 |
| B（回退 NF2-03） | 删除 `subscribe` 分支的 `if (!(error instanceof ResyncRequiredError)) throw error;` | `events-hub.integration.test.ts` **1 failed / 17 passed**：`expected [Function] to throw error including 'disk failure' but got 'cursor 1 is no longer retained'` | 新负例非空泛 |
| P（NF-03 复查） | 删除 `poll` 分支同一过滤 | **1 failed / 17 passed**：`... but got 'subscription cursor was truncated'` | RE-14/NF-03 结论未回归 |

诚实说明：哨兵断言（实验 C）只能区分「复用 vs 重写」，不能区分 `isUsableBackup` 与 `existsSync`（两者都会复用），因此 NF2-02 的证明力来自「0 字节替换（A）+ 哨兵（C）」的组合；§3 所指「第三次调用因无待迁移提前返回」的问题已消除——本用例第二次调用确有 pending 迁移（v1→v2），变异 A 下会真实走到备份分支并失败。

### 4.3 e02fb8e 新缺陷审查（任务书第 4 项）

| 审查点 | 实测/结论 |
|---|---|
| 备份跨**不同来源版本**被复用 | **存在，但仅在显式 `backupPath` 且无 hook 时**。探针 F（走 `runMigrations(db,[m1,m2],{backupPath: 固定路径})`）：v0→v1 生成副本后，v1→v2 报 `backupPath` 仍为该文件且与 v0 副本**逐字节相同**（副本内部 ledger=[]，即 v0 而非 v1）。默认路径不受影响：文件名内嵌 `currentVersion`，来源版本必然匹配。见 NF3-01。 |
| 原子 rename 是否被遗留 `.partial` 击败 | **不会**：替换分支先 `rmSync(partial,{force:true})` 再写、再 rename；预置旧 `.partial` 的实验 d 成功且无残留。复用分支不清理 `.partial`（仅垃圾文件，见 NF3-03）。 |
| `rmSync` 是否删掉有效副本 | **不会**（探针 c/c2）：有效副本一律走复用分支；被删除的只有 `isUsableBackup=false` 的对象。唯一反向偏差是 1 字节文件被误判为「有效」（NF3-02）。 |
| `integrity_check` 是否每次启动都跑 | **否**，只在有 pending 迁移时（探针 g + `migrations.ts:170` 的提前返回）；单次成本约 110 ms/52.8 MiB。 |
| 其他 `runMigrations` 调用方 | 全仓非测试调用方只有 `ProjectStore.open`（`store.ts:170`，传默认 `backupDir`，版本化命名 → 安全）；`packages/core/test/*`、`packages/storage/test/ledger` 传 `backup: () => undefined` 的 hook，走 hook 分支、完全不经过新护栏。故该信任问题仅限「显式 `backupPath` 且不传 hook」这一未使用的组合（NF3-01）。 |
| 其他回归 | `:memory:` + `backupPath` 现在会抛裸 `ENOENT`（NF3-04）；仓库无该用法（`sqlite.ts:16` 仅注明测试可用 `:memory:`，`backupDatabase` 对 `:memory:` 主动 no-op）。 |

### 4.4 NF-04：用例计数复核（按文件内容与实跑）

- **unit**：13 文件 / **173** 用例（`pnpm test:unit` 实跑 13 passed / 173 passed），与 `implementation.md:155` 一致。
- **integration**：10 文件 / **124** 用例。逐文件计数（`grep -cE "^\s*(it|test)(\.(each|skip|only|todo))?\s*\("`，与实跑一致）：migrations **17**、ledger **22**、dispatcher **10**、events-hub **18**、identity **9**、requirements **10**（WP-01 六文件合计 86）、session **11**、attempt **10**、doctor **8**、container **9**（WP-00 四文件合计 38）；86+38=**124**。
- `implementation.md:156` 的「10 文件 / 124 用例（17+22+10+18+9+10；另含 11/10/8/9）」逐项吻合；`§T3:41`（17）、`§T4:55`（22）、`§T6:78`（18）、`:65`（dispatcher 10）、`:109`（需求投影 10）、`:18`（entities 12）、`:30`（domain 28）、`:95`（auth 18 / identity 9）均一致。
- 结论：**NF-04 已完全修复**（§3 遗留的 `:147` 已按实测更新为 `:156`）。注：unit 的「文件内 `it(` 计数」与运行数不同（`it.each` 展开），故 unit 用例数只以实跑 173 为准；integration 各文件两者一致。

### 4.5 首次与二次复评发现逐项判定（RE-01…RE-14、NF-01…NF-05、NF2-01…NF2-03）

e02fb8e 未触碰下列源码，除注明外均为「HEAD 复核 + 本次 6 个集成文件/unit 实跑」确认未回归。

| id | 原级别 | 判定 | HEAD 证据（本轮实测/复核） |
|---|---|---|---|
| RE-01 | P1 | **verified** | `requirements.ts:31/35/234/238` 仍为目录 `.agentdev/requirements/<id>`；相关用例在本次 6 文件实跑中通过 |
| RE-02 | P1 | **verified** | `requirements.ts:113` `withTransaction(this.store.db, () => this.apply(input))`；「事件失败不留行」用例通过 |
| RE-03 | P2 | **verified** | `schema.ts:58-64` `UPDATE_BLOCKED_TABLES` 含 `assessment`；不可变负例通过（`DELETE_BLOCKED_TABLES` 仍不含 assessment，属既有观察项，非本次范围） |
| RE-04 | P2 | **verified** | `store.ts:173` 默认传 `backupDir: defaultBackupDir(dataDir)`；ledger 22 用例（含默认接线用例）实跑通过 |
| RE-05 | P2 | **verified** | `requirements.ts:79-88` 支持 `rawMetadata` 原始字节；字节 Hash 用例通过（调用方义务仍归 WP-04/WP-08，DC-23） |
| RE-06 | P2 | **verified** | `transitions.ts:47-48` 含 `review: ['test','done','develop']`、`test: ['done','develop']` |
| RE-07 | P2 | **verified** | `auth.ts:152` 重载返回 `new InstallationCredential(path, undefined)`；auth 18 用例通过 |
| RE-08 | P2 | **verified** | `dispatcher.ts:52/172` `scope` 区分 + 缺 `projectId` 返回 VALIDATION_ERROR；dispatcher 10 用例通过 |
| RE-09 | P2 | **verified（已完全修复）** | 范围矛盾已消除，计数按实测更新；本轮 NF-04 复核全部吻合（§4.4） |
| RE-10 | P3 | **verified** | `dispatcher.ts:254` `return outcome.response;`（死三元已删） |
| RE-11 | P3 | **accepted_risk_deferred（归 WP-09）** | 文档不一致仍在，`discovery.md` DC-18 有记录与路由 |
| RE-12 | P3 | **accepted_risk_deferred（归 WP-02/WP-06）** | `structures.ts` `productRef?`/`rollback` 可空仍在，`discovery.md` DC-19 有记录与路由 |
| RE-13 | P3 | **verified（残留注释笔误）** | `system.ts:136` 用 `operationKindSchema`；`:135` 注释仍写 “eight operation kinds”（实为 7），属既有 P3 文案瑕疵，非回归 |
| RE-14 | P3 | **verified（两条分支均非空泛）** | `events-hub.ts:270`（subscribe）、`:339`（poll）仅转换 `ResyncRequiredError`；变异 B/P 分别使对应用例失败（§4.2） |
| NF-01 | P1 | **verified** | 版本化命名 + 默认接线；探针 a/b2/c/e/g 全绿（§4.1） |
| NF-02 | P2 | **verified** | `frozen migrations` 用例实跑通过；e02fb8e 未改 `schema.ts`，冻结校验和 `8de04150…` 未变 |
| NF-03 | P3 | **verified** | poll 分支非空泛（变异 P，1 failed/17），未回归 |
| NF-04 | P3 | **verified（本轮完全修复）** | 见 §4.4，unit 173、integration 124 与逐项计数全部吻合 |
| NF-05 | P3 | **① verified ② 回归（见 NF3-05）** | ① `discovery.md` 含 DC-18…DC-25 且路由完整；② `test-report.md:1` 仍绑定 `9c634f0`/`981746c`，不覆盖 e02fb8e 树 |
| NF2-01 | P2 | **verified（已修复）** | 探针 a/b/b2/c/c2/d/e/g + 变异 A/C（§4.1/§4.2） |
| NF2-02 | P3 | **verified（已修复）** | 真实待迁移 + 哨兵表；变异 A/C 使该用例失败 |
| NF2-03 | P3 | **verified（已修复）** | 新负例在变异 B 下失败（1 failed/17） |

### 4.6 复评三新发现（NF3-xx）

| id | severity | target | 描述 | 证据 | blocking |
|---|---|---|---|---|---|
| **NF3-01** | **P3** | `migrations.ts:178-195`；`RunMigrationsOptions.backupPath` | 显式 `backupPath` 且无 `backup` hook 时，复用判定只校验「可读且 `integrity_check=ok`」，不校验副本的**来源版本**。固定路径在第二次升级时会把 v0 副本当作 v1→v2 的「升级前副本」返回。默认路径（`ProjectStore.open` 的 `backupDir`，文件名含版本）不受影响，仓库内也无该用法（唯一生产调用方走默认路径，测试调用方传 hook），故不阻断 WP-01 验收；但 `backupPath` 的注释承诺「caller 不会因忘记 hook 而跳过备份」，此处会返回过期副本。建议：复用前比对副本的 `schema_migrations` 最高版本 == `currentVersion`（或对显式 `backupPath` 强制 `.partial` + rename 重取）。 | 探针 F：v0→v1 后 v1→v2 的 `backupPath` 与 v0 副本逐字节相同，副本 ledger=[] | no |
| **NF3-02** | **P3** | `migrations.ts:24-37` | 1 字节残留文件被 `isUsableBackup` 判为可用：better-sqlite3/SQLite 把 1 字节文件当作**空数据库**，`integrity_check` 返回 `ok`、`sqlite_master` 为空，于是被复用为「备份」（`size===0` 只挡了 0 字节）。2…4095 字节垃圾与真实截断均被正确拒绝（截断到 4096 边界会 `database disk image is malformed`）。由于新代码只在 `.partial` 上写入、目标只经 rename 出现，生产中已不会再产生此类文件，故仅剩「旧版本遗留」这一窄场景，不阻断验收。建议校验副本含 `schema_migrations`（或页数 ≥1）。 | 探针 I：1 字节目标迁移后仍为 1 字节且 `backupPath===target`；`sqlite-size-probe.mjs` 显示 0/1 字节 `integrity=ok`、≥2 字节抛 `file is not a database` | no |
| **NF3-03** | **P3** | `migrations.ts:181-184` | 复用分支不清理陈旧 `<target>.partial`；成功运行后该文件残留（不会被读取，替换分支下次会删）。与「成功路径不留 `.partial`」的意图不符，属垃圾文件堆积，无正确性影响。建议在复用分支同样 `rmSync(partial,{force:true})`，并补一条 `.partial` 不残留断言。 | 探针 J：成功运行后目录 = `["pre-migration-v0.sqlite","pre-migration-v1.sqlite","pre-migration-v1.sqlite.partial"]` | no |
| **NF3-04** | **P3** | `migrations.ts:176-195` vs `backupDatabase:234` | `backupDatabase` 对 `db.name === ':memory:'` 主动 no-op，但新代码随后无条件 `renameSync(partial,target)`，使「`:memory:` + `backupPath`」抛出**裸 `Error: ENOENT`**（不是 `StorageError`）。旧代码在该组合下静默返回无文件的 `backupPath`。仓库无该调用组合（生产恒为文件库），属潜在 API 回归。建议 `:memory:` 时整块跳过或在 `backupDatabase` 返回是否写出。 | 探针 H：`Error: ENOENT: no such file or directory, rename '…/mem.sqlite.partial' -> '…/mem.sqlite'` | no |
| **NF3-05** | **P3** | `.agentdev/work/WP-01/test-report.md`；workflow §7 | Test 报告 §1 绑定 `9c634f0`/`981746c`，但 e02fb8e 再次改了代码（`migrations.ts` + 两个测试文件），该报告不覆盖本轮复核树 → **NF-05② 回归**。按 workflow §7「Test 后代码变更 → 重新独立 Test」，结算前需 Test 角色重跑并重新绑定 e02fb8e（全量 `test:integration` 归 Test，本 Review 未执行）。 | `test-report.md:11-16`；`git show --stat e02fb8e`（含该文件但内容仍为 9c634f0 的并发写入结果） | no（流程项，非代码缺陷） |

### 4.7 命令证据（复评三实测）

| 命令 | 退出码 | 结果 |
|---|---|---|
| `git rev-parse HEAD` / `HEAD^{tree}` / `git status --short` | 0 | HEAD=`e02fb8e6c497…`；tree=`c201f4276c15…`；工作区干净（复评前后均干净） |
| `pnpm typecheck` | 0 | `tsc -p tsconfig.json --pretty false` 无错误 |
| `pnpm lint` | 0 | `All matched files use Prettier code style!` |
| `pnpm test:unit` | 0 | 13 文件 / 173 用例通过 |
| `pnpm docs:check` | 0 | 15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages |
| `pnpm vitest run --project integration <migrations,ledger,dispatcher,events-hub,requirements,identity>` | 0 | 6 文件 / **86** 用例通过（17+22+10+18+9+10） |
| scratch：`r3-probe.integration.test.ts`（12 探针） | 0 | 12 passed（§4.1/§4.3 的 A/B/B2/C/C2/D/E/F/G/H/I/J） |
| scratch：变异 A（`existsSync` 回退 NF2-01）→ migrations 测试 | 1 | 1 failed / 16 passed（`:316`） |
| scratch：变异 C（永远重取备份）→ migrations 测试 | 1 | 1 failed / 16 passed（`:334` 哨兵） |
| scratch：变异 B（回退 subscribe 过滤）→ events-hub 测试 | 1 | 1 failed / 17 passed |
| scratch：变异 P（回退 poll 过滤）→ events-hub 测试 | 1 | 1 failed / 17 passed |
| scratch：`sqlite-size-probe.mjs`（0…8000 字节） | 0 | 0/1 字节 `integrity=ok`；2…8000 字节 `file is not a database` |
| scratch：`sqlite-trunc-probe.mjs`（页边界截断） | 0 | 截断到 4096 边界的真库一律 `database disk image is malformed` |
| scratch：`sqlite-cost-probe.mjs` | 0 | 52.8 MiB 副本 `integrity_check` ≈ 110 ms |
| scratch：变异后用 `git show HEAD:<file>` 比对还原 | 0 | `migrations.ts`、`events-hub.ts` 与 HEAD 逐字节一致 |

### 4.8 未覆盖与遗留

- 未执行全量 `pnpm test:integration`（按约定归 Test）；WP-00 四文件（session/attempt/doctor/container）的 11/10/8/9 计数由文件内容 `grep` 取得，未复跑。
- 未复跑 `pnpm build`、`pnpm install --frozen-lockfile`。
- NF3-05：Test 证据需重新绑定 e02fb8e 树后 WP-01 才能进入结算（Settlement 前必须完成）。
- 真实端到端（daemon/BFF/WebSocket/UI）、Git 往返与真实 Provider 仍属 WP-04/WP-08/WP-09/WP-10（DC-23/24/25），与 §1–§3 一致。
- 遗留文案：`packages/contracts/src/entities/system.ts:135` 注释 “eight operation kinds” 应为 7（§2 已记，非回归）。

### 4.9 复评三结论

**PASS**

理由：本轮重点 NF2-01 的核心缺陷已真正修复——0 字节与截断/垃圾残留都会被校验拒绝并以 `.partial` + 原子 rename 重取，有效副本被原样复用，成功路径不残留 `.partial`，副本可读且确为迁移前状态；`integrity_check` 只在待迁移路径发生。NF2-02/NF2-03 的新用例经回退实验证明**非空泛**（变异 A/C/B/P 均令对应用例失败），NF-04 计数与实测完全吻合，RE-01…RE-14、NF-01…NF-03 逐项复核无回归，`typecheck`/`lint`/`test:unit`/`docs:check` 与 6 个 WP-01 集成文件（86 用例）全部退出 0。本轮新发现 5 项均为 **P3**：NF3-01（显式 `backupPath` 跨版本复用，生产默认路径不受影响）、NF3-02（1 字节文件被 SQLite 视为空库；生产路径已不会再产生）、NF3-03（复用分支残留 `.partial`）、NF3-04（`:memory:` + `backupPath` 抛裸 ENOENT，仓库无此用法）、NF3-05（Test 报告未绑定本轮树，流程项）。按 `workflow.md` §6，无 P0/P1、无影响 WP-01 验收的 P2，故不阻断。

建议处置（不阻断本次 PASS）：
1. 备份复用判定增加「来源版本匹配」校验（比对副本 `schema_migrations` 最高版本；至少覆盖显式 `backupPath`），并在 `:memory:` 时跳过整块或让 `backupDatabase` 返回写出结果（NF3-01/NF3-02/NF3-04）；
2. 复用分支同样清理 `.partial` 并补断言（NF3-03）；
3. **结算前**由 Test 角色重跑并重新绑定 e02fb8e 树（NF3-05），全量 `test:integration` 与 `pnpm build` 一并补齐。
