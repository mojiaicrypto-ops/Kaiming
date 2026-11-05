# Implementation · compaction-policy-20261028

日期：2026-10-28。计划：`plan.md`。用户决定：默认 70%、下一条消息前、保留 Pi 兜底、点占位手动压缩。

```yaml
implementation:
  task: compaction-policy-20261028
  changed:
    - path: devagent/src/store/store.ts
      purpose: >
        schema v16：compaction_settings 单行（auto、thresholdPercent、revision、updatedAt），默认 auto=1/70%/rev1；
        getCompactionConfig / saveCompactionConfig（1–99 校验、revision CAS）。
    - path: devagent/src/runtime/compaction-policy.ts
      purpose: compactionDue(percent, policy)：auto 且百分比达到阈值才压缩。
    - path: devagent/src/runtime/runner.ts
      purpose: >
        每会话 compacting 锁 + done promise；runNext 认领前等待手动压缩、认领后在交付前按全局策略压缩
        （同一输入内，失败不阻断）；compactManually 校验运行中/中断/无实例；summarize 复用 Pi compact()
        并把 “Nothing/Already compacted” 归为 nothing；压缩中收到 stop 重新记录 stopped。
    - path: devagent/src/server/methods.ts
      purpose: compaction.get / compaction.save（全局、50–95、CAS）。
    - path: devagent/src/server/write-methods.ts
      purpose: session.compact 写方法，返回 runner 的 status（不伪造成功）。
    - path: devagent/src/server/main.ts
      purpose: 注入 compactSession；快照 compactingOf = Pi isCompacting；自动策略读取 store。
    - path: devagent/src/server/stream-methods.ts
      purpose: 快照带 compacting，重连仍显示压缩中。
    - path: devagent/webapp/src/api/stream.ts, state/slot.ts, state/useSession.ts
      purpose: snapshot/事件 compacting；session.compact API；compaction_start/end 正确切换（agent_settled 不再误置）。
    - path: devagent/webapp/src/app/ContextMeter.tsx
      purpose: 占位变按钮 + portal 面板（已用/窗口/百分比/自动压缩），立即压缩、禁用原因、结果说明。
    - path: devagent/webapp/src/settings/ModelsPage.tsx
      purpose: Models 顶部全局「上下文压缩」卡片：开关 + 50–95% 阈值，保存/回读。
    - path: devagent/webapp/src/{app/App,app/StatusBar}.tsx, i18n/catalog.ts, theme/base.css
      purpose: 装配、文案（中英）、卡片与弹层样式。
  behavior:
    - 达到全局阈值时，下一条输入被认领后先压缩再交付；压缩失败仍交付，Pi 近上限兜底不变
    - 手动压缩在空闲、无未核实中断、有活实例时执行；运行中/无实例/恢复未核实如实拒绝
    - 压缩中状态由快照与 compaction_start/end 驱动；重连也可见
    - Pi 默认 auto 仍开启（窗口前 16k tokens），不受本开关关闭影响
  tests_changed:
    - devagent/test/compaction-policy.test.ts（新）
    - devagent/test/compaction-runner.test.ts（新：自动阈值/手动/忙/无实例/nothing/failed）
    - devagent/test/store.test.ts（默认、CAS、范围）
    - devagent/test/server-write.test.ts（compaction.get/save、session.compact 路由）
    - devagent/test/server-stream.test.ts（快照 compacting）
    - devagent/webapp/test/slot.test.ts（compaction_start/end、snapshot）
    - devagent/webapp/test/context-meter.test.ts（按钮/面板关闭态）
    - devagent/browser/acceptance.spec.ts（设置卡保存回读、手动面板）
  plan_deviations:
    - 自动压缩放在“认领后、交付前”，而不是认领前查队列：避免与用户手动压缩/worker 认领竞态；
      代价是压缩延迟落在这条消息里，符合“下一条消息开始前”。
    - 压缩事件在 auto 路径 reason 为 manual（Pi compact() 的固定值），界面只显示压缩中，不展示原因。
    - 手动压缩需要活实例；重启后先发一条消息。按钮禁用并说明。
  document_impact:
    - docs/productnew/modules/chief-conversation.md（C-03）
    - docs/productnew/modules/project-workspace.md（全局设置）
    - docs/productnew/acceptance.md（AC-44）
    - docs/technicalnew/runtime-contract.md（方法/快照）
    - docs/technicalnew/ui-design.md（占位按钮/面板/Models 卡/方法表）
    - docs/technicalnew/messaging-and-collaboration.md（compaction 事件与快照）
  risks_remaining:
    - 压缩成本不进用量 ledger（既有缺口）
    - 自动压缩失败会在下一条消息重试；未加退避
    - 真实成功压缩需要足够历史；小会话如实返回 nothing
```
