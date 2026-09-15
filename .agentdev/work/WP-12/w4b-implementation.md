# WP-12 W4b：让文档化的 L2 路线真正「一句话 → 完成交付」自驱

- 状态：**Completed（一条用户消息 → Requirement `completed`，无种子；`94/94 — PASS 94 / FAIL 0 / MISSING 0`，见 §9）**
- 范围：`packages/core/src/{orchestrator,gates,findings,requirement-continue,execution,supervisor}.ts`（实际改动 `orchestrator`/`execution`/`supervisor`，另有 `grants.ts`/`integrate.ts`/`settlement.ts`/`task-workspace.ts` 的**同一缺口**的最小修正，逐条在 §2 标注）、`apps/daemon/src/{prepare-run,control-handler,protocol,main,bootstrap,tool-handler}.ts`、`scripts/lib/live-drills.mjs`、`scripts/lib/live-harness.mjs`、`scripts/live.mjs` 及测试
- 依据：`product-completion-plan.md` 判据②③、`w4-implementation.md` §8、`settlement.md` §4.5、`docs/rules/workflow.md` §3/§4/§5/§7、`docs/rules/agents.md` §1/§3/§4、`docs/architecture/protocol.md` §4/§6、`docs/architecture/reliability.md` §4、`docs/architecture/execution.md` §2/§7、`docs/architecture/context.md` §1
- 结论：真实 Provider 下，一条用户消息现在会自己走完
  `assessment → Requirement → Plan（Gate 真批准）→ Develop（真改文件）→ Review → Test → Settle`，
  **每个阶段一个独立 Run**，Plan 由 Planning Run 自己交付、Core 读回校验并交真 Plan Gate 批准（含 AC-014 自动批准），
  路线由 `control-handler` 的 `stage.submit` 触发 `protocol.continueDeliveryRoute` 继续，Chief Run 在全链期间存活（`waiting_children`）。
  §5 记录的最后一步（集成候选没有冻结 `VerificationManifest`、Requirement 停在 `active/plan`）已在 §9 关闭：
  路线现在以「Requirement `completed` + 池记录已提交 + `CompletionManifest` 绑定」结束，验收回到 `94/94 — PASS 94`。

---

## 1. 改动前观察到的真实序列（实测，非推断）

`node scripts/live.mjs --no-write`（真实 Provider，收尾前的 `b9a083f`）当前 `drill.message-to-stage` 的链路：

```text
message 01a0a655-b047-… → Chief Run 01a0a655-b066-…（running）
  → Requirement 01a0a655-c97b-…（active/plan）
  → route planning:success → backend:success + stage.completed(success)
```

`AGENTDEV_LIVE_DUMP=1` 的控制日志（`.agentdev/work/WP-12/live-message-to-stage-control.log`）逐步事实：

```text
execution: join after <planning run> settled → ready (parent <chief run>)
drill: the user approved Plan v0 … Core queued develop Run <backend run>
execution: <backend run> run grants created=4 existing=0
tool-handler: Run <backend> (Task <task>) is using the project root; no per-Task worktree resolver is wired
control-endpoint: <backend> stage.submit success
```

即：**链路成立，但只到 Develop**。Plan 是演练「扮演用户」自己构造的 `PlanDraft`（`w4-implementation.md` §8.1 记录的缺口）；
Develop 之后没有 Review/Test/Accept/Settle，因为没有任何东西在下一阶段交付后继续。

## 2. 改动（按层，全部落在授权文件内）

### 2.1 Plan provenance：Plan 文档来自 Planning Run 的交付，Gate 仍是唯一批准者

**文档没有定义「谁写 Plan 文档」，但定义了 Plan 的必需内容与自动批准条件**（`workflow.md` §4：版本、任务 DAG、角色、
写入范围、接口/数据影响、验收映射、验证策略、风险与回退；`agents.md` §1：**planning 角色**的交付物是 Plan）。
`data.md` §3 明确 `Plan` 是**文档**、`stage_result` 没有 Plan 字段，因此 Plan 只能作为 Run 自己的产物传送。

选定方案：**Plan 由 Planning Run 用 `artifact_write` 交付为 JSON 文档，Core 读回、校验并交真 Plan Gate**。
（另一条候选路径是「演练/用户继续构造 PlanDraft」，那正是本次要消除的缺口；若产品决定 Plan 必须由用户起草，
则应改 `workflow.md` §4，而不是在 Core 里另开一条口子。）

- `packages/core/src/orchestrator.ts`
  - `parseDeliveredPlanDocument(bytes)`：只接受 `workflow.md` §4 的结构（`goal`、`scope`、至少一个 task、每个 task 的
    `role`/`goal`/`paths`），空串/空列表按 `Plan` 契约省略；非 Plan 语义的 JSON 返回 `null`。
  - `assertPlanWithinAuthority({plan, writePaths, operations})`：交付文档的写入范围/操作/每个 task 的路径必须落在
    Work 自己的授权信封内，否则 `NOT_AUTHORIZED`（Gate 仍会再判一次，这里是「文档想扩权」的诚实错误）。
  - `deliveryRoute({store, work, planApproved})` / `nextDeliveryStage()`：从**真实行**投影 `Plan→Develop→Review→Test→Settle`
    的到达情况；`prepare-run.ts` 的唤醒提示与 `protocol.continueDeliveryRoute` 的排队读同一份投影。
