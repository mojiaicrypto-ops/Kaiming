# 下一轮开发计划与缺口登记

日期：2026-11-18（2026-11-22 增补 P3 安全沙箱与多任务并行路线）。本页是**下一轮开发路线图（P0 → P1 → P2 → P3）**、活动风险与历史缺口归档的唯一入口；实现证据见 [验证记录](validation.md)，产品验收标准见 [产品验收](../productnew/acceptance.md)。

维护规则：新增公开方法、删除界面入口、修正合同时同步本页；关闭一项时移入底部归档表并附提交或测试位置。

---

## 一 下一轮开发计划 P0 → P1 → P2 → P3

基于真实项目开发周期复盘、第一性原理分析与独立架构评审，现阶段核心架构（SQLite WAL + Pi 1.0 SDK + 五核心工具 + 独立 Review/Test 证伪 + Git/交付绑定）已经成型，不再引入新角色或新状态枚举。路线优先级按**“砍掉运行期隐性协调税（P0）→ 硬化脏工作区交付隔离（P1）→ 高杠杆算力与会话分支（P2）→ OS 级安全沙箱与按需 Worktree 多任务并行（P3）”**排列。

以下各工作包均按**独立开发 AI 可直接照单编码**的颗粒度编写，包含精确代码位置、函数/接口签名、边界条件、已排雷的禁用陷阱、验证档（Verification Profile）与负向控制（Negative Control）要求。

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

