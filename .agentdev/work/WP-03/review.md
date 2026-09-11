# WP-03 独立 Review 报告（第二轮）

- 评审对象：工作包 WP-03「直接协作与说明产物」
- 评审轮次：**第二轮**（第一轮报告见本文件末尾「附：第一轮摘要」，冻结于 `a946ed6`；修复提交 `c35f1c5`）
- 冻结点 / HEAD：`git rev-parse HEAD` = `a946ed6b723426264571ff55bc5014a1746dd435`
  - **与任务下达的「HEAD=c35f1c5」不一致**：`a946ed6` 的父提交是 `c35f1c5`，`git diff --stat c35f1c5 a946ed6` 只有 `.agentdev/work/WP-03/review.md`（+217）；`git diff --quiet c35f1c5 a946ed6 -- packages apps docs` 退出 0。即**被审代码树与文档等于 `c35f1c5`**，`a946ed6` 仅追加了第一轮报告。本轮按 `a946ed6` 冻结。
- 工作树：复核开始、六条契约命令前后、报告写入前 `git status --porcelain` 均为**空**（`pnpm build` 只写被 `.gitignore` 忽略的 `dist/`）
- 评审角色：Review（独立上下文，未读取任何开发/Test 会话；只依据仓库文件、契约文档与我自建实验）
- 工具：`node v24.8.0`、`pnpm 12.3.4`、macOS 宿主；实验脚本在 `/tmp/wp03r2/probe{,2,3}.mjs`，全部消费 `pnpm build` 产物（**未 import 任何产品测试文件**）
- 记录哈希（`git hash-object`）：`packages/core/src/messages.ts` `c0ade65c…`、`attachments.ts` `9730eef3…`、`preview.ts` `e9ad1598…`、`artifacts.ts` `057ff403…`、`identity.ts` `3ecf7b48…`、`apps/daemon/src/server.ts` `08fc8baf…`、`apps/daemon/test/server.test.ts` `75596ab1…`、`packages/core/test/artifacts.test.ts` `61d4789a…`、`.agentdev/work/WP-03/implementation.md` `789715d5…`、`.agentdev/work/WP-03/plan.md` `60103b27…`、`docs/architecture/execution.md` `7ef649f4…`
- 权威依据：`AGENTS.md`、`docs/INDEX.md`、`docs/rules/{workflow,agents}.md`、`docs/product/{PRODUCT,experience}.md`（§3）、`docs/architecture/{data,protocol,execution,reliability}.md`、`docs/delivery/{implementation,acceptance}.md`（WP-03 与 AC-001..006/052/076/084）、`.agentdev/work/WP-03/{plan,implementation}.md`、`packages/core/src`、`apps/daemon/src`、相关测试

---

## 1. 结论

**FAIL（Review Failed）——修复轮修复了 8 条必验项中的 6 条与对抗性 5 项中的 4 项（第 5 项部分修复但引入契约漂移），W3-07（AC-006）与 W3-08（AC-005）经实测仍完全未实现，仅以「记录级承接 WP-04/WP-05」处理，且没有 Plan 修订或 Decision 支撑；本轮新增 13 条 Finding：2×P1（阻断）、2×P2、9×P3。**

主判据（原始观察值均在 `/tmp/wp03r2/probe{,2,3}.log`）：

