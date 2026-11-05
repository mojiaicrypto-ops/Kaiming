# WP-12 T2 独立 Review（领域/持久化半）

- 评审范围：消息 → Chief 评估 Run → `assessment.submit`/`agent.dispatch` → Requirement/Work/Plan → 专业 queued Run → `stage.submit` → 看板。
- 评审方式：只读；未读 `T2-implementation.md` 与任何开发聊天。结论全部来自代码阅读 + 本次真实执行的命令 + 真实 SQLite/真实 Git 探针。
- 写权限文件：仅本文件。未执行 `git add/commit/stash`。
- 与被审对象的关系：独立会话，不同上下文。

## 结论：**FAIL**

存在 2 条 P1（其一直接违反 AC-007/AC-068 与 `PRODUCT.md`/`experience.md`；其二使 §6 明文要求的 `operationId` 重派去重完全未实现，可复现重复 Run 与重复 `stage.completed`）。另有 4 条 P2、6 条 P3。核心链路本身（消息→Chief Run→评估→派生授权→Requirement→专业 Run→阶段结果）在真实 SQLite + 真实 Git 上确实跑通，且 `assessAndDispatch` 的 savepoint 原子性在真实库上零残留。

---

## 1. 阻塞发现（P1）

### P1-1｜L1 交付评估会创建 `active` Requirement 并进入看板（违反 AC-007 / AC-068）

- 位置：`apps/daemon/src/control-handler.ts:221-226`

```ts
const needsRequirement =
  (payload.intent === 'delivery' || payload.intent === 'document') &&
  (payload.level === 'L1' || payload.level === 'L2' || payload.level === 'L3');
```

- 契约依据：
  - `docs/product/PRODUCT.md:37`「L2/L3 交付均关联 Requirement。**独立 L1 修改使用一个 Work 和一个 Task**」
  - `docs/product/PRODUCT.md:55` L1「无需表单、单独 Planning/Test 角色或**看板建单**」
  - `docs/product/experience.md:49`「直接协作和**独立 L1 仅在 Chief 和 Runs 显示**；升级 L2 时同一 Work 关联新 Requirement 并进入看板」
  - `docs/delivery/acceptance.md` AC-007「…直到 CAS 和 CompletionManifest 完成均无 Planning/Test Run 和**看板建单**」；AC-068「**L1 不自动入板**」
  - `docs/rules/workflow.md:§3` L1 路线为 `CompactPlan→Develop→ReviewCheck→Settle`，无 Product/Plan Gate
- 真实复现（探针，非测试替身）：真实 `openProject` + 真实 Git 仓库 + 真实 `createProjectExecution`，直接调用生产 handler `handler.assessmentSubmit`，payload 为 L1 交付：

```
L1 assessmentSubmit: {"saved":true,...,"level":"L1","intent":"delivery",
  "authorizationId":"01a09f6b-d491-...","requirementId":"01a09f6b-d494-...","workLevel":"L1","gate":"product"}
L1 requirement rows: [{"lifecycle":"active","phase":"plan","work_id":"01a09f6b-d47a-..."}]
L1 work level: L1
L1 board active column mentions the requirement: true
```

  即：一条 L1 消息产生 `requirement` 行（`lifecycle=active`、`phase=plan`）、写 Git 记录、看板出现卡片，且响应把 `gate` 报成 `product`。
- 值得注意的是 e2e 的 AC-068 证据（`.agentdev/work/WP-12/acceptance.md:311`）声称「L1 Work … excluded and never a card」，但该演练的 L1 Work 是**播种**而来（没有 Requirement 行），因此它掩盖了本条真实路径。
- 必需修复：把 `needsRequirement` 收紧到 L2/L3；L1 只有在**已存在** active Requirement 时才复用（现有 `ensureRequirement` 第一步已经复用既存 active/queued 记录，因此仅按 `levelRank(payload.level) >= 2` 收口即可同时满足 PRODUCT.md:37 的「已有 Requiremen 内的 L1 修改关联该需求」）。

