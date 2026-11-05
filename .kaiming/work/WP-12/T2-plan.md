# WP-12 T2 实施计划：消息 → Chief 模型评估 → DispatchSpec → Requirement/Work/Plan → queued Run → Supervisor spawn → 阶段结果回看板（无播种）

- 状态：Planning（待用户对「待决问题」表态）
- 上级依据：`.agentdev/work/WP-12/plan.md` §4 T2 行、§2 DoD 第 4 条、§3 D3/D4/D5；`docs/architecture/protocol.md` §6/§7；`docs/architecture/execution.md` §2/§4；`docs/product/requirements.md` §3；`docs/product/PRODUCT.md` §3/§5；`docs/rules/workflow.md` §1–§3；`docs/rules/agents.md` §1–§5。
- 约束：不改 `packages/**`、`apps/**`、`scripts/**`、`docs/**`；本文件是唯一写入目标。不改交付/产品文档，不新增第 11 条契约命令，不新增依赖。

---

## 1. 现状证据（逐条核对代码，含修正）

| # | 事实 | 证据（file:line） |
|---|---|---|
| E1 | `Orchestrator.assess()` 存在但**全仓无生产调用方**。`grep -rn "new Orchestrator(" packages apps` 只有 `packages/core/test/join.test.ts:137`、`packages/core/test/orchestrator.test.ts:348`；`packages/core/src/index.ts:28` 只是再导出。 | `packages/core/src/orchestrator.ts:245`（`assess`）、`packages/core/src/index.ts:28` |
| E2 | daemon 从未构造 `Orchestrator`：`apps/daemon/src/bootstrap.ts:191-232` 构造 gates/findings/decisions/requirements/requirementSaves 并注入 `WorkbenchProtocol`，没有 orchestrator 字段；`apps/daemon/src/protocol.ts:88-120`（`WorkbenchServices` 无 orchestrator）。**修正**：不只是「没有调用方」，是**整个 daemon 里没有 Orchestrator 实例**，也没有把它接进协议服务的通道。 | `apps/daemon/src/bootstrap.ts:191-232`；`apps/daemon/src/protocol.ts:88-120` |
| E3 | `conversation.message.send` 同步走 `sendMessage`，用本地确定性路由 `routeMessage` 分类，只写入一条 assessment 行；注释自认 intent 应来自 Chief 评估。 | `apps/daemon/src/protocol.ts:1557-1638`（`sendMessageCommand`）；`packages/core/src/messages.ts:81`（`sendMessage`）、`packages/core/src/messages.ts:136`（`routeMessage`）、`packages/core/src/messages.ts:212-224`（写 assessment 行）、`packages/core/src/messages.ts:416`（注释） |
| E4 | 协议契约是**同步**：`dispatchEnvelope` 显式拒绝 Promise 结果；`handleRpc` 直接返回其返回值。因此 Chief 评估不能内联调用模型，必须变成 queued Run。 | `apps/daemon/src/protocol.ts:469-486`（"a command that returned a Promise would be a Core contract break"）、`apps/daemon/src/protocol.ts:447-467` |
| E5 | WP-11 执行栈已就绪且可复用：`createProjectExecution` 组装 supervisor + capability gateway + 真实 secret 解析；daemon 侧 `createPrepareRun`/`createChildRunnerSpawnPort` 注入；daemon `main.ts` 已为每个项目建栈并 `execution.start(...)`；30s lease、park/resume、心跳、lost 判定都在 supervisor 内。 | `packages/core/src/execution.ts:150-215`；`apps/daemon/src/prepare-run.ts:56-93`；`apps/daemon/src/runner-spawn.ts:186-214`；`apps/daemon/src/main.ts:334-372`；`packages/core/src/supervisor.ts:521-597`（claim/queued）、`:613-670`（spawnRun）、`:365-420`（resumeParkedRun）、`:443-470`（sweep 心跳超时） |
| E6 | **Runner 从不回传结构化结果，模型正文也没被 Core 保留**：`attempt.result` 只带 `status`+`message`；`attempt.event` 在 supervisor 里被显式丢弃（注释说转发是 daemon 的活，但 daemon 侧没有实现）。模型输出只以 `text_delta` 片段形式出现。 | `packages/contracts/src/runner-ipc.ts:62-70`（`attempt.result`）、`packages/pi-runtime/src/events.ts:14-25`（`text_delta`）、`packages/core/src/supervisor.ts:716-720`（`attempt.event` 直接 `return`） |
| E7 | `StageGate.submit`（`stage.submit` 契约）**无任何调用方**，`stageResults` 表只在读取侧出现；`stage.completed/stage.failed` 事件因此从未产生。 | `packages/core/src/stage.ts:111-235`（`submit`）；`grep -rn "StageGate" packages apps` 仅 `packages/core/src/orchestrator.ts:69` 注释；读取侧 `apps/daemon/src/protocol.ts:1306`、`packages/core/src/join.ts:89`、`packages/core/src/events-hub.ts:457` |
| E8 | `plan.approve` 只记录 gate 批准，**不产生任何 Run**；`plan.current` 只读 gate 记录与 artifact。 | `apps/daemon/src/protocol.ts:2344-2410`（`approvePlan`）；`packages/core/src/gates.ts:563`（`submitPlan`，无 run 副作用）；`apps/daemon/src/protocol.ts:2197-2307`（`currentPlan`） |
| E9 | 看板只渲染**已保存的 Requirement**，并按 `requirement.lifecycle` 分列；`level=none/L1` 的 Work 被排除在看板外。因此「Requirement 落库」是看板可见的必要条件。 | `apps/daemon/src/protocol.ts:1135-1197`（`board()`，含 `excludedWorkIds`）；`apps/daemon/src/protocol.ts:1143-1182` |
| E10 | L2 的授权来自**消息自身**：`routeMessage` 只有识别到带路径的命令（`explicitAuthorization`）才让 `sendMessage` 建 authorization 并把 Work 置为 L1/L2；纯自然语言「实现某功能」不产生 authorization，也不建 Requirement。 | `packages/domain/src/requests.ts:447-585`（`routeMessage` 尾部判定）、`packages/core/src/messages.ts:160-206` |
| E11 | `Orchestrator.assess()` **不更新 `work.level`**；而 `dispatch()` 的写权限判定读 `work.level`。若消息路由为 `none` 而评估判为 L2，dispatch 必被 `NOT_AUTHORIZED` 拒绝。 | `packages/core/src/orchestrator.ts:245-345`（无 works.update）、`packages/core/src/orchestrator.ts:386-408` |
| E12 | 现有 live/e2e 演练**直接播种行**绕过全链：e2e 运行检查直接 `works.insert`+`runs.insert`；live 运行演练同样 seed Work/Run/Grant；live L2 演练 seed Requirement 投影。 | `scripts/e2e.mjs:2377-2416`、`scripts/e2e.mjs:2493-2529`（`seedWork`）；`scripts/lib/live-drills.mjs:1500-1583`（`seedWork`/`queueRun`）；`scripts/lib/live-drills.mjs:764-790`（seed Requirement 投影） |
| E13 | live 栈（`bootLiveStack`）只起 daemon+BFF，**不起 supervisor**；只有 `runRuntimeAttemptDrill` 单独 `createProjectExecution`。 | `scripts/lib/live-harness.mjs:400-460`（daemon/BFF）；`scripts/lib/live-drills.mjs:1478-1493`（drill 内建 execution） |
| E14 | 文档与代码的既定偏差（非 T2 引入，但 T2 必须表态）：`execution.md:53` 声明 Chief 拥有 `assessment_submit`/`agent_dispatch`/`decision_request` 工具，而 Runner 的内置工具表为**空**，`toolSubset` 由冻结 profile 直接透传；`protocol.md:124` 的 `stage_yield → stage.submit` 因此不可能发生。 | `docs/architecture/execution.md:53`；`docs/architecture/protocol.md:124`；`apps/runner/src/cli.ts:85`（`BUILTIN_TOOLS = []`）、`apps/daemon/src/prepare-run.ts:87` |
| E15 | `attempt.result` 的终态由 supervisor 直接 `lifecycle.settle` 落地；`run.queued`/`run.started`/`run.ended`、`assessment.saved`、`work.control_changed` 事件名与 `protocol.md` §7 一致，EventHub 会广播。 | `packages/core/src/supervisor.ts:745-790`；`packages/core/src/run-lifecycle.ts:139-160`、`:291`、`:391`；`packages/core/src/orchestrator.ts:328`、`:534` |

