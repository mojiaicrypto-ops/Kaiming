# Test Report · devagent-p3-tools-20261005

## 切片 E2 · requirement（本次）

```yaml
runs:
  - command: cd devagent && npx tsc --noEmit
    result: passed
    exit_code: 0
    evidence: "无输出"
  - command: cd devagent && npm test
    result: passed
    exit_code: 0
    evidence: "11 个测试文件、135 项通过（requirement 11 项；runtime 38 项）"
  - command: cd devagent && npm run check:prompts / npm run spikes / node checks/runner-real-model.ts
    result: passed
    exit_code: 0
    evidence: "15/15；47/47（0 FAIL）；4/4"
key_evidence:
  - "保存保留调用方正文并以真实保存时间写 updatedAt；get 返回原文、元数据、文件摘要 version 与格式问题"
  - "非法记录（缺节、状态与类型不符、重复键、schemaVersion 不支持、id 与文件名不符）拒绝且不落盘，问题可定位"
  - "CAS：过期版本拒绝且原文不变；相同内容重复保存按重试处理；id/kind 不可原地变化，createdAt 不变"
  - "list 从文件重建并支持 kind/status 过滤与游标分页；损坏文件出现在 invalidFiles 且不出现在合法记录中"
  - "决定引用：未知输入被拒且不落盘；交互引用在 P4 前明确拒绝；developer 可读不可写（G1 op 级权限收口）"
  - "端到端（真实 Pi 循环）：主管调用 requirement.save 后记录落在项目 .dev/requirements/<id>.md"
  - "正文校验：中间空节与末节空节都被拒（修复前仅末节被发现）；modules 越出项目/非文件/不存在被拒，真实项目文件可保存"
  - "健壮性：单个不可读文件（悬空符号链接）出现在 invalidFiles，其余合法记录仍可列出"
not_covered:
  - area: "同请求 requestKey 幂等去重"
    reason: "属 API/请求层（P4）；文件级 CAS 已保证不重复写入"
    disposition: pending
result: passed
```

## 切片 E1 · agent_report（本次）

```yaml
runs:
  - command: cd devagent && npx tsc --noEmit
    result: passed
    exit_code: 0
    evidence: "无输出"
  - command: cd devagent && npm test
    result: passed
    exit_code: 0
    evidence: "10 个测试文件、123 项通过（report 12 项；runtime 37 项）"
  - command: cd devagent && npm run check:prompts / npm run spikes / node checks/runner-real-model.ts
    result: passed
    exit_code: 0
    evidence: "15/15；47/47（0 FAIL）；4/4"
key_evidence:
  - "落盘位置：write Task 报告在项目 .dev/work/<taskId>/<sessionId>/<resultId>.md，read Task 在 Server work 同构路径；正文读回摘要与登记一致"
  - "种类门：期待种类不符、read Task 提交 implementation、review 无 verdict、review 候选版本不符，均拒绝且不写库"
  - "不可覆写：第二份报告指向 supersedesResultId，旧正文保留；被替代的报告在完成核对中报出“was superseded”"
  - "reportRef：只核对已有正文摘要并登记，不复制；摘要不符返回 VERSION_CONFLICT 且不写库"
  - "身份：只有成员当前运行输入可以报告；非成员会话/过期输入被拒"
  - "完成：write Task 需 settlement 报告 + 同候选 passed Review + （requiresTest 时）不早于 Review 的同候选 passed Test；缺任一不可完成，完成报告被替代也不可完成；read Task 以 investigation 报告完成"
  - "报告身份去重：不同正文的 reportRef 报告是两条结果；同 summary/body 但 verdict 不同、settlement 清单不同也是两条（修复前会静默复用旧结果）"
  - "重试：同一报告内容重复调用复用同一 resultId，不新增历史"
  - "端到端（真实 Pi 循环）：成员调用 agent_report → 正文落盘、result 登记、聚合带 resultIds、endTask 以该报告完成"
not_covered:
  - area: "settlement 清单（S6 SettlementManifest）字段核对与 Git/本机保存回执"
    reason: "属 P5 结算"
    disposition: pending
  - area: "question 工具与等待用户交互"
    reason: "属 P4 原生交互接线"
    disposition: pending
result: passed
```

## 切片 D · 委派与等待（本次）

