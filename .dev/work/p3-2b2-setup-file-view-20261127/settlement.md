# Settlement — P3-2b2

Date: 2026-11-27
Status: complete for setup/file-view backend slice
Verification profile: `broad`

- `executeSandboxedSync` added; setup script runs only in an active workspace-write sandbox with `KAIMING_MAIN_WORKTREE` explicitly allowed.
- Task creation passes sandbox runtime; setup failure aborts/cleans provisioning.
- `project.files.list/read` accept optional `taskId`, validate project ownership and read `resolveTaskCwd`.
- Full suite 75/786; typecheck clean.
- Remaining: UI controls, overlap radar, explicit workspace.remove RPC. Workbench stopped.
