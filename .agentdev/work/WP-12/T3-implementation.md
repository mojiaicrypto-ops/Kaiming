# WP-12 T3 实施记录：Runner 工具桥（无冲突部分）

- 状态：Developing（无冲突子任务已完成并通过当次真实命令；等待 T2 修复轮第三轮冻结后接线）
- 依据：`.agentdev/work/WP-12/T3-plan.md`（§10 T3.1–T3.7、§9 决定）、`api-gap-audit.md` §1.4/§3-1、`T2-review-security.md` G1.2/未验证节。
- 任务书对 §9 待决问题的裁定：Q-T3-1=A（内联 + 超限 resultRef）、Q-T3-3=A（文件读写在 Run Grant 内，环境操作逐次批准）、Q-T3-4=A（`work.baseRevision` 真实写方 + Grant 带 `decisionId`）、Q-T3-5=A（`git` 只读子命令，`bash` 的 `.git` 直写作为残余登记）、Q-T3-8=A（Task worktree 未接线时用项目根 + 单写者 lease 并登记缺口）、容器执行实现（Docker 探测 + 预置镜像）。
- 边界：本文件只记录 T3 无冲突车道已落地内容；T2 占用文件（`apps/daemon/src/{protocol,control-handler,main,bootstrap,prepare-run}.ts`、`packages/core/src/{control-http,orchestrator,execution,gateway-http,supervisor}.ts`、`scripts/**`）**未被修改**。

---

## 1. 交付清单（按子任务）

### T3.1 角色工具注册表 + Runner 工具面（解 F8）

| 文件 | 变更 |
|---|---|
| `packages/contracts/src/tool-protocol.ts`（新） | `BROKER_TOOLS`（Pi 工具名 = `Scope.operations` 名）、`ROLE_BROKER_TOOLS`/`roleHasBrokerTool`（角色工具面的**唯一权威名单**，Core 与 Runner 共用）、`toolArgsSchemas`（zod，服务端校验）、`toolArgumentNames`、`GIT_READ_ONLY_SUBCOMMANDS`/`gitSubcommandOf`/`isReadOnlyGitInvocation`、`toolExecuteRequestSchema`/`toolExecuteResultSchema`、`TOOL_RESULT_INLINE_BYTES = 64KiB`、`TOOL_EXECUTE_FIELDS` |
| `apps/runner/src/tools.ts`（新） | `TOOL_SPECS`（typebox 参数 schema + label/description + `mutating`）、`ROLE_TOOL_REGISTRY`（按 `ROLE_BROKER_TOOLS` 装配）、`selectRoleTools`（D-T3-1：空 subset=注册表默认集，非空=收窄，越权名字进入 `rejected`）、`roleTools`（绑定 `ToolBridge`）、`assertActiveTools`、`missingRegistryRoles`、schema 交叉核对辅助函数 |
| `packages/pi-runtime/src/session.ts`（改） | `PiToolSpec.execute` 第二参数改为 `PiToolExecuteContext`：`{signal, toolCallId?}`；`toToolDefinition` 把 SDK 原本丢弃的 `toolCallId` 透传（幂等键来源）。可选是为兼容直接调用工具规格的库级用法（`apps/runner/test/control-client.test.ts` 未改） |

角色工具面（`execution.md:53` + `rules/agents.md` §1）：chief/product/planning/review/test = read/search/artifact_write；backend/frontend = + edit/write/bash/git；settlement = read/search/edit/write/artifact_write（`bash` 明确不注册）。review/test 不注册任何写源码/Shell 工具（与 `broker.ts` 角色门构成双层防御）。`context_request` **未注册**：`protocol.md` §6 有名字但本切片无端点，注册等于给模型一个死工具（缺口见 §4-3）。

### T3.2 Core 侧：异步进程 + 端点处理 + 审计

| 文件 | 变更 |
|---|---|
| `packages/core/src/process-async.ts`（新） | `defaultAsyncProcessRunner`：`spawn(detached)` 自成一进程组、`SIGTERM`→`cancelGraceMs`(`LIMITS.cancelGraceSec`)→`SIGKILL(-pgid)`、`AbortSignal` 取消、输出上限 16MiB（超限杀进程并带部分输出）、`timedOut`/`cancelled`/`pid`/`durationMs`；`AsyncProcessHandle.cancel()` 幂等 |
| `packages/core/src/tool-processes.ts`（新） | `ToolProcessRegistry`：以 `attemptId` 为键登记活动句柄、`kill(attemptId)`/`killAll()`、句柄 settle 自动注销、`activeAttempts()/activeCount()` |
| `packages/core/src/broker.ts`（改） | `ToolContext.runAsync(input, options)`（`input` 为字符串走 `/bin/sh -lc`，为 `{program,args}` 直接 spawn，`git` 因此不经过 shell）；`execute()` 改 async，`bash`/`git` 走异步端口；`ToolInvocation` 增加 `cwd`（对 roots 做真实路径校验）与 `signal`；`BrokerOptions` 增加 `asyncProcess`/`toolProcesses` 并暴露 `Broker.processes`；`BROKER_ERROR_CODES` 增加 `BUDGET_EXCEEDED`；`DEFAULT_TOOL_TIMEOUT_MS = LIMITS.shellTimeoutSec.default*1000`；`spawnSync` 端口保留（仅容器 `cat`/`base64 -d` 两个有界原语与注入式测试），文档已注明工具 Shell 不走它 |
| `packages/core/src/tool-http.ts`（新） | `TOOL_EXECUTE_PATH`、`parseToolExecuteBody`（未知字段/类型/`expectedInputHash` 形状/`timeoutMs` 上下界）、`toolExecuteBody`（内联 vs 超限截断+`resultRef` 两种形状）、`handleToolExecute`（重算并核对哈希→`IDEMPOTENCY_CONFLICT`；`ProtocolError`→`statusForControlCode`；**端点层拒绝也写 `tool.refused`**，只含 operation/targets/code） |
| `packages/core/src/tools.ts`（新） | `planToolCall({toolName,args,cwdRoot,role})`：角色门（先于 args）→ 未知工具 → zod schema → `~`/绝对路径入口校验 → `cwd` 解析 → `git` 只读白名单 → `bash` 直呼 `git` 变更子命令拒绝（`isRefMutatingGitShellCommand`）；`runReadTool`（offset/limit）、`runSearchTool`（真实遍历、跳过 `.git`/`node_modules`/symlink、逐文件 `context.readFile` 再过边界）、`runEditTool`（`expectedContent` 前置条件） |

### T3.3 路径/网络/角色/Plan 门

- 端点与 Broker 复用既有策略（未重写）：`resolveWithinRoots`（open 时再校验）、`deriveProtectedPaths`、`isReadOnlyRole`/`toolCapability`/`isArbitraryCommandOperation`、`NetworkPolicy`/`GuardedRequester`、`planContainerRun`。
- 新增入口校验：`~`/盘符/空路径在 `planToolCall` 前置拒绝；`cwd` 在 Broker 内按 roots 校验（`invocation.cwd`）。
- `git` 子命令白名单 + `bash` 的 `git` 守卫见 T3.2。
- **AC-013 的写门已接线（fail-closed）**：`apps/daemon/src/tool-handler.ts` 对 `write`/`edit` 调 `PlanGateService.requestCodeWrite({workId, revision: work.baseRevision ?? '', targets})`；无 `baseRevision`、revision 不符、Work 暂停/取消、无批准 Plan 分别得到 `GATE_NOT_READY`/`VALIDATION_ERROR`/`INVALID_STATE`（同一 Gate 的既有裁决，未另写规则）。**未配置 `planGate` 时同样拒绝**（`GATE_NOT_READY`），避免“没接线就等于放行”；证据见 `tool-handler.integration.test.ts` 的 3 个用例（含源码 Hash 不变）。
- **`work.baseRevision` 的真实写方未落地**：写入点在 T2 的 `messages.ts`/`orchestrator.ts` 派生授权路径（Work 创建处），不在本车道允许修改的文件清单内；本切片只保证“无 baseRevision → GATE_NOT_READY、源码不变”（W6R3-04 已有测试覆盖），并把建议接口登记在 §2 的“待冻结接口”。

### T3.4 Grant 铸造 + permission 生命周期（Core 服务）

| 文件 | 变更 |
|---|---|
| `packages/core/src/permissions.ts`（新） | `ToolGrantService`：`ensureRunGrants`（从 Work scope ∪ 未撤销 `authorization.scope` 铸 `run` 范围文件 Grant：read/search/edit/write/artifact_write；幂等；`decisionId` 优先取 authorization 的 `sourceRef.kind==='decision'`，否则取 Work 已有 accepted 决定，否则建一条 `kind='start'` 的 accepted Decision——`grant.decision_id` 是外键，不能凭空引用）；`requestPermission`（建 `kind='permission'` pending Decision + 追加 `work.blockerIds` + `decision.created` 事件）；`approvePermission`（校验 pending/kind/choices → `GrantStore.issue` 铸 `once`（默认）或 `run` Grant，绑定 `runId/toolOperationId/inputHash`，摘 blocker，写 `effectRefs`）；`denyPermission`（拒绝、不铸、摘 blocker）；`revokeRun`（遍历 `currentRunGrants` 撤销）；`requiresPerOccurrenceApproval`（bash/network/secret/push/deploy/delete_data，Q-T3-3=A） |
| `packages/core/src/grants.ts`（改） | **D-T3-5**：`workScope` 同时并 `authorization.operations`（否则用户批准的 bash/network/secret 永远铸不出 Grant）；`GrantConsumeRequest` 增加 `inputBytes`/`durationSec`；`usageFor` 统计该 Grant 已记录的 `tool_operation` 条数（排除本次）作为 `priorCalls`；`consumeGrantRequest` 把 `usage` 传入 `evaluateGrant`/`grantDenialField`；`issue` 把 `limits` 传给 `validateGrantIssueRequest` |
| `packages/domain/src/permission.ts`（改） | `GrantRequest.usage`（`priorCalls`/`requestedBytes`/`requestedDurationSec`）；`evaluateGrant` 在身份绑定之后、targets 之前校验 `limits.maxCalls/maxBytes/maxDurationSec`，超限 reason 以 `grant limit` 开头 → `grantDenialCode` 映射 **BUDGET_EXCEEDED**；`GrantDenialCode` 增加 `BUDGET_EXCEEDED`；新增 `validateGrantLimits`（铸造期拒绝非法 limit，避免“窄 Grant 实为无限”） |

