# WP-10（发布整体验收）独立 Review 报告

- 角色：INDEPENDENT REVIEW（独立上下文；未读取任何开发/Test 聊天、transcript 或会话日志）
- 工作包：WP-10 发布整体验收
- 冻结点：`0aff531`（`feat(release): implement the WP-10 acceptance, e2e and live runners`）
- 证据目录：`/tmp/wp10r/`（Reviewer 自建探针与原始输出；本机 macOS / Node v24.8.0 / pnpm 12.3.4 / Docker 28.4.0 可用）
- 唯一写入：本文件（`.agentdev/work/WP-10/review.md`）。实验期间 `pnpm test:acceptance` 与 `node scripts/e2e.mjs` 会重写 `.agentdev/work/WP-10/{acceptance.md,e2e.md,e2e-results.json}`（只跑 1 次完整 acceptance、1 次带 `--projects unit` 的 acceptance、1 次 e2e），伪造实验改写 `.agentdev/work/WP-10/live-results.json`；全部已在实验后 `git checkout --` 还原，最终工作区仅余 `?? plan.md` 与本次新增的 `?? review.md`（见 §1、W10R1-09）。

## 1. 冻结与哈希

| 项 | 值 |
|---|---|
| `git rev-parse HEAD` | `0aff531d6dd8c08e88ba99aea455db1c32f809fb` |
| `git rev-parse HEAD^{tree}` | `103baf68091cbc19dbb1f132d3f3cd2f945fbd9c` |
| `git status --porcelain`（初始） | `?? .agentdev/work/WP-10/plan.md`（非空，见 W10R1-09） |
| `git status --porcelain`（还原后） | `?? .agentdev/work/WP-10/plan.md`、`?? .agentdev/work/WP-10/review.md` |

受审文件（`git rev-parse HEAD:<path>`，实现树全部与工作区一致）：

| 文件 | blob |
|---|---|
| `scripts/acceptance.mjs` | `5422fa9b5bafb76c9fddc582ffef26b24ff68e40` |
| `scripts/lib/acceptance-registry.mjs` | `54f37e49b7255fddc4436b7cf4f8808a4624a8ae` |
| `scripts/lib/acceptance-evidence.mjs` | `870e1cc64aef9b8961f03c950a434ab8e070e9c3` |
| `scripts/lib/acceptance-report.mjs` | `c3246ecb98bdd72756816f4a2248377e23fca70b` |
| `scripts/e2e.mjs` | `7ddc8dbba996e7d622fa0ed40910d53f55c02ef8` |
| `scripts/lib/e2e-runtime.mjs` | `17d218e15f01587e8a57884538ed00a180483c45` |
| `scripts/lib/e2e-checks.mjs` | `0e0251409d3ce1422344cbd348c9621164345bd5` |
| `scripts/live.mjs` | `d42e8ce8785f22d656877846c009dfec1ec57132` |
| `scripts/lib/live-transport.mjs` | `d7baf72bde4ae6aec6c2b21f5c0ad4fe4767b179` |
| `scripts/lib/live-harness.mjs` | `92601fd993bbb95ee9d80ceebe7396cd3955f982` |
| `scripts/lib/live-drills.mjs` | `c0d099bbbe69edf832c1658d0f1209060336bfdd` |
| `scripts/lib/live-report.mjs` | `d453e047dfc281185fd292b1f8224e3d00f52237` |
| `scripts/lib/live-release.mjs` | `9b5df9eb23e70e83b352996364b3a97f7480918c` |
| `package.json` | `e226f65fe7ada1d836940d6a36a21a34591de549` |
| `docs/delivery/acceptance.md` | `c0340ef479e6e2246ec43e4c5ba7283a29f1771d` |
| `docs/delivery/implementation.md` | `7f8cded623a4d8711c914b3cb390c5fa2ae5791b` |
| `.agentdev/work/WP-10/plan.md` | **UNTRACKED（HEAD 中不存在）** |
| `.agentdev/work/WP-10/implementation.md` | `c97ff8f7a1ed4d2172985a1a59bce14a53213c46` |
| `.agentdev/work/WP-10/e2e.md` | `a7e62ec2847b5a99cd271504fb1e23f72c7da87c` |
| `.agentdev/work/WP-10/live.md` | `d8b0d50ffbd64f43516e883f4c931fe580698b4f` |
| `.agentdev/work/WP-10/release.md` | `808a38ef1cc95949044bb9be3a8bc3c293f693d6` |
| `.agentdev/work/WP-10/e2e-results.json` | `f269378ff6394e7c49246220a91c32a14faf6f1d` |
| `.agentdev/work/WP-10/live-results.json` | `7525e4095f732a19576e6ac5f48da099edd3cbb4` |
| `.agentdev/work/WP-10/acceptance.md` | `23ebef23dea480f33246afd63658c675a5adef0a` |

## 2. 结论

**FAIL** —— 聚合门禁存在可复现的 fail-open：一份**已提交的** `.agentdev/work/WP-10/live-results.json` 被无认证地自动并入聚合，把唯一 UNVERIFIED 的 AC-001 改成 PASS 后，`pnpm test:acceptance` 直接输出 `94/94 ACs accounted — PASS 94 / FAIL 0 / UNVERIFIED 0` 并 `exit 0`，全程没有任何真实 Provider 演练执行（W10R1-01）；同时「缺失/未执行的测试」被降级为 UNVERIFIED 且仍 `exit 0`（W10R1-02）；另有 6 个 AC 在 e2e/live 演练自身标记 UNVERIFIED 的情况下被聚合为 PASS，报告口径为「93 PASS / 1 UNVERIFIED」（W10R1-03）。三条 P1 都属于「不可证的完成声明 / fail-open 验收」，**阻断独立 Test**，须回 Develop。

需要说明的是：`pnpm test:e2e`、契约命令、真实栈本身**是真实的**（我独立复跑通过，见 §3.4、§3.6），真实 Provider 未配置时 `pnpm test:live` 确实零网络调用并以 3 退出（见 §3.3）。P1 集中在**聚合与证据来源的可信度**，不是 e2e/live 做不到真实执行。

