# WP-12 可靠性欠账收口（重复派发 / 证据生命周期 / 租约 / L3 遗留）

- 状态：**Developing（四条欠账已逐条复现并修复/裁决，收尾门禁全绿见 §5；未提交，待独立 Review/Test）**
- 依据：`.agentdev/work/WP-12/settlement.md` §4、`.agentdev/work/WP-12/w4b-implementation.md` §9.8、`.agentdev/work/WP-12/w5-test-execution.md` §7、`.agentdev/work/WP-12/l3-confirmation.md` §9
- 授权来源：本轮任务书（用户对欠账清单、复现要求、证据与门禁的直接指令）
- 改动范围：`packages/core/src/{orchestrator,stage,execution}.ts`、`apps/daemon/src/{tool-handler,main}.ts`、`docs/architecture/execution.md` 与测试；未改 `apps/web/**`、`packages/workspace/**`、`docs/delivery/**`、`docs/product/**`，无新运行时依赖，无迁移。

---

## 0. 结论

| # | 欠账 | 复现 | 修复/裁决 | 证明 |
|---|---|---|---|---|
| 1 | 重复阶段派发多排一个 Run | 有（先失败） | 在 `Orchestrator.dispatch()` 加单步准入 | `orchestrator.test.ts` 新用例 + 真实门禁 |
| 2 | Test 证据登记表在进程内、重启 fail-closed | 有（先失败） | 文档支持**在途证据不持久化**；错误文本写明"Attempt 级、未持久化、重启即丢失" | `test-evidence.test.ts` 新用例 + `execution.md` §5 修订 |
| 3 | (a) 被拒调用也占写租约 | 有（先失败） | 写租约改为"准入通过后、执行前"取得，Broker 拒绝即归还 | `tool-handler.integration.test.ts` 两用例 |
| 3 | (b) 交付被接受后不释放 worktree 租约 | 有（先失败） | `execution.ts` 把栈自己的 `release` 端口交给 daemon，`main.ts` 转交 control handler | `workspace-lease-lifecycle.integration.test.ts` |
| 4 | L3 遗留 | — | (b) 给出文档依据并判定 `Recovery` 不属于 `deliveryRoute`；(c) 记为待裁决产品问题；(a) 判定当前不可达并登记 | 见 §4 |

## 1. 欠账 1：一次阶段转移只排一个 Run

**复现（先失败）**：`packages/core/test/orchestrator.test.ts` 新增用例"queues exactly one Run when two triggers dispatch the same route step (WP-12 debt 1)"：同一个 Chief 对同一 Work 连续两次 `dispatch` `role=review, stage=review`。把 `packages/core/src/orchestrator.ts` 暂存回修复前版本后单跑该用例 **1 failed**（第二个 Run 被真的建出来）。

**根因**：路线推进有两个触发者。`protocol.ts` `continueDeliveryRoute` 是 Core 的续跑入口，它只在 `liveForRole` 里按 **role** 去重；而 Chief 端 `agent.dispatch` → `control-handler.agentDispatch` → `orchestrator.dispatchProfessional` → `Orchestrator.dispatch()` 是另一条独立的排队路径。当 Chief 在 Core 已排队后再次派发同一步骤时，没有任何一处以"这一步"为单位拒绝它——`w4b-implementation.md` §9.8-1 记录的 Test 阶段 5 个 Run 就是这样叠加出来的。

**修复**：把不变量放在**唯一真正插入 Run 行的地方**——`Orchestrator.dispatch()`（`runs.insert`）。新增 `enforceSingleLiveStep(spec)`，在 professional 分支的预算准入之后、任何 snapshot 冻结之前调用：同一 `(workId, role, stage)` 已有非终态 Run 时以 `GATE_NOT_READY` 拒绝，`details` 带上 `existingRunId/existingStatus` 与 remedy。终态 Run 不影响重试（`workflow.md` §5.3）。

