# WP-02 独立 Review 报告（第十三轮）

- 评审对象：工作包 WP-02「主管与独立Agent调度」
- 评审轮次：**第十三轮**（逐条复核第十二轮 R12-01..R12-05 与第十二轮对抗性核验两项是否真修，核对注释/记录声称与代码是否一致，并找新问题）
- 冻结点：git `e3b210c`（`fix(core): WP-02 review round 12 findings (R12-01..R12-05)`），前置 `fec9a9d`
- HEAD 校验：`git rev-parse HEAD` = `e3b210c29cd1bee34a5834e82908a70734201abc`；`git log -1` = `e3b210c fix(core): WP-02 review round 12 findings (R12-01..R12-05)`
- 工作树：复核开始与本报告写入前 `git status --porcelain` 均无输出（`pnpm build` 只写被 `.gitignore` 忽略的 `dist/`）
- 评审角色：Review（独立上下文，未读取任何开发对话；只依据仓库文件、git 对象与我自己的实验）
- 权威依据：`AGENTS.md`、`docs/rules/{workflow,agents}.md`、`docs/architecture/{ARCHITECTURE,data,protocol,reliability,context}.md`、`docs/delivery/{implementation,acceptance}.md`（WP-02 与 AC-043/044/045/046/047/082）、`.agentdev/work/WP-02/{plan,implementation,discovery}.md` 全部记录、`packages/core/src` 全部 17 个文件、`packages/domain/src` 全部、`packages/contracts/src/entities/{structures,work}.ts` 与 `primitives.ts`、`packages/core/test`
- 方法：逐行核对「注释/记录/提交信息声称」与代码；在 `/tmp/wp02r13/` 自建夹具与 7 组实验脚本（`fixture.mjs`、`lib.mjs`、`exp1..exp7.mjs`），用 `pnpm build` 产出的 `packages/*/dist` 独立复现（软链 `/tmp/wp02r13/node_modules/@agentdev/*`）；**不修改产品代码、测试、`docs/**`、`plan/implementation/discovery`**
- 工具：`node v24.8.0`、`pnpm 12.3.4`

---

## 0. 历史轮次结论摘要（保留，第一至十二轮）

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

**第十二轮（`fec9a9d`）FAIL：0×P1、2×P2、3×P3（R12-01..R12-05）＋对抗性核验两项。**
R12-01（P2，阻断）＝`dispatch` 只按 `work.level` 查授权，不按 DispatchSpec 自身 `scope` 施 L3 底线，L1/L2/`none` Work 可零授权派出 `deploy`/`delete_data`/网络写入 Run；R12-02（P2，阻断）＝授权 `operations`/`scope` 不参与判定，只读授权可为 `delete_data` 派发背书；R12-03（P3）＝Work 级授权的核对结果未冻结进 DispatchSnapshot；R12-04（P3）＝`verifyAuthorization` JSDoc 与调用点不符；R12-05（P3）＝DC-62 仍写环境操作集合在 core。**对抗性两项**：①`none` 级 Work 可派写权限 Run 且 `grantsModificationAuthority` 是死代码；②风险词表斜杠归一未生效。全文：`git show fec9a9d:.agentdev/work/WP-02/review.md`。

**追溯口径（沿用第五轮 DC-53/DC-56 口径）**：行为/需求缺失＝P1（阻断）；局部质量/维护＝P2；建议＝P3。P2/P3 是否阻断由本轮按 `workflow.md` §6（第 65 行）「影响验收则阻断」判定。**L3/授权门禁类缺陷沿用 R9-01/R10-01/R11-01/R11-03/R12-01/R12-02 的 P2 标定**（按 §6 字面「错误行为/需求缺失」亦可判 P1；两者都阻断，本轮保持既有标定以免口径漂移）。

---

## 1. 本轮结论

**FAIL（Review Failed）——第十二轮的两条阻断项里，R12-01（Run 建立边界按 spec scope 施 L3 底线）、R12-03、R12-04、R12-05 与对抗性②实测真修好；R12-02 只修好 `operations`/`networkTargets` 两个维度，同一个 `scope` 对象里的 `writePaths`/`readPaths` 仍完全不参与判定（R13-01）；对抗性①只修好「纯写范围」这一半，只要同一 spec 再声明一个被授权的环境操作，`none` 级 Work 仍能冻结带 `writePaths` 的 Run（R13-02）。本轮另发现 1 处非协议错误码 + 孤儿快照（R13-03）与 3 处记录/注释/测试不符（R13-04/R13-05/R13-06）。本轮共 **0×P1、3×P2、3×P3（R13-01..R13-06）**，其中 R13-01、R13-02 按 `workflow.md` §6「影响验收则阻断」判为阻断，**阻断进入独立 Test**。**

**逐条裁定（详见 §4）**