1. **W3-01 已修**：`preview.ts:144` 用 `randomBytes(32).toString('base64url')`；`probe.mjs` P1.2–P1.8 —— 5 次 prepare 得到 5 个互异 token（长度 43，URL-safe），token 不含 artifactId，旧的可预测形状 `<artifactId>.1.1` → `403`，随机猜测 → `403`，首次下载 `200`/正文 `<p>attached</p>`，二次重放 `403`。
2. **W3-02/W3-03 已修（按 PRODUCT.md 的单用户语义）**：`server.ts:272-291` 所有已认证会话/凭证统一映射 `userIdFromSubject('installation:local')`；`probe.mjs` P2.1–P2.7 —— 会话 A 上传→会话 B 发送 `202`、Bearer 上传→会话发送 `202`、跨会话预览 `200`、匿名预览 `401`，全部附件 `ownerUserId` 只有 **1** 个值且等于安装用户。`PRODUCT.md:3/71` 明确「单用户、自托管」，故「主体维度」收敛为安装用户是符合产品基线的处置（第一轮报告 §8.2 曾要求产品明确该假设，文档已具备）。
3. **W3-04 已修**：`messages.ts:107-119` 先 `blobs.write(body)` 再以真实 `hash/relativePath` 写 `message_body`；`probe.mjs` P3.1–P3.7 —— 路径 `blobs/a4/a427…b1b02`、文件存在、`readVerified` 回读等于正文、hash 等于 `sha256(body)`、`message.bodyRef` 指向该行。`probe2.mjs` I2 证明幂等重放不重复写正文行。
4. **W3-05 已修（核心场景）**：`attachments.ts:113-123` 先校验 Conversation 存在/未归档；`probe.mjs` P4.1–P4.4 —— 未知会话 `404/NOT_FOUND`（不再是 500），归档会话 `400/INVALID_STATE`，且无附件行/无 blob 残留（P4.5）。
5. **W3-06 部分修复**：失效产物仍可按契约读取历史（`200`），预览/下载响应新增 `x-agentdev-artifact-validity: invalid`（`probe.mjs` P5.2）；但 `download.prepare` 仍不返回 validity/invalidReason（P5.4），产物读取路径从不产生 `protocol.md` §7 的 `STALE_ARTIFACT`（P5.6，`artifacts.ts`/`server.ts` 无该码）。
6. **对抗性 1/2/5 已修**：预览同时受 2000 行与 1 MiB 限制，且按 UTF-8 边界截断（`probe.mjs` A1.1 `1048576` 字节、A1.2 多字节 `1048575` 字节且无替换字符）；文件签名校验覆盖 PNG/JPEG/WebP/PDF magic 与文本 NUL/UTF-8（A2.1–A2.11 全对）；staged 每 owner 上限 50（A5.1 `400/VALIDATION_ERROR`）、上传时机会式过期清理（A5.2 `expired`）。
7. **对抗性 3 基本修复**：跨会话 `targetWorkId` → `403/NOT_AUTHORIZED`（A3.1），未知 Work → `404`（A3.3）；但 `messages.ts:273` 只对 `sourceRef.kind === 'message'` 校验，`action` 等来源的 Work 跨会话仍被接受（A3.4 → `202`，见 W3R2-06）。
8. **对抗性 4 引入新问题**：服务端确实加了 `sandbox allow-scripts`（不再只靠客户端头，A4.1/A4.5），但 `PREVIEW_CSP` 现在 **不再等于** `execution.md:45` 逐字规定的 CSP（多了 `sandbox allow-scripts;` 与 `frame-ancestors 'self';`，A4.3 FAIL），文档未同步（见 W3R2-03）。
9. **W3-07/W3-08 未修**：`probe2.mjs` —— 一条混合意图消息只创建 **1** 个 Work（AC006.2），`messages.ts` 无拆分逻辑（AC006.4）；发送后 `store.authorizations.list()` 为 **0**、`work.authorizationRef` 为 `undefined`（AC005.3/AC005.4）。`plan.md:38` 的 T5 明确把 AC-001–006 映射到本包，`docs/delivery/implementation.md:53` 的 WP-03 关联验收同样包含 AC-005/AC-006；`implementation.md:64` 的单方面承接未改 Plan、未落 Decision，且承接目标 WP-04（知识/初始化）/WP-05（Context 隔离）与这两条 AC 语义不匹配。

**结论去向**：按 `docs/rules/workflow.md` §6，P0/P1 一律阻断；WP-03 **不得进入独立 Test**，回 Develop 修复后重新独立 Review（`Blocking Review Finding → Develop → Independent Review`）。

---

## 2. 契约命令原始结果（本轮实跑）

执行目录：仓库根；日志 `/tmp/wp03r2/{typecheck,lint,test-unit,test-integration,docs-check,build}.log`。

| 命令 | 退出码 | 原始结果要点 |
|---|---|---|
| `pnpm typecheck` | **0** | `tsc -p tsconfig.json --pretty false`，无输出 |
| `pnpm lint` | **0** | `Checking formatting... All matched files use Prettier code style!` |
| `pnpm test:unit` | **0** | `Test Files 19 passed (19)`、`Tests 281 passed (281)`（`apps/daemon/test/server.test.ts` **12** 例，`packages/core/test/artifacts.test.ts` **14** 例） |
| `pnpm test:integration` | **0** | `Test Files 10 passed (10)`、`Tests 124 passed (124)`（含真实容器用例） |
| `pnpm docs:check` | **0** | `docs:check ok — 15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages` |
| `pnpm build` | **0** | `pnpm -r build`，**8** 个 workspace `Done`：`contracts, domain, cli, storage, core, daemon, pi-runtime, runner` |

