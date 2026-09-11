# WP-02 独立 Review 报告（第十一轮）

- 评审对象：工作包 WP-02「主管与独立Agent调度」
- 评审轮次：**第十一轮**（逐条复核第十轮 R10-01..R10-07 与三项对抗性观察是否真修，并找新问题）
- 冻结点：git `080aa4c`（`fix(core): WP-02 review round 10 findings (R10-01..R10-07)`），前置 `e125bb7`
- HEAD 校验：`git rev-parse HEAD` = `080aa4c9b43b7a5deec30a907aa7b2c867a18a07`；`git log -1` = `080aa4c fix(core): WP-02 review round 10 findings (R10-01..R10-07)`
- 工作树：复核开始与写入本报告前 `git status --porcelain` 均无输出（`pnpm build` 只写被 `.gitignore` 忽略的 `dist/`）
- 评审角色：Review（独立上下文，未读取任何开发对话；只依据仓库文件、git 对象与我自己的实验）
- 权威依据：`AGENTS.md`、`docs/INDEX.md`、`docs/rules/{workflow,agents}.md`、`docs/architecture/{ARCHITECTURE,data,protocol,reliability,context}.md`、`docs/delivery/{implementation,acceptance}.md`（WP-02 与 AC-043/044/045/046/047/082）、`.agentdev/work/WP-02/{plan,implementation,discovery}.md` 全部记录、`packages/core/src` 全部 17 个文件（本轮改动文件 `orchestrator.ts` 逐行，其余按注释声称与关键分支抽查）、`packages/domain/src`（`routing.ts` 词表/`decideLevel`/`routingFloor` 逐行）、`packages/contracts/src/entities/{structures,work}.ts`、`packages/contracts/src/primitives.ts`、`packages/storage/src`、`packages/core/test`、`packages/domain/test`
- 方法：逐行核对「注释/记录声称」与代码；在 `/tmp/wp02r11/` 自建夹具与 11 组实验脚本（`fixture.mjs`、`exp-a..k.mjs`）与 5 个 TypeScript 编译探针（`tsprobe/`），用 `pnpm build` 产出的 `packages/*/dist` 独立复现（软链 `/tmp/wp02r11/node_modules/@agentdev/*`）；**不修改产品代码、测试、`docs/**`、`plan/implementation/discovery`**。
- 工具：`node v24.8.0`、`pnpm 12.3.4`

---

## 0. 历史轮次结论摘要（保留，第一至十轮）

**第一轮（`785bdd6`）FAIL：1×P1、5×P2、7×P3（R-01..R-13）。**
P1＝`stage.submit` 无终态/epoch 守卫；P2＝「父等待可接消息」证据空洞、`joinPolicy=none` 未实现、持久事件名偏离 `protocol.md` §7、越界写入 Plan、`run.ts` 快照引用改哈希与 `data.md` 冲突。全文：`git show c4763d5:.agentdev/work/WP-02/review.md`。

**第二轮（`c4763d5`）FAIL：0×P1、5×P2、6×P3（N-01..N-11）。**
含 `contract_violation` 不释放预算、非 running 仍接受交付、自造 Join 事件名、终态父 Run 仍收新子 Run、重复 `chief_action_required`、二次 Schema 失败在 `paused` 抛错等。

**第三轮（`a8daa6d`）FAIL：1×P1、2×P2、2×P3（M-01..M-05）＋对抗性核验 D1..D5。**
M-01（P1）＝父 Run 级预算预留从不释放；M-02＝预算只预留/释放不核销；M-03＝`Work blocked(provider)` 未落地。

**第四轮（`411d04f`）FAIL：0×P1、3×P2、7×P3（Q-01..Q-10）＋对抗性核验 H-01..H-03。**
Q-01（`operationId` 只按键去重不校验载荷）、Q-04（父 Chief Run 可在 `join=all` 子 Run 未终态时被结算）为本包必修。

**第五轮（`5a87a86`）FAIL：0×P1、5×P2、9×P3（R5-01..R5-14）＋对抗性核验 M-1..M-4。**
R5-01（指纹漏字段）、R5-02（`settleRun(...,'cancelled')` 绕过守卫）、R5-03（超限 usage 卡死）、R5-04（`reconcile` 不幂等）、R5-05（`join=none` 孤儿待办）为必修；`H-03` 全仓无定义（R5-14）。

**第六轮（`0211ced`）FAIL：1×P1、2×P2、7×P3（R6-01..R6-10）。**
R6-01（P1）＝`reconcile` 双重核销 → 双重计费；R6-02＝`cost` 只进事件不进 Work 预算；R6-03＝`settleRun(...,'cancelled',usage)` 静默丢弃实测用量。

**第七轮（`f02aca4`）FAIL：0×P1、2×P2、6×P3（R7-01..R7-08）＋对抗性核验补出 R7-09（P2）。**
R7-01＝malformed `DispatchSpec` 抛裸 `TypeError`；R7-02＝`reconcile` 幂等比较忽略 `cost`；R7-03＝`measured:false` 带 cost 被静默丢弃；R7-04＝`reconciliation` 计数恒 1；R7-05＝DC-48 仍写 `costKnown`；R7-06＝DC-35 父状态描述不准；R7-07＝被拒 dispatch 仍落快照行；R7-08＝DC-46 枚举与 `workflow.md` 引用错误；R7-09＝级联取消不释放「从未启动」子 Run 的预留。