**状态**：已实施（2026-11-18）。`session.fork(projectId, sessionId, title?)`；标题缺省「源标题 + `(fork)`」，上限 60 个 UTF-16 单元；分叉点取文件当前 leaf；行失败删除已复制文件。浏览器验收在 `browser/session-fork.spec.ts`（含拒绝 toast）。证据见[验证记录](validation.md#2026-11-18--p2-2-主管会话-fork原-f1)。

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

### P3：执行安全沙箱、按需 Worktree 多任务并行与并发护栏（2026-11-22 评审确认，待实施）

#### 架构共识与解耦原则（研发 AI 实施前必读）

本节沉淀自第一性原理分析、独立架构评审以及对 **OpenAI Codex CLI（`codex-rs`）** 与 **Pi 生态沙箱方案**（本地 `node_modules/@earendil-works/pi-coding-agent/examples/extensions/sandbox/index.ts`、`gondolin/index.ts`、`anthropics/sandbox-runtime` ~7k ★、`earendil-works/gondolin` ~2.5k ★、`carderne/pi-sandbox` 312 ★）的调研，确立以下三条顶层原则：

1. **三层彻底解耦（每层只管自己最擅长的事）**：
   - **安全边界（`P3-1` OS 执行沙箱）归宿主内核层**：只管“不能读私有存储、不能越界写宿主机、不能越权碰 `.git`”，**绝不与 Worktree 或测试编排耦合**。
   - **多任务目录隔离（`P3-2` 按需 Git Worktree）归宿主 Git 层**：只管同项目多主管会话并行推进多个 `write Task` 时的磁盘与 Git Index 正交、Plan/报告相对路径与诚实合流，**不内建跨语言依赖魔法或端口框架**。
   - **测试环境隔离（换端口 + `$TMPDIR` vs. Docker）归 AI 自主决策**：测试形态因语言和项目千差万别——轻量服务由 AI 自选空闲端口 + `$TMPDIR` 临时数据目录；重依赖/多服务项目（Redis/Postgres/Nginx 等）由 AI 按需使用独立命名的 Docker 容器并在测完清理。宿主仅提供通用原则提示，不硬造万能测试容器编排层。
2. **选型定论：零新增 npm 依赖，自研无状态 `os-sandbox.ts`**（参考 Codex + `sandbox-runtime`，**不直接引入 `@anthropic-ai/sandbox-runtime`**）：
   - 原因：① `SandboxManager` 是进程级全局单例，设计面向单项目单 CLI 进程，无法承载开明“全局单 Server 同时并发多项目、多角色（Chief 只读 / Dev 写工作区 / Settler 写 `.git`）、多 Worktree”的并发模型；② 它强依赖宿主机外部二进制 `rg` / `socat` 与本地代理，会增加部署门槛并干扰 Chief 的 `ssh`/Docker 运维；③ 官方示例以 `bash -c wrappedCommand` 外层拼接启动，不如 Codex 直接 `spawn('sandbox-exec' | 'bwrap', ...)` + 参数化 `-D` 传入路径安全干净。
   - 接入严格复用 Pi 1.0 SDK 原生 `createBashToolDefinition(cwd, { operations, exposeSessionEnvironment: false })`；未来如需为不可信仓库新增 `Gondolin` micro-VM 后端，可沿同一 `*Operations` 接缝平滑接入。
3. **经独立 Review 排雷的明确禁区（严禁回退到这些脆弱设计）**：
   - **严禁**在 SBPL / `bwrap` 中模拟 `.gitignore` 或把海量 `reviewed.paths` 逐条塞进沙箱参数（触发 `ARG_MAX`/mount 限制且无法表达取反规则与嵌套 ignore）；
   - **严禁**对 Tester 在内核层把整个项目源码目录锁死只读（真实项目 `vitest`/`vite build`/`pytest`/`playwright` 需写 `dist/`、`coverage/`、`test-results/` 等，会被大面积误杀；Tester 防改源码仍靠 `deliveryState.digest` 不可伪造门禁兜底）；
   - **严禁**给 `investigator`（以及 `read Task` / `paused` 恢复通道）开放所谓“只读沙箱 `bash`”（文件系统只读挡不住网络/SSH/DB 写操作，破坏 G1/S3 无副作用底线）；
   - **严禁**靠正则匹配 stderr 里的 `EPERM` 弹提权窗（不可靠，采纳 `carderne/pi-sandbox` 做法：被拒透明返回真实错误）；
   - **严禁**把 Worktree 建在 `.git/` 内（单仓库下 `createFileBoundaryGuard` 拦不住 `write`/`edit` 写穿主区或兄弟 Worktree；Monorepo 子目录项目下 `.git` 在 `project.realPath` 之外会导致全部文件工具被 100% 拒绝）；
   - **严禁**自动软链 `node_modules` / `.venv` 到 Worktree（Node/Vite/Vitest `realpath` 解析会静默测到主工作区旧源码；Python `.venv` 硬编码主区绝对路径；且会触发 `tool-guard` 符号链接拦截）；
   - **严禁**将 `.dev/backlog.md` 锚定主工作区跨目录双写而代码在 Worktree 提交（割裂 S6/D-07 提交历史，留下脏主区阻塞后续合流）；
   - **严禁**在 `task(op=end)` 对已推进的主分支静默自动 rebase 合流（零 Git 文本冲突 ≠ 零语义冲突，直接击穿 D-08/G3“组合成果按最终组合重验证”不变量）；
   - **严禁**承诺 macOS 下清理 `nohup`/`setsid` 脱离进程组的孤儿进程（macOS `sandbox-exec` 无 PID namespace，坚持 S5 诚实边界）。

---

#### P3-1：OS 级执行安全沙箱（`WP-Sandbox`，首选优先实施，不改 DB Schema）

**状态**：已实施（2026-11-23）。产品基线与角色边界见 P-05/AC-63～AC-65；实现证据见 [验证记录](validation.md) 的 P3-1 条目与 `.dev/work/p3-1-os-sandbox-20261123/`。与 Worktree 及测试编排解耦。
**实现证据**：macOS 真实内核探针与私密/越界/角色/git/linked-worktree/Unix-socket/nohup 边界 11/11；全量 71 文件 735 用例；webapp typecheck/build；浏览器 off/auto 徽标 2/2；`check:prompts` 15/15。Linux `bwrap` 路径因当前主机未安装未执行，保留 fail-closed。

- **问题与根因**：
  1. `src/runtime/tool-guard.ts` 仅拦截 Pi 的 6 个文件工具（`read/write/edit/ls/find/grep`），而 `bash` 工具目前仅靠文本级 `deletion-gate.ts` 与事后审计 `shell-audit.ts` 约束（[P-05](../productnew/modules/project-workspace.md#p-05-模型配置与首次使用) 已确认执行沙箱的目标契约，[G1](agents-and-tools.md#g1-角色与工具集合) 记录当前实现）。任何持 `bash` 的角色在脚本中直接读 `<agentDir>/models.json`、`auth.json`、`state.db` 或写项目外文件都无法被物理拦截；Chief 的 `shell-audit.ts` 也只能事后标红而不能事前阻止修改项目源码。
  2. Pi 1.0 SDK 内建 `bash.js`（`exposeSessionEnvironment` 默认 `true`）会向每个 `bash` 子进程注入 `PI_SESSION_FILE`，直接暴露 `<agentDir>/sessions/...` 私有目录路径。
  3. `src/runtime/registry.ts`（第 48～52 行）的 `bindingHash` 仅哈希 `{ config, tools, appendSystemPrompt }`，未包含 `spec.cwd` 与沙箱策略哈希；当会话工作目录或沙箱策略变化时会静默复用旧 Pi 实例。
- **修改文件与精确实现步骤**：
  1. **新增 `kaiming/src/runtime/os-sandbox.ts`（无状态 OS 沙箱引擎）**：
     - **策略数据结构**（参考 Codex `WritableRoot { root, readOnlySubpaths }`，纯数据、无全局单例）：
       ```ts
       export type SandboxMode = 'auto' | 'strict' | 'off';
       export type SandboxProfileKind = 'read-only' | 'workspace-write' | 'workspace-write-git';

       export interface SandboxPolicy {
         readonly kind: SandboxProfileKind;
         readonly cwd: string;
         /** 绝对禁读/禁写/禁列的私有路径：dataDir、agentDir，以及启动时实际加载的工作台 .env 精确文件。 */
         readonly privatePaths: readonly string[];
         /** 私有路径中唯一只读豁免区（<agentDir>/work，供 web_fetch/报告读取）。 */
         readonly readablePrivatePaths: readonly string[];
         /** 允许写入的目录根（按角色构造；read-only 不含项目目录）。 */
         readonly writableRoots: readonly string[];
         /** 在 writableRoots 内挖空为只读的子路径（如 .git 或 .git/hooks）。 */
         readonly readOnlySubpaths: readonly string[];
         /** 每会话独立 TMPDIR（如 /tmp/kaiming/<sessionId>）。 */
         readonly tempDir: string;
         /** auto 放行 Docker socket（运维与容器测试）；strict 为 false。 */
         readonly allowDockerSocket: boolean;
         /** auto/strict 都放行 $SSH_AUTH_SOCK 供 Chief 远程 ssh 运维。 */
         readonly allowSshAgent: boolean;
         /** auto/strict 默认 'allow'；这层不是网络出口控制，恶意代码隔离另走容器/VM。 */
         readonly networkAccess: 'allow';
       }
       ```
       `privatePaths` 的条目可以是目录或精确文件；`tool-guard` 与沙箱执行器都按 realpath 后的路径拒绝，精确文件用于工作台 `.env`。
     - **硬隐私底线 + 角色自动映射（`sandboxPolicyFor(...)`，宿主固定、模型不可改）**：
       - **硬隐私底线（所有持 `bash` 角色强制）**：内核层禁止读/写/列举 `privatePaths`（仅放行 `<agentDir>/work` 只读）；`privatePaths` 包含实际加载的工作台 `.env` 精确路径，即使项目根包含该文件也拒绝；用户自己项目的 `.env` 不加入，不误伤业务配置。子进程环境按 **allowlist** 清洗，只保留基础系统与常见工具链变量（`PATH`、`HOME`、`USER`、`SHELL`、`LANG`、`LC_*`、`TERM`、`XDG_*`、`SSH_AUTH_SOCK`、`DOCKER_HOST`、`HTTP(S)_PROXY`、`NO_PROXY` 等），清掉访问口令、`OPENAI_API_KEY`、`ANTHROPIC_API_KEY`、`BRAVE_API_KEY` 等所有 provider/宿主秘密；配合 `exposeSessionEnvironment: false` 消除 `PI_SESSION_FILE`；强制注入独立 `TMPDIR`/`TEMP`/`TMP` 与 `GIT_TERMINAL_PROMPT=0`。
       - **Chief → `read-only`**：项目目录与 `.git` 100% 内核级只读；仅允许写 `tempDir`、`/dev/null`，以及（`auto` 模式下）运维 Unix Socket（`$SSH_AUTH_SOCK`、Docker socket `/var/run/docker.sock` / `~/.docker/run/docker.sock` 等）。`ssh`/`curl`/`docker`/`lsof`/`git status` 保持可用。**生效的只读沙箱下，主管的 commit、历史改写与工作区丢弃命令不再弹确认，直接以 `isError` 拒绝并指向 settler；只有 `off` 模式保留原确认。** `Trust all` 只免后续确认，不解锁内核只读。
       - **Developer / Designer / Tester → `workspace-write`**：允许写 `cwd` + `tempDir` + 常见包管理器/工具缓存目录（`~/.npm`、`~/.cache`、`$XDG_CACHE_HOME`、`~/.pnpm-store` 等，支持环境变量追加）；**挖空 `<cwd>/.git`**（若为 linked worktree 则同时挖空其 `<git-common-dir>`）为只读，并自动注入 `GIT_OPTIONAL_LOCKS=0` 使 `git status` / `git diff` / `git log` 零报错正常运行。`auto` 放行 Docker socket 供 AI 自主选择 Docker 隔离测试；`strict` 关闭 Docker socket。设计角色移动/删除文档使用普通 `mv`/`rm`，不再依赖 `git mv`。
       - **Settler → `workspace-write-git`**：同 `workspace-write`，但**放开 `.git`**（及 linked worktree 的 `<git-common-dir>`）以执行合法提交，仅挖空 **`<gitDir>/hooks`** 为只读（防止钩子注入）。
       - **Reviewer / Investigator / `read Task` / `paused` hold**：维持无 `bash`（不改变 `tool-sets.ts` 只读不变量）。Tester 对源码的写不靠把项目锁成只读，仍由 `deliveryState.digest` 不可伪造门禁兜底。
     - **跨平台内核执行器 `createSandboxedBashOperations(policy): BashOperations`**：
      - **macOS（`darwin`）**：生成参数化 SBPL 策略文件并通过 `/usr/bin/sandbox-exec -f <profilePath> -D PRIVATE_DIR_0=... -D WRITABLE_ROOT_0=... ... -- <shell> -c <command>`（或通过 stdin 传命令，避免超长命令行与路径字符注入）直接 `spawn`，**不经过外层未沙箱化的 `bash -c` 拼接**；复用 Pi `bash.js` 同等的 `detached`、`killProcessTree`、`AbortSignal` 与 `timeout` 语义。目录用 `(subpath ...)`，精确文件用 `(literal ...)`；按 SBPL 后匹配优先，先 allow `writableRoots`、再 deny `privatePaths`、最后 allow read `<agentDir>/work`。必须用真实子进程验证顺序，并覆盖自举布局（`projectRoot=/repo`、dataDir 与 `.env` 在项目内）。
      - **Linux（`linux`）**：直接 `spawn('bwrap', ...)`：`--ro-bind / /`、`--dev /dev --proc /proc`、对目录型 `privatePaths` 挂载 `--tmpfs <dir>` 物理遮空再 `--ro-bind <agentDir>/work <agentDir>/work` 挂回只读输出区、对 `writableRoots` 执行 `--bind`、对 `readOnlySubpaths` 执行 `--ro-bind` 挖空、`--die-with-parent`。**精确文件不能用 `--tmpfs`**：绑定一个 `chmod 000` 空占位文件 `--ro-bind <stub> <file>` 使读取直接 `EACCES`。挂载顺序必须先用 `--bind <cwd> <cwd>`，再覆盖 `privatePaths` 与只读 `.git`，后置覆盖生效；自举嵌套路径必须有真实用例。
      - `privatePaths` 中的精确文件与符号链接逃逸必须在真实探针中验证：`..`、符号链接、精确 `.env` 路径都不得绕过；单文件私有路径在 Linux 与 macOS 分别走 stub/literal，不能假设同一规则。
     - **环境开关与启动探针 `probeSandbox(mode)`**：
       - 读取 `KAIMING_SANDBOX=auto|strict|off`（服务端启动环境变量，默认 `auto`）；重启工作台后对全部会话生效；首版不提供前端动态切换。
       - 启动时在临时目录运行一次真实探针：尝试在沙箱内读临时私有文件 + 向沙箱外写测试文件，确认均被内核拒绝；注入未隔离执行器时探针必须失败。
      - **`auto` 与 `strict` 缺失 `sandbox-exec`/`bwrap` 或探针失败时都 Fail-Closed 拒绝执行 `bash`**，返回原因并提示安装后端；**绝不降级为未沙箱执行**。只有显式 `off` 允许无沙箱执行并明确标「保护已关闭」。**服务实时状态**由启动探针结果直接从 `session.get` / `session.stream.prepare` 返回给当前工作/会话详情（重启后、未发消息的新会话立即可见）；`effectiveConfig.sandbox` 仅作为每次输入的历史审计快照，不得驱动实时徽标，避免重启后旧输入的 `active: true` 冒充当前状态。
       - `auto` 与 `strict` 的唯一差异是 Docker socket：`auto` 放行，`strict` 禁止；两者都保留网络与 SSH agent，因此仍只是本机文件系统边界，不是恶意代码隔离；不可信第三方仓库使用外部容器/VM/独立用户。
  2. **修改 `kaiming/src/runtime/tool-guard.ts` 与 `kaiming/src/server/main.ts`**：
     - `privateDirs` 扩展为私有路径集合（目录或精确文件）；把启动时实际加载的工作台 `.env` 路径加入。项目自身的 `.env` 不加，保持可读。
  3. **修改 `kaiming/src/runtime/runner.ts`**：
     - 当 `toolSet.allowlist.includes('bash')` 且沙箱启用时，通过 Pi SDK 原生 `createBashToolDefinition(session.cwd, { operations: createSandboxedBashOperations(policy), exposeSessionEnvironment: false })` 构造 `bash` 工具加入 `customTools` 覆盖内建 `bash`（自动同步覆盖 `codemode` 嵌套调用，保留 `deletion-gate`、`shell-audit` 与默认 600s 超时守卫）；
     - 即使 `KAIMING_SANDBOX=off`，仍默认设置 `exposeSessionEnvironment: false` 避免泄漏 `PI_SESSION_FILE`；
     - 在 `recordEffectiveConfig` 中记录脱敏的 `sandbox: { mode, kind, backend, active, reason }`，只作为历史输入审计；服务实时状态由 `server/main.ts` 的启动探针结果经 `session.get` / `session.stream.prepare` 返回，不得只写日志或只读历史输入。
  4. **修改 `kaiming/src/runtime/deletion-gate.ts`（第 195～228 行）**：
     - `runner` 把当前沙箱政策传给主管门禁；`guardHistory` 命中 `HISTORY_RULES` 且只读沙箱生效时，不发起 interaction，直接返回 `isError` 与“主管只读沙箱不能提交/改写历史/丢弃工作区，请由 settler 收口”的原因；
     - 该拒绝发生在 `Trust all` 判断之前，信任不能解锁内核只读；
     - 仅 `KAIMING_SANDBOX=off` 保留原有的确认弹窗与 `Trust all` 语义。
  5. **修改 `kaiming/src/runtime/registry.ts`（第 48～52 行）**：
     - `SessionRegistry.acquire` 的 `bindingHash` 纳入 `cwd: spec.cwd` 与 `sandboxKey`（策略摘要），确保工作目录或沙箱档位变化时必重建 Pi 实例。
  6. **安装与 `.env` 兼容（`scripts/setup.sh:51-63`、`scripts/start.sh`、`kaiming/package.json:11`、`kaiming/src/mcp/main.ts`）**：
     - 新装默认把工作台 `.env` 放到默认私有数据目录（`kaiming/.kaiming-data/.env`），不写在项目根。
     - 启动解析顺序：① 显式 `KAIMING_DATA_DIR` → `$KAIMING_DATA_DIR/.env`；② 否则默认私有数据目录的 `.env`；③ 回退老位置 `kaiming/.env`。`start.sh` 先解析路径再启动，避免读取 `.env` 才知道数据目录的循环。
     - 显式 `--env-file <resolved>` 并传入 `KAIMING_ENV_FILE=<realpath>`；`server/main.ts` 把该 realpath 纳入 `privatePaths`。`kaiming/package.json` 的 `start` 不得硬编码 `.env`；直接 `npm start` 使用 `KAIMING_ENV_FILE` 或老文件回退；`kaiming/src/mcp/main.ts` 自启必须使用同一解析后的 data/env，不能以空口令/空库启动。
     - 两条启动路径与 MCP 自启都要有测试证据；自举开发工作台自身时，`read`/`grep`/`bash` 都读不到工作台口令，而业务项目自己的 `.env` 不受影响。
  7. **文档与提示词同步**：
     - **现在（产品基线）**：`docs/productnew/modules/project-workspace.md`（P-05 新增「执行沙箱与角色边界」）、`docs/productnew/acceptance.md`（AC-63～AC-65）、`docs/productnew/modules/external-agents.md`（X-08 反向边界）与本页 P3-1 细则；不要让 README/安装指南提前宣称功能已落地。
     - **P3-1 代码实现结算时**：同步 `README.md`/`README.en.md`、`docs/install.md`/`install.en.md`、`docs/technicalnew/agents-and-tools.md`（G1）、`docs/technicalnew/runtime-contract.md`（R1 `session.get`/`session.stream.prepare` 的实时 sandbox 字段）、`docs/technicalnew/ui-design.md`（StatusBar/方法消费表）；删除“没有 OS 沙箱/审计不是沙箱”的当前状态表述，改为已实现状态与诚实边界。
     - `docs/technicalnew/prompts/chief.md`：说明只读沙箱会拒绝项目写、提交与历史改写，主管只做观察/运维，交付提交交 settler；`task(op=end)` 相关措辞同步。
     - `docs/technicalnew/prompts/designer.md`（第 110 行）：文档移动/删除改用普通 `mv`/`rm`（无需写 `.git/index`，Settler 提交时 Git 自动识别重命名）。
     - `docs/technicalnew/prompts/developer.md` & `prompts/tester.md`：补充通用、语言无关的隔离测试原则——轻量服务使用空闲临时端口 + `$TMPDIR` 独立数据目录；多服务/重依赖项目可使用独立命名的 Docker 容器并在测试结束后清理，严禁影响同机正在运行的服务或默认数据。
     - 提示词按进程缓存，改完必须重启工作台才对新会话生效；不要在没有重启证据时声称提示词已生效。
- **验证档与负向控制（`broad` — 涉及共享工具执行层与跨角色权限边界）**：
  - 新增 `kaiming/test/os-sandbox.test.ts`（**真实内核子进程测试，禁止 Mock 替跑**）：
    1. **隐私黑洞负向控制**：沙箱内分别用 `cat`、`node -e "fs.readFileSync(...)"`、符号链接跳转读取 `<privateDir>/models.json`、`state.db` 与工作台 `.env` → **全部必败**；读取 `<agentDir>/work/sample.txt` → **成功**；业务项目自身 `.env`（不是工作台加载的那份）→ **可读**；检查子进程 `env` 不含 `PI_SESSION_FILE`、访问口令与 provider key，`PATH`/`HOME`/`LANG`/`SSH_AUTH_SOCK` 等 allowlist 变量保留。
    2. **Chief 只读负向控制**：`read-only` 沙箱内 `touch <cwd>/evil.ts`、`sed -i`、`git commit`、`git reset --hard` → **内核必拒**；执行 `git status`、`ls`、写 `$TMPDIR/ok.txt` → **成功**；`auto` 下 `ssh`/`docker ps`/`lsof` 可用，`strict` 下 `docker ps` 被拒。
    3. **Developer/Designer/Tester 边界负向控制**：`workspace-write` 沙箱内写项目外宿主机路径、通过 `..`/符号链接越界、执行 `git commit`、写 `<cwd>/.git/hooks/pre-commit` → **内核必拒**；在 `<cwd>` 内写代码/测试产物、在 `$TMPDIR` 内新建临时 git 仓库并 commit、在 `<cwd>` 内跑 `git status`/`git diff` → **成功**；Tester 写 `dist`/`coverage` 成功。
    4. **Settler 边界负向控制**：`workspace-write-git` 沙箱内执行 `git add` + `git commit` → **成功**；但写 `<cwd>/.git/hooks/pre-commit` 或写项目外路径 → **内核必拒**。
    5. **探针与模式负向控制**：向 `probeSandbox` 注入未隔离的伪执行器 → 探针必须失败；删除后端或模拟探针失败时 `auto`/`strict` 均拒绝 `bash`；`off` 允许执行并显示保护关闭；`auto` 与 `strict` 的 Docker socket 差异有真实子进程证据。
    6. **主管门禁负向控制**：只读沙箱下 `git commit`/`reset --hard` 直接 `isError`，**不出现 interaction**；`off` 下同样命令仍发起确认；`Trust all` 后再试写仍被沙箱拒绝。
    7. **集成验证**：验证 `codemode` 嵌套调用 `bash` 同样受 OS 沙箱约束；验证 `registry.acquire` 在 `cwd` 或 `sandboxKey` 变化时重建实例；验证 `.env` 精确路径对 read/grep/bash 生效；运行 `npm --prefix kaiming run check:prompts` 通过；提示词重启后才生效的证据记录在结算。
    8. **实时可见性与前端**：切换 `KAIMING_SANDBOX` 后重启，未发消息的 `session.get`/`session.stream.prepare` 立即返回当前 `{mode, backend, active, reason}`；旧输入 `effectiveConfig.sandbox` 不冒充当前；webapp `typecheck`/`test`、`npm --prefix kaiming run build` 与一条浏览器检查验证 off/auto 徽标。

---

#### P3-2：按需 Task 级 Git Worktree 隔离与诚实合流门禁（`WP-Worktree`）

**状态**：实施中（2026-11-27）：v23 分配、Worktree 创建/ff-only/branch_kept、merged 回收、Artifact 相对路径、启动恢复、setup 沙箱、按 Task 文件读取和全局专业配额已落；重叠雷达、workspace.remove RPC、看板/FileViewer UI 仍待实施。

- **问题与根因**：
  1. 数据库层（`idx_tasks_one_open_per_chief` 与 `claimBacklogItems`）已支持同项目多主管会话各自推进一项 Task，但当前所有 Task 及其成员全部共享 `project.realPath` 与同一个 `.git/index`。并发写 Task 时，一方的改动会污染另一方的 `scopeCheck`、`snapshotDelivery` 与提交门禁。
  2. 现有代码存在多处隐含单工作树假设：`plan-store.ts:31` 与 `report-store.ts:38` 将 `planRef.path`/`bodyRef.path` 存为**绝对路径**（删除 Worktree 后历史报告永久 `REPORT_STALE`）；`completion-git.ts:23`、`task-tools.ts`、`delegation-tools.ts:139`、`read-methods.ts:537` 直接取 `chiefSession.cwd` 或 `project.realPath` 而非统一的 Task 工作目录；`rebindProject`（`store.ts:953`）会批量覆写所有会话 `cwd`。
- **修改文件与精确实现步骤**：
  1. **前置重构：路径权威统一与 ArtifactRef 相对化**：
     - **`kaiming/src/runtime/plan-store.ts` & `report-store.ts`**：`storage: 'project'` 的 `planRef.path` / `bodyRef.path` 改为存**项目相对路径**（如 `.dev/work/<taskId>/plan.md`），同时向下兼容读取历史绝对路径；新增统一解析器，按“若 Task 存在活动 Worktree 且文件在 Worktree 中则读 Worktree，否则读主工作区 `project.realPath`”解析，确保 Worktree 回收后历史 Plan 与报告在主工作区永久可读。
     - **单一 `resolveTaskCwd(store, task)`**：统一替换 `Store.requireTaskCwd`、`completion-git.ts:23`、`task-tools.ts`（`createOp`/`updateOp`/`getOp`/`endOp`）、`delegation-tools.ts:139`、`read-methods.ts:537` 中的目录来源。
     - **`store.ts` `rebindProject`**：重新绑定项目目录时，不覆盖仍处于活动 Worktree 状态的会话 `cwd`。
  2. **Schema 迁移 `v21 → v22`（`kaiming/src/store/store.ts`）**：
    - `tasks` 表新增列：`worktreeRoot TEXT`、`workspacePath TEXT`、`workspaceRelPath TEXT`、`branchName TEXT`、`baseCommit TEXT`、`workspaceState TEXT NOT NULL DEFAULT 'legacy'`（枚举：`legacy | in_place | provisioning | active | merged | branch_kept | removed`）。旧行 `legacy`，其余列为 `NULL`；`legacy` 等价原主工作区模式。新 Task 显式写 `in_place` 或 `provisioning`。局部唯一索引 `idx_tasks_one_inplace_per_project ON tasks(projectId) WHERE type = 'write' AND workspaceState = 'in_place' AND status NOT IN ('completed', 'cancelled')`；旧 `legacy` 不计入索引。若迁移发现同项目有多个未结束 write Task，全部保留 `legacy`，新 Task 不得再选 `in_place`，直至旧任务终态。
  3. **新增 `kaiming/src/runtime/worktree.ts`（按需创建、可选钩子、诚实合流与清理）**：
     - **按需触发策略（拒绝一刀切）**：
      - 同项目当前无其他未结束 `write Task`，且未显式指定 `isolatedWorkspace: true` → 默认 **`in_place`**。
      - 同项目已有未结束 `write Task`（含 `legacy`/`in_place`/`provisioning`/`active`），或显式 `isolatedWorkspace: true`，且项目是可读 Git 仓库并有有效 `HEAD` → 在项目级事务/锁内分配 **`provisioning`** 并创建 Worktree。非 Git、无有效 `HEAD`、read Task 不建 Worktree；非 Git 项目的第二个 write Task 必须明确拒绝或要求串行，绝不静默回落 `in_place`。显式 `isolatedWorkspace: true` 遇到非 Git/无 `HEAD` 时返回 `WORKSPACE_UNSUPPORTED`，不得以 `in_place` 代替。
     - **存放位置与文件边界**：
      - Worktree 建在仓库外的独立宿主根：默认 `~/.kaiming-worktrees/<projectId>/<taskId>`，支持 `KAIMING_WORKTREE_ROOT` 覆盖。根和最终路径必须 realpath 校验：禁止落在 `dataDir`、`project.realPath`、任一 `.git` 内；根目录 `0700`，拒绝相对路径和符号链接。
      - `worktreeRoot` 是 `git worktree add/remove` 的仓库根；`workspacePath` 是项目在 Worktree 内的实际目录（Monorepo 为 `worktreeRoot/<relSubdir>`）；`workspaceRelPath` 保留 relSubdir，供 Worktree 回收后的 `git show` 使用。分支名为 `kaiming/<taskId>`，`baseCommit` 为创建时 HEAD。
       - 该 Task 的成员与活动上下文将 `createFileBoundaryGuard` 的 `projectRoot` 收紧到 `task.workspacePath`（保证 Pi 原生 `write`/`edit` 同样无法写穿主工作区或兄弟 Worktree）。
     - **依赖准备（禁止软链，简单可控）**：
       - **严禁**软链 `node_modules` 或 `.venv`；
      - 可选 `.dev/worktree-setup.sh` 必须由 P3-1 `workspace-write` 沙箱执行：cwd = `workspacePath`，共享 `privatePaths`、env allowlist、`.git` 只读和 auto/strict fail-closed；禁止宿主裸跑。只显式允许 `KAIMING_MAIN_WORKTREE`（之后同理允许 `KAIMING_TASK_ID`/`KAIMING_WORKSPACE_SLOT`），**禁止 `KAIMING_*` 通配**，避免泄露 `KAIMING_TOKEN`/`KAIMING_ENV_FILE`。`KAIMING_SANDBOX=off` 时默认拒绝自动执行；超时、非零退出、输出超限按 provisioning 失败清理。主工作区可读不可写（项目自身 `.env` 可读，工作台私有 `.env` 仍不可读）。
    - **`.dev/backlog.md` 一致性**：
      - 创建 Worktree 前要求主工作区 `.dev/backlog.md` 已跟踪且干净；不存在且本次 `backlogIds` 为空时允许创建。用 `git status --porcelain -- .dev/backlog.md` 检查，不能只依赖 `git diff`。
      - `git worktree add` 后比较主工作区与 Worktree 中该文件的 SHA-256；两边都缺失视为一致，不一致立即判 provisioning 失败并清理。不复制未提交 backlog。两个 Worktree 通过 `claimBacklogItems` 领取不同条目；合流时 backlog 冲突走诚实门禁。
    - **诚实合流门禁（`task(op=end)`）**：
      - 先在 Worktree 内核对 `deliveryCommitGaps` 全部已提交、`taskCompletionGaps` 无缺项，并确认 Plan 与全部 `storage='project'` 报告已进入 `kaiming/<taskId>` 分支。
      - 在项目级合流锁下检查主工作区目标分支：
        1. **主分支未移动（`main HEAD === task.baseCommit`）且主工作区干净且位于目标分支**：执行 `git merge --ff-only kaiming/<taskId>`（不产生 merge commit）→ `store.endTask` 标记 `completed` + `workspaceState='merged'` → 回收 Worktree 并删除分支；
        2. **主分支已移动**：**拒绝自动 rebase**，返回 `COMPLETION_INCOMPLETE` 并指出主分支已前移；在 Worktree 内 rebase 最新主分支并按 D-08/G3 重新验证组合成果后再收口；
        3. **主工作区脏、切在其他分支，或用户选择保留分支**：**绝不碰用户主工作区**；以 `workspaceState='branch_kept'` 收口，保留 `kaiming/<taskId>`、`branchName`、`workspaceRelPath`、`baseCommit`，给出合并指令。Plan/报告按「活动 Worktree 磁盘 → 主工作区磁盘 → `git show <branch>:<workspaceRelPath>/<relPath>`」三级解析，`git show` 结果仍对 SHA-256 核对；分支被删除才如实报缺失。
    - **取消、回收与恢复**：
      - `task(op=control, command='cancel')` 严格遵守 D-06 保留 Worktree 现场。
      - `task.workspace.remove(projectId, taskId, expectedRevision)` 仅允许终态：`merged` 可回收 Worktree 并删已合入分支；`branch_kept` 默认只回收 Worktree、**保留分支**，`workspaceState` 仍为 `branch_kept`，保留 `branchName`/`workspaceRelPath`/`baseCommit` 供 `git show`；`cancelled` 的 `active` 残留允许显式回收，默认只删 Worktree、保留未合入分支并置 `workspaceState='removed'`（`branchName`/`workspaceRelPath`/`baseCommit` 保留）；不强制删除有未提交文件或被 Git 拒绝的 Worktree。
      - `scanStartup` 扫描 `provisioning` 和 `active` 的缺失/半创建记录，以及仓库根下无 Task 行对应的孤儿目录：清理半成品、必要时标 `cancelled`，释放 `sessions.currentTaskId` 与 backlog 认领，并上报真实残留。
    - **provisioning 失败与崩溃**：
      - `task(op=create)` 内任一步失败（`git worktree add`、setup、Plan 写入）：在返回错误前清理 Worktree/分支/Plan，删除刚插入的 provisioning Task 行，释放 `sessions.currentTaskId` 与 backlog 认领；清理本身失败也必须保证 Task 不再占坑，并保留真实残留证据。
      - 进程中途崩溃：`scanStartup` 处理 `provisioning` 和孤儿目录，清理半成品、标 `cancelled` 并释放绑定；重复启动必须幂等。
      - 状态迁移使用 revision/ownerEpoch CAS；不删除其他 Task 或其他进程拥有的目录。
- **契约同步**：更新 `docs/technicalnew/storage-and-recovery.md`（S2 `v21 → v22`、S5/S6/S7）、`docs/technicalnew/agents-and-tools.md`（G2/G3）、`docs/technicalnew/runtime-contract.md`（R1 新增 `task.workspace.remove`）。
- **验证档与负向控制（`broad` — 涉及 DB v22 迁移、交付路径解析与 Git 合流门禁）**：
  - `test/worktree.test.ts` & `test/git-commit-gate.test.ts`：
    1. **正向并行**：同项目两主管会话同时启动两个 `write Task` → 第 1 个 `in_place`、第 2 个自动创建外部 Worktree；两者互不污染 `scopeCheck` 与 `deliveryState`；主分支未动且干净时 `task(op=end)` 自动 `ff-only` 合入并回收目录，回收后 `task.get(includePlan: true)` 与 `task.report.get` 仍完整可读。
    2. **负向控制 1（防未经复核的静默 rebase）**：Task A 先合入推进 `main` 后，Task B 调用 `task(op=end)` 必须返回 `COMPLETION_INCOMPLETE`（拒绝自动 rebase）。
    3. **负向控制 2（保护脏主工作区）**：主工作区存在用户未提交脏文件时，Worktree Task 调用 `task(op=end)` 绝不覆盖或破坏主工作区文件；支持 `branch_kept` 安全收口。
    4. **负向控制 3（文件边界隔离）**：Worktree 成员尝试用 `write`/`edit` 修改主工作区或兄弟 Worktree 路径，必须被 `createFileBoundaryGuard` 拒绝。
    5. **负向控制 4（取消不删现场）**：`cancel` 后 Worktree 文件与报告保留；仅在终态调用 `task.workspace.remove` 才允许清理，运行中 Task 调 `task.workspace.remove` 必须拒绝。
    6. **旧库兼容**：用真实 v21 快照迁移；同项目多个未结束 write Task 全部保留 `legacy`，新 Task 不得再选 `in_place`；旧绝对 Plan/报告仍可读。
    7. **Monorepo**：项目是 Git 子目录时，`worktreeRoot` 与 `workspacePath` 分离；`git worktree add/remove` 用仓库根，`resolveTaskCwd`/文件边界用项目子目录。
    8. **provisioning 负向控制**：Worktree 创建、setup、Plan 写任一步失败都不留 Task/占坑；模拟崩溃后 `scanStartup` 幂等清理并释放 backlog。
    9. **backlog 一致性**：不存在且无 backlogIds 可创建；未跟踪/未提交/创建期变化一律失败；`git worktree add` 后 hash 不一致失败。
    10. **setup 沙箱与 branch_kept**：setup 在 workspace-write 沙箱执行，`KAIMING_MAIN_WORKTREE` 显式允许且 `KAIMING_*` 不通配；`branch_kept` 回收 Worktree 后 Plan/全部项目报告经 `git show` 可读且 hash 通过。

---

#### P3-3：多任务并发护栏、Worktree 实时文件视图与看板感知（`WP-Parallel`）

**状态**：定版（2026-11-27），待实施（P3-2 之后实施）。

- **问题与根因**：
  1. 架构文档 A4/S3 声明了“限制同时运行的专业 Session 数量”，但 `src/server/worker.ts`（第 67～74 行）与 `src/tools/delegation-tools.ts`（第 435～446 行）实际并无并发上限，且两条路径会并发拉起同一 `sessionId` 的 `runNext`。多任务并行时易瞬间拉爆本机 CPU/内存或触发模型网关 429 限流。
  2. `src/server/read-methods.ts`（第 758～839 行）的 `project.files.list`/`read` 只读 `project.realPath`，不支持查看活动 Worktree 里的实时新增/修改文件；前端看板也尚未展示多任务各自的隔离分支与跨任务范围重叠提示。
- **修改文件与精确实现步骤**：
  1. **非阻塞专业 Session 并发配额（`kaiming/src/server/worker.ts`、`kaiming/src/runtime/runner.ts`、`kaiming/src/tools/delegation-tools.ts`）**：
     - 新增配置项 `KAIMING_MAX_CONCURRENT_SPECIALISTS`（默认 `4`；Chief 与 `investigator(expectedKind='recovery')` 不占配额）。升级说明必须把默认 `4` 列为行为变化；`0` 仅作为显式关闭上限的运维选择，不改变默认值。
     - 消除 `delegation-tools.ts` 直接调 `runNext` 与 `worker.ts` 唤醒调 `runNext` 的双路径竞争（统一经单一调度口或按 `sessionId` 去重）；
     - **关键时序**：在 `claimNextInput` **之前**执行非阻塞名额检查——无可用槽位时直接返回 `{ kind: 'throttled' }`，让该输入保持 `queued`（绝不先标 `processing` 挂起）；当任一运行中成员结束、或进入 `waiting_user` 等待用户交互时释放/让出名额并触发 `worker.notify()`，防止等待用户的成员把全局配额占死导致死锁。
  2. **跨任务范围重叠雷达（`kaiming/src/tools/delegation-tools.ts` & `task-tools.ts`）**：
     - 在 `task(op=create / update / dispatch)` 时，除现有同步骤成员 `overlapWarnings` 外，额外比对同项目其他活动 `write Task` 的 Plan 声明范围与 `changedProjectPaths(otherTaskCwd)`，存在交集时返回 `crossTaskOverlapWarning`（列出冲突 `taskId`、主管会话标题与路径），不拦截，由主管与用户提前知情。
  3. **Worktree 实时文件读取与前端看板感知**：
     - **`kaiming/src/server/read-methods.ts`**：`project.files.list` / `project.files.read` 增加可选 `taskId` 参数（校验该 Task 属于当前 `projectId`），传入时读取 `resolveTaskCwd(store, task)` 下的实时文件，使 `FileViewer` 与 MCP 在任务进行中即可查看 Worktree 改动。
     - **约定环境变量**：为活动 Worktree 会话在 `bash` 环境中注入 `KAIMING_TASK_ID` 与 `KAIMING_WORKSPACE_SLOT`（小整数槽位，供项目按需选用，不作为通用端口隔离承诺）。
     - **前端（`kaiming/webapp/src/chat/SessionsList.tsx` & `/project` 看板）**：进行中 Task 卡片显示所属隔离分支/Worktree 状态（`in_place` / `⎇ kaiming/t-xxx` / `branch_kept`）、跨任务范围重叠提示、以及“清理残留 Worktree”操作入口（终态且未清理时）和主管会话跳转；点击进行中 Task 报告里的代码链接时 `FileViewer` 透传 `taskId`。
- **契约同步**：更新 `docs/technicalnew/runtime-contract.md`（R1 `project.files.*` 可选 `taskId`）、`docs/technicalnew/storage-and-recovery.md`（S3 并发配额与 `waiting_user` 让槽语义）、`docs/technicalnew/ui-design.md`（U9 方法消费表）；注意外部 MCP 接入保持 [X-02](../productnew/modules/external-agents.md#x-02-每个项目一条固定会话) 单固定会话语义不变。
- **验证档与负向控制**：P3-3a（统一调度口、全局配额、`waiting_user`）为 `broad`（共享调度层）；P3-3b（重叠雷达、`project.files.* taskId`、看板/FileViewer）为 `focused`。
  - `test/parallel-quota.test.ts` & `test/server-read.test.ts`：
    1. **配额负向控制**：设置 `KAIMING_MAX_CONCURRENT_SPECIALISTS = 2` 同时派发 4 个专业成员 → 任意时刻 `processing` 严格 ≤ 2，其余保持 `queued`（绝不提前变 `processing`），且前 2 个完成后自动唤醒后 2 个全部完成。
    2. **防死锁负向控制**：前 2 个成员全部进入 `waiting_user` 时，第 3 个成员或 `recovery` 调查仍可被正常认领执行，不发生死锁。
    3. **跨任务重叠与越权读负向控制**：两并行 Task 修改同一文件路径时返回 `crossTaskOverlapWarning`；`project.files.read` 传入其他项目的 `taskId` 必须返回 `NOT_FOUND`。

#### P3-2/P3-3 兼容与升级边界

- **旧数据可升级**：v21→v22 只加列/索引；旧 Task 保持 `legacy` 主工作区模式，旧绝对 Plan/报告路径继续可读。迁移前备份数据库，迁移重复执行幂等。
- **旧库多 Task**：同项目已有多个未结束 write Task 时全部保留 `legacy`，不能事后补 Worktree；新 Task 不得再选 `in_place`，直到旧任务终态。
- **旧程序不可回读**：旧程序打开 v22 会因版本过高拒绝启动；回滚只能恢复升级前备份。新写入的项目相对 Plan/报告也不能由旧程序读取。
- **旧 API/MCP**：新增参数与字段均可选/增量；旧调用不需要改变；单主 Task 项目仍走 `in_place`，不自动创建分支或目录。
- **行为变化**：非 Git 项目的第二个并发 write Task 明确拒绝或要求串行；P3-3 默认并发配额固定为 `4`，升级说明必须声明该行为变化；`0` 只是显式关闭上限，不是默认值。

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
