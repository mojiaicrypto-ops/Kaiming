# Test · context-meter-20261028

独立测试（独立上下文；真实 workbench + 真实 Chromium + 脚本化 provider；临时 spec 用完删除）。

## 最终结果：passed

```yaml
test:
  task: context-meter-20261028
  environment: >
    darwin 25.5.0 arm64 / Node 24.8 / Playwright 1.64 Chromium；startWorkbench 进程内（随机端口、临时 dataDir），
    stub provider stub/stub-1（128k 窗口）；另有报告用量递增的临时 provider（12,010 → 38,010）验证读数变化。
  runs:
    - command: npm run typecheck / npm --prefix webapp run typecheck
      result: passed
      evidence: 两侧 tsc --noEmit 无诊断
    - command: npx vitest run（连续 7 次）
      result: passed
      evidence: 43 文件 453 用例；其中一次早期尝试出现 1 个未捕获名的偶发失败，随后连续 7 次全绿
    - command: npm --prefix webapp test
      result: passed
      evidence: 12 文件 79 用例（context-meter 4、slot 19）
    - command: npm run build
      result: passed
      evidence: vite 构建成功；产物含 ≤860 收紧、≤560 只留百分比、≤480 隐藏分支、≤400 隐藏运行计数、模型 .1 收缩与提示先让位
    - command: 真实浏览器桌面，一条消息
      result: passed
      evidence: status-model `stub/stub-1`；meter `2 / 128k · 0.0%`；title `Context: 2 / 128k tokens (0.0%) · estimated · auto-compaction on`；role=meter
    - command: 真实浏览器第二轮（用量递增 provider）
      result: passed
      evidence: turn1 `12k / 128k · 9.4%` → turn2 `38k / 128k · 29.7%`；两次 context 帧
    - command: 真实重启（同一 dataDir 两次 startWorkbench）
      result: passed
      evidence: 第一次 prepare `{tokens:2,contextWindow:128000,percent:0.00156,autoCompaction:true,live:true}`；重启后 `{tokens:null,contextWindow:128000,percent:null,autoCompaction:null,live:false}`；config.get 三次完全一致
    - command: 手机窄屏（390/320，含运行中计数 + 连接词注入）
      result: passed
      evidence: 390/320 meter 可见且只显示百分比；≤480 分支隐藏、≤400 运行计数隐藏；模型名完整；conn 右边 ≤ 状态栏右边；document/status scrollWidth == clientWidth
    - command: 拥挤 + 长模型名（401/430/480/561/650/861）
      result: passed
      evidence: 连接词全部在栏内（401 393≤401、561 545≤561、861 813≤861）；模型 88–184px；提示先收缩到 0；无溢出
    - command: 永久浏览器套件
      result: passed
      evidence: 57 用例全绿（一次无关的设置页用例偶发失败，隔离与重跑均通过）
  not_covered:
    - area: 真实触发压缩后的 `? / 窗口`
      reason: 没有公开 RPC 可强制压缩；SSR 单测覆盖 `? / 1M`
      disposition: accepted
    - area: 真实 70%/90% 颜色
      reason: 需要接近窗口上限的真实上下文；SSR 单测覆盖 warn/danger
      disposition: accepted
    - area: 真实成员运行 + 真实断线（而非注入节点）
      reason: harness 保持单连接；几何用注入同形节点测量
      disposition: pending
    - area: 中文字符串在窄屏的实际宽度
      reason: 仅测英文；中文更窄但未实测
      disposition: accepted
  result: passed
```

## 曾发现并已修复的真实缺陷

- 401–440 带宽 + 运行计数 + 连接词时模型名被省略到 61px：≤480 隐藏分支后恢复 79.5px。
- 长模型名达到 28vw 时，`flex-shrink:0` 会把连接词挤出（401–650）：改为 `flex-shrink:0.1`，提示先让位，连接词始终在栏内。
- 561–575 连接词被挤出：间距收紧从 ≤560 扩到 ≤860。

## 测试方法说明

`message_end` 对 user/tool/assistant 每条消息都会发出；`workbench-entry` 的“跑完立刻读历史”因此可能早于 assistant 落盘，已改为有界轮询同一读取（保留 60s 超时），不是放宽断言。
