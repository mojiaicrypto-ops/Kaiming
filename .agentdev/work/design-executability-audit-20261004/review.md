# 当前产品与技术设计独立审查

审查日期：2026-10-04。基线：`67f7697db4f36a3625fab783cd765af625e7f31e`。

本记录是审查结果与修正建议，不改变当前产品或技术契约。

## 结论

**整体 Review 仍未通过：3 项 P1、4 项 P2 尚未闭合。DA-03 按已确认的问答边界关闭。**

独立 AI 已能理解要做的产品、五个业务模块、从提案到设计再到实施和结算的主线。主管与专业角色、适用交付责任、WAL 与 Pi 历史的分工也足够清楚。当前不足集中在跨链路的少数执行边界；这些边界还需要实施 Agent 自行决定公共语义，因此尚不能认定整套文档可以无歧义地交给多个 Agent 全面开发。

可以开始 P0 的固定 SDK 接入试验、P1 中不依赖以下缺口的纯存储/接纳/查询工作。专业分析、委派部分阻断、最终完成校验、恢复核实和相关 UI 入口，应先补齐对应契约。无需推翻现有总架构，也无需新增通用工作流引擎或 Finding 状态机。

P1 表示在对应核心链路实施前必须解决的冲突或公共契约缺口；P2 表示功能或异常路径尚不能唯一实现，需要在对应工作包和验收前补齐。等级不是生产事故结论：新架构尚未实施。

## 范围与独立性

- 完整读取当前 AGENTS.md、docs/INDEX.md、productnew 8 份文件和 technicalnew 18 份文件，合计 28 份 Markdown；包括全部角色提示词、需求格式、实现检查和验证记录。
- 三个无会话历史的独立 Agent 分别审查产品规则、运行可靠性、开发者冷读可执行性；主审查者复核交叉契约并合并重复发现。
- 排除 docs/old、历史设计、业务实现与开发聊天。Pi 的局部接口断言只用固定版本主源缓存核对，未执行 SDK、模型、故障或浏览器试验。
- 未将 validation.md 既有 Passed 作为本轮结论。未修改任何被审查的产品、技术或提示词文件。
- 原文版本与排除项见 [上下文快照](context-snapshot.json)。

## DA-01 · P1 · 未授权项目写入时，专业只读分析没有合法路径

