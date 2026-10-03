# 角色、工具与上下文契约

产品依据：[D-02～D-08](../productnew/modules/delivery.md)、[C-01～C-06](../productnew/modules/chief-conversation.md)、[K-02～K-06](../productnew/modules/project-knowledge.md)。本页定义 Pi 工具与规则装配；业务阶段含义仍由产品定义。

## G1 角色与工具集合

角色决定职责、初始工具和上下文；不决定新的调度架构。roleId 由已配置目录选择，首版内置下表。chief 只能由用户会话入口创建，不能作为 agent_delegate 专业角色。前端/后端是 developer 的 specialization 与模型覆盖项。

| roleId | 责任 | Pi 原生能力 | AgentDev 工具 |
|---|---|---|---|
| chief | 讨论、明确目标、组织专业工作、决定与最终核对 | read；初始化与规范保存由领域服务写入 | task、agent_delegate、agent_send、requirement、decision |
| product | 需求、内聚产品知识、正式文档 | read；文档 Plan 有效时 write/edit | requirement、agent_report、task.get |
| designer | 技术设计、契约与依据 | read；文档 Plan 有效时 write/edit | agent_report、task.get |
| developer | 先 Plan，再实施或范围内修复 | Plan 阶段 read；确认后 read/edit/write/bash | agent_report、task.get、requirement.list/get |
| reviewer | 对固定候选独立审阅 | read；不提供源码写工具或任意 bash | agent_report、task.get |
| tester | 对审核后的固定候选执行真实测试 | read/bash；仅在自己的测试副本和输出目录操作 | agent_report、task.get |
| settler | 更新已验证知识、摘要、记录并保存成果 | read/edit/write/bash；限结算目标 | agent_report、task.get、requirement.list/get/save |
| investigator | 独立调查、效果核实 | read；需要的安全检查由配置的只读检查能力提供 | agent_report、task.get |

工具的 op 子集按角色校验，不只在提示词里声明。agent_report 仅提供给有分工的专业 Session，主管用 task 工具记录协调，不自造独立检查结果。领域工具绑定 actor 的 projectId/sessionId/taskId/assignmentId；这些身份由 Server 注入，模型不能通过参数切换身份。chief 可以访问本项目其他 Task；专业角色只读自己的任务。

这些是协作能力限制。普通 bash 仍能产生环境影响，独立上下文/测试副本不能声称提供 OS 沙箱。需要真实隔离时另接原生 operations 后端。

## G2 六个领域工具

所有定义使用 Pi ToolDefinition 的参数 Schema 与异步 execute。工具等待其本次保存动作，返回后续异步工作的身份；不等待整项 Task。

