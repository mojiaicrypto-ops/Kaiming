# WP-12 T2-fix-delivery：让专业 Run 真正交付 stage 结果

- 状态：Developing（实现与真实验证完成；独立 Review/Test 不在本任务范围）
- 范围：`apps/daemon/src/prepare-run.ts`、`apps/runner/src/{attempt,control-client}.ts`、`packages/core/src/supervisor.ts`、`scripts/lib/live-drills.mjs` 及其测试
- 依据：`docs/architecture/protocol.md` §6、`docs/rules/workflow.md` §3、`docs/rules/agents.md` §1/§3/§4、`docs/architecture/execution.md` §7、`packages/core/src/stage.ts`、`packages/core/src/read-ledger.ts`、`packages/core/src/context/acl.ts`
- 结论：根因不在「模型不肯调用 `stage_yield`」，而在**派发/交付的契约与工具声明不一致**，导致专业 Run 的结构化交付被 Core 永久拒绝。全部改动只改提示词、工具描述与本地契约校验，没有放宽任何门禁。

---

## 1. 现象与前置证据

`drill.message-to-stage` 稳定失败：Chief Run `completed`，专业（backend）Run `contract_violation`，`stages=[...=none]`、`stageRejections=[none]`。HEAD 上的验收记录（`git show HEAD:.agentdev/work/WP-12/acceptance.md` AC-003）为：

```text
drill.message-to-stage: no stage result: professional Run … is contract_violation (attempts: lost/epoch0/…);
runs=[chief#…:completed:parent=-,backend#…:contract_violation:parent=…]; stages=[…=none,…=none];
```

本轮修复过程中用真实 Provider 复现并抓到了决定性控制日志（`.agentdev/work/WP-12/live-message-to-stage-failure.log`）：

```text
control-endpoint: refused 400 MISSING_CONTEXT: backend may not read at stage implement; no ACL row exists
control-endpoint: refused 409 STALE_ARTIFACT: the stage result is bound to read 0 but the ledger ends at 6 (AC-085)
supervisor: … ended without a structured result; model text: … All read tooling is denied …
supervisor: … delivered no structured result; corrective prompt sent
```

模型**确实**调用了 `stage_yield`（多次），只是每一次都被 Core 拒绝；第二次非交付之后走 `onAttemptResult` 的两次不合规路线 → `contract_violation`。任务书里「叫了 `request_dispatch`、没调 `stage_yield`」的表述是表象：`request_dispatch` 与 `stage_yield` 都被调用过，真正的阻断是下面三层契约不一致。

## 2. 根因（三层，全部在“交付契约”上）

### R1（决定性）`agent_dispatch.stage` 无约束，Chief 送出非规范 stage

- `agent_dispatch` 的 `stage` 曾是自由字符串，真实 Chief 模型送出 `stage: "implement"`。
- `Run.stage` 直接落库（`packages/core/src/orchestrator.ts:1060`），而 `ReadLedgerRegistry.ensure()` 用 `scopeFor(role, stage)` **原样**查 ACL（`packages/core/src/read-ledger.ts:140`），`ROLE_STAGES.backend = ['develop-L1','develop-L2','develop-L3']`（`packages/core/src/context/acl.ts:57`）。
- 于是该 Attempt 的 read ledger 被标记 degraded，`verify()` 对**任何** binding 都返回 `MISSING_CONTEXT`（`read-ledger.ts:376-383`）→ `StageGate.submit` 直接抛错，这个 Run 从生到死都不可能交付。
- 同一模型的 `role: "planner"` 也说明角色/目的同样缺少枚举，只是 Core 会先拒绝。

### R2 `context.request` 扩容后的 binding 没有回到 `stage_yield`

- 专业 Run 的读取走控制通道 `context.request`（不是工具桥），Core 在应答里返回 `ledger:{seq,hash}`（`apps/daemon/src/control-handler.ts:627-633`），read ledger 已到 seq 3/5/6。
- Runner 侧 `stage_yield` 的 seal 只来自工具桥（`tool-client.ts` 的 `readLedgerBinding`），它没见过控制通道的扩容，仍报 seq 0 → Core `STALE_ARTIFACT: … bound to read 0 but the ledger ends at 6 (AC-085)`，重试多少次都一样。

### R3 工具声明与 Core Schema 不一致（同类问题）

