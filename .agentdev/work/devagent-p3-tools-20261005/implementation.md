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
  - 增量复核（同一独立会话）又发现 3 项 non-blocking：计划保护依赖模型主动给 expectedPlanVersion（已改为默认按记录版本核对，外部改写一律 VERSION_CONFLICT）；适配器丢掉了工具级 sequential（已补回）；「被拒不留痕迹」用例断言了错误的 key（已改为按被拒调用的 taskId 断言并核对工作目录只有一个任务目录）
  - 最终复核（同一独立会话）结果见 review.md
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

## 后续切片（计划内，未开始）

```yaml
pending: [P3-d 委派与等待（createTaskSessions + 聚合 + 超时）, P3-e 报告与需求工具（agent_report/requirement/project）]
```