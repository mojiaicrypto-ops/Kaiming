# WP-12 T4b 实施记录：daemon 文档面补齐 + T8c 收口

- 状态：Developing（Develop 自测完成；独立 Review / Test / Settlement 未执行，见 §7）
- 依据：`.agentdev/work/WP-12/api-gap-audit.md`、`.agentdev/work/WP-12/plan.md`（T4b 行、§3 D8/D9）、`.agentdev/work/WP-12/T8a-review.md`（P2-2）
- 权威文档：`docs/architecture/protocol.md` §1/§4/§5/§7/§8、`docs/product/requirements.md` §2/§3/§6、`docs/rules/workflow.md` §2/§5.1/§7/§8、`docs/architecture/reliability.md` §87
- 写入文件：`apps/daemon/src/protocol.ts`、`apps/daemon/src/bootstrap.ts`、`apps/daemon/src/main.ts`、`packages/core/src/permissions.ts`、`docs/architecture/protocol.md`、`apps/daemon/test/requirement-commands.integration.test.ts`（新）、`apps/daemon/test/ui-catalogue.test.ts`（新）；并同步了两处会被本片行为推翻的既有断言（`apps/daemon/test/provider-config.integration.test.ts`、`apps/daemon/test/tool-permission.integration.test.ts`、`apps/web/test/workbench.integration.test.ts`）
- 未触碰：`scripts/**`、`packages/core/src/gateway-http.ts`、`apps/daemon/src/prepare-run.ts`（T2 在制）、`apps/web/src/**`（UI 车道）、`tests/browser/**`

## 1. 逐命令状态表

实现状态：`✅` 真实 handler；`—` 本片未实现（见 §5）。测试均为真实 SQLite + 真实 Git（临时仓库）。

| 命令 | 文档行 | 实现 | 测试 | 事件 | 备注 |
|---|---|---|---|---|---|
| `board` 暴露 `git.{branch,commit,unpushed,upstreamRevision}` | `requirements.md` L57、`reliability.md` L87（AC-090） | ✅ `protocol.ts` `gitFactsOf`/`gitContext` | `requirement-commands.integration.test.ts`「exposes branch/commit/unpushed…flips after a real push」 | 读面无事件 | 真实 `git merge-base --is-ancestor`；无 upstream → `unpushed:true`；`working-tree` → `commit:null` |
| `requirement.get` 暴露 `git` | 同上 | ✅ | 同上 | — | |
| `requirement.list` 暴露 `git`（保持 metadata-only） | 同上 + §8 L161 | ✅ | 同上 | — | 不携带 `contentMarkdown` |
| `requirement.get` 返回 `contentMarkdown` | §8 L161（审计 §2.9，`protocol.ts:1315-1331`） | ✅ `contentMarkdownOf` | 「returns the committed contentMarkdown…」 | — | 从 portableRef.revision 读回；`working-tree` 回退工作树文件；缺失 → `null` |
| `requirement.archive` | §4 L69 | ✅ `archiveRequirement` | 「archives and restores the real Git record…」 | `requirement.saved`（save service） | `queued/completed` 可归档；`active`/`cancelled` 或存在非终态 Run → `INVALID_STATE` |
| `requirement.restore` | §4 L69 | ✅ `restoreRequirement` | 同上 | 同上 | 仅 `archived` 且 `previousLifecycle∈{queued,completed}`；否则 `INVALID_STATE` |
| `requirement.save` 完成写入（`patch.completion`） | §4 L64/65、§8 L161、`requirements.md` §2 | ✅ 扩展 `saveRequirement` | 「writes a completion only when the completion fact is supplied」 | 同上 | 无 completion 事实 → `GATE_NOT_READY`（原为 `VALIDATION_ERROR`）；非法 lifecycle 迁移 → `INVALID_STATE` |
| `requirement.create` | §4 L64 | ✅ `createRequirement` | 上述多个用例 + HTTP 探针 | 同上 | 文档 `accepted` 形状；委托真实 save service |
| `requirement.update` | §4 L65 | ✅ `updateRequirement` | HTTP 探针（`patch.goal`） | 同上 | 未命名字段保持原值（读回 Git 记录） |
| `requirement.import` | §4 L66、§8 L159 | ✅ `importRequirement` | 「imports the committed pool…」 | `requirement.imported`（`RequirementProjection`） | 复用 `readRequirementPoolAtRevision` + `RequirementProjection`；逐条冲突不阻断其它条；`writeBlocked` |
| `requirement.start` | §4 L67、`workflow.md` §8 | ✅ `startRequirement` | 「starts a queued requirement…」 + HTTP 探针 | `requirement.saved` + `run.queued`（Chief Run，若有 orchestrator） | 预分配 `workId` → 写 Work（FK 需要）→ Git 保存 `active`（带 workId）→ 才准入 Run |
| `work.budget.update` | §4 L62 | ✅ `updateWorkBudget` | 「work.budget.update raises the envelope…」 | `decision.created`（kind=`budget`） | 低于已用+已预留 → `BUDGET_EXCEEDED`；记录用户 budget Decision |
| `run.pause` / `run.resume` / `run.cancel` | §4 L77 | ✅ `controlRun`（薄视图） | 「run.pause and run.resume…」「run.cancel…」 | `work.control_changed`（findings 服务发） | Run → 其 Work → 真实 `FindingService`；cancel 仍清理工具进程/Grant |
| `command.get` | §4 L58 | ✅ `getCommand` | 「command.get returns the recorded response to the same subject only」 | — | `store.commands.lookup(subject,…)`；他主体/未用键 → `NOT_FOUND` |
| `file.list` / `file.read` | §5 L94 | ✅ `listFiles`/`readFile` + `WorkspaceFilePort` | 「file.list and file.read answer a real Git revision」 + HTTP 探针 | — | revision-addressed `git ls-tree`/`git show`；`mime`/`hash`/`truncated` |
| `extension.list` / `extension.set` | §5 L104/105 | ✅ `listExtensions`/`setExtension` | 「extension.list is the shipped whitelist…」 | — | 本发布白名单为空（`BUILTIN_EXTENSIONS=[]`）→ list `items:[]`；未知 id `NOT_FOUND`；critical 关闭 `INVALID_STATE` |
| `ui.translate` 目录对齐 | `experience.md` §6、审计 §2.5、plan D7 | ✅ 目录 29 → 182 键 | `ui-catalogue.test.ts`（3 passed）：源码推导用键全覆盖 + 与 UI 字典逐字一致 | — | 153 键取自 `apps/web/src/i18n.ts` 现有 en/zh；对齐 4 个措辞不一致的旧键；未新增无 UI 使用的翻译 |
| `work.control resume`（T8c） | §4 L60、§7 L145 | ✅ 两阶段 + 事件 + 形状 | `requirement-commands` 3 例（含失败注入） | 新增真实 `work.control_changed` | 见 §4 |
| `inbox` 权限绑定（父代理插入项） | §4 L71、§6 L132 | ✅ `inbox()` 富化 | `tool-permission.integration.test.ts`「reports the bound tool call…」 + `apps/web/test/inbox.integration.test.ts` 3 passed | — | 平铺 `operation/targets/runId/inputHash`，源为 `tool_operation` 行 |
| `permission.respond` 的 `reason`（父代理插入项） | §4 L72（已补文档） | ✅ 接受并透传 | `tool-permission…`「records the denial reason on the durable permission.resolved event」 | `permission.resolved` 携带 `reason` | 可选；approve/省略不落 reason；`denyPermission(decisionId,runId,reason?)` |
| `queueApprovedRun` 规范 stage（T3 根因） | `workflow.md` §2、`rules/agents.md` §1 | ✅ `develop-L1/L2/L3`（由 Work.level 派生） | `provider-config.integration.test.ts`「creates a real queued professional Run…」（断言 `stage:'develop-L2'`，6 passed） | — | 修好后 T3 可删除临时映射 `context-stage.ts` |