**核对结论**：任务书给定的四条「既定事实」全部成立，其中 E2/E6/E7 需要按上表加强表述——真正的断点是「daemon 无 Orchestrator 实例」「模型正文没有回到 Core」「阶段结果没有落库」，而不只是「`assess()` 没有调用方」。

---

## 2. 目标（T2 的可验收定义）

用户在一个真实 Git 项目里发一条 L2 交付消息后，**不播种任何行**即可得到：

1. 同步返回 `{messageId, workId, state:'received'}`，且事务内已经生成一个 **Chief 评估 Run（queued）**；
2. supervisor 在下一个 tick 领取该 Run → 真实 Runner 子进程 → Core capability gateway → 真实/桩 Provider；`run.queued`/`run.started`/`run.ended`、`assessment.saved` 事件有序可观察；
3. Chief 的模型输出被 Core 取回、校验为 `DispatchSpec`，经 `Orchestrator.dispatch()` 冻结 snapshot 后成为 **专业 Run（queued）**；无效输出最多重问一次，第二次判 `contract_violation`；
4. 同一 Work 上出现**真实 Requirement**（Git 记录 + 投影行，`lifecycle=active`、`phase=plan`）与真实 Plan gate 记录；看板 `/board` 的 `active` 列能看到该卡；
5. 专业 Run 完成后有一条真实 `stage_result` 行与 `stage.completed`/`stage.failed` 事件，可经 `run.get` 与 `work.get` 读回；
6. 全链每个 Run 都有 operationId/幂等键可用，重复发送同一 `idempotencyKey` 不产生第二个 Chief Run。

