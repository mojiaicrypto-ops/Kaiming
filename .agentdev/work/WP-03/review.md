# WP-03 独立 Review 报告（第十五轮）

- 评审对象：工作包 WP-03「直接协作与说明产物」
- 评审轮次：**第十五轮**（第一～十四轮摘要见文末「附一～附十四」，全部保留）
- 冻结点 / HEAD：`git rev-parse HEAD` = `351b851a02a7d62349506646e5b562d19c059882`。**与任务下达的 `HEAD=d2e4ff5` 存在一个「仅文档」提交的漂移**：`git diff --name-only d2e4ff5 HEAD` = `.agentdev/work/WP-03/review.md`（即第十四轮报告提交本身）。因此**被审代码树逐字等于 `d2e4ff5`**，漂移不改变任何代码/测试 blob（详见 §7 记录项 1，属提示而非缺陷）。
- 工作树：全部命令执行前后 `git status --porcelain` 为空；除本报告外无未提交修改
- 评审角色：Review（独立上下文；未读取任何开发/Test 会话；只依据仓库文件、契约文档与 `/tmp/w3r15/` 下我自建的 5 个实验脚本 + 复用 `/tmp/w3r14/` 的 5 个只读回归脚本 + `/tmp/w3r13/probe8-scope.mjs`）
- 工具：`node v24.8.0`、`pnpm 12.3.4`、macOS 宿主；全部脚本消费 `pnpm build` 产物（`packages/domain/dist`、`packages/core/dist`、`apps/daemon/dist`、`packages/storage/dist`），**未 import 任何产品测试文件**
- 记录哈希（`git hash-object`，前 8 位）：`packages/domain/src/requests.ts` **`0f71414a`**（T23 后；第十四轮为 `1dc5666c`）、`packages/domain/test/domain.test.ts` **`2cbfbd5f`**（第十四轮 `fa38afbf`）、`apps/daemon/src/server.ts` `3a348304`（与第十三/十四轮逐字相同）、`packages/core/src/messages.ts` `283d4c04`、`packages/core/src/preview.ts` `803b502a`、`packages/core/src/artifacts.ts` `057ff403`、`packages/core/src/attachments.ts` `3ee94838`、`.agentdev/work/WP-03/plan.md` **`8986875e`（与第十一～十四轮逐字相同，仍未改动）**、`.agentdev/work/WP-03/implementation.md` **`78177bfa`**
- 变更范围（`git show --numstat d2e4ff5`）：本轮仅 `packages/domain/src/requests.ts`（+27/−19）、`packages/domain/test/domain.test.ts`（+14/−0）、`.agentdev/work/WP-03/implementation.md`（+12/−0，T23）。`packages/core/src/**`、`apps/daemon/src/**`、`docs/**`、`plan.md` **零改动** → 核心/HTTP 面的前十四轮 P0/P1 由「未改动 + 独立复验」担保（见 §6.2）
- 权威依据：`AGENTS.md`、`docs/INDEX.md`、`docs/rules/{workflow,agents}.md`、`docs/product/experience.md`（§3）、`docs/architecture/{data,protocol,execution,reliability}.md`、`docs/delivery/{implementation,acceptance}.md`（AC-001..006/052/076/084）、`.agentdev/work/WP-03/{plan,implementation,review}.md`、`packages/**`、`apps/daemon/**`、相关测试

---

## 1. 结论

**FAIL（不能进入独立 Test；按 `docs/rules/workflow.md` §6 走 `Blocking Review Finding → Develop → Independent Review`）。**

本轮判 **FAIL（0×P0、2×P1、3×P2、2×P3）**。

T23 的三条修复**部分成立**，必须逐条区分：

- **成立的部分（可复核的改善）**：
  - **后置条件抑制**：`修改 X，如果没问题`、`修改 X，一旦确认`、`修改 X，但是可能需要审批`、`update X, if the build is green` 全部只读（第十四轮「后置条件同样失效」通道关闭）；
  - **`需要` 情态词不再被剥除**：`但需要修改 X`、`另外需要修改 X`、`就需要修改 X`、`也需要修改 X`、`但需要把 X 改掉`、`需要修改 X，也需要修改 Y`、`这个文档有问题，也需要更新 Y`、`还没决定，也需要修改 Y`、`目前不用改 X，也需要更新 Y` 全部只读（第十四轮 W3R14-02 的 10×`需要` 与 F1b 8 句归零）；
  - **拒绝纠正面**：`别改 Y，改 X`、`不要改 Y，改 X`、`不要修改 Y，但要修复 X`、`don't fix Y, fix X`、`修改 X。谢谢` 全部授权，且写范围只含纠正目标（第十四轮 W3R14-03 的 `别改 Y，改 X` 误拒关闭）；
  - **`就/再/也/但` 承接副词通道**：`视具体情况，就/再/也/但修改 X`、`经审批，再修改 X`、`看结果，就修复 X`、`先跟你确认，再修改 X`、`走完流程，就修改 X` 全部只读（`continues` 删除生效）。
- **不成立的部分（本轮 P1）**：
  1. **「前件门」只关掉了「承接副词」，未关掉「并列连词」**：`然后/并且/同时/而且/并/and/then` 在 `splitClauses` 里被当作 coordinating conjunction，而 `allowed = index === 0 || clause.conjunction || previousWasRefusal` 对连词无条件放行；前件是否被抑制仍取决于 `CONDITION_PATTERNS/PRECONDITION_PATTERNS` 词表。于是**任何未登记前件 + 连词**重开了 W3R14-01：`视具体情况，然后修改 X`、`经审批，然后修改 X`、`看结果，然后修复 X`、`depending on the result, then update X`、`based on the review, then update X` 等 **20 句**仍产生写授权（含第十四轮明确列入必读清单的 `depending on the result, then update X`）。
  2. **裸 `要` 仍被 `ADVERB_LEAD_PATTERN` 剥除**，情态陈述洗白为命令：`另外要更新 X`、`也要修改 X`、`但要修改 X` 仍授权（`另外要更新 X` 是第十四轮 §10.2 第 3 行列明的必读句）；叠加新的 `previousWasRefusal`（它由 `NEGATION_PATTERNS` 判定，而该模式也匹配**非拒绝陈述** `不用改 X`/`不需要修改 X`），**纯陈述** `目前不用改 X，也要更新 Y`、`暂时不用改 X，另外要更新 Y`、`需求里提到要修改 X，然后也要更新 Y` 也获得写授权。

两条 P1 均落在本包验收面（AC-004 负例、AC-005 授权边界、`workflow.md` §1/§6），**全部以真实 HTTP + 真实 `Orchestrator` 端到端可复现**（含 `packages/core/src/*.ts` 源码目标与真实 `backend:queued` 写 Run），**阻断 Test**。

| 维度 | 第十四轮 | 第十五轮 |
|---|---|---|
| 目标优先整类 | 已关闭 | **保持关闭** |
| 动词优先无尾文法 | 已关闭 | **保持关闭（54 句 A 档仍 0）** |
| 前件 + **承接副词**（`就/再/也/但/则`） | 20/22 fail-open | **归零（T23 关闭）** |
| 前件 + **并列连词**（`然后/并且/同时/而且/并/and/then`） | 未单列（混在 20/22 内） | **20 句 fail-open（W3R15-01）** |
| 情态 `需要/应该/必须/得/该` | 10 句 fail-open | **归零** |
| 情态裸 `要`（`另外要/也要/但要`） | 3 句 fail-open | **3 句仍开 + 4 句纯陈述新通道（W3R15-02）** |
| 后置条件 / 疑问 / 选择 / 评价（词表内） | 部分开 | **归零** |
| 拒绝纠正 `别改 A，改 B` | 回归只读 | **已修（5/5 中 3 条可用）** |
| 拒绝纠正 `不修改 A，改写 B` / `先别改 A` | 误拒 | **仍误拒（W3R15-03）** |
| 多目标 `and` 静默部分授权 | 2 句 | **3 句未修（W3R15-04）** |
| 登记语料 | 12 正 + 79 负 | **14 正 + 89 负，0 偏差（记录称 11+84，见 W3R15-05）** |
| 客户端注入面 | 无通路（11 项） | **无通路（11 项）** |
| 前轮 P0/P1 复验 | 16/17 | **17/17** |
| P1 数量 | 3 | **2** |

---

## 2. 契约命令原始结果（本轮实跑）

