# Implementation Summary · devagent-p3-tools-20261005

按切片推进：A 上下文装配（已提交 d8749c0）→ B 角色与工具集（本切片）→ C/D/E 待做。

## 切片 A · 上下文装配（已完成并提交）

```yaml
slice: P3-a 上下文装配
changed:
  - devagent/src/runtime/prompt-assembly.ts：按 G4 边界抽取注入正文；缺边界/重复（起点与终点）即报错；chief=base+自身，专业=base+共同规则+自身
  - devagent/src/runtime/context.ts：单轮上下文文本（纯函数，已单测）
  - devagent/src/runtime/{config,pi-runtime,registry,runner}.ts：promptDir、appendSystemPrompt 追加注入、按角色正文校验
  - devagent/checks/prompt-language.ts：复用产品抽取模块 + 边界字面量与抽取起点断言（15/15）
review: 独立审阅 passed；2 项 non-blocking + 3 项 overclaim 全部修复并复核通过（见 review.md）
```

## 切片 B · 角色与工具集（本次）

```yaml
slice: P3-b 角色与工具集
changed:
  - path: devagent/src/runtime/tool-sets.ts（新增）
    purpose: 按 G1 定义各角色的原生工具与领域工具集合；read Task 去掉项目写工具与任意 shell，也去掉会写项目文件的领域工具（requirement/project）；尚无 Task 时沿用角色自身集合
  - path: devagent/src/runtime/runner.ts
    purpose: 会话允许列表改为「角色×Task 类型」集合 ∪ 宿主已注册工具名；实际使用的工具集与 Task 类型写入 effectiveConfig
  - path: devagent/src/runtime/registry.ts
    purpose: 允许列表随会话创建透传（配置变化重建时同样生效）
  - path: devagent/test/tool-sets.test.ts（新增）
    purpose: 工具集矩阵单测（9 项）
  - path: devagent/test/runtime.test.ts
    purpose: 集成用例：Reviewer 在 write Task 中仍只读；Developer 在 write Task 有 write/edit/bash、在 read Task 没有；effectiveConfig 记录真实工具集与 Task 类型
behavior:
  - "写工具一定带读工具：designer/developer/settler 的集合都包含 read/grep/find/ls（有断言），先分析再改"
  - "只读角色（chief/reviewer/tester/investigator）任何 Task 类型下都没有 write/edit；tester 只有 bash 用于跑测试入口"
  - "read Task 一律去掉 write/edit/bash、requirement/project；agent_report 保留（它写的是 Server 侧报告，不是项目文件）"
  - "尚无 Task 的会话（如主管自己的会话）沿用角色自身集合：chief 仍能保存需求/初始化项目入口"
  - "允许列表含未被注册的工具名时不报错（实测：主管会话允许列表含 createTask 等尚未注册的名字，运行正常）"
  - "实测：npm test 71/71（6 个文件）；typecheck 0；check:prompts 15/15；SDK 试验 47/47；真实模型端到端 4/4"
review_round_1:
  - 独立审阅判定 failed：1 项 blocking + 3 项 non-blocking
  - (blocking) 实例复用只按配置指纹：Task 类型变化（write→read）会继续沿用旧的更宽工具集 → 复用键改为包含「工具允许列表 + 注入正文」，并以实例自身文件比对历史绑定；新增「Task 类型切换必须重建实例」用例
  - (non-blocking) 宿主工具并入允许列表时会把 read Task 已排除的 requirement/project 又加回来 → toolSetFor 暴露 denied（覆盖角色级全部未持有名字），并入时过滤；新增「denied 名字不会被并回来」用例
  - (non-blocking) effectiveConfig 记录的是"请求的允许列表"而非真正激活的工具 → 改为同时记录 requestedTools 与 activeTools（activeTools 取自会话本身）
  - (non-blocking) 专业角色的 task/requirement 工具范围比 G1 宽（G1 只给 task.get、requirement.list/get）→ 已在 tool-sets.ts 注释与本节记录中显式声明为 P3-e 必须收口的要求（工具内部 op 级权限）
  - 复跑：71/71 测试；typecheck 0；check:prompts 15/15；SDK 试验 47/47；真实模型端到端 4/4
  - 增量复核（同一独立会话）结果见 review.md
plan_deviation:
  - "read Task 目前整体去掉 requirement/project 工具，而不是只去掉 requirement.save：工具内部的 op 级权限属 P3-e；这样宁可少给工具也不放松写权限"
  - "RuntimeDefaults.tools 现在只是工厂在未指定 spec.tools 时的默认值；运行器始终传自己的角色集合"
risks_remaining:
  - "工具允许列表不是 OS 沙箱（契约已声明）；真实影响仍由 Agent 判断、程序核对文件与版本"
```

