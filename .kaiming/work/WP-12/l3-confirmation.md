# WP-12 切片记录：L3 显式确认交互（AC-011，关闭 W8-4 缺口）

- 状态：**已实现并通过整机证据**（真 daemon + 真协议 + 真浏览器；真实 Provider 只用于既有 live 演练，本交互不需要模型）
- 关闭的登记项：`.agentdev/work/WP-12/settlement.md` §4 第 8 条 / `scripts/lib/drill-acs.mjs` `KNOWN_PRODUCT_GAPS['AC-011']`（残余编号 `WP-12-D-W8-4`）
- 依据：`docs/rules/workflow.md` §2.3/§3/§5.1、`docs/rules/agents.md` §1、`docs/product/experience.md` §5、`docs/architecture/protocol.md` §4/§6（本次仅补充 L3 确认一段，未改任何方法集合）
- 不改动：`docs/delivery/acceptance.md`（AC 文本不动）、`packages/workspace/**`、`packages/core/src/{integrate,settlement,task-candidate,broker,permissions}.ts`、`docs/product/**`

## 0. 一句话

`workflow.md` §2.3 把数据删除/迁移、Secret、安全边界、身份/权限、支付、公开协议不兼容、部署/发布、项目门禁规则变化判为 **L3 高风险交付**。此前该判定只到 Plan 门禁 + Work 信封为止：产品**没有**"请你确认这是一次 L3 高风险交付"的显式交互。本切片把这条交互做成真实、可见、可恢复的流程：**路由评估落库时铸确认决定 → Inbox 卡片回答 → 确认前任何专业 Run 都不得入队**。协议方法集合不变（复用 `decision.resolve`），无迁移，无新运行时依赖。

## 1. 如何检测 L3

检测点只有一处，就是**路由评估本身**，不引入第二套风险判定：

- `packages/core/src/orchestrator.ts` `assess()` 在写入 `assessment` 行、`applyAssessmentToWork()` 把 Work 等级提到 L3 之后，调用
  `Orchestrator.confirmations.sync({ workId, runId, goal, riskFlags, reason, revision, scope })`。
- 等级来自既有文档化规则：`packages/domain/src/routing.ts` `decideLevel()`（环境操作/锁定风险 → L3）由 `assess()` 作为**下限**重新施加；`riskFromFlags` 用文档化词表（中文与 camelCase 同义）解析 `riskFlags`。
- `packages/core/src/l3-confirmation.ts` `L3ConfirmationService.requiresConfirmation(workId)` 只读 `work.Level === 'L3'`；**风险标记、原因、范围、修订取自同一条评估**，不是重新推断。
- L1/L2 Work：`sync()` 直接返回 `undefined`，`admitDispatch()` 直接 `allowed: true`，零成本、零行为变化。

## 2. 确认如何被提出（raise）

`L3ConfirmationService.raiseTx()` 在评估的同一事务里完成四件事：

1. 写一条 `kind='decision'` 的 Artifact（`mime=text/markdown`，`acl` 覆盖八角色），正文是 `l3ConfirmationQuestion()` 生成的确认书：将要实施的范围（写/读路径、操作、网络目标）、为什么是高风险（命中的风险标记 + 路由原因）、关联 Work/Requirement/修订、以及 confirm/decline 各自会发生什么。
2. 写 Decision 行：`kind='product'`、`targetRef={id:artifact, version, hash}`、`choices=['confirm','decline']`、`state='pending'`、`actor='user'`。
3. 把 Decision 追加进 `work.blockerIds`，并在 `workflow.md` §5.1 的合法边上把 Work 驻留为 `blocked`（`running→blocked`；`queued` 不会跨非法边，`paused`/`cancelling` 保持自身状态）。`blockerIds` 是 `permission.request` 用的同一套记账，所以 Work 自己的行就说明了它为什么停着。
4. 发两条持久事件：`decision.created`（`data.kind='l3_confirmation'`、`level`、`artifactId`、`choices`、`riskFlags`、`reason`、`revision`、`requirementId`）与 `work.control_changed(control='l3-confirmation-required')`。

