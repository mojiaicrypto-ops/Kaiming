# WP-12 W5 实施记录：Test 阶段真实执行验收命令

状态：`Developing`（实现与自查证据已完成，交独立 Review/Test；未提交，无并发写者）
依据：`w4b-implementation.md` §9.8-2（"Test 阶段无法执行验收命令"）、`product-completion-plan.md` §1 判据④/⑤、`docs/rules/workflow.md` §3–§6、`docs/rules/agents.md` §1/§4、`docs/architecture/execution.md` §1/§2/§5/§7、`docs/architecture/reliability.md` §2/§5、`docs/architecture/protocol.md` §1（`ConfigPatch.testCommands`）、`docs/architecture/data.md` §3（`CheckResult`）。
授权来源：本轮任务书（用户对 W5 的范围、边界与验收方式的直接指令），改动范围即任务书 Scope。

---

## 0. 结论摘要

- `policy.testCommands` 从"文档化但没人用"变成 Test 阶段的**唯一**验收命令来源：写在项目配置里，进入 Test Run 的 prompt，由 Core 逐条在加固容器里执行。
- Test 角色的工具面**没有变化**（仍无 shell）：执行者是 Core（`Broker.runDeclaredTestCommand`），不是模型；模型只收到"声明了哪些命令"，收不到也不能自造 `checkResult`（Runner 的 `stage_yield` 根本没有该字段）。
- `Test` 阶段能否 `success` 由**真实退出码**决定：Core 用实际执行结果合成 `CheckResult` 并**替换**提交里的任何 `checkResult`；证据未就绪、`failed`/`blocked`/`not_covered` 时一律 `GATE_NOT_READY` 拒绝 `success`。
- 空默认是诚实的：没有 `testCommands` ⇒ `not_covered` + 拒绝 `success`（Test 只能交 `needs_input`/`failed`）。
- 真实 Provider 一句话 L2 全链在 Test 阶段留下真实执行证据（真实命令 + `exit=0` + 输出），3/3 到达 settlement；反证用一条故意失败的真实命令证明门禁拒绝 `success`。

---

## 1. 交付与判据

| 任务书判据 | 状态 | 证据 |
|---|---|---|
| ① `testCommands` 成为真实字段，Test Run 只收到声明的命令 | 完成 | `prepare-run.ts` `testCommandSentence()`；项目 scoped `config.update('project',{testCommands})` 已被真实演练使用 |
| ② 真实执行路径（容器内、经 Broker/出口、无宿主 shell、无新逃逸） | 完成 | `Broker.runDeclaredTestCommand()`（容器固定 + 声明集校验）；`broker.integration.test.ts` 真实容器 `exit 7` |
| ② `TestEnvironmentManager` 处理 | 说明不适用（§3.6），非绕过 | 本执行风格无宿主端口/DB 可认领 |
| ③ 成功由记录的证据决定，模型自称不能过闸 | 完成 | `StageGate.effectiveTestPayload()`；`test-evidence.test.ts` 6 例门禁正负例 |
| ④ 真实 Provider 正向演练 + 反证 + 保留非成功反证 | 完成 | §4/§5；`pnpm test:e2e` 27 checks 仍 PASS 26/FAIL 0/UNVERIFIED 1 |
| ⑤ 全门禁串行 | 完成 | §6 |

---

## 2. 变更清单（文件 → 改了什么）

**Core（`packages/core/src`）**

