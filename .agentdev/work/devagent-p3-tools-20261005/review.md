# Review Report · devagent-p3-tools-20261005

## 切片 A · 上下文装配 —— Round 1（会话 P3aContextReview）

```yaml
reviewer_session: P3aContextReview   # 独立上下文，只读
result: passed   # 2 项 non-blocking + 3 项 overclaim
verified_ok:
  - "G4 装配：chief = base + 自身；专业 = base + 共同规则 + 自身；只注入当前角色"
  - "追加而非替换：systemPrompt 仍含 Pi 原生块（<cwd>），长度大于注入文本"
  - "未知 roleId 在认领前被拒（blocked_role），输入保持 queued"
  - "effectiveConfig 含 promptDir，并参与配置指纹"
findings:
  - severity: non-blocking
    evidence: "终点边界（specialists 的 `## Role file map`）重复没有守卫，可能静默截断共同规则"
    remediation: "终点边界同样做重复检查并补负例"
    status: fixed
  - severity: non-blocking
    evidence: "记录称单轮上下文「有单测」，实际当时没有"
    remediation: "补 test/context.test.ts（切片 4 例 + 上下文 2 例）"
    status: fixed
overclaims:
  - "边界字面量缺少独立验证 → 已补「标题字面量恰好一次」与「抽取结果起点即该字面量」两项断言"
  - "负例只覆盖起点重复 → 已补终点重复"
```

## 切片 A —— 增量复核（会话 P3aContextReview）

```yaml
reviewer_session: P3aContextReview   # 同一独立上下文
result: passed
verified:
  - "终点边界重复现在被拒（探针：`## Role file map` 重复 → appears more than once）；起点重复同样被拒"
  - "test/context.test.ts 6/6；runtime 装配用例保持通过；无回归（typecheck 0、56/56、spikes 47/47）"
findings:
  - severity: non-blocking
    evidence: "字面量断言只检查标题是否出现一次，没有钉住抽取器实际使用的字面量"
    remediation: "断言抽取结果的起点就是文档化字面量"
    status: fixed
  - severity: non-blocking
    evidence: "测试记录未同步（当时仍写 50 项/13 检查）"
    remediation: "同步为 56/56、随后 14/14→15/15"
    status: fixed
  - severity: non-blocking
    evidence: "指向了当时不存在的 review.md"
    remediation: "写成本文件"
    status: fixed
residual:
  - "promptDir 内容变化不会触发实例重建（缓存以路径为键）；已记录在 risks_remaining"
```

## 切片 B · 角色与工具集 —— Round 1（会话 P3bToolsReview）

```yaml
reviewer_session: P3bToolsReview   # 新独立上下文，只读
result: failed   # 1 项 blocking + 3 项 non-blocking
verified_ok:
  - "七个角色的原生工具集与 G1 逐行一致；写能力角色都保留 read/grep/find/ls（有会失败的断言）"
  - "只读角色在任何 Task 类型下都没有 write/edit/bash；tester 只多 bash"
  - "read Task 去掉 write/edit/bash 与 requirement/project，agent_report 保留"
  - "接线改动没有波及其他调用方（spikes/checks 直接建会话；工厂仍以 config.tools 为默认）"
findings:
  - severity: blocking
    location: devagent/src/runtime/runner.ts:184-194 + registry.ts:37,48
    evidence: "实例复用只按配置指纹；Task 类型切换后仍沿用旧工具集（探针：第二次请求 write 工具，实际激活仍是 read 集）"
    impact: "write→read 的切换不会收回写工具，违反 G1 的 read Task 规则；套件无覆盖"
    remediation: "复用键包含有效工具集（并入注入正文）；历史文件与实例自身比对"
    status: fixed
  - severity: non-blocking
    location: devagent/src/runtime/runner.ts:187-189
    evidence: "宿主工具并入允许列表会把 read Task 已排除的 requirement/project 又加回来（一旦 P3-e 注册它们）"
    remediation: "toolSetFor 暴露 denied，并入时过滤"
    status: fixed
  - severity: non-blocking
    location: devagent/src/runtime/runner.ts:216-224
    evidence: "记录的是请求的允许列表，不是真正激活的工具（主管会话请求 12 个名字，实际激活 4 个）"
    remediation: "改为同时记录 requestedTools 与 activeTools"
    status: fixed
  - severity: non-blocking
    location: devagent/src/runtime/tool-sets.ts:49-54
    evidence: "专业角色的 task/requirement 工具范围宽于 G1（G1 只给 task.get、requirement.list/get）"
    remediation: "显式记录为 P3-e 必须收口的 op 级权限要求"
    status: fixed   # 已在代码注释与实施记录中声明