### 计数与阻断

| 严重度 | 数量 | 是否阻断 |
|---|---|---|
| P0 | 0 | — |
| P1 | 3 | **阻断** |
| P2 | 6 | 不阻断，已登记 |
| P3 | 3 | 不阻断，已登记 |

## 3. 逐项检查

### 3.1 AC 计账完整性（对应任务项 1）

独立解析（不经过 runner）：`node -e` 直接扫描 `docs/delivery/acceptance.md` 的 `### AC-NNN` 标题 —— 结果 **94 个标题、0 重复、AC-001…AC-094 无缺口、无越界**，且 94 条全部含 `关联：REQ-*`、`Given/When/Then`、`证据：`。与 runner 用 `parseAcceptanceDoc` 的注册表（`EXPECTED_AC_IDS` 恰好 94）逐一对齐，**未发现伪造或重复 id**。

抽样独立定位（23 个 AC，含多个 runner 判 PASS 者），逐条打开被引用测试本体核对 Given/When/Then：

| AC | runner 状态 | 映射 | 独立核对结论 |
|---|---|---|---|
| AC-002 | PASS | test-name | 映射用例（`apps/daemon/test/server.test.ts:119/234`、`packages/core/test/artifacts.test.ts:231/273/524/550`）证明「仅 Artifact 写入 / 隔离预览头 / 一次性下载」，**但 Then 的「隔离预览」要求真实浏览器**，未执行（见 W10R1-03） |
| AC-004 | PASS | supplemental | `packages/domain/test/domain.test.ts:168` 断言 `decideLevel(assist).level === 'none'`；`apps/daemon/test/server.test.ts` 只读路由用例 —— 与 rationale 相符，**真证据** |
| AC-005/006 | PASS | test-name | `artifacts.test.ts`「records the authority an explicit message grants」「splits one mixed message」——**真证据** |
| AC-010 | PASS | test-name | 离线：`packages/domain/test/delivery.test.ts` 的 stage order/缺失阶段；e2e：`delivery.l2-chain` + `delivery.settlement` 走真实 `StageGate.submit`、`evaluateStageChain`、`buildFinalManifest`、`settle` —— **真证据但输入由演练自建**（见 §3.4） |
| AC-026 | PASS | **file** | `packages/workspace/test/scan.test.ts:2` 头注释写 `AC-026/027/042`，故该文件全部 21 个用例（resolveProject、budget、nested repo、GitPort…）都成为 AC-026 证据；其中确有「40 files/512KiB 预算」「unknowns 明确」「扫描不建文件」，**但测试本身并未以 AC-026 为契约声明**（见 W10R1-04） |
| AC-027 | PASS | **file** | 唯一依据是 `packages/workspace/test/initialize.test.ts:3` 头注释；真正对应该 AC 的 `describe('no-Git directory')`（:539）与 `describe('write conflicts')` 用例**未带 AC id**，靠同文件其他 34 个用例兜底 |
| AC-028 | PASS | **file** | 同上；真正对应的是 `describe('dirty workspace')`（:487）一个用例，未被 AC 契约绑定 |
| AC-037 | PASS | test-name | e2e `knowledge.patch-cold-start` 冷启动选择 `F-0f0f0f0f/F-0a1b2c3d` —— 真实 SQLite + 真实投影，**真证据** |
| AC-038 | PASS | test-name | e2e `surfaces.nine-real-state` 对 10 个真实页面断言 `data-*` 标记与三视图 —— **真证据** |
| AC-041 | PASS | test-name | e2e 知识补丁提交 + 投影 valid + 冷启动；`packages/core/test/settlement.integration.test.ts` 亦覆盖 —— **真证据** |
| AC-052 | PASS | test-name | `apps/daemon/test/server.test.ts:187` 上传 hostile HTML 后**只断言响应头**（CSP/sandbox/credentials）；Given 的「产物脚本尝试读 cookie/网络/父页」与 When 的「预览」在真实浏览器中**从未发生**（见 W10R1-03） |
| AC-054 | PASS | test-name | `packages/client/test/commands.test.ts` 断言行重连与有界退避；e2e `events.watermark-reconnect`。**未在真实无头浏览器中关闭 BFF/页面**（见 W10R1-03） |
| AC-065 | PASS | **file** | 依据 `packages/contracts/test/entities.test.ts:36` 与 `packages/storage/test/migrations.integration.test.ts:60` 头注释；两文件在真实 SQLite 上跑迁移，实质相关但非 AC 契约绑定 |
| AC-066 | PASS | **file** | 依据 `packages/pi-runtime/test/events.test.ts:6`、`packages/pi-runtime/test/session.integration.test.ts:16/20/160` 头注释；**真实模型流式增量/会话历史恢复未执行**（源码自述「re-run at WP-10」），见 W10R1-03 |
| AC-067 | PASS | supplemental | 5 条人工映射逐条核对 `packages/pi-runtime/test/extensions.test.ts`、`apps/runner/test/attempt.integration.test.ts` —— **真证据** |
| AC-070 | PASS | test-name | `apps/web/test/views.test.ts` 过期卡片 + e2e `plan.approval-expired-card`（无 Plan 拒绝、批准 v1、superseded→VERSION_CONFLICT）—— **真证据** |
| AC-072 | PASS | test-name | e2e 断言非 Chief 页无 `newConversation`、有 `discussInChief` 深链接 —— **真证据** |
| AC-076 | PASS | test-name | 服务端拒绝（`artifacts.test.ts:158`、`server.test.ts:221`）—— 真证据；**客户端提示文案未执行**（见 W10R1-03） |
| AC-078 | PASS | test-name | `apps/daemon/test/server.test.ts` 认证/Origin/Cookie + e2e `stack.boot`/`auth.lifecycle` —— **真证据** |
| AC-086 | PASS | supplemental | 7 条人工映射逐条核对 `feature-format.test.ts`（含 `design=confirmed` 无决策引用、`verification=passed` 无 coverage/错 revision 等负例）—— **真证据** |
| AC-090/093 | PASS | test-name | `protocol.integration.test.ts` 真实 Git 保存 + e2e `requirement.save-git`（真实提交、recordVersion 2、原子提交两文件）—— **真证据** |
| AC-092 | PASS | **file** | 唯一依据 `packages/core/test/requirements.integration.test.ts:19`（原文写「AC-092 **partial**」）；AC-092 的 Then 还要求「拉取已更新 Git 但投影未刷新时保存必须拒绝覆盖」「用户修复 Git 后显式导入解除冲突」，这些不在该文件 10 个用例中 |

