# Plan - P3-2a 切片 1：Workspace 元数据与 Task cwd 解析

## 目标

先落地 P3-2 的无行为副作用基础：v22 Task workspace 元数据、legacy 迁移和统一的 Task 工作目录解析。Worktree 创建、项目级 in_place 索引、provisioning 与合流留在后续切片，不在本切片伪装完成。

## 范围

- `kaiming/src/store/store.ts`：`WorkspaceState`、TaskRow/CreateTaskParams 字段、v21→v22 additive migration、toTaskRow、createTask 默认 `in_place`、`resolveTaskCwd`。
- `kaiming/src/tools/completion-git.ts`：交付检查改用统一 Task cwd。
- `kaiming/src/tools/task-tools.ts`：修订 Plan 使用当前 Task cwd，Task 摘要暴露 workspace 字段。
- `kaiming/test/store.test.ts`、`test/delegation.test.ts`、`test/design-completion.test.ts`：迁移与 TaskRow fixture。
- `docs/technicalnew/storage-and-recovery.md`：记录 v22 additive 字段与 legacy 语义。

## 验证档

`broad`：涉及 SQLite v22 迁移与 Task 目录权威。允许运行 store/task 相关测试和 typecheck；不在本切片运行全量 E2E。

## 验收

- v21→v22 只加列；旧 Task `workspaceState='legacy'`、路径/分支列为 NULL；旧行为不变。
- 新建 Task 写 `workspaceState='in_place'`；没有 Worktree 行为、没有项目级唯一索引（留给分配器切片）。
- `resolveTaskCwd` 对 legacy/in_place 返回 chief cwd；对 `active` 且有 `workspacePath` 返回 Worktree 路径；缺路径时明确失败。
- `completion-git` 与修订 Plan 使用统一解析，不再直接取 chief cwd。
- 现有 store/task/backlog 测试通过；旧 TaskRow fixture 编译通过。

## 不做

- 不创建/删除 Worktree，不建分支，不跑 setup，不实现 ff-only/branch_kept。
- 不添加 `idx_tasks_one_inplace_per_project`；在分配器切片与 Worktree 创建同时启用，避免阻断第二个 Task。
- 不把 Plan/报告切换到项目相对路径；在路径切片单独完成。
