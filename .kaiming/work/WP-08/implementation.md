# WP-08 实现记录（集成、结算与恢复）

- planVersion: 1（`.agentdev/work/WP-08/plan.md`）
- 依赖：WP-04（`88a5690`）、WP-06（`b0d226f`）、WP-07（`96e196b`）；基线 WP-07 结算 `5683c77`
- 实现位置：`packages/workspace/src/{worktree,cas}.ts`、`packages/core/src/{requirement-save,recovery,settlement}.ts`

## T1 Git Worktree、CAS 与依赖血缘（AC-062/AC-081/AC-094）

- `packages/workspace/src/worktree.ts`：`WorktreeGitPort`（扩展既有 `GitPort`）+ `NodeWorktreeGitPort`（显式 argv、`shell:false`、真实 `git worktree add/remove/list`、`update-ref` 带 expected-old、`merge-base`/`is-ancestor`/`cherry`/`cherry-pick`/`ls-tree`/`cat-file`/`cat-file blob`）；`WorktreeLeaseStore`（Port + 内存实现，`worktreeLeaseResource(id)`）保证同一 worktree 只有一个 owner（外来/过期 owner 拒绝 `BUSY` 或按 TTL 替换）；**脏 worktree 拒绝删除**并列出路径，除非显式 `discard`。
- `packages/workspace/src/cas.ts`：依赖血缘（`orderTasks` 拓扑 + 环拒绝、`planDependencies`/`prepareDependencies` 计算 `dependencyRevision`/`dependencyManifestRefs`、`verifyTaskStart` 要求上游冻结成果且祖先变化即失效）、CAS 集成（`createCasService().integrate()`：比较期望 revision、安装调用方提供的候选提交（含需求池文件并按 metadata+content 成对校验）、`pending → pending(commit) → committed → completed` 日志、**只用 `update-ref <ref> <new> <old>` 移动 ref**、冲突返回 `VERSION_CONFLICT`/`STALE_ARTIFACT`/`IDEMPOTENCY_CONFLICT` 且分支不变、崩溃后复用提交且**只发一次完成事件**）、`runIntegration`（按依赖顺序 cherry 各 Task 自身提交、跳过已合并/已存在祖先、冲突时产出独立修复 Task + 冲突产物哈希且 HEAD 不动）。
- 回归网：`worktree.test.ts`（10 例）、`cas.integration.test.ts`（13 例 → T6 后 15 例，真实临时仓库）。

## T2 需求即时保存与投影一致性（AC-090/AC-091/AC-093）

- `packages/core/src/requirement-save.ts`：`ProjectIntegrationLock`（共享资源 `integration:<projectId>`，需求保存与代码交付同一把锁）；`prepareRequirementSave`（两文件共享版本、正文 `<!-- record-version: n -->`、六段标题校验、recordVersion 单调、组合 `recordHash`）；`readRequirementPoolAtRevision`/`requirementPoolReadme`（`RequirementPoolGitPort.readBlob` 为必需端口，池按修订的**提交字节**读取）；`RequirementSaveService.save/retry/pendingRepairs`（取锁 → 对**交付 ref 修订**的已提交 `recordHash` 比较期望 → detached worktree 构造提交 → 经 CAS 移动交付 ref → 刷新投影 → 才报告 `saved`；返回 branch/ref/commit/unpushed/upstreamRevision 与投影 verdict；失败返回 `requirement.save.retry`，已提交时重试**只补投影、不产生第二个提交**；任何读/解析失败都转成结构化结果，`save()` 不抛异常）；`checkCompletionSettlement`（metadata-only 变更不得冒充代码验证；空变更集与空修订范围同样拒绝，并回报 `codeStartRevision`）。
- 回归网：`requirement-save.test.ts`（19 例 → T6 后 22 例）、`requirement-save.integration.test.ts`（12 例 → T6 后 15 例，真实仓库 + 真实 SQLite）。

## T3 租约/epoch 恢复、结算与备份（AC-041/AC-057/AC-058/AC-061/AC-063/AC-064/AC-082）

- `packages/core/src/recovery.ts`：`RunRecoveryService`（**绝不按持久字段直接恢复**：检查真实进程身份与 tool operation 状态后置 `interrupted`（可恢复）或 `recovery_required`（存活/不可确认/未知副作用）；租约回收与 daemon epoch 围栏 `lastHostEpoch`；旧 epoch 结果按 epoch/取消/新决定拒绝并持久诊断 `stage.result_rejected`；**恢复判定 `newAttemptAllowed` 持久化在 `run.recovered` 事件中，并由 `newAttemptAdmission()` 作为开新 Attempt 的唯一准入规则**；`recoveryScope`/`verifyRecoveredScope` 只读冻结 DispatchSnapshot，重启后窄范围保持、Work 宽范围记为忽略）；备份/恢复/迁移（SQLite `VACUUM INTO` + 全 refs Git bundle + blobs/知识 + 哈希清单；restore 逐项校验哈希、重映射根、回收租约与授权、活动 Run 需恢复、缺 Secret 阻断 `PROVIDER_UNAVAILABLE`；`relocateProject` **先校验目标仓库、后改根、失败回滚**）。
- `packages/core/src/settlement.ts`：`buildKnowledgePatch`/`applyKnowledgePatch`（只经 `buildProjection` 应用，非法知识不发布、保留最后有效并标 stale）、`buildFinalManifest`/`freezeFinalManifest`/`readFrozenFinalManifest`、`SettlementService.prepareSettlement/settle/recover`（冻结 CompletionManifest、CAS 提交、**ref 后崩溃复用提交并只发一次 `settlement.completed`**；结果与事件/`stepResults` 用 `commitTree`（Git tree OID）与 `codeTreeHash`（SHA256 codeTree）两个字段区分语义；完成 Requirement 时同事务清 `phase`）。
- 回归网：`recovery.test.ts`（17 例 → T6 后 18 例）、`settlement.integration.test.ts`（10 例）、`backup.integration.test.ts`（5 例 → T6 后 6 例）。

## T4 端到端集成与必需失败测试

- `packages/core/test/wp08.integration.test.ts`（11 例 → T6 后 12 例）：单需求 L1 链到 CAS/CompletionManifest、L2 阶段链、document 路线（含无 taskId 的 Finding 绑定与独立 Review+Test 关闭）、初始化路线（中断按 Hash 续写、冲突不覆盖、Ready 最小门禁）、依赖 Task 链（依赖 revision 记录、祖先变化失效、最终集成跳过已合并祖先）、结算知识补丁 + 冷启动查询找到新事实、需求保存与交付共享锁（含 metadata-only 拒绝）、暂停/恢复与取消未知副作用、恢复判定后的 resume 拒绝（W8R1-04）、预算拒绝在集成后仍成立。
- `packages/core/test/wp08-failures.test.ts`（5 例）：**Task 合并冲突**、**CAS 失败**、**ref 后崩溃**、**取消未知副作用**、**备份演练**。
- 仅两处桩：无真实模型调用（Run 用冻结阶段记录）、无容器（恢复所需进程表用确定性探针）。

## T5 验证与本轮状态

