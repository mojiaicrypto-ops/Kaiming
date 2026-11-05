# Test · dispatch 超时后的继续等待

```yaml
test:
  task: dispatch-timeout-continuation-20261029
  environment: >
    macOS darwin 25.5.0 arm64; Node 24.8; devagent at commit 731e68d plus the test-only
    follow-up; vitest 3.2.7; no real provider credential used.
  runs:
    - command: npm run typecheck
      result: passed
      exit_code: 0
      evidence: tsc --noEmit, no diagnostics
    - command: npx vitest run test/delegation.test.ts
      result: passed
      exit_code: 0
      evidence: 21 tests passed, including the timeout snapshot/hint assertion on both paths
    - command: npx vitest run
      result: passed
      exit_code: 0
      evidence: 45 files, 471 tests passed
    - command: npm run build
      result: passed
      exit_code: 0
      evidence: 201 modules transformed; vite build OK; only the existing >500 kB chunk warning
    - command: real tool probe with a fake settleStep returning outcome=timeout
      result: passed
      exit_code: 0
      evidence: >
        Empty-dispatch and dispatch-with-sessions receipts both expose
        hint="Member work is still running. This is a status snapshot, not a report or a stop:
        call task(op=dispatch) with no sessions again in this turn; do not end with a status update."
        A completed receipt has no hint; a second wait is accepted.
  not_covered:
    - area: Real-model compliance: a chief actually calling dispatch again after a timeout
      reason: No provider-backed journey exercises a timeout; the change is guidance text only.
      disposition: pending
  result: passed
```
