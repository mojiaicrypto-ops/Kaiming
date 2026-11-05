# 结算：用量统计（tokens）

2026-10-27。依据 P-07、AC-37、S2（usage_entries / 用量记录的边界）、UI 契约「Usage」。

## 交付

| 层 | 内容 |
|---|---|
| 存储 | `usage_entries`（schema v14，主键 `(inputId,providerId,modelId)`，索引 project/role/model）；`recordUsage`（幂等追加）、`usageReport`（同一 WHERE 三次聚合） |
| 运行时 | 输入结束时把该输入新增的 assistant 响应归并为每模型一行，在输入终态之前一次事务写入；`rollupUsage` 为纯函数，含「全 0 = 未上报」「0 成本 = 无目录价」两条判定 |
| 接口 | `usage.report { projectId? }` → 合计 / 按角色 / 按模型；作用域就是该参数 |
| 界面 | 设置页「Usage」标签页；作用域切换、三张同构表；缺报显示 `—`；≤760px 隐藏缓存/推理分项 |
| 测试 | 单测 13 条（账本 6 + 归并 7）+ 浏览器 1 条（真实对话 → 页面 → 双作用域 RPC） |

## 证据

- 服务端 403 通过 / webapp 57 通过 / 浏览器 56 通过；两侧 `tsc --noEmit` 与 `npm run build` 无错误。
- 实测截图：1280×900（三表列轨道对齐）与 390×844（四列完整，无横向溢出）、320px（表头四标签可达，`scrollWidth == clientWidth`）。
- 一致性：浏览器用例断言项目作用域与全部项目返回相同响应数（同一账本行集）。

## 偏离与未决

- **未做**：历史 `.pi` 回填（P-07 已声明不回填）、按需求/Task 单列、时间区间筛选、预算告警。
- 全量浏览器套件曾有一次 `every screen is usable on a phone` 失败（新增标签页之后），随后单独运行 1 次、全量 1 次、`--repeat-each=3` 均通过，失败产物已被清理，未取到断言信息；按已知偶发处理，未定位。
- 统计依赖服务方上报；网关若恒报 0，则记 NULL 并在界面显示未上报（不伪造数字）。

## 补记（2026-10-27 22:40 之后）

**现场反馈**：重启后开始开发任务，用量页始终为空。

**原因（查现场）**：`usage_entries` 0 行，而 `session_inputs` 中主管输入与成员派发输入都仍是 `processing`（成员已跑十余分钟）。上一版只在**输入结束**时写入，于是"任务在跑"与"没有任何数字"同时成立 —— 长跑成员期间页面必然为空。

**改动**：

1. 每完成一次 assistant 响应（`message_end`，仅 assistant）就 upsert 该输入的**绝对累计值**；输入结束时再写一次最终值；失败的输入在 `finally` 里也写（已完成的响应真实付费）。`INSERT OR IGNORE` → `ON CONFLICT ... DO UPDATE`，重复刷新与重放都不翻倍。
2. 用量页在可见时每 10 秒重读、切回前台立即重读（与需求看板同一模式），长跑中能看到数字增长。
3. 排查过程中发现一个**独立的现有缺陷**：连接断开重连时，快照已含该轮而完成帧仍替换 live 条目，导致同一条回复显示两次（`data-entry-id` 为历史条目与 `live-*` 各一条）。已在 `slot.ts` 的 `message_end` 三条路径统一去重，并补 3 条 reducer 用例。

**新证据**：stub + 真实工具轮 → 写入序列 `[{responses:1,tokens:1},{responses:2,tokens:2},{responses:2,tokens:2}]`，最终 2；真实网关（临时 store）→ `responses=1, inputTokens=9669, outputTokens=2`；单测 404（服务端）+ 60（webapp）；手机用例 `--repeat-each=8` 全绿（修复前 8 次跑出 2 次重复气泡）。