**第八轮（`328ee60`）FAIL：0×P1、3×P2、6×P3（R8-01..R8-09）。**
R8-01（`requestDispatch` 无契约校验）、R8-02（`assess` 无契约校验）、R8-03（零消费取消的死预留）、R8-04（被拒 dispatch 留快照行）、R8-05（DC-35 记录）、R8-06（DC-48/DC-52 记录）、R8-07（`§65` 引用）、R8-08（失效引用/注释）、R8-09（`contextPayload` 无校验）。全文：`git show 328ee60:.agentdev/work/WP-02/review.md`。

**第九轮（`328ee60`）FAIL：0×P1、1×P2、5×P3（R9-01..R9-06）＋对抗性核验三项漏项。**
R9-01（P2，阻断）＝`assess` 的 L3 底线只认识 8 个内部英文 camelCase 风险旗标，中文/kebab/大小写/拼写错误提交时**静默按 L2 通过**（fail-open 安全门禁）；R9-02（P3）＝`dispatchRequestSchema` 与 `protocol.md` §1/§6 及 `DispatchRequestInput` 接口四处不一致；R9-03（P3）＝`runParams` 是唯一未被 `dispatchExtrasSchema` 覆盖的冻结输入；R9-04（P3）＝`assess` 校验后静默丢弃 `goal`，`data.md` §2 行与 §3 结构自相矛盾；R9-05（P3）＝`auth.ts` `secureCookies` 注释过度声称；R9-06（P3）＝父 Run 处于 `paused`/`interrupted`/`recovery_required` 时 required 失败的 Chief 待办永久缺失。**对抗性漏项**：A＝`operation` 的 L3 判定源错误（读 `work.level` + 未文档化魔法串）；B＝`authorizationRef` 不核对授权实体；C＝`scope` 也被静默丢弃。全文：`git show 328ee60:.agentdev/work/WP-02/review.md`。

**第十轮（`e125bb7`）FAIL：0×P1、2×P2、5×P3（R10-01..R10-07）。**
R10-01（P2，阻断）＝未登记风险旗标仍静默降级为 L2、`workflow.md` §2.3 原样合并措辞（`数据删除/迁移` 等）不生效、fail-closed 助手 `isKnownLockdownRiskTerm` 全仓零调用；R10-02（P2，阻断）＝授权核对只在 `assess` 且只查存在性——跨 Work 与已 `revokedAt` 的授权仍被接受，`dispatch` 的 `authorizationRef` 完全不核对并把伪造引用冻结进 DispatchSnapshot；R10-03（P3）＝`assessment.saved.decidedLevel` 与被接受的行等级自相矛盾且不记 `floor`；R10-04（P3）＝`DispatchRequestInput.sourceRefs[].version` 接口可选而运行期必填、`stage` 自由字符串原样落事件且两项均未记录；R10-05（P3）＝非法 `runParams` 对象仍报 `PROVIDER_UNAVAILABLE`、DC-59 清单仍写三个冻结输入；R10-06（P3）＝DC-60「`goal`/`scope` 只进 `assessment.saved` 事件」与代码不符；R10-07（P3）＝`operation` 判定把「任一 operation 名称」等同于「触及运行环境」。另有三项对抗性核验（非 L3 的 `authorizationRef` 不核对、intent 可绕 L3 操作门禁 M-2、输入卫生）。全文：`git show 080aa4c:.agentdev/work/WP-02/review.md`。

**追溯口径（沿用第五轮 DC-53/DC-56 口径）**：行为/需求缺失＝P1（阻断）；局部质量/维护＝P2；建议＝P3。P2/P3 是否阻断由本轮按 `workflow.md` §6（第 65 行）「影响验收则阻断」判定。**L3 安全门禁类缺陷沿用 R9-01/R10-01 的 P2 标定**（按 §6 字面「错误行为/需求缺失」亦可判 P1；两者都阻断，本轮保持既有标定以免口径漂移）。

---

## 1. 本轮结论

**FAIL（Review Failed）——第十轮 R10-01..R10-07 与三项对抗性观察的修复主体全部实测成立（无一条被回退，无一条「文档声称已修而代码不符」），但第十轮修复宣称的「环境操作 / lockdown 风险与 `intent` 标签解耦」只覆盖了 `delivery`/`document`/`operation`：`intent: 'assist'` / `'artifact'` 仍然先返回 `none`，既绕过 `workflow.md` §2.2 的运行环境门禁，也绕过 §2.3 的 lockdown 风险门禁（R11-01，P2，阻断）。另新增 1 处记录/注释与代码不符（R11-03）、1 处 `operation` intent 的等级底线漏洞（R11-02）、1 处本轮引入的孤立 JSDoc（R11-04）。本轮共 0×P1、2×P2、3×P3（R11-01..R11-05），其中 R11-01、R11-03 为 P2，按 `workflow.md` §6「影响验收则阻断」，阻断进入独立 Test。**

**逐条裁定（详见 §3）**

