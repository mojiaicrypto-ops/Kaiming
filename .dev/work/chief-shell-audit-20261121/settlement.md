# Settlement — A（主管恢复观察 shell + HEAD/工作区审计）

## Decision and scope

User decision 2026-11-21: option **A**. Restore the chief's `bash` for observation/operations
(ssh, curl, docker, ports, logs, environment checks, git-ignored local env files), keep no
`write/edit`, add a post-call HEAD/worktree audit and chief-only commit/history/worktree gate rules.
The OS sandbox (option B) is explicitly deferred. The investigator stays read-only: the aisuangua
incident was a read Task, and `toolSetFor` strips bash from every read Task, so adding bash to the
investigator's role map would not have fixed it.

## Delivered

- `kaiming/src/runtime/tool-sets.ts`: chief `read/grep/find/ls/bash/inspect`; read Task and paused
  hold still strip bash; investigator unchanged.
- `kaiming/src/runtime/shell-audit.ts`: HEAD/status/dirty-diff/untracked fingerprint; before/after
  comparison; `chief shell audit` warning with `isError`; status blind spot reported as a non-error
  note instead of a silent skip; bounded git calls; non-git returns null; no rollback.
- `kaiming/src/runtime/deletion-gate.ts`: chief-only `guardHistory` rules for commit,
  merge/rebase/cherry-pick, force-push, reset-hard, checkout--/., restore; default table unchanged
  for other roles.
- `kaiming/src/runtime/runner.ts`: audit installed only for the chief; `guardHistory` only for the
  chief.
- Prompt/docs: `chief.md` v12, G1/G4 role map and shell/audit section, P0-4 superseded note,
  validation entry, install/README security boundaries.

## Verification

- `shell-audit` 12/12; `tool-sets` 15/15; `deletion-gate` 11/11; `deletion-gate-runtime` 5/5
  (developer commit negative control); real Pi runtime cases for the audit and the chief gate.
- Full suite 69 files / 717 tests pass; `tsc`; `check:prompts` 15/15.
- Independent Review: round 1 NEEDS_FIX (5 findings), round 3 PASS after the one-sided status/HEAD
  and substitution-lookahead fixes; details in `review.md`.
- Independent Test: PASS on the frozen tree (43/43 focused, 717/717 full, 6 mutation groups and
  negative controls); details in `test.md`.

## Residual risks (documented, not hidden)

- The audit is **not a sandbox** and does not prevent or roll back a change. It reports local,
  git-visible state after the command already ran.
- Concurrent member writes, `nohup` background jobs, remote `ssh` changes, `.git` internals and
  ignored files are not attributed; untracked files use size/mtime, not content; very large dirty
  trees can be `limited`.
- A status read failure appends a blind-spot note but cannot compare that call; a diff cap can
  hide a second edit to an already-dirty file. HEAD/status remain the fallback where available.
- `git commit` text gating is a speed bump; `ssh host 'git commit'`, `sh -c`, aliases and similar
  spellings bypass it. The local HEAD audit still reports a local commit.
- Prompt bodies are cached per process; `chief.md` v12 takes effect only after a workbench restart.
  A session started before the restart continues with v11 and the old “no shell” text.
- The audit warns on a grouped/parallel bash batch or a concurrent member write; the text says the
  state changed while the command ran and asks the chief to check attribution before reverting.

## Follow-up

- Option B (macOS `sandbox-exec` / Linux `bwrap`): project read-only, writable scratch, network
  allowed. Then the investigator can share the same sandboxed shell if needed. This is a separate
  work package, not part of A.
