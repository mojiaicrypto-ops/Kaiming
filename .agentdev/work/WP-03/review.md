# WP-03 独立 Review 报告（第十一轮）

- 评审对象：工作包 WP-03「直接协作与说明产物」
- 评审轮次：**第十一轮**（第一～十轮摘要见文末「附一～附十」，全部保留）
- 冻结点 / HEAD：`git rev-parse HEAD` = `7b0e6b5a8c5823a329d9781155ceabddab36b44e`（**与任务下达的 `HEAD=7b0e6b5` 一致**）；`git diff --stat 1ede8c7 HEAD` 只有 `.agentdev/work/WP-03/review.md`，**被审代码树 = `1ede8c7`**
- 工作树：本轮全部命令执行前后 `git status --porcelain` 为空；被审代码树（`packages/**`、`apps/**`、`docs/**`）无任何未提交修改（写入本报告后才会出现 ` M .agentdev/work/WP-03/review.md`）
- 评审角色：Review（独立上下文；未读取任何开发/Test 会话；只依据仓库文件、契约文档与 `/tmp/w3r11/` 下我自建的 10 个实验脚本）
- 工具：`node v24.8.0`、`pnpm 12.3.4`、macOS 宿主
- 记录哈希（`git hash-object`，前 8 位）：`packages/domain/src/requests.ts` **`bc44f295`**（T18 修复后）、`packages/domain/test/domain.test.ts` **`1e8ff8e9`**、`packages/core/src/messages.ts` `283d4c04`、`packages/core/src/artifacts.ts` `057ff403`、`packages/core/src/attachments.ts` `3ee94838`、`packages/core/src/preview.ts` `803b502a`、`apps/daemon/src/server.ts` `3a348304`、`.agentdev/work/WP-03/plan.md` `8986875e`、`.agentdev/work/WP-03/implementation.md` `f28b8316`
- 变更范围（`git diff --name-only 0fb5c71 1ede8c7`）：仅 `packages/domain/src/requests.ts`、`packages/domain/test/domain.test.ts` 与两份过程记录。`packages/core/**`、`apps/daemon/**`、`docs/**` 在 `0fb5c71→1ede8c7` 间**零改动**，其哈希与第十轮报告记录逐字相同 → 核心/HTTP 面的前轮 P0/P1 只能通过"未改动"加独立复验来担保（见 §5）。
- 权威依据：`AGENTS.md`、`docs/INDEX.md`、`docs/rules/{workflow,agents}.md`、`docs/product/experience.md`（§3）、`docs/architecture/{data,protocol,execution,reliability}.md`、`docs/delivery/{implementation,acceptance}.md`（AC-001..006/052/076/084）、`.agentdev/work/WP-03/{plan,implementation,review}.md`、`packages/**`、`apps/daemon/**`、相关测试

---

## 1. 结论

**FAIL（不能进入独立 Test；按 `docs/rules/workflow.md` §6 走 `Blocking Review Finding → Develop → Independent Review`）。**

本轮判 **FAIL（0×P0、3×P1、2×P2、4×P3）**。

第十轮点名的两组 P1 **在"登记原句"层面确已修好**（`probe9`：13/13 全部只读），但**两组 P1 的形态族没有关闭**；同时本轮以差分解剖（旧树 `0fb5c71` 与新树 `1ede8c7` 并跑）证明所谓"默认拒绝的严格命令模板"在**目标优先模板**上仍是一条宽放行通道，且新引入 4 例中文常用祈使（把/将/对）误拒。

| 维度 | 第十轮 | 第十一轮 |
|---|---|---|
| 判定式结构 | 白名单 + 默认拒绝（自称） | **实测非默认拒绝**：`COMMAND_TAIL` 对"路径开头 + 结尾变更动词"无谓词守卫 |
| 第十轮 P1「选择疑问」登记原句 | 6 句 fail-open | **已修（`probe9` 0/13 残留）** |
| 第十轮 P1「条件前件」登记原句 | 2 句 fail-open | **已修（`probe9` 0/13 残留）** |
| 同族**未登记变体** | 未测 | **选择/问句尾 7/9、条件前件 9/11 仍 fail-open（新 P1）** |
| 目标优先陈述句（`X 尚未修改`、`X 正在修改`、`X 拒绝修改`…） | 未测（旧树同样 fail-open） | **85 模板 80 fail-open（新 P1）** |
| 登记语料 86 负 + 21 正 + 4 作用域 | 71 + 19 + 4 | **86 + 21 + 4 全部成立（0 偏差）** |
| 文档化正例 | 39 句：37 通过、2 误拒 | **登记 21/21 通过；扩展 28 句 5 误拒；复合词/路径/把-句式共 16/16 误拒（新 P2）** |
| 差分解剖（vs 旧树 0fb5c71） | 未做 | **97 条负向只修好 1 条、仍开 88 条；15 条正向新坏 4 条** |
| 客户端注入面 | 无通路（11 项） | **无通路（11 项，0 授权/0 越权 Work）** |
| 前轮 P0/P1 复验 | 无回归 | **无回归（`probe7` 17/17 通过；core/daemon 零改动）** |
| P1 数量 | 2 | **3** |

三条 P1 均落在本包验收面（AC-004 负例、AC-005 授权边界、`workflow.md` §1/§6），**全部以真实 HTTP + 真实 `Orchestrator` 证明可派发真实 Backend 写 Run**，**阻断 Test**。

---

## 2. 契约命令原始结果（本轮实跑）

执行目录：仓库根；逐条串行，输入原文见 `/tmp/w3r11/commands.log`。全部在 `HEAD=7b0e6b5`、被审代码树 `1ede8c7` 上执行；`pnpm build` 产物 `packages/domain/dist/requests.js` 时间戳 20:59:21 晚于源码 20:57:56。

| 命令 | 退出码 | 原始结果要点 |
|---|---|---|
| `pnpm build` | **0** | `pnpm -r build`，**8** 个 workspace `build: Done`：`contracts, cli, storage, domain, pi-runtime, core, daemon, runner` |
| `pnpm typecheck` | **0** | `tsc -p tsconfig.json --pretty false`，无输出 |
| `pnpm lint` | **0** | `Checking formatting... All matched files use Prettier code style!` |
| `pnpm test:unit` | **0** | `Test Files 19 passed (19)`、`Tests 289 passed (289)`（含 `domain.test.ts` 32 例、`artifacts.test.ts` 16 例、`server.test.ts` 17 例） |
| `pnpm test:integration` | **0** | `Test Files 10 passed (10)`、`Tests 124 passed (124)`（含 `container.integration.test.ts` 9 例真实容器） |
| `pnpm docs:check` | **0** | `docs:check ok — 15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages` |

`git status --porcelain`（写入本报告前）：**空输出**；`HEAD` 全程 `7b0e6b5a8c5823a329d9781155ceabddab36b44e`。
计数对账：`implementation.md:216`（T18）的 `289 / 124 / 8 / docs:check ok` 与实测**一致**；`docs:check` 的 `15/55/94/9/11` 与第十轮逐字一致（无文档漂移）。

**命令全绿不等于必验范围成立**：本轮三条 P1 的**全部证据句都不在回归网内**——`grep -rn "抑或|要不然|正在修改|尚未|拒绝修改|计划修改|可以修改|待你确认|看情况|upon approval|pending review|把 docs|将 docs" packages/*/test apps/*/test` **0 命中**；`Orchestrator` 仍不出现在 `apps/daemon/test/server.test.ts`、`packages/core/test/artifacts.test.ts`（W3R4-05 延续）。全部越权、误拒与端到端证据由我自建脚本建立（`/tmp/w3r11/probe{1..10}`）。

---

## 3. 越权方向（独立穷举核验）

### 3.1 口径声明（先声明后实测）

