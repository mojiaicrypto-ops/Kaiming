# Test · compaction-policy-20261028

独立测试（独立上下文；真实 workbench + 真实 Chromium + 脚本化 provider；临时 spec 用完删除）。

## 结论：passed

```yaml
test:
  task: compaction-policy-20261028
  environment: >
    darwin 25.5.0 / Node 24.8 / Playwright 1.64 Chromium；startWorkbench 进程内（port 0、临时 dataDir）；
    默认 stub provider，另用临时 SSE provider 声明 contextWindow=100000、prompt_tokens=80000 验证自动/手动压缩。
  runs:
    - command: npm run typecheck / npm --prefix webapp run typecheck
      result: passed
      evidence: 两侧 tsc --noEmit 无诊断
    - command: npx vitest run
      result: passed
      evidence: 45 文件 469 用例
    - command: npm --prefix webapp test
      result: passed
      evidence: 12 文件 80 用例
    - command: npm run build + npx playwright test
      result: passed
      evidence: 59 用例（含设置卡保存/回读、手动面板）
    - command: 设置持久化（刷新 + 新浏览器上下文 + 非法 40%）
      result: passed
      evidence: 默认 70/on；保存 85/off 后刷新与新上下文均保持；40% → INVALID_ARGUMENT；值未变
    - command: 空闲面板“立即压缩”（小会话）
      result: passed
      evidence: 面板显示读数/Pi 兜底/估算说明；点击返回 “Nothing to compact right now.”；revision/activity/config 未变
    - command: 运行中禁用
      result: passed
      evidence: 挂起回复时按钮 disabled，提示 “Stop the current run before compacting.”；STOP 后 idle
    - command: 重启后无实例
      result: passed
      evidence: 面板 `— / 100k`、`?`、按钮 disabled，提示先发消息；消息数 3→3
    - command: 自动压缩（window 100k、usage 80k、阈值 50，两条输入）
      result: passed
      evidence: >
        第一条事件 agent_start…agent_settled；第二条先 compaction_start/compaction_end（reason=manual）再 agent_start…；
        两条输入 completed；快照 context {tokens:80010,contextWindow:100000,percent:80.01,autoCompaction:true,live:true}；
        agentDir/settings.json 不存在（Pi 默认兜底仍开启）；session revision/activity/config 未变
    - command: 真实成功手动压缩（5×40k 字符历史）
      result: passed
      evidence: >
        meter 60.8k/100k · 60.8%；session.compact 返回
        {status:'compacted',tokensBefore:60811,estimatedTokensAfter:30548}；面板 “Compacted 60.8k → 30.5k tokens.”；
        随后 meter `? / 100k`，下一次响应恢复 30.8k/100k；config.get 一致、session revision=1、tasks=0
    - command: 清理 + git status
      result: passed
      evidence: 临时 spec、进程、/tmp 目录清除；工作树与测试前一致
  not_covered:
    - area: Pi 原生近上限兜底压缩实际触发
      reason: 探针保持在 80.01%（低于 100k−16k=83.6k）；只验证 enabled 状态与 settings.json 未被改写
      disposition: accepted
    - area: 首次进行中运行的“压缩中”禁用提示
      reason: 纯挂起首轮没有 assistant message_end，面板仍显示无实例原因；运行中检查在已结束一轮后进行
      disposition: accepted
    - area: 压缩 tokens/成本进入用量 ledger
      reason: 计划内范围外，已登记为已知缺口
      disposition: accepted
  result: passed
```
