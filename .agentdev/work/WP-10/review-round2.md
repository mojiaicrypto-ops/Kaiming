# WP-10（发布整体验收）独立 Review 报告（第 2 轮）

- 角色：INDEPENDENT REVIEW（独立上下文；未读取任何开发/Test 聊天、transcript 或会话日志）
- 工作包：WP-10 发布整体验收（第 2 轮；复核第 1 轮 12 条发现是否由冻结提交关闭）
- 冻结点：`c53b28d`（`fix(release): make the evidence binding independent of the git index`；tree `4512743845e31503e77eb35728b28cd4a50f39f0`）。本轮所有判定均针对该提交的**干净工作区**；期间工作区被另一写者改动，见 §1.3 与 §6。
- 证据目录：`/tmp/wp10r2/`（Reviewer 自建探针、日志与原始输出；另有 scratch clone `/tmp/wp10r2/scratch`）
- 唯一写入：本文件（`.agentdev/work/WP-10/review-round2.md`）。实验期间 `pnpm test:acceptance` / `pnpm test:e2e` / `pnpm test:live` 会重写 `.agentdev/work/WP-10/{acceptance.md,acceptance-results.json,e2e.md,e2e-results.json,live.md,live-results.json}`，伪造实验另外改写 `live-results.json`；这些记录文件已在实验后 `git checkout --` 还原（见 §7 尾部）。`scripts/`、`packages/`、`apps/` 的任何改动**不是本 Review 所为**（见 §1.3）。
- 环境：macOS / Node v24.8.0 / pnpm 12.3.4 / Docker 28.4.0 可用（`docker info` exit 0）

## 1. 冻结与哈希

### 1.1 冻结点

| 项 | 值 |
|---|---|
| `git rev-parse HEAD` | `c53b28dd5c97a3f106d467c518ea2e179e8f7dca` |
| `git rev-parse HEAD^{tree}` | `4512743845e31503e77eb35728b28cd4a50f39f0` |
| `git status --porcelain`（初始） | 空（工作区干净） |
| 干净树证据绑定 `codeDigest` | `sha256:0949e14614c98d17398d1f3c8227d7cd3bc8b16971a3ceb532ebfc77ac545e5f`（252 个代码文件） |
| 三条已提交记录（`acceptance-results.json` / `e2e-results.json` / `live-results.json`）的 `codeDigest` | 与上值**完全一致**（`0949e14614c9…`） |
| 三条已提交记录的 `gitHead` | `5ad533ea02ba7e322b3a9bedea2b269a559b1f39`（父提交，≠ 冻结 HEAD） |

### 1.2 受审文件（`git rev-parse HEAD:<path>`，实测输出）

| 文件 | blob |
|---|---|
| `scripts/acceptance.mjs` | `4e14383d400921acbce07b186f56810252cd229f` |
| `scripts/lib/acceptance-binding.mjs` | `e12ea362995fb9bc7cb6d3f0196bb73bc1c7e474` |
| `scripts/lib/acceptance-drills.mjs` | `7bab7d774f8d6f0481a79d03bc34dfb9f1ad2a45` |
| `scripts/lib/acceptance-evidence.mjs` | `fcccb03cc2b251952c57adcd3876f9bff8a679a4` |
| `scripts/lib/acceptance-registry.mjs` | `3d0b3213e32be917cd9003baef8063c2fb70c56f` |
| `scripts/lib/acceptance-report.mjs` | `794fb7f8164e42186ccdd0ddd2028af0390ffd65` |
| `scripts/lib/drill-acs.mjs` | `ad3e14528a8b73322bd615aeaa758943730d444d` |
| `scripts/e2e.mjs` | `c8c1fd7113e7cfe331f42203b02c4a1666332ce4` |
| `scripts/lib/e2e-checks.mjs` | `2f0f28771b1cb94757b68a58beda7bca6909e023` |
| `scripts/lib/e2e-runtime.mjs` | `17d218e15f01587e8a57884538ed00a180483c45` |
| `scripts/live.mjs` | `cd1cf45383be78cb8304b81b7f21017d8c8715be` |
| `scripts/lib/live-report.mjs` | `a766a906c1e3c93b87981a90ccf1af656d345cd2` |
| `scripts/lib/live-release.mjs` | `0357c48f16d53a7bacf39816b784b64dc776671d` |
| `scripts/lib/live-drills.mjs` | `c0d099bbbe69edf832c1658d0f1209060336bfdd` |
| `scripts/lib/live-harness.mjs` | `92601fd993bbb95ee9d80ceebe7396cd3955f982` |
| `scripts/lib/live-transport.mjs` | `d7baf72bde4ae6aec6c2b21f5c0ad4fe4767b179` |
| `package.json` | `e226f65fe7ada1d836940d6a36a21a34591de549` |
| `scripts/not-implemented.mjs` | **已删除**（HEAD 中不存在；`git cat-file -e HEAD:scripts/not-implemented.mjs` 失败；删除发生在 `289fd0f`，`508bfaf`/`0aff531` 中仍存在） |
| `.agentdev/work/WP-10/plan.md` | **已入库**（HEAD 中存在，第 1 轮 W10R1-09 已关闭） |

### 1.3 冻结点之后的工作区漂移（必须披露）

Review 进行到一半时，**同一工作区内的另一个写者**（修复作者，见其在本轮中途发给我的说明）开始在新 Provider 凭证到位后继续修复：

- 2026-09-13T15:02:46Z 起，`scripts/lib/live-transport.mjs` 被改成给 `extractCompletionText` 增加 `reasoning_content`/`reasoning` 回退；
- 随后 `scripts/acceptance.mjs`、`scripts/lib/acceptance-evidence.mjs`、`scripts/lib/live-drills.mjs`、`packages/core/src/model-gateway.ts`、`packages/core/test/model-gateway.test.ts` 也被修改；
- 工作区 `codeDigest` 由 `sha256:0949e146…` 变为 `sha256:18b0e0ce…`，撰写本报告时已进一步变为 `sha256:73fb02c7db6ab15e70b7a8b24605231764cac5c00eb7ef4019908d525d9169ee`（HEAD 仍为 `c53b28d`）。

因此本报告的判定对象是**消息中指定的冻结提交 `c53b28d`**；§1.1 的干净树测量全部发生在漂移之前（`pnpm test:acceptance` 的原始日志打印 `binding sha256:0949e14614c9… (HEAD c53b28d, 252 code files)`）。§5 的两条 P1 中，作者已在本轮中途**书面确认接受**并说明正在新提交中修复；对新提交的复核属于下一轮，不在本报告判定范围内（见 §6）。本 Review 未触碰 `scripts/`、`packages/`、`apps/` 中的任何改动。

## 2. 结论

**FAIL** —— 针对冻结提交 `c53b28d`：第 1 轮 12 条发现中 **10 条已真实关闭**（W10R1-01/04/05/07/08/09/10/11/12 完全关闭，W10R1-06 的机制已关闭但记录仍停留父提交），**2 条仅部分关闭**（W10R1-02 残留「已收集但零用例的映射文件不 fail-closed」；W10R1-03 残留 AC-066）。本轮新增 **2 条 P1**：

- **W10R2-01（P1）**：`AC-066` 在没有任何演练覆盖、也没有登记豁免的情况下被计为 **PASS**，而 `scripts/e2e.mjs:178` 与 `packages/pi-runtime/test/session.integration.test.ts:20/160` 明确把 AC-066 的真实模型「流式/恢复」路径**留给 WP-10 的 live matrix**，`docs`/WP-00 记录也写明「按工作包约定在 WP-10 复验」；`pnpm test:live` 的 `LIVE_DRILL_ACS` 只有 AC-001/007/010/037/041，从不报告 AC-066。这是「不可证的完成声明」，且违反 D3 与 `acceptance.md` §0 对 PASS 的定义。
- **W10R2-02（P1）**：聚合器**忽略 Vitest 项目的退出码**（只在 `report === null` 时 fail-closed），且 `diagnostics.unexecuted` 只覆盖「完全不在 JSON 报告里的测试文件」；一个**出现在报告里但零用例执行**的映射测试文件既不产生 `unexecuted`、也不产生 FAIL。当该 AC 另有通过文件时，`unexecuted=[]`、`counts.FAIL=0` ⇒ **exit 0**。

