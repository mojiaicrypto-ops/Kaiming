# WP-02 独立 Review 报告（第十轮）

- 评审对象：工作包 WP-02「主管与独立Agent调度」
- 评审轮次：**第十轮**（逐条复核第九轮 R9-01..R9-06 与三项对抗性漏项 A/B/C 是否真修，并找新问题）
- 冻结点：git `e125bb7`（`fix(core): WP-02 review round 9 findings (R9-01..R9-06)`），前置 `328ee60`
- HEAD 校验：`git rev-parse HEAD` = `e125bb7ea727a58c98ae95469a88a0e049e86660`
- 工作树：复核开始与写入本报告前 `git status --porcelain` 均无输出（`pnpm build` 只写被 `.gitignore` 忽略的 `dist/`）
- 评审角色：Review（独立上下文，未读取任何开发对话；只依据仓库文件、git 对象与我自己的实验）
- 权威依据：`AGENTS.md`、`docs/INDEX.md`、`docs/rules/{workflow,agents}.md`、`docs/architecture/{ARCHITECTURE,data,protocol,reliability,context}.md`、`docs/delivery/{implementation,acceptance}.md`（WP-02 与 AC-043/044/045/046/047/082）、`.agentdev/work/WP-02/{plan,implementation,discovery}.md`、`packages/core/src` 全部 17 个文件（本包改动文件 `orchestrator/run-lifecycle/join/snapshots/auth` 逐行；`e125bb7` 未改动的文件按注释声称与关键分支抽查）、`packages/domain/src`（`routing.ts` 新词表逐行）、`packages/contracts/src/entities/{structures,work}.ts`、`packages/contracts/src/primitives.ts`、`packages/storage/src/schema.ts`、`packages/core/test`
- 方法：逐行核对「注释/记录声称」与代码；在 `/tmp/wp02-r10/` 自建夹具与 6 组实验脚本（`fixture.mjs`、`exp-a..f.mjs`）与 TS 探针（`tsprobe/`），用 `pnpm build` 产出的 `packages/*/dist` 独立复现（软链 `/tmp/wp02-r10/node_modules/@agentdev/*`）；**不修改产品代码、测试、`docs/**`、`plan/implementation/discovery`**。
- 工具：`node v24.8.0`、`pnpm 12.3.4`

---

## 0. 历史轮次结论摘要（保留，第一至九轮）

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
R8-01（`requestDispatch` 无契约校验）、R8-02（`assess` 无契约校验）、R8-03（零消费取消的死预留）、R8-04（被拒 dispatch 留快照行）、R8-05（DC-35 记录）、R8-06（DC-48/DC-52 记录）、R8-07（`§65` 引用）、R8-08（失效引用/注释）、R8-09（`contextPayload` 无校验）。全文：`git show 328ee60:.agentdev/work/WP-02/review.md`。

**第九轮（`328ee60`）FAIL：0×P1、1×P2、5×P3（R9-01..R9-06）＋对抗性核验三项漏项。**
R9-01（P2，阻断）＝`assess` 的 L3 底线只认识 8 个内部英文 camelCase 风险旗标，中文/kebab/大小写/拼写错误提交时**静默按 L2 通过**（fail-open 安全门禁）；R9-02（P3）＝`dispatchRequestSchema` 与 `protocol.md` §1/§6 及 `DispatchRequestInput` 接口四处不一致；R9-03（P3）＝`runParams` 是唯一未被 `dispatchExtrasSchema` 覆盖的冻结输入（非对象静默忽略、非法对象报 `PROVIDER_UNAVAILABLE`）；R9-04（P3）＝`assess` 校验后静默丢弃 `goal`，`data.md` §2 行与 §3 结构自相矛盾；R9-05（P3）＝`auth.ts` `secureCookies` 注释过度声称；R9-06（P3）＝父 Run 处于 `paused`/`interrupted`/`recovery_required` 时 required 失败的 Chief 待办永久缺失。**对抗性漏项**：A＝`operation` 的 L3 判定源错误（读 `work.level` + 未文档化魔法串）；B＝`authorizationRef` 不核对授权实体；C＝`scope` 也被静默丢弃。第九轮全文：`git show 328ee60:.agentdev/work/WP-02/review.md`。

**追溯口径（沿用第五轮 DC-53/DC-56 口径）**：行为/需求缺失＝P1（阻断）；局部质量/维护＝P2；建议＝P3。P2/P3 是否阻断由本轮按 `workflow.md` §6（第 65 行）「影响验收则阻断」判定。**R9-01 的既有标定**（L3 安全门禁静默失效）沿用 P2 并阻断。

---

## 1. 本轮结论

**FAIL（Review Failed）——第九轮条目无一条被完全回退，但 R9-01 与对抗性漏项 B 只做到部分修复，且新引入 1 处证据不一致与 1 处过严判定。本轮共 0×P1、2×P2、5×P3（R10-01..R10-07），其中 R10-01、R10-02 为 P2，按 `workflow.md` §6「影响验收则阻断」，阻断进入独立 Test。**

