# WP-12 flake-fix：AC-049/AC-080 的 `tool_end` 竞态与两处同区缺陷

- 状态：Developing（实现与真实验证完成；独立 Review/Test 不在本任务范围）
- 范围：`apps/daemon/test/tool-permission-runner.integration.test.ts`、`apps/daemon/test/requirement-commands.integration.test.ts`、`apps/daemon/src/protocol.ts`、`scripts/acceptance.mjs`
- 依据：任务书（家长 Agent 已批准的范围与验收）；`.agentdev/work/WP-12/test.md` §2.1/§4.3/§4.5/§4.6；`.agentdev/work/WP-12/T2-fix-delivery.md` §5.2；`docs/architecture/protocol.md` §1；`docs/architecture/data.md:102`
- 结论：`:570` 是**测试侧时序假设**（(a)），不是产品乱序（(b)）；以有界等待真实信号修复，断言与超时纪律未被放宽。另修 acceptance 聚合的误报与 `requirement.archive/restore/start` 静默忽略 `expectedVersion` 两处同区缺陷。验证后 `node scripts/acceptance.mjs` 为 `94/94 — PASS 94 / ACCEPTED 0 / FAIL 0 / MISSING 0`，exit 0。

---

## 1. 诊断：`tool-permission-runner.integration.test.ts:570` 是测试侧竞态

### 1.1 代码路径证明「DB 行必然早于 IPC 行」

失败断言是 `expect(runnerIpc.some((line) => line.includes('event=tool_end tool=bash'))).toBe(true)`，它读取的是 **daemon 记录的子进程 stdout**（`apps/daemon/src/runner-spawn.ts` 的 `log` 回调，测试在 `:338-341` 同时写入 `runnerIpc`）。该行出现的时间链是：

1. 子进程 `tool.execute` 被拒（`NOT_AUTHORIZED`）后调用 `requestPermission`，daemon 在 `requestPermission` 内**同步**插入 pending Decision 行并 `moveRun(waiting_permission)`：`packages/core/src/permissions.ts:356`（`decisions.insert({… state:'pending'})`）。HTTP 200 在之后才发出：`packages/core/src/control-http.ts:595-605`。
2. 子进程侧 `execute()` 要等 `requestPermission()` 返回才 resolve：`apps/runner/src/tool-client.ts:444-458`。
3. Pi SDK 只在 `execute` resolve 之后发出 `tool_end`；Runner 在 `apps/runner/src/attempt.ts:452-465` 的 `emit()` 里把它写入 stdout（`send` → `writeMessage`）。
4. daemon 在自己的 readline 回调里读到这行才写 `runnerIpc`：`apps/daemon/src/runner-spawn.ts:278-311`。

即：测试在 `:557-564` `waitFor` 到的 pending Decision 行，**按构造必然**早于 `:570` 断言的 `tool_end` 行；两者之间还隔着一次 HTTP 响应、一次 SDK 事件、一次 stdout 写入和一次异步 readline。`:570` 在观察到 Decision 后**只读一次** `runnerIpc`，因此是纯测试侧时序假设 (a)。

### 1.2 排除 (b)：产品没有「先结束 turn/Run 再记录工具结果」

- 被拒的工具调用不会让 Runner 提前结束：`settleTurn` 先 `awaitIdle` 再 `awaitSubmission`（`apps/runner/src/attempt.ts:389-407`），非交付 turn 只发 `attempt.result` 并等待 Core 的一次纠正提示，不退出。
- `tool_operation` 行由 daemon 端 tool handler 在拒绝应答**之前**写入，所以测试在 `:565-568` 取的 `operation` 必然已存在（`:571` 的 `prepared` 断言不竞态）。
- 最终交付由 `stage_yield` 触发，测试用 `waitFor(stageResults…)` 等待（`:591-615`），不依赖固定延迟。

结论：产品顺序正确，问题只在「测试如何观测子进程事件」。

### 1.3 复现证据（先证明旧断言真的会输）

用同一文件的一次性副本（`apps/daemon/test/zz-flake-repro.integration.test.ts`，只把新增的有界等待换回旧的立即断言，跑完立即删除）在合成 CPU 负载下复现：

```text
pre-fix run 1 | load 119.07 79.10 74.34 | Tests 1 failed (1) | failure at zz-flake-repro.integration.test.ts:570:81
pre-fix run 2 | load 177.74 96.00 80.56 | Tests 1 passed (1)
pre-fix run 3 | load 215.90 111.46 86.58 | Tests 1 passed (1)
pre-fix run 4 | load 217.81 117.02 89.00 | Tests 1 passed (1)
```

