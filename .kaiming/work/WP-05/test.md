# WP-05 独立 Test 报告（Context 隔离与冷启动）

- 测试对象：工作包 WP-05「Context 隔离与冷启动」
- 测试角色：**Test**（独立上下文；**未读取任何开发/Review 聊天或会话**；结论只来自仓库正式文档、冻结代码、`pnpm build` 产物、契约命令原始输出与 `/tmp/wp05t/` 下我自建并实际运行的脚本）
- 权威依据：`AGENTS.md`、`docs/INDEX.md`、`docs/rules/{workflow,agents}.md`、`docs/architecture/{context,data,execution,reliability}.md`、`docs/product/knowledge.md`、`docs/delivery/acceptance.md`（AC-030…036、AC-079、AC-085、AC-093 全文）、`docs/delivery/implementation.md`（WP-05）、`.agentdev/work/WP-05/{plan,implementation,review}.md`、`packages/core/src/context/**`、`packages/core/test/context-*.test.ts`

## 0. 结论（verdict）

**Test 判定：PASS —— 接受 WP-05 的 AC-030/031/032/033/034/035/036/079/085/093。**

- 10 条 AC 全部通过：自建脚本 **11 个实验 + 1 个发现复现脚本，共 307 条断言，306 通过 / 1 失败**；唯一失败是 **T-01 的复现断言**（我刻意保留下来的缺陷证据），不是产品回归。
- 6 条契约命令 **6/6 退出 0**（typecheck 0、lint 0、unit 32 文件/644 用例、integration 10 文件/124 用例含真实容器、docs:check ok、build 10 workspace Done）。
- 4 项 WP-05 必需失败测试全部复现为**正确拒绝**：跨项目/Transcript 攻击、Snapshot 失效、预算不足、冷启动关联召回。
- 未发现 **P0/P1**。按 `docs/rules/workflow.md` §6，无 P0/P1 ⇒ 不阻断；4 条 P2/P3 见 §6，均在报告中带账并说明了对验收的影响（均不影响本包 10 条 AC 的验收面）。

## 1. 冻结点与仓库状态（task 指定核对项）

| 项 | 原始结果 |
|---|---|
| `git rev-parse HEAD` | `164a34fb429a3f356079a8a79fab44d512d7196d` |
| `git rev-parse 0e047ab^{tree}` | `da20f0c5ef8743164cc39f5847a11821d895ab1b` |
| `git diff --stat 0e047ab HEAD` | `.agentdev/work/WP-05/review.md | 347 ++++++++++++++++++++++++` / `1 file changed, 347 insertions(+)` |
| `git status --porcelain`（报告写入前） | **空**（工作树干净；`build` 只写被忽略的 `dist/`） |
| `git log --oneline -6` | `164a34f docs(review): … round 3 (PASS) and focused round 4 (PASS)` → `0e047ab fix(core): close WP-05 review round-3 findings` → `3fb3820` → `909f95b` → `15e2368` → `3f02b4b` → `fc4072e feat(core): implement WP-05 context isolation and cold start` |

结论：**冻结点 `0e047ab` 与 task 一致**；`0e047ab → HEAD` 只增加 Review 文档（`review.md`），代码树逐字节等于冻结点。核验的 `packages/core/src/context/*.ts` blob（与 R4.0 的记录一致）：

| 文件 | git blob |
|---|---|
| `acl.ts` | `659a38c08d2510c2d4bd31316e5970948ab0a132` |
| `builder.ts` | `50e5e3d9ad36153409ce273c91f1cc1ad1786e2c`（= R4.0 记录的 `50e5e3d9…`） |
| `checkpoint.ts` | `a9b1d5a18abe90ed40de79e47afb9ab8b51304b4`（= R4.0 的 `a9b1d5a1…`） |
| `cold-start.ts` | `76bad6fe86749af9205eca4daaa2c373dc011c72`（= R4.0 的 `76bad6fe…`） |
| `ledger.ts` | `d22f693859ebb9858fd563c3cd48696ab003a35d` |
| `requirements.ts` | `7070b792575ad647d05ba1d5c08f85c7cdb6c6ef` |
| `types.ts` | `bfd282c7279ee9035076da51f2566bb73b30ff1f` |
| `index.ts` | `eee9d50916d3f992562bdd586bd477b6fc45f18c` |

## 2. 测试环境与方法

```text
环境：macOS（Darwin，宿主执行）；node v24.8.0；pnpm 12.3.4；Docker 28.4.0（docker info 正常）
断言：/tmp/wp05t/ 下 11 个实验脚本 + 1 个发现复现脚本，全部只消费 pnpm build 产物
      （/tmp/wp05t/node_modules/@agentdev/{contracts,domain,storage,core} → packages/*，解析 dist）
禁止项：不 import 任何产品测试文件；不读取开发/Test/Review 聊天；只写 .agentdev/work/WP-05/test.md 与 /tmp/wp05t/
真实物：真实临时目录（mkdtempSync）、真实文件与符号链接、真实内容寻址快照目录、真实 Git 路径语义
```

