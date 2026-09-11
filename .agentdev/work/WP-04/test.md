# WP-04 独立 Test 报告（知识与新旧项目）

- 测试对象：工作包 WP-04「知识与新旧项目」（`docs/delivery/implementation.md` WP-04）
- 测试角色：**Test**（独立上下文；未读取任何开发对话、Plan 讨论或 Review 会话；只依据仓库文件、git 对象与我自建的实验脚本及其原始输出）
- **代码冻结点：`165400423ff47bf85fc7c21b63e71c0e03b1f3c9`（`fix(workspace): harden the budget-grant APIs against misuse and path escape`）**
- 仓库 HEAD：`909a49b5936631c311c3e4a8ab402dca83edeca4`（`docs(review): WP-04 independent review report, round 3 (PASS)`）
  - `git diff --stat 1654004 HEAD` = 仅 `.agentdev/work/WP-04/review.md`（+246）；`git diff --name-only 1654004 HEAD` 只列该文件 ⇒ **被测代码与 `1654004` 逐字节相同**，HEAD 只是它之上的一次文档提交。
  - `git status --porcelain` 在测试前后均为空；唯一新增是本报告自身，按既有惯例单独提交（`docs(test): WP-04 independent test report (PASS)`，不夹带代码改动）。报告提交后 `git diff --name-only 1654004 HEAD` 只列 `.agentdev/work/WP-04/review.md` 与本文件，被测代码树仍与 `1654004` 一致。
- 测试方法：在 `/tmp/wp04t/` 自建夹具与 8 组实验脚本（`exp1..exp8.mjs`，共 **484 条断言 0 失败**）＋ 2 组原始证据导出（`evidence.mjs`、`evidence2.mjs`），全部通过 `/tmp/wp04t/node_modules/@agentdev/*` 软链消费 `pnpm build` 产出的 `packages/*/dist`；**不 import 任何产品测试文件**。
- 环境：`node v24.8.0`、`pnpm 12.3.4`、macOS（Darwin，宿主执行）；真实临时目录 + 真实 `git` 命令 + 真实文件系统；**无真实模型 Provider、无网络**。
- 权威依据：`docs/delivery/acceptance.md`（AC-025–029、AC-037–040、AC-042、AC-086–088、AC-092–093 原文）、`docs/delivery/implementation.md` WP-04、`docs/architecture/{context,data,ARCHITECTURE}.md`、`docs/product/{knowledge,requirements}.md`、`.agentdev/work/WP-04/{plan,implementation,review}.md`、`packages/knowledge/src/**`、`packages/workspace/src/**`、`packages/contracts/src/**`。

---

## 1. 结论摘要

| AC | 题目 | 本轮结论 | 关键证据 |
|---|---|---|---|
| AC-025 | 空项目 | **通过** | 空目录 → `git init -b agentdev/main` + 空初始提交 + 四入口文档；PROJECT 记未实现、`candidate:true/deliveryRef:null`，Ready 门禁通过 |
| AC-026 | 旧项目初始化 | **通过** | 预算内读取 ≤40 文件/512 KiB、来源 `git:<sha>:<path>`、未知显式、代码零移动、无 Requirement 产物、候选恒 `design=unconfirmed`；预算受限时 `partial` + 缺口显式 |
| AC-027 | 目录项目 | **通过** | 无 Git 只读调查全程可完成且零写入；正式写入前必得 `git-initialization` 授权（`NOT_AUTHORIZED`），授权后才建仓库/分支 |
| AC-028 | 脏工作区 | **通过** | 逐路径哈希报告阻断交付；内容与未跟踪文件零改动；只读调查不受影响；声称“已提交”而实际仍脏被拒；真实提交后处置生效 |
| AC-029 | 初始化冲突中断 | **通过** | 注入写失败 → `interrupted`（可恢复、保留回执）→ `resume` 按内容 Hash 续写并到 Ready；内容冲突不覆盖、`resume` 拒绝直到处置；Ready 最小门禁 6 项 |
| AC-037 | 当前功能 | **通过** | 冷启动单次查询即得最新 `当前行为`/约束/来源 Revision；一句摘要来自用途 |
| AC-038 | 状态分离 | **通过** | design/delivered/work 三视图严格分离；work 覆盖层 `notDelivered`，查询前后 design/delivered 逐字节相同，其他 Work 不可见 |
| AC-039 | 语义关系 | **部分通过** | 关系四列、`constrained_by` 约束进入 delivered、关系图与来源可解析、无关功能不进入约束集；**Snapshot/ContextSelection 面属 WP-02 AC-030**（见 §8-NC3） |
| AC-040 | 非法知识 | **通过** | 重复 ID/缺字段/未知枚举/缺标题/空关系表/owner 不符 → 不发布、`KNOWLEDGE_INVALID`、保留最后有效并标 stale（`staleSince`/`staleReason`）；断链为诊断、命中当前需求才阻断 |
| AC-042 | 观察与意图 | **通过** | `design=unconfirmed+implemented` ⇒ `observed_not_confirmed`（`mustNotAcceptObserved:true`）；`confirmed+absent` ⇒ 差距；冲突阻断 Confirming 直到逐条决定 |
| AC-086 | 功能状态证据 | **通过** | confirmed 缺/坏 decision 引用、passed 缺证据/覆盖/Revision 不符、investigated 缺 scope/source 全部拒绝；完整样例通过 |
| AC-087 | 需求池随 Git 迁移 | **通过**（Git 面） | 真实 `git clone` 后仅凭仓库即恢复稳定 ID/目标/范围/验收/已确认结论/未决项；两次导入幂等；无本机 DB 亦可读 |
| AC-088 | 历史需求展示 | **通过**（Git 面） | completed 摘要/代码 Revision/功能引用、cancelled 原因、archived 归档前状态全部保留；标 `详细证据未迁移`、`countsAsLocalVerification:false` |
| AC-092 | 导入冲突与幂等 | **通过**（Git 面） | 同版本异内容/旧版本/重复 ID/记录不可读逐条 `REQUIREMENT_CONFLICT`；本机 `localVersion` 与 `recordVersion` 分离；投影未刷新时拒绝覆盖；修复后显式导入解除 |
| AC-093 | 目录与正文一致性 | **通过**（解析面） | 两文件共享版本、正文修改递增版本且组合 Hash 变化；缺 README 可重建；缺文件/坏 Hash/被忽略/旧格式逐条明确；冲突不放行 |

