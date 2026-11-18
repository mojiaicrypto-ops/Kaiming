# Implementation notes — P2-2

Date: 2026-11-18
Plan: [plan.md](plan.md)

## Changes

| File | Change |
|---|---|
| `kaiming/src/runtime/pi-runtime.ts` | `PiRuntimeFactory.branchSessionFile({ sourcePiFile, cwd, branchEntryId? })`: opens the source through `SessionManager`, takes the recorded/current leaf, `createBranchedSession(leaf)` and returns the new file path + leaf. Missing source → `HistoryUnavailableError`; no leaf or no new file → explicit message. |
| `kaiming/src/store/store.ts` | `CreateSessionParams.title?` (inserted into `sessions.title`); `createForkedChiefSession(...)` writes the chief session row + its `session_bindings` row in one transaction (a row without a binding would look empty and never continue the copied context). |
| `kaiming/src/server/write-methods.ts` | `session.fork` (`projectId`, `sessionId`): chief + same project; refuses `queued`/`processing`/`interrupted` inputs (`WORKSPACE_BUSY` with the input ids); requires `hasHistory` (`INVALID_ARGUMENT: cannot fork an empty session`); title = source stored title, else the first user line (same rule as the rail), plus `(fork)`, 60 code points; creates the file first, removes it if the rows fail; publishes `invalidate(session)`; returns `{ sessionId, title, revision: 1 }`. Optional `forkSessionFile` injection. |
| `kaiming/src/server/main.ts` | Wires `forkSessionFile` to the runtime factory. |
| `kaiming/webapp/src/chat/SessionsList.tsx` + `ChatPage.tsx` + `app/App.tsx` | `⎇` action on every non-archived row (`data-testid="session-fork"`, localized label/hint); the shell calls the RPC, refreshes the rail, selects the copy, closes the sheet, and toasts success or the server reason. |
| `kaiming/webapp/src/i18n/catalog.ts` | `session.fork`, `session.forkHint`, `session.forked`, `session.forkRefused` (en/zh). |
| `kaiming/test/server-write.test.ts` | Fork tests: real history via a stub turn → copy with its own binding, source bytes unchanged, transcript readable, both sides then advance alone; fork of a source holding an unfinished Task (copy has no Task); refusals for empty, non-chief, busy and foreign sources with no new session rows. |
| `kaiming/browser/session-fork.spec.ts` | Real browser: a turn produces history, the rail's fork action yields a second row titled `… (fork)` that is selected and shows the copied reply. |
| `docs/technicalnew/runtime-contract.md` R1 | `session.fork` row. |
| `docs/technicalnew/ui-design.md` U5/U9 | Rail row action and method-consumption row. |

## Verification (executed)

- `npm run typecheck` (server) — clean; `webapp` `tsc --noEmit` — clean.
- `npx vitest run test/server-write.test.ts` — 27 passed (3 new fork tests).
- `npm --prefix webapp test` — 137 passed; `npm --prefix webapp run build` — success.
- `npx playwright test browser/session-fork.spec.ts` — 1 passed (real browser, scripted model).
- `npx playwright test browser/smoke.spec.ts` — 10 passed (rail change did not disturb existing surfaces).

## Design notes

- The fork uses the SDK's branch copy, not `forkFrom` or a runtime fork: the source stays live byte-for-byte, and abandoned branches are not copied.
- The copy owns no Task, input, interaction or channel; an unfinished source Task stays with the source.
- Failure ordering: file first, rows second, unlink on row failure — no orphan JSONL, and no row pointing at a missing file.

## Post-review fixes (2026-11-18)

Review and Test both returned needs_fix / "works but gaps"; each finding is closed:

- **Title rule**: `forkBaseTitle` no longer hard-cuts the first line at 40 with no marker; the derived name uses the rail's rule, and `forkTitle` reserves room so `(fork)` always survives the 60-code-point cap. An explicit `title` parameter is now accepted (whitespace collapsed, capped at 60, no suffix), matching the roadmap signature. Tests: long derived line → ends with ` (fork)` and ≤60 points; explicit 80-char title → used verbatim, capped, no suffix.
- **Empty/missing history**: `hasHistory: false` and a missing bound file are now separate refusals (`INVALID_ARGUMENT` / `HISTORY_UNAVAILABLE`), with a shipped test that a binding without history never forks even when its path exists.
- **Orphan history**: a test forces `createForkedChiefSession` to throw and asserts the sessions directory gains no file (`STORAGE_UNAVAILABLE`, unlink path exercised). Previously only a probe could see this.
- **Fork point**: the RPC no longer passes the recorded `branchEntryId`; the file's current leaf is used, so a fork after compaction does not branch at a stale entry.
- **Session id**: `s-<12 hex>` to match the repo convention.
- **Browser spec**: waits for the run indicator to clear before forking (message_end precedes input finalisation), and covers the refusal toast on a fresh session (`Not forked`).

## Final nits (2026-11-18)

- Removed the unused `branchEntryId` from the fork injection and `PiRuntimeFactory.branchSessionFile`; the fork point is always the file's current leaf.
- Title caps now use UTF-16 units everywhere (`session.fork`, `session.rename`, the rail's `titleOf`), never splitting a surrogate pair; astral title covered by a test.
- Busy coverage extended to `processing` and `interrupted` (claimed-then-finalised input), not only `queued`.
- R1 documents `title: ''` as "treated as not provided".