执行目录：仓库根；在 `HEAD=351b851`（代码树 `d2e4ff5`）、工作树干净时执行；`pnpm build` 产物由本轮 build 生成。逐条串行，原始日志：`/tmp/w3r15/contract.log`。

| 命令 | 退出码 | 原始结果要点 |
|---|---|---|
| `pnpm build` | **0** | `pnpm -r build`，**8** 个 workspace `build: Done`：`contracts, cli, domain, storage, core, daemon, pi-runtime, runner` |
| `pnpm typecheck` | **0** | `tsc -p tsconfig.json --pretty false`，无输出 |
| `pnpm lint` | **0** | `All matched files use Prettier code style!` |
| `pnpm test:unit` | **0** | `Test Files 19 passed (19)`、`Tests 289 passed (289)` |
| `pnpm test:integration` | **0** | `Test Files 10 passed (10)`、`Tests 124 passed (124)` |
| `pnpm docs:check` | **0** | `docs:check ok — 15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages` |

`git status --porcelain`（写入本报告前）：**空输出**；`HEAD` 全程 `351b851a02a7d62349506646e5b562d19c059882`，代码树 `d2e4ff5`。
计数对账：`implementation.md` T23（`:273`）的 `289 / 124 / 8 / docs:check ok` 与实测**一致**（但本提交**未新增测试用例**，`289/124` 与第十四轮逐字相同；新增语料是塞进既有循环，见 W3R15-06）。

**命令全绿不等于必验范围成立**：本轮全部越权、误拒与端到端证据在仓库测试内**零断言**（见 W3R15-06）；`Orchestrator` 仍不出现在 `apps/daemon/test/server.test.ts`、`packages/core/test/artifacts.test.ts`（W3R4-05 承接）；且第十四轮点名的测试覆盖收缩（英文混合意图正例改中文、`对 X 进行修改`→`对 X 修改`）**本轮未恢复**。

---

## 3. 越权（fail-open）方向：独立穷举核验

### 3.1 口径声明（先声明后实测）

- **缺陷（fail-open）**：句子**整体不是祈使指令**（条件前件门控 / 陈述 / 状态 / 意见 / 评价 / 引用 / 排除），却在 `routeMessage` 上产生 `explicitAuthorization=true` 并落到 `delivery` 写 Work。
- **非缺陷（已声明代价，T21/T22 planVersion 2）**：未登记同义变更词（`重写/润色/polish`）、名词短语祈使（`修改 X 中的错别字`、`fix the typo in X`、`把 X 里的错别字改掉`、`对 X 进行修改`）、目标优先日常祈使、排除式（`修改 Y 而不是 X`）→ 只读 + 澄清。
- **非缺陷（真祈使 / 混合）**：`并/and` 连接的两个真祈使（`修改 X 并删除 Y`、`解释 X 并修复 Y`）；**陈述 + 显式祈使**的混合句（`X 已被修改，然后更新 Y`、`需求里提到要修改 X，然后更新 Y`）单列为 **B 档**，不计入 A 档缺陷。
- **判定分档**：A 明确非命令（计入缺陷）；B 形态可辩（单列）；C 真祈使；F 已声明 fail-closed。

### 3.2 语料与结果总表（`/tmp/w3r15/probe1-corpus.mjs`，143 句，全部消费 `pnpm build` 产物）

| 族 | 句数 | 授权/缺陷 | 判定 |
|---|---|---|---|
| **G1 前件 + 并列连词**（`视具体情况，然后/并且/同时/而且/并修改 X`、`经审批，然后/并修改 X`、`看结果，然后修复 X`、`先跟你确认，然后修改 X`、`收到消息后，然后修改 X`、`走完流程，然后修改 X`、`等评估完，然后修改 X`、`视具体情况，修改 X，然后删除 Y`、`depending on the result/based on the review/given the findings/following the meeting/per the earlier note/approval pending/provided the tests pass, then update X`） | 41 | **20 fail-open**（A 档） | **W3R15-01** |
| **G2 情态洗白（裸 `要`）与拒绝陈述**（`另外要更新 X`、`也要修改 X`、`但要修改 X`、`暂时不用改 X，另外要更新 Y`、`目前不用改 X，也要更新 Y`） | 18 | **5 fail-open** | **W3R15-02** |
| **G3 报告/引用 + `要` 洗白（纯陈述）**（`需求里提到要修改 X，然后也要更新 Y`、`文档里写着修改 X，然后也要更新 Y`） | 9 | **2 fail-open** | **W3R15-02** |
| **G4 评价前件（词表外 `可能`）+ 连词**（`这可能有问题，然后修改 X`） | 10 | **1 fail-open** | **W3R15-01** |
| G5 疑问/选择（`要不要修改 X`、`修改 X 好还是删除 Y 好`、`should I update X`、`update X or leave it alone` 等） | 9 | **0** | 保持关闭 |
| G6 被动/完成体 + 显式祈使（混合） | 6 | 5 授权 | **B 档**（非缺陷，见 §3.3） |
| G7 引用/报告 + 显式祈使（混合） | 4 | 2 授权 | **B 档** |
| G8 排除/多目标（`修改 Y 而不是 X`、`参考 X 修改 Y`、`修改 X、Y` 只读；`修改 X and Y` 等部分授权） | 9 | **3 部分授权** | **W3R15-04** |
| G9 文档化正例（严格命令 6、英文 2、处置式 3、拒绝纠正 5、礼貌尾 1、混合意图 3） | 21 | **2 误拒** | **W3R15-03** |
| G10 已声明 fail-closed（`修改 X 中的错别字`、`fix the typo in X`、`把 X 里的错别字改掉`、`对 X 进行修改`、`重写 X`、`X 的错别字麻烦处理下`） | 7 | 0 意外授权 | 与声明一致 |
| G11 作用域（`修改 X 参考 Y`、`把 Y 参照 X 改掉` 只读；`修改 Y，X 保持不动` 仅授权 Y） | 3 | **0 扩张** | 正确 |
| G1 后置条件（`修改 X，如果没问题`、`修改 X，一旦确认`、`修改 X，但是可能需要审批`、`修改 X，after review`、`update X, if the build is green`、`修改 X，否则就回滚`） | 6 | **0** | **T23 关闭** |
| **合计** | **143** | **31 A 档 FAIL-OPEN（G1 20 + G4 1 + G2 5 + G3 2 + G8 部分 3）+ 7 B 档 + 2 FALSE-REJECT + 2 AMBIG** | |

**同批复跑第十四轮 hold-out 语料（`/tmp/w3r14/probe1-corpus.mjs`，201 句，本轮 build）**：

| 族 | 第十四轮 | 第十五轮 |
|---|---|---|
| F1 前件 + 承接副词/连词 | 20 fail-open | **3 fail-open**（`视具体情况，然后修改 X`、`depending on the result, then update X`、`approval pending, then update X`） |
| F1b 纯陈述 + `也/再/就` | 8 | **0** |
| F2 副词 + 情态洗白 | 13 | **3 fail-open**（`也要修改 X`、`但要修改 X`、`另外要更新 X`） |
| F3/F4/F5/F6/F8/F9/F10/F11/F12（尾巴、目标优先、疑问、条件、英文、处置式、正例、声明代价、作用域） | 0 | **0** |
| **合计** | 41 fail-open + 2 partial + 1 false-reject | **6 fail-open + 2 PARTIAL** |

→ T23 把第十四轮的 41 句降到 6 句，但**未归零**；其中 `depending on the result, then update X`（W3R14 §10.2 第 1 行）与 `另外要更新 X`（第 3 行）是第十四轮**逐句列明的必读清单成员**。

### 3.3 实证证据句与同形反向对照（`/tmp/w3r15/probe5-contrast.mjs`）

**（1）W3R15-01 前件门只关了一半：连词通道**

