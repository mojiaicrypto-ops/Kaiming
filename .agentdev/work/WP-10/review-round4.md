# WP-10（发布整体验收）独立 Review 报告（第 4 轮 · 增量）

- 角色：INDEPENDENT REVIEW（独立上下文；未读取任何开发/Test 聊天、transcript 或会话日志；仅使用仓库文件、git 对象、前三轮报告与本轮自行运行的实验）
- 工作包：WP-10 发布整体验收（第 4 轮 · 增量）。对象为第 3 轮 PASS（`239b9ef`）之后落地的两个提交 `9917d34`、`9f154c3`，并复核发布门禁在最终树上仍然成立
- 冻结点：`9f154c3`（`fix(release): give the L1 reviewer the frozen content it must judge`；tree `ed48e2d61ad577cc405fe71308b81013c59fbf02`）。本轮全部判定针对该提交的**干净工作区**（初始与最终 `git status --porcelain` 均为空）
- 证据目录：`/tmp/wp10r4/`（Reviewer 自建探针、HTTP 抓包、日志与原始输出）
- 唯一写入：本文件（`.agentdev/work/WP-10/review-round4.md`）。`pnpm test:e2e`、`pnpm test:live`、`pnpm test:acceptance`、`node scripts/live.mjs --release` 会重写 `.agentdev/work/WP-10/{acceptance.md,acceptance-results.json,e2e.md,e2e-results.json,live.md,live-results.json,release.md}`；伪造/失效实验另外短暂改写 `live-results.json`、`scripts/lib/acceptance-registry.mjs`、`scripts/lib/drill-acs.mjs` 与一个临时测试文件，全部已在实验后还原/删除（脚本 `trap` 兜底），最终 `git status --porcelain` 为空
- 环境：macOS / Node v24.8.0 / pnpm 12.3.4 / Docker 可用（integration 容器用例真实执行）
- 凭证：`AGENTDEV_PROVIDER_BASE_URL/MODEL/SECRET` 仅经进程环境传入，未写入任何文件、未回显。全仓库 + 全 `/tmp/wp10r4` 对 secret 精确值检索 **0 命中**（`sk-` 形状命中仅历史评审/测试里的假诱饵字符串）

## 1. 冻结与哈希

| 项 | 值 |
|---|---|
| `git rev-parse HEAD` | `9f154c3cc83e3f78bb5bb4c72bbecbad3343ed47` |
| `git rev-parse HEAD^{tree}` | `ed48e2d61ad577cc405fe71308b81013c59fbf02` |
| `git status --porcelain`（初始 / 最终） | 空 / 空 |
| 冻结树内容绑定 `codeDigest`（本轮独立重算，干净树） | `sha256:8ca1e58c0ceb7aef70644dcdcc65b13bab456311471ba100c87ff456517ca4e6`（252 个代码文件） |
| 已提交 `acceptance-results.json` / `e2e-results.json` / `live-results.json` 的 `codeDigest` | **与上值完全一致**（三条记录确实对应冻结代码内容） |
| 已提交记录的 `gitHead` | `9917d34cacb910203c59877e2de03ad8690236a4`（= 直接父提交，≠ 冻结 HEAD），`binding.dirty: true` |
| `pnpm test:live` 独立运行（run1，记录文件被运行时改动、代码未改）的 `codeDigest` | `sha256:8ca1e58c…`（= 冻结树；`dirty:true` 只由记录文件造成，验证绑定以代码内容为准） |
| `plan.md` | 已入库，D1/D2/D4/D5 决定记录齐全 |

受审增量文件（`git diff --numstat 239b9ef..HEAD`）：

