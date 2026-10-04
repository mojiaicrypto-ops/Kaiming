# AgentDev 技术设计入口

日期：2026-10-04。当前 v1 契约；描述待实现系统。产品行为以 [产品需求](../productnew/README.md) 为准，当前文档检查见 [验证记录](validation.md)。

主管提示词已按新产品方向更新为 [Chief v2](prompts/chief.md)。这是目标规则文档；分析 Task、所有专业委派绑定 Task、统一设计角色、提案/实施需求及收口方式、沿用 Pi 原生交互且移除业务确认分类和模型交互操作链，尚待工具/消息/存储契约、基础/专业提示词同步和模型验证。既有 v1 接纳与完成条件不能直接用于启用 v2。

## 按链路加载

先读 [执行总图](architecture.md)，再选择当前工作需要的契约。

| 链路 | 设计入口 | 实现依据 |
|---|---|---|
| Server、Project、Session、Task | [架构](architecture.md) | 总图、关系、职责和资源边界 |
| 公开请求、输入执行、Pi 接入和停止 | [运行契约](runtime-contract.md) | API、输入状态、共用 Runtime |
| WAL、事务、回执、等待和重启 | [存储与恢复](storage-and-recovery.md) | 最小记录、认领、故障与继续算法 |
| 当前步骤并行委派、授权、UI | [消息与协作](messaging-and-collaboration.md) | 协作/授权子图、返回条件与交互协议 |
| 主管/专业角色、工具和上下文 | [Agent 与工具](agents-and-tools.md) | 四个主管核心工具、辅助工具、内置规则 |
| 接入试验、实现顺序和验证 | [实现检查](implementation-checks.md) | SDK/可靠性/模型/浏览器证据要求 |

## 当前架构

- 同一部署环境全局一个 Server，管理全部 Project、独立 Pi Session 和统一 SQLite。
- 每个主管 Session 同时协调一项未结束 Task；其他目标使用另一个主管 Session。
- Task 是整项交付，主管维护 `.dev/work/<taskId>/plan.md` 总体 Plan，并显式调用 updateTask 更新阶段；子 Session 的内部计划自主决定，无另行落盘/审批义务。
- 主管按当前步骤调用 createTaskSessions，内部原子创建、绑定并异步调度。模型等待本批成果；需要主管处理的交互或阻断让工具提前返回，处理后继续原 Session/原批次。
- 所有子 Session 的交互先交回主管模型，由主管在自己的通道展示。用户答复走直接响应入口，保存后送回原请求，不排在普通输入队列之后。
- 标准开发按实施 → 独立 Review → 独立 Test → 结算；同阶段可以多个独立 Session。endTask 核对完成条件。
- Pi 1.0 coding-agent SDK 管模型循环、原生 Local 工具、历史和事件；SQLite 保存接纳、Task、关联、结果、交互与关键回执。原生流式输出走内存广播。

## 定义边界

| 定义 | 唯一依据 |
|---|---|
| 用户结果、保存/授权/交付含义 | productnew 对应模块与验收 |
| 公开入口与输入状态 | R1/R2 |
| 持久记录和事务 | S2/S3 |
| 委派返回、交互请求/响应、UI 外层 | M1/M2/M5 |
| 模型工具与角色规则 | G1/G2、prompts |
| 当前项目目标、步骤和验证安排 | 主管的 Task 总体 Plan |
| 子 Session 如何完成指定目标 | 专业 Agent 自主判断 |

程序保存和核对事实，不替主管选择下一阶段。没有 Run/Attempt、通用工作流 DSL 或额外工具执行引擎。SDK 接入、模型行为与故障试验均为 NOT_RUN，不能从文档完成推断实现已完成。