### P1-2｜控制通道的 `operationId` 被接收但完全未去重 → 重复专业 Run、重复 `stage_result`/`stage.completed`

- 位置：
  - `packages/core/src/control-http.ts:67,73,79`（`ControlHandler` 三个方法都声明 `operationId?`）
  - `packages/core/src/control-http.ts:323-329 / 344-349 / 364-369`（把 `operationId` 传入 handler）
  - `apps/daemon/src/control-handler.ts:210 / 242 / 256`（三个实现都只取 `caller`/`workId`/`spec`/`result`，`operationId` 被丢弃，全仓无任何消费点）
- 契约依据：`docs/architecture/protocol.md:§6`「**所有调用带 operationId 以便重派去重**」；§1/§7「应答丢失先查同幂等键结果」（`BUSY` 可退避重发同键）。
- 真实复现（同一进程内直接调用生产 handler，Run 处于 `running`，Attempt `owner_epoch=0`）：
  - 相同 spec 连做两次 `agent.dispatch`：

```
P5 duplicate agentDispatch -> TWO DISTINCT RUNS  run(role='backend') = 2
P4 duplicate agentDispatch -> TWO RUNS
```
  - 相同 result 连做两次 `stage.submit`（同一 `attemptId`，Run 仍 `running`）：

```
S3b first:  {"accepted":true,"stageResultId":"...1380","status":"success"}
S3b second: {"accepted":true,"stageResultId":"...3014","status":"success"}
S3b stage_result rows: 2   stage.completed events: 2
```
- 影响：模型重复调用 `agent_dispatch`/`stage_yield`（或 Runner/传输层按 §7 用同键重发）会**双派发专业 Run**、**双写阶段交付证据**并产生两条 `stage.completed`。`stage_result` 是 AC-017/AC-018 的证据载体，重复行会让后续返工/闭环判定读到两份来源。当前 `StageGate.submit` 只要求 `run.status === 'running'`（`packages/core/src/stage.ts:126`），无法挡住第二次提交。
- 必需修复：在 `control-handler` 或端点层按 `(attemptId, method, operationId)` 去重：同键+同 payload 返回首次结果；同键+异 payload 返回 `IDEMPOTENCY_CONFLICT`；缺键时至少用 Attempt 级「已提交」闸门拒绝同一 Attempt 的二次接受（`noteSubmitted` 已存在但只驱动两振规则，不做去重）。修复后需回归「重复 `stage.submit` 只落一行、只发一次 `stage.completed`」。

---

## 2. 非阻塞发现

### P2

- **P2-1｜`assessAndDispatch` 无生产调用方，真实路径不是原子的。**
  `grep -rn "assessAndDispatch" packages apps` 只命中 `packages/core/src/orchestrator.ts:589` 定义与 `packages/core/test/orchestrator.test.ts`。生产路径是两次独立 HTTP 调用：`apps/daemon/src/control-handler.ts:214`（`assessWithDerivation`，独立事务）+ `:249`（`dispatchProfessional`，独立事务）。因此 Chief 提交评估后、调用 `agent.dispatch` 前若进程/Run 终止，会**持久**留下 assessment + 派生 authorization + `work.level` + active Requirement 而没有 Run。宣称的「整条 `assessAndDispatch` 原子」只对该无调用方的方法成立。修复建议：把两个 handler 合并到 `assessAndDispatch`（同一事务），或在 `agent.dispatch` 缺失时让评估产物可回收。

