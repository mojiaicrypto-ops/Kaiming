# WP-10 独立 Test 报告（发布整体验收）

- 测试对象：WP-10「发布整体验收」，冻结提交 `9f154c3cc83e3f78bb5bb4c72bbecbad3343ed47`，tree `ed48e2d61ad577cc405fe71308b81013c59fbf02`。
- 证据绑定（我独立重算，干净树）：`sha256:8ca1e58c0ceb7aef70644dcdcc65b13bab456311471ba100c87ff456517ca4e6`（252 个代码文件）。
- 环境：macOS；`node v24.8.0`；`pnpm 12.3.4`；Docker 可用；仓库根 `/Users/huyaohua/huyh/work/aigrouptool`。
- 权威依据：`docs/delivery/acceptance.md`（AC-001…AC-094）、`docs/delivery/implementation.md`（§WP-10、§3 十条命令）、`docs/rules/{workflow,agents}.md`、`AGENTS.md`、`.agentdev/work/WP-10/{plan,implementation,acceptance,e2e,live,release}` 与 `review*.md`、`scripts/lib/*`。
- 独立上下文：未读取任何开发/Test 聊天、transcript 或 session log；只读仓库文件、git 对象、报告，以及**我自己运行**的命令与实验。
- 唯一写入：`.agentdev/work/WP-10/test.md`（本文件）。临时文件全部在 `/tmp/wp10t/`；我的运行重写过的 7 个 WP-10 记录文件已用 `git checkout --` 全部还原，最终 `git status --porcelain` 仅剩会话开始前就存在的未跟踪文件 `review-round4.md`。
- 凭证：`AGENTDEV_PROVIDER_*` 仅经进程环境传入，未写入任何文件。全仓库工作树 + 全部运行日志对 `sk-` 形状与精确值检索 **0 命中**（见 §4.4）。

## 0. Review 门禁与测试范围

- `.agentdev/work/WP-10/review-round4.md` 判定 **PASS**：P0 0 / P1 0 / P2 0 / P3 2（W10R4-01 `$TMPDIR` 残留、W10R4-02 L1 记录不含冻结字节哈希）。其冻结声明（`9f154c3` / tree `ed48e2d…` / codeDigest `8ca1e58c…`）与我独立重算**逐位一致**；早期轮次 `review.md`(FAIL)、`review-round2.md`(FAIL)、`review-round3.md`(PASS) 与增量文件 `scripts/lib/live-drills.mjs`(+10/−1)、`live-transport.mjs`(仅注释) 与本轮复核无冲突。
- 会话初始 `git status --porcelain`：仅 `?? .agentdev/work/WP-10/review-round4.md`；`git rev-parse HEAD` / `HEAD^{tree}` 如上。
- 测试方法：先**自己真实执行**全部契约命令、真实 Provider 纵向、发布演练与负例，再对 AC 逐条打开 test body / drill 步骤核对条款。批量 test body 阅读由 3 个独立只读并行核验（同一工作区、同一冻结树、不写任何文件）完成；关键结论（AC-071 缺口文本、AC-013 Broker、AC-026/065/066/090 缺口、AC-007 映射）由我本人复核（见各条 `[自核]`）。
- 不修改任何产品/脚本代码；fail-closed 复现一律通过 `/tmp/wp10t/` 下的进程内探针或 Node ESM loader hook 注入条件，未改动仓库内任何脚本。

## 1. 本轮结论摘要

按工作包/能力面给出的我自己的判定（"结论"列只写正向验证与负向复现都跑过的结果）：

| 范围 | 正向（我执行） | 负向 / 未覆盖 | 结论 |
|---|---|---|---|
| WP-00 工具链/SDK | unit `packages/pi-runtime`、`apps/runner`、Docker 容器只读用例真实执行（integration 26/311）；`pnpm doctor` exit 0 | AC-066「真实模型经 Pi SDK 流式增量 + 会话历史恢复」未执行（D4 `recorded-gap`）；可选内置扩展不存在 | PASS，缺口已登记 |
| WP-01 数据/迁移 | integration `migrations.integration.test.ts` 真实 SQLite（备份/回滚/checksum/newer-build/幂等） | AC-065「不运行 Agent」无启动路径断言（R-04） | PASS，残余 R-04 |
| WP-02 调度/角色 | config/model-gateway/orchestrator 冻结快照与独立 Run；live 中 4 个专业 Run 各自冻结快照 | AC-043 需独立 Review/Test 模型（未提供）；多角色多 Provider 未演练 | PASS，缺口已登记 |
| WP-03 直接协作/产物 | daemon 预览 CSP/sandbox/credentials、一次性下载、上传限制真实 HTTP；live HTML 路径真模型通过 | AC-002/AC-052 浏览器半边（D1）；AC-004 正向建议半边仅 202（R-01）；AC-084 失败重试/系统消息（R-05） | PASS，缺口已登记 |
| WP-04 知识/新老项目 | scan/initialize/feature-format/requirements-pool 全套真实执行 | AC-026「无开发 Requirement」无断言（R-02）；AC-027 curated 第二条与 AC-028 复用（R-03）；AC-087 无真实 clone（R-06） | PASS，残余 R-02/03/06 |
| WP-05 Context/ACL | context-builder/cold-start/acl/ledger 拒绝 transcript 与越权；read ledger 契约由提交用例证明 | AC-001 的「读取记录」子句未由 live 产生（已披露，R-10） | PASS，残余 R-10 |
| WP-06 分级交付 | domain/core 全阶段 Gate、evaluateStageChain、CAS/CompletionManifest；live L1/L2 真模型全链通过 | AC-013「Broker 校验」在 prod src 无调用方（R-08）；AC-037「两次需求修改」前提未演绎（R-07） | PASS，残余 R-07/08 |
| WP-07 权限/Secret | broker/permissions/grants/secrets 正负例（真 Docker、真并发 once、诱饵 Secret 非空断言） | — | PASS |
| WP-08 集成/结算/恢复 | requirement-save、cas、backup/restore、settlement、continue 真实 Git+SQLite；e2e L2 链与结算 CAS | AC-094「归档保持目录/引用」无归档专项用例（R-12） | PASS，残余 R-12 |
| WP-09 Web 工作台 | 20 项 e2e 检查（10 面真实读数、水位重连、上传、看板规则、认证生命周期） | AC-071/AC-073/AC-076 浏览器半边（D1）；AC-090 界面未渲染分支/提交/未推送（D4） | PASS，缺口已登记 |
| WP-10 聚合/门禁/演练 | `test:acceptance` 94/94；`--release` 10/10 命令 → `READY (ACCEPTED RISK 8)`；fail-closed 6 组复现全部非 0 | `$TMPDIR` 脚手架残留（W10R4-01 仍成立）；L1 记录缺冻结字节哈希（W10R4-02 仍成立） | PASS，P3 残余 |

