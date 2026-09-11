# WP-02 独立 Review 报告（第十九轮）

- 评审对象：工作包 WP-02「主管与独立Agent调度」
- 评审轮次：**第十九轮**（第十八轮 Review PASS@`a0b522d`（冻结 `b9a2d12`）→ 开发在 `cbf7471` 补修 R18-01/R18-02/R18-05＋model 价格投影 → 第二轮独立 Test PASS@`267751a` 指出 O1「`cbf7471` 无配套独立 Review」→ 本轮对代码树做独立 Review）
- 冻结点：git `267751a`（`docs(test): WP-02 independent test report, round 2 (PASS)`）；**代码树等同 `cbf7471`**（`git diff --name-only cbf7471 HEAD` 仅 `.agentdev/work/WP-02/{review,test}.md`；`git diff --quiet cbf7471 HEAD -- packages apps scripts docs package.json` 无差异）
- HEAD 校验：`git rev-parse HEAD` = `267751a17fbf859324ad81c746a215947e321152`；`git log -1` = `267751a docs(test): WP-02 independent test report, round 2 (PASS)`
- 工作树：复核开始、每组实验前后、全部契约命令后、本报告写入前 `git status --porcelain` 均无输出（干净；`pnpm build` 只写被 `.gitignore` 忽略的 `dist/`）
- 评审角色：Review（独立上下文，未读取任何开发或 Test 会话对话；只依据仓库文件、git 对象与我自己的实验）
- 权威依据：`AGENTS.md`、`docs/rules/{workflow,agents}.md`、`docs/architecture/{ARCHITECTURE,data,protocol,reliability,context,execution}.md`、`docs/delivery/{implementation,acceptance}.md`（WP-02 与 AC-043/044/045/046/047/082）、`.agentdev/work/WP-02/{plan,discovery,implementation,review,test}.md` 全部记录、`packages/core/src` 全部 17 个文件、`packages/core/test` 全部 10 个文件、`packages/contracts/src/entities/structures.ts`、`packages/storage/src/{repository,store,schema}.ts`
- 方法：逐行核对「注释/记录/提交信息声称」与代码；在 `/tmp/wp02r19/` 自建夹具与 4 组实验（`lib.mjs`、`exp1..exp4.mjs`），全部通过软链 `/tmp/wp02r19/node_modules/@agentdev/*` 消费 `pnpm build` 产出的 `packages/*/dist`，**不 import 任何产品测试文件**；**不修改产品代码、测试、`docs/**`、`plan/implementation/discovery/test`**
- 工具：`node v24.8.0`、`pnpm 12.3.4`、macOS（宿主执行）、Docker 28.4.0（integration 用）
- 关键文件哈希（`git hash-object`）：`config.ts` `7872b64d…`、`model-gateway.ts` `82ac4fa0…`、`model-gateway.test.ts` `3dba7c10…`、`discovery.md` `36b3e372…`、`implementation.md` `853ee963…`

---

## 0. 历史轮次结论摘要（保留，第一至十八轮）

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
| 第十七轮 | `3dc12db`（修复 `c695fcc`） | **PASS** | 0×P1、0×P2、5×P3（R17-01..R17-05）；第十六轮三项异议全部真实闭合，R15-01 未回退 |
| （第七轮之后）独立 Test 第一轮 | `17dfe26` | **FAIL** | AC-043 不通过：T-01（P1）——无 `secretRef` 的 Provider 冻结成 `null`，每次调用 `CONFIG_INVALID` |
| 第十八轮 | `b9a2d12`（父 `3506630`） | **PASS** | 0×P1、2×P2（R18-01、R18-02）、2×P3（R18-03、R18-04）；T-01 真修好；建议重新独立 Test |
| （第七轮之后）独立 Test 第二轮 | `cbf7471` | **PASS** | 6/6 AC 通过（AC-082 含 1 项 UNVERIFIED→WP-07）；73 断言 0 失败；提出 O1（`cbf7471` 无配套独立 Review） |

**第十八轮结论摘要（本轮评审的直接对象，原文见 `git show a0b522d:.agentdev/work/WP-02/review.md`）**：判 PASS，确认 T-01（P1）在 `3506630` 上真修好且无阻断回归；新增 R18-01（P2：`resolve`/`freeze` 双份 `FrozenProvider` 投影）、R18-02（P2：`complete()` 只认 `undefined`、`readFrozen` 不校验形状）、R18-03（P3：匿名 `testConnection` 无守卫、freeze 用例无 provider 形状断言）、R18-04（P3：T-01 未登记 DC）。**该报告不含 R18-05**（`grep -c R18-05` = 0，本轮实测），R18-05 由同轮对抗性核验补出、只落在 `cbf7471` 的 `discovery.md`/`implementation.md`。

