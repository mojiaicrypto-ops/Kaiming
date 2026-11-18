# Independent Test — P2-4

Date: 2026-11-18 (two rounds; tester is a separate context, mutations restored byte-identically)

## Final verdict

**pass**

## Counts (final tree)

- `npx vitest run --root webapp test/project-model.test.ts` — 15/15.
- `npm --prefix webapp test` — 20 files / 140 tests.
- `npm run test:browser -- --grep "project"` — 16/16.
- `npx vitest run test/backlog-rpc.test.ts` — 8/8.
- `tsc --noEmit` (server and webapp) clean.

## Known-bad controls

| Mutation | Observed failure | Restored |
|---|---|---|
| `activeWork` → `openTasks[0]` only | new chain test: `expected [ 'plan','develop','review','test','settle' ] to deeply equal [ 'design','review','gate','settle' ]` | sha256 `a08590d3…` |
| drop `OPEN_TASK` from the producer arm | guard test: `expected { taskId: 't-d', … } to be undefined` | same hash |
| `splitInto` loop over `related` instead of `claimed` | backlog-rpc: `expected [ 'B-1', 'B-8' ] to deeply equal []` | `b672ce8f…` |
| `boardOf` drops `awaitingDesign` from the badge chain case | B-9 test: `expected [] to deeply equal [ 'B-9' ]` (before the review-driven revert; the current test asserts the contract-compliant Ideas placement) | same hash |

## Live checks (4173, rebuilt assets)

- Strip: `0 Ideas / 0 Designing / 11 Ready / 0 Implementing / 0 Completed / 0 waiting for you`.
- Cards: `Plan → Develop → Review → Test → Settle`, current Plan; design Task `t-2dbe518eeb45` is completed, so no design chain and no badge — correct for a settled producer.
- Tokens: stat divider `1px solid rgb(35,38,45)`, meta `rgb(133,139,150)`, card/lane borders render, radius 0.
- Contrast: planned `rgb(133,139,150)` on card background → 5.22:1 dark, 4.63:1 light (≥ 4.5).
- 390px: document width equals viewport; board scrolls horizontally.
- Drawer still opens with body/specs/lineage; the card no longer repeats the sibling id list. The old 4173 process still serves the pre-fix `splitInto` (server restart pending); the new integration test proves the new rule.

## Residual

- The transient `waiting for design` state is no longer reproducible live because the design settled; covered at model level.
- A slice with both an open design producer and an open implement claim still shows the implement chain plus the badge (server does not enforce `awaitingDesign`; pre-existing).
