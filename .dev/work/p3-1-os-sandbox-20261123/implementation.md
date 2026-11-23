# P3-1 implementation — OS execution sandbox

## Delivered

- **Engine**: `kaiming/src/runtime/os-sandbox.ts` adds `SandboxMode` (`auto|strict|off`), a
  per-role `SandboxPolicy`, a real startup probe, macOS `sandbox-exec`/SBPL and Linux `bwrap`
  executors, exact-file support, Docker/socket policy, and an environment allowlist. Paths are
  canonicalized before matching.
- **Fail-closed**: `auto`/`strict` return an inactive status when the backend is missing or the
  probe fails; the runner registers a refusing bash tool with the reason. Only `off` registers the
  local bash path. `off` still scrubs the environment and disables Pi's session metadata.
- **Roles**: Chief read-only project and `.git`; designer/developer/tester workspace-write with
  project `.git`/common dir read-only; settler `.git` writable with hooks read-only; reviewer,
  investigator and read/paused sessions keep no bash.
- **Private data**: the loaded workbench `.env` is an exact private path; project `.env` remains
  readable. The child env keeps only base/toolchain variables, injects a per-session TMPDIR, drops
  access passwords, provider keys and `PI_SESSION_FILE`, and sets `GIT_TERMINAL_PROMPT=0` plus
  `GIT_OPTIONAL_LOCKS=0` for workspace-write roles.
- **Chief gate**: `deletion-gate.ts` has `historyCommandReason` and `readOnlySandbox`; an active
  read-only sandbox refuses commit/history/worktree-discard before `Trust all`/UI, pointing at the
  settler. `off` keeps the old confirmation.
- **Rebuild**: `registry.ts` includes `cwd` and `sandboxKey` in the binding hash.
- **Live status**: `server/main.ts` creates the runtime and exposes its probe result; `session.get`
  and `session.stream.prepare` return `sandbox{mode,backend,active,reason}` independent of input
  history. `recorded-config.ts` keeps the historical `effectiveConfig.sandbox` for audit only.
- **UI**: `stream.ts`/`useSession`/`StatusBar` display the live badge; `off` shows “protection off”,
  unavailable shows the reason, active shows the mode. Browser harness accepts `sandboxMode`.
- **Startup/env**: `scripts/setup.sh` writes the new private `.env` in the data dir; `start.sh`
  resolves explicit data dir → default data-dir `.env` → legacy `kaiming/.env` and passes
  `--env-file` plus `KAIMING_ENV_FILE`. `package.json` start/mcp use the same variable.
- **Docs/prompts**: P-05/AC-63..65/X-08 already updated; README/install, G1, runtime-contract,
  ui-design, chief/designer/developer/tester prompts updated in this implementation.

## Evidence

- `test/os-sandbox.test.ts` 11/11 on macOS: real probe; private read/write, exact `.env`, outside
  write, nested self-hosting private paths, developer `.git` read-only, settler commit/hooks,
  linked-worktree settler commit, private Unix socket blocking, nohup child completion, environment
  allowlist, fail-closed missing backend and fake-unisolated probe.
- `tool-guard` 15/15 (including exact private file inside project, business `.env` readable).
- `deletion-gate` 13/13 (history detection and direct read-only refusal).
- `runtime.test.ts` 63/63 (including real sandboxed chief write refusal, explicit off path, and
  existing audit/gate).
- `server-read` 26/26, `server-stream` 13/13, `codemode-runtime` 4/4 (nested bash sandbox),
  `registry` 1/1 (cwd/sandboxKey rebuild), `workbench-entry` 6/6.
- Full suite: 71 files / 735 tests after the final addition.
- `npm --prefix kaiming run typecheck`, webapp typecheck and `npm --prefix kaiming run build` pass.
- Browser `browser/sandbox-status.spec.ts` 2/2: off badge and auto/unavailable badge.
- `check:prompts` 15/15.

## Limits

- Linux `bwrap` was not installed on this macOS host; its code path (exact-file stub and mount
  order) is reviewed but not executed here. The probe will fail closed until a real Linux run.
- The sandbox is a filesystem boundary only: network, SSH agent, Docker (`auto`), project `.env`,
  other home secrets and remote side effects remain outside. Unattended background processes on
  macOS are not cleaned up.
- Prompt bodies are cached per process; the edited prompts take effect after a workbench restart.
- The startup probe runs once per process. A mode change requires a restart; there is no dynamic
  frontend switch.
