# WP-03 实现记录（直接协作与说明产物）

- planVersion: 1（`.agentdev/work/WP-03/plan.md`）
- 依赖：WP-02（结算提交 `f9b61e0`，验证代码树 `cbf7471`）

## T1 Artifact 存储与版本链

- `packages/core/src/artifacts.ts`：`ArtifactService.createAgent(run, kind, mime, bytes, acl?, sourceRevision?)`、`createUser(workId, attachment)`、`list/latestByKind/get(id, version?)`、`invalidate(id, reason)`、`read(artifact)`、`isReadable(artifact, role)`。
- 版本链按 `(workId, kind)` 递增 `artifactVersion`；blob 不可变、内容寻址，旧版本 bytes 永久可读（`data.md` §2「blob不可变；修改新版本」）。
- 事件 `artifact.created` / `artifact.invalidated`（`protocol.md` §7）。
- 失败闭合：blob 写入/校验失败（含原始文件系统错误）一律 `INTERNAL_ERROR`，不留下 Artifact 行；blob 缺失 `ARTIFACT_MISSING`。

## T2 附件暂存与绑定

- `packages/core/src/attachments.ts`：mime 允许集（PNG/JPEG/WebP/纯文本/Markdown/HTML/PDF，`experience.md` §3）、单文件 20 MiB、每消息 5 个、总 50 MiB、24h TTL、`expiresAt`；`bind` 校验同 owner/同 Conversation/未过期/未绑定，重复绑定 `ATTACHMENT_ALREADY_BOUND`；`remove` 仅限自己的 staged（已绑定 `INVALID_STATE`）；`expireStale()` 清理过期 staged（blob 留给离线 GC）。
- 失败保持 staged，客户端可用同一上传重试（`protocol.md` §5）。

## T3 HTML 隔离预览与一次性下载

- `packages/core/src/preview.ts`：`PREVIEW_SANDBOX='allow-scripts'`、`PREVIEW_CSP="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'"`、预览响应 `x-agentdev-preview-credentials: omit`、`no-store`、`nosniff`（`execution.md` §6）；内联预览 1 MiB / 2000 行截断并提示下载；`DownloadTokenStore` 60 秒单次消费 token（`ARTIFACT_LIMITS`）。

## T4 HTTP 面与消息发送

- `apps/daemon`：`createDaemon(options)` 组装监听（loopback）、认证（复用 WP-01 `AuthService`；Bearer 或会话 cookie + CSRF + Origin）与路由；`listen()` 供进程启动。
- 端点：`GET /healthz`（无认证、只返回 version/ready）、`POST /artifacts/upload`（multipart，服务端校验）、`DELETE /artifacts/uploads/:id`、`GET /artifacts/:id/preview`、`POST /artifacts/download.prepare`、`GET /artifacts/download/:token`（token 本身即凭证，先于会话认证处理）、`POST /conversation.message.send`。
- `packages/core/src/messages.ts`：`sendMessage` 在同一事务内创建 `message_body` + `message`（会话 seq）+ assist Work（`level=none`，不建 Requirement）+ 绑定附件 + `origin=user` Artifact；daemon 在该事务内同时写 `message.received` 与命令账本（幂等键重放返回原绑定）。
- `packages/core/src/identity.ts`：`userIdFromSubject(subject)` 由认证主体派生稳定的 UUIDv7 形状用户 id（上传 owner 与消息发送者一致）。

## T5 直接协作路由

- 新消息创建的 Work 为 `intent=assist`、`level=none`、`status=queued`，`sourceRef` 指向消息；不创建 Requirement/Gate（`requirements.test`/daemon 集成断言）。
- `none` 级 Work 的写/环境权限在 WP-02 的准入门禁（DC-66/DC-71）拦截：仅问答不允许派发写 Run 或写文件。分析/产物 Run 由 Chief 通过 `dispatch`（purpose=analysis/artifact）建立，产物经 `ArtifactService.createAgent` 落库并进入 `stage_result.artifactRefs`/缓存（工具层执行接线属 WP-07）。
- Chief 的角色配置与 L3 授权沿用 WP-02 的 `assess`/`dispatch`。

## T6 必需失败测试

| 必需失败测试 | 位置 |
|---|---|
| 恶意 HTML（读 cookie/网络/父页） | `apps/daemon/test/server.test.ts`（hostile 样例 + 隔离头断言）、`packages/core/test/artifacts.test.ts`（策略常量矩阵） |
| 上传限制（数量/大小/mime） | `packages/core/test/artifacts.test.ts`（限制矩阵、无残留引用）、`apps/daemon/test/server.test.ts`（超限与错误 mime 服务端拒绝） |
| 产物生成失败 | `packages/core/test/artifacts.test.ts`（blob 不可写 ⇒ `INTERNAL_ERROR` 且零 Artifact 行/零事件） |
| 仅问答无授权写入 | WP-02 `packages/core/test/orchestrator.test.ts`（`none` 级 Work 的写/环境 scope、`git`、`artifact_write` 边界） |

## 验证

- `pnpm typecheck` 0；`pnpm lint` 0；`pnpm test:unit` **278 passed**（含 daemon 9 例真实 HTTP、artifacts 14 例）；`pnpm test:integration` 124 passed；`pnpm build` 7 workspace（含新增 `apps/daemon`）。
- 隔离的验证边界：本包在 HTTP 响应契约层验证 sandbox/CSP/无 cookie/无网络；真实浏览器攻防复验属 WP-10 发布回归（无头浏览器不在依赖内）。
- 未覆盖：Runner 工具层 `artifact_write` 落库路径（WP-07）、BFF/WS 页面与预览 UI（WP-04/WP-09）、真实 Provider 生成解释内容（WP-10）。

