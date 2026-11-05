# WP-10（发布整体验收）独立 Review 报告（第 3 轮）

- 角色：INDEPENDENT REVIEW（独立上下文；未读取任何开发/Test 聊天、transcript 或会话日志；仅使用仓库文件、git 对象、构建产物、前两轮报告与本人自行运行的实验）
- 工作包：WP-10 发布整体验收（第 3 轮；复核第 1 轮 12 条 + 第 2 轮 7 条发现是否由冻结提交 `239b9ef` 真实关闭，并独立复现发布门禁与真实 Provider 行为）
- 冻结点：`239b9ef`（`fix(release,core): close the WP-10 round-2 findings and make the real Provider path work`；tree `ac348447ad67855434eda4450b025402f71a9dd5`）。本轮全部判定针对该提交的**干净工作区**（初始 `git status --porcelain` 为空）。
- 证据目录：`/tmp/wp10r3/`（Reviewer 自建探针、日志与原始输出）。运行结束后工作区唯一新增为本报告。
- 唯一写入：本文件（`.agentdev/work/WP-10/review-round3.md`）。`pnpm test:acceptance` / `pnpm test:live --release` 会重写 `.agentdev/work/WP-10/{acceptance.md,acceptance-results.json,e2e.md,e2e-results.json,live.md,live-results.json,release.md}`，伪造实验另外短暂改写 `live-results.json`；全部已在实验后 `git checkout --` 还原（脚本 `trap` 兜底），最终 `git status --porcelain` 为空。`scripts/`、`packages/`、`apps/` 未被本 Review 持久修改（Z1/Z2 探针临时新增的两个未跟踪测试文件已删除）。
- 环境：macOS / Node v24.8.0 / pnpm 12.3.4 / Docker 可用（integration 容器用例真实执行）。
- 凭证：`AGENTDEV_PROVIDER_BASE_URL/MODEL/SECRET` 仅经进程环境传入，未写入任何文件；全 `/tmp/wp10r3` 与全仓库（排除 `node_modules`/`.git`/`dist`）对 secret 值检索 **0 命中**；无任何输出回显。

## 1. 冻结与哈希

| 项 | 值 |
|---|---|
| `git rev-parse HEAD` | `239b9ef7b69582e3f3797c5f9d9dde18d7187e7f` |
| `git rev-parse HEAD^{tree}` | `ac348447ad67855434eda4450b025402f71a9dd5` |
| `git status --porcelain`（初始 / 最终） | 空 / 空 |
| 冻结树内容绑定 `codeDigest` | `sha256:e4f7a5054a89ab6d150fe13783042c9a0655195f45c8f8653f07e58e8e4eb2d4`（252 个代码文件，`dirty:false`） |
| `.agentdev/work/WP-10/acceptance-results.json` 的 `codeDigest` | **与上值完全一致**（记录确实对应冻结代码树） |
| 三条提交记录（acceptance/e2e/live results）的 `gitHead` | `c53b28dd5c97a3f106d467c518ea2e179e8f7dca`（父提交，≠ 冻结 HEAD）——见 W10R3-03 |
| 独立 `live` 探针报告 `/tmp/wp10r3/live-standalone.json` 的 `binding` | `gitHead 239b9ef… / gitTree ac348447… / codeDigest e4f7a505…`（= 冻结树） |
| `scripts/not-implemented.mjs` | HEAD 中不存在（前轮已关闭） |
| `plan.md` | 已入库（`git cat-file -e HEAD:.agentdev/work/WP-10/plan.md` 成功） |

受审文件（`git rev-parse HEAD:<path>`，全部与工作区一致）：

| 文件 | blob |
|---|---|
| `scripts/acceptance.mjs` | `3ef2761…`（diff 见 `239b9ef`） |
| `scripts/lib/acceptance-evidence.mjs` | `792adad…` |
| `scripts/lib/acceptance-registry.mjs` | `c18ddda…` |
| `scripts/lib/acceptance-report.mjs` | `7bf9fa0…` |
| `scripts/lib/drill-acs.mjs` | 含 `RESIDUAL_GAPS`/`closedBy` |
| `scripts/lib/acceptance-drills.mjs` | 含 run nonce + binding 校验 |
| `scripts/lib/live-release.mjs` | 含 `readAcceptanceResult(…, runNonce)` |
| `packages/core/src/model-gateway.ts` | 输出预算不再硬编码 4096 |
| `packages/core/test/model-gateway.test.ts` | 新增 2 条回归测试（unit 由 1105 → 1107） |

## 2. 结论

**PASS** —— 针对冻结提交 `239b9ef`：第 2 轮的两条 P1 与第 1 轮的三条 P1 **均已真实关闭**；本轮亲自复现了发布门禁的全部关键性质与**真实 Provider 行为**（`pnpm test:live` exit 0、三条纵向路径 PASS、11 次真实 HTTP 200；`pnpm test:acceptance` 94/94 — PASS 86 / ACCEPTED 8 / FAIL 0 / MISSING 0；`node scripts/live.mjs --release` 十条命令 10/10 exit 0 → `READY (ACCEPTED RISK 8)` 并逐条列出缺口且不称其已验证）。伪造仓库演练报告、零用例映射文件、Vitest 非 0 退出、未映射失败用例、条件失效的 UNVERIFIED、nonce/binding 不符、被顶替的 sidecar 全部 fail-closed。**未发现 P0/P1**。新发现 4 条均为记录/注释层面的 P3（1 条记为 P2 的记录陈旧），不阻断独立 Test。

