# WP-02 独立 Review 报告（第十六轮）

- 评审对象：工作包 WP-02「主管与独立Agent调度」
- 评审轮次：**第十六轮**（逐条复核第十五轮 R15-01..R15-04 是否真修，独立核验授权能力与声明维度的交叉核对矩阵，并找新问题）
- 冻结点：git `f2cb657`（`docs(review): WP-02 independent review report, round 15`），修复提交 `546593d`（`fix(core): WP-02 review round 15 findings (R15-01..R15-04)`）
- HEAD 校验：`git rev-parse HEAD` = `f2cb6573b4bab30e1a7b6b7183b4028d1c158520`；`git log -1` = `f2cb657 docs(review): WP-02 independent review report, round 15`
- 工作树：复核开始、每组实验后、全部契约命令后、本报告写入前 `git status --porcelain` 均无输出（`pnpm build` 只写被 `.gitignore` 忽略的 `dist/`）
- 评审角色：Review（独立上下文，未读取任何开发对话；只依据仓库文件、git 对象与我自己的实验）
- 权威依据：`AGENTS.md`、`docs/rules/{workflow,agents}.md`（§1、§2）、`docs/architecture/{ARCHITECTURE,data,protocol,reliability,context,execution}.md`、`docs/delivery/{implementation,acceptance}.md`（WP-02 与 AC-043/044/045/046/047/082）、`.agentdev/work/WP-02/{plan,discovery,implementation,review}.md` 全部记录、`packages/core/src` 全部 17 个文件、`packages/domain/src` 全部 5 个文件与 `packages/domain/test/domain.test.ts`、`packages/contracts/src/entities/{structures,work}.ts` 与 `primitives.ts`、`packages/core/test/orchestrator.test.ts`
- 方法：逐行核对「注释/记录/提交信息声称」与代码；在 `/tmp/wp02r16/` 自建夹具与 7 组实验脚本（`fixture.mjs`、`lib.mjs`、`exp1..exp7.mjs`），用 `pnpm build` 产出的 `packages/*/dist` 独立复现（软链 `/tmp/wp02r16/node_modules/@agentdev/*`）；**不修改产品代码、测试、`docs/**`、`plan/implementation/discovery`**
- 工具：`node v24.8.0`、`pnpm 12.3.4`

---

## 0. 历史轮次结论摘要（保留，第一至十五轮）

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
| 第十四轮 | `9f62582` | FAIL | 0×P1、1×P2、4×P3（R14-01..R14-05）＋对抗性 D-1..D-4；阻断项 R14-01（`git` 未计入工作区写操作） |
| 第十五轮 | `088bdd7` | FAIL | 0×P1、1×P2、3×P3（R15-01..R15-04）；阻断项 R15-01（只读授权可为写范围背书并把写 scope 冻结进 `effectiveScope`）。第十五轮报告正文随 `f2cb657` 入库，可直接读取 |

各轮要点（原文见各轮报告或 git 对象）：

