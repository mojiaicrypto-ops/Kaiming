# WP-02 独立 Review 报告（第十八轮）

- 评审对象：工作包 WP-02「主管与独立Agent调度」
- 评审轮次：**第十八轮**（第十七轮 Review PASS → 独立 Test 判 FAIL：T-01/P1 → 开发修复 `3506630` 并提交 Test 报告 `b9a2d12` → 本轮复核 T-01 是否真修好、是否引入回归、同类模式是否仍在别处）
- 冻结点：git `b9a2d12`（`docs(test): WP-02 independent test report, round 1 (FAIL: T-01)`），父提交 `3506630`（`fix(core): do not freeze a null secretRef (WP-02 Test T-01)`）
- HEAD 校验：`git rev-parse HEAD` = `b9a2d1242bb7ea0ca950741b1be14b76cf32468d`；`git log -1` = `b9a2d12 docs(test): WP-02 independent test report, round 1 (FAIL: T-01)`
- 工作树：复核开始、每组实验前、全部契约命令后、本报告写入前 `git status --porcelain` 均无输出（干净；`pnpm build` 只写被 `.gitignore` 忽略的 `dist/`）
- 评审角色：Review（独立上下文，未读取任何开发或 Test 会话对话；只依据仓库文件、git 对象与我自己的实验）
- 权威依据：`AGENTS.md`、`docs/rules/{workflow,agents}.md`、`docs/architecture/{ARCHITECTURE,data,protocol,reliability,context,execution}.md`、`docs/delivery/{implementation,acceptance}.md`（WP-02 与 AC-043/044/045/046/047/082）、`.agentdev/work/WP-02/{plan,discovery,implementation,review,test}.md` 全部记录、`packages/core/src` 全部 17 个文件、`packages/core/test` 全部 10 个文件、`packages/contracts/src/entities/structures.ts`、`packages/domain/src/routing.ts`、`packages/storage/src/{repository,snapshots 相关}.ts`
- 方法：逐行核对「注释/记录/提交信息声称」与代码；在 `/tmp/wp02r18/` 自建夹具与 3 组实验脚本（`lib.mjs`、`exp1..exp3.mjs`），用 `pnpm build` 产出的 `packages/*/dist` 独立复现（软链 `/tmp/wp02r18/node_modules/@agentdev/*`）；**不修改产品代码、测试、`docs/**`、`plan/implementation/discovery/test`**
- 工具：`node v24.8.0`、`pnpm 12.3.4`、macOS（宿主执行）

---

## 0. 历史轮次结论摘要（保留，第一至十七轮）

