# WP-03 独立 Review 报告（第五轮）

- 评审对象：工作包 WP-03「直接协作与说明产物」
- 评审轮次：**第五轮**（第一/二/三/四轮摘要见文末「附一～附四」，均保留）
- 冻结点 / HEAD：`git rev-parse HEAD` = `fd0a8935bcd51caea99341584baf9d87b5579438`
  - **与任务下达的 `HEAD=3f52fbf` 不一致**；`git diff --stat 3f52fbf..HEAD` 仅 `.agentdev/work/WP-03/review.md` 一文件（+148/−185），**被审代码树与 `3f52fbf` 完全相同**，差异只是第四轮报告提交在修复提交之上（见 W3R5-09，与 W3R4-14 同源）。
- 工作树：全部命令前后、本报告写入前 `git status --porcelain` 均为**空**。
- 评审角色：Review（独立上下文，未读取任何开发/Test 会话；只依据仓库文件、契约文档与我自建实验）
- 工具：`node v24.8.0`、`pnpm 12.3.4`、macOS 宿主
- 记录哈希（`git hash-object`，前 8 位）：`packages/domain/src/requests.ts` `09cb4da4`、`packages/core/src/messages.ts` `78439c1c`、`packages/core/src/preview.ts` `bec75158`、`packages/core/src/artifacts.ts` `057ff403`、`packages/core/src/attachments.ts` `3ee94838`、`packages/core/src/orchestrator.ts` `828dde58`、`apps/daemon/src/server.ts` `f5aab4f5`、`docs/architecture/execution.md` `7ef649f4`、`docs/architecture/protocol.md` `edbba2b8`、`docs/architecture/data.md` `3c4884f9`、`docs/architecture/reliability.md` `29bbf2c1`、`docs/delivery/acceptance.md` `c0340ef4`、`.agentdev/work/WP-03/implementation.md` `7db63182`、`plan.md` `60103b27`
- 权威依据：`AGENTS.md`、`docs/INDEX.md`、`docs/rules/{workflow,agents}.md`、`docs/product/experience.md`（§3）、`docs/architecture/{data,protocol,execution,reliability}.md`、`docs/delivery/{implementation,acceptance}.md`（AC-001..006/052/076/084）、`.agentdev/work/WP-03/{plan,implementation}.md`、`packages/**`、`apps/daemon/**`、相关测试

---

## 1. 结论

**FAIL（不能进入独立 Test；按 `docs/rules/workflow.md` §6 走 `Blocking Review Finding → Develop → Independent Review`）。**

第四轮对抗性六项中 **4 项真修好、1 项部分、1 项未修且名实不符**：

| 对抗项 | 第四轮判定要求 | 本轮实测 |
|---|---|---|
| 逐子句分类（解释/疑问/否定不下发写授权） | 真修 | **部分**——第四轮列举的 8 个原句与「`?`/如何/能否/how/can」族已闭合，但同一缺陷类**仍可复现**（中英文疑问、否定、陈述、名词化解释共 **17 个新句式**），且 HTTP 端到端可评估为 L2 delivery 并派发写 Run（**W3R5-01，P1**） |
| 线性路径检测（`pathsIn`） | 真修 | **已修**（probeE：64k 病态输入 ≤15 ms，2000 次普通路由 8.8 ms） |
| `targetWorkId` 不改写目标 Work | 真修 | **已修**（probeC/H：`none`/`L1`/`L3` 三种目标的 level 与 authorizationRef 全部保持，零新增授权行） |
| 消息授权等级与 `routingFloor` 一致（L2） | 真修 | **已修**（probeF：行/Work/Assessment 均 L2；`assess(level:'L1')` 被 floor 拒，`assess(L2)` 通过） |
| `workItems` 逐项校验 | 真修 | **已修**（probeC：非法 intent/goal/非对象/空数组 → 400 且事务回滚零 Work 写入） |
| CSP 单头（删除无效第二头名） | 真修 | **未修且记录不实**——wire 上仍同时出现 `content-security-policy` 与无效的 `content-security-policy-sandbox`（**W3R5-03，P2**）；`implementation.md:118` 与 `3f52fbf` 提交信息均称「已删除」 |

**另发现一条与第四轮同类、但方向相反的阻断缺陷**：否定词表把单字「别」当作全词匹配，加上「说明/介绍」等名词化解释词与「、」不参与分词，使**明确指令**（如 AC-007 的典型用例「修改 docs/INDEX.md 中的错别字」）被判为拒绝/解释，既不下发授权也不建 delivery Work（**W3R5-02，P1**）。第四轮 `W3R4-02/04/07` 已闭合、`W3R4-01` 部分闭合；`W3R4-03/05/06/08/09/10/11/12/13` 未完全闭合（部分为 latent/record 级）。

本轮新增 **9 条 Finding：0×P0、2×P1、2×P2、5×P3**。两条 P1 均直接落在本包验收面（AC-004 负例、AC-005 正例），违反不可覆盖的授权/Gate 规则，**阻断 Test**。

---

## 2. 契约命令原始结果（本轮实跑）

执行目录：仓库根；逐条命令与退出码取自同一串行执行（`/tmp/wp03r5/commands.log`）。

| 命令 | 退出码 | 原始结果要点 |
|---|---|---|
| `pnpm typecheck` | **0** | `tsc -p tsconfig.json --pretty false`，无输出（2.2s） |
| `pnpm lint` | **0** | `Checking formatting... All matched files use Prettier code style!`（8.5s） |
| `pnpm test:unit` | **0** | `Test Files 19 passed (19)`、`Tests 287 passed (287)`（2.7s） |
| `pnpm test:integration` | **0** | `Test Files 10 passed (10)`、`Tests 124 passed (124)`（含真实容器/镜像用例） |
| `pnpm docs:check` | **0** | `docs:check ok — 15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages` |
| `pnpm build` | **0** | `pnpm -r build`，**8** 个 workspace `Done`：`contracts, cli, domain, storage, core, daemon, pi-runtime, runner` |

`git status --porcelain` 在全部命令前后均为空；`HEAD` 全程 `fd0a8935bcd51caea99341584baf9d87b5579438`。

