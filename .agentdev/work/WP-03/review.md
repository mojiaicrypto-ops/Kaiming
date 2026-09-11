# WP-03 独立 Review 报告（第三轮）

- 评审对象：工作包 WP-03「直接协作与说明产物」
- 评审轮次：**第三轮**（第一轮见文末「附一」，第二轮见「附二」，两者摘要均保留）
- 冻结点 / HEAD：`git rev-parse HEAD` = `f7a734eee893e7264c237639928b0c2718e1c062`（**与任务下达的 `HEAD=f7a734e` 一致**，无需折算）
- 工作树：复核开始、六条契约命令前后、报告写入前 `git status --porcelain` 均为**空**（`pnpm build` 只写被 `.gitignore` 忽略的 `dist/`）
- 评审角色：Review（独立上下文，未读取任何开发/Test 会话；只依据仓库文件、契约文档与我自建实验）
- 工具：`node v24.8.0`、`pnpm 12.3.4`、macOS 宿主；实验脚本在 `/tmp/wp03r3/probe{,2,3,4,5,6,7}.mjs`，全部消费 `pnpm build` 产物（**未 import 任何产品测试文件**）
- 记录哈希（`git hash-object`）：`packages/domain/src/requests.ts` `b4c49e49…`、`packages/core/src/messages.ts` `4451866c…`、`preview.ts` `f42b3837…`、`artifacts.ts` `057ff403…`、`attachments.ts` `3ee94838…`、`apps/daemon/src/server.ts` `73c339c8…`、`packages/core/src/orchestrator.ts` `828dde58…`、`packages/core/test/artifacts.test.ts` `cbb27723…`、`packages/domain/test/domain.test.ts` `aa37c155…`、`implementation.md` `ab6c45b4…`、`plan.md` `60103b27…`、`docs/architecture/execution.md` `7ef649f4…`
- 权威依据：`AGENTS.md`、`docs/INDEX.md`、`docs/rules/{workflow,agents}.md`、`docs/product/experience.md`（§3）、`docs/architecture/{data,protocol,execution,reliability}.md`、`docs/delivery/{implementation,acceptance}.md`（WP-03 与 AC-001..006/052/076/084）、`.agentdev/work/WP-03/{plan,implementation}.md`、`packages/**`、`apps/daemon/**`、相关测试

---

## 1. 结论

**FAIL（Review Failed）。**

开发方按产品方要求，确实在 WP-03 内补出了 AC-005/AC-006 的**机制**：确定性 `routeMessage`、消息级 Authorization 行、`work.authorizationRef`、Assessment、混合意图多 Work 与独立 scope——这些在第三轮实测中**全部成立**（§3 表、§4 表、probe 1–2）。第二轮的 2×P1（W3R2-01/02）在**「行是否落库」的口径上已修**，对抗性 7 项中 5 项已修（其中 1 项语义只部分成立）。

但 AC-005 的核心承诺「**原消息作为范围授权，范围内无重复确认**」**在端到端链路上不成立**：`grantedByMessage`（`packages/core/src/messages.ts:332-348`）创建的授权 `operations: ['edit']` 却在同一 `scope` 里声明了 `readPaths: ['docs']`；`Orchestrator.verifyAuthorization`（`orchestrator.ts:845`）要求「声明 readPaths 就必须在授权 operations 里含 `read`」。结果是**该 Work 的 `authorizationRef` 让任何 Run 与任何 Assessment 都被判 `NOT_AUTHORIZED`**——包括 Chief 自己的只读分析 Run。我实测：Chief 空 scope Run 通过、Chief 只读 scope Run 被拒、交付 Run（只写 / 读+写 / 空）**全部**被拒。AC-005 因此不是「缺证据」，而是**授权物化后不可用，交付路线在准入即死锁**——比第二轮「不创建 Authorization」更糟（原本只是无法开工，现在是绑定了一个永久挡住开工的引用）。

本轮新增 14 条 Finding：**1×P1（阻断）、5×P2、8×P3**；另有 5 条第二轮 P2/P3 残差仍然存在（其中 P2 两条仍不阻断但不建议带病进 Test）。按 `docs/rules/workflow.md` §6，P1 一律阻断，WP-03 **不得进入独立 Test**。

---

## 2. 契约命令原始结果（本轮实跑，与后台日志一致）

执行目录：仓库根；日志 `/tmp/wp03r3/{build,typecheck,lint,unit,integration,docs}.out`。

| 命令 | 退出码 | 原始结果要点 |
|---|---|---|
| `pnpm build` | **0** | `pnpm -r build`，**8** 个 workspace `Done`：`contracts, domain, cli, storage, core, daemon, pi-runtime, runner` |
| `pnpm typecheck` | **0** | `tsc -p tsconfig.json --pretty false`，无输出 |
| `pnpm lint` | **0** | `Checking formatting... All matched files use Prettier code style!` |
| `pnpm test:unit` | **0** | `Test Files 19 passed (19)`、`Tests 284 passed (284)` |
| `pnpm test:integration` | **0** | `Test Files 10 passed (10)`、`Tests 124 passed (124)`（含真实容器用例） |
| `pnpm docs:check` | **0** | `docs:check ok — 15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages` |

