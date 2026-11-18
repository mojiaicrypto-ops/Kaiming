# Plan — P1-1 Task-level dirty baseline (dirty-worktree isolation)

Date: 2026-11-18
Roadmap item: `docs/technicalnew/gap-register.md` §P1-1
Verification profile: **broad** (Store schema v19→v20, G3 delivery binding, completion gate; reason recorded)

## Problem

A file that was already dirty when the Task was created (the user's own uncommitted work) is treated as this Task's work everywhere: it lands in `scopeCheck.outOfScope`, in the review/test delivery snapshot, and in the completion commit gate — so `task(op=end)` refuses to close a Task that never touched it. That contradicts "unrelated dirty files are preserved and do not block completion".

## Rule

A file counts as the Task's own change only if it was not dirty at creation, **or** its content changed during the Task. The identity of a pre-existing dirty file is its bytes at Task creation (`sha256`, or `missing`/`unreadable` markers). Once the Task (or anything else) changes those bytes, the file joins this Task's scope and delivery — permanently for this Task.

## Scope

- `kaiming/src/runtime/deliverable.ts`: `DirtyBaseline` type, `captureDirtyBaseline(cwd)` (git-dirty paths → content hashes), `isUnchangedBaselineDirty(cwd, path, baseline)`.
- `kaiming/src/store/store.ts`: `SCHEMA_VERSION 19 → 20`; `ALTER TABLE tasks ADD COLUMN dirtyBaseline TEXT` with a `migrateV19ToV20`, the same column in the fresh `CREATE TABLE tasks`; `TaskRow.dirtyBaseline: DirtyBaseline | null`; `CreateTaskParams.dirtyBaseline?`; insert + `toTaskRow` mapping.
- `kaiming/src/tools/task-tools.ts`: `createOp` captures the baseline for a write Task before `createTask`.
- `kaiming/src/runtime/plan-contract.ts`: `scopeCheckFor(cwd, planMarkdown, baseline?)` drops unchanged-baseline paths from the changed set **unless the Plan's 范围 declares them** (explicit scope wins).
- Callers: `task-tools.ts` (create/update/get/plan reads), `server/read-methods.ts` `task.get`, `delegation-tools.ts` `envelopeFacts` — all pass `task.dirtyBaseline`.
- `kaiming/src/tools/report-tools.ts` `observeDelivery`: exclude unchanged-baseline paths from the snapshot (and from a reuse of an older review's path list) before review scoping.
- `kaiming/src/tools/completion-git.ts` `deliveryCommitGaps`: exclude unchanged-baseline paths even when the review row predates the baseline.
- Docs: `docs/technicalnew/agents-and-tools.md` G3; `docs/technicalnew/storage-and-recovery.md` S2 (`tasks` v20).
- Tests: `test/store.test.ts` (v19→v20 keeps rows, round-trips the baseline), `test/deliverable.test.ts` (capture + unchanged/changed/absent), `test/git-commit-gate.test.ts` (end-to-end positive/negative).

## Non-goals

- No new state or UI; no change to `.gitignore` classification or `docs/**` settlement exclusions.
- No attempt to distinguish a human edit from a Task edit of the same file: a byte change is a change.
- Read Tasks get no baseline (they cannot deliver project changes).

## Acceptance

- Positive: a file modified before the Task is created, then a Task changing another file and declaring only that file in 范围 → `scopeCheck.outOfScope` is empty; after the Task's own file is committed, `task(op=end)` succeeds and the unrelated file keeps its uncommitted bytes.
- Negative control: if the Task (or the developer) also changes the pre-existing dirty file, it appears in `outOfScope`, and `end` refuses while it is uncommitted (`COMPLETION_INCOMPLETE`).
- A file that was untracked and untouched (hash equal) is excluded; a deleted-at-creation path is stored as `missing` and becomes in-scope when it reappears with content.
- Migration: v19 database opens at v20, keeps every Task row, and a NULL baseline means "no filtering" (old behaviour).
- The full suite passes (broad profile).

## Verification

- `npm run typecheck`; `npx vitest run test/store.test.ts test/deliverable.test.ts test/git-commit-gate.test.ts test/report.test.ts test/runtime.test.ts`; full `npm test` (broad reason: schema migration + delivery contract).
- Independent Review/Test before settlement.
