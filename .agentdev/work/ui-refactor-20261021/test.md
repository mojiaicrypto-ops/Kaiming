# Test · ui-refactor-20261021

日期：2026-10-21。环境：macOS darwin 25.5.0 / Node 24.8.0 / Chromium（Playwright）/ 真实 workbench 进程 + stub 模型端点。

## 运行

| 命令 | 结果 | 证据 |
|---|---|---|
| `npx tsc -p tsconfig.json --noEmit`（服务端） | passed | 无输出 |
| `npm --prefix webapp run typecheck` | passed | 无输出 |
| `npm run build`（webapp → `web-static`） | passed | `web-static/index.html` + 1 CSS + 1 JS（~484 kB / gzip 164 kB） |
| `npm test`（仓库） | passed | 26 files / 291 tests |
| `npm --prefix webapp test` | passed | 3 files / 27 tests |
| `npm run test:browser` | passed | 15 tests |

## 浏览器用例（真实服务 + 真实 Chromium）

| # | 用例 | 覆盖 |
|---|---|---|
| 1 | a project opens into its real state and every screen renders | 顶栏三标签、三屏、地址栏即路由、刷新后停在同屏 |
| 2 | a submitted input reaches the transcript and the run answers | 提交 → 流式回答 → 只有一条 assistant（不重复） |
| 3 | a question is answered in the panel and the model continues | 问题面板、答复回显、模型继续、提问行翻转为已答 |
| 4 | a second Enter while the first submit is in flight does not submit twice | 双击防重 + 服务端只存一条 input |
| 5 | a business refusal does not break writing, and no screen shows a raw translation key | 业务拒绝不清 token；五屏无裸键 |
| 6 | the reader may leave: the work keeps running and the page can come back | 离开再回来，历史从服务端恢复 |
| 7 | a rejected tool call stays visible with its reason | 被拒的工具调用不消失，带原因 |
| 8 | a proposal opens with its own sections, and an unparsable file says why | 提案三段正文 + 无法解析通知 |
| 9 | a first run with no project boots: login screen, then the empty shell | 登录屏、空壳、语言即时切换 |
| 10 | a seeded project renders the shell from real server data | 真实快照、会话列、连接态、语言切换 |
| 11 | five viewports render without a horizontal overflow | 1440/1024/860/390/320；窄屏会话抽屉可达；导航标签全部可见 |
| 12 | the theme can be switched to light and back, without a reload | 深浅主题即时生效（含计算样式变化） |
| 13 | a long code fence scrolls inside its own box and never widens the transcript | 400 字符单行代码块：页面不横向溢出，块内可滚 |
| 14 | the task strip renders the coordinated Task and polls it | 任务条渲染、成员数、暂停按钮、轮询次数递增 |
| 15 | a Task that appears while the chief is working is picked up without a reload | 运行中新建的 Task 被发现（无 invalidate 路径） |

## 单元与集成

| 文件 | 断言 |
|---|---|
| `test/web-i18n-keys.test.ts` | 两语键集合一致；界面引用的键都存在；无空值/无回显键名；占位符集合一致 |
| `test/web-markdown-stream.test.ts` | 未闭合围栏按代码块增长；闭合后整体渲染；多围栏与无语言围栏 |
| `test/server.test.ts` | 单壳路由：`/`、客户端路由回退、资产 404 不回退、`/app*` 301（含查询串）、API 路径不回退 |
| `test/workbench-entry.test.ts` | 真实入口：一次运行到达订阅者；`/` 与客户端路由返回外壳（缺构建时**失败**并提示 `npm run build`） |
| `webapp/test/chat-model.test.ts` | 工具结果按 callId 配对（含错误标记、无 id 不误配）；流式参数读取（未闭合值）；答案形状；候选行；标题按显示宽度截断 |
| `webapp/test/slot.test.ts`、`normalize.test.ts` | 快照合并不降级在飞消息；三通道归一化（沿用） |

## 手工验证

| 项 | 方式 | 结果 |
|---|---|---|
| 1440 三屏布局 | 截图人工查看 | 通过 |
| 390 手机布局 + 会话抽屉 | 截图人工查看 | 通过（顶栏压缩为字标 + 三标签 + 抽屉按钮） |
| 320 顶栏 | 元素边界测量 | 通过（连接词让位给状态栏，无裁切） |
| 提案抽屉三段正文 | 浏览器脚本 | 通过（目标 / 来源与决定 / 处理记录） |
| 切换会话后已回答卡片不残留 | 代码路径核对（`ChatPage` 按 sessionId 重建） | 通过（未单独写用例） |
| 问题面板打开时 1/2/3 不跳转 | 代码路径核对（与原型同守卫） | 通过（未单独写用例） |
| 换题清空草稿 | 代码路径核对 | 通过（未单独写用例） |

## 未覆盖

| 区域 | 原因 | 处置 |
|---|---|---|
| 真实模型下的完整 J-01～J-10 | 需要真实模型凭据与人工参与 | 未执行；不记通过 |
| 触屏手势、软键盘遮挡 | 无自动化环境 | 未执行；CSS 使用 `100dvh` 与安全区，未实测 |
| 320px 以下的可用性 | 超出声明下限 | 不承诺 |
| 组件级快照/视觉回归 | 未引入该工具链 | 仅人工截图 |
| `tauri`/打包产物 | 仓库无打包流程 | 不适用 |