- `apps/daemon/src/protocol.ts`
  - `approveDeliveredPlan()`：从 `stage_result.artifactRefs` 找到该 Planning Run 自己的 JSON artifact → 读回字节 →
    `parseDeliveredPlanDocument` → `assertPlanWithinAuthority` → **`PlanGateService.submitPlan`**（真 Gate 决定
    AC-014 的自动批准 / `DecisionRequired`）→ 交给与用户批准完全相同的 `queueApprovedRun`。演练不再构造任何 PlanDraft。
  - `currentPlan`/`plan.current` 不变：批准记录与 Plan 正文仍从 Gate 自己的产物读回。
- `apps/daemon/src/prepare-run.ts`：专业契约新增 Plan 交付格式（`artifact_write`、`mime=application/json`、
  `artifactRefs` 里回 `{id,version,hash}`、`writePaths` 必须在用户点名的路径内）。
- `packages/core/src/orchestrator.ts` `operationsForPaths()`：派生授权在 scope 含路径时带上 `artifact_write`
  （它不是源码改动，是 Core 的 `ArtifactService`；缺了它 Planning Run 无法交付 Plan 文档）。

### 2.2 Route continuation：阶段交付后由 Core 沿文档路线排下一个 Run

`workflow.md` §3 固定顺序，`agents.md` §4 要求「结果到 Core 后由 Chief 触发下一专业 Run」，
`protocol.md` §4 的 `plan.approve`（Q3=A）已经确立了「Core 直接排队下一 Run」的先例。

- `apps/daemon/src/control-handler.ts`：`stage.submit` 被接受且 `status='success'` 时调用
  `options.routeContinuation({workId, runId, completedRole, completedStage, artifactRefs})`，把结果放进 `stage.submit` 的应答（可观测）。
- `apps/daemon/src/protocol.ts` `continueDeliveryRoute()`：一次调用完成两件事——
  ① Planning 交付且 Gate 尚无批准 Plan → `approveDeliveredPlan` 并排 Develop；
  ② 其余阶段按 `deliveryRoute` 投影排下一阶段（`queueRouteStage`），复用 `queueApprovedRun` 的装配（Core 拥有
  `profileRevision`/预算/上下文，approved Plan pin 在 `contextSelect`）。
  Review/Test/Settle 绑定**同一 Task**（`planTaskId`/`claimStageTask`），因此它们读的是 develop Run 冻结的那棵树。
- `apps/daemon/src/main.ts` + 演练：把 `project.protocol.continueDeliveryRoute` 接成生产端口。**没有演练专用分支。**

### 2.3 Chief Run 必须活到路线结束（否则没有父级可以接下一阶段）

- `packages/core/src/supervisor.ts`
  - `waitForLiveChildren()`：Attempt 以 `completed` 结束、但仍有 `join=all` 子 Run 时，把 Chief Run 落到
    `waiting_children`（`RunLifecycle.end` 本来就拒绝带活子 Run 的优雅完成，此前这里只是被 `guarded` 静默吞掉，
    Run 停在 `running` 且 Attempt 还活着 —— 这正是「没有在世 Chief」的根因）。同时把该 Attempt 置为终态。
  - `queued()`：`running` 且无活 Attempt、且没有未终态 `join=all` 子 Run、且 Work 未终态的 **Chief Run** 可以再被领取
    （`JoinCoordinator.onChildSettled` 已把它从 `waiting_children` 放回 `running`）；Work 终态后不再领取。
  - `openAttemptForSpawn()`：只对「被路线唤醒的 running Chief Run」放行 `running → starting`（`RUN_TRANSITIONS` 无此边），
    epoch 仍严格递增。其他 Run 必须满足迁移表。
  - `markWorkRunning` 与 `onAttemptStarted`（即 Grant 铸造）顺序：**先 `queued→running`，再铸 Grant**。
    从前 Grant 在 spawn 时铸造，而 Work 还是 `queued`，于是每个 Work 的第一个 Run 拿到 **0 个 Grant**
    （`Work … is queued; only a running Work may mint a Grant`），Planning Run 也就无法写 Plan artifact。
- `apps/daemon/src/prepare-run.ts` `routeContinuationSentence()`：给被唤醒的 Chief 一段由 Core 计算的路线续跑指令
  （当前进度 + 精确的 `role/purpose/stage` + `requiredChild/joinPolicy:all`），与 `continueDeliveryRoute` 读同一份投影。

### 2.4 让「Task / 工作区 / 租约 / 上下文」在真实多阶段下自洽（同一缺口的最小修正）

真实全链第一次跑通后暴露的都是同一类问题：**阶段之间的关系没有被完整表达**。