- **P2-2｜无法入队 Chief Run 时消息永久停在 `received`，且无 `message.failed`。**
  `apps/daemon/src/protocol.ts:1743-1779`：`orchestrator.dispatch` 抛 `PROVIDER_UNAVAILABLE`（或 `budget` 缺失/耗尽）时 `queueChiefAssessment` 只 `logLine` 并 `return null`。
  真实复现（探针 S1，未配置 Provider、已接 orchestrator）：回复同步返回 `state:'received'`；`run` 表 0 行；事件仅 `conversation.created`、`message.received`；**没有** `message.failed`。这违反 `docs/product/experience.md:22`「处理失败显示 failed 并带重试入口」与 `protocol.md §7` 的 `message.failed` 持久事件。代码注释把 `blocked(provider)` 投影推给 WP-05（DC-42），故属已登记方向的缺口，但消息状态这一半应在本包收口（评估 Run 未入队即 `failed` + 带 operationId 的重试入口）。

- **P2-3｜全链不产生任何 `Task` 实体。**
  `grep -rn "tasks\.insert" packages/*/src apps/*/src` → 0 命中。`plan.approve` 派发的专业 Run 不带 `taskId`（`apps/daemon/src/protocol.ts:2601-2640`），`dispatch` 的 `requireTask` 因 `taskId` 可选而被跳过（`packages/core/src/orchestrator.ts:954`）。后果：`experience.md:49` 的卡片「已完成/总 Task 数」永远 0/0；AC-010 的阶段链没有 Task 行可断言；`rules/agents.md §3` 的 Task 绑定无法被验证。

- **P2-4｜集成测试头部宣称 spawn 真实 `apps/runner`，实际替换为桩入口。**
  `apps/daemon/test/assessment-dispatch.integration.test.ts:6-12` 写「real child-process spawn of `apps/runner`」，但 `:295-301` 传入 `AGENTDEV_RUNNER_ENTRY: runnerEntry`（测试自己生成的 `drill-runner.mjs`），`apps/daemon/src/runner-spawn.ts:167-179` 会优先取该环境变量。因此**发布的 Runner CLI 与工具桥**（`apps/runner/src/control-client.ts:201-330` 的 `assessment_submit`/`agent_dispatch`/`stage_yield`）完全未被该测试执行；探针脚本直接 POST `/control/*`。结论：端点链路被证明，Runner 工具层未被证明。建议把该断言改为如实描述，并另加一条真入口（不覆盖 `AGENTDEV_RUNNER_ENTRY`）的用例。

### P3

- **P3-1｜`markMessageSettled` 不幂等。** `apps/daemon/src/message-state.ts:43-61`：即使 `message.state` 已是目标态，仍无条件追加 `message.processed/failed`。探针：同一 Chief Run 连调两次 → `state='processed'` 但 `message.processed` 事件数 = 2。当前 `finishFromResult` 每 Attempt 只 `reportSettled` 一次（`packages/core/src/supervisor.ts:905,936`），故为潜伏缺陷；但 `reportSettled` 有两个调用点，重启/恢复路径增多后会暴露。建议按状态变化再发事件。
- **P3-2｜`plan.current.runId` 永远不会是刚派发的专业 Run。** `apps/daemon/src/protocol.ts:2371` + `planningRunIdOf`（`:2458-2465`）只返回产出 Plan 产物的 `planning` Run。T2-plan §T2.6 的退出条件「`plan.current.runId` 与之一致」未满足；`plan.approve` 新增的顶层 `runId` 是对的（`protocol.ts:2562`）。属计划与实现的表述偏差，建议在计划/文档里改成「`plan.approve.runId`」。
- **P3-3｜assessment 不回写 `work.intent`。** `applyAssessmentToWork`（`packages/core/src/orchestrator.ts:551-573`）只写 level/scope/authorizationRef。探针 S2：`work.intent='assist'` 而 assessment 为 `delivery`/L2。当前消费方（看板按 Requirement、`queueChiefAssessment` 只在发送时读 intent）影响有限。
- **P3-4｜Requirement 落库与 `phase='plan'` 更新不在同一事务。** `apps/daemon/src/control-handler.ts:174-199`（Git+DB 保存）与 `:205`（`store.requirements.update(..., {phase:'plan'})`）分离；两者之间崩溃会留下 `lifecycle=active` 且 `phase=NULL`（schema 默认值，`packages/storage/src/schema.ts:143`）。
- **P3-5｜超出父 Run 余量的派发会生成 0 预算 Run 而非拒绝。** `packages/core/src/orchestrator.ts:802-805` 夹取到 `min(requested, remaining)`。探针：Chief `budget_allocation=32000`，首次 over-request 10,000,000 → 32000；第二次 → **0**，Run 仍被创建为 `queued`（`budget_allocation=0`）。夹取本身符合声明，但生成注定失败的 Run 建议改为 `BUDGET_EXCEEDED`。
- **P3-6｜`operation.failed` 无任何发射点。** `grep -rn "operation\.failed" packages/*/src apps/*/src` → 0 命中，而 `protocol.md §7` 将其列为持久事件（§3 的 `project.clone` 会用到）。非本包引入，按既有遗留记录。
- **P3-7｜「approval pending」措辞与实现不符。** `plan.approve` 在无可用 Chief Run 时**已经**通过 Gate 批准（`apps/daemon/src/protocol.ts:2524-2545`），只是跳过派发并返回 `runId:null` + 日志（`:2579-2599`）；没有自动补派机制，运营方需再次 `plan.approve` 才可能拿到 Run。建议把宣称改成「批准生效、派发跳过（`runId=null`）」。

