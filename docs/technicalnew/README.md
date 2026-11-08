# 开明技术设计入口

日期：2026-10-04。描述待实现系统。产品行为以 [产品需求](../productnew/README.md) 为准，当前文档检查见 [验证记录](validation.md)。

七角色提示词已纳入整体判断、可实施文档、最小上下文、原生能力优先与可接续结算，正文装配见 [G4](agents-and-tools.md#g4-规则与上下文装配)。read/write Task、当前步骤委派/超时、待办文件、原生交互与历史续办契约已归一。仅表示当前设计；SDK 接入、模型行为、故障与产品运行证据仍须按实现检查取得。

## 按链路加载

先读 [执行总图](architecture.md)，再选择当前工作需要的契约。

| 链路 | 设计入口 | 实现依据 |
|---|---|---|
| Server、Project、Session、Task | [架构](architecture.md) | 总图、关系、职责和资源边界 |
| 公开请求、输入执行、Pi 接入和停止 | [运行契约](runtime-contract.md) | API、输入状态、共用 Runtime |
| WAL、事务、回执、等待和重启 | [存储与恢复](storage-and-recovery.md) | 最小记录、认领、故障与继续算法 |
| 待办文件读取、写入与引用解析 | [待办格式](backlog-format.md) | 条目语法、问题与警告分类、编号、引用与版本 |
| 当前步骤并行委派、授权、UI | [消息与协作](messaging-and-collaboration.md) | 协作/授权子图、返回条件与交互协议 |
| 主管/专业角色、工具和上下文 | [Agent 与工具](agents-and-tools.md) | 五个核心工具、辅助工具、内置规则 |
| 接入试验、实现顺序和验证 | [实现检查](implementation-checks.md) | SDK/可靠性/模型/浏览器证据要求 |
| 已实现界面的缺陷、后端缺失方法与合同偏差 | [缺口登记](gap-register.md) | 逐项证据、影响与处置决定 |
| 浏览器前端：栈、入口、数据来源与已实现行为 | [前端层](architecture.md#a7-前端层)、[UI 设计契约](ui-design.md) | 布局、令牌、组件、会话面与验收门禁 |
| 外部 Agent 接入（MCP）：两个传输、工具面、run 标识与状态推导 | [MCP 服务](mcp-service.md) | 固定会话、错误映射、验证入口 |

## 当前架构

- 同一部署环境全局一个 Server，管理全部 Project、独立 Pi Session 和统一 SQLite。
- 每个主管 Session 同时协调一项未结束 Task；其他目标使用另一个主管 Session。
- Task 只分 read/write，由主管选择适用 Review/Test 责任；read Plan/报告存 Server，write 存项目 `.dev/work/<taskId>/`。主管维护一份总体 Plan，并显式调用 task(op=update) 更新阶段；子 Session 的内部计划自主决定，无另行落盘/审批义务。
- 主管按当前步骤调用 task(op=dispatch)，内部原子创建、绑定并异步调度。模型等待 Task 当前步骤全部成员；超时返回状态、不取消子工作。全部结束汇总报告/异常，主管处理后 wait 或核实 continue。普通原生交互不打断父等待。
- 模型提问采用官方 question 移植扩展，业务工具直接使用 Pi 原生交互。子请求经主管通道呈现，扩展与前端按 M5 消息协议分离；WAL 保存请求/答复，宿主处理转发与等待恢复。用户答复走直接响应入口，提交后送回原请求，不排在普通输入队列之后。
- 标准开发按实施 → 独立 Review → 独立 Test → 结算；同阶段可以多个独立 Session。task(op=end) 核对完成条件。
- Pi 1.0 coding-agent SDK 管模型循环、原生 Local 工具、历史和事件；SQLite 保存接纳、Task、关联、结果、交互与宿主保存回执。原生流式输出走内存广播。
- 前端为 React 19 + Vite 单页应用，构建产物由同一 Server 托管在 `/`（`/app/*` 301 到同路径），经 `/api` 与 SSE 接入；登录屏与会话、项目、设置三屏在同一外壳内（见 [A7](architecture.md#a7-前端层)）。

## 定义边界

| 定义 | 唯一依据 |
|---|---|
| 用户结果、保存/授权/交付含义 | productnew 对应模块与验收 |
| 公开入口与输入状态 | R1/R2 |
| 持久记录和事务 | S2/S3 |
| 委派返回、交互请求/响应、UI 外层 | M1/M2/M5 |
| 模型工具与角色权限 | G1/G2 |
| 待办文件格式 | [待办序列化](backlog-format.md) |
| 上下文装配与角色执行指导 | G4、prompts |
| 当前项目目标、步骤和验证安排 | 主管的 Task 总体 Plan |
| 子 Session 如何完成指定目标 | 专业 Agent 自主判断 |

业务含义由主管与独立 Agent 判断；程序核对身份、状态、必要报告、实际交付及真实保存，不推断自然语言授权范围或结算完整。首版恢复 Task/原生历史/已知成果，核实后续办剩余工作，不恢复工具执行栈、不自动重放未知操作。没有 Run/Attempt、通用工作流 DSL 或额外工具执行引擎。SDK 接入、模型行为与故障试验均为 NOT_RUN，不能从文档完成推断实现已完成。

待办文件与 Plan 的验收/范围是当前版本新增的实现面：`.dev/backlog.md` 以文件为准，模型只经 `backlog` 工具写入；修改 Task 的 Plan 必须含验收一节，范围缺失只是提示而非门禁。