- **缺陷（fail-open）**：句子**不是祈使指令**（陈述/完成体/被动/疑问/反问/选择疑问/条件前件/引用/名词化/无标点罗列/逗号参照/征询/拒绝/情态/计划），却在 `routeMessage` 上产生 `explicitAuthorization=true`（`writePaths` 非空）。
- **非缺陷（已声明代价，planVersion 2）**：未登记**同义变更词**（`重写/润色/rewrite/polish/tweak` 等）落只读 + 澄清；以及由此类同义词构成的祈使被误拒。
- **本轮新增口径（记录在案）**：`并/and` 连接的两个真祈使（`修改并删除 X`、`fix and update X`）算**命令**，不计缺陷（但记录仍宣称"动词唯一性 ⇒ 罗列一律澄清"，见 §6）。

### 3.2 非祈使语料：probe1（141 负）与 probe2（模板矩阵）

`probe1-domain.mjs`（141 条非祈使句，覆盖任务点名的 14 类句式）：

| 族 | 句数 | 授权 | 结论 |
|---|---|---|---|
| 完成体/陈述（`V了`、`已经/刚`、`完毕`） | 24 | **0** | 第九轮 P1 保持已修 |
| 被动/认识情态（`需要被修改`、`会被清理`、`needs fixing`） | 12 | **0** | 已闭合 |
| 疑问/反问（`如何…`、`难道要…`、`凭什么…`、`Who asked…`） | 19 | **0** | 已闭合 |
| 引用/转述/名词化（`需求写着：`、`关于 X 的修改`、`the fix needed in X`） | 9 | **0** | 已闭合 |
| 拒绝/建议/只读言说/前置条件/混合（含 `参考 X 修改 Y`） | 21 | **0** | 已闭合 |
| **目标优先陈述（`X 尚未修改`、`X 正在修改`、`X 可以修改`、`X 拒绝修改`…）** | **15** | **15** | **W3R11-01** |
| **选择/问句尾（`修改 X 哪个更好`、`修改 X 抑或重写`、`修改 X 的哪个部分`）** | **25** | **5** | **W3R11-02** |
| **条件前件（`待你确认，修改 X`）** | **12** | **1** | **W3R11-03** |
| 无标点动词罗列 + `并/and` 双祈使（`X 修复 更新 整理`、`修改并删除 X`） | 4 | 2 | 罗列 2 条已拦；`并` 双祈使 2 条为真命令，不计缺陷（见 §3.1） |

`probe2-templates.mjs`（模板矩阵，而非单词句）：

| 矩阵 | 探测数 | 泄漏 | 备注 |
|---|---|---|---|
| A 目标优先陈述：`X <谓词><动词>`，16 谓词 × 5 动词 | 85 | **80** | `尚未/未/没/还没/正在/计划/打算/准备/可以/允许/支持/同意/拒绝/想/决定/考虑`；仅含 `需要` 的 5 条被守卫拦下 |
| B 目标后选择连接词：`修改 X <连接词>` | 17 | **6** | `抑或/要不然/也可以/哪个更好/哪一个/versus`；`还是/或者/也行/行不行/该不该/对不对/好不好/要不要/怎么样` 已拦 |
| C 条件前件（中文，带/不带逗号） | 34 | **8** | `待你确认/等你确认/看情况/酌情/发现问题（，）/发现问题就，/出错就，/失败就，` |
| C-EN 条件前件（英文） | 9 | **4** | `upon approval/following approval/pending review/as soon as possible` |
| D 目标后疑问词 | 5 | **0** | `的哪个部分` 在 probe1 中泄漏（单句），矩阵抽样未命中同一路径；以 probe1 为准 |
| E 单子句多动词 | 5 | **2** | `并/and` 连接的双祈使，不计缺陷 |
| F 正向对照 | 10 | 5 误拒 | 见 §4 |

### 3.3 差分解剖：第十轮修复到底改了什么（probe8）

我把旧代码树 `0fb5c71` 的 `packages/domain/src/requests.ts` 用 `git show` 导出到 `/tmp/w3r11/old/`，通过 Node 24 的 TypeScript 类型剥离直接运行，与新树构建产物并跑同一语料（两棵树互不 import 产品测试文件）：

- **负向 97 条**：新树相对旧树**只修好 1 条**（`一旦确认，修复 X`，属登记原句）；**88 条两棵树都授权**（含全部 `X 尚未修改`/`X 正在修改`/`X 拒绝修改` 等目标优先陈述、`修改 X 抑或重写`、`修改 X 哪个更好`、`待你确认，修改 X`、`看情况，修改 X`、`upon approval, update X`）；干净 8 条。
- **正向 15 条**：**新坏 4 条**（`把 X 里的错别字改掉`、`请把 X 里的错别字改掉`、`将 X 删除`、`对 X 进行修改` 在 `0fb5c71` 授权、在 `1ede8c7` 不授权）。

**裁决**：T18 的"默认拒绝（default-deny）的严格命令模板"在**目标优先模板**上并未成立。`isImperative`（`requests.ts:317-328`）的最终判据是 `COMMAND_LEAD || COMMAND_LEAD_EN || COMMAND_TAIL`，其中 `COMMAND_TAIL`（`:306-309`）只要求"子句以路径开头、60 字符内、以变更动词结尾"，**对中间谓词的唯一约束是 `NON_COMMAND_MARKERS`（`:279-280`）这一词表**。谓词不在词表内的所有陈述句因此直通授权。这与第八、九、十轮同根因（**形态判定退化为词表枚举**），且本轮证明它同时向"误放"和"误拒"两侧泄漏。

### 3.4 HTTP 与真实 Orchestrator 端到端（越权可执行性）

- `probe3-http.mjs`（真实 daemon：真实 SQLite + 真实 blob + Bearer 链路）：**16/16 非祈使句 fail-open**——HTTP 202、`authorizationId=SET`、新增 1 条 `authorization` 行、新 Work `level=["L2"]`、`intent=["delivery"]`、`writePaths=["docs/INDEX.md"]`、写入 1 条 `assessment`；对照组 4 条正例 4/4 授权、3 条登记负例 0 授权。
  代表句：`docs/INDEX.md 尚未修改`、`docs/INDEX.md 正在修改`、`docs/INDEX.md 计划修改`、`docs/INDEX.md 可以修改`、**`docs/INDEX.md 拒绝修改`（拒绝句产生写授权）**、`docs/INDEX.md 想修改`、`docs/INDEX.md 决定修改`、`docs/INDEX.md 有错误就修复`、`修改 docs/INDEX.md 抑或重写`、`修改 docs/INDEX.md 哪个更好`、`修改 docs/INDEX.md 也可以`、`修改 docs/INDEX.md 的哪个部分`、`待你确认，修改 docs/INDEX.md`、`看情况，修改 docs/INDEX.md`、`upon approval, update docs/INDEX.md`、`pending review, update docs/INDEX.md`。
- `probe4-e2e.mjs`（真实 `Orchestrator.assess` + `dispatch`，真实 Chief Run → 真实 `backend/purpose=implementation` 写 Run）：**12/12 非祈使句各建立 1 个真实写 Run**（`writeRuns=["…:backend:queued"]`），全部经 `assess`（L2 + `authorizationRef` 通过 `verifyAuthorization`）与 Chief 父 Run；正例 `修改 X`、`删除 X 的旧内容`、`解释 X 并修复 Y` 同样建立写 Run，登记负例 `修改 X 好还是不改好`、`一旦确认，修复 X` 均未建立 → **准入闸门正常，越权来自授权判定**。

### 3.5 危害上界

越权授权的范围恒等于句中**被点名的那一个路径**，`operations=['read','edit']`、`networkTargets=[]`；环境/网络/越界路径仍被 `Orchestrator.verifyAuthorization` 拒绝。因此危害是"**用户只是陈述/拒绝/提问，却产生了可执行的写授权与真实写 Run**"，属 `workflow.md` §6 的 P1（错误行为/需求缺失）+ AC-004 负例失败，**不是数据/安全级 P0**。

---

## 4. 文档化正例复核（明确修复 / 中文日常祈使 / 混合意图 / 目标排除 / 否定后纠正 / 参照目标 / 删除清理旧内容）