### 计数与阻断

| 严重度 | 数量 | 是否阻断 |
|---|---|---|
| P0 | 0 | — |
| P1 | 0 | —— |
| P2 | 1 | 不阻断（记录陈旧，W10R3-01） |
| P3 | 3 | 不阻断 |

**是否阻断独立 Test：否。** 第 2 轮两条 P1（AC-066 不可证、零用例/退出码 fail-open）均已关闭并有独立复现；第 1 轮 P1 亦关闭。剩余的 P2/P3 是文档与记录卫生问题，不改变门禁结论。

## 3. 第 1/2 轮发现逐条复核

每条给出：复现（等价或更强的独立设计）→ 现在的观测 → 结论。原始日志见 `/tmp/wp10r3/`。

### 3.1 第 1 轮（12 条）

| id | 复现摘要 | 现在观测 | 结论 |
|---|---|---|---|
| W10R1-01 P1 已提交演练报告可被改写抬成 PASS | 把仓库 `live-results.json` 的 AC-001 改成 `status:"PASS"`（evidence `FORGED round3…`），不配置 Provider，真实跑 `node scripts/acceptance.mjs --no-write`（`/tmp/wp10r3/A-noprovider.log`） | `AC-001 UNVERIFIED*  accepted gap`；输出中 `FORGED round3` 命中 **0** 次；accepted 集合为 13 条（含 AC-001/007/010/037/041/043/002/052/066/071/073/076/090）。聚合**未读取**仓库报告 | **已关闭** |
| W10R1-02 P1 缺失/零用例文件只降级仍 exit 0 | ① 新增仅含 `(AC-090)` 但模块级抛错的临时测试文件（收集成功、零用例），跑 `--no-write --no-drills --projects unit`；② 新增一个未映射的失败用例 | ① `Z2_EXIT=2`，stderr `含 AC 证据的测试文件没有执行任何用例：packages/core/test/zz-probe-collection.test.ts（文件消失/未被收集）`；② `Z1_EXIT=2`，`失败用例未映射到任何 AC：… zz-probe-unmapped.test.ts` | **已关闭** |
| W10R1-03 P1 演练 UNVERIFIED 的 AC 被聚合为 PASS | 真实无 Provider 聚合 + `RESIDUAL_GAPS`/`closedBy` 逻辑探针（`probe-gap3.mjs`） | 最弱一环生效；未登记/条件失效的 UNVERIFIED 记入 FAIL；AC-066/AC-090/浏览器 AC 不再可被任意 PASS 抬升。真实运行无「未登记 UNVERIFIED」 | **已关闭** |
| W10R1-04 P2 `file` 映射过粗 | `grep`+`acceptance-evidence.mjs`：无文件级映射 | 仅 `test-name`/`curated`；`CURATED_EVIDENCE` 逐条 `{file,title}`；§6.2 全部 resolved、stale 0 | **已关闭** |
| W10R1-05 P2 演练来源被覆盖 | 读 `acceptance-results.json` 与报告 §6.6 | AC-001 保留两条来源（`pnpm test:e2e:UNVERIFIED` + `pnpm test:live:PASS`），AC-010 同时列出 e2e PASS 与 live PASS | **已关闭** |
| W10R1-06 P2 记录无 HEAD 绑定 | `computeBinding` + `verifyBinding` | 机制关闭（报告必须携带 binding 且三字段一致，`probe-drills.mjs` 四情景全部按预期接纳/拒绝）；记录 `gitHead` 仍为父提交（W10R3-03 残留） | **机制已关闭；记录残留 P3** |
| W10R1-07 P2 就绪门禁读旧 `acceptance.md` | `grep` + `readAcceptanceResult` 探针 | 仅消费本次运行 sidecar，且校验 `generatedAt>=startedAt`、`codeDigest`、`drillsExecuted`、`runNonce` | **已关闭** |
| W10R1-08 P2 UNVERIFIED 非阻断、口径掩盖 | 真实 `--release`（`/tmp/wp10r3/C-release.log`） | `READY (ACCEPTED RISK 8)`，report §2/§3 列出 8 条豁免并明写「本结论不声称它们已被验证」；未折成裸 READY | **已关闭** |
| W10R1-09 P3 `plan.md` 未入库 | `git cat-file -e HEAD:.agentdev/work/WP-10/plan.md` | 成功；`git ls-files` 含 `plan.md` | **已关闭** |
| W10R1-10 P3 `DRILL_ACS` 漂移 | `drill-acs.mjs` 被 e2e/live/聚合器/报告共同 import | AC-007/010/037/041 的缺口出现在汇总 ACCEPTED 表 | **已关闭** |
| W10R1-11 P3 空证据仍 PASS | `e2e-checks.mjs:80-86`、`acceptance-registry.mjs:587-591`、`unverified()` 空原因即抛错 | 空证据 → FAIL；空 evidence 的 drill 行被拒绝 | **已关闭** |
| W10R1-12 P3 注释与实现矛盾 | 读 `live-report.mjs`、`e2e-checks.mjs`、`acceptance-evidence.mjs`、`acceptance-binding.mjs` 头注释 | 均已改写为「最弱一环 + 只采用本次运行证据」 | **已关闭** |

