# WP-03 独立 Review 报告（第一轮）

- 评审对象：工作包 WP-03「直接协作与说明产物」
- 评审轮次：**第一轮**（此前无 WP-03 Review 报告；开发记录为 `.agentdev/work/WP-03/implementation.md`，planVersion 1）
- 冻结点 / HEAD：`git rev-parse HEAD` = `fd90fefd070c21aedeb4e437de6d1c7844b02725`；`git log -1` = `fd90fef docs(wp-03): implementation record T1..T6`
- 工作树：复核开始、每组实验前后、全部契约命令后、本报告写入前 `git status --porcelain` 均**无输出**（干净；`pnpm build` 只写被 `.gitignore` 忽略的 `dist/`）
- 评审角色：Review（独立上下文，未读取任何开发对话；只依据仓库文件、契约文档与我自己的实验）
- 工具：`node v24.8.0`、`pnpm 12.3.4`、macOS 宿主；实验脚本在 `/tmp/wp03-review/`，全部消费 `pnpm build` 产出的 `packages/*/dist`、`apps/daemon/dist`（**未 import 任何产品测试文件**）
- 记录哈希（`git hash-object`）：`packages/core/src/messages.ts` `9de9f61d…`、`artifacts.ts` `057ff403…`、`attachments.ts` `b8087878…`、`preview.ts` `f2ec9357…`、`identity.ts` `3ecf7b48…`、`apps/daemon/src/server.ts` `c5a6de35…`、`apps/daemon/src/index.ts` `51e41486…`、`apps/daemon/test/server.test.ts` `54fe8272…`、`packages/core/test/artifacts.test.ts` `d3d8103f…`、`.agentdev/work/WP-03/plan.md` `60103b27…`、`.agentdev/work/WP-03/implementation.md` `dd431b93…`
- 权威依据：`AGENTS.md`、`docs/INDEX.md`、`docs/rules/{workflow,agents}.md`、`docs/product/experience.md` §3、`docs/architecture/{data,protocol,execution,reliability,ARCHITECTURE}.md`、`docs/delivery/{implementation,acceptance}.md`（WP-03 与 AC-001..006/052/076/084）、`.agentdev/work/WP-03/{plan,implementation}.md`、`packages/core/src`、`apps/daemon/src`、相关测试

---

## 1. 结论

**FAIL（Review Failed）——WP-03 的必验范围「实现完整直接协作与产物路线，附件暂存/绑定、隔离预览可实际运行」未成立：隔离预览/下载不具备真实访问控制，消息正文未被持久化为可读 blob，附件绑定在换会话后即失败。本轮新增 14 条 Finding：2×P0、5×P1、5×P2、2×P3；其中 P0/P1 全部阻断，P2 的 W3-06 因影响 AC-002 阻断。**

主判据（全部为我在 `/tmp/wp03-review/probe{,2,3}.mjs` 的原始观察值）：

1. **下载 token 可被离线预测，下载路由先于会话认证**（`probe.mjs` P3）：`POST /artifacts/download.prepare` 签发 `01a09000-105d-7a57-bd02-6e53584b73e9.1.1`；不带任何凭据请求 `GET /artifacts/download/01a09000-105d-7a57-bd02-6e53584b73e9.1.1` 返回 **200** 与产物原文 `<p>attached</p>`。token 形状可推导为 `<artifactId>.<artifactVersion>.<自增序号>`，任何能看到产物 id 而不持有安装凭证的一方都能取得字节。`probe2.mjs` A1 进一步证明**已失效（invalid）产物仍可下载**。
2. **产物读取没有主体维度**（`probe.mjs` P7）：第二个会话（同一安装凭证的另一次登录）对第一个会话创建的产物 `preview=200`、`download.prepare=200`、下载 `200` 并读到 `<p>attached</p>`。daemon 把所有请求者固定映射为角色 `chief`（`server.ts:64`），ACL 只按角色判断（`artifacts.ts:199`）。
3. **消息正文 blob 未落盘**（`probe.mjs` P1、`probe2.mjs` A6）：`messages.ts:97-105` 写入的 `message_body.relativeBlobPath` 为 `messages/<sha256>`，磁盘上不存在该文件，`blobs.readVerified` 抛 `StorageError:BLOB_MISSING`；一次发送后 `blobs.list()` 中 `messages/` 前缀条目为 **0**。发送消息的正文因此不可回读（`data.md` §4 要求「先存正文blob再在接受消息的事务内写message_body」）。
4. **同一人类用户换会话即换 owner**（`probe.mjs` P6、`probe3.mjs` B2）：会话 1 上传、会话 2 发送首条消息 → `403 NOT_AUTHORIZED attachment … belongs to another owner`；经 Bearer 上传、经浏览器会话发送同样 `403`。`identity.ts:20-30` 的注释声称「一个 subject 一个 owner、跨重启不漂移」，实际 subject 是 `user:<每次登录新生成的 sessionId>`，同一人跨会话/跨通道得到不同 owner id。
5. **正例仍成立**（不可忽略的通过面）：上传/发送/绑定/幂等/过期/超限/无残留（P13/P14/P15/P16/P17）、`preview` 的 CSP 与 sandbox 头（PASS 组）、`/healthz` 不泄露（P19）、**无 Requirement/Gate 误创建**（P18：requirements=0 decisions=0 grants=0，works 全为 `level=none`）。

