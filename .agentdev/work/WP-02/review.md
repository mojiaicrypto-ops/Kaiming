# WP-02 独立 Review 报告（第十五轮）

- 评审对象：工作包 WP-02「主管与独立Agent调度」
- 评审轮次：**第十五轮**（逐条复核第十四轮 R14-01..R14-05 与对抗性 D-1..D-4 是否真修，核对注释/记录声称与代码是否一致，并找新问题）
- 冻结点：git `088bdd7`（`test(domain): assert every contract operation is classified by the gates`），前置 `eb8c3b8`（`fix(core): WP-02 review round 14 findings (R14-01..R14-05, D-1..D-4)`）
- HEAD 校验：`git rev-parse HEAD` = `088bdd7150ad9e322020e3000da18771de86c724`；`git log -1` = `088bdd7 test(domain): assert every contract operation is classified by the gates`
- 工作树：复核开始、每组实验后、全部契约命令后、本报告写入前 `git status --porcelain` 均无输出（`pnpm build` 只写被 `.gitignore` 忽略的 `dist/`）
- 评审角色：Review（独立上下文，未读取任何开发对话；只依据仓库文件、git 对象与我自己的实验）
- 权威依据：`AGENTS.md`、`docs/rules/{workflow,agents}.md`、`docs/architecture/{ARCHITECTURE,data,protocol,reliability,context,execution}.md`、`docs/delivery/{implementation,acceptance}.md`（WP-02 与 AC-043/044/045/046/047/082）、`.agentdev/work/WP-02/{plan,implementation,discovery}.md` 全部记录、`packages/core/src` 全部 17 个文件、`packages/domain/src` 全部、`packages/contracts/src/entities/{structures,work,common}.ts` 与 `primitives.ts`、`packages/core/test` 与 `packages/domain/test`
- 方法：逐行核对「注释/记录/提交信息声称」与代码；在 `/tmp/wp02r15/` 自建夹具与 7 组实验脚本（`fixture.mjs`、`lib.mjs`、`exp1..exp7.mjs`），用 `pnpm build` 产出的 `packages/*/dist` 独立复现（软链 `/tmp/wp02r15/node_modules/@agentdev/*`）；**不修改产品代码、测试、`docs/**`、`plan/implementation/discovery`**
- 工具：`node v24.8.0`、`pnpm 12.3.4`

---

## 0. 历史轮次结论摘要（保留，第一至十四轮）

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
| 第十四轮 | `9f62582` | FAIL | 0×P1、1×P2、4×P3（R14-01..R14-05）＋对抗性 D-1..D-4；阻断项 R14-01（`git` 未计入工作区写操作，`none` 级 Work 可零授权派发） |

各轮要点（原文见各轮报告，本报告 §3 只复述本轮实跑结论）：

- **第一轮**：P1＝`stage.submit` 无终态/epoch 守卫；P2＝「父等待可接消息」证据空洞、`joinPolicy=none` 未实现、持久事件名偏离 `protocol.md` §7、越界写入 Plan、`run.ts` 快照引用改哈希与 `data.md` 冲突。
- **第二轮**：`contract_violation` 不释放预算、非 running 仍接受交付、自造 Join 事件名、终态父 Run 仍收新子 Run、重复 `chief_action_required`、二次 Schema 失败在 `paused` 抛错等。
- **第三轮**：M-01（P1）父 Run 级预算预留从不释放；M-02 预算只预留/释放不核销；M-03 `Work blocked(provider)` 未落地。
- **第四轮**：Q-01（`operationId` 只按键去重不校验载荷）、Q-04（父 Chief Run 可在 `join=all` 子 Run 未终态时被结算）。
- **第五轮**：R5-01（指纹漏字段）、R5-02（`settleRun(...,'cancelled')` 绕过守卫）、R5-03（超限 usage 卡死）、R5-04（`reconcile` 不幂等）、R5-05（`join=none` 孤儿待办）；`H-03` 全仓无定义。
- **第六轮**：R6-01（P1）`reconcile` 双重核销→双重计费；R6-02 `cost` 只进事件不进 Work 预算；R6-03 `settleRun(...,'cancelled',usage)` 静默丢弃实测用量。
- **第七轮**：R7-01 malformed `DispatchSpec` 抛裸 `TypeError`；R7-02 `reconcile` 幂等比较忽略 `cost`；R7-03 `measured:false` 带 cost 被静默丢弃；R7-04 `reconciliation` 计数恒 1；R7-05 DC-48；R7-06 DC-35；R7-07 被拒 dispatch 仍落快照行；R7-08 DC-46；R7-09 级联取消不释放「从未启动」子 Run 的预留。
- **第八轮**：R8-01 `requestDispatch` 无契约校验；R8-02 `assess` 无契约校验；R8-03 零消费取消的死预留；R8-04 被拒 dispatch 留快照行；R8-05/R8-06 记录不符；R8-07 `§65` 引用；R8-08 失效引用/注释；R8-09 `contextPayload` 无校验。
- **第九轮**：R9-01（P2，阻断）L3 底线只认 8 个英文 camelCase 旗标、中文/kebab/大小写/拼写错误静默按 L2 通过（fail-open）；R9-02 `dispatchRequestSchema` 与 `protocol.md` §1/§6 不一致；R9-03 `runParams` 未覆盖；R9-04 `assess` 静默丢弃 `goal`；R9-05 `auth.ts` 注释过度声称；R9-06 父 Run `paused` 时 Chief 待办缺失；对抗性 A＝`operation` L3 判定源错误，B＝`authorizationRef` 不核对授权实体，C＝`scope` 被静默丢弃。
- **第十轮**：R10-01（阻断）未登记风险旗标仍静默降级、`isKnownLockdownRiskTerm` 零调用；R10-02（阻断）授权核对只查存在性、跨 Work/已撤销仍被接受、`dispatch` 的 `authorizationRef` 完全不核对；R10-03 事件不记 `floor`；R10-04 `sourceRefs[].version` 接口可选而运行期必填；R10-05 非法 `runParams` 报 `PROVIDER_UNAVAILABLE`；R10-06 DC-60 与代码不符；R10-07 `operation` 判定过严。
- **第十一轮**：R11-01（阻断）`intent:'assist'/'artifact'` 在环境/风险门禁之前 `return none`，两条 L3 门禁 fail-open；R11-03（阻断）L3 Work 的 `dispatch` 不要求任何授权；R11-02 `routingFloor` 对 `operation` 返回 `none`；R11-04 JSDoc 被常量块截断；R11-05 环境操作集合硬编码。
- **第十二轮**：R12-01（阻断）`dispatch` 只按 `work.level` 查授权，不按 spec `scope` 施 L3 底线；R12-02（阻断）授权 `operations`/`scope` 不参与判定；R12-03 核对结果未冻结进 DispatchSnapshot；R12-04 `verifyAuthorization` JSDoc 与调用点不符；R12-05 DC-62 未写集合归属；对抗性①`none` Work 可派写权限 Run 且 `grantsModificationAuthority` 是死代码；②风险词表斜杠归一未生效。
- **第十三轮**：R13-01（P2，阻断）授权 `scope.writePaths`/`readPaths` 不参与判定、只读授权可为写范围背书；R13-02（P2，阻断）`none` Work 写权限门禁作用在派生 `runLevel` 上、声明一个被授权的环境操作即可绕过；R13-03（P2）显式 `undefined` 可选字段抛非协议错误码 `CONSTRAINT_VIOLATION` 并留孤儿快照；R13-04（P3）DC-63 未同步且与代码相反；R13-05（P3）测试 `DC-65` 错号、「read-only grant」注释不实、只读授权用例缺失；R13-06（P3）`config.policy.l3Paths`/`l3Keywords` 无读取方。
- **第十四轮**：R14-01（P2，阻断）`git` 不在 `WORKSPACE_WRITE_OPERATIONS`，`none` 级 Work 只要拿到一张 `operations:['git']` 的授权即可建立带修改权限的 Run；R14-02（P3）DC-66 两处仍与代码相反；R14-03（P3）`verifyAuthorization` JSDoc 未包含路径维度；R14-04（P3）R13-01 新用例未真正覆盖「只读授权 × 写范围」；R14-05（P3）R13-06 的「gap vs 缺陷」定性澄清。对抗性 D-1..D-4＝`git` 零授权即可派发、只读授权可为网络目标背书、`readPaths` 收紧未登记、`assess` 不做 `none` 写门禁。