---

## 3. 已验证的声明（含真实输出）

所有命令均在仓库根、`export PATH="$HOME/.local/bin:$PATH"`、Node v24.8.0 / pnpm 12.3.4 下执行。

| 命令 | 退出码 | 真实结果（尾部） |
|---|---|---|
| `pnpm typecheck` | **0** | `tsc -p tsconfig.json --pretty false`（无输出） |
| `pnpm exec vitest run --project integration apps/daemon/test/assessment-dispatch.integration.test.ts` | **0** | `✓ 3 passed (3)`；`runs the whole path…` 3382ms / `refuses an out-of-envelope agent.dispatch with zero residue` 3382ms / `asks for one correction…` 750ms |
| `pnpm exec vitest run --project integration apps/daemon/test/provider-config.integration.test.ts apps/daemon/test/protocol.integration.test.ts` | **0** | `Test Files 2 passed`，`Tests 30 passed (30)` |
| `pnpm exec vitest run --project unit packages/core/test/orchestrator.test.ts packages/core/test/supervisor.test.ts packages/core/test/gates.test.ts` | **0** | `Test Files 3 passed`，`Tests 92 passed (92)`（注：`packages/core/test/stage.test.ts` 不存在，计划中承诺的该文件缺失） |
| `pnpm exec vitest run --project integration apps/daemon/test/runtime.integration.test.ts` | **0** | `Tests 6 passed (6)` |

另有 6 次自建探针（`node --input-type=module` + 源码直载 hook，真实 `openProject` / 真实 Git 仓库 / 真实 `createProjectExecution` / 真实 SQLite，全部用 `better-sqlite3` raw SQL 读回，不使用任何 test 播种 API）：

1. **`conversation.message.send` 在事务内建 Chief `queued` Run，无播种；无 Provider 时同步应答。**
   - 有 Provider：`runs after send = [{"role":"chief","status":"queued","parent_run_id":null,"budget_allocation":32000,"dispatch_snapshot_id":"89275a…(64 hex)"}]`；事件顺序 `conversation.created → message.received → run.queued`；`run.queued` 恰好 1 条。
   - 无 Provider：回复 `{"messageId":...,"workId":...,"state":"received","version":1}`，`run` 表 0 行，事件仅 `conversation.created`、`message.received`（见 P2-2）。
