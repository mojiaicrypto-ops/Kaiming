# WP-02 独立 Review 报告（第十四轮）

- 评审对象：工作包 WP-02「主管与独立Agent调度」
- 评审轮次：**第十四轮**（逐条复核第十三轮 R13-01..R13-06 与第十三轮对抗性两项是否真修，核对注释/记录声称与代码是否一致，并找新问题）
- 冻结点：git `9f62582`（`fix(core): WP-02 review round 13 findings (R13-01..R13-06)`），前置 `e3b210c`
- HEAD 校验：`git rev-parse HEAD` = `9f62582f9e5ea1fc2ee282a245ffe75e10ac39db`；`git log -1` = `9f62582 fix(core): WP-02 review round 13 findings (R13-01..R13-06)`
- 工作树：复核开始、全部实验运行后、本报告写入前 `git status --porcelain` 均无输出（`pnpm build` 只写被 `.gitignore` 忽略的 `dist/`）
- 评审角色：Review（独立上下文，未读取任何开发对话；只依据仓库文件、git 对象与我自己的实验）
- 权威依据：`AGENTS.md`、`docs/rules/{workflow,agents}.md`、`docs/architecture/{ARCHITECTURE,data,protocol,reliability,context}.md`、`docs/delivery/{implementation,acceptance}.md`（WP-02 与 AC-043/044/045/046/047/082）、`.agentdev/work/WP-02/{plan,implementation,discovery}.md` 全部记录、`packages/core/src` 全部 17 个文件、`packages/domain/src` 全部、`packages/contracts/src/entities/{structures,work,common}.ts` 与 `primitives.ts`、`packages/core/test` 与 `packages/domain/test`
- 方法：逐行核对「注释/记录/提交信息声称」与代码；在 `/tmp/wp02r14/` 自建夹具与 6 组实验脚本（`fixture.mjs`、`lib.mjs`、`exp1..exp6.mjs`），用 `pnpm build` 产出的 `packages/*/dist` 独立复现（软链 `/tmp/wp02r14/node_modules/@agentdev/*`）；**不修改产品代码、测试、`docs/**`、`plan/implementation/discovery`**
- 工具：`node v24.8.0`、`pnpm 12.3.4`

---

## 0. 历史轮次结论摘要（保留，第一至十三轮）

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
- **第十三轮（13 条）**：R13-01（P2，阻断）授权 `scope.writePaths`/`readPaths` 不参与判定、只读授权可为写范围背书；R13-02（P2，阻断）`none` Work 写权限门禁作用在派生 `runLevel` 上、声明一个被授权的环境操作即可绕过；R13-03（P2）显式 `undefined` 可选字段抛非协议错误码 `CONSTRAINT_VIOLATION` 并留孤儿快照；R13-04（P3）DC-63 未同步且与代码相反；R13-05（P3）测试 `DC-65` 错号、「read-only grant」注释不实、只读授权用例缺失；R13-06（P3）`config.policy.l3Paths`/`l3Keywords` 无读取方。

**追溯口径（沿用第五轮 DC-53/DC-56 口径）**：行为/需求缺失＝P1（阻断）；局部质量/维护＝P2；建议＝P3。P2/P3 是否阻断由本轮按 `workflow.md` §6（第 65 行）「影响验收则阻断」判定。**L3/授权门禁类缺陷沿用 R9-01/R10-01/R11-01/R11-03/R12-01/R12-02/R13-01/R13-02 的 P2 标定**（按 §6 字面「错误行为/需求缺失」亦可判 P1；两者都阻断，本轮保持既有标定以免口径漂移）。

**历史报告取回方式**：第十三轮（最终版即本提交内版本）`git show 9f62582:.agentdev/work/WP-02/review.md`；第十二轮 `git show fec9a9d:.agentdev/work/WP-02/review.md`；第十一轮 `git show 080aa4c:…`；第十轮 `git show e125bb7:…`；第九/八轮 `git show 328ee60:…`／`f02aca4:…`；第七轮 `git show 0211ced:…`；第六轮 `git show 5a87a86:…`；第五轮 `git show 411d04f:…`；第四轮 `git show a8daa6d:…`；第三轮 `git show c4763d5:…`；第一轮 `git show c4763d5:…`（原文含于第二轮报告 §0）、第二轮 `785bdd6` 工作树（见第二轮报告 §0 引用）。第十三轮报告同时存在于 `e3b210c`（写入时）与 `9f62582`（修复提交重写，`112 insertions/98 deletions`）。

---

## 1. 本轮结论

**FAIL（Review Failed）——第十三轮的两条阻断项里，R13-01、R13-03 与其记录项（DC-63/DC-68/DC-70）实测真修好，R13-02 修好了主干（派生 `runLevel` 不再覆盖 Work 等级、本地写操作计入修改授权），但同一门禁的**操作名清单仍漏 `git`**：`none` 级 Work 只要拿到一张 `operations:['git']` 的授权，就能建立带 Tracked 文件修改权限的 Run（R14-01，阻断）；R13-04/R13-05 只修好了被点名的那一处，同族的 DC-66 仍与代码相反（R14-02）、`verifyAuthorization` JSDoc 仍未包含新增的路径维度（R14-03）；R13-05 建议的「只读授权 × 写范围」用例仍不存在（R14-04，行为本身经独立实验判定正确）；R13-06 已按登记缺口处理并核对无消费方（R14-05 澄清原判定）。本轮共 **0×P1、1×P2、4×P3（R14-01..R14-05）**，其中 R14-01 按 `workflow.md` §6「影响验收则阻断」判为阻断，**阻断进入独立 Test**。**