**结论去向**：按 `docs/rules/workflow.md` §6，P0/P1 一律阻断；WP-03 **不得进入独立 Test**，需回 Develop 修复后重新独立 Review（`Blocking Review Finding → Develop → Independent Review`）。

---

## 2. 契约命令原始结果（本轮实跑）

执行目录：仓库根；日志 `/tmp/wp03-{typecheck,lint,unit,integration,docs,build}.log`。

| 命令 | 退出码 | 原始结果要点 |
|---|---|---|
| `pnpm typecheck` | **0** | `tsc -p tsconfig.json --pretty false`，无输出 |
| `pnpm lint` | **0** | `Checking formatting... All matched files use Prettier code style!` |
| `pnpm test:unit` | **0** | `Test Files 19 passed (19)`、`Tests 278 passed (278)`（与 `implementation.md:46` 的 278 一致；含 `apps/daemon/test/server.test.ts` 9 例） |
| `pnpm test:integration` | **0** | `Test Files 10 passed (10)`、`Tests 124 passed (124)`（与记录一致） |
| `pnpm docs:check` | **0** | `docs:check ok — 15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages` |
| `pnpm build` | **0** | 9 个 workspace 全部 `Done`（含新增 `apps/daemon`，`implementation.md:46` 记为 7 个，见 W3-13） |

`git status --porcelain` 在全部命令前后均为空；`HEAD` 全程 `fd90fefd070c21aedeb4e437de6d1c7844b02725`。**六条契约命令自身全部通过，但通过的命令不足以支撑必验范围（见 §1、§4）。**

---

## 3. 逐条 AC 复核

判定口径沿用 `workflow.md` §6：AC 需要的可观察行为在**本包代码树上**能被真实驱动才算通过；记录未覆盖或行为缺失记「不通过/无证据」。

