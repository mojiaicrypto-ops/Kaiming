# Plan · 会话转录 TUI 化 + 工作流全量展示

```yaml
plan:
  task: chat-tui-flow-20261025
  date: 2026-10-25
  status: Approved (用户本轮对话逐图确认)
  basis:
    - docs/technicalnew/ui-design.md（U2/U3/U5 现行契约，本轮修订）
    - docs/technicalnew/gap-register.md（Q1–Q4 待改项）
    - 用户确认的视觉定稿：/tmp/tui-omp2.png（omp 平铺转录 + 产品骨架 + 列式问题区）
  goal: >
    聊天屏按确认稿重排：全站等宽、转录为无框事件流（❯ 用户行 / 斜体思考 /
    纯 Markdown 正文 110ch 软上限 / 单行工具事件）、问题选项改列排序；
    工作流展示改为「一块任务清单」：显示该 Task 全部成员（按阶段-轮次分组，
    返工可见），顶部任务条阶段链带轮次标记，Plan 在清单头部可展开。
```

## 0. 非目标

- 不改 RPC 方法集合、WAL/存储、Pi 接入；`task.get` 成员数组本就按 `createdAt` 排序（store.ts `listTaskSessions`），轮次在前端派生，服务端零改动。
- 不改问题面板键盘交互（数字直选/↑↓/Enter/Esc）与答复回显逻辑，只改选项布局。
- 不动需求屏、设置屏、登录屏结构（字体随令牌全局变化）。
- 不新增「未来阶段」预测：没派发过的阶段不画（ui-design U5 既有决定），全量意图由 Plan 展开承载。

## 1. 定稿依据（用户逐轮确认）

| 决定 | 来源 |
|---|---|
| 全站等宽（中文用 PingFang 等回退） | 「全站等宽(推荐)」方向 + omp 对照 |
| 转录无框平铺：无 who 头、无边栏线 | omp TUI 截图模拟确认 |
| 满宽 + 110ch 软上限（仅散文） | 「满宽 + 软上限 110ch」 |
| todo 块内联在日志流、一个 Task 一块 | v2 确认 |
| 顶部产品骨架（三屏导航 + 会话列）不动 | 「上面的布局,不符合现在的整体需求」后回归产品结构 |
| 问题选项列排序、长文案可换行 | 本轮指令 |
| 工作流显示全部成员 + 返工轮次 | 本轮指令 |

## 2. 文件级改动

### A 令牌与排版

| 文件 | 改动 |
|---|---|
| `webapp/src/theme/tokens.css` | `--font` 改为等宽族（JetBrains Mono → … → PingFang SC → Microsoft YaHei → monospace），删除双族说明；行高 1.75 |
| `webapp/src/theme/base.css` | 消息区重写：删 `.m .who`/`.m .body` 边栏结构、`.live-run`、`.disp`；新增 `.m.user` 的 `❯` 行、`.md` 110ch 软上限、`.todo` 清单、`.think` 斜体暗色单行、`.tc` 单行工具事件精修、`.ask-o` 列式选项（`.ao` 网格 22px+1fr、可换行）、`.tx-in` 满宽 padding、断点规则同步（≤860 mrow 收窄、ao 行高、todo 内边距） |

### B 转录结构

| 文件 | 改动 |
|---|---|
| `webapp/src/chat/MessageItem.tsx` | 删 `.who` 头；user 渲染为 `❯` + 正文（fg-2）；assistant 块直接铺；保留 `article.m.{role}` 类名与 `data-entry-id`（浏览器用例选择器不破） |
| `webapp/src/chat/ThinkingBlock.tsx` | 不改逻辑；样式由 CSS 承担（斜体 fg-3 单行，展开正文同色） |

### C 工作流全量展示（核心）

