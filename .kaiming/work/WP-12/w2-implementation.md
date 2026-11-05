# WP-12 W2 实施记录：Inbox 渲染并处理敏感文件待办

- 状态：Developing（实现 + 本切片的真实 drill 已完成；**§11 是持钥者裁决方案①后的追加实现**；等待独立 Review/Test）
- 依据：任务书（W2 用户面）；`.agentdev/work/WP-12/product-completion-plan.md` §4 W2 行；`w1-implementation.md`（W1 落地的类型化拒绝 + `chief_action_required(kind='sensitive_file')` 待办）；`.agentdev/work/WP-12/T4c-implementation.md`（Inbox 现有两类条目）；`docs/architecture/protocol.md` §4/§6/§7；`docs/product/experience.md` §1/§5/§6/§7；`docs/rules/{workflow,agents}.md`；`.agentdev/work/WP-12/T3-implementation.md` 附录 A。
- 范围与边界（§1–§10）：改动 `apps/web/**`；`apps/daemon/src/protocol.ts` 只有**读面**最小增补（`inbox` 聚合查询多返回一类条目 + `ui.translate` 目录补齐新键）。**§1–§10 未新增协议方法、未新增写语义、无迁移/无表列**；`packages/**`、`packages/workspace/**`、`docs/product/**`、`docs/delivery/**`、`scripts/**`、`tests/browser/**`、根配置未改；无新运行时依赖；未 `git commit`。
- 范围与边界（§11 追加，持钥者裁决后扩大）：新增 `chief.todo.resolve` 写方法（`apps/daemon/src/protocol.ts`）；`docs/architecture/protocol.md` 补该方法与 `chief.todo_resolved` 事件；`apps/web/**` 加两个关闭动作与实时刷新；`tests/browser/**` 加真 Chromium spec，并为此在 `scripts/lib/{browser-suite,drill-acs}.mjs` + `scripts/e2e.mjs` 登记 AC-074 浏览器检查。仍未改 `packages/**`、`docs/product/**`、`docs/delivery/**`；无迁移/无表列；无新运行时依赖；未 `git commit`。

---

## 1. 变更清单（文件 → 改了什么）

| 文件 | 变更 |
|---|---|
| `apps/daemon/src/protocol.ts` | `inbox()` 追加以 `kind:'todo'` 形式的**用户待办**行（`inboxUserTodos()`）；导入 `SENSITIVE_FILE_TODO_KIND`；`UI_STRINGS`（`ui.translate` 目录）补齐 13 个新界面键。读面只读 `event` 表，无写。 |
| `apps/web/src/views.ts` | `InboxTodo` 类型；`InboxRow.kind/entry` 增 `'todo'`；`InboxRow.todo`；`InboxModel.todos`；`inboxModel` 解析 `kind==='todo'`（白名单字段、缺字段保持 `null`、按 id 去重）。 |
| `apps/web/src/pages.ts` | `inboxTodoRow()`：敏感文件待办卡（被拒操作/文件/命中规则/拒绝时档位/Work/Run/发起方/提出时间 + 明确的"请你本人处理"说明 + 携带 Work 引用的"在 Chief 讨论"链接；无产品内解决按钮）；`renderInboxPage` 把 `model.todos` 排进列表；未知/缺字段以"守护进程未上报"如实降级。 |
| `apps/web/src/i18n.ts` | 新增全部新可见字符串的 `en` + `zh`（13 键，见 §6）。 |
| `apps/web/public/app.js` | `inboxEvents` 增 `'chief_action_required'`：拒绝事件到达即经既有"服务端读回式"刷新出现在列表，无需手动 reload。 |
| 测试 | `views.test.ts`（+5）、`pages.test.ts`（+5，另扩展既有卡片组）、`client-script.test.ts`（+1 断言）、`inbox.integration.test.ts`（+1 例，真实 tool-handler → 真实 SQLite → 真实 `inbox` → BFF 页面）。 |
| 文档 | 本记录。`docs/**` 未改（`inbox` 方法本身在 `protocol.md` 中无登记，`api-gap-audit-2.md` 已把 `board/inbox/agents/settings` 登记为"文档缺口"，不属本切片写面）。 |

