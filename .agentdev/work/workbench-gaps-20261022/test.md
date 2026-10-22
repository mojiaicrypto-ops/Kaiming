# Test · workbench-gaps-20261022

日期：2026-10-22。环境：macOS darwin 25.5.0 / Node 24.8.0 / Chromium（Playwright）/ 真实 workbench 进程 + scripted 模型端点。

## 运行

| 命令 | 结果 | 证据 |
|---|---|---|
| `npx tsc -p tsconfig.json --noEmit`（服务端） | passed | 无输出 |
| `npm --prefix webapp run typecheck` | passed | 无输出 |
| `npm test` | passed | 26 文件 / 299 用例 |
| `npm --prefix webapp test` | passed | 3 文件 / 25 用例 |
| `npm run build` | passed | `web-static/index.html` + 1 CSS + 1 JS |
| `npm run test:browser`（先 build） | passed | 26 用例 |

## 新增/修改的单测与集成用例

| 文件 | 断言 |
|---|---|
| `test/server-read.test.ts` | `session.list`：标题派生与 60 码点截断、无输入为 null、activity 三态、分页与越界 cursor；`session.get` 的 `stopping`/`config`（含不含 `agentDir`）；`project.list`：计数、缺失目录、排序、分页、越界 cursor、只读不登记；`project.get` 不含 `tasks`；`input.get.effectiveConfig` 白名单；`session.messages.list` 的 `before` 与 `previousCursor`（含同时给 cursor 与 before 报错、未知 before 报错）；rebind 无引用可执行、伪造引用被拒、进行中工作被拒 |
| `test/task-tools.test.ts` | create/update 各发布一次 `onTaskChange`；`get` 与拒绝不发布；省略 `authorizationRef` 时引用本次运行的用户输入（`input:<inputId>`） |
| `test/web-i18n-keys.test.ts` | RPC 方法名从服务端注册表派生（不再手写清单），`project.list` 不再被误判为缺失文案 |
| `webapp/test/chat-model.test.ts` | 删除 `deriveTitle` 两组用例（标题改由服务端派生） |

## 浏览器用例（真实服务 + 真实 Chromium）

新增 11 条，合计 26 条：

| 用例 | 覆盖的缺口 |
|---|---|
| the model scope switch changes what is saved, not only what is read | D1：项目范围写 `{projectId}`，全局角色覆盖未被改写 |
| a requirement hands off to the chat without sending anything | D2：跳转 + 预填，`article.m` 计数为 0（未发送） |
| a specialist report opens from the task detail, with the body it really wrote | U2：真实 dispatch → 成员 `agent_report` → 报告正文出现在抽屉且不在转录里 |
| the project files open in a read-only viewer, and a binary file says so | U1/U7：知识入口打开 `AGENTS.md`；二进制文件给说明 |
| the transcript can ask for older messages and stops at the beginning | U10：`before` 分页；到最早时按钮消失、无重复 |
| a moved directory is rebound from the menu and keeps its records | U3：目录缺失行 → 重绑定 → 顶栏跟随新路径 |
| the board lists the project Tasks and links to the conversation that runs one | U6：任务段显示目标与本地化状态，点击回到协调会话 |
| a modal keeps keyboard focus inside, and gives it back when it closes | D3：20 次 Tab 不逃出遮罩；Esc 后焦点回到触发按钮 |
| an unreadable directory says why in the interface language | P3：错误码先给本地句子 |
| a blocked run names the missing model instead of printing its code | D6：阻断横幅不显示 `blocked_config` |
| the status bar names the model the work actually used | U8：状态栏显示 `stub/stub-1` |
| a Task the chief creates mid-run appears without a reload（改写） | S3：只有在收到推送时任务条才可能出现（轮询在知道 id 之后才启动） |

## 手工验证

| 项 | 方式 | 结果 |
|---|---|---|
| 会话列从 `session.list` 一次取齐 | 探针统计请求：打开项目 1 次 CLI 列表请求，无 `stream.prepare` | 通过 |
| 隐藏标签页不轮询 | 代码路径核对（`visibilitychange` + `visibilityState` 守卫）；未做真机休眠测试 | 通过（受限） |
| 服务端工作区报告路径不显示 | 探针：抽屉显示「保存在服务端工作目录」 | 通过 |
| 320/390 版式未回退 | 既有「五档视口」用例仍通过 | 通过 |

## 未覆盖与不稳定

| 区域 | 状态 |
|---|---|
| 真实模型下的完整 J-01～J-10 | 未执行（无凭据），不记通过 |
| U4 恢复核实 / U5 会话清理界面 | 未实现（产品未定义交互），见 `questions.md` |
| 触屏手势、软键盘 | 未实测 |
| 浏览器套件稳定性 | 9 次连续全绿中出现 2 次不可复现失败（一次 `toHaveCount`、一次 `toBeVisible`），逐条复跑与后续 5 次全量均通过；未定位到具体用例，记录为待观察项，不作为通过依据 |
