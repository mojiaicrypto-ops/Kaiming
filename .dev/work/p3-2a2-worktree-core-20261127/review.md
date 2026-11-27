# Independent review — P3-2a-2

Reviewer: `P32a2WorktreeReview`
Date: 2026-11-27
Verdict: **PASS** after fixes.

## Initial blockers and fixes

1. endOp could land before completion gaps: now all completion/design/commit gaps are computed before any Git mutation.
2. Landing did not verify the checkout branch: baseBranch is captured at create, persisted in v23, and checked; switched/detached main returns branch_kept.
3. Design completion used chief cwd: now uses `store.resolveTaskCwd(task)`.
4. Provisioning failure cleanup could leave a dirty worktree: cleanup uses `--force`.
5. Root validation created directories before rejecting: validation now precedes mkdir, with a no-side-effect assertion.
6. Relative worktree roots were resolved before the absolute check: now rejected with isAbsolute.

## Confirmed

- One active in_place write Task per project; second/explicit isolation creates a Worktree.
- v22→v23 converts old in_place to legacy and creates the unique index.
- ff-only only when base branch, HEAD and cleanliness all match; no rebase path.
- Real Git tests cover create, landing, moved/dirty/switched main, Monorepo, root rejection, provisioning failure cleanup, and task end end-to-end.

## Residual

Setup hook, orphan scan, explicit workspace.remove, relative Plan/report refs, Worktree cleanup after merged and P3-3 UI/concurrency remain future. Non-blocking.