补充实测（供结算对账）：`apps/daemon/test/server.test.ts`（unit）**15** 例、`packages/core/test/artifacts.test.ts` **16** 例、`packages/domain/test/domain.test.ts` **32** 例。`implementation.md:120`（T11）的 `unit 287 / integration 124 / 8 workspace / daemon 15` 与实测一致；`implementation.md:46`（T6）与 `:104`（T10）的旧数字未订正（W3R5-07）。

**命令全绿不等于必验范围成立**：287 个单测中，唯一新增的路由断言是 `packages/domain/test/domain.test.ts:284-300` 的 **8 个第四轮原句**，没有任何用例覆盖「疑问句族/否定词族/名词化解释词/顿号列表」；`packages/core/test/artifacts.test.ts:434` 只把期望等级从 L1 改成 L2；仍**没有**任何用例把消息授权喂回 `Orchestrator.assess/dispatch`（W3R4-05 未闭合）。本轮断言全部由我自建 probe 建立。

---

## 3. 第四轮对抗性逐条复核（含代码位置）

判定口径：**已修** = 本轮实验观察到期望行为；**部分** = 主行为成立但有可指认残差；**未修** = 行为仍缺失；**名实不符** = 记录/提交信息与代码相反。

| # | 对抗项 | 判定 | 证据（文件:行 + 实测） |
|---|---|---|---|
| A | 逐子句分类：解释/疑问/否定永不下发写授权 | **部分** | `requests.ts:144-149`（`splitClauses`）、`:169-194`（逐子句判定）；probeA：第四轮 8 原句 **8/8 不授权**，`?`/如何/能否/how/can 族 **6/6 不授权**；但 probeA 另有 **17/17 新句式越权授权**（疑问 9、否定拒绝 3、陈述/名词化 5），probeB 走真实 HTTP 全部落库 Authorization + delivery Work L2，probeF 证其可 `assess` + 派发写 Run → **W3R5-01** |
| A′ | 同方向的**反向**缺陷：明确指令被误判为拒绝/解释 | **新增缺陷** | `requests.ts:74`（否定词表含裸单字 `别`）、`:38-41`（解释词含 `说明/介绍`）、`:104`（分词不含 `、`）；probeA/B/H：「修改 docs/INDEX.md 中的错别字」「识别并修复 …」「特别修改 …」「分别修复 …」「更新 docs/INDEX.md 的说明」「补充 … 的说明文档」「修改 docs/a.md、docs/b.md」→ **7 例均不下发授权**（对照组「错字」「内容」「标题」正常授权）→ **W3R5-02** |
| B | 路径检测线性化 | **已修** | `requests.ts:104-135`（`TOKEN_PATTERN` 线性 + 锚定 `PATH_TOKEN_PATTERN` + `MAX_TOKEN_LENGTH`）；probeE：64k 字母 1.5 ms、64k 路径 token 4.5 ms、64k 深路径 0.1 ms、64k 混合分隔符 14.4 ms、2000 次普通路由 8.8 ms（阈值 500 ms/3000 ms） |
| C | CSP 第二头名无效 → 单头 | **未修 / 名实不符** | `preview.ts:44,61` 仍返回 `content-security-policy-sandbox`，`server.ts:121-122` 直接铺进 `writeHead`；probeD 原始 wire 头：`["content-security-policy", "default-src 'none'; …", "content-security-policy-sandbox", "sandbox allow-scripts", …]`。`implementation.md:118` 与提交信息称「删除无效的第二 CSP 头名」不成立 → **W3R5-03** |
| D | 消息授权 L1 与 `routingFloor` 不一致 | **已修** | `messages.ts:234-238`（delivery scope 含操作 → L2）、`orchestrator.ts:174-189`（`operations.length>0` → floor L2）；probeF：Assessment/Work 均 L2，`assess(level:'L1')` 报 `routing rules require L2`，`assess(level:'L2')` 通过 |
| E | `workItems:[null]` / `intent:'operation'` → 500 | **已修** | `messages.ts:149-165`（逐项校验）、`server.ts:181-183`（仅 Array 透传，Core 兜底）；probeC：`operation`+`null`、空 goal、字符串项、空数组、非字符串 goal → **全部 400 `VALIDATION_ERROR`**，且 `store.works` 计数不变（事务回滚） |
| F | `targetWorkId` 可改写已有 Work 的 level/authorizationRef | **已修** | `messages.ts:181-183`（只取目标 Work）、`:207-214`（`targetWorkId` 时 `modifyingWork`/`granted` 均为 `undefined`）；probeC/H：none→none、L1→L1、L3→L3，authorizationRef 与授权行数完全不变，响应 `authorizationId=null` |
| G | 前端提交的 `workItems` 抑制 delivery 项 | **已修** | `messages.ts:209`（`works.find(writePaths>0)`）；probeC：`workItems:[{assist}]` + 「fix docs/INDEX.md」→ 1 个 assist Work、level none、`authorizationId=null`、零授权行（W3R4-02 闭合） |
| H | 同 intent 多 Work 共用一个 scope | **部分** | `messages.ts:172-179` 按下标出现次数匹配；probeC：两个 delivery 项不再共享全量 scope，越权方向已闭合；但**第二项拿不到任何 scope**（回落为空 scope），`implementation.md:117`「按位置匹配各自 scope」表述不精确（W3R5-07） |

---

## 4. W3R4-01..14 逐条复核