| 脚本 | 断言 | 说明 |
|---|---|---|
| `exp1.mjs` | **30 / 30** | AC-030：选择逐字节冻结、字段/reason/hash/bytes、幂等（换时钟同 `snapshotRef`）、冻结目录不可变、源文件被改不影响已冻结 Run、声明 hash 钉住内容、缺 reason/空 goal/覆盖层改写/伪造 revision |
| `exp2.mjs` | **23（22 通过 / 1 失败）** | AC-031 + AC-079：Review 缺 Plan ⇒ `MISSING_CONTEXT` 后补齐可执行；Planning 缺 ProductDefinition；四类 bootstrap 正例 + 真缺上游四负例；未来产物不阻断；表内无「硬要未来产物」行。**唯一失败 = T-01** |
| `exp3.mjs` | **50 / 50** | AC-032/036/085：ledger 的 seq/path/revision/hash/reason/size、越界与缺 reason 拒绝、request+grant（收窄拒绝、放宽准入、永久拒绝保留）、`seal`/`verifySeal`、封口后再读 `INVALID_STATE`、旧 seq/错 hash `STALE_ARTIFACT`、预算边界 |
| `exp4.mjs` | **38 / 38** | AC-033/034：transcript 对全部 role×stage 拒绝、review/test 连 message 正文也拒、文档化聊天路径网正负例、跨项目在解析前拒绝且无内容、Checkpoint 的外来 Run/Project/Work 拒绝；W5R2-12 与 W5R1-13 复现 |
| `exp5.mjs` | **36 / 36** | AC-035：Checkpoint §5 全字段往返、`rotateSession` 只换 Session、Compaction 不改 manifest/approval、`summaryOf` 无 approval、W5R1-08/09、W5R2-08/11、W5R3-02 历法时间 |
| `exp6.mjs` | **25 / 25** | AC-036：必需源超限 `BUDGET_EXCEEDED` 点名 ref+缺口+`dropped`；可选源超限入 `excluded`；非法预算拒绝；0 预算封闭；不自动扩大选择（40 份未选文件 0 解析）。AC-093：需求目录两文件同 Revision、跨 revision 与改字节 ⇒ `STALE_ARTIFACT` |
| `exp7.mjs` | **27 / 27** | 冷启动固定样例 + 20 份无关文档 0 注入 + 误导聊天不改变答案（`kind=transcript`/guard/realpath 三道防线）；0 预算封闭；W5R4-01/W5R4-02 复现 |
| `exp8.mjs` | **5 / 5** | 对抗路径：`..`/绝对路径全部被「路径逃逸 readScope 根」拒绝；`pathIsInScope` 单独看会误判，但 `canRead`/ledger 的逃逸守卫在准入前生效 |
| `exp9.mjs` | **21 / 21** | 冷启动预算：seed（固定规则+概览）计入启动预算、0 预算不含正文；被预算排除的 Feature 不出现在 answer（W5R2-06）；被拒绝的 Checkpoint resume 位置不交付（W5R2-07） |
| `exp10.mjs` | **26 / 26** | 4 项必需失败测试的合并复跑 + W5R1-04（授权不得丢永久拒绝）+ W5R3-03（同一被拒 ref 只登记一次并合并原因） |
| `exp11.mjs` | **16 / 16** | 第 1/2 轮承接修复的独立复核：W5R2-02 类别/路径矛盾拒绝且不触达 resolver、W5R2-03 声明 hash 钉住内容、W5R2-05 `extraTokens` 有界、W5R1-10/W5R2-09 端口抛异常与「返回型」`INTERNAL_ERROR` 脱敏、W5R2-14 重复覆盖键拒绝、NOT_FOUND ⇒ `MISSING_CONTEXT` 点名 |
| `probe-findings.mjs` | **10 / 10** | T-01…T-04 的最小复现 |
| **合计** | **307（306 通过 / 1 失败）** | 唯一失败 = `exp2` 的 `B2b`，即 T-01 的证据断言 |

## 3. 契约命令原始结果

按序在仓库根执行（`export PATH="$HOME/.local/bin:$PATH"`；日志 `/tmp/wp05t/logs/contracts.log`、`/tmp/wp05t/logs/integration.log`）。

| 命令 | 退出码 | 原始结果要点 |
|---|---|---|
| `pnpm typecheck` | **0** | `tsc -p tsconfig.json --pretty false`，无输出 |
| `pnpm lint` | **0** | `Checking formatting...` / `All matched files use Prettier code style!` |
| `pnpm test:unit` | **0** | `Test Files 32 passed (32)` / **`Tests 644 passed (644)`** / Duration 10.44s |
| `pnpm test:integration` | **0** | `Test Files 10 passed (10)` / **`Tests 124 passed (124)`** / Duration 33.51s；含 `apps/cli/test/container.integration.test.ts` 9 例真实容器（非 root、只读 rootfs、tmpfs、只读挂载拒绝、cap-drop、无网络、pid/内存限制）与 `doctor` 8 例 |
| `pnpm docs:check` | **0** | `docs:check ok — 15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages` |
| `pnpm build` | **0** | `pnpm -r build`：contracts/domain/knowledge/pi-runtime/storage/workspace/core 与 apps/cli/daemon/runner 共 **10 个 workspace 全部 Done** |
| `pnpm test:e2e` | 1（NOT_IMPLEMENTED） | `NOT_IMPLEMENTED: command test:e2e is not implemented yet; it lands with WP-09` |
| `pnpm test:acceptance` | 1（NOT_IMPLEMENTED） | `… lands with WP-10` |
| `pnpm test:live` | 1（NOT_IMPLEMENTED） | `… lands with WP-10` |

按契约这三条为 **NOT_IMPLEMENTED**（WP-09/WP-10），**不计失败**。

原始尾部：

```text
===== pnpm typecheck =====   (no output)                                  TYPECHECK_EXIT=0
===== pnpm lint =====        All matched files use Prettier code style!  LINT_EXIT=0
===== pnpm docs:check =====  docs:check ok — 15 documents, 55 internal links, 94 acceptance cases,
                             9 requirements, 11 work packages             DOCS_EXIT=0
===== pnpm build =====       packages/contracts…apps/runner build: Done (10/10)  BUILD_EXIT=0
===== pnpm test:unit =====   Test Files 32 passed (32) / Tests 644 passed (644)  UNIT_EXIT=0
pnpm test:integration        Test Files 10 passed (10) / Tests 124 passed (124) INTEGRATION 0
```

