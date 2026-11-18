# Independent Review — P2-2

Date: 2026-11-18 (two rounds)
Reviewer: separate agent context, read-only.
Plan: [plan.md](plan.md) · Implementation: [implementation.md](implementation.md)

## Final verdict

**pass** — no blocking findings. Round 1 was `needs_fix`; every finding is closed and re-verified.

## Round 1 findings and resolutions

| Sev | Finding | Resolution |
|---|---|---|
| P2 | Fork title did not follow the rail rule R1 stated: the derived base was cut at 40 code points with no marker, and composing then truncating could drop `(fork)` entirely. | `forkBaseTitle` returns the stored name or the whole first non-empty line; `forkTitle` reserves room so `(fork)` survives; the cap is 60 **UTF-16 units**, the unit `session.rename` and the rail enforce; `titleOf` (`session.list`) now uses the same unit, so a copy's displayed base matches the source. Astral titles never split a surrogate pair (tested). |
| P2 | "No orphan JSONL on a failed insert" was untested (`rmSync` removal passed everything). | A shipped test monkeypatches `createForkedChiefSession` to throw and asserts the sessions directory gains no file; removing the unlink fails it. |
| P3 | `title?` was promised by the roadmap but ignored. | Implemented: whitespace-collapsed, capped at 60 units, no suffix; an empty string is treated as not provided (documented in R1). |
| P3 | The browser spec could fork while the input was still `processing` (message-end precedes input finalisation). | The spec waits for the `chief-working` indicator to clear before forking, and asserts the refusal toast on a fresh session. |

## Round 2 residuals and resolutions

| Sev | Finding | Resolution |
|---|---|---|
| P3 | `branchEntryId` was dead API surface after the fork switched to the file's current leaf. | Removed from `forkSessionFile` and `PiRuntimeFactory.branchSessionFile`; the fork point is always the file's leaf (a recorded entry can lag compaction). |
| P3 | The busy filter was only exercised through `queued`. | A test now claims an input (`processing`) and then finalises it `interrupted`; both refuse with `WORKSPACE_BUSY`. |
| P3 | UTF-16 vs code-point cap inconsistency between fork and the rail. | `titleOf` and the fork now share the UTF-16 rule; the existing rail assertion was updated to the documented cap. |
| note | Browser proof lives in `browser/session-fork.spec.ts` rather than `acceptance.spec.ts`. | Accepted: any Playwright spec is the acceptance path; recorded. |

## Claim checks (final)

1. Fork copies only the current branch; source bytes/binding untouched; the copy owns no Task/channel/input/interaction/authorization; the copied transcript's input markers cannot be mis-attributed because the source must be settled.
2. Refusals are distinct and precede any file work: non-chief (`INVALID_ARGUMENT`), foreign project (`NOT_FOUND`), `queued`/`processing`/`interrupted` (`WORKSPACE_BUSY` with ids), no history (`INVALID_ARGUMENT`), missing history file (`HISTORY_UNAVAILABLE`).
3. Ownership, return shape `{sessionId, title, revision: 1}`, `s-<12 hex>` id convention and the unlink-on-row-failure ordering match R1.
4. UI: the `⎇` action is on every non-archived row in both rail instances; success refreshes/selects/toasts; refusal shows the server reason.
5. Mutation sensitivity is now satisfied for the fork file, busy filter, history guard and orphan cleanup; text-isolation assertions depend on separate files.
6. Docs (R1 row, ui-design U5/U9) state the implemented rules.

## Accepted, non-blocking

- A rapid double-click can create two forks (fresh request id per click); no in-flight guard.
- Browser refusal coverage exercises the empty-session reason only.
