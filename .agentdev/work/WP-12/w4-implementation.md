# WP-12 W4：让真实 Provider 下的 L2 交付真正以「阶段成功」结束

- 状态：Developing（实现与真实运行完成；独立 Review/Test 不在本任务范围）
- 范围：`apps/daemon/src/{prepare-run,control-handler}.ts`（实际只改了 `prepare-run.ts`）、`packages/core/src/orchestrator.ts`、`scripts/lib/live-drills.mjs`、`scripts/lib/live-harness.mjs`、`scripts/lib/e2e-stack.mjs`、`scripts/e2e.mjs`、`docs/architecture/protocol.md`、`docs/product/experience.md` 及测试
- 依据：`product-completion-plan.md` 判据②与 §4 W4 行、`settlement.md` §4.5、`T2-fix-delivery.md` §5.1、`docs/rules/workflow.md` §3/§4、`docs/rules/agents.md` §1/§3/§4、`docs/architecture/protocol.md` §4/§6、`docs/architecture/execution.md` §2/§7
- 结论：L2 消息的真实路由已从「Chief 直接派发实现角色」改为按 `workflow.md` §3 走 **Product（可选）→ Plan → Develop**；Plan 阶段由真实模型交付 `success`，用户在 Plan Gate 批准后 Core 自行排队 develop Run，develop Run 真实读取/改写文件并交付 `stage.completed(success)`。演练的断言同步收紧：`stage.failed`/`needs_input` 现在直接判演练失败。

---

## 1. 修复前观察到的真实序列

用真实 Provider 跑 `node scripts/live.mjs --no-write`（`AGENTDEV_LIVE_DUMP=1`，修复前 HEAD `fece71e`）：

```text
drill.message-to-stage: PASS（旧断言）
  message 01a0a5b7-6dd6-… → Chief Run 01a0a5b7-6df6-… (running) →
  Requirement 01a0a5b7-871c-… (active/plan) →
  professional Run 01a0a5b7-a3ba-… (parent 01a0a5b7-6df6-…) →
  stage result 01a0a5b7-e223-… + stage.failed(needs_input)
```

控制日志（`.agentdev/work/WP-12/live-message-to-stage-control.log`，修复前那次）逐步事实：

```text
control-endpoint: <chief attempt> assessment.submit
control-endpoint: <chief attempt> agent.dispatch          ← 唯一一次专业派发，role=backend stage=develop-L2
execution: <backend run> run grants created=0 existing=0
  (MISSING_CONTEXT: Work … has no Task for role backend; the role was never dispatched)
tool-endpoint: refused GATE_NOT_READY: no approved Plan for this revision   ← write 被 Plan Gate 拒
control-endpoint: <backend attempt> stage.submit needs_input
```

即：Chief 评估后**直接**派发实现角色；Work 从未经过 Product/Plan，没有已批准 Plan、没有 Task，`ensureRunGrants`（`packages/core/src/permissions.ts` 前置的 `grants.ts roleStages`）拒绝为该角色铸 Grant，Plan Gate 也以「no approved Plan」拒绝写入。专业 Run 除了诚实上报阻塞之外没有第二条路。

## 2. 与文档路线的偏离（分歧点）

`workflow.md` §3 的 L2/L3 代码路线是 `Product（若已有效可复用）→ Plan → Develop → Review → Test → Accept → Settle`，且「均由 Chief 独立触发」；§4 规定范围内明确化的 Plan 可 AutoApproved。`protocol.md` §4 的 `plan.approve`（Q3=A）在批准时由 Core 直接排队 develop Run 并物化 Task。

偏离有三层：

1. **Chief 层**：提示词没有规定 L2/L3 路线顺序，真实模型因此把实现角色当成第一跳；且它用 `joinPolicy: 'none'` 派发，自己的 Run 在子 Run 结束前就终态，之后即使 Plan 被批准也没有在世的 Chief 可以当父级。
2. **Core 层**：`agent.dispatch` 不校验路线顺序，允许一个注定拿不到 Task/Grant 的 develop 派发落库——「静默允许」。
3. **演练层**（载体问题，不是根因）：`drill.message-to-stage` 把「任意终态 stage 事件」当作链路成功，`stage.failed(needs_input)` 也能 PASS；`drill.l1-typo` 只断言结算与 Work completed，没有显式点名三个 `stage.completed`。

