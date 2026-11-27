# Implementation - P3-2a-2

## 实际改变

- v23 migration: old `in_place` → `legacy`; add `idx_tasks_one_inplace_per_project`.
- `worktree.ts`: canonical root/target validation; create branch `kaiming/<taskId>`; remove; ff-only/branch_kept landing; `git show`.
- `task-creation.ts`: first in-place, later/project-explicit isolation; provisioning, Plan write, activate; abort/cleanup on failure.
- `task-tools`: `isolatedWorkspace`; active Task end lands before completion; end stores merged/branch_kept.
- Store: `IN_PLACE_BUSY`, `hasOpenWriteTask`, `abortProvisioningTask`, `activateTaskWorkspace`, end workspace state.
- Tests: `test/worktree.test.ts` real Git create/ff-only/branch_kept/monorepo/root rejection/allocation; task tests adjusted for early refusal.

## 验证

- `test/worktree.test.ts`: 9/9.
- `npm test`: 75 files / 784 tests passed.
- `npm run typecheck`: passed.

## 未改变 / 后续

- setup hook not executed; relative Plan/report refs, scanStartup orphan cleanup, task.workspace.remove, UI/P3-3 remain.
- Worktree directories retained on merged/branch_kept; explicit cleanup is future.