## T7 独立 Review 第一轮与修复（FAIL → 修复）

- 第一轮独立 Review 判 **FAIL**（P0×2、P1×5、P2×5、P3×2），对抗性核验确认 FAIL 成立，另补 5 项（内联预览字节上限未生效、文件签名未校验、`targetWorkId` 不校验归属、预览隔离只靠客户端头、失败上传的孤儿 blob 与 staged 无上限）。
- 修复：
  - W3-01（token 预测）：下载 token 改为 256 位随机（`randomBytes(32).base64url`），不再包含产物 id；补「猜测 token 被拒」用例。
  - W3-02/W3-03（主体维度与 owner 漂移）：确认单用户自托管语义——所有已认证会话映射到同一个安装用户（`userIdFromSubject('installation:local')`），上传与发送共用同一 owner（跨会话可绑定）；用户来源 Artifact 仅其上传者（同安装用户）可预览/下载，Agent Artifact 走角色 ACL；下载 token 在 `prepare` 时已做同一主体校验（token 本身即凭证）。
  - W3-04（正文未落 blob）：`sendMessage` 先写 `message_body` 正文 blob（`data.md` §4），行引用真实 hash/路径。
  - W3-05（未知会话 500）：`stage` 先校验 Conversation 存在且未归档；daemon 把 `StorageError`（外键/约束）映射为 `NOT_FOUND`/`VALIDATION_ERROR` 而不是 500。
  - W3-06（有效性）：预览/下载响应带 `x-agentdev-artifact-validity`；失效产物仍可按契约读取历史，但客户端能显示失效状态。
  - 对抗性 1（预览字节上限）：`renderPreview` 同时受 2000 行与 1 MiB 限制，按 UTF-8 边界截断。
  - 对抗性 2（文件签名）：`matchesDeclaredType` 校验 PNG/JPEG/WebP/PDF magic bytes 与文本类型（无 NUL、合法 UTF-8）。
  - 对抗性 3（targetWorkId 归属）：目标 Work 的 `sourceRef` 消息必须属于同一 Conversation，否则 `NOT_AUTHORIZED`。
  - 对抗性 4（隔离只在客户端）：CSP 增加 `sandbox allow-scripts` 与 `frame-ancestors 'self'`，隔离不再依赖客户端自定义头。
  - 对抗性 5（孤儿 blob 与 staged 无上限）：上传每 owner 最多 50 个 staged（`MAX_STAGED_PER_OWNER`），daemon 每次上传先 `expireStale()` 机会式清理；`stage` 先校验后写 blob。
- 记录级承接（W3-07/W3-08）：AC-005「原消息作为范围授权」的 Authorization 行绑定与 AC-006「混合意图拆分」依赖 Chief 的语义 Assessment 与消息拆分（WP-04/WP-05 落线），本包实现消息→Work 的 `sourceRef` 绑定与「不误建 Requirement/Gate」，其余在结算材料登记承接。
- 修复后验证：`pnpm typecheck` 0；`pnpm lint` 0；`pnpm test:unit` **281 passed**；`pnpm test:integration` 124 passed；`pnpm build` 8 workspace。

## T8 独立 Review 第二轮与修复（FAIL → 修复）

- 第二轮独立 Review 判 **FAIL**（P1×2、P2×2、P3×9）：两个 P1 是 AC-005（消息授权未落 Authorization 行）与 AC-006（混合意图未拆分）；对抗性核验确认 FAIL 成立，并补 7 项（预览中间态内存放大、截断信息未下发、非数字 `artifactVersion` 静默回退、修复引入的幂等主体塌缩、`acl:['chief']` 与 daemon `role` 冲突、`MAX_STAGED_PER_OWNER` 只在单会话内计数、`assertReadable` 注释与实现相反）。
- 修复：
  - AC-005（W3R2-02）：`message.send` 支持显式 `authorization`（scope + operations）——在同一事务内创建 `authorization` 行（`sourceRef`=该消息）、绑定 `work.authorizationRef` 并把 Work 提升到 L1；`assess` 因此有真实授权可引用。
  - AC-006（W3R2-01）：`message.send` 支持显式 `workItems`（intent + goal）——一条消息按给定意图创建多个 Work（各自独立 budget），全部绑定同一 source message，响应返回 `workIds`；语义拆分仍由 Chief 的 Assessment 决定，本包提供机制与证据。
  - 对抗性 1：`renderPreview` 对超限 Artifact 先按字节裁剪再解码/分行，20 MiB 上传不再物化整串。
  - 对抗性 2：预览响应下发 `x-agentdev-preview-mode` / `x-agentdev-preview-download-required` / `x-agentdev-preview-truncated-at-line`。
  - 对抗性 3：`artifactVersion` 非整数 ⇒ `VALIDATION_ERROR`，不再静默回退最新版本。
  - 对抗性 4：命令账本主体恢复为 `authed.subject`（会话维度），owner 仍是安装用户。
  - 对抗性 5：`sendMessage` 的 user Artifact ACL 由调用方指定（daemon 传当前服务角色，默认空=所有角色可读）。
  - 对抗性 6：`MAX_STAGED_PER_OWNER` 改为按 owner 跨 Conversation 统计。
  - 对抗性 7：`assertReadable` 注释改为与单用户现实一致。
