# WP-04 独立 Review 报告（第三轮）

- 评审对象：工作包 WP-04「知识与新旧项目」（`docs/delivery/implementation.md` WP-04；关联 AC-025–029、AC-037–040、AC-042、AC-086–088、AC-092、AC-093）
- 评审轮次：**第三轮**（本轮报告置于文件前部；第一轮报告保留为 **附一**、第二轮报告保留为 **附二**，二者原文逐字未改）
- 冻结点 / 代码树：`git rev-parse HEAD` = **`f80092fe32ac608bae5645ed502ae779c17bfb56`**（`f80092f docs(review): WP-04 independent review report, round 2 (FAIL)`），`git rev-parse HEAD^{tree}` = **`d05c38ab1260e8ac732daf53f130b92f67273d81`**
- 被评审的修复提交：**`fd26662dd1f5701089a288ef6accdf4170af1441`**（`fd26662 fix(workspace): a budget-limited scan is not an empty project`），其代码树 = **`6c31365c351b18118d7569783b1933c31ce17bb0`**
- 冻结点与修复点的差异：`git diff --stat fd26662 HEAD` = **仅 `.agentdev/work/WP-04/review.md`（+214 行，第二轮报告）**；即 `HEAD` 相对 `fd26662` 无源码/测试/文档变化，本轮评审的代码面等价于 `fd26662`；`git status --porcelain` 在全部契约命令与全部探针执行前后均为空
- 评审角色：Review（独立上下文；未读取任何开发/Test 会话与聊天记录；`.agentdev/work/WP-04/test.md` 尚不存在；仅依据仓库代码、`docs/**` 契约、WP-04 的 `plan.md`/`implementation.md`，以及我自建的 `/tmp/wp04r3/` 脚本与本仓库既有测试的运行结果）
- 工具：`node v24.8.0`、`pnpm 12.3.4`、真实 `git`、macOS 宿主；探针只消费 `pnpm build` 产物（`packages/workspace/dist/index.js`、`packages/knowledge/dist/index.js`），**未 import 任何产品测试文件**
- 修复提交范围核对（`git show --stat fd26662`）：6 文件 / +328 −16，全部落在 `packages/knowledge/**`、`packages/workspace/**`、`.agentdev/work/WP-04/**`；`docs/**`、`packages/contracts/**`、`packages/storage/**`、`webui/**`、`docker/**` 零改动（符合 `plan.md` §2 的不可写清单）
- 记录哈希（`git hash-object`，前 8 位，**`fd26662`/`HEAD` 状态**）：`packages/workspace/src/initialize.ts` **`b45a3a93`**（二轮 `fdbfdc4` 未改此文件）、`packages/workspace/src/scan.ts` **`518230c0`**（二轮 `e173da55`）、`packages/knowledge/src/projection.ts` **`1b69f9eb`**（二轮 `9688f16b`）、`packages/knowledge/src/feature-format.ts` **`e1d4f758`**（二轮未变）、`packages/workspace/test/initialize.test.ts` **`7f43f95e`**、`packages/knowledge/test/projection.test.ts` **`a10ece03`**、`.agentdev/work/WP-04/implementation.md` **`ea167745`**、`.agentdev/work/WP-04/plan.md` **`a78655b0`**（未变）

---

## 1. 结论

**PASS（`fd26662` 可进入独立 Test；本轮判 0×P0、0×P1、3×P2、5×P3）。**

第二轮唯一阻断项 **W4R2-01（部分地图零能力被当成明确空项目并静默 Ready）经本轮独立取证确认已闭合**：默认预算下的 41 包 monorepo 现在稳定停在 `blocked/investigation-budget`（错误码 `MISSING_CONTEXT`），不再 Ready、不再写 `absent（未实现，明确空项目）`；两条新增处置路径（`investigateMore` 扩大批次、`confirmNoCapability` 显式确认）均可用且**不会自行通过**；一轮的全部正向形状（根级 `README+main.ts`、`README+main.py+test_main.py`、仅 `README.md`、空目录、仅根级 `main.ts`、嵌套 `src/mod.ts`）与 AC-025 空项目、AC-028 脏工作区处置仍全部成立；二轮的 P2/P3 修复（`ROOT_MODULE_KEY='(root)'`、`moduleKeyOf` 收紧为 `string`、`firstSentence` 跳过缩写句点）逐项复核成立。因此本轮无阻断项。

但本轮在被修复点**新增的两个 API 及其调用边界上**发现 **3 项 P2 + 5 项 P3**（均为非阻断，须登记并由开发轮处置）：

- **W4R3-01 [P2]**：对 Ready（已有能力）记录调用一次被拒的 `confirmNoCapability`/`investigateMore`，会把记录持久写成 `failed/internal`（`recoverable:false`），此后 `step`/`resume` 均返回 `INVALID_STATE`、`verifyReady` 不通过，**无任何 API 可恢复**，只有重新 `start` 新 id；磁盘产物未变、无数据损坏，但「一次非法请求即永久摧毁 Ready 状态」属 `reliability.md` §1「先校验后更新」与 `protocol.md` 错误表语义（`VALIDATION_ERROR` 表示修正输入后可重试）的反例，且与既有承接项 W4R1-04 同族。该 guard 由 `fd26662` 新增（`initialize.ts:1949`、`1987`）。
- **W4R3-02 [P2]**：`investigateMore`/`confirmNoCapability` **无阶段门禁**，可作用在 `ready` 记录上：`investigateMore` 会把已 Ready 的空项目拉回 `mapping→confirming`，重算的候选文档与已写盘内容不再一致，`verifyReady` 报 `candidate-documents-written` 失败，下一步写入撞上 `content-conflict`（与自己的产物冲突）后停在 `failed/writing`——即 Ready 被降级后既无法验证也无法自愈。
- **W4R3-03 [P2]**：`documentRoot` 允许相对路径逃逸。`normalizeDocumentRoot` 只去 `./` 与尾部 `/`（`scan.ts:410`），`documentRoot:'../escape-target'` 会让候选 `PROJECT.md`/`INDEX.md`/Feature 文档**写到项目根之外**的目录（实测 `wroteOutsideRoot:true`、根内 `wroteInsideRoot:false`，且流程正常到达 Ready）。`execution.md` §4 明确「文件工具拒绝相对路径逃逸」，`knowledge.md` §5 把 document-root 固定为项目相对 `docs/agentdev`，故该输入应在 `start` 即被 `VALIDATION_ERROR` 拒绝。

P3 共 5 项：W4R3-04（`investigateMore` 接受更小/相等批次，与「必须给出更大的」文案不符）、W4R3-05（显式确认无能力后写出的 PROJECT.md 仍写「尚不能断言项目为空」）、W4R3-06（Mapping 之前确认无能力 ⇒ 记录自相矛盾 `emptyProjectConfirmed:true`/`emptyProject:false` 并终态 `failed/ready-gate`）、W4R3-07（未解阻断上重复 `step` 使证据账本无界增长：200 次调用 +200 行、持久化 JSON +76 800 字节）、W4R3-08（T10 的 W4R2-05 声称已订正 T8 残余 3 措辞，但该行与修复前逐字相同，声明未落地）。详见 §5。

**正面结论（按证据）**：

- **W4R2-01 闭合**：默认预算 41 包（每包 `README.md` + `package.json`，无代码）→ `scan.partial=true`、`bodyRead=40`、`skipped=42`、`knowledge.emptyProject=false`、`partialWithoutCapability=true`、`features=0`；驱动到 `blocked/confirming`，`blocker.kind='investigation-budget'`、`errors[0].code='MISSING_CONTEXT'`，记录 `emptyProject=false`/`emptyProjectConfirmed=false`/`scanPartial=true`；重复 `step`/`resume` 仍阻断且不改阶段、不写盘；候选 PROJECT.md 写「未调查（预算耗尽的扫描未观察到能力，尚不能断言项目为空）」，**不含 `absent（未实现，明确空项目）`**。二轮 `probe3-realistic.mjs` 的三条「缺陷形状断言」本轮全部翻转为失败（M-3/M-4/M-5），正是所期望的反向证据（`/tmp/wp04r3/` 与 `/tmp/wp04r2/probe3-realistic.out` 对照）。
- **两条处置路径可用且 fail-closed**：`investigateMore({maxBodyFiles:200})` 在「能力位于预算之外」的仓库上重跑 Mapping、观察到 1 个真实候选能力（`source_refs` 含 `zzz-late/src/mod.ts`），再经正常确认路径到达 Ready 且 `emptyProject=false`；`confirmNoCapability` 必须携带 `authorizationRef`+`by`（空串 → `VALIDATION_ERROR`），成功后 `emptyProject/emptyProjectConfirmed=true`、写入 `no-capability` 证据行、到达 Ready；`resolveBlocker` 不能顶替它处置预算阻断；`investigateMore({})`/`{maxBodyFiles:0}` 被拒；在无能力仓库上重复 `investigateMore` 5 次从不自确认（下一步必回 `investigation-budget`）。
- **不会回归一轮/二轮正向面**：六种根级/空目录形状仍全部 Ready 且 `verifyReady.ok`；仅 README 与空目录 `emptyProject=true`，含代码形状 `featureCount>0`；只含 README + 二进制/生成物/`node_modules` 的仓库 `partial=false`、仍判为完整空项目并 Ready（修复未把二进制/排除项误当预算耗尽）；索引截断（`maxIndexEntries` 用小预算等价）会阻断但可由 `confirmNoCapability` 解除；确认状态可跨 `createJsonFileInitStateStore` 重启存活，`start` 同 id 幂等且不丢确认、新 id 干净重置；AC-028 脏工作区仍先阻断、`committed` 未提交时拒绝、`authorized` 后用户文件保留且流程完成。
- **二轮 P2/P3 逐项复核成立**：`ROOT_MODULE_KEY='(root)'` 与真实 `root/` 目录端到端产出两个独立模块（`modules=['(root)','root']`），`moduleKeyOf` 对 5 类路径均返回非空 `string`；`firstSentence` 6 例矩阵全部正确（`e.g.`/`i.e.`/`J. Smith`/`v1.2`/`.ts`/无终止符/空串）。

---

## 2. 契约命令原始结果（代码树 `fd26662`，`/tmp/wp04r3/contract.log`）

| 命令 | 结果 | 关键输出 |
|---|---|---|
| `pnpm install --frozen-lockfile` | **exit 0** | `Lockfile is up to date`、供应链策略通过、11 workspace |
| `pnpm typecheck` | **exit 0** | 无诊断 |
| `pnpm lint` | **exit 0** | `All matched files use Prettier code style!` |
| `pnpm docs:check` | **exit 0** | `docs:check ok — 15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages` |
| `pnpm test:unit` | **exit 0** | `Test Files 26 passed (26)`、`Tests 423 passed (423)` |
| `pnpm test:integration` | **exit 0** | `Test Files 10 passed (10)`、`Tests 124 passed (124)` |
| `pnpm build` | **exit 0** | 10 个 workspace 全部 `Done`（contracts/cli/knowledge/domain/pi-runtime/storage/workspace/core/daemon/runner） |

WP-04 自有测试单独重跑（`pnpm exec vitest run --project unit packages/knowledge packages/workspace`）：**7 文件 / 134 用例全部通过**——`relations.test.ts` 11、`feature-format.test.ts` 44、`projection.test.ts` 13、`views.test.ts` 9、`requirements-pool.test.ts` 25、`scan.test.ts` 16、`initialize.test.ts` 16。相对二轮（7 文件 / 131 用例、unit 总数 420）净增 3 例，全部来自 `fd26662`：`initialize.test.ts` +2（预算耗尽必阻断且重复 step 仍阻断；扩大批次后观察能力并走确认到 Ready）、`projection.test.ts` +1（缩写句点），与 `git show fd26662` 的测试差异逐条对应；unit 总数 420→423、integration 仍 124、build 仍 10 workspace，与 T10 记录一致。

integration 层仍**不含任何 WP-04 文件**（`packages/knowledge`、`packages/workspace` 无 `*.integration.test.ts`；10 个文件为 `apps/cli/{container,doctor}`、`apps/runner/attempt`、`packages/core/{dispatcher,events-hub,identity,requirements}`、`packages/pi-runtime/session`、`packages/storage/{ledger,migrations}`）——与 `implementation.md` T9 承接 1（W4R1-03 留 WP-08、Test 须列入 `not_covered`）一致，属已登记承接，非本轮新缺陷。

---

## 3. 方法、证据脚本与回归重跑

### 3.1 本轮自建脚本（全部 `/tmp/wp04r3/`，独立上下文，真实临时目录 + 真实 `git`）

| 脚本 | 用例 | 结果 | 覆盖 |
|---|---|---|---|
| `probe1-closure.mjs` | 36 | **36 pass / 0 fail** | W4R2-01 闭合矩阵：部分扫描的 scan/knowledge 形状、不得 Ready、blocker 种类与错误码、重复 `step`/`resume` 不推进、确认前后磁盘产物、`confirmNoCapability` 与 `investigateMore` 两条路径、AC-025 六形状回归 |
| `probe2-adversarial.mjs` | 29 | **25 pass / 4 fail** | 对抗面：更小批次、缺 id、有能力时的两 API、Ready 空项目上 `investigateMore`、Mapping 之前确认、budgetOverride 持久性、账本增长、脏工作区、`documentRoot` 逃逸、`resolveBlocker` 顶替 |
| `probe3-residual.mjs` | 32 | **25 pass / 7 fail** | 二轮 P2/P3 复核（`(root)` 哨兵与真实 `root/`、`moduleKeyOf`、`firstSentence`）+ 上述缺陷的后续刻画（Ready 记录被写坏后的恢复尝试、自产物冲突、确认后 PROJECT 文案、早确认自相矛盾、账本增长量、脏工作区、绝对 documentRoot） |
| `probe4-boundaries.mjs` | 16 | **16 pass / 0 fail** | 修复的边界：二进制/生成物/排除目录不得把完整扫描变部分、索引截断可阻断且可解、确认状态跨 JSON 存储重启存活、`start` 幂等与新 id 干净重置、重复 `investigateMore` 不自确认 |