**追溯口径（沿用第五轮 DC-53/DC-56 与第十五至十八轮口径）**：行为/需求缺失＝P1（阻断）；局部质量/维护＝P2；建议＝P3。P2/P3 是否阻断由本轮按 `workflow.md` §6「影响验收则阻断」判定。

---

## 1. 本轮结论

**PASS（Review Passed）——`cbf7471` 对 R18-01/R18-02/R18-05 与 model 价格投影四项补修全部真实、可独立复现，未发现行为回归；第二轮 Test 的 O1（缺配套独立 Review）由本报告闭合。本轮新增 0×P1、1×P2（R19-01，非阻断）、2×P3（R19-02、R19-03）；WP-02 具备进入结算（Settlement）的条件。**

四条主判据的独立证据（全部为我自建脚本的原始观察值）：

1. **R18-01 单一投影为真**：`resolve().resolution.provider` 与 `freeze()` → `readFrozen().provider` 在匿名与配密两条路径上**深度相等**（`exp1` A3/B2、`exp4` B 8/8）；匿名投影恰为 `providerId/type/baseUrl` 三键（`exp1` A2/A4、`exp2` A2）；同一状态在全新世界里冻结得到**逐字节相同**的 hash（`exp1` F1：`3352d55a…` = `3352d55a…`）。
2. **R18-02 归一为真**：历史/外来 `secretRef: null` 快照被 `readFrozen` 归一为「无 Secret」（`exp2` A1/A2、`exp4` A `null` 行），该 Run 可成功 `complete()` 且 transport 请求**无 `apiKey` 键**（`exp2` A3/A4），resolver **从未被以 `null` 查询**（`exp2` A5 `asked=[]`）；写入端复现不了该形状（`exp2` C1：`upsertProvider({secretRef:null})` 被 `providerInputSchema` 拒绝；`exp4` A2：`freeze` 拒绝含 `undefined` 的载荷）。
3. **R18-05 凭证可用性为真**：注入 resolver 且 `secretRef` 取不到时，`availability` 返回 `{ok:false,code:'CONFIG_INVALID',reason:'secret MISSING_KEY is not available'}`（`exp3` A1–A3），`Orchestrator.dispatch` 以 `PROVIDER_UNAVAILABLE` 拒绝且 **run 行 0→0、snapshot 行 0→0**（`exp3` A5–A8，与 Test 的 1→1/3→3 同结论）；未注入 resolver 时保持放行、调用依旧 fail-closed（`exp3` B1–B4）；匿名 Provider 在注入 resolver 时不被误伤（`exp3` C1–C4，resolver 0 次调用）。
4. **价格投影为真**：`inputPricePerMTokens:3`/`outputPricePerMTokens:15` 在有价模型上被写入冻结载荷并原样读回，`resolve()` 与 `readFrozen()` 的 `model` 深度相等（`exp1` B3/B4/B6）；无价模型**省略键而非写 `null`**（`exp1` C1），原始 payload 亦不含 `null`（`exp1` A7）。

契约命令 **6/6 退出 0**（typecheck 0、lint 0、unit **255 passed**、integration **124 passed**、docs:check ok、build 7 工程 Done）；自建实验 **71 条断言、0 失败**；`git status` 全程干净、`HEAD=267751a`。**未发现任何 AC-043/044/045/046/047/082 关联回归。**

**结论去向**：按 `workflow.md` §6，R19-01（P2）与 R19-02/R19-03（P3）均不影响 WP-02 的 6 条 AC，**不阻断**；建议在 Settlement 清单的「剩余风险/unresolved」中登记 R19-01，并把「读取面统一 Schema 校验」写入 WP-08/WP-09 承接（DC-73 已声明该承接）。

---

## 2. 契约命令原始结果（本轮实跑）

执行方式：仓库根目录按序执行，日志 `/tmp/wp02r19/{typecheck,lint,unit,integration,docscheck,build}.txt`。

| 命令 | 退出码 | 原始结果要点 |
|---|---|---|
| `pnpm typecheck` | **0** | `tsc -p tsconfig.json --pretty false`，无输出 |
| `pnpm lint` | **0** | `node scripts/lint.mjs`：`Checking formatting...` / `All matched files use Prettier code style!` |
| `pnpm test:unit` | **0** | `Test Files 17 passed (17)` / **`Tests 255 passed (255)`** / `Duration 2.19s` |
| `pnpm test:integration` | **0** | `Test Files 10 passed (10)` / **`Tests 124 passed (124)`** / `Duration 54.62s`（含真实容器与 doctor 检查） |
| `pnpm docs:check` | **0** | `docs:check ok — 15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages` |
| `pnpm build` | **0** | `packages/{contracts,domain,storage,core,pi-runtime}`、`apps/{cli,runner}` 共 7 个 workspace `build: Done` |
| `git status --porcelain` | — | 命令前后均无输出（干净） |
| `git rev-parse HEAD` | — | `267751a17fbf859324ad81c746a215947e321152` |

