# Plan - P3-2b：Artifact 相对路径、合并回收与启动恢复

## 目标

让 Worktree 回收后的 Plan/报告仍可读，并让 merged/崩溃的 Worktree 不再长期残留。

## 范围

- ArtifactRef 增加项目相对路径；Plan/Report target 写入相对路径。
- `artifact-reader`：磁盘 → 主工作区 → 保留分支 `git show` 的读取顺序。
- Task tool/get/report、read-methods、delegation 改用统一读取。
- `task end` merged 后回收 Worktree 和分支；保留 branch_kept 分支。
- 启动时清理 provisioning Worktree、取消残留 Task。
- 测试更新与全量验证。

## 验证档

`broad`：影响 Artifact 读取、Git 回收和启动恢复。运行 Worktree、Task、server-read 测试、typecheck 和全量单元套件。

## 验收

- merged 后 Plan/报告从主工作区读取，hash current。
- branch_kept 可从分支读取。
- merged Worktree 自动回收；branch_kept 保留。
- 启动取消 provisioning 并释放 session；不留下 Worktree。
- 全量套件通过。

## 不做

- setup hook 沙箱、显式 task.workspace.remove、P3-3 并发配额/UI。
