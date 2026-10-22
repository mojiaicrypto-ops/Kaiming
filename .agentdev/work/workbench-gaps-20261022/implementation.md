# Implementation · workbench-gaps-20261022

Plan：`plan.md`（A–G 全做；U4/U5 只登记问题；阅读器只读）。缺口编号见 `docs/technicalnew/gap-register.md`。

## 阶段 A · 服务端读形状

| 改动 | 位置 | 缺口 |
|---|---|---|
| `session.list`：一次返回会话列（标题、activity、lastActivityAt、currentTaskId、queuedInputs），按活动时间降序，cursor=`<lastActivityAt>\|<sessionId>`；不调用 `hub.prepare`、不读历史文件 | `src/server/read-methods.ts` | S2、D5 |
| 标题派生：首条 `kind='user'` 输入的 payload → 首个非空行 → 60 码点截断；无输入为 null | `src/server/read-methods.ts`（`titleOf`） | C1 |
| `listSessionSummaries` / 首条用户输入：两条按项目分组的查询，不是每会话两次 | `src/store/store.ts` | S2 |
| `session.get` 增 `stopping`（processing 且已请求停止）与 `config`（当前/最近一次认领记录的配置，只回 providerId/modelId/source） | `src/server/read-methods.ts`、`src/runtime/recorded-config.ts` | S4、C3、C4、U8 的数据面 |
| `project.get` 不再返回全量 `tasks` | `src/server/read-methods.ts` | C2 |
| `session.input.get.effectiveConfig` 只回白名单字段（去掉 `agentDir`/`promptDir`） | 同上 | C4、泄漏收敛 |
| `textOfPayload` 提取为共享模块（runner 与标题共用一份） | `src/runtime/input-text.ts` | P6 |
| 合同表同步（session.list、project.list、activity 枚举、before 分页、config 字段） | `docs/technicalnew/runtime-contract.md` | — |

## 阶段 B · 项目列表

- `project.list`（`projectId`、realPath、revision、目录是否存在、会话数、任务数、最后活动、更新时间；cursor=`<updatedAt>\|<projectId>`）；`listProjectSummaries` 一条 SQL 带子查询计数。
- 界面：项目菜单改由 `project.list` 驱动（删除浏览器「最近项目」与 `titleCache`）；目录缺失的行不可打开并给出重绑定入口；会话列改用 `session.list`，超过一页时底部「加载更多会话」。

## 阶段 C · 任务推送

- `TaskToolContext.onTaskChange`：`create/update/dispatch/control/end/adopt/recover` 成功后调用一次，读操作与拒绝不调用（`src/tools/task-tools.ts`）。
- `RunnerOptions.onTaskChange` → `main.ts` 发布 `invalidate{task}` 与 `invalidate{session}`。
- 客户端：`invalidate{task}` 立即 `refreshTask`；删除 2 秒「发现新建 Task」循环；3 秒兜底轮询只在 `visibilityState==='visible'` 时运行，恢复可见立即读一次。
- `create` 省略 `authorizationRef` 时使用本次运行的输入（该输入必须是本项目用户输入，`resolveAuthorizationRefs` 已校验）；成员输入是 delegation，仍会被拒。

## 阶段 D · 写对与交接

- Models 页：范围切换改变**编辑对象**——全局=每角色一行 `{roleId}`；本项目=单行 `{projectId}`。供应商已下架的已存模型仍显示，避免看着像继承默认。错误文案走统一映射。
- 需求抽屉：三条动作改为 `onHandOff(text)` → 填入 composer 并切到会话，不发送；composer 已有内容时不覆盖并提示；抽屉不再同时导航回看板（此前会互相覆盖）。

## 阶段 E · 阅读器

- `files/FileDrawer.tsx`：目录列表 + 文件正文（大小/版本/截断/二进制/符号链接），只读；知识入口三文件置顶显示存在与否。
- `chat/TaskDrawer.tsx`：任务目标/范围/下一步 + 结果列表；报告正文经 `task.report.get` 读取真实文件；服务端工作目录路径不打印。
- 更早历史：`session.messages.list` 增 `before`（严格早于该 entry 的页）与 `previousCursor`；客户端「加载更早」按钮，到最早即消失，不再假装还有。
- 需求屏新增「任务」段（`task.list`），行内链接到协调该任务的会话；阶段/状态用本地文案。

