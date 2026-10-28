# Implementation · paused-chief-input-20261028

日期：2026-10-28。计划：`plan.md`。

```yaml
implementation:
  task: paused-chief-input-20261028
  changed:
    - path: devagent/src/store/store.ts
      purpose: >
        claimNextInput：Task 为 pausing/paused 且该会话就是 chiefSessionId 时，user/system_notice
        输入照常认领；其它状态（cancelling/cancelled/completed）与成员输入不变。own-task 子查询改为
        返回 held 标记，非 chief 的 user/system_notice 行仍以 controlled 拒绝（不退回 busy）。
    - path: devagent/src/runtime/tool-sets.ts
      purpose: >
        toolSetFor 增加 hold 参数（running|paused）；paused 与 read Task 同样移除
        write/edit/bash/requirement/project，保留 read/grep/find/ls/task/question 与外部只读工具。
    - path: devagent/src/runtime/runner.ts
      purpose: >
        每次认领时按所属 Task 状态解析 hold（holdOf），且只对 chief 生效；成员工具集保持 G1 表。
        hold 参与 registry 的 binding hash，所以暂停轮会以同一历史重建实例，不会沿用运行轮的宽工具集。
    - path: devagent/src/tools/task-tools.ts
      purpose: >
        task(op=get) 在 paused/pausing/cancelling 时返回 context.writeHold 与一句说明，避免模型靠
        “工具不存在”猜测；resume 的 nextAction 仍由 guidance 提供。
  behavior:
    - 暂停 Task 下，用户发给主管的新消息会真正执行（queued→processing→completed），会话不会冻结
    - 同一暂停期，主管的写工具（write/edit/bash/requirement/project）不进入本次运行
    - resume 后下一次运行恢复写工具
    - 成员工作、cancelled/cancelling、未核实的 interrupted 均保持原有拒绝
  tests_changed:
    - devagent/test/store.test.ts
    - devagent/test/runtime.test.ts
    - devagent/test/tool-sets.test.ts
    - devagent/test/task-tools.test.ts
  plan_deviations:
    - 计划提到“暂停期拒绝项目写 op”；实现按工具集整体移除，而不是在 requirement/project 内逐个 op 守卫。
      理由：allowlist 是运行前固定的，模型看不到工具优于调用后被拒；G1 的 read Task 已是同一形态。
    - 计划未预见“确认实例复用”的验证需求；实测表明 hold 改变 allowlist 即改变 binding hash，暂停轮
      会重建实例。曾加过 setActiveToolsByName 兜底，因无可复现缺陷而删除（简单优先）。
  document_impact:
    - docs/technicalnew/validation.md（追加本轮证据）
  risks_remaining:
    - 暂停期连 requirement 的只读 op 也一并移除；若日后要求暂停期可读需求，需要按 op 拆分工具
```
