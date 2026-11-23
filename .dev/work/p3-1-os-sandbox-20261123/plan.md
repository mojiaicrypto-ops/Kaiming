# P3-1 — OS execution sandbox (`WP-Sandbox`, broad)

Date: 2026-11-23. Basis: the user's confirmed decisions in this session, the product contract
`docs/productnew/modules/project-workspace.md` P-05 (执行沙箱与角色边界), acceptance AC-63～AC-65,
external-agent X-08, and `docs/technicalnew/gap-register.md` P3-1. Product text was updated before
this Plan; README/install/G1 and prompts stay until implementation settlement.

## Goal

Give every role that holds `bash` an OS-level filesystem boundary that is fixed by the host:
workbench-private storage is unreadable, project writes follow the role, and the chief cannot
modify or commit the project. The boundary is fail-closed on `auto`/`strict`; only an explicit
`off` runs unsandboxed and must be visibly reported as unprotected.

The sandbox is a filesystem boundary, not malware containment. Network, SSH agent and (in `auto`)
the Docker socket remain available; the product must not claim otherwise.

## Non-goals

- No P3-2 Worktree or P3-3 parallel-task work; those are separate product changes.
- No network isolation, SSH-agent removal, or Docker-socket removal in `auto`; `strict` only
  removes Docker. Untrusted repositories still require a container/VM/separate user.
- No blocking of the user's own project `.env`; only the workbench's loaded `.env` is private.
- No blackhole of the user's other home secrets (`~/.ssh`, `~/.npmrc`, etc.); document the limit.
- No frontend mode-switch form. `KAIMING_SANDBOX` is read at service start; a restart applies it.
- No tester source lock; the delivery digest remains the source-change gate.
- No sandbox around `browser`/`web_fetch`/`read` host tools; they keep their existing boundaries.
- No automatic cleanup of orphaned `nohup`/`setsid` processes on macOS.
- No new DB schema. `effectiveConfig` is JSON.

## Scope

- `kaiming/src/runtime/os-sandbox.ts`
- `kaiming/src/runtime/tool-guard.ts`
- `kaiming/src/runtime/runner.ts`
- `kaiming/src/runtime/deletion-gate.ts`
- `kaiming/src/runtime/registry.ts`
- `kaiming/src/runtime/recorded-config.ts`
- `kaiming/src/server/main.ts`
- `kaiming/src/server/read-methods.ts`
- `kaiming/src/server/stream-methods.ts`
- `kaiming/src/mcp/main.ts`
- `kaiming/webapp/src/api/stream.ts`
- `kaiming/webapp/src/state/useSession.ts`
- `kaiming/webapp/src/app/App.tsx`
- `kaiming/webapp/src/app/StatusBar.tsx`
- `kaiming/webapp/src/i18n/catalog.ts`
- `kaiming/test/os-sandbox.test.ts`
- `kaiming/test/tool-guard.test.ts`
- `kaiming/test/deletion-gate.test.ts`
- `kaiming/test/deletion-gate-runtime.test.ts`
- `kaiming/test/runtime.test.ts`
- `kaiming/test/registry.test.ts`
- `kaiming/test/server-read.test.ts`
- `kaiming/test/server-stream.test.ts`
- `kaiming/test/codemode-runtime.test.ts`
- `kaiming/test/workbench-entry.test.ts`
- `kaiming/browser/sandbox-status.spec.ts`
- `kaiming/browser/harness.ts`
- `scripts/setup.sh`
- `scripts/start.sh`
- `kaiming/package.json`
- `docs/technicalnew/runtime-contract.md`
- `docs/technicalnew/ui-design.md`
- `docs/technicalnew/agents-and-tools.md`
- `docs/technicalnew/prompts/chief.md`
- `docs/technicalnew/prompts/designer.md`
- `docs/technicalnew/prompts/developer.md`
- `docs/technicalnew/prompts/tester.md`
- `docs/technicalnew/validation.md`
- `README.md`
- `README.en.md`
- `docs/install.md`
- `docs/install.en.md`

## Locked product decisions

1. `auto` and `strict` fail closed if `sandbox-exec`/`bwrap` is missing or the startup probe fails:
   `bash` returns a real error with the reason; no silent unsandboxed fallback.
2. Only `KAIMING_SANDBOX=off` runs unsandboxed, and the current work/session detail visibly reports
   `保护已关闭`. `auto` and `strict` differ only in Docker socket access.
3. Role policy:
   - chief: `read-only`; project and `.git` read-only; temp + `/dev/null` + operation sockets;
     `ssh`, `curl`, `docker` (`auto`), `lsof`, logs, `git status` work.
   - designer/developer/tester: `workspace-write`; cwd + temp + reviewed caches; project `.git`
     (and linked common dir) read-only; `GIT_OPTIONAL_LOCKS=0`; commit denied.
   - settler: `workspace-write-git`; `.git` writable, `<gitDir>/hooks` read-only.
   - reviewer/investigator/read Task/paused: no bash.