冻结记录：`snapshot(type='context', payload.kind='l3_confirmation')` 固定 decisionId / artifactId / 风险标记 / 范围 / 修订 / Requirement / 提问 Run / 记录时间。回答后再冻结一条带 `answer{choice,reason,answeredAt}` 的同 kind 记录，所以**拒绝理由**也持久化（Decision 行只有 `state`/`choice`，没有理由列）。

重复评估不会铸第二条：`sync()` 已有 `pending`/`accepted` 记录时原样返回。

## 3. 确认如何被回答（answer）与恢复（resume）

- 回答入口**没有新增**：仍是 `decision.resolve`（`apps/daemon/src/protocol.ts` `resolveDecision`，沿用既有 idempotency 账本、`targetVersion` 版本冲突、过期决定不可再应用的全部语义）。
- 路由顺序：`permission` → **L3 确认** → product-behaviour。判定方式是 `services.confirmations.find(decisionId)` 命中冻结记录，因此 `confirm`/`decline` 不会被误送进 `now/later/decline` 分支；`services.confirmations` 由 `protocol.attachOrchestrator()` 从 `Orchestrator.confirmations` 挂载（生产装配路径：`main.ts` → `bootstrap.ts` → `attachOrchestrator`）。
- `confirm`：Decision → `accepted`；从 `blockerIds` 摘除；被驻留的 Work 按 §5.1 恢复 `running`；发 `decision.resolved`（`data.kind='l3_confirmation'`, `choice='confirm'`）与 `work.control_changed(control='l3-confirmed')`。随后既有路由续跑（`continueDeliveryRoute`/`queueApprovedRun`）按原计划排队，**无需手动重启**。
- `decline`：Decision → `rejected`；**保留** `blockerIds`（Work 仍因这条被拒的决定而停），Work 停在 `blocked`；原因为 `decision.resolve` 的可选 `reason`，落进 `decision.resolved.data.reason` 与冻结记录的 `answer.reason`；发 `work.control_changed(control='l3-declined')`。
- 幂等：同键同载荷重放返回账本记录的原始应答；已终态的决定再以同 choice 提交返回既有幂等分支，异 choice 返回 `INVALID_STATE`。

## 4. 确认前不得实施（enforcement）

用户要求的"高风险步骤前必须有显式确认"落在两处，互为冗余：

1. **`packages/core/src/orchestrator.ts` `dispatch()`**：在 Work 终态检查之后、**任何 snapshot/Run 行写入之前**调用 `confirmations.admitDispatch(work.id)`。L3 且未接受即 `fail('GATE_NOT_READY', …, { workId, level, l3Confirmation: 'none'|'pending'|'rejected', decisionId, remedy })`。被拒的派发**零残留**（无 Run、无 snapshot），整机用例逐个断言。
2. **确认只在被接受后才放行**：`confirm` 之前没有 Plan 批准、没有 Task、没有 develop Run —— 因为 L3 Work 的 Plan 阶段派发本身就被第 1 条挡住。

因此"未确认即不得实施"不是文案，而是准入拒绝；`packages/core/test/orchestrator.test.ts` 的 L3 夹具改为**先接受确认**（并补一条提问用的 Chief Run），既有授权/降级等断言一条未削弱。

## 5. 真实证据

### 5.1 真 daemon 整机演练（正路径 + 负路径 + 审计顺序）

`apps/web/test/l3-confirmation.integration.test.ts`（3 用例，真 SQLite `ProjectStore`、真 `WorkbenchProtocol`、真 `Orchestrator`、真 control handler、真 Plan 门禁、真 Inbox 投影）：

| 用例 | 覆盖 |
|---|---|
| `raises one visible confirmation … (AC-011)` | Work 等级从 none 变 L3；Inbox 出现一条 `l3Confirmation` 行（`pending`、`choices=[confirm,decline]`、风险标记 `数据删除/迁移`、范围 `writePaths=['src/db']`、修订、原因）；提问 Artifact 是真 `kind=decision`/`text/markdown` 且正文含 Work 与风险标记；Work 变 `blocked` 且 `blockerIds` 含该 Decision；**派发被 `GATE_NOT_READY` 拒绝且 Run/snapshot 数量不变**；事件里只有 `decision.created`，没有 `decision.resolved` |
| `resumes the route after the user confirms …` | 走 `decision.resolve`；Work 回 `running`、blocker 摘除；真专业 Run 入队（`role=backend`, `stage=develop-L3`, `parentRunId=Chief`）；事件序号 **`decision.created` < `decision.resolved` < `run.queued`**（user → decision → execution 的真实顺序）；Inbox 行变 `accepted`/不可操作；同键重放返回原应答，product 决定仍只有一条 |
| `blocks the high-risk step when the user declines …` | `reason` 记录在 `decision.resolved.data.reason`；Work 仍 `blocked` 且 `blockerIds` 含该 Decision；派发仍以 `GATE_NOT_READY`/`l3Confirmation='rejected'` 被拒；Inbox 保留 `rejected` 行与 `declineReason`，且不再可操作 |