**合计 113 例：102 pass / 11 fail；11 处失败去掉重复后收敛为 6 个独立缺陷（§5 的 W4R3-01/02/03/05/06/07）**，其余全为「闭合应成立」的正向断言。另记录 15 条 observation（不影响判定，用于刻画未列为缺陷的瞬态与既有口径）。

### 3.2 二轮脚本回归重跑（`/tmp/wp04r2/`，同一代码树）

| 脚本 | 本轮结果 | 解读 |
|---|---|---|
| `probe1-closures.mjs` | **57 pass / 3 fail** | 3 处失败全部是「断言旧行为」：`moduleKeyOf('main.ts')==='root'`（×2，已被 W4R2-02 刻意改为 `(root)`）、`firstSentence('见 e.g. 示例。')` 断言截断为 `见 e.g`（已被 W4R2-04 刻意修好）。**无意外回归** |
| `probe2-newdefects.mjs` | 失败集中在 A-1/A-2/A-4、B-1/B-3/B-4、C-2、D-3、F-1、F-3 | 全部是二轮缺陷或死代码形状，均已被 `fd26662` 反转/删除；E-1（W4R1-04 用错 API ⇒ `failed/internal`）与 E-2/E-3/E-4（W4R1-05/06 残余）仍复现，与承接登记一致 |
| `probe3-realistic.mjs` | **2 pass / 3 fail**（M-3/M-4/M-5 反转） | 二轮 P1 的原始缺陷形状已消除：41 包默认预算 → `emptyProject=false`、`ready=false`、`blockers=['investigation-budget']`，不再写 `absent`；4 包对照仍产出 4 个能力并停在 `confirmation-required` |

---

## 4. W4R2-01 闭合的独立验证

### 4.1 负例（部分地图 + 零能力）：不再 Ready（`probe1` A1–A12）

41 包（每包 `README.md` + `package.json`，无代码），默认预算：

| 观测点 | 实测 |
|---|---|
| `scanProject` | `partial=true`、`bodyFiles.length=40`、`skippedFiles.length=42`、`unknowns` 含 `budget-body-files` |
| `generateCandidateKnowledge` | `emptyProject=false`、`partialWithoutCapability=true`、`features=0` |
| 初始化终态 | `blocked/confirming`，`blocker.kind='investigation-budget'`，`errors[0].code='MISSING_CONTEXT'` |
| 记录 | `emptyProject=false`、`emptyProjectConfirmed=false`、`scanPartial=true`、`featureCount=0` |
| 重复 `step`/`resume` | 仍 `blocked`、同 blocker；阶段/状态/文档数不变，`blockers` 保持 1 条（`evidence` 增长见 W4R3-07） |
| 候选 PROJECT.md | 含「尚不能断言项目为空」，**不含** `absent（未实现，明确空项目）` |
| 磁盘 | 阻断路径下 `docs/` 根本未创建（`A12`、`E`） |

### 4.2 正例（两条处置路径）：可解但不自解（`probe1` B/C、`probe4`）

- `confirmNoCapability`：空 `authorizationRef`/`by` → `VALIDATION_ERROR`；带授权后 `emptyProject/emptyProjectConfirmed=true`、证据行 `no-capability` 带 `authorizationRef`，驱动到 Ready；此时写出的 PROJECT.md 仍不含 `absent`（措辞问题另见 W4R3-05）。
- `investigateMore`：`{}`/`{maxBodyFiles:0}` 被拒且记录不变（`phase='confirming'`、`budgetOverride=null`、原 blocker 保留）；`{maxBodyFiles:200}` 在「能力在预算之外」的仓库上重跑 Mapping、`featureCount>0`、`budgetOverride` 落库并在后续 `step`/`resume` 保持；随后走正常确认路径 Ready 且 `emptyProject=false`，Feature 文档 `source_refs` 含 `zzz-late/src/mod.ts`。
- `resolveBlocker` 不能顶替处置预算阻断（`VALIDATION_ERROR`，记录仍阻断、未确认）。
- 边界：索引截断型部分地图同样阻断（`investigation-budget`）且可由 `confirmNoCapability` 解除；只含二进制/生成物/`node_modules` 的 README 仓库 `partial=false`，仍按 AC-025 完整空项目 Ready（未被修复误伤）。
- AC-026 附带核对：常规 `README.md` + `src/mod.ts` 仓库到达 Ready 后，候选文档仅 `docs/agentdev/{PROJECT,INDEX,CODE_MAP}.md` 与 `features/**`，`git diff HEAD` 为空、`git status --porcelain` 仅 `?? docs/`（已跟踪代码零改动），且不存在 `.agentdev/requirements`。

### 4.3 AC 逐项核对（本轮直接取证范围）

| AC | 结论 | 本轮证据 |
|---|---|---|
| AC-025 空项目 | **通过** | 空目录与仅 README → Ready、`emptyProject=true`、PROJECT.md 明确空项目；`probe1` D、`probe4` A（二进制/生成物不改变结论） |
| AC-026 旧项目初始化 | **通过（含新回归网）** | `probe1` A/C（预算耗尽显式阻断、扩大后观察能力、代码不移动、无 `.agentdev/requirements`）、`probe3` G/H、`probe4` B |
| AC-028 脏工作区 | **通过** | `probe3` H1–H5：未提交文件先阻断、`committed` 未清空时拒绝、`authorized` 后用户文件保留且流程完成 |
| AC-029 中断/冲突/Ready 门禁 | **通过（新缺陷另记）** | 内容冲突不覆盖与 Hash 恢复由本仓库 unit 套件在本轮重跑通过（`initialize.test.ts`「never overwrites an existing file with different content and requires explicit recovery」「resumes from a JSON-file state store without rewriting already-written documents」）；本轮新发现「重扫自己的产物会撞 `content-conflict`」→ W4R3-02 |
| AC-027/037–040/042/086–088/092/093 | **承接前两轮证据** | 本轮未重复取证；一轮/二轮报告与回归重跑未显示松动（见 §3.2），Test 仍须按二轮 §8.4 的矩阵覆盖 |

---

## 5. Findings（W4R3-xx）

### W4R3-01 [P2] 被拒的 `confirmNoCapability`/`investigateMore` 把 Ready 记录写成 `failed/internal`，不可恢复

- **现象（`probe2` C3、`probe3` C1–C6）**：在一个 `status='ready'`、`featureCount>0` 的记录上调用 `confirmNoCapability`（或 `investigateMore`），返回 `VALIDATION_ERROR`（正确），但实现走的是 `failed(record, {kind:'internal', recoverable:false})`，而 `failed()` 会 `persist({...status:'failed', failure})`（`initialize.ts:1005`）。实测随后：`step` → `failed`/`INVALID_STATE`（`initialize.ts:1551-1563`）、`resume` → `failed`/`INVALID_STATE`（`recoverable=false` 分支）、`verifyReady` → 不通过；再补一次修正输入的调用仍 `VALIDATION_ERROR`（因为 `record.featureCount>0` 依然为真）。**没有任何 API 能把该记录恢复为 Ready**，只能 `start` 一个新 id。磁盘产物与 Hash 未变（`diskUnchanged:true`），故不是数据损坏，而是**一次非法请求永久摧毁 Ready 状态**。
- **定位**：`initialize.ts:1934`（`confirmNoCapability`）与 `1984`（`investigateMore`），`featureCount>0` guard 分别位于 `1949`、`1987`；两处 guard 均由 `fd26662` 新增（`git show fd26662` 中 `+ if (record.featureCount > 0)`）。
- **契约依据**：`reliability.md` §1「校验身份/版本/幂等 → 更新领域行 → …COMMIT」——校验失败不得更新领域行；`protocol.md` 错误表把 `VALIDATION_ERROR` 定义为「修正输入」可重试、把 `INVALID_STATE` 定义为「当前实体状态不允许该操作」；当前实现把前者变成了后者。
- **同族**：与既有承接项 **W4R1-04**（用错处置 API ⇒ `failed/internal`）同一根因；另有既存同型路径：`start` 对「同 id 绑定其它 root/document-root/branch」也走 `failed()` 持久化（`initialize.ts:2090-2114`），以及 `confirm`/`authorizeGitInitialization`/`resolveBlocker` 的阶段错误同样 `failed()`。建议一次性统一：**输入/状态校验失败只返回错误视图，不改写记录状态**。
- **建议修法**：把 guard 改为「返回失败视图但不 `persist` status」，或先判阶段（`phase === 'confirming'` 且当前 blocker 为 `investigation-budget`）并以 `INVALID_STATE` 拒绝且不动状态；补断言「Ready 记录上的一次被拒调用后 `status/phase/failure` 原样不变、`verifyReady` 仍为 true」。

### W4R3-02 [P2] `investigateMore`/`confirmNoCapability` 缺阶段门禁：Ready 项目被降级且无法自愈

- **现象（`probe2` D1–D3、`probe3` D1–D2）**：对一个已 Ready 的「完整扫描 + 明确空项目」记录调用 `investigateMore({maxBodyFiles:999})` 被**接受**：记录被置为 `phase='mapping', status='mapping'` 并清空 `blocked/failure`（`initialize.ts:2020-2035`），重跑 Mapping 时重新渲染候选文档（此时仓库里已有上一轮写下的 `docs/agentdev/*`，扫描输入已变化，Hash 随之变化）。此后 `verifyReady` 报 `candidate-documents-written` 失败（磁盘不一致：`docs/agentdev/PROJECT.md`、`INDEX.md`），继续驱动写入会撞 `content-conflict`（候选与**自己上一轮写下的文件**内容不同，按 fail-closed 不覆盖），终态 `failed/writing`、`recoverable:true` 但 `resolveConflict` 对该自产物冲突无实际出路。
- **定位**：两个 API 只检查 `featureCount`，不检查 `record.phase`/`record.status`；其余写操作（`confirm`、`authorizeGitInitialization`、`resolveBlocker`、`confirmNoCapability` 的语义前提）都隐含阶段约束。
- **影响**：Ready 是初始化状态机的终态，产品语义上不应被「再调查」降级；一旦发生，投影与磁盘产物失配且无法自动恢复，只能人工清理 `docs/agentdev` 后重来。
- **建议修法**：对 `phase === 'ready'`（或 `status === 'ready'`）直接以 `INVALID_STATE` 拒绝（且不改状态，见 W4R3-01 的同一修法）；若产品确需「Ready 后重新调查」，须设计为显式的新一轮（重写产物 + 原子替换 + Hash 复核），不能在原记录上原地重扫。

### W4R3-03 [P2] `documentRoot` 允许相对路径逃逸，候选文档写到项目根之外

- **现象（`probe2` H1/H2）**：`start({id, root, documentRoot:'../escape-target'})` → 记录 `documentRoot='../escape-target'`，候选文档 `path='../escape-target/PROJECT.md'`、`INDEX.md`；写入阶段 `join(root, document.path)` 解析到**项目根的父目录**，实测 `wroteOutsideRoot:true`、`wroteInsideRoot:false`，且流程正常到达 Ready、`verifyReady` 通过，全程零诊断。
- **定位**：`normalizeDocumentRoot`（`scan.ts:410`）只做 `\\→/`、去开头 `./`、去尾部 `/`，不拒绝 `..` 段、不校验是否落在 root 内；`candidateDocument`（`scan.ts:1179`）直接拼 `"${documentRoot}/${documentPath}"`；写入用 `join(next.root, document.path)`（`initialize.ts:1383`）。**绝对路径** `documentRoot='/tmp/...'` 因 `join` 语义被拼进 root（`<root>/tmp/...`）而未逃逸（`probe3` I1/I2），故缺口仅限 `..`。
- **契约依据**：`execution.md` 运行隔离：「文件工具拒绝相对路径逃逸、符号链接逃逸、嵌套仓库逃逸」；`knowledge.md` §5 将 document-root 固定为 `docs/agentdev`；`data.md` 中 `documentRoot:Path` 为项目内路径。
- **影响**：初始化会在用户指定的任意相对位置创建 `PROJECT.md`/`INDEX.md`/Feature 目录（不覆盖同名不同内容文件，仍属越界写），并把该越界路径持久化进项目记录供后续投影使用。
- **建议修法**：`start`（以及 `scanProject`）校验 `documentRoot` 规范化后不得含 `..` 段、不得绝对、`resolve(root, documentRoot)` 必须仍在 `root` 内，否则 `VALIDATION_ERROR`；补断言「`../x` 与绝对路径均被拒绝且不产生任何写盘」。

### W4R3-04 [P3] `investigateMore` 接受更小/相等批次，与「必须给出更大的」文案不符

- `positive()`（`initialize.ts:1994`）只要求 `>0`。`probe2` A1：默认预算 40 时 `investigateMore({maxBodyFiles:1})` 被接受，`budgetOverride={maxBodyFiles:1}`，重扫 `正文 1 个 / 19 字节（partial）`。行为安全（A2/A3/A4：仍未 Ready、下一步仍 `investigation-budget`、从不自确认），但报错文案「扩大调查批次必须给出更大的 maxBodyFiles 或 maxBodyBytes」与实现相反，且一个手误的小数字会静默让地图更小。建议要求严格大于当前生效预算，或改文案为「给出新的正数批次」。

### W4R3-05 [P3] 显式确认无能力后，写出的 PROJECT.md 仍写「尚不能断言项目为空」

- `probe3` E1：41 包部分扫描 → `confirmNoCapability` → Ready，记录 `emptyProject=true`、`emptyProjectConfirmed=true`、`scanPartial=true`，但磁盘 `docs/agentdev/PROJECT.md` 的「实现状态」= `未调查（预算耗尽的扫描未观察到能力，尚不能断言项目为空）`。原因是候选文档在 Mapping 阶段一次性渲染（`scan.ts:1417-1421` 的三分支只看 `emptyProject`/`scanPartial`），确认后未重渲染，而 `confirmNoCapability` 只改记录字段（`initialize.ts:1966-1980`）。
- 本轮要求只到「**未确认时不得写 absent**」（已满足，`probe1` A11、`probe3` E2），故此条为记录/投影与用户决定不一致的 P3；建议确认后以记录为准重渲染 PROJECT（`实现状态：absent（未实现，已由用户明确确认）` 之类），或把该行改为写盘时按记录计算。