| AC | 判定 | 依据（文件:行 + 实测） |
|---|---|---|
| AC-001 自由问答 | **不通过** | `messages.ts:209-245` 只创建 `assist/level=none/status=queued` 的 Work，不建 Requirement（实测 P18 通过）；但**正文不可读**（W3-04），且本包无任何「Chief 按需调查 → 回答 → Work 完成」的驱动或测试（`grep AC-001` 在 `packages apps` 命中 0）。AC 要求「Work完成且无Requirement」，本包只能证明 Work 被创建。 |
| AC-002 HTML说明 | **不通过** | 隔离预览与一次性下载的正例存在（`server.ts:103-118/119-137/222-240`；daemon 测试覆盖截断与单次消费），但「下载可用」同时是**无凭证可用**（P3、W3-01），且失效版本仍可下载（A1、W3-06）；ACL 无主体维度（P7、W3-02）。 |
| AC-003 按需委派 | **部分/无证据** | 有 `packages/core/test/artifacts.test.ts:385`「delegated analysis Run」用例，以及 WP-02 已结算的 DispatchSpec/Session/Snapshot 能力；但本包没有「由用户消息触发的 analysis/artifact 分派 → 产物汇总」链路或测试（T5 声称的端到端未落地）。按「不将上游能力计为本包证据」的保守口径记无证据。 |
| AC-004 执行授权边界 | **部分** | `packages/domain/src/routing.ts:305-306` 保证 assist/artifact → `none`；`orchestrator` 的 `verifyAuthorization`（`orchestrator.ts:786-868`）拒绝无 `authorizationRef` 的 L1/L2/L3；`declaresWorkspaceWrite`/`touchesRunningEnvironment` 关闭写/环境操作。这些是 WP-02 的结论，本包未新增证据或负例（`implementation.md:42` 把该负例指向 WP-02 的 `orchestrator.test.ts`）。 |
| AC-005 明确启动 | **不通过** | 全仓库无 `store.authorizations.insert`（`grep` 仅命中 orchestrator 的**读取**校验）：用户消息不会生成涉及范围的 Authorization 记录，delivery Work 因此**无法**从其来源消息获得 `authorizationRef`（`orchestrator.ts:792` 对 L1/L2/L3 强制要求）。见 W3-08。 |
| AC-006 混合意图 | **不通过（未实现）** | `messages.ts:107-110` 一条消息**恰好**创建一个 Work；全仓库无按意图拆分多条 Work 的逻辑（`grep 拆分\|mixed\|multiple work` 仅命中无关的 `join.test.ts:290`），也无任何 AC-006 测试或映射。见 W3-07。 |
| AC-052 HTML安全 | **部分（HTTP 契约层）** | CSP/sandbox/`x-agentdev-preview-credentials: omit`/`nosniff`/`no-store` 与 `execution.md` §6 逐字一致（`preview.ts:13-44`），恶意样例在策略下不可达（daemon 测试 + 我的 P3 头断言）；但 AC 的证据是「浏览器攻击样例」，真实浏览器执行被 plan §5 明确推迟到 WP-10，本轮**无法在浏览器中复验**。此外下载路径无隔离头（`server.ts:232-238` 只发 `content-type/content-disposition/no-store/nosniff`），HTML 经下载路径直接以原始类型返回。 |
| AC-076 附件限制 | **通过（服务端）** | 数量 6→`VALIDATION_ERROR`、单文件 21 MiB→400、总大小 5×11 MiB→`VALIDATION_ERROR`、`application/zip`→400，且失败后 `attachments` 全为 `staged`、无残留引用（P9/P16/P17 与 daemon 测试）；AC 的「客户端同时拒绝」属 WP-04/WP-09 前端范围。 |
| AC-084 首条消息附件 | **不通过** | 正例存在（staged → 发送首条消息 → 原子绑定 + `origin=user` Artifact + 幂等重放，P15/P18 与 daemon 测试）；但「普通无附件用户/系统消息可用 message_body 存储」被 W3-04 破坏（正文 blob 不存在），「成功原子绑定新 Work」在换会话/换通道后失败（W3-03），上传未知 conversation 还返回 500（W3-05）。 |

---

## 4. 新 Findings

严重性口径：P0 数据/安全或关键不可用；P1 错误行为/需求缺失；P2 局部质量/维护问题；P3 建议。**P0 阻断**；P1 阻断；P2/P3 是否阻断按「影响验收则阻断」判定。

### W3-01 [P0，阻断] 下载 token 可预测，且下载路由先于会话认证 → 产物字节可被未认证读取

- 位置：`packages/core/src/preview.ts:116-127`（token = `${artifactId}.${artifactVersion}.${sequence}`，`sequence` 从 1 自增、进程内存 Map）；`apps/daemon/src/server.ts:84-89`（`/artifacts/download/` 在 `authenticate()` 之前处理）；`apps/daemon/src/server.ts:222-240`
- 复现（`/tmp/wp03-review/probe.mjs` P3）：签发 token `01a09000-105d-7a57-bd02-6e53584b73e9.1.1`；`curl` 等价物 `GET /artifacts/download/01a09000-105d-7a57-bd02-6e53584b73e9.1.1`（**无 Authorization、无 Cookie**）→ `200`，正文 `<p>attached</p>`。
- 影响：`protocol.md` §5 把 token 定义为「token 本身即凭证」，但该凭证可离线推导；进程重启后序号归零，凭 `<artifactId>.1.1` 即可重放。任何能访问 loopback/反代端口的一方（同机进程、被诱导的脚本、非本项目用户）都能读取 Project 内任意产物，绕过安装凭证与会话。这是隔离预览/下载可实际运行这一必验范围的安全前提。
- 最小修复：token 用 `randomBytes`（≥24 字节）生成并只存哈希；下载路由保持无需会话但必须校验 token 不可预测且与产物版本一一绑定；对同一 artifact 的 prepare 次数做限流。

