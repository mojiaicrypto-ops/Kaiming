# Plan · 主动压缩策略与手动压缩（compaction-policy-20261028）

日期：2026-10-28。用户确认：默认阈值 **70%**；触发时机 **下一条消息开始前**；**保留 Pi 原生兜底**；手动入口 **点上下文档位弹出面板**。

## 1. 目标与验收

| # | 可观察结果 |
|---|---|
| A1 | 设置 → Models 有全局“上下文压缩”：开关 + 阈值（50–95%，默认 70%）；保存后无需重启 |
| A2 | 自动开启且占用 ≥ 阈值时，下一条输入被认领后、交付给模型前先压缩；压缩完成后同一输入继续 |
| A3 | 关闭自动后，主机不再主动压缩；Pi 原生在窗口前 16k tokens 仍会兜底 |
| A4 | 点状态栏上下文档位打开面板，显示已用/窗口/百分比与“立即压缩”；运行中、有未核实中断、无活实例时禁用并说明 |
| A5 | 手动压缩成功显示压缩前后 tokens；没有可压缩内容时如实说明；压缩失败不破坏会话 |
| A6 | 压缩中界面显示“压缩中…”，结束后占用变为 `?`，下一次响应更新；重连快照也能恢复该状态 |
| A7 | 手动/自动压缩不改变 Task 状态、队列、模型设置或输入终态 |

## 2. Pi 默认机制（调研结论）

- 默认 `enabled=true`、`reserveTokens=16384`、`keepRecentTokens=20000`；
- 阈值 `contextTokens > window - reserveTokens`：1M→98.4%、200k→91.8%、128k→87.5%、32k→50%；
- 每次模型请求前、每轮结束后检查；溢出另有 overflow 恢复压缩；手动 `compact()` 会先 abort 当前操作；
- 结论：作为安全网保留；产品另加更早的百分比阈值，不复制压缩引擎。

## 3. 范围

**范围内**
1. SQLite v16 全局 `compaction_settings`（auto、thresholdPercent、revision、updatedAt），默认 70%。
2. `compaction.get/save` RPC（save 校验 50–95、CAS revision）。
3. Runner：`compacting` 串行锁；`compactIfDue`（认领后、交付前）；`compactManually`（校验 processing/interrupted/无实例）。
4. `session.compact` 写方法；快照带 `compacting`。
5. 前端：slot.compacting；ContextMeter 变按钮 + 弹层；设置页卡片；i18n/CSS。
6. 文档：C-03、项目工作区全局设置、UI U2/U5、R1/M4、AC 新增。

**范围外**
- 自建压缩摘要算法、压缩摘要编辑、按项目/角色阈值。
- 压缩成本补账到用量页（既有缺口，登记为已知风险）。
- 关闭 Pi 原生兜底（用户选择保留）。

## 4. 实施步骤

| 步骤 | 变更 |
|---|---|
| S1 | `store.ts`：v16 表/迁移、get/save、默认行；测试 |
| S2 | `runtime/compaction-policy.ts`：`shouldCompactContext` + 结果类型；测试 |
| S3 | `runner.ts`：锁、`compactIfDue`、`compactManually`；runNext 认领后调用；测试 |
| S4 | `write-methods.ts`/`main.ts`：`session.compact`、`compaction.get/save`、快照 `compacting` |
| S5 | 前端：api/slot/useSession/ContextMeter/ModelsPage/i18n/CSS；测试 |
| S6 | 文档、AC、validation；浏览器验证 |

## 5. 验证

- 单测：store 配置、策略纯函数、runner 自动/手动（fake handle）、RPC、slot、meter、设置卡。
- 真实 Pi + 浏览器：运行一轮 → 点占位 → 立即压缩 → 显示已压缩与 `?`；改设置阈值 → 保存后生效；运行中按钮禁用。
- 自动触发用自定义 provider 报告高 usage + 小窗口，验证第二轮前压缩；Pi 兜底不关闭。
- 全量：`tsc`、`vitest`、webapp、Playwright。

## 6. 风险

- 压缩是一次模型调用，可能数秒；按钮与“压缩中”必须可见；失败要回退到正常输入。
- 手动压缩与 worker 认领的竞态：用 per-session 同步锁，认领前检查/等待。
- 压缩使用量未进用量 ledger：本轮不补账，写入 validation 未覆盖项。
- 无活实例（重启后）不能手动压缩：按钮禁用并说明；自动在首条消息后生效。
