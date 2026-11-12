# Raw question recovery

## Problem

The model sometimes writes an interactive question as assistant text instead of calling the
`question` tool:

```text
<question method="select" title="..." message="...">
<options>...</options>
</question>
```

No interaction row is created, so the browser renders the markup as ordinary Markdown and the run
continues without an answer. Prompt rules alone cannot guarantee model tool-call compliance.

## Decision

Add a host-side recovery extension on `message_end`:

1. Detect a complete raw `<question>` block at the end of the last assistant text block, ignoring
   fenced code examples and messages that already contain a real `question` tool call.
2. Parse it with the same `method/title/message/options/placeholder` contract as the question tool.
3. Create and wait on the existing `InteractionBridge` (durable row, pending panel, watchdog-aware).
4. Replace the finalized assistant message text with the block removed, so the persisted history and
   live `message_end` frame are clean.
5. After a real answer, enqueue a hidden custom user message containing the question and answer so
   the same run continues; the custom message is filtered from the browser stream and history.

A prompt/tool-description rule also tells the model to use a real tool call and never print the
markup, but the runtime recovery is the guarantee.

## Scope

- `src/runtime/raw-question.ts`: parser + extension factory.
- `src/runtime/runner.ts`: install the extension for every session/input.
- `src/server/main.ts`: do not publish the hidden answer custom message.
- `webapp`: hide raw question markup in live assistant text (streaming may show the block before
  `message_end`), including old history; fenced code is preserved.
- `docs/technicalnew/prompts/base.md` and `question-tool.ts` description: explicit tool-call rule.
- Tests: parser, real runtime/interaction round trip with a stub model, negative controls (code fence,
  existing question tool call, abort), webapp text filter.

## Verification profile

`focused`: unit tests for parser/filter; one real runner integration test with the stub model and
real InteractionBridge; typecheck. Browser interaction is the existing panel path and needs no new
visual acceptance.

## Acceptance

- A stub assistant reply containing the raw markup creates one pending `select` interaction.
- Answering it resumes the same input, and the second model turn receives the answer.
- The raw markup is absent from the persisted Pi history and from the final browser message content.
- An example inside a fenced code block and a real `question` tool call do not create a second
  interaction.
- Stopping while the recovered question is pending resolves the interaction as stale and does not
  hang the run.