## 切片 C · Task 核心工具（本次）

```yaml
slice: P3-c 四个主管核心工具 + 总体 Plan 落盘
changed:
  - path: devagent/src/store/store.ts
    purpose: schema v3：tasks 与 file_saves 两张表（含「同一主管至多一个未结束 Task」「同一实施需求至多一个未结束实现 Task」两个部分唯一索引）；createTask/getTask/listTasks/updateTask（版本 CAS、提供 phase 即开始新步骤并清空当前成员）/taskCompletionGaps/endTask/registerFileSave/getFileSave；v1→v2→v3 迁移
  - path: devagent/src/runtime/plan-store.ts（新增）
    purpose: 总体 Plan 落盘（S6）：稳定目标 → 同目录临时文件 + rename → 读回核对 sha256 → 登记 file_saves 回执；同 requestKey 且盘上仍是记录版本时复用回执；盘上被外部改写则拒绝覆盖；read Plan 并报告文件缺失/被改动
  - path: devagent/src/tools/task-tools.ts（新增）
    purpose: createTask/updateTask/endTask/task(get)；参数边界校验（read 禁止 requiresTest、write 必须显式给 boolean、sourceInputId 由宿主在每次工具调用时按当前输入固定（实例可跨输入复用））；写 Task 计划落 .dev/work/<taskId>/plan.md，read Task 落服务器 work/<taskId>/plan.md；相位枚举、CAS、plan 修订（expectedPlanVersion 版本校对）
  - path: devagent/src/tools/question-tool.ts（由 spikes/harness 移入产品代码）
    purpose: 提问工具归属产品；spike 与真实模型检查改为引用该实现（不再有两份）
  - path: devagent/src/runtime/runner.ts
    purpose: 按角色注册领域工具（主管四个；专业仅 task.get）并并入允许列表；会话未建 Task 时 task.get 报「无当前 Task」
  - path: devagent/test/task-store.test.ts（新增）
    purpose: 任务与计划落盘单测（10 项）
  - path: devagent/test/task-tools.test.ts（新增）
    purpose: 工具层单测（9 项）：创建/拒绝不留痕、版本竞争不碰磁盘、归属校验、缺省 currentTaskId、计划冲突语义
  - path: devagent/test/runtime.test.ts
    purpose: 集成用例：主管会话激活四个核心工具；模型通过真实工具循环建 Task 并落盘（断言行 + 计划文件 + 主管槽位）；写 Task 缺 requiresTest 被拒时不产生 Task
behavior:
  - "实测：npm test 94/94（8 个文件）；typecheck 0；check:prompts 15/15；SDK 试验 47/47；真实模型端到端 4/4"
  - "createTask：read 不许 requiresTest；write 必须显式 boolean（缺失即 INVALID_ARGUMENT）；chief 槽位与需求槽位冲突分别返回 WORKSPACE_BUSY / TASK_BUSY"
  - "updateTask：版本 CAS；提供 phase 表示开始下一步骤（当前步骤成员未清空时返回 STAGE_NOT_READY）；可同时修订 goal/scope/依据/requiresTest 与 Plan（Plan 修订支持 expectedPlanVersion 校对）"
  - "endTask：本轮只做程序可核对的部分，缺项如实列出（缺少完成结果记录、必要独立测试等），不以模型自称完成收尾"
  - "task.get：返回任务字段、计划正文与「文件是否仍是记录版本」，不给模型猜服务器路径"
  - "Plan 落盘：同 requestKey + 同内容 → 复用回执不重写；内容不同 → 原子重写并核对摘要"
plan_deviation:
  - "endTask 现在必然返回 COMPLETION_INCOMPLETE：独立报告（agent_report）在 P3-e 才会落库；这是有意为之——宁可如实报缺项，也不假装完成"
  - "Task 的 control（pause/resume/cancel）与 adopt 属 P3-d；当前 updateTask 只接受 active/waiting"
  - "question 工具尚未由运行器注册（需要宿主 UI 适配器，属 P4 的接入层）；本轮只完成归属迁移"
risks_remaining:
  - "schema v3 新增两张表：旧库升级路径已测（v1→v3），但 tasks 表尚无删除/归档路径（Task 只完成后保留）"
  - "工具允许列表仍不是 OS 沙箱（契约已声明）"
review_round_1:
  - 独立审阅判定 failed：3 项 blocking + 3 项 non-blocking
  - (blocking) updateTask 先写计划文件、后做版本 CAS：落后的写入者会把别人的计划文件覆盖掉 → 改为「先算出版本摘要 → store 版本校验并落 planRef → 再原子写文件并核对」；失败者根本不会碰文件（新增用例：stale revision 后磁盘内容不变、revision 不变）
  - (blocking) 领域工具在实例创建时快照 inputId/currentTaskId，而 Pi 实例会跨输入复用 → sourceInputId 记为第一个输入、task.get 缺省 id 永远报「没有当前任务」 → 改为每次工具调用时解析上下文（live inputId + 会话当前 currentTaskId）；新增「同会话第二次输入仍能按缺省 id 读到任务」用例
  - (blocking) 工具不校验归属：任何项目的主管都能推进别的项目的 Task，专业角色能读任意 Task → 每个工具先核 projectId，chief-only 工具再核 chiefSessionId；专业 task.get 只允许读自己会话的当前 Task（新增 FORBIDDEN/NOT_FOUND 用例）
  - (non-blocking) createTask 被拒时留下孤儿计划文件与 file_saves 回执 → 改为先建 Task 行、成功后再写文件；被拒时不会产生任何文件或回执（新增用例）
  - (non-blocking) updateTask 可把 read Task 的 requiresTest 改成 true → store 层与 createTask 同样拒绝（新增用例）
  - (non-blocking) 计划复用分支不核对磁盘、file_saves 回执不随新内容更新 → 复用前读盘比对：盘上既不是记录版本也不是请求版本 → VERSION_CONFLICT（不覆盖外部编辑）；回执随实际写盘内容更新（新增用例）
  - 复跑：94/94 测试（8 个文件）；typecheck 0；check:prompts 15/15；SDK 试验 47/47；真实模型端到端 4/4
  - 增量复核（同一独立会话）结果见 review.md
```

