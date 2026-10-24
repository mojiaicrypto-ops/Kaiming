# 当前设计文档验证

本页记录证据，不定义协议。日期：2026-10-04。

## 范围与独立审阅

当前正式文档统一 read/write Task、当前步骤全部成员聚合/超时、Pi 原生历史续办、业务与程序核对边界、通用交互与七角色提示词。上一轮三份独立上下文只读审阅最终 Passed，覆盖归一化的产品与运行契约；发现、修正及历史审查处置见 [审阅记录](../../.agentdev/work/pi-native-normalization-20261004/review.md)。

从正式索引可以开始 P0 SDK 最小试验和纯存储/查询工作，后续按依赖实施。文档完整并不表示所有实现决策或 SDK 行为已经取证；本次具体范围见 [结算记录](../../.agentdev/work/pi-native-normalization-20261004/settlement.md)。历史审查保留其基线结果，不替代当前设计与审阅。

角色经验已写入九份提示词、G4/G5和I4，上一轮两个独立上下文只读审阅 Passed；详见 [角色经验审阅](../../.agentdev/work/role-lessons-20261004/review.md) 与 [结算记录](../../.agentdev/work/role-lessons-20261004/settlement.md)。

本次明确开发内置单元/TDD、独立测试优先 API 集成/UI E2E 的责任，更新 D-05、验收、相关提示词及 G1/G4/I4；一份干净上下文独立只读审阅 Passed，无阻断发现，详见 [测试责任审阅](../../.agentdev/work/testing-responsibilities-20261004/review.md) 与 [结算记录](../../.agentdev/work/testing-responsibilities-20261004/settlement.md)。装配正文提取边界明确，但尚未实现宿主注入或验证实际模型效果。

## 实际文档检查

| 检查 | 结果 | 证据 |
|---|---|---|
| 产品/技术归一化 | Passed（沿用） | 原三份独立审阅；本次G2/G3和消息/存储/运行协议未改，测试责任变化另行审阅 |
| 提示词经验、上下文和角色冷读 | Passed（沿用） | 角色经验两份独立审阅；历史证据不代替本次变更审阅 |
| 测试责任与可执行性 | Passed | 本次独立审阅 D-05、开发/TDD与独立端到端分工、证据、权限、交付状态与阻断及返工 |
| 正文提取契约 | Passed | 按 G4 抽取九份正文（边界改为 `## Base rules` / `## Shared rules` / `## Role and goal`），状态说明/映射表排除；不是实际宿主注入 |
| 提示词与系统级文本语言 | Passed | 九份角色正文与项目入口 AGENTS.md 改为英文；`npm run check:prompts` 按 G4 边界抽取、断言正文无中日韩字符且角色正文齐全，并校验提示词内 36 个链接全部可解析（标题锚点保持原样，人体阅读文档仍为中文） |
| 本地文件/标题链接 | Passed | 正式 28 份 Markdown，逐引用实际检查 |
| 图语法 | Passed（沿用） | 图未变化，保留上一轮 Mermaid 11.12.0 的8图解析证据 |
| 协议示例 | Passed | 本次6个 JSON解析；3段TypeScript未变，保留上一轮严格类型检查证据 |
| 工具、角色与过期字段 | Passed | 8 领域工具 + question 扩展；九份规则/提示文件；旧类型/批次/效果账字段清除 |
| 变更格式 | Passed | 本次文档与工作记录限定范围 git diff --check |

命令、检查计数与实际交付状态分别保存在相应工作记录，不用回复文字代替证据。

## 实施证据边界

实际模型行为（I4）已有真实模型检查；P6 产品验收已按可达范围执行（真实模型 + 真实浏览器），通过项与未执行项逐条登记在结算记录里，其中 AC-03/04/08/09～AC-19/AC-23～AC-26/AC-28～AC-35 仍未执行（多为“设计 → 实施需求 → 开发 Task → Review/Test/结算”完整闭环），四断点视觉与逐组件截图对照也未执行。文档检查不表示功能已实现。

已取得的实现证据：

