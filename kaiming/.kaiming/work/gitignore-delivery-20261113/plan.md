# Review delivery uses a bounded .gitignore lookup

## Problem

Review/Test bind to a project snapshot. The snapshot asks Git for the repository-wide ignored file
list and silently returns an empty set when that command fails or times out. A large generated
tree can therefore enter the reviewed delivery, and settlement cleanup of those ignored files later
changes the digest. Completion then asks for another Review/Test even though the deliverable code
did not change.

The contract already says untracked ignored files are not delivery. This fixes the observation
mechanism; it does not add artifact path lists or a project-specific policy.

## Decision

Keep `.gitignore` as the default classification and keep tracked files as delivery candidates.
Replace the repository-wide ignored listing with batched `git check-ignore -z --stdin` over the
observed paths:

- no Git repository: no ignore rules, the existing no-Git behaviour;
- a repository Git cannot read: fail the observation instead of returning an empty set;
- a check-ignore failure: fail closed, with the Git detail;
- tracked paths matching a pattern remain visible, because Git does not ignore tracked files;
- ignored untracked paths never enter the reviewed path list, so deleting them after Review cannot
  invalidate Review or Test.

## Scope

- `src/runtime/git-delivery.ts`: bounded ignore observation and its callers.
- `src/runtime/deliverable.ts`: propagate an observation failure.
- `src/tools/completion-git.ts`: report the failure as a completion gap.
- `src/tools/report-tools.ts`: refuse to record Review/Test when the delivery cannot be observed.
- Tests in `test/deliverable.test.ts`, `test/report.test.ts`, and existing commit-gate coverage.
- Technical validation and the delivery contract's implementation notes.

## Verification profile

`broad`: this changes the shared Review/Test completion binding and the commit gate. Run the
affected focused tests first, then the full backend suite and webapp suite/typecheck. No browser
interaction change.

## Acceptance

- An untracked ignored build file is absent from Review/Test delivery paths.
- Removing an ignored artifact after Review does not change the reviewed digest.
- A tracked file that matches an ignore pattern remains in the delivery, as Git still tracks it.
- An `.gitignore` policy edit after Review does not invalidate code evidence when code paths exist.
- If Git cannot report ignore status, Review/Test is not recorded and completion reports the gap;
  no silent "nothing ignored" result.
- No language- or directory-specific allowlist is introduced.
- Existing source changes/deletions still invalidate the reviewed delivery and still require
  Review/Test.
- Full backend and webapp tests, both typechecks and the webapp build pass.
