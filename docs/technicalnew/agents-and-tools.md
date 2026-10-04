# 角色、工具与上下文契约

产品依据：[任务交付](../productnew/modules/delivery.md)、[主管对话](../productnew/modules/chief-conversation.md)、[项目知识](../productnew/modules/project-knowledge.md)。

## G1 角色与工具集合

| roleId | 责任 | 能力 |
|---|---|---|
| chief | 用户讨论、总体 Plan、阶段更新、按步骤委派、所有交互呈现、最终核对 | read；四个核心工具、task、requirement、interaction |
| product | 内聚需求/产品知识与正式文档 | read/write/edit、requirement、agent_report、task.get、interaction.request |
| designer | 技术职责/契约与证据 | read/write/edit、agent_report、task.get、interaction.request |
| developer | 完成总体 Plan 中指定实施目标 | read/write/edit/bash、agent_report、task.get、requirement.list/get、interaction.request |
| reviewer | 独立检查需求/验收、总体 Plan 和实际候选 | read、agent_report、task.get、interaction.request；不提供任意 bash/源码写入 |
| tester | Review 后在固定候选的测试副本验证 | read/bash、agent_report、task.get、interaction.request |
| settler | 更新已验证知识/摘要/记录，保存成果 | read/write/edit/bash、agent_report、task.get、requirement、interaction.request |
| investigator | 独立只读调查/核实具体效果 | read/已配置只读检查、agent_report、task.get、interaction.request |

前后端是 developer.specialization。chief 从用户会话入口创建，专业 Session 不再委派。身份由宿主绑定 projectId/sessionId/taskId，不能靠模型参数切换。工具 op 子集、写入负责人、当前总体 Plan 授权与控制由服务校验；普通 Local 工具不等于 OS 沙箱。

## G2 模型工具

