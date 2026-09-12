# WP-06 独立 Test 报告（分级交付与独立验证）

- 测试对象：工作包 WP-06「分级交付与独立验证」（`.agentdev/work/WP-06/plan.md`、`implementation.md`）
- **本轮：独立 Test 第 1 轮**（Review 第 4 轮 PASS；T9 已修复其 2 条非阻断残余）
- 代码冻结点（task 指定）：`b0d226f000de23902e1884c30a18d6f34d443ea2`（`fix(domain,core): require review and test evidence for code L2/L3 completion`）
- `git rev-parse HEAD`：`b0d226f000de23902e1884c30a18d6f34d443ea2`（= 冻结点，一致）
- `git rev-parse b0d226f^{tree}`：`4700ab764a4ed30110c3326ea3ef1fe9765fc266`
- `git status --porcelain`：**空（干净）**；命令前后与全部实验后均无输出（`pnpm build` 只写被 `.gitignore` 忽略的 `dist/`）；本报告是本会话唯一写入的仓库文件
- 测试角色：**Test**（独立上下文；**未读取任何开发或 Review 聊天/会话**，仅依据仓库文件、`git` 对象、正式文档与我自建的实验脚本及其原始输出）
- 测试方法：在 `/tmp/wp06t/` 自建夹具与 10 组实验脚本（`lib.mjs` + `exp1…exp10`），全部经 `/tmp/wp06t/node_modules/@agentdev/*` 软链消费 `pnpm build` 产出的 `packages/*/dist`；**不 import 任何产品测试文件**（脚本导入仅有 `./lib.mjs` 与 `@agentdev/{contracts,core,domain,storage}`）
- 环境：macOS（Darwin，宿主执行）、Node v24.8.0、pnpm 12.3.4；**真实 SQLite `ProjectStore` + 真实 `BlobStore`**（每例独立 `mkdtemp` 临时目录）；Run 工具/Git 提交使用**契约桩**（WP-06 规定）；Docker 守护进程**可用**
- 权威依据：`AGENTS.md`、`docs/INDEX.md`、`docs/rules/{workflow,agents}.md`、`docs/product/requirements.md`、`docs/architecture/{data,execution,reliability}.md`、`docs/delivery/acceptance.md`（AC-007～022、AC-083、AC-089 原文）、`docs/delivery/implementation.md`（WP-06、工程检查命令）、`.agentdev/work/WP-06/{plan,implementation,review}.md`（T1…T9；Review 1…4 轮，末轮 PASS）
- 被测代码：`packages/domain/src/delivery.ts`（2227 行）、`packages/core/src/{gates,decisions,findings,requirement-continue}.ts` 与其已提交测试（仅作对照，不 import）

---

## 0. 结论摘要

| AC | 题目 | 正向 | 负向 | 本轮结论 |
|---|---|---|---|---|
| AC-007 | L1 错字 | 通过 | 通过 | **通过** |
| AC-008 | 一字语义 | 通过 | 通过 | **通过** |
| AC-009 | L1 升级 | 通过 | 通过 | **通过** |
| AC-010 | 标准交付 | 通过 | 通过 | **通过** |
| AC-011 | 高风险交付 | 通过 | 通过 | **通过**（真实迁移/演练输出 UNVERIFIED，承接 WP-08/WP-10） |
| AC-012 | 正式结论 | 通过 | 通过 | **通过** |
| AC-013 | 无效 Plan | 通过 | 通过 | **通过** |
| AC-014 | 范围内自动 Plan | 通过 | 通过 | **通过** |
| AC-015 | 产品变化 | 通过 | 通过 | **通过** |
| AC-016 | 以后或拒绝 | 通过 | 通过 | **通过** |
| AC-017 | 自动返工 | 通过 | 通过 | **通过** |
| AC-018 | Finding 关闭 | 通过 | 通过 | **通过** |
| AC-019 | 未覆盖验证 | 通过 | 通过 | **通过** |
| AC-020 | 暂停恢复 | 通过 | 通过 | **通过** |
| AC-021 | 取消需求 | 通过 | 通过 | **通过** |
| AC-022 | 预算止损 | 通过 | 通过 | **通过**（完成期预算复核 UNVERIFIED，已登记 T6 残余 2） |
| AC-083 | 组合及文档 Finding | 通过 | 通过 | **通过** |
| AC-089 | 进行中需求继续 | 通过 | 通过 | **通过**（该形状 Work 需真实 Revision 才能完成/写入，已登记 T7/T8 残余） |

- **Test 判定：PASS —— 接受 WP-06 的 AC-007～AC-022、AC-083、AC-089。**
- 计数：**18 个 AC 通过 / 0 个不通过 / 0 个完全未覆盖**；自建实验 **10 脚本 / 762 断言通过 / 0 失败**；契约命令 **6/6 退出 0**（typecheck 0、lint 0、unit 757、integration 132 含真实容器、docs:check ok、build 10 workspace），`test:e2e`/`test:acceptance`/`test:live` 按契约返回 `NOT_IMPLEMENTED`（WP-09/WP-10，退出 1 为契约行为）。
- 五项必需失败测试（一字符高风险、超L1升级、过期Plan、修复后证据失效、未覆盖阻断）：**5/5 独立通过**，且已提交的 `delivery-failures.test.ts` 5 例同时通过。
- 未发现新增 **P0/P1**。发现 **1 × P2（流程/追溯，T-01，需 Settlement 前闭合）+ 3 × P3 观察**；另有若干**已登记残余**被独立复现（非新缺陷，见 §7）。
- 最重要的问题：**T-01 [P2]**——冻结点 `b0d226f` 的**代码**改动晚于最后一次独立 Review 的冻结点 `43c10ce`（该 Review 报告提交于 `793e7c8`），尚无配套的新一轮独立 Review。按 `docs/rules/workflow.md` §6/§9，应在 Settlement 前对 `b0d226f` 补一次独立 Review（或明确记录复用口径）。**这不改变本轮对行为的接受**：`b0d226f` 只关闭 Review 第 4 轮点名要 Test 复验的 W6R4-01（P2）/W6R4-02（P3），本轮已独立复验其正负例（§5、§6）。

---

## 1. 契约命令原始结果与仓库状态

执行方式：`export PATH="$HOME/.local/bin:$PATH"`，仓库根目录按序执行；原始日志 `/tmp/wp06t/logs/{typecheck,lint,test_unit,test_integration,test_e2e,test_acceptance,test_live,docs_check,build}.log`、汇总 `/tmp/wp06t/logs/contract-summary.txt`。

| 命令 | 退出码 | 原始结果要点 |
|---|---|---|
| `pnpm typecheck` | **0** | `$ tsc -p tsconfig.json --pretty false`，无输出 |
| `pnpm lint` | **0** | `Checking formatting...` / `All matched files use Prettier code style!` |
| `pnpm test:unit` | **0** | `Test Files  38 passed (38)` / **`Tests  757 passed (757)`** / Duration 11.42s |
| `pnpm test:integration` | **0** | `Test Files  11 passed (11)` / **`Tests  132 passed (132)`** / Duration 17.74s；含 `apps/cli/test/doctor.integration.test.ts` 与 `container.integration.test.ts`（真实容器：只读 rootfs、只读挂载、cap-drop、无网络、pid/内存上限） |
| `pnpm test:e2e` | 1 | `NOT_IMPLEMENTED: command test:e2e is not implemented yet; it lands with WP-09` |
| `pnpm test:acceptance` | 1 | `NOT_IMPLEMENTED: command test:acceptance is not implemented yet; it lands with WP-10` |
| `pnpm test:live` | 1 | `NOT_IMPLEMENTED: command test:live is not implemented yet; it lands with WP-10` |
| `pnpm docs:check` | **0** | `docs:check ok — 15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages` |
| `pnpm build` | **0** | contracts/pi-runtime/domain/knowledge/storage/workspace/core/cli/daemon/runner 共 **10 workspace** 全 `Done` |