### W4R3-06 [P3] Mapping 之前确认无能力 ⇒ 自相矛盾状态 + `ready-gate` 失败

- `probe3` F1/F2：`confirmNoCapability` 在 `phase='identifying'` 即被接受（同样缺阶段门禁），置 `emptyProject/emptyProjectConfirmed=true`；随后 Mapping 用 `emptyProject: knowledge.emptyProject` 覆盖为 `false`（`initialize.ts:1114`），却保留 `emptyProjectConfirmed`。终态：`failed/writing`、`failure.kind='ready-gate'`、错误 `GATE_NOT_READY: feature-or-empty-project`，记录 `emptyProject=false` + `emptyProjectConfirmed=true` + `scanPartial=true`，磁盘已写入候选文档。用户的授权被记录（证据行 `no-capability`）但不产生任何效果。
- 与 W4R3-01/02 同根因（缺阶段门禁）。建议确认只在 `phase='confirming'` 且 blocker 为 `investigation-budget` 时接受；若允许提前表达意图，则 Mapping 不得清掉已确认字段。

### W4R3-07 [P3] 未解阻断上重复 `step` 使证据账本无界增长

- `blocked()`（`initialize.ts:976`）每次调用都 `addEvidence(..., 'blocked', message, [])`，只有 `blockers` 数组做了同 kind+message 去重。实测（`probe1` A9、`probe3` G1，JSON 文件存储）：200 次重复 `step()` 后 `evidence` 4→204（+200 行），持久化文件 29 657→106 457 字节（**+76 800 字节**），`blockers` 保持 1。客户端轮询/重试即可无界放大项目记录，且这一增长会进入后续提交与备份。
- 建议：对「同一阶段 + 同 kind + 同 message」的 `blocked` 证据做与 `blockers` 相同的去重（或折叠为 `repeatCount`），并补一条「N 次重复 step 后证据行数不变」的断言。

### W4R3-08 [P3] 记录订正声明未落地：W4R2-05 声称已订正 T8 残余 3，实际该行未变

- `implementation.md:96`（T10 的 W4R2-05）写「T8 残余 3 的措辞随 T9/T10 更新（根级文件现归 `(root)` 模块…）」，但 `implementation.md:63`（T8 残余 3）与修复前提交逐字相同：`git show 9ee1a82:.agentdev/work/WP-04/implementation.md | sed -n 63p` 与 `HEAD` 同行为 **IDENTICAL**。即声明与产物不一致（纯记录问题，行为无影响）。建议真正补上括注（指向 T9 的 `ROOT_MODULE_KEY` 与「其他源文件层」各自适用范围），或改正 W4R2-05 的表述。

### 二轮 P2/P3 与一轮承接项复核（未重新编号）

| 编号 | 复核结论（本轮实测） |
|---|---|
| W4R2-01（P1） | **闭合**（§4；`probe1` 36/0、二轮 `probe3-realistic` M-3/M-4/M-5 反转） |
| W4R2-02（P2） | **闭合**：`ROOT_MODULE_KEY='(root)'`（`scan.ts:85`）；根级 `main.ts` + 真实 `root/` 目录端到端产出 `modules=['(root)','root']` 两个独立能力（`probe3` A1–A6） |
| W4R2-03（P3） | **闭合**：`moduleKeyOf` 返回 `string`（`scan.ts:1090`），5 类路径实测均非空字符串；`null` 死分支与 `?? null` 已删（二轮 `probe2` D-3 反转） |
| W4R2-04（P3） | **闭合**：`SENTENCE_END`（`projection.ts:60`）跳过单字母缩写句点，6 例矩阵全对（`probe3` B） |
| W4R2-05（P3） | **未落地** → W4R3-08 |
| W4R1-03 集成演练 | **记录面闭合**：T9 承接 1 明确留 WP-08 且 Test 须列 `not_covered`；integration 层确无 WP-04 文件（§2 清单），与登记一致 |
| W4R1-04 用错处置 API | **仍可复现**（二轮 `probe2` E-1 重跑）：`confirmation-required` 上调 `resolveBlocker` → `VALIDATION_ERROR` 且记录 `failed/internal`/`recoverable:false`；本轮发现同一根因的两个新入口 → W4R3-01 |
| W4R1-05 版本不校验 | **仍可复现**：`resolveSourceRef('requirement:R-1@99')` → `{ok:true,version:'99'}`；未知 id 仍拒绝 |
| W4R1-06 残余 | **仍可复现**：池根裸 `requirement.json` → `ok=true, errors=0, records=0`；目录符号链接记 `kind:'file'`+`symlink:true`。其 fail-open 面（一级标题）仍闭合 |

---

## 6. 记录与实现一致性核对

| 记录条目 | 核对结果 |
|---|---|
| T10：`emptyProject = features.length===0 && !scan.partial`、新增 `partialWithoutCapability` | 一致（`scan.ts:1299-1300`） |
| T10：新增 blocker `investigation-budget` → 错误码 `MISSING_CONTEXT` | 一致（`initialize.ts:249`、`262`；`probe1` A4/A5） |
| T10：Ready 门禁改为 `featureCount>0 \|\| (emptyProject && emptyProjectConfirmed)` | 一致（`initialize.ts:619-622`；`probe1` A3/A10） |
| T10：新增 `investigateMore`（`budgetOverride`，回 Mapping）/ `confirmNoCapability`（置 `emptyProject+emptyProjectConfirmed`） | 一致（`initialize.ts:1934/1984`；`probe1` B/C、`probe4` C） |
| T10：PROJECT.md 三种措辞（有代码 `partial` / 完整空项目 `absent` / 预算耗尽未确认 `未调查…尚不能断言`） | 一致（`scan.ts:1417-1421`；`probe1` A11、`probe3` E2）；确认后文案未同步 → W4R3-05 |
| T10：W4R2-02/03/04（`(root)`、`moduleKeyOf:string`、缩写句点） | 一致（§4、`probe3` A/B） |
| T10：W4R2-05（T8 残余 3 措辞随 T9/T10 更新） | **不一致 → W4R3-08** |
| T10：`unit 26 文件 / 423 用例`、`integration 124`、`build 10 workspace` | 一致（§2；WP-04 自有 7 文件 / 134 用例单独重跑一致；420→423 与新增 3 例对应） |
| T10：回归网新增 2 + 1 例 | 一致（`git show fd26662` 的测试差异；initialize 14→16、projection 12→13） |
| T9 承接 1–4：W4R1-03/04/05/06 | 一致（§5 复核表；W4R1-03 的 integration 缺席与登记相符） |
| T8 残余 1–6 | 本轮未发现与代码矛盾之处；1/2/4/5/6 属已登记承接 |
| `plan.md` §2 写路径与不可写清单 | 一致：`fd26662` 6 文件全部在允许集合内，`docs/**`、`contracts/**`、`storage/**`、`webui/**`、`docker/**` 零改动 |
| `plan.md` §5 集成演练（真实 SQLite + 临时 Git 端到端） | 仍不落地，但已由 T9 承接 1 显式登记 → 记录面一致 |

---

## 7. 计数与阻断判定

| 严重度 | 数量 | 编号 | 阻断 |
|---|---|---|---|
| P0 | **0** | — | — |
| P1 | **0** | — | — |
| P2 | **3** | W4R3-01、W4R3-02、W4R3-03 | 否（建议结算前修） |
| P3 | **5** | W4R3-04、W4R3-05、W4R3-06、W4R3-07、W4R3-08 | 否 |
| （承接复核） | 5 | W4R1-03（记录面闭合）、W4R1-04（并见 W4R3-01）、W4R1-05、W4R1-06 残余、W4R1-04 新入口 | 否 |

阻断项：**无**。W4R2-01 已闭合，且本轮未在 WP-04 验收面（AC-025–029、AC-037–040、AC-042、AC-086–088、AC-092、AC-093）复现任何 P0/P1。

---

## 8. 能否进入独立 Test —— **能**

理由：第二轮唯一 P1（W4R2-01）在默认预算大仓库与等价小预算形状上均已消除，且两条处置路径完整可用并保持 fail-closed；一轮/二轮全部正向闭合经重跑无意外回归；契约命令 7/7 通过、工作树干净、代码面与 `fd26662` 等价。本轮发现的 3×P2 + 5×P3 均**不阻断**（P2 集中在 `fd26662` 新增的两个 API 与 `documentRoot` 规范化边界，属调用边界与记录质量问题，不影响 WP-04 的验收面判定），但应在结算前登记并对齐：

1. **修 W4R3-01/02（强烈建议，同一修法）**：给 `confirmNoCapability`/`investigateMore` 加阶段门禁，并让「校验失败」不再 `persist` 为 `failed`（可与承接项 W4R1-04 一并统一）；补断言「Ready 记录被拒后状态不变」「Ready 记录不接受重新调查」。
2. **修 W4R3-03（建议）**：`documentRoot` 拒绝 `..`/绝对路径，保证 `resolve(root, documentRoot)` 仍在 root 内；补负例断言。
3. **记录订正（必须）**：`implementation.md` 登记 W4R3-01..08 的处置与承接，保留 W4R1-03..06、W4R2-02..04 的既有登记，并改正 W4R2-05 的声明（或补齐 T8 残余 3 的措辞）。
4. **Test 最小覆盖矩阵（沿用二轮 §8.4，并新增本轮形状）**：AC-025 空目录 + 仅 README +「README + 二进制/生成物」（授权前不建 `.git`）；AC-026 **根级三种形状 + 超预算大仓库（默认预算 41 包）**的对照（代码不移动、无 Requirement、超预算形状须显式阻断且不写 absent；扩大批次后能观察到预算外能力）；AC-027/028/029（无 Git 只读、脏工作区处置、中断按 Hash 恢复、冲突不覆盖、门禁篡改复核）；AC-040 非法知识（不发布 + stale + 断链按当前需求阻断，含「无需求范围不阻断」负例）；AC-086 正负例；AC-042 设计/代码冲突；AC-087/088/092/093 组件级（本地状态 + 真实临时 Git；SQLite/Core/UI 集成按 W4R1-03 归 WP-08 并在 Test 报告 `not_covered`）。建议 Test 额外覆盖本轮 P2 形状（Ready 记录被拒调用、Ready 记录上 `investigateMore`、`documentRoot:'..'`），若开发轮已修则作为回归断言，若未修则列入 `known_issues`。

---

## 9. 方法与边界声明

- 本轮只审阅 `fd26662`（代码面等价于 `HEAD`）的仓库状态，不读取开发/Test 会话；全部结论可由 `/tmp/wp04r3/*.mjs`、`/tmp/wp04r3/*.out`、`/tmp/wp04r3/contract.log` 与 `/tmp/wp04r2/` 的重跑复现。冻结前后 `git status --porcelain` 为空。
- 探针只消费 `pnpm build` 产物，未 import 任何产品测试文件；所有仓库均为真实临时目录 + 真实 `git init/commit`，无 mock 文件系统。
- **覆盖边界（未验证项，Test/后续包需承接）**：`feature_projection` 的 SQLite 落地与交付提交/CAS、需求池保存侧原子提交（WP-08/WP-05）；`GitPort`/`FileSystemPort` 的真实崩溃注入；HTTP/WS 接线（`project.initialize` 等）；真实 Provider 纵向；AC-039 的实际上下文选择接线（WP-05）；`views` 中「不复用旧决策引用」等无独立断言可判定的表述。
- 本轮未做：跨平台/Windows 路径语义、超大仓库（>10 000 索引条目）性能实测（仅以小预算等价验证截断路径）、多进程并发写同一 `InitStateStore`、符号链接逃逸（属 WP-08 扫描器增强，见 W4R1-06 残余）。
- 严重度口径：`docs/rules/workflow.md` §6 —— P0 数据/安全或关键不可用、P1 错误行为/需求缺失、P2 局部质量/维护、P3 建议；**P0/P1 阻断**。W4R3-03 判 P2 的理由：需要调用方显式传入越界 `documentRoot`，本产品为同用户单机自托管、无权限边界可跨越，默认 `docs/agentdev` 不触发，且已存在同名不同内容文件的「不覆盖」保护。

## 文末打印（本轮取证汇总）

- **结论：PASS**（`0×P0`、`0×P1`、`3×P2`、`5×P3`；无阻断项；W4R2-01 闭合）
- 冻结点：`git rev-parse HEAD` = `f80092fe32ac608bae5645ed502ae779c17bfb56`；`git rev-parse HEAD^{tree}` = `d05c38ab1260e8ac732daf53f130b92f67273d81`
- 被评审代码树：`fd26662` → `6c31365c351b18118d7569783b1933c31ce17bb0`（`git diff --stat fd26662 HEAD` = 仅 `review.md` +214 行）
- 报告写入后 `git status --porcelain` 最后一行 = ` M .agentdev/work/WP-04/review.md`
- 契约命令：install/typecheck/lint/docs:check/test:unit/test:integration/build = **7/7 exit 0**（unit 26 文件 423 用例；integration 10 文件 124 用例；build 10 workspace；docs:check 15 文档/55 链接/94 验收用例）
- 证据脚本与用例数（本轮自建）：`probe1-closure.mjs` 36/0、`probe2-adversarial.mjs` 29 例（25 pass / 4 fail）、`probe3-residual.mjs` 32 例（25 pass / 7 fail）、`probe4-boundaries.mjs` 16/0 = **113 例、102 pass / 11 fail，收敛为 6 个独立缺陷（W4R3-01/02/03/05/06/07）**
- 二轮脚本重跑（回归）：`probe1-closures.mjs` 57/3（3 处均为旧行为断言）、`probe2-newdefects.mjs` 失败集中在已修缺陷/死代码形状（E-1/E-2/E-3/E-4 承接项仍复现）、`probe3-realistic.mjs` 2/3（M-3/M-4/M-5 为期望的缺陷反转）
- 二轮 P2/P3 复核：W4R2-02/03/04 **闭合**；W4R2-05 **未落地**（→ W4R3-08）；一轮承接 W4R1-03 记录面闭合、W4R1-04/05/06 仍复现

---

## 附二：第二轮报告（保留）

# WP-04 独立 Review 报告（第二轮）

