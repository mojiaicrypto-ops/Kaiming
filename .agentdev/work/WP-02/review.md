# WP-02 独立 Review 报告（第十七轮）

- 评审对象：工作包 WP-02「主管与独立Agent调度」
- 评审轮次：**第十七轮**（复核第十六轮 Review PASS + 同轮对抗性核验异议 → 修复提交 `c695fcc` 是否真解决该异议、是否引入回归，并找新问题）
- 冻结点：git `3dc12db`（`docs(review): WP-02 independent review report, round 16`），修复提交 `c695fcc`（`fix(core): WP-02 round-16 adversarial follow-up (artifact_write, none-Work authority)`）
- HEAD 校验：`git rev-parse HEAD` = `3dc12dbb9ade8022d60063cb854fca5da711c6ab`；`git log -1` = `3dc12db docs(review): WP-02 independent review report, round 16`
- 工作树：复核开始、每组实验后、全部契约命令后、本报告写入前 `git status --porcelain` 均无输出（干净；`pnpm build` 只写被 `.gitignore` 忽略的 `dist/`）
- 评审角色：Review（独立上下文，未读取任何开发对话；只依据仓库文件、git 对象与我自己的实验）
- 权威依据：`AGENTS.md`、`docs/rules/{workflow,agents}.md`（§1、§2）、`docs/architecture/{ARCHITECTURE,data,protocol,reliability,context,execution}.md`、`docs/delivery/{implementation,acceptance}.md`（WP-02 与 AC-043/044/045/046/047/082）、`.agentdev/work/WP-02/{plan,discovery,implementation,review}.md` 全部记录、`packages/core/src` 全部 17 个文件、`packages/domain/src` 全部 5 个文件与 `packages/domain/test/domain.test.ts`、`packages/contracts/src/entities/{structures,work}.ts` 与 `primitives.ts`、`packages/core/test/orchestrator.test.ts`
- 方法：逐行核对「注释/记录/提交信息声称」与代码；在 `/tmp/wp02r17/` 自建夹具与 5 组实验脚本（`fixture.mjs`、`lib.mjs`、`exp1..exp5.mjs`），用 `pnpm build` 产出的 `packages/*/dist` 独立复现（软链 `/tmp/wp02r17/node_modules/@agentdev/*`）；**不修改产品代码、测试、`docs/**`、`plan/implementation/discovery`**
- 工具：`node v24.8.0`、`pnpm 12.3.4`

---

## 0. 历史轮次结论摘要（保留，第一至十六轮）

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
| 第十五轮 | `088bdd7` | FAIL | 0×P1、1×P2、3×P3（R15-01..R15-04）；阻断项 R15-01（只读授权可为写范围背书并把写 scope 冻结进 `effectiveScope`）。报告正文随 `f2cb657` 入库 |
| 第十六轮 | `f2cb657`（修复 `546593d`） | **PASS** | 0×P1、1×P2（非阻断，R16-01）、5×P3（R16-02..R16-06）。同轮对抗性核验认为应判 FAIL（R16-01 `artifact_write` 计入工作区写操作 ⇒ `none` Work 无法派发写自己 Artifact 的 Run；M-1 `none` Work 可经授权取得环境权限；M-2 `assess` 与 `dispatch` 同 scope 结论相反）。报告正文随 `3dc12db` 入库 |

**各轮要点（原文见各轮报告或 git 对象）**：本轮不重复；第十六轮报告 §0 的「各轮要点」列表与非阻断项明细见 `git show 3dc12db:.agentdev/work/WP-02/review.md`。

**追溯口径（沿用第五轮 DC-53/DC-56 与第十五/十六轮口径）**：行为/需求缺失＝P1（阻断）；局部质量/维护＝P2；建议＝P3。P2/P3 是否阻断由本轮按 `workflow.md` §6（第 65 行）「影响验收则阻断」判定。**L3/授权门禁类缺陷沿用 R9-01..R15-01 的 P2 标定。**