### W3-02 [P0，阻断] 产物读取只有角色 ACL、没有主体维度：任一已登录用户可读他人产物

- 位置：`packages/core/src/artifacts.ts:199-201`（`isReadable(artifact, role)`）；`apps/daemon/src/server.ts:36`+`:64`（`role = options.role ?? 'chief'`，与真实调用者无关）；`apps/daemon/src/server.ts:106/126/228`；`apps/daemon/src/server.ts:246/259`（主体只用于 owner 派生，不参与授权）
- 复现（`probe.mjs` P7）：会话 A 上传并发送 → 会话 B 对同一 artifact `GET /preview` → `200`；`POST /artifacts/download.prepare` → `200` 且签发 token；`GET /artifacts/download/<token>` → `200`，正文 `<p>attached</p>`。
- 影响：`data.md` §2 `artifact.acl:Role[]` 是角色级字段，而 `protocol.md` §1 要求「读取需要认证与对象ACL」、§4 要求「服务端从请求引用解析真实绑定并拒绝跨项目」；当前实现没有任何用户/Work/Conversation 级校验，多用户部署下是跨用户数据泄露。`messages.ts:136` 把用户附件产物写成 `acl: ['chief']`，恰恰使所有会话都能读到它。
- 最小修复：为 artifact 记录 owner/UserRef（或在读取时解析 `attachmentId → attachment.ownerUserId`/`workId → conversationId`），在 preview/prepare/download 三处统一执行「认证主体 → 可读集合」判定；daemon 的固定 `role` 只能作为角色维度上限，不能替代主体判定。

### W3-03 [P1，阻断] owner 由 sessionId 派生：同一用户换会话/换通道后无法绑定已上传附件

- 位置：`packages/core/src/identity.ts:20-30`（注释声称「keeps one subject one owner across restarts」）；`apps/daemon/src/server.ts:259`（`subject = user:<session.id>`）；`apps/daemon/src/server.ts:246`（Bearer → `installation:local`）；`apps/daemon/src/server.ts:283` 与 `messages.ts:95`（两侧独立派生 owner）
- 复现：`probe.mjs` P6 —— 会话 1 上传、`auth.login()` 得会话 2 后发送 → `403 NOT_AUTHORIZED attachment … belongs to another owner`；`probe3.mjs` B2 —— Bearer 上传、浏览器会话发送 → 同样 `403`。`probe2.mjs` A8 显示三种主体得到三个不同 owner id。
- 影响：AC-084 的「首条消息上传附件再发送」在实际使用中（重新登录、BFF 用 Bearer 转发上传）必然失败，且附件只能被删除不能重新绑定；同时「跨重启稳定」的注释与实现不符，属记录与代码不一致。
- 最小修复：owner 用稳定用户身份（安装 id + 认证用户，而非一次性 session id）派生；或把附件 owner 记录为安装级主体并在绑定/删除时用同一派生函数校验；至少让 `userIdFromSubject` 的注释与真实稳定性一致。

### W3-04 [P1，阻断] 消息正文未写入 blob 存储：`message_body` 引用一个不存在的路径

- 位置：`packages/core/src/messages.ts:97-105`（`relativeBlobPath: \`messages/${sha256(body)}\``，且 `sendMessage` 的 `context` 根本没有 `BlobStore`）；对照 `packages/storage/src/blobs.ts:60-64`（真实路径为 `blobs/<hash前2位>/<hash>`）
- 复现：`probe.mjs` P1 —— 发送后 `existsSync(dataDir/messages/<hash>)` 为 `false`，`blobs.readVerified` 抛 `StorageError:BLOB_MISSING`；`probe2.mjs` A6 —— 3 条 message_body 引用 `messages/*`，`blobs.list()` 中 `messages/` 前缀条目 **0**；`probe3.mjs` B4 —— 路径形状不是 `blobs/…`。
- 影响：`data.md` §4 明确「创建用户消息时先存正文blob再在接受消息的事务内写message_body」；当前消息正文只有哈希、没有内容，`message.bodyRef` 指向的行无法回读 → AC-084「普通消息可用 message_body 存储」不成立，AC-001 的「回答/来源」也无从持久化。`message_body` 表另无可从别处重建正文的来源。
- 最小修复：`AttachmentService`/`ArtifactService` 同源地把正文写入 `BlobStore`（`blobs.write(body)`），用返回的 `relativePath` 落库；`sendMessage` 需要注入 `BlobStore`，并补一条「发送后正文可回读且哈希一致」的测试。