命令原始尾部：

```text
typecheck    exit=0  (no output)
lint         exit=0  Checking formatting... / All matched files use Prettier code style!
test:unit    exit=0  Test Files  38 passed (38) / Tests  757 passed (757)
test:integration exit=0  Test Files  11 passed (11) / Tests  132 passed (132)   (docker info 成功)
test:e2e     exit=1  NOT_IMPLEMENTED ... WP-09
test:acceptance exit=1  NOT_IMPLEMENTED ... WP-10
test:live    exit=1  NOT_IMPLEMENTED ... WP-10
docs:check   exit=0  docs:check ok — 15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages
build        exit=0  contracts/pi-runtime/domain/knowledge/storage/workspace/core/cli/daemon/runner (10 workspace) Done
```

仓库状态（命令前后与全部实验后均一致）：

```text
git rev-parse HEAD          → b0d226f000de23902e1884c30a18d6f34d443ea2
git rev-parse b0d226f^{tree} → 4700ab764a4ed30110c3326ea3ef1fe9765fc266
git status --porcelain      → (空)
```

---

## 2. 自建实验清单（消费构建产物，正/负例混合）

| 脚本 | 覆盖 | 结果 |
|---|---|---|
| `/tmp/wp06t/lib.mjs` | 世界夹具：独立临时目录 + 真实 SQLite `ProjectStore`/`BlobStore` + 确定性时钟（Run/Artifact 时间戳单调，使 Revision 血缘可判定）+ 实体构造器（project/budget/work/requirement/authorization/task/run/attempt/artifact/snapshot/stage_result）+ 契约 CAS 桩 | 基础设施 |
| `exp1-domain.mjs` | `@agentdev/domain` 纯规则：AC-007/008/009（L1 边界/一字高风险/升级三态）、AC-010/011/012（阶段链/路线）、AC-013/014（写门/自动批准）、AC-015/016（Decision/证据失效）、证据有效性与 Revision 血缘、AC-017/018/019/083（Finding）、AC-022（预算/返工） | **207 passed / 0 failed** |
| `exp2-gates.mjs` | `PlanGateService` + 真实 SQLite：AC-013（无批准 Plan ⇒ `GATE_NOT_READY` + 源码 Hash 不变、零事件零行；源码移动、Plan Hash 伪造、撤销/收窄授权、无 `baseRevision`）、AC-014（自动批准与依据、越界/产品变化/异 revision/无授权拒绝）、AC-022（批准即预留、重复批准不可累计超限、真实 `tokensUsed` 参与判定）、AC-009（升级关联 Requirement、旧 Plan `plan_stale`+`invalid`、写被拒、降级/无操作零写入、未批准替代 Plan 拒绝） | **89 passed / 0 failed** |
| `exp3-decisions.mjs` | `DecisionService` + `PlanGateService`：AC-015（`now` ⇒ 新 Product/Plan 版本、受影响证据与旧 Product Plan 失效、Requirement 回 product、旧 Plan `stale` 且写被拒、版本单调）、AC-016（`later` ⇒ Queued Requirement 且当前验收不变、`decline` ⇒ 记原因不排队、原 Requirement 不动） | **48 passed / 0 failed** |
| `exp4-findings.mjs` | `FindingService` + 真实 SQLite：AC-017（Review/Test 提 Finding、自动退回开发、失效旧 review/test 产物、Task 重开）、AC-018（Developer 自证拒绝、修复须推进 Revision、旧/异 Revision/未 passed Test/无结论/失效证据/角色错配全部拒绝、新独立 Review+Test 才 verified）、AC-019（blocked 不完成、not_covered 需逐条风险处置、阻塞 Finding 阻断完成）、AC-083（无 taskId 绑定、task 缺 taskId/外来 Task 拒绝）、AC-007/AC-012 完成路线、AC-022 返工额度 | **98 passed / 0 failed** |
| `exp5-lifecycle.mjs` | 暂停/恢复/取消 + 写屏障：AC-020（安全点、关闭 Attempt、Checkpoint/`work_pause` 屏障、暂停后两门禁同拒、版本校验、新 Attempt `starting` 窗口拒绝、Task 版本冲突、`recovery_required` Run 原子拒绝暂停）、AC-021（`cancelling`→级联 `cancelled`、Attempt `stopped`、产物保留 `valid` 且 `integrated:false`、Requirement `cancelled`、未知副作用停 `blocked(recovery)` + 恢复 Decision + resume/accept_cancel） | **92 passed / 0 failed** |
| `exp6-continue.mjs` | `RequirementContinuation` + 真实 SQLite：AC-089（`listContinuable` 纯投影不建 Work/Run/事件、继续创建新 Work+预算+本地授权、Requirement local/phase=product/recordVersion+1、全部 Gate 未满足、不重用旧验证；非 active/已有本地 Work/空或未知授权源/外来 agent 消息 均拒绝） | **57 passed / 0 failed** |
| `exp7-failures.mjs` | **五项必需失败测试**（见 §6） | **60 passed / 0 failed** |
| `exp8-chain.mjs` | 集成链 + 契约 CAS 桩：AC-007（L1 全链至 CAS + `CompletionManifest`，无 Planning/Test Run、无 Task/Requirement 建单）、AC-010（L2 五阶段链、依赖逐级、跳阶段/缺 Requirement 拒绝、完成绑双证据）、AC-011（L3 授权/回退/逐项审核/恢复演练结构化 Ref 正负例、自由文本拒绝）、AC-012（文档链候选 Diff Ref、独立 Review、Settlement、无代码 Test/开发 Requirement） | **65 passed / 0 failed** |
| `exp9-residuals.mjs` | 已登记残余的独立复现：operation 路线证据模型、code L2/L3 完成事件 schema、可选 `CompletionManifest`、`CompletionManifest` 覆盖度、AC-089 无 `baseRevision` 形状 fail-closed | **21 passed / 0 failed** |
| `exp10-hunt.mjs` | 对抗性挖掘：绕过双证据完成门的 7 类尝试、路线/等级证据选择旁路、完成 Work 再写、预算残余、`writeAdmission` 未知 Run、完成门不消费阶段链 | **25 passed / 0 failed** |
| **合计** | | **762 passed / 0 failed** |

---

## 3. 逐 AC 证据

> 约定：每条给出**正向**与**负向**观察值（括号内为脚本与关键原始字段）。全部断言 0 失败，失败列表为空。

### AC-007 L1 错字 —— 通过

> Given 明确普通错字且符合 L1 条件；When 修改执行；Then 一句话 Plan、独立执行/Review/Settlement，直到 CAS 和 CompletionManifest 完成均无 Planning/Test Run 和看板建单。