工具由 Pi SDK customTools 显式注册；内置扩展用于 UI/必要生命周期连接，不增加通用扩展系统。[SDK](https://github.com/earendil-works/pi/blob/v1.0.0/packages/coding-agent/docs/sdk.md)

宿主 requestKey 从 inputId/contextEpoch/toolCallId/工具名派生，恢复复用原 key，参数摘要绑定原操作；模型不生成随机去重号。所有成功返回必须先保存真实回执。content 包含模型需要的 ID/状态/路径，structuredContent 是声明 outputSchema 时的程序返回，details 只供展示/重建、不进入模型上下文。错误设置 isError；关键保存失败按 S4 停止准入。

### createTask

输入：kind（standard/light/document）、goal、scope、acceptanceRefs、basisRefs、planMarkdown、sourceInputId、requirementId?、authorizationRef。

先分配稳定 taskId，按 S6 保存总体 Plan 到 `.dev/work/<taskId>/plan.md`；事务登记 Task、planRef、当前主管 currentTaskId 与原回执。返回 taskId/revision/phase=plan/planRef。总体 Plan 包含目标、范围、依据、步骤/责任、验证、风险与待决定事项，不预先创建全部专业 Session。已有实施授权默认覆盖范围内 Plan；逐计划政策或新增范围需对应有效决定。

逐计划确认时，主管先用 interaction.request 的 plan.confirm 展示完整 planMarkdown 提案，以正文摘要作为 subjectRef/version；批准后 createTask 提交相同正文并引用该 interactionId。确认不依赖已存在的 taskId 或 Plan 文件。修订已有 Plan 同样先批准提案，绑定原 taskId/Plan 版本，再由 updateTask 保存；政策不要求确认时沿原授权直接保存。

同需求仅一个未结束 Task，同主管仅一项未结束 Task（含暂停）；碰撞返回原关联/TASK_BUSY，不默默建立第二项。需求保存和自由讨论不自动建 Task。

### updateTask

输入：taskId、expectedRevision、phase、summary、nextStep?、blockReason?、status?（active/waiting）；修改正式目标时可附 changes={goal?,scope?,kind?,acceptanceRefs?,basisRefs?,planMarkdown?,expectedPlanVersion?,authorizationRef?}。

保存前一阶段总结、当前阶段与下一步，返回新 revision。phase=clarify/design/plan/develop/review/test/settle；轻量/文档依 D-04 适用路线。阶段切换前调用，阶段内不逐 token 更新。Runtime/报告不自动推进 phase；技术事实不覆盖主管摘要。

目标/验收/依据实质修订先停稳相关写入，核对用户决定与原 Plan 版本，保存新 Plan/basis，旧候选/验证失效。禁止用 updateTask 直接 completed/cancelled，禁止覆写原控制意图。进入 test 核对当前候选的必要 Review 已完成且问题处置有效；角色选择和是否返工由主管决定。

### createTaskSessions

正式工作 taskId 必需；自由讨论的只读调查可省略，角色限 investigator。首版每次只组织当前步骤。mode 是互斥形状：

| mode | 参数 | 动作 |
|---|---|---|
| create（默认） | sessions[{roleId,specialization?,label,instructions,refs,dependsOnResultIds?,expectedKind,candidateId?,workspaceRef?}] | 原子创建专业 Session、Task 关联、首条输入、本批 delegationId；提交后异步调度并等待 |
| wait | delegationId | 等同一批现有工作；不追加输入、不重建 Session |
| continue | sessionId、instructions、refs、dependsOnResultIds? | 原 Session 保存新输入并生成本次等待；适用返工增加 workRevision，旧结果保留 |

create 整批接纳失败则无半批工作。角色符合 Task 当前阶段；Review/Test 带 candidateId、总体 Plan/正式依据，不能同批混合 Review/Test。并行开发的 workspaceRef 必须是服务登记的分离目录；共享真实目录不允许多写者。工具内部复用统一 Session 创建/绑定/Runtime。

工具保存接纳身份后等待，期间 onUpdate 可显示实际 ID/进度，但不当成功终态。返回固定 [M2](messaging-and-collaboration.md#m2-委派等待协议) 结果：completed、needs_input 或 blocked。主管等待的是当前指定工作，子请求/阻断会交回控制权；不等整项 Task 或 Session 永久结束。

continue 核对归属、授权/当前 Plan、控制和已知效果；不得在另一个输入仍执行或挂起时并发 prompt。活跃授权通过 interaction 响应继续原工具，不调用 continue 复制工作。开发/文档范围内返工可复用原 Session；新 Review/Test 必须独立 Session。

### endTask

输入：taskId、expectedRevision、settlementResultId。按 G3 核对，返回 completed/revision 或 COMPLETION_INCOMPLETE 与缺项。成功事务释放 currentTaskId；已有成果未变化时仅补缺项，不重新实施。phase=settle 留作最后业务阶段，完成由 status=completed 表达。

### task

辅助 op：get（只读当前 Task/Plan/Session/结果/交互/缺项）；prepare_candidate（停写预约、固定候选、清单摘要）；control（pause/resume/cancel，CAS，按 S5）；adopt（新主管，停稳后 CAS 转交，目标主管必须无未结束 Task）。只有 chief 有写 op，专业角色只有自身 task.get。

### agent_report

专业输入：kind（design/implementation/review/test/settlement/investigation/recovery）、summary、body 或 reportRef（二选一）、basisRefs、candidateId?、verdict?、checks[]、supersedesResultId?、settlement?。不提供子 Plan 报告种类；每个正式最终报告结束当前 workRevision 的写入。

checks 每项 name/status（passed/failed/blocked/not_run）/command?/exitCode?/reason?/evidenceRefs。只有实际检查写 passed，真实失败保留 failed；未覆盖有原因与处置引用。

报告服务核对 actor/期待种类/候选/依据，保存 `.dev/work/<taskId>/<sessionId>/` 文件；无 Task 调查使用 Server 调查目录。然后一个事务保存 result、原回执；提交后唤醒相关委派等待。返回 resultId/reportRef，主管通过原委派工具取得结果。报告已保存但 Pi 未停稳时不能把本批工作标完成。

报告正文/结构不可变；修订新增 resultId、supersedesResultId，validity 是当前工作/候选/依据的投影。只能修订同 Task 同种类且原 Session 或新独立复核明确依赖的报告。settlement 必须附 S6 的结构化清单。

### requirement

| op | 参数 → 结果 |
|---|---|
| list | status?、limit、cursor? → items/invalidFiles/nextCursor |
| get | requirementId → 原文、元数据、version、引用/格式问题 |
| save | requirementId、expectedVersion（新建 null）、markdown、authorizationRef → 原子保存的 ID/path/version/metadata |

格式 v1：YAML 元数据 schemaVersion:1/id/title/status/createdAt/updatedAt/modules[]；status=pending/in_progress/completed/cancelled/archived。正文七个二级标题按顺序各一次：目标、范围、行为与异常、验收、来源与决定、未知、完成摘要；可用三级标题细分，未知/尚未实施如实说明。modules 为已有项目相对文档路径；时间 UTC RFC3339；位置 `.dev/requirements/<id>.md`。

安全解析 YAML，核对 Schema/引用/原版本，以同目录临时文件原子替换；碰撞/旧版本拒绝，失败保留原文。列表从文件重建，监听只加速，非法文件不被筛选隐藏。updatedAt 倒序/id 升序。授权必须引用真实用户输入/已解决交互；保存不自动开 Task，归档不移动删除文件。

### interaction

按 [M5](messaging-and-collaboration.md#m5-统一交互与授权) 使用一个请求/响应协议：

| op | 调用者与作用 |
|---|---|
| request | chief/专业 Session：kind、method、title/message、options?、subjectRef/version、actionRef?；保存原请求并等待答复。chief 自己发起即 presented；子请求为 requested，让当前委派返回 needs_input |
| present | chief：interactionId；展示原请求/来源/影响，requested → presented；不能修改原操作范围或悄悄批准 |
| wait | chief：interactionId；异步等已呈现请求的答复，经专用响应入口解除等待 |
| resolve | chief：interactionId、expectedRevision、response、sourceInputId；仅处理已收到的真实用户文字答复；和按钮走同一服务，不接受模型自造授权 |
| invalidate | chief：interactionId、expectedRevision、reason；失效原 requested/presented 请求并取消原 request/wait，不批准原动作；已解决请求不能覆写 |
| apply_initialization | chief：已批准初始化 interactionId、expectedProjectRevision；应用批准差异包，核对入口，失败补原步骤 |

kind 首版 requirement.create/requirement.implement/plan.confirm/scope.confirm/project.initialize/tool.confirm/question。Plan 确认仅指主管总体 Plan，request 附 planMarkdown、proposalHash、taskId?/basePlanVersion?，批准严格绑定该提案。已有明确授权复用，子内部计划不另触发确认。

project.initialize 的 request 附 initialization={files:[{path,expectedVersion,content}],reusedAuthorityRefs,requestWriteUse}。批准事务记录 Project.writeAuthorizationRef 与 initializationRef={interactionId,proposalHash,status:approved_pending}；apply_initialization 只按批准包逐文件核对/原子保存/留回执，入口有效后 ready。拒绝不写，冲突保留原文并重新提出当前差异。

## G3 总体 Plan、候选与完成核对

Task 只有主管维护的总体 Plan。专业 Agent 可自行规划或直接完成简单目标，无必需文件/审批；Review 以需求、验收、总体 Plan 和实际候选为准，开发者内部计划不替代验收。

prepare_candidate 在相关写入停稳后取得 capture 预约，复制源码/配置/正式依据及受影响未跟踪文件，排除凭证/缓存/临时产物；前后清单复核外部变化，变化返回 CANDIDATE_CHANGED。Review 读取固定目录，Test 使用独立可写副本；并行成果组合后重新固定候选验证。

| endTask 条件 | 实际核对 |
|---|---|
| 目标/总体 Plan/授权 | 当前版本、依据、有效决定 |
| 专业工作停稳 | 必需正式结果、无残留运行/未解决交互/未知效果 |
| 适用验证 | 标准代码同候选 Review 后 Test；轻量/文档独立检查；阻断问题闭合 |
| 交付一致 | 实际源码/配置/测试与候选清单一致，改变重新验证 |
| 结算保存 | 受影响知识/摘要/入口/报告、遗留、覆盖处置、Git 或本机回执 |

不把真实缺陷改成未覆盖，不通过取消清除已报告问题。结算只变更列明记录，源码/正式目标改变回到适用检查。有 Git 保护无关改动/暂存；无 Git 返回 local_saved。

## G4 规则与上下文装配

```text
Pi 原生说明 + 内置基础规则 + 当前角色规则
 + 项目入口 AGENTS.md / .dev/INDEX.md / .dev/PROJECT.md
 + 当前 Task/总体 Plan 与输入，或主管的专业目标/依据路径
```

内置文本：[base](prompts/base.md)、[chief](prompts/chief.md)、[当前专业角色块](prompts/specialists.md)。只注入当前角色，规则/模型/工具/cwd/绑定摘要持久记录。主管压缩/重启从 currentTaskId + task.get 找回真实关系，不只靠记忆 ID。

专业 Agent 自行按引用 read；Server 校验归属/可读性，不拼整项目。独立 Reviewer/Tester 不读开发/主管/其他 Reviewer 聊天自评。明确 resourceLoader，不自动加载未知扩展。项目规则变化在安全边界核对并显式更新/交接。

角色模型按角色覆盖 → 项目默认 → Server 默认，执行时固定；不可用保留阻断，不静默回退。基础规则落实产品，不新增业务门禁或审批义务。

## G5 模型行为检查

覆盖自由讨论不建 Task、主管总体 Plan、显式阶段更新、按步委派、批次中间交互/原等待续接、并行 Review 后 Test、返工、真实报告、结算缺项和压缩恢复。模型/运行证据见 [实现检查](implementation-checks.md)，提示词不证明可靠性。
