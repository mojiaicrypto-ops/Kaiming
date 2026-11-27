# Plan - P3-2a-2：Workspace 分配、Worktree 创建与诚实落地

## 目标

让同项目第二个活动 write Task 自动进入独立 Git Worktree，同时保留第一个 Task 的 `in_place` 行为；任务完成时只在主分支未移动且干净时 ff-only 合入，否则保留分支。

## 范围

- v22→v23：旧 in_place 行转 legacy，项目级 `idx_tasks_one_inplace_per_project`。
- `kaiming/src/runtime/worktree.ts`：根校验、Git worktree 创建/回收、ff-only/branch_kept、`git show`。
- `kaiming/src/tools/task-creation.ts`：in_place/worktree 分配、provisioning、失败清理。
- `task-tools` create/end：`isolatedWorkspace`、landing；`task.get` 已有 workspace 字段。
- `Store`：`IN_PLACE_BUSY`、`hasOpenWriteTask`、abort/activate、end workspace state。
- `test/worktree.test.ts` 与相关任务测试。

## 验证档

`broad`：涉及 Git 工作树、Schema v23 迁移和 Task 创建/结束路径。运行真实 Git worktree 测试、相关任务测试、typecheck 和全量单元套件。

## 验收

- 同项目第一个 write Task `in_place`，第二个/显式 isolation 进入 Worktree；并发创建不会双 in_place。
- Worktree 根默认宿主目录，拒绝 data/private、项目内和 `.git` 内；Monorepo 子目录映射正确。
- 创建/Plan/activate 失败删除 provisioning Task、释放 currentTaskId/backlog，并回收 Worktree/branch。
- 主分支未移动且干净时 ff-only；移动或脏时 branch_kept；不自动 rebase。
- `git show` 可在 Worktree 回收后读取保留分支文件。
- 全量单元套件通过；独立 Review/Test。

## 不做（后续 P3-2b/P3-3）

- setup hook sandbox、扫描孤儿目录、显式 `task.workspace.remove`、Plan/报告正式相对化、UI 看板、P3-3 并发配额。