### 5.2 真浏览器（真 Chromium + 真 daemon + 真 BFF）

`tests/browser/ac-011-l3-confirmation.spec.mjs`（2 用例，夹具由 `tests/browser/stack-runtime.mjs` 用**真** `Orchestrator.confirmations.raise()` 播种，因此卡片是 Core 真写的记录，不是手插行）：

- `出现 → 确认 → 服务端读回已接受`：卡片文案/风险标记/Work/修订/范围可见，`confirm`/`decline` 可点；点 `confirm` 后 `#inboxStatus` 可见、行状态读回 `accepted`、按钮禁用；重新 GET 页面仍为 `accepted`；`work.get` 显示 `status=running` 且 `blockerIds` 不含该 Decision。
- `拒绝必须记录原因`：空原因点 `decline` 被本地拒绝（`#inboxError` 可见、行仍在、`outcome` 仍 `pending`）；填写原因后 `decline` → 行 `rejected`，重新 GET 显示 `data-l3-decline-reason` 文本；`work.get` 显示 `status=blocked` 且 `blockerIds` 含该 Decision。

### 5.3 证据层级（如实）

- **真实层**：SQLite 存储、协议信封与 idempotency 账本、Orchestrator 准入、control handler、Inbox 投影与 Playwright/Chromium 真实 DOM。
- **桩层**：浏览器夹具的 Orchestrator 用一个不联网的 `ModelGateway` transport（本交互不调用模型）；整机用例不启动 Runner 子进程（它证明的是"准入—确认—执行入队"这一段，Run 的模型执行由既有 L2/L3 演练覆盖）。
- **未覆盖**：本切片**没有**用真实 Provider 跑一次完整的 L3 operation 路由；L3 的 Recovery 阶段（`STAGE_ORDER` 里 L3 code 链含 `Recovery`）在 `deliveryRoute` 投影中仍缺席，属于既有残余，不在本切片范围内。

## 6. AC-011 证据形状

AC 文本（不动）：**Given 数据迁移需求；When L3 实施；Then 存在明确授权、回退、逐项审核和恢复演练证据。**

| 子句 | 证据 |
|---|---|
| Given 数据迁移需求 | 整机用例用真 `数据删除/迁移` 风险评估驱动；`packages/domain/test/delivery.test.ts` 的 L3 级/路由规则 |
| When L3 实施 | `packages/core/test/delivery.integration.test.ts`（L3 Gate 在授权/回退/逐项审核/恢复演练齐备前拒绝实施）+ `packages/storage/test/migrations.integration.test.ts`（真实迁移失败回滚）+ `packages/core/test/backup.integration.test.ts`（恢复演练） |
| **明确授权（本次补的交互面）** | `apps/web/test/l3-confirmation.integration.test.ts` 三用例：确认出现 → 接受即放行且审计顺序正确 → 拒绝即停并记录原因；`tests/browser/ac-011-l3-confirmation.spec.mjs` 两用例：真浏览器里卡片可见/可答/可读回 |
| 回退 / 逐项审核 / 恢复演练证据 | 仍由 `delivery.integration.test.ts` 的 `rollbackPlanRef`/`auditRef`/`recoveryDrillRef` 绑定规则与 WP-01/WP-08 的真实迁移/恢复用例提供（未改） |

`scripts/lib/acceptance-registry.mjs` 的 `CURATED_EVIDENCE['AC-011']` 已加入上述三条整机用例（每条都是被执行的真实用例，逐一解析，不留死条目）；`scripts/lib/drill-acs.mjs` 把 AC-011 登记为浏览器 AC（`closedBy: 'pnpm test:e2e'`，条件 `browser-absent`）——只有本环境确实没有 Chromium 时浏览器那一半才是 UNVERIFIED，否则必须真实执行并按 PASS/FAIL 记录。