## 2. 关键实现位置

- Git 事实：`protocol.ts` `RequirementGitFactsPort` + `createNodeRequirementGitFactsPort`（`git rev-parse --verify`、`git merge-base --is-ancestor`），bootstrap 注入与保存路径同一个 `WorktreeGitPort`。
- 记录读回/正文：`contentMarkdownOf`、`readRequirementRecord`（`git show <rev>:<path>`），`REQUIREMENT_CONTENT_FILE_NAME`。
- 生命周期写入：`writeRequirementLifecycle`（读回 committed 记录 → 只改 lifecycle 事实 → `RequirementSaveService.save` → `accepted`）。
- 迁移表：`REQUIREMENT_LIFECYCLE_TRANSITIONS`（`workflow.md` §5.1，`restore` 例外由命令自处理）。
- 池导入：`RequirementPoolReadPort` + `readRequirementPoolAtRevision` + `RequirementProjection`（与 save 路径同一冲突规则）。
- 文件读：`WorkspaceFilePort` + `createNodeWorkspaceFilePort`；`FILE_MIME_TYPES`。
- 写命令全部登记进 `WRITE_METHODS`/`LEDGER_WRAPPED_METHODS`（除 save/import/start 沿用既有各自事务语义），`dispatchEnvelope` 仍同步拒绝 Promise。

## 3. 已知偏差与选择

1. **`requirement.get` 的 `git` 语义**：`portableRef.revision` 即记录所在 commit；`working-tree` 表示未提交（`commit:null`、`unpushed:true`）。无 upstream 时 `upstreamRevision:null`、`unpushed:true`。已在 `protocol.md` 之外以代码 JSDoc 登记；`protocol.md` 未逐字段定义，按 `reliability.md` L87 语义实现。
2. **`extension.set` 的 `persisted:false`**：本发布 `BUILTIN_EXTENSIONS=[]` 且无启用持久化存储，故响应显式声明未持久化，不伪造「已保存」。
3. **`work.control` 与文档细粒度命令并存**：按 plan D8 保留 `work.control`/`requirement.save`/`requirement.continue` 为合法入口，未新增 `work.pause|resume|cancel`、`requirement.pause|resume|cancel` 同义命令；`requirement.pause/resume/cancel` 仍由 `work.control` + `requirement.continue` 承担（文档侧仍需按 D8 对齐，属文档切片）。

## 4. T8c：`work.control resume`