| 范围 | 证据 | 记录 |
|---|---|---|
| PI-01/02/05/07/08 的 SDK 机制：输入关联、停稳与事件语义、宿主保存失败与停止、多会话隔离、宿主交互往返与 UI 适配器形状 | 47/47 断言真实运行（Node 24.8.0 + Pi 1.0.0，机制层用本地 stub 端点） | `.agentdev/work/devagent-bootstrap-p0-20261004/`、`.agentdev/work/devagent-marker-notice-ui-mode-20261005/` |
| 存储与调度内核（接纳去重、事务认领、一会话一运行中、按代次重启分类、停止意图、轮转调度） | 22 项单元测试真实运行（node:sqlite） | `.agentdev/work/devagent-p1-store-dispatcher-20261005/` |
| **真实模型下的宿主问答往返**（模型实际调用 question 工具、宿主答复回到模型）与上述两条适配器结论 | 4/4 真实模型检查通过（deepseek-flash；模型可达 1.7s、工具调用 1 次 select、答复 B 回到模型、notify/TUI 报错/theme 缺失均符合预期） | `.agentdev/work/devagent-real-model-20261005/` |
| **RPC/认证/只读/写入/SSE/交互桥服务端与浏览器外壳**（同源信封与幂等、会话 cookie+CSRF、SSE 缓冲与 resync、交互 WAL 与答复校验、八视图真实 RPC 渲染、485 选择器保真） | 服务端 209 项单元/集成测试；8 个浏览器场景（真实 Chromium + 真实工作台 + stub 模型端点）；选择器 485/485（extra 0）；提示词 15/15；渲染选型 47/47 | `.agentdev/work/devagent-p4-webui-20261008/` |
| **P6 产品验收（真实模型 + 真实浏览器）**：只读调查 Task（Plan/报告落盘、如实记 not_run）、提案保存（浏览器 confirm 授权）、重启判中断与悬挂提问转 stale、无模型/无效模型的明确说明、备份恢复实跑、八视图无死键无假数据 | AC-01/02/05/06/07/20/21/22/27 有实机证据（部分项标“部分”并写明未执行分支）；AC-08～AC-35 逐条登记未执行 | `.agentdev/work/devagent-p6-acceptance-20261010/` |
| **v1 协议简化（统一 task 工具、去模型令牌、程序观察交付）**：模型可见工具从 10 个收敛为 5 个；版本/候选/报告种类不再由模型传递；复核绑定改为程序观察的交付摘要（路径清单 + 完成时重算）；`nextActions`/拒绝事实可行动 | 286 项单元/集成测试；浏览器 8/8；提示词 15/15；真实模型完整流程多次实跑全部完成（每次约 4–6 分钟），最近一次 37 次协议调用/6 次参数错误、步骤拒绝 0、读前写保护 0；另修实跑暴露的缺陷：等待用户提问超过 15 分钟被当作停滞中止、主管自身中断输入冻结会话（见实现记录「缺陷修复」） | `.agentdev/work/simplify-v1-20261020/` |
| **P7 模型配置（provider/角色/项目）**：provider 定义写私有文件（0600、密钥不进库与响应）、role→project→server 单一解析实现、保存后无需重启即生效、`config.test` 真实试连、覆盖在实跑中生效（`effectiveConfig` 与 Pi 原生 `message.model` 对照）、活动输入不受设置变更影响（停在 question 上改配置的实跑）、`session.input.get` 返回记录的脱敏生效配置、私有路径守卫（文件工具与 shell，Pi 同序归一化 + 祖先解析，5 种写法端到端全拒） | 228/228（22 文件）+ 浏览器 8/8；三轮独立复核的阻断项全部修复；AC-27 只覆盖本轮可达范围，其余场景未执行 | `.agentdev/work/devagent-p7-model-config-20261010/` |
| **工具集补齐（主管与设计角色可执行命令）**：`bash` 加入主管与 designer 的原生工具集（read Task 仍移除）；契约 G1、两份提示词与上下文表同步；运行测试用真实 Pi 执行 `echo` 与 `mv`/`rm` 观察真实输出与文件效果 | 288→289 项测试全绿；浏览器 8/8；提示词 15/15 | `.agentdev/work/simplify-v1-20261020/` |
| **新 UI 层 v1（webapp Chief 视图）+ 服务端活快照**：/app 双壳托管与越界守卫、prepare 快照取活 Pi 会话内存条目（消除 resync 丢在飞消息）、React 壳的 slot 合并（在飞不降级）、高亮预算队列、autoscroll 锁定、Task 卡/成员抽屉（数据路径） | 服务端 235/235（23 文件，含 live-snapshot/stream-harness//app 路由新用例）；webapp vitest 4/4 + tsc 0；playwright 旧壳 8 场景全绿；真实模型 + Chromium 实测：流式不丢、代次变化场景内容延续、刷新后历史完整 | `.agentdev/work/devagent-webapp-chief-20261013` |