overclaims:
  - "「实际使用的工具集写入 effectiveConfig」与实现不符 → 已改为同时记录 requested/active"
  - "read Task 的保证被表述为端到端性质，实际只在 toolSetFor 层成立 → 已补 runner 层用例（denied 过滤）"
  - "记录未覆盖 Task 类型切换 → 已补切换用例"
```

## 切片 C · Task 核心工具 —— Round 1（会话 P3cTaskToolsReview）

```yaml
reviewer_session: P3cTaskToolsReview   # 新独立上下文，只读
result: failed   # 3 项 blocking + 3 项 non-blocking
verified_ok:
  - "G2 createTask 规则与两种槽位冲突码成立（WORKSPACE_BUSY / TASK_BUSY / INVALID_ARGUMENT / NOT_FOUND）"
  - "schema v1→v2→v3 升级保留既有数据与不变式"
  - "question 工具迁移为纯搬迁（文件字节相同，仅两个引用方改动）"
findings:
  - severity: blocking
    evidence: "updateTask 先写计划文件再走版本 CAS：落后的写入者会覆盖别人的计划文件，记录 planRef 却仍是旧摘要"
    remediation: "先算版本摘要 → store 校验并落 planRef → 再原子写文件；失败者不碰文件"
    status: fixed
  - severity: blocking
    evidence: "领域工具在实例创建时快照 inputId/currentTaskId，而 Pi 实例跨输入复用 → sourceInputId 记错、task.get 缺省 id 永远失败"
    remediation: "工具改为每次调用时解析实时上下文"
    status: fixed
  - severity: blocking
    evidence: "工具不校验归属：跨项目主管可推进任意 Task，专业角色可读任意 Task"
    remediation: "每个工具核 projectId；chief-only 再核 chiefSessionId；专业 task.get 限自身当前 Task"
    status: fixed
  - severity: non-blocking
    evidence: "createTask 被拒时留下孤儿计划文件与 saved 回执"
    remediation: "先建 Task 行，成功后再写文件"
    status: fixed
  - severity: non-blocking
    evidence: "updateTask 可把 read Task 的 requiresTest 翻成 true"
    remediation: "store 层与 createTask 同样拒绝"
    status: fixed
  - severity: non-blocking
    evidence: "计划复用分支不核对磁盘；file_saves 回执不随新内容更新"
    remediation: "复用前读盘比对；外部改写 → VERSION_CONFLICT 不覆盖；回执随实际写盘内容更新"
    status: fixed
```

## 切片 C · 增量复核（会话 P3cTaskToolsReview，两轮）

```yaml
reviewer_session: P3cTaskToolsReview   # 同一独立上下文
result: passed
round_1_delta:
  - "六项修复全部核实（含探针：stale revision 后磁盘不变、跨输入仍能按缺省 id 读到任务、FORBIDDEN/NOT_FOUND、被拒不留痕）"
  - "新增 3 项 non-blocking：计划保护依赖模型主动给 expectedPlanVersion（已改为默认按记录版本核对）；适配器丢掉工具级 sequential（已补回）；「被拒不留痕」断言了错误的 key（已改为按被拒调用自身 id 断言并核对工作目录）"
round_2_delta:
  - "三项修复核实通过：外部改写计划在未提供 expectedPlanVersion 时也报 VERSION_CONFLICT、文件不动；sequential 已到达运行时（session.getToolDefinition/getActiveToolNames 观测）"
  - "无新发现；残留仅为记录记账（已在本文件与 implementation.md 修正）"
  - "未验证项（已知待办）：STAGE_NOT_READY 守卫在 P3-d 填充当前步骤成员前不可达，测试记录已披露"
```

## 切片 B —— 增量复核（会话 P3bToolsReview）

```yaml
reviewer_session: P3bToolsReview   # 同一独立上下文
result: passed
verified_first_delta:
  - "blocking 已闭环：复用键含工具集与注入正文，Task 类型切换会重建实例（探针：write 集 → read 集，create 调用 2 次，激活工具不含 write/edit/bash）"
  - "无重建循环：哈希输入每次输入确定性一致，第三次相同绑定复用；重建时始终带 piFile，历史连续"
  - "denied 过滤生效：read Task 下 requirement 不被并入，probe_ok 正常激活"
  - "记录含 requestedTools/activeTools"
second_delta_findings:
  - severity: non-blocking
    evidence: "denied 只覆盖两张表里已有的名字：新注册但未列入 DOMAIN_BY_ROLE 的领域工具既不被授予也不被拒绝，会被并入"
    remediation: "让「宿主注册的领域工具清单」与角色表来自同一来源"
    status: fixed   # 新增导出 DOMAIN_TOOL_NAMES 作为唯一来源，P3-e 必须按它注册
  - severity: non-blocking
    evidence: "记录里仍带一个继承自服务器默认的 tools 字段，与实际工具集无关"
    remediation: "去掉该字段（只留 requestedTools/activeTools）"
    status: fixed
  - severity: non-blocking
    evidence: "本文件此前只有「见下」，没有增量复核内容"
    remediation: "写成本节"
    status: fixed
  - severity: non-blocking
    evidence: "test.md 描述断言用的是已不存在的 tools 数组"
    remediation: "改为 requestedTools/activeTools"
    status: fixed
