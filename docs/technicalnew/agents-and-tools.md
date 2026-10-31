# 角色、工具与上下文契约

产品依据：[任务交付](../productnew/modules/delivery.md)、[主管对话](../productnew/modules/chief-conversation.md)、[项目知识](../productnew/modules/project-knowledge.md)。字段唯一在本页，需求格式见 [F](requirements-format.md)，通用交互见 [M5](messaging-and-collaboration.md#m5-统一交互与授权)。当前为待实现契约。

## G1 角色与工具集合

| roleId | 责任 | 能力（Pi 原生文件工具按 Task 类型裁剪） |
|---|---|---|
| chief | 用户讨论、总体 Plan、阶段/步骤、委派、业务判断与收口 | read/grep/find/ls/bash；四个核心工具、task（全 op）、requirement、project、question、web_search、web_fetch、browser |
| designer | 产品分析、模块内聚、需求及适用技术架构/契约 | read/grep/find/ls/write/edit/bash、requirement、agent_report、task(op=get)、question、web_search、web_fetch |
| developer | 实现指定目标，内置单元/TDD 自查（D-05） | read/grep/find/ls/write/edit/bash、agent_report、task(op=get)、requirement.list/get、question、web_search、web_fetch、browser |
| reviewer | 独立检查需求/验收、Plan 和实际成果 | read/grep/find/ls、agent_report、task(op=get)、question、web_search、web_fetch、browser（只读动作） |
| tester | Review 后独立端到端集成/E2E 验收（D-05） | read/grep/find/ls/bash、agent_report、task(op=get)、question、web_search、web_fetch、browser |
| settler | 更新已验证知识/记录，保存成果 | read/grep/find/ls/write/edit/bash、agent_report、task(op=get)、requirement、question |
| investigator | 独立只读调查/恢复核实 | read/grep/find/ls、agent_report、task(op=get)、question、web_search、web_fetch、browser（只读动作） |

所有角色使用同一 Pi 原生交互适配。前后端是 developer.specialization。专业 Session 必须绑定 Task，不能再委派。身份/Task/工具 op 由宿主固定，不靠模型参数切换。read Task 不开放项目写工具、requirement.save 或任意 bash；agent_report 仍可写 Server 报告。write Task 中 Reviewer 依然只读。主管可用 bash 直接核实实际状态（git、测试入口、文件布局），实现类写入仍由专业 Session 承担。设计与文档整理需要移动或删除文件（归档、改名、去掉重复正文）时用 bash（`git mv`/`rm`）：Pi 没有 rm/mv 工具，不另造文件管理工具；移动后同步引用，不留下两份正文。Local 工具允许列表不是 OS 沙箱，业务范围和命令影响由 Agent 判断，实际交付状态由程序核对。investigator 不持有 bash/write：需要执行脚本或测试才能核实时，在报告中把对应 check 标为 `not_run`，写明最小复现命令和缺失证据，由主管在适用阶段派 tester，或主管自己用 bash 执行；结果作为证据回到核实，不改变 investigator 的只读身份，也不新增执行工具。
**bash 超时由宿主兜底**：模型未传 `timeout` 时，宿主扩展为每次 bash 调用注入默认值（`AGENTDEV_BASH_TIMEOUT_SECONDS`，默认 600 秒；0 关闭），显式值优先。超时是工具错误结果，模型可换命令或加大超时重试，不会把整个 run 拖到 15 分钟 stall。


## G2 模型工具

五个领域工具由 customTools 注册：task（Task 全流程）、agent_report、requirement、project，以及 question；question 由官方示例移植的内置扩展经 pi.registerTool 注册一次，resourceLoader 显式加载，不增加通用扩展系统。[SDK](https://github.com/earendil-works/pi/blob/v1.0.0/packages/coding-agent/docs/sdk.md)

task、agent_report、requirement、project 按工具级注册 Pi executionMode=sequential；专业只读 task 可沿用原生执行。模式是静态工具配置，不按 op 动态切换，不拆第二套调度器。

宿主 requestKey 从 inputId/调用身份/工具名派生；保存原参数摘要和真实回执，重试不重复创建/保存。模型可见 content 必须含必要 ID、状态与报告事实；outputSchema 声明时 structuredContent 承载同一事实，details 仅展示。错误 isError，不伪造成功。不包装 Pi 原生工具执行/恢复栈。

**执行是顺序的**：一个主管 Session 同时只推进一项未结束 Task，一个 Task 的当前步骤一次只由一个写者改同一份文件。因此模型不携带任何版本/令牌：revision、文件摘要、候选 id、计划版本、报告版本都不出现在任何模型工具的参数里。程序自己记录「本会话上次读到什么」并在事实变化时返回当前内容，不要求模型回显。

### task

一个工具覆盖 Task 全流程，op 选择动作。除 get 外均为主管写操作；专业 Session 只能 get 自己所属的 Task。

| op | 参数 → 结果 |
|---|---|
| create | type（read/write）、goal、scope、acceptanceRefs、basisRefs、planMarkdown、requirementId?、requiresTest?、authorizationRef → taskId/phase/planRef |
| update | taskId、phase?、summary、nextStep?、blockReason?、status?（active/waiting）、changes?={goal?,scope?,acceptanceRefs?,basisRefs?,planMarkdown?,requiresTest?} → 当前 Task/阶段/成员/下一允许动作（授权引用建 Task 时固定，不在 update 中改写） |
| dispatch | taskId、sessions?[{roleId? 或 sessionId?、label?、instructions、expectedKind?、refs?、dependsOnResultIds?、writeScope?:string[]}]、waitTimeoutMs? → 当前步骤全部成员状态与报告/重叠告警；写角色在 write Task 必须提供非空 writeScope |
| control | taskId、command=pause/resume/cancel → 实际 status 与待处理状态 |
| end | taskId、completionResultId → completed，或 COMPLETION_INCOMPLETE + 缺项清单 |
| get | taskId?（缺省宿主 currentTaskId）、includeResultBodies? → Task/Plan/成员/结果/缺项/nextActions，按显式引用返回报告正文 |
| adopt | taskId、chiefSessionId → 新所有者；停稳相关执行，目标主管无未结束 Task |
| recover | taskId、sessionId、evidenceRefs、resolution=completed/failed/stopped → 核对归属与证据后关闭该 Session 的中断输入；证据不足保持 interrupted |

**create**：type 由主管依据目标选择，与专业角色分开。requiresTest 是主管按 D-04 声明的必要报告：行为代码修改必须 true，轻量/文档通常 false；read 必须 false。read 省略 requiresTest 时取 false，禁止 true；write 必须显式提供 boolean，缺失 INVALID_ARGUMENT。程序验证值及必要报告，不从 goal 自然语言推断类型/测试责任。

分配稳定 taskId，按 S6 保存总体 Plan，再事务登记 Task/planRef/currentTaskId/回执。Plan 写目标、范围、依据、步骤/角色、验证、风险与未决事项，规模与任务相称；不预建未来专业 Session。read Plan 可以很短，但不写入项目。authorizationRef 为 {inputId} 或 {interactionId}；程序只校验引用的主体、来源与状态，不解释语义授权范围。

同一实施需求至多一个未结束实现 Task，同主管至多一项未结束 Task（含暂停）；冲突返回关联/TASK_BUSY。requirementId 只表示「本 Task 实施该实施需求」（R-04）：提供时核对记录存在、可读、kind 为 implementation 且状态为 pending/in_progress，否则拒绝并不建 Task；read Task 不得提供。Task 建立成功后，若该记录为 pending，程序把它改为 in_progress 并在结果里报告（`requirement.status`），这是程序唯一自行写入的需求状态：有未结束实现 Task 即是进行中。改写只动 front matter 的 status/updatedAt 两行，正文不重新序列化；已 in_progress 的文件保持字节不变；cancelled/completed/archived 不被重新打开，只作为告警返回。完成、取消、归档仍由主管保存决定。Task 不必对应需求——设计/规划规则、调查、知识维护均可不填。

**update**：phase 枚举 clarify/analyze/design/plan/develop/review/test/settle，由主管显式记录；提供 phase 表示开始下一步骤，当前步骤成员必须已结束或已明确控制并停稳。事务保存上一步骤总结、当前 phase，清空 currentSessionIds，保留历史。不提供 phase 仅更新摘要/阻断/下一步。目标或依据实质改变时由主管判断并在 summary 说明，直接保存修订 Plan；不存在「旧报告自动失效」的声明参数——程序的核对见 G3。type 创建后不变。

**dispatch**：只组织当前步骤。有 sessions 即派发：每项 roleId 与 sessionId 恰有一个——roleId 新建专业 Session，sessionId 对已停稳成员追加剩余工作；**instructions 只有一个位置**。新建成员省略 label/expectedKind 时由宿主按 roleId 取值（不给模型增加必填项）。不带 sessions 表示仅等待当前步骤。整批接纳原子，不出现半批。

并行规则（R-04/D-01）：只读工作可任意并行；写工作允许同一 Task 内按模块并行，每个写成员必须声明 writeScope（项目相对路径或 glob）。程序只核对范围**重叠**并告警，不拦截——是否可并行、如何分工由主管判断。首版不要求分离目录；并行多个 Task 使用独立 git worktree 属于后续版本，不在本版。

程序按 M2 等待当前步骤全部成员停稳再聚合报告/异常。超时返回状态快照与明确的「继续等待」提示，不 abort 子工作；主管在成员仍运行/排队/等用户时须在同一回合同再次 dispatch 空名单，不得以状态说明结束回合；waitTimeoutMs 缺省 120 秒，按 1–300 秒夹取。不得并发 prompt 同一成员，不续办仍 queued/working/waiting_user/stopping 的成员，不重复已完成成果。暂停/中断 Task 的只读恢复只允许 investigator + expectedKind=recovery。Test 派发前程序核对存在 passed 的独立复核且其步骤成员已停稳，否则 STAGE_NOT_READY；Review 与 Test 不混合同步启动。

**end**：按 G3 核对，成功事务 completed 并释放 currentTaskId；缺项 COMPLETION_INCOMPLETE，已有成果保留。业务完成判断由主管/独立 Agent 负责。

**nextActions**：dispatch/update/get/end 的返回都带「现在允许做什么、缺什么、谁能做」，模型据此行动，不靠试错学习状态机。被拒绝的派发/阶段切换同时返回当前步骤成员状态与当前阶段可派发的角色（phase/status/allowedRoles/members），报错即可行动；`gaps` 只是程序观察到的事实，不代替主管判定完成。

### agent_report

输入：summary、body、basisRefs?、verdict?（passed/failed/blocked）、checks[]、settlement?。

报告种类由成员被派发时的 expectedKind 决定，**模型不再声明 kind**。Review/Test 的 verdict 必填，其他报告可选。同一成员同一轮可以提交多份报告，保留历史；完成核对使用该步骤最近一次通过的独立报告（G3），不需要 supersedes 参数。

每项 checks 为 name/status（passed/failed/blocked/not_run）/command?/exitCode?/reason?/evidenceRefs。真正执行才 passed，真实失败保留 failed，未覆盖说明原因/风险/用户决定。需要主管决策时提交 expectedKind 的正式 blocked 报告并结束当前输入；普通用户问答使用 question。

body 为用户可见的完整正文，按 S6 原子保存：read 报告与 write Task 内的 investigation/recovery 只读报告写 Server，其余 write 报告写项目 `.dev/work/<taskId>/<sessionId>/`；提交时程序记录报告事实与实际交付状态（见 G3），模型不传候选或版本。唯一例外是结算报告：路径固定为 `<taskId>/<sessionId>/settlement.md`，结算先写入并提交该正文（D-07），再以相同 body 提交报告；程序发现已有文件内容不同则拒绝，不会改写已提交正文。报告保存且 Pi 停稳才算成员结束。正式报告后不继续修改当前成果。

### requirement

提案/实施需求可 get，待处理列表用 list；正式新建/修改/状态保存必须 save，不能 write/edit/脚本覆盖。产品、技术、索引文档仍用原生文件工具。

| op | 参数 → 结果 |
|---|---|
| list | kind?、status?、limit、cursor? → items/invalidFiles/nextCursor |
| get | requirementId → 原文、元数据、sections（实施需求）或 body（提案）、实施 Task、引用/格式问题 |
| save | requirementId、kind、title、status、sections（实施需求按七个标题各段 Markdown）或 body（提案自由正文）、modules/sourceRequirementIds/linkedTaskIds?、authorizationRef → 实际 ID/path/metadata、一致性待核对项 |

保存由模型给内容与决定、程序序列化为文件：schemaVersion/id/createdAt/updatedAt 与七个二级标题不由模型填写。程序记录本会话上次 get 到的文件内容；保存时若磁盘已被他人修改，返回当前内容并要求重新读取后再提交，**不要求模型携带摘要**。

保存返回状态与事实的一致性提示，不改由主管作出的决定：实施需求 in_progress 但无实施 Task 时提示，completed 但仍有未结束实施 Task 时列为「完成记录待核对」并给出 Task，提案 archived 但无实施需求以 sourceRequirementIds 引用时列为待核对（R-05）。get 返回该需求名下实施 Task 的实际状态，并与文件记录的 linkedTaskIds 对照；list 报告指向不可读记录的实施 Task。

schemaVersion:2 双类型需求、状态与正文形状的唯一权威见 [F](requirements-format.md)。保存不自动建 Task，归档不移动文件。

### question

使用 [Pi v1.0.0 官方 question 扩展](https://github.com/earendil-works/pi/blob/v1.0.0/packages/coding-agent/examples/extensions/question.ts) 的注册方式移植，extensionFactories 加载、pi.registerTool 一次、executionMode=sequential。浏览器版移除 TUI/custom 界面，参数对应通用原生交互：method=confirm/select/input、title、message?、options?、placeholder?；confirm 必需 message:string，select 必需 options:string[]。不增加业务确认类型。

```json
{ "method": "select", "title": "是否将讨论内容加入需求列表？", "options": ["加入", "暂不加入"] }
```

execute 按 method 调用 ctx.ui.confirm/select/input，传入 signal，真实答复返回模型。UIAdapter 关联当前工具调用，接入层将 interactionId 放入模型可见返回；ctx.ui 原生返回类型不变。统一按 M5 经 WAL/主管通道展示和响应，无独立审批/恢复引擎。

### project

chief 的 op=initialize，输入 files[{path,content}]、reusedAuthorityRefs、requestWriteUse、authorizationRef?。展示真实入口缺口、复用依据、拟写路径/完整内容与影响；需要新决定时内部 ctx.ui.confirm，模型已有明确同意则提供决定引用，程序校验来源/状态而不匹配自然语言范围。

按 S6 保存批准的差异包及文件/回执，实际入口有效才返回 ready。拒绝不写；程序记录本会话上次读到的实际内容，文件被他人修改时返回当前内容要求重新读取，模型不携带版本。失败核对已保存步骤，只补缺项。初始化仍是通用交互，不注册业务确认 kind。

### web_search、web_fetch 与 browser

三项都是"读外部世界"，不改项目文件，因此不计入 `projectReadOnly`，read Task 保留；settler 不持有（它只沉淀已核实成果）。browser 对 reviewer/investigator 恒为只读动作（open/observe/screenshot/console/network/close），在 read Task 也一样，模型无法自我提权；open 只接受 http/https/data/about（拒绝 `file:`，避免把本机文件读进转录）。

- `web_search(query, limit?, recency?)`：按可用性降级——模型同 provider 的检索端点（DeepSeek 复用已配置 key）→ `BRAVE_API_KEY` → 无凭证的 DuckDuckGo 页面。返回 title/url/snippet，并标注 provider；全部失败返回 `Error:` 与各 provider 原因，不伪造结果。单 provider 30s 上限。
- `web_fetch(url, maxChars?, raw?)`：仅 http/https，响应 ≤5MB；HTML 转文本后**全文落盘**到 `<agentDir>/work/<sessionId>/web/<hash>.txt`，只回前 20k 字符（上限 60k）+ 路径，模型用 grep/read 精读（单页文档实测 975KB HTML → 158k 字符）。`<agentDir>/work` 是私有目录里唯一的文件读取豁免区（凭证、数据库、会话文件仍被拒绝，shell 命令仍不得提及私有目录）；响应体按上限流式读取，不信任 `content-length`。
- `browser(action, …)`：action = open/observe/click/type/press/wait/screenshot/console/network/close。observe 给可见交互元素分配 `e1…` 引用，click/type 只接受这种引用；截图写入附件存储、以 image 内容块返回（模型可见），并在文本里给出 attachment id。headless Chromium、每会话一个、空闲 10 分钟关闭；不接用户真实浏览器。缺 Chromium 返回 `BROWSER_UNAVAILABLE`，不假装可用。

### 图片输入（U10）

主管会话可带图片：`POST /api/v1/uploads`（cookie + CSRF，原始字节，png/jpeg/webp/gif，单张 ≤8MB）→ 内容寻址存储 `<agentDir>/attachments/<sha256[:32]>`；`session.input.submit` 的 content 接受 `{type:'image', attachmentId}`（单条 ≤6 张），payload 只存引用；runner 在投递时读盘转 base64 交给 Pi 的 `prompt(text,{images})`。history / 实时快照 / 实时事件统一把 image 块投影成 `{type:'image', id, mimeType}`，浏览器经 `GET /api/v1/attachments/<id>` 取字节——**base64 永不进入浏览器响应**。自定义 OpenAI 兼容 provider 写入 `models.json` 时声明 `input:["text","image"]`，否则 Pi 会静默丢弃图片。

## G3 Task 流程、交付核对与完成

Task 仅主管总体 Plan；子 Agent 可自行计划或直接完成目标，不强制文件/审批。Review 依据需求、验收、总体 Plan、实际交付与证据，不能以作者内部计划代替验收。

| 判断/核对 | 责任 |
|---|---|
| Task 类型、适用 Test、角色/步骤、并行分工与授权含义 | 主管依据 D-04 与真实用户决定；独立 Agent 可质疑 |
| 需求是否满足、问题是否闭合、知识/结算是否完整、依据是否实质变化 | 主管与独立 Agent；写正式报告，不转成自然语言门禁引擎 |
| 身份/归属、当前步骤成员是否停稳、报告身份与种类 | 程序 |
| 复核/测试是否针对当前交付、必要报告是否齐全、真实保存回执 | 程序；内容判断由 Agent 负责 |

**交付状态的绑定（程序侧，模型不可见）**：保存 Review/Test 报告时，程序对项目文件取内容摘要（排除 `.git`、`node_modules`、`.dev` 与工作区已初始化的知识入口），并随报告记录被摘要的路径清单；Test 沿用最近一次通过复核的同一路径清单，两者可直接比较。完成核对按该清单重算：被复核文件被修改或删除即视为交付已变化，最近一次通过的报告不再作为完成依据，要求重新复核；复核之后新增的记录文件不影响判断。该判定直接体现在 end 的缺项里，不引入候选对象或版本参数。

只有一份实际交付：同一 Task 内并行写成员按声明的 writeScope 分工，全部停稳后的工作树就是被复核的对象；**组合成果按最终组合重验证**，不汇总各自「通过」的报告。首版不支持并行多个 Task 的独立工作树。

read：有效 investigation/recovery 结果、全部成员停稳、无待处理交互/未核实中断即可结束，不强制项目文件或 Git。write：全部专业工作已停稳、无开放交互或未核实中断，最近一次独立复核 passed、requiresTest=true 时最近一次测试 passed、settlement 已保存，且交付状态自该复核后未变化；**项目有 Git 时，复核覆盖的交付路径必须相对 HEAD 已提交**（`runtime/git-delivery.ts` 观察，`tools/completion-git.ts` 组合：仓库判定、HEAD、这些路径的 dirty 集合、被 `.gitignore` 排除的路径）；无仓库或只读 Task 不产生该项。三类事实各自成缺项，不合并：未提交（`git add` 后提交）、被忽略（该类文件的提交需要 `git add -f`，先建议移出交付，规则写错时才强制加入）、内嵌仓库里的交付文件（在它自己的仓库里核对；外层项目有没有记录这个仓库另算一条，submodule 的合法形态因此可以正常收口）。仓库标记按项目目录向上查找（项目可以位于更大仓库之下）；找到 `.git` 但 git 读不出来（含 git 不可用、gitdir 损坏）一律按缺项阻断，不静默放行；只有向上都找不到 `.git` 才是本机保存；主管声明问题已处理并确认目标满足。缺项保持未完成，不重做未变化成果。提交由模型执行（主管可用 bash，或由结算角色执行），程序只观察与拒绝，不代提交。

结算只回填已确认记录；源码/正式规则实质变化重新 Review → 适用 Test。报告和保存事实不能代替业务判断，也不能以模型自称完成替代保存事实。

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
| chief / [chief](prompts/chief.md) | 用户输入、项目入口、当前 Task/Plan、有效决定与正式结果；按需补读 | G1 主管工具及当前 Task ownerEpoch / 只读或修改类型；可直接跑命令核实状态，不承担实现写入 |
| designer / [designer](prompts/designer.md) | 设计目标、提案/需求、产品/技术索引及选定模块、已确认决定、Plan | 普通文档写入负责人；需求通过 save；不默认整项目或所有模块 |
| developer / [developer](prompts/developer.md) | 指定实施目标、需求/验收、Plan、必要技术接口、依赖结果、适用单元/集成/E2E 测试入口 | specialization、授权范围、登记工作目录/写入负责人、实际执行配置 |
| reviewer / [reviewer](prompts/reviewer.md) | 正式需求/验收、Plan、实际交付、真实证据 | 独立只读成果；无作者、主管、其他 Reviewer 聊天自评，无任意 bash |
| tester / [tester](prompts/tester.md) | 最近一次通过的独立复核、需求/验收、Plan、API/浏览器 E2E 入口、适用服务/地址、环境与数据准备依据、真实证据 | 适用测试目录/副本，执行测试及准备临时验收产物；不修改交付源码，无作者/主管聊天自评 |
| settler / [settler](prompts/settler.md) | 有效成果/检查、实际交付、受影响知识入口、遗留与保存安排 | 仅适用结算记录与 Git/本机保存权限，保护无关改动 |
| investigator / [investigator](prompts/investigator.md) | Task 调查目标或被核实输入/事实、选定事实/证据路径 | 只读与已配置检查；不默认任意执行，不改变恢复/完成状态 |

宿主同时提供可读取的规范入口映射：R=需求管理、D=任务交付、K=项目知识、F=需求文件格式、G=本页角色工具契约、M=消息与协作、S=存储与恢复、I=实现检查、T=技术索引（定位运行与实现检查）。这些内置规范采用只读资源路径，由宿主映射为 read 实际可访问的文件；提示词中的章节简称必须能定位到该入口，不能只留下不可解析的 R-01 等名称。只注入入口，不拼接全部规范；按需读具体章节。项目自身 AGENTS/索引继续定位项目补充约束，冲突明确核对，不静默覆盖权威规则。

主管提供的本次 instructions/refs 使用现有工具字段，说明用户结果、本次交付范围、当前步骤、相关模块关系、已确认决定与具体未知；引用总体 Plan、正式需求/规则、适用技术契约和依赖结果，指出关键引用的用途。主管负责选择最小但足够的上下文，专业 Agent 按路径补读；宿主保存真实身份/环境与引用，不另造上下文审批、知识同步或强制文档模板。

提示词分工：base 给共同判断/事实原则，chief 组织整体目标与流程，specialists 给接收分工/报告的共同责任，各角色给本职判断与产出方法。模型必须实际收到相应正文；经验只写在工作记录中不算已植入。产品/技术规则和工具 Schema 继续按原入口读取，角色正文不成为第二份协议。

只注入当前角色，宿主固定并持久记录 actor、taskId（专业必需）、role/specialization、cwd、实际模型/工具集合、规则内容摘要及 Pi 文件绑定。专业 Agent 自行按引用 read；Server 校验归属/可读性，不拼整项目或作者聊天。上下文不充分可补读或提交真实阻断报告，不能把文档描述当实现证据。

压缩/重启由 currentTaskId + task(op=get) 找回真实关系，再按当前正式依据装配；不只靠记忆 ID，不重建已有专业 Session。明确 resourceLoader，不自动加载未知扩展。项目规则变化在安全边界核对并显式更新/交接。角色模型按项目内角色覆盖 → 角色覆盖 → 项目默认 → Server 默认，执行时固定；不可用保留阻断，不静默回退。基础规则落实产品，不新增业务门禁或审批义务。

## G5 模型行为检查

覆盖主管自由讨论不建 Task、专业调查绑定 read Task、主管总体 Plan、显式阶段更新、按步委派、当前步骤全部成员聚合、超时不取消、原生交互期间父委派保持等待/宿主直接答复、正式 blocked 报告后原 Session 接续、并行 Review 后 Test、返工、真实报告、结算缺项和压缩恢复。统一设计角色还须检查粗略提案转化、模块内聚、可实施需求边界、已有技术依据复用、总图/子图/契约一致、正式需求写入不绕过 save，以及无设计聊天的独立实施。补充验证整体判断与有依据的质疑、授权内自主推进、最小上下文分工、文档独立可实施、成熟实现按需采用和结算后入口可接续；具体场景唯一列在 [I4](implementation-checks.md#i4-提示词与真实业务检查)。提示词文字存在不证明模型实际遵守。
