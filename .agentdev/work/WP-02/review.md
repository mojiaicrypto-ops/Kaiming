# WP-02 独立 Review 报告（第九轮）

- 评审对象：工作包 WP-02「主管与独立Agent调度」
- 评审轮次：**第九轮**（逐条复核第八轮 R8-01..R8-09 是否真修，并找新问题）
- 冻结点：git `328ee60`（`fix(core): WP-02 review round 8 findings (R8-01..R8-09)`），前置 `4580c02`
- HEAD 校验：`git rev-parse HEAD` = `328ee60e5c74263fc8c95f03d512273bb4761728`
- 工作树：复核开始时与本报告写入前 `git status --porcelain` 均无输出（`pnpm build` 只写被 `.gitignore` 忽略的 `dist/`）
- 评审角色：Review（独立上下文，未读取任何开发对话；只依据仓库文件、git 对象与我自己的实验）
- 权威依据：`AGENTS.md`、`docs/INDEX.md`、`docs/rules/{workflow,agents}.md`、`docs/architecture/{ARCHITECTURE,data,protocol,reliability,context}.md`、`docs/delivery/{implementation,acceptance}.md`（WP-02 与 AC-043/044/045/046/047/082）、`.agentdev/work/WP-02/{plan,implementation,discovery}.md`、`packages/core/src` 全部 17 个文件（本包改动文件 `orchestrator/run-lifecycle/snapshots` 逐行；`328ee60` 未改动的文件按注释声称与关键分支抽查）、`packages/domain/src`、`packages/contracts/src`（含新增的 `dispatchRequestSchema`/`assessRequestSchema`/`dispatchExtrasSchema`）、`packages/storage/src/schema.ts`、`packages/core/test`
- 方法：逐行核对「注释/记录声称」与代码；在 `/tmp/wp02-r9/` 自建夹具与 8 组实验脚本（`fixture.mjs`、`exp-a..h.mjs`），用 `pnpm build` 产出的 `packages/*/dist` 独立复现（软链 `/tmp/wp02-r9/node_modules/@agentdev/*`），另加 `tsprobe/` 的 TypeScript 编译探针；**不修改产品代码、测试、`docs/**`、`plan/implementation/discovery`**。
- 工具：`node v24.8.0`、`pnpm 12.3.4`

---

## 0. 历史轮次结论摘要（保留，第一至八轮）

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
R7-01＝malformed `DispatchSpec` 抛裸 `TypeError`；R7-02＝`reconcile` 幂等比较忽略 `cost`；R7-03＝`measured:false` 带 cost 被静默丢弃；R7-04＝`reconciliation` 计数恒 1；R7-05＝DC-48 仍写 `costKnown`；R7-06＝DC-35 父状态描述不准；R7-07＝被拒 dispatch 仍落快照行；R7-08＝DC-46 枚举与 `workflow.md` §65 引用错误；R7-09＝级联取消不释放「从未启动」子 Run 的预留。

**第八轮（`328ee60`）FAIL：0×P1、3×P2、6×P3（R8-01..R8-09）。**
R8-01（P2）＝`requestDispatch`（`agent.request_dispatch`/AC-045 入口）无契约校验：畸形 `sourceRefs`/`requiredOutputs` 抛裸 `TypeError`，非字符串 `goal`/`stage`、负 `budgetAllocation`、非字符串 `operationId` 原样落事件；R8-02（P2）＝`assess`（`assessment.submit`）无契约校验：`payload=null`/`riskFlags`/`uncertainties` 抛裸 `TypeError`，非法枚举抛裸 `StorageError/CONSTRAINT_VIOLATION`（不在 `protocol.md` §7 错误表内）；R8-03（P2）＝R7-09 残留：直接取消一个从未启动的 Chief Run 仍留下死预留，零消费取消后 Work 永久 `BUDGET_EXCEEDED`；R8-04（P3）＝R7-07 残留：畸形 `authorizationRef`/`requiredOutputSchemas` 在冻结之后才校验，留下 config/context/dispatch 三行快照，证伪 DC-58；R8-05（P3）＝R7-06 残留：DC-35 正文父状态描述与实测不符；R8-06（P3）＝R7-04/R7-05 记录残留：DC-48 字段清单不完整、DC-52 指向不成立的结论；R8-07（P3）＝R7-08 残留：DC-56 与 T13 仍写不存在的 `workflow.md` §65；R8-08（P3）＝失效引用与注释不实：事件游标顺序记为 `data.md` §5、`contextSelection.readPaths` 字段不存在、「charges tokensUsed」与封顶实现不符；R8-09（P3）＝`dispatch` 的 `contextPayload` 无校验，可写入读不回来的快照行。第十四行给出全文取回方式：`git show 328ee60:.agentdev/work/WP-02/review.md`。

