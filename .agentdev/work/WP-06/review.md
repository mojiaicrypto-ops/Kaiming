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

---

# WP-06 独立 Review 报告（第 2 轮：修复复核与回归）

## 10. 元数据与冻结点（第 2 轮）

| 项 | 值 |
|---|---|
| 冻结点（task 指定） | `6996405`（`6996405755b6cd12fc573b8f1aa8f7fb177918b9`，`fix(domain,core): close WP-06 review round-1 findings`） |
| `git rev-parse HEAD` | `9981902ca2d8ff01c025fc56a14619dab0117ce6`（`docs(review)` 位于冻结点之上） |
| `git rev-parse 6996405^{tree}` | `274ab8a4df585ebddd6bf5031fe3dd33c9e8ea89` |
| `git diff --stat 6996405 HEAD` | `.agentdev/work/WP-06/review.md \| 240 +++++++++`（仅第 1 轮报告，无代码差异） |
| `git status --porcelain`（本报告追加前） | 空（工作树干净） |
| 第 1 轮报告保真 | 追加后 `git show HEAD:.agentdev/work/WP-06/review.md \| diff - <(head -240 .agentdev/work/WP-06/review.md)` 无差异（第 1 轮逐字保留） |
| Review 写入范围 | 仅 `.agentdev/work/WP-06/review.md`（追加第 2 轮）；探针只在 `/tmp/wp06r2/` |
| 开发/Test 聊天 | 未读取（证据来自仓库文件、`packages/*/dist` 构建产物与本次独立探针） |
| 环境 | macOS 26.5.1，Node v24.8.0，**Docker 守护进程可用**（`docker info` 成功），`pnpm test:integration` 11 文件/132 用例全部通过 |

被审代码 Hash（`git rev-parse 6996405:<path>` = git blob；`shasum -a 256` = 工作树字节）：

| 文件 | git blob | sha256 |
|---|---|---|
| `packages/domain/src/delivery.ts` | `5c59d57cae57175f5f8bdea68f6226b23ac4a587` | `ebb97e0e6d25bc7df55ade6b896cf76644edfc83540db2c3ce182ad90b0c07d1` |
| `packages/core/src/gates.ts` | `b0db84982ec06b9f539af0c69d0ddaedb21ec24c` | `ca9a4115cf66edaf44374eb5821598ee11ff4889a02a3791a32cb686fb90d276` |
| `packages/core/src/findings.ts` | `f9a4f2cf7b095983a7465b6feab7147c2f8b9328` | `6ee5dd5bfcdefccfa6bc0f8fe9ec2da2f5f91fb894d1f9b8963b951fc5cd3fa9` |
| `packages/core/src/decisions.ts` | `421fe9a55fc3bfe40c7a9ec852250f4064b928f2` | `bdc32e7a6945ffdf01ae6793da81899906cd14e315b90b56e1eb97aa8db84fd2` |
| `packages/core/src/requirement-continue.ts` | `94d5beb8aecf95013a730b3d3f31a9840dc0c995` | `ab56706924c75a9fbe7ea36821315b441640ebfd1777c32f29d55ae11ebb647e` |
| `packages/domain/test/delivery.test.ts` | `428f1dc5d176c7204583a988865585ea837a44e7` | `5687427bd7173140a4e24798c1fea8c853eba4e326ab3874c24e525398d6e620` |
| `packages/core/test/findings.test.ts` | `bd57949210f9a28c7c53608e1890bc40b97b526b` | `8fe5cb7990acbace874b5915740d8d4bf158edbfeeedbd41ada4ea9ace52a420` |
| `packages/core/test/gates.test.ts` | `4f793d83126e3df593932fbc682d389cae123e22` | `c910f9a92bd82917f1baf07c279ce9cf14901b06cfb30919a7ecb7ef78573afd` |
| `packages/core/test/delivery-failures.test.ts` | `2d0fbc1177e3891454a54de3224c777a7caaf448` | `b1332ad342c729f4363c6d48737e7cd32cecacd60100d2f34d5977927dc943b7` |
| `packages/core/test/delivery.integration.test.ts` | `bb9279ca540160e48f1b3ae6717f8bbb11e1cff3` | `e27950668e936f38f89af7d04b712495c4d0ed43e599405114d3b7c82927d641` |

## 11. 结论（verdict）

**FAIL** — 第 1 轮 10 条 Finding（W6R1-01…10）经本次独立探针**逐条关闭**（10/10，见 §14），六条契约命令全部通过（Docker 可用，integration 132/132），但回归挖掘在冻结树 `6996405` 的公共 API 上复现出 **1 个 P1**：

- **W6R2-01（P1）** 被 Finding 明确失效（`validity='invalid'`）的**修复前 Test Run**仍可作为 `completeWork` 的持久化完成证据把 Work 置为 `completed`：`completionEvidence` 只比较 `revision === work.baseRevision`，而修复过程**从不推进 `work.baseRevision`**（全仓库无 `works.update({baseRevision})`），也未读取产物有效性或「证据是否晚于修复 Run」。直接违反 AC-017「旧结果无效」与 `workflow.md` §7 的证据复用前提（候选树一致）。

另有 **7 个 P2 + 2 个 P3**（非阻断但已记录，其中 W6R2-02/06/07/08 是真实 fail-open 或预算欠计费）。

**能否进入独立 Test：否。** 需返回 Develop 修复 W6R2-01（建议同批处理 P2），修复后重新走独立 Review。

## 12. 契约命令原始结果

| 命令 | 原始结果 | 结论 |
|---|---|---|
| `pnpm typecheck` | `$ tsc -p tsconfig.json --pretty false`，无输出；`TYPECHECK_EXIT=0` | 通过 |
| `pnpm lint` | `$ node scripts/lint.mjs`；`Checking formatting...` / `All matched files use Prettier code style!`；`LINT_EXIT=0` | 通过 |
| `pnpm test:unit` | `Test Files 38 passed (38)` / `Tests 727 passed (727)` / Duration 12.50s；`UNIT_EXIT=0` | 通过（与 T6 声明的 38/727 一致） |
| `pnpm test:integration` | `Test Files 11 passed (11)` / `Tests 132 passed (132)` / Duration 22.22s；`INTEGRATION_EXIT=0`；含 `apps/cli/test/doctor.integration.test.ts (8 tests)` 9210ms 与 `container.integration.test.ts (9 tests)` 21672ms（真实容器） | 通过（**本轮 Docker 可用，环境阻塞不复现**；与 T6 的 132/132 一致） |
| `pnpm docs:check` | `docs:check ok — 15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages`；`DOCSCHECK_EXIT=0` | 通过 |
| `pnpm build` | `pnpm -r build`：contracts/pi-runtime/domain/knowledge/storage/workspace/core/cli/daemon/runner 共 10 workspace 全 `Done`；`BUILD_EXIT=0` | 通过（10 workspace 与 T6 一致） |

原始日志：`/tmp/wp06r2/logs/all.log`（六条命令完整输出）。

命令尾部原始输出：

```
TYPECHECK_EXIT=0
LINT_EXIT=0
UNIT_EXIT=0         Test Files  38 passed (38) / Tests  727 passed (727)
INTEGRATION_EXIT=0  Test Files  11 passed (11) / Tests  132 passed (132)
DOCSCHECK_EXIT=0    docs:check ok — 15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages
BUILD_EXIT=0        packages/contracts build: Done ... apps/runner build: Done
```

五项必需失败测试（`packages/core/test/delivery-failures.test.ts`，`vitest run --project unit` 单文件实跑）：

```
✓ |unit| packages/core/test/delivery-failures.test.ts (5 tests) 242ms
 Test Files  1 passed (1) / Tests  5 passed (5)
  343 '一字符高风险: a one-character permission/amount change is L3 and is not downgraded'
  501 '超L1升级: a diff above the L1 bounds upgrades the level, associates the Requirement, refills the Gate and rejects the old Plan'
  673 '过期Plan: a stale Plan cannot authorise a write; the gate says GATE_NOT_READY and the source hash is unchanged'
  756 '修复后证据失效: after a fix the previous Review/Test evidence cannot close the Finding'
  887 '未覆盖阻断: a Test result with not_covered or blocked cannot complete the Work'
```

## 13. 方法与探针清单

探针消费 `packages/{storage,domain,core}/dist`（`pnpm build` 产物），**不 import 任何产品测试文件**；涉及存储的用例均使用真实 `mkdtempSync` 临时目录 + 真实 SQLite（`ProjectStore.open`）+ 真实 `BlobStore`，证据用真实 `artifact` / `attempt` / `stage_result.checkResult` / `snapshot` 行构造。运行器：`cd /tmp/wp06r2/probe && node <script>`；日志 `/tmp/wp06r2/logs/probes.log`。

| 脚本 | 用例数 | 失败 | 说明 |
|---|---|---|---|
| `ac07-09-domain.mjs` | 38 | 0 | AC-007/008/009：L1 资格与边界、一字符高风险、升级、拒绝降级（已按 W6R1-06 新语义修正期望） |
| `ac10-12-19-domain.mjs` | 25 | 0 | AC-010/011/012 阶段链、AC-019 blocked/not_covered 语义（已补候选 Diff 证据） |
| `ac15-16-decisions.mjs` | 29 | 0 | AC-015/016：DecisionService now/later/decline、版本推进、证据失效 |
| `ac20-21-pause-cancel.mjs` | 44 | 0 | AC-020/021：安全点、Checkpoint、恢复新 Attempt（已断言 starting 窗口拒绝）、取消级联、recovery |
| `ac22-budget.mjs` | 18 | 0 | AC-022 域级原子拒绝、store 级超限提交、无静默加额（单次调用面） |
| `ac089-continue.mjs` | 34 | 0 | AC-089 待继续只读、继续建 Work、负例 |
| `ac07-09-13-14-core.mjs` | 37 | 0 | AC-007/009/013/014：真实 `PlanGateService` 批准/拒绝、零写入 |
| `adversarial.mjs` | 11 | 0 | 跨 Work Plan、旧 Revision、拒绝零写入、`now` 后旧 Plan 失效 |
| `falsify.mjs` | 18 | 0 | 第 1 轮对抗探针重跑（F1 授权撤销、F2 源码 Hash、F3/F4 Finding 证据、F5 level=none、F6 降级、F7 完成、F8 AC-089） |
| `closures.mjs` | 38 | 4 | W6R1-01/02/08 关闭核对 + 完成门禁矩阵 + 新增缺口（W6R2-01/03/04） |
| `budget2.mjs` | 14 | 2 | W6R1-03 关闭核对 + 预算重复批准（W6R2-06） |
| `route2.mjs` | 13 | 0 | W6R1-04 文档路线正/负例与 code 路线对照 |
| `authhash2.mjs` | 17 | 2 | W6R1-05/07 关闭核对（撤销/收窄/删除/源码移动）+ 期望 Hash 覆盖（W6R2-02） |
| `upgrade2.mjs` | 20 | 0 | W6R1-06：noop / upgrade / downgrade_refused 三态与零写入 |
| `resume2.mjs` | 15 | 3 | W6R1-09 关闭核对 + 任一 Attempt 就绪（W6R2-08）+ 暂停/取消后 Plan Gate（W6R2-07） |
| `continue2.mjs` | 17 | 0 | AC-089 纯投影、无 Run、不复用旧验证、二次继续拒绝 |
| `ac083.mjs` | 9 | 0 | AC-083 无 taskId 绑定、外来 Task 拒绝、Developer 不得提 Finding、旧证据失效 |
| `scope2.mjs` | 6 | 0 | W6R1-10：精确匹配边界与 Core 侧不可表达目录授权 |
| **合计** | **403** | **11** | 11 个失败即本轮 7 条新 Finding 的可复现证据（含同因重复断言） |

