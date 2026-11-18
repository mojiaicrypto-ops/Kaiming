# Implementation notes — P0-2

Date: 2026-11-18
Plan: [plan.md](plan.md)

## Changes

| File | Change |
|---|---|
| `kaiming/src/tools/report-tools.ts` | Schema `required: ['summary']`; `body` described as optional for a write Task settlement with a file on disk. Member/task/kind resolve before body validation. New `effectiveBody`/`bodySource`: a non-empty `.dev/work/<taskId>/<sessionId>/settlement.md` is the authoritative body (`bodySource: 'disk'`, never rewritten); otherwise a non-empty parameter body is required (`bodySource: 'param'`). `resultId`, `bodyRef`, the write and the write-back of the read-back check all use the effective body. The `VERSION_CONFLICT` branch is deleted. Both success returns (recorded and already-recorded) carry `bodySource`. |
| `kaiming/src/runtime/runner.ts` | The missing-report reminder now tells a settler that the committed `settlement.md` is the body and to pass `body` only when the file is missing (`bodyField`), instead of asking for the Markdown again. |
| `kaiming/test/report.test.ts` | Rewritten settlement test: body omitted → recorded from disk (`bodyRef.sha256` equals the file digest, file unchanged) and a second call with a different parameter body still records the disk bytes. New negative control: no file + no body → `INVALID_ARGUMENT`, nothing recorded; a non-settlement kind without body → `INVALID_ARGUMENT`. |
| `kaiming/test/runtime.test.ts` | New: a settler that answers prose twice still fails `REPORT_MISSING`, and the persisted history shows the reminder pointing at `settlement.md` (`pass \`body\` only when that file is missing`). |
| `docs/technicalnew/prompts/settler.md` | Saving paragraph: submit `agent_report` with summary and checks only; the committed file is the body; a missing/empty file still requires `body`. |
| `docs/technicalnew/agents-and-tools.md` | G2 agent_report: the disk-authoritative rule, `bodySource`, and the settler-specific reminder. |

## Verification (executed)

- `npm run typecheck` — clean.
- `npx vitest run test/report.test.ts test/runtime.test.ts test/deliverable.test.ts test/git-commit-gate.test.ts` — 106 passed.
- `npm run check:prompts` — 15/15.

## Operational note

Prompt bodies are cached per process (`runner.bodiesFor`): the `settler.md` change takes effect only after the workbench restarts. The tool and runner changes take effect on restart as well (running process).

## Deviations

- `resultId` now digests the effective body, so the same settlement submitted with or without a parameter body maps to the same result id when the disk bytes are identical (intended: a retry is a retry).
- The reminder's settlement branch is a small runner-text change beyond the plan's file list; recorded because the reminder is exactly the turn that re-created the incident.
