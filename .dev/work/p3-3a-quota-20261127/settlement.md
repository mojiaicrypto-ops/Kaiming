# Settlement — P3-3a

Date: 2026-11-27
Status: complete for quota slice
Verification profile: `broad`

- Added Store specialist count (chief/investigator/pending interaction excluded) and Runner `throttled` gate before claim.
- Server default `KAIMING_MAX_CONCURRENT_SPECIALISTS=4`; unit runners remain unlimited unless configured.
- Store test covers chief/investigator exclusion and release; step-wake e2e passes again after fixing the interactions column.
- Full suite 75 files / 786 tests; typecheck clean.

Remaining: overlap radar, project.files taskId/UI, setup hook, workspace.remove. Workbench remains stopped.
