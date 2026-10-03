# AgentDev 文档索引

当前按新产品重新设计。以下目录是本次产品/技术设计入口；设计要求、源码存在与实际验证分别理解。

| 入口 | 职责 | 何时读 |
|---|---|---|
| [产品需求](productnew/README.md) | 产品定位、五个业务模块、用户结果与首版范围 | 首次理解产品 |
| [用户流程](productnew/journeys.md) | 从项目接入到需求、交付、结算和接续 | 讨论端到端行为 |
| [产品验收](productnew/acceptance.md) | 可观察产品场景 | 制定验证与交付 |
| [技术设计](technicalnew/README.md) | 总图、子图与各链路实现契约的导航 | 技术设计/实施前 |
| [任务交付](productnew/modules/delivery.md) | 计划、授权、独立审核/测试、结算 | 正式修改与完成核对 |
| [项目知识](productnew/modules/project-knowledge.md) | 权威文档、模块内聚、按需加载与项目记忆 | 整理文档/上下文/结算 |

技术细节按 technicalnew/README 的链路索引加载，不默认读取所有文档。旧资料位于 old/，architecturenew 为历史讨论；它们不替代当前契约，不作为新设计的默认输入。

## 当前状态

- productnew：第一版产品需求文档，包含用户已确认的阶段顺序与异步协调澄清。
- technicalnew：v1 技术契约草案，已明确组件、身份、输入/工具/消息、存储与恢复路线；独立审阅和文档检查在 [交付记录](technicalnew/archive/20261004-ai-native-contracts.md)。
- 新架构业务代码尚未按本轮设计实施；Pi 接入、模型行为、故障与产品运行验收均未因文档写成而通过。实施先按 [实现检查](technicalnew/implementation-checks.md) 验证标记项目。
- 本轮未审查原工程功能，不将已有代码与新产品需求逐项对应或宣称已完成。当前代码地图与真实运行检查入口在后续实施结算时形成。

归档只用于追溯证据，不是默认实现依据。