公共写操作的 requestKey 由宿主使用当前 inputId、contextEpoch、toolCallId、工具名派生并持久保存；模型参数不需生成随机 ID。恢复原工具调用复用原 key。新的模型调用是新动作，不能凭相似文字去重。[工具 API](https://github.com/earendil-works/pi/blob/v1.0.0/packages/coding-agent/src/core/extensions/types.ts#L617-L633)

返回给模型的 content 含可读结论和关键 ID/路径；details 保留结构值。Pi details 不进入模型上下文。失败返回真实 code/message/当前状态，并设置 isError；持久化故障另按 [S4](storage-and-recovery.md#s4-关键操作与-checkpoint) 停止准入。

### task

| op | 必需参数 | 同步结果 / 校验 |
|---|---|---|
| create | kind: standard/light/document；goal；scope；acceptanceRefs；sourceInputId；requirementId? | taskId、revision、phase；记录已有授权。一个需求只允许一个未结束 Task |
| get | taskId | Task、分工/Session、Plan、候选、结果、决定、阻断、结算缺项；大量结果分页 |
| update | taskId；expectedRevision；phase?；nextStep?；blockReason? | CAS 后的新 revision；禁止直接设置 completed 或覆盖控制意图 |
| revise | taskId；expectedRevision；goal/scope/kind/acceptanceRefs/basisRefs 的变更；authorizationRef | 先暂停并停稳旧范围写入，CAS 保存新 goalRevision，回到 plan/design；旧 Plan/候选/验证失效；范围/验收改变须有用户决定，重新确认后 resume |
| approve_plan | taskId；assignmentId；planResultId；authorizationRef | 核对 Plan 当前版本和确认来源，保存批准。来源为用户决定、既有实施授权或项目默认政策 |
| prepare_candidate | taskId；basisRefs | 等相关写入停稳，生成固定候选及清单摘要；繁忙时返回 WORKSPACE_BUSY，不假装已冻结 |
| control | taskId；expectedRevision；command: pause/resume/cancel | 返回已保存控制意图/实际状态，执行停止或恢复按 S5；不会等待整项任务 |
| complete | taskId；expectedRevision；settlementResultId | 返回 completed 或 COMPLETION_INCOMPLETE 与逐项缺项；缺项不改变完成状态 |
| adopt | taskId；expectedRevision；newChiefSessionId | 旧主管停派发、引用核对后 CAS 转交；原分工结果仍归原 Task |

update 由主管记录关键业务进展；委派/报告/确认/控制本身更新相应事实，不要求每个 token 或读取都调用 task。phase 使用 clarify/design/plan/develop/review/test/settle；轻量/文档可省去不适用阶段，适用性见 D-04。

进入 test、接纳 tester 分工与 complete 共用同一有效结果核对：标准开发当前候选的 Review 已完成，必要问题已处理，依据未变。程序不自动选择 Test Agent。共享写入繁忙时 Runtime 停稳会给主管发送去重的 assignment.settled 通知，主管可再请求候选，无需循环查询。

### agent_delegate

输入：taskId（正式工作必需，只读调查可省略）、assignments 数组。每项：roleId、specialization?、label、instructions、refs[]、dependsOnResultIds[]、expectedKinds[]、candidateId?。refs 为路径与用途；任务说明可自由组织，不是固定上下文表。

- 单事务保存全部分工、专业 Session 和首条输入；任一校验失败拒绝整批。
- 返回 taskId 与每项 assignmentId/sessionId/roleId/status/inputId；只证明接纳。提交后 Dispatcher 启动。
- Review/Test 的 candidateId 和正式依据必需，role 与 Task 阶段匹配；Review 未满足时不能委派 Test；同批不混合该 Task 的 Review/Test。
- 可写角色的新正式分工 initial expectedKinds 必含 plan 与最终种类（例如 developer 为 plan/implementation）；输入省略 plan 时按角色补齐后校验并保存。先进入 Plan，只读工具；已有适用确认计划的返工可引用原 Plan 接续。
- 专业 Agent 首版不获得再次委派工具。发现需协作或新目标时报告主管，由主管决定；各专业 Session 共用 Runtime。

### agent_send

输入：sessionId、instructions、refs[]、dependsOnResultIds[]、planResultId?。

事务保存发往既有专业 Session 的输入，返回 inputId/sessionId/status。核对它属于该主管当前协调的分工；暂停/取消、旧主管或待恢复会话不得偷偷启动。确认 Plan 后继续同一个 developer Session。已 final 的 developer/product/designer/settler 只有明确范围内返工才可接续：增加 workRevision，清除当前修订 final 写禁令，核对或更新批准，保留旧结果；Review/Test 的新检查必须新建专业 Session。

### agent_report

输入：kind、summary、final、body 或 reportRef（二选一）、basisRefs[]、candidateId?、verdict?、checks[]、supersedesResultId?、settlement?。

kind：plan/design/implementation/review/test/settlement/investigation/recovery。verdict：passed/failed/blocked/not_run；checks 每项含 name、status（同 verdict 枚举）、command?、exitCode?、reason?、evidenceRefs[]。未覆盖项目写 not_run 与原因，结算引用其覆盖处置；只有实际执行过的项目写 passed，真实失败保留 failed。

1. 从 actor 取得归属，不接受任意 sessionId/assignmentId。kind 符合本分工 expectedKinds；Review/Test 核对候选与依据。
2. body 由报告服务保存到 `.dev/work/<taskId>/<assignmentId>/`；reportRef 则读取并核对当前内容摘要。无 Task 调查保存在 Server 调查产物目录，正式结算可引用入项目。
3. 文件保存成功后，在一个 DB 事务里保存不可变结果、分工进展和主管 result_notice 输入。稳定 requestKey 去重；同 key 改内容冲突。
4. 返回 resultId、reportRef、结果版本、通知 inputId；不等待主管处理。通知失败/回复丢失重试取得原结果。

plan 的 final=false：提交 Plan 后等待批准，不开始实施；最终实施/检查的 final=true：禁止该分工再修改候选，等待 Pi 停稳。报告接纳与实际停止分别记录，迟到/已失效结果保存为历史，不满足当前完成条件。修订报告生成新 resultId；supersedesResultId 只能指同任务同种类的原报告，且必须是原分工修订或主管在新独立复核分工 dependencies 明确指定的对象。正文不可变，validity 为当前候选/依据/修订关系生成的投影，不改旧正文。settlement 种类必须提供 S6 的 SettlementManifest，不能让程序从 Markdown 猜完成清单。

### requirement

| op | 参数与返回 |
|---|---|
| list | status?、limit、cursor? → 摘要 items、invalidFiles、nextCursor；无需模型读取 |
| get | requirementId → 原文、元数据、version（内容 SHA-256）、引用与格式问题 |
| save | requirementId、expectedVersion（新建为 null）、markdown、authorizationRef → 校验与原子保存后返回 ID/path/version/metadata |

元数据字段为 schemaVersion:1、id、title、status、createdAt、updatedAt、modules[]；status 为 pending/in_progress/completed/cancelled/archived，映射 R-05 五项含义。正文包含 R-01 七部分；新建 ID 由调用者选用未占用编号，碰撞返回 VERSION_CONFLICT；id 与 `<id>.md` 对应，状态只有头部这一份来源。引用必须存在，拟议模块写在正文而不是伪造 modules 路径。

格式 v1 的七个二级标题固定为 `目标`、`范围`、`行为与异常`、`验收`、`来源与决定`、`未知`、`完成摘要`，按此顺序各出现一次，内容可用三级标题拆分。草稿也保留七节；未明确、无未知、尚未实施分别如实说明。modules 是 DocumentRef.path 数组，时间使用 UTC RFC3339；文件位置为 `.dev/requirements/<id>.md`。入口索引引用这份格式定义，不另维护逐条状态列表。

保存前解析 YAML（安全数据解析）、校验字段/状态/结构/引用与预期版本；以同目录临时文件替换，失败保留原文。读取后生成列表，无双向 DB 状态同步；刷新重扫文件，监听只用于加速。非法文件无论筛选条件如何都返回错误及路径。待实现按 updatedAt 倒序、id 升序稳定排列。

明确保存授权由主管给出 sourceInput/decision 引用；工具不凭讨论文本自动保存。需求保存不创建 Task。归档不移动或删除文件。完成摘要的语义质量由 Agent 检查，结算的完成事实由 task.complete 核对。

### decision

| op | 参数与返回 |
|---|---|
| propose | kind、question、choices[{value,label}]、subjectRef、subjectVersion、taskId? → decisionId、revision、可显示 action |
| resolve | decisionId、expectedRevision、choice/value、sourceInputId → 已保存决定与执行依据；sourceInput 必须来自用户答复 |
| apply_initialization | decisionId、expectedProjectRevision → 校验已确认文件差异，保存入口并收口 initializationRef；失败可按原操作补齐 |

project.initialize 的 propose 还需 initialization={files:[{path,expectedVersion,content}],reusedAuthorityRefs,requestWriteUse}。程序核对当前原文件摘要，保存这个差异包/subjectVersion；UI 展示实际差异与写入使用范围，现有权威正文只引用不复制。用户批准时，决定解决事务同时保存 Project.writeAuthorizationRef 和 initializationRef={decisionId,proposalHash,status:approved_pending}；没有批准不允许写。

主管随后调用 apply_initialization：只应用批准包中的目标和内容，逐文件核对 expectedVersion、原子保存、保存操作回执；已是目标内容则复用。最后核对入口/引用，事务改 initializationRef.status=ready。冲突保留原文件，等待新差异决定；失败从原包/步骤补齐，不能让普通 write 绕过。已有有效入口可提出空文件包与复用引用，不强制重写。

kind 首版：requirement.create、requirement.implement、plan.confirm、scope.confirm、project.initialize、question。只规定业务含义与稳定选项 value，不规定按钮布局。已有明确授权直接引用，不为了显示按钮再造一次确认。

点击使用运行契约的 decision.submit；正文答复由主管调用 resolve，两条路径保存同一决定。subjectVersion 改变、已解决不同选择、跨项目或来源不符拒绝；相同重复选择返回原决定。决定收到后先持久化并通知主管；后续保存需求/实施仍由主管调用相应工具。

## G3 Plan、候选与完成核对

实施 Session 先读依据，通过 agent_report 提交 Plan；批准记录固定 planResultId、依据摘要、授权引用。主管调用 agent_send 继续，同 Session 入口根据这份批准启用写工具。Plan 无效或范围变化先处理确认；普通工具调用不会另建 Plan。

prepare_candidate 在相关写入停稳后先取得 S2 的 capture 预约，阻止新写，再捕获源码/配置/正式依据清单，保存 candidateId、内容摘要、basisDigest 与验证目录。包括受影响未跟踪文件；排除凭证/依赖缓存/临时输出。复制范围记录在清单，缺失依赖明确报错；不要求自动建 worktree。Review 读取固定目录，Test 从同候选建自己的可写副本；测试输出不改变原候选。复制后复核原目录与候选清单，外部变化返回 CANDIDATE_CHANGED；完成后释放预约。

完成核对最小条件：

| 条件 | 程序核对的引用；语义由主管/独立 Agent 判断 |
|---|---|
| 目标/Plan/授权有效 | 当前依据、批准记录、有效决定 |
| 适用专业工作结束 | 当前分工的正式结果；相关 Pi 执行已停稳，无未知副作用 |
| 标准开发验证有效 | 同候选/同依据的独立 Review 和 Test；Review 在 Test 前；阻断问题已闭合 |
| 轻量/文档检查有效 | 适用独立 Review/检查报告；不强制伪造 Test |
| 交付对象一致 | 实际交付源码/配置/测试文件与候选清单一致，无新增/删除/改动绕过检查；变更重新验证 |
| 结算与保存有效 | 受影响知识、需求摘要、入口、归档清单及 Git/本机保存回执 |
| 无未处理阻断 | 已知失败不能改成未覆盖；非阻断覆盖缺口有用户处置引用 |

代码/依据改变生成新候选，旧 Review/Test 标失效。必需审阅未完成或有阻断时不进入 Test；多个同阶段分工逐项保存，主管汇总。停止多余分工必须保留原因与已报告问题，不能用取消抹掉失败。

结算允许改变列明的知识/摘要/入口/报告文件，相应文档检查记录其 diff 不改变产品定义或验证依据；源码/配置/测试以及正式目标实质变化不得作为结算例外。

Git 结算只提交本次成果与记录；无关暂存/改动无法安全分离时返回阻断。没有 Git 返回 local_saved。完整跨存储顺序见 S6。

## G4 规则与上下文装配

```text
Pi 原生基础能力说明
 + AgentDev 内置基础规则（固定版本）
 + 当前角色规则
 + 项目入口：AGENTS.md / .dev/INDEX.md / .dev/PROJECT.md
 + 当前输入：用户内容，或主管给出的专业任务说明及依据引用
```

- 内置文本：[base](prompts/base.md)、[chief](prompts/chief.md)、[专业角色块](prompts/specialists.md)。构建时只选择当前角色块，版本/摘要记录在 Session 绑定中。
- 主管新上下文读项目三个入口；缺失记录未知，首次初始化走 P-02。后续空闲输入前检查入口摘要；变化后追加明确规则更新或交接新上下文，不能静默沿过期规则执行。
- 专业 Session 收到基础规则、角色、主管任务说明与引用；自行 read 相关正文。Server 核对引用可读和归属，不分析整项目、不替主管拼全部知识。
- Reviewer/Tester 新建独立上下文，只读正式需求/Plan/候选/真实证据；不复制主管、开发者或其他 Reviewer 聊天。允许主管描述任务，禁止把自评当结论依据。
- input 记录实际 model/configHash/rulesHash 与 refs；报告记录实际使用依据。角色模型按项目角色覆盖 → 项目默认 → Server 默认解析，认领时固定；不可用则阻断，不静默回退。
- 显式 resourceLoader，只启用内置/已配置资源与工具；不自动执行全局或项目扩展。项目补充规则与用户已有授权保留，冲突交主管处理。
- 压缩后依据丢失时按 task.get 与项目索引重读；恢复需要同时重建角色、工具、cwd、模型和历史绑定，不能只恢复聊天。

## G5 给模型的行为检查

先覆盖：自由讨论不建 Task；明确保存调用 requirement.save；正式工作先 Plan；批量委派返回真实 ID；收到一份 Review 不提前启动 Test；等待专业结果时结束本次执行；结果丢失可查询原 Task；检查失败返工；未知效果不盲重试；结算缺项不自称完成。

实际运行/模型行为证据进入 [实现检查](implementation-checks.md)。提示词不是可靠性证明，持久化、身份与完成核对必须由程序实现。
