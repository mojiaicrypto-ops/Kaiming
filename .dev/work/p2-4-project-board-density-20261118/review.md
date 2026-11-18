# Independent Review — P2-4

Date: 2026-11-18
Reviewer: separate agent context, read-only. Two rounds (needs_fix → pass).

## Final verdict

**pass** — no remaining P0–P2 findings.

## Round 1 findings

| Sev | Finding | Resolution |
|---|---|---|
| P2 | The new chain/meta styles set `opacity: 0.55` on planned steps: 2.46:1 dark, 2.11:1 light, below U7's 4.5:1 (pre-patch 6.47:1). | Planned steps use `color: var(--fg-3)` with no opacity: 5.22:1 dark, 4.62:1 light; done (`--fg-2`) stays quieter than current (`--accent` + 600). |
| P2 | `boardOf` admitted a spec-ref-less produced slice into Ready, contradicting BL-04/U6 ("Ready requires a spec reference"; the design-unsettled slice is only badged). | Reverted to `item.ready`; the slice stays in Ideas but keeps the “waiting for design” badge and the producing design Task's chain. Test locks Ideas + badge + design chain. |
| P3 | The card's “waiting for you” flag still keyed on `openTasks[0]`, so a produced slice whose design Task asks a question showed no marker. | `pendingFor(activeWork(item)?.taskId)` — a claim still wins, a producing design Task is covered. |
| P3 | U6 still promised ticks and dashed future steps, and described “direct work right after the strip”, ignoring the add-input row. | U6 states the real order (strip → add input → direct work → board), the arrow-text chain with regular/current-bold/faint states, and the transient spec-ref-less case. |
| P3 | Undefined tokens (`--muted/--border/--warning`) made the new meta/divider hierarchy invisible. | Replaced with `--fg-3/--line/--run`; lane/card borders now render and radius is 0 per U3. |

## Verified good

- `activeWork`: claim first, then an open producing design Task; a settled producer is ignored (guard test, mutation-sensitive).
- Split destinations only on the claimed source (`splitInto` server change); produced slices return through `producerTasks`.
- Breakpoints: 4 columns at 1440/1320, 2 at ≤1100, horizontal scroll at ≤640; no page-level horizontal overflow at 390.
- Card content matches U6; split ids only in the drawer; direct work reachable above the board.
- Test quality: the new cases fail for the intended reason under the corresponding mutation; no fixture-only tautology found.

## Accepted, out of scope

- A slice with both an open design producer and an open implement claim lands in Implementing with an implement chain and the “waiting for design” badge; the server never enforces `awaitingDesign`, so a typed “实施 B-n” can reach it (pre-existing).