### T3.5 容器/宿主执行模式

- 端点/处理器按 `mode`（`ToolHandlerOptions.mode`，默认 `host`，plan D-T3-7）选择：`container` 复用 `planContainerRun`（read-only rootfs、cap-drop=ALL、no-new-privileges、pids/mem/cpu、`--network none`、非 root uid），无 Docker → `PROVIDER_UNAVAILABLE` 且**不降级 host**（既有 `broker.ts` 行为）；argv 形式在容器内做 shell quoting。
- **未做真实容器执行验证**：本车道的可运行入口是 HTTP 端点装配（`control-http.ts`，T2 占用）之后的路径；容器模式需要端点把 `mode` 传到 handler。`packages/core/test/tool-container.integration.test.ts` **未创建**（缺口见 §4-5）。

### T3.6 失败路由与清理（Core 部分）

- 进程组取消/超时/SIGKILL 升级与 Attempt 级登记表已实现并测试（`process-async.test.ts`、`tool-broker.test.ts`）。
- **未接线**：`onAttemptEnded`/`attempt.abort`/`execution.stop()` 调 `broker.processes.kill(attemptId)`、`ToolGrantService.revokeRun` 的调用点（都在 `execution.ts`/`supervisor.ts`/`main.ts`，T2 占用）。
- daemon 重启不重放、`unknown`→`RECOVERY_REQUIRED` 依赖既有 `grants.ts` 行为（未改语义），本切片未新增 `tool-recovery.integration.test.ts`。

### T3.7 文档对齐

- `docs/architecture/protocol.md` §6：`tool.execute` 行改为“内联工具结果，或超限时截断预览+resultRef”，并新增一段说明**两种结果形状**（Q-T3-1=A，明确不返回 accepted）、幂等绑定、`timeoutMs` 与 Grant `maxDurationSec` 的关系、拒绝码映射与“端点层拒绝也写 `tool.refused`”。
- `docs/architecture/protocol.md` §7：持久事件表补 `tool.invoked`/`tool.refused`（F11），并说明两者字段与“不含 args 原文/Secret 值”。
- `docs/architecture/reliability.md` §5/§6 的进程组取消语义已在 `process-async.ts` 的 JSDoc 中引用，未改文档正文。
- **未改** `docs/delivery/*`、`docs/product/*`。

---

## 2. 冻结接口（T2 冻结后接线所需）

```ts
// packages/contracts/src/tool-protocol.ts
BROKER_TOOLS: Record<BrokerToolName, OperationName>          // read/search/edit/write/bash/git/artifact_write
ROLE_BROKER_TOOLS: Record<Role, readonly BrokerToolName[]>
roleHasBrokerTool(role, name): boolean
toolArgsSchemas: Record<BrokerToolName, ZodType>
toolExecuteRequestSchema / toolExecuteResultSchema
TOOL_EXECUTE_FIELDS, TOOL_RESULT_INLINE_BYTES, isReadOnlyGitInvocation(argv)

// packages/core/src/tool-http.ts
TOOL_EXECUTE_PATH = '/control/tool.execute'
interface ToolExecuteCaller { runId; attemptId; epoch; role }
interface ToolExecuteHandler { execute({caller, request, signal?}): Promise<ToolSuccess> }
parseToolExecuteBody(body, opts): ToolExecuteRequest
toolExecuteBody(success, durationMs): Record<string, unknown>
handleToolExecute(opts, caller, body, signal?): Promise<{status, body}>

// packages/core/src/permissions.ts
class ToolGrantService {
  ensureRunGrants(input): EnsureRunGrantsResult
  requestPermission(input): PermissionDecisionResult
  approvePermission(input): PermissionDecisionResult
  denyPermission(decisionId): PermissionDecisionResult
  revokeRun(runId, reason): number
}
PERMISSION_OPERATIONS, requiresPerOccurrenceApproval(op)

// packages/core/src/tools.ts
planToolCall({toolName, args, cwdRoot, role}): ToolPlanResult
runReadTool / runSearchTool / runEditTool(context, args)

// packages/core/src/process-async.ts + tool-processes.ts
defaultAsyncProcessRunner: AsyncProcessRunner
class ToolProcessRegistry { register/kill/killAll/activeAttempts/activeCount }

// packages/core/src/broker.ts
ToolContext.runAsync(input: string | {program,args}, options?): Promise<AsyncProcessResult>
ToolInvocation.cwd?, ToolInvocation.signal?
BrokerOptions.asyncProcess?, BrokerOptions.toolProcesses?
Broker.processes: ToolProcessRegistry
DEFAULT_TOOL_TIMEOUT_MS, BrokerErrorCode 含 BUDGET_EXCEEDED

// apps/runner
roleTools(role, bridge, subset?): PiToolSpec[]
selectRoleTools(role, subset): {tools, rejected}
assertActiveTools(expected, active): string
createToolClient(opts): ToolClient  // ToolBridge + derive() + call()
toolInputHash(value), derivedToolOperationId(seed)

// apps/daemon/src/tool-handler.ts
createToolHandler(opts): ToolExecuteHandler
createProjectRootWorkspaceResolver(store): RunWorkspaceResolver
workWriterLeaseResource(projectId, workId)
ToolHandlerOptions.mode?: 'host' | 'container'
ToolHandlerOptions.planGate?: PlanGateService   // AC-013；缺省即 fail-closed
```

**待冻结后由 T2 侧补齐的接口（本切片已给出建议形状，未写入对方文件）**：
`packages/core/src/messages.ts` 的 `MessageOperationsOptions` 增加
`readonly readBaseRevision?: (project: Project) => string | undefined`，`createAssistWork` 在插入 `work` 时写
`baseRevision: options.readBaseRevision?.(project)`；默认实现读
`refs/heads/${project.deliveryBranch}`（交付 ref 不存在的新项目返回 `undefined`，与今天的
`GATE_NOT_READY` 语义一致）。在 mailbox 事务内 spawn `git` 会违反 `reliability.md` §1 的短事务要求，
因此该读应来自项目快照/派发参数，而不是每次 `sendMessage` 起子进程——这一点留给装配步骤决定。

**留在原地的既有接口（本切片只读引用）**：`Broker.invoke`、`GrantStore.issue/consumeOnceAsync/revoke/findGrantFor/currentRunGrants`、`statusForControlCode`（`control-http.ts`）、`resolveWithinRoots`/`NetworkPolicy`/`planContainerRun`、`ArtifactService.createAgent`、`LeaseStore.acquire/renew`、`createReadLedger`。

---

## 3. 命令与真实结果（当次原始输出）

| 命令 | 退出码 | 结果 |
|---|---|---|
| `pnpm typecheck` | 0 | 无诊断（在每次子任务落地后均重跑，最后一次全绿） |
| `pnpm exec vitest run --project unit packages/contracts/test/tool-protocol.test.ts` | 0 | 12 passed |
| `pnpm exec vitest run --project unit packages/core/test/process-async.test.ts` | 0 | 10 passed（真实子进程：超时、进程组孙进程回收、AbortSignal、输出上限、缺失二进制） |
| `pnpm exec vitest run --project unit packages/core/test/tool-broker.test.ts` | 0 | 15 passed（真实 SQLite/子进程：异步不阻塞事件循环、超时、registry 取消、argv 不经过 shell、cwd 越界、limits 三种、workScope 并 operations） |
| `pnpm exec vitest run --project unit packages/core/test/tools.test.ts` | 0 | 15 passed（真实临时 Git 仓库 + 真实文件：read 窗口、edit 前置条件、search、只读 git） |
| `pnpm exec vitest run --project unit packages/core/test/tool-http.test.ts` | 0 | 9 passed |
| `pnpm exec vitest run --project unit packages/core/test/permissions-bridge.test.ts` | 0 | 8 passed |
| `pnpm exec vitest run --project unit apps/runner/test/tools.test.ts` | 0 | 15 passed（含真实 Pi SDK 会话 `activeToolNames()` 断言） |
| `pnpm exec vitest run --project unit apps/runner/test/tool-client.test.ts` | 0 | 10 passed |
| `pnpm test:unit` | 0 | `Test Files 72 passed (72) / Tests 1355 passed (1355)`，Duration 52.99s（全部改动与 lint 修正后的最终全量） |
| `pnpm exec vitest run --project integration apps/daemon/test/tool-handler.integration.test.ts packages/core/test/permissions.integration.test.ts packages/core/test/broker.integration.test.ts packages/core/test/grants.integration.test.ts` | 0 | `Test Files 4 passed (4) / Tests 32 passed (32)`，Duration 42.58s；其中 `tool-handler.integration.test.ts` 12 passed（含 Plan 门 3 例）、`permissions.integration.test.ts` 11 passed（含**真实容器** read-only 用例 12.4s）、`broker.integration.test.ts` 8 passed（含真实 Docker 容器读 22.6s）、`grants.integration.test.ts` 1 passed |
| `pnpm docs:check` | 0 | `docs:check ok — 16 documents, 65 internal links, 94 acceptance cases, 9 requirements, 11 work packages` |
| `pnpm exec prettier --check <本切片 22 个文件>` | 1 → 0 | 初次 14 个文件格式告警；`prettier --write` 后复查全绿 |
| `pnpm lint`（`node scripts/lint.mjs`） | 1 → **0** | 首轮 20 errors，全部位于本切片文件（`no-base-to-string`/`no-unnecessary-type-assertion`/`consistent-type-imports`/`no-unused-vars`/`require-await`）；逐条修正后 `All matched files use Prettier code style!`，exit 0。**本切片无遗留 lint 失败** |
| `pnpm exec eslint <本切片文件>`（直连） | — | **不经 `scripts/lint.mjs` 时环境不可用**：`typescript-eslint does not support TS 7.0`（ESLint 10.10.0 + typescript-eslint 8.70.0 + typescript 7.0.2）。`pnpm lint` 走仓库脚本可正常运行，以上以其结果为准 |

---

## 4. 未完成 / 已知缺口（不假装实现）