`git status --porcelain` 在全部命令前后均为空；`HEAD` 全程 `a946ed6b723426264571ff55bc5014a1746dd435`。

**六条命令全部通过，但与第一轮相同：命令通过不能支撑必验范围（见 §1、§4）。** 另注：第一轮报告 §2 称 `pnpm build` 有「9 个 workspace」，经本轮实测为 **8** 个（`pnpm-workspace.yaml` 只收 `packages/*` 与 `apps/*`），`implementation.md:65` 的「8 workspace」正确，`implementation.md:46` 的「7 workspace」仍错（见 W3R2-10）。

---

## 3. 逐条复核表：W3-01..W3-08 与对抗性五项

判定口径：**已修** = 本轮实验观察到期望行为；**部分** = 主行为成立但有可指认残差；**未修** = 行为仍缺失。

| 编号 | 第一轮严重度 | 本轮判定 | 证据（文件:行 + 实测） |
|---|---|---|---|
| W3-01 token 可预测 | P0 阻断 | **已修** | `preview.ts:144,147-158`；P1.2–P1.8（5/5 互异、不含 id、旧形状/猜测 403、单次消费） |
| W3-02 产物读取无主体维度 | P0 阻断 | **已修**（单用户语义） | `server.ts:238-248,272-291`；P2.4–P2.7；`PRODUCT.md:3/71` 单用户自托管；匿名仍 401（P2.5） |
| W3-03 owner 由 sessionId 派生 | P1 阻断 | **已修** | `server.ts:273,277,290,317`；P2.2/P2.3 跨会话与跨通道绑定均 202；P2.6 owner 唯一 |
| W3-04 正文未落 blob | P1 阻断 | **已修** | `messages.ts:107-119`；P3.1–P3.7 回读、hash、bodyRef 全对；I2 幂等不重复 |
| W3-05 未知会话 500 | P1 阻断 | **已修（核心）/残差** | `attachments.ts:113-123`、`server.ts:350-362`；P4.1–P4.7；残差见 W3R2-04 |
| W3-06 失效产物仍可读 | P2（影响 AC-002）阻断 | **部分** | `server.ts:124,267` validity 头；P5.2 通过；P5.4 prepare 无 validity/invalidReason、P5.6 无 `STALE_ARTIFACT` → W3R2-05 |
| W3-07 AC-006 混合意图未实现 | P1 阻断 | **未修** | AC006.2 一条混合消息只建 1 个 Work；AC006.4 `messages.ts` 无拆分逻辑；`implementation.md:64` 仅记录承接 → W3R2-01 |
| W3-08 不创建 Authorization | P1 阻断 | **未修** | AC005.3 `work.authorizationRef=undefined`；AC005.4 `authorizations=0`；全仓库 `store.authorizations.insert` 仅测试命中 → W3R2-02 |
| 对抗性 1 预览字节上限 | — | **已修** | `preview.ts:85-107`；A1.1–A1.3（1 MiB 与多字节边界） |
| 对抗性 2 文件签名 | — | **已修** | `attachments.ts:47-73,147-153`；A2.1–A2.11 全对 |
| 对抗性 3 targetWorkId 归属 | — | **已修（主）/残差** | `messages.ts:262-281`；A3.1/A3.2/A3.3；A3.4 非 message 来源 Work 202 → W3R2-06 |
| 对抗性 4 隔离只在客户端 | — | **部分** | `preview.ts:23-26`；A4.1/A4.5 服务端 sandbox 生效；但 A4.3 与 `execution.md:45` 不再逐字一致 → W3R2-03 |
| 对抗性 5 staged 上限与清理 | — | **已修** | `attachments.ts:39,124-131`、`server.ts:314`；A5.1/A5.2/A5.3 |

---

## 4. 逐条 AC 复核