## 7. 关闭 W8-4 登记项

- `scripts/lib/drill-acs.mjs`：删除 `KNOWN_PRODUCT_GAPS['AC-011']` 整条，登记表变为空对象，并在该文件的说明块里写明"这是唯一一条已关闭条目、删除而非置 `status:'closed'` 的原因、以及关闭记录落在本文件"。其余条目未动，文件的追加式用途不变。
- `scripts/lib/acceptance-report.mjs` §8 对空登记表已渲染"无。"，不需要改代码；发布报告从此不再列该缺口。
- `.agentdev/work/WP-12/settlement.md` §4 第 8 条改为"已关闭"，并给出本文件与上述证据入口。

## 8. 本次运行内的门禁证据（串行执行）

| 门禁 | 结果 |
|---|---|
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0（全仓 Prettier 一致） |
| `pnpm test:unit` | **80 文件 / 1491 用例，exit 0**（含本切片新增 `packages/core/test/l3-confirmation.test.ts` 5 例，以及 `apps/web/test/{views,pages,client-script}.test.ts` 的确认卡/交互用例） |
| `pnpm test:integration` | **58 文件 / 546 用例，exit 0**（含 `apps/web/test/l3-confirmation.integration.test.ts` 3 例） |
| `pnpm test:e2e` | **28 checks — PASS 27 / FAIL 0 / UNVERIFIED 1，exit 0**；真实 Chromium 20 spec 全通过，新增 `browser.l3-confirmation[AC-011]` 一项（`exit 0`） |
| `node scripts/live.mjs --no-write` ×4 | 每次都 **7 passed / 0 failed / 0 unverified**（13 次 HTTP 200），exit 0 |
| `node scripts/acceptance.mjs` | **exit 0 — 94/94，PASS 94 / ACCEPTED 0 / FAIL 0 / MISSING 0**；AC-011 = `PASS / product-path / test-name`；报告 §8「已知产品缺口」=「无。」；证据层级计数 product-path 54 / library-level 40 / environment-limited 0 / unclassified 0；`codeDigest sha256:6a6a859ecd62…`，`gitHead b5cb5b5`（工作区含本次未提交改动） |
| `pnpm build` | exit 0（`broker.integration.test.ts` 的跨进程用例要求 `dist` 存在；本切片改了 `packages/core`，构建已重跑） |
| `node scripts/docs-check.mjs` | exit 0（16 文档 / 68 内链 / 94 AC / 9 需求 / 11 工作包） |

**一次负载敏感失败（如实登记）**：把 `pnpm test:integration` 与一次 `live.mjs` 并行跑时，`apps/cli/test/ops.integration.test.ts > agentdev restore with a live daemon > refuses a restore whose target already holds an active Project` 在 `agentdev start` 处返回 exit 1（该用例要求 CLI 启动的 daemon 就绪）。**串行重跑整套 integration 58 文件/546 用例 exit 0**，且该用例与本切片无关（只读复现一次即通过），按既有"负载敏感"性质登记。

## 9. 遗留（如实）

1. **L3 operation 路由**（`intent='operation'`）同样吃这条确认；它的 Plan→Execute→Review→Verify→Settle 阶段映射与不可逆操作批准（`permission.request`）的衔接未被本切片整机演练覆盖。
2. **L3 code 链的 `Recovery` 阶段**未出现在 `deliveryRoute` 投影里（`STAGE_ORDER` 有、投影没有），属既有残余。
3. **提问 Run 归属**：确认 Artifact 需要真实产生它的 Run（`origin=agent` 的外键）。路由评估总来自 Work 的 Chief Run，因此生产路径总是有名有姓；没有 Chief Run 的夹具会得到 `MISSING_CONTEXT` 而不是一条悬空记录。这是刻意的 fail-closed，不是遗漏。
4. **"以后处理"分支**：拒绝目前停在 `blocked` 并由用户重新决策（重新评估会再铸一条确认）；本切片没有把拒绝自动转成 `later` 排队需求（那会改变 `decline` 的既有产品语义，需要产品裁决）。