| 第十轮条目 | 本轮裁定 |
|---|---|
| **R10-01** 风险旗标词表 fail-closed | **完全修好 ✓**：16 个文档单词（含 `Secret`）+ 12 个大小写/分隔符变体 + 3 个原样合并措辞全部 L3；10 个未登记拼写全部 `VALIDATION_ERROR`（带词表 details）且零落行；`isKnownLockdownRiskTerm` 由 `unknownRiskFlags`（`routing.ts:160`）真实调用（`exp-a` 59/59）。**但门禁本身可被 `intent` 标签绕过（R11-01）** |
| **R10-02** 授权来源核对 | **完全修好 ✓（就清单内探针）**：`assess` 缺引用/伪造 UUID/跨 Work/已撤销 4 例全 `NOT_AUTHORIZED`；非 L3 只要提供引用也核对（L2 3 例 + L1 3 例 + assist/none 2 例全拒）；`dispatch` 伪造/跨 Work/已撤销 3 例全拒且**零快照行、零 Run 行**；同 Work 真实授权被核对后冻结（`exp-b` 32/32）。**残留：L3 Work 完全不传引用仍被接受（R11-03）** |
| **R10-03** 事件记 `floor` | **完全修好 ✓**：L1 行事件 `{decidedLevel:"L2", floor:"L1", decidedReason:"default L2 route"}`，L2/L3 行 floor 分别 L2/L3，三者可区分（`exp-c`） |
| **R10-04** `sourceRefs[].version` / `stage` | **修好 ✓（含登记偏离）**：TS 探针缺 `version` 现报 `TS2741`（负对照 `TS2739`），运行期同报 `VALIDATION_ERROR`；`stage`/`operationId` 去空白并限 64/128，DC-61 已登记 `stage` 取值集合归 WP-04（与 `data.md` §2 `run.stage:string` 一致）（`exp-d`、`tsprobe`） |
| **R10-05** `runParams` 契约校验 | **完全修好 ✓**：非对象 5 例、非法字段 9 例全部 `VALIDATION_ERROR`（不再 `PROVIDER_UNAVAILABLE`），被拒零快照行；合法 `{contextLimit:32000}` 真实采用（`sources.contextLimit==='run'`）；未知 provider/model 仍正确地报 `PROVIDER_UNAVAILABLE`；DC-59 已列四个冻结输入（`exp-e` 23/23） |
| **R10-06** DC-60 记录 | **完全修好 ✓**：实测 `assessment` 行与 `assessment.saved` 均无 `goal`/`scope`，DC-60 已改为「既不落行也不落事件」（`exp-c`）；`scope` 仅用于路由判定与记录一致 |
| **R10-07** `operation` 过严 | **完全修好 ✓**：环境副作用集合收窄为 `bash/network/secret/push/deploy/delete_data`；`read`/`search`/`edit`/`write`/`artifact_write`/`git` 在 `intent='operation'` 下保持 L2；集合内 5 项在 L2 一律拒绝、L3 一律接受（`exp-f`、`exp-i`）。**但 `intent` 标签仍能整体绕过该门禁（R11-01）** |
| **对抗性 A** `operation` L3 判定源 | **修好 ✓**（改用载荷 `scope.operations`/`scope.networkTargets`，不再读 `work.level`）；遗留过严已按 R10-07 收窄 |
| **对抗性 B** `authorizationRef` 核对实体 | **完全修好 ✓（存在性/同 Work/未撤销，`assess` + `dispatch`）**；授权范围覆盖性仍未核对（DC-63 登记为 WP-04/WP-05，见 §6.2） |
| **对抗性 C** `scope` 静默丢弃 | 同 R10-06（记录已更正；是否落库仍为 `Product Decision Pending`） |

**新引入/新发现的问题**：R11-01（`intent:'assist'`/`'artifact'` 绕过 §2.2 与 §2.3 两条 L3 门禁，阻断）、R11-03（L3 Work 的 `dispatch` 不要求任何授权，且 DC-63 的理由与代码不符，阻断）、R11-02（`intent:'operation'` 的等级底线为 `none`，可存 L1/none）、R11-04（本轮新增的孤立 JSDoc）、R11-05（环境操作集合的位置与 `git` 覆盖）。

### 输入卫生（第十轮对抗性第三项）

`dispatch` 的全部冻结输入在任何写入前 fail-closed：`authorizationRef` 非 UUID/空、`requiredOutputSchemas` 非数组/版本错/缺 `kind`、`contextPayload` 数字/数组/嵌套函数、`runParams` 非对象、`spec` 畸形/`null` 共 13 例全部 `VALIDATION_ERROR`，且**快照行数与 Run 行数完全不变**（`exp-g` 13/13）。该项**完全修好 ✓**。

---

## 2. 契约命令原始结果（本轮实跑）

执行方式：`export PATH="$HOME/.local/bin:$PATH"`，在仓库根目录按序执行，逐条记录退出码（完整输出存于 `/tmp/wp02r11/{typecheck,lint,test_unit,test_integration,docs_check,build}.log`，摘要存于 `/tmp/wp02r11/cmds.log`）。

| 命令 | 退出码 | 原始结果要点 |
|---|---|---|
| `pnpm typecheck` | **0** | `tsc -p tsconfig.json --pretty false`，无输出 |
| `pnpm lint` | **0** | `Checking formatting...` / `All matched files use Prettier code style!` |
| `pnpm test:unit` | **0** | `Test Files 17 passed (17)` / `Tests 237 passed (237)` / `Duration 2.64s`（与 T18 声称的 237 一致） |
| `pnpm test:integration` | **0** | `Test Files 10 passed (10)` / `Tests 124 passed (124)` / `Duration 34.83s`（真实容器用例：`container.integration.test.ts` 9 例 34.3s、`doctor.integration.test.ts` 8 例 16.1s）（与 T18 声称的 124 一致） |
| `pnpm docs:check` | **0** | `docs:check ok — 15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages` |
| `pnpm build` | **0** | `packages/{contracts,domain,storage,core,pi-runtime}`、`apps/{cli,runner}` 共 7 个 workspace `build: Done` |
| `git status --porcelain` | — | 复核开始与报告写入前均**无输出**（干净） |
| `git rev-parse HEAD` | — | `080aa4c9b43b7a5deec30a907aa7b2c867a18a07`（= 冻结点） |