| AC | 判定 | 依据（文件:行 + 实测） |
|---|---|---|
| AC-001 自由问答 | **不通过** | 消息→assist/`level=none` Work 成立且不建 Requirement（P6.3/P6.5）；但正文虽已可回读（W3-04 已修），本包仍无「Chief 调查→回答→Work 完成」链路，且 AC-005 的授权绑定缺失（W3R2-02）。 |
| AC-002 HTML说明 | **部分** | 隔离预览/一次性下载正例成立（P1.7、P2.4、AC-002 相关 daemon 用例）；失效态可由响应头区分（P5.2），但 `prepare` 不报 validity（P5.4）。 |
| AC-003 按需委派 | **部分/无证据** | 有 `artifacts.test.ts:385` 的 delegated analysis Run 产物用例；无「用户消息→分派→汇总」链路。按保守口径记无证据。 |
| AC-004 执行授权边界 | **部分** | 沿用 WP-02 结论（`level=none` 不产生修改授权、R3 显示 ACL 生效），本包未新增负例。 |
| AC-005 明确启动 | **不通过** | 发送后无 Authorization 行、Work 无 `authorizationRef`（AC005.3/4），`orchestrator` 对 L1+ 要求 `authorizationRef`，交付路线在 `assess` 即被拒。 |
| AC-006 混合意图 | **不通过（未实现）** | 一条消息恰好 1 个 Work（AC006.2），无拆分逻辑（AC006.4）、无测试、无映射。 |
| AC-052 HTML安全 | **部分（HTTP 契约层）** | CSP/sandbox/`credentials: omit`/`nosniff`/`no-store` 齐全且服务端 sandbox 生效；但常量已偏离 `execution.md:45`（A4.3），真实浏览器执行仍属 WP-10。 |
| AC-076 附件限制 | **通过（服务端）** | 数量/单文件/总大小/mime/签名矩阵全对（A2.1–A2.11、L3/L4、daemon 用例）；失败后无残留（P4.5、A5.3）。 |
| AC-084 首条消息附件 | **通过（本包范围内）** | 暂存→发送→原子绑定→user Artifact→幂等重放全通过（P2.2/P2.3、P3、I1/I2、L1/L2、R1–R3）；未知/归档会话与正文存储已修。 |

---

## 5. 新 Findings（W3R2-xx）

严重性口径：P0 数据/安全或关键不可用；P1 错误行为/需求缺失；P2 局部质量/维护问题；P3 建议。P0/P1 阻断；P2/P3 影响验收则阻断。

### W3R2-01 [P1，阻断] W3-07 未修：AC-006 混合意图仍未实现，仅以记录承接

- 位置：`packages/core/src/messages.ts:121-124`（`targetWorkId === undefined` 时只 `createAssistWork` 一次）、`:223-260`；`.agentdev/work/WP-03/implementation.md:64`（承接 WP-04/WP-05）
- 实测（`probe2.mjs` AC006.1–AC006.4）：一条 `explain … and fix …` 消息 → `202`，`store.works.list()` 只 +1，绑定该消息的 Work 数为 1，`messages.ts` 无拆分/mixed 逻辑。全仓库无 AC-006 测试（`grep -rn "AC-005\|AC-006" packages apps --include=*.ts` 退出 1）。
- 影响：`plan.md:38`（T5 映射 AC-006）与 `docs/delivery/implementation.md:53`（WP-03 关联验收含 AC-006）仍要求该行为；`workflow.md` §1 也要求「混合消息拆多个Work分别绑定相同来源和各自范围」。单方面「记录级承接」既未修订 Plan（仍 planVersion 1）也未落 Decision（`workflow.md` §2/§6：「以后处理」= 新 Queued Requirement，当前验收保持；「不采纳」= 保留原因，仍须符合当前验收）。承接目标 WP-04/WP-05 也不匹配该语义。
- 最小修复：在消息接受事务内按意图拆分（至少 assist/artifact 与 delivery 分离），每 Work 携带同一 `sourceRef` 与独立 Scope；补「一消息 → ≥2 关联 Work」测试；若确需延后，先由产品角色落 Decision 并修订 Plan 验收映射。

### W3R2-02 [P1，阻断] W3-08 未修：用户消息仍不创建 Authorization，delivery 路线拿不到范围授权

- 位置：`packages/core/src/messages.ts:244-259`（Work 只有 `sourceRef`，无 `authorizationRef`）；`packages/core/src/orchestrator.ts` 的 `verifyAuthorization`（对 L1/L2/L3 要求 `authorizationRef`）
- 实测（`probe2.mjs` AC005.1–AC005.5）：发送后 `work.authorizationRef=undefined`、`store.authorizations.list()=0`；全仓库产品代码无 `store.authorizations.insert`。
- 影响：AC-005「原消息作为范围授权，范围内无重复确认」在 `data.md` §2 `authorization` 表（来源仅用户消息/动作）意义上无落点；L1 升级路径同样不可达。同上，Plan/验收未修订、无 Decision。
- 最小修复：消息接受事务内（或 Chief 首轮评估内）按消息 Scope 写入 Authorization 并把 id 写入 `work.authorizationRef`；补「明确修复目标的消息 → assess 通过且 authorizationRef 指向该来源」测试。