| 编号 | 四轮严重度 | 本轮判定 | 证据 |
|---|---|---|---|
| W3R4-01 同 intent 多 Work 共用 scope | P2 | **部分** | 见上表 H；probeC `duplicate-intent scopes are independent` PASS、`only one Work carries the authorization` PASS；第二项空 scope（记录不精确） |
| W3R4-02 `workItems` 把写授权挂到只读 Work | P2 | **已修** | probeC 两条断言 PASS；`messages.ts:209` |
| W3R4-03 `assertGrantWithinMessage` 不约束 `readPaths` | P2 | **未修（latent）** | probeH：直调 `sendMessage`，消息只点名 `docs/INDEX.md`，注入 `scope.readPaths:['packages/core/src']` → **接受**，落库授权 `readPaths=["packages/core/src"]`；写路径越界仍被拒；无命名目标 + `git` 的注入因「无 modifying Work」不再落库（该分支已被 B/H 修复顺带关闭）。daemon 已剥离 `authorization`、`createMessageOperations` 仍无调用方（grep），故不可达 → **W3R5-04** |
| W3R4-04 `workItems` 未校验 → 500 | P3 | **已修** | probeC（5 类非法输入全 400、零写入） |
| W3R4-05 无「授权喂回 Orchestrator」回归测试 | P3 | **未修** | `grep -rn "orchestrator.assess\|orchestrator.dispatch" packages/*/test apps/*/test` 无命中；本轮的 probeF 是唯一端到端证据 |
| W3R4-06 `protocol.md` 未列 `workIds`/`authorizationId`/`workItems` | P3 | **未修** | probeG：`protocol.md` 的 `conversation.message.send*` 行仍为 `…targetWorkId?:ID,targetRole?:Role | {messageId,workId,state:received,version}`；daemon 实际接受 `workItems` 并返回 `workIds`/`authorizationId`，且不读 `targetRole` |
| W3R4-07 `message.received` 事件缺 `workIds`/`authorizationId` | P3 | **已修** | `server.ts:228-240`、`messages.ts:352-366`；probeG `message.received event carries workIds` PASS |
| W3R4-08 `StorageError` 映射仍粗 | P3 | **部分（无进展）** | `server.ts:372-396` 仍只分「缺引用→404 / 其余→500 `retryable:false`」；客户端输入型错误已由 Core 的 `VALIDATION_ERROR` 在更早层拦下（probeC），但 `VERSION_CONFLICT`/`DUPLICATE_KEY` 未按 `protocol.md` §7 映射 |
| W3R4-09 记录数字与实测不符 | P3 | **部分** | T11（`:120`）数字正确；T6（`:46`）仍写 `278 passed / 7 workspace`，T10（`:104`）仍写 `12 daemon 例`（probeG 三项 FAIL） |
| W3R4-10 `targetWorkId` 归属只覆盖 message 来源 | P3 | **未修** | `messages.ts:483-490`；probeC：跨会话 `sourceRef.kind='message'` → 403（正确）；跨会话 `sourceRef.kind='action'` → **202**（应 403/404）→ W3R5-05 |
| W3R4-11 失败发送留下孤儿正文 blob | P3 | **未修** | probeG：非法 `workItems` 被 400 拒后 `blob files 4 → 5`（DB 回滚，blob 不回滚）；`messages.ts:129` 先写 blob |
| W3R4-12 multipart 第二 file 丢弃 / 未知 `projectId` 201 | P3 | **未修** | probeG：两个 file part → 201（保留其一）；未知 `projectId` → 201 |
| W3R4-13 错误响应非 `protocol.md` §1 封装 | P3 | **未修** | probeG：404 体 `{ok:false,error:{…}}`，缺 `v/type/id` |
| W3R4-14 冻结点与任务不一致 | P3（流程） | **复发** | 本轮任务称 `HEAD=3f52fbf`，实际 `fd0a893`（仅 `review.md` 之差）→ W3R5-09 |

---

## 5. 前三轮 P1/P2 回归复核

结论：**未发现已修项回归**；六条契约命令全绿，`integration`（124）与三轮一致，`unit` 286 → **287**（新增 1 例 daemon 断言）。

| 来源 | 项 | 本轮状态 |
|---|---|---|
| 一轮 P0 | W3-01 下载 token 可预测 | 已修、未见回归（probeG：≥43 字符 base64url、不含产物 id、两 token 不同、单次消费） |
| 一轮 P0 | W3-02 产物读取无主体维度 | 单用户语义保持（probeD/G：`assertReadable` + owner 校验在预览/下载/prepare 三处生效） |
| 一轮 P1 | W3-03 owner 由 sessionId 派生 | 设计未变（`server.ts:295` 统一 installation 用户；`messages.ts:349` 仍 `userIdFromSubject(context.subject)`，因 `createMessageOperations` 无调用方而不可达） |
| 一轮 P1 | W3-04 正文未落 blob | 已修、未回归（probeG：`message_body` 行 + 64 hex hash + bytes 正确 + blob 落盘） |
| 一轮 P1 | W3-05 未知会话 500 | 已修（probeG：404） |
| 一轮 P1 | W3-06 失效产物仍可预览无标识 | 已修（probeG：validity 头 + prepare 返回 validity） |
| 一轮 P1 | W3-07/W3-08 AC-006/AC-005 未实现 | 机制成立（probeB/F；AC 复核见 §7） |
| 二轮 P1 | W3R2-01/02 AC-006/AC-005 | 仍成立（probeB/C/F） |
| 二轮 P2 | W3R2-03 CSP 与文档漂移 | 逐字一致（probeD：`PREVIEW_CSP` === `execution.md` §45 原文 === wire 头）；但无效第二头名残留（W3R5-03） |
| 二轮 P2 | W3R2-04 StorageError 映射/回显 | 回显已修（probeG：非法百分号编码 500 且不含 `URI`）；映射细分仍缺（W3R4-08） |
| 三轮 P1 | W3R3-01 授权 capability 缺口 → 交付死锁 | **仍然修好**（probeF：`operations=['read','edit']` 自洽、`assess(L2)` 通过、Chief 只读 Run 通过、grant 内 Backend 写 Run 通过、grant 外写 Run `NOT_AUTHORIZED`、`none` Work 不能声明写 scope） |
| 三轮 P2 | W3R3-02/04/05/06/07 | 见 §4（-02→已修；-04/-07 部分；-05 部分；-06 名实不符） |

---

## 6. 授权判定绕过实验（本轮重点）

### 6.1 越权方向：非执行消息仍生成可用写授权（W3R5-01）

