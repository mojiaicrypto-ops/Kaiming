# Codemode batch tool for Tester and Developer

## Goal

Enable Pi's built-in `codemode` tool for the Tester and Developer roles so one model turn can batch independent tool calls (sequential browser actions, parallel bash/read) and filter large outputs before they reach the model. Whether to use codemode is the model's decision; Pi's own tool guideline steers it.

## Scope

- Load `createCodemodeExtension({ models: false })` unconditionally in `PiRuntimeFactory.create` (inactive until allowlisted).
- Add `codemode` to `NATIVE_BY_ROLE` for `tester` and `developer` only.
- One prompt sentence in `tester.md`: browser actions are awaited sequentially inside a script; visual screenshots still go through a direct browser call (codemode receives text only, not image attachments).
- Tests: tool-set assertions + one codemode wiring test with a negative control.
- Settlement: G1 table rows in `docs/technicalnew/agents-and-tools.md`, `docs/technicalnew/validation.md`.

## Out of scope

- No browser per-session serial queue (prompt forbids same-page `Promise.all`; add a lock only if a real race is observed).
- No other roles (reviewer/investigator/chief/designer/settler).
- No `mode: 'only'`; direct tools stay declared.
- No Playwright replacement; no P0 bash hard-timeout work.

## Verification profile

`broad` — role tool permissions are a shared contract (G1). Commands: `npm run typecheck`, targeted vitest files, then the full `npm test` once. Negative control: a tester/developer codemode script calling a denied tool must fail, and a script calling an allowed tool must succeed.

## Steps

1. `pi-runtime.ts`: import `createCodemodeExtension`, prepend to `extensionFactories`.
2. `tool-sets.ts`: `CODEMODE_TOOL` + tester/developer entries.
3. `tester.md`: one sentence in the end-to-end evidence section.
4. Tests: update `tool-sets.test.ts` expected arrays; add codemode wiring test (extension loads, tool activates only when allowlisted, nested allowed call resolves, nested denied call rejects).
5. Docs settlement.

## Risks

- Model parallelizing same-page browser calls: accepted residual risk, prompt constrains; add queue if observed.
- Prompt bodies are cached per process (`runner.bodiesFor`): the tester.md change takes effect only after a workbench restart.
