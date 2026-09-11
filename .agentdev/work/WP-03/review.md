# WP-03 独立 Review 报告（第十轮）

- 评审对象：工作包 WP-03「直接协作与说明产物」
- 评审轮次：**第十轮**（第一～九轮摘要见文末「附一～附九」，全部保留）
- 冻结点 / HEAD：`git rev-parse HEAD` = `e384dd10b84a1e6bfcf1612ad9f5dc706e232590`（**与任务下达的 `HEAD=e384dd1` 一致**）；`git diff --stat 0fb5c71 e384dd1` 只有 `.agentdev/work/WP-03/review.md`，**被审代码树 = `0fb5c71`**
- 工作树：本轮全部命令执行前后 `git status --porcelain` 为空；被审代码树（`packages/**`、`apps/**`、`docs/**`）无任何未提交修改（写入本报告后才会出现 ` M .agentdev/work/WP-03/review.md`）
- 评审角色：Review（独立上下文；未读取任何开发/Test 会话；只依据仓库文件、契约文档与 `/tmp/w3r10/` 下我自建的 8 个实验脚本）
- 工具：`node v24.8.0`、`pnpm 12.3.4`、macOS 宿主
- 记录哈希（`git hash-object`，前 8 位）：`packages/domain/src/requests.ts` **`253373f6`**（T17 修复后）、`packages/core/src/messages.ts` `283d4c04`、`packages/core/src/artifacts.ts` `057ff403`、`packages/core/src/attachments.ts` `3ee94838`、`packages/core/src/preview.ts` `803b502a`、`apps/daemon/src/server.ts` `3a348304`、`packages/domain/test/domain.test.ts` **`3616bba4`**、`packages/core/test/artifacts.test.ts` `c6011971`、`apps/daemon/test/server.test.ts` `3511c2ee`
- 权威依据：`AGENTS.md`、`docs/INDEX.md`、`docs/rules/{workflow,agents}.md`、`docs/product/experience.md`（§3）、`docs/architecture/{data,protocol,execution,reliability}.md`、`docs/delivery/{implementation,acceptance}.md`（AC-001..006/052/076/084）、`.agentdev/work/WP-03/{plan,implementation,review}.md`、`packages/**`、`apps/daemon/**`、相关测试

---

## 1. 结论

**FAIL（不能进入独立 Test；按 `docs/rules/workflow.md` §6 走 `Blocking Review Finding → Develop → Independent Review`）。**

本轮判 **FAIL（0×P0、2×P1、1×P2、3×P3）**。第九轮点名的三组 P1 中，**两组真修好、一组只修了登记原句**：

- **真修好（有正面证据）**：第九轮 P1 的「句首 `V了` / `V完了` 完成体陈述」整族（`补充了 X`、`优化了 X`、`改好了 X`、`删除掉了 X`、`修复完了 X`、`更新完毕 X`、跨子句 `更新了接口文档，补充了 X 的说明` 等 **23 句**）**全部只读**；受事/被动（`X 需要被修改`、`X 会被清理` 等）、引用（`需求写着：修改 X`）、名词化（`关于 X 的修改`）、无标点动词罗列（`X 修复 更新 整理`、`fix X update Y`）、逗号参照（`参考 X 修改 Y`）全部只读。登记语料 **71 负 + 19 正 + 4 作用域断言 100% 与冻结期望一致**（我独立从测试源提取文本、用构建产物复跑，不 import 产品测试文件）。
- **只修了登记原句**：第九轮 P1 的两族**变体仍 fail-open**——**选择疑问/征询语气**（`更新 X 还是新建一个文档`、`修 X 行不行`、`修改 X 该不该`、`fix X vs. leave it`、`refactor X, yes or no` 等，我自建矩阵 **14/36 fail-open**）与**无显式条件词的条件前件**（`一旦确认，修复 X`、`经确认后，修改 X`、`有错误的话，修复 X`、`once approved, fix X`、`after you confirm, update X` 等，**6/18 fail-open**）。这两族在**真实 HTTP + 真实 `Orchestrator`** 下端到端生成 `Authorization` 行、`Work.level=L2`、`intent=delivery`，并**成功派发真实 `backend/purpose=implementation` 写 Run**（`probe4`：7 条非祈使句各 1 个写 Run；对照组 `修改 X 中的错别字`、`X 的错别字麻烦处理下` 同样成功，说明闸门本身正常、问题在授权判定）。

新增 **6 条 Finding：0×P0、2×P1、1×P2、3×P3**。两条 P1 均落在本包验收面（AC-004 负例、`workflow.md` §1 授权边界），**阻断 Test**。

| 维度 | 第九轮 | 第十轮 |
|---|---|---|
| 判定式结构 | 白名单 + 默认只读 | **不变（结构正确）** |
| 第九轮 P1「句首 `V了`/`V完了` 完成体」 | fail-open（13/14 授权） | **已修：23 句 0 授权（HTTP + e2e 复核）** |
| 第九轮 P1「选择疑问」 | fail-open | **登记原句已修（`好还是不改好`/`or leave it alone` 只读）；14/36 变体仍 fail-open** |
| 第九轮 P1「逗号参照从句」 | fail-open（授权了参照路径） | **已按 T17 收窄为「参照从句只授权自身命名目标」**：`参考 X，修改 Y` / `based on X, update Y` 只授权 Y，X 不入写范围（4/4 作用域断言成立；**判定口径已变更，非缺陷**） |
| 登记语料 71 负 + 19 正 + 4 作用域 | 57 + 17 + 2 | **71 + 19 + 4 全部成立（0 偏差）** |
| 文档化正例 | 28/28 | **39 句正例扫描：37 通过、2 误拒（均含「过时」复合词）** |
| 客户端注入面 | 无通路 | **无通路（11 项注入：零授权行、零新 Work/scope；未知字段静默忽略仍为 fail-closed）** |
| P1 数量 | 3 | **2** |

---

## 2. 契约命令原始结果（本轮实跑）

执行目录：仓库根；逐条串行。全部在 `HEAD=e384dd1`、被审代码树 `0fb5c71`、`pnpm build` 产物（`dist/requests.js` 时间戳 Sep 11 20:48:22 晚于源码 Sep 11 20:45:52）上执行。

| 命令 | 退出码 | 原始结果要点 |
|---|---|---|
| `pnpm typecheck` | **0** | `tsc -p tsconfig.json --pretty false`，无输出 |
| `pnpm lint` | **0** | `Checking formatting... All matched files use Prettier code style!` |
| `pnpm test:unit` | **0** | `Test Files 19 passed (19)`、`Tests 289 passed (289)`（含 `domain.test.ts` 32 例、`server.test.ts` 17 例、`artifacts.test.ts` 16 例） |
| `pnpm test:integration` | **0** | `Test Files 10 passed (10)`、`Tests 124 passed (124)`（含 `container.integration.test.ts` 9 例真实容器） |
| `pnpm docs:check` | **0** | `docs:check ok — 15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages` |
| `pnpm build` | **0** | `pnpm -r build`，**8** 个 workspace `build: Done`：`contracts, cli, domain, storage, core, daemon, pi-runtime, runner` |