**逐条裁定（详见 §3）**

| 第九轮条目 | 本轮裁定 |
|---|---|
| **R9-01** L3 风险底线 | **部分修好**：文档单个中文词与 camelCase 的大小写/`_`/`-` 变体全部生效；但文档 §2.3 的**原样合并措辞**（`数据删除/迁移`、`支付金额/状态`、`部署/发布`）与任何未登记拼写仍**静默降级为 L2**，且新增的 fail-closed 助手 `isKnownLockdownRiskTerm` **全仓零调用**（R10-01，P2，阻断） |
| **R9-02** `request_dispatch` 契约 | **部分修好**：`operationId` 已限 1–128；`version` 死回退已删；但 `DispatchRequestInput.sourceRefs[].version` 仍为可选（tsc 通过、运行期 `VALIDATION_ERROR`），`stage` 仍为自由字符串并原样落 `chief_action_required`，两者均未记录（R10-04，P3） |
| **R9-03** `runParams` | **部分修好**：非对象（`5`/`true`/`[]`/`null`/`"oops"`）已 `VALIDATION_ERROR`；非法对象（`{contextLimit:-5}`/`{bogus:1}`/`{reasoning:'hyper'}`/`{providerId:'not-a-uuid'}`）仍报 `PROVIDER_UNAVAILABLE`，DC-59 清单仍写三个冻结输入（R10-05，P3） |
| **R9-04** `goal` 静默丢弃 | **未实现，但按流程登记为 `Product Decision Pending`（可接受）**；然而 DC-60 声称「`goal`/`scope` 只进 `assessment.saved` 事件（当前实现）」与代码不符——两者既不在行、也不在事件（R10-06，P3） |
| **R9-05** `secureCookies` 注释 | **完全修好 ✓**（实跑 4 例全对） |
| **R9-06** 非终态父 Run 的 Chief 待办 | **完全修好 ✓**（`paused`/`interrupted`/`recovery_required`/`waiting_permission` 4 态各 2 例 + 终态对照 1 例全对） |
| **对抗性 A** `operation` 的 L3 判定源 | **完全修好 ✓**（改用载荷 `scope.operations`/`scope.networkTargets`，不再依赖 `work.level` 与魔法串）；但「任一 operation 名称都算触及运行环境」过严（R10-07，P3） |
| **对抗性 B** `authorizationRef` 不核对授权实体 | **部分修好**：`assess` 已按 id 查 `authorization` 行、伪造引用 `NOT_AUTHORIZED`；但核对仅「存在性、仅 `assess`」——**跨 Work 的授权与已 `revokedAt` 的授权仍被接受**，且 `dispatch` 的 `authorizationRef` **完全不核对**并把伪造引用冻结进 DispatchSnapshot（R10-02，P2，阻断） |
| **对抗性 C** `scope` 被静默丢弃 | 同 R9-04（登记为产品决定；DC-60 记录不准，R10-06） |

**新引入的问题**：R10-03（`assessment.saved.decidedLevel` 与被接受的行等级自相矛盾：L1 行记 `decidedLevel:"L2"`）。

---

## 2. 契约命令原始结果（本轮实跑）

执行方式：`export PATH="$HOME/.local/bin:$PATH"`，在仓库根目录按序执行，逐条记录退出码（完整输出存于 `/tmp/r10_*.log`，摘要存于 `/tmp/wp02-r10/cmds.log`）。

| 命令 | 退出码 | 原始结果要点 |
|---|---|---|
| `pnpm typecheck` | **0** | `tsc -p tsconfig.json --pretty false`，无输出 |
| `pnpm lint` | **0** | `Checking formatting...` / `All matched files use Prettier code style!` |
| `pnpm test:unit` | **0** | `Test Files 17 passed (17)` / `Tests 233 passed (233)` / `Duration 5.11s`（与 T17 声称的 233 一致） |
| `pnpm test:integration` | **0** | `Test Files 10 passed (10)` / `Tests 124 passed (124)` / `Duration 46.05s`（真实容器用例：`container.integration.test.ts` 9 例 44.8s、`doctor.integration.test.ts` 8 例 21.2s） |
| `pnpm docs:check` | **0** | `docs:check ok — 15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages` |
| `pnpm build` | **0** | `packages/{contracts,domain,storage,core,pi-runtime}`、`apps/{cli,runner}` 共 7 个 workspace `build: Done` |
| `git status --porcelain` | — | 复核开始与报告写入前均**无输出**（干净） |
| `git rev-parse HEAD` | — | `e125bb7ea727a58c98ae95469a88a0e049e86660`（= 冻结点；`git log -1` = `e125bb7 fix(core): WP-02 review round 9 findings (R9-01..R9-06)`） |