| 文件 | +/− | 性质 |
|---|---|---|
| `scripts/lib/live-drills.mjs` | +10 / −1 | L1 Review 提示词与有界重试（唯一行为变更） |
| `scripts/lib/live-transport.mjs` | 5 / 5 | **仅注释**（默认输出预算、探针预算） |
| `.agentdev/work/WP-10/{acceptance.md,acceptance-results.json,e2e.md,e2e-results.json,live.md,live-results.json,release.md,implementation.md,review-round3.md}` | 记录 | 真实发布运行重生成 + 第 3 轮报告入库 |
| `docs/` | 0 | `git diff --stat 239b9ef..HEAD -- docs/` 为空 |

## 2. 结论

**PASS** —— 针对冻结提交 `9f154c3`：`239b9ef..HEAD` 的增量**真实、诚实且没有削弱任何测试/预算/权限/门禁语义**；L1 修复被我**独立抓包证实**（真实 HTTP 请求体里确实带着冻结文件字节与明确判据），三次真实 Provider 演练里 L1 Review 均**首次即通过**、11 次调用全部 HTTP 200、从未触发重试。记录中的数字在最终树上**逐条复现**（unit 55/1107、integration 26/311、e2e 20 检查、acceptance 94/94 → PASS 86 / ACCEPTED 8 / FAIL 0 / MISSING 0、`--release` 10/10 → `READY (ACCEPTED RISK 8)`）。门禁的 fail-closed 性质由本轮 5 组独立复现再次确认（伪造记录、非本次 nonce 的 sidecar、零用例映射文件、过期 curated 映射、未登记/条件失效的 UNVERIFIED 全部非 0/FAIL）。**未发现 P0/P1/P2**；新发现 2 条均为 P3。

### 计数与阻断

| 严重度 | 数量 | 是否阻断 |
|---|---|---|
| P0 | 0 | — |
| P1 | 0 | — |
| P2 | 0 | — |
| P3 | 2（W10R4-01、W10R4-02；另有 1 条第 3 轮 P3 残余已获缓解） | 不阻断 |

**是否阻断独立 Test：否。** 两条 P3 均为记录/宿主卫生问题，不改变任何 AC 判定、聚合结果或就绪门禁。

## 3. 增量复核（`239b9ef..9f154c3`）

### 3.1 `scripts/lib/live-drills.mjs`（唯一行为变更）

`git diff 239b9ef..HEAD -- scripts/lib/live-drills.mjs` 仅 3 个 hunk：

1. 新增 `const frozenCopy = gitShow(harness.repo, candidate, COPY_PATH);` —— 取的是**候选提交 `candidate` 里的真实字节**（不是 numstat、不是工作区文件）。
2. L1 Review 的 `callModel({...})` 新增 `validate: (text) => extractJsonObject(text) !== null`。
3. L1 Review 的 user prompt 由「numstat 摘要 + Reply with your independent verdict」改为五段：候选提交号、**逐字验收判据**（`the label reads "<TYPO_EXPECTED>" and no longer contains the misspelling, and nothing else changed`）、numstat、`src/orders/messages.ts as frozen:` 代码块（frozenCopy）、`Judge the frozen content above; reply "passed" when it satisfies the criterion.`

诚实性判定：**真实**。冻结字节直接来自 `git show <candidate>:<path>`；判据与 `TYPO_EXPECTED`（`export const unpaidCancelLabel = 'Unpaid order can be cancelled';`）一致；仍然保留 `ensure(review.status === 'passed')`，即只有模型判 `passed` 才通过。

重试语义（`scripts/lib/live-harness.mjs:636-690`）：

```js
const frozen = config.freeze(role, {});      // 一次，循环外
const run = store.runs.insert({ ... });      // 一次，循环外
let response = await gateway.complete(run, messages);
while (typeof validate === 'function' && response.ok &&
       validate(response.text) !== true && attempts < maxAttempts) {
  attempts += 1; response = await gateway.complete(run, messages);   // 同一个 run
}
```