- 契约命令（本记录时点）：`pnpm typecheck` 0；`pnpm lint` 0；`pnpm test:unit` **48 文件 / 967 用例**；`pnpm test:integration` **20 文件 / 208 用例**（真实临时 Git 仓库与真实 SQLite）；`pnpm build` **10 workspace**；`pnpm docs:check` ok。
- 本轮附带变更（必须登记）：`packages/core/package.json` 新增 `@agentdev/knowledge`、`@agentdev/workspace` 依赖与 `pnpm-lock.yaml` 对应 importer 记录（core 需导入 workspace 的 CAS/池接口方可构建）。
- 已登记残余（供 Review/Test 判定）：
  1. `WorktreeLeaseStore` 尚未落到 storage `lease` 表（Port 与内存实现在位；`worktreeLeaseResource(id)` 即 `lease.resource`）。
  2. `CasEventPort`/`CasJournal` 仅 Port：`operation` 行与域事件在 ProjectMailbox 事务内的接线属后续（集成测试用真实 SQLite journal 经 Port）。
  3. 冲突产物尚未持久化为 `artifact` 行、修复 Task 尚未派发（属接线）。
  4. 备份**只存 secret 标识**，不含加密导出；restore 无法解析即 `blocked`（`execution.md` §2 的单独加密导出需改 `secrets.ts`）。
  5. `apps/cli` 的 `backup/restore/relocate` 与 `apps/daemon` 启动时的 `recoverAfterRestart(hostEpoch)` 未接线（函数已导出）。
  6. 计划中的 `packages/workspace/src/backup.ts` 未落在 workspace 包，备份/恢复实现全部在 `core/recovery.ts`（纯搬移可后续重构）。
  7. 进程身份仅识别宿主数字 PID；容器/远端身份返回 `null` 并按「不可确认」fail-closed。
  8. ~~`SettlementService` 置 Requirement `lifecycle='completed'` 与 `finalManifestId`，但不清 `phase`（需 schema 所有者决定 raw UPDATE）。~~ **T6/W8R1-06 已收口**：完成时同事务写 `phase: undefined`（repository 落 SQL NULL），不再是残余。
  9. AC-054（BFF/浏览器断开继续）属 WP-09，本包未覆盖。

## T6 独立 Review 第一轮（W8R1-01..08）修复

- 修复范围：`packages/workspace/src/{worktree,cas}.ts`、`packages/core/src/{requirement-save,recovery,settlement}.ts` 及其测试。为让 W8R1-04 的恢复判定真正成为**执行侧准入**，另改同包内的 `packages/core/src/{run-lifecycle,findings}.ts`（`beginAttempt`/`resumeWork` 各加一道闸）；未触碰其他包。全部改动文件先经 `prettier --write`。
- 新增回归测试 11 例（unit 967 → **971**，integration 208 → **215**），每条 finding 至少一例，且都建立在旧行为的失败之上（见各条「旧行为」）。
- 记录更正（本轮，均已在正文同步）：
  - T1 的 CAS 描述由「候选提交（含需求池文件…）」更正为「**安装调用方提供的候选提交**」：服务内不再有任何 `git commit` 回退（W8R1-01），ref 仍只由 `update-ref <ref> <new> <old>` 移动。
  - 删除/更正了 `requirement-save.ts` 中「save path checks the committed bytes out first」「与 HEAD 目录比较」的失实注释（W8R1-02）；现为「按**交付 ref 修订**的提交字节（`git cat-file blob`）比较」。
  - `SettlementOutcome.tree` 的双语义更正为 `commitTree`（Git tree OID）与 `codeTreeHash`（SHA256 codeTree）两个字段，事件与 `stepResults` 同步区分（W8R1-08）；`SettleRequest.candidateTree` 的文档明确为 SHA256 codeTree。
  - T5 残余 8（结算不清 `phase`）已收口并标注（W8R1-06）。
  - **三处旧期望确实在编码缺陷，已更正（未放宽任何断言）**：① `requirement-save.integration.test.ts` 的 `checkCompletionSettlementForTest` 原先恒传 `codeStartRevision: null`（旧实现从不读它），② `wp08.integration.test.ts` 的 metadata-only 用例同样传 `null`；两者改为传真实 `baseRevision`/`seedRevision`，否则新契约下的空范围检查会（正确地）先拒绝。③ `cas.integration.test.ts` 的「refuses a stale writer…」原先不传 `candidateRevision`，只因旧代码在比较之后才走 `git commit` 回退而恰好拿到 `VERSION_CONFLICT`；现改为传一个真实的 stale 候选提交（同为 `revision` 基线的独立 worktree 提交），仍断言 `VERSION_CONFLICT` 且分支不动——现在它验证的是真正的陈旧写者路径。同文件「refuses a half requirement pair」补传一个有效候选，使拒绝原因确实是半对记录。settlement 测试原先断言的 `outcome.tree`/`recovered.tree` 改为新字段并断言二者互不相等。

### W8R1-01（P2）— 无候选版本时 CAS 用 `git commit` 直接推进交付分支

- 变更：`cas.ts` 删除 `candidateRevision === undefined` 的 `git.commitPaths` 回退；缺少候选版本直接 `VALIDATION_ERROR`（需求池仍做半对校验）。候选提交必须由集成 worktree/调用方先创建，ref 只由 `update-ref` 带 expected-old 移动。
- 回归测试：`cas.integration.test.ts`
  - 「never commits in the delivery working tree: a candidate revision is required (W8R1-01)」：工作树里已放好记录文件，竞争者在比较与写入之间移动 ref；断言 `VALIDATION_ERROR`、分支停在基线、无完成事件、提交数不变。
  - 「refuses a competing ref move between the compare and the swap (W8R1-01)」：带候选版本 + 注入竞争移动 → `VERSION_CONFLICT`、`actualRevision` 为竞争者提交、无完成事件。
- 旧行为：第一条会返回 `ok:true` 并在竞争者之上提交（`expectRefused` 即失败）。

### W8R1-02（P1）— 需求池读工作树而非目标修订

- 变更：`RequirementPoolGitPort.readBlob` 变为**必需**端口（`worktree.ts` 的 `WorktreeGitPort`/`NodeWorktreeGitPort` 新增 `readBlob`，`git cat-file blob`，缺失即 `null`，并把「按修订读取」写进接口契约）；`readBlobAt` 删除 `readFileSync` 回退；`readHead` 改为解析**交付 ref**（`refs/heads/<deliveryBranch>`）而不是 `HEAD`，比较与提交基线都取该修订。
- 回归测试：`requirement-save.integration.test.ts`「reads the pool at the delivery ref, never the stale working tree (W8R1-02)」：先正常保存 v1，另一服务器把 v2 提交并移动 ref 而不 checkout（工作树仍是 v1），带 `expected {recordVersion:1, recordHash:v1}` 的保存被 `REQUIREMENT_CONFLICT` 拒绝，分支与提交数不变，修订处仍是 v2。
- 旧行为：`readFileSync` 读到 v1 → 比较通过 → 用本地 v2 覆盖其他服务器的 v2 并返回 `ok:true`（`requireRefused` 失败）。

### W8R1-03（P1）— HEAD 独有记录导致未捕获 `ENOENT`

