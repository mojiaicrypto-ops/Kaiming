# WP-12 验收证据加固计划（hardening-plan）

- 状态：Planning（待用户对第 7 节待决问题表态）
- 只读产出：本文件是本切片唯一写入目标；`apps/**`、`packages/**`、`scripts/**`、`docs/**`、`tests/**` 一律不改。
- 依据：`.agentdev/work/WP-12/api-gap-audit-2.md`（§4 表、§5、§6、§7）、`docs/delivery/acceptance.md`（AC-001…AC-094）、`docs/delivery/implementation.md` §3（十条契约命令）、`scripts/e2e.mjs`、`scripts/lib/{e2e-checks,e2e-stack,drill-acs,live-drills,browser-suite,acceptance-drills,acceptance-evidence,acceptance-registry,acceptance-binding}.mjs`、`scripts/acceptance.mjs`、`tests/browser/**`、`.agentdev/work/WP-12/{T2,T3,T4,T4b,T4c,T5-plan,T6,T7a,T8a,T9}-implementation.md`（T5 尚无 implementation，只有 plan）。
- 约束：不改代码；不新增运行时依赖；不削弱任何既有断言；不新造第 11 条 `pnpm` 命令、不改十条命令名；不代决产品行为，文档/代码冲突一律登记为待决问题（§7）。

---

## 1. 现状与计数

### 1.1 已落盘证据的口径（必须带上，否则后面所有数字都会被误读）

| 事实 | 证据 |
|---|---|
| `acceptance-results.json` 为 `generatedAt 2026-09-14T13:18:40Z`、`gitHead 7c723ec`、`PASS 93 / ACCEPTED 1（AC-090）/ FAIL 0 / MISSING 0`、`drillsExecuted:true`；其 `codeDigest` 只是**那一刻**工作树的内容摘要 | `.agentdev/work/WP-12/acceptance-results.json` 字段；`.agentdev/work/WP-12/api-gap-audit-2.md:23` |
| 工作树当前 **147 条** `git status --porcelain` 条目（含 `M` 与 `??`），且 `tests/browser/**` **整目录未被 Git 跟踪**（`git ls-files tests/browser` = 0） | 本次实跑 `git status --porcelain`、`git ls-files tests/browser` |
| `e2e-results.json` 与 `acceptance-results.json` 不是同一次运行（14:30 vs 13:18），因此**当前没有任何一份证据同时覆盖提交前的 `HEAD` 与工作树** | 两个 JSON 的 `generatedAt` |
| `acceptance-binding.mjs` 的 `codeDigest` 覆盖 `CODE_PATHS`（`packages`、`apps`、`scripts`、`package.json`、`pnpm-lock.yaml`、`tsconfig*`、`vitest.config.ts`、`eslint.config.js`）的**工作树字节**，`gitHead` 与 `gitTree` 取 `HEAD` | `scripts/lib/acceptance-binding.mjs:30-40`、`:57-97` |
| `tests/browser/**` **不在** `CODE_PATHS` 内：改浏览器 spec 不会改变 `codeDigest`（证据与浏览器断言之间没有内容绑定） | `scripts/lib/acceptance-binding.mjs:30-40` 与 `:14-22` 的自述对比 |

### 1.2 未走产品路径的 AC 计数（审计口径，沿用不重算）

| 口径 | 条数 | 集合 |
|---|---|---|
| 纯库级（无应用层证据、无已执行演练） | 54 | `api-gap-audit-2.md:249` |
| 仅已执行演练、无提交套件应用层用例 | 9 | AC-001 AC-010 AC-037 AC-038 AC-041 AC-043 AC-057 AC-060 AC-066（`api-gap-audit-2.md:250`） |
| 应用层证据只有播种行 | 3 | AC-087 AC-088 AC-089（`api-gap-audit-2.md:251`、§5-B） |
| 复算校验 | 54+9+3 = 66 | 审计 §1 写「57 纯/播种 + 9 仅演练」＝54+3+9=66，与本表一致 |

**本计划的目标口径**：让上表每一行都有**真实产品路径**上的可重放证据；达不到的进第 3 节「诚实排除」，逐条写明为什么库级就是正确层级。

### 1.3 现有演练骨架（复用清单，不另起框架）

| 载体 | 入口 | 现有 AC 检查名 | 备注 |
|---|---|---|---|
| 无头真实栈（真 Core+SQLite+Git+`createDaemon`+BFF，回环端口 0） | `scripts/e2e.mjs` | `stack.boot`、`auth.lifecycle`、`requirement.save-git`、`board.rules`、`chief.routes-message`、`plan.approval-expired-card`、`inbox.decision-dedup`、`config.validation-preserves-input`、`attachment.upload-first-message`、`files.branch-preview-boundaries`、`surfaces.nine-real-state`、`events.watermark-reconnect`、`delivery.l2-chain`、`delivery.settlement`、`knowledge.patch-cold-start`、`offline.no-model-call`、`chief.message-to-stage`、`runtime.executes-attempt` | `scripts/e2e.mjs:232/274/345/509/597/651/780/866/944/1039/1114/1185/1344/1553/1640/1803/1826/2038`；真栈唯一入口 `scripts/lib/e2e-stack.mjs:103` `bootStack` |
| 真 Runner 子进程（真 `apps/runner` CLI + 真 Pi 会话 + 真 Core gateway + 回环模型桩） | `scripts/e2e.mjs` 内联构造 | `chief.message-to-stage`、`runtime.executes-attempt` | `scripts/e2e.mjs:1831-1913`（`createPrepareRun`/`createChildRunnerSpawnPort`/`createControlHandlers`）、`:2038-2224`；回环模型桩 `scripts/lib/e2e-stack.mjs:219-347`（带 `MESSAGE_DRILL_MARKER` 的 `tool_calls` 分轮应答 `:218/:245/:269/:304`） |
| 真 Chromium（Playwright 1.63.0，dev-only） | `pnpm test:e2e` 内嵌 `pnpm test:browser` | `browser.html-preview-and-download`、`browser.html-attack-samples`、`browser.live-layout`、`browser.keyboard-aria-i18n`、`browser.attachment-client-hints` | 驱动 `scripts/lib/browser-suite.mjs`（`runBrowserSuite`、`BROWSER_AC_CHECK_NAMES` `:44-50`）；栈 `tests/browser/stack-runtime.mjs:218` `openBrowserStack`；逐用例证据由 `tests/browser/reporter.mjs` 从 spec 的 `testInfo.attach('evidence')` 收集 |
| 真 Provider 纵向 | `pnpm test:live` | `drill.html-explanation`、`drill.l1-typo`、`drill.l2-delivery`、`drill.runtime-attempt`、`drill.message-to-stage`、`drill.session-streaming`、`provider.connectivity` | `scripts/live.mjs:214-233`；映射 `scripts/lib/drill-acs.mjs:55-63` |
| 真 CLI on 临时 `AGENTDEV_HOME` | `pnpm test:integration` 的 `apps/cli/test/ops.integration.test.ts` | 无 AC 名（`agentdev backup/restore/relocate` 真实演练） | `apps/cli/test/ops.integration.test.ts:282/356/499/559/580/614/691` |

> **命名纪律**：新增检查一律用 `checks.check(name, acs, body)`（`scripts/lib/e2e-checks.mjs:76`），返回**非空**证据串；浏览器/外部 runner 的逐 AC 结论用 `checks.record(name, acs, status, evidence)`（`:148`）。任何返回空证据的检查按 FAIL 关闭（`:82-86`）。

---

## 2. 分组表：非产品路径 AC → 最小真实演练组

共 **14 组**。每组是「一次真实执行 + 一组断言」，可独立 Review、独立落地；`关哪些 AC` 列出的就是该组把证据层从「库级/播种/仅演练」提升到产品路径的 AC。

### G1 多项目开户与路径识别（真 C 宿主 + 真 Git）

- **AC**：AC-023、AC-024、AC-025、AC-027、AC-028、AC-034
- **证据形状**：真 `startRuntime`（真 `ProjectDirectoryPort` 形态，T5.1）在**两个临时 Git 根**上 `open`；第二个临时**空目录** `create`；同仓库「子目录 / 符号路径 / 嵌套仓库」分别 `open`；真 CLI on 临时 `AGENTDEV_HOME` 走 `agentdev open`；两项目各写一行专属数据后按 `projectId` 交叉读。
- **断言（回归即失败）**：
  1. 两个 Git 根得到**不同** `projectId`，且各自 `~/.agentdev/projects/<projectId>/project.sqlite` 是**不同文件**（比对 `stat` inode/大小 + 分别读回各自写入的行）。
  2. 同仓库子目录 / 尾部斜杠 / 符号链接解析到**同一** `projectId`；嵌套仓库得到**独立** `projectId`，且对父项目的读请求返回 `NOT_FOUND` 而非父内容。
  3. `create` 后 `git rev-parse --verify refs/heads/agentdev/main` 成功、`git log --oneline` 恰有 1 条初始提交、`git status --porcelain` 为空；候选文档 `design` 仍为 `unconfirmed`。
  4. 无 Git 目录：只读问答完成；`project.initialize` 或交付启动返回 Git 初始化**授权请求**（`GitInitializationRequest`），授权前不产生任何写入（前后 `git status` 与文件 mtime 集合一致）。
  5. 脏工作区：启动交付返回 `blocked` + **逐路径 Hash 报告**（报告里每个路径的 hash 与 `sha256sum` 实算一致），文件字节不变。
  6. 交叉读：B 的 `projectId` + A 的 `requirementId` / artifact id / 下载 token / 订阅 cursor → 全部 `NOT_FOUND`（或 `CONTEXT_FORBIDDEN`），且响应体**不含**对方任何字段值。
- **复用**：`scripts/lib/e2e-stack.mjs:103` `bootStack`（需扩为可重复启动第二个项目）、`bootStack` 的 `harness.rpc/accepted/page`（`:576/:608/:617`）；浏览器侧的播种反例 `tests/browser/stack-runtime.mjs:145-213` 是**不得**再作为这些 AC 唯一证据的反面清单（T5-plan §7）。
- **落地文件**：`scripts/e2e.mjs`（新检查 `project.multi-root-identity`、`project.cross-read-isolation`）+ `scripts/lib/e2e-stack.mjs`（加「第二个临时仓库/空目录 + 第二个 store/daemon」的构建参数，**不改 `bootStack` 既有调用语义**）；库级证据保留但降为辅助。
- **依赖**：**强依赖 T5.1**（`apps/daemon/src/project-directory.ts` 尚未存在）。T5 未落地前本组不可执行。

