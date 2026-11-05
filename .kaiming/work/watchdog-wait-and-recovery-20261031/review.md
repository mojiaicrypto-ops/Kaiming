# Review · 看门狗等待计时与 interrupted 成员恢复

两轮独立 Review（独立会话，不读开发聊天），均已通过、无阻塞项。

## Round 1（实现整体）

```yaml
review_round_1:
  reviewer_session: WatchdogRecoveryReview
  findings:
    - severity: non-blocking
      id: Q2
      location: devagent/src/runtime/runner.ts（hostWaits）
      evidence: 若只以 sessionId 为键，被中止回合遗留的 settleStep 轮询会在下一次 run 期间继续冻结窗口（≤300s）。
      remediation: 键加入当前 inputId。
    - severity: non-blocking
      id: N1
      location: devagent/src/server/step-wake.ts:87
      evidence: 恢复通知 id 模板在 helper 与 dedupe 两处重复。
      remediation: 导出 interruptedMemberNoticeId。
    - severity: non-blocking
      id: N2
      location: devagent/test/step-wake.test.ts
      evidence: interrupted + 主管忙分支无用例。
      remediation: 补用例。
    - severity: non-blocking
      id: Q1
      location: devagent/src/runtime/runner.ts:136
      evidence: runTotalMs 注释仍承诺 wall-clock。
      remediation: 改为 charged duration 并说明等待不计入。
  result: passed
```

## Round 2（复核修复）

```yaml
review_round_2:
  reviewer_session: RefinementReview
  verified:
    - host-wait 键按 session+input 隔离：settleStep 用进入时的键清除，谓词按当时 liveRuns 取键；旧轮询只触碰旧键。
    - 计数在 entry/finally 对称，异常与超时不泄漏，并发等待同键计数正确。
    - interruptedMemberNoticeId 单一来源且值与旧实现字节一致；启动/运行期共用。
    - 新 chief-busy 用例的门槛断言（notice 不存在）能抓“先入队后判忙”的回归；与兄弟用例共同钉住分支。
    - runTotalMs 注释、R3 契约、C9/C10 与验证记录一致。
  non_blocking_observations:
    - 陈旧轮询跨回合场景没有直接回归用例，隔离由键构造与代码阅读证明。
    - run-watchdog 对 stall 窗口也减去累计 waitedMs 是既有行为，只延迟中止，非本次引入。
  result: passed
```

## 结论

无阻塞项；Review 通过。遗留覆盖缺口见 `test.md` 的 `not_covered`，处置在 `settlement.md`。
