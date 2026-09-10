# AgentDev 文档索引

## 正式方案

- [产品方案](product/PRODUCT.md)：产品定义、能力、对象、用户旅程、完成结果。
- [主管与工作台交互](product/experience.md)：页面、对话、产物、看板、状态、异常和可访问性。
- [需求池与Git可迁移性](product/requirements.md)：需求事实、历史摘要、即时保存、Clone导入及继续规则。
- [产品知识](product/knowledge.md)：功能格式、状态、关系、新旧初始化及结算。
- [工作路由与交付规则](rules/workflow.md)：直接协作、L1/L2/L3、状态、授权、返工、取消。
- [Agent与Context规则](rules/agents.md)：固定职责、各自模型、主管分派和注入上下文、独立验证。
- [技术架构](architecture/ARCHITECTURE.md)：进程、包、技术栈、配置和Git策略。
- [数据契约](architecture/data.md)：字段、枚举、产物、约束与迁移。
- [协议契约](architecture/protocol.md)：公开/内部方法、响应、事件、错误与幂等。
- [Context实现](architecture/context.md)：选择、解析、投影、快照、读取记录。
- [执行与安全](architecture/execution.md)：平台、工具隔离、模型网关、Secret及测试环境。
- [可靠性与部署](architecture/reliability.md)：事务、集成、结算、重启、备份和恢复。
- [需求验收目录](delivery/acceptance.md)：唯一REQ/AC行为与证据目录。
- [实施工作包](delivery/implementation.md)：WP-00–10、依赖、输出、检查命令与退出。

## 加载配方

主管先读产品总览和当前Work，再选择相关功能；开发读工作包、授权Plan和对应架构/AC；Review读相同正式依据及冻结Diff，使用独立上下文；Test读有效Review、验收和环境；Settlement读实际变化和知识入口。

## 实现起点

当前仓库仅有webui/index.html本地Mock原型。Core、Runner、真实Pi运行、协议与存储、交付门禁、权限隔离、知识投影和恢复均尚未实现，运行测试尚未建立。原型不证明服务端行为，也不覆盖本目录的正式产品要求。

开发从[实施工作包](delivery/implementation.md)开始，按依赖实现共享Schema与底座，再完成各项能力和[验收](delivery/acceptance.md)。规范中的包路径和工程命令是待交付接口，不能假定已经存在。

本索引列出的文档是当前完整实现依据；产品行为、技术契约、角色/交付规则和验收要求共同适用。不依赖历史任务、旧方案、讨论记录或其他工作流副本。产品知识规范中的PROJECT、CODE_MAP等文件名描述AgentDev为用户项目生成的目标结构，不表示本仓库存在这些入口。