---

## 3. 决定与待决问题

### 3.1 本计划内的实现决定（不改产品行为，属「接线」）

- **D-T2-1（同步边界）**：`conversation.message.send` 仍在事务内**只建 queued Run**，模型调用全部交给 supervisor；协议层保持同步，`dispatchEnvelope` 的 Promise 断言不变（`apps/daemon/src/protocol.ts:478-483`）。
- **D-T2-2（Chief Run 的规格）**：Chief 评估 Run 必须是 `ChiefDispatchSpec`（`kind:'chief'`、`role:'chief'`、`purpose∈{analysis,artifact}`、`stage∈{assist,coordinate}`），由 Core 用消息/Work 事实构造，不接受模型提供。依据：`data.md:78`「ChiefDispatchSpec仅由Core根据用户消息或chief_action_required事件构建」；schema `packages/contracts/src/entities/structures.ts:211-224`。L2/L3 用 `purpose:'analysis'`、`stage:'coordinate'`；assist/artifact/文档/只读用 `stage:'assist'`。
- **D-T2-3（输入载荷）**：Chief Run 的 `contextSelection`/`goal` 由 Core 冻结：`goal=work.goal`，`sourceRefs=[{kind:'message',id:messageId,version:'1'}]`，`codePaths` 取消息命名路径（无则空），`readBudget` 用文档默认（`agents.md` §6：启动 24000/追加 16000）。实现可复用 `Orchestrator.dispatch` 的 `contextPayload` 入参（`packages/core/src/orchestrator.ts:63-74`）。
- **D-T2-4（level 落库）**：`assess()` 在同一事务内把 `work.level`（必要时还有 `work.scope`）更新为评估结论，否则 L2 的 dispatch 必然 `NOT_AUTHORIZED`（E11）。这是补齐既有实现的缺口，不改变等级规则本身（`docs/rules/workflow.md` §2 的判定顺序不变）。
- **D-T2-5（模型输出取回）**：**不改 Runner、不新增 IPC 字段**。supervisor 在 `attempt.event` 分支累积 `text_delta`（`packages/pi-runtime/src/events.ts:20`），Run 终结时通过一个新增的 supervisor 回调把「final text + attempt + run」交给 daemon 侧；这样 T3 的工具桥落地前也能端到端跑通，且与 `protocol.md` §7「token.delta 为临时流、最终消息落 Artifact」的精神一致。**代价**：Chief 的 DispatchSpec 以「JSON 文本 + 解析」取得，而非 `execution.md:53` 的 `assessment_submit` 工具（见 Q2）。
- **D-T2-6（评估产物的持久化形态）**：解析出的 JSON 先经 `dispatchSpecSchema` 校验，再由 Core 覆盖服务端字段（`workId`、`profileRevision=gateway.availability(role).resolution.revision`、`budgetAllocation` 上限），再调 `Orchestrator.assess()` + `Orchestrator.dispatch()`。评估原文同时写入 `artifact_write`（kind=`explanation`）作为可复验证据，不要求模型自己产出 artifact 引用。
- **D-T2-7（Requirement/Plan 落库）**：Chief 评估输出携带 requirement 草稿（title/goal/scope/acceptance/contentMarkdown 六段式，见 `packages/core/src/requirement-save.ts:112-117`）；Core 调 `RequirementSaveService.save`（`workId` 绑定，`apps/daemon/src/protocol.ts:2089-2099` 同路径）并置 `lifecycle='active'`、`phase='plan'`。Plan 由随后的 Planning Run 走既有 `plan.approve`（不新增入口）。
- **D-T2-8（阶段结果）**：从 `attempt.result` + 累积文本派生一条 `stageResults` 行并追加 `stage.completed`/`stage.failed`（复用 `StageGate.submit` 的字段与事件语义，`packages/core/src/stage.ts:111-235`），而不是让 Runner 说话。这同时闭合 WP-11 已登记的遗留项「结果正文不落 `stage_result`」（`.agentdev/work/WP-11/test.md:321`，WP11R1-15/WP11R2-06）。
- **D-T2-9（无新增契约命令）**：全部新增代码只改 Core 内部 API 与 daemon 注入路径；`pnpm` 十条脚本、`docs/delivery/implementation.md` §3、`docs/product/*` 不动（D4/D5）。

