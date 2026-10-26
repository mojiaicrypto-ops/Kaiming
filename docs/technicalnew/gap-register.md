# 缺口登记（已实现界面 / 后端方法 / 合同）

日期：2026-10-22。口径：只登记**本轮实现与合同核对中能指出代码位置**的缺口。文档写了不等于实现；这里的每一项都是可复核的现象，不代替 [产品验收](../productnew/acceptance.md)。

维护规则：新增公开方法、删除界面入口、修正合同时同步本页；关闭一项时写清证据位置，不删除条目（改为「已关闭」并附提交）。

编号：`D`=已实现界面的缺陷，`S`=后端缺少的方法/字段，`C`=合同与实现不一致，`U`=服务端有方法但界面没有入口，`P`=最佳实践，`R`=风险。

---

## 本轮新增（2026-10-22，工具与图片）

| 编号 | 现象 | 证据位置 | 影响 | 处置 |
|---|---|---|---|---|
| N1 | Pi 原生只有文件/Shell 工具：没有联网检索、URL 取文和浏览器，测试角色只能自写 Playwright 脚本；reviewer/investigator 连 bash 都没有 | `src/runtime/tool-sets.ts`（改前无 web_search/web_fetch/browser）、`node_modules/@earendil-works/pi-coding-agent/dist/core/tools/` | 需求调研只能靠模型记忆；UI E2E 无统一证据 | **已关闭**：新增 `web_search`/`web_fetch`/`browser`，按角色授权，read Task 浏览器只读；真实模型 `npm run check:tools` 4/4 |
| N2 | 自定义 OpenAI 兼容 provider 写入 `models.json` 时未声明 `input`，Pi 按纯文本模型处理并**静默丢弃**图片 | `src/runtime/provider-store.ts`（改前 models 只写 id/name） | 用户上传图片后模型看不到，且无错误提示 | **已关闭**：写入 `input:["text","image"]`；真实模型图片问答通过 |
| N3 | 界面没有图片入口与渲染，工具返回的图片被丢弃 | `webapp/src/chat/`（改前无 image 分支） | 截图/上传都不可见 | **已关闭**：composer 上传、消息与工具卡图片渲染、`normalize`/`transcript-model` 支持 image 块 |

## 本轮结果（2026-10-22）