- **登记正例 21/21 成立**（`probe5` 独立提取 + 构建产物复跑；登记作用域断言 4/4 成立）。
- **扩展正例 28 句：23 通过、5 误拒**：`删除 docs/INDEX.md 的过时内容`、`清理 docs/INDEX.md 的过时内容`、`删除 docs/INDEX.md 里过时的内容`、`更新 docs/INDEX.md 里过时的接口说明`（4 句，`过` 字单字命中）、`把 docs/INDEX.md 里的错别字改掉`（1 句，把-句式）——**W3R11-04/05**。
- **`probe10-falsereject.mjs` 专项 16/16 误拒**：`过时/过时段落` 复合词、`会议/了解/被删` 等目标词、**路径名本身含标记**（`修改 docs/过时说明.md`、`修改 docs/会议.md`、`修改 docs/了解.md`、`update docs/a-or-b.md`、`fix docs/no-index.md`、`fix docs/yes-notes.md`）、把/将/对-句式。
- **通过的文档化场景**：明确修复（中英）、`请/麻烦/帮我/帮忙 + V`、`X 的错别字麻烦处理下`（尾式）、`识别并修复`、`特别修改`、`但要修复/而是更新/然后重构`（前缀归一）、`别改 A，改 B` / `不要修改 A，但要修复 B`（否定后纠正）、`解释 X 并修复 Y` / `先解释 X，再修改 X`（混合意图）、`修改 X、Y`（顿号列表）、`修改 X 而不是 Y`（目标排除）、`参考 X，修改 Y` / `regarding X, fix Y`（参照目标）、`删除 X 的旧内容` / `清理 X 的重复段落`。
- **HTTP 复核**：正向 4/4 建 `Authorization` + delivery Work；`解释 X 并修复 Y` 建 2 个 Work（assist + delivery）且写范围只含 Y（AC-006）。

---

## 5. 客户端注入面与前轮 P0/P1 无回归复核

### 5.1 注入面（`probe6-injection.mjs`，真实 HTTP）

| 注入 | HTTP | 库结果 |
|---|---|---|
| `workItems:[…×50]` / `works:[…×50]` | 202（静默忽略） | workDelta=1（仅路由产出）、authDelta=0、无 write |
| `authorization:{scope:{writePaths:['packages/core/src'],operations:['read','edit']}}` | 202（忽略） | authDelta=0、`authorizationId=null` |
| `authorization:{operations:['deploy']}` | 202（忽略） | 零授权行 |
| `grants:[{operation:'edit',targets:[…]}]` | 202（忽略） | 零授权行 |
| `scope:{writePaths:['packages/core']}` + `level:'L3'` + `intent:'operation'` | 202（忽略） | 零授权行、无 L3 Work |
| `targetWorkId`（不存在） | **404** `{ok:false,error}` | 零副作用 |
| 未知字段 `foo`/`targetRole`/`ownerUserId` | 202（**静默忽略**） | 无副作用（W3R11-08 承接 `protocol.md` §1） |
| 空 body / 缺 `conversationId` / 未知 `conversationId` | **400 / 400 / 404** | 零副作用 |

**结论：wire 层不存在 `authorization`/`workItems`/`works`/`grants`/`scope`/`level`/`intent` 通路，11 项注入零授权行、零越权 Work，无回归。**

### 5.2 前轮 P0/P1 复核表（`probe7-prior.mjs`，17/17 通过）

| 项目 | 本轮实测 | 状态 |
|---|---|---|
| W3-01 下载 token 可预测/先于认证（P0） | token 不内嵌 artifactId；首次 200、二次 403；`server.test.ts:395` 通过 | 无回归 |
| W3-02 产物读取无主体维度（P0） | 预览走 `assertReadable`；CSP 逐字、sandbox、`credentials: omit`、无 `set-cookie`、`nosniff` 全成立 | 无回归 |
| W3R3-01 授权 capability 缺口致死锁（P1） | `probe4` 中正例 `assess`/`dispatch` 全通（含 `readPaths`+`read`） | 无回归 |
| W3R3-06 CSP 单头/逐字相等（P2） | `preview.ts` 哈希 `803b502a` 与第十轮相同；头逐字等于 `PREVIEW_CSP` | 无回归 |
| W3R4-03 `assertGrantWithinMessage` 约束 `readPaths` | 代码仍在（`messages.ts:360-384`）；HTTP `authorization` 注入被忽略 | 无回归 |
| W3R4 review `targetWorkId` 跨会话 | 跨 Conversation 目标 Work → **403 `NOT_AUTHORIZED`** | 无回归 |
| W3R4 review 追发不改写 Work | 追发后 `level`/`authorizationRef` 不变、`authorizationId=null` | 无回归 |
| W3R5-01 非执行消息产生写授权（P1） | 完成体/被动/引用/罗列/反问/拒绝已闭合；**目标优先陈述与选择/条件变体仍开（W3R11-01/02/03）** | **部分未闭合** |
| W3R7-01 只读请求词授权（P1） | `看一下/检查/评估/总结/列出` 全只读 | 无回归 |
| W3R7-03 混合否定+指令误拒（P1） | `别改 A，改 B`、`不要修改 A，但要修复 B` 只授权 B | 无回归 |
| A1 目标级排除 / A2 中文混合 / A3 纯建议（P1） | 4/4 作用域、混合 2/2、建议全只读 | 无回归 |
| 登记语料 86 负 + 21 正 + 4 作用域 | `probe5` **0 偏差** | 无回归 |

**未闭合承接**（P3，不单独阻断）：W3R4-05（无 Orchestrator 授权回归用例）、W3R4-06（`protocol.md` §5 未对账）、W3R4-08（`StorageError` 映射粗）、W3R4-10（`targetWorkId` 归属只覆盖 message 来源）、W3R4-12（multipart 多文件 / `projectId`）、W3R4-13（错误响应非 §1 封装）。

---

## 6. 记录与实现一致性核对

| 记录项 | 实测 | 结论 |
|---|---|---|
| T18 回归网「86 条不得授权」 | 独立逐行提取 = **86**（负例块 286–375 行，含双引号写的 `"don't fix …"`），复跑 0 偏差 | **准确** |
| T18「21 条必须授权 + 4 条作用域断言」 | 独立提取 = **21**；作用域 4/4 | **准确** |
| T18 验证数字 `289 / 124 / 8 / docs:check ok` | 逐条实测一致 | **准确** |
| T18「三套外置语料（79/35/32 条）0 不匹配」 | 仓库内无此三套语料，**不可复现** | **不可验证（W3R11-06）** |
| T18「任一子句是疑问/选择/征询 ⇒ 整条消息不授权」 | `routeMessage` 的 `interrogative` 门只查 `QUESTION/CHOICE/ADVICE` 三张词表；`修改 X，抑或重写`、`修改 X 也可以` 等未登记选择词不进该门 | **不准确（W3R11-02）** |
| T18「条件子句使其下一子句同样非命令」 | `CONDITION_PATTERNS` 只认 `一旦/的话/确认后/…/once/after you`；`待你确认/看情况/upon approval/pending review` 不触发继承 | **不准确（W3R11-03）** |
| T18「严格命令模板：授权必须匹配…目标优先须为 `目标 + … + 变更动词命令式结尾`」 | `COMMAND_TAIL` 对中间谓词无约束；`X 拒绝修改` 也匹配 | **不准确（W3R11-01）** |
| T18「删除已死的形状常量，保持单一判定路径」 | 未发现未使用的形状常量 | 未见异常 |
| planVersion 2「对任何不确定一律 fail-closed」 | `X 拒绝修改` 等明确非命令却授权 | **名实不符（W3R11-06）** |
| T15 声称「不再出现『一律/永不』的绝对表述」 | `implementation.md:113`「永不下发写授权」、`:140`「一律只读」、`:177`「其余一律只读」、`:186`「一律只读」仍在 | **名实不符（W3R11-06，第五轮延续）** |
| T18 对「过时」的转述 | T18 称"第十轮报告指出 `过时` 不在文档中"；实际第十轮报告 W3R10-03 恰恰断言其**是** `experience.md` §3 的规范动作。我 `grep -rn "过时" docs/` = **0 命中** | 第十轮报告前提有误，T18 转述亦混乱（W3R11-06） |
| `implementation.md:3` 的 `planVersion: 1` | `plan.md:3` 为 `planVersion: 2` | **记录头未同步（W3R11-06）** |
| W3R10 报告：第八轮报告 `domain.test.ts` 哈希 `7483338`（7 位）笔误 | 未订正 | 延续（W3R11-06） |
| `implementation.md:11`（T1「一律 `INTERNAL_ERROR`」） | 代码事实 | 非启发式声明，不影响判定 |

