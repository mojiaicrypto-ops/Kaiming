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

---
---

# WP-04 独立 Test 报告（第二轮：变更树复验）

- 测试对象：工作包 WP-04「知识与新旧项目」（`docs/delivery/implementation.md` WP-04）。
- 测试角色：**Test**（独立上下文；**未读取任何开发/Review/Test 会话或聊天**；只依据仓库正式文档、git 对象、代码与我自建脚本的原始输出）。上一节（第一轮报告）逐字保留在本文件顶部。
- **代码冻结点（任务指定）：`88a5690`**；`git rev-parse HEAD` = `88a5690b0e1e6be277af4117b566d70be2d40c41`（`fix(knowledge,workspace): input errors never downgrade a record; HTML vs placeholder`）。
  - `git rev-parse 88a5690^{tree}` = `2a79088b93ee8c997bf7061bc2f467024e9d620b`；`git rev-parse HEAD^{tree}` = 同值。
  - `git diff --stat 88a5690 HEAD` **无输出**；`git status --porcelain` **无输出** ⇒ HEAD 与被测树逐字节一致，无未提交改动。
- 本轮动因：第一轮 Test 判 PASS 并报两条 P2（T-01 错阶段 `confirm`/`authorizeGitInitialization` 持久化不可恢复失败；T-02 `buildSection` 先剥离内联 HTML 再查占位符，伪造路径进 `CODE_MAP`）。开发以 T12（`61ada58`）修复，并按第四轮 Review 追加 T13（`88a5690`）：`internal` 输入错误不持久化、`confirm` 一旦记录即幂等、标签白名单区分离内联 HTML 与尖括号占位符、占位符校验覆盖全部小节正文。**本轮针对整棵变更树重新独立取证，不复用第一轮结论。**
- 环境：`node v24.8.0`、`pnpm 12.3.4`、macOS（Darwin，宿主直跑）；真实临时目录 + 真实 `git init/commit/clone/check-ignore`；**无真实模型 Provider、无网络**。宿主 load average 测试期间 15–62（6 条契约命令开跑时 ≈62，其后回落）。
- 方法：只消费 `pnpm build` 产物（`packages/*/dist`，经 `/tmp/wp04t2/node_modules/@agentdev/*` 软链）；在 `/tmp/wp04t2/` 自建 9 组实验脚本（`exp1..exp9.mjs`）＋1 组证据导出（`evidence.mjs`），**697 条断言 0 失败**；**不 import 任何产品测试文件**。
- 权威依据：`docs/delivery/acceptance.md`（AC-025–029、AC-037–040、AC-042、AC-086–088、AC-092–093 原文）、`docs/delivery/implementation.md` WP-04、`docs/architecture/{context,data,ARCHITECTURE}.md`、`docs/product/{knowledge,requirements}.md`、`.agentdev/work/WP-04/{plan,implementation,review}.md`、`packages/{knowledge,workspace}/src/**`。

---

## 1. 结论摘要（15 个 AC）