**Test 判定：PASS —— 接受 WP-04 的 AC-025/026/027/028/029/037/038/040/042/086/087/088/092/093，AC-039 判“部分通过”（关系与来源面通过，Snapshot 选择面承接 WP-02）。**

- 15 个 AC：**14 通过 / 1 部分通过（AC-039） / 0 不通过**。
- 5 项必需失败测试（初始化中断、非法 Feature、重复 ID、断链、代码设计冲突）**全部实测复现并通过**（§5）。
- 6 条契约命令 **6/6 退出 0**（§3）：`unit 26 文件 / 426 用例`、`integration 10 / 124`、`build 10 workspace`、`docs:check ok`。
- 自建实验 **484 断言 0 失败**；另做对抗性探针（§6）未发现新的 fail-open。
- **2 项非阻断 Finding**（T-01 P2、T-02 P2）与 8 项观察（O-01..O-08），均不构成 AC 阻断，详见 §7。
- **4 类面未覆盖**（§8）：需求池的 SQLite/Core/UI 集成演练、`requirement.save` 的 Git 原子提交、需求正文的 Context 双来源装载、正式交付提交/CAS——均与 `implementation.md` T9-W4R1-03 的承接声明一致。

---

## 2. 测试环境与复现方式

```text
export PATH="$HOME/.local/bin:$PATH"
cd /Users/huyaohua/huyh/work/aigrouptool && pnpm build      # 实验只消费 dist
mkdir -p /tmp/wp04t/node_modules/@agentdev
for p in contracts domain storage knowledge workspace; do
  ln -sfn /Users/huyaohua/huyh/work/aigrouptool/packages/$p /tmp/wp04t/node_modules/@agentdev/$p
done
cd /tmp/wp04t && for e in 1 2 3 4 5 6 7 8; do node exp$e.mjs; done
```

| 脚本 | 覆盖 | 断言 |
|---|---|---|
| `/tmp/wp04t/lib.mjs` | 夹具库：Feature 文档构造器、需求记录构造器、真实 git 包装、断言器 | 基础设施 |
| `/tmp/wp04t/exp1.mjs` | AC-037 / AC-038 / AC-039 / AC-042 | **40 passed / 0 failed** |
| `/tmp/wp04t/exp2.mjs` | AC-040 / AC-086 + 必需失败测试：非法 Feature、重复 ID、断链 | **56 / 0** |
| `/tmp/wp04t/exp3.mjs` | AC-025 / AC-027 / AC-028（真实 `git init`、真实仓库、真实脏工作区） | **69 / 0** |
| `/tmp/wp04t/exp4.mjs` | AC-026 / AC-029 + 必需失败测试：初始化中断、代码设计冲突 | **75 / 0** |
| `/tmp/wp04t/exp5.mjs` | AC-087 / AC-088（真实 Git 仓库 + 真实 `git clone` 到“空白服务器”） | **51 / 0** |
| `/tmp/wp04t/exp6.mjs` | AC-092 / AC-093（混合坏记录、忽略规则、旧格式、幂等与冲突矩阵） | **66 / 0** |
| `/tmp/wp04t/exp7.mjs` | 对抗性探针：预算耗尽 ≠ 空项目、无能力确认、API 误用、document-root 逃逸 | **79 / 0** |
| `/tmp/wp04t/exp8.mjs` | 对抗性探针：结构不可信、取值、证据接缝、渲染回环、摘要、需求 Schema | **48 / 0** |
| **合计** | | **484 passed / 0 failed** |

脚本、日志与证据：`/tmp/wp04t/{lib,exp1..exp8,evidence,evidence2}.mjs`、`/tmp/wp04t/run-all.log`、`/tmp/wp04t/logs/{typecheck,lint,contracts}.log`、`/tmp/wp04t/evidence.json`。

---

## 3. 契约命令原始结果与仓库状态

执行方式：`export PATH="$HOME/.local/bin:$PATH"`，仓库根目录按序执行；日志 `/tmp/wp04t/logs/`。

