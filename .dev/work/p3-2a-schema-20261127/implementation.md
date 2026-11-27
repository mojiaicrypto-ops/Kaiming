# Implementation - P3-2a 切片 1

## 实际改变

- `store.ts`：新增 `WorkspaceState` 与 six 个 Task workspace 字段；v21→v22 additive migration；旧行 `legacy`，新 Task `in_place`。
- `Store.resolveTaskCwd`：legacy/in_place 使用 chief cwd；active/provisioning 使用 `workspacePath`；provisioning 缺路径明确失败。
- `completion-git` 与 `task-tools` 的 Plan 修订改用统一 Task cwd；`task.get` 摘要暴露 workspace 字段。
- `store.test.ts` 增加 v21 迁移和 active cwd 测试；TaskRow fixture 补齐新字段。
- `storage-and-recovery.md` 记录 v22 additive 元数据与本切片边界。

## 验证

- `npx vitest run test/store.test.ts test/task-store.test.ts test/git-commit-gate.test.ts test/task-backlog.test.ts test/delegation.test.ts test/design-completion.test.ts`：120/120 passed（含 active workspace Plan 回归）。
- `npm test`：74 files / 775 tests passed。
- `npm run typecheck`：passed。

## 未改变

- 尚无 Worktree 创建/回收、分支、setup、ff-only/branch_kept。
- 尚未添加项目级 in_place 唯一索引；等分配器切片与 Worktree 创建一起启用，避免阻断第二个 Task。
- Plan/报告仍是原路径形态；相对化在后续切片。