**自建实验（观察值记录，失败项即 Finding 证据）**：`exp-a` 59/0、`exp-b` 32/0、`exp-c` 12/0、`exp-d` 10/0、`exp-e` 23/0、`exp-f` 29/**1**（失败＝R11-01 绕过）、`exp-g` 13/0、`exp-h` 9/0、`exp-i` 1/0、`exp-j` 0/**1**（失败＝R11-01 风险旗标绕过）、`exp-k` 1/0。TS 探针：`tsconfig.good` 退出 **0**；`tsconfig.noversion` 退出 **1**（`TS2741`，缺 `version`）；负对照 `tsconfig.negcontrol` 退出 **1**（`TS2739`，缺 `requestedRole`/`goal`）；`tsconfig.stage` 退出 **0**（`stage` 仍为自由字符串，DC-61）；`tsconfig.runparams` 退出 **1**（`TS2353`，`bogus` 不在 `ProfileLayer`）。所有实验用 `pnpm build` 后的 `packages/*/dist`，通过 `/tmp/wp02r11/node_modules/@agentdev/*` 软链解析，**不 import 任何产品测试文件**。

---

## 3. 逐条复核表（第十轮条目 + 三项对抗性观察）

| 条目 | 前轮定级 | 前轮要求 | 本轮实测证据（脚本/观察值） | 判定 |
|---|---|---|---|---|
| **R10-01** 风险旗标词表 | P2（阻断） | 未登记旗标不得静默降级；原样合并措辞生效；三选一并记录 | `exp-a` A：`数据删除/迁移`/`支付金额/状态`/`部署/发布` 全部接受为 L3；B：16 个文档单词（含 `Secret`，其余为中文：`身份认证`/`权限判断`/`安全边界`/`数据删除`/`数据迁移`/`支付金额`/`支付状态`/`公开协议不兼容`/`部署`/`发布`/`项目门禁规则变化`/`密钥`/`授权`/`权限`/`凭证`）全 L3；C：12 个变体（含 `SECURITY_BOUNDARY`、`SecurityBoundary`、前导/尾随空白、`DEPLOY_OR_RELEASE`）全 L3。D：`securityBoundry`/`安全`/`安全边界问题`/`数据删除与迁移`/`认证`/`保密`/`operation_touches_environment`/`多文件修改`/`DEPLOY_RELEASE`/`foo` 全 `VALIDATION_ERROR`，`details.vocabulary` 42 项且含合并措辞，**零 assessment 行落库**（前后均 31）。全角 `部署／发布` 亦被拒（fail-closed）。E：`isKnownLockdownRiskTerm` 由 `routing.ts:160` 的 `unknownRiskFlags` 调用，非零调用。DC-64 记录与代码一致。`workflow.md:13` 的原样措辞现全部生效 | **完全修好 ✓** |
| **R10-02** 授权核对 | P2（阻断） | 核对同 Work 与撤销；`dispatch` 走同一函数 | `exp-b` A：L3 无引用/伪造 UUID/跨 Work（`belongs to Work`）/已撤销（`was revoked`）4 例裁定正确；同 Work 真实授权接受 L3。B：L1/L2/none/assist 携带跨 Work、伪造、已撤销引用共 8 例全 `NOT_AUTHORIZED`，合法引用 2 例接受。C：`dispatch` 伪造/跨 Work/已撤销 3 例全拒，**快照行恒 3、Run 行恒 1**；同 Work 授权接受并冻结 `authorizationRef`。D：用本 Work 的授权为 `OTHER_WORK_ID` 派发被拒。E/F 见 R11-03/§6.2 | **完全修好 ✓（清单内）；残留 R11-03** |
| **R10-03** `floor` 证据 | P3 | 事件同时记录生效下限 | `exp-c` A：`intent:'delivery'`+`level:'L1'`+`semanticImpact:false`+空 scope → 行 `level='L1'` 被接受，事件 `{level:"L1", decidedLevel:"L2", floor:"L1", decidedReason:"default L2 route"}`；B/C：L2→floor L2、L3→floor L3。行等级、生效下限、判定理由三者可区分 | **完全修好 ✓** |
| **R10-04** `request_dispatch` 契约 | P3 | 必填性/`version`/`stage`/`operationId` 统一并记录 | `exp-d`：缺 `version` 运行期 `VALIDATION_ERROR: sourceRefs.0.version`；带 `version` 接受；`stage:'nonsense-stage'` 接受并原样落 `chief_action_required`，`'  develop  '` 落 `develop`，65 字符与全空白拒绝；`operationId` 128 接受、129 与全空白拒绝。`tsprobe`：同调用缺 `version` 现 `tsc` 退出 1（`TS2741`），正探针 `good` 退出 0，负对照 `TS2739`。DC-61 已记录 `version` 必填、`stage`/`operationId` 去空白限长、`stage` 取值集合归 WP-04（与 `data.md` §2 `run.stage:string` 不冲突） | **修好 ✓（含登记偏离）** |
| **R10-05** `runParams` | P3 | 非法值统一 `VALIDATION_ERROR`；DC-59 列四个输入 | `exp-e` A：`5`/`true`/`[]`/`null`/`"oops"` 全 `VALIDATION_ERROR`。B：`{contextLimit:-5}`/`{bogus:1}`/`{reasoning:'hyper'}`/`{providerId:'not-a-uuid'}`/`{contextLimit:4095}`/`{contextLimit:2000001}`/`{temperature:3}`/`{modelId:''}`/`{skills:'not-an-array'}` 全 `VALIDATION_ERROR`，被拒零快照行。C：`{}`/`{contextLimit:32000}`（冻结后 `profile.contextLimit=32000`、`sources.contextLimit==='run'`）/`{modelId}`/`{reasoning:'low'}` 全接受。D：合法但未知 provider/model 仍 `PROVIDER_UNAVAILABLE`（语义正确）。`exp-k`：显式 `undefined` 字段与 `ProfileLayer` 类型一致。`discovery.md:195` 已列四个冻结输入 | **完全修好 ✓** |
| **R10-06** DC-60 记录 | P3 | 记录与代码一致 | `exp-c` D：`assessment` 行键 `createdAt,id,intent,level,policyRevision,projectId,reason,riskFlags,semanticImpact,uncertainties,updatedAt,version,workId`（无 `goal`/`scope`）；`assessment.saved` data 键 `decidedLevel,decidedReason,floor,intent,level,semanticImpact,workId`（亦无）。DC-60（`discovery.md:200-203`）已改述为「既不落行也不落事件」「`scope` 目前只用于路由判定，不持久化」，与代码一致 | **完全修好 ✓** |
| **R10-07** `operation` 过严 | P3 | 判据收窄到确有环境副作用 | `exp-f` C：`intent:'operation'` + `read`/`search`/`edit`/`write`/`artifact_write`/`git` + L2 全接受 L2。D：`bash`/`network`/`push`/`deploy`/`delete_data` L2 全拒（`routing rules require L3`）、L3 全接受；`exp-i`：`secret` 同（消息确为 `routing rules require L3`，非 Schema 拒绝）。B：`delivery`/`document`/`operation` + `deploy` 或 `networkTargets` L2 全拒、L3 全接受 | **完全修好 ✓** |
| **对抗性 A** `operation` L3 判定源 | 补漏 | 不得读 `work.level`/魔法串 | 代码 `orchestrator.ts:171-176` 只看 `payload.scope.networkTargets`/`operations`；全仓 `work.level` 已无任何读取点（`grep` 仅 `floor`/`row.level`）。`exp-h` E：`operation`+`deploy`+L3+真实授权接受 | **完全修好 ✓** |
| **对抗性 B** `authorizationRef` 核对实体 | 补漏 | 伪造引用不得成为权限 | 同 R10-02 行；`verifyAuthorization`（`orchestrator.ts:739-777`）覆盖存在性/同 Work/未撤销，`assess`（`:305`）与 `dispatch`（`:375`）共用 | **完全修好 ✓** |
| **对抗性 C** `scope` 静默丢弃 | 补漏 | 同 R9-04 | 同 R10-06；`Product Decision Pending`（DC-60） | 记录已更正 ✓（决定待产品方） |
| **对抗性 输入卫生** | 补漏 | 畸形输入统一协议错误且零副作用 | `exp-g` 13 例全 `VALIDATION_ERROR`，零快照/零 Run；`spec:null` 亦协议化 | **完全修好 ✓** |

---

## 4. 新 Findings（R11-01..R11-05）

### R11-01 [P2] `intent: 'assist' | 'artifact'` 先返回 `none`，使 §2.2 运行环境门禁与 §2.3 lockdown 风险门禁双双 fail-open

- **位置**：`packages/domain/src/routing.ts:200-209`（`decideLevel`：`assist`/`artifact` 在环境判定之前 `return { level: 'none' }`；环境判定在其后）；`packages/core/src/orchestrator.ts:186-197`（`routingFloor`：`payload.intent !== 'delivery' && !== 'document'` ⇒ `'none'`）、`:287-304`（`assess` 用 `deciding`/`floor` 放行）、`:282-286`（注释声称「it applies whatever the `intent` label says」）；记录 `discovery.md:212`（DC-62「**与 `intent` 标签无关**」）、`implementation.md:178`（T18「环境操作判定与 `intent` 标签解耦」）；测试 `packages/core/test/orchestrator.test.ts:404`、`packages/domain/test/domain.test.ts:171`（标题声称 "whatever the intent label says"，实际只覆盖 `delivery`/`document`）。
- **事实（`exp-f` E、`exp-j`，实跑）**：

  | 提交的评估（workflow.md §2.2/§2.3 明文证据） | 实测 |
  |---|---|
  | `intent:'assist'` + `scope.operations:['deploy']` + `level:'none'` | **接受**，行 `level='none'` |
  | `intent:'assist'` + `['deploy']` + `L1` / `L2` | **接受** `L1` / `L2` |
  | `intent:'assist'` + `networkTargets:['10.0.0.5']` + `none` | **接受** `none` |
  | `intent:'artifact'` + `['deploy']` / `['bash']` + `none` / `L2` | **接受** `none` / `L2` |
  | `intent:'assist'` + `riskFlags:['安全边界']` / `['数据删除/迁移']` / `['支付金额/状态']` | **接受** `none` / `L1` / `L2` |
  | `intent:'artifact'` + `riskFlags:['部署/发布']` / `['Secret']` | **接受** `none` / `L2` |
  | 同上经 `assessment.saved` 读回 | `{intent:"artifact", level:"L2", floor:"none", decidedLevel:"none", decidedReason:"artifact routes to level none"}` |
  | 纯 domain 调用 `decideLevel({intent:'assist', operationTouchesEnvironment:true})` | `level:'none'`（不依赖 DB/夹具，最强证据） |
  | 对照：`delivery`/`document`/`operation` + `deploy` + L2 | 全部 `VALIDATION_ERROR`（既有修复有效） |

- **影响**：`workflow.md` §2.2（运行环境/网络写入/数据操作 ⇒ L3 与明确操作授权）与 §2.3（身份认证/权限判断/Secret/安全边界/数据删除·迁移/支付金额·状态/公开协议不兼容/部署·发布/项目门禁规则变化 ⇒ L3）是两条安全底线。第十轮修复把门禁从 `intent==='operation'` 解耦到「与标签无关」，但 `decideLevel` 的 `assist`/`artifact` 提前返回使 **两个 intent 取值** 仍可整体绕过：只要把 intent 写成 `assist`/`artifact`，声明 `deploy`/`bash` 操作、非空 `networkTargets` 或任一文档化 lockdown 风险旗标，Core 都会以 `floor:'none'` 记录并放行。这使 R10-01 的 fail-closed 词表在门禁层面失效（词表拒的是「不认识的旗标」，而认识的旗标配 `assist` 标签照样降级），也是 M-2「同一 `operations:['deploy']` 换个标签就能绕过」的未修完部分。
- **建议**：(a) 在 `decideLevel` 中把环境操作与 lockdown 风险的判定**提前**到 `assist`/`artifact` 之前（`none` 只应在既无环境操作、又无 lockdown 风险、且 intent 为 assist/artifact 时返回）；(b) 同步收紧 `routingFloor`：`operation` intent 的底线至少为 L2（见 R11-02），`assist`/`artifact` 命中环境操作或 lockdown 风险时底线为 L3；(c) 在 DC-62/T18 改为准确的措辞（不要声称「与 intent 标签无关」，除非真的对所有取值成立）；(d) 补上 `assist`/`artifact` × 环境操作 × lockdown 风险的失败测试，并把现有两个测试标题下的用例补全。
- **是否阻断**：**阻断**（文档化 L3 安全门禁对两个 intent 取值 fail-open；标定沿用 R9-01/R10-01 的 P2；按 `workflow.md` §6 第 65 行字面「错误行为/需求缺失」亦可判 P1，两种标定都阻断）。

### R11-02 [P3] `routingFloor` 对 `intent:'operation'` 返回 `none`，与 `decideLevel` 的 L2 判定及函数注释不符

- **位置**：`packages/core/src/orchestrator.ts:191`（`if (payload.intent !== 'delivery' && payload.intent !== 'document') return 'none';`）、`:178-185`（docstring 声称「everything else defaults to L2 and a lockdown risk to L3」）；`packages/domain/src/routing.ts:210-222`（`decideLevel` 对无环境证据的 `operation` 返回 L2）。
- **事实（`exp-h`，实跑）**：`decideLevel({intent:'operation', operationTouchesEnvironment:false})` = `{level:'L2', reason:'default L2 route'}`；但同一载荷经 `assess` 提交 `level:'none'`、`'L1'`、`'L2'` **全部被接受**（空 scope 与 `['read']` 均是），事件读回 `{intent:"operation", level:"L1", floor:"none", decidedLevel:"L2", decidedReason:"default L2 route"}`——即 Core 自己的判定是 L2，却允许落 L1/none。对照 `delivery`/`document` 未声明 L1 前提时 L1/none 均被拒。
- **影响**：`workflow.md` §2.5「其余为 L2」；`operation` 是一个明确的修改性 intent，其底线却被写成 `none`。照 `workflow.md` §3 的路由表，L1 走 CompactPlan + ReviewCheck（无独立 Test），因此把 `operation` 记为 L1 会让本应 L2 的操作路由掉一个门禁。当前无消费方，属底线自洽性/前摄性缺陷。
- **建议**：`routingFloor` 对 `operation`（以及任何非 assist/artifact 的修改性 intent）至少返回 `L2`；顺带修正 `:178-185` 的 docstring，使其与返回 `'none'` 的分支一致。
- **是否阻断**：不阻断（与 R11-01 同根因，建议一并修复）。

### R11-03 [P2] R10-02 残留：L3 Work 的 `dispatch` 不要求任何授权，且 DC-63 的理由与代码/契约不符

- **位置**：`packages/core/src/orchestrator.ts:371-375`（`this.verifyAuthorization(extras.authorizationRef, work.id, undefined)`——`level` 传 `undefined`，无引用时直接返回）、`:739-753`（`authorizationRef === undefined` 且 `level === undefined` ⇒ 不报错）；记录 `.agentdev/work/WP-02/discovery.md:221`（DC-63 末句「`dispatch` 在不知道 Work 等级时不强制要求授权」）；契约 `docs/architecture/data.md:22`（`work` 含 `level:none/L1/L2/L3` 与 `authorizationRef?:ID`）、`packages/contracts/src/entities/work.ts:46-63`（`workSchema.level` 必填）。
- **事实（`exp-b` E/F，实跑）**：`Work.level='L3'`（无 Work 级授权行）时 `dispatch` 一个专业 Run 且**完全不传 `authorizationRef`** → **接受**（`{ok:true}`，Run 已建）。对照：同一调用若传伪造/跨 Work/已撤销引用则被拒。`grep` 证实 `work.level` 在全仓 `packages/core/src` 无任何读取点——`dispatch` 拿到的 `work` 行里就有 `level`，所以 DC-63 的「不知道 Work 等级」不成立；`workflow.md:7`（§1「Core检查角色、字段、授权、权限和版本」）与 `data.md:26`（`authorization`「Core 核对来源与权限」）要求 Core 在授权门禁上核对。
- **影响**：`assess` 一侧的授权已 fail-closed，但 Run 建立（`dispatch`）一侧对 L3 Work 没有任何要求：只要 Work 行是 L3（无论其 `authorizationRef` 是否存在/有效），Core 就会建立 Chief/专业 Run 并冻结 DispatchSnapshot。WP-04 接线前的 Core 调用方是唯一入口，因此这是当前唯一的 L3 派发门禁。DC-63 把「授权范围是否覆盖 `scope`/`operations`」推迟到 WP-04/WP-05 是合理的范围界定，但把「L3 完全不要求授权」也归入该推迟、并用一个与代码不符的理由表述，属记录不实；`workflow.md` §6 要求阻断项的推迟须登记 `accepted_risk` 并由用户接受，本提交未登记。
- **建议**：`dispatch` 在 `requiresExplicitAuthorization(work.level)` 且调用方未提供引用时，至少核对 **`work.authorizationRef`**（同一 `verifyAuthorization`；不存在/跨 Work/已撤销 ⇒ `NOT_AUTHORIZED`），这条不会造成 DC-63 担心的死锁（Work 行本身携带授权，Chief Run 的创建从 Work 取引用即可）；若产品方仍决定整体推迟，请在 DC-63 中删除「不知道 Work 等级」一句、写明「`dispatch` 当前不做任何 L3 授权检查」并登记 `accepted_risk`。
- **是否阻断**：**阻断**（L3 授权门禁在 Run 建立边界仍缺失，且记录理由与代码矛盾；延续 R10-02 的 P2 标定）。

### R11-04 [P3] 本轮新增的孤立 JSDoc：`operationFingerprint` 的注释现在挂在 `ENVIRONMENT_OPERATIONS` 上

- **位置**：`packages/core/src/orchestrator.ts:150-155`（`/** Stable fingerprint of one dispatch request, used for operationId idempotency. … */`）、`:156-168`（紧随其后的 `ENVIRONMENT_OPERATIONS` 及其 JSDoc）、`:171-176`（`touchesRunningEnvironment`）、`:204-206`（`operationFingerprint`，**无注释**）。
- **事实**：`080aa4c` 的 diff 把新常量块插在 `operationFingerprint` 的 JSDoc 与其函数体之间（见 `git show 080aa4c -- packages/core/src/orchestrator.ts`，`@@ -149,6 +153,28 @@` 一段），于是出现两个连续 JSDoc，而真正描述的函数（`:204 operationFingerprint`）失去了文档。`pnpm lint`（Prettier）不检查注释归属，故门禁全绿也发现不了。
- **影响**：文档与代码不符，正是本工作包反复出现的 Finding 类别（R7-05/R8-08/R10-06 同类）；编辑器悬停会把「fingerprint」的描述显示在 `ENVIRONMENT_OPERATIONS` 上。
- **建议**：把 `:150-155` 的 JSDoc 移回 `:204` 的 `operationFingerprint` 上方。
- **是否阻断**：不阻断。

### R11-05 [P3] 环境操作集合硬编码在 core 且未由契约枚举派生，`git` 静默落在集合之外

- **位置**：`packages/core/src/orchestrator.ts:161-168`（`ENVIRONMENT_OPERATIONS = {bash,network,secret,push,deploy,delete_data}`）；对照 `packages/contracts/src/primitives.ts:122-135`（`operationNameSchema` 共 12 个取值，含 `git`、`artifact_write`、`write`、`edit`）、`docs/architecture/data.md:55`（operations 取值集合）、`discovery.md:212`（DC-62 列出该集合但未说明 `git` 的取舍）。
- **事实（`exp-i`/`exp-f` C，实跑）**：`intent:'operation'` + `scope.operations:['git']` + `L2` → **接受**；而同为契约枚举的 `push` 在集合内、`bash`/`network`/`deploy`/`delete_data`/`secret` 均强制 L3。筛选集合写在 `core` 而非 `domain`（`LOCKDOWN_RISK_TERMS` 与路由判定都在 `domain/routing.ts`），且未从 `operationNameSchema` 派生，新增 operation 取值时不会自动进入分类。
- **影响**：维护性/一致性——`git` 若被他用执行远端写（`git push`）则不被视为「网络写入」（§2.2）；同时 `artifact_write`/`write` 的取舍（本地文件写入不算环境操作）也没有文档依据。当前不影响已实测的门禁语义（`push` 已覆盖推送场景）。
- **建议**：把该集合移入 `packages/domain/src/routing.ts` 并由 `OperationName` 类型约束（`readonly OperationName[]`），在 DC-62 写明 `git` 为何不属环境副作用（或将其纳入并说明只在进行远端操作时升级）。
- **是否阻断**：不阻断。

---

## 5. 其它观察（不计入 Finding 编号）

1. `isKnownLockdownRiskTerm` 已不再是零调用（`routing.ts:160` 的 `unknownRiskFlags` → `orchestrator.ts:274`），R10-01 的「死代码」观察闭环；`grantsModificationAuthority` 仍未在生产代码使用（沿前几轮）。
2. 新增测试的标题与覆盖不符：`orchestrator.test.ts:404` 与 `domain.test.ts:171` 名为 "whatever the intent label says"，实际只断言 `delivery`/`document`/`operation`，`assist`/`artifact` 无任何用例——R11-01 因此对现有 237 条单测完全不可见（建议修 R11-01 时一并补齐）。
3. `assessment.saved` 的 data 仍只有 `workId/intent/level/semanticImpact/decidedLevel/floor/decidedReason`，不含 `riskFlags`/`uncertainties`/`authorizationRef`/`reason`；`protocol.md:120` 只要求「变更后实体摘要」，故不算偏离，但按事件重建时风险旗标不可查（沿前轮）。
4. `DispatchInput` 仅解析 `spec` 与四个 extras，`input` 上的其他键被忽略；`stage`/`operationId`/`authorizationRef` 的长度与 UUID 约束只存在于运行期 Schema，TS 接口无法表达（10 字符以上的 `stage` 仍能通过 `tsc`，运行期才拒）——`tsprobe` 的 `stage` 探针退出 0。
5. `implementation.md` 末尾的 `## T9 待办` 小节标题与前面的 `## T9 独立 Review 与修复` 重号（`implementation.md:185`），该标题在 `e125bb7` 之前即存在，非本轮引入，但会让读者误以为 T9 未完成。
6. **产物归属**：`080aa4c` 是一个开发修复提交，却同时包含 `.agentdev/work/WP-02/review.md` 的整篇重写（`129 insertions(+) / 123 deletions(-)`，即把第九轮报告替换为第十轮报告，与当前工作树逐字节一致）。第十轮报告的内容与我本轮读代码的结论没有冲突，但 Review 产物因此无法仅凭 git 归属为 Reviewer 独立撰写（`docs/rules/agents.md` §1 规定 review 的写入边界是报告本身）。建议后续轮次由 Reviewer 自行提交、或至少在提交信息中声明该文件由独立 Review 产出。
7. `workflow.md:13`（§2.3）的风险词汇仍是实现级常量（`routing.ts:108-133` + DC-64），未进入 `data.md`/contracts 枚举；未登记旗标现在一律 `VALIDATION_ERROR`，因此 Chief **无法**记录词表之外的（哪怕是 L2 级的）风险旗标——这是 R10-01 采纳的 fail-closed 选项 (b) 的必然结果，DC-64 已挂 `Product Decision Pending`，须由产品方确认是否允许自定义旗标（或把词表升为契约枚举）。

