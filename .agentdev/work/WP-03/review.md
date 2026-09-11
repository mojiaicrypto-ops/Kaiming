# WP-03 独立 Review 报告（第十四轮）

- 评审对象：工作包 WP-03「直接协作与说明产物」
- 评审轮次：**第十四轮**（第一～十三轮摘要见文末「附一～附十三」，全部保留）
- 冻结点 / HEAD：`git rev-parse HEAD` = `f40d6343a132ce59dcc5b08e267b7df891e8ca31`（**与任务下达的 `HEAD=f40d634` 一致**）
- 被审代码树：`f40d634` 本身（本轮无「报告提交漂移」）；`git diff --name-only 6f48d26 f40d634` = `packages/domain/src/requests.ts`、`packages/domain/test/domain.test.ts`、`apps/daemon/test/server.test.ts`、`packages/core/test/artifacts.test.ts`、`.agentdev/work/WP-03/implementation.md`、`.agentdev/work/WP-03/review.md`（**6 个 blob**）
- 工作树：全部命令执行前后 `git status --porcelain` 为空；除本报告外无未提交修改
- 评审角色：Review（独立上下文；未读取任何开发/Test 会话；只依据仓库文件、契约文档与 `/tmp/w3r14/` 下我自建的 7 个实验脚本 + 复用 `/tmp/w3r13/` 的 3 个只读回归脚本）
- 工具：`node v24.8.0`、`pnpm 12.3.4`、macOS 宿主；全部脚本消费 `pnpm build` 产物（`packages/domain/dist`、`packages/core/dist`、`apps/daemon/dist`、`packages/storage/dist`），**未 import 任何产品测试文件**
- 记录哈希（`git hash-object`，前 8 位）：`packages/domain/src/requests.ts` **`1dc5666c`**（T21/T22 后；第十三轮为 `8fc2d5fe`）、`packages/domain/test/domain.test.ts` **`fa38afbf`**、`apps/daemon/test/server.test.ts` `e88978f5`、`packages/core/test/artifacts.test.ts` `acf115d4`、`.agentdev/work/WP-03/implementation.md` **`96f773b8`**、`.agentdev/work/WP-03/plan.md` **`8986875e`（与第十一～十三轮逐字相同，未改动）**、`packages/core/src/messages.ts` `283d4c04`、`apps/daemon/src/server.ts` `3a348304`、`packages/core/src/preview.ts` `803b502a`
- 变更范围：本轮仅 `packages/domain/**`（路由 + 测试）、两个 HTTP/Core 测试的**正例措辞**与过程记录；`packages/core/src/**`、`apps/daemon/src/**`、`docs/**`、`plan.md` **零改动**（哈希与第十三轮逐字相同）→ 核心/HTTP 面的前十三轮 P0/P1 由「未改动 + 独立复验」担保（见 §7）
- 权威依据：`AGENTS.md`、`docs/INDEX.md`、`docs/rules/{workflow,agents}.md`、`docs/product/experience.md`（§3）、`docs/architecture/{data,protocol,execution,reliability}.md`、`docs/delivery/{implementation,acceptance}.md`（AC-001..006/052/076/084）、`.agentdev/work/WP-03/{plan,implementation,review}.md`、`packages/**`、`apps/daemon/**`、相关测试

---

## 1. 结论

**FAIL（不能进入独立 Test；按 `docs/rules/workflow.md` §6 走 `Blocking Review Finding → Develop → Independent Review`）。**

本轮判 **FAIL（0×P0、3×P1、2×P2、3×P3）**。

T21/T22 的**无尾命令文法本身是正确的方向，也确实关闭了第十三轮点名的全部形态**：

- 第十三轮 197 句语料在本轮 build 上复跑：`B1 动词优先尾巴 28/28`、`B2 选择尾 11/11`、`B4 条件前件 15/15`、`B5 条件复位 4/4`、`B6 英文尾巴 9/9`、`B7 中英混合 5/5`、`B8 引号 5/5` **全部只读，0 泄漏**（第十三轮 54 句 A 档 fail-open 归零）。
- 目标优先九族（86+211）保持全关；英文捕获真路径、目标逐字相等（`pathsIn(core).includes(target)`）成立，`修改 X...`/`修改 X.` 不再铸造别名。
- `conditional` 不再复位：`经批准，修改 X，删除 Y`、`视情况而定，修改 X，删除 Y`、`先讨论，再修改 X，然后删除 Y`、`待你确认，修改 X，更新 Y` **4/4 只读**（W3R13-04 关闭）。
- 登记回归网 12 正 + 79 负 **0 偏差**；处置式（`把/将/对`）、混合意图、并列连词引入的命令仍可用。

但「**前件规则按结构关闭 fail-open**」这一主张**不成立**：T22 把「命令只能出现在首子句或由并列连词/承接副词引入的子句」当成结构性门，而 `continues = /^(?:但|但是|而是|不过|也|再|就|则)/`（`requests.ts:377`）使**任何未登记前件**都可以被一个承接副词/连词重新打开；同时 `ADVERB_LEAD_PATTERN` 的**可选情态词**（`要|需要`，`requests.ts:227-228`）把「需要修改 X」这类陈述在判定前洗成裸命令。两条都产生可派发的真实写 Run，且可指向 `packages/core/src/**` 源码。

| 维度 | 第十三轮 | 第十四轮 |
|---|---|---|
| 目标优先整类 | 已关闭 | **保持关闭** |
| 动词优先「有界尾巴」 | 54 句 A 档 fail-open | **归零（T21 关闭）** |
| 条件前件（登记形态） | 13 句 + 复位缺陷 | **登记形态 + 复位均关闭** |
| **未登记前件 + 承接副词（`就/再/也/但/然后/and then`）** | 未测 | **新开：20/22 + 8/8 纯陈述；HTTP 31/40、e2e 20/20 可写（W3R14-01）** |
| **副词 + 情态词洗白（`但需要修改 X`）** | 未测 | **新开：13/20（10×需要 + 3×要）；HTTP/e2e 可写（W3R14-02）** |
| 否定后纠正（`别改 A，改 B`） | 第十三轮判定「无回归」 | **回归为只读（W3R14-03）** |
| 多目标/静默部分授权 | `修改 X and Y` → 仅 X | **未修（W3R13-06 → W3R14-04）** |
| 登记语料 | 12 正 + 77 负 | **12 正 + 79 负，0 偏差（记录称 11 + 84，见 W3R14-05）** |
| 客户端注入面 | 无通路（11 项） | **无通路（11 项）** |
| 前轮 P0/P1 复验 | 17/17 | **16/17（否定后纠正回归）** |
| P1 数量 | 4 | **3** |

三条 P1 均落在本包验收面（AC-004 负例、AC-005 授权边界、`workflow.md` §1/§6），**全部以真实 HTTP + 真实 `Orchestrator` 端到端可复现**，**阻断 Test**。

---

## 2. 契约命令原始结果（本轮实跑）

执行目录：仓库根；在 `HEAD=f40d634`、工作树干净时执行；`pnpm build` 产物由本轮 build 生成。逐条串行，原始日志：`/tmp/w3r14/contract.log`。

| 命令 | 退出码 | 原始结果要点 |
|---|---|---|
| `pnpm typecheck` | **0** | `tsc -p tsconfig.json --pretty false`，无输出 |
| `pnpm lint` | **0** | `Checking formatting... All matched files use Prettier code style!` |
| `pnpm test:unit` | **0** | `Test Files 19 passed (19)`、`Tests 289 passed (289)` |
| `pnpm test:integration` | **0** | `Test Files 10 passed (10)`、`Tests 124 passed (124)` |
| `pnpm docs:check` | **0** | `docs:check ok — 15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages` |
| `pnpm build` | **0** | `pnpm -r build`，**8** 个 workspace `build: Done`：`contracts, cli, domain, storage, core, daemon, pi-runtime, runner` |

`git status --porcelain`（写入本报告前）：**空输出**；`HEAD` 全程 `f40d6343a132ce59dcc5b08e267b7df891e8ca31`。
计数对账：`implementation.md` T21/T22（`:251`/`:260`）的 `289 / 124 / 8 / docs:check ok` 与实测**一致**。

**命令全绿不等于必验范围成立**：本轮全部越权、误拒与端到端证据在仓库测试内**零断言**（见 W3R14-07）；`Orchestrator` 仍不出现在 `apps/daemon/test/server.test.ts`、`packages/core/test/artifacts.test.ts`；且本提交把两处**英文混合意图正例**（`explain … and fix the typo in docs/INDEX.md`）改成中文（`explain … and 修复 docs/INDEX.md`）、把 `对 docs/PLAN.md 进行修改` 改成 `对 docs/PLAN.md 修改`，属**测试覆盖收缩**。

---

## 3. 越权方向：独立穷举核验

### 3.1 口径声明（先声明后实测）

- **缺陷（fail-open）**：句子**不是祈使指令**（陈述/状态/条件/意见/疑问/选择/引用），却在 `routeMessage` 上产生 `explicitAuthorization=true`。
- **非缺陷（已声明代价，T21/T22 + planVersion 2）**：未登记同义变更词（`重写/润色/polish`）、名词短语祈使（`修改 X 中的错别字`、`fix the typo in X`）、目标优先日常祈使、多目标中文列表、排除式 → 只读 + 澄清。
- **非缺陷（真祈使）**：`并/and` 连接的两个真祈使（`把 X 删除并更新 Y`、`修改 X 并删除 Y`）各自授权各自目标，不计扩张。
- **判定分档**：A 明确非命令（计入缺陷）；B 形态可辩（单列）；C 真祈使；F 已声明 fail-closed。

### 3.2 语料与结果总表（`/tmp/w3r14/probe1-corpus.mjs`，201 句，全部消费 `pnpm build` 产物）

