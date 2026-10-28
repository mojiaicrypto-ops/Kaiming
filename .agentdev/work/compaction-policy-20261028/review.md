# Review · compaction-policy-20261028

独立复核（只读、独立上下文，不读开发对话）。复核覆盖 runner 锁/认领/交付、停止路径、store v16、RPC、前端 slot/面板/设置卡、Pi SDK `compact()`/`isCompacting`/事件配对。

## 结论：passed（无阻断；5 条非阻断全部处理）

```yaml
review:
  task: compaction-policy-20261028
  reviewer_session: subagent-review-compaction-policy
  reviewer_model: group-volc-plan/group/auto-deepseek-v4-1-flash
  context_snapshot: 未提交 29 文件（含 3 新）+ Pi SDK compact/isCompacting/abort；逐项核对 C-03、AC-44、R1/M4、UI 与 plan
  findings:
    - severity: non-blocking
      location: devagent/test/compaction-runner.test.ts
      evidence: 只直接测 compactIfDue/compactManually，runNext 认领→压缩→交付、压缩中 stop、interrupted recovery 无回归用例
      impact: 顺序或停止路径退化不会被测试发现
      remediation: 增加 runNext 两例 + recovery 一例
    - severity: non-blocking
      location: devagent/webapp/src/app/ContextMeter.tsx
      evidence: 面板“自动压缩”显示的是 Pi 的 autoCompactionEnabled，而设置卡控制的是主动策略；关闭后两处不一致
      impact: 用户分不清哪层开启
      remediation: 面板改称“Pi 兜底压缩”
    - severity: non-blocking
      location: devagent/src/runtime/runner.ts
      evidence: liveRuns 在压缩前设置，但压缩中 stop 的提前返回未清理 liveRuns/hostAborts
      impact: 事件可能挂到已结束输入；标记残留
      remediation: 提前返回前删除两项
    - severity: non-blocking
      location: devagent/test/store.test.ts
      evidence: 缺 v15→v16 升级测试
      impact: 老数据目录升级只在推理中成立
      remediation: 增加升级测试
    - severity: non-blocking
      location: docs/technicalnew/validation.md、storage-and-recovery.md
      evidence: 未记录本轮验证/未覆盖；S2 表缺 compaction_settings
      impact: 证据链与存储基线不完整
      remediation: 补 validation 与 S2 行
  questions:
    - store 范围 1–99 vs 产品 50–95
    - 产品文案“受理前”实际是认领后
    - 停止排队输入是否应 abort 压缩
    - 压缩摘要无超时
    - 面板无焦点陷阱
  result: passed
```

## 处理

| 发现 | 处置 |
|---|---|
| 缺 runNext/stop/recovery 测试 | 增加 `runFixture`：认领后压缩、压缩中 stop 记为 stopped、interrupted → recovery |
| 面板“自动压缩”歧义 | 中英文改为 “Pi 兜底压缩 / Pi backstop compaction”；面板 `role=group` |
| liveRuns/hostAborts 残留 | 压缩中 stop 的提前返回前清理两项 |
| 缺 v15→v16 测试 | 删除表并置 `user_version=15` 后重开，断言默认 70/rev1 与版本 |
| 文档缺口 | validation 增加本轮章节；S2 增加 `compaction_settings` |
| store 范围 | 收敛为 50–95，与产品一致 |
| 文案 | 改为“下一条消息执行前（认领后、交付前）”，并注明重启首条不触发 |
| 排队停止 abort | 仅 processing 输入才 abort，避免取消无关压缩 |
| 摘要超时 | 本轮未加；写入 validation 未覆盖 |
| 焦点陷阱 | 面板是轻量 popover，用 `role=group` + `aria-expanded`，不再声称 dialog |
