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
