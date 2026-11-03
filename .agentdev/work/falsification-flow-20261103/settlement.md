# Settlement — falsification flow

Task: falsification-flow-20261103
Date: 2026-11-03
Status: completed

## Stable facts

- Standard code Review/Test requires falsification: a known-bad input, wrong expectation, mutation, or checker self-test must actually fail for the intended reason. An all-green suite without a negative control is incomplete.
- Expected values must come from acceptance, independent facts or invariants, not from implementation output, one fixture or the author's assumption. Varying data uses relationships (inclusion/range/uniqueness/references), not one sample's literal values.
- A negative control is reported `passed` only when the command ran, the bad sample was rejected for the expected reason, and `reason` records the bad sample, expected reason, observed rejection and oracle source; `evidenceRefs` records the acceptance/invariant reference. Unexpected failure remains `failed`.
- Review checks oracle provenance and negative-control evidence for standard code work. At Review it uses developer Red→Green/test source; the independent Test's executed control belongs to the Test step. Lightweight/document work is not given a test duty it does not have.
- `AGENTS.md` now carries the project-level quality and settlement gate. Settlement is scoped to code/material product-design change; read-only Tasks close per D-04; reviewed delivery paths must be committed relative to HEAD; unrelated dirty files are preserved and do not block. Settlement not committed = not happened.
- The confirmed code-delivery scope (c18a395) is also reflected in `AGENTS.md`: for a code delivery, Review/Test bind code paths; `docs/**` and root Markdown are settlement output; docs-only deliveries keep their docs.

## Updated

- `AGENTS.md`
- `docs/INDEX.md`
- `docs/productnew/modules/delivery.md` (D-05)
- `docs/productnew/acceptance.md` (AC-46)
- `docs/technicalnew/agents-and-tools.md`
- `docs/technicalnew/implementation-checks.md` (I4)
- `docs/technicalnew/prompts/tester.md`
- `docs/technicalnew/prompts/reviewer.md`
- `docs/technicalnew/prompts/chief.md`
- `docs/technicalnew/validation.md`
- `.agentdev/work/falsification-flow-20261103/{plan,implementation,review,test,settlement}.md`

## Indexes checked

- `docs/INDEX.md` — quality gate added to current state.
- `AGENTS.md` — project-level quality/settlement parameter updated after user direction.
- I4 prompt/real-model check list — new falsification scenario registered.

## No change

- No business/runtime code changed.
- No historical reports or accepted results were rewritten.
- No new product stage, state, protocol or program-level natural-language gate was added.

## Review

Independent read-only review `SurprisedChimpanzee` first returned **failed** with two blocking findings (AC-46 wrong-reason false pass; AGENTS settlement contradiction) and three non-blocking contract gaps. All five were fixed and re-reviewed; final result **passed** (confidence 0.85). Details: `review.md`.

## Verification

- `npx vitest run test/context.test.ts` — 6 passed.
- `npm run typecheck` — passed.
- `git diff --check` — passed.
- No real-model E2E; the positive-only/bad-sample/self-test scenario is registered in I4 and recorded as unexecuted in `validation.md`.

## Completion gate

passed — Plan, implementation, independent review, applicable prompt/type tests, product/technical docs, index and settlement are current. Final commit archives this report; the working tree will contain only pre-existing user files.
