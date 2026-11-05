# 专业成员无正式报告却落 completed — 修复计划

## 现象

Task `t-b491e240` 的 M8 Review：`s-994dc03e`（i-d470ab42）与 `s-0a84035e`（i-ba0a9045）都在 Pi 里正常结束，但没有调用 `agent_report`；`s-181c159d` 的两次 continuation 也一样。数据库里这些输入是 `completed`，`results` 没有对应行。

## 根因

- `src/runtime/runner.ts` 只按 Pi 的 `stopReason` 与持久化边界决定终态；只要模型的最后一条消息是正常 `stop`，就写 `completed`，不核对成员是否提交了被派发时要求的报告。
- `src/runtime/task-progress.ts` / `webapp/src/chat/task-flow.ts` 的 `memberPassed` 因此把“正常结束但没有报告”当成通过。
- 契约（`docs/technicalnew/storage-and-recovery.md`）明确：一次输入结束没有期待报告应为 `REPORT_MISSING`。

## 方案

1. 在成员的 run 即将写 `completed` 前核对：该 Session 是当前 Task 成员、`currentInputId` 就是本次输入，且 `results` 中没有本次输入的报告。
2. 满足条件时写 `failed` + `errorCode='REPORT_MISSING'`，并保留模型输出/边界；不伪造报告、不自动重跑。
3. 不改 `agent_report` 的保存语义；报告存在时行为不变。
4. 回归测试：正常结束但未调用 `agent_report` → failed/REPORT_MISSING；已有报告 → completed。
5. 更新 validation/gap 记录；真实 workbench 需重启才生效。

## 实施结果（`c199154`）

- `runner`：成员输入无本次正式报告落 `failed/REPORT_MISSING`；有报告仍 `completed`。
- 读取面：`task.get`、Task detail、dispatch 成员状态给 `reportMissing/errorCode`。
- 进度/界面：`memberPassed`、`task-flow`、成员行都不把缺报告当完成，显示“缺报告”。
- 指引：缺报告时推荐原 Session report-only continuation，停止推荐 phase update/新 Review；`completionBlockers` 阻止无报告完成。
- 回归：服务端 49 文件 503 用例、webapp 12 文件 90 用例、两侧 `tsc`、webapp build 全部通过。
- 历史已 `completed` 的缺报告输入不回填；真实 workbench 需重启加载新 runner。

## 非目标

- 不替模型补写 Review 正文，不把普通文本当报告。
- 不自动重新派发（主管按真实状态决定续办）。
- 不修改历史已完成输入的数据。
