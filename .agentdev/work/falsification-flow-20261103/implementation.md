# Implementation Summary — falsification flow

Task: falsification-flow-20261103

## Changed

| Path | Purpose |
|---|---|
| `docs/productnew/modules/delivery.md` | D-05 adds negative controls, checker self-test, oracle provenance and relationship assertions |
| `docs/productnew/acceptance.md` | AC-46 covers hard-coded expectations, known-bad samples and the required expected rejection |
| `docs/technicalnew/agents-and-tools.md` | Defines the negative-control report record and Review/Test evidence rule |
| `docs/technicalnew/implementation-checks.md` | Registers the I4 model scenario for positive-only suites and checker self-tests |
| `docs/technicalnew/prompts/tester.md` | Tester must execute a negative control and checker self-test; cannot edit expectations to match output |
| `docs/technicalnew/prompts/reviewer.md` | Reviewer checks oracle provenance and negative-control evidence for standard code work |
| `docs/technicalnew/prompts/chief.md` | Chief requires falsification evidence when organizing Review/Test |
| `docs/INDEX.md` | Current quality gate is discoverable from the documentation index |
| `docs/technicalnew/validation.md` | Records the process change, evidence and uncovered real-model E2E |
| `AGENTS.md` | Project-level quality/settlement rules; confirms code delivery scope and preservation of unrelated changes |

## Behavior

The documented flow now requires a check to be falsifiable: a known-bad input, wrong expectation, mutation, or checker self-test must really fail for the intended reason. Expected values must come from acceptance, independent facts or invariants; varying data uses relationships rather than one sample's literals. Review treats output-derived or positive-only tests as blocking for standard code work.

Settlement is scoped correctly: code/material product changes settle and commit reviewed delivery paths; read-only Tasks close per D-04; unrelated dirty files are preserved and do not block completion.

## Plan deviations

No product-stage or Program-level natural-language gate was added. The program cannot judge oracle quality, so the rule is carried by the product contract, role prompts, acceptance, and Review/Test reports.

## Verification

- `npx vitest run test/context.test.ts` — 6 passed.
- `npm run typecheck` — passed.
- Independent documentation review — passed after one re-review.
- No business code changed.

## Risks remaining

Real-model end-to-end proof that a checker passing a known-bad sample is blocked by Tester/Reviewer remains unexecuted; recorded in `validation.md` and I4.