- **两阶段**（`protocol.ts` `controlWork` resume 分支）：对全部 parked Run 先做 `recordResumeDecision`（记录可恢复的 verdict），再对所有 Run 复检 `newAttemptAdmission`；任一未放行即整命令拒绝，**任何 Run 都不会被续跑**（修 WP11R5-01）。
- **失败注入证明**：`requirement-commands.integration.test.ts`「removes the partial write when a later parked Run cannot resume」——第二个 Run 有真实 `run.recovered` 判定 `newAttemptAllowed:false`（`RUN_RECOVERED_EVENT`），端口拒绝记录决定；断言 `resumeParkedRun` 调用次数为 0、无 `work.control_changed`、两个 Run 仍 `interrupted`。
- **残留竞态如实登记**：若在全部预检通过后 `resumeParkedRun` 因容量/spawn 竞态中途失败，已续跑的 Run 无法回滚；此时错误 `details.resumedRunIds` 列出已处理项、`pendingRunIds` 列出待处理项，使失败可续做（用例「reports the already-resumed Runs when a later spawn fails」）。该字段由此获得文档化消费方（父代理要求：给测试或删除）。
- **形状/事件**（修 WP11R5-02）：成功返回 `{status:'accepted', operationId, workId, version, resumedRunIds}`，并在同一事务写入真实 `work.control_changed`（`control:'resume'`, `resumedRunIds`, `parkedRunIds`），与 §4 L60 / §7 L145 一致。

## 5. 未完成（诚实声明）

| 命令 | 文档行 | 原因 | 归属切片 |
|---|---|---|---|
| `work.retry` | §4 L61 | 无既有「同 Work 新 Run」服务；需 Core 产出新 Run + 「无副作用不确定项」判定，不能在协议层伪造 | T8（Core run-lifecycle/orchestrator） |
| `recovery.inspect` | §4 L73 | 需要 `RunRecoveryPort.inspect` 新端口 + `RunnerSupervisor` 暴露 `RunRecoveryService.inspect`，及 `recovery.report_ready` 的报告持久化形状；未在无文档化 report 形状时自造 | T8 |
| `recovery.resolve` | §4 L74 | 依赖 `recovery.inspect` 的 `reportRef` 与 `accept_cancel/abandon` 语义；`resume` 分支已被 `work.control resume` 覆盖 | T8 |
| `context.preview` | §5 L93 | 需装配 `buildContext` 的 resolver/gates/snapshot/ledger 端口（`packages/core/src/context/builder.ts`），属上下文接线而非协议薄视图 | T8/T2 |
| `project.create/clone/trust/close/initialize`、`task.list/get`、`permission.request/respond` 之外 §5/§6 残余 | §3/§4/§6 | 本片范围外（T5/T3/产品决定） | T5/T2/T3 |
| `requirement.pause/resume/cancel` 独立命名 | §4 L68 | 按 D8 保留 `work.control`，不新增同义命令 | 文档切片（D8） |

## 6. 需要决策的冲突（未擅自选择）

1. **完成写入与 Settlement 冲突**：`packages/core/src/settlement.ts` `finish()` 在 SQLite 中直接把 `requirement.lifecycle` 置 `completed` 并写 `finalManifestId`，**不产生需求池 Git 提交**；而 §8/`workflow.md` §8 要求「completed 记录与最终知识一起提交」。本片实现的是文档化写入口：`requirement.save` 接受 `patch.completion`（§4 L65 `requirement.update`），无事实则 `GATE_NOT_READY`。因此 WebUI 现发送的裸 `requirement.save {patch:{lifecycle:'completed'}}` 仍不会成功（错误码由 `VALIDATION_ERROR` 变为可渲染的 `GATE_NOT_READY`）。两条收口路径需产品/T2 决定：(a) UI 从 CompletionManifest 取 completion 事实后显式提交；(b) settlement.ts 改走需求池 Git 保存。当前 `settlement.ts` 行为与 §8 不一致，登记为冲突。
2. **`ui.translate` 目录仍多 2 个无 UI 使用的键**（`config.invalid`、`disconnected`，均为既有键）。按「不新增无 UI 使用翻译」未删除也未新增；是否保留由文档切片决定。

## 7. 证据（本机真实执行）

环境：macOS，Node `v24.8.0`，pnpm `12.3.4`；每条命令均 `export PATH="$HOME/.local/bin:$PATH"`。

