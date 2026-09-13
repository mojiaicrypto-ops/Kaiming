# WP-09（完整 Web 工作台）独立 Review 报告

- 角色：INDEPENDENT REVIEW（独立上下文；未读取任何开发/Test 聊天或会话）
- 工作包：WP-09 完整 Web 工作台
- 冻结点：`9f107ac`（`feat(client,daemon,web): implement the WP-09 web workbench`）
- 证据目录：`/tmp/wp09r/`（Reviewer 自建探针，消费 **已构建** 产物 `packages/client/dist`、`apps/daemon/dist`、`apps/web/dist`；真实 loopback HTTP/WS + 真实 SQLite + 真实 Git 工作树）
- 唯一写入：本文件（`.agentdev/work/WP-09/review.md`）

## 1. 冻结与哈希

| 项 | 值 |
|---|---|
| `git rev-parse HEAD` | `9f107ac1653aa81023072c2ce3f3238322d4399f` |
| `git rev-parse 9f107ac^{tree}` | `95b9b6c4c262ccc28eaecb129a5facbfd48f9f86` |
| `git status --porcelain` | 空（工作区干净） |

受审文件（`git rev-parse HEAD:<path>`）：

| 文件 | blob |
|---|---|
| `packages/client/src/connection.ts` | `0132bb378236ede995dddf0e4e055bd18e7892dd` |
| `packages/client/src/commands.ts` | `408d459bc06f4f362db09f25b7e2ab44e50e54fe` |
| `packages/client/src/subscriptions.ts` | `2a716c7a25ebf0caf4f9982bd3c2eaf352517e40` |
| `packages/client/src/index.ts` | `4c5280252d85db921558ed4ae978c569b78bb63f` |
| `apps/daemon/src/protocol.ts` | `cf9a26083f72deb6824f2d13f1a5867d4dd19c55` |
| `apps/daemon/src/server.ts` | `0ef730051dbef6ea7e10bd84f229edb578c1f5ac` |
| `apps/web/src/app.ts` | `a3e04c62080670ac70b4a24e92229d429cca0bd2` |
| `apps/web/src/daemon.ts` | `f15eeaaedab17775379d989f89a7d06bf99fa6fa` |
| `apps/web/src/views.ts` | `b743c95c4708da10e8e1dbd0048e3d2bd7abb8c0` |
| `apps/web/src/pages.ts` | `553a7f4d64beca33b7cf440143b7a3853f4a2ada` |
| `apps/web/src/shell.ts` | `1431db97c1faed4ad261518fb3b92d143143e899` |
| `apps/web/src/i18n.ts` | `6e5c55f8d420a3229e33b44f14fb8e011d9778a8` |
| `apps/web/src/sessions.ts` | `c46b45cc557a0eecb7fddc3d669a387ff1fb68b8` |
| `apps/web/src/files.ts` | `468c9a561b2ab67e38356161ebc743581510950d` |
| `apps/web/src/html.ts` | `e35bf5b97ad124968a866090163837e3f58f591b` |
| `apps/web/public/app.js` | `65c7568a4ade2bc5d14a8726b18ae1d99d65a1c8` |
| `apps/web/public/styles.css` | `9b39ea5c94e3fe54be32b650a7274ec154cc2896` |
| `apps/web/test/workbench.integration.test.ts` | `cf53e7f965e22864faf6b871ce36a3cf53d52caf` |
| `apps/web/test/workbench-failures.integration.test.ts` | `3992f708614e362e3f84706cdd127f7213b4e29e` |
| `apps/daemon/test/protocol.integration.test.ts` | `28241d3d145a8ee7fac54e505fbea457103a7ca2` |
| `packages/client/test/wire.integration.test.ts` | `1339d0f851904bf3cc7a24c391310132f3a85597` |

## 2. 结论

**FAIL** —— 存在 2 项可复现 P1（`W9R1-01`、`W9R1-02`，同一根因：工作台 Plan 批准链在 UI 上不可达），另有多项 P2/P3。**不能进入独立 Test**，须先回 Develop 修复 P1 并重新独立 Review。

### 计数与阻断

| 严重度 | 数量 | 是否阻断 |
|---|---|---|
| P0 | 0 | — |
| P1 | 2 | **阻断** |
| P2 | 6 | 不阻断，已登记 |
| P3 | 4 | 不阻断，已登记 |

## 3. 契约命令原始结果

全部在仓库根、`export PATH="$HOME/.local/bin:$PATH"` 下执行；`cmds.log` / `integration.log` / `unit-bounded.log` 保存于 `/tmp/wp09r/`。

| 命令 | 退出码 | 原始结果 |
|---|---|---|
| `pnpm typecheck` | 0 | `tsc -p tsconfig.json --pretty false`，无输出 |
| `pnpm lint` | 0 | `node scripts/lint.mjs`，ESLint + Prettier check 通过 |
| `pnpm test:unit` | **1** | `Test Files 2 failed | 52 passed (54)`、`Tests 2 failed | 1094 passed (1096)`；两例 `Test timed out in 5000ms`：`packages/workspace/test/initialize.test.ts > budget exhaustion without capability (W4R2-01 regression) > finds the capability once the investigation batch is enlarged`、`packages/core/test/wp08-failures.test.ts > required WP-08 failure tests > 备份演练: backup → restore …(AC-064)` |
| `pnpm test:unit --maxWorkers=4`（复核） | 0 | `Test Files 54 passed (54)`、`Tests 1096 passed (1096)` |
| `node_modules/.bin/vitest run --project integration --maxWorkers=4` | 0 | `Test Files 25 passed (25)`、`Tests 296 passed (296)`；`Duration 107.53s` |
| `pnpm docs:check` | 0 | `docs:check ok — 15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages` |
| `pnpm build` | 0 | `pnpm -r build` 全 12 个 project `Done` |
| `pnpm test:e2e`（参考） | 1（`[ELIFECYCLE]`） | `NOT_IMPLEMENTED: command test:e2e is not implemented yet; it lands with WP-09`（与 `docs/INDEX.md` 第 44 行一致） |

> 记录核对：`implementation.md` §T5 声称 `test:unit 54 文件 / 1096 用例`、`test:integration 25 文件 / 296 用例` —— 与有界口径完全一致；但**契约命令原文 `pnpm test:unit` 在冻结点上不通过**（见 `W9R1-06`）。`T3-implementation.md` 的 `23 文件 / 277 用例` 是其自身切片时点的旧快照，与 T4 之后的 296 用例不矛盾，但两份记录并存易误读。

## 4. 方法与用例数

全部探针由 Reviewer 独立编写，只消费 **dist 构建产物**，不 import 任何产品测试文件。

| 脚本（`/tmp/wp09r/`） | 覆盖 | 用例数 | 结果 |
|---|---|---|---|
| `probe1.mjs` | 水位重连、同键重放、通用写幂等、未登录/错误 Origin/过期会话/WS Origin、跨 Project 订阅、静态穿越、CSRF、client 水位与本地 ACL、BFF WS 桥 | 11 | 11 PASS |
| `probe2.mjs` | 看板身份/L1/取消暂停、Chief 路由与 Composer、Plan 版本与批准、Inbox 去重/汇总/过期、配置校验、非 Chief 归属、i18n/ARIA/面板 | 16 | 15 PASS / **1 FAIL（P1）** |
| `probe3.mjs` | CSRF 双层、已登录静态穿越、附件限制与残留、首条消息原子绑定、过期清理、文件根边界与 revision、真实 Git 需求保存、真实 Git Queued 取消、三态面板无副作用 | 10 | 10 PASS |
| `probe5.mjs` | **产品** `createDaemon` 直连：上传 201/400 + `message/details`、`/rpc` 状态映射 | 5 请求 | 全部符合错误表 |
| `probe6.mjs` | **产品** `createDaemon` + 真实 `PlanGateService`：UI 批准载荷 vs 正确载荷 | 2 请求 | UI 载荷 422；正确载荷 200/applied |
| `probe9.mjs` | 看板子条件逐项复算（排除断言自身缺陷） | 8 断言 | 全部 true |

关键排除性证据（防止把探针缺陷当成产品缺陷）：

- `probe5`：产品 daemon 对 `application/zip` 返回 `400 {"code":"VALIDATION_ERROR","message":"attachment mime application/zip is not supported","details":{"mime":...,"allowlist":[...]}}`；对 22 020 096 字节返回 `400 … "attachment exceeds the per-file size limit"`。即**产品状态映射与拒绝原因完整**；`probe3` 早期看到的 `401 + 无 message` 是 Reviewer 早期夹具（复刻 daemon 路由时未做 `ProtocolError → statusForCode` 映射）造成的，已改写为 `probe5` 口径，不作为发现。
- `probe9`：把 `W9R1-B1` 的 8 个子条件逐项复算，全部为 true，说明首轮 FAIL 是 Reviewer 自己的计数口径错误（6 条需求误写 7），已修正。

