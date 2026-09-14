# 产品需求与验收目录

版本：2.0。每个AC为发布必验契约；测试输出必须关联AC、输入版本、实际步骤和证据。以下Given/When/Then是测试设计输入，测试由实现工作包编写运行，当前文档检查不能代替Runtime验收。

## 1. 需求索引

| 需求ID | 能力 | 规范 |
|---|---|---|
| REQ-ASSIST-001 | 主管自由协作与授权 | [规则](../product/experience.md) |
| REQ-WFL-001 | 分级交付与决定 | [规则](../rules/workflow.md) |
| REQ-PRJ-001 | 项目与初始化 | [规则](../product/knowledge.md) |
| REQ-CTX-001 | 主管选择与独立上下文 | [规则](../rules/agents.md) |
| REQ-MEM-001 | 功能知识与结算 | [规则](../product/knowledge.md) |
| REQ-ROLE-001 | 多模型专业角色与调度 | [规则](../rules/agents.md) |
| REQ-PERM-001 | 权限与产物安全 | [规则](../architecture/execution.md) |
| REQ-RUN-001 | 执行、集成和恢复 | [规则](../architecture/reliability.md) |
| REQ-UI-001 | 工作台交互 | [规则](../product/experience.md) |

## 2. 验收用例

### AC-001 自由问答

关联：REQ-ASSIST-001。Given 存在带来源的模式说明及代码；When 用户询问实际逻辑；Then Chief按需调查并区分事实/未知，Work完成且无Requirement。

证据：读取记录、回复来源、DB查询。

### AC-002 HTML说明

关联：REQ-ASSIST-001。Given 用户要求解释模式并输出HTML；When 直接协作生成产物；Then 隔离预览与下载可用，仅Artifact写入，无交付Gate/源码变更。

证据：HTML、浏览器检查、领域事件。

### AC-003 按需委派

关联：REQ-ASSIST-001。Given 说明需要代码调查和页面制作；When Chief分派Backend/Frontend；Then 独立Session且purpose为analysis/artifact，结果交Chief汇总。

证据：DispatchSpec、Snapshot、产物。

### AC-004 执行授权边界

关联：REQ-ASSIST-001。Given 用户仅询问能否优化；When Chief发现改进点；Then 可调查并建议，未授权不启动交付。

证据：消息与授权记录负例。

### AC-005 明确启动

关联：REQ-ASSIST-001。Given 用户明确修复具体目标；When Chief路由；Then 原消息作为范围授权，范围内无重复确认。

证据：Assessment/authorization_ref。

### AC-006 混合意图

关联：REQ-ASSIST-001。Given 一消息同时要求说明和修复；When Chief拆分；Then 关联多个Work，各自范围和输出独立，解释可先返回。

证据：Work来源和结果。

### AC-007 L1错字

关联：REQ-WFL-001。Given 明确普通错字且符合L1条件；When 修改执行；Then 一句话Plan、独立执行/Review/Settlement，直到CAS和CompletionManifest完成均无Planning/Test Run和看板建单。

证据：Diff、Run列表、完成清单。

### AC-008 一字语义

关联：REQ-WFL-001。Given 一字符改变权限或金额；When 分类；Then 命中L3，不按行数降级，所需用户行为决定已保存。

证据：Assessment与Gate负例。

### AC-009 L1升级

关联：REQ-WFL-001。Given 实际Diff超过3文件/20行或出现逻辑改动；When 写入范围扩展前重评；Then 升级L2或L3、同Work关联Requirement、补齐Gate。

证据：任务版本和拒绝旧Plan证据。

### AC-010 标准交付

关联：REQ-WFL-001。Given 有效ProductDefinition；When L2实现；Then 独立Plan/Develop/Review/Test/Settlement依序有效。

证据：阶段Manifest链。

### AC-011 高风险交付

关联：REQ-WFL-001。Given 数据迁移需求；When L3实施；Then 存在明确授权、回退、逐项审核和恢复演练证据。

