# Model output degeneration guard

## Problem

The latest developer Session completed its code/test work, then produced a 108,832-character
`agent_report` argument: the valid report was about 8 KB, followed by thousands of repeated closing
tags (`</invoke>`, `</function>`, `</v8>`). The SDK rejected the result at the output-token limit;
three retries also produced malformed XML/DSML instead of JSON. The run was eventually stopped after
the 5400-second watchdog. No formal report exists and the malformed output remains in context.

## Decision — first phase only

Do **not** add a provider adapter or try to normalize/repair provider-native XML/DSML. The runtime
accepts only the canonical structured tool call the current provider emits; unsupported formats are
errors, never guesses.

Implement:

1. A streaming degeneration guard on Pi `message_update`: detect repeated closing tags, repeated
   suffix patterns, and an oversized tool-argument buffer; abort the turn before output-limit.
2. A `tool_call` guard: reject non-object arguments, malformed protocol markers, and per-tool
   argument-size limits; do not execute or repair.
3. `message_end` cleanup: a malformed message must not enter persistent history. Remove bad tool
   calls (replace their arguments with a short object to keep tool-result correlation) or replace the
   content with a short host notice when the stream was aborted.
4. Terminal classification: `failed` with errorCode `MODEL_OUTPUT_CORRUPTED`, never `RUN_TIMEOUT`.
5. One bounded corrective retry in the same input: a hidden custom user message tells the model to
   use valid JSON and a concise result. A second degeneration fails; no infinite loop.

`agent_report` gets a 16 KB argument limit (logs go in paths, not the body); every tool has a 1 MB
backstop. Existing provider and tool-call paths are untouched.

## Scope

- `src/runtime/model-output-guard.ts` (new pure detectors + extension/state).
- `src/runtime/runner.ts` (install per run, retry once, classify).
- `src/server/main.ts` (filter the hidden corrective message).
- Tests: pure detectors, real runner/stub integration for early abort, context cleanup, one retry,
  second-failure stop, and valid tool calls unchanged.

## Verification profile

`focused`: server unit/spec tests with the real Pi SDK and stub model; typecheck; targeted existing
tool/interaction tests. No provider/network test; no UI change beyond the existing failure banner and
message notice.

## Acceptance

- The 108 KB repeated-tag pattern is aborted around 8 KB, not at the output limit.
- No malformed assistant/tool-call content remains in Pi history.
- First fault triggers exactly one corrective turn; a clean retry completes.
- Two faults end the input as `failed` / `MODEL_OUTPUT_CORRUPTED`.
- A valid existing tool call and a normal long output still run.