**追溯口径（沿用第五轮 DC-53/DC-56 口径）**：行为/需求缺失＝P1（阻断）；局部质量/维护＝P2；建议＝P3。P2/P3 是否阻断由本轮按 `workflow.md` §6「影响验收则阻断」判定。**R7-09/R8-03 的既有标定**（预算可用性）沿用 P2。

---

## 1. 本轮结论

**FAIL（Review Failed）——第八轮 9 条全部按各自要求修好（R8-01..R8-09 实测 verified，无残留）。本轮新发现 6 条问题：0×P1、1×P2、5×P3，其中 R9-01（P2）为安全门禁静默失效，按 `workflow.md` §6 影响验收，阻断进入独立 Test。**

- **逐条复核（§3）**：R8-01、R8-02、R8-03、R8-04、R8-07、R8-08、R8-09 完全修好（实跑 verified）；R8-05、R8-06 的记录改写与实测逐字一致（实跑 + 静态 verified）。**无一条需要再次返工。**
- **新问题（§4）**：
  - **R9-01（P2，阻断）**：`assess` 的 L3 底线只认识 8 个内部英文 camelCase 风险旗标（外加 `operation_touches_environment`），而 `Assessment.riskFlags` 在 `data.md` 里是自由字符串、`workflow.md` §2.3 用的是中文措辞。用中文、kebab-case、大小写变体或拼写错误提交风险旗标时，`assess` **静默按 L2 通过**（不报错、不要求 `authorizationRef`）——`workflow.md` §2 的安全边界/身份权限等 L3 门禁可被一个契约上完全合法的载荷绕过。DC-37/RE-11 与 T3 声称「L3 底线校验」，实测只对精确拼写成立。
  - **R9-02（P3）**：`dispatchRequestSchema` 的约束与 `protocol.md` §1/§6 及同包导出的 `DispatchRequestInput` 接口四处不一致：`workId`/`reason`/`sourceRefs` 被写成可选（§6 无 `?`，§1 规定必填缺失 → `VALIDATION_ERROR`）；`sourceRefs[].version` 由 Schema 强制必填，而接口声明为可选（tsc 探针接受、运行期拒绝，`orchestrator.ts:511` 的 `ref.version ?? '1'` 已成死代码）；`stage` 只校验非空字符串，任意字符串可落事件；`operationId` 无 §1 的 1–128 长度约束。
  - **R9-03（P3）**：`dispatchExtrasSchema` 只覆盖 `authorizationRef`/`requiredOutputSchemas`/`contextPayload` 三个冻结输入，第四个 `runParams`（`agents.md` §5 的「已授权 Run 参数」层）未纳入：`runParams: 5`/`true`/`[]` 被接受并**静默忽略**（Run 按 Project/全局档创建）；`runParams: {contextLimit:-5}` 等非法对象报 `PROVIDER_UNAVAILABLE`（「role backend has no usable model」），把一个坏请求说成 provider 不可用，而非 `VALIDATION_ERROR`。
  - **R9-04（P3）**：`assess` 校验 `payload.goal`（`data.md` §3 Assessment 必填、`assessmentPayloadSchema` 必填）后**静默丢弃**——`assessment` 行无 `goal` 列、`assessment.saved` 也不带，路由记录无法回答「这次评估是关于什么的」；`data.md` §2 行定义与 §3 结构定义自身不一致。
  - **R9-05（P3，WP-01 表面）**：`packages/core/src/auth.ts:342` 的注释「`Secure` is set for remote deployments, and for any explicit https origin」与实现 `return this.config.deployment === 'remote'` 不符（行为本身已被第一包 Review 接受，仅注释过度声称）。
  - **R9-06（P3）**：`JoinCoordinator.pageChief` 用 `canParentDispatch(parent.status)` 决定是否留待办，而 `paused`/`interrupted`/`recovery_required` 不在 `ACTIVE_PARENT_STATUSES` 内却在 `workflow.md` §5.3 里可以回到 `running`。Chief 处于这些状态时 required 子 Run 失败 → 只返回 `blocked`、**不留 `chief_action_required`**；恢复后 `state()` 仍是 `blocked` 但 `chiefTodo` 为空，除外部再次调用 `onChildSettled` 外没有补偿路径。
- **判定**：R9-01 是安全门禁的静默失效（无错误、无提示、契约上合法），按 `workflow.md` §6「影响验收则阻断」**阻断进入独立 Test**。若产品方明确接受自由 `riskFlags` 语义并登记 `accepted_risk`，则本轮只剩 5 条 P3（契约/记录一致性 3 条 + 注释 1 条 + Join 待办 1 条），均不阻断，届时 Review 可通过；但「谁定义风险旗标词表」本身需要产品决定，不能由开发方自行改语义。

---

## 2. 契约命令原始结果（本轮实跑）

执行方式：`export PATH="$HOME/.local/bin:$PATH"`，在仓库根目录按序执行，逐条记录退出码（完整输出存于 `/tmp/wp02-r9/cmds.log`）。

