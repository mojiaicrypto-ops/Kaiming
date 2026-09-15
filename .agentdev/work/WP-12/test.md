# WP-12 独立 Test 记录（发布声明复验）

- 状态：**Test Failed**（就「十条命令全绿 + acceptance 94/94 exit 0」这一发布声明而言）
- 被测树：`HEAD 1bbd5ef0e557298dddabec4b7b5b3dbb42ba63a3`（复验前后 `git status --porcelain` 只有本次运行自动重写的 6 个证据文件，源码零改动）
- 复验角色：独立 Test（未参与 WP-12 的开发与 Review；只读源码，唯一写入本文件 `.agentdev/work/WP-12/test.md`）
- Provider：`/tmp/wp12-live.env`（`AGENTDEV_PROVIDER_BASE_URL/MODEL/REVIEW_MODEL/SECRET` 全部已配置；**secret 值全程未打印、未写入本记录**，命令输出经 mask 后引用）
- 执行纪律：所有套件**串行单发**，不并发；机器负载 `load average` 全程 85–240（见 §2 备注）

---

## 1. 结论

1. 十条契约命令中 **9 条 exit 0，1 条失败**：
   - 通过：`pnpm install --frozen-lockfile`、`pnpm typecheck`、`pnpm lint`、`pnpm test:unit`、`pnpm test:integration`、`pnpm test:e2e`、`pnpm docs:check`、`pnpm build`、`node apps/cli/dist/cli.js doctor`、`pnpm test:live`。
   - **失败：`node scripts/acceptance.mjs` → `exit 2`，`PASS 92 / ACCEPTED 0 / FAIL 2 / MISSING 0`**（FAIL 为 AC-049、AC-080）。
2. 因此「十条命令全部通过，且 acceptance 报 `94/94 — PASS 94 / ACCEPTED 0 / FAIL 0 / MISSING 0`，exit 0」的声明被**证伪（REFUTED）**。这是一次可复现的失败，不是我的环境噪声（§4.6 连续 3 次复现）。
3. 失败点**不在产品主链**：同一棵树上 `pnpm test:e2e`（含 17 个真 Chromium spec）与 `pnpm test:live`（真实 Provider，13 次调用全 200）都是 exit 0。失败点是：
   - `apps/daemon/test/tool-permission-runner.integration.test.ts:570` 的既有用例在本次负载下失败，导致 AC-049/AC-080 记 FAIL；该用例正是 `T2-fix-delivery.md` §5.2 已登记的负载敏感项。
   - acceptance 的聚合把「Vitest 项目 exit≠0 但报告存在」误报成「某个 Vitest 项目没有产出 JSON 报告」（基础设施问题），掩盖了真实原因（`scripts/acceptance.mjs:253-285,356`）。
4. 记录层面存在**过度声明**：本次 94 条 AC 中 **49 条没有任何 `apps/*` 应用层证据**（40 条纯库级、8 条库级+演练、1 条仅演练）；而 acceptance 报告 §3/§4 写「无」。分层事实只登记在 `.agentdev/work/WP-12/api-gap-audit-2.md:197-198,249` 这种工作文件里，未进入发布报告（§3.7）。
5. 结论用词选 **FAIL** 而非 PASS-with-gaps：验收命令确实非零退出、发布声明未被本次执行支持。已登记的残余风险（如下交付结果为 `needs_input`、容器/宿主边界、AC-046/047 仅库级等）逐条真实存在且**有登记**（§5），不构成隐瞒；本次的主要新问题是「验收聚合的可用性/证据分层未在报告中披露」与「负载敏感用例会翻转发布口径」。

---

## 2. 逐项命令与真实输出

