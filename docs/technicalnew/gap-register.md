# 下一轮开发计划与缺口登记

日期：2026-11-18（整理自首轮真实项目开发周期复盘）。本页是**下一轮开发路线图（P0 → P1 → P2）**、活动风险与历史缺口归档的唯一入口；实现证据见 [验证记录](validation.md)，产品验收标准见 [产品验收](../productnew/acceptance.md)。

维护规则：新增公开方法、删除界面入口、修正合同时同步本页；关闭一项时移入底部归档表并附提交或测试位置。

---

## 一 下一轮开发计划 P0 → P1 → P2

基于第一个完整项目周期的实战复盘与第一性原理评估，现阶段核心架构（SQLite WAL + Pi 1.0 SDK + 五核心工具 + 独立 Review/Test 证伪 + Git/交付绑定）已经成型，不再引入新角色或新状态枚举。下一轮优先级按**“砍掉运行期隐性协调税 → 硬化脏工作区交付隔离 → 解锁高杠杆算力与会话分支”**排列。

以下 6 个工作包均按**独立开发 AI 可直接照单编码**的颗粒度编写，包含精确代码位置、函数/接口签名、边界条件、验证档（Verification Profile）与负向控制（Negative Control）要求。

---

### P0：运行期减摩与提速（首选切入）

#### P0-1：专业成员派发信封与 `REPORT_MISSING` 同回合自愈（升级原 R6）