- **第一轮**：P1＝`stage.submit` 无终态/epoch 守卫；P2＝「父等待可接消息」证据空洞、`joinPolicy=none` 未实现、持久事件名偏离 `protocol.md` §7、越界写入 Plan、`run.ts` 快照引用改哈希与 `data.md` 冲突。
- **第二轮**：`contract_violation` 不释放预算、非 running 仍接受交付、自造 Join 事件名、终态父 Run 仍收新子 Run、重复 `chief_action_required`、二次 Schema 失败在 `paused` 抛错等。
- **第三轮**：M-01（P1）父 Run 级预算预留从不释放；M-02 预算只预留/释放不核销；M-03 `Work blocked(provider)` 未落地。
- **第四轮**：Q-01（`operationId` 只按键去重不校验载荷）、Q-04（父 Chief Run 可在 `join=all` 子 Run 未终态时被结算）。
- **第五轮**：R5-01（指纹漏字段）、R5-02（`settleRun(...,'cancelled')` 绕过守卫）、R5-03（超限 usage 卡死）、R5-04（`reconcile` 不幂等）、R5-05（`join=none` 孤儿待办）；`H-03` 全仓无定义。
- **第六轮**：R6-01（P1）`reconcile` 双重核销→双重计费；R6-02 `cost` 只进事件不进 Work 预算；R6-03 `settleRun(...,'cancelled',usage)` 静默丢弃实测用量。
- **第七轮**：R7-01 malformed `DispatchSpec` 抛裸 `TypeError`；R7-02 `reconcile` 幂等比较忽略 `cost`；R7-03 `measured:false` 带 cost 被静默丢弃；R7-04 `reconciliation` 计数恒 1；R7-05 DC-48；R7-06 DC-35；R7-07 被拒 dispatch 仍落快照行；R7-08 DC-46；R7-09 级联取消不释放「从未启动」子 Run 的预留。
- **第八轮**：R8-01 `requestDispatch` 无契约校验；R8-02 `assess` 无契约校验；R8-03 零消费取消的死预留；R8-04 被拒 dispatch 留快照行；R8-05/R8-06 记录不符；R8-07 `§65` 引用；R8-08 失效引用/注释；R8-09 `contextPayload` 无校验。
- **第九轮**：R9-01（P2，阻断）L3 底线只认 8 个英文 camelCase 旗标、未登记拼写静默按 L2 通过（fail-open）；R9-02 `dispatchRequestSchema` 与 `protocol.md` §1/§6 不一致；R9-03 `runParams` 未覆盖；R9-04 `assess` 静默丢弃 `goal`；R9-05 `auth.ts` 注释过度声称；R9-06 父 Run `paused` 时 Chief 待办缺失；对抗性 A＝`operation` L3 判定源错误，B＝`authorizationRef` 不核对授权实体，C＝`scope` 被静默丢弃。
- **第十轮**：R10-01（阻断）未登记风险旗标静默降级；R10-02（阻断）授权核对只查存在性、跨 Work/已撤销仍被接受、`dispatch` 的 `authorizationRef` 完全不核对；R10-03 事件不记 `floor`；R10-04 `sourceRefs[].version` 接口可选而运行期必填；R10-05 非法 `runParams` 报 `PROVIDER_UNAVAILABLE`；R10-06 DC-60 与代码不符；R10-07 `operation` 判定过严。
- **第十一轮**：R11-01（阻断）`intent:'assist'/'artifact'` 在环境/风险门禁之前 `return none`；R11-03（阻断）L3 Work 的 `dispatch` 不要求任何授权；R11-02 `routingFloor` 对 `operation` 返回 `none`；R11-04 JSDoc 被常量块截断；R11-05 环境操作集合硬编码。
- **第十二轮**：R12-01（阻断）`dispatch` 不按 spec `scope` 施 L3 底线；R12-02（阻断）授权 `operations`/`scope` 不参与判定；R12-03 核对结果未冻结进 DispatchSnapshot；R12-04 JSDoc 与调用点不符；R12-05 DC-62 未写集合归属；对抗性①`none` Work 可派写权限 Run 且 `grantsModificationAuthority` 是死代码；②风险词表斜杠归一未生效。
- **第十三轮**：R13-01（P2，阻断）授权路径维度不参与判定、只读授权可为写范围背书；R13-02（P2，阻断）`none` Work 写权限门禁作用在派生 `runLevel` 上；R13-03（P2）显式 `undefined` 可选字段抛非协议错误码；R13-04（P3）DC-63 未同步；R13-05（P3）测试错号与「read-only grant」注释不实；R13-06（P3）`config.policy.l3Paths`/`l3Keywords` 无读取方。
- **第十四轮**：R14-01（P2，阻断）`git` 未计入工作区写操作；R14-02（P3）DC-66 两处与代码相反；R14-03（P3）JSDoc 未含路径维度；R14-04（P3）R13-01 新用例未真正覆盖「只读授权 × 写范围」；R14-05（P3）R13-06 定性澄清；对抗性 D-1..D-4。
- **第十五轮**：R15-01（P2，阻断）`writePaths` 不需要授权里的写操作即可背书并冻结（`read`/`search`/`deploy`/`bash`/`secret`/`push`/`network`/`delete_data` 八种授权操作 × 空操作写范围 Run 全部接受）；R15-02（P3）`authorizationSchema.operations` 未用操作名枚举；R15-03（P3）两类关键负例用例缺失；R15-04（P3）DC-67 仍写三元素写集合、T22 单测计数 247/248 不符。

**追溯口径（沿用第五轮 DC-53/DC-56 与第十五轮口径）**：行为/需求缺失＝P1（阻断）；局部质量/维护＝P2；建议＝P3。P2/P3 是否阻断由本轮按 `workflow.md` §6（第 65 行）「影响验收则阻断」判定。**L3/授权门禁类缺陷沿用 R9-01/R10-01/R11-01/R11-03/R12-01/R12-02/R13-01/R13-02/R14-01/R15-01 的 P2 标定。**

**历史报告取回方式**：第十五轮报告正文随 `f2cb657` 入库（= 本文件被覆盖前的内容，`git show f2cb657:.agentdev/work/WP-02/review.md`）；第十四轮 `git show 088bdd7:…`（正文为第十三轮报告）；依此回溯至第一、二轮原文见第二轮报告 §0。

---

## 1. 本轮结论

**PASS（Review Passed）——第十五轮唯一阻断项 R15-01 已真修好，且修复形态与开发方声称一致：授权能力与声明维度做交叉核对后，只读/空操作/环境操作授权不再能为写范围背书，写范围也不再能冻结进口径外的 scope。R15-02/R15-03/R15-04 亦逐条核实修好。我用独立夹具在我的实现上复算了完整的「声明维度 × 授权能力」矩阵：13 种授权能力（12 个契约操作 + 空）× 8 种声明组合 × L1/L2/L3 三种 Work，共 392 例，接受/拒绝结果与 DC-63 记载的规则 100% 一致（0 mismatch）。本轮共新增 0×P1、1×P2（非阻断）、5×P3（R16-01..R16-06）；无阻断项，同意进入独立 Test。**

**逐条裁定（详见 §3）**

