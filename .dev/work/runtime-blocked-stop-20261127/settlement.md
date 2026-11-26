# Settlement — 委派等待的配置阻断与停止响应

Date: 2026-11-27
Task: `runtime-blocked-stop-20261127`
Status: complete
Verification profile: `focused`

## Delivered

- `kaiming/src/runtime/runner.ts`: `settleStep` now checks the chief input's persisted `stopRequestKey` and returns `stopped` in the polling cycle; queued current members are checked against their effective role/project model and return `blocked` with `MODEL_UNAVAILABLE` without changing the queued input.
- `kaiming/src/tools/delegation-tools.ts`: `DelegationReturn.outcome` includes `stopped`.
- `kaiming/test/runtime.test.ts`: 3 focused regressions (unavailable member model, active chief stop, available queued member timeout) plus harness `modelForRole`.
- Technical records updated: `docs/technicalnew/messaging-and-collaboration.md`, `docs/technicalnew/runtime-contract.md`, `docs/technicalnew/validation.md`.
- Task records: `plan.md`, `implementation.md`, `review.md`, `test.md`.

## Verification

- `npx vitest run test/runtime.test.ts`: **67/67 passed**.
- `npm run typecheck`: passed.
- Independent review: **PASS**, no blocking findings. Non-blocking outcome-assertion gap was closed by follow-up tests.
- Independent test: final 67/67 and 3/3 targeted; mutation checks showed the blocked branch, stop branch, stopped outcome, available-member path and error injection are all test-sensitive (including pre-fix waits of 5204ms and 19811ms).

## Known boundaries

- Current running workbench is not restarted, so this code is not active there yet. The current `t-8f86376bca2a` task was not altered; it had already moved to review after the model override was corrected.
- The chief receives the blocked reason through the `task(op=dispatch)` structured result in its active turn. The child-session-only UI blocked event was not changed, and a chief whose dispatch wait already ended is not newly woken for `MODEL_UNAVAILABLE`.
- No Store schema, Task phase, UI, full suite or E2E change.
- Non-blocking: availability/config-check exceptions are folded into `MODEL_UNAVAILABLE`; the per-poll availability probe is unbenchmarked.

## Commit

The reviewed delivery paths are committed relative to HEAD with the task records and docs.