### W3-05 [P1，阻断] 上传到不存在的 conversation 返回 500（FK 约束以原生异常穿透）

- 位置：`packages/core/src/attachments.ts:68-105`（`stage` 不校验 conversation 存在）；`apps/daemon/src/server.ts:281-286`；`apps/daemon/src/server.ts:296-331`（非 `ProtocolError`/`HttpError` 一律 500 `INTERNAL_ERROR`）；对照 `packages/storage/src/schema.ts:416-417`（`conversation_id … REFERENCES conversation(id)`）
- 复现（`probe.mjs` P5、`probe2.mjs` A9）：`POST /artifacts/upload`（multipart `conversationId=018f2c1e-9a4b-7c3d-8e5f-000000000000`）→ `500`，`{"code":"INTERNAL_ERROR","message":"attachment: FOREIGN KEY constraint failed"}`。
- 影响：客户端输入错误被报为服务端内部错误，`protocol.md` §7 的错误表被绕过；且上传已过认证/CSRF，写入了临时文件后才在落库时失败，无法给出可操作的 `VALIDATION_ERROR`。同类「未校验归属/存在性」的上传还允许向**已归档 conversation** 上传（`probe3.mjs` B3：send=400、upload=201），产生永远无法绑定的 staged 残留。
- 最小修复：`stage` 前校验 conversation 存在且未归档（`INVALID_STATE`/`NOT_FOUND`）；存储层异常在 daemon 边界统一映射为 `ProtocolError`，禁止把 `Error.message` 直接回显（当前 500 分支会回显内部消息）。

### W3-06 [P2，阻断判定：影响 AC-002] 失效（invalid）产物仍可预览与下载

- 位置：`packages/core/src/artifacts.ts:132-148`（`get` 不检查 `validity`）、`:180-196`（`read` 不检查）；`apps/daemon/src/server.ts:103-118`/`:119-137`/`:222-240`
- 复现：`probe.mjs` P20 —— `invalidate()` 后 `GET /preview` 仍 `200`；`probe2.mjs` A1 —— 失效后 `download.prepare` 与新 token 下载均 `200`。
- 影响：`experience.md` §3 要求产物卡片显示「有效/失效」且「历史审批只针对该版本，过期审批返回冲突并刷新」；`protocol.md` §7 把 `STALE_ARTIFACT` 列为需要「重建证据」的错误。失效产物的字节继续可读削弱了失效语义（旧版本保留是契约要求，但需要客户端能区分；当前响应无 validity 字段、无 `STALE_ARTIFACT`）。
- 最小修复：preview/prepare 对 `validity=invalid` 返回 `STALE_ARTIFACT`（或在响应中显式携带 `validity` 与 `invalidReason` 并让 UI 标注），历史版本的显式读取保持可用。

### W3-07 [P1，阻断] AC-006 混合意图未实现：一条消息只创建一个 Work，无拆分与关联

- 位置：`packages/core/src/messages.ts:107-110`（`input.targetWorkId === undefined` 时只 `createAssistWork` 一次）；`packages/core/src/messages.ts:209-245`
- 证据：全仓库无按意图拆分 Work 的实现（`grep -rn "拆分\|mixed\|multiple work" packages apps` 仅命中 `packages/core/test/join.test.ts:290` 的不相关用例）；无 AC-006 测试；`implementation.md` 未提及拆分。
- 影响：AC-006 要求「关联多个Work，各自范围和输出独立，解释可先返回」；`workflow.md` §1 也要求「混合消息拆多个Work分别绑定相同来源和各自范围」。本包是该行为的归属包（plan T5 显式映射 AC-006），当前无实现、无测试。
- 最小修复：在消息接受事务内按意图拆分（至少 `assist/artifact` 与 `delivery` 分离），每 Work 携带同一 `sourceMessageId`/`sourceRef` 与独立 Scope；补一条「一消息 → 两个关联 Work、解释 Work 先完成」的测试。