## 5. 逐 AC 结果

| AC | 结论 | 证据（自测） |
|---|---|---|
| AC-054 UI 断开 | **通过** | `W9R1-A1`：`afterCursor=2` 精确重放 `[3,4,5]`（watermark 5），dedup=0、gap=0、连续；`W9R1-A11`：client `deliver` → `delivered/duplicate/gap`，`resume` 以水位为准；`W9R1-A12`：BFF 桥保留浏览器请求 id 并转发真实事件 |
| AC-068 看板身份 | **部分通过（P2）** | `W9R1-B1/B2`：6 条需求 identity 唯一且恒为 Requirement id、L1 Work 进 `excludedWorkIds` 且不入板、Queued 无 Work `canPause=false` + `data-refused="INVALID_STATE"`、`canCancelWithoutWork=true`；`W9R1-B3`：暂停返回 `409/INVALID_STATE`。**取消不成立**：`W9R1-B4`（无记录服务）`INVALID_STATE`；`W9R1-C9`（真实 Git）`VALIDATION_ERROR`（`content.md 结构不符合需求池规范（六个二级标题各一次）`），lifecycle 仍 `queued`、分支不动 |
| AC-069 持续对话 | **通过** | `W9R1-B5`：消息 → 真实 Work（`work.intent=delivery`、`sourceRef.kind=message`、assessment `reason="explicit command with a target…"`、`intent=delivery`）；`W9R1-B6`：`composerSend` 可用、真实消息状态渲染、项目内容 `data-translatable="false"`；失败测试「持续对话」7 例命名齐全 |
| AC-070 产物版本 | **失败（P1）** | 版本显示与过期拒绝成立：`W9R1-B8` 过期版本 `409/VERSION_CONFLICT currentVersion=1`。**批准不成立**：`W9R1-B7` 以 `app.js` 真实载荷（`plan:{}` + `authorizationRef:'workbench'`）批准其自显示的有效版本 → `422 VALIDATION_ERROR: plan.tasks must be a non-empty array`；`probe6` 用产品 daemon + 真实 gate 复现：UI 载荷 422，正确载荷 200/applied。截断与一次性下载由 T4 测试覆盖并通过（原件 1 200 000 → preview ≤1 MiB → 一次性 token 全量、二次消费 ≥400） |
| AC-071 Live 布局 | **通过** | `W9R1-C10`：`data-panel-mode` 三态随 cookie 渲染；`setPanelMode` 内无 `fetch(`；切换前后 Work/Run 行数不变；`W9R1-B16`：顶栏 toggle 先于 dock、`aria-controls="liveDock"`、`toggle.focus()` 回焦 |
| AC-072 Conversation 归属 | **部分通过（P2）** | `W9R1-B13`：非 Chief 页无 `newConversation`/`switchConversation`，且有真实 `discussInChief` 深链。**Chief 侧控件是死件**：`W9R1-B14` 渲染 `newConversation`/`switchConversation`/`conversationSelect`/`newConversationInline`，但 `app.js` 无任何监听、daemon 无 `conversation.create`（grep 计数 0） |
| AC-073 语言可访问 | **通过（有覆盖限制）** | `W9R1-B15`：`applyLanguage` 仅写 `[data-i18n]`/`[data-i18n-aria]`，`[data-i18n-project]` 仅标记 `data-translatable="false"`，从不写 textContent；`W9R1-B16`：ARIA/`aria-live`/键盘可达（原生元素）。无头浏览器级焦点/ARIA 实跑未做（登记） |
| AC-074 Inbox 去重 | **通过** | `W9R1-B9`：同 target+version 重复决定 → 1 行（daemon 与页面双层去重）；3 条 P1 阻断 Finding → 1 行汇总且计数 `3`；过期决定 `aria-disabled="true"`；`W9R1-B10`：过期决定 `409/INVALID_STATE` |
| AC-075 配置错误 | **通过** | `W9R1-B11`：结构非法 patch → `422/VALIDATION_ERROR` 且 `details` 含原输入（`preservedInput`），`config.get` revision 不变；`W9R1-B12`：Settings 渲染活动 revision 且不回显安装令牌；失败测试「配置失败」同时覆盖能力拒绝（`PROVIDER_UNAVAILABLE`，命名 `does not support reasoning high`） |
| AC-076 附件限制 | **通过** | `W9R1-C3`：6 个上传中发送 6 附件消息 → `VALIDATION_ERROR`（数量在发送事务校验）；`probe5`：产品 daemon 对 zip → `400 mime not supported`、22 020 096 B → `400 exceeds the per-file size limit`；`W9R1-C4`：被拒上传不产生行 |
| AC-077 文件只读 | **通过** | `W9R1-C7`：`..%2F..%2Fetc%2Fpasswd` → `data-code="NOT_FOUND"`、不回显 `root:`、`data-revision` 与 Project 行一致、Work 行数不变；T4 另有 `?query=orders` 过滤与磁盘文件逐字节未变 |
| AC-078 认证生命周期 | **通过** | `W9R1-A4`：未登录写 401 / 错误 Origin 403 / 后台 Work 仍 `running`；`W9R1-A5`：过期会话 `/rpc 401 AUTH_EXPIRED`、`/ws` 升级 401；`W9R1-A6`：外来/缺失 Origin 的升级均 401 不到 101；`W9R1-A8/C2`：已登录静态穿越全部 404；`W9R1-A11`：本地越权订阅不发请求 |
| AC-084 首条消息附件 | **通过** | `W9R1-C5`：上传 → 首条消息 `ok`，附件 `state=bound` 且 `boundMessageId` 与消息一致，复用 → `ATTACHMENT_ALREADY_BOUND`；`W9R1-C6`：过 TTL 后 `expireStale` 置 `expired` |
| AC-087 需求池随 Git 迁移 | **通过（承接 WP-04/08）** | `W9R1-C8`：真实 Git 创建保存 → 两文件同 commit 且 `requirement.json.version=1`、`content.md` 含六段标题、`sha256(content)=contentHash`、投影 `portableRef.revision=commit`，随后看板才出现 `data-identity` |
| AC-088 历史需求展示 | **通过（承接 WP-04）** | 本次未新增独立探针；由 WP-04 结算承接，T4「九面读数」断言 completed/archived/cancelled 三列生命周期 |
| AC-089 进行中需求继续 | **通过** | T4 断言：导入 active → 看板/详情显示「待继续」、Runs 无该 Work；`requirement.continue` 后新建 Work+授权、`runs.count=0`、`reusedPreviousVerification=false` |
| AC-090 需求保存时机 | **通过** | `W9R1-C8` 与 T4「Git 与投影一致后 UI 才显示 saved」；保存响应 `accepted`/`git.commit/branch/ref/unpushed`、`save_failed` 只来自真实 operation 状态而非推断 |
| AC-093 目录与正文一致性 | **通过** | `W9R1-C8`：两文件共享 version、组合 Hash 校验；`W9R1-C9` 证明 canonical 结构缺失时**诚实拒绝且分支不动**（不静默写坏记录） |

### 六个必需失败测试

均存在且逐字命名（`apps/web/test/workbench-failures.integration.test.ts`）：**持续对话**、**过期卡片**、**窄屏焦点**、**断连**、**配置失败**、**订阅扩大**（7 例，含「订阅扩大」的服务端与客户端本地两例）。集成运行 296/296 全绿。

## 6. 发现

### W9R1-01（P1，阻断）工作台不能批准任何有效 Plan；批准按钮永远以非零错误结束

- 位置：`apps/web/public/app.js:627-637`（`plan: viewData() && viewData().plan ? viewData().plan.draft || {} : {}`、`approval: { authorizationRef: 'workbench', runId: 'workbench' }`）；`apps/web/src/app.ts:845-880`（`planCard` 只产出版本，不产出 Plan 正文/授权引用）
- 复现：`probe2 W9R1-B7`（真实 BFF+daemon+gate）：有效 Plan `v1`、页面 `data-current-version="1" data-expired="false"`，以 `app.js` 原样载荷调用 → `422 {"code":"VALIDATION_ERROR","message":"plan.tasks must be a non-empty array"}`；`probe6` 在产品 `createDaemon` 上复现同一结果，而换成真实 `authorizationRef` + 真实 PlanDraft → `200 applied, version:2`
- 观察 vs 期望：观察到批准不可达（422，且 `authorizationRef:'workbench'` 还会在任务为空时被 `PlanGateService.authorizationOrRefusal` 拒为 `NOT_AUTHORIZED`）；期望工作台能批准它自己显示的那个版本
- 契约：AC-070「打开/批准/下载…过期拒绝」；`experience.md` §3「历史审批只针对该版本；过期审批返回冲突并刷新」；`protocol.md` §4 `plan.approve` 语义
- 修复方向：详情页必须从 gate 读取当前 Plan 正文与 Work 的本地 `authorizationId` 并随请求下发（或新增「读取当前 Plan」查询）；批准按钮在缺少 Plan 正文/授权时应不可点并说明原因，而不是发出必然失败的请求