未发现「id 仅出现在标题/注释即 PASS」之外的伪造 id；`AC-999` 负例被 `extractAcIds` 正确排除（报告 §6.5 列明）。**结论：注册表完整；但 6 个 file 映射与 6 个 browser/model 依赖 AC 的 PASS 不可证**（W10R1-03/04）。

### 3.2 Fail-closed 行为（对应任务项 2）

真实运行：`pnpm test:acceptance`（原始输出 `/tmp/wp10r/acceptance-run1.log`）

```
acceptance: parsed 94 ACs from docs/delivery/acceptance.md
acceptance: project "unit" exit=0 1105 tests, 0 failed
acceptance: project "integration" exit=0 311 tests, 0 failed
acceptance: 94/94 ACs accounted — PASS 93 / FAIL 0 / UNVERIFIED 1
acceptance: OK — every AC has a result and no mapped check failed
EXIT=0
```

对抗探针（全部在 `/tmp/wp10r/`，未改动实现）：

1. **伪造已提交演练报告 → FAIL/UNVERIFIED 变 PASS（P1，W10R1-01）。** 把 `git checkout` 后的 `.agentdev/work/WP-10/live-results.json` 中 AC-001 的 `UNVERIFIED` 手工改成 `PASS`（evidence 写「FORGED: a real provider drill was executed by hand」），再跑：

```
$ node scripts/acceptance.mjs --report /tmp/wp10r/acceptance-forged2.md
AC-001  PASS        none          —  residual
acceptance: 94/94 ACs accounted — PASS 94 / FAIL 0 / UNVERIFIED 0
acceptance: OK — every AC has a result and no mapped check failed
EXIT=0
```

   全程没有启动任何 Provider、没有任何真实演练；该文件头部写着「自动生成，请勿手工编辑」，但 runner 无条件信任它（`acceptance.mjs:201-204` 自动把 `e2e-results.json`/`live-results.json` 加入 drill 列表，`acceptance-evidence.mjs:220-222` 只要 drill 是 PASS 就把 AC 置为 PASS，覆盖既有 FAIL）。

2. **聚合级 FAIL→PASS 覆盖（同根因，独立证明）。** `/tmp/wp10r/probe-drill-override.mjs` 用 runner 自己的 `aggregateAcceptance`，喂一份含真实失败用例（AC-052 用例 `status: 'failed'`）的 Vitest 报告：无 drill 时 `AC-052 = FAIL`；加入 `['AC-052', {status:'PASS'}]` 后 `AC-052 = PASS`。

3. **缺失/零用例的测试不闭合（P1，W10R1-02）。** `/tmp/wp10r/probe-failclosed3.mjs`（自造 2 个 AC、2 个测试文件，其中 A 文件完全不在执行报告里、B 文件在报告里但 `assertionResults: []`）：

```
diagnostics.unexecuted = ["packages/foo/test/a.test.ts"]
diagnostics.testCounts = 0 | scannedFiles = 2 | executedFiles = 1
  AC-001 → UNVERIFIED | mapping none
  AC-005 → UNVERIFIED | mapping none
counts = {"PASS":0,"FAIL":0,"UNVERIFIED":2} ⇒ runner exit code would be 0
```

   真实文件上的同型观察：删掉 `packages/workspace/test/initialize.test.ts` 的执行结果后，AC-028 降为 UNVERIFIED，AC-027 因同 id 也出现在 `scan.test.ts` 仍为 PASS。`diagnostics.unexecuted` 只写进报告 §6.3，既不产生 FAIL 也不影响退出码；`acceptance.mjs:299-305` 的退出条件只看 `counts.FAIL`、`missingResults`、`unmappedFailures`。

4. **`--drill-report` / `AGENTDEV_DRILL_REPORTS` 指向任意 JSON。** `node scripts/acceptance.mjs --projects unit --drill-report /tmp/wp10r/forged-report.json` 输出 `AC-001 PASS ... PASS 89 / FAIL 1 / UNVERIFIED 4`（FAIL 来自 `--projects unit` 丢弃 integration 证据，与伪造无关）；同一路径在完整两项目运行时会把 `FAIL 1` 补成 `FAIL 0`。另外 `skipped` 用例被正确记为 UNVERIFIED（`acceptance-evidence.mjs:206-208`）、`SUPPLEMENTAL_EVIDENCE` 条目缺失时返回 FAIL（:175-189）—— 这两条闭合是对的；唯一「无结果」出口在第 3 点。

### 3.3 UNVERIFIED 的诚实性 与 零网络（对应任务项 3）

`pnpm test:live`（未配置 Provider），用 `node --require /tmp/wp10r/netprobe.cjs` 包住 `net.Socket.connect`/`net.createConnection`/`net.Server.listen`/`dns.*`/`http(s).request|get`/`fetch`（探针已自检，能捕获真实连接）：

```
$ env -u AGENTDEV_PROVIDER_* node --require /tmp/wp10r/netprobe.cjs scripts/live.mjs --no-write
UNVERIFIED provider.configuration      [-] UNVERIFIED: real Provider not configured (set AGENTDEV_PROVIDER_BASE_URL, AGENTDEV_PROVIDER_MODEL, AGENTDEV_PROVIDER_SECRET)
UNVERIFIED drill.html-explanation      [AC-001] ...
UNVERIFIED drill.l1-typo               [AC-007] ...
UNVERIFIED drill.l2-delivery           [AC-010,AC-037,AC-041] ...
live: UNVERIFIED — 0 real Provider calls were made; set ...
EXIT=3
net events: 0
```

       另用「已配置但不可达」的凭证（`AGENTDEV_PROVIDER_BASE_URL=http://127.0.0.1:1/v1`、`..._SECRET=sk-WP10R-SUPERSECRET-9876543210`）验证：探针记录 `node:http.request {"port":"1","path":"/v1/chat/completions"}` + `net.createConnection 127.0.0.1:1`，即**只在配置齐备时**才发一次真实请求，之前是 0 次；`provider.connectivity` FAIL、`EXIT=1`、输出与 JSON 中检索 `SUPERSECRET` **无命中**（`live-transport.mjs:209-213` 的 `mask()` 生效，`live-report.mjs:20-31` 另有 `redactUrl`）。