### 3.2 需要用户决定的问题（本计划不自行裁定）

- **Q1｜L2 消息必须显式命名路径才能获得授权吗？**
  - 现状：只有 `routeMessage` 识别到带路径命令才产生 authorization（E10）；「实现暗色主题」这类纯自然语言 L2 消息会因 `work.authorizationRef` 缺失而在 `dispatch` 处 `NOT_AUTHORIZED`。
  - 选项 A（保持现状）：L2 首条消息必须点名目标路径；DoD 第 4 条的演示话术写成「请修改 src/…」。
  - 选项 B（按文档语义扩展）：让 Chief 评估结论（scope+operations）经用户同一条执行指令生成 authorization；依据是 `docs/product/PRODUCT.md:5`「明确的自然语言执行指令与按钮授权等价」。这会**新增产品行为**，触碰 D5。
  - 推荐：**A（本 T2 采用）**，B 单独立项走产品确认。理由：T2 只做接线；B 会改动授权语义与 L3 门禁的对齐关系，需要独立 Review 与产品确认。
- **Q2｜Chief 的 DispatchSpec 以什么通道提交 Core？**
  - 选项 A（本计划）：模型回 JSON 文本，Core 解析校验（D-T2-5）。
  - 选项 B（文档形状）：实现 `assessment_submit`/`agent_dispatch` Chief 工具 + Runner→Core 的 capability 回调，与 `execution.md:53` 一致。
  - 推荐：**T2 用 A，B 记为 T3/后续包的显式条目**。理由：B 需要新的 Runner 工具桥与 capability 方法面，正是 T3 的范围；A 让 T2 在无工具桥的情况下可真实运行，且 live 演练已有同构 JSON 约定（`scripts/lib/live-drills.mjs:81` `extractJsonObject`）。