| 第十二轮条目 | 本轮裁定 |
|---|---|
| **R12-01** Run 建立不按 spec scope 施 L3 底线 | **完全修好 ✓**：`dispatch` 先由 `touchesRunningEnvironment(spec.scope)` 推出 `runLevel`（环境操作/网络目标 ⇒ L3），再用它做授权需求判定（`orchestrator.ts:361-384`）。实跑 34/34（`exp1`）：chief 与 professional spec × `delete_data`/`deploy`/纯 `networkTargets` × `none`/L1/L2/L3-无授权 Work **全部** `NOT_AUTHORIZED: L3 requires an explicit authorizationRef`，Run/快照增量为 0、Assessment 行数为 0；有覆盖授权时接受；跨 Work 授权仍拒；「先按 `deploy` 评估成 L3、再改派 `delete_data`+网络」也被范围覆盖检查拒绝。 |
| **R12-02** 授权范围不参与判定 | **部分修好（`operations`/`networkTargets` ✓，`scope.writePaths`/`readPaths` 仍未实现）**：`verifyAuthorization` 现在比对 spec 的每个 `operations` ∈ 授权 `operations`、每个 `networkTargets` ∈ 授权 `scope.networkTargets`（`orchestrator.ts:787-805`）。实跑（`exp2`）：只读授权 + `delete_data` ⇒ `uncoveredOperations:['delete_data']` 拒绝；未覆盖网络目标 ⇒ `uncoveredNetworkTargets` 拒绝；存在性/同 Work/未撤销未回退。**但**授权 `scope.writePaths` 为空时仍接受 spec 的 `writePaths:['packages/core/src']`（`exp2`/`exp6`），见 R13-01。 |
| **R12-03** 核对结果未冻结 | **完全修好 ✓**：`dispatch` 把实际核对的引用（含 Work 行回退）写入 `DispatchSnapshot.authorizationRef`（`orchestrator.ts:379-384,461`）。实跑（`exp3`/`exp7`）：L3 Work 自带授权、调用方不传 ⇒ 快照与 `recoveryView` 都能重建 `AUTH_L3`，DB 快照 payload 键含 `authorizationRef`，按 `identityPayload` 重冻结幂等（`created:false`、hash 相等）。 |
| **R12-04** JSDoc 与调用点不符 | **修好 ✓（含轻微残余）**：JSDoc 现在写明「when a `scope` is supplied it must cover that scope's operations and network targets」并说明返回被核对的引用（`orchestrator.ts:737-747`）；「dispatch 只知道已给出的引用」的错误表述已删除。残余：参数注释仍写「`undefined` when no level is known yet (an assessment checks what it has)」，而两个调用点（`:290`、`:379`）都传确定等级（`exp4`），属 §5 观察。 |
| **R12-05** DC-62 未写集合归属 | **完全修好 ✓**：DC-62 首条已补「集合 `ENVIRONMENT_OPERATIONS` **定义在 `domain/routing.ts`**，core 只调用」，风险词表句也补了 `数据删除迁移` 等价性（`discovery.md:212-213`，`exp4`）。 |
| **对抗性①** `none` Work 可派写权限 Run、`grantsModificationAuthority` 死代码 | **部分修好**：`grantsModificationAuthority` 已接入（不再死代码），纯写范围（无环境操作）的 chief/professional spec 在 `none` Work 上被拒（`exp5`）。**但**门禁作用在派生 `runLevel` 上：同一 spec 再声明 `operations:['deploy']` 并给出覆盖授权，`none` Work 仍接受 `writePaths:['packages/core/src']`（R13-02）；只声明 `edit`/`write`/`artifact_write` 的 spec 也完全绕过该门禁。 |
| **对抗性②** 风险词表斜杠归一未生效 | **完全修好 ✓**：`normalizeRiskTerm` 现剥离 `/`（`routing.ts:140`）。实跑（`exp5`）：`数据删除迁移`/`数据删除/迁移`、`部署发布`/`部署/发布`、`支付金额状态` 全部识别为同一风险；未登记拼写（`securityBoundry`、`deploy-release`、`部署/发布/回滚`）仍 fail-closed 拒绝；`assess` L2 + 斜杠合并风险仍强制 L3；`assist` + `deploy` 仍未回退。 |

**新发现**：R13-01（授权 `scope.writePaths`/`readPaths` 不参与判定，只读授权可为写范围背书，阻断）、R13-02（`none` Work 写权限门禁作用在派生 `runLevel` 上，声明一个被授权的环境操作即可绕过，阻断）、R13-03（`dispatch` 对显式 `undefined` 可选字段抛非协议错误码 `CONSTRAINT_VIOLATION` 并留下 2 条孤儿快照）、R13-04（DC-63 未同步且与代码相反，提交信息称「DC-62/DC-63 updated」不实）、R13-05（测试引用 DC-65 错号、注释把 `operations:['deploy']` 的授权写成「read-only grant」，R12-02 要求的「只读授权 × 环境操作 ⇒ 拒绝」用例实际缺失）、R13-06（`config.policy.l3Paths`/`l3Keywords` 无任何读取方）。

### 前十二轮阻断项的当前状态（本轮实跑复核）