报告诚实性：`live-results.json` 为 `exitCode 3 / configured:false`；`live.md`、`release.md` 记录 `pnpm test:live` exit 3 且 `结论：NOT READY`；`acceptance.md` 中 AC-001 为 `UNVERIFIED` 并写明缺失 `AGENTDEV_PROVIDER_*`。**AC-001 未被伪造成 PASS/READY** —— 这一点是诚实的。但 `release.md` §3 只提示「1 个 AC 为 UNVERIFIED」，掩盖了另外 6 个「PASS 但演练侧 UNVERIFIED」的 AC（W10R1-03/08）。

### 3.4 e2e 是否真实、非自证（对应任务项 4）

`node scripts/e2e.mjs`（原始输出 `/tmp/wp10r/e2e-run1.log`）：`E2E_EXIT=0`，`20 checks — PASS 16 / FAIL 0 / UNVERIFIED 4`，`23 ACs accounted for`。与提交版报告逐行比对，除 `generatedAt`/`gitHead`/随机 UUID/耗时外**完全一致**（`git diff` 仅这些字段）。

- **真实栈**：`e2e.mjs` 创建真实临时 Git（`git init` + 真实提交）、真实 SQLite `ProjectStore`、真实 `createDaemon`（`/rpc` + `/ws`）、真实 `createWebApp` BFF，端口 0（`e2e.md` §0 记录 daemon/BFF 回环 URL）；`offline.no-model-call` 用真实 loopback 桩计数，断言全演练 0 次 Provider 请求。运行后 `/tmp/agentdev-*` 无残留、无新增 node listener。
- **不测 stale dist**：`e2e-runtime.mjs:59-85` 用 `registerHooks` 把 `@agentdev/*` 与 `./x.js` 直接映射到 `packages/*/src/index.ts`、`apps/*/src/*.ts`；`loadProduct()` 之后才动态 import。全文件未出现 `dist` 导入。
- **L2/结算/冷启动是否自证**：`delivery.l2-chain` 用真实 `gitPort.addWorktree/commitPaths/mergeTree`、真实 `core.StageGate.submit`（5 个 Run/Attempt，schema+epoch+事务校验）、真实 `domain.evaluateStageChain`（顺序 + 缺 Test 被拒）；`delivery.settlement` 用真实 `buildFinalManifest`/`freezeFinalManifest`/`settle`（CAS 移动 `refs/heads/agentdev/main`、Requirement completed、唯一 `settlement.completed` 事件、冻结清单回读）。这些断言打在产品返回值与真实 Git 状态上，**不是演练自记账**。
- **但输入面是自造的**：Task 行、Requirement→Work 绑定、5 份 stage payload（含 Test 的 `checkResult`）都由演练直接 `store.*.insert/update` 构造，再交给真实 Gate。`e2e.md` §3 已登记「Task 行由演练直接插入」「需求→Work 绑定直接改 row」，属诚实登记；严格意义上是「真实规则 + 合成输入」，不等于真实 Runner 产出的交付链。
- **CAS 用内存实现**：`createMemoryCasJournal`（`e2e.md` §3 已登记），崩溃/恢复注入不在本切片。

### 3.5 「覆盖 23 个 AC」claim（对应任务项 5）

`e2e-results.json` 的 `results` 共 **23 条、无重复**，与 `checks.aggregate()` 一致；其中 **17 PASS / 6 UNVERIFIED**（AC-001/002/052/071/073/076）。`e2e.md` 表格亦为 23 行。claim 数量成立；`implementation.md` 的「覆盖 23 个 AC」在字面上正确，但应注明其中 6 个是 UNVERIFIED 行（同 W10R1-08 的口径问题）。

### 3.6 契约命令真实性（对应任务项 6）

全部在仓库根、`export PATH="$HOME/.local/bin:$PATH"` 下真实执行：

| 命令 | 退出码 | 观测结果 |
|---|---|---|
| `pnpm typecheck`（另跑 `pnpm exec tsc -p tsconfig.json --noEmit`） | 0 / 0 | 无输出 |
| `pnpm lint` | 0 | Prettier 全绿 + ESLint |
| `pnpm test:unit` | 0 | `Test Files 55 passed (55)` / `Tests 1105 passed (1105)`；独立 JSON 报告 `numTotalTests 1105 / numFailed 0 / numPending 0 / files 55` |
| `pnpm test:integration -- --maxWorkers=4` | 0 | `Test Files 26 passed (26)` / `Tests 311 passed (311)`；Docker 容器用例**确实执行**（`runs a container read through Docker and reports the real non-root account 16408ms`、`keeps the frozen source read-only inside the real container (AC-048, AC-050) 4168ms`），`docker info` exit 0 |
| `pnpm docs:check` | 0 | `docs:check ok — 15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages` |
| `pnpm build` | 0 | 全 workspace 构建成功 |
| `pnpm doctor` | 0 | `All checks passed`，`pnpm m ls --depth -1` = 13 个项目（root + 12） |

与 `implementation.md` 记录比对：**1105/55、311/26 完全吻合**；「12 workspace」指根 + 12 子项目，与 `pnpm m ls` 的 13 行口径不同但可解释（install 输出亦为 `all 13 workspace projects`）。未发现记录与现实的数值差异。

### 3.7 新脚本的回归风险（对应任务项 7）

