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

## T6 Review 第 1 轮修复（W6R1-01…W6R1-10）

Review 判定：`FAIL`（2 × P1 + 4 × P2 + 4 × P3）。本节逐条记录修复内容、回归测试与验证数字；除下列条目外未改动其他包。

### W6R1-01 [P1] 独立验证必须绑定被验证 Revision 与 Test 结论

- **变更**：`packages/domain/src/delivery.ts` 的 `VerificationRun` 增加 `revision`（该 Run 自身证据冻结的 Revision）与真实 `status`（`CheckStatus`，不再由 `completed` 推断）；`FindingVerificationInput`/`FindingClosureInput` 增加 `fixingRevision`。`findingCanBeVerified` 在 `addressed` 路径上：无 `fixingRevision` ⇒ `GATE_NOT_READY`；Review 与 Test 的 `revision` 必须等于 `fixingRevision`；Test 必须带 `status='passed'`。`packages/core/src/findings.ts` 的 `verifyFinding` 从**修复 Run 自己的产物**（`Artifact.sourceRevision`，回退 `VerificationManifest.codeRevision`）推导 `fixingRevision`，并由 `verificationRunOf` 逐 Run 读取其 Revision 与结论；`finding_verification` 快照新增 `fixingRevision`/`reviewRevision`/`testRunConclusion`。
- **回归测试**：`packages/core/test/findings.test.ts`「refuses a pre-fix revision and a non-passed Test conclusion even when the Runs are new」（旧行为：Run 新且顺序在后即视为独立 ⇒ `ok:true`，且 `completed` 折算 `passed`）；`packages/domain/test/delivery.test.ts`「binds the verification to the fixing revision and the real Test conclusion」。
- **说明**：「或更晚的 Revision」以**严格相等**实现：服务端没有 Revision 全序，唯一另一个锚点（`work.baseRevision`）在多数路径上仍是修复前 Revision，接受它会重新打开本 Finding 描述的漏洞；因此只接受修复 Run 冻结的那一个 Revision。

### W6R1-02 [P1] `completeWork` 不得接受自述 Test 结果

- **变更**：`CompleteWorkInput` 删除 `testResult`（同时删除 `TestResultInput` 类型），改为 `testRunId`。`completeTx` 经新私有方法 `completionEvidence` 读取**持久化证据**：Test Run 必须存在、属于同一 Work、`role='test'`、`completed`，其最新 `stage_result.checkResult` 提供状态与 uncovered，Revision 必须等于 `work.baseRevision`，环境引用来自冻结 `VerificationManifest` 或 CheckResult 的 check 条目，缺失即 `GATE_NOT_READY`。`not_covered` 风险处置与 `blocked` 阻断规则原样保留；`delivery.work_completed` 事件新增 `testRunId`/`testEvidenceRevision`/`testEnvironmentRef`。
- **回归测试**：`findings.test.ts`「never completes on a blocked Test result and never on a caller-asserted one」（无 Test Run / 异 Work / 非 test 角色 / 无 CheckResult 均拒绝且零写入）与「refuses a Test evidence bound to another revision or without an environment」；`delivery-failures.test.ts` 的**未覆盖阻断**改用持久化 Test Run。
- **说明**：由 `TestResultInput` 改为 `testRunId` 是本条的接口破坏性修复；所有旧调用点（本包测试 + 集成测试）已改写为真实证据。

### W6R1-03 [P2] `evaluatePlanApproval` 的 `tokensUsed` 归零

- **变更**：`PlanApprovalInput.budget` 增加必填 `used`；`evaluatePlanApproval` 以 `canAllocateBudget(used + reserved + requested <= limit)` 判定；运行时对缺失/非法 `used` **fail-closed**：保留 `reserved + requested` 已超限 ⇒ `BUDGET_EXCEEDED`，否则 `VALIDATION_ERROR`（绝不静默按 0 处理）。`packages/core/src/gates.ts` 的 `submitPlanTx` 传入真实 `budget.tokensUsed`。
- **回归测试**：`packages/domain/test/delivery.test.ts`「refuses an over-used budget instead of assuming a zero usage」（`used 60 + reserved 30 + 50 > 100` ⇒ `BUDGET_EXCEEDED`；缺 `used` ⇒ `VALIDATION_ERROR`；`used 10` 时同请求通过）；`packages/core/test/gates.test.ts`「refuses a Plan whose reservation exceeds the budget once real usage counts」（真实库存 `used 95000 + reserved 4000`，`requestedTokens: 2000` ⇒ `BUDGET_EXCEEDED` 且零落库）。

### W6R1-04 [P2] 文档路线的 Review 被强制要求代码 Revision 与验证环境

- **变更**：`stageEvidenceGaps(stage, manifest, route)` 变为 route-aware：`route==='document'` 时不再要求 `codeRevision`/`environmentRef`，改为要求 Review 阶段必须给出**被审候选 Diff** 证据（`diff`/`candidate`）；code/operation 路线保持原有要求。
- **回归测试**：`packages/domain/test/delivery.test.ts`「accepts a document chain that binds no code revision or environment」（不带 `codeRevision`/`environmentRef` 的 Product→Planning→Review→Settlement ⇒ `ok:true`；Review 缺候选 Diff 证据 ⇒ `VALIDATION_ERROR`；code 路线同形 Manifest 仍被拒）。
- **修正后的测试期望**：`packages/core/test/delivery.integration.test.ts` 的 `stageView()` 原先给**每个阶段**注入 `codeRevision`/`environmentRef`（`delivery.integration.test.ts:550-567`），从而掩盖了该缺口；现已改为按 `route` 生成——document 阶段**不含**这两个字段，并由 Review 的 `evidence` 给出候选 Diff。该测试现在断言真实规则：文档链在不带代码 Revision/环境时通过，且缺候选 Diff 证据被拒。

### W6R1-05 [P2] 授权撤销后仍可准入写