| 族 | 句数 | 授权/缺陷 | 判定 |
|---|---|---|---|
| **F1 未登记前件 + 承接副词/连词**（`视具体情况，就/再/也/但修改 X`、`经审批，再修改 X`、`看结果，就修复 X`、`视具体情况，然后修改 X`、`depending on the result, then update X`、`after review, then update X`） | 22 | **20 fail-open** | **结构性主张证伪（W3R14-01）** |
| **F1b 纯陈述 + `也/但` 承接**（`需要修改 X，也需要修改 Y`、`这个文档有问题，也需要更新 Y`、`还没决定，也需要修改 Y`、`目前不用改 X，也需要更新 Y`） | 8 | **8 fail-open** | **W3R14-01（全 A 档）** |
| **F2 副词 + 情态词洗白**（`但需要修改 X`、`就需要修改 X`、`也需要修改 X`、`另外需要修改 X`、`但需要整理 X`、`但需要把 X 改掉`；`也要/但要/另外要`） | 20 | **13 fail-open**（10×`需要` + 3×`要`） | **W3R14-02** |
| F3 第十三轮 A 档尾巴（22 句） | 22 | **0** | 已关闭 |
| F3 第十三轮条件前件（6 句） | 6 | **0** | 已关闭 |
| F3 第十三轮条件复位（4 句） | 4 | **0** | 已关闭 |
| F3 第十三轮选择尾（5 句） | 5 | **0** | 已关闭 |
| F4 目标优先九族抽样 | 14 | **0** | 保持关闭 |
| F5 疑问/选择 | 17 | **0** | 保持关闭 |
| F6 条件/假设 | 7 | **0** | 保持关闭 |
| F7 多目标 | 9 | 0 fail-open / **2 部分授权** | W3R14-04 |
| F8 英文动词优先 | 12 | **0** | 正确 |
| F9 处置式 | 10 | **0** | 正确（`把 X 里的错别字改掉` 属已声明 fail-closed） |
| F10 文档化正例 | 22 | 1 误拒 | **`别改 Y，改 X` 回归（W3R14-03）** |
| F11 已声明 fail-closed | 17 | 0「意外授权」 | 与声明一致（只读） |
| F12 作用域 | 6 | **0 扩张** | 正确 |
| **合计** | **201** | **41 FAIL-OPEN + 2 PARTIAL + 1 FALSE-REJECT** | A 档 38（F1 20 + F1b 8 + F2×`需要` 10）+ B 档 3（`要`） |

对照复跑：`/tmp/w3r13/probe1-corpus.mjs`（197 句，第十三轮语料）在**本轮 build** 上得到 `B1..B8 = 0`；同脚本的 8 条 C 档正例（`修改 X 中的错别字`、`更新 X 的说明`、`处理一下 Y 的错别字`、`删除 X 的旧内容`、`清理 Y 的重复段落`、`fix the typo in X`、`把 X 里的错别字改掉`、`对 X 进行修改`）全部转为只读——其中 7 条属 T21/T22 概括声明的 fail-closed，`对 X 进行修改` 未逐项登记（见 W3R14-06）。

### 3.3 实证证据句

**（1）W3R14-01 前件规则被承接副词绕过（20 + 8 句 A 档）**

```
视具体情况，就修改 docs/INDEX.md        -> writes=["docs/INDEX.md"]
视具体情况，再修改 docs/INDEX.md        -> writes=["docs/INDEX.md"]
视具体情况，也修改 docs/INDEX.md        -> writes=["docs/INDEX.md"]
视具体情况，但修改 docs/INDEX.md        -> writes=["docs/INDEX.md"]
经审批，再修改 docs/INDEX.md            -> writes=["docs/INDEX.md"]
看结果，就修复 docs/INDEX.md            -> writes=["docs/INDEX.md"]
先跟你确认，再修改 docs/INDEX.md        -> writes=["docs/INDEX.md"]
收到消息后，就修改 docs/INDEX.md        -> writes=["docs/INDEX.md"]
走完流程，就修改 docs/INDEX.md          -> writes=["docs/INDEX.md"]
视具体情况，然后修改 docs/INDEX.md      -> writes=["docs/INDEX.md"]
视具体情况，修改 docs/INDEX.md，但删除 docs/PLAN.md -> writes=["docs/PLAN.md"]
depending on the result, then update docs/INDEX.md -> writes=["docs/INDEX.md"]
after review, then update docs/INDEX.md -> writes=["docs/INDEX.md"]
after approval, then update docs/INDEX.md -> writes=["docs/INDEX.md"]
approval pending, then update docs/INDEX.md -> writes=["docs/INDEX.md"]
```

纯陈述族（整条消息没有任何祈使）：

```
需要修改 docs/INDEX.md，也需要修改 docs/PLAN.md      -> writes=["docs/PLAN.md"]
这个文档有问题，也需要更新 docs/PLAN.md              -> writes=["docs/PLAN.md"]
还没决定，也需要修改 docs/PLAN.md                    -> writes=["docs/PLAN.md"]
目前不用改 docs/INDEX.md，也需要更新 docs/PLAN.md    -> writes=["docs/PLAN.md"]
```

**关键对照（同形反向）**：

- `视具体情况，修改 X` → **只读**（第十三轮登记形态） vs `视具体情况，就修改 X` → **授权**；
- `depending on the result, update X` / `after review, update X` → **只读** vs 加 `then` → **授权**；
- `pending review, then update X` / `after you confirm, then update X` → **只读**（命中 `CONDITION_PATTERNS` 词表） vs `after review, then update X` → **授权**。

结论：命令是否被前件门住，取决于前件是否命中词表 **以及** 命令子句是否以 `但/也/再/就/则` 开头——这正是第十三轮 W3R13-02 的同一根因（**形态判定退化为词表/前缀枚举**），不是结构性关闭。

**（2）W3R14-02 情态词洗白（13 句，A 档 10 + B 档 3）**

```
但需要修改 docs/INDEX.md      -> writes=["docs/INDEX.md"]
就需要修改 docs/INDEX.md      -> writes=["docs/INDEX.md"]
也需要修改 docs/INDEX.md      -> writes=["docs/INDEX.md"]
另外需要修改 docs/INDEX.md    -> writes=["docs/INDEX.md"]
但需要整理 docs/INDEX.md      -> writes=["docs/INDEX.md"]
但需要把 docs/INDEX.md 改掉   -> writes=["docs/INDEX.md"]
```

**关键对照**：`需要修改 docs/INDEX.md` → **只读**（`NON_COMMAND_MARKERS` 含 `需要`） vs `但需要修改 docs/INDEX.md` → **授权**；`同时需要修改 X`、`并且需要修改 X` → **只读**（`同时/并且` 是子句分隔符，`需要` 留在子句首） vs `另外需要修改 X` → **授权**。差别只在于前缀是否被 `ADVERB_LEAD_PATTERN` 连同可选情态词 `(?:要|需要|请|麻烦|帮我|帮忙)?` 一起剥掉，剥掉后 `STATEMENT_PATTERNS`（`(?:需要|应该|…)`）再也看不到 `需要`。

**（3）W3R14-03 否定后纠正回归为只读（5 句误拒）**

```
别改 docs/PLAN.md，改 docs/INDEX.md          -> writes=[]  （第七轮 P1 W3R7-03 曾修复）
不要改 docs/PLAN.md，改 docs/INDEX.md         -> writes=[]
不修改 docs/PLAN.md，修改 docs/INDEX.md       -> writes=[]
先别改 docs/PLAN.md，改 docs/INDEX.md         -> writes=[]
don't fix docs/PLAN.md, fix docs/INDEX.md    -> writes=[]
```

对照仍可用者：`不要修改 docs/PLAN.md，但要修复 docs/INDEX.md` → 授权 `docs/INDEX.md`（因含 `但`）。即**纠正句是否被授权取决于是否恰好带 `但`**。

### 3.4 HTTP 端到端（`/tmp/w3r14/probe3-http.mjs`，真实 daemon：真实 SQLite + 真实 blob + Bearer）

40 句：**31/31 A 档非命令 fail-open** —— HTTP 202、`authorizationId` 非空、新增 1 条 `authorization` 行、新 Work `level=["L2"]`、`intent=["delivery"]`、`writes` 为句中路径、写入 1 条 `assessment`。代表句：`视具体情况，就修改 docs/INDEX.md`、`经审批，再修改 docs/INDEX.md`、`看结果，就修复 docs/INDEX.md`、`视具体情况，修改 docs/INDEX.md，但删除 docs/PLAN.md`、`depending on the result, then update docs/INDEX.md`、`after review, then update docs/INDEX.md`、`但需要修改 docs/INDEX.md`、`就需要修改 docs/INDEX.md`、`也需要修改 docs/INDEX.md`、`另外需要修改 docs/INDEX.md`、`需要修改 docs/INDEX.md，也需要修改 docs/PLAN.md`、`这个文档有问题，也需要更新 docs/PLAN.md`、`还没决定，也需要修改 docs/PLAN.md`。
对照组：第十三轮登记负例 6/6 只读（`authId=null`、`level=none`、零授权行）；正例 5/6 授权，1 条（`别改 Y，改 X`）只读。

### 3.5 真实 Orchestrator 端到端（`/tmp/w3r14/probe4-e2e.mjs`）

30 句：**20/20 A 档非命令各建立 1 个真实 `backend/implementation` 写 Run**（`writeRuns=["…:backend:queued"]`），全部经 `assess`（L2 + `authorizationRef` 通过 `verifyAuthorization`）与 Chief 父 Run。否定对照组 5/5 只读；正例 4/5 建写 Run，1 条误拒。→ **准入闸门正常，越权来自授权判定本身。**

### 3.6 危害上界（`/tmp/w3r14/probe2-extent.mjs`、`/tmp/w3r14/probe3b-http-src.mjs`）

- 越权范围恒等于句中**被点名的那一个/那些路径**，`operations=['read','edit']`、`networkTargets=[]`；环境/网络/越界路径仍被 `verifyAuthorization` 拒绝（作用域实验 **0 扩张**，见 §5）。
- 但目标**不限于 `docs/`**：`但需要修改 packages/core/src/orchestrator.ts`、`视具体情况，就修改 packages/core/src/orchestrator.ts`、`after review, then delete packages/core/src/orchestrator.ts` 均落库授权并建立真实 `backend:queued` 写 Run；`但需要修改 packages/core/src/orchestrator.ts，但需要删除 packages/core/src/messages.ts` 一次授权**两个源码文件**。
- 危害是「用户只是陈述/提问/给条件，却产生可执行的**源码**写授权与真实写 Run」，属 `workflow.md` §6 的 P1（错误行为/需求缺失）+ AC-004 负例失败；仍不是 P0（无环境/网络/数据删除通路）。

---

## 4. 写范围恒等复核（`/tmp/w3r13/probe8-scope.mjs` 在本轮 build 上复跑）

- **扩张方向：未发现缺陷。** 目标必须与**同子句**点名路径逐字相等（`pathsIn(core).includes(target)`，`requests.ts:259`），因此写范围 ⊆ 句中路径：
  - `修改 Y，X 保持不动` → `granted=["Y"]`；`参考 X 修改 Y`、`修改 Y 参考 X`、`基于 X 更新 Y`、`修改 Y 而不是 X`、`更新 Y instead of X`、`把 Y 参照 X 改掉`、`把 X 和 Y 都改掉` → 全部只读；
  - 别名铸造关闭：`修改 X...`、`修改 X.`、`fix X...` 只读；`修改 X-` 会把 `X-` 作为**用户逐字写出的路径词元**授权（非别名），未构成对 `X` 的越权。
