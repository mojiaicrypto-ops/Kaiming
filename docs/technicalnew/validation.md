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

### 成员行样式按设计稿对齐（同日）

用户指出的错位有明确原因：删掉执行面板时留下了第二条 `.mrow` 规则（6 列）覆盖 4 个单元格，状态文字“Waiting for your decision”被挤进姓名列。已按设计稿重排并在真实项目截图核对：

| 检查 | 结果 | 证据 |
|---|---|---|
| 四列布局 | Passed | `max-content ｜ 角色·标题 ｜ 详情 ｜ 跟随`；状态列内容自适应、单行不换行；姓名与详情各自省略号，不再互相覆盖。1440×900 实测行高 33px |
| 状态用短词 | Passed | 新增 `task.state.*`（运行中 / 等你回答 / 已结束 / 失败 / 排队 / 已停止 / —），不再塞入整句；「等你回答」只在确有该成员的 pending question 时出现（此前只要 input 存在且 idle 就误判） |
| 详情列 | Passed | 已交付→`报告：<摘要>`；等你回答→`正在 question：<标题>`；在做→`正在 <阶段>` |
| 卡片形态 | Passed | 去掉卡片头部与目标行，成员行紧跟主管那句话，与参考图一致；折叠形态不变 |
| 当前步骤块 | Passed | 仅在没有派发调用时出现，仍有 Task 号 / 阶段 / 目标（上方没有主管的话可依托） |
| 只列当前在做的成员 | Passed | 继承时只取 live 成员（`membersForDispatch` 新增 `liveSessions` 参数），历史已结束成员不再出现在当前步骤里；webapp 用例新增断言 |
| 「回到最新」不再压住内容 | Passed | `.jump` 从绝对定位改为 dock 内一行，实测不再覆盖成员行 |
| 全套测试 | Passed | 服务端 345；webapp 31；浏览器 40；`tsc`/`build` 无错误 |

### 按 `docs/design/tui/` 原型逐组件核对（同日）

