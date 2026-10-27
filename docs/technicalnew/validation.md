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
| 缺项覆盖三类事实 | Passed | 未提交；被 `.gitignore` 排除（`git add -f` 只在规则写错时）；内嵌仓库里的交付文件（在它自己的仓库核对，外层是否记录该仓库另算一条）。三类各自成缺项，不合并 |
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

未覆盖：Windows 下微软雅黑回退的实际观感（本环境仅 macOS/Chromium）；返工轮次由真实长跑 Task 观察（自动化以 `task.get` mock 驱动，服务端零改动，风险在分组算法已由用例锁定）。
