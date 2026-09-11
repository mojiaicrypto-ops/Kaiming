# WP-02 独立 Review 报告（第十二轮）

- 评审对象：工作包 WP-02「主管与独立Agent调度」
- 评审轮次：**第十二轮**（逐条复核第十一轮 R11-01..R11-05 是否真修，核对注释/记录声称与代码是否一致，并找新问题）
- 冻结点：git `fec9a9d`（`fix(core): WP-02 review round 11 findings (R11-01..R11-05)`），前置 `080aa4c`
- HEAD 校验：`git rev-parse HEAD` = `fec9a9dcfb7fd2382907ff126fb3c4542df66593`；`git log -1` = `fec9a9d fix(core): WP-02 review round 11 findings (R11-01..R11-05)`
- 工作树：复核开始与写入本报告前 `git status --porcelain` 均无输出（`pnpm build` 只写被 `.gitignore` 忽略的 `dist/`）
- 评审角色：Review（独立上下文，未读取任何开发对话；只依据仓库文件、git 对象与我自己的实验）
- 权威依据：`AGENTS.md`、`docs/rules/{workflow,agents}.md`、`docs/architecture/{ARCHITECTURE,data,protocol,reliability,context}.md`、`docs/delivery/{implementation,acceptance}.md`（WP-02 与 AC-043/044/045/046/047/082）、`.agentdev/work/WP-02/{plan,implementation,discovery}.md` 全部记录、`packages/core/src` 全部 17 个文件、`packages/domain/src` 全部、`packages/contracts/src/entities/{structures,work}.ts` 与 `primitives.ts`、`packages/core/test`、`packages/domain/test`
- 方法：逐行核对「注释/记录声称」与代码；在 `/tmp/wp02r12/` 自建夹具与 5 组实验脚本（`fixture.mjs`、`lib.mjs`、`exp1..exp5.mjs`，共 68 项断言全通过），用 `pnpm build` 产出的 `packages/*/dist` 独立复现（软链 `/tmp/wp02r12/node_modules/@agentdev/*`）；**不修改产品代码、测试、`docs/**`、`plan/implementation/discovery`**
- 工具：`node v24.8.0`、`pnpm 12.3.4`

---

## 0. 历史轮次结论摘要（保留，第一至十一轮）

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
R9-01（P2，阻断）＝`assess` 的 L3 底线只认识 8 个内部英文 camelCase 风险旗标，中文/kebab/大小写/拼写错误提交时**静默按 L2 通过**（fail-open 安全门禁）；R9-02＝`dispatchRequestSchema` 与 `protocol.md` §1/§6 四处不一致；R9-03＝`runParams` 未被 `dispatchExtrasSchema` 覆盖；R9-04＝`assess` 静默丢弃 `goal`；R9-05＝`auth.ts` 注释过度声称；R9-06＝父 Run `paused` 时 Chief 待办缺失。**对抗性漏项**：A＝`operation` 的 L3 判定源错误；B＝`authorizationRef` 不核对授权实体；C＝`scope` 也被静默丢弃。

**第十轮（`e125bb7`）FAIL：0×P1、2×P2、5×P3（R10-01..R10-07）。**
R10-01（P2，阻断）＝未登记风险旗标仍静默降级为 L2、`workflow.md` §2.3 合并措辞不生效、`isKnownLockdownRiskTerm` 零调用；R10-02（P2，阻断）＝授权核对只查存在性，跨 Work/已撤销仍被接受，`dispatch` 的 `authorizationRef` 完全不核对；R10-03＝事件不记 `floor`；R10-04＝`sourceRefs[].version` 接口可选而运行期必填；R10-05＝非法 `runParams` 报 `PROVIDER_UNAVAILABLE`；R10-06＝DC-60 与代码不符；R10-07＝`operation` 判定过严。全文：`git show 080aa4c:.agentdev/work/WP-02/review.md`。

**第十一轮（`fec9a9d` 的前置 `080aa4c`）FAIL：0×P1、2×P2、3×P3（R11-01..R11-05）。**
R11-01（P2，阻断）＝`intent:'assist'/'artifact'` 在环境/风险门禁之前 `return none`，两条 L3 门禁 fail-open；R11-03（P2，阻断）＝L3 Work 的 `dispatch` 不要求任何授权，DC-63 理由与代码不符；R11-02（P3）＝`routingFloor` 对 `operation` 返回 `none`；R11-04（P3）＝`operationFingerprint` 的 JSDoc 被新常量块截断；R11-05（P3）＝环境操作集合硬编码在 core 且 `git` 落在集合之外。全文：`git show 080aa4c:.agentdev/work/WP-02/review.md`。