**逐条裁定（详见 §3）**

| 第十三轮条目 | 本轮裁定 |
|---|---|
| **R13-01** 授权 `scope.writePaths`/`readPaths` 不参与判定 | **完全修好 ✓**：`verifyAuthorization` 增加 `uncoveredWritePaths`/`uncoveredReadPaths`（`orchestrator.ts:803-828`，前缀包含 `isInsideScope` `:924-931`），`assess` 也传入自身 `scope`（`:291`）。实跑 23 passed / 1 failed（`exp1`，该 fail 为夹具缺口见 §5.1）：只读授权 + `writePaths:['packages/core/src']` ⇒ `NOT_AUTHORIZED` 且 details 列出 `uncoveredWritePaths`、零副作用；路径前缀矩阵（精确/子路径接受，`src-extra`/父目录/`packages` 拒绝）；`readPaths` 反向同样生效；四类未覆盖项同时返回；`assessment` 覆盖核对生效。`exp6` 另证「只读授权 + 落在其 read 区内的 writePaths」被路径维度拒绝（`uncoveredOperations:[]`）。 |
| **R13-02** `none` Work 写权限门禁作用在派生 `runLevel` 上 | **主体修好 ✓，操作名清单漏 `git`（见 R14-01）**：门禁改为 `grantsModificationAuthority(work.level) && declaresWorkspaceWrite(spec.scope)`（`orchestrator.ts:369`），`declaresWorkspaceWrite` 计入 `writePaths` 或 `WORKSPACE_WRITE_OPERATIONS = ['edit','write','artifact_write']`（`domain/routing.ts:179-196`）。实跑（`exp2`）：`none` Work + `deploy`（有覆盖授权）+ `writePaths` ⇒ `NOT_AUTHORIZED`（details 报 `workLevel:'none'`、`runLevel:'L3'`），零副作用；`edit`/`write`/`artifact_write` 空路径全部拒绝；任何操作名都无法为 `none` Work 打开 `writePaths`（`exp5` D：9 种操作 × writePaths 全拒）。**缺口**：`none` Work + `operations:['git']` + 该 Work 的 `git` 授权 ⇒ **接受**并冻结 `{"operations":["git"],"writePaths":[]}`（`exp2` D）。 |
| **R13-03** 显式 `undefined` ⇒ `CONSTRAINT_VIOLATION` + 孤儿快照 | **完全修好 ✓**：`dispatch` 入口 `jsonClean(parseOrFail(dispatchSpecSchema, …))`（`:340`，`jsonClean` `:907-921`），`professionalSpec` 同款。实跑（`exp3`）：`{...backendSpec(), taskId: undefined}` ⇒ 接受、Run 无 `taskId`、快照增量恰为 1 条 `dispatch`（无失败残留）；嵌套 `contextSelection.sourceRefs[0].path: undefined` 同样正常；`contextPayload` 显式 `undefined` 在 `dispatchExtrasSchema` 层被 `VALIDATION_ERROR` 拒绝（**不是** `CONSTRAINT_VIOLATION`）且 0 快照；`requiredOutputSchemas` 显式 `undefined` 同样 `VALIDATION_ERROR`/0 快照。 |
| **R13-04** DC-63 未同步、与代码相反 | **被点名处修好 ✓，同族 DC-66 仍相反（见 R14-02）**：DC-63 已重写为「存在性、同 Work、未撤销、范围覆盖」四层，含四类未覆盖项与后续承接（`discovery.md:219-227`），不再出现「当前只核对存在性、同 Work、未撤销」。但 DC-66 仍在写「`runLevel` 无修改授权（`none`）时拒绝带 `writePaths` 的 spec」与「`writePaths` 是否必须在授权 `scope.writePaths` 内…仍属 WP-04/WP-05」（`:243`、`:246`），两处均与代码相反。 |
| **R13-05** `DC-65` 错号、「read-only grant」注释不实、只读用例缺失 | **部分修好**：`:655` 已改为 `DC-66`，`:565` 注释已改为「A grant that does not cover the operation cannot back it」（不再自称只读）；新增 `R13-01/R13-02/R13-03` 三条用例。**但**：`R13-05` 建议的「真正 `operations:['read']` 的授权」并未新增——R13-01 用例使用的 `AUTHORIZATION_ID` 仍是 `operations:['deploy']` + 空 `scope`（`orchestrator.test.ts:224-231`），且该授权不含 `read/search`，其新断言由**操作维度**先拒绝（见 R14-04）。行为本身已由 `exp6` A 判定正确。 |
| **R13-06** `config.policy.l3Paths`/`l3Keywords` 无读取方 | **完全修好 ✓（记录项）**：DC-70 已登记为 WP-04/WP-05 承接缺口并说明当前 L3 判定只依据 `workflow.md` §2.2/§2.3（`discovery.md:263-265`）；独立复跑 `grep`（排除 `dist`）确认唯一命中仍是 `config.ts` 的存/取投影与契约 Schema，路由/判定零消费方；`exp6` E 实跑：`config.update('global', {l3Paths, l3Keywords})` 被接受，命中 `l3Paths` 的评估仍按 L2 通过（无 L3 抬升）。该 Finding 的「实现 vs 登记缺口」选择属产品决定，本轮不再作为缺陷计。 |
| **对抗性① ×** `none` Work 写权限门禁（本轮独立复跑） | **主体修好，残余见 R14-01**：`exp2`/`exp5` 共 30 例中，「环境操作抬升 `runLevel` 以获得写权」的原始路径全拒；`git` 一条仍通过。 |
| **对抗性②** 风险词表斜杠归一 | **完全修好 ✓（本轮独立复跑）**：`normalizeRiskTerm` 剥离 `/`（`routing.ts:140`）。`exp4` H 实跑：「数据删除/迁移」评估仍强制 L3（`VALIDATION_ERROR`）；未登记拼写 `securityBoundry` 仍 fail-closed 拒绝；`assist` + `deploy` 仍不回退。 |

