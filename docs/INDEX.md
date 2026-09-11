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

WP-00（工具链与执行底座）已按 L2 实现并完成独立 Review/Test：根工程与十个工程命令、`packages/contracts` 契约 Schema、`packages/pi-runtime`（Pi 会话工厂、显式资源加载、事件映射、内置扩展注册）、`apps/runner` 单 Attempt 进程、`apps/cli doctor` 与固定执行镜像。`doctor` 真实探测依赖、镜像 digest 与镜像运行能力、目录与端口；容器隔离负例覆盖只读 rootfs、只读挂载、非 root、cap-drop、无网络与 pid/内存上限；证据链见 `.agentdev/work/WP-00/`。

WP-01（数据、状态与协议核心）已按 L2 实现并完成独立 Review/Test：`packages/contracts` 覆盖 `data.md` §2 全 28 张表与 §3 结构，`packages/domain` 提供状态机/路由/权限/需求判定，`packages/storage` 提供单项目单库迁移与备份、版本 CAS 仓储、幂等命令账本、事件日志、outbox/租约/内容寻址 blob，`packages/core` 提供串行邮箱与命令分发、事件订阅与背压、连接认证与 Project 身份、需求投影。独立测试在冻结点 `c201f42` 上通过（unit 13 文件/173 用例、integration 10 文件/124 用例含真实容器）；证据链见 `.agentdev/work/WP-01/`。

WP-02（主管与独立Agent调度）已按 L2 实现并完成独立 Review/Test：`packages/core` 提供 Assessment 与等级路由底线（环境操作/lockdown 风险/授权范围）、DispatchSpec 冻结与准入（角色×目的、父 Run、Work 预算、Provider 可用性与凭证、授权覆盖 `operations`/`writePaths`/`readPaths`/`networkTargets`）、Run 建立与 `config`/`context`/`dispatch` 三快照、Run 生命周期与 Work 预算预留-核销（`reconcile` 幂等）、Join/父唤醒/`chief_action_required`、StageResult 结构化交付与二次 Schema 错误 `contract_violation`、`request_dispatch` 幂等待办、角色 Profile 解析与模型网关；`packages/domain` 同时提供等级路由与风险词表。19 轮独立 Review 与 2 轮独立 Test 在代码树 `cbf7471` 上通过（unit 17 文件/255 用例、integration 10 文件/124 用例含真实容器）；AC-043/044/045/046/047/082 有证据（AC-082 的工具层执行负例承接 WP-07）；证据链见 `.agentdev/work/WP-02/`。

真实 Provider 纵向运行、协议接线（daemon/BFF/WS）、交付门禁、权限隔离、工具执行层、知识投影和恢复仍未实现：`pnpm test:e2e`、`pnpm test:acceptance`、`pnpm test:live` 按契约返回 NOT_IMPLEMENTED，后续按[实施工作包](delivery/implementation.md)的依赖顺序继续。

开发从[实施工作包](delivery/implementation.md)开始，按依赖实现共享Schema与底座，再完成各项能力和[验收](delivery/acceptance.md)。规范中的包路径和工程命令是待交付接口，不能假定已经存在。

本索引列出的文档是当前完整实现依据；产品行为、技术契约、角色/交付规则和验收要求共同适用。不依赖历史任务、旧方案、讨论记录或其他工作流副本。产品知识规范中的PROJECT、CODE_MAP等文件名描述AgentDev为用户项目生成的目标结构，不表示本仓库存在这些入口。
