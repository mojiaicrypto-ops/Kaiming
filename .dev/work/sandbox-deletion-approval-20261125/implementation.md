# Implementation

## Change

- `kaiming/src/runtime/deletion-gate.ts`
  - only writer heredoc bodies (`cat >`, `tee`, `git commit -F -`) are removed before command matching; executable heredocs (`bash`/`sh`/`python3`/`node`) keep their body.
  - Git cleanup rules (`git clean -f`, `git stash drop/clear`, `git branch -D`) are marked high-risk.
  - `sandboxActive` skips only ordinary file-deletion prompts; high-risk Git, `off`, read-only history and no-sandbox paths still prompt or refuse as before.
- `kaiming/src/runtime/runner.ts`
  - passes `sandboxActive` only when the startup probe is active and the role policy is `workspace-write` (designer/developer/tester). Chief, settler, `off` and unavailable sandboxes do not get the exemption.
- Tests:
  - writer heredoc bodies: `cat` with redirection before or after the opener, `tee`, and `git commit -F -`; an opener piped to an interpreter remains visible;
  - executable `python3`/`node`/`bash` bodies still trigger; `bash <<EOF` containing high-risk Git cleanup remains blocked with the sandbox active;
  - ordinary deletion is skipped only with `sandboxActive`;
  - high-risk Git cleanup remains blocked without UI;
  - existing runtime approve/reject/trust paths unchanged.
- Documents:
  - G1, P-05, AC-66, base/specialists prompt text, validation base and evidence.

## Deliberate exclusions

- No Task-level trust, project switch, UI control, new store state or frontend change.
- No OS sandbox policy change.
- Untracked files inside the active workspace may be deleted without confirmation; user accepted this boundary.