| # | 命令（工作目录=仓库根） | 退出码 | 关键输出行（原样/截断） |
|---|---|---|---|
| 1 | `pnpm install --frozen-lockfile` | **0** | `Lockfile is up to date, resolution step is skipped` / `Done in 849ms using pnpm v12.3.4` |
| 2 | `pnpm typecheck` | **0** | `tsc -p tsconfig.json --pretty false`（无诊断输出） |
| 3 | `pnpm lint` | **0** | `Checking formatting...` / `All matched files use Prettier code style!` |
| 4 | `pnpm test:unit` | **0** | `Test Files 77 passed (77)` / `Tests 1432 passed (1432)` / `Duration 15.13s` |
| 5 | `pnpm test:integration` | **0** | `Test Files 54 passed (54)` / `Tests 519 passed (519)` / `Duration 145.15s` |
| 6 | `pnpm test:e2e` | **0** | `browser: 17 passed (14.0s)`；`e2e: 26 checks — PASS 25 / FAIL 0 / UNVERIFIED 1`；`e2e: 31 ACs accounted for by the drill; exit 0` |
| 7 | `pnpm docs:check` | **0** | `docs:check ok — 16 documents, 65 internal links, 94 acceptance cases, 9 requirements, 11 work packages` |
| 8 | `pnpm build` | **0** | 13 个 workspace 项目 `build: Done`（contracts/client/domain/knowledge/pi-runtime/storage/workspace/core/cli/web/runner/daemon） |
| 9 | `node apps/cli/dist/cli.js doctor` | **0** | `ok node 24.8.0` / `ok pnpm 12.3.4` / `ok git 2.39.3` / `ok pi-sdk 0.85.1` / `ok docker 28.4.0 [image agentdev/exec:0.0.0]` / `execution ready: yes` |
| 10 | `pnpm test:live`（Provider 环境已 export） | **0** | `live: 7 passed / 0 failed / 0 unverified; 13 call(s), HTTP 200×13, 37845ms total, 0 failed` |
| 11 | `node scripts/acceptance.mjs`（Provider 环境已 export） | **2** | `acceptance: project "integration" exit=1 519 tests, 1 failed`；`acceptance: 94/94 ACs accounted — PASS 92 / ACCEPTED 0 / FAIL 2 / MISSING 0`；`acceptance: FAILED (exit 2) — the evidence itself is not trustworthy (infrastructure problem)` |

**第 6 项补充**（e2e 真浏览器部分）：`PASS browser.html-preview-and-download [AC-002]`、`PASS browser.html-attack-samples [AC-052]`、`PASS browser.live-layout [AC-071]`、`PASS browser.keyboard-aria-i18n [AC-073]`、`PASS browser.attachment-client-hints [AC-076]`，全部为真实 Chromium（Playwright 1.63.0）。

**第 11 项失败明细**（`acceptance.md` §5，重新生成本次运行后原文）：

```text
apps/daemon/test/tool-permission-runner.integration.test.ts :: environment-operation approval
with a real Runner child (AC-049/AC-080) refuses, records the request, and really executes the
model retry after the user approves (AC-049/AC-080)
AssertionError: expected false to be true // Object.is equality
    at apps/daemon/test/tool-permission-runner.integration.test.ts:570:81
```

对应理由行：`acceptance: project "integration" exited 1 although it produced a JSON report`（`scripts/acceptance.mjs:285`）。也就是说**报告是存在的**，而 sidecar 里落下的 `problems` 却是 `["某个 Vitest 项目没有产出 JSON 报告"]`（`.agentdev/work/WP-12/acceptance-results.json`），见 §4.5。

### 2.1 负载敏感观察（同一棵树，串行）

| 时刻 | 命令 | 结果 |
|---|---|---|
| 11:15 | `pnpm test:integration`（默认 reporter，全套 519） | **519/519 PASS，exit 0** |
| ~11:26 | `node scripts/acceptance.mjs` 内部 `vitest run --project integration --reporter=json` | **519 tests / 1 failed**，exit 1 |
| ~11:28 | 按 acceptance 完全相同调用重跑：`node_modules/.bin/vitest run --project integration --reporter=json --outputFile=…` | **519 tests / 1 failed**（同一用例、同一行 `:570`） |
| 11:30 | 单文件串行：`node_modules/.bin/vitest run --project integration apps/daemon/test/tool-permission-runner.integration.test.ts` | **1 file / 1 test failed**，同一行 `:570`；当时 `load averages: 115.32 85.63 87.13` |

判定：**负载/时序敏感，且失败形态与登记完全一致**（`T2-fix-delivery.md` §5.2 已把该文件 `:570` 列为「在 `waitFor(pending permission decision)` 之后立即断言子进程日志已有 `event=tool_end tool=bash`，与子进程 stdout 到达赛跑」）。我无法在本机把负载压到低水位，因此无法复现「低负载 6/6 通过」那一侧；但「高负载失败」一侧在本次连续 3 次成立，且代码结构（`:570` 无有界等待）与观察一致。