| 文件 | 改动 |
|---|---|
| `webapp/src/chat/TaskTodo.tsx`（新，替代 `TaskLive.tsx`） | 一块 = 头部（Task 号可点 · 当前阶段 · 进度 m/n · 状态）+ 可展开 Plan（N 行）+ 成员清单按「阶段-轮次」分组。分组算法：按 `detail.members`（createdAt 序）游走，同阶段连续为一段，阶段重现即新轮（`开发 ×2`）；`task.phase` 与末段不同则补一段（未派发显示「等待派发」）。行状态：等你回答 ◆ / 运行中 ● / 排队 · / 已结束 ✓ / 未通过 ✗ / 空闲 ○；**返工**：成员已有报告且又在运行 → `↻` 前缀 + 「返工」；未通过成员行染 block 色保留（触发返工的证据）。行可点开成员抽屉。`data-testid` 沿用 `task-live`/`task-live-members`/`task-member-row` |
| `webapp/src/chat/TaskLive.tsx` | 删除（`TaskMemberRows` 移入 TaskTodo，按新行结构重写：符号列 + 角色 + 说明 + 右侧备注） |
| `webapp/src/chat/ToolTask.tsx` | `create` 分支折叠为单行 `✓ Task created · T-xxxx · N 行 Plan ›`（展开是 Plan 原文，Q3）；`dispatch` 分支恒为单行（符号 + 派发句 + 成员名 + 耗时，展开是真实结果），删除展开成员面板与 `useRunningFor`/live 判定（D15 残余：成员行唯一来源 = TaskTodo）；`update`/`end` 事件行不变 |
| `webapp/src/chat/TaskStrip.tsx` | 阶段链由 `chainOf`（去重）改为**阶段-轮次序列**：成员阶段按序分段 + 当前阶段，同阶段多次进入显示 `×n`；其余不变（文档 Task 无重复 → 输出与旧一致） |
| `webapp/src/chat/ChatPage.tsx` | 删 `liveCallId`/`liveRun`（TaskTodo 恒为运行中 Task 的唯一成员面板）；新增从转录扫最新 `task create` 调用取 `planMarkdown` 传给 TaskTodo；`TaskLive` 引用换 `TaskTodo` |

### D 文案

| 文件 | 改动 |
|---|---|
| `webapp/src/i18n/catalog.ts` | 新键（双语）：`task.planLines`（`{count} 行 Plan`）、`task.round`（`第 {n} 轮`）、`task.rework`（`返工`）、`task.waitingDispatch`（`等待派发`）、`task.todoProgress`（`{done}/{total}`）；`web-i18n-keys` 门禁保持一致 |

### E 测试

| 文件 | 改动 |
|---|---|
| `browser/acceptance.spec.ts` | 「派发折叠」用例：断言派发卡无成员行不变（更简单）；「task-live」用例：改为断言 todo 块在刷新后显示**全量成员分组**（含轮次分组与返工标记的可观察类名）；其余用例选择器未变（`.m.user`、`.m.chief .md`、`task-strip`、`task-pause` 保留） |
| `browser/smoke.spec.ts` | 任务条用例补断言：同阶段两次进入显示 `×2`（用 stub 派发两轮 develop） |
| 新增浏览器用例 | ① 长选项文案换行不溢出（列式问题面板）；② 返工场景：develop → review 未通过 → 再 develop，todo 显示两段 develop + review 未通过行 |

### F 文档（随代码提交）

| 文档 | 改动 |
|---|---|
| `docs/technicalnew/ui-design.md` | U3 字体行改等宽族；U5 重写「消息/思考/工具卡/任务条/派发卡片/当前步骤块」行为：消息无头、工具单行、`task-live` 改述为「任务清单（全量成员、阶段-轮次、返工）」、问题选项列排序 |
| `docs/technicalnew/gap-register.md` | Q1/Q2/Q3/Q4 标已关闭（以本抄件关闭）；补记 D15/D16 后续（成员行唯一来源收敛到任务清单） |
| `docs/technicalnew/validation.md` | 本轮证据：浏览器全量 + 截图 |

## 3. 步骤

1. A：tokens + base.css 重写（先消息/工具/todo/ask 四段），本地起服务截图核对定稿。
2. B：MessageItem/ThinkingBlock 结构与样式对齐。
3. C：TaskTodo 新建、ToolTask 收敛单行、TaskStrip 轮次、ChatPage 接线；截图核对返工场景（stub）。
4. D：i18n 键。
5. E：浏览器用例更新 + 新增；`npm run test:browser` 全绿。
6. F：文档 + 结算。

每步完成 = `npm --prefix webapp run typecheck` 通过 + 该步可观察（截图/用例）。

## 4. 验证

| 项 | 命令 | 判据 |
|---|---|---|
| 类型 | `npm --prefix webapp run typecheck`、`npx tsc -p tsconfig.json --noEmit` | 无输出 |
| 文案 | `npm test -- web-i18n-keys` | 两语键一致 |
| 浏览器 | `npm run test:browser` | 全部通过（含新增 3 条） |
| 截图 | todo 运行态/返工态、问题列式长文案、满宽转录 | 与定稿一致 |
| 回归 | 既有用例不跳过不减速 | 全绿 |

## 5. 风险

| 风险 | 缓解 |
|---|---|
| 等宽中文在 Windows 回退丑（微软雅黑不等宽） | 字族把 PingFang/雅黑排在中日文回退位，英文数字仍等宽；验收看 macOS/Chromium |
| 删 who 头后浏览器用例大面积红 | 保留 `article.m.{role}` 与既有 testid；先全量跑一遍定位 |
| 轮次派生依赖 createdAt 排序 | store `ORDER BY createdAt, sessionId` 已是合同；用例断言分组顺序 |
| 派发卡不再展开成员，D16 刷新场景漏信息 | TaskTodo 恒渲染（不依赖转录调用存在），用例覆盖刷新后可见 |