- **仓库内写入面**：`acceptance.mjs` 只写 `--report`/`--json` 指定路径（默认 `.agentdev/work/WP-10/acceptance.md`）；`e2e.mjs` 写 `e2e-results.json`/`e2e.md`；`live.mjs` 写 `live-results.json`/`live.md`；`live.mjs --release` 写 `release.md`。除这些受控产物外不触碰跟踪文件；e2e 的 Git 工作全部在 `mkdtempSync` 目录（`/tmp/agentdev-e2e-*`），实测运行后无残留目录、无残留进程/端口（`lsof -nP -iTCP -sTCP:LISTEN` 仅本机 3080/8080 两个既有服务）。
- **失败清理**：`e2e.mjs:175-181` 与 `live-harness.mjs:697-703` 的 `finally` 均调用 `harness.close()`（`closeAll(1001)` + 关闭两个 server + `store.close()`）与 `cleanupTempDirs()`；`--keep-temp` 分支只打印保留路径。
- **凭证遮蔽**：`live-transport.mjs` 的 `mask()` 覆盖连接错误与响应体（:241/:247/:252/:265），`live-report.mjs` 的 `redactUrl` 去掉 userinfo；实测「已配置 + 不可达」路径的输出/JSON 中搜索 secret 值无命中（§3.3）。未在 `live-drills.mjs`/`live-harness.mjs` 中找到把原始 secret 写入错误消息或报告的路径。
- **无可执行位/依赖变化**：`package.json` 仅新增 6 行脚本（`test:e2e`/`test:acceptance`/`test:live` 等），未新增依赖、未引入 Playwright。

### 3.8 产品决定偏差是否记录（对应任务项 8）

实现与产品决定一致：`package.json` 无 Playwright 依赖；`test:e2e` 为真实栈无头端到端；浏览器级证据（AC-002/052/071/073/076 的客户端半边）在 `e2e.md`、`live.md`、`acceptance.md`、`implementation.md`、`release.md` 均登记 UNVERIFIED。偏差在 `plan.md` §2 D1（「与 implementation.md §3 表格『Playwright+真实Core+Provider桩』字面不一致，属已批准偏差」）与 `release.md`/`implementation.md` 中明确记录，未静默隐藏。**此项通过。**

## 4. 发现清单

### W10R1-01（P1，阻断）已提交的演练报告可被直接改写，把 UNVERIFIED/FAIL 抬成 PASS 并使门禁 exit 0
- 证据：`acceptance.mjs:201-204` 无条件把 `.agentdev/work/WP-10/{e2e,live}-results.json` 加入 drill 列表；`acceptance-registry.mjs:336-388` 只校验 `{ac,status}` 形状与状态词；`acceptance-evidence.mjs:220-222` 只要 drill `PASS` 就把 AC 置 PASS（覆盖既有 FAIL）。无任何「报告是否由本次运行产生」「是否绑定当前 HEAD/代码树」的校验。
- 复现：
  ```
  node -e 'const fs=require("fs");const p=".agentdev/work/WP-10/live-results.json";const j=JSON.parse(fs.readFileSync(p,"utf8"));j.results.find(r=>r.ac==="AC-001").status="PASS";fs.writeFileSync(p,JSON.stringify(j,null,2)+"\n")'
  node scripts/acceptance.mjs --report /tmp/wp10r/acceptance-forged2.md   # → EXIT=0
  # AC-001 PASS / 94/94 accounted — PASS 94 / FAIL 0 / UNVERIFIED 0
  git checkout -- .agentdev/work/WP-10/live-results.json
  ```
  聚合级旁证：`node /tmp/wp10r/probe-drill-override.mjs` → `WITHOUT drill → AC-052 = FAIL`；`WITH forged drill → AC-052 = PASS`。
- 产品影响：发布验收的「通过」可由仓库内一份 JSON 文件满足，而不是由真实演练满足；`implementation.md` 声称的「演练 FAIL 覆盖套件 PASS」是单向的，反向（演练 PASS 覆盖套件 FAIL）无约束。任何能改该文件的人即可让发布门禁变绿。
- 修复建议：drill 报告必须由本次运行产出并可选签名/绑定——至少要求报告携带 `gitHead` 且等于当前 HEAD、`generatedAt` 在本次运行窗口内、文件哈希记录在运行日志中；`drill PASS` 不得覆盖同一次运行中的套件 FAIL（只能补 UNVERIFIED→PASS）；`--drill-report` 仅接受显式参数且对未登记来源给出审计告警。

### W10R1-02（P1，阻断）缺失/零用例的测试文件被降级为 UNVERIFIED，仍 exit 0
- 证据：`acceptance-evidence.mjs:267-270` 只把未执行文件计入 `diagnostics.unexecuted`；`acceptance.mjs:297-305` 的退出条件不含 `unexecuted`。报告 §6.3 声称「无：全部含 AC 证据的测试文件都出现在 Vitest 报告中」——它是**诊断**，不是门禁。
- 复现：`node /tmp/wp10r/probe-failclosed3.mjs` → `diagnostics.unexecuted = ["packages/foo/test/a.test.ts"]`、两个 AC 均 UNVERIFIED、`counts {"PASS":0,"FAIL":0,"UNVERIFIED":2} ⇒ exit 0`。真实文件旁证：`node /tmp/wp10r/probe-failclosed2.mjs` 删除 `initialize.test.ts` 执行结果后 AC-028 → UNVERIFIED。
- 产品影响：契约要求「必需 AC 全有结果」；实际只要 AC「有一条记录」即算有结果，测试文件消失/未被 vitest 收集时既不 FAIL 也不非 0。真实发布中这些 AC 还可能被 W10R1-01 的 drill PASS 直接补成 PASS。
- 修复建议：把 `diagnostics.unexecuted`（含 `file` 映射的 AC）与「某 AC 的执行证据在本次运行中从 PASS 降为 UNVERIFIED」视为非 0 条件，或在报告中把这类 UNVERIFIED 标为 FAIL 并要求显式豁免。