### G2 项目初始化 / 冲突 / blocked（真 C 驱动 + 真 Git + 真 FS）

- **AC**：AC-025、AC-026、AC-027、AC-028、AC-029
- **证据形状**：真临时仓库（有内容、无知识、有测试）上跑 `project.initialize` 全相位；`writing` 相位注入中断（进程退出或 `InitStateStore` 落盘后中断）后重试；冲突文件（与候选文档同路径但内容不同）不覆盖；`dirty` / 无 Git / 设计冲突三条 blocked 分支。
- **断言**：
  1. `initialization.progress` 事件序列覆盖 `identifying→mapping→confirming→writing→ready`，`initialization.completed` 恰一次，且每条事件**写库先于发事件**（比对 `events.cursor` 与对应行的 `version`）。
  2. 来源/未知：扫描结果里每个 `sourceRef` 都能在真实仓库中找到该路径，未读路径进入 `unknowns` 且逐条有原因；`scanProject` 的预算（40 文件 / 512 KiB）在证据串里给出实际命中值。
  3. 代码**不移动**：初始化前后 `git ls-files` 集合相同、`git status --porcelain` 为空、无 `src/**` 文件 mtime 变化；**不产生开发 Requirement**（`store.requirements.list()` 在 `create`/`initialize` 后仍为空）。
  4. 中断重试：已写文件按 Hash 跳过（证据串给出跳过的路径与 hash），冲突文件**未覆盖**（内容 hash 与中断前一致），最终 `Ready` 满足最小门禁。
  5. blocked：脏工作区/无 Git/设计冲突三条分别返回 typed blocker，且 blocked 路径下**零写入**。
- **复用**：`packages/workspace/src/initialize.ts` 的状态机与 `createJsonFileInitStateStore`（`:409`）、`createNodeFileSystemPort`（`:95`）、`checkDeliveryReadiness`/`evaluateReadyGate`；真实仓库构造复用 `e2e-stack.mjs` 的 `gitPort.initRepository/commitPaths`（`:119/:155`）。
- **落地文件**：`scripts/e2e.mjs`（`project.initialize-phases`）+ 新增 `apps/daemon/test/project-initialization.integration.test.ts`（T5-plan §6 T5.3 已规划，本计划沿用其目标文件，不另造）。
- **依赖**：T5.3。**风险**：`initialize.ts` 目前**零生产调用方**（`api-gap-audit-2.md:51`），本组是本计划唯一「必须先接线才能测」的组。

### G3 需求池随 Git 迁移（第二 home，真 clone）

- **AC**：AC-087、AC-088、AC-089
- **证据形状**：仓库 A 通过**真实保存路径**（`requirement.save`）提交 queued/active/completed/cancelled/archived 五种记录 → `git clone` 到第二个 `AGENTDEV_HOME` → 空 SQLite 上可信 `open`（触发首次自动导入）→ `requirement.list/get` + 真实浏览器页面读。
- **断言**：
  1. 全程**没有任何** `store.requirements.insert` 直插（测试内以断言/reviewer grep 双保险；对照反例：`apps/daemon/test/protocol.integration.test.ts:655` 的 `seedRequirement`、`apps/web/test/helpers.ts:448-473`）。
  2. 五条记录全部可见且**稳定需求 ID 不变**；`active` 标「待继续」（`waitingToContinue`）且**不启动任何 Run**（`store.runs.list()` 为空）。
  3. `completed` 有完成摘要；`cancelled` 保留取消原因；`archived` 保留归档前状态；缺旧报告时必须标「详细证据未迁移」，且**不得**据此放行本机验证（`evidenceAvailability` 断言）。
  4. 再次导入幂等（第二次 `open` 写 0 行）；缺文件 / 重复 ID / Hash 不一致逐条 `REQUIREMENT_CONFLICT`，有效条目仍可见。
- **复用**：`packages/knowledge/src/requirements-pool.ts` 的 `parseRequirementPool`/`importRequirementPool`（`:719/:997/:1167`）、`packages/core/src/requirements.ts:96-220`（`RequirementProjection.import`，事件 `:174/:191`）；真 clone 用 `node:child_process`（与 `NodeGitPort` 同构，无新依赖）。
- **落地文件**：`scripts/e2e.mjs`（`requirement.pool-import-second-home`）+ 新增 `apps/daemon/test/requirement-import.integration.test.ts`（T5-plan T5.4 目标文件）。
- **依赖**：T5.4。**这是 3 条「播种行」AC 的唯一出路**（`api-gap-audit-2.md:238-240`）。

### G4 消息→Chief→派生授权→分派（无播种，真 Runner 子进程 + 回环模型）

- **AC**：AC-003、AC-005、AC-006、AC-069、AC-085（可选并入 AC-004，见 §7-Q10）
- **证据形状**：`conversation.message.send` 一条真实消息 → 真 Chief Run → `assessment.submit` → `agent.dispatch` → 真专业 Runner 子进程 → `stage.submit`；另一条**混合意图**消息拆分为两个 Work；第三个场景用真 loopback 模型跑出一次有理由的**追加读取**并让阶段结果携带封口 hash。
- **断言**：
  1. 无任何播种行（无 `seedWork`/`store.works.insert`/`seedRequirement`）：Work、Requirement、Run 都由消息产生。现有 `chief.message-to-stage` 已做到（`scripts/e2e.mjs:1826-2028`），本组把它扩到混合意图与账本封口。
  2. 混合意图：一条消息产生 **≥2** 个 Work，各自 `scope`/`purpose` 独立，说明类 Work 的 `level === 'none'` 且先于交付类 Work 完成/可先返回。
  3. 派生授权：`work.authorizationRef` 指向的 authorization 的 `sourceRef.id === 消息 id`（现有断言 `scripts/e2e.mjs:1967-1971`），且环境操作（bash/网络/secret/push）**不**在派生范围内。
  4. 消息状态：`received→processing→processed` 恰一次，`message.failed` 零次；`board` 在消息处理后含该 Requirement。
  5. 账本封口：阶段结果的 `readLedgerSeq/readLedgerHash` 等于 Runner 真实账本的封口值；用**旧** hash 再提交一次阶段结果必须被拒；提交后再读取必须被拒（AC-085）。
- **复用**：`scripts/e2e.mjs:1826` 的整段装配（`createProjectExecution` + `createPrepareRun` + `createChildRunnerSpawnPort` + `createControlHandlers`）；回环模型桩的 `tool_calls` 分轮应答（`scripts/lib/e2e-stack.mjs:245-321`）。
- **落地文件**：`scripts/e2e.mjs`（扩 `chief.message-to-stage` 为 `chief.message-to-stage` + 新 `chief.mixed-intent`、`runner.read-ledger-seal`）；`apps/daemon/test/assessment-dispatch.integration.test.ts` 已有 AC-003/005/069 命名用例（`:498/:629/:694`）可保留为集成层互补。
- **依赖**：T2 已落地（`apps/daemon/test/assessment-dispatch.integration.test.ts` 存在）。**不依赖** T5。

### G5 项目切换（真 Chromium，单入口单会话）

- **AC**：AC-023、AC-024、AC-034
- **证据形状**：真 Playwright 登录一次 → `/projects` 列出两个项目 → 切到 B → 看板/Runs 显示 B 数据且**无 A 任何痕迹** → 切回 A；Live 只流当前项目。
- **断言**：
  1. 登录后**未再次出现登录表单**（会话跨项目复用）；`/projects` 同时含两个 `data-project="…"`。
  2. 切到 B 后页面 `data-project` 为 B，且**不存在** A 的 requirement / run / feature id 字符串；反向同理。
  3. 把 A 的 `projectId` 强行塞进指向 B 的 `/rpc` 必须被拒（真实浏览器内 `fetch`），而不是静默返回 B 的默认项目数据。
  4. 切项目后 Live 面板的订阅事件不含另一项目的 `entityId`；订阅游标的旧值触发 `RESYNC_REQUIRED` 或只给 snapshot。
- **复用**：`tests/browser/helpers.mjs`（`signIn`、`openPage`、`rpcInBrowser`、`gitRevision`）、`tests/browser/reporter.mjs`（逐用例 `evidence` attach）、`tests/browser/stack-runtime.mjs:218` `openBrowserStack`（需扩为两项目栈）。
- **落地文件**：`tests/browser/ac-projects-switch.spec.mjs`（新；T5-plan T5.6 已点名）+ `tests/browser/stack-runtime.mjs`（两项目夹具）。
- **依赖**：T5.5（单入口 BFF + 切换器）与 T5.1。

### G6 交付决策分支（真栈 + 真 Gate，回环模型）

- **AC**：AC-008、AC-009、AC-015、AC-016、AC-019
- **证据形状**：在 G4 的真实链上派生三个分支：①一字符权限/金额改动 → 命中 L3 且**不按行数降级**；②真实 Diff 超过 3 文件/20 行 → 写入范围扩展前**重评并升级**，旧 Plan 被拒绝；③执行中出现行为选择 → `decision.resolve` 两个分支（本次处理 / 以后或拒绝）；④Test 报 `not_covered` 或 `blocked` → 完成请求被 Gate 阻断。
- **断言**：
  1. 一字符语义改动：`assessment` 的 `level === 'L3'`（或触发产品决定的等级），证据串给出真实 diff 行数与命中规则；**不得**出现按 diff 行数降级为 L1 的路径。
  2. 超限升级：升级后同一 Work 关联 **Requirement**（`store.requirements.list({where:'work_id = ?'})` 非空），旧 Plan 的 `plan.approve` 返回 `GATE_NOT_READY` / 版本冲突，源码 hash 不变。
  3. 行为选择「本次处理」：产生 `decision` 行 + 新 Product/Plan，旧受影响证据被标记失效（`invalidated`）。
  4. 「以后」：生成 Queued Requirement 且当前验收状态不变；「拒绝」保留原因且当前验收不变。
  5. `not_covered`：完成请求被拒（typed Gate 错误）；`blocked`：**不完成**；补足覆盖或登记风险处置后放行。