### 2.2 本次运行对工作区的副作用

运行契约命令本身会重写仓库内的**证据文件**：`e2e.md` / `e2e-results.json` / `live.md` / `live-results.json` / `acceptance.md` / `acceptance-results.json`（`git status --porcelain` 仅这 6 个）。**没有任何源码/文档被修改**。这些重写后的文件现在绑定到 `HEAD 1bbd5ef`（此前它们分别绑定 `live.md → 7c723ec`、`e2e.md/acceptance.md → ff1c149`，见 §3.8）。

---

## 3. 复验的声明（每条给出被检验的代码/测试与结论）

### 3.1 工具桥：环境操作只有在「绑定操作+inputHash」的批准之后才被准入 — **CONFIRMED**

- 代码：`apps/daemon/src/protocol.ts:5687`（`permission.request` 要求 `toolOperationId` 指向**已尝试过**的真实 call，服务端自己取记录的 `inputHash`，不信调用方）；`packages/core/src/permissions.ts` 的 `approvePermission` 以 `(runId, toolOperationId, inputHash)` 铸 once Grant。
- 测试：`apps/daemon/test/tool-handler.integration.test.ts:530` `admits an environment operation only after its exact approval (AC-049)`——断言无 Grant 时 `NOT_AUTHORIZED` 且 `store.toolOperations.count()===0`；批准后同 operation 真实执行（输出含 `approved-by-the-user`）；同 id 异 args → `IDEMPOTENCY_CONFLICT`；另一个 operationId 复用已消费 once Grant → `IDEMPOTENCY_CONFLICT` 且不落新行。
- 结论：声明成立。

### 3.2 读账本：seal 之后拒绝继续追加 — **CONFIRMED**

- 代码：`packages/core/src/read-ledger.ts:356-365`（`seal()`；seal 后 `record()` 返回失败）。
- 测试：`packages/core/test/read-ledger-seal.integration.test.ts:295` `accepts a stage result whose binding matches, then seals the ledger`——接受后再次 `record()` 必须失败、`binding()` 不变；同文件 `:174` 证明 append-only（重复读也追加）、`:190` 证明占位/陈旧 binding 被 `STALE_ARTIFACT` 拒绝、`:347` 证明 admitted-but-unrecorded 读使交付被拒。
- 结论：声明成立。

### 3.3 `settleFromIntegration`：Task 无冻结 manifest 时拒绝 — **CONFIRMED**

- 代码：`packages/core/src/settlement.ts:1429-1434`（遍历 Work 的 Task，`latestManifestId === undefined` → `MISSING_CONTEXT`，且在**任何写之前**返回）；`:1421-1428` 无 Task → `GATE_NOT_READY`。
- 测试：`packages/core/test/integrate.integration.test.ts:644` `settlement refuses a Task whose manifest vanished before any write`——断言 `code === 'MISSING_CONTEXT'`、`branchUntouched`、delivery ref 未动、无 `settle` operation、Requirement 仍 `active`、无 `settlement.completed` 事件。另有 `:623` 的 `TASK_MERGE_CONFLICT` 兄弟用例。
- 结论：声明成立。

### 3.4 多项目 BFF：跨项目 artifact token 被拒 — **CONFIRMED**

- 测试：`apps/web/test/multi-project.integration.test.ts:223` `serves an artifact only through its own project route and rejects the token elsewhere (AC-034)`——Alpha 的真 artifact+真下载 token 在 Alpha 路由 200 且**恰好一次**（重放 403）；同一 artifact id 经 Beta 路由 preview ≥400 且响应体不含 `ALPHA-ONLY-ARTIFACT-BYTES`；Alpha 新铸 token 经 Beta 路由 ≥400 且不泄露字节。
- 代码：`apps/web/src/app.ts:611-616`（token 只在本项目路由可兑换）。
- 结论：声明成立。

### 3.5 `requirement.get` 返回 `contentMarkdown`，`list` 仍只回元数据 — **CONFIRMED**

- 代码：`apps/daemon/src/protocol.ts:2482-2510`（`get` 返回提交态正文）。
- 测试：`apps/daemon/test/requirement-commands.integration.test.ts:302` `returns the committed contentMarkdown from get and keeps list metadata-only (protocol.md §8)`——`requirement.get` 的 `contentMarkdown` 含正文与 `## 完成摘要`；`requirement.list` 的 item 上 `contentMarkdown === undefined`。
- 结论：声明成立。