### W10R1-03（P1，阻断）6 个「浏览器/模型依赖」AC 在演练自身 UNVERIFIED 的情况下被聚合为 PASS，报告口径为「93 PASS / 1 UNVERIFIED」
- 证据：`acceptance.md` 表格中 AC-002/052/054/066/071/073/076 的「备注」列分别写明「真实浏览器渲染与隔离未执行」「真实浏览器攻击样例未执行」「真实无头浏览器断开/重连未执行」「真实模型流式增量与会话历史恢复未执行」「真实 viewport 截图与焦点切换未执行」「真实浏览器键盘遍历/ARIA 未执行」「客户端提示文案…未验证」，§5 亦逐条列出；同时 `e2e-results.json` 对这 6 个 AC 的 drill 记录为 UNVERIFIED。`acceptance-evidence.mjs:223-225` 只在 AC 自身为 UNVERIFIED 时才用 drill 的 UNVERIFIED 细化原因，**drill UNVERIFIED 不会下调 suite PASS**。
- 复现：`pnpm test:acceptance` → 输出与 `acceptance.md` 均为 `PASS 93 / FAIL 0 / UNVERIFIED 1`；对照 `sed -n '142,155p' .agentdev/work/WP-10/acceptance.md`（§5 未执行部分表）。测试本体：`apps/daemon/test/server.test.ts:187-216` 只断言响应头；`packages/pi-runtime/test/events.test.ts`（7 例）与 `session.integration.test.ts` 只做离线映射/生命周期。
- 产品影响：AC-052 的 Given/When/Then 是「产物脚本尝试读取 cookie/网络/父页；When 预览；Then 被隔离阻止」——离线只证明「策略头正确」，未证明隔离生效；AC-066 的「流式/恢复」在真实模型上从未执行。发布记录据此宣称 93 项通过，属不可证的完成声明。
- 修复建议：当 `DRILL_DEPENDENCIES`（并把 AC-007/010/037/041 也纳入，见 W10R1-10）中的 AC 有 drill UNVERIFIED 时，聚合状态应为 UNVERIFIED（或至少新增 `PASS(partial)` 状态），由 `KNOWN_RESIDUALS` 给出未执行部分；「93 PASS / 1 UNVERIFIED」的汇总行必须披露「其中 N 个仅有部分证据」。

### W10R1-04（P2）`file` / `test-name` 映射粒度过粗，丢失单个关键用例不会改变 AC 结论
- 证据：`acceptance-evidence.mjs:164-172`、`acceptance-report.mjs:213-215`（原文「该文件全部用例为证据」）。AC-026~028/065/066/092 共 6 个 AC 走 `file` 映射：`packages/workspace/test/scan.test.ts:2`、`initialize.test.ts:3`、`entities.test.ts:36`、`migrations.integration.test.ts:60`、`events.test.ts:6`、`session.integration.test.ts:16`、`requirements.integration.test.ts:19`（后者原文即写「AC-092 **partial**」）。
- 复现：`node /tmp/wp10r/probe-failclosed2.mjs` —— 删除 `initialize.test.ts` 执行结果后 AC-028 → UNVERIFIED（其唯一文件），而 AC-027 仍 PASS（同 id 也出现在 `scan.test.ts`）。即：AC-028 真正对应的 `describe('dirty workspace')` 用例消失时，同文件另 34 个无关用例仍能提供 PASS。
- 产品影响：AC-026/027/028/065/066/092 的证据可被同文件任意其余用例「稀释」，与「每个 AC 有可审计证据」的意图不符。
- 修复建议：把 `file` 映射收敛为精确用例清单（像 `SUPPLEMENTAL_EVIDENCE` 一样逐条 resolve），或在测试内改用 `it('... (AC-027)')` 直接携带 id。

### W10R1-05（P2）drill 报告按路径排序「后者覆盖前者」，最强证据被次强证据覆盖；报告只显示最后一份来源
- 证据：`acceptance.mjs:205` `[...new Set(paths)].sort()`；`loadDrillReports` 逐份 `results.set(id, entry)`（:226）。`e2e-results.json` < `live-results.json`，因此 live 的 UNVERIFIED 覆盖 e2e 对该 AC 的 PASS/FAIL。
- 复现：`grep -A1 '^AC-010' /tmp/wp10r/acceptance-run1.log` → `AC-010 PASS test-name … 演练：UNVERIFIED（.agentdev/work/WP-10/live-results.json）`；而同一 AC 在 `e2e-results.json` 中为 PASS（`delivery.l2-chain`）。`acceptance.md` §6.6 也只列最后一份来源与说明，`e2e` 的 PASS 证据不可见。
- 产品影响：审计者会以为 AC-010 的演练未验证，实际 e2e 已验证；反向（e2e FAIL 被 live UNVERIFIED 覆盖）更危险。
- 修复建议：按语义优先级合并（FAIL > PASS > UNVERIFIED）或列出全部来源，而不是按文件名排序后覆盖。

### W10R1-06（P2）作为冻结版证据的报告生成于父提交，且 runner 不校验报告与当前 HEAD 绑定
- 证据：`git show 0aff531:.agentdev/work/WP-10/acceptance.md | head -16` → `Git HEAD：508bfaf…`；`e2e-results.json` 提交版 `generatedAt 2026-09-13T13:37:59Z / gitHead 508bfaf…`；`release.md` §0 `Git HEAD：508bfaf…`；`live-results.json` 亦为 `508bfaf…`。而 `508bfaf..0aff531` 的改动含 `scripts/*` 与 `package.json`（产品 `packages/`、`apps/` 未变）。
- 复现：`for f in e2e-results.json live-results.json; do git show 0aff531:.agentdev/work/WP-10/$f | node -e '…'; done`；`git diff --name-only 508bfaf 0aff531 | grep -v WP-10`。
- 产品影响：`implementation.md` §4 要求每次测试记录「输入 Revision」；当前报告是父提交的产物，冻结版自身从未被这套 runner 跑过一次即被声明通过。我复跑后结果一致（仅元数据/随机 id 不同），但这是**复核**，不是提交时的证据绑定。
- 修复建议：冻结提交前在当前 HEAD 重跑并提交报告，或在聚合器/发布门禁中断言报告 `gitHead === HEAD`、否则 FAIL。

