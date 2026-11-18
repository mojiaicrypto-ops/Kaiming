# Independent Review — P0-2

Date: 2026-11-18
Reviewer: separate agent context (`P02Review`), read-only.
Plan: [plan.md](plan.md) · Implementation: [implementation.md](implementation.md)

## Verdict

**pass** — no blocking findings.

## Findings and resolutions

| Severity | Finding | Location | Resolution |
|---|---|---|---|
| major | The schema change (`required: ['summary']`) had no negative control: tests call the tool directly, bypassing Pi's schema validation, so reverting the schema would stay green in tests while production rejected the body-less call. | `report-tools.ts:68`, `test/report.test.ts` | fixed: new end-to-end runtime test runs a settler through a real Pi session whose `agent_report` call has no `body`; a reverted schema fails it at the schema gate |
| major | Other injected prompts still demanded the body: `prompts/settler.md` flow block, `prompts/specialists.md` (injected into every specialist), and the S6 settlement sequence in `storage-and-recovery.md`. A settler following them re-pastes Markdown that the tool then discards. | `settler.md:19`, `specialists.md:21`, `storage-and-recovery.md:148` | fixed in all three |
| minor | The `REPORT_RETRY_EXHAUSTED` corrective turn still said "both summary and body are required strings", steering a settler back into the incident mechanism. | `runner.ts:290` | fixed: one `reportFields(sessionId)` clause now feeds both hidden turns |
| note | `bodySource` on the already-recorded branch describes the retrying call (a post-param retry can report `disk`). | `report-tools.ts` | accepted cosmetic |
| note | No git commit/digest verification of the settlement file inside the report tool | — | explicit non-goal (delivery gate checks commits; the tool stores facts) |

## Claim checks

1. Schema/description/implementation agree; no other kind's requirement changed (`settlement` on a read Task is unreachable by store rules).
2. `resultId`, `bodyRef`, the write and the read-back all use one `effectiveBody`; `settlementPath` is byte-identical to `reportTarget`'s path, so the recorded digest is the on-disk digest.
3. The disk file is never rewritten on retry: with a non-empty file the write guard is false, and a differing parameter body cannot win.
4. The reminder points at the file and a second prose-only answer still ends `failed`.
5. Mutation-sensitive: `body ?? diskBody` fails the sha/file assertions; keeping `VERSION_CONFLICT` fails the second-call assertion; the schema revert now fails the new runtime test.
6. Docs/prompt match the contract; the prompt-cache restart requirement is carried into the settlement report.

## Not covered

- TOCTOU between the disk read and the write guard (pre-existing pattern, negligible window).
- A settlement written but never committed is still accepted (the tool cannot verify Git; recorded as a non-goal and visible in the delivery gate).