**追溯口径（沿用第五轮 DC-53/DC-56 口径）**：行为/需求缺失＝P1（阻断）；局部质量/维护＝P2；建议＝P3。P2/P3 是否阻断由本轮按 `workflow.md` §6（第 65 行）「影响验收则阻断」判定。**L3/授权门禁类缺陷沿用 R9-01/R10-01/R11-01/R11-03/R12-01/R12-02/R13-01/R13-02/R14-01 的 P2 标定**（按 §6 字面「错误行为/需求缺失」亦可判 P1；两者都阻断，本轮保持既有标定以免口径漂移）。

**历史报告取回方式**：第十四轮（`git show 9f62582:.agentdev/work/WP-02/review.md`，内容为第十三轮报告正文，其 §1/§4 即第十四轮条目来源）；第十三轮 `git show e3b210c:.agentdev/work/WP-02/review.md`；第十二轮 `git show fec9a9d:…`；第十一轮 `git show 080aa4c:…`；第十轮 `git show e125bb7:…`；第九/八轮 `git show 328ee60:…`／`f02aca4:…`；第七轮 `git show 0211ced:…`；第六轮 `git show 5a87a86:…`；第五轮 `git show 411d04f:…`；第四轮 `git show a8daa6d:…`；第三轮 `git show c4763d5:…`；第一、二轮原文见第二轮报告 §0。第十四轮的独立报告正文未单独入库，其 R14-01..R14-05 与 D-1..D-4 的条目文本由 `eb8c3b8` 的提交信息、`discovery.md` DC-63/DC-66/T22 与 T22 的说明段还原。

---

## 1. 本轮结论

**FAIL（Review Failed）——第十四轮的阻断项 R14-01 与 D-1 已真修好（并且是强于报告要求的形态：`none` 级 Work 无论带不带 `git` 授权都被拒），R14-02、R14-03、R14-05 与 D-2、D-3、D-4 全部核实修好/登记到位，R14-04 的前提经复现确认不成立（开发方说明正确）但结论已按更强的方式补强；新增操作名分类完备性测试（`088bdd7`）经独立核验通过。但同一门禁族仍存在一处同型 fail-open：**写入范围（`writePaths`）不需要授权里存在任何写操作**——一张 `operations:['read']`（或 `['search']`/`['deploy']`/`['bash']`/…）且 `scope.writePaths` 覆盖该路径的授权，可以为一张声明 `writePaths` 但 `operations:[]` 的 Run 背书，并把该写范围冻结进 `effectiveScope`（R15-01，阻断）。本轮共 **0×P1、1×P2、3×P3（R15-01..R15-04）**，其中 R15-01 按 `workflow.md` §6「影响验收则阻断」判为阻断，**阻断进入独立 Test**。**

**逐条裁定（详见 §3）**

