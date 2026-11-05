# Implementation Summary · devagent-bootstrap-p0-20261004

```yaml
implementation:
  task: devagent-bootstrap-p0-20261004
  changed:
    - path: devagent/package.json
      purpose: 新工程单包（Node>=22.19、ESM），精确固定 @earendil-works/pi-coding-agent 1.0.0，typecheck/spikes 脚本
    - path: devagent/tsconfig.json
      purpose: strict TS（NodeNext、verbatimModuleSyntax、allowImportingTsExtensions），覆盖 src/ 与 spikes/
    - path: devagent/spikes/harness/pi-env.ts
      purpose: P0 试验基座：临时 cwd/agentDir/sessionDir、脚本化 OpenAI 兼容 stub 端点、ModelRuntime 注入、marker 定位、断言器
    - path: devagent/spikes/pi-01-input-correlation.ts
      purpose: PI-01 可运行部分：inputId↔marker↔原生根条目、首文件建立、custom vs custom_message、冷重启关联
    - path: devagent/spikes/pi-02-settle-semantics.ts
      purpose: PI-02：原生重试、原生工具失败、公开事件顺序、JSONL 写失败注入
    - path: devagent/spikes/pi-05-save-fail-abort.ts
      purpose: PI-05：宿主保存失败不返回成功、工具内 ctx.abort、外层 await 实际停稳、无半成品
    - path: devagent/spikes/pi-07-multi-session.ts
      purpose: PI-07：多 cwd/模型/工具/规则隔离并行、不可用模型可观失败不回退、无全局 cwd/env 变更
    - path: .agentdev/work/devagent-bootstrap-p0-20261004/sdk-surface.md
      purpose: S1 SDK 类型面勘察与契约差异
  behavior:
    - 四条 spike 全部真实运行（Node 24.8.0 + Pi 1.0.0），退出码 0，36/36 断言通过（PI-01 17、PI-02 5、PI-05 5、PI-07 9），输出见 test.md
    - 证据边界：真实 SDK 全部机制路径 + 本地 stub 端点；真实模型行为（I4）与产品验收（P6）未覆盖
  review_round_1:
    - 独立只读审阅判定 failed：1 项 blocking（PI-05 的 idle 断言不可失败）+ 5 项 non-blocking
    - 已修复：PI-05 改用 SDK 的 `session.isIdle` 并新增「失败 ToolResult 已落盘」检查；PI-01 文件建立改为磁盘存在性、新增第二输入关联与公开/扩展 turn_end 负载对比；PI-02 D 断言纳入磁盘侧；PI-07 新增 process.env 不变检查；harness 注释收窄；PI-05 复原只读目录权限
    - 第二轮独立审阅（新上下文）结果：passed，6 项 Round-1 发现全部核实修复；1 项 non-blocking（PI-01 的『模板转换』子项既未验证也未声明未覆盖）→ 已补 `/pi01-probe` 模板输入的真实检查（PI-01 17/17），见 review.md
  tests_changed:
    - devagent/spikes/*.ts（可执行试验，不是最终测试套件；P1+ 起的仓库回归测试另行建立）
  plan_deviations:
    - PI-01 未覆盖压缩/分支关联（needs long context），记为 not-covered 并计划 PI-01b
    - PI-02 D 场景以文件系统权限注入写失败（真实 EACCES）代替注入式 mock
    - 无模型凭证，按 plan 的 evidence boundary 用 stub provider；未伪造真实模型结论
  document_impact:
    - docs/technicalnew/implementation-checks.md 无需修改；契约级待确认项见 sdk-surface.md §2（结论随 settlement.md 归档）
    - 新增实现注意项（prompt() resolve 不等于成功、getSessionFile 预留路径、append-only 单链的 marker 定位、同 customType 两种条目）已写入 implementation.md 关键实况
  risks_remaining:
    - PI-08/PI-09（原生交互往返、并发容量）未取证；交付实时 UI/同步协作前必须补
    - ExtensionBindings.mode 取值未取证（PI-08）
```

## 关键实况（供实现直接使用）

1. **`prompt()` resolve ≠ 成功**。模型端点不可达时 `prompt()` 正常 resolve，失败只体现在 assistant 消息 `stopReason=error`（`errorMessage="Connection error."`）；反之 JSONL 写失败会真的 throw EACCES。→ 输入终态必须由消息级事实 + 磁盘核对推导（R2/S4）。
2. **`getSessionFile()` 在首条消息前就返回预留路径**，磁盘文件此时不存在。→ `hasHistory` 只能按磁盘/条目判定，不能按 `getSessionFile() !== undefined`（验证 R4 的告诫）。
3. **一条输入的原生树形**：`marker(custom) → message(system) → message(user) → message(assistant)`；marker 的直接子节点是 system 条目，因此**根输入条目按「marker 子树内第一个 `role=user` 的 message」定位**（两次输入各自验证）。**会话条目是一条 append-only 单链**：第二输入的 marker 与消息嵌套在第一输入 marker 的子树内（实测 `marker2NestedInMarker1=true`），所以定位必须取「该 marker 子树内的**第一个** user 消息」，不能用祖先范围做输入的独占划分，也不能用最后一个。`turn_end.messageEntryId` 指向该轮**最后一个** message（assistant），不是根输入条目；但确实落在本输入子树内，可用于归属校验。
4. **同名 customType 的两种条目可按 `entry.type` 区分**：`custom`（标记，不进上下文）vs `custom_message`（通知，进上下文）。建议契约层改用两个 customType。
5. **事件与停稳**：公开事件含 `auto_retry_start/auto_retry_end`、`entry_appended`；顺序 `agent_start → turn_start → message_* → tool_execution_* → message_end(toolResult) → turn_end → agent_end → agent_settled`。原生 500 会重试且 `agent_end` 可能出现多次 → 只有 `agent_settled` 才代表 Pi 不再自动继续。
6. **工具内停止可行**：工具 `execute` 里 `ctx.abort()` 后不再发起模型请求（stub 只收到 1 次请求），外层 `await session.abort()` + `waitForIdle()` 后 `session.isIdle === true`；失败的工具结果 `isError=true` 既在内存事件中返回，也**已落盘到 JSONL**（PI-05 E 检查）。
7. **会话隔离事实**：并发 Session 各自 cwd/模型/工具集/项目规则（AGENTS.md 装载进各自 systemPrompt），互不泄漏；`process.cwd()` 与 `process.env` 全程不变。