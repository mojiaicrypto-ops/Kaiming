# Settlement Report · devagent-p1-store-dispatcher-20261005

```yaml
settlement:
  task: devagent-p1-store-dispatcher-20261005
  stable_facts:
    - "存储内核（node:sqlite，无原生依赖）：打开即校验 WAL / synchronous=FULL / foreign_keys=ON；user_version=1；四张表 projects/sessions/session_inputs/request_receipts"
    - "接纳：请求摘要含 method/projectId/sessionId/taskId/kind/payload；同 key 同参数复用原结果，任一归属不同即 REQUEST_CONFLICT；会话内 seq 递增；queued 与回执同事务写入"
    - "认领：「同会话至多一个运行中」由存储层保证（WHERE NOT EXISTS + 部分唯一索引，且在每次打开时无条件重建，升级库同样具备；遇重复运行行给出 VERSION_CONFLICT）；存在未核实 interrupted 时认领返回 RECOVERY_REQUIRED"
    - "收尾：finishInput 版本校验（只从 processing、revision 必须匹配）"
    - "停止意图：queued 直接 stopped；processing/interrupted 记录意图并升版本；同 requestKey 重试返回同一结果；终态行不被改写"
    - "重启分类：scanStartup 只处理外来代次（含 serverEpoch 为 NULL 的遗留行），同进程重扫不会破坏在跑工作"
    - "调度：就绪会话轮转各认领一项；跳过运行中的会话；待恢复会话不阻塞其他会话，且跨轮次依次上报"
    - "证据：22 项单元测试真实运行通过（store 16、dispatcher 6）；SDK 试验 47/47 无回归"
  updated:
    - "devagent/src/store/store.ts、devagent/src/store/dispatcher.ts（新增实现）"
    - "devagent/test/store.test.ts、devagent/test/dispatcher.test.ts（新增测试）"
    - "devagent/package.json / devagent/tsconfig.json：vitest 与 test 脚本；typecheck 覆盖 test/"
    - ".agentdev/work/devagent-p1-store-dispatcher-20261005/：plan/implementation/test/review/settlement"
  proposed_for_confirmation:
    - "内部结果码 RECOVERY_REQUIRED 目前只在存储层内部使用；若将来经公开接口暴露，须先登记到 R6 错误目录（遵 R6『不在局部实现中私建协议』）"
    - "Task 级暂停/取消意图持久化按计划推迟到 P2（依赖 tasks 表）；届时补 implementation-checks 对应验收"
  indexes_updated:
    - none   # docs/INDEX.md 无需变更
  archived:
    - .agentdev/work/devagent-p1-store-dispatcher-20261005/
  no_change:
    - "docs/technicalnew 契约（S1–S3/R2 的字段与状态机未改；实现按其落列）"
    - "oldcode/、docs/old/、docs/architecturenew/、webui/（按 AGENTS.md 排除）"
  completion_gate: passed   # 独立审阅 Round 1 failed → 修复 → Round 2 passed → 增量复核 passed；本记录随本次提交
```