失败位置与 Test 报告完全一致（`…:570:81`）。竞态是概率性的：Test 报告在 load 85–240 下 3/3 失败，我的合成负载下 1/4 失败——这与「取决于 Decision 行被观测到与子进程 stdout 到达的先后」相符；1.1 的代码顺序说明它按构造存在，不是偶然。

---

## 2. 改动

### 2.1 测试：等待真实信号，而不是固定延迟（`tool-permission-runner.integration.test.ts:569-587`）

把 `:570` 的立即断言改成对同一条件的**有界等待**（30s），并保留原断言：

```ts
await waitFor(
  () => (runnerIpc.some((line) => line.includes('event=tool_end tool=bash')) ? true : undefined),
  () => `the refused bash call's tool_end on the Runner IPC stream\n${…最近 12 行 IPC…}`,
  30_000,
);
expect(runnerIpc.some((line) => line.includes('event=tool_end tool=bash'))).toBe(true);
```

- 等待的是真实 IPC 消息的到达；没有 `sleep`、没有重试、没有放宽任何断言。
- 失败路径更严格而非更松：真正卡住的子进程在 30s 后仍然失败，并打印最近的 IPC 行。
- 文件内其余 `waitFor` 轮询的是 DB 行（Run / assessment / Decision / stage result），不是固定延迟，未改动。

### 2.2 acceptance 聚合：按真实原因报告（`scripts/acceptance.mjs:252-306, 366-368`）

旧实现用 `infraFailure` 布尔量把两种不同问题压成一句 `'某个 Vitest 项目没有产出 JSON 报告'`（`:356`），于是「exit≠0 但报告存在」被误报为「报告缺失」（`test.md` §4.5）。现改为按项目收集真实原因：

- 无报告：`Vitest 项目「X」没有产出 JSON 报告：exit=… signal=… spawnError=… duration=…ms`（原字段保留）。
- 有报告但 exit≠0：`Vitest 项目「X」exit=…，但产出了 JSON 报告（N 个用例、M 个失败）：问题是非零退出，不是缺少报告；失败用例：<file> :: <test>（最多 5 条）`，stderr 同步打印同样的明细。

exit code 语义不变（infra 问题仍 fail closed 为 exit 2），只修正归因文本。验证：临时放入一个必然失败的 unit 用例后运行 `node scripts/acceptance.mjs --projects unit --no-drills --no-write`，得到

```text
acceptance: project "unit" exit=1 1433 tests, 1 failed
acceptance: Vitest 项目「unit」exit=1，但产出了 JSON 报告（1433 个用例、1 个失败）：问题是非零退出，不是缺少报告；失败用例：…/zz-infra-msg-check.test.ts :: deliberate failure to check the acceptance infra message
```

（临时文件已删除；绿色运行的 `acceptance-results.json` `problems` 为 `[]`。）

### 2.3 `expectedVersion`：在 `requirement.archive/restore/start` 上真正生效（`apps/daemon/src/protocol.ts`）

文档支持「检查」这一选项，且明确了版本来源，不是猜测：`docs/architecture/protocol.md:9` 规定所有写命令带 `expectedVersion`（目标实体当前 version）；`docs/architecture/data.md:102` 规定「**本机行 version 独立用于协议 expectedVersion** 并随本机字段变化递增」，`packages/core/src/requirements.ts:4-6` 复述同一规则（`recordVersion` 是跨服务器事实，已有 Git CAS 单独校验）。

新增 `assertRequirementVersion(requirement, options.expectedVersion)`，在三个 handler 取到 Requirement 后立即校验，失配抛 `VERSION_CONFLICT`，details 带 `{requirementId, currentVersion, requestedVersion}`（与 `work.control`/`config.save` 的既有形状一致）；`archive/restore/start` 的 options 类型补上 `expectedVersion`。校验在任何写（Git 提交、Work 预分配）之前，且 `expectedVersion` 省略时行为不变。

新增用例 `apps/daemon/test/requirement-commands.integration.test.ts`：`requirement.get` 取 live version → 带 live 值 archive 成功并推进版本 → 用旧值 restore 得 `VERSION_CONFLICT`（details 的 `currentVersion/requestedVersion` 精确匹配，lifecycle 未变）→ 带新值 restore 成功 → `requirement.start` 用旧值得 `VERSION_CONFLICT` 且未预分配 Work → 带 live 值 start 成功。

---

## 3. 改动后的负载验证

### 3.1 单文件重复运行（串行，逐次记录 1 分钟负载）

| 批次 | 次数 | load average（1 分钟） | 结果 |
|---|---|---|---|
| 静默机器 | 6 | 4.22–4.78 | **6/6 passed** |
| 合成 CPU 负载（32 个忙循环，8 核） | 3 | 96.60 / 115.33 / 135.42 | **3/3 passed** |

合计 **9/9（100%）**，其中 3 次正好落在 Test 报告复现失败的负载区间（85–240）。对照的第 1.3 节旧断言在 119 负载下于 `:570:81` 失败。

### 3.2 套件与验收（全部串行单发）

| 命令 | 结果 |
|---|---|
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0（Prettier 全部匹配） |
| `pnpm test:unit` | 77 文件 / **1432 用例全通过**，exit 0 |
| `pnpm test:integration`（全量） | 54 文件 / **520 用例全通过**（519 + 新增 1），exit 0 |
| `pnpm build` | 13 个 workspace 项目 build: Done，exit 0 |
| `pnpm docs:check` | `docs:check ok — 16 documents, 67 internal links, 94 acceptance cases…`，exit 0 |
| `node scripts/live.mjs --no-write`（真实 Provider） | `live: 7 passed / 0 failed / 0 unverified; 13 call(s), HTTP 200×13, 38661ms, 0 failed`，exit 0（secret 未打印） |
| `node scripts/acceptance.mjs`（真实 Provider） | **`94/94 ACs accounted — PASS 94 / ACCEPTED 0 / FAIL 0 / MISSING 0`**，`OK — every AC is PASS or a registered, condition-checked accepted gap`，**exit 0** |

验收运行期间机器仍在从合成负载回落（1 分钟平均从约 148 起降），unit 1433/1432（含临时探针时）与 integration 520/520 均在负载未完全回落的窗口内全绿。

---

## 4. 残余负载敏感与诚实边界

1. **本文件只修了 `:570`。** 仍存在的负载敏感项（本任务范围外、未改动）：
   - `packages/core/test/broker.integration.test.ts:505`：真实 Docker 容器读并核对非 root；`T2-fix-delivery.md` §5.2 已登记，验收第 3 次曾因 Docker VM 高占用失败。
   - `apps/daemon/test/protocol.integration.test.ts`（AC-054）曾出现一次事件重放抖动 `[1,2,3,4,4]`（同 §5.2 登记）。
   本次验收 run 未出现这两项，故无法在本记录里声称它们已稳定。
2. **竞态是概率性的**：旧断言在高负载下 1/4（我）/ 3/3（Test）失败；新断言等待的是真实事件，因此不再依赖调度先后，但若子进程真的卡住，30s 后仍会如实失败。
3. **未改动的纪律**：没有引入重试、没有删除或弱化任何断言、没有把超时当成等待条件（唯一新增的 30s 是有界等待真实 IPC 条件）。
4. **范围外未触碰**：`apps/web/**`、`packages/workspace/**`、`packages/core/src/{integrate,settlement,task-candidate}.ts`、`docs/**` 均未修改。工作区里 `docs/INDEX.md`、`.agentdev/work/WP-12/{T3-implementation.md,settlement.md,product-completion-plan.md}` 的改动来自同工作区的其他 Agent，不是本任务产物。
5. **记录新鲜度**：本次 acceptance 运行把 `acceptance.md`/`acceptance-results.json`/`live.md`/`live-results.json`/`e2e.md`/`e2e-results.json` 重新绑定到当前树 `1bbd5ef`（工作区含本次未提交改动）。

---

## 5. 复验命令（可直接重放）

```bash
export PATH="$HOME/.local/bin:$PATH"
node_modules/.bin/vitest run --project integration apps/daemon/test/tool-permission-runner.integration.test.ts
node_modules/.bin/vitest run --project integration apps/daemon/test/requirement-commands.integration.test.ts
pnpm typecheck && pnpm lint && pnpm test:unit
pnpm test:integration
set -a; . /tmp/wp12-live.env; set +a
node scripts/live.mjs --no-write
node scripts/acceptance.mjs   # 期望 94/94 PASS 94 / ACCEPTED 0 / FAIL 0 / MISSING 0，exit 0
```