**正向**（`exp1`/`exp8`/`exp4`）：`classifyChange(1 文件/2 行/仅文案)` ⇒ `level:'L1'`、`lockdown:false`；`L1_BOUNDS` = `{maxFiles:3, maxDiffLines:20}`；`stageOrderFor('code','L1')` = `['Develop','Review','Settlement']`（无 `Plan`/`Planning`/`Test`）；`completionEvidenceKindsFor('code','L1')` = `['review']`。`exp8` 在真实 SQLite 上：`submitPlan` 批准一句话 Plan → `requestCodeWrite` 准入 → Develop/Review 证据 → **契约 CAS 桩**提交（`cas:eeeeeeeeeeee`，分支 `agentdev/delivery`）→ 冻结 `CompletionManifest` → `completeWork` `ok:true`、`evidenceKind:'review'`、`work.status:'completed'`、`completionManifestHash` 为 64 位内容摘要；CAS 提交的 `revision/tree` 与完成清单的 `finalRevision/verifiedCodeTree` 相等；该 Work 的 Run 角色集合**不含 `test`**、`store.tasks.count()===0`、`store.requirements.count()===0`、`work.requirementId===undefined`。`exp4` 另证 L1 完成结果对象**不含** `testStatus`/`testRunId`（`'testStatus' in result === false`）。

**负向**：4 文件 ⇒ `L2`；21 行 ⇒ `L2`；目标替换不明确 ⇒ `L2`；空 Diff ⇒ 非 L1；无 Review ⇒ 拒绝；无 `CompletionManifest` ⇒ `GATE_NOT_READY`；外来 Work 的完成清单 ⇒ 拒绝；L1 Work 用 Test 代替 ReviewCheck 完成 ⇒ 拒绝（`exp10`）。

### AC-008 一字语义 —— 通过

> Given 一字符改变权限或金额；When 分类；Then 命中 L3，不按行数降级，所需用户行为决定已保存。

**正向**：`1 文件/1 行/1 字符 + permissionChange` ⇒ `L3`、`lockdown:true`、`diffOverL1:false`（行数在界内也不能降级）；`paymentChange` ⇒ `L3`；`interfaceChange` ⇒ `L3`；未识别风险旗标 ⇒ `L3`（fail-closed）并回报旗标。`exp7` 在真实 SQLite 上：L1 Work 的一字符权限改动经 `upgradeLevel` ⇒ `level:'L3'`（不是 L2）、旧 L1 Plan `stale` 且写请求 `GATE_NOT_READY`。

**负向**：`evaluateLevelUpgrade(previousLevel:'L3', 小 diff)` ⇒ `outcome:'downgrade_refused'`、`level:'L3'`、`stalePlan:false`；core `upgradeLevel` 同位场景 ⇒ `outcome:'downgrade_refused'`、`code:'STALE_ARTIFACT'`、级别保持 L3、无 `delivery.level_upgraded` 事件；一字符 `logicChange` ⇒ `L2`（不是 L3，但确实离开 L1）。

### AC-009 L1 升级 —— 通过

> Given 实际 Diff 超过 3 文件/20 行或出现逻辑改动；When 写入范围扩展前重评；Then 升级 L2 或 L3、同 Work 关联 Requirement、补齐 Gate。

**正向**（`exp1`/`exp2`/`exp7`）：4 文件 / 21 行 ⇒ `outcome:'upgrade'`、`level:'L2'`、`stalePlan:true`；隐藏 `logicChange`（1 文件/1 行）⇒ `upgrade` 至 L2。core：升级后 `getWorkLevel==='L2'`、`work.requirementId` 关联并要求 `requirementId` 传入、旧 Plan 产物 `validity:'invalid'`、`delivery.level_upgraded` 事件 1 条、`stalePlanRefs=[P1.hash]`、旧 Plan 写请求 `GATE_NOT_READY`+`stalePlan:true`、替代 Plan 写请求 `allowed:true`（Gate 补齐）。域规则：L2/L3 代码链缺 Requirement ⇒ `MISSING_CONTEXT`。

**负向**：无升级需求（记录等级已覆盖）⇒ `outcome:'noop'` 且**零事件/零 snapshot**；未批准的替代 Plan ⇒ `outcome:'refused'`、级别不变；把“缩小的 diff”当升级 ⇒ `downgrade_refused` 且当前 Plan 仍 `valid`、写仍准入；异 Revision 的 Plan 不因升级而 `plan_stale`（`planEvidence.code==='REVISION_MISMATCH'`）；升级不能更换 Requirement（`existingRequirementId!==requirementId` ⇒ `MISSING_CONTEXT`）。

### AC-010 标准交付 —— 通过

> Given 有效 ProductDefinition；When L2 实现；Then 独立 Plan/Develop/Review/Test/Settlement 依序有效。

**正向**（`exp1`/`exp4`/`exp8`）：`stageOrderFor('code','L2')` = `['Plan','Develop','Review','Test','Settlement']`；完整链（每阶段绑 `codeRevision`，Review/Test 另绑 `environmentRef`，逐级 `dependsOn`）⇒ `ok:true`；`completionEvidenceKindsFor('code','L2'|'L3')` = `['test','review']`（**必需双证据**，主证据仍 `'test'`）。`exp8` 端到端：Plan 批准 → Develop/Review/Test 证据 → `completeWork(route:'code', level:'L2')` `ok:true`、`evidenceKinds:['test','review']`、`testStatus:'passed'`、`reviewStatus:'passed'`、`reviewRunId` 指向独立 Review Run、`work.status:'completed'`。

**负向**：缺任一阶段 ⇒ `GATE_NOT_READY` 且点名阶段；阶段未依赖前序 / Review 无冻结 Revision / Test 无环境 ⇒ 拒绝；缺 Requirement ⇒ `MISSING_CONTEXT`；**code L2 仅凭 Test Run 完成 ⇒ `GATE_NOT_READY` 且消息点名 `Review`**（W6R4-01 回归，`exp4`/`exp10`）；Review Run 状态非 `completed`、无 `stage_result`、`stage_result.status!=='success'`、无冻结 Revision、artifact 被失效、以及用 Test Run 冒充 Review Run ⇒ 全部拒绝（`exp10` 7 类旁路尝试全灭）。

### AC-011 高风险交付 —— 通过（真实迁移/演练 UNVERIFIED）

> Given 数据迁移需求；When L3 实施；Then 存在明确授权、回退、逐项审核和恢复演练证据。

**正向**（`exp1`/`exp8`）：`stageOrderFor('code','L3')` 含 `Recovery`；`requirement.previousLevel==='L3'`（显式授权）+ `Plan.rollbackPlanRef` + `Review.auditRef`（或 Test）+ `Recovery.recoveryDrillRef` 均为 `id`+`hash` 非空的 `Ref` ⇒ `ok:true`。

**负向**：缺显式授权 ⇒ `MISSING_CONTEXT`；缺回退/逐项审核/恢复演练任一 Ref ⇒ `MISSING_CONTEXT` 且点名该项；用自由文本（含自否定句 `there is no rollback plan but rollback`）满足 ⇒ 仍 `MISSING_CONTEXT`；`Ref.hash` 为空 ⇒ 拒绝；升级换 Requirement ⇒ 拒绝。