证据：Plan、迁移/恢复输出。

### AC-012 正式结论

关联：REQ-WFL-001。Given 用户只要求保存确认设计；When document路线；Then Product/Planning候选Diff、独立Review、Settlement，无代码测试或开发Requirement。

证据：文档Diff、来源、Run。

### AC-013 无效Plan

关联：REQ-WFL-001。Given 无批准Plan的代码写请求；When Broker校验；Then GATE_NOT_READY且源码Hash不变。

证据：工具拒绝、前后Hash。

### AC-014 范围内自动Plan

关联：REQ-WFL-001。Given 已授权目标/权限/预算且无新产品选择；When 提交合规Plan；Then 自动批准保存依据并由Chief续派。

证据：PlanRef、审批依据。

### AC-015 产品变化

关联：REQ-WFL-001。Given 执行中发现行为选择；When 用户选本次处理；Then 先Decision与新Product/Plan，旧受影响证据失效。

证据：版本与事件顺序。

### AC-016 以后或拒绝

关联：REQ-WFL-001。Given 有产品变化建议；When 用户选以后/不采纳；Then 以后创建Queued；拒绝留原因；当前验收不变。

证据：两个分支DB断言。

### AC-017 自动返工

关联：REQ-WFL-001。Given Review发现范围内缺陷；When 返回开发修复；Then 无需人工转发，新独立Review/Test，旧结果无效。

证据：Finding闭环、Run链。

### AC-018 Finding关闭

关联：REQ-WFL-001。Given Developer标addressed；When 尝试自己verified；Then 拒绝；独立Review验证后关闭。

证据：角色负例、报告。

### AC-019 未覆盖验证

关联：REQ-WFL-001。Given Test有not_covered或blocked；When 请求完成；Then blocked不完成；未覆盖需明确适用风险处置。

证据：Gate正负例。

### AC-020 暂停恢复

关联：REQ-WFL-001。Given 活动修改；When 用户暂停再恢复；Then 安全点暂停、无新写入，版本检查后新Attempt。

证据：进程、工具、Checkpoint。

### AC-021 取消需求

关联：REQ-WFL-001。Given 含活动子Run；When 用户取消；Then 安全结束前为cancelling/recovery，结束为cancelled，保留成果不集成。

证据：状态、ref、证据。

### AC-022 预算止损

关联：REQ-WFL-001。Given 并发调用接近限额；When 尝试预留超额或超返工；Then 原子拒绝；用户增加预算后继续，无静默加额。

证据：预算账本、事件。

### AC-023 无注册多项目

关联：REQ-PRJ-001。Given 两个真实Git根；When open并切换；Then 各自独立Project ID/数据，切换不影响运行。

证据：DB/Run/界面。

### AC-024 路径识别

关联：REQ-PRJ-001。Given 同仓库不同子目录/符号路径；When open；Then 归一同Project；嵌套仓库独立并排除父访问。

证据：path测试。

### AC-025 空项目

关联：REQ-PRJ-001。Given 空目录；When create；Then 建立初始Git与交付分支，确认设计仍标未实现。

证据：Git、Feature状态。

### AC-026 旧项目初始化

关联：REQ-PRJ-001。Given 无知识且有代码测试；When initialize；Then 预算内调查，来源/未知明确，代码不移动，初始化无开发Requirement。

证据：读取清单、Diff。

### AC-027 目录项目

关联：REQ-PRJ-001。Given 无Git且用户只询问；When 调查后尝试正式写入；Then 问答可完成；正式写入先获得Git初始化授权。

证据：两类Work结果。

### AC-028 脏工作区

关联：REQ-PRJ-001。Given 用户文件未提交；When 启动交付；Then 保留数据并阻断到明确处置；只读调查仍可用。

证据：Hash和提示。

### AC-029 初始化冲突中断