`git status --porcelain` 在全部命令前后均为空；`HEAD` 全程 `f7a734eee893e7264c237639928b0c2718e1c062`。

**命令全绿不等价于必验范围成立**：这 284 个用例里，AC-005 的断言只到「Authorization 行存在、`work.authorizationRef` 指它、Assessment 有 `authorizationRef`」（`packages/core/test/artifacts.test.ts:407-451`），**没有任何用例把该授权喂回 `Orchestrator`**；因此 §1 的阻断缺陷被完整地漏在测试盲区里（见 W3R3-12）。

---

## 3. 第二轮 W3R2-01..13 逐条复核

判定口径：**已修** = 本轮实验观察到期望行为；**部分** = 主行为成立但有可指认残差；**未修** = 行为仍缺失。

| 编号 | 二轮严重度 | 本轮判定 | 证据（文件:行 + 实测） |
|---|---|---|---|
| W3R2-01 AC-006 混合意图拆分 | P1 阻断 | **已修（机制完整）** | `requests.ts:87-137`；`messages.ts:147-172`；probe1 `AC006.M1–M10`：一条消息 → 2 Work（assist+delivery）、独立 scope/budget、共享 sourceRef、delivery 有 `authorizationRef`、assist 无、`requirements=0`；probe2 `DUP.1`/`MULTI.1–4` |
| W3R2-02 AC-005 授权行 | P1 阻断 | **部分（行已落，链路不可用）** | `messages.ts:176-211` 建 Authorization + 绑定 + Assessment（probe1 `AC005.E1–E9` 全绿）；但授权不可用 → 见 **W3R3-01** |
| W3R2-03 CSP 偏离 `execution.md` §6 | P2（测试前对账） | **未修** | `preview.ts:22-25` 仍为 `sandbox allow-scripts; …; frame-ancestors 'self'`；`docs/architecture/execution.md:45` 未改（probe7 `A4.csp`/`A4.docParity`） |
| W3R2-04 StorageError 映射过宽 + 回显 | P2 | **未修** | `server.ts:370-381` 未改；probe7 `R04.malformedUri`：`GET /artifacts/%E0%A4%A/preview` → `500 {"code":"INTERNAL_ERROR","message":"URI malformed"}`（客户端输入错报为内部错且回显内部信息） |
| W3R2-05 `download.prepare` 不报 validity | P3 | **未修** | probe7 `R05.prepareValidity`：prepare 体 `keys=downloadToken,expiresAt,artifactId,artifactVersion`；`R05.previewHeader` 通过（预览仍有 `x-agentdev-artifact-validity: invalid`）。另注：`STALE_ARTIFACT` **已在 `stage.ts:135,155`/`orchestrator.ts:718-739` 用于快照失配**（二轮「从不产生」的表述应修正），但产物失效读取路径仍不产生该码 |
| W3R2-06 `targetWorkId` 归属仅覆盖 message 来源 | P3 | **未修** | `messages.ts:406-413` 逻辑未变；probe7 `R06.foreignTarget`：跨会话 `sourceRef.kind='action'` 的 Work → `202`（应 403/404） |
| W3R2-07 daemon 与 Core owner 派生不一致 | P3 | **未修** | `server.ts:293` 仍 `userIdFromSubject('installation:local')`；`messages.ts:296` 的 `createMessageOperations` 仍 `userIdFromSubject(context.subject)` |
| W3R2-08 `prune()` 无调用方 | P3 | **未修** | 全仓库 `.prune(` 仅命中 `packages/core/test/artifacts.test.ts:544`（grep） |
| W3R2-09 修复缺回归测试 | P3 | **未修** | `messageBodies` 仅命中 `events-hub.integration.test.ts:97`（产品侧无回读断言）；`matchesDeclaredType`/`MAX_STAGED_PER_OWNER` 仍无测试（grep） |
| W3R2-10 记录与代码不一致 | P3 | **未修且新增一处** | `implementation.md:46` 仍写「7 workspace」「daemon 9 例」；另 `T8` 节 `:283 passed`、`T9` 节**无验证记录**，实测为 284（见 W3R3-14） |
| W3R2-11 错误响应无 §1 封装、丢 `details` | P3 | **未修** | probe7 `R11.envelope`：404 体 `topKeys=ok,error`，无 `v/type/id`；`server.ts:355-368` 仍丢弃 `error.details` |
| W3R2-12 multipart 多文件 / `projectId` | P3 | **未修** | probe7 `R12.multiFile`：两个 file part → `201 bytes=6`（首个静默丢弃）；`R12.projectId`：未知 `projectId` → `201` |
| W3R2-13 失败发送留孤儿正文 blob | P3 | **未修** | 无 GC 执行者（本轮未复测该项，代码路径未变） |

---

## 4. 对抗性 7 项复核