**历史报告取回方式**：第十六轮报告正文随 `3dc12db` 入库（= 本文件被覆盖前的内容，`git show 3dc12db:.agentdev/work/WP-02/review.md`）；第十五轮 `git show f2cb657:…`；依此回溯至第一、二轮原文见第二轮报告 §0。

---

## 1. 本轮结论

**PASS（Review Passed）——第十六轮对抗性异议的三项（R16-01 主诉、M-1、M-2）在 `c695fcc` 上均真实修好，R15-01 的能力交叉核对未回退，且未发现阻断性回归。本轮共新增 0×P1、0×P2、5×P3（R17-01..R17-05）；无阻断项，建议进入独立 Test。**

我对异议的三条主张逐条做了独立复现与反证：

1. **R16-01（主诉，`artifact_write` 分类）**：`WORKSPACE_WRITE_OPERATIONS` 现为 `['edit','write','git']`，`artifact_write` 单列 `ARTIFACT_WRITE_OPERATIONS`；四个分类集合（环境 6 / 工作区写 3 / Artifact 写 1 / 只读 2）对 12 个契约取值构成**不重不漏的划分**（`exp1` A：并集排序后与 `operationNameSchema.options` 逐字相等）。`none` 级 Work 现在可以派发 `operations:['artifact_write']`（以及 `['read','artifact_write']`）的 Chief/专业 Run，冻结的 `effectiveScope` 就带该操作；`none` 级 Work 的**跟踪文件**写权（`edit`/`write`/`git`/`writePaths`）与**环境**权（6 个环境操作与 `networkTargets`）仍然全部拒绝——**带本 Work 的授权也拒绝**（`exp1` B/C/D，共 42 条断言）。这条异议成立且已闭合。
2. **M-1（`none` Work 经授权取得环境权限）**：`dispatch` 门禁从「只看 `declaresWorkspaceWrite`」扩为 `declaresWorkspaceWrite(spec.scope) || environmentScope`，且判据仍是 **Work 自己的等级**（`runLevel` 不被用来放行）。7 种环境形态 × {无授权, 本 Work 授权} = 14 例全拒；`deploy + writePaths` 叠加授权也拒（`exp1` D/F，「不能借 deploy 洗白成写权限」）。
3. **M-2（`assess` 与 `dispatch` 对同一 scope 结论相反）**：两者现在用同一条谓词（`!grantsModificationAuthority(work.level) && (declaresWorkspaceWrite(scope) || touchesRunningEnvironment(scope))`）。我做了**全量差分**：4 种 Work 等级 × 17 种 scope 形态 = 68 例（`exp2`），在 `none` 级上 `assess` 接受集合 = `dispatch` 接受集合 = `{empty, read, search, artifact_write, readPaths}`，**不存在「assess 接受而 dispatch 拒绝」的格**。方向性差异只有两类，且都不是 fail-open：L1 Work 上的带操作 payload 被 `assess` 以「routing rules require L2」拒绝（路由底线，非 Run 边界），L3 `assess` 要求显式授权引用。

**新发现**：R17-01（P3，`assess` 的同一不变式在既有 `none` Work 上连带拒绝「重新评估为写/环境 scope」，未在 DC-71 登记该边界）、R17-02（P3，DC-66/DC-67 仍写四元素 `WORKSPACE_WRITE_OPERATIONS`，与代码相反）、R17-03（P3，`verifyAuthorization` JSDoc 未登记 `artifact_write` 不再为 `writePaths` 背书这一收紧）、R17-04（P3，`assess` 拒绝 details 缺 `environmentScope`，与 `dispatch` 同语义字段不对称）、R17-05（P3，`routing.ts` 环境集合注释未随分类变更更新）。

### 第十六轮条目的当前状态（本轮实跑复核）