`git status --porcelain`（写入本报告前）：**空输出**；`HEAD` 全程 `e384dd10b84a1e6bfcf1612ad9f5dc706e232590`。
计数对账：`implementation.md:203`（T17）的 `289 / 124 / 8 / docs:check ok` 与实测**一致**；`docs:check` 的 `15/55/94/9/11` 与第九轮逐字一致（无文档漂移）。

**命令全绿不等于必验范围成立**：本轮两条 P1 的**全部证据句都不在回归网内**——`grep "还是\|一旦\|的话\|yes or no\|vs\."` 在产品测试中只命中 `domain.test.ts:349` 的登记原句 `修改 docs/INDEX.md 好还是不改好` 一条；`Orchestrator` 只出现在 `orchestrator.test.ts`/`join.test.ts`，`apps/daemon/test/server.test.ts` 与 `packages/core/test/artifacts.test.ts` 仍**不含** `Orchestrator`（W3R4-05 未闭合，第九轮 P3 承接项延续）。全部越权与端到端证据由我自建脚本建立：`/tmp/w3r10/{probe1-domain,probe2-templates,probe3-http,probe4-e2e,probe5-corpus,probe6-injection,probe7-precise,probe8-extra}.mjs`。

---

## 3. 越权方向（独立穷举核验）

### 3.1 口径声明（先声明后实测）

- **缺陷**：句子**不是祈使指令**（陈述/完成体/被动/疑问/反问/选择疑问/条件前件/引用/名词化/无标点罗列/逗号参照/征询），却在 `routeMessage` 上产生 `explicitAuthorization=true`（`writePaths` 非空）。
- **非缺陷（已声明代价，planVersion 2）**：未登记同义祈使（`重写/润色/rewrite/polish/tweak` 等）落只读 + 澄清。
- **本轮口径变更（记录在案）**：第九轮 P1「修饰性从句前置」（`based on X, update Y`）在本轮实现中**只授权其自身命名的目标 Y**（X 不入写范围），并在 `domain.test.ts:389-397` 成为正例与作用域断言；T17 明确「参照/修饰从句只授权其自身命名的目标」。我按**新口径**判定：**X 不入写范围即不越权**（见 §3.3）。

### 3.2 非祈使语料：150/165 只读，15 句越权（2 个形态族）

`probe1-domain.mjs`（165 条非祈使句、覆盖任务点名的 11 类句式）+ `probe2-templates.mjs`（119 条负向模板观测）：

| 族 | 语料句数 | 授权 | 结论 |
|---|---|---|---|
| 完成体/陈述（`V了/V完了/V好了/V掉了 + 路径`、`已经/刚 + V`、英文 `I fixed/I have fixed`） | 23 | **0** | 第九轮 P1 **已修** |
| 被动/认识情态（`需要被修改`、`会被清理`、`值得被优化`、`needs a fix`） | 18 | **0** | 已闭合 |
| 引用/转述/名词化（`需求写着：`、`关于 X 的修改`、`the fix in X`） | 14 | **0** | 已闭合 |
| 无标点动词罗列（`X 修复 更新 整理`、`fix X update Y`） | 6 | **0** | 已闭合 |
| 逗号参照（`参考 X 修改 Y` 无逗号） | 1 | **0** | 已闭合 |
| 拒绝/否定/建议/只读言说/前置条件 | 56 | **0** | 已闭合 |
| 反问/普通疑问（`难道要修复 X 吗`、`凭什么改 X`、`Who asked you to fix X`） | 21 | **0** | 已闭合 |
| **选择疑问/征询语气（形态族 A）** | **23** | **15** | **W3R10-01** |
| **条件前件（形态族 B）** | **9** | **2** | **W3R10-02** |
| 未登记祈使（fail-closed 侧，预期只读） | 13 | 1（`完善一下 X 的说明`，实为祈使） | 不计缺陷 |

`probe2-templates.mjs` 的模板矩阵另测：`被` × 12 动词、`需要` × 12 动词、`V了` × 12 动词、`V完了` × 12 动词、英文被动/完成 × 12 组合，**合计 96 条被动/情态/完成体模板，0 条授权**；37 条正向模板（30 个登记变更动词的中英祈使）**37/37 授权**。

### 3.3 参照从句作用域（新口径下的独立复核）

`probe7-precise.mjs` 的 4 条作用域断言 **4/4** 成立：`参考 X，修改 Y`、`based on X, update Y`、`修改 Y 而不是 X`、`update Y instead of X` 的 `writePaths` **只含 Y**。另测 10 条参照变体（`according to`、`follow`、`see`、`for`、`as described in`、`根据`、`using`），全部只授权 Y、从不授权 X（`REF-OK 10/10`）。**结论：第九轮 P1 点名的「参照路径进入写范围」已按 T17 关闭，不构成本轮 Finding。**

### 3.4 HTTP 与真实 Orchestrator 端到端（越权可执行性）

- `probe3-http.mjs`（真实 daemon：真实 SQLite + 真实 blob + Bearer/CSRF 链路）：30 条负向语料中 **7 条 fail-open**，均表现为 HTTP 202、`authorizationId=SET`、新增 1 条 `authorization` 行、`Work.level=["L2"]`、`intent=["delivery"]`、`writePaths=["docs/INDEX.md"]`、写入 1 条 `assessment` 行；5 条正向语料 **5/5 授权**且写入范围只含目标。
- `probe4-e2e.mjs`（真实 `Orchestrator.assess` + `dispatch`，真实 Chief Run → 真实 `backend/purpose=implementation` 写 Run）：**7 条非祈使句各成功建立 1 个写 Run**（`writeRuns=["…:backend:queued"]`），全部经 `assess`（L2 + `authorizationRef` 通过 `verifyAuthorization`）与 Chief 父 Run；对照组 `修改 X 中的错别字`、`X 的错别字麻烦处理下`、`解释 X 并修复 Y` 同样成功建立写 Run，**证明准入闸门正常、越权来自授权判定**。

### 3.5 危害上界

越权授权的范围恒等于句中**被点名的那一个路径**，`operations=['read','edit']`、`networkTargets=[]`；环境/网络/越界路径仍被 `Orchestrator.verifyAuthorization` 拒绝。因此危害是「**用户没有下达指令，却产生了可执行的写授权与真实写 Run**」，属 `workflow.md` §6 的 P1（错误行为/需求缺失）+ AC-004 负例失败，**不是数据/安全级 P0**。

---

