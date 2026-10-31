# Test · dispatch 成员结束后无人接收（含重启）

```yaml
test:
  task: dispatch-outcome-wake-20261031
  environment: macOS darwin 25.5.0 arm64; Node v24.8.0; tsc 5.9.x; vitest 3.2.7; cwd devagent/
  runs:
    - command: npx tsc --noEmit
      result: passed
      exit_code: 0
      evidence: no diagnostics
    - command: npx vitest run test/runtime.test.ts -t "reports a member run the dispatch tool started"
      result: passed
      exit_code: 0
      evidence: 1 passed, 50 skipped (~1.4s)
    - command: npx vitest run test/step-wake-e2e.test.ts
      result: passed
      exit_code: 0
      evidence: 3 tests passed（成员晚到、dispatch 晚到、重启补唤醒）
    - command: npx vitest run
      result: passed
      exit_code: 0
      evidence: 49 files / 491 tests passed
  mutation_checks:
    - 删除 runner 的 onRunSettled 调用：runtime 用例 30s 超时失败。
    - 删除 main 的 onRunSettled 接线：dispatch E2E 3/3 失败（无 notice-step）；恢复后通过。
    - 删除启动扫描：startup E2E 2/2 失败；恢复后通过。
  not_covered:
    - area: 唤醒回合自身失败后的重试
      reason: 未实现
      disposition: pending
    - area: 成员 queued 但 blocked 的巡检
      reason: 未实现
      disposition: pending
    - area: 浏览器视觉与真实 provider
      reason: 未运行
      disposition: pending
  result: passed
```
