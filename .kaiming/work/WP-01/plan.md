# WP-01 实现 Plan（数据、状态与协议核心）

- planVersion: 1
- workId: WP-01
- level: L2（新增包与持久化 Schema、连接认证、命令事务；不改产品语义，公开协议按 `docs/architecture/protocol.md` 既有定义实现）
- authorization_ref: 用户目标轮次「继续」（2026-09-11）；上级授权为「我要完全实现这个产品，让你来实现」
- productRef: 无独立 Requirement；行为依据为 `docs/delivery/implementation.md` WP-01 与关联 AC
- 依赖：WP-00（已完成，提交 `79d5895`）

## 1. goal

建立全部业务状态的权威底座：共享实体 Schema、每 Project SQLite（迁移/事务/版本/幂等）、串行短命令 Mailbox、事件与订阅水位、Outbox/租约，以及连接认证与 Project 身份识别；使 WP-02–WP-08 能在同一套事务与事件语义上实现调度、交付与恢复。

## 2. scope

writePaths:

- `packages/contracts/src/entities/**`（实体 Schema 与产物结构）
- `packages/domain/**`（新增包：状态机、Gate/预算/权限判定）
- `packages/storage/**`（新增包：SQLite 迁移、事务、仓储、Artifact blob 存储）
- `packages/core/**`（新增包：ProjectRuntime、Mailbox、EventHub、命令分发、认证、Project 身份）
- `vitest.config.ts`、`tsconfig.json`、`pnpm-workspace.yaml`、`pnpm-lock.yaml`、根 `package.json`（新增包接通）
- `.agentdev/work/WP-01/**`（过程记录）

readPaths: `docs/**`（主要 `architecture/data.md`、`protocol.md`、`reliability.md`、`ARCHITECTURE.md`、`rules/workflow.md`、`product/requirements.md`、`delivery/implementation.md`、`delivery/acceptance.md`）
不可写：`docs/**`（除在结算时更新 `docs/INDEX.md` 的「实现起点」状态事实）、`webui/**`、`docker/**`

## 3. tasks（DAG）

| id | 角色 | goal | dependsOn | acceptanceIds |
|---|---|---|---|---|
| T1 | backend | `contracts/entities`：`data.md` §2 全部实体 Schema + §3 产物结构（Ref/SourceRef/Scope/StageResult/CheckResult/Assessment/ContextSelection/Plan/ProductDefinition/Manifest/DispatchSnapshot/PortableRequirement） | — | AC-055 |
| T2 | backend | `packages/domain`：Work/Requirement/Task/Run/Attempt 状态机合法转换、等级判定顺序、预算判定、权限/Grant 匹配 | T1 | AC-055, AC-060 |
| T3 | backend | `packages/storage`：SQLite 打开（foreign_keys/WAL/synchronous/busy_timeout）、`schema_migrations`+checksum、备份后事务迁移、失败停止 | T1 | AC-065 |
| T4 | backend | `packages/storage`：全部表迁移 `0001`（CHECK/FK/UNIQUE 按 `data.md` §2）、版本 CAS 仓储、`command` 幂等表、`event` 追加与 cursor、`outbox`、`lease` | T3 | AC-055, AC-065 |
| T5 | backend | `packages/core`：ProjectMailbox（串行短事务、256 项/4MiB 上限、BUSY、>100ms 诊断、长操作在事务外）、命令分发（Schema 校验/expectedVersion/幂等/授权） | T4 | AC-055, AC-056 |
| T6 | backend | `core`：EventHub/订阅（快照+C 水位、replay/snapshot、ack、RESYNC_REQUIRED、慢连接软硬限） | T5 | AC-059, AC-060 |
| T7 | backend | `core`：连接认证（安装凭证 0600 Bearer、会话 cookie/CSRF/Origin、24h 过期、每 IP 限速）与 Project 身份（canonical realpath、git toplevel、projectId、嵌套仓库排除、relocate 别名） | T5 | AC-023, AC-024, AC-078 |
| T8 | backend | 需求投影的幂等/冲突判定（id/recordVersion/recordHash、同版本异内容 REQUIREMENT_CONFLICT、本机 version 与 recordVersion 分离）；Git 往返留给 WP-04/WP-08 | T4 | AC-092（部分） |
| T9 | backend | 测试与记录：单元/集成（真实 SQLite 临时库）、失败测试（丢应答重试、冲突键、慢连接、迁移失败、长操作不阻塞）、`docs/INDEX.md` 状态、结算材料 | T5,T6,T7,T8 | AC-023,024,055,056,059,060,065,078,092 |

