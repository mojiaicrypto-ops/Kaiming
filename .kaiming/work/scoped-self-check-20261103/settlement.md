# Settlement — scoped developer self-check

Task: scoped-self-check-20261103
Date: 2026-11-03
Status: completed

## Stable facts

- Developer self-check is scoped to the changed behavior. Backend changes run focused unit/integration around the changed function/interface/contract; page behavior changes keep their TDD unit test, then run one focused real-browser path.
- The full suite and full E2E are not default developer gates before Review.
- Broad/cross-module runs are reserved for shared contracts, data migrations, permissions/state machines, common layers or known high-risk changes, with the reason recorded.
- Independent Test still runs after Review with risk-based acceptance and related regression, including indirect callers.
- Reports must show what was run and what was not; focused self-check does not replace independent acceptance.

## Updated

- `docs/productnew/modules/delivery.md` D-05
- `docs/productnew/acceptance.md` AC-47
- `AGENTS.md`
- `docs/technicalnew/prompts/developer.md`
- `docs/technicalnew/prompts/tester.md`
- `docs/technicalnew/prompts/chief.md`
- `docs/technicalnew/implementation-checks.md` I4
- `docs/technicalnew/validation.md`
- `.agentdev/work/scoped-self-check-20261103/{plan,implementation,review,test,settlement}.md`

## Review

Independent read-only review `MoralPanda` initially failed with two P2 findings (page TDD omitted; related regression narrowed) and two P3 consistency findings; all fixed and re-reviewed passed. Details: `review.md`.

## Verification

- `test/context.test.ts` 6 passed.
- `npm run typecheck` passed.
- `git diff --check` passed.
- No business code changed.
- Real-model time/coverage comparison and AC-47 remain unexecuted, recorded in validation.

## Completion gate

passed — Plan, implementation, independent review, prompt/type checks, authoritative docs and settlement are current. Final commit archives this report; only pre-existing user files remain untracked.