| 轮次 | 冻结点 | 结论 | 计数 |
|---|---|---|---|
| 第一轮 | `785bdd6` | FAIL | 1×P1、5×P2、7×P3（R-01..R-13） |
| 第二轮 | `c4763d5` | FAIL | 0×P1、5×P2、6×P3（N-01..N-11） |
| 第三轮 | `a8daa6d` | FAIL | 1×P1、2×P2、2×P3（M-01..M-05）＋对抗性 D1..D5 |
| 第四轮 | `411d04f` | FAIL | 0×P1、3×P2、7×P3（Q-01..Q-10）＋对抗性 H-01..H-03 |
| 第五轮 | `5a87a86` | FAIL | 0×P1、5×P2、9×P3（R5-01..R5-14）＋对抗性 M-1..M-4 |
| 第六轮 | `0211ced` | FAIL | 1×P1、2×P2、7×P3（R6-01..R6-10） |
| 第七轮 | `f02aca4` | FAIL | 0×P1、2×P2、6×P3（R7-01..R7-08）＋对抗性补出 R7-09 |
| 第八轮 | `328ee60` | FAIL | 0×P1、3×P2、6×P3（R8-01..R8-09） |
| 第九轮 | `328ee60` | FAIL | 0×P1、1×P2、5×P3（R9-01..R9-06）＋对抗性漏项 A/B/C |
| 第十轮 | `e125bb7` | FAIL | 0×P1、2×P2、5×P3（R10-01..R10-07） |
| 第十一轮 | `080aa4c` | FAIL | 0×P1、2×P2、3×P3（R11-01..R11-05） |
| 第十二轮 | `fec9a9d` | FAIL | 0×P1、2×P2、3×P3（R12-01..R12-05）＋对抗性两项 |
| 第十三轮 | `e3b210c` | FAIL | 0×P1、3×P2、3×P3（R13-01..R13-06） |
| 第十四轮 | `9f62582` | FAIL | 0×P1、1×P2、4×P3（R14-01..R14-05）＋对抗性 D-1..D-4 |
| 第十五轮 | `088bdd7` | FAIL | 0×P1、1×P2、3×P3（R15-01..R15-04）；阻断项 R15-01 |
| 第十六轮 | `f2cb657`（修复 `546593d`） | **PASS** | 0×P1、1×P2（非阻断，R16-01）、5×P3（R16-02..R16-06）；同轮对抗性核验异议 M-1/M-2 |
| 第十七轮 | `3dc12db`（修复 `c695fcc`） | **PASS** | 0×P1、0×P2、5×P3（R17-01..R17-05）；第十六轮三项异议（R16-01 主诉、M-1、M-2）全部真实闭合，R15-01 未回退 |
| （第七轮之后）独立 Test 第一轮 | `17dfe26` | **FAIL** | AC-043 不通过：T-01（P1）——无 `secretRef` 的 Provider 冻结成 `null`，每次调用 `CONFIG_INVALID`；其余 5 条 AC 通过；自建 51 断言 0 失败 |

**各轮要点**：本轮不重复；第十七轮报告正文见 `git show 17dfe26:.agentdev/work/WP-02/review.md`，第一、二轮原文见第二轮报告 §0，依此回溯。

**追溯口径（沿用第五轮 DC-53/DC-56 与第十五至十七轮口径）**：行为/需求缺失＝P1（阻断）；局部质量/维护＝P2；建议＝P3。P2/P3 是否阻断由本轮按 `workflow.md` §6（第 65 行）「影响验收则阻断」判定。**L3/授权门禁类缺陷沿用 R9-01..R15-01 的 P2 标定。**

**R17-01..R17-05 的关闭状态（本轮实读复核）**：`79790e0` 已逐条关闭——R17-01 → `discovery.md:277` DC-72；R17-02 → `discovery.md:247/:255` 现为 `['edit','write','git']`；R17-03 → `discovery.md:227`；R17-04 → `orchestrator.ts:270` 的 `environmentScope`；R17-05 → `routing.ts:151-160` 注释已改并注明 R17-05。**五条全部关闭 ✓**。

---

## 1. 本轮结论

**PASS（Review Passed）——Test T-01（P1：无 `secretRef` 的 Provider 冻结成 `null` 导致每次调用 `CONFIG_INVALID`）已在 `3506630` 上真实修好并被我独立复现验证；有 `secretRef` 的路径与 `testConnection` 不受影响、两条路径结论一致；未发现阻断性回归。本轮新增 0×P1、2×P2（R18-01、R18-02，均非阻断）、2×P3（R18-03、R18-04）；建议进入重新独立 Test。**

三条主判据的独立证据：

1. **无 `secretRef` 的 Provider 能完成调用**：`exp1` A7（`complete()` → `{ok:true,'pong'}`）、`exp2` 3b/3c（**经真实 `Orchestrator.dispatch` 建立的 Chief Run 与专业 Run** 都能完成调用）、3f（重启后仍成功）。
2. **冻结快照真的不含该键**：`exp1` A3/A4（`readFrozen().provider` 无 own property `secretRef`）、A5（**SQLite 原始 payload 字符串**不含 `secretRef`）、A6/E1（也不含任何 `null` 字面量）、`exp3` P1（冻结 provider 恰为 providerId/type/baseUrl 三键）。
3. **有 `secretRef` 的路径不受影响、`testConnection` 一致**：`exp1` B1（原始 payload 记录 `secretRef`）、B2/B3（解析出 `sk-test` 并下发）、C1–C4（密钥取不到时仍 `CONFIG_INVALID` 且 0 次 transport 调用，`testConnection` 同结论）、A12/A13（匿名 `testConnection` 成功且不带 apiKey）。