- 第九轮 R9-01 词表 fail-open、第十轮 R10-01 fail-closed、第十一轮 R11-01：`exp5` 全部仍拒绝（`assess` L2 + 合并风险 ⇒ `VALIDATION_ERROR`；未登记旗标 ⇒ `VALIDATION_ERROR`；`assist` + `deploy` ⇒ `VALIDATION_ERROR`），**未回退**。
- 第十轮 R10-02 / 对抗性 B 授权实体核对：`exp2` 伪造/撤销/跨 Work 全绿，**未回退**。
- 第五至八轮的事件分页、幂等、预算、终态路径：由本轮 242 单测 / 124 集成全绿覆盖，未发现回归（§2）。

---

## 2. 契约命令原始结果（本轮实跑）

执行方式：`export PATH="$HOME/.local/bin:$PATH"`，在仓库根目录按序执行并逐条记录退出码（日志存 `/tmp/wp02r13/*.log`）。

| 命令 | 退出码 | 原始结果要点 |
|---|---|---|
| `pnpm typecheck` | **0** | `tsc -p tsconfig.json --pretty false`，无输出 |
| `pnpm lint` | **0** | `eslint`/Prettier：`Checking formatting...` / `All matched files use Prettier code style!` |
| `pnpm test:unit` | **0** | `Test Files 17 passed (17)` / `Tests 242 passed (242)` / `Duration 6.38s`（与 T20 声称的 242 一致；较第十二轮 +3 条新 `it`） |
| `pnpm test:integration` | **0** | `Test Files 10 passed (10)` / `Tests 124 passed (124)` / `Duration 74.24s`（与 T20 声称的 124 一致） |
| `pnpm docs:check` | **0** | `docs:check ok — 15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages` |
| `pnpm build` | **0** | `packages/{contracts,domain,storage,core,pi-runtime}`、`apps/{cli,runner}` 共 7 个 workspace `build: Done` |
| `git status --porcelain` | — | 复核开始与本报告写入前均**无输出**（干净） |
| `git rev-parse HEAD` | — | `e3b210c29cd1bee34a5834e82908a70734201abc`（= 冻结点） |

**自建实验（观察值记录；`INFO` 行与标记 `EXPECTED-REFUSAL` 的失败项即 Finding 证据）**：
`exp1`（R12-01）34 passed / 0 failed；`exp2`（R12-02）11 / 0；`exp3`（R12-03）6 / 0；`exp4`（记录/注释）1 / 0；`exp5`（对抗性两项 + 新探针）7 passed / **2 failed**（两条均为 `EXPECTED-REFUSAL`，即 R13-02 证据）；`exp6`（畸形输入/死配置）1 / 0；`exp7`（AC-082/严格性/重冻结）2 / 0。脚本与日志存 `/tmp/wp02r13/{fixture,lib,exp1..exp7}.mjs`、`/tmp/wp02r13/exp1..exp7.log`。所有实验用 `pnpm build` 后的 `packages/*/dist`，通过 `/tmp/wp02r13/node_modules/@agentdev/*` 软链解析，**不 import 任何产品测试文件**。

---

## 3. 逐条复核表（第十二轮条目 + 对抗性两项）

| 条目 | 前轮定级 | 本轮实测证据（脚本/观察值） | 判定 |
|---|---|---|---|
| **R12-01** Run 建立不按 spec scope 施 L3 底线 | P2（阻断） | `exp1` A：`none`/L1/L2/L3-无授权 Work × `{operations:['delete_data']}`/`{['deploy']}`/`{networkTargets:['10.0.0.9']}` 共 12 例 chief spec 全 `NOT_AUTHORIZED`，Run/快照增量 0、`assessments=0`；B：同 scope 的专业 spec（各自 Chief parent）3 例全拒、零副作用；C：L2 + `deploy` + 覆盖授权接受（1 Run），跨 Work 授权拒；L3 自带授权接受；再评估后改派更宽 scope 被 `does not cover the declared scope` 拒。代码 `orchestrator.ts:361-384` | **完全修好 ✓** |
| **R12-02** 授权范围不参与判定 | P2（阻断） | `exp2`：只读授权（`operations:['read']`）+ `delete_data` ⇒ `NOT_AUTHORIZED`（`uncoveredOperations:['delete_data']`）；宽授权 + `delete_data` 接受；宽授权（无 `search`）+ `search` 拒绝；网络目标命中/未命中分别接受/拒绝；伪造/撤销/跨 Work 仍拒；非必需引用也仍核对（不落快照）。**缺口**：`exp2`/`exp6` —— 只读授权（`scope.writePaths=[]`）+ spec `writePaths:['packages/core/src']` ⇒ **接受**并冻结该写范围与该授权引用 | **部分修好（见 R13-01）** |
| **R12-03** 核对结果未冻结 | P3 | `exp3`：L3 Work + `deploy`、调用方不传引用 ⇒ Run 接受，`dispatchSnapshot.authorizationRef = AUTH_L3`，`recoveryView` 重建同一引用，DB payload 键 `[authorizationRef,contextSnapshotId,dispatchSpec,effectiveScope,hash,profileRevision,requiredOutputSchemas]`；调用方提供引用时冻结该引用；无引用时不写键。`exp7`：按 `identityPayload` 重冻结 `created:false`、hash 相等 | **完全修好 ✓** |
| **R12-04** JSDoc 与调用点不符 | P3 | `exp4`：JSDoc 含范围覆盖句与返回值句；`this.verifyAuthorization(` 两个调用点（`:290`/`:379`）均传确定等级；参数注释仍称「assessment 可能不传等级」但 `assess` 传 `payload.level` | **修好 ✓（残余见 §5.1）** |
| **R12-05** DC-62 未写集合归属 | P3 | `exp4`：DC-62 含「集合 `ENVIRONMENT_OPERATIONS` **定义在 `domain/routing.ts`**」与 `数据删除迁移` 等价句；`core/orchestrator.ts` 无 `ENVIRONMENT_OPERATIONS` 定义 | **完全修好 ✓** |
| **对抗性①** `none` Work 写权限 / 死代码 | P2 | `exp5`：纯 `writePaths` 的 `none` Work spec 被拒（`cannot create a Run with write authority`，零副作用）；chief 侧同样被拒；`grantsModificationAuthority` 已被调用。**缺口**：`none` Work + `writePaths` + `operations:['deploy']` + 覆盖授权 ⇒ **接受**并冻结 `{"writePaths":["packages/core/src"],"operations":["deploy"]}`；`none` Work + `operations:['edit','write','artifact_write']` + 空 `writePaths` ⇒ 接受 | **部分修好（见 R13-02）** |
| **对抗性②** 风险词表斜杠归一 | P2 | `exp5`：`数据删除迁移`/`数据删除/迁移`、`部署发布`/`部署/发布`、`支付金额状态` 均识别；`deploy-release`、`部署/发布/回滚`、`securityBoundry` 仍拒绝；`数据/删/除` 归一为已知（fail-closed 方向）；`assess` L2 + 合并风险 ⇒ `routing rules require L3`；`assist` + `deploy` ⇒ `VALIDATION_ERROR` | **完全修好 ✓** |

