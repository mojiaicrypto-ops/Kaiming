# Plan · dispatch 超时后的继续等待

```yaml
plan:
  task: dispatch-timeout-continuation-20261029
  goal: >
    A dispatch timeout must be read as a status snapshot, not as work stopping: while members are
    still running/queued/waiting_user, the chief calls dispatch with no sessions again in the same
    turn instead of ending with a progress message.
  requirements: [D-06, M2, G2 dispatch]
  in_scope:
    - task tool description and timeout receipt hint
    - chief prompt and agents-and-tools contract wording
    - regression test for both timeout paths
  out_of_scope:
    - host auto-wake / automatic model turn
    - changing waitTimeoutMs or cancel semantics
    - compaction behavior
  tasks:
    - id: T1
      owner: developer
      change: add explicit timeout continuation rule to tool description and receipt; document it
      paths:
        - devagent/src/tools/task-tools.ts
        - devagent/src/tools/delegation-tools.ts
        - docs/technicalnew/prompts/chief.md
        - docs/technicalnew/agents-and-tools.md
      verify: [npm run typecheck, npx vitest run test/delegation.test.ts]
    - id: T2
      owner: reviewer
      change: independent review of final diff and timeout semantics
      paths: [devagent/src/tools, docs/technicalnew]
      verify: [review report]
    - id: T3
      owner: tester
      change: execute unit/build/tool-probe checks
      paths: [devagent]
      verify: [npx vitest run, npm run build]
  review_focus:
    - timeout is not a stop; hint appears on both dispatch paths
    - no change to cancellation, wait duration, or compaction
  test_plan:
    - real tool invocation with a fake settleStep returning timeout
    - full service suite and build
  document_impact:
    - docs/technicalnew/agents-and-tools.md
    - docs/technicalnew/prompts/chief.md
    - docs/technicalnew/validation.md
  risks:
    - the fix is model guidance, not a hard host guarantee; real-model compliance remains unverified
  rollback: git revert 731e68d (and the test-only follow-up commit)
  approval: >
    User reported the stop and asked for investigation; after the fix was implemented, user
    instructed "主要改完 按照这个进行结算和记录" (2026-10-29). Compact plan recorded at settlement.
```