- 评审对象：工作包 WP-04「知识与新旧项目」（`docs/delivery/implementation.md` WP-04；关联 AC-025–029、AC-037–040、AC-042、AC-086–088、AC-092、AC-093）
- 评审轮次：**第二轮**（本轮报告置于文件前部；第一轮报告逐字保留为 **附一**，未做任何改写）
- 冻结点 / 代码树：`git rev-parse HEAD` = **`479d07bc965354f326b9415347eacf38ee9644b3`**（`479d07b docs(review): WP-04 independent review report, round 1 (FAIL)`），`git rev-parse HEAD^{tree}` = **`bb4e8a3f9fe56a728287573e867623e633ae7051`**
- 被评审的修复提交：**`fdbfdc4d6bb4c17c285de21a8decf6f1292bf148`**（`fdbfdc4 fix(workspace,knowledge): root-only projects reach Ready and summaries keep dots`），其代码树 = **`13fa9de496581766f089d78aa8df80f2dfed2873`**
- 冻结点与修复点的差异：`git diff --stat fdbfdc4 HEAD` = **仅 `.agentdev/work/WP-04/review.md`（+205 行，第一轮报告）**；即 `HEAD` 相对 `fdbfdc4` 无源码/测试/文档变化，本轮评审的代码面等价于 `fdbfdc4`
- 工作树：本轮全部契约命令与全部探针执行前后 `git status --porcelain` 均为空；本报告写入后工作树仅 `.agentdev/work/WP-04/review.md`（见文末）
- 评审角色：Review（独立上下文；未读取任何开发/Test 会话；`.agentdev/work/WP-04/test.md` 尚不存在；仅依据仓库代码、`docs/**` 契约、WP-04 的 `plan.md`/`implementation.md`，以及我自建的 `/tmp/wp04r2/` 脚本与第一轮 `/tmp/wp04r/` 脚本的重跑）
- 工具：`node v24.8.0`、`pnpm 12.3.4`、真实 `git`、macOS 宿主；探针只消费 `pnpm build` 产物（`packages/knowledge/dist/index.js`、`packages/workspace/dist/index.js`），**未 import 任何产品测试文件**
- 修复提交范围核对（`git show --stat fdbfdc4`）：7 文件 / +118 −6，全部落在 `plan.md` §2 允许的 `packages/knowledge/**`、`packages/workspace/**`、`packages/*/test/**`、`.agentdev/work/WP-04/**`；`docs/**`、`packages/contracts/**`、`packages/storage/**`、`webui/**`、`docker/**` 零改动（符合 plan §2 的不可写清单）
- 记录哈希（`git hash-object`，前 8 位，**`fdbfdc4` 状态**）：`packages/workspace/src/scan.ts` **`e173da55`**（一轮 `8ffc1880`）、`packages/knowledge/src/projection.ts` **`9688f16b`**（一轮 `195e699a`）、`packages/knowledge/src/feature-format.ts` **`e1d4f758`**（一轮 `a8115503`）、`packages/workspace/test/initialize.test.ts` **`faea91a2`**、`packages/knowledge/test/projection.test.ts` **`f914d1e2`**、`packages/knowledge/test/feature-format.test.ts` **`aec2a9bd`**、`.agentdev/work/WP-04/implementation.md` **`80479a9f`**（一轮 `cda1e65a`）、`.agentdev/work/WP-04/plan.md` **`a78655b0`**（未变）、`.agentdev/work/WP-04/review.md`（`HEAD` 版）**`2bbe31a0`**
- 未改动的一轮代码：`initialize.ts`、`git-port.ts`、`relations.ts`、`views.ts`、`model.ts`、`requirements-pool.ts` 与一轮相同（`git show --stat fdbfdc4` 未列出）

---

## 1. 结论

**FAIL（`fdbfdc4` 不能承接入独立 Test；本轮判 0×P0、1×P1、1×P2、3×P3）。**

第一轮的三条闭合项（W4R1-01、W4R1-02、W4R1-06 的 fail-open 面）经本轮独立取证**全部成立**，且一轮 6 个脚本重跑后原 5 处失败用例全部翻正、无新增回归。但 W4R1-01 的修复方式引入了**同类的新 fail-open**：`emptyProject` 被重新定义为「未观察到候选能力」，Ready 门禁的 `feature-or-empty-project` **不区分「完整地图下确无能力」与「正文预算耗尽的部分地图」**。在**默认预算**下，一个 41 包 monorepo（每个包都有 `README.md`、`src/index.ts` 与 `src/index.test.ts`）会以 `bodyRead=40`（全部为 readme 层）、`skipped=84`、`features=0`、`emptyProject=true` **直接 Ready**，PROJECT.md 写下 `实现状态：absent（未实现，明确空项目）`，并生成一条 `empty-project`、`requiresConfirmation:false` 的推断——**全程无任何用户确认、无 blocker**，与 `context.md` §4「至少一个真实能力或明确空项目状态」及 `knowledge.md` §5「达到预算输出部分地图和未知，不声称全量理解」冲突。对照组（4 包 monorepo）会正常产出 4 个候选能力并停在 `confirmation-required`，证明该分支只在预算耗尽时静默滑过。此为本轮唯一阻断项 **W4R2-01 [P1]**。

**正面结论（按证据）**：

- **W4R1-01 闭合**：`README+main.ts`、`README+main.py+test_main.py`、仅 `README.md`、空目录、仅根级 `main.ts`（无 README）、嵌套 `src/mod.ts` 六种形状全部走完 `Identifying→…→Ready`，`verifyReady.ok` 全为 true，候选 Feature 文档可解析、`candidate:true`/`deliveryRef:null`、不创建 `.agentdev/requirements`；仅 README/空目录形状 `emptyProject=true` 且 PROJECT.md 明写「明确空项目」，根级源码形状 `featureCount>0`、`emptyProject=false`；额外确认「只有嵌套仓库的父仓库」这一同类死锁形状也已可达 Ready（`/tmp/wp04r2/probe1-closures.mjs`）。
- **W4R1-02 闭合**：句末判据落为「CJK/全角终止符，或后接空白/结尾的 ASCII 句点」，10 例矩阵（版本号 `v1.2`、扩展名 `.ts`、`Node.js`、行尾句点、无终止符、`A.B`、中文感叹号、多行、英文缩写）逐例核对；投影 `features/README.md` 索引行的 `| 支持 v1.2 语义与 .ts 扩展名 |` 逐字正确，一轮失败用例 `summary-is-the-whole-first-sentence` 已翻正。
- **W4R1-06 的 fail-open 面闭合**：六段固定小节只认二级标题；`# 用途` 不再满足（拒绝且错误定位到 `用途`），`## 用途` 接受，重复二级标题仍拒绝；`renderReadme` → 再解析的 35 例格式矩阵（一轮脚本重跑）全部通过，无回归。
- **fail-closed 取向未因修复松动**：非法知识不发布/stale、断链只按当前需求阻断、脏工作区阻断、冲突不覆盖、候选文档不更新交付 ref 等一轮全部结论在重跑中保持不变（`probe1-format` 35/35、`probe2-views` 40/40、`probe3-pool` 43/43）。

---

## 2. 契约命令原始结果（代码树 `13fa9de`，`/tmp/wp04r2/contract-all.log`、`/tmp/wp04r2/contract-codes.txt`）

| 命令 | 结果 | 关键输出 |
|---|---|---|
| `pnpm install --frozen-lockfile` | **exit 0** | `Scope: all 11 workspace projects`；`Lockfile is up to date`；`✓ Lockfile passes supply-chain policies` |
| `pnpm typecheck` | **exit 0** | 无诊断 |
| `pnpm lint` | **exit 0** | `All matched files use Prettier code style!` |
| `pnpm docs:check` | **exit 0** | `docs:check ok — 15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages` |
| `pnpm test:unit` | **exit 0** | `Test Files 26 passed (26)`、`Tests 420 passed (420)`、12.57s |
| `pnpm test:integration` | **exit 0** | `Test Files 10 passed (10)`、`Tests 124 passed (124)`、65.58s（真实 Docker） |
| `pnpm build` | **exit 0** | 10 个 workspace 全部 `Done`（contracts/cli/knowledge/domain/pi-runtime/storage/workspace/core/daemon/runner） |

WP-04 自有测试（单独重跑：`pnpm exec vitest run --project unit packages/knowledge packages/workspace`，7 文件 / **131 用例全部通过**）：`feature-format.test.ts` 44、`projection.test.ts` 12、`views.test.ts` 9、`relations.test.ts` 11、`requirements-pool.test.ts` 25、`scan.test.ts` 16、`initialize.test.ts` 14。相对一轮（26 文件 / 415 用例、WP-04 126 用例）净增 5 例，全部来自修复提交：`initialize.test.ts` +3（两种根级有代码形状 + 仅 README 形状必达 Ready 且 `verifyReady` 通过）、`projection.test.ts` +1（版本号/扩展名不截断）、`feature-format.test.ts` +1（一级标题不满足小节），与 `git show fdbfdc4` 的测试差异逐条对应。

integration 层仍**不含任何 WP-04 文件**（`packages/knowledge`、`packages/workspace` 无 `*.integration.test.ts`；10 个文件为 `apps/cli/{container,doctor}`、`apps/runner/attempt`、`packages/core/{dispatcher,events-hub,identity,requirements}`、`packages/pi-runtime/session`、`packages/storage/{ledger,migrations}`）——这与 `implementation.md` T9 承接项 1（W4R1-03 留 WP-08、Test 须列入 `not_covered`）一致，属已登记承接，非本轮新缺陷。

---

## 3. 方法、证据脚本与一轮脚本重跑

### 3.1 本轮自建脚本（全部 `/tmp/wp04r2/`，独立上下文，真实临时目录 + 真实 `git`）

| 脚本 | 用例 | 结果 | 覆盖 |
|---|---|---|---|
| `probe1-closures.mjs` | 60 | **60 pass / 0 fail** | W4R1-01 六形状（含仅根级源码、空目录、嵌套模块回归）+ 嵌套仓库父级 + 确定性/feature-id 稳定性 + 候选文档候选性与 `deliveryRef` + W4R1-02 十例句末矩阵 + 投影索引行 + W4R1-06 标题级别四例 |
| `probe2-newdefects.mjs` | 21 | **21 pass / 0 fail** | 新缺陷取证：`root` 模块键碰撞（A）、部分地图空项目声明（B）、索引截断（C）、delta 记录卫生（D）、一轮 P3 复核（E）、摘要残余（F） |
| `probe3-realistic.mjs` | 5 | **5 pass / 0 fail** | **默认预算**下的 4 包（对照）与 41 包 monorepo（缺陷形状）：预算耗尽、能力为 0、Ready、PROJECT.md 断言、推断与 blocker |

三个脚本的全部用例断言都编码「闭合应成立」或「缺陷形状应复现」，因此 **0 fail 即：闭合成立、缺陷复现**。

### 3.2 第一轮脚本重跑（`/tmp/wp04r2/r1/`，同一批文件，只换新 `dist`）

| 脚本 | 一轮（旧树） | 二轮（`fdbfdc4`） | 二轮失败项性质 |
|---|---|---|---|
| `probe1-format.mjs` | 35 / 0 | **35 / 0** | — |
| `probe2-views.mjs` | 40 / 1 | **40 / 0** | 一轮唯一失败 `summary-is-the-whole-first-sentence` 翻正 |
| `probe3-pool.mjs` | 43 / 0 | **43 / 0** | — |
| `probe4-init.mjs` | 76 / 1 | 76 / 1 | 一轮失败 `root-only-project-can-reach-ready` 翻正；断言**旧缺陷形状**的 `root-only-observes-code-but-no-capability` 随即变为失败（其配对用例 `root-only-project-can-reach-ready` 现为 PASS） |
| `probe5-rootonly.mjs` | 23 / 3 | 23 / 4 | 三个 `*-can-reach-ready` 全部翻正；断言旧形状的 `*-investigation-shape`（3）与 `root-only-init-fails-before-fix`（明确断言修复前必失败）随之失败 |
| `probe6-observations.mjs` | 14 / 0 | 14 / 2 | `level1-heading-accepted-observation`（现 `level1HeadingAccepted=false`）与 `summary-truncates-at-decimal-point`（现不再截断）两处**旧行为**断言失败 |

即：**一轮 231 例中，原本 5 处失败全部消除，零意外回归**；二轮 7 处失败全部是「断言已被修复的旧行为」，且每一处都有同脚本内现已通过的配对断言（`*-can-reach-ready`、`level1HeadingAccepted=false`、`firstSentence` 正确值）。本轮证据用例合计 **86（新）+ 231（重跑）= 317 例**。

---

## 4. 三项闭合的独立验证

### 4.1 W4R1-01 [P1，一轮] 仅根级文件的项目无法通过 Ready 门禁 —— **已闭合**

| 形状 | 调查 | 初始化 | 记录 |
|---|---|---|---|
| `README.md`+`main.ts` | `featureCount=1`、`emptyProject=false` | `Ready`、`verifyReady.ok=true` | 候选 Feature 文档可解析、`candidate:true`/`deliveryRef:null`、无 `.agentdev/requirements` |
| `README.md`+`main.py`+`test_main.py` | 同上（reads 3） | `Ready` | 同上 |
| 仅 `README.md` | `featureCount=0`、`emptyProject=true` | `Ready` | PROJECT.md 明写「明确空项目」，未知显式 |
| 空目录（空提交） | `featureCount=0`、`emptyProject=true` | `Ready` | 同上 |
| 仅 `main.ts`（无 README） | `featureCount=1`、`emptyProject=false` | `Ready` | 同上 |
| `README.md`+`src/mod.ts`（回归） | `featureCount=1`、`emptyProject=false` | `Ready` | 一轮既有形状不回归 |

补充：`investigateWorkspace` 两次调用逐字相同；两个不同仓库的同内容根级项目得到**相同**的 `moduleKey='root'` 与 `featureId`（确定性）；「只有嵌套仓库的父仓库」也到达 Ready（同类死锁一并解除）。修复实现（`moduleKeyOf` 返回 `ROOT_MODULE_KEY='root'`；`emptyProject = features.length === 0`；非索引空时补一条显式 empty-project 观察）与 T9 记录一致。

