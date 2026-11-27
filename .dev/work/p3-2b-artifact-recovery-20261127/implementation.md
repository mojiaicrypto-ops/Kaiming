# Implementation - P3-2b

- ArtifactRef/Target carry `relativePath`; Plan/Report writes record it and parsing preserves it.
- `readArtifact` resolves recorded path, main checkout, then retained branch via `git show`.
- Task tool/get/report, read-methods and delegation use the resolver; task plan scope uses resolved Task cwd.
- Merged `task end` removes Worktree and branch; branch_kept is retained.
- Startup removes interrupted provisioning Worktrees and marks their Tasks cancelled.

## Evidence

- `test/worktree.test.ts` 10/10 (merged cleanup + artifact fallback).
- Full suite 75 files / 785 tests.
- `npm run typecheck` passed.
