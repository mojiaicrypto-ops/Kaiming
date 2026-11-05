# Settlement · context-meter-20261028

日期：2026-10-28。计划：`plan.md`；调研：`research.md`；实施：`implementation.md`；复核：`review.md`；测试：`test.md`。

```yaml
settlement:
  task: context-meter-20261028
  status: completed
  stable_facts:
    - 主管 chat 的状态栏模型区显示 `provider/model · 已用 / 窗口 · 百分比`；数据来自 Pi 的 getContextUsage 估算
    - 快照带 context；assistant message_end / compaction_end 后推送顶层 context 通知（microtask，观测失败不影响 run）
    - 有活实例时 live=true；无实例时只给上次运行（否则当前设置）模型的窗口，live=false
    - 压缩后 tokens/percent 为 null，界面显示 ?；无实例显示 —；都不沿用旧值
    - ≥70% warning、≥90% danger；tooltip 标明 estimated 与自动压缩状态
    - 响应式：≤860 收紧间距；≤560 只留百分比；≤480 隐藏分支；≤400 隐藏运行计数；模型最后收缩，快捷键提示先让位
  updated:
    - docs/productnew/modules/chief-conversation.md   # C-03
    - docs/productnew/acceptance.md                    # AC-43
    - docs/technicalnew/ui-design.md                   # U2 状态栏模型区
    - docs/technicalnew/runtime-contract.md            # 快照 context 字段
    - docs/technicalnew/messaging-and-collaboration.md # M4 context 通知
    - docs/technicalnew/validation.md                  # 本轮证据与未覆盖
  proposed_for_confirmation: []
  indexes_updated: []
  archived:
    - .agentdev/work/context-meter-20261028/plan.md
    - .agentdev/work/context-meter-20261028/research.md
    - .agentdev/work/context-meter-20261028/implementation.md
    - .agentdev/work/context-meter-20261028/review.md
    - .agentdev/work/context-meter-20261028/test.md
  no_change:
    - docs/technicalnew/storage-and-recovery.md   # 无 schema/存储变化
    - docs/technicalnew/gap-register.md           # 未新增方法/入口/合同缺口；S6（会话级累计用量）不在本轮
    - devagent/webapp/src/settings/UsagePage.tsx  # 累计用量页不变
  evidence:
    - 两侧 tsc --noEmit 无诊断
    - 服务端单测 43 文件 453 用例；webapp 12 文件 79 用例
    - 浏览器 57 用例；真实桌面读数 `2 / 128k · 0.0%`，递增 provider 12k→38k（9.4%→29.7%）
    - 重启后 prepare `{tokens:null,contextWindow:128000,percent:null,autoCompaction:null,live:false}`，config.get 三次一致
    - 手机 390/320：meter 可见、仅百分比、无溢出；≤480 分支隐藏、≤400 运行计数隐藏
  risks_remaining:
    - 占用是估算，非服务方计费；界面已标注
    - 每次响应/压缩后做一次投影遍历，长会话有计算成本；未见卡顿
    - 真实压缩后的 ?、真实 70/90 颜色、真实成员/断线只在 SSR 单测或注入节点层面验证
  completion_gate: passed
```

## 过程说明

- 调研阶段发现主管模型窗口 1M、现场最后响应约 616.9k（61.7%），据此确定“绝对值 + 百分比”而不是单一进度条。
- 首次实现后独立测试发现手机 390 被 `≤400` 规则整体隐藏；用户目标是“能看得到”，因此改为手机底部保留百分比，并在后续复核中修正 401–650 的模型名/连接词优先级。
- `test/workbench-entry.test.ts` 的既有竞态（`message_end` 对每条消息都发）用有界轮询修正，未放宽断言。
