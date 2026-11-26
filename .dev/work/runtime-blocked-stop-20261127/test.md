# Independent test — 委派等待的配置阻断与停止响应

Tester: `RuntimeBlockedStopTest` (separate context; read-only; final worktree state)
Date: 2026-11-27
Verification profile: `focused`

## Commands and results

Worktree: `/Users/huyaohua/huyh/work/aigrouptool/kaiming`

1. `npm run typecheck` → exit 0, `tsc --noEmit`, no diagnostics.
2. `npx vitest run test/runtime.test.ts` → **67/67 passed** (1 file, 38.16s).
3. `npx vitest run test/runtime.test.ts -t "unavailable member model|breaks a chief dispatch wait|available queued member" --reporter=verbose` → **3/3 passed**, 64 skipped:
   - `reports an unavailable member model...` 225ms
   - `breaks a chief dispatch wait...` 337ms
   - `keeps waiting for an available queued member...` 1072ms

## Negative controls / mutation evidence

The tester reversed only the two source hunks in a throwaway `/tmp` copy; the main worktree was untouched and the copy deleted. Baseline: all 3 tests pass in the unmodified copy.

| Mutation | Observed failure |
|---|---|
| Remove/disable model-unavailable branch | blocked test fails: 5204ms > 2000ms (waited out 5s dispatch timeout) |
| Remove/disable stopRequestKey branch | stop test fails: 19811ms > 2000ms (waited out 20s timeout) |
| Change stop branch outcome `stopped` → `timeout` | stop test fails on `t-stop stopped` |
| Force every queued member unavailable | available-member test fails on `t-available timeout` |
| Drop `MODEL_UNAVAILABLE` error injection | blocked test fails |

## Gaps / residual risks

- `unavailableMember` throw paths (`resolveConfig` / `isAvailable` rejection) are reported under `MODEL_UNAVAILABLE` with detail text; the cause code is not separately modeled and those branches are untested.
- Per-25ms availability probing cost was not benchmarked; it reads the SDK availability snapshot and file stamps, no network.
- Substring assertions over the event stream are mutation-sensitive (confirmed), not structural parses.
- No full suite or E2E was run; this is the declared `focused` scope.