| 对抗项 | 二轮状态 | 本轮判定 | 证据 |
|---|---|---|---|
| 1 预览中间态内存放大 / 字节上限 | 已修 | **已修** | `preview.ts:101-108` 先按字节裁剪再解码；probe7 `A1.byteCeiling`：20 MiB 文本 → `preview bytes=1048576`、`mode=truncated` |
| 2 截断信息未下发 | 已修 | **部分** | `server.ts:126-130` 三个头齐备；probe7 `A2.truncHeaders`：字节触发的截断 `truncated-at-line=null`（`preview.ts:113-116` 只有行截断才给出行号）。**语义上可辩护**（并未按行截断），但记录的「三头齐备」只在行截断场景成立 |
| 3 `artifactVersion` 非整数静默回退 | 已修 | **已修** | `server.ts:139-142`；probe7 `A3.versionValidation` → `400` |
| 4 命令账本主体恢复为 `authed.subject` | 已修 | **已修** | `server.ts:196-209` 用 `authed.subject`；probe1 幂等路径正常 |
| 5 user Artifact ACL 由调用方指定 | 已修 | **已修** | `messages.ts:240`；daemon 传 `acl:[role]`（`server.ts:220`） |
| 6 `MAX_STAGED_PER_OWNER` 跨会话统计 | 已修 | **已修（未见回归测试）** | `attachments.ts:129` 按 owner 统计；probe7 `A6.crossConversationQuota` 第二会话上传 `201`（额度为 owner 级、未被会话重置） |
| 7 `assertReadable` 注释与实现一致 | 已修 | **已修** | `server.ts:249-268` 注释与单用户现实一致 |

**对抗性合计**：明确已修 5 项（1/3/4/5/7），其中 6 已修但无测试守护；2 项部分（2 语义可辩护、6 缺测试）。

---

## 5. AC 复核（AC-001..006/052/076/084）

| AC | 本轮判定 | 依据 |
|---|---|---|
| AC-001 自由问答 | **部分** | 只读问答仍可建 Work 且不建 Requirement（probe1 `AC005.Q1–Q6`），但「Chief 调查→回答→Work 完成」链路仍依赖 WP-04/06/10 |
| AC-002 HTML说明 | **部分** | 隔离预览/一次性下载/失效头/截断头成立（probe1、probe7 `R05.previewHeader`、`A1`）；`prepare` 仍不报 validity（`R05`） |
| AC-003 按需委派 | **不通过（无链路证据）** | 有 `artifacts.test.ts:385` 的 Run→产物用例；但「用户消息→Chief 分派 analysis/artifact 专业 Run→汇总」无端到端证据，且交付侧 Run 准入被 W3R3-01 死锁 |
| AC-004 执行授权边界 | **部分** | 沿用 WP-02：`none` 级 Work 不能派写 Run（probe3 `E2E.5` 再次确认，`VALIDATION_ERROR`），本包无新增负例 |
| AC-005 明确启动 | **不通过（阻断）** | Authorization 行 / `authorizationRef` / Assessment 三项**均已落库**（probe1 `AC005.E1–E9`），但授权自身 capability 缺口使**任何 Run 与任何 Assessment 均被拒**：probe4 `RUN.*` 5/5 被拒（`capabilityGaps:["readPaths without a read operation"]`）、`G.3` assess 被拒；probe5 仪器化证明被拒 scope 是 **Work/Chief Run 的 scope**；probe6 `CA.1`/`CA.3` 被拒、`CA.2`（空 scope）通过。**「范围内无重复确认」不成立** → W3R3-01 |
| AC-006 混合意图 | **通过（机制层）** | probe1 `AC006.M1–M10`：一条消息 → assist+delivery 两 Work、各自 scope/budget、共享来源、解释 Work 只读且 `level=none`、不建 Requirement/Gate；probe3 `E2E.6/7`：解释半边可独立 `assess` 成功。**但**「解释先行返回」仍无执行者（`level=none` Work 无运行接线，属 WP-04/06/07 承接），故只判机制层通过 |
| AC-052 HTML安全 | **部分（HTTP 契约层）** | 隔离头齐全且服务端 `sandbox` 生效（probe7 `A4.csp`），但常量与 `execution.md:45` 仍不一致（W3R2-03）；真实浏览器复验属 WP-10 |
| AC-076 附件限制 | **通过（服务端）** | 数量/大小/mime/签名矩阵成立（probe7 `A2.signature`；二轮 `A2.1–A2.11` 未回归）；残差属 multipart 多文件（W3R2-12） |
| AC-084 首条消息附件 | **通过（本包范围内）** | 暂存→发送→原子绑定→user Artifact→幂等重放（probe1、probe7 多例；`daemon/test` 12 例） |

---

## 6. 新 Findings（W3R3-xx）

严重性口径：P0 数据/安全或关键不可用；P1 错误行为/需求缺失；P2 局部质量/维护问题；P3 建议。P0/P1 阻断；P2/P3 影响验收则阻断。

