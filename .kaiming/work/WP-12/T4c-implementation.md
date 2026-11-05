# WP-12 T4c 实现记录（Inbox 真正可用：决定请求 + 工具权限请求）

- 基线：本工作树（`HEAD 7c723ec` + 各车道未提交改动）。本切片只改 `apps/web/**`。
- 范围：让 Inbox 渲染并处理两类真实请求——①Chief 产品决定（`kind='product'`，问题正文在 `targetRef` 指向的 `kind='decision'` Artifact 里）；②工具权限请求（`kind='permission'`，`waiting_permission` Run 的 approve/deny）。
- 事实来源（先读后写）：`docs/product/experience.md` §1/§5/§6/§7；`docs/architecture/protocol.md` §4（`decision.resolve`/`permission.request`/`permission.respond`）、§5（`artifact.get` + `/artifacts/:id/preview`）、§6（`decision.request` 渲染契约、`tool.execute`）、§7（事件 `decision.created`/`decision.resolved`/`permission.resolved`/`tool.refused`、错误表）；代码：`apps/daemon/src/protocol.ts`（`inbox()`、`resolveDecision`、`respondPermission`）、`packages/core/src/permissions.ts`、`apps/daemon/src/control-handler.ts`（`decision_request`）、`apps/web/src/**`、`apps/web/test/**`。
- 不改：`packages/**`、`apps/daemon/**`、`apps/cli/**`、`scripts/**`、`tests/browser/**`、根配置。`apps/daemon/src/protocol.ts` 由 T3 车道在改，本切片只读。
- 说明：任务书即本切片的批准 Plan（父 Agent 下发）；`apps/web/**` 工作树里另有 T1/T4a/T4b 车道未提交改动，本切片在其之上追加，未回退任何他人代码。

## 1. 两类 Inbox 条目的数据模型（`apps/web/src/views.ts`）

`InboxRow` 扩展为可区分请求类型，且**只从协议答案取字段**（不发明数据）：

- `entry: 'decision' | 'permission' | 'finding' | 'recovery'`；`decisionKind` 为原始 `decision.kind`。
- `targetId`：原始 `targetRef.id`（决定是 Artifact id 或 toolOperationId）；`artifactId`/`artifactVersion` 仅在 `decisionKind==='product'` 时给出（§6 的问题契约）。
- `question: InboxQuestion | null`（`{text, error}`）：由调用方解析后传入；非 `product` 决定为 `null`（无问题契约，不猜）。
- `binding: InboxBinding | null`（`{operation, targets, inputHash}`）、`bindingMissing`：权限决定绑定；`operation` 缺失即 `bindingMissing=true`。
- `role`/`stage`/`runStatus`/`runId`：由 `run.list` 里 `status==='waiting_permission'` 的 Run 合并（§4「权限请求属于某个 Run/Work」）。
- 新增 `InboxContext { questions, waitingRuns }` 与 `questionKey(artifactId, version)`；`inboxModel(raw, context = {})` 保持旧调用兼容（既有单测不变仍绿）。
- 去重规则不变（`target + targetVersion` 一行），过期/非 pending 仍 `actionable=false`。

## 2. 权限请求卡片：先展示将授予什么，再给明确的 approve/deny（`pages.ts`）

- `inboxPermissionRow`：行头显示 `inbox.permission` + 绑定操作 + 目标版本 + 状态；`data-entry="permission"`、`data-tool-operation`（= toolOperationId）、`data-binding-missing`、`data-work`。
- 「将授予的内容」`<dl class="binding">` 依序渲染：操作（行头）、目标路径/引用、inputHash、绑定哈希、授权范围（`once`）、Run、Work、发起方（role · stage · Run 状态）。
  - `targets` 为空时渲染 `inbox.noTargets`（命令类操作的真实语义），不留空值。
- 按钮：`data-permission="approve"`（文案 `inbox.approve`）与 `data-permission="deny"`（`inbox.deny`）；绑定未知或决定已过期时 **approve 带 `disabled aria-disabled="true"`**，并用 `inbox.bindingMissing` 说明原因——**不提供盲批准**，也不自动批准。deny 在未过期时始终可用。
- 每条权限卡片带必填原因输入（`<label data-i18n="inbox.denyReason">` + `<textarea data-permission-reason>`），拒绝必须带原因。
- 产品决定卡片：`inboxQuestionBlock` 渲染 `targetRef` Artifact 正文（`data-question-body data-i18n-project data-translatable="false"`，项目内容不翻译）；读不到时渲染 `inbox.questionUnavailable` + 把守护进程诊断放进 `title`；正文为空时渲染 `inbox.questionEmpty`——三种情况都**不会出现空白卡片**。选项按钮保持原 `data-choice` 形态（既有断言 `data-decision/data-choice/disabled` 顺序不变）。
- 空列表提示改为常驻 `#inboxEmpty`（有行时 `hidden`），并新增 `#inboxStatus`（aria-live）与 `#inboxRefreshError`。
- `apps/web/src/shell.ts`：`inbox` 导航项常驻 `#inboxBadge`（计数为 0 时 `hidden`），使实时刷新能更新角标。

