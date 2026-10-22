# AgentDev 文档索引

当前按新产品重新设计。以下目录是本次产品/技术设计入口；设计要求、源码存在与实际验证分别理解。

| 入口 | 职责 | 何时读 |
|---|---|---|
| [产品需求](productnew/README.md) | 产品定位、五个业务模块、用户结果与首版范围 | 首次理解产品 |
| [用户流程](productnew/journeys.md) | 从项目接入到需求、交付、结算和接续 | 讨论端到端行为 |
| [产品验收](productnew/acceptance.md) | 可观察产品场景 | 制定验证与交付 |
| [技术设计](technicalnew/README.md) | 总图、子图与各链路实现契约的导航 | 技术设计/实施前 |
| [前端设计契约](technicalnew/ui-design.md) | 浏览器界面的布局、令牌、组件、会话面与验收门禁 | 界面设计/实施前 |
| [缺口登记](technicalnew/gap-register.md) | 已实现界面的缺陷、后端缺失的方法与会话合同偏差，及逐项处置决定 | 继续补功能前 |
| [任务交付](productnew/modules/delivery.md) | 计划、授权、独立审核、开发单元/TDD 与独立端到端测试、结算 | 正式修改与完成核对 |
| [项目知识](productnew/modules/project-knowledge.md) | 权威文档、模块内聚、按需加载与项目记忆 | 整理文档/上下文/结算 |

技术细节按 technicalnew/README 的链路索引加载，不默认读取所有文档。当前产品需求是行为依据，技术设计是待实现契约；运行验证状态见下方。

## 当前状态

- productnew：当前产品需求，明确轻量提案 → 统一设计角色与独立审阅 → 实施需求 → 实现 Task 流程 → 结算；Task 只分只读/修改，采用主管总体 Plan、显式当前步骤、全部子 Session 聚合/超时状态与宿主直接处理通用交互。
- technicalnew：当前角色/工具、需求格式、消息/存储/恢复与上下文装配；模型提问采用官方 question 移植扩展，通过原生交互消息接入 WAL 和主管通道，与前端渲染分离。见[七角色与工具入口](technicalnew/agents-and-tools.md)、[格式规范](technicalnew/requirements-format.md)、[验证记录](technicalnew/validation.md)。恢复只核实原生历史/已知成果后续办；业务判断交 Agent，程序核对身份/状态/必要报告/版本/保存。当前审阅状态以验证记录为准，文档检查不证明 SDK、模型或产品可用。
- 前端：React 19 + Vite 7 单页应用，构建产物由同一 Server 托管在 `/`（`/app/*` 301 到同路径；产物不入库，缺失时会话入口提示构建）。登录屏与会话/需求/设置三屏在同一外壳内。契约见[前端设计契约](technicalnew/ui-design.md)与[A7](technicalnew/architecture.md#a7-前端层)。
- 实施状态：业务代码已按本轮设计实施并持续验证，逐个工作包的证据、边界与未执行项记在[验证记录](technicalnew/validation.md)与各工作包结算记录；该表不等同于产品验收。产品验收仍按 [acceptance](productnew/acceptance.md) 逐条执行，未执行项不得视为通过。
- 已知缺口：项目/会话列表方法、任务变更推送、文件与报告查看、重绑定入口等尚未实现，逐项证据与处置见[缺口登记](technicalnew/gap-register.md)。

验证记录只说明当前证据，不替代实现契约。