关联：REQ-PRJ-001。Given 已有文档且writing中断；When 重试；Then 核对Hash恢复，冲突不覆盖，Ready符合最小门禁。

证据：故障点与恢复输出。

### AC-030 Chief选上下文

关联：REQ-CTX-001。Given Chief指定来源与原因；When 创建专业Run；Then Snapshot忠实记录选择；Builder只校验补齐必需项请求。

证据：Selection/Snapshot对比。

### AC-031 缺上下文

关联：REQ-CTX-001。Given 缺有效验收/Plan；When 开始Review；Then MISSING_CONTEXT，Chief补齐后可执行。

证据：正负调用。

### AC-032 追加读取

关联：REQ-CTX-001。Given Agent发现关联调用方；When 有理由搜索；Then 只读授权范围，追加ledger，最终结果关联完整Hash。

证据：read ledger。

### AC-033 独立审核

关联：REQ-CTX-001。Given Developer聊天含误导结论；When Review启动并尝试读取聊天；Then 输入和工具均不可访问聊天；可查相关代码。

证据：ACL及容器负例。

### AC-034 跨项目隔离

关联：REQ-CTX-001。Given A的SourceRef/Artifact用于B；When 读取/快照创建；Then NOT_FOUND/CONTEXT_FORBIDDEN，B不含A内容。

证据：API及挂载负例。

### AC-035 会话轮换

关联：REQ-CTX-001。Given 原Session满或暂停；When 新Session恢复；Then 角色/任务/权限和来源正确，旧摘要不改批准状态。

证据：Session ID、快照。

### AC-036 预算不足

关联：REQ-CTX-001。Given 关联上下文超过限制；When 扩展；Then 报告具体缺口，由Chief重新选择或请求预算，不全库注入。

证据：Manifest/用量。

### AC-037 当前功能

关联：REQ-MEM-001。Given 功能经过两次需求修改；When 新会话查询；Then 从功能正文找到最新行为和约束，无需读全部需求历史。

证据：冷启动答案与读取。

### AC-038 状态分离

关联：REQ-MEM-001。Given 已确认设计尚未实现；When 查询design/delivered/work；Then 明确设计、实现、验证与工作目标，其他Work不被污染。

证据：三视图响应。

### AC-039 语义关系

关联：REQ-MEM-001。Given 订单依赖支付规则；When 新增取消任务；Then 相关支付约束和来源进入选择，无关文档不默认加载。

证据：固定样例Snapshot。

### AC-040 非法知识

关联：REQ-MEM-001。Given 重复ID/缺字段/坏链接；When 投影构建；Then 非法格式拒绝发布，保留最后有效并标stale，相关断链阻断。

证据：解析器负例。

### AC-041 知识结算

关联：REQ-MEM-001。Given 代码/接口路径变化；When 完成；Then 更新功能/关系/入口和失效说明，冷启动能发现。

证据：最终文档、链接、查询。

### AC-042 观察与意图

关联：REQ-MEM-001。Given 代码与设计冲突；When 初始化/调查；Then 分别记observed与confirmed，列差距不擅自认可行为。

证据：Feature与来源。

### AC-043 独立模型

关联：REQ-ROLE-001。Given 角色配置不同Provider；When Chief触发各角色；Then 实际配置与角色一致，所有专业Run独立。

证据：Config/Snapshot/Run。

### AC-044 配置冻结

关联：REQ-ROLE-001。Given 活动Run已创建；When 修改模型或恢复继承；Then 仅新Run生效，原Run配置可查询，无隐式换模型。

证据：配置版本测试。

### AC-045 主控分派

关联：REQ-ROLE-001。Given 专业Agent请求其他角色；When 调用request_dispatch；Then 只产生Chief待办；Chief选择Context并派发，无孙Run。

证据：权限负例。

### AC-046 Join和失败

关联：REQ-ROLE-001。Given 两个子Run且一个required失败；When 等待all；Then 兄弟保留，父可获全部结果，相关Gate阻断；新Chief消息可处理。