- **变更**：`requestCodeWrite` 在批准记录之外新增 `writeAuthorization`：重读 `authorization` 行（缺失/异 Work/`revokedAt` ⇒ `NOT_AUTHORIZED`），并复核批准记录中的 Plan 写路径与 operations 仍在当前信封内（收窄后不再覆盖 ⇒ `NOT_AUTHORIZED`）。拒绝路径沿用既有零写入结构。
- **回归测试**：`packages/core/test/gates.test.ts`「re-reads the authorization at write time and refuses a revoked envelope」（批准后撤销 ⇒ `NOT_AUTHORIZED`、无 `delivery.write_admitted` 事件、`port.snapshot` digest 不变）。

### W6R1-06 [P2] `upgradeLevel` 需区分三种结果

- **变更**：domain `evaluateLevelUpgrade` 增加判别字段 `outcome: 'noop' | 'upgrade' | 'downgrade_refused'`；拒绝降级时 `stalePlan:false`（级别未变，当前 Plan 仍有效）。Core `upgradeLevelTx` 改为按 `outcome` 分支：`noop` ⇒ 立即返回且**零写入**；`downgrade_refused` ⇒ `STALE_ARTIFACT` 且**不追加 `plan_stale`、不 invalidate、不更新 Work/不写事件**；仅 `outcome==='upgrade'` 才走晋升路径。前置失败（替换 Plan 未批准）返回 `outcome:'refused'`。
- **回归测试**：`gates.test.ts`「distinguishes a no-op from a real upgrade and touches nothing on a no-op」（无 `delivery.level_upgraded` 事件、`snapshot` 行数不变、两 Plan 仍 `valid`、digest 不变）与「refuses a downgrade without invalidating the still-valid Plan」（L3 Work + L1 diff ⇒ `outcome:'downgrade_refused'`、旧 Plan 仍 `valid`、批准状态仍 `approved`、零事件、digest 不变）；domain 侧在既有降级/无操作用例中补齐 `outcome` 与 `stalePlan:false` 断言。

### W6R1-07 [P3] 写 Gate 的源码 Hash 恒等

- **变更**：`SubmitPlanInput.sourceHashPort` 在批准时测量并写入批准记录 `sourceHash`；`RequestCodeWriteInput.expectedSourceHash` 允许调用方给出写前测量。准入时 `expected = 调用方期望 ?? 批准记录 sourceHash`，与当前 `contentHashOf(work)` 比较——两侧不再是同一次测量，源码移动可被拒绝。
- **回归测试**：`gates.test.ts`「compares the approval source hash with the live measurement」（可控 `SourceHashPort`：批准后源码移动 ⇒ `GATE_NOT_READY` + `source hash changed`；调用方期望不符同样拒绝；期望一致则放行）。

### W6R1-08 [P3] `completed` 一律折算 `passed`

- **变更**：与 W6R1-01 同批。`verificationRunOf` 从持久化 `CheckResult` 取真实结论：Test 无结论 ⇒ `blocked`（绝不 `passed`），Review 无结论则为「无结论」；`runIsIndependent` 只接受 `passed`。
- **回归测试**：同 W6R1-01（`failed`/`not_covered`/`blocked`/无结论全部拒绝）。

### W6R1-09 [P3] 恢复窗口内的新 Attempt 未就绪

- **变更**：`resumeTx` 对 paused Run 改为**先开 Attempt（`starting`）再置 Run `running`**（`run.started` 事件随后以新版本追加）。`writeAdmission` 在 Run `running` 之外新增「存在 `running`（ready）Attempt」条件；`starting` 的 Attempt 不予准入。
- **回归测试**：`findings.test.ts` 暂停/恢复用例与 `delivery.integration.test.ts` 同名流程均断言：恢复后 Attempt 为 `starting` ⇒ `writeAdmission` 拒绝（reason 含 `ready Attempt`），将该 Attempt 置 `running` 后才准入。

### W6R1-10 [P3] `isWithinScope` 目录前缀分支不可达

- **变更**：判定不改语义，改为**显式记录边界**：`repoPathSchema` 拒绝尾 `/`（空 segment），因此 Core 侧目录授权只能以精确路径表达，`target.endsWith('/')` 分支只对域级原始字符串可达；注释中写明若要目录覆盖必须引入 schema 合法语法（如 `packages/core/src/**`）并同步 `data.md`。
- **回归测试**：`delivery.test.ts` 补充 `isWithinScope('packages/core/src/a.ts', ['packages/core/src']) === false`、`srcX` 不被误准入、精确路径命中——把「只能精确匹配」这一边界钉住（本条为文档化边界，旧行为本就是拒绝，回归测试固定现状而非行为变更）。

### 验证数字（本轮，全部为原始命令结果）

| 命令 | 原始结果 | 结论 |
|---|---|---|
| `node_modules/.bin/prettier --write <files>` | 全部文件格式化完成（`delivery.test.ts`/`gates.test.ts`/`delivery-failures.test.ts` 有改动，其余 unchanged） | 通过 |
| `pnpm typecheck` | `tsc -p tsconfig.json --pretty false`，无输出（exit 0） | 通过 |
| `pnpm lint` | `Checking formatting... All matched files use Prettier code style!` | 通过 |
| `pnpm test:unit` | `Test Files 38 passed (38)` / `Tests 727 passed (727)` / 9.73s | 通过（较 T5 的 717 增加 10 个回归用例） |
| `pnpm test:integration` | `Test Files 11 passed (11)` / `Tests 132 passed (132)` / 15.01s；其中 `packages/core/test/delivery.integration.test.ts (8 tests)` 通过，`apps/cli` 的 doctor/container 两个 Docker 文件本次也通过 | 通过（本次运行 Docker 守护进程可用，与 T5 的环境阻塞不同） |
| `pnpm build` | contracts/pi-runtime/domain/knowledge/storage/workspace/core/cli/daemon/runner 共 **10 workspace** 全 `Done` | 通过 |
| `pnpm docs:check` | `docs:check ok — 15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages` | 通过 |

### T6 残余（供独立 Review/Test 判定）