- **D** 9 项全部关闭；**S** 4 项关闭、1 项按原决定不做；**C** 4 项与实现一致；**U** 9 项补上界面、1 项不做。U4/U5 按用户决定采用简单形态，见 `.agentdev/work/workbench-gaps-20261022/questions.md`。
- **P** 按本轮实现执行：单请求列表、推送取代轮询、错误码文案、焦点管理、方法消费表（[UI 设计契约](ui-design.md#u9-方法消费)）。
- 验证：`npm test` 299 用例、`npm --prefix webapp test` 25 用例、`npm run test:browser` 25 用例、两处 `tsc --noEmit` 无输出；证据与未覆盖项见 [验证记录](validation.md)。

## D 已实现界面的缺陷

| 编号 | 现象 | 证据 | 影响 | 处置 |
|---|---|---|---|---|
| D1 | 模型设置切到「本项目」只改变**读**的解析范围，保存仍发 `roleId`：项目范围永远写不出项目级覆盖，反而写坏全局角色覆盖 | `webapp/src/settings/ModelsPage.tsx:42-46`（只传 roleId）；`src/server/methods.ts:243-245`（roleId/projectId 必须恰有一个） | AC-27「按角色/项目设置可辨认」不成立 | **已关闭** — 项目范围改为单行「本项目」写入 `{projectId}`；全局范围保留按角色行 |
| D2 | 需求抽屉的「实施 / 委派设计 / 修复」只弹一条提示，不打开会话、不预填 | `webapp/src/requirements/RequirementDrawer.tsx:97-102` | J-03 → J-04 的交接靠用户手抄需求号；与产品「选择需求进入 J-04」不符 | **已关闭** — 跳转到主管会话并预填「实施 \<id\>」；用户按下发送才算数（不代发） |
| D3 | 抽屉与项目对话框只把焦点移入，没有陷阱、关闭后不归还 | `webapp/src/app/Drawer.tsx:22-33`；`app/ProjectDialog.tsx:20-30` | Tab 会跑到遮罩后的页面；键盘用户失去位置 | **已关闭** — 加焦点陷阱与关闭归还；`aria-live` 给 Toast |
| D4 | 后台标签页仍在轮询：任务 3 秒、任务发现 2 秒 | `webapp/src/state/useSession.ts:231-263` | 长开标签页持续请求；离线/休眠后首个回调制造无意义读 | **已关闭** — `visibilitychange` 时暂停，恢复时立即读一次 |
| D5 | 会话列每行两次请求（`session.stream.prepare` + `session.get`），前者还会在服务端**建一个 30 秒订阅** | `webapp/src/state/useWorkspace.ts:111-142`；`src/server/hub.ts:71-88`（prepare → 订阅，TTL 30s） | 20 个会话＝40 次往返 + 20 个无用订阅；标题靠读整段历史 | **已关闭** — 由 `session.list` 一次返回（S2），删除客户端标题派生与 `titleCache` |
| D6 | 阻断横幅直接显示原始错误码，后半句是服务端英文原句（如 `blocked_config`） | `webapp/src/chat/Banner.tsx:41`；`i18n/catalog.ts:89` 只有 `banner.blocked` 一词 | 中文界面出现 `blocked_config` + 英文解释；用户看不出该去设置模型还是补角色 | **已关闭** — 按码映射本地文案（`blocked.config/role/project`），detail 作为次行；随 P3 |

## S 后端缺少的方法/字段

| 编号 | 现象 | 证据 | 影响 | 处置 |
|---|---|---|---|---|
| S1 | 没有 `project.list`：项目菜单只是浏览器本地最近路径 | 注册表无此方法（`src/server/methods.ts`、`read-methods.ts`、`write-methods.ts`）；`webapp/src/state/useWorkspace.ts:94-99` 注释自述 | 换浏览器/清存储后，已登记项目不可见（AC-01 的第二条路径仍要手输） | **已关闭** — 新增 `project.list`：id、realPath、revision、目录是否存在、会话数、任务数、最后活动、更新时间；项目菜单只用它，浏览器不再自带一份「最近」 |
| S2 | 没有 `session.list`：`project.get` 的 `sessions` 只有 id 与 roleId | `src/server/read-methods.ts:577-580` | 会话列无标题/活动/时间/任务，只能 N+1 读（D5） | **已关闭** — 新增 `session.list`：标题（由首条 user 输入派生，见 C1）、activity、lastActivityAt、currentTaskId、queuedInputs；一次一请求 |
| S3 | 任务创建与成员变化没有推送：`task` 工具没有发布钩子 | `src/tools/task-tools.ts:17-38`（`TaskToolContext` 无 invalidate）；仅控制/结束时由 `write-methods` 发 invalidate | 任务条依赖轮询；主管一次性建 Task 时界面最长 2 秒空白 | **已关闭** — Runner 增 `onTaskChange(sessionId, taskId)`，在 create/update/dispatch/control/end 后发布 `invalidate{task}`（并 `invalidate{session}` 供会话列刷新）；轮询降级为兜底 |
| S4 | `session.get` 不区分「正在停止」，也不返回本次运行的实际配置 | `src/server/read-methods.ts:513-543` | 状态栏无法显示 stopping；P-05「当前工作显示实际使用配置」没有数据入口 | **已关闭** — 增加 `stopping`（存在 stopRequested 的 processing 输入）与 `config`（来自当前输入的记录，见 C4） |
| S5 | `session.input.submit` 没有结构化需求引用 | `src/server/write-methods.ts:51-80` 只收 content/taskId | 需求交接只能靠文本提到 id | **不做**：文本 + `requirement` 工具已足够，且加字段会让「引用」出现第二处解释；见 D2 |

| D7 | 阻断原因只作为一次事件发送：在订阅建立前发生的阻断永远看不到（实测无模型时 3 次里 2 次横幅不出现） | `src/server/main.ts`（只 `hub.publish`）；快照与 `session.get` 都不含它 | 用户提交后没有任何反应，也不知道「没有模型」 | **已关闭** — 阻断原因进入 `stream.prepare` 快照与 `session.get`；有排队输入且没有运行时按 1.5 秒读一次（可见时），事件仍作即时通道 |
| D8 | 会话未订阅时 composer 仍可发送：这些事件到达不了任何订阅者，转录里看不到 | `webapp/src/chat/ChatPage.tsx`（`disabled={!hasProject}`） | 断线/刚打开时提交的消息看起来「消失」 | **已关闭** — 连接态不是 connected 时禁用发送（草稿保留），顶栏给出连接状态 |
| D9 | 阻断横幅在 390px 下不可收缩，长原因把页面撑宽 12px | `theme/base.css` `.bn` 无 `flex-wrap`，详情不可断行 | 窄屏横向滚动 | **已关闭** — 横幅允许换行、详情可断行、按钮不收缩 |

## C 合同与实现不一致

| 编号 | 合同写法 | 实现 | 处置 |
|---|---|---|---|
| C1 | `session.create` 接受 `title?`；会话标题是持久字段 | 无 title 列，`session.create` 忽略该参数（`read-methods.ts:106-115`） | **已关闭** — 修正合同：标题**派生不存储**（首条 user 输入的前若干字符），由 `session.list` 返回 |
| C2 | `task.list` 分页（cursor/limit） | `project.get` 同时全量返回 `tasks`，且客户端从不使用 | **已关闭** — 从 `project.get` 移除 `tasks`；Task 列表一律走 `task.list` |
| C3 | `activity` = idle/processing/waiting_children/waiting_user/stopping | 只返回 idle/queued/processing（`read-methods.ts:522-527`） | **已关闭** — 补 `stopping`；`waiting_children`/`waiting_user` 由 `task`+`waitingReason`+`interactions` 表达，合同改为不重复定义 |
| C4 | `session.get` 返回「配置摘要」 | 未返回；实际配置只在 `session.input.get.effectiveConfig`（`read-methods.ts:203-205`） | **已关闭** — 按 S4 在 `session.get` 暴露当前输入记录；`input.get` 保留为详情 |

## U 有方法但没有界面入口

| 编号 | 方法 | 产品依据 | 现状 | 处置 |
|---|---|---|---|---|
| U1 | `project.files.list` / `project.files.read` | P-05、AC-02：浏览目录、阅读文本文件 | 0 处调用 | **已关闭** — 文件查看器（全屏画布）：目录树 + 源码视图（行号/高亮/查找）；知识入口三文件置顶。2026-10-26 起统一为 `files/FileViewer` + `files/SourceView`，旧的 560px 抽屉已删除；字节来源为新增只读路由 `GET /api/v1/project-files/` |
| U2 | `task.report.get` | delivery.md:76：用户能打开报告和证据 | 0 处调用；转录里报告只有摘要 | **已关闭** — 同一查看器打开 `resultId` 正文（服务端已校验归属）。2026-10-26：正文改按源码显示，write Task 的报告返回项目相对路径 `relativePath`，可从结果页直接跳进查看画布；read Task 的报告仍显示「服务端副本」 |
| U3 | `project.rebind` | P-03、AC-04：目录移动后重绑定 | 0 处调用 | **已关闭** — 项目对话框增加「重新绑定」：需要确认来源 + 目录选择，失败按 WORKSPACE_BUSY 原样说明 |
| U4 | `session.recovery.inspect` / `session.recovery.resolve` | S6、AC-04：「仍在修改或引用缺失时说明待处理」 | 0 处调用 | **已关闭（简单方案）** — 会话空闲时读一次 inspect；有未核实输入就显示横幅，写明数量与输入 id，并提供「让主管核实」把请求填进 composer（由主管判断，界面不重放、不代答）；`resolve` 仍无界面：处置走主管的 `task(op=recover)` |
| U5 | `session.cleanup` | K-05：清理已结束会话、保留被引用资料 | 0 处调用 | **已关闭** — 会话列行内「×」两步确认（不提供当前会话）；CAS 用行上的 revision；被拒绝时把服务端的 `gaps` 原样列出 |
| U6 | `task.list` | P-03：查看正在进行的工作 | 0 处调用 | **已关闭** — 需求屏增加第三段「任务」，或在会话列顶部显示当前项目任务 |
| U7 | `project.get.entries` / `initializationRef` | P-02、AC-03：知识入口与确认差异 | 返回了但界面不显示 | **已关闭** — 项目对话框显示三个知识入口（`AGENTS.md`、`.dev/INDEX.md`、`.dev/PROJECT.md`）的存在与否并可打开；`initializationRef` 仍是记录字段，不作为文件入口（没有对应文件可读） |
| U8 | `session.input.get.effectiveConfig` | P-05：「当前工作显示实际使用配置」 | 0 处调用 | **已关闭** — 随 S4：任务条/状态栏显示 `provider/model`，与设置不同时标出 |
| U9 | `config.test`（草稿态） | AC-27：试无效配置 | 只能测已保存 provider | 不做：先保存再测已能覆盖；草稿试连会引入未保存状态 |
| U10 | `session.messages.list` | J-01/接续：翻看更早的会话内容 | 0 处调用；转录只有 `session.stream.prepare` 的尾部 100 条（`stream-methods.ts:12,60`），超过 100 条的会话看不到更早内容且无入口 | **已关闭** — 服务端新增 `before`/`previousCursor` 反向前翻；界面「加载更早」按钮取一页并前插，插入后按高度差补 `scrollTop`，到最早即隐藏。浏览器用例只覆盖「没有更早」的路径（活跃会话的快照来自内存，无法注入长历史），多页前插由服务端用例覆盖 |

## P 最佳实践（本轮与后续都应遵守）

| 编号 | 做法 | 理由 / 现状 |
|---|---|---|
| P1 | 列表类界面一次请求取齐所需字段 | D5/S2 的反面；批量 N+1 会在订阅 TTL 与历史读取上放大 |
| P2 | 有推送就不轮询；轮询只在页面可见时运行，且完成后停表 | S3/D4；当前两个 interval 在完成后仍保留一个（`useSession.ts:253-263`） |
| P3 | 服务端错误码 → 本地文案，服务端 detail 作为第二行 | 现在多处直接拼接英文 detail（如 `settings.saveFailed`），中英混排且不可检索 |
| P4 | 遮罩层：焦点陷阱、Esc、关闭归还、`aria-live` 通知 | D3；无障碍是可用性而不是装饰 |
| P5 | 「方法消费」门禁：`ui-design.md` 的表格列出每个方法被哪个界面消费；未消费的必须在 gap-register 登记 | 现状 10 个方法 0 调用（U1–U10），没有任何检查会提醒 |
| P6 | 新方法清单：参数校验、归属校验、CAS/幂等、契约测试、`runtime-contract.md` 表格、README 索引 —— 五项齐全才算完成 | 避免再出现「方法在、字段缺、合同写别的」 |
| P7 | 三态（加载/空/错误）只用 `State` 与既有 class，不各页自造 | 已有 `State`/`banner`/`notice`，复制会立刻分叉 |
| P8 | 分页 cursor 语义统一：需求 `updatedAt\|id`、任务/文件 `id`，并在合同表注明 | C2 暴露的正是「同一资源两种分页语义」 |
| P9 | 测试只钉可观察行为与合同边界；实现细节用一次性脚本验证 | 与上一轮 review 的结论一致（空测试、源码文本断言被删） |

## 本轮缺陷与决定（2026-10-23，真实使用反馈）

| 编号 | 现象 | 证据 | 处置 |
|---|---|---|---|
| D11 | Provider 协议无法选择：`config.save` 接受 `api`、`models.json` 会写、`config.get` 会回传，但设置页从不发送 | `webapp/src/settings/ProvidersPage.tsx` 的 `save()` 只写 providerId/baseUrl/models/apiKey | 协议只能由 Pi 推断。实测：自定义 id 且无 `api` → 该模型**拒绝加载**（`no "api" specified`）；id 撞上内置名（如 `openai`）且无 `api` → **静默变成 `openai-responses`**。本机代理实测 `/v1/responses` 返回 400，而 `/v1/chat/completions` 与 `/v1/messages` 均 200 | **已关闭（2026-10-23）**：协议成为创建/修改的必选字段并写入 `models.json`；单测与浏览器用例见 [验证记录](validation.md#2026-10-23-provider-命名协议与会话命名) |
| D12 | Provider 没有显示名，`providerId` 同时是标识与名字；设置页只有「测试」，没有修改入口 | `ProvidersPage.tsx`（每行仅 test 按钮）、`providers` 表无 name 列 | 用户要改地址、协议或模型只能重加一个 id，旧的 `models.json` 条目与角色指派留在原地 | **已关闭（2026-10-23）**：新增 `providers.name`（显示用，可改）与设置页「修改」入口；`providerId` 创建后不变 |
| D13 | 会话列的名字固定为派生值，用户不能改；`sessions` 表没有 title 列 | `src/store/store.ts` 的 `listSessions()`（首条用户输入派生） | 「明确不做」原定不新增 title 列 | **已关闭（2026-10-23）**：新增 `sessions.title`（空=继续派生）与 `session.rename`。理由：用户指定的名字不是第二份真相，而是用户意图优先于派生值；读不到存储名才回退到首条发言 |
| D14 | Models 的项目作用域只有一行「本项目」，没有按角色的设置；下拉里的「默认」选项不生效（选中后不删除覆盖） | `webapp/src/settings/ModelsPage.tsx:134-152`（项目作用域单行）；`save` 用 `expectedRevision: null`，`config.save` 无删除路径 | 用户只能在全局按角色配置；项目里无法只改一个角色，设置后也无法回到继承 | **已关闭（2026-10-24）**：`model_overrides` 增加 roleId（v11 迁移）；项目作用域 = 一行「本项目默认」+ 7 行角色；选「默认」调用 `config.clear` 移除该层覆盖；解析顺序 `项目内角色 → 角色 → 项目默认 → Server 默认`。另修：旧页面总是用 `expectedRevision: null` 保存，已存在的层第二次修改会被判冲突 |
| D15 | Task 的运行情况在顶部被重复展示：任务条带成员数并可展开一整套成员面板，转录里的派发卡片反而只有一行；用户要判断"谁在做什么"得先点顶部。成员行两次出现（顶部面板 + 派发卡片），Task 结束后顶部还常驻 | `webapp/src/chat/TaskStrip.tsx`（members toggle + strip-panel）、`webapp/src/chat/ChatPage.tsx`（自动展开的 membersOpen）、`ToolTask.tsx`（`dispatch` 完成后退化为 `.tline`） | 与设计稿（成员行属于派发位置）不一致 | **已关闭（2026-10-24）**：任务条只保留流程链与状态，完成/取消后不再显示；成员行只在派发卡片里，进行中展开、结束后折叠为一行并把真实结果放进展开；派发卡片只列该次调用点名的成员。见 [验证记录](validation.md#2026-10-24-任务在对话里的渲染) |
| D16 | 运行中的 Task 在对话里**完全不可见**：主管在 `dispatch` 里等待时，承载该调用的 assistant 消息尚未结束、不进历史，刷新后转录里没有任何 Task/子 Session；而派发卡片又按“调用是否返回”折叠，等待超时返回后即使成员仍在跑也被收成一行 | 真实项目 `t-70da006f`：刷新后转录只有 Task create 与阶段行；卡片状态 `timeout (s-22bc0416:working)` 却渲染为 `details` | 用户看不到在做什么，与自己确认的设计稿不符 | **已关闭（2026-10-24）**：折叠条件改为“成员是否仍在做”（`liveSessions`，按派发输入状态判定，只有最新一次派发展开）；转录末尾新增「当前步骤」块，在没有任何派发调用时显示 Task + 成员，刷新后同样成立 |
| D10 | 换新浏览器打开工作台，项目弹框显示「尚未登记项目」，而服务端已有登记项目 | `webapp/src/state/useWorkspace.ts` 的 `refresh()`：没有本地记住的路径时直接 `setLoading(false); return`，从不调用 `project.list` | **已关闭** — 该分支改为仍读取服务端项目列表；新增浏览器用例「a browser that has never been here still sees the registered projects」（修复前实测 0 行、修复后 1 行） |

## Q 待改（已决定方向，尚未实施）

2026-10-23。这里记录**已与用户确认要改、但本轮明确不动手**的信息密度调整。与上面的 D/S 不同：这些不是实现与合同的偏差，而是已实现界面在真实使用后暴露的排布问题。

| 编号 | 现象（证据） | 已定方向 | 验收观察点 |
|---|---|---|---|
| Q1 | `.tx-in` 统一 `gap: 32px`，一屏只放得下三四条 | 间距分档：同轮连续块 8px、用户行前 24px | **已关闭（2026-10-25）**：转录改平铺终端流（无 who 头），分档随新消息结构落地（chat-tui-flow-20261025） |
| Q2 | 执行面板每个成员行都重复报状态 | 成员行状态只说一次 | **已关闭（2026-10-25）**：成员行唯一来源收敛到任务清单 TaskTodo，状态词只在行尾一次 |
| Q3 | `task create` 内联整份 Plan、`dispatch` 保留成员列表 | 工具卡默认一行，展开见全文 | **已关闭（2026-10-25）**：create/dispatch 均折单行；Plan 在任务清单头部与 create 展开两处可读 |
| Q4 | 执行面板自动展开后常驻占高压短转录 | 面板不压转录 | **已关闭（2026-10-25）**：面板删除；任务清单在转录流内，随滚动离开视口，不挤压输入区 |

关联：[UI 设计契约](ui-design.md#u5-会话面)。实施时同步该契约的「会话面」表，并在 [验证记录](validation.md) 记实际观察结果。

## M 移动端（方向已定，尚未实施）

2026-10-26。本轮已经把手机上**不可用的缺陷**修完了（见 [验证记录](validation.md) 的「移动端」行：外壳栅格 `auto` 列被内容撑宽、项目按钮宽 0 点不到、rail 开关在屏幕外、Toast 盖住首条消息与输入框、查看器 Esc 被 Download 挤出）。剩下的不是缺陷，而是**形态**：窄屏现在是逐条打补丁的压缩版，不是移动端该有的样子。用户明确要求按响应式最佳实践重做，本轮先记录、不动手。

| 编号 | 现象（证据） | 已定方向 | 验收观察点 |
|---|---|---|---|
| M1 | 手机顶栏塞下 4 个导航图标 + 项目名 + 连接状态 + rail 开关；`≤400px` 时标签退化为图标，仍挤 | 主导航改为**底部固定 Tab Bar**（≥48px，图标 + 文字，当前项 accent）；顶栏只留项目名与连接状态 | 320/390px 下 Tab Bar 全部项可点、当前项可辨；顶栏不再有图标行 |
| M2 | 会话列表是左上角 `≡` 打开的**左侧**滑出面板，与移动端习惯不符 | 手机上「会话」Tab 进入**全屏会话列表页**，选中后返回对话；滑出面板只保留给桌面 | 手机上无左侧抽屉；返回后仍在原对话 |
| M3 | 对话页底部同时有输入框与（未来的）Tab Bar，需定义占位关系 | Tab Bar 固定在最底，输入框在其上方，二者都在拇指区；`100dvh` + `env(safe-area-inset-bottom)` 留出 Home 指示条 | 软键盘弹出时输入框不被遮挡，Tab Bar 不压住输入框 |
| M4 | 窄屏规则散落在 9 个媒体查询里逐条打补丁（`.top`/`.nav`/`.composer`/`.fv-*`/`.board`/`.tasks-*`），难以整体调整 | 收敛为一套移动端外壳结构（顶栏 / 内容 / Tab Bar / dock 四段），窄屏规则按结构写一次 | 同一屏在 320/390 下的规则集中在一个区块；新增屏幕无需再补窄屏补丁 |
| M5 | 触屏手势与软键盘遮挡未在真机验证（R2） | 真机走查：iOS Safari 与 Android Chrome，含软键盘、横屏、安全区 | 真机截图与录屏作为证据 |

搁置原因（用户 2026-10-26）：先把功能面做完，移动端形态留作单独一轮。实施前先出 320/390 两档的形态稿核对，再动代码。

## R 风险（未记通过）

| 编号 | 风险 | 现状 |
|---|---|---|
| R1 | 真实模型下的 J-01～J-10 未执行 | 只有 stub 模型；需要凭据与人工参与 |
| R2 | 触屏手势与软键盘遮挡未实测 | CSS 用 `100dvh` + 安全区，未在真机验证 |
| R3 | 320px 以下不作承诺 | 声明下限 320 |
| R4 | 转录未虚拟化 | 快照上限 100 条 + 增量；超长会话的内存与滚动未测 |
| R5 | 轮询上限未知 | 长开标签页 + 活跃 Task 时的请求量未测（D4 修复后可测） |

## 处置顺序

1. **S2 + D5**（会话列）→ 2. **S1**（项目列表）→ 3. **S3**（任务推送）→ 4. **D1 + D2**（写错与交接）→ 5. **D3/D4/P3**（交互质量）→ 6. **U7 + U1 + U2**（阅读器）→ 7. **U3/U6** → 8. **U4/U5 待确认**。

补充（2026-10-23）：**Q1～Q4** 在 U 系列之后单独一轮实施，作为一次界面密度调整；不做为新需求或新架构，实施前先出调整后的截图核对密度。

依据：前四项决定「看到的是不是真的」，后四项决定「还能不能继续做」；U4/U5 的交互形态在首版产品文档里没有定义，需要先确认再实现。

## 明确不做

- ~~不新增 `sessions.title` 列（标题派生，避免第二处真相）。~~ **2026-10-23 反转**：用户可给主管会话改名，`title` 空值才回退派生；见 D13。
- 不引入状态管理库或请求缓存层（现有 `useState` + 单 `RpcClient` 足够）。
- 不做虚拟滚动、不做移动端手势、不做多用户权限。
- 不把 `config.test` 扩成草稿试连（U9）。
- 不为需求交接新增 `requirementId` 参数（S5）。
