# 项目接入与会话需求

本章使用 [数据与工具契约](contracts.md) 的字段和 [消息协议](protocol.md) 的请求。均为第一版必需。

## PRJ-01 打开目录

触发：用户提交 `project.open {path}`。Server 将路径解析为存在且可读取的目录 realpath；事务内以 canonicalPath 唯一查询。存在则返回同一 projectId，不存在则生成项目记录。

输出为 Project、主管 Session 列表、未完成 task 摘要、trust/init 状态。此操作不调用模型、不创建 Session、不写项目文件、不停止其他项目的执行。不存在/不可访问目录返回 PATH_INVALID/PATH_UNREADABLE，不插入记录。

两个并发打开请求及符号链接别名只能生成一个项目。路径比较遵循文件系统实际路径语义，不能直接把所有路径转成小写。

## PRJ-02 移动目录

打开新路径不自动推断与现有项目同一身份。用户选择“重新绑定目录”提交 `project.rebind {projectId,path}`：新目录合法且未被其他 projectId 绑定、该项目没有运行中的执行/工具时，更新路径，保留任务和会话身份。

已有会话文件仍在 Server，恢复时工具 cwd 使用新路径，先核对引用文件；引用缺失则 task 阻断。正在运行返回 PROJECT_BUSY；路径已被占用返回 PROJECT_PATH_BOUND。Git Clone 默认是另一项目，无自动合并会话或授权。

## PRJ-03 信任与首次初始化

新注册项目初始 trust=read_only、init=not_initialized。只读模式可查看文件和需求、使用 Server 规则讨论；项目 AGENTS.md 仅作为资料展示，不能执行其指令或加载项目扩展。代码写工具与正式交付被拒绝。

用户提交 `project.trust {projectId,trusted:true}` 后，Server 记录 trust=trusted；模型不能替用户调用该入口。撤销信任时没有活动执行才允许，否则 PROJECT_BUSY。初始化由主管直接执行：trusted 且 not_initialized、用户已确认初始化差异时，该差异即本次初始化写入计划，允许仅写 AGENTS 托管段和 `.dev/` 最小入口，不创建代码交付 task、不要求尚未生成的 work/Plan。任何代码或已有产品行为修改仍走正式交付。第一次正式交付前，由主管按 [知识规则](rules/knowledge.md) 提供初始化差异：保留 AGENTS 原文，追加托管入口；生成 `.dev/` 最小结构与项目参数。用户确认差异后写入；重复初始化校验已有文件，不覆盖。写完调用 `project_ready {approvalRef}`，Server 校验必需入口、托管段及用户确认后记录 init=ready；失败保持 not_initialized 并返回缺项。

默认项目参数：planAuthorization=explicit_goal（范围内 Plan 已由明确实施指令授权，可改为 per_plan 逐计划确认）；破坏性数据/外部发布/权限与规则变化另行确认；每完成 5 个 task 或发生漏检事故提出复盘；历史证据保留。模板见 [AGENTS](templates/AGENTS.md)。用户可以在初始化时修改默认值，确认一次后供后续 Session 使用。

无模型时不能生成初始化差异，返回 PROVIDER_UNAVAILABLE；已注册项目仍可查看。纯讨论可在尚未初始化时进行，正式文件/代码交付返回 INITIALIZATION_REQUIRED。

## PRJ-04 创建/选择主管会话

用户提交 `session.create {projectId,title?}`。信任状态决定资源装配，模型配置必须有效；Server 创建一个新的 Pi 持久会话，记录 sessionId、piSessionId、sessionFile、role=chief。

Project 1:N Session；Session 只能属于一个 Project。用户会话即主管 Session，不另设 Conversation。专业 Session 由 agent_dispatch 创建，不进入主管会话选择列表，但可查看结果与执行过程。

重开项目只返回已有会话，不自动新建或恢复执行。选择已有会话从该 sessionFile 读取；严禁使用“该项目最近一次会话”代替指定文件。删除/损坏的文件标记不可恢复，保存 task 和结果；明确新建主管会话后调用 `task.attach {projectId,taskId,sessionId}` 迁移 task 的 ownerSessionId，并注入任务摘要与引用，不复制其他角色聊天。

## PRJ-05 模型与角色配置

全局默认模型必填，角色可覆盖，项目可覆盖全局角色。配置字段为 providerId、modelId、thinkingLevel、contextLimit；Provider 存储 type、baseUrl、enabled、secretRef。凭证只在 Server，查询不返回明文。

开始 Session 时解析实际配置并记录。Provider 或模型不可用则不开始模型请求，保留待执行任务并给出配置入口。不能静默换模型。配置修改只影响下一次启动/恢复；已有正在执行的一轮保持原配置。

设置入口提供全局默认、角色覆盖、项目覆盖和 Provider 连接测试。settings.get 不返回密钥；settings.update 校验失败保留有效配置和用户输入；testProvider 返回真实连接/模型调用结果，不能以配置字段存在当可用。Provider secret 只在 Server 数据目录以仅服务账号可读方式保存，不进入项目 Git、模型输入或浏览器查询。

contextLimit 默认 64000，实际可用值不得超过模型能力。启动包目标上限 24000 tokens，超出时返回 CONTEXT_TOO_LARGE，交给主管缩减任务依据；不自行截断用户指令。角色允许使用相同模型，独立性来自不同 Session、输入和工具。

## PRJ-06 执行目录与隔离

一个 Server Runtime 同时管理多个项目/Session。所有文件与命令工具传显式 cwd，不修改 process.cwd。不同项目的路径、模型上下文和事件不得串入。

同一工作区只允许一个写入执行；多个只读角色可并行。多个写角色默认顺序执行，确需并行时主管指定独立工作区并承担组合后的验证。宿主为首版默认执行环境；工具提供一致的 cwd/输入/结果契约，为其他执行环境留替换入口。

验收：AC-P01～AC-P05、AC-A04、AC-R03。

## PRJ-07 用户入口与最小工作台

第一版一个安装用户。Server 启动时配置访问 token；用户通过 `POST /api/login {token}` 换取 HttpOnly 会话 cookie，失败不进入工作台；`POST /api/logout` 退出。RPC、事件、文件查询统一认证，跨 Origin 写入拒绝。具体部署/TLS 在实现 Plan 中确定，不增加团队账号/RBAC。

客户端至少能打开/切换项目、信任并审阅初始化差异、选择/新建主管会话、发送文字/答复 action、查询需求与 task、查看阶段结果/证据、暂停/继续/取消、调整模型配置。未初始化/模型阻断/本机保存/Git 失败/连接中断有明确反馈；用户能看到待处理步骤。

具体布局不在本需求固定，但上述操作必须可达，不能只有 API 存在而用户无法完成旅程。
