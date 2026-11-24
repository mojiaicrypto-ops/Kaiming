# Implementation — model error surface

## Changed paths

### Server

- `kaiming/src/runtime/model-error.ts` (new): conservative provider text classification and bounded public detail.
- `kaiming/src/runtime/runner.ts`: provider `stopReason === 'error'` stores the classified code (`MODEL_QUOTA_EXHAUSTED` for the real Kiro monthly sample), provider message unchanged.
- `kaiming/src/server/stream-methods.ts`: snapshot `lastInputError` for the latest failed input (unresolved member interruptions can also surface); old `MODEL_ERROR` rows are classified at read time; a later input clears it.
- `kaiming/src/server/main.ts`: publishes the immediate `input` frame on assistant `message_end` error and one terminal `input` frame per completed/failed/stopped/interrupted outcome.
- `kaiming/src/server/http.ts`: serializes `input` as a top-level business frame (same path as `invalidate`/`context`); previously it would have been wrapped as a generic `pi` event and dropped by the slot.

### Webapp

- `api/stream.ts`: `InputErrorView`, `PreparedSnapshot.lastInputError`, `input` frame fields.
- `state/slot.ts`: `inputError` state from snapshot and frames; clears on submit/turn start; ignores a late frame for an older input.
- `state/reminders.ts`: `inputErrorId` suppresses "Conversation finished" for a failed turn.
- `chat/InputErrorNotice.tsx` (new): localized category + exact provider text + model-settings action for `MODEL_*`.
- `chat/Banner.tsx`, `chat/ChatPage.tsx`, `chat/MemberDrawer.tsx`: show the notice in the chief conversation and specialist drawer.
- `chat/task-labels.ts`: any catalog `error.<code>` resolves, not only blocked keys, so member failure codes are localized.
- `app/ErrorBoundary.tsx` (new), `main.tsx`: recoverable render-failure screen (`app-error`, reload) instead of a blank root.
- `i18n/catalog.ts`: English/Chinese model error labels, banner title, settings action.
- `app/App.tsx`: settings action routes to `/settings/models`.

### Tests

- `test/model-error.test.ts` (5): real Kiro monthly sample must be quota; generic 429 rate; 401 auth; context; unknown; detail bound.
- `test/runtime.test.ts`: real Pi run with a 429 monthly stub stores `MODEL_QUOTA_EXHAUSTED` and the provider message.
- `test/server-stream.test.ts`: snapshot carries an old `MODEL_ERROR` monthly row as quota, clears after a later completed input (store-level deterministic, no provider retry race).
- `webapp/test/slot.test.ts`: snapshot error, stale-frame rejection, current-frame set, completed clear.
- `webapp/test/reminders.test.ts`: failed turn does not emit completion.
- `webapp/test/error-boundary.test.tsx`: fallback markup names the exception and has reload.
- `browser/model-error.spec.ts`: real server + Chromium; 402 monthly quota fixture (non-retryable; 429 classifier covered by unit/runtime) shows banner with Kiro text, no completion toast, survives reload, settings action routes to `/settings/models`.

## Behavior

A provider failure is persisted with a specific code and exact message. The browser sees the failure immediately via the `input` frame and after reload via `lastInputError`; the banner is persistent until a later input is accepted. Failed turns no longer trigger the completion reminder. A React render exception shows an error screen with reload.
Completion reminders wait for the terminal `input` frame: `agent_end` puts the slot in `settling`, and a failed terminal frame suppresses the reminder while a completed one releases it. This closes the ordering where a watchdog/model-output failure classified after `agent_end` was announced as finished.

## Deviations

- The browser fixture uses HTTP 402 instead of 429 to avoid the Pi SDK's retry backoff making the UI test wait; `test/model-error.test.ts` and `test/runtime.test.ts` cover the actual 429 `MONTHLY_REQUEST_COUNT` sample.
- `lastInputError` covers failed inputs and unresolved member interruptions. A chief watchdog interruption is closed by the host as `stopped` before the frame is published, so it remains on the recovery path; the banner does not claim it after that close.
- The specialist drawer shows the model error and provider text but has no settings shortcut; the shortcut exists on the chief chat banner. This is a minor plan deviation, recorded by the independent test.
- No schema migration: old `MODEL_ERROR` rows are classified for display; new runs store specific codes.

## Verification

- Full server: 72 files / 742 tests pass (`--maxWorkers=2`).
- Full webapp: 21 files / 146 tests pass.
- `kaiming` and `webapp` typecheck pass; Vite build passes; `check:prompts` 15/15.
- Browser: `model-error.spec.ts` 1/1 passes.
- No real model credentials were used; the live prepdex rows were used for diagnosis only.