## 3. 改动（按层）

### 3.1 Chief 指令层（`apps/daemon/src/prepare-run.ts` `roleContractSentence('chief')`）

新增两点，措辞与 `workflow.md` §3/§4、`protocol.md` §4 一致：

- L2/L3 代码交付**先派 `planning`**（行为尚未定义时再先派 `product`），在已批准 Plan 存在之前**不得**派 `backend|frontend` 的 develop 阶段；develop Run 的 Task 与文件 Grant 来自已批准 Plan，Core 会在 Plan Gate 批准时自行排队该 Run。
- 每个阶段用 `requiredChild: true` + `joinPolicy: 'all'` 派发，使 Chief Run 在子 Run 终态时被唤醒以触发下一阶段；`joinPolicy: 'none'` 会让 Chief Run 提前结束，已批准的 Plan 就没有 Chief 可以接手 develop Run。

### 3.2 专业指令层（同文件）

- 新增：Product/Plan 阶段还没有 Task，文件工具没有 Grant；需要读源码时用 `context.request`，并且「这些阶段的交付物是 ProductDefinition/Plan，不是代码改动本身，不能因为不能写源文件就报阻塞」。
- 新增 **stage goal**：`stageGoalOf()` 从冻结的 DispatchSnapshot 读 `dispatchSpec.goal`，prompt 同时给出 `Work goal` 与 `Your stage goal`（`promptFor` 与 `assembleContext` 两处）。此前真实 Planning Run 只看到 Work goal（整条需求），于是把「改 `cancel()`」当成自己的活，`read`/`artifact_write` 被拒后交付 `needs_input`。

### 3.3 Core 派发校验（`packages/core/src/orchestrator.ts`）

新增 `routableDraft()` + `enforceRouteOrder()`，接在 `dispatchProfessional` 与 `assessAndDispatch` 的模型草稿入口上（Core 自建的 chief spec 与 `protocol.ts queueApprovedRun` 的已批准 Plan 派发路径不受影响）：

- 命中条件：role ∈ {backend, frontend}、stage 为 develop/`develop-L*`、Work level 具备修改权限。
- 放行条件：spec 绑定的 taskId 属于该 Work 且角色匹配，或该 Work 已存在该角色的 Task。
- 否则 `GATE_NOT_READY` 拒绝，报文写出补救路线：「L2/L3 route is Product→Plan→Develop→Review→Test…，develop Run 的 Task 与文件 Grant 来自已批准 Plan，先派 planning；Core 会在 Plan Gate 批准后自行排队 develop Run」，`details.remedy = 'agent_dispatch planning/planning, then plan.approve'`。

这是把「没有 Task 的 develop Run 只能报阻塞」这一必然结局提前成类型化拒绝，而不是新增权限；不新增任何授权路径（`protocol.ts` 的 Plan 批准派发本来就带 taskId，照旧通过）。

### 3.4 演练收紧（`scripts/lib/live-drills.mjs` `runMessageToStageDrill`）