- **Q3｜`plan.approve` 之后由谁产生执行的 queued Run？**
  - 文档：`workflow.md` §3「L2/L3 各阶段由 Chief 独立触发」；`experience.md:49` 要求卡片显示 Plan/Task 进度。
  - 选项 A：Core 在 `plan.approve` 通过 gate 后直接为 requirement 的 active Work 建专业 Run（确定性、可测、无额外调度延迟）。
  - 选项 B：保持 Chief 驱动——批准后由 Chief Run（经 `chief_action_required` 或轮询 `plan.current`）再 dispatch（更贴文档措辞，但需要一套新的唤醒/轮询机制）。
  - 推荐：**A**，并在 `plan.approve` 的响应里返回 `runId`。理由：`plan.current` 已经是 UI 唯一权威（`protocol.md` §4），且 B 需要额外的持久唤醒语义（当前 `chief_action_required` 只由 `request_dispatch` 产生）。若用户选 B，T2 需增加「Plan 批准事件→Chief 再规划 Run」的条目。
- **Q4（记录，不阻塞）**：`docs/product/experience.md:22` 要求消息有 `received/processing/processed` 状态迁移，但当前只有 `received`（`packages/core/src/messages.ts:246-256`）。T2 至少要在评估 Run 领取时置 `processing`、终态置 `processed/failed`；若用户认为超出 T2，可推迟到 T4 并在 T2 记录为已知缺口。

---

## 4. 任务分解（7 个子任务，每个可独立 Review）

> 顺序执行；T2.1/T2.2 是其余任务的前置。每个子任务的「退出条件」都要用**当次运行**的真实命令输出支撑。

### T2.1 Core 接入 daemon：Orchestrator 实例与协议注入
- 内容：`createProjectExecution` 暴露 `orchestrator`（与 `gateway` 同栈、共用 `SecretContext` 与 `RunLifecycle`，`packages/core/src/execution.ts:150-215`）；`apps/daemon/src/main.ts` 在建栈后像 `attachRunRecovery`（`apps/daemon/src/main.ts:357-361`）一样把它注入协议；`WorkbenchProtocol` 增加可选 `orchestrator` 字段并在缺失时给出明确拒绝（不是静默 no-op）。
- 退出条件：`Orchestrator` 在 daemon 进程中真实存在且被注入；`packages/core` 不新增对 `apps/*` 的依赖；typecheck/lint 通过。
- 证明测试：`apps/daemon/test/runtime.integration.test.ts` 增加断言「栈存在且协议已接 orchestrator」；`packages/core/test/execution.test.ts`（新增）验证 `createProjectExecution` 暴露的 orchestrator 使用同一 lifecycle/store。

### T2.2 Orchestrator：评估落库与 level 生效
- 内容：`assess()` 在写 assessment 行的事务内同步更新 `work.level`（D-T2-4）；新增 `assessAndDispatch` 形态的内部 API：接受 Chief 评估产物（payload + DispatchSpec 草稿），完成解析→校验→覆盖服务端字段（`workId`/`profileRevision`/`budgetAllocation`）→`assess()`→`dispatch()`；`profileRevision` 由 `gateway.availability(role)` 注入（`packages/core/src/orchestrator.ts:225-233`）。
- 退出条件：对一个 `level='none'` 的 Work 提交 L2 评估后 `work.level==='L2'`，随后的 chief/professional dispatch 成功；非法 DispatchSpec 返回 `VALIDATION_ERROR` 且不留下 snapshot/Run 行。
- 证明测试：`packages/core/test/orchestrator.test.ts` 扩充（level 提升、`profileRevision` 注入、非法 spec 无残留）；`packages/core/test/orchestrator.integration.test.ts`（新增）断言事务原子性。

### T2.3 Supervisor：模型正文累积 + 终态回调
- 内容：`LiveAttempt` 增加文本缓冲，`attempt.event` 分支处理 `text_delta`（`packages/core/src/supervisor.ts:716-720`）；新增构造选项 `onAttemptResult?(input)`，在 `finishFromResult` 落到 `lifecycle.settle` 之前调用（`packages/core/src/supervisor.ts:745-790`）；回调抛错只记日志、不改变既有 park/settle 语义（沿用 `guarded` 模式 `:474-484`）。
- 退出条件：用一个写死 `text_delta` 的假 Runner 端口，supervisor 能把完整文本与 attempt/run 交给回调；不改变现有 `supervisor.test.ts` 的全部语义。
- 证明测试：`packages/core/test/supervisor.test.ts` 新增两个用例（文本累积顺序、回调异常不影响 settle）；`packages/core/test/supervisor.integration.test.ts`（新增）验证真实子进程路径也能取回文本。