2. **幂等：同 conversation+body+key 重放返回原 messageId 且不产生第二个 Run；同键异 payload → `IDEMPOTENCY_CONFLICT`。** 探针输出 `idempotent replay same messageId: true`，`run` 计数不变。
3. **`assess()` 在一个事务内落 `work.level`/`scope`/`authorizationRef`。** 评估 L2 后 raw 读回：`work level L2`，`authorization_ref` 非空，`scope={"readPaths":["src"],"writePaths":["src/theme"],...}`；派生授权 `operations=["read","edit","write"]`（不含 `bash`），`source_ref.id` = 消息 id。
4. **`assessment.submit` 产出真实 Requirement（Git 记录 + `active`/`plan` 投影）。** `requirement` 行 `lifecycle=active, phase=plan, work_id=<work>`，`record_version=1`，`portable_ref.revision` 为 40-hex Git revision；事件 `requirement.imported` + `requirement.saved`。（L1 也错误地产生了同样的行 → P1-1。）
5. **`agent.dispatch` 产生的专业 Run 是**调用方 Chief Run**的直接子级，且预算夹取到父 Run 余量。** 探针：`chief.id === professional.parent_run_id → true`（S3 明确对比）；over-request 10,000,000 两次 → `budget_allocation = 32000` 然后 `0`。`profileRevision` 由 Core 注入：集成测试断言 `frozen.payload['profileRevision'] === config.resolve('backend').resolution.revision`（该用例通过）。
6. **`assessAndDispatch` 的嵌套事务确为 savepoint，失败零残留（真实磁盘/DB）。** 失败前 `{assessment:0, authorization:0, run:1, snapshot:3, work.level:'none'}`，`assessWithin` 成功后 `dispatch` 抛错，失败后**完全相同**（撤销了内层已写的 assessment + authorization）。成功路径 `{assessment:1, authorization:1, run:2, work.level:'L2'}`。
7. **`stage.submit` 经 `StageGate` 落 `stage_result` + `stage.completed`。** 探针与集成测试均通过；但重复提交会重复落库（P1-2）。
8. **`onAttemptResult` 一次纠正后记 `contract_violation`。** 集成测试 `silent` 用例通过：Chief Run 终态 `contract_violation`，消息 `failed`，无专业 Run，日志出现 `delivered no structured result; corrective prompt sent`，`run.ended` ≥1。
9. **`plan.approve` 建专业 queued Run 并返回 `runId`；无可用 Chief Run 时 `runId=null` 且批准已生效。** `provider-config.integration.test.ts` 两个用例通过（`creates a real queued professional Run as a direct child of the Chief Run` / `keeps the approval when no Chief Run exists to parent the Run`）。**注意**：该测试用 `store.works.insert`/`store.runs.insert`/`store.authorizations.insert` 直接播种（`:252-318`），不是无播种证明。
10. **事件在单次正常路径上恰好一次、且 `entityId`/`entityVersion` 取写后实体。** 探针 S2 事件序列 `conversation.created, message.received, run.queued, assessment.saved, run.queued, assessment.saved, requirement.imported, requirement.saved`；集成测试断言 `run.queued`（Chief、专业各 1）、`stage.completed` 1、`message.processed` 1。

---

## 4. AC 映射核查（应重点质疑「已映射」的说法）

- **该集成测试对 AC 证据库的贡献为零。** `grep -c "assessment-dispatch" .agentdev/work/WP-12/acceptance.md` = **0**，`e2e.md` = **0**。测试文件内不含任何 `AC-NNN`，`scripts/lib/acceptance-registry.mjs` 的 `CURATED_EVIDENCE` 也无该文件条目。因此「`assessment-dispatch.integration` 覆盖 AC-003/006/007/010/013/014/017/018/030/033/057/060/068/069/079/082/088/089」在验收报告层面**不成立**。
- 逐条对照 AC 文本后的实际覆盖：
  - 仅部分触及：**AC-069**（消息 `processing→processed/failed` 真实、Chief 路由）；**AC-068** 仅「看板包含 requirement」这一句，且其 L1 条款被 P1-1 **反证**；**AC-030** 仅 `profileRevision` 冻结被断言，未断言 `ContextSelection` 忠实性。
  - 该文件**完全未执行**：AC-003（测试派发的是 `purpose:'implementation'`，非 AC 要求的 analysis/artifact）、AC-006（单消息→多 Work 未测）、AC-007（L1 链未测）、AC-010（无 Plan/Review/Test/Settlement 阶段链）、AC-013（无未批准 Plan 的写拒绝与 Hash 不变）、AC-014（未调用 `plan.approve` 的自动批准）、AC-017/AC-018（Finding 闭环未测）、AC-033（独立审核容器/ACL 未测）、AC-057（超 lease/restart 未测）、AC-060（增量订阅未测）、AC-079（初始阶段上下文未测）、AC-082（重启后窄权限未测）、AC-088/AC-089（Git 导入/继续未测）。