**记录侧硬约束（对 Test 有直接影响）**：`implementation.md:211-215` 的"严格命令模板 / 任一子句选择即整条不授权 / 条件继承"与我实测不符；若 Test 以 T18 为准，会把三条 P1 的越权句当成预期只读而漏报。

---

## 7. 新 Findings（W3R11-xx）

### W3R11-01 [P1] 目标优先的**陈述/状态/计划/许可/拒绝**句仍产生写授权并可派发真实写 Run

- **位置**：`packages/domain/src/requests.ts:306-309`（`COMMAND_TAIL_PATTERN`）、`:317-328`（`isImperative`）、`:279-280`（`NON_COMMAND_MARKERS`，目标优先模板唯一的谓词守卫）。
- **实测（我自建，未登记）**：
  - `probe2` 矩阵 A：**85 探测 / 80 授权**，覆盖 `尚未/未/没/还没/正在/计划/打算/准备/可以/允许/支持/同意/拒绝/想/决定/考虑` × `修改/更新/删除/修复/清理`。仅 `需要` 因在 `NON_COMMAND_MARKERS` 内被拦（5 条）。
  - `probe1`：`docs/INDEX.md 尚未修改`、`未修改`、`没修改`、`还没修改`、`尚未更新`、`正在修改`、`正在更新`、`计划修改`、`打算修改`、`准备修改`、`可以修改`、`允许修改`、`支持修改`、`有错误就修复`、`我打算修改` —— 15/15 授权。
  - 最刺眼者：**`docs/INDEX.md 拒绝修改`（"X 拒绝被修改"）产生写授权**；`docs/INDEX.md 正在修改`（进行体）、`docs/INDEX.md 尚未修改`（状态否定）同为纯陈述。
- **判别依据**：`X 需要修改`（第九轮已登记负例）与 `X 尚未修改` 是同一"目标优先 + 情态/状态谓词 + 变更动词"形态；前者被词表拦下、后者直通，说明判定仍靠词表枚举。`workflow.md` §1 只授权"执行消息"；状态、许可、计划、拒绝都不是执行消息。
- **差分解剖**：该族在旧树 `0fb5c71` 同样 fail-open（`probe8`：88 条两树都开），因此不是本轮新引入，但 T18 自称"默认拒绝"却在 85 条模板上放行 80 条，属**claim 与实现不符 + 越权未闭合**。
- **HTTP + e2e**：`probe3` 8/8 落库授权（L2 + 1 授权行 + 1 assessment）；`probe4` 7/7 建立真实 `backend/implementation` 写 Run。
- **修复方向（结构性）**：`COMMAND_TAIL` 必须要求"目标 + **名词性宾语/错别字等受事短语** + 命令式动词"，或先无条件拒绝含任一"非命令谓词形态"（否定词 `未/没/尚未/还没`、进行体 `正在`、计划/意愿 `计划/打算/准备/想/决定/考虑`、许可 `可以/允许/支持/同意`、拒绝 `拒绝`）的子句；不能继续靠往 `NON_COMMAND_MARKERS` 里加词。
- **验收面**：AC-004 负例失败；`workflow.md` §1「执行消息可直接授权明确目标」被扩大到"陈述/拒绝状态"。

### W3R11-02 [P1] **选择疑问/问句尾**的未登记变体仍产生写授权并可派发真实写 Run

- **位置**：`requests.ts:126-129`（`CHOICE_PATTERNS`）、`:279-280`（`NON_COMMAND_MARKERS` 选择词表）、`:413-418`（`interrogative` 门）。
- **第十轮状态**：W3R10-01 的 6 条登记原句**已修**（`probe9` 13/13 只读）。
- **本轮实测（我自建，未登记）**：`probe9` 同族 **hold-out 7/9 仍授权**：`修改 X 哪个更好`、`修改 X 抑或重写`、`修改 X 要不然保留`、`修改 X 也可以`、`先修改 X 也可以`、`fix X versus rewriting it`、`修改 X 的哪个部分`（仅 `update X, or keep it`、`修改 X 的什么内容` 只读）；`probe2` 矩阵 B **17 探测 / 6 授权**（另含 `哪一个`、`versus`）；`probe1` 另含 `修改 X 的哪个部分`。英文 `fix X versus rewriting it` 授权，而 `update X, or keep it` 只读——**同形态因词表命中与否结论相反**。
- **HTTP + e2e**：`probe3` 4/4 落库授权；`probe4` 3/3 建立真实写 Run。
- **修复方向（结构性）**：把"选择/征询形态"整体并入疑问门（`(?:还|或)是|抑或|要不然|要不然|该不该|对不对|行不行|可不可以|好不好|要不要|也行|也可以|哪个|哪一个|哪些|怎么样|是否值得`；英文 `\b(or|either|vs\.?|versus|yes or no|which)\b`），并让 `interrogative` 门消费 `NON_COMMAND_MARKERS` 的选择子集，而不是三张互不相交的词表。
- **验收面**：同 W3R11-01。

### W3R11-03 [P1] **条件前件**的未登记变体仍产生写授权并可派发真实写 Run

- **位置**：`requests.ts:137-140`（`CONDITION_PATTERNS`）、`:143-148`（`HYPOTHETICAL_PATTERNS`）、`:419-432`（`conditional` 继承）。
- **第十轮状态**：W3R10-02 的 5 条登记原句**已修**（`probe9` 13/13 只读）。
- **本轮实测（我自建，未登记）**：`probe9` 同族 **hold-out 9/11 仍授权**：`待你确认，修改 X`、`等你确认，修改 X`、`看情况，修改 X`、`酌情，修改 X`、`发现问题，修改 X`、`出错就,修改 X`、`upon approval, update X`、`following approval, update X`、`pending review, update X`（仅 `发现问题就修改 X`、`when ready, update X` 只读，二者分别因无逗号与未命中模板）；`probe2` 矩阵 C **34/8**、C-EN **9/4**；`probe1` 另含 1 条同族变体。
- **根因**：条件身份仍由词表决定，继承只在命中 `一旦/的话/确认后/后面那几个字/once/after you` 时触发；带逗号的条件从句一旦不含这些词，后一子句被当作独立命令。对照组 `待确认后修改 X`、`发现问题就修改 X`（无逗号）反而只读，结论随标点翻转。
- **HTTP + e2e**：`probe3` 4/4 落库授权；`probe4` 2/2 建立真实写 Run。
- **修复方向（结构性）**：条件继承改为"前件形态"判定（前件以 `待/等/经/通过/一旦/看情况/酌情/…的话/之后/以后/once/after/upon/following/pending` 收束，且与后件以逗号相连），而不是枚举条件词。
- **验收面**：同 W3R11-01。

### W3R11-04 [P2] `NON_COMMAND_MARKERS` 的**单字/子串命中**误杀合法祈使（含目标路径本身）

- **位置**：`requests.ts:279-280`（裸 `了`、`过`、`会`、`被`、`or`、`yes`、`no` 等）+ `:319`（对整子句 `test`）。
- **实测（`probe10` 16/16 误拒）**：`删除 docs/INDEX.md 的过时内容`、`清理 docs/PLAN.md 的过时段落`、`更新 docs/INDEX.md 里过时的接口说明`、`修改 docs/INDEX.md 里了解了的内容`；**目标路径本身含标记**：`修改 docs/过时说明.md`、`修改 docs/了解.md`、`修改 docs/会议.md`、`修改 docs/被删说明.md`、`update docs/a-or-b.md`、`fix docs/no-index.md`、`fix docs/yes-notes.md`。
- **性质**：方向为 fail-closed（不产生越权），但属"合法祈使被误拒"，且路径名含 `过/了/会/被/or/no` 是常见情形。第十轮报告 W3R10-03 把 `过时` 说成 `experience.md` §3 的规范动作**不成立**（`grep -rn "过时" docs/` = 0 命中），但误拒本身真实存在；T18 把它归为"未登记措辞的 fail-closed 残余"并**未做任何修复**。
- **修复方向**：标记判定按词边界/句法位置收窄（`过` 仅当动词后、`被/会` 仅在动词前、英文 `or/no/yes` 要求不与路径词元相邻），或先剥离 `的…名词` 修饰段与目标词元再判定。