修复提交 `3506630` 只改 `packages/core/src/config.ts`（冻结投影省略缺省键）、`packages/core/test/model-gateway.test.ts`（+1 条回归用例）与 `implementation.md`（T26 记录），`git show --stat 3506630` 确认无其它运行代码触碰；契约命令 6/6 退出 0（unit **252** = 251+1，integration 124）。

---

## 2. 契约命令原始结果（本轮实跑）

执行方式：`export PATH="$HOME/.local/bin:$PATH"`，在仓库根目录**按序**执行，日志 `/tmp/wp02r18/commands.log`。

| 命令 | 退出码 | 原始结果要点 |
|---|---|---|
| `pnpm typecheck` | **0** | `tsc -p tsconfig.json --pretty false`，无输出 |
| `pnpm lint` | **0** | `node scripts/lint.mjs`：`Checking formatting...` / `All matched files use Prettier code style!` |
| `pnpm test:unit` | **0** | `Test Files 17 passed (17)` / **`Tests 252 passed (252)`** / `Duration 7.69s`（= Test 冻结点的 251 + 1 条新回归用例） |
| `pnpm test:integration` | **0** | `Test Files 10 passed (10)` / **`Tests 124 passed (124)`** / `Duration 90.94s`（含真实容器与 doctor 检查） |
| `pnpm docs:check` | **0** | `docs:check ok — 15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages` |
| `pnpm build` | **0** | `packages/{contracts,domain,storage,core,pi-runtime}`、`apps/{cli,runner}` 共 7 个 workspace `build: Done` |
| `git status --porcelain` | — | 开始、每组实验后、全部契约命令后、本报告写入前均**无输出**（干净） |
| `git rev-parse HEAD` | — | `b9a2d1242bb7ea0ca950741b1be14b76cf32468d`（= 冻结点） |

**自建实验（观察值记录；标记即 Finding 证据）**：
`exp1`（T-01 复核：匿名 provider × resolve/freeze/readFrozen/原始 payload/complete/testConnection/重启/显式 undefined/双角色独立）**35 passed / 0 failed / 1 INFO**；`exp2`（旧快照兼容 + `null` 写入拒绝 + Orchestrator 端到端 + dispatch 载荷无 null）**15 / 0（3 INFO）**；`exp3`（回归用例有效性证明：旧 payload 重现 T-01、新冻结形状三键）**6 / 0**。合计 **56 条断言、0 失败**。脚本与日志：`/tmp/wp02r18/{lib,exp1,exp2,exp3}.mjs`、`experiments.log`、`commands.log`；全部消费 `pnpm build` 后的 `packages/*/dist`，通过软链解析 workspace 包，**不 import 任何产品测试文件**。

---

## 3. T-01 复核（逐项：Test 的 D1–D6 是否闭合）