两条 P1 均已由修复作者在本轮中途书面确认接受并正在后续提交中修复。**本报告判定 `c53b28d` 阻断独立 Test**；若新冻结提交真实修掉这两条，需要重新独立 Review 该提交。

需要说明的是：`pnpm test:e2e`、十条契约命令、真实栈本身**是真实的**（我独立复跑全部通过，见 §4.7、§7）；第 1 轮三处 P1 的**主要机制**（仓库内演练报告可被改写、最弱一环合并、缺口登记）已被真实修复。P1 集中在**残留的完成声明与两条 fail-open 缝隙**，不是「e2e/live 做不到真实执行」。

### 计数与阻断

| 严重度 | 数量 | 是否阻断 |
|---|---|---|
| P0 | 0 | — |
| P1 | 2 | **阻断** |
| P2 | 2 | 不阻断，已登记 |
| P3 | 3 | 不阻断，已登记 |

## 3. 第 1 轮发现逐条复核

以下每条给出：第 1 轮 id → 本轮复现命令 → 现在的观测结果 → 结论。

### W10R1-01（P1，已提交演练报告可改写并抬成 PASS）→ **已关闭**

复现（等价于第 1 轮的攻击，且更严格——工作区里的 `live-results.json` 当时已是「真实 Provider 运行写出的 AC-001 PASS」）：

```bash
# 1) 确认被伪造的仓库记录确实写着 AC-001 PASS
node -e 'const j=require("./.agentdev/work/WP-10/live-results.json");console.log(j.results.find(r=>r.ac==="AC-001"))'
#    → {ac:"AC-001",status:"PASS",...}
# 2) 跑聚合（结果写到 /tmp，不动仓库记录）
node scripts/acceptance.mjs --report /tmp/wp10r2/forged-acceptance.md --json /tmp/wp10r2/forged-acceptance.json
```

现在的观测结果：

```
acceptance: evidence binding sha256:18b0e0ced026… (HEAD c53b28d, 252 code files)
acceptance: 94/94 ACs accounted — PASS 83 / ACCEPTED 11 / FAIL 0 / MISSING 0
acceptance: OK — every AC is PASS or a registered, condition-checked accepted gap      # exit 0
AC-001: status=UNVERIFIED accepted=true mapping=none
        drills = [pnpm test:e2e UNVERIFIED, pnpm test:live UNVERIFIED]
problems = []
```

与干净 `c53b28d` 树上的基线（§7.3：`PASS 83 / ACCEPTED 11 / FAIL 0 / MISSING 0`）**逐项一致**：仓库文件写着 PASS，聚合仍是 UNVERIFIED。三点机制性证据：

1. `runDrills` 自己 spawn `scripts/e2e.mjs`/`scripts/live.mjs`，用 `mkdtempSync` 新建目录 + `AGENTDEV_DRILL_NONCE`（`acceptance-drills.mjs:84-99`），报告必须同时满足「路径来自本次运行」「`nonce` 一致」「`binding` 三字段一致」（`:136-144`）才被采纳。
2. 全量 grep 确认 `scripts/` 下**没有任何**代码把仓库内 `*-results.json` 当证据读取；唯一的仓库文件读是 `live-release.mjs:189` 读 `acceptance-results.json`（就绪门禁的预期输入，且有独立校验）。
3. `--drill-report` / `--drill-out` / `--drills` 三个「外部报告」入口全部被 `parseArgs` 拒绝：`unknown option … exit=2`。grep 确认 `AGENTDEV_DRILL_REPORTS` 已无任何引用。

**结论：已关闭。** 仓库内演练报告不再能抬高其覆盖的 AC。

### W10R1-02（P1，缺失/零用例测试只降级为 UNVERIFIED 且仍 exit 0）→ **部分关闭（残留见 W10R2-02）**

用真实聚合器 + 真实 AC 目录做对抗探针（`/tmp/wp10r2/probe-zerotest.mjs`）：

```
### A: 映射文件从 Vitest 报告中完全消失
diagnostics.unexecuted = ["apps/daemon/test/protocol.integration.test.ts"]
AC-090 → MISSING；AC-028/004/011 → FAIL（curated stale）
⇒ 非 0（exit 2，unexecuted 计入 infraProblems）

### B: 映射文件出现在报告里但零用例执行（assertionResults: []）
diagnostics.unexecuted = []          ← 未被文件级捕获
AC-090 → MISSING；AC-028/004/011 → FAIL（curated stale）
⇒ 非 0（靠 AC 级 MISSING/stale）
```

真实文件旁证：`acceptance.mjs:307-309` 已把 `diagnostics.unexecuted` 并入 `infraProblems`（exit 2），`acceptance.mjs:299-314` 把 `missingResults`、`unmappedFailures` 也并入门禁。第 1 轮的「缺失文件只降级、仍 exit 0」已不成立。**但**零用例文件本身仍不被文件级捕获；若该 AC 还有另一个通过文件，则既不声明 `unexecuted` 也不 FAIL（探针 E，见 §4.1 与 W10R2-02）。

### W10R1-03（P1，演练 UNVERIFIED 的 AC 被聚合为 PASS）→ **部分关闭（AC-066 残留见 W10R2-01）**

- 合并规则已是**最弱一环**（`acceptance-evidence.mjs:44-59`、`e2e-checks.mjs:40`）：`FAIL > UNVERIFIED > PASS`。已提交报告 §6.6 对 AC-010 同时列出 `pnpm test:e2e PASS` 与 `pnpm test:live UNVERIFIED`，§2 状态为 `UNVERIFIED（已登记豁免）`。
- 第 1 轮点名的 6 个「浏览器/模型依赖」AC 中，**5 个**（AC-002/052/071/073/076）现由 `browser-absent` 登记为 ACCEPTED；`AC-054` 现有 e2e `events.watermark-reconnect` 的真实 PASS 证据，属真实通过。
- **AC-066 未被处理**：`e2e-results.json` 与 `live-results.json` 都不含 AC-066，`RESIDUAL_GAPS` 也没有 AC-066，但 `acceptance.md` 判 AC-066 为 **PASS**。详见 W10R2-01。

### W10R1-04（P2，`file` 映射过粗）→ **已关闭**

`acceptance-evidence.mjs:161-176` 已删除文件级映射：只有 `test-name` 与逐用例 `curated`。`acceptance-registry.mjs:173-496` 的 `CURATED_EVIDENCE` 逐条 `{file,title,rationale,wpRecord}`，`resolveCurated` 要求**每一条**都解析到已执行用例，缺一条即 `stale` → `FAIL`。探针 B/C 显示 curated AC 在用例缺失时降为 FAIL。第 1 轮点名的 AC-026/027/028/065/066/092 都已改为逐用例登记；我逐条打开测试体核对（§4.5），条目与 AC 的 Given/When/Then 相符。

### W10R1-05（P2，演练报告按路径覆盖、只留最后来源）→ **已关闭**

`acceptance-drills.mjs:147-153` 把每个 drill 的每一行都 push 进 `results`；`aggregateOne` 用 `mostSevere` 合并但保留全部来源；报告 §6.6「每个 AC 的全部演练来源（不做覆盖式合并）」逐行列出。AC-010 同时显示 e2e PASS 与 live UNVERIFIED，不再被覆盖。

### W10R1-06（P2，冻结版证据生成于父提交、无 HEAD 绑定）→ **机制已关闭；记录仍停留父提交（P3 见 W10R2-05）**

