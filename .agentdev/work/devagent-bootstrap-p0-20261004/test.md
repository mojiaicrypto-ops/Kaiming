# Test Report · devagent-bootstrap-p0-20261004

```yaml
test:
  task: devagent-bootstrap-p0-20261004
  environment:
    runtime: node v24.8.0 (darwin arm64)
    package: devagent@0.1.0
    dependencies: "@earendil-works/pi-coding-agent 1.0.0 (exact), @types/node 24.19.1, typescript 5.9.3"
    scope: 全部写入限于 os.tmpdir()/devagent-p0-*；仓库文件只读
  runs:
    - command: cd devagent && npm run typecheck
      result: passed
      exit_code: 0
      evidence: "tsc --noEmit 无输出；覆盖 src/**、spikes/**（strict、NodeNext、verbatimModuleSyntax、allowImportingTsExtensions）"
    - command: cd devagent && npm run spikes  (pi-01 → pi-02 → pi-05 → pi-07)
      result: passed
      exit_code: 0
      evidence: "36/36 断言通过：PI-01 17/17、PI-02 5/5、PI-05 5/5、PI-07 9/9"
    - command: ls -d "$TMPDIR"/devagent-p0-* | wc -l
      result: passed
      exit_code: 0
      evidence: "leftover_temp_dirs=0 —— 每处试验在 finally 清理临时根；pi-05 先把 0o555 目录复原为 0o755 再删除"
  key_evidence:
    - "PI-01: getSessionFile() 在首条消息前已返回预留路径而磁盘不存在（exists=false）；prompt 后 exists=true，marker 在 JSONL 中逐字保存（7 行）"
    - "PI-01: 树形 model_change → thinking_level_change → custom(agentdev.input) → message(system) → message(user) → message(assistant)；根输入条目 = marker 子树内第一个 role=user"
    - "PI-01: 第二输入的 marker 嵌套在第一输入 marker 子树内（marker2NestedInMarker1=true）；各自 marker 的首个 user 后代仍解析到各自输入 → 定位取『第一个』而非祖先独占或最后一个"
    - "PI-01: 扩展 turn_end 提供 messageEntryId（=该轮最后一个 message，∈本输入子树），公开 subscribe 的 turn_end 不含该字段；sendCustomMessage 产生 custom_message 且不新增 user 消息"
    - "PI-01: SessionManager.open 冷重启后 marker/子树/文件路径不变，续办在原历史上追加（13 → 15 条）"
    - "PI-01: 模板输入 `/pi01-probe tpl-arg` 在进入 agent 前展开（user 条目文本 = 'PI01-TEMPLATE-BODY tpl-arg tpl-arg'）且仍解析到自身 marker 的根条目"
    - "PI-02 A: 端点 500 → 服务端观测到 2 次请求、事件含 auto_retry_start/auto_retry_end，prompt 在重试后 resolve（events 中 agent_end 出现 2 次）"
    - "PI-02 B/C: 失败的原生 read 作为 isError toolResult 返回且运行仍收口；顺序 message_end(toolResult) < turn_end < agent_end < agent_settled"
    - "PI-02 D: 只读 JSONL 触发真实 EACCES（prompt 抛出），内存消息 3→5 而文件行数 6→6 → 内存领先磁盘必须按未保存处理"
    - "PI-05: 工具内 ctx.abort() 后模型端点仅收到 1 次请求；失败以 isError=true + HOST_SAVE_FAILED 返回；外层 abort+waitForIdle 后 session.isIdle=true；失败 ToolResult 已落盘（E 检查）；目标路径无半成品"
    - "PI-07: 并发两会话分别使用 stub-2/stub-1、各自 cwd/会话文件/AGENTS.md 规则/工具集；同相对路径 read 在 A 成功、B 失败；process.cwd() 与 process.env 均不变"
    - "PI-07: 未注册模型 getModel()=undefined；不可达端点上 prompt() 仍 resolve，但 assistant stopReason=error（errorMessage=Connection error.），且没有回退到可用 provider"
  not_covered:
    - area: "PI-01 压缩(compaction)/分支(branch) 后的 marker 关联"
      reason: "需要长上下文或摘要模型调用，超出本包最小试验范围"
      disposition: pending
    - area: "PI-07 的『恢复原文件 / 角色工具规则变化 / 冷恢复重建运行契约』子项"
      reason: "本包 PI-07 只覆盖并发隔离、模型不可用与全局状态不变；配置变化下的冷恢复属恢复链路，随 P5 取证"
      disposition: pending
    - area: "PI-08 原生交互(question/ctx.ui) 往返、主管通道呈现与重启后 stale"
      reason: "属交付实时 UI/同步协作前的门禁，本包未纳入"
      disposition: pending
    - area: "PI-09 专业并发容量=1、排队/超时/父停止不误取消子工作"
      reason: "同上，属协作门禁"
      disposition: pending
    - area: "真实模型行为（I4）与产品验收（P6）"
      reason: "本环境无模型凭证；本包使用本地 stub 端点，已按 evidence boundary 标注"
      disposition: pending
  result: passed
```

## 复现

```bash
cd devagent
npm install            # 已存在 package-lock.json（锁定 1.0.0）
npm run typecheck
npm run spikes
```

每条断言在失败时打印 `FAIL <check> :: <detail>` 并使进程退出码非 0；`PASS/FAIL` 明细见上表 key_evidence。