| 命令 | 退出码 | 原始结果要点 |
|---|---|---|
| `pnpm typecheck` | **0** | `$ tsc -p tsconfig.json --pretty false`，无输出 |
| `pnpm lint` | **0** | `Checking formatting...` / `All matched files use Prettier code style!` |
| `pnpm test:unit` | **0** | `Test Files 17 passed (17)` / `Tests 230 passed (230)` / `Duration 5.97s` |
| `pnpm test:integration` | **0** | `Test Files 10 passed (10)` / `Tests 124 passed (124)` / `Duration 71.97s`（其中 `apps/cli/test/doctor.integration.test.ts` 8 例 37.0s、`apps/cli/test/container.integration.test.ts` 9 例 70.7s，为真实容器用例） |
| `pnpm docs:check` | **0** | `docs:check ok — 15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages` |
| `pnpm build` | **0** | `packages/{contracts,domain,storage,core,pi-runtime}`、`apps/{cli,runner}` 共 7 个 workspace `build: Done` |
| `git status --porcelain` | — | 复核开始与报告写入前均**无输出**（干净） |
| `git rev-parse HEAD` | — | `328ee60e5c74263fc8c95f03d512273bb4761728`（= 冻结点） |

**自建实验（全部通过，探针记录观察值）**：`exp-a` 23 passed / 0 failed、`exp-b` 20/0、`exp-c` 20/0、`exp-d` 13/0、`exp-e` 16/0、`exp-f` 9/0、`exp-g` 5/0、`exp-h` 4/0，合计 **110 条断言，0 失败**。TS 探针：`tsprobe/probe.ts`（tsc 退出 0，证明接口接受无 `version` 的 `sourceRefs` 与缺 `workId/reason/sourceRefs` 的请求）；`tsprobe/probe2.ts` 负对照退出 1（`TS2741: Property 'goal' is missing`），证明类型映射真实生效。

---

## 3. 逐条复核表（R8-01..R8-09）