- `test-environment.ts`：新增"声明命令 → 已执行 `CheckResult`"一层。
  - `DeclaredCommandExecution`（命令、真实退出码、有界 stdout/stderr、signal、耗时、启动错误）。
  - `boundTestOutput()` / `TEST_OUTPUT_LIMIT_BYTES=8KiB`：输出**有界**入库。
  - `recordedExitCode()`：被信号杀死时按 shell 约定记 `128+signal`，`result` 里仍写真实 signal。
  - `buildTestCheckResult()`：状态**只**由退出码推导——全 0 `passed`，任一非 0 `failed`，无命令 `not_covered`（并列出未覆盖的 acceptanceId 与原因），从不"无命令即通过"。`result` 记录 `image=<执行镜像>`、`runner=<attempt.ready 报告的运行环境>`、退出码/耗时/输出。
  - `buildBlockedTestCheckResult()`：根本执行不了（无 Docker/无工作区/无冻结树）时 `blocked`，**不**编造带 `command` 的检查项（契约要求有 command 必有 exitCode）。
  - `TestEvidenceRegistry` / `TestEvidenceReader`：按 Attempt 记录 `pending` → Core 的真实 `CheckResult`，Attempt 结束时释放。
- `broker.ts`：
  - `BrokerOptions.declaredTestCommands?: () => readonly string[]`（项目配置的活读）。
  - `Broker.runDeclaredTestCommand()`：Test 阶段的**唯一**声明命令执行入口。四条硬约束：命令必须命中声明集（否则 `NOT_AUTHORIZED`）、role 必须是 `test`、模式**固定 container**（Docker 不可用即 `PROVIDER_UNAVAILABLE`，绝不回退宿主）、复用 `commandVector/containerPlan` 的既有边界（`--network none`、命名卷出口、只读挂载、加固参数、进程组注册）。每条命令落一条 `test.command_executed` 审计事件（命令/退出码/耗时）。
  - 新增 `execImageTag` getter（供证据记录真实执行镜像）。
- `stage.ts`：`StageGate` 新增可选 `testEvidence` 读口；`effectiveTestPayload()` 在 Test 角色提交时：证据未就绪 → `GATE_NOT_READY`（提示重试）；`success` 与证据不符 → `GATE_NOT_READY` 且回传真实命令与退出码；否则用 Core 证据**替换**载荷里的 `checkResult`。未接线该读口的栈（库级/演练自建 StageGate）行为不变。
- `execution.ts`：
  - `ProjectExecutionOptions` 新增 `artifacts?`（每条命令输出落一个 `evidence` Artifact）与 `workspace?`（冻结的每任务 worktree）。
  - 每栈一个 `TestEvidenceRegistry` 注入 `StageGate`；`onAttemptStarted` 在 Attempt **报告环境之后**（`attempt.ready`）后台启动 `executeTestEvidence()`；`onAttemptEnded` 释放证据。
  - `executeTestEvidence()`：读 `policy.testCommands`；无命令 → `not_covered`；缺工作区/Artifact/冻结树 → `blocked`；否则在该 Run 的 Task worktree 上逐条经 Broker 执行，取 Task 冻结 `VerificationManifest.codeTree` 作 `inputTree`、Attempt id 作 `environmentRef`，合成并记录 `CheckResult`。

**Daemon（`apps/daemon/src`）**

- `prepare-run.ts`：新增 `testCommandSentence()`，把声明命令写进 Test Attempt 的 prompt（空集时明确"不得报成功，交 needs_input 并说明未配置"）；Test 角色的 contract 句 = 角色契约 + 该句。
- `main.ts`：Broker 注入 `declaredTestCommands: () => project.config.project().policy.testCommands`；`createProjectExecution` 注入 `artifacts` 与**同一个** `taskWorkspace`（把原先内联的 `createTaskWorktreeWorkspaceResolver` 提到变量，避免同一 worktree 出现两个租约持有者）。

**脚本**：`scripts/lib/live-drills.mjs` 的 `runMessageToStageDrill`：项目 scope 配置一条真实验收命令；注入 `artifacts`/`workspace`/`broker.declaredTestCommands`；断言 Test 阶段 `checkResult.status==='passed'`、`command` 等于配置命令、`exitCode===0`、`outputRef` 是可读 Artifact、有对应的 `test.command_executed` 审计（exit 0）；证据串里打印完整 `checkResult`。

**文档**：`docs/architecture/execution.md` §5 增补 Test 执行实装口径与 `TestEnvironmentManager` 不适用的说明。