## 4. 逐 AC 结论表

| AC | 题目 | 正向 | 负向 | 本轮结论 | 带账 |
|---|---|---|---|---|---|
| AC-030 | Chief 选上下文 | 通过 | 通过 | **通过** | T-04（P3）：返回对象未深冻结，见 §6 |
| AC-031 | 缺上下文 | 通过 | 通过 | **通过** | — |
| AC-032 | 追加读取 | 通过 | 通过 | **通过** | — |
| AC-033 | 独立审核（无开发聊天） | 通过 | 通过 | **通过** | W5R2-12、W5R1-13、WP-07 挂载负例未验证 |
| AC-034 | 跨项目隔离 | 通过 | 通过 | **通过** | W5R1-13、W5R4-01（P3） |
| AC-035 | 会话轮换 | 通过 | 通过 | **通过** | T-02（P3）：`stage` 未做词表校验 |
| AC-036 | 预算不足 | 通过 | 通过 | **通过** | — |
| AC-079 | 初始阶段上下文 | 通过 | 通过 | **通过** | T-01（P2）：`projectOverview` 路径映射缺口 |
| AC-085 | 证据读取封口 | 通过 | 通过 | **通过** | — |
| AC-093 | 需求目录与正文一致性（本包负责的 revision 绑定部分） | 通过 | 通过 | **通过** | 原子提交/README/旧格式部分归 WP-04/WP-08 |

计数：**10 通过 / 0 不通过 / 0 完全未覆盖**。

## 5. 逐 AC 证据

### AC-030 Chief 选上下文 —— **通过**

> Given Chief 指定来源与原因；When 创建专业 Run；Then Snapshot 忠实记录选择；Builder 只校验补齐必需项请求。证据：Selection/Snapshot 对比。

- **选择逐字节冻结**：`snapshot.selection` 与传入的 `ContextSelection` 深度相等（含 `sourceRefs`/`reasonPerSource`/`artifactRefs`/`excluded`/`unknowns`/`readBudget`）（`exp1` A2）。
- **每个 resolvedSource 忠实**：声明 `path`/`revision`/`ref.version`/`hash`/`bytes`/`reason` 与输入一致；内容 hash = `sha256(content)`（A4–A8）；`policyHash`/`configHash`/`createdAt` 按输入与时钟（A9–A11）。
- **冻结不可变**：同输入、不同时钟两次构建 ⇒ 同 `snapshotRef`、同目录、目录内每个文件 sha256 相同（A15–A19）；源文件被改写后，已冻结目录字节不变（A20），带声明 hash 的重建 ⇒ `STALE_ARTIFACT`（A23）。
- **负例**：缺 reason ⇒ `VALIDATION_ERROR` 且 **resolver 0 次调用**（N1/N2）；空 goal 拒绝（N3）；`contextSources` 覆盖层改写 path ⇒ `VALIDATION_ERROR` 且不调 resolver 不落快照（N4/N5）；resolver 伪造 `revision` ⇒ `VALIDATION_ERROR` 且 fetch 0 次（N6/N7，W5R3-01 的冻结不变式）。
- 真实物：`mkdtempSync` 真实目录 + 真实内容寻址目录写入器（文件按 hash 命名 + `manifest.json`）。
- 缺口：**T-04（P3）** 返回的 `ContextSnapshot` 未 `Object.freeze`，且 `snapshot.selection` 与调用方对象同引用；调用方在构建后改写选择会让内存对象与 `snapshotRef` 脱钩（磁盘树不受影响）。不影响本 AC 的创建时行为判定。

### AC-031 缺上下文 —— **通过**

> Given 缺有效验收/Plan；When 开始 Review；Then MISSING_CONTEXT，Chief 补齐后可执行。证据：正负调用。

- **按 AC 原文的 Review 场景**：Review 有 `productDefinition`+`frozenDiff` 但缺 `plan` ⇒ `MISSING_CONTEXT` 且缺口精确点名 `plan`；补入真实 Plan 产物后**可执行**（`exp2` C0/C0b/C0c）。
- Planning 缺 ProductDefinition ⇒ `MISSING_CONTEXT`，缺口恰为 `['acceptance','productDefinition']`（A1/A2）；补入真实 product 产物后成功（A3）。
- 断言不能顶替句柄类必需项：`contextInputs:['productDefinition','acceptance']` 仍报 `MISSING_CONTEXT` 且点名 `productDefinition`（A4/A5，W5R2-04）。
- 源 `NOT_FOUND`（Artifact 缺失）⇒ 缺口仍精确点名 `productDefinition`（`exp11` F1）。

### AC-032 追加读取 —— **通过**

> Given Agent 发现关联调用方；When 有理由搜索；Then 只读授权范围，追加 ledger，最终结果关联完整 Hash。证据：read ledger。

- **账本字段**：`append` 记录 `seq`（从 1 递增）、`path`、`revision`（默认冻结 revision，可逐条覆盖）、`hash`（=`sha256(content)`）、`bytes`（UTF-8）、`reason`、`tokens`（`exp3` A3–A9、G1）。
- **只在 readScope 内**：`.git/config`、`docs/dev-chat.md` 等越界/被拒路径 ⇒ `CONTEXT_FORBIDDEN`，且不追加、不计费（B1–B4）；路径逃逸（`code/../.git/config`、`/etc/passwd`）在准入前被「路径逃逸 readScope 根」拒绝（`exp8`）。
- **更广读取只经 request+grant**：授权前拒绝（D1/D4）；`requestExpansion` 记录有理由的 pending（D2）；重复 pending ⇒ 拒绝（D3）；**收窄授权拒绝**（D5）；放宽授权后准入（D6/D7）；授权不得丢永久拒绝（`exp10` J1/J2，W5R1-04）。
- **结果绑定完整 Hash**：`seal()` 返回 `{seq,hash}`，`sealedBinding()` 与之一致，`entries()` 为冻结副本（A11/A12、E1/E3）。
- 缺 reason ⇒ `VALIDATION_ERROR`，与「越界」互不掩盖（B3）。