1. **`tool.execute` 未挂到真实控制端点（S1，需 `packages/core/src/control-http.ts` 冻结）**：`CONTROL_PATHS` 增加 `/control/tool.execute`、`CONTROL_FIELDS` 增加 T3 字段、`handleToolExecute` 复用同一 `authenticate`、请求 socket `close`→`AbortSignal`。当前端点为纯处理函数 + 测试证明，**未在真实 HTTP 上验证**。
2. **装配未接线（S2/S3，需 `execution.ts`/`main.ts`/`protocol.ts` 冻结）**：`Broker`/`ToolGrantService`/`createToolHandler` 未在 daemon 组装；`permission.request`/`permission.respond` 未进分发表；`permission.resolved` 事件未发射；`onAttemptEnded`/取消/停机未调 `Broker.processes.kill` 与 `ToolGrantService.revokeRun`；`Run` 的 `waiting_permission` 状态无写方。
3. **`context_request` 工具未注册**（`protocol.md` §6 有名字、无端点）：登记为 T3 非目标，避免死工具。
4. **AC-013 的 `baseRevision` 写方未落地**：写门本身已接线（见 §1 T3.3），但 `work.baseRevision` 仍无生产写入点（F10），因此真实的 `write`/`edit` 在当前装配下会以 `GATE_NOT_READY` 拒绝——这是 AC-013 要求的正确行为，不是缺陷；缺口是“Work 创建时绑定 baseRevision”，其调用点在 T2 的 `messages.ts`/派生授权路径（建议接口见 §2）。
5. **容器模式未真实验证**：`mode='container'` 的 Docker 路径复用既有 `planContainerRun` 代码但本切片未跑真实容器（需端点把 mode 传到 handler）。`packages/core/test/tool-container.integration.test.ts` 未创建；容器内 Unix Socket 代理、容器化 Runner 仍为环境受限缺口（T3-plan §8）。
6. **每 Task worktree 未接线（Q-T3-8=A）**：`createProjectRootWorkspaceResolver` 返回项目根 + `taskWorktree:false` 并每次 handler 生命周期只记录一次缺口日志；单写者 lease 用 `LeaseStore`（资源名 `workspace:<projectId>:<workId>`，每次调用 renew）。真实 `worktreeManager` 属 T10。
7. **`request_dispatch`/`decision_request` 工具未注册**（无端点）。
8. **read ledger 未接**（AC-085）：`createReadLedger` 按 Attempt 创建、`stage.submit` 封口校验未做（`stage.ts` 属既有无写方）。
9. **Secret tool audience 注入未接**：`operation='secret'` 的分支与 `SecretStore.environmentFor` 注入未实现（无端点装配）。
10. **T3.6/T3.7 的其余证明测试未创建**：`supervisor-tools.integration.test.ts`、`tool-recovery.integration.test.ts`、`scripts/**` 的 e2e/live 检查（`scripts/**` 为 T2 占用）。
11. **`docs/delivery/acceptance.md` 未改**：AC-048/049/050/080 的新证据尚未登记（Settlement/父代理统一收口）。
12. **`GRANT limits` 语义的已知收窄**：`maxBytes` 按“单次调用输入编码大小”判定、`maxDurationSec` 按“本次请求的有效 deadline”判定；累计结果字节数未持久化（`tool_operation` 无该列），已在 `domain/permission.ts` 与 `docs/architecture/protocol.md` 写明，不假装是累计配额。

---

## 5. 登记残差（Q-T3-5 的 `.git` 直写）

`bash` 仍可在工作区内直接写 `.git`（例如手写 `refs/heads/agentdev/main`），`git` 工具已限只读子命令、`bash` 已拒直接 `git commit/push/update-ref` 等拼写，但 shell 无法被路径规则完全约束（`execution.md:27` 的边界不覆盖任意命令）。**缓解**：交付 ref 只由 `packages/workspace` 的 CAS（`git update-ref <new> <expectedOld>`）移动，集成时 expected-old 不匹配即失败，工作区内的篡改无法被采信。该残差按 Q-T3-5=A 登记，未声称已消除。

---

## 6. 冻结后接线（S1–S3）实施记录

父代理冻结回复：T2 代码修复轮 R3 已落地，除 `scripts/**` 验收证据外不再改文件；`control-http.ts`/`execution.ts`/`main.ts`/`protocol.ts` 归 T3。

### 6.1 改动文件

| 文件 | 变更 |
|---|---|
| `packages/core/src/control-http.ts` | `CONTROL_PATHS` 增加 `toolExecute='/control/tool.execute'`、`permissionRequest='/control/permission.request'`；`CONTROL_FIELDS` 增加两方法的字段集；`ControlEndpointOptions` 增加 `toolExecute?: ToolExecuteHandler`、`permissionRequest?: PermissionRequestHandler`；两个 case 复用既有 `authenticate`（capability→Run→终态→Attempt→状态→epoch），`tool.execute` 把**响应关闭且未写完**（`response.writableFinished === false`）转成 `AbortSignal` 传给 `handleToolExecute`，未配置 handler 时以 `PROVIDER_UNAVAILABLE` 拒绝而不是假装成功 |
| `packages/core/src/execution.ts` | 装配 `GrantStore` + `ToolGrantService` + `Broker`（`options.broker` 可传 report roots/dataDir 等），`options.tools.attach({store,grants,grantService,broker})` 生成 handler 并同时挂到 `toolExecute`/`permissionRequest`；`onAttemptStarted` 铸 Run 文件 Grant 并再调 daemon 回调；`onAttemptEnded` → `capabilities.revoke` + `broker.processes.kill(attemptId)` + `grantService.revokeRun(runId)`；`stop()` → 先杀 live Attempt 的工具进程组并撤销其 Grant，再 `killAll()`，最后 `supervisor.stop()` 与关闭端点；新增 `ensureRunGrants(runId)`、`cleanupRun(runId)` 与 `grants`/`grantService`/`broker` 只读暴露 |
| `apps/daemon/src/main.ts` | `createProjectExecution` 增加 `broker`（`dataDir` + `writableReportRoots=[<dataDir>/tool-reports]`，`execution.md` §3 的 Review/Test 报告根）与 `tools.attach`（`createToolHandler` + `ArtifactService` + 新建 `PlanGateService`）；`project.protocol.attachToolBridge({requestPermission, respondPermission, cleanupRun})` |
| `apps/daemon/src/protocol.ts` | `WorkbenchServices.toolBridge?` + `ToolBridgePort`；`permission.request`/`permission.respond` 进 `WRITE_METHODS`/`LEDGER_WRAPPED_METHODS` 与分发表；`requestPermission`（**服务端**从 `tool_operation` 行解析真实绑定、拒绝替换 inputHash、拒绝跨 Work/Run）与 `respondPermission`（pending/kind/targetVersion 校验、approve 铸 Grant、deny 不铸、二者都发 `permission.resolved` 并让 Run 回 `running`）；`decision.resolve` 对 `kind='permission'` 直接路由到同一条链（WebUI Inbox 的 approve/deny 按钮因此真的铸 Grant）；`work.control cancel` 对每个 `cancelledRunId` 调 `toolBridge.cleanupRun`（AC-056 的取消清理） |
| `packages/core/src/permissions.ts` | `requestPermission` 把 Run 置 `waiting_permission`；`approvePermission`/`denyPermission` 发 `permission.resolved` 并把 Run 回 `running`；新增 `PERMISSION_EVENTS` 与 `moveRun`（只走 `domain/transitions.ts` 允许的边，非法边报 `INVALID_STATE`） |
| `apps/daemon/src/tool-handler.ts` | `ToolHandler = ToolExecuteHandler & PermissionRequestHandler`；`execute` 把 `request.toolOperationId` 传给 Broker（**这是集成测试抓到的真缺陷**：不传会让每次重试都变成新操作而不是 `replayed`）；新增 `request()`（角色门 + `planToolCall` 解析 operation/targets + `grantService.requestPermission`）；`planGate` 对 `write`/`edit` fail-closed |
| `apps/runner/src/tool-client.ts` | 新增 `requestPermission()`：`NOT_AUTHORIZED` 时用**同一** `toolOperationId`/`inputHash` POST `/control/permission.request`，模型文本改为“已记录权限请求（decision …），等待用户决定后重试”；权限请求自身失败时保留原拒绝文本（不承诺不存在的决定）；`VALIDATION_ERROR` 等可修正拒绝不触发权限请求 |
| 测试（新增） | `packages/core/test/tool-http.integration.test.ts`（真实 HTTP+SQLite+真实 Git/符号链接：内联/重放/异参冲突/符号链接逃逸/Review 写门/未认证/未知工具/超时越界/413/**Grant maxDurationSec→BUDGET_EXCEEDED**/**真实容器 `mode='container'` 写挂载目录且 `NO_NET`**/permission.request 传输）；`apps/daemon/test/tool-permission.integration.test.ts`（7 例：真实 `WorkbenchProtocol` + `ToolGrantService`）；`apps/daemon/test/tool-handler.integration.test.ts` 扩到 14 例（+Plan 门 3、+request 2）；`apps/runner/test/tool-client.test.ts` 扩到 13 例（+权限请求 3） |

### 6.2 本次真实命令与退出码

| 命令 | 退出码 | 结果 |
|---|---|---|
| `pnpm typecheck` | 0 | 无诊断 |
| `pnpm test:unit` | 0 | `Test Files 72 passed (72) / Tests 1365 passed (1365)`，56.94s |
| `pnpm test:integration` | 0 | `Test Files 37 passed (37) / Tests 406 passed (406)`，130.01s（含真实 Docker、真实 daemon/CLI/Git） |
| `pnpm lint` | 1 | **仅 2 个非本切片文件**：`packages/core/test/gateway-http.test.ts`、`scripts/lib/live-drills.mjs`（均为 T2 车道格式告警，未触碰）。本切片文件首轮 8 errors（`no-base-to-string`/`no-unnecessary-type-assertion`）已逐条修正，现为 prettier-clean |
| `pnpm docs:check` | 0 | `docs:check ok — 16 documents, 65 internal links, 94 acceptance cases, 9 requirements, 11 work packages` |
| 定向：`pnpm exec vitest run --project integration apps/daemon/test/tool-handler.integration.test.ts apps/daemon/test/tool-permission.integration.test.ts packages/core/test/tool-http.integration.test.ts` | 0 | `3 passed / 32 passed`（tool-handler 14、tool-permission 7、tool-http 11） |

