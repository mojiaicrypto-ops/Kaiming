# AgentDev 开发入口

先读[文档索引](docs/INDEX.md)，再按工作包加载相应产品、架构、规则与验收。索引列出的正式文档是完整实现依据；当前实现状态也在索引中。

遵循[交付流程](docs/productnew/modules/delivery.md)和[角色与工具契约](docs/technicalnew/agents-and-tools.md)。代码修改先有适用Plan，专业角色采用独立上下文，Review不读取开发聊天；按实际证据报告完成情况。

产品设计文档描述待实现行为，不能据此声称功能已实现。webui/index.html仅为Mock参考。不得用外部同名skill或历史方案替代本仓库正式契约。

实现范围与依据已确认：`docs/productnew/`（产品需求）与 `docs/technicalnew/`（技术设计）是唯一实施依据，整体按文档实施。`oldcode/` 与 `docs/old/` 不读取、不处理、无需理解；`docs/architecturenew/` 为上一轮历史方案，不作为实施依据。

简单优先：不要过度设计，不要过分思考。围绕已确认需求解决当前问题，优先复用 Pi 原生能力和现有机制；没有明确必要，不增加对象、状态、协议或抽象层，不为假设中的未来需求预设复杂机制。