### W10R1-07（P2）就绪门禁优先读取磁盘上的旧 `acceptance.md` 统计，而非本次 `test:acceptance` 的输出
- 证据：`live-release.mjs:153-168` `const report = readFileSync(reportPath) … const match = pattern.exec(report) ?? pattern.exec(output)`。
- 复现：静态可读；副作用演示：若手工把 `acceptance.md` 的统计行改成「PASS 94 / FAIL 0」而 `test:acceptance` 本次实际 FAIL，`release.md` 的「AC 统计」行会展示被改写的数值，同时因命令非 0 结论仍为 NOT READY。
- 产品影响：发布记录里的 AC 统计可能不是本次运行的结果（与 W10R1-01 同源：磁盘产物被信任）。结论本身仍 fail-closed（命令失败即 NOT READY），故列为 P2。
- 修复建议：只解析本次命令 stdout，或校验报告内 `generatedAt`/`gitHead` 与本次运行一致。

### W10R1-08（P2）就绪判定把 UNVERIFIED 视为非阻断，且汇总行的口径掩盖部分证据
- 证据：`live-release.mjs:245-256`（`readinessProblems` 只看 `exitCode!==0` 与 `counts.fail>0`）、`acceptance.mjs:299-305`、`acceptance.md` §3 提示语。当前报告 `PASS 93 / FAIL 0 / UNVERIFIED 1` + `NOT READY`（仅因 `test:live` exit 3），但另有 6 个 AC 实际只具备部分证据却计入 PASS。
- 复现：`pnpm test:acceptance` 输出行 + `release.md` §2/§3。
- 产品影响：若 Provider 可用使 `test:live` 变绿，同一门禁会输出 READY，而浏览器级与实机模型级行为仍未执行。
- 修复建议：就绪门禁把「部分证据 PASS」计为需豁免项并逐条列出；在 `release.md` 同时给出 `PASS(full)/PASS(partial)/UNVERIFIED` 三分口径。

### W10R1-09（P3）工作区不干净，`plan.md` 未纳入冻结提交
- 证据：`git status --porcelain` → `?? .agentdev/work/WP-10/plan.md`；`git ls-files .agentdev/work/WP-10/` 不含 `plan.md`；任务书把 `plan.md` 列为受审产物。文件内容完整（47 行，含 D1/D2 决定与 T1–T4）。
- 复现：`git ls-files .agentdev/work/WP-10/; git status --porcelain`。
- 产品影响：Plan 是交付门禁的第一步产物（`docs/rules/workflow.md`），未跟踪意味着检出冻结提交不会得到该 Plan；`plan.md` 恰好是「产品决定偏差」的登记处（§2 D1），证据链不完整。
- 修复建议：把 `plan.md` 纳入提交（或在 `implementation.md` 中明确其归属与存放位置）。

### W10R1-10（P3）live 演练声明的 AC 与 `DRILL_DEPENDENCIES` 不一致，AC-007/010/037/041 的 UNVERIFIED 未被登记
- 证据：`live.mjs:57-61` `DRILL_ACS = { html:['AC-001'], l1:['AC-007'], l2:['AC-010','AC-037','AC-041'] }`；`acceptance-registry.mjs:275-293` 只登记 AC-001/011/043/066。因此 `live-results.json` 里 AC-007/010/037/041 的 UNVERIFIED 只体现在 §6.6「演练结果接入」，`acceptance.md` §2/§3 对它们没有任何「缺演练」说明（`latest-drill` 的 UNVERIFIED 在 suite PASS 时被丢弃）。
- 复现：`grep -n 'AC-007' .agentdev/work/WP-10/acceptance.md | head`（仅 §6.6 出现，§2 备注无演练说明）；`grep -n DRILL_ACS\|DRILL_DEPENDENCIES scripts/live.mjs scripts/lib/acceptance-registry.mjs`。
- 产品影响：AC-007（L1 真实执行）与 AC-010/037/041 的真实纵向演练缺口在验收汇总层不可见。
- 修复建议：`DRILL_DEPENDENCIES` 与 `live.mjs` 的 `DRILL_ACS` 由同一常量导出，避免两处清单漂移。

### W10R1-11（P3）`CheckList.check()` 允许返回空证据仍记 PASS
- 证据：`e2e-checks.mjs:70-81`，`evidence === undefined || evidence === ''` 时写成 `'(no evidence text)'`、`status: 'PASS'`。当前 20 个检查均返回真实证据（我按检查体统计 `ensure(` 命中数为 3~23 条），故未触发。
- 复现：`sed -n '67,82p' scripts/lib/e2e-checks.mjs`；`sed -n '2192,2205p' scripts/e2e.mjs`（`offline.no-model-call` 检查体）。
- 产品影响：未来新增的检查若忘记返回证据，会静默变成 PASS，形成第二条 fail-open 通道。
- 修复建议：返回空证据即 FAIL（或强制 `evidence` 必填）。

### W10R1-12（P3）代码注释与实现不一致（`live-report.mjs` 声称 drill UNVERIFIED「永远不会下调 suite PASS」，`acceptance-evidence.mjs` 的文档注释也未提「drill PASS 覆盖 FAIL」）
- 证据：`live-report.mjs:10-12`「An UNVERIFIED row can only refine the reason of an AC that no executed evidence covers; it can never downgrade a suite PASS.」；同一契约的实际语义在 `acceptance-evidence.mjs:4-15` 与 `:220-222` 是「drill PASS 覆盖一切，包括 FAIL」。
- 复现：`sed -n '1,20p' scripts/lib/live-report.mjs`；`sed -n '214,226p' scripts/lib/acceptance-evidence.mjs`。
- 产品影响：读者据注释会低估 drill 报告的权限（正是 W10R1-01 的攻击面）。
- 修复建议：在 `live-report.mjs` 明确「drill 可覆盖 FAIL 是已知风险，需信任来源」，并同步 `implementation.md`。

### 已排除的疑点（说明我复核过但未成立）
- **覆盖率统计**：`acceptance.md` 的「已执行提交用例：1416 个，覆盖 81/81 个测试文件」经复核为真——`/tmp/wp10r/unit.json` 的 `testResults` 为 55 条、`name` 是不含 `::` 的真实文件路径（`assertionResults` 合计 1105），integration 为 26 条 / 311 用例，55+26=81。`byFile` 键未被污染，此疑点不成立。

## 5. 未验证/无法验证项