| 命令 | 退出码 | 原始结果要点 |
|---|---|---|
| `pnpm typecheck` | **0** | `tsc -p tsconfig.json --pretty false`，无输出 |
| `pnpm lint` | **0** | `Checking formatting... All matched files use Prettier code style!` |
| `pnpm test:unit` | **0** | `Test Files 26 passed (26)` / `Tests 426 passed (426)` |
| `pnpm test:integration` | **0** | `Test Files 10 passed (10)` / `Tests 124 passed (124)` |
| `pnpm build` | **0** | 10 个 workspace 全部 `Done`：contracts、domain、storage、knowledge、workspace、pi-runtime、core、apps/{cli,daemon,runner} |
| `pnpm docs:check` | **0** | `docs:check ok — 15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages` |

WP-04 自身回归网（`pnpm test:unit` 实测用例数）：`knowledge` 102（feature-format 44、requirements-pool 25、projection 13、relations 11、views 9）、`workspace` 35（initialize 19、scan 16）＝ 137 用例。

仓库状态（测试前后各核验一次）：

```text
HEAD=909a49b5936631c311c3e4a8ab402dca83edeca4
git status --porcelain        # 无输出
git diff --name-only 1654004 HEAD
  .agentdev/work/WP-04/review.md
git rev-parse HEAD^{tree}      # 62dbdf96d9efca85e9f9287b58eaf79a7dd8614b
git rev-parse 1654004^{tree}   # 915b619f1b46deda5d62012125e1e440949c65a1（两树仅差 review.md）
```

---

## 4. AC 逐项证据

以下每条给出“实测步骤 → 原始观察”。为可读性，`PASS` 行对应 §2 脚本中的具体断言名，原始输出见 `/tmp/wp04t/run-all.log`。

### AC-025 空项目（通过）

1. `tempDir()` 建空目录 → `createInitializer({store: 内存, git: NodeGitPort})` → `start` → `step`×3。
2. 观察：`identifying→mapping→confirming→writing`；`emptyProject:true`；writing 阶段返回 **blocked**：

```json
{"kind":"git-initialization","code":"NOT_AUTHORIZED",
 "request":{"root":"<tmp>","branch":"agentdev/main","initialCommit":true}}
```

3. 授权前：`gitPort.isRepository(root)===false`、`docs/` 不存在；`investigate()` 仍 `ok:true` 且 `wroteFiles:false`。
4. `authorizeGitInitialization` 后：`git branch --show-current === "agentdev/main"`、HEAD 为 40 位 OID、`docs/agentdev/{PROJECT.md,INDEX.md,CODE_MAP.md,features/README.md}` 全部落盘、PROJECT 记 `absent/未实现` 且带候选横幅。
5. `record.candidate===true`、`record.deliveryRef===null`、`verifyReady().ok===true`。

### AC-026 旧项目初始化（通过）

夹具：README（不完整）+ `src/orders/{cancel,order}.ts` + `src/payments/pay.ts` + `tests/orders/cancel.test.ts`（未付款）+ `tests/payments/paid.test.ts`（已付款），真实提交。

- `investigateWorkspace` → `ok:true`、`featureCount≥2`、`reads ≤40`、`Σbytes ≤512 KiB`、`wroteFiles:false`、`gitRevision === HEAD`。
- `scanProject` → `completeness:"complete"`、`claimsFullUnderstanding:false`；`generateCandidateKnowledge` → `candidate:true`、`updatesDeliveryRef:false`、`deliveryRef:null`；候选 Feature `source_refs` 全为 `git:<40hex>:<path>`、`design:unconfirmed`；每个候选文档 `candidate:true && deliveryRef:null`。
- 代码零移动：调查前后目录清单逐项相同；`no requirement pool was created`（`.agentdev/requirements` 不存在）。
- 预算受限（`maxBodyFiles:1`）→ `partial:true`、`unknowns` 含 `budget-body-files`。
- 完整初始化到 Ready：`record.documents` 全为候选、`deliveryRef:null`、无 Requirement 产物、候选 Feature 文档仍写 `| design | unconfirmed |`、Ready 门禁通过、代码仍在原地。

### AC-027 目录项目（通过）

1. 无 Git 目录（README + `src/orders.ts`）：`investigateWorkspace` → `ok:true`、`gitRoot:null`、`wroteFiles:false`、观察到的模块 ≥1、候选文档路径 ≥4；调查前后目录清单逐项相同。
2. 初始化器推进到 writing → **blocked**（`git-initialization`/`NOT_AUTHORIZED`）；此时 `isRepository===false`、`docs/` 不存在、`gitAuthorization===null`。
3. 授权后：仓库建立、分支 `agentdev/main`；随后因既有代码未跟踪触发 `dirty-workspace`（与 AC-028 同口径），显式处置后到达 Ready；用户代码未被移动。

### AC-028 脏工作区（通过）

夹具：已提交 `README.md`+`src/app.ts`；用户改 `src/app.ts`（未提交）并新增 `notes.md`。

- 只读调查 `ok:true`、`wroteFiles:false`。
- 交付启动 **blocked**：

```json
{"kind":"dirty-workspace","code":"INVALID_STATE",
 "message":"工作区有 1 个未提交路径，交付写入被阻断；需用户明确处置（只读调查不受影响）",
 "hashReport":[{"path":"src/a.ts","state":" M","sha256":"e7941bea…86d2"}]}
```