**自建实验（观察值记录，失败项即 Finding 证据）**：`exp-a` 40 passed / 11 failed、`exp-b` 3/3、`exp-c` 13/8、`exp-d` 13/0、`exp-e` 3/4、`exp-f` 0/3。TS 探针：`tsprobe/tsconfig.probe.json`（`probe.ts`+`probe3.ts`，无 `version` 的 `sourceRefs`）**tsc 退出 0**；负对照 `probe2.ts` 退出 1（`TS2739`，缺 `requestedRole`/`goal`）。所有实验用 `pnpm build` 后的 `packages/*/dist`，通过 `/tmp/wp02-r10/node_modules/@agentdev/*` 软链解析，**不 import 任何产品测试文件**。

---

## 3. 逐条复核表（第九轮条目 + 三项对抗性漏项）

| 条目 | 前轮定级 | 前轮要求 | 本轮实测证据（脚本/观察值） | 判定 |
|---|---|---|---|---|
| **R9-01** 风险旗标词表 | P2 | 中文/变体/未登记拼写不得静默降级；词表或 fail-closed 或登记 accepted_risk | `exp-a`：14 个文档单中文词（`安全边界`/`数据删除`/`数据迁移`/`部署`/`发布`/`身份认证`/`权限判断`/`支付金额`/`支付状态`/`公开协议不兼容`/`项目门禁规则变化`/`密钥`/`授权`/`权限`/`凭证`）与 15 个 camel/kebab/case 变体（`securityBoundary`/`security_boundary`/`security-boundary`/`SECURITYBOUNDARY`/`Security Boundary`/`Secret`/`SECRET`/`deployOrRelease`/…）**全部 → `VALIDATION_ERROR`（L3 底线生效）**。反例：`数据删除/迁移`、`支付金额/状态`、`部署/发布`（`workflow.md` 第 13 行的原样措辞）**全部 `ACCEPTED level=L2`**；`securityBoundry`（拼写错误）、`安全边界问题`、`数据删除与迁移`、`认证`、`保密`、`安全`、`operation_touches_environment` 均 `ACCEPTED level=L2`；`DEPLOY_RELEASE` 亦 `ACCEPTED level=L2`。`exp-f` F-2：未登记旗标在 `assessment.saved` 中**无任何标注**（data 键仅 `decidedLevel,decidedReason,intent,level,semanticImpact,workId`）。`exp-f` F-3：`isKnownLockdownRiskTerm`（`routing.ts:143-148`）**全仓唯一出现处就是定义本身，零调用**；`packages/domain/test` 无 `riskFromFlags`/`LOCKDOWN_RISK_TERMS`/`isKnownLockdownRiskTerm` 的任何断言（新 62 行词表仅由 `orchestrator.test.ts` 4 条断言间接覆盖） | **部分修好（R10-01，P2，阻断）** |
| **R9-02** `request_dispatch` | P3 | 必填性/`version`/`stage`/`operationId` 四处统一或记录偏离 | `exp-c`：`requestDispatch({runId,requestedRole:'review',goal})`（缺 `workId`/`reason`/`sourceRefs`）**被接受**——已在 DC-61 登记为偏离（可接受）；缺 `version` 的 `sourceRefs` 运行期 `VALIDATION_ERROR`（`sourceRefs.0.version: expected string, received undefined`），而 `tsprobe` 正探针 `tsc` 退出 0 证明 `DispatchRequestInput.sourceRefs[].version?: string`（`orchestrator.ts:127`）仍接受该调用 → 接口与运行期仍不一致；`stage:'nonsense-stage'` **被接受**且从 `chief_action_required` 读回 `stage:"nonsense-stage"`（`taskStageSchema` 存在却未用）；`operationId` 129 字符 `VALIDATION_ERROR`、128 字符接受（已修）；`goal` 全空白 `VALIDATION_ERROR`（已修）。DC-61 未记录 `version`/`stage` 两项 | **部分修好（R10-04，P3）** |
| **R9-03** `runParams` | P3 | 纳入冻结输入校验；非法值统一 `VALIDATION_ERROR`；DC-59 列四个输入 | `exp-c`：`5`/`true`/`[]`/`null`/`"oops"` **全部 `VALIDATION_ERROR`**（"expected record, received …"）——非对象静默忽略已修；`{contextLimit:-5}`/`{bogus:1}`/`{reasoning:'hyper'}`/`{providerId:'not-a-uuid'}` **仍 `PROVIDER_UNAVAILABLE`**（"role chief has no usable model: role chief has no complete model profile (…)"），provider 实际存在且启用 → 错误码误导未修；`exp-e` E-3 证明合法 `{contextLimit:32000}` 被真实采用（`readFrozen().profile.contextLimit=32000`、`sources.contextLimit==='run'`）。`discovery.md:195`（DC-59）仍写 `authorizationRef`/`requiredOutputSchemas`/`contextPayload` 三个输入，未把 `runParams` 列入 | **部分修好（R10-05，P3）** |
| **R9-04** `goal`/`scope` 静默丢弃 | P3 | 二选一并记录产品决定 | `exp-c`：`assessment` 行键 = `createdAt,id,intent,level,policyRevision,projectId,reason,riskFlags,semanticImpact,uncertainties,updatedAt,version,workId`（**无 `goal`、无 `scope`**）；`assessment.saved` data 键 = `decidedLevel,decidedReason,intent,level,semanticImpact,workId`（**亦无 `goal`/`scope`**）。DC-60 已把该冲突登记为 `Product Decision Pending`（流程上正确），但正文写「方案 A：`goal`/`scope` 只进 `assessment.saved` 事件（当前实现）」与实测不符（`discovery.md:201`），`discovery.md:203`「`scope`…只在事件/判定中使用」同样不实（事件里没有 `scope`） | **未实现但已按流程挂起；记录不实（R10-06，P3）** |
| **R9-05** `secureCookies` 注释 | P3 | 与实现对齐 | `exp-d`：loopback 默认 → 无 `Secure`；loopback + `allowedOrigins:['https://agentdev.local']` → 有 `Secure`；loopback + http allowlist → 无；`deployment:'remote'` → 有。代码 `auth.ts:347-352` 与注释「remote deployments, and whenever an allowed origin is already https」一致；新增测试 `auth.test.ts:103-114` 属实 | **完全修好 ✓** |
| **R9-06** 非终态父 Run 待办 | P3 | paused/interrupted/recovery_required 仍登记待办 | `exp-d`：父 Run 分别置 `paused`/`interrupted`/`recovery_required`/`waiting_permission`（先停父、后结算 required 子 Run）→ `onChildSettled` 均返回 `kind:'blocked'`、`chiefTodo` 非空、`chief_action_required` 恰 1 条；把父恢复为 `running` 后 `state()` 仍 `blocked` 且 `chiefTodo` 非空、事件仍 1 条（不再丢失）；终态对照（父 `cancelled`）→ `blocked` 且 `chiefTodo:''`、事件 0 条（R5-05 未回退）。代码 `join.ts:245` 改为 `if (isTerminalRunStatus(parent.status)) return undefined;`，与注释一致；新增测试 `join.test.ts:525-545` 有区分力（`attemptAndSettle` 不调用 `onChildSettled`，故旧代码会 fail） | **完全修好 ✓** |
| **对抗性 A** `operation` L3 判定源 | 补漏 | 不得读 `work.level`/魔法串，改用载荷证据 | `exp-a`：`operation` + `scope.operations:['bash']` + L2 → `VALIDATION_ERROR`；+ `networkTargets:['10.0.0.5']` + L2 → `VALIDATION_ERROR`；+ L2 与空 scope → 接受 L2；+ `level:'none'` 且 scope 有 operation → 拒绝；`work.level=L3` + 空 scope + L2 → **接受 L2**（证明不再读 Work 行，循环依赖已断）；旧魔法串 `operation_touches_environment` 无影响。代码 `orchestrator.ts:249-255` | **完全修好 ✓**（过严见 R10-07） |
| **对抗性 B** `authorizationRef` 核对实体 | 补漏 | 伪造引用不得成为 L3 授权 | `exp-b`：L3 无 `authorizationRef` → `NOT_AUTHORIZED`；伪造 UUID（`…4e84`，表中不存在）→ `NOT_AUTHORIZED`（"does not exist"）；同 Work 真实授权 → 接受。**但**：`FOREIGN_AUTH_ID`（`workId=OTHER_WORK_ID`）→ **接受 L3**；`REVOKED_AUTH_ID`（`revokedAt` 已设）→ **接受 L3**；`exp-e` E-4：为 `OTHER_WORK_ID` 提交评估并引用 `WORK_ID` 的授权 → 同样接受。`exp-b`/`exp-e` E-2：`dispatch(..., authorizationRef=MISSING_AUTH_ID)` **被接受**，并把该不存在的引用冻结进 DispatchSnapshot（`byType('dispatch')` 读回 `authorizationRef="…4e84"`）；L3 Work 无 `authorizationRef` 派发亦被接受。代码 `orchestrator.ts:269-286` 只做存在性查找且只在 `assess`；DC-63 自行登记了「更细核对归 WP-04/WP-05」 | **部分修好（R10-02，P2，阻断）** |
| **对抗性 C** `scope` 被静默丢弃 | 补漏 | 同 R9-04 | 同 R9-04（`exp-c`） | 同 R9-04 |

