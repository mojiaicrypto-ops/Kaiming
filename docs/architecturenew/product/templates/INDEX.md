# 项目文件模板

这些是生成材料，不是已有项目事实。初始化/写入时 Agent 填入实际目标、路径、时间与 ID；未知保留，不照抄示例为已实现。AGENTS 托管段的变更需用户确认。

| 模板 | 生成位置 |
|---|---|
| [AGENTS](AGENTS.md) | 项目根 AGENTS.md 的托管入口段，原文保留 |
| [知识入口](knowledge-index.md) | `.dev/INDEX.md`；子索引使用同样的路径/职责/读取时机表 |
| [项目概览](project.md) | `.dev/PROJECT.md` |
| [模块文档](module.md) | `.dev/product/features/<slug>.md` 或 `.dev/technical/<slug>.md` |
| [需求](requirement.md) | `.dev/requirements/<实际需求ID>.md` |
| [计划](plan.md) | `.dev/work/<taskId>/plan.md` |
| [结算报告](settlement.md) | `.dev/work/<taskId>/settlement.md` |

`AGENTDEV-BEGIN/END` 标记仅用于识别托管段。存在两个段或段内有冲突时生成差异，请用户决定，不自动覆盖。