## 阶段 F · 重绑定

- 项目对话框：目录缺失行提供重绑定；保存后项目跟随新目录（存储路径更新），会话记录不变；`WORKSPACE_BUSY` 原样说明仍有什么没停。
- 服务端：`project.rebind` 不再强制 `authorizationRef`（没有任何模型工具暴露该方法，浏览器会话即决策）；若调用方仍提供引用，照旧校验。

## 阶段 G · 交互质量

- `app/focus.ts`：焦点移入、Tab 循环、关闭归还；Drawer 与项目对话框共用。
- Toast：容器 `role=status aria-live=polite aria-atomic`，错误项 `role=alert`。
- 错误文案：`lib/errors.ts` 按 RpcError 码取本地句子，服务端原文作为次行；未知码保留原文。阻断横幅按 `error.blocked_*` 映射。

## 顺带修掉的真实缺陷

| 缺陷 | 处理 |
|---|---|
| 流效应依赖每渲染变化的回调 → SSE 每渲染重连一次，直到 `ERR_INSUFFICIENT_RESOURCES` | 回调放进 ref，依赖只留 id/开关 |
| 需求抽屉既导航又关闭，把用户送回看板 | 只保留交接导航 |
| 重绑定曾要求无法产生的 `authorizationRef`，功能不可达 | 改为可选并说明理由 |
| `task.report.get` 返回服务端绝对路径直接显示 | 服务端工作区路径改为说明文字 |
| i18n 检查用手写 RPC 方法表，新增 `project.list` 被当成缺失文案 | 从服务端注册表派生 |

## 审阅后的修正（独立审阅 2026-10-22，无阻断项）

| 发现 | 处理 |
|---|---|
| 会话列时间恒为空：服务端 `lastActivityAt` 与客户端 `updatedAt` 未映射 | `loadSessions` 显式映射；类型改为服务端字段名，避免再次静默 |
| U10 声称「插入时保持滚动位置」但没有代码 | 前插后按 `scrollHeight` 差值补 `scrollTop`；登记措辞改为按钮加载 + 锚定 |
| U7 声称四个入口 | 改为三个真实文件入口，`initializationRef` 说明为记录字段 |
| U6 任务段无分页 | 增加「显示更多」（`nextCursor`） |
| `parseRecordedConfig` 无调用 | 删除（已被 `runtime/recorded-config.ts` 取代） |
| 推送后 1 秒内的兜底 tick 未跳过 | `lastPushAt` 守卫 |
| 切换结果时旧报告正文短暂残留 | `openId` 变化时先清 `body` |
| 目录符号链接点击报 NOT_FOUND | 列表项禁用并标注「不跟随」 |
| 重复交接相同需求被静默忽略 | 拒绝时不记 `lastSeed`，清空输入框后可再次插入 |
| 计划要求「拦截计数」验证项目菜单 | 改为更有意义的用例：注册一个本浏览器从未见过的项目，重载后菜单出现两条，且 `localStorage` 无「最近项目」键 |

## 计划与实现的偏差

| 计划写法 | 实际 | 理由 |
|---|---|---|
| `session.list`「空会话排最后」 | 无输入会话排最前（`'~'` 键） | 刚创建的会话应在列表顶部，否则用户新建后找不到 |
| 浏览器用例覆盖多页前插与 101 条 | 只覆盖「没有更早」；多页由服务端用例覆盖 | 活跃会话的快照来自模型实例内存，测试无法注入长历史 |
| 阶段 C 单测断言 dispatch 推送 | create/update 断言 + 浏览器断言 dispatch 后成员数立即出现 | dispatch 会拉起成员运行，单测里模拟成本高于价值 |

## 未做（有记录的决定）

- U4 恢复核实、U5 会话清理：只写问题（`questions.md`），不实现。
- U9 草稿试连、S5 需求引用字段：按登记的理由不做。
- U8 的 `config` 只显示在状态栏，没有单独的「当前配置」面板。

## 验证

见 `test.md`：两处 typecheck 无输出，`npm test` 299、`npm --prefix webapp test` 25、`npm run test:browser` 26 全绿。