聚合口径（我运行）：`PASS 86 / ACCEPTED 8 / FAIL 0 / MISSING 0`，`94/94` 计账，exit 0。8 条 ACCEPTED = `AC-002, AC-043, AC-052, AC-066, AC-071, AC-073, AC-076, AC-090`（与任务书一致；其中 AC-066/AC-090 带残余编号）。

## 2. 契约命令实际输出

每条命令均为**我本人**在冻结树上执行；原始日志 `/tmp/wp10t/contracts/`、`/tmp/wp10t/provider/`。

| # | 命令 | 退出码 | 计数 | 原始输出尾巴 |
|---|---|---|---|---|
| 1 | `pnpm install --frozen-lockfile` | **0** | 13 workspace | `Lockfile is up to date, resolution step is skipped` / `Done in 64ms using pnpm v12.3.4` |
| 2 | `pnpm typecheck` | **0** | — | `$ tsc -p tsconfig.json --pretty false`（无错误输出） |
| 3 | `pnpm lint` | **0** | — | `Checking formatting...` / `All matched files use Prettier code style!` |
| 4 | `pnpm test:unit` | **0** | **55 files / 1107 tests** | `Test Files  55 passed (55)` / `Tests  1107 passed (1107)` / `Duration 12.45s` |
| 5 | `pnpm test:integration -- --maxWorkers=4` | **0** | **26 files / 311 tests** | `$ vitest run --project integration -- --maxWorkers=4` / `Test Files  26 passed (26)` / `Tests  311 passed (311)` / `Duration 106.38s` |
| 6 | `pnpm test:e2e` | **0** | **20 checks / 23 AC** | `e2e: 20 checks — PASS 16 / FAIL 0 / UNVERIFIED 4` / `e2e: 23 ACs accounted for by the drill; exit 0` |
| 7 | `pnpm test:acceptance`（Provider 已配置，内含 e2e+live） | **0** | **94/94** | `acceptance: 94/94 ACs accounted — PASS 86 / ACCEPTED 8 / FAIL 0 / MISSING 0` / `acceptance: OK — every AC is PASS or a registered, condition-checked accepted gap` |
| 8 | `pnpm test:live`（真实 Provider，跑 2 次） | **0 / 0** | 6 检查（4 PASS / 0 FAIL / 2 UNVERIFIED） | `live: 4 passed / 0 failed / 2 unverified; 11 call(s), HTTP 200×11, 45946ms / 45465ms, 0 failed` |
| 9 | `pnpm docs:check` | **0** | — | `docs:check ok — 15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages` |
| 10 | `pnpm build` | **0** | **12 workspace `build: Done`** | `apps/runner build: Done` …（`grep -c "build: Done"` = 12） |
| 附 | `pnpm doctor` | **0** | — | `All checks passed` |

`--release` 内置复跑（我执行）：10/10 命令 exit 0（install 81ms / typecheck 1414ms / lint 20099ms / unit 12809ms / integration 101212ms / e2e 6626ms / acceptance 161138ms / live 50850ms / docs:check 68ms / build 2024ms）+ doctor 0 → `READY (ACCEPTED RISK 8) — commands 10/10 ok; AC PASS 86 / ACCEPTED 8 / FAIL 0 / MISSING 0`。

> 说明：`test:integration -- --maxWorkers=4` 被 pnpm 原样转发（日志行如上），26 文件 311 用例全过；该计数与记录一致，差异只在耗时（我 106s，记录 117s，属宿主负载差异）。

## 3. AC 抽样与逐条核对

共核对 **33 个 AC**（覆盖 WP-00～WP-09 + WP-10 聚合），含**全部 8 个已登记豁免**、**全部 curated 映射涉及 AC**（`CURATED_EVIDENCE` 共 11 个 AC：AC-004/011/026/027/028/065/066/067/086/092/094；其中 AC-011/AC-094 因同时有 test-name 映射，聚合报告里 `mapping` 记为 `test-name`，故侧车里 `mapping="curated"` 恰为 **9** 个：AC-004/026/027/028/065/066/067/086/092），以及 **live 唯一/主要证据的 AC（AC-001/007/010/037/041）**。

