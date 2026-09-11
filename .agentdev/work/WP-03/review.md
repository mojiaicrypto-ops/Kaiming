# WP-03 独立 Review 报告（第四轮）

- 评审对象：工作包 WP-03「直接协作与说明产物」
- 评审轮次：**第四轮**（第一/二/三轮摘要见文末「附一/附二/附三」，均保留）
- 冻结点 / HEAD：`git rev-parse HEAD` = `35e8674a5b93a0feecb645e3073d18180f2a5e53`
  - **与任务下达的 `HEAD=d71dc07` 不一致**（见 W3R4-14）。`git diff --stat d71dc07..HEAD` 仅 `review.md` 一文件，**被审代码树与 `d71dc07` 完全相同**，差异只是第三轮报告提交在修复提交之上。
- 工作树：全部命令前后、报告写入前 `git status --porcelain` 均为**空**。
- 评审角色：Review（独立上下文，未读取任何开发/Test 会话；只依据仓库文件、契约文档与我自建实验）
- 工具：`node v24.8.0`、`pnpm 12.3.4`、macOS 宿主
- 记录哈希（`git hash-object`）：`packages/domain/src/requests.ts` `9a1bf9e5…`、`packages/core/src/messages.ts` `e0eaac87…`、`packages/core/src/preview.ts` `ad5ade05…`、`packages/core/src/artifacts.ts` `057ff403…`、`packages/core/src/attachments.ts` `3ee94838…`、`packages/core/src/orchestrator.ts` `828dde58…`、`apps/daemon/src/server.ts` `f2bf51d8…`、`docs/architecture/execution.md` `7ef649f4…`、`docs/architecture/data.md` `3c4884f9…`、`docs/architecture/protocol.md` `edbba2b8…`、`.agentdev/work/WP-03/implementation.md` `0e9cefef…`、`plan.md` `60103b27…`
- 权威依据：`AGENTS.md`、`docs/INDEX.md`、`docs/rules/{workflow,agents}.md`、`docs/product/experience.md`（§3）、`docs/architecture/{data,protocol,execution,reliability}.md`、`docs/delivery/{implementation,acceptance}.md`（WP-03 与 AC-001..006/052/076/084）、`.agentdev/work/WP-03/{plan,implementation}.md`、`packages/**`、`apps/daemon/**`、相关测试

---

## 1. 结论

**PASS（可进入独立 Test）。**

第三轮唯一的 P1（W3R3-01：消息授权声明 `readPaths` 却无 `read` 操作，导致绑定它的 Work 的任何 Run/Assessment 都被 `capabilityGaps` 拒绝）**已真正闭合，且经端到端验证**：我把 HTTP `conversation.message.send` 产出的 `Authorization` 喂回 `Orchestrator.assess` 与 `dispatch`，命中范围内的 Assessment、Chief 只读 Run、专业写 Run **全部通过**，范围外的三类调用**全部被 `NOT_AUTHORIZED` 拒绝**；未显式传 `authorizationRef` 时走 `work.authorizationRef` 的兜底路径同样通过（probe1，18/18）。AC-006 混合意图的 delivery Work 现在能建立自己的 Chief Run 并在其下派发 Backend 写 Run（probe6，10/10）。第三轮对抗性两条越权（疑问句授权、客户端自报 `authorization`）在**产品边界上**已闭合（probe2：疑问句 5/5 不授权；HTTP 注入的 `deploy`/越界写/网络目标被完全忽略，库中零条 `deploy` 授权）。CSP 已与 `execution.md` §6 逐字对账（probe4：文档原文 = 常量 = 线上头，`sandbox allow-scripts` 作为第二个 CSP 头）。

本轮新增 14 条 Finding：**0×P0、0×P1、3×P2、11×P3**。P2 集中在「**未文档化的客户端 `workItems` 参数**」与「`assertGrantWithinMessage` 的纵深防御不完整」，**不影响文档化的 AC-005/AC-006 主路径**（由 Core 自己的 `routeMessage` 决定时行为正确），且不涉及不可覆盖的权限/Gate 规则，故按 `docs/rules/workflow.md` §6 不阻断 Test。**失败路由修正为：无阻断项，进入 `Testing`**；P2/P3 按 §9 承接，W3R4-01/02/03 建议在结算前处理。

---

## 2. 契约命令原始结果（本轮实跑）

执行目录：仓库根；逐条命令与退出码取自同一串行执行。

