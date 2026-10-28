# Plan · 状态栏显示主管会话的上下文占用（context-meter-20261028）

日期：2026-10-28。用户已确认三项交互决定：位置=状态栏模型区；范围=只显示上下文占用；未知=显示 `— / 窗口`。

## 1. 目标与验收

用户在与主管对话时，能从状态栏看到当前会话所用模型的上下文窗口和已用占用，不需要打开设置页或读日志。

| # | 可观察结果 | 依据 |
|---|---|---|
| A1 | 状态栏模型区显示 `provider/model · 已用 / 窗口 · 百分比`，例如 `616.9k / 1M · 61.7%` | C-03（新增）、AC-43 |
| A2 | 每次 assistant 响应与压缩后占用自动更新，无需刷新 | M4（context 通知） |
| A3 | ≥70% 用 warning 色、≥90% 用 danger 色；百分比文字始终存在 | UI U2 |
| A4 | 压缩后到下一次响应前显示 `? / 窗口`；本进程无实例时显示 `— / 窗口`，不拿历史值冒充 | C-03、AC-43 |
| A5 | 重启后首次打开会话能看到窗口与未知标记；下一次运行后恢复实时值 | AC-43 |
| A6 | 窄屏 `≤860` 收紧间距、`≤560` 只留百分比（未知时保留 `— / 窗口`）、`≤480` 隐藏分支、`≤400` 再隐藏运行中计数，保留模型、读数与连接状态；查看不改变任何设置 | UI U2 |
| A7 | 观测失败不影响运行：取占用抛错只丢一帧，run 照常完成 | 运行契约 R4/M4 |

## 2. 范围

**范围内**

1. `contextUsageOf`/`contextNoticeOf`/`windowOnlyContext`：活实例的估算、窗口-only 回退、事件触发条件。
2. 流快照 `context` 字段；`context` 顶层业务通知（携带数值，不触发二次查询）。
3. `main.ts` 装配：活实例优先；无实例时按上次运行模型（否则当前设置）取窗口；`message_end`/`compaction_end` 后以 microtask 发布，避开 Pi 先广播后落盘的顺序。
4. 前端：`ContextMeter`、状态栏接入、slot 状态、i18n、CSS 断点。
5. 文档：C-03、AC-43、UI U2、M4、R1 快照字段。
6. 测试：`context-usage`、server-stream 快照/通知、workbench-entry 重启、webapp slot、meter SSR、状态栏浏览器用例。

**范围外**

- 本会话累计 tokens/成本（用户选择只做上下文占用；`getSessionStats` 与 ledger 是另一事实）。
- 成员会话/Task 抽屉的占用显示、设置页新增会话级用量。
- 手动压缩按钮、压缩阈值配置。
- 重启后用历史最后响应估算（用户选择如实未知）。

## 3. 实施步骤

| 步骤 | 变更 | 路径 |
|---|---|---|
| S1 | 上下文读取与通知判定（纯函数） | `src/runtime/context-usage.ts` |
| S2 | 快照带 `context`；prepare 改 async | `src/server/stream-methods.ts` |
| S3 | 装配：活/冷两条读法；assistant/compaction 后 microtask 推通知 | `src/server/main.ts` |
| S4 | `context` 作为顶层业务帧 | `src/server/http.ts` |
| S5 | 协议类型、slot 状态与合并、状态栏与 meter、i18n、CSS（560 以下只留百分比，不在 400 隐藏） | `webapp/src/{api,state,app,i18n,theme}` |
| S6 | 测试与文档 | `test/*`、`webapp/test/*`、`browser/acceptance.spec.ts`、`docs/*` |

## 4. 验证

- `npm run typecheck`、`npm --prefix webapp run typecheck`
- `npx vitest run`（服务器）与 `npm --prefix webapp test`
- `npm run build` + `npx playwright test -g "status bar names the model"`；状态栏截图人工核对
- `npx playwright test`（全量浏览器，若时间允许）
- 重启场景：workbench-entry 用同一 dataDir 起两次，第二次快照 `context.live=false`、窗口 > 0

## 5. 风险与回滚

- **估算不是计费**：tooltip 明确 `estimated`；不显示成本。
- **压缩窗口期**：tokens/percent 为 null，UI 用 `?`，不沿用旧值。
- **事件顺序**：Pi `message_end` 先广播后 `appendMessage`；占用计算放到 microtask，避免延迟落盘；并用 try/catch 保证观测不破坏运行。
- **性能**：占用计算是投影遍历，仅在响应/压缩后触发与 prepare 时读取，不在轮询里。
- **无实例**：`factory.facts` 只读目录，忽略失败；无窗口则整体不显示。
- **回滚**：删除 `context` 帧/字段与 UI 即回到原状；无 schema、无迁移、无数据写入。

## 6. 已知测试调整

`test/workbench-entry.test.ts` 原本在收到任一 `message_end` 帧后立即读历史；而 Pi 对 user/tool/assistant 每条消息都发 `message_end`，该帧可能早于 assistant 落盘。本轮改为有界轮询同一读取，直到 assistant 消息出现，并保留 60s 超时；不是放宽断言。