位置：[createTask](../../../docs/technicalnew/agents-and-tools.md#createtask)，精确行号：[agents-and-tools.md:31](/Users/huyaohua/huyh/work/aigrouptool/docs/technicalnew/agents-and-tools.md:31)、[同文件:35](/Users/huyaohua/huyh/work/aigrouptool/docs/technicalnew/agents-and-tools.md:35)、[同文件:75](/Users/huyaohua/huyh/work/aigrouptool/docs/technicalnew/agents-and-tools.md:75)。

触发：项目没有 `.dev`，用户只要求专业 Agent 调查，尚未同意或已拒绝项目写入。

证据：[P-02:19](/Users/huyaohua/huyh/work/aigrouptool/docs/productnew/modules/project-workspace.md:19) 允许先只读讨论、调查，写入项目前须同意；[D-02:25](/Users/huyaohua/huyh/work/aigrouptool/docs/productnew/modules/delivery.md:25) 明确仅分析没有修改授权。所有专业委派必须绑定 Task，createTask 无 kind 例外地写项目 Plan，agent_report 写项目报告；同时 G2 声称 analysis 不改变项目文件。[S6:167](/Users/huyaohua/huyh/work/aigrouptool/docs/technicalnew/storage-and-recovery.md:167) 没有另行存储例外。

影响：实现者必须拒绝产品允许的专业调查、违反项目只读授权，或自行发明另一套产物位置。AC-03 与 AC-06 联合场景不能按当前契约同时满足。

最小修正方向：明确 analysis 的 Plan/报告是否保存在 Server，及其可读引用；或者明确过程记录写入所需授权和拒绝后的能力边界，同步修正零项目写入断言。补充未初始化、拒绝写入时的专业调查验收。这是存储与授权边界，不需要新的 Task 类型。

## DA-02 · P1 · 并行批次部分阻断后，没有等待剩余成员的完整路径

位置：[M2:89](/Users/huyaohua/huyh/work/aigrouptool/docs/technicalnew/messaging-and-collaboration.md:89)、[M2:95](/Users/huyaohua/huyh/work/aigrouptool/docs/technicalnew/messaging-and-collaboration.md:95)、[G2:52](/Users/huyaohua/huyh/work/aigrouptool/docs/technicalnew/agents-and-tools.md:52)、[S2:59](/Users/huyaohua/huyh/work/aigrouptool/docs/technicalnew/storage-and-recovery.md:59)。

触发：同批 Review S1/S2 中，S1 提交正式 blocked 报告并停稳，S2 尚在执行。主管处理 S1 的问题并 continue S1。

证据：M2 可以因一个成员正式阻断提前返回。continue 只接续指定 Session，并创建新 workRevision/新批次；原 delegation 成员和原 workRevision 保持不变，只有暂停/恢复的合法 continuation 链可前移。wait 仅接收 delegationId，没有限定成员的等待方式。

影响：等待新批次只能等 S1；等待旧批次又会持续因旧 S1 blocked 立即返回，不能同步等待仍在运行的 S2。将旧成员替换为新修订、轮询或建立新等待协议都需要改变当前公共语义。supersedes/validity 没有规定如何解决原批次的这个关系。

最小修正方向：在 M2 明确一种批次收口策略，例如成员全部停稳后才返回正式 blocked，或者允许按稳定成员范围等待剩余工作；同时规定历史阻断与新批次成果的核对关系。保留原 Session 和历史，不增加 Assignment 对象。增加“一份阻断、另一份仍运行、原 Session 接续”的可靠性场景。

## DA-03 · 已关闭 · 通用问答与业务判断边界

用户已确认：模型决定是否提问及 confirm/select/input 类型，UI 按通用协议渲染，答复写 WAL 后恢复原调用。业务含义由模型判断，不增加业务确认类型、对象绑定字段或业务授权解析。

原发现要求程序机械匹配自然语言批准范围，超出了这一产品边界。当前 G2/M5/S2/S6 已统一：宿主核对真实交互归属、请求与答复事实；主管根据实际问题与答复作业务决定，具体执行工具沿原有参数、授权与控制规则工作。此项不再作为开放缺陷。

本项处置与局部验证见 [question/WAL 工作记录](../question-extension-contract-20261004/settlement.md)。其余七项发现仍开放，不由本次确认链路修改代替修复。

## DA-04 · P1 · basisDigest 与完整文件版本之间缺少公共计算规则

位置：[S2:55](/Users/huyaohua/huyh/work/aigrouptool/docs/technicalnew/storage-and-recovery.md:55)、[S6:194](/Users/huyaohua/huyh/work/aigrouptool/docs/technicalnew/storage-and-recovery.md:194)、[F4:72](/Users/huyaohua/huyh/work/aigrouptool/docs/technicalnew/requirements-format.md:72)。

触发：Review/Test 的依据是需求文件版本 X；结算保存 completed、完成摘要、关联或 updatedAt 后，文件完整摘要变为 Y，随后 endTask 校验当前依据与结果。

证据：DocumentRef.sha256 和 requirement.version 是完整文件摘要；S6 规定生命周期、完成摘要等记录变化不使 basisDigest 失效，但未定义 basisDigest 取哪些材料、如何规范化、哪些字段能排除，以及它与完整 DocumentRef 版本的关系。

影响：直接比较完整文件摘要会使正常结算失效；笼统忽略结算阶段文件改变又可能漏掉目标、行为或验收被改变。各服务会自行创造“实质依据变更”的判定。

最小修正方向：规定验证依据的确定性投影或被许可的精确差异集合，以及当前版本核对算法；完整文件摘要仍用于身份、CAS 和保存回执。对产品/技术知识的事实回填也明确可核对边界，不要求程序理解任意自然语言的语义等价。补充“仅完成记录变化仍有效”和“行为/验收变化必须失效”两组验收。

## DA-05 · P2 · 被控制的 Task 缺少专业只读恢复核实的准入例外

位置：[S3:85](/Users/huyaohua/huyh/work/aigrouptool/docs/technicalnew/storage-and-recovery.md:85)、[S5:128](/Users/huyaohua/huyh/work/aigrouptool/docs/technicalnew/storage-and-recovery.md:128)、[S5:137](/Users/huyaohua/huyh/work/aigrouptool/docs/technicalnew/storage-and-recovery.md:137)、[S7:237](/Users/huyaohua/huyh/work/aigrouptool/docs/technicalnew/storage-and-recovery.md:237)。

触发：暂停或取消时留下 unsafe 操作的未知效果，主管需要 investigator 在该 Task 内只读核实。

证据：Task 控制拒绝所属范围新认领，resume 要先核对未知；所有专业输入又需核对 Task 控制/阶段。S7 允许在当前被恢复 Task 内安排 investigator，但没有规定哪些控制状态、阶段与发起者可接纳这种核实，主管自身 interrupted 时也不能消费普通输入。

影响：文档承诺的专业核实路径可能被自己的控制门禁挡住。宿主或用户手工核实仍有入口，不能据此声称整个恢复系统必然死锁。

最小修正方向：明确只读 recovery 工作的准入状态、发起入口和权限限制；不能恢复原写入，也不能自行解除 unknown。沿原 Task 关联即可，无需新增业务阶段。补充暂停且未知、主管中断时安排核实的场景。

## DA-06 · P2 · 首版 UI 必需能力未进入完整公开接入契约

位置：[R1:30](/Users/huyaohua/huyh/work/aigrouptool/docs/technicalnew/runtime-contract.md:30)、[R5:141](/Users/huyaohua/huyh/work/aigrouptool/docs/technicalnew/runtime-contract.md:141)、[P-05:47](/Users/huyaohua/huyh/work/aigrouptool/docs/productnew/modules/project-workspace.md:47)、[P-06:57](/Users/huyaohua/huyh/work/aigrouptool/docs/productnew/modules/project-workspace.md:57)。

触发：前端 Agent 实现第一次登录、默认/角色/项目模型设置及试连、目录与文本阅读；或者实现产品要求的已结束会话清理。

证据：R1 定义了 RPC 入口与 Session/Task/需求/交互方法，但没有配置查询/保存/试连、文件目录/正文读取、认证进入/退出、会话清理的公开请求/响应。R5 只描述配置服务至少具备什么；认证和路径保护原则不能替代前端与 Server 共用的调用契约。

影响：产品能力已规定，前后端仍必须自行发明方法名、字段、错误与归属，从而违反 R6 不在局部私建公开协议的要求。P6 安装 Plan 可以决定具体启动说明，不能补掉浏览器必需调用接口。

最小修正方向：在同一接入契约补一个简短方法表与必要类型，说明哪些能力经现有 RPC、哪些采用独立认证入口；保留单用户和现有边界。内部配置存储方式和函数组织仍由实现决定。

## DA-07 · P2 · 损坏的需求身份/类型字段没有合法修复规则

位置：[F4:70](/Users/huyaohua/huyh/work/aigrouptool/docs/technicalnew/requirements-format.md:70)、[F4:74](/Users/huyaohua/huyh/work/aigrouptool/docs/technicalnew/requirements-format.md:74)、[F1:7](/Users/huyaohua/huyh/work/aigrouptool/docs/technicalnew/requirements-format.md:7)。

触发：已有 req-a.md 被外部误写成 `kind: impl`，get 返回当前摘要和格式错误，AI 修正为 implementation 后调用 save。

证据：F4 要求未知 kind 等错误修正后通过 save 保存；同时 save 要求原 id/kind 不变，F1 禁止原地类型转换，普通 edit/脚本也被禁止。未定义损坏字段恢复与合法类型转换的区别，AC-08 却要求错误可读取、修复。

影响：恢复合法 kind 违反不可变检查；保留错误 kind 又过不了格式校验。实现者必须自己增加例外或交付不可修复的错误。

最小修正方向：仅对有效记录保持身份/类型不可变，明确损坏修复的 CAS、身份来源和批准依据；无法确定时保留阻断，不猜测。补充非法/缺失 kind、id 与文件名冲突场景，不需要另建写入工具。

## DA-08 · P2 · 取消本次 Task 与取消实施需求的联动未明确

位置：[R-05:61](/Users/huyaohua/huyh/work/aigrouptool/docs/productnew/modules/requirements.md:61)、[D-06:91](/Users/huyaohua/huyh/work/aigrouptool/docs/productnew/modules/delivery.md:91)、[S5:134](/Users/huyaohua/huyh/work/aigrouptool/docs/technicalnew/storage-and-recovery.md:134)。

触发：实施中用户说“取消这次任务”或“取消这个需求”，之后又选择继续需求。

证据：产品明确设计 Task 取消不等于提案取消，但实施需求只规定开始为 in_progress、暂停/返回设计不退回。Task 取消后需求保留还是回 pending，以及取消需求是否先停关联 Task，均未规定；旧需求和 Task 同时安全取消只在 R-08 的替代目标场景明文定义。

影响：不同 Agent 会自行选择需求状态和停写先后。AC-19 与 AC-26 分别测试 Task 控制与需求取消，不能约束联动，可能出现需求已取消但实现仍推进的呈现与行为。

最小修正方向：在 R-05 区分仅取消本次执行与取消需求目标，明确状态、实际停稳顺序和以后再启动规则；仍由主管显式调用现有工具，不新增自动状态同步流程。补充运行中取消需求和仅取消 Task 后重启需求的验收。

## 已确认可作为开发依据的部分

- 产品定位、五模块和端到端用户流程能够独立理解，不再只是一组规则。
- 提案与实施需求职责、格式和状态区分清楚；设计交付不代表代码实现，也不自动开发。
- 设计 Agent 统一产品分析与必要技术设计，模块内聚、规则唯一归属与按需加载在产品、工具和提示词间一致。
- 一主管一项未结束 Task、Task 到当前阶段再创建专业 Session、总体 Plan 与子内部计划的边界明确。
- 共用 Runtime、短事务接纳、提交后异步调度、单 Session 串行、模型容量与逻辑所有权的区别明确。
- Pi JSONL、SQLite 持久业务事实与内存流式广播分工明确；不要求把每个 token 写 WAL。
- 子原生交互由宿主在主管通道展示，直接响应原等待，不需要主管模型转发或并发 prompt，正常链路自洽。
- 标准代码 Review 后 Test，独立上下文与候选一致性要求明确；轻量和文档采用适用检查。
- 关键副作用先意图后回执、未知不盲目重放、真实停止后才显示停止，已有充分实现方向。
- 结算报告先纳入成果保存再登记最终回执、需求最终版本先保存再 endTask 核对，避免报告回填提交号导致重复提交。

没有把下列内部设计选择列为发现：SQL 实际列/索引和代码包组织、工作目录由服务内部创建登记、用现有 developer 承担组合成果集成、由批次成员/候选/报告投影必要验证集合。没有要求新增逐 Finding 状态机。

## 实际检查与证据边界

| 检查 | 本轮结果 |
|---|---|
| 完整文档及跨契约语义审查 | 基线未通过；当前 DA-03 已关闭，其余七项待闭合 |
| 28 份 Markdown、160 个本地文件/标题引用 | Passed |
| 8 张 Mermaid，实际使用 11.12.0 解析 | Passed |
| 4 个 JSON 示例解析 | Passed |
| 3 段 TypeScript，严格类型检查 | Passed |
| 正式文档工作区差异检查 | Passed；未修改被审查文件 |
| SDK、真实模型、崩溃、容量、取消与浏览器验收 | NOT_RUN |

本轮检查提取物：`/var/folders/zs/p0l9stg552j3vgvzwmf0gnp80000gn/T/agentdev-current-review-mlcsmao6`。实际命令：

```sh
node /var/folders/zs/p0l9stg552j3vgvzwmf0gnp80000gn/T/agentdev-current-review-mlcsmao6/current-docs.mjs
node /tmp/agentdev-doc-check.C8cqSd/check.mjs /var/folders/zs/p0l9stg552j3vgvzwmf0gnp80000gn/T/agentdev-current-review-mlcsmao6/current-mermaid.json
node_modules/.bin/tsc --ignoreConfig --noEmit --strict --skipLibCheck --target es2022 /var/folders/zs/p0l9stg552j3vgvzwmf0gnp80000gn/T/agentdev-current-review-mlcsmao6/current-contracts.ts
git diff --check -- AGENTS.md docs/INDEX.md docs/productnew docs/technicalnew
```

语法检查不证明工具 Schema、跨存储可靠性、模型决策或产品运行正确。下一步依实现检查获取实际证据；基线审查未修改正式文档；当前局部修订及证据见 question/WAL 工作记录。
