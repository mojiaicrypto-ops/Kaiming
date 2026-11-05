# Implementation Summary — scoped developer self-check

Task: scoped-self-check-20261103

## Changed

- `docs/productnew/modules/delivery.md`: D-05 scopes developer self-check; backend focused tests, page TDD unit + one focused browser path; broad passes only for cross-cutting risk; independent Test remains.
- `docs/productnew/acceptance.md`: AC-47.
- `AGENTS.md`: project-level scoped self-check rule.
- `docs/technicalnew/prompts/developer.md`, `tester.md`, `chief.md`: matching execution guidance; tester keeps related regression including indirect callers.
- `docs/technicalnew/implementation-checks.md`: I4 scenario for scoped/back-end/page/shared-contract changes.
- `docs/technicalnew/validation.md`: decision, landing points and uncovered real-model comparison.
- `.agentdev/work/scoped-self-check-20261103/{plan,implementation,review,test,settlement}.md`.

## Behavior

The developer phase no longer runs the full suite/full E2E by default. It runs focused tests for the changed behavior; page changes keep their TDD unit test plus one focused real-browser path. Broad runs are reserved for shared contracts, migrations, permissions/state machines, common layers or known high-risk changes. Independent Test still runs after Review with risk-based acceptance/regression scope.

## Verification

- `test/context.test.ts` 6 passed after final prompt edits.
- `npm run typecheck` passed.
- Independent review passed after one round of fixes.
- No business code changed.
