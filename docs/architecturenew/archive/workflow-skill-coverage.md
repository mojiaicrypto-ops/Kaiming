# 归档：工作流调研

本文件是调研存档，不属于产品规格，不参与默认读取，不作为实现依据。

日期：2026-10-02。状态：讨论记忆及能力覆盖建议，未作为正式产品或实现契约。

## 1. 用户明确的产品目标

优化并实现 `agentdev-project-workflow` 的所有功能：把完整的项目记忆与软件交付工作方法实现为 AgentDev 产品能力。短主管提示词只是入口，不能替代完整能力。简化针对实现复杂度、重复规则和不必要的工程限制，不应悄悄删去工作流功能。

保持本轮已明确的方向：自由讨论；Agent 主导任务与上下文选择；固定必要交付流程；独立专业 Agent；项目文档承载长期事实；执行现场由 Server 持久化。

## 2. 本轮实际读取的来源

- `/Users/huyaohua/.codex/skills/agentdev-project-workflow/SKILL.md`
- 全部九份 references：principles、context-protocol、onboarding、design-workflow、product-baseline、delivery-workflow、artifact-contracts、agent-roles、settlement。
- `templates/AGENTS.md.template` 与 `agents/openai.yaml`。
- 本仓库 `AGENTS.md`、`docs/INDEX.md` 与已加载的现行产品/知识/需求/工作流/角色契约。
- 现有 Pi 接入点：`packages/pi-runtime/src/resources.ts`、`packages/pi-runtime/src/session.ts`。

外部 skill 是本次产品化的能力来源，不能替代本仓库正式实现契约。下表不是当前代码完成状态审计；没有按每项验证现有实现，也没有执行运行测试。

## 3. 完整能力清单及落点

| 编号 | 必须覆盖的能力 | Agent/文档负责 | 程序提供的支撑 | 主要 skill 来源 |
|---|---|---|---|---|
| C01 | 自由讨论与任务意图分类 | 判断理解、设计、规划、开发、审核、测试、结算；讨论不自动承诺开发 | 消息与对象引用入口 | SKILL；AGENTS 模板 |
| C02 | 项目首次引导 | 识别已有规则；了解项目风险、路径、编号和复盘偏好；生成可审阅 AGENTS 差异 | 项目注册、文件工具、用户确认入口 | onboarding；模板 |
| C03 | 项目规则持续演进 | 结合事故与复盘提出参数调整；用户确认后生效 | 规则版本与确认来源可追溯 | onboarding；principles |
| C04 | 分层、模块化项目记忆 | 项目概览、功能文档、技术文档、索引、代码/测试导航；稳定事实写最近权威位置 | 文件读取与查询 | principles；product-baseline；settlement |
| C05 | 渐进读取与按需规则触发 | 导航后加载，沿任务依赖读取；不默认加载全部历史与其他会话 | 规则入口、搜索与读取工具 | context-protocol；SKILL |
| C06 | 上下文说明、预览与可追溯依据 | 主管自主选择；必要时列出来源、原因、排除、假设、未知 | 展示/保存所选依据；用 Git/不可变产物及必要内容留存记录阶段输入 | context-protocol；artifact-contracts |
| C07 | 产品设计完整路线 | 问题、边界、用户决定、对象、行为、失败路径、验收、可行性、设计结算 | 保存候选产物与确认结果 | design-workflow |
| C08 | 需求与工作来源 | 从真实用户意图形成目标、范围、验收、决定和未决项；保存与启动分开 | 用户来源、需求引用、task 入口；需求事实仍从文件读取 | SKILL；design-workflow；仓库 requirements |
| C09 | Plan 与适用分级路线 | 编写 Plan/Compact Plan；按项目规则选路线；扩大范围时处理决定 | 保存计划引用、授权与适用路线 | delivery-workflow；onboarding；模板 |
| C10 | 角色独立配置与自主派发 | Product/Planning/Frontend/Backend/Review/Test/Settlement 各司其职；主管组织协作 | 每角色配置、独立 Session、工具与任务关联 | agent-roles |
| C11 | 开发工作边界 | 单工作区单写者，按有效目标修改；记录实际变化、偏差和发现 | 适用工具和工作区；实际改动记录 | delivery-workflow；agent-roles |
| C12 | 独立审核 | 新上下文审核真实依据和变更，不依赖开发聊天/自评；留下定位、影响和建议 | 独立 Session、读取实际变更、保存审核结果 | delivery-workflow；agent-roles |
| C13 | 真实测试及未覆盖处置 | 执行命令，区分 passed/failed/not covered/blocked；风险由用户明确处置 | 命令工具返回真实退出状态和结果，保留证据 | delivery-workflow；artifact-contracts |
| C14 | 失败与返工 | Review/Test 失败回开发；改动后重新 Review；产品决定待确认；结算未完保持进行中 | task 持久进展、执行与结果引用 | SKILL；delivery-workflow |
| C15 | 统一产物契约 | Plan、实施摘要、Review/Test/Settlement 报告、上下文记录与 Finding；优先适配项目格式 | 产物引用与结果提交能力 | artifact-contracts |
| C16 | 结算与知识回填 | 从实际 Diff/报告提取稳定事实；更新产品/技术/接口/数据/测试、代码地图及索引 | 文件工具、结算产物关联、收口结果 | settlement |
| C17 | 归档、已知问题及风险记录 | 详细证据归档；登记剩余问题并销号；历史不污染当前知识 | 可定位的归档和问题读取入口 | settlement；模板 |
| C18 | 完成判定与新会话接续 | 必要验证、确认、文档与结算完成；新会话不依赖开发聊天即可找到新状态 | 完成工具核对适用结果；新 Session 从入口启动 | SKILL；settlement；context-protocol |
| C19 | 复盘与规则/skill 影响检查 | 检查规则和 skill 触发影响；定期复盘、撞坑补规则；提出需确认修改 | 复盘记录、用户确认和规则版本关联 | onboarding；settlement；模板 |
| C20 | 清晰报告实际状态 | 采用 Planning/Reviewing/Testing/Settling 等状态；不把口头结论当证据 | 任务与执行实际状态供查询 | SKILL；artifact-contracts |