| 命令 | 结果（原文） |
|---|---|
| `pnpm typecheck` | exit 0，无输出 |
| `pnpm test:unit` | `Test Files 75 passed (75)` / `Tests 1404 passed (1404)`，exit 0 |
| `pnpm test:integration` | `Test Files 1 failed | 42 passed (43)` / `Tests 1 failed | 453 passed (454)`，exit 1。唯一失败为 **T3 未跟踪在制文件** `apps/daemon/test/tool-bridge.integration.test.ts`（`timed out waiting for the Chief assessment`；T3 记录 §9.3-1/§9.5 已自述该用例「卡在 Runner 会话建立」并计划 skip，诊断输出与本轮逐字一致）。另有 1 条来自 `assessment-dispatch.integration.test.ts` 拆卸期的未处理 EPIPE，非断言失败 |
| `pnpm lint` | exit 1，仅 2 个 error，全部在 **T3 未跟踪在制文件**：`apps/daemon/test/tool-bridge.integration.test.ts:138`（unused `childLog`）、`packages/core/test/permissions-bridge.test.ts:223`（unnecessary assertion）。本片文件 0 error |
| `pnpm docs:check` | `docs:check ok — 16 documents, 65 internal links, 94 acceptance cases, 9 requirements, 11 work packages`，exit 0 |
| 定向 `npx vitest run apps/daemon/test/requirement-commands.integration.test.ts` | `17 passed (17)`（含真实 Git push 翻转、archive/restore、import、start、resume 失败注入、真实 HTTP `/rpc` 探针） |
| 定向 `npx vitest run apps/daemon/test/ui-catalogue.test.ts` | `3 passed (3)` |
| 定向 `npx vitest run apps/daemon/test/tool-permission.integration.test.ts` | `11 passed (11)`（含 inbox 绑定、deny reason 落 `permission.resolved`） |
| 定向 `npx vitest run apps/web/test/workbench.integration.test.ts` | `19 passed (19)`（父代理点名的两条失败已按真实行为转绿：`data-git-unpushed="true"`、`requirement.archive` 成功） |
| 定向 `npx vitest run apps/web/test/inbox.integration.test.ts` | `3 passed (3)`（UI 侧权限卡片，依赖本片 inbox 绑定字段） |
| 定向 `npx vitest run apps/daemon/test/provider-config.integration.test.ts` | `6 passed (6)`（`plan.approve` 的 Run `stage` 已为规范 `develop-L2`） |

**HTTP 探针**：`apps/daemon/test/requirement-commands.integration.test.ts` 最后一个用例起真实 loopback `http.createServer` + `/rpc`，对 `requirement.create/get/list/update/import/archive/restore/start`、`board`、`file.list/read`、`extension.list/set`、`work.budget.update`、`run.pause/resume/cancel`、`command.get`（未用键 404）逐一 POST 并断言 HTTP 200/404；WebUI 的调用形状即探针载荷。

## 8. 待办（后续切片）

1. 独立 Review（新上下文）→ 修复轮 → 独立 Test。
2. 决定 §6.1 的完成写入归属；在此之前 WebUI「完成」按钮仍是 `GATE_NOT_READY`（不再是 `VALIDATION_ERROR`，且可渲染原因）。
3. T3 处理其两个在制测试的 lint/超时；删除 `context-stage.ts` 临时映射（本片已发规范 stage）。
4. D8 文档对齐：把 `work.control`/`requirement.save`/`requirement.continue` 与细粒度命令的并存关系写进 `protocol.md`。

---

# 轮 2（父代理追加 A/B/T9 插入项）

## 轮 2 状态表

| 命令/项 | 文档行 | 实现 | 测试 | 事件 | 备注 |
|---|---|---|---|---|---|
| `work.retry` | §4 L61 | ✅ `retryWork` | `retry-recovery-tasks.integration.test.ts`（4 例） | `run.queued`（真实 Orchestrator 发） | 真 `Orchestrator` + 真 SQLite；前置：无 `recovery_required`、无活跃 Run、预算>0；否则 `RECOVERY_REQUIRED`/`INVALID_STATE`/`BUDGET_EXCEEDED`；写 `work.retry` user action + Work 授权后准入新 Chief Run |
| `recovery.inspect` | §4 L73 | ✅ `inspectRecovery` | 同上（3 例） | **不发**（见下） | 只返回既有报告：读 `recover` 操作行 `stepResults.reports[]`（`reportRef` 指向该行 id/version/hash）；无报告 → `INVALID_STATE` |
| `recovery.resolve` | §4 L74 | ✅ `resolveRecovery` | 同上（3 例） | `work.control_changed`（resume 分支）；`decision.created`/`work.control_changed`（处置分支由 findings 发） | 应用前核对 `recovery.report_ready` 事件里的 `expectedVersions`（run/attempt/work），漂移 → `STALE_ARTIFACT`；有 pending `recovery` Decision → `findings.resolveCancellation`（resume/accept_cancel/abandon） |
| `task.list` / `task.get` | §4 L75 | ✅ `listTasks`/`getTask` | 同上（1 例） | — | list 带 `runCount`；get 返回 task+work+runs |
| `context.preview` | §5 L93 | ❌ 未实现（见「未完成」） | — | — | 缺生产端口，非形状问题；已按父代理要求报具体缺项 |
| 结算完成落需求池 Git | §8 L161、`workflow.md` §8 | ✅ `SettlementService` 注入 `requirementSaves`，锁释放后走同一 save 路径 | `settlement.integration.test.ts` 新增 2 例（14 passed） | `requirement.saved`（save service） | `finish()` 不再自行翻 `lifecycle`（有 save service 时）；Git 失败 → 投影保持 active + `requirementCompletionError` |
| `requirement.save {patch.completion}` | §4 L64/65、§8 | ✅（轮 1）+文档补形状 | 轮 1 用例 | `requirement.saved` | `docs/architecture/protocol.md` §8 已写明 payload 与 `GATE_NOT_READY`/`INVALID_STATE` |
| T9-2：`recovery.report_ready` 不重复发射 | §4 L73、§7 L145 | ✅ | 用例断言两次 inspect 后事件仍为 1 条 | — | 报告由 `RunRecoveryService.recordRestart()` 同事务恰好一次；`inspect` 只读回地址，不建 artifact、不发事件 |

