# WP-06 独立 Review 报告（分级交付与独立验证）

## 0. 元数据与冻结点

| 项 | 值 |
|---|---|
| 冻结点（task 指定） | `b6e7267`（`b6e726784bc6ab54c76f9e659c44f35e9edb0891`） |
| `git rev-parse HEAD` | `b6e726784bc6ab54c76f9e659c44f35e9edb0891` |
| `git rev-parse b6e7267^{tree}` | `4fee1666e07a80ac96c4976b1b1b627712c82c9c` |
| `git status --porcelain`（报告写入前） | 空（工作树干净，HEAD 即冻结点） |
| Review 写入范围 | 仅 `.agentdev/work/WP-06/review.md`；探针只在 `/tmp/wp06r/` |
| 开发/Test 聊天 | 未读取（证据来自仓库文件、`dist` 构建产物与本次独立探针） |
| Docker 环境 | 守护进程 DOWN（`docker info` 失败），`pnpm test:integration` 的 2 个 CLI 容器/doctor 文件因此失败，属环境阻塞，非本包缺陷 |

被审文件 Hash（`git rev-parse b6e7267:<path>` = SHA-1 blob；`shasum -a 256` = 工作树字节）：

| 文件 | git blob | sha256 |
|---|---|---|
| `packages/domain/src/delivery.ts` | `522d4809e0918833886c4c067937b6094d77b2e1` | `1596a77f93faf06612c8b5ba7c89ffe156986813c8e23771f1eac0e803719d9a` |
| `packages/core/src/gates.ts` | `459a381375be1f4bef71f6ec1b2b7beb622b2452` | `197bca91e3cb267859cb9c34625c702c991cd7dcfb2bd185ecf415ab407c5f16` |
| `packages/core/src/decisions.ts` | `421fe9a55fc3bfe40c7a9ec852250f4064b928f2` | `bdc32e7a6945ffdf01ae6793da81899906cd14e315b90b56e1eb97aa8db84fd2` |
| `packages/core/src/findings.ts` | `8ae7dcb06a5af071d86464448e80c5e94fb44757` | `1b3e4eb6219da2859eeb00287d7c1122d73664ccf601b72acd09685a769c10b3` |
| `packages/core/src/requirement-continue.ts` | `94d5beb8aecf95013a730b3d3f31a9840dc0c995` | `ab56706924c75a9fbe7ea36821315b441640ebfd1777c32f29d55ae11ebb647e` |
| `packages/domain/test/delivery.test.ts` | `2e3b66d7f982d76a5c6dc42d27136cb86abe624d` | `5cef433a8aa5ac65936223f3c630aa4124802eee437593118d1444dc00bccc91` |
| `packages/core/test/delivery.integration.test.ts` | `b45511f0328812bd0b4b083b8f002d0681cc8b66` | `332a9175862dc7c8cb2a2f678e342c0fafe17482047e62ca72a743a615d72dff` |
| `packages/core/test/delivery-failures.test.ts` | `aee6510a2c06356f73f19be7b7549a81e071964d` | `e5cc9e7dbe0df116a6a81d9cc8c8dd88e485bce095c42c6a4be66dc72d47eb83` |
| `packages/core/test/gates.test.ts` | `e56c784bc0048ebf5ff33a09fbd92b0b6f720c7d` | `3d6892d33533af87fc3a1103ffa77e8413e276e5dd3bf439d384584a9318e189` |
| `packages/core/test/decisions.test.ts` | `7aa778480e3bc9c1ecbc52c667539df90764df68` | `e4af320de224ddc25a98a6f162e26a24fc3f35240f4a89523bd6b28113996d4d` |
| `packages/core/test/findings.test.ts` | `4a9e477d3bf05ac127aa18c4d1d9bbd354916477` | `d40c940c9ad54421e90d4814fdfaafd3d9c7ac874445eb427a64fc5a7268c942` |
| `packages/core/test/requirement-continue.test.ts` | `7007eed8d37ab3c4e49d679e58100a0093766afe` | `f274113003ba88b9bd7d3ee1d3d3135d82ffaa379a8daa7783e92edac17112b4` |
| `packages/core/src/index.ts` | `2e96be4486eb878b26c25b5a3bd9b280312ce180` | — |
| `packages/domain/src/index.ts` | `ec270d4cbdf962913e49ced0905ca4c1ed82b7fc` | — |
| `.agentdev/work/WP-06/plan.md` | `71753b3204a37b92a11b6ec19696efb45bd7d94e` | — |

## 1. 结论（verdict）

**FAIL** — 在 WP-06 的包验收面（`packages/domain` 的纯规则 + `packages/core` 的 `PlanGateService`/`DecisionService`/`FindingService`/`RequirementContinuation` 公共 API + 真实临时目录 SQLite/Blob）上复现出 **2 个 P1**：