| 第十五轮条目 | 本轮裁定 |
|---|---|
| **R15-01**（P2，阻断）`writePaths` 不需要授权里的写操作即可背书并冻结 | **完全修好 ✓**：`verifyAuthorization` 新增 `capabilityGaps`（`orchestrator.ts:812-821`）：声明 `writePaths` 要求授权 `operations` 命中 `WORKSPACE_WRITE_OPERATIONS`（`edit`/`write`/`artifact_write`/`git`），声明 `readPaths` 要求命中 `read`/`search`（`routing.ts:179-204` 新增 `includesWorkspaceWrite`/`includesRead`/`READ_OPERATIONS`），`networkTargets` 沿用 R14 的 `networkTargetsWithoutGrant`。实跑（`exp1` A/B/C）：13 种授权能力中，`writePaths` 仅 `artifact_write`/`edit`/`write`/`git` 4 种被接受、`readPaths` 仅 `read`/`search`、`networkTargets` 仅 `network`；第十五轮复现的 `operations:['read']` + 覆盖写路径 + 空操作 Run 现为 `NOT_AUTHORIZED`（details `capabilityGaps:['writePaths without a write operation']`、`uncoveredWritePaths:[]`）。`exp5` 392 例矩阵 0 mismatch；`exp6` 补齐「有能力无信封/两者皆缺」四类边界格。 |
| **R15-02**（P3）`authorizationSchema.operations` 未用操作名枚举 | **完全修好 ✓**：`work.ts:137` 改为 `list(operationNameSchema)`；`exp2` A：`['writ']`/`['git_write']`/`['Edit']`/`['READ']`/`['']`/`['delete-data']` 全部被 Schema 拒绝、12 个合法取值全部接受；**并且持久化层同效**（`exp2` B：`store.authorizations.insert({operations:['writ']})` 抛 `StorageError/CONSTRAINT_VIOLATION`，零行泄漏），因为仓储 insert 用同一 `authorizationSchema`。`dispatch` 侧 `scope.operations:['git_write']` 仍为 `VALIDATION_ERROR`（`exp2` C）。 |
| **R15-03**（P3）两类关键负例用例仍缺失 | **完全修好 ✓**：`orchestrator.test.ts` 新增 `READONLY_WRITE_AUTHORIZATION_ID`（`operations:['read']`、写信封覆盖写路径）、`NONE_GIT_AUTHORIZATION_ID`（绑定 `none` Work）、`DEPLOY_READ_AUTHORIZATION_ID`；新用例 `requires a matching capability for every declared dimension (R15-01)` 直接断言 `details.capabilityGaps` 两条字符串；`none` × `git` 用例现在同时覆盖「不带授权」与「带本 Work 授权」两种形态（`exp3` D 实读）；`contracts/test/entities.test.ts` 新增未知操作名拒绝用例。 |
| **R15-04**（P3）DC-67 三元素写集合 + 计数 247/248 | **完全修好 ✓（残留见 R16-06）**：DC-66 与 DC-67 现均为 `['edit','write','artifact_write','git']`（`exp3` B：全文已无三元素写法），`routing.ts` 与导入的运行期集合一致；T23 记 `unit 250 / integration 124`，与实测 `250 / 124` 及提交信息一致。 |

**新发现**：R16-01（P2，**不阻断**，`artifact_write` 被计入工作区写操作，`none` 级 assist/artifact 路线无法建立声明 `artifact_write` 的 Run，与 `execution.md` §3/§7、`workflow.md` §2.1 存在张力，需产品方/WP-03 定性并登记）、R16-02（P3，spec 侧声明未交叉核对，`effectiveScope` 仍可带 `writePaths` 而无对应操作）、R16-03（P3，R15-02 修复写入 `packages/contracts/src/entities/work.ts`，该文件不在 `plan.md` writePaths 内）、R16-04（P3，`verifyAuthorization` JSDoc 未登记新的能力交叉核对）、R16-05（P3，domain 分类完备性测试硬编码 `read`/`search`、未引用新导出 `READ_OPERATIONS`）、R16-06（P3，T22 记录「当前为 248」与 T23/实测 250 不一致）。

### 前十五轮阻断项的当前状态（本轮实跑复核）

- 第九～十一轮（R9-01/R10-01/R11-01/R11-03）：`exp1`/`exp5` 未见回退（未登记旗标、环境操作抬级、`assist` 短路均未改动）。
- 第十轮 R10-02 授权实体核对：`exp4` C 三类（跨 Work / 已撤销 / 不存在）全为 `NOT_AUTHORIZED`，未回退。
- 第十二轮 R12-01/R12-03：`exp5` 全矩阵显示 spec `scope` 仍施 L3 底线与覆盖面核对；`exp4` I 显示核对通过的引用被冻结进 DispatchSnapshot。
- 第十三轮 R13-01/R13-02/R13-03：`exp4` A/B 显示 `none` 写门禁在 12 种操作 × 写范围上全部生效、路径前缀覆盖仍工作；`exp6` 显示能力/信封两维度各自独立拒绝。
- 第十四轮 R14-01/D-1 与 D-2：`git` 写入集合、`network` 操作要求均未回退（`exp1` A/C、`exp5`）。
- 第五至八轮的事件分页、幂等、预算、终态路径：`pnpm test:unit` 250 / `pnpm test:integration` 124 全绿覆盖（§2）。

---

## 2. 契约命令原始结果（本轮实跑）

执行方式：`export PATH="$HOME/.local/bin:$PATH"`，在仓库根目录按序执行并逐条记录退出码（日志 `/tmp/wp02r16/cmds.log`）。

