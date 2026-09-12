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
