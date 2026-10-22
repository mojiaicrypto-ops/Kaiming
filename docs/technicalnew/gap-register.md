# 缺口登记（已实现界面 / 后端方法 / 合同）

日期：2026-10-22。口径：只登记**本轮实现与合同核对中能指出代码位置**的缺口。文档写了不等于实现；这里的每一项都是可复核的现象，不代替 [产品验收](../productnew/acceptance.md)。

维护规则：新增公开方法、删除界面入口、修正合同时同步本页；关闭一项时写清证据位置，不删除条目（改为「已关闭」并附提交）。

编号：`D`=已实现界面的缺陷，`S`=后端缺少的方法/字段，`C`=合同与实现不一致，`U`=服务端有方法但界面没有入口，`P`=最佳实践，`R`=风险。

---

## D 已实现界面的缺陷

| 编号 | 现象 | 证据 | 影响 | 处置 |
|---|---|---|---|---|
| D1 | 模型设置切到「本项目」只改变**读**的解析范围，保存仍发 `roleId`：项目范围永远写不出项目级覆盖，反而写坏全局角色覆盖 | `webapp/src/settings/ModelsPage.tsx:42-46`（只传 roleId）；`src/server/methods.ts:243-245`（roleId/projectId 必须恰有一个） | AC-27「按角色/项目设置可辨认」不成立 | 项目范围改为单行「本项目」写入 `{projectId}`；全局范围保留按角色行 |
| D2 | 需求抽屉的「实施 / 委派设计 / 修复」只弹一条提示，不打开会话、不预填 | `webapp/src/requirements/RequirementDrawer.tsx:97-102` | J-03 → J-04 的交接靠用户手抄需求号；与产品「选择需求进入 J-04」不符 | 跳转到主管会话并预填「实施 \<id\>」；用户按下发送才算数（不代发） |
| D3 | 抽屉与项目对话框只把焦点移入，没有陷阱、关闭后不归还 | `webapp/src/app/Drawer.tsx:22-33`；`app/ProjectDialog.tsx:20-30` | Tab 会跑到遮罩后的页面；键盘用户失去位置 | 加焦点陷阱与关闭归还；`aria-live` 给 Toast |
| D4 | 后台标签页仍在轮询：任务 3 秒、任务发现 2 秒 | `webapp/src/state/useSession.ts:231-263` | 长开标签页持续请求；离线/休眠后首个回调制造无意义读 | `visibilitychange` 时暂停，恢复时立即读一次 |
| D5 | 会话列每行两次请求（`session.stream.prepare` + `session.get`），前者还会在服务端**建一个 30 秒订阅** | `webapp/src/state/useWorkspace.ts:111-142`；`src/server/hub.ts:71-88`（prepare → 订阅，TTL 30s） | 20 个会话＝40 次往返 + 20 个无用订阅；标题靠读整段历史 | 由 `session.list` 一次返回（S2），删除客户端标题派生与 `titleCache` |
| D6 | 阻断横幅直接显示原始错误码，后半句是服务端英文原句（如 `blocked_config`） | `webapp/src/chat/Banner.tsx:41`；`i18n/catalog.ts:89` 只有 `banner.blocked` 一词 | 中文界面出现 `blocked_config` + 英文解释；用户看不出该去设置模型还是补角色 | 按码映射本地文案（`blocked.config/role/project`），detail 作为次行；随 P3 |

## S 后端缺少的方法/字段

| 编号 | 现象 | 证据 | 影响 | 处置 |
|---|---|---|---|---|
| S1 | 没有 `project.list`：项目菜单只是浏览器本地最近路径 | 注册表无此方法（`src/server/methods.ts`、`read-methods.ts`、`write-methods.ts`）；`webapp/src/state/useWorkspace.ts:94-99` 注释自述 | 换浏览器/清存储后，已登记项目不可见（AC-01 的第二条路径仍要手输） | 新增 `project.list`：id、realPath、目录是否存在、会话数、最后活动、更新时间；界面与本地最近合并 |
| S2 | 没有 `session.list`：`project.get` 的 `sessions` 只有 id 与 roleId | `src/server/read-methods.ts:577-580` | 会话列无标题/活动/时间/任务，只能 N+1 读（D5） | 新增 `session.list`：标题（由首条 user 输入派生，见 C1）、activity、lastActivityAt、currentTaskId、queuedInputs；一次一请求 |
| S3 | 任务创建与成员变化没有推送：`task` 工具没有发布钩子 | `src/tools/task-tools.ts:17-38`（`TaskToolContext` 无 invalidate）；仅控制/结束时由 `write-methods` 发 invalidate | 任务条依赖轮询；主管一次性建 Task 时界面最长 2 秒空白 | Runner 增 `onTaskChange(sessionId, taskId)`，在 create/update/dispatch/control/end 后发布 `invalidate{task}`（并 `invalidate{session}` 供会话列刷新）；轮询降级为兜底 |
| S4 | `session.get` 不区分「正在停止」，也不返回本次运行的实际配置 | `src/server/read-methods.ts:513-543` | 状态栏无法显示 stopping；P-05「当前工作显示实际使用配置」没有数据入口 | 增加 `stopping`（存在 stopRequested 的 processing 输入）与 `config`（来自当前输入的记录，见 C4） |
| S5 | `session.input.submit` 没有结构化需求引用 | `src/server/write-methods.ts:51-80` 只收 content/taskId | 需求交接只能靠文本提到 id | **不做**：文本 + `requirement` 工具已足够，且加字段会让「引用」出现第二处解释；见 D2 |