```
视具体情况，修改 docs/INDEX.md          -> read-only      （T23 已修）
视具体情况，然后修改 docs/INDEX.md      -> AUTHORIZES docs/INDEX.md   ← 同形重开
经批准，然后修改 docs/INDEX.md          -> read-only      （词表内）
经审批，然后修改 docs/INDEX.md          -> AUTHORIZES docs/INDEX.md   ← 一字之差
看情况，然后修改 docs/INDEX.md          -> read-only
看结果，然后修改 docs/INDEX.md          -> AUTHORIZES docs/INDEX.md
待你确认，然后修改 docs/INDEX.md        -> read-only
先跟你确认，然后修改 docs/INDEX.md      -> AUTHORIZES docs/INDEX.md
after review, then update docs/INDEX.md -> read-only
depending on the result, then update X  -> AUTHORIZES docs/INDEX.md
approval pending, then update X         -> AUTHORIZES docs/INDEX.md
provided the tests pass, then update X  -> AUTHORIZES docs/INDEX.md
这可能有问题，然后修改 docs/INDEX.md    -> AUTHORIZES docs/INDEX.md
视具体情况，修改 X，然后删除 Y          -> AUTHORIZES docs/PLAN.md
```

**（2）W3R15-02 裸 `要` 洗白 + 拒绝陈述通道**

```
另外需要修改 docs/INDEX.md              -> read-only      （T23 已修）
另外要更新 docs/INDEX.md                -> AUTHORIZES docs/INDEX.md   ← 同形重开
也要修改 docs/INDEX.md                  -> AUTHORIZES docs/INDEX.md
但要修改 docs/INDEX.md                  -> AUTHORIZES docs/INDEX.md
目前不用改 docs/INDEX.md，也需要更新 Y   -> read-only      （T23 已修）
目前不用改 docs/INDEX.md，也要更新 Y     -> AUTHORIZES docs/PLAN.md    ← 纯陈述
暂时不用改 X，另外要更新 Y               -> AUTHORIZES docs/PLAN.md
需求里提到要修改 X，然后也要更新 Y       -> AUTHORIZES docs/PLAN.md
```

**（3）非缺陷（B 档）对照**：`X 已被修改，然后更新 Y`、`修复 X 已经完成了，然后更新 Y`、`需求里提到要修改 X，然后更新 Y` 授权 —— 这些句中**存在显式祈使子句**（`然后更新 Y`），且语句可读为「先…再…」的真实序列，按 §3.1 口径不计入缺陷（但记录在案，供 Test 决定是否收窄）。真正的问题是它们的**祈使子句被 `要` 洗白**的变体（G2/G3），已计入 W3R15-02。

### 3.4 HTTP 端到端（`/tmp/w3r15/probe2-http.mjs`，真实 daemon：真实 SQLite + 真实 blob + Bearer）

45 句：**24 句非命令 fail-open** —— HTTP 202、`authorizationId` 非空、新增 1 条 `authorization` 行、新 Work `level=["L2"]`、`intent=["delivery"]`、`writes` 为句中路径、写入 1 条 `assessment`。代表句：`视具体情况，然后修改 X`、`视具体情况，并且修改 X`、`视具体情况，同时修改 X`、`视具体情况，而且修改 X`、`视具体情况，并修改 X`、`经审批，然后修改 X`、`看结果，然后修复 X`、`先跟你确认，然后修改 X`、`走完流程，然后修改 X`、`等评估完，然后修改 X`、`视具体情况，修改 X，然后删除 Y`、`depending on the result, then update X`、`based on the review, then update X`、`given the findings, then update X`、`approval pending, then update X`、`provided the tests pass, then update X`、`这可能有问题，然后修改 X`、`目前不用改 X，也要更新 Y`、`暂时不用改 X，另外要更新 Y`、`需求里提到要修改 X，然后也要更新 Y`、`另外要更新 X`、`也要修改 X`、`但要修改 X`、`修改 X and Y`。
对照组：登记负例 12/12 只读（`authId=null`、`level=none`、零授权行）；正例 8/8 授权；**2 句登记纠正正例误拒**（`不修改 Y，修改 X`、`先别改 Y，改 X`）。

### 3.5 真实 Orchestrator 端到端（`/tmp/w3r15/probe3-e2e.mjs`）

28 句：**14 句非命令各建立 1 个真实 `backend/implementation` 写 Run**（`writeRuns=["…:backend:queued:writes=[…]"]`），全部经 `assess`（L2 + `authorizationRef` 通过 `verifyAuthorization`）与 Chief 父 Run；其中 `视具体情况，然后修改 packages/core/src/orchestrator.ts` 建立**源码**写 Run。否定对照组 7/7 只读；正例 5/5 建写 Run；**2 句登记纠正正例误拒**。→ **准入闸门正常，越权来自授权判定本身。**

### 3.6 危害上界

- 越权范围恒等于句中**被点名的那一个/那些路径**，`operations=['read','edit']`、`networkTargets=[]`；环境/网络/越界路径仍被 `verifyAuthorization` 拒绝（作用域实验 **0 扩张**，见 §4）。
- 目标**不限于 `docs/`**：`视具体情况，然后修改 packages/core/src/orchestrator.ts` 落库授权并建立真实 `backend:queued` 写 Run（已实测）。
- 危害是「用户只是陈述/提问/给条件，却产生可执行的**源码**写授权与真实写 Run」，属 `workflow.md` §6 的 P1（错误行为/需求缺失）+ AC-004 负例失败；仍不是 P0（无环境/网络/数据删除通路）。

---

## 4. 写范围恒等复核（`/tmp/w3r13/probe8-scope.mjs` 在本轮 build 上复跑）

- **扩张方向：未发现缺陷。** 目标必须与**同子句**点名路径逐字相等（`pathsIn(core).includes(target)`，`requests.ts:262`），因此写范围 ⊆ 句中路径：
  - `修改 Y，X 保持不动` → `granted=["Y"]`；`参考 X 修改 Y`、`修改 Y 参考 X`、`基于 X 更新 Y`、`修改 Y 而不是 X`、`更新 Y instead of X`、`把 Y 参照 X 改掉`、`把 X 和 Y 都改掉` → 全部只读；
  - 别名铸造关闭：`修改 X...`、`修改 X.`、`fix X...` 只读；`修改 X-` 会把 `X-` 作为**用户逐字写出的路径词元**授权（非别名），与第十四轮判定一致，未构成对 `X` 的越权。
- **三项部分授权（W3R15-04）**：`修改 X and Y`、`delete X and Y` → 仅 `["X"]`；`修改 X，删除 Y，更新 Z` → 仅 `["X"]`。授权范围是用户点名目标的**子集**（无害上界），但与「多目标列表一律只读」的声明不一致，且静默丢弃后续目标。
- 多子句真祈使（`修改 X 并删除 Y`、`把 X 删除并更新 Y`）授权各自目标，符合预期（非扩张）。

---

## 5. 文档化正例与 fail-closed 取舍复核

- **必须授权正例（登记 14 条）**：文本提取（`/tmp/w3r15/probe4-registered.mjs`，引号感知、**不 import** 测试文件）后逐句用**构建产物**复跑 → **14/14 授权，`writePaths` 长度恒为 1，0 偏差**；其中包含本提交新增的 `别改 docs/PLAN.md，改 docs/INDEX.md` 与 `修改 docs/INDEX.md。谢谢`。
- **混合意图**：`解释 X 并修复 Y` → assist + delivery，写范围只含 Y；`explain X and fix Y`、`先解释 X，然后修改 Y` 同样成立（HTTP 建 2 Work）。**并列连词引入的真祈使**可用。
- **处置式**：`把 X 改掉`、`将 Y 删除`、`对 Y 修改` 可用；`把 X 里的错别字改掉`、`对 X 进行修改` 落只读——属 T21/T22 概括声明的「丰富措辞」代价（第十四轮 W3R14-06 仍未逐项登记）。
- **拒绝纠正（部分回归）**：`不要修改 Y，但要修复 X`、`别改 Y，改 X`、`不要改 Y，改 X`、`don't fix Y, fix X` 授权且范围仅 X；**`不修改 Y，修改 X`、`先别改 Y，改 X` 仍只读**（W3R15-03）。
- **礼貌尾**：`修改 X。谢谢` 授权；`谢谢，修改 X` 只读（前缀礼貌语不参与位置判定，属 fail-closed，未登记）。
- **已声明 fail-closed 6/6 只读**：`修改 X 中的错别字`、`fix the typo in X`、`把 X 里的错别字改掉`、`对 X 进行修改`、`重写 X`、`X 的错别字麻烦处理下`。**方向为 fail-closed，不产生越权。**

---

## 6. 客户端注入面与前轮 P0/P1 无回归复核

### 6.1 注入面（`/tmp/w3r14/probe5-injection.mjs`，本轮 build + 真实 HTTP，只读复用）

