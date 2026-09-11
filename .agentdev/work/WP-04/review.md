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