`routeMessage` 的分类是「关键词锚定 + 子句切分」，只覆盖枚举过的词形。以下句式在 probeA（domain）与 probeB（真实 HTTP）中**全部**产生 `authorizationId`、`authorization` 行（`readPaths=writePaths=['docs/INDEX.md']`、`operations=['read','edit']`）与 `level=L2` 的 delivery Work；probeF 进一步证明该 Work 可 `assess(L2)` 并派发 Backend 写 Run：

| 类别 | 句式（实测越权） | 未命中的判据 |
|---|---|---|
| 中文疑问 | `你修复 docs/INDEX.md 了吗`、`是否已经修复 docs/INDEX.md`、`是否要修改 docs/INDEX.md`、`修改 docs/INDEX.md 了没有`、`麻烦确认 docs/INDEX.md 有没有需要修改的地方` | `?` 仅在句尾；`吗/呢/了没有/是否` 未入 `QUESTION_PATTERNS`（`requests.ts:55-65`） |
| 英文疑问 | `Did you fix docs/INDEX.md`、`Will you fix docs/INDEX.md` | 问号可省；`did/will/have/has/may` 未入句首助动词表（`:58`） |
| 英文陈述/征询 | `Any thoughts on the fix for docs/INDEX.md`、`I have a question about the fix in docs/INDEX.md` | 子句含 `fix` + 路径即判指令；`question` 未入判据 |
| 名词化解释 | `The explanation for the fix in docs/INDEX.md`、`I am describing the fix in docs/INDEX.md` | `\bexplain\b`/`\bdescribe\b` 只匹配原形，不匹配 explanation/describing（`:40`、`:63`） |
| 陈述需求 | `docs/INDEX.md needs a fix`、`The fix needed in docs/INDEX.md` | 名词 `fix` 即被视为修改动词（`:43-46`） |
| 中文拒绝 | `我先不修改 docs/INDEX.md`、`我不想修改 docs/INDEX.md`、`不必修改 docs/INDEX.md` | 否定表只含 `不要/别/无需/不用/不需要/先别/暂不`（`:74`） |
| 话题子句 | `Regarding the fix in docs/INDEX.md, what do you suggest?` | 逗号切分把话题碎片切成「指令子句」，整句产出 delivery+assist（`splitClauses:146`） |

`implementation.md:113` 的绝对表述「解释句、疑问句、否定句（不要/别/don't/never/not asking）**永不下发写授权**」与实测不符；`domain.test.ts:284-300` 的用例集恰好只覆盖第四轮列举的 8 个原句，因此命令全绿掩盖了该缺陷类。

### 6.2 反向方向：明确指令被判为拒绝/解释（W3R5-02）

| 触发 | 句式（实测**不**授权） | 对照（正常授权） | 根因 |
|---|---|---|---|
| 裸单字 `别` 全串匹配 | `修改 docs/INDEX.md 中的错别字`、`识别并修复 docs/INDEX.md`、`特别修改 docs/INDEX.md`、`分别修复 docs/INDEX.md 和 …` | `修改 docs/INDEX.md 中的错字`、`检查并修复 docs/INDEX.md` | `requests.ts:74` 的 `别` 无边界，命中「错别**字**/识**别**/特**别**/分**别**」 |
| 解释词做名词 | `更新 docs/INDEX.md 的说明`、`补充 docs/INDEX.md 的说明文档`、`更新 docs/INDEX.md 的项目介绍`、`修复 docs/INDEX.md 中的特别说明` | `更新 docs/INDEX.md 的内容`、`更新 docs/INDEX.md 的标题` | `requests.ts:38-41` 的 `说明/介绍` 无词性约束 |
| 顿号列表不参与分词 | `修改 docs/INDEX.md、docs/product/experience.md` | `修改 docs/INDEX.md 和 docs/product/experience.md` | `requests.ts:104` 的 `TOKEN_PATTERN` 未把 `、`（U+3001）当分隔符，整串不成路径 → 视为「无命名目标」 |
| 逗号分隔目标列表 | `修改 docs/INDEX.md, docs/product/experience.md`（仅首路径获授权，第二项记为 explanation） | — | `splitClauses:146` 逗号无条件切分 |

这些都属于 AC-005 正例（「用户明确修复具体目标 → 原消息作为范围授权」）与 AC-007 典型用例（普通错字）的失败；虽为 fail-closed（不放大权限），但同样使交付路线无法启动——与三轮 P1（W3R3-01 授权导致交付死锁）属同一严重性类别。

### 6.3 仍然闭合的方向（本轮复核通过）

- 客户端无法自报授权：probeB 注入 `authorization{writePaths:['/etc/hosts'],operations:['deploy'],networkTargets:['evil.example']}` → 落库仍是消息自身范围 `['docs/INDEX.md']`/`['read','edit']`；probeH 无命名目标 + `git` 注入不再落库。
- 写路径越界被拒：probeH `NOT_AUTHORIZED`。
- 疑问句带 `?`、`如何/能否/how/can/why/what` 族、`不要/别/don't/never/not asking/without changing` 族：probeA/B **不授权**（第四轮原句全数闭合）。
- 混合意图仍正确拆分：probeH「先解释一下，然后修改 …」「不要修改 A，但是修复 B」「别解释，直接修改 …」等 8/8 符合预期（AC-006）。

---

## 7. AC 复核（AC-001..006/052/076/084）