**并发导致的假红说明（诚实登记）**：首轮把 `pnpm test:unit` 与 `pnpm test:integration` 同时后台运行（且 T2 在跑 e2e），出现 `supervisor.test.ts`/`findings.test.ts` 23 例失败与 `apps/cli/test/runtime.integration.test.ts` 1 例 epoch 失败；串行复跑后 `supervisor.test.ts` 单文件 3/3 次全绿、CLI 单文件全绿、两个全量套件全绿。这些是真实时间/进程探针在 CPU 争用下的 flake，与本切片改动无关，但已记录以免被误当作回归。

### 6.3 冻结接口落地核对

- `handleToolExecute(opts, caller, body, signal?)`、`TOOL_EXECUTE_PATH`、`ToolExecuteCaller`、`ToolExecuteHandler`：**已按计划挂到控制端点**（S1 完成）。
- `Broker`/`ToolGrantService`/`createToolHandler` 装配 + attempt 结束/取消/stop 三条清理路径：**已完成**（S2 完成）。
- `permission.request`/`permission.respond`/`permission.resolved`/`waiting_permission`：**已完成**（S3 完成）；`permission.request` 同时可从 Runner 的 capability 通道与 `/rpc` 到达。
- 路径/网络/角色/Plan 门：角色门与 `~`/绝对路径入口校验在 `planToolCall`，根/符号链接/保护路径在网络与文件边界在 Broker，AC-013 写门在 daemon handler（fail-closed）——**均在本次真实会话中被执行到**（含真实符号链接逃逸拒绝与 `GATE_NOT_READY`）。

### 6.4 更新后的未完成 / 缺口（覆盖 §4 中已完成项）

1. ~~tool.execute 未挂端点~~、~~装配未接线~~、~~permission.* 未注册~~：**本次已落地**（见 §6）。
2. ~~容器模式未真实验证~~：**已补**——`tool-http.integration.test.ts` 用真实 `agentdev/exec:0.0.0`、真实挂载目录、`--network none` 跑通 `mode='container'`（Docker 不可用时该用例显式 skip，不伪通过）。容器内 Unix Socket 代理与容器化 Runner 仍是环境受限缺口（T3-plan §8）。
3. ~~Grant 限额只有单测~~：**已补**——真实 HTTP 端点上 `maxDurationSec` 触发 `BUDGET_EXCEEDED`，同一 Grant 在 `timeoutMs` 收窄后放行。进程组取消的真实证据：`process-async.test.ts` 杀真实孙进程、`tool-broker.test.ts` 通过 registry 取消真实 `sleep 30` 并断言 `cancelled:true`。
4. **`context_request` 工具未注册**（无端点，避免死工具）。
5. **`work.baseRevision` 真实写方仍未落地（归属待父代理指派）**：`control-handler.ts` 的 `checkpointOnProgress` 路径（T2.8）会尝试 `{ baseRevision: revision }` 补写，但项目无 `head`/无仓库时该字段可能始终为空；写门本身已 fail-closed。建议端口：`MessageOperationsOptions.readBaseRevision?: (project) => string | undefined`，在 `createAssistWork` 插入 Work 时写入，默认实现读 `refs/heads/<deliveryBranch>`（新项目返回 `undefined`，与今天 `GATE_NOT_READY` 语义一致）。**等父代理「T2 已完全停止」消息后再动 `messages.ts`/`orchestrator.ts`**。
6. **每 Task worktree 未接线（Q-T3-8=A）**：resolver 返回项目根 + `taskWorktree:false`（每次 handler 生命周期只记一次缺口日志），单写者 lease 用 `LeaseStore` 资源名 `workspace:<projectId>:<workId>`，每次调用 renew；真实 `worktreeManager` 属 T10。
7. **`request_dispatch`/`decision_request` 工具未注册**（无端点）。
8. **read ledger 未接**（AC-085）：`createReadLedger` 按 Attempt 创建、`stage.submit` 封口校验未做。
9. **Secret tool audience 注入未接**：`operation='secret'` 分支与 `SecretStore.environmentFor` 注入未实现。
10. **`permission.respond` 的 Grant targets 来源受窄**：`tool_operation` 不持久化 targets，故批准时 targets 取请求体（服务端仍按 Work 信封校验），缺省 `[]`（对路径型操作等价于最窄：空的 Grant targets 拒绝任何非空目标请求）。登记为已知收窄。
11. **`execution.md` §1 的 `permissionMode`（workspace/autonomous/full_access）仍未消费**：工具 Shell 模式固定按 `host`（plan D-T3-7 的显式默认），容器模式需端点/配置显式选择；不自行发明模式语义。
12. **`docs/delivery/acceptance.md` 未改**：AC-048/049/050/080 的新证据待 Settlement/父代理统一登记；`scripts/**` 的 e2e/live 检查属 T2。

---

## 7. 轮 2（父代理 6 项）

### 7.1 改动文件

| 文件 | 变更 |
|---|---|
| `packages/core/src/messages.ts` | Q-T3-4：`MessageOperationsOptions.readBaseRevision`/`sendMessage` context 端口 + `BaseRevisionReader` + `defaultBaseRevisionReader`（`git rev-parse --verify --quiet refs/heads/<deliveryBranch>`，非 40/64 位 hex 或读不到返回 `undefined`）；`createAssistWork` 插入 Work 时写 `baseRevision`（无 ref 则保持空，即原 `GATE_NOT_READY` 语义） |
| `apps/daemon/src/protocol.ts` | 消息发送上下文传 `defaultBaseRevisionReader`；`permission.respond` 的 Grant targets 改为「读回 `tool_operation.targets`，为空时用请求体 targets」，路径型操作（read/search/artifact_write/edit/write/delete_data）两者都空 → `MISSING_CONTEXT` 拒绝（不再铸出空目标 Grant）；`permission.request` 优先采用记录的 targets |
| `packages/contracts/src/entities/run.ts`+`tool-protocol.ts` | `tool_operation.targets`（必填数组）；`READ_LEDGER_SEAL_GENESIS` 提到 contracts（供 Runner 自算空 seal） |
| `packages/storage/src/{tables,migrations}.ts` | tool_operation 的 `targets` JSON 列映射 + **迁移 v2** `ALTER TABLE tool_operation ADD COLUMN targets TEXT NOT NULL DEFAULT '[]'`（v1 DDL/checksum 未动） |
| `packages/core/src/grants.ts` | `prepareOperation` 写入 `targets` |
| `packages/core/src/read-ledger.ts`（新） | `ReadLedgerRegistry`：`ensure/record/recordOutOfScope/binding/seal/verify/release/entries/size`；权威口径见 §7.3；degraded（无 ACL 行/Run 缺失）→ `MISSING_CONTEXT` fail-closed |
| `packages/core/src/stage.ts` | `StageGate.submit` 在 schema 解析后、写入前用 registry 重算校验；匹配后 `seal()`（之后 append 被拒）；`readLedgers` 缺省时跳过（未接工具桥的栈） |
| `packages/core/src/broker.ts` | `ToolSuccess.ledger`（回传绑定）；`ToolInvocation.secretEnv` → 仅注入子进程 env（不进审计/结果体） |
| `packages/core/src/tool-http.ts` | 内联/超限两种结果体都带可选 `ledger:{seq,hash}` |
| `packages/core/src/control-http.ts` | 新增 `/control/context.request`、`/control/agent.request_dispatch`（路径+字段+可选 handler，未配置 → 503 `PROVIDER_UNAVAILABLE`） |
| `packages/core/src/execution.ts` | 建 `ReadLedgerRegistry` 并注入 StageGate/tool-handler/control-handler；attempt 结束/cancel/stop 时 `release` |
| `apps/daemon/src/control-handler.ts`（新实现） | `contextRequest`（ACL 内读→账本 append；越权→账本 expansion + `chief_action_required`）与 `agentRequestDispatch`（只发 `chief_action_required`，绝不建 Run） |
| `apps/daemon/src/tool-handler.ts` | `readLedgers`：read/search 成功即记账并回传绑定；`NOT_AUTHORIZED` 的 read/search 记为越权请求；`mode` 按 plan D-T3-7 + Review/Test 固定容器（`execution.md` §1）；`secrets`：仅 `bash`/`git` 且 Run 持有 `secret` Grant 时 `SecretStore.environmentFor` 注入 |
| `apps/runner/src/{tool-client,control-client,attempt,cli}.ts` | `tool-client` 跟踪 `ledger` 绑定（初值 = `sha256(READ_LEDGER_SEAL_GENESIS)`）并暴露 `readLedgerBinding()`；`controlTools` 新增 `readLedgerBinding` 选项，`stage_yield` **注入** `readLedgerSeq/Hash`（模型不参与）；`AttemptRunner`/`cli.ts` 用 `roleTools(role, toolClient)` 注册角色工具并接线 |
| 测试（新） | `packages/core/test/base-revision.integration.test.ts`（真实 Git + 真实 `requestCodeWrite` 过门）、`packages/core/test/read-ledger-seal.integration.test.ts`（6 例）、`apps/daemon/test/control-requests.integration.test.ts`（5 例）；扩 `tool-handler.integration.test.ts`（18 例，+账本/越权/secret/Review 容器）、`tool-permission.integration.test.ts`（9 例，+targets 读回）、`assessment-dispatch`（空 seal 常量 + 头部改动说明）、`apps/runner/test/tool-client.test.ts`（15 例）、`packages/core/test/tool-http.test.ts`（10 例） |

### 7.2 与协调口径的关系

- 读账本权威口径按父代理确认**以仓库既有实现为准**：`hash` 为 `readLedgerSealHash` 的链式累积（genesis=`agentdev.read-ledger.seal.v1`，逐条
  `sha256(canonicalJson({prev,seq,path,revision,hash,reason,bytes}))`），空账本 = `{seq:0, hash: sha256(genesis)}` = `31ea900cb3853503cb15a97fe4e36abe3d337b4d0b834549de2bdcfb53d2e927`；`sha256('')` 的口径已作废。
- `stage.submit` 校验位置 = `StageGate.submit`（schema 通过后、写入前）；错误码 `STALE_ARTIFACT`（seq 落后/哈希不符）、`VALIDATION_ERROR`（seq 超出/非法）、`MISSING_CONTEXT`（账本 degraded）。匹配即 `seal()`。
- Runner 只上报：初值用 contracts 的 genesis 自算空 seal，其余采用 Core 在 `tool.execute` 响应里回传的绑定；`stage_yield` 注入，模型不参与。