---

## 4. 新 Findings（R10-01..R10-07）

### R10-01 [P2] R9-01 残留：未登记的风险旗标仍静默降级为 L2，文档原样措辞不生效，fail-closed 助手零调用

- **位置**：`packages/domain/src/routing.ts:108-132`（`LOCKDOWN_RISK_TERMS`）、`:143-148`（`isKnownLockdownRiskTerm`，**无调用方**）、`:151-160`（`riskFromFlags`：未知旗标直接忽略）；`packages/core/src/orchestrator.ts:249-268`（L3 底线判定与放行）；契约侧 `packages/contracts/src/entities/structures.ts:42`（`riskFlags: list(z.string().min(1))` 仍是自由字符串）；文档 `docs/rules/workflow.md:13`（§2.3 的原样清单）。
- **事实（`exp-a`、`exp-f`，实跑）**：已在 §3 R9-01 行列出。要点：
  1. 单中文词与大小写/`_`/`-` 变体**已生效**（14+15 例全 `VALIDATION_ERROR`）；
  2. `workflow.md` §2.3 的**原样措辞** `数据删除/迁移`、`支付金额/状态`、`部署/发布` **全部 `ACCEPTED level=L2`**；
  3. 任何未登记拼写（`securityBoundry`、`安全边界问题`、`安全`、`operation_touches_environment`、`DEPLOY_RELEASE`）**全部 `ACCEPTED level=L2`**，且 `assessment.saved` 无任何 `unknownRiskFlag` 类标注 → 静默 fail-open；
  4. `isKnownLockdownRiskTerm`（本可用于「未知旗标直接拒绝」的保守选项 b）**全仓零调用**，`packages/domain/test` 对新词表零断言。
