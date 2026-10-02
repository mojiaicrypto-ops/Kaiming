# 结算、归档和恢复需求

## SET-01 结算输入与结果

主管在适用验证通过后派发 settlement，输入为实际变更、目标需求/Plan、有效 Review/Test 或 ReviewCheck、影响范围及当前知识入口。轻量/document 不制造不存在的 Test 报告。

Settlement 读取 [实际规则](rules/settlement.md)，核对并更新最近的权威文档；具体任务证据放 `.dev/work/<taskId>/`。必须列明 updated、checkedUnchanged、pending、remainingIssues、archiveRefs 和 publishPaths。

| 实际变化 | 必须核对的位置 |
|---|---|
| 用户行为/验收/能力 | 产品模块的实现与验证、PROJECT 能力与状态、关联需求；新行为定义必须已在验证前确认并写入 |
| 接口/数据/责任/依赖 | 对应 technical 模块 |
| 代码/测试/命令/入口 | maps/code.md、maps/tests.md |
| 文档新增/移动/拆分 | 最近索引及上级必要入口 |
| 未解决问题 | issues.md、需求/模块中的差距 |
| 项目规则 | AGENTS/项目规则，用户确认的差异 |

无影响可明确记录 checkedUnchanged，不要求重写所有文件。设计、实现、验证分开描述；没有证据不升级状态。

## SET-02 提交与完成

每个正式 task 最少归档 plan.md、各 step 结果（含实际配置、依据、目标及证据）、settlement.md。结果工具自动写步骤 JSON；角色额外写详细报告。归档可以引用 Server 保留的记录，但当前知识与完成摘要必须在项目文件可读。

关联需求在结算时写 completed/完成摘要及项目内证据引用。结算先提交 agent_result，程序保存并写出该步骤 JSON，再由主管调用 project_publish 提交明确列出的本任务文件、成果与完整归档；脏状态/冲突按 knowledge.md 保留，不自动覆盖。提交记录不写入本次被提交文档造成循环；Git 提交号由工具返回并存 task，提交内容清单由归档保存。

Git 失败使 task 保持 settling；无 Git 可以完成，明确本机保存。后续初始化 Git 可以提交相同文件，不重建需求或 task。

主管收到结算成功后调用 task_finish。程序检查 [契约](contracts.md) 的完成条件；语义质量由独立角色与验收负责，不能编造一个自然语言检查器。缺项列 missing，主管补结算/验证；完成消息来自成功的 task_finish。

## RES-01 浏览器重开

Server 与浏览器生命周期独立。重连从快照和文件查询得到实际状态，绑定已有 task/Session，不重新发送用户指令或自动创建任务。网络状态不代表执行状态。

## RES-02 Server 重启

Runtime 按以下顺序处理，持久操作结果始终优先于模型聊天：

1. 读取项目、Session、task、step、输入队列和 action 记录；项目文件仍为需求权威。
2. 新进程不能把上次 running 直接当运行。确认本 Runtime 管理的工具进程是否结束；不确定则将相关 task/step 标 blocked(effect_unknown)，阻止同工作区新的写入。
3. 有已持久 agent_result 的 step 保持结果，不重新执行。结果未交给主管时重新发送结果 ID，重复通知不能重复派发相同 dispatchKey。
4. 普通用户输入尚未开始投递时继续投递；已开始但是否产生副作用未知时不重发，先核对 Pi 记录与工具结果。无法核对就阻断，请主管/用户做具体核实。
5. 没有未知执行的活跃任务，自动向其原主管排入“任务接续”系统通知，使用指定 Pi 文件恢复；主管读取 task 和结果后继续下一步。已暂停/取消任务不自动开始。
6. 主管文件损坏或缺模型时，task 保留 blocked 并提示；用户通过 task.attach 选择新主管后装配项目知识、任务和结果引用接续。专业 Session 不改成主管，也不继承其他角色会话。

Pi 负责指定会话文件/消息上下文恢复。AgentDev 负责业务任务、结果和输入投递的恢复。任意 bash/外部工具执行没有天然事务；第一版不宣称通用的恰好一次执行。

## RES-03 文件与 task 完成中断

需求 completed 已保存而 task 尚未完成：本机显示“完成记录待核对”；主管重新读取结算与有效验证，调用 task_finish。若缺项，保持 task 未完成，由结算恢复 active/差距记录并补齐，不能重新开发已知完成成果。

Git 已提交但返回/数据库保存中断：publish 使用 operationId 查本次提交记录或内容，查到就返回原提交；无法证明则 GIT_RESULT_UNKNOWN，先核实，不创建内容相同的新需求或盲目再提交。

task completed 后再次调用 finish 返回同一结果，不重复事件/归档。完成文件与程序事实可能短暂不同，页面同时展示两者，不暗中覆盖。

## SET-03 规则演进与记录保留

每完成 5 个 task，以及一次漏检事故后，主管在下一次活跃交互提出复盘：有效检查、过重步骤、遗漏及具体建议。没有定时唤醒要求。

提出规则 diff，用户确认后更新 AGENTS/项目规则。未确认的建议归入 task/问题记录，不能改变生效流程。通用规则版本随 AgentDev 发布，项目保留自身参数。

第一版不自动清理。用户只能显式用 session.delete 清理 idle/closed 且未被未完 task/有效 Pi 文件证据引用的会话聊天；被引用返回 RECORD_IN_USE。项目知识、需求和 task 归档不随会话清理删除。删除项目绑定也不删除项目文件。

验收：AC-S01～AC-S04、AC-R01～AC-R04。
