# WP-12 T4b3 实施记录：L2 交付链收口（Integrate/Accept + Settlement 绑定）

- 状态：Develop 完成，自测与全量门禁见 §6（独立 Review / Test / Settlement 未执行）
- 依据：`.agentdev/work/WP-12/T4b-implementation.md`「轮 3（续 7）」交接计划；`docs/architecture/reliability.md` §4/§5/§9；`docs/architecture/data.md` §3；`docs/rules/workflow.md` §3/§5.2/§7；`docs/delivery/acceptance.md` AC-010/AC-012/AC-041/AC-081
- 权威代码契约：`packages/workspace/src/cas.ts`（`runIntegration`/`planIntegration`/`integrationLockResourceName`/CAS）、`packages/core/src/task-candidate.ts`、`packages/core/src/settlement.ts`

## 1. 本轮实现（全部为真实 Git + 真实 SQLite 测试）

| 步骤 | 文件 | 说明 |
|---|---|---|
| 1 Integration | `packages/core/src/integrate.ts`（新，`index.ts` 已导出） | `createIntegrateService({store, worktrees, cas, lock, projectId, repoRoot, worktreeRoot, snapshots})`；`integrate({workId, operationId, targetRevision?, message?})`：解析 Work/Project/交付 ref（`refs/heads/<deliveryBranch>`）→ 基线 = 显式 target → ref head → `Work.baseRevision`；逐 Task 读 `latestManifestId` → 冻结的 `verification_manifest`（`readFrozenVerificationManifest`）→ `IntegrationTask.revision = manifest.codeRevision`（`dependsOn`/`dependencyRevision`/`supersedes` 来自 Task 行）；**任一 Task 缺 manifest 或缺冻结版本 → `MISSING_CONTEXT`/`GATE_NOT_READY`，不建 worktree、不写 operation、不动 ref**；建真实集成 worktree（`git worktree add`，`integrateTasks` 直接 `git.cherry(worktreePath)`）→ `runIntegration`（同一共享锁 + 同一 CAS）→ 成功后在 `store.operations` 写 `kind='integrate'` 行（`candidateRevision`/`expectedHead`/`stepResults`）→ finally 删 worktree；失败原样冒泡 Workspace 类型码（`TASK_MERGE_CONFLICT`/`GATE_NOT_READY`/`BUSY`/CAS 拒绝） |
| 1b 集成验证 Manifest | 同上 | `reliability.md` §4 步骤 4：仅当**集成候选的 codeTree 与某个已冻结 Task Manifest 完全一致**时，冻结一条 integration 级 `verification_manifest`（`manifestId = store.newId()`，字段全部取自那条真实 Manifest，仅 `codeRevision/codeTree/dependencyRevision` 换成集成候选，`dependencyManifestRefs` 记录 reuse 来源）；无一致树则不冻结，Settlement 随后 fail-closed。**不编造 `environmentRef`/`readLedgerHash` 等字段** |
| 2 Settlement | `packages/core/src/settlement.ts` | 新增 `readFrozenVerificationManifest(store, manifestId)`（按 payload `manifestId` 读，与 `findings.ts` 同规则）、`deliveredKnowledgeTreeHash({repoRoot, revision, documentRoot})`（`git ls-tree -r -z --full-tree <rev> -- <documentRoot>` 的 SHA256 = `reliability.md` §4 步骤 7「文档树Hash」）、`settlementResultId(operationId)`（确定性 UUIDv7，重试得到同一 manifest）、`INTEGRATION_OPERATION_KIND`；`SettlementService.settleFromIntegration({operationId, completion?})` 读 `kind='integrate'` 行的候选 → 逐 Task 校验 manifest 仍存在 → 读集成验证 Manifest 并核对 `codeRevision/codeTree` → `buildFinalManifest` → 复用既有 `settle()`（同一 CAS、同一共享锁、既有需求池保存路径）。**缺 operation/候选 → `NOT_FOUND`/`MISSING_CONTEXT`；Task 无 manifest → `MISSING_CONTEXT`；无集成验证 Manifest 或候选不可读 → `GATE_NOT_READY`/`STALE_ARTIFACT`；全部在任何写入之前拒绝** |
| 3 路由接线 | `apps/daemon/src/control-handler.ts`、`main.ts`、`bootstrap.ts` | **触发点：`control-handler.ts` 的 `stageSubmit` 成功分支**——被 `StageGate` 接受且 `run.purpose === 'settlement'` 时调用 `integrateAndSettle({workId, operationId})`：`integrate.integrate({operationId: 'integrate:'+op})` → `settlement.settleFromIntegration({operationId: 'integrate:'+op})`；两步各自的类型化拒绝以 `delivery:{status:'refused', step, code, message}` 返回给 Runner，不吞错。`bootstrap.ts` 构造 `SettlementService` 不再丢弃，并与新 `createIntegrateService`（同一 `gitPort`/`cas`/`ProjectIntegrationLock`）一起放进 `OpenedProject.services`；`main.ts` 的 `control.attach` 传入两者 |
| 4 bug 修复 | `packages/core/src/task-candidate.ts` | **关键缺陷**：候选提交此前调用 `commitPaths(worktreePath, msg, [])`，空路径走 `git commit --allow-empty`，而复制的文件从未 `git add` → 每个「Task 候选」都是**空提交**（tree 仍等于 base），集成 `git cherry` 判定为已应用、无内容可重放（上一轮 task-candidate 测试未覆盖「候选树 ≠ base 树」，故漏过）。现改为 `commitPaths(worktreePath, msg, [...input.changedPaths])`，真实暂存修改/新增/删除；已在该测试补断言 `codeTree ≠ base 的 codeTree` 防回归 |

