# Independent Test — A（主管恢复 bash + HEAD/工作区审计）

Role: independent tester. Worked on a `/tmp` copy for mutations; the repository itself was not
modified. Verdict at the tested hash: **PASS**, with a final-tree confirmation requested because the
owner continued hardening the audit after the measurement window.

## Commands and results (tested hash `057e69f…`)

| Command | Result |
|---|---|
| focused: `shell-audit` + `tool-sets` + `deletion-gate` + `deletion-gate-runtime` | 4 files, **41/41** |
| `runtime.test.ts -t "audits a chief bash"` | 1 passed (60 skipped) |
| `runtime.test.ts -t "asks the chief before a shell commit"` | 1 passed (60 skipped) |
| `npm --prefix kaiming run typecheck` | pass |
| `npm --prefix kaiming run check:prompts` | **15/15** |
| `npm --prefix kaiming test` | 69 files, **715/715** |

## Known-bad mutation battery (independent, on the copy)

- Compare only HEAD (ignore status/diff/untracked) → **5** shell-audit failures.
- Disable `diffHash` comparison → the “second edit to an already-dirty file” test fails
  (`shell-audit.test.ts:70`).
- Remove the audit extension from the chief → the real runtime audit case fails on `isError`.
- Set `guardHistory: false` → “the chief history gate never asked” (the run times out/fails).
- Remove `bash` from the chief tool set → **4** tool-set failures.
- Disable the commit gate rule → the chief `git commit` decision test fails.

## Negative controls

- A clean `git status` bash call does not warn.
- Writing an ignored file does not warn.
- A non-git directory does not break the shell and does not warn.
- A tracked edit warns without blocking or rolling back the command.
- A developer `git commit` runs with zero prompts and no audit.
- A commit result reports `HEAD: a -> b`.

## Caveat and final confirmation

The suite measured 715/715 at hash `057e69f…`. The owner then added the one-sided status/HEAD fix
and the substitution lookahead fix; the final tree is 717 tests. The tester's post-run re-check of
the affected module was 10/10 at that time; a final full-suite run on the frozen tree was requested
and its result is recorded below.

**Final confirmation (current tree, hash `f2f4e487…` unchanged before/after the run):** PASS.
Focused `shell-audit` + `tool-sets` + `deletion-gate` + `deletion-gate-runtime` 4 files **43/43**
(12 + 15 + 11 + 5); typecheck pass; full suite 69 files **717/717**; `check:prompts` **15/15**.

## Timing/flakiness risks

- The chief gate runtime test polls interactions every 10 ms with a ~6 s failure path and a possible
  hidden 30 s timeout if `interactions.resolve` throws; it is the same pattern as the existing
  `deletion-gate-runtime` tests.
- The audit samples two fingerprints around a command; parallel member/background writes can be
  attributed to the chief. The text is non-attributing and the limits are documented; this is not
  solved by the audit.
