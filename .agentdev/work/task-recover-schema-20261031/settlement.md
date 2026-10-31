# Settlement · task(op=recover) 参数被 schema 拒绝

```yaml
settlement:
  task: task-recover-schema-20261031
  stable_facts:
    - task 工具的 parameters 必须声明 handler 会读取的每个顶层字段；本仓库通过 Pi 的 schema 校验后才进入 execute。
    - recover 的合法调用为 task(op=recover, taskId?, sessionId, evidenceRefs, resolution)；taskId 缺省时取会话当前 Task。
    - 顶层 sessionId 只被 recover 读取；dispatch 的成员 sessionId 在 sessions[] 内。
  updated:
    - devagent/src/tools/task-tools.ts
    - devagent/test/runtime.test.ts
    - docs/technicalnew/gap-register.md (C11)
    - docs/technicalnew/validation.md
  proposed_for_confirmation:
    - recover 错误分支、recovery 证据落库断言、真实 provider 路径未覆盖。
  indexes_updated: []
  archived:
    - .agentdev/work/task-recover-schema-20261031/plan.md
    - .agentdev/work/task-recover-schema-20261031/implementation.md
    - .agentdev/work/task-recover-schema-20261031/review.md
    - .agentdev/work/task-recover-schema-20261031/test.md
    - .agentdev/work/task-recover-schema-20261031/settlement.md
  no_change:
    - docs/technicalnew/agents-and-tools.md (G2 早已写明 recover 的 sessionId 参数)
    - docs/INDEX.md (无新增权威文档)
    - code map (仓库无此资产)
    - rules / skills (触发条件未变)
  completion_gate: passed
```

## 结论

Review `passed`（含全 op schema/handler 审计）；Test 49 文件 488 用例、`tsc` 通过，变异复现证明用例承重。修复提交后需要**重启 devagent 进程**才能让运行中的主管拿到新 schema。

## Commits

- `a881e3c` fix(task): declare recover sessionId in the task tool schema
- docs(work): settle task recover schema
