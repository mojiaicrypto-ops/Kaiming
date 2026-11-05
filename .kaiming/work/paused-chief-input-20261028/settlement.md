# Settlement · paused-chief-input-20261028

日期：2026-10-28。计划：`plan.md`；实施：`implementation.md`；复核：`review.md`（两轮）；测试：`test.md`（两轮，第二轮为准）。

```yaml
settlement:
  task: paused-chief-input-20261028
  status: completed
  stable_facts:
    - Task 为 paused/pausing 时，该 Task 的 chief 会话仍可消费自己的 user/system_notice 输入；成员工作、cancelled/cancelling、未核实 interrupted 的拒绝不变
    - 暂停期 chief 的工具集不含 write/edit/bash/requirement/project，resume 后恢复；hold 参与 registry binding hash，暂停轮以同一历史重建实例
    - task(op=get) 在 paused/pausing/cancelling 时返回 context.writeHold 与说明
    - 会话被暂停 Task 冻结的现场（input 永停 queued、claim=0）由认领门闩修复，不需要改数据或重启
  updated:
    - docs/technicalnew/validation.md   # 追加本轮现象、根因、修复与证据
  proposed_for_confirmation:
    - 暂停期是否保留 requirement/project 的只读 op（当前整工具移除，产品未要求）
  indexes_updated: []
  archived:
    - .agentdev/work/paused-chief-input-20261028/plan.md
    - .agentdev/work/paused-chief-input-20261028/implementation.md
    - .agentdev/work/paused-chief-input-20261028/review.md
    - .agentdev/work/paused-chief-input-20261028/test.md
  no_change:
    - docs/technicalnew/storage-and-recovery.md   # S3 原文已规定该行为，实现改为一致，无需改契约
    - docs/technicalnew/gap-register.md           # 未新增方法/入口/合同变化
    - devagent/webapp/**                          # Task 条已有 Resume，未改前端
  evidence:
    - npm run typecheck：无输出
    - npx vitest run：42 文件 444 用例全绿
    - 真实服务 + stub 模型：暂停轮 queued→processing→completed；工具表无写工具，resume 后恢复
    - HEAD 工作树 + 新测试（无修复）：tool-sets 1、store 1、task-tools 1、runtime 3 个新用例按预期失败
  risks_remaining:
    - 暂停期连 requirement 的只读 op 也不可用（已知取舍，见 proposed_for_confirmation）
  completion_gate: passed
```

## 现场会话

卡住的会话 `s-951d407099a4` / 输入 `c-mvrpgbc4-25-271cab` 未被本次任务改动（任务不写现场数据）。
在运行中的服务尚未重启加载新代码前，用户点 Task 条的「继续 / Resume」即可放行该输入；
重启服务后，暂停 Task 下的新消息会直接执行。