4. Chief history actions: with an active read-only sandbox, commit/merge/rebase/cherry-pick/
   force-push/reset-hard/checkout--|./restore return a direct `isError` pointing at the settler; no
   interaction. `Trust all` cannot unlock the kernel. Only `off` keeps the old confirmation.
5. Privacy:
   - `privatePaths` includes dataDir, agentDir and the exact loaded workbench `.env`; read/write/list
     denied, except `<agentDir>/work` read-only. The user's own project `.env` stays readable.
   - Child environment is an allowlist, not a copy: keep base/toolchain variables (`PATH`, `HOME`,
     `USER`, `SHELL`, `LANG`, `LC_*`, `TERM`, `XDG_*`, `SSH_AUTH_SOCK`, `DOCKER_HOST`,
     `HTTP(S)_PROXY`, `NO_PROXY`, etc.), inject per-session `TMPDIR`/`TEMP`/`TMP`, remove access
     passwords/provider keys/`PI_SESSION_FILE`, and set `GIT_TERMINAL_PROMPT=0`.
   - `exposeSessionEnvironment: false` even in `off`.
6. Visibility has two separate facts:
   - **Live service status**: the startup probe result `{mode, backend, active, reason}` is returned
     directly by `session.get` and `session.stream.prepare` (via `server/main.ts`), so a restart or a
     brand-new/idle session shows the current mode immediately, before any input exists. The UI keeps
     it in `useSession`/`stream.ts` and renders it in `StatusBar`/session detail.
   - **Historical input snapshot**: `effectiveConfig.sandbox` is recorded with each claimed input for
     audit and history only; it must not drive the live badge, otherwise a mode change on restart or a
     session with no input shows stale/blank state. `recorded-config.ts` keeps the historical field
     desensitized; it is not the source of the live fact.
   - Startup failure is visible, not log-only.
7. `.env`: new installs put the workbench `.env` in the private data area; `start.sh` still accepts
   the old `kaiming/.env`. The actual loaded path is added to the private paths either way.
8. Environment mode is a service-start setting; first version has no dynamic UI switch. Prompt
   changes require a workbench restart (prompt bodies are cached by `promptDir`).

## Implementation

1. **`kaiming/src/runtime/os-sandbox.ts`**
   - Policy types: `SandboxMode`, `SandboxProfileKind`, `SandboxPolicy` with `privatePaths`, exact
     file support, `readablePrivatePaths`, `writableRoots`, `readOnlySubpaths`, `tempDir`,
     `allowDockerSocket` (`auto` true / `strict` false), `allowSshAgent` (both true),
     `networkAccess: 'allow'`.
   - `sandboxPolicyFor(role, mode, ...)`: fixed role mapping. Do not reject a project merely because a
     private path is nested inside its root (self-hosting `/repo` with data under `/repo/kaiming`);
     resolve realpath and only reject the opposite case where a project root would sit inside a
     private directory.
   - `probeSandbox(mode)`: real child process; private read + outside write must both fail; an
     unisolated fake executor must fail the probe.
   - `createSandboxedBashOperations(policy): BashOperations`: macOS direct `sandbox-exec -f` with
     `-D` parameters (no outer unsandboxed `bash -c`); Linux direct `bwrap` with
     `--ro-bind/--tmpfs/--bind` and `--die-with-parent`; preserve Pi's `detached`, process-tree kill,
     `AbortSignal` and timeout behavior.
   - **Linux exact files**: `bwrap --tmpfs` accepts directories only. For an exact private file
     (old `kaiming/.env`) bind a `chmod 000` empty stub read-only over it
     (`--ro-bind <stub> <envFile>`), so `cat`/`open()` gets `EACCES`; directories use
     `--tmpfs <dir>` and then re-bind `<agentDir>/work` read-only.
   - **Linux mount order**: bind `<cwd>` first, then cover `privatePaths` and read-only
     `<cwd>/.git` / common dir; a later overlay must be the one that wins. A real self-hosting case
     (`projectRoot=/repo`, `dataDir=/repo/kaiming/.kaiming-data`, `.env` inside the project) must be
     in the probe.
   - **macOS SBPL**: directories use `(subpath ...)`, exact files use `(literal ...)`; with
     last-match-wins, allow writable roots, then deny `privatePaths`, then allow read
     `<agentDir>/work` last. Verify that exact order with a real child, including the nested
     self-hosting layout; do not infer it from the profile text.
   - No global singleton; no gitignore emulation; no per-file `reviewed.paths` expansion.
