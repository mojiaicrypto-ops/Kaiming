# 内置规则目录

本目录随 AgentDev 安装，ruleRoot 为其绝对位置。只注入目录和 core/角色正文，其余通过 read 按触发读取。规则正文属于产品需求，不能由实现者自行改写成另一套流程。

| 文件 | 何时读取 | 输出 |
|---|---|---|
| [core](core.md) | 每个 Session 实际注入 | 事实、授权、独立验证、工具真实性与结算的基础约束 |
| [chief](chief.md) | 主管 Session 实际注入 | 讨论/保存/实施、上下文与派发行为 |
| [roles](roles.md) | 子 Agent 注入对应角色章节 | 职责、写入范围和阶段交付 |
| [knowledge](knowledge.md) | 初始化、需求保存、正式产品/技术文档写入前 | 模块、目录、需求格式与索引维护 |
| [delivery](delivery.md) | 创建/计划/实施/审核/测试正式 task 前 | 路线、计划、结果、返工与问题处理 |
| [settlement](settlement.md) | 结算、完成、接续及复盘前 | 事实回填、归档、提交和任务收口 |

变量：projectId、projectRoot、ruleRoot 由 Server 以独立环境说明注入，不替换项目正文；taskId/stepId 是实际工具上下文。工具名和参数见 [工具契约](../contracts.md)。
