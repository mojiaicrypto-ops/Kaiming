# Independent review — P3-2a 切片 1

Reviewer: `P32aSchemaReview`
Date: 2026-11-27
Verdict: **PASS** after one blocking fix.

## Blocking finding and fix

Plan revision computed its `planRef` from the resolved Task cwd but `commitPlan` still used the chief checkout. For an active workspace this recorded one path and wrote bytes to another. Fixed by computing one `planTargetValue` from `resolveTaskCwd(existing)` and reusing it for both `planRefFor` and `commitPlan`; regression added at `task-store.test.ts:210`.

## Confirmed

- v21→v22 additive columns, legacy/new workspace defaults, and resolver semantics.
- `completion-git` and Plan revision use the resolved Task cwd.
- Active Task without `workspacePath` fails explicitly.
- The slice's deliberate omissions (Worktree creation, in_place unique index, provisioning/merge) match the plan; no feature is claimed as complete.

## Residual

`merged`/`branch_kept`/`removed` cwd routing and the merge/cleanup slice remain future work. Non-blocking.