### 3.6 浏览器套件真的断言隔离攻击，而不只是响应头 — **CONFIRMED**

- `tests/browser/ac-002-052-html-isolation.spec.mjs:106` `AC-052 · 预览内脚本读取 cookie／网络／父页全部被隔离阻止`：断言 frame `origin=null`、`document.cookie` 抛 SecurityError、`parent.document`/`top.title` 抛错且父页 URL 未变、`localStorage` 不可读、回环探针自计数 `attacks === 0`（`:185-188`）、被 CSP 拒绝的探针请求存在；同时确认会话 cookie `agentdev_web` 确实存在于浏览器上下文（`:137-138`），排除「因为没有 cookie 所以读到空」的假通过。
- 我的运行中该 spec 真跑（`browser: 17 passed`），e2e 逐 AC 行 `browser.html-attack-samples` 给出了同样的原始计数。
- 结论：声明成立。

### 3.7 「94/94 PASS 全部有真实证据」 — **PARTLY REFUTED（证据分层未披露）**

- 事实：本次运行 `PASS 92 / FAIL 2`（§2）。即便只看 92 条 PASS，按 `acceptance-results.json` 的 evidence/drill 字段分层统计（我用独立脚本复算）：

| 分层 | 条数 | AC |
|---|---|---|
| A 有 `apps/*` 应用层证据 | 45 | AC-002,003,004,005,007,013,014,020,023,025,026,027,028,029,032,034,048,049,050,051,052,054,060,064,067,068,069,070,071,072,073,074,075,076,077,078,080,084,085,087,088,089,090,092,093 |
| B 仅 `packages/*` 库级 + 演练 PASS | 8 | AC-010,037,038,041,043,045,057,066 |
| C 仅 `packages/*` 库级，无演练 | 40 | AC-006,008,009,011,012,015,016,017,018,019,021,022,024,030,031,033,035,036,039,040,042,044,046,047,053,055,056,058,059,061,062,063,065,079,081,082,083,086,091,094 |
| D 仅演练 | 1 | AC-001 |

- 即 **49/94 没有应用层证据**（B+C+D）。这与 `api-gap-audit-2.md:38`「94 AC 中提交套件内无产品路径证据 **57**（54 纯库级 + 3 播种行）」同源（该审计是 09-14 的快照，之后 T4b/T5/T6 把一部分 AC 升到了应用层，数量从 57 降到 49）。
- 问题在于：**发布报告本身没有披露这一分层**。`acceptance.md` §3 写「本次没有任何 AC 依赖已登记豁免」、§4 写「每个 UNVERIFIED/MISSING 都在登记表中且条件成立」——按工具的定义都成立，但一个只读 §0 统计行的读者会把「PASS 94」理解成「94 条都有产品路径证据」。AC-046/AC-047 正是 C 层（仅 `packages/core/test/join.test.ts`）。
- 结论：声明在「映射用例通过」这一含义上成立，在「94 条都有产品路径/真实环境证据」这一通常含义上**不成立**，且分层事实未被报告披露。

### 3.8 归档的验收记录对应「当前冻结树」 — **REFUTED（记录落后 1~3 个提交）**

- 我接手时磁盘上的记录：`acceptance.md` 记 `Git HEAD ff1c1494ba…（工作区有未提交改动）`、`e2e.md` 记 `ff1c1494ba…`、`live.md` 记 `7c723ecd35…`；而当时的冻结树是 `1bbd5ef`。也就是说：**被声称为发布证据的那次 94/94 运行，不是在当前 HEAD 上取得的**，且 `live.md` 落后 3 个提交（含 `37ff629`、`024afa8`、`ff1c149`、`1bbd5ef` 这些改动 live 路径的提交）。
- 复验要求「run on the current frozen tree」；我这次的运行才把记录重新绑定到 `1bbd5ef`（`acceptance-results.json.gitHead` / `live.md` §0）。
- 结论：归档记录与冻结树不一致，被证伪；这不是隐藏，而是「记录未随最后提交刷新」。是否构成发布阻断由用户判定，但**发布声明不能引用那次旧记录**。

### 3.9 完成记录必须绑定最终 revision — **CONFIRMED**