```yaml
runs:
  - command: cd devagent && npx tsc --noEmit
    result: passed
    exit_code: 0
    evidence: "无输出"
  - command: cd devagent && npm test
    result: passed
    exit_code: 0
    evidence: "9 个测试文件、110 项通过（delegation 12 项；runtime 36 项）"
  - command: cd devagent && npm run check:prompts / npm run spikes / node checks/runner-real-model.ts
    result: passed
    exit_code: 0
    evidence: "15/15；47/47（0 FAIL）；4/4"
regression_after_review:
  - "等待不再被派发阻塞：成员一直运行时按超时返回快照（成员 dispatch 永不结束）"
  - "暂停中的 Task 在任意相位接受 investigator+recovery，普通工作被拒且不产生成员"
  - "暂停 Task 的 continue 被拒（TASK_CONTROLLED）；interrupted 成员的 continue 被拒（RECOVERY_REQUIRED）；两者都不写入"
  - "暂停会真正中止在运行中的成员（真实 Pi 运行被 abort 且输入落为 stopped），Task 落为 paused 且保留主管绑定；被控制 Task 的排队工作不再被 claim；cancel 停止未开始工作并释放绑定"
  - "暂停 Task 的只读恢复核实能被真实认领并跑完（runNext 完成、输入 completed）；取消后的 Task 连恢复核实也被拒且不产生成员"
  - "pause 保留 queued（恢复后可认领），cancel 把 queued 置为 stopped"
  - "成员会话绑定 currentTaskId，专业会话可读取自己的 Task；control/prepare_candidate 仅主管可用"
key_evidence:
  - "create：成员会话、Task 关联、首条委派输入与 currentSessionIds 同事务写入；成员输入进入队列且被派发一次"
  - "聚合：等待返回 outcome=completed 与每个成员的状态；wait 模式不新增工作、超时快照原样返回（1s 下限生效）"
  - "相位门：plan 阶段委派 reviewer 被拒（STAGE_NOT_READY）且不产生任何成员"
  - "种类门：read Task 只接受 investigation/recovery（INVALID_ARGUMENT）"
  - "暂停门：Task 暂停后普通委派被拒（TASK_CONTROLLED），且不产生成员；仅 investigator+recovery 被接受（develop 相位也可）"
  - "continue：已停稳成员可以续办（currentInputId 指向新的 continuation 输入并被派发）；仍在排队的成员被拒"
  - "归属：非主管会话委派被拒（FORBIDDEN）"
  - "控制：pause→paused 且保留 currentTaskId；旧版本号 resume 被拒；新版本号 resume 回到 active 且保持绑定；cancel→cancelled 并释放绑定；prepare_candidate 冻结候选版本"
  - "端到端（真实 Pi 循环）：主管建 Task → 委派 developer → 成员在自己的会话真实跑完 → 聚合为 completed，成员属于 develop 阶段且 expectedKind=implementation"
not_covered:
  - area: "聚合的 resultIds/interactionIds 与成员 waiting_user 状态"
    reason: "独立报告属 P3-e、原生交互属 P4"
    disposition: pending
  - area: "task.adopt/reconcile（接续与恢复核实）"
    reason: "属 P5"
    disposition: pending
  - area: "真实模型下主管按步骤组织多角色（设计→开发→审核→测试→结算）的完整流程"
    reason: "属 I4/P6 场景验证"
    disposition: pending
result: passed
```

## 切片 C · Task 核心工具（本次）

```yaml
environment:
  runtime: node v24.8.0 / vitest 3.2.7；@earendil-works/pi-coding-agent 1.0.0；集成测试用本地 stub 端点
runs:
  - command: cd devagent && npx tsc --noEmit
    result: passed
    exit_code: 0
    evidence: "无输出"
  - command: cd devagent && npm test
    result: passed
    exit_code: 0
    evidence: "8 个测试文件、94 项通过（task-store 10 项；task-tools 9 项；runtime 32 项）"
  - command: cd devagent && npm run check:prompts
    result: passed
    exit_code: 0
    evidence: "15/15"
  - command: cd devagent && npm run spikes
    result: passed
    exit_code: 0
    evidence: "47/47，0 FAIL"
  - command: cd devagent && node checks/runner-real-model.ts
    result: passed
    exit_code: 0
    evidence: "4/4（真实模型完整链路；工具注册变更未破坏投递）"
key_evidence:
  - "创建：write Task 落库并取到主管槽位（sessions.currentTaskId=t-...），requiresTest/phase/status 正确"
  - "拒绝：同一主管第二个未结束 Task → WORKSPACE_BUSY；同一需求的第二个未结束实现 Task → TASK_BUSY；非 chief 会话建 Task → INVALID_ARGUMENT；不存在的会话 → NOT_FOUND"
  - "更新：旧版本号 → VERSION_CONFLICT；正确版本 + phase → 新相位且清空当前成员；可同时修订 goal"
  - "完成核对：endTask 返回 gaps（含结果未登记），任务保持 active 且主管槽位不释放"
  - "计划落盘：write Task 落在项目 .dev/work/<taskId>/plan.md，read Task 落在服务器 work/<taskId>/plan.md；同 requestKey 同内容复用回执、文件内容一致；文件被删除后 readPlan 报告 current=false"
  - "真实工具循环：模型调用 createTask → 任务行与计划文件真实存在（断言文件内容含计划正文）"
  - "校验穿透到模型：写 Task 未声明 requiresTest → 不产生任何 Task"
  - "主管会话激活工具含 createTask/updateTask/endTask/task 且不含 write"
  - "版本竞争：拿旧 revision 调 updateTask（带新计划正文）→ 报 VERSION_CONFLICT，且磁盘计划仍是原内容、Task revision 不变（修复前会被覆盖）"
  - "归属：同项目另一位主管改这个 Task → FORBIDDEN 且相位不变；别的项目/专业角色读 → NOT_FOUND"
  - "跨输入身份：同会话第二次输入的 task.get（不带 id）能读到第一次输入创建的任务；创建记录的 sourceInputId 是发起调用的那次输入"
  - "被拒的 createTask 不留下计划文件与 file_saves 回执"
  - "read Task 的 requiresTest 无法通过 updateTask 翻成 true"
  - "计划复用：磁盘被外部改写后，同 requestKey 重试既不复用也不覆盖 → VERSION_CONFLICT；记录版本回到盘上后新正文可正常改写且回执随磁盘更新"
not_covered:
  - area: "endTask 的成功路径"
    reason: "需要 agent_report 落库（P3-e）；当前必然返回 COMPLETION_INCOMPLETE 并列出缺项"
    disposition: pending
  - area: "Task control（pause/resume/cancel）与 adopt、阶段成员（currentSessionIds）由委派填充"
    reason: "P3-d"
    disposition: pending
  - area: "question 工具由运行器注册（宿主 UI 适配器接入）"
    reason: "P4 接入层"
    disposition: pending
  - area: "requirementId 槽位规则在真实需求保存流程中的联动"
    reason: "requirement.save 属 P3-e"
    disposition: pending
result: passed
```

