# 历史图片归档与页面自检边界

日期：2026-11-26
验证档位：`broad`（共享 Pi 上下文装配 + 角色提示词契约；不改压缩策略）

## 目标与验收

修复长期会话中工具截图不断累积、每轮重复送入模型导致延迟雪崩的问题，并收紧内容页的前置口径与开发自检边界。压缩仍按现有 `thresholdPercent × 当前模型 contextWindow` 工作，不新增固定 token 上限。

验收：

1. 所有 user-role 图片永不因归档被改写；最近一个尚未被 assistant 回复消费的工具结果批次图片保留，其他 tool-result 图片替换为固定文本占位符。
2. 归档发生在 assistant 回复后的下一次请求；替换只发生在历史尾部，已归档前缀不再变化，重复调用幂等。
3. 归档不修改 Pi JSONL、不修改数据库、不删除原始图片字节；占位符不含时间戳、计数或动态 ID。
4. `browser(open)` 拒绝 `file:` 时，错误文本提示使用临时 HTTP 服务。
5. Developer 提示词限制 UI 冒烟为一条核心入口、最多 1–2 张截图；Chief 提示词要求内容页建 Plan 前对齐受众/主张/禁用术语、方向成立后进 Review、返工重载时新开开发 Session。
6. 不修改 compaction 阈值/设置/UI；不处理 tool-set resume bug（另列 P1）。

## 依据与已确认决定

- 用户 2026-11-26 实测：同一模型纯文本 168K/0 图约 3.6s；5 图约 19.9s；7–8 图约 43–74s；37 图约 184–205s；单图约 957 tokens，缓存命中率 98.72%。因此瓶颈是图片张数，不是图片 token 总量。
- 用户 2026-11-26 定稿：工具图“看后即归档”，保留最近 1 个工具结果批次；旧 user 图片不改写；不改 `.jsonl`/DB。
- 用户 2026-11-26 定稿：压缩继续按配置百分比 × 模型窗口，不加固定 160/200K 上限。
- 现有代码：`src/runtime/runner.ts:589-601` 把新输入图片交 `prompt()`；`src/runtime/runner.ts:833-875` 已为每个 Pi 实例注册扩展工厂。Pi SDK 的 `context` 事件可在每次 LLM 调用前替换消息。
- 非目标：不重启当前 `t-7adcab264a9c`，不恢复或续接 `s-afea47c3`；工具集 resume 刷新另立 P1。

## 实现范围

- 新增 `kaiming/src/runtime/history-image-archive.ts`
  - 纯函数从消息序列计算归档结果：找到最后一条 assistant 消息；仅当其后的 tool-result 图片保留，其余 tool-result 图片替换为固定文本占位符；user 图片保持原样。
  - 提供 `ExtensionFactory` 注册 `context` 事件；返回新消息对象，不原地修改输入。
  - 固定占位符常量；已归档内容不再次变化。
- `kaiming/src/runtime/runner.ts`
  - 在现有 `extensionFactories` 列表中无条件安装归档扩展。
- `kaiming/src/tools/browser-tool.ts`
  - 拒绝 `file:` 时在错误文本中提示临时 HTTP 服务。
- `docs/technicalnew/prompts/developer.md`
  - UI 冒烟上限、截图数量、临时 HTTP 服务、禁止手写 CDP/Electron 自检框架。
- `docs/technicalnew/prompts/chief.md`
  - 内容/宣传页前置受众与核心主张对齐；方向成立直接进 Review；重载或大改时新开 developer Session。
- 测试：
  - `kaiming/test/history-image-archive.test.ts`：user 图片保留、工具图最近批次、assistant 回复后归档、固定占位符、幂等、旧前缀稳定性、无图片不变、并行工具结果批次、负控制。
  - `kaiming/test/browser-tool.test.ts`：`file:` 错误包含临时 HTTP 服务提示。
  - `npm --prefix kaiming run check:prompts`、`npm --prefix kaiming run typecheck`、相关 vitest 文件。
- 文档结算：`docs/technicalnew/agents-and-tools.md` 的图片输入/上下文边界，`docs/technicalnew/validation.md` 记录证据；提示词 header 版本随正文更新。

## 缓存前缀约束

归档选择只依赖消息角色与顺序，不依赖滑动计数：

```text
lastAssistant = 最后一条 assistant 消息下标
user 图片：保留
toolResult 图片：
  index > lastAssistant → 保留（模型尚未回复这一批）
  index <= lastAssistant → 固定占位符（模型已经回复，下一轮归档）
```

因此下一轮只改写刚被消费的工具批次（靠近末尾），不会因第 9 张图到来而改写历史中段；已归档文本永不再改。

## 验证与风险

- 单元测试必须包含负控制：已归档内容重复处理不再变化；user 图片不被改；无图片时返回未变更。
- 前缀稳定性测试按连续消息序列比较归档前后的前缀，确认只改最近工具批次。
- 真实延迟/缓存基准在代码落地、工作台重启后使用副本会话执行；本 Task 先交付可运行的归档与单元证据，当前生产进程不重启。
- 风险：最近一次工具批次在 assistant 回复前的请求中仍会携带图片；这是模型查看截图所必需的，归档后回到 0–2 张。
- 风险：`context` 扩展必须轻量且只做数组/内容替换；不引入持久化状态或每轮扫描之外的工作。