### W3-08 [P1，阻断] 用户消息不创建 Authorization 记录：delivery 路线无法获得范围授权

- 位置：`packages/core/src/messages.ts:229-244`（Work 只有 `sourceRef`，无 `authorizationRef`）；`packages/core/src/orchestrator.ts:786-810`（`authorizationRef === undefined` 时对 L1/L2/L3 抛 `NOT_AUTHORIZED`）；全仓库无 `store.authorizations.insert`（`grep` 仅命中 orchestrator 的读取）
- 影响：AC-005「原消息作为范围授权，范围内无重复确认」要求在评估前存在可校验的 Authorization 记录（`data.md` §2 `authorization` 表「仅来源为用户消息/动作」）。当前链条在 `assess` 处即被拒，L1 升级路径（`workflow.md` §2「升级保持同Work和已有证据…以原执行授权激活原范围」）同样不可达。
- 最小修复：消息接受事务内（或 Chief 首轮评估内）按消息 Scope 写入 Authorization，并把 id 写到 `work.authorizationRef`；补一条「明确修复目标的消息 → assess 通过且 authorizationRef 指向该消息来源」的测试。

### W3-09 [P2] 下载 token 只增不减：`prune()` 从未被调用，且 token 存于进程内存

- 位置：`packages/core/src/preview.ts:105-148`（`prune` 定义、无调用方）；`apps/daemon/src/server.ts:129`（`tokens.issue`）
- 证据：`grep -rn "prune(" packages apps` 在 `preview.ts` 之外无命中；`consume` 只在被使用时删除。
- 影响：长期运行的 daemon 内存单调增长；重启丢失全部未消费 token（60s TTL 内可接受，但要有明确的过期清理而非依赖进程退出）。
- 最小修复：在 `issue`/`consume` 内顺带清理过期项，或由 daemon 定时调用 `prune()`；同时把「单实例内存 Map」的限制写进 `implementation.md` 的诚实边界。

### W3-10 [P2] 已归档 conversation 仍接受上传，产生无法绑定的 staged 残留

- 位置：`apps/daemon/src/server.ts:262-294`（upload 只校验 `conversationId` 存在性由 FK 兜底，不检查 `archived`）；对照 `packages/core/src/messages.ts:88-92`（send 拒绝归档会话）
- 复现：`probe3.mjs` B3 → `send=400`、`upload=201`。
- 影响：AC-076/AC-084 的「无残留引用」在归档路径被绕过；这些附件在 24h 内不会自动清理（`expireStale()` 无调用方，见 W3-11）。
- 最小修复：upload 校验 `conversation.archived === false`，或允许上传但在 send 时明确 `INVALID_STATE` 并同步清理；对齐 send 的错误码。

### W3-11 [P2] `expireStale()` 无调用方：24h 过期只在绑定/删除时被动生效

- 位置：`packages/core/src/attachments.ts:204-226`；全仓库无调用（`grep -rn "expireStale" packages apps` 仅定义处）
- 影响：`protocol.md` §5「24h到期无绑定即清理」没有执行者；过期行长期保持 `staged`，`blob` 也随 W3-10 一起沉淀。虽然 `bind` 会在绑定时用 `expiresAt` 拒绝（P14 通过），但「清理」语义未实现。
- 最小修复：由 ProjectRuntime/daemon 定时调用并把清理结果记事件；或在 `list`/`bind` 路径做惰性过期并注明。

### W3-12 [P2] 错误响应缺少 `protocol.md` 规定的响应封装

- 位置：`apps/daemon/src/server.ts:296-331`（`{ok:false,error:{…}}`）；对照 `docs/architecture/protocol.md` §1（`{v:1,type:'response',id,ok:false,error:{code,message,retryable,details}}`）
- 影响：HTTP 面在 WP-03 内被当作协议面使用，但错误体没有 `v/type/id`，也没有 `details`（`ProtocolError.details` 被丢弃，`errors.ts` 的 `toBody()` 未被使用）；WP-04/WP-09 接线时需要统一，否则客户端错误处理会出现两套形状。
- 最小修复：错误体走 `errorResponse(id, error)`/`toBody()`，或明确声明 HTTP 面的错误形状并让后续包在同一处转换。

### W3-13 [P3] 记录与代码不一致：契约命令计数、`cmds.log` 陈旧、测试文件数

