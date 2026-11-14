# Plan — U11: surface member-run terminal error codes in the webapp (focused)

```yaml
plan:
  task: u11-error-label-20261114
  goal: >
    A failed member's terminal reason is visible in the user's language on the task roster
    (the only place live member state renders), with a raw-code fallback for unknown codes.
    Closes gap-register U11.
  requirements: [U11, AC-1..AC-3 below]
  in_scope:
    - task-labels.ts: TaskMemberRow gains errorCode; a failedNoteOf helper resolves
      error.<CODE> via MESSAGE_KEYS with raw-code and generic-note fallbacks
    - ChatPage.tsx: map the already-served member.errorCode into the row
    - TaskTodo.tsx: failed rows show the resolved label
    - Banner.tsx: adopt the shared key-resolution helper (behavior-preserving)
    - webapp unit test for the label resolution
  out_of_scope:
    - server payload changes (task.get already carries errorCode — read-methods.ts:571)
    - live-data fixtures (a failed member with a catalog code does not exist in the real
      data dir; the focused browser path runs against a throwaway instance with seeded data)
    - the interrupted banner (interrupted inputs are a different state with their own copy)
  tasks:
    - id: T1
      owner: developer
      change: type field + mapping + label helper + roster rendering + Banner refactor
      paths: [webapp/src/chat/task-labels.ts, webapp/src/chat/ChatPage.tsx, webapp/src/chat/TaskTodo.tsx, webapp/src/chat/Banner.tsx]
      verify: [webapp npx tsc --noEmit, webapp npm test]
    - id: T2
      owner: developer
      change: focused browser path on a throwaway workbench instance (temp data dir, seeded
        failed member with REPORT_RETRY_EXHAUSTED), screenshot the roster row
      paths: [webapp build]
      verify: [browser: member row shows the catalog sentence, raw-code fallback for unknown]
  review_focus:
    - the label must never leak an untranslated key to the user
    - completed/queued rows unchanged; Banner blocked behavior unchanged
    - no server change (errorCode already served) — verify that claim, not assume it
  test_plan: [webapp npm test, tsc both, focused browser path]
  document_impact: [docs/technicalnew/gap-register.md U11 → closed]
  risks: [low — one rendering branch; fallback keeps unknown codes visible]
  rollback: revert the four webapp files
  approval: user instruction "启动U11，更改" (2026-11-14); shown per D-02 default

acceptance:
  - AC-1: failed member with errorCode REPORT_RETRY_EXHAUSTED renders the catalog sentence
    (zh: 报告连续失败，重试预算已用尽，运行已终止); unknown code renders the raw code.
  - AC-2: failed member without errorCode keeps the generic failed label.
  - AC-3: completed/queued rows and the blocked banner render exactly as before.

verification profile: focused
```