- **W6R1-01（P1）** Finding 关闭的“新独立 Review **与** Test”只按 Run 身份（角色/Work/创建时间）判定，不绑定被验证 Revision，也不看 Test 的实际结论；因此一个**从未复核修复后代码树**的 Review Run（其自有证据仍是修复前 Revision）加上一个**结果为 failed** 的 Test Run 即可把 Finding 置为 `verified`。直接违反 AC-018。
- **W6R1-02（P1）** `completeWork` 直接接受调用方自述的 `TestResultInput.status='passed'`，不校验存在任何 Test Run、环境或 Revision 绑定；在从未创建 Test Run 的 Work 上即可完成 Work。违反 AC-018/AC-019 的“独立验证”体系（“未执行不得以自述代替”）。

另有 4 个 P2、2 个 P3（非阻断但已记录，其中 W6R1-03/05 是真实 fail-open 缺口）。

**能否进入独立 Test：否。** 需返回 Develop 修复 2 个 P1（建议同批处理 P2），修复后重新走独立 Review。

## 2. 契约命令原始结果

| 命令 | 原始结果 | 结论 |
|---|---|---|
| `pnpm typecheck` | `tsc -p tsconfig.json --pretty false`；`TYPECHECK_EXIT=0` | 通过 |
| `pnpm lint` | `node scripts/lint.mjs`；`LINT_EXIT=0` | 通过 |
| `pnpm test:unit` | `Test Files 38 passed (38)` / `Tests 717 passed (717)` / Duration 12.24s；`UNIT_EXIT=0` | 通过（与 implementation.md T5 的 38/717 一致） |
| `pnpm test:integration` | `Test Files 2 failed | 9 passed (11)` / `Tests 3 failed | 120 passed | 9 skipped (132)` / Duration 2.28s；`[ELIFECYCLE] Command failed with exit code 1`。失败全部为 `apps/cli/test/doctor.integration.test.ts` 与 `apps/cli/test/container.integration.test.ts`，错误 `Cannot connect to the Docker daemon at unix:///Users/huyaohua/.docker/run/docker.sock`。**本包新增文件 `packages/core/test/delivery.integration.test.ts (8 tests) 671ms` 通过** | 环境阻塞（task 已声明）；非 Docker 集成面 9 文件/120 例全通过 |
| `pnpm docs:check` | `docs:check ok — 15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages`；`DOCSCHECK_EXIT=0` | 通过 |
| `pnpm build` | `pnpm -r build`：contracts/pi-runtime/domain/knowledge/storage/workspace/core/cli/daemon/runner 共 10 workspace 全 `Done`；`BUILD_EXIT=0` | 通过（10 workspace 与 T5 一致） |

原始日志：`/tmp/wp06r/logs/{static,unit,integration}.log`。

命令尾部原始输出：

```
=== typecheck ===  TYPECHECK_EXIT=0
=== lint ===       LINT_EXIT=0
=== docs:check === docs:check ok — 15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages   DOCSCHECK_EXIT=0
=== build ===      packages/contracts build: Done ... apps/runner build: Done   BUILD_EXIT=0
pnpm test:unit        Test Files 38 passed (38) / Tests 717 passed (717)   UNIT_EXIT=0
pnpm test:integration Test Files 2 failed | 9 passed (11) / Tests 3 failed | 120 passed | 9 skipped (132)   EXIT=1
                      ✓ |integration| packages/core/test/delivery.integration.test.ts (8 tests) 671ms
                      FAIL |integration| apps/cli/test/container.integration.test.ts  (Cannot connect to the Docker daemon)
                      FAIL |integration| apps/cli/test/doctor.integration.test.ts     (Cannot connect to the Docker daemon)
```

环境：macOS，Node v24.8.0，Docker 守护进程不可用（未尝试启动）。

## 3. 方法与探针清单

探针消费 `packages/{storage,domain,core}/dist`（`pnpm build` 产物），**不 import 任何产品测试文件**（`grep -l "packages/core/test\|packages/domain/test" /tmp/wp06r/probe/*.mjs` 为空）；涉及存储的用例均使用真实 `mkdtempSync` 临时目录 + 真实 SQLite（`ProjectStore.open`）+ 真实 `BlobStore`。