## C 合同与实现不一致

| 编号 | 合同写法 | 实现 | 处置 |
|---|---|---|---|
| C1 | `session.create` 接受 `title?`；会话标题是持久字段 | 无 title 列，`session.create` 忽略该参数（`read-methods.ts:106-115`） | 修正合同：标题**派生不存储**（首条 user 输入的前若干字符），由 `session.list` 返回 |
| C2 | `task.list` 分页（cursor/limit） | `project.get` 同时全量返回 `tasks`，且客户端从不使用 | 从 `project.get` 移除 `tasks`；Task 列表一律走 `task.list` |
| C3 | `activity` = idle/processing/waiting_children/waiting_user/stopping | 只返回 idle/queued/processing（`read-methods.ts:522-527`） | 补 `stopping`；`waiting_children`/`waiting_user` 由 `task`+`waitingReason`+`interactions` 表达，合同改为不重复定义 |
| C4 | `session.get` 返回「配置摘要」 | 未返回；实际配置只在 `session.input.get.effectiveConfig`（`read-methods.ts:203-205`） | 按 S4 在 `session.get` 暴露当前输入记录；`input.get` 保留为详情 |

## U 有方法但没有界面入口

| 编号 | 方法 | 产品依据 | 现状 | 处置 |
|---|---|---|---|---|
| U1 | `project.files.list` / `project.files.read` | P-05、AC-02：浏览目录、阅读文本文件 | 0 处调用 | 文件阅读器（抽屉）：目录树 + 文本/二进制/截断提示；知识入口三文件置顶 |
| U2 | `task.report.get` | delivery.md:76：用户能打开报告和证据 | 0 处调用；转录里报告只有摘要 | 同一阅读器打开 `resultId` 正文（服务端已校验归属） |
| U3 | `project.rebind` | P-03、AC-04：目录移动后重绑定 | 0 处调用 | 项目对话框增加「重新绑定」：需要确认来源 + 目录选择，失败按 WORKSPACE_BUSY 原样说明 |
| U4 | `session.recovery.inspect` / `session.recovery.resolve` | S6、AC-04：「仍在修改或引用缺失时说明待处理」 | 0 处调用 | 待确认：首版是否需要独立恢复界面，或用横幅 + 单条处置 |
| U5 | `session.cleanup` | K-05：清理已结束会话、保留被引用资料 | 0 处调用 | 待确认：放置位置（会话列行操作）与拒绝原因展示 |
| U6 | `task.list` | P-03：查看正在进行的工作 | 0 处调用 | 需求屏增加第三段「任务」，或在会话列顶部显示当前项目任务 |
| U7 | `project.get.entries` / `initializationRef` | P-02、AC-03：知识入口与确认差异 | 返回了但界面不显示 | 项目对话框显示四个入口的存在与否；点击进 U1 阅读器 |
| U8 | `session.input.get.effectiveConfig` | P-05：「当前工作显示实际使用配置」 | 0 处调用 | 随 S4：任务条/状态栏显示 `provider/model`，与设置不同时标出 |
| U9 | `config.test`（草稿态） | AC-27：试无效配置 | 只能测已保存 provider | 不做：先保存再测已能覆盖；草稿试连会引入未保存状态 |
| U10 | `session.messages.list` | J-01/接续：翻看更早的会话内容 | 0 处调用；转录只有 `session.stream.prepare` 的尾部 100 条（`stream-methods.ts:12,60`），超过 100 条的会话看不到更早内容且无入口 | 上滚到顶时按 `nextCursor` 加载，插入时保持滚动位置（阶段 E3） |

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

依据：前四项决定「看到的是不是真的」，后四项决定「还能不能继续做」；U4/U5 的交互形态在首版产品文档里没有定义，需要先确认再实现。

## 明确不做

- 不新增 `sessions.title` 列（标题派生，避免第二处真相）。
- 不引入状态管理库或请求缓存层（现有 `useState` + 单 `RpcClient` 足够）。
- 不做虚拟滚动、不做移动端手势、不做多用户权限。
- 不把 `config.test` 扩成草稿试连（U9）。
- 不为需求交接新增 `requirementId` 参数（S5）。