### W3R11-05 [P2] 中文 **把/将/对（处置式）祈使**在第十轮重写中回归为误拒

- **位置**：`requests.ts:295-309`（`COMMAND_LEAD` 只允许动词**之后**出现 `把|将|对`；`COMMAND_TAIL` 要求路径开头）。
- **实测**：`把 docs/INDEX.md 里的错别字改掉`、`请把 docs/INDEX.md 里的错别字改掉`、`将 docs/INDEX.md 删除`、`对 docs/INDEX.md 进行修改` 在 `1ede8c7` **全部不授权**；`probe8` 差分解剖证明这 4 句在 `0fb5c71` **全部授权** → **本轮修复引入的回归**。
- **性质**：fail-closed，不产生越权；但 `把 X … 改掉` 是中文最典型的祈使式之一，属 `workflow.md` §1「执行消息可直接授权明确目标」的直接场景。将直接抬高"用户必须换说法"的交互成本。
- **修复方向**：增加处置式模板 `^(?:请|麻烦|帮我|帮忙)?\s*(?:把|将)\s*<PATH>…<变更动词>` 以及 `对 <PATH> 进行<变更动词>`。

### W3R11-06 [P3] 记录仍含绝对/失真表述、旧计数与未同步头，T18 自述与实现不符

- **实测（grep 原文）**：`implementation.md:113`「永不下发写授权」、`:140`（T13）「一律只读」、`:177`（T16）「其余一律只读」、`:186`（T16）「…一律只读」；而 `:176`（T15）声称"不再出现「一律/永不」的绝对表述"。`plan.md:17`「对任何不确定一律 fail-closed」被 `X 拒绝修改` 证伪。`implementation.md:3` 仍写 `planVersion: 1`，而 `plan.md:3` 是 `planVersion: 2`。
- **T18 自述**：`:211`「严格命令模板」、`:213`「任一子句是疑问/选择/征询 ⇒ 整条消息不授权」「条件子句使其下一子句同样非命令」与实测不符（§6 表）。
- **不可复现证据**：`:215`「三套外置语料（79/35/32 条）0 不匹配」在仓库内无对应文件，Test 无法复跑。
- **性质**：记录名实不符（连续第五轮）。不单独阻断，但 Test 若以 T18 为准会漏报三条 P1。
- **建议**：把绝对表述改为"已登记语料范围内"；为旧计数加失效标注；同步 `planVersion`；把外置语料落进仓库或删除该证据声明；订正第八轮报告的 `domain.test.ts` 哈希（`7483338` → `1e8ff8e9`）。

### W3R11-07 [P3] 回归网缺口：三条 P1 的全部证据句零断言，授权→`assess`/`dispatch` 仍无产品用例

- **实测**：`grep -rn "抑或|要不然|正在修改|尚未|拒绝修改|计划修改|可以修改|待你确认|看情况|upon approval|pending review|把 docs|将 docs" packages/*/test apps/*/test` = **0 命中**；`apps/daemon/test/server.test.ts:530-552` 的 HTTP 只读断言仅 4 句；`grep -rl Orchestrator apps/daemon/test packages/core/test/artifacts.test.ts` = 0（W3R4-05 延续）。
- **性质**：不阻断（本轮 P1 已由我自建脚本证明），但修复后必须以回归断言固化，否则同类变体会第六次逃逸。

### W3R11-08 [P3] 协议对账与 wire 语义承接

- **未知字段**：`foo:1`/`targetRole:'backend'`/`ownerUserId:'attacker'` 仍 **202 静默忽略**，而 `protocol.md:11` 要求未知字段返回 `VALIDATION_ERROR`（方向 fail-closed，承接 W3R8-05/W3R10-06）。
- **响应形状**：`conversation.message.send` 响应含 `workIds`/`authorizationId`，`protocol.md:46` 只列 `{messageId,workId,state,version}`（加法扩展未在文档侧对账）。
- **同批承接**：W3R4-06/08/10/12/13。

---

## 8. 计数与阻断判定

| 严重度 | 数量 | 编号 | 是否阻断 |
|---|---|---|---|
| P0 | 0 | — | — |
| **P1** | **3** | W3R11-01（目标优先陈述句越权）、W3R11-02（选择/问句尾变体越权）、W3R11-03（条件前件变体越权） | **阻断** |
| P2 | 2 | W3R11-04（标记子串误拒合法祈使/路径）、W3R11-05（把/将/对处置式回归误拒） | 不单独阻断，须随修复轮订正 |
| P3 | 4 | W3R11-06（记录绝对表述/旧计数/未同步头/不可复现证据）、W3R11-07（回归网缺口/无 Orchestrator 用例）、W3R11-08（协议对账/未知字段） | 不阻断，承接 Test |

- 三条 P1 **均落在本包验收面**：AC-004 负例被证伪、`workflow.md` §1 授权边界被证伪；且**均以真实 HTTP + 真实 `Orchestrator` 证明可派发真实 Backend 写 Run**（`/tmp/w3r11/probe4`，12 条）。
- 失败路由：`Blocking Review Finding → Develop → Independent Review`（`docs/rules/workflow.md` §6）。
- 第十轮 2 条 P1 的本轮裁定：**W3R10-01 登记原句已修，但形态族仍开（→ W3R11-02）**；**W3R10-02 登记原句已修，但形态族仍开（→ W3R11-03）**。W3R10-03（复合词误拒）**未修且扩大**（→ W3R11-04）。

---

## 9. 能否进入独立 Test —— **不能**

**判据**：`docs/rules/workflow.md` §6「P0/P1 阻断」。三条 P1 中任意一条即足以阻断，且均可端到端复现。**必须先走 `Develop → Independent Review`。**

### 9.1 修复后重评的最低要求（回归网）

以下新增句必须只读（并落成长期断言）：

1. **目标优先陈述**：`docs/INDEX.md 尚未修改`、`未修改`、`没修改`、`还没修改`、`正在修改`、`计划修改`、`打算修改`、`准备修改`、`可以修改`、`允许修改`、`支持修改`、`同意修改`、**`拒绝修改`**、`想修改`、`决定修改`、`考虑修改`、`有错误就修复`。
2. **选择/问句尾**：`修改 X 哪个更好`、`修改 X 抑或重写`、`修改 X 要不然保留`、`修改 X 也可以`、`先修改 X 也可以`、`修改 X 的哪个部分`、`fix X versus rewriting it`。
3. **条件前件**：`待你确认，修改 X`、`等你确认，修改 X`、`看情况，修改 X`、`酌情，修改 X`、`发现问题，修改 X`、`upon approval, update X`、`following approval, update X`、`pending review, update X`。
4. **不得回归（负例）**：十轮登记原句（`更新 X 还是新建一个文档`、`修 X 行不行`、`修改 X 该不该`、`一旦确认，修复 X`、`after you confirm, update X`…）仍只读；86 条登记负例逐句成立。
5. **不得回归（正例）**：登记 21 条正例逐句授权；`把 X 里的错别字改掉`、`请把 X 里的错别字改掉`、`将 X 删除`、`对 X 进行修改`、`删除 X 的过时内容`、`修改 docs/过时说明.md` 必须授权且 `writePaths` 只含目标。

### 9.2 Test 最小覆盖矩阵（修复轮后必须覆盖）