- `stage_yield` 把 `artifactRefs` 声明为 `string[]`（Core 要求 `{id,version,hash}` 的 `Ref`），把 `evidenceRefs`/`findingIds` 说成任意字符串（Core 要求既有行的实体 id，UUIDv7 或 32-hex）——真实模型照描述写 path/自由文本，必然被 `stageResultContentSchema` 拒绝。
- `agent_dispatch.contextSelection` 把 `featureRefs/codePaths/artifactRefs/excluded/unknowns` 声明为可选（Core 必填），`sourceRefs` 缺 `version`、`artifactRefs` 又是 `string[]`；`assessment_submit` 未给出 `riskFlags`/`operations` 的文档词汇。真实 Chief 因此在同一次演练里被连续拒绝两三次。
- 附带：`scripts/lib/live-drills.mjs` 的失败诊断只列事件名，看不到 `stage.failed` 的 Schema 拒绝原因，导致「没调用工具」与「调用了但被拒」无法区分。

## 3. 改动

### 3.1 `apps/runner/src/control-client.ts`（工具声明与本地契约校验）

- `stage_yield`
  - 描述重写：**恰好调用一次**；必填 `status`/`summary`；id 类字段是既有行的 id，绝不是路径/文件名/revision/散文；空列表可以省略；`readLedgerSeq/Hash` 由 Runner 注入；**纯文本不交付，`request_dispatch` 也不替你交付**。
  - `artifactRefs` 收紧为 `{id,version,hash}`，`summary` 要求非空。
  - 新增 `buildStagePayload()`：用 **Core 自己的 `stageResultContentSchema`** 校验（含 seal），未知字段、缺失 seal、Schema 不符都在本地返回 `VALIDATION_ERROR`，因此不会白白消耗 Core 的两次 Schema 机会；Core 仍然独立复验（`StageGate.submit` 未改一行）。
- `agent_dispatch`
  - `role`/`purpose` 收紧为文档枚举，`scope.operations` 收紧为 `operationNameSchema` 的 12 个操作名。
  - `contextSelection` 与 Core 对齐：`sourceRefs` 带 `kind` 枚举 + `version`（+可选 `path`/`hash`），`featureRefs/codePaths/artifactRefs/excluded/unknowns` 必填，`artifactRefs` 是 `Ref` 对象。
  - 新增 `canonicalStageFor(role, stage)`：按 `ROLE_STAGES` 校验并规范化（接受 Core 自己的别名 `develop→develop-L2` 等，`implement` 这类既非规范也非别名的值带合法清单拒绝）；再用 `professionalDispatchSpecSchema` + `missingSelectionReasons` 做本地草稿校验。
  - 描述里写明 `role/purpose` 词汇与「stage 必须是该角色的规范阶段，否则该 Run 读不到上下文、永远无法交付」。
  - `stage` 保持 `Type.String()` 而**不是** literal 并集：Pi 运行时会在 `execute` 前按 Schema 校验参数（`pi-agent-core` `agent-loop.js` 的 `validateToolArguments`），并集会把可规范化的运行时拼写（离线 stub 的 `develop`）挡在门外。规范词汇由描述给出、由 `canonicalStageFor` 执行。
- `assessment_submit`：描述补上 `riskFlags` 的文档词汇（identityOrPermission/secrets/securityBoundary/dataDeletionOrMigration/payment/publicProtocolBreak/deployOrRelease/gateRuleChange）与 `scope.operations` 的合法取值。
- `context.request`：把 Core 应答里的 `ledger:{seq,hash}` 记下来，新增 `ControlClient.ledgerBinding()`；畸形值不会覆盖已记下的好值。
- `request_dispatch`：描述补上「它不交付你的 stage，也不结束你的 Run；请求之后仍必须自己调用 `stage_yield`」，`requestedRole` 给出合法角色。

### 3.2 `apps/runner/src/attempt.ts`

- 新增 `stageSeal()`：按 `seq` 取「控制通道 binding / 工具桥 binding / 本地 genesis seal」三者中的**最大值**。read ledger 只增不减，最大 seq 就是当前末端；这样无论模型是通过 `context.request` 还是 `tool.execute` 读的，`stage_yield` 上报的都是 Core 真正持有的 binding。

### 3.3 `apps/daemon/src/prepare-run.ts`（角色提示词，WP-12 R3-2b 的扩展）

- 专业角色：明确三段职责——(a) 用自己的工具把这一阶段做完；(b) 用 `stage_yield` **恰好一次**交付，给出必填字段与各字段语义（`artifactRefs` 是 `{id,version,hash}`，`evidenceRefs/findingIds` 是既有行 id，`changedPaths` 是仓库相对路径），空列表可省略；(c) 只有确实需要别的角色时才用 `request_dispatch`，且**它不免除你自己的交付义务**；被卡住时 `status=failed/needs_input` + 原因就是诚实且有效的交付。
- Chief：补上「只能使用文档化的 role/purpose/risk-flag 词汇」与角色→规范阶段映射（product/planning/backend|frontend/review/test/settlement），并说明非规范 stage 会让该 Run 读不到上下文、永远无法交付。
- 该函数改为导出，便于单测固定这段话。

