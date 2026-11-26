# 结算：历史图片归档与 UI 自检边界

日期：2026-11-26
验证档位：`broad`（共享 Pi 上下文装配与提示词契约；不改压缩策略）

## 实际改变

- 新增 `kaiming/src/runtime/history-image-archive.ts`：Pi `context` 事件内只归档已被后续成功 assistant 消息消费的 tool-result 图片；错误/中止 assistant 不归档；user 图片不改写；固定占位符、幂等、无输入变异。
- `kaiming/src/runtime/runner.ts` 为每个 Pi 实例安装该扩展。
- `kaiming/src/tools/browser-tool.ts` 在拒绝 `file:` 时提示临时 loopback HTTP 服务。
- `docs/technicalnew/prompts/developer.md` v10：UI 冒烟上限、截图上限、临时 HTTP 服务、禁止手写 CDP/Electron 自检框架。
- `docs/technicalnew/prompts/chief.md` v14：内容页前置受众/主张/禁用术语对齐；方向成立进 Review；重载上下文另开 developer Session。
- `docs/technicalnew/agents-and-tools.md` 记录历史图片归档边界；`docs/technicalnew/validation.md` 记录证据与未执行项。

## 验证

- `test/history-image-archive.test.ts` 10/10：当前批次保留、成功 assistant 消费后归档、并行工具结果、user 图片负向对照、错误/中止 assistant 不归档、幂等、已归档前缀稳定、新工具批次不改旧前缀、无图/实际归档不修改输入、context handler 注册。
- `test/browser-tool.test.ts` 7/7：`file:` 拒绝文本包含临时 HTTP 服务提示。
- 全量 `npx vitest run`：74 文件 768 通过。
- `npm run typecheck`、`npm run check:prompts` 15/15 通过。
- 未执行真实延迟/缓存对比基准：生产进程未重启，避免打断当前 `t-7adcab264a9c`；需在收口后用副本会话执行并记录实际 tokens/图片数/cacheRead/耗时。
- 独立 Review PASS（无阻断项；非阻断建议已处理大小写 file 提示、实际归档不修改输入、原始工具文本保留、新工具批次前缀稳定、错误/中止 assistant 不归档）；独立 Test Agent 未另行执行，本次证据是开发侧单元与全量回归。

## 边界与未覆盖

- 压缩逻辑未改：仍为 `thresholdPercent × 当前模型 contextWindow`，没有新增固定 token 上限。
- Pi JSONL、附件存储和数据库未改；旧图片字节仍保留，归档只影响模型请求上下文。
- 已归档前缀不再改写，但归档当前工具批次发生在 assistant 回复后的下一次请求；在此之前模型必须看到截图。
- 旧 user 图片全部保留，作为用户证据与缓存稳定性的取舍。
- 提示词按进程缓存；扩展只对新创建/重建的 Pi 实例生效，必须等工作台重启。
- tool-set resume 刷新是独立 P1，不在本次改动内。
- 当前 `t-7adcab264a9c` 和 `s-afea47c3` 未被重启或改写；等待收口后转 Review。