- **同一个 Run、同一份冻结 config 快照**被重发（不是新建 Run，也没有重新冻结）；
- 触发条件只有「HTTP 成功但回复不是可解析 JSON 对象」，`validate` **不检查 `status`**：模型回 `{"status":"failed"}` 是合法 JSON，不会被重试，仍然使演练失败 → 不存在「重试到通过」的放水；
- 上限 3 次（`maxAttempts = 3`），用尽后由 `requireCompletion`/`extractJsonObject` 抛错；
- 与 L2 各步（`:798/:894/:983/:1081`）用的是同一套 `validate` 机制，L1 现在与之一致。

### 3.2 `scripts/lib/live-transport.mjs` —— 仅注释

5 处改动全部落在 `/** … */` 注释内，无代码行：默认输出预算注释 `4096` → `16 000`，探针注释 `maxOutputTokens: 1` → `min(64, model.maxOutputTokens)`。逐条对照代码：

```
scripts/lib/live-transport.mjs:109   maxOutputTokens: envInt(env, PROVIDER_OPTIONAL_ENV.maxOutputTokens, 16_000)
packages/core/src/model-gateway.ts:199  maxOutputTokens: Math.min(64, model.maxOutputTokens)
```

注释与实现一致，无行为变化。

### 3.3 增量描述的偏差（不构成缺陷）

任务书称本次增量里「L2 plan prompt 改为 compact JSON」。实际核对：`239b9ef` 的 L2 Planning 系统提示词已经是 `Reply with a single compact JSON object {"goal":…}`，与 HEAD **逐字相同**；`scripts` 的实际增量比描述**更小**（只有 L1 提示词 + `validate` + 注释）。即不存在未披露的行为改动，也无语义削弱。

### 3.4 记录与实现文档

- `implementation.md` 新增 T6 第 4 项（L1 Review 拿不到冻结内容）与 T7 表（W10R3-01..04 逐条处置），§T1/§T4 的 unit 1105→**1107**、聚合 83/11→**86/8**、ACCEPTED 表改为 8 条（含两个 `recorded-gap`）——与我本轮复现值一致。
- 记录文件由真实运行重生成；`docs/` 在增量中未改动。

## 4. 门禁与验收复核

### 4.1 契约命令（`/tmp/wp10r4/contracts/*.log`）

| 命令 | 退出码 | 观测 |
|---|---|---|
| `pnpm install --frozen-lockfile` | 0 | `Lockfile is up to date` |
| `pnpm typecheck` | 0 | 无错误 |
| `pnpm lint` | 0 | Prettier + ESLint 全绿 |
| `pnpm test:unit` | 0 | **55 files / 1107 tests**（与记录一致） |
| `pnpm test:integration -- --maxWorkers=4` | 0 | **26 files / 311 tests**；Docker 真执行（非 root 容器 17355ms、冻结源只读 9889ms） |
| `pnpm docs:check` | 0 | `15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages` |
| `pnpm build` | 0 | 12 × `build: Done` |
| `pnpm doctor` | 0 | `All checks passed` |
| `pnpm test:e2e` | 0 | 20 检查 — PASS 16 / FAIL 0 / UNVERIFIED 4；23 AC |

### 4.2 真实 Provider（D2/D5）

| 运行 | 退出码 | 观测 |
|---|---|---|
| `pnpm test:live`（第 1 次） | 0 | 4 PASS / 0 FAIL / 2 UNVERIFIED；11 call(s)，HTTP 200×11，35543ms；`drill.l1-typo` **PASS**；无 `unusable` 重试 |
| `pnpm test:live`（第 2 次） | 0 | 同上；L1 候选 `8ef43283d561` / tree `ae0358dc0c97`；无重试 |
| `node scripts/live.mjs --drill-out` + HTTP 抓包 | 0 | 4 PASS / 0 FAIL / 2 UNVERIFIED；11 call(s) 全 200；见 4.3 |
| `pnpm test:acceptance`（Provider 已配置，内含 e2e+live） | 0 | e2e exit 0（8695ms）、live exit 0（40489ms）；**94/94 — PASS 86 / ACCEPTED 8 / FAIL 0 / MISSING 0** |
| `node scripts/live.mjs --release` | 0 | 10/10 命令 exit 0（install/typecheck/lint/unit/integration/e2e/acceptance/live/docs:check/build）+ doctor 0；**`READY (ACCEPTED RISK 8)`**，§2 列出 8 条豁免并明写「不声称它们已被验证」 |