- 记录并断言**真实路线**：首个专业派发必须是 `product`/`planning`（否则直接报「Chief 在 Product/Plan 之前派了实现角色」）；`professionalRuns()` 明确按 `created_at ASC, id ASC` 排序（仓储默认不带 ORDER BY，路由断言不能依赖返回顺序）。
- **Plan 阶段必须 `success`**；`awaitSuccessfulStage()` 拒绝任何非 success 的交付并在报文里给出 summary。
- 演练扮演**用户**在 Plan Gate 的动作（这是该路线唯一需要用户决定的地方）：用 Plan 阶段自己的交付摘要 + 消息点名的写路径构造 PlanDraft，走真实 `plan.approve`；若批准时没有在世 Chief，调用与 `main.ts` 相同的 `resumeApprovedPlan()` 恢复受理（演练的 `onRunSettled` 也照生产接了这个钩子）。
- **Plan 阶段 Run 终态后才做用户决定**：`plan.approve` 的 hand-off 需要 Chief Run 的**未分配预算**，而仍在世的 planing 子 Run 会一直占着它；演练等 Plan Run `completed` 后再批准（真实用户本来也是看到 Plan 卡片后才点批准）。批准过早会稳定得到 `BUDGET_EXCEEDED: … no unallocated budget left`，这不是产品缺陷而是演练把「用户瞬间点击」当成默认时序。
- **develop Run 必须 `success`** 且发出 `stage.completed`；最终证据串给出完整路由（如 `route planning:success → backend:success`）。
- 失败诊断保留并补强：Run 列表带 `role/stage/purpose`，`describeNoStage` 仍然落 `.agentdev/work/WP-12/live-message-to-stage-failure.log`，且控制日志在**成功与否都**落 `live-message-to-stage-control.log`。
- 接上与 `main.ts` 一致的 `protocol.attachToolBridge({requestPermission, respondPermission, cleanupRun})`：develop Run 真实执行 `edit` 后为 `bash` 申请授权时，演练作为用户必须能通过真实 `permission.respond` 批准，否则只会停在 `waiting_permission`。
- `drill.l1-typo` 追加显式断言：Develop/Review/Settlement 三行必须各自发出 `stage.completed`（`submitStage` 原本已拒绝非 success 载荷，这里把「成功」写进证据）。

### 3.5 离线 e2e 与集成用例同步（测试，不是放宽）

- `scripts/lib/e2e-stack.mjs`：R32 桩的 Chief 第二跳改为 `planning`/`planning`（原来固定派 `backend`/`develop`，正好编码了要修的缺陷）；`scripts/e2e.mjs` 的 `chief.message-to-stage` 增加断言「Chief 的第一跳专业派发是 Plan 阶段」。
- `packages/core/test/orchestrator.test.ts`：`freshWork()` 默认播下 backend Task（这些用例检验的是路线放行之后的授权/预算守卫），新增一条 WP-12 W4 用例覆盖拒绝本身与补救路线（planning 放行、Task 到位后 develop 放行）。
- `apps/daemon/test/assessment-dispatch.integration.test.ts` 与 `stage-contract-runner.integration.test.ts`：脚本化 Runner 直接跳 develop 派发的演练，按「已批准 Plan 的产物」预置一条该角色 Task，原断言（含 out-of-envelope 的 `NOT_AUTHORIZED`）不变。
- `apps/daemon/test/prepare-run.test.ts` / `prepare-run-context.integration.test.ts`：固定新的路线措辞、`joinPolicy: 'all'`、`context.request` 回退与 `Work goal` + `Your stage goal` 同时出现。

### 3.6 真实演练暴露的两个测试支撑缺陷（`scripts/lib/live-harness.mjs`）

这两条不是产品缺陷，但会让真实演练偶发假红：

1. **Provider 凭据的 purpose 白名单过窄**：`secrets.put` 只登记了 6 个 purpose，真实 Chief 用 `purpose: 'document'` 派 Plan 阶段时凭据解析失败，表现为 Gateway `CONFIG_INVALID`、Run 连续两次没有模型文本 → `contract_violation`。已按 `purposeSchema` 全量登记 10 个 purpose。
2. 见 §3.4 的 `attachToolBridge`。

### 3.7 单写者租约在交付后释放（`apps/daemon/src/control-handler.ts`，真实验收倒逼出的产品修复）

正确路线带来一个新的同 Work 串行冲突：每个 Attempt 的**任何** Broker 工具调用都会先取该 Work 的单写者租约（`tool-handler.ts assertWriter`，即使这次调用随后因无 Grant 被拒也已取到），租约按 TTL（`LIMITS.leaseSec`=20s）自然过期，而 `plan.approve` 会在 Plan 阶段交付后立刻排队 develop Run——develop Attempt 的头几轮写入于是落在上一个 Attempt 的租约里，被 `BUSY: … this Attempt holds no writer lease` 拒绝。是否还能成功取决于模型愿不愿意重试：本机轻载时 5/5 复跑能撑过去，验收那次负载下 Planning/Backend 直接交付 `needs_input`，验收因此 `94/94 PASS 90 / FAIL 4`、`test:live exit 1`（AC-003/AC-005/AC-069/AC-066）。

