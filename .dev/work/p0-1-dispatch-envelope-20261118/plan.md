# Plan — P0-1 dispatch envelope and same-turn `REPORT_MISSING` recovery

Date: 2026-11-18
Roadmap item: `docs/technicalnew/gap-register.md` §P0-1 (upgrades R6)
Verification profile: **focused** (one local behavior in two places: dispatch payload assembly, and the member input terminal classifier).

## Problem

1. A dispatched member receives only the chief's free-text `instructions` (plus a scope note in review/test/settle). It burns 2–3 model turns re-reading the Task and Plan before working.
2. A member that answers in prose without calling `agent_report` is marked `failed / REPORT_MISSING` immediately (`runner.ts:902-908`), forcing a chief round trip to continue the same member.

## Scope

- `kaiming/src/tools/delegation-tools.ts`: pure `buildDispatchEnvelope`; envelope goes into `session_inputs.payload` only; `task_sessions.instructions` keeps the raw chief instructions.
- `kaiming/src/store/store.ts`: `continueTaskSession` accepts optional `inputPayload` (falls back to `{content:[{type:'text',text:instructions}]}`).
- `kaiming/src/runtime/runner.ts`: `recoverMissingReport` — one hidden corrective turn when a member stops normally without a report.
- `kaiming/src/runtime/model-output-guard.ts`: own both hidden-turn custom types; rename the filter to `isHiddenInternalTurnEvent`.
- `kaiming/src/server/main.ts`: use the renamed filter.
- Tests: `test/delegation.test.ts` (payload vs instructions), `test/runtime.test.ts` (self-heal positive; prose-only negative control).
- Docs: `docs/technicalnew/agents-and-tools.md` (G2 dispatch / agent_report), `docs/technicalnew/runtime-contract.md` (R3).

## Non-goals

- No change to Task phases, member creation rules, expectedKind derivation, or the report tool schema (P0-2 owns that).
- No retry of a *failed* run, no replay of tool work: the corrective turn only asks for the report of work already done.
- No prompt-file change: the requirement travels with the dispatch, so it survives prompt caching.

## Implementation

1. `buildDispatchEnvelope(task, member, facts)` — pure, English (G4):
   - `Task <id> (<type>, workKind=<workKind>, phase=<phase>, role=<roleId>, expectedKind=<expectedKind>)`, `Goal: <goal>`.
   - New members only: `Plan path:` when `planRef !== null`; `Acceptance:` from `acceptanceText(planText)` truncated to 1500 chars.
   - Scope line whenever a Plan exists (new and continuation): `Scope: <scopeCheckText(scopeCheckFor(...))>`; the caller computes it once per dispatch (one Plan read, one `git` call) instead of once per member.
   - `Assigned writeScope:` / `Cited refs:` when non-empty.
   - Upstream results when `phase` is review/test/settle: latest result per kind among implementation/review/test with `resultId`, `verdict`, `bodyRef.path`.
   - Closing contract line naming `agent_report`, the expected kind, the verdict requirement for review/test, and the `REPORT_MISSING` consequence.
2. Payload plumbing: new member `inputPayload` carries the envelope; `PlannedContinuation` gains `inputPayload` passed through `createTaskSessions` → `continueTaskSession`.
3. `recoverMissingReport(handle, sessionId, guard, inputId)` in `runner.ts`, called after `recoverModelOutput` inside the same `try` (usage/ledger subscriptions still active):
   - Trigger: member exists with `currentInputId === inputId`, zero results for the input, no stop request (`stopRequestKey === null` and not in `hostAborts`), no guard fault, last message is an assistant message whose stopReason is not `error`/`aborted`.
   - Action: `waitForIdle()`, then one `sendCustomMessage({customType: 'kaiming.report-missing-recovery', display:false}, {triggerTurn:true})` under `runWithWatchdog` (same waiting rules as `promptWithWatchdog`).
   - After the turn: if `guard.fault` is set, run `recoverModelOutput` once (it obeys `retryUsed`).
   - The existing terminal classifier is unchanged, so a second prose-only answer still ends `failed / REPORT_MISSING` (no loop).

## Acceptance

- A new member's `session_inputs.payload` text contains the Task identity, goal, Plan path, acceptance excerpt and the `agent_report` requirement; `task_sessions.instructions` equals the chief's raw text.
- A continuation's payload contains the same contract line; its instructions stay raw.
- Stub model: first reply prose-only, second reply `agent_report` → input `completed`, one result, and no `message_*` event for the hidden custom message reaches `onEvent`.
- Negative control: both replies prose-only → input `failed` with `errorCode === 'REPORT_MISSING'`, zero results (proves the recovery is one bounded turn and cannot fabricate a report).

## Verification

- `npx vitest run test/delegation.test.ts test/runtime.test.ts` (focused; no full suite).
- `npm run typecheck`.
- Independent Review/Test over these paths before settlement.

## Deviations from the roadmap text (recorded)

- The builder is pure with facts passed in, so one dispatch performs a single Plan read and a single scope check rather than one per member.
- Continuation dispatches also carry the current scope line: the scope check reflects the working tree, not Plan text, and the previous code already gave continuations that fact in review/test/settle.
- The hidden-turn custom types live in `model-output-guard.ts` beside the filter that must know both, instead of one constant in `runner.ts`.