**为什么只覆盖 Plan/Review/Test/Settle**：`deliveryRoute` 每个角色恰有一个位置，所以同 `(work, role, stage)` 的第二个活 Run 必是重复；develop 阶段不在此列——一个已批准 Plan 可以派多个同角色同 `develop-Lx` 的 Task（文档化的多 Task DAG，不是重复），且 develop 的排队已有自己的幂等（`protocol.ts` `approvedRunIdOf` 绑定批准的 Plan artifact）。

**证明**：修复后 `pnpm vitest run --project unit packages/core/test/orchestrator.test.ts` → **64 passed**（新增 1 例），全套 unit 见 §5。

## 2. 欠账 2：Test 证据登记表的内存生命周期

**文档判定（先报告依据，再选择）**：

- `data.md` §3 把 `CheckResult` 定为 `stage_result` 的字段，`Env`/`inputTree` 都绑定**具体 Attempt**；
- `execution.md` §5 要求把"环境、依赖锁 Hash、命令、退出码、输出 Hash"写证据；
- `reliability.md` §2（Late 事件不得覆盖新 Attempt）与 §6（恢复用新 Attempt 延续）、§8/§9（证据随 Work 保留、随备份/恢复核对）。

即：**证据本身必须持久**（现状已满足：每条命令一个 `evidence` Artifact、`test.command_executed` 审计事件、被接受后写入 `stage_result`），但**在途判定按 Attempt 归属，不能跨重启复用**——`TestEvidenceRegistry` 是"这次 Attempt 正在执行的命令还没算完"的进程内粘合层，与同类的 `AttemptCapabilityStore`/`ReadLedgerRegistry` 一样是 Attempt 级。把它持久化反而会让一个已死 Attempt 的判定冒充新 Attempt，正是 §2/§6 禁止的方向。**故文档支持"在途证据 ephemeral、证据本体 durable"**，不引入迁移。

**复现（先失败）**：`packages/core/test/test-evidence.test.ts` 新增用例"states precisely that a daemon restart loses the Attempt evidence (WP-12 debt 2)"：用一个新的空 `TestEvidenceRegistry`（等价于重启后进程内状态）对一个 live Attempt 提交 `success`。修复前该拒绝文本是"still executing the project's declared acceptance commands"——**谎称命令仍在执行**；把 `packages/core/src/stage.ts` 暂存回旧版后单跑该用例 **1 failed**（消息不匹配 `/restart/`）。

**修复**：`StageGate.effectiveTestPayload()` 区分 `undefined`（本进程没有该 Attempt 的证据）与 `pending`（命令确实在执行）：前者以 `GATE_NOT_READY` 明确说明"证据是 Attempt 级、未持久化、重启即丢失；只能由新 Attempt 重跑 `policy.testCommands`，或以 `needs_input`/`failed` 诚实交付"，并给出 `details.evidence='missing'`；后者保持原文案。`docs/architecture/execution.md` §5 同步补一段"在途证据的生命周期"。

**证明**：`pnpm vitest run --project unit packages/core/test/test-evidence.test.ts` → **13 passed**。

## 3. 欠账 3：写租约生命周期

### 3a 被拒调用也占写租约

**复现（先失败）**：`apps/daemon/test/tool-handler.integration.test.ts` 新增两例：
1. Attempt A 在**没有 Plan gate** 时请求 `write` → 准入拒绝 `GATE_NOT_READY`；随后断言 `store.leases.find(workWriterLeaseResource(...))` 为 `undefined`，并让同 Work 的第二个 Attempt 正常 `read`（不再 `BUSY`）。
2. 无 `bash` Grant 的 `bash` → Broker 在取得租约之后拒绝 `NOT_AUTHORIZED`，断言租约已归还。

把 `apps/daemon/src/tool-handler.ts` 暂存回旧版后单跑两例 → **2 failed**（第一例拿到落在 `ATTEMPT_A` 名下的租约行，第二例租约仍在）。