## 2. 本轮现场核实并推翻的旧结论

1. 交接计划（轮 3 续 7）假设「Task 候选提交已经真实落地」——**不成立**：候选提交为空（见 §1 步骤 4）。这正是交接计划里「集成拿不到 revision / 拿不到 candidateRevision」表象下的真实根因之一。
2. 集成候选的 tree 与**最深层 Task 候选的 tree 完全相同**（A→B 链：A 的 cherry-pick 结果 = A 树，再 cherry-pick B 自身提交 = B 树），因此 `reliability.md` §4 步骤 4 的「单Task代码树及语义依据完全一致可复用该路线证据」可以用**真实已冻结 Task Manifest** 直接表达，无需为 integration 编造 `environmentRef` 等字段；`buildFinalManifest` 要求 `codeRevision === finalRevision`，故用 integration 级 Manifest 做「同树」桥接（§1 步骤 1b）。
3. `runIntegration` 对每个已应用 Task **故意**额外产生一个空 marker 提交（`applied.commit` 指向它），`packages/workspace/test/cas.integration.test.ts`「repair convergence」以 `branchCommitCount === 3` 固定了该行为。本轮**未改动**该行为（曾试用 cherry-pick 自身提交替换，导致该既有用例红，已回退并在 cas.ts 加注释说明）。

## 3. 已知偏差（未擅自改文档/契约）

1. **「同一次候选提交」的实现形态**：`reliability.md` §9 要求「PortableRequirement.completion + lifecycle=completed + 最终知识同一次 Git 候选提交，随后 CompletionManifest 绑定该最终 Revision」。本项目现状（轮 2 落地并有绿测）是：Settlement CAS 安装**已验证代码候选**，随后需求池保存把 completed 记录作为**链上的下一个提交**写入；`CompletionManifest.finalRevision = 已验证代码候选`，而需求记录的 `completion.codeRevision` 正是该候选（与 §9 末句「记录中的 codeRevision 使用已验证候选代码提交」一致）。本轮沿用既有路径（`settle()` → `completeRequirementAfterSettlement`），未重写为单提交；如需严格单提交，需要把「构建完成记录候选」做成 `RequirementSaveService` 的公开 prepare API，属后续切片。
2. `settleFromIntegration` 用 `expectedRevision = candidateRevision`（集成已把 ref 移到该候选），因此 settle 的 CAS 是「同值 update-ref」，不产生第二个提交。
3. 触发条件写死 `run.purpose === 'settlement'`（`data.md` §3 `ProfessionalDispatchSpec.purpose` 已含 `settlement`）。当前 daemon 尚无「自动排 Settle 阶段 Run」的生产方（`workflow.md` §3 中该阶段本来由 Chief 独立触发）；接线对「真实到达的 Settle stage 结果」有效，已由路由测试覆盖。

## 4. 测试

| 文件 | 用例 |
|---|---|
| `packages/core/test/integrate.integration.test.ts`（新，4 例，真实 Git + SQLite） | ① A→B（B 依赖 A，各自 `createTaskCandidateService` 真候选）→ Integrate：`candidateRevision` 40-hex、`appliedTaskIds=[A,B]`、集成树 == B 的 `codeTree`（≠ A 的）、集成验证 Manifest 的 `dependencyManifestRefs=[B.manifestId]`、交付 ref 只由 CAS 移到候选、`kind='integrate'` operation 行存在；再次集成 → `noop`、无新提交、ref 不动（AC-081 祖先不重复应用）→ Settlement：`requirementCompleted`、`recordVersion=2`、冻结 `CompletionManifest.finalRevision/verifiedCodeTree/knowledgeTree`、需求池 Git 记录 `lifecycle=completed` 且 `recordHash === portableRef.hash`（AC-012/AC-041）②某 Task 无 manifest → `MISSING_CONTEXT`，ref 未动、无 integrate operation、无集成 Manifest（AC-010 fail-closed）③两个真冲突候选 → `TASK_MERGE_CONFLICT`，ref 未动、无 operation/Manifest ④集成后清除 Task 的 `latestManifestId` → Settlement `MISSING_CONTEXT`，未写 settle operation、无 `settlement.completed`、需求仍 active |
| `apps/daemon/test/integrate-route.integration.test.ts`（新，3 例） | 真实 `createControlHandlers` + 真实 `StageGate` + 真实 `SettlementService`：`purpose='settlement'` 的 `stage.submit` 被接受后按序调用 Integrate→Settlement（集成拒绝以 `delivery.step/ code` 回给 Runner）；非 settlement Run 不触发（`delivery` 不存在） |
| `packages/core/test/task-candidate.integration.test.ts`（改） | 补「候选 codeTree ≠ base codeTree」断言，锁住 §1 步骤 4 的空提交回归 |