| 注入 | HTTP | 库结果 |
|---|---|---|
| `workItems:[…×50]` / `works:[…×50]` | 202（静默忽略） | workDelta=1（仅路由产出）、authDelta=0、无 write |
| `authorization:{scope:{writePaths:[…],operations:['read','edit']}}` | 202（忽略） | authDelta=0、`authorizationId=null` |
| `authorization:{operations:['deploy']}` | 202（忽略） | 零授权行 |
| `grants:[{operation:'edit',targets:[…]}]` | 202（忽略） | 零授权行 |
| `scope:{writePaths:[…]}` + `level:'L3'` + `intent:'operation'` | 202（忽略） | 零授权行、无 L3 Work |
| `targetWorkId`（不存在/跨会话） | **404 / 403** | 零副作用 |
| 未知字段 `foo`/`targetRole`/`ownerUserId` | 202（**静默忽略**） | 无副作用（承接 `protocol.md` §1/§3，W3R15-07） |
| 空 body / 缺 `conversationId` / 未知 `conversationId` | **400 / 400 / 404** | 零副作用 |

**结论：wire 层不存在 `authorization`/`workItems`/`works`/`grants`/`scope`/`level`/`intent` 通路，11 项注入零授权行、零越权 Work，无回归。`apps/daemon/src/server.ts` 哈希 `3a348304` 与第十三/十四轮逐字相同（零改动）。**

### 6.2 前轮 P0/P1 复核（`/tmp/w3r14/probe6-prior.mjs`，**17/17**）

| 项目 | 本轮实测 | 状态 |
|---|---|---|
| W3-01 下载 token 可预测/先于认证（P0） | token 不内嵌 artifactId；首次 200、二次 403 | 无回归 |
| W3-02 产物读取无主体维度（P0） | 预览走 `assertReadable`；CSP 逐字、sandbox、`credentials: omit`、无 `set-cookie`、`nosniff` 全成立 | 无回归 |
| W3R3-01 授权 capability 缺口致死锁（P1） | 正例 `assess`/`dispatch` 全通（含 `readPaths`+`read`） | 无回归 |
| W3R3-06 CSP 单头/逐字相等（P2） | `preview.ts` 哈希 `803b502a` 与第十三/十四轮相同；头逐字等于 `PREVIEW_CSP` | 无回归 |
| W3R4-03 `assertGrantWithinMessage` 约束 `readPaths` | 代码仍在（`messages.ts`）；HTTP `authorization` 注入被忽略 | 无回归 |
| W3R4 review `targetWorkId` 跨会话 | 跨 Conversation 目标 Work → **403 `NOT_AUTHORIZED`** | 无回归 |
| W3R4 review 追发不改写 Work | 追发后 `level`/`authorizationRef` 不变、`authorizationId=null` | 无回归 |
| W3R7-01 只读请求词授权（P1） | `帮我看一下/请评估/列出/总结/检查` 全只读 | 无回归 |
| W3R7-03 混合否定+指令（P1） | `不要修改 A，但要修复 B`、`别改 A，改 B` 授权 B；`不修改 A，改 B`/`先别改 A，改 B` 仍只读 | **部分闭合（→ W3R15-03）** |
| A1 目标级排除（P1） | `修改 Y 而不是 X` 只读；`修改 Y，X 保持不动` 只授权 Y | 无回归 |
| A2 中文/英文混合意图（P1） | `解释 X 并修复 Y`、`explain X and fix Y` 只授权 Y | 无回归 |
| A3 纯建议（P1） | `请给出 X 的修改建议`、`请列出 X 里的错误` 只读 | 无回归 |
| W3R12-01/13-01 动词优先尾（P1） | 第十三轮 54 句 A 档 **仍 0** | 已闭合 |
| W3R12-02/13-03 选择/疑问尾（P1） | 登记与 hold-out 全只读 | 已闭合 |
| W3R12-03/13-02 条件前件（P1） | 承接副词形态归零；**并列连词形态仍开** | **部分闭合（→ W3R15-01）** |
| W3R13-04 `conditional` 复位（P1） | 4/4 只读 | 已闭合 |
| W3R14-01/02/03 | F1 20→3、F2 13→3、`别改` 已修 | **部分闭合（→ W3R15-01/02/03）** |
| 登记语料 14 正 + 89 负 | `/tmp/w3r15/probe4-registered.mjs` **0 偏差** | 无回归 |
| `packages/core/**`、`apps/daemon/src/**`、`preview.ts` | 哈希与第十三/十四轮逐字相同 | 零改动 |

**未闭合承接**（P3，不单独阻断）：W3R4-05/W3R15-06（无 Orchestrator 授权回归用例）、W3R4-06/W3R15-07（`protocol.md` §5 未对账）、W3R4-08（`StorageError` 映射粗）、W3R4-10（`targetWorkId` 归属只覆盖 message 来源）、W3R4-12（multipart 多文件 / `projectId`）、W3R4-13（错误响应非 §1 封装）。

---

## 7. 记录与实现一致性核对

| 记录项 | 实测 | 结论 |
|---|---|---|
| 任务下发的 `HEAD=d2e4ff5` | 实际 `HEAD=351b851`，`git diff d2e4ff5 HEAD` 仅 `.agentdev/work/WP-03/review.md`；代码树逐字等于 `d2e4ff5` | **仅文档漂移（提示）** |
| T23「情态词不再被剥离」「`但需要修改 X` 只读，`但要修复 X` 仍可命令」 | `需要/应该/必须/得/该` 确实不再被剥（已修）；**裸 `要` 仍被 `ADVERB_LEAD_PATTERN` 的 `(?:要)?` 剥除**，`另外要更新 X`/`也要修改 X`/`但要修改 X` 授权 | **不准确（W3R15-05）** |
| T23「外置语料 40 条 0 fail-open」 | 仓库内**没有**可复现的 40 条语料文件；第十四轮 hold-out 201 句在本轮 build 上复跑 **6 fail-open + 2 partial**（含第十四轮逐句必读清单里的 `depending on the result, then update X`、`另外要更新 X`） | **不可复现（W3R15-05）** |
| T23「新增第十四轮 10 条必须只读 + 3 条必须授权」 | 文本提取实测：域测试新增 **10 负 + 2 正**；当前登记语料 **14 正 + 89 负** | **计数不准确（W3R15-05）** |
| T21/T22「必须授权 11 条 + 必须只读 84 条」 | 第十四轮已实测 12 + 79；本轮 14 + 89。该数字**未随 T23 订正** | **未订正（W3R15-05）** |
| T22 `:261`「确定性基线的 fail-open 方向现已按结构关闭」 | 第十四轮 201 句 hold-out **6 句 A/B 档仍授权**；HTTP 24 句、e2e 14 句可写 | **证伪（W3R15-01/02/05）** |
| T23 修复 1「统一抑制集合…覆盖前置与后置条件」 | 后置条件、疑问、选择、评价（词表内）、假设均关闭；**未登记前件 + 并列连词**未关闭 | **不完整（W3R15-01）** |
| T23 修复 3「命令可紧接一个拒绝子句之后（`别改 A，改 B`、`不要改 A，但要修复 B`）」 | 上述两句可用，但 `不修改 A，改 B`、`先别改 A，改 B` 仍只读；且 `previousWasRefusal` 由 `NEGATION_PATTERNS` 判定，会把**非拒绝陈述**（`不用改 X`）也算作拒绝，从而为下一子句开门 | **不完整 + 过宽（W3R15-02/03）** |
| `implementation.md:3` `planVersion: 1` | `plan.md:3` 为 `planVersion: 2` | **记录头未同步（第五轮延续，W3R15-05）** |
| T16「记录措辞订正：不再出现「一律/永不」的绝对表述」 | `:11`「一律 `INTERNAL_ERROR`」、`:113`「永不下发写授权」、`:140`/`:177`/`:186`/`:249`「一律只读」原文仍在 | **名实不符（W3R15-05）** |
| `plan.md` 是否登记 T21/T22/T23 的代价 | 哈希 `8986875e` 与第十一～十四轮**逐字相同、未改动**；planVersion 2 未登记无尾文法、情态、连词通道的任何新代价 | **未登记（W3R15-05）** |
| T23「unit 289 / integration 124 / build 8 / docs:check ok」 | 与实测**一致** | **准确** |
| T23「目标必须与消息点名的路径逐字相同」 | `pathsIn(core).includes(target)` 在（`:262`）；`修改 X...` 只读 | **准确** |
| T23「礼貌尾子句忽略」 | `修改 X。谢谢` 授权；`修改 X。不太明智` 只读 | **准确** |
| T23「回归网：新增第十四轮 10 条必须只读 + 3 条必须授权；外置语料 40 条 0 fail-open」 | 断言存在但未覆盖本轮证据句；40 条语料不可复现 | **不准确（W3R15-05/06）** |
| 处置式正例 `对 Y 进行修改` | 仍只读；`domain.test.ts:295` 仍是第十四轮改写后的 `对 docs/PLAN.md 修改`，未恢复也未逐项登记 | **未登记（W3R15-06）** |
| HTTP/Core 测试正例措辞 | `apps/daemon/test/server.test.ts:467`、`packages/core/test/artifacts.test.ts:480` 仍为 `explain … and 修复 docs/INDEX.md`（英文原例未恢复） | **测试覆盖收缩（W3R15-06）** |