| 第十四轮条目 | 本轮裁定 |
|---|---|
| **R14-01**（阻断）`git` 未计入工作区写操作，`none` 级 Work 可零授权派发 | **完全修好 ✓**：`WORKSPACE_WRITE_OPERATIONS` 增加 `'git'`（`domain/routing.ts:179-187`），`declaresWorkspaceWrite` 命中即真（`:192-200`）；`dispatch` 门禁仍用 `work.level`（`orchestrator.ts:369`）。实跑（`exp1`/`exp6`/`exp7`）：`none` Work + `operations:['git']`（**无授权**）⇒ `NOT_AUTHORIZED: cannot create a Run with write authority`，details `workLevel:'none'`、Run/快照增量 0；同一形状**再带上该 Work 的 `git` 授权**（`AUTH_NONE_GIT`）⇒ 同样拒绝、零副作用；`none` Work 的 **Work 行自带** `authorizationRef`（指向 `git` 授权）时同样拒绝（`exp6` A）；12 种操作 × 携带 `writePaths` 的 spec 在 `none` Work 上**全部**拒绝（`exp1` C，覆盖 `read`/`search` 到 `delete_data`）。 |
| **R14-02**（P3）DC-66 两处仍与代码相反 | **完全修好 ✓**：DC-66 已整段重写，第 1 条现写「判据用 **Work 自己的等级**…『是否修改』由 `writePaths` 非空**或**命中 `WORKSPACE_WRITE_OPERATIONS = ['edit','write','artifact_write','git']` 判定」（`discovery.md:240-246`），第 4 条的「后续工作」列表已删除 `writePaths` 一项，只留 `acceptedAt`/来源消息、`once` 记账、`work.level` 回写与「`writePaths` 之外的文件级粒度」。旧句两处均已消失。**但同族 DC-67 仍写旧值（见 R15-04）**。 |
| **R14-03**（P3）`verifyAuthorization` JSDoc 未含路径维度 | **完全修好 ✓（含一处轻微微差）**：JSDoc（`orchestrator.ts:744-755`）现含「every `operations` entry and every `writePaths`/`readPaths` entry must be inside the grant, every network target must be granted *and* backed by the `network` operation, and a network target alone never grants a write」（`exp5` B1/B2 实读断言通过）。微差：参数内联注释（`：760`）仍写「`undefined` when no level is known yet」，而两个调用点（`:291`、`:385-390`）都传确定等级（`exp5` B4/B5）——沿第十三轮 §5 观察，不计 Finding。 |
| **R14-04**（P3）R13-01 新用例未覆盖「只读授权 × 写范围」 | **前提被证伪、结论已按更强方式补强 ✓（残余见 R15-03）**：`backendSpec` 的默认 `scope` 是 `{ ...emptyScope, writePaths: ['packages/storage/src'] }`，`emptyScope.operations = []`（`orchestrator.test.ts:41,362`），所以该用例确由 `uncoveredWritePaths` 拒绝，第十四轮报告「第一断言由操作维度先拒绝」不成立——开发方在 T22 的说明与 `exp5` C1 的实读一致；新断言现在直接断言 `details.uncoveredWritePaths` 且 `uncoveredOperations === []`（`:605-615`）。行为侧我另用**真正的只读授权**（`operations:['read']`、`readPaths:['docs']`）复现（`exp2` COV1-4）：`uncoveredOperations:[]`、`uncoveredWritePaths:['docs']` ⇒ 路径维度确为拒绝原因。**残余**：仓库内仍无 `operations:['read']` 的授权夹具，R13-01 的「只读授权」用例仍不存在（R15-03）。 |
| **R14-05**（P3）R13-06 的定性澄清（`l3Paths`/`l3Keywords` 属已登记缺口） | **确认 ✓（记录项）**：DC-70 已把「实现」明确登记为 WP-04/WP-05 的策略落线（`discovery.md:262-265`）；独立复跑（`exp7` D1/D2）：`config.update('global',{l3Paths,l3Keywords})` 被接受，命中 `l3Paths` 的评估仍按 L2 通过；`data.md:59`/`protocol.md:96` 只规定这两个键可配置，未定义 L3 语义。定性为「已登记的实现缺口」，本轮不再作为缺陷计。 |
| **对抗性 D-1** `none` 级 Work 可零授权派发 `git` | **完全修好 ✓**：见 R14-01 行（`exp1` A/B 两条：无授权与被授权均拒）。 |
| **对抗性 D-2** 只读授权可为网络目标背书 | **完全修好 ✓**：`verifyAuthorization` 新增 `networkTargetsWithoutGrant`（`orchestrator.ts:806-809`、`:816-836`）。实跑（`exp2`）：授权 `operations:['read']` + `scope.networkTargets:['10.0.0.5']` + spec `operations:['read'], networkTargets:['10.0.0.5']` ⇒ `NOT_AUTHORIZED`，details `networkTargetsWithoutGrant:['10.0.0.5']`、`uncoveredOperations:[]`、`uncoveredNetworkTargets:[]`（证明拒绝原因**只**是新维度）；目标不在授权里 ⇒ `uncoveredNetworkTargets` 拒绝；授权带 `network` + 目标 ⇒ 接受（无过度拦截）。 |
| **对抗性 D-3** `readPaths` 收紧未登记 | **完全修好 ✓（记录项）**：DC-63 已登记「路径维度是对既有行为的收紧（第十四轮 D-3）：L3 Work 拿一张 `scope.readPaths` 为空的授权后，声明 `readPaths` 的 Run 也会被拒；这一收紧是有意的 fail-closed」（`discovery.md:226`）。实跑（`exp2` D3a/D3b/D3c）：空 `readPaths` 授权 + 声明 `readPaths:['docs']` ⇒ `uncoveredReadPaths:['docs']` 拒绝；覆盖授权 + 子路径 `docs/rules` ⇒ 接受；`packages/core` ⇒ 拒绝。 |
| **对抗性 D-4** `assess` 不做 `none` 写门禁 | **完全修好 ✓（记录项）**：DC-66 第 4 条与 DC-67 已登记「`assess` 不是 Run 边界（它只记录路由；`work.level` 的回写属 WP-04/WP-05）」（`discovery.md:242,246`）。实跑（`exp2` D4a/D4b/D4c）：`none` Work 提交带 `writePaths:['packages/core/src'], operations:['git']` 的 `assess`（intent `assist`、level `none`）被**接受**（按设计只记录路由），但同一 scope 在 `dispatch` 上仍被拒；`assess` 自身对提供的 `authorizationRef` 仍做范围核对（D4c：未覆盖的 `writePaths` ⇒ `NOT_AUTHORIZED`）。 |
| **（开发方补强）** `088bdd7` 操作名分类完备性测试 | **核实通过 ✓**：`domain.test.ts:246-259` 用 `operationNameSchema.options` 断言「工作区写 ∪ 环境 ∪ {read,search}」覆盖全部 12 个取值且 `classified.size === options.length`。我另用实现的导出独立复算（`exp1` D1-D5）：两集合交集为空、无未分类项、**没有**操作能同时逃过两道门禁。该测试是有效防回归（未来新增操作名若不被分类会立刻失败），但它只防「两边都漏」，不防「单边漏一格」（R15-01 正是如此）。 |

**新发现**：R15-01（P2，阻断，`writePaths` 不需要授权里有写操作即可背书并冻结，`orchestrator.ts:796-837`）、R15-02（P3，`authorizationSchema.operations` 未用 `operationNameSchema` 枚举、与 `scopeSchema.operations` 及自身注释不一致，`entities/work.ts:134`）、R15-03（P3，`none` Work × `git` 授权与真正只读授权 × 写范围两类用例仍缺失，`orchestrator.test.ts:649-661`、`:224-231`）、R15-04（P3，DC-67 仍写 `WORKSPACE_WRITE_OPERATIONS = ['edit','write','artifact_write']` 不含 `git`，`discovery.md:251`）。

### 前十四轮阻断项的当前状态（本轮实跑复核）

