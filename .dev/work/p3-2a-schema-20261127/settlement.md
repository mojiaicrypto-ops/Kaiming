# Settlement — P3-2a 切片 1

Date: 2026-11-27
Status: complete (slice only; P3-2 continues)
Verification profile: `broad`

## Delivered

- Schema v22 additive workspace metadata (`workspaceState`, `worktreeRoot`, `workspacePath`, `workspaceRelPath`, `branchName`, `baseCommit`); old Tasks `legacy`, new Tasks `in_place`.
- `Store.resolveTaskCwd`; completion delivery checks and Plan revision use it.
- Active Task requires `workspacePath`; missing-path resolver fails with `WORKSPACE_BUSY`.
- v21 migration regression, active-workspace Plan revision regression, and legacy column assertions.
- `storage-and-recovery.md`, `validation.md`, gap-register status updated.

## Evidence

- Focused 6 files: **120/120 passed**.
- Full suite: **74 files / 775 tests passed**.
- `npm run typecheck`: passed.
- Independent Review: initial P1 (Plan reference written to a different cwd than bytes) fixed; PASS.
- Independent Test: 120/120 and full 775; missing-path/legacy assertion gaps fixed.

## Boundary

No Worktree creation/removal, setup hook, project-level in_place unique index, provisioning transition or ff-only/branch_kept yet. P3-2 remains in progress; the next slice is workspace allocation + Worktree creation. Current running workbench is still the old process.