- **复用**：`scripts/e2e.mjs` 的 `delivery.l2-chain`（`:1344`）与 `plan.approval-expired-card`（`:651`）装配；`packages/core/src/gates.ts`、`packages/domain/src/delivery.ts`。
- **落地文件**：`scripts/e2e.mjs`（`delivery.level-escalation`、`decision.branches`、`test.coverage-gate`）。
- **依赖**：T2 + T6（domain/gates 已就位）。**注意**：AC-019 需要真实 `stage_yield` 的 `not_covered/blocked`；回环模型桩需加一个 prompt 标记分支（改 `scripts/lib/e2e-stack.mjs` 的桩，不改产品）。

### G7 交付失败链与运行环境故障（真 Runner 子进程 + 真 kill）

- **AC**：AC-017、AC-018、AC-021、AC-057、AC-058、AC-061、AC-063、AC-080
- **证据形状**：在真实运行中的 Runner 上依次注入：Review 发现缺陷 → 自动返工；Developer 自验 → 拒绝；kill 活 Runner；用旧 epoch/旧结果回写；daemon 在 Starting/Running 时崩溃后重启；同一 Work 两个同角色 Run 的 `once` 工具响应丢失后被兄弟 Run 窃用。
- **断言**：
  1. 返工：`Finding` 提交后**无需人工转发**，新独立 Review/Test Run 产生，旧 Review/Test 结果被标记失效；`Finding` 关闭只能由独立 Review 的验证完成（Developer `verified` 被拒）。
  2. kill 活 Runner：Run 停为 `interrupted`，Attempt 标 lost，无重复副作用（写入路径的最终 hash 只对应一次写入）；后续 Attempt 允许且**不需要** recovery 决策（现有断言 `scripts/e2e.mjs:2203-2216`）。
  3. 旧 epoch/旧结果：拒绝覆盖但保留诊断（事件里留下被拒原因）。
  4. 重启：`recoverAfterRestart` 比对真实 `pid`/`epoch`，**不**按旧字段直接置 `running`；`RunRecoveryService` 的 resume 决策绑定到**该 Run** 而非整个 Work。
  5. `ref` 后崩溃：CAS 复用同一 commit，状态补齐，`settlement.completed` **恰一次**。
  6. `once` 绑定：兄弟 Run 重放被拒（`NOT_AUTHORIZED`/`CONSUMED`），原 Run 重试同一操作返回**原结果**且不重复副作用。
- **复用**：`scripts/e2e.mjs:2038` 的 `runtime.executes-attempt`（含 `createNodeProcessProbe` 与真实 kill）；`packages/core/src/recovery.ts`；Grant 路径复用 `apps/daemon/test/tool-permission.integration.test.ts` 的装配（已命名 AC-049/AC-080）。
- **落地文件**：`scripts/e2e.mjs`（扩 `runtime.executes-attempt` 的 AC 列表，新增 `findings.auto-rework`、`recovery.restart-epoch`、`settlement.crash-after-ref`）；`packages/core/test/recovery.test.ts`、`settlement.integration.test.ts` 保留为库级互补。
- **依赖**：T2 + T8a（均已落地）。**注意**：`stage_result` 持久化与「Run 在 ready 前不置 running」属 T8a 范围（`.agentdev/work/WP-12/T8a-implementation.md:181-184`），本组只做断言，不改产品。

### G8 工具桥权限与隔离（真 Runner 子进程 + 真 Broker/容器）

- **AC**：AC-045、AC-046、AC-047、AC-048、AC-049、AC-050、AC-051、AC-053
- **证据形状**：真 Runner 子进程经真 Broker 执行 `read/search/write/edit/bash/git`；越根路径 / 符号链接逃逸 / 只读角色 bash 写 / 私网目标逐条被拒；专业 Agent `request_dispatch` 只产生 Chief 待办；两个子 Run 一败一存；无 Docker 时拒绝；未信任仓库不加载任何仓库资源。
- **断言**：
  1. 每次工具调用都有审计事件（`tool.invoked`/`tool.refused`）与 Grant 绑定；拒绝路径返回**结构化错误**给模型而不是崩溃（Runner 进程仍存活并继续下一轮）。
  2. 越界样本全部拒绝且**零副作用**（目标路径 hash 与内容不变；拒绝路径的容器/宿主无残留进程）。
  3. 无孙 Run：`request_dispatch` 后 `store.runs.list()` 中该 Work 的 Run 数不变，Chief 侧出现待办；Chief 选 Context 后才派发。
  4. Join：required 子 Run 失败 → 兄弟结果保留、父可获全部结果、相关 Gate 阻断；新 Chief 消息可处理。
  5. 结构化交付：口头完成不通过；连续两次 Schema 错误 → `contract_violation`（stage 结果为 `failed` 且带该 code）。
  6. 无 Docker：环境探测为不可用时**拒绝**而不是降级到宿主全权；Secret 只在受权用途注入，UI/Artifact/日志中 grep 不到已注册 Secret 值（诱饵凭证扫描）。
  7. 未信任仓库：extension/resource loader 轨迹里没有任何仓库来源路径被激活。
- **复用**：`apps/daemon/test/tool-bridge.integration.test.ts`（真 `createProjectExecution` + 真 `apps/runner/dist/cli.js` 子进程）、`apps/daemon/test/tool-handler.integration.test.ts`、`packages/core/test/tool-http.integration.test.ts`（真 Docker）、`apps/cli/test/doctor.integration.test.ts`。
- **落地文件**：`scripts/e2e.mjs`（`tool.broker-admission`、`dispatch.no-grandchild`、`join.sibling-failure`、`stage.contract-violation`）。
- **依赖**：**T3 工具桥在制**（`tool-bridge.integration.test.ts` 需先 `pnpm build`，见 T3 头注）。T3 未收口前本组不得开跑。

### G9 上下文与预算（真 daemon + 真 Runner + 真账本）

- **AC**：AC-030、AC-031、AC-032、AC-033、AC-034、AC-035、AC-036、AC-039、AC-040、AC-079
- **证据形状**：真实阶段 Run 冻结 `DispatchSnapshot` 后，从**真实持久化行**读回：Chief 指定的来源与原因、追加读取账本、ACL 拒绝轨迹、Checkpoint 轮换、预算越界、冷启动选择顺序、非法知识投影保留最后有效、初始阶段四个 Context 正负例、跨项目 SourceRef 拒绝。
- **断言**：
  1. Snapshot 忠实记录 Chief 的选择（逐条 `sourceRef`+`reason` 与 assessment 一致）；Builder **只**校验并补齐必需项，不扩模块。
  2. 缺有效验收/Plan 时 Review 得 `MISSING_CONTEXT` 且给出精确缺口，Chief 补齐后可执行。
  3. 追加读取进入 ledger（seq 递增不重用，最终 hash 覆盖全部读取），提交后再读被拒。
  4. Developer 聊天/Transcript 对 Review **输入与工具**都不可读；可查相关代码。
  5. B 的项目引用 A 的 SourceRef/Artifact → `NOT_FOUND`/`CONTEXT_FORBIDDEN`，B 的上下文不含 A 内容。
  6. 新 Session 恢复角色/任务/权限/来源；旧摘要**不改变**批准状态。
  7. 上下文超限报告具体缺口与缺失 token 数；不整库注入；预算外值（<4096 / >2000000）被拒。
  8. 冷启动顺序 `overview → current work → navigation → constraints → bodies` 且每项给出理由；同查询两次结果**完全一致**（确定性）。
  9. 非法知识：投影拒绝发布、保留最后有效并标 `stale`、断链阻断；随后有效文档可清 stale。
  10. 初始阶段：空项目下 `initialize`/Product/Planning/L1 Develop 四个 Context 合法启动；只缺**真实上游**输入时才拒绝（不形成循环）。
- **复用**：`packages/core/test/context-*`（库级仍保留为规则证据）；产品路径用 G4 的真实 Run 装配 + `store.contextSnapshots`/`readLedger` 读回；`scripts/e2e.mjs` 的 `delivery.l2-chain` 装配。
- **落地文件**：`scripts/e2e.mjs`（`context.snapshot-fidelity`、`context.acl-and-budget`、`context.cold-start-determinism`、`knowledge.invalid-projection`）。
- **依赖**：T2 已落地；AC-034 部分依赖 T5（跨项目）。**T4b 的 `context.preview` 尚未实现**（`api-gap-audit-2.md:56`）：本组**不**据此断言 `context.preview`，只用真实 Builder/Snapshot 路径。

### G10 Task 依赖与 Manifest（真 Runner + 真 Git，多 Task）

- **AC**：AC-010、AC-014、AC-046、AC-066、AC-081、AC-082、AC-083
- **证据形状**：两个 Task 的真实 DAG（A 新增接口、B 依赖 A）→ `plan.approve` 真实写 `task` 行 → `task.list/get` 读回 → 真 Runner 依次执行 → A 通过后启动 B → 最终集成；真实 Pi 会话续话/压缩/资源释放。
- **断言**：
  1. `plan.approve` 后 `store.tasks` 有真实行（现有代码 `apps/daemon/src/protocol.ts:4148`，由 `materializePlanTasks` 调用）；本组断言经 `task.list/get` 读回并可被 UI 消费。
  2. B 的输入含 A 的**冻结成果**；`task.dependencyRevision` 与 `dependencyManifestRefs` 指向 A 的真实 revision/Manifest，而非占位值。
  3. 祖先变化使 B 失效（B 被标失效且不能被集成）；最终集成**不重复应用**祖先。
  4. 无 Task 的文档路线或集成 Review 发现的缺陷可提交 Finding（**无需伪造 taskId**），修复后由独立新 Review 核验关闭。
  5. AC-082：无 Task 的调查 Run 冻结为**单文件**范围；重启恢复后读其他 Work 文件仍被拒，Work 的宽范围不能替代 DispatchSnapshot。
  6. AC-066：真实 Pi 会话创建/流式/工具/abort/压缩/恢复/订阅与资源释放全部按契约（库级 `CuratedEvidence` 保留，产品路径由真会话补一次）。
