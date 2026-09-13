# WP-08 结算（Settlement）

- 工作包：WP-08 集成、结算与恢复（`docs/delivery/implementation.md`）
- 等级：L2；Plan `.agentdev/work/WP-08/plan.md`（planVersion 1）
- 关联验收：AC-020、AC-021、AC-022、AC-029、AC-041、AC-054、AC-057、AC-058、AC-061、AC-062、AC-063、AC-064、AC-081、AC-082、AC-083、AC-090、AC-091、AC-093、AC-094
- 基线提交：`5683c77`（WP-07 结算）
- **验证代码树：commit `7422646`，tree `fda94c51771ba5dd572df93c872ca8e6bc3eb221`**
- 证据提交：`891d254`（Review 第 4 轮 PASS + Test 第 3 轮 PASS + 残余登记）；本结算提交只新增/更新 `.agentdev/work/WP-08/` 与 `docs/INDEX.md`，**代码树未变**
- 证据目录：`.agentdev/work/WP-08/`（plan / implementation T1～T9 / review 第 1～4 轮 / test 第 1～3 轮 / settlement）
- 冻结提交总数：`5683c77..7422646` 共 6 个提交；Diff **24 个路径、+21867/−10**

## 1. 实际 Diff

| 类别 | 内容 |
|---|---|
| Git/CAS | `packages/workspace/src/worktree.ts`（per-Task worktree + 单写者租约 + 脏树拒绝 + `resetHard` 基点复位）、`cas.ts`（依赖血缘 `dependencyRevision`/`dependencyManifestRefs`、祖先失效、`update-ref` 带 expected-old 的 CAS + 候选后代校验 + journal 崩溃恢复、双 Task 冲突 → 独立修复 Task、修复 revision **supersede** 收敛、交付锁 `integration:<projectId>`） |
| 需求保存 | `packages/core/src/requirement-save.ts`（共享集成锁、按目标 revision 读取需求池、逐条冲突、组合 Hash、提交后只补投影、脏回写门禁与收敛、journaled 安装身份校验） |
| 恢复/结算/备份 | `packages/core/src/recovery.ts`（按真实进程/epoch 判定、Run 级恢复决策绑定、窄范围保持、备份/恢复/迁移含哈希校验与租约授权回收、缺 Secret 阻断）、`settlement.ts`（最终 Manifest、知识补丁只经投影发布、ref 后崩溃复用提交且恰一次事件、`phase` 清理、`commitTree`/`codeTreeHash` 分列）、`run-lifecycle.ts`/`findings.ts`（新 Attempt 准入门禁） |
| 测试 | `packages/workspace/test/{worktree,cas.integration}.test.ts`、`packages/core/test/{requirement-save,requirement-save.integration,recovery,settlement.integration,backup.integration,wp08.integration,wp08-failures}.test.ts` |
| 记录 | `.agentdev/work/WP-08/**`（4 轮独立 Review、3 轮独立 Test、T1～T9） |

## 2. 工程命令结果（独立 Test 第三轮，tree `fda94c51`）

| 命令 | 退出 | 结果 |
|---|---|---|
| `pnpm typecheck` | 0 | strict 无错误 |
| `pnpm lint` | 0 | 通过 |
| `pnpm test:unit` | 0 | 48 文件 / **975** 用例 |
| `pnpm test:integration` | 0 | 20 文件 / **233** 用例（真实临时 Git 仓库与真实 SQLite） |
| `pnpm docs:check` | 0 | 15 documents / 55 links / 94 AC / 9 REQ / 11 WP |
| `pnpm build` | 0 | 10 workspace |
| `pnpm test:e2e` / `test:acceptance` / `test:live` | 1 | 按契约 `NOT_IMPLEMENTED`（WP-09 / WP-10） |

Test 自建实验（`/tmp/wp08t3/`，真实 Git + 真实 SQLite，不 import 产品测试文件）：**11 组 / 608 断言 / 0 失败**。

### 必需失败测试（`docs/delivery/implementation.md` WP-08）

| 必需失败测试 | 覆盖证据 |
|---|---|
| Task 合并冲突 | 冲突 → `TASK_MERGE_CONFLICT`、HEAD 不动、独立修复 Task（依赖双方、需重新验证）；修复 revision supersede 后收敛且最终 Manifest 记录修复 revision |
| CAS 失败 | 期望 revision 不匹配/候选非后代 ⇒ `VERSION_CONFLICT`/`STALE_ARTIFACT`，分支与已集成提交不变，无完成事件 |
| ref 后崩溃 | 复用既有提交、补齐 Work/Requirement/operation 状态、恰好一条 `settlement.completed`，重放零新增 |
| 取消未知副作用 | `cancelling → blocked(recovery)`、Requirement 保持 active、候选保留不集成、`accept_cancel` 才 cancelled |
| 备份演练 | 备份 → 新目录 restore 哈希/知识/证据一致、活动 Run 需恢复、租约与授权回收、缺 Secret 阻断、篡改/不完整拒绝 |

