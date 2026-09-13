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