### 3.2 第 2 轮（7 条）

| id | 复现 | 现在观测 | 结论 |
|---|---|---|---|
| W10R2-01 P1 AC-066 不可证却 PASS | `node -e` 读 sidecar + `probe-gap3.mjs`（7 条真实 curated 用例全 PASS + 伪造 `pnpm test:live` PASS） | edgecar：`AC-066 status=UNVERIFIED accepted=true residual=WP-10-D4/AC-066`；探针：即使注入 live PASS，`verdict=UNVERIFIED gapClosed=false`（无 `closedBy`）；映射记为 `curated` 且 7 条全解析 | **已关闭** |
| W10R2-02 P1 零用例/退出码不闭合 | Z1/Z2 探针 + `indexTestCases`/`acceptance.mjs:245-253` | 零用例文件不入 `byFile` → `diagnostics.unexecuted` → exit 2；项目 `exit!=0` 即使有 JSON 报告也 `infraFailure` → 输出 `project "unit" exited 1 although it produced a JSON report` 且 `Z1_EXIT=2` | **已关闭** |
| W10R2-03 P2 sidecar 可被顶替 | `/tmp/wp10r3/probe-release-gate.mjs`（植入未来时间戳 + 当前 digest + `drillsExecuted:true`） | 攻击者 nonce → `available=false … runNonce 与本次发布演练不一致`；正确 nonce + 错 digest → 拒绝；正确 nonce + `drillsExecuted:false` → 拒绝；旧 `generatedAt` → 拒绝。门禁先由 nonce 拒之 | **已关闭** |
| W10R2-04 P2 映射噪声/覆盖不足 | 读改名后测试体；sidecar 逐 AC evidence | AC-055 幂等套件由 AC-054 改标 AC-055（与「幂等接受」一致）；2 条 workbench `订阅扩大` 由 AC-054 改标 AC-078（与既有 `protocol.integration.test.ts`「cross-project subscription refused (AC-078)」及 `client/subscriptions.test.ts (AC-078)` 归属一致，二者均断言拒绝，命中 AC-078 的「拒绝」子句）；AC-068 标题改为与其断言一致（拒绝无法记录的取消）；AC-094 新增 5 条 recordHash/半对/摘要 curated | **已处置（AC-090 转为 recorded-gap，见 D4）** |
| W10R2-05 P3 记录 `gitHead` 停留父提交 | 读三条记录 | 仍为 `c53b28d…`（未变），`codeDigest` 与冻结树一致；T6 以「记录携带 codeDigest」明示口径，门禁不消费记录 | **未完全关闭（P3 残留，W10R3-03）** |
| W10R2-06 P3 curated 死条目 | `acceptance-evidence.mjs:170-198`、`acceptance-report.mjs` §6.2 | curated 对**每个**登记 AC 都解析（即使映射被 test-name 抢先）；报告 §6.2 对 AC-011/094 显示「采用映射 test-name / 全部条目已解析=是 / 过期 0」 | **已关闭** |
| W10R2-07 P3 `--no-drills` 无标注 | `probe-release-gate`（`drillsExecuted:false`）+ `Z1/Y` 运行 | 输出 `NOTE — release drills were NOT executed … not a release verdict, and the release gate refuses its sidecar`；sidecar 被 `readAcceptanceResult` 拒绝 | **已关闭** |

### 3.3 两轮复核汇总

- 第 1 轮：11 条完全关闭；W10R1-06 机制关闭、记录层残留（P3，W10R3-03）。
- 第 2 轮：6 条关闭；W10R2-05 为 P3 残留。**第 2 轮的两条 P1（W10R2-01/02）已由独立复现确认关闭。**

## 4. 本轮新检查

### 4.1 Gap 机制（`closedBy` 的精确性）

用真实 `aggregateAcceptance` + 真实 `RESIDUAL_GAPS`/`conditionHolds` 的探针（`/tmp/wp10r3/probe-gap.mjs`、`probe-gap3.mjs`）：

```
RESIDUAL_GAPS 13 个 key；closedBy：AC-001/007/010/037/041/043='pnpm test:live'；AC-066/090/002/052/071/073/076 无 closedBy
AC-001 + pnpm test:e2e PASS only        -> UNVERIFIED   （e2e 不能关闭 Provider 缺口）
AC-001 + pnpm test:live PASS            -> PASS         （唯一指定演练可关闭）
AC-001 + e2e UNVERIFIED + live PASS     -> PASS         （离线 UNVERIFIED 不再下拉已关闭缺口）
AC-001 套件 FAIL + live PASS            -> FAIL         （closedBy 不能掩盖套件 FAIL）
AC-066（7 条 curated 全 PASS）+ 伪造 live PASS -> UNVERIFIED gapClosed=false （无 closedBy 永不关闭）
AC-066 套件 FAIL                        -> FAIL
AC-090/AC-002 + 任意 PASS               -> UNVERIFIED gapClosed=false
provider-absent  no env  -> holds=true ； full env -> holds=false
review-model-absent no env -> true ； 有 REVIEW_MODEL -> false
browser-absent / recorded-gap -> 恒 true
```

