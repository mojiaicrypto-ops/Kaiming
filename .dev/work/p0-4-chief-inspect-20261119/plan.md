# P0-4 Plan — chief has no write path; review binds the whole delivery

Date: 2026-11-19. Basis: user decision in this conversation (2026-11-19), AGENTS.md, and the current
role/tool contract (`docs/technicalnew/agents-and-tools.md`). Product behaviour: D-01–D-05, D-09,
G1/G3.

## Goal

1. Remove the chief's only write-capable tool (`bash`) and give it a host-owned, read-only git
   inspector (`inspect`), so "I did not create a Task and wrote the files myself" is impossible
   rather than merely forbidden by prompt text.
2. Close the adjacent completion hole: a file created after the last passed review (by tester,
   settler, or anyone) is currently outside `reviewed.paths` and is never required to be reviewed.
   `task(op=end)` must refuse while the current delivery snapshot contains reviewable paths the
   passed review did not cover.
3. State in `chief.md` that "just do it / don't ask me" authorizes an uninterrupted
   create → develop → review → test → settle → end run, never skipping the Task or independent
   verification.

Non-goals: no cross-turn git ledger, no per-bash blacklist, no retroactive adoption of existing
dirty files, no change to `editRaw`/backlog semantics (already settled in P2-6).

## Design decisions

- **Chief tool set**: `read/grep/find/ls + inspect + task/backlog/project/question/web/browser`.
  No `bash`, no `write`/`edit`. `inspect` is a `DomainTool` registered only for the chief; it is in
  the native allowlist so a paused/read hold keeps it (it cannot write).
- **Inspect is argv, not a shell**: `execFile('git', argv)` with a fixed subcommand/flag table
  (`status`, `log`, `diff`, `show`, `rev-parse`), no shell, `GIT_OPTIONAL_LOCKS=0`,
  `core.fsmonitor=false`, `--no-ext-diff --no-textconv`, `GIT_TERMINAL_PROMPT=0`. Model input is
  limited to a bounded `limit`, a validated `rev` and a project-relative `path`; no raw args.
- **Settlement commit** is the settler's job (it keeps bash). `chief.md` says so; `task(op=end)`
  already observes the reviewed paths' commit state.
- **Completion check**: one canonical helper in `deliverable.ts`
  (`newReviewableDeliveryPaths`), called from `store.completionBlockers` where the transactional
  `endTask` recheck also sees it. `completion-git.ts` stays commit-state only; both are composed by
  `endOp`/`guidance`, so the gate is not weaker and the reminder is not printed twice.

## Steps

1. `src/tools/inspect-tool.ts` + unit/integration tests (temp git repo; bad rev/path negative
   controls; assert no write flags and unchanged status/HEAD).
2. `tool-sets.ts`: remove `bash` from chief, add `inspect`; runner registers it for the chief only;
   update runtime/tool-set tests (paused hole now probed with `backlog`/`project`).
3. `deliverable.ts` helper + `store.completionBlockers` gap; tests: new code file after review
   refuses, settlement docs after a code review do not, ignored file does not, design artifact after
   review refuses, inherited-untouched still passes.
4. Prompts: `chief.md` (facts-first uses inspect; commit via settler; direct/no-interruption rule),
   `agents-and-tools.md` G1/G4/completion wording, `validation.md`.
5. Verification: typecheck, focused suites, full suite (broad profile: shared permission contract
   and completion gate), `check:prompts`, prompt-language check.

## Verification profile

**broad** — shared role/tool contract and the completion gate; a regression here affects every
role. Full suite allowed with this reason. Independent Review and independent Test still run; the
Test must include known-bad mutations.

## Acceptance

- Chief's active tools contain `inspect` and never `bash`, in normal and paused turns.
- `inspect` cannot be given write/exec flags; a rejected rev/path fails for that reason.
- After a passed review, creating any reviewable file outside `reviewed.paths` makes
  `completionBlockers` report it and `task(op=end)` refuse; deleting the file clears the gap.
- For a code delivery, settlement docs created after review do not create a gap; for a design
  delivery, a new `.dev/product|technical` file does.
- No storage migration, no backlog op change.