- 阻断期间：用户文件内容逐字节不变、`notes.md` 仍在、`docs/` 未创建。
- 以 `dirtyChoice:"committed"` 声称已提交而工作区仍脏 → 再次 blocked，`dirtyHandling` 保持 `null`（不误记处置）。
- 用户真实提交后再处置 → Ready；处置记录 `choice:"committed"`、内容不变、用户提交仍在历史里。

### AC-029 初始化冲突中断（通过）

**中断（必需失败测试）**：注入 FileSystemPort 在第 3 次 `writeFile` 抛错 → `status:"failed"`、`failure.kind:"interrupted"`、`recoverable:true`、`errors[0].code:"INTERNAL_ERROR"`、`phase:"writing"`、已留 2 条 `writes` 回执；`resume` → **Ready**，且先前两次写入按内容 Hash 判定为已一致未重写；`evidence` 含 `resume` 行；`verifyReady().ok===true`。

**内容冲突不覆盖**：预置已提交的 `docs/agentdev/PROJECT.md`（内容不同）→

```json
{"status":"failed","kind":"content-conflict","code":"KNOWLEDGE_INVALID",
 "message":"已存在内容不同的文件，停止写入且不覆盖：docs/agentdev/PROJECT.md（disk=c3c9eb…cf1e candidate=c4665a…c457）",
 "fileConflicts":[{"path":"docs/agentdev/PROJECT.md","diskHash":"c3c9eb…cf1e","candidateHash":"c4665a…c457"}]}
```

处置前 `resume` 再次失败且磁盘文件逐字节不变；用户采纳候选内容后 `resume`（必要时再走脏工作区处置）到达 Ready，`fileConflicts` 清空。

**Ready 最小门禁**：`verifyReady()` 返回 `ok:true` 且含 `candidate-documents-written`、`feature-or-empty-project`、`sources-and-unknowns`、`documents-parse`、`no-unresolved-conflict`、`candidate-only-no-delivery-ref` 等检查；改动入口文档后门禁 `ok:false` 且 `missing` 指名 `candidate-documents-written`；`record.deliveryRef` 全程为 `null`。

### AC-037 当前功能（通过）

- 功能正文承载“第二次需求修改后”的最新行为与约束；仅凭投影做一次冷启动 `queryFeatureView(delivered)` 即得 `currentBehaviour` 含“30 分钟内可撤销”、`constraints` 含支付约束、`sourceRevision:"rev-knowledge-1"`、`current:true`。
- 索引摘要取用途首句“允许用户取消未付款订单”；未读任何需求历史即可回答。

### AC-038 状态分离（通过）

- `design` 视图给 `design:"confirmed"` + 独立 `implementation:"absent"`；`delivered` 给 `currentBehaviour`/`gaps`；`work` 视图 `notDelivered:true`、`overlay.goal` 为 Work 目标、`delivered` 保留基线。
- work 查询前后 `design`/`delivered` 响应 JSON 逐字节相同（零污染）；另一 Work 查非本 Work 功能时 `overlay:null` 且 `unknowns` 提示未声明。
- `view:"work"` 缺 overlay → `VALIDATION_ERROR`（无部分视图）；未知功能 → `NOT_FOUND`。

### AC-039 语义关系（部分通过）

- 关系表四列解析为 `{targetFeatureId, kind:"constrained_by", reason, source}`；关系图 1 条边、无 `missingTargets`。
- `delivered` 视图约束集恰为该关系 `reason`；无关功能的三态描述不进入约束集。
- 未覆盖面：AC-039 的“相关约束与来源进入 **Selection/Snapshot**、无关文档不默认加载”属 `docs/architecture/context.md` §1 的 Context 选择链路（WP-02 AC-030 的 Snapshot 面），本包只提供关系、`reason` 与可解析 `source`。见 §8-NC3。

### AC-040 非法知识（通过）

- 先发布 `rev-1`（valid，缓存行 `state:"valid"`）；再以重复 ID 构建 `rev-2` →

```json
{"published":false,"stale":true,
 "projection":{"revision":"rev-1","state":"stale","staleSince":"rev-2",
   "staleReason":"非法 Feature 知识，拒绝发布：1 项（首个 features/F-00000001/README.md: missing required field: name）"}}
```

缓存行转 `stale`、`rev-2` 无行；保留投影的视图 `current:false`、`projectionState:"stale"` 且 `unknowns` 明示“不得作为当前事实”。冷启动失败（无历史投影）时 `projection:null`、`stale:true`。
- 逐项矩阵（缺字段、未知枚举、缺标题、空关系表、`owner_document` 不符）全部拒绝发布并标 stale。
- 断链：关系目标不存在/来源路径不在冻结 Revision → `error` 级诊断、文档本身仍合法、投影仍发布；命中当前需求时 `deliveryBlocked:true`/`blockedFeatureIds:["F-00000001"]`，无关区域（`currentRequirementFeatureIds` 不含该功能）不阻断。

### AC-042 观察与意图（通过）

- `design:"unconfirmed"` + `implementation:"implemented"` + 非空 `source_refs` → `observedVsConfirmed` 得 `observed_not_confirmed`、`mustNotAcceptObserved:true`、消息“不得作为已确认意图”。
- `design:"confirmed"` + `implementation:"absent"` → `confirmed_not_observed`（差距，非错误）；设计/实现一致的功能无分歧项。
- `diagnoseLinks` 对观察实现只给 `warning`（“recorded as observed, not confirmed”），未擅自确认；可解析引用不产生假错误。

### AC-086 功能状态证据（通过）