- **两项部分授权（W3R14-04）**：`修改 X and Y`、`delete X and Y` → 仅 `["X"]`；`修改 X，删除 Y，更新 Z` → 仅 `["X"]`。授权范围是用户点名目标的**子集**（无害上界），但与「多目标列表一律只读」的声明不一致，且静默丢弃后续目标。
- 多子句真祈使（`修改 X 并删除 Y`、`把 X 删除并更新 Y`）授权各自目标，符合预期（非扩张）。

---

## 5. 文档化正例与 fail-closed 取舍复核

- **必须授权正例（登记 12 条）**：独立提取并复跑 **12/12 授权**，且 `writePaths` 只含命令自身目标：`修复 X`、`修改 X`、`更新 Y`、`处理 Y`、`删除 X`、`清理 Y`、`fix X`、`update X`、`把 X 改掉`、`将 Y 删除`、`对 Y 修改`、`不要修改 Y，但要修复 X`（`/tmp/w3r14/probe7-prior2.mjs` + `/tmp/w3r13/probe7-registered.mjs`）。
- **混合意图**：`解释 X 并修复 Y` → assist + delivery，写范围只含 Y；`explain X and fix Y`、`先解释 X，然后修改 Y` 同样成立（HTTP 建 2 Work）。**并列连词引入的命令**可用。
- **处置式**：`把 X 改掉`、`将 Y 删除`、`对 Y 修改` 可用；`把 X 里的错别字改掉`、`对 Y 进行修改`、`把 X 改成新版本` 落只读——前两条属 T21/T22 概括声明的「丰富措辞」代价，`对 Y 进行修改` 是第十三轮登记的 12 条正例之一、在本提交中被测试悄悄改写为 `对 Y 修改`（W3R14-06）。
- **否定后纠正**：`不要修改 Y，但要修复 X` 可用；`别改 Y，改 X`、`不要改 Y，改 X`、`不修改 Y，修改 X`、`先别改 Y，改 X`、`don't fix Y, fix X` **全部误拒（W3R14-03）**。
- **已声明 fail-closed 17/17 只读**（`/tmp/w3r14/probe1-corpus.mjs` F11）：`修改 X 中的错别字`、`fix the typo in X`、`X 的错别字麻烦处理下`、`X 里的接口说明更新一下`、`重写/润色/polish`、`修改 Y 而不是 X`、`修改 X 保留 Y`、`修改 X、Y`、`删除 X 的过时内容`、`清理 X 的过时段落`、`修改 docs/过时说明.md`、`修改 docs/会议.md`、`修改 docs/了解.md`、`update docs/a-or-b.md`、`fix docs/no-index.md`、`fix docs/yes-notes.md`。**方向为 fail-closed，不产生越权。**

---

## 6. 客户端注入面与前轮 P0/P1 无回归复核

### 6.1 注入面（`/tmp/w3r14/probe5-injection.mjs`，真实 HTTP）

| 注入 | HTTP | 库结果 |
|---|---|---|
| `workItems:[…×50]` / `works:[…×50]` | 202（静默忽略） | workDelta=1（仅路由产出）、authDelta=0、无 write |
| `authorization:{scope:{writePaths:['packages/core/src'],operations:['read','edit']}}` | 202（忽略） | authDelta=0、`authorizationId=null` |
| `authorization:{operations:['deploy']}` | 202（忽略） | 零授权行 |
| `grants:[{operation:'edit',targets:[…]}]` | 202（忽略） | 零授权行 |
| `scope:{writePaths:['packages/core']}` + `level:'L3'` + `intent:'operation'` | 202（忽略） | 零授权行、无 L3 Work |
| `targetWorkId`（不存在/跨会话） | **404 / 403** | 零副作用 |
| 未知字段 `foo`/`targetRole`/`ownerUserId` | 202（**静默忽略**） | 无副作用（承接 `protocol.md` §1/§3，W3R14-08） |
| 空 body / 缺 `conversationId` / 未知 `conversationId` | **400 / 400 / 404** | 零副作用 |

**结论：wire 层不存在 `authorization`/`workItems`/`works`/`grants`/`scope`/`level`/`intent` 通路，11 项注入零授权行、零越权 Work，无回归。** `apps/daemon/src/server.ts:171-180` 只读取 `conversationId/body/attachmentIds/targetWorkId`（本轮该文件哈希 `3a348304` 与第十三轮相同）。

### 6.2 前轮 P0/P1 复核（`/tmp/w3r14/probe6-prior.mjs`，16/17）

| 项目 | 本轮实测 | 状态 |
|---|---|---|
| W3-01 下载 token 可预测/先于认证（P0） | token 不内嵌 artifactId；首次 200、二次 403 | 无回归 |
| W3-02 产物读取无主体维度（P0） | 预览走 `assertReadable`；CSP 逐字、sandbox、`credentials: omit`、无 `set-cookie`、`nosniff` 全成立 | 无回归 |
| W3R3-01 授权 capability 缺口致死锁（P1） | 正例 `assess`/`dispatch` 全通（含 `readPaths`+`read`） | 无回归 |
| W3R3-06 CSP 单头/逐字相等（P2） | `preview.ts` 哈希 `803b502a` 与第十三轮相同；头逐字等于 `PREVIEW_CSP` | 无回归 |
| W3R4-03 `assertGrantWithinMessage` 约束 `readPaths` | 代码仍在（`messages.ts:360-384`）；HTTP `authorization` 注入被忽略 | 无回归 |
| W3R4 review `targetWorkId` 跨会话 | 跨 Conversation 目标 Work → **403 `NOT_AUTHORIZED`** | 无回归 |
| W3R4 review 追发不改写 Work | 追发后 `level`/`authorizationRef` 不变、`authorizationId=null` | 无回归 |
| W3R7-01 只读请求词授权（P1） | `帮我看一下/请评估/列出/总结/检查` 全只读 | 无回归 |
| W3R7-03 混合否定+指令（P1） | `不要修改 A，但要修复 B` 只授权 B；**`别改 A，改 B` 系列只读** | **回归（→ W3R14-03）** |
| A1 目标级排除（P1） | `修改 Y 而不是 X` 只读；`修改 Y，X 保持不动` 只授权 Y | 无回归 |
| A2 中文/英文混合意图（P1） | `解释 X 并修复 Y`、`explain X and fix Y` 只授权 Y | 无回归 |
| A3 纯建议（P1） | `请给出 X 的修改建议`、`请列出 X 里的错误` 只读 | 无回归 |
| W3R12-01/13-01 动词优先尾（P1） | 第十三轮 54 句 A 档 **归零** | 已闭合 |
| W3R12-02/13-03 选择/疑问尾（P1） | 登记与 hold-out 全只读 | 已闭合 |
| W3R12-03/13-02 条件前件（P1） | 登记形态全只读；**同族换前缀后重开** | **部分未闭合（→ W3R14-01）** |
| W3R13-04 `conditional` 复位（P1） | 4/4 只读 | 已闭合 |
| 登记语料 12 正 + 79 负 | `/tmp/w3r13/probe7-registered.mjs` **0 偏差** | 无回归 |
| `packages/core/**`、`apps/daemon/src/**`、`preview.ts` | 哈希与第十三轮逐字相同 | 零改动 |

**未闭合承接**（P3，不单独阻断）：W3R4-05/W3R13-08/W3R14-07（无 Orchestrator 授权回归用例）、W3R4-06/W3R13-09/W3R14-08（`protocol.md` §5 未对账）、W3R4-08（`StorageError` 映射粗）、W3R4-10（`targetWorkId` 归属只覆盖 message 来源）、W3R4-12（multipart 多文件 / `projectId`）、W3R4-13（错误响应非 §1 封装）。

---

## 7. 记录与实现一致性核对

| 记录项 | 实测 | 结论 |
|---|---|---|
| T22「结论：确定性基线的 fail-open 方向现已**按结构关闭**」 | 201 句 hold-out **41 句 A/B 档非命令授权**；HTTP 31/40、e2e 20/20 可写 | **证伪（W3R14-01/02）** |
| T22「其他任何前件（经批准、视具体情况、depending on the result）都使后续命令降级为假设」 | `视具体情况，就修改 X`、`经审批，再修改 X`、`depending on the result, then update X` 均授权 | **证伪（W3R14-01）** |
| T21「命令现在**只有**两种形状」/「目标之后只允许句末标点/空白」 | 模式层为真；但 `ADVERB_LEAD_PATTERN` 会把 `需要/要` 与副词一起剥掉，使 `但需要修改 X` 以裸命令形态匹配 | **不完整（W3R14-02）** |
| T21「评述子句抑制…任一分句是评价/意见 ⇒ 整条消息不授权」 | 只对**词表命中**者成立（`这很重要，也需要修改 Y` 只读；`这个文档有问题，也需要更新 Y` 授权） | **不准确（W3R14-02）** |
| T21/T22「必须授权 **11** 条 + 必须只读 **84** 条」 | 独立提取：**12 正 + 79 负**，0 偏差；"11/84" 不可复现 | **不准确（W3R14-05）** |
| T21/T22「记录与 plan 一致」「已写入 planVersion 2 的残余风险」 | `plan.md` 哈希 `8986875e` 与第十一～十三轮**逐字相同、未改动**；planVersion 2 未登记 T21/T22 的任何新代价 | **不准确（W3R14-05）** |
| `implementation.md:3` `planVersion: 1` | `plan.md:3` 为 `planVersion: 2` | **记录头未同步（第五轮延续，W3R14-05）** |
| T16「记录措辞订正：不再出现「一律/永不」的绝对表述」 | `:113`「永不下发写授权」、`:140`/`:177`/`:186`「一律只读」原文仍在 | **名实不符（W3R14-05）** |
| T21/T22「unit 289 / integration 124 / build 8 / docs:check ok」 | 与实测**一致** | **准确** |
| T21「目标必须与消息点名的路径逐字相同」 | `pathsIn(core).includes(target)` 在（`:259`）；`修改 X...` 只读 | **准确** |
| T21/T22 回归网措辞「含名词短语的祈使…一律请求澄清」 | `修改 X 中的错别字`、`更新 X 的说明`、`处理一下 Y 的错别字`、`删除 X 的旧内容`、`清理 Y 的重复段落`、`fix the typo in X`、`把 X 里的错别字改掉` 只读 | **方向一致（概括声明，未逐项列出）** |
| 处置式正例 `对 Y 进行修改` | 本提交把 `domain.test.ts` 正例从 `对 docs/PLAN.md 进行修改` 改为 `对 docs/PLAN.md 修改`；前者实测只读，未在 T21/T22 逐项登记 | **未登记收窄（W3R14-06）** |
| HTTP/Core 测试正例措辞 | `apps/daemon/test/server.test.ts:467`、`packages/core/test/artifacts.test.ts:415/:480` 由 `explain … and fix the typo in docs/INDEX.md` 改为 `explain … and 修复 docs/INDEX.md` | **测试覆盖收缩（W3R14-07）** |

