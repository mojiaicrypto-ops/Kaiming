# WP-03 实现记录（直接协作与说明产物）

- planVersion: 6（`.agentdev/work/WP-03/plan.md`）
- 依赖：WP-02（结算提交 `f9b61e0`，验证代码树 `cbf7471`）

## 记录口径订正（第十七轮 Review W3R17-04 处理；适用于全部历史条目）

1. **绝对表述的范围**：本文件 T11～T25 中的「一律/永不/按结构关闭/永不下发写授权」只在**当时已登记语料范围内**成立。第十七轮以「否定出现在引述/报告/前提中」的框架句式、第十八轮以「解释领起子句里引用未登记否定词」的框架句式先后证伪了无限定的版本；现行为口径以本文件 **T26/T27/T28/T29** 与 `plan.md` **planVersion 6** 为准，历史条目保留原文不改写。
2. **「外置语料 40 条 0 fail-open」**：指会话外 `/tmp` 下的自建脚本（**不在仓库**，不可从仓库复现）。仓库内可复现的语料是 `packages/domain/test/domain.test.ts`；按评审计数法（`/tmp/w3r18/probe4-registered.mjs`：只提取各 `for (const body of [` / `for (const [body, expected] of [` 块中的字符串字面量，不 import 产品测试文件）实测并重放 **205 例 0 偏差**：必须授权 14、拒绝纠正接续 10、多命令 4、必须只读 177（第十九轮另一实现 `/tmp/w3r19/probe3-registered.mjs` 在同批语料上同样 0 偏差；两者差异只在计数实现，均不 import 产品测试）。历史数字 14/9/3/141（第十七轮）、14/8/4/152（第十八轮）、14/10/4/159（第十九轮）因语料与计数法变化而作废，现按上述方法固定。另有 `apps/daemon/test/server.test.ts`、`packages/core/test/*` 的 HTTP/Core 断言。
3. **陈旧待办作废**：「`../` 越界改为 `VALIDATION_ERROR`」不再适用。现行为是**只读 + 澄清**（HTTP 202、零授权行、`authorizationId=null`、无 500），`domain.test.ts` 已覆盖 `../`、`/etc/`、`~/.ssh/` 三例。
4. **`plan.md` 版本**：`planVersion` 已由 2 升至 **6**，登记 T21～T29 的实际代价、第十七/十八轮 P1/P2 的闭合口径与新增 fail-closed 代价。

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
- 取舍（显式登记）：目标优先的日常祈使（`docs/INDEX.md 的错别字麻烦处理下`、`docs/INDEX.md 里的接口说明更新一下`）现在**只读并请求澄清**——这是为保证「陈述句永不授权」而付出的 fail-closed 代价，已写入回归测试与 planVersion 2 的残余风险，由 WP-04/06 的模型 Assessment 接管；**更正（第十五轮对抗性核验）**：随着命令文法收紧到「动词+路径目标（无尾）」，含名词短语的动词优先表达（`修复 docs/INDEX.md 中的错别字`）与带中间短语的处置式（`把 docs/INDEX.md 里的错别字改掉`）现在同样**只读并请求澄清**，属同一 fail-closed 代价；仍可授权的是最简形式（`修复 docs/INDEX.md`、`把 docs/INDEX.md 改掉`）。
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

## T22 第十三轮修复续（结构性前件规则与评述抑制）

- 在 T21 的无尾命令文法之上补两条**结构性**规则（不再依赖词表覆盖）：
  1. **前件规则**：命令只能出现在消息首子句，或由并列连词（并且/然后/同时/而且/并/and/then）或承接副词（但/但是/而是/不过/也/再/就/则）引入的子句；其他任何前件（`经批准`、`视具体情况`、`depending on the result`）都使后续命令降级为假设。子句切分按捕获分隔符的奇偶位置识别连词，因此 `解释 X 并修复 Y`、`explain X and 修复 Y` 正常拆分。
  2. **评述抑制**：任一分句是评价/意见（`明智/必要/必需/属于/由…决定/seems/wrong/wise/not needed` 等）⇒ 整条消息不授权。
