# 角色、工具与上下文契约

产品依据：[任务交付](../productnew/modules/delivery.md)、[主管对话](../productnew/modules/chief-conversation.md)、[项目知识](../productnew/modules/project-knowledge.md)。字段唯一在本页，需求格式见 [F](requirements-format.md)，通用交互见 [M5](messaging-and-collaboration.md#m5-统一交互与授权)。当前为待实现契约。

## G1 角色与工具集合

| roleId | 责任 | 能力（Pi 原生文件工具按 Task 类型裁剪） |
|---|---|---|
| chief | 用户讨论、总体 Plan、阶段/步骤、委派、业务判断与收口 | read/grep/find/ls；四个核心工具、task、requirement、project、question |
| designer | 产品分析、模块内聚、需求及适用技术架构/契约 | read/grep/find/ls/write/edit、requirement、agent_report、task.get、question |
| developer | 实现指定目标，内置单元/TDD 自查（D-05） | read/grep/find/ls/write/edit/bash、agent_report、task.get、requirement.list/get、question |
| reviewer | 独立检查需求/验收、Plan 和实际成果 | read/grep/find/ls、agent_report、task.get、question |
| tester | Review 后独立端到端集成/E2E 验收（D-05） | read/grep/find/ls/bash、agent_report、task.get、question |
| settler | 更新已验证知识/记录，保存成果 | read/grep/find/ls/write/edit/bash、agent_report、task.get、requirement、question |
| investigator | 独立只读调查/恢复核实 | read/grep/find/ls、agent_report、task.get、question |

所有角色使用同一 Pi 原生交互适配。前后端是 developer.specialization。专业 Session 必须绑定 Task，不能再委派。身份/Task/工具 op 由宿主固定，不靠模型参数切换。read Task 不开放项目写工具、requirement.save 或任意 bash；agent_report 仍可写 Server 报告。write Task 中 Reviewer 依然只读。Local 工具允许列表不是 OS 沙箱，业务范围和命令影响由 Agent 判断，实际文件/版本由程序核对。

## G2 模型工具

八个领域工具由 customTools 注册；question 由官方示例移植的内置扩展经 pi.registerTool 注册一次，resourceLoader 显式加载，不增加通用扩展系统。[SDK](https://github.com/earendil-works/pi/blob/v1.0.0/packages/coding-agent/docs/sdk.md)

四个核心工具及 chief 的整个 task 工具（含 get）、requirement/project/agent_report 按工具级注册 Pi executionMode=sequential；专业只读 task 工具可沿用原生执行。模式是静态工具配置，不按 op 动态切换，不拆第二套调度器。

宿主 requestKey 从 inputId/调用身份/工具名派生；保存原参数摘要和真实回执，重试不重复创建/保存。模型可见 content 必须含必要 ID、状态和报告引用；outputSchema 声明时 structuredContent 承载同一事实，details 仅展示。错误 isError，不伪造成功。不包装 Pi 原生工具执行/恢复栈。

### createTask

输入：type（read/write）、goal、scope、acceptanceRefs、basisRefs、planMarkdown、sourceInputId、requirementId?、authorizationRef、requiresTest?。

| type | 用途 | Plan/报告位置 | 完成责任 |
|---|---|---|---|
| read | 辅助讨论、调查、只读分析 | Server `work/<taskId>/` | 保存调查/恢复结果、核对停稳，不强制 Review/Test/结算/Git |
| write | 设计文档、需求拆分、正式文档维护、代码修改 | 项目 `.dev/work/<taskId>/` | 独立 Review → 适用 Test → 结算 |

type 由主管依据目标选择，与专业角色分开。requiresTest 是主管按 D-04 声明的必要报告：行为代码修改必须 true，轻量/文档通常 false；read 必须 false。read 省略 requiresTest 时取 false，禁止 true；write 必须显式提供 boolean，缺失 INVALID_ARGUMENT。程序验证值及必要报告，不从 goal 自然语言推断类型/测试责任。

分配稳定 taskId，按 S6 保存总体 Plan，再事务登记 Task/planRef/currentTaskId/回执；返回 taskId/revision/phase=plan/currentSessionIds=[]/planRef。Plan 写目标、范围、依据、步骤/角色、验证、风险与未决事项，规模与任务相称；不预建未来专业 Session。read Plan 可以很短，但不写入项目。

authorizationRef 为 {inputId} 或 {interactionId}，引用真实用户输入或已解决交互。默认明确实施指令覆盖范围内 Plan；模型判断是否需要新决定。逐计划政策时 createTask/updateTask 工具内部用 ctx.ui.confirm 展示完整新 Plan，实际答复返回模型；拒绝不创建。程序只校验决定引用的主体、来源与状态，不解释语义授权范围，也不建立授权范围匹配器。

同一实施需求至多一个未结束实现 Task，同主管至多一项未结束 Task（含暂停）；冲突返回关联/TASK_BUSY。主管自行讨论、保存提案不自动建 Task；需要专业帮助先建 read 或 write Task。

### updateTask

输入：taskId、expectedRevision、phase?、summary、nextStep?、blockReason?、status?（active/waiting）、changes?={goal?,scope?,acceptanceRefs?,basisRefs?,planMarkdown?,expectedPlanVersion?,authorizationRef?,requiresTest?,invalidateResultIds?}。

phase 枚举 clarify/analyze/design/plan/develop/review/test/settle。**提供 phase 表示开始下一步骤**，即使阶段名相同；当前步骤成员必须已结束，或已被明确控制并停稳。事务保存上一步骤总结、当前 phase，清空 currentSessionIds，保留历史关联/结果。不提供 phase 仅更新摘要/阻断/下一步，不清空成员。未核实中断不能借步骤切换解除；只读恢复核实例外见 S7。返回新 revision/phase/currentSessionIds。阶段内不逐工具更新；报告不自动推进阶段。

需要继续当前成员时用 continue，不以 updateTask 清空成员来掩盖异常。目标/依据实质改变由主管判断、说明有效决定，保存修订 Plan；changes 可附 invalidateResultIds 标明不再适用的旧报告；程序核对 CAS、实际版本与声明的替代/失效事实。type 创建后不变，需要项目写入时结束只读工作并创建 write Task。进入 test 核对当前步骤所有 Review 已停稳，当前候选的必要 Review 报告已保存且 verdict=passed、未被声明失效；主管判断问题是否闭合。不能直接设置 completed/cancelled 或覆写控制。

### createTaskSessions

所有专业委派必须 taskId；只组织当前步骤。模式与字段：

| mode | 参数 | 动作 |
|---|---|---|
| create（默认） | sessions[{roleId,specialization?,label,instructions,refs,dependsOnResultIds?,expectedKind,candidateId?,workspaceRef?}]、waitTimeoutMs? | 同事务创建专业 Session/Task 关联/首条输入，加入 currentSessionIds；提交后唤醒并等待当前步骤 |
| wait | waitTimeoutMs? | 仅查询/等待该 Task 当前步骤，不追加输入、不建 Session |
| continue | sessionId、instructions、refs、dependsOnResultIds?、waitTimeoutMs? | 已停稳成员追加剩余工作输入，更新 currentInputId；已有成员和成果保留，然后等待当前步骤 |

create 整批接纳原子，不出现半批。暂停/中断 Task 只允许显式 investigator + expectedKind=recovery 例外：只读核实、报告存 Server，不解除控制、不启动原开发；保留原 currentSessionIds，新核实成员追加，不向未停稳 Session 并发 prompt。其他专业工作按控制拒绝。read 委派的 expectedKind 只能 investigation/recovery，不以 design 报告要求项目写入。Review/Test/settler 派发分别核对 phase=review/test/settle；Test 接纳再核对同候选 Review=passed 且停稳、文件版本未变化。Review/Test 带 candidateId、总体 Plan/正式依据；Review 与 Test 不混合同步启动。并行修改使用登记的分离目录；共享目录一个写入负责人。专业 Session 创建复用统一 Session 创建/绑定/Runtime。

工具内部异步等待；程序按 M2 查询 task.currentSessionIds，等当前步骤所有成员停稳再聚合报告/异常。超时返回 timeout 和状态快照，不 abort 子工作；默认等待时间为 Server `delegationWaitMs`（首版 120000），调用可指定 1000～300000ms。主管可 wait 继续等；不能因为 timeout 就重建工作。

continue 只对当前 Task 当前步骤已停稳、仍有剩余目标的原成员执行；核对 currentInputId/归属/控制/配置，保存新输入并保留旧报告。不得并发 prompt，不续办仍 queued/working/waiting_user/stopping 的成员，不自动重启用户暂停/取消的工作，不重复已完成成果。主动暂停需明确 resume；中断/未知先核实。原生用户答复直接解除原 ctx.ui 等待，不使用 continue。

正式 blocked 报告停稳后，主管处理原因可继续原专业上下文。已验证成果改变时新 Review/Test 使用新独立 Session；当前步骤结束后 updateTask 再组织下一步骤，不预建未来流程。

### endTask

输入：taskId、expectedRevision、completionResultId。按 G3 核对，成功事务 completed/revision 并释放 currentTaskId；缺项 COMPLETION_INCOMPLETE，已有成果保留。read 引用有效 investigation/recovery 报告，write 引用 settlement 报告；业务完成判断由主管/独立 Agent 负责。

### task

| op | 参数 → 返回 |
|---|---|
| get | taskId?（缺省宿主 currentTaskId）、includeResultBodies? → Task/Plan 原文与版本、当前/历史 Session、正式结果/交互/缺项；按显式引用返回报告正文 |
| prepare_candidate | taskId、expectedRevision、paths:string[] → candidateId/files[{path,sha256}]/commit?/revision；相关修改已停稳，读取实际交付版本 |
| control | taskId、expectedRevision、command=pause/resume/cancel → 实际 status/revision、controlRequested；S5 控制流程 |
| adopt | taskId、expectedRevision、chiefSessionId → 新所有者/revision；停稳相关执行，目标主管无未结束 Task |
| reconcile | taskId、sessionId、inputId、expectedInputRevision、evidenceRefs、resolution=completed/failed/stopped → 核对当前 Task owner/输入归属/证据后原输入终态/版本；证据不足不关闭，调用 R1 同一恢复服务，不启动模型或重放 |

chief 有写 op，专业仅自身 get。候选固定版本，不强制复制整个项目。Server 报告正文通过 task.get 的结果引用取得，不让模型猜 Server 私有路径。

### agent_report

输入：kind（design/implementation/review/test/settlement/investigation/recovery）、summary、body 或 reportRef（二选一）、basisRefs、candidateId?、verdict?（passed/failed/blocked）、checks[]、supersedesResultId?、settlement?。

Review/Test 的 verdict 必填。程序认可的有效验证报告为 verdict=passed、未声明失效/未被替代、同 candidateId 且来源输入已停稳；报告内容、问题闭合和未覆盖风险由 Agent 判断。

每项 checks 为 name/status（passed/failed/blocked/not_run）/command?/exitCode?/reason?/evidenceRefs。真正执行才 passed，真实失败保留 failed，未覆盖说明原因/风险/用户决定。需要主管决策时提交 expectedKind 的正式 blocked 报告并结束当前输入；普通用户问答使用 question，不提前结束专业工作。

body 按 S6 保存新报告；reportRef 核对已有完整正文与摘要，仅登记、不复制或重写。read 报告写 Server，write 报告写项目；暂停/中断 Task 的只读恢复核实报告写 Server（investigator + expectedKind=recovery）。报告核对 actor/Task/期待种类/来源输入/候选版本，事务保存 result 和原回执，唤醒等待，返回 resultId/reportRef。报告保存且 Pi 停稳才算成员结束。

正式报告后不继续修改当前成果。修订新增 resultId 并指明 supersedesResultId，不覆写历史；主管/独立 Agent 判断报告业务有效性，程序核对结果身份和实际文件版本。settlement 使用 S6 最小保存清单，Git 提交号只入 DB 回执，不改已提交报告。

### requirement

提案/实施需求可 read/get，待处理列表用 list；正式新建/修改/状态保存必须 save，不能 write/edit/脚本覆盖。已有文件先 get 取得原文/版本；产品、技术、索引文档仍用原生文件工具。

| op | 参数 → 结果 |
|---|---|
| list | kind?、status?、limit、cursor? → items/invalidFiles/nextCursor |
| get | requirementId → 原文、元数据、version、引用/格式问题 |
| save | requirementId、expectedVersion（新建 null）、kind、title、status、sections（实施需求按七个标题各一段 Markdown）或 body（提案自由正文）、modules/sourceRequirementIds/linkedTaskIds?、authorizationRef → 实际 ID/path/version/metadata |

schemaVersion:2 双类型需求、状态和保存检查唯一见 [F](requirements-format.md)。保存由模型给内容与决定、程序序列化为文件：schemaVersion/id/createdAt/updatedAt 与七个二级标题不由模型填写，get 返回 version 与现有 sections 供无损修改。授权引用输入/已解决交互；模型判断是否获得同意，程序验证身份/状态/内容形状/文件版本，不解释需求语义。保存不自动建 Task，归档不移动文件。

### question

使用 [Pi v1.0.0 官方 question 扩展](https://github.com/earendil-works/pi/blob/v1.0.0/packages/coding-agent/examples/extensions/question.ts) 的注册方式移植，extensionFactories 加载、pi.registerTool 一次、executionMode=sequential。浏览器版移除 TUI/custom 界面，参数对应通用原生交互：method=confirm/select/input、title、message?、options?、placeholder?；confirm 必需 message:string，select 必需 options:string[]。不增加业务确认类型。

```json
{ "method": "select", "title": "是否将讨论内容加入需求列表？", "options": ["加入", "暂不加入"] }
```

execute 按 method 调用 ctx.ui.confirm/select/input，传入 signal，真实答复返回模型。UIAdapter 关联当前工具调用，接入层将 interactionId 放入模型可见返回；ctx.ui 原生返回类型不变。统一按 M5 经 WAL/主管通道展示和响应，无独立审批/恢复引擎。

### project

chief 的 op=initialize，输入 expectedProjectRevision、files[{path,expectedVersion,content}]、reusedAuthorityRefs、requestWriteUse、authorizationRef?。展示真实入口缺口、复用依据、拟写路径/完整内容与影响；需要新决定时内部 ctx.ui.confirm，模型已有明确同意则提供决定引用，程序校验来源/状态而不匹配自然语言范围。

按 S6 保存批准的差异包及文件/回执，实际入口有效才返回 ready。拒绝不写、版本冲突保留原文；失败核对已保存步骤，只补缺项。初始化仍是通用交互，不注册业务确认 kind。

## G3 总体 Plan、候选与完成核对

Task 仅主管总体 Plan；子 Agent 可自行计划或直接完成目标，不强制文件/审批。Review 依据需求、验收、总体 Plan、实际版本与证据，不能以作者内部计划代替验收。

| 判断/核对 | 责任 |
|---|---|
| Task 类型、适用 Test、角色/步骤、范围与授权含义 | 主管依据 D-04 与真实用户决定；独立 Agent 可质疑 |
| 需求是否满足、问题是否闭合、知识/结算是否完整、依据是否实质变化 | 主管与独立 Agent；写正式报告，不转成自然语言门禁引擎 |
| 身份/归属、CAS/控制、当前步骤成员是否停稳 | 程序 |
| 必要报告、Review 在 Test 前、候选和声明文件/需求版本、真实保存回执 | 程序；内容判断由 Agent 负责 |

read：有效 investigation/recovery 结果、全部成员停稳、无待处理交互/未核实中断即可结束，不强制项目文件或 Git。write：全部专业工作已停稳、无开放交互或未核实中断，必要独立 Review、requiresTest=true 时同候选有效 Test、settlement 及实际保存；主管声明问题已处理并确认目标满足。缺项保持未完成，不重做未变化成果。

prepare_candidate 记录主管选定的实际交付文件/版本；Review/Test 针对同版实际成果，期间不改交付文件。Test 有环境需要时复制/worktree，不能强制所有文档工作复制项目。组合成果按最终组合重验证。结算只回填已确认记录；源码/正式规则实质变化重新 Review → 适用 Test。报告和保存事实不能代替业务判断，也不能以模型自称完成替代保存事实。

## G4 规则与上下文装配

```text
chief：Pi 原生说明 + base 完整正文 + chief 完整角色正文
专业：Pi 原生说明 + base 完整正文 + specialists 共同规则正文 + 所选角色完整正文
两者：项目入口 AGENTS.md / .dev/INDEX.md / .dev/PROJECT.md
      + 当前 Task/总体 Plan/授权/控制 + 本次输入及正式依据路径
```

宿主实际读取并注入上述正文，不用角色名、短规则块或链接代替。共同规则唯一位于 [specialists](prompts/specialists.md)；基础规则唯一位于 [base](prompts/base.md)；chief 不注入专业共同规则。各完整角色正文唯一按下表装配，文档状态说明不作为角色正文。

正文提取边界固定：base 从第一个 `## Base rules` 到文件末尾（含 `## Judgment and expression`）；specialists 从 `## Shared rules` 到 `## Role file map` 之前；chief 与各专业角色从 `## Role and goal` 到文件末尾。保留正文内的各节，不只取第一个小节；文档标题/状态说明与角色映射表不进入模型。

**语言**：注入模型的系统级文本（九份角色提示词正文、项目入口 AGENTS.md、工具描述与 schema、宿主生成的指令与通知）默认使用英文；模型对用户的自然语言回复跟随用户输入语言。检查入口：`devagent/checks/prompt-language.ts`（按上述边界抽取并断言无中日韩字符、边界可解析、角色正文齐全）。

| roleId / 完整正文 | 本次目标与依据上下文 | 权限及工作环境 |
|---|---|---|
| chief / [chief](prompts/chief.md) | 用户输入、项目入口、当前 Task/Plan、有效决定与正式结果；按需补读 | G1 主管工具及当前 Task ownerEpoch / 只读或修改类型；无专业源码写入权限 |
| designer / [designer](prompts/designer.md) | 设计目标、提案/需求、产品/技术索引及选定模块、已确认决定、Plan | 普通文档写入负责人；需求通过 save；不默认整项目或所有模块 |
| developer / [developer](prompts/developer.md) | 指定实施目标、需求/验收、Plan、必要技术接口、依赖结果、适用单元/集成/E2E 测试入口 | specialization、授权范围、登记工作目录/写入负责人、实际执行配置 |
| reviewer / [reviewer](prompts/reviewer.md) | 正式需求/验收、Plan、同一实际交付版本、真实证据 | 独立只读成果；无作者、主管、其他 Reviewer 聊天自评，无任意 bash |
| tester / [tester](prompts/tester.md) | 同候选有效 Review、需求/验收、Plan、API/浏览器 E2E 入口、适用服务/地址、环境与数据准备依据、真实证据 | 适用测试目录/副本，执行测试及准备临时验收产物；不修改交付源码，无作者/主管聊天自评 |
| settler / [settler](prompts/settler.md) | 有效成果/检查、同一实际交付版本、受影响知识入口、遗留与保存安排 | 仅适用结算记录与 Git/本机保存权限，保护无关改动 |
| investigator / [investigator](prompts/investigator.md) | Task 调查目标或被核实输入/事实、选定事实/证据路径 | 只读与已配置检查；不默认任意执行，不改变恢复/完成状态 |

宿主同时提供可读取的规范入口映射：R=需求管理、D=任务交付、K=项目知识、F=需求文件格式、G=本页角色工具契约、M=消息与协作、S=存储与恢复、I=实现检查、T=技术索引（定位运行与实现检查）。这些内置规范采用只读资源路径，由宿主映射为 read 实际可访问的文件；提示词中的章节简称必须能定位到该入口，不能只留下不可解析的 R-01 等名称。只注入入口，不拼接全部规范；按需读具体章节。项目自身 AGENTS/索引继续定位项目补充约束，冲突明确核对，不静默覆盖权威规则。

主管提供的本次 instructions/refs 使用现有工具字段，说明用户结果、本次交付范围、当前步骤、相关模块关系、已确认决定与具体未知；引用总体 Plan、正式需求/规则、适用技术契约和依赖结果，指出关键引用的用途。主管负责选择最小但足够的上下文，专业 Agent 按路径补读；宿主保存真实身份/环境与引用，不另造上下文审批、知识同步或强制文档模板。

提示词分工：base 给共同判断/事实原则，chief 组织整体目标与流程，specialists 给接收分工/报告的共同责任，各角色给本职判断与产出方法。模型必须实际收到相应正文；经验只写在工作记录中不算已植入。产品/技术规则和工具 Schema 继续按原入口读取，角色正文不成为第二份协议。

只注入当前角色，宿主固定并持久记录 actor、taskId（专业必需）、role/specialization、cwd、实际模型/工具集合、规则内容摘要及 Pi 文件绑定。专业 Agent 自行按引用 read；Server 校验归属/可读性，不拼整项目或作者聊天。上下文不充分可补读或提交真实阻断报告，不能把文档描述当实现证据。

压缩/重启由 currentTaskId + task.get 找回真实关系，再按当前正式依据装配；不只靠记忆 ID，不重建已有专业 Session。明确 resourceLoader，不自动加载未知扩展。项目规则变化在安全边界核对并显式更新/交接。角色模型按角色覆盖 → 项目默认 → Server 默认，执行时固定；不可用保留阻断，不静默回退。基础规则落实产品，不新增业务门禁或审批义务。

## G5 模型行为检查

覆盖主管自由讨论不建 Task、专业调查绑定 read Task、主管总体 Plan、显式阶段更新、按步委派、当前步骤全部成员聚合、超时不取消、原生交互期间父委派保持等待/宿主直接答复、正式 blocked 报告后原 Session 接续、并行 Review 后 Test、返工、真实报告、结算缺项和压缩恢复。统一设计角色还须检查粗略提案转化、模块内聚、可实施需求边界、已有技术依据复用、总图/子图/契约一致、正式需求写入不绕过 save，以及无设计聊天的独立实施。补充验证整体判断与有依据的质疑、授权内自主推进、最小上下文分工、文档独立可实施、成熟实现按需采用和结算后入口可接续；具体场景唯一列在 [I4](implementation-checks.md#i4-提示词与真实业务检查)。提示词文字存在不证明模型实际遵守。
