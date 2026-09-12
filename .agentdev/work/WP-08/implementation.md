# WP-08 实现记录（集成、结算与恢复）

- planVersion: 1（`.agentdev/work/WP-08/plan.md`）
- 依赖：WP-04（`88a5690`）、WP-06（`b0d226f`）、WP-07（`96e196b`）；基线 WP-07 结算 `5683c77`
- 实现位置：`packages/workspace/src/{worktree,cas}.ts`、`packages/core/src/{requirement-save,recovery,settlement}.ts`

## T1 Git Worktree、CAS 与依赖血缘（AC-062/AC-081/AC-094）

- `packages/workspace/src/worktree.ts`：`WorktreeGitPort`（扩展既有 `GitPort`）+ `NodeWorktreeGitPort`（显式 argv、`shell:false`、真实 `git worktree add/remove/list`、`update-ref` 带 expected-old、`merge-base`/`is-ancestor`/`cherry`/`cherry-pick`/`ls-tree`/`cat-file`）；`WorktreeLeaseStore`（Port + 内存实现，`worktreeLeaseResource(id)`）保证同一 worktree 只有一个 owner（外来/过期 owner 拒绝 `BUSY` 或按 TTL 替换）；**脏 worktree 拒绝删除**并列出路径，除非显式 `discard`。
- `packages/workspace/src/cas.ts`：依赖血缘（`orderTasks` 拓扑 + 环拒绝、`planDependencies`/`prepareDependencies` 计算 `dependencyRevision`/`dependencyManifestRefs`、`verifyTaskStart` 要求上游冻结成果且祖先变化即失效）、CAS 集成（`createCasService().integrate()`：比较期望 revision、候选提交（含需求池文件并按 metadata+content 成对校验）、`pending → pending(commit) → committed → completed` 日志、**只用 `update-ref <ref> <new> <old>` 移动 ref**、冲突返回 `VERSION_CONFLICT`/`STALE_ARTIFACT`/`IDEMPOTENCY_CONFLICT` 且分支不变、崩溃后复用提交且**只发一次完成事件**）、`runIntegration`（按依赖顺序 cherry 各 Task 自身提交、跳过已合并/已存在祖先、冲突时产出独立修复 Task + 冲突产物哈希且 HEAD 不动）。
- 回归网：`worktree.test.ts`（10 例）、`cas.integration.test.ts`（13 例，真实临时仓库）。

## T2 需求即时保存与投影一致性（AC-090/AC-091/AC-093）

- `packages/core/src/requirement-save.ts`：`ProjectIntegrationLock`（共享资源 `integration:<projectId>`，需求保存与代码交付同一把锁）；`prepareRequirementSave`（两文件共享版本、正文 `<!-- record-version: n -->`、六段标题校验、recordVersion 单调、组合 `recordHash`）；`readRequirementPoolAtRevision`/`requirementPoolReadme`；`RequirementSaveService.save/retry/pendingRepairs`（取锁 → 期望 vs HEAD 目录 `recordHash` → detached worktree 构造提交 → 经 CAS 移动交付 ref → 刷新投影 → 才报告 `saved`；返回 branch/ref/commit/unpushed/upstreamRevision 与投影 verdict；失败返回 `requirement.save.retry`，已提交时重试**只补投影、不产生第二个提交**）；`checkCompletionSettlement`（metadata-only 变更不得冒充代码验证）。
- 回归网：`requirement-save.test.ts`（19 例）、`requirement-save.integration.test.ts`（12 例，真实仓库 + 真实 SQLite）。

## T3 租约/epoch 恢复、结算与备份（AC-041/AC-057/AC-058/AC-061/AC-063/AC-064/AC-082）