1. **「或更晚的 Revision」未实现为偏序**：验证只接受与修复 Run 冻结 Revision 相等（见 W6R1-01）。若后续引入 Revision 祖先关系（Git `merge-base`/`is-ancestor`），可放宽为「修复 Revision 的后代」，但仍不得接受修复前 Revision。
2. **`completeWork` 未做集成分解/最终 Settlement/CompletionManifest**（WP-08）；Work 预算 `used+reserved<=limit` 的完成前复核未新增（W6R1-02 只要求 Test 证据；`evaluatePlanApproval` 的预算门禁已按 W6R1-03 修复）。
3. **`writeAdmission` 的 Attempt 就绪判定**以 `attempt.status='running'` 为准；Runner 侧的 ready 确认（epoch/进程/环境）仍属 WP-05/WP-07，`StageGate.submit` 目前仍接受 `starting` Attempt（不在本包文件范围）。
4. **operation 路线的阶段证据**仍沿用 code 路线的 `codeRevision`/`environmentRef` 要求：本 Finding 只要求文档路线 route-aware，operation 路线的证据模型属后续工作包。
5. `requestCodeWrite` 的授权复核覆盖 Plan 写路径/operations 与信封的交集；Grant（`grant` 行）与 Broker/工具级准入仍属 WP-07。

## T7 Review 第 2 轮修复（W6R2-01…W6R2-10）

Review 判定：`FAIL`（1 × P1 + 7 × P2 + 2 × P3）。本轮按要求**先引入共享原语**，再逐条修复；除 `packages/domain/src/delivery.ts`、`packages/core/src/{gates,findings}.ts`、其测试文件与本记录外未改动其他包（`decisions.ts`/`requirement-continue.ts` 无本轮 Finding，未改动）。

### 新增共享原语：证据有效性与 Revision 血缘（W6R2-01/03/04/05 的共同基础）

`packages/domain/src/delivery.ts` 新增（`docs/rules/workflow.md` §6/§7、AC-017/AC-019）：

- 类型：`EvidenceValidity`（`valid`/`invalid`/`superseded`）、`RevisionEvidence`（ref/kind/validity/revision/createdAt）、`EvidenceLineage`（workRevision/fixingRevision/invalidatedRevisions/producedAfter）、`EvidenceValidityCode`、`EvidenceValidityDecision`。
- 函数：`evaluateEvidenceValidity({ evidence, lineage })` 与布尔形式 `evidenceBindsRevision(...)`（`evidenceBindsRevision` 只调用同一判定，不是第二套规则）。
- **规则（代码注释逐条写明；按序命中即拒）**：
  1. `evidence.validity !== 'valid'` ⇒ `INVALIDATED`（Finding/Decision 失效的产物永不复用，AC-017）；
  2. 未冻结 Revision ⇒ `NO_REVISION`；
  3. `lineage.invalidatedRevisions` 含该 Revision ⇒ `INVALIDATED`；
  4. `lineage.workRevision` 缺失 ⇒ `REVISION_UNBOUND`（**fail-closed**，W6R2-04）；
  5. `lineage.fixingRevision` 存在且不等于证据 Revision ⇒ `PRE_FIX_REVISION`（W6R2-01/03）；
  6. `evidence.revision !== lineage.workRevision` ⇒ `REVISION_MISMATCH`（候选树必须就是被验证树）；
  7. `lineage.producedAfter` 存在且 `createdAt <= producedAfter` ⇒ `PRODUCED_BEFORE_FIX`（早于修复执行的证据即使 Revision 相同也不算）；
  8. 其余为 `VALID`。
- **消费点（三处全部改为只走它）**：完成门禁（core `completionEvidence`）、Finding 关闭（domain `runIsIndependent`/`findingCanBeVerified`、core `verificationRunOf` 提供 `evidenceValid`）、等级重评（domain `evaluateLevelUpgrade` 的 `planEvidence`）。
- 同批新增两条同为“单一事实来源”的纯规则：`workWriteBarrier(status)`（暂停/取消屏障，W6R2-07 让 `writeAdmission` 与 `requestCodeWrite` 共用）与 `completionEvidenceKindFor(route, level)`（路线/等级的完成证据选择，W6R2-09）。
- 回归测试：`packages/domain/test/delivery.test.ts` 新增 `evidence validity and revision lineage`（6 例，逐条钉住上述 7 条判定）与 `level re-evaluation consults the evidence rule`（1 例）。

### W6R2-01 [P1] 被 Finding 失效的修复前 Test 证据仍可完成 Work

- **变更**：① `packages/core/src/findings.ts` 的 `completionEvidence` 不再只看 `revision === work.baseRevision`：`Run` 的**证据**（最新冻结 Revision 的 artifact，或 stage result 命名的冻结 `VerificationManifest`）先过 `evaluateEvidenceValidity`（有效性 + Revision + 血缘）；② `markAddressed` 读取修复 Run 自己的证据 Revision 并把 `work.baseRevision` **推进**到该 Revision（同事务，写 `finding_addressed` 血缘快照，含 `previousBaseRevision`/`baseRevision`/`fixEvidenceAt`），因此修复前证据再也无法满足 Revision 绑定；③ `latestFixRecord` 提供 `producedAfter`，早于修复执行的证据即使 Revision 相同也拒绝。
- **回归测试**：`packages/core/test/findings.test.ts`「never completes on Test evidence a Finding invalidated and advances the revision on the fix」（旧行为：`ok:true` + `delivery.work_completed`；现在失效证据 ⇒ `GATE_NOT_READY`「invalid」、零完成事件、`baseRevision` 由 `REVISION` 推进到 `FIX_REVISION`，修复后新 Test 才完成）。

### W6R2-02 [P2] 调用方 `expectedSourceHash` 可覆盖批准记录 Hash

