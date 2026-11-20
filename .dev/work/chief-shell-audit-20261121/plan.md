# A — 主管恢复 bash + HEAD/工作区审计（broad）

Date: 2026-11-21. Basis: user decision in this conversation (2026-11-21, option A; the OS sandbox is
deferred), the aisuangua incident report, AGENTS.md, and the current role/tool contract
(`docs/technicalnew/agents-and-tools.md`). Product behaviour: D-01–D-06, G1/G3.

## Goal

Restore the chief's ability to observe and operate the real environment through `bash` (ssh, curl,
docker, ports, logs, environment checks, git-ignored local env files), without restoring the P0-4
bypass where the chief writes tracked project files and finishes without a Task.

The boundary is deliberately stated as a policy + audit, not a sandbox:

- the chief keeps no `write`/`edit`;
- after every chief `bash` call the host compares the project's `HEAD`, porcelain status and dirty
  content; a change is appended to the tool result as an audit finding (`isError`), naming the paths;
- the chief-only deletion gate also asks before commit/history/worktree-discard commands;
- read Tasks and a paused Task still withhold `bash` from every role;
- the investigator stays read-only (no bash, no change to its tool set).

## Non-goals

- No OS sandbox in this work package (macOS `sandbox-exec` / Linux `bwrap` is the later option B).
- No automatic rollback or file restore; the audit must not clobber concurrent developer/tester work.
- No full-worktree digest before/after each call; only git HEAD, status and dirty-content data.
- No hard `git commit` prevention by argv parsing; the gate is a user prompt, and the audit reports
  HEAD movement. A determined shell can still bypass both.
- No remote-side audit: `ssh host '...'` changes are outside the local project fingerprint.
- No bash for the investigator, and no change to the read-Task `bash` rule.
- No non-git audit; a project without a readable repository has no fingerprint and no warning.

## Design decisions

- **Tool set**: `NATIVE_BY_ROLE.chief = read/grep/find/ls/bash/inspect`; no `write`/`edit`. The
  existing read-Task and paused-hold filters still remove `bash`, so a paused/read chief is read-only.
- **Fingerprint** (`src/runtime/shell-audit.ts`):
  - `git -C <cwd> rev-parse --verify HEAD`;
  - `git -C <cwd> status --porcelain=v1 -z --untracked-files=all --no-renames -- .` (hash + first
    paths for the message);
  - `git -C <cwd> diff --no-ext-diff --no-textconv --no-renames --binary HEAD -- .` (sha256), so a
    second edit to an already-dirty file is still detected;
  - untracked paths from `??` records plus `lstat` size/mtime (bounded); no content hash of the
    whole project.
  - Every git call is bounded (timeout + maxBuffer); a failure marks the fingerprint `limited` and
    the audit falls back to HEAD/status instead of breaking the bash result. A non-git directory
    returns `null` and the audit is skipped.
- **Extension** (`createShellAudit`): installed only for the chief. It records the before
  fingerprint on `tool_call` for `bash`, compares on `tool_result`, appends a text block and sets
  `isError: true` when HEAD, status, dirty diff or untracked stamps changed. The command already ran;
  the text says so and says this is an audit, not a rollback.
- **Chief-only gate**: `deletionCommandReason(command, { guardHistory: true })` adds commit, merge,
  rebase, cherry-pick, push --force, reset --hard, checkout --/., restore. The global deletion rules
  stay unchanged for every role; `Trust all commands in this session` still bypasses the gate (the
  audit still runs).
- **Prompt/docs**: `chief.md` says shell is for observation/ops, tracked project changes and the
  settlement commit go through a Task/member, and the host audit is not a sandbox. G1/G4, the role
  map, the validation record and the install/README security notes are updated.
- **No investigator change**: the aisuangua failure was a read Task, and `toolSetFor` strips bash
  from every read Task for every role; adding bash to the investigator's role map would only affect
  write Tasks and would not have fixed that incident.

## Steps

1. `tool-sets.ts` + tests: chief gets `bash`; read/paused still deny it; no `write`/`edit`; other
   roles' matrices unchanged.
2. `shell-audit.ts` + `shell-audit.test.ts`: fingerprint/comparison unit tests (clean, tracked edit,
   already-dirty second edit, untracked add/change, commit, ignored file, non-git, size/time limit)
   and extension wiring tests (warning text, `isError`, clean call unchanged).
3. `deletion-gate.ts` + tests: `guardHistory` option and chief-only rules; default rule table
   unchanged.
4. `runner.ts`: install `createShellAudit` for the chief; pass `guardHistory` to the gate for the
   chief only.
5. Prompt/docs: `chief.md:21,88`; `agents-and-tools.md:9,17,20,23,190`; `validation.md` (P0-4
   superseded note + new evidence entry); `install.md`/`install.en.md` and both READMEs' security
   note.
6. Verification: focused tests (tool sets, audit, gate), typecheck, full suite; independent Review
   and independent Test per the broad profile.

## Verification profile

**broad** — shared role/tool permission contract and the delivery path. Full suite allowed with this
reason. Independent Review and independent Test still run; the Test must include a known-bad input
(a chief bash that edits a tracked file) and a negative control (a read-only command, an ignored file,
and a non-git directory).

## Acceptance

- A normal chief turn has `bash` and `inspect`, and never `write`/`edit`; a read Task or a paused
  hold has neither bash nor write/edit.
- A chief `bash` that edits a clean tracked file appends an audit finding naming the path and sets
  `isError`; a second edit to an already-dirty file is also detected.
- A chief `bash` that commits moves HEAD; the result reports the HEAD change.
- A chief `bash` that only reads, or writes an ignored file, does not warn; a project without git
  does not break the shell and does not warn.
- `git commit` / `reset --hard` / `checkout --` / `restore` / `push --force` ask in a chief session;
  the same command in a developer session is unchanged unless a global rule matches.
- Full suite, typecheck and `check:prompts` pass; the Test has a known-bad failure and a negative
  control; the settlement record states the audit is not a boundary and the sandbox remains future
  work.
