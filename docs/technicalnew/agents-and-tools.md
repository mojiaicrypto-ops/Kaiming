# 角色、工具与上下文契约

产品依据：[任务交付](../productnew/modules/delivery.md)、[主管对话](../productnew/modules/chief-conversation.md)、[项目知识](../productnew/modules/project-knowledge.md)。

本页定义目标角色、模型工具和装配契约；实现与运行验证状态见技术索引及实现检查。需求序列化唯一见 [需求格式](requirements-format.md)，原生交互唯一见 [M5](messaging-and-collaboration.md#m5-统一交互与授权)。文档写成不表示功能已实现。

## G1 角色与工具集合

| roleId | 责任 | 能力 |
|---|---|---|
| chief | 用户讨论、总体 Plan、阶段更新、按步骤委派、交互业务判断、最终核对 | read；四个核心工具、task、requirement、project、question；Pi 原生交互接入 |
| designer | 产品分析、内聚模块、实施需求与适用技术架构/契约 | read/write/edit、requirement.list/get/save、agent_report、task.get、question；Pi 原生交互接入 |
| developer | 完成总体 Plan 中指定实施目标 | read/write/edit/bash、agent_report、task.get、requirement.list/get、question；Pi 原生交互接入 |
| reviewer | 独立检查需求/验收、总体 Plan 和实际候选 | read、agent_report、task.get、question；Pi 原生交互接入；不提供任意 bash/源码写入 |
| tester | Review 后在固定候选的测试副本验证 | read/bash、agent_report、task.get、question；Pi 原生交互接入 |
| settler | 更新已验证知识/摘要/记录，保存成果 | read/write/edit/bash、agent_report、task.get、requirement、question；Pi 原生交互接入 |
| investigator | 独立只读调查/核实具体效果 | read/已配置只读检查、agent_report、task.get、question；Pi 原生交互接入 |

前后端是 developer.specialization。chief 从用户会话入口创建，所有专业 Session 必须绑定 Task，且不再委派。designer 统一承担产品分析与适用技术设计；具体调查或试验由主管按需要提供权限与环境，不默认开放任意执行。身份由宿主绑定 projectId/sessionId/taskId，不能靠模型参数切换。工具 op 子集、写入负责人、当前总体 Plan 授权与控制由服务校验；普通 Local 工具不等于 OS 沙箱。

## G2 模型工具

八个领域工具由 Pi SDK customTools 显式注册；question 采用官方示例的内置 Pi 扩展，通过 pi.registerTool 注册，不能再在 customTools 重复注册。宿主只加载明确配置的扩展，连接 UI/必要生命周期，不增加通用扩展系统。[SDK](https://github.com/earendil-works/pi/blob/v1.0.0/packages/coding-agent/docs/sdk.md)

宿主 requestKey 从 inputId/contextEpoch/toolCallId/工具名派生，恢复复用原 key，参数摘要绑定原操作；模型不生成随机去重号。所有成功返回必须先保存真实回执。content 包含模型需要的 ID/状态/路径，structuredContent 是声明 outputSchema 时的程序返回，details 只供展示/重建、不进入模型上下文。错误设置 isError；关键保存失败按 S4 停止准入。

### createTask

输入：kind（analysis/design/standard/light/document）、goal、scope、acceptanceRefs、basisRefs、planMarkdown、sourceInputId、requirementId?、authorizationRef。

先分配稳定 taskId；需要确认时先完成下述原生确认，再按 S6 保存总体 Plan 到 `.dev/work/<taskId>/plan.md`；事务登记 Task、planRef、当前主管 currentTaskId 与原回执。返回 taskId/revision/phase=plan/planRef。总体 Plan 包含目标、范围、依据、步骤/责任、验证、风险与待决定事项，不预先创建全部专业 Session。已有实施授权默认覆盖范围内 Plan；逐计划政策或新增范围需对应有效决定。

逐计划政策需要确认时，createTask 工具内部通过 ctx.ui.confirm 展示完整 planMarkdown，按 M5 保存答复；确认绑定正文摘要、源授权和原主管槽位，拒绝不创建 Task 或登记 Plan 变更。已有有效授权涵盖同一正文/范围时可复用。updateTask 修订同样由工具内部确认，绑定 taskId、原 Plan 版本、修订正文摘要；等待答复后重新核对版本与控制，再按 S6 保存，不能把旧同意套到新正文。模型不登记或维护交互生命周期。

同一实施需求至多一个未结束实现 Task，同主管至多一项未结束 Task（含暂停）；碰撞返回原关联/TASK_BUSY，不建立第二项。需求保存和主管自由讨论不自动建 Task；需要委派只读调查时先建 analysis Task。Task.kind 的唯一枚举为 analysis/design/standard/light/document；analysis 不改变项目文件或正式产品依据，调查结果作为 Task 成果保存。设计工作使用 design，正式文档维护使用 document，代码工作按产品 D-04 选 standard/light。

### updateTask

输入：taskId、expectedRevision、phase、summary、nextStep?、blockReason?、status?（active/waiting）；修改正式目标时可附 changes={goal?,scope?,kind?,acceptanceRefs?,basisRefs?,planMarkdown?,expectedPlanVersion?,authorizationRef?}。

保存前一阶段总结、当前阶段与下一步，返回新 revision。phase 的唯一枚举为 clarify/analyze/design/plan/develop/review/test/settle；analysis 使用适用 analyze 阶段，其他依 D-04 的适用路线。阶段切换前调用，阶段内不逐 token 更新。Runtime/报告不自动推进 phase；技术事实不覆盖主管摘要。

目标/验收/依据实质修订先停稳相关写入，核对用户决定与原 Plan 版本，保存新 Plan/basis，旧候选/验证失效。禁止用 updateTask 直接 completed/cancelled，禁止覆写原控制意图。进入 test 核对当前候选的必要 Review 已完成且问题处置有效；角色选择和是否返工由主管决定。

### createTaskSessions

所有专业委派 taskId 必需，含自由讨论中的调查和恢复核实；不能以 investigator 或只读权限绕过绑定。首版每次只组织当前步骤。mode 是互斥形状：

| mode | 参数 | 动作 |
|---|---|---|
| create（默认） | sessions[{roleId,specialization?,label,instructions,refs,dependsOnResultIds?,expectedKind,candidateId?,workspaceRef?}] | 原子创建专业 Session、Task 关联、首条输入、本批 delegationId；提交后异步调度并等待 |
| wait | delegationId | 等同一批现有工作；不追加输入、不重建 Session |
| continue | sessionId、instructions、refs、dependsOnResultIds? | 原 Session 保存新输入并生成本次等待；当前工作停稳后进入新 workRevision/新批次，旧结果保留 |

create 整批接纳失败则无半批工作。角色符合 Task 当前阶段；Review/Test 带 candidateId、总体 Plan/正式依据，不能同批混合 Review/Test。并行开发的 workspaceRef 必须是服务登记的分离目录；共享真实目录不允许多写者。工具内部复用统一 Session 创建/绑定/Runtime。

工具保存接纳身份后等待，期间 onUpdate 可显示实际 ID/进度，但不当成功终态。返回固定 [M2](messaging-and-collaboration.md#m2-委派等待协议) 结果：completed 或 blocked。主管等待当前指定工作；原生用户请求经 M5 宿主直转，父工具保持等待，正式阻断才交回控制权；不等整项 Task 或 Session 永久结束。

continue 核对归属、授权/当前 Plan、控制和已知效果；不得在另一个输入仍执行或挂起时并发 prompt。活跃原生交互答复按 M5 继续原工具，不调用 continue 复制工作。开发/文档范围内返工可复用原 Session；正式阻断后补齐同一验证可 continue 原独立 Session，原独立上下文边界保持。已验证成果改变后新 Review/Test 必须用新的独立 Session，不能复用作者上下文。

### endTask

输入：taskId、expectedRevision、completionResultId。按 G3 核对，返回 completed/revision 或 COMPLETION_INCOMPLETE 与缺项。成功事务释放 currentTaskId；已有成果未变化时仅补缺项，不重新实施。analysis 引用 investigation 成果，其他类型引用 settlement 成果；analysis 的最后适用阶段可为 analyze，其他为 settle，完成统一由 status=completed 表达。

### task

辅助 op：get（只读当前 Task/Plan/Session/结果/交互/缺项）；prepare_candidate（停写预约、固定候选、清单摘要）；control（pause/resume/cancel，CAS，按 S5）；adopt（新主管，停稳后 CAS 转交，目标主管必须无未结束 Task）。只有 chief 有写 op，专业角色只有自身 task.get。

### agent_report

专业输入：kind（design/implementation/review/test/settlement/investigation/recovery）、summary、body 或 reportRef（二选一）、basisRefs、candidateId?、verdict?（passed/failed/blocked）、checks[]、supersedesResultId?、settlement?。不提供子 Plan 或临时协调报告种类；每个正式最终报告结束当前 workRevision 的写入。需要 chief 模型决策时，提交当前期待种类的正式 verdict=blocked 报告，说明问题、证据和需要主管决定的事项；停稳后父委派返回 blocked，主管解决后 continue 原 Session 的新 workRevision/批次。它不能替代普通 ctx.ui 用户交互，普通用户等待不构成另一种委派终局。

checks 每项 name/status（passed/failed/blocked/not_run）/command?/exitCode?/reason?/evidenceRefs。只有实际检查写 passed，真实失败保留 failed；未覆盖有原因与处置引用。

报告服务核对 actor/期待种类/候选/依据。body 输入按 S6 保存 `.dev/work/<taskId>/<sessionId>/` 新报告；reportRef 输入核对该目录内已有完整报告原文及摘要，只登记该文件，不复制第二份或重写正文。结算报告在 Git/本机保存前准备，保存后用 reportRef 登记正式结果；提交号等最终回执仅进 DB 结构化字段，不回写已保存报告。然后一个事务保存 result、原回执；提交后唤醒相关委派等待。返回 resultId/reportRef，主管通过原委派工具取得结果。报告已保存但 Pi 未停稳时不能把本批工作标完成。

报告正文/结构不可变；修订新增 resultId、supersedesResultId，validity 是当前工作/候选/依据的投影。只能修订同 Task 同种类且原 Session 或新独立复核明确依赖的报告。settlement 必须附 S6 的结构化清单。

### requirement

访问边界：提案/实施需求可用普通 read 或 get 读取，列表使用 list；正式新建、修改、状态保存必须 save，不通过 write/edit/脚本覆盖需求文件。修改已有记录前 get 取得原文与版本。产品、技术及索引文档仍使用普通文件工具。

| op | 参数 → 结果 |
|---|---|
| list | kind?、status?、limit、cursor? → items/invalidFiles/nextCursor |
| get | requirementId → 原文、元数据、version、引用/格式问题 |
| save | requirementId、expectedVersion（新建 null）、markdown、authorizationRef → 原子保存的 ID/path/version/metadata |

schemaVersion:2 的双类型元数据、状态、正文、引用、列表排序和版本校验唯一见 [需求格式 F1～F4](requirements-format.md)，本页不复制 Schema。授权引用真实用户输入或已解决原生交互；保存不自动开 Task，归档不移动删除文件。

### question

使用 [Pi v1.0.0 官方 question 扩展](https://github.com/earendil-works/pi/blob/v1.0.0/packages/coding-agent/examples/extensions/question.ts) 的注册方式，作为各角色共用的提问工具。通过 resourceLoader.extensionFactories 加载，pi.registerTool 注册一次，executionMode=sequential。浏览器接入移除示例中的 TUI/custom 界面，参数直接对应 Pi 通用交互：method=confirm/select/input、title:string、message?、options?、placeholder?（confirm 要求 message:string；select 要求 options:string[]）。模型选择交互类型并组织问题，不增加业务确认类型。

```json
{
  "method": "select",
  "title": "是否将讨论内容加入需求列表？",
  "options": ["加入", "暂不加入"]
}
```

execute 按 method 调用 ctx.ui.confirm/select/input，并传入 signal；取得真实答复后返回模型，由模型决定后续操作。宿主 UIAdapter 在当前工具调用上下文中关联请求，Pi 接入层将保存的 interactionId 随答复放入模型可见 content，ctx.ui 的原生返回类型保持不变。消息、渲染和 WAL 接续统一见 M5；question 不另建执行、审批或恢复机制。工具内部已有原生交互也走同一链路。

### project

chief 的辅助工具首版 op=initialize。输入：expectedProjectRevision、files[{path,expectedVersion,content}]、reusedAuthorityRefs、requestWriteUse、authorizationRef?。形成明确初始化差异包，真实展示入口缺失、复用依据、拟写路径/内容与影响；工具内部调用 ctx.ui.confirm，确认严格绑定差异包摘要/原版本/请求用途。已有有效授权涵盖同一差异包和用途时复用，不重复确认。

批准后保存 Project.writeAuthorizationRef 与 initializationRef 的批准范围/执行步骤，按 S6 逐文件核对、原子保存和记录回执；入口有效后返回 ready 与实际文件引用。拒绝不写，冲突保留原文，重新核对当前差异再决定。保存失败核对原步骤补齐，不重做已成功步骤；原请求仅为 M5 原生交互，不注册初始化业务 kind 或 apply_initialization 模型生命周期工具。

## G3 总体 Plan、候选与完成核对

Task 只有主管维护的总体 Plan。专业 Agent 可自行规划或直接完成简单目标，无必需文件/审批；Review 以需求、验收、总体 Plan 和实际候选为准，开发者内部计划不替代验收。

prepare_candidate 在相关写入停稳后取得 capture 预约，复制源码/配置/正式依据及受影响未跟踪文件，排除凭证/缓存/临时产物；前后清单复核外部变化，变化返回 CANDIDATE_CHANGED。Review 读取固定目录，Test 使用独立可写副本；并行成果组合后重新固定候选验证。

| endTask 条件 | 实际核对 |
|---|---|
| 目标/总体 Plan/授权 | 当前版本、依据、有效决定 |
| 专业工作停稳 | 必需正式结果、无残留运行/未解决交互/未知效果 |
| 适用验证 | standard 同候选 Review 后 Test；design/light/document 独立审阅或检查；阻断问题闭合 |
| 交付一致 | 实际源码/配置/测试与候选清单一致，改变重新验证 |
| 结算保存 | 受影响知识/摘要/入口/报告、遗留、覆盖处置、Git 或本机回执；有关需求最终内容/状态版本已纳入该保存并匹配清单 |

上述验证、候选与结算条件适用于非 analysis 工作。analysis 核对目标/总体 Plan/授权、覆盖本次调查目标的有效非阻断 investigation 结果及全部专业工作停稳、无未解决请求/未知即可 endTask；不强制 Review/Test、结算或 Git。其他工作按适用检查和结算收口。

不把真实缺陷改成未覆盖，不通过取消清除已报告问题。结算只变更列明记录，源码/正式目标改变回到适用检查。有 Git 保护无关改动/暂存；无 Git 返回 local_saved。

## G4 规则与上下文装配

```text
chief：Pi 原生说明 + base 完整正文 + chief 完整角色正文
专业：Pi 原生说明 + base 完整正文 + specialists 共同规则正文 + 所选角色完整正文
两者：项目入口 AGENTS.md / .dev/INDEX.md / .dev/PROJECT.md
      + 当前 Task/总体 Plan/授权/控制 + 本次输入及正式依据路径
```

宿主实际读取并注入上述正文，不用角色名、短规则块或链接代替。共同规则唯一位于 [specialists](prompts/specialists.md)；基础规则唯一位于 [base](prompts/base.md)；chief 不注入专业共同规则。各完整角色正文唯一按下表装配，文档状态说明不作为角色正文。

| roleId / 完整正文 | 本次目标与依据上下文 | 权限及工作环境 |
|---|---|---|
| chief / [chief](prompts/chief.md) | 用户输入、项目入口、当前 Task/Plan、有效决定与正式结果；按需补读 | G1 主管工具及当前 Task ownerEpoch；无专业源码写入权限 |
| designer / [designer](prompts/designer.md) | 设计目标、提案/需求、产品/技术索引及选定模块、已确认决定、Plan | 普通文档写入负责人；需求通过 save；不默认整项目或所有模块 |
| developer / [developer](prompts/developer.md) | 指定实施目标、需求/验收、Plan、必要技术接口、依赖结果 | specialization、授权范围、登记工作目录/写入负责人、实际执行配置 |
| reviewer / [reviewer](prompts/reviewer.md) | 正式需求/验收、Plan、固定候选、真实证据 | 独立只读候选；无作者、主管、其他 Reviewer 聊天自评，无任意 bash |
| tester / [tester](prompts/tester.md) | 同候选有效 Review、需求/验收、Plan、环境与真实证据 | 独立可写测试副本，执行测试；不修改交付源码，无作者/主管聊天自评 |
| settler / [settler](prompts/settler.md) | 有效成果/检查、固定候选、受影响知识入口、遗留与保存安排 | 仅适用结算记录与 Git/本机保存权限，保护无关改动 |
| investigator / [investigator](prompts/investigator.md) | Task 调查目标或具体 operationId、选定事实/证据路径 | 只读与已配置检查；不默认任意执行，不改变恢复/完成状态 |

宿主同时提供可读取的规范入口映射：R=需求管理、D=任务交付、K=项目知识、F=需求文件格式、G1/G2=角色工具契约。这些内置规范采用只读资源路径，由宿主映射为 read 实际可访问的文件；提示词中的章节简称必须能定位到该入口，不能只留下不可解析的 R-01 等名称。只注入入口，不拼接全部规范；按需读具体章节。项目自身 AGENTS/索引继续定位项目补充约束，冲突明确核对，不静默覆盖权威规则。

只注入当前角色，宿主固定并持久记录 actor、taskId（专业必需）、role/specialization、cwd、实际模型/工具集合、规则内容摘要及绑定。专业 Agent 自行按引用 read；Server 校验归属/可读性，不拼整项目或作者聊天。上下文不充分可补读或提交真实阻断报告，不能把文档描述当实现证据。

压缩/重启由 currentTaskId + task.get 找回真实关系，再按当前正式依据装配；不只靠记忆 ID，不重建已有专业 Session。明确 resourceLoader，不自动加载未知扩展。项目规则变化在安全边界核对并显式更新/交接。角色模型按角色覆盖 → 项目默认 → Server 默认，执行时固定；不可用保留阻断，不静默回退。基础规则落实产品，不新增业务门禁或审批义务。

## G5 模型行为检查

覆盖主管自由讨论不建 Task、专业调查绑定 analysis Task、主管总体 Plan、显式阶段更新、按步委派、原生交互期间父委派保持等待/宿主直接答复、正式 blocked 报告后原 Session 接续、并行 Review 后 Test、返工、真实报告、结算缺项和压缩恢复。统一设计角色还须检查粗略提案转化、模块内聚、可实施需求边界、已有技术依据复用、总图/子图/契约一致、正式需求写入不绕过 save，以及无设计聊天的独立实施。模型/运行证据见 [实现检查](implementation-checks.md)，提示词不证明可靠性。