| 条目 | 前轮定级 | 前轮要求 | 本轮实测证据（命令/脚本） | 判定 |
|---|---|---|---|---|
| **R8-01** `requestDispatch` 无契约校验 | P2 | 入口用 `strictObject` Schema 校验，畸形输入与非法枚举统一 `VALIDATION_ERROR`，不留 Chief 待办 | `exp-a`：19 种畸形输入（`sourceRefs` 字符串/`[null]`、`requiredOutputs` 数字、`goal` 数字/空、`stage` 数字、`budgetAllocation:-5`、`operationId` 数字、`requestedRole` 未知/`chief`、`workId` 非 UUID、`requiredChild` 字符串、未知字段、缺 `runId`/`goal`/`requestedRole`、`null`、数字）**全部 `ProtocolError/VALIDATION_ERROR`**；`chief_action_required` 计数不变；Run/snapshot 计数不变；正例仍产生 1 条待办。代码核对：`orchestrator.ts:463` 入口首行 `parseOrFail(dispatchRequestSchema, ...)`，`structures.ts:254-268` 为 `strictObject` | **完全修好 ✓** |
| **R8-02** `assess` 无契约校验 | P2 | 同上，非法枚举不得落 `StorageError/CONSTRAINT_VIOLATION` | `exp-b`：17 种畸形输入（`payload` `null`/`undefined`/数字/数组、`riskFlags`/`uncertainties` 非数组、`level:'B2'`、`intent` 非法、`scope:null`、`policyRevision:-1`、未知字段、`workId` 非法、`null`、数字）**全部 `VALIDATION_ERROR`**；assessment 行与事件计数不变；正例落 1 行；L3 底线仍 `VALIDATION_ERROR`。代码：`orchestrator.ts:226` 首行 `parseOrFail(assessRequestSchema, ...)`，`structures.ts:272-276` | **完全修好 ✓** |
| **R8-03** 零消费取消的死预留 | P2 | 无 Attempt ⇒ 已知零用量，取消即释放该 Run 自身预留 | `exp-d`：取消未启动 Chief 后 `tokensReserved` 由 14000 → **0**（父+子同时释放），`run.ended` 记 `usageMeasured:true`/`runCostKnown:true`/`releasedTokens=10000`/`tokensUsed:0`；随后同额 10000 派发**成功**；已 `beginAttempt` 的 Run 取消仍保持预留且 `usageMeasured:false`；实测用量取消正常核销（release 全额、charge 1200）；未启动的专业 Run 同理释放；`reconcile(0)` 幂等无操作、`reconcile(10)` → `IDEMPOTENCY_CONFLICT`。代码：`run-lifecycle.ts:180-195` `settle()` 取消分支改走 `cancel(runId, usage)`，`initialUsage` 已抽成单一判据（DC-57） | **完全修好 ✓** |
| **R8-04** 被拒 dispatch 留快照行 | P3 | 在校验/准入全部通过前不冻结任何快照 | `exp-c`：13 种畸形 extras（`authorizationRef` 非 UUID/数字、`requiredOutputSchemas` 缺 `schemaVersion`/字符串/`schemaVersion:2`、`contextPayload` 数组/字符串/数字/`null`/含 `undefined`/含函数/`NaN`/`Infinity`）**全部 `VALIDATION_ERROR`**，且 `runs`/`snapshots`/`config`/`context`/`dispatch` 五类计数**零增长**；正例仍冻结三种快照并可读回。代码：`orchestrator.ts:300-312` 在任何 `freeze` 之前校验 | **完全修好 ✓**（DC-58 的绝对声明在单线程准入下成立；并发例外见 §6） |
| **R8-05** DC-35 父状态描述不准 | P3 | 改为实测语义（只有 `join=all` 在场才进 `waiting_children`；required 失败保持当前状态） | `exp-e`：单个 required 失败 → 父**从未进入** `waiting_children`，停留 `running`；一个失败 + 兄弟在场 → 父 `waiting_children`，兄弟终态后 `kind=blocked` 且父**停留 `waiting_children`**（不是「回到 running」）；全成功 → `ready` + 父回 `running`。`discovery.md:51-55`（DC-35）逐句与上述三例一致 | **完全修好 ✓** |
| **R8-06** DC-48 字段清单/DC-52 指向 | P3 | 完整字段表 + 字段层级 + 排序语义；DC-52 指向 DC-48 | `exp-e` 四条路径实测：常规终态含 `outcome,workId,tokensUsed,chargedTokens,uncoveredTokens,usageMeasured,runCostKnown,releasedTokens,cost` 九项且 `charged+released=预留`；`contract_violation` 另含 `attemptId/rejections/reason` 且保持 `usageMeasured:false`；核销补发第二条 `run.ended` 含 `reconciled:true`；级联取消子 Run 含 `cancelledWithParent`；同一 Run 两条 `run.ended` 的 `entityVersion` 相同、`cursor` 严格递增。`discovery.md:124-140`（DC-48）与之一致，DC-52 已指向 DC-48 | **完全修好 ✓** |
| **R8-07** `workflow.md` §65 引用 | P3 | 改为 §6（第 65 行） | `grep -rn "§65" .agentdev docs` 只剩 `implementation.md:155`（T16 自身描述「改为 §6」）与本报告；DC-56/T13 正文均已为 §6；`workflow.md` 目录实为 §1..§8，严重性定义在 §6（`sed -n '55,95p'` 核实） | **完全修好 ✓** |
| **R8-08** 失效引用/注释不实（三处） | P3 | `data.md` §5→§2、`readPaths`→`codePaths`、「charges tokensUsed」→ 封顶后的 `chargedTokens` | ① `run-lifecycle.ts:7` 现为「charges `chargedTokens`」，与 `:283` 的 `chargedTokens: charged` 一致；② `run-lifecycle.ts:275` 现为「`data.md` §2」，`data.md:39` 确有 `cursor单调`；③ `orchestrator.ts:294` 现为 `contextSelection.codePaths`，`structures.ts:57` 确有 `codePaths`（`readPaths` 属 `scopeSchema`）。`grep -rn "readPaths" packages/core/src` 无命中 | **完全修好 ✓** |
| **R8-09** `contextPayload` 无校验可写坏快照 | P3 | 冻结前校验 `contextPayload`；`SnapshotWriter.freeze` 兜底拒绝非对象 | `exp-c`：`contextPayload` 数组/字符串/数字/`null`/含 `undefined`/含函数/`NaN`/`Infinity` 全部 `VALIDATION_ERROR`、零快照；直接调 `SnapshotWriter.freeze('context', ['not','an','object'])` → `StorageError/CONSTRAINT_VIOLATION` + `details.code='SNAPSHOT_PAYLOAD_INVALID'`；有效 JSON 对象仍可冻结并 `byType('context')` 读回。代码：`structures.ts:238-244` + `snapshots.ts:72-80` | **完全修好 ✓** |

**记录与代码一致性（本轮核对结论）**：`implementation.md:146-157`（T16）七条声明逐条与代码一致；`discovery.md:182-196`（DC-57/58/59）与代码一致（DC-59 三个入口「只在 `protocol.md` §7 错误表内失败」经复核成立——`assess`/`requestDispatch`/`dispatch` 的失败路径全部映射到 `ProtocolErrorCode`，未发现新的裸 `TypeError`/`StorageError` 逃逸）。

---

## 4. 新 Findings（R9-01..R9-06）

### R9-01 [P2] L3 风险底线只认未公开的内部英文旗标；其它拼写静默降级为 L2

