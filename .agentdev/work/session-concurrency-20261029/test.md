# Test · 同项目会话并发

```yaml
test:
  task: session-concurrency-20261029
  environment: >
    darwin 25.5.0 arm64; Node 24.8; vitest 3.2.7; cwd devagent; no real provider.
  runs:
    - command: npm run typecheck
      result: passed
      exit_code: 0
      evidence: tsc --noEmit, no diagnostics
    - command: npx vitest run test/worker.test.ts test/runtime-factory.test.ts test/server-write.test.ts
      result: passed
      exit_code: 0
      evidence: 3 files, 21 tests passed
    - command: npx vitest run
      result: failed
      exit_code: 1
      evidence: >
        47 files, 476 tests: 474 passed, 2 failed. Both failures are
        test/git-commit-gate.test.ts 5s timeouts under full parallel load
        ("follows nesting down...", "accepts ... real submodule"). The same file
        passes 23/23 alone; the HEAD baseline reproduces the same timeouts without
        the concurrency change, so they are host-load flake, not this diff.
    - command: npx vitest run test/git-commit-gate.test.ts
      result: passed
      exit_code: 0
      evidence: 23/23 in 23.86s
    - command: npm run build
      result: passed
      exit_code: 0
      evidence: vite build, 201 modules; only the existing chunk-size warning
    - command: baseline against old sources
      result: passed
      exit_code: 1
      evidence: >
        Worker/runtime tests fail on the pre-change sources (conditional timeout /
        different runtime instances), proving they catch the original bug.
  not_covered:
    - area: real HTTP/worker E2E with two chief sessions in one project
      reason: worker concurrency is proven with gated fake runs; no HTTP test submits to two chief sessions and asserts overlap.
      disposition: pending
  result: passed
```