### 7.3 本轮命令与退出码

（见 §7.5 实测值。）

### 7.4 轮 2 未完成 / 缺口（含归属）

1. **`decision_request` 未实现——需你裁决（冲突已按要求先停下上报）**：`execution.md` §7 要求 Chief 有 `decision_request` 工具，`protocol.md` §6 无该内部方法名（只有 §4 的 `decision.submit/resolve`）；更关键的是 `decision` 行**没有承载问题文本的列**（只有 `kind/targetRef/choices`），所以「Chief 向用户提问 → Inbox 显示问题 → `decision.resolve` 闭环」缺一环。两个选项：**(A)** 不改数据模型，Chief 的问题先落成 Artifact（或 Snapshot），`targetRef` 指向它，Inbox 由 T4 渲染该产物（可审计、零 schema 变更，但 UI 依赖 T4）；**(B)** 给 `decision` 加文本列（contract+storage+迁移 v3），Inbox 直接显示（改动产品数据面）。倾向 A（不改数据面、与现有 `decision.created` 事件一致），请裁决后我再实现。
2. **`context.request`/`agent.request_dispatch` 的 Pi 工具未注册**：`protocol.md` §6 方法已实现并有真实端点/处理器测试，但 Runner 侧 `context_request`（全角色）/`request_dispatch`（专业）工具尚未加进 `controlTools`，模型暂时调不到。归属：T3 收尾（预计小改动）。
3. **secret 注入的“触发面”缺口**：机制已落地（`secret` Grant + `SecretStore.environmentFor` + 子进程 env，测试证明有 Grant 才有值、审计不含值），但**没有工具会主动声明“我需要哪个 secret”**——`secret` 不在 Broker 工具集里，故 `secret` Grant 只能由一次显式 `permission.request`（operation=secret, targets=[refs]）产生。归属建议：产品/契约切片（工具的 secret 需求声明），T3 只提供注入面，符合 AC-051/AC-080 的可实现部分。
4. **`tool_operation.targets` 的迁移**：v2 迁移已加，老库由默认 `'[]'` 补齐；`bash`/`git` 记录空数组（其 targets 本就是空），路径型操作的记录是权威值。
5. **`decision_request` 之外的 `request_dispatch` 端点命名**：按 `protocol.md` §6 实现为 `agent.request_dispatch`（HTTP `/control/agent.request_dispatch`），与 `api-gap-audit.md` §1.4 的“无端点”项对齐。
6. **读账本只覆盖工具桥的文件读取**：`bash`/`git` 的读取不经账本（需要 shell 级计量），已在记录中登记；越权请求会记账本 expansion。归属：后续切片。
7. 轮 1 的其余缺口（`permissionMode` 之外的容器 socket 代理、容器化 Runner、每 Task worktree、read ledger 的 shell 计量、`docs/delivery/acceptance.md` 登记）不变。

### 7.5 实测（串行，无并发争用；最终值）

| 命令 | 退出码 | 结果 |
|---|---|---|
| `pnpm typecheck` | 0 | 无诊断 |
| `pnpm test:unit` | 0 | `Test Files 73 passed (73) / Tests 1371 passed (1371)`，27.98s |
| `pnpm test:integration` | 0 | `Test Files 40 passed (40) / Tests 426 passed (426)`，109.99s（真实 Git/进程/Docker/daemon） |
| `pnpm build` | 0 | 全部 9 个包构建成功 |
| `pnpm docs:check` | 0 | `docs:check ok — 16 documents, 65 internal links, 94 acceptance cases, 9 requirements, 11 work packages` |
| `pnpm lint` | 1 | **唯一失败为非本切片文件** `scripts/lib/live-drills.mjs`（`'ends' is assigned a value but never used`，T2 正在编辑 `scripts/**`）。本轮本切片文件的 lint 错误（7 个 `no-base-to-string`/`no-unnecessary-type-assertion`/`no-unused-vars`）已全部修正 |
| 定向：`read-ledger-seal` + `tool-handler` + `tool-permission` + `control-requests` + `base-revision` + `tool-http.integration` | 0 | 见 §7.1 测试清单；`base-revision` 用真实 Git 仓库证明 `requestCodeWrite` 从 `GATE_NOT_READY` 变为 `allowed:true` |

### 7.6 轮 2 追加缺口

8. **迁移 v2 影响面**：`packages/storage` 的迁移/账本集成测试原先断言「只应用 v1」，已同步为 `[1,2]`（`migrations.integration.test.ts` 的名称序列与 `ledger.integration.test.ts` 两处）；自定义迁移列表的用例（`[migration(1)]`）保持 `[1]` 未动。
9. **与 T2 的 Runner 侧读账本已收敛**：T2 在 R3 新增了 `apps/runner/src/read-ledger.ts`（Runner 本地账本），其 genesis 与累积公式**与本切片完全一致**（`sha256("agentdev.read-ledger.seal.v1")` + 链式 `{prev,seq,path,revision,hash,reason,bytes}`），并且 `control-client.ts` 的选择顺序是 `readLedgerBinding?.() ?? readLedger?.seal()`——即**Core 回传的权威绑定优先，Runner 本地账本仅在未接工具桥时兜底**。两套实现口径一致、无覆盖冲突；唯一待清理项是 T2 文件内重复定义了 genesis 字面量（本切片已把它提到 `@agentdev/contracts`），属 T2 文件、未改动。
10. **`scripts/lib/live-drills.mjs` 的 lint 告警非本切片**：`pnpm lint` 本轮唯一失败项（`'ends' is assigned a value but never used`）位于 T2 正在编辑的 `scripts/**`，本切片文件全部 lint/prettier 干净。

---

## 8. 轮 3（收口）

### 8.1 改动文件

| 文件 | 变更 |
|---|---|
| `packages/core/src/control-http.ts` | 新增 `/control/decision.request`（路径 + 字段 `attemptId,epoch,workId,question,choices` + 可选 `ControlHandler.decisionRequest`；未配置 → 503 `PROVIDER_UNAVAILABLE`） |
| `apps/daemon/src/control-handler.ts` | `decisionRequest`（选项 A）：`requireChiefRun` 后把提问正文写成 `kind='decision'` 的 **真 Artifact**（`mime=text/markdown`，走既有 `ArtifactService.createAgent`），Decision 行 `kind='product'`、`targetRef={id,version,hash}=artifact`、`choices` 缺省 `['accept','decline']`、`effectRefs=[artifactId]`，并发 `decision.created`（data 仅摘要：workId/runId/kind/artifactId/artifactVersion/choices） |
| `apps/daemon/src/main.ts` | `createControlHandlers` 传入 `artifacts`；`executionModeForPermissionMode` 取代内联三元 |
| `apps/daemon/src/tool-handler.ts` | 导出纯函数 `executionModeForPermissionMode`（`workspace`/`autonomous`→container，`full_access`→host） |
| `apps/runner/src/control-client.ts` | `ControlClient` 新增**可选** `contextRequest`/`agentRequestDispatch`/`decisionRequest` + `createControlClient` 实现；`controlTools` 注册 `context_request`（全角色）、`request_dispatch`（专业）、`decision_request`（Chief）；transport 缺失的工具**不注册**（不留死工具）；新增 `runAnswerTool` 把答案正文返回给模型 |
| 测试 | `control-requests.integration.test.ts` 扩到 8 例（+decision_request 3 例：artifact/targetRef/decision.created/resolve accept 与 decline、端点 capability 与角色拒绝）；`tools.test.ts` 扩到 19 例（真实 Pi 会话断言 chief/backend/review 的 `activeToolNames()` 含哪些控制工具 + 缺 transport 不注册）；`tool-handler.integration.test.ts` +permissionMode 映射 |
| `docs/architecture/protocol.md` §6 | `decision_request*（chief）` 行 + 提问正文落 Artifact 与 **Inbox 渲染契约**段落 |

### 8.2 裁决落实与冲突说明

- 选项 A 已落地：不新增 `decision` 文本列、不迁移 v3；`protocol.md` §7「event.data 只带摘要、完整内容由 get 获取」由 Artifact + `targetRef` 满足。
- **`decline` 的既有语义**：`protocol.ts` `isBehaviourChoice` 把 `decline` 归入 product-behaviour 分支——答案会被记录成 follow-up 产品决定（AC-015/016）而非翻转提问行；`accept` 走普通分支落 `state=accepted`。两条都能走通且都有事件/行证据（测试覆盖），未改产品行为。若产品要求「decline 也翻转原行」，那是产品决定，需另开切片。
- **Inbox/UI 渲染契约**（请转 T4）：`kind=product` 且 `targetRef` 指向 Artifact 的决定 → 用 `artifact.get`/预览端点读 `targetRef.id` 正文作为问题文本，按钮按 `choices` 渲染。

### 8.3 容器化行为与覆盖（第 3 项确认）

- 映射：`workspace`/`autonomous` → **容器**；`full_access` → **宿主**（`execution.md` §1）。Review/Test 在**任何**模式下都固定容器（`tool-handler.ts` `callIsReadOnly(caller.role) ? 'container' : policyMode`）。
- **无 Docker 环境的行为**：Broker 在 `mode==='container'` 且探测失败时返回 `PROVIDER_UNAVAILABLE`，**绝不降级为宿主**（`broker.ts` 既有实现，未改）；Review/Test 因此被阻断（"缺Docker即阻断独立验证"）。
- 真实覆盖：`packages/core/test/tool-http.integration.test.ts` 用真实 `agentdev/exec:0.0.0` + 真实挂载目录 + `--network none` 跑通容器内 `bash`（写回挂载目录、`NO_NET`）；`apps/daemon/test/tool-handler.integration.test.ts` 用「Docker 不可用探针 + host 策略」证明 Review 调用被容器检查拒绝；`broker.integration.test.ts`/`permissions.integration.test.ts` 既有真实容器用例仍绿。
- 对 T2 live 演练的影响：live 演练的 Runner 不走工具桥（无文件工具），故 Review/Test 固定容器只影响**工具调用路径**；若演练里出现 Review 角色的工具调用且本机无 Docker，会按文档被拒绝——记录在案。

### 8.4 交还声明