**新发现**：R14-01（P2，阻断，`none` Work 可用被授权的 `git` 操作取得修改权限，`domain/routing.ts:179-183` + `core/orchestrator.ts:369`）、R14-02（P3，DC-66 两处仍与代码相反，`discovery.md:243,246`）、R14-03（P3，`verifyAuthorization` JSDoc 未包含路径维度，`orchestrator.ts:743-753`）、R14-04（P3，R13-01 新用例实际未覆盖「只读授权 × 写范围」路径维度，`packages/core/test/orchestrator.test.ts:224-231,590-600`）、R14-05（P3，R13-06 的「gap vs 缺陷」定性澄清，`discovery.md:263-265`）。

### 前十三轮阻断项的当前状态（本轮实跑复核）

- 第九轮 R9-01 / 第十轮 R10-01 / 第十一轮 R11-01：`exp4` H 全部仍拒绝（合并斜杠风险 ⇒ L3；未登记旗标 ⇒ `VALIDATION_ERROR`；`assist` + `deploy` ⇒ 拒绝），**未回退**。
- 第十轮 R10-02 / 对抗性 B 授权实体核对：`exp4` I 伪造/撤销/跨 Work/L3-无授权全绿，Work 行自带授权被冻结到快照，**未回退**。
- 第十二轮 R12-01/R12-03：`exp4` I / `exp5` E 复核通过（spec scope 施 L3 底线、核对结果冻结），**未回退**。
- 第五至八轮的事件分页、幂等、预算、终态路径：本轮 `pnpm test:unit` 246 / `pnpm test:integration` 124 全绿覆盖（§2），另加 `exp6` F 复核「stale profileRevision ⇒ `VALIDATION_ERROR` 且零快照」。

---

## 2. 契约命令原始结果（本轮实跑）

执行方式：`export PATH="$HOME/.local/bin:$PATH"`，在仓库根目录按序执行并逐条记录退出码（日志存 `/tmp/r14_cmds.log`、`/tmp/wp02r14/exp*.log`）。

| 命令 | 退出码 | 原始结果要点 |
|---|---|---|
| `pnpm typecheck` | **0** | `tsc -p tsconfig.json --pretty false`，无输出 |
| `pnpm lint` | **0** | `node scripts/lint.mjs`：`Checking formatting...` / `All matched files use Prettier code style!` |
| `pnpm test:unit` | **0** | `Test Files 17 passed (17)` / `Tests 246 passed (246)` / `Duration 2.75s`（与 T21 声称的 246 一致；较第十三轮 +4）。另单跑 `npx vitest run --project unit packages/core/test/orchestrator.test.ts` ⇒ `42 passed`（含本轮新增 4 条） |
| `pnpm test:integration` | **0** | `Test Files 10 passed (10)` / `Tests 124 passed (124)` / `Duration 48.59s`（与 T21 声称的 124 一致；含 `apps/cli` 容器 9 例） |
| `pnpm docs:check` | **0** | `docs:check ok — 15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages` |
| `pnpm build` | **0** | `packages/{contracts,domain,storage,core,pi-runtime}`、`apps/{cli,runner}` 共 7 个 workspace `build: Done` |
| `git status --porcelain` | — | 复核开始、全部实验后、本报告写入前均**无输出**（干净） |
| `git rev-parse HEAD` | — | `9f62582f9e5ea1fc2ee282a245ffe75e10ac39db`（= 冻结点） |

**自建实验（观察值记录；标记 `FAIL` 的断言即 Finding 证据）：**
`exp1`（R13-01 路径/操作覆盖 + `assess`）23 passed / 1 failed（该 fail 为夹具缺口，非缺陷，见 §5.1）；`exp2`（R13-02 门禁 + 操作名清单）19 / 1（`git`）；`exp3`（R13-03 `undefined`）13 / 0（3 条计数类断言为夹具去重所致，已由「Run 增量」与「快照/行增量」复核）；`exp4`（记录/注释/回归）37 / 3（R14-02/R14-03/R14-04）；`exp5`（对抗性边界矩阵）11 / 0（41 条 INFO）；`exp6`（综合：只读授权×路径、Work 行 scope、l3Paths）13 / 0。脚本与日志存 `/tmp/wp02r14/{fixture,lib,exp1..exp6}.mjs`、`/tmp/wp02r14/exp1..exp6.log`。所有实验用 `pnpm build` 后的 `packages/*/dist`，通过 `/tmp/wp02r14/node_modules/@agentdev/*` 软链解析 workspace 包，**不 import 任何产品测试文件**。