**UNVERIFIED**：真实数据迁移输出、真实回退执行与恢复演练记录。本包按 `implementation.md` WP-06 只验证域规则与链证据（结构化 Ref 为夹具绑定的真实 artifact `Ref`），真实迁移/恢复演练属 **WP-08/WP-10**（Review §8 同口径）。

### AC-012 正式结论 —— 通过

> Given 用户只要求保存确认设计；When document 路线；Then Product/Planning 候选 Diff、独立 Review、Settlement，无代码测试或开发 Requirement。

**正向**（`exp1`/`exp4`/`exp8`）：`documentRouteRules('L2')` = `{stages:['Product','Planning','Review','Settlement'], codeTestStage:false, developmentRequirement:false, independentReview:true, producesCandidateDiff:true, settlement:true}`；文档链**不要求** `codeRevision`/`environmentRef`；Review 绑定 Planning 产出的真实 `diff` artifact 的 `candidateDiffRef` ⇒ `ok:true`。端到端：`intent:'document'` 的 Work 以 Review 证据 + 冻结完成清单 `completeWork` `ok:true`、`evidenceKind:'review'`、完成事件 `route:'document'` 且**不含** test 命名字段、`requirements.count()===0`、`tasks.count()===0`、无 `role='test'` Run。

**负向**：Review 不绑结构化候选 Diff（仅自由文本 `candidate diff approved`）⇒ `VALIDATION_ERROR`；`candidateDiffRef.hash` 为空 ⇒ 拒绝；缺独立 Review 阶段 ⇒ 拒绝；`intent:'delivery'` 的 Work 声明 `route:'document'` ⇒ `VALIDATION_ERROR`（完成路线由持久 `intent` 推导，W6R3-01）；`intent` 无交付路线（`assist`）⇒ `VALIDATION_ERROR`；document Work 用 Test Run 完成 ⇒ 拒绝。

### AC-013 无效 Plan —— 通过

> Given 无批准 Plan 的代码写请求；When Broker 校验；Then `GATE_NOT_READY` 且源码 Hash 不变。

**正向/负向**（`exp1`/`exp2`/`exp7`）：无批准 Plan ⇒ `allowed:false`、`code:'GATE_NOT_READY'`，`StoreSourceHashPort.snapshot` 的 `digest` 与 6 张可写表行数在**拒绝前后完全相同**、`delivery.write_admitted` 事件数 0、artifact 数不变；`sourceHash===sourceHashAfter`。异 Revision ⇒ `VALIDATION_ERROR`；Plan Hash 伪造 ⇒ `GATE_NOT_READY`（`stalePlan:true`）；Plan 内容变化 / Revision 不符 / `approval` 缺失 ⇒ `GATE_NOT_READY`；**源码移动**（同一 revision、可控 `contentHash` 新旧不同）⇒ `GATE_NOT_READY` 且消息含 `source hash changed`，拒绝零写入；调用方 `expectedSourceHash` **不能**替换批准记录 Hash（源码移动后传移动值仍拒绝）；无 `baseRevision` 的 Work ⇒ `GATE_NOT_READY`；**授权在批准后被撤销 ⇒ `NOT_AUTHORIZED`**；授权被收窄至不再覆盖 Plan 写路径 ⇒ `NOT_AUTHORIZED`；Work 非 `running`（7 态）⇒ `INVALID_STATE`（`exp2`/`exp5`/`exp10`）。批准后同 revision 同源码 ⇒ `allowed:true`。

### AC-014 范围内自动 Plan —— 通过

> Given 已授权目标/权限/预算且无新产品选择；When 提交合规 Plan；Then 自动批准保存依据并由 Chief 续派。

**正向**（`exp1`/`exp2`）：合规 Plan ⇒ `approved:true`、`approval:'auto'`、依据含 `approvedBy:'auto'`、`authorizationRef`、`planId/planVersion/planHash`、`revision`、`workId`、`at`；批准记录 content-addressed（`approvalRecordHash` 64 hex）；Plan 可重读且过 `planSchema`；`getCurrentPlanApproval.status==='approved'`；批准即 `tokensReserved += requested`。

**负向**：`productChanged:true` ⇒ `GATE_NOT_READY` + `decisionRequired:true`；无/空授权引用 ⇒ `NOT_AUTHORIZED`；写路径越出信封 ⇒ `NOT_AUTHORIZED`；未授权 operation ⇒ `NOT_AUTHORIZED`；外来 Work 授权 ⇒ `NOT_AUTHORIZED`；异 Revision ⇒ `VALIDATION_ERROR`；空 Task DAG ⇒ `VALIDATION_ERROR`；`used 95000 + reserved 4000 + requested 2000 > 100000` ⇒ `BUDGET_EXCEEDED` 且零落库、`tokensReserved` 不变；批准后撤销授权再写 ⇒ `NOT_AUTHORIZED`（W6R1-05 回归）。所有拒绝路径 artifact 数不变。

### AC-015 产品变化 —— 通过

> Given 执行中发现行为选择；When 用户选本次处理；Then 先 Decision 与新 Product/Plan，旧受影响证据失效。

**正向**（`exp1`/`exp3`）：`choice:'now'` ⇒ Decision `state:'accepted'`、`newProductRequired/newPlanRequired:true`；受影响证据（显式 ref）精确失效、未受影响证据保留；**旧 Product 的已批准 Plan artifact 也被失效**；`getInvalidatedEvidence` 可重读同一集合；Product 版本 +1（两次 `now` 单调递增），Plan 版本同步前进；Requirement 回 `phase:'product'`、`recordVersion+1`；旧批准 Plan 变 `stale`，`requestCodeWrite` `GATE_NOT_READY` 且源码 Hash 不变。未知范围（无 `affectedRefs`/`affectedPaths`）⇒ 全部失效（fail-closed）；同 Work 内路径可缩小失效范围。

**负向**：未知 Requirement ⇒ `NOT_FOUND` 抛错且不落库。

### AC-016 以后或拒绝 —— 通过

> Given 有产品变化建议；When 用户选以后/不采纳；Then 以后创建 Queued；拒绝留原因；当前验收不变。

**正向**（`exp1`/`exp3`）：`later` ⇒ 新 Requirement `lifecycle:'queued'`、`executionAvailability:'needs_replan'`、`recordVersion` 从 1 起，当前验收不变（`currentAcceptanceUnchanged:true`）、不失效任何证据、不改动原 Requirement（phase/recordVersion 不变）；每次 `later` 生成独立 Requirement。`decline` ⇒ Decision `state:'rejected'`、`reason` 保留、不排队（Requirement 数不变）、证据不变、原 Requirement 不变。

**负向**：`decline` 分支不会排队（服务层对 `decline`+queued 组合 `INVALID_STATE`）。

### AC-017 自动返工 —— 通过

> Given Review 发现范围内缺陷；When 返回开发修复；Then 无需人工转发，新独立 Review/Test，旧结果无效。

