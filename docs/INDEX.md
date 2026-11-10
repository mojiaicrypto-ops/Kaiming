# 开明文档索引

当前按新产品重新设计。以下目录是本次产品/技术设计入口；设计要求、源码存在与实际验证分别理解。

| 入口 | 职责 | 何时读 |
|---|---|---|
| [安装与启动](install.md) | 环境、安装、首次配置、备份与 MCP 客户端配置 | 首次部署或升级 |
| [产品需求](productnew/README.md) | 产品定位、六个业务模块（含外部 Agent 接入）、用户结果与首版范围 | 首次理解产品 |
| [用户流程](productnew/journeys.md) | 从项目接入到待办、交付、结算和接续；新项目从需求文档或已有代码起步 | 讨论端到端行为 |
| [产品验收](productnew/acceptance.md) | 可观察产品场景 | 制定验证与交付 |
| [技术设计](technicalnew/README.md) | 总图、子图与各链路实现契约的导航 | 技术设计/实施前 |
| [前端设计契约](technicalnew/ui-design.md) | 浏览器界面的布局、令牌、组件、会话面与验收门禁 | 界面设计/实施前 |
| [缺口登记](technicalnew/gap-register.md) | 已实现界面的缺陷、后端缺失的方法与会话合同偏差，及逐项处置决定 | 继续补功能前 |
| [待办与规格](productnew/modules/backlog-and-specs.md) | 待办、规格、模块地图与 Task 契约的分工，以及从不同起点开始工作 | 记录待办、组织设计、实施 |
| [项目知识](productnew/modules/project-knowledge.md) | 权威文档、模块内聚、按需加载与项目记忆 | 整理文档/上下文/结算 |

技术细节按 technicalnew/README 的链路索引加载，不默认读取所有文档。当前产品需求是行为依据，技术设计是待实现契约；运行验证状态见下方。

## 当前状态

- productnew：当前产品需求，明确待办（想法）→ 统一设计角色形成规格与切片清单（用户确认）→ 实现 Task（验收 + 范围）→ 固定保存的 Plan → 开发 → 独立 Review/Test → 结算；Task 只分只读/修改，采用主管总体 Plan、显式当前步骤、全部子 Session 聚合/超时状态与宿主直接处理通用交互。
- 设计流水线（本轮）：项目页按想法/设计中/就绪/实施中/已完成投影；`workKind` 选择设计/实施/文档/调查完成链；主设计独立 Review 后由用户确认切片，切片记录产生它的设计 Task，原想法的拆分去向可追溯；设计 Review 绑定规格/模块图，实施可用 J-10 在原 Task 补设计。证据见验证记录。
- 会话归档：主管会话可归档到左侧“已归档”折叠区并恢复；归档保留历史、Task、报告和项目文件，忙会话/当前 Task 不能归档；归档不是删除。证据见验证记录。
- technicalnew：当前角色/工具、待办格式、消息/存储/恢复与上下文装配；模型提问采用官方 question 移植扩展，通过原生交互消息接入 WAL 和主管通道，与前端渲染分离。见[七角色与工具入口](technicalnew/agents-and-tools.md)、[待办格式](technicalnew/backlog-format.md)、[验证记录](technicalnew/validation.md)。**待办模型已按工作包实施**：存储、引用解析、Task 契约、RPC/MCP、项目页与角色/提示词切换均已落地；真实模型下 `check:workflow`（完整 Task 流程）与 `check:backlog`（初始化/新增/修号）均通过，产品验收的界面走查（J-12/J-13、AC-51～AC-58）尚未执行，见验证记录。原缺口 P10/S9/S10/D10 已关闭。恢复只核实原生历史/已知成果后续办；业务判断交 Agent，程序核对身份/状态/必要报告/版本/保存。当前审阅状态以验证记录为准，文档检查不证明 SDK、模型或产品可用。提示词层现有两条硬规则：删除不得伪装(base/specialists/chief)、派发必须在 instructions 里写明经 `agent_report` 提交；证据与未覆盖项见验证记录。
- 前端：React 19 + Vite 7 单页应用，构建产物由同一 Server 托管在 `/`（`/app/*` 301 到同路径；产物不入库，缺失时会话入口提示构建）。登录屏与会话/项目/设置三屏在同一外壳内。契约见[前端设计契约](technicalnew/ui-design.md)与[A7](technicalnew/architecture.md#a7-前端层)。
- 实施状态：已实现部分按既有设计实施并持续验证，逐个工作包的证据、边界与未执行项记在[验证记录](technicalnew/validation.md)与各工作包结算记录；该表不等同于产品验收。产品验收仍按 [acceptance](productnew/acceptance.md) 逐条执行，未执行项不得视为通过。
- 质量门：标准代码 Test 需包含真实失败的负向控制/检查器自检；Review 检查期望值来自验收、独立事实或不变量，不以全绿数量代替。D-05、AC-46、Tester/Reviewer/Chief 提示词已更新；项目级结算与交付门禁见 `AGENTS.md`。
- 已知缺口：项目/会话列表方法、任务变更推送、重绑定入口、外部会话标记均已实现（`project.list`/`session.list`、会话流内 Task 通知、ProjectDialog 重绑定、会话列 `MCP` 标记）。仍登记未做的项见[缺口登记](technicalnew/gap-register.md)：F1 会话 fork、S8 订阅账号 OAuth、R6 报告缺失的程序层兜底；C8 宿主唤醒只在 run outcome 后评估，按用户决定暂不处理。文件与报告查看（U11）已实现：统一的文件查看画布 + 只读字节路由，报告正文与其内链接走同一条解析。

验证记录只说明当前证据，不替代实现契约。