- `packages/core/src/control-http.ts`、`packages/core/src/execution.ts`、`apps/daemon/src/{main,protocol,control-handler,tool-handler}.ts`：**本切片无进一步改动计划，可交还**（下一个切片 T4b/T9/T5 可直接接手）。
- `apps/runner/src/{control-client,attempt,cli,tool-client,tools}.ts`：同样可交还；唯一待办是 **T2 文件内重复的 genesis 字面量**（本切片已提到 `@agentdev/contracts`，由 T2 决定是否改为 import）。
- 本切片仍登记的缺口见 §7.4/§7.6（`context_request`/`request_dispatch` 工具**本轮已注册**，该条已关闭；其余不变）。

### 8.5 实测（轮 3 最终值）

| 命令 | 退出码 | 结果 |
|---|---|---|
| `pnpm typecheck` | 0 | 无诊断 |
| `pnpm test:unit` | 0 | `Test Files 73 passed (73) / Tests 1375 passed (1375)`，14.43s |
| `pnpm test:integration` | 0 | `Test Files 40 passed (40) / Tests 430 passed (430)`，132.55s |
| `pnpm docs:check` | 0 | `docs:check ok — 16 documents, 65 internal links, 94 acceptance cases, 9 requirements, 11 work packages` |
| `pnpm build` | 0 | 9 个包全部构建成功 |
| `pnpm lint` | 1 | 唯一失败为 **3 个 T2 车道文件**：`apps/runner/test/read-ledger.test.ts`、`packages/core/test/gateway-http.test.ts`、`scripts/lib/live-drills.mjs`（均为格式/未使用变量），本切片文件 lint/prettier 全绿 |

轮 3 期间修正的自身 lint：`no-constant-condition`（`...(true ? {...} : {})` → 直接展开）、5 处 `no-base-to-string`（控制工具参数统一走 `textOf`）、2 处 `require-await`、1 处 `unbound-method`、1 处控制端点 `choices` 元素 stringify。

**改动的 T2 文件（均留头部「改动人」说明，供 T2 复核）**：`apps/daemon/test/assessment-dispatch.integration.test.ts`（空 seal 常量，轮 2）、`apps/runner/test/attempt.integration.test.ts`（控制工具集合断言随 `execution.md` §7 的完整注册而更新，轮 3）。

---

## 9. T3b：真实纵向链路（测试与装配修正）

### 9.1 交付与结论

- 新增 `apps/daemon/test/tool-bridge.integration.test.ts`：用**真实 `createProjectExecution` 且真正传 `tools:`**（此前无任何测试这么构造）、真实 `openProject`、真实 `apps/runner/dist/cli.js` 子进程、真实控制端点/Broker/Grant/读账本，只有 **Provider 那一层**是脚本桩（`GatewayTransport` 返回 `tool_calls`）。流程：真实消息 → 真实 Work+授权+`baseRevision` → Chief 真实子进程提交 assessment → 真实 `plan.approve`（用户动作，Core 物化 Task 并排队专业 Run）→ 专业 Run 真实子进程 `read` → `edit` → `stage_yield`。断言覆盖：文件真实内容变化、`changedPaths` 回写、`tool.invoked` 审计、`stage_result.readLedgerSeq/Hash` == Core 账本绑定、Attempt 结束后工具进程组清零与 Grant 撤销。
- **该 drill 已被 park（`it.skip`）**：它暴露了一个**本切片无法关闭的真实阻断**（见 §9.3-1），park 时保留完整复现命令与归属说明，确保套件不红、修复后可直接 unskip。

### 9.2 该 drill 已经证明 / 暴露 / 修了什么

- **证明（实测观察，非推断）**：真实装配可执行——`createProjectExecution({tools})` 组装成功；真实 Supervisor 认领 Chief Run 并创建 Attempt；真实 Runner 子进程被拉起（`supervisor: … attempt … started (pid …, epoch 1)`）。这条链路此前只由 typecheck/build 保证。
- **暴露并修（本切片内，`packages/core/src/context-stage.ts` 新增）**：`apps/daemon/src/protocol.ts` 的 `queueApprovedRun` 用 `stage: 'develop'` 排队专业 Run，而 `ROLE_STAGES`/`CONTEXT_STAGES` 只认 `develop-L1/L2/L3`。后果：由 `plan.approve` 排队的专业 Run **铸不出任何文件 Grant**（`validateGrantIssueRequest` 的 role/stage 校验失败）且读账本被标 degraded → 文件工具不可用、`stage.submit` 被 `MISSING_CONTEXT` 拒绝。已在 `grants.ts`（铸造与准入两侧统一取规范 stage）与 `read-ledger.ts`（ACL 用规范 stage）接入一个**窄口径映射**（仅把裸 `develop` 按 `work.level` 映射为 `develop-L1/L2/L3`；已是规范 stage 时为恒等；未知拼写仍 fail-closed）。**根因在 `protocol.ts`（现归 T4b）**：最小修复是 `queueApprovedRun` 直接发规范 stage，届时该映射可删。
- **暴露但未修（阻断，见 §9.3）**：真实 Runner 无法用 daemon 写的 per-Attempt `models.json` 建立会话。

### 9.3 本切片无法关闭的阻断与缺口（逐条 + 归属）

1. **【阻断，非本切片】Runner 的 catalog 交接不生效**：`apps/daemon/src/runner-spawn.ts` `writeAttemptCatalog` 产出的 `models.json` 未被 Pi SDK 采纳，真实 Runner 在 `attempt.ready` 之前就退出。
   - 复现（真实命令）：`node apps/runner/dist/cli.js --attempt-id <uuid> --epoch 1 --provider agentdev-gateway --model <id> --cwd <dir> --agent-dir <dir> --models-path <attemptsDir>/<attemptId>/models.json --role backend --work-id <uuid> --control-url <url> --self-check` → `{"type":"attempt.error","code":"MODEL_UNAVAILABLE","message":"model agentdev-gateway/<id> is not in the catalog"}`。
   - 复现（库级）：`PiSessionFactory.create({cwd, agentDir, modelsPath: <该文件>}).listModels()` 返回**内置 1354 条目录**且不含 `agentdev-gateway` → 该文件被 SDK 的 `ModelConfig` 加载器忽略/拒绝。
   - 归属：写入侧 `apps/daemon/src/runner-spawn.ts` + `prepare-run.ts`（T2/T10）；若最终定位到选项透传，则 `packages/pi-runtime/src/session.ts`（T3）负责。**注意**：既有 e2e/live 用脚本化 Runner 入口（`AGENTDEV_RUNNER_ENTRY`），`attempt.integration.test.ts` 用内置目录，因此这条真实路径此前从未被任何测试覆盖——这正是 T3b 的价值。
2. **`queueApprovedRun` 的 `stage: 'develop'`（根因）**：`apps/daemon/src/protocol.ts`（T4b）。最小改动：发 `develop-L{level}`（或调用 `canonicalContextStage`）。本切片的兼容映射已在 §9.2 说明，修复后应删除。
3. **`bash`/环境操作的许可链在产品上不可达（跨切片，需产品/契约决定）**：`assertGrantWithinMessage` 明确拒绝消息级环境操作，`assertDerivableScope` 也拒绝派生授权携带环境操作，而 `validateGrantIssueRequest` 要求 operation ∈ Work 信封 → 用户即使批准 `permission.request(operation=bash)` 也铸不出 Grant。建议的最小修法（T3 可做，若授权）：把「已接受的 `permission` Decision」视为该 operation 的授权来源（`GrantStore.issue` 仅在 `decisionId` 为 accepted permission Decision 时把该 operation 并入信封），这样 AC-049/080 的逐次批准链才真正可用；否则 6 项轮 2 里的 `bash` 批准只停留在端点层证据。
4. 其余跨切片/环境缺口（确认本切片无法关闭）：容器内 Unix Socket 代理、容器化 Runner、每 Task worktree（Q-T3-8）、secret 的“工具声明所需 secret”触发面、`bash`/`git` 读取未入读账本、`decision_request` 的 Inbox 渲染（T4）。归属见 §7.4/§8.2/§8.3。

### 9.4 每条 AC 应引用的测试/命令（供 Settlement 登记，本切片不改验收文件）

| AC | 应引用的证据 |
|---|---|
| AC-048 Workspace/容器边界 | `packages/core/test/tool-http.integration.test.ts`（真实 HTTP+Git+符号链接+**真实容器** `agentdev/exec:0.0.0` 写挂载/`NO_NET`）；`apps/daemon/test/tool-handler.integration.test.ts`（角色门、`~`/绝对路径、Review 固定容器且无 Docker 拒绝）；`packages/core/test/broker.integration.test.ts`（既有真实容器读） |
| AC-049 范围内自动/超范围批准 | `packages/core/test/permissions-bridge.test.ts`（run Grant 铸造+撤销+limits）、`apps/daemon/test/tool-permission.integration.test.ts`（真实 `WorkbenchProtocol`：pending→approve→once Grant→`permission.resolved`；deny 不铸）、`apps/runner/test/tool-client.test.ts`（Runner 侧 `NOT_AUTHORIZED`→`permission.request`） |
| AC-050 Full Access 宿主门禁 | `apps/daemon/test/tool-handler.integration.test.ts`（host 策略下 Review 仍被容器检查拒绝；backend host 路径）；`packages/core/test/broker.test.ts`（既有只读角色写门） |
| AC-051 Secret 隔离 | `apps/daemon/test/tool-handler.integration.test.ts`「injects the tool-audience secret a Grant covers, and only then」（有 Grant 才有值、审计事件不含值）；`packages/core/test/permissions.integration.test.ts`（既有诱饵扫描） |
| AC-080 授权精确绑定/重放 | `packages/core/test/tool-http.integration.test.ts`（同 id 同 hash→`replayed`、同 id 异 hash→`IDEMPOTENCY_CONFLICT`、真实文件不被二次处理）、`packages/core/test/grants.integration.test.ts`（跨进程重放）、`packages/core/test/tool-broker.test.ts`（`maxCalls/maxBytes/maxDurationSec`→`BUDGET_EXCEEDED`） |
| AC-085 证据读取封口 | `packages/core/test/read-ledger-seal.integration.test.ts`（顺序/重复读 append、placeholder 拒绝、seal 后拒 append、`STALE_ARTIFACT`/`VALIDATION_ERROR`/`MISSING_CONTEXT`）、`apps/daemon/test/tool-handler.integration.test.ts`（读入账本 + 响应回传绑定）、`apps/runner/test/tool-client.test.ts`（Runner 空 seal 派生 + 采用 Core 绑定）、`packages/core/test/tool-http.test.ts`（两种结果形状都带 `ledger`） |
| AC-013 无批准 Plan 拒绝 | `packages/core/test/base-revision.integration.test.ts`（真实 Git+真实 `requestCodeWrite` 从 `GATE_NOT_READY` 到 `allowed`）、`apps/daemon/test/tool-handler.integration.test.ts`（Plan 门 fail-closed + 源码 Hash 不变） |
| AC-032 context.request / AC-045 调度请求 | `apps/daemon/test/control-requests.integration.test.ts`（ACL 内读入账本、越权→`chief_action_required`、`agent.request_dispatch` 只发事件不建 Run） |
| AC-015/016 产品决定 | `apps/daemon/test/control-requests.integration.test.ts`（`decision_request` → `kind=decision` Artifact + `targetRef` + `decision.created`；`decision.resolve` accept 落 accepted、decline 走 product-behaviour 分支） |