| 第十六轮条目 | 本轮裁定 |
|---|---|
| **R16-01**（P2，不阻断）`artifact_write` 计入工作区写操作 ⇒ `none` 级 assist/artifact 无法建立声明该操作的 Run | **完全修好 ✓**：`exp1` A/B（分类划分 + `none` Work 派 artifact_write Run）、`exp4` P5（AC-082 恢复视图对该 Run 成立）；异议主诉闭合 |
| **M-1**（对抗性）`none` Work 可经授权取得环境权限 | **完全修好 ✓**：`exp1` D（14 例全拒）、`exp1` F（deploy 授权不能洗白写权限） |
| **M-2**（对抗性）`assess` 与 `dispatch` 对同一 scope 结论相反 | **修好 ✓，但登记见 R17-01**：`exp2` 68 例差分 0 个 fail-open 格；新门禁对既有 `none` Work 的写 scope 评估产生连带拒绝 |
| **R16-02**（P3）spec 侧声明不交叉核对 | **登记到位 ✓（形态保留）**：DC-63 新增「边界（第十六轮 R16-02）」条目；`exp4` P3 复现 `writePaths + operations:[]` 在授权具备写能力时仍被接受且 `effectiveScope` 原样冻结（方向 fail-closed，已显式登记） |
| **R16-03**（P3）`entities/work.ts` 越界写入 Plan | **修好 ✓**：`plan.md` planVersion 4 明列 `packages/domain/src/routing.ts`、`packages/domain/test/domain.test.ts`、`packages/contracts/src/entities/work.ts`、`packages/contracts/test/entities.test.ts` |
| **R16-04**（P3）`verifyAuthorization` JSDoc 缺能力交叉核对 | **修好 ✓**：JSDoc（`orchestrator.ts:774-779`）现含「a declared path requires the matching read/write operation in the grant」（**残留**：未登记 `artifact_write` 出集合这一收紧，见 R17-03） |
| **R16-05**（P3）domain 分类测试硬编码读操作 | **修好 ✓**：`domain.test.ts:252-266` 用 `...ARTIFACT_WRITE_OPERATIONS`/`...READ_OPERATIONS` 且断言 `classified.size === options.length`；`:243` 新增 `artifact_write ⇒ false` |
| **R16-06**（P3）T22「当前为 248」 | **修好 ✓**：T22 现写「247（该修复提交时点数；`088bdd7` 后为 248，第十五轮修复后为 250）」，与 T23=250、T24=251 及实测 251 自洽 |

---

## 2. 契约命令原始结果（本轮实跑）

执行方式：`export PATH="$HOME/.local/bin:$PATH"`，在仓库根目录按序执行，日志 `/tmp/wp02r17/cmds.log`。

| 命令 | 退出码 | 原始结果要点 |
|---|---|---|
| `pnpm typecheck` | **0** | `tsc -p tsconfig.json --pretty false`，无输出 |
| `pnpm lint` | **0** | `node scripts/lint.mjs`：`Checking formatting...` / `All matched files use Prettier code style!` |
| `pnpm test:unit` | **0** | `Test Files 17 passed (17)` / **`Tests 251 passed (251)`** / `Duration 2.60s`（与 T24 声称的 251 及提交信息一致；`orchestrator.test.ts` 45 条、`domain.test.ts` 31 条） |
| `pnpm test:integration` | **0** | `Test Files 10 passed (10)` / **`Tests 124 passed (124)`** / `Duration 32.77s` |
| `pnpm docs:check` | **0** | `docs:check ok — 15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages` |
| `pnpm build` | **0** | `packages/{contracts,domain,storage,core,pi-runtime}`、`apps/{cli,runner}` 共 7 个 workspace `build: Done` |
| `git status --porcelain` | — | 复核开始、每组实验后、全部契约命令后、本报告写入前均**无输出**（干净） |
| `git rev-parse HEAD` | — | `3dc12dbb9ade8022d60063cb854fca5da711c6ab`（= 冻结点） |