### 4.2 W4R1-02 [P2，一轮] 投影一句话摘要在任意 ASCII `.` 处截断 —— **已闭合（含残余，见 W4R2-04）**

`firstSentence` 十例：`支持 v1.2 语义与 .ts 扩展名。后续…` → `支持 v1.2 语义与 .ts 扩展名`；`First sentence. Second sentence.` → `First sentence`；`支持 Node.js 运行时。` → `支持 Node.js 运行时`；`Supports Node.js.` → `Supports Node.js`；`全文结束.` → `全文结束`；`版本 1.2.3 已确认！下一句。` → `版本 1.2.3 已确认`；`A.B` 与无终止符句子保持不变。投影 `features/README.md` 索引行含完整 `支持 v1.2 语义与 .ts 扩展名`，且不含 `| 支持 v1 |`。残余：`见 e.g. 示例。` → `见 e.g`（英文缩写仍截断）、`SENTENCE_END` 的 `\n` 分支因先折叠空白而不可达 → 记为 W4R2-04 [P3]。

### 4.3 W4R1-06 fail-open 面（一级标题充当固定小节） —— **已闭合**

`# 用途` 替换 `## 用途` 后解析被拒（错误字段 `用途`）；`## 用途` 正常；`### 用途` 亦不接受（判据为严格二级）；重复二级小节仍报 duplicate。`renderReadme` 回读（一轮 35 例矩阵）无回归，说明渲染侧与解析侧级别一致。

---

## 5. Findings（W4R2-xx）

### W4R2-01 [P1] 部分地图（正文预算耗尽）下「零候选能力」被当成「明确空项目」并静默 Ready（**阻断**）

- **现象**：`generateCandidateKnowledge` 把 `emptyProject` 定义为 `features.length === 0`（`scan.ts:1290`），Ready 门禁 `feature-or-empty-project` 只判 `record.featureCount > 0 || record.emptyProject`（`initialize.ts:600`），**不看 `record.scanPartial`**。而候选能力只来自正文预算内的 `scan.bodyFiles`（`scan.ts:1260`），正文选择按 `readme → manifest → 构建测试入口 → 路由/模型 → 源码` 的层级排序（`scan.ts:753`）。因此当 readme 层文件多于正文预算（默认 40 个 / 512 KiB）时，代码文件全部被跳过，`features=0`，门禁走「明确空项目」分支。
- **默认预算复现（`/tmp/wp04r2/probe3-realistic.mjs` M-2..M-5；41 包，每包 `README.md` + `src/index.ts` + `src/index.test.ts`，根另有 `README.md`）**：`indexTotal=207`、`bodyRead=40`、`bodyCategories=["readme"]`、`skipped=84`、`partial=true`、`unknownKinds=["budget-body-files"]`；`features=0`、`emptyProject=true`；`step` 直达 `Ready`（`done=true`），**blocker 列表为空**（对照组 4 包 monorepo：`features=4`、`emptyProject=false`、停在 `confirmation-required`）；`record.scanPartial=true`、`record.inferences=["empty-project:false"]`；`PROJECT.md` 写 `实现状态：absent（未实现，明确空项目）`、`主要模块` 为「无已观察模块」，同时「未知」节列出「正文文件预算用尽：…未读取 84 个候选文件」。
- **小预算等价复现（`/tmp/wp04r2/probe2-newdefects.mjs` B-1..B-4）**：`README.md`+`ci/a.txt`+`ci/b.txt`+`src/main.ts`、`budget={maxBodyFiles:2}` → 正文仅 README 与 `ci/a.txt`，索引内含 `src/main.ts`，`features=0`、`emptyProject=true`、Ready、PROJECT.md 断言 absent。即缺陷与预算值无关，只看「预算内是否碰到代码层」。
- **影响**：`context.md` §4 的 Ready 条件为「至少一个真实能力**或明确空项目状态**」；部分地图既非「有真实能力」也非「明确空项目」，门禁却按后者放行。`knowledge.md` §5 要求「达到预算输出部分地图和未知，**不声称全量理解**」，而 PROJECT.md 的 `absent（未实现，明确空项目）` 与推断 `empty-project`（`requiresConfirmation:false`）正是对全仓的实现状态下断言；副作用是**用户无需任何确认**即可让含代码的大型仓库以「未实现空项目」完成初始化。一轮修复前该形状是永久 `failed/ready-gate`（同族 P1），本次修复把「死锁」换成了「静默误判」，属新引入的 fail-open，落在 WP-04 退出条件（候选知识组件）与 AC-026 的验收面。
- **最小修法（不得退回死锁）**：把「预算耗尽下的零能力」建成**显式、可处置**的状态，而不是复用 `emptyProject`——例如门禁改为 `featureCount>0 || (emptyProject && !record.scanPartial)` **并**为 `scanPartial && featureCount===0` 增加一种 blocker（如 `budget-partial`／`confirmation-required`），用户可「接受本次部分地图」或「申请下一批有理由的范围内调查」（`knowledge.md` §5 已有该路径）；同时 PROJECT.md 在 `scanPartial` 时改写为「本次预算内未观察到已实现能力（部分地图，未声称全量）」，删除 `absent（未实现，明确空项目）` 与 `empty-project` 免确认推断。**必须补的长期断言**：(i) 默认预算 41 包 monorepo 不得无阻断直达 Ready、且不得写 `absent`；(ii) 4 包对照仍产出候选能力并停在确认；(iii) 一轮三种根级形状与空目录/仅 README 形状**仍须** Ready（不得回归 W4R1-01）。

### W4R2-02 [P2] `ROOT_MODULE_KEY='root'` 与真实顶层目录 `root/` 同键，两个模块被合并为一个候选 Feature

- **现象**：`moduleKeyOf('main.ts') === moduleKeyOf('root/other.ts') === 'root'`（`scan.ts:1089` 对 <2 段路径返回 `'root'`；`scan.ts:1093` 对任意顶层目录名原样返回）。两者无法区分。
- **证据（`/tmp/wp04r2/probe2-newdefects.mjs` A-1..A-4）**：`README.md`+`main.ts`+`root/other.ts` 只产出 **1** 个候选 Feature，`moduleKey='root'`、`name='root'`、`module='root'`，`sourceRefs` 同时含 `README.md`、`main.ts`、`root/other.ts`，`实现入口` 三条并列；`detectKnowledgeConflicts` 的 `conflict.moduleKey === moduleKey` / `moduleKeyOf(path) === moduleKey` 映射同样合并；对照（只有真实 `root/` 目录）也为 `root`，故碰撞静默发生、不报诊断。
- **影响**：模块边界写错进候选知识（索引、CODE_MAP、Feature 文档、后续 Context 选择都会把两个模块当同一个能力），用户确认后错误固化。属局部质量问题（候选文档、`design=unconfirmed`、不影响 Ready 与 fail-closed 门禁），但建议在 WP-05 消费索引前修。
- **建议**：改用不可能等于任何路径段的哨兵（如 `'.'` 或 `'(root)'`），或对真实顶层 `root/` 目录加后缀去重；补断言「根级源码 + 真实 `root/` 目录必须产出两个模块」。

### W4R2-03 [P3] delta 记录卫生：`moduleKeyOf` 注释与两处不可达分支未同步

- `scan.ts:1082` 仍写 `/** Module key of a repo-relative path, or `null` for a root-level file. */`，但函数已**永不返回 null**（对 `main.ts`/`root/other.ts`/`src/a/a.ts`/`''`/`a/b/c` 实测均非 null）；
- `scan.ts:1261-1262` 的 `if (key === null) continue;` 已成死分支；`scan.ts:1130` 的 `?? null` 同样不可达。
- 证据：`probe2-newdefects.mjs` D-1..D-3。建议同步注释与删除死分支（或把返回类型收窄为 `string`）。

### W4R2-04 [P3] 摘要残余：英文缩写仍被截断，`\n` 终止分支不可达

- `firstSentence('见 e.g. 示例。')` = `见 e.g`（点后接空格被判句末）；W4R1-02 的既定判据（「`.` 后接空白或行尾」）已实现且有断言，故按残余记；
- `SENTENCE_END` 的 `\n` 分支在 `text.replace(/\s+/gu,' ')` 之后不可达：`firstSentence('第一行\n第二行')` = `第一行 第二行`（多行且无句号的 `用途` 会把整段作为摘要）。
- 证据：`probe2-newdefects.mjs` F-1..F-3、`probe1-closures.mjs` 矩阵第 9 例。建议：若需支持缩写，用「点后接空白且前一词非单字母缩写/常见缩写表」或先按行取首行；并删掉不可达的 `\n` 分支或改为先按行切分。

### W4R2-05 [P3] 记录订正不完整：T8 残余 3 的括注未随修复同步订正

- 一轮要求「如采纳 (a)/(b)，同步订正残余 3 的『其他源文件层』表述，避免再次声称覆盖根级源码」。`implementation.md` T9 已新增根级模块说明（T9 修复项 1/2）并补了 W4R1-03 的承接登记（T9 承接 1，**记录面已闭合**），但 **T8 残余 3**（`implementation.md:63`）的括注仍为「否则仅有源码的旧项目无法产出可观察模块」——该层只对 ≥2 段路径生效，根级源码靠的是 `ROOT_MODULE_KEY`；单独读残余 3 仍可能被理解为该层已覆盖根级源码。建议订正该括注并指向 T9。
- 另：`implementation.md` 未登记 W4R2-01/02（本轮发现），修复后应一并登记。

### 一轮 P3 承接项复核（未重新编号）

| 编号 | 复核结论（本轮实测） |
|---|---|
| W4R1-03 集成演练 | **记录面闭合**：T9 承接 1 明确留 WP-08 且 Test 须列 `not_covered`；integration 层确无 WP-04 文件（10 文件清单见 §2），与登记一致 |
| W4R1-04 用错处置 API | **仍可复现**（`probe2` E-1）：`confirmation-required` 上调 `resolveBlocker` → `VALIDATION_ERROR` 且记录 `status='failed'`、`failure.kind='internal'`、`recoverable=false`，随后 `step` 恒 `failed/internal` |
| W4R1-05 `requirement:<id>@<version>` 版本不校验 | **仍可复现**（`probe2` E-2）：`resolveSourceRef('requirement:R-1@99',{requirementIds:['R-1']})` → `{ok:true,version:'99'}`；未知 id 仍正确拒绝 |
| W4R1-06 残余（池根散落 `requirement.json`、目录符号链接记 `kind:'file'`） | **仍可复现**（`probe2` E-3/E-4）：池根裸 `requirement.json` → `ok=true, errors=0, records=0`；`src/linked-dir → 外部目录` 记 `kind:'file'`+`symlink:true`。其 fail-open 面（一级标题）已闭合 |

---

## 6. 记录与实现一致性核对

| 记录条目 | 核对结果 |
|---|---|
| T0：build 由 8 变 **10** workspace | 一致（`pnpm build` 10 个 `Done`） |
| T9：`typecheck`/`lint` 0、`test:unit` **26 文件 / 420 用例**、`test:integration` 124、`build` 10 workspace | 一致（§2 原始日志；WP-04 自有 7 文件 / 131 用例单独重跑一致） |
| T9 修复项 1/2：`moduleKeyOf` 返回 `root`；`emptyProject` = 未观察到候选 Feature，并显式记观察 | 代码一致（`scan.ts:80/1089/1233/1290-1297`）；行为见 §4.1。**副作用未登记** → W4R2-01/02 |
| T9 修复项 3：`firstSentence` 判据改为「CJK/全角 或 后接空白/结尾的 ASCII 句点」 | 一致（`projection.ts:59`）；残余见 W4R2-04 |
| T9 修复项 4：六段固定小节只认二级标题 | 一致（`feature-format.ts` 两处 `item.level === 2`）；`renderReadme` 回读无回归 |
| T9 回归网：新增 3 + 2 + 1 例 | 一致（`git show fdbfdc4` 新增 5 例；unit 415→420；WP-04 126→131） |
| T9 验证数字（420/124/10） | 一致（§2） |
| T9 承接 1：W4R1-03 留 WP-08、Test `not_covered` | 一致（§2 integration 无 WP-04 文件） |
| T9 承接 2/3/4：W4R1-04/05/06 残余 | 行为一致（§5 复核表）；**T8 残余 3 括注未订正** → W4R2-05 |
| T8 残余 1（SQLite 落地留 WP-08）、2（无 Git 不回填 git ref）、4（confirmed 无 decision id 先报 invalid）、5（Writing 脏门禁过滤自写路径）、6（Provider/HTTP/Docker 不在本包） | 本轮未发现与代码矛盾之处；均属已登记承接 |
| plan §2 写路径与不可写清单 | 一致：`fdbfdc4` 7 文件全部在允许集合内，`docs/**`、`contracts/**`、`storage/**`、`webui/**`、`docker/**` 零改动 |
| plan §5 集成演练（真实 SQLite + 临时 Git 的端到端） | 仍不落地，但已由 T9 承接 1 显式登记 → 记录面一致 |
| plan §7/T3「不复用旧决策引用」等无独立断言的表述 | 与一轮相同：视图按入参即时构造，未发现跨投影复用；因无可判定断言，不计为已验证项（覆盖边界见 §9） |

---

## 7. 计数与阻断判定

| 严重度 | 数量 | 编号 | 阻断 |
|---|---|---|---|
| P0 | **0** | — | — |
| P1 | **1** | W4R2-01 | **是** |
| P2 | **1** | W4R2-02 | 否 |
| P3 | **3** | W4R2-03、W4R2-04、W4R2-05 | 否 |
| （承接复核） | 4 | W4R1-03（记录面闭合）、W4R1-04、W4R1-05、W4R1-06 残余 | 否 |

| 阻断项 | 严重度 | 阻断内容 | 解除条件 |
|---|---|---|---|
| W4R2-01 | P1 | 部分地图（正文预算耗尽）零候选能力被当作「明确空项目」静默 Ready；默认预算 41 包 monorepo 写成 `absent（未实现，明确空项目）`，无确认、无 blocker，违反 `context.md` §4 Ready 条件与 `knowledge.md` §5「不声称全量理解」 | 按 §5 修法把「预算耗尽 + 零能力」变为显式可处置状态（不得复用 `emptyProject` 免确认）；PROJECT.md 不写 absent；补三条长期断言（默认预算大 monorepo 不得静默 Ready、4 包对照仍产出能力并确认、根级三形状与空目录/仅 README 仍 Ready） |