| Test 断言 | 修复后的独立观察值（本轮） | 判定 |
|---|---|---|
| D1 未配 `secretRef` 仍可 `availability`/`dispatch` | `exp1` A1 `availability.ok === true`；`exp2` 3a `configSnapshotId` 为 64 位 hash，Run 正常创建 | 保持 ✓ |
| D2 冻结投影把缺省写成 `null` | **已反转**：`exp1` A3–A6 / `exp3` P1/P6 —— `readFrozen().provider` 无 `secretRef` own key，SQLite 原始 payload 不含 `secretRef`、不含任何 `null` | **修好 ✓** |
| D3 `complete()` 被拒 | **已反转**：`exp1` A7/A8/A9/A10 —— `{ok:true}`、transport 恰 1 次、请求**无 `apiKey` 键**（`hasOwnProperty === false`） | **修好 ✓** |
| D4 对照组（配 `secretRef`） | `exp1` B1–B3：payload 含 `"secretRef":"local-secret"`，`apiKey='sk-test'` 正常下发；`exp2` 3d 逐调用核对键存在性 | 不受影响 ✓ |
| D5 负例对照（`secretRef` 存在但取不到值） | `exp1` C1–C4：仍 `CONFIG_INVALID: secret MISSING_KEY is not available`，0 次 transport 调用，`testConnection` 同结论、同样 0 调用 | 不受影响 ✓ |
| D6 重启后复现 | **已反转**：`exp1` D1–D3（重开库后 readFrozen 无键、`complete()` 成功、原始 payload 无 `secretRef`）；`exp2` 3e/3f（真实 restart 后 `recoveryView` 的冻结 provider 无键、调用成功） | **修好 ✓** |

补充复核（Test 未覆盖的角度）：

- **显式 `secretRef: undefined`** 与「键缺省」等价：`exp1` E1–E4（冻结省略、`secretConfigured=false`、磁盘 `config.toml` 省略、调用成功）。
- **`testConnection` 一致性**：`exp1` A12/A13（匿名 → `{ok:true,latencyMs:0}` 且无 apiKey）、C3/C4（缺 Secret → 同一错误串且 0 调用）。Test 指出的「实时配置与冻结路径结论相反」已消失。
- **回归用例确实能抓住旧行为**：`exp3` P2–P4 —— 把修复前 `freeze()` 会写出的同形 payload（`secretRef:null`）重新冻结后，`readFrozen().provider` 确实带 own key `secretRef:null`，`complete()` 精确重现 `{ok:false,code:'CONFIG_INVALID',message:'secret null is not available'}`。即 `model-gateway.test.ts:149` 的 `not.toHaveProperty('secretRef')` 在修复前必然失败，这条守卫是真的。
- **AC-043 独立性未受影响**：`exp1` H1–H6 —— 同一时刻两个角色（一匿名、一带 Secret）冻结出不同快照，各自 baseUrl/apiKey 正确，互不串用。

---

## 4. 回归扫描与「同类模式」扫描

### 4.1 回归面

修复提交的差异面**仅**为 `packages/core/src/config.ts` 的冻结投影、1 条测试用例与 `implementation.md` 记录。`config.ts` 的其余投影（`:136` `toToml`、`:448` `resolve`）在修复前**已经**使用「缺省即省略」，本次只是把 `freeze`（`:493-500`）对齐；因此：

- 快照哈希只对「无 Secret 的 Provider」变化，且内容寻址快照不可变：修复前写下的行仍按原 hash 可读（`exp2` 1 证明其可读、只是网关仍拒绝，见 R18-02）；
- `availability()`/`dispatch()` 走 `resolve()`，修复前就正常，现在与 `freeze()` 同源同形（`exp1` A2/A3 两处投影一致）；
- `pnpm test:unit` 252、`pnpm test:integration` 124 全绿；本轮未发现任何 AC-043/044/045/046/047/082 关联回归。

### 4.2 同类「`?? null` 冻结投影 vs `undefined` 判定」全量扫描

我把全仓 `?? null` / `|| null` 站点逐一与其消费者对照（grep 证据 + `exp2` 4a–4f 实跑）：