- **影响**：`workflow.md` §2.3 的 L3 门禁是安全底线。第九轮选项 (a)「词表作为契约枚举、未知值 `VALIDATION_ERROR`」与 (b)「未知旗标直接拒绝」都未采用，(c) 也未登记 `accepted_risk`——实现的语义是「只认一张未公开的等价拼写表，其余静默放过」，对拼写错误、同义中文与原样合并措辞仍会 fail-open。与第九轮相比范围收窄，但**性质未变**（无错误、无提示、契约上合法）。
- **建议**：三选一并记录产品决定，勿再混合——(a) 把 `LOCKDOWN_RISK_TERMS` 提为契约枚举（`data.md`/`structures.ts`）并对未知值 `VALIDATION_ERROR`（把零调用的 `isKnownLockdownRiskTerm` 真正接上）；(b) 任何非空 `riskFlags` 一律 fail-closed 参与 L3，或未知旗标直接拒绝；(c) 显式登记 `accepted_risk` 并在 DC 写明「未知旗标被忽略、Chief 必须使用 `routing.ts` 的键名」。同时把 `workflow.md` §2.3 的三个合并措辞（含 `/`）加入词表或改为枚举。同步 `discovery.md` RE-11/DC-62 与测试。
- **是否阻断**：**阻断**（文档化安全门禁的静默失效，`workflow.md` §6「影响验收则阻断」；标定沿用 R9-01 的 P2）。

### R10-02 [P2] R9-01 对抗性漏项 B 残留：授权核对只在 `assess` 且只查存在性；跨 Work/已撤销授权被接受，`dispatch` 完全不核对

- **位置**：`packages/core/src/orchestrator.ts:269-286`（存在性查找，无 `workId`/`revokedAt`/`scope` 比对）、`:277-278`（注释声称「the Core verifies the authorization's origin」）、`:334-347`（`dispatchExtrasSchema` 只校验 `authorizationRef` 是 UUID）、`:424-439`（把未核对的引用冻结进 DispatchSnapshot）；契约 `packages/contracts/src/entities/work.ts:128-138`（`Authorization` 含 `workId`/`scope`/`revokedAt`）；文档 `docs/rules/workflow.md:7`（§1「Core检查角色、字段、授权、权限和版本」）、`docs/architecture/data.md` §2（Core 核对来源与权限）。
- **事实（`exp-b`、`exp-e` E-2/E-4，实跑）**：

  | 探针 | 实测 |
  |---|---|
  | `assess` L3 + 表中不存在的 UUID | `NOT_AUTHORIZED`（**已修**） |
  | `assess` L3 + 真实同 Work 授权 | 接受 L3 |
  | `assess` L3 + **其他 Work** 的授权（`FOREIGN_AUTH_ID`） | **接受 L3** |
  | `assess` L3 + **已 `revokedAt`** 的授权（`REVOKED_AUTH_ID`） | **接受 L3** |
  | 为 `OTHER_WORK_ID` 评估 + 引用 `WORK_ID` 的授权 | **接受 L3** |
  | `dispatch(..., authorizationRef='…4e84'（不存在）)` | **接受**，DispatchSnapshot 冻结 `authorizationRef="…4e84"` |
  | L3 Work `dispatch` 且完全不传 `authorizationRef` | **接受** |

