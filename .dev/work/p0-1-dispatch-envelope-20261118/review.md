# Independent Review — P0-1

Date: 2026-11-18
Reviewer: separate agent context (`P01Review`), different context from the developer, read-only.
Snapshot reviewed: `git diff` sha256 `ebf404f…3bce3` (worktree changed twice during the review; verdict applies to that content, later fixes listed below).
Plan: [plan.md](plan.md) · Implementation: [implementation.md](implementation.md)

## Verdict

**pass** — no blocking or major findings.

| Severity | Finding | Location | Evidence |
|---|---|---|---|
| blocking | none | — | — |
| minor | Envelope facts were computed before the pure-wait early return, so every empty-list `dispatch` poll read the Plan and ran `changedProjectPaths` (three git subprocesses, ~75 ms measured) with no payload to show for it. Fixed by moving `envelopeFacts` below the wait return. | `delegation-tools.ts` (now line 199) | `envelopeFacts` → `readPlan` + `scopeCheckFor` → `changedProjectPaths` (`git-delivery.ts:220-231`) |
| minor | `runtime-contract.md` wording implied continuations also receive the Plan path/acceptance excerpt; they do not. Fixed. | `runtime-contract.md:126` | `buildDispatchEnvelope` gates both on `!isContinuation` |

## Claim checks

1. **Envelope in payload, instructions raw — verified.** Identity/goal, plan path + acceptance (≤1500 + `…`, new members), scope line, writeScope/refs, `agent_report` contract with verdict for review/test; upstream latest per kind gated to review/test/settle (`listTaskResults` is ASC, `.at(-1)` is the latest). Create payload = instructions + envelope, row keeps raw; continuation passes `inputPayload` through `createTaskSessions` → `continueTaskSession` (fallback intact).
2. **One bounded reminder, no loop — verified.** Trigger checks member/currentInputId, zero results, no stop request, no host abort, no guard fault, normal assistant stop; one `display:false` turn under `runWithWatchdog`; classifier untouched, so a second prose answer still ends `failed/REPORT_MISSING`.
3. **Hidden from the browser — verified.** Both custom types in one set; publisher filters `message_start/end/update` with `role:'custom'`; reload safe because both history readers skip non-`message` entries (Pi persists them as `custom_message`).
4. **No change to chief / non-member / stopped / interrupted paths — verified.** Chief never has a `task_sessions` row; stop/hostAbort/error/aborted stopReasons skip; `waitingOnUser` extraction is an exact refactor.

## Plan vs diff

All steps delivered; the three recorded deviations match the code. One acceptance item is covered differently than the Plan's wording: the Plan said hidden events never reach `onEvent`, while the runtime test asserts the reminder reaches the runner stream with `display:false` and the server drops it (one-line filter + unit test on the predicate). Claim 3 holds by code inspection and by the history readers' behavior; an end-to-end server assertion does not exist and is recorded as a coverage gap, not a defect.

## Not covered by this review

- No tests were run by the reviewer (role rules); the independent Test agent ran them (`test.md`).
- `messaging-and-collaboration.md`'s delegation payload field list was not updated (outside the Plan's doc scope; no contradiction).