## 切片 D · 委派与等待 + Task 控制（本次）

```yaml
slice: P3-d createTaskSessions（create/wait/continue）+ 当前步骤聚合 + task.control/prepare_candidate
changed:
  - path: devagent/src/store/store.ts
    purpose: schema v4（task_sessions 表 + tasks.candidate）；createTaskSessions（会话/关联/首条输入/currentSessionIds 同事务）、continueTaskSession、getTaskSession/listTaskSessions/getTaskForSession、controlTask（pause→pausing|paused 保留槽位、resume→active 幂等重绑、cancel→cancelling|cancelled 释放槽位）、setCandidate；事务改为可重入（嵌套调用加入外层事务，SQLite 无嵌套事务）
  - path: devagent/src/tools/delegation-tools.ts（新增）
    purpose: createTaskSessions：create 原子创建当前步骤成员并等待；wait 只观察；continue 只对已停稳成员追加续办输入；角色相位门（reviewer→review、tester→test、settler→settle、developer→develop）；read Task 只收 investigation/recovery；暂停 Task 只收 investigator+recovery，取消后的 Task 不接受任何新工作；等待默认 120s（可给 1s–5min）；taskId 缺省用宿主当前 Task
  - path: devagent/src/tools/task-tools.ts
    purpose: task 工具扩展 op=get|prepare_candidate|control（控制与候选冻结都做版本校验与归属校验）
  - path: devagent/src/runtime/runner.ts
    purpose: 主管会话注册 createTaskSessions；提供委派宿主（dispatch=运行该成员会话；settleStep=轮询当前步骤成员的真实输入状态，超时返回快照且不取消子工作）；专业会话的工具集改为继承其 Task 的类型
  - path: devagent/test/delegation.test.ts（新增）
    purpose: 委派单测（12 项）：聚合、相位/种类门、暂停只收恢复核实、continue 只对已停稳成员、wait 不改动工作且超时快照原样返回、非归属会话被拒、control 与 candidate
  - path: devagent/test/runtime.test.ts
    purpose: 端到端：主管建 Task → 委派 developer 成员 → 成员在自己的会话里真实跑完 → 聚合为 completed
behavior:
  - "实测：npm test 110/110（9 个文件）；typecheck 0；check:prompts 15/15；SDK 试验 47/47；真实模型端到端 4/4"
  - "等待集合取 Task 当前步骤的成员（currentSessionIds），按成员 currentInputId 的真实输入状态判断是否停稳；一份报告不提前返回；超时只返回快照、不 abort、不重建"
  - "派发只启动不等待：成员执行多久都不影响等待自身的 deadline（成员一直运行也按超时返回快照）"
  - "continue 只对已停稳成员追加续办输入；运行中/排队中的成员被拒（STAGE_NOT_READY），中断成员被拒（RECOVERY_REQUIRED），非运行 Task 一律被拒（TASK_CONTROLLED）"
  - "主管在工具内等待期间，成员在自己的会话与自己的 Pi 实例里运行；成员继承 Task 类型与角色工具集，且成员会话绑定 currentTaskId，可读取自己的 Task"
  - "pause：保留排队输入（恢复后仍可消费）、保留主管绑定，只 abort 正在运行的成员，然后写 paused"
  - "cancel：停止未开始工作（queued→stopped）并 abort 运行中的成员，写 cancelled 并释放主管绑定；取消后的 Task 不接受任何新工作"
  - "被控制 Task 的排队工作在 claim 时返回 TASK_CONTROLLED，唯一例外是暂停 Task 的 investigator+recovery 只读核实（create 与 claim 同一判据）"
review_rounds:
  - round: 1
    verdict: failed
    findings: 5 blocking
    fixes:
      - "等待不再阻塞超时：runAndWait 只启动派发（失败记为成员结果），立即进入 settleStep 由其 deadline 决定；测试用永不结束的 dispatch 验证"
      - "非运行 Task 例外先于普通相位门判定（investigator+recovery 任意相位），移除虚假相位 investigate"
      - "continue 写库前拒绝非运行 Task（TASK_CONTROLLED）与 interrupted 成员（RECOVERY_REQUIRED）"
      - "新增 store.finalizeControl 与 runner.controlTask（意图→停止子工作→终态），control 走宿主钩子"
      - "createTaskSessions 同事务把成员会话绑定 currentTaskId；control/prepare_candidate 仅主管可用"
  - round: 2
    verdict: failed
    findings: 4 blocking
    fixes:
      - "claimNextInput 关联 task_sessions 判例外，暂停 Task 的 investigator+recovery 可被认领（真实 runner 测试证明能跑完）"
      - "有未结束成员工作时 cancel 先写 cancelling，停止循环后才由 finalizeControl 写 cancelled"
      - "pause 不再把 queued 置为 stopped（S5：pause 保留 queued；cancel 才停止未开始工作）"
      - "槽位生命周期按 G2/architecture 统一：pause 保留 currentTaskId，仅 cancelled 释放，resume 幂等重绑"
  - round: 3
    verdict: failed
    findings: 1 blocking + 1 record
    fixes:
      - "create 与 claim 判据对齐：cancelling/cancelled 的 Task 不接受任何新工作（含恢复核实），且不写会话/关联/输入"
      - "claim 判据去掉不可达的 interrupted Task 状态（interrupted 是输入状态，不是 Task 状态）"
      - "记录更新为 110/110，并区分 pause/cancel 的排队与槽位语义"
evidence_after_fixes: "npm test 110/110（9 个文件）；typecheck 0；check:prompts 15/15；SDK 试验 47/47；真实模型 4/4"
risks_remaining:
  - "聚合里的 resultIds/interactionIds 目前恒为空：独立报告（agent_report）属 P3-e、原生交互属 P4；等待的“等用户”状态同样需要 P4 的交互接线"
  - "task.adopt/reconcile 未实现（属 P5 的接续/恢复）"
  - "冻结候选只登记调用方给出的文件摘要，运行器尚未自动计算（P5 结算时核对实际版本）"
```

