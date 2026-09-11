# WP-03 实现 Plan（直接协作与说明产物）

- planVersion: 1
- workId: WP-03
- level: L2（新增 Core 产物/附件/预览模块与 `apps/daemon` HTTP 面；按 `docs/product/experience.md` §3、`docs/architecture/{data,protocol,execution}.md` 既有定义实现，不改产品语义）
- authorization_ref: 用户目标轮次「继续」（2026-09-11）；上级授权为「我要完全实现这个产品，让你来实现」
- productRef: 无独立 Requirement；行为依据为 `docs/delivery/implementation.md` WP-03 与关联 AC（AC-001–006、AC-052、AC-076、AC-084）
- 依赖：WP-02（已完成，结算提交 `f9b61e0`，验证代码树 `cbf7471`）

## 1. goal

让「先解释、再决定是否交付」这条路真实可用：Chief 在不创建 Requirement/Gate 的前提下回答并调查（assist/artifact，`level=none`），按需分派 analysis/artifact 专业 Run（独立 Session、独立 DispatchSpec）；产物落成可版本化的 Artifact（agent 产物绑定 Run、user 产物绑定 Attachment），HTML 说明可隔离预览与一次性下载；附件可先暂存、发送首条消息时原子绑定到新 Work，超限/过期/重复绑定都被显式拒绝；恶意 HTML 在预览路径被隔离策略挡住。真实 Provider 纵向与工具层 `artifact_write` 的执行接线不在本包（WP-10 / WP-07）。

## 2. scope

writePaths:

- `packages/core/src/artifacts.ts`（新增：Artifact 版本链、创建/失效、ACL、`artifact.created`/`artifact.invalidated`）
- `packages/core/src/attachments.ts`（新增：staged 上传、限制、TTL、原子绑定、删除与过期清理）
- `packages/core/src/preview.ts`（新增：HTML 隔离响应策略、内联截断阈值、60 秒单次下载 token）
- `packages/core/src/index.ts`（导出上述模块）
- `apps/daemon/**`（新增：HTTP 面 `POST /artifacts/upload`、`DELETE /artifacts/uploads/:attachmentId`、`GET /artifacts/:id/preview`、`GET /artifacts/download/:token`、`GET /healthz`，以及 `conversation.message.send` 的 Core 组装）
- `packages/core/test/**`、`apps/daemon/test/**`（新增测试）
- `.agentdev/work/WP-03/**`（过程记录）
- 如发现契约缺口：`packages/contracts/src/entities/{project,system}.ts` 与对应测试（仅补齐，不改既有字段语义）

readPaths: `docs/**`（主要 `product/{PRODUCT,experience,knowledge}.md`、`architecture/{ARCHITECTURE,data,protocol,execution,reliability}.md`、`rules/{workflow,agents}.md`、`delivery/{implementation,acceptance}.md`）、`packages/**`、`apps/**`
不可写：`packages/storage`（除非发现必需缺口，须先记录）、`webui/**`、`docker/**`、`docs/**`（除结算时更新 `docs/INDEX.md`）

## 3. tasks（DAG）