### W3R2-03 [P2，不单独阻断但须在 Test 前对账] 预览 CSP 已偏离 `execution.md` §6 的逐字契约，且新增 `frame-ancestors` 未验证部署拓扑

- 位置：`packages/core/src/preview.ts:23-26`；契约 `docs/architecture/execution.md:45`（「CSP default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'」）
- 实测（`probe.mjs` A4.3 FAIL、A4.1/A4.2/A4.5）：代码 CSP =
  `sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; frame-ancestors 'self'`
  → 比文档多 `sandbox allow-scripts;` 与 `frame-ancestors 'self';`。第一轮确认过二者逐字一致，修复后不再一致，而 `docs/**` 未随 `c35f1c5` 改动。
- 影响：(a) 记录/契约漂移：Test 以 `execution.md` 为权威时会读到与代码不同的策略；(b) `frame-ancestors 'self'` 把可嵌入者绑定到「预览响应的来源」；`protocol.md:19` 规定 BFF 默认 `127.0.0.1:4317`、daemon 默认 `127.0.0.1:4318`，是不同 origin。若浏览器经 BFF 转发字节（文档描述「BFF转发字节」）则 `'self'` 与页面同源、可嵌入；若开发期浏览器直连 daemon 预览，iframe 会被 `frame-ancestors` 拒绝。该拓扑差异必须在 WP-04/WP-10 接线时明确，否则 HTML 预览可能整块不可用。
- 最小修复：把 `sandbox`/`frame-ancestors` 的加强并入 `execution.md` §6（正式文档路线 + 独立 ReviewCheck），或回退到逐字契约；并在 WP-04 明确预览响应由 BFF 同源转发。

### W3R2-04 [P2，不单独阻断] StorageError 映射过宽：非 FK 约束失败被当作 400 校验错误，且 500 分支仍回显内部消息

- 位置：`apps/daemon/src/server.ts:350-362`（`NOT_FOUND`/`FOREIGN KEY` → 404，其余一律 400 `VALIDATION_ERROR` + 固定文案）与 `:370-377`（其它异常 500 且 `message: error.message`）
- 实测（`probe3.mjs`）：`GET /artifacts/%E0%A4%A/preview` → `500 {"code":"INTERNAL_ERROR","message":"URI malformed"}`（客户端输入错误被报为内部错误，且内部信息回显）；同分支会把 `packages/storage/src/errors.ts` 的 `VERSION_CONFLICT`/`DUPLICATE_KEY`（应为 409）、`BUSY`（应为可重试）、`BLOB_MISMATCH`/`MIGRATION_*`/`DATABASE_UNREADABLE`（应为 500）统统压成 400 且 `retryable:false`。
- 影响：`protocol.md` §7 的错误码/可重试语义被破坏；更严重的是服务端契约/Schema 缺陷（示例：我构造 `sourceRef.kind` 非法时，仓储抛 `CONSTRAINT_VIOLATION`）会被伪装成「客户端引用了不存在的记录」，掩盖真实 bug。第一轮 W3-05 的最小修复明确要求「统一映射为 `ProtocolError`，禁止把 `Error.message` 直接回显」——核心场景已修，该残差未修。
- 最小修复：按 `StorageErrorCode` 逐类映射（含 `retryable`），未知异常保持 500 但用固定文案 + 内部相关 id，不回显原始 message。

### W3R2-05 [P3] W3-06 残差：`download.prepare` 不报 validity，产物读取从不产生 `STALE_ARTIFACT`

- `probe.mjs` P5.4：prepare 响应无 `validity`/`invalidReason`，仅预览/下载头 `x-agentdev-artifact-validity`（P5.2）；P5.6：`artifacts.ts`/`server.ts` 无 `STALE_ARTIFACT`。`experience.md:32` 的失效卡片由 WP-09 渲染，届时 prepare 路径没有可用的失效标记。建议把 validity/invalidReason 并入 artifact get/prepare 响应。

### W3R2-06 [P3] targetWorkId 归属只覆盖 `sourceRef.kind === 'message'`

- `messages.ts:273-280`：仅当 `work.sourceRef.kind === 'message'` 时校验会话；`sourceRef.kind` 为 `action`/`decision`/`policy`/`git`/`artifact` 时不校验（`probe.mjs` A3.4 → `202`），且源消息行缺失时 `source !== undefined` 短路放行。建议按 `work` 的会话/项目归属统一判定，而不是按 sourceRef 类型。

