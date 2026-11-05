# Plan · task(op=recover) 参数被 schema 拒绝

```yaml
plan:
  task: task-recover-schema-20261031
  goal: 主管能通过 task(op=recover, sessionId, evidenceRefs, resolution) 关闭中断成员输入，解除 Task 的 RECOVERY_REQUIRED。
  requirements:
    - G2 模型工具：recover 接受 taskId、sessionId、evidenceRefs、resolution
    - S7/恢复契约：未核实的中断不能重放，只能核实后关闭
  in_scope:
    - task 工具 schema 补顶层 sessionId
    - 真实模型→Pi→handler 的回归用例
    - 证据记录与缺口登记
  out_of_scope:
    - recover 的错误分支与真实 provider 验证
  tasks:
    - id: schema
      owner: developer
      change: 在 parameters.properties 增加 sessionId（recover 专用描述）
      paths: [devagent/src/tools/task-tools.ts]
      verify: [npx vitest run test/runtime.test.ts -t "closes an interrupted member input"]
    - id: test
      owner: developer
      change: 种 Task + interrupted 成员，stub chief 调用 recover，断言输入变 stopped
      paths: [devagent/test/runtime.test.ts]
      verify: [先失败后通过]
  review_focus: [schema/handler 全 op 一致性, 是否与 sessions[].sessionId 冲突, 用例是否走真实工具环]
  test_plan:
    - npx tsc --noEmit
    - npx vitest run（全量）
    - /tmp 副本删除属性复现失败
  document_impact:
    - docs/technicalnew/gap-register.md（C11）
    - docs/technicalnew/validation.md
  risks:
    - 顶层 sessionId 对其他 op 可见但被忽略，与既有 chiefSessionId/completionResultId 同形
  rollback: 移除该属性即回到旧行为（recover 不可用）
  approval: confirmed
```

## Approval

- 用户报告现场并给出根因与两种处理；选择修工具（方案 A）。
- 生产代码与提交先于 Plan 归档落地（同一会话）。