- 位置：`implementation.md:46`（「`pnpm build` 7 workspace」实际 9；「daemon 9 例真实 HTTP」与实际 9 例一致）；`cmds.log`（**untracked** 且为 WP-03 之前的旧输出：unit `17 files/233 tests`、build 7 工程、无 daemon）
- 影响：`cmds.log` 位于仓库根却不被 git 跟踪，内容会误导后续读者把它当作 WP-03 证据；`implementation.md` 的 workspace 数与实测不符。
- 最小修复：删除或更新 `cmds.log`（或纳入 `.gitignore` 并说明），把实现记录的计数改为 9 workspace。

### W3-14 [P3] 预览隔离的浏览器级攻防未在包内验证，且下载路径无隔离头

- 位置：`plan.md:55`（诚实登记「真实浏览器执行属 WP-10」）；`apps/daemon/src/server.ts:232-238`（download 只发 `content-type/content-disposition/cache-control/nosniff`）
- 影响：AC-052 的证据要求是「浏览器攻击样例」；本轮只能验证响应头与策略常量，无法复验 iframe 内实际执行结果。下载路径按设计应为附件下载，但当前无 `content-security-policy`/`x-content-type-options` 之外的显式隔离声明，若 BFF 将来以同源方式打开会绕过预览策略。
- 最小修复：在 WP-04/WP-10 补一次真实无头浏览器负例（读 cookie/网络/父页/top navigation 四类），并为下载路径保留 `Content-Security-Policy: default-src 'none'` 之类的兜底头。

---

## 5. 计数与阻断判定

| 严重性 | 数量 | 编号 | 是否阻断 |
|---|---|---|---|
| P0 | 2 | W3-01、W3-02 | **阻断** |
| P1 | 5 | W3-03、W3-04、W3-05、W3-07、W3-08 | **阻断** |
| P2 | 5 | W3-06、W3-09、W3-10、W3-11、W3-12 | W3-06 因影响 AC-002 阻断；其余 5 说明不单独阻断 |
| P3 | 2 | W3-13、W3-14 | 不阻断 |

**未修好清单（本轮必须回 Develop 的项）**：W3-01、W3-02、W3-03、W3-04、W3-05、W3-06、W3-07、W3-08。

---

## 6. 回归与「同类模式」扫描

- **回归面**：WP-03 新增文件集中在 `packages/core/src/{artifacts,attachments,preview,messages}.ts`、`apps/daemon/**`、`packages/core/src/index.ts`；对既有 WP-02 行为的唯一改动点是 `identity.ts`（新增 `userIdFromSubject`）与 `core/index.ts` 导出。六条契约命令全绿，`packages/core/test/orchestrator.test.ts` 等 WP-02 用例未被削弱；未发现 AC-043..047/082 的回归。
- **同类模式扫描**：`grep -rn "插入/persist(… as never)"` 显示 `messages.ts`、`attachments.ts`、`artifacts.ts` 都以 `as never` 绕过共享 Schema 落库（`store.*.insert({...} as never)`）。这批写入都没有经过 `packages/contracts` 的 `strictObject` 校验，因此像 `relativeBlobPath` 这类语义错误只能靠数据库 `CHECK` 兜底 —— W3-04 正是这种「Schema 在但没被用」模式的产物。建议开发把「core 写入必须过共享 Schema」写成不变式（或由 repository 层统一校验），否则同类缺陷会继续出现。
- **归属校验扫描**：`stage/remove/bind/preview/prepare/download` 六处中，只有 `remove` 与 `bind` 有 owner 判定；`preview`/`prepare`/`download` 完全没有主体判定（W3-02），`stage` 完全没有 conversation 判定（W3-05）。

---

## 7. 其它观察（不计入 Finding）