- **位置**：`packages/core/src/orchestrator.ts:147-162`（`riskFromFlags`：`if (flag in risk) risk[flag] = true`，**未知旗标直接忽略**）、`orchestrator.ts:232-246`（L3 底线判定）、`orchestrator.ts:236-237`（另一个内部旗标 `operation_touches_environment`）；契约侧 `packages/contracts/src/entities/structures.ts:42`（`riskFlags: list(z.string().min(1))`，自由字符串）；文档侧 `docs/rules/workflow.md:10`（§2 第 3 步用中文列举 L3 风险：身份认证、权限判断、Secret、安全边界、数据删除/迁移、支付金额/状态、公开协议不兼容、部署/发布、项目门禁规则变化；`data.md:55` 定义为 `riskFlags:string[]`）。
- **事实（`exp-f` X-5，实跑）**：同一 `delivery` + `level:'L2'` 载荷，只改 `riskFlags[0]`：

  | 提交的旗标 | 实测结果 |
  |---|---|
  | `securityBoundary`（内部英文键） | `VALIDATION_ERROR`（L3 底线生效） |
  | `安全边界`（`workflow.md` §2.3 的原词） | **ACCEPTED，level=L2**（无授权亦通过） |
  | `securityBoundry`（拼写错误） | **ACCEPTED，level=L2** |
  | `security-boundary`（kebab-case） | **ACCEPTED，level=L2** |
  | `SECURITYBOUNDARY`（全大写） | **ACCEPTED，level=L2** |

  即 `assess` 记为 L2 且不需要 `authorizationRef`，`assessment.saved` 的 `decidedLevel` 亦为 L2。全仓检索（排除 `node_modules`/`dist`）确认该词表除测试夹具（`orchestrator.test.ts:535,553` 的 `'securityBoundary'`）外只出现在 `domain/src/routing.ts` 的 `LockdownRisk` 字段名与 `orchestrator.ts:146-162`，`docs/**` 从未定义；`riskFlags` 在契约上是任意字符串，所以上述载荷**都是契约允许的合法输入**。
- **影响**：`workflow.md` §2.3 的 L3 门禁是安全相关底线（身份/权限/Secret/安全边界/删数据/支付/协议破坏/部署/门禁规则）。DC-37/RE-11 与 T3 声称「`assess` 调用 `decideLevel` 做 L3 底线校验」；实测该底线**只对开发方自己的测试拼写成立**，对文档措辞与任何合理变体静默失效（fail-open，无错误码、无事件标注）。后续 WP 的 Chief 若按 `workflow.md` 写 `riskFlags`，安全边界变更会被记为 L2。
- **建议**：三选一并记录产品决定——(a) 把风险旗标词表发布为契约枚举（`data.md`/`structures.ts`），未知值 `VALIDATION_ERROR`；(b) 保守 fail-closed：任何非空 `riskFlags` 一律按对应 lockdown 风险参与 L3 判定，或未知旗标直接拒绝；(c) 显式接受自由字符串语义并登记 `accepted_risk`，同时在 DC 中写明「Core 不做词表校验，Chief 必须使用 `LockdownRisk` 键名」。任一选择都需同步 `discovery.md` 的 RE-11 表述与测试。
- **是否阻断**：**阻断**。这是文档化安全门禁的静默失效，属 `workflow.md` §6「影响验收则阻断」；且修复方向涉及产品语义，需产品方确认（不可由开发方自行改规则）。

### R9-02 [P3] `dispatchRequestSchema` 与 `protocol.md` §1/§6 及 `DispatchRequestInput` 接口四处不一致

- **位置**：`packages/contracts/src/entities/structures.ts:246-269`（新 Schema）对比 `packages/core/src/orchestrator.ts:118-137`（导出的 `DispatchRequestInput`）、`packages/contracts/src/primitives.ts:112-118`（`sourceRefSchema` 的 `version` 必填）、`packages/contracts/src/protocol.ts:26-29`（`idempotencyKeySchema` 1–128 字符）、`docs/architecture/protocol.md:10`（§1：必填缺失/未知字段/枚举错误 → `VALIDATION_ERROR`）与 `:106`（§6：`agent.request_dispatch* | workId,reason,requestedRole,goal,sourceRefs`，五个参数均无 `?`）。
- **事实（`exp-a` X-1、`exp-f` X-3、`tsprobe`，实跑）**：
  1. `workId`/`reason`/`sourceRefs` 在 Schema 中是 `.optional()`：`requestDispatch({runId,requestedRole:'review',goal:'do it'})` **被接受**（分别缺三个 §6 必填参数）；DC-59/T16 却声称 Schema「覆盖 `protocol.md` §6 的 `workId,reason,requestedRole,goal,sourceRefs`」。
  2. `sourceRefs[].version`：`tsprobe/probe.ts` 用接口写法 `sourceRefs:[{kind:'message',id:'…'}]` **tsc 退出 0**（`DispatchRequestInput` 声明 `version?: string`），同一调用运行期 `VALIDATION_ERROR: sourceRefs.0.version: expected string, received undefined`；因此 `orchestrator.ts:511` 的 `version: ref.version ?? '1'` 是**不可达的死代码**（`exp-a` X-1）。
  3. `stage: z.string().min(1).optional()`：`requestDispatch({..., stage:'nonsense-stage'})` **被接受**，且 `exp-f` X-3 从 `chief_action_required` 事件里读回 `stage:'nonsense-stage'`（仓库内 `taskStageSchema` 已是枚举）——与 R8-01「bad field values must not be persisted into `chief_action_required`」的目标不符。
  4. `operationId: z.string().min(1).optional()`：`exp-g` X-7 提交 200 字符 `operationId` **被接受**，未用同包已有的 `idempotencyKeySchema`（1–128）。
