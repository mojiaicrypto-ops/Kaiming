# Review · task(op=recover) 参数被 schema 拒绝

```yaml
review:
  task: task-recover-schema-20261031
  reviewer_session: RecoverSchemaReview (independent; no development chat)
  verified:
    - Pi 的校验路径（pi-agent-core -> pi-ai validateToolArguments）：schema 不符时调用在 execute 前被拒绝，模型收到 schema 错误；修正后参数原样到达 handler。
    - 逐 op 审计 schema 与 handler 读取：create/update/dispatch/control/end/get/adopt/recover 全部一致，无其他缺项；嵌套 sessions[].sessionId 与顶层 sessionId 不冲突。
    - 新用例走真实 stub 模型 -> Pi -> handler，不是直接调用处理函数；删除该属性后断言失败（输入保持 interrupted）。
    - 默认 phase 'plan' 与成员 phase 一致，createTaskSessions 设置 currentInputId，recoverOp 前置条件成立。
  notes:
    - 顶层 sessionId 对其他 op 可见但被忽略，与 chiefSessionId/completionResultId/includeResultBodies 同形。
    - 用例未断言 recovery 证据是否落库（状态断言是承重项）。
  result: passed
```

## 结论

无阻塞项；Review 通过。全 op 审计未发现第二处同类缺陷。
