# Independent Test — P0-1

Date: 2026-11-18
Tester: separate agent context (`P01Test`), ran the commands itself.
Verdict: **pass**, with the coverage gaps below recorded rather than hidden.

## Executed

| Step | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | exit 0, no diagnostics |
| Focused suite | `npx vitest run test/delegation.test.ts test/runtime.test.ts test/model-output-guard.test.ts` | 3 files / 99 tests passed |
| Falsification | remove the single `recoverMissingReport` call in `runner.ts`, run `-t 'asks once for a missing report'` | **failed** as intended: `expected 'failed' to be 'completed'`; without the call the prose-only answer falls straight into `REPORT_MISSING` |
| Restore | re-insert the exact line, re-run the same test | passes; `runner.ts` byte-identical (sha256 `8c98d1d7…`), no leftover files |

## Negative controls: do they fail for the intended reason?

- `asks once for a missing report…` — genuine, mutation-sensitive twice: removing the call kills it, and removing the reminder makes `display:false` (observed) fail.
- `marks a one-line answer without the dispatched report as failed` — the reminder is really injected (transcript frame) and the second prose answer really consumed; the third scripted reply is never taken (no loop).
- `gives a new member the host envelope…` — `instructions` compared with exact `toBe`, so the raw-column claim is proven; payload facts derive from the test's own inputs, not from the builder's output; `not.toContain('Upstream results:')` pins the phase gate.
- Server filter — both hidden custom types in one set; one consumer, first statement of `onEvent`; unit test loops over both types plus a non-hidden custom type.

## Gaps the tester recorded (and what was fixed in response)

| Gap | Status |
|---|---|
| Turn counting was unobservable (`length > 0`, and one custom message emits two frames) | fixed: the negative control now counts `kaiming.report-missing-recovery` in the persisted history and expects exactly 1 |
| The reminder's review/test verdict clause was unasserted | fixed: the negative control asserts `plus \`verdict\`` in the reminder text |
| Scope line unasserted, and the delivered text duplicated the `Scope:` prefix | fixed: prefix removed, test asserts the real `scopeCheckText` output and `not.toContain('Scope: Scope')` |
| Runtime tests build member payloads by hand, bypassing the envelope | accepted: envelope assembly is covered by the delegation tests; the runtime tests target the recovery turn |
| No test drives `main.ts`'s `onEvent` with a hidden message end-to-end | accepted gap (one-line filter + predicate unit test); recorded in the review |
| Short-circuits in `recoverMissingReport` (already has a result, stop requested, host abort, guard fault, non-normal stop, stale member) have no individual test | accepted: each guard mirrors an existing pre-change classification rule; a mutation of any one still leaves the input terminal, so the risk is a spurious reminder, not a wrong outcome |