| 命令 | 退出码 | 原始结果要点 |
|---|---|---|
| `pnpm typecheck` | **0** | `tsc -p tsconfig.json --pretty false`，无输出 |
| `pnpm lint` | **0** | `node scripts/lint.mjs`：`Checking formatting...` / `All matched files use Prettier code style!` |
| `pnpm test:unit` | **0** | `Test Files 17 passed (17)` / **`Tests 250 passed (250)`** / `Duration 6.18s`（与 T23 声称一致；`orchestrator.test.ts` 44 条、`domain.test.ts` 31 条、`entities.test.ts` 13 条） |
| `pnpm test:integration` | **0** | `Test Files 10 passed (10)` / **`Tests 124 passed (124)`** / `Duration 58.07s`（含真实容器 9 例） |
| `pnpm docs:check` | **0** | `docs:check ok — 15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages` |
| `pnpm build` | **0** | `packages/{contracts,domain,storage,core,pi-runtime}`、`apps/{cli,runner}` 共 7 个 workspace `build: Done` |
| `git status --porcelain` | — | 复核开始、每组实验后、全部契约命令后、本报告写入前均**无输出**（干净） |
| `git rev-parse HEAD` | — | `f2cb6573b4bab30e1a7b6b7183b4028d1c158520`（= 冻结点） |

**自建实验（观察值记录；标记 `FAIL` 的断言即 Finding 证据）：**
`exp1`（写/读/网络三维度 × 13 种授权能力 + 2×2 真值表 + 操作子集 + 残留）**79 passed / 0 failed**；`exp2`（R15-02 契约枚举 + 持久化层 + `scope.operations` 不被消费 + details 形状）**25 / 0**；`exp3`（R15-03/R15-04 记录与用例实读）**26 / 0**；`exp4`（`none` 写门禁、路径信封、引用完整性、零副作用、L3 边界、`assess`、授权来源、AC-082）**29 / 0**；`exp5`（**I 独立重实现 DC-63 规则并对 392 个真实 dispatch 逐一比对**）**1 / 0（392 例 0 mismatch）**；`exp6`（能力/信封边界四格）**6 / 0**；`exp7`（对抗性：`artifact_write` × `none` Work）**1 / 0（8 INFO）**。脚本与日志存 `/tmp/wp02r16/{fixture,lib,exp1..exp7}.mjs` 与 `exp1..exp7.log`；全部使用 `pnpm build` 后的 `packages/*/dist`，通过 `/tmp/wp02r16/node_modules/@agentdev/*` 软链解析，**不 import 任何产品测试文件**。

---

## 3. 逐条复核表

### 3.1 第十五轮条目

| 条目 | 前轮定级 | 本轮实测证据（脚本/观察值） | 判定 |
|---|---|---|---|
| **R15-01** `writePaths` 无写操作授权即可背书 | P2（阻断） | `exp1` A：`operations:[op]`（13 种）中，`writePaths` 仅 `artifact_write`/`edit`/`write`/`git` 接受，其余（含 `read`/`deploy`/`git_write` 之外的 8 种）拒绝且 `capabilityGaps:['writePaths without a write operation']`；`exp1` D 2×2 三张真值表全符合；`exp1` E 12×2 操作子集正/负例全过；`exp5` 392 例 0 mismatch；`exp6` A/B/C 边界四格；`exp4` D 被拒零 Run/零快照；`orchestrator.ts:812-821`、`routing.ts:179-204` | **完全修好 ✓** |
| **R15-02** 授权操作名未用枚举 | P3 | `exp2` A/B/C：Schema 与仓储 insert 双重拒绝未知操作名，合法 12 值全接受，零行泄漏；`work.ts:135-137` | **完全修好 ✓** |
| **R15-03** 负例用例缺失 | P3 | `exp3` D：三类夹具与两条断言实读存在；`exp4` A 的 `none` × `git` × 带授权形态复现为拒绝 | **完全修好 ✓** |
| **R15-04** DC-67 与计数 | P3 | `exp3` B：DC-66/DC-67 均为四元素集合、全文无三元素残留；`exp3` C：T23 = 250/124，与实测一致 | **完全修好 ✓（残留见 R16-06）** |

### 3.2 授权能力 × 声明维度交叉核对矩阵（`exp1`/`exp5`/`exp6` 实跑）

「声明维度 present/absent × 授权能力 present/absent」四格 × 三维度；授权能力取自 `Authorization.operations`，信封取自 `Authorization.scope`：

| 声明维度 | 已在 spec 声明 | 授权具备对应能力 | DC-63 期望 | 实测 |
|---|---|---|---|---|
| `writePaths` | 有 | 有（`write`） | 接受 | **接受** |
| `writePaths` | 有 | 无（`read`/`search`/`deploy`/`bash`/`secret`/`push`/`network`/`delete_data`/空） | 拒 | **拒**（`capabilityGaps`） |
| `writePaths` | 无 | 有 | 接受 | **接受** |
| `writePaths` | 无 | 无 | 接受 | **接受** |
| `readPaths` | 有 | 有（`read`/`search`） | 接受 | **接受** |
| `readPaths` | 有 | 无（含 `edit`/`write`/`git`/`deploy`/空） | 拒 | **拒**（`capabilityGaps`） |
| `readPaths` | 无 | 有 | 接受 | **接受** |
| `readPaths` | 无 | 无 | 接受 | **接受** |
| `networkTargets` | 有 | 有（`network`） | 接受 | **接受** |
| `networkTargets` | 有 | 无 | 拒 | **拒**（`networkTargetsWithoutGrant`） |
| `networkTargets` | 无 | 有 | 接受 | **接受** |
| `networkTargets` | 无 | 无 | 接受 | **接受** |