Docker：`docker info` 成功；`pnpm test:integration` 全绿，故 §19 无需登记容器环境阻塞。

## 14. 第 1 轮 Finding 关闭核对（W6R1-01…10）

| 编号 | 关闭判定 | 独立证据 |
|---|---|---|
| W6R1-01 | **已关闭** | 修复前 Revision 的 Review（`closures.mjs`）、`failed`/`not_covered`/无结论 Test、`failed` Review 全部被拒；修复 Revision 相等 + Test `passed` 才 `verified`，`finding_verification` 快照含 `fixingRevision`/`reviewRevision`/`testRunConclusion` |
| W6R1-02 | **已关闭** | 自述 `testResult` 被忽略（`GATE_NOT_READY`）；异 Work `NOT_AUTHORIZED`、非 test 角色、未完成 Run、无 CheckResult、异 Revision、无环境全部拒绝；通过时事件带 `testRunId`/`testEvidenceRevision`/`testEnvironmentRef`；`blocked`/未处置 `not_covered` 仍阻断，已接受 risk Decision 放行 |
| W6R1-03 | **已关闭**（单次调用面） | 域：`used 60 + reserved 30 + requested 50 > 100` ⇒ `BUDGET_EXCEEDED`；缺 `used` ⇒ `VALIDATION_ERROR`（不可能装下时 `BUDGET_EXCEEDED`）；core：真实库存 `used 95000 + reserved 4000` + `requested 2000` ⇒ 拒绝且零 artifact/零事件。**残余见 W6R2-06** |
| W6R1-04 | **已关闭** | `route:'document'` 且不带 `codeRevision`/`environmentRef`、Review 带候选 Diff ⇒ `ok:true`；缺候选 Diff、缺阶段、错依赖均拒绝；code 路线同形仍要求 Revision 与环境 |
| W6R1-05 | **已关闭** | 批准后撤销 / 收窄 `writePaths` / 收窄 `operations` / 删除授权行 ⇒ 均 `NOT_AUTHORIZED`，且 port 摘要（含行数）不变、无 `delivery.write_admitted` |
| W6R1-06 | **已关闭** | noop ⇒ 0 行变更、无升级事件、两 Plan 仍 `valid`、批准状态仍 `approved`；`downgrade_refused` ⇒ 不追加 `plan_stale`、不 invalidate、级别保持；真升级 ⇒ `stalePlanRefs` 含旧 Plan Hash、旧 artifact `invalid`、关联 Requirement |
| W6R1-07 | **已关闭**（默认路径） | 批准记录 `sourceHash` 与实时测量比较：源码移动 ⇒ `GATE_NOT_READY` + `source hash changed`；调用方期望不符亦拒绝；期望一致放行。**残余见 W6R2-02** |
| W6R1-08 | **已关闭** | `completed` 不再折算 `passed`：无 CheckResult 的 Test 视为 `blocked`；`runConclusionOf` 读持久 `CheckResult` |
| W6R1-09 | **已关闭** | 恢复后新 Attempt 为 `starting` ⇒ `writeAdmission` 拒绝（reason 含 `ready Attempt`）；置 `running` 后准入。**残余见 W6R2-08** |
| W6R1-10 | **已关闭** | `isWithinScope` 仅精确匹配（`packages/core/src` 不覆盖 `a.ts`、`srcX` 不误准入）；尾 `/` 目录授权被 `repoPathSchema`（`primitives.ts:79-80`）拒绝，故前缀分支只能被裸字符串调用方触达，边界与注释一致 |

第 1 轮 10 条 Finding 的标准全部满足；本轮 FAIL 由回归挖掘的新 P1 驱动。

## 15. 逐 AC 判定

| AC | 判定 | 依据 |
|---|---|---|
| AC-007 | PASS | L1 分类/资格、`stageOrderFor('code','L1')` 无 Plan/Test；集成 L1 全链至 CompletionManifest（`delivery.integration.test.ts:722`）。**记录 P3 W6R2-09**：`completeWork` 路线无关，L1 Work 无法经它完成 |
| AC-008 | PASS | 一字符 permission/interface/payment ⇒ L3 且不降级（域 + `upgrade2.mjs` 的 `downgrade_refused`） |
| AC-009 | PASS | 超界/逻辑改动升级、同 Work 关联 Requirement、旧 Plan `plan_stale` + artifact `invalid`，随后旧 Plan 写请求被拒 |
| AC-010 | PASS | L2 链缺阶段/缺 Requirement/错依赖均拒绝；完整链通过（`route2.mjs`、`ac10-12-19-domain.mjs`） |
| AC-011 | PASS | L3 需显式授权、回退计划、逐项审核、恢复演练证据；真实迁移输出属 WP-08 |
| AC-012 | PASS | 文档路线：候选 Diff + 独立 Review + Settlement，无代码测试与开发 Requirement（`route2.mjs` 13/13） |
| AC-013 | **PASS（带 P2 W6R2-02）** | 无批准 Plan ⇒ `GATE_NOT_READY` 且拒绝零写入；授权撤销/收窄 ⇒ `NOT_AUTHORIZED`；但调用方自带 `expectedSourceHash` 可覆盖批准记录 Hash，源码移动检测可被选择退出 |
| AC-014 | PASS | 合规 Plan 自动批准并留下依据（authorizationRef/版本/Hash/Revision），可重读校验；越界/产品变化/异 Revision 拒绝 |
| AC-015 | PASS | `now` ⇒ 新 Product/Plan 版本、Requirement 回 `product`、受影响证据失效、旧 Plan `stale` 且写被拒 |
| AC-016 | PASS | `later` ⇒ 新 Queued Requirement、当前验收不变；`decline` ⇒ 记录原因、不排队、验收不变 |
| AC-017 | PASS（带 P1 交叉引用 W6R2-01） | 提交即 `return_to_development`，失效全部有效 review/test 产物并重开 Task；**同一失效标志未被完成门禁尊重**（见 AC-019） |
| AC-018 | **PASS（带 P2 W6R2-03）** | Developer 自证拒绝、旧 Review/提 Finding 的 Review/错误角色拒绝、新独立 Review+Test 且 Revision 相等、结论 `passed` 才 `verified`；但「修复 Revision」完全取自修复 Run 自述 artifact，无「须不同于修复前证据」校验 |
| AC-019 | **FAIL（P1 W6R2-01；P2 W6R2-04）** | `blocked` 不完成、`not_covered` 需已接受风险处置、未关闭阻塞 Finding 阻断——均正确；但已被 Finding 失效的修复前 Test 证据仍可完成 Work；`work.baseRevision` 缺失时连 Revision 绑定都被跳过 |
| AC-020 | **PASS（带 P2 W6R2-07/08）** | 安全点暂停、`writeAdmission` 拒绝、恢复版本校验 + 新 Attempt（`starting` 窗口拒绝）；但 `requestCodeWrite` 不看 Work 状态，且就绪判定为「任一 Attempt」 |
| AC-021 | **PASS（带 P2 W6R2-07）** | `cancelling`→级联 `cancelled`、Attempt `stopped`、产物保留 `valid`/`integrated:false`、Requirement `cancelled`、recovery 停 `blocked`；但取消后 Plan Gate 仍准入写 |
| AC-022 | **PASS（带 P2 W6R2-06）** | 单次调用超额原子拒绝、`budgetAfter` 不变、`requiresUserTopUp`、返工额度耗尽拒绝；但批准不预留，重复批准可累计超限（`tokensReserved` 保持 0） |
| AC-083 | PASS | 无 taskId 的 document/integration Finding 绑定 Review Run + Manifest 并冻结 `finding_binding`；task 目标缺 taskId ⇒ `VALIDATION_ERROR`，外来 Task ⇒ `NOT_AUTHORIZED`，Developer Run 不得提 Finding |
| AC-089 | PASS | `listContinuable` 纯投影（7 张表行数不变）；继续创建新 Work + 预算 + 本地 Authorization、Requirement `local`/`product`/recordVersion+1，**不创建任何 Run**，`reusedPreviousVerification:false`、`reusedManifestIds:[]`、全链未满足 Gate，二次继续拒绝 |

## 16. 第 2 轮 Findings

### W6R2-01 [P1] 被 Finding 失效的修复前 Test 证据仍可完成 Work（证据失效缺口）

- 位置：`packages/core/src/findings.ts:1717-1802`（`completionEvidence`，Revision 比较见 `:1776`）；调用点 `packages/core/src/findings.ts:891`（`completeTx`）；失效只作用于产物 `packages/core/src/findings.ts:1842-1857`（`invalidateVerificationEvidence` 仅 `artifacts.invalidate`，不触碰 `run`/`stage_result`）。
- 复现：`node /tmp/wp06r2/probe/closures.mjs`（`cases=38 failed=4` 中的两条，脚本内 `cl-stalecomplete`）。步骤：先建修复前 Test Run（`role='test'`、`completed`、artifact `sourceRevision=work.baseRevision`、CheckResult `passed`、带环境）→ 由此 Review 提交 P1 Finding（该 Test artifact 被置 `invalid`，探针断言 `validity==='invalid'` 且出现在 `invalidatedEvidenceRefs`）→ 修复 Run（artifact `sourceRevision=REV_FIX`）+ `markAddressed` → 用修复后 Review/Test 正常 `verifyFinding` 关闭 Finding → `completeWork({workId, testRunId: <修复前 Test Run>})`。
- 观察：`ok:true`，Work 转 `completed`，事件 `delivery.work_completed` 的 `testEvidenceRevision` 仍是修复前 Revision；探针断言「失效证据不得完成」失败（`"the Work is not completed on stale evidence" — completed`）。
- 期望：`workflow.md` §7「候选树/语义依据一致才可复用有效证据」、§5.2「done 依赖的代码失效时撤销引用有效性」、AC-017「旧结果无效」；完成门禁必须只接受**未被失效且晚于修复**的 Test 证据。
- 契约/AC：AC-017、AC-019；`workflow.md` §6/§7。
- 成因：`work.baseRevision` 在修复过程中从不推进（`grep works.update` 全仓库无 `baseRevision` 写入；`requirement-continue.ts:244` 仅在新建时可空），因此 `revision === work.baseRevision` 对修复前证据恒成立；`completionEvidence` 又不检查 `artifact.validity`、不比较 Test Run 与修复 Run 的先后。
- 修复方向：`completionEvidence` 追加「① 该 Test Run 的有效 review/test 产物未被 `invalid`；② `testRun.createdAt > fixRun.createdAt`（或 Revision ≠ 被失效证据的 Revision）」，并在 `markAddressed`/修复接受时把 `work.baseRevision` 推进到修复后 Revision；补「Finding 关闭后不得用旧 Test 完成」的回归测试。

### W6R2-02 [P2] 调用方自带的 `expectedSourceHash` 覆盖批准记录 Hash，源码移动检测可被选择退出

- 位置：`packages/core/src/gates.ts:813-819`（`input.expectedSourceHash ?? (recordedSourceHash === '' ? contentBefore : recordedSourceHash)`），消费点 `:833-834`。
- 复现：`node /tmp/wp06r2/probe/authhash2.mjs`（`cases=17 failed=2`，`hash-override`）：批准 Plan 时测量 `content='a'×40` → 源码移动为 `'b'×40` → `requestCodeWrite({..., expectedSourceHash:'b'.repeat(40)})`。
- 观察：`allowed:true`（`code:null`），未追加拒绝、写入被准入；若省略 `expectedSourceHash` 同一状态则正确 `GATE_NOT_READY`（`hash-moved` 用例通过）。
- 期望：T6-07 声明「源码移动可被拒绝」；AC-013「无批准 Plan 的写请求 ⇒ GATE_NOT_READY 且源码 Hash 不变」的保护不应由被约束方一键关闭。
- 契约/AC：AC-013；`execution.md` §4。
- 修复方向：批准记录的 `sourceHash` 与实时测量必须**无条件**相等（调用方期望只能作为额外的第二重比较），或删除 `expectedSourceHash` 覆盖语义、把「写前测量」并入批准记录比对。