- 变更：`readBlobAt` 把读失败/缺 blob 转成结构化 `ProtocolError`（`INTERNAL_ERROR`/`REQUIREMENT_CONFLICT`，消息含 `revision:path`）；`RequirementSaveService.save()` 外层 try/catch 把任何逃逸错误转成 `RequirementSaveOutcome`，`save()` 不再抛异常（`ProtocolError` 保留原 code 与消息）；`compareExpectation` 的冲突消息补上记录路径。
- 回归测试：`requirement-save.integration.test.ts`
  - 「reports a HEAD-only record as a per-record conflict instead of an ENOENT (W8R1-03)」：ref 上有工作树没有的 `SECOND_ID`，`save()` 直接调用（不包 `expect`）返回 `REQUIREMENT_CONFLICT` 且消息含 `.agentdev/requirements/<id>`，分支不动。
  - 「returns a structured INTERNAL_ERROR when the committed blob cannot be read (W8R1-03)」：注入失败 `readBlob` → `INTERNAL_ERROR`、消息含 `读取 Git blob 失败` 与记录路径，分支不动。
- 旧行为：第一条抛 `ENOENT` 终止测试；第二条让 `ProtocolError` 逃出 `save()`（测试因未捕获异常失败）。

### W8R1-04（P1）— 恢复后仍可对确认存活的旧执行开新 Attempt（双写者）

- 变更：`recovery.ts` 新增导出 `newAttemptAdmission(store, runId)`：以持久化的 `run.recovered` 判定（`newAttemptAllowed`）为唯一准入规则，只有**判定之后**记录的 `decision(kind='recovery', choice='resume')` 才能解除阻断。`RunLifecycle.beginAttempt` 在任何 Attempt 写入前校验该判定（拒绝抛 `RECOVERY_REQUIRED`，带 `verdictEventId`/`requiresRecoveryDecision`）；`FindingService.resumeWork` 的 unresolved 检查扩展到「状态非终态且准入被拒」的所有 Run，返回结构化 `RECOVERY_REQUIRED`。确认进程已死（`park_interrupted` 且 `newAttemptAllowed:true`）时照常恢复。
- 回归测试：
  - `recovery.test.ts`「withholds a new Attempt while the old execution is unconfirmed (W8R1-04)」：`starting` + 存活进程 → park `interrupted` → `beginAttempt` 抛错、Attempt 仍 1 条、worktree 租约未落到第二个 owner；随后一条 `choice:'resume'` 的 recovery decision 才放行（Attempt #2）；确认已死的 Run 直接开 Attempt #2。
  - `wp08.integration.test.ts`「refuses to resume a Work whose Run was parked with an unconfirmed execution (W8R1-04)」：pause 持有该 `interrupted` Run 后，`resumeWork` 返回 `RECOVERY_REQUIRED` 且不新建 Attempt。
- 旧行为：`beginAttempt` 只查状态转换，`interrupted → starting` 合法 → 成功开出 Attempt #2（`toThrowError`/`expect(refused.ok).toBe(false)` 失败）。

### W8R1-05（P2）— `relocateProject` 先改根后体检、无回滚

- 变更：`relocateProject` 先读取**当前仓库记录**的 `refs/heads/<deliveryBranch>` 修订与 tree（改根前），再移动/解析目标；随后校验目标确为同一交付仓库（同一修订与 tree）且工作树干净，不通过即拒绝（`INVALID_STATE`，消息含「根映射未改写」），`move:true` 目标校验失败时把目录移回；通过后才改写 root 映射，此后的任何失败都在同一路径回滚映射。doctor 的 `expectedTree/treeMatches` 改用记录值而非目标自证。
- 回归测试：`backup.integration.test.ts`「refuses a relocate onto a directory that is not this repository, leaving the mapping (W8R1-05)」：restore 后对空目录 `move:false` relocate → 返回 `INVALID_STATE`，重开 store 断言 `root`/`gitRoot` 仍是原仓库；随后对同一仓库的 relocate 仍成功（证明闸门不是一律拒绝）。
- 旧行为：返回 `ok:true` 并把 Project 行改写到非仓库目录（`expect(refused.ok).toBe(false)` 失败）。

### W8R1-06（P3）— 结算完成后不清 `phase`

- 变更：`SettlementService.finish` 在同一事务内写 `phase: undefined`（repository 的 `toColumns` 将其落为 SQL NULL），`lifecycle='completed'` 与 `finalManifestId` 不变。
- 回归测试：`settlement.integration.test.ts` 直连 settle 与 ref 后 recover 两条路径都断言 `lifecycle==='completed'` 且 `phase` 为 `undefined`（fixture 原本 `phase:'settle'`）。
- 旧行为：`phase` 仍为 `'settle'`（`toBeUndefined()` 失败）。

### W8R1-07（P3）— 空变更集被当作代码验证；`codeStartRevision` 从不读取

- 变更：`checkCompletionSettlement` 先拒绝 `changedPaths` 为空（`GATE_NOT_READY`，消息含「变更集为空」），再要求 `codeStartRevision` 非空且不等于 `finalRevision`（否则 `codeStartRevision..finalRevision` 恒空）；成功结果新增 `codeStartRevision` 供审计。
- 回归测试：`requirement-save.test.ts`「refuses an empty change set as code verification (W8R1-07)」「refuses a revision range that starts at the final revision (W8R1-07)」「reports the range it verified on success (W8R1-07)」。
- 旧行为：空变更集返回 `ok:true, codeChanged:false`；`codeStartRevision` 完全未读（前两例失败）。

### W8R1-08（P3）— `SettlementOutcome.tree` 两条路径语义不同

- 变更：`SettlementOutcome`/`PreparedSettlement`/operation 状态与 `finish` 输入改用 `commitTree`（Git tree OID）与 `codeTreeHash`（SHA256 codeTree）；`prepareSettlement` 既持久化 SHA256（`stepResults.codeTree`）又计算并向 CAS 传递 Git tree OID（`stepResults.commitTree`，作为 CAS `candidateTree`）；`recover` 分别取值（缺 SHA256 时由 `deliveredCodeTreeHash` 或冻结 manifest 的 `verifiedCodeTree` 派生）；`settlement.completed` 事件与 `stepResults` 记录 `commitTree` + `codeTreeHash` 两个字段。
- 回归测试：`settlement.integration.test.ts` 直连 settle 与 recover 两路径都断言 `commitTree` 为 `git rev-parse <rev>^{tree}` 且 `codeTreeHash` 为 `deliveredCodeTreeHash(...)`、二者互不相等，事件与 operation 行同样带两个字段；`wp08-failures.test.ts` 的 ref 后崩溃用例同步断言 recover 的两个字段。
- 旧行为：不存在这两个字段（旧代码只有 `tree`，按路径承载不同值），断言与类型检查都会失败。

### 本轮验证（T6 时点，命令在仓库根顺序执行）