| 脚本 | 用例数 | 说明 |
|---|---|---|
| `/tmp/wp06r/probe/lib.mjs` | — | 端口/夹具工具（真实 store/Work/Run/Task/Requirement/Authorization、`StoreSourceHashPort`） |
| `/tmp/wp06r/probe/ac07-09-domain.mjs` | 38 | AC-007/008/009：L1 资格与边界、一字符高风险、升级与拒绝降级、L1 路线无 Plan/Test 阶段、AC-012 文档路线规则 |
| `/tmp/wp06r/probe/ac07-09-13-14-core.mjs` | 37 | AC-007/009/013/014：真实 `PlanGateService`——无 Plan 拒绝与源码 Hash 不变、合规 Plan 自动批准并落库、越界/异 Revision/伪造 Hash 拒绝、升级 stale 旧 Plan 并关联 Requirement；含授权撤销探针 |
| `/tmp/wp06r/probe/ac10-12-19-domain.mjs` | 25 | AC-010/011/012 阶段 Manifest 链（L2 全链、L3 回退/逐项审核/恢复演练）、AC-019 `blocked`/`not_covered` 语义 |
| `/tmp/wp06r/probe/ac15-16-decisions.mjs` | 29 | AC-015/016：`DecisionService` now/later/decline 三分支、版本推进、证据失效、验收不变 |
| `/tmp/wp06r/probe/ac17-19-83-findings.mjs` | 26 | AC-017/018/019/083：Finding 提交/退回/自证拒绝/新独立 Review+Test 关闭、完成门禁、无 taskId 绑定 |
| `/tmp/wp06r/probe/ac20-21-pause-cancel.mjs` | 43 | AC-020/021：安全点暂停、写准入、版本校验后新 Attempt、取消级联、未知副作用 recovery |
| `/tmp/wp06r/probe/ac22-budget.mjs` | 18 | AC-022：域级原子拒绝、store 级超限提交、无静默加额 |
| `/tmp/wp06r/probe/ac089-continue.mjs` | 34 | AC-089：`listContinuable` 只读投影、继续建新 Work + 本地授权 + 未满足 Gate、负例 |
| `/tmp/wp06r/probe/adversarial.mjs` | 11 | 跨 Work Plan、旧 Revision、目录前缀、拒绝零写入、`now` 后旧 Plan 失效 |
| `/tmp/wp06r/probe/falsify.mjs` | 18 | 对抗探针（F1 授权撤销、F2 源码 Hash、F3/F4 Finding 证据、F5 level=none、F6 降级、F7 完成门禁、F8 AC-089） |
| 合计 | **279 个独立断言** | 运行器：`bash /tmp/wp06r/run-all.sh` |

## 4. 逐 AC 判定

