# Plan - P3-2 按需 Worktree 契约定版

## 目标

把 2026-11-27 复核确定的 P3-2/P3-3 决策写入技术计划，消除现有草案中的路径、迁移、恢复和合流冲突；本 Task 不改代码。

## 范围

- `docs/technicalnew/gap-register.md` 的 P3-2/P3-3。
- 记录 Worktree 根/项目目录、创建事务、provisioning、旧库迁移、backlog 一致性、setup 沙箱、branch_kept 读取与兼容边界。
- 对应产品/主管提示词的阶段 1 规则放在独立 T1，不在本 Task 混入实现。

## 验证档

设计/文档 Task，无 verification profile；使用独立 Review，不建 Test 阶段。

## 验收

- P3-2 不再出现 `<dataDir>/worktrees` 或默认“所有写 Task 建 Worktree”的冲突描述。
- 明确 `worktreeRoot`、`workspacePath`、`workspaceRelPath` 的职责和 Monorepo 映射。
- 明确 v21→v22 的 legacy 迁移、`provisioning` 失败/崩溃两条路径、无僵尸 Task。
- 明确 `.dev/backlog.md` 缺失/未跟踪/未提交/创建期变化的处理。
- 明确 setup 沙箱与 `KAIMING_MAIN_WORKTREE` 等变量的显式白名单，禁止 `KAIMING_*` 通配。
- 明确 `branch_kept` 分支保留、Plan/报告 `git show` 兜底和 Workspace 回收语义。
- 明确旧数据可升级、旧程序不可回读新库，以及 P3-3 默认并发上限的兼容取舍。
- 独立 Review 只读本 Task 文档，不读开发聊天；有阻断问题则修订。

## 不做

- 不新增代码、Schema、迁移或测试。
- 不修改产品行为或实现状态；P3-2/P3-3 仍标待实施。
