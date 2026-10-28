# Research · 前端查看当前模型上下文与占用

日期：2026-10-28。范围：主管 chat。结论供 Plan 与实现使用。

## 现场

- 主管会话 `s-951d407099a4`：Pi 历史 3432 条、24 次 compaction；最后一条 assistant 的 prompt tokens = 616,855；模型 `openai/group/auto-deepseek-v4-1-flash` 窗口 1,000,000（目录事实：1M / 32k 输出 / 支持推理）。按最后响应约 61.7%。
- 该响应 cost 为 0：网关/目录无价格，不能把 0 显示成“免费”。

## 数据从哪里来

| 数据 | 来源 | 性质 |
|---|---|---|
| 当前上下文 tokens / 窗口 / 百分比 | Pi `AgentSession.getContextUsage()` | 估算；压缩后到下一次响应前 tokens/percent 为 null |
| 自动压缩开关 | `AgentSession.autoCompactionEnabled` | 真实设置（默认开启，reserve 16k） |
| 本会话累计 tokens/成本 | `getSessionStats()` 或 `usage_entries` | 另一个事实；本轮不做 |
| 模型窗口（无实例时） | `PiRuntimeFactory.facts(selection).contextWindow` | 目录事实；按上次运行模型，否则当前设置 |

## 缺口

1. 服务端只把 `providerId/modelId/source` 送前端（`session.get`、流快照），没有占用。
2. `message_end` 的 `usage` 已到浏览器，但前端 reducer 不用它；自行计算会在压缩后失真。
3. `usage.report` 只有项目/全部累计，非当前上下文（缺口 S6）。
4. 无活实例（重启/换模型）时无法得到 tokens；只能给窗口，必须如实标未知。

## 方案取舍

- **服务端权威 + SSE**：快照带初值，assistant/compaction 后推 `context` 通知；读取 Pi 自己的估算，不复制压缩语义。选中。
- 前端自算：压缩后错误、少最后一条用户输入；不选。
- 轮询 `session.get`：延迟、空读、与 M4 事件驱动冲突；不选。
- 会话累计用量：回答另一个问题，且与 ledger 有第二事实源；用户确认本轮不做。

## 交互决定（用户确认）

1. 位置：状态栏模型区（`provider/model · used / window · percent`）。
2. 范围：只显示上下文占用。
3. 未知：重启后无实例显示 `— / 窗口`；压缩后窗口期显示 `? / 窗口`。

## 风险

- 估算不是计费；tooltip 必须写 estimated。
- `message_end` 先广播后落盘：占用计算不能在监听器里同步做，否则延迟落盘并影响测试/时序；用 microtask。
- 观测失败不能影响 run：try/catch，丢一帧由下一次响应或 resync 快照补齐。
- 状态栏宽度：≤860 收紧间距；≤560 只留百分比（未知保留 `— / 窗口`）；≤480 隐藏分支；≤400 再隐藏运行中计数；路径与提示先让位，模型名最后才收缩；不能只用颜色表达阈值。