结论记号：**PASS**＝条款由我的运行中已执行且通过的证据直接支持；**PASS(\*)**＝主行为已证，但存在 §7 登记的残余子句；**ACCEPTED**＝已登记豁免（未执行半边 + 有效决定）。

| AC | 工作包 | 已执行证据（我的运行 + test body/drill 步骤） | 我的判定 |
|---|---|---|---|
| AC-001 自由问答 | WP-03/05 | 仅 live：`live-drills.mjs` `runHtmlDrill`（`gitShow` 取真实冻结源码→真实 chief 模型→断言 `intent=assist/level=none`、无 Requirement、引用 `src/orders/cancel.ts`、含 UNKNOWN 标记、交付分支不变、Work completed）。我的 acceptance 侧车 `mapping="none"`，唯一 drills 来源是 `pnpm test:live:PASS`（e2e 行为 UNVERIFIED）。`[自核]` | PASS(\*) R-10：read ledger 子句未产生（live.md §3 已披露） |
| AC-002 HTML 说明 | WP-03 | `apps/daemon/test/server.test.ts` 上传/绑定/预览（CSP `default-src 'none'`、`x-agentdev-preview-credentials=omit`、`set-cookie=null`、无 Requirement）+ 一次性下载 token 复用得 403；我的 e2e `browser.rendering-and-isolation` UNVERIFIED。`[自核 gap]` | ACCEPTED（D1） |
| AC-004 执行授权边界 | WP-03 | curated：`domain.test.ts` assist→level none；`apps/daemon/test/server.test.ts:530` questions/advice/statements 全 202、`works.list()` 每项 `level==='none'`、`authorizations.list()` 长度 0。我的 acceptance `mapping="curated"` PASS | PASS(\*) R-01：正向「可调查并建议」未断言 |
| AC-007 L1 错字 | WP-06 | **非** live-only：`packages/core/test/delivery.integration.test.ts:730`（`(AC-007)`）证明 `classifyChange→L1`、一句话 Plan、无 Requirement 行、写准入、CAS/CompletionManifest；live `drill.l1-typo` 真模型补 Develop/Review/Settlement 链、无 Test 阶段、CAS 移动 ref、Work completed。`[自核]` | PASS |
| AC-010 标准交付 | WP-06/08 | `domain/test/delivery.test.ts` `STAGE_ORDER.code.L2=['Plan','Develop','Review','Test','Settlement']`、缺 Test→`GATE_NOT_READY`；我 e2e `delivery.l2-chain`（真 `StageGate.submit`×5 + `evaluateStageChain`）与 `delivery.settlement`（真 manifest 冻结 + CAS，ref 移到 candidate）PASS；live L2 真模型链 PASS | PASS |
| AC-011 高风险交付 | WP-06/08 | `delivery.integration.test.ts` L3 Gate：缺 rollback/audit/drill refs→`ok:false`，无明确授权→`NOT_AUTHORIZED`，完整链 `['Plan','Develop','Review','Test','Recovery','Settlement']`；真 SQLite 迁移回滚 + 真 backup/restore 演练。我的 acceptance `mapping=test-name` PASS | PASS |
| AC-013 无效 Plan | WP-06 | `gates.test.ts:272` 前后源码 Hash、`GATE_NOT_READY`；`delivery.integration.test.ts` 旧 Plan→`GATE_NOT_READY`+digest 不变。`[自核]` prod src 中 `requestCodeWrite` 仅定义无调用方 | PASS(\*) R-08：「Broker 校验」半边未执行 |
| AC-026 旧项目初始化 | WP-04 | curated 6 条：`scan.test.ts` 40 文件/512KiB 预算、未知项显式、`updatesDeliveryRef=false`、candidate 文档、不新建文件。我的 acceptance `mapping=curated` PASS。`[自核]` workspace 测试 0 处 requirement | PASS(\*) R-02：「无开发 Requirement」无断言 |
| AC-027 目录项目 | WP-04 | curated 2 条：`initialize.test.ts:539` 无 Git→Blocked+`git-initialization`+`NOT_AUTHORIZED`、授权后建仓；第二条为 dirty-workspace 用例（与 AC-028 同一用例）。`[自核]` | PASS(\*) R-03：curated 映射 Given 不匹配 |
| AC-028 脏工作区 | WP-04 | `initialize.test.ts:488` dirty blocker+`sha256` 报告、只读调查 `wroteFiles=false`、无处置 `VALIDATION_ERROR`、假 committed 仍 blocked 且文件内容保留、patch 后 `deliveryRef=null` | PASS |
| AC-033 独立审核 | WP-05 | `context-builder.test.ts:652` review Run 读 transcript→`CONTEXT_FORBIDDEN` 且不解析；`context-acl.test.ts:258` Review/Test 拒绝全部 message body；`context-ledger.test.ts:240` 前缀内也拒 transcript | PASS |
| AC-037 当前功能 | WP-04/05 | `context-cold-start.test.ts:521/562` 选中 `[CANCEL_ID,PAYMENT_ID]`、行为+约束、排除 20 篇无关文档；`views.test.ts:241`（`(AC-037)`）；e2e `knowledge.patch-cold-start` 与 live L2 冷启动均 PASS | PASS(\*) R-07：「两次修改」前提未演绎 |
| AC-041 知识结算 | WP-08 | `settlement.integration.test.ts:502` `entries`+`invalidationNotes`+relations+冷启动行为/入口/约束；`wp08.integration.test.ts:1446` 真结算+冻结 manifest；我的 e2e/live 均 PASS | PASS |
| AC-043 独立模型 | WP-02 | `config.test.ts:206` 冻结快照；`model-gateway.test.ts:126/237` 冻结 profile 且活动 Run 不换模型；`orchestrator.test.ts:1022` 每 Run 冻结 config；live 4 个专业 Run 不同 config 快照但同一 `deepseek-flash`。`AGENTDEV_PROVIDER_REVIEW_MODEL` 未配置 | ACCEPTED（review-model-absent） |
| AC-048 Workspace 边界 | WP-00/07 | `broker.test.ts` 无 Docker→`PROVIDER_UNAVAILABLE` 不回落宿主、symlink/`..`/绝对路径/私网拒绝、`planContainerRun` 断言 `--read-only`/`cap-drop`/`network none`/`ro`；真 Docker `container.integration.test.ts:110` 只读挂载写失败 + `:rw` 正控制 | PASS |
| AC-051 Secret 隔离 | WP-07 | `secrets.integration.test.ts:254/269/294` 诱饵凭证非空断言、兄弟 Run `NOT_AUTHORIZED`、grant/日志/Artifact/UI 无诱饵；`permissions.integration.test.ts:830` Broker 宿主进程输出 `<absent>`；live harness 真实 Provider secret 经 SecretStore 注入 | PASS |
| AC-052 HTML 安全 | WP-03 | `artifacts.test.ts:507` CSP/sandbox 策略；`server.test.ts:187` 恶意文档同策略服务、`credentials: omit`；浏览器攻击样例未执行 | ACCEPTED（D1） |
| AC-064 备份恢复 | WP-08 | `wp08-failures.test.ts:909` completed+active Work+running Run/lease → backup/restore 后 tree/knowledge 一致、`evidenceVerified=1`、缺 Secret→blocked、run interrupted/attempt lost、撤销 lease；篡改→`STALE_ARTIFACT` | PASS |
| AC-065 Migration | WP-01 | `migrations.integration.test.ts`：迁移前备份、checksum 错误抛 `MIGRATION_CHECKSUM_MISMATCH`、newer-build 拒绝、失败回滚报版本、幂等。`[自核]` 无 runner 启动断言 | PASS(\*) R-04：「不运行 Agent」未证 |
| AC-066 SDK 契约 | WP-00 | curated 7 条：锁定 `0.85.1`，create/subscribe-dispose/abort/compact-empty/事件映射（text/thinking delta、工具边界）/resume 接线逐用例真实执行。`[自核]` 唯一 `.prompt(` 在已 dispose 会话上期望拒绝 → 无真实模型轮次 | ACCEPTED（recorded-gap `WP-10-D4/AC-066`） |
| AC-067 扩展故障 | WP-00 | `extensions.test.ts:46/55/70` 未知 id 拒绝、Critical 阻断、可选仅禁用自身；`apps/runner/test/attempt.integration.test.ts:206/241` Runner 层 Critical 阻断且 `sessionBuilt=false`、未知 id 拒绝 | PASS |
| AC-071 Live 布局 | WP-09 | `pages.test.ts:79/99` 面板三态+restore 在 tab 顺序前；`server.integration.test.ts:714` 跨 7 面共享 mode；`workbench-failures.integration.test.ts:772` 窄屏焦点顺序 + 在途 Run 仍 running。`[自核]` 无宽度属性，宽度由 `data-panel-mode` 经 CSS `--dock` 派生 | ACCEPTED（D1，R-09 措辞） |
| AC-073 语言可访问 | WP-09 | `pages.test.ts:155` 字典双语非空切换；`protocol.integration.test.ts:916` 项目正文 `translatable:false` 原样；`server.integration.test.ts:736` `lang=zh-CN`+`data-i18n-project` | ACCEPTED（D1） |
| AC-076 附件限制 | WP-03/09 | `artifacts.test.ts:158/197` 错误 mime/空/超限/超数量拒绝且无 attachment 行、无事件；`server.test.ts:221` 400 `VALIDATION_ERROR` 无残留；`server.integration.test.ts:337` 服务器拒绝且计数不变 | ACCEPTED（D1） |
| AC-078 认证生命周期 | WP-01/09 | `auth.test.ts:174/191/121/241` 未知/过期 cookie、错误 Origin、限流 `429`、logout 清 session；`server.integration.test.ts:604/689/951` 未认证 401、错误 Origin 403、断连后台 Work 仍 running；client 不重试 `AUTH_EXPIRED` | PASS |
| AC-080 授权精确绑定 | WP-07 | `grants.test.ts:538/609/702/1145/824` once 绑定操作+inputHash、原子消费（真并发第二连接 `workerResult=0`）、重试回放原结果、兄弟 Run `NOT_AUTHORIZED`/`IDEMPOTENCY_CONFLICT` | PASS |
| AC-084 首条消息附件 | WP-03/09 | `artifacts.test.ts:307/128/211` 上传→首条消息原子绑定新 Work、TTL/一次性/过期、重复绑定拒绝；daemon `server.test.ts:119`；e2e 断言 `messageBodies` 非空 + 重复绑定拒绝 | PASS(\*) R-05：失败重试/系统消息未执行 |
| AC-086 功能状态证据 | WP-04 | curated 7 条：`feature-format.test.ts` 完整样例通过；缺 decision ref/evidence/coverage/错误 revision/scope/sources 逐条 `result.ok===false`。`[自核]`（我用 loader 复现 missing-entry→FAIL） | PASS |
| AC-087 需求池随 Git 迁移 | WP-04/09 | `requirements-pool.test.ts:498/250` 稳定 id/goal/幂等、模型客户端 Proxy 一访问即抛（无需模型配置）；daemon `portableRef`+`waitingToContinue`；UI 待继续卡片。`[自核]` | PASS(\*) R-06：无真实 clone、范围/验收保留无断言 |
| AC-089 进行中需求继续 | WP-08/09 | `requirement-continue.test.ts:129/153` 待继续不启动 Run、无授权 `NOT_AUTHORIZED`、继续后新 Work+action 来源授权+未满足 Gate 全 `GATE_NOT_READY`、`runs.count()===0` | PASS |
| AC-090 需求保存时机 | WP-08/09 | `requirement-save.integration.test.ts:425/679/724` 一提交含两文件+README、`unpushed=true`、retry 返回原操作、已提交仅补投影 `reusedCommit=true`；e2e `git.unpushed=true`；`workbench.integration.test.ts:2123` RPC 返回 branch/unpushed 且 UI 显示 `Save state: saved`。`[自核]` `grep unpushed/branch/commit apps/web/src` = 0 | ACCEPTED（recorded-gap `WP-10-D4/AC-090`） |
| AC-092 需求导入冲突与幂等 | WP-01/04 | `requirements-pool.test.ts:498/383/590/660/720/769` 幂等、local vs recordVersion、同版本异内容→逐条冲突且不改写、陈旧投影拒绝、修复后显式重导入解除、批内重复 id 拒绝；`requirements.integration.test.ts:156` `REQUIREMENT_CONFLICT` 事件 | PASS |
| AC-094 需求正文保存与并发 | WP-08 | `requirement-save.integration.test.ts:1041/1549/1939/1984`、`requirement-save.test.ts:105` 组合 `recordHash`、崩溃后只安装一次、陈旧投影冲突、半对文件拒绝；`cas.integration.test.ts` 崩溃复用提交 | PASS(\*) R-12：归档保持目录/引用无专项用例 |
| AC-001/007/010/037/041 的真实模型半边 | WP-10 | `pnpm test:live` 我的 3 次运行（2 次 standalone + 1 次抓包）全部 `drill.html-explanation`/`drill.l1-typo`/`drill.l2-delivery` PASS，HTTP 全 200；聚合中这 5 条由 `closedBy=pnpm test:live` 从 UNVERIFIED 抬为 PASS | PASS |

