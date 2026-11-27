# Independent review — P3-2/P3-3 契约定版

Reviewer: `P32ContractReview`
Date: 2026-11-27
Verdict: **PASS** after fixes.

## Initial finding

NEEDS_FIX, three blocking contract gaps:

1. `isolatedWorkspace: true` in a non-Git or unborn-HEAD project had no defined failure.
2. Cancelled Tasks with an `active` Worktree had no cleanup transition.
3. P3-3 default concurrency quota was ambiguous between `4` and `0`.

## Resolution checked

- Explicit unsupported isolation now returns `WORKSPACE_UNSUPPORTED`; no silent `in_place`.
- `task.workspace.remove` now defines cancelled-active cleanup: remove Worktree, keep branch, set `workspaceState='removed'`, retain branch/path/base fields.
- P3-3 fixes default `4`; `0` is only an explicit opt-out in both the setting and compatibility sections.

Independent re-review: PASS, no blocking findings. The T1 admission rule is consistent across delivery, backlog, journey and chief prompt. The sandbox claims are implementable with only named per-command variables, not `KAIMING_*` wildcard.
