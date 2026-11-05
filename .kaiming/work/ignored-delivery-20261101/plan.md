# Plan — ignored files are not delivery

## Decision

User decision (2026-11-01): files excluded by Git ignore rules never enter the review/test delivery path. The delivery is what Git can commit: tracked files plus untracked files that are not ignored. A file that must be delivered must be unignored or explicitly tracked; do not add build-directory whitelists and do not delete the workspace to make `end` pass.

## Problem

`snapshotDelivery` walks every project file except `.git`, `node_modules` and `.dev`. Review records that full path list; test reuses it. `end` then runs `git check-ignore` over those paths, so build outputs (`.next`, `public/fonts`, `.visual/**`, `*.tsbuildinfo`) and the user's own excluded files (`dexprep涨跌.docx` via `.git/info/exclude`) become "ignored files in the delivery" and block completion. The check is downstream of the real contradiction: the snapshot already admitted files no commit can carry.

## Change

1. Add `ignoredProjectPaths(cwd, paths)` in `runtime/git-delivery.ts`: one `git ls-files --others --ignored --exclude-standard -z` call, intersect with the observed paths. `--others` keeps tracked files committable even when an ignore pattern matches; a missing repository or git returns an empty set.
2. In `runtime/deliverable.ts`, `snapshotDelivery` drops those paths before computing the digest. Review and test therefore bind only the committable delivery.
3. In `tools/completion-git.ts`, filter the stored review paths through the same helper before `observeCommit`, so a review recorded before this change does not keep flagging ignored build/user files. A delivery consisting only of ignored paths has no Git gap; uncommitted non-ignored paths still produce the existing gap.
4. Keep `observeCommit`'s ignored-path observation as a safety net for a path that becomes ignored after review; do not add hardcoded build directories.

## Out of scope

- Do not delete dependencies, build outputs, fonts, `.visual` or user files.
- Do not change the review/test digest comparison or the untracked/uncommitted source check.
- Do not add a delivery manifest or model-supplied path list.
- Do not change nested-repository semantics.

## Acceptance

- In a Git project, ignored untracked files (`.next`, `public/fonts`, `.visual`, `*.tsbuildinfo`, `.git/info/exclude` entries) are absent from `snapshotDelivery().paths` and from the end gap.
- A tracked file that matches an ignore pattern remains in the delivery.
- An untracked, non-ignored source file still blocks `end` with the existing uncommitted gap.
- A legacy review whose stored paths include ignored files produces no ignored-file gap; if it also contains uncommitted source, that source is still reported.
- Full server and webapp suites pass; `tsc --noEmit` passes.

## Verification

- New `test/deliverable.test.ts` case with a real temporary Git repository, `.gitignore`, `.git/info/exclude`, an ignored build file, an ignored user file and a tracked ignored file.
- New `test/git-commit-gate.test.ts` case for `deliveryCommitGaps` with a legacy review listing ignored and uncommitted paths.
- Existing git gate and end tests remain green.
- Docs: G3 delivery binding, validation record and gap-register entry if a defect is recorded.