证据：并发状态测试。

### AC-047 结构化交付

关联：REQ-ROLE-001。Given 专业Agent口头完成或两次Schema错误；When 提交；Then 口头不通过，二次错误contract_violation。

证据：stage结果负例。

### AC-048 Workspace边界

关联：REQ-PERM-001。Given 无Docker或目录/网络越权；When 准入/执行；Then 缺环境拒绝；容器及Broker阻止越权，源码只读者不可写。

证据：doctor、容器检查。

### AC-049 Autonomous范围

关联：REQ-PERM-001。Given 已授权Work角色/期限/目标；When 范围内外操作；Then 范围内继续，超范围权限决定；过期Grant无效。

证据：工具授权正负例。

### AC-050 Full Access门禁

关联：REQ-PERM-001。Given 宿主开发执行；When 尝试绕Review或读验证者无权数据；Then 领域Gate保留，Review/Test仍隔离。

证据：权限/状态负例。

### AC-051 Secret隔离

关联：REQ-PERM-001。Given Provider和项目命令凭证；When 模型/工具运行；Then 只在受权用途注入，UI/Artifact/日志不含已知Secret。

证据：诱饵凭证扫描与环境。

### AC-052 HTML安全

关联：REQ-PERM-001。Given 产物脚本尝试读取cookie/网络/父页；When 预览；Then 被隔离阻止，正常静态说明可用。

证据：浏览器攻击样例。

### AC-053 信任与资源

关联：REQ-PERM-001。Given 未信任仓库有自动加载扩展；When open/createSession；Then 不执行，Trust后也只有选择的Skill/内置资源可用。

证据：Loader轨迹。

### AC-054 UI断开

关联：REQ-RUN-001。Given 运行中关闭BFF/浏览器；When 后台继续并重连；Then Run状态与执行继续，按水位同步。

证据：headless测试。

### AC-055 幂等接受

关联：REQ-RUN-001。Given 响应前断线；When 相同键重发；Then 同实体/结果；同键不同载荷冲突。

证据：command/event计数。

### AC-056 Mailbox非阻塞

关联：REQ-RUN-001。Given 长模型/工具未完成；When 同Project消息/取消；Then 1秒内处理准入和响应，不排在长任务之后。

证据：受控测试桩时序。

### AC-057 Runner失联

关联：REQ-RUN-001。Given 写入后结果未回；When 超lease/restart；Then interrupted/recovery，无重复副作用或双写者。

证据：kill点与Hash。

### AC-058 过期结果

关联：REQ-RUN-001。Given 旧epoch返回成功；When 新决定/取消已生效；Then 拒绝覆盖但保留诊断。

证据：事件版本测试。

### AC-059 背压

关联：REQ-RUN-001。Given 慢连接大量Token；When 超过软硬限；Then 临时流合并、必要时断开，关键事件持久，其他Run继续。

证据：队列负载。

### AC-060 范围订阅

关联：REQ-RUN-001。Given 过滤ACK后扩大范围；When 重新订阅；Then 快照+C后事件覆盖新增范围，过期cursor明确重同步。

证据：事件集合比较。

### AC-061 启动恢复

关联：REQ-RUN-001。Given daemon在Starting/Running崩溃；When 重启；Then 核对进程/epoch，不按旧字段直接运行。

证据：恢复注入。

### AC-062 集成冲突

关联：REQ-RUN-001。Given 两个已通过Task冲突；When 最终集成；Then 独立修复任务并重新验证最终组合，CAS保护HEAD。

证据：Git样例与Manifest。

### AC-063 部分结算

关联：REQ-RUN-001。Given ref更新后DB完成前崩溃；When 恢复；Then 复用提交、补齐状态且一次完成事件。

证据：operation记录。

### AC-064 备份恢复

关联：REQ-RUN-001。Given 有完成与活动Work；When backup再restore；Then Hash/知识/证据一致，活动Run需恢复，缺Secret阻断。