| 命令 | 退出码 | 原始结果要点 |
|---|---|---|
| `pnpm typecheck` | **0** | `tsc -p tsconfig.json --pretty false`，无输出 |
| `pnpm lint` | **0** | `Checking formatting... All matched files use Prettier code style!` |
| `pnpm test:unit` | **0** | `Test Files 19 passed (19)`、`Tests 286 passed (286)` |
| `pnpm test:integration` | **0** | `Test Files 10 passed (10)`、`Tests 124 passed (124)`（含真实容器用例） |
| `pnpm docs:check` | **0** | `docs:check ok — 15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages` |
| `pnpm build` | **0** | `pnpm -r build`，**8** 个 workspace `Done`：`contracts, domain, cli, storage, core, daemon, pi-runtime, runner` |

`git status --porcelain` 在全部命令前后均为空；`HEAD` 全程 `35e8674a5b93a0feecb645e3073d18180f2a5e53`。

**命令全绿仍不足以证明必验范围**：286 个单测里仍**没有**任何用例把消息授权喂回 `Orchestrator`；`packages/core/test/artifacts.test.ts:440-444` 只断言 `authorization.operations` 含 `read`、`scope.readPaths` 含命名路径（间接守护 W3R3-01 的回归），`apps/daemon/test/server.test.ts` 的两个新例也只断言响应/行绑定。端到端可用性是**本轮独立 probe** 建立的（W3R4-05）。

---

## 3. 第三轮 W3R3-01..14 逐条复核

判定口径：**已修** = 本轮实验观察到期望行为；**部分** = 主行为成立但有可指认残差；**未修** = 行为仍缺失。

| 编号 | 三轮严重度 | 本轮判定 | 证据（文件:行 + 实测） |
|---|---|---|---|
| W3R3-01 授权 capability 缺口 → 交付死锁 | **P1 阻断** | **已修（端到端验证）** | `messages.ts:342-358`（`grantedByMessage` 现为 `readPaths=writes`、`operations:['read','edit']`）；probe1：`assess` 通过并记录 `authorizationRef`、Chief 只读 Run 通过、专业写 Run 通过、范围内外 3 例正确拒绝、`work.authorizationRef` 兜底通过；probe6 混合意图写 Run 通过 |
| W3R3-02 授权绑定 `works[0]` | P2 | **部分** | 正常路由下已修：`messages.ts:187` 改为 `works.find(writePaths>0) ?? work`，probe3 `authorityOnDeliveryWork` 通过（delivery 拿引用、assist 无）；但**客户端 `workItems` 可抑制 delivery 项**，使授权落到只读 assist Work → **W3R4-02** |
| W3R3-03 授权自相矛盾（与 F1 同因） | P2 | **已修** | 同 W3R3-01：`operations:['read','edit']` 与 `readPaths` 自洽（probe1 `authz.scope.selfConsistent`） |
| W3R3-04 HTTP 响应不含 `workIds`/`authorizationId` | P2 | **部分** | 响应已含两字段（probe1 `responseKeys=messageId,workId,workIds,authorizationId,state,version`）；但 `protocol.md:46` 未对账、daemon 的 `message.received` 事件仍未带两字段 → **W3R4-06/07** |
| W3R3-05 同 intent 重复共享 scope | P2 | **未修（记录声称已修）** | `messages.ts:156-166` 仍 `routing.items.find(...)`；probe3：`workItems:[delivery,d delivery]` 两个 Work 的 `writePaths` **都是** `["docs/INDEX.md","docs/product/experience.md"]` → **W3R4-01**；`d71dc07` 提交信息与 `implementation.md:101` 的「不再共用首个 scope」不成立 |
| W3R3-06 CSP 与 `execution.md` §6 漂移 | P2 | **已修** | `preview.ts:22-25` 恢复逐字策略，`sandbox allow-scripts` 作为第二 `Content-Security-Policy` 头（`preview.ts:31-38`）；probe4：`PREVIEW_CSP` === 文档原文 === 线上头，第二头 `sandbox allow-scripts`；`frame-ancestors` 已移除 |
| W3R3-07 `StorageError` 映射过宽 + 回显 | P2 | **部分** | 回显已修：probe4 `GET /artifacts/%E0%A4%A/preview` → `500 {"code":"INTERNAL_ERROR","message":"the request could not be completed"}`，不再含 `URI malformed`；但映射仍只分「缺引用→404 / 其余→500」，`VERSION_CONFLICT`/`DUPLICATE_KEY`/`BUSY` 未按 `protocol.md` §7 细化，且客户端输入触发的约束错仍是 500（probe5）→ **W3R4-08/04** |
| W3R3-08 `download.prepare` 不报 validity | P3 | **已修** | `server.ts:152`；probe4：prepare 体 `keys=downloadToken,expiresAt,artifactId,artifactVersion,validity` |
| W3R3-09 `targetWorkId` 归属只覆盖 message 来源 | P3 | **未修** | `messages.ts:440-447` 逻辑未变；probe5：跨会话、`sourceRef.kind='action'` 的 Work 作目标 → **202** → **W3R4-10** |
| W3R3-10 daemon/Core owner 派生不一致 | P3 | **未修（latent）** | `server.ts:293` `userIdFromSubject('installation:local')`；`messages.ts:306` 仍 `userIdFromSubject(context.subject)`。`createMessageOperations` 全仓库**无调用方**（grep），故当前不可达；一旦按 `protocol.md` 接线即复发 |
| W3R3-11 `prune()` 无调用方 | P3 | **已修** | `server.ts:145` `options.tokens.prune()`（grep：产品侧唯一调用方，另一处为测试） |
| W3R3-12 AC-005 证据止于「行存在」 | P3 | **部分** | `artifacts.test.ts:440-444` 新增「operations 含 read」间接断言（可挡住 W3R3-01 的直接回归），但**仍无**任何 `Orchestrator.assess/dispatch` 用例 → **W3R4-05** |
| W3R3-13 记录与实测数字不符 | P3 | **未修** | `implementation.md:46`（T6）仍写「278 passed / daemon 9 例 / 7 workspace」；T9 节无「修复后验证」行；T10 写「12 daemon 例」而实测 daemon 测试 **14** 例（`286/124/8 workspace` 三项正确）→ **W3R4-09** |
| W3R3-14 `message.send` 未声明/校验 `workItems`、`authorization`；上传 `projectId`/多文件 | P3 | **部分** | `authorization` 已从 daemon 参数表移除（`server.ts` diff）；但 `workItems` 仍透传且未校验（probe5：非法 intent/空 goal → 500 而非 400），`projectId` 未知仍 201，multipart 第二个 file part 仍被静默丢弃（201）→ **W3R4-04/12** |