---

## 2. 待办如何进入 Inbox（读面，唯一一处 daemon 改动）

`inbox()` 原先只从 `decision` / `finding` / `run(recovery_required)` 三张表聚合，**从未读过 `chief_action_required`**。W1 写入的 `chief_action_required(kind='sensitive_file')` 因此存在于持久日志里却在 UI 上不可见——这正是 W2 的缺口。

新增 `inboxUserTodos()`（`apps/daemon/src/protocol.ts`）：

- 分页扫描 `event` 表中 `name='chief_action_required'` 的事件（从 `oldestCursor()` 起，避免保留窗口截断触发 `RESYNC_REQUIRED` 而让整个 Inbox 读失败）；
- 只取 `data.kind === 'sensitive_file'`（**用户面待办**；`kind='context'`/`'request_dispatch'` 与 Join 失败待办的读者是 Chief，不是用户，见 §6-1）；
- 一行一个 `(workId, path, pattern)`（与 tool-handler 的幂等键一致），幂等：模型重试同一文件不会堆出第二行；
- 逐字段白名单读取：`action`/`path`/`pattern`/`configPolicy`/`runId`/`role`/`reason`，并把 `Event.occurredAt` 作为 `createdAt`（"何时提出"）；
- `kind:'todo'` 计入 `unread`（用户确实要处理）。

**没有新增协议方法**：这是对既有 `inbox` 聚合读查询的返回字段扩展；W1 的写入路径（`tool-handler.ts` 的 `fileSensitiveTodo`）一行未动。

### 2.1 对"daemon 早已预留读取器"的现场核实（结论：不成立）

接手时收到一条来自 W1 实现者的提示："`protocol.ts` 早已预留 Inbox 待办读取器，字段名与 W1 待办完全一致，daemon 可能无需改动"。已按"先验证再动手"核实，**该提示与 HEAD 事实不符**：

```
$ git show HEAD:apps/daemon/src/protocol.ts | grep -c chief_action_required
0
$ git show HEAD:apps/daemon/src/protocol.ts | grep -c sensitive_file
0
$ git show HEAD:apps/daemon/src/protocol.ts | sed -n '2990,3070p' | grep -n "kind: '"
kind: 'decision' / kind: 'finding' / kind: 'recovery'
```

即：字段名确实与 W1 待办兼容（这是新增读取器采用同一命名的基础），但 **HEAD 的 `inbox()` 没有读取器**，所以 `apps/daemon/src/protocol.ts` 的读面增补是必要的。该结论有本切片 `inbox.integration.test.ts` 的真实链路用例作证（见 §7-4）。

---

## 3. 卡片内容（用户看到什么）

`kind='sensitive_file'` 卡片（`data-entry="todo"`）：

| 位置 | 内容 | 依据 |
|---|---|---|
| 行头 | "敏感文件需你本人处理" + 原始 `todoKind`（`sensitive_file`）+ 提出时间 | `execution.md` §1 / 附录 A.1-3 |
| 说明句 | "该文件在敏感文件清单内，Agent 的访问已被拒绝；文件内容从未被读取，Agent 也不会读取、搜索或修改它。" | 附录 A.2 |
| 字段 | 被拒操作（read/search/edit/write）、文件（path）、命中规则（pattern）、**拒绝时**的配置档位、Work、Run、发起方（role）、提出时间 | `protocol.md` §7 的 `data` 形状 |
| 用户动作 | "请你本人处理该文件（填写、更新或改用其他方式提供该值）。Agent 会继续做其他工作，这里不需要你提交决定。" | 附录 A.1-3 "转用户待办…agent 继续做别的工作" |
| 深链 | "在 Chief 讨论"，携带 `#work-<workId>` 对象引用 | `experience.md` §1 |