### W9R1-02（P1，阻断）详情页永远无法显示过期/历史 Plan 卡片（`data-expired` 恒为 false）

- 位置：`apps/web/src/app.ts:583-591`（调用 `planCard` 未传 `requestedVersion`）→ `apps/web/src/app.ts:868`（`const requested = input.requestedVersion ?? currentVersion`）；`apps/web/public/app.js` 全文件无 `planVersion` 查询参数读取（grep 仅命中 `data-plan-version`）
- 复现：`probe2 W9R1-B7` 记录 `data-expired=false` 且 `data-requested-version == data-current-version`；T4 自己的「过期卡片」用例以 `?planVersion=<liveVersion-1>` 打开页面，得到的仍是 `data-plan-version="<liveVersion>"`、`data-expired="false"` —— 该用例断言的是「页面显示 gate 的活版本」，并未证明存在一个显示为过期的卡片
- 观察 vs 期望：观察到任何 URL 都无法渲染 `data-expired="true"` 的卡片、也无历史版本切换入口；期望过期卡片可见但禁用（视觉上先于点击暴露冲突）
- 契约：AC-070「版本显示、过期拒绝」；`experience.md` §3「面板可切换历史版本，历史审批只针对该版本」
- 修复方向：详情页解析 `?planVersion=`（及历史版本选择）并把它作为 `planCard.requestedVersion`，从而真正渲染 `data-expired="true"` + 禁用原因；同时保留点击后的 `VERSION_CONFLICT` 刷新路径

### W9R1-03（P2）跨 Project 订阅/命令的 `error.details` 回显本机 Project id

- 位置：`apps/daemon/src/protocol.ts:509-518`（`dispatch` 跨 Project 分支 `details: { projectId, openProjectId }`）、`apps/daemon/src/protocol.ts:2207-2212`（`subscribe` 同型）
- 复现：`probe1 W9R1-A7` → `cross-project subscribe → NOT_FOUND; result=undefined; events=0; localIdEchoedInDetails=true`，`details={"projectId":"018f…f9","openProjectId":"24d5eabc899be397633e2182ba53ce8e"}`
- 观察 vs 期望：观察到跨 Project 请求虽然不泄漏任何数据/快照/订阅 id/事件，但把本机 open Project id 回显给调用方；期望 `NOT_FOUND` 不携带另一 Project 的标识
- 契约：`protocol.md` §1「跨 Project ID 统一返回 NOT_FOUND」
- 修复方向：跨 Project 分支的 `details` 只保留请求方自己的 `projectId`（或置空），不回显 `openProjectId`
- 附注：T4 记录 §4.5 已诚实登记该项，但其断言 `message` 不含本机 id（`workbench-failures.integration.test.ts:1042`）未覆盖 `details`，故测试全绿并不能证明该不变量

### W9R1-04（P2）写命令的幂等账本只覆盖 2/6 个 UI 可发命令

- 位置：`apps/daemon/src/protocol.ts:520-535`（仅校验 key 长度）与各分支；实际入账本仅 `sendMessageCommand`（`1248-1262`）与 `saveRequirement`（经 `RequirementSaveService` operation）；`work.control`/`plan.approve`/`decision.resolve`/`config.save`/`backup.run`/`restore.run` 不记录、不重放
- 复现：`probe1 W9R1-A3`：同一 `idempotencyKey` 重复 `work.control pause` → 两次都返回 `INVALID_STATE`（非「同载荷返回原结果」）；BFF 上重复 `plan.approve` 亦非重放
- 观察 vs 期望：观察到丢响应后重发同一键不会拿到原始结果；期望每个带 `*` 的方法遵循 §1 幂等规则（同键同载荷返回原结果、同键异载荷拒绝）
- 契约：`protocol.md` §1「每个 * 遵循上述授权/版本/幂等规则」「幂等键同载荷返回原结果；同键不同载荷拒绝」
- 修复方向：把 `store.commands.begin/complete` 账本提升为协议层通用包装（按方法+主体+payloadHash），或明确登记为「由服务自身状态守卫、不承诺重放」的偏差并由 Test 记录
- 影响边界：AC-054 的「丢失写响应按同一幂等键重放」在 `packages/client` 侧已实现（`W9R1-A2` 通过），daemon 侧的账本缺口只在丢响应场景暴露

### W9R1-05（P2）Queued 无 Work 的取消在真实 Git 上恒失败（AC-068 该项未达成）

- 位置：`apps/daemon/src/protocol.ts:1440-1519`（`cancelRequirement` 生成的 `contentMarkdown` 仅 `# 标题 + 目标`）；`packages/core` 需求记录结构校验要求六段二级标题
- 复现：`probe3 W9R1-C9`（真实 Git + 真实 `RequirementSaveService`）→ `VALIDATION_ERROR: content.md 结构不符合需求池规范（六个二级标题各一次）`，lifecycle 仍 `queued`、branch 前后同 revision
- 观察 vs 期望：观察到「诚实拒绝、分支不动」；期望 Queued 无 Work 可直接取消（AC-068 明文）并写出 Git 记录
- 契约：AC-068「Queued无Work也能直接取消」；`protocol.md` §4「Queued取消保存Git后cancelled」
- 修复方向：由 Core 用合同一的需求正文模板（六段）构造取消记录，或让取消走 `RequirementSaveService` 的 canonical 生成路径；当前实现对「取消」这一产品动作不可用
- 附注：T4 用例对该步骤写成 `if (cancel.frame.ok) … else …` 双分支，两条路径都断言「不变」，因此**测试全绿不代表该行为成立**；记录 §4.3 已登记

### W9R1-06（P2）契约命令 `pnpm test:unit` 在冻结点上不确定（同一代码树时红时绿）

- 复现：默认并发 `pnpm test:unit` → `2 failed | 1094 passed`，失败均为 `Test timed out in 5000ms`；隔离只跑这两文件（`--maxWorkers` 默认）→ 仍 2 例超时，且失败集合发生漂移（`initialize` 的 W4R2-01 与 `wp08-failures` 的 AC-064 → `wp08-failures` 的 AC-062 两例）；`--maxWorkers=4` → `54/54 文件、1096/1096 用例` 全绿
- 观察 vs 期望：观察到同一 commit 的契约命令结果依赖并发/负载；期望退出码稳定
- 契约：`docs/delivery/implementation.md` 的命令契约；`implementation.md` §T5 声称 1096 全绿
- 修复方向：给 unit 项目里真实 Git 的用例显式 `testTimeout`（`vitest.config.ts` unit 项目当前未设），或把这些 `createRepo()` 用例移入 integration 项目；并把 `--maxWorkers` 口径写进契约命令
- 附注：不构成本片代码回归（失败文件均属 WP-04/08 域），但会让 Test 阶段的契约命令不可复现

### W9R1-07（P2）Chief 渲染的对话创建/切换控件无任何实现（死控件）

- 位置：`apps/web/src/shell.ts:231-232`（`#newConversation`/`#switchConversation`）、`apps/web/src/pages.ts:186-188`（`#conversationSelect`/`#newConversationInline`）；`apps/web/public/app.js` 无对应监听；`apps/daemon/src/protocol.ts` 无 `conversation.create`
- 复现：`probe2 W9R1-B14`；`grep -c "conversation.create" apps/daemon/src/protocol.ts` → 0；`app.js` 中 `newConversation*` 命中 0
- 观察 vs 期望：观察到按钮/下拉可聚焦、可点击但无效果；期望要么可用、要么不渲染（`experience.md` §1「Conversation创建/切换控件仅位于Chief」是可用能力，不只是位置约束）
- 契约：AC-072；`experience.md` §1
- 修复方向：daemon 补 `conversation.create`（+ 切换导航），或按 T3 §5.1 的计划在无实现前不渲染这些控件

### W9R1-08（P2）BFF `/ws` 桥丢弃浏览器信封的 `idempotencyKey`/`expectedVersion`

- 位置：`apps/web/src/daemon.ts:463-470`（`accept()` 重建帧时只带 `v/type/id/method/projectId/params`）- 复现：代码静态可证（浏览器若经 `/ws` 发写命令，daemon 会以缺少 `idempotencyKey`/`expectedVersion` 处理）
- 观察 vs 期望：当前 UI 的写命令全走 HTTP `/rpc`（`app.js:141-191`），因此**未在现场触发**；期望桥对写命令保持信封语义一致
- 契约：`protocol.md` §1/§2（WS 与 HTTP 同属协议面）
- 修复方向：桥转发时透传 `idempotencyKey`/`expectedVersion`，或明确只允许只读方法经 `/ws`

### W9R1-09（P3）BFF 不校验浏览器 CSRF 头（设计偏差，未记录）

