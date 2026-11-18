# Independent Review — P1-1

Date: 2026-11-18 (three rounds)
Reviewer: separate agent contexts, read-only; verdict and findings below are the reviewer's.
Plan: [plan.md](plan.md) · Implementation: [implementation.md](implementation.md)

## Final verdict

**pass** — no blocking findings. Round 1 was `needs_fix`; every blocking/major finding is closed and re-verified.

## Round 1 findings (all closed)

| Sev | Finding | Resolution |
|---|---|---|
| P1 | Design completion recomputed the design snapshot unfiltered while the review recorded a filtered digest → a design Task created over a dirty spec could never complete. | `design-completion.ts` uses the shared `withoutInherited`; pinned by `design-completion.test.ts`. |
| P2 | A change to an inherited file *after* the review was neither in the review's digest nor in the commit gate → silently accepted. | `changedInheritedPaths` + a completion gap ("review the current delivery again") + the commit check; pinned by the gate test. |
| P2 | The gate filter and the snapshot filter had no mutation-sensitive tests. | Positive gate test's review row now lists the inherited path; report tests cover the review, test-reuse and design branches over a real repo. |
| P3 | The migration test had no pre-migration Task row. | `store.test.ts` creates and cancels a real row, then asserts it survives with a null baseline. |
| P3 | Monorepo sibling paths were hashed as fake `missing` files. | `changedProjectPaths` keeps only project-relative paths; pinned by a monorepo test. |

## Round 2 finding (closed)

| Sev | Finding | Resolution |
|---|---|---|
| P1 | The post-review check demanded a review for inherited `docs/**`, root Markdown, `.gitignore` or `.dev/**` changes a review can never bind — closing a backlog item in settlement would deadlock a design Task. | `changedInheritedPaths` now takes the review binding (`design`, `codeBound`); `isReviewableDeliveryPath` restricts it to code paths, documents (docs-only delivery) or design artifacts; `isCodeDeliveryPath` is shared with `scopeReviewDelivery`. Test: inherited `.dev/backlog.md` + `AGENTS.md` rewritten after review → no re-review/commit gap. |

## Round 3 residuals (closed)

| Sev | Finding | Resolution |
|---|---|---|
| P3 | Unreachable path shapes (tracked symlink, `node_modules` file, FIFO) could still produce a permanent gap or block creation. | `isWalkedProjectFile` gates baseline capture (missing paths still recorded) and the post-review check. |
| P3 | The `codeBound === false` (docs-only) branch and the design branch of the binding were untested. | `deliverable.test.ts` unit-pins all three domains; the gate test adds a docs-only scenario (inherited `notes.md` changed after a review over `README.md` → re-review gap naming it). |

## Notes accepted

- `delegation-tools.ts`'s envelope scope line and `task-tools.ts`'s `updateOp` baseline pass-through have no dedicated test: single-argument pass-throughs whose behaviour is pinned at the `task.get` RPC and the create/get tool paths; recorded as a narrow gap.
- `design-completion.test.ts` builds its review digest with the same helper it tests (symmetric); the non-symmetric claim is covered by the report-tool design test.
- A settlement file written but never committed is not verified by the tool (delivery gate owns commits); unchanged by this package.

## Round 4 (knowledge entries and normalization)

| Sev | Finding | Resolution |
|---|---|---|
| P2 | In a docs-only delivery, an inherited knowledge entry (`AGENTS.md` or any `project.initialize` file) that settlement rewrites could never be covered by a review → permanent completion block. | `DeliveryBinding.excluded` (project-relative knowledge entries) is consulted first in `isReviewableDeliveryPath`; both consumers build it from `knowledgeEntryPaths`. End-to-end gate test with an initialized project. |
| P3 | `excluded` was compared against canonical git keys while stored knowledge paths kept the caller's spelling (`./AGENTS.md`), so the exclusion could miss. | `knowledgeEntryPaths` normalizes to project-relative POSIX without a leading `./`, shared by the snapshot exclusion and the binding. |
| note | The design binding was unreachable (`.dev` excluded from capture). | `captureDirtyBaseline(cwd, { design })` records `.dev/product/**` and `.dev/technical/**` for design Tasks; the design recheck observes them directly. |

Final verdict: **pass** — no blocking findings, three residuals accepted (envelope/`updateOp` pass-through untested; symmetric design-completion test; FIFO capture gate untested).