- 测试：`packages/core/test/requirement-save.test.ts:366` `refuses a completion record whose code revision is not the final revision`——`codeRevision` 非最终 revision → `STALE_ARTIFACT` 且原因含 `codeRevision`；`:384` 另有「Settlement 验证了不同 code tree」的拒绝。
- 结论：声明成立。

### 3.10 项目切换不会复用另一个项目的 cursor — **CONFIRMED**

- 测试：`apps/web/test/multi-project.integration.test.ts:274` `binds the event socket to one project and never replays another project cursor (AC-034/AC-060)`——Alpha 的 cursor 提交到 Beta socket 后，回放帧不含 Alpha 的 conversation id，sub端未服务项目在握手前被拒。
- 结论：声明成立。

---

## 4. 独立证伪尝试（acceptance 管线不会覆盖的方向）

### 4.1 越出 read scope 的路径（用测试未用的形状） — **未找到漏洞（声明成立）**

用 `scripts/lib/e2e-runtime.mjs` 的源码解析器直接加载 `packages/core/src/broker.ts`，对 `resolveWithinRoots` 施加 6 种测试未覆盖的形状（临时目录，跑完删除）：

| 形状 | 结果 |
|---|---|
| 前缀兄弟根 `src-evil/`（经典 `startsWith` 漏洞） | `NOT_AUTHORIZED`（拒绝） |
| **文件**符号链接指向根外 | `NOT_AUTHORIZED` |
| 经符号链接目录的**不存在**子路径 | `NOT_AUTHORIZED` |
| `src/../rootfile.txt`（规范化后落在根内） | 准入（正确：`resolve` 先规范化，落点确在根内） |
| 绝对路径指向根外 | `NOT_AUTHORIZED` |
| `src/../../outside/secret.txt` | `NOT_AUTHORIZED` |

`isWithinRoot('/…/src-evil/f.txt','/…/src') === false`。**结论：路径边界在这些形状下没有被突破**；这条是对声明的加固，不是漏洞。既有测试用的是目录符号链接（`packages/core/test/broker.test.ts:542`、`tool-http.integration.test.ts:424`），我的形状（前缀兄弟、文件符号链接、不存在的子路径）不同且同样被拒。

### 4.2 `secret.list` 是否泄露值 — **未泄露（声明成立），但只覆盖文件后端**

在临时 `AGENTDEV_HOME` + `AGENTDEV_SECRET_BACKEND=file` 下写入诱饵值 `CANARY-wp12-LEAK-…`：

- `secret set provider:canary` → exit 0，回显只有 `{ok,path,backend,ref,configured,updatedAt}`，**无值**；
- `secret list` → 只有 `ref/configured/updatedAt/backend/health`，诱饵在 stdout 出现 **0** 次；
- `grep -rl <canary> $AGENTDEV_HOME` → **0** 个文件（落盘为 AES-GCM 密文）；`secrets/file/*.json` 与 `secrets/master.key` 均为 `-rw-------`（0600）。
- 未覆盖：darwin 默认 `keychain` 后端（见 §6）。

### 4.3 新命令上的 `expectedVersion` 被静默忽略 — **漏洞（未登记、未测试）**

- 文档：`docs/architecture/protocol.md:9`「写命令增加 idempotencyKey 和 expectedVersion（目标实体当前 version，新建为 0）」——这是**所有写命令**的通用前置条件。
- 实现：`apps/daemon/src/protocol.ts:1299-1313` 只校验 `expectedVersion` 是整数，不通用执行；真正比对只发生在 `work.control`（`:3415-3418`）、`plan.approve`（`:5259-5266`）、`decision.resolve`（`:5561`）、`config.save`（`:5968`）等少数处理器。
- 反例：`requirement.archive`（`:3702-3705` 的 options 只有 `idempotencyKey`）→ `writeRequirementLifecycle`（`:3795-3797`）全程不读 `options.expectedVersion`；`requirement.start`（`:4032-4035`）、`requirement.restore` 同理。调用方带 `expectedVersion: 999` 会**照常执行**，不返回 `VERSION_CONFLICT`（乐观并发前置条件被静默丢弃，退化为 last-write-wins）。
- 测试覆盖：`apps/daemon/test/protocol.integration.test.ts:1107` 只验证了 `work.control` 的陈旧 `expectedVersion`；`apps/daemon/test` 下没有任何 `requirement.*`/`run.*`/`work.retry` 的 `expectedVersion` 用例。
- 诚实边界：本条是**代码阅读 + 覆盖统计**得到的，我**没有**为它构造端到端执行（需要完整协议 harness），归入 §6「未执行验证」。

