# Settlement — Next-Round Roadmap (P0/P1/P2) and Documentation Consolidation

Date: 2026-11-18
Plan: [plan.md](plan.md) · Review: [review.md](review.md)

## What settled where

| Fact | Authoritative location |
|---|---|
| Detailed, directly executable next-round roadmap specs (P0-1, P0-2, P0-3, P1-1, P2-1, P2-2 with exact file/line references, function signatures, schema v19→v20 migration, verification profiles, and negative controls), active risks (R1–R7), deferred items (M1–M5, N), and compacted historical closed gaps | `docs/technicalnew/gap-register.md` |
| Consolidated verification baseline & milestone evidence (2026-10-04 to 2026-11-14) with preserved anchors | `docs/technicalnew/validation.md` (reduced from 936 lines / 160KB to 93 lines / ~12KB) |
| Updated entry navigation, current baseline summary, and P0/P1/P2 roadmap entry | `docs/INDEX.md` |
| Removed stale "unimplemented / NOT_RUN / missing list methods / unstored session title" statements | `docs/technicalnew/README.md`, `docs/technicalnew/architecture.md` (A7), `docs/technicalnew/runtime-contract.md` (header + R1 `session.create`/`session.rename`), `docs/technicalnew/implementation-checks.md` (header) |

## Verification executed

- Formal documentation task (no verification profile / no code Test stage per D-04):
  - `npm --prefix kaiming run check:prompts`: **15/15 passed**
  - Markdown link & anchor integrity check across 34 files (`AGENTS.md` + `docs/**`): **249/249 links resolved, 0 broken**
  - Independent read-only Review (`084a5236-d68e-4bca-a8e6-371cf2ae9bff`): **passed** (0 blocking findings; 1 non-blocking R1 `session.create` table wording touch-up applied)
