# Review · 同项目会话并发

独立只读复核（独立上下文；不读开发对话），最终工作树包含复核后的去重与测试补充。

```yaml
review:
  task: session-concurrency-20261029
  reviewer_session: delegated read-only review subagent
  reviewer_model: group-volc-plan/group/auto-deepseek-v4-1-flash
  context_snapshot: >
    HEAD 7d46d16 + working tree: worker.ts, pi-runtime.ts, main.ts,
    worker.test.ts, runtime-factory.test.ts, server-write.test.ts; store claim,
    runner.runNext, task dispatch, REL-03/A3/M2 contracts.
  findings:
    - severity: non-blocking
      location: devagent/src/server/main.ts:onError
      evidence: repeated rejection logged every idle pass (4/sec/session)
      impact: unbounded repeated stderr
      remediation: dedupe by session+detail and clear on any outcome
    - severity: non-blocking
      location: devagent/test/worker.test.ts
      evidence: stop-wait, error isolation and runtime retry branches were not covered
      impact: regressions in stop/error isolation could pass the suite
      remediation: add gated stop and one-error tests; accept runtime retry as unexercised without a seam
```
Follow-up review: **passed**. `onError` dedupe is per server and cleared before every outcome branch; stop test fails if `Promise.allSettled` is removed; error test fails if the per-session catch is removed. The dead `if (!worker.stop)` line was replaced with `await worker.stop()`. The runtime retry branch remains unexercised by design (no seam without mocking `ModelRuntime.create`).

Open design questions (non-blocking): the documented professional concurrency cap is not enforced, and `runtimePromise === promise` is a local-invariant nicety rather than a reachable race.

Result: **passed**, no blocking findings.
