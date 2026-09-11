# WP-01 实现记录（数据、状态与协议核心）

状态：**进行中**（2026-09-11）。Plan 见 `plan.md`；本文件按任务追加实际实现与证据，结算时合并为最终记录。

## 1. 已完成任务

### T1 contracts/entities（完成）

`packages/contracts/src/entities/`：

- `common.ts`：JSON 值/对象 Schema、数组上限 1000、实体基础五列、`blobRefFields`、snapshot 类型。
- `project.ts`：project、conversation、message_body（所有权结构性约束）、user_action、message、attachment、ProjectSummary、CallerIdentity。
- `work.ts`：work、requirement（含 portableRef/recordVersion/executionAvailability）、task、assessment、authorization、decision、discovery、finding、PortableRequirement/RequirementMetadata（生命周期必需摘要约束）。
- `run.ts`：run、attempt、stage_result、snapshot、grant（scope 绑定约束）、budget（used+reserved≤limit）、tool_operation、lease、SessionRef、operationKind。
- `system.ts`：artifact（agent/user 归属约束）、command（幂等账本）、event、outbox、operation、feature_projection。
- `structures.ts`：Assessment、ContextSelection、Profile、ConfigLimits/ConfigPatch、ProviderInput/ModelDescriptor、Professional/Chief/DispatchSpec、DispatchSnapshot、ProductDefinition、Plan/CompactPlan、CheckResult、Review/Test/SettlementResult、Verification/CompletionManifest、StageResult。

证据：`packages/contracts/test/entities.test.ts` — 12 用例，含"覆盖 `data.md` §2 全部 28 张表"的表清单断言、每表最小合法行、每表未声明字段拒绝，以及逐条文档约束负例（message_body 归属、finding taskId、grant scope、artifact 归属、budget 上限、requirement 生命周期、枚举/路径/Hash/时间格式）。

### T2 packages/domain（完成）

新增包 `@agentdev/domain`（仅依赖 contracts）：

- `transitions.ts`：Work/Requirement/Task/Run/Attempt 五张转换表 + 终态判定 + phase 前进 + archived 恢复目标。
- `routing.ts`：`workflow.md` §2 的等级判定顺序（none → operation L3 → 锁定风险 L3 → L1 全条件 → 默认 L2）、L1 上下界与失败原因、锁定风险清单。
- `permission.ts`：Grant 全匹配判定（scope 绑定、角色/阶段/操作、过期、once 同操作同 Hash 复用、目标前缀覆盖）与目标路径安全检查。
- `dispatch.ts`：DispatchSpec 校验（Chief 只允许 analysis/artifact、专业必须 parentRunId、ContextSelection 逐源理由）、预算分配与返工轮次判定、Chief 直接子级判定。
- `requirement.ts`：导入判定（new/unchanged/update/conflict，比较 recordVersion+recordHash）、写阻断、启动前提、executionAvailability、content.md 六个二级标题结构校验。

证据：`packages/domain/test/domain.test.ts` — 28 用例。

### T3/T4 packages/storage（迁移部分完成）

新增包 `@agentdev/storage`：

- `ids.ts`：UUIDv7 生成、SHA256、UTC 毫秒时间、requirement recordHash 公式、projectId=SHA256(canonicalRoot)[0:32]。
- `sqlite.ts`：按 `data.md` §1 应用 `foreign_keys=ON`、`journal_mode=WAL`、`synchronous=FULL`、`busy_timeout=5000`；`withTransaction` 以 `BEGIN IMMEDIATE` 实现邮箱写事务边界。
- `schema.ts`：迁移 0001 全量 DDL（28 张业务表 + 索引 + 不可变触发器），枚举 CHECK、JSON `json_valid`、数组上限、非负/上限 CHECK、唯一约束（message/attempt/command/lease/feature_projection/outbox）与项目内外键。
- `migrations.ts`：`schema_migrations(version,name,checksum,applied_at)`、逐条 checksum 校验、版本超前拒绝、备份后逐条事务迁移、失败回滚并报版本。

