# Review — session Task scope

Task: session-task-scope-20261103
Independent reviewer: `VisitingNarwhal` (separate read-only context)
Scope: frontend session/Task state fix; no backend changes

## Initial result: incorrect (goal met; two non-blocking findings)

1. `key={workspace.sessionId}` remounted ChatPage and silently discarded Composer's unsent text/attachments. **Fixed** by removing the key and resetting only session-owned task/member UI with a layout effect; Composer remains mounted.
2. The new `session.get` null branch could clear a Task announcement that arrived after the read was issued but before its response. **Fixed** with a monotonic `taskPushSeq`: the response is discarded when a newer Task push arrived.

## Re-review result: passed

Reviewer verified both fixes and the core behavior: render-time `taskForSession` guard, effect reset, generation/session guards for old frames and reads, poll gating, and Task reload on the owning session. No remaining findings.

## Note

Reviewer observed a pre-existing, out-of-scope risk: `loadEarlier` and `refreshPending` still write their slot updates without a session check. Not changed in this Task.