**记录侧硬约束（对 Test 有直接影响）**：T23 未宣称「结构性关闭」，但其修复 1 的措辞与 T22 `:261` 的旧结论叠加，仍会让 Test 以为「条件前件已按结构关闭」。若 Test 据此设计负例，§3.2 的 31 句 A 档越权会被判为「预期只读」而漏报。

---

## 8. 新 Findings（W3R15-xx）

### W3R15-01 [P1] 前件门只关掉承接副词、未关掉并列连词：`然后/并且/同时/而且/并/and/then` 重开 W3R14-01

- **位置**：`packages/domain/src/requests.ts:288-289`（`CLAUSE_SPLIT_PATTERN` 把 `\s+(?:and|then)\s+`、`并且|然后|同时|而且|并(?=动词)` 当子句边界）、`:291-292`（`CONJUNCTION_SPLIT_PATTERN` 把它们标为 conjunction）、`:389`（`const allowed = index === 0 || clause.conjunction || previousWasRefusal;`）、`:365-374`（`suppressed` 只认词表命中）。
- **实测（我自建，未登记）**：`/tmp/w3r15/probe1-corpus.mjs` G1 **20/41**、G4 1/1；`/tmp/w3r15/probe2-http.mjs` 17 句落库授权（L2 + 1 授权行 + 1 assessment）；`/tmp/w3r15/probe3-e2e.mjs` 8 句建立真实 `backend:implementation` 写 Run（含 `packages/core/src/orchestrator.ts`）；第十四轮 hold-out 复跑 F1 **3/22 仍开**。
- **证据句**：`视具体情况，然后修改 X`、`视具体情况，并且/同时/而且/并修改 X`、`经审批，然后/并修改 X`、`看结果，然后修复 X`、`先跟你确认，然后修改 X`、`收到消息后，然后修改 X`、`走完流程，然后修改 X`、`等评估完，然后修改 X`、`视具体情况，修改 X，然后删除 Y`、`depending on the result, then update X`、`based on the review, then update X`、`given the findings, then update X`、`following the meeting, then update X`、`per the earlier note, then update X`、`approval pending, then update X`、`provided the tests pass, then update X`、`这可能有问题，然后修改 X`。
- **判别依据（同形反向）**：`视具体情况，修改 X` 只读 vs `视具体情况，然后修改 X` 授权；`经批准，然后修改 X` 只读 vs `经审批，然后修改 X` 授权；`看情况…` 只读 vs `看结果…` 授权；`待你确认…` 只读 vs `先跟你确认…` 授权；`after review, then update X` 只读 vs `depending on the result, then update X` 授权。差别只在**前件是否命中词表**，与第十三/十四轮同一根因（**形态判定退化为词表/前缀枚举**）。
- **根因**：T23 只删除了 `continues`（承接副词前缀），但 `allowed` 仍对 `clause.conjunction` 无条件放行；而 `然后/并且/同时/而且/并/and/then` 是 `splitClauses` 硬编码的连词。因此**任何未登记前件**都可用「加一个连词」重新打开——门的强度取决于前件词表，而不是前一子句的类别。
- **修复方向（结构性，与第十四轮 §10.1 建议 1 相同且必须真正落地）**：
  1. 让「允许位置」由**前一子句的类别**决定，而不是「当前子句以连词开头」：连词只应把一个**真祈使**序列化（前一子句已是命令或解释），**不应把条件/评价前件之后的命令合法化**；
  2. 具体可判据：命令合法当且仅当位于首子句、或前一子句是**真祈使/解释**且由连词引入、或前一子句是**拒绝**（唯一的纠正例外）；
  3. 若保留「连词 + 前件」组合，则必须让前件识别不再依赖词表——例如把「命令子句不得由任何非祈使子句经连词引入」作为默认拒绝，再显式白名单 `解释…并修复…` 这一种混合意图。
- **验收面**：AC-004 负例失败；`workflow.md` §1「执行消息可直接授权明确目标」被扩大到「条件句 + 连词」。

### W3R15-02 [P1] 裸 `要` 仍被剥除 + `previousWasRefusal` 过宽：情态/陈述仍产生写授权（W3R14-02 未闭合，且新增纯陈述通道）

- **位置**：`requests.ts:230-231`（`ADVERB_LEAD_PATTERN` 末尾 `(?:要)?`）、`:248`（`commandTarget` 先剥前缀再判 `NON_COMMAND_MARKERS`）、`:334`（`readClause` 的 `core` 同样已剥）、`:396`（`previousWasRefusal = matches(NEGATION_PATTERNS, clause.text)`）、`:103-107`（`NEGATION_PATTERNS` 也匹配 `不用改 X`/`不需要修改 X` 这类**陈述**）。
- **实测**：`/tmp/w3r15/probe1-corpus.mjs` G2 **5/18**、G3 **2/9**；HTTP 7 句落库授权；e2e 4 句建立真实写 Run；第十四轮 hold-out F2 **3/20 仍开**。
- **证据句**：`另外要更新 X`、`也要修改 X`、`但要修改 X`（第十四轮 §10.2 第 3 行明确列入必读清单的 `另外要更新 X` 仍授权）；**纯陈述** `目前不用改 X，也要更新 Y`、`暂时不用改 X，另外要更新 Y`、`需求里提到要修改 X，然后也要更新 Y`、`文档里写着修改 X，然后也要更新 Y`。
- **判别依据（同形反向）**：`另外需要修改 X` 只读 vs `另外要更新 X` 授权；`目前不用改 X，也需要更新 Y` 只读 vs `目前不用改 X，也要更新 Y` 授权。树中**没有任何祈使**，第二子句是「Y 也需要更新」的陈述，却被 `要` 的前缀剥离洗成裸命令。
- **根因**：T23 只把 `需要/应该/必须/得/该` 从 `ADVERB_LEAD_PATTERN` 中移除，保留了 `(?:要)?`；而 `NON_COMMAND_MARKERS` 里没有裸 `要`，`STATEMENT_PATTERNS` 又是在已剥离的 `core` 上判定的，于是 `要` 既不触发陈述守卫、也不留在核心子句里。第二个根因是 T23 新增的 `previousWasRefusal` 以 `NEGATION_PATTERNS` 为唯一判据，而该模式覆盖「不需要/不用+动词」这类**非拒绝的陈述**，使下一子句获得授权资格。
- **修复方向（结构性）**：
  1. **前缀归一不得剥 modality**：`ADVERB_LEAD_PATTERN` 只剥承接副词；`要` 仅在**紧邻前一子句是拒绝子句**时才允许剥离（即把「`但要修复 X`」并入 W3R7-03 的纠正规则），而不是无条件剥离；
  2. **拒绝子句判定收窄**：`previousWasRefusal` 不应等于 `NEGATION_PATTERNS`；应要求该子句本身**不是陈述**（例如要求否定词直接支配变更动词且子句无陈述标记），或在授权前对当前命令子句重跑 `STATEMENT_PATTERNS`/`NON_COMMAND_MARKERS` 的**原始**（未归一）文本。
- **验收面**：同 W3R15-01。

### W3R15-03 [P2] 拒绝纠正规则不完整：`不修改 Y，修改 X`、`先别改 Y，改 X` 仍只读