仍未取证：PI-01 的压缩/分支关联、PI-07 的配置变化冷恢复、PI-09 并发容量与超时、PI-03/PI-04/PI-06、P6 完整产品验收（浏览器全链路与视觉对照）与其余产品验收场景、P7 的"恢复已执行输入按原配置"（本实现不重放旧输入，无落点）、命令执行的沙箱隔离（P-05 已按事实明示边界）。其余实施证据边界见相应结算记录。

## 2026-10-21 前端一次性重构

外壳由"旧无构建 JS（`/`）+ React（`/app/`）"合并为单一 React 外壳（`/`），界面按 `docs/design/tui/` 重写，旧壳删除。

| 检查 | 结果 | 证据 |
|---|---|---|
| 服务端类型 | Passed | `tsc -p tsconfig.json --noEmit` 无输出 |
| 外壳类型 | Passed | `npm --prefix webapp run typecheck` 无输出 |
| 单测与集成 | Passed | `npm test` 26 文件 300 用例；`npm --prefix webapp test` 3 文件 25 用例 |
| 外壳构建 | Passed | `npm run build` → `web-static/index.html` + 资产 |
| 浏览器验收 | Passed | `npm run test:browser` 29 用例（三屏、对话、提问答复、双击防重、业务拒绝、断线返回、被拒工具仍可见、提案三段正文、五档视口、主题切换、长代码块、任务条轮询、运行中新建 Task 的推送、模型范围写入、需求交接预填、文件与二进制阅读、报告正文、更早历史、重绑定、任务列表、焦点陷阱与归还、错误与阻断文案、运行模型显示、会话清理（成功与拒绝）、未确认运行的横幅与交接） |
| 文案一致性 | Passed | `test/web-i18n-keys.test.ts`：两语键一致、界面引用的键都存在、无空值、占位符一致 |
| 单壳路由 | Passed | `test/server.test.ts`：`/`、客户端路由回退、资产 404、`/app/*` 301 |
| 视觉对照 | 部分 | 1440 三屏、390 手机、320 顶栏边界已人工查看/测量；未做逐组件像素对照 |
| 独立审阅 | Passed | 外壳重构两轮（9+2 项阻断，全部关闭）；缺口补齐两轮（无阻断，9 项非阻断关闭，见 `workbench-gaps-20261022/review.md`） |
| 真实模型 | Passed（部分） | 一次手工浏览器探针：真实 DeepSeek 在真实外壳里回答，状态栏显示实际配置，短会话不提供「加载更早」；`npm run check:model` 4/4（deepseek/deepseek-flash：往返、question 工具、宿主答复、适配层事实）；`npm run check:runtime` 4/4（真实运行完成、交付边界、脱敏配置、认领代数）。完整 J-01～J-10 仍未执行 |

未覆盖：真实模型下的完整 J-01～J-10 流程；拖拽/触屏手势；320px 以下的可用性；U4 恢复核实与 U5 会话清理的界面（产品未定义交互，问题见 `.agentdev/work/workbench-gaps-20261022/questions.md`）；浏览器套件在 9 次连续全绿中出现过 2 次不可复现的偶发失败（详见该任务 `test.md`）。

## 2026-10-23 Provider 命名/协议与会话命名