| AC | 判定 | 依据 |
|---|---|---|
| AC-007 | PASS | 域：`classifyChange(1 文件/2 行/文案)` ⇒ `L1`；`stageOrderFor('code','L1')=['Develop','Review','Settlement']` 不含 Plan/Planning/Test。Core：L1 Work 的 Plan 走 `submitPlan` 自动批准，路由与集成测试证明无 Planning/Test Run、无 Requirement/看板建单。 |
| AC-008 | PASS | 一字符 `permissionChange`/`interfaceChange` 均 ⇒ `L3`；`paymentChange` ⇒ `L3`；`logicChange` ⇒ `L2`（契约把逻辑改动列为 L1 排除项而非 lockdown，与 task 的“权限/金额/接口”一致）；未知风险旗标 fail-closed ⇒ `L3`；L3 Work 不可被降级（域拒绝 + 级别保持）。 |
| AC-009 | **PASS（带 P2 W6R1-06）** | 4 文件/21 行、隐藏逻辑改动均触发升级并 `stalePlan:true`；core `upgradeLevel` 把旧 Plan 标记 `plan_stale`、失效旧 Plan 产物、同 Work 关联 Requirement、要求已批准的新 Plan 才能升级，随后旧 Plan 的写请求 `GATE_NOT_READY` 且源码 Hash 不变。**缺陷 W6R1-06**：传“无升级需求”的判定时会误报 `upgraded:true`。 |
| AC-010 | PASS | L2 链缺任一阶段 ⇒ `GATE_NOT_READY` 且点名阶段；缺 Requirement ⇒ `MISSING_CONTEXT`；阶段未依赖前序 / 无冻结 Revision ⇒ 拒绝。集成链（Plan→Develop→Review→Test→Settlement）由 `delivery.integration.test.ts` 覆盖。 |
| AC-011 | PASS | L3 顺序含 `Recovery`；缺回退计划/逐项审核/恢复演练/显式授权均被拒；缺授权为 `MISSING_CONTEXT`。真实迁移输出为 WP-08/WP-10 范围。 |
| AC-012 | **FAIL（P2：链校验器不认文档路线）** | `documentRouteRules('L2')` 元数据正确（无 code Test、无开发 Requirement、候选 Diff、独立 Review）。但 `evaluateStageChain({route:'document'})` 对 `Review` 阶段强制要求 `codeRevision` 与 `environmentRef`（`delivery.ts:577-596`），因此**本包自己的规范链校验器拒绝一条完全合规的文档路线**。已提交的 AC-012 集成测试用 `stageView()` 给每个阶段注入 `codeRevision`/`environmentRef`（`delivery.integration.test.ts:550-567`）从而掩盖了该缺口。 |
| AC-013 | PASS | 无批准 Plan ⇒ `GATE_NOT_READY`；用 `StoreSourceHashPort`(内容+行数摘要) 前后测量证明拒绝零写入、零事件、零 artifact/snapshot；异 Revision、伪造 Plan Hash、越界目标均拒绝。**记录 W6R1-05**：授权被 `revokedAt` 撤销后，已批准 Plan 仍可继续准入写（准入不重读授权信封）。 |
| AC-014 | PASS | 合规 Plan 自动批准（`approvedBy:'auto'` + authorizationRef/版本/Hash 依据）并可在 Blob 中重读并过 `planSchema`；越界/产品变化/外来或未知授权/异 Revision 均拒绝。**记录 W6R1-07**：源码 Hash 对是同一测量值（恒等）。 |
| AC-015 | PASS | `now` ⇒ 新 Product/Plan 版本、Requirement 回 `product`、受影响证据失效（显式 ref 精确失效、未知范围全部失效）、旧批准 Plan 变 `stale` 且写请求被拒；`getInvalidatedEvidence` 持久可查。 |
| AC-016 | PASS | `later` ⇒ 新 Queued Requirement + 当前验收不变 + 原 Requirement 未被改动；`decline` ⇒ 记录原因、`rejected`、不排队、验收不变。 |
| AC-017 | PASS | Review/Test Run 才能提 Finding；提交即 `return_to_development`（无需人工转发），失效该 Work 全部有效 review/test 产物并把 review/test 阶段 Task 重开 `develop`。 |
| AC-018 | **FAIL（P1 W6R1-01）** | 常规路径正确：Developer/角色不符 `NOT_AUTHORIZED`、提 Finding 的 Review 与修复前 Review 被拒、仅 Review 无 Test 被拒、新独立 Review+Test 才 `verified`。但独立性只锚定 Run 身份与创建时间，**不校验被验证 Revision，也不读 Test 结论**：一个证据仍是修复前 Revision 的 Review Run + 一个结果 `failed` 的 Test Run 即可关闭 Finding。 |
| AC-019 | **FAIL（P1 W6R1-02）** | `blocked`/`failed`/未处置 `not_covered` 均阻断；已接受 `risk` Decision 才放行；未关闭阻塞 Finding 阻断完成——这些正确。但 `completeWork` 接受调用方自述的 `testResult.status='passed'`（无 Run/环境输入），在零 Test Run 的 Work 上即可完成 Work，属未执行即放行。 |
| AC-020 | PASS（带 P3 W6R1-09） | 暂停规划整个安全点（含 `RECOVERY_REQUIRED` 原子拒绝、无半状态）、关闭活动 Attempt、写 per-Run Checkpoint 与 `work_pause` 屏障；`writeAdmission` 在暂停后（含暂停后新建 Run）一律拒绝；恢复校验 Work 版本/屏障版本/Task 版本后新开 Attempt（number/epoch 递增）。 |
| AC-021 | PASS | 取消先 `cancelling`，`RunLifecycle.cancel` 级联 parent→child→grandchild 全 `cancelled`、Attempt 置 `stopped`、产物保留 `valid` 且 `integrated:false`、Requirement 转 `cancelled`、屏障记录落 `snapshot`；未知副作用停在 `blocked`(recovery) 并开 pending 用户 Decision，`accept_cancel` 后收口；外来 recovery Decision 被拒。 |
| AC-022 | **FAIL（P1 W6R1-03）** | 域级规则正确（超额原子拒绝、`budgetAfter` 不变、`requiresUserTopUp`、负/小数拒绝、返工额度耗尽拒绝）。但 Core 落库路径把 `tokensUsed` 传 0，导致 `used 60 + reserved 30 + 50 > 100` 的 Plan 被自动批准；`completeWork` 亦无预算检查。 |
| AC-083 | PASS | 无 `taskId` 的 document/integration Finding 绑定 Review Run + Manifest 并冻结 `finding_binding` 快照；`task` 目标缺 `taskId` ⇒ `VALIDATION_ERROR`，外来 Task ⇒ `NOT_AUTHORIZED`。 |
| AC-089 | PASS | `listContinuable` 为纯投影（无 Work/Run/事件/游标变化）；`continueRequirement` 拒绝非 active 与已有本地 Work，创建新 Work+预算+本地 Authorization、Requirement 转 local/phase=product、recordVersion+1，返回全链未满足 Gate（无 Manifest 可复用），`reusedPreviousVerification:false`；伪造/空授权与未知 Requirement 均拒绝。 |

## 5. Findings

### W6R1-01 [P1] Finding 的独立验证不绑定被验证 Revision 与 Test 结论，修复前证据 + failed Test 也能关闭

