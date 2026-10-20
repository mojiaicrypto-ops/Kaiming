# 阶段 1 Plan · 去令牌与工具面收敛

日期:2026-10-20。依据:`optimization-list.md` 阶段 1;`docs/technicalnew/agents-and-tools.md` G2/G3。状态:用户已批准开始。

## 范围

模型可见的工具参数不再携带 revision、文件摘要、候选 id、计划/报告版本、报告种类、派发模式;工具面收敛为 5 个领域工具。

| # | 改动 | 语义 |
|---|---|---|
| P1 | `update`/`end`/`control`/`adopt`/`recover` 去掉 revision 类参数 | 无(单写者) |
| P2 | `requirement.save`、`project.initialize` 去掉摘要/版本;程序记录本会话上次读到的内容,磁盘被改时返回当前内容 | 无 |
| P3 | `agent_report` 去掉 kind、candidateId、supersedesResultId、reportRef;kind 取派发时的 expectedKind,body 必填 | 无 |
| P4 | 删除候选对象;保存 Review/Test 报告时程序记录交付状态(git 不参与:树内容摘要,排除 `.git`/`node_modules`/`.dev`/已初始化知识入口);完成时比较,变化即缺项 | 无(替换令牌绑定) |
| P5 | 派发统一为 `task(op=dispatch)`,sessions[] 每项 roleId 与 sessionId 恰一;无 sessions = 等待 | 无 |
| P6 | 合并为 `task(op=create/update/dispatch/control/end/get/adopt/recover)`;首席全部,专业仅 get;注册 5 个领域工具 | 无 |
| P7 | 存储 schema v9:results.deliveryState、task_sessions.writeScope;删除 tasks.candidate、results.candidateId/supersedesResultId、task_sessions.candidateId | — |
| P8 | 结算报告正文路径可预测(`<taskId>/<sessionId>/settlement.md`),先把正文写入并提交,再以相同 body 提交报告 | 保留 D-07 提交顺序 |

## 验收

- 以上工具在无任何 revision/摘要/候选参数时完成建 Task→派发→报告→结算→结束。
- 复核后改动交付文件→`end` 返回缺项;仅改 `.dev/` 记录或新增文件→不误报。
- 外部手改需求文件后 `requirement.save` 返回当前内容且不覆盖。
- `npm test` 全绿;`npm run typecheck` 通过。
- 实机跑一轮完整流程(用真实模型)记录工具错误数。

## 不做

- stage 2 的 writeScope 重叠告警、stage 4 的 nextActions(本阶段仅保留字段与合并,不加新提示)。
- 并行多 Task worktree。