**追溯口径（沿用第五轮 DC-53/DC-56 口径）**：行为/需求缺失＝P1（阻断）；局部质量/维护＝P2；建议＝P3。P2/P3 是否阻断由本轮按 `workflow.md` §6（第 65 行）「影响验收则阻断」判定。**L3 安全门禁类缺陷沿用 R9-01/R10-01/R11-01/R11-03 的 P2 标定**（按 §6 字面「错误行为/需求缺失」亦可判 P1；两者都阻断，本轮保持既有标定以免口径漂移）。

---

## 1. 本轮结论

**FAIL（Review Failed）——第十一轮 R11-01/R11-02/R11-04/R11-05 实测真修好，R11-03 的**清单内**（L3 Work 的 `work.level` 授权门禁）也真修好；但 R11-03 只修了「授权要求由谁决定」这一半：`dispatch` 仍不依据**本次 DispatchSpec 自己声明的 `scope`** 施加 L3 底线，因此一个 L2/L1/`none` 级的 Work 可以在**零 Assessment、零授权**的情况下派出声明 `deploy`/`delete_data`/`networkTargets` 的 Chief 或专业 Run（R12-01 残余，实跑 `exp2` G/H、`exp4` N1、`exp5` B），授权范围覆盖性也仍未核对（R12-02）。本轮另发现 3 处记录/注释与代码不符（R12-03/R12-04/R12-05）。本轮共 **0×P1、2×P2、3×P3（R12-01..R12-05）**，其中 R12-01、R12-02 按 `workflow.md` §6「影响验收则阻断」判为阻断，**阻断进入独立 Test**。**

**逐条裁定（详见 §3）**

| 第十一轮条目 | 本轮裁定 |
|---|---|
| **R11-01** `assist`/`artifact` 绕过 L3 门禁 | **完全修好 ✓**：`decideLevel` 先判环境操作、再判 lockdown 风险、最后才走 `assist`/`artifact` 的 `none`（`routing.ts:232-248`）。实跑 36/36：`assist`/`artifact` × `deploy`/`bash`/`secret`/`push`/`delete_data`/`networkTargets` × `none` 全部 `VALIDATION_ERROR: routing rules require L3`；× 6 个文档化风险旗标全部拒绝；零 assessment 行落库；`decideLevel({intent:'assist',operationTouchesEnvironment:true})='L3'`；干净的 `assist`/`artifact` 仍为 `none`（`exp1`）。 |
| **R11-02** `operation` 底线 `none` | **完全修好 ✓**：`routingFloor` 对 `operation` 返回 `L2`（`orchestrator.ts:174-178`）。实跑：`operation`+`none`/`L1` 拒绝（消息 `routing rules require L2 (default L2 route)`）、`L2` 接受、`L3`+真实授权接受、`L3` 无授权 `NOT_AUTHORIZED`；`delivery`/`document` 的 L1 准入与 `semanticImpact`/operation 前提未回退（`exp3` 17/17）。 |
| **R11-03** L3 Work 的 `dispatch` 不要求授权 | **部分修好（清单内修好，整体仍 fail-open）**：`dispatch` 现在用 `extras.authorizationRef ?? work.authorizationRef` + `work.level` 走 `verifyAuthorization`（`orchestrator.ts:361`）。实跑：L3 Work 无 Work 级授权且调用方不传 ⇒ `NOT_AUTHORIZED`；伪造/跨 Work/已撤销引用 ⇒ `NOT_AUTHORIZED` 且零 Run、零快照残留；L3 Work 自带有效授权 ⇒ 接受。**但同一条实跑显示**：L2 Work + `delete_data` 声明 + 零授权 ⇒ **接受**；L1 Work + `networkTargets` + 零授权 ⇒ **接受**；`level='none'` 的 assist Work + `deploy` ⇒ **接受**，且这些 Work 的 Assessment 数为 0（见 R12-01）。 |
| **R11-04** 孤立 JSDoc | **完全修好 ✓**：`operationFingerprint`（`orchestrator.ts:157`）正上方重新是它自己的 JSDoc；`core/orchestrator.ts` 已无 `ENVIRONMENT_OPERATIONS`/`touchesRunningEnvironment` 定义（`exp3`）。 |
| **R11-05** 环境操作集合归属 | **修好 ✓（含轻微过度声称）**：集合移入 `packages/domain/src/routing.ts:161-168`，用 `satisfies readonly OperationName[]` 约束、由 `operationNameSchema` 的 12 个取值核验（`exp3` E：集合内 6 项全为契约取值，集合外 6 项为 `read/search/artifact_write/edit/write/git`）。注释声称「a new operation name is a compile-time reminder to classify it」略强于事实：`satisfies` 只在数组**已列出**时校验取值，新增 `OperationName` 取值不会产生编译错误（只会在有人把它写进该数组时校验）。 |

