# Independent Review — model error surface

- Reviewer: `ModelErrorReview` (separate session, read-only; no developer chat).
- Scope: plan, implementation summary, `git diff`, untracked new files, runtime/UI contracts.
- Result: **passed** after two fix rounds.

## Round 1 (failed)

- **F1 blocking**: `QUOTA_FAILURE` contained `limit[^"]*reached`, so `429 Rate limit reached ...` was classified as `MODEL_QUOTA_EXHAUSTED`; generic rate limits would point at billing. Fixed by removing that fragment; Kiro monthly remains quota through `usage limit`/`monthly`/`request_count`; added a `429 Rate limit reached` negative control.
- **F2 non-blocking**: failures classified after `agent_end` (`MODEL_OUTPUT_CORRUPTED`, `REPORT_RETRY_EXHAUSTED`, watchdog) could still emit the completion reminder. Fixed with `settlingInputId` + `terminalStatus` and a reminder gate that waits for the terminal frame and accepts only `completed`.
- **F3 non-blocking**: docs said `lastInputError` covered interrupted chief runs, but the host closes those as `stopped` and they remain on the recovery path. Fixed the contract and implementation summary to state that behavior.

## Round 2 (failed)

- F2 wiring: `useSessionReminders` effect dependencies omitted `settlingInputId` and `inputError`, making the settling-clear transition timing-dependent and normally losing successful completion reminders. Fixed by including `inputError`, `settlingInputId`, and `terminalStatus` in the dependency array; the terminal frame now deterministically re-runs the effect. Added a stopped/failed terminal negative control.
- F1 verified closed. F3 accepted.

## Round 3 (passed)

- Reviewer verified all effect reads are dependencies; successful turns emit once in both split-render and same-frame orderings; failed/stopped/interrupted terminals are suppressed; stale state is reset by snapshot/submit/remove/turn-start.
- Non-blocking nits left as recorded: a failed/interrupted frame without `error` would leave `settlingInputId` set (unreachable today because both publishers include `error`), and the terminal-status mapping is pinned by pure reminder tests rather than a dedicated slot test.
- Result: **passed**, confidence 0.9.

Evidence: reviewer direct classifier execution (`Rate limit reached` → rate, Kiro monthly → quota); code trace of SSE serialization, snapshot clearing, stale-frame guard, effect dependencies; no reviewer code edits. Developer suites/browser runs are listed in `test.md`/`implementation.md`.
