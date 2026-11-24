# Settlement — model error surface

## Stable facts

- A provider failure is classified at the runtime boundary as `MODEL_QUOTA_EXHAUSTED`, `MODEL_RATE_LIMITED`, `MODEL_AUTH_FAILED`, `MODEL_CONTEXT_EXCEEDED`, or `MODEL_ERROR`; the provider's own words are preserved for display.
- `session.stream.prepare.lastInputError` carries the latest failed input (`inputId/status/code/message`); old `MODEL_ERROR` rows are classified at read time, so no data migration is needed. Host-closed chief interrupts are recorded as stopped and remain on the recovery path.
- A top-level `input` SSE frame is emitted on assistant `message_end` error and on terminal outcomes; the browser clears or sets the error by input identity and ignores late frames for older inputs.
- The chat banner names the failure with the provider detail and routes model failures to `/settings/models`; the specialist drawer shows the same category/detail without a navigation shortcut. The next accepted input clears it.
- Completion reminders wait for the terminal `input` frame and fire only for `completed`; failed/stopped/interrupted turns do not raise "Conversation finished".
- A root `ErrorBoundary` turns a React render exception into a readable error screen with reload instead of an empty root.

## Updated

- `docs/technicalnew/runtime-contract.md`: snapshot `lastInputError`, `input` frame, model error codes.
- `docs/technicalnew/ui-design.md`: model failure banner, settings action, completion-reminder exception, terminal wait, root boundary.
- `docs/technicalnew/validation.md`: current counts (72/742 server, 21/146 webapp) and the 2026-11-24 record.
- `.dev/work/model-error-surface-20261124/{plan,implementation,review,test}.md`.

## No change

- Product acceptance text: the behavior implements existing `docs/productnew/modules/project-workspace.md` requirement "配置无效或模型不可用时，提示具体原因和设置入口，保留用户输入与已有工作" and the `docs/productnew/README.md` failure-feedback row; no new product scope or risk acceptance is introduced.
- Database schema: no migration; old error codes are display-classified.

## Evidence

- Full server 72 files / 742 tests; full webapp 21 files / 146 tests; both typechecks; build; `check:prompts` 15/15.
- Browser `browser/model-error.spec.ts` 1/1 (banner, no completion toast, reload persistence, settings route); existing success-reminder acceptance 1/1; existing normal conversation/working-line 3/3.
- Full browser suite 74/76; the two failures are unrelated acceptance cases (task-create omits required `verificationProfile`; status-bar width assertion). They are not used as passing evidence.

## Residual boundary

- Provider retry/backoff can delay the banner after the first 429; no automatic retry/fallback is added.
- Classification is text-based; unknown errors keep raw text.
- ErrorBoundary covers React render failures only; event/network errors use existing banner/toast paths. The repo unit checks fallback markup; the independent test also mounted the real boundary around a throwing child in Chromium.
- Non-blocking review nits: a failed/interrupted frame without `error` would leave `settlingInputId` set (both publishers always include error today); terminal-status mapping is covered by reminder tests rather than a dedicated slot test.
- Live prepdex rows were used for diagnosis; no real credentials were replayed.

## Completion gate

- Plan: present. Review: passed. Test: `test.md` (independent, PASSED). Documents: updated. Commit: this settlement commit; hash reported in the final reply.