## 3. BFF：解析问题正文与停泊 Run（`daemon.ts` + `app.ts`）

- `apps/web/src/daemon.ts` 新增 `daemonPreview(target, session, artifactId)`：按 §5 的文档化预览端点 `GET /artifacts/:id/preview` 读取 Artifact 正文，使用 BFF 自己的 daemon 会话 cookie（浏览器拿不到该 cookie）；失败以 `{ok:false, code, message}` 返回数据而非抛出。
- `createWebApp` 新增可注入的 `preview`（默认 `daemonPreview`），单测无需真实 daemon。
- `app.ts` 的 `inbox` 分支新增 `inboxContext(session, raw)`：
  - 对每个 `kind==='product'` 决定读一次正文（按 targetRef.id 去重），成功写 `{text,error:null}`，失败写 `{text:'', error:'CODE: message'}`；
  - 对每个有待处理权限请求的 Work 调 `run.list` 一次，取 `waiting_permission` 的 Run（id/role/stage/status），读失败则跳过（不猜）。
  - 读取次数受页面行数上界约束，全部是只读命令；渲染期间不发任何写命令。

## 4. 客户端行为（`apps/web/public/app.js`）

- 新增纯函数 `inboxActionRequest(action, data)`（可被 `client-script.test.ts` 按源码求值）：
  - 产品决定 → `decision.resolve {decisionId, choice}`；
  - 权限按钮 → `permission.respond {decisionId, choice}`，deny 附加去空白的 `reason`；
  - deny 缺原因 → 本地 `VALIDATION_ERROR`（`reasonRequired`），**不发请求**；未知 choice / 缺 decisionId 同样本地拒绝。
- `initInbox`：事件委托挂在 `#inbox`（刷新只替换 `#inboxList` 的 innerHTML，监听不丢）；写请求带 `idempotencyKey`（`permission-<choice>-…` / `decision-…`）与 `expectedVersion = data-target-version`（§1）；同一应答前按钮禁用防重复点击。
- 拒绝路径：`showError('inboxError', answer.error)`（协议 code + message）后 `return`，**不刷新、不清输入、不改条目**；`INVALID_STATE`/`VERSION_CONFLICT` 额外禁用该行按钮（`AC-074`）。
- 成功路径：显示 `inbox.resolved` / `inbox.denied` 状态，然后**从服务端读回列表**（`refreshInbox()` 用 GET 取当前页 HTML，只替换 `#inboxList` 与空提示/角标），条目因此离开 Inbox；刷新失败才退回整页 reload。
- 实时（§7）：`decision.created`/`decision.resolved`/`permission.resolved`/`state.decision_required` → 服务端读回式刷新；`tool.refused` → 按 `entityId`（= toolOperationId）记住 `{operation, targets, inputHash, runId}`，并通过 `data-tool-operation` 回填到对应权限卡片、解除 `inbox.binding-missing` 并启用 approve。因此**页面打开期间新到达的权限请求**能显示完整绑定并可批准；刷新本身是 GET，不影响运行中的 Run，也不需要手动 reload。

## 5. i18n 与密钥

- `apps/web/src/i18n.ts` 新增全部新可见字符串的 `en` + `zh`：`inbox.permission`、`inbox.permissionBinding`、`inbox.operation`/`targets`/`noTargets`/`inputHash`/`bindingHash`/`grantScope`/`grantScopeOnce`、`inbox.bindingMissing`、`inbox.approve`/`deny`/`denyReason`/`denyReasonRequired`、`inbox.decisionKind`/`raisedBy`/`raisedByChief`/`raisedByRun`、`inbox.question`/`questionUnavailable`/`questionEmpty`/`artifact`/`work`/`run`、`inbox.resolved`/`denied`/`refreshFailed`，以及状态键 `state.pending`/`accepted`/`rejected`/`waiting_permission`。
- 问题正文是项目内容：`data-i18n-project` + `data-translatable="false"`；语言切换不会替换它。
- 负向检查：`inbox` 载荷里即使混入 `secret`/`secretRef` 也不会进入视图模型或 HTML（`views.test.ts`/`pages.test.ts` 新增断言，既有 Provider 密钥负测保持绿）。

## 6. 测试

新增/扩展（均在 `apps/web/test/**`）：

| 文件 | 覆盖 |
|---|---|
| `views.test.ts` | 产品问题解析成功/读失败/空正文回退；权限绑定的 operation/targets/inputHash + 停泊 Run 合并；绑定缺失标记；非 product/permission 决定无问题契约；模型不含 secret/secretRef |
| `pages.test.ts` | 产品卡片渲染问题正文+选项+目标+发起方；读失败/空正文的显式文案（诊断仅在 `title`）；权限卡片先展示绑定、approve 未被禁用、deny 原因必填；绑定缺失时 approve 禁用而 deny 可用；已解决权限保持惰性；`targets: []` 渲染「未记录目标」；两类条目都不泄漏 secret/secretRef；渲染键都在字典里 |
| `client-script.test.ts` | `inboxActionRequest` 路由 `decision.resolve`/`permission.respond`；deny 缺原因本地拒绝且不发请求；handler 带幂等键 + `expectedVersion`；拒绝分支只显示错误并 `return`（无 reload/refresh）；成功后才从服务端读回；未自动批准；实时事件集合与 `tool.refused` 回填、刷新走 GET |
| `inbox.integration.test.ts`（新增） | 真实 daemon+SQLite：产品问题正文经真实 `/artifacts/:id/preview` 读回并渲染；权限请求显示停泊 Run 且如实标注未上报绑定（approve 禁用）；`permission.respond` 作为写命令受 Origin 门禁（跨源 403），daemon 未挂 tool bridge 时真实 `PROVIDER_UNAVAILABLE`（422）原样返回 |

