# Plan: 用量统计（tokens）

依据：`docs/productnew/modules/project-workspace.md` P-07、`docs/productnew/acceptance.md` AC-37、
`docs/technicalnew/storage-and-recovery.md`（S2 usage_entries、S2 用量记录的边界）、
`docs/technicalnew/ui-design.md`（设置页「用量」）。

## 记录方案（回答「不能实时入库」）

用量只以「服务方上报的响应」为单位可得，一次用户输入内会有多次响应（工具循环）。因此不在流中写库：

1. 输入 claim 后记录 Pi 历史的 `messages.length`；
2. 输入结束时取新增的 assistant 消息，按响应自带 `provider`/`model` 归并累加；
3. **在写输入终态之前**，向 `usage_entries` 追加每个 (input, role, model) 一行，`(inputId,providerId,modelId)` 唯一 + INSERT OR IGNORE，崩溃重放不重复计数；
4. 统计一律由 GROUP BY 得出，不维护累加计数器（避免并发丢更新与不可回溯）。

热路径写入次数：每次输入 1 个事务、行数 = 本次用到的 (角色,模型) 组合数。

## 工作项

| # | 变更 | 文件 |
|---|---|---|
| 1 | schema v14：`usage_entries` 表 + 两个索引；`migrateV13ToV14` 幂等建表 | `src/store/store.ts` |
| 2 | `recordUsage()`（幂等追加）与 `usageReport()`（合计/按角色/按模型） | `src/store/store.ts` |
| 3 | 输入结束时聚合响应用量并记录，失败不改变输入终态 | `src/runtime/runner.ts` |
| 4 | RPC `usage.report`（作用域：可选 projectId） | `src/server/methods.ts`、`src/server/main.ts` |
| 5 | 设置页新增「用量」标签页：作用域切换 + 合计 + 按角色/按模型两张表 | `webapp/src/settings/UsagePage.tsx`、`SettingsPage.tsx`、`router.ts`、i18n、`base.css` |
| 6 | 单测：幂等、项目过滤、按角色/模型合计 | `test/usage.test.ts` |
| 7 | 浏览器用例：stub 模型真实跑一轮对话后，用量页出现对应响应数/tokens，切换作用域不串项目 | `browser/acceptance.spec.ts` |

## 口径

- 合计 = Σ 响应上报值；`responses` = 归并的响应次数（一次模型请求一次）。
- 缺失用量的响应记 NULL；界面显示「未上报」，不使用 0。
- 成本 = 响应 `usage.cost.total`（目录价），界面标注「按目录价估算」。
- 不回填历史 `.pi`。

## 验收

AC-37；单测覆盖幂等与作用域；浏览器覆盖真实对话后的读取。