- 第九轮 R9-01 / 第十轮 R10-01 / 第十一轮 R11-01：`exp1`/`exp7` 相关路径未回退（未登记旗标、`assist` 短路、环境操作抬级均未改动，`git` 修正只收紧了写门禁）。
- 第十轮 R10-02 / 对抗性 B 授权实体核对：`exp6` C 三类（跨 Work、已撤销、未覆盖操作）全部 `NOT_AUTHORIZED` 且零副作用，**未回退**。
- 第十二轮 R12-01/R12-03：`exp6` B1、`exp7` E1 与 `exp6` D/E 复核通过（spec scope 施 L3 底线、核对结果冻结、快照内容寻址幂等、`recoveryView` 窄范围不被 Work 放宽影响），**未回退**。
- 第十三轮 R13-01/R13-02/R13-03：路径/操作/网络覆盖矩阵（`exp2`/`exp3` A/B）与 `jsonClean` 行为未回退；`none` 写门禁在 12 种操作上全部生效（`exp1` C）。
- 第十四轮 R14-01..R14-05/D-1..D-4：见上表。
- 第五至八轮的事件分页、幂等、预算、终态路径：本轮 `pnpm test:unit` 248 / `pnpm test:integration` 124 全绿覆盖（§2）。

---

## 2. 契约命令原始结果（本轮实跑）

执行方式：`export PATH="$HOME/.local/bin:$PATH"`，在仓库根目录按序执行并逐条记录退出码（日志存 `/tmp/r15/cmds1.log`、`/tmp/r15/cmds2.log`）。

| 命令 | 退出码 | 原始结果要点 |
|---|---|---|
| `pnpm typecheck` | **0** | `tsc -p tsconfig.json --pretty false`，无输出 |
| `pnpm lint` | **0** | `node scripts/lint.mjs`：`Checking formatting...` / `All matched files use Prettier code style!` |
| `pnpm test:unit` | **0** | `Test Files 17 passed (17)` / **`Tests 248 passed (248)`** / `Duration 2.37s`（**与 T22 与 `eb8c3b8` 提交信息声称的 247 不一致，见 R15-04**）。单跑 `npx vitest run --project unit packages/core/test/orchestrator.test.ts packages/domain/test/domain.test.ts` ⇒ `43 + 31 = 74 passed`；第十三轮同两文件为 `42 + 30 = 72`（`9f62582`），即本轮净增 2 条 `it`（`eb8c3b8` 的 core 用例、`088bdd7` 的 domain 用例；`eb8c3b8` 在 domain.test.ts 内只加断言不加 `it`） |
| `pnpm test:integration` | **0** | `Test Files 10 passed (10)` / `Tests 124 passed (124)` / `Duration 37.48s`（与 T22 声称的 124 一致） |
| `pnpm docs:check` | **0** | `docs:check ok — 15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages` |
| `pnpm build` | **0** | `packages/{contracts,domain,storage,core,pi-runtime}`、`apps/{cli,runner}` 共 7 个 workspace `build: Done`（首次与集成测试并发执行，为消除竞争已在全部实验后单独重跑一次，同样 7 个 `Done`、退出码 0） |
| `git status --porcelain` | — | 复核开始、各组实验后、全部契约命令后、本报告写入前均**无输出**（干净） |
| `git rev-parse HEAD` | — | `088bdd7150ad9e322020e3000da18771de86c724`（= 冻结点） |

**自建实验（观察值记录；标记 `FAIL` 的断言即 Finding 证据）：**
`exp1`（R14-01 `git`/D-1 + 12 操作分类）**10 passed / 0 failed**（5 INFO）；`exp2`（D-2/D-3/D-4 + 覆盖维度）**12 / 1**（唯一 fail 为 `D2d` 的预设断言不成立——spec 只声明 `networkTargets` 不带 `network` 操作时被接受，见 §5.2，非缺陷）；`exp3`（路径前缀 + 预算/授权门交互）**15 / 2**（两条均为夹具问题：`E4` 跨 Work 父 Run、`F3` 即 R15-02）；`exp4`（写范围是否需要写操作）**0 passed / 1 failed / 9 INFO**（唯一 fail 为 `F1` 即 R15-02；`A1`/`B1`/`D1` 为 R15-01 证据）；`exp5`（记录/注释一致性）**16 / 0**；`exp6`（Work 行授权回退、`none` Work 环境范围、零副作用、AC-082 窄范围）**14 / 0**；`exp7`（对 R15-01 的对抗性证伪）**4 / 0**。脚本与日志存 `/tmp/wp02r15/{fixture,lib,exp1..exp7}.mjs`；所有实验用 `pnpm build` 后的 `packages/*/dist`，通过 `/tmp/wp02r15/node_modules/@agentdev/*` 软链解析 workspace 包，**不 import 任何产品测试文件**。

---

## 3. 逐条复核表（第十四轮条目 + 对抗性 D-1..D-4 + 开发方补强）