`docs:check` 的三个计数（15 文档 / 94 验收用例 / 11 工作包）与 Test 报告一致；unit 255 = Test 第二轮实测值（= 第十八轮 252 + `cbf7471` 新增 3 条用例：R18-05 准入、历史 `null` 归一、匿名 `testConnection`），**数量对得上**。

**自建实验（观察值记录；标记即 Finding 证据）**：
`exp1`（单一投影 + 价格字段 + 三键形状 + 同状态 hash 幂等）**18 passed / 0 failed**；`exp2`（历史 `null` 归一 + 畸形载荷两条 TypeError + 严格 Schema 拒绝）**14 / 0**；`exp3`（`availability` 凭证校验 + Orchestrator 端到端准入 + 无 resolver 放行 + 匿名不误伤 + resolver 抛异常）**18 / 0**；`exp4`（`secretRef` 值域真值表 + 三路等价 + 双重解析 + 一次性凭证）**21 / 0**。合计 **71 条断言、0 失败**。脚本与日志：`/tmp/wp02r19/{lib,exp1,exp2,exp3,exp4}.mjs`。

`exp4` 值域真值表（`readFrozen` 对 `secretRef` 各取值的归一，原始输出）：

| 载荷写法 | `readFrozen().provider` 是否带 own key | 判定 |
|---|---|---|
| 键缺省 | 否 | 归一 ✓ |
| `null` | 否 | 归一 ✓（T-01/R18-02 的对象） |
| `""`（空串） | 是（`secretRef:""`） | 非 `null`，交给 resolver/上层 ✓ |
| `0` | 是 | 同上 ✓ |
| 对象 `{nested:true}` | 是 | 同上 ✓（形状由上层校验，R19-01） |
| 字符串 `"local-secret"` | 是 | 保留 ✓ |
| 显式 `undefined` | **不可达**：`SnapshotWriter.freeze` 直接 `CONSTRAINT_VIOLATION`（`jsonObjectSchema` 拒绝非 JSON 值） | fail-closed ✓ |

---

## 3. cbf7471 四项补修复核（逐条：声称 vs 代码 vs 实测）

| 条目 | 声称（commit / T27 / DC-73） | 代码实读 | 我的实测 | 判定 |
|---|---|---|---|---|
| R18-01 | 「`FrozenProvider` 投影收敛为 `frozenProviderOf` 单一实现（`resolve`/`freeze` 共用）」 | `config.ts:441` `const frozenProvider = frozenProviderOf(provider)`；`config.ts:491` `provider: { ...provider }`（即 `resolve` 已算好的那份）；`config.ts:536-543` 唯一实现 | `exp1` A3/A4/A5/B2/B3、`exp4` B 8/8：三路深度相等；匿名恰三键 | **真修好 ✓** |
| R18-02 | 「`readFrozen` 把历史 `secretRef: null` 归一为缺省，`complete()` 同样按 `?? undefined` 处理」 | `config.ts:511-515` 解构 `{ secretRef, ...provider }` 后仅在非 `null`/`undefined` 时回填；`model-gateway.ts:139` `frozen.provider.secretRef ?? undefined` | `exp2` A1–A5：归一、调用成功、无 `apiKey` 键、resolver 未被以 `null` 查询；`exp4` A 全表 | **真修好 ✓**（残留 R19-01） |
| R18-05 / DC-73 | 「`availability` 在注入 `SecretResolver` 时解析 `secretRef`，取不到即不可用；不注入保持放行」 | `model-gateway.ts:98-107`：`secretRef !== undefined && this.secrets !== undefined` 才解析，取不到返回 `CONFIG_INVALID` | `exp3` A1–A8（dispatch 拒且 0 写入）、B1–B4（无 resolver 放行、调用 fail-closed）、C1–C4（匿名不误伤） | **真修好 ✓**（新增边界见 O-3/R19-03） |
| 对抗性 3.2 | 「`model` 冻结投影保留可选价格字段，`resolve()` 与 `readFrozen()` 形状一致」 | `config.ts:552-571` `frozenModelPayload` 存在才写两个价格键 | `exp1` B3/B4/B6/C1、A5 | **真修好 ✓** |
| R18-03 | commit 称「tests: anonymous testConnection, frozen provider shape, legacy snapshot」 | `model-gateway.test.ts:210-218` 匿名 `testConnection` ✓、`:174-208` 历史快照 ✓；**`config.test.ts` 未被本提交触碰**（`git diff b9a2d12 cbf7471 --stat` 仅 `model-gateway.test.ts`） | 匿名 `testConnection` 守卫存在；「冻结 provider 形状断言」只有 `model-gateway.test.ts:150` 的 `not.toHaveProperty('secretRef')`，**没有** `config.test.ts` 三键形状断言 | **部分（记录口径不准，R19-02）** |
| R18-04 | 「新增 DC-73 登记」 | `discovery.md:281-287` DC-73 三条 | 覆盖 `secretRef` 省略/归一、凭证可用性、价格字段与承接；末句「保证不因此崩溃」过强 | **到位（措辞需收窄，R19-03）** |