### W6R2-03 [P2] Finding 关闭的「修复 Revision」完全取自修复 Run 自述 artifact，缺少「必须不同于修复前证据」校验

- 位置：`packages/core/src/findings.ts:715`（`const fixingRevision = this.runRevisionOf(fixRun.id)`）与 `:1685-1699`（`runRevisionOf` 取该 Run 最新 artifact 的 `sourceRevision`）；域侧 `packages/domain/src/delivery.ts:1318-1345`（只做相等比较）。
- 复现：`node /tmp/wp06r2/probe/closures.mjs`（`cl-selfrev`）：修复 Run 的 artifact 仍标注**修复前** Revision，新 Review/Test 亦标注同一修复前 Revision 且 Test `passed`。
- 观察：`ok:true, state:'verified'`，Finding 被关闭，`finding_verification.fixingRevision` = 修复前 Revision；即整条关闭链的证据都仍是 Finding 已判定「旧结果无效」的那个 Revision。
- 期望：AC-017/AC-018「修复后重新独立 Review」要求验证证据属于修复**后**的树；只锚定修复 Run 的自述值让「修复后」退化为「修复 Run 说是什么就是什么」。
- 契约/AC：AC-017、AC-018；`data.md` §3 `VerificationManifest`（`codeRevision`）。
- 修复方向：`markAddressed`/`verifyTx` 增加不变量「`fixingRevision` 必须等于 Work 当前 Revision（`work.baseRevision`）」，或在 `markAddressed` 记录修复前 Revision 并要求 `fixingRevision !== 修复前 Revision`；服务端有 Revision 全序前至少拒绝与 Findings 失效证据相同的 Revision。

### W6R2-04 [P2] `work.baseRevision` 缺失时完成门禁跳过 Revision 绑定

- 位置：`packages/core/src/findings.ts:1776`（`if (work.baseRevision !== undefined && revision !== work.baseRevision)`）。
- 复现：`node /tmp/wp06r2/probe/closures.mjs`（`cw-norev`）：`addWork({baseRevision: null})` 后建一个 Revision 为任意串（`'7'×40`）的 Test Run，直接 `completeWork`。
- 观察：`ok:true`，Work `completed`，事件记录该任意 Revision。可达性：`Work.baseRevision` 为可选字段，`requirement-continue.ts:244` 创建的 Work 在调用方不给 `baseRevision` 时即为缺失（AC-089 路径）。
- 期望：T6-02 声明「Revision 必须等于 `work.baseRevision`」；缺失即无从绑定，应 `GATE_NOT_READY` 而非放行。
- 契约/AC：AC-019；`data.md` §2 `work.baseRevision`。
- 修复方向：`work.baseRevision` 缺失时拒绝完成（fail-closed），或要求 Test 证据携带的 `VerificationManifest.codeRevision` 作为唯一绑定来源。

### W6R2-05 [P2] 冻结 `VerificationManifest` 回退路径为死分支（id 与 hash 键空间不可能相交），T6 相关声明不被代码支持

- 位置：`packages/core/src/findings.ts:1824-1839`（`SELECT payload FROM snapshot WHERE hash = ?`，参数为 `stage_result.manifest_id`）；消费点 `:1768`（`manifest?.codeRevision`）、`:1784`（`manifest?.environmentRef`）、`:1700`（`runRevisionOf` 的 Manifest 回退）；契约侧 `packages/contracts/src/entities/run.ts:81`（`manifestId: idRefSchema` = UUIDv7）；存储侧 `packages/storage/src/schema.ts:294-300`（`snapshot.hash ... CHECK (length(hash) = 64)`，`PRIMARY KEY (type, hash)`）。
- 复现：`node /tmp/wp06r2/probe/closures.mjs`（`cw-manifest`，3 条断言全部通过）：① 以 UUIDv7 作为 `snapshot.hash` 插入被 CHECK 拒绝；② `stage_result` 的 `manifestId` 传 64 位 Hash 被契约 Schema 拒绝（`CONSTRAINT_VIOLATION`）；③ 只用合法 `manifestId`（UUIDv7）+ 无 artifact 的 Test Run ⇒ `completeWork` 报 `binds no frozen revision`。
- 观察：`stage_result.manifest_id` 与 `snapshot.hash` 的取值范围不相交，`frozenManifestOf()` 恒返回 `undefined`；`completionEvidence` 的 Revision 实际只来自 Test Run 自己的 artifact，环境只来自 `checkResult.checks[0].environmentRef`。
- 期望：实现记录 T6-01「回退 `VerificationManifest.codeRevision`」与 T6-02「环境引用来自冻结 `VerificationManifest` 或 `CheckResult`」应被代码支持；`data.md` §3 `TestResult` 的 `manifestId` 绑定应可用。
- 契约/AC：AC-018/AC-019；`data.md` §3。
- 修复方向：`stage_result.manifest_id` 改为（或新增）保存 `snapshot.hash`（引用校验相应调整），或让 `frozenManifestOf` 通过 `manifestId → snapshot` 的显式映射读取；同时补一条「无 artifact、仅有冻结 Manifest 的 Test 运行可完成」的正例或删除该死分支并在记录中标注不可用。

### W6R2-06 [P2] Plan 批准不预留/不记账 `requestedTokens`，重复批准可累计超限（预算欠计费）

- 位置：`packages/core/src/gates.ts:605-631`（读 `budget.tokensUsed/tokensReserved` 后调 `evaluatePlanApproval`）与 `:655-662`（仅追加批准快照）；`tokensReserved` 的唯一写入方是 Run 派发路径 `packages/core/src/run-lifecycle.ts:87-100`（`reserve`/`settle`）。
- 复现：`node /tmp/wp06r2/probe/budget2.mjs`（`cases=14 failed=2`，`bud-double`）：Work 预算 `limit=100, used=0, reserved=0`，连续提交两份 Plan，各 `requestedTokens=60`。
- 观察：两次均 `approved:true`（`60+60 > 100`），且 `budget.tokensReserved` 仍为 `0`（断言失败）；即「无静默加额」只在单次调用内成立，批准阶段可无限重复消耗同一额度。
- 期望：AC-022「尝试预留超额 ⇒ 原子拒绝；用户增加预算后继续，无静默加额」；`reliability.md` §3「模型调用前预留…并行调用共享 Work 预算事务，防止双花」。
- 契约/AC：AC-022；`reliability.md` §3。
- 修复方向：`submitPlanTx` 在同一事务内把 `requestedTokens` 计入预算（`tokensReserved += requested`），或落一条「已批准请求」记录并在 `evaluatePlanApproval` 的 `reserved` 中反映；WP-02 的 `RunLifecycle.reserve` 到位前至少不得让批准路径无痕。

### W6R2-07 [P2] `requestCodeWrite` 不读 Work 的暂停/取消状态，暂停或取消后仍准入代码写

- 位置：`packages/core/src/gates.ts:713-735`（只判存在与 Revision，从不读 `work.status`）与 `:776-876`（完整准入路径）；对照 `packages/core/src/findings.ts:1042-1055`（`writeAdmission` 对 `paused`/`cancelling`/`cancelled` 一律拒绝）。
- 复现：`node /tmp/wp06r2/probe/resume2.mjs`（`cases=15 failed=3`）：批准 Plan + 运行 Run 后 ① `pauseWork` ② `cancelWork`，分别调用 `requestCodeWrite({workId, revision, targets})`。
- 观察：两种状态下均 `allowed:true`（返回 `planRef`/`evidenceRefs`，`sourceHash===sourceHashAfter`）；同时 `writeAdmission` 正确拒绝。两个公共写门禁对暂停/取消的语义不一致，暂停屏障可被另一个门禁绕过。
- 期望：`workflow.md` §7「暂停停止新准入」；AC-020「无新写入」、AC-021 取消后不得继续写。
- 契约/AC：AC-020、AC-021。
- 修复方向：`requestCodeWrite` 在批准记录之外读 `work.status`（`paused`/`cancelling`/`cancelled`/`failed` ⇒ `INVALID_STATE`），或让 Broker 接线强制「两个门禁都通过」（WP-07）并在本包把状态检查补上，保持与 `writeAdmission` 单一事实来源。

### W6R2-08 [P2] `writeAdmission` 的就绪判定是「任一 Attempt 为 running」，而非「最新 Attempt 就绪」

- 位置：`packages/core/src/findings.ts:1085-1092`（`attempts.find(a => a.status === 'running')`，`orderBy: 'number DESC'` 只影响遍历顺序，遇到更旧的 `running` 仍返回它）；`:1063-1070` 消费。
- 复现：`node /tmp/wp06r2/probe/resume2.mjs`（`res-anyattempt`）：Run 同时存在 Attempt#1 `running` 与 Attempt#2 `starting`，调用 `writeAdmission`。
- 观察：`admitted:true`，reason 指向旧的 `ready Attempt`；而注释/记录（T6-09）声明的是「最新 Attempt 达到 ready 才准入」。
- 期望：`reliability.md` §2「每次 Attempt 分配递增 epoch…ready 确认 epoch/进程标识/环境后 Running」；恢复窗口的目的（W6R1-09）是让新 Attempt 未就绪前不可写。
- 契约/AC：AC-020；`reliability.md` §2。
- 修复方向：取 `number DESC` 的第一条 Attempt，仅当其 `status==='running'` 才准入（`starting`/`stopped` 一律拒绝）；`RunLifecycle.beginAttempt`（`run-lifecycle.ts:111-141`）也应在开新 Attempt 时确认旧 Attempt 不是 `running`。

### W6R2-09 [P3] `completeWork` 路线无关，L1 Work（AC-007 明确无 Test Run）无法经其完成

- 位置：`packages/core/src/findings.ts:888-900`（无条件要求 `testRunId`）与 `:1717-1730`（Test Run 校验）。
- 复现：`node /tmp/wp06r2/probe/closures.mjs`（`cw-l1`）：L1 Work（`level='L1'`）调用 `completeWork({workId})`。
- 观察：`GATE_NOT_READY`（`no Test Run is bound`），Work 保持 `running`；而 AC-007 的 L1 链「直到 CAS 和 CompletionManifest 完成均无 Planning/Test Run」，本包内 L1 的完成只能在集成测试中手工拼装（`delivery.integration.test.ts:722`，未调用 `completeWork`）。
- 期望：AC-007 的 L1 路线应有一条不依赖 Test Run 的完成路径（或明确登记为 WP-08 范围）。本条不阻断：完成清单最终绑定属 WP-08。
- 契约/AC：AC-007、AC-019。
- 修复方向：给 `CompleteWorkInput` 增加 route/level，或在 WP-08 的 CompletionManifest 路径为 L1 提供 ReviewCheck 证据入口；至少在 T6 残余中登记。

### W6R2-10 [P3] 文档路线「候选 Diff」证据是子串匹配，几乎不构成约束