- 机制：`verifyBinding`（`acceptance-binding.mjs:107-136`）同时校验 `codeDigest`、`gitHead`、`gitTree`；drill 报告缺 `binding` 直接拒绝。scratch clone 实验（§4.3）证明 digest 对 `git add`/`git commit` 稳定、对真实代码编辑敏感。
- 记录：三条已提交记录的 `gitHead` 仍是 `5ad533e…`（父提交），`release.md` §0 同样。它们的 `codeDigest` 与冻结树一致。就绪门禁消费的是**本次运行**的 sidecar（只校验 `codeDigest`），所以该 `gitHead` 陈旧**不影响门禁**；但把已提交记录当「冻结版证据」阅读时，`gitHead` 指向的提交并不包含这批记录，属证据自描述缺陷。

### W10R1-07（P2，就绪门禁读磁盘旧 `acceptance.md` 统计）→ **已关闭（信任宽度残留见 W10R2-03）**

`live-release.mjs:176-224` 的 `readAcceptanceResult` 只读 `acceptance-results.json`，并校验：`generatedAt >= startedAt`（拒绝旧结果）、`codeDigest` 与当前树一致、`drillsExecuted === true`。实测（`/tmp/wp10r2/probe-release-gate.mjs`）：

```
stale generatedAt（1 小时前）        → available=false  「拒绝使用旧结果」
生成时间在窗口内但 codeDigest 不符    → available=false  「与当前代码树不一致」
digest 相符但 drillsExecuted=false   → available=false  「来自未执行发布演练的聚合运行」
```

已不再解析磁盘上的 `acceptance.md`（grep 确认）。残留：见 W10R2-03。

### W10R1-08（P2，UNVERIFIED 非阻断、口径掩盖部分证据）→ **已关闭**

- 未登记/条件失效的 UNVERIFIED 在 `acceptance.mjs:263-297` 被计入 `finalCounts.FAIL`；`infraProblems` 非空 ⇒ exit 2，`FAIL>0` ⇒ exit 1。
- 就绪判定（`live-release.mjs:299-327`）：任一命令失败（`test:live` 在 Provider 未配置时的 exit 3 也算失败）→ `NOT READY`；`counts.fail>0` 或 `counts.missing>0` → `NOT READY`；只有「全部命令 0 且只剩已登记豁免」时才输出 `READY (ACCEPTED RISK n)`，并在 §2 用表格逐条列出豁免。已提交 `release.md` §3 = `NOT READY`，§2 列出 11 条豁免。
- 报告把 `PASS` 与 `ACCEPTED` 分列，并在 §0 明确定义 PASS 的口径（`acceptance-report.mjs:113-115`）。

### W10R1-09（P3，`plan.md` 未纳入冻结提交）→ **已关闭**

`git ls-files .agentdev/work/WP-10/` 含 `plan.md`；`git cat-file -e HEAD:.agentdev/work/WP-10/plan.md` 成功；初始 `git status --porcelain` 为空。

### W10R1-10（P3，`DRILL_ACS` 与 `DRILL_DEPENDENCIES` 漂移）→ **已关闭**

`scripts/lib/drill-acs.mjs` 现在是唯一来源：`live.mjs:63` `const DRILL_ACS = LIVE_DRILL_ACS`，`e2e.mjs` 引入 `E2E_BROWSER_*`/`E2E_PROVIDER_ACS`，聚合器引入 `RESIDUAL_GAPS`/`conditionHolds`，报告层引入 `RESIDUAL_GAPS`。AC-007/010/037/041 现在出现在验收汇总的 ACCEPTED 表中（`acceptance.md` §3）。

### W10R1-11（P3，`check()` 空证据仍记 PASS）→ **已关闭**

`e2e-checks.mjs:80-86`：证据为 `undefined/null/空白` 时抛错 → 该检查记 `FAIL`；`unverified()`（`:121-123`）空原因即抛错；`acceptance-registry.mjs:549-553` 对无证据文本的 drill 行报 problem 并丢弃。已提交 20 个检查均有真实证据文本。

### W10R1-12（P3，注释与实现矛盾）→ **已关闭**

`live-report.mjs:8-12` 已改写为「UNVERIFIED 行会把同一 AC 的套件 PASS 降级」「聚合器会拒绝 binding 不符的报告」；`e2e-checks.mjs:32-39`、`acceptance-evidence.mjs:1-34`、`acceptance-binding.mjs:1-23` 的契约注释与「最弱一环 + 只采用本次运行产生的演练证据」一致。

### 第 1 轮复核汇总

| id | 第 1 轮严重度 | 本轮结论 |
|---|---|---|
| W10R1-01 | P1 | 已关闭 |
| W10R1-02 | P1 | 部分关闭（W10R2-02） |
| W10R1-03 | P1 | 部分关闭（W10R2-01） |
| W10R1-04 | P2 | 已关闭 |
| W10R1-05 | P2 | 已关闭 |
| W10R1-06 | P2 | 机制已关闭；记录 gitHead 陈旧（W10R2-05） |
| W10R1-07 | P2 | 已关闭（信任宽度残留 W10R2-03） |
| W10R1-08 | P2 | 已关闭 |
| W10R1-09 | P3 | 已关闭 |
| W10R1-10 | P3 | 已关闭 |
| W10R1-11 | P3 | 已关闭 |
| W10R1-12 | P3 | 已关闭 |

## 4. 本轮新检查

### 4.1 第 1 轮 12 条发现的复现（对应任务项 1）

见 §3。另按任务书逐项做了三个指定的对抗复现：

1. **伪造已提交 drill 报告**：见 W10R1-01；聚合不变，exit 0。
2. **删除/清空映射测试的执行结果**：探针 A（文件消失）→ `unexecuted` 命中、exit 2；探针 C（curated 具体用例消失）→ `stale` → FAIL；探针 D（两文件之一消失、另一个通过）→ 消失文件进 `unexecuted` → exit 2（**不再有文件级稀释**：AC-090 仍 PASS，但门禁因 `unexecuted` 非 0）。
3. **零用例映射文件**：探针 B（唯一证据文件零用例）→ AC `MISSING` → 非 0；探针 **E**（两文件之一零用例、另一文件通过）：
   ```
   ### E: AC-090 两文件之一在报告里零用例，另一个通过
   diagnostics.unexecuted = []
   diagnostics.testCounts = 1 scannedFiles = 2 executedFiles = 2
   AC-090 → PASS | mapping=test-name | evidence=1
   ⇒ 若其余 AC 都正常，counts.FAIL === 0 且 unexecuted === [] ⇒ exit 0
   ```
   即「已收集但零用例的映射文件」**不是**非 0 结果（见 W10R2-02）。
4. **drill UNVERIFIED 对套件 PASS 的影响**：`acceptance.md` §2/§6.6 显示 AC-010（套件 PASS + e2e PASS）因 live UNVERIFIED + `provider-absent` 登记降级为 `UNVERIFIED（已登记豁免）`；`AC-002` 同理（browser-absent）。最弱一环生效。

### 4.2 新信任边界是否可被绕过（对应任务项 2）

逐一尝试并给出的结果：