**无回归的三条结构性证据**：

1. **改动面**：`git show --stat cbf7471` 仅 `discovery.md`（+7）、`implementation.md`（+11）、`config.ts`（+74/−31 行内的净增）、`model-gateway.ts`、`model-gateway.test.ts`；未触碰其他运行代码、`docs/**`、其他包。
2. **向后兼容**：`frozenProviderOf` 与旧 `freeze` 写法对「有 `secretRef`」的 Provider 产出**同一对象**；仅「无 `secretRef`」的快照 hash 变化（`3506630` 已如此），且快照内容寻址不可变，旧 hash 仍可读（`exp2` A 用旧形状 hash 读取成功）。
3. **三路一致**：`resolve()`、`freeze().resolution`、`readFrozen()` 的 `provider`/`model` 在匿名与有价两条路径全部深度相等（`exp1`/`exp4` B），即 R18-01 的「单一来源」不是注释而是可观测事实。

---

## 4. 「记录 vs 代码」核对（本轮任务项 2）

| 记录 | 声称 | 代码/实测 | 裁定 |
|---|---|---|---|
| `implementation.md` T27 | typecheck/lint 通过；unit **255**、integration **124** | 实测 0/0/**255**/**124** | **一致 ✓** |
| `implementation.md` T27 | R18-01/R18-02/R18-05/价格投影四项修复 | §3 逐条实测 | **一致 ✓** |
| `implementation.md` T27 | 「补匿名 `testConnection` 与冻结 provider 形状断言」 | 匿名用例存在；**`config.test.ts` 无 provider 形状断言**（唯一形状守卫是 `model-gateway.test.ts:150`） | **不准（R19-02，P3）** |
| `discovery.md` DC-73 | 单一投影来源、`secretRef` 缺省即省略、`readFrozen`/`complete()` 归一、`availability` 校验凭证、价格字段、WP-07/WP-08/09 承接 | 全部成立 | **一致 ✓** |
| `discovery.md` DC-73 末句 | 「当前已归一 `secretRef` 并**保证不因此崩溃**」 | 缺 `provider` 字段 → 原生 `TypeError`；缺 `model` → `complete()` 原生 `TypeError`（`exp2` D1/E2） | **过强（R19-03，P3）** |
| `test.md` O1 | `cbf7471` 无配套独立 Review；`review.md` 无 `R18-05` | `grep -c R18-05` = 0；`cbf7471` 位于 Review 冻结点之后 | **成立 ✓（本报告闭合）** |
| `test.md` O2/O3/O4 | `readFrozen` 无 Schema 校验（`provider` 缺失抛原生 `TypeError`）；显式 `undefined` 在活行留 own key；无 resolver 时准入放行调用闭合 | O2 → `exp2` D1 复现（升级为 R19-01）；O3 → 我另测：own key 存在于**内存行**，`resolve`/`freeze`/`readFrozen`/TOML/原始 payload 一律省略；O4 → `exp3` B1–B4 复现 | **三条全部成立 ✓** |
| `docs/INDEX.md` | 实现起点只结算到 WP-01 | 未误称 WP-02 已实现 | **正确 ✓** |
| `plan.md` | 写入范围含 `packages/core/src`、`packages/core/test`、本包记录 | 本提交落在范围内 | **一致 ✓** |

---

## 5. 新 Findings（R19-01..R19-03）

### R19-01 [P2，非阻断] `readFrozen` 归一只覆盖 `secretRef`；畸形冻结载荷仍以原生 `TypeError` 穿透 `complete()` 的 `GatewayResponse` 契约