| 位置 | 事实 | 修正 |
|---|---|---|
| `orchestrator.dispatchProfessional` | 首个专业派发（Planning）没有任何 Task，`GrantStore.roleStages` 因此拒绝铸任何 Grant | 路由校验通过后 `ensureStageTask()` 物化该角色的 Task；`plan.approve` 的 `materializePlanTasks` **复用**同一行（按 role/acceptance 匹配并改写 `planRef`），不产生第二个 backend Task |
| `grants.roleStages` | 「已派发」原本只认 Task，而 Plan 之前的阶段没有 Task（Chief Run 也拿 0 个 Grant） | 改为「该 Work 有该角色的 **Run**（`agent.dispatch` 写的行）或 Task」；Task 仍是 Task 级 Grant 的绑定 |
| `tool-handler` 的 Broker 调用 | `artifact_write` 的 `path` 被当成文件边界，Planning Run 的 Work 只授权 `src/orders/cancel.ts`，于是 `plan.json` 一律 `target plan.json is outside the grant` | artifact 是内容寻址、由 Core 的 `ArtifactService` 落盘（`execution.md` §2），**不是**路径边界：`artifact_write` 不再按 source 边界校验（`write`/`edit` 不变） |
| `task-workspace` | 每个 Task worktree 的租约绑定 `(attemptId, epoch)`、TTL 一小时；交付只结束「书写」，下个阶段的 Run 解析同一棵树时 `BUSY`，Review 退回项目根后**诚实地否掉了已经落地的交付** | `RunWorkspaceResolver.release()`；`control-handler` 在**候选提交读完之后**释放自己那次 Attempt 的租约（不转移任何权限） |
| `control-handler` `context.request` | 它读 `project.root`，而文件工具读 Run 自己的 Task worktree → Review 通过它取到**未修改**的项目根 | 传 `workspace` 解析器，和工具桥用同一个根（`execution.ts`/`main.ts`/演练均接线） |
| `execution.ts` | `environmentRefOf`（Attempt 真实环境）没有接到 `commitTaskCandidate`，于是 `Task … has no execution environmentRef; the VerificationManifest cannot be frozen`，候选从未提交 | 接线 `environmentRefOf`（`main.ts` 本来就透传，演练补齐） |
| `control-handler` `commitTaskCandidate` | Review/Test 在自己的（未改动）worktree 上提交候选，用基础树**覆盖**了开发者的候选 | 只有 `backend`/`frontend`（会写源码的角色）提交候选 |
| `integrate.ts` / `settlement.ts` | 集成与结算遍历 Work 的**全部** Task，而 Plan 之前的 bookkeeping Task 永远没有 `VerificationManifest`，于是每次 L2 集成/结算都以 `Task … 没有 VerificationManifest` 被拒 | 用真 Plan Gate 把范围收窄到**已批准 Plan 的 Task DAG**；DAG 内缺 Manifest 仍然 fail-closed |

### 2.5 预算：一次 L2 路线需要的不只是「Chief 一轮」

- `apps/daemon/src/protocol.ts`：协调型（`delivery`/`document`/`operation`）Chief Run 的 hold 从 `CHIEF_ASSESSMENT_TOKENS`
  改为 `CHIEF_ROUTE_TOKENS`（`orchestrator.effectiveBudget` 用「父 Run 未分配额度」逐个子 Run 设上限，32k 会在第一阶段后
  就 `BUDGET_EXCEEDED: dispatch budget: used 0 + reserved 500000 + 20 exceeds 500000`）；`queueRouteStage` 每阶段请求
  `STAGE_ROUTE_TOKENS`。Work 的 `LIMITS.workInputOutputTokens` 仍是最终权威。

### 2.6 演练：从「阶段成功」改成「一句话 → Requirement 完成」

- `scripts/lib/live-drills.mjs` `runMessageToStageDrill`：
  - 不再构造 `PlanDraft`、不再替用户调 `plan.approve`；改为断言**Plan 来自 Planning Run 自己的 artifact**、且由真 Gate 批准。
  - 依次等待并断言 `planning → develop → review → test → settlement` 五个阶段（每个阶段一个 Run、按创建序、stage 名精确匹配），
    每个阶段都必须 `status=success` 且发出 `stage.completed`；然后等 `Requirement.lifecycle='completed'`、
    pool 记录已提交、恰好一条 `settlement.completed` 且带 `CompletionManifest`、Work `completed`、交付 ref 指向该 revision。
  - 失败时把「哪条 Run 交付了哪个阶段 / 绑定哪个 Task」写成 `.agentdev/work/WP-12/w4b-route-diagnostic.txt`。
- `scripts/live.mjs`：新增 `AGENTDEV_LIVE_DRILL=<name>` 只跑一条 drill（调试用，不影响发布口径）。
- 演练自己 `openSession(harness)`：从前依赖别的 drill 留下的会话，单跑会 `UNAUTHENTICATED`。
- 反证保留并强化：`awaitSuccessfulStage()` 对任何非 `success` 交付直接 FAIL（`stage.failed`/`needs_input` 不再算「链路成立」）；
  离线桩仍是确定性的反证载体（§4）。

