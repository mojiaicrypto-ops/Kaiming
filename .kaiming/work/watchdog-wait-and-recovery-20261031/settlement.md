# Settlement · 看门狗等待计时与 interrupted 成员恢复

```yaml
settlement:
  task: watchdog-wait-and-recovery-20261031
  stable_facts:
    - 主管在 settleStep 中等待成员的时间不再计入自身 run 的停滞/总时长窗口；模型生成仍计入，runTotalMs 变为“自身工作量”预算。
    - host wait 以 `${sessionId}\0${当前 inputId}` 计数；被中止回合遗留的轮询不会冻结下一回合。
    - interrupted 成员使用与启动扫描相同的 `notice-<成员输入>` 恢复通知：含错误码、结果未知与 `task(op=recover, sessionId, evidenceRefs, resolution)`；不再发“没有正式报告”的通用通知。
    - 现场 `t-cb094c4a` 在 WAL 备份上探针得到 `notice-i-56a31e98`，无通用 `notice-step-*`。
  updated:
    - devagent/src/runtime/runner.ts
    - devagent/src/server/host-recovery.ts
    - devagent/src/server/main.ts
    - devagent/src/server/step-wake.ts
    - devagent/test/runtime.test.ts
    - devagent/test/step-wake.test.ts
    - docs/technicalnew/runtime-contract.md (R3)
    - docs/technicalnew/validation.md
    - docs/technicalnew/gap-register.md (C9、C10 关闭)
  proposed_for_confirmation:
    - 未覆盖：陈旧轮询跨回合无直接回归用例；启动扫描 notice 无端到端；多 interrupted 成员；真实 90 分钟窗口/浏览器。
    - 成员仍保留 90 分钟总时长上限；超限后依赖本次恢复通知，不自动重放。
    - 唤醒回合自身失败不重试、成员 queued 但 blocked 不巡检、孤儿 processing 不检测（均未在本轮范围）。
  indexes_updated: []
  archived:
    - .agentdev/work/watchdog-wait-and-recovery-20261031/plan.md
    - .agentdev/work/watchdog-wait-and-recovery-20261031/implementation.md
    - .agentdev/work/watchdog-wait-and-recovery-20261031/review.md
    - .agentdev/work/watchdog-wait-and-recovery-20261031/test.md
    - .agentdev/work/watchdog-wait-and-recovery-20261031/settlement.md
  no_change:
    - docs/INDEX.md (无新增权威文档)
    - code map (仓库无此资产)
    - docs/productnew/modules/delivery.md (D-03 已描述报告晚到补回合；本次只改计时与通知内容)
    - docs/productnew/acceptance.md (AC-45 已覆盖该行为，无需新增)
    - rules / skills (触发条件未变)
  completion_gate: passed
```

## 结论

Review 两轮 `passed`（无阻塞项）；Test 在提交 `b27093d` 上 49 文件 487 用例、`tsc` 通过，变异测试确认两个窗口都被冻结。未覆盖项已逐条登记，按现有决定记录、不扩大范围。

## Commits

- `b27093d` fix(runtime): stop charging the chief for host waits and recover interrupted members
- docs(work): settle watchdog wait and recovery