## 7. 证据（实际执行）

| 命令 | 结果 |
|---|---|
| `pnpm --filter @agentdev/web build`（`tsc -p apps/web/tsconfig.build.json`） | **exit 0**（apps/web 源码类型干净） |
| `pnpm typecheck` | **exit 1**；2 个 error 全在 `apps/daemon/test/tool-bridge.integration.test.ts`（T3 车道在改），**apps/web 0 error** |
| `NODE_OPTIONS=--require=scripts/typescript-6-preload.cjs pnpm exec eslint <本切片 11 个文件>` | **exit 0** |
| `pnpm exec prettier --check <本切片 11 个文件>` | **exit 0**（All matched files use Prettier code style） |
| `pnpm exec vitest run --project unit apps/web/test` | **exit 0**：4 文件 / **134 passed**（含新增用例） |
| `pnpm exec vitest run --project integration apps/web/test` | **exit 1**：5 文件 / **50 passed, 2 failed**；失败均在 `workbench.integration.test.ts`，与本切片无关（见 §8-4）；新增 `inbox.integration.test.ts` 3/3 PASS |
| `pnpm test:browser` | **exit 0**：**16 passed**（真实 Chromium + 真实栈，含 AC-071/AC-073 键盘与语言、Live 布局零 `/rpc`） |

## 8. 缺口清单（诚实）

1. **daemon `inbox` 未暴露权限请求的绑定（本切片最关键的缺口）**。`apps/daemon/src/protocol.ts` 的 `inbox()` 对 `kind='permission'` 决定只给 `targetRef{id,version,hash}`、`choices`、`state`；`operation`/`targets`/`runId`/`inputHash` 只在 `decision.created`（仅 operation）与 `tool.refused` 事件里。因此**页面加载前就已 pending 的权限请求**无法在 UI 上展示「将授予什么」，按第 2 节规则 approve 被禁用（deny 仍可用并记录原因）。需要 daemon 车道二选一：①`inbox` 的权限条目补 `operation`/`targets`/`runId`/`inputHash`（推荐，字段名与 `permission.request` 参数及 `tool.refused` 事件一致，UI 已按这些名字读取）；②新增文档化读命令（如 `permission.get`/`tool.operation.get`）并登记进 `protocol.md` §4/§5。**本切片未发明客户端专用回退**：只在字段存在时渲染。
2. **`permission.respond` 不接收/不落库拒绝原因**。§4 的参数只有 `decisionId, choice`；`apps/web` 已按要求发送去空白的 `reason` 并在本地强制必填，但 daemon 的 `respondPermission` 只读 `decisionId/choice/targetVersion/(limits/targets)`，通用幂等账本只存 `payload_hash`，`permission.resolved` 事件也不带 reason——即**原因当前不会留下可核对的记录**。需要 daemon 接受 `reason` 并落进决定/user action/事件之一。
3. **历史 pending 权限请求无法回溯绑定**：实时事件路径（§4）只在 Inbox 页打开期间到达的 `tool.refused` 上生效；`project.subscribe` 新订阅从快照游标开始、不回放历史事件，BFF 也没有读事件的客户端命令。缺口 1 修好后此限制自然消失。
4. **两条与本切片无关的既有红灯**（`workbench.integration.test.ts`，属其他车道）：①AC-090 断言期望 `data-git-unpushed="unreported"`，而当前 requirement 读面已变化；②`requirement.archive` 断言期望 `NOT_FOUND`，而 daemon 工作树已实现该命令（现返回 `REQUIREMENT_CONFLICT`）。本切片不碰这两条代码路径。
5. **`pnpm typecheck` / 全仓 `pnpm lint` 仍非全绿**：错误全部来自 `apps/daemon/test/**` 与 `apps/daemon/src/**`（T3 车道在改）。本切片只按任务书要求做了 scoped eslint + prettier，结果全绿。
6. **CSP/密钥不回显**：`daemonPreview` 读取的是 Artifact 正文（项目内容），不涉及 `secret.*`；`secret.set` 值仍不进入页面模型或 HTML（负测覆盖）。

## 9. 需要的决定

1. 权限绑定由 daemon `inbox` 直接补字段，还是新增 `permission.get` 读命令？（推荐前者；UI 已按 `operation`/`targets`/`runId`/`inputHash` 读取。）
2. `permission.respond` 是否接受并持久化拒绝 `reason`（决定行/user action/`permission.resolved` 事件）？当前 UI 已强制必填并随请求发送，但服务端会忽略。