**正向**（`exp1`/`exp4`/`exp7`）：Review/Test Run 才能提 Finding（Developer Run 提 Finding ⇒ `NOT_AUTHORIZED`）；提交即 `transition:'return_to_development'`、`requiresNewReview:true`、`requiresNewTest:true`、追加 `finding.created` 事件；该 Work 全部**有效** review/test 产物 `validity:'invalid'`、受影响 review Task 重开 `develop`；修复须由实现角色（`backend`/`frontend`/`product`/`planning`）的 `completed` Run 完成、并**推进 `work.baseRevision`**、冻结 `finding_addressed` 血缘快照（含 `previousBaseRevision`/`baseRevision`/`fixEvidenceAt`）。修复后旧证据**不能**再完成 Work（`completeWork` ⇒ `GATE_NOT_READY`，消息含 `invalidated`，`delivery.work_completed` 事件 0）也不能关闭 Finding；新 Revision 的新独立 Review+Test 才可。

**负向**：修复 Run 自述被失效的 pre-fix Revision ⇒ `markAddressed` 拒绝、Finding 保持 `open`、`baseRevision` 不变；修复 Run 未冻结 Revision / 未完成 / 角色不符 ⇒ 拒绝；Review 角色不能标记 `addressed`。

### AC-018 Finding 关闭 —— 通过

> Given Developer 标 addressed；When 尝试自己 verified；Then 拒绝；独立 Review 验证后关闭。

**正向**（`exp1`/`exp4`/`exp7`）：`addressed` 后，非独立/角色不符一律拒绝：`actorRole:'backend'` ⇒ `NOT_AUTHORIZED`；`open` ⇒ `INVALID_STATE`；已 `verified` ⇒ `INVALID_STATE`。独立性判定锚定持久事实：Review Run 必须是本 Work 的 `role='review'`、`completed`、非修复 Run、非提 Finding 的 Review、`createdAt > fixRun.createdAt`，且其**自身冻结证据**有效、Revision 等于 `fixingRevision` 且等于 Work 当前 Revision；Test 另需真实 `status==='passed'`。满足后 `verifyFinding` ⇒ `ok:true`、`state:'verified'`、冻结 `finding_verification`（含 `fixingRevision`/`reviewRevision`/`testRunConclusion`）、追加 `finding.verified` 事件；二次关闭 ⇒ `INVALID_STATE`。

**负向**（全部拒绝）：失败的 Test；`not_covered` 的 Test；无结论的 Test（不折算 `passed`）；证据被失效的 Run；异 Revision 的 Review/Test；未冻结 Revision 的修复；修复未产生新 Revision（`fixingRevision !== currentWorkRevision`）；`fixingRevision` 属被失效集合；Review Run 冒充 Test；未复核当前 Revision 的 Review；仅 Review 无 Test。

### AC-019 未覆盖验证 —— 通过

> Given Test 有 not_covered 或 blocked；When 请求完成；Then blocked 不完成；未覆盖需明确适用风险处置。

**正向**（`exp1`/`exp4`/`exp7`）：`blocked` ⇒ 永不完成（即便提供风险处置）；`not_covered` 未处置 ⇒ `GATE_NOT_READY` 且 `needsRiskDisposition` 精确列出未处置的 acceptance id（如 `['AC-010','AC-019']`）；每个 id 绑定本 Work 的真实已接受 `risk` Decision 后才 `ok:true` 并记录 `riskDecisionIds`；`passed` 通过。**code L2/L3 必须同时绑定独立 Review Run 与 Test Run**：仅 Test ⇒ 拒绝并点名 `Review`。

**负向**：无 Test 证据；Test Run 异 Work/角色不符/未完成/无 `CheckResult`；证据异 Revision 或已被失效；风险处置指向 Test 未列的 acceptance id（`VALIDATION_ERROR`）；风险 Decision 属外来 Work；未关闭的阻塞 Finding（`open`/`addressed`）⇒ 即便新 Revision 的 passed 证据也拒绝并点名 `blocking Findings`。

### AC-020 暂停恢复 —— 通过

> Given 活动修改；When 用户暂停再恢复；Then 安全点暂停、无新写入，版本检查后新 Attempt。

**正向**（`exp1`/`exp5`）：暂停先规划整个安全点（`recovery_required` Run ⇒ `RECOVERY_REQUIRED` 且无半状态）；`work.status:'paused'`、活动 Run 置 `paused`、活动 Attempt 置 `stopped`、写 per-Run `run_checkpoint` 与 `work_pause` 屏障（`barrierRef` 64 hex）、`work.control_changed(control='pause')` 且恰有 1 条摘要事件携带 `barrierRef`；暂停后 `writeAdmission` 与 `requestCodeWrite` **同判** `INVALID_STATE` 且零写入；恢复校验 Work 版本、屏障记录的 Work 版本、Task 版本，随后为新 Attempt（`number:2`、`status:'starting'`、Run 再置 `running`）；恢复窗口内 `writeAdmission` 拒绝（reason 含 `ready Attempt`），Attempt 置 `running` 后才准入。

**负向**：重复暂停 ⇒ `INVALID_STATE`；过期 Work 版本 / 过期 Task 版本 / 暂停期间 Work 变更 ⇒ `VERSION_CONFLICT`。

### AC-021 取消需求 —— 通过

> Given 含活动子 Run；When 用户取消；Then 安全结束前为 cancelling/recovery，结束为 cancelled，保留成果不集成。

**正向**（`exp1`/`exp5`）：`cancelWork` 先入 `cancelling` 再落 `cancelled`；`cancelRuns` 级联 parent→child（`cancelledRunIds` 含两者）、Attempt 置 `stopped`；候选 artifact 保留 `valid` 且 `integrated:false`；Requirement 转 `cancelled`；落 `work_cancellation` 快照（`recordRef` 64 hex）与 `work.control_changed(control='cancel')`；取消后写被拒。`sideEffectsUnknown:true` ⇒ 停在 `blocked(recovery)`、开 pending `recovery` Decision 并写入 `blockerIds`、Requirement 保持 `active`；`resolveCancellation('accept_cancel')` ⇒ `cancelled` + Requirement `cancelled` + blocker 清空；`resolveCancellation('resume')` ⇒ `running` 且 Decision `rejected`。

**负向**：已取消/已完成 Work 再取消 ⇒ `INVALID_STATE`；未知 recovery Decision ⇒ `NOT_FOUND`；外来 Work 的 recovery Decision ⇒ `NOT_AUTHORIZED`。

### AC-022 预算止损 —— 通过

> Given 并发调用接近限额；When 尝试预留超额或超返工；Then 原子拒绝；用户增加预算后继续，无静默加额。

**正向**（`exp1`/`exp2`/`exp4`/`exp7`）：`canReserveBudget({limit:100,used:60,reserved:30}, requested 11)` ⇒ `ok:false`、`BUDGET_EXCEEDED`、`requiresUserTopUp:true`、`budgetAfter` **逐字段等于输入**（原子、无部分记账）；请求 10 ⇒ `ok:true` 且 `tokensReserved:40`；`requested<0` / 小数 ⇒ `VALIDATION_ERROR`；`0+100` 满额再请求 ⇒ 拒绝；显式把 `tokenLimit` 提到 200 后同一请求 ⇒ 通过。服务层：批准即预留（首份 60 ⇒ `tokensReserved:60`，第二份 60 ⇒ `BUDGET_EXCEEDED`，剩余 40 ⇒ 批准至 `100`，再请求 1 ⇒ 拒绝）；`evaluatePlanApproval` 使用真实 `used`（`used 60 + reserved 30 + 50 > 100` ⇒ `BUDGET_EXCEEDED`），缺失 `used` 时按 fail-closed 处理（可行则 `VALIDATION_ERROR`，不可行则 `BUDGET_EXCEEDED`），**绝不静默按 0**。返工额度：`repairUsed 3 / repairLimit 3` ⇒ 拒绝且 `requiresUserTopUp:true`；Finding 关闭路径同判 `BUDGET_EXCEEDED`。