### 9.5 T3b 实测（串行）

| 命令 | 退出码 | 结果 |
|---|---|---|
| `pnpm typecheck` | 0 | 无诊断（本切片文件与 T4b 已落地的 `protocol.ts` 均通过） |
| `pnpm test:unit` | 0 | `Tests 1397 passed (1397)` |
| `pnpm test:integration` | 1 | `Test Files 39 passed | 3 failed | 1 skipped (43)`、`Tests 445 passed | 4 failed | 1 skipped (450)`；**4 个失败全部在其它车道**：`apps/daemon/test/requirement-commands.integration.test.ts`（T4b）、`apps/web/test/inbox.integration.test.ts`（T4c）、`apps/web/test/workbench.integration.test.ts` ×2（T4/T9）。本切片文件 0 失败；`tool-bridge.integration.test.ts` 计为 **1 skipped**（见 §9.3-1） |
| `pnpm docs:check` | 0 | `docs:check ok — 16 documents, 65 internal links, 94 acceptance cases, 9 requirements, 11 work packages` |
| `pnpm lint` | 1 | 失败全部非本切片：`apps/daemon/src/protocol.ts:3101`、`apps/daemon/test/requirement-commands.integration.test.ts` ×3（T4b）、`apps/web/public/app.js`（`DOMParser` no-undef）、`apps/web/test/pages.test.ts`（unsafe spread）；本切片文件 0 命中 |
| 定向：`pnpm exec vitest run --project integration apps/daemon/test/tool-bridge.integration.test.ts` | 0（skip） | `1 skipped`；park 前最后一次真实运行 33s，诊断输出：`work=queued live=1 runs=chief:starting attempts=starting provider= logs=…attempt…started (pid …, epoch 1)` → 证明装配/认领/子进程拉起均真实发生，卡在 Runner 会话建立 |
| 阻塞复现命令 | — | `node apps/runner/dist/cli.js … --models-path <attemptsDir>/<attemptId>/models.json --self-check` → `{"type":"attempt.error","code":"MODEL_UNAVAILABLE","message":"model agentdev-gateway/<id> is not in the catalog"}`；`PiSessionFactory.create({modelsPath: <该文件>}).listModels()` → 内置 1354 条、无 `agentdev-gateway` |

**未触碰**：`scripts/**`、`docs/delivery/acceptance.md`（AC 证据登记清单见 §9.4，交由 Settlement）。

---

## 10. 轮 4（A/B/C 三项裁决）

### 10.1 A：环境操作 Grant 铸造（已实现 + 逐条测试）

**实现（`packages/core/src/grants.ts` + `permissions.ts`）**：
- `GrantStore.issue` 现在：① 校验引用 Decision 的 `workId === work.id`（此前不校验，属加固）；② 计算 **widening**：仅当 `kind='permission' && state='accepted' && choice='approve'`、`scope==='once'`、该 operation 确实不在 Work 信封内、且 `decision.targetRef.hash === permissionBindingHash({operation, targets, toolOperationId, inputHash})` 时，把**这一个 operation** 并入用于校验的信封；③ paths/budget 等其它维度仍由 `workScope` 与 `validateGrantIssueRequest` 决定（不放宽）。
- `permissionBindingHash` 与 `ToolGrantService.requestPermission` 写 `targetRef.hash` 用同一函数，因此「已批准的决定」不可被改指向另一个 operation/路径/toolOperationId/inputHash。
- `approvePermission` 改为**同一事务内先把 Decision 置 accepted、再铸 Grant**（否则 `issue` 看到的是 pending，永远无法 widening）；铸失败即整体回滚，不会留下「批准了但没铸出」的决定。

**逐条测试（`packages/core/test/permissions-bridge.test.ts`，真实 SQLite，13 例）**：
1. 完全没有批准 → `NOT_AUTHORIZED`，无 Grant；
2. pending / 已 rejected / 非 permission（product）决定 → 一律 `NOT_AUTHORIZED`；
3. 别的 Work 的已接受 permission 决定 → `NOT_AUTHORIZED`；
4. 已接受决定被改指向另一个 operation / 另一个 targets / 另一个 inputHash / 另一个 toolOperationId → 全部拒绝，且只有精确绑定那一次铸出（1 条 Grant）；
5. 路径维度不放宽：`delete_data` 指向 Work 未授权路径 → 即使批准也拒绝；
6. once/原子/hash 绑定：同 operation+hash 重放返回原结果，异 hash → `IDEMPOTENCY_CONFLICT`；重复批准 → 抛错，不铸第二条。

**真实端点（`packages/core/test/tool-http.integration.test.ts`，12 例）**：该文件的 Work 信封**移除了 `bash`**，环境操作只能靠批准进入——未批准时真实 HTTP `tool.execute bash` → 401 `NOT_AUTHORIZED`；经 `ToolGrantService.requestPermission`→`approvePermission` 真实链路铸造后同一次调用 → 200 并返回 `hi`；换一次 `bash`（不同 toolOperationId/输入）→ 409 `IDEMPOTENCY_CONFLICT` 且**不落** `tool_operation` 行（只有被准入那一条）。该文件的 limits 与真实容器用例也改为经批准链铸造。

### 10.2 B：删除 `context-stage.ts` 映射

T4b 已在 `queueApprovedRun` 按 `rules/workflow.md` §2 用 `work.level` 产出规范 stage（`develop-L1/L2/L3`，源码注释明确引用 T3 的发现）。因此：
- **删除** `packages/core/src/context-stage.ts` 及其 `index.ts` 导出；
- `grants.ts`（铸造与准入两侧）与 `read-ledger.ts` 恢复使用**生产者给的 stage 原值**；未知拼写不再被映射，而是自然 fail-closed（找不到 ACL 行 → 账本 degraded / `MISSING_CONTEXT`）；
- 相关测试（`permissions-bridge`、`read-ledger-seal`、`grants`）全绿。

### 10.3 C：纵向断言（unskip 状态与结论）

- `apps/daemon/test/tool-bridge.integration.test.ts` 已 **unskip**，断言强度未降。
- **新增的 `MODEL_UNAVAILABLE` 诊断立刻定位了此前的不透明排障**：`packages/pi-runtime/src/session.ts` 现在把 `modelsPath`、SDK 的 catalog 加载错误（`ModelRuntime.getError()`）与已加载 provider 列表写进错误信息。正是它查出我手工 catalog 的 `reasoning` 字段类型错误（SDK schema 要求 boolean；T2 的 `prepare-run.ts` 现在传 `frozen.profile.reasoning !== 'off'`，并加了 `inspectCatalog` 守卫）。
- **真实 Runner 与 T3 工具注册已被直接证明**（与 daemon 无关的独立命令）：
  `node apps/runner/dist/cli.js … --models-path <真实 catalog> --role backend --control-url <url> --self-check`
  → `attempt.ready{provider:"agentdev-gateway",tools:["read","search","edit","write","bash","git","artifact_write","stage_yield","request_dispatch","context_request"],droppedTools:[]}`（无 `--control-url` 时 `tools:[]`）——即 `execution.md` §7 的完整角色工具集在**真实 Runner** 中激活。
- **纵向 drill 仍失败（未解决，需 T2/父代理）**：真实子进程被拉起、Attempt 进入 `starting`、Supervisor 记 `started (pid …)`，但 **30s 内既无 `attempt.ready`、也无 stderr、也无 error/park**，`run/attempt` 都停在 `starting`。诊断尝试：用 `AGENTDEV_RUNNER_ENTRY` 包一层透明 tee（允许清单里含该变量、端口也从 `options.env` 读取它）以便看到子进程流，结果 tee **从未被执行**（无 ARGV 记录）——说明该 harness 下入口重定向没有生效，或子进程在打印任何东西之前就被挂住。已把 tee 移除（保持 drill 用 shipped 入口）。
  - 归属与建议：`apps/daemon/src/runner-spawn.ts`（T2）目前**只转发 stderr**，stdout 的 IPC 消息不落日志，因此「静默子进程」不可诊断。建议由 T2 在该端口加一条 stdout 诊断（或在 `prepare-run` 记录 spawn argv/pid），我拿到子进程真实输出后继续；或 T2 直接给出在他们的 e2e 里驱动真实 Runner 的方式（现有 e2e 用 `AGENTDEV_RUNNER_ENTRY` 指向**脚本化**入口，所以真实会话路径确实没被走过）。

### 10.4 轮 4 实测

| 命令 | 退出码 | 结果 |
|---|---|---|
| `pnpm typecheck` | 0 | 无诊断 |
| `pnpm test:unit` | 0 | `Tests 1404 passed (1404)`，11.66s |
| `pnpm test:integration` | 1 | `Test Files 1 failed | 42 passed (43)`、`Tests 1 failed | 453 passed (454)`；**唯一失败是 T3b 纵向 drill**（阻断见 §10.3），其它车道全绿 |
| `pnpm lint` | 1 | 失败全部非本切片：`apps/daemon/src/prepare-run.ts`、`apps/runner/test/read-ledger.test.ts`（T2/T4b 车道）、`packages/core/test/gateway-http.test.ts`、`scripts/lib/live-drills.mjs` |
| `pnpm docs:check` | 0 | `docs:check ok — 16 documents, 65 internal links, 94 acceptance cases, 9 requirements, 11 work packages` |