证据：`packages/storage/test/migrations.integration.test.ts` — 14 用例（真实 SQLite 文件）：迁移幂等、pragma 断言、迁移前备份可用、checksum 不一致停止、文件版本超前停止、失败迁移回滚且不留部分表、每张表列与实体 Schema 一致、基础五列、唯一约束、枚举/JSON/数组/外键 CHECK 负例、event/snapshot/user_action 不可变触发器。

### T4 仓储与账本（完成）

- `repository.ts`：规格驱动的 `EntityRepository`（`fromColumns` 逐行用契约 Schema 复核，写入走 `version` CAS），`VERSION_CONFLICT`/`NOT_FOUND`/`DUPLICATE_KEY`/`CONSTRAINT_VIOLATION`/`BUSY` 映射；`TABLES` 覆盖 `data.md` §2 全部 28 张表的 JSON/布尔列与内部列。
- `commands.ts`：幂等账本 `begin`（同键同载荷→`replay` 原结果、同键异载荷或异主体→`conflict`、并发插入竞争后重读）、`complete`、按主体取回的 `lookup`、`pruneBefore`。
- `events.ts`：`append` 返回自增 cursor、`readAfter`（含名称过滤与截断检测）、`latestCursor`/`oldestCursor`、`truncateBefore`；游标早于保留窗口时抛 `RESYNC_REQUIRED`。
- `outbox.ts`：`enqueue` 按 operationId 去重、`claim`（30 秒 lease，仅 pending 或租约过期可领取，attempts 自增）、`complete`/`release`/`pending`/`countByState`。
- `leases.ts`：`acquire`（resource 唯一、过期可接管并报告 `replacedExpired`、同 owner 同 epoch 幂等）、`renew`/`release`（校验 owner+epoch）、`expired`/`releaseExpired`/`releaseAll`。
- `blobs.ts`：内容寻址写入（临时文件 + fsync + 校验 Hash 后原子 rename）、`readVerified`、`BLOB_MISSING`/`BLOB_MISMATCH`、路径逃逸拒绝、`collectGarbage` 离线清理。
- `store.ts`：`ProjectStore.open` 先迁移再暴露 28 个仓储与账本/事件/outbox/lease/blob 句柄。

契约修正（依据文档复核）：`project.id` 改为 `projectIdSchema`（`SHA256(canonicalRoot)[0:32]`，`ARCHITECTURE.md` §4）并同步 DDL `length(id)=32`；新增 `entityIdSchema`（UUIDv7 或 project id），供 event 目标与 `SourceRef` 引用项目时使用；`event` 的不可变策略细化为"禁 UPDATE、允许保留期截断 DELETE"。

证据：`packages/storage/test/ledger.integration.test.ts` — 21 用例（真实 SQLite + 真实 blob 目录）：**丢应答重试返回原结果且效果只发生一次**、同键异载荷/异主体冲突、事件 cursor 单调与截断后 `RESYNC_REQUIRED`、事件禁改、outbox 租约内不重投与过期重领、lease 抢占与 owner 校验、blob 原子写入/缺失/损坏/GC、CAS 冲突与重复键。

### T5 ProjectMailbox 与命令分发（完成）

`packages/core/src/`：

- `mailbox.ts`：短命令**串行**执行（单 Project 单邮箱、FIFO、峰值并发 1）；队列准入 256 项 / 4MiB，超限立即返回 `BUSY`（带 reason 与 limits）；单条命令超过 100ms 记 `SLOW_COMMAND` 诊断；长操作走 `runEffect`，**不进入队列**（模型/Shell/Git/Child 等待在事务外），并以 EFFECT_STARTED/FINISHED/FAILED 诊断暴露在飞状态；`drain`/`close`/`stats`。
- `errors.ts`：`protocol.md` §7 全部 25 个错误码、retryable 默认策略（仅 BUSY 及显式标注的 Provider 瞬时错误）、请求/响应 Envelope 与 `okResponse`/`errorResponse`。
- `dispatcher.ts`：Envelope 校验（v=1、type、id、method、projectId 归属、params Schema）、读方法绕过邮箱、写方法经邮箱串行；`idempotencyKey` 1–128 与 `expectedVersion` ≥0 校验、规范化 payload Hash（键序无关）、单事务内完成"幂等账本→领域行 CAS→event→outbox→记录 response"；冲突/存储错误映射为文档错误码（`VERSION_CONFLICT` 带 `currentVersion`）；处理函数必须同步，异步即 `INTERNAL_ERROR`。

