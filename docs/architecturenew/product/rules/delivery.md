# 任务、计划、验证与返工规则

触发：正式交付、规划、实施、审核或测试。读本规则以及 task 的需求/Plan 和相关项目索引。

1. 主管 task_create：一次正式目标一个 task。standard 先有交付需求；直接实施指令无文件则 Product 整理后关联，不重复要求启动。纯需求保存不启动代码交付。
2. 路线 compact 仅纯样式/文案/确定展示；standard 包含其他代码行为；document 仅正式文档。compact/document=Plan→修改→独立 ReviewCheck→Settlement；standard=需求/Plan→Develop→独立 Review→独立 Test→Settlement。
3. Plan 在 `.dev/work/<taskId>/plan.md`，有目标/范围/依据/步骤/角色/检查/风险/授权。默认 explicit_goal 下原用户明确实施指令授权范围内计划；项目为 per_plan 时先取得当前 Plan 的明确确认。产品/范围/验收/规则/危险效果变化先提供具体差异，经用户决定再继续。
4. 主管 task_plan 登记计划和真实授权。派发让程序自动保存步骤，不每阶段额外 task.update。不同写角色顺序或独立工作区，最终组合验证，不因并行省略责任。
5. 工程师执行和真实检查后 agent_result；Review/Test 新 Session，仅正式依据与实际目标。审核 targetRef 变化则结果失效；源码修复重新 Review，再适用 Test。
6. Review 问题有位置/证据/影响/阻断性。开发 addressed 不是 verified；独立审核才能 verified。P0/P1 默认阻断，P2 影响验收阻断，P3 建议。风险接受来自用户，不自降级。
7. Test 保存命令/环境/exitCode/输出与覆盖 AC；没有真实运行不能 passed。未覆盖列具体 AC/原因，交主管取得明确处置；实际失败不能改成未覆盖。
8. 缺输入/模型、工具结果未知时 task_note 记录阻断与下一步；不丢成功结果、不盲目重试副作用。pause/cancel 保留实际影响，不声称自动回滚。
9. 适用验证通过后进入 Settlement。缺任一必需步骤，task_finish 返回未完成；继续补齐，不把模型一轮结束作为 task 完成。