---

## 4. 对抗性项复核

| 对抗项 | 来源 | 本轮判定 | 证据 |
|---|---|---|---|
| 疑问句被当作执行消息生成写授权 | 三轮新增 | **已修** | `requests.ts:55-60,107`；probe2：`how do I fix docs/INDEX.md?`、`如何修复 docs/INDEX.md？`、`can you fix docs/INDEX.md`、`why does docs/INDEX.md look wrong?`、`能否修改 docs/INDEX.md` 5/5 `authorizationId=null`、`level=none`，库中零条写范围授权行；probe7 覆盖中英/无问号疑问句 |
| HTTP 客户端可自报 `authorization`（甚至 `deploy`） | 三轮新增 | **已修（产品边界）** | daemon 不再读 `payload['authorization']`（`server.ts` diff）；probe2：带 `authorization{writePaths:['/etc/hosts'],operations:['deploy'],networkTargets:['evil.example']}` 的请求返回 202，落库授权为 `["read","edit"]`/`["docs/INDEX.md"]`/无网络目标，`deploy` 授权行 0 条 |
| Core 是否拒绝「超出消息命名范围」的授权 | 三轮新增（本包自设纵深防御） | **部分** | probe2：越界写路径、环境操作、网络目标、疑问句授权 4/4 拒绝；但 `granted.scope.readPaths` 不受命名约束、且不校验操作是否可由消息导出（无目标消息注入 `git`/`artifact_write` 被接受并生成 L1 Work，probe3 里该 Work 甚至能建立带 `git` 权限的 Run）→ **W3R4-03**；当前 daemon 已剥离该字段，属 latent |
| 二轮对抗 1–7（内存放大/截断头/版本回退/幂等主体/ACL 覆盖/跨会话配额/注释一致） | 二轮 | **未见回归** | 本轮未逐项重跑；其中 6（跨会话 staged 配额）与 5（ACL）仍无产品回归测试；CSP 项已由 W3R3-06 修 |

---

## 5. AC 复核（AC-001..006/052/076/084）