**新发现**：R12-01（`dispatch` 不按 DispatchSpec 自身 `scope` 施加 L3 底线 ⇒ L1/L2/`none` Work 可零授权派出环境操作 Run，阻断）、R12-02（授权 `operations`/`scope` 不参与判定，只读授权可为 `delete_data` 派发背书，阻断）、R12-03（Work 级授权的核对结果未冻结进 DispatchSnapshot，重启后快照无法重建授权来源）、R12-04（`verifyAuthorization` 注释/JSDoc 与调用点不符）、R12-05（DC-62 仍写环境操作集合在 core，R11-05 已迁移而记录未更新）。

### 前十一轮阻断项的当前状态（本轮实跑复核）

- 第九轮 R9-01 词表 fail-open、第十轮 R10-01 fail-closed、第十一轮 R11-01：`exp1` 36/36 全绿，**未回退**。
- 第十轮 R10-02 / 对抗性 B 授权实体核对：`exp2` A/B/D/E/J 全绿，**未回退**。
- 第五至八轮的事件分页、幂等、预算、终态路径：由本轮 239 单测 / 124 集成全绿覆盖，未发现回归（§2）。

---

## 2. 契约命令原始结果（本轮实跑）

执行方式：`export PATH="$HOME/.local/bin:$PATH"`，在仓库根目录按序执行，逐条记录退出码（完整输出经后台作业收集，摘要如下）。

| 命令 | 退出码 | 原始结果要点 |
|---|---|---|
| `pnpm typecheck` | **0** | `tsc -p tsconfig.json --pretty false`，无输出 |
| `pnpm lint` | **0** | `eslint .` 无输出；`Checking formatting...` / `All matched files use Prettier code style!` |
| `pnpm test:unit` | **0** | `Test Files 17 passed (17)` / `Tests 239 passed (239)` / `Duration 5.52s`（与 T19 声称的 239 一致） |
| `pnpm test:integration` | **0** | `Test Files 10 passed (10)` / `Tests 124 passed (124)` / `Duration 49.30s`（真实容器用例：`container.integration.test.ts` 9 例 ≈48s、`doctor.integration.test.ts` 8 例 ≈25s；与 T19 声称的 124 一致） |
| `pnpm docs:check` | **0** | `docs:check ok — 15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages` |
| `pnpm build` | **0** | `packages/{contracts,domain,storage,core,pi-runtime}`、`apps/{cli,runner}` 共 7 个 workspace `build: Done` |
| `git status --porcelain` | — | 复核开始与报告写入前均**无输出**（干净） |
| `git rev-parse HEAD` | — | `fec9a9dcfb7fd2382907ff126fb3c4542df66593`（= 冻结点） |

**自建实验（观察值记录；失败项即 Finding 证据）**：`exp1`（R11-01）36 passed / 0 failed；`exp2`（R11-03）11 / 0；`exp3`（R11-02/04/05）17 / 0；`exp4`（新探针 N1..N4）3 / 0；`exp5`（边界探针）1 / 0。全部脚本退出码 0（断言口径为「记录观察值」，`exp4`/`exp5` 的 `info` 行才是 Finding 证据）。所有实验用 `pnpm build` 后的 `packages/*/dist`，通过 `/tmp/wp02r12/node_modules/@agentdev/*` 软链解析，**不 import 任何产品测试文件**。脚本与日志存于 `/tmp/wp02r12/{exp1..exp5}.mjs`、`/tmp/wp02r12/{exp1..exp5}.log`、`/tmp/wp02r12/check_records.mjs`。

---

## 3. 逐条复核表（第十一轮条目）