| 攻击面 | 尝试 | 结果 |
|---|---|---|
| CLI flag | `acceptance.mjs --drill-report <p>` / `--drill-out <p>` / `--drills <p>` | `unknown option …`，**exit 2**，不产出报告 |
| 环境变量 | `AGENTDEV_DRILL_REPORTS` | 全仓 grep 0 引用；drill 子进程只从 argv 取 `--drill-out` |
| 环境变量 | 外部预置 `AGENTDEV_DRILL_NONCE` | `acceptance-drills.mjs:99` 用本次生成的 nonce 覆盖 `{...env, AGENTDEV_DRILL_NONCE: nonce}` |
| 文件位置 | 把伪造报告放到仓库任意路径 | 无任何代码读取仓库 drill 记录（grep + 动态：伪造 `live-results.json` 后聚合不变） |
| 复用旧临时目录 | 预判 `mkdtempSync` 路径 | 目录名与 nonce 均随机；且报告必须携带本次 nonce |
| 报告形状 | 非法/未知 status、无证据行、越界 AC id | `parseDrillReport` 报 problem 并丢弃（`acceptance-registry.mjs:533-585`），problem 进 `infraProblems` ⇒ 非 0 |
| binding 不符 | 改一个代码字节后使用旧报告 | `verifyBinding` 三字段比对，报告被拒且 `problems` 进 exit 2 |
| **不跑 drill 让门禁 exit 0** | `acceptance.mjs --no-drills` | **aggregate 会 exit 0**（11 个 gap AC 变 MISSING→ACCEPTED，其余 PASS）；但 sidecar 写 `drillsExecuted:false`，`readAcceptanceResult` 拒绝该 sidecar ⇒ 发布就绪不会因此变 READY（见 W10R2-07） |

结论：**没有**任何 flag、环境变量、文件位置或 `--drill-out` 技巧能让仓库内的伪造报告被采纳。唯一「不跑 drill 也 exit 0」的路径是显式 `--no-drills` 调试开关，且发布门禁对它 fail-closed。trust boundary 的真实边界是「改跑者代码本身」——那会改变 `codeDigest`，但也让改后的代码自洽，属任何仓库内验证的固有上限。

### 4.3 绑定稳定性与诚实性（对应任务项 3）

在 `git clone --local` 的 scratch 副本（`/tmp/wp10r2/scratch`，HEAD `c53b28d`，干净）上实验，不触碰真实工作区：

```
D0 干净树（= 已提交记录 digest） : sha256:0949e14614c98d17398d1f3c8227d7cd3bc8b16971a3ceb532ebfc77ac545e5f
D1 新增未跟踪 codes 文件          : sha256:641bf26b36f932587ad1ecfd5c7a2bdff793219011c3337df48ec0d9693c320d   （变化）
D2 git add 之后                   : sha256:641bf26b…（不变）
D3 git commit 之后（HEAD f3edf1c）: sha256:641bf26b…（不变）
D4 真实代码编辑（改 src/index.ts）: sha256:4abb95c1e108f3bcd4a1d68b1e8860c33c77deee35428b665f505e88a61be975 （变化）
D5 git checkout -- 还原           : sha256:641bf26b…（回到 D3）
```

- `git add` / `git commit` **不改变** digest；真实代码编辑（含新增未提交代码文件）**改变** digest。第 1 轮 W10R1-01 的攻击面（「提交记录不改 digest，故旧 digest 长期有效」）已按预期关闭。
- 已提交的 `acceptance-results.json` / `e2e-results.json` / `live-results.json` 的 `codeDigest` **都等于**冻结树 digest（§1.1）。
- 三条已提交记录的 `gitHead` 仍是 `5ad533e…`（父提交）。**这不影响门禁**：门禁只消费「本次运行产生」的 sidecar（校验其 `codeDigest`），从不把已提交记录当证据；影响仅限「把记录当冻结版证据阅读」时的自描述性（W10R2-05）。

### 4.4 已登记豁免（对应任务项 4）

- 独立解析 `docs/delivery/acceptance.md`：`### AC-NNN` 标题 **94 个、0 重复、AC-001…AC-094 无缺口无越界**；94 条全部含 `关联：REQ-*`、`Given`、`When`、`Then`、`证据：`。与 `parseAcceptanceDoc` 的注册表逐一对齐（`problems: []`），无伪造 id。
- 已提交 `acceptance-results.json` 的 ACCEPTED 集合恰为 **11 个**：`AC-001,002,007,010,037,041,043,052,071,073,076`，与 `.agentdev/work/WP-10/implementation.md` §T1 表格**逐条一致**（5 provider-absent + 1 review-model-absent + 5 browser-absent）。
- `RESIDUAL_GAPS`（`drill-acs.mjs:66-122`）恰为同样 11 个 key，每条都有 `condition` 与 `decision`（决定记录），无多无少。
- **fail-closed 复核**（`/tmp/wp10r2/probe-gaps.mjs`：真实 AC 目录 + 真实 `aggregateAcceptance` + 真实 `conditionHolds`，喂「全部 AC 套件 PASS」的合成报告，逐字复刻 `acceptance.mjs` 的豁免判定循环）：

```
未配置 Provider：counts {"PASS":83,"ACCEPTED":11,"FAIL":0,"MISSING":0} unaccepted=0
AGENTDEV_PROVIDER_BASE_URL=http://127.0.0.1:1/v1 AGENTDEV_PROVIDER_MODEL=x AGENTDEV_PROVIDER_SECRET=y：
counts {"PASS":83,"ACCEPTED":6,"FAIL":5,"MISSING":0}
unaccepted: AC-001/007/010/037/041 条件失效(provider-absent)
⇒ acceptance.mjs 的退出逻辑给出 exit 1
```

即：一旦配置了 Provider，`provider-absent` 的 5 条豁免**立即失效**，不 PASS 的 AC 被计入 FAIL、门禁非 0。`AC-043` 的条件是 `review-model-absent`（只由 `AGENTDEV_PROVIDER_REVIEW_MODEL` 决定），因此仅配置三项 Provider 变量时它仍为合法豁免——与登记表一致，不是漏洞。浏览器豁免是 D1 的永久缺口（`browser-absent`），条件恒真。

### 4.5 AC 计账与映射质量（对应任务项 5）

- 计账：94/94，`acceptance.md` §0「已执行提交用例：1416 个，覆盖 81/81 个测试文件」= unit 1105 + integration 311 用例、55 + 26 文件，独立复算一致。
- 抽样（>12 个 AC，含全部 curated）与结论：

| AC | runner 状态 | 映射 | 我打开的测试体 | 结论 |
|---|---|---|---|---|
| AC-004 | PASS | curated | `packages/domain/test/domain.test.ts:168`、`apps/daemon/test/server.test.ts:530` | 真证据：assist/问题不产生授权、不建 Work 交付 |
| AC-005 | PASS | test-name | `domain.test.ts:252`、`artifacts.test.ts:407` | 真证据：显式消息即范围授权（`explicitAuthorization=true`、Authorization.scope.writePaths） |
| AC-011 | PASS | test-name | `packages/core/test/delivery.integration.test.ts:1218-1306` | 真证据：L3 Gate 缺 rollback/audit/drill 即拒；无授权 `NOT_AUTHORIZED` |
| AC-026 | PASS | curated | `scan.test.ts:266/286/234/382/518/618` | 真证据：40 文件 / 512KiB 预算、未知项显式、不建/不移文件、`updatesDeliveryRef=false` |
| AC-027 | PASS | curated | `initialize.test.ts:538-614` | 真证据：无 Git → `git-initialization` blocker + 授权请求；只读调查可用 |
| AC-028 | PASS | curated | `initialize.test.ts:487-535` | 真证据：脏工作区 blocker + 用户文件 sha256 报告、只读调查可用、需显式处置 |
| AC-065 | PASS | curated | `migrations.integration.test.ts:131/149/166/185/193/203` | 真证据：备份、事务回滚报版本、checksum/newer/幂等 |
| AC-066 | **PASS** | curated | `session.integration.test.ts:78/99/119/124/152`、`events.test.ts:25/55` | **不可证**：真实流式/历史恢复未执行且无登记（W10R2-01） |
| AC-067 | PASS | curated | `extensions.test.ts:46/55`、`attempt.integration.test.ts` | 真证据：未知 id 拒绝、Critical 阻断、可选独立禁用 |
| AC-086 | PASS | curated | `feature-format.test.ts:146/326/344/351/358/362/369` | 真证据：完整样例通过 + 7 类缺来源/错版本负例 |
| AC-092 | PASS | curated | `requirements-pool.test.ts:383/498-587` 等 7 条 | 真证据：幂等、逐条冲突、stale 投影拒绝覆盖、修复后显式导入解除冲突 |
| AC-054 | PASS | test-name | `commands.test.ts:95-220`、e2e `events.watermark-reconnect` | 真证据（另有 2 条 off-topic 证据，见 W10R2-04） |
| AC-078 | PASS | test-name | `apps/web/test/server.test.ts`、`server.integration.test.ts` | 真证据：认证/Origin/Cookie/退出后 401 且 Work 保留 |
| AC-090 | PASS | test-name | `requirement-save.integration.test.ts`、`workbench.integration.test.ts:2123-2185` | **部分**：Then 的「界面展示分支/提交/未推送」无实现无断言（W10R2-04） |
| AC-093 | PASS | test-name | `requirement-save.test.ts`、`context-builder.test.ts:1559+` | 真证据覆盖面广；Given 的部分错误样例挂在别的文件（W10R2-04） |
| AC-094 | PASS | test-name | `cas.integration.test.ts:362-500` | **归因偏弱**：stale 拒绝走 `expectedRevision`，recordHash 校验由 AC-093 的用例覆盖（W10R2-04） |