---

## 8. 能否进入独立 Test —— **不能**

理由：W4R2-01 为 P1 且落在 WP-04 退出条件（候选知识）与 AC-026 的验收面；独立 Test 若按「含代码测试的旧项目」构造一个超过正文预算的仓库（41 包 monorepo 即最小自然形状），将稳定复现「静默 Ready + PROJECT.md 断言未实现」，Test 结论会被同一缺陷支配。修复轮最低要求：

1. **修 W4R2-01（必须）**：区分「完整地图下确无能力」（可免确认的明确空项目）与「预算耗尽的部分地图」（显式 blocker，可由用户接受或申请下一批），并订正 PROJECT.md/推断措辞；不得放宽其余门禁（非法知识不发布/stale、断链按需求阻断、脏工作区、冲突不覆盖、交付 ref 不变仍须 fail-closed），也不得让 W4R1-01 的三种根级形状回归死锁。
2. **建议同轮修（非阻断）**：W4R2-02（`root` 键碰撞）——在 WP-05 消费索引前修更省事；补 `moduleKeyOf` 注释与死分支（W4R2-03）；订正 T8 残余 3 括注并登记 W4R2-01/02（W4R2-05）；W4R2-04 可留 WP-05 前。
3. **记录订正（必须）**：`implementation.md` 登记 W4R2-01/02 的处置与承接，并保留 W4R1-03..06 的既有登记。
4. **Test 最小覆盖矩阵**：AC-025 空目录（授权前不建 `.git`）；AC-026 **根级三种形状 + 超预算大仓库**两种极端的对照（代码不移动、无 Requirement、超预算形状不得静默宣称 absent）；AC-027/028/029（无 Git 只读、脏工作区处置、中断按 Hash 恢复、冲突不覆盖、门禁篡改复核）；AC-040 非法知识（不发布 + stale + 断链按当前需求阻断，含「无需求范围不阻断」负例）；AC-086 正负例；AC-042 设计/代码冲突；AC-087/088/092/093 组件级（本地状态 + 真实临时 Git；SQLite/Core/UI 集成按 W4R1-03 归 WP-08 并在 Test 报告 `not_covered`）。

---

## 9. 方法与边界声明

- 本轮只审阅 `fdbfdc4`（代码面等价于 `HEAD`）的仓库状态，不读取开发/Test 会话；全部结论可由 `/tmp/wp04r2/*.mjs` 与 `/tmp/wp04r2/contract-*.{log,txt}` 复现。冻结前后 `git status --porcelain` 为空（本报告写入前）。
- **覆盖边界（未验证项，测试/后续包需承接）**：`feature_projection` 的 SQLite 落地与交付提交/CAS、需求池保存侧原子提交与 Context 加载同 revision（WP-08/WP-05）；`GitPort`/`FileSystemPort` 的真实提交事务与崩溃注入；HTTP/WS 接线（`project.initialize` 等）；真实 Provider 纵向；AC-039 的实际上下文选择接线（WP-05）；`views` 中「不复用旧决策引用」等无独立断言可判定的表述。
- 本轮未做：跨平台/Windows 路径、超大仓库（>10000 索引条目）性能实测（仅以 `maxIndexEntries=2` 的小预算等价验证截断路径）、并发多进程同时写同一 `InitStateStore` 文件、`diagnoseLinks` 对非 Map 运行时的误用。
- 严重度口径：`docs/rules/workflow.md` §6 —— P0 数据/安全或关键不可用、P1 错误行为/需求缺失、P2 局部质量/维护、P3 建议；P0/P1 阻断。

## 文末打印（本轮取证汇总）

- **结论：FAIL**（`0×P0`、`1×P1`、`1×P2`、`3×P3`；阻断项 **W4R2-01**）
- 冻结点：`git rev-parse HEAD` = `479d07bc965354f326b9415347eacf38ee9644b3`；`git rev-parse HEAD^{tree}` = `bb4e8a3f9fe56a728287573e867623e633ae7051`
- 被评审代码树：`fdbfdc4` → `13fa9de496581766f089d78aa8df80f2dfed2873`（`fdbfdc4 HEAD` 差异仅 `review.md` +205 行）
- 报告写入后 `git status --porcelain` 最后一行 = ` M .agentdev/work/WP-04/review.md`
- 契约命令：install/typecheck/lint/docs:check/test:unit/test:integration/build = **7/7 exit 0**（unit 26 文件 420 用例；integration 10 文件 124 用例；build 10 workspace；docs:check 15 文档/55 链接/94 验收用例）
- 证据脚本与用例数（本轮）：`probe1-closures.mjs` 60/0、`probe2-newdefects.mjs` 21/0、`probe3-realistic.mjs` 5/0 = **86 例 0 失败**
- 一轮脚本重跑（回归）：35/0、40/0（原 39/1）、43/0、76/1（原 75/1，失败项换为断言旧缺陷形状者）、23/4（原 20/3，同上）、14/2（原 14/0，失败项为断言旧缺陷者）= **231 例、7 处失败全部是「旧行为断言」，原 5 处失败全部翻正、无意外回归**

---

## 附一：第一轮报告（保留）

# WP-04 独立 Review 报告（第一轮）

- 评审对象：工作包 WP-04「知识与新旧项目」（`docs/delivery/implementation.md` WP-04；关联 AC-025–029、AC-037–040、AC-042、AC-086–088、AC-092、AC-093）
- 评审轮次：**第一轮**（无前轮；本文件为 append-only 报告的首版）
- 冻结点 / 代码树：**`9ee1a8263454b69d627a48613253923d709c56cc`** = `git rev-parse HEAD`，`git rev-parse HEAD^{tree}` = **`5a2ca58287e7591f35bac358ae0434146b3714d2`**（`feat(knowledge,workspace): implement WP-04 knowledge and project initialization`）
- 工作树：全部契约命令与全部探针执行前后 `git status --porcelain` 均为空（本报告写入前）；本报告写入后工作树仅 `.agentdev/work/WP-04/review.md`（未跟踪，见文末）
- 评审角色：Review（独立上下文；未读取任何开发/Test 会话，本轮尚无 `.agentdev/work/WP-04/test.md`；仅依据仓库代码与 `docs/**` 契约、WP-04 的 `plan.md`/`implementation.md` 记录，以及我自建的 `/tmp/wp04r/` 6 个脚本）
- 工具：`node v24.8.0`、`pnpm 12.3.4`、真实 `git`、macOS 宿主；全部脚本消费 `pnpm build` 产物（`packages/knowledge/dist/index.js`、`packages/workspace/dist/index.js`），**未 import 任何产品测试文件**
- 记录哈希（`git hash-object`，前 8 位）：`packages/workspace/src/scan.ts` **`8ffc1880`**、`initialize.ts` **`cff4739d`**、`git-port.ts` **`a77fb52d`**、`packages/knowledge/src/projection.ts` **`195e699a`**、`feature-format.ts` **`a8115503`**、`requirements-pool.ts` **`50e5e508`**、`views.ts` **`e9fb9b41`**、`relations.ts` **`ede0b5e5`**、`model.ts` **`ee8acd65`**、`.agentdev/work/WP-04/plan.md` **`a78655b0`**、`implementation.md` **`cda1e65a`**
- 变更范围（`git show --stat 9ee1a82`）：27 文件 / +12066 行，全部落在 plan §2 允许的 `packages/knowledge/**`、`packages/workspace/**`、`packages/*/test/**`、`tsconfig.json`、`vitest.config.ts`、`pnpm-lock.yaml`、`.agentdev/work/WP-04/**`；`packages/contracts/src/entities/{system,structures}.ts`、`packages/contracts/src/errors.ts`、`packages/storage/src/{tables,migrations}.ts` **零改动**（plan 写作「若缺失则补齐」，本包未需要，记录未声称已改，属一致）
- 权威依据：`AGENTS.md`、`docs/INDEX.md`、`docs/rules/workflow.md`（§1/§2/§6）、`docs/delivery/implementation.md`（WP-04）、`docs/delivery/acceptance.md`（WP-04 关联 AC 全文）、`docs/architecture/{context,data,ARCHITECTURE}.md`、`docs/product/{knowledge,requirements}.md`、`.agentdev/work/WP-04/{plan,implementation}.md`、`packages/{knowledge,workspace}/**`

---

## 1. 结论

**FAIL（`9ee1a82` 不能承接入独立 Test；本轮判 0×P0、1×P1、1×P2、4×P3）。**

必须修一条才能进入 Test：**W4R1-01 [P1]** —— 「索引非空但未产生任何模块能力」的项目（README+`main.ts`、README+`main.py`+`test_main.py`、甚至只有 `README.md`）在 Writing 阶段被 Ready 最小门禁的 `feature-or-empty-project` **永久判失败**：`step` 返回 `failed/ready-gate`，`resume` 复跑同一失败（`recoverable:true` 但无任何用户动作能改变判据），即 AC-026「旧项目初始化」在这类仓库形状上不可完成。其余验收面（AC-025 空目录、AC-027、AC-028、AC-029、AC-037–040、AC-042、AC-086 与需求池 AC-087/088/092/093 组件级）在本轮独立取证下**全部成立**，且 fail-closed / 不覆盖 / 不更新交付 ref 的取向一致。

**正面结论（按证据）**：

- **Feature 格式校验是真正的 fail-closed 矩阵**：35 例正负例（`/tmp/wp04r/probe1-format.mjs`，35/35）覆盖 `design=confirmed` 需可解析确认来源、`verification=passed` 需证据+覆盖+revision 与代码树一致、`investigation=investigated` 需 scope+source_refs、缺字段/未知枚举/占位值/模板 id/owner_document 不一致/重复标题/空入口/关系表列数或取值非法/跨文档重复 ID；且 `renderReadme` → 再解析**回读同一事实**（含 `\|` 转义的关系单元格）。
- **投影与 stale 语义与文档一致**：非法文档 ⇒ **不发布**、保留上一版并标 `state:'stale'+staleSince/staleReason`、诊断全为 `KNOWLEDGE_INVALID`、从未发布过则 `projection:null`；stale 投影可读但 `current:false`（`/tmp/wp04r/probe2-views.mjs`，39/40，唯一失败项即 W4R1-02）。重建确定性：同输入两次构建 `documentHashes` 与全部渲染哈希逐字相同。
- **断链只按当前需求阻断**：断链不阻断发布；`currentRequirementFeatureIds` 命中声明方或被指向方 ⇒ `deliveryBlocked=true` 且 `blockedFeatureIds` 命中；未命中或未给需求范围 ⇒ 不阻断（0 扩张）。
- **初始化写入保护可复现**：中断后按内容 Hash 跳过已写文档（不重写）、冲突文件**逐字节不变**且报告 disk/candidate 双 Hash、`resume` 在冲突未处置时拒绝、显式处置后可达 Ready、Ready 门禁复核能发现篡改；脏工作区先阻断并给出逐路径 Hash 后才允许处置继续，用户文件保留；无 Git 目录在授权前不创建 `.git`、不写任何文档（`/tmp/wp04r/probe4-init.mjs`，75/76，唯一失败项即 W4R1-01 的 README/根级形状）。
- **需求池组件级能力与 AC-087/088/092/093 对应**：43/43（`/tmp/wp04r/probe3-pool.mjs`）—— 缺文件/坏 Hash/版本不一致/目录名≠id/重复 id/旧格式（两处布局）/被 Git 忽略逐条诊断且有效记录继续可见；导入幂等、`localVersion` 与 `recordVersion` 分离、同版本异内容/旧版本/批内重复/无法读取逐条 `REQUIREMENT_CONFLICT` 且保留本地行、`stale_projection` 拒绝覆盖且不推进投影 revision、修复后可显式重导入；历史摘要保留完成摘要/取消原因/归档前状态并标 `详细证据未迁移`、`countsAsLocalVerification:false`。

**未闭合项（不阻断者）**：W4R1-02 [P2] 投影一句话摘要在任意 ASCII `.` 处截断（`支持 v1.2 语义与 .ts 扩展名` → `支持 v1`），会导致索引/后续 Context 选择看到不完整摘要；W4R1-03 [P3] plan §5 承诺的 WP-04 集成演练（真实 SQLite + 扫描→候选→写入→投影→查询、需求池无原库导入）未落地也未显式登记承接；W4R1-04 [P3] 用错处置 API 会把记录置为不可恢复的 `failed/internal`；W4R1-05 [P3] `requirement:<id>@<version>` 不校验版本存在性；W4R1-06 [P3] 三处次要宽松点（一级标题满足固定小节、目录符号链接在索引里记 `kind:'file'`、池根散落 `requirement.json` 无诊断）。

| 维度 | 本轮结果 |
|---|---|
| 契约命令 | **6/6 exit 0**（unit 26 文件 / 415 用例；integration 10 文件 / 124 用例；build 10 workspace） |
| 自建探针用例 | **231 例，5 例失败**，映射 **2 个缺陷**（1×P1 跨 4 例、1×P2 1 例） |
| AC-025 空目录 | 通过（授权后建 Git + `agentdev/main` + 空初始提交；候选文档 design 仍标未实现） |
| AC-026 旧项目（嵌套模块） | 通过（预算内、来源/未知、代码不移动、无 Requirement） |
| AC-026 旧项目（仅根级代码/测试） | **不通过 → W4R1-01** |
| AC-027 / 028 / 029 | 通过 |
| AC-037 / 038 / 039 / 040 / 042 | 通过 |
| AC-086 | 通过（35 例格式矩阵） |
| AC-087 / 088 / 092 / 093 | 组件级通过；集成证据留 WP-08（见 W4R1-03） |
| 交付 ref 不更新 | 全程未发现更新路径（`candidate:true`/`deliveryRef:null` 在记录与全部候选文档上恒成立） |

---

## 2. 契约命令原始结果（代码树 `5a2ca58`，`/tmp/wp04r/commands.log`）

