# Independent test report — report-retry-budget-20261114

Executed 2026-11-14 on the workbench checkout at commit `8823dc6` plus the four uncommitted
review-remediation edits (`checks/report-ledger-replay.ts`, `src/runtime/runner.ts`,
`src/tools/guidance.ts`, `test/task-tools.test.ts`) and the untracked work-dir docs. Every result
below is from commands I ran myself; nothing accepted from prior claims.

```yaml
test:
  task: report-retry-budget-20261114
  environment: Node v24.8.0, macOS darwin 25.5.0 arm64; vitest 3.2.7 (kaiming server suite 65 files, webapp suite 20 files)
  runs:
    - command: npx vitest run
      result: passed
      exit_code: 0
      evidence: >
        Test Files 65 passed (65), Tests 628 passed (628), 0 failures, 23.70s
        (raw output artifact://168). Includes the rewritten model-output-guard suite
        (18 cases incl. adversarial generator 200 seeds + 100 healthy seeds, any-success
        mutation self-test, bridge reuse) and the two runtime integration tests through the
        real Pi loop.
    - command: node checks/report-ledger-replay.ts
      result: passed
      exit_code: 0
      evidence: >
        "PASS: 1003 inputs replayed across the transcripts in .kaiming-data"; exactly 1 terminal
        trip — settler incident i-f485624c in the 2026-11-13T16-37-00 session (44 consecutive
        failures in the input, 48 across the session) — and exactly 1 corrective-only trip — the
        17:32 calibration input (5 failures then a valid report). Every other input: no trip.
        Confirmed both input ids exist in the real transcripts (i-4b5c33f6 appears in the
        17-32-50 file, i-f485624c in the 16-37-00 file).
    - command: npx tsc --noEmit
      result: passed
      exit_code: 0
      evidence: root typecheck, no output
    - command: cd webapp && npx tsc --noEmit && npm test
      result: passed
      exit_code: 0
      evidence: >
        webapp typecheck clean (exit 0); vitest Test Files 20 passed (20), Tests 133 passed
        (133), 2.71s (raw output artifact://175). Catalog error.REPORT_RETRY_EXHAUSTED key type-checks.
    - command: npm run check:prompts
      result: passed
      exit_code: 0
      evidence: "15/15 prompt-language checks passed"
  not_covered:
    - area: Real-model replay of the poisoned-session continuation (plan acceptance item 6)
      reason: >
        No live workbench/provider credentials on this workstation; the plan's verification
        profile explicitly declares real-provider network tests as "not run ... recorded as such".
      disposition: accepted
  result: passed
```

## Falsification check 1 — the replay would fail on a broken ledger

Reasoned from `checks/report-ledger-replay.ts` (read, not assumed):

- The failure path is real: `failure()` (lines 94-100) prints per-input diagnostics and calls
  `process.exit(1)`; both trip-set assertions route through it —
  `terminals.length !== 1 || settlerTerminal.length !== 1` (lines 103-105) and
  `correctiveOnly.length !== 1 || calibrationTrip.length !== 1` (lines 107-109). A run is marked
  `terminal`/`correctiveUsed` only when `run.guard.observeEvent(...)` returns true (lines 75-87).
- **Removed ledger**: with the ledger gone, `observeEvent` never trips for any of the 1003
  replayed inputs → `terminals` is empty → `terminals.length !== 1` → exit 1. Cannot pass.
- **Wrong reset rule (streak reset on any tool success)**: the replay deliberately feeds *only*
  `agent_report` toolResults to the guard (lines 66-67 skip all other tool results), and the two
  inputs it must discriminate are 44 consecutive `agent_report` failures (incident) and
  5 failures + 1 success (calibration) — neither sequence is discriminated by an any-success
  reset policy, so this script alone is invariant to that mutation. The discriminating check is
  the shipped unit self-test `test/model-output-guard.test.ts:146-156` ("the any-success mutation
  fails to trip on the 2026-11-13 incident sequence"): it constructs the real incident shape
  `[reportResult(true), otherResult('read', false)] × 5` (successful `read` interleaved between
  report failures), asserts the shipped guard trips with `fault.code === REPORT_RETRY_EXHAUSTED`
  and the same shipped class constructed with `{ resetOn: 'any-success' }` never trips
  (`fault` undefined). That test ran and passed inside run 1, so both mutations fail as intended.

## Falsification check 2 — the integration assertion reads the persisted transcript

`test/runtime.test.ts:1879-1934` ("terminates a member run after five failed report attempts, one
corrective turn, and five more") obtains the history via
`h.store.getSessionBinding('s-ledger')` → `readFileSync(binding?.piFile ?? '', 'utf8')`
(lines 1929-1930). `store.getSessionBinding` (store.ts:2321) returns the persisted session-binding
record containing `piFile` — the same access path production uses (`read-methods.ts:387-388` reads
history through `binding?.piFile`), so the assertions at lines 1931/1933 (exactly 1
`kaiming.model-output-correction` marker and exactly `REPORT_FAILURE_LIMIT * 2` = 10
`"toolName":"agent_report"` occurrences) are evaluated against the on-disk transcript, not
in-memory state. If the binding were missing, `readFileSync('')` throws ENOENT and the test fails —
it cannot pass silently. The companion recovery test (lines 1996-2000) reads the persisted file the
same way (1 marker, 6 agent_report occurrences).

## Verdict

All five required runs passed; both falsification checks hold. The only uncovered area — the
real-model replay — is not runnable here (no provider credentials/workbench) and is accepted per
the approved plan's declared fallback, with the offline transcript replay (run 2, 1003 inputs)
standing in. **Result: passed** — Settlement may proceed.