未发现「id 只出现在标题/注释即 PASS」的伪造；`AC-999` 负例被 `extractAcIds` 正确排除（报告 §6.5 列出）。发现 2 处 test-name 证据噪声与 2 处覆盖不足（W10R2-04）。

### 4.6 发布就绪门禁（对应任务项 6）

- 代码路径：`runReleaseDrill` 跑十条命令后调用 `readAcceptanceResult(repoRoot, startedAt)`；该函数只读 `.agentdev/work/WP-10/acceptance-results.json`，并有 §4.2 表所列的三重校验。已不再读 `acceptance.md`。
- 是否「只用本次运行的结果」：**部分**。用导出的 `readAcceptanceResult` 直接植入四份 sidecar（`/tmp/wp10r2/probe-release-gate.mjs`）：

```
stale generatedAt（1 小时前）                    → available=false（拒绝旧结果）
窗口内但 codeDigest 不符                         → available=false
digest 相符但 drillsExecuted=false               → available=false
未来时间戳 + digest 相符 + drillsExecuted=true + 94×PASS → available=true, pass=94   ← 被采纳
```

第三项与第四项说明：门禁没有 run nonce、也没有与它刚刚 spawn 的 `pnpm test:acceptance` 子进程的身份绑定，只有 `generatedAt >= startedAt` 这个**下界**，所以「未来时间戳」的伪造 sidecar 会被采纳（W10R2-03）。**当前不可翻转结论**：同一次 `--release` 运行里，真实的 `pnpm test:acceptance` 会在窗口内覆盖该文件；且任一命令非 0 都已进 `readinessProblems`。属潜在（latent）fail-open，不是当前可达的假 READY。
- `READY (ACCEPTED RISK n)` 只在 `readinessProblems.length === 0` 且 `counts.accepted > 0` 时产生；未登记/条件失效的 UNVERIFIED 已被 `acceptance.mjs` 折进 `counts.FAIL`，`MISSING` 也单独阻断 ⇒ 不能在有 FAIL/MISSING/未登记 UNVERIFIED 时输出。已提交 `release.md` §2 列全部 11 条豁免、§3 = `NOT READY`（原因：`pnpm test:live` exit 3）。
- 未重跑完整 `node scripts/live.mjs --release`，原因见 §6（它会重写跟踪记录，且作者要求把工作区留给他）。

### 4.7 契约命令（对应任务项 7）

全部在仓库根、`export PATH="$HOME/.local/bin:$PATH"` 下真实执行（原始日志 `/tmp/wp10r2/contracts/*.log`）：

| 命令 | 退出码 | 观测 |
|---|---|---|
| `pnpm install --frozen-lockfile` | 0 | `Lockfile is up to date… Done in 65ms` |
| `pnpm typecheck` | 0 | `tsc -p tsconfig.json --pretty false`，无错误 |
| `pnpm lint` | 0 | Prettier 全绿 + ESLint |
| `pnpm test:unit` | 0 | `Test Files 55 passed (55)` / `Tests 1105 passed (1105)` |
| `pnpm test:integration -- --maxWorkers=4` | 0 | `Test Files 26 passed (26)` / `Tests 311 passed (311)`；Docker 用例真实执行（`runs a container read through Docker and reports the real non-root account 10176ms`、`keeps the frozen source read-only inside the real container (AC-048, AC-050) 7037ms`） |
| `pnpm test:e2e` | 0 | `20 checks — PASS 16 / FAIL 0 / UNVERIFIED 4`、`23 ACs accounted for` |
| `pnpm test:acceptance` | 0 | `94/94 ACs accounted — PASS 83 / ACCEPTED 11 / FAIL 0 / MISSING 0` |
| `pnpm test:live`（未配置 Provider，net 探针包装） | **3** | `UNVERIFIED: real Provider not configured (set …)`；**零网络调用**（探针自检能捕获真实连接：`netprobe selftest events=5`；本次运行**没有生成任何 net 事件日志文件**） |
| `pnpm docs:check` | 0 | `15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages` |
| `pnpm build` | 0 | 全 workspace；`build: Done` 计数 **12** |
| `pnpm doctor` | 0 | `All checks passed` |

与 `implementation.md` §T4 记录比对：1105/55、311/26、94/94、83/11/0/0、12 个 build workspace **完全吻合**；无记录与现实的数值差异。

### 4.8 回归风险（对应任务项 8）

- **仓库内写面**：`acceptance.mjs` 只写 `--report`/`--json`（默认两处 WP-10 记录）；`e2e.mjs` 写 `e2e-results.json`/`e2e.md`（`--drill-out` 时只写指定临时路径）；`live.mjs` 写 `live-results.json`/`live.md`；`live.mjs --release` 写 `release.md`。除这些受控产物外不触碰跟踪文件。
- **临时目录/进程/端口**：e2e/live 的 Git 工作全部在 `mkdtempSync` 目录，`e2e.mjs:194-198` 与 `live-harness.mjs:697-703` 的 `finally` 调 `harness.close()`（`protocol.closeAll(1001)` + 关闭 BFF server + `store.close()`）与 `cleanupTempDirs()`。实测运行后：`ls -d /tmp/agentdev-*` 无残留目录；`lsof -nP -iTCP -sTCP:LISTEN` 仅本机既有 3080/8080 两个服务，无新增 node 监听端口。
- **凭证遮蔽**：用假 secret（`sk-WP10R2-SUPERSECRET-…`）与含 `user:pass@` 的 base URL 跑 `node scripts/live.mjs --no-write --drill-out /tmp/…`：secret 在 stdout/stderr **0 次**、在 drill JSON **0 次**；`userinfo` 同样 0 次（`live-transport.mjs` 的 `mask()` 与 `live-report.mjs` 的 `redactUrl` 生效）。失败路径（ECONNREFUSED）也不含凭证。
- **`scripts/not-implemented.mjs`**：文件已删除（HEAD 中不存在；删除发生在 `289fd0f`），`package.json` 与 `scripts/` 全量 grep 无引用（仅历史 WP 记录的文字提及）；所有契约命令 exit 0，删除未破坏任何东西。
- **依赖/可执行位**：`package.json` 未新增依赖、无 Playwright；`test:e2e`/`test:acceptance`/`test:live` 均指向真实脚本。

## 5. 新发现清单

### W10R2-01（P1，阻断）AC-066 被判 PASS，但其真实模型「流式/恢复」路径从未执行且未登记豁免