**状态**：已实施（2026-11-18）。实际签名 `buildDispatchEnvelope(task, member, facts)`（纯函数，调用方一次读 Plan、一次范围核对）；隐藏 turn 类型统一在 `model-output-guard.ts`。证据见[验证记录](validation.md#2026-11-18--p0-1-派发信封与同回合补交升级-r6)。

- **问题与根因**：
  1. `src/tools/delegation-tools.ts` 在 `dispatchOp` 中构造子 Session 输入时，只把 Chief 手写的 `instructions`（仅在 `review/test/settle` 阶段末尾拼一行 `scopeNoteFor`）放进 `inputPayload`。子 Agent 启动后必须先花 2～3 个模型回合调用 `task(op=get)` 和 `read` 去查 Task 目标、Plan 路径与验收标准。
  2. 若 Chief 在 `instructions` 中只描述报告形状（如“输出 N 行结论”）而漏写 `agent_report` 工具名，或模型把结论直接打成普通文本结束（suangua 现场占 Reviewer 的 16.5%），`src/runtime/runner.ts`（第 901～910 行）直接将输入标为 `failed / REPORT_MISSING`，迫使唤醒 Chief 再跨会话重派一轮。
- **修改文件与精确实现步骤**：
  1. **`kaiming/src/tools/delegation-tools.ts`（派发上下文信封组装）**：
     - 新增纯函数 `buildDispatchEnvelope(context: DispatchContext, task: TaskRow, member: { roleId: string; expectedKind: string; writeScope: readonly string[]; refs: readonly string[]; isContinuation: boolean }): string`。
     - **信封内容（英文，遵循 G4 系统注入语言门禁）**：
       - **Task 身份与目标**：`Task ${task.id} (${task.type}, workKind=${task.workKind}, phase=${task.phase}, role=${member.roleId}, expectedKind=${member.expectedKind})` + `Goal: ${task.goal}`。
       - **Plan 路径与验收/范围摘要**（当 `task.planRef !== null` 且为首次创建成员 `isContinuation === false` 时）：附上 `Plan path: ${task.planRef.path}`，并调用 `acceptanceText(plan.text)`（或截取 `## 验收` 节原文，上限 1,500 字符）和 `scopeCheckText(scopeCheckFor(context.cwd, plan.text))`；若 `member.writeScope.length > 0`，附上 `Assigned writeScope: ${member.writeScope.join(', ')}`；若 `member.refs.length > 0`，附上 `Cited refs: ${member.refs.join(', ')}`。
       - **上游有效报告摘要**（当 `task.phase` 为 `review` / `test` / `settle` 时）：从 `context.store.listTaskResults(task.id)` 提取当前最新一次 `implementation` / `review` / `test` 的 `resultId`、`verdict` 与 `bodyRef.path`，省去成员再调一次 `task(op=get)` 查报告路径。
       - **硬性收尾契约（所有新建与续办派发必带）**：
         `Host requirement — When your work for this input is complete (or blocked), you MUST call the agent_report tool (expected kind: "${member.expectedKind}"${member.expectedKind === 'review' || member.expectedKind === 'test' ? ', verdict: "passed" | "failed" | "blocked" required' : ''}). A prose-only reply without calling agent_report fails this input as REPORT_MISSING.`
     - **落点区分**：`task_sessions.instructions` 列仍然只存 Chief 传入的原始 `instructions`（保证 UI 任务详情与成员抽屉展示的指令干净、不被信封刷屏）；只有写入 `session_inputs.payload`（即发给 Pi 模型的 `inputPayload`）的文本使用 `withDispatchEnvelope(instructions, envelope)`。为此在 `src/store/store.ts` 的 `continueTaskSession`（第 3012～3043 行）及 `delegation-tools.ts` 的 `PlannedContinuation` 中增加可选 `inputPayload?: unknown`（与 `CreateTaskSessionParams` 一致，省略时回退为 `instructions`）。
  2. **`kaiming/src/runtime/runner.ts`（同回合隐藏补交 turn）**：
     - 新增常量 `export const REPORT_MISSING_RECOVERY_CUSTOM_TYPE = 'kaiming.report-missing-recovery';`，并在 `src/server/main.ts` 的 `onEvent` 中像过滤 `isHiddenModelOutputCorrectionEvent` 一样过滤该内部消息（不向浏览器渲染多余气泡）。
     - 在 `runner.ts` 的 `try` 块内（第 831 行 `await this.recoverModelOutput(...)` 之后、计算 `lastMessage` 与 `checkpoint` 之前），新增私有方法 `recoverMissingReport(handle, sessionId, guard, input.inputId)`：
       - **触发条件**：当前会话是 Task 专业成员（`member = store.getTaskSession(sessionId)` 存在且 `member.currentInputId === input.inputId`）、当前输入尚无报告（`store.resultsForInputs([input.inputId]).length === 0`）、没有收到停止请求（`live.stopRequestKey === null && !this.hostAborts.has(...)`）、`guard.fault === undefined`、且当前最后一条 assistant 消息正常停止（`stopReason !== 'error' && stopReason !== 'aborted'`）。
       - **执行动作**：等待 `await handle.session.waitForIdle()`，通过 `runWithWatchdog` 发送一次 `handle.session.sendCustomMessage({ customType: REPORT_MISSING_RECOVERY_CUSTOM_TYPE, content: [{ type: 'text', text: 'You ended your response without calling `agent_report`. Submit your formal `' + member.expectedKind + '` report now by calling `agent_report` with `summary` and `body` (and `verdict` for review/test) based on the work you already completed; do not redo the work.' }], display: false }, { triggerTurn: true })`。
       - 若该纠正 turn 中触发了 `modelGuard.fault`，继续调用一次 `await this.recoverModelOutput(...)`。
       - **兜底**：纠正 turn 结束后，后续原有的 `checkpoint` 计算与第 901 行 `reportMissing` 判定保持不变——如果补交成功，`resultsForInputs` 非空，该输入直接以 `completed` 终态落盘；如果模型在补交 turn 依然不调工具，则照常落 `failed / REPORT_MISSING`。
- **契约同步**：更新 `docs/technicalnew/agents-and-tools.md`（G2 `dispatch` / `agent_report`）与 `docs/technicalnew/runtime-contract.md`（R3）。
- **验证档与测试要求（`focused`）**：
  - `test/delegation.test.ts`：断言新建与续办成员时，`task_sessions.instructions` 保持原始文本，而 `session_inputs.payload` 包含目标、Plan 验收摘要与 `agent_report` 硬性尾注。
  - `test/runtime.test.ts`：
    1. **正向自愈**：stub 模型第一轮只输出纯文本 `"All checks passed"` 不调工具，收到隐藏提醒 turn 后第二轮调用 `agent_report` → 最终输入状态为 `completed`，`results` 含 1 条记录，浏览器事件流不出现内部提醒消息。
    2. **负向控制（Negative Control）**：stub 模型在第一轮和隐藏提醒 turn 都只输出纯文本不调 `agent_report` → 最终输入状态必须为 `failed` 且 `errorCode === 'REPORT_MISSING'`（证明自愈不会无限循环或把无报告伪装成通过）。

---

#### P0-2：结算报告（Settler）单写对齐

**状态**：已实施（2026-11-18）。按与用户确认的语义：磁盘文件非空即权威正文（`bodySource: 'disk'`，不报冲突、不改写），缺失/为空才要求参数 `body`（`bodySource: 'param'`）。证据见[验证记录](validation.md#2026-11-18--p0-2-结算单写对齐磁盘正文权威)。

- **问题与根因**：
  - 按 D-07 与 `prompts/settler.md`（第 38 行），Settler 必须先用 `write` 工具把完整报告写入 `.dev/work/<taskId>/<sessionId>/settlement.md` 并执行 `git commit`，随后调用 `agent_report(summary, body, ...)`。
  - `src/tools/report-tools.ts`（第 67、81、156～164 行）目前强制要求 `body` 为必填非空字符串，且当 `kind === 'settlement'` 且磁盘文件已存在时，若 `existing !== body`（哪怕差一个末尾换行或模型在参数里只写了简短说明）就拒绝并报 `VERSION_CONFLICT`。这迫使模型在 JSON 参数里把几千字的 Markdown 逐字再背诵一遍，极易导致 JSON 转义错误、16KB 超限拦截或参数退化（11-13 事故中 Settler 48 连败的直接诱因）。
- **修改文件与精确实现步骤**：
  1. **`kaiming/src/tools/report-tools.ts`**：
     - `parameters` schema 中：`required` 从 `['summary', 'body']` 改为 `['summary']`；`body` 的描述更新为：`'complete report text; required for all kinds except settlement when .dev/work/<taskId>/<sessionId>/settlement.md is already written on disk'`。
     - 执行逻辑调整（第 77～175 行）：
       - 先解析 `member`、`task` 与 `kind = member.expectedKind as ResultKind`。
       - 若 `kind === 'settlement'` 且 `task.type === 'write'`：
         - 先计算固定路径 `settlementPath = join(context.cwd, '.dev', 'work', task.id, context.sessionId, 'settlement.md')`，读取磁盘已有内容 `existingOnDisk = readFileIfPresent(settlementPath)`。
         - **情况 A（磁盘已有非空 `settlement.md`）**：直接采用 `effectiveBody = existingOnDisk` 作为权威报告正文（无论模型省略了 `body`、还是传入了摘要/略有不同的文本，均以磁盘已提交的 `settlement.md` 为准，**不再抛出 `VERSION_CONFLICT` 也不重写磁盘文件**）。
         - **情况 B（磁盘尚无 `settlement.md` 或文件为空）**：要求模型传入非空 `body`，并将其写入 `settlementPath`（保留回退路径）。
       - 若 `kind !== 'settlement'`（或 read Task）：保持 `body` 必须为非空字符串的校验不变。
       - 后续计算 `resultId`、`bodyRef` 与 `store.recordResult` 一律使用 `effectiveBody`。
  2. **`docs/technicalnew/prompts/settler.md` & `docs/technicalnew/agents-and-tools.md`**：
     - 更新 `settler.md` 第 38 行英文说明：写明先将完整结算正文写入 `.dev/work/<taskId>/<sessionId>/settlement.md` 并纳入 Git 提交，随后调用 `agent_report(summary, checks, settlement)` 时可省略 `body`（宿主直接读取已提交的 `settlement.md`，避免重复传输大段正文）。
     - 同步 `agents-and-tools.md` G2 `agent_report` 段落。
- **验证档与测试要求（`focused`）**：
  - `test/report.test.ts`：
    1. Settler 先在磁盘写入 `.dev/work/<taskId>/<sessionId>/settlement.md`，随后调用 `agent_report({ summary: 'settled', checks: [...] })`（省略 `body` 或传入简短文本）→ 成功记录 `settlement` 结果，`bodyRef` 的 `sha256` 与磁盘文件一致，磁盘文件字节未被改写。
    2. **负向控制（Negative Control）**：磁盘不存在 `settlement.md` 且 `agent_report` 省略 `body`（或非 `settlement` 角色省略 `body`）→ 必须返回 `isError: true` 且错误码为 `INVALID_ARGUMENT`。
  - 运行 `npm --prefix kaiming run check:prompts` 确认 `settler.md` 英文注入检查 15/15 通过。

---

#### P0-3：委派等待窗口调优与控制唤醒闭环（闭合 C8）

**状态**：已实施（2026-11-18），C8 关闭。三条 RPC 转换共用 `wakeSettledStep`；主管回合内的 control/recover 不再重复接线（结果必为 `chief-busy`）。证据见[验证记录](validation.md#2026-11-18--p0-3-委派等待窗口与唤醒闭环关闭-c8)。

- **问题与根因**：
  1. `src/tools/delegation-tools.ts`（第 58～60 行）中 `DEFAULT_WAIT_MS = 120_000`（2 分钟）、`MAX_WAIT_MS = 300_000`（5 分钟）。由于 C10 已在 `runner.ts` 中将 `settleStep` 期间标记为 `hostWaits`（不计入主管看门狗），2 分钟超时只会让主管在 10 分钟的开发/测试任务中白跑 5 次毫无意义的空名单 `task(op=dispatch)` 轮询回合。
  2. [gap-register.md](gap-register.md) 登记的 **C8**：`wakeForSettledStep` 目前只在 `main.ts` 的 `handleOutcome` 与启动扫描时调用；而① `task.control(resume)`（或主管调用 `controlOp` 恢复暂停的 Task）、② `session.input.stop` 停止了一条 `queued` 状态的成员输入、③ `session.recovery.resolve`（或 `task(op=recover)`）关闭了一条 `interrupted` 成员输入——这三条路径都不产生 run outcome，若此时当前步骤已全部停稳，主管不会被唤醒。
- **修改文件与精确实现步骤**：
  1. **`kaiming/src/tools/delegation-tools.ts`**：
     - 将 `DEFAULT_WAIT_MS` 从 `120_000` 调整为 `600_000`（10 分钟），`MAX_WAIT_MS` 从 `300_000` 调整为 `1_800_000`（30 分钟），`MIN_WAIT_MS` 保持 `1_000`（1 秒，保证单测传小值时毫秒级跑完）。
     - 同步 `docs/technicalnew/agents-and-tools.md` G2 `dispatch` 中 `waitTimeoutMs` 的说明（缺省 600 秒，按 1–1800 秒夹取）。
  2. **`kaiming/src/server/write-methods.ts`、`kaiming/src/server/main.ts`、`kaiming/src/tools/task-tools.ts`**：
     - 在 `WriteMethodsOptions` 中可选注入（或直接在 `write-methods.ts` 调用 `wakeForSettledStep(store, taskId)` 后调 `options.notify()`）：
       - **路径 1（`task.control` RPC 为 `resume`）**：在 `write-methods.ts` 第 246 行 `await options.controlTask(...)` 之后，若 `command === 'resume'`，调用 `wakeForSettledStep(store, taskId)`；若 `woken === true` 则 `options.invalidate?.(task.chiefSessionId, 'session', task.chiefSessionId)` 并 `options.notify()`。
       - **路径 2（`session.input.stop` RPC 停止 `queued` 输入）**：在 `write-methods.ts` 第 199 行 `store.requestStop(...)` 之后，若 `input.taskId !== null`，调用 `wakeForSettledStep(store, input.taskId)` 并在 `woken` 时 `options.notify()`。
       - **路径 3（`session.recovery.resolve` RPC 解决中断输入）**：在 `write-methods.ts` 第 368 行 `store.resolveInterruptedInput(...)` 之后，读取该 `input.taskId`（或 `store.getTaskForSession(sessionId)?.id`），非空时调用 `wakeForSettledStep(store, taskId)` 并在 `woken` 时 `options.notify()`。
     - 同样在 `runner.ts` 的 `controlTask`（第 980 行 `params.command === 'resume'` 分支）或 `task-tools.ts` 的 `controlOp`/`recoverOp` 中保持语义一致（若主管自己在回合内调用 `recoverOp`，主管自身处于 `processing`，`wakeForSettledStep` 会因 `chief-busy` 安全跳过，无副作用）。
- **验证档与测试要求（`focused`）**：
  - `test/step-wake.test.ts` & `test/server-write.test.ts`：
    1. Task 在 `paused` 期间成员均已结束（且主管已空闲）→ 调用 `task.control(command='resume')` 后自动生成 `notice-step-*` 并唤醒主管。
    2. 步骤中有 1 个成员已 `completed`、第 2 个成员处于 `queued`（且主管回合已超时结束）→ 调用 `session.input.stop` 停止第 2 个 `queued` 成员后，步骤变为全员停稳，自动投递 `notice-step-*`。
    3. 步骤中唯一未决成员处于 `interrupted`（主管已空闲）→ 调用 `session.recovery.resolve` 关闭该输入后，自动投递步骤停稳通知。
    4. **负向控制（Negative Control）**：当步骤仍有另一个 `processing`/`queued` 成员，或 Task 仍处于 `paused` 时，执行上述操作不得投递 `notice-step-*`（`woken: false`）。

---

### P1：脏工作区交付隔离（硬化多模块协作边界）

#### P1-1：Task 级交付基线（Baseline Dirty Isolation）

**状态**：已实施（2026-11-18）。基线按内容摘要（schema v20）排除创建前已脏且未变的文件；复核后变化要求在复核可覆盖的路径上重新复核；结算输出、`.dev/**` 与知识入口永不触发重审。证据见[验证记录](validation.md#2026-11-18--p1-1-task-级脏基线脏工作区交付隔离)。

- **问题与根因**：
  - 产品规范（D-07 与 `AGENTS.md`）明确规定：“无关脏文件被保留且不阻塞完成”。
  - 但在当前代码中：
    1. `src/runtime/plan-contract.ts` 的 `scopeCheckFor` 调用 `changedProjectPaths(cwd)` 获取整个 Git 工作区的全部 dirty 文件；若工作区在 Task 创建前就有未提交的无关文件 `src/unrelated.ts`，它会被一直列在 `outOfScope` 越界清单里。
    2. `src/tools/report-tools.ts` 的 `observeDelivery` 调用 `snapshotDelivery(cwd, knowledge)` 扫描整个项目所有非 ignored 文件；`src/tools/completion-git.ts` 的 `deliveryCommitGaps` 对这些路径执行 `observeCommit(cwd, paths)`。结果：只要工作区里有任何一个 Task 启动前就处于 dirty 状态的已跟踪/未跟踪源码文件，`task(op=end)` 就会报 `the reviewed delivery is not committed` 并拒绝收口，逼着 Settler 要么把用户的无关脏文件顺带 commit 掉，要么卡死！
- **修改文件与精确实现步骤**：
  1. **定义工作区脏基线快照（`kaiming/src/runtime/deliverable.ts`）**：
     - 新增类型与函数：
       ```ts
       /** Map of project-relative POSIX path -> sha256 file hash at the moment the Task was created. */
       export type DirtyBaseline = Readonly<Record<string, string>>;
       ```
     - 新增 `captureDirtyBaseline(cwd: string): DirtyBaseline`：
       - 调用 `changedProjectPaths(cwd)` 拿到当前 Git 工作区所有 dirty（staged / unstaged / untracked 且非 ignored）的项目相对路径；
       - 对每个路径计算当前磁盘文件内容哈希 `hashFile(join(cwd, path))`（若文件被删除则为 `'missing'`），返回 `{ [path]: hash }`。无 Git 仓库时返回 `{}`。
     - 新增判定辅助函数 `isUnchangedBaselineDirty(cwd: string, path: string, baseline: DirtyBaseline | null | undefined): boolean`：
       - 当 `baseline != null && Object.hasOwn(baseline, path)` 且当前 `hashFile(join(cwd, path)) === baseline[path]` 时返回 `true`（说明该文件在 Task 创建前就是脏的，且在本 Task 期间**一个字节都没被碰过**）；
       - 一旦本 Task 的 Developer 修改或暂存改变了该文件的内容（当前哈希 !== 基线哈希），返回 `false`，它立即进入本 Task 的真实改动与交付绑定范围！
  2. **持久化 Task 基线（`kaiming/src/store/store.ts`）**：
     - Schema 迁移 `v19 → v20`：`ALTER TABLE tasks ADD COLUMN dirtyBaseline TEXT;`（nullable JSON 字符串，旧行默认 `NULL`）。
     - `TaskRow` 与 `CreateTaskParams` 增加可选字段 `dirtyBaseline?: DirtyBaseline | null`。
  3. **在创建写 Task 时记录基线并在三处过滤无关脏文件**：
     - **`src/tools/task-tools.ts`（`createOp`）**：当 `type === 'write'` 时，在 `store.createTask` 前调用 `captureDirtyBaseline(context.cwd)` 传入 `dirtyBaseline`。
     - **过滤点 1 — 范围越界检查（`src/runtime/plan-contract.ts`）**：`scopeCheckFor(cwd, planMarkdown, baseline?: DirtyBaseline | null)` 在 `changedProjectPaths(cwd)` 结果中过滤掉满足 `isUnchangedBaselineDirty(cwd, path, baseline)` 的路径（同时排除若该路径被显式写在 Plan `范围` 内的情况：若 Plan 显式声明要改它，则不排除）。同步在 `src/tools/task-tools.ts`（`createOp`/`updateOp`/`getOp`）、`src/tools/delegation-tools.ts`（`scopeNoteFor`）以及 `src/server/read-methods.ts`（第 536 行 `task.get` RPC）传入 `task.dirtyBaseline`，确保模型与前端看到的 `scopeCheck` 完全一致。
     - **过滤点 2 — Review/Test 交付快照（`src/tools/report-tools.ts`）**：`observeDelivery` 读取 `task.dirtyBaseline`；在 `snapshotDelivery` 返回的 `paths` 中，排除满足 `isUnchangedBaselineDirty(context.cwd, path, task.dirtyBaseline)` 的路径并重算 `digestOfPaths`，使未触碰的无关脏文件不进入 `review.deliveryState.paths`。
     - **过滤点 3 — 完成提交门禁（`src/tools/completion-git.ts`）**：`deliveryCommitGaps(store, task)` 即使遇到旧 Review 记录，也排除满足 `isUnchangedBaselineDirty(cwd, path, task.dirtyBaseline)` 的路径。
- **契约同步**：更新 `docs/technicalnew/agents-and-tools.md`（G3）与 `docs/technicalnew/storage-and-recovery.md`（S2 `tasks` 表字段 v19→v20）。
- **验证档与测试要求（`broad` — 涉及 Store schema v20 迁移与 G3 交付绑定契约）**：
  - `test/store.test.ts`：验证 v19→v20 迁移保留既有数据且 `dirtyBaseline` 读写正常。
  - `test/git-commit-gate.test.ts` & `test/deliverable.test.ts`：
    1. **正向隔离**：在临时 Git 仓库中先修改 `src/unrelated.ts`（不提交），再创建 write Task 修改 `src/feature.ts` 并声明范围为 `` `src/feature.ts` `` → `scopeCheckFor` 的 `outOfScope` 为空（不含 `src/unrelated.ts`）；Review 通过后，仅 `git add src/feature.ts && git commit`（保留 `src/unrelated.ts` 未提交），调用 `task(op=end)` **成功通过**，且 `src/unrelated.ts` 改动完好保留。
    2. **负向控制（Negative Control）**：如果在 Task 期间 Developer 不仅改了 `src/feature.ts`，还继续修改了 `src/unrelated.ts`（使其内容哈希偏离 `dirtyBaseline`），则 `src/unrelated.ts` 必须出现在 `outOfScope` 中，且未提交 `src/unrelated.ts` 时 `task(op=end)` 必须拒绝并报 `COMPLETION_INCOMPLETE`。

---

### P2：高杠杆算力与会话体验（按需推进）

#### P2-1：订阅账号 OAuth 接入（Claude Pro/Max、ChatGPT Plus/Pro，原 S8）

- **背景与代码基础**：
  - Pi 1.0.0 `ModelRuntime` 已内置 OAuth 登录、自动刷新与 `<agentDir>/auth.json` 存储，且 `src/runtime/pi-runtime.ts` 第 106 行已将 `authPath: join(this.defaults.agentDir, 'auth.json')` 传给 `ModelRuntime.create`。
  - 当前阻碍：设置页与 `config.save`（`src/server/methods.ts`、`src/runtime/provider-store.ts`）只支持“填 `baseUrl + api + apiKey` 写 `models.json` 并存 `providers` 表”；`saveModelAssignment`（`methods.ts` 第 568 行）校验 `store.getProvider(providerId)` 必须存在于 `providers` 表中。
- **修改文件与精确实现步骤**：
  1. **`kaiming/src/runtime/pi-runtime.ts`（封装 SDK OAuth 能力）**：
     - 在 `PiRuntimeFactory` 上暴露订阅认证方法（复用同一 `this.runtime()` 实例并在变更后调用 `this.reload()`）：
       - `subscriptionStatus()`：查询内置订阅 provider（`anthropic`、`openai`）的认证状态（是否已连接、`isUsingSubscription`、是否过期需重登）及其在 Pi catalog 中的可用模型列表。
       - `startSubscriptionLogin(providerId: 'anthropic' | 'openai', options)` / `completeSubscriptionLogin(...)` / `logoutSubscription(providerId)`：对接 Pi SDK 的 `login` / `logout` 流程（支持返回授权 URL / 设备码，以及在远程/无头环境下提交回调 URL 或 authorization code），确保 `<agentDir>/auth.json` 权限为 `0600`。
  2. **`kaiming/src/server/methods.ts`（RPC 接口与模型指派放行）**：
     - 新增 RPC 方法：
       - `provider.oauth.status`（只读）：返回 `anthropic` 与 `openai` 订阅连接状态及可用模型，绝不返回 access/refresh token。
       - `provider.oauth.start` / `provider.oauth.complete` / `provider.oauth.logout`（写方法）：启动登录、提交 code/完成回调、退出登录（退出后调用 `reloadRuntime()`）。
     - 放行订阅模型指派（`saveModelAssignment` 与 `readConfig`）：
       - 当 `providerId` 属于已连接订阅（或存在于 `providers` 表）且 `modelId` 属于该订阅 provider 的 catalog 模型时，允许保存到 `model_overrides`，无需在 `models.json` 伪造 `apiKey`。
       - `config.get` 返回 `subscriptions` 列表，并在 `providers` 候选或模型下拉中合并已连接订阅的模型（标注 `subscription: true`）。
  3. **前端设置页（`kaiming/webapp/src/settings/ProvidersPage.tsx`、`ModelsPage.tsx`、`UsagePage.tsx`）**：
     - `ProvidersPage` 顶部增加「订阅账号（Claude Pro/Max · ChatGPT Plus/Pro）」卡片：显示状态（已连接 / 未连接 / 需重新登录）、打开授权链接 + 粘贴回调 Code 完成登录按钮、试连与退出登录按钮。
     - `ModelsPage` 的模型下拉列表中包含已连接订阅的对应目录模型。
     - `UsagePage` 对订阅 provider 的调用标注“订阅”，不将目录估算价混同于 API 账单。
- **契约同步**：更新 `docs/technicalnew/runtime-contract.md`（R1/R5）与 `docs/technicalnew/ui-design.md`（U6/U9 方法消费表）。
- **验证档与测试要求（`focused`）**：
  - 服务端单测（`test/provider-config.test.ts`）：验证订阅登录状态读取、写入 `auth.json`（权限 `0600`、响应不含 token）、未建 `models.json` 条目即可将订阅模型指派给角色并通过 `isAvailable` 检查、退出登录后 `isAvailable` 变为 `false`。
  - **负向控制（Negative Control）**：当 `auth.json` 中凭据缺失或已登出时，指派或运行该订阅模型必须被 `MODEL_UNAVAILABLE` 阻断，且任何 RPC 响应/错误文本中不得出现 `auth.json` 内的 token 字符串。
  - 浏览器路径：在 `ProvidersPage` 完成模拟 OAuth 绑定 → `ModelsPage` 选择该订阅模型 → 刷新保持。

---

#### P2-2：从当前主管会话 Fork 新会话（原 F1）

- **背景与设计依据**：已归档草案 `.kaiming/work/fork-chief-session-20261101/plan.md`。当用户在一条主管会话中讨论出多个方向时，需要一键复制当前对话上下文到新会话并行推进，而不污染原会话或其绑定的 Task。
- **修改文件与精确实现步骤**：
  1. **`kaiming/src/runtime/pi-runtime.ts`（分支会话文件生成）**：
     - 在 `PiRuntimeFactory`（或独立 helper）新增 `branchSessionFile(params: { sourcePiFile: string; branchEntryId?: string; cwd: string }): { piFile: string; leafEntryId: string }`：
       - 检查 `sourcePiFile` 存在；调用 `SessionManager.open(sourcePiFile, sessionDir, cwd)`；
       - 取 `leafId = params.branchEntryId ?? manager.getLeafId()`（若无 leaf 即空会话则抛出 `INVALID_ARGUMENT`）；
       - 调用 `manager.createBranchedSession(leafId)` 生成仅包含当前分支历史的新 Pi JSONL 文件，返回新文件路径与 leafEntryId（原文件字节不变）。
  2. **`kaiming/src/store/store.ts` & `kaiming/src/server/write-methods.ts`（`session.fork` RPC）**：
     - 在 `write-methods.ts` 注册写方法 `session.fork`（参数：`projectId`、`sessionId`、`title?`）：
       - **前置校验**：源会话必须存在、属于该 `projectId`、且 `roleId === 'chief'`；源会话不得有未停稳输入（`listInputs(sessionId)` 中存在 `queued` / `processing` / `interrupted` 时拒绝并报 `WORKSPACE_BUSY`）；源会话必须已有持久化历史（`getSessionBinding(sessionId)?.hasHistory === true` 且 `piFile` 存在，否则报 `INVALID_ARGUMENT: cannot fork an empty session`）。
       - **允许源会话有未结束 Task，但不继承**：即使源会话 `currentTaskId !== null`（只要当前时刻主管自身没有正在跑或中断的 input），也允许 fork；新会话的 `currentTaskId` 恒为 `null`、`channel` 恒为 `null`，不复制任何 Task 关联、排队输入或 `interactions`。
       - **落库（同一事务）**：调用 `branchSessionFile` 生成新 JSONL 后，创建新 chief session（默认 `title` 为 `${源标题} (fork)`，截断至 60 字符）并写入 `session_bindings`（`piFile: 新文件, branchEntryId: 新 leaf, hasHistory: true, configHash: 源 configHash`）。
       - 发布 `invalidate('session')` 并返回 `{ sessionId: newSessionId, title, revision: 1 }`。
  3. **前端会话列（`kaiming/webapp/src/chat/SessionsList.tsx` & `useWorkspace.ts`）**：
     - 在 `SessionsList` 当前选中（或非归档）的主管会话行操作区增加分支按钮（`⎇`，`data-testid="session-fork"`，`aria-label={t('session.fork')}`）。
     - 点击后调用 `rpc.call('session.fork', { projectId, sessionId })`，成功后刷新会话列表并自动切换到新会话；若被拒绝（如正在运行或空会话），通过外壳 toast 显示服务端原因。
- **契约同步**：更新 `docs/technicalnew/runtime-contract.md`（R1 新增 `session.fork`）与 `docs/technicalnew/ui-design.md`（U5 会话列、U9 方法消费表）。
- **验证档与测试要求（`focused`）**：
  - `test/server-write.test.ts`：
    1. 对已有真实 Pi JSONL 历史的空闲主管会话调用 `session.fork` → 返回新 `sessionId`，新会话通过 `session.messages.list` 读到与源会话相同的历史消息；随后在两边各发一条新消息，两边历史互不串扰；源会话若绑有未结束 Task，新会话 `currentTaskId === null`。
    2. **负向控制（Negative Control）**：对空会话（尚无历史）、非 chief 会话、或仍有 `processing`/`queued`/`interrupted` 输入的忙会话调用 `session.fork` → 必须被拒绝（`INVALID_ARGUMENT` 或 `WORKSPACE_BUSY`），且不产生孤儿 session 行或 JSONL 文件。
  - 浏览器路径（`browser/acceptance.spec.ts`）：在已有对话的会话行点击 Fork → 切换到带 `(fork)` 的新会话且历史可见。

---

## 二、活动风险与登记项

### R 风险（未记通过）

| 编号 | 风险 | 现状与处置策略 |
|---|---|---|
| R1 | 真实模型下的部分产品验收场景（J-09/J-10 设计与返工、J-12/J-13 新旧项目起步、AC-51～AC-62）尚未逐条独立打卡 | 已通过一个完整真实项目周期验证主干能力，且 `check:workflow`（8/8）、`check:backlog`（4/4）已覆盖真实模型核心路径；剩余场景随日常迭代自然检验，不脱离真实任务做机械打卡 |
| R2 | 触屏手势与软键盘遮挡未在真机验证 | CSS 已用 `100dvh` + 安全区并在 320/390px Chromium 走查通过；真机留待 M 系列实施时一并验证 |
| R3 | 320px 以下视口不作承诺 | 明确声明下限 320px |
| R4 | 转录未虚拟化 | 快照上限 100 条 + `MessageItem` memo + `rAF` 合帧后，300 行流式脚本耗时已从 797ms 降至 178ms；超长历史出现卡顿时再按需引入虚拟滚动 |
| R5 | 外部接入缺会话级用量推送（原 S6）与单次委派模型覆盖（原 S7） | `usage.report` 统计项目/全局；MCP 协议未声明 `usage_update`/`config_option`，沿用设置页配置，不算违约 |
| R6 | 专业成员漏调 `agent_report`（`REPORT_MISSING`） | 提示词约束（`09f8f0a`）与退化重试预算（`REPORT_RETRY_EXHAUSTED`）已上线；**派发信封与同回合自动补交已列入 P0-1**（见[验证记录](validation.md#2026-11-06--评审-report_missing-根因suangua-现场)与[预算记录](validation.md#2026-11-14--报告重试预算结构账本替代内容签名防线)） |
| R7 | 成功调用非结果工具的无限探索循环（如 `read` 成功 ×∞）不触发报告重试预算 | 300+ 历史会话未出现；由运行 watchdog（90 分钟）兜底。若真实出现，按同结构扩展账本（同工具+同参数摘要连击），不回到内容签名 |

### P 最佳实践（后续开发持续遵守）

| 编号 | 做法 | 理由 |
|---|---|---|
| P1 | 列表类界面一次请求取齐所需字段（`project.list` / `session.list`） | 避免 N+1 往返与无用流订阅 |
| P2 | 有推送就不高频轮询；轮询只在页面可见时运行，完成后停表 | 降低后台标签页与空闲负载 |
| P3 | 服务端错误码映射本地文案，服务端 detail 作为第二行 | 共享 `catalogErrorKey`，避免中英混排且保持未知码可见 |
| P4 | 遮罩层具备焦点陷阱、Esc 关闭、焦点归还与 `aria-live` 通知 | 保证键盘与无障碍可用性 |
| P5 | 「方法消费」门禁：[ui-design.md](ui-design.md#u9-方法消费) 列出每个公开方法的消费界面 | 防止新增孤儿后端方法 |
| P6 | 新方法清单：参数校验、归属校验、CAS/幂等、契约测试、`runtime-contract.md`、README 索引齐全 | 避免实现与合同分叉 |
| P7 | 三态（加载/空/错误）复用 `State` 与既有样式类 | 防止各页面自造状态样式 |
| P8 | 分页 cursor 语义统一并在合同表注明 | 避免同一资源多套分页语义 |
| P9 | 测试只钉可观察行为与合同边界，且标准代码 Test 必含负向控制 | 杜绝抄实现输出当期望值、杜绝源码文本正则断言 |

---

## 三、明确搁置与不做

### M 移动端（方向已定，尚未实施）

手机端**不可用的缺陷已全部修复**（320/390px 五屏无横向溢出、控件可达，见 [验证记录](validation.md)）。剩余 M1～M5 属于将窄屏“响应式压缩版”重做为“底部固定 Tab Bar + 全屏会话列表”的形态升级；因编码工作台重度场景在桌面端与 IDE（MCP），**明确搁置，不入近期排期**：
- **M1**：主导航在窄屏改为底部固定 Tab Bar（≥48px），顶栏只留项目名与连接状态。
- **M2**：手机上「会话」Tab 进入全屏会话列表页，选中后返回对话。
- **M3**：Tab Bar 固定最底，输入框在其上方，留出 `100dvh` + `env(safe-area-inset-bottom)`。
- **M4**：窄屏 CSS 媒体查询按外壳四段结构收敛。
- **M5**：iOS Safari 与 Android Chrome 真机软键盘与安全区走查。

### N 需求体系外接远程系统（已存档，暂不讨论）

2026-10-26 用户决定存档，外部同步仅在 [A8 协调扩展点](architecture.md#a8-协调扩展点本阶段只定义不实现) 保留结构边界（本机是自主执行节点，执行端永不修改需求目标与验收，只回传事实），不写网络代码、不排期。历史调研见 `.kaiming/work/remote-requirement-sources-20261027/research.md`。

### 明确不做

- 不引入前端状态管理库或请求缓存层（现有 `useState` + 单 `RpcClient` 足够）。
- 不把 `config.test` 扩成未保存草稿试连（U9）。
- 不为会话输入新增结构化待办引用参数（S5）；关联写在 Task 的 `backlogIds`。

---

## 四、已关闭缺口归档（2026-10 ～ 2026-11）

以下历史缺口均已修复并通过验证，详细证据见对应提交与 [验证记录](validation.md)。

### Q 待改（已决定方向，尚未实施）

*注：本节标题保留以兼容 [UI 设计契约](ui-design.md#u4-组件) 的历史锚点引用；Q1～Q4 已于 2026-10-25 随会话转录 TUI 化全部关闭。*

| 编号 | 现象与已定方向 | 状态与证据 |
|---|---|---|
| Q1～Q4 | 转录间距分档（同轮 8px / 换轮 24px）、成员行状态归并到 `TaskTodo`、工具卡 `create`/`dispatch` 默认单行折叠、移除常驻挤压转录的执行面板 | **已关闭（2026-10-25）** — `chat-tui-flow-20261025`，见 [验证记录](validation.md#2026-10-25-会话转录-tui-化与工作流全量展示) |

### 已关闭的界面缺陷（D）、后端方法（S）、合同偏差（C）与未消费入口（U/N/P）

| 编号 | 简述 | 关闭时间与证据位置 |
|---|---|---|
| **P10 / S9 / S10 / D10(看板)** | 删除旧 9 状态需求实体，落地待办（`.dev/backlog.md`）+ 规格 + 模块地图 + Plan 验收必填与范围越界检查（`scopeDrift`）+ `/project` 五列看板与 MCP `kaiming_backlog` | **已关闭（2026-11-09）** — WP-1～WP-8，服务端 59 文件 566 用例、webapp 108 用例、`check:workflow` 8/8、`check:backlog` 4/4 |
| **U11(错误码)** | 任务花名册失败行渲染 `session_inputs.errorCode`（`REPORT_RETRY_EXHAUSTED`、`MODEL_OUTPUT_CORRUPTED` 等）本地化原因句 | **已关闭（2026-11-14，`95bc4cc`）** — `u11-error-label-20261114` |
| **C6** | 已终止 Task 的队列清扫误杀该主管会话自己的 queued 用户消息 | **已关闭（2026-10-31，`7b8d9bc`）** — `test/store.test.ts`、`test/server-write.test.ts` |
| **C7 / C9 / C12 / C13** | 主管回合结束后成员才完成/中断/重启时无人接收：新增 `step-wake.ts` 步骤停稳自动唤醒、`onRunSettled` 上报、interrupted 成员专用恢复通知与启动扫描补唤醒 | **已关闭（2026-10-31，`d5f4e53` / `b27093d` / `bbc3d9c`）** — `test/step-wake.test.ts`、`test/step-wake-e2e.test.ts` |
| **C10** | 主管在 `settleStep` 等待成员的时间被计入自身 stall/total 看门狗导致 90 分钟必被杀 | **已关闭（2026-10-31，`b27093d`）** — `hostWaits` 豁免等待计时，`test/runtime.test.ts` |
| **C11** | `task` 工具 schema 漏声明顶层 `sessionId` 导致 `task(op=recover)` 恒被 Pi 校验拒绝 | **已关闭（2026-10-31，`a881e3c`）** — `src/tools/task-tools.ts`、`test/runtime.test.ts` |
| **C14** | 阶段退回 `develop` 并续办原成员时，`listTaskSessions` 按 `createdAt` 排序产生空 frontier | **已关闭（2026-10-31，`f536fea`）** — 改按 `updatedAt, createdAt, sessionId` 排序 |
| **C15** | bash 工具无默认超时，子进程打印后不退出拖死整个 run 15 分钟 | **已关闭（2026-10-31，`c382c3a`）** — 宿主注入默认 600s 超时，`test/tool-guard.test.ts` |
| **C16 / C22** | 交付快照包含 `.gitignore` 忽略产物、结算修改 `docs/**` 导致 Review 绑定失效 | **已关闭（2026-11-01 `ac2ba50` / 2026-11-02 `c18a395` / 2026-11-13 `1139eb9`）** — `test/deliverable.test.ts`、`test/report.test.ts` |
| **C17 / C18 / C20** | 前端 `slot.ts` 按正文去重误删同文新回复、旧完成帧顶掉新流式条目、超过 100 条历史重连后旧消息排到最新消息下方 | **已关闭（2026-11-01 `c7d5afd` / `4ac20f2`、2026-11-02 `feece57`）** — `webapp/test/slot.test.ts` |
| **C19** | Task 成员行长 question 标题撑爆 `auto` 轨道导致横向溢出 | **已关闭（2026-11-01，`482d69e`）** — 状态列改为 `fit-content(45%)` |
| **C21** | 专业成员正常结束但未调 `agent_report` 仍被记为 `completed` 并算作通过 | **已关闭（2026-11-02，`c199154`）** — 无对应结果记 `failed/REPORT_MISSING`，拒绝完成并提示原会话补交 |
| **C23** | 切换主管会话后残留上一条会话的 Task 条与轮询回包 | **已关闭（2026-11-03，`ff104e9`）** — `taskSessionId` 归属校验，`webapp/test/task-scope.test.ts` |
| **U7(MCP)** | 会话列未标注外部接入固定会话 | **已关闭（2026-11-09）** — `SessionRow.channel === 'mcp'` 渲染 `MCP` 标记 |
| **C5** | `task.get` 合同与 `task.report.get` 报告正文获取方式表述不一 | **已关闭（2026-10-28）** — 统一为 `includePlan` 取 Plan、报告正文走 `task.report.get` |
| **N1 / N2 / N3** | 补齐 `web_search`/`web_fetch`/`browser` 外部工具、自定义 provider 图片 `input` 声明与前端图片上传/渲染 | **已关闭（2026-10-22）** — `npm run check:tools` 4/4 |
| **D1～D10(初版) / S1～S4 / C1～C4 / U1～U10** | 模型项目级覆盖、抽屉焦点陷阱、后台暂停轮询、`project.list`/`session.list`、Task 变更推送、阻断横幅快照、全屏文件与报告查看画布（`FileViewer`）、历史反向翻页等 26 项基础缺口 | **已关闭（2026-10-22 ～ 2026-10-26）** — 见 [UI 设计契约](ui-design.md) |
| **D11～D16** | Provider 协议必选、显示名与编辑弹框、主管会话自定义改名（`session.rename`）、项目内按角色配置模型与 `config.clear`、Task 成员行内联与刷新可见 | **已关闭（2026-10-23 ～ 2026-10-24）** — 见 [验证记录](validation.md#2026-10-23-provider-命名协议与会话命名) |