| AC | 题目 | 本轮结论 | 关键独立证据 |
|---|---|---|---|
| AC-025 | 空项目 | **通过** | 空目录 → `git init -b agentdev/main` + 空初始提交 + 四入口文档；PROJECT 记 `absent（未实现`；`candidate:true`/`deliveryRef:null`/Ready 门禁通过（`exp5`） |
| AC-026 | 旧项目初始化 | **通过** | 真实仓库调查：正文 ≤40 文件 / ≤512 KiB、来源 `git:<sha>:<path>`、未知显式、代码零移动、无 Requirement 产物、候选恒 `design=unconfirmed`；`maxBodyFiles:1` ⇒ `partial`+`budget-body-files`；完整走到 Ready（`exp5`） |
| AC-027 | 目录项目 | **通过** | 无 Git 只读调查全程可完成且零写入；正式写入前必须 `git-initialization` 授权（`NOT_AUTHORIZED`），授权后才建仓库/分支；用户代码未移动（`exp5`） |
| AC-028 | 脏工作区 | **通过** | 逐路径哈希报告阻断交付；内容与未跟踪文件零改动；只读调查不受影响；未真提交却声称 `committed` 被拒且不记处置；真实提交后到达 Ready（`exp5`） |
| AC-029 | 初始化冲突中断 | **通过** | 注入第 3 次写失败 ⇒ `interrupted`/`recoverable:true`/保留 2 条回执；`resume` 按内容 Hash 续写（前两条判 `unchanged`）到 Ready；预置异内容文件 ⇒ `content-conflict` 不覆盖、处置前 `resume` 拒绝；Ready 六项最小门禁 + 篡改后 `candidate-documents-written` 失败（`exp6`） |
| AC-037 | 当前功能 | **通过** | 冷启动一次 `queryFeatureView(delivered)` 得最新 `currentBehaviour`（含「30 分钟内可撤销」）与源自关系的 `constraints`；索引摘要取用途首句（`exp3`） |
| AC-038 | 状态分离 | **通过** | design/delivered/work 三视图严格分离；work `notDelivered:true`、`overlay` 只对声明的 Feature 生效、其他 Feature `overlay:null`；work 查询前后 design/delivered JSON 逐字节相同；缺 overlay / 空 workId ⇒ `VALIDATION_ERROR`、未知 Feature ⇒ `NOT_FOUND`（`exp3`） |
| AC-039 | 语义关系 | **部分通过** | 四列关系、`constrained_by` 进入 delivered `constraints`、关系图节点/边可解析、无关功能无借用约束；**「约束与来源进入 Selection/Snapshot、无关文档不默认加载」属 Context 选择链路（WP-02 AC-030/WP-05）**，本包无该接线（见 §10-NC3） |
| AC-040 | 非法知识 | **通过** | 缺字段/未知枚举/缺标题/空关系表/三列关系/未知关系类型/owner 不符/坏 `feature_id`/一级标题充当小节/重复标题 12 项全部拒绝且 `KNOWLEDGE_INVALID`；跨文档重复 ID 两份都排除（不静默合并）；无效集不发布、保留最后有效并标 `stale`（`staleSince`/`staleReason`、缓存行转 stale），后续合法 revision 清除 stale（`exp4`） |
| AC-042 | 观察与意图 | **通过** | `design=unconfirmed+implemented` ⇒ `observed_not_confirmed`/`mustNotAcceptObserved:true`；`confirmed+absent` ⇒ `confirmed_not_observed`（差距）；一致功能无分歧项；观察实现只出 `warning`；设计/代码冲突在 Confirming 阻断且重复 `step` 不自解、逐条 `resolveConflict` 后才继续（`exp3`/`exp6`） |
| AC-086 | 功能状态证据 | **通过** | confirmed 缺/坏 decision 引用、passed 缺证据/缺覆盖/Revision 不符、investigated 缺 scope/缺 source、四类未知枚举共 7 条负例全部拒绝并指名字段；完整样例通过（`exp4`） |
| AC-087 | 需求池随 Git 迁移 | **通过（Git 面）** | 真实 `git clone` 到「空白服务器」后仅凭仓库恢复 4 条需求：goal/scope/acceptance/confirmedDecisions/openQuestions 全保留；两次导入幂等（4×`unchanged`、状态逐字节相同）；列表 README 可直接读（`exp7`） |
| AC-088 | 历史需求展示 | **通过（Git 面）** | completed 摘要/代码 Revision/功能引用/验证摘要/遗留问题、cancelled 原因、archived 前态（`previousLifecycle`）全部保留；均标 `详细证据未迁移`、`countsAsLocalVerification:false`；queued 无历史（`exp7`） |
| AC-092 | 需求导入冲突与幂等 | **通过（Git 面）** | 同版本异内容 / 旧版本 / 批内重复 ID / 记录不可读 / 投影未刷新逐条 `REQUIREMENT_CONFLICT`（reason 精确）；本地行保留不删、不前进 revision；重复导入冲突不累积；刷新投影后显式导入转 `updated`；`localVersion` 与 `recordVersion` 各自独立（本机=7 保持 7）（`exp7`） |
| AC-093 | 需求目录与正文一致性 | **通过（解析面）** | 两文件共享 version 且组合 `recordHash` 符合 §6 公式、正文修改递增版本使 contentHash 与 recordHash 同时变化；缺 README 非致命且可 `rebuildPoolReadme`；单文件缺失/坏 Hash/版本标记不符/目录名≠id 逐条明确；`.agentdev/` 被忽略 ⇒ 真实 `git check-ignore` 判 `REQUIREMENT_PATH_IGNORED` 且 `pool:null`；两种旧格式 `LEGACY_REQUIREMENT_FORMAT` 不自动迁移（`exp7`） |

**判定：15 个 AC —— 14 通过 / 1 部分通过（AC-039，与第一轮同口径）/ 0 不通过；0×P0、0×P1。**

---

## 2. 冻结点与仓库状态（原始命令）

```text
$ git rev-parse HEAD
88a5690b0e1e6be277af4117b566d70be2d40c41
$ git rev-parse 88a5690^{tree}
2a79088b93ee8c997bf7061bc2f467024e9d620b
$ git rev-parse HEAD^{tree}
2a79088b93ee8c997bf7061bc2f467024e9d620b
$ git diff --stat 88a5690 HEAD
(无输出)
$ git status --porcelain
(无输出)
$ git log --oneline -1
88a5690 fix(knowledge,workspace): input errors never downgrade a record; HTML vs placeholder
```

被测提交链：`1654004`（第一轮树）→ `61ada58`（T12 修复）→ `88a5690`（T13 收口）。本轮全部结论只在 `88a5690` 上取证。

上述状态在**写入本报告之前**核验；写入后 `git status --porcelain` 与 `git diff --numstat` 仅为本文件（`289 0 .agentdev/work/WP-04/test.md`，纯追加、0 删除），`git diff --stat 88a5690 HEAD` 仍不含任何代码改动——被测代码树未被 Test 触碰（全部实验在 `mkdtemp` 真实临时目录与 `/tmp/wp04t2` 中进行）。本文件仍保持第一轮报告逐字不变：`head -401 | shasum -a 256` = `b6933f5e61ce1a0bac9999a925502bb35271b4dddf84e8dd3e5761e154286dcd`（与追加前一致）。

---

## 3. 契约命令原始结果（6/6 退出 0）

执行：`export PATH="$HOME/.local/bin:$PATH"`，仓库根目录按序执行；日志 `/tmp/wp04t2/logs/`。

| 命令 | 退出码 | 耗时 | 原始结果要点 |
|---|---|---|---|
| `pnpm typecheck` | **0** | 1s | `tsc -p tsconfig.json --pretty false`，无输出 |
| `pnpm lint` | **0** | 379s | `Checking formatting...` / `All matched files use Prettier code style!`（宿主高负载下的耗时） |
| `pnpm test:unit` | **0** | 14s | `Test Files 26 passed (26)` / `Tests 431 passed (431)` |
| `pnpm test:integration` | **0** | 39s | `Test Files 10 passed (10)` / `Tests 124 passed (124)` —— **含 2 个 Docker 型文件**（`apps/cli/doctor.integration.test.ts` 8 例 18.9s、`apps/cli/container.integration.test.ts` 9 例 37.8s） |
| `pnpm build` | **0** | 3s | 10 个 workspace 全部 `Done`（contracts、domain、storage、knowledge、workspace、pi-runtime、core、apps/{cli,daemon,runner}） |
| `pnpm docs:check` | **0** | 0s | `docs:check ok — 15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages` |