- 位置：`packages/core/src/findings.ts:1550-1569`（`verificationRunOf` 只用 `completed/workId/role/id/createdAt` 推导独立性，并 `status: completed ? 'passed' : 'blocked'`）、`:1564-1568`；消费点 `packages/domain/src/delivery.ts:1210-1218`（`runIsIndependent` 只看 `stage/reviewsCurrentRevision/status`）、`:1193-1207`。
- 复现：`node /tmp/wp06r/probe/falsify.mjs`（F3/F4，`cases=18 failed=5` 中的 F3、F4）。
- 观察：`verifyFinding({findingId, reviewRun:{runId: <修复前完成的 Review Run>}, testRun:{runId:<结果 failed 的 Test Run>}})` ⇒ `ok:true, state:'verified'`，并写入 `finding_verification` 快照；该 Review Run 自己的产物 `sourceRevision` 仍是修复前 Revision，Test 产物正文为 `{"status":"failed"}`。F3、F4 两条探针均复现。
- 期望：`workflow.md` §6「修复后重新独立 Review」、AC-018「新独立Review/Test，旧结果无效」；Review/Test 必须复核修复后冻结 Revision，且 Test 结论必须为通过才能关闭。
- 契约/AC：AC-017、AC-018；`workflow.md` §6；`data.md` §2 `finding`（`verified` 必须独立 Review 来源）。
- 修复方向：`verificationRunOf` 增加「被验证 Revision = 修复 Run 的冻结 Revision」比较（`VerificationManifest`/`sourceRevision` 落库后按 `codeRevision`/`codeTree` 比对），并要求 Test Run 存在 `passed` 的 `CheckResult`（`not_covered` 需逐条风险处置）；`completed` 不再等价 `passed`。

### W6R1-02 [P1] `completeWork` 接受调用方自述的 Test 结果，零 Test Run 即可完成 Work

- 位置：`packages/core/src/findings.ts:818-965`，尤其 `:852`（`const testResult = input.testResult`）与 `:909-937`（只把 `status`/`uncovered` 交给 `findingBlocksCompletion`）。
- 复现：`node /tmp/wp06r/probe/falsify.mjs`（F7）——在 `store.runs` 中该 Work 的 Run 数为 0 时调用 `completeWork({workId, testResult:{status:'passed'}})`。
- 观察：`ok:true`，Work 转 `completed`，事件 `delivery.work_completed` 的 `testStatus:'passed'`；无任何 Test Run、`environmentRef`、输入 Revision 或 `CheckResult` 绑定被校验。
- 期望：`workflow.md` §6「报告不能以“应该通过”代替执行」、§7「L2/L3 代码使用独立 Review 和 Test」；AC-019 的完成门禁必须建立在真实 Test 证据上（AC-018 同源要求）。
- 契约/AC：AC-018、AC-019；`data.md` §3 `TestResult` 绑定 Manifest 与 `CheckResult`。
- 修复方向：`CompleteWorkInput` 改为引用 Test Run/`VerificationManifest` ID，由 Core 读取其 `CheckResult`（含 `environmentRef`、`inputTree`、退出码）；无有效 Test 证据 ⇒ `GATE_NOT_READY`；同时对 Work 预算做 `used+reserved<=limit` 复核。

### W6R1-03 [P2] `evaluatePlanApproval` 把 `tokensUsed` 置 0，已用量预算下的超额预留被放行

- 位置：`packages/domain/src/delivery.ts:752-769`（`budgetRowOf({ tokenLimit, tokensUsed: 0, tokensReserved: budget.tokensReserved })`，见 `:756`）；调用点 `packages/core/src/gates.ts:565-588`。
- 复现：`node /tmp/wp06r/probe/ac22-budget.mjs`。
- 观察：`tokenLimit=100, tokensUsed=60, tokensReserved=30, requested=50`（域规则 `canAllocateBudget` 明确 `used 60 + reserved 30 + 50 exceeds 100` 拒绝）时 `submitPlan` 返回 `approved:true` 并落 Plan 产物与批准记录；`tokensUsed` 被忽略 ⇒ 等效静默加额。
- 期望：`reliability.md` §3「模型调用前预留…并行调用共享Work预算事务，防止双花」；AC-022「尝试预留超额…原子拒绝；用户增加预算后继续，无静默加额」。
- 契约/AC：AC-022；`reliability.md` §3。
- 修复方向：`PlanApprovalInput.budget` 传真实 `tokensUsed`（或直接传 `Budget` 行），并让 Core 在批准事务内做一次 `used+reserved+requested<=limit` 复核；补 `used` 非零的负例测试。

### W6R1-04 [P2] 文档路线的 Review 被强制要求 `codeRevision` 与验证环境，规范链校验器拒绝合规文档交付

- 位置：`packages/domain/src/delivery.ts:577-596`（`stageEvidenceGaps` 不看 `route`，`MANIFEST_STAGES` 含 `Review`，并对 `Review`/`Test` 要求 `environmentRef`；`MANIFEST_STAGES` 定义在 `:495`）。
- 复现：`node /tmp/wp06r/probe/ac10-12-19-domain.mjs`（`cases=25 failed=1`）。
- 观察：`evaluateStageChain({route:'document', level:'L2', manifests:[Product→Planning→Review→Settlement]})` ⇒ `{ok:false, code:'VALIDATION_ERROR', gaps:[{stage:'Review', message:'stage Review must bind a frozen code revision'}, {stage:'Review', message:'stage Review must name its verification environment'}]}`。
- 期望：`workflow.md` §3 表格与末段「文档路线…ReviewCheck执行目标替换、Diff范围、文档/链接或必要构建检查；无单独Test Run」；AC-012 只要求候选 Diff、独立 Review、Settlement。文档审查不绑定代码 Revision。
- 契约/AC：AC-012。
- 修复方向：`stageEvidenceGaps` 接收 `route`，仅在 `route==='code'` 时要求 `codeRevision`；`environmentRef` 仅对代码路线的 Review/Test 必填；文档路线可要求「候选 Diff 与来源引用」证据。补一条不注入 `codeRevision` 的文档路线正例。