---

## 3. 逐条复核表（第十三轮条目 + 对抗性两项）

| 条目 | 前轮定级 | 本轮实测证据（脚本/观察值） | 判定 |
|---|---|---|---|
| **R13-01** 授权 `scope.writePaths`/`readPaths` 不参与判定 | P2（阻断） | `exp1` B：只读授权（`operations:['read']`、`writePaths:[]`）+ spec `writePaths:['packages/core/src']` ⇒ `NOT_AUTHORIZED`，details `uncoveredWritePaths:['packages/core/src']`、`uncoveredOperations:[]`、Run/快照增量 0；C：`readPaths` 反向（`docs` 覆盖 `docs/rules`，拒绝 `secrets`，details `uncoveredReadPaths`）；D：路径前缀矩阵（精确/子路径接受，`srcXYZ`/父目录/`packages` 拒绝）；J：一次返回四类未覆盖项；F：`assess` 的 `scope` 也被核对（拒绝 + 零 `assessment` 行/零快照）；`exp6` A：只读授权 + 落在其 read 区的 `writePaths` 被路径维度拒绝（操作维度为空） | **完全修好 ✓** |
| **R13-02** `none` Work 写权限门禁作用在派生 `runLevel` 上 | P2（阻断） | `exp2` B：`none` Work（`WORK_NONE_AUTH`）+ `{writePaths:['packages/core/src'],operations:['deploy']}` + 覆盖授权 ⇒ `NOT_AUTHORIZED`（details `workLevel:'none'`、`runLevel:'L3'`），Run 增量 0；C：`edit`/`write`/`artifact_write` 空路径全拒；G：chief 侧同拒；`exp5` D：9 种操作名 × `writePaths` 全拒，无一条打开写门禁。**对照缺口**：`exp2` D —— `none` Work + `operations:['git']` + 该 Work 的 `git` 授权（`AUTH_NONE_GIT`）⇒ **接受**，冻结 `{"operations":["git"],"writePaths":[]}`，Run +1（用不含 `git` 的 `AUTH_NONE_DEPLOY` 反而在 `exp5` C 被操作覆盖拒绝，可作区分对照） | **主体修好 ✓ / 残余 R14-01（阻断）** |
| **R13-03** 显式 `undefined` 与孤儿快照 | P2 | `exp3` C：`{...backendSpec(), taskId: undefined}` ⇒ 接受、`run.taskId === undefined`、Run +1、无失败路径残留（同一夹具下 config/context 因内容寻址去重，故不是 +3）；B：`taskId`/`requirementId` 显式 `undefined` 均接受；D：嵌套显式 `undefined` 正常；E：`contextPayload` 显式 `undefined` ⇒ `VALIDATION_ERROR`（非 `CONSTRAINT_VIOLATION`）、快照增量 0；F：`requiredOutputSchemas` 显式 `undefined` ⇒ `VALIDATION_ERROR`、0 快照；H：冻结 payload 可 JSON 往返 | **完全修好 ✓** |
| **R13-04** DC-63 未同步 | P3 | `exp4` A：DC-63 含路径维度、四类未覆盖项、`runLevel` 表述，旧句已删除。`exp4` B：DC-66 仍写「`runLevel` 无修改授权（`none`）时拒绝带 `writePaths` 的 spec」与「`writePaths` 是否必须在授权 `scope.writePaths` 内…仍属 WP-04/WP-05 的后续工作」（`discovery.md:243`、`:246`），二者均与 `orchestrator.ts:369`、`:803-808` 相反 | **被点名处修好 ✓ / 同族未修（R14-02）** |
| **R13-05** 测试引用与注释不实 | P3 | `exp4` D：`:655` 已是 `DC-66`；`:565` 注释已改为「does not cover the operation」；新增用例存在且断言有效。**但** `AUTHORIZATION_ID` 仍是 `operations:['deploy']` + `emptyScope`（`:224-231`），R13-01 用例的第一断言由操作维度先拒绝（`read/search` 不在授权中），未走到路径维度；仓库内仍无 `operations:['read']` 的授权夹具 | **部分修好 / 残余 R14-04** |
| **R13-06** `l3Paths`/`l3Keywords` 无读取方 | P3 | `exp4` E：排除 `dist` 后唯一命中为 `config.ts`（默认值 `:93-94`、投影 `:173-174`、写入 `:300-301`）与 `structures.ts:128-129,166-167`；路由/判定零消费方。`exp4` C：DC-70 已登记（`discovery.md:263-265`）。`exp6` E：`config.update('global',{l3Paths,l3Keywords})` 接受，`l3Paths` 命中的评估仍 L2 通过 | **完全修好 ✓（记录项；R14-05 澄清定性）** |
| **对抗性①** `none` Work 写权限 | P2 | 见 R13-02 行：原始绕过路径（环境操作抬升 `runLevel`）全拒；`git` 一条仍可通过（R14-01）；`grantsModificationAuthority` 已是活代码并被 `work.level` 调用 | **主体修好 ✓ / 残余 R14-01** |
| **对抗性②** 风险词表斜杠归一 | P2 | `exp4` H：「数据删除/迁移」⇒ L3（`VALIDATION_ERROR`）；`securityBoundry` ⇒ `VALIDATION_ERROR`（fail-closed）；`assist` + `deploy` ⇒ 拒绝。`routing.ts:136-141` 归一化剥离 `/` | **完全修好 ✓** |