- **复用**：`apps/daemon/test/retry-recovery-tasks.integration.test.ts`（已命名 AC-081，真 Git/SQLite/Orchestrator）；`scripts/live-drills.mjs:1475` `runRuntimeAttemptDrill` 的真会话装配。
- **落地文件**：`scripts/e2e.mjs`（`task.dependency-dag`）+ `apps/daemon/test/retry-recovery-tasks.integration.test.ts`（扩依赖失效断言，已有文件）。
- **依赖**：T4b 的 `task.list/task.get`（审计 §2.1 列为新缺口）。**这是本计划唯一依赖 T4b 未落地命令的组**。

### G11 运维原语（真 CLI on 临时 AGENTDEV_HOME）

- **AC**：AC-064、AC-065、AC-091、AC-094
- **证据形状**：真 CLI `agentdev backup` → 人工损坏一个副本 → `agentdev restore` → 新目录里比对 hash/知识/证据；`agentdev relocate` 的同根与跨根分支；迁移 checksum 错误停止启动；需求保存与交付共享集成锁的竞争；旧投影不得覆盖新 Git 记录。
- **断言**：
  1. 备份目录可被 `restore` 完整还原：逐文件 hash、知识投影行、证据行、Run 状态一致；活动 Run 被标为需恢复；缺 Secret 时 `restore` **阻断**（`PROVIDER_BLOCKED`），补齐后通过。
  2. 迁移：checksum 错误 → 备份事务 + 停止启动、不运行任何 Agent；失败迁移回滚并报版本。
  3. 保存/交付竞争：在 Git CAS 前后注入退出并重试 → **不重复保存**、不静默丢需求；新代码提交包含**最新**需求池；完成记录与结算一致；`metadata` 变更**不冒充**代码验证。
  4. 旧投影保存被 `recordHash` 拒绝；恢复不暴露半对文件；显式修复后可导入再保存；完成/归档保持目录与引用不变，完成摘要两份一致。
- **复用**：`apps/cli/test/ops.integration.test.ts:282/356/614`（真临时 home + 真 daemon）、`packages/workspace/test/cas.integration.test.ts`、`packages/storage/test/migrations.integration.test.ts`。
- **落地文件**：`scripts/e2e.mjs`（`ops.backup-restore`、`requirement-save.cas-race`）。
- **依赖**：T6（已落地）。注意 T6 文档自述 G1（带 `secretRef` 的 Provider 下 Chief Run 不入队）与 G9（演练证据 0/0）两个残留会**伪造出**假绿的恢复演练，必须先解决或在证据里显式声明跳过的那一半。

### G12 BFF 断开与运行保持（真 Chromium + 真 BFF）

- **AC**：AC-054、AC-056
- **证据形状**：真浏览器里在 Run 活动中关闭 BFF 上游（`protocol.closeAll`）→ 后台继续 → 重连按水位同步；长模型调用中同 Project 发消息/取消，1 秒内得到准入与响应。
- **断言**：
  1. 断连期间 Work 状态**不变**（现有无头断言 `scripts/e2e.mjs:1256-1265`），重连后页面显示真实终态而非乐观完成。
  2. 长操作不阻塞：在真 loopback 模型 `SLOW`（`scripts/lib/e2e-stack.mjs:225/341` 已支持）挂起期间，第二条命令的准入与响应延迟 **< 1000 ms**（真实计时，测量值写进证据串）。
- **复用**：`scripts/e2e.mjs:1185` 的 `events.watermark-reconnect`（已覆盖水位，本组把「浏览器真实断连」与「1 秒准入」补上）；`tests/browser/helpers.mjs`。
- **落地文件**：`tests/browser/ac-054-056-connection.spec.mjs`（新）+ `scripts/e2e.mjs`（`mailbox.nonblocking`）。
- **依赖**：无（T7a 已落地）。

### G13 事件层的连接、去重与持久写（真 WS + 真 store）

- **AC**：AC-025、AC-038、AC-055、AC-059、AC-060
- **证据形状**：真 `EventHub` + 真 WS：慢连接超过软限 → 临时流合并；硬限 → 断开但关键持久事件不丢；其他 Run 继续；扩大订阅范围 → 快照+后继事件、过期 cursor 明确重同步；同一 `idempotencyKey` 的写命令断线重发得到**同一实体/结果**、同键不同载荷冲突；三视图（design/delivered/work）读真实投影；`project.create` 后能在**新项目自己的流**读到 `project.created`（这一点只有 T5 把 `project.create` 接线后才成立，见依赖）。
- **断言**：
  1. 软限合并后**持久事件集合不丢**（比对 `events.readAfter` 与客户端收到的持久事件 id 集合相等）。
  2. 硬限断开后重连从 Ack 水位继续，不重复已确认事件；**其他 Run** 的状态与事件继续推进。
  3. 扩大范围：`mode === 'replay'` 时给快照 + 水位后事件；cursor 过期 → `RESYNC_REQUIRED` 明确返回，而不是静默丢事件。
  4. 幂等：`conversation.message.send` 用同一 `idempotencyKey` 断线重发 → 同一 `messageId` 与同一结果；同键不同 `body` → typed 冲突错误；`store.messages` 行数与 `message.received` 事件数各**恰一次**。
  5. 三视图分离：`delivered` 不含 Work overlay；`design` 显示 confirmed 意图；`work` overlay 不污染另一 Work。
  6. `project.created` 在**新项目自己的**事件流中恰一次，`entityId === 新 projectId`，且 data 含 root（归属口径见 §7-Q9）。
- **复用**：`packages/core/test/events-hub.integration.test.ts`（库级保留）；产品路径复用 `scripts/e2e.mjs:1185` 的 WS 装配 + `surfaces.nine-real-state`（`:1114`，已含三视图，当前声明 AC-038）+ `harness.accepted(..., { idempotencyKey })`（`scripts/lib/e2e-stack.mjs:597`）。
- **落地文件**：`scripts/e2e.mjs`（扩 `events.watermark-reconnect` 的 AC 列表到 AC-059/AC-060，新增 `events.slow-connection-backpressure`、`write.idempotency-replay`）。
- **依赖**：T9 的临时流裁决（`token.delta`/`log.delta`/`heartbeat` 未实现，见 §7-Q3）：本组只断言**已存在**的持久通道，不假装临时流存在。AC-025 的 `project.created` 子句依赖 T5.2 接线；T5 未落地时本组先只落地其余四条 AC。

### G14 无播种配置冻结与窄 Range 恢复（真 Runner 子进程）

- **AC**：AC-044、AC-082
- **证据形状**：活动中 Run 的配置被修改后，原 Run 仍可查询其冻结配置且**不换模型**；重启后窄范围权限按 DispatchSnapshot 保持。
- **断言**：
  1. 修改全局角色配置后，已创建 Run 的 `configSnapshotId` 不变、snapshot 内容不变；**新** Run 才生效。
  2. 恢复后 `DispatchSnapshot` 的 readScope/outputSchema 与原 Run 一致；Work 的宽范围不能替代。
- **复用**：`scripts/e2e.mjs:2038` 的真 Runner 装配 + `harness.snapshots`；`scripts/live-drills.mjs` 的 `drill.l2-delivery` 已断言「各角色 distinct config snapshots」（复用其断言形状）。
- **落地文件**：`scripts/e2e.mjs`（`config.frozen-snapshot`）。
- **依赖**：T2 已落地。

### 分组覆盖汇总

| 组 | AC 数 | 载体 | 真 Provider？ | 依赖未落地切片 |
|---|---|---|---|---|
| G1 | 6 | `scripts/e2e.mjs` 新检查 | 否 | **T5.1** |
| G2 | 5 | e2e + daemon integration | 否 | **T5.3** |
| G3 | 3 | e2e + daemon integration | 否 | **T5.4** |
| G4 | 5 | e2e 扩 `chief.message-to-stage` | 否（回环） | — |
| G5 | 3 | `tests/browser/**` 新 spec | 否 | **T5.5** |
| G6 | 5 | e2e 新检查 | 否（回环） | — |
| G7 | 8 | e2e 扩 | 否 | — |
| G8 | 8 | e2e 新检查 | 否 | **T3 收口** |
| G9 | 10 | e2e 新检查 | 否 | — |
| G10 | 7 | e2e + 既有 integration | 否（AC-066 真会话） | **T4b `task.list/get`** |
| G11 | 4 | e2e 新检查 | 否 | — |
| G12 | 2 | `tests/browser/**` 新 spec | 否 | — |
| G13 | 4 | e2e 扩 | 否 | T9（临时流裁决）、T5.2（`project.created`） |
| G14 | 2 | e2e 新检查 | 否 | — |
| **合计** | **72 条（唯一 AC 71）** | | | |

复算：6+5+3+5+3+5+8+8+10+7+4+2+4+2 = 72，其中 AC-025 在 G1/G2、AC-034 在 G1/G5/G9、AC-046 在 G8/G10 重复出现，去重后唯一 AC 数 **71**。其中 **35 条本来已有应用层证据**（本计划把证据形状升级为「同一次真实产品路径执行 + 逐条断言」，属复验加固），**36 条是待提升**（从库级/播种/仅演练提升为产品路径）。66（审计口径待提升）= 36（本节提升）+ **30（第 3 节诚实排除）**。✔

---

## 3. 诚实排除与「库级即正确层级」（30 条）

**判定原则**（必须原样写进验收报告，不得含糊）：一条 AC 只有在「把断言搬到真实产品路径不会增加任何可观察的判别力」或「本环境无法提供真实故障源」时，才允许排除。三类理由，逐条枚举见 §3.1：

- **A 类｜纯解析器 / 纯格式**：判别力的全部信息都在**输入解析结果**里（字段组合、冲突枚举、投影规则），产品路径只是给它套一层真栈外壳。代表：AC-040、AC-042、AC-086、AC-092（半条）。
- **B 类｜存储层 / 传输层故障注入**：产品路径要么需要真实模型**故意违规**（把「验证门禁」偷换成「验证模型出错」），要么需要**篡改真实数据库/预置账本**（破坏性注入，且判别力更弱）。代表：AC-013、AC-020、AC-022、AC-048（缺 Docker 分支）、AC-053、AC-065。
- **C 类｜环境受限 / 非确定性 / 产品面缺失**：需要可控时钟、可控模型行为、Linux-only 服务管理器，或当前产品面本身就是空实现。代表：AC-011、AC-021、AC-024（枚举）、AC-035、AC-039、AC-049（时限）、AC-050（Full Access）、AC-062、AC-067、AC-094（跨 root）。

