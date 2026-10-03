# AgentDev 技术设计入口

日期：2026-10-04。版本：v1 技术契约草案。依据 [产品需求](../productnew/README.md) 和已确认的架构讨论；描述待实现系统，不声明代码已完成。本轮独立审阅与检查见 [交付记录](archive/20261004-ai-native-contracts.md)。

## 从哪里开始

先读 [执行总图](architecture.md)，再按当前链路选择下表。实现时，输入、返回、身份、事务、错误和恢复行为以对应契约为准；文件布局、局部函数和库选择留给实施 Plan。

| 要实现的链路 | 只需展开的设计 | 会得到什么 |
|---|---|---|
| Server 组装、Project / Session / Task 归属 | [架构](architecture.md) | 总图、职责、关系和事实权威 |
| 打开项目、输入接纳、Pi 调用与结束、停止 | [运行契约](runtime-contract.md) | 公开入口、输入状态、共用 Runtime 算法、Pi 接入边界 |
| 输入存储、原子认领、回执、重启和恢复 | [存储与恢复](storage-and-recovery.md) | 记录字段、约束、事务、检查点、故障处理表 |
| 多 Session 委派、Review→Test、结果投递、UI 推送 | [消息与协作](messaging-and-collaboration.md) | 协作时序子图、消息体、通道与快照握手 |
| 角色、工具、Plan、上下文与基础规则 | [Agent 与工具](agents-and-tools.md) | 角色表、工具输入输出、规则加载、可内置提示词 |
| 制定实施 Plan、验证 SDK / 可靠性 / 模型行为 | [实现检查](implementation-checks.md) | 先后顺序、接入试验、故障与业务行为检查 |

## 产品规则与技术规则的边界

| 问题 | 唯一定义位置 | 本目录如何使用 |
|---|---|---|
| 什么情况下保存需求、开工、确认或完成 | productnew 各模块 | 引用需求编号；不重新发明产品流程 |
| 标准开发先 Review 后 Test、独立验证、结算 | [任务交付 D-02～D-08](../productnew/modules/delivery.md) | 工具校验身份/依据/结果；主管规则按这个顺序组织 |
| 目录职责、内聚文档、按需加载 | [项目知识 K-02～K-05](../productnew/modules/project-knowledge.md) | 固定入口、结构校验与提示词；模块拆分由 Agent 判断 |
| 怎样持久接纳、寻址、调度、停止、核对恢复 | technicalnew 链路契约 | 规定程序可验证的字段与算法 |
| 当前任务修改哪些文件、用哪个局部算法 | 实施 Agent 的 Plan | 在产品和共同契约范围内自主决定 |

模糊边界按“用户应得到什么”与“系统怎样可靠做到”拆开。例如独立审核是 D-03；新建 reviewer Session、不给开发聊天、保存候选与依据引用是技术实现。提示词落实既有规则，不能用新增提示词偷改产品承诺。

## 已确认的设计输入

- 单 Server 进程，多 Project、多独立 Pi Session，统一 SQLite。使用 Pi 1.0 coding-agent SDK 与本地原生工具；Durable / OMP 作为选择性参考。
- 运行对象是 Session 与 Task；输入、分工、结果、回执是内部记录，不增加 Run / Attempt 层。
- 业务输入先存 SQLite，再由 Session Dispatcher 异步消费；每 Session 串行，跨 Session 按容量并行。
- 主管委派只等待接纳；其本次 Pi 执行可结束。专业结果成为主管持久输入，驱动下一次执行。
- Task 累计关联各阶段多个 Session；标准开发 Review 完成并处理必要问题后进入 Test；同阶段可并行多个 Review。
- Pi JSONL 保存会话；原生流式事件走内存广播；不增加持久 UI 事件库。
- 主管负责理解与组织；程序核对身份、保存结果、有效依据和必要完成条件。没有通用工作流 DSL、独立 Tool Executor 或自动并行合并框架。

Pi 输入关联、可靠落盘和工具失败停止是明确的接入试验项。没有试验证据时采用文档规定的保守路径，不能自行声称透明恢复。[实现检查](implementation-checks.md) 中所有运行场景当前为 NOT_RUN。
