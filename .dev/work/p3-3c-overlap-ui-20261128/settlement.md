# Settlement — P3-3c overlap warning and cleanup UI

Date: 2026-11-28
Status: complete for overlap warning + cleanup button/badge
Verification profile: `broad`

- Task creation compares the new Plan's declared scope with every other open write Task's Plan and returns `warnings` (non-blocking).
- TaskDrawer offers `task.workspace.remove` for terminal Tasks with a retained branch; TaskStrip shows the worktree/branch-kept badge.
- Server 75/786, webapp 146/146, both typechecks clean.
- Remaining: waiting_user quota reacquisition and FileViewer task switching are not fully wired.
