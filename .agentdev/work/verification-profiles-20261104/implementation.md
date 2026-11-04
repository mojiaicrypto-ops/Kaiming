# Implementation Summary — verification profiles

Task: verification-profiles-20261104
Work type: design/formal documents, no verification profile, no Test stage.

## Changed

- `docs/productnew/modules/delivery.md` D-04: adds `visual`/`focused`/`broad`, command/profile requirement, shared layout/token exclusions, design/document no-profile exemption, and independent Review profile audit.
- `docs/productnew/modules/delivery.md` D-05: default focused only for code/presentation Tasks; visual no unit tests/Test; focused backend/page split; broad scope.
- `docs/productnew/acceptance.md` AC-49.
- `docs/technicalnew/prompts/chief.md`: profile selection, `requiresTest` rules (visual/design/docs false), focused browser path only for page interaction, dispatch scope.
- `docs/technicalnew/prompts/developer.md`: execution by profile; visual no tests, focused scoped, broad broad.
- `docs/technicalnew/prompts/tester.md`: visual no Test, focused scoped, broad full with reason.
- `docs/technicalnew/prompts/reviewer.md`: independent profile/`requiresTest` audit and design/document exemption.
- `docs/technicalnew/ui-design.md` U8: relabeled release/cross-module gate; per-profile rows.
- `docs/technicalnew/implementation-checks.md` I4, `AGENTS.md`, `docs/technicalnew/validation.md`.
- `.agentdev/work/verification-profiles-20261104/`.

## Behavior

Pure copy/styling work no longer enters a Test phase. A local behavior change defaults to focused: developer runs changed tests plus (for page interaction) one browser path; Tester covers acceptance and related regression. Only broad changes (shared contract/layout/token, migration, permissions/state machine, common layer, high risk) allow full suite/cross-module E2E. Release gates remain full. No new Task state or database field.