- 位置：`apps/web/src/app.ts:382-416`（写请求只校验精确 Origin，再用 **BFF 自己持有的** daemon `csrfToken` 复验）
- 复现：`probe1 W9R1-A9`：带会话 cookie、无 `x-csrf-token` 的写请求 → `200`；`probe3 W9R1-C1`：daemon 直连同请求 → `403`
- 观察 vs 期望：观察到 BFF 的写法在结构上免疫 CSRF（不信任任何客户端提供的状态），但未满足 `protocol.md` §2「CSRF token用于同源写请求」的字面要求
- 契约：`protocol.md` §2；AC-078
- 修复方向：或转发并校验浏览器 `x-csrf-token`，或把「BFF 以自有会话复验，浏览器 CSRF 头非必需」登记为协议注记，避免后续 Test 误判

### W9R1-10（P3）浏览器侧重连为固定 2s 无限循环，与 client 包的有界退避不一致

- 位置：`apps/web/public/app.js:415-421`（`window.setTimeout(openSocket, 2000)`，无 attempt/上限）；对照 `packages/client/src/connection.ts:85-89`（1s/2s/4s…30s 有界）
- 复现：源码静态可证；`workbench-failures` 的「断连」用例只断言 `setTimeout(openSocket, \d+)` 与 `afterCursor` 字符串
- 契约：AC-078「受限重试」；`experience.md` §7
- 修复方向：浏览器侧复用同一退避策略并设上限；把该用例改为断言真实退避序列

### W9R1-11（P3）「断连」必需失败测试未验证 BFF 桥的自动重连

- 位置：`apps/web/test/workbench-failures.integration.test.ts:859-904`
- 复现：用例在 `harness.protocol.closeAll(1001, …)` 后，用**新建**的 `BrowserSocket` + `afterCursor` 验证补齐，而不是观察桥自身 `BridgeConnection.onDaemonClose → reattach()` 的行为（该实现存在，`apps/web/src/daemon.ts:540-569`）
- 观察 vs 期望：观察到「浏览器重连补水位」被覆盖，「BFF→daemon 自动重连并按订阅水位重放」未被覆盖
- 契约：AC-054；`implementation.md` WP-09「断连」必需失败测试
- 修复方向：在同一 socket 上等待 `bridge.open`/`bridge.reconnecting` 并断言桥自动重放后的水位

### W9R1-12（P3）Plan 卡「当前版本」取 Plan 产物版本上限，未按有效性过滤

- 位置：`apps/web/src/app.ts:856-867`（`currentVersion = max(assessment.planRef.version, 最新 plan 产物 artifactVersion)`）
- 复现：代码静态可证；`probe2 W9R1-B7` 中 `currentVersion` 恰等于 gate 活版本（未构造失效产物）
- 观察 vs 期望：观察到若存在失效（`validity=invalid`）或历史版本更高的 plan 产物，卡片会把过期版本当成最新，从而错误地允许批准
- 契约：AC-070；`experience.md` §3「有效/失效」与「历史审批只针对该版本」
- 修复方向：只以 gate 的当前批准记录为权威（首选），或只统计 `validity=valid` 且属于该 Work 的当前链产物

## 7. 记录核对（T1/T3/T4 与代码是否一致）

| 记录声明 | 核对 |
|---|---|
| T1：ClientError/退避/同键重放/水位去重/本地越权拒绝 | **一致**（`W9R1-A1/A2/A11`） |
| T1：`subscribe()` 在未 open 时抛 `TRANSPORT_CLOSED`（不排队） | **一致**（源码 `subscriptions.ts:577-579`） |
| T3 §3 AC-070「详情页显示 Plan 当前/请求版本；过期时禁用批准」 | **过度陈述**：请求版本恒等于当前版本，过期卡片不可达（`W9R1-02`），批准动作不可用（`W9R1-01`） |
| T3 §3 AC-072「仅 Chief 渲染新建/切换对话控件」 | **部分一致**：位置正确，但控件无实现（`W9R1-07`） |
| T3 §3 AC-068「Queued 无 Work 卡片给出直接取消」 | **未达成**：真实 Git 上恒 `VALIDATION_ERROR`（`W9R1-05`），记录 §5.4 已诚实登记为 `INVALID_STATE`（实际码为 `VALIDATION_ERROR`，措辞略有出入） |
| T4 §3 六个必需失败测试逐字命名 | **一致**（7 例，命名齐全） |
| T4 §3「过期 Plan 版本冲突（含 currentVersion）」 | **协议层一致**（`W9R1-B8`）；但该用例不构成「过期卡片」的 UI 证据（`W9R1-02`） |
| T4 §3「Queued 取消的真实拒绝与分支不动」 | **一致**；用例的双分支写法使其无法失败（`W9R1-05` 附注） |
| T4 §4.1–4.7 七项 T2/Core 残余 | **基本诚实**，其中 §4.5（`openProjectId` 泄漏）复现成立（`W9R1-03`）、§4.3（取消正文不合规）复现成立（`W9R1-05`）、§4.1（`conversation.create` 缺失）复现成立（`W9R1-07`）；但 §4.5 的测试断言未覆盖 `details`，§4.1 未同时登记「控件已渲染但无实现」 |
| T4 §2.3「浏览器侧 DOM 行为以渲染 + 出厂脚本双重证据」 | **一致**，且已在 §4.4 登记为覆盖限制（无无头 DOM） |
| `implementation.md` §T5 残余 5「`apps/web` 需在接线时声明 `@agentdev/client` 依赖；root `eslint.config.js` 增加浏览器 globals 块」 | **已过时**：`apps/web/package.json:22` 已声明 `"@agentdev/client": "workspace:*"` 且 `apps/web/src/daemon.ts:19-29` 直接 import；`eslint.config.js:22-23,74-78` 已有 `browserGlobals` 块。两条均已在冻结点前完成，残余清单宜在结算时清除，否则会误导后续 Test |

`docs/INDEX.md` 第 44 行仍声明「协议接线（daemon/BFF/WS）…仍未实现」，与本片已交付 `/rpc`、`/ws`、BFF 九面不符（属于尚未结算的文档漂移；WP-09 尚未 Settlement，可接受但需在结算时更新）。

## 8. 覆盖限制（Coverage Limits）

1. **无无头浏览器/真实浏览器执行**：AC-071/073 的焦点顺序、回焦、ARIA 可访问性、语言切换只以「真实 SSR 标记 + 出厂 `app.js` 源码事实」为证据；像素级与实机键盘遍历留 WP-10。
2. **无真实模型/Provider**：全部路由结论来自确定性 Assessment 路由与配置解析，未调用真实 LLM；`run.ended` 统一渲染为成功的负例未在浏览器实跑。
3. **无 `pnpm test:e2e` / `test:acceptance` / `test:live`**：三者按契约返回 `NOT_IMPLEMENTED`。
4. **AC-088** 未新增独立探针（承接 WP-04 的导入演练 + T4 的 completed/archived/cancelled 渲染断言）。
5. **AC-054 的「BFF 进程被杀」**：探针覆盖 WS/HTTP 断连、会话过期与后台 Work 保留，未真正 kill BFF 进程做端到端恢复（BFF 重启需重新登录，属设计）。
6. **集成命令**在宿主负载下需 `--maxWorkers=4` 才稳定；默认并发下 unit 项目存在既有的 5s 超时抖动（`W9R1-06`），本报告已给出两种口径的原始结果。
7. 探针仅消费 dist 产物；源码级结论（`W9R1-08`、`W9R1-12`）来自静态阅读，未构造运行时反例。

## 9. 能否进入独立 Test

**不能。** 存在两项可复现 P1：工作台无法批准任何有效 Plan（`W9R1-01`），且详情页无法呈现过期/历史 Plan 卡片（`W9R1-02`）。二者共同使 AC-070 的「打开/批准」在 UI 上不可达，必须先回 Develop 修复并重新独立 Review。

建议的阻断项修复顺序：`W9R1-01` → `W9R1-02`（同一链路，一并修）→ `W9R1-05`（AC-068 明文行为）→ `W9R1-03`（安全细节）。P2/P3 可带病进入 Test，但应在 Test 报告中显式记录，避免把「测试全绿」当作这些行为已成立。

---

# WP-09（完整 Web 工作台）独立 Review 报告 · 第 2 轮

- 角色：INDEPENDENT REVIEW（独立上下文；**未读取任何开发/Test 聊天或会话**）
- 工作包：WP-09 完整 Web 工作台
- 冻结点：`ce2fc80`（`fix(client,daemon,web): close WP-09 review round-1 findings`）；第 1 轮冻结点 `9f107ac`
- 输入：本文件第 1 轮报告（原文保留于上）、`implementation.md` §T5（W9R1-01..12 逐项修复记录）、冻结 Diff `9f107ac..ce2fc80`
- 证据目录：`/tmp/wp09r2/`（Reviewer 自建探针，消费 **已构建** 产物；真实 loopback HTTP/WS + 真实 SQLite + 真实 Git 工作树 + 真实 BFF）
- 唯一写入：本文件（追加；第 1 轮内容逐字保留）