### W6R1-05 [P2] 授权撤销后已批准 Plan 仍可准入代码写

- 位置：`packages/core/src/gates.ts:659-803`（`requestCodeWrite` 只读 `getCurrentPlanApproval`，不重读 `authorizations`）；对比 `gates.ts:1059-1080` 的 `authorizationOrRefusal`（仅在 `submitPlan` 时校验 `revokedAt`）。
- 复现：`node /tmp/wp06r/probe/falsify.mjs`（F1）、`node /tmp/wp06r/probe/ac07-09-13-14-core.mjs`（授权撤销用例）。
- 观察：Plan 批准后把授权行置 `revokedAt`，再 `requestCodeWrite` ⇒ `allowed:true`（未写任何拒绝事件，源码 Hash 不变）。
- 期望：`data.md` §2「authorization … revokedAt」；`execution.md` §4 准入须匹配 Grant/授权来源；AC-013 的 Gate 必须在准入时重新核对授权信封。
- 契约/AC：AC-013（准入）、`execution.md` §4。
- 修复方向：`requestCodeWrite` 在批准记录之外重读授权行，`revokedAt` 或 Work 不匹配 ⇒ `NOT_AUTHORIZED`；把授权 Hash 纳入批准记录并在准入时比对。

### W6R1-06 [P2] `upgradeLevel` 在没有升级需求时仍返回 `upgraded:true`，并在拒绝降级路径上失效当前 Plan

- 位置：`packages/core/src/gates.ts:861-878`（`decision.ok`（无升级需求）与「降级被拒」两种域结果都被落进同一段晋升代码，`:870-878` 只比较 rank，随后 `:881-892` 无条件按 `decision.stalePlan` 追加 `plan_stale` 并 `artifacts.invalidate`）；域侧 `packages/domain/src/delivery.ts:344-355`、`:370-376`。
- 复现：`node /tmp/wp06r/probe/falsify.mjs`（F6）。
- 观察：对已是 `L3` 的 Work 传「仅文案改动」的 diff 与**同一份**已批准 Plan 为 `newPlanRef` ⇒ `upgraded:true, previousLevel:'L3', level:'L3', stalePlanRefs:[]`；若传入的是另一份已批准 Plan，则旧 Plan 被追加 `plan_stale` 并被 `artifacts.invalidate`，而 Work 级别实际没有变化（“拒绝降级”不应失效一个仍然有效的当前 Plan）。
- 期望：`workflow.md` §2「自动降级不支持」应表达为**拒绝**且不改变现有证据；`upgradeRequired:false` 不应产生任何 Work/Plan 状态变化。
- 契约/AC：AC-008/AC-009（等级与证据失效语义）。
- 修复方向：在 `upgradeLevelTx` 中区分「域判定无需升级」与「域判定升级/拒绝降级」三种结果：前者返回 `GATE_NOT_READY`（或明确的 `noop`）且零写入；仅真正发生级别上升时才 `plan_stale` + `invalidate`。域侧拒绝降级时同时给出 `stalePlan:false`。

### W6R1-07 [P3] 写 Gate 的源码 Hash 对是同一个测量值，`sourceHash` 恒等检查不可能触发

- 位置：`packages/core/src/gates.ts:760-761`（`expectedSourceHash: contentBefore` 与 `actualSourceHash: contentBefore` 同时传入）；域侧检查 `packages/domain/src/delivery.ts:839-841`。
- 复现：`node /tmp/wp06r/probe/falsify.mjs`（F2）：域规则对 `expected!==actual` 正确拒绝，而服务路径永远给出相等值；`ac07-09-13-14-core.mjs` 的拒绝用例只能验证“拒绝时 Hash 不变”，无法验证“源码移动则拒绝”。
- 期望：`implementation.md` T2「拒绝时源码 Hash 前后不变」应建立在真实前后测量上（写入方在准入后自行比对）。
- 契约/AC：AC-013。
- 修复方向：让 `RequestCodeWriteInput` 接受调用方在写前测量的 `expectedSourceHash` 并在准入时与 `contentHashOf(work)` 比较，或明确废弃该字段并把“源码移动检测”登记为接线残留（避免保留不可能触发的判定）。

### W6R1-08 [P3] `completed` Run 一律折算为 `passed`，Test 失败/未覆盖语义在 Finding 关闭路径丢失

- 位置：`packages/core/src/findings.ts:1567`（`status: completed ? 'passed' : 'blocked'`）；域侧 `packages/domain/src/delivery.ts:1210-1218`。
- 复现：`node /tmp/wp06r/probe/falsify.mjs`（F4）。
- 期望：Test 结论必须来自 `CheckResult`（`passed/failed/not_covered/blocked`），不能由 Run 状态推断。
- 契约/AC：AC-018/AC-019；`data.md` §3 `CheckResult`。
- 修复方向：与 W6R1-01 同批——读取 Test Run 的 `checkResult`/产物，`completed` 仅表示 Run 结束。