- `prettier --write`：上列全部改动文件（`All matched files use Prettier code style!` 由 `pnpm lint` 复核）。
- `pnpm typecheck`：退出码 0，无输出。
- `pnpm lint`：退出码 0（ESLint 无告警 + Prettier 检查通过）。
- `pnpm test:unit`：**48 文件 / 971 用例全部通过**（原 967，新增 4）。
- `pnpm test:integration`：**20 文件 / 215 用例全部通过**（原 208，新增 7；含真实临时 Git 仓库、真实 SQLite 与容器用例）。
- `pnpm build`：**10 workspace** 全部 `Done`。
- `pnpm docs:check`：ok（15 documents、55 internal links、94 acceptance cases、9 requirements、11 work packages）。
- 残余（本轮未收口，供新 Review/Test 判定）：`WorktreeLeaseStore` 仍未落 storage `lease` 表、CAS 事件/`operation` 行与 ProjectMailbox 的接线、冲突产物与修复 Task 派发、备份 secret 加密导出、`apps/cli`/`apps/daemon` 接线、`packages/workspace/src/backup.ts` 归位、进程身份仅宿主 PID（即 T5 残余 1–7、9 不变）。另有两项与本轮修复直接相关的已知边界：① 解除恢复阻断目前要求一条 `decision(kind='recovery', choice='resume')`（`resolveCancellation` 的 resume 分支），其 CLI/BFF 入口属接线范围（T5 残余 5）；② 因进程存活而 park 成 `interrupted` 的 Run **不会**被后续 `recoverAfterRestart` 重新核对（`interrupted` 不在 `RESUMABLE_STATUSES`，保持「已 park 者不重复处理」的既有不变量），因此「旧进程后来确认已死」这条路径也要靠同一 decision 显式放行，而非自动解封。

## T7 独立 Review 第二轮（W8R2-01..06）修复

- 修复范围：`packages/workspace/src/{worktree,cas}.ts`、`packages/core/src/{requirement-save,recovery,settlement}.ts` 及其测试（`worktree.test.ts`、`cas.integration.test.ts`、`recovery.test.ts`、`requirement-save.integration.test.ts`、`settlement.integration.test.ts`、`wp08.integration.test.ts`、`wp08-failures.test.ts`）。未触碰其他包；全部改动文件先经 `prettier --write`。
- 新增回归测试 **9 例**（unit 971 → **973**：`worktree.test.ts` +1、`recovery.test.ts` +1；integration 215 → **222**：`cas.integration.test.ts` +2、`requirement-save.integration.test.ts` +4、`settlement.integration.test.ts` +1；另改写 3 例既有测试，见「记录更正」）。每条 finding 至少一例，且每条都以**临时撤销对应修复后测试必失败**的方式反证过（见各条「旧行为」）。
- API 收紧的登记：`RunIntegrationOptions.lock` 由可选变为**必需**（`CasIntegrationLock` 结构端口，core 的 `ProjectIntegrationLock` 直接满足）；`runIntegration` 的既有调用点（workspace 与 core 测试）全部补传锁。`SettlementServiceOptions` 新增可选 `lock`/`leases`，未注入时按 `store.leases` 自建（同一 `integration:<projectId>` 资源）。

### W8R2-01（P1）— 崩溃重试复用陈旧 worktree，CAS 不校验候选基点，静默把交付分支回退

- 变更（a，CAS 基点校验）：`cas.ts` 在 compare 与 swap 之间新增 `git merge-base --is-ancestor <expectedRevision> <candidateRevision>` 校验；非后代返回 `STALE_ARTIFACT`（读取失败返回结构化 `INTERNAL_ERROR`），ref 不动、无完成事件。`update-ref` 的 expected-old 只证明「ref 没动」，不再被当作「候选建立在期望基线之上」。
- 变更（b，worktree 基点）：`requirement-save.ts` 的 `prepareWorktree` 对已存在的 save worktree 校验 `HEAD === baseRevision`，不等则 `git reset --hard <baseRevision>`（失败即结构化拒绝），并在 `finally` 走原有 cleanup；`keepWorktree` 默认值由 `true` 改为 **`false`**（残留 worktree 是崩溃残渣，不是复用材料，`RequirementSaveServiceOptions.keepWorktree` 与 `SaveRequirementInput.keepWorktree` 的注释同步更正）。
- 变更（c，`WorktreeManager.create`）：新增 `WorktreeGitPort.resetHard(worktreePath, revision)`（`NodeWorktreeGitPort` 实现 `git reset --hard` + `git clean -fd`；内存 fake 同步实现并记录 reset），复用的 worktree（内存记录与磁盘 `worktree list` 两条路径）只要停在别的基点就先复位，复位失败返回 `INVALID_STATE`。
- 回归测试：`cas.integration.test.ts`「refuses a candidate that is not a descendant of the expected revision (W8R2-01)」：期望 revision 为已集成提交、候选由旧基点提交 → `STALE_ARTIFACT`、分支仍是集成提交、提交数不变、无事件、`src/orders.ts` 内容未回退；`requirement-save.integration.test.ts`「never reuses a save worktree parked at another base (W8R2-01)」：手工留下停在基点的 save worktree，随后代码交付推进 ref，再用同 operationId 保存 → 成功且交付提交仍是祖先、交付代码仍在（旧行为：分支回退、`isAncestor` 断言失败）；`worktree.test.ts`「rewinds a re-used worktree that is parked at another base (W8R2-01)」：断言 `state.resets` 恰好复位到请求基点、worktree HEAD 回到基点。
- 旧行为：撤销（a）后第一条返回 `ok:true` 并把分支移回旧基点；撤销（b）后第二条 `isAncestor(delivered, saved.commit)` 为 false、交付代码被丢弃；撤销（c）后第三条 `reused:true` 但不发生 reset（`state.resets` 为空）。三条均在注入旧行为后实测失败。

### W8R2-02（P2）— 代码交付路径不取得共享集成锁

- 变更：`cas.ts` 新增 `CasIntegrationLock`（`resource`/`acquire`/`release`，`BUSY` 携带 `heldBy`）与 `createMemoryIntegrationLock`；`runIntegration` 在触碰任何 worktree 之前以 `ownerAttemptId ?? operationId`、`epoch ?? 1` 取得该锁，被持有即返回新的 `BUSY` 结果（`branchUntouched:true`），并在 `finally` 释放；任务回放体抽为 `integrateTasks`。`settlement.ts` 的 `SettlementService` 接受/自建 `ProjectIntegrationLock`，`settle`/`recover` 各自先取锁、`BUSY` 拒绝、`finally` 释放，内部 `settle → recover` 改走 `recoverUnderLock`（不重入取锁）。
- 回归测试：`requirement-save.integration.test.ts`「serializes a save and a delivery through the same integration lock (W8R2-02)」（改写）：持锁时保存 `BUSY`，**交付路径自身**也 `BUSY` 且分支停在基线，释放后同一交付成功（并断言交付已把锁还给保存）；`wp08.integration.test.ts`「serializes a requirement save and a code delivery through the shared lock (AC-091)」（改写）同样先 `BUSY` 后放行；`settlement.integration.test.ts`「takes the shared integration lock and refuses while a requirement save holds it (W8R2-02)」：持锁时 `settle` 返回 `BUSY`、ref 未动、无 `settlement.completed`，释放后同一次结算完成。
- 旧行为：撤销 `runIntegration` 的取锁后 `runIntegration` 在锁被持有时仍 `ok:true`；撤销 `settle` 的取锁后 `settle` 在锁被持有时仍完成。两处均实测失败。
- 记录更正：T2 所述的「需求保存与代码交付同一把锁」在本轮之前**只有保存一侧取锁**；现交付与结算入口都取同一资源。两例旧测试原先在持锁状态下断言交付照常集成（`wp08.integration.test.ts` 的用例是手工 `d.lock.acquire` + 交付放行；`requirement-save.integration.test.ts` 同形），该期望编码的正是本 finding 的缺陷，已改为断言 `BUSY` + 释放后放行，未放宽任何断言。

### W8R2-03（P2）— 新 Attempt 准入是 Work 级决策