| 条目 | 前轮定级 | 本轮实测证据（脚本/观察值） | 判定 |
|---|---|---|---|
| **R14-01** `git` 未计入工作区写操作 | P2（阻断） | `exp1` A1/B1：`none` Work + `{operations:['git']}`，无授权与被授权两种形态均 `NOT_AUTHORIZED`（details `workLevel:'none'`、`writePaths:[]`），Run/快照增量 0；`exp1` C：12 种操作 × `writePaths:['packages/core/src']` 全拒；`exp6` A1：Work 行自带 `git` 授权时仍拒；`exp7` B1：8 种非写授权 × 空操作的写范围 Run 均在 `L2` Work 上被**接受**（R15-01 证据，与 `none` 门禁无关）；`routing.ts:179-187`、`orchestrator.ts:369` | **完全修好 ✓** |
| **R14-02** DC-66 与代码相反 | P3 | `exp5` A1/A3：DC-66 含 `'artifact_write','git'`，与 `routing.ts` 一致；DC-66 第 4 条已无 `writePaths` 后续项。同族 DC-67 仍不含 `git`（R15-04） | **被点名处完全修好 ✓ / 同族见 R15-04** |
| **R14-03** JSDoc 未含路径维度 | P3 | `exp5` B1-B5：JSDoc 含 `writePaths`/`readPaths` 与 `network` 操作要求；两个调用点（`:291 payload.level`、`:385-390 runLevel`）均传确定等级；参数内联注释仍称「`undefined` when no level is known yet」 | **完全修好 ✓（一处轻微微差，不计 Finding）** |
| **R14-04** R13-01 用例未覆盖路径维度 | P3 | `exp5` C1：`backendSpec` 默认 `scope` 无 `operations`、有 `writePaths`（`:41,362`）⇒ 第十四轮「操作维度先拒绝」的前提不成立，开发方说明正确；`exp5` C3/C4：新断言直接断言 `uncoveredWritePaths` 与空 `uncoveredOperations`；`exp2` COV1-4：我构造的真正只读授权（`operations:['read']`、`readPaths:['docs']`）证明路径维度确为拒绝原因 | **前提证伪、结论已按更强方式补强 ✓（仓库夹具仍缺，见 R15-03）** |
| **R14-05** `l3Paths`/`l3Keywords` 定性 | P3 | `exp7` D1/D2：配置被接受、命中路径的评估仍 L2；`discovery.md:262-265`（DC-70）已登记为 WP-04/WP-05 缺口；`data.md:59`/`protocol.md:96` 只定义「可配置」 | **确认 ✓（记录项）** |
| **对抗性 D-1** `git` 零授权派发 | P2 | 同 R14-01（`exp1` A/B、`exp6` A） | **完全修好 ✓** |
| **对抗性 D-2** 只读授权为网络目标背书 | P2 | `exp2` D2a：details `networkTargetsWithoutGrant:['10.0.0.5']`、`uncoveredOperations:[]`、`uncoveredNetworkTargets:[]` ⇒ 唯一拒绝原因是新维度；D2b 目标缺失 ⇒ `uncoveredNetworkTargets`；D2c 授权带 `network`+目标 ⇒ 接受；`orchestrator.ts:806-836` | **完全修好 ✓** |
| **对抗性 D-3** `readPaths` 收紧未登记 | — | `discovery.md:226` 已登记收紧语义；`exp2` D3a/D3b/D3c 行为与登记一致（空授权拒、覆盖子路径接受、越界拒） | **完全修好 ✓（记录项）** |
| **对抗性 D-4** `assess` 不做 `none` 写门禁 | — | `discovery.md:242,246` 已登记「`assess` 不是 Run 边界」；`exp2` D4a（接受）/D4b（同 scope 在 dispatch 被拒）/D4c（assess 仍核对授权范围）与登记一致 | **完全修好 ✓（记录项）** |
| **补强** 操作名分类完备性测试（`088bdd7`） | — | `domain.test.ts:246-259`；`exp1` D1-D5 独立复算：交集空、无遗漏、无操作同时逃过两门禁 | **核实通过 ✓（防回归有效，但不覆盖单边漏格）** |

---

## 4. 新 Findings（R15-01..R15-04）

### R15-01 [P2，阻断] 写入范围不需要授权里的写操作：`operations:['read']`/`['search']`/`['deploy']`/… 的授权即可为 `writePaths` 背书并冻结

- **位置**：`packages/core/src/orchestrator.ts:796-837`（`verifyAuthorization` 的覆盖核对：`uncoveredOperations` 只比对 `scope.operations`，`uncoveredWritePaths` 只比对授权 `scope.writePaths`，**从不用授权 `operations` 校验声明了写路径的 Run 是否被授予写操作**；对照 `:806-809` 对网络目标已经补了 `networkTargetsWithoutGrant`）；`:468`（`effectiveScope: spec.scope` 原样冻结）；`:365`（`runLevel`）；契约 `packages/contracts/src/primitives.ts:121-143`（`operationNameSchema` 注释自称用于「`Scope.operations` **and in Grants**」）；文档 `docs/architecture/data.md:22`（work 行「none不产生修改授权」）、`:26`（authorization「Chief解释绑定范围，**Core核对来源与权限**」）、`:80`（`effectiveScope` 是窄范围权威）；`docs/rules/workflow.md:7`（「Core检查角色、字段、授权、权限和版本」）；记录 `discovery.md:219-228`（DC-63 只登记四类覆盖面，未登记本缺口）、`:240-246`（DC-66）。
- **事实（`exp4` A1/B1、`exp7` B1，实跑）**：
  - `WORK_ID` 是 **L2** Work（`work.level='L2'`，不受 `none` 写门禁约束）。授权 A 的 `operations: ['deploy']`、`scope.writePaths: ['packages/storage/src']`；spec 声明 `writePaths: ['packages/storage/src']`、`operations: []` ⇒ **接受**，Run +1，`dispatchSnapshot.effectiveScope = {"readPaths":[],"writePaths":["packages/storage/src"],"operations":[],"networkTargets":[]}`，`authorizationRef = A`（`exp4` A1-A3）；
  - 同类：授权 `operations:['read']` + 写路径，spec 空操作 + 同一写路径 ⇒ **接受**（`exp4` B1）；`operations:['read']`、`scope.operations:['deploy']` 同时存在的授权 ⇒ 同样**接受**（`exp7` E2，证明 `Authorization.scope.operations` 也不被消费）；
  - 广度：`read`/`search`/`deploy`/`bash`/`secret`/`push`/`network`/`delete_data` **八种**授权操作 × 空操作写范围 Run **全部接受**（`exp7` B1，8/8）；
  - 该形状**只**在 spec 同时声明写操作时被拒：spec `{writePaths:['packages/storage/src'], operations:['write']}` + `deploy` 授权 ⇒ `NOT_AUTHORIZED`（`exp7` A1a）；spec 加上 `operations:['read']` 也立刻被拒（`exp7` A1b）——即「**声明得越少越宽**」，与 D-2 对网络目标的修复方向完全对称；
  - 对照：授权 `operations:['write']` + **空** `scope.writePaths` + spec 写路径 ⇒ `uncoveredWritePaths` 拒绝（`exp4` C1），说明两条维度各自工作，缺的只是「写路径必须由写操作背书」这一条**交叉**约束。