| # | 维度 | 最小用例（≥） | 期望 |
|---|---|---|---|
| 1 | 目标优先陈述形态（W3R11-01） | `尚未/未/没/还没/正在/计划/打算/准备/可以/允许/支持/同意/拒绝/想/决定/考虑` × 至少 2 动词 | 全部只读，零授权行 |
| 2 | 选择/问句尾形态（W3R11-02） | `哪个更好/抑或/要不然/也可以/的哪个部分/vs./versus` 各 1 | 全部只读 |
| 3 | 条件前件形态（W3R11-03） | `待你确认，/等你确认，/看情况，/酌情，/发现问题，/upon approval,/following approval,/pending review,` 各 1 | 全部只读 |
| 4 | 误拒修复（W3R11-04/05） | `删除/清理 X 的过时内容`、`修改 docs/过时说明.md`、`修改 docs/会议.md`、`fix docs/no-index.md`、`把/请把/将/对 X …动词` | 全部授权且 `writePaths` 只含目标 |
| 5 | 完成体/被动/引用/罗列/反问（回归） | 第九轮 23 句完成体 + 被动矩阵抽样 | 全部只读 |
| 6 | 文档化正例不回归 | 明确修复（中英）、`X 的错别字麻烦处理下`、`解释 X 并修复 Y`、`别改 A，改 B`、`修改 X 而不是 Y`、`参考 X，修改 Y` | 全部授权且写范围只含目标 |
| 7 | 作用域断言 | 参照/排除/否定纠正 4 句 | 参照与被排除路径不入写范围 |
| 8 | 登记语料 | 86 负 + 21 正 | 逐句成立 |
| 9 | HTTP 端到端（新增） | 上述 1/2/3 组各 ≥3 句经 `POST conversation.message.send`：`authorizationId=null`、`level=none`、零授权行、无 `delivery` Work | 全部只读 |
| 10 | **Orchestrator 回归（W3R4-05，仍未闭合）** | 授权正例 `assess(L2)` → `dispatch` `backend/implementation` 成功；grant 外路径 + `deploy`/`network` → `NOT_AUTHORIZED` | 建 Run / 拒绝 |
| 11 | 注入面不回归 | `workItems`/`works`/`authorization`/`grants`/`scope`/`level`/`intent`/`targetRole`/`ownerUserId` 注入 | 全部忽略且零授权（未知字段按 W3R11-08 决定后断言 `VALIDATION_ERROR` 或"忽略"） |
| 12 | 前轮 P0/P1 | 下载 token 一次性（W3-01）、预览 ACL（W3-02）、`assertGrantWithinMessage`（W3R4-03）、CSP 逐字（W3R3-06）、跨会话 `targetWorkId`、追发不改写 Work | 无回归（`probe7` 17/17 已通过） |
| 13 | 附件/产物面 | 上传限制/TTL/重复绑定、版本链/失效、预览截断、单次下载 | 无回归（本轮未动，抽验即可） |

### 9.3 残余风险清单（区分两类）

**A. 文档化缺陷 —— 必须修（P1 阻断；P2 随修复轮订正）**
1. W3R11-01 目标优先陈述句（16 谓词形态，85 模板 80 授权，HTTP 8 + e2e 7 可写）。
2. W3R11-02 选择/问句尾变体（hold-out 7/9，HTTP 4 + e2e 3 可写）。
3. W3R11-03 条件前件变体（hold-out 9/11，HTTP 4 + e2e 2 可写）。
4. W3R11-04/05 合法祈使误拒（16/16，fail-closed，不阻断但影响 AC-005 可用性）。
5. W3R11-06 记录绝对表述与旧计数（P3，随修复轮订正）。

**B. 未登记句式 fail-closed 代价 —— 已声明，接受并需 Test 承认**
6. 未登记同义祈使（`重写/润色/rewrite/polish/tweak/clean up/去掉/缩短/把 X 改短`）→ 只读 + 澄清（`plan.md:17-18`、`implementation.md:191`）。
7. 词表前缀的偶然性（`补全 X` 授权、`重写 X` 不授权）。
8. 语义分类的最终责任在 WP-04/06 模型 Assessment；本包只承诺已登记语料与形态规则。

**C. 与本包无关或已承接**
9. 真实无头浏览器攻防（WP-10）；真实 Provider 纵向与 `artifact_write` 工具接线（WP-10/WP-07）。
10. W3R11-07/08 与 W3R4-06/08/10/12/13（P3，结算前登记或修复）。

---

## 10. 方法与边界声明

- **独立上下文**：未读取任何开发/Test 会话；结论只来自仓库文件、`docs/**` 契约与我自建的 10 个脚本（`/tmp/w3r11/`），全部消费 `pnpm build` 产物（`packages/domain/dist/requests.js`、`apps/daemon/dist`、`packages/core/dist`）；**未 import 任何产品测试文件**（`domain.test.ts` 仅以逐行文本方式提取语料，提取后逐句用**构建产物**复跑）。
- **差分解剖方法**：用 `git show 0fb5c71:packages/domain/src/requests.ts` 导出旧实现到 `/tmp/w3r11/old/`，通过 Node 24 的类型剥离（`node old/requests.ts`）直接运行，与新构建产物并跑同一语料；未修改任何仓库文件（`git status` 干净）。
- **实验统计（观测 / 缺陷证据）**：

| 脚本 | 观测 | 缺陷证据 | 对应 |
|---|---|---|---|
| `probe1-domain.mjs` | 141 负 + 28 正 + 4 作用域 | 负向 **21** 越权（陈述 15、选择/问句尾 5、条件 1）；正向 **5** 误拒；作用域 4/4 | W3R11-01/02/03/04 |
| `probe2-templates.mjs` | 85+17+34+9+5+5 模板 + 10 对照 | A **80/85**、B **6/17**、C **8/34**、C-EN **4/9** 泄漏；对照 **5/10** 误拒 | W3R11-01..05 |
| `probe3-http.mjs` | 23 句真实 HTTP | 负向 **16/16** 落库授权（L2 + 1 授权行 + 1 assessment）；登记负例 3/3 只读、正例 4/4 授权 | W3R11-01/02/03 |
| `probe4-e2e.mjs` | 17 句真实 Orchestrator | **12 条非祈使句各建立真实 `backend/implementation` 写 Run**；正例 3/3 建立；登记负例 2/2 未建立 | W3R11-01/02/03 |
| `probe5-corpus.mjs` | 登记 86 负 + 21 正 + 4 作用域 | **0 偏差** | 回归网 |
| `probe6-injection.mjs` | 11 注入项 | 0 授权行、0 越权 Work；4 项静默忽略未知字段 | W3R11-08 |
| `probe7-prior.mjs` | 17 项前轮 P0/P1 | **17/17 通过** | §5.2 |
| `probe8-diff.mjs` | 97 负 + 15 正（双树并跑） | 负向**只修好 1 条、仍开 88 条、干净 8 条**；正向**新坏 4 条** | W3R11-01/03/05 |
| `probe9-round10.mjs` | 13 登记样本 + 20 hold-out | 登记 **0/13** 残留；hold-out **16/20** 开 | W3R11-02/03 |
| `probe10-falsereject.mjs` | 18 项（16 非对照） | **16/16 误拒**（复合词/路径/处置式） | W3R11-04/05 |

- **未做**：真实无头浏览器执行、真实 Provider 纵向、Docker 容器内复验、故障注入下的孤儿 blob 复验、`pnpm test:e2e`/`test:acceptance`（脚本按设计指向 WP-09/WP-10，未实现）。
- **未改仓库**：本轮只覆盖写入 `.agentdev/work/WP-03/review.md`（本报告）；除该文件外 `git status --porcelain` 为空，`HEAD` 仍为 `7b0e6b5a8c5823a329d9781155ceabddab36b44e`，全部 6 条契约命令在上述工作树上执行。
- **对开发方「默认拒绝的严格命令模板」主张的裁决**：**方向正确、落地不足**——第十轮点名的 13 条登记样本确实被修好（`probe9` 0/13），登记语料 86+21+4 全绿，这是可核查的进步；但差分解剖显示新树相对旧树在 97 条负向探针上**只多修好 1 条**，同时把 4 条旧树本可授权的常用祈使变成误拒。所谓"默认拒绝"在 `COMMAND_TAIL` 这一支上并未实现：非命令谓词不在 `NON_COMMAND_MARKERS` 内即直通授权。故本轮仍判 **FAIL**，且与第八、九、十轮同一根因（**形态判定退化为词表枚举**）——这既不是 planVersion 2 免责的"未登记同义祈使 fail-closed"，也不是"已登记语料"，而是**明确非命令的句子 fail-open**。

