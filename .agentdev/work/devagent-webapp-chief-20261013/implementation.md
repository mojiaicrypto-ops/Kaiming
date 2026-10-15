# Implementation：webapp chief 会话视图（v1 进行中）

日期：2026-10-14。Plan 见同目录 plan.md；本记录只写已发生的事实。

## 已落地（commits 1d9b72e、6199228）

### W-a 前置：/app 静态面（属 W-b 但先行）
- `src/server/http.ts`：`appStaticDir` 选项；`/app`、`/app/`、`/app/*` 路由（SPA 回退 index.html）；
  `/app/../state.db` → 404（越界守卫保持）；未构建时明确报 "the /app surface is not built"。
- `src/server/main.ts`：`web-static/app/index.html` 存在才挂载；`web-static/` 已入 `.gitignore`。
- 隔离验证（node 直连 createWorkbenchServer）：`/app/`、`/app`、`/app/index.html` 全部 200 且含 React 资产；越界 404。
- 回归：`npm test` 22 文件 228/228 全绿（两次验证：路由后、修复后）。

### W-b 脚手架 + RPC/SSE 适配
- `webapp/`：React 19.2 + Vite 7 + TS 5.9；`npm run build` 产出到 `web-static/app/`；dev 代理 /api → 4173。
- `src/api/rpc.ts`：信封/CSRF/newRequestId（R1 语义 TS 化）；`src/api/stream.ts`：prepare→SSE→帧（resync→重 prepare，绝不补洞）。
- 登录/项目/会话选择；浏览器实测：登录 → 打开 aisuangua → 历史渲染 26 个 message 节点。

### W-c Transcript v1（部分）
- `state/slot.ts`：每会话 slot reducer；快照按 entryId 合并、**直播尾巴不被快照降级/丢弃**；
  toolCall arguments 归一化（Pi 历史是对象、直播是字符串）；合并顺序=快照权威+live-only 尾巴。
- `components/Transcript.tsx`：user/assistant/thinking/tool 卡；toolResult 翻转匹配卡（callId）。
- `components/Markdown.tsx`：markdown-it + **10 语言注册（模块级）** + agegr 预算队列（移植，MIT 登记于 ported/PORTED.md）。
- `lib/scroll.ts`：autoscroll 锁定语义（上滚锁定/回底解锁/程序滚动标记/跳底）。
- `test/slot.test.ts`：3 项回归（归一化/在飞不丢/孤儿 message_end 保留）。

## 实测发现并当场修复（真实模型 + Chromium，aisuangua 会话）
| 发现 | 根因 | 修复 | 证据 |
|---|---|---|---|
| 登录后永远停在登录页 | cookie HttpOnly，`document.cookie` 判断永假 | `config.get` 探测 + 登录后重开 stored 项目 | 页面进入 topbar/composer |
| 真实历史渲染崩溃 `r.slice is not a function` | 快照 toolCall.arguments 是对象 | slot 归一化 | 26 节点渲染；单测 1 |
| 刷新后尾部消息顺序错乱 | 合并按首次出现排序，快照晚到插到 live 之后 | 快照权威 + live-only 追加 | DOM 尾部 3 条顺序正确；单测 3 |
| json 代码块 0 高亮 + `Unknown language: ""` | 语言注册只在 markdown-it 回调内；空语言直传 hljs | 模块级注册 + 空语言守卫 | json fence 103 个 token span；`window.__errs` 清空 |

## 流式实测（真实模型）
- 提交 markdown 请求：消息节点 27→29，hljs token **流中从 0 → 14 → 40** 增长（预算队列工作），消息未丢（对照旧壳 resync 丢失场景）。
- 刷新后历史完整（55 条服务端消息中可见 28 个渲染节点：system 隐藏、toolResult 折叠进卡）。