- **影响**：`data.md:26` 把授权定义为「Chief解释绑定范围，Core核对来源与权限」，`data.md:80` 把 `effectiveScope` 定义为 Run 的窄范围权威（AC-082 依据）。当前实现里，一张为「部署」或「只读」用途签发的授权，可以为一张写范围 Run 背书并把该写范围冻结为「已生效范围」，而冻结的 `operations:[]` 又不含任何写操作——AC-082 的窄范围证据既不代表被授权的操作，也不含「写已被授权」的任何痕迹。这与第十三轮 R13-01（只读授权为写范围背书）是同一 fail-open 的**交叉维度残留**：R13-01 修好了「路径 ⊆ 授权路径」，但没修「声明写 ⇒ 授权里有写操作」。可达性需要一张绑定该 Work 的真实授权（用户来源，非凭空造权），因此不是零授权漏洞；且冻结的 `operations:[]` 使工具层（WP-07）按操作列表判权时倾向 fail-closed，所以**当前不构成已可利用的越权写入**，但 Run 边界的授权判定本身是错误的，属授权/等级门禁族。
- **建议**：(a) 与 `networkTargetsWithoutGrant` 对称，当 `scope.writePaths.length > 0` 时要求 `authorization.operations` 至少命中一个写操作（`WORKSPACE_WRITE_OPERATIONS`，含新的 `git`），details 增 `writePathsWithoutGrant`；(b) 若产品语义是「授权 `scope.writePaths` 非空本身即等于写授权」，则必须把该语义写进 `data.md` 与 DC-63，并把 `declaresWorkspaceWrite` 的操作支路与之一致化（现在代码内部对「写」有两套判据）；(c) 明确 `Authorization.operations` 与 `Authorization.scope.operations` 的优先级（`exp7` E2 显示后者被静默忽略，沿第十二轮 §5.3）；(d) 补「授权 `operations:['read']` × 声明 `writePaths` ⇒ 拒绝」的失败测试（当前 248 条单测无此用例）。
- **是否阻断**：**阻断**（授权门禁在 Run 建立边界错误，且 `data.md:22/:26`/AC-082 的「已核对授权」证据不成立；标定沿用 R12-01/R12-02/R13-01/R14-01 的 P2）。

### R15-02 [P3] `authorizationSchema.operations` 未使用操作名枚举：与 `scopeSchema.operations` 及自身注释相反

- **位置**：`packages/contracts/src/entities/work.ts:134`（`operations: list(z.string().min(1))`）；对照 `packages/contracts/src/primitives.ts:121-122`（`operationNameSchema` 的 JSDoc：「Tool-operation names accepted in `Scope.operations` **and in Grants**」）、`:142`（`scopeSchema.operations: boundedArray(operationNameSchema)`）；文档 `docs/architecture/data.md:55`（「Scope里operations只能取 read/…/delete_data；未知值拒绝」）、`:26`（authorization 行的 `operations:string[]`）。
- **事实（`exp3` F3、`exp4` F1/F2，实跑）**：`store.authorizations.insert({ operations: ['git_write'] })` 与 `operations: ['writ']` 均**插入成功**；没有 Schema 报错，也没有运行期校验（`verifyAuthorization` 只做 `granted.has(operation)` 集合比较）。对照 `dispatch` 入口：`scope.operations: ['git_write']` ⇒ `VALIDATION_ERROR`，details 列出全部 12 个合法取值（`exp3` F2）。因此同一字段在 `Scope` 上是封闭枚举、在 `Authorization` 上是任意非空字符串，且该列的 JSON CHECK 也只判 `json_valid` 与数组长度。
- **影响**：`data.md:26` 把 authorization 记为「Chief解释绑定范围，**Core核对来源与权限**」的权威来源。授权一侧允许拼写错误/未登记操作名落库后，`verifyAuthorization` 的 `uncoveredOperations` 会用一个「谁都匹配不上」的集合做比对：fail-closed 方向（授权失效、Run 被拒），所以**不构成放行**；但它使一条本应被契约拒绝的授权成为永久死授权（用户以为已授权、实际永远不生效），且与 `operationNameSchema` 注释声称的适用范围直接矛盾。这是第十轮操作名分类工作的同一主题在契约层的接口不一致。
- **建议**：把 `authorizationSchema.operations` 改为 `boundedArray(operationNameSchema)`（与 `scopeSchema.operations` 一致），并在 `contracts/test/entities.test.ts` 补「未知操作名 ⇒ 解析失败」的用例；若为兼容历史数据必须先放宽，则在 DC 中登记并说明运行期兜底。
- **是否阻断**：不阻断（fail-closed 方向；不改变已接受 Run 的授权判定）。

### R15-03 [P3] 两类关键负例用例仍缺失：`none` Work × `git` **授权**、真正只读授权 × 写范围

- **位置**：`packages/core/test/orchestrator.test.ts:649-661`（新 R14-01 用例的 `git` 分支只派发 `{operations:['git']}` 且**不附任何 `authorizationRef`**）、`:224-231`（`AUTHORIZATION_ID` 仍是 `operations:['deploy']` + `emptyScope`）、`:603-647`（R13-01 用例）；`packages/domain/test/domain.test.ts:238`（`git` 断言在 `declaresWorkspaceWrite` 上）。
- **事实（`exp5` D1-D3，实读）**：仓库内**没有** `operations:['read']` 的授权夹具，也没有 `none` Work 带 `git` 授权（或 Work 行 `authorizationRef` 指向 `git` 授权）的用例；`:651-652` 的注释写「with or without a grant of its own」，但代码只覆盖了「without」。我在 `exp1` B1、`exp6` A1 用两种授权来源各自复现了「with」形态（均拒绝），说明行为正确、只是回归网没有这一格。同样，R15-01 的核心形状（授权有写路径但无写操作）在仓库 248 条单测里没有反例或正例覆盖。
- **影响**：第十四轮 R14-01 的原始缺口形态（`none` Work **拿到** `git` 授权）与 R13-01 要求的「只读授权」形态都只靠实现正确而非测试锁定；一旦有人把 `work.level` 门禁改成先查授权后判等级，这类缺口不会被任何既有用例发现。属 R12-04/R13-05/R14-04 同一类（断言语义与注释/评审要求不一致）。
- **建议**：补三条用例：(1) `none` Work + `operations:['git']` + 该 Work 的 `git` 授权 ⇒ `NOT_AUTHORIZED`（details `workLevel:'none'`）；(2) `none` Work 的 Work 行自带 `git` 授权时的同形用例；(3) 真正 `operations:['read']`、`readPaths:['docs']` 的授权 + 声明 `writePaths:['docs']` ⇒ `uncoveredOperations:[]` 且 `uncoveredWritePaths:['docs']`（同时可作为 R15-01 的失败用例起点）。
- **是否阻断**：不阻断。

### R15-04 [P3] DC-67 仍写 `WORKSPACE_WRITE_OPERATIONS = ['edit','write','artifact_write']`（不含 `git`），与代码及 DC-66 互相矛盾；`implementation.md`/提交信息的单测计数 247 与实测 248 不符

