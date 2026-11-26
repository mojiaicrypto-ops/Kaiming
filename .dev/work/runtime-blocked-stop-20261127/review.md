# Independent review — 委派等待的配置阻断与停止响应

Reviewer: `RuntimeBlockedStopReview` (separate context; did not read development chat)
Date: 2026-11-27
Verdict: **PASS** — no blocking correctness findings.

## Checked

- `runner.settleStep` checks the current chief input's persisted `stopRequestKey` before member/model handling and returns `stopped` within the polling cycle (`runner.ts:1281-1328`).
- `unavailableMember` inspects only queued current-member inputs, resolves role/project effective configuration, and returns `MODEL_UNAVAILABLE` without mutating the queued input (`runner.ts:1333-1367`).
- Normal completed/timeout and unfinished-member behavior remains.
- `DelegationReturn.outcome` carries `stopped`; existing formatting and timeout hint paths accept it.
- New tests exercise queued preservation, `MODEL_UNAVAILABLE`, pre-timeout blocked return, and active-stop completion.

## Non-blocking finding and follow-up

The first review found that the unavailable-model test asserted `MODEL_UNAVAILABLE` in the event stream but did not directly pin the structured `blocked` outcome. Follow-up tightened the test to assert `t-blocked blocked`; it also added a direct available-model timeout control and a stopped-outcome assertion for the stop test.

Remaining non-blocking risks (not part of this focused fix):

- Config-resolution/availability-check exceptions are reported under `MODEL_UNAVAILABLE` with a detail message; they are not separately coded.
- The per-25ms availability probe cost was not benchmarked; the probe only reads the SDK availability snapshot and file stamps, no network.