**Docker 口径**：本轮宿主负载回落，Docker 集成用例**未被 180s 超时阻断，124/124 全通过**，故本轮**无环境受阻项**，不需要非 Docker 子集替代。（对比：`implementation.md` T12/T13 记录的 `107/107` 非 Docker 子集，以及 T13 的环境观测，均属当时负载，本轮已由全量 124 覆盖。）

WP-04 自身回归网（`test:unit` 实测逐文件用例数）：`knowledge` 105（feature-format 47、requirements-pool 25、projection 13、relations 11、views 9）、`workspace` 37（initialize 21、scan 16）＝ **142 用例**。

---

## 4. 实验脚本与断言（自建、只消费 `dist`）

```text
export PATH="$HOME/.local/bin:$PATH"
cd /Users/huyaohua/huyh/work/aigrouptool && pnpm build
mkdir -p /tmp/wp04t2/node_modules/@agentdev
for p in contracts domain storage knowledge workspace; do
  ln -sfn /Users/huyaohua/huyh/work/aigrouptool/packages/$p /tmp/wp04t2/node_modules/@agentdev/$p
done
bash /tmp/wp04t2/run-all.sh          # exp1..exp9 + evidence
```

| 脚本 | 覆盖 | 断言 |
|---|---|---|
| `/tmp/wp04t2/lib.mjs` | 夹具库：Feature 文档构造器、需求记录构造器、真实 git 包装、断言器、树哈希 | 基础设施 |
| `exp1.mjs` | T-01/T-02 修复与第四轮补充：Ready 记录 9 类误用矩阵、空 `authorizationRef`、错阶段 `authorizeGitInitialization`、`confirmNoCapability`/`investigateMore` 误用、`resolveBlocker`/`resolveConflict` 误用、同 id 换 root/document-root/branch、重复 `confirm` 幂等、blocked 记录误用、无 Git 授权流 | **168 / 0** |
| `exp2.mjs` | T-02/W4R4-03/04：8 类占位符拒绝矩阵、5 类内联 HTML 剥离、混合行、对抗形态（未知标签/属性/模板 ID/svg/未闭合）、`CODE_MAP` 无占位符派生路径、旧投影 stale 保留 | **64 / 0** |
| `exp3.mjs` | AC-037/038/039/042：三视图、work 覆盖层与零污染、关系图、观察/确认分歧、stale 可读非当前、重复 ID、模板示例 ID | **56 / 0** |
| `exp4.mjs` | AC-086 证据矩阵、AC-040 非法知识 12 项、重复 ID 必需失败测试、断链必需失败测试（含「无需求范围不阻断」负例） | **93 / 0** |
| `exp5.mjs` | AC-025/026/027/028：空项目、旧项目、无 Git 目录、脏工作区（真实 git） | **86 / 0** |
| `exp6.mjs` | AC-029 中断/Hash 恢复/内容冲突/Ready 门禁 + 必需失败测试「代码设计冲突」 | **60 / 0** |
| `exp7.mjs` | AC-087/088/092/093：真实 `git clone` 空白服务器、历史摘要、冲突与幂等矩阵、目录/正文一致性负例 | **93 / 0** |
| `exp8.mjs` | 承接项复验：根级三形状、摘要规则、预算耗尽≠空项目、`(root)` 键、document-root 逃逸、O-01 预算继承、W4R3-07、未接线面取证 | **62 / 0** |
| `exp9.mjs` | W4R4-02（Confirming 阻断期二次 `confirm` 不改写已记录授权）＋ W4R3-07 证据账本增长量 | **15 / 0** |
| `evidence.mjs` | 原始证据导出（`/tmp/wp04t2/evidence.json`） | — |
| **合计** | | **697 passed / 0 failed** |

---

## 5. T-01 / T-02 修复与第四轮补充的独立复核

### 5.1 T-01（W4R4-01/W4R4-02）——任何输入错误都不再降级记录

`evidence.mjs` 在一个真实到达 Ready 的记录上依次注入 7 类误用，原始结果（节选）：

```json
{"readyBeforeMisuse":{"status":"ready","phase":"ready","failure":null,
  "confirmation":{"authorizationRef":"user-goal","by":"user","at":"2026-09-12T02:19:21.704Z"},
  "evidenceCount":11},
 "misuse":[
  {"label":"confirm-again","outcomeOk":true,"recordStatus":"ready","recordFailure":null,"recordDone":true,"verifyReady":true},
  {"label":"authorizeGitInitialization","outcomeOk":false,"outcomeCode":"INVALID_STATE",
   "recordStatus":"ready","recordPhase":"ready","recordFailure":null,"recordDone":true,"verifyReady":true},
  {"label":"confirmNoCapability","outcomeOk":false,"outcomeCode":"INVALID_STATE","recordStatus":"ready","recordFailure":null,"verifyReady":true},
  {"label":"investigateMore","outcomeOk":false,"outcomeCode":"INVALID_STATE","recordStatus":"ready","recordFailure":null,"verifyReady":true},
  {"label":"resolveBlocker","outcomeOk":false,"outcomeCode":"INVALID_STATE","recordStatus":"ready","recordFailure":null,"verifyReady":true},
  {"label":"resolveConflict","outcomeOk":false,"outcomeCode":"NOT_FOUND","recordStatus":"ready","recordFailure":null,"verifyReady":true},
  {"label":"start-other-root","outcomeOk":false,"outcomeCode":"INVALID_STATE","recordStatus":"ready","recordFailure":null,"verifyReady":true}]}
```