| 站点 | 性质 | 是否存在 `=== undefined` 判定 | 结论 |
|---|---|---|---|
| `config.ts:492-500`（**已修**） | 冻结权威（config snapshot） | `model-gateway.ts:125/128` | **T-01 的唯一现场，已闭合** |
| `orchestrator.ts:542` `parentRunId: null`（`run.queued` 事件） | 事件 data | 否（仓内无消费者读该字段做 undefined 判定；DB 行由 `repository.ts:112` 把 NULL 解码成 `undefined`，`exp2` 4c 实测 Chief Run 的 `parentRunId === undefined`） | 无缺陷 |
| `orchestrator.ts:607` `reason: null`（`request_dispatch` 指纹/事件） | 事件 data | 否 | 无缺陷 |
| `orchestrator.ts:805/813/819/867` `level: level ?? null` | 错误 details | 否 | 无缺陷 |
| `join.ts:262-264` `stageResult: … ? null : {…}` | 事件 data；`join.ts:308` 用 `??` 归一读取 | 否 | 无缺陷 |
| `run-lifecycle.ts:137` `runnerId: null` | 事件 data | 否 | 无缺陷 |
| `run-lifecycle.ts:250` `(recordedCost ?? null) === (usage.cost ?? null)` | **两侧都做 nullish 归一** | — | **正确范式**（与 T-01 相反方向的反例：读取端归一，故 `:390` 的显式 null 是安全的） |
| `run-lifecycle.ts:260/262/288/390` `cost: null` | 错误 details / 事件 data | `:247` 读取处已 `?? null` 归一 | 无缺陷 |
| `events-hub.ts:432/445/455/468` `project/work/run/conversation ?? null` | 协议订阅快照（「不存在」标记） | 否 | 无缺陷 |
| `apps/runner/src/cli.ts:76` `modelsPath ?? null` | CLI 选项 | 否 | 无关 |

**判定依据**：唯一对**冻结载荷**（JSON 文本列，`null` 会原样保留而非像实体列那样解码成 `undefined`）做 `=== undefined` 判定、且不先做 nullish 归一的消费者，是 `model-gateway.ts` 的 `secretRef`（`grep -rn "readFrozen\|frozenProfileOf"` 显示仅 `orchestrator.ts:737`（只取 profile）与 `model-gateway.ts` 两处；`profile.temperature` 全仓无消费者）。**除已修的 `config.ts` 外，没有第二处同类「写入端 null、读取端判 undefined」的活跃缺陷。** 残留的是读取端本身的脆弱性（R18-02）。

---

## 5. 新 Findings（R18-01..R18-04）

### R18-01 [P2，非阻断] `FrozenProvider` 投影在 `resolve()` 与 `freeze()` 重复实现——T-01 正是两处漂移的产物

- **位置**：`packages/core/src/config.ts:444-449`（`resolve` 内构造 `frozenProvider`）与 `:492-500`（`freeze` 内逐字段重造同一投影）；`:478` 已解构出 `provider`，它**就是** `resolve` 返回的 `FrozenProvider`。
- **事实（git 对象 + 实读）**：`git show c4763d5:packages/core/src/config.ts` 显示第一轮修复把「缺省即省略」只加进了 `resolve`（当时 `:446`），`freeze`（当时 `:494`）保持 `secretRef: provider.secretRef ?? null`，两份投影并行存在了 17 轮；`3506630` 才把 `freeze` 对齐。`exp1` A2/A3 证明两者现在一致，但一致性靠人工同步维持。
- **影响**：纯维护性缺陷，当前无行为影响；但 R18-02 表明「投影漂移」的代价是 P1（每次调用失败），而 `resolve`/`freeze` 恰好是最容易被分别修改的两处。
- **建议**：`freeze` 直接使用已解构的 `provider`（或抽出 `frozenProviderOf(provider: ProviderConfig): FrozenProvider` 供两处调用），并在 `config.test.ts:206-239` 的 freeze 用例补一条「冻结 provider 恰为 providerId/type/baseUrl（+可选 secretRef）」的形状断言。
- **非阻断理由**：不改变任何观测行为，不影响 AC-043..047/082 的通过与否。

### R18-02 [P2，非阻断] `ModelGateway.complete` 仍只把 `undefined` 当「无需 Secret」；含 `secretRef: null` 的冻结载荷被判成「Secret 不可用」，且 `readFrozen` 不校验载荷

