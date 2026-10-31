# Review · 主管会话连续性

```yaml
review:
  task: chief-session-continuity-20261031
  reviewer_session: StepWakeReview (separate agent context; no development chat)
  reviewer_model: reviewer profile (independent session)
  context_snapshot:
    files:
      - devagent/src/store/store.ts (claimNextInput)
      - devagent/src/server/step-wake.ts (new)
      - devagent/src/server/main.ts (onOutcome wiring)
      - devagent/src/runtime/runner.ts (settleStep predicate, read-only)
      - devagent/src/server/write-methods.ts (interaction.respond, read-only)
      - tests + docs touched by the task
    commands: [git diff, npx vitest run (targeted), npx vitest run (full), npx tsc --noEmit]
  findings:
    - severity: non-blocking
      location: devagent/src/server/main.ts:303-317 (only wake call site)
      evidence: 唤醒只在 run outcome 后评估；pause→resume、queued 输入被停止、session.recovery.resolve 都不产生 outcome，实测 resume 后主管无输入且 wake 条件已满足。
      impact: 用户在步骤中途暂停再恢复后，主管仍要等用户发消息才推进。
      remediation: 在 task.control resume 成功、queued 停止、恢复确认后同样调用 wakeForSettledStep（沿用 onOutcome 的 try/catch）。
    - severity: non-blocking
      location: devagent/test/server-write.test.ts:776-790, devagent/test/store.test.ts:461-471
      evidence: 修复 1 只在 claim 边界被钉住；harness 无 stub 模型，没有真实主管回合。runner 在 claim 后不再检查 Task 终态，所以当前风险低。
      impact: 未来若在运行期加 Task 终态门禁，会在没有失败用例的情况下回归。
      remediation: 仿 step-wake-e2e 增加“引用已取消 Task 的 queued 主管消息在真实 workbench 中跑完”的用例。
    - severity: non-blocking
      location: devagent/src/server/step-wake.ts:67-71, 89-100
      evidence: interrupted 成员被视为停稳，通知却写“no unfinished member work / no formal report”，而完成与切阶段都会拒绝，正确处置是 task(op=recover)。
      impact: 通知可能把主管引向会被拒绝的操作，并误导“没有报告”。
      remediation: 通知中列出 interrupted 成员输入，并说明先用 task(op=recover, sessionId, evidenceRefs, resolution) 关闭。
  questions:
    - 通知被接纳后 Task 在认领前完成/取消时，通知仍会运行一次“Continue the Task”（已实测 claim 成功）。是否要在认领时丢弃？
    - CHIEF_BUSY 计入任何 queued 主管输入（包括引用旧 Task、当前不可 claim 的），极窄竞态下会推迟新 Task 的唤醒。是否要忽略当前 Task 不可 claim 的输入？
    - 通知回合自身 failed/stopped 不会再发（id 已存在），是否接受由用户消息恢复？
    - 主管已消费结果但故意不派发下一歩时也会多一次提醒回合（每步骤一次），是否接受？
  result: passed
```

## 已核对且无问题

- 豁免范围：只有 `chiefSessionId === sessionId` 且 `kind ∈ {user, system_notice}`；成员 `delegation`/`continuation` 仍关闭；`processing`/`interrupted` 前置检查与 `controlled` 回退未被绕过。
- 唤醒谓词与 `settleStep` 一致（成员集合、`queued`/`processing`）；去重键对输入顺序不敏感；重复调用返回 `already-notified`；暂停/取消/完成/空步骤均不投递。
- 循环风险有界：一步一条通知；再次通知需要新的成员输入集合（真实工作）。
- wiring 只在四种终态 outcome 内，taskId 推导对成员/主管都正确，异常被隔离；`progressed → notify()` 保证通知能被认领。
- `interaction.respond` 只写 `interactions` 表并唤醒原调用，不生成输入；待答问题让输入保持 `processing`，两条改动都不会碰它。
- 改动前的失败用例现在通过（`store.test.ts:461`、`server-write.test.ts:745` 的旧断言被替换）。

## 结论

无阻塞项，Review 通过。F1–F3 与四个问题作为待决定项进入 Settlement。