| 规则 | 观测 |
|---|---|
| `design=confirmed` 无引用（`无`） | 拒绝，`field:"designDecisionRefs"` |
| `design=confirmed` 引用不可解析 decision | 拒绝，`field:"designDecisionRefs"` |
| `verification=passed` 证据为空 | 拒绝，`field:"verificationEvidenceRefs"` |
| `verification=passed` 覆盖为空 | 拒绝，`field:"verificationCoverage"` |
| `verification=passed` 且 `revision ≠ codeTreeRevision` | 拒绝，`field:"revision"`（`revision===codeTreeRevision` 时通过） |
| `investigation=investigated` 缺 scope / 缺 source_refs | 分别拒绝，`field:"investigationScope"` / `"sourceRefs"` |
| 模板占位（`decision:<真实ID>`） | 拒绝，指名字段 |
| 完整有效样例 | **通过** |

### AC-087 需求池随 Git 迁移（通过，Git 面）

1. 在仓库 A 写 4 条需求（queued/completed/cancelled/archived）＋由 `rebuildPoolReadme` 生成的 `README.md`，提交（HEAD `originRevision`）。
2. `git clone A <空白服务器>/project` → B 的 HEAD 与 A 相同；B 无任何数据库、无 `docs/agentdev/PROJECT.md`（未做产品知识初始化）。
3. `parseRequirementPool({repoRoot:B, revision:serverRevision, storedReadme})` → `ok:true`、4 条、`readmeOutOfDate:false`、`legacyPaths:[]`。
4. queued 需求：`goal`、`scope`（`readPaths/writePaths/operations/networkTargets` 深比较相等）、2 条 `acceptance`、`confirmedDecisions[0].id="dec-cancel-1"`、1 条 `openQuestions` 全部保留；列表 README 与正文均可直接读（无 AI 解析）。
5. `importRequirementPool({local:{records:[]}, commit:true})` → 4×`created`、0 冲突、`state.revision=serverRevision`；`localVersion:1`、`recordVersion:1`、`sourceRevision:serverRevision`、`evidenceAvailability:"summary_only"`、`evidenceNotMigrated:true`。
6. 再次导入 → 4×`unchanged`、`localVersion` 仍为 1、`state` JSON 与首次逐字节相同。

### AC-088 历史需求展示（通过，Git 面）

| 记录 | 观测 |
|---|---|
| completed | `completion.summary`、`codeRevision`、`featureIds`、`verificationSummary`、`remainingIssues` 全保留；`evidenceNotice:"详细证据未迁移"`；`countsAsLocalVerification:false` |
| cancelled | `cancellation.reason` 与 `cancelledAt` 保留；无 completion；`countsAsLocalVerification:false` |
| archived(previous=completed) | `previousLifecycle:"completed"` + completion 摘要/功能引用保留；`evidenceNotice` 同上 |
| queued | `importedHistorySummary(...) === undefined`（无历史可展示） |

列表 README 含全部 4 条标题，可直接渲染；未提交导入时 `sourceRevision` 回落 `working-tree`。

### AC-092 需求导入冲突与幂等（通过，Git 面）

| 场景 | 观测 |
|---|---|
| 混合坏池（坏 Hash、版本标记不符、目录名≠id、缺文件、两种旧格式） | `ok:false`、有效记录仍返回 1 条、错误逐条带 `requirementId`/`path`、坏记录与旧文件均未被删除 |
| 同版本异内容 | `REQUIREMENT_CONFLICT` / `same_version_different_content`，本地行 Hash 不变、被 `skipped` 而非删除、投影不前进 |
| 重复同一冲突导入 | 冲突按需求 ID 计 1 条（不累积） |
| 更新版本（投影已刷新） | `updated`、`localVersion` 独立递增、`recordVersion` 跟随 Git、正文与 Hash 均取新值 |
| 本机计数器超前（localVersion=7） | 记录 `unchanged` 且本机计数器保持 7（两版本各自处理） |
| 旧版本传入 | `incoming_version_older`，不覆盖 |
| 投影未刷新（`local.revision≠record.revision` 且内容已变） | `stale_projection`，`state.revision` 与本地行均不变，消息要求 refresh |
| 刷新后显式再导入 | 0 冲突、`state.revision` 前进、取到新版本 |
| 本机有行但 Git 记录不可读（`unresolvedIds`） | `record_unreadable`，本地行保留 |
| 批内重复 ID | 2 条逐记录报错、1 条有效记录正常导入、无冲突 |

### AC-093 需求目录与正文一致性（通过，解析面）

- 缺 README → `ok:true`、`readmeOutOfDate:true`、`rebuildPoolReadme` 可重建列表（非致命）。
- 单文件缺失（只有 `requirement.json`）→ `REQUIREMENT_CONFLICT`（“…is missing; needs both requirement.json and content.md”）。
- 坏 `contentHash` → `REQUIREMENT_CONFLICT`（Hash 对比消息）。
- `content.md` 版本标记与 JSON `version` 不一致 → `REQUIREMENT_CONFLICT`（record-version 消息）。
- 目录名 ≠ id → `REQUIREMENT_CONFLICT`（directory name 消息）。
- 被 Git 忽略（`.gitignore: .agentdev/`）→ 真实 `git check-ignore` 判定为忽略，`REQUIREMENT_PATH_IGNORED`，`ok:false`、`pool:null`。
- 旧格式（池根 `<id>.json` 与 `docs/agentdev/requirements/<id>.json`）→ 两条 `LEGACY_REQUIREMENT_FORMAT`，不自动迁移。
- 版本一致性：v1（marker=1）→ v2（marker=2）时 `contentHash` 与组合 `recordHash` 均变化、两文件版本一致、`contentFile` 固定 `content.md`。

