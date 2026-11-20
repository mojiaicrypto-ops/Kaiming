# Independent Review — A（主管恢复 bash + HEAD/工作区审计）

Role: reviewer, read-only. Reviewed the plan, source, tests, prompt and docs; did not read the
development chat. Round 1 verdict: **NEEDS_FIX** (5 findings).

## Round 1 findings and disposition

1. **P2 — Chinese README still said the chief has no shell** (`README.md:39,74`).
   The earlier patch changed only the security bullets; the role/failure-mode rows still claimed
   “无写文件与任意 Shell 写权限”. English had been updated. Fixed: both rows now say the chief has
   an audited observation/operations shell, no write/edit, and tracked changes go through a Task.
2. **P2 — A failed `git status` silently removed the audit** (`shell-audit.ts:118-122`).
   `readWorktreeFingerprint` returned `null` on status failure, and both halves skipped with no
   signal; the documented `limited` fallback existed only for `diff`. Fixed: status failure returns
   a fingerprint with `statusAvailable:false` + `limited:true`; the result appends a non-error
   “status could not be read” note unless a real HEAD/content change also makes it an audit error.
   Test: `shell-audit.test.ts` “reports an unreadable status…” (chmod 000 on `.git/index`; skipped
   as root because root bypasses the permission).
3. **P2 — Audit text attributed the change to the command and advised a revert** (`shell-audit.ts:213-226`).
   Concurrent member writes and background jobs are documented blind spots. Fixed: the first line is
   “The project state changed while this command ran.”; the close says to check whether the command
   caused it (a member/background job may have written it) before reverting.
4. **P3 — No runtime negative control for the chief-only gate wiring** (`runtime.test.ts:1102-1113`).
   Mutating `guardHistory` to `true` for every role would have passed the suite. Fixed:
   `deletion-gate-runtime.test.ts` adds “does not ask a developer before a commit: the history rules
   are chief-only”, asserting no pending interaction and a completed run.
5. **P3 — Stale “chief has no shell” test comments** (`inspect-tool.test.ts:2`,
   `deletion-gate-runtime.test.ts:48`). Fixed: the inspector is described as the fixed-argv read-only
   path alongside the observation shell; the gate harness now says it exercises the shared deletion
   rules while the chief-only rules/audit live in `runtime.test.ts`.

## Re-review

Round 2: **NEEDS_FIX** — the five round-1 items were confirmed fixed; two new findings:

1. **P2 — one-sided status failure fabricated a change**: `statusChanged` was gated on
   `statusAvailable`, but `diffChanged`/`untrackedChanged` compared the partial observation's
   sentinel hashes against a real one, and a failed HEAD read could print `abc -> (none)`. Fixed:
   `headAvailable` on the fingerprint; `statusComparable`/`headComparable` gate all four comparisons.
   Added tests for one-sided status failure (untracked and dirty-tracked) and for an unknown HEAD.
2. **P3 — history flags inside command substitution**: `--hard`, `--force/-f` and `checkout .`
   used `(?=\s|$)` on the raw segment, so `echo $(git reset --hard)`, `echo $(git push -f)` and
   `echo $(git checkout .)` stayed quiet. Fixed: the lookaheads accept `)`, backtick or end; tests
   added for `$()` and backticks.

Round 3: **PASS** — both remaining items verified in the current tree, no new findings. Repro of the
one-sided case (dirty tracked + untracked, index unreadable between reads) returns
`{changed:false, statusUnavailable:true}`; a one-sided HEAD miss returns `{changed:false}`. The
substitution forms (`$(git reset --hard)`, backticks, `$(git push -f)`, `$(git checkout .)`) ask;
the negative controls (`checkout main`, `reset --soft`, plain `push`) stay quiet.
Non-blocking nuance: a repository with no commits yet has `headAvailable:false` on the before side,
so the first commit has no `HEAD:` line; it still warns through `statusChanged` and names the paths.

## What the reviewer checked and found sound

- Tool set: chief `read/grep/find/ls/bash/inspect`; no `write/edit`; read Task and paused hold still
  strip `bash` for every role; investigator unchanged; `denied` no longer hides `bash` from chief.
- Wiring: audit installed only for chief, `guardHistory` only for chief; gate registered before the
  audit, so the before-fingerprint is taken after approval; `Trust all` bypasses only the gate.
- Fingerprint: porcelain `-z` paths are repo-root-relative and `--show-prefix` stripping is correct
  (including a subdirectory project); `diff HEAD --binary` catches a second edit to an already-dirty
  file and staged state; HEAD catches commits; ignored files and non-git stay quiet.
- Gate: `-c/-C` options, wrappers and command substitutions handled; `commit-tree`, `merge-base`,
  `checkout main`, `reset --soft` and a plain `push` stay quiet; quoted/remote bypasses documented.
- `tool_result` composition preserves `details` and now `structuredContent`; `isError` does not
  disturb `ModelOutputGuard` or the bash timeout guard.