1. `packages/core/src/preview.ts:88-90` 的 `requiresDownload` 无调用方；`server.ts:111` 用的是 `renderPreview` 的返回值，判定重复一份（维护点，非缺陷）。
2. `renderPreview` 对二进制 mime 也会 `Buffer.toString('utf8')`，但 `assertPreviewable`（`preview.ts:157-163`）已先拒绝非文本/JSON mime，P10 实测 400，行为正确。
3. `parseMultipart`（`server.ts:437-472`）只取第一个 `file` part，多文件上传会被静默丢弃；protocol 每次上传一个文件，可接受，但建议显式拒绝第二个 file part。
4. `GET /artifacts/download/:token` 对未知 token 返回 403（A11 通过），但 `serveDownload` 里 `consume` 先删除再判断过期，过期 token 无法二次探测，行为符合「单次消费」。
5. `CSP` 常量与 `execution.md` §6 逐字一致（`preview.ts:16-18` vs 文档 45 行），`sandbox` 为 `allow-scripts`（无 `allow-same-origin/forms/popups/downloads/top-navigation`），PASS 组断言与文档一一对应。

---

## 8. 剩余风险（未闭环，供 Settlement/产品方判断）

1. **真实浏览器攻防**（AC-052）：本轮只在 HTTP 契约层验证策略；iframe 内脚本实际能否读 cookie / 发起网络 / 访问父页，需 WP-10 用无头浏览器复验（W3-14 已登记）。
2. **多用户语义**：产品定位是「本机单用户工作台」，因此 W3-02 的「跨会话读他人产物」在单用户部署下危害有限；但 `protocol.md` 明确要求认证 + 对象 ACL，且安装凭证可被本机其他进程窃取，故仍按 P0 处理。若产品决定明确「单用户、单安装凭证」并把该假设写入 `requirements.md`，W3-02 的处置可从「实现主体 ACL」改为「显式记录已接受风险」——这属于产品决定，不应由 Review 自行降级。
3. **工具层 `artifact_write` 落库与真实 Provider 纵向**：按 `plan.md:12`、`implementation.md:48` 属 WP-07/WP-10；本包不评价，但 AC-001/AC-003 的完整证据依赖它们。
4. **`Docker`/隔离环境未用**：本轮为宿主机服务端 Review，未使用容器；`execution.md` §5 的「Review 源码只读、复制到隔离临时目录」约束在只读评审下无需触发（我未修改任何产品文件）。
5. **`cmds.log` 陈旧**（W3-13）：若后续结算把它当归档证据，会得出「WP-03 只跑到 233 例」的错误结论。

---

## 9. 能否进入独立 Test —— **不能**

- 依据 `docs/rules/workflow.md` §6：P0/P1 阻断；本轮 2×P0 + 5×P1 + 1×P2（影响 AC-002）全部未闭合。失败路由为 **`Blocking Review Finding → Develop → Independent Review`**，修复后必须由新的独立 Review 重新核验（不得由开发自证）。
- 建议的修复顺序（供开发参考，不改变 Review 判定）：W3-01/W3-02（安全边界，同时决定 AC-002/AC-052 的验收口径）→ W3-04（数据完整性，AC-084/AC-001）→ W3-03/W3-05（AC-084 可用性）→ W3-07/W3-08（AC-005/AC-006 需求缺失）→ W3-06/W3-09/W3-10/W3-11/W3-12（质量项）。
- 修复范围若触及产品语义（例如「单用户假设」的正式化、混合意图拆分的 UI 表现），按 `workflow.md` §2/§4 需先由产品角色落 Decision，不能在 Develop 内自行决定。

---

## 10. 方法与边界声明

- 独立上下文：未读取任何开发/Test 会话对话；结论只来自仓库文件、`docs/**` 契约与 `/tmp/wp03-review/` 下我自建的三个实验脚本（`probe.mjs` 20 项、`probe2.mjs` 11 项、`probe3.mjs` 4 项，共 35 项断言：**21 通过 / 14 失败**，失败项与本文 Findings 一一对应）。
- 未做：真实无头浏览器执行、真实 Provider 纵向、Docker 容器内复验。（另注：`execution.md` §47「校验大小、mime和文件签名」中的**文件签名校验在当前代码树中无实现**——`grep -rn "signature|magic" packages apps` 无产品命中；本轮未把它单列为 Finding，因为它不影响 WP-03 已映射的 9 条 AC，但应由 WP-04/WP-10 承接并显式登记。）
- 未改仓库：本轮只新增并覆盖写入 `.agentdev/work/WP-03/review.md`（本报告）；`git status --porcelain` 仅显示 `?? .agentdev/work/WP-03/review.md`，**tracked 文件零改动**，`HEAD` 仍为 `fd90fefd070c21aedeb4e437de6d1c7844b02725`（我在写入本报告前后各校验一次）。
