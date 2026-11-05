# Settlement · compaction-policy-20261028

日期：2026-10-28。计划：`plan.md`；实施：`implementation.md`；复核：`review.md`；测试：`test.md`。

```yaml
settlement:
  task: compaction-policy-20261028
  status: completed
  stable_facts:
    - 全局主动压缩默认 70%、范围 50–95%，存 SQLite v16 compaction_settings（单行、revision）；Pi 原生兜底不在此开关
    - 下一条消息被认领后、交付前，占用 ≥ 阈值时调用 Pi 原生 compact()；失败不阻断输入，Pi 近上限兜底仍在
    - 手动压缩点状态栏上下文档位打开面板；空闲/有排队消息可执行，运行中/无活实例/未核实中断禁用并说明
    - 压缩中由快照 compacting 与 compaction_start/end 驱动，重连可见；结束后占用 ? 直到下一次响应
    - Pi 默认：enabled=true、reserve=16k、keepRecent=20k，阈值 window−16k（1M 98.4% / 128k 87.5%）；只作安全网
  updated:
    - docs/productnew/modules/chief-conversation.md       # C-03
    - docs/productnew/modules/project-workspace.md        # 全局设置与触发时点
    - docs/productnew/acceptance.md                        # AC-44
    - docs/technicalnew/runtime-contract.md                # session.compact / compaction.get/save / 快照
    - docs/technicalnew/ui-design.md                       # 占位按钮/面板/Models 卡/方法表
    - docs/technicalnew/messaging-and-collaboration.md     # compaction 事件/快照
    - docs/technicalnew/storage-and-recovery.md            # S2 表
    - docs/technicalnew/validation.md                      # 本轮证据与未覆盖
  proposed_for_confirmation: []
  indexes_updated: []
  archived:
    - .agentdev/work/compaction-policy-20261028/plan.md
    - .agentdev/work/compaction-policy-20261028/implementation.md
    - .agentdev/work/compaction-policy-20261028/review.md
    - .agentdev/work/compaction-policy-20261028/test.md
  no_change:
    - docs/technicalnew/agents-and-tools.md               # 未新增模型工具
    - devagent/webapp/src/settings/UsagePage.tsx          # 压缩成本未入账，登记为缺口
  evidence:
    - 两侧 tsc --noEmit 无诊断
    - 服务端 45 文件 469 用例；webapp 12 文件 80 用例；浏览器 59 用例
    - 设置 70→85、关闭自动，刷新/新上下文保持；40% 被拒
    - 自动：100k 窗口、80k usage、阈值 50，第二条输入先 compaction_start/end 再运行并完成
    - 手动：5×40k 历史 → {status:'compacted',tokensBefore:60811,estimatedTokensAfter:30548}，面板 60.8k→30.5k，随后 ?→30.8%
    - 运行中/重启无实例按钮禁用并说明；config/task/activity 未变
    - v15→v16 升级测试断言默认 70/rev1 与 user_version
  risks_remaining:
    - 压缩调用的 tokens/成本未进入用量 ledger（既有缺口）
    - 压缩摘要未加超时/退避；模型不返回时可能占用该会话队列
    - Pi 原生 98% 兜底按 SDK 逻辑核对，未在浏览器实际触发
  completion_gate: passed
```