## 切片 E1 · agent_report（本次）

```yaml
slice: P3-e-1 agent_report（kind/summary/body|reportRef/checks/verdict/supersede）+ 结果落盘与完成核对
changed:
  - path: devagent/src/store/store.ts
    purpose: schema v5（results 表 + 索引，v1→v5 迁移链补齐）；recordResult（不可变、单事务、校验归属/来源输入/种类/评审候选）、getResult/listTaskResults/resultsForInputs/supersededBy；taskCompletionGaps 改为按成员输入判定“专业工作已停稳/未核实中断”，并核对完成报告存在/种类/未被替代与 requiresTest 的同候选 passed Test
  - path: devagent/src/runtime/report-store.ts（新增）
    purpose: 报告正文目标与落盘（read Task → Server work/<taskId>/<sessionId>/<resultId>.md；write Task → 项目 .dev/work/<taskId>/<sessionId>/<resultId>.md）+ 原子写与读回核对
  - path: devagent/src/tools/report-tools.ts（新增）
    purpose: agent_report：身份/成员/运行中输入/期待种类核对；body 落盘或 reportRef 核对后仅登记；checks 严格解析；重试复用同一 resultId（同内容不产生重复报告）
  - path: devagent/src/tools/tool-kit.ts（新增）
    purpose: 抽出三个工具模块共用的 ToolOutcome/ok/fail/asRecord/readString/readStringArray/messageOf，去掉 task-tools 与 delegation-tools 的重复副本
  - path: devagent/src/tools/task-tools.ts
    purpose: task.get 返回正式结果（含 supersededBy 与 bodyRef）；控制/候选 op 仅主管
  - path: devagent/src/runtime/runner.ts
    purpose: 专业会话注册 agent_report；聚合的 resultIds 填入成员本输入真实产出的报告
  - path: devagent/test/report.test.ts（新增，12 项）
    purpose: 报告落盘位置、种类/verdict/候选校验、supersede 历史不覆写、reportRef 仅登记、仅运行中输入可报告、requiresTest 需同候选 passed Test、重试去重、read Task 以调查报告完成
  - path: devagent/test/runtime.test.ts
    purpose: 端到端：主管建 read Task → 委派 investigator → 成员经真实 Pi 循环提交 agent_report → 聚合带 resultIds → endTask 用该报告完成
behavior:
  - "实测：npm test 123/123（10 个文件）；typecheck 0；check:prompts 15/15；SDK 试验 47/47；真实模型 4/4"
  - "报告正文先落盘并读回核对，再写 result 行；重试同一报告复用 resultId，不产生第二份历史"
  - "报告不可覆写：修订是新 resultId 并指明 supersedesResultId，旧正文保留，被替代的报告不再满足完成条件"
  - "完成核对不再看“当前步骤列表是否为空”，而是逐成员核对真实输入状态（仍要求全部专业工作停稳、无未核实中断）"
review_rounds:
  - round: 1
    verdict: passed
    findings: 1 non-blocking
    fixed:
      - finding: "resultId 只按 kind/summary/body 派生：不同 reportRef 正文会撞同一个 id（第二份拿不到登记），summary+body 相同但 verdict/checks 不同的报告会被当成旧结果返回，新判定静默丢失"
        fix: "resultId 改为整份报告身份（kind/summary/body 或 reportRef 三元组/verdict/candidateId/checks/basisRefs/supersedes/settlement）的摘要；同内容重试仍复用同一 id"
        evidence: "report.test.ts：两条不同 reportRef 正文得到两条结果；同 summary/body 但 passed/blocked 得到两条不同结果；settlement 清单变化也是两条"
      - finding: "记录注释称同事务保存 result 与回执，但只 INSERT results"
        fix: "改为如实描述（正文由调用方先落盘核对，本事务只登记结果行并返回回执）"
  - round: 2
    verdict: passed
    findings: 1 non-blocking
    fixed:
      - finding: "报告身份漏了 settlement 载荷：正文与摘要相同但清单变化的结算报告会被当成旧结果返回"
        fix: "identity 增加 settlement 摘要；工具注释改为“每一个报告字段”"
        evidence: "report.test.ts：同正文不同 settlement 清单得到两条结果"
  residual_addressed:
    - "补齐 G3 的“必要独立 Review”：write Task 完成必须有一份未失效、与冻结候选一致、verdict=passed 的 review，且 requiresTest 的 Test 不得早于该 Review（D-04 每个实施流程都含独立检查）"
    - "残留说明：请求回执表（file_saves/request_receipts）未用于报告正文，报告落盘按 report-store 自身的“先文件后库”顺序（已在本节与工具注释写明）"
risks_remaining:
  - "settlement 清单只按实际调用保存，未做 S6 清单字段核对（属 P5 结算）"
  - "交互（waiting_user）与 question 工具属 P4；恢复核实报告已可用但恢复服务（task.reconcile）属 P5"
  - "报告正文未走 file_saves 回执/重试阶梯（S6 的该阶梯用于 Plan 等宿主规范保存）；重试幂等由整份报告身份派生的 resultId 保证"
```

