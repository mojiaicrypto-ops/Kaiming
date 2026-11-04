# Review — chat operation feedback and queue content

Task: chat-operation-feedback-20261104
Independent reviewer: `AgreeableClownfish` (separate read-only context)

## Round 1: failed (3 P2, 1 P3)

1. Snapshot exposed host `system_notice` text as if it were the user's queued message. Fixed on server (`kind === 'user'`) and client, with notice fixtures.
2. STOP on a queued input left a phantom row because no turn event exists. Fixed by removing the row/echo/current target on stop, later refined so STOP stays on the executing input and queue rows use withdraw.
3. `waitingForTask` was returned for messages the claim gate runs immediately. Narrowed to unassociated inputs with a current Task, or cited supplements while the chief is processing; tests cover idle and busy cases.
4. Compact button's `busy` class collided with the transcript's working block. Removed; `aria-busy`/label remain.

## Round 2: passed with a P1 follow-up

The P1 found that STOP did not follow the input when a queued message became the running turn. Fixed by adopting `frame.inputId` in `turn_start`/assistant `message_start`; reducer and real-browser handoff tests added.

## Round 3: passed with one P3 inter-turn note

STOP could remain enabled against a settled input between turns. Fixed by clearing `currentInputId` on `agent_end` while a queue remains, and hiding/disable STOP unless processing/stopping. Final re-review: **pass**; no blocking or non-blocking findings.

## Boundary

The reviewer did not run tests; the developer/test evidence is in `test.md`.