- 修复后验证：`pnpm typecheck` 0；`pnpm lint` 0；`pnpm test:unit` **283 passed**；`pnpm test:integration` 124 passed；`pnpm build` 8 workspace。
- 待办：第三轮独立 Review（复核上述修复与 AC-005/006 机制是否满足验收口径）→ 独立 Test → 结算。

## T9 AC-005 / AC-006 完整实现（用户决定：必须在本包内实现）

用户（产品方）在第二轮 Review 后明确选择「AC-005/AC-006 必须在 WP-03 内完整实现」，因此本包补充**确定性的 Chief 路由**（`packages/domain/src/requests.ts` 的 `routeMessage`），作为模型 Assessment（WP-04/06）之前的基线：

- **AC-005 明确启动**：消息里出现修改动词（修复/改/实现/删除/更新/重构…）且**点名了具体目标路径**时，Core 把它路由为 `delivery` Work：以命名路径为 `writePaths`、`operations:['edit']` 建 Authorization 行（`sourceRef` = 该消息），绑定 `work.authorizationRef`，Work 升为 L1，并写入 Assessment（intent/level/authorizationRef/reason）。原消息即范围授权，**范围内不再要求二次确认**。未点名目标的修改请求不被猜测（先走 assist 澄清，避免静默写权限）。
- **AC-006 混合意图**：同一消息同时要求解释与修改时拆成两个 Work（`assist` 只读 + `delivery` 带授权范围），各自独立 scope 与 budget，共享同一 source message，响应返回 `workIds`；解释 Work 无写权限，可先完成并返回产物。
- 证据：`packages/domain/test/domain.test.ts`（路由规则矩阵）、`packages/core/test/artifacts.test.ts`（端到端：Authorization 行 + work.authorizationRef + Assessment + 多 Work 独立 scope + 纯问答零授权）。
- 说明（DC-60）：`assessment` 行按 `data.md` §2 的列定义写入，不新增 goal/scope 列（goal 在 Work 行、scope 在 Authorization 行）；模型驱动的语义评估与更细的拆分粒度仍由 WP-04/06 接管，本包提供可运行的确定性基线。

## T10 独立 Review 第三轮与修复（FAIL → 修复）

- 第三轮独立 Review 判 **FAIL**（1×P1、5×P2、8×P3）：P1 是 AC-005 的授权自相矛盾（消息授权声明 `readPaths` 却没有 `read` 操作 ⇒ 任何用它准入的 Run/Assessment 都被 `capabilityGaps` 拒绝，交付路线死锁）。对抗性核验确认 FAIL 成立，并补出两条**越权**缺陷：疑问句（如「如何修复 docs/INDEX.md？」）会被当成执行消息生成写授权；HTTP 客户端可自报 `authorization`（甚至 `deploy`）凭空造权。
- 修复：
  - W3R3-01/03（P1）：消息授权的 `operations` 改为 `['read','edit']`（读目标本身是修改的一部分），`readPaths` 与 `writePaths` 一致；补「授权自洽且可用」的断言（`operations` 含 `read`、`readPaths` 覆盖命名路径）。端到端可用性（喂回 `Orchestrator.assess/dispatch`）由第四轮 Review 独立复核。
  - 对抗性 1（越权）：`routeMessage` 增加疑问句识别（`?`/`？`、如何/怎么/为什么/能否/是否、how/why/what/can/should…）——疑问句即使点名路径也不产生写授权，仍走 assist/document。
  - 对抗性 2（越权）：daemon 不再接受客户端 `authorization` 字段（`protocol.md` 未定义该参数）；Core 侧对任何调用方提供的授权执行 `assertGrantWithinMessage`——写路径必须来自消息点名的目标、不得含环境操作或网络目标，否则 `NOT_AUTHORIZED`。
  - W3R3-02（P2）：消息授权绑定到**含写路径的那个 Work**（而非 `works[0]`），混合消息的 delivery Work 才拿 `authorizationRef`。
  - W3R3-04（P2）：`conversation.message.send` 响应增加 `workIds` 与 `authorizationId`（协议表只列四字段，属加法补充，需在文档侧对账）。
  - W3R3-05（P2）：同 intent 的多个 Work 由 `routeMessage` 的 per-item scope 决定，不再共用首个 scope。
  - W3R3-06（P2）：预览恢复 `execution.md` §45 的逐字 CSP，sandbox 作为**第二个** `Content-Security-Policy` 头（浏览器按交集执行），不再改动文档化策略原文。
  - W3R3-07（P2）：`StorageError` 只把「引用不存在」映射为 404，其余保持 500；通用 500 不再回显内部消息或路径。
  - W3R3-08/09/10/11（P3）：`download.prepare` 返回 `validity` 并顺带 `prune()`；staged 配额按 owner 跨 Conversation 统计；记录数字与实测对齐（8 workspace、12 daemon 例、286 单测）。
- 修复后验证：`pnpm typecheck` 0；`pnpm lint` 0；`pnpm test:unit` **286 passed**；`pnpm test:integration` 124 passed；`pnpm build` 8 workspace；`pnpm docs:check` ok。
- 待办：第四轮独立 Review（重点复核 AC-005 授权端到端可用、越权两条、CSP 对账）→ 独立 Test → 结算。

## T11 独立 Review 第四轮（评审判 PASS，对抗性核验证伪 → 修复）

