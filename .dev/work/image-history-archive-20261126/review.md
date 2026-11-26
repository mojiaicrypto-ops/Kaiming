# 独立 Review 记录

日期：2026-11-26
对象：`image-history-archive-20261126` 的 runtime 扩展、browser hint、prompts 与测试。
审查者：独立 reviewer（只读，不编辑/不提交）

## 结论

PASS：未发现阻断项。核心策略与 Pi `context` 事件合同一致，请求级归档不改 JSONL/DB/附件，扩展在生产 session 创建路径上无条件安装。

## 非阻断建议与处置

1. `file:` 提示原按精确小写前缀判断；`FILE://` 不带提示。已改为 trim + 小写判断，并补 uppercase 测试。
2. “不修改输入”原只测无归档路径。已补实际归档路径的 `structuredClone`，确认原数组与消息不变。
3. 未断言工具结果原有文字保留。已补原始 `screenshot 1` 文本仍存在。
4. 前缀稳定性原只测追加 user 文本。已补追加新工具批次图片，确认旧归档前缀不变、新批次保留。
5. 错误/aborted assistant 原也计数为“已消费”。已改为只认成功 assistant，并补错误/中止负向测试。
6. Plan 与 prompts 关于“重载另开 session”的措辞略有强弱差异；保留 prompt 的条件式表述，不构成行为冲突。

## 未覆盖

- 审查者未重新运行 `tsc`/vitest/`check:prompts`；验证记录中的数字来自开发侧实际执行。
- 真实延迟/缓存基准仍需工作台重启后的副本会话执行。
