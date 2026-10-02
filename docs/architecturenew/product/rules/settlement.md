# 结算、接续与复盘规则

触发：完成交付、恢复未完工作、更新稳定知识或复盘。读取本规则、实际 task/结果、项目入口和变更。

1. 核对实际变化及本路线有效验证。轻量/document 不补虚假 Test；未知或失效验证不能据以完成。
2. 映射影响：用户行为→产品模块/需求；接口数据→技术模块；代码测试命令→maps；文档新增移动→索引；未完问题→issues；项目规则→确认后的 AGENTS/规则。无影响记 checkedUnchanged，不重写全部文件。
3. 稳定事实写最近权威；证据写 `.dev/work/<taskId>/`。设计/实现/执行验证分开，未确认选择和未覆盖保留。不能将开发聊天直接提升为正式事实。
4. 归档 Plan、自动步骤结果、真实 Review/Test/检查证据和 settlement.md。结算报告列 updated、checkedUnchanged、pending、remainingIssues、archiveRefs、publishPaths。新会话应沿 INDEX 找到行为/入口/差距。
5. 适用验证通过后写关联需求 completed 和摘要，执行引用/格式检查，列出本次 publishPaths，不先发布最终归档。提交编号仅存任务记录，不为写编号循环提交。
6. agent_result 提交结算并由程序写出该步骤 JSON；主管随后 project_publish 发布成果和全部归档，再 task_finish 最终检查。Git 失败保留待重试；无 Git 显示本机保存。失败列实际缺项，不能用“总结已写”替代结算。
7. 恢复先看 task/steps/未处理结果，再读指定 Pi Session。已有成功阶段不重做，未知工具不重试；文件完成/task 未完成先核对并继续收口。
8. 每 5 个完成任务或漏检事故提出复盘，记录有效/过重/遗漏及规则差异。用户确认后改变项目参数，未确认只是建议。证据与项目知识默认保留。