---

## 5. 必需失败测试（`docs/delivery/implementation.md` WP-04）

| 必需失败测试 | 触发 | 实测结果 |
|---|---|---|
| **初始化中断** | FileSystemPort 第 3 次写入抛错 | `failed/interrupted`、`recoverable:true`、保留 2 条回执；`resume` 按 Hash 续写至 Ready（§4 AC-029） |
| **非法 Feature** | 缺字段/未知枚举/缺标题/空关系表/owner 不符/重复 ID | 全部不发布、`KNOWLEDGE_INVALID`、保留最后有效并标 stale（§4 AC-040） |
| **重复 ID** | 同 revision 两个文档同 `feature_id` | `parseFeatureSet.ok:false`、两份都被排除（不静默合并）、每份一条错误并列出两个路径（§4 AC-040） |
| **断链** | 关系目标缺失 + 来源路径不在冻结 Revision；需求目录缺文件/坏 Hash | 诊断 `error`、投影仍发布；命中当前需求则 `deliveryBlocked`；需求侧逐条 `REQUIREMENT_CONFLICT`（§4 AC-040/AC-093） |
| **代码设计冲突** | 已有可解析文档声明不存在的实现入口 | `implementation-not-observed` / `design-code-conflict`（confirmed+可解析 decision）/ `invalid-document`；初始化在 Confirming 阻断、重复 `step` 不自解、`resolveConflict` 逐条处置后才继续（§4 AC-042 与 `exp4`） |

---

## 6. 对抗性探针（`exp7`/`exp8`，均 0 失败）

**预算耗尽 ≠ 明确空项目（W4R2-01 的三层闭合，独立复现）**

- 41 个 README 占满正文预算、`src/mod.ts` 被跳过 → Confirming **blocked**：

```json
{"kind":"investigation-budget","code":"MISSING_CONTEXT","reads":40,"unknowns":1,
 "message":"扫描在预算内未观察到任何能力（正文 40 个、未知 1 项），不能据此认定项目为空：请扩大调查批次（investigateMore）或显式确认项目确无能力（confirmNoCapability）"}
```

- 重复 `step` 仍 blocked（无用户动作不可解）；未写出任何候选文档。
- `investigateMore({maxBodyFiles:5})`（不大于当前 40）→ `VALIDATION_ERROR` 且**不写失败状态**（`failure:null`、仍 blocked、阶段不变）；`{maxBodyFiles:200}` 真正扩大后观察到预算外能力，最终到 Ready，PROJECT 不写 `absent`。
- `confirmNoCapability` 需 `authorizationRef`+`by`，只在 Confirming 生效；确认后 `emptyProjectConfirmed:true`、写入 `no-capability` 证据、PROJECT 写 `absent（未实现，明确空项目，用户已确认）`、Ready 门禁通过；Ready 后重复调用被 `INVALID_STATE` 拒绝且记录保持 `ready`/`failure:null`。

**结构不可信**：代码围栏内的字段表、HTML 注释内的标题、一级标题充当小节、重复标题、未知字段、三列字段行、未知关系类型、错误表头、空关系表、关系只写散文、空实现入口、模板示例 ID —— 全部被拒；完整样例通过。

**取值与证据接缝**：`无`/`未调查` 识别（含尾随句号）、分号多值、`无；x` 混写会留下待解析成员并被 `diagnoseLinks` 报为未解析（fail-closed，不静默丢弃）；省略 `codeTreeRevision` 时版本一致性校验按契约跳过。

**渲染回环**：`renderReadme(parsed)` → 再 `parseFeatureDocument` 可再次解析，`featureId/design/implementation/verification/relations/用途/实现入口` 逐项保持。

**摘要规则**：CJK 句号截断；ASCII 句点仅在空白/结尾生效（`支持 v1.2 语义与 .ts 扩展名` 不被截成 `v1`）；`e.g.` 缩写不截断；空用途回退 `未调查`。

**需求 Schema**：大写 UUID、`completed` 缺 completion、`cancelled` 缺 cancellation、`archived+previousLifecycle=completed` 缺 completion、未知字段全部被拒。

**document-root 逃逸（W4R3-03）**：`/tmp/evil`、`../evil`、`docs/../evil` 均 `VALIDATION_ERROR`；默认 `docs/agentdev`、尾斜杠规范化正常；初始化器构造时即拒绝逃逸值。

---

## 7. Findings 与观察

### T-01 [P2，非阻断] 一次错阶段的 `confirm` 可把初始化记录永久卡成不可恢复

- **位置**：`packages/workspace/src/initialize.ts` `confirm()`（阶段门禁用 `failed()` 而非 `rejected()`）。
- **复现（`exp7`）**：项目初始化到 **Ready** 后再次调用 `confirm(id, …)`（例如 UI 重发/重试）：