**负向/边界**：`budget` 表本身拒绝 `used + reserved > limit`（我在夹具中构造该行时被 `CONSTRAINT_VIOLATION` 拒绝，说明持久层另有守恒约束）；**完成期无预算复核**——`tokensUsed===tokenLimit`（0 余量）的 Work 仍可 `completeWork`（`exp10` RESIDUAL），该点已由 `implementation.md` T6 残余 2 登记（属 WP-08），不影响 AC-022 的 Then。

### AC-083 组合及文档 Finding —— 通过

> Given 无 Task 文档或集成 Review 发现问题；When 提交 Finding 并修复；Then 绑定 Review 目标/Manifest，无需伪造 taskId；修复后独立核验关闭。

**正向**（`exp1`/`exp4`）：`targetKind:'integration'`/`'document'` 且无 `taskId` ⇒ 接受，`binding.taskId === undefined`（**不伪造**）、`manifestRef` 绑定 Review 的 Manifest、冻结 `finding_binding` 快照（`recordHash` 64 hex）；域规则同判 `return_to_development`。

**负向**：`targetKind:'task'` 缺 `taskId` ⇒ `VALIDATION_ERROR`；外来 Task ⇒ `NOT_AUTHORIZED`；Manifest Ref 不完整 ⇒ `VALIDATION_ERROR`；`manifestId` 为空 ⇒ 域规则 `noop`。

### AC-089 进行中需求继续 —— 通过

> Given Git 含 active 需求且无本机 Work；When 打开后点击继续；Then 先显示待继续且不启动 Run；用户继续后创建新 Work，取得本机授权，从未满足 Gate 重新规划验证。

**正向**（`exp6`/`exp9`）：`listContinuable()` 只返回 `lifecycle='active' AND work_id IS NULL AND execution_availability='needs_replan'`，`waitingToContinue:true`、`phase:null`；**纯投影**——调用前后 Work/Run/authorization/event 计数完全不变。`continueRequirement`（用户消息或用户 action 作为 `authorizationRef`）⇒ 新 Work `status:'queued'`、`intent:'delivery'`、`requirementId` 关联、**本机 Authorization**（`sourceRef.kind:'message'|'action'`）、独立 budget（应用请求的 `tokenLimit`/`repairLimit`）；Requirement ⇒ `workId` 写入、`executionAvailability:'local'`、`phase:'product'`、`recordVersion+1`；`firstGate:'product'`、`requiresReplan:true`、`requiresReverification:true`、`reusedPreviousVerification:false`、`reusedManifestIds:[]`、`unmetGates` 非空且**全部** `GATE_NOT_READY`（含 `Plan`、`Test`）；启动 **0 个 Run**；落 `requirement.changed` 事件（含 `reusedPreviousVerification:false`）；继续后不再出现在待继续列表。

**负向**：二次继续 / 非 active / 已有本地 Work ⇒ `INVALID_STATE`；空授权源 ⇒ `VALIDATION_ERROR`；未知授权源或外来 agent 消息 ⇒ `NOT_AUTHORIZED`；未知 Requirement ⇒ `NOT_FOUND`；所有拒绝路径不创建 Work/Run。**无 `baseRevision` 的继续形状**（T7 残余 2 / T8 残余 8）：`requestCodeWrite` fail-closed `GATE_NOT_READY`、`completeWork` 拒绝，Work 保持 `queued`（`exp9`）。

---

## 4. 五项必需失败测试

（`exp7-failures.mjs`，60 断言 0 失败；每项均在真实 SQLite 上经服务公共 API 执行）

| # | 名称 | 关键观察 |
|---|---|---|
| 1 | **一字符高风险** | 1 字符权限改动 ⇒ `L3`+`lockdown`+`diffOverL1:false`；L1 Work 经 `upgradeLevel` ⇒ L3（非 L2）、旧 Plan `stale`+写拒+源码 Hash 不变；再评小 diff ⇒ `downgrade_refused` 且级别保持 L3 |
| 2 | **超L1升级** | 4 文件/21 行 ⇒ `upgraded:true`、`level:'L2'`、同 Work 关联 Requirement、`stalePlanRefs:[P1.hash]`、P1 artifact `invalid`、旧 Plan 写 `GATE_NOT_READY`+`stalePlan:true`、替代 Plan 写 `allowed:true`、源码 `contentHash` 不变 |
| 3 | **过期Plan** | 批准后源码移动（同 revision、内容 Hash 变）⇒ `GATE_NOT_READY`+`source hash changed`、`sourceHash===sourceHashAfter`、`digest` 与事件/artifact 计数不变；伪造 hash 的 Plan ⇒ `stalePlan:true` 且点名 current Plan |
| 4 | **修复后证据失效** | pre-fix Review/Test 既不能 `completeWork`（`GATE_NOT_READY`+`invalidated`、0 完成事件、Work 仍 `running`）也不能关闭 Finding；新 Revision 的新独立 Review+Test ⇒ `verified` 且完成（`evidenceKinds:['test','review']`） |
| 5 | **未覆盖阻断** | `not_covered` 两项未处置 ⇒ `needsRiskDisposition:['AC-010','AC-019']`、Work 仍 `running`、0 完成事件；越界 acceptance id 处置 ⇒ `VALIDATION_ERROR`；两项均绑定已接受 risk Decision ⇒ 完成并记录 2 个 `riskDecisionIds`；`blocked` ⇒ 永不完成 |

已提交套件对照（仅作对照，不作为本轮证据）：`node_modules/.bin/vitest run --project unit packages/core/test/delivery-failures.test.ts --reporter=verbose` ⇒ `Test Files 1 passed (1)` / `Tests 5 passed (5)`，五个用例名分别为「一字符高风险 / 超L1升级 / 过期Plan / 修复后证据失效 / 未覆盖阻断」。

---

## 5. Findings

### T-01 [P2] 冻结点 `b0d226f` 的代码改动晚于最后一次独立 Review，无配套新 Review