- **变更**：`packages/core/src/gates.ts` 的 `requestCodeWrite` 把批准记录的 `sourceHash` 作为**无条件**期望（缺失即 fail-closed 拒绝），调用方期望改走 `WriteGateInput.callerExpectedSourceHash` —— 只能是**追加**条件，永远不能替换批准记录的比较；domain `evaluateWriteGate` 对两者分别判定。
- **回归测试**：`packages/core/test/gates.test.ts`「never lets a caller expectation replace the approved source hash」（旧行为：源码移动后把移动后的值当期望即 `allowed:true`；现在 `GATE_NOT_READY`、零 `delivery.write_admitted` 事件、digest 不变）；domain 测试「never lets a caller expectation replace the approved source hash」覆盖同一规则的纯函数形态。

### W6R2-03 [P2] 修复 Revision 完全取自修复 Run 自述

- **变更**：`markAddressed` 要求修复 Run 冻结了 Revision，且该 Revision **必须不同于** `work.baseRevision`（否则即“修复”声称的正是 Finding 已判失效的树）⇒ `GATE_NOT_READY`；domain `findingCanBeVerified` 新增 `currentWorkRevision`，要求 `fixingRevision === currentWorkRevision`（缺失即拒，fail-closed），core `verifyTx` 传 `work.baseRevision`。
- **回归测试**：`findings.test.ts`「refuses a fix whose Run self-reports the invalidated pre-fix revision」（旧行为：`markAddressed` 成功、整条关闭链锚定修复前 Revision；现在拒绝且 Finding 保持 `open`、`baseRevision` 不变）；domain 侧既有正例全部改为显式传 `currentWorkRevision`。

### W6R2-04 [P2] `work.baseRevision` 缺失时跳过 Revision 绑定

- **变更**：绑定规则回到共享原语 —— `work.baseRevision` 缺失 ⇒ `REVISION_UNBOUND` ⇒ `GATE_NOT_READY`，不再“无 Revision 即放行”。`requirement-continue.ts` 未改动（AC-089 仍允许创建无 `baseRevision` 的 Work），但该 Work 现在**不能完成**，直到有真实 Revision（登记为残余）。
- **回归测试**：`findings.test.ts`「refuses to complete a Work that froze no base revision」（旧行为：任意 Revision 的 Test 都完成 Work；现在 `GATE_NOT_READY` 且 Work 保持 `running`）；domain 判定单测覆盖 `REVISION_UNBOUND`。

### W6R2-05 [P2] 冻结 `VerificationManifest` 回退路径为死分支

- **变更**：`frozenManifestOf` 不再用 UUIDv7 去查 64 位 `snapshot.hash`（该查询恒不可达）。改为扫描 `snapshot(type=verification, kind=verification_manifest)`，按 payload **声明的 `manifestId`** 匹配（`data.md` §3 给 `stage_result.manifest_id` 的 UUIDv7 键空间）——这是唯一调用方实际携带的键空间。`row.hash` 比较已于 W6R3-05 删除：`stage_result.manifest_id` 的契约类型是 `idRefSchema`（UUIDv7），64 位摘要无法通过存储层契约，故 hash 键空间对唯一调用路径不可达。无法解析且 Run 无 artifact 时，`completionEvidence` 以**精确消息**点名该 manifest 并拒绝（不再静默降级为“binds no frozen revision”）。同时新增 `frozenCompletionManifestOf`（`Ref.hash` 是内容摘要，按 hash 键真读）。
- **回归测试**：`findings.test.ts`「binds a Test to its frozen VerificationManifest when the Run produced no artifact」（旧行为：该案 `GATE_NOT_READY`／死分支；现在无 artifact 的 Test 经冻结 Manifest 完成，事件 `testEvidenceRevision`/`testEnvironmentRef` 来自 Manifest）与「fails closed when a stage result names a manifest that is not frozen」（拒绝消息含该 manifest id 与 `no VerificationManifest`）。W6R3-05 的键空间回归见 T8。

### W6R2-06 [P2] Plan 批准不预留 `requestedTokens`，重复批准累计超限

- **变更**：`submitPlanTx` 在批准同一事务内 `tokensReserved += requestedTokens`（`budget.tokensReserved` 参与下一次 `evaluatePlanApproval` 的 `used + reserved + requested <= limit` 判定），并在批准事件中记录 `requestedTokens`/`tokensReserved`；`requestedTokens` 存在但 Work 无预算行 ⇒ fail-closed `GATE_NOT_READY`（不再跳过预算判定）。
- **回归测试**：`gates.test.ts`「reserves the approved tokens so a second Plan cannot exceed the limit」（旧行为：100 限额下两份 60 token Plan 都 `approved:true` 且 `tokensReserved` 仍为 0；现在第一份批准后 `tokensReserved=60`，第二份 `BUDGET_EXCEEDED` 且不写预算，剩余 40 的请求仍批准并预留到 100）。

### W6R2-07 [P2] `requestCodeWrite` 不读 Work 状态

- **变更**：domain 新增 `workWriteBarrier(status)`，`writeAdmission` 与 `requestCodeWrite` 共用同一条暂停/取消屏障规则；`requestCodeWrite` 对 `paused`/`cancelling`/`cancelled` 返回与暂停屏障相同的 fail-closed 代码 `INVALID_STATE`（`CodeWriteRefusalCode` 相应扩展），拒绝零写入。
- **回归测试**：`gates.test.ts`「refuses a code write on a paused or cancelled Work」（旧行为：三种状态均 `allowed:true`；现在 `INVALID_STATE`、digest 不变，回到 `running` 后同一批准 Plan 仍可准入）；domain 测试「refuses writes on paused, cancelling and cancelled Work and nothing else」。

### W6R2-08 [P2] 就绪判定是“任一 Attempt 为 running”

- **变更**：`readyAttemptOf` 取 `number DESC` 的**最新** Attempt，仅当其 `status === 'running'` 才视为就绪；旧 epoch 的 `running` Attempt 不能再为 `starting` 的新 Attempt 放行。
- **回归测试**：`findings.test.ts`「admits a write only when the newest Attempt is ready」（旧行为：Attempt#1 `running` + Attempt#2 `starting` ⇒ `admitted:true`；现在拒绝且 reason 含 `ready Attempt`，把 #2 置 `running` 后才准入）。

### W6R2-09 [P3] `completeWork` 路线无关，L1 无法完成

