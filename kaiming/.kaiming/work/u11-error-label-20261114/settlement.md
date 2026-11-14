# Settlement Report — U11 error label

```yaml
settlement:
  task: u11-error-label-20261114
  stable_facts:
    - >
      The task roster's failed member row names the reason in the user's language: a terminal
      errorCode with a catalog sentence renders that sentence (REPORT_RETRY_EXHAUSTED → "The
      report failed repeatedly; the retry budget was exhausted and the run was stopped" / zh
      equivalent); a missing-report row with a resolvable code shows WHY the report is missing
      (distinguishing the retry budget from an instruction-shaped REPORT_MISSING); an unknown
      code on a plain-failure row stays visible verbatim; a missing-report row with an unknown
      code keeps the generic "Report missing" note (the missing fact is the accurate one there).
    - >
      No server change was needed: task.get already served member.errorCode
      (read-methods.ts:571); the fix is webapp-only (mapping + label resolution + rendering).
    - >
      Shared key resolution (catalogErrorKey) is now the single source for the Banner's
      blocked-code rendering and the roster's reason rendering; no untranslated key can leak
      (MESSAGE_KEYS gate, raw code on miss).
  updated:
    - docs/technicalnew/gap-register.md (U11 → closed)
  proposed_for_confirmation:
    - none — the surfacing behavior was explicitly ordered by the user ("启动U11，更改");
      the missing-report refinement is recorded in the review as judged sound
  indexes_updated:
    - docs/INDEX.md — checked, no change (gap-register already linked)
  archived:
    - kaiming/.kaiming/work/u11-error-label-20261114/plan.md
    - kaiming/.kaiming/work/u11-error-label-20261114/implementation.md
    - kaiming/.kaiming/work/u11-error-label-20261114/review.md (passed; 2 non-blocking P3
      findings fixed and re-verified by the same independent reviewer)
    - kaiming/.kaiming/work/u11-error-label-20261114/test.md (passed)
    - kaiming/.kaiming/work/u11-error-label-20261114/settlement.md (this file)
  no_change:
    - server code (the claim "task.get already serves errorCode" was verified, not assumed)
    - docs/technicalnew/runtime-contract.md (display-only change; R3 contract unaffected)
  completion_gate: passed
```

## Completion statement

Completed: Plan `kaiming/.kaiming/work/u11-error-label-20261114/plan.md` (user-ordered
implementation; focused profile); independent Review `review.md` — passed, both P3
remediations re-verified by the same reviewer; Test `test.md` — passed (independent
execution: root suite 65 files/628 tests matching the settled baseline, webapp 20 files/137
tests with the 4 new resolution cases, focused browser spec 1 passed with the three roster
behaviors and screenshot, tsc both ends); Settlement — gap-register U11 closed, artifacts
archived and committed. Remaining risk: none for this change; the catalog sentences exist in
en and zh, unknown codes stay visible, and the throwaway verification instance was not part
of production data.