未配置 Provider 的诚实性：本轮 P1/P4 探针中 live 行均为 `UNVERIFIED`，无网络调用（`--no-drills` 时明确输出 `NOTE — release drills were NOT executed … the release gate refuses its sidecar`）。

### 4.3 L1 修复的真实性（HTTP 层独立验证）

用 `NODE_OPTIONS=--require=/tmp/wp10r4/netprobe.cjs`（仅包装 `node:https/http` 的 `request`）抓取真实请求体，共 19 条：11 条发往 `api.deepseek.com`（Chief 1 + L1 plan/backend/review/settlement 4 + L2 plan/backend/review/test/settlement 5 + `provider.test` ping 1），8 条为演练自身回环 BFF/daemon 调用。

L1 Review 请求**恰好 1 次**（若被重试会出现多次），其 user 消息原文（`/tmp/wp10r4/l1-review-prompt.txt`）：

```
The frozen candidate d10e1c5b7231328f9907a663c76b37ed3ca1788e is a one-line L1 change to src/orders/messages.ts: a misspelled user-visible label is corrected.
Acceptance criterion: the label reads "export const unpaidCancelLabel = 'Unpaid order can be cancelled';" and no longer contains the misspelling, and nothing else changed.
The numstat is:
1	1	src/orders/messages.ts
src/orders/messages.ts as frozen:
```ts
export const unpaidCancelLabel = 'Unpaid order can be cancelled';
```
Judge the frozen content above; reply "passed" when it satisfies the criterion.
```

`model: deepseek-flash`，`max_tokens: 16000`（同时印证注释修正）。结论：**L1 判据与冻结字节确实进了 prompt**；retry 只在不可用回复时使用（本轮 3 次演练均未触发）。

## 5. 新发现清单

### W10R4-01（P3）测试脚手架在 `$TMPDIR` 遗留大量 `agentdev-*` 临时目录（**先于本次增量存在**）

- 复现：
  ```bash
  T=$(node -e 'process.stdout.write(require("node:os").tmpdir())')
  ls -d "$T"/agentdev-* | wc -l          # 11968（最早 2026-09-12 15:52）
  find "$T" -maxdepth 1 -name 'agentdev-*' -newermt '2026-09-13 23:15' | wc -l   # 376（本轮我运行的 unit/integration/acceptance 产生）
  find "$T" -maxdepth 1 \( -name 'agentdev-live-*' -o -name 'agentdev-acceptance-*' -o -name 'agentdev-e2e-*' \) | wc -l   # 0
  ```
- 观测：本轮我产生的 376 个全部来自 **unit/integration 测试脚手架**（`join-project` 112 / `join-global` 112 / `gateway-store` 96 / `config-store` 48 / `worktree-scratch` 8）；WP-10 自己的演练运行器（live/acceptance/e2e）遗留 **0** 个，说明**发布路径的清理是正确的**。总量 11968、最早日期 2026-09-12，说明这是**跨会话、先于 `239b9ef..HEAD` 增量存在**的测试卫生问题（第 3 轮报告称「无 `agentdev-*` 残留」是因为只查了 `/tmp`，而 macOS 的 `os.tmpdir()` 在 `/var/folders/...`）。注意：本轮实验脚本的 `trap` 清理与仓库还原均已执行，这不是我留下的。
- 影响：宿主磁盘/`$TMPDIR` 污染与 inode 消耗；不影响任何 AC、聚合或门禁结论，故 P3。
- 修复建议（不属本包增量）：在相关测试的临时目录 helper 上注册 `afterAll`/`process.on('exit')` 清理，或统一走一个 `withTempDir` 包装。