- **位置**：`packages/core/src/model-gateway.ts:125-135`（`frozen.provider.secretRef === undefined` / `!== undefined` 判定）；`packages/core/src/config.ts:521-540`（`readFrozen` 仅做类型断言，**不对 payload 做 Schema 校验**）。
- **事实（`exp2` 1、`exp3` P2–P5 实跑）**：把修复前 `freeze()` 会写出的同一 payload（`secretRef: null`）冻结后，`readFrozen().provider` 原样返回 `null`，`complete()` 返回 `{ok:false,code:'CONFIG_INVALID',retryable:false,message:'secret null is not available'}` 且 **0 次** transport 调用——与 T-01 的观察值逐字相同。即写入端已约定「缺省即省略」，读取端仍不接受语义等价的 JSON `null`。
- **影响**：对**新写入**的配置快照无影响（T-01 已闭合）；受影响的是 (a) 由修复前版本写下的快照（升级/`reliability.md` §8 的 `restore` 会整体复制 SQLite 快照），(b) 任何绕过 `ConfigStore.freeze` 的载荷（手工修复、未来 WP-05 等级/配置迁移），都会再次以**方向误导**的错误信息失败。`readFrozen` 不校验形状，使这类载荷不会被读侧拒绝。
- **建议**：(a) `complete()` 改为 nullish 归一（例如 `const ref = frozen.provider.secretRef ?? undefined;`，`testConnection` 同理），或 (b) 在 `readFrozen` 用 `FrozenProvider` 对应的运行时 Schema 解析 payload，把非法形状转成结构化的 `STALE_ARTIFACT`/`CONFIG_INVALID`，而不是让 `null` 冒充一个名为 `null` 的 Secret。
- **非阻断理由**：WP-02 尚未发布（`docs/INDEX.md:28` 的实现起点只结算到 WP-01），不存在携带旧快照的部署；所有受支持路径新写入的关键字都省略，AC-043 在受支持路径上成立。

### R18-03 [P3，非阻断] 回归用例只覆盖 `complete()`，未覆盖无 `secretRef` 的 `testConnection`；freeze 用例不校验冻结 provider 形状

- **位置**：`packages/core/test/model-gateway.test.ts:140-156`（新增用例，只调 `complete()`）；`:239-247`（`testConnection` 用例仍使用带 `secretRef: 'local-secret'` 的夹具，`:26`）；`packages/core/test/config.test.ts:206-239`（freeze 用例只断言 `role`/`effectiveContextLimit`/`reasoning`，无 provider 形状断言）。
- **事实**：我实测匿名 `testConnection` 行为正确（`exp1` A12/A13），但产品套件对该组合无守卫——Test 指出的「同配置两条路径结论相反」正是这类守卫缺失的后果。
- **建议**：补一条匿名 Provider 的 `provider.test` 用例（断言 `ok === true` 且 transport 请求无 `apiKey`），并把 `exp3` P1 的三键形状断言加入 `config.test.ts`。
- **非阻断理由**：仅测试覆盖度，不影响当前行为与验收。

### R18-04 [P3，非阻断] T-01 修复未在 `discovery.md` 登记 DC 条目（本包惯例为「修复登记」）

- **位置**：`.agentdev/work/WP-02/discovery.md`（DC-01..DC-72，无 T-01/冻结投影条目）；对照 `.agentdev/work/WP-02/implementation.md` 的 T26（已完整记录现象、根因、修复与验证）。
- **事实**：本包此前的每次缺陷/技术修正都有 DC 条目（DC-37 第一轮 RE-01..RE-13、DC-69 R13-03、DC-71/DC-72），T-01 只有 implementation 记录；且 R17-02 刚做过同族「记录 vs 代码」对齐。
- **影响**：可追溯性/记录一致性，不影响行为。
- **建议**：追加一条 DC（例如「DC-73 冻结投影的可选键：缺省即省略」），写明 `secretRef` 的约定、`resolve`/`freeze` 单一投影来源（R18-01）与读取端 nullish 对称性/升级恢复边界（R18-02），避免第二份口径继续漂移。