- 每一类误用后 `phase/status/failure/deliveryRef` 原样、`done` 与 `verifyReady()` 保持 `true`，随后的 `step`/`resume` 仍为 no-op 且 `done:true`（`exp1` 逐项断言）。
- **重复 `confirm` 幂等**：Ready 上再 `confirm({authorizationRef:'SECOND-REF'})` 返回 `ok:true/done:true`，`confirmation` 逐字节不变、证据行数不变（`exp1`）。
- **Confirming 阻断期幂等（W4R4-02 场景）**：记录 `phase:confirming`、`status:blocked(design-conflict)`、已记录 `user-action:1` 时，第二次 `confirm('user-action:2')` 仍为 `user-action:1`、无新证据；随后 `resolveConflict` 直接推进，**不再要求二次确认**（`exp9`）。
- **blocked 记录上的误用**：`confirmNoCapability`（空 ref）/`investigateMore`（不扩大预算）/`resolveBlocker`（用错 API）之后记录仍 `blocked`、`failure:null`、`emptyProjectConfirmed:false`，且正确 API 仍可解封到 Ready（`exp1`）。
- **无 Git 目录**：错 root 的授权请求与空 `authorizationRef`+空 branch 均 `VALIDATION_ERROR` 且不写 `gitAuthorization`、不建 `.git`、`failure:null`；随后正确授权 + 脏处置到达 Ready（`exp1`）。

### 5.2 T-02（W4R4-03/W4R4-04）——内联 HTML 剥离 vs 尖括号占位符拒绝

```json
{"placeholderEntry":{"ok":false,"errors":[{"code":"KNOWLEDGE_INVALID","message":"placeholder value: <path>","field":"实现入口"}]},
 "placeholderProse":{"ok":false,"errors":[{"code":"KNOWLEDGE_INVALID","message":"placeholder value: <真实ID>","field":"用途"}]},
 "inlineHtmlEntry":{"ok":true,"feature":{"sections":{"entries":{"items":["src/orders/cancel.ts"]}}}}}
```

- `- src/orders/<path>.ts` 与 `- <真实ID>`（实现入口）被拒；`用途`/`当前行为`/`已知差距`/`关键决定` 正文与列表项中的 `<path>`/`<真实ID>` 同样被拒（W4R4-04）。
- `<code>`/`<b>`/`<span>`/`<em>`/`<a href>`/大写带属性标签被正常剥离并保留裸值（W4R4-03）；`<code>src/a.ts</code> 与 <path>` 混合行仍被拒。
- `buildProjection` 对占位符文档 `published:false`/`stale:true`；合法投影的 `CODE_MAP.md` 含 `src/orders/cancel.ts` 且**不含 `<`、不含 `src/orders/.ts`**；被拒构建保留的上一版 CODE_MAP 逐字节等于旧版（`exp2`）。
- **A/B 对照（旧树）**：`git show 1654004:packages/knowledge/src/feature-format.ts` 的占位符循环只遍历 `实现入口`/`关键决定` 的 `items` 且 `buildSection` 先 `stripHtml` 再收集——与 T-02 报的现象一致；现树已改为「剥离后仍存活才保留原文并拒绝」＋全小节校验（`feature-format.ts` 的标签白名单与 `bodies.values()` 循环）。
- **对抗性形态**：`<feature_id>`、`<svg>`、`F-a1b2c3d4`（模板示例 ID，含 `<code>F-a1b2c3d4</code>` 包裹）、未闭合 `<` 均被拒（fail-closed）；`<a href="src/a.ts">src/a.ts</a>`、`<CODE class="x">src/a.ts</CODE>` 被接受为裸值（`exp2`）。

### 5.3 第四轮其余补充

- `internal` 失败**不持久化**：源码 `failed()` 对 `kind:'internal'` 只 `persist(withEvidence)`（保留状态与 `failure:null`），真实可恢复失败（`interrupted`/`content-conflict`/`ready-gate`/`git-error`）仍持久化 `status:'failed'`——行为与 T13 描述一致（`initialize.ts:1017-1039`，`exp1`/`exp6` 双向验证）。
- `investigate()` 继承 `budgetOverride`（T12 O-01）：`investigateMore(200)` 后 `investigate(id)` 返回 `featureCount>0` 且 `partial:false`（`exp8`）。

---

## 6. AC 逐项证据（代表深度）