修复落在被授权的 `control-handler.ts`：`stage.submit` 被接受即表示该 Attempt 的书写结束，此时释放它持有的 Work 单写者租约（`store.leases.release(workWriterLeaseResource(run.projectId, run.workId), caller.attemptId, caller.epoch)`）。释放的是自己持有的租约，不扩大任何权限；释放后若该 Attempt 再调用 Broker 工具（此时 Run 已交付）会重新参与竞争，单写者语义仍由同一行租约保证。

同步的演练时序修正见 §3.4（Plan Run 终态后再批准）。两者合起来后，收尾树上的真实运行控制日志里 `BUSY` 出现 **0** 次，develop Run 稳定 `edit executed` → `stage.submit success`。

> 仍未关闭的系统性面（见 §8.3）：`assertWriter` 在「调用被拒」时也会取租约、以及租约只在 Attempt 结束后的 TTL 内自然过期而非在 Attempt 结束时释放，都是更底层的租约生命周期问题，涉及 `tool-handler.ts`/`execution.ts`，不在本任务授权范围内。

## 4. 收紧后的断言（与旧版对照）

| 断言 | 旧 | 新 |
|---|---|---|
| 终态 stage 事件 | 任意终态（含 `stage.failed`）即通过 | 必须 `stage.completed`；`needs_input`/`failed` 直接 FAIL |
| 派发顺序 | 不检查 | 首个专业派发必须是 product/planning；planning 必须先于 backend/frontend（按创建序） |
| Plan 阶段 | 不检查 | 必须 `success` |
| develop Run | 不检查（甚至不要求存在） | 必须存在、必须 `success`、必须发出 `stage.completed` |
| L1 纵深 | 结算成功 + Work completed | 追加 Develop/Review/Settlement 三条 `stage.completed` |

## 5. 真实 Provider 运行（`node scripts/live.mjs --no-write`）

`/tmp/wp12-live.env` 提供 Base/MODEL/SECRET（值不落记录）。

| # | 结果 | drill.message-to-stage 交付 | 说明 |
|---|---|---|---|
| 修复前 | exit 0（旧断言） | `stage.failed(needs_input)` | 旧断言把链路成立当成功 |
| 1 | FAIL | — | 修复生效（首跳已是 planning），但 Chief 用 `joinPolicy:'none'`，Plan 批准时已无在世 Chief：`GATE_NOT_READY: the Plan is approved but no professional Run could be queued` |
| 2 | FAIL | `planning` → `stage.failed(needs_input)` | 演练消息前提与 seed 文件不符（文件里没有「cancellation message」），真实模型读完文件后诚实报前提不成立 → 改写消息 |
| 3 | FAIL | `planning` → `success`，Plan 已批准并排队 develop | 演练自身的路由断言用了无序 `runs.list`，把已正确的路线误判为 backend 在前 → 显式排序 |
| 4 | FAIL | `planning` → `stage.failed(needs_input)` | 模型把 Work goal 当成自己的阶段目标，尝试改源码被拒后报阻塞 → 补 `Your stage goal` 与「Product/Plan 交付物不是代码改动」 |
| 5 | FAIL | `planning` → `contract_violation`（无模型文本） | 测试支撑缺陷①：purpose 白名单过窄导致 Provider 凭据 `CONFIG_INVALID` |
| 6 | FAIL | `planning` → `success`；develop 已 `edit executed` | 测试支撑缺陷②：演练未接 `attachToolBridge`，用户批准 `permission.respond` 返回 `PROVIDER_UNAVAILABLE` |
| **7** | **exit 0** | **`planning:success → backend:success` + `stage.completed(success)`** | 7 passed / 0 failed / 0 unverified |
| **8** | **exit 0** | **`planning:success → backend:success` + `stage.completed(success)`** | 7 passed / 0 failed / 0 unverified |
| **9** | **exit 0** | **`planning:success → backend:success` + `stage.completed(success)`** | 7 passed / 0 failed / 0 unverified |
| **10** | **exit 0** | **`planning:success → backend:success` + `stage.completed(success)`** | 7 passed / 0 failed / 0 unverified；本条同时验证 L1 新断言 |
| **11（收尾树）** | **exit 0** | **`planning:success → backend:success` + `stage.completed(success)`** | 7 passed / 0 failed / 0 unverified；并发写者解除、临时反证改动全部回退后的最终树 |
| 12（验收内 `test:live`） | **exit 1** | `planning:success`，develop → `stage.failed(needs_input)` | 验收负载下暴露单写者租约 BUSY 竞态（§3.7）→ 修 control-handler 释放租约 + 演练等到 Plan Run 终态 |
| **13（租约修复后）** | **exit 0** | **`planning:success → backend:success` + `stage.completed(success)`** | 控制日志 `BUSY` 0 次，develop 真 `edit executed`；7 passed / 0 failed |
| **14（最终验收内 `test:live`）** | **exit 0** | **`planning:success → backend:success` + `stage.completed(success)`** | 证据写进 `.agentdev/work/WP-12/acceptance.md`（message 01a0a603-…，developer Run 01a0a603-f851-…） |
| 反证（负例，离线桩） | **exit 1（预期）** | 桩把 `stage_yield` 改成 `status:'needs_input'` | `FAIL chief.message-to-stage — stage.completed was not emitted for the professional Run`；证明收紧后的演练确实要求阶段成功、不是放宽 |