**根因**：`handler.execute` 在入口处（`planToolCall`/Plan gate/读账本/网络策略/secret 之前）就对可写角色调用 `assertWriter`。任何后续拒绝都会把租约留给一个什么都没写的 Attempt；`reliability.md` §3 的单写者因此会误伤同 Work 另一个 Task 的合法写入。

**修复**：写租约改为在**所有准入检查之后、`broker.invoke` 之前**取得（此时才可能真的落盘），并在 `!outcome.ok` 时调用新增的 `releaseWriter()` 立即归还。角色不可写的调用仍然完全不需要该租约。单写者语义不变：两个 Attempt 仍串行在同一行上。

### 3b 交付被接受后不释放 per-Task worktree 租约

**复现（先失败）**：新增 `apps/daemon/test/workspace-lease-lifecycle.integration.test.ts`：真 `createProjectExecution` + 真 `createControlHandlers` + 真 Git worktree resolver。先用实现者的 Attempt 取得 worktree（第二个 Attempt 得 `BUSY`），再走真实 `stage.submit` 接受交付，最后让下一阶段的 Attempt 解析同一棵树。把 `packages/core/src/execution.ts` 暂存回旧版后单跑 → **1 failed**，报错正是 `worktree … 已由 attempt … 持有`。

**根因**：`control-handler.ts` 已在接受交付后释放 Work 级写租约（第 1076 行），但 per-Task worktree 租约的释放挂在 `options.releaseWorkspaceLease` 上，而**生产装配从未提供该端口**：`execution.ts` 调 `options.control.attach(...)` 时没有传它，`main.ts` 的 `attach` 也没有解构/转交。于是生产 daemon 里 worktree 租约要等 1 小时 TTL，同 Task 的下一阶段（Review/Test）解析即 `BUSY`。live 演练之所以没暴露，是 `scripts/lib/live-drills.mjs` 自己补了 `releaseWorkspaceLease`。

**修复**：`execution.ts` 捕获 `options.workspace` 并把 `releaseWorkspaceLease: (input) => workspaceResolver.release(input)` 交给 daemon 的 `attach`；`main.ts` 的 `attach` 解构该端口并转交 `createControlHandlers`。释放点仍在"候选提交读取文件之后"（既有位置），不把权限让给别的写者。

**证明**：修复后该用例通过；§5 门禁全绿。

## 4. 欠账 4：L3 遗留

### 4b `Recovery` 不属于 `deliveryRoute`（给出依据，判定为设计如此）

`STAGE_ORDER.code.L3 = Plan → Develop → Review → Test → Recovery → Settlement`（`packages/domain/src/delivery.ts`，AC-011 的 **Manifest 链**），而 `docs/rules/workflow.md` §3 的 L2/L3 代码**路线**是 `Product → Plan → Develop → Review → Test → Accept → Settle`；L3 运行操作路线另为 `Plan → Execute → Review → Verify → Settle`。`Recovery` 是 L3 交付必须携带的迁移/回退/逐项审核/恢复演练**证据**，不是"下一个要跑的专业 Run"：它由 delivery/recovery 门禁核对，并由真实迁移/恢复用例产生（`packages/core/test/delivery.integration.test.ts`、`packages/domain`/`storage` 的迁移用例、`packages/core/test/backup.integration.test.ts`）。因此 `deliveryRoute` 不含 `Recovery` 是正确的，不是缺实现；本切片在 `deliveryRoute` 的文档注释里写明了这条依据，不改投影。

### 4c "declined L3 不自动转 `later`"——待产品裁决（不在本切片自行决定）

两种选项（保持开放）：
- **选项 A（保持现状）**：`decline` 只把 Decision 置 `rejected`、保留 `blockerIds`，Work 停在 `blocked`；用户重新评估会再铸一条确认。语义最小，且拒绝是终局表达，不产生新的排队需求。
- **选项 B（自动转 `later`）**：`decline` 同时把对应需求放回需求池并标记 `later`（重新评估入口），把"现在不做"变成"以后再做"。这改变 `decline` 的既有产品语义，需要 `experience.md`/`workflow.md` 层面的产品裁决与新的 Decision/事件契约。

