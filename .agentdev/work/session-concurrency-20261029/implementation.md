# Implementation · 同项目会话并发

```yaml
implementation:
  task: session-concurrency-20261029
  changed:
    - path: devagent/src/server/worker.ts
      purpose: start every session without an in-flight run; one run per session; idle outcomes do not wake; stop waits; per-session errors are isolated.
    - path: devagent/src/runtime/pi-runtime.ts
      purpose: share one in-flight ModelRuntime creation between concurrent first runs; failed creation is retryable.
    - path: devagent/src/server/main.ts
      purpose: log worker errors once per session+reason; clear on the next outcome.
    - path: devagent/test/worker.test.ts
      purpose: concurrent start, no same-session reentry, stop waits, error isolation.
    - path: devagent/test/runtime-factory.test.ts
      purpose: concurrent runtime() calls return the same ModelRuntime.
    - path: devagent/test/server-write.test.ts
      purpose: fix the test waiter so an unrelated idle outcome cannot discard a pending waiter.
  behavior:
    - A second session's queued message starts while the first run is still in flight.
    - The store still allows at most one processing input per session.
    - Deleting an unrelated session's run does not block or replace another.
  tests_changed:
    - devagent/test/worker.test.ts
    - devagent/test/runtime-factory.test.ts
    - devagent/test/server-write.test.ts
  plan_deviations:
    - Production change preceded the compact Plan artifact; recorded transparently.
  document_impact: [docs/technicalnew/validation.md]
  risks_remaining:
    - No real HTTP/worker two-chief-session E2E.
    - The documented professional concurrency cap is still not enforced in code.
```