- **变更**：domain 新增 `completionEvidenceKindFor(route, level)`（按该路线自己的阶段序判定：含 `Test` 阶段的 code L2/L3 用 Test；L1 code、document、operation 用该路线自己的 Review 证据）。`CompleteWorkInput` 增加 `route`/`reviewRunId`/`completionManifestRef`；`completeTx` 对 `review` 证据要求同 Work、`role=review`、`completed`、持久 `stage_result` 为 `success`、artifact 有效且绑定 Work Revision；并**要求冻结的 `CompletionManifest`**（按 hash 读取、校验 schema 与 `workId`、要求 `verifiedManifestIds` 非空），事件记录 `evidenceKind`/`completionManifestHash`/`completionManifestFinalRevision`。未知 route/level ⇒ `VALIDATION_ERROR`。
- **回归测试**：`findings.test.ts`「completes an L1 Work without a Test Run, through its Review and a frozen CompletionManifest」（旧行为：L1 `GATE_NOT_READY`“no Test Run is bound”；现在无 Test 证据也能完成，缺 Review 或缺 CompletionManifest 分别拒绝）与「keeps the document route on its own rule」「refuses an unrecognised route/level instead of guessing a completion rule」；集成侧 `delivery.integration.test.ts` 的 AC-007 L1 链在 CAS 之后**真实调用 `completeWork`** 完成 Work（ReviewCheck 证据 + 冻结完成清单）。

### W6R2-10 [P3] 文档路线“候选 Diff”是子串匹配

- **变更**：`StageManifest` 新增结构化 `candidateDiffRef: Ref`；文档路线 Review 必须绑定该 Ref（id 与 hash 非空），`namesCandidateDiff` 的 `includes('diff')/('candidate')` 子串判定被删除。
- **回归测试**：`packages/domain/test/delivery.test.ts` 的文档链用例改为：绑定 Ref ⇒ `ok:true`；去掉 Ref 但写上 “candidate diff approved” ⇒ `VALIDATION_ERROR`（旧行为：该文本即可通过）；Ref 不完整亦拒绝。集成测试 `delivery.integration.test.ts` 的文档链 Review 改为绑定 Planning 候选 Diff 的真实 artifact Ref。

### 接口变更（调用方需知）

| 位置 | 变更 |
|---|---|
| `CompleteWorkInput` | 新增 `route?`/`reviewRunId?`/`completionManifestRef?`（`testRunId` 语义不变，仅 code L2/L3 必需） |
| `CompleteWorkResult`（成功分支） | 新增 `evidenceKind`/`completionManifestHash` |
| `LevelUpgradeInput` | 新增必填 `workRevision`（等级重评走共享证据规则） |
| `VerificationRun` | 新增必填 `evidenceValid`（省略即视为无效，fail-closed） |
| `FindingVerificationInput`/`FindingClosureInput` | 新增 `currentWorkRevision`（addressed 路径必填） |
| `StageManifest` | 新增 `candidateDiffRef`（文档路线 Review 必填） |
| `CodeWriteRefusalCode` | 新增 `INVALID_STATE`（暂停/取消屏障） |
| `WriteGateInput` | 新增可选 `callerExpectedSourceHash`（追加条件） |

### 修正的旧测试期望（原期望本身有误）

1. `findings.test.ts`「blocks completion while a blocking Finding is open or addressed」原先把**修复后 Revision** 的 Test 证据用于“修复前”的完成尝试，掩盖了 Revision 绑定；现在先建当前 Revision 的 Test 证明“通过 Test 也不能关闭阻塞 Finding”，修复后再建新 Revision 的 Test。
2. `findings.test.ts`/`delivery-failures.test.ts`/`delivery.integration.test.ts` 中原先修复 Run 冻结的 Revision 与 `work.baseRevision` **相同**（`recordFixArtifact` 默认 `REVISION`），在新规则下“修复未产生新 Revision”被拒；用例改为 `FIX_REVISION`/`NEXT_REVISION` 并断言 `work.baseRevision` 被推进。
3. `delivery.integration.test.ts` 的 AC-007 L1 链原先完全手工拼装、从不调用 `completeWork`（Review 也因此没有持久 `stage_result`）；现在补上 ReviewCheck 结果并真实调用完成门禁。
4. `delivery.integration.test.ts` 的 Finding 闭环原先在 `markAddressed` **之后**才创建修复 Run 的证据；现在修复证据先落库再标记（这正是 W6R2-03 要求的不变量）。

### 验证数字（本轮，全部为原始命令结果）

| 命令 | 原始结果 | 结论 |
|---|---|---|
| `node_modules/.bin/prettier --write <files>` | 8 个被改文件全部格式化完成（末次运行 8/8 `unchanged`，已收敛；此前 `delivery.test.ts`/`findings.test.ts`/`gates.test.ts` 与三个 src 有改动） | 通过 |
| `pnpm typecheck` | `tsc -p tsconfig.json --pretty false`，无输出（`TYPECHECK_EXIT=0`） | 通过 |
| `pnpm lint` | `Checking formatting... All matched files use Prettier code style!`（`LINT_EXIT=0`） | 通过 |
| `pnpm test:unit` | `Test Files 38 passed (38)` / `Tests 749 passed (749)`（`UNIT_EXIT=0`）；较 T6 的 727 增加 **22** 条回归（domain 10 + `findings.test.ts` 9 + `gates.test.ts` 3） | 通过 |
| `pnpm test:integration` | `Test Files 11 passed (11)` / `Tests 132 passed (132)`（`INTEGRATION_EXIT=0`）；本次 `docker info` 成功，Docker 环境阻塞未复现 | 通过 |
| `pnpm build` | `pnpm -r build`：contracts/pi-runtime/domain/knowledge/storage/workspace/core/cli/daemon/runner 共 **10 workspace** 全 `Done`（`BUILD_EXIT=0`） | 通过 |
| `pnpm docs:check` | `docs:check ok — 15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages`（`DOCSCHECK_EXIT=0`） | 通过 |