### W-a 服务端快照取活会话（完成）
- `src/server/live-snapshot.ts`：`sessionManager.getEntries()` → HistoryRecord 投影（marker 关联 inputId 与文件读一致；非 message 条目不进对话）。
- `stream-methods.ts`：`currentHistory` 选项（registry 活实例优先，空闲回退 readPiHistory）；`pageHistory` 收窄为 `{records}`。
- 测试：`live-snapshot.test.ts` 3 项投影回归；`server-stream.test.ts` harness 注入 currentHistory（活源优先/文件回退），套件 **233/233**。
- commit 6c715cd。

### W-b/W-c 实机回归修复（commits 123463a、1c4076f）
- 重启后登录流不重订阅：hook 增加 enabled 门（authed===true 才开流）。
- Task 卡改由 chief 流的 `{type:'invalidate', entity:'task', id}` 通知驱动 activeTaskId + 可见时 3s 轮询 `task.get`；成员行 idle/active 取 `task_sessions.currentInputId`（等待集合自身事实）。
- 端到端实测（真实模型，新壳）：发送→流式完成→节点 29→30 稳定不丢→刷新后 30 条齐全（含"第六个问题"）。

## 未完成（下一工作片）
- W-c 剩余：`TaskCard`/`MemberDrawer` 已有实现但未接真实 Task 流（需要一次真实 createTaskSessions 运行）；
  成员状态轮询接的是 `session.get` 占位（`TaskCard.tsx` 内 fetch 待改为 rpc + `task.get` members.currentInputId 状态映射）。
- W-e2 浏览器验收场景化（含"运行中代次变化"对照用例）与结算。


### 交互卡两处断点（2026-10-15，commit 765627e）
用户报告"选择弹框有、交互没反应"。实机驱动真实 select 问题定位：
1. `interaction.respond` 缺 `projectId`（服务端 requireProject）→ 每次答复 409 'projectId is required'，卡片永远挂着。
2. 新建的交互从不出现/消失不通畅：slot 只在快照时替换 pending；interaction invalidate 仅处理了"已答复"分支。现在任意 interaction invalidate 都会经 prepare 重读权威 pending 列表（旧壳 refreshInteractions 路径）并 dispatch `pendingReplaced`。
端到端验证：select 问题 → 点 B → 卡片离开 pending 区域、模型回"已收到你的选择：B"；套件 235/235 + webapp 6/6。
遗留设计缺口（登记）：连续多次选择（多轮 question）目前靠"每张卡独立 + pendingReplaced 全量刷新"支撑，视觉上无"第 N 问/进度"概念；若产品要求更强的多轮选择流（如向导式分步），需另行设计。


### 产品完整性专项（2026-10-16，commit 117e023）
用户反馈"半成品"。走查 13 项 UX 断点（scout 审计 agent://WebappUxAudit），high/med 全部闭环：
- 全局 toast（lib/toast.ts）：openProject/session.create/submit/stop 失败可见、成功有确认。
- 会话过期（needLogin）→ 登录视图 + 提示，不再半死。
- 交互卡完整生命周期：busy → 乐观回显（interactionResolved 保留卡片，pendingReplaced 收走）→ STALE"已被处理" → 网络失败行内重试；多问编号、input autoFocus、空输入防护。
- 断流横幅（重连中/连接中 + 手动重试）；空态（未开项目引导 / 新会话欢迎）；composer IME 保护、失败恢复草稿、busy 占位、STOP 仅运行中显示；回到最新浮动按钮；TaskCard 骨架 + 刷新失败标记；抽屉加载态 + ESC；focus-visible。

实机验收（真实模型，ux-accept tab）：错误口令提示 ✓、两连问（select→confirm）编号与排队 ✓、答"红"→确认→总结 ✓、越权答复后 STALE 路径 ✓（out-of-band respond rev2 后 UI 卡片收走）、空提交不发 ✓、Shift+Enter 换行不发 ✓、坏路径 toast ✓、回到底部按钮出现→点击回尾 ✓、套件 235/235 + webapp 6/6。
遗留：抽屉 ESC 未实测（该会话无成员，逻辑已实现）；错误口令后 csrf 未刷新的边缘（登录成功路径覆盖）。