### W3R2-07 [P3] owner 派生在 daemon 与 Core 操作间不一致（潜在复发点）

- `apps/daemon/src/server.ts:273` 固定 `userIdFromSubject('installation:local')`；未被任何产品代码调用的 `createMessageOperations`（`messages.ts:170-198`）仍用 `userIdFromSubject(context.subject)`（`user:<sessionId>`）。当前 daemon 直调 `sendMessage` 所以一致；一旦按 `protocol.md` 接线为 dispatcher 操作，跨会话绑定会再次失败。`identity.ts:12-19` 的注释也仍以「一个 subject 一个 owner」描述。建议统一 owner 派生函数并删除/标注该分叉。

### W3R2-08 [P3] `DownloadTokenStore.prune()` 仍无产品调用方（W3-09 未处理）

- `grep -rn "\.prune(" packages apps` 仅命中 `packages/core/test/artifacts.test.ts:466`。未消费 grant 在进程内存单调增长（60s TTL 内可接受，但无主动清理）。建议在 `issue`/`consume` 内顺带清理或在 daemon 定时调用。

### W3R2-09 [P3] 新增修复缺少回归测试证据

- `grep -rn "messageBodies" packages apps --include=*.ts`：产品侧仅 `messages.ts`，**没有任何测试回读正文 blob**（第一轮 W3-04 最小修复明确要求「补一条『发送后正文可回读且哈希一致』的测试」）；`matchesDeclaredType` 无单元测试；`MAX_STAGED_PER_OWNER` 无测试。这三项本轮均由我的 `/tmp` 实验验证成立，但开发侧证据链缺环，后续回归无法自动守护。

### W3R2-10 [P3] 记录与代码仍不一致（W3-13 半修）

- `.agentdev/work/WP-03/implementation.md:46`（T6 验证节）仍写「`pnpm build` 7 workspace」「daemon 9 例真实 HTTP」；实测为 8 workspace、daemon 现 12 例（T7 节 `:65` 的「8 workspace」「281 passed」正确，两节自相矛盾）。
- 仓库根 `cmds.log` 仍为 WP-03 之前的旧输出（unit 17 files/233 tests、build 7 工程、无 daemon）。它被 `.gitignore` 的 `*.log` 忽略、不会入库，但会被读者误当证据。建议删除或更新。

### W3R2-11 [P3] 错误响应仍无 `protocol.md` §1 封装，且 `details` 被丢弃（W3-12 未处理）

- `probe3.mjs` E3：404 体 `topKeys=[ok,error] errorKeys=[code,message,retryable]`，无 `v/type/id`，也无 `details`（`ProtocolError.details` 在 `server.ts:344-347` 未写出）。HTTP 面被当作协议面使用时，客户端错误处理会出现两套形状。

### W3R2-12 [P3] multipart 解析与 `projectId` 字段：多文件静默丢弃、未知 projectId 被忽略

- `probe3.mjs` E5：两个 `file` part 时只保留最后一个（`bytes=3`），第一个被静默丢弃；E6：`projectId=deadbeef…` 与 daemon 的 project 不符仍 `201`。`protocol.md:98` 的上传形状含 `projectId`。建议显式拒绝第二个 file part 并校验 `projectId`（或明确其可省略）。

### W3R2-13 [P3] 发送失败会留下无引用的正文 blob（无 GC 执行者）

- `probe.mjs` A5.4：upload（+1 blob）后一次 `attachments.bind` 失败（`404`，附件保持 `staged` 正确），但 `messages.ts:107` 已写入正文 blob，事务回滚后该 blob 无引用（`blobsDelta=2`）。`data.md` §4 允许「离线 GC 清理」，但目前无 GC 实现/调用，长期会沉淀孤儿 blob。属可接受的设计边界，建议登记为承接项。

---

## 6. 计数与阻断判定

| 严重性 | 数量 | 编号 | 是否阻断 |
|---|---|---|---|
| P0 | 0 | — | — |
| P1 | 2 | W3R2-01（W3-07/AC-006）、W3R2-02（W3-08/AC-005） | **阻断** |
| P2 | 2 | W3R2-03（CSP 契约漂移）、W3R2-04（StorageError 映射/回显） | 不单独阻断；W3R2-03 须在 Test 前对账 |
| P3 | 9 | W3R2-05..W3R2-13 | 不阻断 |