原始日志：`/tmp/wp06t7.log`（prettier/typecheck/lint）、`/tmp/wp06t7b.log`（unit/integration）、`/tmp/wp06t7c.log`（build/docs:check）。

### T7 残余（供独立 Review/Test 判定）

1. **CompletionManifest 覆盖度**：L1/document 现在必须提供冻结且 schema 合法、属于本 Work、`verifiedManifestIds` 非空的 `CompletionManifest`；但“清单必须覆盖每一个被验证 Manifest / 与 CAS 后 `finalRevision` 一致”的完整核对仍属 WP-08（`workflow.md` §7 的最终绑定）。本轮只绑定“清单属于本 Work”与“证据 Revision = Work Revision”。
2. **无 `baseRevision` 的 Work 不能完成**：这是 W6R2-04 要求的 fail-closed 结果；AC-089 继续允许创建无 `baseRevision` 的 Work（本包未改 `requirement-continue.ts`），该 Work 需要真实 Revision（WP-08 的 Git 交付路径）后才能完成。
3. **Revision 全序仍不存在**：修复 Revision 只接受“等于 Work 当前 Revision 且不同于修复前 Revision”，未实现“后代 Revision”偏序（无 Git 祖先关系）。
4. **预算预留 vs 核销**：批准路径现在预留 `requestedTokens` 并 fail-closed；`tokensReserved` 的核销/退还仍由 `RunLifecycle.settle` 负责（WP-02/WP-08），审批与派发之间不重复计费的并发压测未做。
5. **冻结 Manifest 的写入方**：`frozenManifestOf` 只认 payload 声明的 `manifestId`（唯一调用方 `stage_result.manifest_id` 的键空间；hash 键空间不可达，见 T8/W6R3-05）；真实写入 `VerificationManifest`/`CompletionManifest` 快照的接线方（并声明 id）属 WP-08。
6. **operation 路线**：无 `Test` 阶段，故 `completionEvidenceKindFor` 为它选择 Review 证据；专门的 `Verify` 证据规则属 WP-08（与 T6 残余 4 同源）。
7. **`writeAdmission` 与 `requestCodeWrite` 的 Run/Attempt 条件未合并**：Work 状态两门共用 `workWriteBarrier`；Run/Attempt 就绪条件仍只在 `writeAdmission`（Broker/工具准入接线属 WP-07）。
8. **`evidenceValid` 必需字段**：domain 类型要求调用方显式给出；本包 core 全部从持久 artifact 读取，但外部（WP-07）接线时必须同样从 `artifact.validity` 读取，否则省略即被拒。

## T8 Review 第 3 轮修复（W6R3-01…W6R3-07）

Review 判定：`FAIL`（1 × P1 + 3 × P2 + 3 × P3）。改动仅限 `packages/domain/src/delivery.ts`、`packages/core/src/{gates,findings}.ts`、其测试文件与本记录；`decisions.ts`/`requirement-continue.ts` 无本轮 Finding，未改动。每条 Finding 附「旧行为 ⇒ 现在的行为」回归测试。

### W6R3-01 [P1] 完成路线必须由 Work 的持久 `intent` 推导

- **变更**：`findings.ts` 新增导出 `deliveryRouteOfIntent(intent)`（`delivery → code`、`document → document`、`operation → operation`；`assist`/`artifact` 无交付路线 ⇒ `undefined`）。`completeTx` 不再 `input.route ?? 'code'`：路线一律从持久 `work.intent` 推导，`input.route` 只作交叉校验，冲突即 `VALIDATION_ERROR`（未知 intent 亦 fail-closed）。`CompleteWorkInput.route` 的语义改为「与持久事实交叉校验」并更新文档。`completionEvidenceKindFor` 不变，因此 L1 code 仍以 Review 证据完成，code L2/L3 仍必须绑定真实 Test Run。
- **回归测试**：`findings.test.ts`「derives the completion route from the Work intent and refuses a conflicting one (AC-019, W6R3-01)」。旧行为：`intent='delivery'` 的 L2/L3 Work 传 `route:'document'` ⇒ `ok:true`、零 `role='test'` Run；现在 L2 与 L3 均 `VALIDATION_ERROR`（消息点名冲突路线），Work 保持 `running`，同一 Work 走自己的 `code` 路线仍拒绝「no Test Run」，而 `intent='document'` 的 Work 才以 Review 证据完成。
- **修正的旧期望**：`findings.test.ts`「keeps the document route on its own rule」原先用 `intent='delivery'` 的 L2 Work 传 `route:'document'` 并断言成功（即 Review 报告点名的「产品测试把该行为固化为期望」）；现改为先 `store.works.update({ intent: 'document' })` 再断言文档路线。原「refuses an unrecognised route/level」用例由本回归用例取代（未知 route/level 组合仍由 domain 的 `completionEvidenceKindFor` 单测覆盖）。

### W6R3-02 [P2] 写屏障改为白名单（仅 `running` 放行）

- **变更**：domain `workWriteBarrier(status)` 由黑名单（`paused`/`cancelling`/`cancelled`）改为**白名单**：仅 `running` 返回 `{blocked:false}`，其余 7 个状态（`queued`/`paused`/`cancelling`/`cancelled`/`completed`/`blocked`/`failed`）一律 `{blocked:true, code:'INVALID_STATE'}`。`PlanGateService.requestCodeWrite` 与 `FindingService.writeAdmission` 继续共用这一条规则，两个门禁对同一状态给出同一 fail-closed 结论。
- **回归测试**：`findings.test.ts`「refuses every write once the Work is completed or failed, with zero write events」——真实 `completeWork` 后 `writeAdmission` 与 `requestCodeWrite` 均拒绝、零 `delivery.write_admitted`、`StoreSourceHashPort` digest 不变，`failed`（`store.works.update` 置位）同样拒绝；「refuses writes after a cancel stops at blocked(recovery)」——`cancelWork({sideEffectsUnknown:true})` 后写请求拒绝且零事件。`gates.test.ts` 原 paused 用例扩展为「admits a code write only while the Work is running」：7 个非 running 状态全拒、拒绝零写入、回到 `running` 后同一批准 Plan 再准入。
- **修正的旧期望**：`delivery.test.ts`「refuses writes on paused, cancelling and cancelled Work and nothing else」原先断言 `queued`/`running`/`blocked`/`completed`/`failed` **不**被阻断，正是本条要修的 fail-open；改为「admits writes only while the Work is running」。

