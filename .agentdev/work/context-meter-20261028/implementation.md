# Implementation · context-meter-20261028

日期：2026-10-28。计划：`plan.md`；调研：`research.md`。

```yaml
implementation:
  task: context-meter-20261028
  changed:
    - path: devagent/src/runtime/context-usage.ts
      purpose: >
        contextUsageOf（活实例 → {tokens,contextWindow,percent,autoCompaction,live:true}）、
        windowOnlyContext（无实例 → 只给窗口）、contextNoticeOf（assistant message_end / compaction_end 才产生通知）。
    - path: devagent/src/server/stream-methods.ts
      purpose: prepare 变 async；快照增加 context；contextOf 可选注入。
    - path: devagent/src/server/main.ts
      purpose: >
        装配 contextOf：活实例优先；否则按上次运行模型（无则当前设置）取目录窗口并标 live=false。
        onEvent 在 assistant message_end / compaction_end 后用 queueMicrotask 计算并发布 context 通知（避开 Pi 先广播后落盘），观测异常只丢一帧。
    - path: devagent/src/server/http.ts
      purpose: context 作为顶层业务帧（与 invalidate 同路径），不包在 pi 事件里。
    - path: devagent/webapp/src/api/stream.ts
      purpose: ContextView、PreparedSnapshot.context、StreamFrame.type='context' + context。
    - path: devagent/webapp/src/state/slot.ts
      purpose: slot.context；snapshot 权威覆盖、context 通知更新、reset 清空。
    - path: devagent/webapp/src/app/ContextMeter.tsx
      purpose: 文本读数、70/90 阈值、role=meter/aria-valuetext、? 与 — 两种未知、tooltip（估算/窗口/自动压缩）。
    - path: devagent/webapp/src/app/StatusBar.tsx, App.tsx
      purpose: 模型区后渲染 meter；数据来自 session.slot.context。
    - path: devagent/webapp/src/theme/base.css
      purpose: .ctx 样式；≤860 收紧间距、≤560 只留百分比（未知保留 — / 窗口）、≤480 隐藏分支、≤400 再隐藏运行中计数，保留模型、读数与连接词；路径与快捷键提示先让位，模型名最后才收缩，连接状态始终保留。
    - path: devagent/webapp/src/i18n/catalog.ts
      purpose: 中英各 5 条上下文文案。
  behavior:
    - 每次 assistant 响应与压缩后占用自动更新，无需刷新
    - 压缩后到下一次响应前显示 ? / 窗口
    - 重启后本进程无实例显示 — / 窗口，首次运行后恢复实时值
    - 查看不改变模型、压缩设置或会话状态
  tests_changed:
    - devagent/test/context-usage.test.ts（新）
    - devagent/test/server-stream.test.ts（快照 + 顶层 context 帧）
    - devagent/test/workbench-entry.test.ts（重启后窗口-only；修正历史落盘竞态）
    - devagent/webapp/test/slot.test.ts（快照/通知/重置）
    - devagent/webapp/test/context-meter.test.ts（新，SSR 状态）
    - devagent/browser/acceptance.spec.ts（状态栏真实读数）
  plan_deviations:
    - 研究阶段曾考虑 session.get 也带 context；实现只用流快照 + 通知，避免 queued 轮询每 1.5s 做一次投影。
    - 事件触发用 microtask：Pi 在 message_end 之后才 append 该条消息；同步计算会读到少一条消息的旧投影，并推迟 append。microtask 在 append 之后、下一次事件之前运行。
    - test/workbench-entry 的“跑完立刻读历史”改为有界轮询：`message_end` 对每条消息都发，可能早于 assistant 条目落盘；属既有竞态。
  document_impact:
    - docs/productnew/modules/chief-conversation.md（C-03）
    - docs/productnew/acceptance.md（AC-43）
    - docs/technicalnew/ui-design.md（U2）
    - docs/technicalnew/runtime-contract.md（快照 context）
    - docs/technicalnew/messaging-and-collaboration.md（M4 context 通知）
  risks_remaining:
    - 占用是估算，非服务方计费；tooltip 已标注
    - 投影遍历在每次响应后执行；长会话有计算成本，未见卡顿
    - 无实例且目录查不到窗口时整体不显示（模型 chip 仍在）
```