**不对应任何 AC 编号、但验收报告必须显式声明**：

- **systemd 单元**：`.agentdev/work/WP-12/T6-implementation.md:21/101` 明确 launchd 已在**本机真机**执行（`T6-launchd-drill.sh`，exit 0），systemd `agentdev.service` **本机未执行**、仅静态核对，需 Linux 环境补 `systemctl --user enable/status/disable`。不得用 launchd 的通过代替。
- **跨 root 的 `agentdev relocate`**：已登记缺口（T6 G2/G4，现 fail-closed）。

### 3.1 逐条枚举（整条排除 20 条 + 子句级排除 10 条）

**整条排除（20 条）**——产品路径不会增加判别力，或本环境没有该故障源。**这 20 条就是审计口径「仅库级/播种」中不再提升的全部**：

| # | AC | 类别 | 一句话理由 | 库级证据归属 |
|---|---|---|---|---|
| 1 | AC-040 | A 纯投影规则 | 非法知识「拒绝发布 + 保留最后有效 + 标 stale + 断链阻断」是投影构建规则；产品路径要让真实会话产出非法文档，必须先伪造非法写入（制造故障），判别力不增反降 | `packages/knowledge/test/projection.test.ts`（4 条） |
| 2 | AC-042 | A 纯投影规则 | 观察 vs 确认的差距列举是 `knowledge/views.ts` 的纯函数；真实运行下该状态只能来自夹具 | `packages/knowledge/test/views.test.ts:329`、`packages/workspace/test/initialize.test.ts` |
| 3 | AC-086 | A 纯格式校验 | `parseFeatureDocument` 的字段合法性价值在**枚举每一种非法组合**，只有表驱动单测能做到 | `packages/knowledge/test/feature-format.test.ts`（7 条 curated） |
| 4 | AC-092（半条） | A 纯解析器 | 「重复 ID / 同版本异内容 / 缺文件 / Hash 错」逐条冲突是解析器行为 | `packages/knowledge/test/requirements-pool.test.ts`（7 条 curated）；另一半由 G11 覆盖 |
| 5 | AC-013 | B 事务内 hash 比较 | 门禁拒绝的判别力在 `PlanGateService` 批准事务内的前后源码 hash；产品路径要跑出同一状态必须让模型**故意**违规 | `packages/domain/test/delivery.test.ts`、`packages/core/test/base-revision.integration.test.ts` |
| 6 | AC-022 | B 账本 CAS 竞态 | 预算原子拒绝在批准事务内做 `tokensReserved` CAS（`gates.ts:693-699`）；产品路径要么并发提交（非确定），要么预置账本（用夹具制造状态，判别力更弱） | `packages/domain/test/delivery.test.ts`、`packages/domain/src/dispatch.ts:80-83` |
| 7 | AC-065 | B 破坏性存储注入 | checksum 错误 → 停止启动要求篡改真实数据库文件，属破坏性注入且污染安装 | `packages/storage/test/migrations.integration.test.ts`（6 条 curated） |
| 8 | AC-048（缺 Docker 分支） | B 环境反例缺失 | 「缺 Docker 时拒绝」需要一台真的没有 Docker 的机器；本机 Docker 可用，无法同时提供正反例 | `apps/cli/test/doctor.integration.test.ts`、`packages/core/test/tool-http.integration.test.ts`；可用分支由 G8 覆盖 |
| 9 | AC-020 | B 破坏性注入 | 「安全点暂停 + 无新写入 + Checkpoint」的判别力在领域检查点矩阵；产品路径需在生产库上注入暂停点 | `packages/domain/test/delivery.test.ts` |
| 10 | AC-053 | B 白名单穷举 | 「Trust 后只有**被选择**的 Skill/内置资源可用」是 loader 白名单穷举；可观察部分（未信任不加载）已由 G8 覆盖 | `packages/pi-runtime/test/trust.test.ts`（25 条） |
| 11 | AC-011 | C 交互面缺失 | L3 需要「明确授权 + 回退 + 逐项审核 + 恢复演练」，产品当前没有 L3 授权交互面（T2 Q1=B 只派生 scope，环境操作另批） | `CURATED_EVIDENCE['AC-011']`（3 条，真 `PlanGateService` + 真迁移回滚） |
| 12 | AC-062 | C 非确定性模型行为 | 两个已通过 Task 改同一文件制造冲突需要模型分别改两侧；库级用**真 Git 仓库**构造冲突，确定且不 flaky | `packages/core/test/wp08-failures.test.ts` |
| 13 | AC-067 | C 产品面为空 | `extension.set` 诚实返回空清单且 `services.extensions` 无装配点，当前没有可写的扩展面 | `packages/pi-runtime/test/extensions.test.ts` + `apps/runner/test/attempt.integration.test.ts`（5 条 curated） |
| 14 | AC-035 | C 快照枚举 | 「角色/任务/权限/来源恢复 + 旧摘要不改批准状态」是 checkpoint 字段矩阵，产品路径需构造满 Session | `packages/core/test/context-checkpoint.test.ts` |
| 15 | AC-039 | C 固定样例 | 「订单依赖支付规则」是固定样例的 Snapshot 期望集合，库级即固定样例，搬到 e2e 只是换外壳 | `packages/core/test/context-cold-start.test.ts` |
| 16 | AC-021 | C 状态矩阵 | 「取消含活动子 Run」的 `cancelling`/`recovery`/`cancelled` 矩阵；真实取消路径由 G7 用真 kill 覆盖 | `packages/domain/test/delivery.test.ts`（50 条） |
| 17 | AC-050（Full Access 分支） | C 需要 Full Access 启动 | 「宿主开发执行下领域 Gate 仍保留」的负例需要真的以 Full Access 启动并尝试绕过 Review | `packages/core/test/broker.test.ts`（72 条）；其余由 G8 覆盖 |
| 18 | AC-049（过期 Grant 子句） | C 需可控时钟 | 「过期 Grant 无效」的边界需要可控时钟；产品路径的时钟是真实的，边界不可复现 | `packages/domain/test/permission-delivery.test.ts`（68 条）；once 绑定由 G7/G8 覆盖 |
| 19 | AC-024（符号/嵌套枚举） | C 枚举而非行为 | 符号路径与嵌套仓库的**枚举**留在库级；可观察的「同一 projectId / 独立 projectId」由 G1／G5 覆盖 | `packages/core/test/identity.integration.test.ts`（8 条） |
| 20 | AC-094（跨 root relocate 子句） | C 功能未落地 | 「跨 root 身份迁移」已登记缺口并 **fail-closed**（T6 G2/G4）；同根分支已在 `apps/cli/test/ops.integration.test.ts:614-690` 真实执行 | `packages/workspace/test/cas.integration.test.ts`、`packages/core/test/requirement-save.integration.test.ts` |

**子句级排除（10 条）**——该 AC **有**产品路径证据（第 2 节），但另有子句明确留在库级，报告须逐条注明哪一半是产品路径：

| AC | 产品路径（第 2 节） | 留在库级的子句 |
|---|---|---|
| AC-014 | G10（`plan.approve` 自动批准 + 写 task 行） | 审批依据的哈希矩阵 |
| AC-018 | G7（Developer 自验被拒） | 角色负例的组合枚举 |
| AC-021 | G7（真 kill 活 Runner 后取消） | `cancelling`/`recovery`/`cancelled` 状态矩阵 |
| AC-026 | G2（真扫描 + 来源/未知 + 代码不移动） | 扫描预算的边界值（39/40/41 文件、511/512/513 KiB） |
| AC-027 | G1（Git 初始化授权请求） | 授权后的完整写入序列 |
| AC-031 | G9（`MISSING_CONTEXT`） | 缺口的字段级组合 |
| AC-033 | G9（ACL 拒绝轨迹） | 每种角色 × 每种 kind 的 ACL 矩阵 |
| AC-036 | G9（预算越界报告） | 4096/2000000 的边界值与 estimator 矩阵 |
| AC-043 | G9/G10 + `pnpm test:live`（真 Review 模型） | 配置继承顺序（run→project→global role→global default） |
| AC-049 | G7/G8（once 绑定与越权拒绝） | 过期时限边界（同 AC-049 整条排除行） |

**复算**：66（待提升）= 20（整条排除）+ 10（子句级排除，其余子句已在第 2 节走产品路径）+ 36（第 2 节把证据层提升到产品路径的 AC）。逐条校验：第 2 节 14 组的唯一 AC 并集 = 71，其中 35 条**本来就有**应用层证据（复验加固），36 条是**待提升**的新增产品路径证据；71 − 35 = 36。✔

**报告纪律**：这 30 条**不得**登记为 `recorded-gap`（那会让 `conditionHolds` 恒真、把「做不到」伪装成「已接受豁免」）；必须在验收报告的「测试层」章节逐条写出「为什么库级就是正确层级」，而不是写「未验证」。

---

## 4. 顺序与文件（每步独立 Review、落在当前代码）

顺序原则：先做**不依赖在制切片**的组（可在当前工作树立刻落地并首跑），再做依赖 T5/T3/T4b 的组。