- 位置：`packages/domain/src/delivery.ts:653-657`（`namesCandidateDiff`：`text.includes('diff') || text.includes('candidate')`）。
- 复现：`node /tmp/wp06r2/probe/route2.mjs` 的最后一条（`we saw no diff at all` 亦通过）。
- 观察：任意含 `diff`/`candidate` 字样的字符串即满足 AC-012 的证据项，空泛声明与真实候选 Diff 不可区分。
- 期望：AC-012「Product/Planning 候选 Diff、独立 Review」中的证据应可追溯到具体产物引用（Artifact/Ref）。
- 契约/AC：AC-012。
- 修复方向：把 Review 证据改为结构化引用（候选 Diff 的 artifact ref/hash）而非自由文本；若保持文本，至少要求路径形态。

## 17. 计数与阻断表

| 严重性 | 数量 | 编号 | 是否阻断 | 说明 |
|---|---|---|---|---|
| P0 | 0 | — | — | — |
| P1 | 1 | W6R2-01 | **阻断** | 被 Finding 失效的修复前 Test 证据仍可完成 Work，直击 AC-017/AC-019 与 `workflow.md` §7 的证据复用前提 |
| P2 | 7 | W6R2-02, 03, 04, 05, 06, 07, 08 | 不阻断（已说明影响面） | 02 源码移动检测可被选择退出（AC-013）；03 关闭链可锚定修复前 Revision（AC-018）；04 baseRevision 缺失即无绑定（AC-019）；05 Manifest 回退死分支（记录不实）；06 预算可重复批准超限（AC-022）；07 暂停/取消后 Plan Gate 仍准入（AC-020/021）；08 就绪判定用旧 Attempt（AC-020） |
| P3 | 2 | W6R2-09, 10 | 不阻断 | 09 L1 无完成路径（WP-08 范围）；10 候选 Diff 子串匹配 |
| 合计 | 10 | — | — | 第 1 轮 10 条 Finding 全部关闭 |
| 第 1 轮遗留 | 0 | — | — | W6R1-01…10 逐条验证关闭 |

验收面结论：存在 1 个可复现 P1 ⇒ **FAIL**，不进入独立 Test。

## 18. 记录核对（implementation.md T1–T6）

- **用例数声明准确**：`pnpm test:unit` 38 文件/727 用例与 T6 完全一致（T5 为 717，+10 条回归）；`pnpm test:integration` 132/132 与 T6 一致，且本轮 Docker 可用，`doctor`/`container` 真实容器用例确实通过；`pnpm build` 10 workspace、`docs:check` 输出与 T6 逐字一致。
- **T6 逐条与代码核对**：W6R1-01/08（`VerificationRun.revision` + 真实 `CheckStatus`、`fixingRevision`、快照三字段）、02（`CompleteWorkInput.testRunId`、`completionEvidence`、`TestResultInput` 已删除）、03（`PlanApprovalInput.budget.used` 必填 + 运行时 fail-closed）、04（`stageEvidenceGaps(stage, manifest, route)` 与文档证据项）、05（`writeAuthorization` 重读信封）、06（`LevelUpgradeOutcome` 三态与 `noop`/`downgrade_refused` 零写入）、07（批准记录 `sourceHash` + `expectedSourceHash`）、09（先开 Attempt 再置 Run `running`；`writeAdmission` 增 Attempt 条件）、10（`isWithinScope` 注释边界）均与代码一致，回归测试名称与 T6 描述一致。
- **过度/不实声明 2 处**：(a) T6-01「回退 `VerificationManifest.codeRevision`」与 T6-02「环境引用来自冻结 `VerificationManifest` 或 `CheckResult`」——Manifest 回退分支因 `manifest_id`(UUIDv7) 与 `snapshot.hash`(64 hex) 键空间不相交而恒不可达（W6R2-05）。(b) T6-07「准入时…源码移动可被拒绝」——仅在调用方不提供 `expectedSourceHash` 时成立（W6R2-02）。
- **残余清单**：T6 登记 5 项（「或更晚的 Revision」未实现全序、`completeWork` 不含集成/CAS/Settlement/预算复核、Attempt ready 确认上限、operation 路线证据沿用 code、Grant/Broker 属 WP-07）均属实；但**未登记**本次复现的 W6R2-01（失效证据完成）、W6R2-05（Manifest 死分支）、W6R2-06（批准不预留）、W6R2-07（暂停/取消与 Plan Gate 不一致）。T6 残余 2「预算 `used+reserved<=limit` 的完成前复核未新增」与 W6R2-06 同源但更窄。
- **测试覆盖缺口**：`findings.test.ts` 无「Finding 关闭后不得用旧 Test 完成」用例（grep 确认无该组合），故 W6R2-01 未被已提交测试覆盖。

## 19. 覆盖限制

1. **Docker 本轮可用**：`pnpm test:integration` 11 文件/132 用例全通过（含真实容器），无环境阻塞登记；容器级隔离负例仍属 WP-07/WP-10 的完整复验。
2. **未接线的上层**：本包服务尚无 HTTP/WS/Broker 消费者；W6R2-01/02/06/07/08 的可达性来自**包公共 API 的直接调用**（WP-07/WP-08/WP-09 将以此为接线面），非端到端页面路径。
3. **`work.baseRevision` 语义**：本轮以「修复不推进 baseRevision」的现状证明 W6R2-01；若 WP-08 设计上由 Git 交付路径推进 baseRevision，则该 Finding 退化为接线前提缺失，但当前冻结树的行为仍是 fail-open。
4. **Revision 全序**：服务端无 Git 祖先关系，W6R2-03 只能证明「修复前 Revision 可被接受」，无法评估「后代 Revision 放宽」方案。
5. **预算端到端**：W6R2-06 只证明批准路径不预留；派发/核销（`RunLifecycle.reserve/settle`）的并发双花防护未做并发压测（属 WP-02/WP-08）。
6. **Attempt 就绪**：W6R2-08 在持久状态层证明（构造 `running`+`starting` 双 Attempt）；具体哪些调用序列会留下旧 `running` Attempt（`beginAttempt`/interrupt/重启恢复）未逐一构造，`RunLifecycle` 的完整恢复演练属 WP-05/WP-07。
7. **未读取任何开发/Test 聊天或会话记录**；探针由 `dist` 类型声明、公开 API 与正式文档编写，不 import 任何产品测试文件。
8. **未运行** `pnpm test:e2e`/`test:acceptance`/`test:live`（按契约返回 NOT_IMPLEMENTED，属 WP-09/WP-10）。

## 20. 能否进入独立 Test

**否。** 第 1 轮 10 条 Finding 已全部关闭且六条契约命令全绿，但回归挖掘在冻结点 `6996405` 复现出 1 个 P1（W6R2-01：`completeWork` 接受被 Finding 失效的修复前 Test 证据，AC-017/AC-019 未满足）。建议按 W6R2-01…08 修复后重新提交独立 Review；修复必须包含负例测试：①失效（`invalid`）Test 证据完成 Work ⇒ `GATE_NOT_READY`；②带 `expectedSourceHash` 的移动源码写 ⇒ 仍拒绝；③修复 Run 自述修复前 Revision 的关闭请求 ⇒ 拒绝；④`baseRevision` 缺失的完成请求 ⇒ 拒绝；⑤连续两份超额度 Plan ⇒ 第二份 `BUDGET_EXCEEDED`；⑥暂停/取消后的 `requestCodeWrite` ⇒ 拒绝；⑦`running`+`starting` 双 Attempt ⇒ `writeAdmission` 拒绝。

---

# WP-06 独立 Review 报告（第 3 轮：修复复核、回归与新缺陷挖掘）

## 21. 元数据与冻结点（第 3 轮）

| 项 | 值 |
|---|---|
| 冻结点（task 指定） | `4f5a1f3`（`4f5a1f3b7fc31a4cb7fdce0d89ab96e327164c37`，`fix(domain,core): close WP-06 review round-2 findings via a shared evidence rule`） |
| `git rev-parse HEAD` | `4f5a1f3b7fc31a4cb7fdce0d89ab96e327164c37`（= 冻结点） |
| `git rev-parse 4f5a1f3^{tree}` | `18bfe7298b4065e7e3ecb8c6a916d77f9c271ebb` |
| `git status --porcelain`（本报告追加前） | 空（工作树干净） |
| 第 1、2 轮报告保真 | 追加前 `git show HEAD:.agentdev/work/WP-06/review.md \| shasum -a 256` = 工作树 `shasum -a 256` = `86a10b2f10acc80791d00519badec8f3867d859aa4bf2ac20671d579e897aade`；追加后 `git diff --numstat` 仅新增行、零删除（见 §28） |
| Review 写入范围 | 仅 `.agentdev/work/WP-06/review.md`（追加第 3 轮）；探针只在 `/tmp/wp06r3/` |
| 开发/Test 聊天 | **未读取**；证据来自仓库文件、`packages/*/dist` 构建产物、`git show <rev>:<path>` 与本次独立探针 |
| 环境 | macOS 26.5.1，Node v24.8.0，**Docker 守护进程可用**（`docker info` 成功），`pnpm test:integration` 11 文件/132 用例全通过（含真实容器用例） |
| 被审改动 | `4f5a1f3` 相对 `9981902`：`packages/domain/src/delivery.ts`、`packages/core/src/{gates,findings}.ts` + 4 个测试文件 + `implementation.md`（9 文件，+1948/−153）；`decisions.ts`/`requirement-continue.ts` 未改动（与 T7 声明一致） |

被审代码 Hash（`git rev-parse 4f5a1f3:<path>` = git blob；`shasum -a 256` = 工作树字节）：

| 文件 | git blob | sha256 |
|---|---|---|
| `packages/domain/src/delivery.ts` | `b7833fc32be38a4d56a7919229fe16f8647d6675` | `1473638b9c4dec4e0686b46e96967e2e6b101ed8c20448747ab0518a302a3220` |
| `packages/core/src/gates.ts` | `5b51f9259090f61d2f856b31fe4f31a5adccf826` | `cb38a024f31594f1880dd8ba1942804700919640bfb2327533f2e9e19a546127` |
| `packages/core/src/findings.ts` | `4c7671a02fcc0dc608f8346bd14c55c0c78a5cfd` | `49850140cdd7a6de4b08c5888b5725ebeb267d663a4605ecded34550045a6c25` |
| `packages/domain/test/delivery.test.ts` | `cefab30a9f56581c4192bf789a4075883d7154e2` | `197c220596e754e7cb338ddc0d2bf1a7b8465b04200d9798b0d00764a061e110` |
| `packages/core/test/findings.test.ts` | `a463e4a67e392afd5ee9a45dbbd675a5001d3416` | `80d17ef880e84751dc6eb0feb490a2374598402ef83fce0a9e95a9a8eb34a006` |
| `packages/core/test/gates.test.ts` | `80dc09d498d039039c37fe35d42774673717907f` | `b097eb61b588d5f91c6b66aa5cebf6cff0a3b5eba57c4aa2dc85111a3c89da7f` |
| `packages/core/test/delivery-failures.test.ts` | `c19eb1427e74eaeaa95ab827f8de423361a1621e` | `2b2f2861d1640451c8289b10662198a845b999903c8fe162949c35ee84076753` |
| `packages/core/test/delivery.integration.test.ts` | `c689008ec538176a9688be538bd3fcbc5b7700c4` | `e0a054cd4227919e7dc8c699ed2ced964779c78042c2469f2c27e4ae46e46431` |

## 22. 结论（verdict）

**FAIL** — 第 2 轮 10 条 Finding（W6R2-01…10）经本次独立探针**逐条关闭**（10/10，见 §25；W6R2-03 的口径内判定通过，其残余另立 W6R3-03），六条契约命令全部通过（Docker 可用，integration 132/132；unit 749/749），但回归挖掘在冻结树 `4f5a1f3` 的公共 API 上复现出 **1 个 P1**：

