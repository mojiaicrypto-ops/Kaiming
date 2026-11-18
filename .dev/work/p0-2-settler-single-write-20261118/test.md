# Independent Test — P0-2

Date: 2026-11-18
Tester: separate agent context (`P02Test`).
Verdict: **pass**.

## Executed

| Step | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run check:prompts` | 15/15 |
| `npx vitest run test/report.test.ts test/runtime.test.ts test/deliverable.test.ts test/git-commit-gate.test.ts` | 4 files / 106 tests passed (before the review-response additions; 107 after) |
| Mutation (a) `const effectiveBody = body;` | settlement test fails at `isError` (body omitted → `INVALID_ARGUMENT`) |
| Mutation (a2) `body ?? diskBody` | settlement test fails at the recorded sha: the parameter body replaces the committed bytes, and the write guard overwrites the file — proving the old conflict guard was load-bearing |
| Mutation (b) disk read forced undefined | settlement test fails with the fallback reason text |
| Mutation (c) reminder branch removed | the settler reminder test fails on the history assertion |
| Restore | every file byte-identical (`sha256sum -c`), no temp files, nothing committed |

## Negative controls (independent probe)

- Write-Task settler, no file, no body → `INVALID_ARGUMENT`, reason names the fallback, zero results and zero rows (the only write call sits after validation).
- Non-settlement kind without body → `INVALID_ARGUMENT`, zero results.
- Disk-present settlement: file `sha256`, inode, mtime and size identical before and after both a body-less call and a differing-body call — no rewrite at all.
- `bodySource: 'disk'` asserted, `bodyRef.sha256` equals the file digest, `reportRef.path` is the committed path.

## Gaps recorded and responses

| Gap | Response |
|---|---|
| Schema change unguarded by tests | fixed: end-to-end runtime test through Pi's schema validation |
| `bodySource: 'param'` never asserted; missing-file + supplied body path uncovered | fixed: empty-file case now writes the parameter body and asserts `param` |
| Refusal reason text unasserted | fixed: the negative control asserts the fallback sentence |
| Reminder test asserted wording only, no errorCode / turn count / absence of the generic demand | fixed: asserts `failed` + `REPORT_MISSING`, exactly one reminder in history, and no ``` `summary` and `body` ``` demand |
| `settler.md` flow block / `specialists.md` / S6 sequence still demanded the body | fixed in all three (review finding) |
| `REPORT_RETRY_EXHAUSTED` corrective turn still demanded body | fixed via a shared `reportFields` clause |
| Settlement present-but-empty | covered by the new empty-file case |
| Retry of an identical settlement, read-Task settlement | accepted: unreachable/deduplicated by store rules; the identical-retry path is the generic `REQUEST_CONFLICT` branch covered elsewhere |
| A settlement file written but never committed is accepted | accepted non-goal; the delivery gate is the commit check |