## 3. 独立验证

- **Review**：4 轮独立 Review（round 1 FAIL 3×P1 + 2×P2 + 3×P3；round 2 FAIL 1×P1 + 3×P2 + 2×P3；round 3 PASS + 3×P2/3×P3；round 4 聚焦 **PASS**，0×P0/P1/P2）。所有 P1 与后续 P2 均由下一轮独立复核为关闭。
- **Test**：3 轮独立 Test（第 1 轮门禁中止；第 2 轮 PASS + T-01 P2；第 3 轮 **PASS**，18 个关联 AC 中 17 个接受 + AC-054 属 WP-09）。
- 关键收敛：Requirement 池读取改按目标 revision（消除静默覆盖）；恢复的「未确认终止」持久化为阻断并绑定到 Run 级决策（消除双写者）；CAS 增加候选后代校验与基点复位（消除分支静默回退）；崩溃窗口补 journal 安装分支（部分提交不重复执行且不永久卡死）。

## 4. 验收对应

| AC | 结论 | 主要证据 |
|---|---|---|
| AC-020/021/022 | 通过 | 暂停/恢复新 Attempt、未知副作用取消、预算原子拒绝在集成后仍成立 |
| AC-029 | 通过 | 初始化中断按 Hash 续写、冲突不覆盖、Ready 最小门禁 |
| AC-041 | 通过 | 知识补丁只经投影发布，冷启动查询命中新事实 |
| AC-054 | **未覆盖（属 WP-09）** | BFF/浏览器断开继续由 WP-09 实现与验证 |
| AC-057/058/061 | 通过 | 租约轮转、旧 epoch 拒绝保留诊断、重启按真实进程/epoch 判定、未确认终止不开新 Attempt |
| AC-062 | 通过 | 冲突 → 独立修复 Task → supersede 收敛 + 重新验证 |
| AC-063 | 通过 | ref 后/CAS 前崩溃复用提交、补齐状态、恰一次完成事件 |
| AC-064 | 通过 | 备份/恢复/迁移一致性、活动 Run 需恢复、缺 Secret 阻断 |
| AC-081 | 通过 | 依赖 revision/manifest refs 精确、祖先变化失效、已合并祖先不重复应用 |
| AC-082 | 通过 | 重启后保持 DispatchSnapshot 窄范围 |
| AC-083 | 通过 | 无 taskId 的 document/integration Finding 绑定 Review 目标并独立关闭 |
| AC-090/091 | 通过 | 保存状态/重试/只补投影；共享集成锁、并发交付、最新需求池入提交、metadata-only 拒绝 |
| AC-093/094 | 通过 | 组合 Hash/共享版本/逐条冲突/半对拒绝；陈旧投影不覆盖、崩溃重试不丢已集成提交 |

## 5. 未决项与承接包（显式登记）

| 项 | 性质 | 承接 |
|---|---|---|
| W8R4-01/02、Test T-01（`supersedes` 校验、被取代依赖改指、空包装提交） | P3，非阻断 | 随「修复 Task 派发接线」补齐 |
| WorktreeLeaseStore 未落 `lease` 表、CAS 事件/operation 行接线、冲突产物与修复 Task 派发 | 未接线 | WP-09/WP-10 |
| Secret 加密导出/导入（备份只存标识） | 未实现 | 安装层 |
| `apps/cli` 的 backup/restore/relocate、`apps/daemon` 启动恢复、Run 级恢复决策入口 | 未接线 | WP-09 |
| 宿主 PID 身份（容器/远端 fail-closed）、多进程并发压测、真实 SIGKILL | 限制 | WP-10 |
| AC-054（BFF/浏览器断开继续） | 未覆盖 | WP-09 |

## 6. 完成清单（CompletionManifest）

- [x] Plan 与实现记录（T1～T9）齐备，含全部残余与承接登记
- [x] 4 轮独立 Review（末轮聚焦 PASS）与 3 轮独立 Test（末轮 PASS）落库，代码树在末轮 Test 后未变（`7422646` / tree `fda94c51`）
- [x] 六条契约命令在冻结树上退出 0；`e2e/acceptance/live` 按设计 `NOT_IMPLEMENTED`
- [x] 五项必需失败测试独立复现
- [x] AC-020/021/022/029/041/057/058/061–064/081–083/090/091/093/094 有证据；AC-054 明确承接 WP-09
- [x] `docs/INDEX.md` 实现状态更新（本次结算唯一 docs 变更）