| AC | 本轮判定 | 依据 |
|---|---|---|
| AC-001 自由问答 | **部分** | 问答建 Work、不建 Requirement 成立；「Chief 调查→回答→Work 完成」执行链路仍依赖 WP-04/06/07 |
| AC-002 HTML说明 | **部分** | 上传→绑定→user Artifact→受权预览→一次性下载全链路通过（probe4）；`prepare` 现报 `validity`；HTML「直接生成」的内容生产者仍属 WP-04/06 |
| AC-003 按需委派 | **部分（无链路证据）** | 专业写 Run 的派发/准入链路已通（probe1/6），但「用户消息→Chief 分派 purpose=analysis/artifact 专业 Run→汇总」仍无端到端证据，属 WP-04/07 承接 |
| AC-004 执行授权边界 | **通过（本包范围）** | probe6：`none` 级 explanation Work 的写 Run 被 `NOT_AUTHORIZED`；与 WP-02 一致 |
| AC-005 明确启动 | **通过（端到端）** | probe1 18/18：授权自洽（read+edit）、`assess` 通过、Chief 只读 Run 通过、专业写 Run 通过、范围外 3 例拒绝、`work.authorizationRef` 兜底通过；probe6/7 覆盖中英措辞。**「范围内无重复确认」在准入层面可达** |
| AC-006 混合意图 | **通过（机制层）** | probe6 10/10：一消息 → delivery+assist 两 Work、授权只在 delivery、assist 无授权且只读、独立 scope/budget、`requirements=0`、assist 可先行 assess/建 Run、delivery 可建自己的 Chief+Backend Run。「解释产物先返回」的执行者仍属 WP-04/06/07 |
| AC-052 HTML安全 | **部分（HTTP 契约层）** | probe4：逐字 CSP + 第二 sandbox 头 + `omit`/`no-store`/`nosniff`；真实浏览器读 cookie/网络/父页/top-navigation 复验属 WP-10 |
| AC-076 附件限制 | **通过（服务端）** | 数量/大小/mime/签名矩阵由既有用例与 probe4 覆盖；残差为 multipart 多文件（W3R4-12） |
| AC-084 首条消息附件 | **通过（本包范围）** | 暂存→发送→原子绑定→user Artifact→幂等重放成立；probe4 复验 HTTP 链路 |

---

## 6. 新 Findings（W3R4-xx）

严重性口径：P0 数据/安全或关键不可用；P1 错误行为/需求缺失；P2 局部质量/维护问题；P3 建议。P0/P1 阻断；P2/P3 影响验收才阻断。

### W3R4-01 [P2] W3R3-05 并未修复：同 intent 的多个 Work 仍共用同一 scope（记录声称已修）

- 位置：`packages/core/src/messages.ts:156-166`（`routing.items.find((candidate) => candidate.intent === item.intent)`）；对照 `packages/domain/src/requests.ts:127-137`（一条消息的 delivery 项含**全部**命名路径）
- 实测（probe3）：`workItems:[{delivery,fix index},{delivery,fix experience}]`、消息体点名两个路径 → 两 Work 的 `scope.writePaths` **都为** `["docs/INDEX.md","docs/product/experience.md"]`；`W3R3-05.duplicateIntent.independentScope` 与 `perItemScope` 均 FAIL。
- 影响：AC-006「各自范围独立」在**客户端给定同 intent 多 Work**时不成立；第二个 Work 实际持有首个 Work 未声明路径的写权限。正常路径（Core 自己路由）不会产生重复 intent，故不影响文档化 AC-006 主路径。
- 记录问题：`d71dc07` 提交信息与 `implementation.md:101` 均称「同 intent 的多个 Work 由 `routeMessage` 的 per-item scope 决定，不再共用首个 scope」，与代码不符。
- 最小修复：按 `workItems` 下标与路由项一一对应，或对重复 intent 直接 `VALIDATION_ERROR`。

### W3R4-02 [P2] 客户端 `workItems` 可抑制 delivery 项，把消息的写授权挂到只读 assist Work，且不产生任何 delivery Work

- 位置：`apps/daemon/src/server.ts:180-182`（`workItems` 透传）；`packages/core/src/messages.ts:151-187`（`explicitItems = input.workItems ?? routing.items`；`authorized = works.find(writePaths>0) ?? work`）
- 实测（probe3，走真实 HTTP）：消息 `fix the typo in docs/INDEX.md` + `workItems:[{intent:'assist',goal:'just chat'}]` → 只创建 1 个 `assist` Work，`level=L1`、`authorizationRef=authorizationId`；`W3R3-02.suppressedDelivery.intents` 与 `authorityNotOnAssist` 均 FAIL。
- 影响：这是 W3R3-02 的另一种形态——`works[0]` 兜底在「客户端抹掉写 Work」时又把授权交给只读 Work。工作身份与意图错配、AC-005 的 delivery 语义丢失；因该授权仍以消息点名的路径为界，不构成权限扩张。
- 最小修复：Core 应以 `routeMessage` 为准（忽略或校验 `workItems`），或要求 `explicitAuthorization` 时必须有 `delivery` Work，否则 `VALIDATION_ERROR`。