**仍未修好清单（本轮必须回 Develop 的项）**：**W3R2-01、W3R2-02**（对应第一轮 W3-07、W3-08）。
**已修好**：W3-01、W3-02、W3-03、W3-04、W3-05（核心）、W3-06（部分，残差 W3R2-05）、对抗性 1、2、3（主，残差 W3R2-06）、5；对抗性 4 以「服务端 sandbox 生效但契约漂移」记部分（W3R2-03）。

---

## 7. 回归与「同类模式」扫描

- **回归面**：`c35f1c5` 只改 `packages/core/src/{attachments,messages,preview}.ts`、`apps/daemon/src/server.ts` 与两个测试文件 + 记录；`attachments.ts` 新增校验位于 `stage` 前置，`messages.ts` 仅替换 owner 来源并新增 body blob 与 `requireWork` 归属校验，`server.ts` 把 `role` ACL 之外再加 `userId` 判定。六条契约命令全绿；WP-02 用例（`orchestrator.test.ts` 45 例、`join.test.ts` 14 例）未削弱；`P6.3/P6.4` 确认无 Requirement/Decision 误创建，所有 Work `level=none`。
- **仓储层 Schema**：本轮实验意外证明 `packages/storage/src/repository.ts` 的 `insert` 会**运行时**按共享 Schema 校验（我构造非法 `sourceRef.kind` 时抛 `StorageError: … insert failed its contract schema`）。因此第一轮报告 §6「这批写入都没有经过 `packages/contracts` 的 strictObject 校验」的表述不准确；W3-04 的根因是「路径字符串合法但语义错误」，Schema 无法捕获。
- **归属校验扫描（现状）**：`stage`（Conversation 存在/未归档/owner 配额）、`remove`（owner）、`bind`（owner+conversation）、`preview`/`prepare`（role ACL + user artifact 上传者）、`download`（role ACL，token 本身即凭证）均有判定。剩余缺口仅 W3R2-06 的 Work 归属（非 message 来源）与 `assertReadable` 在附件行缺失时跳过 owner 判定（`server.ts:243-246`，单用户下无影响）。

---

## 8. 剩余风险与承接包

### 8.1 必须在本次修复轮处理（P1）
1. **W3R2-01 / AC-006**：实现消息按意图拆分 Work（或由产品落 Decision 修订 Plan 验收映射）。
2. **W3R2-02 / AC-005**：消息→Authorization 绑定 + `work.authorizationRef`（或同上走 Decision/Plan 修订）。

### 8.2 建议同轮处理（P2）
3. **W3R2-03**：把 `sandbox allow-scripts`/`frame-ancestors 'self'` 同步进 `execution.md` §6（文档路线 + 独立 ReviewCheck），或回退逐字契约；WP-04 需明确预览响应同源拓扑。
4. **W3R2-04**：按 `StorageErrorCode` 细化映射并停止回显 `error.message`。

### 8.3 承接给后续包 / 结算登记（P3）
5. **WP-04/WP-09**：`download.prepare` 暴露 validity/invalidReason（W3R2-05）；错误响应统一 `protocol.md` §1 封装（W3R2-11）。
6. **WP-09/WP-10**：真实无头浏览器复验 AC-052（读 cookie/网络/父页/top navigation 四类），并验证 `frame-ancestors` 与 BFF 拓扑（W3R2-03）。
7. **后续**：`prune()` 调度（W3R2-08）、孤儿 blob GC（W3R2-13）、`parseMultipart` 多文件与 `projectId`（W3R2-12）。
8. **本包/结算**：补齐 W3-04/签名/配额回归测试（W3R2-09）；修正 `implementation.md:46` 与 `cmds.log`（W3R2-10）。

### 8.4 未闭环风险（供 Settlement/产品方判断）
- **多用户语义**：`PRODUCT.md` 单用户前提下，W3-02 的处置（安装用户 + 角色 ACL）成立；若未来引入多用户，`assertReadable` 只覆盖 `origin=user` 且依赖附件行存在，需重做主体 ACL。
- **真实 Provider 纵向**：AC-001/AC-003 的完整证据仍依赖 WP-07（`artifact_write` 落库）与 WP-10（真实模型），本包不评价。
- **Docker/隔离环境**：本轮为宿主只读 Review，未用容器；未修改任何产品文件。

---

## 9. 能否进入独立 Test —— **不能**

