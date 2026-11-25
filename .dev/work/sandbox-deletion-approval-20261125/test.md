# Test evidence

- `npm --prefix kaiming test -- test/deletion-gate.test.ts`: 19/19.
- `npm --prefix kaiming test -- test/deletion-gate.test.ts test/deletion-gate-runtime.test.ts`: 24/24.
- `npm --prefix kaiming test`: 73 files / 758 tests passed.
- `npm --prefix kaiming run typecheck`: passed.
- `npm --prefix kaiming run check:prompts`: 15/15 passed.
- `git diff --check`: passed.

## Real-data check

- `q-4e8a5390` on `s-73e06eea` / `t-b601964eb02a` was pending during the investigation; its command is a heredoc that writes a B-42 test script and contains `rmSync` only in the script body. The user then answered `Trust all commands in this session` in the old process, so it is resolved. The same shape is covered by the heredoc unit tests.

## Not run / boundary

- The old workbench (PID 20482) was stopped and killed. A new process (PID 60850) was started briefly to confirm it could listen on 127.0.0.1:4173, then stopped at the user's request; no kaiming server is currently running. No live tester replay was performed; the old B-42 pending interaction had already been answered manually.
- No independent Review/Test was run for this direct user-requested change.
- The text gate is not a complete shell parser; complex/nested heredocs remain a boundary. Untracked-file protection is deliberately out of scope.
