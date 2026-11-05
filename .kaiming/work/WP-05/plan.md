# WP-05 实现 Plan（Context隔离与冷启动）

- planVersion: 1
- workId: WP-05
- level: L2（在 `packages/core` 内新增 Context 层：ContextBuilder、ACL、ContextSnapshot 冻结、read ledger、Checkpoint、预算；按 `docs/architecture/context.md`、`docs/architecture/{data,execution,reliability}.md`、`docs/rules/agents.md` 既有定义实现，不改产品语义）
- authorization_ref: 用户目标轮次「继续」（2026-09-11）；上级授权为「我要完全实现这个产品，让你来实现」
- productRef: 无独立 Requirement；行为依据为 `docs/delivery/implementation.md` WP-05 与关联 AC（AC-030–036、AC-079、AC-085、AC-093）
- 依赖：WP-02（Orchestrator/Assessment/DispatchSpec 冻结，结算提交 `f9b61e0`）、WP-04（知识投影/需求池，结算提交 `ce8c64d`，代码树 `88a5690`）
- 基线：WP-04 结算提交 `ce8c64d`

## 1. goal

让「Chief 选择 → Builder 授权/解析/补齐/冻结 → Run 只在冻结范围内读取」这条链路真实可用：`ContextSelection` 的每个来源必须有 reason，Builder 拒绝不可访问来源、按阶段必需表补齐检查（缺项 `MISSING_CONTEXT`）、把实际内容复制进不可变 Snapshot 目录（后续文件变化不得污染已启动 Run）；Run 内追加读取只能落在 readScope、逐条写 read ledger（seq/path/revision/hash/reason/size），阶段结果绑定最后 seq+hash 并在提交后封口（旧 Hash、提交后再读一律拒绝）；预算按 initial/expansion 记账，超限报告具体缺口而不是全库注入；Checkpoint 只来自当前 Run，会话轮换后角色/任务/权限/来源正确，且 Reviewer 无法访问开发聊天或其他 Run 的 Session/Checkpoint。

## 2. scope

writePaths:

- `packages/core/src/context/**`（新增：`types.ts`、`acl.ts`、`requirements.ts`、`builder.ts`、`ledger.ts`、`checkpoint.ts`、`cold-start.ts`、`index.ts`）
- `packages/core/src/index.ts`（导出 Context 层）
- `packages/core/src/snapshots.ts`（如需为 context 快照目录补充 API，仅加法）
- `packages/core/test/context-*.test.ts`（新增测试）
- `packages/contracts/src/entities/{structures,run}.ts`（仅在必要时补齐 Context 相关字段/枚举，不改既有语义）
- `.agentdev/work/WP-05/**`（过程记录）

readPaths: `docs/**`、`packages/**`、`apps/**`
不可写：`webui/**`、`docker/**`、`docs/**`（除结算时更新 `docs/INDEX.md`）

## 3. tasks（DAG）

| id | role | goal | dependsOn | acceptanceIds |
|---|---|---|---|---|
| T1 | backend | `context/acl.ts` + `context/requirements.ts` + `context/types.ts`：角色×阶段 ACL（可读来源类别、readScope、禁止 transcript/聊天、禁止跨 Project、Reviewer 与其他 Run 隔离）、阶段必需项表（initialize/Product/Planning/L1/L2/Review/Test/Settlement，AC-079 的四类正例：空项目、仅有 CompactPlan 的 L1）、`missingSelectionReasons` 校验 | — | AC-033, AC-034, AC-079 |
| T2 | backend | `context/builder.ts`：`buildContext()` 授权→解析（Git path+revision、Artifact id/version、Policy revision、角色契约）→必需项补齐检查（缺项 `MISSING_CONTEXT` 并列出缺口）→冻结 `ContextSnapshot`（selection/resolvedSources/excluded/unknowns/policy+config hash/createdAt，内容复制进不可变快照目录）→预算记账；不自动展开模块 | T1 | AC-030, AC-031, AC-036, AC-093 |
| T3 | backend | `context/ledger.ts`：readScope 内追加读取（seq/path/revision/hash/reason/size）、预算扣减、`seal()` 产出阶段结果绑定的 seq+hash、封口后拒绝再读/旧 Hash 拒绝、`context.request` 扩展授权路径 | T1, T2 | AC-032, AC-036, AC-085 |
| T4 | backend | `context/checkpoint.ts`：Checkpoint 字段（work/task/stage、有效 Manifest、pending decisions、artifact refs、last tool outcome、next action、recent message refs），只来自当前 Run，会话轮换恢复正确，Compaction 不改批准状态，Reviewer 不可读其他 Run | T2 | AC-035, AC-033 |
| T5 | backend | `context/cold-start.ts`：以 WP-04 的真实知识投影 + 固定样例（订单/支付/会话三 Feature、两次交付）实现冷启动装配与检索：找当前取消行为/支付约束/测试路径/已知差距，不注入 20 份无关文档，开发聊天误导结论不可读且不影响结论 | T2, T4 | AC-037, AC-033, AC-039 |
| T6 | backend | 必需失败测试 + 独立 Review（fresh context）+ 修复 + 独立 Test + 结算 | T1–T5 | 全部 |

### 必需失败测试（`docs/delivery/implementation.md` WP-05）

| 必需失败测试 | 归属 |
|---|---|
| 跨项目/Transcript 攻击 | T1/T2（A 项目 SourceRef/Artifact 用于 B ⇒ `NOT_FOUND`/`CONTEXT_FORBIDDEN`；transcript/聊天在 ACL 与工具两侧不可读） |
| Snapshot 失效 | T2（快照冻结后源文件变化不影响已启动 Run；失效/篡改的 snapshot hash 被拒） |
| 预算不足 | T3（initial/expansion 超限 ⇒ 报告具体缺口，不注入更多） |
| 冷启动关联召回 | T5（固定样例能召回当前行为/约束/测试路径/差距；无关文档不注入） |

## 4. 接口与数据影响

- 复用既有 `snapshot` 表（`type='context'`）与 `SnapshotWriter`、`stage_result.read_ledger_seq/hash`、`ContextSelection` Schema（`structures.ts`）。
- 新增 Core 内模块与导出；如需 `checkpoint` 快照类型已有；不新增表（除非 `data.md` §2 已列而 schema 缺失，需记录）。
- 不改协议方法；Context 层由 Core 内部 API 调用（HTTP/WS 接线属 WP-09）。

## 5. 验证策略

- 单元：ACL 矩阵（角色×来源类别）、必需项表（四类启动正例 + 缺上游负例）、来源解析与 hash、`MISSING_CONTEXT` 缺口列表、冻结不可变性与 Snapshot 失效、ledger 追加/封口/旧 Hash/提交后再读、预算记账与超限、Checkpoint 字段与会话轮换、Reviewer 隔离。
- 集成：真实 Git 仓库 + 真实知识投影 + 真实 SQLite 的「选择 → 构建 → 冻结 → 追加读取 → 封口 → 阶段结果绑定」链；冷启动固定样例（含 20 份无关文档与一段开发聊天 transcript）。
- 必需失败测试见上表。
- 退出：本包必验范围通过；Chief 选择可追溯；审核无开发聊天；允许有理由追加读取并正确封口；代码/Schema/测试/文档入口结算。
