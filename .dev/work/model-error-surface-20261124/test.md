# Independent test — model error surface (2026-11-24)

- Tester: `ModelErrorTest` (independent stage; no product/test/doc edits; only this report and `/tmp` probes).
- Worktree: `f401b39` + the uncommitted model-error change set (tracked modifications plus 6 new product/test files; unrelated README/docs/INDEX edits ignored). Review/F1/F2 were treated as claims; behavior was re-derived from the current diff and real runs.
- Verdict: **PASSED** for the required focused scope. No failed required check; no blocking product defect. One low-severity plan deviation (specialist-drawer settings shortcut) is recorded below and does not fail the stated acceptance.

## Environment

- macOS 25.5.0 arm64; Node `v24.8.0`; npm `11.6.0`.
- `vitest 3.2.7`; `playwright 1.65.1`, Chromium (Chrome for Testing 156.0.8078.4, headless); esbuild 0.28.2 (boundary probe only).
- Commands run from the repo root unless a `cd` is shown. No real model credentials or live prepdex database were used.

## Required checks

### 1. Typechecks

| Command | Exit | Evidence |
|---|---|---|
| `npm --prefix kaiming run typecheck` | 0 | `tsc --noEmit`, no diagnostics |
| `npm --prefix kaiming/webapp run typecheck` | 0 | `tsc --noEmit`, no diagnostics |

### 2. Focused server tests

`cd kaiming && npx vitest run test/model-error.test.ts test/runtime.test.ts test/server-stream.test.ts`

```
Test Files  3 passed (3)
     Tests  83 passed (83)
Duration  38.54s
EXIT=0
```

Covers the real 429 `MONTHLY_REQUEST_COUNT` classifier sample, a real Pi run with the 429 stub storing `MODEL_QUOTA_EXHAUSTED`, and the snapshot read/clear path for a persisted old `MODEL_ERROR` row. No skips reported.

### 3. Focused webapp tests

`cd kaiming/webapp && npx vitest run test/slot.test.ts test/reminders.test.ts test/error-boundary.test.tsx`

```
✓ test/slot.test.ts (32 tests)
✓ test/error-boundary.test.tsx (1 test)
✓ test/reminders.test.ts (10 tests)
Test Files  3 passed (3)
     Tests  43 passed (43)
EXIT=0
```

### 4. Build + focused browser

`cd kaiming && npm run build; npx playwright test browser/model-error.spec.ts browser/acceptance.spec.ts -g "a quota failure|a waiting question and a finished turn raise reminders" --reporter=list`

```
✓ built in 1.18s        (vite, 212 modules -> ../web-static)
✓ 1 [chromium] › acceptance.spec.ts:229 › a waiting question and a finished turn raise reminders (1.1s)
✓ 2 [chromium] › model-error.spec.ts:16 › a quota failure is visible, survives reload, and is not announced as a completion (530ms)
2 passed (4.4s)
BUILD_EXIT=0 PLAYWRIGHT_EXIT=0
```

The success-reminder acceptance case is a real positive control in the same run: the normal `Conversation finished` toast still appears.

### 5. Extra repository checks (cheap, relevant to the changed files)

| Command | Exit | Evidence |
|---|---|---|
| `cd kaiming && npx vitest run test/web-i18n-keys.test.ts` | 0 | 4/4 keys/placeholders pass (new `error.MODEL_*` / `banner.runFailed` / `error.modelSettings` entries included) |
| `cd kaiming/webapp && npx vitest run test/member-row-state.test.ts` | 0 | 8/8; only the `Translate` signature was widened, behavior unchanged |

## Independent controls (not relied on by the developer)

### A. Classifier invoked directly (`node /tmp/model-error-independent.mjs`)

Actual returned values; exit 0, all pass:

```
generic 429+requests (F1 regression): MODEL_RATE_LIMITED
real Kiro monthly sample:             MODEL_QUOTA_EXHAUSTED
402 Kiro monthly (browser fixture):   MODEL_QUOTA_EXHAUSTED
401 invalid api key:                  MODEL_AUTH_FAILED
403 with quota wording:               MODEL_AUTH_FAILED   (auth checked first, by design)
context window sample:                MODEL_CONTEXT_EXCEEDED
500 unknown:                          MODEL_ERROR
empty:                                MODEL_ERROR
literal 'rate_limit_error':           MODEL_RATE_LIMITED
publicFailureDetail(1001 chars):      1001 chars, ends with '…'
```

The generic `'429 Rate limit reached for requests'` sample maps to `MODEL_RATE_LIMITED` (F1 is actually fixed), and the `MONTHLY_REQUEST_COUNT` sample maps to quota.

### B. Persisted old `MODEL_ERROR` row through the real `session.stream.prepare` handler

`node /tmp/model-error-independent.mjs` built a real `Store`, real `RpcRouter` + real `registerStreamMethods` (no server mocks), then read the snapshot after direct claim/finish writes:

```
old MODEL_ERROR Kiro row maps to quota:
  {"inputId":"i-legacy","status":"failed","code":"MODEL_QUOTA_EXHAUSTED",
   "message":"429 {\"type\":\"error\",...\"Kiro: usage limit reached ... (MONTHLY_REQUEST_COUNT)...}"}
later completed input clears lastInputError: null
old MODEL_ERROR generic 429 maps to rate:    code=MODEL_RATE_LIMITED
new specific code is not reclassified:       code=MODEL_AUTH_FAILED
later queued input clears the banner:        null
RESULT classifier_failures=0 snapshot_failures=0   (exit 0)
```