---

## 6. 其它观察（不计入 Finding 编号）

1. **`readFrozen` 无 Schema 校验**：`snapshot.payload` 仅受 `jsonObjectSchema`（「是 JSON 对象」）约束，`config.readFrozen`（`config.ts:524`）是类型断言而非解析；`FrozenProvider`（`config.ts:67-72`）只有类型、无运行时 Schema。这是 R18-02 的载体，也是「冻结形状」无法在读取时被拒绝的结构原因。
2. **`run-lifecycle.ts:250` 是同类问题的正确处理范式**：读取端对两侧都做 `?? null` 归一，因此 `:390` 的显式 `cost: null`（R7-02 有意保留）不会造成误判；建议 R18-01/R18-02 的修复沿用该范式（归一而非依赖书写习惯）。
3. **实体列的 `null ↔ undefined` 往返是对称的**：`packages/storage/src/repository.ts:112` 把 NULL 解码为 `undefined`，`:75` 把 `undefined` 编码为 NULL；因此 `orchestrator.ts:572`（`chiefRunId === undefined`）、`join.ts:168`（`child.parentRunId === undefined`）等判定安全（`exp2` 4c 实测确认）。**不对称只发生在 JSON 文本列（快照 payload）**——这是本轮扫描的关键结论。
4. **Test 报告的两条 P3 观察本轮仍成立**（沿其 §1/§6，非阻断）：`resolve` 对「模型不支持该 reasoning」返回 `CONFIG_INVALID`，而 `dispatch` 统一映射为 `PROVIDER_UNAVAILABLE`（`config.ts:426-431` vs `orchestrator.ts:458-466`）；`frozenProfileOf` 对快照缺失抛 `STALE_ARTIFACT` 而非 `NOT_FOUND`（`model-gateway.ts:99-111`，与缓存/恢复语义相关）。二者均属错误码/可观测性，建议归入 WP-10 协议面统一。
5. **`provider.upsert` 的 `secret?:string` 参数仍被忽略**（`protocol.md` §5 声明的入参，`config.ts:322` 的 `upsertProvider` 不消费它）：配置了 Secret 值但未给出 `secretRef` 的 Provider 会被当作匿名端点调用。这属 DC-31 已登记的 WP-07（Secret 存储）/WP-10 边界，本轮不计为缺陷，但建议 RP 接线时显式拒绝「给了 secret 却没有 secretRef」的输入，避免静默降级为无鉴权调用。
6. **产物归属**：修复提交 `3506630` 与 Test 报告提交 `b9a2d12` 分离，Review 报告将单独提交，符合「Review 产物与开发/测试提交分离」；`discovery.md`/`implementation.md` 的改动均属开发记录范围，本轮只读未改。
7. **记录数核对**：`implementation.md` T26 声称的 252/124 与我的实测一致；未声称 `docs:check`/`build`（本轮我补齐为 6/6 退出 0）。`docs/INDEX.md` 的实现起点仍只结算到 WP-01，未误称 WP-02 已实现（正确）。

---

## 7. 剩余风险（未闭环，供重新 Test / Settlement 与产品方判断）