### W10R4-02（P3）L1 演练记录未保存交给 Review 的冻结字节（或其哈希），记录本身不可复现该 prompt

- 复现：
  ```bash
  node -e 'const j=require("/tmp/wp10r4/live-capture.json");const c=j.checks.find(x=>x.name==="drill.l1-typo");
    console.log(c.evidence.match(/candidate ([0-9a-f]+)/)[1], c.evidence.match(/tree ([0-9a-f]+)/)[1], c.evidence.includes("unpaidCancelLabel"));'
  # d10e1c5b7231 ae0358dc0c97 false
  ```
- 观测：记录的 L1 证据点明了真实候选提交号、code tree 与 numstat，但**不包含**冻结文件字节，也没有其哈希；而候选提交位于演练结束后即被删除的临时 Git 仓库中，因此仅凭 `live.md`/`live-results.json` 无法重建「Reviewer 究竟看到了什么」。该 delta 的行为正确性只能靠读代码 + 我的抓包（4.3）确认，而非记录自证。
- 影响：仅为记录粒度/可审计性；不影响门禁（记录不是证据来源）与 AC 判定，故 P3。
- 修复建议：在 L1 证据串中加入冻结 blob 的 `sha256`（或直接附上 `frozenCopy` 与判据），使记录自证 prompt 内容。

### 第 3 轮残余

- **W10R3-01（P2，记录数值过期）已关闭**：`implementation.md` §T1/§T4 已改为 1107、86/8，ACCEPTED 表改为 8 条；本轮复现值一致。
- **W10R3-02（P3，transport 注释）已关闭**：见 3.2。
- **W10R3-04（P3，AC-001 读取记录子句）已在 `live.md` §3 与 `implementation.md` 披露**，且 AC-032/036 覆盖 read ledger；本轮维持「已披露、非隐瞒」。
- **W10R3-03（P3，记录 `gitHead` 停留父提交）残余但已缓解**：记录仍写 `gitHead=9917d34`，但 `binding.dirty:true` 且 `codeDigest=sha256:8ca1e58c…` 与冻结树**逐位一致**（本轮独立重算确认），T7 亦明示「以 codeDigest 为准、门禁只校验 codeDigest + nonce」。读者据此不会把它当成冻结提交的字节级证据；不再单列新发现。

## 6. 门禁不可被欺骗的独立复现

