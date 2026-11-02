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

## 非目标

- 不替模型补写 Review 正文，不把普通文本当报告。
- 不自动重新派发（主管按真实状态决定续办）。
- 不修改历史已完成输入的数据。