### 3.4 `packages/core/src/supervisor.ts`（唯一一次纠正提示）

- `contractReminder(role)` 的专业分支补上「恰好一次」「id 语义」「`request_dispatch` 不交付」；Chief 分支补上规范阶段映射。措辞与 `docs/rules/agents.md` §4、`protocol.md` §6 一致，门禁（两次不合规/两次 Schema 失败 = `contract_violation`）未动。

### 3.5 `scripts/lib/live-drills.mjs`（诊断）

- 失败时新增 `stageRejections=[…]`，把该 Run 的 `stage.failed(outcome=schema_invalid)` 事件里的 `rejection: reason`（Zod 明细）打进错误信息。这条诊断正是本轮定位 R3 的关键。

### 3.6 测试

- `apps/runner/test/control-client.test.ts`：最小 `stage_yield` 产出 Core 合法载荷（并用 `stageResultContentSchema` 复验）；path 写进 `evidenceRefs`/字符串写进 `artifactRefs` 被本地拒绝且不触网；未知字段本地拒绝；缺 seal 本地拒绝；`request_dispatch` 不交付的描述；`role/stage` 非文档词汇被本地拒绝并给出合法清单；`develop` 被规范化为 `develop-L2`；`contextSelection` 缺项与缺 reason 被本地拒绝；`context.request` 记录并保留 ledger binding。
- `apps/runner/test/attempt.integration.test.ts`：`stage_yield` 采用控制通道达到的 binding（seq 6）而不是工具桥的旧值（seq 2）。
- `apps/daemon/test/prepare-run.test.ts`：专业三段职责与 Chief 阶段映射的提示词断言。
- `packages/core/test/supervisor.test.ts`：纠正提示包含 `request_dispatch` 不交付。

## 4. 真实证据

### 4.1 真实 Provider 演练（`node scripts/live.mjs --no-write`，改动后连续 3 次）

三次都 `exit=0`，且每次都出现通过证据行（`stage.failed(needs_input)` 是**真实交付**，本演练只断言链路）：

```text
run 1: live: 7 passed / 0 failed / 0 unverified; 13 call(s), … 42438ms total, 0 failed
       real Provider no-seed chain: message 01a0a2fb-… → Chief Run 01a0a2fb-63eb-… (completed) →
       Requirement 01a0a2fc-6745-… (active/plan) → professional Run 01a0a2fc-84ac-… (parent 01a0a2fb-63eb-…) →
       stage result 01a0a2fc-eb05-… + stage.failed(needs_input) (a NON-successful stage was delivered …)
run 2: live: 7 passed / 0 failed / 0 unverified; 13 call(s), … 46685ms total, 0 failed
       stage result 01a0a2fe-3ca0-… + stage.failed(needs_input)
run 3: live: 7 passed / 0 failed / 0 unverified; 13 call(s), … 37361ms total, 0 failed
       stage result 01a0a2ff-94ad-… + stage.failed(needs_input)
```

通过那一次的控制日志（`AGENTDEV_LIVE_DUMP=1`）证明「请求派发 ≠ 交付」这条提示起了作用：

```text
control-handler: 01a0a2fc-84ac-… requested a planning dispatch
control-endpoint: 01a0a2fc-84ac-… agent.request_dispatch planning
control-endpoint: 01a0a2fc-84ac-… stage.submit needs_input
```

观察到的通过率：改动后**独立 `node scripts/live.mjs --no-write` 3/3**（100%），另有 5 次 `node scripts/acceptance.mjs` 里的 `pnpm test:live` 全部 `exit=0`（含最终全绿那次）；改动前同一脚本 5 次复现 5/5 失败（HEAD 验收记录亦为 FAIL）。

### 4.2 工程命令

| 命令 | 结果 |
|---|---|
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0（Prettier 全部匹配） |
| `pnpm test:unit` | 77 文件 / 1432 用例全通过 |
| `pnpm test:integration`（定向 6 文件） | 34 用例全通过（含新增的 seal 用例） |
| `pnpm test:integration`（全量） | 519 用例：低负载下一次 519/519 全通过；高负载时见 §5 的两个既有用例抖动 |
| `node scripts/e2e.mjs` | exit 0，26 checks — PASS 25 / FAIL 0 / UNVERIFIED 1 |
| `pnpm test:live`（验收内） | exit 0，drill.message-to-stage PASS |

### 4.3 发布验收

最终一次 `node scripts/acceptance.mjs`（真实 Provider，默认并行度，工作树即本文件所列改动）：