- 目标校验：命令捕获的目标必须与消息点名的路径逐字相同，尾随标点无法铸造别名（修 ADV-01）。
- 外置语料：第十三轮新语料 40 条「必须只读」**0 fail-open**；本轮新增/修订测试 11 条必须授权 + 84 条必须只读全部通过。
- 验证：`pnpm typecheck` 0；`pnpm lint` 0；`pnpm test:unit` **289 passed**；`pnpm test:integration` 124 passed；`pnpm build` 8 workspace；`pnpm docs:check` ok。
- 结论（工程判断，供产品方决定）：确定性基线的 fail-open 方向**在已登记语料范围内**已按结构关闭（**第十七轮更正**：无范围限定的版本已被 13 句框架句证伪，见文首订正与 T26）；代价是丰富措辞（含名词短语的祈使、多目标、排除式）请求澄清。自然语言语义必须由 WP-04/06 的模型 Assessment 承担，否则只能继续以可用性换取确定性。

## T23 独立 Review 第十四轮与修复（抑制集合 + 拒绝纠正规则）

- 第十四轮 Review 判 **FAIL**（3×P1：前件+承接副词绕过、情态词归一洗白、拒绝纠正回归；2×P2：多目标静默部分授权、记录口径；3×P3）。对抗性核验确认 FAIL 成立，并补出「命令之后的（后置）条件同样失效」「命令尾礼貌语」「I think…then…」等同根因通道。
- 修复：
  1. **统一抑制集合**：任一分句命中疑问/选择/征询/评价/条件/假设/**前置条件** ⇒ 整条消息不授权（前件与**后置**条件对称：`修改 X，如果没问题` 不再授权）。条件词表补 `\bafter\b|\bbefore\b`。
  2. **情态词不再被剥离**：`ADVERB_LEAD_PATTERN` 只允许剥离承接副词与裸 `要`；`需要/应该/必须/得/该` 保留在核心子句中，由陈述守卫拦下（`但需要修改 X` 只读，`但要修复 X` 仍可命令）。
  3. **拒绝纠正规则**：命令可出现在首子句、并列连词之后，或**紧接一个拒绝子句**之后（`别改 A，改 B`、`不要改 A，但要修复 B`）。
  4. **礼貌尾子句忽略**：`谢谢/thanks` 等不参与授权也不抑制（`修改 X。谢谢` 正常授权）。
  5. 评价词表补 `i think|it seems|in my opinion`。
- 回归网：新增第十四轮 10 条必须只读 + 3 条必须授权；外置语料 40 条 0 fail-open。
- 验证：`pnpm typecheck` 0；`pnpm lint` 0；`pnpm test:unit` **289 passed**；`pnpm test:integration` 124 passed；`pnpm build` 8 workspace；`pnpm docs:check` ok。

## T24 独立 Review 第十五轮与修复（子句类别判据）

- 第十五轮 Review 判 **FAIL**（2×P1：并列连词重开前件门、裸 `要` 仍被剥离；3×P2；2×P3）。对抗性核验确认 FAIL 成立，并补出「后置未登记条件通道」「fail-closed 规模低估」「`../` 越界返回 500 而非 `VALIDATION_ERROR`」等。
- 修复（判据从「前缀/位置」改为**子句类别**）：
  1. **只有四类子句是良性的**：命令、拒绝、纯礼貌、显式解释请求；**其余任何子句**（陈述、条件、片段、意见、提问——无论是否在词表中）⇒ 整条消息不授权。这样 `视具体情况，然后修改 X`、`修改 X，视具体情况`、`需要修改 X，也需要修改 Y`、`I think it needs work, then update X` 都只读，且不依赖条件词表。
  2. **模态词不再归一**：`normalizeCore` 仅在子句以逆接连词（但/但是/而是/不过）开头时剥离裸 `要`；`另外要更新 X`、`也要修改 X` 保持陈述并被抑制。
  3. **纠正例外收窄**：命令可紧接拒绝子句，但当纠正子句以 `也/再/就/则/并且/而且/然后/同时` 开头时不允许（闭合 `目前不用改 Y，也要更新 X`）。
  4. 删除已失效的 `CONDITION_PATTERNS`（条件识别改由「非良性子句」结构性覆盖）。
- 回归网：新增第十五轮 12 条必须只读 + 1 条必须授权（多命令并列）；外置语料 40 条 0 fail-open。
- 验证：`pnpm typecheck` 0；`pnpm lint` 0；`pnpm test:unit` **289 passed**；`pnpm test:integration` 124 passed；`pnpm build` 8 workspace；`pnpm docs:check` ok。
- 待办（对抗性建议，下一轮）：`../` 越界改为 `VALIDATION_ERROR`；fail-closed 清单按类补齐（动宾补足语、英文副词祈使、处置式轻动词）；订正 `implementation.md` 中关于「含名词短语祈使仍授权」的假声明。

## T25 独立 Review 第十六轮与修复（标记并集 + 纠正作用域）

- 第十六轮 Review 判 **FAIL**（2×P1：`90ce877` 引入回归——命中 NEGATION/解释领起的子句被豁免抑制，条件/提问/意见里的否定使后续命令重新授权；逆接连词后的裸 `要` 无前文也剥离）。对抗性核验确认 FAIL 成立、并指出该通道是**参数化**的（其 7×6 扫描 209/216 越权、一条消息可授权 4 个目标），且「越权范围恒等于一个路径」的表述不成立。
- 修复：
  1. **标记并集与类别规则并存**：疑问/选择/征询/评价/条件/假设/前置条件出现在**任何**子句（即使该子句同时含否定或解释动词）⇒ 整条消息不授权；类别规则作为第二道（非命令/拒绝/礼貌/解释请求的子句亦抑制）。
  2. **纠正作用域**：逆接连词后的裸 `要` 仅在**紧接拒绝子句**时按纠正处理；`但要修改 X` 单独出现只读。
  3. **加性片段不独立成句**：以 `也/再/就/则/另外/同时/并且/而且/然后` 开头的子句不能作为首子句命令；**整条消息以连词开头**（`然后修改 X`）同样只读。
  4. 修 `但是/但` 交替顺序（长优先），使 `但是修改 X` 可识别。
- 回归网：新增第十六轮 9 条必须只读；外置语料 40 条 0 fail-open。
- 验证：`pnpm typecheck` 0；`pnpm lint` 0；`pnpm test:unit` **289 passed**；`pnpm test:integration` 124 passed；`pnpm build` 8 workspace；`pnpm docs:check` ok。

## T26 独立 Review 第十七轮与修复（拒绝类别判定 + 误拒闭合）

- 第十七轮 Review 判 **FAIL**（0×P0、1×P1、3×P2、2×P3）。唯一 P1（W3R17-01）落在本包验收面：`classSuppressed` 的「拒绝」豁免是**子句内任意位置**的关键词命中，于是「否定式陈述/报告/前提」被当成用户拒绝，其后的并列连词命令重获写授权。13 句在真实 HTTP 上落库 Authorization（L2 + 1 授权行 + 1 assessment）并经真实 `Orchestrator` 建立真实 `backend:implementation:queued` 写 Run（其中 1 句为源码路径）。
- 修复（`packages/domain/src/requests.ts`）：
  1. **拒绝 = 子句判定**：`refusal = matches(NEGATION_PATTERNS, clause) && REFUSAL_HEAD_PATTERN.test(clause.trim())`；`REFUSAL_HEAD_PATTERN` 要求否定标记在（可选礼貌前缀、可选 `先` 之后）**领起**子句**并且其后紧跟变更动词**。动词要求使 `别人说不要修改 Y` 不再被 `别` 误判（`别人` 是名词）。
  2. **未领起的否定 ⇒ 整条消息只读**：新增第四道抑制 `reportedNegation`（含否定式但否定不领起的子句），闭合 `别人说/说明不要修改 Y，然后修改 X` 等残余框架句。
  3. **拒绝纠正口径**（与登记语料一致）：领起拒绝 + 并列连词接续 ⇒ 授权接续目标（`不要修改 Y，然后修改 X`、`don't update Y, then update X`）；领起拒绝 + 加性片段 ⇒ 只读（`不要修改 Y，也修改 X`）；逆接连词纠正 ⇒ 授权纠正目标（`不要修改 Y，但要修复 X`）；
  4. **误拒闭合（W3R17-03）**：否定式直接否定变更动词的纠正（`不修改 Y，修改 X`、`先别改 Y，改 X`）授权纠正目标；`NEGATION_PATTERNS` 补齐 `先别`、裸 `不` 与 `立刻/马上/立即/直接/赶紧/尽快` 副词位；`EXPLANATION_LEAD_PATTERN` 允许 `先/优先` 领起，使 `先解释 X，然后修改 Y` 得到 assist + delivery 两 Work（AC-006）。
  5. **逆接连词片段（W3R17-02）**：`leadingConjunction` 补入 `但是|但|不过|而是`，`但修改 X`/`但是修改 X`/`而是要更新 X` 只读，与加性片段口径一致。
  6. **多目标单一口径（W3R17-03）**：`allowed` 增加 `previousWasCommand`（前一分句是已授权的命令 ⇒ 本分句是命令时同样授权）。该分支按构造安全：`suppressed` 是消息级判据，只有全部子句都属于良性类别（命令/拒绝/礼貌/显式解释请求）时才可能生效，因此不会让陈述/条件子句获得授权。结果：`修改 X，删除 Y，更新 Z` 三目标全部进入同一 delivery Work 的写范围，**静默部分授权消除**；仅「路径列表」子句（`修改 X、Y`、`修改 X and Y`）仍只读。
  7. **记录订正（W3R17-04）**：文首「记录口径订正」块；`plan.md` 升 planVersion 3 并登记 T21～T26 的实际口径与新增 fail-closed 代价；`implementation.md` 头部同步。
- 已登记 fail-closed 代价（fail-closed，不产生授权）：轻动词处置式 `对 X 进行修改`、名词短语祈使 `修改 X 中的错别字` / `把 X 里的错别字改掉`、范围声明 `修改 Y，X 保持不动`、排除式 `修改 Y 而不是 X`、多目标列表 `修改 X、Y`、未登记同义变更词（`重写/润色/polish`）。旧探针 `/tmp/w3r15` G8-multi 与 `/tmp/w3r16` K-multi 中「多子句只授权第一个目标」的部分授权期望已被 T26 第 6 条口径取代。
- 回归网（`packages/domain/test/domain.test.ts`）：新增第十七轮 13 句框架负例（含源码路径变体）+ 3 句同形对照 + 2 句逆接连词片段 + 2 句 fail-closed 代价；新增 8 条「拒绝 + 连词接续 ⇒ 只授权接续目标」正例、3 条多命令（含三目标）正例、`先解释…然后修改` 混合意图正例。
- 验证（本轮实跑）：`pnpm typecheck` 0；`pnpm lint` 0；`pnpm test:unit` **289 passed**（19 files）；`pnpm test:integration` 124 passed（10 files）；`pnpm build` 8 workspace；`pnpm docs:check` ok（15 documents / 55 internal links / 94 AC / 9 REQ / 11 WP）。
- 独立复核证据（只读复用评审脚本，消费本轮 `pnpm build` 产物）：`/tmp/w3r17/probe1-corpus.mjs`（13 848 例）A 档仅剩评审已判定的 `务必` 误判族（59 例，语料自身问题）、B 档 37；`probe2-framing.mjs`（31 句）**0 偏差**；`probe3-live.mjs`（真实 HTTP + 真实 Orchestrator）**除下列一项外 fail-open 0、误拒 0**：`修改 X，删除 Y，更新 Z` 被该探针记为 B-partial（它期望「只授权第一个目标」），该期望已被 T26 第 6 条口径取代（第十八轮在此 build 上实测：fail-open 0、误拒 0、documented positive 0 偏差，因为该口径的探针版本已更新）；`probe4-scope.mjs` 作用域无扩张；`/tmp/w3r16/probe5-http.mjs` fail-open 0、`probe6-e2e.mjs` 非命令写 Run 0；`/tmp/w3r16/{probe1,probe2}` fail-open 0；`/tmp/w3r15` 仅多子句口径一项、`/tmp/w3r14/probe1` FAIL-OPEN 0、`probe5-injection` 注入通路 0、`probe6-prior` 前轮 P0/P1 0 失败。

## T27 独立 Review 第十八轮与修复（解释领起的类别判定 + 礼貌前导）

- 第十八轮 Review 判 **FAIL**（0×P0、1×P1、2×P2、2×P3）。P1（W3R18-01）：`reportedNegation`/`refusal` 都建立在 `NEGATION_PATTERNS` 上，而该词表有两处缺口——(a) `别` 的 `(?<![\p{Script=Han}\w])` 守卫排除了任何**汉字之后**的 `别`，于是 `说明别改 Y` 根本不被识别为「含否定」；(b) 变更动词表不含 `重写/优化/完善/清理/整理/替换`。两者叠加第十七轮新放开的**解释领起**豁免（`EXPLANATION_LEAD_PATTERN` 允许 `先|优先`），使「解释领起 + 未登记否定」整类子句保持良性，其后的并列命令重获写授权：`probe2b` 385 组合 90 组越权、13 句在真实 HTTP 落库并经真实 `Orchestrator` 建立 13 个写 Run（含源码路径）。
- 修复（`packages/domain/src/requests.ts`）：
  1. **解释领起改为条件良性**：`benignExplanation = explanationLead && !containsNegationMarker(clause) && !containsChangeVerb(clause)`。否定标记用粗粒度 `NEGATION_MARKER_PATTERN`（`不|别|甭|勿|无需|没有|n't|\b(not|never|without|no need)\b`），变更动词用 `CHANGE_VERB_ANY_PATTERN`（中文含 `重写/优化/完善/清理/整理/替换/润色`，英文用词干以覆盖分词形式）。该判定只用于**抑制**，从不产生授权。
  2. **礼貌前导不再良性（W3R18-02）**：`polite` 仅在子句是**最后一个**子句时成立，`谢谢，然后修改 X` 与 `谢谢，修改 X` 的口径统一为只读；`修改 X。谢谢` 仍授权。
  3. 解释领起与普通否定无关的路径不变：`解释 X 并修复 Y`、`explain X and fix Y`、`先解释 X，然后修改 Y` 仍授权（正例回归 0 偏差）。
- 回归网：新增第十八轮 10 条「解释领起里引用否定/变更」负例 + 5 条「前导礼貌」负例；多命令补 4 目标一例（`修改 X，删除 Y，更新 Z，新增 W` ⇒ 四目标全部入 scope）。
- 验证（本轮实跑）：`pnpm typecheck` 0；`pnpm lint` 0；`pnpm test:unit` **289 passed**（19 files）；`pnpm test:integration` 124 passed；`pnpm build` 8 workspace；`pnpm docs:check` ok。
- 独立复核证据（评审第十八轮脚本，消费本轮 build）：`/tmp/w3r18/probe2b-negation-gap.mjs` **opens by neg: []**（385 组合全部关闭）；`probe2-frame-hole.mjs` **573 句 open 0**；`probe2c-variants.mjs` 4/4 只读；`probe1-failopen.mjs` 1317 例 scope-violations 0（仅 2 例 `obs-polite-conj` 的旧观测期望，已被 T27 第 2 条取代）；`probe4-registered.mjs` **178 例 0 偏差**；`probe3-live.mjs`（真实 HTTP + 真实 Orchestrator）**fail-open 0、误拒 0、documented positive 0 偏差**；`/tmp/w3r17/probe2-framing.mjs` 31 句 0 偏差；`/tmp/w3r16/{probe1,probe2}` FAIL-OPEN 0；`/tmp/w3r14/probe6-prior` 前轮 P0/P1 0 失败。
- 承接（第十八轮 P3）：`/tmp/w3r18/probe1` 的 `obs-polite-conj` 观测期望、`w3r17/probe3-live` 的 B-partial 期望、`w3r16/probe2-launder` 的「加性片段/前导礼貌应授权」期望均与 planVersion 4 口径相左，属探针期望陈旧，非实现缺陷；「消息授权 → `assess` → `dispatch(backend/implementation)`」的**仓库内**产品用例仍未落测试，原因是 `apps/daemon` 尚未装配 `Orchestrator`（`dispatch` 接线属 WP-04）；该断言以本轮真实 HTTP + 真实 Orchestrator 的外置探针证据替代，待 WP-04 落地后补入仓库测试。

## T28 独立 Review 第十九轮与修复（解释领起的形状判定 + 拒绝词表单一来源）

- 第十九轮 Review 判 **FAIL**（0×P0、1×P1、1×P2、3×P3）。P1（W3R19-01）：第十八轮把「良性解释请求」建成**两张枚举表**（`NEGATION_MARKER_PATTERN` 与 `CHANGE_VERB_ANY_PATTERN`），而同一文件的拒绝侧（`NEGATION_PATTERNS`/`REFUSAL_HEAD_PATTERN`）把 `动|碰|删` 也列为变更动词——两张表互相矛盾，于是「未登记否定 × 未登记变更动词」同时逃过两张表，解释领起豁免继续放行并列命令：`说明莫碰 Y，然后修改 X`、`解释停止碰 Y`、`说明避免碰 Y`、`说明未碰 Y`、`解释禁止触碰 Y`、`修改 X，说明莫碰 Y` 在 route 层 216/4290 越权，并在真实 HTTP 上 10 句落库授权行 + L2 delivery + assessment，经真实 `Orchestrator` 建立 10 个真实写 Run（含源码路径）。
- 修复（`packages/domain/src/requests.ts`）：
  1. **解释领起改为形状判定**：`benignExplanation = explanationLead && (isPureExplanationOfPath(clause, EXPLANATION_LEAD_PATTERN) || isPureExplanationOfPath(clause, EXPLANATION_LEAD_EN_PATTERN) || pathsIn(clause).length === 0)`；`isPureExplanationOfPath` 剥离解释领起后要求剩余部分是**恰一个路径 token**。未登记的否定/变更动词使剩余部分不是路径 ⇒ 整条消息只读（**默认拒绝**，不再依赖词表）；不含路径的解释子句没有可夹带的目标，仍可作混合意图前导（`explain the routing rules and fix X` 保持授权，HTTP/Core 既有英文正例不丢）。
  2. **删除两张互相矛盾的枚举表**（`NEGATION_MARKER_PATTERN`/`containsNegationMarker`、`CHANGE_VERB_ANY_PATTERN`/`containsChangeVerb`），根因消除。
  3. **拒绝侧单一来源（W3R19-04）**：`REFUSAL_ADVERBS`/`REFUSAL_CHANGE_VERBS`/`REFUSAL_VERBS_EN` 同时构造 `NEGATION_PATTERNS` 与 `REFUSAL_HEAD_PATTERN`；补入 `重写/优化/完善/清理/整理/替换/纠正/补充` 与英文 `rewrite/polish/optimize/adjust/clean/replace`，`不重写 Y，修改 X`、`不要清理 Y，修改 X` 授权纠正目标。
  4. **`则` 归一化（W3R19-04）**：`ADVERB_LEAD_PATTERN` 补 `则`，`修改 Y，则修改 X` 与 `修改 Y，也修改 X` 一致（两目标入写范围）。
  5. **记录订正（W3R19-03）**：`implementation.md:3` 头由 3 升为 5；T27 的「11 条负例」订正为 **10 条**；语料计数按评审计数法重述为 **187 例 0 偏差**（14/10/4/159），并注明第十八轮 14/8/4/152 已作废。
- 回归网：新增第十九轮 7 条「解释领起 + 未登记否定/变更」负例、2 条「拒绝未登记动词的纠正」正例、2 条「无路径解释前导」正例（含英文原例 `explain the routing rules and 修复 docs/INDEX.md`）。
- 验证（本轮实跑）：`pnpm typecheck` 0；`pnpm lint` 0；`pnpm test:unit` **289 passed**（19 files)；`pnpm test:integration` 124 passed；`pnpm build` 8 workspace；`pnpm docs:check` ok。
- 独立复核证据（评审第十八/十九轮脚本，消费本轮 build）：`/tmp/w3r19/probe1-cross.mjs` **10 357 例 deviations 1（唯一为 `特别修改 X` 的探针期望冲突：该探针把 `特别` 当作 `别` 的同形词期望只读，而 `特别修改 X` 是登记正例，按登记语料保留授权）、scope-expansion 0**；`probe1b-open-forms.mjs` **open forms none**；`probe2-live.mjs`（真实 HTTP + 真实 Orchestrator）**fail-open 0、误拒 0、documented positive 0 偏差**；`/tmp/w3r18/probe2b-negation-gap.mjs` **opens by neg: []**；`probe2-frame-hole.mjs` 573 句 **open 0**；`probe3-registered.mjs` 189 例 0 偏差；`/tmp/w3r17/probe2-framing.mjs` 31 句 0 偏差、`probe3-live.mjs` 仅 B-partial 旧期望；`/tmp/w3r16/probe5-http.mjs` fail-open 0（1 例误拒为已登记的 `修改 Y，X 保持不动`）、`probe6-e2e.mjs` 非命令写 Run 0；`/tmp/w3r14/probe6-prior` 前轮 P0/P1 0 失败；自建外置语料 fail-open 0。
- 承接（第十九轮 P2/P3）：W3R19-02 的「每族 ≥3 条长期断言」已补入主流；`Orchestrator` 级仓库内用例仍缺（`apps/daemon` 未装配 `Orchestrator`，`dispatch` 接线属 WP-04），该断言以外置真实 HTTP + 真实 Orchestrator 证据替代；W3R19-05 协议对账承接。

## T29 第二十轮 Review 的 P2 闭环（路径形状判据 + 族覆盖 + 记录订正）

- 第二十轮 Review 判 **PASS（0×P0、0×P1、2×P2、2×P3）**，可进入独立 Test；本轮只做 P2/P3 闭环，不改判定方向。
- W3R20-01（P2）：`benignExplanation` 的「不含路径」分支原用 `pathsIn`（目标判定），使被拒/畸形目标形态与无目标形态同判良性。修复：新增 `mentionsPathShape`（`~\/`、`/`、`./`、`../`、`xx/`、已知扩展名、`://`），良性分支改为「不含任何路径形状 token」。仍留在良性分支的仅剩**裸词伪目标**（如 `src`），该形态与主题词词法不可区分，已登记为已知口径并落成断言（授权集合恒等于显式命令点名的路径，写范围 0 扩张）。
- W3R20-02（P2）：补齐第十九轮点名的族覆盖——同义否定（`莫动/杜绝碰`）、同义变更（`翻新/删掉/变更/打磨`）、后置（中英各 1）、英文 `avoiding touching`/`prohibition on`、同形对照（`说明莫修改`/`报告说莫碰`），并加 6 条被拒/畸形目标形状负例与 1 条裸词边界正例。`Orchestrator` 级**仓库内**用例仍缺（`apps/daemon` 未装配 `Orchestrator`，属 WP-04 接线），第十九/二十轮均已声明；该断言以真实 HTTP + 真实 Orchestrator 的外置探针替代，Test 须列入 `not_covered`。
- W3R20-03（P3）：T28「每族 ≥3 条已补入主流」的夸大表述已由本节订正为逐族实测计数。
- W3R20-04（P3，承接）：`protocol.md` 对账（未知字段 202 静默忽略、响应 `workIds`/`authorizationId` 未列）仍承接，不属本包验收面。
- 验证（本轮实跑）：`pnpm typecheck` 0；`pnpm lint` 0；`pnpm test:unit` **289 passed**；`pnpm test:integration` 124 passed；`pnpm build` 8 workspace；`pnpm docs:check` ok。
- 复核证据（消费本轮 build）：`/tmp/w3r20/probe1-shape.mjs` 重跑；`/tmp/w3r19/probe1-cross.mjs` F2/F3/F13 全 0；`/tmp/w3r18/probe4-registered.mjs` **205 例 0 偏差**（14/10/4/177）；`/tmp/w3r19/probe2-live.mjs` 与 `/tmp/w3r18/probe3-live.mjs`（真实 HTTP + 真实 Orchestrator）fail-open 0。

