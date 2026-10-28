# Settlement · write-task-investigation-report-20261028

```yaml
settlement:
  task: write-task-investigation-report-20261028
  status: completed
  stable_facts:
    - write Task 可包含 investigator 的 investigation/recovery 只读证据；报告由 agent_report 保存，不需要项目写工具或 writeScope
    - investigation/recovery 报告始终写 Server work/<taskId>/<sessionId>/，不落入项目 .dev/work，也不能作为 write Task 的完成报告
    - write Task 完成仍只认 settlement；只读报告不改变 completionGaps
  updated:
    - devagent/src/store/store.ts
    - devagent/src/runtime/report-store.ts
    - devagent/src/server/read-methods.ts          # 注释：Server 报告不可按路径打开
    - devagent/test/report.test.ts
    - docs/technicalnew/agents-and-tools.md
    - docs/technicalnew/storage-and-recovery.md
    - docs/technicalnew/prompts/chief.md
    - docs/technicalnew/prompts/investigator.md
    - docs/technicalnew/validation.md
  evidence:
    - test/report.test.ts：write + investigator + investigation（passed/blocked）均记录，storage=server，项目目录不存在，完成仍要 settlement
    - npm run typecheck 通过；服务端 45 文件 471 用例通过
    - webapp 12 文件 80 用例、构建与浏览器 59 用例通过
  risks_remaining:
    - 未在真实模型会话中重跑；已用 runtime 脚本化 Pi 循环覆盖 create→dispatch→agent_report 全链路
  completion_gate: passed
```