### W3R3-01 [P1，阻断] AC-005 授权自身 capability 缺口，导致该 Work 的任何 Run/Assessment 都被拒（交付路线死锁）

- 位置：`packages/core/src/messages.ts:332-348`（`grantedByMessage`：`readPaths` 取自 `writePaths` 的父目录，但 `operations: ['edit']`）；对照 `packages/core/src/orchestrator.ts:842-857`（`verifyAuthorization`：`scope.readPaths.length>0 && !includesRead(authorization.operations)` ⇒ `capabilityGaps:['readPaths without a read operation']` ⇒ `NOT_AUTHORIZED`）；`routing.ts:208-219`（`includesRead` 只认 `read`/`search`，`edit` 不算读）
- 实测（probe3/4/5/6，全部消费 `pnpm build` 产物）：
  - `grantedByMessage('fix the typo in docs/INDEX.md')` → `scope={readPaths:['docs'],writePaths:['docs/INDEX.md'],operations:['edit']}, operations:['edit']`（本身即「声明读路径却无读操作」的授权）。
  - probe4：以该 Work 的 `authorizationRef` 派发 5 种 scope（只写 / 只读 / 读+edit / 读+write / 空）→ **5/5 `NOT_AUTHORIZED`**，`details.capabilityGaps=["readPaths without a read operation"]`；`assess`（L2 + 授权引用）同样被拒（`G.3`）。
  - probe5（把 `verifyAuthorization` 插桩到构建产物副本）：实际比对对象是 `{"readPaths":["docs"],"writePaths":[],"operations":[],"networkTargets":[]}`——**Work 的 scope / Chief Run 的只读 scope**，与 Run 自身 scope 无关。
  - probe6：Chief 分析 Run（只读 scope）→ `NOT_AUTHORIZED`；Chief 分析 Run（**空 scope**）→ 通过。即带该授权的 Work **连 Chief 自己的调查 Run 都无法建立**。
- 影响：(a) AC-005 的验收结果「范围内无重复确认」不可达——不是缺一次确认，而是**范围内根本无法开工**；(b) `orchestrator.dispatch` 在调用方未传 `authorizationRef` 时默认取 `work.authorizationRef`（`orchestrator.ts:411-416`），因此**任何**针对该 Work 的 Chief/专业 Run 都会被拒；(c) `work.scope` 同时携带 `operations:['edit']` 与非空 `readPaths`，使 `assess` 无论提交哪个 level 都无法通过（L1 被 `routingFloor` 抬到 L2，L2/L3 的 scope 校验又撞 capability 缺口）；(d) 模型化 Assessment（WP-04/06）落线后仍会被同一门禁挡住，属**跨包阻塞**。
- 最小修复（任一即可闭环）：`grantedByMessage` 输出 `operations: ['read','edit']`（授权读=写路径的父目录本就蕴含读），或从授权 `scope.readPaths` 去掉父目录，或让 `includesRead` 把 `edit` 视作含读（需同步 `data.md`/`execution.md` 语义）。**必须补一条把授权喂回 `Orchestrator` 的测试**（现测试只断言行的存在，见 W3R3-12）。

### W3R3-02 [P2] 客户端传 `workItems` 时授权绑定到 `works[0]`，可把写权限挂到只读 Work 上，同时交付 Work 失去授权

- 位置：`packages/core/src/messages.ts:169,178-192`（`const work = works[0]` 后无条件 `authorizations.insert({workId: work.id…})` 与 `works.update(work.id,{authorizationRef,level:'L1'})`）
- 实测（probe1 `WI.3`/`WI.4`，probe2 `MIXORD.1`）：`workItems:[{assist},{delivery}]` ⇒ **assist** 得 `level=L1 + authorizationRef`，**delivery** 得 `level=none`、`authorizationRef=undefined`。daemon 自动路由时 delivery 恒在首位（`requests.ts:111-119`）所以默认路径正确，但该参数由 HTTP 客户端控制（`server.ts:187-189`）。
- 影响：AC-005/006 的授权可被调用方顺序操纵，出现「只读 Work 持写授权、写 Work 无授权」的错误归属；`protocol.md:46` 的 `message.send` 参数并未定义 `workItems`，属未文档化扩展被信任。
- 最小修复：按 item 的 `intent/writePaths` 定位应授权的 Work（或忽略客户端 `workItems`，只由 `routeMessage` 决定），并对 `workItems` 的存在与形状做协议化声明或拒绝。

### W3R3-03 [P2] `grantedByMessage` 生成「声明读路径却不含读操作」的授权（W3R3-01 的根因，与 F1 同因不同面）

- 位置：`packages/core/src/messages.ts:339-347`
- 影响：即便修掉 `works[0]` 绑定，只要授权保留 `readPaths`+`operations:['edit']`，任何声明读路径的 Run 仍被拒；授权与 `data.md` §3 `effectiveScope` 的「声明即能力」原则相悖。
- 最小修复：与 W3R3-01 合并处理。