证据：新目录演练。

### AC-065 Migration

关联：REQ-RUN-001。Given 版本升级或checksum错误；When 启动；Then 备份事务迁移；错误停止、不运行Agent。

证据：schema日志。

### AC-066 SDK契约

关联：REQ-RUN-001。Given 锁定Pi版本；When 运行适配测试；Then 创建/流式/工具/abort/压缩/恢复/订阅与资源符合契约。

证据：实际SDK测试。

### AC-067 扩展故障

关联：REQ-RUN-001。Given Critical或可选内置失败；When 启动/运行；Then Critical阻断，可选独立禁用，未知ID拒绝。

证据：故障模拟。

### AC-068 看板身份

关联：REQ-UI-001。Given Queued启动完成归档/取消；When 状态投影；Then 同Requirement ID，无复制对象；L1不自动入板；Queued无Work也能直接取消，暂停Queued返回INVALID_STATE。

证据：E2E和DB。

### AC-069 持续对话

关联：REQ-UI-001。Given 各阶段活动；When 发送新消息；Then Composer可用，消息处理状态真实，意见由Chief路由。

证据：E2E/事件。

### AC-070 产物版本

关联：REQ-UI-001。Given 有过期Plan和大Diff；When 打开/批准/下载；Then 版本显示、过期拒绝、截断提示与完整下载。

证据：E2E/API。

### AC-071 Live布局

关联：REQ-UI-001。Given Open/Compact/Hidden；When 跨页/窄屏切换；Then 共享宽度/状态、顶栏恢复、焦点正确，不影响Run。

证据：viewport截图/Run状态。

### AC-072 Conversation归属

关联：REQ-UI-001。Given 进入非Chief页面；When 渲染与讨论；Then 无创建切换控件，来源深链接进入Chief。

证据：E2E。

### AC-073 语言可访问

关联：REQ-UI-001。Given 键盘操作及语言切换；When 页面/弹层使用；Then 焦点、ARIA及标签可用，项目内容不被翻译。

证据：a11y与i18n检查。

### AC-074 Inbox去重

关联：REQ-UI-001。Given 相同决定和非阻断修复；When 多次事件；Then 决定按目标版本一项，内部修复汇总，过期决定禁用。

证据：E2E。

### AC-075 配置错误

关联：REQ-UI-001。Given 模型不支持reasoning或连接失败；When 保存/测试；Then 清晰校验、保留输入，活动配置不变。

证据：Provider桩。

### AC-076 附件限制

关联：REQ-UI-001。Given 超数量/大小/错误mime；When 上传；Then 客户端提示且服务端拒绝，无残留引用。

证据：HTTP测试。

### AC-077 文件只读

关联：REQ-UI-001。Given 切换分支预览文件；When 浏览/搜索；Then 目标Revision正确、根边界生效，不改变Agent Snapshot。

证据：API/E2E。

### AC-078 认证生命周期

关联：REQ-UI-001。Given 未登录/过期cookie/错误Origin；When HTTP/WS写请求；Then 拒绝、退出失效、受限重试，后台Work保留。

证据：安全HTTP/WS测试。

### AC-079 初始阶段上下文

关联：REQ-CTX-001。Given 空项目无概览/Product/Plan，或L1仅CompactPlan；When 分别启动initialize/Product/Planning/L1 Develop；Then 按阶段必需表合法启动，缺未来产物不形成循环；真正缺上游输入才拒绝。

证据：四个Context正例与负例。

### AC-080 授权精确绑定

关联：REQ-PERM-001。Given 同Work两个同角色Run，once工具响应丢失；When 兄弟窃用run Grant或重试once；Then 兄弟拒绝；once绑定操作/输入Hash，原子消费且重试原操作返回原结果。

证据：Grant/工具事务断言。

### AC-081 Task依赖输入