### 4.4 证据分层未进入发布报告 — **过度声明（新发现）**

见 §3.7：49/94 无应用层证据，而报告 §3/§4 写「无」。建议：验收报告应输出 A/B/C/D 分层计数（或对 C 层逐条标注「库级证据」），否则「94/94 PASS」会被过度解读。

### 4.5 验收聚合把「测试失败」误报为「没有 JSON 报告」 — **诊断缺陷（新发现）**

- `scripts/acceptance.mjs:253-285`：`infraFailure` 在两种情况下被置 true——(a) `report === null`；(b) `report !== null && exitCode !== 0`。而 `:356` 只在 `infraFailure` 为真时推入字符串 `'某个 Vitest 项目没有产出 JSON 报告'`，且此时 `noReportProblems` 为空数组。
- 我的运行日志同时出现 `acceptance: project "integration" exited 1 although it produced a JSON report`（报告存在）与最终 `problems: ["某个 Vitest 项目没有产出 JSON 报告"]`（报告不存在）——**自相矛盾**。这会把「一个用例失败」误导为「基础设施不可信」，进而让运维去查 JSON 报告而不是看那条断言。
- 影响：不影响 94 条 AC 的 PASS/FAIL 判定本身（FAIL 判定是对的），影响的是**结论可读性与可归因性**；对「发布声明是否可信」的评审是实质性的。

### 4.6 负载敏感用例会翻转发布口径 — **复现（与登记一致）**

见 §2.1：同一棵树、串行、连续 3 次失败（含单文件单跑，load 115）。登记见 `T2-fix-delivery.md` §5.2；该用例是 **AC-049/AC-080 的唯一「Then」证据来源**（`acceptance.md` §5 的 FAIL 明细正是它），所以它一抖，两条 AC 直接 FAIL。这是「发布口径可被一个已知竞态翻转」的实证。

---

## 5. 未覆盖与残余风险

### 5.1 已登记的残余风险逐条核对（要求：真的如描述、真的登记）

| # | 登记描述 | 我的核对 | 登记位置 |
|---|---|---|---|
| R1 | 交付演练只证明「链路交付」，阶段结果可以是 `needs_input` | **成立**。我的 live 运行原文：`drill.message-to-stage … → stage result 01a0a34c-… + stage.failed(needs_input) (a NON-successful stage (needs_input) was delivered — this proves the chain, not a passing stage)`，见重写后的 `live.md:27` | `T2-fix-delivery.md` §5.1「本改动只保证"链路真正交付"，不保证"阶段成功"…该 Work 没有 Plan/Task，所以专业 Run 拿不到 Grant」 |
| R2 | 容器执行覆盖工具，但 **Runner 仍在宿主**，工具读的是**项目根**而非 per-Task workspace | **成立**。`apps/daemon/test/tool-handler.integration.test.ts:327` `reports the per-Task worktree gap once, without pretending it is wired` 断言缺口日志（含 `Q-T3-8`）每次 handler 生命周期恰好 1 条；resolver 返回 `taskWorktree:false` | `T3-implementation.md:168`、`:228`、`:372`、`:523`；`T3-plan.md:307` Q-T3-8=A（项目根 + 单写者 lease） |
| R3 | 模型没有「申请密钥」入口 | **成立**。`permission.request`（`protocol.ts:5687`）要求 `toolOperationId` 指向**已尝试过**的 call，而角色工具面里没有「secret」工具；`ensureRunGrants` 只铸 `read/search/edit/write/artifact_write` 文件类 Grant | `T3-implementation.md:372`「secret 的"工具声明所需 secret"触发面」、`:523`「secret 触发面」；`T2-review-security.md:105`（无生产路径铸 `secret` Grant） |
| R4 | AC-046（并行兄弟失败）、AC-047（口头完成/契约违反）**只有库级负例**，无集成级演练 | **成立**。两条 AC 的证据只有 `packages/core/test/join.test.ts`；本次分层统计落在 C 层（§3.7 表）。登记在审计与切片记录，**未**登记为 `RESIDUAL_GAPS`（`scripts/lib/drill-acs.mjs:103-209` 无 AC-046/047），因此 acceptance 报 PASS 且 §3 写「无」 | `api-gap-audit-2.md:197-198`「库级证据；无应用层执行」、`:249`「纯库级 54 条」列表；`T3-implementation.md:529`「G8 的 AC（AC-045/046/047/…）此前只有库级/单测证据」 |
| R5 | 部分集成用例负载敏感 | **成立且本次复现**。`tool-permission-runner.integration.test.ts:570` 连续 3 次失败（§2.1）；另一条 `packages/core/test/broker.integration.test.ts:505`（真实 Docker 容器读）本次未翻转 | `T2-fix-delivery.md` §5.2 明确点名 `tool-permission-runner.integration.test.ts:570` 与 `broker.integration.test.ts:505`，并说明「第 5 次验收在 load≈28 下取得」 |