- `packages/core/src/recovery.ts`：`RunRecoveryService`（**绝不按持久字段直接恢复**：检查真实进程身份与 tool operation 状态后置 `interrupted`（可恢复）或 `recovery_required`（存活/不可确认/未知副作用）；租约回收与 daemon epoch 围栏 `lastHostEpoch`；旧 epoch 结果按 epoch/取消/新决定拒绝并持久诊断 `stage.result_rejected`；`recoveryScope`/`verifyRecoveredScope` 只读冻结 DispatchSnapshot，重启后窄范围保持、Work 宽范围记为忽略）；备份/恢复/迁移（SQLite `VACUUM INTO` + 全 refs Git bundle + blobs/知识 + 哈希清单；restore 逐项校验哈希、重映射根、回收租约与授权、活动 Run 需恢复、缺 Secret 阻断 `PROVIDER_UNAVAILABLE`；`relocateProject` 同规则换根）。
- `packages/core/src/settlement.ts`：`buildKnowledgePatch`/`applyKnowledgePatch`（只经 `buildProjection` 应用，非法知识不发布、保留最后有效并标 stale）、`buildFinalManifest`/`freezeFinalManifest`/`readFrozenFinalManifest`、`SettlementService.prepareSettlement/settle/recover`（冻结 CompletionManifest、CAS 提交、**ref 后崩溃复用提交并只发一次 `settlement.completed`**）。
- 回归网：`recovery.test.ts`（17 例）、`settlement.integration.test.ts`（10 例）、`backup.integration.test.ts`（5 例）。

## T4 端到端集成与必需失败测试

- `packages/core/test/wp08.integration.test.ts`（11 例）：单需求 L1 链到 CAS/CompletionManifest、L2 阶段链、document 路线（含无 taskId 的 Finding 绑定与独立 Review+Test 关闭）、初始化路线（中断按 Hash 续写、冲突不覆盖、Ready 最小门禁）、依赖 Task 链（依赖 revision 记录、祖先变化失效、最终集成跳过已合并祖先）、结算知识补丁 + 冷启动查询找到新事实、需求保存与交付共享锁（含 metadata-only 拒绝）、暂停/恢复与取消未知副作用、预算拒绝在集成后仍成立。
- `packages/core/test/wp08-failures.test.ts`（5 例）：**Task 合并冲突**、**CAS 失败**、**ref 后崩溃**、**取消未知副作用**、**备份演练**。
- 仅两处桩：无真实模型调用（Run 用冻结阶段记录）、无容器（恢复所需进程表用确定性探针）。

## T5 验证与本轮状态

- 契约命令（本记录时点）：`pnpm typecheck` 0；`pnpm lint` 0；`pnpm test:unit` **48 文件 / 967 用例**；`pnpm test:integration` **20 文件 / 208 用例**（真实临时 Git 仓库与真实 SQLite）；`pnpm build` **10 workspace**；`pnpm docs:check` ok。
- 本轮附带变更（必须登记）：`packages/core/package.json` 新增 `@agentdev/knowledge`、`@agentdev/workspace` 依赖与 `pnpm-lock.yaml` 对应 importer 记录（core 需导入 workspace 的 CAS/池接口方可构建）。
- 已登记残余（供 Review/Test 判定）：
  1. `WorktreeLeaseStore` 尚未落到 storage `lease` 表（Port 与内存实现在位；`worktreeLeaseResource(id)` 即 `lease.resource`）。
  2. `CasEventPort`/`CasJournal` 仅 Port：`operation` 行与域事件在 ProjectMailbox 事务内的接线属后续（集成测试用真实 SQLite journal 经 Port）。
  3. 冲突产物尚未持久化为 `artifact` 行、修复 Task 尚未派发（属接线）。
  4. 备份**只存 secret 标识**，不含加密导出；restore 无法解析即 `blocked`（`execution.md` §2 的单独加密导出需改 `secrets.ts`）。
  5. `apps/cli` 的 `backup/restore/relocate` 与 `apps/daemon` 启动时的 `recoverAfterRestart(hostEpoch)` 未接线（函数已导出）。
  6. 计划中的 `packages/workspace/src/backup.ts` 未落在 workspace 包，备份/恢复实现全部在 `core/recovery.ts`（纯搬移可后续重构）。
  7. 进程身份仅识别宿主数字 PID；容器/远端身份返回 `null` 并按「不可确认」fail-closed。
  8. `SettlementService` 置 Requirement `lifecycle='completed'` 与 `finalManifestId`，但不清 `phase`（需 schema 所有者决定 raw UPDATE）。
  9. AC-054（BFF/浏览器断开继续）属 WP-09，本包未覆盖。
