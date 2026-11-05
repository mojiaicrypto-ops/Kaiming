# Settlement · dispatch 成员结束后无人接收（含重启）

```yaml
settlement:
  task: dispatch-outcome-wake-20261031
  stable_facts:
    - 由 task(op=dispatch) 直接启动的成员运行与 Dispatcher 启动的运行必须走同一终态处理；否则回合结束后的结果不会刷新界面，也不会触发步骤停稳唤醒。
    - worker 与 dispatch 竞争同一成员时只有一个赢家；输家的 busy/idle 不产生任何副作用；唤醒按 notice-step-* 幂等。
    - 工作台启动时会对每个 active/waiting Task 评估一次步骤停稳唤醒；paused/completed 与未停稳步骤不投递，重复重启不重复通知。
    - 现场 `t-cb094c4a`：test 成员 i-825150fc 06:36:57 完成、主管回合 06:30:36 已结束、无 notice-step；修复后重启即可补一次唤醒。
  updated:
    - devagent/src/runtime/runner.ts
    - devagent/src/server/main.ts
    - devagent/test/runtime.test.ts
    - devagent/test/step-wake-e2e.test.ts
    - docs/technicalnew/runtime-contract.md (R3)
    - docs/technicalnew/validation.md
    - docs/technicalnew/gap-register.md (C12、C13)
  proposed_for_confirmation:
    - 未覆盖：唤醒回合自身失败后的重试、成员 queued 但 blocked 的巡检、浏览器视觉/真实 provider。
  indexes_updated: []
  archived:
    - .agentdev/work/dispatch-outcome-wake-20261031/plan.md
    - .agentdev/work/dispatch-outcome-wake-20261031/implementation.md
    - .agentdev/work/dispatch-outcome-wake-20261031/review.md
    - .agentdev/work/dispatch-outcome-wake-20261031/test.md
    - .agentdev/work/dispatch-outcome-wake-20261031/settlement.md
  no_change:
    - docs/INDEX.md (无新增权威文档)
    - code map (仓库无此资产)
    - docs/productnew/modules/delivery.md (D-03/AC-45 已覆盖宿主补回合，本次只补齐触发路径)
    - rules / skills (触发条件未变)
  completion_gate: passed
```

## 结论

三轮独立 Review `passed`；全量 49 文件 491 用例、`tsc` 通过；三处变异均按预期失败。部署需要重启 workbench；重启后启动扫描会为当前已停稳的 test 步骤投递 `notice-step-*`，主管据此推进到结算。

## Commits

- `bbc3d9c` fix(runtime): report dispatch-started member outcomes and wake settled steps on startup
- docs(work): settle dispatch outcome wake