- **操作维度**（`exp1` E）：`spec.operations` 12 值逐个「等于授权」⇒ 12/12 接受；授权为空 ⇒ 12/12 拒绝且 `details.uncoveredOperations` 命中该操作。
- **信封边界**（`exp6` A）：能力具备但信封为空 ⇒ 三维度分别只由 `uncoveredWritePaths`/`uncoveredReadPaths`/`uncoveredNetworkTargets` 拒绝（`capabilityGaps` 为空）；两者皆缺（`exp6` C）⇒ 两个 details 列表同时命中。
- **Work 维度**（`exp5` C）：同一规则在 L1/L2/L3 Work 上一致；`none` Work 的额外写门禁未受影响（`exp4` A：12 操作 × 写范围全拒）。
- **结论**：交叉核对与 DC-63 的记载**自洽**；唯一的形态缺口是「spec 侧声明」未参与核对（R16-02）。

---

## 4. 新 Findings（R16-01..R16-06）

### R16-01 [P2，不阻断] `artifact_write` 被计入工作区写操作，`none` 级 assist/artifact 路线无法建立声明 `artifact_write` 的 Run

- **位置**：`packages/domain/src/routing.ts:179-187`（集合含 `'artifact_write'`）、`:191-204`、`:206-215`（`declaresWorkspaceWrite`）；`packages/core/src/orchestrator.ts:371-382`（`Work ... is none and cannot create a Run with write authority`）；对照 `docs/architecture/execution.md:21`（ACL 表「Chief/只读调查 | 写：自己的Artifact」）、`:53`（「工具：read/search/context_request/artifact_write；修改角色另有 edit/write/bash/git」）、`docs/rules/workflow.md:11`（「assist/artifact 为 level=none，直接调用工具或 Chief 分派独立分析/制作 Agent」）、`docs/architecture/data.md:22`（「none不产生修改授权」）；记录 `.agentdev/work/WP-02/discovery.md:245,253`（DC-66/DC-67 把 `artifact_write` 明列进写集合）。
- **事实（`exp7` 实跑）**：
  - `none` 级 Work 上，`scope.operations:['artifact_write']`（或 `['read','artifact_write']`）的 **Chief spec** 与 **专业 spec** 均为 `NOT_AUTHORIZED`（`workLevel:'none'`）；同一 scope 的纯 `['read']` 与 `[]` 被接受；
  - 同一 scope 在 L2 Work 上被接受（`exp7` B）；
  - `assess` 仍把 `intent:'artifact'` + `operations:['artifact_write']` 的评估接受为 `level:'none'`（`exp7` C）——即路由结论与 Run 建立边界对同一 scope 给出相反结论；
  - `exp1` A 显示 `artifact_write` 是 `writePaths` 的四种合法背书能力之一，但 `artifact_write` 写的是 Artifact（`data.md:33` 的 `relativeBlobPath`），不是跟踪文件；`routing.ts:157` 的注释理由（「they act on the local workspace」）与 `routing.ts:172-178` 的「modify tracked files」对 `artifact_write` 都不成立。
- **影响**：`workflow.md` §2.1 把 assist/artifact 路线的产出定义为「制作」（Artifact），`execution.md` §3/§7 又把 `artifact_write` 列为**所有角色**（含只读调查/Chief）的基础工具；而 WP-02 的 Run 边界在该等级上拒绝任何显式声明该操作的 spec。若 WP-07 的 Broker 按 `data.md:80` 以冻结的 `effectiveScope` 判权，则该路线的 Run 无法声明自己将要使用的工具（只能依赖角色 ACL 的隐含允许）。`assess` 与 `dispatch` 对同一 scope 的不一致也使「评估结论 → 可派发」的推导失效。
- **为何不判阻断**：WP-02 的关联验收（AC-043/044/045/046/047/082）均不覆盖 Artifact 产出；本包夹具中的 `none` Run 也从不声明 `artifact_write`；上一轮（第十三轮报告 §5.3，见 `git show e3b210c:.agentdev/work/WP-02/review.md:168`）已把「assist/artifact × 本地操作在 level=none 下被接受」记录为「不判缺陷、建议 WP-03/WP-04 明确」的待明确项，而该观察未进入 `discovery.md`，现存于 git 对象。按 `workflow.md` §6，产品语义未确认时应走「Product decision pending」而不是 Review 失败。
- **建议**：(a) 把 `artifact_write` 从 `WORKSPACE_WRITE_OPERATIONS` 移除（只留 `edit`/`write`/`git`），并在 `domain.test.ts:232-244` 补 `artifact_write ⇒ false` 的谓词断言；(b) 若产品语义是「`none` 不产生任何写操作（含 Artifact）」，则必须同步 `execution.md` §3/§7 与 `workflow.md` §2.1，并把「Artifact 写入不经 `scope.operations` 判定」写入 `data.md`/DC 记录；(c) 无论选哪支，把该组合登记为 Discovery 并给出 WP-03 的准入结论。

### R16-02 [P3] spec 侧声明未与自身操作列表交叉核对：`effectiveScope` 仍可冻结 `writePaths`/`networkTargets` 而 `operations` 不含对应操作