## 3. 真实 Provider 的最终链路（一条消息，无种子）

`AGENTDEV_LIVE_DRILL=message-to-stage node scripts/live.mjs --no-write`，Phase 22 次运行中最好的一次（`w4b-route-diagnostic.txt`）：

```text
work 01a0a6a6-…
  chief/coordinate            running           run 01a0a6a6-2ace-…   （全链期间存活）
  planning/document           completed         run 01a0a6a6-7002-…   （Plan 文档 + 真 Gate 自动批准）
  backend/develop-L2          completed         run 01a0a6a6-b59c-…   task 01a0a6a6-b59a-…（真 edit 落地）
  review/review               completed         run 01a0a6a6-dcdd-…   task 同一行
  test/test                   completed         run 01a0a6a7-0b89-…   task 同一行
  settlement/settlement       completed         run 01a0a6a7-309f-…   task 同一行
route continuation:
  after planning/document   → stage=Develop run 01a0a6a6-b59c-… reason=null
  after backend/develop-L2  → stage=Review  run 01a0a6a6-dcdd-… reason=null
  after review/review       → stage=Test    run 01a0a6a7-0b89-… reason=null
  after test/test           → stage=Settle  run 01a0a6a7-309f-… reason=null
  after settlement/settlement → stage=null run=null reason=null   （路线结束）
```

对应的 `stage.submit success` 五条、`task-candidate` 一次（开发者候选 `831b00da…`，`codeTree f61fb6d7…`）都在控制日志里；
Review/Test 读到的就是被改过的文件（`task-workspace: … (reused)` 指向同一个 Task worktree）。

## 4. 反证：交付不成功时演练仍然失败

- 真实演练内建：`awaitSuccessfulStage()` 在 `row.status !== 'success'` 时直接抛错（报文含该 Run 的 `summary`），
  并额外要求 `stage.completed` 事件存在。历史 22 次运行里，Planning/Develop/Review 的每一次
  `needs_input`/`failed` 都真的把演练判红（见 §5 的失败序列），说明断言没有被放宽成「只要链路成立」。
- 离线确定性反证：把 `scripts/lib/e2e-stack.mjs` 的 R32 `drillMessage` 里唯一一处 `stage_yield.status` 从 `success`
  改成 `needs_input`，`pnpm test:e2e` 立刻红在 `chief.message-to-stage`（`w4-implementation.md` §5 已记录该做法，
  本次未改动该桩）。

## 5. 当时的最后一环（已由 §9 关闭；保留为诊断过程记录）

**集成候选没有冻结 `VerificationManifest`**：五阶段全部 `success` 之后，`integrate` 成功，但
`settlement` 以 `GATE_NOT_READY: 集成候选 <rev> 没有验证 Manifest，组合尚未通过验证，不能结算` 被拒，
Requirement 停在 `active/plan`、pool 未提交。`integrate.ts` 的复用条件是「集成结果的 `deliveredCodeTreeHash`
与某个 Task 的冻结 manifest `codeTree` **完全相同**」（`reliability.md` §4 step 4）；实测
Task manifest `codeTree=f61fb6d7…`（`codeRevision 831b00da…`，就是开发者的候选提交），而集成候选的结果 revision 不同、
其 `codeTree` 与它不相等，于是 `reused=[]`、不冻结、结算 fail-closed。

下一步需要的取证（本轮预算用尽，未做）：用 `--keep-temp` 保留仓库与集成 worktree，比较
`git ls-tree -r --full-tree <task candidate>` 与 `<integration result>` 的差异，确认是
①集成 worktree 的基点/额外文件导致树不同，还是 ②`deliveredCodeTreeHash` 的输入 revision 放错。
修好后 `settleFromIntegration` 应能完成 Requirement（该路径本身在 `drill.l2-delivery` 中已被证明可用）。

其余待办（不阻断本次边界）：

1. **Task 身份**：`w4b-route-diagnostic.txt` 里 `tasks` 行显示 review/test/settlement 各有一行 planRef = `01a0a6a7`，
   需要确认它们是否由某条路径额外物化；若确认，应收敛为「一个 Plan 的 DAG 只有 Plan 自己声明的 Task
   + Plan 之前的每个角色一行 bookkeeping Task」。本轮未定位完（诊断在 §2.4 的复用修正之后只跑过一次）。
2. `artifacts/plan.json` 这类绝对/受保护路径曾被拒（`artifact_write args are invalid at path`），
   属模型侧措辞问题，已由契约里的格式说明覆盖，但真实模型仍会先试错几次。
3. `w4-implementation.md` §8.3 的单写者租约两点（被拒调用也取租约；租约只在 Attempt 结束后 TTL 自然过期）仍未关闭。

## 6. 门禁（串行，收尾树）

