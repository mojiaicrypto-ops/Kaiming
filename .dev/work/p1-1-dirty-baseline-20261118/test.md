# Independent Test — P1-1

Date: 2026-11-18 (four rounds)
Tester: separate agent contexts; every mutation was applied to the real files and restored byte-identically (sha256 verified).
Verdict: **pass** after the fixes below; residuals are recorded, not hidden.

## Final counts (developer-run after the last fix)

- `npm run typecheck` — clean.
- Focused (`store`, `deliverable`, `git-commit-gate`, `report`, `server-read`, `design-completion`) — 6 files / 127 tests.
- Full suite (broad profile) — 66 files / 661 tests passed.

## Falsification evidence (rounds 2–4, all shipped tests)

| Mutation | Failing assertion | Meaning |
|---|---|---|
| `plan-contract.scopeCheckFor` ignores the baseline | `outOfScope` contains the untouched inherited file (gate + `task.get` RPC) | scope filter is load-bearing |
| `withoutInherited` identity at all three report-tool branches | review delivery keeps the inherited file (`report` ×2); design branch fails its own test | snapshot filter is load-bearing in every branch |
| `completion-git` baseline filter dropped | positive gate test reports `not committed … src/unrelated.ts` | gate filter is load-bearing |
| `design-completion` recompute unfiltered | design test reports a false "changed after review" | both design digests use one rule |
| store's `changedInheritedPaths` gap deleted | "asks for a fresh review…" test loses the gap | post-review changes are caught |
| `isReviewableDeliveryPath` → `true` | settlement-output test gets an unsatisfiable re-review + commit gap on `.dev/backlog.md`/`AGENTS.md` | the domain restriction is load-bearing |
| `isReviewableDeliveryPath` codeBound→false / docs-only→false / design→true | the unit test and the docs-only/key design cases fail | all three domains pinned |
| `changedProjectPaths` prefix filter dropped | monorepo baseline gains `apps/api/sibling.ts` | subdirectory projects stay project-local |
| report-tool design branch without the filter | design review delivery keeps `.dev/product/account.md` | design branch covered end-to-end |
| `changedInheritedPaths` walk gate / knowledge exclusion removed | knowledge-entry gate test gets a permanent re-review gap | exclusions are load-bearing |

## Residual gaps (accepted, narrow)

- `delegation-tools.ts` envelope scope line and `task-tools.ts` `updateOp` baseline pass-through have no dedicated test; behaviour is pinned at the create/get tool path and the `task.get` RPC.
- `design-completion.test.ts` is symmetric by construction (it builds the review digest with the helper it tests); the non-symmetric claim is covered by the report-tool design test and the corresponding mutation.
- `isWalkedProjectFile`'s FIFO/symlink capture gate has no direct unit test (the `.dev` exclusion is covered); a FIFO in a project would be skipped by the same predicate the tests exercise for other shapes.
