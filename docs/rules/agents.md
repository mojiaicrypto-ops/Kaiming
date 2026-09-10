# Agent角色与上下文规则

## 1. 固定角色与独立运行

| role | 职责 | 写入边界 | 交付 |
|---|---|---|---|
| chief | 与用户协作、评估、选上下文、分派、汇总 | 自己的说明Artifact及授权领域命令 | 回复、Assessment、DispatchSpec |
| product | 产品设计、已有能力调查、需求行为与验收 | 授权候选产品文档 | ProductDefinition/文档Diff/调查结果 |
| planning | 技术方案、Task拆分、依赖、验证策略 | Plan与授权候选技术文档 | Plan/文档Diff |
| backend | 后端实现、数据/接口调查、操作执行 | 授权Task范围，或只读调查 | Diff、执行证据 |
| frontend | 前端实现、交互、说明产物 | 授权Task范围或独立Artifact | Diff/HTML等产物 |
| review | 独立检查目标、改动、关联影响 | 报告和检查临时目录 | Findings、ReviewResult |
| test | 行为验收、回归和环境验证 | 临时环境和证据目录 | TestResult |
| settlement | 更新已证实知识和索引、整理证据 | 授权候选正式文档、过程记录 | KnowledgePatch、SettlementResult |

专业Agent均由Chief的agent_dispatch创建；每次Run有独立Session、Context、模型配置、工具范围及输出Schema。Chief可同时调度多个角色实例。角色模型Provider/Model/Reasoning独立可配，例如产品与审核采用不同模型；模型选择不是职责或权限变化。

角色按任务使用，不要求全员运行。Backend/Frontend执行只读调查或产物制作时使用对应权限模式，不因为角色名称获得代码写入权。Review独立性由独立Run、Session、输入和权限保证，允许与开发使用同模型但显示实际配置。

## 2. Chief决定上下文

Chief提交ContextSelection：goal、source_refs、reason_per_source、feature_refs、code_paths、artifact_refs、excluded、unknowns、read_budget。ContextBuilder只执行选择、校验权限与必需输入、冻结内容；它不替代Chief作业务选择。

固定必需项：角色契约、Project概览或初始化观察摘要、Work目标、适用授权与政策。阶段必需输入按下表检查，尚未产出的下游文档不作为当前阶段前置。

| 当前阶段/用途 | 额外必需输入 |
|---|---|
| assist/artifact/initialize调查 | 用户问题、Chief选择的来源；无Product/Plan前置 |
| Product设计/正式产品文档准备 | 用户确认来源、当前相关事实/未知；无下游Plan前置 |
| Planning生成Plan | 有效ProductDefinition和验收；技术文档路线为用户目标/范围；无新Plan前置 |
| L1 Develop | CompactPlan、明确替换目标和当前文件 |
| L2/L3代码Develop | 有效ProductDefinition、Plan、任务验收及依赖产物 |
| 文档修改 | 有效用户来源、CompactPlan或Plan、目标文档及适用规则 |
| L1/文档ReviewCheck | CompactPlan或Plan、确认来源、冻结Diff、适用检查；不要求代码ProductDefinition/Test |
| L2/L3代码Review | 有效ProductDefinition/验收、Plan、冻结Diff及关联代码 |
| Test | 有效Review、Plan、验收、冻结代码和环境 |
| Settlement及最终文档检查 | 适用路线的最终验证结果、影响集合、待提交知识Diff；无被跳过阶段的虚假报告 |

缺项返回MISSING_CONTEXT给Chief补齐。首次初始化没有Project概览时使用受信路径、用户目标、读取来源与未知构成的BootstrapObservation；Ready之后改用正式Project概览。

选择前先导航，Agent可在授权Project/源码快照内按理由搜索和追加读取，每次追加保存来源、Hash和原因。引用其他Project、其他Agent Transcript、开发自评、Secret等禁止输入返回CONTEXT_FORBIDDEN。主管不能取消独立验证的输入隔离。

共享文档是共同事实源；不同Run实际加载内容独立。UI可显示全部角色结果，UI显示不等于向Agent注入全文。主管通过结构化产物理解结果，默认不收子Agent完整聊天。

## 3. 委派契约

专业ProfessionalDispatchSpec字段：kind=professional、workId、requirementId?、taskId?、role、purpose、goal、scope、stage、contextSelection、profileRevision、requiredOutputs、requiredChild、joinPolicy、budgetAllocation、parentRunId。

purpose=analysis/artifact/implementation/review/test/settlement/initialize/document/document_check/operation；Core校验role与purpose、Stage、权限。所有子Run为ChiefRun的直接子级。专业Agent提交request_dispatch只形成Chief待处理事件，无权生成孙Run。

joinPolicy=none/all；none持久分派后Chief可继续，all挂起该ChiefRun直至指定子Run终态。requiredChild失败阻断相关Gate，其他子Run继续。父Run取消传播未终态子Run；Chief新的对话Run独立于正在等待的父Run。

## 4. 结果契约

所有专业Agent通过stage_yield工具提交，映射Runner协议stage.submit。必需status=success/needs_input/failed、summary、artifactRefs、evidenceRefs、changedPaths、findingIds、unknowns、requestedActions、readLedgerSeq、readLedgerHash。不同Stage必需数据见数据契约。

口头完成不改变领域状态。Schema第一次失败允许修正，第二次仍失败为contract_violation。结果到达Core后检查attempt/epoch/版本/预算/Scope，再由Chief触发下一专业Run；Core Gate可拒绝，不能擅自改派角色。Chief恢复失败时保存待调度事件并在Inbox提示，工作不会静默丢失。

## 5. 配置继承

顺序：已授权Run参数→Project角色覆盖→全局角色Profile→全局默认模型。首次安装由用户配置至少一个Provider与默认模型；八角色可继承后逐个覆盖。不存在可用模型时Work为blocked(provider)，未准入Run保持queued；正在运行的调用配置失效则Attempt失败、Run标failed并由Chief在配置修复后新建Run，禁止静默换Provider或降低模型。

Profile字段：providerId、modelId、reasoning（off/low/medium/high；Provider映射不支持值则校验失败）、skills、toolSubset、contextLimit、temperature?。仅支持模型声明的能力；更改配置对后续Run生效，活动Run保存冻结ConfigSnapshot。重试同Run采用原快照，用户要求换模型创建关联新Run并重新装配上下文。

Provider连接：type=openai-compatible/anthropic/google、baseUrl、enabled、secretRef、models（id/contextWindow/maxOutputTokens/reasoningLevels/vision/价格可空）。模型由用户录入或显式刷新，连接测试由Core发最小请求，不在浏览器持有凭证。

## 6. 上下文与用量

上下文有效上限=min(Profile.contextLimit,模型contextWindow-最大输出-4096保留)，Profile默认64000 tokens；启动包默认最多24000，追加读取最多16000，超出时Chief重新选择并创建新Snapshot，或请求预算。限制可以在配置范围4096–2000000内调整，仍受模型实际上限约束。

同一专业Attempt只处理同一任务/阶段；基线、角色或配置变化新建Attempt/Run。Pi原生Compaction维持内部连续性，Checkpoint仅保存正在运行的位置、引用和阻断；产品事实从正式文件读取。