### W6R3-03 [P2] `invalidatedRevisions` 的生产者与三处消费

- **变更**：`submitFinding` 的 `invalidateVerificationEvidence` 现在同时返回被失效 artifact 的 `sourceRevision` 集合；`submitFinding` 在同一事务把它冻结为 `snapshot(type=verification, kind=finding_invalidated_evidence, workId, findingId, revisions)`。新增导出 `invalidatedEvidenceRevisions(store, workId)` 作为唯一读取口（`gates.ts` 直接复用同一函数，无第二套扫描），并接入：① 完成门禁 `completionEvidence` 的 `lineage.invalidatedRevisions`；② Finding 关闭——`FindingVerificationInput`/`FindingClosureInput`/`runIsIndependent` 新增 `invalidatedRevisions`，`findingCanBeVerified` 在闭合路径显式拒绝「`fixingRevision` ∈ 失效集合」；③ 等级重评——`LevelUpgradeInput.invalidatedRevisions` → `planEvidenceOf` 血缘；④ `markAddressed` 直接拒绝修复 Run 自述的失效 Revision。
- **回归测试**：`findings.test.ts`「refuses a fix that re-anchors to a revision a Finding invalidated (AC-017/AC-018, W6R3-03)」。旧行为：Review artifact 错标 `REV_PRE` 提交 Finding 后，修复 Run 自述 `REV_PRE` 被 `markAddressed` 接受并把 `work.baseRevision` 推进到 `REV_PRE`，整条闭环锚定在被失效 Revision；现在 `GATE_NOT_READY`、消息含 `invalidated`、Finding 保持 `open`、`baseRevision` 不变。domain 侧 `delivery.test.ts` 的 `findingCanBeVerified` 用例新增 `invalidatedRevisions:[FIX_REV]` 负例（新 Review/Test 齐备且 passed 仍被拒）。

### W6R3-04 [P2] 无 `baseRevision` 的 Work：写门禁 fail-closed + 升级血缘跨 revision

- **变更**：`requestCodeWrite` 在 `work.baseRevision` 缺失时直接 `GATE_NOT_READY`（旧行为是 `!== undefined &&` 跳过比较，调用方的 `revision` 完全自由）。`upgradeLevelTx` 的 `findPreviousApprovedPlan` 去掉 `record.revision === revision` 过滤，改为「该 Work **全部**批准记录中非替换 Plan 的最新一条」；血缘 Revision 取 `work.baseRevision ?? previous.revision ?? 'working-tree'`，使无 `baseRevision` 的 Work 在真升级时也 `plan_stale` + `artifacts.invalidate`。
- **回归测试**：`gates.test.ts`「fails closed on an unbound Work and supersedes its previous Plan on an upgrade (W6R3-04)」。旧行为：`baseRevision` 缺失时写请求 `allowed:true`；升级 `stalePlanRefs:[]`、旧 Plan artifact 仍 `valid`、旧 Plan 写的请求仍放行；现在写请求 `GATE_NOT_READY`（零事件）、升级 `stalePlanRefs=[P1.hash]`、artifact `invalid`、旧 Plan 写请求被拒。

### W6R3-05 [P3] `frozenManifestOf` 的键空间声明

- **变更**：`frozenManifestOf` 只按 payload 声明的 `manifestId` 匹配，删除 `row.hash === manifestId` 比较（该键空间对唯一调用方不可达：`stage_result.manifest_id` 是 `idRefSchema`/UUIDv7，64 位摘要过不了存储契约）。拒绝消息由「that id or hash is frozen」改为「no VerificationManifest declares that manifestId」，不再宣称 hash 键空间可达。T7 的 W6R2-05 条目与残余 5 已按此更正。
- **回归测试**：`findings.test.ts`「keeps the frozen-manifest lookup on the real manifestId key space (W6R3-05)」：断言 64 位摘要作为 `stage_result.manifestId` 被存储层契约拒绝（故不是可用键），未冻结的合法 UUID 触发的拒绝消息点名 `manifestId` 且不含 `or hash`（旧消息含 `or hash` ⇒ 旧代码下失败）；payload 声明 `manifestId` 的正例仍由既有 W6R2-05 用例覆盖。

### W6R3-06 [P3] L3 回退/逐项审核/恢复演练证据结构化

- **变更**：`StageManifest` 新增 `rollbackPlanRef`/`auditRef`/`recoveryDrillRef`（`Ref`，要求 `id` 与 `hash` 非空）；`l3EvidenceGaps` 删除 `includes('rollback'|'audit'|'drill')` 子串判定，改为要求三项结构化引用（audit 可绑 Review 或 Test，drill 可绑 Recovery 或 Plan）；`evidence` 文本字段保留为**描述**，不再作为证据。
- **回归测试**：`delivery.test.ts`「needs a Requirement for L2/L3 code and for L3 evidence」扩展：自否定文本（`there is no rollback plan but rollback`、`NO audit was performed`、`no drill happened, drill`）⇒ `MISSING_CONTEXT` 且点名三项；三项 Ref 齐备 ⇒ `ok:true`；`id` 或 `hash` 为空 ⇒ 拒绝。`delivery.integration.test.ts` 的 AC-011 链改为绑定真实 rollback/audit/drill artifact 的 `Ref`（`stageView` 助手新增三个字段）。

### W6R3-07 [P3] 完成事件字段与 `evidenceKind` 一致