| 检查 | 结果 | 证据 |
|---|---|---|
| 协议不再推断 | Passed | `config.save` 只接受 `openai-completions` / `openai-responses` / `anthropic-messages`，缺失或拼错返回 `INVALID_ARGUMENT` 且不落库、不写文件；`test/provider-config.test.ts`「refuses a save without a supported protocol」 |
| Pi 对缺少协议的两种真实反应 | Passed | 直接调用 `ModelRuntime`（本地临时 `models.json`）：自定义 id 且无 `api` → 该模型不加载并报 `no "api" specified`；id 为 `openai` 且无 `api` → 静默解析为 `openai-responses`。这是本轮把协议做成必选字段的原因 |
| 显示名与标识分离 | Passed | `providers.name` 增量迁移（schema v9→v10）；`config.get` 返回 `name`（空则回退 `providerId`）；`models.json` 同步写 `name`；改名不改变 `providerId`、`credentialRef` 与指派。单测「keeps the id as the identity…」「falls back to the id…」 |
| 编辑入口 | Passed | 设置页每行「修改」；编辑时技术标识只读，协议为必选下拉；浏览器用例「a provider is added with a name and protocol, then edited without changing its id」 |
| 会话命名 | Passed | `sessions.title` 增量迁移；`session.rename` 写方法（只允许主管会话、上限 60 字符、空白归一化、revision 冲突）；`session.list` 有存储名用存储名，否则仍取首条用户发言。单测「names a chief conversation…」（清空回到派生名、子会话被拒、陈旧 revision 409）与浏览器用例「a conversation is renamed from the rail…」 |
| 保存名不被二次截断 | Passed | `session.list` 对存储名原样返回、只对派生的消息载荷做提取与 60 字截断；把该分支改回「总是派生」时用例失败（`Expected: 文档结构 / Received: 帮我看一下…`） |
| 迁移不破坏现有数据 | Passed | 真实数据目录重启后 `PRAGMA user_version` = 10，`providers.name` / `sessions.title` 就位；两个 provider 与 6 个会话、已完成 Task 记录保持 |
| 真实端点 | Passed | 本机代理实测 `POST /v1/chat/completions` 200、`/v1/messages` 200、`/v1/responses` 400；改协议为 `openai-completions` 后 `config.test` 对 `openai/group/auto-deepseek-v4-1-flash` 与 `deepseek/deepseek-flash` 均 `available: true`（真实一次 token 往返） |
| 全套测试 | Passed | 单测 32 文件 344 用例；浏览器 38 用例；`tsc --noEmit` 与 `npm run build` 无输出错误 |

未覆盖：一次真实的「改名后交给另一个浏览器/设备」人工核对（用例在独立浏览器上下文重载中验证了服务端持久化）；provider 删除能力（产品本轮未定义）；`google-generative-ai` 等其他 Pi 协议。

## 2026-10-24 模型配置的分层

| 检查 | 结果 | 证据 |
|---|---|---|
| 项目内按角色设置 | Passed | `model_overrides` 增加 `roleId`（schema v10→v11 重建表，旧行 roleId=''）；`config.save` 同时接受 `roleId`+`projectId`；单测「narrows an override to one role inside a project…」断言该项目内该角色为 `project-role`、同角色在别处仍走全局、同项目其他角色走项目默认 |
| 分层顺序 | Passed | `项目内角色 → 角色 → 项目默认 → Server 默认`；`EffectiveConfig.source` 增加 `project-role`；契约与产品文档同步（P-05、G4、U6、S2） |
| 恢复默认真的删除 | Passed | 新增 `config.clear`（幂等）；Models 每行选「默认」即移除该层，单测逐层清回 `role → project → server` 并断言 `overrides` 三个键都为 null |
| 第二次修改不再冲突 | Passed | 页面改为按已存行的 `revision` 保存（之前一律 `expectedRevision: null`，已存在的层再改会 `VERSION_CONFLICT`）。把该处改回 `null` 后浏览器用例失败，恢复后通过 |
| 界面可读 | Passed | 项目作用域 8 行（本项目默认 + 7 角色），每行下拉显示「本层存了什么或 `默认（继承的模型）`」，右侧徽标显示生效层；1440×900 下每行 42px，无换行 |
| 浏览器用例 | Passed | 「a project can override one role, and choosing "default" gives the layer back」：设置 tester → `project-role`、同项目 chief 不受影响、再改一次仍是同一层、选「默认」回到继承 |
| 迁移不破坏现有数据 | Passed | 真实数据目录重启后 `PRAGMA user_version` = 11，`model_overrides` 主键为 (scope, scopeId, roleId)；原有 3 条全局角色覆盖仍在，项目内 tester 覆盖写入新行 |
| 全套测试 | Passed | 单测 32 文件 345 用例；浏览器 39 用例；`tsc --noEmit` 与 `npm run build` 无错误 |