- 证据：
  - `scripts/e2e.mjs:178`（以及 `.agentdev/work/WP-10/e2e.md:80`）：「真实 Provider 未执行…**AC-001/AC-043/AC-066** 的真实模型纵向演练归 `pnpm test:live`」。
  - `packages/pi-runtime/test/session.integration.test.ts:20`「the live-model paths of **AC-066** are re-run at WP-10」；同文件 `:160`「History restoration and live streaming need a model turn and are **re-verified by the WP-10 live matrix (AC-066 发布回归)**」；`packages/pi-runtime/test/events.test.ts:10` 同义。
  - `.agentdev/work/WP-00/implementation.md:115`：「带历史的恢复与压缩语义属 AC-066 完整行为，**按工作包约定在 WP-10 复验**」；`WP-00/discovery.md:113` 同义。
  - `scripts/lib/drill-acs.mjs:39-51`：`LIVE_DRILL_ACS = {html:[AC-001], l1:[AC-007], l2:[AC-010,AC-037,AC-041]}`，`LIVE_REPORTED_ACS` 另有 `AC-043`；**没有 AC-066**。
  - `e2e-results.json` 的 23 个 AC、`live-results.json` 的 5 个 AC 里都没有 AC-066（`AC-066 in e2e? false | in live? false`）。
  - `RESIDUAL_GAPS` 无 `AC-066`；`acceptance.md:101` 判 `AC-066 **PASS** | curated`；`acceptance.md:312` 显示 7 条 curated 全部 resolved。
- 复现：
  ```bash
  grep -n "AC-066" scripts/e2e.mjs scripts/lib/drill-acs.mjs packages/pi-runtime/test/session.integration.test.ts \
      packages/pi-runtime/test/events.test.ts .agentdev/work/WP-00/implementation.md
  node -e 'const fs=require("fs");for(const f of ["e2e-results.json","live-results.json"]){const j=JSON.parse(fs.readFileSync(".agentdev/work/WP-10/"+f,"utf8"));console.log(f,j.results.map(r=>r.ac).join(","),"=> AC-066?",j.results.some(r=>r.ac==="AC-066"))}'
  node -e 'const j=require("./.agentdev/work/WP-10/acceptance-results.json");console.log(j.results.find(r=>r.id==="AC-066"))'
  ```
  观测：两条 drill 报告均不含 AC-066；`acceptance-results.json` 中 AC-066 为 `status:"PASS", accepted:false, drills:[]`。
- 影响：发布记录把 AC-066 计入 **83 个 PASS**（正确口径应为 PASS 82 / ACCEPTED 12 或由 live 真实关闭）。AC-066 的 Given 是「锁定 Pi 版本」、When 是「运行适配测试」、Then 包含「流式…恢复」；`session.integration.test.ts:152-160` 自己声明「does NOT claim to restore history」。WP-00 明确把该行为推迟到 WP-10，WP-10 却未执行、未登记、却判 PASS——违反 D3 与 `acceptance.md` §0 的 PASS 定义，属不可证的完成声明。
- 修复建议：把 AC-066 登记为 `provider-absent` 豁免（缺口＝真实模型流式增量与会话历史恢复未执行），或让 `pnpm test:live` 的 L1/L2 演练显式把 AC-066 纳入 `LIVE_DRILL_ACS` 并逐条断言；同时删掉代码/记录中「re-run at WP-10」的陈旧声明，使代码、记录与判定一致。
- 备注：修复作者已在本轮中途**书面确认接受**此发现并说明正在修复。

### W10R2-02（P1，阻断）Vitest 项目退出码被忽略；「已收集但零用例」的映射文件不 fail-closed

- 证据：
  - `scripts/acceptance.mjs:240-245`：只把 `run.report === null` 当基础设施失败；`run.exitCode !== 0` 但写出了 JSON 报告时**不产生任何问题**。
  - `scripts/lib/acceptance-evidence.mjs:290-293`：`unexecuted` 只包含「不在 `index.byFile` 键集合里、且源码含 AC id」的文件；而 `indexTestCases`（`:97`）对报告里每个 `testResults` 条目都 `byFile.set(file, tests)`，**即使 `tests` 为空**。因此「文件在报告里但零用例」永远不会进 `unexecuted`。
  - `indexTestCases` 完全忽略 `suite.status`/`suite.message`（vitest 对「收集失败/无测试」的文件给出的就是套件级失败、`assertionResults: []`），`unmappedFailures`（`:299-301`）只看 `assertionResults`，也捕获不到。
- 复现（真实聚合器 + 真实 AC 目录，`/tmp/wp10r2/probe-zerotest.mjs`）：
  ```
  ### A: 映射文件从报告中完全消失 → unexecuted=["apps/daemon/test/protocol.integration.test.ts"] ⇒ exit 2
  ### B: 映射文件在报告中但 assertionResults: [] → unexecuted=[]，仅靠 AC 级 MISSING/stale ⇒ 非 0
  ### E: AC-090 两文件之一零用例、另一个通过 →
        diagnostics.unexecuted = []
        diagnostics.testCounts = 1 scannedFiles = 2 executedFiles = 2
        AC-090 → PASS | mapping=test-name | evidence=1
        ⇒ counts.FAIL === 0 且 unexecuted === [] 时 exit 0
  ```
  即：单个测试文件静默地不再执行任何用例（收集错误、被过滤、被误改）时，只要该 AC 还有另一个通过文件，验收门禁**既不停机也不披露**；同时该 Vitest 项目的非 0 退出码被忽略。
- 影响：这是继第 1 轮 W10R1-01 之后**第二条 fail-open 通道**：证据文件整体失效可以不改变 `PASS 83 / exit 0`。与 `implementation.md` §T1「含 AC 证据的测试文件零用例执行 ⇒ fail-closed（exit 2）」的声明不符。
- 修复建议：`aggregateAcceptance` 不应把「出现在报告里但 `assertionResults` 为空」的文件登记为已执行；`acceptance.mjs` 应把 `run.exitCode !== 0`（在 `report` 存在时）也计入 `infraProblems`。
- 备注：修复作者已在本轮中途**书面确认接受**此发现，并说明「`indexTestCases` 不再登记零用例的文件」+「项目非 0 退出即基础设施失败」正在修复。

### W10R2-03（P2）就绪门禁 `readAcceptanceResult` 会采纳「未来时间戳 + digest 相符」的伪造 sidecar（无 run nonce / 无子进程身份绑定）

- 证据：`scripts/lib/live-release.mjs:196-209` 只检查 `generatedAt >= startedAt`（下界）、`codeDigest` 与当前树一致、`drillsExecuted === true`；没有 nonce，也没有校验该 sidecar 是它刚刚 spawn 的 `pnpm test:acceptance` 子进程写的。
- 复现（`/tmp/wp10r2/probe-release-gate.mjs`，直接调用导出的 `readAcceptanceResult`）：
  ```
  未来时间戳 + 当前 codeDigest + drillsExecuted=true + 94×PASS
    → available = true | pass = 94 accepted = 0 fail = 0 missing = 0 | drillsExecuted = true
  ```
- 影响：当前**不可翻转结论**——同一次 `--release` 运行中，真实的 `pnpm test:acceptance` 会在窗口内覆盖该文件；且任一命令非 0 都会进 `readinessProblems`（`live-release.mjs:299-313`）。属潜在 fail-open：若将来 `test:acceptance` 以 0 退出而不写 sidecar（例如加 `--no-write`、写盘静默失败），伪造 sidecar 会被采纳为发布依据。聚合器本身（§4.2）没有这个缝，就绪门禁的信任边界弱于聚合器。
- 修复建议：让 `acceptance.mjs` 在 sidecar 中写入本次运行的随机 `runNonce`，由 `--release` 通过环境变量传入并校验；或改为只解析 `pnpm test:acceptance` 本次子进程的 stdout + 校验其退出码与 sidecar 写入时间落在该子进程的存活窗口内。
- 备注：已在本轮中途告知修复作者。

### W10R2-04（P2）部分 AC 的 PASS 证据噪声或覆盖不足（test-name 映射把“含 AC 编号的无关用例”也算证据）