- **AC-025**：`空目录 → start/step×3 → emptyProject:true（完整扫描自动确认）→ writing 阻断 git-initialization(NOT_AUTHORIZED, initialCommit:true) → 授权 → git init -b agentdev/main + `--allow-empty` 初始提交 → 四入口文档落盘 → PROJECT 含 `absent（未实现` 与候选横幅 → candidate:true / deliveryRef:null / verifyReady.ok`（`exp5`）。
- **AC-026**：README+3 源文件+2 测试真实提交；`investigateWorkspace` `reads≤40`、`Σbytes≤512KiB`、`wroteFiles:false`、`gitRevision===HEAD`，目录清单逐字节不变；`scanProject.completeness:'complete'`/`claimsFullUnderstanding:false`；候选 `sourceRefs` 全为 `git:<40hex>:<path>`、`design:'unconfirmed'`、`candidate:true`、`deliveryRef:null`、`.agentdev/requirements` 不存在；`maxBodyFiles:1` ⇒ `partial:true`+`unknowns.budget-body-files`；完整初始化到 Ready 且用户代码留在原地（`exp5`）。
- **AC-027**：无 Git 目录 `investigateWorkspace.ok:true`、`gitRoot:null`、`wroteFiles:false`、候选文档 ≥4、目录清单不变；初始化 writing 阻断且 `isRepository:false`/无 `docs/`/`gitAuthorization:null`；授权后建分支并（在 `dirty-workspace` 显式处置后）到 Ready，`src/orders.ts` 内容逐字节不变（`exp5`）。
- **AC-028**：已提交基线 + 未提交修改 + 新增文件；`checkDeliveryReadiness` 与状态机均 `dirty-workspace`，`hashReport` 2 条带 64 位 sha256；阻断期文件内容/新增文件/无 `docs/`；`committed` 假声称仍阻断且 `dirtyHandling:null`；真实提交后处置到 Ready，用户提交在历史中（`exp5`）。
- **AC-029**：注入第 3 次 `writeFile` 抛错 ⇒ `status:failed`、`failure.kind:'interrupted'`、`recoverable:true`、`errors[0].code:'INTERNAL_ERROR'`、`phase:'writing'`、2 条 `written` 回执且文件在盘；`resume` → Ready，重放的两个路径转 `unchanged`，证据含 `resume`；预置异内容 `PROJECT.md` ⇒ `content-conflict`（`diskHash`/`candidateHash`）且字节不变、处置前 `resume` 拒绝、采纳候选后 Ready 且 `fileConflicts` 清空；`verifyReady` 六项检查齐备，篡改入口文档后 `ok:false` 且 `missing` 含 `candidate-documents-written`（`exp6`）。
- **AC-037**：`delivered.currentBehaviour` 含「第二次需求修改后…30 分钟内可撤销」、`constraints:['付款状态决定可取消范围']`、`sourceRevision:'rev-knowledge-2'`、`current:true`；索引摘要 `允许用户取消未付款订单`（`exp3`）。
- **AC-038**：`design` 视图 `confirmed`+独立 `implementation:'absent'`；`work` 视图 `notDelivered:true`、`overlay.goal`、`delivered` 基线保留；work 查询前后 design/delivered JSON 相同；非本 Work 功能 `overlay:null` 且 `unknowns` 提示；`view:'work'` 缺 overlay/空 workId ⇒ `VALIDATION_ERROR`；未知功能 ⇒ `NOT_FOUND`（`exp3`）。
- **AC-039**：关系四列逐字段解析；关系图 1 边、目标节点 `resolved:true`、`missingTargets:[]`；`delivered.constraints` 恰为该 `reason`；无关功能 `constraints:[]`。未覆盖：Selection/Snapshot 注入（见 §10-NC3）。
- **AC-040**：12 项格式负例逐项指名字段；跨文档重复 ID 两份排除且错误列出两个路径；投影 `published:false`/`stale:true`、保留投影 `revision:'rev-1'`、`state:'stale'`、`staleSince:'rev-2'`、缓存行 `valid→stale`、`rev-2` 无行；`rev-3` 合法后 `state:'valid'` 且无 `staleSince`（`exp3`/`exp4`）。
- **AC-042**：`observed_not_confirmed` + `mustNotAcceptObserved:true`；`confirmed_not_observed` + `mustNotAcceptObserved:false`；一致功能无分歧；`listGaps` 含 confirmed-but-absent；`diagnoseLinks` 对观察实现只 `warning`；设计/代码冲突 Confirming 阻断（`KNOWLEDGE_INVALID`）、重复 `step` 仍阻断、错 documentPath/错 kind 被拒且记录不降级、正确处置后继续（`exp3`/`exp6`）。
- **AC-086**：7 条负例（无/坏 decision、无证据、无覆盖、Revision 不符、无 scope、无 source）+ 4 类未知枚举全部拒绝且 `field` 精确；完整样例（confirmed+decision、implemented、passed+artifact+coverage、investigated+scope+git source、revision==codeTree）通过（`exp4`）。
- **AC-087**：仓库 A 写 4 条需求（queued/completed/cancelled/archived）+ `rebuildPoolReadme` 生成的 README 并提交；`git clone` 到无数据库、无产品知识的空白服务器；`parseRequirementPool({repoRoot:B, revision:serverRevision})` `ok:true`、4 条、`readmeOutOfDate:false`、`legacyPaths:[]`；queued 的 goal/scope/acceptance/confirmedDecisions/openQuestions 全保留；`importRequirementPool(commit:true)` 4×`created`、`localVersion:1`/`recordVersion:1`/`sourceRevision:serverRevision`/`summary_only`；二次导入 4×`unchanged` 且 `state` 逐字节相同（`exp7`）。
- **AC-088**：completed 的 summary/codeRevision/featureIds/verificationSummary/remainingIssues 与 `详细证据未迁移`；cancelled 的 reason/cancelledAt 且无 completion；archived 的 `previousLifecycle:'completed'` + completion 摘要 + 功能引用；queued `importedHistorySummary===undefined`；三者 `countsAsLocalVerification:false`（`exp7`）。
- **AC-092**：6 类冲突 reason 全部实测（`same_version_different_content`、`incoming_version_older`、`duplicate_id_in_batch`、`record_unreadable`、`stale_projection`）+ 幂等重复不累积 + 冲突不前进 revision + 本地行保留；刷新投影后 `updated`（`recordVersion→2`、`localVersion→2`）；本机计数器 7 在 `unchanged` 时保持 7（`exp7`）。
- **AC-093**：混合坏池 `ok:false` 但有效记录仍返回、六类错误逐条带 `requirementId`/`path`、坏文件与旧格式文件未被删除；`.agentdev/` 被忽略 ⇒ `REQUIREMENT_PATH_IGNORED`、`pool:null`、真实 `git check-ignore` 一致；v1→v2 时 `contentHash` 与组合 `recordHash` 同时变化且 `recordHash` 等于 §6 公式重算值；`contentFile` 固定 `content.md`；缺 README 可重建（`exp7`）。