---

## 4. 新 Findings（R13-01..R13-06）

### R13-01 [P2，阻断] 授权 `scope.writePaths`/`readPaths` 仍不参与判定：只读授权可为写范围背书

- **位置**：`packages/core/src/orchestrator.ts:787-805`（范围覆盖只比对 `authorization.operations` 与 `authorization.scope.networkTargets`，从不看 `scope.writePaths`/`readPaths`）、`:379-384`（`dispatch` 把 `spec.scope` 传入却得不到写范围校验）、`:461-463`（`effectiveScope: spec.scope` 原样冻结）；契约 `packages/contracts/src/entities/work.ts:133-134`（`authorizationSchema.scope: scopeSchema` + `operations`）、`packages/contracts/src/primitives.ts:139-145`（`Scope` 四字段）；文档 `docs/architecture/data.md:26`（authorization「Chief解释绑定范围，**Core核对来源与权限**」）、`:80`（DispatchSnapshot 的 `effectiveScope` 是窄范围权威）、`docs/rules/workflow.md:7`（「Core检查角色、字段、授权、权限和版本」）。
- **事实（`exp2`/`exp6`，实跑）**：
  - Work `WORK_READONLY` 的授权 `operations:['read']`、`scope.readPaths:['docs']`、`scope.writePaths:[]`；`dispatch` 的 spec 声明 `readPaths:['packages']`、`writePaths:['packages/core/src']` ⇒ **接受**，冻结 `effectiveScope={"readPaths":["packages"],"writePaths":["packages/core/src"],…}`、`authorizationRef=AUTH_READONLY`；
  - 同一授权 + spec `readPaths:['secrets']`（授权只有 `docs`）⇒ 同样接受；
  - 对照：同一授权 + `operations:['delete_data']` ⇒ 拒绝（R12-02 已修的那一半）。