2. **`kaiming/src/runtime/tool-guard.ts`, `kaiming/src/server/main.ts`**
   - Extend the private path set to directories and exact files; resolve realpath before comparison.
   - Add the actual loaded workbench `.env` path; leave project `.env` alone.
   - Keep the existing `agentDir/work` read exception.
3. **`kaiming/src/runtime/runner.ts`**
   - When the role allowlist contains `bash` and the mode is active, register a native
     `createBashToolDefinition(cwd, { operations, exposeSessionEnvironment: false })` as a custom
     tool so it also covers `codemode` nested calls.
   - When `auto`/`strict` probe fails, register a `bash` tool that returns the probe reason as an
     `isError` result (or omits the tool with the same visible reason); never fall back.
   - `off`: keep the native/bash path but still scrub the environment and disable
     `exposeSessionEnvironment`.
   - Record the desensitized `sandbox` in `recordEffectiveConfig`.
4. **`kaiming/src/runtime/deletion-gate.ts`**
   - Split/export a `historyCommandReason` path from `HISTORY_RULES`; keep the default deletion table
     and other roles unchanged.
   - Add `readOnlySandbox` to `DeletionGateOptions`; in `tool_call`, check it before trust, and when
     a chief history command matches, return `{ block: true, reason: '<refusal>; settler closes the
     delivery' }` without `ctx.ui.select`.
   - `off` keeps the current confirmation/trust behavior.
5. **`kaiming/src/runtime/registry.ts`**
   - Add `cwd` and `sandboxKey` to `bindingHash`; rebuild the Pi instance if the working directory or
     policy changes.
6. **`scripts/setup.sh`, `scripts/start.sh`, `kaiming/package.json`,
   `kaiming/src/mcp/main.ts`, `kaiming/src/server/main.ts`**
   - New installs create the workbench `.env` in the default private data directory
     (`kaiming/.kaiming-data/.env`), not in the project root.
   - Start resolution order: (1) explicitly set `KAIMING_DATA_DIR` → `$KAIMING_DATA_DIR/.env`; (2)
     otherwise the default private data directory's `.env`; (3) legacy `kaiming/.env`. `start.sh`
     resolves this before starting npm so the `KAIMING_DATA_DIR` inside the file is not needed to
     find the file.
   - `start.sh` passes an explicit `--env-file <resolved>` and exports
     `KAIMING_ENV_FILE=<realpath>`; `server/main.ts` adds that realpath to `privatePaths`.
     `kaiming/package.json:11` must not hardcode `--env-file-if-exists=.env`; direct `npm start`
     uses `KAIMING_ENV_FILE` when set and falls back to the legacy file. `kaiming/src/mcp/main.ts`
     self-start must use the same resolved data/env path (or attach to the running workbench), never
     start with an empty password/store.
   - Test both new and legacy paths and the MCP self-start path; never expose `.env` contents in the
     read surface.
7. **Read surface / live UI**
   - `server/main.ts` exposes a startup sandbox status provider; `read-methods.ts` (`session.get`)
     and `stream-methods.ts` (`session.stream.prepare`) return a live `sandbox` field independent of
     input history.
   - `webapp/src/api/stream.ts` and `webapp/src/state/useSession.ts` carry that live field;
     `webapp/src/app/App.tsx` passes it; `webapp/src/app/StatusBar.tsx`/session detail renders
     mode + active/inactive + reason. No new mode form or settings mutation.
   - `recorded-config.ts` only adds the historical `effectiveConfig.sandbox` audit field; it is not
     used by the live badge.
8. **Docs and prompts at implementation settlement**
   - Update `docs/technicalnew/agents-and-tools.md` G1, `README.md`/`README.en.md`,
     `docs/install.md`/`install.en.md`, and `docs/technicalnew/validation.md`.
   - Update `docs/technicalnew/runtime-contract.md` R1: `session.get` and `session.stream.prepare`
     return the live sandbox status; historical `effectiveConfig.sandbox` remains audit data.
   - Update `docs/technicalnew/ui-design.md` StatusBar/method-consumption table for the new field.
   - `prompts/chief.md`: read-only sandbox rejects project writes/commit/history; settlement commit
     belongs to the settler; update `task(op=end)` wording.
   - `prompts/designer.md:110`: use ordinary `mv`/`rm`; no `git mv` dependency.
   - `prompts/developer.md`/`tester.md`: generic isolation-test guidance (free port + `$TMPDIR`,
     optional named Docker containers, clean up, never touch shared services/data).
   - Note that prompt text is cached per process and needs a restart.
   - Do not edit README/install/G1 before the code is actually implemented.

## Verification profile

Verification profile: broad

**broad** — shared execution layer and cross-role permission boundary. Full suite is allowed with
this reason. Independent Review and independent Test are required. Test runs real kernel child
processes; no mock replacement for the sandbox.