| id | 角色 | goal | dependsOn | acceptanceIds |
|---|---|---|---|---|
| T1 | backend | `core/artifacts`：`ArtifactService`（`createAgent(run, bytes, {kind,mime,acl})`、`createUser(workId, attachment)`、`list/get`、`invalidate`、版本链 `artifactVersion`、blob 写入 + hash 校验、ACL 读取校验、`artifact.created/invalidated` 事件） | — | AC-002, AC-003 |
| T2 | backend | `core/attachments`：`AttachmentService`（stage 校验 mime/单文件/总大小/数量、24h TTL、`expiresAt`、`bind` 原子单次绑定 + `ATTACHMENT_ALREADY_BOUND`、`remove` 仅限 staged、`expireStale`） | — | AC-076, AC-084 |
| T3 | backend | `core/preview`：HTML 隔离策略（sandbox iframe `allow-scripts`、CSP `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'`、预览响应不携带工作台 cookie）、内联阈值（1 MiB / 2000 行，超限截断 + 下载入口）、60 秒单次下载 token（一次性消费、过期 403） | T1 | AC-002, AC-052 |
| T4 | backend | `apps/daemon`：HTTP 面（upload/delete/preview/download/healthz）与 `conversation.message.send` 组装（消息 + 新 Work + 附件原子绑定 + user Artifact；失败保持 staged 可重试） | T1, T2, T3 | AC-002, AC-076, AC-084 |
| T5 | backend | assist/artifact 路由端到端：Chief `assess`（`level=none`）→ 直接回答或分派 analysis/artifact 专业 Run（独立 DispatchSpec/Session）→ 产物汇总；不创建 Requirement/Gate；`none` 级 Work 不产生任何写权限（负例） | T1 | AC-001, AC-003, AC-004, AC-005, AC-006 |
| T6 | backend | 失败测试：恶意 HTML（脚本读 cookie/网络/父页被策略拒绝）、上传限制（数量/大小/mime）、产物生成失败（blob 或 hash 校验失败不留引用）、仅问答无授权写入（`none` 级 Work 派写 Run 被拒） | T1–T5 | AC-052, AC-076 |
| T7 | backend | 独立 Review（fresh context）与修复 | T1–T6 | AC-001–006, AC-052, AC-076, AC-084 |
| T8 | backend | 独立 Test 与结算：`test-report`、`settlement.md`、`docs/INDEX.md` 状态更新 | T7 | 全部 |

## 4. 接口与数据影响

- 新增 `ArtifactService`/`AttachmentService`/`PreviewPolicy`（`@agentdev/core` 导出），使用既有 `artifact`/`attachment`/`snapshot` 表与 `BlobStore`，**不新增表**。
- 新增 `apps/daemon`（HTTP 组装层，Node 内置 `http`，不用新依赖）：监听 loopback，复用 WP-01 的 `AuthService` 校验；只装配 Core，不实现 BFF/WS（WP-04/WP-09）。
- 事件：新增 `artifact.created`、`artifact.invalidated`（`protocol.md` §7 已列）；附件绑定不新增事件名，随 `message.received` 的 data 携带附件引用。
- 协议方法：`artifact.list/get`、`artifact.download.prepare`、`conversation.message.send` 的 Core 侧实现；HTTP 端点按 `protocol.md` §5 第 98 行的形状。

## 5. 验证策略与必需失败测试

- 单元：附件限制矩阵（每消息 5 / 单个 20 MiB / 总 50 MiB / mime 允许集）、TTL 与过期清理、重复绑定 `ATTACHMENT_ALREADY_BOUND`、已绑删除 `INVALID_STATE`；Artifact 版本链与 ACL；预览策略头（CSP/sandbox/无 cookie）、截断阈值、下载 token 单次消费与过期。
- 集成（真实 HTTP，loopback + 真实 SQLite + 真实 blob 文件）：上传 → 发送首条消息 → 新 Work + 附件绑定 + user Artifact；预览端点对恶意样例返回隔离策略；下载 token 二次使用 403；healthz 不泄露路径/Secret。
- 必需失败测试：**恶意 HTML**（读取 cookie/发起网络/访问父页的样例在预览策略下不可达）、**上传限制**（超数量/超大小/错误 mime 客户端与服务端双拒且无残留引用）、**产物生成失败**（blob 写入或 hash 校验失败不留下 Artifact/Attachment 引用）、**仅问答无授权写入**（`level=none` 的 assist Work 不能派发写 Run，也不能写文件）。
- 隔离的验证边界（诚实登记）：本包在 HTTP 响应契约层验证隔离策略（sandbox/CSP/无 cookie/无网络），**真实浏览器执行**的攻防复验属 WP-10 发布回归；无头浏览器不在本包依赖内。
- 退出：WP-03 必验范围通过（解释 + HTML 真实端到端）、无 Requirement/Gate 误创建、代码/Schema/测试/文档入口结算。