- **位置**：`requests.ts:103-107`（`NEGATION_PATTERNS` 只列 `不要/不用/不需要/无需/先不/暂不/…`，且裸 `别` 受 `(?<![\p{Script=Han}\w])` 限制）、`:389-396`。
- **实测**：`/tmp/w3r15/probe1-corpus.mjs` G9 **2 误拒**；HTTP 2 句 `authId=null`；e2e 2 句无写 Run；`/tmp/w3r14/probe7-prior2.mjs` W3R7-03 组 5 条中 2 条仍误拒。
- **判别依据**：第十四轮 §10.2 第 4 行明确要求 `别改 Y，改 X`、`不要改 Y，改 X`、**`不修改 Y，修改 X`**、`don't fix Y, fix X`、`不要修改 Y，但要修复 X` 全部授权；**`先别改 Y，改 X`** 亦在第十四轮 §3.3(3) 的 5 个变体清单内。前 3 条已可用，后 2 条未修。
- **性质**：fail-closed（无越权），属**已修 P1（W3R7-03）的残留回归**，且任务明确要求复核「拒绝纠正仍可用」。
- **修复方向**：与 W3R15-02 同一处结构规则——把「拒绝子句」定义为**对变更动词的直接否定**（`不/别/不要/先别` + 变更动词），而不是枚举否定词。

### W3R15-04 [P2] 多目标/多子句命令「静默部分授权」未修（W3R14-04 承接）

- **位置**：`requests.ts:288-289`（子句切分）+ `:389`（逗号后无连词的命令子句被抑制）。
- **实测**：`修改 X and Y` → `["X"]`；`delete X and Y` → `["X"]`；`修改 X，删除 Y，更新 Z` → `["X"]`；HTTP/e2e 同款（`authId` 非空、第二目标静默丢弃）。而 `修改 X 和 Y`、`修改 X、Y`、`把 X 和 Y 都改掉` 按声明整体只读。
- **性质**：授权范围是用户点名目标的**子集**（无害上界），但与 T21/T22/planVersion 2 的「多目标列表一律只读并澄清」声明冲突；Test 无法从记录判断应采用哪种口径。
- **修复方向**：统一口径——或「多目标一律只读 + 澄清」，或「各子句各自目标」，并在回归网与记录中固定。

### W3R15-05 [P2] 记录名实不符未订正并新增不准确项（W3R14-05 加重）

- **实测**：见 §7 表。要点：①T23「外置语料 40 条 0 fail-open」不可复现，第十四轮 hold-out 201 句仍 **6 fail-open**；②T23「情态词不再被剥离」与实现不符（裸 `要` 仍被剥）；③T23「新增 10 必须只读 + 3 必须授权」实测为 10 负 + 2 正；④T21/T22「11 正 + 84 负」未订正，实测 14 正 + 89 负；⑤`implementation.md:3` 仍 `planVersion: 1`；⑥`plan.md` 哈希 `8986875e` **未改动**，T21/T22/T23 的新代价与新风险均未登记；⑦`:11/:113/:140/:177/:186/:249/:261` 的「一律/永不/按结构关闭」绝对表述仍在。
- **性质**：不单独阻断，但**直接影响 Test 基线**——若 Test 以「条件前件已按结构关闭 / 情态已关闭」为前提设计负例，本轮 P1 会被判为「预期只读」而漏报。
- **建议**：把绝对表述限定为「已登记语料范围内」；把 W3R15-01/02/03/04 的实际后果写入 `plan.md`（planVersion 3）并同步 `implementation.md:3` 头；订正计数为 14 正 + 89 负；说明「结构性」仅指**命令内部文法（无尾、目标逐字）**，不含前件、连词与情态前缀。

### W3R15-06 [P3] 回归网缺口 + 正例覆盖收缩未恢复（W3R14-06/07 延续）

- **实测**：本提交新增的域断言只覆盖 `视具体情况，就修改`、`经审批，再修改`、`after review, then update`、`但需要修改`、`另外需要修改`、`修改 X，如果没问题`、`删除 Y，但是可能需要审批`、`I think…`、`需要修改，也需要修改`、`修改 X。不太明智`；`grep -rn "然后修改\|并且修改\|同时修改\|另外要更新\|也要更新\|不用改.*也要" packages/*/test apps/*/test` = **0 命中**；`Orchestrator` 仍不出现在 `apps/daemon/test/server.test.ts`、`packages/core/test/artifacts.test.ts`；`domain.test.ts:295` 仍为 `对 docs/PLAN.md 修改`（未恢复 `对 X 进行修改` 正例或登记为 fail-closed）；`apps/daemon/test/server.test.ts:467`、`packages/core/test/artifacts.test.ts:480` 的英文混合意图正例仍未恢复。
- **性质**：不阻断（P1 已由自建脚本证明），但修复后必须以回归断言固化，并恢复被收缩的正例覆盖。
- **承接**：与 W3R4-05 同项。

### W3R15-07 [P3] 协议对账与 wire 语义承接（W3R14-08 / W3R13-09 / W3R12-07 / W3R4-06/08/10/12/13 延续）

- **未知字段**：`foo`/`targetRole`/`ownerUserId` 仍 **202 静默忽略**，而 `protocol.md` §1 要求未知字段返回 `VALIDATION_ERROR`；`protocol.md:46` 把 `targetRole?:Role` 列为 `conversation.message.send` 合法参数，daemon 不读取。
- **响应形状**：响应含 `workIds`/`authorizationId`，`protocol.md:46` 只列 `{messageId,workId,state,version}`（加法扩展未对账）。
- **同批承接**：`POST /artifacts/upload` 的 multipart `projectId` 被忽略、多文件只保留最后一个；`StorageError` 映射、`targetWorkId` 归属、错误响应非 §1 封装。

---

## 9. 计数与阻断判定

| 严重度 | 数量 | 编号 | 是否阻断 |
|---|---|---|---|
| P0 | 0 | — | — |
| **P1** | **2** | W3R15-01（并列连词重开前件门）、W3R15-02（裸 `要` 洗白 + 拒绝判定过宽 → 纯陈述授权） | **阻断** |
| P2 | 3 | W3R15-03（拒绝纠正 2 句未闭合）、W3R15-04（多目标静默部分授权）、W3R15-05（记录/plan 名实不符，影响 Test 基线） | 不单独阻断，须随修复轮订正 |
| P3 | 2 | W3R15-06（回归网缺口 + 正例覆盖收缩）、W3R15-07（协议对账） | 不阻断，承接 Test |

- 两条 P1 **均落在本包验收面**：AC-004 负例被证伪、AC-005 授权边界被证伪；均以真实 HTTP + 真实 `Orchestrator` 证明可派发真实 Backend 写 Run（含源码路径）。
- 失败路由：`Blocking Review Finding → Develop → Independent Review`（`docs/rules/workflow.md` §6）。
- 前轮 P1 的本轮裁定：**W3R13-01/03、W3R13-04、W3R14-03（`别改` 面）已闭合**；**W3R14-01 部分闭合（承接副词面关闭、连词面重开 → W3R15-01）**；**W3R14-02 部分闭合（`需要` 面关闭、裸 `要` 面重开 → W3R15-02）**；W3R13-05/W3R14-06（误拒与收窄）未修并留下 W3R15-03；W3R13-06/W3R14-04（多目标）未修（→ W3R15-04）。

---

## 10. 能否进入独立 Test —— **不能**

**判据**：`docs/rules/workflow.md` §6「P0/P1 阻断」。两条 P1 中任意一条即足以阻断，且均可端到端复现。**必须先走 `Develop → Independent Review`。**

### 10.1 修复后重评的最低要求

修复轮必须做**结构性**改造（不是继续加词），并保留全部登记正例：

1. **位置规则改为「前一子句类别」判据**（修 W3R15-01）：删除对 `clause.conjunction` 的无条件放行；命令合法仅当 (a) 首子句，(b) 前一子句是**真祈使/解释**且由真并列连词引入，或 (c) 前一子句是**拒绝**（唯一纠正例外）。不得让「未登记前件 + 连词」放行。
2. **前缀归一不得剥 modality，且拒绝判定收窄**（修 W3R15-02/03）：`ADVERB_LEAD_PATTERN` 只剥承接副词，`要` 仅在「前一子句是拒绝」时剥离；`previousWasRefusal` 不能等于 `NEGATION_PATTERNS`，须排除「`不/不用/不需要` + 变更动词」的**陈述**用法；或对当前命令子句在**原始文本**上重跑 `STATEMENT_PATTERNS`/`NON_COMMAND_MARKERS`。
3. **多目标口径统一**（修 W3R15-04）：`修改 X and Y`、`delete X and Y`、`修改 X，删除 Y，更新 Z` 与中文列表采用同一口径。
4. **记录同步**（修 W3R15-05/06）：`plan.md` 升版登记本次全部新代价；订正 `implementation.md:3` 头与 14+89 计数；删除/限定绝对表述；明确「结构性」仅指**命令内部文法**，不覆盖前件、连词与情态前缀；恢复被收缩的英文/处置式正例。
5. **回归网补全**（修 W3R15-06）：把 §3.2 的全部 A 档证据句、§5 的正例、以及「授权正例 → `assess(L2)` → `dispatch(backend/implementation)` 成功 / grant 外路径与 `deploy`/`network` 拒绝」落成长期断言。

