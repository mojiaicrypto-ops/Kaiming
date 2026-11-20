# Implementation — A（主管恢复 bash + HEAD/工作区审计）

## Changed

- `kaiming/src/runtime/tool-sets.ts`: `NATIVE_BY_ROLE.chief` now carries
  `read/grep/find/ls/bash/inspect`; `write/edit` stay absent. The read-Task/paused filter still
  removes `bash` for every role, so a read or paused chief remains read-only. Investigator unchanged.
- `kaiming/src/runtime/shell-audit.ts` (new): `readWorktreeFingerprint` observes
  `rev-parse --show-prefix`, `rev-parse --verify HEAD`,
  `status --porcelain=v1 -z --untracked-files=all --no-renames -- .`,
  `diff --binary HEAD -- .` and untracked `lstat` size/mtime. `compareWorktreeFingerprints` reports
  HEAD/status/dirty-content/untracked changes. `createShellAudit` takes the before fingerprint on
  `tool_call` (after the deletion gate answered), compares on `tool_result`, appends a
  `[chief shell audit]` text block and sets `isError: true`. It does not restore or block.
  Git calls are bounded (5s, 16MB); a failed diff or too many untracked files marks the observation
  `limited` while HEAD/status are still compared. A `status` failure returns
  `statusAvailable:false` + `limited:true` and appends a non-error “status could not be read” note
  instead of silently skipping; a non-git directory returns `null`. Diff is skipped when there are
  no tracked changes.
- `kaiming/src/runtime/deletion-gate.ts`: `deletionCommandReason(command, { guardHistory })` adds
  chief-only commit / merge/rebase/cherry-pick / force-push / reset-hard / checkout--|./restore
  rules; the default table is byte-for-byte the old behavior for other roles. The gate prompt now
  says “Approve this shell command?” because the rules are no longer only deletions.
- `kaiming/src/runtime/runner.ts`: installs `createShellAudit` only for the chief and passes
  `guardHistory: roleId === 'chief'`. All other guards (file boundary, deletion gate, bash timeout)
  keep their order.
- `docs/technicalnew/prompts/chief.md`: shell is for observation/operations; tracked changes and
  the settlement commit go through a Task/member; the host audit is a stop signal, not a rollback or
  sandbox; `task(op=end)` wording no longer says “you have no shell”.
- `docs/technicalnew/agents-and-tools.md`: G1 row, shell paragraph, gate paragraph, the new
  “主管的 shell 与审计（A）” section and the role map.
- `docs/install.md`, `docs/install.en.md`, `README.md`, `README.en.md`: security notes now say the
  chief has an observation shell, the audit is visibility not prevention, and all roles' bash runs
  with the OS user's permissions.

## Tests added/updated

- `kaiming/test/shell-audit.test.ts` (new): tracked edit; second edit to an already-dirty file;
  untracked add/change; commit as HEAD change; ignored file quiet; subdirectory project; non-git
  null; extension warning + `isError`; clean call and non-git untouched.
- `kaiming/test/tool-sets.test.ts`: chief normal/write turn has `bash`+`inspect`, no write/edit;
  read Task and paused hold have no bash; denied set no longer contains bash.
- `kaiming/test/deletion-gate.test.ts`: default table unchanged for commit/history/worktree
  commands; chief `guardHistory` asks for them; read-only git commands and quoted/remote forms stay
  quiet.
- `kaiming/test/runtime.test.ts`: running chief has bash, paused does not; recorded requested tools
  contain bash; real Pi run appends the audit finding to a tracked-file edit and leaves a read-only
  `git status` clean; a chief `git commit` asks and honors `Reject`.

## Verification

- Focused: `test/shell-audit.test.ts` 12/12; `test/tool-sets.test.ts` 15/15;
  `test/deletion-gate.test.ts` 11/11; `test/deletion-gate-runtime.test.ts` 5/5 (includes the
  developer commit negative control); runtime cases (`audits a chief bash`,
  `asks the chief before a shell commit`) pass individually.
- `npm --prefix kaiming run typecheck`: pass.
- `npm --prefix kaiming run check:prompts`: 15/15.
- Full suite: 69 files / 717 tests pass.
- Independent Review: round 1 and 2 NEEDS_FIX, round 3 PASS (`review.md`).
- Independent Test: PASS on the frozen tree, 43/43 focused and 717/717 full (`test.md`).

## Operational notes

- Prompt bodies are cached per process (`promptDir`); `chief.md` takes effect only after a workbench
  restart. A settlement that depends on the new prompt text must say so.
- The audit is git-only and local-only. It cannot attribute concurrent member writes, `nohup`
  background work, remote `ssh` changes, or `.git` internals; untracked files are compared by
  size/mtime, not content. A grouped/serialized tool batch or a very large dirty tree can produce a
  limited or attributable warning. These are documented, not hidden.
- `Trust all commands in this session` bypasses the gate; the audit still runs. The audit is not a
  sandbox and does not roll back.
