# Settlement · 主管会话连续性

```yaml
settlement:
  task: chief-session-continuity-20261031
  stable_facts:
    - 已终止 Task 的队列清扫只关闭真正的 Task 工作；该 Task 主管会话自己的 user/system_notice 回合保留并在会话空出后投递。
    - TASK_CONTROLLED 门禁对 completed/cancelled Task 同样放行主管回合（终态指针本应同事务清空，此处为防御性一致）。
    - 委派等待只活在主管回合内；成员报告晚到时，宿主在步骤停稳且主管空闲的前提下补一次 system_notice 回合。
    - 唤醒按“Task + 该步骤成员输入集合”去重，一步一次；主管忙、Task 非 active/waiting、无派发成员时不投递；不推进阶段、不判定完成、不重放成员工作。
    - ask 的答复走 interaction.respond（只写 interactions 并唤醒原调用），不生成 session_inputs；两条改动都不影响它。
    - aisuangua 现场：`c-mvv6kpir-2230-a9abe0` 被 TASK_ENDED 丢弃（16:33:32）；主管回合 14:52:07 结束后 dev 报告 15:29:00 落库，主管空转到 15:35:26 的用户消息。
  updated:
    - devagent/src/store/store.ts
    - devagent/src/server/step-wake.ts
    - devagent/src/server/main.ts
    - devagent/test/store.test.ts
    - devagent/test/server-write.test.ts
    - devagent/test/step-wake.test.ts
    - devagent/test/step-wake-e2e.test.ts
    - docs/technicalnew/runtime-contract.md
    - docs/technicalnew/validation.md
    - docs/technicalnew/gap-register.md
    - docs/productnew/modules/delivery.md (D-03)
    - docs/productnew/acceptance.md (AC-45)
  proposed_for_confirmation:
    - review F1：暂停→恢复、queued 输入被停止、恢复确认三条路径不产生 run outcome，因此不会触发唤醒；是否纳入本机制（会新增调用点）。
    - review F2：修复一只有 claim 级用例；是否补“引用已取消 Task 的 queued 主管消息在真实 workbench 跑完”的 E2E。
    - review F3：interrupted 成员被视作停稳，通知文案没有给出 task(op=recover) 指引；是否改文案。
    - review 问题 1：通知已入队但 Task 在认领前结束/取消时，通知仍会运行一次“Continue the Task”；是否在认领时丢弃。
    - review 问题 2：CHIEF_BUSY 计入当前不可 claim 的旧 Task 输入；是否忽略这类输入。
    - review 问题 3：唤醒回合自身失败/停止后不再重发（id 已存在）；接受由用户消息恢复还是另加重试。
    - review 问题 4：主管已消费结果但故意不派发下一步时会多一次提醒回合；是否接受。
    - AC-45 已写入验收场景，但浏览器/真实模型未执行（仍为未验证）。
    - 已停止的历史消息 `c-mvv6kpir-2230-a9abe0` 不自动重投；是否按原文重投由用户决定。
  deferred_by_user: 2026-10-31 — F1–F3、四个 review 问题、AC-45 未执行、历史消息不重投，全部只记录、暂不处理。
  indexes_updated: []
  archived:
    - .agentdev/work/chief-session-continuity-20261031/plan.md
    - .agentdev/work/chief-session-continuity-20261031/implementation.md
    - .agentdev/work/chief-session-continuity-20261031/review.md
    - .agentdev/work/chief-session-continuity-20261031/test.md
    - .agentdev/work/chief-session-continuity-20261031/settlement.md
  no_change:
    - docs/INDEX.md (没有新增权威文档；归档位于 .agentdev/work)
    - code map (仓库没有 Code Map 资产)
    - docs/technicalnew/messaging-and-collaboration.md (M2 已定义 timeout 快照；宿主补回合写在 R3)
    - docs/productnew/modules/external-agents.md (外部状态仍由事实推导，无行为变化)
    - rules / skills (触发条件未变)
  completion_gate: passed
```

## Deferred（用户 2026-10-31 决定：只记录，暂不处理）

1. F1–F3：暂停→恢复 / queued 停止 / 恢复确认不触发唤醒；修复一缺真实回合 E2E；interrupted 成员通知文案（F3 已由 `watchdog-wait-and-recovery-20261031` 关闭）。
2. 四个 review 问题：通知在 Task 结束后仍运行、CHIEF_BUSY 计入不可 claim 的旧输入、唤醒回合失败不重发、主管故意不派发时多一次提醒。
3. AC-45 未在浏览器/真实模型下执行；`test/browser` 未运行。AC-45 措辞按确认的行为 A 写成。
4. 已停止的历史消息 `c-mvv6kpir-2230-a9abe0` 不自动重投。

## Commits

- `7b8d9bc` fix(store): deliver the chief's queued turn after its Task ends
- `d5f4e53` fix(server): wake the chief when a step settles after its turn ended
- docs(work): settle chief-session continuity