### 10.5 结论

A（环境操作批准铸 Grant）与 B（删除 stage 映射）**已按裁决完成并逐条测试**；C 的 drill 保持 unskip、断言未降，但被 §10.3 的「真实子进程静默、端口不转发 stdout」卡住——需要 `apps/daemon/src/runner-spawn.ts`（T2）侧一条 stdout/argv 诊断或等价指引后才能继续。本切片文件 typecheck/lint 全绿；唯一红灯是本 drill 自身。

## 11. 轮 5：T3b 纵向 drill 转绿 + 它暴露的账本漏洞（已修）

### 11.1 阻断解除过程（真实证据，不是猜测）

T2 的 spawn 诊断（`AGENTDEV_SPAWN_DEBUG=1`）把子进程**入站**消息打进日志后，链条一次跑通到 `stage.submit`；剩下的唯一红灯是 `stageRow.readLedgerSeq === 0`。日志给出了确定原因：

```
runner[...] ← attempt.event (+966ms) event=tool_start tool=read
tool-handler: read ledger append failed for <attempt>: 路径不在 readScope 内：docs/notes.md
tool-endpoint: ... read executed
...
control-endpoint: ... stage.submit success
```

即：**Broker 准入的范围（Work 授权）与读账本准入的范围（Run 的 `(role, stage)` ACL）是两个不同的问题**。

1. drill 原来的 `docs/notes.md` 在 `openProject` 的 `documentRoot: 'docs/agentdev'` 与 `codeRoot: 'src'` 之外，因此 `acl.scopeFor('backend','develop-L2')` 不含它 → `ledger.append` 拒绝；
2. 但 Work 授权（Assessment 从用户消息提取的 read/writePaths）确实覆盖它 → Broker 放行，模型**真的读到了内容**；
3. 旧代码只 `log(...)` 后继续，于是 Runner 报 `seq=0`、`verify` 在**空账本**上「验证通过」、`stage_result` 落库 `read_ledger_seq=0` —— 交付声称「验证所依据的读就是这些」，而实际上有一次读不在账本里。这正是 AC-085 不允许的**假认证**。

### 11.2 修复一（主）：范围检查前移到**准入层**，越范围读被拒且不产生内容

按 `context.md` §1「追加读取只能在readScope内…需要读更广范围由context.request返回Chief处理，**授权未完成不读取**」：越范围的读取必须被**拒绝**，不能「读了但只记一条日志」。

- `packages/core/src/read-ledger.ts`：新增 `ReadLedgerRegistry.admitsPath({attemptId,runId,role,stage,revision,path})`——用与 append 同一条规则（`context/acl.ts` 的 `canRead` + 该 Attempt 的 `readScope`）在**读之前**判定，返回 `{ok:true}` 或 `{ok:false, code:'CONTEXT_FORBIDDEN'|'MISSING_CONTEXT', message}`。来源类别由 `bridgeSourceKind` 复刻 ledger 的 `sourceForPath`（`features/…`→`knowledge`、`artifacts/…`→`artifact`、其余`git`），并有「准入与 append 逐路径一致」的对照用例，准入与本账本因此不可能各说各话：它放行的路径，`record` 一定收得下。
- `apps/daemon/src/tool-handler.ts`：`read`/`search` 在**调用 Broker 之前**过 `admitsPath`；不通过则（a）`recordOutOfScope(...)` 把越权请求记入同一 ledger（AC-032），（b）抛 `ProtocolError('CONTEXT_FORBIDDEN', '…需经 context.request 由 Chief 处理（context.md §1）')`。此时**不读文件、不落 `tool_operation`、不进 read ledger**，端点层照 §7 写一条 `tool.refused` 审计。
- `packages/core/src/control-http.ts`：`statusForControlCode` 补 `CONTEXT_FORBIDDEN → 403`（此前落到 default 500，与 §7 错误表不符）。
- `docs/architecture/protocol.md` §6 写明该准入规则与「读了但不入账不是允许的降级」。

### 11.3 修复二（兜底）：准入但无法记账的读 → fail-closed

- `packages/core/src/read-ledger.ts`：新增 `markUnverifiable(attemptId, message)`（复用内部 degraded 语义）。存在一条**已被准入**却记不进账本的读（预算/封条竞态/账本打不开）时，该 Attempt 的任何 binding（含空 binding）在 `verify` 都返回 `MISSING_CONTEXT`。
- `apps/daemon/src/tool-handler.ts`：`readLedgers.record()` 失败时不再只打日志，同时 `markUnverifiable(...)`，于是 `stage.submit` 拒绝该交付，而不是认证一个 Core 已知不完整的账本（§11.1 的假认证路径就此关闭）。

### 11.4 修复三：drill 用真实在范围内的路径 + 消除「断言读已释放内存」的竞态（断言强度未降）

- `NOTE` 由 `docs/notes.md` 改为 `src/notes.md`（Project `codeRoot` 之内）：drill 证明的是**正向 AC-085 绑定**（读 → 账本 → 封条 → `stage_result`）；越范围负例由 11.2 的准入用例承担，不再由 drill 兼职。
- 新增 `backendGate`：后端脚本第 4 轮 await 该 gate，使 Attempt（及其账本）在断言期间**仍然存活**，因此 `binding = execution.readLedgers.binding(stageRow.attemptId)` 读的是真实内存账本，而不是 `execution.ts` 按设计 `release` 后的空值（T2 指出的最后两条断言问题）。断言 `binding.seq >= 1`、`stageRow.readLedgerSeq === binding.seq`、`stageRow.readLedgerHash === binding.hash`、账本条目含 `NOTE`；随后 `resolveBackendGate()` 再断言进程组回收与 Grant 撤销。
- `ScriptedProvider` 的 isChief 判定读 `tool.function?.name` 并兼容扁平 `{name}`（T2 根因 1：网关透传 SDK 的 OpenAI 形状，此前 isChief 恒 false，Chief 跑了 backend 脚本、从不提交 assessment）。
- T2 的根因 2（`attempt.ready` 后 `markWorkRunning`）已在树上，本 drill 的 `work.status === 'running'` 断言据此成立，无需改动。

### 11.5 新增/修改的测试（真实 SQLite / 真实 Broker / 真实 Runner 子进程）

| 文件 | 用例 | 断言 |
|---|---|---|
| `apps/daemon/test/tool-handler.integration.test.ts` | `refuses a read outside the Attempt readScope at admission, leaking nothing` | `CONTEXT_FORBIDDEN`（403 映射）；错误文本**不含文件内容**；`toolOperations.count() === 0`（Broker 未被调用）；账本 0 条且未 degraded |
| `packages/core/test/read-ledger-seal.integration.test.ts` | `admits only paths inside the readScope, before anything is read (AC-032)` | 范围内 `ok`；`README.md` → `CONTEXT_FORBIDDEN` 且 message 含 `readScope`；账本仍为空封条 |
| `packages/core/test/read-ledger-seal.integration.test.ts` | `agrees with the ledger append on artifact and feature paths` | 逐路径比较 `admitsPath(...).ok === record(...).ok`（`features/…`/`artifacts/…`/`docs/…`），且账本 `seq` 恰等于被准入的条数——没有「准入却记不上」的路径 |
| `packages/core/test/read-ledger-seal.integration.test.ts` | `refuses to certify an Attempt whose admitted read could not be recorded` | 兜底：`markUnverifiable` 后同一 binding → `MISSING_CONTEXT`；`stage.submit`（含空 binding）抛错且 `stageResults.count() === 0` |
| `apps/daemon/test/tool-bridge.integration.test.ts` | T3b 纵向 drill（unskip） | 见 11.4：全链真实通过 |

### 11.6 轮 5 实测（串行，最终树）

| 命令 | 退出码 | 结果 |
|---|---|---|
| `pnpm typecheck` | 0 | 无诊断 |
| `pnpm test:unit` | 0 | `Test Files 75 passed (75)`、`Tests 1407 passed (1407)` |
| `pnpm test:integration` | 0 | `Test Files 44 passed (44)`、`Tests 472 passed (472)`（含此前唯一红灯 T3b drill） |
| `pnpm exec vitest run --project integration apps/daemon/test/tool-bridge.integration.test.ts` | 0 | `Test Files 1 passed (1)`、`Tests 1 passed (1)`（纵向 drill 单跑，约 3–5s） |
| `pnpm docs:check` | 0 | `docs:check ok — 16 documents, 65 internal links, 94 acceptance cases, 9 requirements, 11 work packages` |
| `pnpm lint` | 1 | 3 处全部非本切片、属 T2 在制：`apps/daemon/src/prepare-run.ts:179`、`apps/daemon/test/prepare-run-context.integration.test.ts:28,187`；本切片 6 个改动文件 `prettier --check` 与 eslint 全绿 |
| `pnpm build` | 0 | `apps/runner`/`apps/daemon` Done |

（注：全量 integration 首跑曾出现 1 例 `apps/cli/test/doctor.integration.test.ts` 的 Docker 负载型 flake，单独重跑 9/9 通过；随后两次全量重跑均 44/44 全绿。）

### 11.7 轮 5 追加缺口（归属，不在本切片关闭范围）

- **两个授权系统的口径不一致（产品层，仍未裁决）**：Work 授权（用户消息 → Assessment scope）可以覆盖 Run 的 `(role, stage)` readScope 之外的路径。现在的处置是**在准入层拒绝**（`CONTEXT_FORBIDDEN`，由 Chief 经 `context.request` 走加宽流程），因此「用户明确要求改 `docs/notes.md`」的交付需要一次 context 加宽才拿得到内容，而不是被静默放行。口径是否统一（是否让授权自动成为 readScope 的一部分）属于 context 侧（`context.md` §1 / `acl.scopeFor`）的裁决——归属 T4b/上下文切片。
- `recordOutOfScope` 仍把请求拼成 `artifact` ref（`read-ledger.ts`），对 code/doc 路径可能被 `requestExpansion` 的 artifact 类规则拒绝（该失败只被容忍、不伪装成功）。是否改为按路径归属 `git` 来源属 context 切片。
- 其余缺口同 §9.3（容器内 Unix-socket 代理、容器化 Runner、per-Task worktree、secret 触发面、`bash`/`git` 读不入账本、Inbox 渲染、`permission.respond` run 级放宽、验收登记）。