| 步 | 组 | 新增/修改文件 | 为什么这个顺序 | 首跑命令 |
|---|---|---|---|---|
| S1 | G14 | `scripts/e2e.mjs`（`config.frozen-snapshot`） | 最小、无依赖，先验证「新增检查」这套写法能跑通并写入逐 AC 行 | `node scripts/e2e.mjs --no-write` |
| S2 | G4 | `scripts/e2e.mjs`（扩 `chief.message-to-stage`、`chief.mixed-intent`、`runner.read-ledger-seal`）+ `scripts/lib/e2e-stack.mjs`（回环桩加混合意图/追加读取 prompt 分支） | 复用 S1 的写法；G4 的真 Runner 装配是 G6/G7/G10 的地基 | `node scripts/e2e.mjs --no-write` |
| S3 | G13 | `scripts/e2e.mjs`（扩 `events.watermark-reconnect` 的 AC 列表到 AC-059/AC-060、新增 `events.slow-connection-backpressure`、`write.idempotency-replay`） | 与 S2 共享 WS 装配，改动小；`project.created`（AC-025）待 T5.2 | `node scripts/e2e.mjs --no-write` |
| S4 | G9 | `scripts/e2e.mjs`（`context.snapshot-fidelity`、`context.acl-and-budget`、`context.cold-start-determinism`、`knowledge.invalid-projection`） | 依赖 S2 的真实 Run，才能拿到真实 Snapshot | `node scripts/e2e.mjs --no-write` |
| S5 | G6 | `scripts/e2e.mjs`（`delivery.level-escalation`、`decision.branches`、`test.coverage-gate`）+ `scripts/lib/e2e-stack.mjs`（桩加 `not_covered` 分支） | 依赖 S2/S4 的装配与上下文 | `node scripts/e2e.mjs --no-write` |
| S6 | G7 | `scripts/e2e.mjs`（`findings.auto-rework`、`recovery.restart-epoch`、`settlement.crash-after-ref`；扩 `runtime.executes-attempt` 的 AC 列表） | 需要 S5 的 Finding 路径与真实 Runner | `node scripts/e2e.mjs --no-write` |
| S7 | G12 | `tests/browser/ac-054-056-connection.spec.mjs`（新）+ `scripts/e2e.mjs`（`mailbox.nonblocking`） | 浏览器 spec 与 e2e 检查可并行；此项独立 | `pnpm test:browser`、`node scripts/e2e.mjs --no-write` |
| S8 | G10 | `scripts/e2e.mjs`（`task.dependency-dag`）+ `apps/daemon/test/retry-recovery-tasks.integration.test.ts`（扩依赖失效） | **阻塞于 T4b 的 `task.list/task.get`**；若 T4b 未落地，先只写 e2e 的 `task` 行直读断言并在证据里标明「读路径待 T4b」 | `node scripts/e2e.mjs --no-write` |
| S9 | G11 | `scripts/e2e.mjs`（`ops.backup-restore`、`requirement-save.cas-race`） | 复用既有 CLI 演练；需先解决 T6 的两个残留（§2 G11 注释） | `node scripts/e2e.mjs --no-write` |
| S10 | G8 | `scripts/e2e.mjs`（`tool.broker-admission`、`dispatch.no-grandchild`、`join.sibling-failure`、`stage.contract-violation`） | **阻塞于 T3 工具桥收口**（`tool-bridge.integration.test.ts` 需先 `pnpm build`） | `pnpm build && node scripts/e2e.mjs --no-write` |
| S11 | G1 | `scripts/e2e.mjs`（`project.multi-root-identity`、`project.cross-read-isolation`）+ `scripts/lib/e2e-stack.mjs`（第二项目栈） | **阻塞于 T5.1**；栈改动会与 S2 的桩改动争用同一文件，故排在后面 | `node scripts/e2e.mjs --no-write` |
| S12 | G2 | `scripts/e2e.mjs`（`project.initialize-phases`）+ `apps/daemon/test/project-initialization.integration.test.ts`（新） | **阻塞于 T5.3**；T5-plan §9 已把 `protocol.ts` 的 hunk 与 T3 约定落地窗口 | `node scripts/e2e.mjs --no-write` |
| S13 | G3 | `scripts/e2e.mjs`（`requirement.pool-import-second-home`）+ `apps/daemon/test/requirement-import.integration.test.ts`（新） | **阻塞于 T5.4**；必须晚于 G1 的第二 home 夹具 | `node scripts/e2e.mjs --no-write` |
| S14 | G5 | `tests/browser/ac-projects-switch.spec.mjs`（新）+ `tests/browser/stack-runtime.mjs`（两项目夹具） | **阻塞于 T5.5**；浏览器夹具与 S11 的栈扩展需同一个人一次改完 | `pnpm test:browser` |
| S15 | 全部 | `scripts/lib/drill-acs.mjs`、`scripts/lib/acceptance-registry.mjs`、`scripts/lib/acceptance-evidence.mjs`、`scripts/acceptance.mjs`、`docs/delivery/acceptance.md`（仅在需要登记残余时） | 注册表改动必须在**所有**新检查稳定之后一次做完，否则逐次重标会产生互相矛盾的中间态 | 见第 6 节 |

### 4.1 与在制切片的依赖（硬阻塞，不得并行）

| 阻塞项 | 影响的组 | 现状证据 |
|---|---|---|
| **T5 多项目**（`project-directory.ts`、`initialize-driver.ts`、`requirement-import.ts`、单入口 BFF） | G1、G2、G3、G5 | `apps/daemon/src/project-directory.ts` 不存在；`project.create/clone/trust/close/initialize` 整仓 0 命中（`api-gap-audit-2.md:47-51`） |
| **Task/integration 链**（T4b `task.list/task.get`；`runIntegration` 每 Task revision 生产无来源） | G10 | `api-gap-audit-2.md:55`；`.agentdev/work/WP-12/T4b-implementation.md` 自述「独立 Review/Test/Settlement 未执行」 |
| **T3 工具桥**（Broker 端点、Grant 铸造、bash/环境操作许可链） | G8 | `.agentdev/work/WP-12/T3-implementation.md:371-372`：bash/环境操作许可链产品不可达，批准后仍铸不出 Grant |
| **T9 临时流裁决**（`token.delta`/`log.delta`/`heartbeat`） | G13 | `api-gap-audit-2.md:124-132`：三个临时流 0 命中 |
| **T8a spawn 窗口**（spawn 窗口崩溃仍 withheld、resume 早于 ready） | G7 的「重启」子句 | `.agentdev/work/WP-12/T8a-implementation.md:230-239` |
| **`tests/browser/**` 未被跟踪** | G5、G12 及全部浏览器证据 | 本次实跑 `git ls-files tests/browser` = 0 |

### 4.2 文件争用

| 文件 | 争用者 | 处置 |
|---|---|---|
| `scripts/lib/e2e-stack.mjs` | S2（回环桩）／S11（第二项目栈）／S12（初始化夹具）／S14（浏览器两项目夹具） | **串行同一个写者**，或把「第二项目栈」抽成独立模块 `scripts/lib/e2e-multi-project.mjs` 让 S11/S14 只读 `bootStack` |
| `scripts/e2e.mjs` | S1–S13 全部 | 每个 S 只改自己的 `await checks.check(...)` 块与 imports；检查名一经确定不得改名 |
| `apps/daemon/src/protocol.ts` | T5.2/T5.3/T5.4 与 T3 | 按 T5-plan §9：新模块先行，`protocol.ts` 的 hunk 合并成一次 patch |
| `tests/browser/stack-runtime.mjs` | S14 唯一 | 独占，无并发 |

---

## 5. 成本 / 限制（每组运行时 + 是否需要真 Provider）

### 5.1 实测基线（本次读到的落盘数据）

| 载体 | 实测 | 证据 |
|---|---|---|
| `node scripts/e2e.mjs`（离屏检查合计） | 现 18 检查合计 **26.3 s**（最长 `runtime.executes-attempt` 9.7 s、`chief.message-to-stage` 6.1 s、`requirement.save-git` 3.6 s） | `.agentdev/work/WP-12/e2e-results.json` 的 `checks[].durationMs` |
| 浏览器套件（内嵌于 `test:e2e`） | 本次落盘报告把 5 条浏览器 AC 记为 0 ms（`checks.record` 不计量）；实际 Playwright 段由 `browser-suite.mjs` 的 `durationMs` 提供，当前报告未落盘该字段（见 §6.4 待补） | `.agentdev/work/WP-12/e2e-results.json` 的 browser 检查 `durationMs:0`；`scripts/lib/browser-suite.mjs` 有 `suite.durationMs` |
| `node scripts/live.mjs`（真 Provider 已配置） | 合计 **102.7 s**：`drill.message-to-stage` 39.8 s、`drill.html-explanation` 21.7 s、`drill.l2-delivery` 15.7 s、`drill.runtime-attempt` 13.7 s、`drill.session-streaming` 5.9 s、`drill.l1-typo` 4.8 s、`provider.connectivity` 1.1 s | `.agentdev/work/WP-12/live-results.json` 的 `checks[].durationMs` |

### 5.2 每组预期增量

| 组 | 预期增量 | 真 Provider？ | 说明 |
|---|---|---|---|
| G1 | +10～25 s（第二个 store + daemon + BFF；两次 `git init`） | 否 | 纯 CLI/HTTP/Git，无模型 |
| G2 | +8～20 s（扫描 40 文件/512 KiB 预算 + 多次 `initialize` 相位） | 否 | 真 FS 写入 + Git commit |
| G3 | +5～15 s（真 `git clone` + 五条记录解析导入） | 否 | 第二 home 的 SQLite 冷启动 |
| G4 | +8～20 s（第三条真 Runner 子进程） | 否（回环桩） | 现有同类检查 6.1 s，扩到 3 条消息 |
| G5 | +15～40 s（Playwright 冷启动 + 1 spec） | 否 | Chromium 启动占大头 |
| G6 | +5～15 s | 否（回环桩） | 3 条分支共享一次 execution |
| G7 | +20～50 s | 否 | 含真实 kill 与重启；现有 `runtime.executes-attempt` 9.7 s 会变长 |
| G8 | +60～180 s | 否 | 每用例一个真 Runner 子进程；若含容器测试则更慢（`tool-http.integration.test.ts` 已用真 Docker） |
| G9 | +10～25 s | 否 | 读真实持久化行，不额外起进程 |
| G10 | +30～90 s（两个 Task 的真实 DAG） | 否 | 至少两次完整 Runner 执行 |
| G11 | +30～90 s（backup/restore/relocate + 竞争注入） | 否 | 真 CLI 子进程 + 真文件复制 |
| G12 | +10～30 s | 否 | 浏览器断连 + 1 s 计时 |
| G13 | +8～20 s（含一次同键重发的断线重连） | 否 | 复用现有 WS 装配 + `idempotencyKey` |
| G14 | +3～10 s | 否 | 复用现有 Runner |
| **全部新增** | **约 +4～10 分钟**（视 G8/G10/G11 是否含容器与多次 Runner） | 否 | |
| **扩展后的 `pnpm test:e2e`** | 现 ~1 分钟（含浏览器）→ **约 5～11 分钟** | 否 | 仍离线、零 Provider 调用 |
| **`pnpm test:integration`** | 现约 2～4 分钟（44 文件/468 例，T4b 自述）→ **+2～5 分钟** | 否 | 新增 G2/G3/G10 的集成文件 |
| **`pnpm test:live`** | **102.7 s**（已配置）／未配置时立即写 `UNVERIFIED` 并 exit 3 | **是** | G9/G10 的 AC-066 真会话需要 Provider |
| **全量 `pnpm test:acceptance`** | 单元+集成+drills+live ≈ **12～25 分钟** | **是**（若要关闭 `provider-absent` 与 `review-model-absent`） | `acceptance-drills.mjs` 给每 drill 1800 s 超时，足够 |