- **绝不出现文件内容**：待办事件里本来就没有内容（W1 记录与 `protocol.md` §7 已写明）；视图模型只做字段白名单，负测覆盖。
- **没有空白/歧义卡**：字段缺失一律渲染 `inbox.todoFieldUnavailable`（"守护进程未上报"），未知/缺失 `todoKind` 走通用分支并给出诚实提示。
- 未知 `kind` 的待办也有一张诚实卡（不静默丢弃、不假装有动作）。

---

## 4. 解决路径语义（**本切片最重要的结论**）

### 4.1 文档定义了什么

`T3-implementation.md` 附录 A.1-3、`docs/architecture/execution.md` §1、`docs/architecture/protocol.md` §7 一致规定：敏感文件命中 → 类型化拒绝（`CONTEXT_FORBIDDEN`，`approvable:false`，文案"不要重试"）+ 一条 `chief_action_required(kind='sensitive_file')` 用户待办，**不阻塞 Run**，待办内容是"该文件请你本人处理/填写"。

本切片据此**只实现了文档化的那一条路径**：卡片把"请你本人处理"写明，Agent 不读/不搜/不改该文件并继续其他工作；同时给出文档化的下一跳（在 Chief 讨论，携带 Work 引用）。

### 4.2 文档**没有**定义什么（缺口 → 停下上报，未发明）

> **本节已被 §11 取代（历史记录保留）**：持钥者裁决走方案①，新增了 `chief.todo.resolve`。以下"缺口未实现"的描述只描述 §1–§10 那一步，不再是最终状态。

**没有任何文档定义"这条待办如何被清除/关闭/确认"**：

- `protocol.md` §4/§5/§6 与错误表中不存在 acknowledge/resolve/dismiss 这类方法；`decision.resolve`/`permission.respond`/`recovery.resolve` 都只针对各自对象，与 `chief_action_required` 无关；
- `docs/product/experience.md` §5 的 Inbox 只写"按目标+版本去重，过期决定不可再次应用"，未写待办的生命周期；
- 其余 `chief_action_required` 待办（`context`/`request_dispatch`/Join 失败）同样只有**产生**、没有**消解**的写入方。

因此：**本切片没有发明协议方法，也没有在客户端伪造"已处理"**（卡片无解决按钮；`data-entry="todo"` 行内不含任何 `<button>`，测试断言）。待办会在 Inbox 持续存在——这正是需要持钥者裁决的缺口。

### 4.3 两个可选方案（请裁决，本切片不预先实现）

1. **新增"用户确认已处理"写方法**（推荐）：在 `protocol.md` §4 登记一个用户面命令（如 `chief.todo.resolve {workId, todoId, disposition:'handled'|'dismissed'}`），daemon 记录一条 user Action / 在 `event` 追加 `handled` 事实，`inboxUserTodos()` 据此把该 `(work,path,pattern)` 过滤掉。代价：新协议方法 + 写语义 + 审计 + 保留策略；收益：W2 的"出现→处理→消失"能在真浏览器里完整取证，且凭据/密钥类待办也有唯一可行的闭环。
2. **不新增方法，用既有文档化事实派生"已消解"**：把"待办是否仍 pending"定义为可派生的读规则，例如 Work 处于终态时不再上报（`workflow.md` §5.1），或人类把项目 `configPolicy` 置为 `test` 后应用配置类待办不再上报（附录 A.7：档位仅人可设、项目级）。代价：不新增协议面，但会把"用户已处理文件"与"工作已结束/策略放宽"混为一谈，且**凭据档与纯密钥材料在 `test` 档仍拒读，这类待办永远无法清除**——所以方案 1 仍然必需。

### 4.4 关于配置档位的呈现（按真实语义，不夸大）

W1 实现者的自我更正已采纳：`configPolicy` 的"随 Run 冻结"是 **`buildContext` 把 `sha256(policyContent)` 写进 ContextSnapshot**，同一 daemon 会话内改档位只对**新派发的 Run 的 context 快照与重启**生效，已打开项目的 tool handler 仍用装配时的旧值（与既有 `permissionMode` 行为一致）。