证据：`packages/core/test/mailbox.test.ts`（8 用例，unit）——串行与顺序、**长模型调用在飞时命令 <1 秒返回且不排队**、队列项/字节超限 BUSY、排空后可再准入、关闭后拒绝、>100ms 诊断、失败命令不阻塞队列、effect 失败诊断。`packages/core/test/dispatcher.integration.test.ts`（9 用例，真实 SQLite）——**丢应答重试返回完全相同响应且 event/outbox 不重复**、同键异载荷 `IDEMPOTENCY_CONFLICT`、`VERSION_CONFLICT` 带 `currentVersion` 且未记账、处理函数失败时账本/事件/outbox 全部回滚、邮箱满时 `BUSY` 且未执行、长 effect 在飞时写命令 1 秒内返回、规范化 Hash 稳定性。

### T6 EventHub 与订阅（完成）

`packages/core/src/events-hub.ts`：

- 订阅作用域 summary/conversation/work/run；`subscribe` 首次返回**快照**、带 `afterCursor` 时返回 `replay`（只补发游标之后且 ≤ 边界的事件），游标被保留期截断时 `RESYNC_REQUIRED`。
- `setScope` 作用域变更**始终**返回新快照与新的水位游标（AC-060：快照+C 后事件完整覆盖新增范围）。
- `poll` 返回事件批次 + `scannedThrough`（空批次也发水位）+ `batchEnd`；`ack` 单调前进（回退拒绝、超出水位钳制）。
- 每连接输出队列：软限 2MiB 合并/去重临时帧、硬限 8MiB **关闭该连接**；持久事件始终留在库中（AC-059），其它订阅不受影响。
- 快照读取与游标的一致性顺序：**先读快照行，再取水位**，因此快照不会早于其游标（最多重复投递，绝不丢事件）。
- `scan` 扫描已提交事件并报告 `laggingSubscriptions`。

证据：`packages/core/test/events-hub.integration.test.ts` — 16 用例：快照与水位一致、replay 只补发范围内事件、截断后 `RESYNC_REQUIRED`、作用域扩大后快照+C 无缺口、空批次水位、ack 回退拒绝与钳制、连接关闭级联、软限合并与 merged 计数、**硬限关闭慢连接且事件仍可被其它订阅读到**、批量扫描水位、作用域匹配规则。

### T7 连接认证与 Project 身份（完成）

`packages/core/src/auth.ts`：

- 安装凭证：`~/.agentdev/installation-token`，创建 0600 且**只显示一次**（`createdToken`）；模式被放宽时重新收紧并校验；`timingSafeEqual` 比对；`Authorization: Bearer` 解析。
- 登录：`/auth/login` 成功返回 `HttpOnly; SameSite=Strict`（remote 部署加 `Secure`）cookie + CSRF token，24h 过期；失败 401，**每 IP 每分钟 5 次**超限 429（带 retryAfterSec，窗口滑动）；logout 清会话并下发 `Max-Age=0`。
- 请求认证：无 cookie→`UNAUTHENTICATED`，过期→`AUTH_EXPIRED`（并即时丢弃），Origin 不在白名单→403，写请求 CSRF 不匹配→403（AC-078）。
- Origin 策略：显式白名单**精确匹配**；无白名单时 loopback 部署允许 http+loopback，remote 部署只允许 https。

`packages/core/src/identity.ts`：