| 条目 | 前轮定级 | 前轮要求 | 本轮实测证据（脚本/观察值） | 判定 |
|---|---|---|---|---|
| **R11-01** 风险/环境门禁被 intent 标签绕过 | P2（阻断） | 两个硬门禁必须对全部 intent 生效 | `exp1` A：`assist`/`artifact` × `deploy`/`bash`/`secret`/`push`/`delete_data`/`networkTargets` × `level:'none'` 共 12 例全 `VALIDATION_ERROR`，消息 `routing rules require L3 (operation touches a running environment)`；B：12 例 × 6 个文档旗标全拒（`lockdown risk: <canonical>`）；C：同载荷升到 L3 + 唯一真实授权 ⇒ 接受；D：干净 `assist`/`artifact` 仍 `none`；E：纯 domain `decideLevel` 三例分别为 L3/L3/none；F：未登记旗标仍拒（`unknownRiskFlags: securityBoundry`），A/B 两节零 analysis 行落库。`routing.ts:232-248` 判定顺序与 DC-65 描述一致 | **完全修好 ✓** |
| **R11-02** `operation` 底线 | P3 | `routingFloor` 至少 L2 + 修 docstring | `exp3` A：`operation`+`none`/`L1` 拒绝（`routing rules require L2`）、`L2`/`L3`+授权接受、`L3` 无授权 `NOT_AUTHORIZED`；B：`delivery`/`document` 的 L1 准入与 `semanticImpact`/`operations:[read]` 前提未回退；C：`decideLevel(operation, clean)='L2'`。`orchestrator.ts:174-178` 与 DC-65 一致（docstring 见 §5.1） | **完全修好 ✓** |
| **R11-03** L3 Work 派发授权 | P2（阻断） | L3 Work 必须能/必须核对授权 | `exp2` A：L3 Work 无授权、调用方不传 ⇒ `NOT_AUTHORIZED`（`L3 requires an explicit authorizationRef`），零 Run；B：伪造 ⇒ `does not exist`，零 Run；C：Work 自带授权 ⇒ 接受、1 Run、快照恰增 3；D：传另一 Work 的授权 ⇒ `belongs to Work …`；E：跨 Work 授权不能给别的 Work 背书；F：5 次拒绝共 0 残留 Run。**缺口**：`exp2` G/H、`exp4` N1、`exp5` B —— L2 Work+`delete_data`、L1 Work+`networkTargets`、`none` Work+`deploy`，全部零授权零 Assessment 接受（R12-01）；`exp4` N3 —— 只读授权 + `delete_data` ⇒ 接受（R12-02） | **部分修好（清单内 ✓，整体仍 fail-open）** |
| **R11-04** JSDoc 归属 | P3 | 注释回到 `operationFingerprint` | `exp3` D：`core/orchestrator.ts:157` 为 `function operationFingerprint`，其上一行是 `*/` 且上方 8 行内含 `Stable fingerprint`；`core` 已无 `ENVIRONMENT_OPERATIONS`/`touchesRunningEnvironment` 定义 | **完全修好 ✓** |
| **R11-05** 环境操作集合 | P3 | 移入 domain 并说明取舍 | `exp3` D/E：`domain/routing.ts:161` 导出 `ENVIRONMENT_OPERATIONS`，6 项全在 `operationNameSchema` 取值内，集合外为 `read/search/artifact_write/edit/write/git`；`git` 不入选的理由写在集合 JSDoc（`routing.ts:151-160`） | **修好 ✓（含 §5.1 的轻微过度声称）** |

---

## 4. 新 Findings（R12-01..R12-05）

### R12-01 [P2，阻断] `dispatch` 只按 Work 行等级查授权，不按 DispatchSpec 自己声明的 `scope` 施加 L3 底线：L1/L2/`none` 的 Work 可在零 Assessment、零授权下派出环境操作 Run

- **位置**：`packages/core/src/orchestrator.ts:361`（`this.verifyAuthorization(extras.authorizationRef ?? work.authorizationRef, work.id, work.level)` —— 等级取 `work.level`，不看 `spec.scope`）、`:265-274`（环境操作判定只发生在 `assess`）、`:436-451`（`effectiveScope: spec.scope` 原样冻结）、`packages/domain/src/routing.ts:232-248`（`decideLevel` 唯一的调用点是 `assess`，全仓 `grep` 确认）；契约 `docs/architecture/data.md:55`（`scope.operations` 取值集合）、`:80`（`DispatchSnapshot={…authorizationRef?:ID,…}`「在Run入队前冻结」）、`docs/rules/workflow.md:7`（「Core检查角色、字段、授权、权限和版本」）、`:12`（「operation涉及运行环境、网络写入或数据操作，使用L3与明确操作授权」）。
- **事实（`exp2` G/H、`exp4` N1/N4、`exp5` B，实跑）**：

  | 提交（`dispatch`，Chief spec，零 Assessment） | Work 行 | 实测 |
  |---|---|---|
  | `scope.operations:['delete_data']`（真实授权存在但不传） | `level:'L2'` | **接受**，Run 建立 |
  | `scope.operations:['deploy']` | `level:'L1'` | **接受**，Run 建立 |
  | `scope.networkTargets:['10.0.0.9']` | `level:'L1'` | **接受**，Run 建立 |
  | `scope.operations:['deploy']` | `intent:'assist', level:'none'` | **接受**，Run 建立（该 Work 的 Assessment 行数 = 0） |
  | 专业 spec `delete_data` + `networkTargets:['10.1.1.1']` | `level:'L2'` | **接受**，Run 建立（Assessment 行数 = 0，`work.level` 仍为 `L2`） |
  | 已评估 `deploy`/L3 后改派 `delete_data`+`networkTargets` | `level:'L2'` | **接受**，冻结 `effectiveScope` 为 `{"networkTargets":["10.9.9.9"],"operations":["delete_data"],…}` |

  对照：同一 `deploy` 声明若经 `assess` 提交则被强制 L3（`exp1`/`exp3`），L3 Work 的 `dispatch` 也已按 `work.level` 要求授权（R11-03 已验证）。因此环境操作门禁是否生效**完全取决于调用方是否先调用 `assess` 并让 Work 行处于 L3**，Run 建立这一 Core 唯一入口没有任何独立底线。