| 命令 | 结果 | 关键输出 |
|---|---|---|
| `pnpm install --frozen-lockfile` | **exit 0** | `Scope: all 11 workspace projects`；`Lockfile is up to date`；`✓ Lockfile passes supply-chain policies` |
| `pnpm typecheck` | **exit 0** | 无诊断 |
| `pnpm lint` | **exit 0** | `All matched files use Prettier code style!` |
| `pnpm docs:check` | **exit 0** | `docs:check ok — 15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages` |
| `pnpm test:unit` | **exit 0** | `Test Files 26 passed (26)`、`Tests 415 passed (415)`、5.52s |
| `pnpm test:integration` | **exit 0** | `Test Files 10 passed (10)`、`Tests 124 passed (124)`、30.62s（真实 Docker） |
| `pnpm build` | **exit 0** | 10 个 workspace 全部 `Done`（contracts/cli/knowledge/domain/pi-runtime/storage/workspace/core/daemon/runner） |

WP-04 自有测试（全部在 unit 层，真实临时目录 + 真实 `git`）：`requirements-pool.test.ts` 25、`feature-format.test.ts` 43、`views.test.ts` 9、`projection.test.ts` 11、`relations.test.ts` 11、`scan.test.ts` 16、`initialize.test.ts` 11 = **7 文件 / 126 用例，全部通过**；integration 层不含任何 WP-04 文件（`packages/knowledge`、`packages/workspace` 无 `*.integration.test.ts`，见 W4R1-03）。必需失败测试在仓库内可直接指名：初始化中断（`initialize.test.ts` "records an interrupted write and resumes without duplicating writes" 等）、非法 Feature / 重复 ID（`projection.test.ts` "refuses duplicate feature ids without merging the documents"）、断链（`relations.test.ts` + `projection.test.ts` "gates delivery for the current requirement only…"）、代码设计冲突（`scan.test.ts` "reports an existing document that disagrees with the observed tree (AC-042)"）。

---

## 3. 方法与证据脚本（全部 `/tmp/wp04r/`，独立上下文）

| 脚本 | 用例 | 结果 | 覆盖 |
|---|---|---|---|
| `probe1-format.mjs` | 35 | **35 pass / 0 fail** | AC-086 正负例矩阵、AC-040 解析层、重复 ID 集级、`renderReadme` 回读 |
| `probe2-views.mjs` | 40 | **39 pass / 1 fail（W4R1-02）** | 投影发布/确定性/stale、断链按需求阻断、关系图与约束、三视图与 Work 覆盖层隔离、observed/confirmed、AC-037 正文即最新行为、摘要生成 |
| `probe3-pool.mjs` | 43 | **43 pass / 0 fail** | 需求池读取/重建/逐条诊断、忽略与旧格式、导入幂等/冲突/stale/未读、历史摘要 |
| `probe4-init.mjs` | 76 | **75 pass / 1 fail（W4R1-01）** | 空目录全流程、旧项目、预算、无 Git、脏工作区、中断恢复（JSON 文件状态跨实例）、内容冲突、Ready 门禁复核、设计/代码冲突 |
| `probe5-rootonly.mjs` | 23 | **20 pass / 3 fail（W4R1-01 三形状）** | 根级项目 Ready 死锁、确定性、嵌套仓库隔离、候选路径包含性、符号链接逃逸 |
| `probe6-observations.mjs` | 14 | **14 pass / 0 fail** | W4R1-04/05/06 与符号链接索引形态的取证 |

探针只消费 `pnpm build` 产物，不读产品测试文件；仓库内不含任何我写入的文件（全部 `mkdtemp` 于系统临时目录并在脚本末尾清理）。

---

## 4. AC 逐项核对

| AC | 判定 | 关键证据（本轮自建） |
|---|---|---|
| **AC-025 空项目** | **通过** | `probe4` Case A：空目录在显式 `authorizeGitInitialization` 前不建 `.git`；授权后 `git init -b agentdev/main` + 空初始提交（`headRevision` 非 null）；写出 PROJECT/INDEX/CODE_MAP/features-README 四入口且 `candidate:true`/`deliveryRef:null`；`PROJECT.md` 明写 `absent（未实现`；`verifyReady` 通过 |
| **AC-026 旧项目初始化** | **不通过** | 嵌套模块旧项目（README+package.json+`src/*`+测试）全通过：调查只读（写入 0、hash 不变）、代码不移动、无 `.agentdev/requirements`、候选 `design=unconfirmed`/`implementation=partial`/`git:<rev>:<path>` 来源、预算 40 文件/512 KiB 部分地图带显式未知；**但仅根级代码+测试的旧项目无法 Ready → W4R1-01** |
| **AC-027 目录项目（无 Git）** | **通过** | `probe4` Case C：无 Git 时 `investigateWorkspace` 可用（`gitRoot:null`）；正式写入返回 `Blocked` + `GitInitializationRequest` + `NOT_AUTHORIZED`；授权前 `.git` 与 `docs/` 均不存在；`verifyReady` 明确 `candidate-documents-written` 未满足 |
| **AC-028 脏工作区** | **通过** | `probe4` Case D：`checkDeliveryReadiness` 返回 `dirty-workspace` + 逐路径 `{path,state,sha256}`；只读调查仍可用；`step` 阻断且未写文档；`committed` 而实际未提交时**仍阻断**；显式 `authorized` 后继续并在之后保留用户文件原内容 |
| **AC-029 初始化冲突中断** | **通过** | `probe4` Case E/F/G：写入中断（第 2 次写抛错）⇒ `failed/interrupted` + 状态已落 JSON 文件；新实例恢复时首文档记 `unchanged` 且**未被重写**；预置不同内容的 `CODE_MAP.md` ⇒ `content-conflict` 报双 Hash、磁盘文件逐字节不变、`resume` 拒绝，替换为候选内容后才恢复；Ready 后篡改文档 ⇒ `verifyReady` 失败 |
| **AC-037 当前功能** | **通过** | `probe2`：函数正文即最新行为，冷启动仅凭该文档读到「取消后释放库存并退款」，`sourceRevision` 与 `current:true` 正确；`projection.test.ts` 另有「不注入无关文档」断言 |
| **AC-038 状态分离** | **通过** | `probe2`：design 视图给已确认意图 + 独立 implementation；delivered 给当前行为/约束/设计/实现/验证/实现入口/已知差距；work 视图 `notDelivered:true`、draft 未知项、未声明该 Feature 的 Work `overlay:null`；同一投影上重复查询 design 视图**逐字节不变**；stale 投影 `current:false` |
| **AC-039 语义关系** | **通过** | `probe2`：关系图边与 `missingTargets` 占位节点（`resolved:false`、名称/模块 `未调查`）；`constrained_by` 的 reason 进入 delivered 视图 `constraints`；无目标不虚构 Feature。**注意**：把关系/约束真正接入 Context 选择是 WP-05 的接线，本包只提供事实与门禁 |
| **AC-040 非法知识** | **通过** | `probe2`：非法文档 ⇒ `published:false`、`stale:true`、保留最后有效（`state:'stale'`,`staleSince`）或 `projection:null`；诊断全 `KNOWLEDGE_INVALID`；断链不阻断发布、命中当前需求 Feature（声明方或目标方）才 `deliveryBlocked`，未给需求范围一律不阻断 |
| **AC-042 观察与意图** | **通过** | `probe4` Case H：已有 `design=confirmed/implementation=implemented` 而入口不存在 ⇒ Confirming `blocked/design-conflict`，既有文档逐字节不变、候选保持 `design=unconfirmed`；`resolveBlocker` 被拒（须用 `resolveConflict`），逐条处置后可达 Ready。`probe2`：`observedVsConfirmed` 给 `observed_not_confirmed`（`mustNotAcceptObserved:true`）与 `confirmed_not_observed`；`listGaps` 不吞掉真实差距（`无法在离线环境验证`）且丢弃「无已知差距/暂无」 |
| **AC-086 功能状态证据** | **通过** | `probe1` 35 例：`confirmed` 无有效来源拒绝（含未给 `knownIds` 的 fail-closed）、`passed` 缺证据/缺覆盖/revision 与代码树不一致拒绝、`investigated` 缺 scope 或 source_refs 拒绝；完整有效样例通过 |
| **AC-087 需求池随 Git 迁移** | **组件级通过** | `probe3`：从仅含两文件的记录目录读出稳定 id/目标/范围/验收/已确认结论/未决项与正文；列表由 `rebuildPoolReadme` 重建、**不调用模型**；`isPathIgnored` 用真实 `git check-ignore`。克隆到「无原数据库」的完整演练（独立 SQLite/Core/UI）属 WP-08 → W4R1-03 |
| **AC-088 历史需求展示** | **组件级通过** | `probe3`：completed 摘要 + 功能/代码引用 + `codeRevision`；cancelled 保留原因；archived 保留 `previousLifecycle`；`evidenceNotice='详细证据未迁移'`、`summary_only`、`countsAsLocalVerification:false`；queued 无历史摘要 |
| **AC-092 需求导入冲突与幂等** | **组件级通过** | `probe3`：两次导入 `unchanged` 且状态逐字相同；同版本异内容/旧版本/批内重复/无法读取逐条 `REQUIREMENT_CONFLICT`（含本地与来件 Hash）；冲突行保留、投影 revision 不推进；`stale_projection` 拒绝覆盖、内容未变记录仍可导入；刷新投影后新版本可导入且 `localVersion` 独立自增。另有 WP-01 层的真实 SQLite 集成（`packages/core/test/requirements.integration.test.ts` 10 用例）覆盖同族冲突/幂等语义，但走的是 `RequirementProjection` 而非 WP-04 需求池路径（见 W4R1-03） |
| **AC-093 需求目录与正文一致性** | **组件级通过** | `probe3`：`metadataHash`（JSON 字节）/`contentHash`（LF 归一）/`recordHash` 组合公式可重算；正文版本标记与 JSON `version` 不一致 ⇒ 诊断；缺单文件、Hash 错、目录名≠id、池根与 `docs/agentdev/requirements/` 旧格式、被 Git 忽略均逐条诊断且不删除有效记录；README 缺失/陈旧 ⇒ `readmeOutOfDate` 且以记录重建。保存侧原子提交与 Context 加载留 WP-08/WP-05 |

---

## 5. Findings（W4R1-xx）

### W4R1-01 [P1] 仅根级文件的项目无法通过 Ready 门禁 —— AC-026 不可完成（阻断）

- **现象**：`Ready` 门禁要求「至少一个真实能力**或**明确空项目状态」（`context.md` §4）。`generateCandidateKnowledge` 的能力来自 `moduleKeyOf(path)`，而该函数对**根级文件**（`segments.length < 2`）返回 `null`；`emptyProject` 又按 `scan.indexTotal === 0` 判定。于是「索引非空 + 根级文件不构成模块」的项目两个分支同时为假，`evaluateReadyGate` 的 `feature-or-empty-project` 永远失败。
- **复现（`/tmp/wp04r/probe5-rootonly.mjs`，3 形状 3/3 失败；命令：真实 `git` 临时仓库 + `createInitializer` 正常驱动）**：
  - `README.md` + `main.ts`：`reads=["README.md","main.ts"]`、`featureCount=0`、`emptyProject=false` → `failed/ready-gate`，`details['feature-or-empty-project']="既没有候选能力也不是明确的空项目状态"`，`resume` 复跑得到同一 `ready-gate` 失败。
  - `README.md` + `main.py` + `test_main.py`（即 AC-026 的「有代码测试」形状）：同上，`reads` 3 个。
  - 仅 `README.md`（实践中的「空项目」形状）：同上。
  - 对照：同一仓库加入 `src/mod.ts` 后**同一条流程可达 Ready**（`probe5` `module-directory-makes-project-initializable`），证明判别式确实是「是否存在 ≥2 段路径的模块目录」，与代码量/测试量无关。
- **影响**：AC-026「旧项目初始化」在一类合法仓库（单文件脚本、扁平脚本仓库、仅 README 的新仓库）上确定不可完成；`resume` 不是恢复手段（判据无用户动作可改变），且 `failed` 会覆盖记录状态，用户仅能改仓库结构。属 `workflow.md` §6 的 P1（需求缺失/错误行为），阻断 WP-04 退出条件「候选知识、投影和读取/写入保护组件通过上述检查」。
- **未登记**：`implementation.md` 残余 3 声称「其他源文件层」已解决「仅有源码的旧项目无法产出可观察模块」，但该层只对 `src/**` 这类 ≥2 段路径生效，根级源码仍被丢弃；仓库既有 7 个 WP-04 测试文件的 fixture **全部**使用 `src/app/main.ts` 之类 ≥2 段路径，无一根级用例（`grep` 复核：`packages/workspace/test/*.ts` 中 0 处根级源码 fixture）。
- **建议最小修法（保持 fail-closed、不虚构行为）**：二者取一并补长期断言 ——（a）为根级源码生成候选能力（如 `moduleKey='.'`/`'root'`，`name` 用仓库名或 `根级文件`，`module` 用 `未调查`/仓库名），使 `feature-or-empty-project` 由真实能力满足；或（b）在门禁中把「索引有源码但未形成模块」视为显式未知并放行，同时在候选文档与 `unknowns` 中写明「未形成模块的根级文件，产品意图未确认」。两种修法都必须新增 ≥2 条长期断言（仅 README；README+根级源码+根级测试）并保留空目录与 `src/**` 形状的回归。

### W4R1-02 [P2] 投影一句话摘要在任意 ASCII `.` 处截断（不阻断，须在 WP-05 消费索引前修）

- **现象**：`firstSentence` 以 `SENTENCE_END = /[。．.!！?？\n]/u` 找首个终止符，未要求其后是空白/行尾，故小数、版本号、扩展名、域名等 ASCII `.` 都会截断句子。`knowledge.md` §32 要求「索引给一句话摘要及链接」。
- **证据**：`/tmp/wp04r/probe2-views.mjs` `summary-is-the-whole-first-sentence`（唯一失败项）：`firstSentence('支持 v1.2 语义与 .ts 扩展名。')` = `支持 v1`，渲染行 = `| F-00000001 | 订单 | order | 支持 v1 | [订单](F-00000001/README.md) |`；中文句号路径正确（`支持取消订单。随后释放库存。` → `支持取消订单`）。
- **影响**：索引/`documentHashes` 派生的导航摘要在含版本号、文件扩展名、`e.g.` 等文本上不完整；WP-05 `ContextBuilder` 会消费该索引，可能按截断摘要做选择（正文与链接本身不受影响，故判 P2 而非 P1）。
- **建议**：把终止判据收紧为「`。！？` 或（`.`/`!`/`?` 且其后为空白或行尾）」；补 ≥3 条断言（版本号、扩展名、英文缩写）。

