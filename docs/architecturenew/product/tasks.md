# 持久任务与交付流程需求

## TSK-01 task 的创建与范围

一个明确的正式交付目标对应一个 task，不为每段聊天、每个子 Agent 或每个阶段新建业务任务。task 包括代码交付和正式产品/技术知识交付；仅保存需求、归档状态或修改需求标题，按需求规则执行，不强制完整交付路线。

task_create 保存 projectId、ownerSessionId、goal、route、requirementPath?、sourceRefs。goal 用用户原意和确认的范围，不能复制一份需求正文。标准开发尚无需求时 task 先处于 plan，Product 整理后用 task_plan 关联需求。

同一需求同一时刻只有一个未结束 task；重复启动返回既有 task。无需求的请求以 requestId 去重，不对相似自然语言做语义去重。

## TSK-02 三条路线

| route | 必需阶段与结果 | 适用范围 |
|---|---|---|
| compact | Plan → Develop → 独立 ReviewCheck → Settlement | 单一文案、纯样式、确定性展示改动；不改变接口/数据/业务/权限/交互语义 |
| standard | 需求/Plan → Develop → 独立 Review → 独立 Test → Settlement | 其余代码行为修改，包括一个按钮引起的业务操作 |
| document | Plan → Product/Planning 文档修改 → 独立 ReviewCheck → Settlement | 只交付正式文档，不修改可执行代码 |

路线由主管依规则选择，程序记录并检查必需结果，不使用代码行数/自然语言关键词分类器。拿不准选择 standard。compact/document 不额外要求 Test Session，但独立检查必须执行与变化适用的检查。

开发中发现超出路线边界，主管用 task_plan 升级并解释原因；降级必须获得用户明确决定，不能通过少改几行删除必需步骤。Review/Test/Settlement 可以被不同角色实例执行，主管不必每次唤起 Product 和 Planning。

## TSK-03 计划与授权

每次代码或正式文档修改前，Plan 写入 `.dev/work/<taskId>/plan.md`，再调用 task_plan；document 同时传 targetPaths，列实际文件/目录目标，程序不解释 Plan 自然语言提取路径。最小内容为目标、范围/不做、需求/依据路径、改动步骤、角色、检查/验收、风险与授权来源。compact/document 可使用 [Compact Plan 模板](templates/plan.md) 的一段式写法。

用户明确“实现这个需求/修改这个按钮”已授权范围内规划和执行；默认 explicit_goal 政策下，主管登记该真实用户消息/action ID，向用户展示计划后可继续，不再询问同一授权。若项目已确认 planAuthorization=per_plan，则先取得针对当前 Plan 的明确确认；默认值不能覆盖更严格项目参数。仅“分析/给方案”没有开发授权。

超出用户目标、改变产品/验收/项目规则，或进行破坏性数据操作、外部发布、权限变更，先用 user_request 提供具体差异和影响；用户决定后记录引用再继续。沉默不授权。Plan 变动保留修订记录，不删除已有结果；受影响验证失效。

## TSK-04 派发、结果及当前进展

agent_dispatch 自动写一个 step 记录，stage 为 develop/review/test/settlement，role 为专业角色，包含说明、依据路径、目标和 Session。相同 dispatchKey 与相同参数返回相同 step，参数不同返回 IDEMPOTENCY_CONFLICT。

子 Agent 用 agent_result 提交后，程序持久结果、状态和证据引用，再向主管投递结果 ID。结果没有持久保存就不能返回成功。专业 Agent 的自然语言回复不关闭 step；一轮 Pi 结束但无结果，step 标 blocked(result_missing)。

派发/结果自动更新 task.stage 和进展。主管只在需要保存已确认选择、阻断原因、下一步或需求关联时调用 task_note；不用每完成一步额外调用 task.update。多个子任务结果全部保留，子任务完成不完成父 task。

一个写入工作区同一时刻只准一个写 step，冲突返回 WORKSPACE_BUSY。任务还可并行只读调查；多个写工作区的组合必须有最终验证。

## TSK-05 独立性与目标

Review/Test 创建新的 Pi Session，仅获得角色规则、用户目标、需求/Plan、实际变更/目标和证据路径。禁止继承开发或主管聊天、自评；允许读实际源代码和工具输出。使用同模型不取消独立性。

已确认的产品/技术定义变更在 Develop 阶段完成，并随实际成果提交；工程师或主管安排的专业文档角色按 knowledge 编写，不能留到验证后偷偷改定义。程序在首次 review 派发前计算 targetRef；Test 使用同一 targetRef；结果提交和 task_finish 都检查目标未改变。代码目标为工作区代码内容指纹及需求/Plan 文件指纹，生成办法见 contracts.md。不要求把全文编译成上下文快照。

Review passed 且没有阻断问题才允许作为有效结果；Test 必须有真实检查证据。开发自己运行的检查是实施证据，不能顶替独立 Test。多成果组合须对最终 targetRef 验证，不能简单汇总子报告。

## TSK-06 返工和未覆盖

Review failed 或 Test failed：主管派发对应工程师修复；修复后先独立 Review，再执行适用 Test。旧报告保留，但 targetRef 不同不能用于完成。

结果 blocked/needs_input：task 保存阻断、待处理输入和已有结果，不伪装 failed/passed。needs_input 补齐后用 agent_continue 接着执行同 step；失败修复新派发，未知副作用先核实。Test 未覆盖明确列验收 ID、原因和风险；用户明确接受非阻断覆盖缺口后可以继续，未执行任何真实测试不能整体标 passed。验证中发现当前验收不满足的真实缺陷不能作为“未覆盖”接受。

问题分 open/addressed/verified/accepted_risk：工程师只能 addressed，独立检查确认 verified，accepted_risk 需要用户决定。P0/P1（数据/安全/关键错误）默认阻断；P2 影响验收时阻断；P3 为建议。重大缺陷不能因想完成任务而由主管自行降级。

## TSK-07 状态与控制

| status | 含义与下一步 |
|---|---|
| active | 正在计划、开发或验证，stage 指示当前工作 |
| blocked | 缺模型/输入/结果/恢复核实，reason 和 nextAction 必填 |
| paused | 用户暂停，停止新派发和当前模型执行，已有结果保留 |
| settling | 正在结算或最终完成检查待补齐 |
| completed | 必需验证与结算有效，实际文件和归档已核对 |
| cancelled | 已确认执行停止，保留已有影响与取消摘要 |

子 step.status 为 queued/running/succeeded/failed/blocked/cancelled。结果未知属于 blocked(reason=effect_unknown)，不需要另建业务 Run/Attempt 状态机。

pause/cancel 请求先保存控制意图，再停止新派发并中止 Pi/工具；只有确认停止才显示 paused/cancelled。不能确认时 blocked(effect_unknown)，页面显示停止请求与待核实。取消不自动回滚文件/外部操作。用户继续暂停任务时回 active，根据记录继续，不新建整项工作。effect_unknown 的继续必须附实际核实依据 recoveryRefs；仅“继续”不能覆盖未知效果。

## TSK-08 完成

主管调用 task_finish，程序校验 Plan/真实用户来源、对应路线的有效结果、无未关闭阻断问题、结算成功、归档与关联需求结果。缺项返回 TASK_INCOMPLETE 和具体 missing 列表，不改 completed。

Git 项目需要本任务成果和归档已提交；无 Git 允许 completed，但显示本机保存、未提交 Git。Git 失败保留 settling，重试提交即可，无需重新 Review 未改变代码。

验收：AC-T01～AC-T07、AC-S01～AC-S03、AC-R01～AC-R04。