因此卡片只把它标为"**拒绝时的配置档位**"（`inbox.todoConfigPolicy` = `Config policy at refusal`），即事件里记录的那次拒绝所依据的值；**没有**任何"改档立即全局生效"的暗示，也**没有**加"去改档位"的行动号召（那会是一条本切片未实现、且作用于全局/项目的写路径）。

---

## 5. 实时刷新

- 客户端 `inboxEvents` 增 `'chief_action_required'`（`apps/web/public/app.js`）。拒绝发生 → daemon 落待办 → `project.subscribe` 事件到达 → `handleInboxEvent` → `refreshInbox()`（对同页发 GET，只替换 `#inboxList` 与空提示/角标）→ 新卡出现，**无需手动 reload**；这沿用 T4c 已有的订阅/水位与"服务端读回"机制，未新增通道。
- 刷新与 `inboxUserTodos()` 全是只读：不写任何命令、不改 Run 状态、不触碰正在运行的 Run。
- 新增卡没有按钮，`applyPermissionBindings()`（只遍历 `[data-entry="permission"]`）与点击委托都不会误伤它；`disableInboxRow` 也只匹配 `button[data-choice|data-permission]`。

---

## 6. i18n 与密钥

新增界面键（`apps/web/src/i18n.ts` 与 daemon `ui.translate` 目录逐字一致，`apps/daemon/test/ui-catalogue.test.ts` 会校验）：

`inbox.todo`、`inbox.todoSensitiveFile`、`inbox.todoSensitiveWhat`、`inbox.todoHandling`、`inbox.todoAction`、`inbox.todoPath`、`inbox.todoPattern`、`inbox.todoConfigPolicy`、`inbox.todoKind`、`inbox.todoKindUnknown`、`inbox.todoOtherHint`、`inbox.todoFieldUnavailable`、`inbox.raisedAt` —— 全部 `en` + `zh`。

- 项目内容不翻译：`path`/`pattern`/`action` 是 daemon 上报的机器事实（与既有 `decisionKind` 同类），daemon 自带的整句 `reason` 只作为行 `title` 诊断，**不是**可见文案。
- 密钥/拒绝内容：`inboxModel` 只读取白名单字段；待办事件本身不含内容。`views.test.ts`/`pages.test.ts` 新增"待办载荷混入 `secret`/`secretRef`/`content` 也不进模型/HTML"负测，既有 Provider 密钥负测保持绿。

---

## 7. 测试

| 文件 | 覆盖 |
|---|---|
| `apps/web/test/views.test.ts`（+5） | 敏感文件待办按 daemon 上报字段成型；缺字段保持 `null`（不发明）；未知 `todoKind` 仍是可读行；重复 id 收敛为一行；载荷混入 secret/secretRef/文件正文不泄漏。 |
| `apps/web/test/pages.test.ts`（+5） | 卡片渲染被拒操作/文件/命中规则/档位/Work/Run/发起方/提出时间 + 用户动作句；daemon 诊断只进 `title`；**无解决按钮**；缺字段渲染"守护进程未上报"；未知/缺失 kind 诚实降级；不泄漏 secret/正文；所有 `data-i18n` 键都在字典里。 |
| `apps/web/test/client-script.test.ts`（+1 断言） | `inboxEvents` 含 `chief_action_required`（实时刷新）；既有"拒绝分支不 reload/刷新"断言不变。 |
| `apps/web/test/inbox.integration.test.ts`（+1 例） | **真实链路**：真实 `createToolHandler`（真实 Broker/GrantStore/SQLite/工作区）对真实 `.env` 的 `read` 被拒（`CONTEXT_FORBIDDEN`）→ 待办由 handler 自己落库 → 真实 `WorkbenchProtocol.inbox` → BFF 页面渲染出唯一一张 `data-entry="todo"` 卡（path/pattern/action/configPolicy/work/run/raisedBy 全对）；第二次同样的拒绝**仍只有一行且条目仍在**；页面不含 `.env` 里的标记正文。 |