| 命令 | 结果 |
|---|---|
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0（Prettier 全匹配） |
| `pnpm test:unit` | exit 0 — 78 文件 / 1467 用例（新增 WP-12 W4b 路线投影 + Plan 文档解析/越权校验 3 例） |
| `pnpm test:integration` | exit 0 — 57 文件 / 538 用例（`assessment-dispatch` 的派生授权断言按 §2.1 同步为含 `artifact_write`） |
| `pnpm test:e2e` | exit 0 — 27 checks，PASS 26 / FAIL 0 / UNVERIFIED 1（唯一 UNVERIFIED 为 AC-001 离线固有项），浏览器 18 passed |
| `node scripts/live.mjs --no-write` | **exit 1**：`drill.message-to-stage` 按 §5 判红（`the L2 route did not complete the Requirement: it is active/plan`）；其余 6 条 drill 全 PASS。这是演练断言收紧后的**正确**结果，见 §5 的缺口 |
| `node scripts/acceptance.mjs` | **exit 2 — 94/94，PASS 90 / ACCEPTED 0 / FAIL 4 / MISSING 0**；4 条 FAIL 全部来自这一条真实演练：AC-003/AC-005/AC-069（`drill.message-to-stage`）+ AC-066（其豁免条件 `provider-absent` 不再成立，而 `test:live` 因同一条断言为红）。证据绑定 `sha256:a43f16f9141c…`（HEAD `b9a083f`，356 code files）；内部 `unit 1467 tests 0 failed`、`integration` 0、`test:e2e` 0、`test:live exit 1`。**相对基线的 94/94 只差这 4 条，根因是同一个（§5）。** |

## 7. 验收与边界说明

- 本记录完成时，仓库在 `typecheck`/`lint`/`test:unit`/`test:integration`/`test:e2e` 上是绿的；
  `test:live` 因 §5 的真实缺口而为红，**没有**通过放宽断言或删检查来掩盖。
- 验收的准确口径：**`node scripts/acceptance.mjs` exit 2 — 94/94，PASS 90 / ACCEPTED 0 / FAIL 4 / MISSING 0**。
  相对任务开始时的 `94/94 — PASS 94` 只少 4 条（AC-003/AC-005/AC-069/AC-066），且**同根因**：`drill.message-to-stage`
  已经收紧为「一句话 → Requirement 完成」，而 §5 的集成 `VerificationManifest` 未冻结使最后一步失败；
  AC-066 是**级联**（其 `provider-absent` 豁免在配置了真实 Provider 的前提下失效，而 `test:live` 为红，
  验收据此判 UNVERIFIED 不合规）。这不是新缺口，也不是断言放宽——把 §5 修好后这 4 条会一起转绿。
- `scripts/lib/drill-acs.mjs` 未做任何追加：`drill.message-to-stage` 仍映射 AC-003/AC-005/AC-069，
  断言增强不改变 AC 映射，因此没有新增/删除 AC 行。
- 若要回到 94/94，缺口只有一个（§5 的集成 manifest 冻结）；修好后重跑 §3 的三连跑与
  `node scripts/acceptance.mjs` 即可。

## 8. 本轮运行记录（真实 Provider）

| # | 结果 | 观察 |
|---|---|---|
| 基线 | `drill.message-to-stage` PASS（旧断言） | 链路只到 Develop，见 §1 |
| 1–6 | 逐步暴露并关闭阻塞项 | `artifact_write` 无 Grant（派生授权/roleStages/路径边界三处）、Task 缺失、`planRef.version`、`DRAFT` 空列表、`dataDir` 内 worktree 被保护根拒绝、`environmentRefOf` 未接 |
| 7–15 | 反复定位 | 每个失败都写进控制日志与 `w4b-route-diagnostic.txt`；其中 6 次是**同一根因的不同表现**（阶段间关系未完整表达，§2.4） |
| 16–22 | **五阶段全通** | `planning → develop → review → test → settlement` 各自 `success`，每个阶段一个 Run，路线续跑五次日志齐全；停在 §5 的集成 manifest |
| 收尾 1–3（串行复跑，`AGENTDEV_LIVE_DRILL=message-to-stage`） | exit 1 ×3 | 三次都**先走完五阶段**（`planning→develop→review→test→settlement` 全部 `completed`、同一 Task、路线续跑四条日志齐全），随后**同一条**断言判红：`the L2 route did not complete the Requirement: it is active/plan` |

通过率：**3/3 次都到达五阶段终点，0/3 次完成 Requirement** —— 失败原因单一且稳定（§5 的集成 `VerificationManifest` 未冻结），
不再有随机性的 `needs_input`/`contract_violation`/超时。收尾第 2 次的完整路线（`w4b-route-diagnostic.txt`）：

```text
work 01a0a6b7-ac85-…
  chief/coordinate     running   01a0a6b7-acab-…
  planning/planning    completed 01a0a6b8-2654-…
  backend/develop-L2   completed 01a0a6b8-4443-…  task 01a0a6b8-4440-…  manifest 01a0a6b8-6736-…
  review/review        completed 01a0a6b8-674f-…  同一 task
  test/test            completed 01a0a6b8-9881-…  同一 task
  settlement/settlement completed 01a0a6b8-ea5e-… 同一 task
```