## 2026-10-24 任务在对话里的渲染

| 检查 | 结果 | 证据 |
|---|---|---|
| 顶部只有流程 | Passed | 任务条删去成员数与展开面板，只留 Task 编号、真实走过的阶段链、状态与暂停/继续；Task `completed`/`cancelled` 后整条不渲染。浏览器用例「a finished dispatch folds to one line…」断言无 `task-members-toggle`、无 `task-panel` |
| 成员行在派发位置 | Passed | `dispatch` 卡片在调用进行中展开成员行（状态 + 角色·标题 + 阶段 +「跟随」），结束后折叠为一行，真实结果放进展开。浏览器用例同时断言结束后 `details[data-call-id]` 存在、其内部没有 `.mrow`、也没有进行中的 `.disp` |
| 只列该次点名的成员 | Passed | 新增纯函数 `membersForDispatch`（点名的成员交集；无点名时只有最新的 dispatch 继承当前成员），`webapp/test/dispatch-members.test.ts` 4 项断言 |
| 顶部不重复成员信息 | Passed | 任务条不再读 `members`，`ChatPage` 删除 `membersOpen`/自动展开逻辑；`MessageItem` 删去未使用的 `memberNote`；CSS 删去 `.strip-panel`/`.strip-goal`/`.strip-m`/`.strip-results`/`.sres` |
| 看完即真 | Passed | 1440×900 实跑截图（`task-dispatch-inline.png`），以及真实数据目录下 `t-…` 运行中的界面核对 |
| 全套测试 | Passed | 服务端 32 文件 345 用例；webapp 4 文件 30 用例；浏览器 39 用例；`tsc --noEmit` 与 `npm run build` 无错误 |

未覆盖：派发进行中的成员行由真实长跑 Task 观察（脚本 stub 在成员挂起时整条 assistant 消息不结束，卡片因此尚未出现在转录里，无法在自动化里稳定取到该窗口）；已由设计稿与真实使用核对形态。

### 运行中的 Task 在对话里（同日补正）

真实项目复核发现上一版仍有缺口：主管在 `dispatch` 里等待时，承载该调用的 assistant 消息尚未结束、不进入历史，**刷新后转录里没有派发卡片**；而卡片按“调用是否返回”折叠，等待超时返回后成员仍在跑也会被收起。两处都已在真实项目与自动化里核对：

| 检查 | 结果 | 证据 |
|---|---|---|
| 展开条件 | Passed | `liveSessions` 由成员状态判定（`activity` 或派发输入状态未终结）；只有**最新一次**派发卡片吃这个集合，历史派发仍折叠。真实项目 `t-70da006f`：刷新前后都是 `1` 个展开卡片 + `1` 行 `Developer · 实现 S0 六件套与产物链路 · running`；截图 `final-reload2.png` |
| 刷新后可见 | Passed | 无派发调用时转录末尾渲染「当前步骤」块（Task 号 / 阶段 / 目标 / 成员行）。浏览器用例「a running Task is in the conversation even when history has no dispatch yet」：路由构造 `task.get` 与 `session.get`，断言块与成员行在打开与刷新后都存在 |
| 不重复 | Passed | 同一成员只出现一次：存在任一派发调用时该块隐藏（用例断言 `.disp` 与 `task-live` 不同时出现于真实场景；真实项目 `live=0, rows=1`） |
| 行内命名 | Passed | 成员行显示「角色 · 派发标题」（与设计稿一致），由 `ChatPage` 统一生成，派发卡片与当前步骤块共用 `TaskMemberRows` |
| 全套测试 | Passed | 服务端 345 用例；webapp 30 用例；浏览器 40 用例；`tsc`/`build` 无错误 |