| 性质 | 复现设计 | 观测 |
|---|---|---|
| 伪造的**已提交**演练报告不改变聚合 | 把仓库 `live-results.json` 的 AC-001 改为 `PASS` + `FORGED-R4-MARKER`，无 Provider 跑 `node scripts/acceptance.mjs --no-write --no-drills --projects unit` | `AC-001 UNVERIFIED* none — accepted gap`；聚合输出中 `FORGED-R4-MARKER` **0 命中**（`/tmp/wp10r4/P1-forged.log`） |
| 仓库内演练记录**不作为证据** | `grep` 全部 `scripts/`：对 `*-results.json`/`*.md` 记录只有**写**（`live.mjs:119-120`、`e2e.mjs:217-218`、`acceptance.mjs` 写出）+ 文档注释；**唯一读**是 `live-release.mjs:189` 读 `acceptance-results.json`，且先过 nonce | 与上一条互证 |
| sidecar 绑定本次发布运行 nonce | 直接调用 `readAcceptanceResult(repo, startedAt, nonce)`（`/tmp/wp10r4/probe-nonce.mjs`） | 攻击者 nonce → `available=false`（`runNonce 与本次发布演练不一致`）；伪造未来 `generatedAt` + 攻击者 nonce → `available=false`（时间/ nonce 双拒）；空 nonce → 拒；**只有**「文件自带 nonce + `startedAt` 早于生成时间」才 `available=true`（对照） |
| 映射测试文件零用例执行 → 失败 | 临时新增 `packages/core/test/zz-wp10r4-zerocase.test.ts`（模块级抛错、提到 AC-090，收集成功零用例），`--no-write --no-drills --projects unit` | `含 AC 证据的测试文件没有执行任何用例：packages/core/test/zz-wp10r4-zerocase.test.ts`，exit **2**；临时文件已删 |
| curated 映射条目过期 → 失败 | ① 把 `CURATED_EVIDENCE` 中 AC-086 的一个标题改成不存在的字符串，真实跑 runner；② 进程内探针（`probe-stale.mjs`）给出「全部命中」与「少一条」对照 | ① AC-086 `PASS → FAIL`、exit **2**；② 对照 `status=PASS staleEntries=0`，缺一条 → `status=FAIL`，raw = `curated evidence is stale: packages/knowledge/test/feature-format.test.ts :: "…" did not execute (recorded in .agentdev/work/WP-04/test.md)` |
| 零用例文件不是证据 | `indexTestCases` 探针 | `byFile` 不含 `assertionResults: []` 的文件（`zero-case file is evidence: false`） |
| 未登记 / 条件失效的 UNVERIFIED 是 FAIL | ① 条件失效：Provider 已配置 + `--no-drills`；② 未登记：临时从 `RESIDUAL_GAPS` 删除 AC-002 后跑真实 e2e 演练 | ① AC-001/007/010/037/041 `豁免条件不再成立（provider-absent）`，exit **2**；② `AC-002 UNVERIFIED — 未登记的 UNVERIFIED：…未验证项必须有已登记的豁免与产品决定`，exit **2**（两处临时改动均已 `git checkout` 还原） |
| 八条 ACCEPTED 缺口不能被报成 PASS | 进程内 `aggregateAcceptance` + 真实 `RESIDUAL_GAPS`（`probe-aggregate.mjs`） | 对 AC-066（7 条真实 curated 全 PASS + 伪造 live PASS）、AC-090、AC-002/052/071/073/076、AC-043 注入伪造 `pnpm test:live: PASS` → 一律 `UNVERIFIED gapClosed=false`；只有 AC-001（`closedBy=pnpm test:live`）被抬到 PASS；且 AC-001 套件 FAIL + live PASS → **FAIL**（closedBy 不能掩盖套件失败） |
| AC 计账 | 独立解析 `docs/delivery/acceptance.md` + 读 sidecar | 标题 **94**、唯一、恰为 AC-001..AC-094；sidecar 94 条 id 集合完全一致；`PASS 86 / ACCEPTED 8 / FAIL 0 / MISSING 0`；ACCEPTED = `AC-002,AC-043,AC-052,AC-066,AC-071,AC-073,AC-076,AC-090`（= 任务书给定 8 个）；`PASS ∩ accepted = 空`；AC-066/090 带 `residual=WP-10-D4/…` |

## 7. 未验证项

- **真实浏览器**（AC-002/052/071/073/076）：按 D1 不引入 Playwright/浏览器下载，无法执行；这些 AC 保持 `UNVERIFIED/ACCEPTED`，未计 PASS。
- **真实 Pi SDK 模型轮次**（AC-066 流式增量与会话历史恢复）：按 D4 登记为 `recorded-gap`（残余 `WP-10-D4/AC-066`），未执行。
- **Web 界面渲染分支/提交/未推送状态**（AC-090）：按 D4 登记为 `recorded-gap`（残余 `WP-10-D4/AC-090`），`apps/web/src` 无对应字段，未实现。
- **AC-043 的独立 Review/Test 模型**：仅提供一个模型（`AGENTDEV_PROVIDER_REVIEW_MODEL` 未配置），`review-model-absent` 条件成立；多模型前提未执行。
- **CAS journal 崩溃/恢复注入**：e2e/live 使用内存实现，不在本切片。
- **`docs/rules/*`、`AGENTS.md`、`docs/INDEX.md` 的全量一致性**：按需查阅，未做全量交叉审计（非本轮判定对象）。
- **真实 Provider 的可用性波动**：本轮 4 次真实演练（live×2 + 抓包 live + release 内 live）均成功；单次/单日成功不构成 SLA 证明。

