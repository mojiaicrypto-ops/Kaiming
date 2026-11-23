# P3-1 settlement — OS execution sandbox

## Decision

P3-1 is delivered as the filesystem boundary approved on 2026-11-23: `auto`/`strict` fail closed
without a backend or probe, only explicit `off` runs unsandboxed and is visibly marked; the Chief's
project and `.git` are read-only; designer/developer/tester get workspace-write with `.git`
read-only; the settler gets `.git` write with hooks read-only; reviewer/investigator/read/paused
keep no bash. `auto` and `strict` differ only in Docker socket access; both retain network and the
SSH agent. This is not malware containment.

## Delivered

- `kaiming/src/runtime/os-sandbox.ts`: policy, real probe, macOS SBPL with exact-file/socket rules,
  Linux bwrap argv, host-only profile/stub placement, environment allowlist, bounded child wait.
- `runner`, `deletion-gate`, `registry`, `tool-guard`, `server/main`, `read-methods`,
  `stream-methods`, `recorded-config`, and the webapp stream/UI show the sandbox boundary and live
  status; exact workbench `.env` is private while a project `.env` remains readable.
- `setup.sh`/`start.sh`/`package.json` place new `.env` in the data directory, keep the legacy path,
  and resolve the same file for start and MCP.
- Product/technical docs and role prompts are current: P-05, AC-63..65, X-08, G1,
  runtime-contract, ui-design, validation, README/install, chief v13, designer v5, developer v8,
  tester v7.

## Verification

| Check | Result |
|---|---|
| Full suite (`--maxWorkers=2` stable broad run) | **71 files / 735 tests passed** |
| Focused 8 files | **137/137 passed** |
| `test/os-sandbox.test.ts` | **11/11** real macOS kernel cases |
| Server/webapp typechecks, build | pass |
| `check:prompts` | **15/15** |
| Browser `browser/sandbox-status.spec.ts` | **2/2** |
| Webapp unit | 20 files / 140 tests |

A default parallel full run occasionally hits the existing 5 s `git-commit-gate` timeout under
load; the bounded-worker run above is clean, and the timed-out file passes alone.

## Review and Test

- Independent Review: **PASS** after fixing six findings (profile/stub race, cleanup crash,
  `start.sh` cwd/data-dir, `nohup` wait, Linux missing-hook overlay, MCP env resolution) and a
  further linked-worktree settler finding. Evidence in `review.md`.
- Independent Test: **PASS**; 39/39 real macOS checks, reviewer regressions, 71/735 full suite,
  browser and prompt checks. The tester's XDG helper-base residual was fixed after its run by
  canonicalizing candidates/writable roots; `test.md` records the residual and Linux unrun items.

## Residual risks (documented, not hidden)

- Linux `bwrap` isolation was not executed on this macOS host. The exact-file stub, mount order,
  missing-hooks overlay and strict Docker path are code/argv-checked only; the runtime probe fails
  closed on a missing backend.
- Network, SSH agent, Docker (`auto`), project `.env`, other home secrets, Docker mounts and remote
  side effects are outside the boundary. macOS does not clean orphaned `nohup`/`setsid` processes.
- The mode is a service-start setting; changing it needs a restart. Prompt bodies are cached per
  process, so the edited prompts apply after a workbench restart.
- The helper-base XDG canonicalization has no current regression test; the focused suite passes
  after the change.

## Settlement

Product/technical documents, validation and this work-package record are current; the reviewed
delivery is to be committed relative to HEAD. Commit hash is reported in the final reply.