### 4.2 真实 Provider 纵向演练（D5）

- 独立 `node scripts/live.mjs --drill-out /tmp/wp10r3/live-standalone.json`：**exit 0**；`4 passed / 0 failed / 2 unverified; 11 call(s), HTTP 200×11, 59129ms total, 0 failed`。`provider.connectivity` PASS；`drill.html-explanation`（AC-001）PASS；`drill.l1-typo`（AC-007）PASS；`drill.l2-delivery`（AC-010/037/041）PASS；`browser.html-rendering`（AC-002/052）UNVERIFIED；`provider.independent-models`（AC-043）UNVERIFIED。报告 `binding` 三字段与冻结树一致，`nonce` 为空（独立运行非聚合子进程）。
- 诚实性：真实栈（临时 Git + 真实 SQLite + 真实 `createDaemon` + 真实 BFF，回环端口 0）；真实模型调用（11×HTTP 200）；无 secret（精确值与 `sk-` 前缀在 stdout/stderr/drill JSON 均 0 命中）；L1 证据含真实 diff/numstat、CAS 移动、CompletionManifest 冻结；L2 证据含真实候选树、四个独立 Run 与各自冻结快照、真实执行探针 exit 0、真实结算与知识冷启动；`live-drills.mjs:945-946, 984-988, 1082-1084` 把**冻结的真实文件内容**发给 Review/Test prompt（正是 T6 第 3 项修复），测试探针真实 import 冻结候选并校验未付款/已付款/未知三条路径（`:1041-1063`）。
- 未配置 Provider 时：A 运行中 `drill.html-explanation [AC-001] UNVERIFIED: real Provider not configured (set AGENTDEV_PROVIDER_BASE_URL, AGENTDEV_PROVIDER_MODEL, AGENTDEV_PROVIDER_SECRET)`；由 `NODE_OPTIONS=--require netprobe` 包装的真实运行中，`netevents.log` 对 `deepseek` 检索 **0 命中**，仅有回环地址与测试夹具 `rebind.example`。

### 4.3 发布聚合与就绪门禁

- 无 Provider（A，含伪造记录）：`94/94 — PASS 81 / ACCEPTED 13 / FAIL 0 / MISSING 0`，**exit 0**；13 条 ACCEPTED 逐条列出，AC-001 的理由点名缺失 `AGENTDEV_PROVIDER_*`。
- 有 Provider（B，`pnpm test:acceptance`）：`94/94 — PASS 86 / ACCEPTED 8 / FAIL 0 / MISSING 0`，**exit 0**。
- 有 Provider（C，`node scripts/live.mjs --release`）：十条命令 **10/10 exit 0**（install/typecheck/lint/unit/integration/e2e/acceptance/live/docs:check/build），`pnpm doctor` exit 0，结论 **`READY (ACCEPTED RISK 8)`**；§2 逐一列出 8 条豁免（AC-002/043/052/066/071/073/076/090）的残余编号、未执行部分与决定记录，§3 明写「不声称它们已被验证」。
- 条件失效路径：Provider 已配置但 `--no-drills`（Y）→ `AC-001 UNVERIFIED — 豁免条件不再成立（provider-absent）：AGENTDEV_PROVIDER_* 已配置…`，门禁非 0。

### 4.4 本轮产品改动（`packages/core/src/model-gateway.ts`）

- `complete()` 现传 `maxOutputTokens: frozen.model.maxOutputTokens`（原 `min(4096, …)`）；`testConnection()` 现用 `Math.min(64, model.maxOutputTokens)`（原 1）。
- 覆盖：`packages/core/test/model-gateway.test.ts:210-225` 两条新测试——「forwards the configured output budget instead of a hard-coded 4096 cap」断言 `transport.requests.at(-1).maxOutputTokens === 8_000`（若仍是 `min(4096,…)` 必失败）；「gives the connectivity probe a budget a reasoning model can answer within」断言 `>1 且 <=64`。`pnpm test:unit` 55 文件 / **1107** 用例全通过。
- 其它调用点：`grep -rn "4096"` 仅剩 `model-gateway.ts:200` 的 `contextLimit: Math.min(4096, model.contextWindow)`（探针**上下文**上限，非输出上限，合理）与 context/ledger 的文档常量；无其它输出预算仍假设 4096。
- 改名诚实性：`packages/client/test/commands.test.ts` 的 `AC-054 reconnect and bounded backoff` 仍是断连/退避（AC-054 定义），幂等重试套件改为 `AC-055`（AC-055 定义「相同键重发」）；`apps/web/test/workbench-failures.integration.test.ts` 两条「订阅扩大拒绝」由 AC-054 改为 AC-078，与仓库既有 AC-078 订阅拒绝用例一致且断言确为拒绝；`apps/daemon/test/protocol.integration.test.ts` 的 AC-068 标题改为「refuses to cancel … it cannot record」，与其 `expectRefusal(..., 'INVALID_STATE')` 断言一致。

### 4.5 AC 计账与映射质量