---

## 附一：第一轮摘要（保留）

第一轮（报告冻结于 `a946ed6`，被审代码树 `fd90fef`）结论 **FAIL**：必验范围「实现完整直接协作与产物路线，附件暂存/绑定、隔离预览可实际运行」不成立，新增 14 条 Finding —— **2×P0、5×P1、5×P2、2×P3**；P0/P1 全部阻断，P2 的 W3-06 因影响 AC-002 阻断。要点：下载 token 可预测且下载路由先于认证（W3-01 P0）；产物读取无主体维度（W3-02 P0）；owner 由 sessionId 派生（W3-03 P1）；消息正文未写 blob（W3-04 P1）；未知会话上传 500（W3-05 P1）；失效产物仍可预览（W3-06）；AC-006 未实现（W3-07 P1）；用户消息不建 Authorization（W3-08 P1）；token 只增不减/`prune` 无调用方（W3-09）；归档会话仍接受上传（W3-10）；`expireStale` 无调用方（W3-11）；错误响应无 §1 封装（W3-12）；记录不一致（W3-13）；浏览器级攻防未验（W3-14，承接 WP-10）。另 5 项对抗性（内联预览字节上限、文件签名、`targetWorkId` 归属、隔离只靠客户端头、失败上传孤儿 blob 与 staged 无上限）。

## 附二：第二轮摘要（保留）

第二轮（报告冻结于 `8e4efc1`，被审代码树与 HEAD 同为 `a946ed6`）结论 **FAIL**：主要判据 W3R2-01（AC-006 未实现）与 W3R2-02（AC-005 未实现），另 2×P2（W3R2-03 CSP 漂移、W3R2-04 StorageError 映射/回显）、9×P3（W3R2-05..13）。第二轮对抗性 7 项：1/3/4/5/7 已修，2 部分（语义可辩护），6 已修但无测试守护。六条契约命令全绿但不足以支撑必验范围。

## 附三：第三轮摘要（保留）

第三轮（报告冻结于 `35e8674`，被审代码树 `d71dc07`）结论 **FAIL**：AC-005 的授权机制（`routeMessage`、消息级 Authorization 行、`work.authorizationRef`、Assessment、混合意图多 Work 与独立 scope）全部**落库**且成立，但 `grantedByMessage` 生成 `readPaths:['docs']` + `operations:['edit']` 的自相矛盾授权，使绑定它的 Work 的任何 Run/Assessment 都被 `capabilityGaps:['readPaths without a read operation']` 拒绝——交付路线在准入即死锁（W3R3-01 P1）。新增 **1×P1、5×P2、8×P3**；对抗性另指出疑问句被当作执行消息、HTTP 客户端可自报 `authorization`（甚至 `deploy`）。失败路由 `Blocking Review Finding → Develop → Independent Review`。

| 三轮编号 | 严重度 | 摘要 | 第十一轮状态 |
|---|---|---|---|
| W3R3-01 | P1 | 授权 capability 缺口 → 交付死锁 | 已修（probe4 正例评估/派发走通） |
| W3R3-02 | P2 | 授权绑定 `works[0]` | 已修 |
| W3R3-03 | P2 | 授权自相矛盾 | 已修 |
| W3R3-04 | P2 | HTTP 响应不含 `workIds`/`authorizationId` | 响应已含；`protocol.md` 仍未对账（W3R11-08） |
| W3R3-05 | P2 | 同 intent 重复共享 scope | 已修（`workItems` 取消后不再适用） |
| W3R3-06 | P2 | CSP 与 `execution.md` §6 漂移 | 已修且逐字相等 |
| W3R3-07 | P2 | StorageError 映射过宽 + 回显 | 回显已修；映射细分仍缺（W3R11-08） |
| W3R3-08/09/10/11/12/13/14 | P3 | validity/归属/owner 派生/prune/证据/数字/协议项 | 部分未闭合（W3R11-08） |

## 附四：第四轮摘要（保留）

第四轮（报告冻结于 `fd0a893`，被审代码树 `3f52fbf`）结论 **PASS（0×P1、3×P2、11×P3）**，但同轮对抗性核验以 HTTP 端到端证伪「越权已闭合」：`explain why … needs a fix`、`don't fix …`、`不要修改 …`、`I am not asking you to fix …` 等仍生成写授权并可派发写 Run；另指出 `targetWorkId` 可改写已有 Work 的 level/authorizationRef、`Content-Security-Policy-Sandbox` 不是标准头、消息授权 L1 与 `routingFloor` 的 L2 不一致、`workItems:[null]`/`intent:'operation'` 造成 500 或非法 Work。

| 四轮编号 | 严重度 | 摘要 | 第十一轮状态 |
|---|---|---|---|
| W3R4-01 | P2 | 同 intent 多 Work 共用 scope | 已修（`workItems` 取消后不再适用） |
| W3R4-02 | P2 | `workItems` 把授权挂到只读 Work | 已修（字段取消） |
| W3R4-03 | P2 | `assertGrantWithinMessage` 不约束 `readPaths` | 已修（probe7 复核） |
| W3R4-04 | P3 | `workItems` 未校验 → 500 | 已修（字段取消） |
| W3R4-05 | P3 | 无 Orchestrator 授权回归用例 | 未修（W3R11-07；grep 仍 0 命中） |
| W3R4-06 | P3 | `protocol.md` 未对账 | 未修（W3R11-08） |
| W3R4-07 | P3 | `message.received` 缺 `workIds`/`authorizationId` | 已修 |
| W3R4-08 | P3 | `StorageError` 映射粗 | 未修（W3R11-08） |
| W3R4-09 | P3 | 记录数字不符 | 本轮数字一致；`planVersion` 头未同步见 W3R11-06 |
| W3R4-10 | P3 | `targetWorkId` 归属只覆盖 message 来源 | 未修（W3R11-08） |
| W3R4-11 | P3 | 失败发送孤儿 blob | 第十一轮不可复现（记录承接） |
| W3R4-12 | P3 | multipart 多文件 / `projectId` | 未修（W3R11-08） |
| W3R4-13 | P3 | 错误响应非 §1 封装 | 未修（W3R11-08） |
| W3R4-14 | P3 | 冻结点与任务不一致 | 第十一轮一致（`HEAD=7b0e6b5`） |

## 附五：第五轮摘要（保留）

第五轮（报告冻结于 `fd0a893`，被审代码树 `3f52fbf`）结论 **FAIL（0×P0、2×P1、2×P2、5×P3）**：

- **W3R5-01 [P1]** 非执行消息（中英文疑问、否定、陈述、名词化解释）仍产生可用写授权并可派发写 Run（17 个新句式，HTTP 端到端验证）。
- **W3R5-02 [P1]** 明确指令被判为拒绝/解释：裸单字 `别` 命中「错别字/识别/特别/分别」、`说明/介绍` 名词化被当解释、`、` 不参与分词、逗号列表只授权首项（7 例误拒）。
- **W3R5-03 [P2]** 无效 `Content-Security-Policy-Sandbox` 头仍在 wire 上，修复记录与提交信息不实（第七轮已订正并实测单头）。
- **W3R5-04 [P2]** 调用方 `authorization.readPaths` 不受消息范围约束（latent；第七轮已修）。
- **W3R5-05..09 [P3]** `targetWorkId` 归属、孤儿正文 blob、记录数字、前轮剩余项、冻结点漂移。
- 同轮确认已修：`pathsIn` 线性化、`targetWorkId` 不改写目标 Work、消息授权 L2 与 `routingFloor` 一致、`workItems` 逐项校验。

第五轮 §6.1 的 17 句越权语料，**第十一轮以 `1ede8c7` 复跑全部只读**；§6.2 的 11 句误拒语料剩 1 句（`docs/INDEX.md 的说明需要修改一下`）为 fail-closed。

## 附六：第六轮摘要（报告缺档）