收敛后的通过率：**连续 5/5 次轻载 exit 0**（第 7、8、9、10 次 + 收尾树第 11 次），修掉租约竞态后又 **2/2 次 exit 0**（第 13 次与最终验收内的第 14 次），每次 `drill.message-to-stage` 都走到 `stage.completed(success)`，且真实开发 Run 在控制日志里留有 `edit executed`（真写入）与用户批准一条 `bash` 权限的真实记录。修复过程共 14 次真实运行暴露并关闭了 7 个（含 2 个测试支撑）阻塞项，全部记录在此文件而不是以「偶发」掩盖。

**负例反证（证明断言不是放宽）**：把离线桩（`scripts/lib/e2e-stack.mjs` 的 R32 `drillMessage`）唯一一处 `stage_yield.status` 从 `success` 临时改成 `needs_input`，`pnpm test:e2e` 立刻变红：

```text
FAIL chief.message-to-stage [AC-003,AC-005,AC-068,AC-069]
  stage.completed was not emitted for the professional Run
e2e: FAILED at chief.message-to-stage
exit=1
```

随后把该行改回 `success`，最终 e2e 恢复 exit 0（见 §6）。同一条规则也存在于真实演练的 `awaitSuccessfulStage()` 中（`row.status !== 'success'` 直接抛错）。另外单独验证过：把真实演练的消息换回「前提不成立」的写法并临时去掉 `stage-goal` 提示后，真实 Planning Run 仍交付 `success`（提示修复足够强），因此负例改用上文这种确定性桩，而不是依赖真实模型偶发 `needs_input`。

第 7 次的完整证据（`.agentdev/work/WP-12/live.md` 同批记录）：

```text
PASS drill.message-to-stage [AC-003,AC-005,AC-069]
  real Provider no-seed chain: message 01a0a5d2-840b-… → Chief Run 01a0a5d2-842e-… (running) →
  Requirement 01a0a5d3-2207-… (active/plan) → route planning:success → backend:success
  (developer Run 01a0a5d3-bdb8-… parent 01a0a5d2-842e-…) → the user approved Plan v0 →
  stage result 01a0a5d3-f39b-… + stage.completed(success)
```

## 6. 门禁（串行，收尾树）

并发写者解除、临时反证改动全部回退后：

| 命令 | 结果 |
|---|---|
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0（Prettier 全匹配） |
| `pnpm test:unit` | 77 文件 / 1459 用例，exit 0 |
| `pnpm test:integration`（全量） | 56 文件 / 535 用例，exit 0 |
| `pnpm test:e2e` | exit 0 — 27 checks，PASS 26 / FAIL 0 / UNVERIFIED 1（唯一 UNVERIFIED 为 `provider.fact-and-unknown` AC-001 的离线固有项） |
| `node scripts/acceptance.mjs`（真实 Provider） | **exit 0 — 94/94，PASS 94 / ACCEPTED 0 / FAIL 0 / MISSING 0**；证据绑定 `sha256:e88ea4b62371…`（HEAD `fece71e`，350 code files）；内部 `unit 1459 tests 0 failed`、`integration 535 tests 0 failed`、`pnpm test:e2e exit 0`、`pnpm test:live exit 0` |