---

## 4. 新 Findings（R14-01..R14-05）

### R14-01 [P2，阻断] `git` 不在工作区写操作集合：`none` 级 Work 用一条被授权的 `git` 操作即可取得修改权限

- **位置**：`packages/domain/src/routing.ts:179-183`（`WORKSPACE_WRITE_OPERATIONS = ['edit','write','artifact_write']`，注释 `:172-178` 自称「a Work that grants no modification authority (`none`) must not hand them out」）、`:151-160`（`ENVIRONMENT_OPERATIONS` 的注释把 `git` 归为「acts on the local workspace」，只把远端写留给 `push`）；`packages/core/src/orchestrator.ts:369`（门禁只问 `declaresWorkspaceWrite(spec.scope)`）；契约 `packages/contracts/src/primitives.ts:122-136`（`git` 是合法 `OperationName`）；文档 `docs/architecture/data.md:22`（work 行「**none不产生修改授权**」）、`docs/architecture/data.md:55`（`Scope.operations` 取值含 `git`）。
- **事实（`exp2` D、`exp5` C/D，实跑）**：
  - `WORK_NONE`（`level:'none'`）+ spec `scope:{operations:['git'],writePaths:[],readPaths:[],networkTargets:[]}` + 该 Work 的一张 `operations:['git']` 授权（夹具 `AUTH_NONE_GIT`）⇒ **接受**，Run +1，`dispatchSnapshot.effectiveScope = {"operations":["git"],"writePaths":[]}`（`exp2` D 的 `git` 行）；
  - 对照：同 Work 用一张**不含** `git` 的授权（夹具 `AUTH_NONE_DEPLOY`）派 `operations:['git']` ⇒ `NOT_AUTHORIZED`（`exp5` C 的 `git` 行，属操作覆盖拒绝，不是写门禁）；
  - 对照：`none` Work + `edit`/`write`/`artifact_write`（空 `writePaths`）⇒ `NOT_AUTHORIZED`；`git` **加上**任意 `writePaths` ⇒ `NOT_AUTHORIZED`（`exp2` C、`exp5` D 九种操作名全拒）；
  - 对照：`deploy`/`bash`/`network`/`secret`/`delete_data`/`push` 在 `none` Work 上可建 Run（有覆盖授权时），但它们被 `touchesRunningEnvironment` 抬到 L3 并可落在环境操作授权上（本轮不改变 R12-01 的标定）；`git` 是**唯一**既不被环境集合抬级、又不被写集合拦截、且能改动工作区已跟踪文件的操作名。
- **影响**：`data.md:22` 的行级不变式「none 不产生修改授权」在 Run 建立边界仍有一条通路。可达性需要一张绑定该 `none` Work 的 `git` 授权（用户来源，不是凭空造权），但 `git` 的默认语义包含工作树修改（`commit`/`checkout`/`reset`/`stash`/`clean`），而 Run 的 `effectiveScope` 又不带任何 `writePaths` 约束，于是这条 Run 的写边界是「没有任何路径约束」——比 R13-01 修好后的显式 `writePaths` 路径更宽。这与 DC-67 自称「`data.md` §2 由此在 Run 建立边界真正生效」的说法相矛盾，且 `git` 未登记在任何 DC 的豁免说明中（DC-62 只说明它不属于**环境**操作）。
- **建议**：(a) 把 `git` 计入 `WORKSPACE_WRITE_OPERATIONS`（最小修复，与 `edit`/`write` 同类）；(b) 若产品确实要求「只读 git 可用于 `none` Work」，则必须把操作名拆成 `git_read`/`git_write`（或规定该 Run 的 `git` 仅限只读子命令并在工具层强制），并在 `data.md`/DC 中登记该语义；(c) 让 `declaresWorkspaceWrite` 与 `touchesRunningEnvironment` 共享一张「按 `operationNameSchema` 全枚举分类」的对照表，新增操作名时编译期提醒（现在 `ENVIRONMENT_OPERATIONS` 有此约束，`WORKSPACE_WRITE_OPERATIONS` 也有 `satisfies`，但两者并不覆盖全部 12 个取值，`read`/`search` 之外无「不写」断言）；(d) 补「`none` Work × `operations:['git']` ⇒ 拒绝」的失败测试。
- **是否阻断**：**阻断**（授权/等级门禁类缺陷沿用 R12-01/R13-02 的 P2 标定；`data.md:22` 不变式在 `git` 一条上仍失效）。

### R14-02 [P3] DC-66 的两条陈述在本轮修复后仍与代码相反