- **位置/证据**：`git log` 为 `b0d226f(fix) → 793e7c8(docs(review) round 4 PASS) → 43c10ce(fix round-3 findings)`；`review.md` 第 4 轮自述冻结点 `43c10ce`（tree `56003a1d…`）；`git diff --stat 793e7c8 b0d226f` 含 `packages/core/src/findings.ts`（+131/−）、`packages/domain/src/delivery.ts`（+37/−）及其 4 个测试文件（代码改动 418 插入/44 删除），即**代码改动发生在最后一次独立 Review 之后**。
- **复现**：`git rev-parse HEAD`、`git rev-parse b0d226f^{tree}`、`git log --oneline -6`、`git diff --stat 793e7c8 b0d226f`。
- **observed vs expected**：observed = 被测代码树 `b0d226f` 无对应的独立 Review 产物；expected（`docs/rules/workflow.md` §6/§9、`docs/rules/agents.md`）＝「Review 或 Test 之后的代码改动需回到独立 Review」，「最终完成清单绑定验证代码树…证据 Hash」。
- **影响面**：流程/追溯缺口，不产生错误行为。`b0d226f` 关闭的正是第 4 轮点名「由独立 Test 与 WP-08 一并复验；若 Test 判定 W6R4-01 影响 AC-010/§7 的验收口径，应转为返工项」的两条残余，本轮已独立复验（§3 AC-010、`exp4`/`exp10`）：code L2/L3 仅凭 Test 完成被拒（旧行为 `ok:true`），Review 证据按 kind 分列。
- **处置建议**：Settlement 前对 `b0d226f` 补一轮独立 Review（或由用户/评审明确记录复用与风险接受）；**不阻断本轮 Test 的行为判定**。
- 关联 AC：AC-010/AC-019（行为面已通过），流程面属 `workflow.md` §6/§9。

### T-02 [P3] `not_covered` 且 `uncovered` 为空时阻断但不可处置

- **位置**：`packages/domain/src/delivery.ts` `findingBlocksCompletion`（`testResult.status==='not_covered'` 分支）。
- **复现**：`exp1`：`findingBlocksCompletion({status:'not_covered', uncovered:[]})` ⇒ `{blocked:true, reasons:['not_covered requires an explicit risk disposition for every acceptance id'], needsRiskDisposition:[]}`。
- **observed vs expected**：observed = 阻断（fail-closed，方向正确）但 `needsRiskDisposition` 为空，调用方拿不到可处置条目；expected（AC-019 可用性口径）= 阻断应点名需要处置的验收 ID，或把「`not_covered` 却未列缺口」作为记录不一致单独报错。
- **影响**：一个自相矛盾的 Test 记录会永久阻塞且无可操作项；需要人工介入。不阻断 AC-019（AC-019 的 Then 是「blocked 不完成、未覆盖需明确风险处置」，本行为不构成放行）。

### T-03 [P3] `evaluateFindingRouting` 对未知 `state` 走 `accepted_risk` 兜底

- **位置**：`packages/domain/src/delivery.ts` `evaluateFindingRouting` 末尾 `return { transition:'accepted_risk', … }`。
- **复现**：`exp1`：`evaluateFindingRouting({state:'bogus', …})` ⇒ `transition:'accepted_risk'`、`requiresNewReview:false`。
- **observed vs expected**：observed = 未知状态被读作「用户已接受风险」；expected（fail-closed 惯例，参见同文件 L1/风险旗标处理）= 未知状态应拒绝或至少不给出「无需新 Review」的结论。
- **影响**：类型层 `state` 为枚举、Core 的 `candidateOf` 只传持久枚举值，当前**不可从 Core 公共 API 到达**；属健壮性/防御性观察，不阻断任何 AC。

### T-04 [P3] 恢复后的第二个 Attempt 与第一个共享 `ownerEpoch`

- **位置**：`packages/core/src/findings.ts` `openAttempt`（`ownerEpoch: previous.length`）；同约定见既有 `packages/core/src/run-lifecycle.ts` `beginAttempt`（WP-02 代码）。
- **复现**：`exp5`：暂停后恢复 ⇒ 新 Attempt `{number:2, status:'starting', ownerEpoch:1}`；第一个 Attempt 的 `ownerEpoch` 也是 1。
- **observed vs expected**：observed = 第 N 个 Attempt 的 epoch = N−1（第二个 attempt 与第一个同 epoch）；expected（`reliability.md` §2「incrementing epoch」的字面口径）= 每个新 Attempt 的 epoch 严格大于前一个。`number` 单调唯一，`StageGate.submit` 以调用方 capability 的 `epoch` 与该 Attempt 的 `ownerEpoch` 比较且同时绑定 `attemptId`，因此未观察到可复用的陈旧凭证。
- **影响**：跨 Attempt 的 epoch 严格递增在 WP-06 面不可证；建议在 WP-07 的 Runner/Grant 接线时统一 epoch 语义（已由 T5 残余 4 / T7 残余 7 覆盖同源范围）。不阻断 AC-020。

---

## 6. 已登记残余的独立复现（非新缺陷）

`implementation.md` T5–T9 与 Review 1…4 轮登记的残余，本轮逐项复现并据此调整 AC 判定口径：

| 登记项 | 出处 | 本轮独立复现 | 对判定的影响 |
|---|---|---|---|
| WP-08 接线：`completeWork` 不含集成/CAS/最终 Settlement/`CompletionManifest` 覆盖度 | T5 残余 5、T6 残余 2、T7 残余 1、T9 残余 5 | `exp9`：code L2 完成时 `completionManifestHash:null`、`finalRevision` 与 CAS 目标不一致也被接受（`ok:true`）；`exp10`：Work 无任何 `plan` artifact、无 Develop/Settlement Manifest 链仍可完成 | AC-007/AC-010/AC-012 的**链与证据种类**判定通过；「清单覆盖每一被验证 Manifest / 等于 CAS 后 finalRevision」**UNVERIFIED → WP-08/WP-10** |
| completion 事件 schema：code L2/L3 事件只带主证据（Test）字段 | T9 残余 1 | `exp9`：code L2 完成事件含 `testRunId`、**不含** `reviewRunId`；结果对象含 `evidenceKinds`/`reviewRunId` | AC-010 的「Review+Test 双证据」在**门禁**与**结果对象**上通过；事件审计完整性 → WP-08（已登记） |
| 可选 `CompletionManifest`（code L2/L3） | T7 残余 1、T9 残余 5 | `exp9`：无 `completionManifestRef` 的 code L2/L3 完成 `ok:true` | 同 WP-08 行 |
| operation 路线证据模型（无 `Test`，只有 Review 证据；无 `Verify` 证据规则） | T6 残余 4、T7 残余 6、T9 残余 6 | `exp9`：`completionEvidenceKindsFor('operation','L2')===['review']`；`intent:'operation'` 的 Work 以 Review 证据完成，`evidenceKinds:['review']` | operation 路线**不属 WP-06 关联 AC**；已登记 → WP-08 |
| 无 `baseRevision` 的继续形状（AC-089 路径）不能完成/写入 | T7 残余 2、T8 残余 8 | `exp9`：继续创建的 Work `baseRevision:undefined`；`requestCodeWrite` `GATE_NOT_READY`；`completeWork` 拒绝；Work 保持 `queued` | AC-089 的「待继续→继续→新 Work+授权+Gate 未满足」通过；该形状的交付需真实 Revision（WP-08），**UNVERIFIED** |
| 容器/挂载负例 | T5 残余 8（环境阻塞）、WP-07 | 本轮 `docker info` 成功；`pnpm test:integration` 132/132，含 `doctor.integration.test.ts`（8 例）与 `container.integration.test.ts`（9 例，只读 rootfs/只读挂载/cap-drop/无网络/pid 内存上限） | WP-06 不拥有该面；作为环境健康证据记录，最终归属 WP-07 |
| `writeAdmission` 未接入 Broker/工具准入 | T5 残余 3、T7 残余 7 | `exp5`：暂停/取消/recovery 后两门禁同判拒绝、`recovery_required` 原子拒绝暂停；`exp10`：完成态再写 `INVALID_STATE`、未知 Run `NOT_FOUND`（`failed` 态由已提交测试 W6R3-02 覆盖） | AC-020/021 的**门禁规则**通过；执行面接线 → WP-07 |
| `evidenceValid` 为必填、须从 `artifact.validity` 读取 | T7 残余 8 | `exp4`/`exp10`：无条件传入有效性的调用可达；Core 全部从持久 artifact 读取；省略/失效即拒 | 作为 WP-07 接线约束登记 |
| 冻结 Manifest 键空间（只认 payload 声明的 `manifestId`） | T8 残余 4、W6R3-05 | 未直接构造（无写入方）；`exp4` 覆盖「无 artifact 的 Test 经冻结 Manifest 完成」与「命名未冻结 Manifest 时精确拒绝」 | 与登记一致；真实写入方 → WP-08 |