- **影响**：契约入口对上游「必填/类型」的承诺比文档更松（漏校验），同时对下游 TS 调用方比接口更严（合法类型被运行期拒绝）；两条方向都会让 WP-03/协议接线阶段产生误判。不改变已通过的安全性，但影响契约可信度。
- **建议**：把三个 §6 必填参数改为必填（或在 DC 中显式记录「实现允许省略」的偏离并同步 `data.md`/`protocol.md`）；`version` 或接口或 Schema 二者取一并统一（推荐 Schema 保留必填、接口删掉 `?`、删除死代码）；`stage` 改用 `taskStageSchema`；`operationId` 改用 `idempotencyKeySchema`。

### R9-03 [P3] `runParams` 是唯一未被 `dispatchExtrasSchema` 覆盖的冻结输入：非对象静默忽略、非法对象报错码误导

- **位置**：`packages/core/src/orchestrator.ts:292-312`（`extras` 只组装 `authorizationRef`/`requiredOutputSchemas`/`contextPayload`）、`orchestrator.ts:356`（`gateway.availability(role, input.runParams ?? {})`）、`orchestrator.ts:376`（`config.freeze(role, input.runParams ?? {})`）、`packages/contracts/src/entities/structures.ts:238-244`；`docs/rules/agents.md` §5（Run 参数→Project→全局角色→全局默认）。
- **事实（`exp-f` X-2，实跑，每个探针独立夹具）**：

  | `runParams` | 实测 |
  |---|---|
  | `5`、`true`、`[]` | **ACCEPTED**，Run `queued`；与省略 `runParams` 的冻结 config 快照 hash 相同 → 该层被**静默丢弃** |
  | `null` | ACCEPTED（`?? {}`，等价省略） |
  | `{contextLimit:-5}` | REJECTED `PROVIDER_UNAVAILABLE`：「role backend has no usable model: … contextLimit: Too small」 |
  | `'oops'` | REJECTED `PROVIDER_UNAVAILABLE`：「… Unrecognized keys: "0","1","2","3"」 |
  | `{providerId:'not-a-uuid'}` | REJECTED `PROVIDER_UNAVAILABLE`（「expected a lowercase UUIDv7」） |
  | `{bogus:1}`、`{reasoning:'hyper'}` | REJECTED `PROVIDER_UNAVAILABLE` |

  非法对象走的是 `config.resolve` 的 `PROVIDER_UNAVAILABLE` 分支（`config.ts:392-401`），错误消息把「请求字段非法」说成「该角色没有可用模型」——provider 明明存在且启用。
- **影响**：`runParams` 是 `agents.md` §5 中**最强**的配置层（已授权 Run 参数）。当前实现要么静默忽略它（非对象），要么用一个语义错误的状态码拒绝（非法对象）。可达性当前有限（`dispatch` 是 Core 内部入口，TS 类型排除非对象），因此定 P3；但一旦 WP-04/WP-07 从协议 JSON 绑定 `runParams`，静默忽略会变成 P2。
- **建议**：把 `runParams` 一并纳入冻结输入校验（`profileLayerSchema` 或复用 `profileSchema.partial()`），非法值统一 `VALIDATION_ERROR`，并在 DC-59 的清单中显式列出四个冻结输入而不是三个。

### R9-04 [P3] `assess` 校验后静默丢弃 `goal`；`data.md` §2 行与 §3 结构自相矛盾

- **位置**：`packages/core/src/orchestrator.ts:253-279`（insert 与 `assessment.saved` 都不含 `goal`）、`packages/contracts/src/entities/structures.ts:36-47`（`assessmentPayloadSchema` 要求 `goal`）、`packages/storage/src/schema.ts:201-211`（`assessment` 表无 `goal` 列）、`docs/architecture/data.md:25`（§2 行定义无 `goal`）对比 `docs/architecture/data.md:55`（§3 Assessment 结构含 `goal`）。
- **事实（`exp-f` X-4，实跑）**：`assess({workId, payload:{goal:'ship WP-02', …}})` 成功；`assessment` 行键为 `createdAt,id,intent,level,policyRevision,projectId,reason,riskFlags,semanticImpact,uncertainties,updatedAt,version,workId`（**无 `goal`**）；`assessment.saved` data 键为 `decidedLevel,decidedReason,intent,level,semanticImpact,workId`（**无 `goal`**）。
- **影响**：Chief 的评估目标在协议上必填、校验通过后无任何持久痕迹（既不落行也不进事件），与 R7-03 已确立的「不得静默丢弃字段」原则不一致；根因是 `data.md` §2 与 §3 对 Assessment 的定义不同，属契约自身不一致，需要产品方决定「落库还是从结构里去掉」。
- **建议**：二选一并记录产品决定——(a) 给 `assessment` 行与 `assessment.saved` 增加 `goal`（`data.md` §2 行同步）；(b) 从 `assessmentPayloadSchema`/`data.md` §3 移除 `goal`。任一选择都属产品语义变更，需用户确认。