### W6R1-09 [P3] 恢复后的新 Attempt 处于 `starting`，而写准入只看 Run 状态

- 位置：`packages/core/src/findings.ts:1255-1268`（`runs.update(paused→running)` 后才 `openAttempt(... status:'starting')`，且不走 `RunLifecycle.beginAttempt` 的 `starting→running` 就绪确认）；`packages/core/src/findings.ts:978-1009`（`writeAdmission` 只判 Work/Run 状态，不看 Attempt）。
- 复现：`node /tmp/wp06r/probe/ac20-21-pause-cancel.mjs`（`cases=43 failed=0`；该行为被记录而非判失败——当前 Run 恢复即视为可写）。
- 期望：`reliability.md` §2「每次Attempt分配递增epoch…ready确认epoch/进程标识/环境后Running」；`execution.md` §1/§2 的 Capability 就绪语义。
- 契约/AC：AC-020（恢复后新 Attempt）。
- 修复方向：恢复时把 Run 置 `starting` 并由 `RunLifecycle.beginAttempt` 完成 `queued/starting→running`，或让 `writeAdmission` 要求「存在 `running` 且未 superseded 的 Attempt」。

### W6R1-10 [P3] `isWithinScope` 的目录前缀分支在当前 Schema 下不可达（无缺陷，登记以说明覆盖边界）

- 位置：`packages/domain/src/delivery.ts:854-858`（`target.endsWith('/')` 分支）。
- 复现：`node /tmp/wp06r/probe/adversarial.mjs`（`cases=11 failed=0`）——`packages/core/src/` 因 `path must not contain empty segments` 无法写入 `Scope.writePaths`，因此「目录前缀授权」只能以无尾斜杠的精确路径表达，前缀分支不可达；`packages/core/srcX/y.ts` 不会被误准入。
- 期望：契约允许的路径形态与规则文档一致；本条不计缺陷，仅说明写范围只能精确匹配。
- 契约/AC：`data.md` §1 Path 规则。
- 方向：若确需目录级授权，应使用 `packages/core/src/**` 之类的显式语法并同时更新 Schema/文档。

## 6. 计数与阻断表

| 严重性 | 数量 | 编号 | 是否阻断 | 说明 |
|---|---|---|---|---|
| P0 | 0 | — | — | — |
| P1 | 2 | W6R1-01, W6R1-02 | **阻断** | 均在包验收面可复现，直击 AC-018/AC-019 的独立验证与完成门禁 |
| P2 | 4 | W6R1-03, 04, 05, 06 | 不阻断（已说明是否影响验收） | W6R1-03/05 是真实 fail-open（预算静默加额、授权撤销失效）；W6R1-04 使 AC-012 的规范链校验不可用；W6R1-06 误报升级/误失效 Plan |
| P3 | 4 | W6R1-07, 08, 09, 10 | 不阻断 | 记录即可（W6R1-08 与 W6R1-01 同批修复；W6R1-10 非缺陷） |
| 合计 | 10 | — | — | — |

验收面结论：P1 存在 ⇒ **FAIL**，不进入独立 Test。

## 7. 记录核对（implementation.md T1–T5）