1. **R18-01（新增，P2 非阻断）**：`resolve`/`freeze` 双份 `FrozenProvider` 投影，只靠人工同步；建议合并为单一来源。
2. **R18-02（新增，P2 非阻断）**：读取端不接受 JSON `null`；由修复前版本写入的配置快照在升级/`restore` 后仍会以误导性错误失败，`readFrozen` 也不校验载荷形状。未发布故当前无实际部署受影响。
3. **R18-03/R18-04（新增，P3）**：匿名 `testConnection` 无产品级守卫；T-01 修复未登记 DC 条目。
4. **测试缺口（本轮缩小）**：`complete()` 的匿名 Provider 正例已由新用例覆盖（我给 `exp3` 证明该用例确实能抓住旧行为）；仍缺「匿名 `testConnection` 正例」「修复前快照（`secretRef:null`）兼容负例」的产品级用例。
5. **沿前轮继续有效**：真实 Provider 纵向验证（真实 HTTP/usage/reasoning 映射）归 WP-10；daemon HTTP/WS 协议面归 WP-09/WP-10；AC-082 的工具层负例（重启后试读窄范围外文件被拒）归 WP-07；`provider.upsert` 的 Secret 本体存储与 `secretRef` 绑定归 WP-07/WP-10（DC-31）。
6. **产品待决项（沿前轮）**：DC-60（`Assessment.goal`/`scope` 是否落库）、DC-64（风险旗标词表是否升为契约枚举）、DC-70（`l3Paths`/`l3Keywords` 判定语义）、DC-27/RE-06（快照 `:ID` 与 hash 并存）、DC-46（`dispatch` 不校验 `work.status`）、R17-01 登记后的 WP-06 等级升级路径。
7. **并发未验证（沿前轮）**：预算准入检查与事务内 `reserve` 之间的窗口；`timed_out`/`interrupted`/`recovery_required` 终态无产生路径、`onChildSettled` 无生产调用方、`Work blocked(provider)` 投影属 WP-05。

---

## 8. 方法与边界声明

- 本报告只依据仓库文件、`b9a2d12`/`3506630` 上的 git 对象与差异、以及我自己执行的命令；未读取任何开发或 Test 会话对话，未引用外部同名技能或历史方案。
- 阅读深度：`packages/core/src/config.ts`（全文件逐行，重点 `:130-180`、`:320-360`、`:390-540`）、`model-gateway.ts`（全文）、`orchestrator.ts`（全文逐行，重点 `:245-345`、`:355-550`、`:560-750`、`:756-1006`）、`stage.ts`/`join.ts`/`run-lifecycle.ts`/`snapshots.ts`/`events.ts`（全文），`dispatcher.ts`/`auth.ts`/`identity.ts`/`requirements.ts`/`mailbox.ts`/`errors.ts`/`events-hub.ts`/`toml.ts` 按注释声称与 `?? null`/`undefined` 判定点抽查；`packages/core/test/{model-gateway,config,orchestrator}.test.ts`；`packages/contracts/src/entities/structures.ts`（`:120-175`）、`packages/domain/src/routing.ts`（`:145-200`）、`packages/storage/src/repository.ts`（`:70-130`）；`docs/architecture` 六篇、`docs/rules/workflow.md`、`docs/rules/agents.md`（系统注入全文）、`docs/delivery/implementation.md` WP-02、`docs/delivery/acceptance.md` AC-043..047/082、`.agentdev/work/WP-02/{plan,discovery,implementation,review,test}.md` 全部通读。
- 覆盖的手段：静态逐行核对 + 「记录/注释/提交信息 vs 代码」对账 + 冻结投影 8 维真值表（`exp1`）+ 旧快照兼容与 Orchestrator 端到端（`exp2`）+ 回归用例有效性反证（`exp3`）+ 全仓 `?? null` 站点与消费者对照表 + `git show` 历史回溯（`c4763d5`/`3506630`）。
- 唯一写入文件为本文件 `.agentdev/work/WP-02/review.md`；实验脚本与日志独立写在 `/tmp/wp02r18/`（`lib.mjs`、`exp1..exp3.mjs`、`experiments.log`、`commands.log`），使用 `pnpm build` 产出的 `packages/*/dist`，通过 `/tmp/wp02r18/node_modules/@agentdev/*` 软链解析 workspace 包，**不 import 任何产品测试文件**。
- 未修改产品代码、测试、`docs/**`、`plan.md`、`implementation.md`、`discovery.md`、`test.md`；`pnpm build` 只写 `.gitignore` 中的 `dist/`。写入本报告前 `git status --porcelain` 无输出、`HEAD=b9a2d1242bb7ea0ca950741b1be14b76cf32468d`。