- **位置**：`.agentdev/work/WP-02/discovery.md:251`（DC-67 第 2 条）；对照 `:243`（DC-66 第 1 条已含 `'git'`）、`packages/domain/src/routing.ts:179-187`；`.agentdev/work/WP-02/implementation.md:230`（T22「`pnpm test:unit` **247 passed**」）与 `eb8c3b8` 提交信息「unit 247, integration 124」。
- **事实（`exp5` A2/A4 实读、§2 实跑）**：DC-67 的集合文本仍是三元素版本，而 DC-66 与代码都是四元素（含 `git`）；同一文档内两处对同一常量给出相反取值（R14-02 修的是 DC-66，同族 DC-67 未同步）。计数方面：本轮 `pnpm test:unit` 实测 `17 files / 248 passed`；`9f62582` 时同两文件为 `42 + 30 = 72`，`eb8c3b8` 后为 `43 + 31 = 74`，即净增 2 条（`eb8c3b8` 新增 core 用例、`088bdd7` 新增 domain 用例；`eb8c3b8` 在 `domain.test.ts` 内只加断言），故 248 与「第十三轮 246 + 2」自洽，T22 与提交信息的 247 少计一条。
- **影响**：DC-67 是后续轮次与 Settlement 的事实源，读者按它会把 `git` 从写操作集合中读掉（正是 R14-01 的成因）；单测计数不符会让「声称数 = 实测数」这一本包长期沿用的核对手段失效（第十至十四轮报告均以此校验 T 记录）。
- **建议**：把 DC-67 第 2 条的集合文本改为含 `'git'`（或直接指向 DC-66/`routing.ts`，避免第三处副本再次漂移）；把 T22 与提交信息的 247 更正为 248，并在记录里写明「本轮由两笔提交共新增 2 条 `it`」。
- **是否阻断**：不阻断。

---

## 5. 其它观察（不计入 Finding 编号）

1. **`git` 的「工作区写」语义只由操作名表达，未限制子命令**：`WORKSPACE_WRITE_OPERATIONS` 现含 `git`（`routing.ts:179-187`），注释理由引 `execution.md`（commit/checkout/reset 会重写跟踪文件）。`none` 级 Work 因此完全不能派 `git`（哪怕只做 `git log`）。这是 fail-closed 方向的保守取舍，与 R14-01 的建议 (b)（若产品要允许只读 git，应拆 `git_read`/`git_write`）一致；本包未拆，登记在此供产品方确认是否可接受「`none` Work 不能派任何 git」。
2. **spec 只声明 `networkTargets` 而不声明 `network` 操作时被接受**（`exp2` D2d，我的预设断言失败处）：`touchesRunningEnvironment` 仅凭 `networkTargets` 非空即把 Run 抬到 L3，`verifyAuthorization` 又只要求**授权**带 `network`，因此 Run 侧 `effectiveScope.operations:[]`、`networkTargets:['10.0.0.5']` 可被接受。语义上「声明要到达某目标」已足以要求 L3，且授权侧要求严格，故不判缺陷；但它与 R15-01 是同一「声明维度与操作维度不交叉校验」的形状，建议 R15-01 的修复一并考虑「声明 `networkTargets` ⇒ Run 自身也应声明 `network` 操作」。
3. **`Authorization.scope.operations` 仍被静默忽略**：`exp7` E1/E2 —— 顶层 `operations:['read']` + `scope.operations:['deploy']` 的授权既能拒绝声明 `deploy` 的 Run，也能为写路径 Run 背书。沿第十二轮 §5.3/第十三轮 §5.3 的契约歧义（两字段并存未定义优先级），建议在 R15-01 修复时一并定性。
4. **L2/L3 Work 无授权也可冻结写范围**：`exp7` C1 —— `L2` Work 不传任何 `authorizationRef`，声明 `writePaths` 即被接受（`verifyAuthorization` 对非 L3 等级不要求引用）。这是 `workflow.md` §2 的既有设计（L1/L2 由 Work 授权），但意味着 `effectiveScope` 的写范围在 L1/L2 上**没有**任何授权实体可核对；与 R15-01 叠加后，「写范围必须被授权」这一命题在 L1/L2 上没有任何支点。建议作为产品问题登记（是否要求 L2 写范围也绑定授权）。
5. **`assess` 接受带写范围/`git` 的 `none` 级评估且不落库**：`exp2` D4a —— `intent:'assist'`、`level:'none'`、`scope.writePaths:['packages/core/src'], operations:['git']` 被接受，事件 `assessment.saved` 的 `data` 不含 `goal`/`scope`（DC-60/DC-70 已登记），因此该写范围既不落行也不落事件、也不回写 `Work.level`。与 D-4 的登记一致（`assess` 不是 Run 边界），属已登记缺口。
6. **`none` Work 仍可建立 L3 Run**：`exp6` B2 —— `none` Work + `operations:['deploy']` + 覆盖授权 ⇒ **接受**（`runLevel='L3'`）。写权限门禁只管「工作区写」，环境操作不受它约束，授权覆盖把关。登记为观察：`data.md:22` 的「none不产生修改授权」只覆盖写，不覆盖环境副作用。
7. **网络目标仍是精确字符串相等**：`exp2` D2b 走 `uncoveredNetworkTargets`，`domain/permission.ts` 的 `targetCovers` 前缀覆盖语义仍未用于 `verifyAuthorization`（沿第十三轮 §5.2）。本轮新增的路径维度用 `isInsideScope` 前缀包含，两套「包含」语义并存于同一函数。
8. **`isInsideScope` 的 `.` 段语义**：`repoPathSchema` 只禁 `..`/绝对路径/空段/尾随 `/`，不禁 `.` 段。`exp3` B 实跑：声明 `packages/./storage/src` 与授权 `packages/storage` 互相都不匹配（fail-closed），反之亦然。行为安全，但同一路径的不同书写法会被判为不同范围，建议后续统一归一化（沿第十三轮 §5.6）。
9. **`exp3` C 的预算/授权次序**：无授权且超预算时返回 `BUDGET_EXCEEDED`（`orchestrator.ts:426-429` 的 `canAllocateBudget` 先于 `verifyAuthorization` 的 L3 需求判定？实为授权核对在 `:385`、预算在 `:426`，但当 `work.authorizationRef` 存在时授权先过、预算后拒）。`exp6` C 证明任一拒绝路径都不留 Run/快照行，`exp3` E3 证明被拒 dispatch 不改变 `tokensReserved`，预算与授权门的**先后**不产生副作用差异；并发窗口（准入检查 `:426-429` 与事务内 `:488` 之间）沿前几轮仍未验证。
10. **`AC-082` 用例仍用「无授权 + 写范围」的 chief spec**（`orchestrator.test.ts:993-1000`）：该用例在第 355 行起的夹具下能通过，因此**不能**发现 R15-01 那类缺口；它验证的是「快照窄范围不被 Work 放宽覆盖」，与授权无关，两者不冲突。
11. **`exp3` E4/F3 两条失败为我方夹具问题**（跨 Work 父 Run 被 `isDirectChiefChild` 先拒；`F3` 即 R15-02 证据），不作为缺陷计入。
12. **产物归属（沿第十一至十四轮）**：本次两笔修复提交（`eb8c3b8`、`088bdd7`）不含 `review.md`，Review 产物与开发提交分离，较前几轮改善；但 `eb8c3b8` 仍同时改写了 `discovery.md` 与 `implementation.md`（属开发范围内的记录）。建议 Settlement 时确认第十四轮报告正文（未单独入库）的归档位置。