- 变更：`recovery.ts` 的 `newAttemptAdmission` 在原有「`choice:'resume'` 且晚于本 Run 判定」之上，要求决策**绑定本 Run**：`decision.targetRef.id === runId` 或 `=== verdict.eventId`（持久化的 `run.recovered` 事件 id）。消息改为提示需要针对本 Run 的决策。
- 回归测试：`recovery.test.ts`「binds a resume decision to its own Run, not to the whole Work (W8R2-03)」：同一 Work 两个 Run 各自因活进程 park；写给 Run A 的 resume 决策只放行 A，`beginAttempt(Run B)` 仍抛 `RECOVERY_REQUIRED` 且 B 只有 1 条 Attempt；随后一条 `targetRef.id = B 的 verdictEventId` 的决策才放行 B。
- 旧行为：撤销绑定（谓词恒真）后 `beginAttempt(Run B)` 成功，`toThrowError` 断言失败（实测）。
- 记录更正：`recovery.test.ts` 的 W8R1-04 用例原先把 resume 决策写成 `targetRef.id = WORK_ID`（Work 级绑定），那正是本轮缺陷的编码；已改为 `targetRef.id = RUN_ID`。等价地，`cancelWork` 打开的 Work 级 recovery 决策不再顺带解除单个 Run 的阻断——按 W8R2-03 这是期望行为（详见残余）。

### W8R2-04（P3）— `integrate()` 在候选 tree 不可读时抛异常

- 变更：`cas.ts` 的候选 tree 读取改为结果判断：`git.mergeTree` 失败返回结构化 `INTERNAL_ERROR`（带 diagnostics），`value === null` 同样返回拒绝；不再有 `requireGit` 抛出路径。`settlement.ts` 的 `settle` 用 try/catch 包住 `cas.integrate`：若异常发生在 ref 已移动之后（journal 的 `targetRevision` 已是 ref 当前值）则走 `recoverUnderLock` 补齐状态，否则写 `failed` 并返回结构化 `INTERNAL_ERROR`，`SettlementOutcome` 联合始终成立。
- 回归测试：`cas.integration.test.ts`「returns a structured INTERNAL_ERROR when the candidate tree cannot be read (W8R2-04)」：注入 `mergeTree` 失败 → `integrate` 不抛异常、返回 `{ok:false, code:'INTERNAL_ERROR'}`、`branchUntouched:true`、ref 未动、无事件。
- 旧行为：还原为 `throw` 后该用例失败（实测）。

### W8R2-05（P2）— journal 已记 target、ref 尚未交换的崩溃窗口不可恢复

- 变更（CAS 侧）：`cas.ts` 对 journal 中 `targetRevision` 已存在但 ref 停在 `expectedRevision` 的 `pending` 记录，允许「同 operationId、同候选、同 expected-old」的调用**安装那条已记录的提交**（`installable`）；其他情形仍 `STALE_ARTIFACT`。swap 仍由 `update-ref` 带 expected-old 完成，竞争者会得到 `VERSION_CONFLICT`。
- 变更（save 侧）：`requirement-save.ts` 新增与 `settlement.recover` 对称的分支 `installJournaledCommit`：journal `state==='pending'` 且 `targetRevision` 已记录且 `HEAD === journal.expectedRevision` 时，用 journal 的候选经 CAS 安装（不新建提交）并补齐投影；同时用 journal `stepResults.requirementRecords` 的 `recordHash` 校验本次正文，不一致返回精确 `IDEMPOTENCY_CONFLICT`（消息含 operationId、recorded revision 与 recordHash），不再落到「无内容可提交」的 `INTERNAL_ERROR`。该分支位于 compareExpectation 之前：基线仍等于本操作起点，正文一致性由上面的 hash 校验保证。
- 回归测试：`requirement-save.integration.test.ts`
  - 「installs the journaled commit exactly once after a crash before the ref swap (W8R2-05)」：在 `updateRef` 注入失败（journal 已记 target、ref 未动）→ 同正文重试 `saved`、ref 恰为 journal 记录的提交、分支只多 1 个提交、`requirement.saved` 恰 1 条；再次重放为 `projection_repaired` 且提交/事件零新增。
  - 「reports a precise conflict when the retried body differs from the journaled commit (W8R2-05)」：改正文重试 → `IDEMPOTENCY_CONFLICT` 且消息含 recorded revision 与 recordHash、分支未动；随后用原正文重试仍成功（不是永久卡死）。
- 旧行为：撤销 save 分支与 CAS `installable` 后，第一条返回 `INTERNAL_ERROR`（提交失败），第二条落到 `IDEMPOTENCY_CONFLICT` 但 ref 永远停在基线；两例均实测失败。

### W8R2-06（P3）— 写回交付工作树无脏检查，静默覆盖未提交的本地修改

- 变更：`requirement-save.ts` 的 `refreshWorkingTree` 增加 `baselineRevision` 参数，写回前用 `dirtyDeliveryPaths` 判定目标路径（`requirement.json`、`content.md`、README）：先取 `statusPorcelain` 中 worktree 侧（第二列非空格、非 `??`）的改动，再逐路径比较磁盘字节与「本次将写入的字节」及「基线 revision 的 blob」——只有磁盘内容既不等于将要写入的字节、也不等于基线提交字节时才算脏（这样 ref 前移造成的第一列/`??` 陈旧索引不会被误判）。脏则抛 `DeliveryWorktreeDirtyError`，调用侧返回 `RECOVERY_REQUIRED`（`branchUntouched:false`、`repairOnly:true`、消息列出路径）、写 `requirement.save_worktree_overwrite_blocked` 诊断并把 operation 行置 `pending`；repair 路径若仍脏同样只报 `RECOVERY_REQUIRED`，不覆盖。
- 回归测试：`requirement-save.integration.test.ts`「refuses to overwrite uncommitted local edits in the delivery working tree (W8R2-06)」：v1 保存后手工改写 `content.md`，再以 v2 正文保存 → `RECOVERY_REQUIRED`、磁盘仍是本地编辑字节、Git 已提交 v2；把本地编辑还原为基线字节后 repair-only 重试 `projection_repaired` 且磁盘等于提交字节。
- 旧行为：撤销脏检查后磁盘被替换为 v2 正文且返回 `saved`（实测失败）。

### 记录更正（T7，均为编码缺陷的旧期望，未放宽断言）

1. `recovery.test.ts` W8R1-04 的 resume 决策 `targetRef.id` 由 `WORK_ID` 改为 `RUN_ID`（见 W8R2-03）。
2. `requirement-save.integration.test.ts`「serializes a save and a delivery through the same integration lock」原先断言「持锁时交付照常集成」，改为断言交付 `BUSY`（分支不动）与释放后放行（见 W8R2-02）。
3. `wp08.integration.test.ts`「serializes a requirement save and a code delivery through the shared lock (AC-091)」原先以手工 `d.lock.acquire` 制造持锁并断言交付成功，同样改为 `BUSY` + 释放后放行（见 W8R2-02）。
4. T2 的锁描述（保存与交付同一把锁）在交付/结算侧现已落地，不再只是需求。

### 本轮验证（T7 时点，命令在仓库根顺序执行）

