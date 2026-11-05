# Fork a chief session — pending implementation

Status: **pending implementation; no code changed**. Recorded 2026-11-01 at the user's request.

## User request

From the current chief conversation, create a new conversation that keeps the AI context up to the fork point. The two conversations then advance independently.

## Pi capability

Pi provides the mechanism:

- `AgentSession.fork(entryId)` replaces the **current runtime** with a forked session. Not suitable: the source conversation must remain live.
- `SessionManager.forkFrom(sourcePath, targetCwd, sessionDir)` copies the **whole file**, including abandoned branches.
- `SessionManager.open(sourcePath, sessionDir, cwd).createBranchedSession(leafId)` copies only the **current branch** into a new JSONL whose header records `parentSession`. This is the recommended primitive.

## Proposed AgentDev shape

1. New write RPC `session.fork` with `projectId` and source `sessionId`.
2. Source requirements:
   - chief role, same project;
   - no processing / queued / stopping / interrupted inputs (stable history);
   - an existing `session_bindings.piFile` and a non-empty conversation;
   - if the source is busy or has no persisted history, refuse with a concrete reason.
3. Create the forked Pi file from the source's current leaf; create a new AgentDev session row and `session_bindings` row pointing at that file. Source history and source binding are untouched.
4. The fork has no `currentTaskId`, queued inputs, interactions or authorization. An unfinished source Task remains owned by the source session; the fork only carries the conversation context.
5. UI: a fork action on the current session row in the session rail; on success refresh the rail and select the new session. On refusal, show the server reason.
6. Default title: source title plus `(fork)`; the user can rename it.

## Open decisions

- Whether to allow forking while the source session has an unfinished Task (proposed: yes, but the fork owns no Task).
- Whether the rail action belongs on every row or only the current row (proposed: current row only).
- Whether to expose parent-session lineage in the session list or only in the Pi file header (proposed: header only for the first version).

## Acceptance when implemented

- Fork from a settled chief session with history: new session opens with the same visible messages; sending a new message in either session does not alter the other.
- Fork from a busy session or a session without history is refused with a readable reason.
- Source `session_bindings`, history, Task ownership and queued inputs are unchanged.
- The new session survives restart and reload; its first input continues from the copied context.
- Tests: real temp Pi JSONL fork, store binding, RPC refusal/success, UI action and selection.

## Not in scope

- No new branch tree UI.
- No copying Task ownership or work authorization.
- No `SessionManager.forkFrom` full-file copy.