浏览器套件（`tests/browser/**`）：**Inbox 目前不在其中**，本切片未扩（不在任务书写面内，且没有文档化清除动作可覆盖"消失"）。已登记的浏览器 AC（AC-002/052/071/073/076/023/024/034）在 `pnpm test:e2e` 中 17/17 通过，未削弱。

---

## 8. 原始证据（真实命令与结果，最终树）

| 命令 | 退出码 | 结果 |
|---|---|---|
| `pnpm typecheck` | 0 | 无诊断 |
| `pnpm lint` | 0 | `All matched files use Prettier code style!`，0 error |
| `pnpm test:unit` | 0 | `Test Files 77 passed (77)`、`Tests 1456 passed (1456)`（W2 前为 1446，本切片 +10） |
| `pnpm exec vitest run --project integration apps/web/test` | 0 | 6 文件 / **59 passed**（含新增真实 drill；T4c 时 5 文件 50 passed+2 failed，另两条属其他车道、现树已修） |
| `pnpm test:e2e` | 0 | `26 checks — PASS 25 / FAIL 0 / UNVERIFIED 1`（唯一 UNVERIFIED 为 `provider.fact-and-unknown`，条件 `provider-absent`）；真 Chromium `browser: 17 passed`；`31 ACs accounted for by the drill` |
| `set -a; . /tmp/wp12-live.env; set +a; node scripts/acceptance.mjs` | **0** | **`acceptance: 94/94 ACs accounted — PASS 94 / ACCEPTED 0 / FAIL 0 / MISSING 0`**；内部顺序实跑 `unit exit=0 1456 tests`、`integration exit=0 535 tests`、`pnpm test:e2e exit=0`、`pnpm test:live exit=0`；`acceptance: evidence binding sha256:733646d8f1fa… (HEAD a75322c, 350 code files)` |

**没有任何 AC 变成 UNVERIFIED/MISSING/ACCEPTED**；`94/94 — PASS 94 / ACCEPTED 0 / FAIL 0 / MISSING 0` 逐字保持。`scripts/lib/drill-acs.mjs` 未改也不应改。

---

## 9. 诚实缺口清单

1. **待办的清除语义缺失（本切片的核心缺口，已按任务书"停下上报"）**：文档只定义"用户自行处理文件"，没有定义待办如何关闭。实现按文档只做了"渲染 + 说明 + Chief 深链 + 无伪造按钮"；两个方案见 §4.3，需持钥者裁决。**因此 W2 退出判据里的"处理→消失"目前只能在 decision/permission 上成立，敏感文件待办"出现→处理"成立、"消失"不成立。**
2. **只上报用户面待办**：`inboxUserTodos()` 只取 `kind='sensitive_file'`。`kind='context'`/`'request_dispatch'` 与 Join 失败待办的读者是 Chief（`rules/agents.md` §3、错误表"CONTEXT_FORBIDDEN（Chief处理）"），把它们做成用户卡会制造无动作的歧义卡；若产品要求"Inbox 显示各类 Chief 待办"，只需去掉这一处 kind 过滤（页面通用分支已具备诚实降级能力）。
3. **`inbox` 方法本身未进 `protocol.md`**：它是既有的未登记页面聚合查询（`api-gap-audit-2.md` §列已登记"文档缺口"）。本切片按范围未改 `docs/**`；新增的 `kind:'todo'` 返回形状应随该文档缺口一并补齐。
4. **历史待办可见性受保留窗口约束**：`event` 表截断后，被截断的旧待办不再出现在 Inbox（读面从 `oldestCursor()` 起扫）。这是保留策略的自然结果，非本切片引入。
5. **浏览器套件未覆盖 Inbox**：见 §7 末。

---

## 10. 交还声明

