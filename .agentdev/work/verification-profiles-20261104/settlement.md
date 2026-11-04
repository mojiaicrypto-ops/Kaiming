# Settlement — verification profiles

Task: verification-profiles-20261104
Date: 2026-11-04
Status: completed

## Stable facts

- Code/presentation Tasks declare `visual`, `focused` or `broad` in the overall Plan; design/formal-document Tasks declare no profile and use independent Review + settlement with `requiresTest=false`.
- `visual`: copy/pure styling with no event, state, request or data change and no shared layout/design-token edit. No Test, no full suite; independent Review plus type/build and applicable visual evidence.
- `focused` (default when a code/presentation profile is unstated): one local behavior/function/interface/interaction change. Developer runs changed TDD/unit tests and, for page interaction, one browser path; Tester runs acceptance and related regression; no full suite.
- `broad`: shared contract, migration, permission/state machine, common layer, shared layout/design token or known high-risk change. Full suite/cross-module E2E allowed with the reason recorded.
- Full suites belong to broad or release/cross-module gates, not every Task.
- Independent Review checks profile/`requiresTest` against the actual change; mismatch is blocking.
- No new Task state, database field or program gate was added.

## Updated

- `docs/productnew/modules/delivery.md` D-04/D-05
- `docs/productnew/acceptance.md` AC-49
- `docs/technicalnew/prompts/{chief,developer,tester,reviewer}.md`
- `docs/technicalnew/ui-design.md` U8
- `docs/technicalnew/implementation-checks.md` I4
- `AGENTS.md`
- `docs/technicalnew/validation.md`
- `.agentdev/work/verification-profiles-20261104/{plan,implementation,review,test,settlement}.md`

## Verification

- `test/context.test.ts` 6 passed.
- Server and webapp `tsc --noEmit` passed.
- `git diff --check` passed.
- Independent Review: first round failed with 1 P1/2 P2/1 P3; all fixed. Second round passed with two residuals; both fixed. Final round passed with no blocking findings.
- No code or runtime test changes; no real-model profile run.

## Completion gate

passed — design/document Task closed by Plan, implementation, independent Review and settlement. Commit archives this report; pre-existing untracked user files remain untouched.