## 4. 文档化正例复核（明确修复 / 中文日常祈使 / 混合意图 / 目标排除 / 否定后纠正 / 参照目标）

- **登记正例 19/19 成立**（`probe7-precise.mjs` 独立提取 + 构建产物复跑）。
- **扩展正例扫描 39 句：37 通过、2 误拒**（`删除 docs/INDEX.md 的过时内容`、`清理 docs/INDEX.md 的过时内容`），前者正是 `docs/product/experience.md` §3 的规范动作「删除 X 中的过时内容」——**W3R10-03**。其余覆盖：明确修复（中英）、`请/麻烦/帮我/帮忙 + V`、`把 X 里的错别字改掉`、`X 的错别字麻烦处理下`（尾式）、`识别并修复`、`特别修改`、`但要修复/而是更新/然后重构`（前缀归一）、`别改 A，改 B`/`不要修改 A，但要修复 B`（否定后纠正）、`解释 X 并修复 Y`/`先解释 X，再修改 Y`（混合意图）、`修改 X、Y`（顿号列表）、`修改 X 而不是 Y`（目标排除）、`参考 X，修改 Y`（参照目标）、`regarding X, fix Y`。
- **HTTP 复核**：正向 5/5 建 `Authorization` + delivery Work；`解释 X 并修复 Y` 建 2 个 Work（assist + delivery）且写范围只含 Y（AC-006）。

---

## 5. 客户端注入面与前九轮 P0/P1 无回归复核

### 5.1 注入面（`probe6-injection.mjs`，真实 HTTP）

| 注入 | HTTP | 库结果 |
|---|---|---|
| `workItems:[…×50]` | 202（忽略） | workDelta=1（仅路由产出）、authDelta=0 |
| `authorization:{scope:{writePaths:['packages/core/src'],operations:['read','edit']}}` | 202（忽略） | authDelta=0、响应 `authorizationId=null` |
| `authorization:{operations:['deploy'],networkTargets:['10.0.0.5']}` | 202（忽略） | 零授权行 |
| `grants:[{operation:'edit',targets:[…]}]` | 202（忽略） | 零授权行 |
| `scope:{writePaths:['packages/core']}` + `level:'L3'` + `intent:'operation'` | 202（忽略） | 零授权行、无 L3 Work |
| 未知字段 `foo:1`、`targetRole:'backend'`、`ownerUserId:'attacker'` | 202（**静默忽略**） | 无副作用（W3R10-06 承接 `protocol.md` §1） |
| 空 body / 缺 `conversationId` | **400** `{ok,error}` | 零副作用 |
| 未知 `conversationId` | **404** `{ok,error}` | 零副作用 |

**结论：wire 层不存在 `authorization`/`workItems`/`grants`/`scope`/`level`/`intent` 通路，11 项注入零授权行、零越权 Work，无回归。** 唯一相关不一致是未知字段应 `VALIDATION_ERROR` 而实现静默忽略（fail-closed 方向，自第八轮 W3R8-05 起承接）。

### 5.2 前九轮 P0/P1 复核表

| 项目 | 第十轮实测 | 状态 |
|---|---|---|
| W3-01 下载 token 可预测/先于认证（P0） | `server.test.ts:395` 用例通过；`server.ts:93-99` 一次性 token | 无回归 |
| W3-02 产物读取无主体维度（P0） | `assertReadable` 仍在预览/下载路径 | 无回归 |
| W3R3-01 授权 capability 缺口致死锁（P1） | `probe4` 中正例 assess/dispatch 全通（含 `readPaths`+`read` 操作） | 无回归 |
| W3R5-01 非执行消息产生写授权（P1） | 完成体/被动/引用/罗列/反问/拒绝已闭合；**选择疑问 + 条件前件变体仍在（W3R10-01/02）** | **部分未闭合** |
| W3R7-01 只读请求词授权（P1） | `READ_ONLY_VERBS*` + 白名单；`看一下/检查/评估/总结/列出` 全只读 | 无回归 |
| W3R7-02 完成体/疑问变体（P1） | 登记原句与大批变体已修；**选择疑问形态仍缺（W3R10-01）** | **部分未闭合** |
| W3R7-03 混合否定+指令误拒（P1） | `别改 A，改 B`、`不要修改 A，但要修复 B` 均只授权 B | 无回归 |
| A1 目标级排除 / A2 中文混合 / A3 纯建议（P1） | 4/4 作用域断言、混合 2/2、建议全只读 | 无回归 |
| W3R3-06 CSP 单头/逐字相等（P2） | `preview.ts` 哈希与第九轮逐字相同；`server.test.ts:119/187` 通过 | 无回归 |
| W3R4-03 `assertGrantWithinMessage` 约束 `readPaths` | 代码仍在（`messages.ts`）；`probe6` 的 `authorization` 注入被忽略 | 无回归 |
| 登记语料 71 负 + 19 正 + 4 作用域 | **0 偏差** | 无回归 |

**未闭合承接**（P3，不单独阻断）：W3R4-05（无 Orchestrator 授权回归用例；grep 仍 0 命中于 daemon/artifacts 测试）、W3R4-06（`protocol.md` §5 未对账）、W3R4-08（`StorageError` 映射粗）、W3R4-10（`targetWorkId` 归属只覆盖 message 来源）、W3R4-12（multipart 多文件 / `projectId`）、W3R4-13（错误响应非 §1 封装）。

---

## 6. 记录与实现一致性核对

| 记录项 | 实测 | 结论 |
|---|---|---|
| T17 回归网「71 条不得授权」 | 独立提取 = **71**（负例块 285–359 行），复跑 0 偏差 | **准确** |
| T17「19 条必须授权 + 4 条作用域断言」 | 独立提取 = **19**；作用域 4/4 | **准确** |
| T17 验证数字 `289 / 124 / 8 / docs:check ok` | 逐条实测一致 | **准确** |
| T17「非祈使标记（被/需要/应该/…/过/了）任一 ⇒ 不授权」 | `over` 类复合词（`过时`）导致 2 条**文档化正例误拒** | **不准确（W3R10-03/04）** |
| T17「选择疑问与完成体粒子只读」 | 完成体粒子族已闭合；选择疑问仅登记原句闭合，14/36 变体越权 | **不准确（W3R10-01）** |
| T17「条件继承」 | 仅 `如果/假如/若是/要是/万一/假设` 触发继承；`一旦/经确认后/有错误的话/once/after` 不触发 | **不准确（W3R10-02）** |
| T17「参照从句只授权自身命名目标」 | 4 作用域断言 + 10 变体全部成立 | **准确** |
| T15 声称「不再出现『一律/永不』的绝对表述」 | `implementation.md:186`「其余（陈述、完成体、疑问…）**一律只读**」、`:140`「…**一律只读**」仍在 | **名实不符（W3R10-04）** |
| 第八轮报告 `review.md` 记录 `domain.test.ts` 哈希 | `7483338` 为 **7 位**；实际 `git hash-object` = `3616bba4`（且该文件在 `d23ce7b→0fb5c71` 有改动，8 位前 7 不匹配） | **笔误（W3R10-06）** |
| `implementation.md:11`（T1「一律 `INTERNAL_ERROR`」） | 代码事实 | 非启发式声明，不影响判定 |