- **影响**：`workflow.md` §2.2 的「运行环境/网络写入/数据操作 ⇒ L3 与明确操作授权」在 `dispatch` 边界不被执行。WP-04 接线前的 Core 调用方是唯一入口，任何未先评估（或评估结果与派发 scope 不一致）的调用都能以 L1/L2/`none` 的 Work 建立声明了 `deploy`/`delete_data`/网络写入的 Run，并且快照会把该 scope 冻结为「已生效范围」（AC-082 的窄范围证据也因此不再代表被授权的范围）。当前 L3 Work 的派发一侧是安全的，但「Work 等级由谁保证」这一问题与 R11-03 同根。
- **建议**：(a) `dispatch` 在 `verifyAuthorization` 之前，用 `touchesRunningEnvironment(spec.scope)`（与 `spec.riskFlags`/评估等价物）计算底线：声明环境操作时要求 `work.level === 'L3'`（或至少要求 `isTerminalRunStatus` 之外的显式 L3 评估存在）且授权可核对，否则 `NOT_AUTHORIZED`/`VALIDATION_ERROR`；(b) 在 `work.level` 未升级时拒绝环境 scope 的派发，而不是只信任 Work 行；(c) 把 `assess` 的 `decidedLevel` 与 `work.level` 的关系写入 DC，明确 Run 建立以哪个为准；(d) 补「L2/L1/`none` Work × 环境 scope ⇒ 拒绝」的失败测试（当前 239 条单测无此用例）。
- **是否阻断**：**阻断**（文档化 L3 安全门禁在 Run 建立边界对非 L3 Work fail-open；标定沿用 R11-01/R11-03 的 P2）。

### R12-02 [P2，阻断] 授权范围（`Authorization.operations`/`scope`）不参与任何判定：只读授权可为 `delete_data` 派发背书

- **位置**：`packages/core/src/orchestrator.ts:725-763`（`verifyAuthorization` 只查存在性、同 Work、未撤销；既不比对 `authorization.operations` 也不比对 `scope`，`exp4` N3/`exp2` I 的调用点 `:288` 与 `:361` 均如此）；契约 `packages/contracts/src/entities/work.ts:128-138`（`authorizationSchema.scope/operations/acceptedAt`）、`docs/architecture/data.md:26`（authorization「Chief解释绑定范围，**Core核对来源与权限**」）。
- **事实（`exp4` N3，实跑）**：Work 的授权行 `operations:['read']`、`scope.readPaths:['docs']`，`dispatch` 的 spec 声明 `operations:['delete_data']` 且把该授权作为 `authorizationRef` 提交 ⇒ **接受**并建立 Run。`exp2` I 的同一性质也成立：`assess` 以 L3+授权通过后，`dispatch` 可用完全不同的 scope 建 Run。
- **影响**：授权是「用户对某个范围的同意」（`data.md` §2、`workflow.md` §2.2「明确操作授权」）。只核对「这张授权属于本 Work 且未撤销」而不能核对「本次操作在授权范围内」，使授权的 `scope`/`operations` 字段成为纯记录；在 L3 路径上（授权已齐备）该缺口仍然存在。DC-63 已把「授权范围是否覆盖 `scope`/`operations`」登记为 WP-04/WP-05 的落线工作，但当前实现没有任何部分核对，且 R11-03 的修复把 `dispatch` 的授权核对写成「已核对」，容易被读成该维度也已覆盖。
- **建议**：(a) 至少核对 `authorization.operations ⊇ touchesRunningEnvironment 命中的操作`（或对 L3 声明要求 `operations` 覆盖 spec 全量 operation）；(b) 若确定推迟，在 DC-63 明确写「当前只核对来源/同 Work/未撤销，范围覆盖性未实现」并在 `review.md`/结算材料登记 `accepted_risk`（`workflow.md` §6 要求阻断项推迟须用户接受）；(c) 补「只读授权 × 环境操作 ⇒ 拒绝」的失败测试。
- **是否阻断**：**阻断**（授权语义未执行且被文档/记录表述为已核对；同 R11-03 的 P2 标定）。

### R12-03 [P3] Work 级授权的核对结果未写入 DispatchSnapshot：重启后快照无法还原被核对的授权来源

