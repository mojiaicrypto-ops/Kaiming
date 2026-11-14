# Implementation notes

Date: 2026-11-14

## Changes

| File | Change |
|---|---|
| `kaiming/src/runtime/pi-runtime.ts` | Import `createCodemodeExtension`; `DefaultResourceLoader.extensionFactories` now prepends `createCodemodeExtension({ models: false })` for every session (registered inactive; activated only where the allowlist names `codemode`). |
| `kaiming/src/runtime/tool-sets.ts` | New `CODEMODE_TOOL` constant; added to `NATIVE_BY_ROLE` for `developer` and `tester` only. `TOOL_UNIVERSE`/`denied` derive automatically; read-Task filtering leaves codemode in place. |
| `docs/technicalnew/prompts/tester.md` | One paragraph in "End-to-end evidence": script browser actions are awaited sequentially (no `Promise.all` on the same page); visual screenshots go through a direct browser call because scripts receive text facts only, not image attachments. |
| `kaiming/test/tool-sets.test.ts` | Tester write-Task expected array gains `codemode`; new test asserting only tester/developer hold it and read Tasks keep it with `denied` still containing bash/write. |
| `kaiming/test/codemode-runtime.test.ts` | New: real Pi + stub model — activation matrix (tester/developer yes, reviewer no), nested allowed `tools.read` resolves and only the script summary reaches the model, negative control (nested `tools.write` rejects, file not created). |
| `docs/technicalnew/agents-and-tools.md` | G1 developer/tester rows list `codemode`; new contract paragraph (nested calls run the same pipeline: allowlist, hooks, deletion gate, file boundary; preload is inactive for other roles). |
| `docs/technicalnew/validation.md` | Dated entry with evidence and boundaries. |

## Verification (executed)

- `npm run typecheck` — clean.
- Targeted: `npx vitest run test/tool-sets.test.ts test/browser-tool.test.ts test/codemode-runtime.test.ts` — 23/23 passed.
- Full suite (broad profile): `npm test` — 66 files / 632 tests passed.

## Decisions recorded

- `mode` stays Pi's default `"on"` (`"only"` would hide direct tools from the model).
- `models: false` keeps the model-catalog/image-generation script API out of the surface.
- No per-session browser serial queue in this change (accepted residual risk; add only if a same-page race is observed).
- No host-level nested-call budget (script-level `timeout_ms`/`max_output_tokens` are model-set; P0 bash hard-timeout work is separate).

## Operational note

Prompt bodies are cached per process (`runner.bodiesFor`) and the extension preload happens at session creation: a workbench restart is required before the tester prompt guidance and the extension wiring take effect.