以下新增句必须只读并落成长期断言：

- **连词/前件族（W3R15-01）**：`视具体情况，然后修改 X`、`视具体情况，并且/同时/而且/并修改 X`、`经审批，然后修改 X`、`看结果，然后修复 X`、`先跟你确认，然后修改 X`、`收到消息后，然后修改 X`、`走完流程，然后修改 X`、`等评估完，然后修改 X`、`视具体情况，修改 X，然后删除 Y`、`depending on the result, then update X`、`based on the review, then update X`、`given the findings, then update X`、`approval pending, then update X`、`provided the tests pass, then update X`、`这可能有问题，然后修改 X`。
- **情态/陈述族（W3R15-02）**：`另外要更新 X`、`也要修改 X`、`但要修改 X`、`目前不用改 X，也要更新 Y`、`暂时不用改 X，另外要更新 Y`、`需求里提到要修改 X，然后也要更新 Y`。对照 `另外需要修改 X`、`目前不用改 X，也需要更新 Y` 保持只读。
- **不得回归（正例）**：登记 14 条逐句授权且 `writePaths` 只含命令自身目标；`不修改 Y，修改 X`、`先别改 Y，改 X`、`别改 Y，改 X`、`不要改 Y，改 X`、`don't fix Y, fix X`、`不要修改 Y，但要修复 X` 应授权 X；`解释 X 并修复 Y`、`explain X and fix Y`、`把 X 改掉`、`将 Y 删除`、`对 Y 修改`、`修改 X。谢谢`。
- **已声明 fail-closed（断言只读，不算缺陷）**：`修改 X 中的错别字`、`fix the typo in X`、`把 X 里的错别字改掉`、`对 X 进行修改`（若保持只读则必须登记）、`X 的错别字麻烦处理下`、`重写/润色/polish`、`修改 X、Y`、`修改 X 而不是 Y`。
- **B 档待产品口径（先登记，再决定收窄）**：`X 已被修改，然后更新 Y`、`修复 X 已经完成了，然后更新 Y`、`需求里提到要修改 X，然后更新 Y`、`文档写着修改 X，然后更新 Y`。

### 10.2 Test 最小覆盖矩阵（修复轮后必须覆盖）

| # | 维度 | 最小用例（≥） | 期望 |
|---|---|---|---|
| 1 | 前件 + **连词**（W3R15-01） | `视具体情况，然后/并且/同时/并修改 X`、`经审批，然后修改 X`、`看结果，然后修复 X`、`depending on the result, then update X` 各 1 | 全部只读，零授权行 |
| 2 | 前件 + 承接副词（回归） | `视具体情况，就/再/也/但修改 X`、`经审批，再修改 X` 各 1 | 只读 |
| 3 | 情态裸 `要`（W3R15-02） | `另外要更新 X`、`也要修改 X`、`但要修改 X` 各 1；对照 `另外需要修改 X` 只读 | 全部只读 |
| 4 | 纯陈述 + 拒绝 + `要`（W3R15-02） | `目前不用改 X，也要更新 Y`、`暂时不用改 X，另外要更新 Y`、`需求里提到要修改 X，然后也要更新 Y` 各 1 | 只读 |
| 5 | 否定后纠正（W3R15-03） | `别改 Y，改 X`、`不要改 Y，改 X`、`不修改 Y，修改 X`、`先别改 Y，改 X`、`don't fix Y, fix X`、`不要修改 Y，但要修复 X` 各 1 | 授权且写范围仅 X |
| 6 | 后置条件（回归） | `修改 X，如果没问题`、`修改 X，一旦确认`、`修改 X，但是可能需要审批` 各 1 | 只读，零授权行 |
| 7 | 多目标口径（W3R15-04） | 中文列表 / `and` / 处置式三种多目标表达 | 与记录声明一致的单一口径 |
| 8 | 目标优先关闭（回归） | 16 谓词 × ≥2 动词 | 只读 |
| 9 | 尾巴/选择/条件复位（回归） | 第十三/十四轮登记负例 | 只读，零授权行 |
| 10 | 处置式/混合/排除 | `把 X 改掉`、`解释 X 并修复 Y`、`explain X and fix Y`、`修改 Y 而不是 X` | 授权且写范围仅目标；排除式只读 |
| 11 | 登记语料 | 14 正 + 89 负 | 逐句成立 |
| 12 | HTTP 端到端（≥3 句/族） | 上述 1/3/4/5 组经 `POST conversation.message.send` | `authorizationId=null`、`level=none`、零授权行、无 `delivery` Work |
| 13 | **Orchestrator 回归（仍未闭合）** | 授权正例 `assess(L2)` → `dispatch backend/implementation` 成功；grant 外路径 + `deploy`/`network` → `NOT_AUTHORIZED` | 建 Run / 拒绝 |
| 14 | 注入面不回归 | `workItems/works/authorization/grants/scope/level/intent/targetRole/ownerUserId` 注入 | 全部忽略且零授权（未知字段按 W3R15-07 决定后断言） |
| 15 | 前轮 P0/P1 | 下载 token 一次性、预览 ACL/CSP 逐字、`assertGrantWithinMessage`、跨会话 `targetWorkId`、追发不改写 Work | 无回归（`probe6` 17/17 已通过） |
| 16 | 附件/产物面 | 上传限制/TTL/重复绑定、版本链/失效、预览截断、单次下载 | 无回归（本轮未动，抽验即可） |

### 10.3 残余风险清单（区分已登记与未登记）

**A. 未登记缺陷 —— 必须修（P1 阻断；P2/P3 随修复轮订正）**
1. W3R15-01 前件门未覆盖并列连词（20 句 A 档；HTTP 17、e2e 8，含源码路径）。
2. W3R15-02 裸 `要` 洗白 + 拒绝判定过宽（7 句；HTTP 7、e2e 4，含纯陈述）。
3. W3R15-03 拒绝纠正 `不修改 Y，修改 X`、`先别改 Y，改 X` 仍只读（fail-closed）。
4. W3R15-04 多目标/多子句静默部分授权。
5. W3R15-05 记录/plan 名实不符（含不可复现的「40 条 0 fail-open」）。
6. W3R15-06 回归网缺口与正例覆盖收缩。
7. W3R15-07 协议对账与 wire 语义。

**B. 已登记 fail-closed 代价 —— 已登记，接受并需 Test 承认**
8. 未登记同义祈使（`重写/润色/rewrite/polish/tweak`）→ 只读 + 澄清（`plan.md:17-18`）。
9. 名词短语祈使（`修改 X 中的错别字`、`fix the typo in X`、`把 X 里的错别字改掉`、`对 X 进行修改`、`更新 X 的说明`）→ 只读 + 澄清（T21/T22 概括声明）。
10. 目标优先日常祈使（`X 的错别字麻烦处理下`）→ 只读 + 澄清（T19/T20/T21）。
11. 多目标中文列表与排除式（`修改 X、Y`、`修改 X 而不是 Y`、`update X instead of Y`）→ 只读 + 澄清（英文 `and` 与处置式口径不一致，见 W3R15-04）。
12. 标记子串导致路径名/复合词误拒（`过时/会议/了解/a-or-b/no-index/yes-notes`）→ 只读（W3R13-05，方向安全）。
13. **B 档（待产品口径）**：陈述子句 + 显式祈使的混合句（`X 已被修改，然后更新 Y` 等）当前授权；已登记为本轮观察，须由产品/Test 决定是否收窄。
14. 语义分类的最终责任在 WP-04/06 模型 Assessment；本包只承诺已登记语料与形态规则。