### 五项必需失败测试（`docs/delivery/implementation.md` WP-04）

| 必需失败测试 | 独立触发 | 实测结果 |
|---|---|---|
| **初始化中断** | FileSystemPort 第 3 次写入抛错 | `failed/interrupted`、`recoverable:true`、2 条回执保留；`resume` 按内容 Hash 续写（前两条 `unchanged`）到 Ready（`exp6`） |
| **非法 Feature** | 缺字段/未知枚举/缺标题/空关系表/owner 不符/坏 ID 等 12 项 | 全部 `KNOWLEDGE_INVALID` 且指名字段；投影不发布 + stale（`exp4`） |
| **重复 ID** | 同 revision 两份同 `feature_id` | `ok:false`、两份均排除、错误列出两个路径、不静默合并（`exp3`/`exp4`） |
| **断链** | 关系目标缺失 + 来源不在冻结 revision；需求单文件缺失/坏 Hash | 文档仍合法、诊断 `error`、投影仍发布；命中当前需求 `deliveryBlocked:true`，无关需求/无需求范围不阻断；需求侧逐条 `REQUIREMENT_CONFLICT`（`exp4`/`exp7`） |
| **代码设计冲突** | 正式 confirmed 文档声明不存在的入口 | `design-code-conflict`（claimed/observed 明确）；Confirming 阻断、重复 `step` 不自解、错处置被拒且不降级、逐条 `resolveConflict` 后到 Ready；正式文档未被改写（`exp6`） |

---

## 7. 承接项 T9–T13 的独立复核（真实运行）

| 承接声明 | 独立复验 |
|---|---|
| T9 W4R1-01 根级形状可达 Ready | 三种形状（README+`main.ts`、README+`main.py`+`test_main.py`、仅 README.md）均到达 Ready 且 `verifyReady.ok`（`exp8`） |
| T9 W4R1-02 / T10 W4R2-04 摘要规则 | CJK 句末截断；`支持 v1.2 语义与 .ts 扩展名` 不被截为 `v1`；`e.g.` 不截断；ASCII 句点+空白/结尾截断（`exp8`） |
| T9 W4R1-06 一级标题 | `# 用途` 不满足格式（`exp8`/`exp4`） |
| T10 W4R2-01 预算耗尽≠空项目 | 41 个模块 README 占满正文预算 + `src/mod.ts` 被跳过 ⇒ `investigation-budget`/`MISSING_CONTEXT`、`reads:40`、`emptyProjectConfirmed:false`；重复 `step` 仍阻断；`investigateMore(200)` 后观察到预算外能力并到 Ready，PROJECT **不写 absent**（`exp8`） |
| T10 W4R2-02 `(root)` 键 | 根级 `main.ts` 与 `root/mod.ts` 产出两个不同候选模块 `'(root)'` 与 `'root'`（`exp8`） |
| T11 W4R3-03 document-root 逃逸 | `/tmp/evil`、`../evil`、`docs/../evil`、`docs/..` 在 `normalizeDocumentRoot` 与 `createInitializer` 构造期抛 `WorkspaceError(VALIDATION_ERROR)`；默认值/尾斜杠/前缀 `./` 正常（`exp8`） |
| T11 W4R3-04 扩大批次必须真扩大 | `{maxBodyFiles:1}`（不大于当前）被拒且不降级；真扩大后重扫（`exp1`/`exp8`） |
| T11 W4R3-05 无能力确认改写 PROJECT | 确认后 PROJECT 写 `absent（未实现，明确空项目，用户已确认）`，`contentHash` 与磁盘一致（`exp8`） |
| T12 O-01 `investigate` 继承预算 | `investigateMore` 后 `investigate` 返回 `featureCount>0`、`partial:false`（`exp8`） |
| T12/T13 拒绝不持久 + 幂等 + 占位符/HTML 判别 + 全小节校验 | 见 §5（`exp1`/`exp2`/`exp9`） |

**仍未闭合的承接项**：`W4R3-07`（重复 `step` 在阻断态仍追加 `blocked` 证据行，长期空转会使账本增长；`exp9` 实测 5 次 `step` 增 5 行、`blockers` 不重复）——与 T11/T13 的登记一致，随 WP-08 状态存储处理。

---

## 8. Findings 与观察

### T2-01 [P3，非阻断] 全小节占位符校验把散文里的裸 `<`/`>` 与行内 HTML 注释判为占位符

- **位置**：`packages/knowledge/src/feature-format.ts` `findPlaceholder()`（`:375-383` 的 `value.includes('<') ? '<' : '>'` 兜底）＋ W4R4-04 新增的「所有小节正文与列表项」循环（`:683-693`）。
- **复现（`/tmp/wp04t2` 直跑 `parseFeatureDocument`）**：

