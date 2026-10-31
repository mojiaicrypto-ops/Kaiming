# Implementation · task(op=recover) 参数被 schema 拒绝

```yaml
implementation:
  task: task-recover-schema-20261031
  changed:
    - path: devagent/src/tools/task-tools.ts
      purpose: parameters.properties 增加顶层 sessionId（"recover: the member session whose interrupted input is being closed"）
    - path: devagent/test/runtime.test.ts
      purpose: 真实工具环用例「closes an interrupted member input through task(op=recover, sessionId)」：种子 Task + interrupted 成员，stub chief 调 recover，断言成员输入 stopped
  behavior:
    - recover 调用不再被 Pi 的参数校验拒绝；处理函数收到 sessionId、evidenceRefs、resolution
    - 其他 op 不受影响；嵌套 sessions[].sessionId 与顶层同名但不互相遮蔽
  tests_changed:
    - devagent/test/runtime.test.ts
  plan_deviations:
    - 用户描述的“schema 把参数剥掉”实际表现是整次调用被校验拒绝（`sessionId: schema is false`），测试注释已按实证改写
  document_impact:
    - docs/technicalnew/gap-register.md
    - docs/technicalnew/validation.md
  risks_remaining:
    - 顶层 sessionId 对其他 op 可见但被忽略（与既有扁平参数同形）
    - recover 的错误分支与真实 provider 未覆盖
```

## Mechanism

Pi 的 `validateToolArguments` 以工具 `parameters` 为准做 `Compile(...).Check(args)`；`additionalProperties: false` 且未声明 `sessionId` 时，携带该字段的调用在 `execute` 之前就被拒绝，模型收到的是校验错误。因此修复必须以 schema 为准，而不是改 handler 的读取位置。

## Commits

- `a881e3c` fix(task): declare recover sessionId in the task tool schema