Commands:
- `npm --prefix kaiming test -- test/os-sandbox.test.ts test/tool-guard.test.ts test/deletion-gate.test.ts test/deletion-gate-runtime.test.ts test/server-read.test.ts test/server-stream.test.ts test/runtime.test.ts test/registry.test.ts test/workbench-entry.test.ts test/codemode-runtime.test.ts`
- `npm --prefix kaiming run typecheck`
- `npm --prefix kaiming/webapp run typecheck`
- `npm --prefix kaiming/webapp test`
- `npm --prefix kaiming run build`
- `npm --prefix kaiming run test:browser -- browser/sandbox-status.spec.ts`
- `npm --prefix kaiming test`
- `npm --prefix kaiming run check:prompts`

## Acceptance

- **AC-63 privacy/escape**: `cat`, `node`, symlink reads of dataDir `models.json`/`state.db`/loaded
  `.env` fail; `<agentDir>/work` reads; project `.env` reads; `..`/symlink writes outside fail;
  child env lacks access password/provider keys/`PI_SESSION_FILE` and retains base toolchain vars.
- **AC-64 roles/UX**: chief cannot touch/sed/commit/reset; `git status`/ssh/docker/lsof/logs work in
  `auto`; designer/developer/tester write code/build output but commit/hooks fail; settler commits,
  hooks write fails; tester writes `dist`/`coverage`; denials are real errors with reasons, no
  privilege prompt; `Trust all` does not unlock writes.
- **AC-65 modes/failure**: `auto`/`strict` without backend or with a failed probe refuse bash and
  show the reason; `off` runs unsandboxed and visibly says protection is off; `auto` allows Docker
  socket, `strict` denies it; both retain network/SSH; restart applies the mode; no dynamic UI.
- Chief history commands under an active read-only sandbox produce a direct `isError` and no
  interaction; `off` still asks.
- `registry.acquire` rebuilds when cwd or `sandboxKey` changes; `codemode` nested bash is sandboxed.
- Full suite, typecheck, prompts check pass; Test includes known-bad/failed-probe controls.
- **Live visibility**: after changing `KAIMING_SANDBOX` and restarting, an idle/new session shows
  the current `{mode, backend, active, reason}` immediately from `session.get`/stream prepare; it
  never shows a stale historical `effectiveConfig` value. Historical input snapshots remain audit
  data.
- **Backend edge cases**: Linux exact-file stub and mount order plus macOS SBPL exact-file/order
  pass a real self-hosting probe (`projectRoot=/repo`, private data and `.env` inside it); no
  `--tmpfs` on a file and no assumption that profile order is irrelevant.
- **`.env` resolution**: new default, explicit `KAIMING_DATA_DIR`, legacy `kaiming/.env`, and
  `kaiming/src/mcp/main.ts` self-start all resolve to a real password/data file; no empty store.
- **Frontend checks**: webapp typecheck/test, server build, and the focused browser badge check pass.

## Risks / open implementation questions

- SBPL exact-file and symlink semantics must be proven by the real probe; do not infer from rules.
- `sandbox-exec` is macOS-specific and deprecated; `bwrap` may be absent on Linux; fail-closed is the
  product answer, not a fallback.
- `ssh` may need `known_hosts`/agent access; use configured hosts and test; do not grant home-wide
  writes. `docker` in `auto` is host-equivalent and can bypass project read-only by design.
- `.env` path migration must not break `npm start`/`start.sh`; test both paths.
- Environment allowlist may break npm/git/toolchains; add only reviewed variables, never wildcard.
- `git status` with a read-only `.git` needs `GIT_OPTIONAL_LOCKS=0`; verify on a real repo.
- The audit (`shell-audit.ts`) remains visibility, not a boundary; Docker/SSH effects stay out of
  scope.
- Prompt changes need a restart; a green `check:prompts` does not prove runtime behavior.
- **Live-vs-history**: `recordedConfigOf(inputs)` is history; it must not feed the live badge. Test
  restart-with-off, no-input session, and a session whose last input ran under a different mode.
- **bwrap exact file/order**: a single-file private path cannot be `--tmpfs`; the stub bind and the
  cwd-first overlay order need their own negative control. macOS SBPL exact `(literal ...)` and
  last-match-wins order need the same.
- **`.env` bootstrap**: resolving the data dir before reading the env file; `kaiming/package.json`
  and MCP self-start must not fall back to an empty password/store.
- **Frontend contract**: live `sandbox` must reach `useSession`/`StatusBar` without a message; the
  browser check covers off/active display.

## Delivery sequence

1. Product/acceptance/gap-register updated (done in this session; no code).
2. This Plan is the implementation basis; code changes start only after the usual Task authorization.
3. Implement + focused/broad checks + independent Review/Test.
4. Settlement updates G1, README/install, prompts, validation, and records actual evidence and
   residual limits; commit the reviewed paths.