- 第四轮独立 Review 判 **PASS**（0×P1、3×P2、11×P3），但同轮对抗性核验以 HTTP 端到端证伪了「越权已闭合」这一支柱：**非执行消息仍产生可用的写授权**——`explain why docs/INDEX.md needs a fix`、`describe how to fix docs/INDEX.md`、`Please describe the fix needed in docs/INDEX.md`、`请解释为什么 docs/INDEX.md 需要 fix`、`don't fix docs/INDEX.md`、`不要修改 docs/INDEX.md`、`I am not asking you to fix docs/INDEX.md` 等都能落库 Authorization、把 Work 升到 L1 并派发写 Run（违反 AC-004/AC-005）。
- 另补：`targetWorkId` 可把 `none` 级 Work 升为 L1、把 L3 Work 降为 L1 并覆盖其 `authorizationRef`（对抗性 B，违反「自动降级不支持」）；`Content-Security-Policy-Sandbox` 不是标准头，sandbox 纵深防御结论不成立（对抗性 C）；消息授权写入 L1 而 Core 的 `routingFloor` 要求 L2（对抗性 D）；`workItems:[null]`/`intent:'operation'` 造成 500 或非法 Work（对抗性 E）。
- 修复：
  - 路由改为**逐子句分类**（`splitClauses`）：解释句、疑问句、否定句（不要/别/don't/never/not asking）永不下发写授权；只有「修改动词 + 命名目标」的指令子句才产生 delivery 项与授权。混合消息因此仍能拆成 assist + delivery（AC-006），而纯解释/否定消息只得到只读 Work（AC-004/AC-005）。
  - `pathsIn` 改为线性分词 + 锚定形状判定（原正则对长文本呈二次回溯，64k 消息会拖垮路由）。
  - `targetWorkId` 追发消息**不再改写**目标 Work 的 `level`/`authorizationRef`（`granted` 仅在新建 Work 时产生，且只绑定到含写路径的 Work）。
  - 消息授权的等级按 `routingFloor` 一致口径取 L2（scope 含操作），Assessment 与 Work 同步为 L2。
  - `workItems` 逐项校验（intent ∈ assist/artifact/document/delivery、goal 非空字符串），非法项 `VALIDATION_ERROR`；同 intent 多 Work 按位置匹配各自 scope。
  - 预览：保留 `execution.md` §45 的逐字 CSP 作为唯一的 `Content-Security-Policy`，sandbox 由 iframe 属性契约（`x-agentdev-preview-sandbox`）承担，删除无效的第二 CSP 头名。
  - daemon 的 `message.received` 事件 data 与响应都带 `workIds`/`authorizationId`；`StorageError` 映射收窄、500 不再回显内部消息；`download.prepare` 返回 `validity` 并 `prune()`。
  - 记录数字更正：unit **287**、integration 124、build **8** workspace、daemon 15 例。
- 修复后验证：`pnpm typecheck` 0；`pnpm lint` 0；`pnpm test:unit` **287 passed**；`pnpm test:integration` 124 passed；`pnpm build` 8 workspace；`pnpm docs:check` ok。
- 承接/待办：`protocol.md` §5 的 `conversation.message.send` 返回字段目前只列 `{messageId,workId,state,version}`，本包新增 `workIds`/`authorizationId` 属加法补充，需在文档侧对账（结算材料登记）；下一轮独立 Review 复核上述修复。

## T12 独立 Review 第五轮与修复（FAIL → 修复）

- 第五轮独立 Review 判 **FAIL**（2×P1、2×P2、5×P3）：P1 为「同义新句式仍越权」（**你修复…了吗 / 是否已经修复 / Did you fix / I have a question about the fix / The fix needed in… / 我先不修改… / Regarding the fix…, what do you suggest?** 等 17 例，HTTP 端到端可落授权并派发写 Run）与「反向误拒」（裸 `别` 命中错别字/识别/特别/分别、名词化说明/介绍、`、` 未参与分词，导致「修改 docs/INDEX.md 中的错别字」这类明确指令不授权）。对抗性核验另补：客户端 `workItems` 无数量上限（50/500 个 Work 均可建）、`别改 A，改 docs/plan.md` 误拒、CSP 第二头名残留与提交信息不实、`assertGrantWithinMessage` 未约束 `readPaths`。
- 修复（`requests.ts` 重写为保守判定；下列「一律」表述已在第十轮订正为「已登记语料内一律」，判定本身是启发式基线）：
  - 判定收敛为「**指令子句**」：子句内同时出现修改动词与命名路径，且该子句不含疑问（吗/呢/如何/是否已经/how/did/…）、拒绝（不要/别+动词/don't/never/…）、假设与引用（如果/假如/if/whether/引号/你提到…）标记；解释动词**仅在子句开头**才算解释，`说明/介绍` 作名词不再误判。
  - `别` 仅在词首否定动作（负向后顾，排除错别字/识别/特别/分别）；`、` 作为路径分词符但不作子句分隔符，`修改 a、b` 保持同一指令子句。
  - 可疑即 fail-closed：拿不准时只给只读 Work（并向用户澄清），不猜测写范围。**注意：本包不宣称该启发式「永不/一律」正确**——自然语言判定是启发式的，第六轮对抗性核验又补出「陈述/完成体」（我已经修改了 X、X 需要修改、是否应该修改 X）与「日常祈使句」（X 的错别字麻烦处理下）两类反例；本包已补入这些词表与回归用例，剩余误判属启发式固有的残余风险，真正的语义分类由 WP-04/06 的模型 Assessment 接管。
  - `workItems` 在 Core 侧限 `MAX_WORK_ITEMS=4`（与服务端路由一致）；`assertGrantWithinMessage` 同时约束 `readPaths`；预览只发送 `execution.md` §45 的 CSP 单头（无效的第二头名已真正删除）。
