# WP-06 实现记录（分级交付与独立验证）

- planVersion: 1（`.agentdev/work/WP-06/plan.md`）
- 依赖：WP-02（`f9b61e0`）、WP-05（结算 `681450d`，代码树 `0e047ab`）
- 实现位置：`packages/domain/src/delivery.ts`、`packages/core/src/{gates,decisions,findings,requirement-continue}.ts`

## T1 交付规则（domain，纯函数）

`packages/domain/src/delivery.ts`（复用既有 routing/dispatch 的 `L1_BOUNDS`、lockdown 词表、`canAllocateBudget`/`canStartRepair`，不重复定义）：

- **L1 资格与边界（AC-007/008/009）**：`evaluateL1Eligibility`/`classifyChange`/`l1CriteriaOf`/`lockdownRiskOf`；≤3 文件、≤20 行、无逻辑改动；一字符改动若触及权限/金额/接口即为 **L3**（lockdown），行数再多也不降级，且记录为 L3 后不得回退 L1；未识别的风险旗标 fail-closed 归 L3。
- **等级升级（AC-009）**：`evaluateLevelUpgrade` 在 Diff 超界或出现逻辑改动时升级 L2/L3、同一 Work 关联 Requirement、标记旧 Plan `stalePlan:true`、要求补齐新 Gate；降级一律拒绝（`ok:false`）。
- **阶段链与路线（AC-010/011/012）**：`STAGE_ORDER`/`stageOrderFor`/`documentRouteRules`/`evaluateStageChain`；L2 = Plan→Develop→Review→Test→Settlement（每阶段一个有效 Manifest 且依赖前一阶段）；L3 另需显式授权、回退计划、逐项审核与恢复演练证据；document 路线 = Product→Planning→Review→Settlement（`codeTestStage:false`、`developmentRequirement:false`、候选 Diff、独立 Review）。
- **Gate（AC-013/014）**：`evaluateWriteGate` 对无 Plan/未批准/别的 revision/Plan Hash 变化/源码 Hash 变化一律 `GATE_NOT_READY` 并返回前后源码 Hash；`evaluatePlanApproval` 对合规 Plan（授权、revision、范围内目标、预算、无产品变化）自动批准并给出依据（planId/version/hash/revision/work/approvedBy/authorizationRef/at）。
- **Decision（AC-015/016）**：`evaluateBehaviourChoice`/`requirementStateForChoice`/`invalidateEvidenceForChoice`；now ⇒ 新 Product/Plan + 明确列出失效证据（受影响路径/引用），later ⇒ Queued Requirement 且当前验收不变，decline ⇒ 记录原因且验收不变。
- **Finding（AC-017/018/019/083）**：`evaluateFindingRouting`/`findingCanBeVerified`/`evaluateFindingClosure`/`findingBlocksCompletion`/`bindFindingTarget`；Review Finding 直接退回开发并需新独立 Review+Test、旧结果失效；Developer 不得自证；`blocked` 不完成、`not_covered` 需逐条风险处置；无 taskId 的 Finding 绑定 Review 目标/Manifest。
- **预算（AC-022）**：`canReserveBudget`/`evaluateReworkAllowance`；超额原子拒绝（`budgetAfter` 不变、`requiresUserTopUp:true`）、用户加额后才可继续，返工额度用尽拒绝。
- 测试：`packages/domain/test/delivery.test.ts`（34 例，含五项必需失败测试的 domain 级形态）。

## T2 Gate/Plan/Decision 持久化（core）

- `packages/core/src/gates.ts`：`PlanGateService`。Plan 以 `artifact(kind=plan)` 持久化（可重读、可校验），批准/失效记录以不可变 `snapshot(type=verification)` 追加（批准人/依据/scope/revision/Product 版本），版本声明用 `snapshot(type=context)`，失效证据记录用 `snapshot(type=config)`，payload 带 `kind` 判别；**不新增表**。
  - `submitPlan` 走 `evaluatePlanApproval` 自动批准并存证；`requestCodeWrite` 从**已持久化**的批准构造 `evaluateWriteGate` 输入，无批准/被取代（`stalePlan`）/Product 已前进/目标越界 ⇒ `GATE_NOT_READY`，且用 `SourceHashPort`（`StoreSourceHashPort`）在决策前后测量内容 Hash 与全表行数，拒绝时零写入、零事件。
  - `upgradeLevel` 应用 `evaluateLevelUpgrade`：升级 + 同 Work Requirement 关联 + 旧 Plan 失效（`plan_stale` 追加，不篡改历史）；`getCurrentPlanApproval`/`getWorkLevel`/`readPlanContent`/`invalidatePlanForProductChange`。
- `packages/core/src/decisions.ts`：`DecisionService.recordBehaviourDecision`（now/later/decline 三分支）、`getDecisionRecord`/`getInvalidatedEvidence`/`getCurrentProductVersion`/`getCurrentPlanVersion`；版本单调不回退（Plan 版本取 Work Plan 链 ∪ Requirement `planRef` ∪ 声明）。
- 测试：`gates.test.ts`（6 例）、`decisions.test.ts`（5 例），真实 SQLite。

## T3 Finding、暂停/取消与需求继续（core）