**自建实验（观察值记录；标记 `FAIL` 的断言即 Finding 证据）：**
`exp1`（分类划分 + `none` Work 写/环境/Artifact 三维门禁 + `assess` 一致性 + L2 对照）**56 passed / 0 failed / 1 info**；`exp2`（4 等级 × 17 scope 的 assess↔dispatch 差分矩阵）**3 / 0（13 INFO，全部为已知方向性差异）**；`exp3`（R15-01 能力交叉核对 × 3 维度 × 12 授权能力 + 操作覆盖）**56 / 0**；`exp4`（对抗性：洗白路径、授权引用、R16-02 边界、消费者与记录一致性、AC-082 恢复）**10 / 0（4 INFO）**；`exp5`（details 形状、记录字符串、`none` Work 评估三态）**4 / 0（9 INFO）**。脚本与日志存 `/tmp/wp02r17/{fixture,lib,exp1..exp5}.mjs` 与 `cmds.log`；全部使用 `pnpm build` 后的 `packages/*/dist`，通过 `/tmp/wp02r17/node_modules/@agentdev/*` 软链解析，**不 import 任何产品测试文件**。

---

## 3. 逐条复核表

### 3.1 异议三项（第十六轮对抗性核验）

| 主张 | 本轮实测证据（脚本/观察值） | 判定 |
|---|---|---|
| **R16-01** `artifact_write` 计入工作区写操作 ⇒ `none` 级 assist/artifact 路线无法派发写自己 Artifact 的 Run（与 `execution.md:21/:53`、`workflow.md:11` 相反） | `exp1` A：`WORKSPACE_WRITE_OPERATIONS = ['edit','write','git']`、`ARTIFACT_WRITE_OPERATIONS = ['artifact_write']`、四类并集 = 12 契约取值（不重不漏）；`exp1` B：`none` Work 上 `['artifact_write']` 与 `['read','artifact_write']` 的 Run 接受（`workId` 正确、`effectiveScope.operations` 冻结为声明值）；`exp1` F：L2 Work 同样接受；`exp4` P5：该 Run 的 AC-082 恢复视图可取回且哈希与 Run 行一致；`domain.test.ts:243` 断言 `artifact_write ⇒ false` | **完全修好 ✓** |
| **M-1** `none` Work 可经授权取得环境权限派 L3 Run | `exp1` D：`deploy`/`bash`/`delete_data`/`push`/`secret`/`network`/`networkTargets` 7 形态 × {无授权, `NONE_DEPLOY_AUTH`} = 14 例全部 `NOT_AUTHORIZED`；`none` Work 的 `git` 授权同样不能放行 `git`；`exp1` F：`deploy + writePaths` + 授权仍拒（门禁判 Work 等级，非派生 `runLevel`） | **完全修好 ✓** |
| **M-2** `assess` 与 `dispatch` 对同一 scope 结论相反 | `exp2`：`none` Work 上 assess 接受集合 = dispatch 接受集合 = `{empty, read, search, artifact_write, readPaths}`（逐格一致）；`exp1` E：10 个 scope 形态两条边界同向；`orchestrator.test.ts:759-822` 的端到端断言与我的观察一致 | **修好 ✓（连带拒绝见 R17-01）** |

### 3.2 R15-01 能力交叉核对是否仍成立（本轮实跑）

| 声明维度 | 授权能力集合中可背书者（实测） | 拒绝者（实测） |
|---|---|---|
| `writePaths`（信封覆盖） | `edit`、`write`、`git` | 其余 9 个（含 **`artifact_write`**） |
| `readPaths`（信封覆盖） | `read`、`search` | 其余 10 个 |
| `networkTargets`（目标在授权 scope 内） | `network` | 其余 11 个（`networkTargetsWithoutGrant`） |
| `scope.operations` ⊆ 授权 `operations` | 恰为授权中列出的操作 | 其余（`uncoveredOperations`） |

`exp3` 共 56 例断言 0 失败：`writePaths` 的合法背书者从第十六轮的 4 个（`edit`/`write`/`artifact_write`/`git`）收紧为 **3 个**（`artifact_write` 现在与 `read`/`deploy` 一样被拒，details `capabilityGaps:['writePaths without a write operation']`）；第十六轮的原始负例（只读授权 + 覆盖写路径 ⇒ `NOT_AUTHORIZED`）与 `git` 背书写路径仍成立。**结论：R15-01 未回退，其判定集合随分类变更正确收紧。**

### 3.3 关联验收回归（AC-043/044/045/046/047/082）