未能支持为完整 PASS 的子句已逐条登记为 §7 残余 R-01…R-12；它们均不影响该 AC 的已执行行为通过，也不改变聚合计数。

## 4. 真实 Provider 纵向

### 4.1 运行与方差

| 运行 | 退出码 | 观测 |
|---|---|---|
| `pnpm test:live` run1 | 0 | 4 passed / 0 failed / 2 unverified；`11 call(s)`，HTTP 200×11，**45946ms**；`provider.connectivity` PASS，三条 drill 全 PASS |
| `pnpm test:live` run2 | 0 | 同上；**45465ms**；候选/Work/Requirement id 与 hash 不同，结论一致 |
| `NODE_OPTIONS=--require=netprobe.cjs node scripts/live.mjs --drill-out` | 0 | 抓包 11 个 HTTPS 请求体，全部 `model=deepseek-flash`、HTTP 200，**43708ms**；日志无 `unusable` 重试 |
| `pnpm test:acceptance`（内含本次 e2e+live） | 0 | 94/94 |
| `node scripts/live.mjs --release` | 0 | 10/10 → `READY (ACCEPTED RISK 8)` |

**方差**：3 次真实运行的检查矩阵完全一致（4 PASS / 0 FAIL / 2 UNVERIFIED，均 11 次调用、全 200、0 failed），仅耗时（43.7s–45.9s）与随机 id/hash 不同；`validate` 有界重试（同一 Run 最多 3 次）**从未触发**（日志无 `unusable`）。记录中「模型偶尔不可用」的波动在本轮未出现，单日 3 次成功不构成 SLA 证明。