**C. 与本包无关或已承接**
15. W3R15-06/07 与 W3R4-05/06/08/10/12/13、W3R13-08/09 同项（P3，结算前登记或修复）。
16. 真实无头浏览器攻防（WP-10）；真实 Provider 纵向与 `artifact_write` 工具接线（WP-10/WP-07）。

---

## 11. 方法与边界声明

- **独立上下文**：未读取任何开发/Test 会话；结论只来自仓库文件、`docs/**` 契约与我自建的 5 个脚本（`/tmp/w3r15/probe1-corpus.mjs` 143 句、`probe2-http.mjs` 45 句真实 HTTP、`probe3-e2e.mjs` 28 句真实 Orchestrator、`probe4-registered.mjs` 登记语料文本提取、`probe5-contrast.mjs` 同形反向对照）+ 只读复用 `/tmp/w3r14/probe1-corpus.mjs`（201 句 hold-out）、`probe5-injection.mjs`（11 注入）、`probe6-prior.mjs`（17 项前轮 P0/P1）、`probe7-prior2.mjs`（23 项定向）、`/tmp/w3r13/probe8-scope.mjs`（29 项作用域），全部消费 `pnpm build` 产物；**未 import 任何产品测试文件**（`domain.test.ts` 仅以文本方式用引号感知的 tokenizer 提取语料，提取后逐句用**构建产物**复跑）。
- **实验统计（观测 / 缺陷证据）**：

| 脚本 | 观测 | 缺陷证据 | 对应 |
|---|---|---|---|
| `probe1-corpus.mjs`（自建） | 143 句（12 族） | **31 A 档 FAIL-OPEN + 3 PARTIAL + 2 FALSE-REJECT + 7 B 档** | W3R15-01/02/03/04 |
| `probe2-http.mjs`（自建） | 45 句真实 HTTP | **24 句非命令落库授权**（L2 + 1 授权行 + 1 assessment）；登记负例 12/12 只读、正例 8/8 授权、纠正正例 2 误拒 | W3R15-01/02/03/04 |
| `probe3-e2e.mjs`（自建） | 28 句真实 Orchestrator | **14 句非命令各建立真实 `backend:queued` 写 Run**（含 `packages/core/src/orchestrator.ts`）；2 误拒 | W3R15-01/02/03 |
| `probe4-registered.mjs`（自建） | 登记 14 正 + 89 负 | **0 偏差**（记录称 11 + 84 → W3R15-05） | 回归网 |
| `probe5-contrast.mjs`（自建） | 7 组同形反向 | 全部「只读 vs 授权」成对差异，证明词表依赖 | W3R15-01/02 |
| `/tmp/w3r14/probe1-corpus.mjs`（复用） | 201 句第十四轮 hold-out | **6 FAIL-OPEN + 2 PARTIAL**（F1 3、F2 3、F7 2）；其余族 0 | W3R15-01/02/04 |
| `/tmp/w3r14/probe5-injection.mjs`（复用） | 11 注入项 | 0 授权行、0 越权 Work；未知字段静默忽略 | §6.1, W3R15-07 |
| `/tmp/w3r14/probe6-prior.mjs`（复用） | 17 项前轮 P0/P1 | **17/17 通过** | §6.2 |
| `/tmp/w3r14/probe7-prior2.mjs`（复用） | 23 项定向复核 | 2 误拒（W3R7-03 族）、1 非缺陷（尾 `-`）、其余通过 | W3R15-03 |
| `/tmp/w3r13/probe8-scope.mjs`（复用） | 29 项作用域/边界 | **0 扩张**；3 项部分授权 | §4, W3R15-04 |

- **对开发方 T23 主张的裁决**：**部分成立**。「后置条件抑制」「`需要` 情态归零」「`别改 A，改 B` 纠正可用」「承接副词通道归零」均为可复核的真实改善（第十四轮 41 → 6 fail-open）；但「前件门」只关掉了承接副词、没有关掉并列连词，「情态词不再被剥离」漏掉了裸 `要`，且新增的 `previousWasRefusal` 以 `NEGATION_PATTERNS` 为判据而把非拒绝陈述也放进了纠正通道。同形反向对照（`经批准，然后修改 X` 只读 vs `经审批，然后修改 X` 授权；`另外需要修改 X` 只读 vs `另外要更新 X` 授权）再次证明根因仍是**形态判定退化为词表/前缀枚举**，因此本轮仍判 **FAIL**。
- **未做**：真实无头浏览器执行、真实 Provider 纵向、Docker 容器内复验、故障注入下的孤儿 blob 复验、`pnpm test:e2e`/`test:acceptance`（脚本按设计指向 WP-09/WP-10，未实现）。
- **未改仓库**：本轮只覆盖写入 `.agentdev/work/WP-03/review.md`（本报告）；除该文件外 `git status --porcelain` 为空，`HEAD` 仍为 `351b851a02a7d62349506646e5b562d19c059882`（代码树 `d2e4ff5`），全部 6 条契约命令在上述工作树上执行。

---

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

## 附十四：第十四轮摘要（保留）

第十四轮（报告冻结于 `351b851`，**被审代码树 `f40d634`**，第十四轮修复提交为 `d2e4ff5`）结论 **FAIL（0×P0、3×P1、2×P2、3×P3）**：

- **W3R14-01 [P1]** 「前件规则」被承接副词/连词绕过：未登记前件 + `就/再/也/但/然后/and then` 继续产生写授权（F1 20/22 + 纯陈述 F1b 8/8；HTTP 31/40、e2e 20/20 可写，含源码路径）——**第十五轮判定：承接副词面已关闭（`就/再/也/但` 归零）；并列连词面重开（`然后/并且/同时/而且/并/and/then` 20 句）→ W3R15-01**。
- **W3R14-02 [P1]** `ADVERB_LEAD_PATTERN` 的可选情态词把陈述句洗成命令（`但需要修改 X`、`就需要修改 X`、`另外要更新 X` 等 13 句）——**第十五轮判定：`需要/应该/必须/得/该` 面已关闭；裸 `要` 面仍开（`另外要更新 X`、`也要修改 X`、`但要修改 X`）并新增纯陈述通道 → W3R15-02**。
- **W3R14-03 [P1]** 否定后纠正（W3R7-03 已修 P1）回归为只读（`别改 Y，改 X` 等 5 变体）——**第十五轮判定：`别改`/`不要改`/`don't fix` 3 变体已闭合；`不修改 Y，修改 X`、`先别改 Y，改 X` 仍只读 → W3R15-03**。
- **W3R14-04 [P2]** 多目标/多子句「静默部分授权」（`修改 X and Y` → 仅 X）——**第十五轮仍未修（→ W3R15-04）**。
- **W3R14-05 [P2]** 记录名实不符：T22「按结构关闭」被证伪、计数 11/84 实测 12/79、`planVersion` 头未同步、`plan.md` 未改动、绝对表述仍在——**第十五轮仍未订正并新增不准确项（→ W3R15-05）**。
- **W3R14-06 [P3]** 处置式轻动词与名词短语祈使的 fail-closed 收窄未逐项登记 + 测试被悄悄改写（`对 X 进行修改` → `对 X 修改`）——**第十五轮仍未恢复（→ W3R15-06）**。
- **W3R14-07 [P3]** 回归网缺口与正例覆盖收缩（无 Orchestrator 授权用例；英文混合意图正例改中文）——**第十五轮仍在（→ W3R15-06）**。
- **W3R14-08 [P3]** 协议对账与 wire 语义承接（未知字段 202 静默忽略等）——**第十五轮仍在（→ W3R15-07）**。
- 第十四轮以自建 7 个脚本（`/tmp/w3r14/probe1..7`）+ 复用脚本取证：201 句 hold-out 41 FAIL-OPEN + 2 PARTIAL + 1 FALSE-REJECT；HTTP 31/31 A 档落库授权；真实 Orchestrator 20/20 建立写 Run；登记 12 正 + 79 负 0 偏差；客户端注入 0 通路；前轮 P0/P1 16/17（否定后纠正回归）。
- 第十四轮判定的共同根因：**「形态判定退化为词表/前缀枚举」**——前件是否构成门取决于是否命中 `CONDITION/PRECONDITION` 词表且命令子句恰好以 `但/也/再/就/则` 开头；`需要/要` 在判定前被前缀归一剥除。第十五轮证明该根因未消除，只是换了两个通道（并列连词与裸 `要`）。