- **位置**：`packages/core/src/config.ts:503-524`（`readFrozen` 仅对 payload 做类型断言 + 解构 `payload.provider`）；`packages/core/src/model-gateway.ts:136-157`（`complete()` 直接读 `frozen.provider.*`、`frozen.model.*`）。
- **事实（我实跑，原始观察值）**：
  - `exp2` D1：`writer.freeze('config', { role, model, effectiveContextLimit, revision })`（无 `provider`）后 `readFrozen` 抛 `TypeError: Cannot destructure property 'secretRef' of 'payload.provider' as it is undefined.`（`readFrozen` 自身崩溃，而非返回 `undefined` 或结构化错误）。
  - `exp2` E1/E2：无 `model` 的载荷能通过 `readFrozen`（`model === undefined`），随后 `complete()` 抛 `TypeError: Cannot read properties of undefined (reading 'id')`——**违反了 `complete()` 的返回契约**（声明只会返回 `GatewayResponse` 联合，实际可抛原生异常，且不是 `ProtocolError`）。
  - `exp4` A：`secretRef` 为 `""`/`0`/对象时被原样交给 resolver，读取面不做形状校验（与 DC-73 声明的「读取面校验属 WP-08/09」一致）。
- **影响**：当前写入路径不可达（`SnapshotWriter.freeze` + `snapshotSchema` 保证 payload 自产自洽），所以**不影响 AC-043..047/082**；但读取面是「写入端不变式 + 读取端断言」的组合——与本包 T-01 的成因同族（一处不变式漂移即演变为 P1）。`reliability.md` §8 `restore` 整体复制 SQLite 快照，WP-05/08 的迁移或人工修复若写入旧形状/部分载荷，会让 Run 的每次调用以原生异常（而非结构化 `STALE_ARTIFACT`/`CONFIG_INVALID`）失败，且异常信息不含 Run/快照上下文。
- **建议**：给 `FrozenProvider`/`ModelDescriptor` 补运行时 Schema（或在 `readFrozen` 内复用 `providerInputSchema` 的子集），把非法载荷转成结构化错误（`STALE_ARTIFACT`/`CONFIG_INVALID` + `details.snapshotId`）；`complete()` 改为在 `frozenProfileOf` 内完成校验，保持「只返回 `GatewayResponse`」的契约。
- **非阻断理由**：WP-02 未发布，且所有受支持路径新写入的载荷形状由 `freeze()` 保证；DC-73 已登记该承接（WP-08/WP-09 读取面）。**但需写入 Settlement 的 unresolved/剩余风险**。

### R19-02 [P3，非阻断] T27 记录称「补冻结 provider 形状断言」，`config.test.ts` 实际未被本提交触碰

- **位置**：`.agentdev/work/WP-02/implementation.md:278`；`packages/core/test/config.test.ts:207-239`（freeze 用例仍只断言 `role`/`effectiveContextLimit`/`reasoning`，无 provider 形状断言）；对照 `git diff b9a2d12 cbf7471 --stat` 仅 `model-gateway.test.ts`。
- **事实**：R18-01/R18-03 的原始建议（第十八轮报告 §5）是「在 `config.test.ts` 的 freeze 用例补『冻结 provider 恰为 providerId/type/baseUrl（+可选 secretRef）』的形状断言」；本提交只补了 `model-gateway.test.ts:150` 的 `not.toHaveProperty('secretRef')`（该断言足以抓 T-01，我复现确认），未补 `config.test.ts` 的形状断言，但 T27 的措辞让读者以为两处都补了。
- **影响**：记录准确性/可追溯性；不影响任何观测行为，也不改变验收（`resolve`/`freeze` 同源已由 `exp1`/`exp4` 证实）。
- **建议**：把 T27 措辞改为与提交一致（「匿名 `testConnection` 用例 + `model-gateway.test.ts` 的冻结形状守卫」），或补上 `config.test.ts` 的三键形状断言。

### R19-03 [P3，非阻断] DC-73 的「保证不因此崩溃」过强；`availability` 新引入「resolver 必须无副作用且不抛异常」的隐式契约

