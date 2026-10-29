# Settlement · dispatch 超时后的继续等待

```yaml
settlement:
  task: dispatch-timeout-continuation-20261029
  stable_facts:
    - A dispatch timeout is a status snapshot; it does not cancel or rebuild member work.
    - While members are running/queued/waiting_user, the chief must call task(op=dispatch) with no sessions again in the same turn.
    - The timeout receipt exposes an actionable hint; completed/blocked receipts do not.
    - The observed stop was not compaction: the last compaction was 02:58 and the affected turn began at 04:36 with no later compaction event.
  updated:
    - devagent/src/tools/task-tools.ts
    - devagent/src/tools/delegation-tools.ts
    - devagent/test/delegation.test.ts
    - docs/technicalnew/prompts/chief.md
    - docs/technicalnew/agents-and-tools.md
    - docs/technicalnew/validation.md
  proposed_for_confirmation:
    - Accept that real-model compliance with the timeout instruction remains unverified (test disposition pending).
    - Accept the compact Plan recorded at settlement; production code preceded the Plan artifact.
  indexes_updated: []
  archived:
    - .agentdev/work/dispatch-timeout-continuation-20261029/plan.md
    - .agentdev/work/dispatch-timeout-continuation-20261029/implementation.md
    - .agentdev/work/dispatch-timeout-continuation-20261029/review.md
    - .agentdev/work/dispatch-timeout-continuation-20261029/test.md
    - .agentdev/work/dispatch-timeout-continuation-20261029/settlement.md
  no_change:
    - docs/productnew/modules/delivery.md (D-06 already says timeout is not a pause and the chief decides)
    - docs/technicalnew/messaging-and-collaboration.md (M2 already defines timeout snapshot; wording refined in agents-and-tools)
    - docs/INDEX.md (no new authoritative document)
    - code map (repository has no Code Map asset)
  completion_gate: pending
```

## Pending

- Real-model compliance: a provider-backed run must show the chief calling dispatch again after a timeout. Disposition is pending, not accepted.
- No host auto-wake was added; that would create automatic model turns and requires a separate product decision.

## Commits

- `731e68d` fix(task): keep waiting after a dispatch timeout
- test-only follow-up commit: assert the dispatch-with-sessions timeout hint
