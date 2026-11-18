# Independent Review — P0-3

Date: 2026-11-18
Reviewer: separate agent context (`P03Review`), read-only.
Plan: [plan.md](plan.md) · Implementation: [implementation.md](implementation.md)

## Verdict

**pass** — no blocking findings. Correctness confidence 0.8.

| Severity | Finding | Location | Resolution |
|---|---|---|---|
| P3 | The queued-stop path queued the notice but never called `options.notify()`, unlike resume/resolve, so the notice waited for the worker's next idle pass instead of being claimed at once. | `write-methods.ts` stop branch | fixed: `wakeSettledStep` now returns whether it queued a notice and the branch calls `options.notify()` |
| P3 | The harness registered no `invalidate`, so "a woken step invalidates the chief session" was untested. | `server-write.test.ts` | fixed: harness records invalidations; the three positive tests assert `(chief, 'session', chief)` |
| P3 | The negative control covered only the step-busy clause; the plan also promised "Task paused → no notice". | `server-write.test.ts` | fixed: new paused-Task negative test |
| P3 | R3 wording implied every wake uses `notice-step-*`; with an interrupted member it routes to `notice-<member input>`. | `runtime-contract.md:131` | fixed wording |
| P3 | The roadmap also asked for wakes in `runner.controlTask` / `task(op=control)` / `task(op=recover)`; only the RPC layer wakes. | — | accepted and documented: the chief is `processing` there, so the wake is `chief-busy` anyway |

## Claim checks

1. Wait window: constants and `clampWait` correct; assertions trace to the roadmap document (independent of the changed docs).
2. Three wake sites: each sits after its transition; the helper's catch cannot fail a completed RPC; invalidation is gated on `woken`; `input.taskId` is always set by both member-creation paths (verified in the store).
3. Wake rules untouched (`step-wake.ts` absent from the diff); dedupe, step-busy, not-running, chief-busy and the interrupted routing are intact.
4. Mutation sensitivity: in the harness the worker cannot claim seeded inputs and no `onOutcome` is wired, so removing one wake call drops that test's notice count to 0.
5. Docs match the code, including the recorded in-turn deviation.

## Not covered

- A wake that throws is unexercised (the try/catch is inspected, not tested); its only effect would be a delayed notice, recovered by the startup scan.
- Pause/cancel paths and `input.taskId === null` short-circuits have no RPC-level negative test beyond the new paused case.
