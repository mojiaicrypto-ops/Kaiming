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

WP-03（直接协作与说明产物）已按 L2 实现并完成独立 Review/Test：`packages/domain` 提供确定性 Chief 路由（消息 → Work 项与授权判定，默认拒绝的文法：命令子句 = 变更动词 + 单一命名路径，或 `把/将/对 + 目标 + 动词`；拒绝/陈述/疑问/条件/意见/引用/前件一律只读），`packages/core` 提供附件暂存与原子绑定（数量/单文件/总量/mime 限制、TTL、重复绑定拒绝）、版本化 Artifact（agent 产物绑定 Run、user 产物绑定 Attachment、ACL、版本链）、HTML 隔离预览（CSP `default-src 'none'`、sandbox `allow-scripts`、无 cookie、1 MiB/2000 行截断、60 秒单次下载 token）与 `conversation.message.send` 事务；`apps/daemon` 提供 HTTP 面（健康检查、上传/删除、预览、下载准备与下载、消息发送含幂等账本）。21 轮独立 Review（末两轮 PASS）与 1 轮独立 Test（PASS）在代码树 `7512159` 上通过（unit 19 文件/289 用例、integration 10 文件/124 用例含真实容器）；AC-001/002/004/005/006/052/076/084 有证据，AC-003 的委派实体（DispatchSpec/快照/独立 Session）承接 WP-04/06，路由的丰富自然语言语义属已登记的 fail-closed 代价、由模型 Assessment 接管；证据链见 `.agentdev/work/WP-03/`。

WP-04（知识与新旧项目）已按 L2 实现并完成独立 Review/Test：`packages/knowledge` 提供 Feature 规范 Markdown 的解析与校验（字段/枚举/证据规则/重复 ID ⇒ `KNOWLEDGE_INVALID`）、来源与关系诊断、投影与三视图（design/delivered/work，含 gap 与 observed/confirmed 分离）、非法知识不发布并保留最后有效标 stale、需求池（`requirement.json` + `content.md` + README）解析与幂等导入（逐条 `REQUIREMENT_CONFLICT`、`REQUIREMENT_PATH_IGNORED`、`LEGACY_REQUIREMENT_FORMAT`、历史摘要标「详细证据未迁移」）；`packages/workspace` 提供 Git 端口（真实/内存）、预算化工作区扫描（40 文件 / 512 KiB、10000 条分页索引、嵌套仓库与符号链接处理、仅产出 observed 候选知识）与初始化状态机（Hash 中断恢复、冲突不覆盖、脏工作区阻断、无 Git 授权门禁、`investigateMore`/`confirmNoCapability`、Ready 最小门禁）。4 轮独立 Review（末两轮 PASS）与 2 轮独立 Test（均 PASS）在代码树 `88a5690` 上通过（unit 26 文件/431 用例、integration 10 文件/124 用例含真实容器）；AC-025～029/037/038/040/042/086～088/092/093 有证据，AC-039 的 ContextSelection/Snapshot 选择链路承接 WP-02/WP-05，需求池 SQLite/Core/UI 演练与交付提交留 WP-08；证据链见 `.agentdev/work/WP-04/`。

WP-05（Context隔离与冷启动）已按 L2 实现并完成独立 Review/Test：`packages/core` 新增 Context 层——角色×阶段的 ACL 与 readScope（transcript/聊天对所有角色拒绝、review/test 连 message 正文也拒、跨 Project 与外来 Run 在任何路径判断前拒绝且不含正文）、逐阶段必需项表（AC-079 的初始化/Product/Planning/L1 四类 bootstrap 正例与真缺上游负例）、ContextBuilder（选择为唯一身份权威：path/version/revision/hash 逐项钉死；ACL 先于解析；内容寻址不可变快照冻结；缺项 `MISSING_CONTEXT`；预算不足点名缺口且绝不全库注入）、只追加 read ledger（seq/path/revision/hash/reason/size、`context.request`+grant 扩展、`seal()` 封口与旧 Hash 拒绝）、Run Checkpoint（只来自当前 Run、会话轮换、Compaction 不改批准状态）与冷启动装配（固定样例召回当前行为/约束/测试路径/差距、20 份无关文档不注入、transcript 双重把关与 realpath 包含性）。4 轮独立 Review（末两轮 PASS）与 1 轮独立 Test（PASS）在代码树 `0e047ab` 上通过（unit 32 文件/644 用例、integration 10 文件/124 用例含真实容器）；AC-030～036、079、085、093 有证据（AC-033/034 的容器挂载级负例承接 WP-07，Checkpoint 落库与 `stage_result.read_ledger_*` 接线承接 WP-08/09）；证据链见 `.agentdev/work/WP-05/`。