五阶段之后还有若干额外 Run（`develop`/`settlement`/`planning`）：它们是同一 Work 上 `work.retry`/Chief 再次派发的重试，
因为结算被 §5 拒绝而持续；`status=completed` 的那些成功 Run 不改变上面这条链路，但它们是 §5.1「Task 身份/重试」待收敛的证据。

---

## 9. W4c：收掉最后一步（集成复用、Task 身份、Requirement 绑定与幂等结算）

上一节记录的最后一步是：五阶段全部 `success`、`integrate` 成功，但集成候选没有冻结
`VerificationManifest`，结算以 `GATE_NOT_READY: 集成候选 <rev> 没有验证 Manifest，组合尚未通过验证，不能结算` 拒绝，
Requirement 停在 `active/plan`。本节是这一环的定位、修法与真实证据。

### 9.1 诊断：`--keep-temp` + 逐项 diff（先看事实，不猜）

`AGENTDEV_LIVE_DRILL=message-to-stage node scripts/live.mjs --no-write --keep-temp`，然后用
保留的仓库直接比较两个 revision 的完整树：

```text
$ git ls-tree -r --full-tree <task candidate>   # 7 entries
$ git ls-tree -r --full-tree <integration result>  # 10 entries
$ diff <(...) <(...)
0a1,3
> 100644 blob a59c350e…  .agentdev/requirements/01a0a6ca-…/content.md
> 100644 blob 77c4f310…  .agentdev/requirements/01a0a6ca-…/requirement.json
> 100644 blob 1c94571a…  .agentdev/requirements/README.md
```

**差异只有三个 Core 维护的需求池文件**（同一份代码内容 + 需求池/收口文件），不是代码内容不同：

```text
run 3（keep-temp 那次的 integrations 行）：
completed target=e9e9bda6c7e3 candidate=2605e3eba4d2 codeTree=f99a3464e5e0 verificationManifest=null
applied=[backend task] skipped=[]
task manifest: codeTree 29104db4… rev 45d19d6cbb69
```

`integrate.ts` 的复用条件是 `entry.manifest.codeTree === codeTree`，而 `deliveredCodeTreeHash` 当时是
`git ls-tree -r -z --full-tree <rev>` 的整树哈希 —— 交付分支一旦带上需求池，任务候选树与集成结果树
**永远不可能相等**，于是 `reused=[]`、不冻结、结算 fail-closed。也就是说模板条件在它唯一存在意义的场景下不可满足。

### 9.2 文档依据（决定修法，而不是为了让演练变绿）

- `reliability.md` §4：「开发结束冻结 commit 和**完整代码树（含测试、配置、锁文件；排除正式知识和过程目录）**」——
  `codeTree` 是**代码树**，正式知识与过程目录不在其中。
- `reliability.md` §9：「**代码集成只从 Task 增量取授权源码，需求文件由 Core 当前事实维护**」「记录中的
  `codeRevision` 使用已验证候选代码提交」。
- `reliability.md` §4 step 4：「单 Task **代码树**及语义依据完全一致可复用该路线证据并记录 reuse 来源」。
- `requirements.md` §端口：`codeRevision` 引用实际已验证代码提交，`codeTree` 是其代码树 Hash。
- `data.md` line 102：「`PortableRequirement.version` 映射为 `requirement.recordVersion`；**本机行 `version` 独立**
  用于协议 `expectedVersion` 并随本机字段变化递增」。

结论：复用条件应当比较**代码内容**，而不是整棵交付树；`recordVersion` 只能随已发布的池记录变化。

### 9.3 修法