**记录侧硬约束（对 Test 有直接影响）**：T22「fail-open 方向现已按结构关闭」为假；若 Test 以 T22 为准设计负例，会把 §3.3 的 38 句 A 档越权判为「预期只读」而漏报，并在「前件规则已结构性关闭」的错误前提下放行。

---

## 8. 新 Findings（W3R14-xx）

### W3R14-01 [P1] 「前件规则」可被承接副词/连词重新打开：未登记前件 + `就/再/也/但/然后/and then` 继续产生写授权（W3R13-02 的同族重开）

- **位置**：`packages/domain/src/requests.ts:371-389`，尤其 `:377` `const continues = /^(?:但|但是|而是|不过|也|再|就|则)/u.test(clause.text);` 与 `:378` `const allowed = index === 0 || clause.conjunction || continues;`。
- **实测（我自建，未登记）**：`/tmp/w3r14/probe1-corpus.mjs` F1 **20/22**、F1b **8/8**；`/tmp/w3r14/probe3-http.mjs` 全部落库授权（L2 + 1 授权行 + 1 assessment）；`/tmp/w3r14/probe4-e2e.mjs` 建立真实 `backend/implementation` 写 Run。
- **证据句**：`视具体情况，就修改 X`、`视具体情况，再修改 X`、`视具体情况，也修改 X`、`视具体情况，但修改 X`、`经审批，再修改 X`、`看结果，就修复 X`、`先跟你确认，再修改 X`、`收到消息后，就修改 X`、`走完流程，就修改 X`、`视具体情况，然后修改 X`、`视具体情况，修改 X，但删除 Y`、`depending on the result, then update X`、`after review, then update X`、`after approval, then update X`、`approval pending, then update X`；纯陈述 `需要修改 X，也需要修改 Y`、`这个文档有问题，也需要更新 Y`、`还没决定，也需要修改 Y`、`目前不用改 X，也需要更新 Y`。
- **判别依据**：这些整条消息要么是条件前件 + 命令，要么完全没有祈使（后半句是「也/但需要…」陈述）。同形反向对照：`视具体情况，修改 X` 只读 vs `视具体情况，就修改 X` 授权；`after review, update X` 只读 vs `after review, then update X` 授权；`pending review, then update X` 只读（词表） vs `after review, then update X` 授权。
- **根因**：T22 把「允许的命令位置」判定为 `index===0 || clause.conjunction || continues`，其中 `continues` 覆盖任意前件之后以承接副词开头的子句。因此**任何未登记前件都不是门**——它只要求后一命令子句恰好以 `但/也/再/就/则` 开头。
- **修复方向（结构性）**：让「允许位置」不再取决于命令子句自身的前缀，而取决于**前一个子句的类别**：
  1. 命令只在首子句，或前一个子句是**真并列连词**（`并且/然后/同时/而且/并/and/then`）引入；
  2. 唯一保留的例外是 W3R7-03 的「否定 + 纠正」：允许后一命令子句，当且仅当**紧邻前一子句是拒绝/否定子句**（而不是任意前件）；
  3. 建议直接删除 `continues`，用「前一子句已被 `readClause` 判为拒绝」作为唯一的跨子句授权条件。
- **验收面**：AC-004 负例失败；`workflow.md` §1「执行消息可直接授权明确目标」被扩大到「条件句 + 承接副词」与「纯陈述」。

### W3R14-02 [P1] `ADVERB_LEAD_PATTERN` 的可选情态词把陈述句洗成命令（`但需要修改 X` 类）

- **位置**：`requests.ts:226-228`（`ADVERB_LEAD_PATTERN` 末尾 `(?:要|需要|请|麻烦|帮我|帮忙)?`）、`:244-247`（`commandTarget` 先剥再判 `NON_COMMAND_MARKERS`）、`:331`（`readClause` 的 `core` 同样已剥，`STATEMENT_PATTERNS` 看不到 `需要`）。
- **实测**：`/tmp/w3r14/probe1-corpus.mjs` F2 **13/20**（10 句 `需要` + 3 句 `要`）；HTTP/e2e 落库并建立真实写 Run；`/tmp/w3r14/probe2-extent.mjs` 显示可指向源码并可**一次授权两个目标**（`但需要修改 packages/core/src/orchestrator.ts，但需要删除 packages/core/src/messages.ts`）。
- **证据句**：`但需要修改 X`、`就需要修改 X`、`也需要修改 X`、`另外需要修改 X`、`也需要更新 Y`、`就需要修复 X`、`但需要删除 X`、`但需要整理 X`、`但需要把 X 改掉`、`另外要更新 X`、`但要修改 X`、`也要修改 X`。
- **对照**：`需要修改 X` 只读（`NON_COMMAND_MARKERS` 命中 `需要`）；`但需要修改 X` 授权。`同时需要修改 X` / `并且需要修改 X` 只读（`同时/并且` 是分隔符）；`另外需要修改 X` 授权。
- **根因**：判定前先做前缀归一（第 245、331 行）时，把**情态词**（`要/需要`）与副词一并剥除；`NON_COMMAND_MARKERS`/`STATEMENT_PATTERNS` 随后再也看不到它。前缀归一本意是让 `但要修复 X`（W3R7-03 纠正句）可用，但顺带洗掉了陈述标记。
- **修复方向（结构性）**：副词归一**只剥副词**，不剥情态动词；或在归一前的原子句上运行 `NON_COMMAND_MARKERS`/`STATEMENT_PATTERNS`（`需要/要` 命中即非命令，除非前一是拒绝子句并按 W3R14-01 的纠正规则处理）。若必须保留 `但要修复 X`，则应把它并入「前一子句是拒绝」这一条结构规则，而不是靠剥前缀。
- **验收面**：同 W3R14-01。

### W3R14-03 [P1] 否定后纠正（W3R7-03 已修 P1）回归为只读

- **位置**：`requests.ts:377-383`（`continues` 未覆盖裸纠正子句；只有带 `但` 的纠正句才被放行）。
- **实测**：`/tmp/w3r14/probe7-prior2.mjs` 5 条变体全部 `writes=[]`：`别改 Y，改 X`、`不要改 Y，改 X`、`不修改 Y，修改 X`、`先别改 Y，改 X`、`don't fix Y, fix X`；HTTP 与 e2e 同样只读（`/tmp/w3r14/probe3-http.mjs` POS-regression、`probe4-e2e.mjs`）。
- **判别依据**：`别改 A，改 B` 是第七轮 P1（W3R7-03）点名的 AC-005/AC-006 正例，T22 的「命令只能出现在首子句或由并列连词/承接副词引入」把逗号后的裸纠正子句降级为只读。第十三轮报告 §6.2 曾判定该项「无回归」。
- **修复方向**：与 W3R14-01 同一条结构规则——前一子句是拒绝子句时，后一命令子句允许授权（见 W3R14-01 修复方向 2）。
- **验收面**：AC-005「用户明确修复具体目标 → 原消息作为范围授权」；本项为 fail-closed（无越权），但属**已修 P1 的回归**，且是任务明确要求「否定后纠正仍可用」的复核项。

### W3R14-04 [P2] 多目标/多子句命令出现「静默部分授权」，与声明的多目标 fail-closed 不一致（W3R13-06 未修）

- **位置**：`requests.ts:285-286`（子句切分只把 `，；。!！`、` and / then `、`并且/然后/同时/而且`、`并+动词` 当边界）+ `:377-378`（逗号后无连词的命令子句被抑制）。
- **实测**：`修改 X and Y` → `["X"]`；`delete X and Y` → `["X"]`；`修改 X，删除 Y，更新 Z` → `["X"]`。而 `修改 X 和 Y`、`修改 X、Y`、`修改 X 以及 Y`、`把 X 和 Y 都改掉` 按声明整体只读。
- **性质**：授权范围是用户点名目标的**子集**（无害上界），但会静默丢弃后续目标，且与 T21/T22/planVersion 2 的「多目标列表一律只读并澄清」声明冲突；Test 无法从记录判断应采用哪种口径。
- **修复方向**：统一口径——或「多目标一律只读 + 澄清」，或「各子句各自目标」，并在回归网与记录中固定。

### W3R14-05 [P2] 记录名实不符：T22 的核心安全主张被证伪，计数与 plan 未同步（W3R13-07 未修且加重）

- **实测**：见 §7 表。要点：①T22「fail-open 方向现已按结构关闭」被 38 句 A 档 + HTTP/e2e 证伪；②「其他任何前件…都使后续命令降级为假设」被 20 句证伪；③「11 正 + 84 负」实际 **12 正 + 79 负**；④`implementation.md:3` 仍 `planVersion: 1`；⑤`plan.md` 哈希 `8986875e` **未改动**，T21/T22 的新代价与新风险均未登记；⑥`:113/:140/:177/:186` 的「永不/一律」绝对表述仍在（T16 曾声称已删）。
- **性质**：不单独阻断，但**直接影响 Test 基线**——若 Test 以 T22 的「已按结构关闭」为前提设计负例，本轮 P1 会被判为「预期只读」而漏报。
- **建议**：把绝对表述限定为「已登记语料范围内」；把 W3R14-01/02/03/04/06 的实际后果写入 `plan.md`（planVersion 3）并同步 `implementation.md:3` 头；订正 11/84 → 12/79；说明 T21/T22 的「结构性」仅指**目标之后无尾巴**，不含前件与前缀。

### W3R14-06 [P3] 处置式/名词短语正例的 fail-closed 收窄未逐项登记，且测试被悄悄改写

- **位置**：`requests.ts:209-222`（无尾文法）、`packages/domain/test/domain.test.ts:266-299`。
- **实测**：第十三轮登记的 12 条正例中 `对 docs/PLAN.md 进行修改` 现在只读；本提交把测试正例改写为 `对 docs/PLAN.md 修改`，并把 `修改 docs/INDEX.md 中的错别字`、`更新 docs/INDEX.md 的说明`、`处理一下 docs/PLAN.md 的错别字`、`删除 docs/INDEX.md 的旧内容`、`清理 docs/PLAN.md 的重复段落`、`fix the typo in docs/INDEX.md`、`把 docs/INDEX.md 里的错别字改掉` 一并移入负例。T21/T22 只在「含名词短语的祈使」概括声明，未逐项列出；`对 X 进行修改`（处置式 + 轻动词）未被 `plan.md` 登记。
- **性质**：全部 fail-closed（无越权），但属**能力收窄**且未逐项登记，Test 无法据此判断哪些是「预期只读」。

