# Plan · 同项目会话并发

```yaml
plan:
  task: session-concurrency-20261029
  goal: >
    A session's message must start even while another session in the same project is running;
    one run per session, not one run per server.
  requirements: [REL-03, A3 server continues other sessions, M2 per-session one prompt]
  in_scope:
    - worker scheduling across sessions
    - one shared ModelRuntime creation for concurrent first runs
    - worker error isolation and log dedupe
    - regression tests
  out_of_scope:
    - professional-session concurrency cap (existing documented but unenforced gap)
    - UI changes
    - Task/phase semantics
  tasks:
    - id: T1
      owner: developer
      change: worker starts independent sessions concurrently, one in-flight run per session
      paths: [devagent/src/server/worker.ts]
      verify: [npx vitest run test/worker.test.ts]
    - id: T2
      owner: developer
      change: memoize in-flight runtime creation; dedupe worker errors
      paths: [devagent/src/runtime/pi-runtime.ts, devagent/src/server/main.ts]
      verify: [npx vitest run test/runtime-factory.test.ts]
    - id: T3
      owner: reviewer
      change: independent review of concurrency, races, stop and error paths
      verify: [review report]
    - id: T4
      owner: tester
      change: execute targeted and full checks
      verify: [npm run typecheck, npx vitest run, npm run build]
  review_focus:
    - one run per session; independent starts
    - no spin, stop waits for in-flight runs
    - shared runtime; error isolation
  test_plan:
    - worker unit tests with gated fake runs
    - runtime factory concurrent calls
    - server write harness; full suite
  document_impact: [docs/technicalnew/validation.md]
  risks:
    - no real HTTP/worker E2E with two chief sessions
    - professional concurrency cap remains unenforced (existing gap)
  rollback: revert the worker/runtime commits
  approval: >
    User reported the two-session block as severe and asked for investigation on 2026-10-29;
    compact plan recorded at implementation time.
```
