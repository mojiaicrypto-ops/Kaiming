# Test Report — session Task scope

Task: session-task-scope-20261103
Environment: webapp Vite 7 / React 19; browser on `http://127.0.0.1:4173` after `npm run build`.

## Runs

| Check | Command | Result | Evidence |
|---|---|---|---|
| Ownership unit | `npx vitest run test/task-scope.test.ts` | passed | 2 tests |
| Full webapp | `npx vitest run --reporter=dot` | passed | 13 files, 92 tests |
| TypeScript | `npx tsc --noEmit` | passed | exit 0 |
| Build | `npm run build` | passed | `web-static` rebuilt |
| Real browser | select `s-7f07dfca29b5` (Task) then `s-67ab846f42ed` | passed | Task `t-db45d0ce` visible; after switch `activeTaskId=null`, `taskDetail=null`, no `task-live`; switch back restores |
| Draft preservation | type `draft-keep`, switch task/non-task/back | passed | textarea value still `draft-keep` |

## Not covered

- Restart-time browser regression was not rerun; this change is frontend-only and the server needs no backend update.
- The reviewer noted pre-existing `loadEarlier`/`refreshPending` cross-session response risks; not tested or changed here.

Overall: passed for the reported stale-Task bug.