独立解析（不经 runner）：`### AC-NNN` 标题 **94 个、0 重复、恰为 AC-001…AC-094**，每条含 `关联：REQ-*`/Given/When/Then/证据。sidecar `results` 94 条、id 集合与目录完全一致；`PASS 86 / ACCEPTED 8`；`PASS 且 accepted=true` 为空；8 个 ACCEPTED 恰为 `AC-002,AC-043,AC-052,AC-066,AC-071,AC-073,AC-076,AC-090`（与消息给定集合一致）。`RESIDUAL_GAPS` 13 条，`provider-absent`×5、`review-model-absent`×1、`browser-absent`×5、`recorded-gap`×2（各带 residual 与决定记录）。

抽样（≥12，含全部 11 个登记 curated 与多个 PASS）逐条打开或经 runner 逐用例解析确认：

| AC | 映射 | 证据 | 结论 |
|---|---|---|---|
| AC-004 | curated | `domain.test.ts:168`、`server.test.ts` | 真证据 |
| AC-011 | curated+test-name | `delivery.integration.test.ts:1218`（L3 缺 rollback/audit/drill 即拒）、`migrations.integration.test.ts`、`backup.integration.test.ts` | 真证据 |
| AC-026 | curated | `scan.test.ts:266`（40 文件 + partial/unknowns）、`:286`（512 KiB）、`:618`（扫描不建文件） | 真证据 |
| AC-027/028 | curated | `initialize.test.ts` | 真证据 |
| AC-065 | curated | `migrations.integration.test.ts` 6 条 | 真证据 |
| AC-066 | curated（7 条）| `session/events` 适配用例；真实模型流式/恢复登记为缺口 | 真证据 + 已登记缺口（UNVERIFIED/ACCEPTED） |
| AC-067 | curated | `extensions.test.ts`、`attempt.integration.test.ts` | 真证据 |
| AC-086 | curated | `feature-format.test.ts` 7 条 | 真证据 |
| AC-092 | curated | `requirements-pool.test.ts` 7 条（幂等/逐条冲突/stale 拒覆盖/修复后 import 解除冲突） | 真证据 |
| AC-094 | curated+test-name | `requirement-save.integration.test.ts`（recordHash/半对）、`requirement-save.test.ts`（组合 hash/摘要）、`cas.integration.test.ts` | 真证据 |
| AC-054 | test-name | `commands.test.ts:95-176`（退避 1s/2s/4s、hello 重放）、`protocol.integration.test.ts`（水位重放/后台继续） | 真证据 |
| AC-055 | test-name | `commands.test.ts:179+`（同键同载荷重放、同键异载荷冲突）、`dispatcher/ledger` | 真证据 |
| AC-068 | test-name | `pages/views`（Queued 直接取消、暂停拒绝）、e2e `board.rules` | 真证据 |
| AC-078 | test-name | `server.test.ts`/`server.integration.test.ts`/`protocol.integration.test.ts` + e2e `stack.boot` | 真证据 |
| AC-090 | test-name + recorded-gap | Git/投影/`unpushed` 由真实仓库与 e2e 证明；界面「分支/提交/未推送」未实现 → **UNVERIFIED/ACCEPTED**（不计 PASS） | 归入已登记缺口 |
| AC-093 | test-name | `requirement-save`/`context-builder` 等 21 条 | 真证据 |
| AC-001 | none + 演练 | 仅由 `pnpm test:live` 关闭；参见 W10R3-04 的粒度观察 | 设计如此 |

**未发现**任何「PASS 且某 Then 子句既未实现又未断言且未登记」的 AC。

### 4.6 Fail-closed 端到端

| 性质 | 复现 | 观测 |
|---|---|---|
| 未登记/条件失效 UNVERIFIED → FAIL | Y（Provider 配置 + `--no-drills`） | `AC-001/007/010/037/041 UNVERIFIED — 豁免条件不再成立`，非 0 |
| 未执行映射文件 → 非 0 | Z2 | `含 AC 证据的测试文件没有执行任何用例：…zz-probe-collection.test.ts`，exit 2 |
| 零用例映射文件（真实 Vitest） | Z2 | 同上报错（`indexTestCases` 不再登记零用例文件） |
| Vitest 非 0 退出（有 JSON 报告） | Z1 | `project "unit" exited 1 although it produced a JSON report`，exit 2 |
| 未映射失败用例 → 非 0 | Z1 | `失败用例未映射到任何 AC：…`，exit 2 |
| 缺失映射文件整体消失 | A（无 Provider，integration 正常执行） | §6.3「无」；若消失则 `unexecuted` → exit 2 |
| binding 不符 → 非 0 | `probe-drills.mjs` | 缺 binding / codeDigest 错 / gitHead·gitTree 错 → 报告被拒、problems 非空 |
| nonce 不符 → 非 0 | `probe-drills.mjs` | 错误 nonce → 两条演练报告均被拒 |
| 伪造 sidecar（未来时间戳+正确 digest+drillsExecuted）→ 拒绝 | `probe-release-gate.mjs` | 攻击者 nonce → `available=false`；旧时间戳/错 digest/`drillsExecuted:false` 亦各自拒绝 |
| 仓库内演练记录不作为证据 | `grep`（仅写不读）+ A 的伪造实验 | 伪造 `live-results.json` 后聚合不变；唯一仓库读是 nonce 校验的 sidecar |

