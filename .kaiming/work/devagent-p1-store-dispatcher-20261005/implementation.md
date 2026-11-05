# Implementation Summary · devagent-p1-store-dispatcher-20261005

```yaml
implementation:
  task: devagent-p1-store-dispatcher-20261005
  changed:
    - path: devagent/src/store/store.ts
      purpose: 存储内核：PRAGMA 校验与迁移、接纳去重（含归属）、事务认领（CAS+代次+唯一约束）、版本校验收尾、按代次的重启分类、停止意图
    - path: devagent/src/store/dispatcher.ts
      purpose: 轮转调度：按会话轮流认领一项；跳过运行中的会话；待核实会话与其他就绪会话并存上报，不阻塞其余工作
    - path: devagent/test/store.test.ts
      purpose: 存储内核单元测试（16 项）
    - path: devagent/test/dispatcher.test.ts
      purpose: 调度轮转与恢复并存单元测试（6 项）
    - path: devagent/package.json / devagent/tsconfig.json
      purpose: 加 vitest 与 test 脚本；typecheck 覆盖 test/
  behavior:
    - "实测：npm test 22/22 通过；npm run typecheck 退出码 0；既有 SDK 试验 47/47 无回归"
    - "数据库：打开即强制 WAL、synchronous=FULL、foreign_keys=ON 并读取实际值校验；user_version 迁移到 1"
    - "接纳：请求摘要包含 method/projectId/sessionId/taskId/kind/payload —— 同 requestKey 同参数复用原结果（deduped=true），任一归属不同即 REQUEST_CONFLICT；会话内 seq 递增；queued 与回执同事务写入"
    - "认领：同会话已有 processing 时返回 busy；存在未核实 interrupted 时返回 blocked(RECOVERY_REQUIRED)；否则取最早 queued 并 CAS 认领。同会话「至多一个运行中」由存储层保证（WHERE NOT EXISTS + 部分唯一索引 idx_inputs_one_processing；该索引在 migrate 中无条件重建，旧版数据库升级后同样具备）"
    - "收尾：finishInput 只允许从 processing、且 revision 不符时返回 false"
    - "停止意图：queued 直接置 stopped；processing/interrupted 只记录 stopRequestKey/reason 并 revision+1；同一 requestKey 重试幂等；终态行（completed/failed/…）不被改写，迟到停止如实返回 stopRequested=false"
    - "重启分类：scanStartup 只处理外来代次（serverEpoch 为空或不同），同进程再次扫描不会把正在运行的工作打成 interrupted；被分类的行使该会话认领返回 RECOVERY_REQUIRED；stopped 的工作不会被复活"
    - "调度：就绪会话按轮转各认领一项；运行中的会话被跳过；存在待核实会话时仍继续服务其它就绪会话；每轮报告一个待恢复会话并在下一轮轮换到下一个（多会话待恢复不会被永久掩盖）；drain 不再被阻断会话终止"
  review_round_1:
    - 独立只读审阅判定 failed：1 项 blocking + 6 项 non-blocking
    - blocking：请求摘要漏了归属字段，导致「同 requestKey、不同 session/project/task」被静默去重 → 已把归属纳入摘要并新增冲突用例
    - 其余：扫描未按代次过滤（会把同进程运行中的工作打成 interrupted 且再也关不掉）→ 已按代次过滤并补用例；停止意图会改写终态行且不升版本 → 已加状态守卫、版本+1 与幂等；缺少存储层「一会话一运行中」的唯一约束 → 已加部分唯一索引与 NOT EXISTS 守卫；调度遇到阻断会话即终止本轮 → 已改为继续服务其他会话
    - 记录修正：并发表述改为「存储层不变式 + 第二连接报 busy」（单线程下 SQLite 写锁串行化写入）；不覆盖项补齐
    - 第二轮独立审阅（新上下文）判定 passed：6 项 Round-1 发现全部核实修复、无回归；3 项残留 non-blocking 已按其建议修掉：升级库也会重建部分唯一索引（migrate 中无条件执行，遇重复运行行给出明确 VERSION_CONFLICT）、调度轮换会推进到下个待恢复会话、停止重试返回与已记录结果一致（stopped 也返回 stopRequested=true）。记录见 review.md
  plan_deviation:
    - 本切片只建了真实使用的四张表（projects/sessions/session_inputs/request_receipts）；tasks/task_sessions/results/interactions/file_saves 随 P2/P3/P5 落列，避免空表
    - **Task 级暂停/取消意图未实现**（计划 P1-d 列了它）：它依赖 tasks 表，随 P2 建立主管理槽位与 Task 生命周期时一并落地；本切片只做输入级停止意图
    - 「提交后唤醒 + 周期扫描」中的唤醒属于运行时（P2）职责；本切片提供 claim API 与轮转器，未实现事件循环
    - S2 的 Input 字段中 schemaVersion/effectiveConfig/checkpoint/resumedFromInputId/resultRefs/error.evidenceRefs 尚未落列（随 P2 投递与收尾使用）；S3 的认领前置条件中「控制允许、目录/配置可用、主管 Task 范围、专业并发名额」尚未实现（随 P2/P3）
  document_impact:
    - 契约无需改动；新增的内部结果码 RECOVERY_REQUIRED 目前只在存储层内部使用，若将来经公开接口暴露，须先登记到 R6 错误目录（已在 settlement.md 记为待确认项）
  risks_remaining:
    - node:sqlite 为实验特性（打印 ExperimentalWarning）；产品侧处理方式在 P2 明确
    - 恢复后的「核实并继续」流程、file_saves 跨存储顺序仍属 P2/P5
```