- 依据 `docs/rules/workflow.md` §6：P0/P1 阻断；本轮 2×P1（W3R2-01、W3R2-02）未闭合，另 W3R2-03 须在 Test 前与 `execution.md` 对账。失败路由为 **`Blocking Review Finding → Develop → Independent Review`**，修复后必须由新的独立 Review 重新核验（不得由开发自证）。
- 建议修复顺序：W3R2-02（AC-005 授权链，是 AC-004/AC-006 的前置）→ W3R2-01（AC-006 拆分）→ W3R2-03/W3R2-04（契约与错误面）→ P3 项按 §8.3 承接。
- 若开发认为 AC-005/AC-006 确应移出 WP-03，须先由产品角色落 Decision 并修订 `plan.md` 与 `docs/delivery/implementation.md` 的验收映射，Review 再按新基线复核——不能以 `implementation.md` 的单方备注替代。

---

## 10. 方法与边界声明

- 独立上下文：未读取任何开发/Test 会话对话；结论只来自仓库文件、`docs/**` 契约与 `/tmp/wp03r2/` 下我自建的三个实验脚本。**实验统计**：`probe.mjs` 68 项断言（67 通过 / 1 失败：A4.3 CSP 与文档不一致）、`probe2.mjs` 21 项观察（全部按预期复现，其中 AC005.3/4、AC006.2/4 为「负向事实确认」）、`probe3.mjs` 6 项错误面观察。断言与 Findings 一一对应。
- 未做：真实无头浏览器执行、真实 Provider 纵向、Docker 容器内复验。
- 未改仓库：本轮只覆盖写入 `.agentdev/work/WP-03/review.md`（本报告）；`git status --porcelain` 在写报告前后均为空（tracked 文件零改动），`HEAD` 仍为 `a946ed6b723426264571ff55bc5014a1746dd435`。

---

## 附：第一轮摘要（保留）

第一轮（报告冻结于 `a946ed6`，被审代码树 `fd90fef`）结论 **FAIL**：必验范围「实现完整直接协作与产物路线，附件暂存/绑定、隔离预览可实际运行」不成立，新增 14 条 Finding —— **2×P0、5×P1、5×P2、2×P3**；其中 P0/P1 全部阻断，P2 的 W3-06 因影响 AC-002 阻断。

| 第一轮编号 | 严重度 | 摘要 | 第二轮状态 |
|---|---|---|---|
| W3-01 | P0 | 下载 token 可预测且下载路由先于认证 | 已修 |
| W3-02 | P0 | 产物读取只有角色 ACL、无主体维度 | 已修（单用户语义） |
| W3-03 | P1 | owner 由 sessionId 派生，换会话/通道即失败 | 已修 |
| W3-04 | P1 | 消息正文未写入 blob（`messages/<hash>` 不存在） | 已修 |
| W3-05 | P1 | 未知 conversation 上传返回 500（FK 穿透） | 已修（映射残差 W3R2-04） |
| W3-06 | P2（阻断 AC-002） | 失效产物仍可预览/下载 | 部分（W3R2-05） |
| W3-07 | P1 | AC-006 混合意图未实现 | **未修**（W3R2-01） |
| W3-08 | P1 | 用户消息不创建 Authorization | **未修**（W3R2-02） |
| W3-09 | P2 | token 只增不减、`prune()` 无调用方 | 未修（W3R2-08） |
| W3-10 | P2 | 已归档 conversation 仍接受上传 | 已修（`attachments.ts:119-123`） |
| W3-11 | P2 | `expireStale()` 无调用方 | 已修（`server.ts:314`） |
| W3-12 | P2 | 错误响应缺 `protocol.md` §1 封装 | 未修（W3R2-11） |
| W3-13 | P3 | 记录与代码不一致（workspace 数、`cmds.log`） | 半修（W3R2-10） |
| W3-14 | P3 | 浏览器级攻防未验、下载路径无隔离头 | 承接 WP-10 |

第一轮另记录对抗性 5 项（内联预览字节上限、文件签名、`targetWorkId` 归属、预览隔离只靠客户端头、失败上传孤儿 blob 与 staged 无上限），第一轮结论与主判据（token `01a09000-…1.1` 无凭证 `200`、跨会话读他人产物、`BLOB_MISSING`、换会话 `403`、未知会话 `500` 等）见 `git show a946ed6:.agentdev/work/WP-03/review.md`；第一轮方法与边界（`probe{,2,3}.mjs` 共 35 项、21 通过/14 失败、未读开发对话、未改仓库）同样适用。