中间过程如实记录：租约竞态未修前的那次验收为 `PASS 90 / FAIL 4`、exit 2（`test:live exit 1`；4 条为 AC-003/AC-005/AC-069 与 UNVERIFIED 的 AC-066）；修掉 §3.7 后重跑即全绿。e2e 的 check 数由 26 变 27（PASS 26 / UNVERIFIED 1）不由本次改动引入的断言增减而来，UNVERIFIED 项与 T2 记录同类（AC-001 需真实 Provider），逐 AC 映射未变。

## 7. 文档补记（本任务授权的两条）

- `docs/architecture/protocol.md` §5 方法表新增 `inbox`：`{}` → `{items,unread}`，按目标+版本去重，每项含 kind/id/workId/actionable，主管待办关闭后不再列出。
- `docs/product/experience.md` §5 新增：Inbox 的主管待办（含敏感文件待办）由用户处理后立即从列表消失，`chief.todo.resolve` 只记录处置、不授予任何权限、同一 (work,path,pattern) 的后续拒绝不再出现。

## 8. 仍未关闭

1. **PlanDraft 仍由演练以「用户」身份构造**：Core 目前没有「模型产出 PlanDraft → 提交 Plan Gate」的路径（`plan.approve` 需要调用方给出 PlanDraft；planning Run 因无 Task 也拿不到 `artifact_write` Grant）。本任务没有改这条链路（会触及 `protocol.ts`/`grants.ts`，超出授权范围）；演练用 Plan 阶段自己的交付摘要 + 消息点名的写路径构造用户决定，并如实标注。若要让 L2 全自动，需要产品决定「PlanDraft 从哪来」。
2. **develop 之后的 Review/Test/Settle 仍不是消息驱动自动续跑**：`plan.approve` 只排队 develop Run，没有 develop 终态 → Review 的推进器；本任务的终点是「Develop 阶段成功」，L2 全链路由 `drill.l2-delivery` 覆盖。
3. **单写者租约**：§3.7 已在交付点释放租约，真实演练里 `BUSY` 归零；但更底层的两点仍开放——`assertWriter` 对**被拒**的工具调用也取租约、租约不在 Attempt 结束时立即释放而只等 TTL，二者都在 `tool-handler.ts`/`execution.ts`，超出本任务授权范围。
4. **`pnpm test:integration` 的两个既有负载敏感用例**（`broker.integration.test.ts` 容器读、`protocol.integration.test.ts` AC-054 重放抖动）不由本改动引入；本轮全量 integration 与验收两次都未翻转，但仍是验收 exit code 的已知不稳定源。
5. **本次会话期间出现过另一条并发写者**（W1 车道）改了 `packages/core/src/broker.ts`、`apps/daemon/src/tool-handler.ts`、`packages/core/test/broker.test.ts`、`docs/architecture/execution.md`、`.agentdev/work/WP-12/{T3-implementation,w1-implementation}.md`，其中 broker.ts 一度让 `pnpm lint` 变红。持钥者于 23:28 中断该车道并回退其代码半成品；**但该车道随后疑似恢复**：`packages/core/src/broker.ts`（`isMetadataAddress` 已定义版）与 `packages/core/test/broker.test.ts` 的 mtime 为 00:01:57/00:02:29，而本次验收报告 `generatedAt` 为 **17:01:23Z（=00:01:23 +07）**、`codeDigest sha256:e88ea4b62371…`——即 **本次全绿验收覆盖的是「我的改动 + 另一车道 4 个文档/记录改动」的树，不包含 00:01:57 之后重新出现的 broker.ts/broker.test.ts 改动**。本任务没有触碰这些文件；在含其最新改动（typecheck 仍绿）的树上是否仍 94/94 需由持钥者在其车道停下后另行复验。工作树中的 4 个文档/记录改动（`docs/architecture/execution.md` 网络口径 + T3/w1 记录）不是本任务产物，最终 typecheck/lint/验收在含它们的树上通过。