- **位置**：`.agentdev/work/WP-02/discovery.md:285`（末句）；`packages/core/src/model-gateway.ts:92-107`（`availability`）、`:136-141`（`complete()` 再次解析）；`packages/core/src/model-gateway.ts:56-58`（`SecretResolver` 接口无异常/纯度约定）。
- **事实（我实跑）**：
  - `exp2` D1/E2：DC-73 的「保证不因此崩溃」只在 `secretRef` 这一维度成立，任意畸形载荷仍抛原生 `TypeError`。
  - `exp4` C3：一次被准入的调用会 **resolver 解析两次**（`availability` 一次、`complete()` 一次，`asked=["local-secret","local-secret"]`）。
  - `exp4` D1–D3：若 resolver 是「一次性凭证」（第一次返回、第二次返回 `undefined`），**准入会消费掉凭证**，随后同一次调用以 `CONFIG_INVALID` 失败且 0 次 transport——即新代码给 `SecretResolver` 加了一条未在接口/记录中声明的隐式契约：**必须可重复调用、无副作用、且不会抛异常**（`execution.md` §2「Gateway 在 Core 受信侧持有 Provider Secret」表明真实实现是查表读值，故当前无实际缺陷）。
  - `exp3` D1/D2：resolver 抛异常时，`availability` 与 `Orchestrator.dispatch` 都不做包装，直接以原始 `Error` 逃逸（不是 `PROVIDER_UNAVAILABLE`，也没有 Work/Run 上下文）。
- **影响**：属跨包接口契约与可观测性；WP-07（SecretStore）尚未实现，当前无实际缺陷，也不影响 6 条 AC。
- **建议**：把 DC-73 末句收窄为「已归一 `secretRef`；任意畸形载荷的完整 Schema 校验归 WP-08/WP-09」；在 `SecretResolver` 的 JSDoc（及 DC-73）写明「`resolve` 必须幂等/无副作用，异常视为 `CONFIG_INVALID`」，并考虑让 `availability` 捕获 resolver 异常转成结构化失败。

---

## 6. 回归扫描与「同类模式」扫描

### 6.1 回归面（本轮实测）

- 契约命令 6/6 全绿（§2）；unit 255（= 252 + 3）与 integration 124 与 Test 第二轮逐字一致。
- `availability` 新增 Secret 解析后，**所有注入 resolver 的准入路径**都被我覆盖：Chief 角色（`exp3` A/B/C 的不同配置语义）、悬空凭证、匿名 Provider、无 resolver；未观察到误拒或误放。
- 冻结形状兼容：旧 hash 可读、旧 `null` 可调用、有价/无价模型双向 round-trip；`resolve`/`freeze`/`readFrozen` 三路一致。
- `provider.upsert` 传 `secretRef: undefined` 的活配置行（Test 的 O3）实测无副作用：内存行有 own key，`resolve`/`freeze`/`readFrozen`/TOML/原始 payload 一律省略；`canonicalJson` 在哈希计算时过滤 `undefined`（`dispatcher.ts:91-94`），`freeze` 对含 `undefined` 的载荷直接拒绝（`exp4` A2）。

### 6.2 「`?? null` / `undefined` 判定」同类模式（承接第十八轮全量扫描，本轮只补新增点）

| 站点 | 性质 | 消费者判定 | 结论 |
|---|---|---|---|
| `config.ts:507-515` `readFrozen` 归一（**本轮新增**） | 冻结载荷读取面 | 全仓读冻结 payload 的三处：`model-gateway.ts:113`（经 `frozenProfileOf`）、`orchestrator.ts:737`（只取 `profile`）、`config.ts` 自身 | 归一正确；形状校验缺失 = R19-01 |
| `model-gateway.ts:139` `?? undefined`（**本轮新增**） | 读取端二次归一 | 自身 | 正确（纵深防御） |
| `model-gateway.ts:98-107` `availability` 解析（**本轮新增**） | 准入面 | 无（结果为布尔） | 语义正确；隐式纯度契约 = R19-03 |
| `model-gateway.ts:182-184` `testConnection` | **仍未归一**（只认 `undefined`） | 活配置行 | 无实际缺陷：`providerInputSchema` 是 `strictObject` 且 `secretRef` 必须是字符串，`null` 无法经 `config.update`/`upsertProvider`/TOML 进入活文档（`exp2` C1）；仅当受信侧手工写入字面量 `"null"` 时才会被当成 Secret 名——本包不实现该写入面，记为观察（O-4） |
| `config.ts:137`/`:541` 两处省略键 | 写入面 | — | 与读取端一致 ✓ |
| `config.ts:342` `secretConfigured` | 协议响应 | 无 | 无缺陷 ✓ |
| `orchestrator.ts:542/607/805/819/867`、`join.ts:262-264`、`run-lifecycle.ts:137/250/260-390`、`events-hub.ts:432-468` | 事件 data / 错误 details | 无 `=== undefined` 判定，或读取端已 nullish 归一 | 沿用第十八轮结论：无缺陷 ✓ |

**新增点结论**：`cbf7471` 引入的三处判定（`readFrozen` 归一、`complete` 二次归一、`availability` 解析）**方向一致、无第二处写入端/读取端漂移**；剩余脆弱性是读取面缺形状校验（R19-01），已登记承接。