### 4.7 契约命令与卫生

全部在仓库根、`export PATH="$HOME/.local/bin:$PATH"` 下真实执行（原始日志 `/tmp/wp10r3/contracts/*.log`）：

| 命令 | 退出码 | 观测 |
|---|---|---|
| `pnpm install --frozen-lockfile` | 0 | `Lockfile is up to date` |
| `pnpm typecheck` | 0 | `tsc -p tsconfig.json --pretty false` 无错误 |
| `pnpm lint` | 0 | Prettier 全绿 + ESLint |
| `pnpm test:unit` | 0 | `Test Files 55 passed (55)` / `Tests 1107 passed (1107)` |
| `pnpm test:integration -- --maxWorkers=4` | 0 | `26 passed (26)` / `311 passed (311)`；Docker 真实执行（`runs a container read through Docker and reports the real non-root account 23681ms`、`keeps the frozen source read-only inside the real container (AC-048, AC-050) 11112ms`） |
| `pnpm test:e2e` | 0 | 20 检查 — PASS 16 / FAIL 0 / UNVERIFIED 4；23 AC（committed `e2e-results.json`: 17 PASS / 6 UNVERIFIED） |
| `pnpm test:acceptance` | 0 | `94/94 — PASS 86 / ACCEPTED 8 / FAIL 0 / MISSING 0` |
| `pnpm test:live` | 0 | 三条纵向路径全 PASS，11×HTTP 200 |
| `pnpm docs:check` | 0 | `15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages` |
| `pnpm build` | 0 | `build: Done` × **12** |
| `pnpm doctor` | 0 | `All checks passed` |

卫生：运行后 `git status --porcelain` 为空；无 `agentdev-*` 残留临时目录（`/tmp/agentdev-probe.mjs` 为 19:55 既存 reviewer 脚手架，非本轮产物且未被仓库引用）；无新增 node 监听端口（仅既有 3080 与本机服务）；secret 全仓/全证据目录 0 命中。**唯一读仓库记录的是 nonce 校验的 `acceptance-results.json`。**

## 5. 新发现清单

### W10R3-01（P2）`implementation.md` §T1/§T4 的数字与冻结运行不一致（unit 少报 2 个用例、验收汇总停留无 Provider 的 83/11）

- 证据（复现）：
  ```bash
  grep -n "1105\|PASS 83\|ACCEPTED 的 11" .agentdev/work/WP-10/implementation.md
  #  7: … Review 第 1 轮修复后结果（未配置 Provider）：94/94 — PASS 83 / ACCEPTED 11 …
  # 23: - 本轮结果：unit 55 文件 / 1105 用例 …
  # 25: ### ACCEPTED 的 11 个 AC（缺口均已登记、条件均成立）
  # 53: | pnpm test:unit | 0（55 文件 / 1105 用例） |
  # 56: | pnpm test:acceptance | 0（94/94；PASS 83 / ACCEPTED 11 / FAIL 0 / MISSING 0） |
  pnpm test:unit 2>&1 | tail -2      # Test Files 55 passed (55) / Tests 1107 passed (1107)
  node scripts/acceptance.mjs --no-write   # 94/94 — PASS 86 / ACCEPTED 8 / FAIL 0 / MISSING 0
  ```
- 观测：冻结提交给 `packages/core/test/model-gateway.test.ts` 新增 2 条测试，真实 unit 为 **1107**；`release.md` §1 与 `acceptance.md` §0（「已执行提交用例 1418 = 1107 + 311」）都是 1107；`implementation.md` §T1/§T4 仍写 1105，且 §T4 的验收行仍是 83/11（无 Provider 快照），与冻结树的真实 86/8 冲突。行 8 与 §T6 记录了正确的 86/8，但 §T1「ACCEPTED 的 11 个 AC」表仍列出已被真实 Provider 关闭的 AC-001/007/010/037/041。
- 影响：WP 实现记录自相矛盾；以 §T4 为「契约命令结果」阅读会得到错误计数（本轮任务书本身即引用了 1105/11）。不改变门禁或产品结论。
- 修复建议：用冻结运行重写 §T1/§T4 的计数与 ACCEPTED 表（1107；86/8），或明确标注 §T1/§T4 为 D5 之前的历史快照。

### W10R3-02（P3）`scripts/lib/live-transport.mjs` 注释仍描述旧的 4096 默认与 1-token 探针

- 证据：
  ```bash
  sed -n '37p;109p;171,174p' scripts/lib/live-transport.mjs
  #  37: /** Declared per-call output cap; the drill defaults to 4096. */
  # 109:     maxOutputTokens: envInt(env, PROVIDER_OPTIONAL_ENV.maxOutputTokens, 16_000),
  # 171-174: … the Gateway's `provider.test` probe asks for (`maxOutputTokens: 1`) …
  sed -n '199p' packages/core/src/model-gateway.ts
  # 199:       maxOutputTokens: Math.min(64, model.maxOutputTokens),
  ```