- 本切片改动文件（§1）**无进一步改动计划**；`apps/daemon/src/protocol.ts` 只动了读面与界面目录，无写语义变化，下一个写者可直接接手。
- 若 Review 判定 daemon 不应有任何改动，最小回退集是 `apps/daemon/src/protocol.ts` 的 `inboxUserTodos()` + `inbox()` 调用 + 13 个界面键（回退后 UI 读不到任何敏感文件待办，W2 缺口原样保留）；`apps/web/**` 的渲染/测试/实时刷新不受影响、可独立保留。

---

## 11. 追加：方案①落地——用户面待办清除入口（持钥者裁决后）

持钥者裁决走 §4.3 方案①（新增用户面清除入口），并要求同步协议文档、UI 两个动作、真 Chromium 证据。本节即该追加实现；§1–§10 的渲染/实时刷新/i18n/负测语义全部保留不变。

### 11.1 变更清单（追加）

| 文件 | 变更 |
|---|---|
| `apps/daemon/src/protocol.ts` | 新增写方法 `chief.todo.resolve`（进 `WRITE_METHODS` + `LEDGER_WRAPPED_METHODS`）；`readUserTodos()/resolvedTodoIds()/todoResolution()/scanEvents()` 读面助手；`inboxUserTodos()` 过滤已关闭待办；`UI_STRINGS` 补 5 键 |
| `docs/architecture/protocol.md` | §4 方法表新增 `chief.todo.resolve*` 行；§4 增一段语义（确认不授权、todoId 来源、档位不变、幂等、NOT_FOUND/VERSION_CONFLICT）；§7 事件列表新增 `chief.todo_resolved` 并说明为何不复用 `chief_action_required` |
| `apps/web/src/pages.ts` | 待办卡新增「已处理」`data-todo-disposition="handled"` 与「忽略」`data-todo-disposition="dismissed"` 两个具名按钮 + 可选备注输入框 |
| `apps/web/src/i18n.ts` | `inbox.todoActions`/`todoHandled`/`todoDismissed`/`todoReason`/`todoResolved`（en+zh） |
| `apps/web/public/app.js` | `inboxActionRequest` 增 `chief.todo.resolve` 路由；`initInbox` 识别 `button[data-todo-disposition]`、成功读回、拒绝保留条目并显示协议码、`disableTodoRow`；`inboxEvents` 增 `chief.todo_resolved` |
| `tests/browser/**` | 新增 `ac-074-inbox-todo.spec.mjs`（真 Chromium：出现→点击「Handled」→消失→刷新仍不出现）；`stack-runtime.mjs` 播种真实 `.env`（含标记）与待办事件；`constants.mjs` 加标记常量 |
| `scripts/lib/{browser-suite,drill-acs}.mjs`、`scripts/e2e.mjs` | 把 AC-074 登记为浏览器检查 `browser.inbox-todo-resolution`（无浏览器时记 UNVERIFIED 分支），使新 spec 红即 `pnpm test:e2e` 红——断言不放宽 |
| 测试 | `apps/web/test/{views,pages,client-script}.test.ts` 扩展；`inbox.integration.test.ts` 扩到真实拒绝→真实 `chief.todo.resolve`→真实读回 |

### 11.2 方法语义（`chief.todo.resolve`）

- 参数 `{workId, todoId, disposition: 'handled'|'dismissed', reason?}`；`todoId` 即 Inbox 待办卡的 `id`（`workId:path:pattern`，与 `chief_action_required` 的落库幂等键一致）。写命令账本 + 幂等键（同键同载荷重放原结果、同键异载荷 `IDEMPOTENCY_CONFLICT`），另给 `expectedVersion` 时目标为 Work 当前 version。
- **确认，不是授权**：只 `recordUserAction('chief.todo.resolve', workId, {...todoId...})` + append `chief.todo_resolved`（data：`workId`/`todoId`/`disposition`/`reason?`/`actionId`）；**不铸 Grant、不放行工具调用、不改 `configPolicy`**。集成用例在关闭后重发同一 `read` 仍是 `CONTEXT_FORBIDDEN` 且 Grant 行数不变。
- 未知 `todoId`、或该 todo 属于另一个 Work → `NOT_FOUND`；重复调用幂等并回报已记录的 disposition。
- 关闭后同一 `(work,path,pattern)` 不再出现在 Inbox（读面按 `chief.todo_resolved` 过滤）：这是 tool-handler 既有幂等（同一三元组只落一条待办）与"用户已确认"共同决定的语义，已写进 `protocol.md`；拒绝本身仍类型化、仍审计。