### W3R3-04 [P2] `message.send` 的 HTTP 响应不含 `workIds`/`authorizationId`，拆分与授权在 HTTP 面不可观测

- 位置：`apps/daemon/src/server.ts:222-227`（只回 `messageId,workId,state,version`）对照 `packages/core/src/messages.ts:314-321`（operation 响应含 `workIds`/`authorizationId`，但 daemon 未走该 operation）
- 实测（probe1 `AC005.Q7`/`ORD.1`）：HTTP 体 `keys=messageId,workId,state,version`。
- 说明：`protocol.md:46` 的结果列恰好也是这四字段，故**不构成契约违反**；但 AC-006 的证据「关联多个 Work」在 HTTP 面只剩 `workId`（首个），客户端/Test 只能转而读 `message.received`/`assessment.saved` 事件。
- 最小修复：随 `workIds`/`authorizationId` 落 `message.received`（现已落，见 `server.ts:228-238`）明确为契约证据面，或在协议表补记多 Work 结果形状。

### W3R3-05 [P2] `workItems` 同一 intent 重复时共享同一 scope（scope 不独立）

- 位置：`packages/core/src/messages.ts:156-166`（按 `intent` 反查 `routing.items.find(...)`）
- 实测（probe2 `DUP.2`）：`workItems:[{delivery,fix index},{delivery,fix experience}]` ⇒ 两个 Work 的 `scope` 完全相同（`["docs/INDEX.md"]`），并非「各自范围独立」。
- 影响：AC-006 要求「各自范围和输出独立」；同 intent 多 Work 时范围塌缩，且第二个 Work 实际拿到了未声明路径的写权限（若首个 scope 更宽）。
- 最小修复：按 `workItems` 下标与路由项一一对应，或对重复 intent 拒绝（`VALIDATION_ERROR`）。

### W3R3-06 [P2] `docs/architecture/execution.md` §6 的 CSP 与实现不一致（承接 W3R2-03，未修）

- 位置：`packages/core/src/preview.ts:22-25` vs `docs/architecture/execution.md:45`
- 实测（probe7 `A4.csp`/`A4.docParity`）：实现 = `sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; frame-ancestors 'self'`；文档未含 `sandbox allow-scripts`/`frame-ancestors`。
- 影响：Test 以 `execution.md` 为权威会读到与代码不同的策略；`frame-ancestors 'self'` 还绑定了预览响应的来源，而 `protocol.md:19` 中 BFF(4317) 与 daemon(4318) 是不同 origin，必须由 WP-04 明确预览同源转发，否则 HTML 预览可能整块不可用。
- 最小修复：把加强策略并入 `execution.md` §6（正式文档路线 + 独立 ReviewCheck），或回退逐字契约。

### W3R3-07 [P2] `StorageError` 映射过宽且未知异常回显内部消息（承接 W3R2-04，未修）

- 位置：`apps/daemon/src/server.ts:370-381`、`:390-397`
- 实测（probe7 `R04.malformedUri`）：`GET /artifacts/%E0%A4%A/preview` → `500 {"code":"INTERNAL_ERROR","message":"URI malformed"}`。`VERSION_CONFLICT`/`DUPLICATE_KEY`（应 409）、`BUSY`、`BLOB_MISMATCH`/`MIGRATION_*` 等仍被压成 400/`retryable:false`。
- 影响：`protocol.md` §7 的错误码/可重试语义被破坏；服务端契约缺陷可能被伪装为客户端引用错误（第一轮 W3-05 的最小修复明确要求「统一映射为 `ProtocolError`，禁止回显 `Error.message`」）。
- 最小修复：按 `StorageErrorCode` 逐类映射（含 `retryable`），未知异常保持 500 但用固定文案 + 相关 id。

### W3R3-08 [P3] `download.prepare` 不返回 validity/invalidReason（承接 W3R2-05，未修）

- probe7 `R05.prepareValidity`：体 `keys=downloadToken,expiresAt,artifactId,artifactVersion`。`experience.md:32` 的失效卡片由 WP-09 渲染时需要该标记。建议并入 artifact get/prepare 响应。

### W3R3-09 [P3] `targetWorkId` 归属只覆盖 `sourceRef.kind==='message'`（承接 W3R2-06，未修）

- probe7 `R06.foreignTarget`：`sourceRef.kind='action'` 的跨会话 Work 作为 `targetWorkId` → `202`。建议按 Work 的 conversation/project 归属统一判定。

### W3R3-10 [P3] owner 派生在 daemon 与 Core operation 间仍不一致（承接 W3R2-07，未修）

- `server.ts:293` 固定 `installation:local`；`messages.ts:296` 仍 `userIdFromSubject(context.subject)`。当前 daemon 直调 `sendMessage` 所以一致；一旦按 `protocol.md` 接线为 dispatcher operation，跨会话绑定会复发。

### W3R3-11 [P3] `DownloadTokenStore.prune()` 仍无产品调用方（承接 W3R2-08，未修）

