# WP-08 实现 Plan（集成、结算与恢复）

- planVersion: 1
- workId: WP-08
- level: L2（在 `packages/workspace` 补 GitWorktree/CAS/备份恢复，在 `packages/core` 补需求即时保存、最终 Manifest 与知识结算、租约/预算恢复；按 `docs/architecture/{execution,reliability,data}.md`、`docs/rules/{workflow,agents}.md` 既有定义实现）
- authorization_ref: 用户目标轮次「继续」（2026-09-11）；上级授权为「我要完全实现这个产品，让你来实现」
- productRef: 无独立 Requirement；行为依据为 `docs/delivery/implementation.md` WP-08 与关联 AC（AC-020–022、AC-029、AC-041、AC-054、AC-057、AC-058、AC-061–064、AC-081–083、AC-090、AC-091、AC-093、AC-094）
- 依赖：WP-04（`88a5690`）、WP-06（`b0d226f`）、WP-07（`96e196b`）；基线 WP-07 结算 `5683c77`

## 1. goal

把前序工作包的真实实现串成一条可恢复的交付链：Git Worktree 隔离 + CAS（比较并交换）保护 HEAD，Task 的 `dependencyRevision`/`dependencyManifestRefs` 准确且祖先变化即失效；需求保存与代码交付共享 Project 集成锁，Git 提交后崩溃只补投影、不重复提交，投影未刷新时拒绝覆盖；`ref` 更新后崩溃可复用提交、补齐状态且只发一次完成事件；两个已通过 Task 冲突时产生独立修复任务并重新验证最终组合；租约/epoch 保证无重复副作用与双写者；备份/恢复/迁移（relocate）保证 Hash/知识/证据一致、活动 Run 需恢复、缺 Secret 阻断；最终 Manifest 与知识补丁使冷启动可发现新事实。

## 2. scope

writePaths:

- `packages/workspace/src/{worktree,cas,backup}.ts`（新增）与 `packages/workspace/src/index.ts`
- `packages/core/src/{requirement-save,settlement,recovery,integration}.ts`（新增）与 `packages/core/src/index.ts`
- 各包 `test/**`（含 `*.integration.test.ts`）
- 必要时 `packages/storage/**`（仅补 `data.md` §2 已列字段/表）
- `.agentdev/work/WP-08/**`

readPaths: `docs/**`、`packages/**`、`apps/**`
不可写：`webui/**`、`docker/**`、`docs/**`（除结算时更新 `docs/INDEX.md`）

## 3. tasks（DAG）

| id | 角色 | goal | dependsOn | acceptanceIds |
|---|---|---|---|---|
| T1 | backend | `workspace/worktree.ts` + `cas.ts`：Git Worktree 创建/清理/租约、CAS 提交与推送（`--force-with-lease` 语义、HEAD 保护）、Task 合并冲突产生独立修复任务、`dependencyRevision`/`dependencyManifestRefs` 记录与祖先变化失效、最终集成不重复应用祖先 | — | AC-062, AC-081, AC-094 |
| T2 | backend | `core/requirement-save.ts`：需求即时保存（Git 提交 + 投影刷新 + `requirement.save.retry`），分支/提交/未推送状态，Project 集成锁与代码交付互斥，Git 已提交时只补投影，投影未刷新拒绝覆盖，metadata 变更不冒充代码验证 | T1 | AC-090, AC-091, AC-093 |
| T3 | backend | `core/recovery.ts`：租约/epoch 恢复（超租约/重启 ⇒ interrupted/recovery、旧 epoch 结果拒绝但保留诊断、daemon 崩溃后核对进程/epoch 不按旧字段直接运行、ref 后崩溃复用提交并补齐状态且一次完成事件）、结算与知识补丁（最终 Manifest、`AC-041` 知识更新、备份/恢复/迁移演练 `AC-064`） | T1, T2 | AC-041, AC-057, AC-058, AC-061, AC-063, AC-064, AC-082 |
| T4 | backend | `core/integration.ts`：以 WP-04–07 真实实现执行单需求 L1/L2/document/初始化、依赖 Task、CAS、结算、取消、预算与恢复的端到端链；五项必需失败测试（Task 合并冲突、CAS 失败、ref 后崩溃、取消未知副作用、备份演练） | T1–T3 | AC-020–022, AC-029, AC-054, AC-081–083 |
| T5 | backend | 独立 Review（fresh context）+ 修复 + 独立 Test + 结算 | T1–T4 | 全部 |

## 4. 接口与数据影响

- 复用 `packages/storage` 的 lease/operation/outbox/blob 与 `data.md` §2 表；如缺字段先核对 `data.md` 再补，并登记。
- Git 操作以 `GitPort` 为接缝（真实 `git` 二进制 + 内存桩），CAS/CAS 失败以真实 Git 仓库验证。
- 不新增协议方法（HTTP/WS 接线属 WP-09）。

## 5. 验证策略

- 单元：CAS 冲突与 HEAD 保护、依赖失效与祖先复用、需求保存状态机与重试、投影一致性门禁、租约/epoch 恢复矩阵、完成事件唯一性、知识补丁与 Manifest 组合。
- 集成（真实临时 Git 仓库 + 真实 SQLite + 真实文件系统）：L1/L2/document/初始化单需求链、依赖 Task 链、CAS 成功/失败、ref 后崩溃恢复、取消未知副作用、备份→新目录 restore/relocate、活动 Run 需恢复与缺 Secret 阻断。
- 必需失败测试见 T4。
- 退出：最终组合经过有效验证；部分提交恢复不重复执行；结算与文档入口更新。