- **位置**：`.agentdev/work/WP-02/discovery.md:243`（「`runLevel` 无修改授权（`none`）时拒绝带 `writePaths` 的 spec」）、`:246`（「仍属 WP-04/WP-05 的后续工作：`writePaths` 是否必须在授权 `scope.writePaths` 内…」）；对照 `packages/core/src/orchestrator.ts:369`、`:803-808`、`packages/domain/src/routing.ts:188-196`。
- **事实（`exp4` B，实读 + 实跑）**：`9f62582` 只改了 DC-63 并新增 DC-67..DC-70，**DC-66 一字未动**。于是本条记录同时错在两处：(1) 门禁判据已是 **Work 行等级**（`grantsModificationAuthority(work.level)` + `declaresWorkspaceWrite`），不是 `runLevel`；(2) `writePaths` 位于授权 `scope.writePaths` 内**已经实现**（DC-68，`exp1` 实跑验证），不再是「后续工作」。读者按 DC-66 会得出与本轮事实相反的两个结论，且 DC-66 与 DC-67/DC-68 互相矛盾——这正是 R13-04 判定 DC-63 的同一类别，第十三轮只修了被点名的那一条记录。
- **影响**：本包「记录与代码相反」反复出现（R7-05/R7-08/R8-05/R8-06/R10-05/R10-06/R12-05/R13-04）。记录是后续轮次与 Test/Settlement 的事实源，此处会把「已实现」读成「未实现」、把「Work 等级」读成「派生等级」。
- **建议**：把 `:243` 改为「`work.level` 无修改授权（`none`）时拒绝 `declaresWorkspaceWrite(spec.scope)` 为真的 spec（DC-67）」，从 `:246` 的后续工作列表中删除 `writePaths` 一项（保留 `acceptedAt`/来源消息核对与 `work.level` 更新），并加一句指向 DC-68。
- **是否阻断**：不阻断。

### R14-03 [P3] `verifyAuthorization` 的 JSDoc 未包含新增的路径维度

- **位置**：`packages/core/src/orchestrator.ts:743-753`（JSDoc 仍写「when a `scope` is supplied it must cover that scope's operations and network targets (R12-02)」）；对照 `:793-829`（本轮新增 `uncoveredWritePaths`/`uncoveredReadPaths`）。
- **事实（`exp4` F，实读）**：JSDoc 的覆盖句只列 `operations` 与 `networkTargets`；`:803-808` 实际还核对 `writePaths`/`readPaths`。此外 `:757` 的参数注释「`undefined` when no level is known yet (an assessment checks what it has)」仍描述一个仓库内不可达的调用形态（`assess` 传 `payload.level`，`dispatch` 传 `runLevel`）——该残余第十三轮已记为 §5 观察，本轮仍在。
- **影响**：与 R12-04 同类（JSDoc 与调用点/实现不符）。本轮修复恰好在同一函数内新增了路径维度，JSDoc 是唯一未同步的位置，随后续调用方（WP-04 协议层）按注释理解覆盖语义时会漏掉路径。
- **建议**：JSDoc 增加「and every declared `writePaths`/`readPaths` entry must be inside the authorization's own scope (R13-01)」，并把参数注释改为「the level the caller is checking for (`runLevel` in `dispatch`, the submitted level in `assess`)」。
- **是否阻断**：不阻断。

### R14-04 [P3] R13-01 的新用例未覆盖「只读授权 × 写范围」：其授权仍是 `deploy` 授权，且第一断言由操作维度先拒绝

- **位置**：`packages/core/test/orchestrator.test.ts:224-231`（`AUTHORIZATION_ID`：`scope: emptyScope`、`operations: ['deploy']`）、`:590-600`（`it('treats the authorization envelope as the scope boundary (R13-01)')` 的第一断言：`backendSpec(chief.id)`（默认 `writePaths:['packages/storage/src']`）+ `AUTHORIZATION_ID` ⇒ 期望 `does not cover the declared scope`）；对照 `packages/core/src/orchestrator.ts:794-815`（先比 `operations`，再比路径）。
- **事实（`exp4` D + `exp6` A，实读 + 实跑）**：被注释为「The grant has no write paths, so a Run that writes is not covered」的断言，其拒绝原因实际是 `uncoveredOperations`（spec 的 `write` 不在 `['deploy']` 中），因为 `backendSpec` 默认声明 `operations:['write']` 与 `writePaths:['packages/storage/src']`，而检查顺序是操作在前。把同一形状放进仓库夹具（我构造的 `AUTH_READONLY`：`operations:['read']`、`readPaths:['docs']`、`writePaths:[]`）才能走到路径维度：`exp6` A 实跑得到 `uncoveredWritePaths:['docs']`、`uncoveredOperations:[]` ⇒ 路径检查本身正确，**行为已修好**。此外，R13-05 明确建议「新增一张真正 `operations:['read']` 的授权」——仓库中仍不存在（`grep operations: \['read'\]` 仅命中第十轮前的其他夹具）。
- **影响**：测试断言（而非行为）与注释的因果不一致，容易被后续轮次读成「路径维度已被该用例覆盖」。与 R12-04/R13-05 同类。
- **建议**：新增一张 `operations:['read']`、`readPaths`/`writePaths` 非空的授权，用它断言「只读授权 × 其覆盖范围内的 `writePaths` ⇒ `NOT_AUTHORIZED` 且 `uncoveredOperations` 为空、`uncoveredWritePaths` 非空」；同时把 R13-01 现有第一断言改用该授权。
- **是否阻断**：不阻断。

### R14-05 [P3] R13-06 的定性澄清：`l3Paths`/`l3Keywords` 属「已登记的实现缺口」，不是「配置了却不生效」缺陷