| AC | 本轮判定 | 依据 |
|---|---|---|
| AC-001 自由问答 | **部分** | 问答建 Work、不建 Requirement 成立；完整「Chief 调查→回答→Work 完成」仍依赖 WP-04/06/07 |
| AC-002 HTML说明 | **部分** | 上传→绑定→user Artifact→受权预览→一次性下载全链路通过（probeD/G）；失效产物可读且带 validity；内容生产者仍属 WP-04/06 |
| AC-003 按需委派 | **部分（无链路证据）** | `assess`/`dispatch` 链路成立（probeF），但「用户消息→Chief 分派 purpose=analysis/artifact 专业 Run→汇总」无端到端证据 |
| AC-004 执行授权边界 | **不通过** | probeB/F：疑问句（`你修复 docs/INDEX.md 了吗` 等 9 类）产生真实写授权、L2 delivery Work，并可 `assess` + 派发 Backend 写 Run；「消息与授权记录负例」要求不成立 |
| AC-005 明确启动 | **不通过** | 正例失败：`修改 … 中的错别字`、`识别并修复 …`、`分别修复 …`、`更新 … 的说明`、`修改 a、b` 均不授权（probeA/B/H）；反例失败：非执行消息反而授权（同 AC-004） |
| AC-006 混合意图 | **通过（机制层）** | probeB/C/F/H：一消息 → 解释 + delivery，各自 scope/budget、解释无授权、delivery L2 且可派发写 Run；「解释产物先返回」执行者仍属 WP-04/06/07 |
| AC-052 HTML安全 | **部分（HTTP 契约层）** | probeD：逐字 CSP + `x-agentdev-preview-sandbox` + `omit`/`no-store`/`nosniff` 成立；**服务端第二 sandbox 头无效**（W3R5-03），真实浏览器攻防仍属 WP-10 |
| AC-076 附件限制 | **通过（服务端）** | 数量/大小/mime/签名矩阵（既有用例）；残差为 multipart 多文件被静默丢弃（W3R5-08） |
| AC-084 首条消息附件 | **通过（本包范围）** | 暂存→发送→原子绑定→user Artifact→幂等重放成立（probeG） |

---

## 8. 新 Findings（W3R5-xx）

严重性口径：P0 数据/安全或关键不可用；P1 错误行为/需求缺失；P2 局部质量/维护问题；P3 建议。P0/P1 阻断；P2/P3 影响验收才阻断。

### W3R5-01 [P1] 非执行消息（疑问/拒绝/陈述/名词化解释）仍产生可用写授权并可派发写 Run

- 位置：`packages/domain/src/requests.ts:38-65`（词表）、`:104`（分词）、`:144-149`（切分）、`:169-194`（逐子句判定）
- 实测（probeA 17 例越权；probeB 走真实 HTTP 10 族全部落库授权 + delivery Work L2；probeF 端到端）：
  - HTTP：`POST /conversation.message.send {body:'你修复 docs/INDEX.md 了吗'}` → 202、`authorizationId=01a09076-675b-…`、授权行 `{readPaths:["docs/INDEX.md"],writePaths:["docs/INDEX.md"],operations:["read","edit"]}`、Work `intent=delivery, level=L2, authorizationRef=…`。
  - 准入：`Orchestrator.assess` 通过；`Orchestrator.dispatch` 派发 Backend `purpose=implementation` 写 Run（scope `writePaths:['docs/INDEX.md']`）**成功**。
- 影响：违反 AC-004（用户仅询问 → 未授权不启动交付）与 AC-005（只有明确执行消息才授权）；第四轮对抗性证伪的「越权已闭合」在**同类新句式上依然成立**，`implementation.md:113` 的绝对表述不实。
- 最小修复方向：把判定从「关键词是否出现」改为「子句是否为命令式」（如句首/主语省略的命令模板 + 词形还原 explain/explains/explaining/explanation、did/will/have、是否/吗/呢/了没有；陈述句中 `needs a fix / the fix needed` 视为 topic 而非指令），并为每类补负例测试。

### W3R5-02 [P1] 明确指令被判为拒绝/解释，AC-005 正例不成立（fail-closed 交付死锁）

- 位置：`requests.ts:74`（`别` 无词边界）、`:38-41`（`说明/介绍` 无词性约束）、`:104`（`TOKEN_PATTERN` 不含 `、`）、`:146`（逗号无条件切分）
- 实测：probeA/B/H —— `修改 docs/INDEX.md 中的错别字`、`识别并修复 docs/INDEX.md`、`特别修改 docs/INDEX.md`、`分别修复 docs/INDEX.md 和 docs/product/experience.md`、`更新 docs/INDEX.md 的说明`、`补充 docs/INDEX.md 的说明文档`、`修改 docs/INDEX.md、docs/product/experience.md` 全部 `authorizationId=null`、Work 回落为 `assist`/`document`、`level=none`；对照组（错字/内容/标题/检查并修复）正常授权。
- 影响：AC-005「用户明确修复具体目标 → 原消息作为范围授权」与 AC-007 的典型错字用例失败；与三轮 P1（交付路线在准入即死锁）同类。
- 最小修复方向：否定词表用带边界的词（`别` 仅作为独立命令词/与动词相邻时匹配，或改为 `别(?!的|字|人)` 类保守写法）；解释词仅在句首/疑问语境生效，或要求解释动词与 `疑问标记` 同现；分词补 `、`/`，`；逗号后仅路径的子句应并入前一指令子句或按列表解析。

### W3R5-03 [P2] 无效 `Content-Security-Policy-Sandbox` 头仍在 wire 上；修复记录与提交信息不实

- 位置：`packages/core/src/preview.ts:35,44,61`（`PREVIEW_SANDBOX_CSP` 仍以非标准头名返回）、`apps/daemon/src/server.ts:121-122`（原样 `writeHead`）
- 实测（probeD 原始头）：`content-security-policy: default-src 'none'; …` 与 `content-security-policy-sandbox: sandbox allow-scripts` **同时存在**；浏览器不解析后者，故「第二个 CSP 头承担 sandbox 纵深防御」的注释结论不成立。
- 记录问题：`implementation.md:118` 称「删除无效的第二 CSP 头名」、`3f52fbf` 提交信息称「the invalid Content-Security-Policy-Sandbox header is gone」——均与代码相反（该提交只改了注释，见 `git diff d71dc07..3f52fbf -- packages/core/src/preview.ts`）。
- 影响：AC-052 的服务端纵深防御声明名不副实（文档 `execution.md` §45 只要求 iframe sandbox + 逐字 CSP，故功能契约本身仍满足；风险在于「多一个无效安全头」与不实记录）。
- 最小修复：要么删除该键（文档已把 sandbox 交给 iframe 属性契约），要么用 Node 支持的数组形式发成**真正的**第二个 `Content-Security-Policy`（已实测 `writeHead(200,{'content-security-policy':[a,b]})` 会输出两个头）；同步订正记录与提交说明。

