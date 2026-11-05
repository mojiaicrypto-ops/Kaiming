# Implementation · dispatch 超时后的继续等待

```yaml
implementation:
  task: dispatch-timeout-continuation-20261029
  changed:
    - path: devagent/src/tools/task-tools.ts
      purpose: task tool description now says a timeout is a snapshot and requires another dispatch in the same turn while members run.
    - path: devagent/src/tools/delegation-tools.ts
      purpose: timeout receipts on both dispatch paths carry an actionable `hint`; completed/blocked receipts do not.
    - path: devagent/test/delegation.test.ts
      purpose: assert the hint on the empty-dispatch path and the dispatch-with-sessions path.
    - path: docs/technicalnew/prompts/chief.md
      purpose: the timeout bullet now forbids ending the turn with a status update while work continues.
    - path: docs/technicalnew/agents-and-tools.md
      purpose: G2/M2 contract states the same continuation rule.
    - path: docs/technicalnew/validation.md
      purpose: record the observed stop, evidence, change and uncovered model-compliance area.
  behavior:
    - A timeout result is still the same snapshot; member work is never cancelled or rebuilt.
    - The model-visible text and details.hint both say to call task(op=dispatch) with no sessions again in the same turn.
    - A completed dispatch result has no hint.
  tests_changed: [devagent/test/delegation.test.ts]
  plan_deviations:
    - The production change was implemented before a formal Plan artifact existed; the user then requested settlement. Recorded transparently rather than claiming a pre-approved gate.
  document_impact: [docs/technicalnew/agents-and-tools.md, docs/technicalnew/prompts/chief.md, docs/technicalnew/validation.md]
  risks_remaining:
    - Real-model compliance (actually re-calling dispatch) is not verified; the host does not force continuation.
```