### W3R4-03 [P2] `assertGrantWithinMessage` 不完整：`readPaths` 不受命名约束，且不校验操作能否由消息导出

- 位置：`packages/core/src/messages.ts:361-382`（只比对 `granted.scope.writePaths` 是否属于命名集合，并黑名单环境操作）
- 实测（probe2/3，直调 `sendMessage`，模拟进程内 dispatcher 调用方）：
  - 消息只点名 `docs/INDEX.md`，注入 `scope.readPaths:['packages/core/src']` + `operations:['read']` → **接受**，授权行 `readPaths=["packages/core/src"]`（越过消息范围）。
  - 消息 `hello there`（无命名目标）注入 `operations:['git']`、空 `writePaths` → **接受**，Work 升 `L1`，并成功 `dispatch` 出带 `git` 权限的 Run（probe3 `OVERAUTH.gitGrant.cannotCreateRun` FAIL）。
  - 同上注入 `artifact_write` → **接受**。
- 影响：Core 自称的「拒绝超出消息命名范围的授权」只覆盖写路径与环境操作，未覆盖读范围与「操作可导出性」。**当前产品不可达**：daemon 已剥离 `authorization`，且 `createMessageOperations` 全仓库无调用方（grep 确认）；一旦按 `protocol.md` 把它接线为 dispatcher operation（W3R3-10 描述的场景），该缺口即变为可用越权。
- 最小修复：`assertGrantWithinMessage` 同时约束 `scope.readPaths ⊆ named`，并要求每个 `granted.operations` 能由命名目标导出（无命名目标时只允许空/只读操作）。

### W3R4-04 [P3] 客户端 `workItems` 仍未校验：非法 intent/空 goal 落成 500 `INTERNAL_ERROR`

- 位置：`apps/daemon/src/server.ts:180-182`（仅 `Array.isArray` 即 cast）；`packages/core/src/messages.ts:156-166`（直接使用）
- 实测（probe5）：`workItems:[{intent:'not-an-intent',goal:'x'}]` → `500 {"code":"INTERNAL_ERROR","message":"the change could not be stored"}`；`[{intent:'assist',goal:''}]` 同。应为 `400 VALIDATION_ERROR` 且给出字段。
- 附带：`workItems` 在 `protocol.md:46` 未定义（W3R3-14 的入口仍在）。

### W3R4-05 [P3] 仍无「授权喂回 Orchestrator」的回归测试（W3R3-12 未完全闭合）

- `packages/core/test/artifacts.test.ts:440-444` 只断言授权自洽（`operations` 含 `read`、`readPaths` 含路径），`apps/daemon/test/server.test.ts:429-487` 的两个新例只断言响应与行绑定；全仓库无 `orchestrator.assess/dispatch` 消费该授权的用例。
- 影响：W3R3-01 的直接回归能被间接挡住，但「准入可用性」继续依赖人工 probe。建议把本轮 probe1 的矩阵（范围内通过 ×3、范围外拒绝 ×3）落成集成用例。

### W3R4-06 [P3] `protocol.md` 未对账：`workIds`/`authorizationId` 未入表；`targetRole` 有文档无实现

- `docs/architecture/protocol.md:46` 仍为 `conversationId,body,attachmentIds,targetWorkId?,targetRole?` → `{messageId,workId,state,version}`；probe4 `RECORD.protocol.declaresWorkItemsAndWorkIds` FAIL。daemon 实际接受 `workItems` 并返回 `workIds`/`authorizationId`，且**不读 `targetRole`**。
- 影响：文档与实现两个方向都不一致，Test 以文档为权威会漏测/误判。

### W3R4-07 [P3] daemon 的 `message.received` 事件未带 `workIds`/`authorizationId`，与 T10 的「证据面」表述不符

- `apps/daemon/src/server.ts:225-236` 事件 `data` 仅 `messageId,workId,attachmentIds,artifactIds`；probe4 `HTTP.event.workIdsPresent` FAIL（`eventDataKeys=messageId,workId,attachmentIds,artifactIds`）。
- 影响：`implementation.md:104`/三轮 W3R3-04 曾以该事件作为「关联多 Work」的证据面，表述不实；不过 HTTP 响应已带 `workIds`/`authorizationId`，可观测性本身满足。

### W3R4-08 [P3] `StorageError` 映射仍粗：存储层错误不再有 4xx 细分与 `retryable` 语义