- **位置**：`packages/core/src/orchestrator.ts:812-821`（`capabilityGaps` 只看授权能力，不看 spec 自身 `operations`）、`:467-470`（`effectiveScope: spec.scope` 原样冻结）；记录 `discovery.md:226`（DC-63 写成「声明路径即声明能力」，但实现只对**授权**生效）。
- **事实（`exp1` F、`exp6` D 实跑）**：授权 `operations:['write']` + `scope.writePaths:['packages/storage/src']`，spec `{writePaths:['packages/storage/src'], operations: []}` ⇒ **接受**，冻结的 `effectiveScope = {"readPaths":[],"writePaths":["packages/storage/src"],"operations":[],"networkTargets":[]}`；授权 `operations:['git']`（无 `edit`/`write`）同样可背书该写范围；镜像地，`{operations:['edit'], writePaths: []}` + 空写信封的授权 ⇒ 接受，冻结 scope 为 `{"operations":["edit"],"writePaths":[]}`。
- **影响**：第十五轮 R15-01 的影响陈述「冻结的 `operations:[]` 又不含任何写操作——AC-082 的窄范围证据既不代表被授权的操作，也不含『写已被授权』的任何痕迹」在**声明侧**仍然成立：写范围可以被冻结而 scope 内没有任何写操作。方向是 fail-closed（工具层按操作判权会拒绝），AC-082 的文件范围仍被保留，故不判缺陷；但它使 DC-63 的「声明路径即声明能力」与代码不完全一致，并让 `effectiveScope` 的「空 `writePaths`/空 `operations`」语义（`primitives.ts:147` 的 `emptyScope()` 注释写「write nothing」）没有定义。
- **建议**：二选一并写进 DC-63/`data.md`：(a) spec 声明 `writePaths` 时要求 `scope.operations` 至少含一个写操作（与 `capabilityGaps` 对称，失败 details 增加 `writeOperationMissing`）；(b) 明确 `effectiveScope.operations` 允许是授权能力的真子集，并规定 Broker 必须同时解析 `authorizationRef` 指向的信封，且空数组语义为「未声明（继承授权）」。

### R16-03 [P3] R15-02 的修复写入 `packages/contracts/src/entities/work.ts`，该文件不在 `plan.md` 的 writePaths 内

- **位置**：`packages/contracts/src/entities/work.ts:137`（`operations: list(operationNameSchema)`，由 `546593d` 修改）；对照 `.agentdev/work/WP-02/plan.md:27-31`（writePaths 只列 `packages/domain/src/**`、`packages/contracts/src/entities/structures.ts`、`packages/contracts/src/entities/run.ts`、`packages/contracts/test/entities.test.ts`、`packages/core/test/**`、`.agentdev/work/WP-02/**`）。
- **事实（`exp3` C2 + git 实读）**：`git log --oneline -- packages/contracts/src/entities/work.ts` 只有 `546593d` 与 WP-01 的 `dab17f9`；plan.md 中不存在 `entities/work.ts` 字样；此前所有 `entities/*.ts` 改动（`080aa4c`/`e125bb7`/`328ee60`/`a047a9f`）都落在 plan 已列的文件上。第一轮 Review 的 RE-05 正是针对同类「越界写入 Plan」，当时的处理是把文件补进 plan。
- **影响**：`workflow.md` §4 要求 Plan 含写入范围，`agents.md` §1 规定 backend 只改授权 Task 范围；越界写入使「Plan ↔ Diff」对账失败，也削弱「冻结 Diff 在授权范围内」这一前提。修复本身正确（正是 R15-02 的建议做法），问题只在 Plan 未同步。
- **建议**：在 `plan.md` writePaths 增列 `packages/contracts/src/entities/work.ts`（授权来源：本包 Review 第十五轮 R15-02；用户目标轮次「继续」），或在 `implementation.md` 中显式登记该文件的授权缺口。

### R16-04 [P3] `verifyAuthorization` JSDoc 未登记新的能力交叉核对维度

- **位置**：`packages/core/src/orchestrator.ts:745-758`（JSDoc 只列 `operations`/`writePaths`/`readPaths`/`network` 四类覆盖，无「声明维度需要授权具备对应能力」）；对照 `discovery.md:226`（DC-63 已登记）、`546593d` 提交信息（「a declared scope dimension requires the matching capability in the grant」）。
- **事实（`exp3` F 实读）**：JSDoc 含 `writePaths`/`readPaths`/`network` 要求，但不含新维度、也不提 `details.capabilityGaps`；`capabilityGaps` 是新增的失败字段，`protocol.md` §7 只给错误码集合、未定义 details 键。属第十四轮 R14-03（JSDoc 未含路径维度）的同类延续。
- **影响**：注释/记录与实现再次出现「声称范围小于实现范围」，后续维护者按 JSDoc 读会漏掉该判定；不影响运行行为。
- **建议**：JSDoc 补一句与 DC-63 第 1 条相同的规则，并在 `discovery.md` 的「仍属后续工作」中记明 `capabilityGaps` 属实现级 details 键（WP-04 接线时确认协议层是否透出）。

### R16-05 [P3] domain 分类完备性测试硬编码 `read`/`search`，未引用新增的 `READ_OPERATIONS`

- **位置**：`packages/domain/test/domain.test.ts:246-259`（`classified` 集合手写 `'read'`/`'search'`）、`:232-244`（写操作谓词只断言 `edit`/`write`/`git`，无 `artifact_write`）；对照 `packages/domain/src/routing.ts:192`（新导出 `READ_OPERATIONS`）。
- **事实（`exp3` A + 实读）**：`pnpm test:unit` 中该用例通过，但即使有人把 `READ_OPERATIONS` 改成 `['read']`（丢掉 `search`）或新增第三个读操作名，该用例仍会通过；`artifact_write` 的谓词行为在 domain 层也没有断言（`exp1` A 才覆盖）。
- **影响**：第十五轮新增的读能力集合没有回归网，属 R15-03（新增常量没有用例锁定）的同类。`capabilityGaps` 的读写两侧行为由 `orchestrator.test.ts` 的集成断言覆盖，未完全裸奔。
- **建议**：`classified` 用 `...READ_OPERATIONS` 替代手写两项，并补 `artifact_write`/`edit`/`write`/`git` 四者的 `declaresWorkspaceWrite` 断言（见 R16-01 建议 (a)）。