### 5.2 我新增/确认的残余与缺口

- **G-T1（新）**：验收报告不披露证据分层（49/94 无应用层证据），§3/§4 的「无」在语义上会被误读（§3.7、§4.4）。
- **G-T2（新）**：acceptance 的 `problems` 会把「项目 exit≠0」误报为「没有产出 JSON 报告」，自相矛盾（§4.5）。
- **G-T3（新）**：文档化的通用 `expectedVersion` 在 `requirement.archive/restore/start` 等新命令上被静默忽略，且无用例覆盖（§4.3，未端到端执行）。
- **G-T4（记录）**：发布记录落后冻结树 1~3 个提交（§3.8）；本次已被我的运行刷新到 `1bbd5ef`。
- **G-T5（发布口径）**：AC-049/AC-080 的唯一 Then 证据是一个已登记的竞态用例，其翻转会直接改发布结论（§4.6）。修法（不属我职责）：把 `:570` 的断言改为有界等待。
- 仍有效的**环境性**缺口（我未新增、仅确认存在）：darwin 默认 Keychain 后端未在本次复验中执行；跨 `AGENTDEV_HOME` 两安装互不可见为已登记缺口（`docs/architecture/reliability.md:61`）。

---

## 6. 我无法验证的内容（明确说明）

1. **无法复现声明中的 94/94 / exit 0 那次运行**：磁盘归档记录绑定 `ff1c149`（`live.md` 甚至 `7c723ec`），且演练的临时报告目录（`/var/folders/.../agentdev-acceptance-*`）已不存在，无法回放其原始证据。我只能复验「当前树」，结论是失败。
2. **无法把负载敏感用例的通过侧复现**：本机 `load average` 全程 85–240，我无法降到登记记录里的 ≈28，故不能证明「低负载 6/6 通过」；我能证明的是失败侧连续 3 次成立、失败点与登记一致。
3. **`expectedVersion` 缺口未做端到端执行**（§4.3）：结论来自代码阅读与测试覆盖统计，未构造协议 harness 实跑。
4. **darwin `keychain` secret 后端未执行**：为不触碰真实 Keychain，我用 `AGENTDEV_SECRET_BACKEND=file`；`secret.list` 不泄露值的结论只覆盖 file 后端。
5. **真实容器/宿主边界的负例未单独重跑**：R2 我以登记 + 用例断言 + 代码阅读确认，未再单独跑 Docker 容器读用例。
6. **`doctor` 使用默认 home**（`~/.agentdev`，当时为空、仅有目录）：`doctor` 输出 `execution ready: yes`；我未在「有真实运行中 daemon + 已注册项目」的 home 上复验第 9 条命令。
7. **用户自己的浏览器 UAT 未执行**：我执行的是 Playwright 无头 Chromium（17 spec）；真人在自己浏览器上的复验不在我的能力范围。
8. **未评估**：多模型/多 Provider 组合、launchd 真机长期运行、跨安装锁隔离等产品面之外的部署结论。

---

## 7. 复验环境

- Node `v24.8.0`；pnpm `12.3.4`；git `2.39.3`；Docker `28.4.0`（image `agentdev/exec:0.0.0`）；Playwright `1.63.0`（Chromium）。
- Provider：`https://api.deepseek.com`（模型名与 Review 模型来自 `/tmp/wp12-live.env`，值不打印）。
- 全部命令串行；源码只读；唯一写入文件为 `.agentdev/work/WP-12/test.md`。