### W4R1-03 [P3] plan §5 承诺的 WP-04 集成演练未落地、也未显式登记承接

- **现象**：`plan.md` §5 写明「集成（真实文件系统 + 真实 SQLite）：临时 Git 仓库上的扫描 → 候选 → 写入 → 投影 → 查询；需求池 Clone 导入演练（无原数据库）」。实际 `pnpm test:integration` 10 文件 / 124 用例中**无 WP-04 用例**：10 个文件为 `apps/cli/test/{container,doctor}`、`apps/runner/test/attempt`、`packages/core/test/{dispatcher,events-hub,identity,requirements}`、`packages/pi-runtime/test/session`、`packages/storage/test/{ledger,migrations}`；其中 `requirements.integration.test.ts`（10 用例，真实 SQLite）覆盖的是 `packages/core` 的 `RequirementProjection`（WP-01 的 `data.md` §2 投影：幂等导入、版本前进、同版本异内容/旧版本冲突、事务写入），**不经过 WP-04 的 `parseRequirementPool`/`importRequirementPool`，也不读两文件记录目录或临时 Git 仓库**。WP-04 的 7 个测试文件（126 用例）全在 unit 层（虽使用真实临时目录与真实 `git`）。
- **影响**：AC-087/088/092/093 的验收证据句要求「临时Git仓库、独立SQLite与Core/UI集成演练」。WP-04 的退出条件已明确「集成发布由 WP-08 完成」，因此不判 P1/P2；但 `implementation.md` 只登记了「SQLite 落地留 WP-08」（残余 1）与「真实 Provider/HTTP/WS/Docker 不在本包」（残余 6），**未登记** plan 承诺的这条集成演练去向，评审/测试无法从记录判断是「已完成」还是「承接」。
- **建议**：在 `implementation.md` 显式登记「WP-04 集成演练（真实 SQLite 上的扫描→候选→写入→投影→查询、需求池无原库导入）承接至 WP-08」，或补一条真实的 WP-04 集成用例（投影落 SQLite 表 + 需求池导入后列表可查）。

### W4R1-04 [P3] 用错处置 API 会把初始化记录置为不可恢复的 `failed/internal`

- **现象**：`resolveBlocker` 对 `git-initialization`/`confirmation-required`/`design-conflict` 三种阻断返回 `VALIDATION_ERROR`，但同时经 `failed()` 把记录写成 `status:'failed'`、`failure.kind:'internal'`、`recoverable:false`；此后 `step` 一直返回 `failed/internal`，`resume` 返回 `INVALID_STATE`（"失败不可自动恢复"）。
- **证据**：`/tmp/wp04r/probe6-observations.mjs` O-1：`wrongKindDisposal='resolveBlocker marks status=failed, failure.kind=internal, recoverable=false'`、`stepAfter='failed/internal'`、`resumeAfter='failed/INVALID_STATE'`、`peerApiRecovers=true`（随后调用 `confirm`/`resolveConflict`/`authorizeGitInitialization` 可恢复，因为专用 API 会把 `status` 重置回当前阶段）。
- **影响**：调用方一次笔误即把「可继续的阻断」变成显示为永久失败的记录；数据不丢、专用 API 可恢复，故 P3。建议对「阻断类型不匹配」只返回 `VALIDATION_ERROR`（不写 `failure`/不置 `failed`），保持 `blocked` 状态不变。

### W4R1-05 [P3] `requirement:<id>@<version>` 引用不校验版本存在性

- **现象**：`resolveSourceRef` 对 `artifact:<id>@<version>` 会校验 id 与 version 都在已知集合内（否则 `ARTIFACT_MISSING`），但 `requirement:<id>@<version>` 只校验 id，来件版本原样返回；`designRefResolves` 同样忽略版本。
- **证据**：`probe6` O-4：`resolveSourceRef('requirement:R-1@99', {requirementIds:['R-1']})` → `{ok:true,kind:'requirement',id:'R-1',version:'99'}`；未知 id 仍 `NOT_FOUND`（正确）。
- **影响**：`verification_evidence_refs`/`design_decision_refs` 可指向不存在的记录版本而仍解析成功，削弱 AC-086「引用版本错 ⇒ 拒绝」在该引用形态上的强度。建议在 `SourceResolutionContext` 增加 requirement 版本集合并同 artifact 处理。

### W4R1-06 [P3] 三处次要宽松点（格式/索引/池根）

- **一级标题可满足固定 `##` 小节**：`parseFeatureDocument` 只比较标题文本不比较级别，`# 用途` 被接受为 `用途` 小节（`probe6` O-5 `level1HeadingAccepted=true`）。`context.md` §2 的模板写作 `##`；建议要求 level ≥2。影响：手工/生成文档的层级约束弱化，不产生数据错误。
- **指向目录的符号链接在索引里记 `kind:'file'`**：`walkDirectory` 对符号链接用 `entry.isDirectory()`（不跟随 ⇒ 恒 false），于是 `src/linked-dir -> <外部目录>` 记成 `kind:'file'`，既进入 `generateCandidateKnowledge` 的 `observedPaths`（可能影响 `detectKnowledgeConflicts` 的入口存在性判定），又计入 `indexTotal`（使「空项目」判定为 false）。逃逸本身被正确拒绝（`symlink-escape` unknown、不读目标，`probe5` 2/2 通过）。建议按 `canonicalPath` 的 stat 结果记 kind，或把符号链接单列 kind。
- **池根散落 `requirement.json` 被静默忽略**：`readPoolFiles` 对池根非目录项只在「`.json` 且不以 `requirement.json` 结尾」时按旧格式诊断，于是裸放一个 `requirement.json`（或任何非 `.json` 非法文件）不产生任何诊断（`probe6` O-3：`ok=true, errors=0, records=0`）。`requirements.md` §4 要求坏记录逐条显示；建议对该形状补 `REQUIREMENT_CONFLICT`/`LEGACY_REQUIREMENT_FORMAT` 诊断。

---

## 6. 记录与实现一致性核对（关键条目）

| 记录条目 | 核对结果 |
|---|---|
| T0：build 由 8 变 **10** workspace | 一致（`pnpm build` 10 个 `Done`） |
| T8：`test:unit` **26 文件 / 415 用例**、integration **124**、typecheck/lint/docs:check 0 | 一致（原始日志见 §2） |
| T1：`design=confirmed` 需有效 decision/requirement confirmedDecisions 引用；`passed` 需证据+覆盖+revision；`investigated` 需 scope+source_refs | 一致（probe1 35/35） |
| T2：非法 ⇒ 不发布、保留最后有效标 stale、诊断全 `KNOWLEDGE_INVALID`；断链不阻断发布、命中当前需求才阻断 | 一致（probe2） |
| T2：「缓存行同步标 stale」 | 一致（代码 `markStale` 遍历同 revision 行；`lastValid().state='stale'` 实测） |
| T3：三视图分离、Work 覆盖层不污染其它视图、stale `current:false` | 一致（probe2） |
| T5：预算 **40 文件 / 512 KiB**、索引上限 **10000** 分页、无 revision 用 `file:<path>`、`projectId=sha256(canonicalRoot)[0:32]` | 一致（`INITIALIZATION_BUDGET`；probe4 B3/B4；probe5） |
| T5：候选文档 `candidate:true`/`deliveryRef:null`/`updatesDeliveryRef:false` | 一致（probe4；本包未发现任何更新交付 ref 的路径） |
| T5 残余 3：最低优先级「其他源文件」层 | 代码注释存在（`scan.ts:246`），但**只对 ≥2 段路径生效**，根级源码仍无落点 → 见 W4R1-01 |
| T6：中断按 Hash 恢复/冲突不覆盖/脏工作区阻断/无 Git 只读/门禁复核 | 一致（probe4 全通过） |
| T7：逐条诊断、幂等、`stale_projection`、历史摘要 `详细证据未迁移` | 一致（probe3 43/43） |
| T8 残余 5：Writing 脏门禁过滤自身写入路径、`checkDeliveryReadiness` 不过滤 | 一致（probe4 中断恢复在自写文档存在时未被误阻断；Case D 首轮阻断） |
| plan §5：WP-04 集成演练（真实 SQLite + 投影查询） | **不一致**：无 WP-04 集成用例，记录未登记承接 → W4R1-03 |
| plan §2：contracts/storage 路径「若缺失则补齐」 | 未改动也不需要，记录未声称已改，一致 |
| plan §7/T3 声称的「不复用旧决策引用」等表述 | 视图实现按入参投影即时构造，未发现跨投影缓存旧引用；因无可判定断言，本报告不将其计为已验证项（覆盖边界见 §9） |

---

## 7. 计数与阻断判定

| 严重度 | 数量 | 编号 |
|---|---|---|
| P0 | **0** | — |
| P1 | **1** | W4R1-01 |
| P2 | **1** | W4R1-02 |
| P3 | **4** | W4R1-03、W4R1-04、W4R1-05、W4R1-06 |

| 阻断项 | 严重度 | 阻断内容 | 解除条件 |
|---|---|---|---|
| W4R1-01 | P1 | WP-04 退出「候选知识…通过检查」与 AC-026：仅根级代码/测试或仅 README 的项目 Ready 死锁 | 按 §5 最小修法落地 + ≥2 条根级形状长期断言 + 空目录与 `src/**` 形状回归 |
| W4R1-02 | P2 | 非阻断；建议在 WP-05 消费索引前修 | — |
| W4R1-03/04/05/06 | P3 | 非阻断；其中 W4R1-03 需在 `implementation.md` 补承接登记 | — |

## 8. 能否进入独立 Test —— **不能**

理由：W4R1-01 为 P1，且落在 WP-04 的验收面（AC-026 的「旧项目初始化」），独立 Test 若按验收口径构造「仅根级代码+测试的旧项目」将确定性复现 `failed/ready-gate`，Test 结论会被同一缺陷支配。修复轮最低要求：

1. **修 W4R1-01**（必须）：任选 §5 的 (a)/(b) 一种，且不得放宽其它门禁（非法知识、断链、脏工作区、冲突、交付 ref 不变仍须 fail-closed）；必须补长期断言——仅 `README.md`、`README.md`+根级源码、`README.md`+根级源码+根级测试 三形状可达 Ready，空目录与 `src/**` 形状不回归。
2. **记录订正**（必须）：`implementation.md` 补 W4R1-03 的集成演练承接登记；如采纳 (a)/(b)，同步订正残余 3 的「其他源文件层」表述，避免再次声称覆盖根级源码。
3. **建议**（可在本轮或 WP-05 前）：修 W4R1-02；`resolveBlocker` 类型不匹配改为非破坏性返回（W4R1-04）；`requirement@version` 版本校验（W4R1-05）；三处宽松点（W4R1-06）。
4. **Test 最小覆盖矩阵**：AC-025 空目录（含授权前不建 `.git`）、AC-026 根级与嵌套两种形状（代码不移动、无 Requirement）、AC-027/028/029（中断/冲突/门禁篡改/脏处置）、AC-040 非法知识（发布拒绝 + stale + 断链按需求阻断，含「无需求范围不阻断」负例）、AC-086 正负例、AC-042 设计/代码冲突、AC-087/088/092/093 组件级（本地状态 + 真实临时 Git；SQLite/Core/UI 集成按 W4R1-03 归 WP-08）。

## 9. 方法与边界声明

- 本轮只审阅 `9ee1a82` 的仓库状态，不读取开发会话；所有结论可由 `/tmp/wp04r/*.mjs` 与上表命令复现。冻结前后 `git status --porcelain` 为空。
- **覆盖边界（未验证项，测试/后续包需承接）**：`feature_projection` 的 SQLite 落地与交付提交/CAS（WP-08）；`GitPort`/`FileSystemPort` 的真实提交事务与崩溃注入（本包只验证文件写入的 temp+fsync+rename 与状态存储）；HTTP/WS 接线与 `project.initialize` 等协议面；需求池保存侧（`requirement.json`+`content.md` 原子提交、正文版本递增）与 Context 加载两文件同 revision；真实 Provider 纵向；`views` 的「不复用旧决策引用」等无独立断言可判定的表述；AC-039 的实际上下文选择接线（WP-05）。
- 本轮未做：跨平台/Windows 路径、超大仓库性能、并发多进程同时写同一 `InitStateStore` 文件、以及 `diagnoseLinks` 对 `trees` 为 Map 等类型契约的运行时误用（TS 层可拦，实测传入非 Map 会抛 `TypeError`，非本包验收面）。
- 严重度口径：`workflow.md` §6 —— P0 数据/安全或关键不可用、P1 错误行为/需求缺失、P2 局部质量/维护、P3 建议；P0/P1 阻断。

## 文末打印（本轮取证汇总）

- **结论：FAIL**（`0×P0`、`1×P1`、`1×P2`、`4×P3`；阻断项 W4R1-01）
- 冻结点：`git rev-parse HEAD` = `9ee1a8263454b69d627a48613253923d709c56cc`；`git rev-parse HEAD^{tree}` = `5a2ca58287e7591f35bac358ae0434146b3714d2`
- 报告写入后 `git status --porcelain` 最后一行 = `?? .agentdev/work/WP-04/review.md`
- 契约命令：install/typecheck/lint/docs:check/test:unit/test:integration/build = **7/7 exit 0**（unit 26 文件 415 用例；integration 10 文件 124 用例；build 10 workspace）
- 证据脚本与用例数：`probe1-format.mjs` 35/0、`probe2-views.mjs` 40/1、`probe3-pool.mjs` 43/0、`probe4-init.mjs` 76/1、`probe5-rootonly.mjs` 23/3、`probe6-observations.mjs` 14/0 = **231 例、5 例失败，映射 2 个缺陷（W4R1-01 P1、W4R1-02 P2）**
