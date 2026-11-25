# GUI capture tool (`gui`, broad)

Date: 2026-11-25. Basis: the user's confirmed decision to make the host GUI capture capability a
first-class tool instead of an ad-hoc script; P3-1 OS sandbox contract; G1 role tool sets; the
observed macOS TCC and system-Chrome failures recorded in the aijuese tester reports.

## Goal

Give `tester` and `developer` a fixed, read-only, host-side `gui` tool for native macOS evidence:
capture a display, a screen region or a window and store the PNG as an attachment. The tool never
renders through the tester's sandbox. It invokes one signed helper app with a fixed argv; the helper
is the process that holds macOS Screen Recording permission.

The tool is deliberately not a general desktop automation surface: it cannot launch applications,
click, type, run shell commands or choose an arbitrary output path. Web pages continue to use
`browser`; a native app window should prefer Electron's own `capturePage` where that is available.

## Non-goals

- No change to `KAIMING_SANDBOX`, its profiles or role write boundaries.
- No system Chrome launch from tester bash. The Chrome ProcessSingleton failure is fixed by using
  the host-side browser tool or a host-launched Chrome with an isolated profile, not by widening
  the sandbox.
- No GUI input/automation (mouse, keyboard, Accessibility), no app discovery/launch.
- No cross-platform capture. Linux/Windows report `UNSUPPORTED_PLATFORM`; the helper is macOS-only.
- No automatic TCC grant. The user grants Screen Recording to the helper once; if it is absent the
  tool returns a real `TCC_DENIED` / `HELPER_UNAVAILABLE` error and the evidence stays unverified.

## Locked decisions

1. Tool contract:
   - `gui(target='screen', display?)`
   - `gui(target='region', x, y, width, height)`
   - `gui(target='window', windowId)`
   - every numeric argument is validated and bounded; unknown keys are rejected;
   - output is stored through the existing content-addressed attachment store and returned as an
     image block plus attachment id.
2. Ownership: the tool is registered by the host only for `tester` and `developer`; it remains in a
   read Task because it cannot change the project. It is not available to the chief, designer,
   reviewer, settler or investigator.
3. Execution: the tool creates a private temporary directory, launches
   `GuiCapture.app` through LaunchServices (`open -W -n`), and reads a status file plus PNG. It does
   not execute a model-supplied path or command. The helper is ad-hoc signed for local use; the
   build script creates it under `kaiming/native/GuiCapture.app` (ignored by git).
4. TCC: the helper calls CoreGraphics directly. Screen Recording permission is granted to the
   signed helper, not to the tester's `sandbox-exec` child and not to an arbitrary Node process.
   The tool reports `TCC_DENIED` with the System Settings path; it never fabricates a screenshot.
5. Browser/native split: web evidence uses `browser`; Electron window content may use
   `capturePage`; `gui` is for the remaining native pixels (tray status item, menu bar, full
   desktop/window evidence).

## Scope

- `kaiming/src/tools/gui-tool.ts` (new)
- `kaiming/src/runtime/tool-sets.ts`
- `kaiming/src/runtime/runner.ts`
- `kaiming/test/gui-tool.test.ts` (new)
- `kaiming/test/tool-sets.test.ts`
- `kaiming/native/gui-capture.swift` (new)
- `kaiming/native/build.sh` (new)
- `kaiming/package.json` (`build:gui` script)
- `.gitignore` (generated helper app)
- `docs/technicalnew/agents-and-tools.md`
- `docs/technicalnew/prompts/tester.md`
- `docs/technicalnew/prompts/developer.md`
- `docs/technicalnew/validation.md`
- `.dev/work/gui-capture-tool-20261125/plan.md` (this file)

## Verification profile

Verification profile: broad

Reason: this adds a host-side privileged observation tool and changes a shared role allowlist. The
focused tool tests cover argument validation, attachment storage, TCC/helper failures and the
allowed/denied products; the broad reason permits the existing full suite and typecheck. Real
macOS pixels require a one-time TCC grant and are recorded as a separate environment gate, not
simulated as a pass.

Commands:

- `npm --prefix kaiming run typecheck`
- `npm --prefix kaiming test -- test/gui-tool.test.ts test/tool-sets.test.ts`
- `npm --prefix kaiming test` for the broad suite
- `bash kaiming/native/build.sh` (compile/sign the local helper)
- a real helper probe, if Screen Recording is granted: `gui` completion is recorded separately;
  otherwise the exact TCC denial is recorded as `not_run` for pixels.