## 轮 2 关键实现

- `work.retry`：`retryWork` 用 T4b 的 `queueChiefRun` 产出真实新 Run；用户动作 + 授权（`authorizations.insert`，scope=Work scope、operations 覆盖 readPaths）保证 `Orchestrator` 的 authority 校验通过。
- `recovery.inspect`/`recovery.resolve`：报告地址来自 `recover` 操作行，版本事实来自同事务的 `recovery.report_ready` 事件（二者一致才可应用），因此不新增存储、不发重复事件。
- 结算：`SettlementServiceOptions.requirementSaves`；`settle()`/`recover()` 在释放集成锁后调用 `completeRequirementAfterSettlement`（保存服务持同一锁，不能嵌套）；完成事实的 `codeRevision/codeTree` 取自真实结算结果，`summary`/`verificationSummary` 由 `SettleRequest.completion` 或对 frozen manifest 的机械推导给出；`finalManifestId` 在投影上补齐。
- bootstrap 顺序调整：先建 `requirementSaves` 再建 `SettlementService`，并把同一 `lock` 与 `requirementSaves` 注入。

## 轮 2 未完成 / 阻塞（按父代理要求先报）

1. **`context.preview`（§5 L93）——缺生产端口而非形状**：`buildContext`（`packages/core/src/context/builder.ts`）在全仓**没有任何生产调用方**，其必需端口 `SourceResolverPort`、`ContentFetchPort`、`ContextGatesPort`、`SnapshotWriterPort` 只有测试替身；`ContextGatesPort.current()` 需要的 policyRevision/policyContent 与 roleContract.body 在代码中**没有来源**（`context/requirements.ts` 只声明必需键，没有 provider）。因此无法在不编造政策/角色契约文本、也不绕过 ACL 的前提下实现 `context.preview`。需要先由 T2/T8 把 context 装配接进执行栈（或定义 policy/roleContract 的正式来源）；协议侧可在端口就绪后 1 天内补上。
2. **结算服务在真实 daemon 的触发点（T9-1）——需定义契约再接线**：`apps/daemon/src/bootstrap.ts` 构造 `SettlementService` 但没有消费方；要触发结算必须把「Settle 阶段 Run 的 stage 结果」翻译成 `SettleRequest`（candidateRevision、SHA256 candidateTree、`CompletionManifest`）。`StageResult` 只有 `manifestId?`（UUID，指向不了按 hash 冻结的 manifest）与 `artifactRefs`，没有可用的候选 revision/tree/manifest-hash 契约。两个选项：
   - (a) 在 `control-handler.ts` `stage.submit`（purpose=settlement）里触发，需要新增 settlement 触发模块（超出 bootstrap/main）；
   - (b) 在 `main.ts` 的 `onRunSettled` 里对 purpose=settlement 的 Run 触发，但同样需要先把上述契约加进 `StageResult`/settlement artifact 形状（改 `packages/contracts`）。
   两条都超出「只改 bootstrap/main」的授权范围，故先报，未擅自实现。选定后我可以按 (a)/(b) 实现并补一条真实 daemon 级「结算→投影→`knowledge.updated`」测试。

## 轮 2 证据

| 命令 | 结果 |
|---|---|
| `pnpm typecheck` | exit 0 |
| `pnpm test:unit` | `75 passed (75)` / `1407 passed (1407)`，exit 0 |
| `pnpm test:integration`（全量串行） | `Test Files 44 passed (44)` / `Tests 468 passed (468)`，exit 0（含真实 Docker/Git/daemon；上一轮失败的 T3 `tool-bridge.integration.test.ts` 本轮已绿或跳过） |
| `pnpm docs:check` | `docs:check ok — 16 documents, 65 internal links, 94 acceptance cases, 9 requirements, 11 work packages`，exit 0 |
| `pnpm lint` | 仅剩**其他车道在制文件**：`apps/daemon/src/prepare-run.ts`、`apps/runner/test/read-ledger.test.ts`、`packages/core/test/gateway-http.test.ts`、`scripts/lib/live-drills.mjs`（格式化，非本片文件）；另 `apps/daemon/test/tool-bridge.integration.test.ts:152` unused var（T3 未跟踪文件）。本片文件 0 error |
| 定向 `npx vitest run apps/daemon/test/retry-recovery-tasks.integration.test.ts` | `8 passed (8)` |
| 定向 `npx vitest run packages/core/test/settlement.integration.test.ts` | `14 passed (14)`（含结算 Git 完成 + Git 拒绝两例） |
| 定向 `npx vitest run apps/daemon/test/tool-permission.integration.test.ts` | `11 passed (11)` |

## 轮 2 待办

- 收到父代理对 §「未完成」1/2 的决定后：接 `context.preview`；按选定方案接 settlement 触发并补 daemon 级 `knowledge.updated` 测试。
- 独立 Review / Test / Settlement 仍未执行。

---

# 轮 3（结算触发决策 1 + Context plane 决策 2）

本轮**未改动任何代码**：两项在实现前都命中「先停下报我」的条件。以下为证据与请求的决定。