### AC-033 独立审核（不可访问开发聊天） —— **通过**

> Given Developer 聊天含误导结论；When Review 启动并尝试读取聊天；Then 输入和工具均不可访问聊天；可查相关代码。证据：ACL 及容器负例。

- **`kind=transcript` 对全部 8 角色 × 全部合法 stage 一律拒绝**（`exp4` A1/A2，逐对枚举 `roleStagePairs()`）；`review`/`test` 连 `message` 正文也不可读（A3），其他角色可读用户请求、不可读 agent 结果（A4/A5）。
- **文档化路径网**：在 documentRoot=`docs` 的项目（保证前缀本身会放行）下，`.agentdev/work/WP-05/chat-1.md`、`docs/dev-chat.md`、`docs/developer-transcript.md`、`docs/dev-transcript.json`、`developer-chat-log.md`、`docs/dev-chat/notes.md`、`.agentdev/sessions/*`、`.git/config`、`node_modules/*`、`dist/*` 全部拒绝；`code/src/chat.ts`、`code/src/developer-chat.ts`、`docs/agentdev/PROJECT.md` 仍可读（A5b–A7）。
- **冷启动双重防线**：guard 的 `readable/refusal/read` 对聊天路径返回 `CONTEXT_FORBIDDEN` 且无正文；把误导聊天放进语料前后 answer 的 `currentBehaviour` 逐字节相同（`exp7` C1–C5）。
- **可查相关代码**：文案 `src/orders/cancel.ts`/`tests/orders/cancel.test.ts` 正常召回（`exp7` B4/B5）。
- **残余（已登记，非本轮回归）**：W5R2-12 的命名式路径网 —— `docs/my-dev-chat.md` 仍可读（`exp4` A7b，实测 `allowed=true`）。
- **未覆盖**：AC-033 的**容器挂载级**负例属 WP-07，本轮 integration 的 9 例容器用例中 `transcript|cross-project` 匹配数为 **0**（见 §8）。

### AC-034 跨项目隔离 —— **通过**

> Given A 的 SourceRef/Artifact 用于 B；When 读取/快照创建；Then NOT_FOUND/CONTEXT_FORBIDDEN，B 不含 A 内容。证据：API 及挂载负例。

- 跨 Project 来源在**任何路径/类别判断之前**拒绝成 `CONTEXT_FORBIDDEN`，错误信息点名对方 `projectId`、不含来源正文（`exp4` B1–B3/B6）；**resolver 0 次调用、不落快照**（B4/B5）；同名 id 不带 `projectId` 视为本 Project，带本 Project id 正常准入（B7/B8）。
- Checkpoint 层：外来 Run（`NOT_FOUND`）、外来 Project、外来 Work、外来角色一律 `CONTEXT_FORBIDDEN`，**结果对象不含 `checkpoint` 字段**（C1–C6）。
- **已登记残余 W5R1-13（reader-Run 绑定）**：`load({runId,role,runScope})` 的角色由调用方自报，无 capability 参数；任何能给出 `{runId, role=backend, runScope}` 的调用方都能读到该 Run 的 Checkpoint（`exp4` C7/C8 实测 `true`）。实现记录 T7 第 128 行明确「按任务要求不实现，转 WP-01/WP-07」，属**登记承接**而非静默；本包只证明 API/身份边界，工具/capability 侧由 WP-07 收口。
- 未覆盖：跨项目**挂载级**负例同样属 WP-07。

### AC-035 会话轮换 —— **通过**

> Given 原 Session 满或暂停；When 新 Session 恢复；Then 角色/任务/权限和来源正确，旧摘要不改批准状态。证据：Session ID、快照。

- **§5 全字段往返**：workId/taskId/stage/有效 Manifest/pendingDecisions/artifactRefs/lastToolOutcome/nextAction/recentMessages/sourceRefs/approval 逐字段一致；`checkpointHash` = 内容身份（`exp5` A3/A4）。
- **会话轮换**：`rotateSession` 只改物理 Session 与 `rotatedFromSessionRef`，role/task/stage/manifest/approval/sourceRefs/nextAction 不变（B1–B7）；重载 `rotated=true`（B8）；`fromSessionRef` 不匹配 ⇒ `INVALID_STATE`（B9）；无 Checkpoint 时轮换 ⇒ `NOT_FOUND` 且**不动已绑定 Session**（B10，W5R1-08 原子性）。
- **旧摘要不改批准状态**：`compactCheckpoint` 只裁剪最旧 message refs（keep=4 → 丢 8 条），manifest/approval/pendingDecisions 按身份穿过（C1–C5）；`summaryOf` **结构上无 `approval` 字段**（C6/C7）。
- **元数据契约**：不存在的历法时刻（`2026-02-30`、`2026-13-45T99:99:99.999Z`、`9999-99-99…`）在 `save` 全拒，合法值（含闰日 `2028-02-29`）逐字节持久化；注入抛异常时钟封闭为 `INTERNAL_ERROR` 且无原始 message；未校验的 `at` ⇒ `VALIDATION_ERROR` 且 session/updatedAt 不变（D2–D6，W5R2-08/11、W5R3-02）。
- 缺口：**T-02（P3）** `validateCheckpoint`/`save` 只要求 `stage` 非空，不校验是否属于 `CONTEXT_STAGES` 词表，`stage:'not-a-stage'` 会被持久化。