## R2.1 冻结与哈希

| 项 | 值 |
|---|---|
| `git rev-parse HEAD` | `ce2fc80b1f30abc5e4f99a598e416138564c8f7a` |
| `git rev-parse ce2fc80^{tree}` | `d5cf9707d9fd0987c83ba7d9a703b69d25de16ba` |
| `git status --porcelain` | 空（工作区干净；本报告写入后仅本文件 `M`） |

受审文件（`git rev-parse HEAD:<path>`）：

| 文件 | blob |
|---|---|
| `apps/daemon/src/protocol.ts` | `95ce03f889ab04ae9edd6292a466c2dae9e524f9` |
| `apps/web/src/app.ts` | `48752acc02d11a84559862244be6822f4b02acf0` |
| `apps/web/src/daemon.ts` | `b6860cf096b11c113ad8bf578222073fcde9061d` |
| `apps/web/public/app.js` | `41016ca2bbe772c81b21d224e5a40e6294af7a5c` |
| `apps/web/src/pages.ts` | `7f829571150f74d9507602279b21ed554c111443` |
| `apps/web/src/views.ts` | `a58196665080d02201c322efda1767ea5883d950` |
| `packages/core/src/requirement-save.ts` | `72549ff10c7a123c9ef2e33b16b126ee329d5a15` |
| `packages/core/test/broker.test.ts` | `702b4b948aa98b9f09305a85cb4f1e4edf3aee75` |

受审 Diff 规模：18 文件，+2247/−347；`packages/client/src/**` 未改动（与 T5 声明一致）。

## R2.2 结论

**PASS** —— 未复现任何 P0/P1。第 1 轮 12 项中 11 项完全关闭；`W9R1-04` 对其具名的六条命令关闭，仅 `requirement.save` 的**创建**分支仍不满足幂等契约（`W9R2-01`）；`W9R1-06` 的超时根因已消除，但契约命令在宿主上仍偶发失败（`W9R2-04`）。新增 4×P2 + 2×P3，均不阻断。**可以进入独立 Test**。

### 计数与阻断

| 严重度 | 第 1 轮 | 本轮新增 | 是否阻断 |
|---|---|---|---|
| P0 | 0 | 0 | — |
| P1 | 2（均已关闭） | 0 | — |
| P2 | 6（5 关闭 / 1 根因关闭但未稳定） | 4 | 不阻断，已登记 |
| P3 | 4（全部关闭） | 2 | 不阻断，已登记 |

## R2.3 契约命令原始结果

全部在仓库根、`export PATH="$HOME/.local/bin:$PATH"` 下执行；日志保存在 `/tmp/wp09r2/logs/`（`contracts.log`、`unit-rerun.log`、`unit-load.log`、`integration.log`、`targeted.log`）。

| 命令 | 退出码 | 原始结果 |
|---|---|---|
| `pnpm typecheck` | 0 | `tsc -p tsconfig.json --pretty false`，无输出 |
| `pnpm lint` | 0 | `node scripts/lint.mjs`，ESLint + Prettier check 通过 |
| `pnpm test:unit`（默认 workers，**6 次**） | **1 / 0 / 0 / 0 / 0 / 0** | 第 1 次 `Test Files 1 failed | 54 passed (55)`、`Tests 1 failed | 1101 passed (1102)`，失败为 `packages/core/test/broker.test.ts > … skips a port the OS has already taken … (W7R1-05)` 的 `expect(created.ok).toBe(true)`（第 1201 行）**非超时**；其余 5 次（含 6 个 CPU 满载进程下的 1 次）均 `55 文件 / 1102 用例` 全绿。6 次运行**零次 5s 超时** |
| `pnpm test:integration --maxWorkers=4` | 0 | `Test Files 25 passed (25)`、`Tests 304 passed (304)`，`Duration 94.90s` |
| 定向集成复跑（4 文件、`--maxWorkers=1 --reporter=verbose`） | 0 | `Test Files 4 passed (4)`、`Tests 53 passed (53)`；含六个必需失败测试与全部新增 W9R1 回归用例 |
| `pnpm docs:check` | 0 | `docs:check ok — 15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages` |
| `pnpm build` | 0 | `pnpm -r build` 全 12 个 workspace `Done` |
| `pnpm test:e2e`（参考） | 1（`[ELIFECYCLE]`） | `NOT_IMPLEMENTED: command test:e2e is not implemented yet; it lands with WP-09` |

> 数字核对：`implementation.md` §T5 声称 `test:unit 55 文件 / 1102 用例`、`test:integration 25 文件 / 304 用例`、`build 12 workspace` —— 均与实测一致；但**契约命令 `pnpm test:unit` 在默认 workers 下仍非稳定绿**（1/5 次失败，见 `W9R2-04`）。

## R2.4 方法与用例数

全部探针由 Reviewer 独立编写，只消费 **dist 构建产物**（`createDaemon` 真实服务器 + 真实 BFF + 真实 `PlanGateService`/`RequirementSaveService` + 真实 SQLite/Git），不 import 任何产品测试文件。全部临时根目录使用 `realpathSync`（macOS `/tmp` 符号链接会让 Git 端口误判交付工作树为脏，首版探针已据此纠正，见 R2.10-8）。

| 脚本（`/tmp/wp09r2/`） | 覆盖 | 用例数 | 结果 |
|---|---|---|---|
| `probeA.mjs` | W9R1-01/02/12：`plan.current` 回读、UI 同款载荷批准、重放、过期卡片、无 Plan 禁用诚实性、stale gate、失效产物陷阱 | 11 | 11 PASS |
| `probeB.mjs` | W9R1-03 跨 Project（HTTP + 真实 `/ws`）；W9R1-04 幂等（project.open / conversation.create / work.control / decision.resolve / finding.submit / config.save / config.test / conversation.message.send / requirement.continue） | 15 | 15 PASS |
| `probeC.mjs` | W9R1-05 真实 Git 取消（AC-068）+ AC-087/090/093；requirement.save 幂等；backup.run/restore.run 非事务账本 | 8 | 5 PASS / **3 FAIL** |
| `probeD.mjs` | W9R1-07 九面死控件扫描 + Chief 对话链；W9R1-08 `/ws` 桥信封透传；W9R1-09 CSRF 偏差登记与行为 | 8 | 8 PASS |
| `probeE.mjs` | W9R1-10 出厂脚本重连梯度（从 BFF 真实 `/assets/app.js` 求值）；W9R1-11 桥在同一 socket 自动重连并按水位补齐 | 3 | 3 PASS |
| `probeF.mjs` | `requirement.update` 省略字段的保真度 | 1 | **1 FAIL** |
| `probeF2.mjs` | `requirement.save` 同键异载荷的干净单发证据 | 1 | 观察成立（200 + 第二次创建） |
| `diag-i18n.mjs` | 中文界面下禁用原因是否本地化 | 1 | **1 FAIL** |
| `diag-save.mjs` / `diag-bridge.mjs` | 工作树状态与水位取证的诊断脚本（不计判定） | — | — |

合计 **47 个带判定用例，5 失败**（失败项即 `W9R2-01/02/03/05` 的证据）。

关键排除性证据（防止把探针缺陷当成产品缺陷）：

- `diag-save`：`content.md` 提交字节与我方输入不等，是 Core 规范化时前置 `<!-- record-version: N -->` 版本标记所致（`requirement-save.ts:466`），**不是**内容被改写；`probeC C1` 已改为断言正文子串。
- `probeE E2b` 首版误报“水位下重复 1 条”，实为 Reviewer 的 `waitFor` 不消费缓冲、`drain()` 把断连前的 E1 帧一并计入；加一次断连前 `drain()` 后为 0 重复，**不是**产品缺陷。
- `probeC`（v1）在 `requirement.save` 二次调用后出现 `RECOVERY_REQUIRED: 交付工作树有 1 个未提交的本地修改 .agentdev/requirements/README.md`，其触发前提正是 `W9R2-01` 的重复创建路径；单独一次「创建 → 取消」不再出现该状态（见 `probeC C2`）。交付工作树在保存后残留 `D .agentdev/...`/`?? .agentdev/` 属 WP-08 既有行为（本轮 `packages/*/src` 未改），已登记于 R2.10-8。

## R2.5 逐项关闭核验（W9R1-01..12）

