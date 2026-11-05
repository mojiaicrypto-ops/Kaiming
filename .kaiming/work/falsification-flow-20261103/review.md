# Review — falsification flow

Task: falsification-flow-20261103
Independent reviewer: `SurprisedChimpanzee` (separate read-only context; no developer chat)
Scope: documentation/process changes only

## Initial result: failed

Findings from the first independent review:

1. **Blocking** — AC-46 accepted a negative control that failed for the wrong reason (crash/timeout/unrelated error). Fixed by requiring failure "按预期原因" and checking the rejection reason.
2. **Blocking** — AGENTS.md's settlement rule contradicted D-04/D-07 by requiring settlement and a clean worktree for read-only Tasks and unrelated changes. Fixed by scoping settlement to code/material product changes, reviewed delivery paths, read-only exceptions, and preserving unrelated dirty files.
3. **Non-blocking** — Negative-control report fields did not define when it is `passed` or where the rejection reason/oracle source lives. Fixed in `agents-and-tools.md`: passed only after the expected rejection, with `reason` and `evidenceRefs`.
4. **Non-blocking** — Reviewer's blocking list was not scoped to standard code work and expected the Test-stage control too early. Fixed: Review uses developer Red→Green and test source; the independent Test's executed control belongs to Test; lightweight/docs only when a checker is part of delivery.
5. **Non-blocking** — The behavior was not registered in I4. Fixed: added the positive-only/known-bad/self-test scenario and referenced it from validation.

## Re-review result: passed

All five findings verified resolved; no remaining blocking or non-blocking findings; internally consistent with D-04, D-05, G2/G3/G5, AC-46 and the role prompts. Confidence: 0.85.

## Notes

The reviewer was read-only and did not modify files. The real-model E2E of the blocking behavior remains unexecuted and is recorded as uncovered.