**记录侧硬约束（对 Test 有直接影响）**：`implementation.md:186` 的绝对声明与 `:201-204` 的「第九轮全部语料已修」并列，会让 Test 以「选择疑问已闭合」为前提；实际仅登记原句闭合。

---

## 7. 新 Findings（W3R10-xx）

### W3R10-01 [P1] 选择疑问/征询语气的**变体**仍产生写授权并可派发真实写 Run

- **位置**：`packages/domain/src/requests.ts:123-129`（`CHOICE_PATTERNS`）——实际只有 `好还是|还是不改|还是不|或者不|要不要|是否要` 与 `or leave|or not\b|or keep|yes or no|which (one|is better)`；**没有裸 `还是`、`或者`（不接「不」时）、`抑或`、`要不然`、`该不该`、`对不对`、`行不行`、`可以不可以`、`怎么样`（仅在 `ADVICE_PATTERNS` 的部分词内）、`vs.`、`versus`、`either … or`**。
- **第九轮状态**：W3R9-02 登记原句 `修改 X 好还是不改好`、`fix X or leave it alone` **已修**（HTTP 复核只读）。
- **本轮实测（我自建，未登记）**：`probe2` 的选择疑问矩阵 **14/36 fail-open**；`probe8` 另补 `修改哪个文件 X`、`修改 X 也行`、`先修改 X 也可以` 3 句越权。授权样本：
  - 中文：`更新 X 还是新建一个文档`、`更新 X 还是保留`、`修改 X 还是保持原样`、`修复 X 或者只是记录问题`、`修复 X 或记录问题`、`修 X 行不行`、`修改 X 该不该`、`修改 X 对不对`、`修改 X 哪个更好`、`修改 X 抑或重写`、`修改 X 要不然保留`、`修改 X 也行`、`先修改 X 也可以`、`修改哪个文件 X`
  - 英文：`refactor packages/core/src/artifacts.ts, yes or no`、`fix X vs. leave it`、`fix X versus rewriting it`
- **对照（同一形态、结论相反）**：`修改 X 好不好`、`修改 X 或者不修改`、`修改 X 或者不改`、`修 X 可不可以`、`修改 X 要不要`、`修改 X 怎么样`、`修改 X or not` **均只读**——同一句式的变体因词表命中与否而结论相反，**证明判定未落到「选择疑问形态」上，仍是词表枚举**（与第七、八、九轮同根因）。
- **HTTP + e2e**：`probe3` 5 句中 5 句落库授权（`authId=SET`、`L2`、1 授权行）；`probe4` 同样 5 句各建立 1 个真实 `backend/implementation` 写 Run（另 `refactor …, yes or no` 亦建立写 Run，合计 6 句端到端可执行）。
- **修复方向（结构性）**：把「选择疑问/征询形态」整体并入疑问守卫，而不是继续枚举——中文 `(?:还|或)是|抑或|要不然|要(?:不|么)然?|该不该|对不对|行不行|可不可以|好不好|要不要|是否要|哪个|哪些|也行|也可以`；英文 `\b(?:or|either|vs\.?|versus|yes or no|or not|whichever)\b`。并同步补 `domain.test.ts` 与 `apps/daemon/test/server.test.ts` 的 HTTP 断言（现只登记 1 条）。
- **验收面**：AC-004 负例失败；`workflow.md` §1「执行消息可直接授权明确目标」被扩大到「询问是否该改」。

### W3R10-02 [P1] 不触发条件继承的**条件前件**变体仍产生写授权并可派发真实写 Run

- **位置**：`requests.ts:131-137`（`HYPOTHETICAL_PATTERNS` 只有 `如果|假如|若是|要是|万一|假设` / `if|whether|suppose|assuming|in case`）+ `:366-379`（`conditional = isConditional`，继承依赖该词表）。
- **第九轮状态**：W3R9 点名的 `如果要改，就修改 X` **已修**（HTTP 复核只读）。
- **本轮实测（我自建，未登记）**：`probe2`/`probe8` 条件矩阵 **6/18 fail-open**：`一旦确认，修复 X`、`一旦发现错误，修改 X`、`经确认后，修改 X`、`有错误的话，修复 X`、`once approved, fix X`、`after you confirm, update X`。
- **对照（只读，说明词表命中与否决定结论）**：`一旦需要就修改 X`、`待确认后修改 X`、`确认无误后修改 X`、`等测试通过再修改 X`、`如果有问题就修复 X`、`有问题就修复 X`、`发现错误就修改 X`、`需要的时候就修改 X`、`看情况修改 X`、`酌情修改 X` **均只读**。
- **根因**：条件身份仍是**词表**，而不是「前件形态 + 后续祈使的依附关系」；`一旦`/`经…后`/`…的话`/`once`/`after` 这些同为条件前件的形态未登记，于是后面的祈使子句被当作独立指令。
- **HTTP + e2e**：`probe3` 2/2 落库授权；`probe4` 2/2 建立真实写 Run（`一旦确认，修复 X`、`after you confirm, update X`）。
- **修复方向（结构性）**：条件继承改为「前件形态」判定——前面子句以 `一旦|经|通过|等|待|…的话|之后|以后|once|after|following` 等前件标记结尾（或以 `，` 收束的从句）时抑制其**相邻**指令子句的授权；并补回归句。
- **验收面**：同 W3R10-01。

### W3R10-03 [P2] `NON_COMMAND_MARKERS` 的**单字命中**误杀文档化正例（含 `docs/product/experience.md` §3 的「删除过时内容」）

- **位置**：`requests.ts:270-271`（`NON_COMMAND_MARKERS` 含裸 `过`、`了`、`会`、`被`）+ `:274-283`（对整子句做 `test`，不区分词内字符与语法标记）。
- **实测**：`删除 docs/INDEX.md 的过时内容`、`清理 docs/INDEX.md 的过时内容`、`更新 docs/INDEX.md 的过时内容`、`修改 docs/INDEX.md 的过时内容`、`删除 docs/INDEX.md 里过时的内容` **全部只读**；对照 `删除 docs/INDEX.md 的旧内容`、`清理 docs/INDEX.md 的陈旧内容`、`更新 docs/INDEX.md 的说明`、`更新 docs/INDEX.md 里的接口` **全部授权**。即：唯一差别是名词里的 `过` 字。
- **影响**：`删除过期内容` 是 `experience.md` §3 说明产物的规范动作，用户必须换词才能下达指令（澄清一轮）；同类复合词（如 `机会成本`、`被动语态`、`需求说明`）中只要有 `过/会/被`，指令一律被拒。
- **性质**：**方向为 fail-closed（不产生越权）**，但属「文档化正例被误拒」，与第九轮反例方向相反；`planVersion 2` 只声明了未登记措辞的 fail-closed 代价，**没有**声明「登记动词 + 常见复合词」也会被拒。
- **修复方向**：marker 判定按词边界/上下文收窄（例如 `过` 仅当出现在动词后、`被` 仅在动词前、`会` 仅在动词前），或先剥离 `的…名词` 修饰段再判定。

