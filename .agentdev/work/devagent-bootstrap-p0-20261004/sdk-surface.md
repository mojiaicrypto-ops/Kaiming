# S1 · Pi SDK 能力勘察（v1.0.0 实测类型面）

方法：读取本地安装的 `devagent/node_modules/@earendil-works/pi-coding-agent@1.0.0` 的 `.d.ts`、官方 `docs/*.md` 与 `examples/*`。
证据性质：**类型/文档证据**（未运行）。运行证据见 `test.md`。结论用于 P0/后续实现，不替代 `docs/technicalnew` 契约。

## 1. R4 假设逐项核对

| R4/G2 需要的动作 | 实际 API | 位置 | 结论 |
|---|---|---|---|
| `createAgentSession` 显式 cwd/model/sessionManager/resourceLoader/tools/customTools | `createAgentSession(options?: CreateAgentSessionOptions)`：`cwd?/agentDir?/modelRuntime?/model?/thinkingLevel?/scopedModels?/noTools?/tools?/excludeTools?/customTools?/resourceLoader?/sessionManager?/settingsManager?/sessionStartEvent?` | `dist/core/sdk.d.ts:8-47` | ✓ 完全支持显式注入 |
| 指定 Pi 文件、恢复、branch | `SessionManager.create(cwd, sessionDir?, opts?)`、`.open(path, sessionDir?, cwdOverride?)`、`.inMemory()`、`.forkFrom(source, targetCwd, sessionDir?, opts?)`、`.list()`；`getSessionFile()/getLeafId()/getEntry()/getEntries()/getTree()/getHeader()` | `dist/core/session-manager.d.ts:371-414,243-334` | ✓；`open` 需传入精确 path |
| 追加输入关联标记（不进入模型上下文） | `SessionManager.appendCustomEntry(customType, data?): string` → `CustomEntry{type:"custom",customType,data}`，**不参与 LLM context** | `session-manager.d.ts:273,76-85` | ✓ 与 R4「标记不伪装成用户文本」一致 |
| 恢复/控制通知（进入上下文） | `sendCustomMessage({customType,content,display,...}, {triggerTurn?, deliverAs?})` → `CustomMessageEntry{type:"custom_message"}`，**算作用户消息进入上下文** | `dist/core/agent-session.d.ts:565-568`；`session-manager.d.ts:95-110` | ✓ |
| 绑定宿主 UI 适配 | `session.bindExtensions(bindings: ExtensionBindings)`；`ExtensionBindings{uiContext?, mode?, commandContextActions?}` | `agent-session.d.ts:154-157,726` | ✓ |
| `ctx.ui.confirm/select/input` 语义 | `ui.select(title, options, opts?)→Promise<string｜undefined>`、`ui.confirm(title, message, opts?)→Promise<boolean>`、`ui.input(title, placeholder?, opts?)→Promise<string｜undefined>` | `dist/core/extensions/types.d.ts:72-78` | ✓ 与 M5 的 response↔原生返回映射**完全一致**（取消→false/undefined） |
| question 扩展移植路径 | `pi.registerTool(tool: ToolDefinition)`；`ToolDefinition.executionMode?`；扩展经 `extensionFactories` 加载；官方 `examples/extensions/question.ts` 与 `questionnaire.ts` 均存在 | `types.d.ts:1186,490`；`examples/sdk/06-extensions.ts`；`examples/extensions/question.ts` | ✓ 源码可直接移植（TUI 部分需裁掉） |
| 输入关联用的原生条目 ID | 扩展事件 `turn_end` 提供 `messageEntryId: string`、`toolResultEntryIds: string[]`；`agent_settled` 无负载 | `types.d.ts:787-793,762` | ✓ 与 R4 描述一致（`session.subscribe` 的公开事件不含这些 ID） |
| 停稳判定 | 官方 `docs/sdk.md`：`message_end` 是权威完成消息；`agent_end` 只是单次底层 run 结束，仍可能有自动重试/排队续作；`agent_settled` 才表示 Pi 不会自动继续 | `docs/sdk.md`（Subscribing to events 节） | ✓ 与 R4/S4 一致 |
| 停止 | `abort()` 停止活动操作并**等待空闲**；`waitForIdle()` 只等待不中断 | `docs/sdk.md` | ✓ 实现 S5「工具内 ctx.abort + 外层 await」可行 |
| 模型/凭证注入 | `ModelRuntime.create({modelsPath?, authPath?, credentials?, allowModelNetwork?, refreshOnCreate?...})`，`getModel(provider,id)`；`createAgentSession` 的 `agentDir` 默认用 `agentDir/auth.json` + `models.json` | `dist/core/model-runtime.d.ts:4-46,56`；`sdk.d.ts:14-20` | ✓ 可注入临时 agentDir，无需污染全局配置 |
| 自定义/兼容端点 | `agentDir/models.json`：`{providers:{<id>:{baseUrl,api:"openai-completions",apiKey,models:[{id}]}}}`；或扩展 `pi.registerProvider` | `docs/models.md:45-66`、`docs/custom-provider.md` | ✓ 可用本地 OpenAI 兼容端点做无凭证试验 |

## 2. 与契约的差异 / 待确认项（不自行改契约，按 I5 上报）

1. **`agentdev.input` 一个 customType 承担两种条目**：R4 的输入标记用 `appendCustomEntry`（`type:"custom"`，不进上下文），M3/R4 的恢复通知用 `sendCustomMessage`（`type:"custom_message"`，进上下文）。两者可凭 `entry.type` 区分，但同名 customType 使「扫描标记」时必须额外过滤 type。建议契约层改为两个不同 customType（如 `agentdev.input-marker` / `agentdev.input-notice`）；本任务按契约字面实现，差异上报用户决定。
2. **`ExtensionBindings.mode`**：`types.d.ts:216-218` 注明 `mode` 决定是否 dialog-capable（TUI/RPC 才可用）。浏览器宿主绑定时需显式给 `mode`，具体取值（`tui`/`rpc`/`print`）未在本任务取证 → 留给 PI-08。
3. **首次文件建立时机**：`session-manager.d.ts:248-250` 明确「只有会话包含 user/assistant 消息才创建文件，纯 setup 条目留在内存」→ 与 R4「hasHistory 只在确认持久条目后置 true」一致，实现必须按此判定，不能把 `open()` 的新建行为当恢复。
4. **`prompt()` 在流式中的语义**：已 streaming 时必须显式 `steer`/`followUp`，否则 reject（`docs/sdk.md`）→ 与 R3「不接收第二次并发 prompt」一致，宿主不应依赖隐式排队。

## 3. 结论

设计对 SDK 的假设**在类型层全部成立**，无缺失 API，无需 I5 级别替代。实际行为（关联精确性、停稳边界、abort、并发）由 PI-01/02/05/07 spike 运行取证。