- `packages/core/src/findings.ts`：`FindingService`。
  - `submitFinding`：经 domain `bindFindingTarget` 绑定 Review/Test Run + Manifest（无 taskId 的 integration/document 目标可用；`task` 目标缺 taskId ⇒ `VALIDATION_ERROR`；外来 task ⇒ `NOT_AUTHORIZED`；Developer Run 不得提 Finding），冻结哈希寻址的绑定证据；退回开发时把该 Work 所有有效 review/test 产物标 `invalid` 并把受影响 Task 重开为 `develop`。
  - `markAddressed`（实现/文档角色 + 完成修复的 Run）与 `verifyFinding`：独立性由持久化状态推导（同 Work、角色正确、`completed`、非修复 Run、非提 Finding 的 Review、创建时间晚于修复），结论交由 domain `evaluateFindingClosure`；Developer 自证 `NOT_AUTHORIZED`，旧/提 Finding 的 Review 或错误角色 `GATE_NOT_READY`；只有新的独立 Review **与** Test 才 `verified`；`acceptFindingRisk` 需同 Work 的真实已接受 risk Decision。
  - `completeWork`：`blocked` 永不完成、每个 `not_covered` 需已接受的风险处置、未关闭的阻塞 Finding 阻止完成；通过后才 running→completed。
  - `pauseWork` 先规划整个安全点（`recovery_required` 的 Run ⇒ `RECOVERY_REQUIRED` 且无部分状态）、经 `WORK_TRANSITIONS` 到 `paused`、Run 置 `paused`/`interrupted`、停止活动 Attempt、写 per-Run Checkpoint 与 `work_pause` 屏障；`writeAdmission(runId)` 使屏障可观测。`resumeWork` 校验 Work 版本、屏障记录版本（暂停期间变更 ⇒ `VERSION_CONFLICT`）与调用方 Task 版本，然后为每个暂停 Run 开新 Attempt（epoch/number 递增）或用 `RunLifecycle.beginAttempt`。
  - `cancelWork`：进入 `cancelling`，经 `RunLifecycle.cancel` 级联整棵 Run 树，停止 Attempt，保留全部产物（`valid`、`integrated:false`），落 `cancelled`；副作用未知时停在 `blocked(recovery)` 并留待用户 `recovery` Decision，`resolveCancellation` 支持 resume/accept_cancel/abandon。
- `packages/core/src/requirement-continue.ts`：`RequirementContinuation.listContinuable()` 纯投影读（不建 Work/Run/事件）；`continueRequirement` 拒绝非 active 或已有本地 Work 的记录，创建本地 Work + 预算 + 本地 Authorization、关联 Requirement（`local`、phase `product`、recordVersion+1），返回未满足 Gate（不重用旧 Manifest/验证）。
- 测试：`findings.test.ts`（19 例）、`requirement-continue.test.ts`（4 例），真实 SQLite。

## T4 端到端集成与必需失败测试

- `packages/core/test/delivery.integration.test.ts`（8 例，`*.integration.test.ts`）：L1 错字全链到 CompletionManifest + 契约 CAS 桩（无 Planning/Test Run、无看板/Requirement 建单）；L2 阶段链（每阶段复核后才进入下一阶段）；document 路线（候选 Diff + 独立 Review + Settlement，无代码测试、无开发 Requirement）；L3 迁移（授权 + 回退 + 逐项审核 + 恢复演练证据，以及缺授权的拒绝）；无 taskId 的 Finding 闭环与 Developer 自证拒绝；暂停→版本校验→新 Attempt；取消级联 parent+child 并保留产物；AC-089 待继续→新 Work + 授权 + 全部 Gate 未满足；L1→L2 升级 stale 旧 Plan 且源码 Hash 不变。
- `packages/core/test/delivery-failures.test.ts`（5 例）：**一字符高风险**、**超 L1 升级**、**过期 Plan**、**修复后证据失效**、**未覆盖阻断**。
- 集成测试使用真实 SQLite 与契约桩（Run 工具/Git 提交按 WP-06 规定为桩，真实接线属 WP-07/WP-08）。

## T5 验证与本轮状态

- 契约命令（本记录时点）：`pnpm typecheck` 0；`pnpm lint` 0；`pnpm test:unit` **38 文件 / 717 用例**；`pnpm build` **10 workspace**；`pnpm docs:check` ok。
- `pnpm test:integration`：**Docker 守护进程不可用**（`docker info` 失败），2 个 CLI 文件（container/doctor）3 例失败、9 文件 120 例通过、9 例跳过；本包新增的集成文件已通过。该失败为环境阻塞（此前 Docker 可用时 124/124 全通过），非本包代码问题。
- 已登记残余（供 Review/Test 判定）：
  1. **零新增表**：Gate 批准/失效与版本声明借用不可变 `snapshot` 的 verification/context/config 类型并带 `kind` 判别；新事件名 `delivery.write_admitted`、`delivery.level_upgraded`（`protocol.md` §7 未定义 gate 事件）。
  2. `upgradeLevel` 需要调用方提供已批准的新 Plan；「先升级再提交新 Plan」的两阶段流程属契约决策，本轮未改动。
  3. `writeAdmission` 已实现并测试，但尚未接入 Broker/工具准入（WP-07）；暂停屏障当前由持久化 Run/Work 状态保证（`StageGate.submit` 已拒绝非 running）。
  4. Finding 验证独立性锚定在 Run 身份 + 创建顺序（schema 尚无 VerificationManifest 行）；WP-08 落库后应追加 dependencyRevision/codeRevision 相等检查。
  5. `completeWork` 不含集成/CAS/最终 Settlement/CompletionManifest（WP-08）；`cancelWork` 的 Git 侧 `cancellation` 记录与索引提交属 WP-08。
  6. 暂停/取消停止 Attempt 行并关闭 Run 树，但不撤销在线 Grant、不 SIGTERM 工具进程树（WP-07）。
  7. `continueRequirement` 只置 phase=product 并返回未满足 Gate，不自行重建 ProductDefinition/Plan（由 Chief 下一次分派完成）。
  8. 宿主 Docker 守护进程不可用导致容器型集成用例无法验证（环境；WP-07 需要时再复验）。
