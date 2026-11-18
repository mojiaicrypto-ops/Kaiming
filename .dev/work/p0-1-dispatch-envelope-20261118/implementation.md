# Implementation notes — P0-1

Date: 2026-11-18
Plan: [plan.md](plan.md)

## Changes

| File | Change |
|---|---|
| `kaiming/src/tools/delegation-tools.ts` | `buildDispatchEnvelope` (pure): Task identity/goal, plan path + acceptance excerpt (≤1500 chars, new members), scope line, writeScope/refs, latest upstream implementation/review/test results (review/test/settle), hard `agent_report` closing contract. `envelopeFacts` reads the Plan once and runs one scope check per dispatch. Envelope travels in `inputPayload`; `task_sessions.instructions` keeps the chief's raw text. Continuations carry the same envelope via `PlannedContinuation.inputPayload`. |
| `kaiming/src/store/store.ts` | `continueTaskSession` and the batch `createTaskSessions` continuation params accept optional `inputPayload` (fallback: the instructions as a text part). |
| `kaiming/src/runtime/runner.ts` | `recoverMissingReport`: one hidden turn (`kaiming.report-missing-recovery`, `display:false`) when a member stops normally with zero results, no stop request, no guard fault and a normal stopReason; runs under the same watchdog/waiting rules; a guard fault in the reminder turn goes through the existing one-shot output recovery. Extracted `waitingOnUser` so all three turns share one waiting predicate. Called once after `recoverModelOutput`. |
| `kaiming/src/runtime/model-output-guard.ts` | Owns both hidden-turn custom types and the renamed `isHiddenInternalTurnEvent` (set-based). |
| `kaiming/src/server/main.ts` | Uses `isHiddenInternalTurnEvent`, so neither hidden turn reaches the browser stream. |
| `kaiming/test/delegation.test.ts` | New: envelope in payload with raw instructions (create); upstream report path for a review-phase dispatch; continuation keeps raw instructions and carries the envelope. |
| `kaiming/test/runtime.test.ts` | New: prose-only first turn + delivered report → completed, one result, reminder `display:false`. Negative control sharpened: two prose-only turns → `failed/REPORT_MISSING`, zero results, reminder really occurred. Harness gained an `onEvent` passthrough and a runtime-checked `customMessageOf`. |
| `kaiming/test/model-output-guard.test.ts` | Filter covers both hidden types; an unrelated custom type stays visible. |
| `docs/technicalnew/agents-and-tools.md` | G2 dispatch paragraph (payload vs instructions) and agent_report paragraph (one hidden reminder before REPORT_MISSING). |
| `docs/technicalnew/runtime-contract.md` | R3: the two-layer dispatch input and the bounded reminder. |

## Verification (executed)

- `npm run typecheck` — clean.
- `npx vitest run test/delegation.test.ts test/model-output-guard.test.ts test/report.test.ts test/server-write.test.ts test/runtime.test.ts` — 133 passed.
- Negative control: `test/runtime.test.ts` "marks a one-line answer without the dispatched report as failed" asserts the reminder event occurred and the input still ended `failed/REPORT_MISSING` with no result.
- Stub-model pitfall found while writing the positive test: a `tool_calls` reply continues the agent loop, so the stub needs a following text reply; without it the loop repeats `agent_report` and the test times out. Recorded here so the next test author does not lose the same hour.

## Deviations from the roadmap text

- Pure builder + facts passed in (one Plan read, one scope check per batch).
- Continuations also receive the scope line (working-tree fact, previously supplied in review/test/settle).
- Hidden-turn types live in `model-output-guard.ts` next to the filter that must know both.

## Post-review fixes (2026-11-18)

- Moved `envelopeFacts` below the pure-wait return in `dispatchOp`: an empty-list `dispatch` no longer reads the Plan or runs a scope check (review minor).
- Dropped the duplicated `Scope: ` prefix (`scopeCheckText` already prefixes); the delegation test now pins the real line and rejects `Scope: Scope`.
- Tightened `isHiddenInternalTurnEvent`'s customType check to `typeof === 'string'` (removed a dead cast).
- Strengthened the negative control: exactly one `kaiming.report-missing-recovery` entry in the persisted history, and the review member's reminder names the verdict field.
- Sharpened `runtime-contract.md` R3 wording: continuations carry everything except the Plan path/acceptance excerpt.