- `prettier --write`：上列全部改动文件（`pnpm lint` 复核 `All matched files use Prettier code style!`）。
- `pnpm typecheck`：退出码 0，无输出。
- `pnpm lint`：退出码 0（ESLint 无告警 + Prettier 检查通过）。
- `pnpm test:unit`：**48 文件 / 973 用例全部通过**（T6 后 971，新增 2）。
- `pnpm test:integration`：**20 文件 / 222 用例全部通过**（T6 后 215，新增 7；另 3 例既有用例改写；含真实临时 Git 仓库、真实 SQLite 与容器用例）。
- `pnpm build`：**10 workspace** 全部 `Done`。
- `pnpm docs:check`：ok（15 documents、55 internal links、94 acceptance cases、9 requirements、11 work packages）。
- 反证复核：对 W8R2-01a/01b/02（交付与结算两侧）/03/04/05（两例）/06 逐项把对应修复临时还原为旧行为后重跑各自回归用例，**全部由通过转为失败**，随后还原并复跑全绿。
- 残余（本轮未收口）：T5 残余 1–7、9 与 T6 的两条边界不变；新增一条与本轮 W8R2-03 直接相关的边界——准入现要求 `decision.targetRef.id` 指向该 Run 或其 `run.recovered` 事件 id，而产品侧 `openRecoveryDecision` 仍写 Work 级 targetRef，因此「为某个确认存活的 Run 显式放行」需要一个 Run 级 recovery 决策入口（属 CLI/BFF 接线，同 T5 残余 5）。该边界是 W8R2-03 的预期收紧：Work 级决策不再能解除任何单个 Run 的活进程阻断。


## T8 独立 Review 第三轮（W8R3-01..06）与 Test 第二轮（T-01..T-05）修复

- 修复范围：`packages/workspace/src/cas.ts`、`packages/core/src/{requirement-save,recovery,settlement}.ts` 及其测试（`packages/workspace/test/cas.integration.test.ts`、`packages/core/test/{requirement-save.integration,recovery,wp08-failures,wp08.integration}.test.ts`）；`packages/core/test/wp08.integration.test.ts` 与既有 `runIntegration` 调用点仅补 `projectId`（API 收紧的机械适配）。未触碰其他包；全部改动文件先经 `prettier --write`。
- 新增回归测试 **13 例**（unit 973 → **975**：`recovery.test.ts` +1、`wp08-failures.test.ts` +1；integration 222 → **233**：`cas.integration.test.ts` +5、`requirement-save.integration.test.ts` +6）。每条 finding 至少一例，且逐条以「临时还原为旧行为 → 对应回归用例失败 → 还原后复跑全绿」反证（见文末反证清单）。

### T-01（P2）— 修复 Task 的重新集成回路不收敛

- 变更（替代/取代路径）：`cas.ts` 的 `IntegrationTask` 新增可选 `supersedes: readonly string[]`；`planIntegration` 先把所有被取代的 Task id 从计划中剔除，并让其 `dependsOn` 中「被取代」的条目由取代者满足（`orderTasks` 不再因缺依赖抛 `INVALID_STATE`）；`IntegrationPlan` 新增 `supersededTaskIds`，`AppliedIntegrationTask` 新增 `superseded`。`integrateTasks` 为被取代 Task 记 `superseded:true` 的 `applied` 条目并**从不回放**它们；`RunIntegrationResult` 成功分支新增 `supersededTaskIds`。新增导出 `repairIntegrationTask({repair, revision, dependencyRevision?})`：直接把冲突产物 `RepairPlan` 变成 `runIntegration` 可用的 `IntegrationTask`，其 revision 取代 `repairTask.dependsOn` 的两条路线。
- 语义约定（已写入 T8 与代码注释）：修复 revision 必须与冲突集成同一 `dependencyRevision` 为基点，且其自身 diff 即为冲突的解决；这正是 `createRepairTask` 冻结 `dependencyRevision` 的目的。
- 回归测试：
  - `packages/workspace/test/cas.integration.test.ts`「converges the conflict through the repair revision and emits one completion event (T-01)」：两冲突 Task → `TASK_MERGE_CONFLICT` + 修复 Task；随后仅传 `repairIntegrationTask` → `supersededTaskIds` 为两条路线、`appliedTaskIds` 为修复 Task id、最终 revision 含解决后的内容、恰 1 条完成事件、两条路线 revision 都不是最终 revision 的祖先。
  - `packages/core/test/wp08-failures.test.ts`「T-01: the repair revision converges and is what the final manifest records (AC-062)」：收敛后 `buildFinalManifest` 记录的 `finalRevision` 即修复后的 revision，且同一验证 Manifest 对修复前 revision 报 `STALE_ARTIFACT`。
- 旧行为：旧 `planIntegration` 忽略 `supersedes`，重新集成会重放两条路线并再次 `TASK_MERGE_CONFLICT`；只传修复 Task 则因缺依赖抛 `INVALID_STATE`。两例在旧行为下实测失败。

### T-02（P3）— `runIntegration` 不消费 `planIntegration` 的 `reason:'revision'`

- 变更：`integrateTasks` 在回放前检查 `plan.conflict`；`reason==='revision'`（冻结 revision 不在仓库）返回结构化 `GATE_NOT_READY` + `conflict`（含 `taskId`/`reason`），不再落成 `git cherry 失败` 的 `INTERNAL_ERROR`；`git` 冲突仍走修复 Task 形态。`RunIntegrationResult` 新增 `GATE_NOT_READY` 分支（`CasFailureCode` 保持不变，避免与 `CasOutcome` 失败联合重叠）。
- 回归测试：`cas.integration.test.ts`「reports a missing Task revision as a gate refusal instead of an internal error (T-02)」：断言 `code==='GATE_NOT_READY'`、`conflict.reason==='revision'`、`conflict.taskId`、`branchUntouched`、分支不动、零事件。
- 旧行为：返回 `INTERNAL_ERROR`（旧探针实测），用例失败。
- 说明（非残余，属刻意取舍）：缺失 revision 不是合并冲突，因此不伪造修复 Task——可处置的 Gate 失败更符合 `reliability.md` §4/§5 的分类要求。

### W8R3-01（P2）— `installJournaledCommit` 以记录路径为键，跳过不同记录的核对

- 变更：`journaledRecordHash` → `journaledRecord`（返回 `{recordPath, recordHash, version}`）；`installJournaledCommit` 现在要求 journal **恰含本次 `prepared.directoryPath` 且 hash 相等**，否则 `IDEMPOTENCY_CONFLICT`（消息同时点名「journal 未记录该路径」或「记录的是另一条记录」）。核对失败绝不再 `refreshWorkingTree`/`refreshProjection`。
- 回归测试：`requirement-save.integration.test.ts`「refuses a journaled install when the operation recorded another record (W8R3-01)」：`op-e3` 保存需求 A 时于 `updateRef` 崩溃（journal pending + target、ref 未动），随后同一 operationId 保存需求 B → `IDEMPOTENCY_CONFLICT`、分支停在基线、提交数不变、B 无投影、零 `requirement.saved`。
- 旧行为：路径不匹配时 `journaledHash===null` 跳过核对，安装 A 的提交并回报 B `saved`（旧探针 E3 实测），用例失败。

### W8R3-02（P2）— 非脏写回失败只记诊断但仍报 `saved`