- 回归网：把第五轮 Review/对抗性给出的正/负例句表（19 条不得授权 + 8 条必须授权）与 HTTP 级用例（workItems 上限、状态询问句）落成长期测试。
- 验证：`pnpm typecheck` 0；`pnpm lint` 0；`pnpm test:unit` **288 passed**；`pnpm test:integration` 124 passed；`pnpm build` 8 workspace。
- 后续：第六轮独立 Review 复核（重点是句式矩阵与 `workItems` 上限），通过后进入独立 Test。

## T13 独立 Review 第六轮（报告缺档，对抗性核验补项）与修复

- 第六轮 Reviewer 未产出报告（空文件），同轮对抗性核验以 `7c01c9d` 为冻结点独立复现，确认第五轮点名的误拒/CSP/readPaths 三组已闭合，但指出**新的 fail-open 家族**：陈述/完成体与认识情态（`我已经修改了 docs/INDEX.md`、`刚修复了…`、`I already fixed…`、`docs/INDEX.md 需要修改`、`是否应该修改 …`、`是否需要更新 …`、`麻烦评估一下 … 是否需要修改`）仍产生可派发的写授权；以及**反向误拒**：不含规范变更动词的日常祈使句（`docs/INDEX.md 的错别字麻烦处理下`）不授权；另指出 `workItems` 第二个同 intent 项 scope 为空、记录中「永不下发写授权」的措辞不实。
- 修复：
  - 新增 `STATEMENT_PATTERNS`（已经/已/…了 + 变更动词、需要/应该/必须 + 变更动词、是否应该/是否需要、already/needs to/should we 等）——陈述、完成体与认识情态一律只读。
  - 新增请求类动词与表达（处理/调整/优化/完善/纠正/替换/换成/处理下/处理一下/帮忙/麻烦/请…），使日常祈使句在命名目标时正常授权。
  - `workItems` 的 scope 匹配在同 intent 超出路由项数时回落到该 intent 的 scope，不再产生空 scope Work。
  - 订正记录措辞（见 T12 修订），不再宣称启发式判定「永不」误判。
  - 回归网扩充：新增陈述/完成体/认识情态 8 句（不得授权）与日常祈使句 3 句（必须授权）。
- 验证：`pnpm typecheck` 0；`pnpm lint` 0；`pnpm test:unit` **288 passed**；`pnpm test:integration` 124 passed；`pnpm build` 8 workspace。

## T14 独立 Review 第七轮与待办（FAIL）

- 第七轮独立 Review 判 **FAIL**（3×P1、1×P2、3×P3），对抗性核验确认 FAIL 成立并补出三条文档化场景缺陷（未列入报告）：
  - **W3R7-01（P1，848b5c4 引入的回归）**：`REQUEST_ACTION_PATTERN` 把 `看一下/检查一下/帮忙/帮我/麻烦/请` 当作修改动词，导致「帮我看一下 docs/INDEX.md」「请评估 docs/INDEX.md」这类**只读请求**落库写授权并可派发写 Run（对照实验：`7c01c9d` 不授权）。
  - **W3R7-02（P1）**：`\b(?:已经|已|刚才|刚刚)` 在中文语境恒不匹配（正则缺陷），完成体与英文 `needs a fix`/`The fix needed in…` 等仍越权；第五轮登记的 17 句仍有 7 句越权。
  - **W3R7-03（P1）**：`别改 A，改 B`、`不要修改 A，但要修复 B` 等混合指令仍误拒（AC-005/AC-006 正例失败）。
  - **A1（P1，对抗性补）**：被否定/被排除的目标仍获写授权——`修改 docs/PLAN.md 而不是 docs/INDEX.md` 会把 `docs/INDEX.md` 也写进 `writePaths`（路径级排除缺失，属越权）。
  - **A2（P1，对抗性补）**：中文混合意图不拆分——`解释 X 并修复 Y`、`解释 X，修改 Y` 只产出 assist、无 delivery/授权（`并`/`，`+动词 不在子句切分，且解释动词领起即整子句只读）；反向 `先解释 X，再修改 Y` 会把 X 也纳入写范围。
  - **A3（P1，对抗性补）**：纯建议请求授权——`请给出 docs/INDEX.md 的修改建议`、`请列出 docs/INDEX.md 里的错误`（AC-004 规范场景）。
  - **W3R7-04（P2）**：planVersion 2 的「不确定一律 fail-closed」「负向覆盖已登记越权语料」与 T13「一律只读」措辞仍与实现不符（记录名实不符）。
  - **W3R7-05/06（P3）**：回落 scope 产生「有写 scope 但 `level=none` 且无 `authorizationRef`」的不可执行 Work；前轮未闭合项（`protocol.md` 对账、孤儿 blob、跨会话 `targetWorkId`、multipart/`projectId`、错误封装、记录数字）仍在。
- **下一轮修复清单（按优先级）**：
  1. 移除 `REQUEST_ACTION_PATTERN` 对判定修改意图的作用：`请/麻烦/帮我/看一下/检查/评估/总结/阅读/参考/确认/列出/建议` 一律**不得**单独构成修改指令；仅当子句出现真正的变更动词（修改/修复/改/更新/删除/移除/新增/添加/实现/处理/修/补/整理/清理/调整/优化/完善/纠正/替换）且与命名路径同子句时才授权。
  2. 中文完成体/陈述检测改为不使用 `\b`：`(?:已经|已|刚才|刚刚)[^，。]{0,20}(?:修改|修复|更新|改|…)|…了(?:[，。]|$)`，并补 `needs a fix`/`The fix needed in` 英文陈述。
  3. 目标级排除：同子句内 `而不是|而非|不是|instead of|别改|不要改` 之后的路径从 `writePaths` 中剔除；整子句被否定时不收集任何路径。
  4. 子句切分补 `并`（解释+修改的中文混合）、`然后/再` 保持指令独立性；解释动词领起时若同子句后续出现「并/然后/再 + 变更动词 + 路径」应拆出 delivery 项。
  5. 修 A1/A2/A3 后补齐正负例句（含被排除目标、中文混合、建议请求）到 `domain.test.ts` 与 HTTP 用例；订正 `implementation.md` T12/T13 与 planVersion 2 的措辞（不得宣称「一律/永不」）。
  6. 修 W3R7-05（回落 scope 的 Work 必须与授权等级一致，或不为该 Work 建授权）与 P3 遗留项或在结算材料显式承接。