### AC-036 预算不足 —— **通过**

> Given 关联上下文超过限制；When 扩展；Then 报告具体缺口，由 Chief 重新选择或请求预算，不全库注入。证据：Manifest/用量。

- **必需源超限**：Planning 的 product 产物撑满 4096 启动预算 ⇒ `BUDGET_EXCEEDED`，点名被排除的 ref（`artifacts/product/prod-1`）、`input=productDefinition`、缺口 `shortfall`，并记入 `usage.dropped`；**不冻结任何快照**（`exp6` A1–A5，原始报文见下）。
- **可选源超限**：不阻断整包，进入 `excluded`/`unknowns`/`dropped`，不在 `resolvedSources`（B1–B4）。
- **0 预算封闭**：`BUDGET_EXCEEDED`（而非 `VALIDATION_ERROR`），失败串不含任何正文（`exp3` F、`exp6` C2、`exp9` A4/A5）。
- **预算范围**：builder/ledger/冷启动三处同口径拒绝 `-1/4095/2000001/4096.5/NaN/Infinity`，接受 `0/4096/2000000`（`exp3` F、`exp6` C1、`exp9` A6）；`extraTokens` 与叠加后的 ceiling 同受该范围约束（`exp11` C1/C2，W5R2-05）。
- **绝不全库注入**：40 份未选文件在磁盘上存在，builder 只解析被选来源（resolver 恰 2 次、未选文件 0 次 fetch）（`exp6` D1–D4）；冷启动 20 份已登记但无关的文档 0 注入并全部登记为 `unrelated`（`exp7` A6/A7、`exp10` I6）。
- 原始报文：`{"code":"BUDGET_EXCEEDED","message":"预算不足：artifacts/product/prod-1 被排除，缺口 1 tokens（AC-036）","ref":{…,"input":"productDefinition"},"dropped":[{"tokens":4096,"shortfall":1}]}`。

### AC-079 初始阶段上下文 —— **通过**

> Given 空项目无概览/Product/Plan，或 L1 仅 CompactPlan；When 分别启动 initialize/Product/Planning/L1 Develop；Then 按阶段必需表合法启动，缺未来产物不形成循环；真正缺上游输入才拒绝。证据：四个 Context 正例与负例。

- **四个正例全部合法启动**：①空项目 `chief:initialize`（`BootstrapObservation` 满足 oneOf）；②`product:product`（空项目用 `BootstrapObservation` 顶替概览）；③`planning:planning` 只有真实 `ProductDefinition`（无 Plan）；④`backend:develop-L1` 只有 `CompactPlan`（`artifacts/plan/l1-…`，满足 `compactPlan` 而非 `plan`）（`exp2` B1–B5）。
- **无循环**：`referencesFutureArtifact(row)` 对全表所有行返回 `[]`（`exp2` D1）；早阶段读晚阶段 artifact 被拒，未来 Plan 既不入 `resolvedSources` 也无正文（B6）。
- **真缺上游才拒绝**：L2 Develop 缺 Plan、Test 缺 Review 结果、Settlement 缺最终验证结果 ⇒ `MISSING_CONTEXT` 且分别点名 `plan`/`reviewResult`/`verificationResult`（C1–C3）。
- **缺口（T-01，P2）**：默认 documentRoot=`docs/agentdev`（`packages/knowledge/src/projection.ts:43`、`packages/workspace/src/scan.ts:62` 的 `DEFAULT_DOCUMENT_ROOT`）下，正式概览 `docs/agentdev/PROJECT.md` **可读且被冻结**，但 `PATH_INPUT_RULES` / `INPUT_CATALOG.projectOverview.pathPrefixes=['docs/INDEX.md','docs/product']` 不认它，`inputKeyForSource` 返回 `null` ⇒ 该来源**无法满足 `projectOverview`**，Product 阶段只能靠自报 `bootstrapObservation` 启动。四个正例/负例不受影响（正例②用的就是 `bootstrapObservation`），故不阻断本 AC；缺口与路由见 §6/T-01。

### AC-085 证据读取封口 —— **通过**

> Given Agent 追加读取后提交阶段结果；When 使用旧 ledger Hash 或提交后再读取；Then 旧 Hash 拒绝，正确 seq/hash 封口，后续工具拒绝或使结果失效。证据：ledger 和 Manifest。

- **封口**：`seal()` 返回末 seq 与链式 hash（`acc₀=sha256("agentdev.read-ledger.seal.v1")`），重复 `seal()` 幂等，`sealedBinding()` 一致；空账本封口为 `seq 0` + genesis hash（`exp3` E1–E3、E10）。
- **旧 seq / 错 hash 拒绝**：`verifySeal({seq:1,hash:seal.hash})` 与 `verifySeal({seq:seal.seq,hash:other})` ⇒ `STALE_ARTIFACT`；非整数 seq / 非法 hash ⇒ `VALIDATION_ERROR`；正确绑定通过（E4–E7）。
- **提交后再读**：封口后 `append` 与 `requestExpansion` 均 ⇒ `INVALID_STATE`（E8/E9）；`entries()` 为冻结副本，外部改写不生效（A11/A12）。

### AC-093 需求目录与正文一致性（本包负责的 revision 绑定部分） —— **通过**

> Given 每需求包含 requirement.json 与 content.md…；When 保存、Clone 导入及加载 Context；Then 两文件共享版本并原子提交…依赖需求的 Product/Plan 加载两份同 Revision 来源且冲突不得放行。