---

## 7. 其它观察（不计入 Finding 编号）

1. **O-1（O1 闭合声明）**：本轮 Review 的对象是与 `cbf7471` 逐字节相同的代码树，且已独立复现 R18-01/R18-02/R18-05/价格投影四项；Test 第二轮的 O1（「`cbf7471` 的代码改动尚无独立 Review 覆盖」）**由本报告闭合**，不再阻断结算。
2. **O-2（`freeze` 的 `{ ...provider }` 冗余但无害）**：`config.ts:491` 对 `frozenProviderOf` 的返回值再浅拷贝一次；功能等价（`exp1` F1 证明 hash 与旧实现一致），属可读性。
3. **O-3（resolver 异常未包装、双重解析）**：见 R19-03；真实 SecretStore（WP-07）实现前无实际影响。
4. **O-4（`testConnection` 与 `complete` 的归一不对称）**：`complete()` 走冻结载荷（可含历史 `null`）故必须归一，`testConnection` 只走活文档（Schema 拒绝 `null`）；当前无缺陷，但两条路径写法差异值得在 WP-10 统一（否则未来「活文档也支持 `null`」时又会分叉）。
5. **O-5（沿第十八轮成立的两条 P3 观察）**：`resolve` 对「模型不支持该 reasoning」返回 `CONFIG_INVALID` 而 `dispatch` 统一映射 `PROVIDER_UNAVAILABLE`（`config.ts:426-431` vs `orchestrator.ts:458-466`）；`frozenProfileOf` 对快照缺失抛 `STALE_ARTIFACT` 而非 `NOT_FOUND`。二者属错误码/可观测性，建议归 WP-10 协议面统一。
6. **O-6（`provider.upsert` 的 `secret?:string` 参数仍被忽略）**：`protocol.md` §5 声明的入参在 `config.ts:322` 未被消费（DC-31 已登记的 WP-07/WP-10 边界）；建议接线时显式拒绝「给了 secret 却没给 secretRef」的输入。
7. **O-7（产物归属）**：修复提交 `cbf7471`、Test 报告提交 `267751a`、本 Review 报告单独提交，符合「Review 产物与开发/测试提交分离」；`discovery.md`/`implementation.md` 的改动属开发记录范围，本轮只读未改。
8. **O-8（`docs:check` 计数）**：15 文档 / 55 链接 / 94 验收用例 / 9 需求 / 11 工作包，与 Test 第二轮一致；`docs/INDEX.md` 未误称 WP-02 已结算。

---

## 8. 剩余风险（未闭环，供 Settlement 与产品方判断）

1. **R19-01（新增，P2 非阻断）**：`readFrozen`/`complete()` 对畸形冻结载荷抛原生 `TypeError`，绕过 `GatewayResponse` 契约；当前写入路径不可达，承接 WP-08/WP-09 读取面统一 Schema 校验。**建议列入 Settlement 的 unresolved（有理由、不影响本包 AC）。**
2. **R19-02（新增，P3）**：T27 记录与提交内容在「`config.test.ts` 形状断言」上口径不一致；建议在 Settlement 前做一次记录级修正（不改代码时属文档路线）。
3. **R19-03（新增，P3）**：DC-73 末句过强；`SecretResolver` 的幂等/无副作用/异常语义未声明；`availability` 使凭证解析次数变为 2 次/调用。
4. **测试缺口（本轮维持并缩小）**：匿名 `complete`/`testConnection`、历史 `null` 兼容已由产品用例覆盖（`model-gateway.test.ts:141-218`，我反向确认该守卫能抓住旧行为）；仍缺「畸形载荷 → 结构化错误」的产品级用例（取决于 R19-01 是否在 WP-02 内修）。
5. **承接包（沿前轮，均非本包缺陷）**：真实 Provider 纵向（HTTP/usage/reasoning 映射）→ WP-10；daemon HTTP/WS 协议面与错误码统一 → WP-09/WP-10；工具层「重启后试读窄范围外文件被拒」负例、SecretStore/`once` 消费 → WP-07；`readFrozen` 全量 Schema 校验 → WP-08/WP-09；并发（预算准入与 `reserve` 窗口、多进程 Join、超 lease 恢复）→ WP-08。
6. **产品待决项（沿前轮，未变化）**：DC-60（`Assessment.goal`/`scope` 是否落库）、DC-64（风险旗标词表是否升为契约枚举）、DC-70（`l3Paths`/`l3Keywords` 判定语义）、DC-27/RE-06（快照 `:ID` 与 hash 并存）、DC-46（`dispatch` 不校验 `work.status`）、DC-72 登记后的 WP-06 等级升级路径。