记录：本切片不实现任何一支，等待产品裁决（登记于 §6）。

### 4a L3 operation 路由 + `permission.request` 端到端演练——当前不可达，登记

核查结论：Core 的唯一续跑入口 `protocol.ts continueDeliveryRoute` 与提示词 `prepare-run.ts routeContinuationSentence` 都读同一个 `deliveryRoute(...)`，而该投影**只按代码路线**返回 `Plan/Develop/Review/Test/Settle`（`developStageFor(work.level)`），完全不区分 `work.intent`。`findings.ts deliveryRouteOfIntent` 虽然把 `operation` 映射为 `operation` 路线，但那只服务完成门禁，没有接到续跑投影。因此 `intent='operation'` 的 L3 Work 目前会被续跑成 Develop，而 `workflow.md` §3 的 `Plan → Execute → Review → Verify → Settle` 无对应 Run 位置——"把 L3 operation 路由与 `permission.request` 串起来"的端到端演练**没有可达的生产路径**（`permission.request` 自身由 `apps/daemon/test/tool-permission.integration.test.ts`、`tool-permission-runner.integration.test.ts` 覆盖）。让 operation 路线投影落地需要产品先定义 Execute/Verify 的角色与 stage 名，属新功能而非欠账修复，故如实登记待裁决（§6）。

## 5. 门禁（串行，收尾树）

| 命令 | 结果 |
|---|---|
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0（Prettier 全匹配） |
| `pnpm test:unit` | exit 0 — 80 文件 / 1493 用例（含本轮新增 2 例：欠账 1、欠账 2） |
| `pnpm test:integration` | exit 0 — 60 文件 / 550 用例（含本轮新增 3 例：欠账 3a 两例、欠账 3b 一例） |
| `pnpm test:e2e` | exit 0 — 31 checks，PASS 30 / FAIL 0 / UNVERIFIED 1；真实 Chromium 21 passed |
| `node scripts/live.mjs --no-write` ×3 | **exit 0 ×3，每次 7 passed / 0 failed / 0 unverified**（13 次 HTTP 200）；链路证据逐阶段 "each its own Run"（planning/develop/review/test/settlement 各 1 个 Run），说明单调度者修复没有误伤正常路线 |
| `node scripts/docs-check.mjs` | exit 0（16 文档 / 68 内链 / 94 AC / 9 需求 / 11 工作包） |
| `node scripts/acceptance.mjs` | **exit 0 — `94/94 ACs accounted — PASS 94 / ACCEPTED 0 / FAIL 0 / MISSING 0`**；`acceptance: OK`；证据层级 product-path 57 / library-level 37 / environment-limited 0；`codeDigest sha256:0d3c0a567f8968317a2eb2908d31a657bb4ad00f5797c7cf13e5be99b1ac3531`（gitTree `9ba5fb8d08e6e88ae3943dfb2056000a8286d53f`，364 代码文件），`gitHead e6cdac2`（工作区含本次未提交改动） |

复现证据（每条都先在修复前跑失败，再用 `git stash push -- <源文件>` 只回退该源文件复跑）：欠账 1 → orchestrator 用例 1 failed；欠账 2 → test-evidence 用例 1 failed；欠账 3a → tool-handler 两用例 2 failed；欠账 3b → workspace-lease 用例 1 failed。

## 6. 继续开放 / 待裁决

1. **L3 operation 路由投影缺失**（§4a）：`continueDeliveryRoute`/`routeContinuationSentence` 不按 intent 选择路线，operation 路线（Execute/Verify）没有 Run 位置。修它需要先定义角色/stage，属产品决定。
2. **"declined L3 是否自动转 `later`"**（§4c）：选项 A/B 如 §4。
3. **`w4b-implementation.md` §9.8-4**（`CompletionManifest.finalRevision` 与完成提交的顺序）与 §9.8-5（两条负载敏感集成用例）不在本切片范围，保持原登记。