`c695fcc` 只改 `packages/core/src/orchestrator.ts`、`packages/domain/src/routing.ts` 与两个测试文件（`git show --stat c695fcc`），未触碰 `StageGate`/`JoinCoordinator`/`RunLifecycle`/快照层。本轮 `pnpm test:unit` 251 与 `pnpm test:integration` 124 全绿；`exp4` P5 对新增的 `artifact_write` Run 复算了 AC-082 的窄范围恢复（`effectiveScope` 与 `dispatchSnapshot.hash` 与 Run 行一致）；`exp2` 显示 L2/L3 的派发与评估边界未变。**未发现关联验收回归。**

---

## 4. 新 Findings（R17-01..R17-05）

### R17-01 [P3] `assess` 的新不变式连带拒绝「既有 `none` Work 被重新评估为写/环境 scope」，而该边界未在 DC-71 登记

- **位置**：`packages/core/src/orchestrator.ts:255-272`（`assess` 的 `!grantsModificationAuthority(work.level) && (declaresWorkspaceWrite(payload.scope) || touchesRunningEnvironment(payload.scope))` ⇒ `VALIDATION_ERROR`）；对照 `docs/architecture/data.md:55`（`Assessment` 结构含 `scope`）、`.agentdev/work/WP-02/discovery.md:269-274`（DC-71 只登记 `dispatch`/`assess` 两条不变式，未登记「既有 Work 重新评估」这一副作用）、`docs/rules/workflow.md:17`（「升级保持同 Work 和已有证据」）、`docs/architecture/data.md:22`（`work | … level:none/L1/L2/L3 …`）。
- **事实（`exp2`/`exp5` 实跑）**：
  - `none` Work + `intent:'delivery'`/`level:'L2'` + `scope:{operations:['edit'],writePaths:['packages/core/src']}` ⇒ `VALIDATION_ERROR: Work … is none and cannot declare a write or environment scope`；同 payload 去掉 `scope` 后 **接受**（`level:'L2'` 落库）。因此路由结论本身仍可记录，只是**必须省略 scope**；
  - 同一 Work 的 `dispatch` 在评估被拒后仍以旧结论（`none`）拒绝写 scope（这是既有行为，非本轮引入）；
  - `packages/*/src` 中 `works.update`/`works.insert` 的调用点数量为 **0**（`exp4` P4c），即 `work.level` 在创建后没有任何回写路径；DC-63/DC-66 已把该回写登记为 WP-04/WP-05 承接项。
- **影响**：`assess` 是记录**新**路由结论的接口，但它用**旧**的 `work.level` 做硬门禁，于是「先 assist、后改口做 delivery」的既有 Work 在带完整（文档形状）载荷时会被拒；错误消息指向一个调用方无法修改的字段（Work 等级无写入路径）。方向 fail-closed，且存在零成本绕行（省略 scope），故不判阻断；但它把「`none` Work 的重评估」锁成「不能带写/环境 scope」，属应由 WP-06（等级升级）承接的语义，宜显式登记而不是隐含在代码里。
- **建议**：(a) 在 DC-71 补一句「该门禁判据是 Work **当前**等级，因此在 `work.level` 可回写（WP-06）之前，既有 `none` Work 的写/环境 scope 评估会被拒；路由结论可在省略 scope 时记录」；(b) 由 WP-06 决定升级路径是「先回写 Work 等级、再带 scope 评估」还是「评估本身就是升级入口」，并同步 `data.md` 的 `Assessment.scope` 语义（该字段当前不落库，DC-60）。

### R17-02 [P3] DC-66/DC-67 仍写四元素 `WORKSPACE_WRITE_OPERATIONS`，与 `c695fcc` 后的代码相反