- **影响**：本次提交把「按 id 查 `authorization` 行」补上了，但只覆盖 `assess` 的存在性。`Authorization` 契约明确是「revocable, never forged」，`data.md` §2 要求核对来源与权限；一个被撤销或属于别的 Work 的授权仍是 authority，等于把第九轮 fail-open 的口子缩小到「必须是表里真实存在的一行」而不是「必须是本次 Work 的有效授权」。`dispatch` 冻结伪造引用则使重启恢复（AC-082）与配置/授权溯源读到不存在的授权。
- **建议**：最低限度在 `assess` 增加 `workId===work.id` 与 `revokedAt===undefined` 两项比对（一行代码量级），并对 `scope/operations` 覆盖性做至少「非空操作必须被授权覆盖」的检查或显式登记为 WP-04 的未完成项；`dispatch` 的 `authorizationRef` 走同一核对函数。若产品方决定全部推迟到 WP-04/WP-05，需登记 `accepted_risk` 并写明当前 `assess` 只做存在性核对。
- **是否阻断**：**阻断**（授权门禁对已撤销/跨 Work 授权仍 fail-open；该项在 T17 中由开发方自行标为 P1 级，本次仅部分落地）。

### R10-03 [P3] `assessment.saved.decidedLevel` 与被接受的行等级自相矛盾，且事件不记录实际生效的 floor

- **位置**：`packages/core/src/orchestrator.ts:261-268`（`floor` 只在失败分支出现）、`:301-313`（事件记 `decidedLevel: decided.level`）。
- **事实（`exp-e` E-1，实跑）**：提交 `intent:'delivery'`、`semanticImpact:false`、空 scope、无风险旗标、`level:'L1'` → 行 `level='L1'` **被接受**；同一评估的 `assessment.saved` 记 `decidedLevel:"L2"`、`decidedReason:"default L2 route"`。根因：`decideLevel` 在没有 `l1` 条件时对所有 delivery 返回 L2，而 `routingFloor` 在「声称满足可核查 L1 前提」时把 floor 降为 L1；事件只写 `decidedLevel`（L2）不写 `floor`（L1），两者对同一行给出相反读法。
- **影响**：`assessment.saved` 是等级路由的审计证据（`data.md` §3、AC-045/AC-082 的读取面）。按事件重建会得到「Core 判定 L2」而记录是 L1，消费方无法解释为何 L1 被放行。不改变当前行为，属证据自洽性问题。
- **建议**：事件同时记录 `floor`（或把 `decidedLevel` 改名为 `floorLevel` 并另记 `decideLevelReason`），使「被接受的行等级 + 生效下限 + 判定理由」三者可区分。
- **是否阻断**：不阻断。

### R10-04 [P3] R9-02 残留：`sourceRefs[].version` 接口仍可选（tsc 通过、运行期拒绝），`stage` 仍为自由字符串并落事件

- **位置**：`packages/core/src/orchestrator.ts:118-137`（`DispatchRequestInput`，`:127` `readonly version?: string`）、`:541`（`stage: request.stage ?? 'assist'`）、`packages/contracts/src/entities/structures.ts:256-273`（`version` 由 `sourceRefSchema` 强制必填、`stage: z.string().trim().min(1).optional()`）；对照 `packages/contracts/src/primitives.ts:112-118`、`packages/contracts/src/entities/work.ts:92-104`（`taskStageSchema` 已存在）。
- **事实（`exp-c`、`tsprobe`，实跑）**：`tsprobe/tsconfig.probe.json` 中 `sourceRefs:[{kind:'artifact',id:'a-1'}]`（无 `version`）**tsc 退出 0**，负对照缺 `requestedRole`/`goal` 退出 1（`TS2739`）；同一调用运行期 `VALIDATION_ERROR: sourceRefs.0.version: expected string, received undefined`。`requestDispatch({..., stage:'nonsense-stage'})` 被接受，`chief_action_required` 的 data 里读回 `stage:"nonsense-stage"`。DC-61（`discovery.md:205-207`）只记录了 `workId/reason/sourceRefs` 的内部可选性，**未记录** `version` 接口不一致与 `stage` 自由字符串。
- **影响**：WP-04 协议接线时，按导出接口编写的 TS 调用方会得到运行期 `VALIDATION_ERROR`（类型与运行期不一致）；任意 `stage` 字符串进入持久事件，与 R8-01「bad field values must not be persisted into `chief_action_required`」的目标不一致（`taskStageSchema` 已在同包可用）。
- **建议**：`DispatchRequestInput.sourceRefs[].version` 去掉 `?`（或反过来放宽 Schema，二选一）；`stage` 改用 `taskStageSchema`（若确需 `'assist'` 等混合取值，则在 DC 中定义并给出枚举）；两项写入 DC-61。
- **是否阻断**：不阻断。

### R10-05 [P3] R9-03 残留：非法 `runParams` 对象仍报 `PROVIDER_UNAVAILABLE`；DC-59 清单未更新为四个冻结输入