**测试**：`packages/core/test/test-evidence.test.ts`（新，12 例：证据合成 + 门禁正负例）、`packages/core/test/broker.integration.test.ts`（新增 1 例：真实容器执行声明命令 + 拒绝未声明命令 + 无声明集时拒绝 + 真实 `exit 7` → `failed` 证据 → 门禁拒绝 `success`）。

**未改动**：`packages/contracts/src/**`（`ConfigPatch.testCommands` 与 `CheckResult` 均已存在且够用）、`apps/runner/src/**`（Test 工具面不需要变化）、`test-environment.ts` 的 `TestEnvironmentManager` 本体（见 §3.6）、`integrate/settlement/task-candidate/egress.ts`、`apps/web/**`、`packages/workspace/**`。

---

## 3. Test Run 的验收证据如何产生、如何判定

### 3.1 命令来源

`protocol.md` §1 的 `ConfigPatch.testCommands` 就是项目配置字段；`config.update('project',{testCommands})` 早已可写，只是没人消费。本轮把它接到 Test 阶段：`main.ts` 把活读函数交给 Broker，`prepare-run.ts` 把它写进 prompt，`execution.ts` 用它执行。命令集是**人写的项目配置**，不是模型产出、不是 dispatch 内容。

### 3.2 执行路径（边界内、无新逃逸）

Core 在 Test Attempt `attempt.ready` 后调 `Broker.runDeclaredTestCommand()`：

1. 命令必须逐字命中 `declaredTestCommands()`，否则 `NOT_AUTHORIZED`（模型即使设法到达这条路径也跑不了别的程序）；
2. role 必须是 `test`；
3. 模式固定 `container`；Docker 不可用即 `PROVIDER_UNAVAILABLE`（"缺Docker即阻断独立验证"，不回退宿主）；
4. 复用既有容器计划：`--network none` + 命名卷出口（有活通道时挂，网络仍只经 Core 代理）、工作区只读挂载、`--cap-drop=ALL`/`no-new-privileges`/pids/内存/CPU 限制、进程组注册（取消/结束时整组回收）。

模型侧**没有**拿到 shell：`ROLE_BROKER_TOOLS.test` 未变，`planToolCall` 仍拒绝 test 的 `bash`，Runner 的 `stage_yield` 也不接受 `checkResult` 字段——所以"Test 自称成功"在本实现里连证据都提交不上来。

### 3.3 证据合成

每条命令的：`command`、真实 `exitCode`（被信号杀死按 `128+signal`）、有界 stdout/stderr、耗时；输出落一个 `evidence` Artifact（`outputRef`）；`inputTree` 取该 Task 冻结 `VerificationManifest.codeTree`（命令真正跑的那棵树）；`environmentRef` 取 Attempt id（`data.md` §3 要求 `ID`），真实执行镜像与 Runner 环境写在 `result` 的 `image=`/`runner=` 里。全部从真实进程结果推导，没有模型输入。

### 3.4 门禁判定

`StageGate.submit()` 对 `role==='test'` 且接线了读口的 Run：

- 证据还没算完 → `GATE_NOT_READY`（"仍在执行声明命令，稍后重试 stage_yield"），**不**落任何 stage_result；
- 证据非 `passed` 而载荷报 `success` → `GATE_NOT_READY`，错误文本带上真实命令与退出码（例：`... → exit 3`），模型可据此改交 `failed`/`needs_input`；
- 通过 → 用 Core 的 `CheckResult` 替换载荷里的 `checkResult` 落库（模型就算塞了一份也会被换掉）。

于是路线推进（`routeStageDelivered` 只看 `status==='success'`）与后续 Accept/Settle 都建立在真实证据上；没有命令就不可能以 `success` 越过 Test。

### 3.5 空默认

`testCommands` 为空 ⇒ 证据 `not_covered`（`uncovered` 写明"项目未配置验收命令"）⇒ `success` 被拒。prompt 同时告诉模型"不得报成功"，所以模型不会因为"没命令"而编造 exit code。这一条是本轮刻意改掉的旧行为（旧行为是模型自述即通过）。