- `apps/daemon/src/server.ts:370-395`：仅「缺引用/FOREIGN KEY → 404」，其余一律 500 `retryable:false`；`protocol.md` §7 的 `VERSION_CONFLICT`/`DUPLICATE_KEY`（应 409）等未体现。probe5 证明客户端输入错误（非法 `workItems`）会以 500 呈现。
- 相对三轮：**回显内部信息已修**，属部分闭合。

### W3R4-09 [P3] 记录数字仍与实测不符（W3R3-13 未修）

- `implementation.md:46`（T6）「`pnpm test:unit` **278 passed**（含 daemon 9 例…）；`pnpm build` 7 workspace」；T9 节无「修复后验证」行；T10 称「12 daemon 例」。实测：unit **286**（19 文件）、integration **124**（10 文件）、build **8** workspace、daemon 测试 **14** 例、docs:check ok。`286/124/8` 三项正确，其余三处待订正。

### W3R4-10 [P3] `targetWorkId` 归属仍只覆盖 `sourceRef.kind==='message'`

- `packages/core/src/messages.ts:440-447`；probe5：跨会话、`sourceRef.kind='action'` 的 Work 作目标 → **202**（应 403/404）。建议按 Work 的 conversation/project 归属统一判定。

### W3R4-11 [P3] 发送失败仍留下孤儿正文 blob（W3R2-13 未修）

- `packages/core/src/messages.ts:129-141` 先写正文 blob，`bind`（`:225`）失败即抛出，无回收。probe5：失败发送后 `blob files=2 / message_body rows=1`（1 个无引用 blob）。承接 GC 或「先校验后写 blob」。

### W3R4-12 [P3] multipart 第二个 file part 被静默丢弃；未知 `projectId` 仍 201

- probe4/probe5：两个 file part → `201`（保留其一）；未知 `projectId` → `201`。建议拒绝第二个 file part，并校验/明确 `projectId` 可省略。

### W3R4-13 [P3] 错误响应仍非 `protocol.md` §1 封装

- probe4：404 体 `topKeys=ok,error`，缺 `v/type/id`，`HttpError.details` 平铺进 `error`（`server.ts:407-412`）。承接 W3R2-11。

### W3R4-14 [P3，流程/证据] 任务下达的 `HEAD=d71dc07` 与仓库实际 `HEAD=35e8674` 不一致

- `35e8674` 是第三轮报告提交，`git diff d71dc07..HEAD` 仅 `review.md`；**被审非 review 文件与 `d71dc07` 逐一相同**（§记录哈希）。不影响本次结论，但「冻结点」应以 `35e8674`（代码树等价 `d71dc07`）记录，避免后续对账漂移。

---

## 7. 计数与阻断判定

| 严重性 | 本轮新增 | 编号 | 是否阻断 |
|---|---|---|---|
| P0 | 0 | — | — |
| P1 | **0** | — | — |
| P2 | 3 | W3R4-01（同 intent scope 塌缩）、W3R4-02（客户端 workItems 错绑授权）、W3R4-03（授权守卫不完整，latent） | 不阻断 |
| P3 | 11 | W3R4-04..W3R4-14 | 不阻断 |

**仍未修好清单（承接，不阻断 Test）**：W3R4-01、W3R4-02、W3R4-03（建议结算前处理）；W3R4-04..14（P3）。**已修好**：W3R3-01/03（P1 根因，端到端验证）、W3R3-06、W3R3-08、W3R3-11，以及三轮对抗性 1/2 的产品边界部分与二轮 W3R2-05/08；W3R3-02/04/07/12/14 记为部分。

---

## 8. 回归与「同类模式」扫描

- **回归面**：本轮重新跑通六条契约命令；WP-02 用例未削弱（integration 10 文件/124 用例与三轮一致）；unit 由 284 → **286**（新增 2 例 daemon 越权/拆分断言）。
- **授权判定扫描（现状）**：消息生成路径 `grantedByMessage` 自洽；调用方注入路径有 `assertGrantWithinMessage`（不完整，W3R4-03）；`verifyAuthorization`（`orchestrator.ts:785-877`）对 Work/Chief/专业 Run 的范围、操作、网络目标、capability 缺口判定齐全，本轮专门用范围内外矩阵验证其边界成立。
- **路由启发式**（probe7，14/14）：中英修改动词 + 命名路径 → delivery 授权；疑问句（含无问号 `how/what` 起头）→ assist 不授权；`please refactor everything`（无目标）→ 先澄清不猜权限；`write documentation for X` → document。**已知 fail-closed 边界**：`修复 docs/INDEX.md?` 与 `fix X?` 这类「命令句 + 问号」不授权，用户需改写；不构成安全洞，但 Test 应加语义边界样例。
- **记录对账**：CSP 已对齐；`protocol.md`（W3R4-06）与 `implementation.md` 数字（W3R4-09）仍未对齐，须在结算材料中修正。

