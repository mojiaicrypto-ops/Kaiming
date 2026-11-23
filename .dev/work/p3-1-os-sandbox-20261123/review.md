# P3-1 independent Review

## Round 1 — NEEDS_FIX

The reviewer read the implementation and ran isolated `sandbox-exec`/module repros. Six
findings; all were accepted as real and fixed.

| # | Severity | Finding | Resolution |
|---|---|---|---|
| 1 | P0 | The macOS profile and Linux stub were created under `policy.tempDir`, which is writable by the sandboxed role; a leftover watcher could replace the next profile with `(allow default)` and escape. | Profiles/stubs now use host-only `mkdtempSync(join(tmpdir(), 'kaiming-sb-*'))` outside every writable root; bwrap stub dirs are tracked and removed. |
| 2 | P1 | `cleanup()` could throw `ENOTEMPTY` from the child close handler and kill the workbench. | Cleanup is wrapped in try/catch; helper dirs are outside the writable boundary. |
| 3 | P1 | `scripts/start.sh` exec'd `node` from the caller's cwd, so a legacy relative `KAIMING_DATA_DIR` resolved to a new repo-root store. | `start.sh` now `cd "$APP"` before exec; `setup.sh`/`start.sh`/`package.json` resolve data-dir → legacy consistently. |
| 4 | P2 | Sandboxed bash waited on `close`, so `nohup ... &` hung until the inherited pipes closed (600 s then kill). | Local `waitForChildProcess` mirrors Pi's 100 ms data-rearmed post-exit grace, destroys the pipes, and only then checks timeout/abort; added a real `nohup` test. |
| 5 | P2 | Linux skipped a missing `<gitDir>/hooks` overlay, so a settler could create a hook on a clean repo. | Missing read-only subpaths now get `--dir <path>` + `--ro-bind <host-empty-dir> <path>`; static-only because bwrap is absent on this host. |
| 6 | P3 | `npm run mcp` only looked for `kaiming/.env`, not the new data-directory `.env`. | `package.json` start/mcp resolve `KAIMING_ENV_FILE` → `${KAIMING_DATA_DIR:-.kaiming-data}/.env` → legacy `.env`; `start.sh` honors an explicit env file. |

## Round 2 — re-check

Focused re-check: **PASS**. The six findings are fixed; the linked-worktree settler finding was
fixed by adding `gitDir`/`commonDir` to the settler writable roots (hooks remain after it) and is
covered by a real `git worktree` test. The reviewer's profile-swap attack now yields 0/20 outside
writes, 0/20 private reads, no host crash, and `nohup` resolves in ~117 ms.