### W3R10-04 [P3] 记录仍含绝对表述与旧轮次计数，T17 的边界声明与实现不符

- **实测（grep 原文）**：`implementation.md:186`（T16）「…其余（陈述、完成体、疑问、拒绝、建议、主题短语、名词化、前置条件/引用、只读言说行为）**一律只读**」；`:140`（T13）「陈述、完成体与认识情态**一律只读**」；`:113`（T11）「解释句、疑问句、否定句…**永不下发写授权**」。而 `:176`（T15）声称「记录措辞订正：不再出现「一律/永不」的绝对表述」。
- 本轮以 15 条非祈使句授权（`probe3`/`probe4`）证明 `:186` 的「一律只读」不成立；T17 的边界（`:196-204`）也把「选择疑问/条件继承」列为已修。
- **性质**：记录名实不符（连续第四轮）。不单独阻断，但 Test 若以 `:186` 为准会把越权句当预期只读而漏报。旧计数（`27 负 + 14 正`、`57 负 + 17 正`）与 T17 的 `71 负 + 19 正` 并列且未标注失效。
- **建议**：修复轮把 T13/T16 的「一律/永不」改为「已登记语料范围内」并为旧计数加失效标注。

### W3R10-05 [P3] 回归网缺口：选择疑问/条件前件/复合词误拒零断言，授权→`assess`/`dispatch` 仍无产品用例

- **实测**：`domain.test.ts` 负例表仅 1 条选择疑问（`:349`）、0 条 `一旦/的话/once/after`、0 条 `过时`；`apps/daemon/test/server.test.ts` 的只读 HTTP 断言仅 4 句（`:530-552`）；`grep -l Orchestrator` 未命中 `server.test.ts`/`artifacts.test.ts`（W3R4-05 延续）。
- **性质**：不阻断（本轮 P1 已由我自建脚本证明），但修复后必须以回归断言固化，否则同类变体会再次逃逸。

### W3R10-06 [P3] 协议对账与记录笔误承接

- **协议**：`foo:1`/`targetRole:'backend'` 仍 **202 静默忽略**（`protocol.md:11` 要求未知字段 `VALIDATION_ERROR`）；响应含 `workIds`/`authorizationId`，`protocol.md:46` 只列 `{messageId,workId,state,version}`（加法扩展未在文档侧对账）。方向 fail-closed，承接自 W3R8-05。
- **记录笔误**：第八轮报告 `review.md:9` 的 `packages/domain/test/domain.test.ts` 哈希写作 `7483338`（**7 位**），且与 `0fb5c71` 实际 `3616bba4` 不符；第九轮报告 `review.md:59` 称「unit 19 文件」虽与实测一致，但未记录该笔误。请在本轮或结算材料订正为 `3616bba4`（T17 版）。
- **同批承接**：W3R4-06/08/10/12/13。

---

## 8. 计数与阻断判定

| 严重度 | 数量 | 编号 | 是否阻断 |
|---|---|---|---|
| P0 | 0 | — | — |
| **P1** | **2** | W3R10-01（选择疑问/征询变体越权）、W3R10-02（条件前件变体越权） | **阻断** |
| P2 | 1 | W3R10-03（复合词 `过时` 误拒文档化正例） | 不单独阻断，须随修复轮订正 |
| P3 | 3 | W3R10-04（记录绝对表述/旧计数）、W3R10-05（回归网缺口/无 Orchestrator 用例）、W3R10-06（协议对账/哈希笔误） | 不阻断，承接 Test |

- 两条 P1 **均落在本包验收面**：AC-004 负例被证伪、`workflow.md` §1 授权边界被证伪；且**均以真实 HTTP + 真实 `Orchestrator` 证明可派发真实 Backend 写 Run**（`/tmp/w3r10/probe4`，7 条）。
- 失败路由：`Blocking Review Finding → Develop → Independent Review`（`docs/rules/workflow.md` §6）。
- 第九轮 3 条 P1 的本轮裁定：**W3R9-01 已修（23 句 0 授权）**；**W3R9-02 只修登记原句（→ W3R10-01）**；**W3R9-03 已按 T17 新口径关闭（参照只授权自身目标，4/4 + 10 变体）**。

---

## 9. 能否进入独立 Test —— **不能**

**判据**：`docs/rules/workflow.md` §6「P0/P1 阻断」。两条 P1 中任意一条即足以阻断，且均可端到端复现。**必须先走 `Develop → Independent Review`。**

### 9.1 修复后重评的最低要求（回归网）

以下新增句必须只读（并落成长期断言）：

1. **选择疑问/征询**：`更新 X 还是新建一个文档`、`修改 X 还是保持原样`、`修 X 行不行`、`修改 X 该不该`、`修改 X 对不对`、`修改 X 哪个更好`、`修改 X 也行`、`修改哪个文件 X`、`fix X vs. leave it`、`refactor X, yes or no`。
2. **条件前件**：`一旦确认，修复 X`、`经确认后，修改 X`、`有错误的话，修复 X`、`once approved, fix X`、`after you confirm, update X`。
3. **不得回归**：`修改 X 好还是不改好`、`fix X or leave it alone`、`如果要改，就修改 X` 仍只读；`删除 X 的过时内容`、`清理 X 的过时内容` 必须授权（W3R10-03）。
4. **登记语料**：71 负 + 19 正 + 4 作用域断言逐句成立。

### 9.2 Test 最小覆盖矩阵（修复轮后必须覆盖）