| 编号 | 第 1 轮 | 本轮结论 | 证据 |
|---|---|---|---|
| W9R1-01 | P1 批准不可达 | **关闭** | `probeA A1-A4/A9-A10`：`plan.current` 从真实 gate 读回 Plan 正文 + `authorizationId` + planning `runId`（`approval.enabled=true`）；以页面同款载荷（`plan.current` 的正文 + 真实授权 + `data-plan-version`）批准 → `200 applied, version 1→2`；同键同载荷重放逐字节一致；无 Plan 的 Work → `approval.enabled=false` + 非空 reason + 页面 `data-approvable="false"`/`disabled`/`#approveBlocked`，强制提交被 `422` 诚实拒绝。禁用**不再发出必然失败的请求**（`app.js` 点击先取 gate，`current!==true||enabled!==true` 时不提交） |
| W9R1-02 | P1 过期卡片不可达 | **关闭** | `probeA A5-A7`：`?planVersion=1`（当前 2）→ `data-requested-version="1"`、`data-current-version="2"`、`data-expired="true"`、`data-approvable="false"`、`#planExpired`、批准控件 `disabled`；同页不带参数 → `data-expired="false"`、可批准（当前版本保持有效）；强制批准旧版本 → `409 VERSION_CONFLICT` 且带 `currentVersion` |
| W9R1-03 | P2 跨 Project 回显本机 id | **关闭** | `probeB B1-B2`：HTTP 与真实 `/ws` 两条路径的 `NOT_FOUND` `details` 键集合均为 `{projectId}`（仅调用方自己的 id），响应全文不含本机 Project id，且 `/ws` 分支零事件帧 |
| W9R1-04 | P2 幂等账本仅覆盖 2/6 | **对具名六命令关闭；整体声明不成立** | 关闭证据：`probeB B3-B13`（project.open / conversation.create / work.control / decision.resolve / finding.submit / config.save / config.test / conversation.message.send / requirement.continue 的「重放一致 + `IDEMPOTENCY_CONFLICT`」）、`probeC C6-C8`（backup.run / restore.run 非事务账本重放一致、异载荷冲突、被拒不占键）、`probeA A4`（plan.approve）；`probeB B11`（被拒效果不占键，修好载荷后同键可重试）。残留：`requirement.save` 创建分支 → **W9R2-01**；`requirement.save.retry` 按协议 §8 走「新请求键指向原操作」，不属通用账本（未新增探针，登记为限制） |
| W9R1-05 | P2 Queued 取消恒失败 | **关闭** | `probeC C2`（真实 `RequirementSaveService` + 真实 Git）：`work.control cancel` → `200`、`lifecycle=cancelled`、投影同步、分支 `9c27bb2a→398f9d75` 且 `head===cancelCommit`、`requirement.json.lifecycle=cancelled` + `cancellation.reason="产品决定不再需要"`、`content.md` 六个二级标题各恰好一次。`probeC C1` 同时复核 AC-087/090/093 保存链；看板 `data-action="cancel"` 的 UI 监听存在并调用同一命令（`app.js:677-704`） |
| W9R1-06 | P2 `test:unit` 不确定 | **根因关闭、契约命令未证明稳定** | 6 次默认 workers 运行**零超时**：`wp08-failures`/`initialize` 的 `describe` 超时确为 30s（`git show` 核对：`it` 标题 20/20 与 6/6 完全一致，`expect(` 计数 206/206、124/124 未减少，仅缩进重排）；但第 1 次仍失败于 `packages/core/test/broker.test.ts:1201`（端口竞态，非超时）→ **W9R2-04** |
| W9R1-07 | P2 Chief 死控件 | **关闭** | `probeD D1-D4`：九面渲染的 `button/select/input`（表单内原生提交项已排除）在出厂 `app.js` 中全部有引用，`docsQuery/filesQuery` 为 GET 搜索框（误报已排除，非死件）；`#newConversation`/`#newConversationInline`/`#conversationSelect`/`#switchConversation` 均有真实监听；`conversation.create` 建真实行 + 发 `conversation.created` 事件、`?conversationId=` 可读回、未知 `focusWorkId` → `404 NOT_FOUND`。附注：`#switchConversation` 是展开下拉并把焦点交给 `#conversationSelect` 的 disclosure 控件，「执行真实切换」由 select 的 `change` 跳转承担，T5 措辞略强于实现 |
| W9R1-08 | P2 `/ws` 桥丢信封字段 | **关闭** | `probeD D5-D6`：经 BFF `/ws` 发 `config.save` 带 `expectedVersion=5` → `409 VERSION_CONFLICT`（桥若丢字段则必然 `applied`）；同键同载荷重放一致、同键异载荷 `IDEMPOTENCY_CONFLICT`；产品测试另以 `work.control resume expectedVersion=999` + `store.commands.lookup('installation:local', …)` 复核（已复跑通过） |
| W9R1-09 | P3 CSRF 偏差未登记 | **关闭** | `docs/architecture/protocol.md` §2 新增登记段（诚实说明不转发/不校验浏览器头、BFF 以 HttpOnly 会话 + 精确 Origin 认证、再以自身 `csrfToken` 调 daemon）；`probeD D7-D8`：BFF 无头 `200`、伪造头 `200`（不被信任）、外来 Origin 即带真 token 仍 `403`、daemon 直连无 CSRF `403`；`server.integration.test.ts` 对应用例存在并通过 |
| W9R1-10 | P3 固定 2s 无限重连 | **关闭** | `probeE E1-E2`（从 BFF 真实 `/assets/app.js` 求值出厂函数）：策略 `{1000,30000,6}`，梯度 `[1000,1000,2000,4000,8000,16000,30000,30000]`；出厂脚本无 `setTimeout(openSocket, 2000)`，有 attempt 计数、成功后归零与耗尽 `closed` 分支 |
| W9R1-11 | P3 断连用例未验桥重连 | **关闭** | `probeE E2b`（独立探针）：强制 `closeAll(1001)` 后，**同一浏览器 socket** 收到 `bridge.reconnecting{attempt:1}` → `bridge.open{resumed:1}` → 断连期间的 E2/E3 事件按序补齐，且水位以下 E1 **零重复**；产品「断连」用例已改写为同一判据并复跑通过 |
| W9R1-12 | P3 版本取自产物上限 | **关闭** | `probeA A8`：插入 `kind=plan, artifact_version=99, validity=invalid` 的产物后，页面 `data-current-version` 仍等于 gate 活版本、`data-expired="false"`、可批准；`probeA A11`：`gateStatus=stale` → `expired=true`、`approvable=false`、控件禁用 |

## R2.6 逐 AC 结果（本轮切片）

| AC | 结论 | 证据 |
|---|---|---|
| AC-054 UI 断开 | **通过** | `probeE E2b`（桥自动重连 + 水位零重复）；真实 RFC6455 客户端 6 例（`wire.integration.test.ts`）复跑通过 |
| AC-068 看板身份/取消 | **通过** | `probeC C2`（真实 Git 取消）；产品集成用例「cancels a Queued requirement…(AC-068)」「keeps an L1 Work off the board」复跑通过；暂停 Queued 的 `INVALID_STATE` 渲染未改 |
| AC-069 持续对话 | **通过** | 「持续对话」必需失败测试复跑通过；`probeD D3`（真实会话行 + 事件） |
| AC-070 产物版本与批准 | **通过（第 1 轮 P1 已消除）** | `probeA A1-A11` |
| AC-071 Live 布局 | **通过** | 本轮未新增独立探针；「窄屏焦点」必需失败测试复跑通过，相关代码未改动 |
| AC-072 Conversation 归属 | **通过** | `probeD D1-D4`；「Chief: renders only conversation controls that a real method backs」复跑通过 |
| AC-073 语言可访问 | **部分通过（P3）** | `diag-i18n`：`<html lang="zh-CN">` 页面上 `#approveBlocked` 仍输出 daemon 的英文句子 → `W9R2-05`；项目内容不翻译与 ARIA/键盘路径未改 |
| AC-074 Inbox 去重 | **通过** | 「过期卡片」「配置失败」与 daemon 用例复跑通过 |
| AC-075 配置错误 | **通过** | `probeB B8/B11/B12/B13`、`probeD D5/D6/D8` |
| AC-076 附件限制 | **通过** | 本轮未新增独立探针；相关代码未改动，集成复跑绿 |
| AC-077 文件只读 | **通过** | 同上 |
| AC-078 认证生命周期 | **通过** | `probeD D5-D8`、`probeE E1-E2`、`probeB B1-B2` |
| AC-084 首条消息附件 | **通过** | 同上（未改动代码路径，集成复跑绿） |
| AC-087 需求池随 Git 迁移 | **通过** | `probeC C1` |
| AC-088 历史需求展示 | **通过（承接 WP-04）** | 未新增独立探针；daemon「keeps an imported requirement identity…(AC-087/088/089)」复跑通过 |
| AC-089 进行中需求继续 | **通过** | `probeB B10/B10b`（继续建 Work 且重放不重复建）；产品用例复跑通过 |
| AC-090 需求保存时机 | **通过** | `probeC C1`（Git 与投影一致后才上板）；`probeC C2` 的取消提交同样先 Git 后投影 |
| AC-093 目录与正文一致性 | **通过** | `probeC C1/C2`；正文头六标题计数 `[1,1,1,1,1,1]` |

### 六个必需失败测试（复跑逐字命名）