- **W6R3-01（P1）`completeWork` 的完成路线由调用方声明、且不与 Work 的持久事实（`intent`/`level`）交叉校验**：一个 `intent='delivery'`、`level='L2'`（或 `L3`）的代码 Work，只要调用方传 `route:'document'`，就能**仅凭 Review 证据 + 冻结 CompletionManifest 完成，零 Test Run**，直接违反 `workflow.md` §7「L2/L3代码使用独立Review和Test」。这是 `4f5a1f3` **新引入的 fail-open 回归**：修复前的 `completionEvidence(input.testRunId, work)`（`9981902:packages/core/src/findings.ts:891`）无条件要求 Test Run，路由参数化（W6R2-09）把它换成了调用方自选规则。

另有 **3 个 P2 + 3 个 P3**（非阻断但已记录）：W6R3-02（共享写屏障漏 `completed`/`failed`/`blocked`，完成后仍准入代码写）、W6R3-03（共享规则的 `invalidatedRevisions` 分支生产代码零生产者）、W6R3-04（无 `baseRevision` 的 Work 在写门禁与等级升级血缘中跳过 Revision 绑定）、W6R3-05/06/07（P3，见 §27）。

**能否进入独立 Test：否。** 需返回 Develop 修复 W6R3-01（建议同批处理 P2），修复后重新走独立 Review。

## 23. 契约命令原始结果

| 命令 | 原始结果 | 结论 |
|---|---|---|
| `pnpm typecheck` | `$ tsc -p tsconfig.json --pretty false`，无输出；`TYPECHECK_EXIT=0` | 通过 |
| `pnpm lint` | `$ node scripts/lint.mjs`；`Checking formatting...` / `All matched files use Prettier code style!`；`LINT_EXIT=0` | 通过 |
| `pnpm test:unit` | `Test Files 38 passed (38)` / `Tests 749 passed (749)` / Duration 15.95s；`UNIT_EXIT=0` | 通过（与 T7 声明的 38/749 逐字一致） |
| `pnpm test:integration` | `Test Files 11 passed (11)` / `Tests 132 passed (132)` / Duration 16.51s；`INTEGRATION_EXIT=0`；含 `apps/cli/test/doctor.integration.test.ts (8 tests)` 7599ms 与 `container.integration.test.ts (9 tests)` 16028ms（真实容器） | 通过（**Docker 可用，环境阻塞不复现**；与 T7 的 132/132 一致） |
| `pnpm docs:check` | `docs:check ok — 15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages`；`DOCSCHECK_EXIT=0` | 通过 |
| `pnpm build` | `pnpm -r build`：contracts/pi-runtime/domain/knowledge/storage/workspace/core/cli/daemon/runner 共 **10 workspace** 全 `Done`；`BUILD_EXIT=0` | 通过（10 workspace 与 T7 一致） |

原始日志：`/tmp/wp06r3/logs/contracts.log`（typecheck/lint/docs:check/build）、`/tmp/wp06r3/logs/unit.log`、`/tmp/wp06r3/logs/integration.log`。

命令尾部原始输出：

```
TYPECHECK_EXIT=0
LINT_EXIT=0      Checking formatting... / All matched files use Prettier code style!
UNIT_EXIT=0      Test Files  38 passed (38) / Tests  749 passed (749)
INTEGRATION_EXIT=0  Test Files  11 passed (11) / Tests  132 passed (132)
DOCSCHECK_EXIT=0 docs:check ok — 15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages
BUILD_EXIT=0     packages/contracts build: Done ... apps/runner build: Done (10 workspace)
```

五项必需失败测试（`node_modules/.bin/vitest run --project unit packages/core/test/delivery-failures.test.ts --reporter=verbose`）：

```
✓ |unit| packages/core/test/delivery-failures.test.ts > required WP-06 failure tests > 一字符高风险: a one-character permission/amount change is L3 and is not downgraded 43ms
✓ |unit| ... > 超L1升级: a diff above the L1 bounds upgrades the level, associates the Requirement, refills the Gate and rejects the old Plan 38ms
✓ |unit| ... > 过期Plan: a stale Plan cannot authorise a write; the gate says GATE_NOT_READY and the source hash is unchanged 31ms
✓ |unit| ... > 修复后证据失效: after a fix the previous Review/Test evidence cannot close the Finding 59ms
✓ |unit| ... > 未覆盖阻断: a Test result with not_covered or blocked cannot complete the Work 29ms
 Test Files  1 passed (1) / Tests  5 passed (5)
```

## 24. 方法与探针清单

探针消费 `packages/{storage,domain,core}/dist`（`pnpm build` 产物），**不 import 任何产品测试文件**；涉及存储的用例均使用真实 `mkdtempSync` 临时目录 + 真实 SQLite（`ProjectStore.open`）+ 真实 `BlobStore`，证据用真实 `artifact` / `attempt` / `stage_result.checkResult` / `snapshot` 行构造。运行器：`/tmp/wp06r3/probe/run-all.sh`，日志 `/tmp/wp06r3/logs/aggregate.log`。

方法说明：第 3 轮新增 4 个脚本；同时把**第 2 轮的 19 个探针原样搬到 `/tmp/wp06r3/probe/`（仅改 harness 路径）**重跑，用同一批断言做回归与反证——它们当初被判为「W6R2-CANDIDATE（旧行为）」的用例现在应当反向通过，因此是关闭核对最直接的证据；其中因接口按 T7 变更（如删除 `testResult`、`LevelUpgradeInput.workRevision` 必填、修复 Run 必须有新 Revision）而失效的旧断言单列为「探针期望漂移」，不计为缺陷。

| 脚本 | 用例数 | 失败 | 说明 |
|---|---|---|---|
| `closures3.mjs` | 37 | 0 | **关闭核对**：W6R2-01（失效证据/Revision 推进/血缘顺序）、W6R2-03、W6R2-04、W6R2-05（声明式 manifestId 命中 + 精确拒绝消息）、W6R2-08（最新 Attempt 就绪） |
| `gates3.mjs` | 47 | 7 | **关闭核对 + 挖掘**：W6R2-02/06/07 关闭；屏障「八状态 × 两门禁」对照；真实 `completed`/`blocked` 链上的写准入（W6R3-02）；无 `baseRevision` 的写准入（W6R3-04）。7 失败 = 6 条 W6R3-02 证据 + 1 条探针期望漂移（FK 使「无预算行」不可达） |
| `route3.mjs` | 33 | 3 | **关闭核对 + 挖掘**：W6R2-09（L1 无 Test 完成、L2/L3 仍需 Test、document/operation 各自规则、未知 route/level fail-closed）、W6R2-10（结构化 Ref）。3 失败全部是 **W6R3-01** 的 P1 证据 |
| `extra3.mjs` | 9 | 2 | **挖掘**：无 `baseRevision` 的 Work 在等级升级后旧 Plan 不打 stale/不失效且仍可写（**W6R3-04**）；完成事件对 review 证据的字段语义（W6R3-07，OBS） |
| `r2-ac07-09-domain.mjs` | 38 | 1 | AC-007/008/009 域级；1 失败 = 旧断言未传新必填 `workRevision`（漂移） |
| `r2-ac07-09-13-14-core.mjs` | 37 | 0 | AC-007/009/013/014：真实 `PlanGateService` 批准/拒绝、零写入 |
| `r2-ac083.mjs` | 9 | 0 | AC-083 绑定、外来 Task、Developer 不得提 Finding |
| `r2-ac089-continue.mjs` | 34 | 0 | AC-089 待继续只读、继续建 Work、负例 |
| `r2-ac10-12-19-domain.mjs` | 25 | 1 | AC-010/011/012/019 域级；1 失败 = 文档链现要求 `candidateDiffRef`（W6R2-10 的**预期**变更） |
| `r2-ac15-16-decisions.mjs` | 29 | 0 | AC-015/016 now/later/decline、版本推进、证据失效 |
| `r2-ac17-19-83-findings.mjs` | 26 | 7 | AC-017/018/019/083；7 失败全为旧 API 漂移（已删除的 `testResult` 自述入口、修复 Run 无 Revision） |
| `r2-ac20-21-pause-cancel.mjs` | 44 | 0 | AC-020/021：安全点、Checkpoint、恢复新 Attempt、取消级联、recovery |
| `r2-ac22-budget.mjs` | 18 | 0 | AC-022 域级原子拒绝、store 级超限、无静默加额 |
| `r2-adversarial.mjs` | 11 | 0 | 跨 Work Plan、旧 Revision、拒绝零写入、`now` 后旧 Plan 失效 |
| `r2-authhash2.mjs` | 17 | 0 | 撤销/收窄/删除授权 + 源码移动 + 期望 Hash 覆盖（W6R2-02 反向通过） |
| `r2-budget2.mjs` | 14 | 0 | 预算计费与重复批准（W6R2-06 反向通过） |
| `r2-closures.mjs` | 38 | 3 | W6R1-01/02/08 关闭核对 + W6R2-01/04/05 反向通过；3 失败 = 1 条 **W6R3-03** 证据 + 2 条漂移（拒绝消息改写、级联的 Finding 未 addressed） |
| `r2-continue2.mjs` | 17 | 0 | AC-089 纯投影、无 Run、不复用旧验证、二次继续拒绝 |
| `r2-falsify.mjs` | 18 | 0 | 第 1 轮对抗探针重跑（F1…F8） |
| `r2-resume2.mjs` | 15 | 0 | W6R1-09 关闭 + W6R2-07/08 反向通过 |
| `r2-route2.mjs` | 13 | 2 | W6R1-04 文档路线；2 失败 = 文档链现要求 `candidateDiffRef`（**预期**变更） |
| `r2-scope2.mjs` | 6 | 0 | W6R1-10 精确匹配边界 |
| `r2-upgrade2.mjs` | 20 | 0 | W6R1-06：noop / upgrade / downgrade_refused 三态与零写入 |
| **合计** | **555** | **26** | 12 条为真缺陷证据（W6R3-01×3、W6R3-02×6、W6R3-03×1、W6R3-04×2），14 条为探针期望漂移（接口按 T7 变更或拒绝消息改写），逐条在 §25/§27 说明 |

Docker：`docker info` 成功；`pnpm test:integration` 全绿，故无容器环境阻塞登记。

## 25. 第 2 轮 Finding 关闭核对（W6R2-01…10）