- 影响：仅文档/注释误导；实际默认 16000、探针 64，行为正确。
- 修复建议：把两处注释改为 16000 与 `min(64, maxOutputTokens)`。

### W10R3-03（P3）已提交记录的 `gitHead` 仍停留父提交 `c53b28d`（W10R2-05 残留，未完全关闭）

- 证据：`node -e` 读三条记录 → `gitHead c53b28dd5c97a3f106d467c518ea2e179e8f7dca`（≠ `239b9ef`），而 `codeDigest` = 冻结树 `e4f7a505…`；`release.md` §0 同为 `c53b28d`。
- 影响：门禁只消费本次运行 sidecar 并校验 `codeDigest`，**不影响判定**；但把记录当「冻结版证据」阅读时，`gitHead` 指向的提交并不包含这批记录（内容哈希才是权威）。T6 已用「记录携带 codeDigest」明示该口径，故为文档层残留。
- 修复建议：在冻结提交后重跑并提交记录，或让记录显式标注 `gitHeadAtGeneration` 与「内容以 codeDigest 为准」。

### W10R3-04（P3）AC-001 `mapping=none`，其 PASS 完全由 live 演练关闭，且演练自身声明未产生「读取记录」子句

- 证据：
  ```bash
  grep -rn "AC-001" packages apps --include=*.test.ts        # 0 命中
  node -e '…sidecar…AC-001'   # status PASS, mapping none, evidence 0, drills=[e2e UNVERIFIED, live PASS]
  ```
  `live.md` §3 末条自述：「AC-001 的'读取记录'未由本演练产生：演练直接把真实 Git 内容作为 Chief 选择来源注入 prompt，没有经过 ContextBuilder/read ledger（那由 WP-05 的提交测试覆盖）」；而 read ledger 由 AC-032/AC-036 的提交用例覆盖，并非 AC-001。
- 影响：AC-001 的 Then（「Chief按需调查并区分事实/未知，Work完成且无Requirement」）中，`区分事实/未知` 与 `Work完成且无Requirement` 由 live 真实模型断言；`按需调查（读取记录/read ledger）` 未被 AC-001 的任一映射证据执行。该缺口在 `live.md` 中**已披露**（非隐瞒），且底层机制由 AC-032/AC-036 覆盖，故不构成不可证的完成声明；仅记录粒度不足。
- 修复建议（可选）：把 WP-05 的 read-ledger 用例以 `curated` 登记到 AC-001，或在 AC-001 的登记缺口文字中显式声明「读取记录由 AC-032/AC-036 覆盖，本 AC 只验证模型侧」。

## 6. 未验证/无法验证项

- **真实浏览器（像素/焦点/ARIA/脚本隔离攻击样例）**：按 D1 不引入浏览器，无法执行；只验证了离线断言、服务端 CSP/sandbox/一次性下载与登记（AC-002/052/071/073/076 = ACCEPTED，非 PASS）。
- **真实 Pi SDK 模型轮次（流式增量与会话历史恢复）**：按 D4 登记为 `recorded-gap`（残余 `WP-10-D4/AC-066`），未执行；只验证了锁定 SDK 的适配用例与登记。
- **Web 界面渲染分支/提交/未推送状态**：按 D4 登记为 `recorded-gap`（残余 `WP-10-D4/AC-090`），`apps/web/src` 无对应视图字段，未实现。
- **AC-043 的独立 Review/Test 模型**：环境只提供一个模型（`AGENTDEV_PROVIDER_REVIEW_MODEL` 未配置），登记为 `review-model-absent`；无法验证「不同模型」前提（演练已证明专业 Run 独立且各自冻结快照）。
- **CAS journal 崩溃/恢复注入**：e2e/live 使用内存实现，不在本切片，未验证。
- **`docs/rules/*`、`AGENTS.md`、`docs/INDEX.md` 与本包的全量一致性**：按需查阅，未做全量交叉审计（非本轮判定对象）。
- **工作区冻结后是否又发生漂移**：本轮开始时、A/B/C 运行后与 run2 之后均为干净树；未观察到第三方写者。
- **真实 Provider 的可用性波动**：本轮 3 次真实演练均成功（独立 live、B、C）；单次成功不构成对 Provider SLA 的证明。

## 7. 独立复算的命令输出

原始日志：`/tmp/wp10r3/{contracts/*.log, live-standalone.{log,json}, A-noprovider.log, B-acceptance.log, C-release.log, Z1-unmapped.log, Z2-zerocase.log, Y-condition.log, netevents.log}`；探针：`{probe-gap.mjs,probe-gap2.mjs,probe-gap3.mjs,probe-release-gate.mjs,probe-drills.mjs,netprobe.cjs}`；脚本：`{run.sh,run2.sh}`；汇总：`{ac-accounting.out,probe-*.out}`。