## 决策 1（结算触发 (a)，不改 contracts）——阻塞：settle 路径上没有任何地方记录候选提交

父代理前提是「`operation` 行已有 `candidateRevision`（`system.ts:139`），从中读取候选」。实测该前提不成立，证据（均非测试代码）：

1. **operation 的 `candidateRevision` 只在 `settle()` 内部写入**：`packages/core/src/settlement.ts:1141`（`prepareSettlement` 插入 operation 时写 `candidateRevision: request.candidateRevision`）与 `:1459`（finish 的 stepResults）。也就是说这个字段来自 **`SettleRequest.candidateRevision`**（`settlement.ts:858`），而该行由结算自己创建——结算前不存在任何 operation 行可供读取。
2. **production 无候选提交的写入者**：唯一会为交付创建候选提交的代码是 `packages/workspace/src/cas.ts` `runIntegration()`（`:1026`）→ `integrateTasks()` → `git.commitPaths`（`:1246`）→ `cas.integrate({kind:'integrate', candidateRevision: head.value})`（`:1323-1330`）。而 `grep -rn "runIntegration(" packages/core/src apps/daemon/src`（排除 test）= **0**；没有任何生产调用方。
3. **Run/Stage 路径不落候选**：`packages/core/src/stage.ts` 只落 stage result；`apps/daemon/src/prepare-run.ts`（T2 在制，只读确认）自述「全 ContextBuilder 装配是下一片」，且不提交 worktree；`packages/core/src/supervisor.ts` 的 `settle` 分支（`:1141`）只做 `RunLifecycle.settle`（Run 状态），不产生候选提交。
4. **契约也没有可用的既有载体**：`packages/contracts/src/entities/run.ts:246-254` 的 operationKindSchema 仅 8 种（initialize/integrate/settle/recover/backup/requirement_save/requirement_import），没有「代码交付」kind；`settlementResultSchema`（`structures.ts:410-419`，含 finalRevision/codeTree）在全仓生产代码中**没有任何解析/生产方**（`grep settlementResultSchema packages/core/src apps/daemon/src` 排除 test = 0）。
5. `apps/daemon/src/bootstrap.ts:230` 构造 `SettlementService` 后确实被丢弃（T9 结论成立，行号应为 230 而非 218）。

**为什么既有字段不够**：`CompletionManifest` 需要 `finalRevision`/`verifiedCodeTree`/`knowledgeTree`，`SettleRequest` 还需要 `candidateRevision`（真实 Git 提交）与 `candidateTree`（SHA256 代码树）。`Work.baseRevision` 是**基线**不是候选；`Run` 行没有 revision 字段；`StageResult` 只有 `manifestId?`（UUID，指不到按 hash 冻结的 manifest）与 `artifactRefs`。因此在「不改 contracts、不新增 StageResult 字段」的约束下，没有事实可读。

**请裁决（三选一）**：
- (I) 把 `runIntegration()` 接进结算路径（在 `control-handler.ts` 或 `main.ts` 的 settlement 触发里调用），由它先提交候选并返回 `candidateRevision`，再 `settlement.settle()`。需要动 `control-handler.ts`（超出 bootstrap/main）。
- (II) 允许新增一个既有 kind（如 `integrate`）的 operation 行，在专业 implementation Run 提交时记录候选（需要改 `packages/workspace`+supervisor/prepare-run，且 T2 在制）。
- (III) 允许给 `SettleRequest`/`CompletionManifest` 定义候选来源（改 contracts）。

## 决策 2（Context plane 生产接线）——阻塞：真实 Run 的装配点在 T2 在制文件

端口来源已核实（**不是**形状/来源缺失，撤回轮 2 的「无来源」判断）：
- `policyRevision`：`Work.policyRevision`（`packages/contracts/src/entities/work.ts:62`）。
- `policyContent`：Project 配置的 policy（`packages/core/src/config.ts:105/172`，`policyConfigSchema`，含 permissionMode/l3Paths/l3Keywords/testCommands）。
- `roleContract.body`：`CHIEF_RULES_PATH = 'docs/rules/agents.md'`（`packages/core/src/context/cold-start.ts:73`）——**Project 内真实 Git 文档**，应按 Work.baseRevision 读取；`cold-start.ts:860` 已给出固定规则的 inline 示例。
- `SnapshotWriterPort`：`createSnapshotDirectoryWriter({root})`（`packages/core/src/context/builder.ts:595`）已存在，配合 `SnapshotWriter.freeze` 落 snapshot 行。
- resolver/content：Git blob（`WorktreeGitPort.readBlob`）+ `ArtifactService` + `BlobStore`，均为既有真实来源。
- 越范围请求：`context.request` 已在 `packages/core/src/context/ledger.ts:241/545` 与 `packages/core/src/control-http.ts:212` 实现（T3 轮 2），语义可复用。

**阻塞点**：让「真实 Run 的上下文选择走这条链」的装配点在 `apps/daemon/src/prepare-run.ts`（其自述「prompt 是 Work goal + 角色契约；全 ContextBuilder 装配是下一片」，第 14 行），该文件 **T2 仍在制**，按你的要求冲突文件先报。另需授权在 `packages/core/src/context/builder.ts` 给 `buildContext` 增加**只读 dry-run 返回**（现有实现只返回冻结后的 snapshot，`buildContext` 无生产调用方），用于 `context.preview` 的 `resolved/excluded/missing/estimatedTokens` 且不产生快照。