### W3R14-07 [P3] 回归网缺口：本轮 P1 证据句零断言，授权→`assess`/`dispatch` 仍无产品用例；且本提交收缩了两处英文/处置式正例覆盖

- **实测**：`grep -rn "就修改\|再修改\|也需要\|但需要\|另外需要\|then update\|then delete" packages/*/test apps/*/test` = **0 命中**；`Orchestrator` 仍不出现在 `apps/daemon/test/server.test.ts`、`packages/core/test/artifacts.test.ts`（W3R4-05/W3R13-08 延续）；`apps/daemon/test/server.test.ts:467`、`packages/core/test/artifacts.test.ts:415/:480` 的英文混合意图正例被改为中文，`domain.test.ts` 的 `对 X 进行修改` 被改为 `对 X 修改`。
- **性质**：不阻断（P1 已由自建脚本证明），但修复后必须以回归断言固化，并恢复被收缩的正例覆盖。
- **承接**：与 W3R13-08、W3R12-06、W3R11-07、W3R10-05、W3R4-05 同项。

### W3R14-08 [P3] 协议对账与 wire 语义承接（W3R13-09 / W3R12-07 / W3R4-06/08/10/12/13 延续）

- **未知字段**：`foo`/`targetRole`/`ownerUserId` 仍 **202 静默忽略**，而 `protocol.md` §1 要求未知字段返回 `VALIDATION_ERROR`；`protocol.md:46` 把 `targetRole?:Role` 列为 `conversation.message.send` 合法参数，daemon 不读取。
- **响应形状**：响应含 `workIds`/`authorizationId`，`protocol.md:46` 只列 `{messageId,workId,state,version}`（加法扩展未对账）。
- **同批承接**：`POST /artifacts/upload` 的 multipart `projectId` 被忽略、多文件只保留最后一个；`StorageError` 映射、`targetWorkId` 归属、错误响应非 §1 封装。

---

## 9. 计数与阻断判定

| 严重度 | 数量 | 编号 | 是否阻断 |
|---|---|---|---|
| P0 | 0 | — | — |
| **P1** | **3** | W3R14-01（前件规则被承接副词绕过）、W3R14-02（情态词洗白）、W3R14-03（否定后纠正回归） | **阻断** |
| P2 | 2 | W3R14-04（多目标静默部分授权）、W3R14-05（记录/plan 名实不符，影响 Test 基线） | 不单独阻断，须随修复轮订正 |
| P3 | 3 | W3R14-06（处置式/名词短语收窄未登记 + 测试改写）、W3R14-07（回归网缺口/覆盖收缩）、W3R14-08（协议对账） | 不阻断，承接 Test |

- 三条 P1 **均落在本包验收面**：AC-004 负例被证伪、AC-005 授权边界被证伪；均以真实 HTTP + 真实 `Orchestrator` 证明可派发真实 Backend 写 Run（含源码路径）。
- 失败路由：`Blocking Review Finding → Develop → Independent Review`（`docs/rules/workflow.md` §6）。
- 前轮 P1 的本轮裁定：**W3R13-01/03（尾巴、选择尾）已闭合**；**W3R13-02（条件前件）登记形态已闭合、同族换前缀后重开（→ W3R14-01）**；**W3R13-04（`conditional` 复位）已闭合**；W3R13-05（误拒）未修并扩大（→ W3R14-03/06）；W3R13-06（多目标）未修（→ W3R14-04）。

---

## 10. 能否进入独立 Test —— **不能**

**判据**：`docs/rules/workflow.md` §6「P0/P1 阻断」。三条 P1 中任意一条即足以阻断，且均可端到端复现。**必须先走 `Develop → Independent Review`。**

### 10.1 修复后重评的最低要求

修复轮必须做以下**结构性**改造（不是继续加词），并保留全部登记正例：

1. **位置规则的判据改为「前一子句的类别」**（修 W3R14-01/03）：命令只在首子句，或前一是真并列连词（`并且/然后/同时/而且/并/and/then`）；唯一例外是「前一子句为拒绝/否定」时允许纠正面命令。删除 `continues` 对 `但/也/再/就/则` 的依赖——该依赖正是任意前件的绕行通道。
2. **前缀归一不得剥情态词**（修 W3R14-02）：`ADVERB_LEAD_PATTERN` 只剥副词；`NON_COMMAND_MARKERS`/`STATEMENT_PATTERNS` 应在**归一前的原（子）句**上判定，或至少对 `要/需要` 保留命中。
3. **多目标口径统一**（修 W3R14-04）：`修改 X and Y`、`delete X and Y`、`修改 X，删除 Y，更新 Z` 与中文列表采用同一口径（全只读 + 澄清，或各子句各自目标）。
4. **记录同步**（修 W3R14-05/06）：`plan.md` 升版登记本次全部新代价（处置式轻动词、名词短语祈使逐项）；订正 `implementation.md:3` 头与 11/84 计数；删除/限定绝对表述；明确「结构性」仅指**命令尾部**，不覆盖前件与前缀。
5. **回归网补全**（修 W3R14-07）：把 §3.3 的 38 句 A 档与 §5 的正例、以及「授权正例 → `assess(L2)` → `dispatch(backend/implementation)` 成功 / grant 外路径与 `deploy`/`network` 拒绝」落成长期断言；恢复被收缩的英文与处置式正例覆盖。

以下新增句必须只读并落成长期断言（与已声明 fail-closed 区分）：

- **前件绕过族**：`视具体情况，就修改 X`、`视具体情况，再修改 X`、`视具体情况，也修改 X`、`视具体情况，但修改 X`、`经审批，再修改 X`、`看结果，就修复 X`、`先跟你确认，再修改 X`、`收到消息后，就修改 X`、`走完流程，就修改 X`、`视具体情况，然后修改 X`、`视具体情况，修改 X，但删除 Y`、`depending on the result, then update X`、`after review, then update X`、`after approval, then update X`、`approval pending, then update X`。
- **纯陈述族**：`需要修改 X，也需要修改 Y`、`这个文档有问题，也需要更新 Y`、`还没决定，也需要修改 Y`、`目前不用改 X，也需要更新 Y`。
- **情态洗白族**：`但需要修改 X`、`就需要修改 X`、`也需要修改 X`、`另外需要修改 X`、`但需要整理 X`、`但需要把 X 改掉`、`但要修改 X`、`也要修改 X`、`另外要更新 X`、`但需要修改 packages/core/src/orchestrator.ts`。
- **不得回归（正例）**：登记 12 条逐句授权且 `writePaths` 只含命令自身目标；`别改 Y，改 X`、`不要改 Y，改 X`、`不修改 Y，修改 X`、`先别改 Y，改 X`、`don't fix Y, fix X` 应授权 X；`解释 X 并修复 Y`、`explain X and fix Y`、`不要修改 Y，但要修复 X`、`把 X 改掉`、`将 Y 删除`、`对 Y 修改`。
- **已声明 fail-closed（断言只读，不算缺陷）**：`修改 X 中的错别字`、`fix the typo in X`、`把 X 里的错别字改掉`、`对 X 进行修改`（若决定保持只读则必须登记）、`X 的错别字麻烦处理下`、`重写/润色/polish`、`修改 X、Y`、`修改 X 而不是 Y`。

### 10.2 Test 最小覆盖矩阵（修复轮后必须覆盖）

| # | 维度 | 最小用例（≥） | 期望 |
|---|---|---|---|
| 1 | 前件结构规则（W3R14-01） | `视具体情况，就/再/也/但修改 X`、`经审批，再修改 X`、`看结果，就修复 X`、`after review, then update X`、`depending on the result, then update X` 各 1 | 全部只读，零授权行 |
| 2 | 纯陈述 + 承接（W3R14-01） | `需要修改 X，也需要修改 Y`、`这个文档有问题，也需要更新 Y`、`还没决定，也需要修改 Y` 各 1 | 只读 |
| 3 | 情态词洗白（W3R14-02） | `但需要修改 X`、`另外需要修改 X`、`但需要整理 X`、`但需要把 X 改掉`、`另外要更新 X` 各 1；对照 `需要修改 X` 只读 | 全部只读 |
| 4 | 否定后纠正（W3R14-03） | `别改 Y，改 X`、`不要改 Y，改 X`、`不修改 Y，修改 X`、`don't fix Y, fix X`、`不要修改 Y，但要修复 X` 各 1 | 授权且写范围仅 X |
| 5 | 多目标口径（W3R14-04） | 中文列表 / `and` / 处置式三种多目标表达 | 与记录声明一致的单一口径 |
| 6 | 目标优先关闭（回归） | 16 谓词 × ≥2 动词 | 只读 |
| 7 | 尾巴关闭（回归） | `修改 X 是不明智的/的必要性/算不算必要/update X seems right` 各 1 | 只读 |
| 8 | 条件复位（回归） | `经批准，修改 X，删除 Y` 等 4 句 | 只读，零授权行 |
| 9 | 处置式/混合/排除 | `把 X 改掉`、`解释 X 并修复 Y`、`explain X and fix Y`、`修改 Y 而不是 X` | 授权且写范围仅目标；排除式只读 |
| 10 | 登记语料 | 12 正 + 79 负 | 逐句成立 |
| 11 | HTTP 端到端（≥3 句/族） | 上述 1/2/3/4 组经 `POST conversation.message.send` | `authorizationId=null`、`level=none`、零授权行、无 `delivery` Work |
| 12 | **Orchestrator 回归（仍未闭合）** | 授权正例 `assess(L2)` → `dispatch backend/implementation` 成功；grant 外路径 + `deploy`/`network` → `NOT_AUTHORIZED` | 建 Run / 拒绝 |
| 13 | 注入面不回归 | `workItems/works/authorization/grants/scope/level/intent/targetRole/ownerUserId` 注入 | 全部忽略且零授权（未知字段按 W3R14-08 决定后断言） |
| 14 | 前轮 P0/P1 | 下载 token 一次性、预览 ACL/CSP 逐字、`assertGrantWithinMessage`、跨会话 `targetWorkId`、追发不改写 Work | 无回归（`probe6` 16/17 已通过，余 1 项即 W3R14-03） |
| 15 | 附件/产物面 | 上传限制/TTL/重复绑定、版本链/失效、预览截断、单次下载 | 无回归（本轮未动，抽验即可） |

### 10.3 残余风险清单（区分已登记与未登记）

