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