### 3.6 `TestEnvironmentManager` 为何在本执行风格下不适用

该管理器提供的是**宿主侧**资源：OS 端口认领（含"就绪 socket 归属证明"）、attempt 命名的测试 DB、以及清理失败时的 `RECOVERY_REQUIRED`。本执行风格是"每条命令一个 `--network none` 容器"：容器不绑定宿主端口（`--network none` 下没有宿主端口可认领）、测试 DB 由项目自身在容器内管理，隔离边界就是容器本身，生命周期由 `--rm` 与 Broker 的 Attempt 进程注册表（取消/Attempt 结束杀整组）承担。因此它**不是被绕过，而是没有宿主侧资源可认领**；它仍适用于将来"先起长驻服务、再跑命令"的声明式风格——那需要先有文档化的"服务命令/就绪探针"字段，本轮没有该字段，故不发明。这一点已写入 `execution.md` §5。

---

## 4. 真实 Provider 演练证据（正向）

`node scripts/live.mjs --no-write`（真实 Provider，`drill.message-to-stage`）3 次均为 `7 passed / 0 failed / 0 unverified`，exit 0。链路与 Test 证据（`checkResult` 取自该 Test Run 的 `stage_result`）：

| 次 | 阶段结果 | Test 证据（Core 记录） |
|---|---|---|
| 1 | planning:success → develop(backend):success → review:success → **test:success** → settlement:success；Requirement completed | `{"status":"passed","checks":[{"command":"node --input-type=module -e \"const {cancel}=await import('./src/orders/cancel.ts');…\"","exitCode":0,"environmentRef":"<attempt-id>","inputTree":"<frozen codeTree>","outputRef":"<artifact-id>","result":"image=agentdev/exec:0.0.0 | runner=host:darwin/arm64/node-24 | exit=0 | 3517ms | stdout: cancel ok"}]}` |
| 2 | 同上（Test:success） | `… | exit=0 | 984ms | stdout: cancel ok` |
| 3 | 同上（Test:success） | `… | exit=0 | 2765ms | stdout: cancel ok` |

三次的执行耗时不同（3.5s / 1.0s / 2.8s）也说明证据来自真实容器执行而不是缓存或模型文本。`checkResult` 的完整 JSON 已由演练证据串打印（`node scripts/live.mjs` 输出中的 `Test evidence {...}`；本轮用 `--no-write` 运行，故未覆盖仓库里的 `live-results.json`/`live.md`）。

---

## 5. 反证

**(a) 故意失败的真实命令 → 门禁拒绝 `success`**（`packages/core/test/broker.integration.test.ts`，受控 fixture，Docker 可用时执行）：

- 声明集只有一条 `node -e "process.exit(7)"`；`Broker.runDeclaredTestCommand()` 在真实 `agentdev/exec:0.0.0` 容器里返回 `status=7`；
- 该结果合成 `CheckResult.status='failed'`、`checks[0].exitCode=7`；
- 把这份证据绑给 Test Attempt 后提交 `status:'success'` → `StageGate` 抛 `GATE_NOT_READY`（文本含 `exit 7`），且该 Run **没有**任何 `stage_result` 落库。
- 同一测试还证明：未声明的命令 `NOT_AUTHORIZED`；未接线 `declaredTestCommands` 的 Broker 直接拒绝（fail closed）。

**(b) 执行不了时模型也过不去**：本轮第一次 live 运行正是因为演练栈没接 `declaredTestCommands`，Test 阶段记录 `blocked` 并拒绝 `success`；真实模型如实交了 `needs_input`（"I cannot run the declared policy.testCommands acceptance command myself (no shell), and Core's attempt to execute it returned PROVIDER_UNAVAILABLE … I therefore report needs_input"）——这既证明门禁生效，也证明模型无法用文字换取 `success`。