---

## 9. 剩余风险与承接包

### 9.1 建议结算前处理（P2）
1. **W3R4-01/02**：`workItems` 要么由 Core 忽略、只信 `routeMessage`，要么逐项校验并按下标绑定 scope；`explicitAuthorization` 时保证存在 delivery Work。同时订正 `d71dc07` 与 `implementation.md:101` 的不实表述。
2. **W3R4-03**：补全 `assertGrantWithinMessage`（约束 `readPaths`、要求操作可由命名目标导出），或在 `createMessageOperations` 接线前补齐并加负例。

### 9.2 承接 Test / 后续包（P3）
3. **WP-04/05**：`workItems` 的协议化声明或移除（W3R4-04/06）；`targetRole` 实现或从 `protocol.md` 删除；owner 派生统一（W3R3-10）；`protocol.md` 增补 `workIds`/`authorizationId`。
4. **WP-04/06/07**：AC-003 的 analyst/artist 专业 Run 端到端、AC-006「解释产物先返回」的执行接线、`level=none` Work 的运行触发。
5. **WP-09/WP-10**：`download.prepare` 的 `validity` 已在包内提供，失效卡片渲染与真实无头浏览器攻防（读 cookie/网络/父页/top-navigation）复验。
6. **本包/结算**：补 W3R4-05 的准入集成用例、W3R4-09 的数字订正、W3R4-10/11/12/13 的归属判定、孤儿 blob GC、multipart 多文件与 `projectId`、错误响应 §1 封装。

### 9.3 未闭环风险（供结算/产品方判断）
- **多用户语义**：单用户前提不变；未来多用户需重做 `assertReadable` 主体维度。
- **真实 Provider 纵向**：AC-001/AC-003 的完整证据仍依赖 WP-07/WP-10，本包不评价。
- **路由启发式 vs 模型 Assessment**：`routeMessage` 仍是模型评估（WP-04/06）接管前唯一判定者；已知「命令句 + ?」误判为疑问（fail-closed），建议 Test 固定样例。
- **W3R4-03 的时效性**：只要 `createMessageOperations` 未被接线，风险为 latent；接线前必须闭合。

---

## 10. 能否进入独立 Test —— **能**

- 依据 `docs/rules/workflow.md` §6：P0/P1 阻断；本轮 **0×P0、0×P1**。三轮唯一 P1（W3R3-01）已由本轮独立 probe 端到端证伪其存在（授权可准入、范围边界正确），越权两条在产品边界闭合。
- 3 条 P2 均位于**未文档化的客户端 `workItems` 参数**与**不可达的纵深防御**，不改变文档化 AC-005/AC-006 主路径，不违反不可覆盖的权限/Gate 规则，故不阻断 Test；建议 §9.1 在结算前处理，由其决定是否新开修复轮。
- Test 应重点覆盖：AC-005 的授权→assess→dispatch 正向/反向矩阵（本轮 probe1）、AC-006 混合意图两 Work 独立性与 delivery 写 Run（probe6）、疑问句/注入负例（probe2）、CSP 逐字对账（probe4）、以及 §8 的语义边界样例；AC-003/WP-04 相关项按 not_covered 关联明确 AC 并交产品方处置。

---

## 11. 方法与边界声明

- 独立上下文：未读取任何开发/Test 会话对话；结论只来自仓库文件、`docs/**` 契约与 `/tmp/wp03r4/` 下我自建的 8 个文件（`harness.mjs` + `probe1..7.mjs`），全部消费 `pnpm build` 产物（**未 import 任何产品测试文件**）。
- **实验统计**：probe1 18 项（18 通过）、probe2 17（14/3）、probe3 6（1/5）、probe4 17（12/5）、probe5 7（2/5）、probe6 10（10/0）、probe7 14（14/0）；合计 **89 项观察，71 通过 / 18 失败**，失败项与 Findings 一一对应（probe2 的 3 项为 W3R4-03，probe3 的 5 项为 W3R4-01/02/03，probe4 的 5 项为 W3R4-06/07/13/12，probe5 的 5 项为 W3R4-10/11/04/12）。
- 未做：真实无头浏览器执行、真实 Provider 纵向、Docker 容器内复验、二轮对抗 1–7 的逐项重跑。
- 未改仓库：本轮只覆盖写入 `.agentdev/work/WP-03/review.md`（本报告）；`git status --porcelain` 在写报告前后均为空，`HEAD` 仍为 `35e8674a5b93a0feecb645e3073d18180f2a5e53`。