- `realpath` 规范化（含符号链接）、向上查找 `.git` 得到仓库根、`projectId=SHA256(canonicalRoot)[0:32]`；子目录/尾斜杠/符号路径归一到同一 Project（AC-024）。
- 嵌套独立仓库扫描（深度可限）、`isInsideNestedRepo`/`nestedRepoExclusions`/`requireOwnIdentity`：父项目排除嵌套仓库路径且必须单独打开（AC-024）。
- 两个真实 Git 根 → 不同 projectId 且各自独立 SQLite（AC-023）。

证据：`packages/core/test/auth.test.ts`（18 用例，unit）与 `packages/core/test/identity.integration.test.ts`（9 用例，真实 `git init` 仓库、真实符号链接、真实 SQLite）。

### T8 需求投影（完成，AC-092 部分）

`packages/core/src/requirements.ts`：

- `portableRequirementSchema` 校验后计算 `metadataHash`/`recordHash`（`requirementRecordHash(metadataHash, contentHash)`）。
- 导入判定复用 domain `classifyImport`：`new` 建行、`unchanged` 不写、`update` 以 CAS 刷新、同 recordVersion 异内容或更旧版本 → `conflict`。
- 冲突**不改行**，只写 `requirement.save_failed` 诊断事件（带 reason/recordVersion/Hash），返回结构化冲突信息。
- 本地执行字段：`workId` + `executionAvailability`（active 且无 Work → `needs_replan`）；`phase`/`finalManifestId` 在导入时为缺省。
- 非法记录在写库前抛 `RequirementRecordError`（VALIDATION_ERROR）。

存储层加固：`EntityRepository` 支持 `defaultProjectId`，`ProjectStore` 为所有仓储注入本项目 id（`project` 行因 id 即项目 id 而排除），从结构上防止行落入错误项目。

证据：`packages/core/test/requirements.integration.test.ts` — 8 用例：建行与 portableRef、绑定本地 Work、**同记录重复导入不产生第二次写入**、版本推进刷新投影、同版本异内容冲突且行未变、降级冲突、非法记录不落库、metadata/record Hash 分离。

## 2. 独立 Review 发现与处置（2026-09-11）

首次独立 Review（`.agentdev/work/WP-01/review.md`，对象 tree `196f56ff…`）判定 **FAIL**，2 项 P1 阻断与 12 项 P2/P3。处置如下（全部已修复并补测，复评见 `review.md` 追加小节）：

| 编号 | 级别 | 问题 | 处置 |
|---|---|---|---|
| RE-01 | P1 | `portableRef.path` 写成 `requirements/<id>/requirement.json`（单文件、缺前缀） | 改为目录 `.agentdev/requirements/<id>`（`data.md` §6、`requirements.md` §1）；`sourceRef` 同步指向目录并携带 revision/hash；测试期望随之修正 |
| RE-02 | P1 | 需求导入的行写入与事件写入不在同一事务 | `RequirementProjection.import` 整体包进 `withTransaction`；新增"事件写入失败则行不存在、重试可成功"用例 |
| RE-03 | P2 | `assessment` 未按文档设为不可变 | 加入 `UPDATE_BLOCKED_TABLES`，迁移测试新增"重评必须是新行"负例 |
| RE-04 | P2 | 迁移前备份仅在显式注入回调时发生 | `runMigrations` 在给定 `backupPath` 而无回调时直接 `backupDatabase`；`ProjectStore.open` 默认 `<stateDir>/backups/pre-migration.sqlite`；补默认路径用例 |
| RE-05 | P2 | metadataHash 取再序列化结果而非文件字节 | `metadataHashOf/recordHashOf` 支持传入 `rawMetadata` 原始字节（Git 导入路径）；补字节 Hash 用例 |
| RE-06 | P2 | Task 转换表缺 `review→develop`、`test→develop` | 依 `workflow.md` §5.2 补入并加断言 |
| RE-07 | P2 | 重新加载凭证时仍保留明文 token，`revealOnce()` 可再次取回 | 加载路径不再保留明文；测试断言重载后 `revealOnce()` 为 undefined |
| RE-08 | P2 | Project 方法不强制 `projectId` | `OperationDefinition.scope`（默认 `project`）区分全局/项目方法；缺 `projectId` 返回 VALIDATION_ERROR，补 `connection.hello` 全局方法用例 |
| RE-09 | P2 | 实现记录自相矛盾、用例计数过时 | 本节即修正；用例计数按实测更新 |
| RE-10 | P3 | dispatcher 死三元 | 删除 |
| RE-11 | P3 | 文档内部不一致：`project.create` 要求 name 但 project 表无 name 字段 | 记为 Discovery（DC-18），归 WP-09 产品/协议处置 |
| RE-12 | P3 | `planSchema` 未表达非 L1 需 productRef、L3 rollback 非空 | 记为 Discovery（DC-19），归 WP-02/WP-06 Gate 落地 |
| RE-13 | P3 | `operation.kind` 用自由字符串，与 DDL 七值枚举不一致 | 改为 `operationKindSchema` |
| RE-14 | P3 | EventHub 把任意读取异常都当 `RESYNC_REQUIRED` | 仅 `ResyncRequiredError` 转换，其余原样抛出；补负例用例 |