### W3R5-04 [P2] W3R4-03 未修：调用方提供的 `authorization.readPaths` 仍不受消息范围约束（latent）

- 位置：`packages/core/src/messages.ts:404-425`（只校验 `writePaths ⊆ named`，不校验 `readPaths`）
- 实测（probeH，直调 `sendMessage`）：消息仅点名 `docs/INDEX.md`，注入 `scope.readPaths:['packages/core/src']`、`operations:['read','edit']` → **接受**，授权行 `readPaths=["packages/core/src"]`。
- 可达性：daemon 已移除 `authorization` 字段，`createMessageOperations` 全仓库无调用方（grep），当前不可达；一旦按 `protocol.md` 接线即为可用越权。
- 最小修复：`assertGrantWithinMessage` 同时约束 `readPaths ⊆ named`，并要求每个 `operations` 条目能由命名目标导出（无命名目标时只允许空/只读操作）。

### W3R5-05 [P3] `targetWorkId` 归属仍只覆盖 `sourceRef.kind==='message'`

- 位置：`messages.ts:483-490`；probeC：跨会话 `action` 来源 Work → **202**（应 403/404）。建议按 Work 所属 project/conversation 统一判定。

### W3R5-06 [P3] 被拒发送仍留下孤儿正文 blob（W3R4-11）

- 位置：`messages.ts:129`（先写 blob）；probeG：`workItems` 非法 → 400 后 blob 文件 4 → 5，DB 行已回滚。承接 GC 或「先校验后写 blob」。

### W3R5-07 [P3] 记录与实测不一致（W3R4-06/09 未闭合、T11 表述不精确）

- `implementation.md:46`（T6）仍 `278 passed / 7 workspace`；`:104`（T10）仍 `12 daemon 例`；实测 unit 287（19 文件）、integration 124（10 文件）、build 8、daemon 15。
- `implementation.md:117`「同 intent 多 Work 按位置匹配各自 scope」不精确：第二个同 intent 项回落空 scope（§3-H）。
- `implementation.md:118` 关于 CSP 的表述（见 W3R5-03）。
- `protocol.md:46` 未声明 `workItems`，返回体未列 `workIds`/`authorizationId`，`targetRole` 有文档无实现（probeG）。

### W3R5-08 [P3] 前轮剩余项无进展：`W3R4-12/13`、`W3R4-05`

- multipart 第二个 file part 静默丢弃（201）、未知 `projectId` 接受（201）、错误响应非 `protocol.md` §1 封装（probeG）；仍无「消息授权 → `Orchestrator.assess/dispatch`」回归用例（287 单测中不存在）。

### W3R5-09 [P3，流程/证据] 冻结点与任务下达不一致（W3R4-14 复发）

- 任务要求 `HEAD=3f52fbf`，实际 `HEAD=fd0a893`；`git diff 3f52fbf..HEAD` 仅 `review.md`，被审代码树与 `3f52fbf` 逐一相同（§记录哈希）。不影响本轮结论，但冻结/对账应以「代码树 = `3f52fbf`（提交链 HEAD `fd0a893`）」记录，避免后续漂移。

---

## 9. 计数与阻断判定

| 严重性 | 本轮新增 | 编号 | 是否阻断 |
|---|---|---|---|
| P0 | 0 | — | — |
| P1 | **2** | W3R5-01（非执行消息越权授权，AC-004/AC-005）、W3R5-02（明确指令被判拒绝/解释，AC-005/AC-007 正例失败） | **阻断** |
| P2 | 2 | W3R5-03（无效 CSP 第二头名 + 记录不实）、W3R5-04（`readPaths` 越界，latent） | W3R5-03 影响 AC-052 声明；W3R5-04 不可达 |
| P3 | 5 | W3R5-05、W3R5-06、W3R5-07、W3R5-08、W3R5-09 | 不阻断 |

**仍未修好清单（按优先级）**
1. **P1** W3R5-01：疑问/拒绝/陈述/名词化解释句仍授权并可派发写 Run。
2. **P1** W3R5-02：`别` 子串、解释名词、`、` 列表使明确指令不授权。
3. **P2** W3R5-03：CSP 第二头名未删（记录/提交信息不实）；W3R5-04：`assertGrantWithinMessage` `readPaths` 未闭合（接线前必须修）。
4. **P3** W3R5-05（归属）、W3R5-06（孤儿 blob）、W3R5-07（记录/协议对账）、W3R5-08（前轮剩余）、W3R5-09（冻结点）。

**已修好确认**：W3R4-02、W3R4-04、W3R4-07；对抗 B/D/E/F/G；三轮 P1（W3R3-01）端到端仍成立；一轮 P0/P1 与二轮 P1 未见回归。

---

## 10. 能否进入独立 Test —— **不能**

- 依据 `docs/rules/workflow.md` §6：P0/P1 阻断。本轮 **2×P1**，且都直接对应本包验收面：
  - AC-004 的负例（「消息与授权记录负例」）被证伪——疑问句产生授权记录并可派发写 Run；
  - AC-005 的正例在常见中文措辞（错别字/识别/特别/分别/说明/顿号列表）下不成立。
- 失败路由：`Blocking Review Finding → Develop → Independent Review`。修复后必须**重新独立 Review**（因涉及授权判定这一安全边界，不能用开发自测替代），通过后才可进入 Test。

