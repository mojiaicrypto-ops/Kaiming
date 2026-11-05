# Test · 看门狗等待计时与 interrupted 成员恢复

两轮独立 Test（独立会话）。第二轮在提交 `b27093d` 上执行。

```yaml
test:
  task: watchdog-wait-and-recovery-20261031
  environment: macOS darwin 25.5.0 arm64; Node v24.8.0; tsc 5.9.3; vitest 3.2.7; cwd devagent/
  runs:
    - command: npx tsc --noEmit
      result: passed
      exit_code: 0
      evidence: no diagnostics
    - command: npx vitest run test/step-wake.test.ts test/runtime.test.ts test/run-watchdog.test.ts test/host-recovery.test.ts --reporter=verbose
      result: passed
      exit_code: 0
      evidence: 4 files / 64 tests；含 "sends an interrupted member to the recovery notice…"、"defers the interrupted-member recovery notice…"、"does not charge the chief for time spent waiting on a dispatched step"
    - command: npx vitest run
      result: passed
      exit_code: 0
      evidence: 49 files / 487 tests passed
    - command: git status --short
      result: passed
      exit_code: 0
      evidence: 第二轮运行时文档尚未提交（预期）；代码均为提交 b27093d，本轮结束后文档随结算提交
  mutation_check:
    - 在 /tmp 的 pristine 副本删除 waiting 谓词中的 host-wait 项：新 runtime 用例失败，输入以 RUN_STALLED 结束；恢复后通过。
    - stall 2000ms / total 300ms 的重调参数下，删除冻结得到 RUN_TIMEOUT；说明两个窗口都被冻结。
  not_covered:
    - area: 陈旧 settleStep 轮询跨回合
      reason: 无直接回归用例；隔离由键构造证明
      disposition: pending
    - area: 启动扫描的 notice-<inputId> 端到端
      reason: 只有 step-wake 路径被测；启动路径结构性复用
      disposition: pending
    - area: 多个 interrupted 成员 / interrupted 状态的 chief
      reason: 未覆盖
      disposition: pending
    - area: 真实 90 分钟窗口、真实模型/浏览器
      reason: 未运行
      disposition: pending
    - area: validation.md 的 WAL 备份现场探针
      reason: 探针未入库；开发阶段手工执行
      disposition: pending
  result: passed
```