- grep：`.prune(` 仅命中测试。未消费 grant 在 60s TTL 内进程内存单调增长。

### W3R3-12 [P3] AC-005 的证据链止于「行存在」，未验证授权可用（本轮 P1 的直接成因）

- 位置：`packages/core/test/artifacts.test.ts:407-451`（只断言 `authorizationId`、`work.authorizationRef`、`Authorization.sourceRef/scope/operations`、`Assessment`），无任何 `Orchestrator.assess/dispatch` 调用；`apps/daemon/test/server.test.ts` 12 例亦无 `message.send` 的 Work/授权断言。
- 影响：这正是 W3R3-01 逃过 284 个用例的原因；`implementation.md:89` 声称的「端到端：Authorization 行 + work.authorizationRef + Assessment + 多 Work 独立 scope + 纯问答零授权」属实，但**不含授权可用性**。
- 最小修复：补「显式修复消息 → `assess` 通过 → 派发一个覆盖范围内 Run 成功 → 范围外 Run 仍被拒」的集成用例。

### W3R3-13 [P3] 本轮修复后 `implementation.md` 未登记验证结果，且与实测数字不符

- `T9` 节（`:83-90`）**没有**「修复后验证」行；`T8` 节 `:80` 记 `283 passed`、`T6` 节 `:46` 仍记「7 workspace / daemon 9 例」，实测为 **284 passed / 8 workspace / daemon 12 例**。建议补 T9 验证行并统一三处数字。

### W3R3-14 [P3] `message.send` HTTP 面未声明/校验 `workItems`、`authorization`；上传未校验 `projectId`

- `server.ts:179-189` 透传两个 `protocol.md:46` 未定义的参数（W3R3-02 的入口）；`server.ts:324-327` 不读 `projectId`，未知值仍 `201`（probe7 `R12.projectId`）；`parseMultipart` 多 file part 静默保留最后一个（probe7 `R12.multiFile`）。建议显式拒绝未定义参数与第二个 file part，并校验/明确 `projectId` 可省略。

---

## 7. 计数与阻断判定

| 严重性 | 本轮新增 | 编号 | 是否阻断 |
|---|---|---|---|
| P0 | 0 | — | — |
| P1 | **1** | W3R3-01（AC-005 授权不可用 → 交付路线死锁） | **阻断** |
| P2 | 5 | W3R3-02（授权绑定顺序）、W3R3-03（授权 capability，与 P1 同因）、W3R3-04（HTTP 响应不可观测）、W3R3-05（同 intent scope 塌缩）、W3R3-06（CSP 文档漂移） | 不单独阻断；W3R3-06 须在 Test 前对账 |
| P3 | 8 | W3R3-07..W3R3-14 | 不阻断 |

另计第二轮残差仍在的 **5** 条：W3R2-04（=W3R3-07）、W3R2-05（=W3R3-08）、W3R2-06（=W3R3-09）、W3R2-07（=W3R3-10）、W3R2-08/09/10/11/12/13（=W3R3-11..14 及未单列的 `prune`/记录项）。

**仍未修好清单（必须回 Develop 的项）**：**W3R3-01（阻断）**，并建议同轮处理 W3R3-02/03/05（同一段授权代码）与 W3R3-06（Test 前对账）。
**已修好**：W3R2-01（AC-006 机制）、W3R2-02 的「行落库」部分；对抗性 1、3、4、5、7，对抗性 2/6 记为部分/无测试守护。

---

## 8. 回归与「同类模式」扫描

- **回归面**：`f7a734e` 只改 `packages/domain/src/{index,requests}.ts`、`packages/core/src/messages.ts` 与两个测试文件 + 记录（`git show --stat HEAD`：6 文件 / +278 −21）。六条契约命令全绿；WP-02 用例未削弱（integration 10 文件/124 用例与二轮一致）。
- **授权/归属判定扫描（现状）**：`stage`（Conversation 存在/未归档/owner 配额）、`remove`（owner）、`bind`（owner+conversation）、`preview`/`prepare`（role ACL + user artifact 上传者）、`download`（role ACL，token 即凭证）均有判定；剩余缺口为 W3R3-09（Work 归属非 message 来源）。
- **仓储层 Schema 防线（本轮新增确认）**：`'fix ../../etc/hosts'` 这类路径穿越/绝对路径**被 `repoPathSchema`（`packages/contracts/src/primitives.ts:67-81`）在写入时拒绝**（probe2 D：`400`，无 Authorization 行）。即 `routeMessage` 不做路径净化也不构成写越界，属可接受的设计（Schema 兜底）；但错误形态是 400 而非显式 `VALIDATION_ERROR`+字段，与 W3R3-07 同源。
- **路由启发式观察（非缺陷，供 Test 参考）**：`routeMessage` 对中文/英文动词与路径识别正常（probe2：`修复 docs/product/experience.md` → delivery；`how do I add a new command?` → assist 无授权；`write the documentation for the API` → document）；`'please refactor everything'` 无目标 → assist 澄清（不猜写权限），符合 `workflow.md` §1。

