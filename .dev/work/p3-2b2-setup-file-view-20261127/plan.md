# Plan - P3-2b2：Setup 沙箱与按 Task 文件视图

## 目标

Worktree 创建后可安全准备依赖；只读文件接口能查看活动 Worktree。

## 范围

- `os-sandbox` 增加同步宿主 setup 执行器与命名 env allowlist。
- `worktree.ts` 执行 `.dev/worktree-setup.sh`，要求 active sandbox，只暴露 `KAIMING_MAIN_WORKTREE`。
- task creation 传入 sandbox；setup 失败回收 provisioning。
- `project.files.list/read` 增加可选 taskId，使用 resolveTaskCwd。
- 文档与全量验证。

## 验收

- setup 只走 workspace-write 沙箱；off/无后端拒绝。
- 脚本收到主工作区路径且不能写主工作区。
- taskId 文件读写限定所属项目和 Task cwd；跨项目 NOT_FOUND。
- 全量套件通过。

## 不做

- UI 按钮、跨任务重叠雷达、task.workspace.remove 的 RPC/看板。