---

## 9. 能否进入结算（Settlement）——**可以**

按 `workflow.md` §6/§7 与 skill 的 Completion contract 逐项核对：

| 条件 | 状态 |
|---|---|
| 有生效 Plan | ✓ `plan.md`（planVersion 4），写入口径与本轮实际改动面一致 |
| 实现与 Plan/批准偏差一致 | ✓ `cbf7471` 落在 `packages/core/{src,test}` 与本包记录 |
| 阻断 Finding 全部闭合并经独立核验 | ✓ 0×P1；R18-01/R18-02/R18-05/价格投影四项由本报告独立复现闭合；本轮无新阻断项 |
| Test 已执行、失败与未覆盖显式 | ✓ Test 第二轮 PASS（6/6 AC；AC-082 含 1 项 UNVERIFIED→WP-07），O1 由本报告闭合 |
| 产品变更经用户确认 | ✓ 本轮无产品行为变更（R18-05 是 `agents.md` §5 既有要求，DC-73 已登记） |
| 相关文档/索引已检查 | ✓ `docs:check` 绿；`docs/INDEX.md` 未误称；**Settlement 仍需把 `docs/INDEX.md` 的实现起点补到 WP-02，并在 `docs/delivery/acceptance.md` 登记 AC-043..047/082 的证据** |
| 代码树冻结且未再改动 | ✓ `HEAD=267751a`、代码树 = `cbf7471`、`git status` 干净、6/6 命令绿 |
| 剩余风险已登记 | ⚠ 需在 Settlement 清单登记 R19-01（P2，非阻断）与 §8 承接包 |

**判定：进入 Settlement 无阻断项。** 建议 Settlement 动作：(1) 更新 `docs/INDEX.md` 实现起点到 WP-02；(2) 在 `acceptance.md` 的 AC-043/044/045/046/047/082 登记证据（Test 第二轮 + 本轮 Review）；(3) 在完成清单 `unresolved` 记入 R19-01/R19-02/R19-03 与 §8 承接包；(4) 记录级修正 T27 措辞（R19-02，可选同行完成）。

---

## 10. 方法与边界声明

- 本报告只依据仓库文件、`267751a`/`cbf7471`/`a0b522d`/`b9a2d12`/`3506630` 的 git 对象与差异、以及我自己执行的命令；未读取任何开发或 Test 会话对话，未引用外部同名技能或历史方案。
- 阅读深度：`packages/core/src/config.ts`（全文件逐行，重点 `:130-180`、`:320-360`、`:390-584`）、`model-gateway.ts`（全文）、`orchestrator.ts`（调度与准入路径 `:225-245`、`:420-480`、`:730-745`）、`snapshots.ts`（全文）、`dispatcher.ts` 的 `canonicalJson`（`:88-100`）；`packages/core/test/model-gateway.test.ts`（全文）、`config.test.ts:195-282`、`orchestrator.test.ts` 夹具；`packages/contracts/src/entities/structures.ts`（`:109-162`、`:236-262`）；`docs/architecture/data.md`（全文）、`docs/architecture/execution.md`（Secret/工具边界）、`docs/rules/workflow.md`（§6/§7）、`docs/delivery/{implementation,acceptance}.md`（WP-02、WP-07、AC-043..047/082）、`.agentdev/work/WP-02/{plan,discovery,implementation,review,test}.md` 全部通读。
- 覆盖的手段：静态逐行核对 + 「提交信息/记录/注释 vs 代码」对账 + 冻结投影三路等价（`exp1`/`exp4`）+ `secretRef` 值域真值表（`exp4` A）+ 历史 `null` 端到端与畸形载荷（`exp2`）+ 准入凭证校验与 Orchestrator 端到端写入计数（`exp3`）+ 一次性凭证/双重解析（`exp4` C/D）+ 活文档显式 `undefined`（`exp5`）+ `git show --stat`/`git diff` 冻结面对账。
- 唯一写入文件为本文件 `.agentdev/work/WP-02/review.md`；实验脚本与日志独立写在 `/tmp/wp02r19/`，使用 `pnpm build` 产出的 `packages/*/dist`，通过 `/tmp/wp02r19/node_modules/@agentdev/*` 软链解析 workspace 包，**不 import 任何产品测试文件**。
- 未修改产品代码、测试、`docs/**`、`plan.md`、`implementation.md`、`discovery.md`、`test.md`；`pnpm build` 只写 `.gitignore` 中的 `dist/`。写入本报告前 `git status --porcelain` 无输出、`HEAD=267751a17fbf859324ad81c746a215947e321152`。