### R16-06 [P3] T22 仍称「当前为 248」，与 T23 及实测 250 不一致

- **位置**：`.agentdev/work/WP-02/implementation.md:230`（T22：「`pnpm test:unit` **247 passed**（该修复提交时点数；随后 `088bdd7` 增加分类完备性用例，当前为 248）」）与 `:240`（T23：`250 passed`）。
- **事实（`exp3` C + §2 实跑）**：HEAD `f2cb657` 实测 `17 files / 250 passed`；`546593d` 自身又新增 2 条 `it`（`entities.test.ts` 1 条、`orchestrator.test.ts` 1 条），因此「当前」应为 250。R15-04 要求更正计数，修复把 T22 的 247 说明为「修复提交时点数」但把「当前」写成 248（第十五轮报告写作时点的旧值），与同文件的 T23 自相矛盾。
- **影响**：`implementation.md` 是本包与 Settlement 的事实源；同一文件两处对「当前单测数」给出不同值，会让长期沿用的「声称数 = 实测数」核对手段失效（R15-04 同族）。
- **建议**：把 T22 括注改为「该修复提交时点数 247；`088bdd7` 后 248；本轮 `546593d` 增加 2 条用例后为 250」，或直接指向 T23，避免第二处计数副本。

---

## 5. 其它观察（不计入 Finding 编号）

1. **`Authorization.operations` 与 `Authorization.scope.operations` 双操作列表仍并存**：DC-63（`discovery.md:227`）已声明「能力清单取自 `Authorization.operations`，本包不做与 `scope.operations` 求交」，`exp2` D 实跑证实 `scope.operations` 被静默忽略（授权 `operations:['read']` + `scope.operations:['edit']` 无法为写范围背书）。`primitives.ts:138` 仍把 `Scope` 注释为「the authorization envelope」，`data.md:7/:26` 也把两处都写作 `operations:string[]`，未定义优先级；属已登记的产品待决项（沿第十二/十三/十五轮 §5.3），建议 WP-04 接线前定性。
2. **spec 只声明 `networkTargets` 而不声明 `network` 操作时被接受**：`exp1` C/`exp5` 显示 Run 侧 `effectiveScope.operations:[]` + `networkTargets:['10.0.0.5']` 可接受（只要求**授权**带 `network`）。与 R16-02 同形（声明侧不核对），方向 fail-closed，未判缺陷。
3. **`git` 授权可为任意路径的写范围背书**：`exp1` F 实跑（授权 `['git']` + 写信封 ⇒ 空操作写范围 Run 接受）。按 `routing.ts:172-187` 的分类 `git` 是工作区写操作，属项目既有口径；但 `git`（commit/checkout/reset）与 `edit`/`write`（直接改文件）在授权语义上并不同质，建议产品方确认是否允许跨能力背书。
4. **`none` Work 仍可建立环境副作用的 L3 Run**：`exp4` A INFO——`none` Work + `operations:['deploy']` + 覆盖授权 ⇒ 接受。`data.md:22` 的「none不产生修改授权」只覆盖写，不覆盖环境副作用（沿第十五轮 §5.6）。
5. **L1/L2 Work 无授权即可冻结写范围**：`exp4` F INFO——L2 Work 无 `authorizationRef` 时 `writePaths` 仍被接受（`workflow.md` §2 的 Work 级授权设计），因此「写范围必须被授权」在 L1/L2 上没有实体支点（沿第十五轮 §5.4）。
6. **`artifact_write` 是 `writePaths` 的合法背书能力**：`exp1` A 四种能力之一。若采纳 R16-01 建议 (a)，需同时确认 `writePaths` 的背书集合（`artifact_write` 是否应能为仓库路径背书）。
7. **`assess` 的 `goal`/`scope` 仍不落库、不落事件**：`exp7` C 的评估行（DC-60/DC-70 已登记为产品待决）；`exp4` F 显示无授权时 `assess` 也接受带 `writePaths` 的载荷（它不是 Run 边界，DC-66 第 4 条）。
8. **`isInsideScope` 只做段前缀包含、`networkTargets` 仍精确相等**：`exp6` A 显示网络目标用 `uncoveredNetworkTargets` 精确匹配，与 `domain/permission.ts:44` 的 `targetCovers` 前缀语义并存；`execution.md:33` 要求「按精确目标显式授权内网」，故不判缺陷。`.` 段的归一化问题沿第十三/十五轮 §5.6。
9. **磁盘/索引状态**：`docs/INDEX.md` 的「实现起点」只结算到 WP-01，未声称 WP-02 已实现（正确）；`cmds.log` 未被跟踪（`*.log` 在 `.gitignore`），其内容为旧轮次的 233 条，不构成记录不一致。
10. **产物归属**：本轮修复提交 `546593d` 与第十五轮评审报告提交 `f2cb657` 分离，符合「Review 产物与开发提交分离」；`546593d` 同时改写了 `discovery.md`/`implementation.md`（属开发记录范围）。

---

## 6. 剩余风险（未闭环，供 Test/Settlement 与产品方判断）