## 2.1 尚未完成（后续工作包）

- WP-09：`project.open/clone/create`、`connection.hello` 注册与真实 WS 传输绑定、`test:e2e`。
- WP-10：真实 Provider 纵向运行、`test:acceptance`/`test:live`、跨服务器需求往返回归。
- WP-04/WP-08：需求 Git 往返（目录读写、ignore 检查、`REQUIREMENT_PATH_IGNORED`/`LEGACY_REQUIREMENT_FORMAT`）。
- WP-01 自身任务 T1–T8 已完成，T9 的独立 Review/Test 与结算见 `review.md`、`test-report.md`、`settlement.md`。

## 3. 命令证据（2026-09-11）

| 命令 | 结果 |
|---|---|
| `pnpm install --frozen-lockfile` | 退出 0；新增 better-sqlite3 13.0.3（`allowBuilds: true`，原生绑定编译成功） |
| `pnpm typecheck` | 退出 0 |
| `pnpm lint` | 退出 0 |
| `pnpm test:unit` | 13 文件 / 173 用例通过 |
| `pnpm test:integration` | 10 文件 / 115 用例通过（14 迁移 + 21 仓储/账本 + 9 分发 + 16 事件订阅 + 9 身份 + 8 需求投影） |
| `pnpm docs:check` | 退出 0 |
| `pnpm build` | 退出 0（contracts/domain/storage/core/pi-runtime/runner/cli） |
| `pnpm test:e2e\|acceptance\|live` | 仍按契约 `NOT_IMPLEMENTED` 退出 1 |

## 4. 偏差与说明

- SQLite 3.53.4 实测；better-sqlite3 需要原生构建，已在 `pnpm-workspace.yaml` 显式放行并在 `discovery.md` 记录供应链判断。
- `project` 表不设 `project_id` 列：该行的 `id` 即项目标识（`ARCHITECTURE.md` §4），读模型仍暴露 `projectId` 的 `projectSummary`。
- `outbox` 采用实体五列 + `operation_id UNIQUE`，以同时满足 `data.md` §1 的行列规则与 §2 的 operationId 唯一。
- `requirement.portableRef` 以 JSON 列存储，与文档字段一一对应。
- `portableRef.hash` 承载**记录 Hash**（`requirementRecordHash(metadataHash, contentHash)`）：`data.md` §2 的 requirement 行没有第二个 Hash 列，而冲突判定必须比较记录 Hash，故由该字段承担，`path`/`revision` 保持 Git 位置语义（`requirements.md` §4）。
- `snapshot` 以 (type, hash) 复合主键；仓储层按 hash 读取，写入由 Core 使用显式 SQL。
- `EntityRepository.update` 在同一事务内先读后写，SQLite 的写锁由 `BEGIN IMMEDIATE` 保证，因此 CAS 不会出现丢失更新。