- **位置**：`packages/core/src/orchestrator.ts:391-399`（`gateway.availability(role, input.runParams ?? {})` 把非法请求字段的失败转成 `PROVIDER_UNAVAILABLE`）、`:334-347`、`packages/contracts/src/entities/structures.ts:238-247`；记录 `discovery.md:195`。
- **事实（`exp-c`，实跑）**：非对象 `runParams` 已 `VALIDATION_ERROR`；但 `{contextLimit:-5}`/`{bogus:1}`/`{reasoning:'hyper'}`/`{providerId:'not-a-uuid'}` 均走到 `config.resolve` 的可用性分支，报 `PROVIDER_UNAVAILABLE`（"role chief has no usable model: role chief has no complete model profile (…)"）——真实原因是请求字段非法，provider 存在且启用。`exp-e` E-3 证明合法 `runParams` 确被采用（`sources.contextLimit==='run'`，`contextLimit=32000`），故非「静默忽略」。DC-59 仍写三个冻结输入。
- **影响**：与第九轮 R9-03 的第二半一致；对 WP-04/WP-07 从协议 JSON 绑定 `runParams` 时会把客户端字段错误误报为 provider 故障，误导重试与阻塞判定（`agents.md` §5 blocked(provider)）。
- **建议**：在 `dispatchExtrasSchema` 用 `profileSchema.partial()`（或专用 `runParamsSchema`）校验对象内部字段，非法值统一 `VALIDATION_ERROR`；DC-59 清单补上 `runParams`。
- **是否阻断**：不阻断。

### R10-06 [P3] DC-60 记录与代码不符：「`goal`/`scope` 只进 `assessment.saved` 事件（当前实现）」为假

- **位置**：`.agentdev/work/WP-02/discovery.md:198-203`（DC-60，尤其 `:201` 的「方案 A…（当前实现）」与 `:203` 的「`scope`…只在事件/判定中使用」）对比 `packages/core/src/orchestrator.ts:288-313`。
- **事实（`exp-c`，实跑）**：`assessment` 行键与 `assessment.saved` data 键均**不含 `goal`/`scope`**（详见 §3 R9-04 行）。即当前实现是方案 A 与方案 B 之外的第三种状态——两者都不落。DC-60 以「已按方案 A 实现」作结，会让读者以为 `goal`/`scope` 在事件中可查。
- **影响**：记录是后续 Test/Settlement 与产品决定的唯一依据；此处不实会导致产品方在「事件已携带 goal」的错误前提下批准方案 A。
- **建议**：把 DC-60 改为「当前实现：`goal`/`scope` 既不落行也不落事件；方案 A 的落事件改造尚未实施」，或直接实施方案 A（把 `goal`/`scope` 加入 `assessment.saved`）后再维持现述。
- **是否阻断**：不阻断（但须在进入 Test 前更正，否则 Settlement 会按错误事实归档）。

### R10-07 [P3] 新增的 `operation` L3 判定把「任一 operation 名称」等同于「触及运行环境」

- **位置**：`packages/core/src/orchestrator.ts:249-255`；`packages/domain/src/routing.ts:162-188`（`decideLevel` 的 `operationTouchesEnvironment` 分支）；文档 `docs/rules/workflow.md:12`（§2.2「operation涉及运行环境、网络写入或数据操作」）。
- **事实（`exp-a`、`exp-f` F-1，实跑）**：`intent:'operation'` + `scope.operations:['read'|'search'|'edit'|'write'|'bash'|'network'|'deploy'|'delete_data']` **任一非空即强制 L3**，`level:'L2'` 一律 `VALIDATION_ERROR`，`decidedReason` 统一为 "operation touches a running environment"。`read`/`search`/`edit`/`write` 并非 §2.2 列举的「运行环境/网络写入/数据操作」。
- **影响**：fail-closed 的过严判定——只读调查型 `operation` 会被强制要求 L3 与明确操作授权，与 §2.2 的语义不符，§2.5 的「其余为 L2」被覆盖。不构成安全风险，但会产生无谓的授权门禁与返工。
- **建议**：把「触及运行环境」的判据收窄到确有环境副作用的操作集合（如 `bash`/`network`/`deploy`/`push`/`delete_data`/`secret`，或由 `l3Keywords`/策略配置驱动），或明确在 DC-62 中登记「任一 operation 一律 L3」的保守偏离。
- **是否阻断**：不阻断。

---

## 5. 其它观察（不计入 Finding 编号）

