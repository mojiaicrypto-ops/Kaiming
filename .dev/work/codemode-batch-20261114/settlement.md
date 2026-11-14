# Settlement

Date: 2026-11-14
Plan: [plan.md](plan.md) · Implementation: [implementation.md](implementation.md)

## What settled where

| Fact | Authoritative location |
|---|---|
| codemode is a developer/tester capability | `docs/technicalnew/agents-and-tools.md` G1 table (rows developer/tester) + new contract paragraph |
| Nested-call permission semantics | Same contract paragraph (same pipeline: allowlist/hooks/deletion gate/file boundary) |
| Tester script guidance | `docs/technicalnew/prompts/tester.md` "End-to-end evidence" |
| Verification evidence | `docs/technicalnew/validation.md` entry "2026-11-14 · codemode 批量工具接入 developer/tester" |

## Delivery paths (relative to HEAD)

Code: `kaiming/src/runtime/pi-runtime.ts`, `kaiming/src/runtime/tool-sets.ts`, `kaiming/test/tool-sets.test.ts`, `kaiming/test/codemode-runtime.test.ts`.
Docs: `docs/technicalnew/prompts/tester.md`, `docs/technicalnew/agents-and-tools.md`, `docs/technicalnew/validation.md`.
Work records: `.dev/work/codemode-batch-20261114/*`.

## Verification profile

`broad` (role tool permission = shared G1 contract), reason recorded in the plan. Executed: `tsc --noEmit` clean; targeted 23/23; full suite 66 files / 632 tests green. Negative control included (nested denied call rejects; file not created).

## Open items / not covered

- Real-browser E2E with codemode not run (browser behavior unchanged); first real Tester acceptance will exercise it.
- Same-page `Promise.all` race intentionally unguarded (prompt constrains; add per-session queue if observed).
- No host-level nested-call budget; script `timeout_ms` is model-set.
- Workbench restart required for prompt + extension preload to take effect (prompt bodies cached per process).
- Independent Review/Test sessions were not dispatched for this change (user-directed direct implementation in this session); evidence above is developer-executed. If the user wants the standard independent pass, dispatch Review/Test against these paths.