- **同 Revision 冻结**：`.agentdev/requirements/REQ-CTX-001/{requirement.json,content.md}` 以同一 `rev-7` 选入，两个 `ResolvedSource` 的 `revision` 与 `ref.version` 均为 `rev-7`，元数据/正文 hash 分别钉住（`exp6` E1–E5）。
- **冲突不得放行（负例）**：两文件之一处于另一 revision 而 selection 声明 `rev-7` ⇒ 拒绝（本包先由 W5R3-01 的不变式拦为 `VALIDATION_ERROR`，`exp6` E6）；正文在声明 revision 下被改写而 selection 钉了 hash ⇒ `STALE_ARTIFACT`（E7）。
- **不半读/不错归属**：覆盖层与 resolver 都不得改写声明的 `path`/`version`/`revision`/`hash`（`exp1` A23/N4–N7、`exp11` B1/B2）。
- 归属说明：AC-093 的「两文件原子提交、README 可重建、旧格式逐条显示」属 WP-04/WP-08；本包只承接声明范围内的 revision 绑定与一致性，**未覆盖部分见 §8**。

## 6. Findings

### T-01 [P2] 默认文档根下的正式 Project 概览无法满足 `projectOverview`（必需输入映射缺口）

- 位置：`packages/core/src/context/requirements.ts` `PATH_INPUT_RULES`（`docs/INDEX.md`、`docs/product` → `projectOverview`；`features` → `featureNavigation`）与 `INPUT_CATALOG.projectOverview.pathPrefixes`；对照 `packages/core/src/context/acl.ts:425`（scope 前缀取 `project.documentRoot`）与 `packages/knowledge/src/projection.ts:43`、`packages/workspace/src/scan.ts:62`（`DEFAULT_DOCUMENT_ROOT='docs/agentdev'`）。
- 复现：`node /tmp/wp05t/probe-findings.mjs`（T-01 组）、`node /tmp/wp05t/probe-overview.mjs`、`node /tmp/wp05t/exp2.mjs`（`B2b`，本轮唯一失败断言）。
- 观察：`role='product', stage='product'`，选择里含真实 `git:docs/agentdev/PROJECT.md@rev-1`，其余必需输入齐全 ⇒ `{ok:false, code:'MISSING_CONTEXT', errors:[{input:'projectOverview', message:'阶段 product:product 需要 projectOverview 或 bootstrapObservation 之一'}]}`。同一来源 `canRead(...).allowed===true`（**在 readScope 内、被解析并冻结**），但 `inputKeyForSource(...)===null`；`C.inputKeyForSource({path:'docs/INDEX.md'})==='projectOverview'`。
- 期望：`context.md` §1「Project 概览」与 `agents.md` §2「Project 概览或初始化观察摘要」中的正式概览就是 `documentRoot` 下的 PROJECT.md/INDEX.md（`product/knowledge.md` §4/§5：`document-root=docs/agentdev`，初始化写 PROJECT/INDEX/CODE_MAP/features/README），因此它必须能映射到 `projectOverview`；映射应基于 `documentRoot`（或同时覆盖 `<documentRoot>/PROJECT.md|INDEX.md`、`<documentRoot>/features/…`）而不是仓库根的 `docs/INDEX.md`/`docs/product`/`features`。
- 影响：**fail-closed**（多发一次 `MISSING_CONTEXT`，不误放行、无内容越权）。默认布局下 Product 阶段无法用正式概览作为 `projectOverview`，只能自报 `bootstrapObservation`（语义上「还没有概览」），使缺口报告在「概览其实已存在」时失真；`featureNavigation`（各处仅 optional）同样不可满足。
- **对本包验收的影响**：AC-079 的四个 Given 子句（空项目 initialize / Product / Planning+ProductDefinition / L1+CompactPlan）与四个负例**全部复现通过**（§5），AC-030/031/036/093 不受影响；故判 **P2、不阻断**，但必须带账：路由 **Develop 小修**（一行目录映射 + 回归用例），并在 WP-06/WP-08/WP-09 接线时确认 `ProjectScope.documentRoot` 与目录词表一致。

### T-02 [P3] `Checkpoint.stage` 未做词表校验，非规范 stage 可被持久化

- 位置：`packages/core/src/context/checkpoint.ts` `validateCheckpoint`（对 `stage` 只做 `isNonEmpty`）与 `CheckpointStore.save`（无 `CONTEXT_STAGES` 校验）。
- 复现：`node /tmp/wp05t/probe-findings.mjs`（T-02 组）。
- 观察：`validateCheckpoint({stage:'not-a-stage', …})` ⇒ `[]`；`store.save` ⇒ `{ok:true}`，`load().checkpoint.stage === 'not-a-stage'`。
- 期望：`Checkpoint.stage` 类型为 `ContextStage`，且模块注释自述「stage」是 `validateCheckpoint` 强制的四条规则之一、A malformed checkpoint is refused rather than repaired；来自 DB/JSON 的畸形 stage 应在落库前被拒（`data.md` §2 `run.stage` 枚举）。
- 影响：仅校验宽松（无授权/内容影响），且 `stage` 会被 `rotateSession` 与冷启动 resume 位置继承，故 P3、不阻断；建议随 T-01 一并小修（`CONTEXT_STAGES.includes(stage)`），或把严格化明确登记给读取面（WP-08）。

### T-03 [P3] 实现记录残余 10 已被代码与残余 14 推翻（记录不一致）