---

## 附一：第一轮摘要（保留）

第一轮（报告冻结于 `a946ed6`，被审代码树 `fd90fef`）结论 **FAIL**：必验范围「实现完整直接协作与产物路线，附件暂存/绑定、隔离预览可实际运行」不成立，新增 14 条 Finding —— **2×P0、5×P1、5×P2、2×P3**；P0/P1 全部阻断，P2 的 W3-06 因影响 AC-002 阻断。要点：下载 token 可预测且下载路由先于认证（W3-01 P0）；产物读取无主体维度（W3-02 P0）；owner 由 sessionId 派生（W3-03 P1）；消息正文未写 blob（W3-04 P1）；未知会话上传 500（W3-05 P1）；失效产物仍可预览（W3-06）；AC-006 未实现（W3-07 P1）；用户消息不建 Authorization（W3-08 P1）；token 只增不减/`prune` 无调用方（W3-09）；归档会话仍接受上传（W3-10）；`expireStale` 无调用方（W3-11）；错误响应无 §1 封装（W3-12）；记录不一致（W3-13）；浏览器级攻防未验（W3-14，承接 WP-10）。另 5 项对抗性（内联预览字节上限、文件签名、`targetWorkId` 归属、隔离只靠客户端头、失败上传孤儿 blob 与 staged 无上限）。

## 附二：第二轮摘要（保留）

第二轮（报告冻结于 `8e4efc1`，被审代码树与 HEAD 同为 `a946ed6`）结论 **FAIL**：主要判据 W3R2-01（AC-006 未实现）与 W3R2-02（AC-005 未实现），另 2×P2（W3R2-03 CSP 漂移、W3R2-04 StorageError 映射/回显）、9×P3（W3R2-05..13）。第二轮对抗性 7 项：1/3/4/5/7 已修，2 部分（语义可辩护），6 已修但无测试守护。六条契约命令全绿但不足以支撑必验范围。

## 附三：第三轮摘要（保留）

第三轮（报告冻结于 `35e8674`，被审代码树 `d71dc07`）结论 **FAIL**：AC-005 的授权机制（`routeMessage`、消息级 Authorization 行、`work.authorizationRef`、Assessment、混合意图多 Work 与独立 scope）全部**落库**且成立，但 `grantedByMessage` 生成 `readPaths:['docs']` + `operations:['edit']` 的自相矛盾授权，使绑定它的 Work 的任何 Run/Assessment 都被 `capabilityGaps:['readPaths without a read operation']` 拒绝——交付路线在准入即死锁（W3R3-01 P1）。新增 **1×P1、5×P2、8×P3**；对抗性另指出疑问句被当作执行消息、HTTP 客户端可自报 `authorization`（甚至 `deploy`）。失败路由 `Blocking Review Finding → Develop → Independent Review`。

| 三轮编号 | 严重度 | 摘要 | 四轮状态 |
|---|---|---|---|
| W3R3-01 | P1 | 授权 capability 缺口 → 交付死锁 | **已修（端到端验证）** |
| W3R3-02 | P2 | 授权绑定 `works[0]` | 部分 → W3R4-02 |
| W3R3-03 | P2 | 授权自相矛盾（与 -01 同因） | **已修** |
| W3R3-04 | P2 | HTTP 响应不含 `workIds`/`authorizationId` | 部分 → W3R4-06/07 |
| W3R3-05 | P2 | 同 intent 重复共享 scope | **未修** → W3R4-01 |
| W3R3-06 | P2 | CSP 与 `execution.md` §6 漂移 | **已修** |
| W3R3-07 | P2 | StorageError 映射过宽 + 回显 | 部分 → W3R4-08 |
| W3R3-08 | P3 | `download.prepare` 不报 validity | **已修** |
| W3R3-09 | P3 | `targetWorkId` 归属只覆盖 message 来源 | 未修 → W3R4-10 |
| W3R3-10 | P3 | daemon/Core owner 派生不一致 | 未修（latent） |
| W3R3-11 | P3 | `prune()` 无调用方 | **已修** |
| W3R3-12 | P3 | AC-005 证据止于「行存在」 | 部分 → W3R4-05 |
| W3R3-13 | P3 | 记录与实测数字不符 | 未修 → W3R4-09 |
| W3R3-14 | P3 | `workItems`/`authorization`/`projectId`/多文件 | 部分 → W3R4-04/12 |

第三轮对抗性 1/2 的**产品边界部分**在第四轮闭合；三轮对抗 3（CSP 对账）亦已闭合。