## 8. 独立复算的命令输出

原始日志/探针：`/tmp/wp10r4/{contracts/*.log, live-run1.{log,md,json}, live-run2.{log,md,json}, live-capture.{log,json}, http-capture.jsonl, l1-review-prompt.txt, P1-forged.log, P2-zerocase.log, P3-stale.log, P4-condition.log, P5-unregistered.log, B-acceptance.log, C-release.log, probe-nonce.mjs, probe-aggregate.mjs, probe-stale.mjs, netprobe.cjs, secret-scan*.out, ac-accounting.out}`

```text
$ git rev-parse HEAD; git rev-parse HEAD^{tree}; git status --porcelain
9f154c3cc83e3f78bb5bb4c72bbecbad3343ed47
ed48e2d61ad577cc405fe71308b81013c59fbf02
                                              # 空（初始与最终均干净）

$ node -e 'computeBinding(repo)'
{ gitHead:"9f154c3…", gitTree:"ed48e2d…",
  codeDigest:"sha256:8ca1e58c0ceb7aef70644dcdcc65b13bab456311471ba100c87ff456517ca4e6",
  codeFiles:252, dirty:false }
# 已提交三条记录的 codeDigest 均为 8ca1e58c…（与冻结树一致）；gitHead = 9917d34…，dirty:true

$ bash /tmp/wp10r4/contracts.sh
install 0 | typecheck 0 | lint 0 | unit 0（55 files / 1107 tests）
integration 0（26 files / 311 tests；Docker 非 root 容器 17355ms、冻结源只读 9889ms）
docs:check 0（15 docs / 55 links / 94 AC / 9 REQ / 11 WP）| build 0（12 × "build: Done"）| doctor 0（All checks passed）
e2e 0（20 checks — PASS 16 / FAIL 0 / UNVERIFIED 4；23 AC）

$ AGENTDEV_PROVIDER_* pnpm test:live        # run1 与 run2 各一次，均 EXIT=0
run1: 4 passed / 0 failed / 2 unverified; 11 call(s), HTTP 200×11, 35543ms; drill.l1-typo PASS
run2: 4 passed / 0 failed / 2 unverified; 11 call(s), HTTP 200×11, 35119ms; drill.l1-typo PASS
grep -c "unusable" live-run1.log live-run2.log   # 0 / 0 —— 重试未被触发

$ NODE_OPTIONS=--require=/tmp/wp10r4/netprobe.cjs AGENTDEV_PROVIDER_* \
    node scripts/live.mjs --drill-out /tmp/wp10r4/live-capture.json       # EXIT=0
bodies captured: 19（11 × api.deepseek.com + 8 × 127.0.0.1 演练自身）
L1 Review 请求次数: 1；model=deepseek-flash；max_tokens=16000
prompt 含: 冻结候选 d10e1c5b7231… / 判据 "Unpaid order can be cancelled" / numstat 1 1 / ```ts 冻结字节```

$ AGENTDEV_PROVIDER_* pnpm test:acceptance                                  # EXIT=0
acceptance: project "unit" exit=0 1107 tests, 0 failed
acceptance: project "integration" exit=0 311 tests, 0 failed
acceptance: pnpm test:e2e exit=0 (8695ms) | acceptance: pnpm test:live exit=0 (40489ms)
acceptance: 94/94 ACs accounted — PASS 86 / ACCEPTED 8 / FAIL 0 / MISSING 0
acceptance: OK — every AC is PASS or a registered, condition-checked accepted gap
sidecar: gitHead 9f154c3… / codeDigest 8ca1e58c… / providerConfigured true / drillsExecuted true / accepted = AC-002,043,052,066,071,073,076,090

$ AGENTDEV_PROVIDER_* node scripts/live.mjs --release                       # EXIT=0
release: pnpm install exit=0 | typecheck 0 | lint 0 | test:unit 0 | test:integration 0
         test:e2e 0 | test:acceptance 0 | test:live 0 | docs:check 0 | build 0 | doctor 0
release: READY (ACCEPTED RISK 8) — commands 10/10 ok; AC PASS 86 / ACCEPTED 8 / FAIL 0 / MISSING 0

$ node /tmp/wp10r4/probe-nonce.mjs
attacker-nonce (startedAt ancient) -> available=false（runNonce 不一致）
attacker-nonce (startedAt future)  -> available=false（早于本次发布演练开始时间）
empty-nonce                        -> available=false
file-own-nonce + startedAt ancient -> available=true（对照）

$ node /tmp/wp10r4/probe-aggregate.mjs
AC-066 + 真实 curated 全 PASS + 伪造 live PASS -> UNVERIFIED gapClosed=false
AC-090 + 伪造 live PASS -> UNVERIFIED gapClosed=false
AC-002 + 浏览器 UNVERIFIED + 伪造 live PASS -> UNVERIFIED
AC-001 + live PASS -> PASS（唯一 closedBy）；AC-001 + 仅 e2e PASS -> UNVERIFIED
AC-001 套件 FAIL + live PASS -> FAIL（closedBy 不能掩盖套件 FAIL）

$ node /tmp/wp10r4/probe-stale.mjs
AC-086 全部 curated 命中 -> PASS staleEntries=0
AC-086 少一条          -> FAIL staleEntries=1（raw: curated evidence is stale: … did not execute）
indexTestCases: 零用例文件不作为证据 = false

$ bash /tmp/wp10r4/P1-forged.sh    # 伪造已提交 live-results.json
P1_EXIT=2；AC-001 UNVERIFIED* accepted gap；"FORGED-R4-MARKER" 命中 0

$ bash /tmp/wp10r4/P2-zerocase.sh  # 零用例映射文件
P2_EXIT=2；含 AC 证据的测试文件没有执行任何用例：packages/core/test/zz-wp10r4-zerocase.test.ts

$ bash /tmp/wp10r4/P3-stale.sh / P5-unregistered.sh    # curated 过期 / 未登记 UNVERIFIED
P3_EXIT=2（AC-086 PASS→FAIL）；P5_EXIT=2（AC-002 UNVERIFIED — 未登记的 UNVERIFIED）

$ AGENTDEV_PROVIDER_* node scripts/acceptance.mjs --no-write --no-drills --projects unit
P4_EXIT=2；AC-001/007/010/037/041 UNVERIFIED — 豁免条件不再成立（provider-absent）

$ node -e '独立 AC 计账'      # /tmp/wp10r4/ac-accounting.out
headings 94 / unique 94 / exact AC-001..AC-094 true / duplicates []
sidecar 94 / 集合一致 true / counts {PASS:86,ACCEPTED:8,FAIL:0,MISSING:0}
accepted = AC-002,AC-043,AC-052,AC-066,AC-071,AC-073,AC-076,AC-090 ; PASS ∩ accepted = 空

$ node -e 'secret scan（精确值 + sk- key 形状）'
exact secret hits: 0（仓库 + /tmp/wp10r4）
key-shaped hits: 4，全部为历史评审/测试中的假诱饵（sk-WP10R*-SUPERSECRET、sk-decoy-*）

# 还原：本 Review 重写的记录文件与临时改动
$ git checkout -- .agentdev/work/WP-10/{acceptance.md,acceptance-results.json,e2e.md,e2e-results.json,live.md,live-results.json,release.md}
$ rm -f packages/core/test/zz-wp10r4-zerocase.test.ts
$ git status --porcelain      # 空（最终；仅本报告为新增文件）
```