```text
用途: 允许取消等待时间 > 30 分钟的未付款订单。   => KNOWLEDGE_INVALID / field:用途 / "placeholder value: >"
当前行为: 响应时间 < 2 秒时直接返回。             => KNOWLEDGE_INVALID / field:当前行为 / "placeholder value: <"
已知差距: 影响 > 1% 的订单。                      => KNOWLEDGE_INVALID / field:已知差距 / "placeholder value: >"
当前行为: 正常返回 <!-- 待确认 --> 结果。          => KNOWLEDGE_INVALID / field:当前行为 / "placeholder value: <!-- 待确认 -->"
用途: 适用于 <3 次重试。                          => KNOWLEDGE_INVALID / field:用途 / "placeholder value: <"
```

- **A/B**：`git show 1654004:packages/knowledge/src/feature-format.ts` 的占位符循环只检查 `实现入口`/`关键决定` 的 `items`，且 `buildSection` 对散文做 `stripHtml`——旧树上同样的散文（含 `>`）**可发布**；因此本项是 T13/W4R4-04「扩展到全部小节正文」带来的**新增可达面**，不是回归到旧缺陷。
- **观察 vs 期望**：`context.md` §2 要求拒绝的是模板占位（`<真实ID>`、`<path>`）与示例 ID，未要求把散文里的比较运算符 `>`/`<` 或行内注释当作占位符。当前行为是 **fail-closed 的过度拒绝**：合法 Feature 文档被判 `KNOWLEDGE_INVALID`，投影不发布并保留旧版标 stale。
- **影响**：无 fail-open、无伪造路径、不产生错误知识；但「行为描述里出现 `>`/`<`」在业务文档中很常见，会阻塞正式知识发布（AC-040 的拒绝方向正确，此处是误报）。
- **建议**：兜底分支只在 token 形如 `<...>`（含未闭合但以 `<` 开头后接合法标识符/标签字符）时判为占位符，或对裸 `>`、`<`+空白/数字、HTML 注释分别放行；同步补负例（`>` 散文可发布、`<path>` 仍拒绝）。
- **判定**：P3、不阻断本轮 AC（正常路径与全部必需失败测试均不涉及该形态）。

### 观察（不阻断）

| 编号 | 观察 | 说明 |
|---|---|---|
| O2-01 | 误用类 API 的**返回视图**仍是 `status:'failed'`/`failure.kind:'internal'`，而**持久化记录**保持 `ready`/`blocked` 且 `failure:null` | T13 的有意选择（不降级记录）；调用方必须优先读 `record`/`ok`，否则会误判。已在 §5.1 逐项固定该行为；建议在类型或文档中注明 `rejected()` 返回的是「请求失败视图」而非记录状态 |
| O2-02 | `authorizeGitInitialization` 要求 `input.request.root === record.root`（规范化后的 realpath），macOS 上 `/var/...` 与 `/private/var/...` 不等 | fail-closed；标准做法是回传 blocker 的 `request`（其 root 已规范化）。`exp1` 曾因此把正确请求误判为「根不一致」，属测试侧口径，非产品缺陷 |
| O2-03 | `queryFeatureView(view:'work')` 只拒绝 `workId === ''`，`'  '`（纯空白）被接受 | 轻微；不影响 AC-038 的任何正向/负向断言 |
| O2-04 | `implementation.md` T6 仍写 `initialize.test.ts` **11 例**，实测 **21 例**（T9+3、T10+2、T12+1、T13+1 与基线 11 之和不符） | 第一轮 O-08 的同类描述滞后，T12/T13 未订正；总数 431/124/10 均正确。属记录问题，建议结算时对齐 |
| O2-05 | W4R4-05 仍开放：`scanProject`/`investigateWorkspace` 对非法 `document-root` **抛** `WorkspaceError` 而非返回 `{ok:false}` | 已登记（P3）；`exp8` 固定该行为。`createInitializer` 构造期抛出是可接受的 fail-closed 口径 |
| O2-06 | 无 Git 目录上初始化完成后，已有未跟踪代码会再触发一次 `dirty-workspace` 处置 | 与 AC-028「阻断到明确处置」一致（第一轮 O-02），仅 AC-027 路径多一步 |

---

## 9. 记录一致性核查（`implementation.md` T12/T13 vs 实测）

| 记录声明 | 实测 | 结论 |
|---|---|---|
| `pnpm test:unit` 26 文件 / **431** 用例（T13） | 26 / 431 | 一致 |
| `pnpm test:integration` 124（T11 起）/ T12「Docker 超时」 | 10 文件 / 124，**含 Docker 全通过** | 一致且优于 T12/T13 的环境备注（本轮无环境受阻） |
| `pnpm build` 10 workspace | 10 个 `Done` | 一致 |
| `pnpm docs:check` ok | `15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages` | 一致 |
| 回归网逐文件用例数 | `feature-format 47`、`projection 13`、`relations 11`、`views 9`、`requirements-pool 25`、`scan 16`、`initialize 21` | `initialize` 与 T6 的 11 不符（O2-04）；其余一致 |
| T12「feature-format +1、initialize +1」 | 47/21 相对第一轮 44/19 各 +3/+2（T12+T13 累计） | 与 T12+T13 的声明相加一致 |
| T13「`internal` 失败只记证据、不改状态、不写 failure」 | `initialize.ts:1027-1030` 与 7 类误用实测 | 一致 |
| T13「`confirm` 一旦记录即幂等」 | Ready 与 Confirming+blocked 两种场景均复现 | 一致 |
| T13「标签白名单判别、占位符存活才拒绝」 | `<code>`/`<b>`/`<a href>` 剥离保留裸值；`<path>`/`<真实ID>`/模板 ID/未闭合 `<` 被拒 | 一致 |
| T13「占位符覆盖全部小节正文与列表项」 | 6 个小节正/负例均生效 | 一致（副作用见 T2-01） |
| T13「W4R4-06 订正」 | `implementation.md:63` 已含 `ROOT_MODULE_KEY`/`(root)` 与 `emptyProject` 口径；T13 节存在 | 一致 |
| W4R3-08 / W4R4-02..05 登记 | `implementation.md` T13 逐条列出（W4R4-05 为「登记」而非修复） | 一致 |
| W4R3-07 仍开放 | `exp9` 实测重复 `step` 增证据行、`blockers` 不重复 | 一致（开放，承接 WP-08） |
| W4R1-03 承接（SQLite/Core/UI 集成演练留 WP-08） | `git grep` 确认 `packages/core/src`、`apps/` 未引用 `@agentdev/knowledge`/`@agentdev/workspace`；无 `project.initialize`/`knowledge.get` 路由 | 一致，记 `not_covered`（§10） |
| `docs/INDEX.md` 尚无 WP-04 状态行 | `grep WP-04 docs/INDEX.md` 仅有 WP-03 行 | 一致（结算未完成） |