```json
{"code":"INVALID_STATE",
 "failure":{"kind":"internal","message":"当前阶段 ready 不接受确认","recoverable":false},
 "status":"failed","phase":"ready",
 "step":"INVALID_STATE","resume":"INVALID_STATE"}
```

  随后 `confirm`/`step`/`resume`/`authorizeGitInitialization`/`investigateMore`/`resolveBlocker` 全部被拒；`start({id, root})` 对既有记录返回失败记录、不重置。磁盘事实与 `verifyReady()` 仍一致，但该初始化 id 再无可用的推进/恢复 API。
- **影响**：一次调用方时序错误（早于 Confirming 调 `confirm`、Ready 后重复 `confirm`、非 writing 调 `authorizeGitInitialization` 等）会持久化不可恢复的 `internal` 失败；在 `phase ∈ {ready, writing}` 且 `featureCount>0` 时无法用任何现有 API 解封（`investigateMore` 被“已观察到能力”拒绝），需更换初始化 id。
- **与既有记录的关系**：`implementation.md` W4R1-04 已登记“用错处置 API 会写成 failed/internal，专用 API 仍可恢复”；W4R3-01 只把 `confirmNoCapability`/`investigateMore` 的输入错误改为不持久化。本项是同一模式在 `confirm` 上的**不可恢复变体**，故不计入阻断。
- **建议**：把阶段门禁拒绝统一改为 `rejected()`（不持久化），或为 `failed` 增加显式“清除失败并回到当前阶段”的恢复路径（`resume` 对 `internal` 失败同样可用）。**不阻断本包 AC 接受**（AC-025–029 的正常路径与失败恢复路径均实测通过）。

### T-02 [P2，非阻断] 角括号占位符在“实现入口/关键决定”列表项中被静默剥除，占位规则未生效

- **位置**：`packages/knowledge/src/feature-format.ts` `buildSection()` 先 `stripHtml()`，随后（第 594–602 行）才对 `section.items` 做 `findPlaceholder()`。
- **复现（`exp8`、`evidence2.mjs`）**：

```json
{"ok":true,
 "entries":["src/orders/.ts"],
 "codeMap":["src/orders/.ts"],
 "codeMapDoc":"| src/orders/.ts |  | orders | [订单取消](features/F-00000001/README.md) |"}
```

  即模板写法 `- src/orders/<path>.ts` 通过校验，`<path>` 被剥掉后以伪路径进入 `CODE_MAP.md`；`- decision:<真实ID>：…` 同理通过（`decision:：…`）。
- **对照**：字段表值与关系表单元格是在剥离前检查的，`- … F-a1b2c3d4 …` 这类非 HTML 占位符也会被正确拒绝——**只有角括号形式**漏检。
- **影响**：`context.md` §2「示例占位只能用于模板，写入正式Feature时必须是真实值」在“实现入口/关键决定”两处未生效；模板文档可发布并生成不存在的代码地图行。AC-040/AC-086 的枚举与证据规则不受影响，故非阻断。
- **建议**：在 `buildSection()` 剥离 HTML 之前对原始列表项做占位检查（或对剥离结果与原始行同时检查）。

### 观察（不阻断）

| 编号 | 观察 | 说明 |
|---|---|---|
| O-01 | `parseRequirementPool` 在 `REQUIREMENT_PATH_IGNORED`（及缺失文件）时仍返回 `records`，仅 `ok:false`/`pool:null` | 与“有效记录仍返回”的既有设计一致；调用方必须判 `ok`。建议在类型/文档上强调忽略路径的记录不可导入 |
| O-02 | 无 Git 目录授权初始化后，既有未跟踪代码触发 `dirty-workspace`，需再显式处置一次 | 与 AC-028「阻断到明确处置」一致，只是 AC-027 路径多一步；数据零风险 |
| O-03 | `buildProjection` 的 `codeTreeRevision` 在 TS 类型上必填，但运行时可省略并跳过 Revision 一致性校验 | 类型层防线；`parseFeatureSet`/`parseFeatureDocument` 的该参数本就文档化为可选 |
| O-04 | `readMultiValue('无；x')` 保留 `无` 为成员，随后被断链诊断报为 `NOT_FOUND` | fail-closed，不会静默接受；仅错误文案略显生硬 |
| O-05 | `resolveBlocker` 等“用错专用 API”会持久化 `failed/internal`（W4R1-04 已登记） | 正确 API 可恢复（`exp7` 实测 confirm 后到 Ready）；与 T-01 同源 |
| O-06 | `Initializer.investigate(id)` 不继承记录的 `budgetOverride` | `exp7`：`investigateMore(200)` 后记录 `featureCount>0`，但 `investigate()` 仍按默认预算是 0 个候选且 `partial:true`。`step()` 路径使用扩展预算，功能正确；只读端点展示会与状态机不一致 |
| O-07 | `evaluateReadyGate` 的 `documents-parse` 用 `gitRevision ?? '未调查'` 且不传 `codeTreeRevision` 复验候选文档 | 候选文档恒为 `unverified`，当前不构成风险；正式文档的 passed 校验走正式投影 |
| O-08 | `implementation.md` T6 记 `initialize.test.ts` 11 例（T9+3、T10+2），实测 19 例 | 总数（426）与 `T8/T11` 声明一致，仅逐包用例数描述滞后；建议结算时对齐 |

---

## 8. 未覆盖与风险（`not_covered`）