### 4.2 真实栈（来自我运行的 `live.md` 元数据与 drill 证据）

- 真实栈：临时 Git 项目 `/private/var/folders/…/T/agentdev-live-repo-tqcqrD`、真实 SQLite `/private/var/folders/…/T/agentdev-live-state-JnDqcZ/project.sqlite`、真实 Core、真实 `createDaemon`（HTTP+WS）与真实 `createWebApp` BFF（回环端口 0）；装载走 Node 原生类型擦除直接执行 `packages/*/src`。
- L2 链：`L2 chain ["Plan","Develop","Review","Test","Settlement"]`；缺 Test 的链被拒；`Candidate b3030f585b7a codeTree be51529f1c09`；4 个专业 Run 各自独立 config 快照（`3fdb8388/f3db1900/ea0caa01/46c85669`）；`CompletionManifest c28afda729be` 冻结；settlement 把 ref 移到 candidate 且**恰有一次 `settlement.completed` 事件**；Requirement completed；知识提交 `dad97c65171e`；冷启动选中 `["F-0f0f0f0f","F-0a1b2c3d"]` 并给出「未付款订单可取消；已付款订单返回已确认的拒绝结果。」+ code/test 入口。
- L1 链：`L1 chain ["Develop","Review","Settlement"]`、无 Test 阶段、CAS 把 `agentdev/main` 前移、CompletionManifest 冻结、Work completed 且无 Requirement。
- 真实 `StageGate.submit`/`evaluateStageChain`/CAS/settlement：e2e `delivery.l2-chain` 与 `delivery.settlement` 由我运行通过（真 `StageGate.submit`×5、`evaluateStageChain` 校验顺序、真 `settle` 移动 ref）；live 侧同一套真实服务 + 真模型。