---

## 6. 剩余风险（未闭环，供 Test/Settlement 与产品方判断）

1. **并发未验证**：预算准入检查（`orchestrator.ts:411-414`）与事务内 `reserve`（`:475`）之间仍有窗口；单 mailbox 串行假设下不可达，多连接/多进程的双花与「快照已落、Run 未建」未被测试覆盖（沿前几轮）。
2. **授权范围覆盖性未核对**（DC-63 登记的 WP-04/WP-05 工作）：`exp-b` F 实测——授权 `operations:['deploy']`、评估 `scope.operations:['delete_data']` 仍被接受 L3；`Authorization.scope`/`operations`/`acceptedAt` 未参与判定。
3. `timed_out`/`interrupted`/`recovery_required` 终态无产生路径（WP-05）；`onChildSettled` 仍无生产调用方（WP-05）。
4. `ModelGateway` 的真实 HTTP、Secret 解析与 `testConnection` 真连属 WP-07/WP-10（DC-31）；`Work blocked(provider)` 投影属 WP-05（DC-42）。
5. **待产品方决定项**：R10-01/DC-64（风险旗标词表是否升为契约枚举、是否允许自定义旗标）、R9-04/DC-60（`Assessment.goal`/`scope` 是否落库或落事件）、N-11（`data.md:30` 的三个 `:ID` 快照引用与实现的哈希并存）、DC-46（`dispatch` 不校验 `work.status`）。
6. **本轮新增未闭环**：R11-01（assist/artifact 绕过 §2.2+§2.3 门禁）、R11-02（`operation` 底线为 `none`）、R11-03（L3 Work 派发不要求授权、DC-63 理由不实）。
7. `assessment.saved` 的 `data` 不含 `riskFlags`（§5.3），事件读模型无法复现风险分类；`assessment.submit` 按 `protocol.md:106` 应返回「适用 Gate」，当前 Core 返回 Assessment 行（协议层 WP-04 未接线，沿前轮）。