**请裁决**：T2 释放 `prepare-run.ts` 后我接真实 Run 装配；是否允许我：(i) 在 `builder.ts` 增加 dry-run 预览路径；(ii) 在 `protocol.ts` 实现 `context.preview`（用上述真实端口）；(iii) 为 `context.preview` 增加一条真实集成测试（给定 workId/role/selection 返回 resolved/excluded/missing/estimatedTokens，越范围经 `context.request` 语义拒绝）。

## 轮 3 证据

- 本轮 0 代码改动（仅本记录与 `docs/architecture/protocol.md` 上一轮的完成 payload 说明已在前文）。
- 上一轮收尾证据仍有效：`pnpm typecheck` exit 0；`pnpm test:unit` 75/1407 exit 0；`pnpm test:integration` 全量串行 44/468 exit 0；`pnpm docs:check` exit 0；scoped lint 本片文件 0 error。
- 本轮复核命令：`grep -rn "runIntegration(" packages/core/src apps/daemon/src`（非 test）= 0；`grep -rn "settlementResultSchema" packages/core/src apps/daemon/src`（非 test）= 0；`sed -n '246,254p' packages/contracts/src/entities/run.ts`；`packages/core/src/settlement.ts:1141/1459`；`packages/workspace/src/cas.ts:1026/1246/1323`。

## 轮 3 待办

- 决策 1：按 (I)/(II)/(III) 之一接结算触发；随后补真实 daemon 级「结算→投影→`knowledge.updated`→需求池 Git completed 且 SQLite 一致」测试。
- 决策 2：T2 释放 `prepare-run.ts` + 授权 builder dry-run 后，完成 context 生产接线与 `context.preview`。
- 独立 Review / Test / Settlement 仍未执行。

---

# 轮 3 续（决策 1 选 (I) 后；决策 2 的 (ii)+(iii) 已实现）

## 已实现并测试

| 项 | 文档行 | 实现 | 测试 |
|---|---|---|---|
| (ii) `buildContext` 只读 dry-run | `context.md` §1 | ✅ `BuildContextInput.preview?`；在 Step 7 冻结前返回同一 `identity`，**不写快照**、不经过 `snapshotWriter`；门禁/ACL/必需输入/预算全部照旧 | `context-builder.test.ts` 47 passed（既有全绿） |
| (iii) `context.preview` | §5 L93 | ✅ `previewContext`：真实端口 = config policy（`config.ts:105/172`）、`docs/rules/agents.md`@baseRevision（`cold-start.ts:73`）、`WorktreeGitPort`（经 `WorkspaceFilePort`）读 Git blob、`ArtifactService`；逻辑输入只断言 store 真有的（workGoal/policy、message 来源时 userRequest、有 authorizationRef 时 authorization）；返回 `resolved/excluded/missing/estimatedTokens` + policyHash/readScopeDigest | `requirement-commands.integration.test.ts` 新增 2 例：in-scope 选择成功且未写 `snapshots/context` 目录、缺失路径进 `missing`；transcript 越范围 → `CONTEXT_FORBIDDEN`（未放宽范围） |

未做：(i) 真实 Run 的 ContextBuilder 装配（等 T2 释放 `prepare-run.ts`，其第 14 行自述该装配为下一片）。

## 决策 1 选 (I) 后——更深一层的阻塞：`runIntegration` 的**每个 Task 结果 revision** 在生产里没有来源

`runIntegration` 需要 `tasks: IntegrationTask[]`（`packages/workspace/src/cas.ts:912`），`planIntegration` 直接消费 `task.revision`（`:652`）。生产代码里没有任何地方产生这个 revision：

1. `Task.latestManifestId` 生产写入 = **0**（`grep -rn latestManifestId packages/core/src apps/daemon/src`，非 test）。
2. `Task.worktreeId` 生产写入 = 0（同上 grep）。
3. `VerificationManifest` 生产冻结 = **0**：`freezeFinalManifest`（`packages/core/src/settlement.ts:789`）冻结的是 `kind='completion_manifest'`；`findings.ts:2326` 只**读** `kind='verification_manifest'`；全仓无 `freeze('verification', {kind:'verification_manifest'})` 的生产调用。
4. `Artifact.sourceRevision` 生产无人传（`grep -n "sourceRevision:" packages/core/src apps/daemon/src` 非 test 只有 `artifacts.ts` 的定义/透传与 protocol 的读响应）。
5. `packages/core/src/stage.ts` 只落 stage result，不含 revision/commit；`apps/daemon/src/prepare-run.ts`（T2 在制）不创建 per-Task worktree、不提交。
6. 因此即使把 `runIntegration()` 接到 `control-handler.ts` 的 stage.submit 触发点，也拿不到 `IntegrationTask.revision`；`candidateRevision` 仍无处可读。