### 5.3 最终验收前置条件（缺一即证据被拒）

1. **提交干净树**：147 条 `git status --porcelain` 必须清零，**且 `tests/browser/**` 必须 `git add`**（当前 `git ls-files tests/browser` = 0）。`computeBinding` 的 `codeDigest` 取工作树字节（`acceptance-binding.mjs:78-87`），因此**未提交 ≠ 失败**，但「评测者无法从提交复现」是发布阻断项。
2. **无并发写者**：从 `computeBinding` 到两个 drill 结束（`acceptance-drills.mjs:93` 算 binding、`:98-108` 起 drill）**任何**对 `packages/**`、`apps/**`、`scripts/**`、`package.json`、`pnpm-lock.yaml`、`tsconfig*`、`vitest.config.ts`、`eslint.config.js` 的写入都会让 `codeDigest` 失配 → `verifyBinding` 拒绝**整个**报告（`acceptance-binding.mjs:121-135`）。`.agentdev/work/WP-12/T2-implementation.md:647` 已经记录过一次「live 报告被 binding 整体拒收 → 7 条 AC 失去 live 证据」的事故，必须在流程上禁止（`AGENTDEV_REPORT_DIR` 指向仓库外可降低风险，但**不改变** digest 判定）。
3. **`gitHead`/`gitTree` 在一次验收内不变**：drill 期间**不得** `git commit`（`acceptance-binding.mjs:126-135` 同时比对 head 与 tree）。因此「先跑验收再提交」也不行：提交会改 `gitHead`，使同一次运行的前后两个 drill 互相失配。正确顺序是**先提交 → 再跑一次验收 → 报告绑定该提交**。
4. **Provider 环境**：`AGENTDEV_PROVIDER_BASE_URL`/`MODEL`/`SECRET` 三者齐备（`drill-acs.mjs:179-185`）才能关闭 AC-001/007/010/037/041/066 的 `provider-absent`；`AGENTDEV_PROVIDER_REVIEW_MODEL` 齐备（`:188-193`）才能关闭 AC-043 的 `review-model-absent`。已配置却未跑通时，`conditionHolds` 明确返回「不再是有效理由」并把 AC 降为 FAIL（`:221-237`），因此**不能靠留空变量来保 PASS**。
5. **本机浏览器**：`browserAvailability()` 必须为真（`browser-suite.mjs:81-118` 检查包 + Chromium 二进制）。浏览器不可用时 5 条浏览器 AC 变 `UNVERIFIED`，且 `conditionHolds('browser-absent')` 只在**真的没有**浏览器时为真（`drill-acs.mjs:209-219`）。
6. **Docker**：G8 的容器分支需要 `docker info` 成功（`scripts/acceptance.mjs:205-208` 已在记录 `dockerAvailable`）。
7. **AC-090 的过期登记必须先删**：见 §6.1。
8. **清理旧证据**：`.agentdev/work/WP-12/{e2e,live}-results.json` 与 `acceptance-results.json` 是**历史运行记录**，验收时**不作为**证据被读取（`acceptance-drills.mjs:14-17` 明确拒绝读仓库文件）；但报告里引用它们时必须写清它们是哪一次、哪个 digest，避免与最终运行混淆。

---

## 6. 注册表与聚合改动

### 6.1 `scripts/lib/drill-acs.mjs`（逐 AC 映射、`closedBy`、过期条目）

| 改动 | 位置 | 内容 |
|---|---|---|
| **删除 AC-090 的 `recorded-gap`** | `scripts/lib/drill-acs.mjs:163-169` | 整条删除。理由链：`board` 卡片已带 `git`（`apps/daemon/src/protocol.ts:2064/2158`）、`requirement.get` 带 `contentMarkdown`（`:2178`）与 `git`（`:2180`）、`gitFactsOf` 真实比较 upstream；Web 侧渲染在 `apps/web/src/pages.ts:306/567`、`views.ts:151-153/212`，并有 `apps/web/test/pages.test.ts`、`views.test.ts`、`pnpm test:e2e` 的 `requirement.save-git`（`scripts/e2e.mjs:345`，AC 列表含 AC-090）作为产品路径证据。`conditionHolds('recorded-gap')` **恒为真**（`:203-208`），所以这条过期登记不会被任何条件自动销项——**必须人工删**。 |
| **AC-002/052/071/073/076 的 `browser-absent`** | `:127-151`、`:170-175` | 保留条件与 `closedBy: 'pnpm test:e2e'`，但把 `decision` 文案里的「已被 WP-12 T7a 撤销」保留（当前正确）。**新增**：为 G5/G12 的浏览器 AC（AC-023/024/034/054/056）**不**登记 `browser-absent`（它们是**补充**产品路径证据，并非「只能靠浏览器」的 AC），只把新 spec 的 `closedBy` 归到 `pnpm test:e2e` 的逐 AC 行即可。 |
| **AC-001/007/010/037/041/043/066** | `:91-126`、`:152-161` | 条件与 `closedBy: 'pnpm test:live'` **保持不变**（它们现在是正确形状：Provider 未配置才是有效豁免）。**新增**：在 `gap` 文案里补一句「本 AC 现在另有提交套件内的应用层用例（G4/G9/G10 的 `apps/daemon/test/**`），`pnpm test:live` 只补真实模型那一半」——这不是豁免，是口径澄清。 |
| **新增 `closedBy` 的候选** | 结构 | 若某组的新检查成为某 AC 的**唯一**产品路径证据，用 `checks.check` 的 AC 列表即可自动进入 `e2e-results.json` 的逐 AC 行（`e2e-checks.mjs:181-202` 的 `aggregate()`），**不需要**新增 `RESIDUAL_GAPS` 条目。只有「本环境永远做不到」的 AC 才登记 gap。 |
| **不要新增的条目** | — | 第 3 节的 30 条诚实排除**全部不登记** `recorded-gap`（那会让 `conditionHolds` 恒真并把它伪装成「已接受豁免」）。它们留在库级证据层，由 `docs/delivery/acceptance.md` §3 与验收报告的「测试层」章节显式说明；其中 10 条是子句级排除，其余子句已在第 2 节走产品路径，报告不得把它们写成整条未验证。 |

### 6.2 `scripts/lib/acceptance-registry.mjs`（`CURATED_EVIDENCE`）

| 改动 | 位置 | 内容 |
|---|---|---|
| **不新增库级条目来替代产品路径** | — | 新组一律用 `checks.check(name, [...acs], …)` 让 AC 出现在**演练**层，`test-name`/`curated` 只管提交套件。 |
| **新增 curated 条目（仅限第 3 节 A 类）** | `CURATED_EVIDENCE` `:173-534` | A 类的 4 条（AC-040/042/086）已有有效 curated；AC-092 已有 7 条。**不要**为它们新增条目。 |
| **新增 curated 条目（可选，用于 T5/T3/T4b 新增的集成文件）** | 同上 | 若 T5/T3 的新测试**不带 AC 名**（例如 `apps/daemon/test/project-isolation.integration.test.ts` 的用例名不含 `AC-034`），必须在这里逐条登记 `{file, title, rationale, wpRecord}`；`resolveCurated` 在标题缺失时判 `FAIL`（`acceptance-evidence.mjs:154-166/195`）。**这是 T5/T3 落地后最容易漏的一步。** |

### 6.3 `scripts/lib/acceptance-evidence.mjs` + `scripts/acceptance.mjs`（聚合采纳）

| 改动 | 位置 | 内容 |
|---|---|---|
| **产品路径证据的优先表达** | `acceptance-evidence.mjs:237-256` | 现状：`status` 先取 suite 再被 drill 的 weakest-link 覆盖；`gapClosed` 只认 `registration.closedBy === drill.tool && drill.status === 'PASS'`。新组用 `checks.check` 写入逐 AC 行后**无需**改这里——它们天然进入 `drills` 并参与 weakest-link。**不要**为「有产品路径证据」新增一套优先规则（会削弱 `UNVERIFIED` 的拦截力）。 |
| **新增诊断：注册表过期的 `closedBy`** | `acceptance.mjs:290-318` 附近 | 建议新增一条 infra problem：某个 `RESIDUAL_GAPS` 条目的 `closedBy` 在本次运行中**没有**任何 drill 行（说明该 drill 被改名/删除），按 exit 2 关闭。现状只检查「条件是否成立」，不检查 `closedBy` 是否还存在——AC-090 就是这么漏过一个发布周期的。**这是纯加固，不削弱任何断言。** |
| **新增诊断：`recorded-gap` 的复审标记** | `acceptance.mjs:305-317` | 建议在 `conditionHolds('recorded-gap')` 恒真的前提下，把每条 `recorded-gap` 的 `residual` 打进报告显著位置，并要求报告里出现对应用户决定；没有决定记录的 `recorded-gap` 按 `unaccepted` 处理。**这属于流程加固，需用户同意**（见 §7-Q4）。 |
| **浏览器套件耗时落盘** | `scripts/lib/browser-suite.mjs` 的 `suite.durationMs` → `scripts/e2e.mjs:2255-2285` | 当前浏览器检查用 `checks.record(..., durationMs:0)`（`e2e-checks.mjs:164`），导致 §5.1 无法从报告读出浏览器段耗时。建议 `record` 增加可选 `durationMs` 并传入 `suite.durationMs`。**不改变任何状态判定。** |
| **`CODE_PATHS` 是否纳入 `tests/**`** | `acceptance-binding.mjs:30-40` | **开放问题**（§7-Q5）：`tests/browser/**` 与 `tests/**` 不在 digest 覆盖内，所以「改浏览器 spec 不改 digest」——理论上存在「spec 被换掉但证据仍绑定旧 digest」的缝隙。是否纳入需用户决定（纳入会让每次 spec 改动都要求重跑，成本上升）。 |

