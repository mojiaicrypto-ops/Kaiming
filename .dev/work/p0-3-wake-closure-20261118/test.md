# Independent Test — P0-3

Date: 2026-11-18
Tester: separate agent context (`P03Test`), ran the commands itself.
Verdict: **pass**.

## Executed

| Step | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npx vitest run test/server-write.test.ts test/delegation.test.ts test/step-wake.test.ts test/step-wake-e2e.test.ts` | 4 files / 59 tests passed (re-run identical after restores) |
| Mutation (a): remove the resume wake call | test fails at the notice-count assertion (`expected [] to have a length of 1`); RPC still 200; restored byte-identical |
| Mutation (b): remove the queued-stop wake call | same failure shape; restored byte-identical |
| Mutation (c): remove the resolve wake call | same failure shape; restored byte-identical |
| Mutation (d): `UNSETTLED = ['processing']` in `step-wake.ts` | the step-busy negative control fails (`expected length 0, received 1`); restored byte-identical |

Every mutation failed at the intended assertion: the transition still succeeded and only the notice was missing, so the tests measure the wake, not the RPC.

## Coverage notes (and responses)

| Note | Response |
|---|---|
| The step-busy negative control cannot detect a *removed* call site (absence of a notice is also true when nothing is called) | accepted: the three positive tests are the removal guard; the negative control guards the rule |
| Chief invalidation unobserved (harness passed no `invalidate`) | fixed in response: harness records invalidations and each positive test asserts the chief-session publish |
| Only the `queued` unfinished-peer state is covered at the RPC sites | accepted: the other wake rules stay covered by `step-wake.test.ts` |
| The positive tests did not assert which Task the notice names | fixed in response: each asserts `notice.taskId` |
| Wake-failure catch, pause/cancel paths, null `taskId` untested | accepted and recorded; the plan added a paused-Task negative in response |
| `server-write` harness cannot race: seeded member sessions have no `sessions` row, so the worker cannot claim them | recorded as the reason the tests are deterministic |