**A. 未登记缺陷 —— 必须修（P1 阻断；P2/P3 随修复轮订正）**
1. W3R14-01 前件规则被承接副词/连词绕过（20 + 8 句 A 档；HTTP/e2e 可写，含源码路径）。
2. W3R14-02 副词 + 情态词洗白（13 句；HTTP/e2e 可写，可一次授权两个源码文件）。
3. W3R14-03 否定后纠正回归只读（5 变体；W3R7-03 已修 P1 的回归）。
4. W3R14-04 多目标/多子句静默部分授权。
5. W3R14-05 记录/plan 名实不符（含「按结构关闭」的假安全主张）。
6. W3R14-06 处置式轻动词与名词短语祈使的收窄未逐项登记 + 测试改写。
7. W3R14-07 回归网缺口与正例覆盖收缩。
8. W3R14-08 协议对账与 wire 语义。

**B. 已登记 fail-closed 代价 —— 已登记，接受并需 Test 承认**
9. 未登记同义祈使（`重写/润色/rewrite/polish/tweak`）→ 只读 + 澄清（`plan.md:17-18`）。
10. 名词短语祈使（`修改 X 中的错别字`、`fix the typo in X`、`把 X 里的错别字改掉`、`更新 X 的说明`、`删除 X 的旧内容`、`清理 X 的重复段落`）→ 只读 + 澄清（T21/T22 概括声明）。
11. 目标优先日常祈使（`X 的错别字麻烦处理下`、`X 里的接口说明更新一下`）→ 只读 + 澄清（T19/T20/T21）。
12. 多目标中文列表与排除式（`修改 X、Y`、`修改 X 而不是 Y`、`update X instead of Y`）→ 只读 + 澄清（但英文 `and` 与处置式口径不一致，见 W3R14-04）。
13. 标记子串导致路径名/复合词误拒（`过时/会议/了解/a-or-b/no-index/yes-notes`）→ 只读（W3R13-05，方向安全）。
14. 语义分类的最终责任在 WP-04/06 模型 Assessment；本包只承诺已登记语料与形态规则。

**C. 与本包无关或已承接**
15. W3R14-07/08 与 W3R4-05/06/08/10/12/13、W3R13-08/09 同项（P3，结算前登记或修复）。
16. 真实无头浏览器攻防（WP-10）；真实 Provider 纵向与 `artifact_write` 工具接线（WP-10/WP-07）。

---

## 11. 方法与边界声明

- **独立上下文**：未读取任何开发/Test 会话；结论只来自仓库文件、`docs/**` 契约与我自建的 7 个脚本（`/tmp/w3r14/probe1-corpus`、`probe2-extent`、`probe3-http`、`probe3b-http-src`、`probe4-e2e`、`probe5-injection`、`probe6-prior`、`probe7-prior2`）+ 复用 `/tmp/w3r13/probe1-corpus.mjs`、`probe7-registered.mjs`、`probe8-scope.mjs`，全部消费 `pnpm build` 产物；**未 import 任何产品测试文件**（`domain.test.ts` 仅以文本方式用引号感知的 tokenizer 提取语料，提取后逐句用**构建产物**复跑）。
- **实验统计（观测 / 缺陷证据）**：

| 脚本 | 观测 | 缺陷证据 | 对应 |
|---|---|---|---|
| `probe1-corpus.mjs` | 201 句（16 族） | **41 FAIL-OPEN + 2 PARTIAL + 1 FALSE-REJECT**（A 档 38 + B 档 3） | W3R14-01/02/03/04 |
| `probe2-extent.mjs` | 21 句（含源码目标与复合洗白） | 12 授权，含 `packages/core/src/*.ts` 与一次两目标 | W3R14-01/02 |
| `probe3-http.mjs` | 40 句真实 HTTP | **31/31 A 档非命令落库授权**（L2 + 1 授权行 + 1 assessment）；登记负例 6/6 只读、正例 5/6 授权 | W3R14-01/02/03 |
| `probe3b-http-src.mjs` | 5 句源码目标 | **3 条非命令授权源码路径并建立 `backend:queued` 写 Run**；2 对照组只读 | §3.6 |
| `probe4-e2e.mjs` | 30 句真实 Orchestrator | **20/20 A 档非命令各建立真实写 Run**；1 正例误拒 | W3R14-01/02/03 |
| `probe5-injection.mjs` | 11 注入项 | 0 授权行、0 越权 Work；未知字段静默忽略 | §6.1, W3R14-08 |
| `probe6-prior.mjs` | 17 项前轮 P0/P1 | **16/17 通过**；否定后纠正 1 项回归 | §6.2, W3R14-03 |
| `probe7-prior2.mjs` | 23 项定向复核 | 5 误拒（W3R7-03 族）、1 非缺陷（尾 `-`）、其余通过 | W3R14-03/06 |
| `/tmp/w3r13/probe1-corpus.mjs`（复用） | 197 句第十三轮语料 | 第十三轮 54 句 A 档 **归零**；8 条 C 档正例转只读 | §3.2, W3R14-06 |
| `/tmp/w3r13/probe7-registered.mjs`（复用） | 登记 12 正 + 79 负 | **0 偏差**（记录称 11 + 84 → W3R14-05） | 回归网 |
| `/tmp/w3r13/probe8-scope.mjs`（复用） | 29 项作用域/边界 | **0 扩张**；2 项部分授权 | §4, W3R14-04 |

- **对开发方「前件规则按结构关闭 fail-open」主张的裁决**：**不成立（部分成立）**。T21 的**无尾命令文法**是真实的结构性进步：第十三轮全部 54 句 A 档归零、目标逐字校验关闭别名铸造、`conditional` 复位缺陷关闭，均为可复核的改善。但 T22 的「前件规则」不是句法门而是**位置 + 前缀**门：`continues` 让任意前件之后的 `就/再/也/但` 子句通过，`ADVERB_LEAD` 让 `需要/要` 被剥除。两条都能让**纯陈述句**产生可派发的源码写授权。同形反向对照（`视具体情况，修改 X` 只读 vs `视具体情况，就修改 X` 授权；`需要修改 X` 只读 vs `但需要修改 X` 授权；`after review, update X` 只读 vs `after review, then update X` 授权）证明这仍是第八～十三轮同一根因（**形态判定退化为词表/前缀枚举**），因此本轮仍判 **FAIL**。
- **未做**：真实无头浏览器执行、真实 Provider 纵向、Docker 容器内复验、故障注入下的孤儿 blob 复验、`pnpm test:e2e`/`test:acceptance`（脚本按设计指向 WP-09/WP-10，未实现）。
- **未改仓库**：本轮只覆盖写入 `.agentdev/work/WP-03/review.md`（本报告）；除该文件外 `git status --porcelain` 为空，`HEAD` 仍为 `f40d6343a132ce59dcc5b08e267b7df891e8ca31`，全部 6 条契约命令在上述工作树上执行。

---

## 附一：第一轮摘要（保留）

第一轮（报告冻结于 `a946ed6`，被审代码树 `fd90fef`）结论 **FAIL**：必验范围「实现完整直接协作与产物路线，附件暂存/绑定、隔离预览可实际运行」不成立，新增 14 条 Finding —— **2×P0、5×P1、5×P2、2×P3**；P0/P1 全部阻断，P2 的 W3-06 因影响 AC-002 阻断。要点：下载 token 可预测且下载路由先于认证（W3-01 P0）；产物读取无主体维度（W3-02 P0）；owner 由 sessionId 派生（W3-03 P1）；消息正文未写 blob（W3-04 P1）；未知会话上传 500（W3-05 P1）；失效产物仍可预览（W3-06）；AC-006 未实现（W3-07 P1）；用户消息不建 Authorization（W3-08 P1）；token 只增不减/`prune` 无调用方（W3-09）；归档会话仍接受上传（W3-10）；`expireStale` 无调用方（W3-11）；错误响应无 §1 封装（W3-12）；记录不一致（W3-13）；浏览器级攻防未验（W3-14，承接 WP-10）。另 5 项对抗性（内联预览字节上限、文件签名、`targetWorkId` 归属、隔离只靠客户端头、失败上传孤儿 blob 与 staged 无上限）。

## 附二：第二轮摘要（保留）

第二轮（报告冻结于 `8e4efc1`，被审代码树与 HEAD 同为 `a946ed6`）结论 **FAIL**：主要判据 W3R2-01（AC-006 未实现）与 W3R2-02（AC-005 未实现），另 2×P2（W3R2-03 CSP 漂移、W3R2-04 StorageError 映射/回显）、9×P3（W3R2-05..13）。第二轮对抗性 7 项：1/3/4/5/7 已修，2 部分（语义可辩护），6 已修但无测试守护。六条契约命令全绿但不足以支撑必验范围。

## 附三：第三轮摘要（保留）

第三轮（报告冻结于 `35e8674`，被审代码树 `d71dc07`）结论 **FAIL**：AC-005 的授权机制（`routeMessage`、消息级 Authorization 行、`work.authorizationRef`、Assessment、混合意图多 Work 与独立 scope）全部**落库**且成立，但 `grantedByMessage` 生成 `readPaths:['docs']` + `operations:['edit']` 的自相矛盾授权，使绑定它的 Work 的任何 Run/Assessment 都被 `capabilityGaps:['readPaths without a read operation']` 拒绝——交付路线在准入即死锁（W3R3-01 P1）。新增 **1×P1、5×P2、8×P3**；对抗性另指出疑问句被当作执行消息、HTTP 客户端可自报 `authorization`（甚至 `deploy`）。失败路由 `Blocking Review Finding → Develop → Independent Review`。

| 三轮编号 | 严重度 | 摘要 | 第十三轮状态 |
|---|---|---|---|
| W3R3-01 | P1 | 授权 capability 缺口 → 交付死锁 | 已修（probe4 正例评估/派发走通） |
| W3R3-02 | P2 | 授权绑定 `works[0]` | 已修 |
| W3R3-03 | P2 | 授权自相矛盾 | 已修 |
| W3R3-04 | P2 | HTTP 响应不含 `workIds`/`authorizationId` | 响应已含；`protocol.md` 仍未对账（W3R13-09） |
| W3R3-05 | P2 | 同 intent 重复共享 scope | 已修（`workItems` 取消后不再适用） |
| W3R3-06 | P2 | CSP 与 `execution.md` §6 漂移 | 已修且逐字相等 |
| W3R3-07 | P2 | StorageError 映射过宽 + 回显 | 回显已修；映射细分仍缺（W3R13-09） |
| W3R3-08/09/10/11/12/13/14 | P3 | validity/归属/owner 派生/prune/证据/数字/协议项 | 部分未闭合（W3R13-09） |

## 附四：第四轮摘要（保留）