- **变更**：`delivery.work_completed` 事件按 `evidenceKind` 分列。test 分支保留 `testStatus`/`testRunId`/`testEvidenceRevision`/`testEnvironmentRef`；review 分支改为 `reviewStatus`/`reviewRunId`/`reviewEvidenceRevision`（有环境时 `reviewEnvironmentRef`），**不写**任何 test 命名字段；两分支共有 `evidenceKind`/`evidenceRunId`/`completionManifest*`。
- **回归测试**：`findings.test.ts`「completes an L1 Work without a Test Run…」扩展断言：review 完成事件暴露 `reviewRunId`/`reviewStatus`/`reviewEvidenceRevision`，且 key 集合不含 `testStatus`/`testRunId`/`testEvidenceRevision`（旧事件为 review 证据写 `testStatus:'passed'` ⇒ 旧代码下失败）。

### 接口变更（调用方需知）

| 位置 | 变更 |
|---|---|
| `CompleteWorkInput.route` | 语义改为「与 Work 持久 `intent` 交叉校验」；冲突即 `VALIDATION_ERROR`（不再由调用方选择证据规则） |
| `workWriteBarrier` | 白名单：仅 `running` 放行 |
| `StageManifest` | 新增 `rollbackPlanRef`/`auditRef`/`recoveryDrillRef`（L3 必填） |
| `FindingVerificationInput`/`FindingClosureInput` | 新增可选 `invalidatedRevisions` |
| `LevelUpgradeInput` | 新增可选 `invalidatedRevisions` |
| 新增导出 | `deliveryRouteOfIntent`、`invalidatedEvidenceRevisions`、`FINDING_INVALIDATION_RECORD_KIND` |
| `delivery.work_completed` 事件 | review 完成改用 review 命名字段，不再写 test 命名字段 |

### 修正的旧测试期望（原期望编码了缺陷）

1. `delivery.test.ts`「refuses writes on paused, cancelling and cancelled Work and nothing else」→「admits writes only while the Work is running」（原断言 `queued`/`blocked`/`completed`/`failed` 放行 = W6R3-02 的 fail-open）。
2. `findings.test.ts`「keeps the document route on its own rule」原先用 `intent='delivery'` 的 L2 Work + `route:'document'` 断言成功（W6R3-01 的旁证）；改为先把 Work 的 `intent` 置为 `document`。
3. `delivery.test.ts` 的 L3 正例与 `delivery.integration.test.ts` 的 AC-011 链原先以自由文本满足 rollback/audit/drill（W6R3-06）；改为绑定结构化 `Ref`。
4. `findings.test.ts` 的完成事件断言改为 review 命名字段，不再依赖 test 命名字段（W6R3-07）。

### 验证数字（本轮，全部为原始命令结果）

| 命令 | 原始结果 | 结论 |
|---|---|---|
| `node_modules/.bin/prettier --write <files>` | 7 个文件；`domain/src/delivery.ts`/`core/src/gates.ts`/`domain/test/delivery.test.ts`/`core/test/gates.test.ts` unchanged，`core/src/findings.ts`/`core/test/findings.test.ts`/`core/test/delivery.integration.test.ts` 已格式化 | 通过 |
| `pnpm typecheck` | `tsc -p tsconfig.json --pretty false`，无输出（exit 0） | 通过 |
| `pnpm lint` | `Checking formatting... All matched files use Prettier code style!`（exit 0） | 通过 |
| `pnpm test:unit` | `Test Files 38 passed (38)` / `Tests 754 passed (754)` / 10.03s | 通过（较 T7 的 749 增加 5 条回归：`findings.test.ts` +4、`gates.test.ts` +1；domain 的既有用例内新增断言） |
| `pnpm test:integration` | `Test Files 11 passed (11)` / `Tests 132 passed (132)` / 18.66s；`docker info` 成功，doctor/container 真实容器用例通过 | 通过（无环境阻塞） |
| `pnpm build` | contracts/pi-runtime/domain/knowledge/storage/workspace/core/cli/daemon/runner 共 **10 workspace** 全 `Done` | 通过 |
| `pnpm docs:check` | `docs:check ok — 15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages` | 通过 |

### T8 残余（供独立 Review/Test 判定）

1. **完成路线的 intent 映射**：`deliveryRouteOfIntent` 只认 `delivery`/`document`/`operation`；`assist`/`artifact` 的 Work 无完成路线（fail-closed `VALIDATION_ERROR`）。若产品要为它们定义交付路线，需先在契约/产品文档明确。
2. **失效 Revision 的来源**：生产者只取「被 `submitFinding` 失效的 review/test artifact 的 `sourceRevision`」；`stage_result` 无 revision 列，未纳入。Run 侧若继续错标 `sourceRevision`，失效集合会随之错标（与 W6R3-03 的可达性前提同源；根治需 WP-08 的 Manifest 绑定）。
3. **`findPreviousApprovedPlan` 跨 revision**：现取「全部批准记录中最新且非替换」的一条，按插入顺序而非 Revision 全序（无 Git 祖先关系）。
4. **W6R3-05 的 hash 键空间按「不可达」处理**：`frozenManifestOf` 只认 payload 声明的 `manifestId`；若 WP-08 出现以 64 位摘要为 `stage_result.manifest_id` 的写入方，需同时放开契约类型与读取侧。
5. **`workWriteBarrier` 白名单**：`requestCodeWrite` 对无 `baseRevision` 或非 `running` 的 Work 一律 fail-closed；真实 Broker/工具级准入接线仍属 WP-07。
6. **review 完成事件的 `reviewStatus`** 固定为 `'passed'`（ReviewCheck 已由 `completionEvidence` 校验为 `stage_result.status === 'success'`）；更细的 Review 结论分类属 WP-08。
7. **`CompleteWorkResult` 的 `testStatus`/`testRunId` 字段名未改**（仅事件按 `evidenceKind` 分列）；若调用方需要对称的 review 字段，属 WP-08 的接口整理。
8. **`continueRequirement` 仍以 `intent:'delivery'` 创建 Work**（`requirement-continue.ts` 本轮未改）：W6R3-01 之后完成路线取自持久 `intent`，因此以 `route:'document'` 继续的需求所创建的 Work 目前只能按 code 路线完成（fail-closed）。这是 AC-089 路径的既有形状；把 `intent` 与 `route` 对齐属 WP-08 的 Work 创建整理。