| 编号 | 关闭判定 | 独立证据 |
|---|---|---|
| W6R2-01 | **已关闭** | `closures3.mjs`：修复前 Test artifact 被 `submitFinding` 置 `invalid` 并列入 `invalidatedEvidenceRefs`；`markAddressed` 把 `work.baseRevision` 由 `REV` **推进**到 `REV_FIX`；同一失效 Test 再 `completeWork` ⇒ `GATE_NOT_READY` 且消息含 `invalid`、Work 保持 `running`、`delivery.work_completed` 事件数 0；随后以闭环后的 post-fix Test（`REV_FIX`）完成 ⇒ `ok:true`，事件 `testEvidenceRevision=REV_FIX`。血缘顺序分支亦验证：Revision 相同但 `createdAt <= fixEvidenceAt` 的证据被拒（`PRODUCED_BEFORE_FIX`）。`r2-closures.mjs` 的 `cl-stalecomplete` 由旧行为 `ok:true` 反转为通过 |
| W6R2-02 | **已关闭** | `gates3.mjs`：把移动后的值当 `expectedSourceHash` 传入 ⇒ `GATE_NOT_READY`（`hash-override` 反向通过），零写入事件、digest 不变；无期望时源码移动同样拒绝；期望与批准 Hash 一致时放行，仅期望不符时追加拒绝（`delivery.ts:1036-1047` 两重比较）。`r2-authhash2.mjs` 17/17 全通过 |
| W6R2-03 | **已关闭（口径内）** | `closures3.mjs`：修复 Run 自述 `work.baseRevision` 同一 Revision ⇒ `markAddressed` 拒绝（`GATE_NOT_READY`）、Finding 保持 `open`、`baseRevision` 不变；修复 Run 完全无 Revision 亦拒绝。域侧 `findingCanBeVerified` 要求 `fixingRevision === currentWorkRevision`（缺失 fail-closed）。**残余另立 W6R3-03**（被失效证据的 Revision ≠ `work.baseRevision` 时仍可锚定） |
| W6R2-04 | **已关闭** | `closures3.mjs`：`baseRevision: null` 的 Work 用任意 Revision 的 Test ⇒ `GATE_NOT_READY`、Work 保持 `running`；同形但有 `baseRevision` 的 Work 正常完成（对照证明拒绝来自绑定）。`r2-closures.mjs` 的 `cw-norev` 反向通过 |
| W6R2-05 | **已关闭** | `closures3.mjs`：无 artifact 的 Test Run 经 `stage_result.manifest_id`（UUIDv7）解析到 **payload 声明的 `manifestId`** ⇒ 完成成功，`testEvidenceRevision` 来自 `manifest.codeRevision`、`testEnvironmentRef` 来自 `manifest.environmentRef`（两者都不来自 artifact/CheckResult，证明确实读到冻结 Manifest）；未被冻结的合法 id ⇒ `GATE_NOT_READY` 且消息精确点名该 manifest 与 `no VerificationManifest`。不再是死分支。**hash 键空间仍对唯一调用方不可达 → W6R3-05（P3）**。`r2-closures.mjs` 的 `cw-manifest` 第 3 断言因消息改写而漂移，行为已按预期 fail-closed |
| W6R2-06 | **已关闭** | `gates3.mjs`：限额 100、`requestedTokens=60` ⇒ 第一份批准后 `budget.tokensReserved=60`（存储可见），第二份 60 ⇒ `BUDGET_EXCEEDED` 且不写预算；剩余 40 批准后预留到 100，再要 1 token 拒绝；无 token 请求的 Plan 不预留也不阻断。`r2-budget2.mjs` 的 `bud-double` 反向通过（14/14） |
| W6R2-07 | **已关闭** | `gates3.mjs`：`paused`/`cancelling`/`cancelled` 的 Work 经 `requestCodeWrite` ⇒ `INVALID_STATE`、digest 不变、`writeAdmission` 同判；`resumeWork` 回到 `running` 后同一批准 Plan 再次准入。`r2-resume2.mjs` 的 `res-plangate*` 反向通过 |
| W6R2-08 | **已关闭** | `closures3.mjs`：Attempt#1 `running` + Attempt#2 `starting` ⇒ `writeAdmission` 拒绝且 reason 含 `ready Attempt`；把最新 Attempt 置 `running` 后准入；最新为 `stopped`、或完全没有 Attempt 均拒绝。`r2-resume2.mjs` 的 `res-anyattempt` 反向通过 |
| W6R2-09 | **已关闭** | `route3.mjs`：`completionEvidenceKindFor` 四路线 × 等级判定正确；L1 code Work **无 Test Run** 经 Review + 冻结 CompletionManifest 真实 `completeWork` 完成（事件 `evidenceKind='review'`、`completionManifestHash` 落地）；缺 Review / 缺 Manifest / 异 Work Manifest / 空 `verifiedManifestIds` / `failed` Review 分别拒绝；`level='none'` ⇒ `VALIDATION_ERROR`。集成侧 AC-007 亦补上真实完成调用。**但路由由调用方选择引入 P1 回归 → W6R3-01** |
| W6R2-10 | **已关闭** | `route3.mjs`：文档 L2 链 Review 绑定 `candidateDiffRef`（id/hash 非空）⇒ `ok:true`；删掉 Ref 只留 `evidence:['candidate diff approved','we saw the diff']` ⇒ `VALIDATION_ERROR`（子串判定确已删除）；Ref 缺 id 或 hash 均拒绝；code 路线仍要求 `codeRevision` + `environmentRef`。`r2-route2.mjs` 两条旧断言按预期反转为拒绝。**L3 的 rollback/audit/drill 仍是子串匹配 → W6R3-06（P3）** |

第 2 轮 10 条 Finding 的判定标准全部满足；本轮 FAIL 由回归挖掘的新 P1 驱动。

## 26. 逐 AC 判定（AC-007…022、AC-083、AC-089）

判定证据取自 §24 的探针（代表性深度：域级纯规则 + 真实 SQLite 服务级正负例），不以产品测试为唯一依据。

| AC | 判定 | 依据 |
|---|---|---|
| AC-007 | PASS | `route3.mjs`：`stageOrderFor('code','L1')` 无 Plan/Test；L1 Work 无 Test Run 经 Review + CompletionManifest 真实完成；集成 L1 全链（`delivery.integration.test.ts`）。`r2-ac07-09-domain.mjs` 37/38 |
| AC-008 | PASS | 一字符 permission/interface/payment ⇒ L3 且不降级（域 + `r2-upgrade2.mjs` 20/20 + `r2-falsify.mjs`） |
| AC-009 | **PASS（带 P2 W6R3-04）** | 绑定 Work：超界/逻辑改动升级、同 Work 关联 Requirement、旧 Plan `plan_stale` + artifact `invalid`、旧 Plan 写请求被拒（`extra3.mjs` 对照用例通过）。**无 `baseRevision` 的 Work 升级后旧 Plan 不打 stale、不失效、且仍可写** ⇒ 见 W6R3-04 |
| AC-010 | PASS | L2 链缺阶段/缺 Requirement/错依赖/缺环境均拒绝，完整链通过（`r2-ac10-12-19-domain.mjs`、`route3.mjs`） |
| AC-011 | PASS | L3 需显式授权（`previousLevel`）、回退计划、逐项审核、恢复演练证据；真实迁移输出属 WP-08。**证据为自由文本子串 → W6R3-06（P3）** |
| AC-012 | PASS | 文档路线：候选 Diff 结构化 Ref + 独立 Review + Settlement，无代码测试与开发 Requirement（`route3.mjs`、`r2-route2.mjs` 的预期变更） |
| AC-013 | **PASS（带 P2 W6R3-02、P2 W6R3-04）** | 无批准 Plan ⇒ `GATE_NOT_READY` 且零写入；授权撤销/收窄/删除 ⇒ `NOT_AUTHORIZED`；调用方期望 Hash 只能追加拒绝（W6R2-02 已关闭）。**但 `completed`/`failed`/`blocked` Work 仍准入写，且无 `baseRevision` 的 Work 跳过 Revision 绑定** ⇒ W6R3-02/04 |
| AC-014 | PASS | 合规 Plan 自动批准并留依据（authorizationRef/版本/Hash/Revision/预算预留），可重读校验；越界/产品变化/异 Revision 拒绝（`r2-ac07-09-13-14-core.mjs` 37/37） |
| AC-015 | PASS | `now` ⇒ 新 Product/Plan 版本、Requirement 回 `product`、受影响证据失效、旧 Plan `stale` 且写被拒（`r2-ac15-16-decisions.mjs` 29/29） |
| AC-016 | PASS | `later` ⇒ 新 Queued Requirement、当前验收不变；`decline` ⇒ 记录原因、不排队、验收不变 |
| AC-017 | PASS | 提交即 `return_to_development`，失效 review/test 产物并重开 Task；被失效的修复前 Test 证据不再能完成 Work（W6R2-01 已关闭，`closures3.mjs`）；`r2-falsify.mjs` 修复后证据失效反向通过 |
| AC-018 | PASS | Developer 自证拒绝、旧 Review/提 Finding 的 Review/错误角色拒绝、新独立 Review+Test 且 Revision 相等、结论 `passed` 才 `verified`（`closures3.mjs`）；残余见 W6R3-03 |
| AC-019 | **FAIL（P1 W6R3-01）** | `blocked` 不完成、`not_covered` 需已接受风险处置、未关闭阻塞 Finding 阻断、失效证据不完成——均正确；**但 L2/L3 代码 Work 可由调用方声明 `route:'document'` 仅凭 Review 证据完成，零 Test Run**，`workflow.md` §7「L2/L3代码使用独立Review和Test」被绕过 |
| AC-020 | **PASS（带 P2 W6R3-02）** | 安全点暂停、`writeAdmission`/`requestCodeWrite` 双门禁对 `paused` 同判拒绝、恢复版本校验 + 新 Attempt（`starting` 窗口拒绝）、最新 Attempt 就绪判定；**但 `blocked`/`failed` 状态未纳入屏障** |
| AC-021 | **PASS（带 P2 W6R3-02）** | `cancelling`→级联 `cancelled`、Attempt `stopped`、产物保留、Requirement `cancelled`、recovery 停 `blocked`；`cancelling`/`cancelled` 两门禁均拒绝写；**recovery `blocked` 后 Plan gate 仍准入写** |
| AC-022 | **PASS** | 单次调用超额原子拒绝、`budgetAfter` 不变、`requiresUserTopUp`、返工额度耗尽拒绝；批准即预留、重复批准不可累计超限（W6R2-06 已关闭，`gates3.mjs`/`r2-budget2.mjs`） |
| AC-083 | PASS | 无 taskId 的 document/integration Finding 绑定 Review Run + Manifest 并冻结 `finding_binding`；task 目标缺 taskId ⇒ `VALIDATION_ERROR`，外来 Task ⇒ `NOT_AUTHORIZED`，Developer Run 不得提 Finding（`r2-ac083.mjs` 9/9） |
| AC-089 | **PASS（带 P2 W6R3-04）** | `listContinuable` 纯投影、继续创建新 Work + 预算 + 本地 Authorization、不创建任何 Run、`reusedPreviousVerification:false`、二次继续拒绝（`r2-ac089-continue.mjs` 34/34、`r2-continue2.mjs` 17/17）；**该形状的 Work 同时是 W6R3-04 的入口** |

## 27. 第 3 轮 Findings

### W6R3-01 [P1] 完成路线由调用方声明且不与 Work 的持久事实交叉校验，代码 L2/L3 Work 可零 Test Run 完成