上述能力全部是覆盖目标。角色内部 graph 为 skill 允许的可选实现，需要时保留输入、预算、重试、停止与输出约束；不把 graph 编辑器或显式 graph 对象变成全部项目的强制设施。

## 4. 推荐的规则植入方式

第一版保留完整 skill 规则包的结构，而不是重新维护几份删减版 skill：

```text
AgentDev 内置资源
  chief.md                           主管角色及产品工具使用约定
  agentdev-project-workflow/
    SKILL.md                         完整工作流入口
    references/                      详细方法和产物契约
    templates/AGENTS.md.template      项目规则生成模板
```

- 主管启动时实际提供短主管角色规则和完整工作流入口正文，以及已信任项目的 AGENTS.md。参考规则按原入口提示按需读取。
- Project/需求/代码/历史细节仍按任务加载，不把全部 references 与项目文档塞进系统提示。
- 子 Agent 由角色描述、基础工作规则和主管任务输入启动；主管可自由组合说明、相关需求和文档引用。子 Agent 按角色与阶段读取相应参考规则。
- 工具说明由实际注册的文件、任务、委派、交互及结果能力提供。正文中的手工操作必须映射到真实工具，不能仅把 skill 文件放进安装目录就声称已实现。
- 程序记录 task 和实际执行，不替主管语义选择全部来源或重建完整推理流程；必要流程结果和独立执行仍需可确认。

## 5. 必须显式优化的地方

1. **历史路径**：skill 的旧产品基线路径与本仓库索引不一致。产品化采用明确配置/项目入口，不硬编码不存在的旧文档路径。
2. **Plan 确认口径**：主入口、onboarding 与模板存在不同表述。用已确认项目政策统一；“沉默”不自行产生新的授权。
3. **小任务路线**：模板允许轻量路线，主入口概括标准链路。必须明确适用规则，保留轻量审核与结算，不给所有任务重复安排重流程。
4. **上下文能力**：预览、来源记录及阶段输入可追溯需要保留；不因此恢复由程序判断语义充分性、默认复制整库等重机制。
5. **模板机械检查**：全仓关键词检查、干净工作区等要求需按真实任务范围及项目既定政策处理，不能误判其他任务的未完成项，也不能丢弃“检查过期状态/登记问题/留存成果”的目的。
6. **对象映射**：skill 中的 Iteration 等概念先映射到现行项目工作与需求，不因外部文件列出某名称就新增强制运行对象；现行产品无 Sprint 实体。
7. **自主与固定流程**：固定适用阶段及交付责任，主管自主组织任务；未满足验证或结算时不能以模型自评宣布完成。

这些是优化建议，需要在后续正式设计中逐项决定；本记录未修改原 skill 或本仓库规则。

## 6. 本轮完成范围和后续交付

- 本轮已读取完整 skill 包并形成全能力清单，修正“只实现部分主管提示/交付链”的范围。
- `chief-rules-draft.md` 是接入示例，不是全能力规格；完整规则以本清单核对覆盖。
- 后续按项目打开 → 知识/需求保存 → task 派发与验证 → 结算/接续逐段形成规则、工具和可观察验收，保持 C01–C20 完整覆盖。
- 现有代码哪些可复用、哪些缺失，需要按正式契约和实际行为逐项审计；表格不能作为已实现声明。
- 进入代码修改前形成适用 Plan，按仓库交付规则执行独立 Review、Test 和结算。