This is the no-migration acceptance path: an old row is classified at read time, keeps the exact provider text, and a later input clears it.

### C. Browser falsification of the "no completion toast" claim

`cd kaiming && npm run build && node /tmp/model-error-browser-probe.mjs` — real server + Chromium + 402 monthly fixture, with an init-script MutationObserver **and** 100 ms polling recording every `.toast` text ever rendered (so a transient 3.5 s toast cannot be missed by a point-in-time assertion).

```
PASS quota banner text names quota and Kiro
PASS provider detail appears exactly once (no duplicate error copy): count=1
toasts after failed run: []
PASS no completion toast at any point after a failed run
PASS error banner is still visible after the toast window
PASS no uncaught page error
PASS banner survives reload with provider text
PASS provider detail still appears exactly once after reload (snapshot path): count=1
PASS banner clears on the next successful input
toasts after successful run: ["Conversation finished"]
PASS successful run still raises the completion reminder (positive control)
RESULT failures=0   (BUILD_EXIT=0, probe exit 0)
```

Stronger than the repo spec: the repo assertion checks `body` once when the banner appears; the old failure toast could in principle have appeared moments later. The 4.5 s observation window saw no completion toast, while the same session's next successful turn did raise one.

### D. Root `ErrorBoundary` with a real React render throw

The repo test `kaiming/webapp/test/error-boundary.test.tsx` **only renders markup**, not a real catch: it calls `getDerivedStateFromError` directly, assigns `boundary.state` by hand, and `renderToStaticMarkup`s the fallback. It does not mount a throwing child, so it cannot prove React dispatches to the boundary, that `main.tsx` wiring works, or that no blank root remains.

Independent probe `node /tmp/error-boundary-probe.mjs` bundled the actual `AppErrorBoundary` with React 19/ReactDOM and mounted it in real Chromium around a child that throws during render:

```
PASS React render throw is caught by the real boundary (fallback is visible)
PASS fallback names the thrown exception (textContent, details collapsed)
PASS fallback offers reload
PASS root is not empty
PASS React swallowed the render error (no uncaught pageerror)
RESULT failures=0
```

`main.tsx` mounts `<AppErrorBoundary><App/></AppErrorBoundary>` inside `StrictMode`, so the class's real behavior plus the inspected mount wiring covers the acceptance intent. What remains untested is an actual exception thrown from inside `<App/>` through the production entry.

Probe-development notes (check limitations, not product defects): an early toast probe lost its observer because `addInitScript` ran before `documentElement` existed; an early boundary probe used `innerText`, which excludes a collapsed `<details>` containing the error text. Both were probe bugs, fixed before the final runs above.

## Observations / minor deviations

- `MemberDrawer.tsx:96` renders `<InputErrorNotice error={slot.inputError} />` with no `onOpenSettings`, so a specialist-drawer model failure shows the category + provider text but no "Model settings" shortcut. `Banner`/`ChatPage` do pass it (`ChatPage.tsx:495`), and the acceptance route test passes there. This contradicts the settlement summary's broader claim that the drawer routes model failures to `/settings/models`. Low severity; main chat surface meets acceptance.
- Provider detail longer than 1,000 chars is truncated with `…` by design (`publicFailureDetail`), so "exact provider detail" is bounded.
- No duplicate error copy observed for the 402 fixture: the provider string appeared exactly once in the page (banner only; the empty assistant error turn is not in the transcript).

## Not covered / disposition

| Item | Disposition |
|---|---|
| Full server suite (claimed 72 files / 742 tests) | Not run; focused files only. No blocker for this change's scope. |
| Full webapp suite (claimed 21 files / 146 tests) | Not run; focused files + i18n/member-row only. |
| Full browser suite (76; claimed 74/76) | Not run. The two known unrelated acceptance failures (task-create `verificationProfile`, status-bar width) were deliberately not exercised. Focused run was 2/2. |
| Actual HTTP 429 `MONTHLY_REQUEST_COUNT` through browser SSE | Not run: the browser fixture uses 402 because Pi retries 429 with backoff. 429 path is covered by the real-runner + stub-provider runtime test, the classifier, and the snapshot mapping; the live-frame wiring is covered by the 402 browser run. |
| Real prepdex database rows / real credentials | Not used per assignment. The plan's real Kiro sample string was used verbatim in classifier/runtime/snapshot checks. |
| Post-`agent_end` failure ordering in a real browser (watchdog / model-output guard) | Not browser-injected. Unit transitions (`slot` settling, `reminders` failed/stopped terminal) pass, and the success-side wiring is proven by the browser positive control; residual integration risk is low but real. |
| Render exception from inside `<App/>` via `main.tsx` | Not injected. Real class catch + inspected mount wiring verified. |
| Chinese-locale browser rendering | Not observed; key/placeholder consistency test passes and the browser run uses `en`. |
| Review nit: failed/interrupted `input` frame without `error` would leave `settlingInputId` set | Unreachable today (both publishers always include `error`); not re-tested independently. |

**Result: PASSED** — all required commands exited 0, independent controls confirmed the real Kiro row is quota, generic 429 is rate, reload/clear/no-toast behavior holds under a transient-toast recorder, and the root boundary catches a real React render error. Remaining gaps are testing-scope limitations, not observed product failures.