- 位置：`packages/core/src/findings.ts:991`（`const route: DeliveryRoute = input.route ?? 'code'`）、`:992`（`completionEvidenceKindFor(route, work.level)`）、`:1008-1045`（`kind==='review'` 只要求 Review + CompletionManifest）、`packages/domain/src/delivery.ts:511-518`（`completionEvidenceKindFor`）。`work.intent`（`delivery`/`document`/`operation`，`packages/contracts/src/enums.ts:33`）与 `work.level` 在 `completeTx` 中除 `level` 外**从未被用于校验 route**。
- 复现：`node /tmp/wp06r3/probe/route3.mjs`（`cases=33 failed=3`，两条为 `W6R3-01 a code L2/L3 Work declared route=document completes with Review-only evidence`）。步骤：`addWork({intent:'delivery', level:'L2'})` → 建一个 `role='review'`、`completed`、带有效 artifact（`sourceRevision=REV`）与 `stage_result.status='success'` 的 Review Run → 冻结一个属于该 Work、`verifiedManifestIds` 非空的 `CompletionManifest` → 先 `completeWork({workId, reviewRunId, completionManifestRef})`（route 缺省 `code`）⇒ **正确拒绝**「no Test Run is bound」；再 `completeWork({workId, route:'document', reviewRunId, completionManifestRef})`。
- 观察：`ok:true`，Work 转 `completed`，事件 `delivery.work_completed` 记 `route:'document'`、`evidenceKind:'review'`、`testStatus:'passed'`、`testEvidenceRevision=REV`；探针同时断言该 Work 的 `role='test'` Run 数为 **0**。L2 与 L3 均复现（`OBS bypass L2/L3: intent=delivery testRuns=0 evidenceKind=review route=document`）。
- 期望：`workflow.md` §7「L1及纯文档使用ReviewCheck与适用检查；L2/L3代码使用独立Review和Test」；路线是实现/交付的持久属性（`intent` 已落库，`orchestrator.ts:174-189` 亦按 `intent` 决定等级地板），完成门禁不得让被约束方自行选择更弱的证据规则。
- 契约/AC：AC-019、AC-007（对照）、`workflow.md` §3/§7。
- 成因：W6R2-09 为让 L1/document 可完成而把路线参数化，但只信 `input.route`；`9981902:packages/core/src/findings.ts:891` 的旧实现（`completionEvidence(input.testRunId, work)`）无条件要求 Test Run，故这是 `4f5a1f3` 引入的**回归**（fail-open 方向）。
- 旁证（产品测试把该行为固化为期望）：`packages/core/test/findings.test.ts:1607-1636`「keeps the document route on its own rule」使用的 `WORK_ID`（`addWork(WORK_ID,'L2',…)`，`:296-311` `intent:'delivery'`）传 `route:'document'` 被判 `done.ok===true`、`evidenceKind==='review'`；同一用例还断言「A Test Run is ignored on the document route」（供给 Test Run 也不报错，只是被路线忽略）。即 `intent='delivery'` 的 L2 Work 被 route 覆盖是**当前期望**，与 `workflow.md` §7 冲突。
- 修复方向：在 `completeTx` 由持久事实推导路线（`work.intent === 'document' ? 'document' : work.intent === 'operation' ? 'operation' : 'code'`），调用方 route 只能与之相等或缺失，冲突即 `VALIDATION_ERROR`；或在 Work 上持久化 `route` 并与之比对。同时保留「L2/L3 代码必须有 Test Run」为无条件规则。补负例测试：`intent='delivery'`、`level='L2'` 的 Work 传 `route:'document'` ⇒ 拒绝。

### W6R3-02 [P2] 共享写屏障只覆盖 3 个状态，`completed`/`failed`/`blocked` 的 Work 仍经 Plan gate 准入代码写

- 位置：`packages/domain/src/delivery.ts:1074-1090`（`workWriteBarrier` 仅 `paused`/`cancelling`/`cancelled`）；消费点 `packages/core/src/gates.ts:778-789` 与 `packages/core/src/findings.ts:1223-1226`。
- 复现：`node /tmp/wp06r3/probe/gates3.mjs`（`cases=47 failed=7`，其中 6 条为本条）。① 真实完成链：批准 Plan → 真实有效 Test Run → `completeWork` ⇒ `ok:true`；随后 `requestCodeWrite({workId, revision, targets})` ⇒ `allowed:true`（`planRef`/`evidenceRefs` 返回）且**新增一条 `delivery.write_admitted` 事件**（`4 -> 5`）。② recovery 取消链：`cancelWork({sideEffectsUnknown:true})` 使 Work 进入 `blocked`，同一次 `requestCodeWrite` ⇒ `allowed:true`。③ 状态矩阵（`OBS parity`）：`completed`/`failed`/`blocked`/`queued` 四状态下 `writeAdmission` 与 `requestCodeWrite` **同为放行**。
- 期望：`workflow.md` §5.1「queued→running→completed；…完成后追问创建关联新Work」、§7「暂停停止新准入」「最终完成清单绑定验证代码树」；AC-020/AC-021 的写屏障语义应覆盖一切非 `running` 的失控状态（至少 `completed`/`failed`/`blocked`），否则完成记录绑定的代码树在完成后仍可被同一 Plan 改动。
- 契约/AC：AC-013、AC-020、AC-021；`workflow.md` §5.1/§7。
- 修复方向：把 `workWriteBarrier` 改为白名单（只有 `running` 可写，`queued`/`completed`/`blocked`/`failed` 与现有三个状态一并拒绝），两门禁继续共用；补「完成后写请求 ⇒ 拒绝且零 `delivery.write_admitted`」与「recovery `blocked` 写请求 ⇒ 拒绝」的回归测试。
- 说明：`paused`/`cancelling`/`cancelled` 三态（W6R2-07 的范围）确认已关闭，本条是其状态集的补集。

### W6R3-03 [P2] 共享规则的 `invalidatedRevisions` 分支在生产代码中零生产者，闭环可锚定在已被 Finding 失效的 Revision

- 位置：`packages/domain/src/delivery.ts:1334/1418`（规则第 3 条「被失效的 Revision 永不复用」）；应当喂入它的三处调用均未传该字段：`packages/core/src/findings.ts:2017-2026`（完成）、`packages/core/src/findings.ts:687-709`（`markAddressed`，只与 `work.baseRevision` 比较）、`packages/domain/src/delivery.ts:1767-1778`（Finding 关闭）。`grep -rn invalidatedRevisions packages/*/src` 仅命中类型声明、判定读取与产品测试 `packages/domain/test/delivery.test.ts:1227`，**生产代码零生产者**。
- 复现：`node /tmp/wp06r3/probe/r2-closures.mjs`（`cases=38 failed=3` 中的 `W6R2-CANDIDATE all-pre-fix-revision evidence closes the Finding`）：Work `baseRevision=REV`；一个 Review Run 的 artifact `sourceRevision=REV_PRE` 提交 P1 Finding（`submitFinding` 不校验 Review 证据 Revision 与 `work.baseRevision` 一致）⇒ 该 artifact 被置 `invalid`；修复 Run artifact 自述 `REV_PRE` ⇒ `markAddressed` **接受**（`REV_PRE ≠ work.baseRevision`）并把 `baseRevision` 推进为 `REV_PRE`；再以 `REV_PRE` 的新 Review+Test ⇒ `ok:true, state:'verified'`。
- 观察：整条关闭链（`fixingRevision`/`reviewRevision`/`testRunRevision`）锚定在 `REV_PRE`——正是 Finding 已判定「旧结果无效」的那个 Revision；`evaluateEvidenceValidity` 的第 3 条（本例唯一能识别该事实的分支）从未被触发。
- 期望：AC-017「旧结果无效」、AC-018「修复后重新独立 Review」；W6R2-03 的实际不变量应是「修复 Revision 不得等于**任何被该 Finding 失效的证据 Revision**」，`work.baseRevision` 只是其中一个候选。
- 契约/AC：AC-017、AC-018；`workflow.md` §6/§7。
- 修复方向：由 `submitFinding` 返回/持久化的 `invalidatedEvidenceRefs` 解析出被失效 Revision 集合，作为 `lineage.invalidatedRevisions` 传入完成、关闭与等级重评三处；或让 `markAddressed` 直接拒绝「修复 Revision ∈ 被失效证据 Revision 集合」。补负例测试：被失效 Review 的 Revision 被复位为修复 Revision ⇒ `GATE_NOT_READY`。
- 可达性说明：需要 Review artifact 的 `sourceRevision` 被错标（该字段由 Run 侧提供，`ArtifactService.createAgent({sourceRevision})` 不做 Work 绑定校验），但这是本包公共 API 内的可达状态，不是外部假设。

### W6R3-04 [P2] 无 `baseRevision` 的 Work：写门禁跳过 Revision 绑定，等级升级不打 stale 且旧 Plan 仍可写

- 位置：`packages/core/src/gates.ts:763`（`if (work.baseRevision !== undefined && input.revision !== work.baseRevision)`——缺失即跳过）、`:965`（`const revision = work.baseRevision ?? 'working-tree'`）、`:973`（`findPreviousApprovedPlan(work.id, revision, …)`）；`packages/domain/src/delivery.ts:437`（`stalePlan: planEvidence?.valid === true`，`plan` 缺失即 `false`）。`work.baseRevision` 缺失是 AC-089 的正常形状（`requirement-continue.ts:244`，本包未改）。
- 复现：`node /tmp/wp06r3/probe/gates3.mjs`（`OBS write on unbound Work at the approved revision: allowed=true`）与 `node /tmp/wp06r3/probe/extra3.mjs`（`cases=9 failed=2`）：① `addWork({level:'L1', baseRevision:null})`，在 revision `R1` 批准 Plan P1 ⇒ `requestCodeWrite({revision:R1})` **放行**（`revision` 完全由调用方设定）；② 在 `R2` 批准替换 Plan P2 后 `upgradeLevel` ⇒ Work 升为 L2，但 `stalePlanRefs=[]`、P1 artifact 仍 `validity:'valid'`；③ `requestCodeWrite({revision:R1, planRef:P1})` 仍 **`allowed:true`**（`workLevel:'L2'`，却由 L1 期批准的 Plan 授权）。同链在绑定 Work（`baseRevision=REV`）上对照：`stalePlanRefs=[P1.hash]`、artifact `invalid`、写被拒。
- 期望：AC-009「升级后旧 Plan `stale`/`invalid` 且旧 Plan 写请求被拒」、AC-013 的 Revision 绑定。无 Revision 不等于「任意 Revision 均可」；W6R2-04 对完成门禁已按 fail-closed 修正，写门禁与升级血缘应同规则。
- 契约/AC：AC-009、AC-013、AC-089；`data.md` §2 `work.baseRevision`。
- 修复方向：`work.baseRevision` 缺失时写门禁 fail-closed（或要求调用方提供可验证的 Revision 来源，如 `VerificationManifest.codeRevision`）；`upgradeLevel` 不应用 `'working-tree'` 占位去查找旧 Plan——应遍历该 Work 的全部批准记录（不限 revision）取「升级前最新的、仍有效的批准 Plan」作为被取代对象，从而在无 `baseRevision` 时也打 stale + invalidate。补负例：无 `baseRevision` 的 Work 升级后旧 Plan 写请求 ⇒ 拒绝。

### W6R3-05 [P3] `frozenManifestOf` 的 hash 键空间对唯一调用方仍不可达，T7「两个键空间都真实可达」不被代码支持

- 位置：`packages/core/src/findings.ts:2088-2107`（`frozenManifestOf` 同时比较 `row.hash` 与 `payload.manifestId`）；唯一调用方 `:1888` 传入的是 `stageRow.manifestId`，其契约类型为 `idSchema`（UUIDv7，`packages/contracts/src/entities/structures.ts:468`），而 `snapshot.hash` 是 64 位摘要（`packages/storage/src/schema.ts:296` `CHECK (length(hash) = 64)`、`PRIMARY KEY (type, hash)`），两键空间不相交。
- 复现：`node /tmp/wp06r3/probe/closures3.mjs`（`W6R2-05 the hash key space is NOT reachable through the only caller`）：以 64 位 Hash 作 `stage_result.manifestId` 插入被存储层契约拒绝（`CONSTRAINT_VIOLATION`）；改用 payload 声明 `manifestId` 的合法 UUIDv7 时该分支命中并通过。
- 观察：死分支已由「payload 声明 `manifestId`」这一真实键空间复活（W6R2-05 的实质要求已满足），但 `row.hash === manifestId` 这一半在唯一调用路径上恒不成立。
- 期望：实现记录不得声称两条键空间都可达；或让 `stage_result.manifest_id`/读取侧显式支持 hash。
- 契约/AC：AC-018/AC-019；`data.md` §3。
- 修复方向：把 T7 的措辞改为「payload 声明的 `manifestId` 键空间可达；hash 键空间保留给直接冻结 payload 的写入方」，或删除 `row.hash` 比较以免误导；若确有写入方以 hash 为 id，则补一条端到端用例。