第六轮 Reviewer **未产出报告**（报告文件为空，`HEAD=7c01c9d` 时无 Review 结果入库）。同轮对抗性核验以 `7c01c9d` 为冻结点独立复现，确认第五轮点名的误拒/CSP/`readPaths` 三组已闭合，但补出：陈述/完成体与认识情态（`我已经修改了 X`、`刚修复了 X`、`I already fixed X`、`X 需要修改`、`是否应该修改 X`、`是否需要更新 X`、`麻烦评估一下 X 是否需要修改`）仍产生可派发写授权；`docs/INDEX.md 的错别字麻烦处理下` 等日常祈使句不授权；`workItems` 第二个同 intent 项 scope 为空；记录中「永不下发写授权」措辞不实；另补 `workItems` 无数量上限、`别改 A，改 docs/plan.md` 误拒、CSP 第二头名残留、`assertGrantWithinMessage` 未约束 `readPaths`。

## 附七：第七轮摘要（保留）

第七轮（报告冻结于 `8f8b2df`，被审代码树与之相同）结论 **FAIL（0×P0、3×P1、1×P2、3×P3）**：

- **W3R7-01 [P1]** 只读请求词（`看一下/检查一下/帮忙/帮我/麻烦/请` + 命名路径）获得写授权并可派发写 Run（`848b5c4` 引入的回归；对照 `7c01c9d` 不授权）——**第十一轮判定已修，无回归**。
- **W3R7-02 [P1]** 中文完成体因 `\b` 在 Han 语境恒不匹配而形同虚设；中文疑问缺 `谁/哪些/几点`；英文 `needs a fix`/`The fix needed in…` 未覆盖——**第十一轮判定：登记原句与大批变体已修；选择/条件形态仍未修（W3R11-02/03）**。
- **W3R7-03 [P1]** `别改 A，改 B`、`不要修改 A，但要修复 B` 等混合指令误拒（AC-005/006 正例失败）——**第十一轮判定已修，无回归**。
- **A1 [P1 对抗性]** 被排除目标仍获写授权（`修改 docs/PLAN.md 而不是 docs/INDEX.md`）——**第十一轮判定已修**。
- **A2 [P1 对抗性]** 中文混合意图不拆分（`解释 X 并修复 Y`）——**第十一轮判定已修**。
- **A3 [P1 对抗性]** 纯建议请求授权（`请给出 docs/INDEX.md 的修改建议`）——**第十一轮判定已修**。
- **W3R7-04 [P2]** 边界声明/记录措辞不实——**第十一轮仍未订正（W3R11-06）**。
- **W3R7-05 [P3]** `workItems` 回落 scope 产生不可执行 Work——**第十一轮不可复现（字段已取消）**。
- **W3R7-06 [P3]** 前轮未闭合项与记录数字——**第十一轮仍在（W3R11-07/08）**。

## 附八：第八轮摘要（保留）

第八轮（报告冻结于 `c82169bc72bbcf8395fb2b00584db8e0b3c60b72`）结论 **FAIL（0×P0、3×P1、1×P2、1×P3）**：

- **W3R8-01 [P1]** 中文完成体/陈述的**形态**未被识别：`已经优化了 X`、`已经整理了 X`、`已经修好了 X`、`改动已完成：X`、`我把它改好了：X` 等 12 个变体仍授权 —— **第十一轮判定：已修（全部只读）**。
- **W3R8-02 [P1]** 拒绝与非承诺、以及部分疑问句仍授权（`我不想修改 X`、`别急着修改 X`、`请勿修改 X`、`修改 X 了没有`、`Will you fix X`、`Shall we update X` 等）—— **第十一轮判定：拒绝/普通疑问已修；选择形态仍未修（W3R11-02）**。
- **W3R8-03 [P1]** 只读言说行为（解释/评价/了解/请教）中嵌入变更动词即授权 —— **第十一轮判定已修（10/10 只读）**。
- **W3R8-04 [P2]** 记录与实现不一致 —— **第十一轮仍未订正（W3R11-06）**；本轮计数 86+21 已与实测一致，绝对表述仍在（`:113/:140/:177/:186`）。

## 附九：第九轮摘要（保留）

第九轮（报告冻结于 `d23ce7b1d3c33df8854420941d1a937af9319a2a`；被审代码树同为 `d23ce7b`）结论 **FAIL（0×P0、3×P1、1×P2、2×P3）**，全部以真实 HTTP + 真实 Orchestrator 取证：

- **W3R9-01 [P1]** 句首 `V了` / `V完了` 的**陈述/完成体**仍被当作祈使并授权（`补充了 X`、`优化了 X`、`改好了 X`、`修改好了 X`、`删除掉了 X`、跨子句 `更新了接口文档，补充了 X 的说明`）——**第十一轮判定：已修（复跑 23 句完成体语料全只读）**。
- **W3R9-02 [P1]** **选择疑问句**（`修改 X 好还是不改好`、`修 X 行不行`、`fix X or leave it alone`、`refactor …, yes or no`）仍授权 —— **第十一轮判定：登记原句已修；同族登记外变体 7/9 仍越权（→ W3R11-02）**。
- **W3R9-03 [P1]** **修饰性/参照性从句前置**（`based on X, update Y`）因逗号切分授权了参照路径 —— **第十一轮判定：已按 T17 新口径关闭（参照只授权自身命名目标；4/4 作用域断言 + 10 变体；X 从不入写范围）**。
- **W3R9-04 [P2]** 记录绝对表述与旧计数 —— **第十一轮仍未订正（W3R11-06）**。
- **W3R9-05 [P3]** 协议对账（未知字段静默忽略、响应字段多于协议表）—— **第十一轮仍在（W3R11-08）**。
- **W3R9-06 [P3]** 未登记祈使 fail-closed 代价清单 —— **第十一轮仍在**。

## 附十：第十轮摘要（保留）

第十轮（报告冻结于 `e384dd10b84a1e6bfcf1612ad9f5dc706e232590`，**被审代码树 `0fb5c71`**，第十轮修复提交为 `1ede8c7`）结论 **FAIL（0×P0、2×P1、1×P2、3×P3）**：

- **W3R10-01 [P1]** 选择疑问/征询语气的**变体**仍产生写授权并可派发真实写 Run（`更新 X 还是新建一个文档`、`修 X 行不行`、`修改 X 该不该`、`修改 X 哪个更好`、`修改 X 抑或重写`、`fix X vs. leave it`、`refactor X, yes or no` 等；自建矩阵 14/36 fail-open）——**第十一轮判定：登记原句 6 条已修；同族 hold-out 7/9 仍越权（→ W3R11-02）**。
- **W3R10-02 [P1]** 不触发条件继承的**条件前件**变体仍产生写授权并可派发真实写 Run（`一旦确认，修复 X`、`经确认后，修改 X`、`有错误的话，修复 X`、`once approved, fix X`、`after you confirm, update X`）——**第十一轮判定：登记原句 5 条已修；同族 hold-out 9/11 仍越权（→ W3R11-03）**。
- **W3R10-03 [P2]** `NON_COMMAND_MARKERS` 的**单字命中**误杀文档化正例（`删除 X 的过时内容`、`清理 X 的过时内容` 等）——**第十一轮判定：未修且扩展（路径名含 `过/了/会/被/or/no` 亦被拒；→ W3R11-04）**；注：第十轮报告"`删除过期内容` 是 `experience.md` §3 规范动作"的前提不成立（`grep -rn "过时" docs/` = 0 命中），但误拒事实成立。
- **W3R10-04 [P3]** 记录仍含绝对表述与旧轮次计数（`implementation.md:113/:140/:186`）——**第十一轮仍未订正（→ W3R11-06）**。
- **W3R10-05 [P3]** 回归网缺口：选择疑问/条件前件/复合词误拒零断言，授权→`assess`/`dispatch` 无产品用例——**第十一轮仍在（→ W3R11-07）**。
- **W3R10-06 [P3]** 协议对账（未知字段静默忽略、响应字段多于协议表）与第八轮报告哈希笔误 —— **第十一轮仍在（→ W3R11-06/08）**。
- 第十轮以自建 8 个脚本（`/tmp/w3r10/probe1..8`）取证：非祈使 150/165 只读、15 越权；HTTP 7 条落库授权；真实 Orchestrator 7 条建立写 Run；登记 71 负 + 19 正 + 4 作用域 0 偏差；客户端注入 0 通路。
