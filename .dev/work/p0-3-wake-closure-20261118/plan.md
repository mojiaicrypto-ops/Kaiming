# Plan — P0-3 dispatch wait window and wake closure (C8)

Date: 2026-11-18
Roadmap item: `docs/technicalnew/gap-register.md` §P0-3
Verification profile: **focused**

## Problem

1. `dispatch` waits 120s by default while a development or test step legitimately runs for many minutes; each expiry costs a chief polling turn. C10 already exempts `settleStep` from the chief's watchdog, so a longer wait is free.
2. `wakeForSettledStep` is called only from `handleOutcome` (a run settled) and the startup scan. Three transitions settle the last unfinished member without producing a run outcome: `task.control(resume)`, `session.input.stop` on a `queued` member input, and `session.recovery.resolve` closing an `interrupted` member input. In those cases the chief is never woken and the Task stalls until the user types.

## Scope

- `kaiming/src/tools/delegation-tools.ts`: `DEFAULT_WAIT_MS 120_000 → 600_000`, `MAX_WAIT_MS 300_000 → 1_800_000` (MIN stays 1_000).
- `kaiming/src/server/write-methods.ts`: call `wakeForSettledStep` after the three transitions; on `woken`, invalidate the chief session so the notice is pushed.
- `docs/technicalnew/agents-and-tools.md` G2 dispatch wait wording; `docs/technicalnew/runtime-contract.md` R3 wake bullet.
- Tests: `test/delegation.test.ts` (default/ceiling), `test/step-wake.test.ts` + `test/server-write.test.ts` (three positive paths, one negative control).

## Non-goals

- No change to `wakeForSettledStep`'s own dedupe/idle rules.
- No wake from inside the chief's own turn (`task(op=control)` / `task(op=recover)`): the chief is `processing`, so the wake would report `chief-busy` and add nothing; recorded as a deliberate deviation from the roadmap text.
- No client-side timeout changes: MCP `delegate`/`wait` keep their own 45s cap.

## Implementation

1. Constants and the `waitTimeoutMs` doc line (600s default, clamped 1–1800s).
2. `write-methods.ts`:
   - `task.control`: after `options.controlTask(...)`, when `command === 'resume'`, wake the Task and invalidate its chief session if woken.
   - `session.input.stop` (queued branch): after `store.requestStop(...)`, wake `input.taskId` when it is not null.
   - `session.recovery.resolve`: after `store.resolveInterruptedInput(...)`, wake the input's `taskId` (read before/after resolve; the row keeps it).
   - One local helper so all three share the try/catch and the invalidation rule; a wake failure is logged nowhere and must not fail the RPC? No — swallowing silently is wrong: the three call sites already run inside the RPC; a thrown wake would surface as a failed stop that already happened. Wrap in try/catch and rethrow as no-op only for the wake call, mirroring `main.ts` handleOutcome (logs there). For write-methods there is no logger option; return the fact in the response? Keep simple: try/catch with a comment that the transition already happened, and the startup scan covers a missed notice.

## Acceptance

- A `task.control(resume)` on a paused Task whose step is already settled queues `notice-step-*` for the idle chief.
- Stopping the last `queued` member input of a step queues the notice.
- Resolving the last `interrupted` member input queues the notice.
- Negative control: while another member of the step is `processing`/`queued`, or the Task is `paused`, the same calls queue no notice (`woken: false`) — the wake never treats "not settled" as settled.
- `clampWait` defaults to 600_000 and clamps 1_000..1_800_000.

## Verification

- `npx vitest run test/delegation.test.ts test/step-wake.test.ts test/step-wake-e2e.test.ts test/server-write.test.ts`
- `npm run typecheck`
- Independent Review/Test before settlement.