```text
$ git rev-parse HEAD; git rev-parse HEAD^{tree}; git status --porcelain
239b9ef7b69582e3f3797c5f9d9dde18d7187e7f
ac348447ad67855434eda4450b025402f71a9dd5
                                              # 空（干净）

$ node -e 'import("./scripts/lib/acceptance-binding.mjs")…'
{ gitHead:"239b9ef…", gitTree:"ac348447…",
  codeDigest:"sha256:e4f7a5054a89ab6d150fe13783042c9a0655195f45c8f8653f07e58e8e4eb2d4",
  codeFiles:252, dirty:false }
record(acceptance-results.json) codeDigest match: true ；gitHead: c53b28d… (≠ HEAD)

$ bash /tmp/wp10r3/contracts.sh
install 0 | typecheck 0 | lint 0 | unit 0 (55 files / 1107 tests) | integration 0 (26/311, Docker real)
docs:check 0 | build 0 (12 × "build: Done") | doctor 0 (All checks passed)
integration: ✓ runs a container read through Docker and reports the real non-root account 23681ms
             ✓ keeps the frozen source read-only inside the real container (AC-048, AC-050) 11112ms

$ AGENTDEV_PROVIDER_* node scripts/live.mjs --drill-out /tmp/wp10r3/live-standalone.json     # EXIT=0
PASS provider.connectivity   [-] provider.test completed in 1046ms against https://api.deepseek.com with model deepseek-flash
PASS drill.html-explanation  [AC-001] … citing src/orders/cancel.ts and separating UNKNOWN; preview 200 CSP "default-src 'none'" …
PASS drill.l1-typo           [AC-007] … CompletionManifest … CAS moved agentdev/main … L1 chain ["Develop","Review","Settlement"]
PASS drill.l2-delivery       [AC-010,AC-037,AC-041] … candidate … 4 distinct config snapshots … executed probe exit 0; cold start …
UNVERIFIED browser.html-rendering      [AC-002,AC-052]
UNVERIFIED provider.independent-models [AC-043]
live: 4 passed / 0 failed / 2 unverified; 11 call(s), HTTP 200×11, 59129ms total, 0 failed
secret scan (exact value & sk- prefix) in stdout/stderr/JSON: 0 命中

$ bash /tmp/wp10r3/run.sh        # A: 伪造记录 + 无 Provider；B: 有 Provider；C: --release
A: forged live-results.json AC-001 -> PASS ; A_EXIT=0
   AC-001 UNVERIFIED*  none  — accepted gap          # 伪造未被采纳
   "FORGED round3" in output: 0
   acceptance: 94/94 ACs accounted — PASS 81 / ACCEPTED 13 / FAIL 0 / MISSING 0
   netevents: deepseek 命中 0（仅回环 + rebind.example 夹具）
B: B_EXIT=0
   acceptance: 94/94 ACs accounted — PASS 86 / ACCEPTED 8 / FAIL 0 / MISSING 0
C: C_EXIT=0
   release: 10/10 exit 0；READY (ACCEPTED RISK 8) — commands 10/10 ok; AC PASS 86 / ACCEPTED 8 / FAIL 0 / MISSING 0
secret scan over /tmp/wp10r3 and the repo tree: 0 命中

$ node /tmp/wp10r3/probe-gap3.mjs
AC-066 entries=7 status=passed -> verdict=UNVERIFIED gapClosed=false evidence=7 stale=0
AC-066 entries=7 status=failed -> verdict=FAIL
AC-001 failing test + live PASS -> status=FAIL gapClosed=true

$ node /tmp/wp10r3/probe-release-gate.mjs
future ts + current digest + drillsExecuted=true + attacker nonce -> available=false (runNonce 不一致)
stale generatedAt                                          -> available=false (拒绝旧结果)
wrong codeDigest                                           -> available=false
drillsExecuted=false                                       -> available=false (--no-drills)

$ node /tmp/wp10r3/probe-drills.mjs
correct nonce + correct binding -> adopted (AC-001: e2e/PASS, live/PASS; problems 0)
correct nonce + binding MISSING -> rejected (2 problems)
correct nonce + wrong codeDigest -> rejected (2 problems)
WRONG nonce + correct binding    -> rejected (2 problems)

$ bash /tmp/wp10r3/run2.sh
Z1 (unmapped failing test)      -> Z1_EXIT=2；project "unit" exited 1 although it produced a JSON report；
                                  失败用例未映射到任何 AC：…zz-probe-unmapped.test.ts
Z2 (collected, zero cases, AC-090) -> Z2_EXIT=2；含 AC 证据的测试文件没有执行任何用例：…zz-probe-collection.test.ts
Y  (Provider set + --no-drills) -> Y_EXIT=2；AC-001/007/010/037/041 UNVERIFIED — 豁免条件不再成立（provider-absent）
                                   NOTE — release drills were NOT executed … not a release verdict …

$ node -e '…独立 AC 计账…'   # /tmp/wp10r3/ac-accounting.out
headings 94 / duplicates 0 / exact AC-001..AC-094 true / 缺条款 0
sidecar 94 / 集合一致 true ；ACCEPTED = AC-002,AC-043,AC-052,AC-066,AC-071,AC-073,AC-076,AC-090（= 消息给定 8 个）
PASS 86 / ACCEPTED 8 ；PASS∩accepted = 空；AC-066/090 residual=WP-10-D4/… accepted=true status=UNVERIFIED

# 还原：本 Review 重写的记录文件
$ git checkout -- .agentdev/work/WP-10/{acceptance.md,acceptance-results.json,e2e.md,e2e-results.json,live.md,live-results.json,release.md}
$ git status --porcelain      # 空（最终）
```