关联：REQ-RUN-001。Given A新增接口，B依赖A使用该接口；When A通过后启动B再集成；Then B输入含A的冻结成果，Task与Manifest有准确dependencyRevision/dependencyManifestRefs，祖先变化使B失效，最终集成祖先不重复应用。

证据：Git树、dependencyRevision、Manifest。

### AC-082 重启保留窄范围

关联：REQ-ROLE-001。Given 无Task调查Run只获一个文件范围；When 重启恢复后试读其他Work文件；Then 按DispatchSnapshot保持窄权限和输出Schema，Work宽范围不能替代。

证据：持久快照/工具负例。

### AC-083 组合及文档Finding

关联：REQ-WFL-001。Given 无Task文档或集成Review发现问题；When 提交Finding并修复；Then 绑定Review目标/Manifest，无需伪造taskId；修复后独立核验关闭。

证据：Finding及新Review。

### AC-084 首条消息附件

关联：REQ-UI-001。Given 新Conversation无Work/Run；When 上传附件再发送首条消息；Then 普通无附件用户/系统消息可用message_body存储；staged附件成功原子绑定新Work；失败可重试、过期清理、重复绑定拒绝。

证据：HTTP与DB端到端。

### AC-085 证据读取封口

关联：REQ-CTX-001。Given Agent追加读取后提交阶段结果；When 使用旧ledger Hash或提交后再读取；Then 旧Hash拒绝，正确seq/hash封口，后续工具拒绝或使结果失效。

证据：ledger和Manifest。

### AC-086 功能状态证据

关联：REQ-MEM-001。Given Feature字段声称confirmed/passed/investigated；When 缺确认/验证/调查来源或引用版本错；Then 解析拒绝发布状态，完整有效样例通过。

证据：格式正负例。

### AC-087 需求池随Git迁移

关联：REQ-MEM-001。Given 空白服务器仅Clone含queued需求的项目，没有原数据库或模型配置；When 可信打开项目；Then 保留稳定需求ID、目标、范围、验收、已确认结论与未决项，列表可用，无需重新初始化产品知识。

证据：临时Git仓库、独立SQLite与Core/UI集成演练；记录提交和实际事件。

### AC-088 历史需求展示

关联：REQ-MEM-001。Given Git含completed、cancelled和archived需求；When 新服务器导入；Then 完成摘要和功能/代码引用可查，取消原因及归档前状态保留，缺旧报告标详细证据未迁移，不能据此放行本机验证。

证据：临时Git仓库、独立SQLite与Core/UI集成演练；记录提交和实际事件。

### AC-089 进行中需求继续

关联：REQ-MEM-001。Given Git含active需求且无本机Work；When 打开后点击继续；Then 先显示待继续且不启动Run；用户继续后创建新Work，取得本机授权，从未满足Gate重新规划验证。

证据：临时Git仓库、独立SQLite与Core/UI集成演练；记录提交和实际事件。

### AC-090 需求保存时机

关联：REQ-MEM-001。Given 创建或修改需求但尚未开发；When 执行保存并推送保存所在分支，再于新服务器拉取；Then Git立即含需求及索引；仅Git与投影一致后显示已保存，失败通过requirement.save.retry恢复原操作，Git已提交时仅补投影且不重复提交；界面展示分支、提交与未推送状态。

证据：临时Git仓库、独立SQLite与Core/UI集成演练；记录提交和实际事件。

### AC-091 需求保存崩溃与交付竞争

关联：REQ-MEM-001。Given 需求保存与代码交付共享Project集成锁；When 在Git CAS前后注入退出并重试，同时交付旧基线Task；Then 不重复保存或静默丢需求，新代码提交包含最新需求池，完成记录与结算一致，metadata变更不冒充代码验证。

证据：临时Git仓库、独立SQLite与Core/UI集成演练；记录提交和实际事件。

### AC-092 需求导入冲突与幂等