`apps/web/test/workbench-failures.integration.test.ts`：**持续对话**、**过期卡片**、**窄屏焦点**、**断连**、**配置失败**、**订阅扩大**（两例）。定向 verbose 复跑 53/53 全绿（含新增的 `Chief: renders only conversation controls…`、`forwards idempotencyKey and expectedVersion over the /ws bridge`）。

## R2.7 发现（本轮）

### W9R2-01（P2）`requirement.save` 创建分支不遵守幂等键：同键同载荷重复建需求，同键异载荷被接受

- 位置：`apps/daemon/src/protocol.ts:1810`（`const id = existing?.id ?? this.services.store.newId();` — 每次调用都先生成新 id），`apps/daemon/src/protocol.ts:219-227`（`LEDGER_WRAPPED_METHODS` 有意排除 `requirement.save`，注释称其“effects already run inside their own transaction together with a dedicated ledger entry”）
- 复现：`probeC C4`（真实 Git + 真实 `RequirementSaveService` + 真实 BFF）：以 `idempotencyKey='rev2-save-idem'` 发同一 `requirement.save` 两次 → 第一次 `requirementId=01a09a4d-4b4c…`，第二次 `…-4d57…`，投影行数 `1 → 2`，两次返回结果不相等；`probeF2`：同键、**不同** payload → `200`，行数 `1 → 2`，**没有** `IDEMPOTENCY_CONFLICT`（`probeC C5` 在有中间重放时则是 `409 RECOVERY_REQUIRED`）
- 观察 vs 期望：观察到「同键同载荷再建一条需求、同键异载荷静默再建一条」；期望按 §1 同键同载荷返回原结果、同键异载荷拒绝
- 契约：`protocol.md` §1「幂等键同载荷返回原结果；同键不同载荷拒绝」「每个*遵循上述授权/版本/幂等规则」；§8；第 1 轮 `W9R1-04` 的关闭声明（`implementation.md` §T5：「无偏差遗留：所有 `*` 方法均入账本」）
- 修复方向：把 `requirement.save` 的**创建**分支纳入 `withCommandLedger`（与 `conversation.message.send` 一样在生成 id 之前按 `(subject, method, key, payloadHash)` 查账本），或让 daemon 在 `id` 生成前先按 `idempotencyKey` 解析已记录的 operation/ledger 结果；至少要在同键异载荷时返回 `IDEMPOTENCY_CONFLICT` 而不是新建
- 影响边界：本片 UI **不调用** `requirement.save`（`app.js` 无引用；仅协议面/CLI 可达），且 Git 提交不重复（`createdCommit:false`），故只造成投影重复行与响应不一致，不阻断

### W9R2-02（P2）`requirement.update` 省略字段被重置为空（scope/acceptance/openQuestions/featureIds/confirmedDecisions）

- 位置：`apps/daemon/src/protocol.ts:1814`（`const requestedScope = patch['scope'] ?? existing?.sourceRef ?? emptyScope();`）、`:1826`（`scope: isScope(requestedScope) ? requestedScope : emptyScope()`）、`:1830-1833`（`acceptance`/`openQuestions`/`confirmedDecisions`/`relatedRequirementIds` 一律 `stringArray/arrayField`，缺省即 `[]`）
- 复现：`probeF F2`（真实 Git）：`requirement.save` 创建时 `scope.readPaths=['src/orders.ts']` 且落盘；随后以同一 `requirementId` 发一次未带 `scope` 的更新（仅 `lifecycle:'archived'` + 新正文）→ `200 applied`，但新 commit 的 `requirement.json` 中 `scope={"readPaths":[],"writePaths":[],"operations":[],"networkTargets":[]}`
- 观察 vs 期望：观察到「调用方未命名的字段被清空」（`existing.sourceRef` 是 `{kind,id,version,path}`，不是 `Scope`，`isScope` 判假后回落到 `emptyScope()`）；期望未提供字段保持原值（`title`/`goal`/`lifecycle` 已按此实现，数组与 scope 未按此实现）
- 契约：`protocol.md` §8「requirement.create必须提供contentMarkdown；update可修改正文或元数据，**未提供字段保持原值**」；`requirements.md` §2（持久字段）；§3
- 修复方向：更新分支从 Git 现有记录读取元数据（`RequirementSaveService.saveUnderLock` 已加载 `previous`，可直接暴露给 daemon，或由 daemon 通过端口读当前记录）并仅覆盖 `patch` 明确给出的字段；`scope` 缺省时沿用已记录 scope
- 影响边界：本片 UI 无 `requirement.save` 调用；Git 历史保留旧版本，故为可恢复的静默字段丢失，不阻断

### W9R2-03（P2）W9R1-05 的取消实现重写正文并清空已记录字段

- 位置：`apps/daemon/src/protocol.ts:1688`（`scope: emptyScope()`）、`:1690-1694`（`featureIds/acceptance/openQuestions/confirmedDecisions/relatedRequirementIds` 全部硬编码为空数组）、`:1697`（`contentMarkdown: canonicalRequirementContent(...)`）、`:3508`（生成器对「范围与行为/验收说明/已确认决定/未决问题」一律写 `待明确`）
- 复现：`probeC C2 + C3`（真实 Git，创建时正文五段均有实际内容、`scope.readPaths=['src/orders.ts']`）：取消成功后读取消 commit 的 `content.md`，创建时写入的 5 段文字全部消失（被 `待明确` 取代），`requirement.json.scope` 变为空 envelope，`acceptance=[]`、`confirmedDecisions=[]`、`featureIds=[]`
- 观察 vs 期望：观察到「取消把已记录成果重置为占位文本」（结构合法、分支前进、原版本仍在 Git 历史）；期望取消只在既有记录上追加 `lifecycle:'cancelled'` 与 `cancellation`、并把原因写入「完成摘要」，其余正文与字段保持
- 契约：`experience.md` 第 51 行「取消保留部分成果及处置结果」；`requirements.md` §3「…归档、取消均在用户授权…立即提交对应需求文件」、§6
- 修复方向：取消先读回 Git 中现有 `requirement.json`/`content.md`，仅替换 `完成摘要`（写取消原因）并设置 `lifecycle`/`cancellation`，其余章节与字段原样保留；`scope` 不再硬编码 `emptyScope()`
- 影响边界：AC-068 的「可直接取消」已达成；本项是取消记录的内容保真度问题，不阻断

### W9R2-04（P2）契约命令 `pnpm test:unit` 在宿主上仍偶发失败（WP-07 端口探测竞态，非超时）

- 位置：`packages/core/test/broker.test.ts:1179-1201`（用例 `skips a port the OS has already taken and one a sibling manager holds (W7R1-05)`，断言在 `:1201` `expect(created.ok).toBe(true)`）
- 复现：连续 6 次 `pnpm test:unit`（默认 workers，同一冻结树）：第 1 次 `Test Files 1 failed | 54 passed (55)`、`Tests 1 failed | 1101 passed (1102)`，失败即上述断言（`packages/core/test/broker.test.ts:1201`，无 5s 超时）；随后 4 次空载 + 1 次 6 个 CPU 满载进程下运行均 `55/1102` 全绿。用例先 `listen(0)` 占一个临时端口 `P`，再要求 `portRange {min:P, max:P+1}` 并断言管理器能拿到 `P+1`；`P` 取自临时端口段，并发运行的其他用例/套接字可能同时占用 `P+1`
- 观察 vs 期望：观察到同一 commit 的契约命令退出码仍不稳定（失败模式已从「真实 Git 用例 5s 超时」变为「端口竞态」）；期望退出码稳定
- 契约：`docs/delivery/implementation.md` 命令契约；第 1 轮 `W9R1-06`
- 修复方向：让夹具确定化（显式绑定并持有 `P+1` 后再断言管理器改选下一端口；或在窗口内扫描一个真实空闲端口），或把该用例移出并行 unit 项目；`implementation.md` §T5 的「55 文件 / 1102 用例全通过」应标注为多次运行口径而非单次保证
- 附注：失败文件属 WP-07 域且本轮未改动；`wp08-failures`/`initialize` 的超时修复本身诚实有效（`it` 标题与 `expect(` 计数与修复前完全一致）

### W9R2-05（P3）禁用批准的原因未走 i18n 目录，中文界面出现英文句子

- 位置：`apps/web/src/pages.ts:348-369`（`blockReason = plan.approvalReason ?? (plan.expired ? t('detail.approveExpired') : t('detail.approveUnavailable'))` → `#approveBlocked` 直接渲染 daemon 的英文 reason）
- 复现：`diag-i18n`（真实 BFF，cookie `agentdev_language=zh`，Work 无已批准 Plan）→ `<html lang="zh-CN">`，`#approveBlocked` 文本 `the gate holds no approved Plan for this Work revision`；expired 分支同型（`detail.approveExpired` 已本地化，但同一 `#approveBlocked` 仍显示 daemon 英文 reason）
- 观察 vs 期望：观察到界面语言为中文时混入英文诊断；期望界面语言一致（`renderErrorPage` 的诊断 message 同型，可一并考虑）
- 契约：AC-073；`experience.md` §6「English/简体中文为界面语言」
- 修复方向：daemon 在 `approval` 中同时返回机器可判的原因码（如 `no_plan`/`stale`/`no_authorization`/`body_unreadable`），页面用 i18n 词条渲染；英文诊断可留在 `title`/诊断块