### 4.3 L1 Review 确实拿到冻结文件内容（HTTP 层自证）

用 `netprobe.cjs` 包装 `node:https` 抓到 11 个真实请求体（全部 `deepseek-flash`）。L1 Review 的 user prompt 原文（截取）：

```
The frozen candidate bba2a283da59e6622aac89fe888c5fa1a930d90e is a one-line L1 change to src/orders/messages.ts: a misspelled user-visible label is corrected.
Acceptance criterion: the label reads "export const unpaidCancelLabel = 'Unpaid order can be cancelled';" and no longer contains the misspelling, and nothing else changed.
The numstat is:
1	1	src/orders/messages.ts
src/orders/messages.ts as frozen:
```ts
export const unpaidCancelLabel = 'Unpaid order can be cancelled';
```
Judge the frozen content above; reply "passed" when it satisfies the criterion.
```

同时抓到 L2 Review/Test prompt 附带了 `src/orders/cancel.ts` 与 `tests/orders/cancel.test.ts` 的**冻结字节**及「executed probe exit 0」判据；L1 Review 请求 `max_tokens=16000`（与注释修正一致）。

### 4.4 凭证卫生

- 全部运行日志 + 抓包文件 + 工作树对精确 secret 与 `sk-[A-Za-z0-9]{20,}` 形状检索：**0 命中**（`/tmp/wp10t/provider/*` 与仓库工作树各 0）。
- `live.md` 只记录 `Secret 已配置（值不落盘）`；失败信息遮蔽；仓库内无凭证文件。

## 5. 已登记豁免核对（8 条）

| AC | 缺口文本（摘要） | 未执行半边确实缺失？ | 已执行半边确实通过？ | 结论 |
|---|---|---|---|---|
| AC-002 | 真实浏览器隔离预览/脚本隔离未执行；只证 CSP/sandbox/credentials 头、一次性下载、截断 | 是：D1 不引入浏览器，我的 e2e/live 均记 UNVERIFIED | 是：daemon 预览头+一次性下载 403 用例 PASS（我的 e2e/live） | 准确 |
| AC-043 | 需 `AGENTDEV_PROVIDER_REVIEW_MODEL`；未指定时只证专业 Run 独立+各自冻结快照 | 是：我的 env 未设该变量，live 记 UNVERIFIED | 是：live 中 4 Run 独立且快照互异 | 准确 |
| AC-052 | 浏览器攻击样例未执行；只证预览隔离策略与无 cookie | 是 | 是：`artifacts.test.ts:507`、`server.test.ts:187` PASS | 准确 |
| AC-066 | 真实模型流式增量 + 会话历史恢复未执行（`recorded-gap`） | 是：`[自核]` 测试中无真实模型轮次，resume 用例自述只证「接线」 | 是：curated 7 条离线 SDK 契约 PASS | 准确 |
| AC-071 | 真实 viewport/焦点未执行；演练与用例只证面板三态、共享宽度标记、不干扰 Run | 是（像素/焦点） | 三态、跨页共享、顶栏恢复、Run 不受影响均 PASS；但「共享宽度**标记**」措辞不精确（无该属性，共享的是 mode→CSS `--dock`） | 实质准确，R-09 措辞 |
| AC-073 | 真实键盘遍历/ARIA 未执行；只证字典级语言切换与正文不翻译 | 是 | 是 | 准确 |
| AC-076 | 客户端提示需浏览器；服务端拒绝（无残留引用）已执行 | 是（客户端提示） | 是：服务端 400 且 attachment 计数为 0 | 准确 |
| AC-090 | Web 界面未渲染分支/提交/未推送（`recorded-gap`） | 是：`[自核]` `apps/web/src` 对 `unpushed/branch/commit` **0 命中** | 是：真实 Git+SQLite+e2e（`git.unpushed=true`、retry、仅补投影）PASS | 准确 |

8 条豁免的条件在我运行时均成立（`browser-absent` 常真、`review-model-absent` 因未设变量、`recorded-gap` 常真），聚合器逐条复核后计为 ACCEPTED；发布记录 §2 逐条列出缺口与决定并明写「不声称它们已被验证」。

## 6. fail-closed 复现

全部为我在冻结树上的真实运行/对真实导出函数的进程内驱动；未改动仓库文件（fail 注入走 `/tmp/wp10t/loader-hooks.mjs` 的 Node ESM loader）。