- 位置：`.agentdev/work/WP-05/implementation.md:133`（残余 10：「`grantExpansion.extraTokens` 仍只要求非负整数（可为任意大小）」）对照 `:211`（残余 14：「T7 残余 10 的说法自本轮起不再成立」）与 `packages/core/src/context/ledger.ts` `grantExpansion`。
- 复现：`node /tmp/wp05t/probe-findings.mjs`（T-03 组）、`node /tmp/wp05t/exp11.mjs`（C1/C2）。
- 观察：`extraTokens ∈ {3000000, MAX_SAFE_INTEGER, 4095, -1, 1.5}` 全部 `VALIDATION_ERROR`，合法增量把上限抬到 8192（≤2000000）。
- 期望：同一记录内不应同时存在互相矛盾的残余条目；第 133 行应改为「已由 T8/W5R2-05 收紧为 4096–2000000」。
- 影响：纯文档一致性问题，不影响行为与验收；路由 Settlement（结算时订正）。

### T-04 [P3] 返回的 `ContextSnapshot` 未深冻结，且与调用方的 `ContextSelection` 同引用

- 位置：`packages/core/src/context/builder.ts` `buildContext` 返回路径（`snapshot` 与其 `selection`/`resolvedSources` 均未 `Object.freeze`）。
- 复现：`node /tmp/wp05t/probe-findings.mjs`（T-04 组）、`node /tmp/wp05t/probe-freeze.mjs`（原始探针）。
- 观察：`Object.isFrozen(snapshot)===false`、`isFrozen(resolvedSources)===false`、`isFrozen(resolvedSources[0])===false`；构建后改写调用方的 `sel.goal`/`reasonPerSource`，`snapshot.selection` 随之改变，且用返回值重算 `snapshotRef` **不再等于**构建时的 `snapshotRef`。磁盘冻结树不受影响（`manifest.json` 不含 selection payload，只含 `snapshotRef`/`policyHash`/`configHash`/`files[].address`）。
- 期望：`context.md` §1「ContextSnapshot 保存 selection…实际内容复制进不可变快照目录」；`ledger.entries()`/`Checkpoint` 都已返回冻结副本，同一模块族的快照对象宜同口径冻结（至少深冻结 `selection`/`resolvedSources` 或改为按值复制）。
- 影响：只影响「构建后、持久化前」的内存记录完整性；已冻结字节、内容 hash 与 `snapshotRef` 的身份计算均正确，故 P3、不阻断。

### 计数与阻断表

| 严重性 | 数量 | 编号 | 是否阻断 | 说明 |
|---|---|---|---|---|
| P0 | 0 | — | — | — |
| P1 | 0 | — | — | — |
| P2 | 1 | T-01 | 不阻断 | 必需输入映射缺口，fail-closed，不影响 AC-079 的四正例/四负例 |
| P3 | 3 | T-02、T-03、T-04 | 不阻断 | 词表校验宽松 / 记录不一致 / 内存对象未冻结 |
| 合计 | 4 | — | — | — |

## 7. 记录一致性核对

- **修改范围**：`git diff --name-only 0e047ab HEAD` 仅 `.agentdev/work/WP-05/review.md`；代码树 = `0e047ab`。T9 声明「仅 `packages/core/src/context/**` 与 `packages/core/test/context-*.test.ts`」与 `0e047ab` 的提交内容一致（源码 blob 与 R4.0 记录逐项相同，见 §1）。
- **测试数**：独立复跑六个 context 测试文件（`vitest run --project unit`）= `requirements 37`、`ledger 36`、`checkpoint 19`、`acl 50`、`builder 47`、`cold-start 24`，**合计 213**，与 T9 第 219 行一致；`pnpm test:unit` 32 文件 / **644** 用例，与 T9 第 246 行一致（T8 为 638）。
- **命令声明**：T9 第 244–247 行的 typecheck 0 / lint 0 / build 10 workspace / unit 644 全部独立复现一致；本轮另跑 integration 10 文件 / 124 用例（含真实容器）全绿。
- **承接项登记（逐条核对，均为「已登记」而非静默）**：
  1. **W5R2-12（命名式 transcript 路径网）**：`implementation.md:206/210` 登记为残余 13；实测 `docs/my-dev-chat.md` 仍可读（`exp4` A7b），而 `kind=transcript`／corpus allow-list／realpath 包含性三道结构防线独立复现成立（`exp4` A1、`exp7` C1–C4/D1–D2）。**本轮 verdict 按 P3 残余带账**：不阻断 AC-033（AC-033 的 Given 是「Developer 聊天」，其结构化通道已被封死；任意改名的"聊天"文件属语义/DLP 能力，非本包）。
  2. **W5R1-13（reader-Run capability 绑定）**：`implementation.md:128` 明确「按任务要求不实现，转 WP-01/WP-07」，且 `CheckpointStore.load` 仍无 reader capability 参数——转交属实。实测：调用方只要自报 `{runId, role}` 即可读到该 Run 的 Checkpoint（`exp4` C7）。**本轮 verdict 按 P3/承接带账**：AC-033/AC-034 在本包只证明 API/身份边界，工具与 capability 侧的强制属 WP-07（`execution.md` §3 挂载与角色 ACL）。
  3. **W5R4-01（gate 路径角色契约 `revision ≠ ref.version`）**：`review.md` R4.6/R4.9 登记；实测 `policyRevision='policy-rev-7'` 时 `role_contract` 源为 `{refVersion:'1', revision:'policy-rev-7'}`（`exp7` F1/F2）。非本轮 T9 回归（`909f95b` 即同形）。**按 P3 承接带账，不阻断 AC-034**：内容为内联且 hash 已钉住，触发者是受信 gate 端口，仅影响报告层身份一致性。
  4. **W5R4-02（`contextSources` 附加完整句柄丢 `sender`）**：`review.md` R4.6/R4.9 登记；实测附加 `{kind:'message',sender:'user'}` ⇒ `CONTEXT_FORBIDDEN`（fail-closed，无越权，`exp7` G1）。**按 P3 承接带账。**
  5. **Checkpoint 持久化（内存 store）**：`implementation.md:59` 登记残余 5；`createCheckpointStore()` 为内存实现且无持久化端口（`attempt.checkpoint_ref`/`snapshot(type='checkpoint')` 落库属集成包）。**承接 WP-08**，使 AC-035 的「跨物理 Session 保存」在本包只验证到字段与身份契约层。
  6. **WP-07 缺失的容器挂载负例**：`implementation.md:60` 登记残余 6；`apps/cli/test/container.integration.test.ts` 的 9 例只覆盖镜像/权限/网络/资源（`transcript|cross-project` 匹配数 **0**）。**AC-033/AC-034 的容器挂载级负例 UNVERIFIED，承接 WP-07**。
  7. **`extraTokens` 上界**：残余 10 与残余 14 自相矛盾，见 **T-03**（行为本身已正确有界）。