**请裁决（不改 contracts 的可行路径）**：契约里唯一现成的载体是 `Task.latestManifestId` + `kind='verification_manifest'` 的快照（字段含 `codeRevision`/`codeTree`，`structures.ts:421-437`）——但需要先有「提交一个 Task 候选并冻结 VerificationManifest」的生产者，这要动 `apps/daemon/src/control-handler.ts`（stage.submit 成功分支）与 per-Task worktree（`prepare-run.ts`，T2 在制）。请确认：
- (A) 授权我在 T2 释放后新增「stage.submit 成功 → 提交 Task 候选 → 冻结 VerificationManifest → 写 Task.latestManifestId」的接线（文件：control-handler.ts + prepare-run.ts）；随后把 `runIntegration` 接到 Accept/Integrate 触发点，再让 Settlement 读候选；
- (B) 或定义别的既有载体（例如 `kind='integrate'` 的 operation 行）承载 Task 结果 revision，但 revision 本身仍须先由某处提交产生。

## 轮 3 续证据

- `pnpm typecheck` exit 0。
- `pnpm docs:check` exit 0（`16 documents, 65 internal links, 94 acceptance cases, 9 requirements, 11 work packages`）。
- `pnpm test:unit`：`75 passed (75)` / `1407 passed (1407)`，exit 0。
- 定向：`requirement-commands.integration.test.ts` **19 passed**（含新 2 例 context.preview）；`retry-recovery-tasks.integration.test.ts` 8 passed；`context-builder.test.ts` 47 passed。
- `pnpm lint`：本片文件 0 error；仅剩**其他车道在制文件** `packages/core/src/control-http.ts:250`（`no-fallthrough`，untracked，T3 在制）。
- `pnpm test:integration` 全量串行：`Test Files 44 passed (44)` / `Tests 471 passed (471)`，exit 0。

---

# 轮 3（续 2）：决策 1 选 (A) 后的第 (i) 步完成——真实 Run 的 ContextBuilder 装配

## 已实现

| 项 | 文件 | 说明 |
|---|---|---|
| 共享 Context 端口 | `apps/daemon/src/context-ports.ts`（新） | `createContextAssembly`：把 `ContextGatesPort`/`SourceResolverPort`/`ContentFetchPort`/`SnapshotWriterPort` 绑到真实来源——`Work.policyRevision`、`config.project().policy`、`docs/rules/agents.md@baseRevision`（`CHIEF_RULES_PATH`，缺失才用既有固定规则文本）、`WorktreeGitPort.readBlob`、`ArtifactService`、`createSnapshotDirectoryWriter`。`ContextGitReader = readBlob` 子集，main.ts 直接传同一个 `gitPort`，无适配器。 |
| prepare-run 真实装配 | `apps/daemon/src/prepare-run.ts` | `assembleContext`：从 Run 的 `contextSnapshotId`（orchestrator 落盘的 `{contextSelection,goal,workId}`）取选择 → `buildContext`（**非** dry-run）→ `snapshots.freeze('context', snapshot)` 持久化 → prompt 由 `snapshot.resolvedSources`（kind/path@revision/hash/reason）与快照目录组成，不再只是 goal+contract。逻辑输入只断言 store 真有的（workGoal/policy、message 来源 userRequest、有 authorizationRef 时 authorization）。装配被拒（MISSING_CONTEXT 等）时记日志并回退 goal+contract prompt，不因评估缺输入而弄死 Run。 |
| 装配接线 | `apps/daemon/src/bootstrap.ts`、`main.ts` | `OpenedProject` 新增 `blobs`、`git`（同一个 `WorktreeGitPort`）；main.ts 的 `createPrepareRun` 传入 artifacts/gitReader/snapshots/readMessageBody/snapshotRoot/projectId。 |

## 测试

`apps/daemon/test/prepare-run-context.integration.test.ts`（新，2 例，真实 Git + 真实 SQLite）：
1. chief:assist Run 的 prompt 含 `Frozen context <ref>` 与真实 `src/orders.ts@<rev>`（hash 前缀与真实 blob 一致），`context` snapshot 行含 `resolvedSources`，不可变目录 `<dataDir>/snapshots/context/<ref>` 真实存在；
2. transcript 越范围 → 解析器返回 `CONTEXT_FORBIDDEN`，未提交路径 → `NOT_FOUND`（不伪造 hash）。

## 未做（按顺序的下一步，等父代理确认后继续）

第 2 步「Task 候选落盘」尚未开始：`stage.submit` 成功后建/用 per-Task worktree、提交真实候选、冻结 `VerificationManifest`、写 `Task.latestManifestId`；随后第 3 步 Integrate/Accept（`runIntegration` + AC-081 祖先去重 + AC-012 CAS）、第 4 步 Settlement 绑定、第 5 步 fail-closed、第 6 步两 Task 真实 Git 测试。

## 本轮证据

- `pnpm typecheck` exit 0。
- `pnpm test:unit`：`75 passed (75)` / `1407 passed (1407)`，exit 0。
- 定向 `apps/daemon/test/prepare-run-context.integration.test.ts`：2 passed。
- `pnpm lint`：本片文件 0 error；其余为其它车道在制文件的 prettier 警告（`apps/runner/test/read-ledger.test.ts`、`packages/core/test/gateway-http.test.ts`、`scripts/lib/live-drills.mjs`）。
- `pnpm test:integration` 全量串行：`Test Files 45 passed (45)` / `Tests 474 passed (474)`，exit 0。