- 补充：e2e 的 `[AC-069] chief.routes-message`（`scripts/e2e.mjs:597-646`）只断言 Work 上存在一条 `intent=delivery, level=L2` 且带 `authorizationRef` 的 assessment，而**旧本地路由 `sendMessage` 对带路径消息本来就会写这条 assessment + authorization**（`packages/core/src/messages.ts:180-223`）。因此该 e2e 证据无法证明「Chief Run 真的产生评估」。AC-069 的权威证据目前只有新集成测试，而它不进证据库 —— 建议补 CURATED_EVIDENCE 条目（或给用例加 AC 名）。
- 计划承诺的 T2.7「e2e 新增检查：消息→Chief→Plan→Run→终态，全程不调用 `seedWork`」未见实现：`grep -rn "assessment.submit\|agent.dispatch" scripts/` 无命中；`scripts/lib/live-drills.mjs:354` 仍是 `store.assessments.insert`（播种）。

---

## 5. 未验证 / 不确定

- **daemon 重启**（Chief Run 已 queued、评估未回）：只做了代码核查 —— `RunnerSupervisor.queued()` 覆盖 `status IN ('queued','running')` 且无活跃 Attempt 的 Run（`packages/core/src/supervisor.ts:631-639`），`start()` 先 `recoverAfterRestart`（`:327-329`）。**未**执行真实「起栈→杀进程→重启→评估回传」演练（需真实桩 Runner 与可注入停机点）。
- **Runner 在评估中途死亡**（`interrupted`/`recovery_required` 与 lease/心跳）：未重跑 WP-11 的恢复演练；仅确认新钩子 `onAttemptStarted`/`onRunSettled` 都被 try/catch 包裹（`supervisor.ts:939-947,955-964`），不会改变 park/settle 语义。推论：该场景消息会停在 `processing`（Run 非终态），与 reliability 的「需恢复决定」一致，但未实测。
- **两条消息真正并发**（HTTP 层）：未做竞态实测。可依赖的事实是 `withTransaction` 用 `BEGIN IMMEDIATE`（`packages/storage/src/sqlite.ts:54-65`）、预算预留与 Run 行在同一事务（`orchestrator.ts:1022-1043`），且 Node 单线程同步执行命令；`queueChiefAssessment` 在事务外读 `budget` 后由 `dispatch` 内再校验。
- **`pnpm test:e2e` / `pnpm test:live`**：本次未执行（e2e 属真实演练且 `scripts/**` 正被另一 agent 并发编辑；live 需 `AGENTDEV_PROVIDER_*`，WP-12 acceptance 记录仍为 UNVERIFIED）。因此本节所有 e2e 相关结论只来自阅读代码与 `.agentdev/work/WP-12/acceptance.md` 的既有记录，未复现。
- **端口卫生**：执行期间观察到 `127.0.0.1:4318/4317` 有非本次会话的 daemon 监听（先 PID 51501、后 PID 60539）。本次所有探针/测试均使用 `port 0`（`packages/core/src/control-http.ts:395`，`execution.ts` 默认不传 port），未受影响；无法复现的 flake 不予归因。
- **`packages/core/test/stage.test.ts`**：计划（T2-plan §5）承诺新增/扩充该文件，仓库中不存在；阶段结果的覆盖实际由集成测试与 `packages/core/test/orchestrator.test.ts` 承担。