- 变更：`requirement-save.ts` 新增 `worktreeRefreshRefusal`；`saveUnderLock` 与 `installJournaledCommit` 的「非 `DeliveryWorktreeDirtyError`」分支由「appendDiagnostic 后继续 finishSave」改为返回 **repair-only `RECOVERY_REQUIRED`**（operation 置 `projectionFailed`、写 `requirement.save_worktree_refresh_failed` 诊断、`branchUntouched:false`、`repairOnly:true`）。
- 回归测试：`requirement-save.integration.test.ts`「reports RECOVERY_REQUIRED when the working copy write-back really fails (W8R3-02)」：把 `content.md` 位置预建成目录（真实 `EISDIR`）→ `RECOVERY_REQUIRED` + `repairOnly` + `branchUntouched:false` + 消息含「写回失败」+ 投影未前移；删除目录后用同一 operationId 重试 → `projection_repaired` 且磁盘字节等于提交字节。
- 旧行为：返回 `ok:true, status:'saved'`（旧探针 H1 实测），用例失败。

### W8R3-03（P2）— 干净但停在另一修订的工作树被判成本地修改且不收敛

- 变更：`dirtyDeliveryPaths` 重写判定：①完全干净的工作树（`git status --porcelain` 为空）直接判定无本地修改；②可读目标的字节若等于「基线 blob」或「该机实际检出的已知 revision（工作树 HEAD / 本机投影 revision）的 blob」即为干净检出而非本地编辑；③只有 Git 的 worktree 侧（第二列）改动、或等于任何已知提交都解释不了的未跟踪内容，才算本地修改；④不可读路径（目录/权限）不在此处判脏，交由写入失败走 W8R3-02 的 `RECOVERY_REQUIRED`。`refreshWorkingTree` 新增 `targetRevision`/`branch` 入参，并在「完全干净且 HEAD ≠ 目标 revision」时调用新增的 `rewindCleanCheckout`（仅当工作树 detached 或就在交付分支上，绝不移动其他分支；`reset --hard` + `clean -fd`，干净态下无内容可丢）。
- 回归测试：`requirement-save.integration.test.ts`「rewinds a clean checkout parked at another revision instead of calling it dirty (W8R3-03)」：保存 v1、v2 后在交付工作树 `git checkout -f --detach <v1>`（porcelain 为空）再保存 v3 → `saved`、磁盘等于提交字节、工作树 HEAD 被复位到 v3，随后 v4 仍可保存（收敛）。
- 旧行为：字节判定把 v1 字节当本地修改，返回 `RECOVERY_REQUIRED`（旧探针 B3b 实测），用例失败。

### W8R3-04（P3）— 新 Attempt 准入只扫描最近 25 条决策

- 变更：`recovery.ts` 的 `newAttemptAdmission` 把 Run/判定绑定下推到查询：`json_extract(target_ref, '$.id') IN (runId, verdict.eventId)`，去掉固定 `limit:25`，仅在 SQL 结果上做「`choice==='resume'` 且晚于本 Run 判定」的存在性判断。
- 回归测试：`recovery.test.ts`「keeps a Run-bound resume decision past a window of unrelated decisions (W8R3-04)」：Run 因活进程 park 后写一条 Run 级 `resume` 决策（准入放行），再为同一 Work 写 30 条 Work 级恢复决策（时钟递增）→ 准入仍 `allowed:true` 且 `resolvedByDecisionId` 为原决策。
- 旧行为：有效决策被挤出 25 条窗口，准入翻回 `allowed:false`，用例失败。

### W8R3-05（P3）— 集成锁对「同 owner id + 同 epoch」可重入

- 变更：子系统前缀由服务侧强制拼接——`requirement-save.ts` 的 `save` 用 `save:<ownerAttemptId ?? operationId>`，`cas.ts` 的 `runIntegration` 用 `integrate:<ownerAttemptId ?? operationId>`，`settlement.ts` 的 `settle` 用 `settle:<ownerAttemptId ?? operationId>`（`recover` 原已用 `settle:<operationId>`）。即使调用方显式传入相同 raw id，保存/交付/结算也分属不同 owner，不再互相重入。
- 回归测试：`cas.integration.test.ts`「does not let a delivery re-enter a save owner that reuses the raw operation id (W8R3-05)」：以旧保存路径的 owner `op-shared` 持锁，再以 `operationId:'op-shared'` 交付 → `BUSY` 且 `heldBy.ownerAttemptId==='op-shared'`，分支不动。
- 旧行为：交付默认 owner 等于 operationId，与持锁 owner 相同 → 直接重入并交付（旧探针 C5 实测），用例失败。

### W8R3-06（P3）— 交付锁是注入式实例，可绕过共享互斥

- 变更：`RunIntegrationOptions` 新增**必填** `projectId`；新增导出 `integrationLockResourceName(projectId)`（`integration:<projectId>`，`createMemoryIntegrationLock` 同源）；`runIntegration` 在取锁前断言 `lock.resource === integrationLockResourceName(projectId)`，不等即结构化 `INVALID_STATE`（消息含期望资源名），分支不动、零事件。
- 回归测试：`cas.integration.test.ts`「refuses a lock that is not the Project shared integration lock (W8R3-06)」：传另一 Project 的内存锁 → `INVALID_STATE`、分支停在基线、零事件。
- 旧行为：任意 `CasIntegrationLock` 实例都被接受，交付在共享资源被他人持有时仍移动 ref（旧探针 C6 实测），用例失败。

### T-03（P3）— 需求池读取器没有逐条冲突通道

- 变更：`RequirementPoolAtRevision` 新增 `conflicts: readonly RequirementPoolConflict[]`（`missing-content` / `missing-metadata` / `hash-mismatch` / `invalid-metadata`）；`readRequirementPoolAtRevision` 对缺 `content.md` 的记录记冲突（不再静默 `continue`）、对只有 `content.md` 没有 `requirement.json` 的记录记冲突、对 `metadata.contentHash` 与正文哈希不一致记冲突、对无法解析的元数据记冲突（不再抛 `SyntaxError`）。`compareExpectation` 在保存路径把「本记录路径的逐条冲突」升级为 `REQUIREMENT_CONFLICT`（`explicitRepair` 仍显式放行）。
- 回归测试：`requirement-save.integration.test.ts`「reports a half pair as a per-record conflict instead of dropping it (T-03)」（读取器 `conflicts` 含 `missing-content` 与 `content.md` 路径，且 `save()` 返回 `REQUIREMENT_CONFLICT` 点名路径、分支不动）与「reports a metadata/body hash mismatch per record (T-03)」（`hash-mismatch`，记录仍可读但被标冲突）。
- 旧行为：半对记录被 `continue` 丢弃、`records.length===0` 且无任何诊断。
- 说明：冲突记录仍随 `records` 返回（`hash-mismatch`）以便调用方展示可读原文；半对/非法元数据因无法产出成对记录而只出现在 `conflicts`。

### T-04（P3）— CAS 半对检查只校验路径形状

- 变更：`createCasService().integrate()` 在候选存在性校验后，按 `requirementPool` 声明的每条记录核对 `candidateRevision` 的树**确实同时含 `requirement.json` 与 `content.md`**（`git.pathAtRevision`）；缺失即 `VALIDATION_ERROR` 并列出缺失路径，ref 不动、无完成事件。
- 回归测试：`cas.integration.test.ts`「refuses a candidate that declares content.md but does not commit it (T-04)」：候选提交只含 `requirement.json` → `VALIDATION_ERROR`（消息含 `content.md`）、分支停在基线、零事件。
- 旧行为：路径形状合法即 `ok:true` 并移动 ref（旧探针实测），用例失败。