- **位置**：`packages/core/src/orchestrator.ts:361`（核对的是 `extras.authorizationRef ?? work.authorizationRef`）、`:436-445`（`withoutHash.authorizationRef` 只取 `extras.authorizationRef`，Work 回退值不写入）；契约 `docs/architecture/data.md:80`（`DispatchSnapshot={dispatchSpec,authorizationRef?:ID,…}`「在Run入队前冻结」）、`packages/contracts/src/entities/structures.ts:295-305`（`dispatchSnapshotSchema.authorizationRef?`）。
- **事实（`exp2` C、`exp4` N2，实跑）**：L3 Work 自带有效授权、调用方不传引用时 Run 被接受，但冻结的 DispatchSnapshot 的键为 `["contextSnapshotId","dispatchSpec","effectiveScope","hash","profileRevision","requiredOutputSchemas"]`，`authorizationRef` 为 `null`；Run 行也没有授权列。`work.authorizationRef`（真实被核对的那张授权，`018f…e85`）只存在于 `work` 行。
- **影响**：AC-082 依赖 DispatchSnapshot 作为「重启后的唯一权威」。对 L3 Work，快照无法回答「这次派发依据的是哪张授权」，也无法在授权事后撤销/删除或 Work 行变化时重建当时的判断；`data.md` §80 允许 `authorizationRef?`，因此这不是 Schema 违规，而是冻结链缺口（与 R10-02「伪造引用会永久留在快照里」同一审计维度的另一面）。
- **建议**：把实际参与核对的引用写入快照（`authorizationRef: extras.authorizationRef ?? work.authorizationRef`），并在 `sources`/事件里区分「调用方提供」与「Work 回退」两种来源。
- **是否阻断**：不阻断（审计/重建完整性，不改变当前准入结果）。

### R12-04 [P3] `verifyAuthorization` 的 JSDoc 与调用点不符：正文声称 `dispatch` 只知道已给出的引用，代码/DC-63 已改为用 `work.level` 判定

- **位置**：`packages/core/src/orchestrator.ts:725-730`（JSDoc：「`undefined` when no level is known yet (a dispatch only checks what it has)」）、`:355-361`（调用注释「An L3 Work needs a verified authorization even when the caller passes none: the Work row carries its own reference」，实际传 `work.level`）；记录 `.agentdev/work/WP-02/discovery.md:221`（DC-63 已更正为「`work.level` 与 `work.authorizationRef` 都在 Work 行上」，并明确 L3 Work 必须有可核对授权）。
- **事实**：同一文件内两段注释对 `dispatch` 是否知道等级给出相反表述；DC-63 与调用点注释/代码一致，JSDoc 停留在 R10-02 时代。
- **影响**：本包反复出现的「注释与代码不符」类别（R7-05/R8-08/R10-06/R11-04 同类）；`pnpm lint` 不检查注释内容，门禁全绿也发现不了。
- **建议**：把 JSDoc 改为「`level` 为调用方认定的本次操作等级；`select-/-dispatch` 分别传评估提交等级与 `work.level`」，或在 `dispatch` 侧把 `work.level` 显式命名为 `effectiveLevel` 后传入。
- **是否阻断**：不阻断。

### R12-05 [P3] DC-62 仍写环境操作集合在 core，R11-05 已把它迁到 `domain/routing.ts` 而记录未更新

- **位置**：`.agentdev/work/WP-02/discovery.md:212`（「`scope.operations` 命中环境副作用集合 `ENVIRONMENT_OPERATIONS`（`['bash','network','secret','push','deploy','delete_data']`…」与同段「`packages/domain/src/routing.ts` 的 `touchesRunningEnvironment(scope)`」并存，但未说明集合本身的归属已变为 domain 的导出版）；对照 `.agentdev/work/WP-02/discovery.md:230-231`（DC-65 与 implementation T19 声称集合已移到 domain）与 `packages/domain/src/routing.ts:161`。
- **事实**：代码在 `domain/routing.ts:161` 导出 `ENVIRONMENT_OPERATIONS`（`exp3` D 确认 core 已无定义），DC-65/T19 已登记迁移，但 DC-62 的正文（第九轮原文）没有同步，读者会以为集合仍定义在 core、且只能从该段得知其位置。
- **影响**：记录内部不一致，属本包反复出现的「记录与代码/记录与记录不符」类别（R7-05/R7-08/R8-05/R8-06/R10-05/R10-06）。
- **建议**：在 DC-62 该段补一句「集合在第十一轮（R11-05）移入 `packages/domain/src/routing.ts`」或直接指向 DC-65。
- **是否阻断**：不阻断。

---

## 5. 其它观察（不计入 Finding 编号）