**(c) 既有非成功反证仍然可用**：`pnpm test:e2e` 27 checks、`PASS 26 / FAIL 0 / UNVERIFIED 1`、exit 0；live 的 `awaitSuccessfulStage()` 对任何非 `success` 交付直接抛错（本轮 §5(b) 正是它判红的）。

---

## 6. 门禁（串行，收尾树）

| 命令 | 结果 |
|---|---|
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0（Prettier 全匹配） |
| `pnpm test:unit` | exit 0 — 79 文件 / 1479 用例（含本轮新增 12 例） |
| `pnpm test:integration` | exit 0 — 57 文件 / 541 用例（含本轮新增 1 例） |
| `pnpm test:e2e` | exit 0 — 27 checks，PASS 26 / FAIL 0 / UNVERIFIED 1 |
| `node scripts/live.mjs --no-write` ×3 | **exit 0 ×3，每次 7 passed / 0 failed / 0 unverified**（§4） |
| `node scripts/acceptance.mjs` | **exit 0 — `94/94 ACs accounted — PASS 94 / ACCEPTED 0 / FAIL 0 / MISSING 0`**；`acceptance: OK`；证据绑定 `sha256:596c717acb46…`（HEAD `02b89bf`，357 code files） |

`scripts/lib/drill-acs.mjs` 未改动（AC 映射与基线一致，仍 PASS 94）。代码树未提交（任务书禁止 commit），验收绑定的是含本轮改动的实际代码树。

---

## 7. 仍未关闭 / 环境受限

1. **`TestEnvironmentManager` 未接线**：理由见 §3.6；若后续要走"长驻服务 + 就绪探针"的声明式风格，需要先有文档化字段，再把它接上（届时端口认领/归属证明/`RECOVERY_REQUIRED` 才有对象）。
2. **`environmentRef` 口径不一致（登记）**：`data.md` §3 的 `checkResult.checks[].environmentRef` 是 `ID`（UUIDv7），而 Runner 的 `attempt.ready` 报的是描述串 `host:…`/`container:…`，`VerificationManifest.environmentRef` 也照抄该串。本轮 check 侧按契约记 Attempt id，把描述串与真实执行镜像写进 `result`。若要让两处严格同名，需要产品决定把 `checkResult.environmentRef` 放宽为字符串或把 Runner 改成同时报一个 id——本轮未改契约。
3. **`completionEvidence`/`completeWork` 仍不是生产结算路径**：生产 Accept/Settle 走 `settleFromIntegration`，只校验 Task/集成 `VerificationManifest`。因此本轮的门禁落在 `stage.submit`（Test 不可能以假证据成为 `success`，路线就不会推进）。若要让 `checkResult.status` 也进结算门禁，需要把 `completionEvidence` 接进 `settleFromIntegration`（涉及 `settlement.ts`，不在本轮 Scope）。
4. **重复阶段派发（`w4b-implementation.md` §9.8-1）仍是既有缺口**：本轮第一次（接线不全的）运行里可以看到同一阶段被多次排队（Test 出现 5 个 Run，其中 1 个 `contract_violation`）——那是 schema 拒绝重试叠加既有"Chief 与 Core 都推进路线"；接线修好后 3 次正式运行都是每阶段恰好一个 Run。该缺口需要产品决定"唯一调度者"，非本轮引入、未在本轮扩大。
5. **证据窗口**：`TestEvidenceRegistry` 是进程内内存。daemon 重启会丢证据，此时 Test 阶段只能 `not_covered`/`blocked` 并被拒（fail closed）；把证据持久化（例如落 snapshot/Artifact 再在门禁读回）是后续加固项。
6. **环境限制**：真实演练在 macOS 宿主 + 真实 Docker（`agentdev/exec:0.0.0`）下取证；容器内命令用 Node 24 的类型擦除直接跑 `.ts`（本机 `node v24.8.0`）。Linux 侧未在本轮复跑（同镜像同命令，无平台分支）。