---

## 7. 记录一致性核对

1. **冻结点一致**：`git rev-parse HEAD` = `b0d226f000de23902e1884c30a18d6f34d443ea2` = task 指定冻结点；`git rev-parse b0d226f^{tree}` = `4700ab764a4ed30110c3326ea3ef1fe9765fc266`；`git status --porcelain` 命令前后与全部实验后均为空。
2. **实现记录与代码一致**：`implementation.md` T1–T4 的产物（`packages/domain/src/delivery.ts`、`packages/core/src/{gates,decisions,findings,requirement-continue}.ts` 与 4 个测试文件）在树中存在且可运行；T4 声明的两个测试文件（`delivery.integration.test.ts` 8 例、`delivery-failures.test.ts` 5 例）在本轮 `pnpm test:unit`/`test:integration` 中全绿。
3. **Review 轮次与实现记录对齐**：Review 第 1/2/3 轮判 FAIL（`review.md` §1/§11/§22 起），第 4 轮判 PASS（§33），与 `implementation.md` T6/T7/T8/T9 记载的 W6R1-xx/W6R2-xx/W6R3-xx/W6R4-xx 修复一一对应；T9 明确说明本轮处理的 2 条来自第 4 轮的非阻断残余。
4. **唯一的记录缺口 = T-01**：最后一次 Review 的冻结点是 `43c10ce`，此后 `b0d226f` 又改动了 `findings.ts`/`delivery.ts` 及 4 个测试文件，且没有第 5 轮 Review 产物；`review.md` 内不含 `b0d226f`。这符合「Review 后代码改动需回到独立 Review」的缺口定义（与 WP-02 Test 报告 O1 同类）。
5. **task 点名的承接项均已登记**：WP-08 接线（`implementation.md:43/54/131/245/249`）、WP-07 容器/挂载负例（`:48/52/55/57/132/251/252`）、operation 路线证据（`:133/250/390`）、完成事件 schema（`:385`）、可选 `CompletionManifest`（`:245/389`）、无 `baseRevision` 的继续形状（`:176/246/335`）。本轮对每一项都给出了独立观察值（§6 表），并在相应 AC 判定中显式标注 UNVERIFIED 或已登记。
6. **本轮写入范围**：仅 `.agentdev/work/WP-06/test.md`；实验与日志均在 `/tmp/wp06t/`。未修改任何产品代码、Schema、测试或文档。

---

## 8. 未覆盖与剩余风险

| 项 | 状态 | 原因 | 承接 |
|---|---|---|---|
| HTTP/WS/Broker 协议面（Gate/Finding/Decision 的对外路由、幂等键、错误码映射） | **未覆盖** | WP-06 只交付包公共 API；daemon/BFF/WS 属完整工作台 | WP-09 / WP-10 |
| 真实 Git CAS、`CompletionManifest`/`VerificationManifest` 写入方与最终 Settlement 覆盖度 | **UNVERIFIED** | WP-06 规定 Run 工具/Git 提交用契约桩；清单写入方与覆盖核对属集成包 | WP-08 / WP-10（`exp9`/`exp10` 已复现缺口） |
| 真实数据迁移输出、真实回退执行、恢复演练记录（AC-011 的证据内容） | **UNVERIFIED** | 本包只验证链与结构化证据判定；真实演练属集成/发布 | WP-08 / WP-10 |
| 完成期预算复核（`used+reserved<=limit` 在 `completeWork` 前） | **UNVERIFIED（已登记）** | T6 残余 2；`budget` 表另有守恒约束，`exp10` 证明 0 余量 Work 仍可完成 | WP-08 |
| operation 路线的 `Verify` 证据规则 | **未覆盖（已登记）** | T6/T7/T9 残余；operation 不属 WP-06 关联 AC | WP-08 |
| Broker/Grant/容器工具层写准入与「暂停后工具级拒绝」 | **未覆盖** | 执行面在 WP-07 才存在；本包只冻结权威与门禁规则 | WP-07（回归见 WP-10） |
| Attempt epoch 严格递增语义 | **UNVERIFIED（T-04）** | 需 Runner/Grant 侧统一定义 | WP-07 |
| `findingBlocksCompletion` 空 `uncovered` 的可处置性（T-02） | **观察** | 自相矛盾记录的低频边界 | 可在 WP-08 一并整理 |
| 真实模型驱动的自然语言分级（一字符改动的语义识别由模型 Assessment 给出，本包只验证给定 `CodeSignals` 后的判定） | **UNVERIFIED** | WP-06 的失败测试按 `implementation.md` 以固定信号驱动 | WP-02（Assessment）/ WP-09 / WP-10 |
| `pnpm test:e2e` / `test:acceptance` / `test:live` | **未覆盖（按契约）** | 三者指向 `scripts/not-implemented.mjs`，分别标注 WP-09/WP-10；退出 1 为契约行为 | WP-09 / WP-10 |

剩余风险：T-01（`b0d226f` 无配套独立 Review）在 Settlement 前若既未补 Review 也未记录复用，将出现「未经 Review 的代码进入验收」的流程缺口；`b0d226f` 的行为已被本轮 762 条断言覆盖且未发现新增 P0/P1，因此该风险属**流程**而非行为。其余均为已登记、按包承接的功能边界；本轮未观察到回归（契约命令 6/6 退出 0、已提交 757 单测 / 132 集成全绿、自建 762 断言 0 失败）。

---

## 9. 结论

- 逐 AC：**AC-007、AC-008、AC-009、AC-010、AC-011、AC-012、AC-013、AC-014、AC-015、AC-016、AC-017、AC-018、AC-019、AC-020、AC-021、AC-022、AC-083、AC-089 全部通过**（其中 AC-011 的真实迁移/演练输出、AC-022 的完成期预算复核、AC-010/AC-012/AC-007 的 `CompletionManifest` 覆盖度与清单写入方标注 UNVERIFIED，承接 WP-08/WP-10，并已在 AC 行内说明）。
- 五项必需失败测试 5/5 独立通过；契约命令 6/6 退出 0；`git status` 全程干净。
- 未发现 P0/P1；T-01 [P2] 为流程/追溯缺口（需 Settlement 前补独立 Review 或记录复用），T-02/T-03/T-04 [P3] 为非阻断观察；已登记残余逐项复现且不改变 AC 判定。
- **Test 判定：PASS —— 接受 WP-06 的 AC-007～AC-022、AC-083、AC-089。**