| # | 位置 | 问题 | 修法 |
|---|---|---|---|
| 1 | `packages/core/src/integrate.ts` | 复用条件用整树哈希比较，需求池一存在就永不成立 | 新增 `sameDeliveredCode()`：取两个 revision 的 `ls-tree` 条目，**剔除 Core 维护的路径**（过程目录 `RUNTIME_HOME_DIR` = `.agentdev`，正式知识目录 `project.documentRoot`）后比较；代码确实不同仍然 `reused=[]`，不冻结、结算 fail-closed（复用来源照旧写 `dependencyManifestRefs`，`environmentRef`/`readLedger*`/`configHash` 全部取自被复用的那份真实 manifest，不编造） |
| 2 | `packages/core/src/orchestrator.ts` | `ensureStageTask()` 对**每一次**专业派发都补一行 Task，于是 review/test/settlement 各自多出一行 bookkeeping Task（planRef 是伪造的 `store.newId()`），而 Run 实际绑定的是 Plan 的那一行 | 只在派发**没有** Task 绑定时物化（`draft.taskId === undefined`）：Plan 之前的 Planning 仍需它来铸 Grant，Plan 的 DAG Task 由 `plan.approve` 物化并被后续阶段复用 —— `workflow.md` §3 的「Plan 的 Task DAG 是执行单元」 |
| 3 | `apps/daemon/src/control-handler.ts` | `ensureRequirement` 只写 `requirement.workId`，**不写 `work.requirementId`**；`settleFromIntegration` 用 `integration.requirementId ?? work.requirementId`，于是既有 `Work completed` 又没有任何 Requirement 完成 | 在创建 Requirement 的同一事务里绑定 `work.requirementId`（`data.md` §2 `work.requirementId`、`PRODUCT.md` §3、`workflow.md` §7「只有存在 requirementId 时更新」） |
| 4 | `scripts/lib/live-harness.mjs` | 演练栈的 `SettlementService` 没有注入 `requirementSaves`（生产 `bootstrap.ts` 有），于是完成只翻 SQLite 投影、**不提交池记录**（`protocol.md` §8）；同时补上与生产一致的 `lock` | 先建 `requirementSaves` 再建 `settlement`，两者共用 `lock`；`runL2Drill` 也改为**真实提交**它的 Requirement（`requirementSaves.save({kind:'create'})`），不再是手插一行 |
| 5 | `apps/daemon/src/tool-handler.ts` | Work 级单写者租约对**任何**工具调用都取（含只读的 Chief 读文件），Chief 还在流式输出时其子 Run 的第一次 `artifact_write` 就拿到 `BUSY: … this Attempt holds no writer lease`，真实模型于是报 `needs_input` | 只有持有 `edit` 的角色（backend/frontend/settlement，`agents.md` §1）才取该租约；只读角色不写工作树。`reliability.md` §3 的「单 writer」对**会写**的角色逐字保留（既有两个 backend Attempt 争租约的测试仍 `BUSY`） |
| 6 | `packages/core/src/gates.ts` | `linkRequirementPlan` 把**已提交**的 `recordVersion` 本地 +1（data.md line 102 说它映射 `PortableRequirement.version`），使下一次池保存的 `expected.recordVersion` 前提必然失败 → 完成记录写不进 Git | 只写本地 `planRef`/`phase`，`recordVersion` 留给发布该记录的池保存（本机行 `version` 自己会前进）。`packages/core/test/gates.test.ts` 的对应断言同步为「`recordVersion` 仍为已提交版本 1」并注明依据 |
| 7 | `packages/core/src/orchestrator.ts` + `apps/daemon/src/control-handler.ts` + `apps/daemon/src/protocol.ts` | 路线由 Chief（还活着，被路线句唤醒）与 Core（`continueDeliveryRoute`）**同时**触发时，Settle 阶段会派两个 Run，第二个在 Work 已完成后又集成/结算一次 → 第二条 `settlement.completed`、第二个 revision | ① 终态 Work（`completed`/`cancelled`/`failed`）拒绝新 Run（`workflow.md` §5.1）；② 非 `running` Work 的 Settle 阶段结果**只记录不再集成**（与写门禁同一 barrier）；③ `continueDeliveryRoute` 对该角色已有未终态 Run 时不再排第二个（`workflow.md` §3 的路线对两个触发者是同一条） |

### 9.4 新增测试（把这条语义钉住）

`packages/core/test/integrate.integration.test.ts`：

- **reuses the verified Task evidence when only the Core-maintained pool was added (WP-12 W4c)**：
  交付分支先在 Task 候选之后多一个 Core 的池提交 → 集成仍 `verificationManifestId !== null`，
  冻结 manifest 的 `codeRevision`/`codeTree` 绑定**集成候选**，`dependencyManifestRefs` 记录被复用的 Task manifest，
  结算后 Requirement `completed`。
- **freezes no integration manifest when the combination really is unverified code**（fail-closed 反证）：
  交付分支多一个真正改代码的提交 → `verificationManifestId === null`，结算 `GATE_NOT_READY`，Requirement 保持 `active`。

`packages/core/test/orchestrator.test.ts`、`packages/core/test/gates.test.ts`：路线投影/Plan 文档解析与 `recordVersion` 语义。

### 9.5 真实 Provider 证据（收尾树，串行）

三次完整 `node scripts/live.mjs --no-write`（全部 7 条检查）：

| # | 结果 | `drill.message-to-stage` 链路 |
|---|---|---|
| 1 | **exit 0，7/7 PASS** | `planning:success → develop(backend):success → review:success → test:success → settlement:success`，五个阶段各自一个 Run；Plan 由 Planning Run 交付并被真 Gate 自动批准；`Requirement completed at 6a235f66b1d3`（`recordVersion 2`，池记录 `.agentdev/requirements/01a0a725-3550-…`）；`CompletionManifest 424e8a31210d` |
| 2 | **exit 0，7/7 PASS** | 同上；`Requirement completed at 85ca92a25e78`，`CompletionManifest 69d1867d6ada` |
| 3 | **exit 0，7/7 PASS** | 同上；`Requirement completed at 23fbd5e88c23`，`CompletionManifest 2e06eaf9a863` |