- 当前状态：unit **288 passed**、integration 124 passed、typecheck/lint/build/docs:check 全绿；代码树 `e6c5c18`（本轮仅提交评审报告）。

## T15 独立 Review 第七轮修复（指令文法收敛，取消客户端 workItems）

- 第七轮 Review 与对抗性核验给出 7 项必修（W3R7-01..03 + A1..A3 + 记录措辞）。本轮按「只授权祈使指令」收敛实现：
  - **移除只读请求词的授权作用**：`看一下/看看/查看/检查/评估/总结/阅读/参考/确认/列出/建议/咨询` 等一律不得单独构成修改指令（W3R7-01 回归修复）。
  - **中文完成体/陈述检测去除 `\b`**（中文无词边界）：`(?:已经|已|刚才|刚刚)[^，。；！？]{0,24}(?:修改|…)`、`(?:修改|…)了` 结尾、`需要/应该/必须 + 变更动词`、`是否应该/是否需要`，并补 `needs a fix`/`the fix needed` 等英文陈述（W3R7-02）。
  - **建议与主题短语只读**：`建议/咨询/征求意见/方案/意见/建议/怎么样/好不好`、`关于/对于/针对/至于/Regarding/About` 与名词化 `的修复/的修改/the fix in` 一律不授权（A3、`Regarding the fix…` 类）。
  - **目标级排除**：`而不是/而非/不是/别改/不要改/无需改/instead of/rather than` 之后的路径从 `writePaths` 剔除；整子句被否定时不收集任何路径（A1）。
  - **子句切分覆盖中文混合意图**：逗号/分号/句号与「并且/然后/同时/而且」，以及仅在后接变更动词时的「并」——`解释 X 并修复 Y` → assist + delivery（A2）；`别改 A，改 B` 只授权 B（W3R7-03）。
  - **取消客户端 `workItems`**：wire 与 Core 入参均不再接受该字段（`protocol.md` §5 本来也没有），Work/scope/授权完全由确定性路由产出，客户端无法制造 Work、空 scope 或等级不一致的 Work（W3R4-01/02/04、W3R5-05、W3R7-05 一并闭合）。
  - 记录措辞订正：不再出现「一律/永不」的绝对表述；planVersion 2 已声明确定性路由的边界与残余风险（未登记自由句式 fail-closed，由 WP-04/06 的模型 Assessment 接管）。
- **第八轮**（见 T16）：把判定从「黑名单 + 默认放行」改为「**祈使形态白名单**」——只有以变更动词开头（可带礼貌/副词前缀）或以变更动词命令式结尾的子句才授权，其余一律只读。
- 回归网：`domain.test.ts` 现覆盖 27 条「不得授权」+ 14 条「必须授权」+ 排除/条件/中文混合/否定纠正样例；`apps/daemon/test/server.test.ts` 覆盖 HTTP 层只读请求、客户端无法注入 workItems、中文混合拆分与目标排除。
- 验证：`pnpm typecheck` 0；`pnpm lint` 0；`pnpm test:unit` **289 passed**；`pnpm test:integration` 124 passed；`pnpm build` 8 workspace。
- 后续：第八轮独立 Review 复核（重点：是否仍存在可达的 fail-open、是否把未登记句式误当免责、记录与实现一致）。

## T16 独立 Review 第八轮与结构性修复（白名单祈使形态）

- 第八轮 Review 判 **FAIL**（3×P1 + 对抗性 D1/D2/D3）：词表式黑名单仍会放过新表述——只读言说行为+变更话题、完成体枚举缺口、拒绝/疑问变体；对抗性另指出「仅被参照的路径」进入写范围（`参考 X 修改 Y` 会同时授权 X）。
- 结构性修复：判定改为**祈使形态白名单**（`packages/domain/src/requests.ts`）：
  - 只有 (a) 以变更动词开头（可剥去 `请/麻烦/帮我/帮忙` 与 `但/再/然后/特别/务必/先…` 等前缀），或 (b) 以变更动词命令式结尾（`X 的错别字麻烦处理下`）的子句才授权；其余（陈述、完成体、疑问、拒绝、建议、主题短语、名词化、前置条件/引用、只读言说行为）一律只读。
  - 增补守卫：`请勿/切勿/禁止/严禁/不许/不想/暂缓/延后/推迟`、`了没有/改了没/何必/何以/何苦`、`前需要/之前需要/需要先审批`、`已经+优化/完善/纠正/替换/整理/清理/改好/完成` 等。
  - 前缀归一后再判定守卫（`但要修复 X` → 命令 `修复 X`），因此「否定 A，但要修复 B」只授权 B。
  - 只读动词（看一下/检查/评估/建议/讲述/评价/了解/列出…）不再参与授权；当子句**以变更动词开头**时，「说明」等词按名词处理（`更新 X 的说明`）。