第四轮（报告冻结于 `fd0a893`，被审代码树 `3f52fbf`）结论 **PASS（0×P1、3×P2、11×P3）**，但同轮对抗性核验以 HTTP 端到端证伪「越权已闭合」：`explain why … needs a fix`、`don't fix …`、`不要修改 …`、`I am not asking you to fix …` 等仍生成写授权并可派发写 Run；另指出 `targetWorkId` 可改写已有 Work 的 level/authorizationRef、`Content-Security-Policy-Sandbox` 不是标准头、消息授权 L1 与 `routingFloor` 的 L2 不一致、`workItems:[null]`/`intent:'operation'` 造成 500 或非法 Work。

| 四轮编号 | 严重度 | 摘要 | 第十三轮状态 |
|---|---|---|---|
| W3R4-01 | P2 | 同 intent 多 Work 共用 scope | 已修（`workItems` 取消后不再适用） |
| W3R4-02 | P2 | `workItems` 把授权挂到只读 Work | 已修（字段取消） |
| W3R4-03 | P2 | `assertGrantWithinMessage` 不约束 `readPaths` | 已修（probe6 复核） |
| W3R4-04 | P3 | `workItems` 未校验 → 500 | 已修（字段取消） |
| W3R4-05 | P3 | 无 Orchestrator 授权回归用例 | 未修（W3R13-08；grep 仍 0 命中） |
| W3R4-06 | P3 | `protocol.md` 未对账 | 未修（W3R13-09） |
| W3R4-07 | P3 | `message.received` 缺 `workIds`/`authorizationId` | 已修 |
| W3R4-08 | P3 | `StorageError` 映射粗 | 未修（W3R13-09） |
| W3R4-09 | P3 | 记录数字不符 | 本轮数字一致；`planVersion` 头未同步见 W3R13-07 |
| W3R4-10 | P3 | `targetWorkId` 归属只覆盖 message 来源 | 未修（W3R13-09） |
| W3R4-11 | P3 | 失败发送孤儿 blob | 第十三轮不可复现（记录承接） |
| W3R4-12 | P3 | multipart 多文件 / `projectId` | 未修（W3R13-09） |
| W3R4-13 | P3 | 错误响应非 §1 封装 | 未修（W3R13-09） |
| W3R4-14 | P3 | 冻结点与任务不一致 | 第十三轮一致（`HEAD=9ebb5a6`） |

## 附五：第五轮摘要（保留）

第五轮（报告冻结于 `fd0a893`，被审代码树 `3f52fbf`）结论 **FAIL（0×P0、2×P1、2×P2、5×P3）**：

- **W3R5-01 [P1]** 非执行消息（中英文疑问、否定、陈述、名词化解释）仍产生可用写授权并可派发写 Run（17 个新句式，HTTP 端到端验证）。
- **W3R5-02 [P1]** 明确指令被判为拒绝/解释：裸单字 `别` 命中「错别字/识别/特别/分别」、`说明/介绍` 名词化被当解释、`、` 不参与分词、逗号列表只授权首项（7 例误拒）。
- **W3R5-03 [P2]** 无效 `Content-Security-Policy-Sandbox` 头仍在 wire 上，修复记录与提交信息不实（第七轮已订正并实测单头）。
- **W3R5-04 [P2]** 调用方 `authorization.readPaths` 不受消息范围约束（latent；第七轮已修）。
- **W3R5-05..09 [P3]** `targetWorkId` 归属、孤儿正文 blob、记录数字、前轮剩余项、冻结点漂移。
- 同轮确认已修：`pathsIn` 线性化、`targetWorkId` 不改写目标 Work、消息授权 L2 与 `routingFloor` 一致、`workItems` 逐项校验。

第五轮 §6.1 的 17 句越权语料，第十二轮以 `d98ac43` 复跑全部只读；§6.2 的 11 句误拒语料剩 1 句（`docs/INDEX.md 的说明需要修改一下`）为 fail-closed。

## 附六：第六轮摘要（报告缺档）

第六轮 Reviewer **未产出报告**（报告文件为空，`HEAD=7c01c9d` 时无 Review 结果入库）。同轮对抗性核验以 `7c01c9d` 为冻结点独立复现，确认第五轮点名的误拒/CSP/`readPaths` 三组已闭合，但补出：陈述/完成体与认识情态（`我已经修改了 X`、`刚修复了 X`、`I already fixed X`、`X 需要修改`、`是否应该修改 X`、`是否需要更新 X`、`麻烦评估一下 X 是否需要修改`）仍产生可派发写授权；`docs/INDEX.md 的错别字麻烦处理下` 等日常祈使句不授权；`workItems` 第二个同 intent 项 scope 为空；记录中「永不下发写授权」措辞不实；另补 `workItems` 无数量上限、`别改 A，改 docs/plan.md` 误拒、CSP 第二头名残留、`assertGrantWithinMessage` 未约束 `readPaths`。

## 附七：第七轮摘要（保留）

第七轮（报告冻结于 `8f8b2df`，被审代码树与之相同）结论 **FAIL（0×P0、3×P1、1×P2、3×P3）**：

- **W3R7-01 [P1]** 只读请求词（`看一下/检查一下/帮忙/帮我/麻烦/请` + 命名路径）获得写授权并可派发写 Run（`848b5c4` 引入的回归；对照 `7c01c9d` 不授权）——**第十三轮判定已修，无回归**。
- **W3R7-02 [P1]** 中文完成体因 `\b` 在 Han 语境恒不匹配而形同虚设；中文疑问缺 `谁/哪些/几点`；英文 `needs a fix`/`The fix needed in…` 未覆盖——**第十三轮判定：登记原句与大量变体已修，但条件/尾巴形态仍开（W3R13-01/02）**。
- **W3R7-03 [P1]** `别改 A，改 B`、`不要修改 A，但要修复 B` 等混合指令误拒（AC-005/006 正例失败）——**第十三轮判定已修，无回归**。
- **A1 [P1 对抗性]** 被排除目标仍获写授权（`修改 docs/PLAN.md 而不是 docs/INDEX.md`）——**第十三轮判定已修（只读）**。
- **A2 [P1 对抗性]** 中文混合意图不拆分（`解释 X 并修复 Y`）——**第十三轮判定已修**。
- **A3 [P1 对抗性]** 纯建议请求授权（`请给出 docs/INDEX.md 的修改建议`）——**第十三轮判定已修**。
- **W3R7-04 [P2]** 边界声明/记录措辞不实——**第十三轮仍未订正（W3R13-07）**。
- **W3R7-05 [P3]** `workItems` 回落 scope 产生不可执行 Work——**第十三轮不可复现（字段已取消）**。
- **W3R7-06 [P3]** 前轮未闭合项与记录数字——**第十三轮仍在（W3R13-08/09）**。

## 附八：第八轮摘要（保留）

第八轮（报告冻结于 `c82169bc72bbcf8395fb2b00584db8e0b3c60b72`）结论 **FAIL（0×P0、3×P1、1×P2、1×P3）**：

- **W3R8-01 [P1]** 中文完成体/陈述的**形态**未被识别：`已经优化了 X`、`已经整理了 X`、`已经修好了 X`、`改动已完成：X`、`我把它改好了：X` 等 12 个变体仍授权 —— **第十三轮判定：已修（全部只读）**。
- **W3R8-02 [P1]** 拒绝与非承诺、以及部分疑问句仍授权（`我不想修改 X`、`别急着修改 X`、`请勿修改 X`、`修改 X 了没有`、`Will you fix X`、`Shall we update X` 等）—— **第十三轮判定：拒绝/普通疑问已修；未登记选择尾仍开（W3R13-03）**。
- **W3R8-03 [P1]** 只读言说行为（解释/评价/了解/请教）中嵌入变更动词即授权 —— **第十三轮判定已修（10/10 只读）**。
- **W3R8-04 [P2]** 记录与实现不一致 —— **第十三轮仍未订正（W3R13-07）**；本轮计数 12+77 已与实测一致，绝对表述仍在（`:113/:140/:177/:186`）。

## 附九：第九轮摘要（保留）

第九轮（报告冻结于 `d23ce7b1d3c33df8854420941d1a937af9319a2a`；被审代码树同为 `d23ce7b`）结论 **FAIL（0×P0、3×P1、1×P2、2×P3）**，全部以真实 HTTP + 真实 Orchestrator 取证：

- **W3R9-01 [P1]** 句首 `V了` / `V完了` 的**陈述/完成体**仍被当作祈使并授权（`补充了 X`、`优化了 X`、`改好了 X`、`修改好了 X`、`删除掉了 X`、跨子句 `更新了接口文档，补充了 X 的说明`）——**第十三轮判定：已修（复跑 23 句完成体语料全只读）**。
- **W3R9-02 [P1]** **选择疑问句**（`修改 X 好还是不改好`、`修 X 行不行`、`fix X or leave it alone`、`refactor …, yes or no`）仍授权 —— **第十三轮判定：登记原句已修；同族登记外变体仍越权（→ W3R13-03）**。
- **W3R9-03 [P1]** **修饰性/参照性从句前置**（`based on X, update Y`）因逗号切分授权了参照路径 —— **第十三轮判定：已关闭（参照只授权自身命名目标；本轮作用域 0 扩张；但此类表达整体只读为 fail-closed）**。
- **W3R9-04 [P2]** 记录绝对表述与旧计数 —— **第十三轮仍未订正（W3R13-07）**。
- **W3R9-05 [P3]** 协议对账（未知字段静默忽略、响应字段多于协议表）—— **第十三轮仍在（W3R13-09）**。
- **W3R9-06 [P3]** 未登记祈使 fail-closed 代价清单 —— **第十三轮仍在**。

## 附十：第十轮摘要（保留）

第十轮（报告冻结于 `e384dd10b84a1e6bfcf1612ad9f5dc706e232590`，**被审代码树 `0fb5c71`**，第十轮修复提交为 `1ede8c7`）结论 **FAIL（0×P0、2×P1、1×P2、3×P3）**：

