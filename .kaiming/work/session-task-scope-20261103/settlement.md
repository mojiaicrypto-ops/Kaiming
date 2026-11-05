# Settlement — session Task scope

Task: session-task-scope-20261103
Date: 2026-11-03
Status: completed

## Stable facts

- Task strip/list/drawers belong to the current chief session. A session switch hides the previous Task before paint; old polling and old `refreshTask`/`session.get` responses cannot repaint it.
- A task announcement that arrives while an older `session.get` is in flight wins; the snapshot response cannot erase it.
- Composer draft and uploaded images are not Task state and survive a chief-session switch.
- The UI contract now states this ownership rule.

## Updated

- `devagent/webapp/src/state/useSession.ts`
- `devagent/webapp/src/state/task-scope.ts` (new)
- `devagent/webapp/src/chat/ChatPage.tsx`
- `devagent/webapp/test/task-scope.test.ts` (new)
- `docs/technicalnew/ui-design.md` (session switch row)
- `docs/technicalnew/validation.md`
- `docs/technicalnew/gap-register.md` (C23)
- `.agentdev/work/session-task-scope-20261103/{plan,implementation,review,test,settlement}.md`

`devagent/webapp/src/app/App.tsx` was changed during the fix and then restored to keep Composer mounted; it has no net diff.

## Review

Independent read-only review `VisitingNarwhal`: initial result incorrect with two non-blocking findings (page remount lost draft; null snapshot read could overwrite a newer Task push), both fixed and re-reviewed; final passed. Details: `review.md`.

## Verification

- `task-scope.test.ts` 2 passed.
- webapp 13 files / 92 tests passed.
- `npx tsc --noEmit`, `npm run build` passed.
- Real browser on 4173: Task visible on s-7f07; after switching to s-67ab `activeTaskId=null`, `taskDetail=null`, no `task-live`; switch back restores. Draft `draft-keep` survives.
- Not covered: restart-time browser regression; the change is frontend-only.

## Completion gate

passed — Plan, implementation, independent review, tests, UI contract/gap/validation, and settlement are current. Final commit archives this report; only pre-existing untracked user files remain.
