# Test Report · devagent-p1-store-dispatcher-20261005

```yaml
test:
  task: devagent-p1-store-dispatcher-20261005
  environment:
    runtime: node v24.8.0 / vitest 3.2.7 / node:sqlite（内置）
    scope: 每个用例 os.tmpdir() 下独立目录，用例后清理
  runs:
    - command: cd devagent && npx tsc --noEmit
      result: passed
      exit_code: 0
      evidence: "无输出（src/、spikes/、test/ 全部通过 strict 检查）"
    - command: cd devagent && npm test
      result: passed
      exit_code: 0
      evidence: "2 个测试文件、22 项通过（store 16、dispatcher 6）"
    - command: cd devagent && npm run spikes
      result: passed
      exit_code: 0
      evidence: "47/47（PI-01 18、PI-02 5、PI-05 5、PI-07 9、PI-08 10）—— 本切片未触及 SDK 试验，无回归"
  key_evidence:
    - "PRAGMA 实测：journal_mode=wal、synchronous=2、foreign_keys=1、user_version=1"
    - "接纳去重：同 key 重试 {inputId:'i-1',deduped:true} 且表内仍 1 条；同 key 改 payload / 改 sessionId / 改 taskId / 改 projectId 均抛 REQUEST_CONFLICT（断言具体 code），且被拒时未在目标会话建记录"
    - "会话内 seq：s-1 [1,2]、s-2 [1]"
    - "认领：取最早 queued 置 processing/claim=1/serverEpoch=1；再认领返回 busy(i-1)"
    - "一会话一运行中（存储层保证）：直接对同会话第二条 queued 调 tryClaimInput 返回 false，processing 行仍只有 1 条；第二连接 claimNextInput 返回 busy"
    - "升级路径：手工删掉部分唯一索引模拟旧库后重开，索引被重建（sqlite_master 可见）"
    - "多会话待恢复：s-1/s-2 同时待核实，连续两次 nextClaim 分别报告 s-1、s-2（不会被第一个永久掩盖）"
    - "停止重试一致：queued→stopped 后同 requestKey 重试返回同一结果（stopRequested=true）"
    - "版本校验：旧 revision 收尾 false；当前 revision 收尾成功并写入 errorCode/errorMessage"
    - "停止意图：queued→stopped；processing 记录 stopKey/reason 且 revision+1；同 requestKey 重试幂等；completed 行被迟到停止时 stopKey/reason/revision 均不变并返回 stopRequested=false"
    - "重启分类：外来代次 processing 被 scanStartup 计为 interrupted=1，认领返回 {kind:'blocked',code:'RECOVERY_REQUIRED'}；同代次再扫描返回 0 且运行中的输入仍可正常收尾"
    - "调度轮转：三会话 s-1→s-2→s-3 各认领一项；运行中的会话被跳过；drain 只返回可认领项（idle 为终止条件，不作为结果）"
    - "恢复并存：s-1 待核实 + s-3 就绪时 drain = [claimed:s-3, blocked]（阻断会话不阻塞其余工作）"
  not_covered:
    - area: "Task 级暂停/取消意图持久化（计划 P1-d 的一部分）"
      reason: "依赖 tasks 表；随 P2 的 Task 生命周期与主管理槽位落地"
      disposition: pending
    - area: "提交后唤醒、周期扫描的事件循环"
      reason: "属运行时（P2）职责；本切片只提供 claim API 与轮转器"
      disposition: pending
    - area: "S2 的 Input 其余字段（schemaVersion/effectiveConfig/checkpoint/resumedFromInputId/resultRefs/error.evidenceRefs）"
      reason: "随 P2 的投递与收尾真正使用后落列"
      disposition: pending
    - area: "S3 的认领前置条件（控制允许、目录/配置可用、主管 Task 范围、专业并发名额）"
      reason: "随 P2/P3 的运行时与协作实现"
      disposition: pending
    - area: "恢复后的核实与继续（关闭 interrupted 输入、补剩余工作）"
      reason: "属 P2/P5"
      disposition: pending
    - area: "tasks/task_sessions/results/interactions/file_saves 表与跨存储保存顺序"
      reason: "随 P2/P3/P5 按真实使用落列"
      disposition: pending
    - area: "与真实 Pi 运行时/模型的集成"
      reason: "本切片按设计可先用存储夹具；模型凭证仍缺"
      disposition: pending
  result: passed
```