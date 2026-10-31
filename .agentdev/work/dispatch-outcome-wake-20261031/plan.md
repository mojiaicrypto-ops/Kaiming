# Plan · dispatch 成员结束后无人接收（含重启）

```yaml
plan:
  task: dispatch-outcome-wake-20261031
  goal: 由 task(op=dispatch) 启动的成员在主管回合结束后完成时，宿主仍能收到终态并唤醒主管；重启后已停稳的步骤也能补一次主管回合。
  requirements:
    - R3 共用 Session 执行链路：终态上报与步骤停稳唤醒
    - D-06：等待超时/进程重启不是暂停，未知与已停稳都要有后续
    - 现场：`t-cb094c4a` 的 test 成员 `i-825150fc` 06:36:57 完成，主管回合 06:30:36 已结束，无 notice-step
  in_scope:
    - RunnerOptions.onRunSettled：dispatch 启动的成员运行结束后上报
    - main 统一 handleOutcome（worker onOutcome + runner onRunSettled）
    - 启动时为 active/waiting 且步骤已停稳的 Task 补一次唤醒
    - 真实 workbench E2E 覆盖两条路径
  out_of_scope:
    - 唤醒回合自身失败后的重试
    - 成员 queued 但 blocked 的巡检
    - 浏览器视觉
  tasks:
    - id: hook
      owner: developer
      change: host.dispatch 等待 runNext 并调用 onRunSettled
      paths: [devagent/src/runtime/runner.ts, devagent/test/runtime.test.ts]
      verify: [npx vitest run test/runtime.test.ts -t "reports a member run the dispatch tool started"]
    - id: wiring
      owner: developer
      change: 抽出 handleOutcome，同时接 worker 与 runner；启动时扫描已停稳步骤
      paths: [devagent/src/server/main.ts, devagent/test/step-wake-e2e.test.ts]
      verify: [npx vitest run test/step-wake-e2e.test.ts]
  review_focus: [worker/dispatch 竞争是否重复上报, handleOutcome 等价性, 启动扫描的副作用与去重]
  test_plan:
    - npx tsc --noEmit
    - npx vitest run（全量）
    - 变异：删除 onRunSettled / 启动扫描，新 E2E 必须失败
  document_impact:
    - docs/technicalnew/runtime-contract.md（R3 补充 dispatch 终态上报与启动补回合）
    - docs/technicalnew/validation.md
    - docs/technicalnew/gap-register.md（C12/C13）
  risks:
    - 启动时每个已停稳的 active Task 会多一次主管回合（每步骤去重）
  rollback: 撤掉 onRunSettled 接线与启动扫描即回到旧行为
  approval: confirmed
```

## Approval

- 用户报告“依然没有持续推进测试”；属于已确认的宿主唤醒机制的缺口，按现场修复。
- 生产代码与提交先于 Plan 归档落地（同一会话）。
