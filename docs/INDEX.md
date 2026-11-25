# 开明文档索引

当前产品需求与技术契约入口如下；设计要求、源码存在与实际验证分别理解。

| 入口 | 职责 | 何时读 |
|---|---|---|
| [安装与启动](install.md) | 环境、安装、首次配置、备份与 MCP 客户端配置 | 首次部署或升级 |
| [产品需求](productnew/README.md) | 产品定位、六个业务模块（含外部 Agent 接入）、用户结果与首版范围 | 首次理解产品 |
| [用户流程](productnew/journeys.md) | 从项目接入到待办、交付、结算和接续；新项目从需求文档或已有代码起步 | 讨论端到端行为 |
| [产品验收](productnew/acceptance.md) | 可观察产品场景 | 制定验证与交付 |
| [技术设计](technicalnew/README.md) | 总图、子图与各链路实现契约的导航 | 技术设计/实施前 |
| [前端设计契约](technicalnew/ui-design.md) | 浏览器界面的布局、令牌、组件、会话面与验收门禁 | 界面设计/实施前 |
| [下一轮计划与缺口](technicalnew/gap-register.md) | **下一轮开发计划（P0～P3）**、活动风险与历史已关闭缺口归档 | 规划迭代/排障前 |
| [待办与规格](productnew/modules/backlog-and-specs.md) | 待办、规格、模块地图与 Task 契约的分工，以及从不同起点开始工作 | 记录待办、组织设计、实施 |
| [项目知识](productnew/modules/project-knowledge.md) | 权威文档、模块内聚、按需加载与项目记忆 | 整理文档/上下文/结算 |

技术细节按 [technicalnew/README.md](technicalnew/README.md) 的链路索引按需加载，不默认读取所有文档。

## 当前状态与下一步路线

- **已交付基线**：已完成首轮真实项目全周期实战验证。服务端（SQLite WAL、Pi 1.0 SDK、五核心工具 + 外部检索/浏览器 + developer/tester `codemode`、待办与设计流水线 `workKind`、步骤停稳唤醒、空闲按需扫描、报告重试结构账本、Git 交付绑定）共 **66 文件 / 632 用例**通过；前端（React 19 单壳：聊天终端流、项目五列看板、统一文件/报告查看画布 `FileViewer`、分层模型与思考等级、用量统计、会话归档与提醒）共 **20 文件 / 133 用例**及 Playwright 浏览器套件通过；MCP 双传输（stdio + `/mcp`）已落地。详见 [验证记录](technicalnew/validation.md)。
- **下一轮开发计划（P0 → P1 → P2 → P3）**：详见 [下一轮计划与缺口登记](technicalnew/gap-register.md#一-下一轮开发计划-p0--p1--p2--p3)：
  1. **P0（运行期减摩与提速，已实施）**：**P0-1** 专业成员派发信封 + `REPORT_MISSING` 同回合自愈；**P0-2** 结算报告单写对齐；**P0-3** 等待窗口调优 + 步骤停稳唤醒闭环。
  2. **P1（脏工作区交付隔离，已实施）**：**P1-1** Task 级 dirty 基线隔离（schema v20）。
  3. **P2（高杠杆算力与会话分支）**：**P2-1** Claude/ChatGPT 订阅账号 OAuth 接入（待实施）；**P2-2** 主管会话 Fork（已实施）。
  4. **P3（安全沙箱与按需 Worktree 多任务并行，待实施，按序切入）**：**P3-1** OS 级执行安全沙箱（`WP-Sandbox`，无状态 macOS Seatbelt + Linux `bwrap`，与测试编排彻底解耦，优先切入）；**P3-2** 按需 Task 级 Git Worktree 隔离与诚实合流门禁（`WP-Worktree`，先修相对路径权威）；**P3-3** 非阻塞专业并发配额、Worktree 实时文件视图与多任务看板（`WP-Parallel`）。
- **质量门禁**：代码/展示类 Task Plan 显式声明 `visual` / `focused` / `broad` 验证档；标准代码 Test 必须包含按预期失败的负向控制或检查器自检；Review/Test 绑定代码交付路径（将 `docs/**`、根 Markdown 与 `.gitignore` 策略排除在代码重审触发器外，纯文档交付仍绑定文档）。项目级规则与实战教训见 [AGENTS.md](../AGENTS.md)。
