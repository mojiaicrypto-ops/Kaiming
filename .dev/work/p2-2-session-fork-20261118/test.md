# Independent Test — P2-2

Date: 2026-11-18 (two rounds)
Tester: separate agent context; mutations applied to real files and restored byte-identically.
Final verdict: **pass** — every named gap is closed; remaining items are minor and recorded.

## Counts (final state)

- `npm run typecheck` — clean
- `npx vitest run test/server-write.test.ts` — 30/30 passed
- `npm --prefix webapp test` — 137/137 passed; `webapp run build` — success
- `npx playwright test browser/session-fork.spec.ts` — 1/1; `browser/smoke.spec.ts` — 10/10

## Mutation evidence

| Mutation | Result |
|---|---|
| busy refusal disabled | shipped refusal test fails (`INVALID_ARGUMENT` vs `WORKSPACE_BUSY`) |
| `hasHistory` guard removed | shipped "binding that never carried history" fails (`HISTORY_UNAVAILABLE` vs `INVALID_ARGUMENT`) — the new missing-file test made the guard load-bearing |
| missing-file check removed | the same test/flow would surface a generic fork error instead of `HISTORY_UNAVAILABLE` |
| fork reuses the source `piFile` | binding assertion fails, and even with it disabled the later text-isolation assertions fail |
| unlink on failed insert removed | shipped orphan test fails (sessions dir grows) |
| fork file truncated to header | browser spec fails on the copied reply |

## Verified behaviour (probes/prod code)

- Source file: sha256, mtimeMs, ino and size unchanged across a fork; source binding path unchanged; the fork file's header records the parent session.
- Title: 100-char first line → `52×x… (fork)` exactly 60 code points; 60-point stored title → suffix kept at 60; explicit `title` collapsed/capped without a suffix.
- Fork point is the file's current leaf (`branchEntryId` no longer passed), so a post-compaction fork is not stale.
- Refusal reasons: empty history (`INVALID_ARGUMENT`), missing history file (`HISTORY_UNAVAILABLE`), non-chief (`INVALID_ARGUMENT`), foreign project (`NOT_FOUND`), unfinished input (`WORKSPACE_BUSY`).

## Remaining gaps (non-blocking)

- `branchSessionFile` still accepts an optional `branchEntryId` that production no longer passes (future branch-point routing; harmless).
- A double-click on `⎇` can produce two forks (fresh requestId each); no in-flight guard.
- The browser refusal assertion covers the empty-session reason only.
- Source mtime/ino invariance is probe-verified, not a shipped assertion (the shipped test asserts bytes).