### W9R2-06（P3）「断连」必需失败测试含恒真断言

- 位置：`apps/web/test/workbench-failures.integration.test.ts:1023`（`expect(typeof notice.id === 'string' || true).toBe(true);`）
- 复现：静态可证——`x || true` 恒真，该断言任何情况下都通过
- 观察 vs 期望：观察到一条不可能失败的断言（该用例其余断言真实：`waitFor(bridge.reconnecting)` 本身是有效等待，后续 `bridge.open{resumed:1}`、水位零重复断言均真实）；期望断言与用例意图一致
- 契约：`implementation.md` WP-09「断连」必需失败测试；第 1 轮 `W9R1-11`
- 修复方向：改为断言该帧的真实字段（`notice.attempt` 为正整数）或删除该行

## R2.8 记录核对（`implementation.md` §T5 与代码/证据）

| T5 声明 | 核对 |
|---|---|
| W9R1-01 新增 `plan.current` 并移除必然失败路径 | **一致**（`probeA A1-A4/A9/A10`） |
| W9R1-02 解析 `?planVersion=` 并更正旧断言 | **一致**（`probeA A5-A7`；旧断言 `data-expired="false"` 已改为 `data-requested-version=live-1`/`data-expired="true"`/禁用，并新增当前版本对照） |
| W9R1-03 `details` 只保留调用方 id | **一致**（`probeB B1-B2`） |
| W9R1-04 「所有 `*` 方法均入账本」 | **过度陈述**：`requirement.save` 创建分支不在账本内且不回放（`W9R2-01`）；其余 13 个写方法中 12 个已实测回放，`requirement.save.retry` 按 §8 走独立语义（未探针） |
| W9R1-05 canonical 正文 + `scope` 回退 | **一致但引出保真度问题**：取消成功（`probeC C2`），但正文与字段被重置（`W9R2-03`） |
| W9R1-06 「直接以契约命令验证：55 文件 / 1102 用例全绿」 | **单次口径成立、稳定性不成立**（`W9R2-04`）；超时改动本身诚实（用例与断言计数未变） |
| W9R1-07 `conversation.create` + 四控件监听 | **一致**（`probeD D1-D4`）；`#switchConversation` 实为 disclosure 控件，措辞略强 |
| W9R1-08 桥透传两字段 | **一致**（`probeD D5-D6`） |
| W9R1-09 偏差登记 + 测试 | **一致**（`probeD D7-D8`，`protocol.md` §2 登记准确） |
| W9R1-10 有界退避 `reconnectPolicy` | **一致**（`probeE E1-E2`，从 BFF 真实资产求值） |
| W9R1-11 「断连」改同一 socket + `browserCursor` | **一致**（`probeE E2b`；`daemon.ts:511-525` 的 `browserCursor` 进入 resume 基准确为水位语义的正确修正） |
| W9R1-12 只取 gate 版本 | **一致**（`probeA A8/A11`） |
| 「§T5 残余 5 已过时，现予清除」 | **一致**：`apps/web/package.json:22` 已声明 `@agentdev/client`、`apps/web/src/daemon.ts:29` 直接 import、`eslint.config.js:22-23/78` 有浏览器 globals |
| W9R1-11 复现步骤「等 `bridge.open`/`bridge.reconnecting`」 | **一致**（`daemon.ts:560/582` 的帧名与实测一致） |

其它文档漂移：`docs/INDEX.md` 第 44 行仍写「协议接线（daemon/BFF/WS）…仍未实现」，与本片已交付 `/rpc`、`/ws`、BFF 九面不符；WP-09 尚未 Settlement，**可在结算时更新**，不阻断。

## R2.9 安全与横向检查（正向结论）

- **BFF 读写分类无漏洞**：脚本比对 `apps/web/src/app.ts` 的 `READ_ONLY`（28 项）与 `apps/daemon/src/protocol.ts` 的 `WRITE_METHODS`（14 项），**没有任何写方法被标为只读**，也没有只读方法遗漏（`projects`/`artifact.download.prepare` 未列入只读只会使 BFF 更严格）。
- **跨 Project 不泄漏**：HTTP 与 `/ws` 两条拒绝路径的 `details`、`message`、事件帧均不含本机 Project id（`probeB B1-B2`）。
- **`plan.current` 授权边界**：`authorization.workId !== workId` 时 `approval.enabled=false`；`!requested`（历史版本）时不下发正文（`protocol.ts:1946-2017` 的 `currentPlan` 早返回分支，`probeA A5` 观察到 `plan=null`）。
- **`plan.approve` 保持 gate 权威**：过期版本 `409 VERSION_CONFLICT` + `currentVersion`；stale gate 仍被 gate 拒绝（`probeA A7/A11`）。
- **ledger 主体**：BFF 以安装 Bearer 转发，daemon 解析为固定 `installation:local`/`chief`（`protocol.ts:390-395`）——单用户安装下所有浏览器会话共享主体，属既定设计，非缺陷。

## R2.10 覆盖限制（Coverage Limits）

1. **无无头/真实浏览器**：`app.js` 的行为仍以「真实 SSR 标记 + BFF 真实资产源码求值 + 真实 HTTP/WS」为证据（本轮新增 `/assets/app.js` 真实取回后求值重连函数）；焦点遍历、ARIA 实机、像素级留 WP-10。
2. **无真实模型/Provider**：`config.test` 的“成功路径”由 Reviewer 通过真实 `ConfigStore.upsertProvider` + 协议 `config.save` 造出可用 profile 后触发（`probeB B12-B13`），未调用任何 LLM。
3. **无 `pnpm test:e2e` / `test:acceptance` / `test:live`**：三者按契约返回 `NOT_IMPLEMENTED`。
4. **AC-088 未新增独立探针**（承接 WP-04 导入演练 + 本片 daemon 用例复跑）。
5. **`requirement.save.retry` 未新增探针**：其语义为“新请求键指向原 operation”，不属通用账本；仅在 R2.5 按代码与文档说明登记。
6. **失效产物但 gate 记录仍为 approved 的组合未构造**（`W9R1-12` 只验证“更高失效产物不抬版本”与“stale 记录”两条；`invalidatePlanForProductChange` 之外的单点 artifact 失效是否会让 `plan.current` 仍放行未验证）。
7. **集成本轮单次运行全绿**（`25/304`，`--maxWorkers=4`），未做多次重复以估计集成项目稳定性。
8. **交付工作树残留**：单次 `requirement.save` 后，项目根 `git status --porcelain` 为 `D .agentdev/requirements/...` + `?? .agentdev/`（既有 WP-08 行为，本轮 `packages/*/src` 未改）。它不影响本片“创建→取消”链（`probeC C1/C2` 通过），但会让重复创建路径落入 `RECOVERY_REQUIRED`（`W9R2-01` 的放大器）。本次仅作观察登记，不计入 WP-09 发现。
9. **`pnpm test:unit` 稳定性**只做了 6 次采样（1 失败/5 通过），不足以给出失败率；结论限于「无法证明稳定」。
10. **探针只消费 dist 产物**；`W9R2-01/02/03` 的定位为源码阅读 + 运行时复现双证据，`W9R2-05` 为真实 BFF 复现，`W9R2-06` 为静态可证。

## R2.11 能否进入独立 Test

**能。** 第 1 轮的两项 P1（`W9R1-01` 批准不可达、`W9R1-02` 过期卡片不可达）已用真实 BFF + 真实 daemon + 真实 `PlanGateService` 独立复现为**可用**：有效 Plan 可由页面同款载荷批准且版本前进，过期卡片以 `data-expired="true"` + 禁用控件 + 可见原因呈现，无 Plan/无授权时为诚实的禁用路径。`W9R1-03/05/07/08/09/10/11/12` 全部关闭，`W9R1-04` 对其具名的六条命令关闭，`W9R1-06` 的超时根因关闭。本轮未复现任何 P0/P1。

须在 Test 报告中显式登记的残留（**不得**把“测试全绿”当作这些行为已成立）：

- `W9R2-01` `requirement.save` 创建分支的幂等缺口（协议面/CLI 可达，UI 不调用）；
- `W9R2-02`/`W9R2-03` 需求记录在 update/取消时的字段与正文保真度；
- `W9R2-04` `pnpm test:unit` 默认 workers 的偶发端口竞态（契约命令需多次运行或按有界并发口径记录）；
- `W9R2-05` 中文界面的英文诊断、`W9R2-06` 恒真断言。