| # | 维度 | 最小用例（≥） | 期望 |
|---|---|---|---|
| 1 | 选择疑问形态（新增） | 中文 `还是/或者/抑或/要不然/行不行/该不该/对不对/哪个/也行/也可以` 各 1；英文 `or/vs./versus/yes or no/either` 各 1 | 全部只读，零授权行 |
| 2 | 条件前件形态（新增） | `一旦…，V`、`经…后，V`、`…的话，V`、`once/after/if/provided that` 各 1 | 全部只读 |
| 3 | 复合词误拒（新增） | `删除/清理/更新/修改 X 的过时内容`、`更新 X 的说明`、`修改 X 里的需求说明` | 前 4 句授权且 `writePaths` 只含 X；后 2 句授权 |
| 4 | 完成体/被动/引用/罗列/反问（第九轮回归） | 第九轮 23 句完成体 + 被动矩阵抽样（被/需要 × 12 动词） | 全部只读 |
| 5 | 文档化正例不回归 | 明确修复（中英）、`X 的错别字麻烦处理下`、`解释 X 并修复 Y`、`别改 A，改 B`、`修改 X 而不是 Y`、`参考 X，修改 Y` | 全部授权且 `writePaths` 只含目标 |
| 6 | 作用域断言 | 参照/排除/否定纠正 4 句 | 参照与被排除路径不入写范围 |
| 7 | 登记语料 | 71 负 + 19 正 | 逐句成立 |
| 8 | HTTP 端到端（新增） | 上述负例 2 组各 ≥3 句经 `POST conversation.message.send`：`authorizationId=null`、`level=none`、零授权行、无 `delivery` Work | 全部只读 |
| 9 | **Orchestrator 回归（W3R4-05，仍未闭合）** | 授权正例 `assess(L2)` → `dispatch` `backend/implementation` 成功；grant 外路径 + `deploy`/`network` → `NOT_AUTHORIZED` | 建 Run / 拒绝 |
| 10 | 注入面不回归 | `workItems`/`authorization`/`grants`/`scope`/`level`/`intent`/`targetRole`/`ownerUserId` 注入 | 全部忽略且零授权（未知字段按 W3R10-06 决定后断言 `VALIDATION_ERROR` 或「忽略」） |
| 11 | 前轮 P0/P1 | 下载 token 一次性（W3-01）、预览 ACL（W3-02）、`assertGrantWithinMessage`（W3R4-03）、CSP 逐字（W3R3-06） | 无回归 |
| 12 | 附件/产物面 | 上传限制/TTL/重复绑定、版本链/失效、预览截断、单次下载 | 无回归（本轮未动，抽验即可） |

### 9.3 残余风险清单（区分两类）

**A. 文档化缺陷 —— 必须修（阻断）**
1. W3R10-01 选择疑问/征询变体（20 句形态族，HTTP+e2e 7 句可写）。
2. W3R10-02 条件前件变体（6 句形态族，HTTP+e2e 2 句可写）。
3. W3R10-03 复合词 `过时/机会成本/被动` 误拒（含 `experience.md` §3 规范动作）。
4. W3R10-04 记录绝对表述与旧计数（随修复轮订正）。

**B. 未登记句式 fail-closed 代价 —— 已声明，接受并需 Test 承认**
5. 未登记同义祈使（`重写/润色/rewrite/polish/tweak/clean up/去掉/缩短/把 X 改短/X 重写一下`）→ 只读 + 澄清（`plan.md:17-18`、`implementation.md:191`）。
6. 词表前缀的偶然性（`补全 X` 授权、`重写 X` 不授权；`完善一下 X 的说明` 授权而 `适当修改 X` 只读）。
7. 语义分类的最终责任在 WP-04/06 模型 Assessment；本包只承诺已登记语料与形态规则。

**C. 与本包无关或已承接**
8. 真实无头浏览器攻防（WP-10）；真实 Provider 纵向与 `artifact_write` 工具接线（WP-10/WP-07）。
9. W3R10-05/06 与 W3R4-06/08/10/12/13（P3，结算前登记或修复）。

---

## 10. 方法与边界声明

- **独立上下文**：未读取任何开发/Test 会话；结论只来自仓库文件、`docs/**` 契约与我自建的 8 个脚本（`/tmp/w3r10/`），全部消费 `pnpm build` 产物；**未 import 任何产品测试文件**（`domain.test.ts` 仅以文本方式提取语料表，提取后逐句用**构建产物**复跑）。
- **实验统计（观测 / 缺陷证据）**：

| 脚本 | 观测 | 缺陷证据 | 对应 |
|---|---|---|---|
| `probe1-domain.mjs` | 189（165 非祈使 + 24 正例） | 非祈使 **15** 越权；正例 2 误拒 | W3R10-01（15）、W3R10-02（2）、W3R10-03（2） |
| `probe2-templates.mjs` | 166（119 负 + 47 正） | 负向 **17** 越权（选择 14、条件 3）；被动/情态/完成体 96 模板 **0** 越权；正向 37/37 授权、2 误拒 | W3R10-01/02/03 |
| `probe3-http.mjs` | 35（30 负 + 5 正） | 负向 **7** 落库授权（L2 + 1 授权行 + 1 assessment）；正向 5/5 | W3R10-01/02 |
| `probe4-e2e.mjs` | 19（16 负 + 3 正） | **7 条非祈使句各建立真实 `backend/implementation` 写 Run**；3 正例同样建立 | W3R10-01/02 |
| `probe5-corpus.mjs` | 182 | 登记 71 负 replay **0** 偏差、19 正 **0** 偏差；选择 14/36、条件 6/18 越权；正例扫描 2 误拒 | 全轮 |
| `probe6-injection.mjs` | 11 注入项 | 0 授权行、0 越权 Work；4 项静默忽略未知字段 | W3R10-06 |
| `probe7-precise.mjs` | 71 负 + 19 正 + 4 作用域 + 12 复合词 | 作用域 4/4 成立；复合词 `过时` 全部误拒 | W3R10-03 |
| `probe8-extra.mjs` | 32（29 负 + 3 正） | 3 越权（`修改哪个文件 X`、`修改 X 也行`、`先修改 X 也可以`）、1 误拒（`适当修改 X`） | W3R10-01/03 |

- **未做**：真实无头浏览器执行、真实 Provider 纵向、Docker 容器内复验、故障注入下的孤儿 blob 复验、`pnpm test:e2e`/`test:acceptance`（脚本按设计指向 WP-09/WP-10，未实现）。
- **未改仓库**：本轮只覆盖写入 `.agentdev/work/WP-03/review.md`（本报告）；除该文件外 `git status --porcelain` 为空，`HEAD` 仍为 `e384dd10b84a1e6bfcf1612ad9f5dc706e232590`，全部 6 条契约命令在上述工作树上执行。
- **对开发方「严格祈使判定」主张的裁决**：**方向正确、一半落地**——第九轮点名的完成体续写族（`V了/V完了`）确实被**结构性**关闭（23 句 0 授权、被动/情态 96 模板 0 授权、登记 71 正负语料全绿、参照作用域 4/4），这是真实进步；但「疑问/条件」两类**非祈使形态**仍只覆盖登记原句，其变体在真实 HTTP 与真实 Orchestrator 下可产生写 Run，故本轮仍判 **FAIL**。这与第九轮同一根因（形态判定仍靠词表枚举）一致，不属 planVersion 2 免责的「未登记句式 fail-closed」范畴——因为它们是 **fail-open**。

---

## 附一：第一轮摘要（保留）