- 证据与复现（逐条打开测试体核对，命令见 §7）：
  1. **AC-090**：Then 明写「界面展示分支、提交与未推送状态」。`apps/web/src/views.ts:542` 解析了 `portableRef`，但 `apps/web/src/pages.ts` 从不渲染它；`grep -rn "unpushed" apps/web/src` **0 命中**；唯一映射的 UI 用例 `apps/web/test/workbench.integration.test.ts:2123-2185` 只断言 `saveState==='saved'`、`data-record-version="1"`、`Save state: saved`。该 Then 子句既未实现也无断言，但 AC-090 计 PASS。
  2. **AC-094**：Then 的「组合 recordHash 校验拒绝旧投影覆盖」由 AC-093 的用例证明（`packages/core/test/requirement-save.integration.test.ts` "stale projection refuses to overwrite (AC-093)"），AC-094 自己的映射用例用 `expectedRevision` 做乐观并发（`packages/workspace/test/cas.integration.test.ts:427-485`：`expectedRevision: revision` → `VERSION_CONFLICT`）。行为被测到，但归因不在 AC-094。
  3. **AC-054**：映射里混入 2 条 `apps/web/test/workbench-failures.integration.test.ts:1210/1312` 的「订阅扩大」跨项目授权用例，只因其标题含 `(AC-054/AC-078)`/`(AC-054)`；它们与「断开/重连/后台继续」无关。
  4. **AC-068**：`apps/daemon/test/protocol.integration.test.ts:591` 标题写「cancels a Queued requirement without Work and refuses to pause it (AC-068)」，测试体实际断言该 cancel 因未接 Git record service 被 `INVALID_STATE` **拒绝**（`:596-605`）——标题与断言相反，真正的 cancel 由 e2e `board.rules`/`workbench.integration.test.ts:1115` 证明。
- 影响：AC-090 的 PASS 对一个 Then 子句属过度声明；AC-054/068/094 是证据归因/噪声问题。均不改变 94/94 的计账，但削弱「每个 PASS 都有精确可审计证据」的口径。其中 AC-090 的 UI 子句更接近产品缺口（跨 WP-09/WP-10 车道）。
- 修复建议：把 AC-090 的界面子句补实现并加断言，或把该子句显式登记为未验证；AC-054/068/094 收敛为精确用例清单（`curated`）或修正误导性标题。

### W10R2-05（P3）已提交记录的 `gitHead` 停留父提交 `5ad533e`，冻结提交 `c53b28d` 自身从未被记录为证据来源

- 证据：`acceptance-results.json` / `e2e-results.json` / `live-results.json` / `release.md` §0 的 `gitHead` 均为 `5ad533ea…`（`git rev-parse` 对照 `c53b28d`）；它们的 `codeDigest` 与冻结树一致。
- 复现：`node -e '…读取三条记录打印 gitHead/codeDigest…'`（§1.1 表）+ `git show HEAD:.agentdev/work/WP-10/release.md | head -12`。
- 影响：门禁只消费本次运行的 sidecar，所以**不影响判定**；但记录被当作「冻结版证据」阅读时，`gitHead` 指向的提交并不包含这批记录，`implementation.md` §T4「本轮真实运行重新生成」在提交粒度上不可自证。W10R1-06 的机制部分已关闭，这一条是其记录层面的残留。
- 修复建议：在下一轮冻结提交后重跑并提交记录（或在报告中注明记录对应的代码 digest 而非仅 HEAD）。

### W10R2-06（P3）报告 §6.2 显示 AC-011「否（FAIL）」，但门禁 exit 0；test-name 命中的 AC 的 curated 条目从不校验

- 证据：`acceptance.md` §6.2 表头写「必须全部 resolved，且无 stale」，其中 `| AC-011 | 3 | 否（FAIL） | 0 |`；同一份报告 §0 是 `PASS 83 / FAIL 0`，exit 0。原因：`acceptance-evidence.mjs:168-176` 只在 `nameTests.length === 0` 时才走 curated 分支；AC-011 的某个测试标题本身含 `(AC-011)`，于是 mapping 记为 `test-name`，curated 条目**完全不解析**；`aggregateAcceptance` 的 `diagnostics.curated[].resolved`（`:303-311`）因此在报告里渲染为「否（FAIL）」，但 `curated` 诊断**不在** `infraProblems` 里，不影响退出码。
- 复现：`grep -n "AC-011" .agentdev/work/WP-10/acceptance.md | head`（§6.2 的「否（FAIL）」）+ `node -e '…打印 diagnostics.curated…'`。
- 影响：报告自相矛盾（一处写 FAIL，门禁 exit 0），削弱审计可读性；AC-011 的 3 条 curated 登记（含 `migrations` 回滚、`backup` 恢复）是**死条目**，删掉对应测试也不会被门禁发现（但 AC-011 仍有 test-name 证据）。
- 修复建议：`resolved` 只对真正采用 curated 映射的 AC 计算，或对「登记了 curated 却被 test-name 抢先」的 AC 显式标注为 `unused`；必要时把 curated 条目同时纳入校验。

### W10R2-07（P3）`acceptance.mjs --no-drills` 会在不执行任何演练的情况下输出 94/94、`OK` 并 exit 0

- 证据：`--no-drills` 时 `runDrills` 返回 `executed:false`、空 `results`（`acceptance-drills.mjs:79-82`）；`acceptance.mjs` 没有把 `drills.executed === false` 计入 `infraProblems`。用真实目录 + 真实聚合器的复刻（`/tmp/wp10r2/probe-gaps.mjs` 的「未配置 Provider」分支，drill 映射为空）得到 `PASS 83 / ACCEPTED 11 / FAIL 0 / MISSING 0` ⇒ 退出逻辑给出 exit 0。
- 复现：`node /tmp/wp10r2/probe-gaps.mjs`（空 drill 映射的 counts 行）。
- 影响：**不影响发布就绪**——sidecar 写 `drillsExecuted:false`，`readAcceptanceResult` 明确拒绝（§4.6 第三行）；`pnpm test:acceptance` 默认开 drills。这是显式调试开关的语义，不是发布门禁漏洞。
- 修复建议（可选）：`--no-drills` 时在报告与退出码上显式标注「不含演练证据」，避免有人把该输出当作发布验收结论。

## 6. 未验证/无法验证项

- **真实 Provider 纵向演练（AC-001/007/010/037/041/043/066 的模型侧）**：本 Review 的受控运行期间环境没有 `AGENTDEV_PROVIDER_*`，我按任务要求验证了「未配置 ⇒ 零网络调用 + exit 3 + 点名缺失」与「配置后豁免失效 ⇒ 非 0」。评审中途另一写者拿到真实凭证并在**已被其修改的工作区**上跑过一次 `node scripts/live.mjs`（我观察到其结果为 `3 passed / 1 failed`，exit 1），但那是漂移后的树，且我没有使用该凭证，因此**不能**据此判定 `c53b28d` 或新树的真实 Provider 路径通过。该路径需由独立 Test 在配置 Provider 后判定。
- **完整 `node scripts/live.mjs --release` 端到端复跑**：未执行。它会重写跟踪记录（`release.md` 及其内部 `pnpm test:acceptance` 重写 `acceptance.md`/`acceptance-results.json`），而修复作者明确要求把工作区留给他。改用导出的 `readAcceptanceResult` 直接植入 sidecar 的四组实验 + 代码路径核对 + 已提交 `release.md` 的核对，覆盖了同一判定的三条 fail-closed 条件与残留信任缝（§4.6、W10R2-03）。
- **真实浏览器（像素/焦点/ARIA/脚本隔离攻击样例）**：按 D1 不引入浏览器，无法执行；只能验证离线断言与登记。
- **`c53b28d` 之后的修复**：`scripts/acceptance.mjs`、`scripts/lib/acceptance-evidence.mjs`（W10R2-02）与 AC-066 相关改动（W10R2-01）正在新提交中；作者承诺告知新冻结点。**对新提交的复核不在本报告范围内**，需要下一轮独立 Review。
- **crash/恢复注入演练（CAS journal 崩溃）**：e2e/live 使用 `createMemoryCasJournal`，设计上不在本切片，未验证。
- **`pnpm install --frozen-lockfile` 的锁文件一致性**：本次独立复跑 exit 0（`Lockfile is up to date`），未做更深的一致性审计。
- **`docs/rules/*`、`AGENTS.md`、`docs/INDEX.md` 与本包的全量一致性**：按需查阅，未做全量交叉审计（不是本次判定对象）。
- **W10R2-02 的「真实收集失败文件」**：由于作者要求只在 `/tmp` 实验且不要把工作区留给我，我用真实聚合器 + 合成的「已收集零用例」报告复现（`probe-zerotest.mjs`），未在仓库内创建一个真实语法错误的测试文件。
- **子代理的 12-AC 映射审计**：我采纳其结论前逐条自查了 AC-090/093/094/054/068 的关键断言与文件位置（§4.5、W10R2-04）；其余 PARTIAL 判定（AC-005/008/039/043）未全部逐行复读，列为未验证的次要线索。
- **工作区一致性**：本报告 §1.1 的哈希与 §7 的命令输出采集于漂移前；漂移后的工作区（`codeDigest 18b0e0ce…`）不属于本报告判定对象。