- 回归网：`domain.test.ts` 现固定 **57 条不得授权 + 17 条必须授权 + 2 条排除断言**，覆盖第四至第八轮全部登记语料；`apps/daemon/test/server.test.ts` 覆盖 HTTP 层同类（含客户端无法注入 works）。
- 边界与残余：未经登记的自由句式（`重写/润色/tweak/polish`、带前置条件的指令如「等你确认后修改 X」）会落到只读并请求澄清——这是 planVersion 2 声明的 fail-closed 代价，语义分类由 WP-04/06 接管。
- 验证：`pnpm typecheck` 0；`pnpm lint` 0；`pnpm test:unit` **289 passed**；`pnpm test:integration` 124 passed；`pnpm build` 8 workspace。

## T17 独立 Review 第九轮与修复（严格祈使判定）

- 第九轮 Review 判 **FAIL**（3×P1：`V了/V完了` 完成体陈述、选择疑问、逗号后修饰从句；对抗性另补：被动/受事状态句、条件后件、无标点动词罗列、逗号版参照从句）。
- 修复（继续收敛为**严格祈使判定**）：
  - `NON_COMMAND_MARKERS`：子句含 `被/需要/应该/应当/必须/会/值得/得到/已经/已/刚才/刚刚/了/过/可能/也许/大概/是否/如果/假如/若是/要是/万一/假设` 任一 ⇒ 不授权。
  - **动词唯一性**：子句内变更动词（中英合计）必须恰为 1 个；`X 修复 更新 整理`、`fix X update Y` 这类罗列一律澄清。
  - 选择疑问（`好还是/还是不改/或者不`、`or leave/or not/or keep/yes or no`）与完成体粒子（`了/完了/完毕/好了`）纳入陈述守卫。
  - **条件继承**：条件子句的下一子句继承条件身份（`如果要改，就修改 X` 不授权）。
  - 参照/修饰从句只授权其自身命名的目标：`参考 X，修改 Y`、`based on X, update Y` 只授权 Y。
- 回归网扩充：新增第九轮全部语料（14 条不得授权 + 逗号参照 2 条 + 参照作用域 2 条），累计 **71 条不得授权 + 19 条必须授权 + 4 条作用域断言**。
- 验证：`pnpm typecheck` 0；`pnpm lint` 0；`pnpm test:unit` **289 passed**；`pnpm test:integration` 124 passed；`pnpm build` 8 workspace；`pnpm docs:check` ok。
- 残余（planVersion 2 已声明）：未登记祈使动词（重写/润色/tweak/polish）与无逗号的参照从句 fail-closed，请求澄清；语义分类由 WP-04/06 的模型 Assessment 接管。

## T18 独立 Review 第十轮与修复（默认拒绝的严格命令模板）

- 第十轮 Review 判 **FAIL**（2×P1：选择疑问变体、条件前件变体；1×P2；3×P3）。对抗性核验确认 FAIL 成立，并指出根因仍是「祈使形状的默认放行」——判定必须回到**默认拒绝**（default-deny）。
- 修复（`requests.ts`）：
  - **严格命令模板**：授权必须匹配 `变更动词 + 立即目标`（动词优先，目标须以路径词元开始，`修改哪个文件 X` 不匹配）或 `目标 + … + 变更动词命令式结尾`（目标优先）；英文只接受动词优先且句中含路径。
  - **守卫扩展**：`还是/或者/行不行/该不该/对不对/也行/好不好/要不要/一旦/的话/之后/以后/确认后/经确认/完毕/vs./or/yes/no/whether` 等一律视为非命令。
  - **上下文传播**：任一子句是疑问/选择/征询 ⇒ 整条消息不授权（`refactor X, yes or no` 不因首子句是命令而授权）；条件子句使其下一子句同样非命令（`一旦确认，修复 X`、`after you confirm, update X`）。
  - 删除已死的形状常量，保持单一判定路径。
- 回归网：新增第十轮 15 条不得授权与 2 条必须授权（`删除 X 的旧内容`、`清理 X 的重复段落`），累计 **86 条不得授权 + 21 条必须授权 + 4 条作用域断言**；三套外置语料（79/35/32 条）0 不匹配。
- 验证：`pnpm typecheck` 0；`pnpm lint` 0；`pnpm test:unit` **289 passed**；`pnpm test:integration` 124 passed；`pnpm build` 8 workspace；`pnpm docs:check` ok。
- 记录订正：第十轮报告指出 `过时` 不在文档中（对抗性已证伪该引用），本记录不把它列为文档化场景；`重写/润色/rewrite/polish/过时内容` 等未登记措辞属 planVersion 2 声明的 fail-closed 残余（请求澄清），由 WP-04/06 的模型 Assessment 接管。

## T19 独立 Review 第十一轮与修复（取消目标优先模板，越权方向收口）

- 第十一轮 Review 判 **FAIL**（3×P1：目标优先陈述句 `X 尚未修改/拒绝修改/完成修改`、选择/问句尾变体、条件前件变体；2×P2；4×P3）。对抗性核验确认 FAIL 成立，并指出目标优先模板（`COMMAND_TAIL`）中段没有任何谓词守卫，是同族反复逃逸的结构性根因。
- 修复：**取消目标优先模板**，只保留两类结构上不可能与陈述混淆的命令：
  1. `变更动词（+命令粒子）+ 立即路径目标`（英文同样只接受动词优先且句中含路径）；
  2. `把/将/对 + 目标 + … + 变更动词命令式` 处置式。
  并扩充标记与条件词表（`与否/哪个/更好/抑或/要不然/也可以/maybe/perhaps/possibly`、`待你/等你/看情况/酌情/发现问题/upon approval/following approval/pending review`）。
