# Implementation · dispatch 成员结束后无人接收（含重启）

```yaml
implementation:
  task: dispatch-outcome-wake-20261031
  changed:
    - path: devagent/src/runtime/runner.ts
      purpose: RunnerOptions.onRunSettled；host.dispatch 等待 runNext(member) 后上报终态
    - path: devagent/src/server/main.ts
      purpose: 抽出 handleOutcome 并同时接 worker.onOutcome 与 runner.onRunSettled；启动时为 active/waiting Task 调用 wakeForSettledStep
    - path: devagent/test/runtime.test.ts
      purpose: harness 支持 onRunSettled；新增 dispatch 成员晚于主管回合结束的用例
    - path: devagent/test/step-wake-e2e.test.ts
      purpose: 两条真实 workbench E2E：dispatch 成员晚于回合结束；重启后已停稳步骤补唤醒
  behavior:
    - dispatch 启动的成员无论主管回合是否已结束，终态都会进入 handleOutcome（invalidate + 唤醒）
    - 重启时对每个 active/waiting 且步骤已停稳的 Task 补一次唤醒；按 notice-step-* 去重
    - worker 与 dispatch 同时抢同一成员时，输的一方得到 busy/idle，handleOutcome 视为无操作，不重复上报
  tests_changed:
    - devagent/test/runtime.test.ts
    - devagent/test/step-wake-e2e.test.ts
  plan_deviations:
    - 首版只修 dispatch 上报；独立 Review 指出 main 接线无覆盖，补真实 workbench E2E
    - 随后补启动扫描，覆盖进程停止期间已停稳的步骤
  document_impact:
    - docs/technicalnew/runtime-contract.md
    - docs/technicalnew/validation.md
    - docs/technicalnew/gap-register.md
  risks_remaining:
    - 唤醒回合自身失败不重试；成员 queued 但 blocked 不巡检；浏览器视觉未跑
```

## Notes

- 真实现场：test 成员 `i-825150fc` 06:36:57 完成，主管回合 06:30:36 已结束；WAL 备份探针 `wakeForSettledStep` 返回 `woken: true`，证明缺口在“没人调用唤醒”，不在唤醒判定。
- 启动扫描在 `scanStartup`、主管 interrupted 关闭、成员恢复通知之后、worker 启动之前执行；`wakeForSettledStep` 自身负责 active/waiting、步骤停稳、主管空闲与去重。

## Commits

- `bbc3d9c` fix(runtime): report dispatch-started member outcomes and wake settled steps on startup