WP-06（分级交付与独立验证）已按 L2 实现并完成独立 Review/Test：`packages/domain` 新增交付规则（L1 资格与边界、一字符高风险直判 L3 不降级、超 L1 升级与旧 Plan 失效、L2/L3/document/operation 阶段链与结构化证据、写入门禁与 Plan 自动批准、Decision 三分支与证据失效、Finding 生命周期与完成门禁、证据有效性 + Revision 血缘共享规则、写屏障白名单、原子预算预留），`packages/core` 新增 `PlanGateService`（Plan/批准/失效/版本以不可变记录持久化，决策前后测量源码 Hash 与行数）、`DecisionService`、`FindingService`（提交/修复/验证/完成 + 暂停/恢复/取消与屏障，按 Work intent 推导完成路线，代码 L2/L3 需 Review+Test 双证据）与 `RequirementContinuation`（待继续不建 Run，继续创建新 Work + 本地授权 + 未满足 Gate）。4 轮独立 Review（末轮 PASS）与 1 轮独立 Test（PASS）在代码树 `b0d226f` 上通过（unit 38 文件/757 用例、integration 11 文件/132 用例含真实容器）；AC-007～022/083/089 有证据（AC-011 真实迁移演练与 AC-022 完成期预算复核标 UNVERIFIED，承接 WP-08/WP-10；工具级写准入与容器隔离承接 WP-07）；证据链见 `.agentdev/work/WP-06/`。

WP-07（权限、工具和测试环境）已按 L2 实现并完成独立 Review/Test：`packages/core` 新增 `GrantStore`（签发/撤权/覆盖，`once` 绑定 operation+inputHash 的原子认领与幂等重放，兄弟 Run 隔离，跨进程可重放且 GC 安全的结果存储）、`SecretStore`（Grant 校验后解析、按用途注入环境、脱敏与泄漏扫描，查询面永不返回值）、工具 `Broker`（能力分类准入 + `tool_operation` 审计、容器/宿主两种模式且无 Docker 绝不回退、realpath 文件边界、逐跳网络策略含 DNS 解析/IPv4-mapped/NAT64/HTTPS 与地址钉扎、只读角色报告写边界）与隔离测试环境（OS 端口探测与进程级认领、就绪归属证明、独立 DB/端口、清理失败上报 `RECOVERY_REQUIRED`）；`packages/pi-runtime` 提供 `loadTrustedExtensions`（未信任零加载、信任后仅「显式选中 ∧ 白名单」、逃逸拒绝与可审计 trace）。4 轮独立 Review（末轮聚焦 PASS）与 1 轮独立 Test（PASS）在代码树 `96e196b` 上通过（unit 44 文件/916 用例、integration 15 文件/157 用例含真实容器）；AC-048/049/050/051/053/080 有证据（P3 残余与工具层接线分别承接 WP-08/WP-09）；证据链见 `.agentdev/work/WP-07/`。

WP-08（集成、结算与恢复）已按 L2 实现并完成独立 Review/Test：`packages/workspace` 提供 per-Task worktree 与单写者租约、依赖血缘（`dependencyRevision`/`dependencyManifestRefs`、祖先失效、已合并祖先不重复应用）与 CAS 集成（`update-ref` 带 expected-old、候选后代校验、journal 崩溃恢复、双 Task 冲突产出独立修复 Task 并可 supersede 收敛）；`packages/core` 提供需求即时保存（共享 `integration:<projectId>` 集成锁、按目标 revision 读取需求池、逐条冲突、提交后只补投影、脏回写门禁）、恢复（按真实进程/epoch 判定、Run 级恢复决策绑定、窄范围保持、备份/恢复/迁移含哈希校验与租约授权回收、缺 Secret 阻断）与结算（最终 Manifest、知识补丁只经投影发布、ref 后崩溃复用提交且恰一次完成事件）。4 轮独立 Review（末轮聚焦 PASS）与 3 轮独立 Test（末轮 PASS）在代码树 `7422646` 上通过（unit 48 文件/975 用例、integration 20 文件/233 用例，真实 Git 与 SQLite）；AC-020/021/022/029/041/057/058/061～064/081～083/090/091/093/094 有证据，AC-054（BFF/浏览器断开）承接 WP-09；证据链见 `.agentdev/work/WP-08/`。

真实 Provider 纵向运行、协议接线（daemon/BFF/WS）、交付门禁、权限隔离、工具执行层、知识投影和恢复仍未实现：`pnpm test:e2e`、`pnpm test:acceptance`、`pnpm test:live` 按契约返回 NOT_IMPLEMENTED，后续按[实施工作包](delivery/implementation.md)的依赖顺序继续。

开发从[实施工作包](delivery/implementation.md)开始，按依赖实现共享Schema与底座，再完成各项能力和[验收](delivery/acceptance.md)。规范中的包路径和工程命令是待交付接口，不能假定已经存在。

本索引列出的文档是当前完整实现依据；产品行为、技术契约、角色/交付规则和验收要求共同适用。不依赖历史任务、旧方案、讨论记录或其他工作流副本。产品知识规范中的PROJECT、CODE_MAP等文件名描述AgentDev为用户项目生成的目标结构，不表示本仓库存在这些入口。
