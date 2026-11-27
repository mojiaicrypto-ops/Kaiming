# Independent test — 阶段 1 单 Task 多待办准入

Tester: `MultiBacklogT1Test` (separate context; no edits)
Date: 2026-11-27
Verification profile: `focused`

## Results

- `npx vitest run test/task-backlog.test.ts --reporter=verbose` → **7/7 passed**.
- `npm run typecheck` → exit 0, no diagnostics.
- `npm run check:prompts` → **15/15 passed** (chief prompt still English and all links resolve).

## New test and negative control

- Positive: one write Task with `backlogIds: ['B-1','B-5']` stores exactly that ordered list.
- Negative: `['B-1','B-2']` (B-2 closed) returns `INVALID_ARGUMENT`, leaves zero Task rows, and a following `['B-1']` create succeeds. This pins per-id validation, atomic claim/insert, and no stuck `currentTaskId`.
- Existing single-item busy/missing/broken/closed/read cases and design producer gate remain green.

## Residual

The explicit second-create-on-`B-5` busy assertion is absent; occupancy derives from the same `tasks.backlogIds` column and the existing single-item busy test covers the claim query. Not a blocking gap for this focused change.

No full suite or E2E was run.