| 编号 | 未覆盖面 | 归属与依据 | 风险 |
|---|---|---|---|
| NC1 | 需求池的**独立 SQLite 落地 + Core/UI 集成演练**（“临时 Git 仓库 + 独立 SQLite + Core/UI”） | `implementation.md` T9-W4R1-03 承接 WP-08；本包只有 `LocalRequirementState` 纯值 + 内存/JSON 演练 | 中：AC-087/088/092/093 的 Git/解析/冲突语义已实测，但“新服务器导入后端到端”未验 |
| NC2 | `requirement.save` 的 **Git 原子提交**（两文件同版本同一提交）与保存竞争/崩溃 | 保存路径属 WP-05/WP-08；本包只验两文件版本与组合 Hash 一致性 | 中：AC-093 的“原子提交”句未验 |
| NC3 | AC-039 的 **Snapshot/ContextSelection** 面（约束与来源进入选择、无关文档不默认加载） | Context 选择链路属 WP-02（AC-030）与 WP-05；本包只提供关系/来源解析 | 中：AC-039 判“部分通过” |
| NC4 | 需求正文与 `requirement.json` 作为**同一 Revision 的两份来源**在 Product/Plan 装载时的冲突拦截 | Context/Plan 装载属 WP-05/WP-06 | 低：知识层已给出两文件与 `recordHash` 事实 |
| NC5 | **正式 Git 提交/CAS、交付 ref 更新**与 `feature_projection` 的 SQLite 落地 | `plan.md` §1 判定边界，承接 WP-08/WP-10 | 低：本包以 Port + 内存/文件实现验证行为 |
| NC6 | 真实模型 Provider 纵向（问答 HTML/冷启动） | WP-10 `test:live`（需用户提供 baseUrl/model/secret） | 低：本包不含模型调用 |

**已核验的已知残余（与 `implementation.md` 承接声明一致）**：无 Git 候选 `source_refs` 用 `file:<path>` 且 Git 初始化后不回填；扫描新增最低优先级 `source` 层；正式 Confirmed 文档仅在调用方给 `decision` id 时判 `design-code-conflict`（否则先报 `invalid-document`，fail-closed）；Writing 脏检查过滤本次自写路径（`checkDeliveryReadiness` 不过滤）。

---

## 9. 记录一致性核查

| 记录声明 | 实测 | 结论 |
|---|---|---|
| 契约命令：typecheck/lint/unit/integration/build/docs 全 0 | 6/6 退出 0 | 一致 |
| `unit 26 文件 / 426 用例` | 26 / 426 | 一致 |
| `integration 124` | 10 文件 / 124 | 一致 |
| `build 10 workspace` | 10 个 workspace `Done` | 一致 |
| 回归网用例数（feature-format 44、projection 13、relations 11、views 9、requirements-pool 25、scan 16） | 逐一相同 | 一致 |
| 回归网用例数（initialize） | 记录 11+3+2=16，实测 19 | **不符（O-08，仅描述滞后）** |
| T11 三条 P2 闭环（W4R3-01/02/03） | `confirmNoCapability`/`investigateMore` 输入错误不持久化、阶段门禁、`normalizeDocumentRoot` 拒绝逃逸——均独立复现 | 一致 |
| T10 W4R2-01 三层闭合 | 预算耗尽阻断、重复 step 不自解、两条处置路径、扩大批次找到预算外能力——均独立复现 | 一致 |
| T9 W4R1-01 根级形状可达 Ready | 仓库自测 `initialize.test.ts`（19 例，含 W4R1-01 的三种根级形状）在 `test:unit` 中全通过；Test 侧**独立复验**了空项目、旧项目、无能力、预算耗尽、脏工作区等形状 | 一致（六种根级形状由仓库自测覆盖，本轮未逐一独立重跑） |
| W4R1-03 承接（SQLite 集成演练留 WP-08） | 确实不存在该演练；Test 记 `not_covered` | 一致 |
| W4R1-04 承接（误用 API 写 failed/internal，专用 API 可恢复） | 复现；并发现 `ready/writing` 阶段的不可恢复变体（T-01） | 一致但需补记 |
| Review 第三轮判 PASS（0×P0/0×P1/3×P2/5×P3） | `review.md` 结论与 HEAD 提交信息一致；`docs/INDEX.md` 尚无 WP-04 状态行（待 Settlement 补） | 一致（结算未完成） |

---

## 10. 结论

- **PASS**：WP-04 的知识解析/校验/投影/三视图/关系诊断、工作区扫描与候选生成、初始化状态机、需求池解析与导入，在冻结点 `1654004` 上按其 AC 与判定边界**可运行、可验证、fail-closed**；5 项必需失败测试全部实测通过。
- **接受**：AC-025/026/027/028/029/037/038/040/042/086/087/088/092/093 通过；AC-039 部分通过（关系与来源面通过，Snapshot 面承接 WP-02）。
- **不阻断但应处理**：T-01（初始化记录可被错阶段 `confirm` 永久卡死）、T-02（角括号占位符在实现入口/关键决定未被拒），以及 O-06（`investigate` 不继承 `budgetOverride`）、O-08（用例数描述滞后）。
- **未覆盖**：NC1–NC6，其中 NC1/NC2/NC3 需在 Settlement 中显式登记并由 WP-05/WP-08/WP-10 承接。

**Test 判定：PASS（附 2×P2 非阻断 Finding 与 6 类未覆盖面）。**