---

## 9. 剩余风险与承接包

### 9.1 必须在本次修复轮处理（P1）
1. **W3R3-01 / AC-005**：修掉授权 capability 缺口（补 `read` 或去掉父目录 readPaths），并补「授权喂回 Orchestrator 的 assess + dispatch」证据（W3R3-12）。

### 9.2 建议同轮处理（P2）
2. **W3R3-02/03/05**：授权绑定按 intent/writePaths 定位；`workItems` 要么忽略、要么逐项 scope 独立。
3. **W3R3-06**：把 `sandbox`/`frame-ancestors` 同步进 `execution.md` §6，或回退逐字契约；WP-04 明确预览同源拓扑。
4. **W3R3-07**：按 `StorageErrorCode` 细化映射并停止回显 `error.message`。

### 9.3 承接给后续包 / 结算登记（P3）
5. **WP-04/WP-09**：`download.prepare` 暴露 validity/invalidReason（W3R3-08）；错误响应统一 `protocol.md` §1 封装（W3R3-11 相邻项，见二轮 W3R2-11）；`workIds`/`authorizationId` 的契约证据面（W3R3-04）。
6. **WP-04/06/07**：解释产物「先返回」的执行接线（AC-006 的输出侧）、`level=none` Work 的运行触发。
7. **WP-09/WP-10**：真实无头浏览器复验 AC-052（读 cookie/网络/父页/top navigation 四类）与 `frame-ancestors` 拓扑。
8. **后续**：`prune()` 调度（W3R3-11）、孤儿 blob GC（W3R2-13）、multipart 多文件与 `projectId`（W3R3-14）、owner 派生统一（W3R3-10）。
9. **本包/结算**：补齐 `messageBodies` 回读、`matchesDeclaredType`、`MAX_STAGED_PER_OWNER` 回归测试（W3R2-09）；修正 `implementation.md` 数字并补 T9 验证行（W3R3-13）。

### 9.4 未闭环风险（供 Settlement/产品方判断）
- **多用户语义**：`PRODUCT.md` 单用户前提下安装用户 + 角色 ACL 成立；未来引入多用户需重做 `assertReadable` 主体维度。
- **真实 Provider 纵向**：AC-001/AC-003 的完整证据仍依赖 WP-07（`artifact_write` 落库）与 WP-10；本包不评价。
- **路由启发式 vs 模型 Assessment**：`routeMessage` 是确定性基线，关键词表可能误判（如 "add" 出现于疑问句）；本轮未发现误判样本，但它是 WP-04/06 模型评估接管前唯一的判定者，Test 建议加语义边界样例。
- **Docker/隔离环境**：本轮为宿主只读 Review，未用容器；未修改任何产品文件。

---

## 10. 能否进入独立 Test —— **不能**

- 依据 `docs/rules/workflow.md` §6：P0/P1 阻断；本轮 **1×P1（W3R3-01）** 未闭合，且它是 AC-005 的核心验收结果，无法以「not_covered + 用户接受风险」放行（`workflow.md` §6：放行不得违反不可覆盖的权限/Gate 规则；此处正是权限链）。
- 另 W3R3-06 须在 Test 前与 `execution.md` 对账（否则 Test 会以文档为权威读到不同 CSP）。
- 失败路由：**`Blocking Review Finding → Develop → Independent Review`**，修复后必须由新的独立 Review 重新核验（不得由开发自证）。
- 建议修复顺序：**W3R3-01/03（授权 capability）→ W3R3-02/05（绑定与独立 scope）→ W3R3-12（补授权可用性测试）→ W3R3-06/W3R3-07（契约与错误面）→ P3 项按 §9.3 承接**。

---

## 11. 方法与边界声明

- 独立上下文：未读取任何开发/Test 会话对话；结论只来自仓库文件、`docs/**` 契约与 `/tmp/wp03r3/` 下我自建的 7 个实验脚本。**实验统计**：probe1 39 项断言（35 通过 / 4 失败）、probe2 8 项（6/2）、probe3 9 项（6/3）、probe4 8 项（2/6）、probe5 为定向诊断（打印实际比对 scope）、probe6 4 项（2/2）、probe7 15 项（8/7）；合计 83 项观察，断言与 Findings 一一对应。
- 为保证「非因我的实验构造而误判」，probe5 把 `verifyAuthorization` 的唯一判定点插桩到**构建产物的副本**（`/tmp/wp03r3/core-instr`），实测打印被比对的 scope 为 Work/Chief Run 的 scope；**仓库文件未被修改**。
- 未做：真实无头浏览器执行、真实 Provider 纵向、Docker 容器内复验。
- 未改仓库：本轮只覆盖写入 `.agentdev/work/WP-03/review.md`（本报告）；`git status --porcelain` 在写报告前后均为空（tracked 文件零改动），`HEAD` 仍为 `f7a734eee893e7264c237639928b0c2718e1c062`。

---

## 附一：第一轮摘要（保留）