## 5. 真实 Git 证据（本机执行，来自 `integrate.integration.test.ts` 第 1 例，非播种行）

```
candidateRevision=b91918646bf4644b63ef303365c7da200ede6ed1
deliveryRefHead=44eebe94120b074442f3a88babb54a61831c3920
frozenVerificationManifestId=01a0a0b2-1bb8-7301-9688-7313dc55ca38
taskAManifest=01a0a0b2-1847-75c9-8709-1c78360833d3
taskBManifest=01a0a0b2-1945-7bc5-8515-7490cc34b162
settlementManifestHash=9caec35375fd7e799127320212ccc2e7393f9e14e5374c973b8513f41e0ac009
requirementRecordVersion=2
requirementRecordHash=7183d098b2a53a11dd9727c86af478e179a17f7da38fd5d3cb6d10846e6167ab
git log --oneline <requirementHead>..<deliveryRefHead>:
44eebe9 doc(requirement): complete 需求 未付款订单可取消
b919186 feat: integrate 018f2c1e-…-9e11 (124973165fda)   ← 集成候选 = CompletionManifest.finalRevision
7122bc8 feat(task): 018f2c1e-…-9e11                       ← B 自身提交（cherry-pick）
2d474e2 feat: integrate 018f2c1e-…-9e10 (a88dd8155457)   ← 集成 marker
a88dd81 feat(task): 018f2c1e-…-9e10                       ← A 自身提交（只应用一次）
git rev-parse refs/heads/agentdev/main = 44eebe94120b074442f3a88babb54a61831c3920
git ls-tree -r HEAD .agentdev/requirements:
  .agentdev/requirements/018f2c1e-…-9e30/content.md
  .agentdev/requirements/018f2c1e-…-9e30/requirement.json
  .agentdev/requirements/README.md
requirement.json: {"lifecycle":"completed","version":2}   （与 SQLite 投影 recordVersion=2/recordHash 一致）
```

## 6. 门禁证据（本机真实执行）

| 命令 | 结果 |
|---|---|
| `pnpm typecheck` | **仅 1 个 error，全部在其它车道在制文件** `apps/daemon/test/zz-t2g8.integration.test.ts:553`（T2 未跟踪文件，本轮期间在被改写）；本片文件 0 error（`NODE_OPTIONS=…typescript-6-preload.cjs eslint <本片文件>` exit 0） |
| `pnpm lint` | 9 error **全部**在 `apps/daemon/test/zz-t2g8.integration.test.ts`（T2 在制）；本片文件 eslint + prettier 0 error/0 diff |
| `pnpm test:unit` | `Test Files 77 passed (77)` / `Tests 1418 passed (1418)`，exit 0 |
| `pnpm test:integration`（全量串行） | `Test Files 53 passed (53)` / `Tests 513 passed (513)`，exit 0（含本片新增 2 文件 7 例） |
| `pnpm docs:check` | `docs:check ok — 16 documents, 65 internal links, 94 acceptance cases, 9 requirements, 11 work packages`，exit 0 |
| 定向 `npx vitest run packages/core/test/integrate.integration.test.ts` | 4 passed |
| 定向 `npx vitest run apps/daemon/test/integrate-route.integration.test.ts` | 3 passed |
| 定向 `npx vitest run packages/core/test/task-candidate.integration.test.ts packages/workspace/test/cas.integration.test.ts` | 28 passed（含既有 repair convergence，确认未改 workspace 语义） |

## 7. 未完成 / 下一步

1. **独立 Review → 修复轮 → 独立 Test**（本片未执行）。
2. §3.1 的「单次候选提交」严格形态：需要 `RequirementSaveService` 暴露「按给定 revision 构建 completed 记录候选」的 prepare API，再让 Settlement 先提交候选、后 CAS 一次；当前沿用轮 2 的两次提交链。
3. daemon 级「真实 Settle 阶段 Run → `stage.submit` → 集成 → 结算 → 投影/knowledge.updated」端到端（需先把 §3.3 的 Settle stage Run 生产方接上）；当前路由测试覆盖接线，服务级真实链由 `integrate.integration.test.ts` 覆盖。
4. 其它车道的在制文件（`apps/daemon/test/zz-t2g8.integration.test.ts`）转绿后需重跑 `pnpm typecheck`/`pnpm lint` 确认全仓 0。