### T2.4 daemon：消息 → Chief 评估 Run（无播种）
- 内容：`sendMessageCommand` 在事务内、`message.received` 之后，用 `Orchestrator` 为本次 Work 建 Chief 评估 Run（D-T2-2/D-T2-3），把 `messageId` 写进上下文；L1/assist 走同一路径（`stage='assist'`，只评估不派发专业 Run）；幂等键已有账本保证（`apps/daemon/src/protocol.ts:1574-1585`），需把「Chief Run」纳入同一幂等语义（重放返回原 `messageId`，不产生第二个 Run）。同时按 Q4 处理消息状态迁移。
- 退出条件：集成测试中，仅通过 `conversation.message.send` 就在 store 里看到 `runs`（role=chief、status=queued、dispatchSnapshotId 非空）与 `assessment.saved`；无任何 `insert` 播种。
- 证明测试：`apps/daemon/test/assessment-dispatch.integration.test.ts`（新增，见 §5）。

### T2.5 daemon：Chief 结果 → DispatchSpec 校验持久化 → Requirement → 专业 Run
- 内容：用 T2.3 的回调装配一个「Chief 结果处理器」：取回文本→`extractJsonObject`→校验为 DispatchSpec+requirement 草稿→`RequirementSaveService.save`（workId 绑定、`lifecycle='active'`、`phase='plan'`）→`Orchestrator.assess/dispatch` 建专业 Run；失败路径两次判 `contract_violation`（沿用 `StageGate.reject` 的两振规则，`packages/core/src/stage.ts:219-260`）；同一处理器在 professional Run 完成时按 D-T2-8 落 `stage_result` + `stage.completed/failed`。
- 退出条件：集成测试断言 `requirements`（active/plan、workId 绑定）、`works.update`、专业 `runs`(queued) 三者在同一次消息后出现；`run.list` 能读到 Chief Run 与专业 Run 的父子关系（`parentRunId` 指向 Chief Run，满足 `isDirectChiefChild`）。
- 证明测试：同 T2.4 的集成测试文件追加用例；`packages/core/test/stage.test.ts` 扩充「从 attempt.result 派生 stage_result」的单元用例。

### T2.6 Plan → queued Run 的衔接（依赖 Q3 决定）
- 内容：按 Q3 选项 A，在 `plan.approve` 通过 gate 后为 active Requirement 的 Work 建专业 Run（复用 T2.5 的派发助手，走同一校验路径），响应补 `runId`；若用户选 B，则实现 `plan.approved → chief_action_required → Chief 再 dispatch` 的唤醒路径。
- 退出条件：`plan.current → plan.approve` 之后 `runs` 出现新的 queued 专业 Run，且 `plan.current.runId` 与之一致（当前该字段恒为 null，`apps/daemon/src/protocol.ts:2213`）。
- 证明测试：`apps/daemon/test/protocol.integration.test.ts` 扩充；`packages/core/test/gates.test.ts` 断言批准后的派发副作用（或按 B 断言事件）。

### T2.7 e2e/live 无播种演练
- 内容：`scripts/e2e.mjs` 的 loopback 模型桩按请求内容返回确定性的评估 JSON 与专业结果 JSON；新增一条检查「消息 → Chief → Requirement/Plan → queued Run → stage 结果 → 看板」，全程不调用 `seedWork`（`scripts/e2e.mjs:2493`）。`scripts/lib/live-harness.mjs` 的 `bootLiveStack` 增加可选 execution（复用 `createProjectExecution`），`scripts/lib/live-drills.mjs` 新增纵向演练「真实 Provider 下消息直达看板」。
- 退出条件：`pnpm test:e2e` 新检查通过并写入真实证据；`pnpm test:live` 在配置了 `AGENTDEV_PROVIDER_*` 时新演练通过，未配置时按既有约定 `EXIT_UNVERIFIED`（`scripts/live.mjs:47`）。
- 证明测试：`node scripts/e2e.mjs`、`node scripts/live.mjs`（真实 Provider）。

