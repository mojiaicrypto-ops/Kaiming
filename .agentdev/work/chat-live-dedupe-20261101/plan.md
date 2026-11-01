# Plan — identity-aware live transcript dedupe

## Decision

User chose option A (2026-11-01): dedupe live messages by identity, not content alone. A new turn whose text repeats an older reply must stay visible. Content matching remains only as a fallback when both sides have no input id.

## Problem

`webapp/src/state/slot.ts` treats equal content as the same message:

- `message_end` finds a completed entry with the same `signatureOf` anywhere in the transcript and removes the live entry. A new reply that repeats an older reply (for example "done") disappears at completion; the history file still has it, so a refresh restores it.
- `mergeMessages` drops a live-only entry when its content is equal to, or a prefix of, any snapshot entry. A resync snapshot can therefore remove a newer completed message or a streaming message whose first words match an older turn.

Reproduced with the slot reducer: snapshot `assistant a1 = "done"` under input `i1`; live input `i2` streams and ends with `"done"`; the final state keeps only `a1`.

## Change

1. Add a turn-identity predicate in `slot.ts`: when either entry has an `inputId`, both must have the same non-null `inputId`; when both are null, content may be used as the legacy fallback. Different inputs are never twins.
2. In `message_end`, the duplicate check requires the same turn identity before removing the live entry. A distinct new message is installed on its own live key.
3. In `mergeMessages`, the exact-content and prefix-twin checks require the same turn identity. Keep the snapshot's real entry when it is really the same input; keep a newer message when its input differs.
4. Existing behaviour without input ids (older history, tests) stays as-is.

## Acceptance

- A new assistant reply with the same text as an older turn under a different `inputId` survives `message_end`.
- A resync snapshot does not drop a completed or streaming live entry whose content repeats/prefixes an entry from a different input.
- A live twin and its snapshot copy under the same `inputId`, or both without input ids, still dedupe to one bubble.
- Existing slot/transcript tests pass; full webapp and server suites and `tsc` pass.

## Out of scope

- No server/Pi protocol change and no new message id field (option C).
- No transcript scroll/render changes.
- Do not change the stale-snapshot merge order or live-key allocation besides the identity checks.

## Verification

- New cases in `webapp/test/slot.test.ts`: repeated text across inputs in `message_end`; repeated text across inputs through resync; prefix twin across inputs; same-input twin still dedupes.
- Run `webapp` tests, server tests and both `tsc --noEmit`.
- If the running workbench is restarted, exercise a live reply that repeats an earlier text and confirm it stays after completion.