1. `isKnownLockdownRiskTerm` 是 `e125bb7` 新增的导出且**全仓零调用**、零测试（已并入 R10-01 证据）；`grantsModificationAuthority` 同样只被定义未被生产代码使用（沿前几轮）。
2. 本轮实测 `assess` 新词表仅由 `packages/core/test/orchestrator.test.ts:287-330` 的 4 条断言覆盖（`安全边界`/`数据删除`/`security-boundary`/`securityBoundary`），`packages/domain/test` 对新词汇零断言——62 行新逻辑的单元覆盖缺失。
3. `assessRequestSchema` 的协议字段名 `assessment`（`structures.ts:281-285`）在仓库内**无外部消费者**：`Orchestrator.assess` 仍以 `AssessInput.payload` 为入口并在内部拼 `{workId, assessment}`，WP-04 的协议绑定尚不存在，故该「协议映射」当前不可观测（不构成缺陷，仅说明 R9-02 漏项 D 的修复无行为差异）。
4. `dispatch` 的 `DispatchInput` 仍未用 `strictObject`（`exp-f` 未复测，沿 R9 §5.1）；快照读路径对外部破坏的行仍抛裸 `ZodError`（沿 R9 §5.2）。
5. `assess` 从不封顶等级：`intent:'assist'`/`'artifact'` 提交 `level:'L3'` 且带真实 `authorizationRef` 会被接受（floor 为 `none`）——当前无消费方使用 assessment 的 level 授权，故仅记录。

---

## 6. 剩余风险（未闭环，供 Test/Settlement 与产品方判断）

1. **并发未验证**：预算准入检查（`orchestrator.ts:385-388`）与事务内 `reserve`（`:449`）之间仍有窗口；单 mailbox 串行假设下不可达，多连接/多进程的双花与「快照已落、Run 未建」未被测试覆盖（沿前几轮）。
2. `budget.tokensReserved` 释放用 `Math.max(0, …)` 夹取，理论上掩盖超释放而非报错（沿前轮）。
3. `timed_out`/`interrupted`/`recovery_required` 终态无产生路径（WP-05 职责）；`onChildSettled` 仍无生产调用方（WP-05）。
4. `ModelGateway` 的真实 HTTP、Secret 解析与 `testConnection` 真连属 WP-07/WP-10（DC-31）；`Work blocked(provider)` 投影属 WP-05（DC-42）。
5. `runParams` 的授权来源（DC-38）仍缺 Authorization 实体绑定；本轮 R10-02 进一步说明即使绑定，`assess` 的存在性核对也不足以判定授权有效。
6. 快照读路径对**外部破坏**的行仍抛裸 `ZodError`；写路径已兜底。
7. N-11 产品决定仍在：`data.md:30` 的三个 `:ID` 快照引用与实现的哈希并存，属 `Product Decision Pending`。
8. 待产品方决定项：R10-01（风险旗标词表/fail-closed 语义）、R9-04/R10-06（`Assessment.goal`/`scope` 是否落库或落事件）、R10-02（授权核对深度是否全部推迟到 WP-04/WP-05，以及是否登记 `accepted_risk`）。

---

## 7. 方法与边界声明

- 本报告只依据仓库文件、`e125bb7` 上的 git 对象/差异与实跑命令；未读取任何开发对话、未引用外部同名技能或历史方案。
- 阅读深度：`orchestrator.ts`、`join.ts`、`run-lifecycle.ts`、`auth.ts`、`routing.ts`、`structures.ts`、`primitives.ts`、`work.ts`、`snapshots.ts` 逐行；`config.ts`、`model-gateway.ts`、`events.ts`、`stage.ts`、`dispatcher.ts`、`mailbox.ts`、`requirements.ts`、`toml.ts` 按注释声称与关键分支抽查（这些文件在 `e125bb7` 中未改动，且由本轮全量测试覆盖）。R9-01..R9-06 与 A/B/C 的判定不依赖对未改动文件的推断。
- 唯一写入文件为本文件 `.agentdev/work/WP-02/review.md`；实验脚本独立写在 `/tmp/wp02-r10/`（`fixture.mjs`、`exp-a..f.mjs`、`tsprobe/{tsconfig,tsconfig.probe,probe,probe2,probe3}` 与 `exp-*.log`、`cmds.log`），使用 `pnpm build` 产出的 `packages/*/dist`，通过 `/tmp/wp02-r10/node_modules/@agentdev/*` 软链解析 workspace 包，等价复现 `orchestrator.test.ts`/`join.test.ts`/`auth.test.ts` 的夹具但**不 import 任何产品测试文件**。
- 未修改产品代码、测试、`docs/**`、`plan.md`、`implementation.md`、`discovery.md`；`pnpm build` 只写 `.gitignore` 中的 `dist/`。写入本报告前 `git status --porcelain` 无输出、`HEAD=e125bb7ea727a58c98ae95469a88a0e049e86660`。
- 本报告覆盖了第九轮 `review.md`（`git show 328ee60:.agentdev/work/WP-02/review.md` 可取回）；第八/七/六/五/四/三/二/一轮分别用 `git show 328ee60:…`、`git show f02aca4:…`、`git show 0211ced:…`、`git show 5a87a86:…`、`git show 411d04f:…`、`git show a8daa6d:…`、`git show c4763d5:…`、`git show 785bdd6:…` 取回。