- **记录过度/不实声明**：除 T-03 外未发现新的过度声明；T8 第 198 行的口径订正已落实在原文（注明单 Feature 历史口径并指向 T9/W5R3-03），W5R3-03 修复后该断言普遍成立（`exp10` K2/K3）。
- **未复现项**：T9 第 218 行的「旧码反跑 6 条新用例全部失败」未独立复现（Test 写入范围仅限 `test.md`，不得改写工作树）；但 `review.md` R3.6 已独立复现三处旧行为，且本轮 `exp7`/`exp5` 在冻结点上验证了修复后的行为。

## 8. 未覆盖与剩余风险

| 项 | 状态 | 原因 | 承接 |
|---|---|---|---|
| AC-033/AC-034 的**容器挂载级**负例（Review 容器内 cat/find 也看不到聊天、跨项目目录不挂载） | **UNVERIFIED** | 执行面（Broker/容器/Grant）在 WP-07 才存在；`container.integration.test.ts` 无相关用例 | WP-07，回归见 WP-10 |
| Checkpoint 落库（`attempt.checkpoint_ref`/`session_ref`、`snapshot(type='checkpoint')`）与重启恢复 | **UNVERIFIED** | 本包 store 为内存实现（残余 5） | WP-08 |
| `ResolvedSource.revision` 在工作包/账本落库路径上的消费；builder `snapshotRef` 与 `SnapshotWriter.freeze('context', …, {identityPayload})` 的接线 | **UNVERIFIED** | WP-08/WP-09 尚未接线；本轮只在包公共 API 上验证 | WP-08/WP-09 |
| `readBudget` 的最终上界 `min(Profile.contextLimit, 模型窗口−maxOutput−4096)` | 未覆盖 | 本包无 Profile 输入（残余 11/14）；已证明 4096–2000000 一致性 | WP-08/WP-09 |
| 真实两轮交付后的冷启动检索质量（召回率/`excluded` 规模） | 未覆盖 | 本轮用固定样例投影（订单/支付/会话 + 20 份无关文档）；检索为确定性 CJK 二元打分 | WP-08/WP-10 |
| AC-093 的原子提交、README 可重建、旧格式逐条显示、`recordHash` 冲突 | 未覆盖（非本包） | 属需求池/Git 事务 | WP-04/WP-08 |
| 「Review 能发现真实代码缺陷」的完整闭环 | 未覆盖 | 需要真实 Agent Review Run；本包只证明其输入/工具不可达聊天、可读代码 | WP-06/WP-10 |
| `test:e2e`/`test:acceptance`/`test:live` | 未运行（按设计） | 契约返回 NOT_IMPLEMENTED | WP-09/WP-10 |
| T-01 在真实接线后的可达性（`documentRoot` 实际取值） | **未覆盖** | 需 WP-04/WP-08 初始化接线；本轮以 `DEFAULT_DOCUMENT_ROOT='docs/agentdev'` 与自定义 `ProjectScope` 复现 | Develop 小修 / WP-08 |
| T-02/T-04 的下游影响 | 未覆盖 | 需读取面（DB payload、Core 持久化）接线后才可量化 | WP-08/WP-09 |

**剩余风险**：T-01 会在默认文档根布局下让 Product/Planning 阶段多报一次 `projectOverview` 缺口（fail-closed，可用 `bootstrapObservation` 顶替），若在 WP-06/WP-08 接线前不修，会以「已初始化项目仍自报未初始化」的形式污染缺口报告与冷启动语义；其余为已登记、按包承接的边界，未观察到回归。

## 9. 结论

- AC-030/031/032/033/034/035/036/079/085/093 **全部通过**（AC-033/AC-034 的容器挂载级负例 UNVERIFIED，承接 WP-07；AC-093 只覆盖本包的 revision 绑定部分）。
- 计数：**10 通过 / 0 不通过 / 0 完全未覆盖**；自建实验 **307 条断言（306 通过 / 1 失败，唯一失败 = T-01 证据）**；契约命令 **6/6 退出 0**（unit 32/644、integration 10/124 含真实容器）；`git status --porcelain` 干净，`0e047ab → HEAD` 仅 Review 文档。
- 无 P0/P1；4 条 P2/P3（T-01…T-04）均已在 §6 说明对验收的影响并给出路由（T-01 建议 Develop 小修，T-02/T-04 可随修或承接 WP-08，T-03 交 Settlement 订正记录）。
- **Test 判定：PASS —— 接受 WP-05 的 AC-030/031/032/033/034/035/036/079/085/093。**
