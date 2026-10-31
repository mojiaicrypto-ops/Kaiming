# Plan · 主管会话连续性（队列丢消息 + 报告晚到）

```yaml
plan:
  task: chief-session-continuity-20261031
  goal: 用户发给主管的消息不会因 Task 结束被丢弃；成员报告在主管回合已经结束后仍能把主管唤醒一次。
  requirements:
    - R3 共用 Session 执行链路：当前 Task 外的输入保留至其结束；等待点唤醒与报告收尾
    - C-02 主管会话：一个会话同时只推进一项未结束 Task
    - D-03/D-06：报告到达、等待超时不等于暂停；阶段仍由主管显式推进
  in_scope:
    - Store.claimNextInput：已终止 Task 的队列清扫区分“Task 工作”与“主管自己的回合”
    - 宿主级步骤停稳唤醒：成员报告晚到时投递一条 system_notice（每步骤一次）
    - 对应单元与真实进程 E2E 测试、技术契约与验证记录
  out_of_scope:
    - 主管暂停→恢复、queued 输入被停止、恢复确认后的唤醒触发（review F1）
    - 晚到主管消息“真的跑起来”的真实进程 E2E（review F2）
    - interrupted 成员的提示文案与 stale 唤醒通知的清理（review F3/问题 1）
    - 浏览器视觉回归
  tasks:
    - id: queue
      owner: developer
      change: 只关闭真正的 Task 工作；主管 user/system_notice 回合保留并在 Task 结束后投递
      paths: [devagent/src/store/store.ts, devagent/test/store.test.ts, devagent/test/server-write.test.ts]
      verify: [npx vitest run test/store.test.ts test/server-write.test.ts]
    - id: wake
      owner: developer
      change: onOutcome 终态后调用 wakeForSettledStep；按步骤成员输入集合去重；主管忙/非运行/空步骤不投递
      paths: [devagent/src/server/step-wake.ts, devagent/src/server/main.ts, devagent/test/step-wake.test.ts, devagent/test/step-wake-e2e.test.ts]
      verify: [npx vitest run test/step-wake.test.ts test/step-wake-e2e.test.ts]
  review_focus:
    - 清理豁免是否只限主管自己的回合，成员工作仍关闭
    - 唤醒是否会造成自动回合循环或重复通知
    - 与 ask/interaction.respond、暂停/取消门禁的相互影响
  test_plan:
    - npx tsc --noEmit
    - npx vitest run（全量）
    - 真实 startWorkbench + stub 模型的唤醒链路
  document_impact:
    - docs/technicalnew/runtime-contract.md（R3 新增宿主唤醒契约）
    - docs/technicalnew/validation.md（两条验证记录）
    - docs/productnew/modules/delivery.md（D-03 报告晚到的宿主补回合）
    - docs/technicalnew/gap-register.md（C6/C7 登记并关闭）
  risks:
    - 自动唤醒新增模型回合：按步骤去重，最多一步一次；不推进阶段
    - 晚到补充失去 Task 关联：只能作为后续对话，需按新事实决定是否新开 Task
  rollback: 撤掉 onOutcome 中的 wakeForSettledStep 调用即回到“只通知浏览器”；恢复清洗规则即可回到旧行为
  approval: confirmed
```

## Approval

- 用户在本会话报告队列丢消息并要求修补；提供 Aisuangua 现场（`c-mvv6kpir-2230-a9abe0`）。
- 报告晚到问题由用户确认选择方案 A（宿主级“步骤停稳唤醒”，会新增自动模型回合）。
- 生产代码先于本 Plan 产物落地（同一会话内），与上一轮 `session-concurrency` 的处置相同；此处补记授权与范围，便于复核。
