# Implementation · 主管会话连续性

```yaml
implementation:
  task: chief-session-continuity-20261031
  changed:
    - path: devagent/src/store/store.ts
      purpose: claimNextInput 的已终止 Task 清扫只关闭 Task 工作；该 Task 主管会话自己的 user/system_notice 回合保留并投递；TASK_CONTROLLED 门禁同样放行终态 Task 的主管回合（陈旧指针防御）
    - path: devagent/src/server/step-wake.ts
      purpose: 新增 wakeForSettledStep：Task active/waiting、当前步骤成员无 queued/processing、主管无 queued/processing/interrupted、步骤未通知过时，投递一条 system_notice；id = notice-step-<taskId>-<成员输入集合散列>
    - path: devagent/src/server/main.ts
      purpose: onOutcome 在 completed/failed/stopped/interrupted 后推导 Task（input.taskId → currentTaskId）并调用唤醒；异常隔离只写日志
    - path: devagent/test/store.test.ts
      purpose: 改为断言引用已取消 Task 的主管迟到回合被投递
    - path: devagent/test/server-write.test.ts
      purpose: 改为断言主管消息在 Task 取消后仍被 claim 并运行；新增成员工作仍以 TASK_ENDED 关闭
    - path: devagent/test/step-wake.test.ts
      purpose: 唤醒/可 claim/按步骤去重/成员未停稳/主管忙/非运行/空步骤/失败成员 6 例
    - path: devagent/test/step-wake-e2e.test.ts
      purpose: 真实 startWorkbench + stub 模型：成员跑完 → 宿主写 notice-step-* → worker 认领并跑完主管回合
  behavior:
    - 用户消息不再因为其关联 Task 先结束而消失；它作为主管回合在会话空出后运行
    - 主管回合结束后到达的成员报告，会触发一次主管回合（每步骤一次），通知只陈述事实与结果 id，不推进阶段、不判完成
    - 主管仍在运行、Task 非 active/waiting、步骤仍有成员在跑、或该步骤已通知时不投递
  tests_changed:
    - devagent/test/store.test.ts
    - devagent/test/server-write.test.ts
    - devagent/test/step-wake.test.ts
    - devagent/test/step-wake-e2e.test.ts
  plan_deviations:
    - 生产代码先于 Plan 归档落地（同一会话）；已在 plan.md 记录
  document_impact:
    - docs/technicalnew/runtime-contract.md
    - docs/technicalnew/validation.md
    - docs/productnew/modules/delivery.md
    - docs/technicalnew/gap-register.md
  risks_remaining:
    - 暂停→恢复、queued 停止、恢复确认不会触发唤醒（review F1，未实现）
    - 唤醒通知在 Task 于认领前结束时会照样运行一次（review 问题 1，已登记）
    - interrupted 成员的提醒文案未包含 task(op=recover) 指引（review F3）
```

## Notes

- 唤醒与 `settleStep` 使用同一个“停稳”谓词：成员输入不在 `queued`/`processing` 即视为停稳；`waiting_user` 仍是 `processing`，因此不会被误唤醒。
- 通知通过既有 `session.input.submit` 同一条 claim 路径进入主管会话，没有第二套执行通道；主管会话的 `user/system_notice` 豁免使它在 Task active 时也能被认领。
- 通知正文不点名内部 RPC，只给 Task、阶段、结果 id 与“宿主没有推进任何东西”。

## Commits

- `7b8d9bc` fix(store): deliver the chief's queued turn after its Task ends
- `d5f4e53` fix(server): wake the chief when a step settles after its turn ended