## 切片 E2 · requirement（本次）

```yaml
slice: P3-e-2 requirement（list/get/save，F1-F4 格式、CAS 与双类型）+ 决定引用校验
changed:
  - path: devagent/src/runtime/requirement-store.ts（新增）
    purpose: .dev/requirements/<id>.md 的严格解析/序列化/list/get/save：schemaVersion/kind/status/时间/数组字段/项目相对路径校验，实施需求七个二级标题各一次且有序有正文；list 从文件重建并按 updatedAt 倒序、id 升序，游标绑定同一过滤与排序边界；save 先算目标版本、比原文件摘要、同目录临时文件原子替换并读回核对
  - path: devagent/src/tools/requirement-tools.ts（新增）
    purpose: requirement 工具 op=list/get/save；save 校验决定引用与角色（仅 chief/designer/settler 可写），校验格式与 id/kind 不变、createdAt 不变，以实际保存时间更新 updatedAt
  - path: devagent/src/runtime/authorization.ts（新增）
    purpose: 按 G2 校验 authorizationRef 为 {inputId} 或 {interactionId}：主体（本项目）、来源（真实输入）与状态（非 failed/interrupted）由程序核对，交互引用在 P4 接线前明确拒绝
  - path: devagent/src/tools/task-tools.ts
    purpose: createTask 的 authorizationRef 改为契约对象形状并做同样校验（原为字符串，属偏差修正）
  - path: devagent/src/runtime/runner.ts
    purpose: 按角色注册 requirement 工具（chief/designer/settler/developer；read Task 仍被工具集 denied 过滤）
  - path: devagent/test/requirement.test.ts（新增，11 项）
    purpose: 新建/读回版本、非法记录拒绝（缺节/状态/重复键/版本/id 不符）、实施需求七节、版本冲突与原地改类型拒绝、决定引用与角色校验、list 过滤分页与非法文件、损坏记录如实报告
  - path: devagent/test/runtime.test.ts
    purpose: 端到端：主管经真实 Pi 循环保存提案记录，文件落在项目 .dev/requirements/
behavior:
  - "实测：npm test 135/135（11 个文件）；typecheck 0；check:prompts 15/15；SDK 试验 47/47；真实模型 4/4"
  - "需求文件是唯一权威：list 从文件重建，不维护第二份实时状态；损坏文件按 invalidFiles 报告，不被隐藏也不被猜成合法记录"
  - "save 用原文件摘要做 CAS：期望版本不符拒绝且保留原文；id/kind 不可原地变化；createdAt 不变，updatedAt 由保存服务写为真实时间"
  - "决定引用按 G2 为 {inputId}|{interactionId}，程序核对主体/来源/状态，不解释语义；交互引用在 P4 前拒绝"
review_rounds:
  - round: 1
    verdict: failed
    findings: 1 blocking + 2 non-blocking
    fixed:
      - finding: "实施需求“每节有正文”只对最后一节成立：中间空节的切片把下一个标题的 '## ' 前缀算了进去"
        fix: "按“行尾到下一个标题行首”切片（用 match.index 而非 +title.length），空节一律报出"
        evidence: "requirement.test.ts：空的“范围”节被拒且不落盘"
      - finding: "list 直接 readFileSync，单个不可读文件（悬空符号链接/权限）会让整个 list 抛错"
        fix: "逐文件 try/catch，读失败计入 invalidFiles（与注释一致）"
        evidence: "requirement.test.ts：悬空符号链接出现在 invalidFiles，合法记录仍被列出"
      - finding: "modules 只查前缀，不核对项目内存在与可读（F1 要求保存服务核对）"
        fix: "parseRequirement 接收项目 cwd：拒绝越出项目、非文件、不存在或不可读的 modules 条目"
        evidence: "requirement.test.ts：../outside.md 与非存在路径被拒，真实 .dev/PROJECT.md 可保存"
  - round: 2
    verdict: passed
    findings: 1 non-blocking
    fixed:
      - finding: "getRequirement 仍未保护读取：存在但不可读的记录会抛错"
        fix: "读取 try/catch，返回可定位原因（F4）"
        evidence: "requirement.test.ts：以目录冒充 .md 记录时 get 返回 issues 而非抛错"
    overclaim_fixed:
      - "记录中“各一次且有序有正文”的措辞在修复后成立；新增用例覆盖中间空节"
      - "端到端用例标题改为只声称保存（list 由单测覆盖）"
risks_remaining:
  - "同请求重试复用 requestKey 属 API/请求层（P4）；文件级 CAS 会拒绝过期重试，不会重复写入"
  - "需求保存尚未写入 file_saves 回执（S6 表列出的宿主规范保存之一）；当前以同目录原子替换 + 摘要 CAS 保证不重复写入"
  - "需求完成内容/状态与项目报告纳入同次保存、Git 回执属 P5 结算"
```