用户指出设计稿是 `docs/design` 下的 HTML 原型。仓库里 `docs/design/` 有三轮：`hifi/`（2026-10-21 00:57，提交 60a8037「graphite workbench」静态稿）、`v2/`、`tui/`（提交 8183fe0，含 `chat-view.js` 脚本化对话）。当前实现与 [U1](ui-design.md#u1-范围与现状) 都以 `tui/` 为基准，且用户指出的成员行（`✓ 已结束 / 开发 · 后端 / 报告：… / 跟随 ›`）只存在于 `tui/chat-view.js` 的 `memberRow`。据此逐组件对照并修正：

| 检查 | 结果 | 证据 |
|---|---|---|
| 令牌与外壳 | 一致 | `tokens.css` 与 `tui.css` 的 `:root` 逐项相同（字体按 CJK 拆成 `--ui`/`--mono` 是已记录的有意偏差） |
| 共享选择器 | 262 个中 20 处差异，逐条判定 | 本次修正 `.mrow`、`.jump`、抽屉宽度、纯等待折叠文案；`100dvh`、`minmax(0,1fr)`、`min-height` 等更有防御性的写法保留 |
| `.mrow` 列 | Passed | 改为设计的 `7.5em 8em minmax(0,1fr) auto`，gap `--s3`、`center`、`4px --s2`；≤860 → `6.5em 1fr auto` 且隐藏详情列（实测 65px/585px/隐藏/47px）；≤560 → `5em 1fr auto`，并删掉遗留的 4 列规则（正是最初错位的同类残留） |
| 派发卡片 | Passed | 恢复设计头部：`派发 N 名成员` / `继续 <角色>` + 右侧 `等待当前步骤全部成员 · 9.0s`；倒计时按首次出现的时刻本地计时（此前 `elapsedMs` 从未被传入，等宽时间列一直是空） |
| 状态词 | Passed | 按设计 `actWord`：运行中 / 等你回答 / 已结束 / **未通过** / **已暂停** / **空闲**（失败→未通过、已停止→已暂停、—→空闲） |
| 名称列 | Passed | `.ml` 只放角色；派发标题进详情列兜底（此前 `角色 · 标题` 塞进 8em 列会截断），阶段与角色同名时不再重复“结算 / 正在 结算” |
| 折叠行 | Passed | 用设计的 `.tline` 外观（状态 + 标题 + 成员 + 耗时），正文仍在展开里：真实结果是机器 JSON（`t-… completed (s-…:completed) {...}`），铺在单行上不可读 |
| 全套测试 | Passed | 服务端 345、webapp 31、浏览器 40、`tsc`/`build` 无错误 |

### 结算提交门禁（同日）

产品 D-07 要求「有 Git 的项目提交本次实际成果和交付记录」，但此前没有任何程序核对：`store.completionBlockers` 只看成员/复核/交付摘要/测试，提交完全靠 settler 记得敲 `git commit`，服务端 `src/` 里没有任何 git 调用。用户实测「结算后没有提交」即由此而来。本步把提交变成收口条件（提交仍由模型执行，程序只观察与拒绝）。

| 检查 | 结果 | 证据 |
|---|---|---|
| 未提交即拒绝收口 | Passed | 真实 store + 真实 `task` 工具 + 临时 git 仓库：passed Review 之后改动交付文件，`end` 返回 `COMPLETION_INCOMPLETE`，缺项列出文件与 `git add -- <paths>`，Task 保持 `active`；提交后同一调用不再出现该缺项并可 `completed`（`test/git-commit-gate.test.ts` 端到端用例；独立 Test 亦以自建脚本复现） |
| 提交由模型执行 | Passed | 程序只运行 `rev-parse` / `status` / `check-ignore`；`agents-and-tools.md` 与 D-07 无「程序代提交」表述 |
| 缺项覆盖三类事实 | Passed | 未提交；被忽略（2026-11-01 起顶层未跟踪 ignored 文件不再进入交付路径，这里只指内嵌仓库根被外层忽略或内嵌仓库里的交付路径被忽略）；内嵌仓库里的交付文件（在它自己的仓库核对，外层是否记录该仓库另算一条）。三类各自成缺项，不合并 |
| 合法形态不被永久阻断 | Passed | 真实 `git submodule add`：内层内容提交 + 外层提交指针后 `gaps` 为空；两层内嵌逐级记录后为空；项目位于更大仓库之下时路径按前缀换回项目相对 |
| 无法核实不静默放行 | Passed | `.git` 存在但 git 读不出来（gitdir 损坏、git 不可用）一律 `unverifiable` 阻断；仓库标记按项目目录向上查找，子目录项目不会退化成「无 Git」 |
| 独立 Review / Test | Passed | 四轮独立 Review（`review.md`）与四轮独立 Test（`test.md`，39 个探针场景）；最终结论均为通过，关闭项含 gitignore 交付、内嵌仓库、两层嵌套、submodule 指针、`.git` 假标记、路径分批 |
| 全套测试 | Passed | 服务端 33 files / 368；webapp 31；浏览器 40；`tsc --noEmit` 无错误 |

## 2026-10-25 会话转录 TUI 化与工作流全量展示

用户逐轮确认的视觉定稿（omp 平铺转录 + 产品骨架 + 列式问题区）落地；工作流展示改为「任务清单」：全量成员按阶段-轮次分组、返工可见。

| 检查 | 结果 | 证据 |
|---|---|---|
| 全站等宽 | Passed | `--font` 单一字族栈（JetBrains Mono → PingFang SC/雅黑回退）；实跑截图核对中英混排 |
| 平铺转录 | Passed | 无 who 头/边栏线；用户行 `❯` 前缀；散文 110ch 软上限、工具行满宽；`npm run build` 后真实服务 + Chromium 截图核对 |
| 任务清单（TaskTodo） | Passed | 全量成员、阶段-轮次分组（`Develop · 第 2 轮`）、未通过成员保留为返工证据、`↻` 返工前缀、头部进度 `n/m 已结束`、Plan 可展开；截图核对三组成员与分组标题 |
| 任务条轮次 | Passed | 同阶段两次进入显示 `×2`；与任务清单同一分组算法（`rosterGroupsOf`），两处永不矛盾 |
| 派发卡收敛单行 | Passed | create/dispatch 均为 `.tline` 折叠，Plan 与真实结果进展开；`useRunningFor`/live 展开逻辑删除（成员状态唯一来源 = 任务清单） |
| 问题区列排序 | Passed | 选项为数字槽 + 悬挂缩进的行，长文案行内换行；问题标题可换行不省略；新增用例「a question with long options wraps instead of being cut off」实测行高 > 1.5 倍行距且不出面板框 |
| 返工场景用例 | Passed | 新增「a rework round shows as history」：develop→review 未通过→develop 再跑，断言 3 行全量成员、第二段 develop 分组、`×2` 阶段链、未通过行 |
| 全套测试 | Passed | 服务端 33 文件 368 用例；webapp 4 文件 31 用例；浏览器 44 用例（含 2 新增）；`tsc`（两端）与 `npm run build` 无错误 |

| 用户行内联与区分（同日两次补正） | Passed | 第一次修复漏了 Markdown 渲染器的嵌套块级 div（`.md > div > p`）与 `.uline` 本身，长消息仍从第二行起（实测文字 top 比文章 top 低 35px）；改为 `.uline` 及其全部 `div/p` 后代内联后，`❯ 要不要把聊天前端…` 完整同行（文字 top 79 = 文章 top 68 + padding，首行起点在 `❯` 之后），块级例外（图片/工具/问题行/代码块/表格）显式还原。真实服务 + Chromium 截图核对 |；用户消息带 surface 底色 + 2px accent 左边线、`❯` accent 加粗，主管回复无底色无边线；110ch 软上限只作用于主管/成员散文，用户行不限宽。真实服务 + Chromium 截图核对 |
| 全套测试（补正后） | Passed | 浏览器 44 用例（一次运行中「browser screenshot」用例偶发失败、单独复跑通过——与既有登记的偶发相同，不经过用户消息样式路径）；`tsc` 与 `build` 无错误 |

| 计划阶段前置显示（同日） | Passed | write 任务从 `type + requiresTest` 推导计划尾段（review（+test）/settle），以暗色计划态画进任务条（`Design·Review·Test·Settle`，无轮次标记）与任务清单（`未开始(计划内)` 组）；reach 取真实走过的最远阶段——返工场景（develop→review 未通过→develop）只计划 test+settle，review 不重复计划。真实服务 + Chromium 截图核对（用户场景 t-df361582 设计进行中）；rework 用例与文档任务用例断言扩展 |
| 全套测试（计划阶段） | Passed | 浏览器 44 用例；单测 368+31；`tsc`/`build` 无错误 |
| 流程可视化（同日第三轮） | Passed | 任务条与任务清单改由同一个 `flowOf` 驱动（`webapp/src/chat/task-flow.ts`）：横向节点轨道（完成✓ / 当前呼吸圆 / 计划虚线圆，连线亮到当前步骤）+ 竖向节点轨道（active 行 run 色底带、失败 block 色、计划虚线与「未开始(计划内)」）+ 进度条（只数已完成，计划不计，<1280px 隐去）。真实服务 + Chromium 双主题双宽度截图核对（design 进行中：`Design ⃝ ─ ─ Review · Test · Settle`，清单同序）；`task-flow.test.ts` 7 例锁定分组/轮次/返工/暂停/read 任务；浏览器用例断言 `.p.cur` 的 `animation-name: work`、计划节点无 ✓、进度 `0/1`、计划步骤数 2 |
| 全套测试（流程可视化） | Passed | 浏览器 44 用例；单测 368（服务端）+ 38（webapp）；两侧 `tsc --noEmit` 无错误；`npm run build` 成功 |
| 尾部跟随（同日第四轮） | Passed | 复现：新增 `slow_text` 桩回复（900 分片 / 20ms）让答案真正逐字增长，页内逐帧采样 `scrollHeight - scrollTop - clientHeight`。修复前 61 个增长帧中 3–5 帧视图落后尾部（最深 32px，正好一个新段落）——根因是 `createAutoscroll` 用「距离 < 60px」判定贴底，单帧增量超过 60px 时自伤地解锁。修复后：跟随改为意图判定（用户发送 / 跳转 / 空输入框按 Esc 才钉住，只有用户上滑解除）+ `useLayoutEffect` 在绘制前跟随，连续 3 次运行 **0 个落后帧**；上滑后视图停在原处且胶囊显示「下方还有 N 行」，点击回到底部。用例：`browser/acceptance.spec.ts`「a fast answer never leaves the reader behind, and the way back is always visible」断言逐帧零落后、胶囊计数、上滑保持、点击归位 |
| 全套测试（尾部跟随） | Passed | 浏览器 45 用例；单测 368（服务端）+ 38（webapp）；两侧 `tsc --noEmit` 无错误；`npm run build` 成功 |
| 文件与报告查看器（U11） | Passed | 单一查看画布 `files/FileViewer`（全屏：260px 目录树 + `SourceView`），两个入口共用：项目对话框知识条目/目录浏览、任务结果 → 报告正文 → 报告自身项目路径。所有文本文件（含 `.html`/`.md`）按源码显示（行号栏 + 等宽 + 不折行 + 文件内查找与命中行跳转）；语法高亮走 `lib/highlight.ts` 单注册表，与转录围栏同一 grammar 与同一 token 配色（实测 `hljs-keyword=rgb(191,162,255)`）；图片/媒体由新增只读字节路由 `GET /api/v1/project-files/<projectId>/<path>` 提供，二进制/PDF 明说不可预览并给下载。安全性由 7 条服务端用例覆盖：无 cookie 401、路径穿越拒绝、**符号链接指向项目外返回 403 且不泄漏内容**、目录/未知项目/缺失文件 404、图片 `nosniff`、下载 `content-disposition`。`project.files.read` 现在按 mime 判定二进制（图片不再被当作文本吞掉）。浏览器用例断言：画布宽度 >1000px、`.html` 标签仍是可见文本且画布内无 `<h1>`、PNG `naturalWidth>0`、关键字 token 颜色、报告相对路径可点进同一画布 |
| 链接解析与文档渲染（U11 追加） | Passed | 复现用户场景：消息里的 `[frame](/Users/…/aisuangua/.dev/work/t-acbbb5bd/shots/zoom-1440.png)` 点击后浏览器跳到 `http://127.0.0.1:4173/Users/…` 得到 404。修复：`files/link-target.ts` 在点击时解析（不改写正文）——项目根内的宿主绝对路径转项目相对路径并开画布、相对路径按文档目录解析、越过项目根判为项目外并提示、真外链开新标签。同时 `.md` 改为默认渲染态 + `渲染/源码` 页签（`files/MarkdownView`），报告正文与大画布共用。验证：`link-target.test.ts` 7 例（宿主路径、相对、`..` 越根、前缀相似的兄弟项目、file://、锚点、项目根本身）；浏览器用例断言点击后 URL 仍是 `/`、画布显示该帧、项目外链接有提示且不导航、文档默认渲染（h1/strong）、相对链接按文档目录命中、切到源码看到原文。报告正文的旧断言（要求按源码显示）按其编码的旧契约改写 |
| 全套测试（链接与文档） | Passed | 浏览器 48 用例；单测 375（服务端）+ 50（webapp）；两侧 `tsc --noEmit` 无错误；`npm run build` 成功 |
| 需求页任务区折叠 | Passed | 任务区默认折叠为一行（`data-testid=tasks-toggle`，`aria-expanded=false`），折叠时即可见「共 N 个」与进行中数量，列表 DOM 不渲染；点击后展开，`aria-expanded=true`；刷新与分页移到标题行右侧，不再各占一行（展开后仅两行：标题行 + 任务行）。浏览器用例断言折叠态无 `task-row`、计数与运行态可见、点击后出现；1280px 实测截图核对 |
| 全套测试（任务区折叠） | Passed | 浏览器 48 用例；单测 375（服务端）+ 50（webapp）；两侧 `tsc --noEmit` 无错误；`npm run build` 成功 |
| 移动端（320/390px） | Passed | 在 320、390 两档做完整走查（聊天、会话抽屉、文件画布、需求看板、设置），逐屏截图核对。修复 5 个真实缺陷：① `.app` 的隐式栅格列是 `auto`，被看板最宽子元素的 min-content 撑到 355px（视口 320），顶栏随之被推出右边缘 —— 改为 `minmax(0,1fr)` 并把看板列、`.colm` 一并收紧；② 项目切换器在手机上宽度为 0，完全点不到 —— 给可点击下限并让它先于导航收缩（实测修复前 `proj:[36,36]`、rail 在 `x=572` 而视口 390）；③ 顶栏 rail 开关被挤出屏幕，且文案错写为「Chat」—— 改为 `≡` + `aria-label`，导航与开关 `flex: none`；④ Toast 在手机上要么盖住首条消息（贴顶）要么盖住 composer（贴底）—— 改为由 `ToastHost` 的 `lift` 按屏幕给抬升量；⑤ 文件查看器打开文件后多出 Download，把 Esc 推出可见区 —— 头部在手机上换行、路径独占一行。另修：`≤400` 导航标签换图标时 DOM 里文案出现两遍（`sr-only` 未生效于非定位父级），改为单份文字 + `data-glyph` 伪元素，`toHaveText` 恢复为单个词。用例：`smoke.spec.ts`「a phone can reach every control」断言两档下项目按钮宽 >20px、rail 开关可见、导航右缘不越界、项目按钮真的能打开对话框；`acceptance.spec.ts`「every screen is usable on a phone」走完五屏并逐屏断言无横向溢出 |
| 实施需求状态未随 Task 更新 | Passed | 真实项目 `aisuangua` 的运行中 Task `t-aedc73cc`（requirementId=`req-ui-shell`，phase=test）在看板上仍显示「待实现 / In progress 0」。原因不是看板过期，而是记录本身停在 `pending`：文件 `updatedAt` 10:38:22Z 早于 Task 创建 13:37:38Z，该主管 Session 当天对 `requirement` 工具的调用为 0 次。R-05 要求「开始实现 Task 后进入进行中」，但当时唯一写状态的路径是主管手动 `save`，`task create` 对 pending 静默接受，决策时刻没有任何提示；另外看板只在挂载时读一次，即使记录被改也不会自己更新。修复：①`task create` 成功后若记录为 pending，程序改 `in_progress` 并在结果报 `requirement.status`（只动 front matter 两行，正文不重新序列化；已 in_progress 字节不变；completed/cancelled/archived 不重开）；②看板在标签页可见时每 5 秒重读，隐藏时不请求、回前台立刻读一次，已「显示更多」的任务列表不被折叠。服务端用例断言文件真的变成 in_progress、正文原文保留、无需求的 Task 不触碰任何记录；浏览器用例把记录文件改成 in_progress 后不刷新即看到卡片换列（去掉轮询后该用例失败，恢复后通过）。存量记录 `req-ui-shell` 已改为 in_progress 并复核解析通过 |
| 思考等级（effort） | Passed | 模型选择新增思考等级：Models 每行四格（角色 / 模型 / 思考等级 / 来源），等级是 Pi 的 `thinkingLevel`，随同一行的模型一起保存（`model_overrides.thinkingLevel`，schema v12，空=未设置=Pi 的 `off`，与既有行为一致）。可选级别由服务端用 `getSupportedThinkingLevels` 的同一判定给出（`reasoning` + `thinkingLevelMap`）：未声明推理只有 `off`；声明后 `off…high`，`xhigh`/`max` 需模型显式映射。保存时按该判定拒绝不支持的级别并返回允许列表；运行时仍由 Pi 钳制，钳制值进入会话与有效配置。生效层不跨层拼接：赢得模型的那一层同时决定等级。Providers 的模型列表改为逐行编辑（id + 「支持推理」勾选 + 移除 + 添加），勾选写入 `models.json` 的 `reasoning` —— 实测用户现有 4 个自定义模型在 Pi 里全部 `reasoning=false`，不声明就永远只有 `off`。视觉实测：1440/390 两档深色与浅色、Providers 表单与模型行、Models 四格对齐；手机行改标签独占一行、控件换行；`Off` 这类前缀标签不再出现在没有模型的行（服务端默认 `unset` 不是模型）。用例：服务端 383（新增 7：保存/拒绝/跨层/声明落盘/迁移 v11→v12/会话等级/钳制）；浏览器新增「effort is chosen per model, and only where the model declares reasoning」（选等级 → 保存 → 刷新仍为 high 且 effective 一致；未声明模型显示「不支持推理」；到 Providers 勾选后等级出现） |
| 网关别名解析为目录模型 | Passed | 场景：网关把 GLM 5.3 叫 `auto-glm-5-3`，目录里查不到该 id，Pi 于是用兜底值 128k 上下文 / 16k 输出 / 不支持推理 —— 实测 `getModel('mygw','auto-glm-5-3')` 返回 `ctx=128000, maxTokens=16384, reasoning=false`，而 `zai/glm-5.3` 是 `1000000/131072/reasoning=true`。因此 Provider 模型条目新增「实际模型」：保存时按目录解析，把 `reasoning`、`thinkingLevelMap`、`contextWindow`、`maxTokens`、`input` 写进 `models.json`；目录没有、或同名跨多个 provider 时拒绝并返回候选，不落数据。价格不复制（网关的商业事实）。实测 `zai/glm-5.3` 解析后写入 `ctx=1000000, maxTokens=131072, reasoning=true, thinkingLevelMap`，Models 页对应角色随即出现思考等级下拉。新增方法 `config.catalog`（1535 条 / 43 provider，单次读取，只有 Providers 编辑器用）。用例：服务端 387（+4：别名落盘真值/未知与歧义拒绝且不写/裸名与勾选并存/目录接口分组）；浏览器新增「a gateway alias can name the real model, and the effort follows it」（从目录取真实推理模型 → 建别名 → 事实行出现、勾选消失 → `config.get` 的 ctx 与目录一致、thinkingLevels>1 → Models 页该行出现等级下拉）。视觉实测 1440/390：事实行 `Supports reasoning · ctx 1M · out 131k`，手机移除按钮在首行 |
| 选择题自填答复被拒绝 | Passed | 现场：用户在选择题里点「自行输入」写下自己的答复，面板报 `Could not answer: INVALID_ARGUMENT: the answer is not one of the offered options`（截图）。原因：`answerIssue` 只接受原选项，而 UI 从 `rowsFor` 起就为每个 select 追加「输入其他答案…」一行——入口承诺了服务端不承认的事。契约按用户决定修订：select 接受**非空字符串**（选项之一或用户自填），原样保存并交回模型，不映射成选项；空答复仍拒绝（沉默不是选择）。另修：点「自行输入」后光标没有进入输入框（`draftFor` 置位使自动聚焦条件失效，用户要继续点一下输入框才能打字），现在 `other` 打开即聚焦。用例：服务端「accepts a typed answer that is not one of the options, and refuses an empty one」（原严格用例改写）；浏览器「a choice can be answered in the user's own words, not only from its options」（点「自行输入」→ 断言已聚焦 → 输入长句回车 → 回显与 `.askline ok` → 模型继续） |
| 全套测试（移动端） | Passed | 浏览器 50 用例；单测 375（服务端）+ 50（webapp）；两侧 `tsc --noEmit` 无错误；`npm run build` 成功 |
| 全套测试（查看器） | Passed | 浏览器 47 用例（含顶栏「文件」入口：未打开项目时禁用、打开后进入根目录、**打开期间只有文件标签 current**、**点击会话标签关闭画布并显示会话**、**目录与文件用字形+尾斜杠+`data-type` 区分**、关闭不改地址）；单测 375（服务端，含新增 7 条字节路由安全用例）+ 43（webapp，含 5 条文件类型判定）；两侧 `tsc --noEmit` 无错误；`npm run build` 成功 |


| 模型选择器（目录直选 + 模糊匹配） | Passed | 现场：`group/auto-deepseek-v4-1-flash` 在 Providers 里既没填「实际模型」也没勾选推理，于是 Models 的思考等级只显示「不支持推理」。实测该网关（127.0.0.1:3425）接受 `reasoning_effort`：不传 → `reasoning_tokens: 0`；`low`/`high`/`max` → 有 `reasoning_content`；`medium`、`bogus` → 静默忽略（网关不报错）。Pi 目录里 `deepseek-ai/DeepSeek-V4.1-Flash` 的 `thinkingLevelMap` 正是 `{off:none, minimal:null, low:low, medium:null, high:high, xhigh:null, max:max}`，与实际行为一致 —— 说明「能否配 effort」完全由 `reasoning` + `thinkingLevelMap` 决定，与模型 id 无关。因此把「实际模型」自由文本 + 推理勾选换成一个**目录选择器**：输入片段模糊匹配 `provider/id 显示名`（连续命中 > 分散命中，靠前 > 靠后，同分短名优先；`d4f` 命中 `DeepSeek-V4.1-Flash`），`↑/↓/Enter/Esc`/点外部完整键盘与鼠标行为，最多 40 条。选中即完成全部声明：`config.catalog` 现在返回每个模型的 `name`、`api`、`thinkingLevels`（= `supportedThinkingLevels`），保存时按 `catalog` 解析并把 `reasoning`、`thinkingLevelMap`、`contextWindow`、`maxTokens`、`input` 写入 `models.json`，同时写 `upstream: {provider, api, baseUrl}`，使 Pi 按真模型协议发请求（不再沿用端点 wire format）。端点自己的 id（`auto-glm-5-3`）仍保留：已输入的 id 不会被选择覆盖，留空才用目录名。schema v13（`providers.models` 增加可选的 `upstream`，无列变更） | 
| 迁移阶梯 | Passed | 新增 schema 版本时发现：新库走 `user_version = 0` 分支直接建到 `SCHEMA_VERSION`，老库走阶梯，两处都要改。改为**新库也走阶梯**（0 → 建表并盖 1 → 逐级），阶梯的 v2 步骤加列前先查列，避免新库重复加列。另修正一处误判：v12 → v13 的阶梯项写漏，导致 `user_version` 停在 12 时报不支持 | 
| 全套测试（模型选择器） | Passed | 服务端 34 文件 388 用例；webapp 8 文件 57 用例（新增 7 条模糊匹配用例：空查询保序、连续命中、分散命中、按 provider 收窄、排除自身 provider、不命中返回空、紧致匹配优先）；浏览器 54 用例；两侧 `tsc --noEmit` 无错误；`npm run build` 成功 |

| Provider 编辑改为弹框 | Passed | 现场：provider 列表很长时点第一行的「修改」像没有反应 —— 表单是追加在列表末尾的一块，开在折叠线以下。改为 `role="dialog"` + `aria-modal="true"` 的弹框（`min(880px, 100vw-32px)`，`max-height: 86vh`，主体滚动 + 底部按钮常驻），带焦点陷阱，`Esc` 关闭；列表首行按钮始终可见。实测 8 个 provider 的列表：点第一行后弹框顶部 y=118、底部 844（视口 800→切 1280×800 时整块在视口内），框内直接显示 `gw-0` 与名称 `gateway 0`。选择器列表改为 `position: fixed` 并按输入框矩形定位（滚动/resize 时重算），因此不再被弹框的滚动容器裁掉；展开时 `Esc` 只收列表（`stopPropagation`），收起后再按 `Esc` 才关弹框 —— 否则一次 `Esc` 会连未保存的编辑一起丢弃。保存成功走外壳 toast，失败则错误留在框内。窄屏（390px）实测：字段单列、模型行 id 与选择器上下堆叠、移除按钮独立一列。浏览器新增用例「the provider editor opens as a dialog, not below a long list」（8 个 provider、首行编辑、弹框完整在视口内、`Esc` 分层、保存后关闭并更新列表） |

| 改思考级别后全部失败（协议被覆盖） | Passed | 现场：用户为 `openai` provider 里的 `group/auto-deepseek-v4-1-flash` 从目录选中模型后，所有请求失败，网关侧也报错。根因：上一版把目录条目的 `api` 一起写进了 `models.json`（该目录条目属于 Pi 的 radius 供应商，`api: pi-messages`），而该 provider 自己声明的是 `openai-completions` —— 实测 `ModelConfig` 读回的结果是 `model.api = "pi-messages"`，即 Pi 用 Pi 自己的消息协议去请求一个 OpenAI 兼容网关（`127.0.0.1:3425`），端点与网关两侧同时失败。与思考等级本身无关：`writeProvider` 现在只复制能力事实（`reasoning`/`thinkingLevelMap`/`contextWindow`/`maxTokens`/`input`），模型级 `api`/`provider`/`baseUrl` 一律不写；`providers.models.upstream` 只是 `provider/model` 字符串，供配置页回显。修复后本机实测：`levelsFor` = `off/low/high/max`，真实 Session 在 `off`、`high`、`max` 三档各跑一次都返回 `OK`；网关直连 `max_tokens: 32768 + reasoning_effort: high` 正常返回 `reasoning_content`。已修复用户磁盘上的 `models.json`（移除被写入的 `api: pi-messages`、`provider`、`baseUrl`，备份 `.agentdev-data/models.json.bak`）。回归测试补到两层，均已在旧实现上验证会失败：① 保存路径（`config.save` → 目录选型 `catalog`/`baseModel` → `models.json`）断言落盘条目不含 `api`/`provider`/`baseUrl`，并用 `ModelRuntime` 读回确认两个模型都以 `openai-completions` 序列化；② 加载器（直接给 `writeProvider` 传带 vendor 身份的模型定义，即旧代码产生的形状）断言任何形状都不会写出模型级协议。此外把原有的「写入目录数字」用例从 `JSON.parse + toMatchObject` 升级为经 `ModelRuntime` 读回后的完整断言（`api`/`provider`/`baseUrl`/`reasoning`/`contextWindow`/`maxTokens`/`thinkingLevelMap`/`input`），并在 [实现检查 I6](implementation-checks.md#i6-写给-pi-的文件必须由-pi-的加载器读回验证) 固定「写给 Pi 的文件必须由 Pi 的加载器读回验证」。 |

| 用量统计（P-07 / AC-37） | Passed | 需求：合计、按角色、按模型，各自可按项目与全部项目查看。实现为追加式账本 `usage_entries`（schema v14，`(inputId,providerId,modelId)` 主键），**不在流式过程中写库**：每次输入结束时把本次新增的 assistant 响应按响应自带的 `provider`/`model` 归并成每模型一行，在写输入终态**之前**一次事务写入（崩溃时已花费的 tokens 仍记账，重放因主键幂等不翻倍）；统计一律 `SUM()/GROUP BY`，不维护累加计数器。实测：stub 网关（每响应 `prompt_tokens:1, completion_tokens:1`）连发两轮对话后 `usage.report` 返回 `responses=2, inputTokens=2, outputTokens=2`，`byRole=[chief:2]`、`byModel=[stub/stub-1:2]`，项目作用域与全部项目一致；界面三张表列宽固定、上下堆叠，数字落在同一垂直轨道，320px 下只保留四列仍完整不溢出。口径细节：Pi 把 `usage` 初始化为 0 且只在服务方上报时填充，因此**全 0 视为未上报**、记 NULL 并显示 `—`（请求数仍计入）；成本为 0 同样视为「无目录价」而不是免费。单测 13 条（账本 6 + 归并与「未上报」判定 7），浏览器 1 条（真实对话 → 页面 → RPC 双作用域）。 |

| 长跑任务中看不到用量（改为每次响应刷新） | Passed | 现场：用户重启后开始开发任务，用量页一直是空的。查现场：`usage_entries` 0 行，而 `session_inputs` 里两条输入（主管 22:27、成员派发 22:30）都还是 `processing` —— 旧实现只在输入结束时写，而派发成员的输入可能跑十几分钟，于是"任务在跑"与"没有任何数字"同时成立，读起来就像没在统计。修复：① 每完成一次 assistant 响应（`message_end`，仅 assistant 消息）就把**该输入的绝对累计值** upsert 一次，输入结束时再写一次最终值；② 写入改为 upsert，重复刷新不翻倍；③ 失败的输入也在 `finally` 里刷新（已完成的响应真实付费）；④ 用量页在可见时每 10 秒重读、切回前台立即重读（与需求看板同一模式）。实测（stub + 真实工具轮）：一次输入两次响应共 3 次写入 `[{responses:1,tokens:1},{responses:2,tokens:2},{responses:2,tokens:2}]`，最终 2 —— 中途可见、结尾不多算。真实网关（用户自己的 deepseek 网关，临时 store）跑一轮：`responses=1, inputTokens=9669, outputTokens=2`。单测 14 条（新增"中途刷新被更大的最终值替换，仍是一行"）。 |

| 同一条回复显示两次（重连后合并） | Passed | 定位过程中（排查用量页空白时跑全量套件）手机用例出现 `strict mode violation`：`article.m.chief` 解析到两个元素，`data-entry-id` 分别是历史条目与 `live-21`，内容相同。页面快照显示当时连接已断开并重连 —— 顺序是 `message_start` → 重连快照已含该轮（磁盘副本）→ `message_end`；完成帧走"替换 live 条目"分支，于是磁盘副本与刚完成的 live 条目各占一条。修复：`message_end` 的三条路径统一去重——若快照已有同签名（角色 + 块序列 + 文本）的非流式条目，保留快照自己那条、丢弃 live 孪生；无 live 条目且已有同签名条目时不再追加；仅"流在中途接入"这种情况才追加。新增 3 条 reducer 用例（快照先到、重连后完成、真新轮仍追加），`--repeat-each=8` 全绿；修复前 6 次跑出 1 次，8 次跑出 2 次。 |

| 用量页视觉重做（三层结构） | Passed | 反馈：原页面「表格太难看、角色与模型分类不明显、间隔难看」。原因：三张同构网格上下堆叠，合计也是一行数据，分组只靠一行 `f3` 灰字，标签与数字同为等宽同色，视觉上没有层级。改为三层：① 首屏三个数字（请求数 / Tokens / 成本，20px 等宽）＋一行分项（输入/输出/缓存/推理）；② 两张独立面板（边框 + 深色标题条 + 右侧计数），与表格列头（大写灰字 + 细线）形成两级对比；③ 真正的 `<table>` + `<th scope>`，五列（名称 · 占比条 · 请求数 · 输入 · 输出 · 成本），数值列按内容收敛、名称列固定占比、剩余宽度给占比条——「谁用得最多」由条形直接回答。实测截图（1280×900 与 390×844，五个角色 / 三个模型的真实数据）核对：模型 id 完整不截断、三张表数字右对齐同一边缘、面板间距 16px、窄屏隐藏输入/输出两列且不溢出。顺带修掉一个隐藏缺陷：`--s5` 这个间距令牌从未定义，导致 `padding: var(--s4) var(--s5)` 整条声明失效（合计卡片内容贴住上边框）——全部改用已存在的 `--s4`/`--s6`。 |

| 外部 Agent 接入（MCP，X-01～X-08） | Passed | 实现：`src/mcp/{main,protocol,http,control,runs}.ts`（stdio + `/mcp`，同一个 router/store，无第二套业务规则）；schema v15 加 `sessions.channel` + 部分唯一索引；R1 新增 `session.open`、`interaction.list`，`session.input.get` 支持只给 `inputId`，`task.get{includePlan}` 与摘要 `sourceInputId`；进度推导 `src/runtime/task-progress.ts` 与浏览器 `task-flow.ts` 由 `test-fixtures/task-progress.json` 双向钉住（两侧单测读同一份 fixture，服务端侧发现并修掉「空 frontier 组被当成已完成」）。测试：服务端 41 文件 435 用例（新增 `task-progress` 8、`mcp` 2、`mcp-protocol` 8、`mcp-runs` 6、`mcp-http` 3、`mcp-instance` 1，另 `store` 迁移与 `server-read` 会话/交互各加用例）、webapp 10 文件 70 用例、浏览器 56 用例、两侧 `tsc --noEmit`、`npm run build` 全绿。真实客户端：Codex 0.155.1 与 Claude Code 2.1.310 各用 stdio 连到同一 workbench（stub 模型），三件套调用链 `delegate → status → read` 均成功，读回 stub 答复原文（`GATE-ANSWER…`）。实测两点值得记：① Codex 在 `approval: never` 下直接拒绝调用 `agentdev_delegate`（`destructiveHint` 触发的宿主批准策略），说明注解是生效的，宿主必须显式放开；② Claude Code 的 `read(kind=transcript)` 同时看到了 Codex 那次委派的内容——固定会话共享上下文（X-02 的预期语义），因此实现改为按 `inputId` 过滤本次运行的条目，并在整段条目都带归属但都不属于本运行时返回空集，而不是退回尾部。独立评审后另修三处：stdout 在重启带未完成工作时被启动诊断污染（改为 stderr 日志汇）、第二个 MCP 进程会在同一库上再开一个 workbench（改为实例记录 + 附着，绑定配置端口）、`cancel` 对暂停中的 Task 不下发控制（改为所有非终态都走 `task.control`）；同时把「成员是否通过」的正式报告 verdict 合并进 `taskProgress` 与浏览器 `flowOf`/成员行，两个接入面对同一份复核结论给出同一答案（fixture 增加「复核完成但报告未通过」用例，成员行另有单测）。未覆盖：Grok（未安装）；`/mcp` 经 TLS/反向代理；真实模型跑完整的 write Task 流程 |

未覆盖：Windows 下微软雅黑回退的实际观感（本环境仅 macOS/Chromium）；返工轮次由真实长跑 Task 观察（自动化以 `task.get` mock 驱动，服务端零改动，风险在分组算法已由用例锁定）。

## 2026-10-28 · 前端：主管运行指示与发送回显（浏览器实测）

**现象（用户实测）**：①频繁对话中「The chief is working…」经常性消失；②输入「继续」后主管已在等模型，但转录里既没有「继续」也没有运行指示，刷新后才出现。

**根因**：①运行指示的渲染条件是 `busy === 'processing' && !live`，而 `live` 由「有任一消息在 streaming」得出；助手消息从 `message_start` 到 `message_end` 全程 streaming，于是指示恰在真正干活时被抑制（探针：一轮内 `working` 值 300ms 起即为 true，指示却始终不出现）；②Pi 在**运行开始**时才写用户轮，`session.input.submit` 受理到 `turn_start` 之间流与快照都没有这条消息——客户端此前只把 `inputAccepted` 用于 STOP 目标，从不画出来。

**修复**：①指示改为「会话不空闲即显示」，位置在流式正文之后（停手中圆点静止变暗）；②新增 `pendingEcho`：受理后立即按提交内容画成用户行，历史出现该 inputId（或 `turn_start`）即撤下，同一条消息永远一行；③`agent_end` 后面还有排队输入时回落为 `queued` 而不是 `idle`；④排队轮询把服务端回答的 `activity` 采纳到本地（队列清空但事件没到的情形）；⑤回显图片用附件 id，渲染时补成 `/api/v1/attachments/<id>`。

**证据**：新增浏览器用例「the working line stays on screen for the whole turn, driven from the composer」——真实输入框发送，断言发送后与正文流式中指示都在，运行结束才消失；把渲染条件改回 `&& !live` 时该用例失败（已实测），证明它钉住的就是这个退化。单元侧新增 `webapp/test/transcript-busy.test.ts`（streaming 正文存在时指示仍渲染；空闲时没有）。浏览器 57 用例、服务端 435、webapp 72、两侧 `tsc` 与 `npm run build` 全绿。

**未覆盖**：受理到 `turn_start` 的窗口在脚本化模型下只有毫秒级，自动用例无法在其中取样（`kind: 'hang'` 会让关闭流程挂住），回显由单元与失败前/后的实机现象支持；真实模型长思考时的观察仍靠用户实机。

## 2026-10-28 · 暂停 Task 不再冻结主管会话

**现象（用户实测）**：一个会话卡住；唯一 pending 输入 `c-mvrpgbc4-25-271cab` 长期 `queued`、`claim=0`。现场：`t-b41cb0ec.status=paused`，会话 `currentTaskId` 仍指向它，全库无 `processing`/`interrupted`。

**根因**：`Store.claimNextInput` 只看 Task 状态和 `investigator + expectedKind=recovery` 例外，主管自身输入（`task_sessions` 无行）在 Task 暂停时一律 `controlled`；`InputRunner` 原样返回、worker 每 250ms 空转。与 S3「chief 自身已停稳且无未核实中断时，Task 暂停不阻止其状态/控制/恢复输入；项目写 op 仍拒绝」不符。前端提交前总带 `currentTaskId`，所以聊天无法自行恢复，只有 Task 条上的 Resume 可用。

**修复**：①暂停/暂停中（`paused`/`pausing`）且会话是该 Task 的 `chiefSessionId` 时，`user`/`system_notice` 输入照常认领；`cancelling`/`cancelled`、成员工作、未核实 interrupted 的拒绝不变；②chief 在 `pausing`/`paused` 时的工具集移除 `write`/`edit`/`bash`/`requirement`/`project`（与 read Task 同一形态），resume 后恢复；③`task(op=get)` 在暂停期返回 `context.writeHold='paused'` 与一句说明。

**证据**：真实服务 + 真实 worker + 脚本化 SSE 模型：模型自建 Task 的会话，暂停后新消息 `queued→processing→completed`，该轮模型请求工具表为 `read,grep,find,ls,task,question,web_search,web_fetch,browser`（无写工具），resume 后恢复 `bash,requirement,project`；Task 在首轮前即暂停时同样成立。成员仍 `TASK_CONTROLLED`、cancelled 无主管轮次、cancelling 仍拒绝、真实崩溃重启后仍 `RECOVERY_REQUIRED`。单测 42 文件 444 用例、`tsc --noEmit` 全绿；在 HEAD 工作树上仅覆盖新测试时，5 个新用例按预期失败（tool-sets 1、store 1、task-tools 1、runtime 3）。详见 `.agentdev/work/paused-chief-input-20261028/`。

**未覆盖**：暂停期是否需要保留 `requirement`/`project` 的只读 op（当前整工具移除，产品未要求）；暂停轮与恢复轮的实例身份只在单测验证（`startWorkbench` 不暴露 registry）。一轮独立测试曾报“复用实例仍带 bash”，复核为按请求序号取错轮次的测量假象：按轮次文本关联后不成立。

## 2026-10-28 · 状态栏上下文占用

**需求**：主管 chat 中能直接看到当前模型的上下文窗口与已用占用，不需要打开设置页或读日志。用户确认：位置=状态栏模型区；只显示上下文占用；无实例时显示 `— / 窗口`。产品行为见 C-03、验收 AC-43、UI U2、M4 与 R1 快照字段。

**实现**：`AgentSession.getContextUsage()` 为权威估算；`contextOf` 活实例优先，无实例时按上次运行模型（否则当前设置）取目录窗口并标 `live=false`；快照带 `context`，assistant `message_end` / `compaction_end` 后在 microtask 发布顶层 `context` 通知（避开 Pi 先广播后 append，并保证观测失败不影响 run）。前端 slot 合并并在状态栏渲染 `已用 / 窗口 · 百分比`；≥70% warning、≥90% danger；压缩后 `?`、无实例 `—`；≤560 只留百分比，≤480 隐藏分支，≤400 隐藏运行计数，模型最后才收缩、快捷键提示先让位。

**证据**：真实服务 + 真实 Chromium + 脚本化 provider：桌面 `2 / 128k · 0.0%`（role=meter，title 含 estimated/auto-compaction）；用量递增 provider 下 12k→38k（9.4%→29.7%）；重启后 prepare 返回 `{tokens:null,contextWindow:128000,percent:null,autoCompaction:null,live:false}`，config.get 不变；390/320 可见且仅百分比、无横向溢出；拥挤 + 长模型名在 401/430/480/561/650/861 连接词均在栏内。单测 43 文件 453 用例、webapp 12 文件 79 用例、两侧 `tsc` 与浏览器 57 用例通过。详见 `.agentdev/work/context-meter-20261028/`。

**未覆盖**：真实触发压缩后的 `?`、真实 70/90 颜色（由 SSR 单测覆盖）、真实成员运行/真实断线（几何用注入同形节点）、中文字符串窄屏宽度。

## 2026-10-28 · 主动与手动压缩

**需求（用户确认）**：全局配置“达到窗口百分之多少时自动压缩”，默认 70%；在下一条消息开始前执行；保留 Pi 原生兜底；点状态栏上下文档位手动压缩。见 C-03、AC-44、P-07 与 UI U2/Models。

**Pi 默认**：`compaction.enabled=true`、`reserveTokens=16384`、`keepRecentTokens=20000`，阈值 = `window - reserve`（1M→98.4%、200k→91.8%、128k→87.5%）；每次模型请求前与每轮结束后检查，溢出另有一次恢复压缩；手动 `compact()` 先 abort 当前操作。默认适合作为安全网，不适合作为可预期的主动策略。

**实现**：SQLite v16 `compaction_settings` 单行（默认自动/70%/revision）；`compaction.get/save`；runner 每会话压缩锁，认领后、交付前按全局阈值调用 Pi `compact()`；手动 `session.compact` 在空闲、无未核实中断、有活实例时执行；快照与 `compaction_start/end` 驱动“压缩中”，重连也可恢复。

**证据**：服务端 45 文件 469 用例、webapp 12 文件 80 用例、浏览器 59 用例、两侧 `tsc` 全绿；真实浏览器保存 70→85 并刷新/新上下文保持、关闭开关后保持、40% 保存被拒；空闲面板“立即压缩”小会话返回 nothing，运行中按钮禁用，重启后无实例禁用并说明；真实服务 + 自定义 provider（80k prompt / 100k window）第二条输入前发出 `compaction_start/end` 且两条输入均完成；5×40k 字符历史手动压缩返回 `{status:'compacted',tokensBefore:60811,estimatedTokensAfter:30548}`，面板显示 `60.8k → 30.5k`，随后占用 `?` 并在下一次响应恢复 30.8%；v15→v16 升级测试断言默认行与 `user_version`。

**未覆盖**：压缩调用的 tokens/成本未进入用量 ledger（既有缺口，Pi 的 summary 调用不是 assistant message）；真实成功压缩需要足够历史，小会话只验证 nothing 路径；压缩摘要未做超时/退避；真实 98% Pi 兜底只按 SDK 逻辑核对，未在浏览器触发。

## 2026-10-28 · write Task 内的只读调查报告

**问题**：write Task 可在 clarify/analyze/design/plan 派发 investigator，但 `recordResult` 只允许 write 的 design/implementation/review/test/settlement；`reportTarget` 又把所有 write 报告写项目。于是只读 investigator 的 investigation 报告被拒，且若放行还会把只读证据写进项目。

**修正**：write Task 接受 investigator 的 investigation/recovery 结果；这两类报告按内容而不是 Task 类型写 Server `work/<taskId>/<sessionId>/`；它们只作证据，write 的完成仍只认 settlement。`agent_report` 仍是宿主保存，investigator 不需要项目写工具。

**证据**：`test/report.test.ts` 新增 write Task + investigator + investigation 用例，断言报告保存且 `bodyRef.storage=server`、项目 `.dev/work` 不产生目录、`taskCompletionGaps` 仍要求 settlement；服务端 471 用例全绿。

## 2026-10-29 · dispatch 超时后的继续等待

**现象**：Task `t-68e3cfbd` 在 develop 阶段看起来停住。实际是成员仍在运行编辑/测试，`dispatch` 等满窗口返回 `timeout` 快照；主管随后发了状态说明并结束回合，成员停稳后没有输入再推进 Task。该会话最后一次压缩在 02:58，当前这轮从 04:36 开始，之后无 compaction 事件，不是压缩导致。

**修正**：`task` 工具描述、`dispatch` 的 timeout 回执 `hint`、`prompts/chief.md` 与 G2 合同均明确：timeout 只是快照，不是报告或停止；成员仍在运行/排队/等用户时，必须在同一回合再次 `task(op=dispatch)` 空名单等待，不得以状态说明结束回合。不新增宿主自动唤醒，不改变等待时长或取消语义。

**证据**：`test/delegation.test.ts` 两个 timeout 分支（空名单、创建+等待）都断言 `details.hint`；服务端 45 文件 471 用例、`tsc`、构建通过；独立 Review 通过（唯一非阻塞项为第二个分支缺断言，已补并复核）；独立测试用真实工具调用确认 hint 出现在模型可见正文和 `details`，`completed` 不带 hint。

**未覆盖**：真实模型是否遵守该指令未验证；这是提示层修正，程序不强制模型继续。需要时另加宿主级“步骤停稳后唤醒主管”机制（会新增自动模型回合，属产品行为变化）。

## 2026-10-29 · 同项目两个会话互相阻塞

**现象**：同一项目里一个会话在运行时，另一个会话提交的消息一直不运行；不是消息被拒绝，而是排在全局串行 worker 后面。

**根因**：`WorkbenchWorker.run()` 对每个 session `await runner.runNext(sessionId)`，一个 Pi run 不结束就不会扫描下一个 session。成员由 `task` 直接 `runNext`，但另一个主管会话的用户输入只能等前一个 run 完成。另有并发创建 `ModelRuntime` 的竞态：两个会话同时首次运行时可能各建一个 runtime。

**修正**：
- worker 每个 session 至多一个 run，不同 session 并行启动；idle/busy/controlled 结果不唤醒循环，避免空转；`stop()` 等所有在飞 run 结束；单个 session 的 runner 异常经 `onError` 隔离。
- `PiRuntimeFactory.runtime()` 缓存**创建中的 Promise**，并发会话共享一个 `ModelRuntime`；创建失败可重试。
- `onError` 按 session+原因去重，避免每个空转周期重复日志。
- 测试修复：`server-write` 的等待器只移除匹配项，不再被无关的 idle outcome 清空。

**证据**：`test/worker.test.ts` 4 例（并发启动、同会话不重入、stop 等待在飞 run、单会话异常隔离）；`test/runtime-factory.test.ts` 并发 runtime 同一实例；`test/server-write.test.ts` 16 例；定向 3 文件 21 例通过；全量 47 文件 476 例中 474 通过，2 个 `git-commit-gate` 在并行负载下 5s 超时，单文件复跑 23/23 通过，且在 HEAD 基线同样复现，属主机负载 flake。

**未覆盖**：没有通过真实 HTTP/worker 同时提交两个主管会话的 E2E；并发启动由 worker 单测证明。专业 Session 并发上限仍未由程序强制（既有缺口，和本次两个主管会话相互阻塞不同）。

## 2026-10-31 · Task 结束后排队中的主管消息被丢弃

**现象**：用户与主管的对话在队列里（Task 或主管上一轮仍在运行），Task 结束后这条消息没有运行，也没有任何反馈。aisuangua 现场：`s-7f07dfca29b5` 的 `c-mvv6kpir-2230-a9abe0`（`task完成后，不需要我确认直接按照你的计划进行下一个需求实现`）在 Task `t-12db109f` 完成的同一秒被写成 `stopped` / `TASK_ENDED`，从未进入主管。

**根因**：`Store.claimNextInput` 的队列清扫把「`taskId` 指向已 completed/cancelled Task 的 queued 输入」一律关闭，不区分作者。用户消息在 Task 运行期间被关联到该 Task，Task 一结束就被当成孤儿 Task 工作清掉；暂停分支里已有的「主管自己的回合不算 Task 工作」豁免没有覆盖终态 Task。

**修正**：清扫只关闭真正的 Task 工作；当输入是**该 Task 主管会话自己的 `user`/`system_notice` 回合**时保留并投递（R3：新话题排队到 Task 结束，而不是被丢弃）。`TASK_CONTROLLED` 门禁对终态 Task 同样放行主管回合（终态指针本应在 `endTask`/`controlTask` 同一事务里清空，这里是防御性一致）。成员 `continuation` 等 Task 工作仍按原规则以 `TASK_ENDED` 关闭。

**证据**：`test/server-write.test.ts`（主管消息在 Task 取消后仍被 claim 并运行、成员工作被关闭）、`test/store.test.ts`（引用已取消 Task 的主管迟到回合被投递）；真实 `state.db` 副本按现场行形状插入 queued 主管消息后 `claimNextInput` 返回 `claimed`（修正前为 `stopped/TASK_ENDED`）；全量 47 文件 477 用例、`tsc --noEmit` 通过。

**未覆盖**：已停止的历史消息（`c-mvv6kpir-2230-a9abe0`）不会自动恢复；是否重新投递由用户决定。真实浏览器里「排队中回显 → 投递」的视觉链路未重跑。

**独立复核**：Review `passed`（无阻塞项）；Test 定向 4 文件 52 用例、全量 49 文件 484 用例、`tsc --noEmit` 通过；证据归档 `.agentdev/work/chief-session-continuity-20261031/`。

## 2026-10-31 · 报告晚到后主管不再推进（宿主唤醒）

**现象**：Task 运行中，主管回合因等待超时/看门狗/模型失败先结束；成员随后交报告，主管不推进，直到用户发消息。aisuangua 现场：主管通知回合 14:52:07 结束，dev 输入 15:29:00 完成、报告 15:28:36 落库，主管其后 43 分钟没有任何输入，15:35:26 用户消息才恢复推进。产品决定（本轮确认）：新增宿主级“步骤停稳唤醒”。

**根因**：`settleStep` 是主管回合内的内存轮询（`src/runtime/runner.ts`），回合结束即消失；成员报告只经 `hub.publish(invalidate)` 到浏览器（`src/server/main.ts`），不写任何输入；`WorkbenchWorker` 只调度有 queued 输入的会话。唯一自动恢复只覆盖主管输入被写成 `interrupted` 的情形（看门狗 → `notice-host-closed-*`）。

**修正**：新增 `src/server/step-wake.ts`，在任意输入到达终态后（`main.ts` 的 `onOutcome`）检查该 Task：状态 active/waiting、当前步骤成员全部停稳（queued/processing 之外）、主管没有任何 queued/processing/interrupted 输入、且这个步骤尚未通知过，则为该步骤投递一条 `system_notice` 并投递给主管会话。通知 id 由 Task 与该步骤成员输入集合散列得出，一步只唤醒一次；通知只给主管一次回合，不推进阶段、不判定完成、不重放任何成员工作。主管仍在运行时跳过（它自己的 `settleStep` 会看到成员结果），其回合结束时再次检查。

**证据**：`test/step-wake.test.ts` 6 例（唤醒、可被 claim、按步骤去重、成员未停稳/主管忙/Task 非运行/无步骤不投递、失败成员也唤醒）；`test/step-wake-e2e.test.ts` 真实 workbench + stub 模型：成员运行结束 → 宿主写入 `notice-step-t-1-*` → worker 认领并跑完主管回合；全量 49 文件 484 用例、`tsc --noEmit` 通过。契约补充见 `runtime-contract.md` R3。

**未覆盖**：主管若在唤醒回合里仍不推进且不改变步骤，这条通知不会重复投递（有意不循环）；浏览器里“自动唤醒回合”的视觉呈现未重跑；旧的 `notice-host-closed` 与本次唤醒可能在同一场景先后出现，目前靠主管忙检查避免叠加，未做专门去重测试。

**独立复核**：Review `passed`（无阻塞项）；Test 同上。非阻塞发现（暂停→恢复/queued 停止/恢复确认不触发唤醒、修复一缺少真实回合 E2E、interrupted 成员提示文案）处置待定，见归档 `review.md` 与 `settlement.md`。

## 2026-10-31 · 成员被看门狗中止后的自主恢复与主管等待计时

**现象**：Task `t-cb094c4a`（aisuangua）的 dev 成员 `i-56a31e98` 02:21:38 开始、03:51:39 被 90 分钟总时长中止为 `interrupted/RUN_TIMEOUT`；主管最后回合 02:42:17 已结束，之后没有任何输入，Task 停在 phase develop。若用上一版唤醒，通知会写「has no unfinished member work / no formal report was recorded」，与“执行情况未知”的事实不符，主管可能去 update/end 并被 `STAGE_NOT_READY` 拒绝。

**根因**：① 唤醒只分“停稳/未停稳”，`interrupted` 被视为停稳并走通用文案；② 主管在 `settleStep` 中等待成员的时间被计入它自己的 stall/total 窗口，任务只要超过 90 分钟，协调回合必然被看门狗中止（`c-mvuxl2dw` 现场）。

**修正**：① 抽出 `queueInterruptedMemberNotice`（`src/server/host-recovery.ts`）：id 固定为 `notice-<成员输入>`，启动扫描与运行期唤醒共用，文案列出错误码、说明结果未知并给出 `task(op=recover, sessionId, evidenceRefs, resolution)`；`step-wake` 在当前步骤含 `interrupted` 成员时只投该通知，不投通用通知。② `settleStep` 以 `sessionId + 当前 inputId` 标记 host wait，`promptWithWatchdog` 的 `waiting` 同时看它：等待成员的时间不再计入主管的停滞/总时长，模型自身生成仍计入；键含 inputId，旧回合遗留的轮询不会冻结下一回合。

**证据**：`test/step-wake.test.ts` 8 例（新增 interrupted 成员的恢复通知与 id/dedupe/可 claim，主管忙时延迟）；`test/runtime.test.ts` 新增「does not charge the chief for time spent waiting on a dispatched step」（total 500ms、stall 600ms，成员 900ms 后完成；去掉冻结即 `RUN_STALLED` 失败，独立测试在临时副本中复现）；全量 49 文件 487 用例、`tsc --noEmit` 通过；WAL 备份现场探针返回 `notice-i-56a31e98`（含 RUN_TIMEOUT 与 recover 指引），未生成通用通知。契约见 `runtime-contract.md` R3。

**未覆盖**：唤醒回合自身失败后的重试；成员 queued 但 blocked（缺模型/目录）；孤儿 processing 输入；浏览器视觉。

## 2026-10-31 · `task(op=recover)` 的 sessionId 被工具 schema 拒绝

**现象**：M1 开发会话的 `i-56a31e98` 被宿主中断后，主管每次 `task(op=recover, ...)` 都返回 `recover needs sessionId and evidenceRefs`；顶层 `sessionId`、`sessions[].sessionId`、`chiefSessionId`、`file:` 证据等组合结果相同。

**根因**：`task` 工具的 `parameters` 设了 `additionalProperties: false`，却没有声明顶层 `sessionId`，而 `recoverOp` 从顶层读取它。Pi 的 `validateToolArguments` 会拒绝不符合 schema 的调用（`sessionId: schema is false / must not have additional properties`），处理函数根本收不到参数。G2 早已写明 recover 接受 `taskId、sessionId、evidenceRefs、resolution`，属于实现漏项。

**修正**：在 `src/tools/task-tools.ts` 的 properties 中补顶层 `sessionId`（recover 专用描述）。逐 op 审计 schema 与 handler 读取字段，未发现其他缺项。

**证据**：`test/runtime.test.ts`「closes an interrupted member input through task(op=recover, sessionId)」走真实 stub 模型 → Pi 工具调用 → handler；修正前成员输入保持 `interrupted`（调用被 schema 拒绝），修正后变为 `stopped`。独立测试在 `/tmp` 副本删除该属性后复现失败，恢复后通过；全量 49 文件 488 用例、`tsc --noEmit` 通过。独立 Review `passed`，确认八种 op 的 schema/handler 一致。

**未覆盖**：recover 的其余错误分支（缺证据、非本 Task 成员、非 interrupted）未通过工具环覆盖；真实 provider 路径未跑。

## 2026-10-31 · dispatch 启动的成员结束后无人接收（含重启补唤醒）

**现象**：`t-cb094c4a` 的 test 成员 `i-825150fc` 在 06:36:57 完成（结果 `r-60d3e1ee` passed 于 06:36:51），主管回合 `c-mvvzd6h5` 已于 06:30:36 结束；之后没有任何主管输入，也没有 `notice-step-*`。WAL 备份探针证明 `wakeForSettledStep` 本可唤醒（`woken: true`），说明唤醒根本没被调用。

**根因**：`task(op=dispatch)` 通过 `runner.runNext(member)` 直接启动成员，运行不在 `WorkbenchWorker` 名下，worker 的 `onOutcome` 不会触发；主管回合结束后成员才结束时，既没有界面 invalidate，也没有步骤停稳唤醒。启动扫描也只处理 interrupted 输入，进程停止期间已停稳的步骤同样无人补回合。

**修正**：`RunnerOptions.onRunSettled` 在 dispatch 等待的 `runNext` 结束后上报终态；`main.ts` 抽出 `handleOutcome`，同时作为 worker 的 `onOutcome` 与 runner 的 `onRunSettled`。启动时为每个 active/waiting Task 调用一次 `wakeForSettledStep`（按 `notice-step-*` 去重；paused/completed 与未停稳步骤不投递）。

**证据**：`test/runtime.test.ts`「reports a member run the dispatch tool started after the chief turn ended」（删掉 `onRunSettled` 即超时失败）；`test/step-wake-e2e.test.ts` 新增两条真实 workbench E2E：dispatch 成员晚于主管回合结束（删除 main 的接线后 3/3 失败）、重启后已停稳步骤补唤醒（删除启动扫描后失败）；全量 49 文件 491 用例、`tsc --noEmit` 通过。独立 Review 两轮 `passed`（含 worker/dispatch 竞争、启动去重与 paused/completed 无副作用的实测）。

**未覆盖**：唤醒回合自身失败后的重试；成员 queued 但 blocked；浏览器视觉。

## 2026-10-31 · 续办成员后任务清单出现空的下一轮

**现象**：`t-cb094c4a` 在 test 通过后由主管把阶段退回 `develop`，并用 continuation 续办原开发 Session `s-ace2ab56` 修 P2。任务清单同时显示「开发（成员运行中）」和「开发 · 第 2 轮 / 等待主管派发」：续办成员仍按 `createdAt` 留在旧一轮，当前阶段又被追加为空 frontier。

**根因**：`listTaskSessions` 按 `createdAt` 排序，续办不改变成员在列表中的位置；`rosterGroups` 只在成员阶段序列末尾追加当前阶段的空组，无法把续办成员放进新一轮。外部 `taskProgress` 与浏览器共用这一顺序，因此两处一致地错。

**修正**：`listTaskSessions` 改按最近派发序（`updatedAt, createdAt, sessionId`）。`continueTaskSession` 会更新 `updatedAt`，续办成员因此排到已走过阶段之后，`rosterGroups` 将其归入新的阶段轮次，不再产生空 frontier；浏览器契约同步改为“按最近派发序”。

**证据**：`test/store.test.ts`「orders a continued member after the members dispatched while it was settled」在旧排序下失败、新排序下通过；`test-fixtures/task-progress.json` 新增「rework by continuing the same member after test」，服务端与 webapp 两侧的 flow 测试共同读取并通过；全量 49 文件 493 用例、webapp 12 文件 81 用例、`tsc --noEmit` 通过。对运行中的 `t-cb094c4a` 用新排序读取，步骤为 `develop#1 completed, review#1 completed, test#1 completed, develop#2 completed, settle planned`，无空步骤。

**未覆盖**：若某阶段只有这一个成员，续办后旧轮分组消失（轮号从 1 重新计），需要逐次派发行才能保留两轮历史；浏览器视觉未重启验证（运行中的服务仍是旧代码）。

## 2026-10-31 · bash 无默认超时导致 M7 开发 run 被 stall 中止

**现象**：`t-3892928a` 的旧开发 `i-7d2e0b42` 在 09:45:36 以 `RUN_STALLED` 停止（`no run activity for 908s (limit 900s)`），会话只有 1 次 task get、8 次 read、35 次 bash、**0 次 write/edit**，没有报告。重派 `i-a09f29dc` 在 17:48 又执行同样的 `node t.mjs`，17:58 手动结束挂起的 node 进程后恢复。

**根因**：最后一条 bash 命令用 `node -e` 加载 `react-dom/server.browser`，打印两行结果后进程不退出；Pi 的 bash 工具 `timeout` 可选且没有默认值，工具执行期间没有 Pi 事件，run watchdog 的 900 秒 stall 把整个 run 中止。复现原命令时 `timeout 8` 退出码为 124，确认是命令不退出而不是模型/Provider 停摆。

**修正**：`createBashTimeoutGuard` 在 `tool_call` 上为未写 `timeout` 的 bash 调用注入宿主默认值（默认 600 秒，`AGENTDEV_BASH_TIMEOUT_SECONDS` 可调，0 关闭；显式值优先）；`runner.ts` 与 `privatePathGuard` 一起安装。`step-wake.ts` 的步骤停稳通知在“watchdog stopped 且无报告”时提示续办原 Session，`guidance.ts` 的 `nextActions` 同样给出 `sessionId` 续办动作；专业 Agent 提示词补充“打印完不退出是 hang，不是长任务”。

**证据**：`test/runtime.test.ts`「bounds a bash command that omits a timeout, so a hang is a tool result not a stalled run」用真实 `sleep 2` + 1 秒默认值，run 以 `completed` 结束且工具结果含 `timed out after 1 seconds`；`test/tool-guard.test.ts` 覆盖空值注入、显式值不覆盖、非 bash 不处理；`test/step-wake.test.ts` 与 `test/delegation.test.ts` 覆盖 watchdog-stopped 的续办提示。`tsc --noEmit` 通过。

**未覆盖**：600 秒默认值对真实长构建的影响未实测；超过 15 分钟的静默工具仍会触发 run stall；环境变量未在重启后的服务上验证；浏览器无界面变化。

## 2026-11-01 · ignored 文件被当成交付导致 end 拒绝

**现象**：视觉任务跑完后 `.visual/**` 出现 2000+ 个被忽略文件，用户自己的 `dexprep涨跌.docx` 又被 `.git/info/exclude` 排除；end 把这些文件列为“交付里的 ignored file(s)”并拒绝。为了让 end 通过删除了 `node_modules`，随后每个 Task 都要重装依赖、重拷字体、重建 `.next`；删除语义还波及过用户文件。

**根因**：`snapshotDelivery` 遍历项目时只跳过 `.git`、`node_modules`、`.dev`，构建产物和用户自己的 ignored 文件都进入 Review 的 `deliveryState.paths`；end 再对这些路径执行 `git check-ignore`，于是“被 ignore 的文件”与“交付”被绑定在一起。检查本身在追一个上游矛盾：快照先收进了任何 commit 都带不走的文件。

**修正**：交付定义为 Git 能提交的文件。`snapshotDelivery` 用 `git ls-files --others --ignored --exclude-standard` 排除未跟踪的 ignored 路径；`deliveryCommitGaps` 对旧 Review 已记录的路径做同一过滤；已跟踪文件即使匹配 ignore 规则仍属于交付；未提交的非 ignored 源码仍按原缺项拦截。没有增加构建目录白名单，也没有删除任何环境或用户文件。

**证据**：`test/deliverable.test.ts`「leaves git-ignored untracked files out and keeps tracked files that match a pattern」用真实临时仓库覆盖 `.gitignore` 的 `dist/`、`*.tsbuildinfo`、`private.docx`、`.git/info/exclude` 的 `local.docx`，以及被 `git add -f` 跟踪的 `dist/tracked.js`；`test/git-commit-gate.test.ts`「does not count ignored files from an older review as delivery」覆盖旧 Review 同时含 ignored 路径和未提交 `src/a.ts` 时只报源码，提交后无缺项。全量 49 文件 500 用例、webapp 12 文件 81 用例、`tsc --noEmit` 通过。

**未覆盖**：运行中的服务仍是旧代码，尚未重启验证；嵌套仓库的 ignored 路径按所在仓库语义处理，未新增用例；Git 不可用时快照不过滤，end 仍按原有 unverifiable/缺项路径阻断；旧 Review 的 test digest 可能仍覆盖 ignored 路径，未做历史迁移。

## 2026-11-01 · 实时回复按内容去重被误删

**现象**：chat 已经实时显示回复，随后突然只剩更早的内容，最新几轮消失；刷新后从 history 文件恢复。触发与回复正文重复或前缀相同有关。

**根因**：`slot.ts` 的 `message_end` 用 `signatureOf` 在全部历史里找相同正文，命中即删当前 live 条目；`mergeMessages` 的 resync 也把内容相同或前缀相同的 live-only 条目当 stale twin。两处都没有检查 `inputId`，不同输入的新回复因此被当成旧消息的副本。

**修正**：新增 `sameTurn`：非 live entry id 相同，或双方 `inputId` 相同，才可能是同一条；不同输入一律不是 twin，双方都没有 `inputId` 时才保留内容兜底。`message_end` 的重复检查、快照合并的精确匹配与前缀匹配都走这条身份规则。

**证据**：`webapp/test/slot.test.ts`「repeated text across turns」覆盖三条：不同 input 的相同文字在 `message_end` 后保留；resync 不丢与旧回复重复/前缀相同的 live-only 完成条目；同一 input 的相同回复仍然去重。webapp 12 文件 84 用例、`tsc --noEmit` 通过；服务端未改动。

**未覆盖**：浏览器实际长连接/断线重连未重启验证；同一 `inputId` 内两条正文完全相同的不同助手消息仍无法靠 `inputId` 区分（需要服务端稳定消息 id，当前未做）。
