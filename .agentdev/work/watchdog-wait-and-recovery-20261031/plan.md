# Plan · 看门狗等待计时与 interrupted 成员恢复

```yaml
plan:
  task: watchdog-wait-and-recovery-20261031
  goal: 长任务的协调回合不再被 90 分钟看门狗中止；成员被看门狗中止后，主管收到可执行的恢复通知而不是“没有正式报告”的通用提醒。
  requirements:
    - R3 共用 Session 执行链路：等待点、终态与唤醒
    - D-06 可见进展与用户控制：未知执行结果必须核实，不重放
    - 现场：`t-cb094c4a`（dev `i-56a31e98` RUN_TIMEOUT，主管 02:42 已结束）
  in_scope:
    - settleStep 期间标记 host wait，run watchdog 不计入主管等待
    - interrupted 成员复用启动扫描的恢复通知（notice-<inputId>，含 task(op=recover)）
    - 单元/运行时测试、R3 契约与验证记录、缺口登记
  out_of_scope:
    - 唤醒回合自身失败后的重试
    - 成员 queued 但 blocked（缺模型/目录）的巡检
    - 孤儿 processing 输入检测
    - 浏览器视觉
  tasks:
    - id: watchdog
      owner: developer
      change: settleStep 以 session+input 标记 host wait；waiting 谓词覆盖它
      paths: [devagent/src/runtime/runner.ts, devagent/test/runtime.test.ts]
      verify: [npx vitest run test/runtime.test.ts]
    - id: recovery
      owner: developer
      change: 抽出 queueInterruptedMemberNotice；step-wake 对 interrupted 成员改投恢复通知
      paths: [devagent/src/server/host-recovery.ts, devagent/src/server/main.ts, devagent/src/server/step-wake.ts, devagent/test/step-wake.test.ts]
      verify: [npx vitest run test/step-wake.test.ts test/host-recovery.test.ts]
  review_focus: [host wait 计数平衡与跨回合隔离, 通知去重与启动/运行期一致, 是否引入无限主管回合]
  test_plan:
    - npx tsc --noEmit
    - npx vitest run（全量）
    - WAL 备份现场探针（t-cb094c4a 应得到 notice-i-56a31e98）
  document_impact:
    - docs/technicalnew/runtime-contract.md R3
    - docs/technicalnew/validation.md
    - docs/technicalnew/gap-register.md（C9/C10 关闭）
  risks:
    - 主管等待不计入后，runTotalMs 变为“模型自身工作量”预算
    - 成员仍保留 90 分钟总时长上限；超限后依赖恢复通知
  rollback: 删除 hostWaits 标记或撤回 step-wake 的 interrupted 分支即可回到旧行为
  approval: confirmed
```

## Approval

- 用户确认方案：「主管等待不计时 + C9 恢复通知」。
- 生产代码与提交先于本 Plan 归档落地（同一会话），与既有工作包处置一致。