- **影响**：授权实体同时有 `scope:Scope` 与 `operations:string[]` 两个字段，`data.md:26` 把 `scope` 定义为「绑定范围」。当前实现只消费了 `scope.networkTargets` 与顶层 `operations`（以及 `data.md` 未定义优先级的两个操作列表之一），`scope.writePaths`/`readPaths` 是**纯记录字段**：一张明确「只读」的授权可以为写到 `packages/core/src` 的 Run 背书，且该写范围会被冻结为「已生效范围」（AC-082 的窄范围证据因此不代表被授权的范围）。第十二轮 R12-02 的标题是「授权范围（`Authorization.operations`/**`scope`**）不参与任何判定」，本条即其未修完的 `scope` 一半；DC-66 已登记为 WP-04/WP-05 的后续工作，但按 `workflow.md` §6，阻断项推迟必须有用户风险接受，记录本身不构成接受。
- **建议**：(a) 把 `scope.writePaths`/`readPaths` 纳入同一覆盖检查（至少对 L3 声明与显式提供的授权要求路径前缀覆盖，可复用 `domain/permission.ts:targetCovers`）；(b) 或者把「当前只核对 `operations` 与 `networkTargets`」写成 DC 的显式限制，并在结算/`review.md` 登记 `accepted_risk` 由用户决定；(c) 明确 `Authorization.operations` 与 `Authorization.scope.operations` 的优先级；(d) 补「只读授权 × 写范围 ⇒ 拒绝」的失败测试（当前 242 条单测无此用例）。
- **是否阻断**：**阻断**（授权语义未执行，且被记录/提交信息表述为「已加入范围覆盖」；标定沿用 R12-02 的 P2）。

### R13-02 [P2，阻断] `none` Work 的写权限门禁作用在派生 `runLevel` 上：声明一个被授权的环境操作即可绕过

- **位置**：`packages/core/src/orchestrator.ts:361-374`（`environmentScope ? 'L3' : work.level`，随后用 `runLevel` 判定 `!grantsModificationAuthority(runLevel) && writePaths.length > 0`）；文档 `docs/architecture/data.md:22`（work 行「**none不产生修改授权**」）、`:55`（`Scope.operations` 取值集合）；DC-66（`discovery.md:236`：「`runLevel` 无修改授权（`none`）时拒绝带 `writePaths` 的 spec」，`implementation.md:200`）。
- **事实（`exp5`，实跑）**：
  - 基准：`none` Work + `writePaths:['packages/core/src']`（无环境操作）⇒ `NOT_AUTHORIZED`（门禁生效）；
  - **绕过**：同一 `none` Work + `writePaths:['packages/core/src']` + `operations:['deploy']` + 覆盖该 Work 的授权 ⇒ **接受**，冻结 `{"writePaths":["packages/core/src"],"operations":["deploy"],"networkTargets":[]}`；`runLevel` 因环境操作被抬成 L3，于是 `grantsModificationAuthority` 返回 true，Work 行自己的 `none` 不再被检查；
  - 另一半：`none` Work + `operations:['edit','write','artifact_write']` + 空 `writePaths` ⇒ **接受**（门禁只看 `writePaths.length`，不看 `operations` 里的本地写操作）。
- **影响**：`data.md:22` 的「none 不产生修改授权」这一行级不变式只对「不声明环境操作」的 spec 成立；Core 唯一的 Run 建立入口可以用「顺手声明一个被授权的环境操作」把 `none` Work 变成可以冻结写范围的 L3 Run。第十二轮对抗性①（`none` 级 Work 可派写权限 Run）因此只修好了主干的一半。可达性：需要一张绑定该 Work 的真实授权（用户来源），因此不是凭空造权，但它使文档化不变式在 Run 边界失效，且这类 Run 的 `writePaths` 又不做授权覆盖（R13-01），两者叠加后「只读授权 + 环境操作声明」即可拿到写权限。
- **建议**：(a) 把写权限门禁的判据改回 **Work 行自身**的等级/`grantsModificationAuthority(work.level)`，而不是派生 `runLevel`（环境操作只应抬升「需要哪种授权」，不应授予修改权）；(b) 若确要允许「L3 授权可授予写权」，则必须同时实现 R13-01 的 `scope.writePaths` 覆盖，并补记录说明「none Work 在 L3 授权下可写」是产品决定；(c) 门禁同时检查 `scope.operations` 中的本地写操作（`edit`/`write`/`artifact_write`/`git`），而不只看 `writePaths`；(d) 补「none Work × 环境操作 × writePaths ⇒ 拒绝」的失败测试。
- **是否阻断**：**阻断**（`data.md` §2 明文不变式在 Run 建立边界可被绕过；标定沿用 R11-01/R11-03/R12-01 的 P2）。

### R13-03 [P2，非阻断] `dispatch` 对显式 `undefined` 可选字段抛非协议错误码并留下孤儿快照

- **位置**：`packages/core/src/orchestrator.ts:337`（`parseOrFail(dispatchSpecSchema, input.spec, …)` 之后 `spec` 仍带显式 `undefined` 键）、`:446-472`（先 `config.freeze` → `context.freeze`，再 `dispatch.freeze`）、`:864-873`（只对 `professionalSpec` 做了 `undefined` 过滤）；`packages/core/src/snapshots.ts:75-80`（`jsonObjectSchema.safeParse` 失败 ⇒ `StorageError('CONSTRAINT_VIOLATION')`）；`packages/core/src/errors.ts:9-35`（`CONSTRAINT_VIOLATION` **不在** `PROTOCOL_ERROR_CODES` 内）。
- **事实（`exp6`，实跑）**：`dispatch({spec: {...backendSpec(...), taskId: undefined}})` ⇒ 抛 `CONSTRAINT_VIOLATION: snapshot payload must be a JSON object`（`runDelta=0`，但 `snapshotDelta=2`：`context` 1→2、`config` 1→2）；`{...spec, requirementId: undefined, taskId: undefined}` 同样。对照：`dispatch(professionalSpec({... taskId: undefined}))` 正常（过滤生效）。
- **影响**：提交信息把这项写成「`professionalSpec` drops explicitly undefined optional fields so a frozen payload never carries a non-JSON value」，但只修了 builder，没修 `dispatch` 入口：任何动态构造（JS 调用方、`Record<string, unknown>` 组装、spread 一个可能为 `undefined` 的变量）的 spec 都会以**协议错误表之外的** `CONSTRAINT_VIOLATION` 失败，并在失败前写入 2 条无人引用的 `config`/`context` 快照行，违反 DC-58「被拒绝的 dispatch 不留任何副作用」（R7-07/R8-04 曾被判 P2）与 `protocol.md` §1/§7 的封闭错误表。可达性受限：`exactOptionalPropertyTypes` 下类型正确的 TS 调用方与 JSON 协议载荷都不会产生该形态，故不判阻断。
- **建议**：(a) 在 `dispatch` 入口对解析后的 spec 做一次「剔除显式 `undefined` 顶层键」或要求 `dispatchSpecSchema` 的解析结果不含 `undefined`；(b) 让 `SnapshotWriter.freeze` 的载荷失败映射为 `VALIDATION_ERROR`/`INTERNAL_ERROR` 并保持零副作用（或把两次快照冻结推迟到全部校验通过之后）；(c) 补一条「spec 携带显式 `undefined` ⇒ `VALIDATION_ERROR` 且零快照」的失败测试。
- **是否阻断**：不阻断（fails closed；但错误码与副作用违反两处文档化不变量）。

### R13-04 [P3] DC-63 未同步，已与代码相反；提交信息称「DC-62/DC-63 updated」不实

- **位置**：`.agentdev/work/WP-02/discovery.md:221`（「授权**范围是否覆盖本次 `scope`/`operations`** 仍登记为 WP-04/WP-05 的落线工作（**当前只核对存在性、同 Work、未撤销**）」，以及「`dispatch` 用 `extras.authorizationRef ?? work.authorizationRef` 与 `work.level` 走同一函数」）；对照 `packages/core/src/orchestrator.ts:361-384,787-805`、`discovery.md:232-239`（DC-66）、提交 `e3b210c` 信息「records: DC-62/DC-63 updated」。
- **事实（`exp4` + `git show e3b210c`，实跑/实读）**：`e3b210c` 对 `discovery.md` 只改了 DC-62 两条并追加 DC-66，**DC-63 一字未动**（`git show e3b210c -- .agentdev/work/WP-02/discovery.md`）；DC-63 的两句现在都与代码相反（范围覆盖已经实现了一半；`dispatch` 用的是 `runLevel` 而非 `work.level`）。
- **影响**：本包反复出现的「记录与代码/记录与记录不符」类别（R7-05/R7-08/R8-05/R8-06/R10-05/R10-06/R12-05）。读者按 DC-63 会以为 `dispatch` 完全没有范围覆盖，而按 DC-66 又会以为写范围也已覆盖；两份记录互相矛盾。
- **建议**：在 DC-63 补一句「第十二轮 R12-02 已加入 `operations`/`networkTargets` 覆盖；`writePaths`/`readPaths` 仍未实现（见 DC-66）」，并把 `dispatch` 的等级来源改为 `runLevel`。
- **是否阻断**：不阻断。

### R13-05 [P3] 新增测试的记录引用与注释不实：`DC-65` 错号，且「只读授权」用例实际用的是 `deploy` 授权

- **位置**：`packages/core/test/orchestrator.test.ts:577`（`it('never freezes write authority for a none-level Work (R12-01, DC-65)')` —— 相关记录是 **DC-66**，DC-65 是第十一轮的路由顺序条目）、`:553`（注释「A read-only grant cannot back a data operation.」）、`:224-231`（`AUTHORIZATION_ID` 的 `scope: emptyScope`、`operations: ['deploy']`）；对照 `discovery.md:227-231`（DC-65）、`:232`（DC-66）。
- **事实（`exp4`，实读）**：被注释为「read-only grant」的授权其 `operations` 是 `['deploy']`，`scope` 为空；断言本身成立（deploy 授权不覆盖 `delete_data`），但第十二轮 R12-02 建议的「**只读**授权 × 环境操作 ⇒ 拒绝」失败测试在仓库中仍不存在。`:577` 的 `DC-65` 指向另一条记录。
- **影响**：本包反复出现的「测试/注释与记录不符」类别（R7-05/R8-08/R10-06/R12-04）；把「deploy 授权不覆盖 `delete_data`」读成「只读授权已受约束」，会让 R12-02/R13-01 的覆盖率被高估。
- **建议**：把 `:577` 的 `DC-65` 改为 `DC-66`；新增一张真正 `operations:['read']` 的授权用于该断言，并补「只读授权 × writePaths ⇒ 拒绝」（R13-01）与「none Work × 环境操作 × writePaths ⇒ 拒绝」（R13-02）两条失败测试。
- **是否阻断**：不阻断（测试缺口已在 R13-01/R13-02 的建议中登记）。

### R13-06 [P3] `config.policy.l3Paths`/`l3Keywords` 无任何读取方（死配置）

- **位置**：`packages/core/src/config.ts:91-96`（`DEFAULT_POLICY`）、`:171-175`（`global()`/`project()` 投影）、`:295-301`（`update` 写入）；契约 `packages/contracts/src/entities/structures.ts:128-129,166-167`；文档 `docs/architecture/data.md:59` 与 `docs/architecture/protocol.md:96`（只规定这两个键可配置，未定义路由语义）。
- **事实（`exp5`/`exp6` + 全仓 grep，实跑/实读）**：`grep -rn "l3Paths\|l3Keywords" packages apps`（排除 `dist`）只命中 `config.ts` 的存/取与 `structures.ts` Schema，**没有任何判定或强制点**；`config.freeze`（`:469-517`）也不把 policy 写入冻结快照。实跑：L2 Work 派发 `writePaths:['docs/rules/workflow.md']`、`policy.l3Paths=[]` ⇒ 接受（与预期一致，但即使把 `l3Paths` 设为该路径，也没有代码会读取它）。
- **影响**：一个被契约与协议公开、且 `AGENTS.md` 体系里被当作「L3 路径/关键词」项目参数的配置面，当前是静默 no-op；用户配置的 L3 边界不会产生任何效果（与 R9-01/R10-01/R11-01 同族的「配置了却不生效」）。仓库内没有文档定义这两个字段的判定归属，故判 P3 而非门禁缺陷。
- **建议**：明确归属（WP-04/Chief 路由或本包），要么实现「命中 `l3Paths`/`l3Keywords` ⇒ 至少 L3 + 明确授权」，要么在正式文档/DC 中把它标为未实施并登记风险接受。
- **是否阻断**：不阻断。

---

## 5. 其它观察（不计入 Finding 编号）

1. **`verifyAuthorization` 的参数注释仍描述一个不存在的调用形态**：`orchestrator.ts:751` 写「`undefined` when no level is known yet (an assessment checks what it has)」，但 `assess`（`:290`）与 `dispatch`（`:379`）都传确定等级，`level === undefined` 分支在仓库内不可达（`exp4`）。R12-04 的实质矛盾已消除，故只记观察。
2. **`assess` 不做范围覆盖核对**：`assess` 调 `verifyAuthorization(payload.authorizationRef, work.id, payload.level)`（不传 `scope`），于是「L3 + `delete_data` + 只读授权」的评估被接受并落库（`exp2`），而同一 scope 的 `dispatch` 会拒绝。Run 建立一侧仍然安全，但 `assessment` 行会永久记录一张并不覆盖它的授权引用；建议 `assess` 也传入 `payload.scope`。
3. **Authorization 有两个操作列表且只消费其一**：`authorization.operations`（顶层）与 `authorization.scope.operations`。实跑：顶层 `operations:[]` + `scope.operations:['delete_data']` ⇒ 拒绝；顶层 `['deploy']` + `scope.operations:[]` ⇒ 接受。`data.md:26` 并列两个字段但未定义优先级，属契约歧义。
4. **网络目标匹配是精确字符串相等**：`orchestrator.ts:790-791` 用 `Set.has`，而 `domain/permission.ts:targetCovers` 对 `grant.targets` 实现前缀覆盖。实跑：授权 `https://api.example.test/` 不覆盖 spec `https://api.example.test/v1`（fail-closed）。两处「授权/准入」语义不一致，建议统一。
5. **派生 `runLevel` 不落库**：Run 行无等级列，`work.level` 也不会被 `assess` 更新（`works.update` 全仓无生产调用点，仅 `orchestrator.test.ts:876`；DC-66 已登记）。实跑：L2 Work + `deploy` + 授权 ⇒ Run 建立、`work.level` 仍为 `L2`、快照 `authorizationRef` 有值。语义可由 `effectiveScope` 重算，但 Work 行与 Run 的有效等级会长期不一致。
6. **`routingFloor` docstring 仍不精确**（沿第十二轮 §5.2）：`orchestrator.ts:163-170` 称 "everything else defaults to L2 and a lockdown risk to L3"，而 `:176` 的 `assist`/`artifact` 分支返回 `'none'`。
7. **产物归属**（沿第十一/十二轮 §5.6）：`e3b210c` 是开发修复提交，却包含 `.agentdev/work/WP-02/review.md` 的整篇重写（`97 insertions / 102 deletions`，把第十一轮报告替换为第十二轮报告，与当时工作树逐字节一致）。Review 产物仍无法仅凭 git 归属为 Reviewer 独立撰写（`docs/rules/agents.md` §1 规定 review 的写入边界是报告本身）。建议后续轮次由 Reviewer 自行提交或在提交信息中声明。
8. **`professionalSpec` 的注释引用 Review 编号**：`orchestrator.ts:867-868` 的注释写「(R12-01 test surface)」，把评审条目编号带进产品代码；建议改为描述行为而非轮次。

---

## 6. 剩余风险（未闭环，供 Test/Settlement 与产品方判断）

1. **R13-01（新增，阻断）**：授权 `scope.writePaths`/`readPaths` 不参与判定，只读授权可为写范围背书。
2. **R13-02（新增，阻断）**：`none` Work 的写权限门禁作用在派生 `runLevel` 上，声明一个被授权的环境操作即可绕过（并叠加 R13-01 可拿到写权）。
3. **R13-03（新增，非阻断）**：显式 `undefined` 可选字段 ⇒ `CONSTRAINT_VIOLATION` + 2 条孤儿快照（`dispatch` 入口未做 builder 同款清理）。
4. **DC-66 明确推迟的三项**（需产品决定/风险接受，不能只靠记录）：`writePaths` 是否必须在授权 `scope.writePaths` 内、授权 `acceptedAt`/来源消息核对、`work.level` 的更新路径。
5. **DC-63 与代码相反**（R13-04），DC-65/DC-66 的引用错位（R13-05）：本包记录一致性问题反复出现，建议结算时做一次记录-代码对账。
6. **`config.policy.l3Paths`/`l3Keywords` 无判定归属**（R13-06）：公开配置面静默 no-op。
7. **并发未验证**：预算准入检查（`orchestrator.ts:420-423`）与事务内 `reserve`（`:482`）之间仍有窗口；单 mailbox 串行假设下不可达，多连接/多进程的双花与「快照已落、Run 未建」未被测试覆盖（沿前几轮）。
8. `timed_out`/`interrupted`/`recovery_required` 终态无产生路径（WP-05）；`onChildSettled` 仍无生产调用方（WP-05）；`Work blocked(provider)`/`blocked(budget)` 投影属 WP-05（DC-42/DC-55）。
9. `ModelGateway` 的真实 HTTP、Secret 解析与 `testConnection` 真连属 WP-07/WP-10（DC-31）；`permissionMode` 与工具层准入属 WP-07。
10. **待产品方决定项**：DC-64（风险旗标词表是否升为契约枚举、是否允许自定义旗标）、DC-60（`Assessment.goal`/`scope` 是否落库或落事件）、DC-27/RE-06（`data.md:30` 的三个 `:ID` 快照引用与实现的哈希并存）、DC-46（`dispatch` 不校验 `work.status`）、第十二轮 §5.4（lockdown 门禁是否严格限于 delivery/document）、Authorization 双操作列表的优先级（§5.3）。
11. `assessment.saved` 的 `data` 不含 `riskFlags`/`uncertainties`/`authorizationRef`；`assessment.submit` 按 `protocol.md:106` 应返回「适用 Gate」，当前 Core 返回 Assessment 行（协议层 WP-04 未接线，沿前轮）。
12. **测试缺口**：242 条单测仍没有「只读授权 × 写范围 ⇒ 拒绝」（R13-01）、「none Work × 环境操作 × writePaths ⇒ 拒绝」（R13-02）、「spec 携带显式 `undefined` ⇒ 零副作用」（R13-03）三类用例。

---

## 7. 方法与边界声明

- 本报告只依据仓库文件、`e3b210c` 上的 git 对象/差异与实跑命令；未读取任何开发对话、未引用外部同名技能或历史方案。
- 阅读深度：`packages/core/src/orchestrator.ts`、`packages/domain/src/routing.ts`、`packages/contracts/src/entities/{structures,work}.ts`、`packages/contracts/src/primitives.ts`、`packages/core/src/snapshots.ts`、`packages/core/src/errors.ts` 逐行；`packages/core/test/orchestrator.test.ts` 新增用例（`:543-614`）逐行；`docs/architecture/data.md` 通读；`docs/rules/{workflow,agents}.md`、`docs/delivery/{implementation,acceptance}.md`（WP-02、AC-043..047、AC-082）通读；`.agentdev/work/WP-02/{plan,implementation,discovery}.md` 全部记录通读（重点 DC-62..DC-66、T19/T20）；`packages/core/src` 其余文件与 `packages/domain/src` 其余文件按注释声称与关键分支抽查（这些文件在 `e3b210c` 中未改动，且由本轮全量测试覆盖）。
- 唯一写入文件为本文件 `.agentdev/work/WP-02/review.md`；实验脚本独立写在 `/tmp/wp02r13/`（`fixture.mjs`、`lib.mjs`、`exp1..exp7.mjs`、`exp*.log`），使用 `pnpm build` 产出的 `packages/*/dist`，通过 `/tmp/wp02r13/node_modules/@agentdev/*` 软链解析 workspace 包，等价复现包内夹具但**不 import 任何产品测试文件**。
- 未修改产品代码、测试、`docs/**`、`plan.md`、`implementation.md`、`discovery.md`；`pnpm build` 只写 `.gitignore` 中的 `dist/`。写入本报告前 `git status --porcelain` 无输出、`HEAD=e3b210c29cd1bee34a5834e82908a70734201abc`。
- 历史轮次报告取回方式：第十二轮 `git show fec9a9d:.agentdev/work/WP-02/review.md`；第十一轮 `git show 080aa4c:…`；第十轮 `git show e125bb7:…`；第九轮 `git show 328ee60:…`；第八轮 `git show f02aca4:…`；第七轮 `git show 0211ced:…`；第六轮 `git show 5a87a86:…`；第五轮 `git show 411d04f:…`；第四轮 `git show a8daa6d:…`；第三轮 `git show c4763d5:…`；第二/一轮 `git show 785bdd6:…`。