### W6R3-06 [P3] L3 的 rollback/audit/drill 证据仍是自由文本子串匹配，与 W6R2-10 的修复方向不一致

- 位置：`packages/domain/src/delivery.ts:760-776`（`has(values, needle) = values.some(v => v.toLowerCase().includes(needle))`，分别匹配 `rollback`/`audit`/`drill`）；与已改为结构化 Ref 的 `bindsCandidateDiff`（`:746-749`）同处一个证据校验函数族。
- 复现：`node /tmp/wp06r3/probe/route3.mjs`（`OBS L3 evidence given as self-negating free text: ok=true gaps=[]`）：`Plan.evidence=['there is no rollback plan but the word rollback appears']`、`Review.evidence=['NO audit was performed, audit absent']`、`Recovery.evidence=['no drill happened, drill']` ⇒ 阶段链 `ok:true`。
- 观察：AC-011「回退计划、逐项审核、恢复演练证据」可被任意含关键词的自否定文本满足，与 W6R2-10 已确立的「证据须可追溯到具体产物引用」标准不一致。
- 期望：AC-011 的 L3 证据项应为结构化引用（rollback plan artifact ref / 逐项审核报告 ref / 恢复演练记录 ref），或至少要求产物路径形态。
- 契约/AC：AC-011；`workflow.md` §3/§7。
- 修复方向：为 L3 的三个证据项各增一个 `Ref`（或 `evidenceRefs`）字段并校验非空，文本仅作说明；补负例：自否定文本 ⇒ `MISSING_CONTEXT`。

### W6R3-07 [P3] 完成事件把 Review 证据写成 Test 字段（`testStatus:'passed'`、`testEvidenceRevision`、`testRunId`）

- 位置：`packages/core/src/findings.ts:2050`（review 分支硬编码 `status: 'passed'`）与事件写入 `:1174-1179`（`testStatus`/`testRunId`/`evidenceRunId`/`testEvidenceRevision`/`testEnvironmentRef` 对两条路线同名）。
- 复现：`node /tmp/wp06r3/probe/extra3.mjs`：L1 Work 经 Review 完成，`OBS completion event (review evidence): evidenceKind=review testStatus=passed testRunId=<review run> evidenceRunId=<review run>`。
- 观察：事件同时携带 `evidenceKind:'review'` 与 `testStatus:'passed'`、`testRunId` 指向 Review Run；审计侧按 `testStatus`/`testRunId` 读取会得到误导性结论（`evidenceKind` 已能区分）。
- 期望：字段名/取值应与证据种类一致（review 证据不应产生 Test 语义字段，或显式置空）。
- 契约/AC：AC-007/AC-012/AC-019 的证据可追溯性（`workflow.md` §7）。
- 修复方向：事件按 `evidenceKind` 分列（`reviewStatus`/`reviewRunId`），或在 review 分支把 `testStatus` 置 `null`、`testRunId` 改名 `evidenceRunId`。不阻断。

## 28. 计数与阻断表

| 严重性 | 数量 | 编号 | 是否阻断 | 说明 |
|---|---|---|---|---|
| P0 | 0 | — | — | — |
| P1 | 1 | W6R3-01 | **阻断** | `completeWork` 路线由调用方选择，L2/L3 代码 Work 可零 Test Run 完成（AC-019、`workflow.md` §7），系 `4f5a1f3` 引入的回归 |
| P2 | 3 | W6R3-02, 03, 04 | 不阻断（已说明影响面） | 02 完成/失败/阻塞的 Work 仍准入写（AC-013/020/021）；03 共享规则的失效 Revision 分支无生产者，闭环可锚定已失效 Revision（AC-017/018）；04 无 `baseRevision` 的 Work 写门禁与升级血缘跳过绑定（AC-009/013） |
| P3 | 3 | W6R3-05, 06, 07 | 不阻断 | 05 记录与代码不符（Manifest hash 键空间不可达）；06 L3 证据仍子串匹配（AC-011）；07 完成事件字段语义 |
| 合计 | 7 | — | — | 第 2 轮 10 条 Finding 全部关闭 |
| 第 2 轮遗留 | 0 | — | — | W6R2-01…10 逐条验证关闭（W6R2-03 口径内；残余另立 W6R3-03） |

验收面结论：存在 1 个可复现 P1 ⇒ **FAIL**，不进入独立 Test。

报告保真核对（追加后）：`git diff --numstat .agentdev/work/WP-06/review.md` = 仅新增行、0 删除；`git show HEAD:.agentdev/work/WP-06/review.md | diff - <(head -516 .agentdev/work/WP-06/review.md)` 无差异（第 1、2 轮逐字保留）。

## 29. 记录核对（implementation.md T1–T7）

- **用例数声明准确**：`pnpm test:unit` 38 文件/749 用例与 T7 完全一致（T6 为 727，+22 条回归）；`pnpm test:integration` 132/132 与 T7 一致且本轮 Docker 可用（`doctor`/`container` 真实容器用例通过）；`pnpm build` 10 workspace、`docs:check` 输出（15 文档/55 链接/94 AC/9 需求/11 工作包）与 T7 逐字一致。
- **T1–T6 未改动且第 2 轮已逐条核对**：本轮 `git show --stat 4f5a1f3` 确认改动仅 `delivery.ts`、`gates.ts`、`findings.ts`、4 个测试文件与 `implementation.md`，T1–T6 涉及的声明未变；本轮对其中仍构成验收面的部分做了重跑（§24 的 19 个第 2 轮脚本，555 用例）。
- **T7 新增共享原语与代码一致**：`EvidenceValidity`/`RevisionEvidence`/`EvidenceLineage`/`EvidenceValidityDecision` 类型与 7 条判定顺序（`delivery.ts:1394-1467`）与记录逐条相符；`evidenceBindsRevision` 确认只调用 `evaluateEvidenceValidity`（`:1475-1480`，非第二套规则）；三处消费点（`findings.ts:2017`、`delivery.ts:447`、`delivery.ts:1767`）确实全部改走它，未发现仍在自行判定 validity/revision 的旧检查（`grep` 仅剩构造入参的 `validity === 'valid'` 与失效写入方）。
- **T7 逐条与代码核对结论**：W6R2-01/02/04/06/07/08/09/10 的修复与记录一致（见 §25）；W6R2-03 的实现与记录文字一致，但记录未登记「被失效证据 Revision ≠ `work.baseRevision`」的残余（W6R3-03）。
- **过度/不实声明 1 处**：T7 W6R2-05 称 `frozenManifestOf`「同时接受…该冻结行的 hash…与 payload 声明的 `manifestId`…**两个键空间都真实可达**」——hash 键空间对唯一调用方（`stage_result.manifest_id` = UUIDv7）不可达（W6R3-05）。
- **T7 未登记的新问题 3 项**：W6R3-01（完成路线由调用方选择，L2/L3 可零 Test 完成）、W6R3-02（屏障漏 `completed`/`failed`/`blocked`）、W6R3-04（无 `baseRevision` 的 Work 写门禁与升级血缘）。T7 残余 7「`writeAdmission` 与 `requestCodeWrite` 的 Run/Attempt 条件未合并」与 W6R3-02 相邻但更窄：T7 只承认 Run/Attempt 条件未合并，实际连 **Work 状态集合** 两门共用后仍不完整。
- **T7 残余清单**：8 项（CompletionManifest 覆盖度、无 `baseRevision` 不能完成、无 Revision 全序、预算预留 vs 核销、Manifest 写入方、operation 路线、两门禁 Run/Attempt 条件、`evidenceValid` 必需字段）均属实；其中「无 `baseRevision` 不能完成」只覆盖完成门禁，未提及写门禁与升级血缘（W6R3-04）。
- **测试覆盖缺口**：`findings.test.ts` 现有回归覆盖了「失效证据不得完成」「修复必须产生新 Revision」「manifest 绑定与精确拒绝」「最新 Attempt 就绪」；但**没有**把 route 与 Work 持久事实交叉校验的用例——`findings.test.ts:1607` 反而把「`intent='delivery'` 的 L2 Work 以 `route:'document'` 完成」写成期望（W6R3-01），也**无**「`completed`/`blocked` 后的写准入」用例（W6R3-02），故这两条未被已提交测试作为缺陷捕获。

## 30. 覆盖限制

1. **Docker 本轮可用**：`pnpm test:integration` 11 文件/132 用例全通过（含真实容器），无环境阻塞登记；容器级隔离负例仍属 WP-07/WP-10 的完整复验。
2. **未接线的上层**：本包服务尚无 HTTP/WS/Broker 消费者；W6R3-01/02/04 的可达性来自**包公共 API 的直接调用**（WP-07/WP-08 将以此为接线面），非端到端页面路径。W6R3-01 额外依赖「该 Work 已有冻结 CompletionManifest」，当前包内只有测试写入该快照，真实写入方属 WP-08；但门禁是被约束方的最后一道，且 Work 已持久化 `intent`/`level` 可自查，故仍按 P1 记录。
3. **Revision 全序不存在**：服务端无 Git 祖先关系，W6R3-03/04 只能证明「可锚定到被失效 Revision」「无 `baseRevision` 即跳过绑定」，无法评估「后代 Revision 放宽」方案。
4. **`failed` 状态的写准入**：`failed` 用例以 `store.works.update` 直接置位（`workflow.md` §5.1 允许 `failed` 启动同 Work 新 Run）；`completed`/`blocked` 两条则为真实 API 链（`completeWork`、`cancelWork({sideEffectsUnknown:true})`）。`failed` 的具体可达调用序列属 WP-07 的 Run 失败接线。
5. **L3 子串匹配（W6R3-06）** 只在域级纯函数上证明；其是否影响真实交付取决于 WP-08 的 L3 接线。
6. **预算端到端**：W6R2-06 只证明批准路径预留；派发/核销（`RunLifecycle.reserve/settle`）的并发双花防护未做并发压测（属 WP-02/WP-08）。
7. **未读取任何开发/Test 聊天或会话记录**；探针由 `dist` 类型声明、公开 API 与正式文档编写，不 import 任何产品测试文件。第 2 轮探针的复制只改 harness 路径，用于同断言回归。
8. **未运行** `pnpm test:e2e`/`test:acceptance`/`test:live`（按契约返回 NOT_IMPLEMENTED，属 WP-09/WP-10）。

## 31. 能否进入独立 Test

**否。** 第 2 轮 10 条 Finding 已全部关闭（W6R2-03 口径内关闭并登记残余）且六条契约命令全绿（unit 749/749、integration 132/132、Docker 可用），但回归挖掘在冻结点 `4f5a1f3` 复现出 1 个 P1：**W6R3-01 —— `completeWork` 的完成路线由调用方声明，`intent='delivery'`、`level='L2'/'L3'` 的 Work 传 `route:'document'` 即可仅凭 Review 证据完成，零 Test Run（AC-019、`workflow.md` §7）**。该行为是 W6R2-09 修复引入的 fail-open 回归（修复前无条件要求 Test Run）。

建议按 W6R3-01…04 修复后重新提交独立 Review；修复必须包含负例测试：① `intent='delivery'` 的 L2/L3 Work 传 `route:'document'` ⇒ 拒绝；② `completed`/`blocked` Work 的 `requestCodeWrite` ⇒ 拒绝且零 `delivery.write_admitted`；③ 修复/验证 Revision 等于被 Finding 失效证据的 Revision ⇒ 拒绝；④ 无 `baseRevision` 的 Work 升级后旧 Plan 写请求 ⇒ 拒绝且旧 Plan `stale` + `invalid`。