---

## 10. 未覆盖与残余风险（`not_covered`）

| 编号 | 未覆盖面 | 归属与依据 | 风险 |
|---|---|---|---|
| NC1 | 需求池的**独立 SQLite 落地 + Core/UI 集成演练**（临时 Git 仓库 + 独立 SQLite + Core/UI） | `implementation.md` T9-W4R1-03 承接 WP-08；本包只有 `LocalRequirementState` 纯值 + 内存/JSON 演练 | 中：AC-087/088/092/093 的 Git/解析/冲突语义已实测，但「新服务器导入后端到端」未验 |
| NC2 | `requirement.save` 的 **Git 原子提交**（两文件同版本同一提交）与保存竞争/崩溃 | `packages/core/src/requirements.ts` 只有 `requirement.save_failed` 事件名，无保存方法；属 WP-05/WP-08 | 中：AC-093 的「原子提交」句未验 |
| NC3 | AC-039 的 **Snapshot/ContextSelection** 面（约束与来源进入选择、无关文档不默认加载） | Context 选择链路属 WP-02（AC-030）与 WP-05；本包只提供关系/来源解析与 `diagnoseLinks` | 中：AC-039 判「部分通过」 |
| NC4 | 需求正文与 `requirement.json` 作为**同一 Revision 的两份来源**在 Product/Plan 装载时的冲突拦截 | `packages/core` 未消费 knowledge/需求池；`context.md` §6 的装载属 WP-05/WP-06 | 低：知识层已给出两文件与 `recordHash` 事实 |
| NC5 | **正式 Git 提交/CAS、交付 ref 更新**与 `feature_projection` 的 **SQLite 落地** | `plan.md` §1 判定边界；`packages/storage` 有 `feature_projection` 表但无 `ProjectionCache` 实现，知识包只有内存实现 | 低：本包以 Port + 内存/文件实现验证行为 |
| NC6 | 真实模型 Provider 纵向（问答 HTML/冷启动）、HTTP/WS 接线（`project.initialize` 等） | `pnpm test:live`/`test:e2e`/`test:acceptance` 实测均 `NOT_IMPLEMENTED`（exit 1，指名 WP-09/10）；daemon 仅有 `healthz`/artifact/conversation 路由 | 低：本包不含模型调用与协议接线 |

**已核验的已知残余（与 `implementation.md` 承接声明一致）**：无 Git 候选 `source_refs` 用 `file:<path>` 且 Git 初始化后不回填；扫描的「其他源文件」最低优先级层与根级 `(root)` 模块；正式 Confirmed 文档仅在调用方给出可解析 decision id 时才判 `design-code-conflict`（否则先报 `invalid-document`，fail-closed）；Writing 脏检查过滤本次自写路径（`checkDeliveryReadiness` 不过滤）。

---

## 11. 最终判定

- **PASS**：在冻结点 `88a5690`（`git diff --stat 88a5690 HEAD` 为空）上，WP-04 的知识解析/校验/投影/三视图/关系诊断、工作区扫描与候选生成、初始化状态机、需求池解析与导入**可运行、可验证、fail-closed**；6 条契约命令 6/6 退出 0（unit 431、integration 124 含 Docker、build 10 workspace、docs:check ok）；自建 9 组实验 **697 断言 0 失败**；5 项必需失败测试全部独立复现。
- **第一轮 T-01/T-02 两条 P2 已闭合**：错阶段/非法输入的 `confirm`、`authorizeGitInitialization`、`confirmNoCapability`、`investigateMore`、`resolveBlocker`、`resolveConflict`、同 id 换 root／document-root 均不再降级记录；占位符不再被 HTML 剥离绕过，`CODE_MAP` 无伪造路径。第四轮补充（`internal` 不持久化、`confirm` 幂等、标签白名单、全小节占位符）经独立复现成立。
- **本轮新增 1 条 P3（T2-01）**：全小节占位符校验会把散文里的裸 `<`/`>` 与行内 HTML 注释误判为占位符（fail-closed、非阻断）；其余为记录/口径观察（O2-01..O2-06），其中 O2-04（T6 用例数）与 W4R3-07/W4R4-05 建议结算时对齐。
- **未覆盖**：NC1–NC6，其中 NC1/NC2/NC3 需在 Settlement 显式登记并由 WP-05/WP-08/WP-09/WP-10 承接。

**Test 判定：PASS —— 接受 WP-04 的 AC-025/026/027/028/029/037/038/040/042/086/087/088/092/093；AC-039 部分通过（关系与来源面通过，Snapshot/ContextSelection 面承接 WP-02/WP-05）。**