### R9-05 [P3] `auth.ts` `secureCookies` 注释过度声称（WP-01 表面，仅注释）

- **位置**：`packages/core/src/auth.ts:342-345`。
- **事实**：注释「`Secure` is set for remote deployments, and for any explicit https origin.」；实现仅 `return this.config.deployment === 'remote';`，不读取 origin。`cookieFor`/`expiredCookie` 只在 `secureCookies` 为真时追加 `Secure`。`docs/architecture/protocol.md` §2「远程部署HTTPS必需；loopback开发允许http」，故**行为本身是正确的**（loopback 加 `Secure` 反而会坏），只有「any explicit https origin」这半句无代码支撑。
- **影响**：注释级不一致，无功能影响；WP-01 的第一包 Review 已按「remote 加 Secure」接受该行为。
- **建议**：删掉「and for any explicit https origin」，或补一条 DC 说明该决定。

### R9-06 [P3] 父 Run 处于 `paused`/`interrupted`/`recovery_required` 时，required 失败的 Chief 待办永久缺失

- **位置**：`packages/core/src/join.ts:234-245`（`pageChief` 里 `if (!RunLifecycle.canParentDispatch(parent.status)) return undefined;`）、`packages/core/src/run-lifecycle.ts:25-30`（`ACTIVE_PARENT_STATUSES = queued,starting,running,waiting_children`）、`docs/rules/workflow.md:55`（§5.3：`paused`/`interrupted`/`recovery_required` 都可回到 `running`）。
- **事实（`exp-h`，实跑）**：Chief 已 `running` 且有 1 个 required 子 Run；把 Chief 置为 `paused`（`workflow.md` §5.3 允许 `running → paused`，`protocol.md` §4 有 `run.pause`）后再把子 Run 结算为 `failed`：
  - `onChildSettled(child)` 返回 `kind:'blocked'`、`chiefTodo:''`，`chief_action_required` 计数 **0**（H-2）；
  - 把 Chief 恢复为 `running` 后 `state(chief)` 仍 `blocked` 但 `chiefTodo:''`、事件数仍 **0**（H-3）——`state()` 是只读的，没有任何代码在恢复时补发；
  - 只有外部**再次**调用 `onChildSettled(child)` 才会补上该待办（H-4）。
- **影响**：R5-05 修掉了「已终结父 Run 留下孤儿待办」，但把判据取成 `canParentDispatch`，同时把「暂时不可派发、之后会恢复」的父 Run 一起排除。这类父 Run 的 required 失败不会通知 Chief（`pageChief` 携带的「全部子结果」也随之丢失），`agents.md` §3 / AC-046 的「Chief 获得全部结果 + Gate 阻断」只剩返回值可查。相关状态目前由 WP-05 驱动，故定 P3。
- **建议**：区分「终态/取消中」（不留待办）与「临时不可派发」（留待办或恢复时补发）；或在 `onChildSettled`/`state` 之外提供一个幂等的「重新汇总」入口，并把 WP-05 的恢复路径接上。

---

## 5. 其它观察（不计入 Finding 编号）

