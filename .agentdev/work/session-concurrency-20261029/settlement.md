# Settlement · 同项目会话并发

```yaml
settlement:
  task: session-concurrency-20261029
  stable_facts:
    - Sessions are independent: the worker starts a second session while the first run is in flight; the store still permits one processing input per session.
    - A concurrent first run shares one ModelRuntime creation; a failed creation is retryable.
    - A per-session runner failure is isolated and logged once per session+reason, not once per idle pass.
    - stop() waits for all in-flight runs before returning.
  updated:
    - devagent/src/server/worker.ts
    - devagent/src/runtime/pi-runtime.ts
    - devagent/src/server/main.ts
    - devagent/test/worker.test.ts
    - devagent/test/runtime-factory.test.ts
    - devagent/test/server-write.test.ts
    - docs/technicalnew/validation.md
  proposed_for_confirmation:
    - Enforce the documented professional-session concurrency cap (still unenforced; not part of this bug).
    - Accept the E2E gap: two real chief sessions over HTTP are not exercised.
  indexes_updated: []
  archived:
    - .agentdev/work/session-concurrency-20261029/plan.md
    - .agentdev/work/session-concurrency-20261029/implementation.md
    - .agentdev/work/session-concurrency-20261029/review.md
    - .agentdev/work/session-concurrency-20261029/test.md
    - .agentdev/work/session-concurrency-20261029/settlement.md
  no_change:
    - docs/productnew/modules/delivery.md (contract already says server serves other sessions)
    - docs/technicalnew/architecture.md (A3 already says server continues other sessions)
    - docs/INDEX.md (no new authoritative document)
    - code map (no such asset)
  completion_gate: pending
```

## Pending

- Real HTTP/worker E2E: submit to two chief sessions in one project and observe overlap. Worker unit tests prove the scheduling, but not the full server surface.
- Professional concurrency cap remains unenforced in code; documented as a separate gap.

## Commits

- fix(server): run sessions independently in the worker
- docs(work): settle session concurrency
