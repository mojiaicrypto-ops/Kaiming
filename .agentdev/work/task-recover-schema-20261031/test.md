# Test · task(op=recover) 参数被 schema 拒绝

```yaml
test:
  task: task-recover-schema-20261031
  environment: macOS darwin 25.5.0 arm64; Node v24.8.0; tsc 5.9.x; vitest 3.2.7; cwd devagent/
  runs:
    - command: npx tsc --noEmit
      result: passed
      exit_code: 0
      evidence: no diagnostics
    - command: npx vitest run test/runtime.test.ts -t "closes an interrupted member input"
      result: passed
      exit_code: 0
      evidence: 1 passed, 49 skipped
    - command: npx vitest run
      result: passed
      exit_code: 0
      evidence: 49 files / 488 tests passed
    - command: git status --short / git diff --stat
      result: passed
      exit_code: 0
      evidence: 仅 task-tools.ts 与 runtime.test.ts；无关未跟踪文件未触碰
  mutation_check:
    - /tmp 副本删除 sessionId 属性：目标用例失败（成员输入保持 interrupted），Pi 报 "Validation failed for tool task: sessionId: schema is false / must not have additional properties"。
    - 恢复属性后同一用例通过。
  not_covered:
    - area: recover 的错误分支（缺证据/非成员/非 interrupted）
      reason: 未通过工具环覆盖
      disposition: pending
    - area: recovery 证据落库字段
      reason: 只断言输入状态
      disposition: pending
    - area: 真实 provider 路径与浏览器
      reason: 未运行
      disposition: pending
  result: passed
```