- **位置**：`.agentdev/work/WP-02/discovery.md:263-265`（DC-70）、`packages/core/src/config.ts:93-94,173-174,300-301`、`packages/contracts/src/entities/structures.ts:128-129,166-167`、`docs/architecture/data.md:59`、`docs/architecture/protocol.md:96`。
- **事实（`exp4` E、`exp6` E，实跑/实读）**：排除 `dist` 后 `l3Paths`/`l3Keywords` 的唯一读取点确实只是「默认值 / 全局-项目投影 / patch 写入」，无任何判定消费方；`config.update('global', {l3Paths:['packages/core/src'], l3Keywords:['deploy']})` 被接受，命中该路径的 `assess` 仍按 L2 通过。DC-70 已把「实现」明确登记为 WP-04/WP-05 的策略落线工作，并说明本包不实现。
- **判定**：`docs/architecture/data.md:59` 与 `protocol.md:96` 只规定这两个键**可配置**，未定义 L3 判定语义，`workflow.md` §2 的 L3 判据也不含路径/关键词；因此「当前无消费方」与文档一致，属于**已登记的后续工作**。本轮确认第十三轮 R13-06 的「死配置」定位准确，但不再作为开放缺陷计数；风险在于该配置面已对用户可用却无效果，建议在 WP-04 落地前由产品方明确是否需要「配置即生效」的中间状态提示。
- **是否阻断**：不阻断。

---

## 5. 其它观察（不计入 Finding 编号）

1. **`exp1` G 的观察（非缺陷）**：授权 `scope.networkTargets:['10.0.0.5']` 且顶层 `operations:['read']` 时，spec 声明 `networkTargets:['10.0.0.5']` 仍被接受——因为覆盖核对此时只比较**声明项的存在关系**，而「网络写入是否必须有 `network` 操作」不在检查内（`touchesRunningEnvironment` 只把 Run 抬到 L3）。`data.md:26` 说 `authorization` 有「Chief解释绑定范围，Core核对来源与权限」，把「授权里出现的目标」本身读成授权证据也说得通，但这属第十二轮 §5.3 已登记的契约歧义（`Authorization.operations` vs `Authorization.scope.operations` 未定义优先级），故不新开 Finding。
2. **网络目标仍是精确字符串相等**：`exp5` H：授权 `10.0.0.5` 不覆盖 spec `10.0.0.5/v1` 或 `https://10.0.0.5`（fail-closed），与 `domain/permission.ts` 的 `targetCovers` 前缀覆盖语义不一致（沿第十三轮 §5.4）。路径维度本轮新引入 `isInsideScope` 前缀包含，两套「包含」语义现在并存于同一函数。
3. **`Authorization.operations` 与 `Authorization.scope.operations` 并存且只消费前者**：`exp1` H：顶层 `operations:[]` + `scope.operations:['delete_data','deploy']` ⇒ 拒绝；`data.md:26` 并列两字段但未定义优先级（沿第十三轮 §5.3）。
4. **`work.level` 与派生 `runLevel` 仍不落库**：Run 行无等级列，`assess` 不回写 Work 行；`exp2` B 的 details 显示 `workLevel:'none'` 与 `runLevel:'L3'` 的差异只存在于错误上下文，成功路径下 `effectiveScope` 是可重算的唯一权威（沿第十三轮 §5.5）。
5. **派生 `runLevel` 的语义边界**：`git` 不属于 `ENVIRONMENT_OPERATIONS`（`routing.ts:151-160` 的理由是「远端写入由 `push` 表达」）。该理由只说明 `git` 不需要 L3，但被 R14-01 当作「因此也不需要修改授权」的反面证据使用；建议两套集合的注释互相引用。
6. **`isInsideScope` 的根路径语义**：`exp5` A 显示授权根写成仓库根（空字符串）时无法匹配任何路径（`repoPathSchema` 不允许空串），且声明侧 `..`、尾随 `/` 由 Schema 拒绝（`VALIDATION_ERROR`），前缀比较本身无 `src`/`src-extra` 类误判。行为 fail-closed，记录在案。
7. **`exp3` 的计数型断言在内容寻址下不稳**：新用例 `expect(store.snapshots.list().length).toBe(before + 3)`（`orchestrator.test.ts:650`）成立的前提是 backend Run 的 config/context payload 与 chief Run 不同（两个角色的 profile 恰好同内容时会被 `SnapshotWriter` 去重为 1）。本轮该用例实跑通过（`npx vitest run --project unit packages/core/test/orchestrator.test.ts` ⇒ `42 passed`），但断言依赖夹具内容的偶然差异而非被验证的不变量。建议断言改为「dispatch 类快照 +1、无失败残留」，或按类型分别计数。
8. **产物归属（沿第十一/十二/十三轮）**：`9f62582` 是开发修复提交，却包含 `.agentdev/work/WP-02/review.md` 的整篇重写（`112 insertions / 98 deletions`，把第十二轮报告替换为第十三轮报告，与当时工作树逐字节一致）。Review 产物仍无法仅凭 git 归属为 Reviewer 独立撰写（`docs/rules/agents.md` §1 规定 review 的写入边界是报告本身）。建议后续轮次由 Reviewer 自行提交或在提交信息中声明。
9. **代码内保留 Review 轮次编号**（沿第十三轮 §5.8）：`orchestrator.ts:339,367-368,802,905` 等以 `R13-03`/`R13-02`/`R13-01 adversarial` 为注释锚点；行为描述本身清楚，但产品代码引用评审轮次编号会随轮次失效，建议改为描述行为。

---

## 6. 剩余风险（未闭环，供 Test/Settlement 与产品方判断）