---

## 7. 方法与边界声明

- 本报告只依据仓库文件、`080aa4c` 上的 git 对象/差异与实跑命令；未读取任何开发对话、未引用外部同名技能或历史方案。
- 阅读深度：`orchestrator.ts`、`routing.ts`、`structures.ts`、`work.ts`、`primitives.ts` 逐行；`data.md`、`protocol.md`、`reliability.md`、`context.md`、`ARCHITECTURE.md`、`workflow.md`、`acceptance.md`（WP-02 与 AC-043/044/045/046/047/082）、`implementation.md`（WP-02 与 T1..T18）、`discovery.md`（DC-27..DC-64）通读；`packages/core/src` 其余文件与 `packages/domain/src` 其余文件按注释声称与关键分支抽查（这些文件在 `080aa4c` 中未改动，且由本轮全量测试覆盖）。R10-01..R10-07 与三项对抗性观察的判定不依赖对未改动文件的推断。
- 唯一写入文件为本文件 `.agentdev/work/WP-02/review.md`；实验脚本独立写在 `/tmp/wp02r11/`（`fixture.mjs`、`lib.mjs`、`exp-a..k.mjs`、`exp-*.log`、`tsprobe/{tsconfig.*,good,noversion,negcontrol,stage,runparams}.ts`、`cmds.log`），使用 `pnpm build` 产出的 `packages/*/dist`，通过 `/tmp/wp02r11/node_modules/@agentdev/*` 软链解析 workspace 包，等价复现包内夹具但**不 import 任何产品测试文件**。
- 未修改产品代码、测试、`docs/**`、`plan.md`、`implementation.md`、`discovery.md`；`pnpm build` 只写 `.gitignore` 中的 `dist/`。写入本报告前 `git status --porcelain` 无输出、`HEAD=080aa4c9b43b7a5deec30a907aa7b2c867a18a07`。
- 历史轮次报告取回方式：第十轮 `git show 080aa4c:.agentdev/work/WP-02/review.md`；第九轮 `git show 328ee60:…`；第八轮 `git show f02aca4:…`；第七轮 `git show 0211ced:…`；第六轮 `git show 5a87a86:…`；第五轮 `git show 411d04f:…`；第四轮 `git show a8daa6d:…`；第三轮 `git show c4763d5:…`；第二/一轮 `git show 785bdd6:…`。