1. `dispatch` 的 `DispatchInput` 未用 `strictObject`：`exp-f` X-6 实测 `dispatch({spec, unexpectedKey:'ignored'})` 被接受并忽略（`requestDispatch`/`assess` 均为 strict）。因 `agent.dispatch` 的协议参数是 `ProfessionalDispatchSpec`（已由 `dispatchSpecSchema` 严格校验），影响仅限于 Core 内部调用形态，属一致性瑕疵。
2. 被外部破坏的快照行仍以裸 `ZodError` 在读路径抛出：`exp-g` X-8 手工插入 `payload='["not","an","object"]'` 后 `snapshots.byType('context')` → `ZodError`。写入路径已被 R8-09 堵住，读路径的兜底仍缺（沿用前几轮的「外部破坏」剩余风险）。
3. `discovery.md:124-140`（DC-48）把 `timed_out`/`interrupted` 列为「常规终态」的 `run.ended` 路径，但 `RunLifecycle.settle` 的公开参数类型只有 `completed|failed|cancelled`，WP-02 内无路径产生这两个状态的 `run.ended`（表描述的是 `applyEnd` 的通用形状，非虚假声明，但读者会误以为可达）。
4. DC-58「被拒绝的 dispatch 不留任何副作用」只在**单线程准入**下成立：`config`/`context`/`dispatch` 三个快照在事务**之外**冻结（`orchestrator.ts:376-404`），事务内 `reserve`/`attachChild` 失败（并发抢预算、版本 CAS 冲突）仍会留下快照行。本轮未构造出单线程可达的反例，沿用前几轮「并发未验证」的剩余风险。
5. `plan.md`（planVersion 3）的 writePaths 已含 `packages/contracts/src/entities/structures.ts`（第 28 行）与 `packages/core/test/**`，故 T16 的新增代码在授权范围内；但 plan 的「接口与数据影响」一节未登记 `dispatchRequestSchema`/`assessRequestSchema`/`dispatchExtrasSchema`（仅说明性缺口，不构成越界写入）。
6. T9 仍未完成：`docs/INDEX.md`「实现起点」仍写「Work/Run 执行编排……仍未实现」，`docs/delivery/acceptance.md` 无 WP-02 的 AC 证据登记。属 Test/Settlement 阶段事项，本轮不改判。

---

## 6. 剩余风险（未闭环，供 Test/Settlement 与产品方判断）

1. **并发未验证**：预算准入检查（`orchestrator.ts:350-353`）与事务内 `reserve`（`:414`）之间存在窗口；单 mailbox 串行假设下不可达，多连接/多进程下的双花与「快照已落、Run 未建」未被测试覆盖。
2. `budget.tokensReserved` 释放用 `Math.max(0, …)` 夹取，理论上掩盖超释放而非报错（沿用前轮）。
3. `timed_out`/`interrupted`/`recovery_required` 终态无产生路径（WP-05 职责），本包测试不可覆盖。
4. `ModelGateway` 的真实 HTTP、Secret 解析与 `testConnection` 真连属 WP-07/WP-10（DC-31）；`Work blocked(provider)` 投影属 WP-05（DC-42）。
5. `runParams` 的授权来源（DC-38）仍缺 Authorization 实体绑定，`runParams` 目前只有 Core 调用方可提供（R9-03 的可达性前提）。
6. 快照读路径对**外部破坏**的行仍抛裸 `ZodError`（§5 第 2 条）；写路径已兜底。
7. N-11 产品决定仍在：`data.md:30` 的三个 `:ID` 快照引用与实现的哈希并存，属 `Product Decision Pending`。
8. 本轮新增待产品方决定项：R9-01（风险旗标词表）、R9-04（`Assessment.goal` 是否落库）。

---

## 7. 方法与边界声明

- 本报告只依据仓库文件、`328ee60` 上的 git 对象/差异与实跑命令；未读取任何开发对话、未引用外部同名技能或历史方案。
- 阅读深度：`orchestrator.ts`、`run-lifecycle.ts`、`join.ts`、`snapshots.ts`、`events.ts`、`errors.ts`、`index.ts`、`events-hub.ts`、`auth.ts`、`identity.ts` 逐行；`config.ts`、`mailbox.ts`、`model-gateway.ts`、`requirements.ts`、`toml.ts`、`stage.ts`、`dispatcher.ts` 按注释声称与关键分支抽查（这七个文件在 `328ee60` 中未改动，且由前八轮与本轮全量测试覆盖）。R8-01..R8-09 的判定不依赖对未改动文件的推断。
- 唯一写入文件为本文件 `.agentdev/work/WP-02/review.md`；实验脚本独立写在 `/tmp/wp02-r9/`（`fixture.mjs`、`exp-a..h.mjs`、`tsprobe/{tsconfig,probe,probe2}.ts` 与 `exp-a..h.log`、`cmds.log`），使用 `pnpm build` 产出的 `packages/*/dist`，通过 `/tmp/wp02-r9/node_modules/@agentdev/*` 软链解析 workspace 包，等价复现 `orchestrator.test.ts` 的夹具但**不 import 任何产品测试文件**。
- 未修改产品代码、测试、`docs/**`、`plan.md`、`implementation.md`、`discovery.md`；`pnpm build` 只写 `.gitignore` 中的 `dist/`。写入本报告前 `git status --porcelain` 无输出、`HEAD=328ee60e5c74263fc8c95f03d512273bb4761728`。
- 本报告覆盖了第八轮 `review.md`；第八轮全文可用 `git show 328ee60:.agentdev/work/WP-02/review.md` 取回，第七/六/五/四/三/二/一轮分别用 `git show f02aca4:…`（即 `f02aca4` 树上的本文件）、`git show 0211ced:…`、`git show 5a87a86:…`、`git show 411d04f:…`、`git show a8daa6d:…`、`git show c4763d5:…`、`git show 785bdd6:…` 取回。