**Test 必须覆盖的条目（修复轮后的最小集）**
1. 越权负例矩阵（W3R5-01）：§6.1 的 17 个句式 + 第四轮 8 原句，断言 `authorizationId=null`、零 authorization 行、所有新 Work `level=none`；至少取 3 例继续喂回 `Orchestrator.assess`/`dispatch`，断言写 Run 被 `NOT_AUTHORIZED`/`VALIDATION_ERROR` 拒绝。
2. 正例矩阵（W3R5-02）：中英文明确指令（含 `错别字/识别/特别/分别/说明/介绍/、列表/逗号列表`），断言授权生成、`operations` 自洽（read+edit）、scope 等于命名路径、`assess(L2)` 通过、grant 内写 Run 通过、grant 外拒绝。
3. L2 一致性：`assess(level:'L1')` 被 `routingFloor` 拒、`assess('L2')` 通过；Work/Assessment 行 level 一致（本轮 probeF 已建立样例，应落成用例，W3R4-05）。
4. AC-006 混合意图：前置/后置解释 + 中英/分号/逗号变体，断言两 Work 独立 scope、解释 Work 无授权、delivery 可派发写 Run。
5. `targetWorkId`：`none`/`L1`/`L3` 三类目标 + 跨会话 message 来源（403）+ 非 message 来源（W3R5-05 修复后应拒）。
6. `workItems`：非法项 400 + 事务回滚零写入、重复 intent 的独立 scope、抑制 delivery、无命名目标的 delivery、空数组。
7. 预览/CSP：wire 上恰有一个标准 `Content-Security-Policy` 且逐字等于 `execution.md` §45；`x-agentdev-preview-sandbox`/`omit`/`no-store`/`nosniff`；validity；1 MiB/2000 行截断头；下载 token 单次 + 60s TTL。
8. 回归：token 不可预测、正文 blob、未知会话 404、失效预览、非整数 `artifactVersion` 400、幂等重放、未知 `projectId`/多 file part、错误响应封装。

---

## 11. 剩余风险与承接包

### 11.1 本轮必须回到 Develop
1. **W3R5-01**：重做指令/非指令判定（命令式 vs 陈述/疑问/拒绝），并把 §6.1 全部句式落成 domain + daemon 负例。
2. **W3R5-02**：修正词表边界与分词（`别`、解释名词、`、`），并把 §6.2 全部句式落成正例。
3. **W3R5-03**：删除无效头或改发真正的第二 CSP 头；订正 `implementation.md:118` 与提交说明。

### 11.2 承接 Test / 后续包（P2/P3）
4. **W3R5-04**：`assertGrantWithinMessage` 补 `readPaths` 与操作可导出性约束；在 `createMessageOperations` 接线前必须有负例守护。
5. **WP-04/05**：`workItems` 协议化声明或移除；`targetRole` 实现或删除；`workIds`/`authorizationId` 入表；owner 派生统一（W3R3-10）。
6. **本包/结算**：`targetWorkId` 归属统一（W3R5-05）、孤儿 blob GC（W3R5-06）、`StorageError` 映射细化与 §1 错误封装（W3R4-08/13）、multipart 多文件与 `projectId`（W3R4-12）、T6/T10 数字订正（W3R5-07）。
7. **WP-09/WP-10**：失效产物卡片渲染、真实无头浏览器攻防（读 cookie/网络/父页/top-navigation）、真实 Provider 生成解释内容。

### 11.3 未闭环风险
- **路由启发式 vs 模型 Assessment**：`routeMessage` 在 WP-04/06 接管前是唯一授权生成者；本轮证明「关键词启发式」在两个方向都会出错（越权与误拒），模型接管前后都需要一条确定性的负例防线。
- **单用户语义**：`assertReadable` 主体维度不变；多用户需重做。
- **W3R5-04 时效性**：只要 `createMessageOperations` 未被接线即为 latent，接线前必须闭合。
- **文档漂移**：`protocol.md`、`implementation.md` 与提交信息三处与代码不符，结算时须一并订正，否则 Test 以文档为权威会误判。

---

## 12. 方法与边界声明

- 独立上下文：未读取任何开发/Test 会话对话；结论只来自仓库文件、`docs/**` 契约与 `/tmp/wp03r5/` 下我自建的 9 个文件（`harness.mjs` + `probeA..H.mjs`），全部消费 `pnpm build` 产物（**未 import 任何产品测试文件**）。
- **实验统计**：probeA 49（31/18）、probeB 70（37/33）、probeC 28（27/1）、probeD 13（12/1）、probeE 8（8/0）、probeF 12（9/3）、probeG 31（25/6）、probeH 24（15/9）；合计 **235 项观察，164 通过 / 71 失败**，失败项与 Findings 一一对应（probeB 33 = 10 个越权族 ×3 断言 + 3 个误拒；probeA 18 = 17 越权 + 1 误拒；probeF 3 = AC-004 越权端到端；probeG 6 = 记录/协议/孤儿 blob；probeH 9 = 误拒 7 + 越权 1 + W3R4-03 1；probeC 1 = W3R4-10；probeD 1 = CSP 无效头）。
- 未做：真实无头浏览器执行、真实 Provider 纵向、Docker 容器内复验、`createMessageOperations` 接线后的越权复现（因无调用方而不可达）。
- 未改仓库：本轮只覆盖写入 `.agentdev/work/WP-03/review.md`（本报告）；`git status --porcelain` 在写报告前后均为空，`HEAD` 仍为 `fd0a8935bcd51caea99341584baf9d87b5579438`。

---

## 附一：第一轮摘要（保留）

第一轮（报告冻结于 `a946ed6`，被审代码树 `fd90fef`）结论 **FAIL**：必验范围「实现完整直接协作与产物路线，附件暂存/绑定、隔离预览可实际运行」不成立，新增 14 条 Finding —— **2×P0、5×P1、5×P2、2×P3**；P0/P1 全部阻断，P2 的 W3-06 因影响 AC-002 阻断。要点：下载 token 可预测且下载路由先于认证（W3-01 P0）；产物读取无主体维度（W3-02 P0）；owner 由 sessionId 派生（W3-03 P1）；消息正文未写 blob（W3-04 P1）；未知会话上传 500（W3-05 P1）；失效产物仍可预览（W3-06）；AC-006 未实现（W3-07 P1）；用户消息不建 Authorization（W3-08 P1）；token 只增不减/`prune` 无调用方（W3-09）；归档会话仍接受上传（W3-10）；`expireStale` 无调用方（W3-11）；错误响应无 §1 封装（W3-12）；记录不一致（W3-13）；浏览器级攻防未验（W3-14，承接 WP-10）。另 5 项对抗性（内联预览字节上限、文件签名、`targetWorkId` 归属、隔离只靠客户端头、失败上传孤儿 blob 与 staged 无上限）。