另外同一代码下先做过 3 次只跑该 drill 的串行复跑（`AGENTDEV_LIVE_DRILL=message-to-stage`），也全部 exit 0；
两次运行的路线记录（`w4b-route-diagnostic.txt` 同格式）显示 `requirement saves` 为
`rv=1`（create）+ `rv=2`（completion）两条 **completed** 提交，即完成记录真的进了池，而不只是 SQLite 投影：

```text
requirements: ["01a0a71e-… completed/undefined rv=2 rev=1dfa60bf386c final=d6fb7947-…"]
requirement saves: ["completed head=fbf3c08b2ed6 candidate=24c818a7f579 rv=1 updated=true",
                    "completed head=490f52cfb881 candidate=1dfa60bf386c rv=2 updated=true"]
integrations: ["completed target=24c818a7f579 candidate=490f52cfb881 codeTree=fb08cca76e41 verificationManifest=01a0a71f-… applied=[backend task] skipped=[]"]
```

### 9.6 反证：非成功交付仍然判红（本轮重新执行）

把离线桩 `scripts/lib/e2e-stack.mjs` 的 R32 `stage_yield.status` 由 `success` 临时改成 `needs_input`：

```text
FAIL  chief.message-to-stage  [AC-003,AC-005,AC-068,AC-069]
      stage.completed was not emitted for the professional Run
e2e: 17 checks — PASS 16 / FAIL 1 / UNVERIFIED 0
e2e: FAILED at chief.message-to-stage（exit 1）
```

改回 `success` 后 `pnpm test:e2e` 立即恢复 `27 checks — PASS 26 / FAIL 0 / UNVERIFIED 1`、exit 0。
真实演练一侧同样保留：`awaitSuccessfulStage()` 对任何非 `success` 交付直接抛错（§4），
本轮第 22 次运行前的多次 `needs_input` 都真的把演练判红。

### 9.7 门禁（串行，收尾树）

| 命令 | 结果 |
|---|---|
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0（Prettier 全匹配） |
| `pnpm test:unit` | exit 0 — 78 文件 / 1467 用例 |
| `pnpm test:integration` | exit 0 — 57 文件 / 540 用例（含 §9.4 新增 2 例） |
| `pnpm test:e2e` | exit 0 — 27 checks，PASS 26 / FAIL 0 / UNVERIFIED 1 |
| `node scripts/live.mjs --no-write` ×3 | **exit 0 ×3，每次 7/7 PASS**（§9.5） |
| `node scripts/acceptance.mjs` | **exit 0 — 94/94，PASS 94 / ACCEPTED 0 / FAIL 0 / MISSING 0**；`acceptance: OK`。证据绑定 `sha256:ee90ad4f4fd5…`（HEAD `b9a083f`，356 code files）；内部 `unit 1467 / 0 failed`、`integration 540 / 0 failed`、`pnpm test:e2e exit 0 (84.8s)`、`pnpm test:live exit 0 (148.9s)` |

`scripts/lib/drill-acs.mjs` 未改动（AC 映射与基线一致，故回到 PASS 94）。

### 9.8 仍未关闭（不阻断本次完成）

1. **重复阶段派发**：Chief 与 Core 现在都会按路线推进；§9.3-⑦ 已使「第二个 Settle 不再集成」并阻止重复排队，
   但被 Chief 重复派出的那个 Run 仍会跑完（浪费预算）。彻底做法是让路线推进只有一个触发者（Core 作为唯一调度者，
   Chief 只宣告意图），需要产品决定。
2. **Test 阶段无法执行验收命令**：`ROLE_BROKER_TOOLS.test` 无 shell（`execution.md` §7），
   `policy.testCommands` 默认为空，`TestEnvironmentManager` 未接线。因此 Test 的 `success` 目前依赖模型的静态判断
   （本轮 3/3 都给出 success，但这是模型裁量，不是系统保证）。选项：① 给 Test 一个受限 shell + 隔离环境；
   ② Core 执行配置的 `testCommands` 并作为客观证据注入 Test；③ 把 Test 记为 `not_covered` 并走用户风险处置。
   这是「一句话 → 完成交付」在 L2 代码上最后一个真正的产品决定。
3. **单写者租约的两点底层问题**（`w4-implementation.md` §8.3）：被拒调用也会取租约；租约只在 Attempt 结束后
   TTL 自然过期而非立即释放。§9.3-⑤ 缩小了取租约的角色范围，但这两点仍未关闭。
4. **`CompletionManifest.finalRevision` 与完成提交**：manifest 在集成候选上冻结，池完成提交位于其之上
   （`reliability.md` §9 说清单绑定「最终 Revision」）。当前实现下 `completion.codeRevision` 正确指向已验证候选，
   而 `finalRevision` 指向集成候选；若按 §9 字面收紧，需要在完成提交之后再冻结清单——涉及 `settle()` 的顺序，
   超出本轮范围，登记待裁决。
5. **`pnpm test:integration` 的两条既有负载敏感用例**（`broker.integration.test.ts` 容器读、
   `protocol.integration.test.ts` AC-054 重放抖动）仍不由本改动引入、也未在本轮翻转。