1. **记录行号与代码偏移**：`implementation.md` 中 T17/T18 的「（DC-62）」「（DC-61）」等括注是**记录编号**而非行号，但同文件 T17:163 的「（DC-62）」紧邻 `implementation.md` 正文行 163、而 DC-62 实际位于 `discovery.md:209`，容易被读成行引用；`implementation.md` 共 198 行，任何 `implementation.md:2xx` 的行号引用都不存在。此外第九轮报告/DC 中的若干 `orchestrator.ts:<行>` 引用在第十一轮改文件后已失效（例如第九轮 R10-04 的 `orchestrator.ts:150-155`）。属文档可读性，不作为 Finding（历史报告中的行号也随每次重写而失效，见 §5.6）。
2. **`routingFloor` docstring 仍不精确**：`orchestrator.ts:161-168` 声称「everything else defaults to L2 and a lockdown risk to L3」，但 `:174` 的 `assist`/`artifact` 分支返回 `'none'`（R11-02 只补了 `operation` 分支的注释）；建议把这句也写全，避免下一轮误读。
3. **`assist`/`artifact` × 本地操作仍可 `none`**（`exp5` A 实跑 10 例）：声明 `write`/`edit`/`artifact_write`/`git` 的 assist/artifact 评估在 `level:'none'` 下被接受。`workflow.md` §2.1 的 assist/artifact 路线本身不授予修改权（`grantsModificationAuthority('none') === false`），且 `data.md`/`workflow.md` 未把本地写操作列为 L3，故不判缺陷；但「declared scope 含写操作、判定为 `none`」这一组合目前无测试也无记录，建议 Chief/路由侧后续明确（WP-03/WP-04）。
4. **lockdown 风险门禁对全部 intent 生效是保守偏离**（DC-65 已登记）：`workflow.md` §2.3 字面只写 delivery/document，本实现按 fail-closed 推广到所有 intent。副作用是带文档化风险旗标的 assist/artifact 现在一律 L3 且必须提供 `authorizationRef`（`exp1` C 只有在 L3+真实授权时才接受），即可能拒绝此前可接受的「解释某安全边界」类请求。若产品方认为 §2.3 应严格限于 delivery/document，这里是需要产品决定的行为差异（不是实现缺陷，已登记）。
5. **`satisfies` 的「编译期提醒」略强于事实**（R11-05 注释，`routing.ts:151-160`）：`as const satisfies readonly OperationName[]` 只校验已列取值；新增 `OperationName` 联合成员不会产生编译错误。若真要「新增操作名即提醒」，需要在 `domain` 侧放一个穷尽映射（`Record<OperationName, 'local'|'environment'>`）。
6. **产物归属（沿第十一轮 §5.6）**：`fec9a9d` 同样是开发修复提交，却包含 `.agentdev/work/WP-02/review.md` 的整篇重写（`112 insertions / 119 deletions`，把第十轮报告替换为第十一轮报告，与当时工作树逐字节一致）。第十一轮报告内容与本轮读代码的结论无冲突，但 Review 产物仍无法仅凭 git 归属为 Reviewer 独立撰写（`docs/rules/agents.md` §1 规定 review 的写入边界是报告本身）。建议后续轮次由 Reviewer 自行提交或在提交信息中声明。
7. **`DispatchRequestInput.stage` 缺省 `'assist'`**（`orchestrator.ts:553`）：`request_dispatch` 无 `stage` 时指纹与事件里写死 `stage:'assist'`；这是 `protocol.md` §6 未给 stage 时的实现约定，但语义上「请求另一角色」与 assist 阶段无关，建议改为 `null` 或角色默认阶段（沿前轮未编号观察）。
8. **输入卫生未见回退**：`dispatch`/`assess`/`requestDispatch` 对畸形输入的 fail-closed 行为（R8-01/02/04/09、R10-05）在本轮 `exp1`/`exp3`/`exp5` 的否定用例里仍全部 `VALIDATION_ERROR` 且零持久副作用；`operations` 未知值（`ssh`）在 `assess` 与 `dispatch` 两侧都被 Schema 拒绝（`exp5` C）。

---

## 6. 剩余风险（未闭环，供 Test/Settlement 与产品方判断）