## 切片 A · 上下文装配（已提交）

```yaml
runs:
  - "npx tsc --noEmit → 0；npm test → 56/56（当时）；npm run check:prompts → 15/15；npm run spikes → 47/47；node checks/runner-real-model.ts → 4/4"
key_evidence:
  - "chief 会话 systemPrompt 含 base 与 chief 正文片段，且仍含 Pi 原生块（<cwd>）→ 追加不替换"
  - "reviewer 会话含共同规则与 reviewer 正文，不含 chief 正文 → 只注入当前角色"
  - "未知 roleId → blocked_role，输入保持 queued，未创建实例"
```

## 切片 B · 角色与工具集（本次）

```yaml
environment:
  runtime: node v24.8.0 / vitest 3.2.7；@earendil-works/pi-coding-agent 1.0.0；集成测试用本地 stub 端点
runs:
  - command: cd devagent && npx tsc --noEmit
    result: passed
    exit_code: 0
    evidence: "无输出"
  - command: cd devagent && npm test
    result: passed
    exit_code: 0
    evidence: "6 个测试文件、71 项通过（tool-sets 9 项；runtime 28 项）"
  - command: cd devagent && npm run check:prompts
    result: passed
    exit_code: 0
    evidence: "15/15"
  - command: cd devagent && npm run spikes
    result: passed
    exit_code: 0
    evidence: "47/47，0 FAIL"
  - command: cd devagent && node checks/runner-real-model.ts
    result: passed
    exit_code: 0
    evidence: "4/4（真实模型下完整链路仍通过，工具集裁剪未破坏投递）"
key_evidence:
  - "写工具带读工具：designer/developer/settler 的 readTools 断言为 [read,grep,find,ls]"
  - "read Task 全角色不含 write/edit/bash/requirement/project，且 projectReadOnly=true"
  - "write Task：developer 含 write/edit/bash；designer 不含 bash；reviewer 不含 write/edit/bash"
  - "尚无 Task：chief 保留 requirement/project（proprietor 集合），reviewer 仍只读"
  - "仅 chief 持有四个核心 Task 工具（其余角色在 read/write 下都不含）"
  - "集成：Reviewer 在 write Task 中激活工具含 read/grep 且不含 write/edit/bash；Developer 在 write Task 含 read/write/edit/bash，在 read Task 不含"
  - "effectiveConfig 记录 requestedTools 与 activeTools（解析后断言 requested 不含 write/edit、active 是 requested 子集、taskType=write）"
  - "Task 类型切换（write→read）在同一会话上重建实例：第二次的激活工具不含 write/edit/bash（修复前会沿用旧工具集）"
  - "denied 覆盖角色级排除：read Task 下注册名为 requirement 的自定义工具不会被激活；write Task 下给 reviewer 注册 createTask 同样不会被激活（probe_ok 正常激活）"
  - "记录同时含 requestedTools 与 activeTools，且 activeTools 是 requested 的子集（未注册的名字不会假装可用）"
not_covered:
  - area: "工具内部的 op 级权限（requirement.save 在 read Task 被拒等）"
    reason: "属 P3-e；当前 read Task 直接不给 requirement/project 工具"
    disposition: pending
  - area: "P3-c/d/e 的 Task 工具、委派等待、报告与需求工具"
    reason: "后续切片"
    disposition: pending
  - area: "真实模型下各角色是否遵守工具集限制"
    reason: "属 I4 场景表"
    disposition: pending
result: passed
```