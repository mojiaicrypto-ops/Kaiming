# Implementation - P3-2 契约定版

## 实际改变

- `docs/technicalnew/gap-register.md` P3-2 定版：
  - `worktreeRoot`、`workspacePath`、`workspaceRelPath` 分离；默认 `~/.kaiming-worktrees`，三禁校验。
  - v21→v22 的 legacy/provisioning 状态、项目级 in_place 唯一索引、旧库多 Task 保留策略。
  - 项目级事务分配、失败删除/补偿、崩溃 `scanStartup`、孤儿 Worktree 清理。
  - `.dev/backlog.md` 先提交、创建后 SHA-256 比对；不复制脏 backlog。
  - setup 脚本走 workspace-write 沙箱，显式 `KAIMING_MAIN_WORKTREE` 白名单，禁止 `KAIMING_*` 通配。
  - `branch_kept` 保留分支、Plan/报告三级解析、`git show` SHA-256 核对。
  - 旧数据/旧 API 兼容、旧程序不可回读新库、非 Git 第二 Task、并发配额默认值的边界。
- P3-3 定版：P3-3a 共享调度/配额为 `broad`，P3-3b 重叠/文件视图为 `focused`；默认配额 4 的兼容取舍写入文档。

## 未改变

- 没有新增代码、Schema、迁移、测试或实现状态；P3-2/P3-3 仍标待实施。
- 没有修改 P3-1 沙箱实现。