## 7. 独立复算的命令输出

原始日志：`/tmp/wp10r2/contracts/*.log`（十条契约命令）；`/tmp/wp10r2/{forged-acceptance.md,forged-acceptance.json,forged-acceptance.log}`；探针 `/tmp/wp10r2/{netprobe.cjs,probe-gaps.mjs,probe-zerotest.mjs,probe-release-gate.mjs,extract-curated.mjs}`；scratch clone `/tmp/wp10r2/scratch`。

```text
$ git rev-parse HEAD; git rev-parse HEAD^{tree}; git status --porcelain
c53b28dd5c97a3f106d467c518ea2e179e8f7dca
4512743845e31503e77eb35728b28cd4a50f39f0
                                            # 初始为空（干净）

$ node -e 'import("./scripts/lib/acceptance-binding.mjs").then(...)'      # 冻结树绑定
{ "gitHead":"c53b28d…", "gitTree":"4512743…",
  "codeDigest":"sha256:0949e14614c98d17398d1f3c8227d7cd3bc8b16971a3ceb532ebfc77ac545e5f",
  "codeFiles":252, "dirty":false }
records: acceptance-results.json / e2e-results.json / live-results.json  codeDigest match: true
records gitHead: 5ad533e…  (≠ c53b28d)   current gitHead: c53b28d

$ bash /tmp/wp10r2/contracts.sh                # 十条命令 + live 网络探针
install exit=0 | typecheck exit=0 | lint exit=0
unit: Test Files 55 passed (55) / Tests 1105 passed (1105)            EXIT=0
integration: Test Files 26 passed (26) / Tests 311 passed (311)       EXIT=0
  ✓ runs a container read through Docker and reports the real non-root account 10176ms
  ✓ keeps the frozen source read-only inside the real container (AC-048, AC-050) 7037ms
e2e: 20 checks — PASS 16 / FAIL 0 / UNVERIFIED 4 ; 23 ACs accounted   EXIT=0
acceptance: evidence binding sha256:0949e14614c9… (HEAD c53b28d, 252 code files)
acceptance: 94/94 ACs accounted — PASS 83 / ACCEPTED 11 / FAIL 0 / MISSING 0
acceptance: OK — every AC is PASS or a registered, condition-checked accepted gap   EXIT=0
live(probe): UNVERIFIED — 0 real Provider calls were made              EXIT=3
docs:check ok — 15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages  EXIT=0
build: 12 × "build: Done"                                             EXIT=0
doctor: All checks passed                                             EXIT=0
netprobe selftest events=5        # 探针确实能捕获真实连接
live net events: （未生成事件日志文件）⇒ 0 次网络调用

$ node scripts/acceptance.mjs --report /tmp/wp10r2/forged-acceptance.md --json /tmp/wp10r2/forged-acceptance.json
# 伪造：.agentdev/work/WP-10/live-results.json 的 AC-001 = PASS（evidence 写 FORGED…）
acceptance: 94/94 ACs accounted — PASS 83 / ACCEPTED 11 / FAIL 0 / MISSING 0
acceptance: OK — every AC is PASS or a registered, condition-checked accepted gap        EXIT=0
AC-001: status=UNVERIFIED accepted=true drills=[e2e UNVERIFIED, live UNVERIFIED]  problems=[]

$ for f in --drill-report --drill-out --drills; do node scripts/acceptance.mjs $f x --no-write; echo exit=$?; done
unknown option: --drill-report        exit=2
unknown option: --drill-out           exit=2
unknown option: --drills              exit=2

$ node /tmp/wp10r2/probe-gaps.mjs
RESIDUAL_GAPS keys: AC-001,AC-002,AC-007,AC-010,AC-037,AC-041,AC-043,AC-052,AC-071,AC-073,AC-076
no Provider   : counts {"PASS":83,"ACCEPTED":11,"FAIL":0,"MISSING":0} unaccepted=0
Provider set  : counts {"PASS":83,"ACCEPTED":6,"FAIL":5,"MISSING":0}
                unaccepted: AC-001/007/010/037/041 条件失效(provider-absent) ⇒ exit 1

$ node /tmp/wp10r2/probe-release-gate.mjs
stale generatedAt            → available=false（拒绝旧结果）
wrong codeDigest             → available=false
drillsExecuted=false         → available=false
future ts + digest + drills  → available=true, pass=94        ← W10R2-03

$ node /tmp/wp10r2/probe-zerotest.mjs        # 节选
### A 文件消失  : unexecuted=["apps/daemon/test/protocol.integration.test.ts"] ⇒ 非 0
### B 零用例文件: unexecuted=[] ; AC-090 MISSING ⇒ 非 0（靠 AC 级）
### E 零用例+另一通过: unexecuted=[] ; AC-090 PASS ⇒ 若其余正常则 exit 0

# 绑定稳定性（scratch clone）
D0 0949e146… | D1 641bf26b…(新增未跟踪文件) | D2 641bf26b…(git add) | D3 641bf26b…(git commit)
D4 4abb95c1…(真实编辑) | D5 641bf26b…(还原)

# 凭证遮蔽
$ AGENTDEV_PROVIDER_BASE_URL='http://user:pass@127.0.0.1:1/v1' AGENTDEV_PROVIDER_SECRET=sk-WP10R2-… \
    node scripts/live.mjs --no-write --drill-out /tmp/wp10r2/leak.json
EXIT=1 ; secret 命中 stdout/stderr=0 ; drill JSON=0 ; userinfo=0

# 映射质量
$ grep -rn "unpushed" apps/web/src            → 0 命中（AC-090 界面子句未实现）
$ sed -n '591,606p' apps/daemon/test/protocol.integration.test.ts
  it('cancels a Queued requirement without Work and refuses to pause it (AC-068)', …)
  expectRefusal(() => call('work.control', {action:'cancel', …}), 'INVALID_STATE')
$ sed -n '2107,2115p;1310,1316p' apps/web/test/workbench-failures.integration.test.ts   # 订阅扩大，与断开无关
$ grep -n "expectedRevision\|VERSION_CONFLICT" packages/workspace/test/cas.integration.test.ts | head
  427: refuses a stale writer with VERSION_CONFLICT …  446: expectedRevision: revision …  485: expect(refused.code)…

# 还原：本 Review 实验期间被重写的记录文件
$ git checkout -- .agentdev/work/WP-10/acceptance.md .agentdev/work/WP-10/acceptance-results.json \
                 .agentdev/work/WP-10/e2e.md .agentdev/work/WP-10/e2e-results.json \
                 .agentdev/work/WP-10/live.md .agentdev/work/WP-10/live-results.json
# 其余工作区改动（scripts/、packages/）由修复作者持有，本 Review 未触碰
```