第一轮（报告冻结于 `a946ed6`，被审代码树 `fd90fef`）结论 **FAIL**：必验范围「实现完整直接协作与产物路线，附件暂存/绑定、隔离预览可实际运行」不成立，新增 14 条 Finding —— **2×P0、5×P1、5×P2、2×P3**；P0/P1 全部阻断，P2 的 W3-06 因影响 AC-002 阻断。要点：下载 token 可预测且下载路由先于认证（W3-01 P0）；产物读取无主体维度（W3-02 P0）；owner 由 sessionId 派生（W3-03 P1）；消息正文未写 blob（W3-04 P1）；未知会话上传 500（W3-05 P1）；失效产物仍可预览（W3-06）；AC-006 未实现（W3-07 P1）；用户消息不建 Authorization（W3-08 P1）；token 只增不减/`prune` 无调用方（W3-09）；归档会话仍接受上传（W3-10）；`expireStale` 无调用方（W3-11）；错误响应无 §1 封装（W3-12）；记录不一致（W3-13）；浏览器级攻防未验（W3-14，承接 WP-10）。另 5 项对抗性（内联预览字节上限、文件签名、`targetWorkId` 归属、隔离只靠客户端头、失败上传孤儿 blob 与 staged 无上限）。

## 附二：第二轮摘要（保留）

第二轮（报告冻结于 `8e4efc1`，被审代码树与 HEAD 同为 `a946ed6`）结论 **FAIL**：主要判据 W3R2-01（AC-006 未实现）与 W3R2-02（AC-005 未实现），另 2×P2（W3R2-03 CSP 漂移、W3R2-04 StorageError 映射/回显）、9×P3（W3R2-05..13）。第二轮对抗性 7 项：1/3/4/5/7 已修，2 部分（语义可辩护），6 已修但无测试守护。六条契约命令全绿但不足以支撑必验范围。

## 附三：第三轮摘要（保留）

第三轮（报告冻结于 `35e8674`，被审代码树 `d71dc07`）结论 **FAIL**：AC-005 的授权机制（`routeMessage`、消息级 Authorization 行、`work.authorizationRef`、Assessment、混合意图多 Work 与独立 scope）全部**落库**且成立，但 `grantedByMessage` 生成 `readPaths:['docs']` + `operations:['edit']` 的自相矛盾授权，使绑定它的 Work 的任何 Run/Assessment 都被 `capabilityGaps:['readPaths without a read operation']` 拒绝——交付路线在准入即死锁（W3R3-01 P1）。新增 **1×P1、5×P2、8×P3**；对抗性另指出疑问句被当作执行消息、HTTP 客户端可自报 `authorization`（甚至 `deploy`）。失败路由 `Blocking Review Finding → Develop → Independent Review`。

| 三轮编号 | 严重度 | 摘要 | 第十轮状态 |
|---|---|---|---|
| W3R3-01 | P1 | 授权 capability 缺口 → 交付死锁 | 已修（probe4 正例评估/派发走通） |
| W3R3-02 | P2 | 授权绑定 `works[0]` | 已修 |
| W3R3-03 | P2 | 授权自相矛盾 | 已修 |
| W3R3-04 | P2 | HTTP 响应不含 `workIds`/`authorizationId` | 响应已含；`protocol.md` 仍未对账（W3R10-06） |
| W3R3-05 | P2 | 同 intent 重复共享 scope | 已修（`workItems` 取消后不再适用） |
| W3R3-06 | P2 | CSP 与 `execution.md` §6 漂移 | 已修且逐字相等 |
| W3R3-07 | P2 | StorageError 映射过宽 + 回显 | 回显已修；映射细分仍缺（W3R10-06） |
| W3R3-08/09/10/11/12/13/14 | P3 | validity/归属/owner 派生/prune/证据/数字/协议项 | 部分未闭合（W3R10-06） |

## 附四：第四轮摘要（保留）

第四轮（报告冻结于 `fd0a893`，被审代码树 `3f52fbf`）结论 **PASS（0×P1、3×P2、11×P3）**，但同轮对抗性核验以 HTTP 端到端证伪「越权已闭合」：`explain why … needs a fix`、`don't fix …`、`不要修改 …`、`I am not asking you to fix …` 等仍生成写授权并可派发写 Run；另指出 `targetWorkId` 可改写已有 Work 的 level/authorizationRef、`Content-Security-Policy-Sandbox` 不是标准头、消息授权 L1 与 `routingFloor` 的 L2 不一致、`workItems:[null]`/`intent:'operation'` 造成 500 或非法 Work。

| 四轮编号 | 严重度 | 摘要 | 第十轮状态 |
|---|---|---|---|
| W3R4-01 | P2 | 同 intent 多 Work 共用 scope | 已修（`workItems` 取消后不再适用） |
| W3R4-02 | P2 | `workItems` 把授权挂到只读 Work | 已修（字段取消） |
| W3R4-03 | P2 | `assertGrantWithinMessage` 不约束 `readPaths` | 已修（probe6 复核） |
| W3R4-04 | P3 | `workItems` 未校验 → 500 | 已修（字段取消） |
| W3R4-05 | P3 | 无 Orchestrator 授权回归用例 | 未修（W3R10-05；grep 仍 0 命中） |
| W3R4-06 | P3 | `protocol.md` 未对账 | 未修（W3R10-06） |
| W3R4-07 | P3 | `message.received` 缺 `workIds`/`authorizationId` | 已修 |
| W3R4-08 | P3 | `StorageError` 映射粗 | 未修（W3R10-06） |
| W3R4-09 | P3 | 记录数字不符 | 本轮数字一致；哈希笔误见 W3R10-06 |
| W3R4-10 | P3 | `targetWorkId` 归属只覆盖 message 来源 | 未修（W3R10-06） |
| W3R4-11 | P3 | 失败发送孤儿 blob | 第十轮不可复现（记录承接） |
| W3R4-12 | P3 | multipart 多文件 / `projectId` | 未修（W3R10-06） |
| W3R4-13 | P3 | 错误响应非 §1 封装 | 未修（W3R10-06） |
| W3R4-14 | P3 | 冻结点与任务不一致 | 第十轮一致（`HEAD=e384dd1`） |

## 附五：第五轮摘要（保留）

第五轮（报告冻结于 `fd0a893`，被审代码树 `3f52fbf`）结论 **FAIL（0×P0、2×P1、2×P2、5×P3）**：