- **位置**：`.agentdev/work/WP-02/discovery.md:246`（DC-66 第 1 条：「命中 `WORKSPACE_WRITE_OPERATIONS = ['edit','write','artifact_write','git']`」）与 `:254`（DC-67：「`WORKSPACE_WRITE_OPERATIONS = ['edit','write','artifact_write','git']`」）；对照 `packages/domain/src/routing.ts:179-186`（实际为 `['edit','write','git']`）与 `:196-198`（`ARTIFACT_WRITE_OPERATIONS`）。
- **事实（`exp5` 实读 + 逐行定位）**：两处字符串在 `c695fcc` 中未被更新；同一提交新增的 DC-71（`discovery.md:271`）写的是正确三元素集合，因此同一文件内自相矛盾。
- **影响**：DC-66/DC-67 是本包「Run 建立边界」的实现事实源；后续 WP-04/WP-06 若按 DC-66 第 1 条实现工具层判权，会把 `artifact_write` 当工作区写操作，重新引入第十六轮异议。这与第十五轮 R15-04、第十六轮 R16-06 属同一族（「声称集合/声称数 = 实测」核对手段失效），按 `workflow.md` §6 属记录缺陷，不影响运行行为。
- **建议**：把两处改为 `['edit','write','git']`，并各加半句「`artifact_write` 归 `ARTIFACT_WRITE_OPERATIONS`，见 DC-71」，避免第二份集合副本继续漂移（或直接指向 `routing.ts` 的常量而不复写值）。

### R17-03 [P3] `verifyAuthorization` JSDoc 未登记「`artifact_write` 不再为 `writePaths` 背书」这一收紧

- **位置**：`packages/core/src/orchestrator.ts:768-783`（JSDoc 现含「a declared path requires the matching read/write operation in the grant」，但未说明工作区写能力集合已不含 `artifact_write`）；对照 `.agentdev/work/WP-02/discovery.md:229-232`（DC-63 的能力交叉核对只写「命中文档所述写操作」，未列集合成员）。
- **事实（`exp3` 实跑）**：同一个「授权 `['artifact_write']` + 信封覆盖写路径 + spec 声明该写路径」的请求，第十六轮**接受**、本轮**拒绝**（`capabilityGaps:['writePaths without a write operation']`）。这是一次真实的行为收紧，且只体现在常量变化上，JSDoc/DC-63/§5 观察都未记录。
- **影响**：维护者按 DC-63 读会以为 `writePaths` 的背书集合仍是四元素；WP-04 接线（授权 → 工具）时可能按旧集合实现而放行 `artifact_write` 背书的仓库写范围。属 R16-04/R15-04 同族（注释/记录范围小于实现变化）。
- **建议**：JSDoc 与 DC-63 各补一句「工作区写能力 = `WORKSPACE_WRITE_OPERATIONS`（`edit`/`write`/`git`）；`artifact_write` 不再是路径写能力的背书者（第十六轮 R16-01 后的收紧）」。

### R17-04 [P3] `assess` 的拒绝 details 缺 `environmentScope`，与 `dispatch` 同语义字段不对称

- **位置**：`packages/core/src/orchestrator.ts:262-271`（assess details = `{workId, workLevel, writePaths, operations}`）与 `:393-404`（dispatch details = `{workId, workLevel, runLevel, writePaths, operations, environmentScope}`）。
- **事实（`exp5` 实读）**：同一条不变式被拒时，`dispatch` 返回 `environmentScope:true`，`assess` 不返回该键；两侧 `operations` 都是 scope 声明列表（键名相同，与 DC-63 的 `Authorization.operations` 维度不同源）。
- **影响**：WP-04 若按 details 渲染「为什么被拒」，`assess` 侧无法区分「写范围」与「环境范围」；不影响判定本身。属最小可观测性缺口。
- **建议**：`assess` details 增加 `environmentScope`（同一谓词结果）；或在 DC-71 登记 details 形状是「实现级、不保证对称」。

### R17-05 [P3] `routing.ts` 的集合注释未随分类变更更新