- **真实 Provider 纵向演练（AC-001/007/010/037/041/043/066 的模型侧）**：本环境无 `AGENTDEV_PROVIDER_*`，无法执行。已按任务要求验证「未配置 ⇒ 零网络调用 + exit 3 + 点名缺失」；配置后三条纵向路径是否真的通过，需用户提供凭证后由 Test 在真实环境判定。
- **真实浏览器（像素/焦点/ARIA/脚本隔离攻击样例）**：按产品决定不引入 Playwright/浏览器下载，无法验证；只能验证离线断言与演练自身的 UNVERIFIED 登记。
- **`pnpm install --frozen-lockfile`**：本次未重跑（`node_modules` 已就绪）；`release.md` 记录 exit 0，我未独立复核锁文件一致性。
- **`pnpm test:integration` 的 26 个文件是否与「recorded at 26」完全同集合**：我复跑得到 `26 passed / 311 tests`（输出尾部），未逐文件 diff。
- **crash/恢复注入演练（CAS journal 崩溃）**：e2e/live 均用 `createMemoryCasJournal`，设计上不在本切片，未验证。
- **`docs/rules/*`、`AGENTS.md`、`docs/INDEX.md` 与本包的一致性**：仅按需查阅，未做全量交叉审计（不是本次 review 的判定对象）。
- **报告的「无失败原始输出」**：`e2e.md` §4 写「无失败」，我复跑 e2e 确为 0 FAIL，未构造产品侧故障注入（会写入跟踪文件），故「首个失败即非 0 且写 FAIL 报告」只做了代码路径核对（`e2e.mjs:174-181`、`:206-211`），未实测。

## 6. 独立复算的命令输出

均为真实输出（节选）。原始日志：`/tmp/wp10r/{acceptance-run1.log,e2e-run1.log,unit.log,integration.log,typecheck.log,lint.log,docscheck.log,build.log,doctor.log,live-unconfigured.out,live-fake.out,acceptance-forged2.log}`；探针：`/tmp/wp10r/{netprobe.cjs,probe-drill-override.mjs,probe-failclosed.mjs,probe-failclosed2.mjs,probe-failclosed3.mjs,ac-mapping.mjs}`。

```text
$ git rev-parse HEAD; git rev-parse HEAD^{tree}; git status --porcelain
0aff531d6dd8c08e88ba99aea455db1c32f809fb
103baf68091cbc19dbb1f132d3f3cd2f945fbd9c
?? .agentdev/work/WP-10/plan.md

$ pnpm test:acceptance
acceptance: parsed 94 ACs from docs/delivery/acceptance.md
acceptance: project "unit" exit=0 1105 tests, 0 failed
acceptance: project "integration" exit=0 311 tests, 0 failed
acceptance: 94/94 ACs accounted — PASS 93 / FAIL 0 / UNVERIFIED 1
acceptance: OK — every AC has a result and no mapped check failed          # EXIT=0

$ node scripts/e2e.mjs
PASS stack.boot … PASS knowledge.patch-cold-start … PASS offline.no-model-call
UNVERIFIED browser.rendering-and-isolation / browser.viewport-and-keyboard / browser.upload-client-hints / provider.fact-and-unknown
e2e: 20 checks — PASS 16 / FAIL 0 / UNVERIFIED 4
e2e: 23 ACs accounted for by the drill; exit 0                              # E2E_EXIT=0

$ env -u AGENTDEV_PROVIDER_BASE_URL -u AGENTDEV_PROVIDER_MODEL -u AGENTDEV_PROVIDER_SECRET \
    node --require /tmp/wp10r/netprobe.cjs scripts/live.mjs --no-write
UNVERIFIED provider.configuration [-] UNVERIFIED: real Provider not configured (set AGENTDEV_PROVIDER_BASE_URL, AGENTDEV_PROVIDER_MODEL, AGENTDEV_PROVIDER_SECRET)
live: UNVERIFIED — 0 real Provider calls were made; set …
EXIT=3
net events: 0

$ AGENTDEV_PROVIDER_BASE_URL=http://127.0.0.1:1/v1 AGENTDEV_PROVIDER_MODEL=wp10r-review-model \
  AGENTDEV_PROVIDER_SECRET=sk-WP10R-SUPERSECRET-9876543210 node --require /tmp/wp10r/netprobe.cjs scripts/live.mjs --no-write
net events: node:http.request {"port":"1","path":"/v1/chat/completions"} / net.createConnection 127.0.0.1:1
FAIL provider.connectivity [-] … ECONNREFUSED 127.0.0.1:1            # EXIT=1
secret leak scan: no leak in output

$ node /tmp/wp10r/probe-drill-override.mjs
WITHOUT drill report → AC-052 = FAIL | mapping test-name
WITH forged drill report → AC-052 = PASS | mapping test-name

$ node scripts/acceptance.mjs --report /tmp/wp10r/acceptance-forged2.md      # live-results.json 被手工改成 AC-001 PASS
AC-001  PASS        none          —  residual
acceptance: 94/94 ACs accounted — PASS 94 / FAIL 0 / UNVERIFIED 0
acceptance: OK — every AC has a result and no mapped check failed            # EXIT=0

$ node /tmp/wp10r/probe-failclosed3.mjs
diagnostics.unexecuted = ["packages/foo/test/a.test.ts"]
diagnostics.testCounts = 0 | scannedFiles = 2 | executedFiles = 1
  AC-001 → UNVERIFIED | mapping none
  AC-005 → UNVERIFIED | mapping none
counts = {"PASS":0,"FAIL":0,"UNVERIFIED":2} ⇒ runner exit code would be 0

$ pnpm test:unit 2>&1 | tail -3
 Test Files  55 passed (55)
      Tests  1105 passed (1105)

$ pnpm test:integration -- --maxWorkers=4 2>&1 | tail -3
 Test Files  26 passed (26)
      Tests  311 passed (311)
# Docker 容器用例真实执行：
#   ✓ runs a container read through Docker and reports the real non-root account 16408ms
#   ✓ keeps the frozen source read-only inside the real container (AC-048, AC-050) 4168ms
```
