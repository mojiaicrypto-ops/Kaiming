# P3-1 independent Test

## Verdict

**PASS** on the current tree after the linked-worktree fix. Real macOS `sandbox-exec` checks,
automated suites and the reviewer regressions were run independently; no source edits.

## Automated checks

| Check | Result |
|---|---|
| `npm --prefix kaiming test` (clean rerun) | **71 files / 735 tests passed** |
| Focused: os-sandbox, runtime, deletion-gate, server-read, server-stream, codemode-runtime, registry, workbench-entry | **137/137** |
| `npm --prefix kaiming run typecheck` | pass |
| `npm --prefix kaiming/webapp run typecheck` | pass |
| `npm --prefix kaiming run build` | pass |
| `npm --prefix kaiming run check:prompts` | **15/15** |
| `npm --prefix kaiming run test:browser -- browser/sandbox-status.spec.ts` | **2/2** |
| `npm --prefix kaiming/webapp test` | **20 files / 140 tests** |

A concurrent run with four sandbox repro scripts produced 3 transient timeouts; the clean rerun
above passed. The default parallel full run still occasionally hits the 5 s `git-commit-gate`
timeout under load; `--maxWorkers=2` is the stable broad command.

## Real macOS checks (39/39)

- Private reads/writes of dataDir/`state.db`/`models.json`, exact workbench `.env`, symlink reads and
  outside-root writes denied; business `.env`, project writes and `<agentDir>/work` allowed.
- Private Unix socket connect denied; host connect works.
- Developer `git status` 0, `.git/index`/hooks writes denied, commit 128; settler add/commit 0,
  hooks write denied; linked worktree settler add/commit 0 and both worktree/common hooks denied.
- Nested self-hosting private data/env inside a writable project denied; project writes succeed.
- `nohup` foreground returns in 112 ms and the background `done.txt` appears.
- Fake/unisolated probe inactive; real probe active; missing backend fail-closed; `off` reports
  protection off.
- Docker `auto` connect 0, `strict` connect 9 / stat denied (6/6).

## Reviewer regressions

- **P0 profile rewrite: 16/16.** A leftover watcher observed real profiles but never rewrote them;
  appends/chmod/unlink of host-tmp profiles denied; subsequent private read/outside write still
  denied.
- **P1 start/package: 9/9.** From the repo root `start.sh` runs in `kaiming/`; legacy relative
  `KAIMING_DATA_DIR` resolves under `kaiming`; data-dir `.env` wins over legacy; explicit relative
  data dir resolves under `kaiming`; missing env fails closed. Real `npm` start/mcp resolution picks
  data-dir then legacy.
- **P2 missing hooks: 12/12 macOS.** Settler cannot create/write hooks; host sees no hooks dir;
  commit still works. Linux fake-bwrap argv 5/5: `--dir` + `--ro-bind` empty dir, exact `.env`
  stub not `--tmpfs`, cwd bind precedes overlays.
- **Cleanup throw: 5/5.** A forced helper-cleanup failure left the dir behind, but the exec promise
  resolved and the host survived.

## Residual / unrun

- `XDG_CACHE_HOME` set to the host `tmpdir()` exposed a canonicalization gap in the helper-base
  guard. Fixed after this Test by canonicalizing candidates and writable roots before comparison;
  the focused/full suites still pass.
- Real Linux/bwrap isolation and the host-side `.git/hooks` creation side effect are not executed
  on this host (bwrap absent); the probe fails closed there. Network/SSH effects and macOS orphan
  cleanup remain outside the boundary by design.
- No live restart/UI E2E beyond the focused browser badge spec; live status is covered by the
  server tests and that spec.
