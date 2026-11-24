# Model error surface — 2026-11-24

## Context manifest

- Loaded: `docs/INDEX.md`, `docs/productnew/modules/project-workspace.md` (model-unavailable/error requirement), `docs/productnew/acceptance.md` AC-11/AC-18/AC-44, `docs/technicalnew/runtime-contract.md` R3/R4 and `error.*` table, `docs/technicalnew/ui-design.md` banner/transcript rules.
- Code: `kaiming/src/runtime/runner.ts`, `pi-runtime.ts`, `server/main.ts`, `server/stream-methods.ts`, `webapp/src/api/stream.ts`, `state/slot.ts`, `state/useSession.ts`, `state/reminders.ts`, `chat/Banner.tsx`, `chat/Transcript.tsx`, `chat/MemberDrawer.tsx`, `i18n/catalog.ts`, `main.tsx`.
- Evidence: live `prepdex` data has four `MODEL_ERROR` rows whose message is `429 ... Kiro: usage limit reached ... (MONTHLY_REQUEST_COUNT)`; the browser repro (stub 429) showed only the user's `hello`, no error banner, and a false "Conversation finished" toast. Empty assistant error history messages are filtered from the transcript by `Transcript`.
- Excluded: unrelated MCP/P3 code, oldcode, docs/old, external model behavior.

## Goal

A model failure is never silent: the browser shows a persistent, actionable error with the exact provider detail until a later input replaces it; the same failure survives reload; failed runs do not notify "finished"; unexpected render failures show a recoverable screen instead of a blank page.

## Scope

### Backend

1. Add pure `classifyModelFailure(errorMessage)` in `src/runtime/model-error.ts`:
   - `MODEL_QUOTA_EXHAUSTED` for quota/usage-limit/monthly-request/credits/billing/payment messages.
   - `MODEL_RATE_LIMITED` for generic 429/rate-limit/too-many-requests.
   - `MODEL_AUTH_FAILED` for 401/403/credential/api-key/auth messages.
   - `MODEL_CONTEXT_EXCEEDED` for context-window/length messages.
   - `MODEL_ERROR` otherwise. Unknown text stays visible.
2. `runner.ts` stores the classified code (not only `MODEL_ERROR`) when an assistant `stopReason === 'error'`; message remains the provider text.
3. `server/stream-methods.ts` snapshot includes `lastInputError` with `inputId/code/message/status` for the latest failed/interrupted input; old `MODEL_ERROR` messages are classified for display; a later input clears it. Add it to the technical stream contract.
4. `server/main.ts` publishes a non-persistent `input` frame on assistant `message_end` error and on every terminal outcome (`failed/interrupted/completed/stopped`). This makes the failure visible immediately without awaiting a snapshot and clears it when a later input settles.

### Frontend

5. `api/stream.ts` types for `InputErrorView`, snapshot `lastInputError`, and `input` frame.
6. `state/slot.ts` owns `inputError`; set from snapshot, clear on submit/turn start, set/clear from `input` frames; ignore a stale frame for an older input while a newer input is current.
7. `state/useSession.ts` exposes `inputError`.
8. `chat/InputErrorNotice.tsx` renders localized code sentence + exact server message; model-related codes offer "模型设置" (`/settings/models`). Used by `ChatPage` and `MemberDrawer`.
9. `reminders.ts` suppresses "Conversation finished" when the turn ended with an error.
10. `task-labels.ts`/catalog: general `error.<code>` keys for model errors and `MODEL_UNAVAILABLE`; unknown codes stay raw. Add en/zh keys including banner and settings action.
11. Root `app/ErrorBoundary.tsx` around `<App/>` shows a recoverable screen with the error text and reload, instead of a white page; `main.tsx` mounts it.

### Non-goals

- Do not retry provider calls or silently fall back to another model.
- Do not change the `MODEL_UNAVAILABLE` claim gate/queued semantics.
- Do not redesign the transcript or settings.
- Do not hide the provider's raw detail; do not add a second error copy when the banner already names the same input.

## Acceptance

- Real repro: stub returns 429 `MONTHLY_REQUEST_COUNT`; browser shows `MODEL_QUOTA_EXHAUSTED` localized sentence plus the Kiro text; reload still shows it; no "Conversation finished" toast; next successful input removes it.
- Existing prepdex `MODEL_ERROR` rows with monthly text map to quota in a reconnecting snapshot (no data migration).
- A 500 remains `MODEL_ERROR`; a generic 429/401/context sample maps to its category; raw detail shown.
- A render exception shows the boundary screen (`data-testid=app-error`) with reload, not an empty root.

## Verification (broad, because the SSE/snapshot contract changes)

- `npm --prefix kaiming test -- test/model-error.test.ts test/runtime.test.ts test/server-stream.test.ts` focused.
- `npm --prefix kaiming/webapp test -- test/slot.test.ts test/reminders.test.ts` focused.
- `npm --prefix kaiming run typecheck`; `npm --prefix kaiming/webapp run typecheck`; `npm --prefix kaiming run build`.
- Browser: `npx playwright test browser/model-error.spec.ts` (real server, stub provider, reload and clearing).
- Broad: `npm --prefix kaiming test` (all files) after focused green.
- Negative controls: quota sample must fail generic/rate expectations; rate sample must not be quota; a successful input must clear the banner; a stale frame must not replace a newer input's state.

## Document impact

- `docs/technicalnew/runtime-contract.md` (snapshot fields, error codes).
- `docs/technicalnew/ui-design.md` (error banner, settings action, crash fallback).
- `docs/productnew/acceptance.md` if a new observable acceptance row is needed; otherwise reference AC-44/AC-48 and project-workspace model error requirement.
- `.dev/work/model-error-surface-20261124/` evidence.

## Risks / rollback

- SSE contract shape is additive; old readers ignore the new frame, new readers tolerate absence.
- Classification must not mislabel quota as auth/context: tests use the actual Kiro string and negative samples.
- Error banner could show stale errors if frame/snapshot ordering is wrong: reducer guards input identity and tests cover stale frames.
- Rollback: revert the focused commit; no schema migration.

## Review focus

- Exact mapping/classification, stale frame handling, clear on completed input, reload persistence, reminder suppression, no duplicate error, no sensitive data in UI, fallback boundary.

## Approval

User request: "模型的额度不够了...前端不报错，直接白屏...容错性一定要做好，你检查下" — confirms this failure surface is in scope. Implementation proceeds under this plan.
