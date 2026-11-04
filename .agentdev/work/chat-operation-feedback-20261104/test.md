# Test Report — chat operation feedback and queue content

Task: chat-operation-feedback-20261104

| Check | Command | Result | Evidence |
|---|---|---|---|
| Webapp suite | `cd devagent/webapp && npm test` | passed | 14 files, 98 tests |
| Webapp typecheck | `npm run typecheck` | passed | exit 0 |
| Server typecheck | `cd devagent && npx tsc --noEmit` | passed | exit 0 |
| Server full suite | `npx vitest run --maxWorkers=1` | passed | 49 files, 505 tests |
| Queue-focused server | `npx vitest run test/server-write.test.ts test/server-stream.test.ts` | passed | 31 tests |
| Build | `npm run build` | passed | Vite production build |
| Browser feedback | `npx playwright test browser/feedback.spec.ts browser/feedback-task.spec.ts` | passed | 5 tests |

## Browser cases

1. A second message during a slow run appears immediately with its text, no input id, and survives reload.
2. STOP shows `Stopping…` and is disabled while the stop RPC is held.
3. Withdrawing a queued row removes it immediately.
4. After the first turn ends and the queued message starts, STOP targets that executing input and ends the run.
5. A Task pause click shows the pending state/disabled control before the Task read reflects `paused`.

## Not covered

- Real long Task member run / real model pause timing; the Task pending test uses a routed Task read and a held control response.
- Manual compaction's real timing; only its busy/aria behavior is code-covered.