### T-05（P3）— 陈旧投影保存给出误导性 dirty 诊断且分支领先工作树

- 变更：同 W8R3-03 的判定重写——磁盘字节等于「本机实际检出的已知 revision（工作树 HEAD / 本机投影 revision）」的 blob 时视为陈旧检出，不再判成本地修改；写回后工作副本与提交字节一致，分支不再领先。
- 回归测试：`requirement-save.integration.test.ts`「treats a ref that moved without a checkout as a stale projection, not local edits (T-05)」：另一服务器提交 v2 并移动 ref（不 checkout），本机 `explicitRepair:true` 保存 v3 → `saved`（非 `RECOVERY_REQUIRED`）、`previousCommit` 为对方提交、磁盘字节等于提交字节。
- 旧行为：返回 `RECOVERY_REQUIRED` 并把 `content.md`/`requirement.json`/`README.md` 说成「未提交的本地修改」（旧探针实测），用例失败。

### 本轮 API/契约收紧（必须登记）

- `RunIntegrationOptions.projectId` **必填**（W8R3-06）；`IntegrationTask.supersedes?`、`AppliedIntegrationTask.superseded?`、`IntegrationPlan.supersededTaskIds`、`RunIntegrationResult` 成功分支的 `supersededTaskIds` 与新增 `GATE_NOT_READY` 分支（T-01/T-02）；新增导出 `repairIntegrationTask`、`integrationLockResourceName`。
- `RequirementPoolAtRevision.conflicts` **必填**、新增导出 `RequirementPoolConflict`（T-03）。
- 服务侧锁 owner 前缀：`save:` / `integrate:` / `settle:`（W8R3-05）。

### 记录更正（T8）

- **无旧期望被更正**：既有 973 unit / 222 integration 用例的断言全部保留并通过。唯一的机械改动是给既有 `runIntegration` 调用点补上必填 `projectId`（`wp08.integration.test.ts` 4 处、`wp08-failures.test.ts` 2 处、`requirement-save.integration.test.ts` 3 处、`cas.integration.test.ts` 7 处），不涉及任何断言语义，因此不构成本轮缺陷的旧期望。

### 反证复核（逐条临时还原旧行为 → 回归用例失败）

对 11 条改动分别把实现临时还原为旧行为后重跑对应回归用例，**全部由通过转为失败**，随后还原并复跑全绿：W8R3-01、W8R3-02、W8R3-03、T-05、W8R3-04、W8R3-05、W8R3-06、T-02、T-04、T-01（workspace）、T-01（core manifest）。

### 本轮验证（T8 时点，命令在仓库根顺序执行）

- `prettier --write`：上列全部改动文件（`pnpm lint` 复核 `All matched files use Prettier code style!`）。
- `pnpm typecheck`：退出码 0，无输出。
- `pnpm lint`：退出码 0（ESLint 无告警 + Prettier 通过）。
- `pnpm test:unit`：**48 文件 / 975 用例全部通过**（T7 后 973，新增 2）。
- `pnpm test:integration`：**20 文件 / 233 用例全部通过**（T7 后 222，新增 11；含真实临时 Git 仓库、真实 SQLite 与容器用例）。
- `pnpm build`：**10 workspace** 全部 `Done`。
- `pnpm docs:check`：ok（15 documents、55 internal links、94 acceptance cases、9 requirements、11 work packages）。

### 残余（本轮未收口，明确登记）

1. T-01 要求「修复 revision 以冲突集成的冻结 `dependencyRevision` 为基点、其 diff 即冲突解决」这一调用约定，产品侧尚无自动派发/接线（`createRepairTask` 的 conflict artifact 落库与修复 Task 派发仍是 T5 残余 3）；本轮只保证该约定在服务 API 层可收敛并被回归网固定。
2. T-02 对「缺失冻结 revision」选择 Gate 失败而非创建修复 Task（刻意取舍，见上）。
3. W8R3-05 允许调用方**显式**传入跨子系统的相同 owner 字符串（例如同时传 `save:x` 与 `integrate:x` 之外的第三方前缀）；服务默认路径与显式同 raw id 的路径已不可能碰撞，但锁端口本身仍无 `purpose` 维度。
4. T-03 的逐条冲突目前由池读取器与保存路径消费；导入/Clone 路径（WP-04）是否展示该列表未在本包接线验证。
5. T-07 已登记的其余接线残余不变：`WorktreeLeaseStore` 未落 storage `lease` 表、CAS 事件/`operation` 行与 ProjectMailbox 的接线、备份 secret 加密导出、`apps/cli`/`apps/daemon` 接线、`packages/workspace/src/backup.ts` 归位、进程身份仅宿主 PID、Run 级 recovery 决策入口（`openRecoveryDecision` 仍写 Work 级 `targetRef`）。本轮 W8R3-04 只修正准入的**查询窗口**，不改变「需要 Run 级决策入口」这一既有残余。

## T9 独立 Test（第三轮，PASS）与残余登记

- 第四轮聚焦 Review 判 **PASS**（0×P0、0×P1、0×P2）：T-01..T-05 与 W8R3-01..06 共 11/11 独立复现为关闭；新增 2 条非阻断 P3（W8R4-01 `supersedes` 无输入校验、W8R4-02 被取代路线的第三方依赖被删除而非改指）。
- 第三轮独立 Test 判 **PASS**：18 个关联 AC 中 17 个接受（AC-054 属 WP-09，not_covered）；自建 11 组探针 **608 断言 0 失败**；五项必需失败测试独立复现（含 T-01 收敛）；六条契约命令退出 0（unit 48 文件/975、integration 20 文件/233、build 10 workspace、docs:check ok）。
- 本轮登记残余（供结算与后续工作包）：
  1. **W8R4-01 [P3]**：`supersedes` 缺输入校验（自取代被静默接受为 noop 且仍发完成事件；非请求内 id 生成 `revision:''` 的 applied 条目）——建议与「修复 Task 派发接线」一并补校验。
  2. **W8R4-02 [P3]**：被取代路线的第三方依赖被删除而非改指取代者，回放顺序退化为输入顺序（当前无生产调用点）。
  3. **Test T-01 [P3]**：每个回放 Task 在交付分支多落一个树相同的**空包装提交**（`cherry-pick` 已产生提交后又 `commitPaths([])`）；内容/祖先/Manifest 均正确，属交付历史质量问题。
  4. **观察**：`runIntegration` 同 operationId 重放返回 `IDEMPOTENCY_CONFLICT`（每次重新 cherry-pick 生成新候选），ref 不动、零新增事件，fail-closed；CAS 首次 swap 报 `reused:true` 与 `refUpdated:true` 自洽（语义为「本服务未创建提交」）。
  5. T5～T8 的接线残余不变：WorktreeLeaseStore 未落 `lease` 表、CAS 事件/operation 行接线、冲突产物与修复 Task 派发、Secret 加密导出、`apps/cli`/`apps/daemon` 接线、`packages/workspace/src/backup.ts` 位置、宿主 PID 身份、Run 级恢复决策入口（`openRecoveryDecision` 仍写 Work 级 `targetRef`）。