---

## 6. 剩余风险（未闭环，供 Test/Settlement 与产品方判断）

1. **R15-01（新增，阻断）**：`writePaths` 不需要授权里的写操作即可背书并冻结（`read`/`search`/`deploy`/`bash`/`secret`/`push`/`network`/`delete_data` 八种授权操作 × 空操作写范围 Run 全部接受）。建议在 R15-01 的建议 (a) 与 (b) 之间由产品方选择语义后修复。
2. **R15-02/R15-03/R15-04（新增，非阻断）**：授权 `operations` 未用枚举；负例用例仍缺三类；DC-67 与单测计数 247/248 不符。
3. **授权语义的悬置项**：`Authorization.operations` 与 `Authorization.scope.operations` 的优先级（§5.3）；L1/L2 写范围是否必须绑定授权（§5.4）；`git` 子命令粒度（§5.1）。
4. **DC-66 明确推迟的项**（需产品决定/风险接受，不能只靠记录）：授权 `acceptedAt`/来源消息核对、`once` 类授权的消费记账、`work.level` 的回写（`works.update` 全仓无生产调用点）。
5. **DC-70 承接项**：`config.policy.l3Paths`/`l3Keywords` 公开可配但无判定语义（`exp7` D1/D2 复现）；WP-04 落地前用户配置不会生效。
6. **记录一致性问题反复出现**（R7-05/R8-05/R8-06/R10-05/R10-06/R12-05/R13-04/R14-02 → R15-04）：DC-66 与 DC-67 至今对同一常量给出两个不同取值；建议结算时做一次「DC ↔ 代码 ↔ 测试 ↔ 计数」四方对账，并把 DC 中的「后续工作」列表改为可勾选清单。
7. **并发未验证**：预算准入检查（`orchestrator.ts:426-429`）与事务内 `reserve`（`:488`）之间仍有窗口；单 mailbox 串行假设下不可达，多连接/多进程的双花与「快照已落、Run 未建」未被测试覆盖（沿前几轮）。
8. `timed_out`/`interrupted`/`recovery_required` 终态无产生路径（WP-05）；`onChildSettled` 仍无生产调用方（WP-05）；`Work blocked(provider)`/`blocked(budget)` 投影属 WP-05（DC-42/DC-55）。
9. `ModelGateway` 的真实 HTTP、Secret 解析与 `testConnection` 真连属 WP-07/WP-10（DC-31）；R15-01 中「冻结的 `operations:[]` 在工具层如何判权」正落在 WP-07。
10. **待产品方决定项**：DC-64（风险旗标词表是否升为契约枚举）、DC-60（`Assessment.goal`/`scope` 是否落库或落事件）、DC-27/RE-06（`data.md:30` 的三个 `:ID` 快照引用与实现的哈希并存）、DC-46（`dispatch` 不校验 `work.status`）、第十二轮 §5.4（lockdown 门禁是否严格限于 delivery/document）、Authorization 双操作列表的优先级、R14-05（`l3Paths`/`l3Keywords` 的目标语义）、§5.1（`none` Work 是否允许只读 git）。
11. `assessment.saved` 的 `data` 不含 `riskFlags`/`uncertainties`/`authorizationRef`；`assessment.submit` 按 `protocol.md:106` 应返回「适用 Gate」，当前 Core 返回 Assessment 行（协议层 WP-04 未接线，沿前轮）。
12. **测试缺口**：248 条单测仍没有「授权 `operations:['read']` × 声明 `writePaths` ⇒ 拒绝」（R15-01）、「`none` Work × `git` 授权 ⇒ 拒绝」（R15-03）、「授权带未知操作名 ⇒ 契约拒绝」（R15-02）三类用例。

---

## 7. 方法与边界声明

- 本报告只依据仓库文件、`088bdd7`/`eb8c3b8` 上的 git 对象/差异与实跑命令；未读取任何开发对话、未引用外部同名技能或历史方案。
- 阅读深度：`packages/core/src/orchestrator.ts` 全文件逐行（重点 `:240-391`、`:450-524`、`:740-940`）；`packages/domain/src/routing.ts`、`packages/contracts/src/primitives.ts`、`packages/contracts/src/entities/{work,structures}.ts`、`packages/core/test/orchestrator.test.ts`（`:1-130`、`:215-270`、`:315-375`、`:575-725`、`:985-1020`、`:1550-1590`）与 `packages/domain/test/domain.test.ts`（`:232-260`）逐行；`docs/architecture/data.md` 通读；`docs/rules/workflow.md` §1/§2（第 1-17、58-67 行）与 `docs/delivery/acceptance.md`（AC-043..047、AC-082）通读；`.agentdev/work/WP-02/{plan,implementation,discovery}.md` 全部记录通读（重点 DC-62..DC-70、T21、T22）；`packages/core/src` 其余文件与 `packages/domain/src` 其余文件按注释声称与关键分支抽查。
- 唯一写入文件为本文件 `.agentdev/work/WP-02/review.md`；实验脚本与日志独立写在 `/tmp/wp02r15/`（`fixture.mjs`、`lib.mjs`、`exp1..exp7.mjs`）与 `/tmp/r15/`（`cmds1.log`、`cmds2.log`），使用 `pnpm build` 产出的 `packages/*/dist`，通过 `/tmp/wp02r15/node_modules/@agentdev/*` 软链解析 workspace 包，等价复现包内夹具但**不 import 任何产品测试文件**。
- 未修改产品代码、测试、`docs/**`、`plan.md`、`implementation.md`、`discovery.md`；`pnpm build` 只写 `.gitignore` 中的 `dist/`。写入本报告前 `git status --porcelain` 无输出、`HEAD=088bdd7150ad9e322020e3000da18771de86c724`。