关联：REQ-MEM-001。Given 重复ID、同版本异内容、缺失记录与有效需求混合；When 导入两次；Then 有效记录正常可见且幂等；冲突逐条显示REQUIREMENT_CONFLICT，不静默覆盖或删除；本机version和recordVersion分别处理；拉取已更新Git但投影未刷新时保存必须拒绝覆盖；用户修复Git后显式导入可解除冲突，再基于新投影保存。

证据：临时Git仓库、独立SQLite与Core/UI集成演练；记录提交和实际事件。

### AC-093 需求目录与正文一致性

关联：REQ-MEM-001。Given 每需求包含requirement.json与content.md，另有README缺失、单文件缺失、Hash错、被Git忽略和旧格式样例；When 保存、Clone导入及加载Context；Then 两文件共享版本并原子提交，正文修改递增版本且组合Hash改变；列表无需AI解析，正文可读；README可重建，其他错误逐条明确显示；依赖需求的Product/Plan加载两份同Revision来源且冲突不得放行。

证据：实际Git/SQLite集成、缺文件与Hash负例、Context账本和UI保存结果。

### AC-094 需求正文保存与并发

关联：REQ-MEM-001。Given Git已有其他服务器更新的content.md及配套Hash而本机投影未刷新；When 保存旧元数据或在两文件提交前后注入退出；Then 组合recordHash校验拒绝旧投影覆盖，恢复不会暴露半对文件；显式修复后可导入再保存，完成/归档保持目录和引用不变，完成摘要两份一致。

证据：并发保存与崩溃恢复集成演练。

## 3. 测试层和退出

- 单元：Schema、状态、Gate、等级、授权和预算；采用确定性测试，不调用真实模型。
- 集成：实际SQLite、临时Git、容器、Pi适配器、WebSocket；故障点可控。
- E2E：真实Core+BFF+真实HTTP/WS的无头端到端（`pnpm test:e2e`，用Provider桩确定结果且断言桩零调用），并在同一命令内运行 `tests/browser/**` 的真实Chromium浏览器演练；真实模型的问答HTML、L1修改、L2跨功能交付由 `pnpm test:live` 对用户配置的Provider执行。
  - 已撤销偏差（原 WP-10 plan.md §2 D1，用户已确认撤销）：WP-12 T7a 起引入仅开发依赖的 Playwright 与 Chromium，AC-002、AC-052、AC-071、AC-073、AC-076 的浏览器侧子句（隔离/攻击样例、viewport与焦点、键盘与ARIA、客户端上传提示）在真实浏览器中执行并逐项取证；仅当本环境没有可运行的 Playwright/Chromium 时才登记 UNVERIFIED，且该豁免条件由 `scripts/lib/drill-acs.mjs` 现场判定。
- 冷启动：新Session独立查找知识；记录期望事实集合和实际来源，必须全部找到样例关键约束。
- 故障：在接受命令、写文件、产物落盘、Git提交、CAS、完成事务前后注入进程退出。

测试报告每AC记录passed/failed/not_covered/blocked、命令/观察、输入Revision、环境和产物Hash。未通过项不能标产品发布完成；用户明确接受的特定未覆盖风险需保存Decision并在发布记录显示，强制权限/独立性/授权不变量不以风险接受绕过。

## 4. 基准样例

fixture/new：空仓库，确认“未付款订单可取消”，设计confirmed且实现absent。
fixture/legacy：订单与支付模块，README不完整，测试至少覆盖付款/未付款两条路径，无历史需求。
fixture/related：取消与支付状态关系、20份无关文档、一个已知未覆盖项；两次修改后冷启动验证当前行为。
fixture/review：冻结Diff含取消竞态错误，开发Transcript写错误的“已处理”结论；Reviewer只能访问正式依据和代码，必须识别缺陷。
fixture/recovery：工具按可控信号暂停在写入后/结果前，验证不重放。

各fixture是测试仓库而非用户仓库；版本和期望值由测试提交固定，Review确认其覆盖真实契约。
