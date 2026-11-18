# Plan — P2-2 Fork a chief session

Date: 2026-11-18
Roadmap item: `docs/technicalnew/gap-register.md` §P2-2 (original F1; draft `.kaiming/work/fork-chief-session-20261101/plan.md`)
Verification profile: **focused**

## User request

From the current chief conversation, create a new conversation that keeps the AI context up to the fork point; both conversations then advance independently. The source keeps its Task ownership and queue; the fork owns nothing.

## Pi primitive (verified in the SDK)

`SessionManager.open(sourcePath, sessionDir, cwd)` + `getLeafId()` + `createBranchedSession(leafId): string | undefined` copies only the current branch into a new JSONL whose header records the parent session. The source file is not touched. Full-file copy and runtime `AgentSession.fork` are rejected (abandoned branches, source must stay live).

## Scope

- `kaiming/src/runtime/pi-runtime.ts`: `PiRuntimeFactory.branchSessionFile({ sourcePiFile, cwd, branchEntryId? })` → `{ piFile, leafEntryId }`; session directory is the runtime's own `agentDir/sessions`.
- `kaiming/src/store/store.ts`: `CreateSessionParams.title?` (inserted into `sessions.title`); `createForkedChiefSession({ id, projectId, cwd, title, piFile, branchEntryId, configHash, rulesHash? })` inserting the session + binding in one transaction.
- `kaiming/src/server/write-methods.ts`: `session.fork` (params `projectId`, `sessionId`, `title?`):
  - source exists, belongs to the project, `roleId === 'chief'`; otherwise `NOT_FOUND`/`INVALID_ARGUMENT`;
  - any `queued`/`processing`/`stopping`/`interrupted` input → `WORKSPACE_BUSY` with the blocking input ids;
  - `session_bindings.hasHistory === true` and the file exists → else `INVALID_ARGUMENT: cannot fork an empty session`;
  - an unfinished source Task does **not** refuse the fork; the new session has `currentTaskId = null`, `channel = null`, no inputs, no interactions;
  - default title `${source title} (fork)` (stored title, else derived first-line, 60-char cap);
  - file created first, rows second; a failed insert removes the new file so no orphan is left; success publishes `invalidate(session)` and returns `{ sessionId, title, revision: 1 }`.
- `kaiming/src/server/main.ts`: inject `forkSessionFile` from the factory.
- `kaiming/webapp/src/chat/SessionsList.tsx`: `⎇` action on non-archived rows (`data-testid="session-fork"`, `aria-label` from i18n).
- `kaiming/webapp/src/app/App.tsx`: RPC call, refresh, select the new session, toast on success/refusal.
- `kaiming/webapp/src/i18n/catalog.ts`: `session.fork`, `session.forkHint`, `session.forked`, `session.forkRefused` (zh/en).
- Docs: `runtime-contract.md` R1, `ui-design.md` U5 + U9.
- Tests: `test/server-write.test.ts` (real Pi JSONL) + store round-trip covered through the RPC.

## Non-goals

- No branch tree UI, no lineage in the rail (the JSONL header keeps it), no copying Task ownership/authorization/queue.
- No full-file `forkFrom`.
- No model-context rewriting: the fork is a byte-level copy of the current branch.

## Acceptance

- Forking a settled chief session with real history: `200`, new session + binding, new file differs from the source, `session.messages.list` on the fork returns the same visible messages; the source binding/file bytes are unchanged.
- A new message on either side appears only in that side's history.
- Refusals (`WORKSPACE_BUSY` for an unfinished input, `INVALID_ARGUMENT` for an empty or non-chief session) create no session row and no JSONL file.
- A source with an unfinished Task can be forked; the fork's `currentTaskId` is `null`.
- Rail action refreshes and selects the fork; a refusal shows the server reason.
- `npm run typecheck`, focused `test/server-write.test.ts`, `npm --prefix kaiming/webapp test`/`vite build` if the webapp changes are exercised.

## Verification

Developer: typecheck + focused server tests + webapp build/unit tests for the rail. Independent Review and Test over the paths before settlement.
