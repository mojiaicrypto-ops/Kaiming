# Implementation notes — P1-1

Date: 2026-11-18
Plan: [plan.md](plan.md)

## Changes

| File | Change |
|---|---|
| `kaiming/src/runtime/deliverable.ts` | `DirtyBaseline` (path → content hash), `captureDirtyBaseline(cwd)` from `changedProjectPaths`, and `isUnchangedBaselineDirty(cwd, path, baseline)` (true only while the bytes still match; `missing`/`unreadable` are real values). |
| `kaiming/src/store/store.ts` | `SCHEMA_VERSION 19 → 20`; `dirtyBaseline TEXT` in the fresh `tasks` table; `migrateV19ToV20`; `TaskRow.dirtyBaseline`; `CreateTaskParams.dirtyBaseline?`; insert writes the JSON (empty → NULL); `parseDirtyBaseline` maps malformed/empty values to `null`. |
| `kaiming/src/tools/task-tools.ts` | `createOp` captures the baseline for write Tasks (read Tasks stay `null`); create/update/get scope checks pass `task.dirtyBaseline`; `getOp` computes one `scopeCheck` instead of two. |
| `kaiming/src/runtime/plan-contract.ts` | `scopeCheckFor(cwd, planMarkdown, baseline?)` drops unchanged-baseline paths unless the Plan's 范围 declares them. |
| `kaiming/src/server/read-methods.ts` | `task.get` RPC passes the baseline. |
| `kaiming/src/tools/delegation-tools.ts` | Dispatch envelope scope line passes the baseline. |
| `kaiming/src/tools/report-tools.ts` | `observeDelivery` filters inherited paths from the snapshot (design, test-reuse and default paths) before review scoping. |
| `kaiming/src/tools/completion-git.ts` | `deliveryCommitGaps` filters inherited paths, including for review rows recorded before the column existed. |
| `kaiming/test/store.test.ts` | v19→v20 migration: column added, old rows keep NULL behaviour, the new value round-trips. |
| `kaiming/test/deliverable.test.ts` | Capture records only dirty paths; a byte change releases the file; `missing` is a value; no Git → empty baseline. |
| `kaiming/test/git-commit-gate.test.ts` | End-to-end: create with an inherited dirty file → scope excludes it, `end` passes after committing only the Task's file, the inherited bytes survive; negative control: editing the inherited file puts it in scope and the gate refuses while uncommitted. |
| `kaiming/test/design-completion.test.ts` | Fixture gains `dirtyBaseline: null`. |
| `docs/technicalnew/agents-and-tools.md` G3 | New paragraph: what the baseline is and the three places it applies. |
| `docs/technicalnew/storage-and-recovery.md` S2 | `dirtyBaseline` in the `tasks` row and the v19→v20 migration note. |

## Verification (executed)

- `npm run typecheck` — clean.
- `npx vitest run test/store.test.ts test/deliverable.test.ts test/git-commit-gate.test.ts` — 45 + 26 passed.
- Full suite (broad profile, schema migration + delivery contract): `npm test` — 66 files / 649 tests passed.

## Design notes

- Identity is content, not path: a pre-existing dirty file joins the Task as soon as its bytes change, permanently for this Task.
- An explicit Plan `范围` beats the baseline (the chief declared the file).
- No baseline value means no filtering, so read Tasks, old Tasks and non-Git projects keep the previous behaviour.
- `dirtyBaseline` is captured before `createTask`, so the Task's own row creation and plan write are not part of its own baseline.

## Post-review fixes (2026-11-18)

Review verdict was needs_fix; each finding closed:

- **Design completion recheck**: `design-completion.ts` filters the design snapshot with the shared `withoutInherited`, so the review digest and the completion recompute always cover the same paths (previously a design Task created over a dirty spec was blocked forever).
- **Post-review change escaped**: `changedInheritedPaths(cwd, baseline, covered)` in `deliverable.ts`; `store.completionBlockers` adds a "review the current delivery again" gap naming those paths, and `completion-git.ts` includes them in the commit check.
- **Mutation sensitivity**: the positive gate test's review row now lists the inherited file (the gate filter must drop it); `report.test.ts` covers the review branch and the older-review-row test-reuse branch over a real repo; `design-completion.test.ts`, `server-read.test.ts` and `store.test.ts` gained their cases.
- **Monorepo siblings**: `changedProjectPaths` returns only paths inside the project directory (prefix filter), so a dirty sibling can no longer be hashed as a fake `missing` file.
- **Inert override removed**: `scopeCheckFor` no longer carries the declared-scope branch (`scopeDrift` already excluded declared paths), and the G3 paragraph now states the actual rule (uniform filter; a post-review change forces a new review; design path filtered identically).

Verification after fixes: typecheck clean; focused 121 tests; full suite 66 files / 654 tests passed.

## Second review round (2026-11-18)

Re-review closed all five first-round findings and found one new defect plus two coverage gaps:

- **A (P1, fixed)**: `changedInheritedPaths` demanded a re-review for inherited `docs/**`, root Markdown, `.gitignore` and `.dev/**` changes a review can never bind (settlement closing a backlog item would deadlock a design Task). The check now takes the review binding (`design`, `codeBound`) and `isReviewableDeliveryPath` restricts it to code files, or design artifacts for a design Task; `isCodeDeliveryPath` is shared with `scopeReviewDelivery` so the two rules cannot drift. Test: inherited `.dev/backlog.md` + `AGENTS.md` changed after review → no re-review gap.
- **B (P3, fixed)**: the design branch of `observeDelivery` had no end-to-end test; `report.test.ts` now records a design review over an inherited `.dev/product` artifact and asserts it is excluded.
- **C (P3, fixed)**: `changedProjectPaths`'s project-prefix filter is pinned by a monorepo test (project at `apps/web`, dirty sibling `apps/api/sibling.ts` never enters the baseline).

Docs: the G3 paragraph now names the domain (reviewable paths only) and states that settlement output never triggers a re-review.

## Third review round (2026-11-18)

- **R1 walk domain**: `isWalkedProjectFile` gates baseline capture (missing paths still recorded) and the post-review check, so git-reported symlinks, FIFOs and `node_modules`/`.git`/`.dev` paths can neither block creation nor demand an unsatisfiable review.
- **R2 + design domain**: `captureDirtyBaseline(cwd, { design })` captures `.dev/product/**`/`.dev/technical/**` for design Tasks (the design binding is now reachable); `isReviewableDeliveryPath` unit-pinned for codeBound, docs-only and design.
- **Knowledge entries (P2)**: `DeliveryBinding.excluded` closes the permanent-block case — a settlement rewrite of `AGENTS.md` (or any `project.initialize` knowledge entry) in a docs-only delivery no longer demands a review that cannot cover it; wired from `knowledgeEntryPaths` in the store and the commit gate, pinned end-to-end.

Verification after this round: typecheck clean; focused 127 tests; full suite 66 files / 661 tests.