- **位置**：`packages/domain/src/routing.ts:151-160`（`ENVIRONMENT_OPERATIONS` 的文档块仍写「`git`, `edit`, `write` and `artifact_write` stay out: they act on the local workspace」——把 Artifact 写入与跟踪文件写入并列在同一理由下）；`:172-178`（`WORKSPACE_WRITE_OPERATIONS` 的文档块只描述「modify tracked files」，未提 `git` 的 ref 语义与 `artifact_write` 的新归属）。
- **事实（实读）**：`artifact_write` 现在写在 `routing.ts:188-195` 的独立文档块里（理由正确），但环境集合的文档块仍以旧措辞把它与 `edit`/`write` 合述，读者从 `:151-160` 得到的印象与 `:179-198` 的分类不一致。
- **影响**：纯注释；不影响行为（分类由常量与测试守卫）。
- **建议**：`:157` 的列举改为「`git`, `edit`, `write` stay out (local workspace writes) and `artifact_write` stays out (the Run's own Artifact; see below)」，并在 `:172-178` 补一句集合成员的判据来源。

---

## 5. 其它观察（不计入 Finding 编号）

1. **`none` Work 的 Artifact Run 不携带任何授权背书**：`exp4` P2/`exp5` 显示，只有主动引用一张 `operations:['artifact_write']` 的授权时才会做覆盖面核对（错误授权被拒）；不带引用时 `effectiveScope.operations:['artifact_write']` 来自 spec 自身声明，无授权实体背书。这是 DC-63+R16-02 的既定边界（工具层按 `operations` 判权、路径写范围仍由 `writePaths` 门禁把守），方向 fail-closed，沿第十六轮 §5 记录。
2. **`git` 仍可为任意覆盖路径的写范围背书**（`exp3`）：`git` 与 `edit`/`write` 在授权语义上并不同质；沿第十五/十六轮 §5 的产品待决项。
3. **`Authorization.operations` 与 `Authorization.scope.operations` 双列表仍并存**（DC-63 已声明能力取自前者），沿第十二/十三/十五/十六轮待决项。
4. **`assess` 的 `goal`/`scope` 仍不落库、不落事件**（DC-60）：本轮 R17-01 的绕行（省略 scope）之所以无副作用，正是因为它本来就被丢弃；这让「评估带 scope」变成一种只有门禁意义、没有记录意义的输入，建议与 R17-01 的建议 (b) 一并定性。
5. **L1 Work 上带操作的 payload 被 `assess` 以「routing rules require L2」拒绝而 `dispatch` 接受**（`exp2` 的 12 条 INFO）：属路由底线与 Run 边界的既定非对称（`assess` 不是 Run 边界，DC-66 第 4 条），方向 fail-closed，未判缺陷。
6. **磁盘/索引状态**：`docs/INDEX.md` 的「实现起点」仍只结算到 WP-01，未声称 WP-02 已实现（正确）；根目录 `cmds.log` 未被跟踪，不构成记录不一致。
7. **产物归属**：修复提交 `c695fcc` 与第十六轮评审报告提交 `3dc12db` 分离，符合「Review 产物与开发提交分离」；`c695fcc` 同时改写了 `discovery.md`/`implementation.md`/`plan.md`（属开发记录范围），本轮我只读未改。

---

## 6. 剩余风险（未闭环，供 Test/Settlement 与产品方判断）

1. **R17-01（新增，P3）**：`assess` 对既有 `none` Work 的写/环境 scope 评估连带拒绝；绕行是省略 scope。需在 DC-71 登记，并由 WP-06（等级升级）决定 `work.level` 回写路径；在此之前「assist → delivery 改口」的评估形态与文档形状不一致。
2. **R17-02..R17-05（新增，P3）**：DC-66/DC-67 陈旧集合、`artifact_write` 背书收紧未登记、details 不对称、集合注释未更新。
3. **`none` Work 的 Artifact 产出仍无授权实体背书**（§5.1，沿 R16-02/DC-63 边界）：WP-04/WP-07 接线时需确认工具层是否只认冻结的 `effectiveScope.operations`，以及 Artifact 写入是否需要独立的路径授权。
4. **授权语义的悬置项**：`Authorization.operations` 与 `scope.operations` 优先级（§5.3）；L1/L2 写范围是否必须绑定授权（沿第十六轮 §5.5）；`git` 跨能力背书（§5.2）。
5. **DC-66 明确推迟的项**：授权 `acceptedAt`/来源消息核对、`once` 类授权消费记账、`work.level` 回写（`works.update` 生产调用点仍为 0，本轮实测确认）。
6. **DC-70 承接项**：`config.policy.l3Paths`/`l3Keywords` 公开可配但无判定语义。
7. **测试缺口（本轮缩小）**：251 条单测已覆盖「`none` Work × `artifact_write` Run」「`assess`/`dispatch` 同 scope」「分类完备性」；仍无「既有 `none` Work 被重评估为写 scope」（R17-01）、「spec 声明 `writePaths` 而 `operations` 不含写操作」（R16-02 边界）的显式正例/反例。
8. **并发未验证**：预算准入检查与事务内 `reserve` 之间的窗口（沿前几轮）；`timed_out`/`interrupted`/`recovery_required` 终态无产生路径、`onChildSettled` 无生产调用方、`Work blocked(provider)` 投影属 WP-05。
9. **待产品方决定项**（沿前轮继续有效）：DC-64（风险旗标词表是否升为契约枚举）、DC-60（`Assessment.goal`/`scope` 是否落库，与 R17-01 耦合）、DC-27/RE-06（快照 `:ID` 与哈希并存）、DC-46（`dispatch` 不校验 `work.status`）、第十二轮 §5.4（lockdown 门禁是否严格限于 delivery/document）、R14-05（`l3Paths`/`l3Keywords` 目标语义）、第十五轮 §5.1（`none` Work 是否允许只读 git）。
10. **`capabilityGaps` 的协议可见性**：details 键未在 `protocol.md` §7 定义；WP-04 接线时需确认 `details` 是否透出给客户端（沿第十六轮 §6.6）。

---

## 7. 方法与边界声明

- 本报告只依据仓库文件、`3dc12db`/`c695fcc` 上的 git 对象/差异与实跑命令；未读取任何开发对话、未引用外部同名技能或历史方案。
- 阅读深度：`packages/core/src/orchestrator.ts` 全文件逐行（重点 `:239-344`、`:354-549`、`:756-879`）；`packages/domain/src/routing.ts` 全文件；`packages/contracts/src/primitives.ts`（`:100-150`）与 `entities/work.ts`（`:113-141`）、`entities/structures.ts`（`:34-46`）；`packages/core/test/orchestrator.test.ts`（`:1-450`、`:680-870`）与 `packages/domain/test/domain.test.ts`（`:228-266`）；`docs/architecture/execution.md` §1-§7 通读、`data.md`（`:20-24`、`:55`）；`docs/rules/workflow.md` §1/§2；`docs/delivery/implementation.md` WP-02 与 `acceptance.md`（AC-043..047、AC-082）；`.agentdev/work/WP-02/{plan,discovery,implementation,review}.md` 全部记录通读；`packages/core/src` 其余文件按注释声称与关键分支抽查（`run-lifecycle.ts`/`stage.ts`/`join.ts` 未在本提交差异内，只做回归定位）。
- 覆盖的手段：静态逐行核对 + 「注释/记录/提交信息 vs 代码」对账 + 分类划分与三维门禁真值表（`exp1`）+ **4 等级 × 17 scope 的 assess↔dispatch 全量差分**（`exp2`）+ 能力×维度背书矩阵（`exp3`）+ 对抗性洗白/授权引用/R16-02 边界/AC-082 恢复（`exp4`）+ details 与记录字符串核对（`exp5`）。
- 唯一写入文件为本文件 `.agentdev/work/WP-02/review.md`；实验脚本与日志独立写在 `/tmp/wp02r17/`（`fixture.mjs`、`lib.mjs`、`exp1..exp5.mjs`、`cmds.log`），使用 `pnpm build` 产出的 `packages/*/dist`，通过 `/tmp/wp02r17/node_modules/@agentdev/*` 软链解析 workspace 包，**不 import 任何产品测试文件**。
- 未修改产品代码、测试、`docs/**`、`plan.md`、`implementation.md`、`discovery.md`；`pnpm build` 只写 `.gitignore` 中的 `dist/`。写入本报告前 `git status --porcelain` 无输出、`HEAD=3dc12dbb9ade8022d60063cb854fca5da711c6ab`。