1. **R16-01（新增，P2 不阻断）**：`artifact_write` 的写操作归属需产品方/WP-03 定性；在此之前，「assist/artifact 路线的 Run 是否可在 scope 中声明 `artifact_write`」无定论，`assess` 与 `dispatch` 对同一 scope 结论相反。
2. **R16-02..R16-06（新增，P3）**：声明侧交叉核对、Plan 写入范围、JSDoc、domain 测试覆盖、T22 计数五处记录/测试缺口。
3. **授权语义的悬置项**：`Authorization.operations` 与 `scope.operations` 的优先级（§5.1）；L1/L2 写范围是否必须绑定授权（§5.5）；`git` 跨能力背书（§5.3）；`none` Work 的环境副作用（§5.4）。
4. **DC-66 明确推迟的项**（需产品决定/风险接受）：授权 `acceptedAt`/来源消息核对、`once` 类授权的消费记账、`work.level` 的回写（`works.update` 仍无生产调用点）。
5. **DC-70 承接项**：`config.policy.l3Paths`/`l3Keywords` 公开可配但无判定语义；WP-04 落地前用户配置不会生效（沿第十三/十五轮）。
6. **`capabilityGaps` 的协议可见性**：新增 details 键未在 `protocol.md` §7 定义；WP-04 接线时需确认 `details` 是否透出给客户端、以及 `NOT_AUTHORIZED` 的 details 是否算兼容性变更。
7. **并发未验证**：预算准入检查（`orchestrator.ts:428-431`）与事务内 `reserve`（`:490`）之间仍有窗口；单 mailbox 串行假设下不可达，多连接/多进程的双花与「快照已落、Run 未建」未被测试覆盖（沿前几轮）。
8. `timed_out`/`interrupted`/`recovery_required` 终态无产生路径（WP-05）；`onChildSettled` 仍无生产调用方（WP-05）；`Work blocked(provider)`/`blocked(budget)` 投影属 WP-05（DC-42/DC-55）。
9. `ModelGateway` 的真实 HTTP、Secret 解析与 `testConnection` 真连属 WP-07/WP-10（DC-31）；R16-01/§5.1 的「Broker 如何消费 `effectiveScope`」正落在 WP-07。
10. **测试缺口**：250 条单测仍没有「`none` Work × 声明 `artifact_write` 的 Run」（R16-01）、「spec 声明 `writePaths` 而 `operations` 不含写操作」的显式正例/反例（R16-02）、以及「`READ_OPERATIONS` 变更即失败」的完备性用例（R16-05）。
11. **待产品方决定项**（沿前轮继续有效）：DC-64（风险旗标词表是否升为契约枚举）、DC-60（`Assessment.goal`/`scope` 是否落库）、DC-27/RE-06（`data.md:30` 三个 `:ID` 快照引用与实现的哈希并存）、DC-46（`dispatch` 不校验 `work.status`）、第十二轮 §5.4（lockdown 门禁是否严格限于 delivery/document）、R14-05（`l3Paths`/`l3Keywords` 目标语义）、第十五轮 §5.1（`none` Work 是否允许只读 git）。

---

## 7. 方法与边界声明

- 本报告只依据仓库文件、`f2cb657`/`546593d` 上的 git 对象/差异与实跑命令；未读取任何开发对话、未引用外部同名技能或历史方案。
- 阅读深度：`packages/core/src/orchestrator.ts` 全文件逐行（重点 `:240-391`、`:450-526`、`:740-889`）；`packages/domain/src/routing.ts` 全文件、`packages/domain/src/permission.ts` 关键函数；`packages/contracts/src/primitives.ts`（`:1-170`）与 `packages/contracts/src/entities/work.ts`（`:100-160`）；`packages/core/test/orchestrator.test.ts`（`:1-411`、`:575-790`、`:1080-1110`）与 `packages/domain/test/domain.test.ts`（`:228-272`）；`docs/architecture/{data,reliability,protocol,context,ARCHITECTURE}.md` 通读、`execution.md` §1-§4/§7；`docs/rules/workflow.md` §1/§2；`docs/delivery/implementation.md` WP-02 与 `docs/delivery/acceptance.md`（AC-043..047、AC-082）；`.agentdev/work/WP-02/{plan,discovery,implementation,review}.md` 全部记录通读；`packages/core/src` 其余文件按注释声称与关键分支抽查（`dispatcher.ts` 只读确认无第二个 Run 建立/Run 授权入口）。
- 覆盖的手段：静态逐行核对 + 「注释/记录/提交信息 vs 代码」对账 + **独立重实现文档规则后对 392 例真实 dispatch 做差分核对**（`exp5`）+ 关键边界格（`exp1`/`exp6`）+ 对抗性探针（`exp7`）+ 前几轮不变式回归（`exp4`）。
- 唯一写入文件为本文件 `.agentdev/work/WP-02/review.md`；实验脚本与日志独立写在 `/tmp/wp02r16/`（`fixture.mjs`、`lib.mjs`、`exp1..exp7.mjs`、`exp1..exp7.log`、`cmds.log`），使用 `pnpm build` 产出的 `packages/*/dist`，通过 `/tmp/wp02r16/node_modules/@agentdev/*` 软链解析 workspace 包，**不 import 任何产品测试文件**。
- 未修改产品代码、测试、`docs/**`、`plan.md`、`implementation.md`、`discovery.md`；`pnpm build` 只写 `.gitignore` 中的 `dist/`。写入本报告前 `git status --porcelain` 无输出、`HEAD=f2cb6573b4bab30e1a7b6b7183b4028d1c158520`。
