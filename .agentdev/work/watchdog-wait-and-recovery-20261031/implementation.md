# Implementation · 看门狗等待计时与 interrupted 成员恢复

```yaml
implementation:
  task: watchdog-wait-and-recovery-20261031
  changed:
    - path: devagent/src/runtime/runner.ts
      purpose: hostWaits 以 `${sessionId}\0${当前 inputId}` 计数；promptWithWatchdog 的 waiting 同时看它；settleStep 标记/清除并接收主管 sessionId；runTotalMs 注释改为“计入的时长”
    - path: devagent/src/server/host-recovery.ts
      purpose: queueInterruptedMemberNotice + interruptedMemberNoticeId；启动扫描与运行期唤醒共用同一 id 与文案（错误码、结果未知、task(op=recover) 指引）
    - path: devagent/src/server/main.ts
      purpose: 启动扫描改用共享 helper
    - path: devagent/src/server/step-wake.ts
      purpose: 当前步骤含 interrupted 成员时只投恢复通知，不投通用步骤通知；主管忙时延后
    - path: devagent/test/runtime.test.ts
      purpose: 新增“主管等待不被看门狗计入”（total 500ms / stall 600ms，成员 900ms 后完成）
    - path: devagent/test/step-wake.test.ts
      purpose: interrupted 成员的通知 id/文案/去重/可 claim；主管忙时延迟
  behavior:
    - 主管回合在 settleStep 中等待成员时，看门狗的停滞与总时长窗口都暂停；模型自身生成仍计入
    - 等待键包含 inputId：上一个回合遗留的轮询不会冻结下一个回合的窗口
    - 成员 interrupted 时通知直接给出 RUN_TIMEOUT 等错误码、结果未知与 recover 调用样例
  tests_changed:
    - devagent/test/runtime.test.ts
    - devagent/test/step-wake.test.ts
  plan_deviations:
    - 首次实现以 session 为键；独立 Review Q2 指出跨回合冻结风险，改为 session+input 键
    - 独立 Review N1 指出 id 模板重复，抽出 interruptedMemberNoticeId
    - 独立 Review N2 补充“interrupted + 主管忙”用例
  document_impact:
    - docs/technicalnew/runtime-contract.md
    - docs/technicalnew/validation.md
    - docs/technicalnew/gap-register.md
  risks_remaining:
    - 主管等待不计入后，runTotalMs 只约束模型自身工作量；成员仍各有 90 分钟上限
    - 唤醒回合自身失败不重试；成员 queued 但 blocked 与孤儿 processing 未巡检（见缺口登记）
```

## Notes

- 等待键的取值在 `promptWithWatchdog` 与 `settleStep` 中一致：`liveRuns` 在 run 开始、prompt 之前写入，因此计时谓词与标记看到同一个 inputId。
- 恢复通知沿用 `notice-<成员输入>`；启动扫描与运行期谁先写入，另一个自然去重。切换 `requestKey` 前会先检查该行是否存在。
- 通知文本保持与 `guidanceFor` 的恢复指引一致：先核实证据，再 `task(op=recover)`，不假设已完成。

## Commits

- `b27093d` fix(runtime): stop charging the chief for host waits and recover interrupted members
