# Independent test — P3-2a 切片 1

Tester: `P32aSchemaTest` (separate context; no edits)
Date: 2026-11-27
Verification profile: `broad`

## Results

- Assigned 6 files: **120/120 passed** (`store` 36, `task-store` 14, `git-commit-gate` 30, `task-backlog` 7, `delegation` 28, `design-completion` 5).
- `npm run typecheck`: clean.
- Full unit suite: **74 files / 775 tests passed**.

## Migration evidence

The v21 test creates a real DB, drops the six workspace columns, stamps `user_version = 21`, reopens, and verifies the ladder reaches v22: old Task `legacy` with NULL fields, new Task `in_place`, active Task resolves `workspacePath`. Additive-only behavior verified.

## Gaps resolved / residual

- Initial missing-path assertion gap: developer added `WORKSPACE_BUSY` for active/provisioning without `workspacePath`.
- Initial partial legacy assertions: all six nullable columns now checked.
- `createTask` now rejects `workspaceState='active'` without `workspacePath`.
- Residual for later slices: `merged`/`branch_kept` cwd semantics, Worktree creation/index/provisioning/merge, and timing-sensitive git tests under parallel load.
