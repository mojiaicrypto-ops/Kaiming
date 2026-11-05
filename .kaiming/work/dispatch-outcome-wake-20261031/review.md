# Review · dispatch 成员结束后无人接收（含重启）

三轮独立 Review（独立会话，不读开发聊天），全部 `passed`。

```yaml
review_round_1:
  reviewer_session: DispatchOutcomeReview
  verified:
    - handleOutcome 与旧内联 onOutcome 逐语句等价（53 行零差异），闭包状态齐全，无 TDZ。
    - onRunSettled 只在 chief 的 host.dispatch 绑定中出现；成员运行才可达。
    - worker/dispatch 抢同一成员：claim 事务只允许一个赢家；输家 busy/idle 在 handleOutcome 中无副作用；唤醒按步骤 id 幂等。
    - 新 runtime 用例删除 hook 后 30s 超时失败。
  finding:
    - severity: P3
      issue: main.ts 的 onRunSettled 接线无测试覆盖；删除后全量仍绿。
      remediation: 真实 workbench E2E（chief dispatch + 短 wait + 慢成员）。
review_round_2:
  reviewer_session: DispatchE2EReview
  verified:
    - 新 E2E 的成员运行确为 dispatch-owned（插桩显示 worker 四次 busy，dispatch 完成后 handleOutcome 唤醒）。
    - 删除 main 接线：2/2 失败且无 notice-step；恢复后 2/2 通过；8 核满载下变异仍失败。
    - 断言包含 notice 内容、Task 未推进；启动路径不能误产生该通知。
  result: passed
review_round_3:
  reviewer_session: StartupSweepReview
  verified:
    - 扫描位置在恢复通知之后、worker 启动之前；active/waiting/停稳/主管空闲/去重均由 wakeForSettledStep 把关。
    - 实测 completed/paused/成员仍 queued 的 Task 只产生读操作，无通知无模型请求；第二次重启不重复通知；与 live 路径叠加只有一个 notice-step。
    - 删除启动扫描后新 E2E 2/2 失败，恢复后 2/2 通过。
    - 非阻塞小项：每个 Task 多一次 getTask 读（启动期）；日志空括号（woken 时 noticeId 恒存在）。
  result: passed
```

## 结论

无阻塞项。Review 1 的覆盖缺口已用真实 workbench E2E 关闭，并由 Review 2/3 用变异与插桩独立确认。