---

## 5. 测试策略（最小且非播种）

| 层 | 文件 | 证明什么 | 关键断言 |
|---|---|---|---|
| 单元 | `packages/core/test/orchestrator.test.ts`（扩充） | 评估→level 生效→dispatch 冻结 | `work.level` 被评估更新；`profileRevision` 由 Core 注入；非法 spec 无 snapshot/Run 残留 |
| 单元 | `packages/core/test/supervisor.test.ts` + `packages/core/test/stage.test.ts`（扩充） | 文本累积与阶段结果派生 | `text_delta` 顺序拼接；`attempt.result` 派生 `stage.completed/failed` 与 `stageResults` 行 |
| 集成（主证据） | `apps/daemon/test/assessment-dispatch.integration.test.ts`（新增） | **消息→评估→dispatch 全链，桩 Provider，无播种** | 只调 `conversation.message.send`；断言 chief Run(queued)→(桩 transport 被调用)→assessment 行→专业 Run(queued)→Requirement(active/plan) 与 `run.queued/assessment.saved` 事件；断言测试期间**没有任何 `store.*.insert` 播种调用**（用 store 行数与来源字段反证） |
| 集成 | `apps/daemon/test/runtime.integration.test.ts`（扩充） | daemon 真栈装载 | `startRuntime` 后协议已接 orchestrator，且 `execution.liveCount()` 随 Run 领取变化 |
| e2e | `scripts/e2e.mjs`（新增检查） | **daemon+supervisor+真实 Runner 子进程** | 一条消息驱动：`run.queued → run.started → Attempt(pid:<n>) → run.ended → stage.completed`，且在 `run.get`/`board` 里可读；无 `seedWork` |
| live | `scripts/lib/live-drills.mjs`（新增演练）+ `scripts/live.mjs` | 真实 Provider 的可用版演练 | 真实模型产出 DispatchSpec → Requirement/Plan → 真实 Runner 改工作区 → 结果回看板；L1 只读问答同样走真实 Chief Run |

补充约束：新集成测试不得为「通过」而放宽现有断言；e2e 桩 Provider 必须对**未预期的请求**返回失败（沿用 501-计数桩的做法），保证「模型真的被调用了」是被证明的事实而不是假设。

---

## 6. 非目标

- 不做 T3 的 Runner 工具桥（read/edit/write/bash/git 经 Broker、grants、审计）；`assessment_submit`/`agent_dispatch` 工具化不在 T2。
- 不新增第 11 条 `pnpm` 契约命令，不改 `protocol.md` §6 内部方法名，不改 `docs/delivery/*` 与 `docs/product/*`。
- 不改产品行为与 AC 基线（D5）；Q1/Q3 若改语义，先出变更建议再实施。
- 不做 WebUI 页面补全（T4）、单入口多项目（T5）、运维/安装（T6）、浏览器 UAT（T7）。
- 不引入新依赖、Playwright 或浏览器二进制（D1）。

---

## 7. 开放问题清单（需用户决定）

| ID | 问题 | 选项 | 建议 |
|---|---|---|---|
| Q1 | L2 纯自然语言消息是否自动获得授权？ | A 保持需点名路径 / B 由评估结论生成 authorization | A（T2 采用），B 单独立项 |
| Q2 | Chief DispatchSpec 的提交通道 | A 文本 JSON 解析 / B `assessment_submit`+`agent_dispatch` 工具 | A（T2），B 归 T3 |
| Q3 | `plan.approve` 后谁建执行 Run | A Core 直接派发 / B Chief 再 dispatch | A，并返回 `runId` |
| Q4 | 消息 `processing/processed` 状态迁移是否属 T2 | A 纳入 T2 / B 推迟到 T4 | A（成本低，闭合 `experience.md:22`） |