## 附二：第二轮摘要（保留）

第二轮（报告冻结于 `8e4efc1`，被审代码树与 HEAD 同为 `a946ed6`）结论 **FAIL**：主要判据 W3R2-01（AC-006 未实现）与 W3R2-02（AC-005 未实现），另 2×P2（W3R2-03 CSP 漂移、W3R2-04 StorageError 映射/回显）、9×P3（W3R2-05..13）。第二轮对抗性 7 项：1/3/4/5/7 已修，2 部分（语义可辩护），6 已修但无测试守护。六条契约命令全绿但不足以支撑必验范围。

## 附三：第三轮摘要（保留）

第三轮（报告冻结于 `35e8674`，被审代码树 `d71dc07`）结论 **FAIL**：AC-005 的授权机制（`routeMessage`、消息级 Authorization 行、`work.authorizationRef`、Assessment、混合意图多 Work 与独立 scope）全部**落库**且成立，但 `grantedByMessage` 生成 `readPaths:['docs']` + `operations:['edit']` 的自相矛盾授权，使绑定它的 Work 的任何 Run/Assessment 都被 `capabilityGaps:['readPaths without a read operation']` 拒绝——交付路线在准入即死锁（W3R3-01 P1）。新增 **1×P1、5×P2、8×P3**；对抗性另指出疑问句被当作执行消息、HTTP 客户端可自报 `authorization`（甚至 `deploy`）。失败路由 `Blocking Review Finding → Develop → Independent Review`。

| 三轮编号 | 严重度 | 摘要 | 第五轮状态 |
|---|---|---|---|
| W3R3-01 | P1 | 授权 capability 缺口 → 交付死锁 | 已修（本轮 probeF 端到端复核仍成立） |
| W3R3-02 | P2 | 授权绑定 `works[0]` | 已修（W3R4-02 闭合） |
| W3R3-03 | P2 | 授权自相矛盾 | 已修 |
| W3R3-04 | P2 | HTTP 响应不含 `workIds`/`authorizationId` | 响应已含；`protocol.md` 仍未对账（W3R5-07） |
| W3R3-05 | P2 | 同 intent 重复共享 scope | 部分（越权侧闭合；第二项空 scope） |
| W3R3-06 | P2 | CSP 与 `execution.md` §6 漂移 | 逐字一致；无效第二头名残留（W3R5-03） |
| W3R3-07 | P2 | StorageError 映射过宽 + 回显 | 回显已修；映射细分仍缺 |
| W3R3-08 | P3 | `download.prepare` 不报 validity | 已修 |
| W3R3-09 | P3 | `targetWorkId` 归属只覆盖 message 来源 | 未修（W3R5-05） |
| W3R3-10 | P3 | daemon/Core owner 派生不一致 | 未修（latent） |
| W3R3-11 | P3 | `prune()` 无调用方 | 已修 |
| W3R3-12 | P3 | AC-005 证据止于「行存在」 | 部分（仍无 Orchestrator 用例） |
| W3R3-13 | P3 | 记录与实测数字不符 | 部分（T11 已正，T6/T10 未正） |
| W3R3-14 | P3 | `workItems`/`authorization`/`projectId`/多文件 | 部分（`workItems` 已校验；协议/多文件未修） |

## 附四：第四轮摘要（保留）

第四轮（报告冻结于 `fd0a893`，被审代码树 `3f52fbf`）结论 **PASS（0×P1、3×P2、11×P3）**，但同轮对抗性核验以 HTTP 端到端证伪「越权已闭合」：`explain why … needs a fix`、`don't fix …`、`不要修改 …`、`I am not asking you to fix …` 等仍生成写授权并可派发写 Run；另指出 `targetWorkId` 可改写已有 Work 的 level/authorizationRef、`Content-Security-Policy-Sandbox` 不是标准头、消息授权 L1 与 `routingFloor` 的 L2 不一致、`workItems:[null]`/`intent:'operation'` 造成 500 或非法 Work。第四轮 P2 集中在未文档化的客户端 `workItems` 与不可达的纵深防御，故判不阻断 Test。

| 四轮编号 | 严重度 | 摘要 | 第五轮状态 |
|---|---|---|---|
| W3R4-01 | P2 | 同 intent 多 Work 共用 scope | 部分（越权闭合，第二项空 scope） |
| W3R4-02 | P2 | `workItems` 把授权挂到只读 Work | **已修** |
| W3R4-03 | P2 | `assertGrantWithinMessage` 不约束 `readPaths` | 未修（latent）→ W3R5-04 |
| W3R4-04 | P3 | `workItems` 未校验 → 500 | **已修**（400 + 回滚） |
| W3R4-05 | P3 | 无 Orchestrator 授权回归用例 | 未修 → W3R5-08 |
| W3R4-06 | P3 | `protocol.md` 未对账 | 未修 → W3R5-07 |
| W3R4-07 | P3 | `message.received` 缺 `workIds`/`authorizationId` | **已修** |
| W3R4-08 | P3 | `StorageError` 映射粗 | 部分（无进展） |
| W3R4-09 | P3 | 记录数字不符 | 部分（T11 正、T6/T10 未正） |
| W3R4-10 | P3 | `targetWorkId` 归属只覆盖 message 来源 | 未修 → W3R5-05 |
| W3R4-11 | P3 | 失败发送孤儿 blob | 未修 → W3R5-06 |
| W3R4-12 | P3 | multipart 多文件 / `projectId` | 未修 → W3R5-08 |
| W3R4-13 | P3 | 错误响应非 §1 封装 | 未修 → W3R5-08 |
| W3R4-14 | P3 | 冻结点与任务不一致 | 复发 → W3R5-09 |

第四轮对抗性六项（逐子句分类 / 线性路径 / `targetWorkId` / L2 一致性 / `workItems` 校验 / CSP 单头）在第五轮的实测结论见 §3：**线性路径、`targetWorkId`、L2 一致性、`workItems` 校验确已修好；逐子句分类仅部分修好（新句式仍越权 + 新增误拒缺陷）；CSP 单头未修且记录不实。**