checks: `pnpm install --frozen-lockfile`、`pnpm typecheck`、`pnpm lint`、`pnpm test:unit`、`pnpm test:integration`、`pnpm docs:check`、`pnpm build`

## 4. 接口/数据影响

- 新增 `packages/domain`、`packages/storage`、`packages/core` 三个包；`packages/contracts` 增加 `entities` 子模块（只新增导出，不改 WP-00 既有类型语义）。
- 新增 better-sqlite3 运行时依赖（`ARCHITECTURE.md` §3 钉定 13.0.3）；`pnpm-workspace.yaml` 需允许其原生构建（供应链显式声明）。
- 数据库：每 Project 一个 SQLite 文件，`data.md` §2 全部表一次建齐；`schema_migrations` 记录 version+checksum，checksum 不一致停止启动。
- 协议：按 `protocol.md` 既有 Envelope/幂等/版本/错误码实现 Core 侧分发与订阅，不新增客户端可见方法（`apps/daemon`/BFF 接线属 WP-09）。
- 不产生 Git 写操作（Worktree/集成属 WP-07/08）；需求 Git 提交属 WP-04/WP-08。

## 5. 验证策略

- 单元：实体 Schema 正负例（未知字段/枚举/路径/Hash 拒绝）、状态机非法转换拒绝、等级判定顺序、预算 used+reserved≤limit、Grant 全匹配。
- 集成（真实 SQLite 临时库，不依赖 Provider/网络）：迁移建立全部表并可用、checksum 变更停止启动、迁移中途失败回滚且不启动、幂等键同载荷返回原结果/异载荷拒绝、VERSION_CONFLICT 带 currentVersion、事件 cursor 单调与订阅水位、Mailbox 溢出 BUSY 且长操作不阻塞后续短命令（受控桩，1 秒内准入）、慢连接丢弃/合并临时流、`RESYNC_REQUIRED`、Project 身份归一（同仓库子目录/符号链接同一 ID，嵌套仓库独立）。
- 失败测试（必需）：丢应答重试（同键返回原结果且不重复副作用）、冲突键（同键异载荷拒绝）、慢连接（软限合并/硬限断开且关键事件仍持久）、迁移失败（停止且不启动）、长操作不阻塞（长桩期间短命令 1 秒内完成）。
- 不做出：不实现 Chief 调度、知识投影、Gate 流程、Runner 集成与需求 Git 提交（WP-02/WP-04/WP-06/WP-08）。

## 6. 风险与回退

- 风险：better-sqlite3 原生构建在 Node 24 / pnpm 12 下可能需要编译工具链 → 先做安装探针；失败则记录技术修正并显式选择可用版本，不改产品契约。
- 风险：实体字段多达 28 张表，Schema 与迁移可能不一致 → 以 `data.md` §2 为唯一来源，迁移由 Schema 生成/核对，并用测试断言表清单与列清单一致。
- 风险：Mailbox/EventHub 的并发语义难以用真实负载复现 → 用受控桩与真实 SQLite 组合，断言时序与状态而非性能数字。
- 回退：本包只新增路径与依赖；回退为删除 `packages/{domain,storage,core}`、`packages/contracts/src/entities`、`apps/*` 不变，仓库回到 `79d5895` 的可运行状态。

## 7. 结算

本包必验范围（实体 Schema、事务/版本/幂等、迁移、连接认证、快照水位、Mailbox）在真实 SQLite 与真实 Git 根上通过后，由独立 Review 与 Test 复核，产出 `.agentdev/work/WP-01/{implementation,discovery,review,test-report,settlement}.md` 与 AC 证据。
