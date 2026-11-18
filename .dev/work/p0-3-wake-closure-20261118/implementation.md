# Implementation notes — P0-3

Date: 2026-11-18
Plan: [plan.md](plan.md)

## Changes

| File | Change |
|---|---|
| `kaiming/src/tools/delegation-tools.ts` | `DEFAULT_WAIT_MS 120_000 → 600_000`, `MAX_WAIT_MS 300_000 → 1_800_000` (MIN stays 1_000). |
| `kaiming/src/server/write-methods.ts` | `wakeSettledStep` helper: calls `wakeForSettledStep`, reuses its dedupe/idle rules, invalidates the chief session when woken, and never turns a completed transition into an RPC error. Called from `task.control` (resume only), `session.input.stop` (queued branch, via `input.taskId`) and `session.recovery.resolve` (via the input row's `taskId`). |
| `kaiming/test/delegation.test.ts` | Default wait is 600_000; a request above the ceiling clamps to 1_800_000 (the lower clamp 1_000 was already pinned). |
| `kaiming/test/server-write.test.ts` | New `describe('step wake on non-run transitions (C8)')`: resume of a settled-but-paused step, stopping the last queued member, resolving the last interrupted member — each queues exactly one `notice-step-*` for the idle chief; negative control: stopping one of two members while the other is still queued queues nothing. |
| `docs/technicalnew/agents-and-tools.md` | G2 dispatch wait: 600s default, 1–1800s, and why (settle wait is exempt from the chief's watchdog). |
| `docs/technicalnew/runtime-contract.md` | R3: the three non-run transitions that wake the chief, and why the chief's own in-turn control/recover calls do not. |

## Verification (executed)

- `npm run typecheck` — clean.
- `npx vitest run test/server-write.test.ts test/delegation.test.ts` — 47 passed.
- `npx vitest run test/step-wake.test.ts test/step-wake-e2e.test.ts` — 12 passed (wake rules themselves unchanged).

## Deviation from the roadmap text

- The wake call lives only in the three write RPC paths. The roadmap also suggested `runner.controlTask` / `task(op=control)` / `task(op=recover)`; in those paths the chief is `processing`, so `wakeForSettledStep` returns `chief-busy` and adds nothing. Recorded in the R3 contract line.

## Post-review fixes (2026-11-18)

- `wakeSettledStep` returns whether it queued a notice; the queued-stop branch calls `options.notify()` on `true`, so the chief's notice is claimed at once instead of on the next idle pass.
- Harness records `invalidate` calls; the three positive tests assert the chief session is invalidated with entity `session`, and each asserts the notice names its own Task (guards against a mis-targeted wake).
- New negative control: a paused Task whose queued member is stopped produces no notice (`not-running`).
- R3 wording corrected: the wake reuses the existing routing, including `notice-<member input>` when a member of the step is still interrupted.