residual:
  - "promptDir 内容变化不触发实例重建（缓存以路径为键）"
```
## 切片 D —— 委派、等待与 Task 控制（会话 P3dDelegationReview）

```yaml
reviewer_session: P3dDelegationReview   # 独立上下文，不读开发聊天
result: passed
rounds:
  - round: 1
    verdict: failed
    findings: 5 blocking
    summary: "等待被派发阻塞而超时失效；暂停 Task 的恢复核实不可达；continue 放行暂停 Task 与未决成员；pause/cancel 未真正停止子工作且不释放槽位；成员会话未绑定 Task"
  - round: 2
    verdict: failed
    findings: 4 blocking
    summary: "恢复核实只被创建无法认领；cancel 直接终态未停止成员；pause 破坏 queued（违反 S5）；槽位生命周期不一致"
  - round: 3
    verdict: failed
    findings: 1 blocking + 1 record
    summary: "create 接受取消 Task 的恢复核实而 claim 永不认领（生产者/消费者错配）；记录计数与 pause/cancel 语义过期"
residual:
  - "聚合的 resultIds/interactionIds 与成员 waiting_user 状态等待 P3-e/P4；task.adopt/reconcile 等待 P5；候选文件摘要由调用方给出（P5 结算核对实际版本）"
final_verification: "独立复核确认 create/claim 判据对齐（取消后零写入）、等待超时归等待自身、continue 与相位/种类门、控制状态机、成员身份与单事务边界均符合 G2/M2/S5，并确认记录与实测一致：typecheck 0；npm test 110/110（9 个文件）；check:prompts 15/15；spikes 47/47；真实模型 4/4"
```


## 切片 E1 —— agent_report（会话 P3eReportReview）

```yaml
reviewer_session: P3eReportReview   # 独立上下文，不读开发聊天
result: passed
rounds:
  - round: 1
    result: passed
    findings: 1 non-blocking
    summary: "resultId 只按 kind/summary/body 派生：不同 reportRef 正文撞同一 id，同 summary/body 不同 verdict 会被当成旧结果；记录注释称写入 result 与回执"
  - round: 2
    result: passed
    findings: 1 non-blocking
    summary: "报告身份漏 settlement 载荷：清单变化但正文相同会被当成旧结果"
  - round: 3
    result: passed
    findings: []
    summary: "报告身份覆盖全部字段；返回该记录为“重试不重复、不同报告不冲突”；记录中的计数与用例数一致"
residual:
  - "报告正文未使用 file_saves 回执阶梯（用于 Plan 等宿主规范保存），重试幂等由整份报告身份派生的 resultId 保证"
```

## 切片 E2 —— requirement（会话 P3eRequirementReview）

```yaml
reviewer_session: P3eRequirementReview   # 独立上下文，不读开发聊天
result: passed
rounds:
  - round: 1
    result: failed
    findings: 1 blocking + 2 non-blocking
    summary: "实施需求“每节有正文”只对末节成立（切片含下一个标题前缀）；list 未保护单文件读取；modules 未核对项目内存在与可读"
  - round: 2
    result: passed
    findings: 1 non-blocking
    summary: "get 仍未保护读取（存在但不可读会抛错）"
  - round: 3
    result: passed
    findings: []
    summary: "复核以真实模块探针确认：空中间节被拒、modules 越界/缺失被拒、悬空符号链接只进 invalidFiles；记录与用例数一致"
residual:
  - "需求保存尚未写 file_saves 回执（S6 宿主规范保存之一）；当前靠同目录原子替换 + 摘要 CAS 防止重复写入"
  - "同请求 requestKey 幂等属 API/请求层（P4）"
```

## 切片 E3 —— project.initialize（会话 P3eProjectReview）

```yaml
reviewer_session: P3eProjectReview   # 独立上下文，不读开发聊天
result: passed
rounds:
  - round: 1
    result: passed
    findings: 3 non-blocking
    summary: "单文件读取未保护（目录占用路径会中断整批并误报 wrote=false）；预览与写入对空内容判定不一致；同一文件可被计划两次"
  - round: 2
    result: passed
    findings: []
    summary: "三项均已修复并经探针/用例确认；记录计数可复现"
residual:
  - "内部 ctx.ui.confirm 属 P4；当前以“拒绝 + 完整计划 + 决定引用”达成同一契约"
  - "file_saves 回执已登记但未读回核对（S6 阶梯的核对部分随请求幂等层）"
```