第一轮（报告冻结于 `a946ed6`，被审代码树 `fd90fef`）结论 **FAIL**：必验范围「实现完整直接协作与产物路线，附件暂存/绑定、隔离预览可实际运行」不成立，新增 14 条 Finding —— **2×P0、5×P1、5×P2、2×P3**；其中 P0/P1 全部阻断，P2 的 W3-06 因影响 AC-002 阻断。

| 编号 | 严重度 | 摘要 | 二轮状态 | 三轮状态 |
|---|---|---|---|---|
| W3-01 | P0 | 下载 token 可预测且下载路由先于认证 | 已修 | 未回归 |
| W3-02 | P0 | 产物读取只有角色 ACL、无主体维度 | 已修（单用户语义） | 未回归 |
| W3-03 | P1 | owner 由 sessionId 派生，换会话/通道即失败 | 已修 | 未回归 |
| W3-04 | P1 | 消息正文未写入 blob | 已修 | 未回归（仍无测试守护） |
| W3-05 | P1 | 未知 conversation 上传返回 500（FK 穿透） | 已修（映射残差 W3R2-04） | 残差未修（W3R3-07） |
| W3-06 | P2（阻断 AC-002） | 失效产物仍可预览/下载 | 部分（W3R2-05） | 部分（W3R3-08） |
| W3-07 | P1 | AC-006 混合意图未实现 | 未修（W3R2-01） | **机制已修** |
| W3-08 | P1 | 用户消息不创建 Authorization | 未修（W3R2-02） | **行已落但不可用（W3R3-01）** |
| W3-09 | P2 | token 只增不减、`prune()` 无调用方 | 未修（W3R2-08） | 未修（W3R3-11） |
| W3-10 | P2 | 已归档 conversation 仍接受上传 | 已修 | 未回归 |
| W3-11 | P2 | `expireStale()` 无调用方 | 已修 | 未回归 |
| W3-12 | P2 | 错误响应缺 `protocol.md` §1 封装 | 未修（W3R2-11） | 未修（W3R3-07 相邻） |
| W3-13 | P3 | 记录与代码不一致（workspace 数、`cmds.log`） | 半修（W3R2-10） | 未修（W3R3-13） |
| W3-14 | P3 | 浏览器级攻防未验、下载路径无隔离头 | 承接 WP-10 | 承接 WP-10 |

第一轮另记录对抗性 5 项（内联预览字节上限、文件签名、`targetWorkId` 归属、预览隔离只靠客户端头、失败上传孤儿 blob 与 staged 无上限），均已在第二轮或本轮给出结论，详见「附二」与 §4。

---

## 附二：第二轮摘要（保留）

第二轮（报告冻结于 `8e4efc1`，被审代码树与 HEAD 同为 `a946ed6`/`a946ed6b72…`）结论 **FAIL**：主要判据为 W3R2-01（AC-006 未实现）与 W3R2-02（AC-005 未实现），另 2×P2（W3R2-03 CSP 漂移、W3R2-04 StorageError 映射/回显）、9×P3（W3R2-05..13）；六条契约命令全绿但不足以支撑必验范围。

| 第二轮编号 | 严重度 | 摘要 | 三轮状态 |
|---|---|---|---|
| W3R2-01 | P1 | AC-006 混合意图仍未实现 | **已修（机制）** |
| W3R2-02 | P1 | 用户消息仍不创建 Authorization | **部分：行已落，链路不可用 → W3R3-01（P1）** |
| W3R2-03 | P2 | 预览 CSP 偏离 `execution.md` §6 | 未修 → W3R3-06 |
| W3R2-04 | P2 | StorageError 映射过宽且回显内部消息 | 未修 → W3R3-07 |
| W3R2-05 | P3 | `download.prepare` 不报 validity | 未修 → W3R3-08 |
| W3R2-06 | P3 | `targetWorkId` 归属只覆盖 message 来源 | 未修 → W3R3-09 |
| W3R2-07 | P3 | owner 派生 daemon/Core 不一致 | 未修 → W3R3-10 |
| W3R2-08 | P3 | `prune()` 无调用方 | 未修 → W3R3-11 |
| W3R2-09 | P3 | 修复缺回归测试证据 | 未修 → W3R3-12 |
| W3R2-10 | P3 | 记录与代码不一致 | 未修 → W3R3-13 |
| W3R2-11 | P3 | 错误响应无 §1 封装、丢 `details` | 未修（并入 W3R3-07/14） |
| W3R2-12 | P3 | multipart 多文件静默丢弃、`projectId` 被忽略 | 未修 → W3R3-14 |
| W3R2-13 | P3 | 失败发送留无引用正文 blob | 未修（承接 GC） |

第二轮对抗性 7 项结论见本轮 §4（1/3/4/5/7 已修，2 部分语义可辩护，6 已修但无测试守护）。第二轮方法与边界（`probe{,2,3}.mjs` 共 95 项观察、未读开发对话、未改仓库）同样适用于本轮；本轮为彻底重新核验，未复用二轮结论。