## 切片 E3 · project.initialize（本次）

```yaml
slice: P3-e-3 project.initialize（入口差异、用户同意、逐文件 CAS 与 ready 核对）
changed:
  - path: devagent/src/runtime/project-store.ts（新增）
    purpose: 入口文件计划与写入：路径必须留在项目内、内容非空；逐文件按 expectedVersion 做创建/替换/CAS，冲突保留原文；同目录临时文件原子替换并读回；每步写入宿主 file_saves 回执（S6）；ready 以“文件真实存在且为文件”为准；reusedAuthorityRefs 的引用必须真实可读
  - path: devagent/src/store/store.ts
    purpose: 项目访问器 getProject 与 setProjectInitialization（按 expectedProjectRevision 做 CAS 并写 initializationRef）
  - path: devagent/src/tools/project-tools.ts（新增）
    purpose: project 工具 op=initialize：仅主管；先给出真实入口缺口/复用依据/完整拟写内容与影响（requestWriteUse=false 为预览）；写入需要用户明确同意的决定引用，缺失时拒绝并附完整计划；冲突/失败不覆盖原文并返回逐文件结果与缺失清单
  - path: devagent/src/runtime/runner.ts
    purpose: 主管会话注册 project 工具
  - path: devagent/test/project.test.ts（新增，6 项）
    purpose: 预览不写、缺同意不写、写入后 ready 且登记 initializationRef 与 file_saves、重复执行复用、版本冲突保留原文、越出项目路径与不可验证复用依据被拒、非主管与过期项目版本被拒
  - path: devagent/test/runtime.test.ts
    purpose: 端到端：主管经真实 Pi 循环建立知识入口，文件与 initializationRef 真实存在
behavior:
  - "实测：npm test 142/142（12 个文件）；typecheck 0；check:prompts 15/15；SDK 试验 47/47；真实模型 4/4"
  - "写项目需要用户明确同意：无决定引用时不写，返回 needsConsent 与完整计划（内部 ctx.ui.confirm 属 P4 交互接线）"
  - "每个入口独立版本校验与原子替换：冲突/失败保留原文，返回逐文件结果与缺失清单，重试只补缺项"
  - "ready 只表示入口真实可用（文件存在且为文件），并随 initializationRef 记录实际写入版本"
review_rounds:
  - round: 1
    verdict: passed
    findings: 3 non-blocking
    fixed:
      - finding: "逐文件读取在 try/catch 之外：入口位置已存在目录时整批中断，且回报 wrote=false 与写前计划"
        fix: "读取并入单文件保护：非普通文件/不可读计为该文件 failed 与缺失，其余文件继续，回报真实逐文件结果"
        evidence: "project.test.ts：docs/ 占用路径时 AGENTS.md 仍创建，docs 记 failed 与 missing"
      - finding: "预览与写入判定不一致：空内容在预览中是 create，写入时被拒"
        fix: "空内容在参数校验阶段就拒绝（INVALID_ARGUMENT），预览不再承诺写入会拒绝的条目"
        evidence: "project.test.ts：空白内容被拒"
      - finding: "同一文件被计划两次：预览说两次 create，写入实际一次 create 一次 conflict"
        fix: "解析后的重复路径在参数校验阶段拒绝"
        evidence: "project.test.ts：AGENTS.md 与 ./.dev/INDEX.md 归一化后重复被拒且未写"
risks_remaining:
  - "内部 ctx.ui.confirm（需要新决定时在工具内确认）属 P4；当前以“拒绝 + 完整计划 + 决定引用”达成同一契约"
  - "入口内容的业务质量（定位/能力/未知是否完整）由 Agent 判断，程序只核对保存与可用性"
```

## 后续切片（计划内，未开始）

```yaml
pending: []（P3-e 三个子切片完成后由 P4 接续交互与 HTTP/SSE）
```