1. **R14-01（新增，阻断）**：`none` 级 Work 可用被授权的 `git` 操作建立带修改权限的 Run（无任何 `writePaths` 约束），与 `data.md:22` 冲突。
2. **R14-02/R14-03/R14-04（新增，非阻断）**：DC-66 两处与代码相反；`verifyAuthorization` JSDoc 未含路径维度；R13-01 用例未真正覆盖「只读授权 × 写范围」。
3. **第十三轮 R13-02 的残余面**：门禁按 `work.level` + `declaresWorkspaceWrite` 判定，但操作名清单依赖人工维护（R14-01 即其后果）；未登记操作名（未来新增）会再次出现同类缺口。
4. **DC-66 明确推迟的两项**（需产品决定/风险接受，不能只靠记录）：授权 `acceptedAt`/来源消息核对、`work.level` 的更新路径（`works.update` 全仓无生产调用点）。
5. **DC-70 承接项**：`config.policy.l3Paths`/`l3Keywords` 公开可配但无判定语义；WP-04 落地前用户配置不会生效。
6. **记录一致性问题反复出现**（R7-05/R8-05/R8-06/R10-05/R10-06/R12-05/R13-04 → R14-02）：建议结算时做一次「DC ↔ 代码 ↔ 测试」三方对账，并把 DC 中的「后续工作」列表改为可勾选清单。
7. **并发未验证**：预算准入检查（`orchestrator.ts:426-429`）与事务内 `reserve`（`:488`）之间仍有窗口；单 mailbox 串行假设下不可达，多连接/多进程的双花与「快照已落、Run 未建」未被测试覆盖（沿前几轮）。
8. `timed_out`/`interrupted`/`recovery_required` 终态无产生路径（WP-05）；`onChildSettled` 仍无生产调用方（WP-05）；`Work blocked(provider)`/`blocked(budget)` 投影属 WP-05（DC-42/DC-55）。
9. `ModelGateway` 的真实 HTTP、Secret 解析与 `testConnection` 真连属 WP-07/WP-10（DC-31）；`permissionMode` 与工具层准入属 WP-07（这正是 R14-01 中「`git` 只读/写语义最终由谁强制」的落点）。
10. **待产品方决定项**：DC-64（风险旗标词表是否升为契约枚举、是否允许自定义旗标）、DC-60（`Assessment.goal`/`scope` 是否落库或落事件）、DC-27/RE-06（`data.md:30` 的三个 `:ID` 快照引用与实现的哈希并存）、DC-46（`dispatch` 不校验 `work.status`）、第十二轮 §5.4（lockdown 门禁是否严格限于 delivery/document）、Authorization 双操作列表的优先级（§5.3）、R14-05（`l3Paths`/`l3Keywords` 的目标语义）。
11. `assessment.saved` 的 `data` 不含 `riskFlags`/`uncertainties`/`authorizationRef`；`assessment.submit` 按 `protocol.md:106` 应返回「适用 Gate」，当前 Core 返回 Assessment 行（协议层 WP-04 未接线，沿前轮）。
12. **测试缺口**：246 条单测仍没有「`none` Work × `operations:['git']` ⇒ 拒绝」（R14-01）、「只读授权 × 其覆盖范围内的 `writePaths` ⇒ 路径维度拒绝」（R14-04）两类用例。

---

## 7. 方法与边界声明

- 本报告只依据仓库文件、`9f62582` 上的 git 对象/差异与实跑命令；未读取任何开发对话、未引用外部同名技能或历史方案。
- 阅读深度：`packages/core/src/orchestrator.ts`（重点 `:240-391`、`:450-520`、`:700-960`）、`packages/domain/src/routing.ts`、`packages/domain/src/dispatch.ts`、`packages/contracts/src/entities/{work,structures,common}.ts`、`packages/contracts/src/primitives.ts`、`packages/core/src/{snapshots,config}.ts` 逐行；`packages/core/test/orchestrator.test.ts`（`:30-60`、`:200-260`、`:300-370`、`:540-700`）与 `packages/domain/test/domain.test.ts`（`:225-245`）逐行；`docs/architecture/data.md` 通读；`docs/rules/{workflow,agents}.md`、`docs/delivery/acceptance.md`（WP-02、AC-043..047、AC-082）通读；`.agentdev/work/WP-02/{plan,implementation,discovery}.md` 全部记录通读（重点 DC-62..DC-70、T19..T21）；`packages/core/src` 其余文件与 `packages/domain/src` 其余文件按注释声称与关键分支抽查。
- 唯一写入文件为本文件 `.agentdev/work/WP-02/review.md`；实验脚本独立写在 `/tmp/wp02r14/`（`fixture.mjs`、`lib.mjs`、`exp1..exp6.mjs`、`exp*.log`）与 `/tmp/r14_cmds.log`，使用 `pnpm build` 产出的 `packages/*/dist`，通过 `/tmp/wp02r14/node_modules/@agentdev/*` 软链解析 workspace 包，等价复现包内夹具但**不 import 任何产品测试文件**。
- 未修改产品代码、测试、`docs/**`、`plan.md`、`implementation.md`、`discovery.md`；`pnpm build` 只写 `.gitignore` 中的 `dist/`。写入本报告前 `git status --porcelain` 无输出、`HEAD=9f62582f9e5ea1fc2ee282a245ffe75e10ac39db`。
