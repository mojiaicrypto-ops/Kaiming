# Plan — P0-2 Settler single write (disk-authoritative settlement body)

Date: 2026-11-18
Roadmap item: `docs/technicalnew/gap-register.md` §P0-2
Verification profile: **focused**

## Problem

`agent_report` requires a non-empty `body`, and for `kind === 'settlement'` it refuses when the file at `.dev/work/<taskId>/<sessionId>/settlement.md` differs from that body (`VERSION_CONFLICT`). The settler must therefore repeat a multi-KB Markdown document inside JSON arguments — the direct trigger of the 2026-11-13 48-failure incident (escaping errors, 16KB cap, argument degeneration).

## User decision (2026-11-18)

When the settlement file already exists and is non-empty, the disk file is the single source of truth: it becomes `effectiveBody`, no `VERSION_CONFLICT` is raised, the file is not rewritten, and the tool result reports `bodySource: 'disk'`. When the file is missing or empty, a non-empty `body` is still required and is written (`bodySource: 'param'`). Applies to write Tasks only (a read Task's settlement is a server-side report like any other).

## Scope

- `kaiming/src/tools/report-tools.ts`: schema `required: ['summary']`, body description naming the settlement exception; resolve member/task/kind before body validation; compute `effectiveBody`/`bodySource`; use them for `resultId`, `bodyRef`, the write and the returned details; delete the `VERSION_CONFLICT` branch.
- `docs/technicalnew/prompts/settler.md`: the English saving paragraph says the body may be omitted after the file is written and committed.
- `docs/technicalnew/agents-and-tools.md` G2 `agent_report`: same rule.
- Tests: `test/report.test.ts` — disk-authoritative success (body omitted or different, file bytes unchanged, `bodySource: 'disk'`, recorded digest equals the disk bytes); negative control (no file + omitted body → `INVALID_ARGUMENT`; non-settlement kind + omitted body → `INVALID_ARGUMENT`).

## Non-goals

- No change to other kinds' body requirement, to report id derivation inputs beyond using the effective body, or to the commit-before-report rule (D-07 still expects the file to be committed; that is the settler's job, not the tool's check).
- No git verification inside the report tool (the settled rule stays: the delivery gate checks commits, the report tool stores facts).
- No prompt-body cache invalidation: `settler.md` edits take effect after a workbench restart (recorded in the settlement).

## Acceptance

- Disk file present, non-empty, `body` omitted → result recorded, `bodyRef` digest/sha equal to the file bytes, file unchanged, details `bodySource: 'disk'`.
- Disk file present, `body` different → the disk bytes win, no conflict, file unchanged.
- Both where the file is missing/empty and for non-settlement kinds: omitted/empty body → `isError`, code `INVALID_ARGUMENT`, nothing recorded.
- `npm --prefix kaiming run check:prompts` still 15/15.

## Verification

- `npx vitest run test/report.test.ts test/runtime.test.ts`
- `npm run typecheck`, `npm run check:prompts`
- Independent Review/Test before settlement.