- **W3R5-01 [P1]** 非执行消息（中英文疑问、否定、陈述、名词化解释）仍产生可用写授权并可派发写 Run（17 个新句式，HTTP 端到端验证）。
- **W3R5-02 [P1]** 明确指令被判为拒绝/解释：裸单字 `别` 命中「错别字/识别/特别/分别」、`说明/介绍` 名词化被当解释、`、` 不参与分词、逗号列表只授权首项（7 例误拒）。
- **W3R5-03 [P2]** 无效 `Content-Security-Policy-Sandbox` 头仍在 wire 上，修复记录与提交信息不实（第七轮已订正并实测单头）。
- **W3R5-04 [P2]** 调用方 `authorization.readPaths` 不受消息范围约束（latent；第七轮已修）。
- **W3R5-05..09 [P3]** `targetWorkId` 归属、孤儿正文 blob、记录数字、前轮剩余项、冻结点漂移。
- 同轮确认已修：`pathsIn` 线性化、`targetWorkId` 不改写目标 Work、消息授权 L2 与 `routingFloor` 一致、`workItems` 逐项校验。

第五轮 §6.1 的 17 句越权语料，**第十轮以 `0fb5c71` 复跑全部只读**；§6.2 的 11 句误拒语料剩 1 句（`docs/INDEX.md 的说明需要修改一下`）为 fail-closed。

## 附六：第六轮摘要（报告缺档）

第六轮 Reviewer **未产出报告**（报告文件为空，`HEAD=7c01c9d` 时无 Review 结果入库）。同轮对抗性核验以 `7c01c9d` 为冻结点独立复现，确认第五轮点名的误拒/CSP/`readPaths` 三组已闭合，但补出：陈述/完成体与认识情态（`我已经修改了 X`、`刚修复了 X`、`I already fixed X`、`X 需要修改`、`是否应该修改 X`、`是否需要更新 X`、`麻烦评估一下 X 是否需要修改`）仍产生可派发写授权；`docs/INDEX.md 的错别字麻烦处理下` 等日常祈使句不授权；`workItems` 第二个同 intent 项 scope 为空；记录中「永不下发写授权」措辞不实；另补 `workItems` 无数量上限、`别改 A，改 docs/plan.md` 误拒、CSP 第二头名残留、`assertGrantWithinMessage` 未约束 `readPaths`。

## 附七：第七轮摘要（保留）

第七轮（报告冻结于 `8f8b2df`，被审代码树与之相同）结论 **FAIL（0×P0、3×P1、1×P2、3×P3）**：

- **W3R7-01 [P1]** 只读请求词（`看一下/检查一下/帮忙/帮我/麻烦/请` + 命名路径）获得写授权并可派发写 Run（`848b5c4` 引入的回归；对照 `7c01c9d` 不授权）——**第十轮判定已修，无回归**。
- **W3R7-02 [P1]** 中文完成体因 `\b` 在 Han 语境恒不匹配而形同虚设；中文疑问缺 `谁/哪些/几点`；英文 `needs a fix`/`The fix needed in…` 未覆盖——**第十轮判定：登记原句与大批变体已修；疑问的「选择形态」仍未修（W3R10-01）**。
- **W3R7-03 [P1]** `别改 A，改 B`、`不要修改 A，但要修复 B` 等混合指令误拒（AC-005/006 正例失败）——**第十轮判定已修，无回归**。
- **A1 [P1 对抗性]** 被排除目标仍获写授权（`修改 docs/PLAN.md 而不是 docs/INDEX.md`）——**第十轮判定已修**。
- **A2 [P1 对抗性]** 中文混合意图不拆分（`解释 X 并修复 Y`）——**第十轮判定已修**。
- **A3 [P1 对抗性]** 纯建议请求授权（`请给出 docs/INDEX.md 的修改建议`）——**第十轮判定已修**。
- **W3R7-04 [P2]** 边界声明/记录措辞不实——**第十轮仍未订正（W3R10-04）**。
- **W3R7-05 [P3]** `workItems` 回落 scope 产生不可执行 Work——**第十轮不可复现（字段已取消）**。
- **W3R7-06 [P3]** 前轮未闭合项与记录数字——**第十轮仍在（W3R10-05/06）**。

## 附八：第八轮摘要（保留）

第八轮（报告冻结于 `c82169bc72bbcf8395fb2b00584db8e0b3c60b72`）结论 **FAIL（0×P0、3×P1、1×P2、1×P3）**：

- **W3R8-01 [P1]** 中文完成体/陈述的**形态**未被识别：`已经优化了 X`、`已经整理了 X`、`已经修好了 X`、`改动已完成：X`、`我把它改好了：X` 等 12 个变体仍授权 —— **第十轮判定：已修（全部只读）**。
- **W3R8-02 [P1]** 拒绝与非承诺、以及部分疑问句仍授权（`我不想修改 X`、`别急着修改 X`、`请勿修改 X`、`修改 X 了没有`、`Will you fix X`、`Shall we update X` 等）—— **第十轮判定：拒绝/普通疑问已修；疑问的「选择形态」仍未修（W3R10-01）**。
- **W3R8-03 [P1]** 只读言说行为（解释/评价/了解/请教）中嵌入变更动词即授权 —— **第十轮判定已修（10/10 只读）**。
- **W3R8-04 [P2]** 记录与实现不一致 —— **第十轮仍未订正（W3R10-04）**；本轮计数 71+19 已与实测一致，绝对表述仍在（`:113/:140/:186`）。

## 附九：第九轮摘要（保留）

第九轮（报告冻结于 `d23ce7b1d3c33df8854420941d1a937af9319a2a`；被审代码树同为 `d23ce7b`）结论 **FAIL（0×P0、3×P1、1×P2、2×P3）**，全部以真实 HTTP + 真实 Orchestrator 取证：

- **W3R9-01 [P1]** 句首 `V了` / `V完了` 的**陈述/完成体**仍被当作祈使并授权（`补充了 X`、`优化了 X`、`改好了 X`、`修改好了 X`、`删除掉了 X`、跨子句 `更新了接口文档，补充了 X 的说明`）——**第十轮判定：已修（我复跑 23 句完成体语料全只读；HTTP 8 句 `authorizationId=null`、`level=none`、零授权行）**。
- **W3R9-02 [P1]** **选择疑问句**（`修改 X 好还是不改好`、`修 X 行不行`、`fix X or leave it alone`、`refactor …, yes or no`）仍授权 —— **第十轮判定：仅登记原句已修；变体 14/36 仍越权（→ W3R10-01）**。
- **W3R9-03 [P1]** **修饰性/参照性从句前置**（`based on X, update Y`）因逗号切分授权了参照路径 —— **第十轮判定：已按 T17 新口径关闭（参照只授权自身命名目标；4/4 作用域断言 + 10 变体；X 从不入写范围）**。
- **W3R9-04 [P2]** 记录绝对表述与旧计数 —— **第十轮仍未订正（W3R10-04）**。
- **W3R9-05 [P3]** 协议对账（未知字段静默忽略、响应字段多于协议表）—— **第十轮仍在（W3R10-06）**。
- **W3R9-06 [P3]** 未登记祈使 fail-closed 代价清单 —— **第十轮仍在，且新增 W3R10-03 的反向误拒（复合词）**。