```text
acceptance: pnpm test:e2e exit=0 (76648ms)
acceptance: pnpm test:live exit=0 (73497ms)
acceptance: 94/94 ACs accounted — PASS 94 / ACCEPTED 0 / FAIL 0 / MISSING 0
acceptance: OK — every AC is PASS or a registered, condition-checked accepted gap
exit=0
```

本次运行内 `drill.message-to-stage` 的验收证据（`.agentdev/work/WP-12/acceptance.md`）：

```text
PASS  drill.message-to-stage  [AC-003,AC-005,AC-069] real Provider no-seed chain:
message 01a0a343-6d7f-… → Chief Run 01a0a343-6da5-… (completed) →
Requirement 01a0a343-837b-… (active/plan) → professional Run … → stage result … + stage.failed(needs_input)
```

过程记录（用于说明稳定性，不掩盖失败）：

- 第 1 次：`PASS 83 / FAIL 11`，exit 2。11 个 FAIL 中 8 个来自 e2e —— 当时 `stage` 还是 literal 并集，Pi 运行时在 `execute` 前按 Schema 校验，把离线 stub 的 `develop` 挡在门外，`chief.message-to-stage` 超时；该并集已改回 `Type.String()` + 本地规范化。
- 第 2–4 次：`PASS 92 / PASS 90 / PASS 92`，exit 2，剩下的 FAIL/UNVERIFIED 全部来自两个与本改动无关、且对机器负载敏感的集成用例（`broker.integration.test.ts` 的 Docker 容器读、`tool-permission-runner.integration.test.ts:570` 的 `tool_end` 竞态，详见 §5）。同一时段本机 load average 在 100–240（Docker VM 长期 300% CPU）。
- 第 5 次（load average 27）：**PASS 94 / FAIL 0 / MISSING 0，exit 0**。

即：产品链路（`pnpm test:live` 与 `pnpm test:e2e`）在全部 5 次验收中都是 exit 0；唯一随负载翻转的是上述两个既有集成用例。

## 5. 残余风险 / 未处理项

1. **本改动只保证“链路真正交付”，不保证“阶段成功”。** 演练交付的是 `stage.failed(needs_input)`：真实 Chief 对这条 L2 消息直接派发了实现角色，该 Work 没有 Plan/Task，所以专业 Run 拿不到 Grant，`read/write` 全被拒，只能诚实上报阻塞（`MISSING_CONTEXT: Work … has no Task for role backend; the Run was never dispatched through an approved Plan`）。`workflow.md` §3 的 L2 路线本应是 Product→Plan→Develop；Chief 仍可跳过 Plan 直接 Develop。是否要在提示词/Orchestrator 层强制这条顺序，是产品路由问题，超出本任务范围。
2. **两个对负载敏感的既有集成用例（非本改动引入，但会翻转验收 exit code）。**
   - `apps/daemon/test/tool-permission-runner.integration.test.ts:570`：在 `waitFor(pending permission decision)` 之后**立即**断言子进程日志里已有 `event=tool_end tool=bash`，与子进程 stdout 的到达赛跑。本机 load average >100 时它会输（验收第 2–4 次即如此）；低负载时单独运行 6/6 通过、与两个重型容器用例同跑也通过、验收第 5 次全绿。修法是把断言改成有界等待，但该文件不在本任务允许范围内。
   - `packages/core/test/broker.integration.test.ts:505`：真实 Docker 容器读并核对非 root 账户；Docker Desktop VM 长期 300% CPU 时它会失败（验收第 3 次出现）。同样不在允许范围内。
   - 同一次高负载下 `protocol.integration.test.ts`（AC-054）还出现过一次无关的 `[1,2,3,4,4]` 事件重放抖动。这三处都不是本改动触碰的路径：改动只落在 prepare-run 提示词、runner 控制工具/attempt、supervisor 纠正提示与 live 演练诊断。

   结论：第 5 次验收（`PASS 94 / FAIL 0 / MISSING 0`，exit 0）是在约 28 的 load average 下取得的；上表 §4.3 的 5 次记录说明验收结论会受这两个既有用例的负载抖动影响，需要在结论中一并阅读，而不是把它当作本改动的稳定性证据。
3. **`BUSY: Work … is being written by attempt …; this Attempt holds no writer lease`**：有一次专业 Run 的 Attempt 起来时被同一个 Work 的（已完成的）Chief Attempt 持有写租约而拒绝工具调用。它没有阻断本次交付，但属于值得单独复查的可靠性信号。
4. **Chief 的 assessment 仍有自己的契约摩擦**：本轮仅补齐 `riskFlags` 词汇描述，未像 `agent_dispatch` 那样做本地 Schema 校验（assessment 的 payload schema 在 Core 侧另有派生逻辑）；真实模型首次仍可能因词汇被拒一次（有两次机会，不致命）。