- 取舍（显式登记）：目标优先的日常祈使（`docs/INDEX.md 的错别字麻烦处理下`、`docs/INDEX.md 里的接口说明更新一下`）现在**只读并请求澄清**——这是为保证「陈述句永不授权」而付出的 fail-closed 代价，已写入回归测试与 planVersion 2 的残余风险，由 WP-04/06 的模型 Assessment 接管；对应的动词优先表达（`修复 docs/INDEX.md 中的错别字`）与处置式（`把 docs/INDEX.md 里的错别字改掉`）均正常授权。
- 验证：`pnpm typecheck` 0；`pnpm lint` 0；`pnpm test:unit` **289 passed**（86 负 + 19 正 + 7 条声明性 fail-closed + 作用域断言）；`pnpm test:integration` 124 passed；`pnpm build` 8 workspace；`pnpm docs:check` ok；外置语料（79/35/32 条）与新增第十一轮语料（25 条）全部符合预期。

## T20 独立 Review 第十二轮与修复（sound 命令文法：只授权「动词+目标」）

- 第十二轮 Review 判 **FAIL**（3×P1：动词优先无尾守卫、选择/疑问尾、条件前件；对抗性另补 P1：真祈使句的写范围扩到参照/保留目标）。
- 结论：任何「关键词/形状启发式」都会在两个方向持续漏判。本轮改为**sound 而非 fluent** 的文法，并在记录中明确取舍：
  - 只授权两类子句：`变更动词(+粒子) + 路径目标（+ 有界尾部）` 与 `把/将/对 + 路径目标 + … + 变更动词`；尾部不得超过 16 字符、不得含第二个路径、不得含非命令标记。
  - 英文只授权 `动词 + … + 路径`（尾部同样受限），且捕获的形态必须真的是路径（`fix X was not requested` 不再把 `not` 当目标）。
  - 非命令标记扩充：`而不是/而非/instead of/rather than`、`或/以及/还有/重写`、陈述/完成体/被动/情态/选择/条件/建议/主题/前置条件等（守卫对归一化后的核心子句判定，因此 `但要修复 X` 仍是命令）。
  - 疑问/选择/建议出现在任一子句 ⇒ 整条消息不授权；条件子句使其下一子句同样非命令。
- **明确取舍（记录与 plan 一致）**：代价是「丰富措辞」的祈使句会落到只读并请求澄清——目标优先日常祈使（`docs/INDEX.md 的错别字麻烦处理下`）、多目标列表（`修改 X、Y`）、排除式（`修改 X 而不是 Y`）与未登记同义动词（重写/润色/polish）均属此列。它们不再产生任何写授权；等价表达改用「动词+目标」或 `把/将/对` 处置式即可授权。真正语义理解由 WP-04/06 的模型 Assessment 接管。
- 回归网重写为「必须授权」12 条 + 「必须只读」71 条（覆盖第四至第十二轮全部登记语料），断言写范围恒为 1（不扩张到参照/保留目标）。
- 验证：`pnpm typecheck` 0；`pnpm lint` 0；`pnpm test:unit` **289 passed**；`pnpm test:integration` 124 passed；`pnpm build` 8 workspace；`pnpm docs:check` ok。

## T21 独立 Review 第十三轮与修复（无尾命令文法 + 评述抑制）

- 第十三轮 Review 判 **FAIL**（4×P1：有界尾巴仍是词表、条件前件词表、选择尾、`conditional` 复位；对抗性补 P2：写范围可被铸造成消息未点名的别名）。关键证据是「同义反向」对照：`修改 X 是必要的`（词表内→只读）与 `修改 X 是必需的`（词表外→授权）——证明加词只能移动边界。
- 修复（继续向 sound 收敛，并采纳对抗性建议）：
  1. **彻底取消命令尾**：命令现在只有 `变更动词(+粒子) + 路径目标` 与 `把/将/对 + 路径目标 + 变更动词` 两种形状，目标之后只允许句末标点/空白。`修改 X 是不明智的`、`update X... seems right` 这类形状不再匹配（`X 中的错别字` 也因此变为请求澄清）。
  2. **目标必须与消息点名的路径逐字相同**（`pathsIn(core)` 成员校验），杜绝 `docs/INDEX.md...`／尾点／尾连字符铸成别名。
  3. **评述子句抑制**：任一分句是评价/意见（`明智/必要/属于/由…决定/seems/wrong/wise` 等）⇒ 整条消息不授权（修复 `修改 X，不太明智`）。
  4. **移除 `conditional` 复位缺陷**：命令子句不再清除条件上下文（`经批准，修改 X，删除 Y` 不再给 Y 授权）。
- 取舍（与 T20 一致并扩大）：`修改 X 中的错别字`、`fix the typo in X`、`把 X 里的错别字改掉`、`修改 X、Y`、`修改 X 而不是 Y` 等丰富措辞一律**只读并请求澄清**——为保证「非命令永不授权」付出的 fail-closed 代价，已登记；真正语义理解由 WP-04/06 的模型 Assessment 接管。
- 回归网：必须授权 11 条（严格命令）+ 必须只读 84 条（覆盖第四至第十三轮全部登记语料与新增评述/别名/条件族）。
- 验证：`pnpm typecheck` 0；`pnpm lint` 0；`pnpm test:unit` **289 passed**；`pnpm test:integration` 124 passed；`pnpm build` 8 workspace；`pnpm docs:check` ok。