### 6.4 必须删除的过期条目（清单）

1. `scripts/lib/drill-acs.mjs:163-169` — **AC-090 的整条 `recorded-gap`**（审计 §5-D 已判过期，代码侧闭环，`conditionHolds` 恒真故不会自动销项）。
2. `scripts/lib/drill-acs.mjs:121-126` — AC-043 的 `review-model-absent`：**不删**。本次 `reviewModelConfigured:true`，`conditionHolds` 会返回「不再是有效理由」（`:230-237`），聚合器已正确按 FAIL 处置；若提供方不支持第二模型，保留豁免并写明原因（审计 §6-8）。删掉反而失去「条件失效即 FAIL」的保护。
3. `scripts/lib/drill-acs.mjs:91-120` — AC-001/007/010/037/041 的 `provider-absent`：**同上，不删**。
4. `scripts/lib/drill-acs.mjs:152-161` — AC-066 的 `provider-absent`：**不删**（WP-12 R3-3 已把 `recorded-gap` 改成 `provider-absent`，形状正确）。
5. **新增必删项**：无。除 AC-090 外，其余登记项在当前条件下形状正确。

---

## 7. 待决问题（文档/代码冲突，本计划不代决）

| # | 冲突 | 选项 |
|---|---|---|
| Q1 | **AC-057/AC-061/AC-082 的口径**：`runner.ready/heartbeat/stopped` 是补 attempt-capability 协议面，还是把 Runner IPC 写进 `protocol.md` §6？（`api-gap-audit-2.md:66/288`） | A：补协议面（改动大、影响 3 条 AC 的证据形状）；B：把 IPC 写进文档（AC 证据仍走 `attempt.*`/`recovery.*` 的真实路径，G7 按现状落地）。**倾向 B**，因为 G7 已经用真实 Runner 子进程 + 真 kill 覆盖了行为。 |
| Q2 | **AC-090 的「界面展示未推送状态」**：当前 `data-git-unpushed="unreported"`（`apps/web/src/pages.ts:306/567`），因为读面不提供 `git.unpushed`（`views.ts:146-153` 注释明确「不发明」）。原 `recorded-gap` 说「界面未渲染」，但界面**已渲染字段**只是值为 `unreported`。 | A：按现状关闭 AC-090（字段已渲染 + `requirement.save-git` 的 `git.unpushed=true` 已有 e2e 证据）；B：让读面补齐 `unpushed` 再关闭。**倾向 A**，但这是产品口径，需用户确认。 |
| Q3 | **临时流** `token.delta`/`log.delta`/`heartbeat`：实现，还是在 `protocol.md` §7 标注为内部 IPC 通道并移出？（`api-gap-audit-2.md:289`） | A：实现（G13 需扩到临时流）；B：文档降级（G13 只断言持久通道）。**本轮倾向 B**，风险小、可逆。 |
| Q4 | **`recorded-gap` 是否改为「必须附用户决定 + 复审期」**：`conditionHolds('recorded-gap')` 恒真（`drill-acs.mjs:203-208`）是 AC-090 漏过发布周期的根因。 | A：保持（信任人工）；B：要求 `RESIDUAL_GAPS` 里 `recorded-gap` 必须带决定记录，否则按未接受 FAIL（§6.3）。**倾向 B**，但会改变流程门禁，需用户同意。 |
| Q5 | **`CODE_PATHS` 是否纳入 `tests/**`**：纳入后「改浏览器 spec」会让旧 digest 失效（更严，成本更高）；不纳入则 spec 与证据之间无内容绑定（更松）。 | A：不纳入（现状）；B：纳入 `tests`（更严）。**倾向 B**，因为 G5/G12 的证据全靠这些 spec。 |
| Q6 | **`acceptance.md` §3 是否要写明「库级即正确层级」**：第 3 节 30 条排除必须能被验收报告显式声明。 | A：只在验收报告写；B：同时补进 `docs/delivery/acceptance.md` §3 的「测试层和退出」段（该文件已在被本切片之外的车道编辑，`git diff` 只有 2 行）。**倾向 B**，但改 `docs/**` 需产品口径确认。 |
| Q7 | **AC-048 的 Docker 缺失分支**：本机无法提供「无 Docker」负例。 | A：登记为环境受限（第 3 节 B 类）；B：用 `DOCKER_HOST` 指向不存在端点来模拟。**倾向 A**，B 是伪造环境，判别力可疑。 |
| Q8 | **T6 的两个残留**（带 `secretRef` 的 Provider 下 Chief Run 不入队；backup/restore 演练证据 0/0） | 它们是 G11 的前置：B 会让 G11 的恢复演练看起来是绿的而实际跳过了一半。A：先修 T6 残留再开 G11；B：G11 只断言当前真正执行到的部分并在证据里显式说明缺口。**倾向 A**，但会让 G11 排到 T6 收口之后。 |
| Q9 | **`project.created` / `operation.failed` / `initialization.*` 的归属流**：`EventHub` 是**每项目一个**（`apps/daemon/src/bootstrap.ts`），项目尚不存在时这些事件没有归属流。T5-plan §15 Q9 已裁：`project.created` 发到**新项目自己的流**，create/clone 失败的 `operation.failed` 走 admin 响应/CLI 错误、**不落任何项目流**。 | A：按 T5-plan §15 Q9 执行（G13 只在成功创建后断言新流的 `project.created`，不要求失败路径有持久事件）；B：新增安装级事件流（改 `data.md`/`EventHub` 模型，超出本计划）。**倾向 A**，但确认后 G13 的断言范围才算封闭。 |
| Q10 | **AC-004 的「未授权不启动交付」判据**：T2 自述 Q1=B 派生授权缺少「用户确实下了执行指令」的判据（`.agentdev/work/WP-12/T2-implementation.md:327/431`）。AC-004 当前靠 `CURATED_EVIDENCE`（`apps/daemon/test/server.test.ts` 的只读端到端）通过。 | A：接受库级/应用层现状（AC-004 已有应用层证据，不在本计划 66 条内）；B：补一条真实链上的「只询问 → 不派生授权、不建 Requirement」检查（可并入 G4）。**倾向 B**，因为它是 G4 的自然副产物，成本极低。 |

---

## 附录 A — 复跑与核对命令（只读）

```bash
export PATH="$HOME/.local/bin:$PATH"
# 工作树与浏览器 spec 的跟踪状态（最终验收前必须全绿）
git status --porcelain | wc -l
git ls-files tests/browser | wc -l
# 现有 e2e 检查名与逐 AC 行
node scripts/e2e.mjs --no-write | grep -E '^(PASS|FAIL|UNVERIFIED)'
# 现有 live 逐 AC
node scripts/live.mjs --no-write
# 过期登记
sed -n '160,176p' scripts/lib/drill-acs.mjs
# 绑定口径
sed -n '30,40p;74,97p;107,136p' scripts/lib/acceptance-binding.mjs
# 聚合口径
sed -n '237,282p' scripts/lib/acceptance-evidence.mjs
sed -n '290,327p' scripts/acceptance.mjs
```

---

## 主管裁决（对 §待决 Q1–Q8）

- **Q1 `runner.*` 协议面**：**写文档**。实现里 Runner↔Core 是 IPC 通道（`attempt.ready/heartbeat/result/error`），`protocol.md` §6 的 `runner.ready/heartbeat/stopped` 是历史命名。按实现更新 §6 并明确该通道不是客户端命令面；不新增协议命令。
- **Q2 AC-090**：**按现状关闭**，但必须在干净树上重跑 `pnpm test:e2e`（含浏览器）与 `pnpm test:acceptance` 证明 `data-git-unpushed` 由真实 `git.unpushed` 驱动，**同时删除 `drill-acs.mjs:163-169` 的过期的 `recorded-gap` 登记**（该条件恒真、不会自动销项）。
- **Q3（隐含）主链已由 `chief.message-to-stage` 覆盖**：L1/L2 的真实 Provider 证据归 `test:live`，不再另建桩演练重复覆盖。
- **Q4 `recorded-gap`**：保留机制，但每条必须带 `decision` 引用（现状已有）；**若无任何条目，就删掉全部 `recorded-gap` 使用**，不允许留「永不失效」的豁免。
- **Q5 `CODE_PATHS` 纳入 `tests/**`**：**是**。浏览器/演练 spec 也是证据的一部分，必须进 `codeDigest`，否则改 spec 就能伪造证据。
- **Q6 `acceptance.md` §3**：**是**，必须逐条写明证据层级（产品路径 / 库级即正确层级 / 环境受限），30 条诚实排除按计划逐条给出理由，禁止把库级证据说成产品路径验证。
- **Q7 最终验收前置**：**先提交、再在干净树上跑**；同一批次内不得有并发写入者、不得中途 commit；`pnpm test:live` 由我（持钥者）在稳定树上执行。
- **Q8 T6 残留**：两条都**先验证再开 G11**——(a)「带 `secretRef` 时 Chief Run 不入队」应由 T2 的 G1 修复覆盖，需真实复验；(b) restore 演练必须重跑拿到非 0/0 的证据并归档。
- **附加硬要求**：`tests/browser/**` 目前**未被 Git 跟踪**（`git ls-files` = 0）而 5 条浏览器 AC 依赖它——结算时必须纳入版本控制，否则证据不可复现。
- **顺序**：T4b 的 Task/集成链 → T3 drill 收口 → T5（多项目/初始化，解锁 G1/G2/G3/G5）→ 硬化 G1–G14（建议按 G8/G10/G11 与其余拆成两批并行，避免单代理过长）→ 独立 Test + Settlement + 干净树最终验收。
