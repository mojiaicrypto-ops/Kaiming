# Settlement — P3-3b workspace removal/badge

Date: 2026-11-27
Status: partial backend/UI badge complete
Verification profile: `broad`

- `task.workspace.remove` RPC validates terminal Task/ownership/revision; merged deletes branch, branch_kept retains it, then marks workspaceState removed.
- TaskStrip shows the worktree branch / branch kept badge from task summary fields.
- Server task summary exposes workspaceState/worktreeRoot/workspacePath/branchName.
- Full suite 75/786; server and webapp typecheck clean.
- Remaining: cleanup button wiring, cross-task overlap radar, waiting-user quota reacquisition. Workbench stopped.