**事件名取舍**：新增 `chief.todo_resolved` 而不复用 `chief_action_required` + `data.disposition`。理由是让"落待办"与"关待办"在日志里可分别查询，且 tool-handler 的待办幂等扫描（`name='chief_action_required' AND data.kind='sensitive_file'`）不会把关闭记录误当成一次落库。

### 11.3 UI 行为

卡片新增两个具名按钮与可选备注；点击后经写 Origin 门禁发送 `chief.todo.resolve`，**成功后重新 GET 页面读回**（条目从服务端消失，不是本地删除），失败时显示协议 code/message 且条目保留（`INVALID_STATE`/`VERSION_CONFLICT` 时禁用该行按钮）。`chief.todo_resolved` 也已进实时事件集合，其他标签页同步消失。

### 11.4 追加证据（真实命令与结果，最终树）

| 命令 | 退出码 | 结果 |
|---|---|---|
| `pnpm typecheck` | 0 | 无诊断 |
| `pnpm lint` | 0 | `All matched files use Prettier code style!` |
| `pnpm test:unit` | 0 | 77 文件 / **1458 passed**（§1–§10 为 1456，追加 +2） |
| `pnpm exec vitest run --project integration apps/web/test` | 0 | 6 文件 / **59 passed**（含真实拒绝→真实关闭→读回 drill） |
| `pnpm test:browser` | 0 | **18 passed**（新增 AC-074 spec；失败过的 AC-002 `git status` 断言通过把 `.env` 放进 `.git/info/exclude` 而保持干净） |
| `pnpm test:e2e` | 0 | **`27 checks — PASS 26 / FAIL 0 / UNVERIFIED 1`**（新增 `browser.inbox-todo-resolution [AC-074]` PASS；唯一 UNVERIFIED 仍为 `provider.fact-and-unknown`）；`31 ACs accounted` |
| `set -a; . /tmp/wp12-live.env; set +a; node scripts/acceptance.mjs` | **0** | **`94/94 — PASS 94 / ACCEPTED 0 / FAIL 0 / MISSING 0`**；内部 `unit 1458`、`integration 535`、`pnpm test:e2e exit=0`、`pnpm test:live exit=0`；binding `sha256:7e04428ad9e7… (HEAD a75322c, 350 code files)` |

### 11.5 剩余事项（追加）

1. **`docs/product/experience.md` 未改**：按持钥者"若属产品行为需先确认就只补 protocol 与技术记录"的指示，Inbox 段"处理后消失"的用户行为措辞留给持钥者确认后再写；本记录与 `protocol.md` 已把语义写清。
2. **`inbox` 方法的返回形状仍未进 `protocol.md`**：`inbox` 本身是未登记的页面聚合查询（`api-gap-audit-2.md` 已登记文档缺口）；本次只登记了新方法 `chief.todo.resolve` 与新事件，聚合查询本体随原缺口一并补。
3. **关闭是"永久关闭该 `(work,path,pattern)`"**：见 §11.2；若产品希望"用户已处理但 Agent 再次被拒就重新提示"，需要在 tool-handler 的幂等判定里纳入 `chief.todo_resolved`（本切片未做，属新语义）。
4. **`scripts/**` 与 `tests/browser/**` 为裁决后扩大的写面**：只做 AC-074 浏览器检查的登记与夹具，未改既有 AC 的判据，未新增 UNVERIFIED/MISSING。