- **W3R10-01 [P1]** 选择疑问/征询语气的**变体**仍产生写授权并可派发真实写 Run（`更新 X 还是新建一个文档`、`修 X 行不行`、`修改 X 该不该`、`修改 X 哪个更好`、`修改 X 抑或重写`、`fix X vs. leave it`、`refactor X, yes or no` 等；自建矩阵 14/36 fail-open）——**第十三轮判定：登记原句 6 条已修；同族 hold-out 仍越权（→ W3R13-03）**。
- **W3R10-02 [P1]** 不触发条件继承的**条件前件**变体仍产生写授权并可派发真实写 Run（`一旦确认，修复 X`、`经确认后，修改 X`、`有错误的话，修复 X`、`once approved, fix X`、`after you confirm, update X`）——**第十三轮判定：登记原句 5 条已修；同族变体仍越权（→ W3R13-02）**。
- **W3R10-03 [P2]** `NON_COMMAND_MARKERS` 的**单字命中**误杀文档化正例（`删除 X 的过时内容`、`清理 X 的过时内容` 等）——**第十三轮判定：未修（→ W3R13-05）**；注：第十轮报告"`删除过期内容` 是 `experience.md` §3 规范动作"的前提不成立（`grep -rn "过时" docs/` = 0 命中），但误拒事实成立。
- **W3R10-04 [P3]** 记录仍含绝对表述与旧轮次计数（`implementation.md:113/:140/:186`）——**第十三轮仍未订正（→ W3R13-07）**。
- **W3R10-05 [P3]** 回归网缺口：选择疑问/条件前件/复合词误拒零断言，授权→`assess`/`dispatch` 无产品用例——**第十三轮仍在（→ W3R13-08）**。
- **W3R10-06 [P3]** 协议对账（未知字段静默忽略、响应字段多于协议表）与第八轮报告哈希笔误 —— **第十三轮仍在（→ W3R13-07/09）**。
- 第十轮以自建 8 个脚本（`/tmp/w3r10/probe1..8`）取证：非祈使 150/165 只读、15 越权；HTTP 7 条落库授权；真实 Orchestrator 7 条建立写 Run；登记 71 负 + 19 正 + 4 作用域 0 偏差；客户端注入 0 通路。

## 附十一：第十一轮摘要（保留）

第十一轮（报告冻结于 `7b0e6b5a8c5823a329d9781155ceabddab36b44e`，**被审代码树 `1ede8c7`**，第十一轮修复提交为 `d98ac43`）结论 **FAIL（0×P0、3×P1、2×P2、4×P3）**：

- **W3R11-01 [P1]** 目标优先的**陈述/状态/计划/许可/拒绝**句仍产生写授权并可派发真实写 Run（`X 尚未修改`、`X 正在修改`、`X 计划修改`、`X 可以修改`、**`X 拒绝修改`**、`X 想修改`、`X 决定修改`、`X 有错误就修复`；模板矩阵 A 85 探测 / **80 授权**）——**第十三轮判定：目标优先整类已关闭（211/211 + 本轮 86/86；→ 但动词优先尾巴仍开，W3R13-01）**。
- **W3R11-02 [P1]** **选择疑问/问句尾**的未登记变体仍产生写授权并可派发真实写 Run（`修改 X 哪个更好`、`修改 X 抑或重写`、`修改 X 要不然保留`、`修改 X 也可以`、`修改 X 的哪个部分`、`fix X versus rewriting it`；hold-out 7/9 开）——**第十三轮判定：登记原句已修；`算不算必要/有何意义/好在哪` 仍开（→ W3R13-03）**。
- **W3R11-03 [P1]** **条件前件**的未登记变体仍产生写授权并可派发真实写 Run（`待你确认，修改 X`、`看情况，修改 X`、`发现问题，修改 X`、`upon approval, update X`、`pending review, update X`；hold-out 9/11 开）——**第十三轮判定：上述登记原句已修；`视具体情况/经审批/先确认/收到消息后` 仍开，且新增复位缺陷（→ W3R13-02/04）**。
- **W3R11-04 [P2]** `NON_COMMAND_MARKERS` 单字/子串命中误杀合法祈使（含目标路径本身，16/16 误拒）——**第十三轮判定：未修（→ W3R13-05）**。
- **W3R11-05 [P2]** 中文 `把/将/对`（处置式）祈使在第十轮重写中回归为误拒（4/4）——**第十三轮判定：已修（处置式 4/4 可用）**。
- **W3R11-06 [P3]** 记录绝对/失真表述、旧计数、未同步头、不可复现外置语料 —— **第十三轮仍未订正（→ W3R13-07）**。
- **W3R11-07 [P3]** 回归网缺口：三条 P1 的全部证据句零断言，授权→`assess`/`dispatch` 仍无产品用例 —— **第十三轮仍在（→ W3R13-08）**。
- **W3R11-08 [P3]** 协议对账与 wire 语义承接 —— **第十三轮仍在（→ W3R13-09）**。
- 第十一轮以自建 10 个脚本（`/tmp/w3r11/probe1..10`）取证：141 负向 21 越权；模板矩阵 A 80/85、B 6/17、C 8/34、C-EN 4/9；HTTP 16/16 落库授权；真实 Orchestrator 12 条建立写 Run；登记 86 负 + 21 正 + 4 作用域 0 偏差；客户端注入 0 通路；差分解剖 97 负只修好 1、15 正新坏 4。

## 附十二：第十二轮摘要（保留）

第十二轮（报告冻结于 `b6357a9f54ba65a820e00c383b56ed0d007a9793`，**被审代码树 `d98ac43`**，第十二轮修复提交为 `6f48d26`）结论 **FAIL（0×P0、3×P1、1×P2、3×P3）**：

- **W3R12-01 [P1]** 动词优先模板**无尾守卫**：陈述/状态/意见/名词化尾巴仍产生写授权并可派发真实写 Run（`修改 X 是必要的`、`修改 X 尚未完成`、`修改 X 更合适`、`删除 X 的理由`、`fix X was not requested` 等；B1 18/23、E1 3/6；HTTP 20/20、e2e 10/10 可写）——**第十三轮判定：T20 以「有界尾巴 + 词表」收口，登记原句已修、目标优先整类已关，但未登记谓词尾巴仍开 54 句（→ W3R13-01）**。
- **W3R12-02 [P1]** 选择/疑问尾的未登记变体仍产生写授权（`修改 X 或重写`、`修改 X 划算不划算`、`fix X versus rewriting it` 等）——**第十三轮判定：登记原句已修；`算不算必要/有何意义/好在哪/更简单/更省事` 仍开（→ W3R13-03）**。
- **W3R12-03 [P1]** 条件前件的未登记变体仍产生写授权（`视情况而定，修改 X`、`经批准，修改 X`、`等消息，修改 X`、`after discussion, update X`、`at your discretion, update X`）——**第十三轮判定：登记原句已修；同族变体仍开且新增复位缺陷（→ W3R13-02/04）**。
- **W3R12-04 [P2]** 合法祈使被标记子串/收尾约束误拒（12/16）——**第十三轮判定：未修（→ W3R13-05）**。
- **W3R12-05 [P3]** 记录名实不符与 planVersion 2 未登记取舍 —— **第十三轮仍未订正（→ W3R13-07）**。
- **W3R12-06 [P3]** 回归网缺口/无 Orchestrator 产品用例 —— **第十三轮仍在（→ W3R13-08）**。
- **W3R12-07 [P3]** 协议对账与 wire 语义承接 —— **第十三轮仍在（→ W3R13-09）**。
- 第十二轮以自建 8 个脚本（`/tmp/w3r12/probe1..8`）+ 复用 3 个脚本取证：361 句非命令 63 授权；HTTP 20/20 落库授权；真实 Orchestrator 10 条建立写 Run；登记 86 负 + 19 正 + 3 声明 + 4 作用域 0 偏差；客户端注入 0 通路；差分解剖修好 111、仍开 63、新坏 0；前轮 P0/P1 17/17 通过。
## 附十三：第十三轮摘要（保留）

第十三轮（报告冻结于 `3d323da`，**被审代码树 `6f48d26`**，第十三轮修复提交为 `6e77512` + `f40d634`）结论 **FAIL（0×P0、4×P1、2×P2、3×P3）**：

- **W3R13-01 [P1]** 动词优先「有界尾巴」的守卫仍是词表：`修改 X 是不明智的`、`修改 X 的必要性`、`修改 X 属于越权`、`update X seems right`、`fix X was skipped` 等 54 句 A 档非命令产生写授权并可派发真实写 Run（HTTP 22/22、e2e 12/12）——**第十四轮判定：T21 的无尾文法已闭合（第十三轮 54 句归零）**。
- **W3R13-02 [P1]** 条件前件仍是词表枚举（`视具体情况/经审批/先确认/收到消息后/after review/depending on the result` 等 13 句）——**第十四轮判定：登记形态已闭合（`视具体情况，修改 X` 等只读），但同族换承接副词前缀后重开（→ W3R14-01）**。
- **W3R13-03 [P1]** 选择/疑问尾变体（`修改 X 算不算必要`、`修改 X 有何意义`、`修改 X 好在哪`、`更简单/更省事`）——**第十四轮判定：已闭合（只读）**。
- **W3R13-04 [P1]** `conditional` 复位缺陷（`经批准，修改 X，删除 Y` 给 Y 授权）——**第十四轮判定：已闭合（4/4 只读）**。
- **W3R13-05 [P2]** 合法祈使被标记子串/收尾约束误拒 12/16（`删除 X 的过时内容`、`修改 docs/会议.md`、`把 X 改成新版本` 等，fail-closed）——**第十四轮仍未修，且正例 `对 X 进行修改`、`别改 A，改 B` 一并落入只读（→ W3R14-03/06）**。
- **W3R13-06 [P2]** 多目标命令静默部分授权（`修改 X and Y` → 仅 X；`把 X 和 Y 都改掉` → 仅 X）——**第十四轮：处置式多目标已只读；`and` 版仍部分授权（→ W3R14-04）**。
- **W3R13-07 [P3]** 记录名实不符：T20「其余一律只读」被 54 句证伪、`plan.md` 未同步、计数 71 不可复现、`planVersion` 头未同步、绝对表述仍在——**第十四轮仍未订正并加重（T22 的「按结构关闭」被证伪；计数 11/84 实测 12/79）（→ W3R14-05）**。
- **W3R13-08 [P3]** 回归网缺口/无 Orchestrator 产品用例 —— **第十四轮仍在（→ W3R14-07）**。
- **W3R13-09 [P3]** 协议对账与 wire 语义承接 —— **第十四轮仍在（→ W3R14-08）**。
- 第十三轮以自建 6 个脚本（`/tmp/w3r13/probe1..8`）+ 复用脚本取证：197 句 hold-out 54 句 A 档授权；361 句旧语料 63→35；HTTP 22/22 落库授权；真实 Orchestrator 12 条建立写 Run；登记 12 正 + 77 负 0 偏差；客户端注入 0 通路；前轮 P0/P1 17/17 通过。
- 第十三轮判定的共同根因：**「形态判定退化为词表枚举」**——`修改 X 是必要的`（词表内）只读 vs `修改 X 是不明智的`（词表外）授权。第十四轮在此基础上新增两条同根因通道：**前件位置/前缀门**与**情态词归一洗白**。
