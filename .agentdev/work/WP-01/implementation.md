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

证据：`packages/contracts/test/entities.test.ts` — 11 用例，含"覆盖 `data.md` §2 全部 28 张表"的表清单断言、每表最小合法行、每表未声明字段拒绝，以及逐条文档约束负例（message_body 归属、finding taskId、grant scope、artifact 归属、budget 上限、requirement 生命周期、枚举/路径/Hash/时间格式）。

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

## 2. 尚未完成（下一轮）

- T4 其余：仓储（版本 CAS 读写）、`command` 幂等（同键同载荷返回原结果、异载荷拒绝）、`event` 追加与 cursor、`outbox` claim/lease、`lease` 续约与过期。
- T5 `packages/core`：ProjectMailbox（串行、256 项/4MiB、BUSY、>100ms 诊断、长操作在事务外）、命令分发（校验/expectedVersion/幂等/授权）。
- T6：EventHub 与订阅（快照+C 水位、replay/snapshot、ack、RESYNC_REQUIRED、慢连接软硬限）。
- T7：连接认证（安装凭证 0600 Bearer、会话 cookie/CSRF/Origin、24h 过期、登录限速）与 Project 身份（canonical realpath、git toplevel、嵌套仓库排除、relocate 别名）。
- T8：需求投影幂等/冲突的存储层实现（判定函数已在 domain）。
- T9：失败测试（丢应答重试、冲突键、慢连接、迁移失败、长操作不阻塞）、独立 Review/Test、`docs/INDEX.md` 更新与结算。

`packages/core` 目前只有包骨架（`src/index.ts` 仅含包说明），**未实现任何功能**。

## 3. 命令证据（2026-09-11）

| 命令 | 结果 |
|---|---|
| `pnpm install --frozen-lockfile` | 退出 0；新增 better-sqlite3 13.0.3（`allowBuilds: true`，原生绑定编译成功） |
| `pnpm typecheck` | 退出 0 |
| `pnpm lint` | 退出 0 |
| `pnpm test:unit` | 11 文件 / 146 用例通过 |
| `pnpm test:integration` | 5 文件 / 52 用例通过（含新增 14 个存储迁移用例） |
| `pnpm docs:check` | 退出 0 |
| `pnpm build` | 退出 0（contracts/domain/storage/core/pi-runtime/runner/cli） |
| `pnpm test:e2e\|acceptance\|live` | 仍按契约 `NOT_IMPLEMENTED` 退出 1 |

## 4. 偏差与说明

- SQLite 3.53.4 实测；better-sqlite3 需要原生构建，已在 `pnpm-workspace.yaml` 显式放行并在 `discovery.md` 记录供应链判断。
- `project` 表不设 `project_id` 列：该行的 `id` 即项目标识（`ARCHITECTURE.md` §4），读模型仍暴露 `projectId` 的 `projectSummary`。
- `outbox` 采用实体五列 + `operation_id UNIQUE`，以同时满足 `data.md` §1 的行列规则与 §2 的 operationId 唯一。
- `requirement.portableRef` 以 JSON 列存储，与文档字段一一对应。