- **用例数声明准确**：`packages/domain/test/delivery.test.ts` 34（声明 34）、`gates.test.ts` 6、`decisions.test.ts` 5、`findings.test.ts` 19、`requirement-continue.test.ts` 4、`delivery.integration.test.ts` 8、`delivery-failures.test.ts` 5，与 T1–T4 逐一一致。
- **契约命令声明准确**：typecheck/lint 0；unit 38 文件/717 用例；build 10 workspace；docs:check ok；integration 的 Docker 阻塞与「本包新增集成文件已通过」完全属实（该文件 8 例通过）。
- **五项必需失败测试确实由已提交测试覆盖**（名称逐字为 `一字符高风险`、`超L1升级`、`过期Plan`、`修复后证据失效`、`未覆盖阻断`，`delivery-failures.test.ts:261/419/591/674/801`），且断言为负例行为而非口头结论。
- **零新增表声明属实**：`git show --stat b6e7267 -- packages/storage/src/schema.ts packages/contracts` 为空；批准/失效记录确实借用 `snapshot` 的 `verification/context/config` 三类并带 `kind` 判别。
- **过度声明 2 处**：(a) T1「超额原子拒绝（`budgetAfter` 不变、`requiresUserTopUp:true`）」只对**域纯函数**成立；Core 落库路径因 `tokensUsed:0` 会批准已用量超限的 Plan（W6R1-03）。(b) T1「document 路线 … 无代码测试」在 `documentRouteRules` 元数据上成立，但**同文件的 `evaluateStageChain` 对文档 Review 仍强制代码 Revision 与验证环境**（W6R1-04），使 AC-012 的规范链校验不可用；已提交 AC-012 集成测试通过给每个阶段注入 `codeRevision`/`environmentRef` 掩盖了该矛盾。
- **残余清单不完整**：已登记 8 项（零新增表、升级两阶段流程、`writeAdmission` 未接 Broker、Finding 独立性锚定 Run、`completeWork` 不含集成/CAS、暂停/取消不撤 Grant、`continueRequirement` 不重建 Product、Docker 不可用）**均属实且未发现虚假陈述**；但未登记本次复现的「验证不绑定修复后 Revision / Test 结论」（W6R1-01）、「`completeWork` 接受自述 Test 结果」（W6R1-02）、「预算 `tokensUsed` 归零」（W6R1-03）、「文档路线链校验自相矛盾」（W6R1-04）、「授权撤销不阻断写」（W6R1-05）、「无升级需求误报 upgraded」（W6R1-06）。残余 4（独立性锚定 Run 身份 + 创建顺序）**低估了实际缺口**：缺口不只是缺 `dependencyRevision` 相等检查，而是完全没有 Revision/结论维度。
- 逐项核对 T1..T5 的代码事实：T1 的 `evaluateL1Eligibility`/`classifyChange`/`evaluateLevelUpgrade`/`STAGE_ORDER`/`evaluateWriteGate`/`evaluatePlanApproval`/`evaluateBehaviourChoice`/`evaluateFindingRouting`/`canReserveBudget` 均存在且语义与描述一致；T2/T3 的类名、方法名、快照类型、事件名与描述一致（`delivery.write_admitted`、`delivery.level_upgraded` 确为 `protocol.md` §7 未定义的新事件名，已登记）；T4 的桩化边界与描述一致（Run 工具/Git/CAS 为桩）。

## 8. 覆盖限制

1. **Docker 环境阻塞**：`apps/cli/test/doctor.integration.test.ts` 与 `container.integration.test.ts` 的 3 例失败源于守护进程不可用（task 已声明），未尝试启动 Docker；容器级落盘/隔离证据不在本报告内（属 WP-07/WP-10）。
2. **未接线的上层**：本包服务尚无 HTTP/WS/Broker 消费者（`grep` 确认 `packages/*/src`、`apps/*/src` 中仅 `requirement-continue.ts` 内部调用 `evaluateStageChain`，其余服务均为公共 API）。因此 W6R1-01/02/03/05 的可达性来自**包公共 API 的直接调用**（WP-08/WP-09 将以此为接线面），而非已验证的端到端路径。W6R1-05 的授权撤销场景在真实接线中还需要调用方不重读授权，属同一风险面。
3. **真实迁移/回退/Restore 演练**：AC-011 只验证了链与证据**判定**（L3 授权/回退/逐项审核/恢复演练证据项），真实迁移输出、恢复脚本与 CAS 属 WP-08/WP-10，本报告不含真实 Git/容器证据。
4. **Finding 的 `VerificationManifest`**：schema 尚无 Manifest 行（implementation.md 残余 4），因此 W6R1-01 只能以现有字段（Run 身份、`sourceRevision` 产物）证明缺口，无法验证“落库后追加 `dependencyRevision/codeRevision` 相等检查”的修复是否充分。
5. **预算端到端**：W6R1-03 只证明 `submitPlan` 路径的 `tokensUsed` 归零；派发/核销（`RunLifecycle.reserve/settle`）的真实双花防护属 WP-02/WP-08，本次未做并发压测。
6. **暂停写准入**：`writeAdmission` 是可观测端口，尚未接 Broker/工具准入（WP-07）；本次验证的是持久状态层面的拒绝，不含容器内工具级证据。
7. **未运行** `pnpm test:e2e`/`test:acceptance`/`test:live`（按契约返回 NOT_IMPLEMENTED，属 WP-09/WP-10）。
8. **未读取任何开发/Test 聊天或会话记录**；探针由 `dist` 类型声明与正式文档编写，不 import 任何产品测试文件。

## 9. 能否进入独立 Test

**否。** 存在 2 个可复现的 P1（W6R1-01 Finding 独立验证不绑定修复后 Revision/Test 结论；W6R1-02 `completeWork` 接受自述 Test 结果），AC-018/AC-019 未满足。建议按 W6R1-01…06 修复后重新提交独立 Review；修复必须包含负例测试：①验证者证据 Revision 早于修复 ⇒ 拒绝；②Test `failed`/`not_covered` ⇒ 不关闭；③无 Test Run 的完成请求 ⇒ `GATE_NOT_READY`；④`tokensUsed` 非零的超额 Plan ⇒ `BUDGET_EXCEEDED`；⑤不带 `codeRevision`/`environmentRef` 的文档路线链 ⇒ `ok:true`；⑥授权撤销后的写 ⇒ `NOT_AUTHORIZED`；⑦无升级需求的 `upgradeLevel` ⇒ 不写任何 Plan/Work 状态。