1. **R12-01（新增，阻断）**：`dispatch` 不按 DispatchSpec 自身 `scope` 施加 L3 底线 ⇒ L1/L2/`none` Work 可零授权派出 `deploy`/`delete_data`/网络写入 Run。
2. **R12-02（新增，阻断）**：授权 `operations`/`scope` 覆盖性未实现，只读授权可为环境操作背书；DC-63 登记为 WP-04/WP-05 工作但当前表述易读成已覆盖。
3. **授权范围覆盖性**（沿第十轮 §6.2）：即使补齐 R12-02 的「同一 spec」比对，`Authorization.scope`/`acceptedAt` 与 Run 实际生效范围的一致性仍需产品方定义（DC-63）。
4. **并发未验证**：预算准入检查（`orchestrator.ts:397-400`）与事务内 `reserve`（`:461`）之间仍有窗口；单 mailbox 串行假设下不可达，多连接/多进程的双花与「快照已落、Run 未建」未被测试覆盖（沿前几轮）。
5. `timed_out`/`interrupted`/`recovery_required` 终态无产生路径（WP-05）；`onChildSettled` 仍无生产调用方（WP-05）；`Work blocked(provider)`/`blocked(budget)` 投影属 WP-05（DC-42/DC-55）。
6. `ModelGateway` 的真实 HTTP、Secret 解析与 `testConnection` 真连属 WP-07/WP-10（DC-31）。
7. **待产品方决定项**：DC-64（风险旗标词表是否升为契约枚举、是否允许自定义旗标）、DC-60（`Assessment.goal`/`scope` 是否落库或落事件）、DC-27/RE-06（`data.md:30` 的三个 `:ID` 快照引用与实现的哈希并存）、DC-46（`dispatch` 不校验 `work.status`）、§5.4（lockdown 门禁是否严格限于 delivery/document）。
8. `assessment.saved` 的 `data` 不含 `riskFlags`/`uncertainties`/`authorizationRef`；`assessment.submit` 按 `protocol.md:106` 应返回「适用 Gate」，当前 Core 返回 Assessment 行（协议层 WP-04 未接线，沿前轮）。
9. **L3 授权门禁的测试缺口**：`packages/core/test/orchestrator.test.ts` 新增的 R11-01/R11-03 用例覆盖了 `assist`/`artifact` × 环境/风险与 L3 Work 有无授权，但**没有**「非 L3 Work × 环境 scope ⇒ 拒绝」与「授权范围不覆盖 spec ⇒ 拒绝」的用例（R12-01/R12-02 因此对现有 239 条单测不可见）。

---

## 7. 方法与边界声明

- 本报告只依据仓库文件、`fec9a9d` 上的 git 对象/差异与实跑命令；未读取任何开发对话、未引用外部同名技能或历史方案。
- 阅读深度：`packages/core/src/orchestrator.ts`、`packages/domain/src/routing.ts`、`packages/contracts/src/entities/{structures,work}.ts`、`primitives.ts` 逐行；`packages/core/src` 其余文件（`config.ts`、`model-gateway.ts`、`run-lifecycle.ts`、`stage.ts`、`join.ts`、`events.ts`、`snapshots.ts`、`auth.ts`、`toml.ts`、`errors.ts`、`events-hub.ts`、`identity.ts`、`mailbox.ts`、`requirements.ts`、`dispatcher.ts`、`index.ts`）与 `packages/domain/src` 其余文件按注释声称与关键分支抽查（这些文件在 `fec9a9d` 中未改动，且由本轮全量测试覆盖）；`docs/rules/{workflow,agents}.md`、`docs/architecture/data.md`（§2/§3 相关行）、`protocol.md` §6/§7、`acceptance.md`（AC-043..047、AC-082）、`implementation.md` WP-02 通读；`.agentdev/work/WP-02/{plan,implementation,discovery}.md` 全部记录通读（重点 DC-58..DC-65、T16..T19）；`packages/core/test/orchestrator.test.ts` 新增用例逐行。
- 唯一写入文件为本文件 `.agentdev/work/WP-02/review.md`；实验脚本独立写在 `/tmp/wp02r12/`（`fixture.mjs`、`lib.mjs`、`exp1..exp5.mjs`、`exp*.log`、`check_records.mjs`），使用 `pnpm build` 产出的 `packages/*/dist`，通过 `/tmp/wp02r12/node_modules/@agentdev/*` 软链解析 workspace 包，等价复现包内夹具但**不 import 任何产品测试文件**。
- 未修改产品代码、测试、`docs/**`、`plan.md`、`implementation.md`、`discovery.md`；`pnpm build` 只写 `.gitignore` 中的 `dist/`。写入本报告前 `git status --porcelain` 无输出、`HEAD=fec9a9dcfb7fd2382907ff126fb3c4542df66593`。
- 历史轮次报告取回方式：第十一轮 `git show fec9a9d:.agentdev/work/WP-02/review.md`；第十轮 `git show 080aa4c:…`；第九轮 `git show 328ee60:…`；第八轮 `git show f02aca4:…`；第七轮 `git show 0211ced:…`；第六轮 `git show 5a87a86:…`；第五轮 `git show 411d04f:…`；第四轮 `git show a8daa6d:…`；第三轮 `git show c4763d5:…`；第二/一轮 `git show 785bdd6:…`。