| 性质 | 复现方式（命令/输入） | 观测 |
|---|---|---|
| 伪造/顶替的验收 sidecar 被拒 | `readAcceptanceResult()`（真实导出门禁）对 scratch 根：攻击者 nonce / 空 nonce / null nonce / 旧 `generatedAt` / 缺 `generatedAt` / 错 `codeDigest` / 缺 sidecar / 不可解析 | 全部 `available=false` + 具体原因；仅「文件自带 nonce + 时间下界满足 + digest 匹配」为 `available=true`（对照） |
| 本次运行的 `--no-drills` sidecar 被拒 | 真实跑 `AGENTDEV_ACCEPTANCE_NONCE=wp10t-nonce pnpm test:acceptance --no-drills --projects unit,integration`，再对该真实 sidecar 调门禁 | 运行 exit **1**，输出 `--no-drills — release drills were not executed` 与 `NOTE — … this aggregation is a development check, not a release verdict, and the release gate refuses its sidecar`；门禁 `available=false why=来自未执行发布演练的聚合运行（--no-drills）`；攻击者 nonce / 未来 `startedAt` 同样被拒 |
| 未登记的 UNVERIFIED 判 FAIL | loader 移除 `RESIDUAL_GAPS['AC-002']`（drills 开启、无 Provider） | exit **1**，`AC-002 UNVERIFIED — 未登记的 UNVERIFIED：…未验证项必须有已登记的豁免与产品决定`；`PASS 81 / ACCEPTED 12 / FAIL 1` |
| 豁免条件失效判 FAIL | Provider 已配置 + `--no-drills`（真实 runner） | exit **1**，`AC-001/007/010/037/041 UNVERIFIED — 豁免条件不再成立（provider-absent）`，`PASS 81 / ACCEPTED 8 / FAIL 5` |
| 过期 curated 映射判 FAIL | loader 把 AC-086 一条 curated 标题改成不存在 → 真实 runner（两项目） | exit **1**，`AC-086 FAIL mapping=curated`，raw `curated evidence is stale: packages/knowledge/test/feature-format.test.ts :: "…" did not execute`；`FAIL 1` |
| 映射文件零用例判 FAIL | ① loader 使 `feature-format.test.ts` 收集后零用例（curated 型）② loader 使 `model-gateway.test.ts`（文本含 AC id）零用例 | ① exit **1**（curated stale→FAIL）；② exit **2**，`含 AC 证据的测试文件没有执行任何用例：packages/core/test/model-gateway.test.ts（文件消失/未被收集）`，`FAILED (exit 2) — the evidence itself is not trustworthy` |
| 伪造演练报告行被拒/整份外部报告不被信任 | `parseDrillReport()`：无 evidence 文本 / 未登记 id / 未知状态；并核对 `acceptance.mjs` 只 spawn 本次演练（nonce+binding） | 无 evidence 行被忽略、未登记 id 与未知状态记为 problems；`acceptance-drills.mjs` 对 nonce 不符/`binding` 不符的报告直接拒绝采用，仓库内 `*-results.json` 不作为证据 |
| 发布门禁的负例（无 Provider） | `env -u AGENTDEV_PROVIDER_* node scripts/live.mjs --release --no-write` | exit **1**，`NOT READY — commands 9/10 ok`，明确列出「真实 Provider 纵向验证未执行：pnpm test:live exit 3（已登记豁免 AC-001/007/010/037/041）」；`live.md` 三条 drill 记 UNVERIFIED 且 0 次网络调用 |

## 7. 未覆盖 / 未验证 / 残余

**A. 已登记、已接受的未覆盖（产品决定，不计 PASS）**

1. 真实浏览器两半：AC-002、AC-052、AC-071、AC-073、AC-076（D1）。
2. 独立 Review/Test 模型：AC-043（未设 `AGENTDEV_PROVIDER_REVIEW_MODEL`）。
3. 已登记残余：AC-066 真实 Pi SDK 会话语流/历史恢复（`WP-10-D4/AC-066`）、AC-090 Web 界面分支/提交/未推送渲染（`WP-10-D4/AC-090`）（D4）。

**B. 我本轮新登记的子句级残余（P3，均不改变已执行行为通过，也不改变聚合计数）**

- **R-01 AC-004**：正向「Chief 可调查并建议」仅由 HTTP 202 覆盖，未断言建议/调查内容；`domain.test.ts` 用例标题含 "artifact" 但实际只断言 assist。
- **R-02 AC-026**：「初始化无开发 Requirement」在任何已执行用例中都无断言（`packages/workspace` 无 requirement 概念）；「代码不移动」的登记证据只证明"未新建文件 + 不改交付 ref"，未断言既有源文件字节不变。
- **R-03 AC-027**：curated 第二条复用 AC-028 的 dirty-workspace 用例，其 Given 与「无 Git」不一致；「问答可完成」仅由 `investigate().ok` 代理。
- **R-04 AC-065**：「错误停止、不运行 Agent」的启动路径未被演练（测试直接调 `runMigrations`，无 `ProjectStore.open` 启动后无 Runner/session 的断言），仅有源码注释支持。
- **R-05 AC-084**：「失败可重试」未执行（只有成功后的幂等重放，无「强制失败→保持 staged→重试」用例）；「系统消息」未走发送路径。
- **R-06 AC-087**：无真实 `git clone` 演练（只写临时目录后解析）；scope/验收/已确认结论/未决项的「保留」无断言（daemon 投影不落这些字段）；「无需重新初始化」无断言。
- **R-07 AC-037**：「功能经过两次需求修改」前提未演绎（种子功能只改一次）。
- **R-08 AC-013**：条款写「Broker 校验」，但生产 `src` 中 `requestCodeWrite` 无调用方，测试直接调用 Gate；Broker 半边未执行。
- **R-09 AC-071 缺口文本**：「共享宽度标记」措辞不精确——不存在独立宽度标记属性，跨页共享的是面板 **mode**（`data-panel-mode`），宽度由 CSS `--dock` 依 mode 派生；缺口实质（无浏览器→无 viewport/宽度证据）成立，建议把该短语改为「共享面板 mode（宽度随之派生）」。
- **R-10 AC-001**：「读取记录/read ledger」子句未由 live 产生（live.md §3 已披露）；「按需调查」为演练直接注入来源；「区分事实/未知」为子串正则（prompt 自身即要求输出该标记）。此为 review 第 3 轮 W10R3-04 的延续，属「已披露」而非隐瞒。
- **R-11 AC-092 层面**：`importRequirementPool` 未接入任何 app/daemon/web 面，「冲突逐条显示」只在库/API 层成立。
- **R-12 AC-094**：「完成/归档保持目录与引用不变」无归档专项用例；curated 中 `requirement-save.test.ts:456` 为 AC-091 标记用例，对「完成摘要两份一致」的支持较弱（真正支撑是 `:105`）。
- **R-13 AC-040**（顺带）：条款「缺字段」在投影层用例实际是非法枚举；缺字段拒绝只在解析器层（未标 AC-040，也未过 `buildProjection`）。

