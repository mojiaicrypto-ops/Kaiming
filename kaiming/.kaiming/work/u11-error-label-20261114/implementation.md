# Implementation Summary — U11 error label

```yaml
implementation:
  task: u11-error-label-20261114
  changed:
    - path: kaiming/webapp/src/chat/task-labels.ts
      purpose: >
        TaskMemberRow gains errorCode (the browser task.get payload already served it —
        src/server/read-methods.ts:571 — the webapp simply never mapped it). Two helpers:
        catalogErrorKey (MESSAGE_KEYS lookup with raw-code fallback policy, shared single
        source) and reportReasonOf (the reason sentence for a failed member's terminal code;
        null when the code is unknown/absent so the row keeps its generic note).
    - path: kaiming/webapp/src/chat/ChatPage.tsx
      purpose: map member.errorCode into the roster row (one line).
    - path: kaiming/webapp/src/chat/TaskTodo.tsx
      purpose: failed rows and missing-report rows show the resolved reason; an unknown code
        on a plain failure stays visible verbatim; rows without a resolvable code keep the
        generic note.
    - path: kaiming/webapp/src/chat/Banner.tsx
      purpose: adopted the shared catalogErrorKey helper (behavior-preserving refactor of the
        inline MESSAGE_KEYS pattern).
    - path: kaiming/webapp/test/member-row-state.test.ts
      purpose: four resolution cases — known code on a plain failure, the missing-report case
        (the incident shape: the sentence says WHY the report is missing), unknown code → null
        (raw code shown by the row), non-failed/no-code → null.
    - path: kaiming/browser/u11-roster-label.spec.ts
      purpose: focused browser path — three seeded members on a throwaway harness workbench
        (catalog sentence / raw-code fallback / generic missing-note fallback), screenshot.
    - path: kaiming/browser/harness.ts
      purpose: expose dataDir so specs can seed Task rows through a second Store connection
        (WAL) with the store's own invariants.
  behavior:
    - The task roster's failed member row names the reason in the user's language
      (REPORT_RETRY_EXHAUSTED → "The report failed repeatedly; the retry budget was exhausted
      and the run was stopped" / zh equivalent) instead of only the generic note.
    - A missing-report row whose errorCode has a catalog sentence shows WHY the report is
      missing (distinguishing the retry budget from an instruction-shaped REPORT_MISSING,
      which has no sentence and keeps the generic note).
    - Unknown codes stay visible verbatim on plain-failure rows; the blocked banner behavior
      is unchanged (now through the shared helper).
  tests_changed:
    - webapp/test/member-row-state.test.ts (+4 cases)
    - browser/u11-roster-label.spec.ts (new focused browser spec, passed with screenshot)
  plan_deviations:
    - >
      Design refinement discovered by the browser verification: a missing-report row with an
      UNRESOLVABLE code keeps the generic "Report missing" note (the raw code would say less
      than the missing fact). The plan's AC-1 wording ("unknown code renders the raw code")
      holds for plain-failure rows; the refinement narrows it for missing-report rows and is
      recorded here and in the review.
    - harness.ts dataDir exposure (test infrastructure, required by the browser spec).
  document_impact:
    - docs/technicalnew/gap-register.md U11 → closed (in the settlement commit)
  risks_remaining:
    - The chief's recovery decision still reads the guidance text (report-retry-budget task);
      the roster label is display-only.
    - REPORT_RETRY_EXHAUSTED / MODEL_OUTPUT_CORRUPTED catalog sentences exist in en and zh.
```