**C. 仍成立的前轮残余**

- **W10R4-01（P3）仍成立**：`$TMPDIR`（`/var/folders/…/T`）在我会话期间新增 **723** 个 `agentdev-*` 目录，全部来自 unit/integration 脚手架（`join-project` 210、`join-global` 210、`gateway-store` 192、`config-store` 96、`worktree-scratch` 15）；**WP-10 自己的 live/e2e/acceptance drill 目录遗留 0**，说明发布路径清理正确。属跨会话历史问题（review 第 4 轮计数 11968）。
- **W10R4-02（P3）仍成立**：L1 演练记录（`live.md`/`live-results.json` 证据串）不含交给 Review 的冻结字节或其哈希，记录本身不能自证 prompt；我本轮用 HTTP 抓包独立证实了冻结字节确实进入 prompt（§4.3）。
- **W10R3-03（P3）**：已提交记录 `gitHead=9917d34`（=父提交，非冻结 HEAD），但 `binding.dirty:true` 且 `codeDigest=8ca1e58c…` 与冻结树逐位一致；门禁只校验 `codeDigest`+nonce，记录本身不是证据来源。我从冻结提交重跑时，生成记录的 `gitHead` 已是 `9f154c3`（未纳入提交，因我按规则还原）。
- 前序包残余沿用：`agentdev start/stop/status/open/backup/restore/relocate` CLI 未交付（`release.md` §5 已标 UNVERIFIED 并给真实 RPC 入口）；CAS journal 在 e2e/live 用内存实现，崩溃/恢复注入不在本切片；WP-09 T2-01、W9R3-01/02/03；e2e 观察「仅元数据更新会再写 record-version 标记」。

**D. 我未做/无法做**

- 真实浏览器演练（D1，无 Playwright/浏览器二进制）；真实 Pi SDK 模型轮次（D4）；独立 Review/Test 模型（无该变量）。
- `docs/rules/*`、`AGENTS.md`、`docs/INDEX.md` 的全量一致性交叉审计（非本包判定对象，按需查阅）。
- 我对 fail-closed 的"未登记 UNVERIFIED"与"过期 curated"复现使用 Node ESM loader 在**运行期**改写模块源码，以遵守"唯一写入 test.md、不修改脚本代码"的约束；因此不是物理改文件版复现，但驱动的是真实 runner 全流程并复现了相同的失败分支与消息。

## 8. 结论

**PASS**。

理由：

1. **冻结与门禁**：HEAD/tree/codeDigest 与 `review-round4.md` 声明逐位一致；Review 第 4 轮 PASS（0 P1/P2，2 P3），早期 FAIL 轮次的发现均已关闭或登记。工作区除会话前已存在的 `review-round4.md` 外干净，测试后我已还原全部被运行改写的记录。
2. **十条命令 + doctor 全部由我真实执行且 exit 0**：unit 55/1107、integration 26/311、e2e 20 检查/23 AC、acceptance 94/94（PASS 86 / ACCEPTED 8 / FAIL 0 / MISSING 0）、live 2 次 exit 0、docs:check、build 12 workspace、doctor。
3. **真实 Provider 纵向可重复**：3 次运行均 11 次调用、HTTP 全 200、三条 drill 全 PASS、无重试；真实 Git/SQLite/Core/daemon/BFF 与真实 `StageGate`/`evaluateStageChain`/CAS/settlement 均被 e2e 与 live 证到；L1 Review 的 prompt 经我 HTTP 抓包确认含真实冻结字节与判据；全流程无凭证泄漏。
4. **发布就绪判定诚实**：`READY (ACCEPTED RISK 8)`，逐条列出 8 个未执行缺口并明写不声称已验证；无 Provider 的负例给出 exit 1 `NOT READY`，把 `test:live` exit 3 与 5 个 Provider AC 作为已登记缺口报出，未静默通过。
5. **fail-closed 性质独立复现全部成立**：伪造/顶替 sidecar、错误 nonce/时间/digest、`--no-drills` 结论、未登记 UNVERIFIED、豁免条件失效、过期 curated 映射、映射文件零用例——全部非 0 或被拒。

已登记的缺口（8 条豁免）与残余（§7 B/C，含 P3 的 W10R4-01/02）不阻断本包发布验收，但随版本保留；其中 R-09 建议修正 AC-071 缺口文本措辞、R-01…R-08/R-10…R-13 建议后续以补充用例或显式残余登记收敛。
