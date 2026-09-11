# WP-03 独立 Review 报告（第十八轮）

- 评审对象：工作包 WP-03「直接协作与说明产物」
- 评审轮次：**第十八轮**（第一～十六轮摘要见「附一～附十六」，第十七轮报告全文见「附十七」，全部保留）
- 冻结点 / HEAD：`git rev-parse HEAD` = `b3624cb306276c47de70809db852f51e54fcd601`（= 任务下达的 `b3624cb`，**无漂移**）
- 工作树：全部契约命令执行前后 `git status --porcelain` 为空；除本报告外无未提交修改
- 评审角色：Review（独立上下文；未读取任何开发/Test 会话；只依据仓库文件、契约文档与我自建的 `/tmp/w3r18/` 6 个脚本 + 只读复用 `/tmp/w3r17|w3r16|w3r15|w3r14|w3r13/` 的 12 个脚本）
- 工具：`node v24.8.0`、`pnpm 12.3.4`、macOS 宿主；全部脚本消费 `pnpm build` 产物（`packages/domain/dist`、`packages/core/dist`、`apps/daemon/dist`、`packages/storage/dist`），**未 import 任何产品测试文件**（`domain.test.ts` 仅以文本方式提取语料）
- 记录哈希（`git hash-object`，前 8 位）：`packages/domain/src/requests.ts` **`04178753`**（第十七轮 `2f5ad35c`）、`packages/domain/test/domain.test.ts` **`61d8e5e5`**（第十七轮 `9505c791`）、`apps/daemon/src/server.ts` `3a348304`、`packages/core/src/messages.ts` `283d4c04`、`packages/core/src/preview.ts` `803b502a`、`packages/core/src/artifacts.ts` `057ff403`、`packages/core/src/attachments.ts` `3ee94838`（后五个文件与第十三～十七轮**逐字相同**）、`.agentdev/work/WP-03/plan.md` **`6c85bb2e`**（第十七轮 `8986875e`，本轮**已改动**）、`.agentdev/work/WP-03/implementation.md` `ccf747ea`（第十七轮 `682e93ab`）
- 变更范围（`git diff --numstat 87f50e4 HEAD`）：`3ed2434`（`requests.ts` +43/−14、`domain.test.ts` +81/−1、`plan.md` +17/−3、`implementation.md` +25/−2）；`b3624cb` 只改 `review.md`（第十七轮报告落库）。`packages/core/src/**`、`apps/daemon/src/**`、`docs/**` **零改动**
- 权威依据：`AGENTS.md`、`docs/INDEX.md`、`docs/rules/{workflow,agents}.md`、`docs/product/experience.md`（§3）、`docs/architecture/{data,protocol,execution,reliability}.md`、`docs/delivery/{implementation,acceptance}.md`（AC-001..006/052/076/084）、`.agentdev/work/WP-03/{plan,implementation,review}.md`、`packages/**`、`apps/daemon/**`、相关测试

---

## 1. 结论

**FAIL（不能进入独立 Test；按 `docs/rules/workflow.md` §6 走 `Blocking Review Finding → Develop → Independent Review`）。**

本轮判 **FAIL（0×P0、1×P1、2×P2、2×P3）**。

**第十七轮登记的各项修复基本成立，但 fail-open 方向仍未闭合：第十七轮 P1 的根因（「含否定的非命令子句」未按类别关闭）在本轮换了一个词法面继续存在。**

- **成立的部分（可复核的真实改善）**：
  - **第十七轮 P1（W3R17-01）语境面闭合**：§4.3 的 13 句及其同形变体（本报告 §4：route 36 例、真实 HTTP 20 例）在本轮 build 上 **route 只读 + 真实 HTTP 零授权行 + 零写 Run**；第十七轮为 13/13 越权。
  - **W3R17-02 闭合**：`但修改 X`、`但是修改 X`、`而是要更新 X`、`但更新 X`、`不过修改 X` 全部只读（`probe1-failopen` adversative-lead 20/20）。
  - **W3R17-03 闭合**：`不修改 Y，修改 X`、`先别改 Y，改 X`、`先解释 X，然后修改 Y` **均授权**（真实 HTTP L2 + assist/delivery 双 Work，写范围仅命令目标）；误拒归零。
  - **多目标口径统一**：`修改 X，删除 Y，更新 Z` → 三目标全部授权（HTTP 写范围 3），path-list-only（`修改 X、Y`、`修改 X 和 Y`）整条只读。
  - **加性/首连词片段**：`也/再/然后/同时/另外/顺便/并且/而且/并/就/则` 开头 30 例全部只读；领起拒绝 + 加性接续 18 例只读。
  - **写范围无扩张**：`probe1` 1 317 例 **0** 例授权路径非消息点名路径；`/tmp/w3r17/probe4-scope` 授权路径 **102/102 ⊆ 消息点名路径**；仓库外目标 5/5 只读不 500。
  - **登记语料零回归**：文本提取 14 正 + 8 拒绝纠正接续 + 3 多命令 + 137 负，逐句复跑 **0 偏差**（`probe4-registered`，162 例）。
  - **前轮 P0/P1 无回归**：`/tmp/w3r14/probe6-prior.mjs` **17/17**；注入面 **0 通路**（11 项）；`/tmp/w3r16/{probe1,probe2}` FAIL-OPEN 0。
- **不成立的部分（本轮 P1）**：
  **「否定出现在子句非起始位置」只按固定词表识别**。`reportedNegation` 要求 `NEGATION_PATTERNS`（`requests.ts:121-125`）命中，而该词表 ① 用 `(?<![\p{Script=Han}\w])别` 把**任何汉字符号后的 `别`** 排除，② 只登记了一组变更动词（`改|修改|动|碰|删|移除|更新|添加|新增|实现|修复|重命名|重构|调整|处理|补`），**不含** `重写/优化/完善/清理/整理/替换`。于是 `说明别改 Y，然后修改 X`、`解释别重写 Y，然后修改 X`、`梳理不要优化 Y，然后修改 X`、`修改 X，说明别改 Y` 等句式**不被判为「含否定的非命令子句」**；这些子句又因第十七轮新放的**解释领起豁免**（`EXPLANATION_LEAD_PATTERN` 现允许 `先|优先`）而不触发类别抑制，并列连词命令因此重获写授权。`probe2b` 385 组合中 **90 组越权**（9 个解释领起 × 10 个否定措辞），`probe2` 573 句中 **386 句越权**；`probe3-live` 其中 13 句在**真实 HTTP** 上落库 `authorizationId` + 1 授权行 + `level=L2` + 1 assessment，并经**真实 `Orchestrator`** 建立真实 `backend:implementation:queued` 写 Run（含 `packages/core/src/orchestrator.ts` 源码路径）。
  这是 `plan.md` planVersion 3 §23「**子句含否定式但否定不领起 ⇒ 整条消息不授权**」的直接反例；同形对照 `说明不要修改 Y，然后修改 X`（只读）vs `说明别改 Y，然后修改 X`（授权）证明根因是**否定识别词表**，不是类别规则本身。
- **修复引入的新面（实证）**：以 `87f50e4` 的 `requests.ts` 源码副本（Node 类型剥离，未改仓库）对照，`先说明别改 Y，然后修改 X` 在第十七轮修复**前**只读、**后**授权——`EXPLANATION_LEAD_PATTERN` 新增 `先|优先` 扩大了豁免面；`说明别改 Y，然后修改 X`、`解释别重写 Y`、`修改 X，说明别改 Y` 则在修复前后**都**授权（第十七轮未登记、未闭合的同类残余）。

本结论落在本包验收面（AC-004 负例、AC-005 授权边界、`plan.md` planVersion 3 §17/§23），**以真实 HTTP + 真实 Orchestrator 端到端可复现**，阻断 Test。

| 维度 | 第十七轮 | 第十八轮 |
|---|---|---|
| 否定式陈述/报告/前提（无标记） | 13 句开（W3R17-01，P1） | **归零（闭合）** |
| 解释领起句内**未识别**的否定（`别`+汉字符号前缀、未登记否定动词、英文 `ban/should not`） | 未单列（同类残余） | **13 句真实 HTTP 开（W3R18-01 新 P1；词法组合 90/385）** |
| 逆接连词片段 `但修改 X` | 授权（W3R17-02） | **归零（闭合）** |
| 拒绝纠正 `不修改 Y，修改 X` / `先别改 Y，改 X` / `先解释 X，然后修改 Y` | 误拒（W3R17-03） | **归零（闭合）** |
| 逗号多子句静默部分授权 | 部分授权（W3R17-03） | **归零（全目标授权）** |
| 拒绝 + 加性接续（`也/再/顺便`） | 只读 | **只读（保持）** |
| 拒绝 + 并列连词（`然后/并且/而且/同时`） | 授权 | **授权（保持）** |
| 礼貌领起（`谢谢，修改 X` vs `谢谢，然后修改 X`） | 口径不一致 | **仍不一致（W3R18-02）** |
| 写范围超出命令目标 | 未发现 | **未发现（0/1317 + 102/102 包含）** |
| 客户端注入面 | 无通路 | **无通路（11 项）** |
| 仓库外目标 | 只读不 500 | **只读不 500（保持）** |
| 前轮 P0/P1 | 17/17 | **17/17（保持）** |

---

## 2. 契约命令原始结果（冻结树 `b3624cb`，`/tmp/w3r18/contract.log`）

| 命令 | 结果 | 关键输出 |
|---|---|---|
| `pnpm typecheck` | **exit 0** | 无诊断 |
| `pnpm lint` | **exit 0** | 无告警 |
| `pnpm test:unit` | **exit 0** | `Test Files 19 passed (19)`、`Tests 289 passed (289)`、3.71s |
| `pnpm test:integration`（真实 Docker） | **exit 0** | `Test Files 10 passed (10)`、`Tests 124 passed (124)`、43.51s |
| `pnpm docs:check` | **exit 0** | 15 docs / 55 links / 94 AC / 9 REQ / 11 WP 全部成立 |
| `pnpm build` | **exit 0** | 8 workspace 全部构建成功 |

未执行（按设计属 WP-09/WP-10，脚本 `NOT_IMPLEMENTED`）：`test:e2e`、`test:acceptance`、`test:live`。

---

## 3. 本轮评审脚本清单与规模（全部消费构建产物）

| 脚本 | 规模 | 覆盖 |
|---|---|---|
| `/tmp/w3r18/probe1-failopen.mjs` | **1 317 例**（生成式交叉积） | 报告/前提框架 × 否定 × 接续、17 轮 13 句同形变体、同形异义词（`别人/别的/分别/特别/识别/错别字`）、裸 `不`+动词、`先别/不要立刻/马上/急着`、拒绝+加性/连词、逆接连词、首连词、礼貌领起、多子句链、已登记 fail-closed 代价；含写范围恒等断言 |
| `/tmp/w3r18/probe2-frame-hole.mjs` | **573 句** | 解释领起（12 词）× 否定（7 词）× 接续（6 词）+ 英文变体 |
| `/tmp/w3r18/probe2b-negation-gap.mjs` | **385 组合** | 解释领起（11）× 否定措辞（35），并给同形报告框架对照 |
| `/tmp/w3r18/probe2c-variants.mjs` | 10 句 | 否定在**后置**子句的变体（`修改 X，说明别改 Y`） |
| `/tmp/w3r18/probe3-live.mjs` | **71 例**（真实 HTTP + 真实 Orchestrator） | 授权行 / Work `level`/`intent`/`scope.writePaths` / assessment / `assess`→Chief→`backend:implementation` Run |
| `/tmp/w3r18/probe4-registered.mjs` | **162 例**（文本提取） | 登记语料复跑 + 记录计数核对 |
| `/tmp/w3r18/pre-check.mjs` + `pre-requests.ts` | 7 句 | `87f50e4` 源码副本对照（修复前后差异，未改仓库） |
| 只读复用（12 个） | 见 §8 | `w3r14/probe6-prior`、`probe5-injection`、`w3r16/probe7-escape`、`probe1-corpus`、`probe2-launder`、`probe3-smuggle`、`w3r15/probe1-corpus`、`w3r14/probe1-corpus`、`w3r17/probe2-framing`、`probe4-scope`、`w3r13/probe7-registered`、`probe8-scope` |

---

## 4. 第十七轮 P1（W3R17-01）闭合复核 —— **闭合**

**（a）routeMessage（`probe1-failopen` / `probe2-framing`）**：第十七轮 §4.3 的 13 句 + §4.3 同形反向对照中的 `如果不要修改 X`/`assuming you never update X`，以及 7 类同形变体（逗号/`并`/`但`/`同时`/`也`/句号/源码路径）共 36 例，**全部只读**；第十七轮 `probe2-framing.mjs`（31 句）复跑 **0 偏差**。

**（b）真实 HTTP + 真实 Orchestrator（`probe3-live`，20 例 R17-closure）**：全部 `http=202`、`writes=[]`、`authId=null`、`level=["none"]`、`assess=0`、`runs=[]`。对照第十七轮：13 句全部 `L2 + 1 授权行 + 1 assessment + backend:implementation:queued`。

**（c）机制核对**：`refusal` 现要求 `REFUSAL_HEAD_PATTERN`（否定标记领起且后接变更动词）成立（`requests.ts:405-406`、`:412-415`），未领起的否定由 `reportedNegation`（`:449-452`）抑制整条消息。`报告说/文档写着/需求里写着/评审说/规则要求/它说/工单里写着/在你…的前提下/由于/既然` 与英文 `the report says/provided that/given that` 均不再被当作「用户拒绝」。

**（d）长期断言**：`domain.test.ts` 已把该族 15 句落入 must-not 语料（`报告说不要修改` ×4、`文档写着不要修改` ×1、`在你不要修改` ×2、`the report says don't` ×1、`provided that you don't` ×1 等），`grep` 命中非零，**第十七轮 P3（零断言）在本族闭合**。

---

## 5. 本轮 P1 实证（W3R18-01）：解释领起豁免 + 否定识别词表缺口 = 写授权重开

### 5.1 词法组合面（route 层）

`probe2b-negation-gap.mjs`（385 组合）：9 个解释领起（`说明/解释/描述一下/梳理/分析/讲讲/介绍一下/帮我解释/先说明`）× 10 个**未被识别**的否定措辞 ⇒ **90 组越权**；同形**报告框架**（`报告说<同一否定> Y，然后修改 X`）**全部只读**——证明缺口只出现在「子句被类别豁免（解释领起）+ 否定未识别」这一交面。

未被识别的否定措辞（两族）：

- **`别` + 汉字符号前缀**（`(?<![\p{Script=Han}\w])别` 因前一个字符是汉字，把 `说明别`、`解释别`、`报告说别` 中的 `别` 一并排除）：`别改`、`别重写`、`别动`、`别碰`；
- **未登记变更动词**（`NEGATION_PATTERNS` 只列 `改|修改|动|碰|删|移除|更新|添加|新增|实现|修复|重命名|重构|调整|处理|补`）：`不要重写`、`不要优化`、`不要完善`、`不要清理`、`不要整理`、`不要替换`。

`probe2-frame-hole.mjs`（573 句）：越权 386 句，另含英文 `explain the ban on updating Y, then update X`（`should not/ban/must not/no changes` 不在英文否定词表内）。

### 5.2 后置变体（更直接的反例）

`probe2c`：`修改 docs/INDEX.md，说明别改 docs/PLAN.md` → **授权 `docs/INDEX.md`**；同形对照 `修改 docs/INDEX.md，说明不要修改 docs/PLAN.md` → **只读**。差别只在否定措辞。

### 5.3 真实 HTTP + 真实 Orchestrator（`probe3-live`，13 例）

| 证据句 | HTTP | Work / 授权 | 真实 Run |
|---|---|---|---|
| `说明别改 docs/PLAN.md，然后修改 docs/INDEX.md` | 202 | `level=["L2","none"]`、`intent=["delivery","assist"]`、`writes=["docs/INDEX.md"]`、`authId=yes`、`assess=1` | `backend:implementation:queued` |
| `说明别改 docs/PLAN.md，然后修改 packages/core/src/orchestrator.ts` | 202 | 同上，写范围为**源码路径** | `backend:implementation:queued` |
| `解释别重写 docs/PLAN.md，然后修改 docs/INDEX.md` | 202 | 同上 | `backend:implementation:queued` |
| `先说明别动 docs/PLAN.md，然后修改 docs/INDEX.md` | 202 | 同上（**修复引入的新面**） | `backend:implementation:queued` |
| `梳理不要优化 docs/PLAN.md，然后修改 docs/INDEX.md` | 202 | 同上 | `backend:implementation:queued` |
| `分析别碰 docs/PLAN.md，然后删除 docs/DESIGN.md` | 202 | `writes=["docs/DESIGN.md"]` | `backend:implementation:queued` |
| `帮我解释不要替换 docs/PLAN.md，然后修改 docs/INDEX.md` | 202 | 同上 | `backend:implementation:queued` |
| `讲讲不要整理 docs/PLAN.md，然后修改 docs/INDEX.md` | 202 | 同上 | `backend:implementation:queued` |
| `explain the ban on updating docs/PLAN.md, then update docs/INDEX.md` | 202 | 同上 | `backend:implementation:queued` |
| `修改 docs/INDEX.md，说明别改 docs/PLAN.md` | 202 | 同上 | `backend:implementation:queued` |
| `修改 docs/INDEX.md，解释不要优化 docs/PLAN.md` | 202 | 同上 | `backend:implementation:queued` |
| `先修改 docs/INDEX.md，然后说明别改 docs/PLAN.md` | 202 | 同上 | `backend:implementation:queued` |
| `修改 docs/INDEX.md。说明别改 docs/PLAN.md` | 202 | 同上 | `backend:implementation:queued` |

对照（同批、同 harness）：`修改 X，说明不要修改 Y` 与 `修改 X，报告说别改 Y` **只读**（`authId=null`、零授权行、零 Run）。全批 71 例 **误拒 0、写范围不符 0**。

### 5.4 修复前后对照（`87f50e4` 源码副本 + Node 类型剥离，**未改仓库**）

| 句式 | `87f50e4`（修复前） | `b3624cb`（本轮） |
|---|---|---|
| `报告说不要修改 Y，然后修改 X` | 授权（第十七轮 P1） | **只读** |
| `说明不要修改 Y，然后修改 X` | 授权 | **只读** |
| `先说明别改 Y，然后修改 X` | **只读** | **授权（修复引入）** |
| `说明别改 Y，然后修改 X` | 授权 | 授权（**未闭合的同类残余**） |
| `解释别重写 Y，然后修改 X` | 授权 | 授权（**未闭合**） |
| `修改 X，说明别改 Y` | 授权 | 授权（**未闭合**） |
| `不要修改 Y，然后修改 X` | 授权（登记正例） | 授权（保持） |

### 5.5 危害上界与修复方向

- **危害上界**：越权范围恒等于句中**被并列连词命令点名的那一个路径**（`operations=['read','edit']`、`networkTargets=[]`）；`probe1` 1 317 例 **0** 例写范围非消息点名路径，`/tmp/w3r17/probe4-scope` 102/102 包含成立。目标不限 `docs/`：源码路径同样可授权并建立真实 `backend:queued` 写 Run。属 `workflow.md` §6 的 P1（AC-004 负例失败 + AC-005 边界被 `plan.md` planVersion 3 §23 的登记口径证伪）；无环境/网络/数据删除通路，不构成 P0。
- **修复方向（建议，未改仓库）**：
  1. **否定识别按结构而非词表**：把 `别` 的 `(?<![\p{Script=Han}\w])` 全面否定前缀改为「`别` 后紧跟变更动词（或 `再/去/来/…` + 变更动词）即视为否定」，同时保留 `错别字/识别/特别/分别/别人/别的` 不被误判（可用这些复合词的后缀做负向断言而非前缀 lookbehind）；
  2. **否定动词表与命令动词表对齐**：`NEGATION_PATTERNS` 的动词分支改用 `VERB_GROUP`（含 `重写/优化/完善/清理/整理/替换/改成/改掉/…`），使「未登记同义变更词在命令侧 fail-closed、在否定侧可识别」；
  3. **英文否定词表补齐**：`should not|must not|cannot|can't|avoid|refrain from|ban|no changes|prohibited`；
  4. **解释领起豁免加条件**：`explanationLead` 子句**不含任何否定式**时才可豁免类别抑制；`先|优先` 的放行不得扩大可达面；
  5. **长期断言**：把 §5.3 的 13 句 + §5.1 的 90 组语料中每族至少 3 条落入 `domain.test.ts` must-not 语料，并补 Orchestrator 级回归（授权正例 `assess(L2)`→`dispatch backend/implementation` 成功；上述族不得建 Run）。

---

## 6. 第十七轮 P2/P3 口径替换复核

| 第十七轮要求 | 实测 | 结论 |
|---|---|---|
| W3R17-01:13 句落成长期断言 | `domain.test.ts` must-not 语料命中（`报告说不要修改` ×4 等） | **已闭合** |
| W3R17-02:`但修改 X`/`但是修改 X` 定口径 | 全部只读；`plan.md` planVersion 3 §29 已登记；`谢谢，然后修改 X` 仍授权 | **半闭合 → W3R18-02** |
| W3R17-03:`不修改 Y，修改 X`、`先别改 Y，改 X`、`先解释 X，然后修改 Y` 授权 | 三句均授权，写范围仅命令目标；`先解释 X，然后修改 Y` 为 assist+delivery 双 Work | **已闭合** |
| W3R17-03:统一逗号/`and`/处置式多目标口径 | `修改 X，删除 Y，更新 Z` → 3 目标；`修复 X，删除 Y` → 2 目标；`修改 X、Y`/`修改 X and Y` 只读；`plan.md` §31 已登记单一规则 | **已闭合** |
| W3R17-04:`plan.md` 升 planVersion 3 并登记 T21–T26 代价 | `plan.md:3` = `planVersion: 3`，§20-32 登记拒绝类别、未领起否定、纠正口径、逆接连词、`先` 解释领起、多目标、fail-closed 代价 | **已闭合** |
| W3R17-04:`implementation.md` 头同步 | `implementation.md:3` = `planVersion: 3`，文首「记录口径订正」块限定历史绝对表述 | **已闭合** |
| W3R17-04:删除/限定不可复现的「外置语料 40 条」 | 订正块第 2 条明确「`/tmp` 脚本不在仓库、不可复现」，并给出仓库内可复现计数 | **已闭合（计数本身不准 → W3R18-03）** |
| W3R17-04:订正陈旧 `../` 待办 | 订正块第 3 条改为「只读 + 澄清，HTTP 202、零授权行、无 500」，实测一致 | **已闭合** |
| W3R17-05:恢复 `对 X 进行修改` 与英文混合意图正例覆盖 | must-not 含 `对 docs/PLAN.md 进行修改`；must-authorize 含 `对 docs/PLAN.md 修改`；HTTP 英文混合意图正例 `explain Z and fix Y` 授权 | **已闭合** |
| W3R17-05:补 Orchestrator 级授权回归用例 | `grep -rln orchestrator packages/*/test apps/*/test` 仅 `core/test/{join,orchestrator}.test.ts`（WP-02 既有），**无「消息授权 → assess → dispatch backend/implementation」产品用例** | **未闭合 → W3R18-04** |
| W3R17-06:协议对账（未知字段、`workIds`/`authorizationId`） | 未知字段 `foo`/`targetRole`/`level`/`intent`/`authorization` 仍 **202 静默忽略**；响应仍含 §5 未列的 `workIds`/`authorizationId` | **未闭合 → W3R18-05** |
| 已登记 fail-closed 代价（名词短语/轻动词/范围声明/排除式/多目标列表/未登记同义词） | `probe1` declared-cost 10/10 只读；HTTP 4/4 只读 | **保持（Test 应固定预期）** |

---

## 7. 系统性语料与写范围恒等

- **生成式交叉积**（`probe1`，1 317 例，按 family 汇总）：`report-neg-cn` 980/4 失配、`report-neg-en` 120/0、`presupposition-cn` 28/0、`presupposition-en` 18/0、`round17-n1` 36/0、`homograph` 10/0、`bare-bu` 8/0、`refusal-variant` 15/0、`refusal-additive` 18/0、`refusal-conjunction` 4/0、`adversative-lead` 20/0、`leading-conjunction` 30/0、`polite-lead` 5/0、`multi-command` 10/0、`declared-cost` 10/0。**总失配 4（全部为 §5 的 `说明别改` 族）**。
- **写范围恒等**：`pathsIn(body)` 恒包含授权路径，**0 例扩张**；`/tmp/w3r13/probe8-scope`、`/tmp/w3r14/probe1`（201 例 FAIL-OPEN 0）、`/tmp/w3r15/probe1`（143 例，唯一「fail-open」为 planVersion 3 §31 已取代的 G8-multi 部分授权期望——现为三目标全授权）、`/tmp/w3r16/probe1`（223 例 FAIL-OPEN 0）、`/tmp/w3r16/probe2`（110 例 FAIL-OPEN 0）、`/tmp/w3r16/probe3`（34 例 AUTHORIZES 12，未回归）。
- **观察项（非缺陷，建议登记）**：
  - `修改 Y，也修改 X` / `修改 Y，顺便修改 X` → 两目标均授权（`previousWasCommand` 规则）；而 `也修改 X` 单句只读。语义可辩护，但口径未在 `plan.md` 逐字登记。
  - 拒绝 + 接续的分裂：`然后/并且/而且/同时`（`CONJUNCTION_SPLIT_PATTERN`）授权，`也/再/顺便/另外/顺手`（`additiveLead`）只读。

---

## 8. 前轮 P0/P1、注入面、越界与前轮语料无回归

| 复用脚本 | 本轮实测 | 对照第十七轮 |
|---|---|---|
| `/tmp/w3r14/probe6-prior.mjs`（17 项） | **prior P0/P1 re-check failures: 0**（含下载 token 一次性、预览 ACL/CSP 逐字、跨会话 `targetWorkId` 403、追发不改写 Work/不新增授权） | 无回归 |
| `/tmp/w3r14/probe5-injection.mjs`（11 项） | `workItems/works/authorization/grants/scope+level+intent/targetRole/ownerUserId` 注入 **workDelta=1、authDelta=0、零写范围**；未知会话 404、空 body/缺 `conversationId` 400 | 无通路 |
| `/tmp/w3r16/probe7-escape.mjs`（12 项） | `../`、`/etc/hosts.md`、`~/.ssh/config.md`、`docs/../../secret.md` **202 + 零授权行 + 无 500**；`修改 ./docs/INDEX.md` 授权逐字目标 `./docs/INDEX.md`（界内边界示例） | 无回归 |
| `/tmp/w3r16/probe1-corpus.mjs`（223 例） | `FAIL-OPEN 0`、`FALSE-REJECT 1`（范围声明，已登记代价）、`UNEXPECTED-WRITE 1`（K-multi，§31 已取代）、`AMBIG-WRITE 1` | 无回归 |
| `/tmp/w3r16/probe2-launder.mjs`（110 例） | `FAIL-OPEN 0`；AMBIG-WRITE 3（`先/特别/重点修改 X`）为探针自身歧义分类 | 无回归 |
| `/tmp/w3r16/probe3-smuggle.mjs`（34 例） | `AUTHORIZES 12`（与第十七轮 12 一致，未回归） | 无回归 |
| `/tmp/w3r15/probe1-corpus.mjs`（143 例） | `fail-open 1`（仅 G8-multi，§31 取代）、false-reject 0、ambiguous 2 | 无回归 |
| `/tmp/w3r14/probe1-corpus.mjs`（201 例） | `FAIL-OPEN 0`、FALSE-REJECT 3、PARTIAL 0 | 无回归 |
| `/tmp/w3r13/probe7-registered.mjs` | `registered corpus deviations: 0`（提取 14 正 / 139 负，其中 2 条为注释内引号） | 无回归 |
| `/tmp/w3r17/probe4-scope.mjs`（510 + 102） | `granted paths contained in message-named paths: 102/102`；30 条 `EXPANSION` 全部为 §31 取代的多命令期望（三目标全授权） | 口径已升级 |

---

## 9. 记录与实现一致性核对

| 记录主张（来源） | 实测 | 结论 |
|---|---|---|
| 冻结 `HEAD=b3624cb` | 一致，`git status` 干净 | **准确** |
| `plan.md:3` `planVersion: 3`、`implementation.md:3` `planVersion: 3` | 与实测一致 | **准确** |
| T26「拒绝类别改为子句判定（`REFUSAL_HEAD_PATTERN`）」 | 代码一致（`requests.ts:117-118`、`:405-406`） | **准确** |
| T26「未领起的否定 = 陈述 ⇒ 整条消息不授权」 | 仅对**词表内**否定成立；`别`+汉字符号、未登记动词、英文 `ban/should not` 逃逸（§5） | **不成立（W3R18-01）** |
| T26「`说明不要修改 Y` 不再是用户拒绝」 | route 实测只读 | **准确** |
| T26「加性片段只读、逆接连词片段只读」 | `probe1` refusal-additive 18/18、adversative-lead 20/20 | **准确** |
| T26「直接否定纠正授权、`先解释` 混合意图授权、多目标全部授权」 | `probe3-live` 全部符合，写范围精确 | **准确** |
| 订正块「必须授权 14 条」 | 提取 **14** | **准确** |
| 订正块「拒绝纠正接续 9 条」 | 提取 **8**（`domain.test.ts:327-335`） | **计数偏大 1（W3R18-03）** |
| 订正块「多命令 3 条」 | 提取 **3**（`domain.test.ts:308-317`） | **准确** |
| 订正块「必须只读 141 条」 | 该块字面量 **137**；块外个体负例 2 条（`explain how the routing rules work`、`fix the bug`）→ 139；`w3r13/probe7-registered` 报 139 系把块内注释里的 2 条引号也计入（非真实用例） | **计数偏大 4（W3R18-03）** |
| 订正块「外置语料 40 条不可从仓库复现」 | 仓库内 `find` 无该语料文件 | **准确（已限定）** |
| T26 证据句「probe3-live fail-open 0」 | 该主张仅对其自建 39 例语料成立；本轮扩面 71 例发现 **13 例 fail-open** | **范围限定不足（W3R18-03）** |
| T26「本轮新增/修订测试…必须只读全部通过」 | 登记语料 162 例 **0 偏差** | **准确** |
| §4/§5 的 13 句零断言（第十七轮 P3） | 已落库（`报告说不要修改` ×4 等） | **准确（已闭合）** |
| §5 的解释领起 + 未识别否定族 | `grep "说明别\|解释别\|不要重写\|不要优化"` = **0 命中** | **零断言（W3R18-04）** |
| 绝对表述限定 | 订正块把 T11–T25 的「一律/永不/按结构关闭」限定为「当时已登记语料范围内」 | **准确** |

**记录侧硬约束（对 Test 有直接影响）**：`implementation.md` T26 与本报告 §5 冲突——若 Test 以「fail-open 已按结构/词表关闭」为前提设计负例，§5.3 的 13 句会被判为「预期只读」而漏报；Test 必须把该族纳入 not_covered 或按 `planVersion 3 §23` 判为缺陷。

---

## 10. 新 Findings（W3R18-xx）

### W3R18-01 [P1] 否定识别词表缺口 + 解释领起豁免：含否定的非命令子句重开写授权（真实 HTTP + 真实写 Run）

- **位置**：`packages/domain/src/requests.ts:121-125`（`NEGATION_PATTERNS`：`(?<![\p{Script=Han}\w])别` 前缀否定 + 一组不含 `重写/优化/完善/清理/整理/替换` 的变更动词）；`:302-303`（`EXPLANATION_LEAD_PATTERN` 现允许 `先|优先`）；`:442-445`（`classSuppressed` 的解释领起豁免）；`:449-452`（`reportedNegation` 依赖同一词表）；`:474-479`（`allowed`）。
- **实测**：
  - `/tmp/w3r18/probe2b-negation-gap.mjs`：385 组合 **90 组越权**（9 解释领起 × 10 未识别否定措辞）；同形报告框架对照全部只读；
  - `/tmp/w3r18/probe2-frame-hole.mjs`：573 句 **386 句越权**；`/tmp/w3r18/probe2c-variants.mjs`：后置变体 `修改 X，说明别改 Y` 越权；
  - `/tmp/w3r18/probe3-live.mjs`：**13 句真实 HTTP**（`authId` 非空、+1 授权行、`level=["L2","none"]`、`intent=["delivery","assist"]`、`assess=1`）并经**真实 `Orchestrator`** 建立 **13 个 `backend:implementation:queued` 写 Run**，其中一句为 `packages/core/src/orchestrator.ts` 源码路径；同批对照（`修改 X，说明不要修改 Y`、`修改 X，报告说别改 Y`）只读；
  - `/tmp/w3r18/probe1-failopen.mjs`：`report-neg-cn` 族 4/980 失配（其余 976 句为 `不要/别` 后接已登记动词的组合，闭合）；全批写范围 0 扩张。
- **支撑证据句**：`说明别改 Y，然后修改 X`、`解释别重写 Y，然后修改 X`、`先说明别动 Y，然后修改 X`、`梳理不要优化 Y，然后修改 X`、`分析别碰 Y，然后删除 Z`、`帮我解释不要替换 Y，然后修改 X`、`讲讲不要整理 Y，然后修改 X`、`explain the ban on updating Y, then update X`、`修改 X，说明别改 Y`、`修改 X，解释不要优化 Y`、`先修改 X，然后说明别改 Y`、`修改 X。说明别改 Y`（Y=`docs/PLAN.md`、X=`docs/INDEX.md`、Z=`docs/DESIGN.md`）。
- **判别依据（同形对照）**：`说明不要修改 Y，然后修改 X` 只读 vs `说明别改 Y，然后修改 X` 授权；`解释不要优化 Y，然后修改 X` 授权 vs `解释不要修改 Y，然后修改 X` 只读——差别只在否定措辞，证明根因是**否定识别词表**，不是类别规则或标记并集。
- **修复前后**：`87f50e4` 源码副本实测——`先说明别改 Y，然后修改 X` 修复前只读、修复后授权（`先|优先` 扩大了豁免面，**新引入**）；`说明别改 Y`、`解释别重写 Y`、`修改 X，说明别改 Y` 修复前后都授权（**未闭合的同类残余**）。
- **验收面**：AC-004 负例失败、AC-005 授权边界违反 `plan.md` planVersion 3 §17「未登记措辞 fail-closed」与 §23「子句含否定式但否定不领起 ⇒ 不授权」。
- **修复方向**：见 §5.5（否定识别结构化、动词表对齐 `VERB_GROUP`、英文否定词表补齐、解释领起豁免加「不含否定」条件、长期断言 + Orchestrator 回归）。

### W3R18-02 [P2] 口径不一致未登记：礼貌领起 + 并列连词的组合，与加性/连词分裂

- **位置**：`requests.ts:402`（`additiveLead`）、`:320-323`（`CLAUSE_SPLIT_PATTERN`/`CONJUNCTION_SPLIT_PATTERN`）、`:474-479`（`allowed`）；`POLITE_TAIL_PATTERN` 仅匹配整句礼貌（`:183`）。
- **实测**（`probe1`、`probe3-live`）：
  - `谢谢，修改 docs/INDEX.md` / `麻烦了，修改 docs/INDEX.md` / `thanks, update docs/INDEX.md` → **只读**；`谢谢，然后修改 docs/INDEX.md` / `麻烦了，然后修改 docs/INDEX.md` → **授权**（真实写 Run）。同一语义两种结果，且均未在 `plan.md` 登记（第十七轮 W3R17-02 已指出，本轮未定口径）。
  - 拒绝 + 接续：`然后/并且/而且/同时` 授权，`也/再/顺便/另外/顺手` 只读；`plan.md` §25/§26 只登记了 `然后` 与 `也/顺便`，中间地带未登记。
  - `修改 Y，也修改 X` / `修改 Y，顺便修改 X` → 两目标授权（`previousWasCommand`），单句 `也修改 X` 只读——口径未登记。
- **性质**：方向安全（授权仅在命令子句点名路径时发生），但会直接决定 Test 的期望矩阵；须在 `plan.md` 固定「加性 vs 并列」的判定词表与「礼貌领起是否阻断后续命令」。
- **修复方向**：把 `additiveLead` 与 `CONJUNCTION_SPLIT_PATTERN` 合并为单一「加性片段」定义，或在 `plan.md` 逐词登记两个词表；对 `谢谢/麻烦了 + 修改 X` 与 `+ 然后修改 X` 取同一口径（建议统一 fail-closed）。

### W3R18-03 [P2] 记录计数不实（W3R17-04 未完全订正）

- **位置**：`.agentdev/work/WP-03/implementation.md:9`（订正块第 2 条）；`packages/domain/test/domain.test.ts:284-300`、`:308-317`、`:327-335`、`:357-509`。
- **实测**（`probe4-registered`，文本提取 + 逐句复跑 162 例 0 偏差）：must-authorize **14**（声称 14 ✓）、拒绝纠正接续 **8**（声称 9，偏大 1）、多命令 **3**（声称 3 ✓）、must-not 块字面量 **137**（声称 141，偏大 4；`/tmp/w3r13/probe7-registered.mjs` 的 139 含注释内 2 条引号；域内另有个体负例 2 条，最多 139）。
- **另**：T26 第 319 行「probe3-live fail-open 0」未限定语料范围，易被读成「fail-open 已关闭」；本轮扩面即证伪（§5）。
- **性质**：不单独阻断，但直接影响 Test 基线（§9 末段）。
- **修复方向**：按实测订正计数（14 / 8 / 3 / 137 或给出可复现的统计口径）；把 T26 证据句限定为「对当轮自建 39 例语料」；把 §5 的族纳入 `plan.md` 残余风险或修复。

### W3R18-04 [P3] 回归网缺口：隐藏否定族零断言 + 无 Orchestrator 级授权用例（W3R17-05 承接）

- **实测**：`grep -rn "说明别\|解释别\|不要重写\|不要优化" packages/*/test apps/*/test` = **0 命中**；`Orchestrator` 仍不出现在 `apps/daemon/test/server.test.ts`、`packages/core/test/artifacts.test.ts`；`core/test/orchestrator.test.ts` 的 `NOT_AUTHORIZED` 用例为 WP-02 既有，不覆盖「消息授权 → `assess(L2)` → `dispatch backend/implementation` 成功 / 该族不得建 Run」。
- **性质**：不阻断（P1 已由自建脚本 + 真实 HTTP/e2e 证明），但修复轮必须以回归断言固化。
- **修复方向**：见 §5.5 第 5 条。

### W3R18-05 [P3] 协议对账与 wire 语义承接（W3R17-06 延续）

- **实测**（`/tmp/w3r16/probe7-escape.mjs` + `probe3-live`）：未知字段 `foo`、`targetRole`（含非法枚举值）、`level`/`intent`、`authorization` 注入仍 **202 静默忽略**，而 `docs/architecture/protocol.md` §1 要求未知字段返回 `VALIDATION_ERROR`；响应仍含 §5 表未列的 `workIds`/`authorizationId`（`probe3-live` 全程可见）；`POST /artifacts/upload` 的 multipart `projectId` 忽略/多文件只保留最后、`StorageError` 映射、错误响应非 §1 封装等前轮项未动。
- **新增边界示例**：`修改 ./docs/INDEX.md` 授权逐字目标 `./docs/INDEX.md`（同仓库内、非越界），Test 应固定预期。

---

## 11. 计数与阻断判定

| 严重度 | 数量 | 编号 | 是否阻断 |
|---|---|---|---|
| P0 | 0 | — | — |
| **P1** | **1** | W3R18-01（否定识别词表缺口 + 解释领起豁免：13 句真实 HTTP + 13 个真实写 Run，含源码路径；词法组合 90/385） | **阻断** |
| P2 | 2 | W3R18-02（礼貌领起/加性-连词口径不一致，未登记）、W3R18-03（记录计数不实，影响 Test 基线） | 不单独阻断，须随修复轮订正 |
| P3 | 2 | W3R18-04（回归网缺口 + 无 Orchestrator 级用例）、W3R18-05（协议对账承接） | 不阻断，承接 Test |

- 唯一 P1 **落在本包验收面**：AC-004 负例被证伪、AC-005 授权边界违反 `planVersion 3 §17/§23`；以真实 HTTP + 真实 `Orchestrator` 证明可派发真实 Backend 写 Run（含源码路径）。
- 失败路由：`Blocking Review Finding → Develop → Independent Review`（`docs/rules/workflow.md` §6）。
- 前轮 P1 的本轮裁定：**W3R17-01 已闭合**（语境面）；**W3R17-02 已闭合**；**W3R17-03 已闭合**；**W3R17-04 部分订正（计数不实 → W3R18-03）**；**W3R17-05 部分闭合（第十七轮族已断言，Orchestrator 用例仍缺 → W3R18-04）**；**W3R17-06 未订正（→ W3R18-05）**。

---

## 12. 能否进入独立 Test —— **不能**

**判据**：`docs/rules/workflow.md` §6「P0/P1 阻断」。唯一 P1 可端到端复现（`probe3-live`：13 句 → 授权行 + L2 delivery + assessment + 真实 `backend:implementation` 写 Run）。

### 12.1 修复轮最低要求

1. **修 W3R18-01**：按 §5.5 修复否定识别（`别` 前缀否定、否定动词表对齐 `VERB_GROUP`、英文否定词表）；解释领起豁免加「子句不含否定式」条件；`先|优先` 放行不得扩大可达面。
2. **把 §5.3 的 13 句与 §5.1 的 90 组语料落成长期断言**，并补 Orchestrator 级回归（授权正例成功 / 该族不得建 Run）。
3. **定 W3R18-02 口径**并写入 `plan.md`（加性 vs 并列词表；礼貌领起是否阻断后续命令）。
4. **订正 W3R18-03 计数**并把 T26 证据句限定到当轮语料。
5. **承接 W3R18-04/05**（Orchestrator 用例、协议未知字段与 §5 对账）。

### 12.2 必须只读并落成长期断言（W3R18-01，每族 ≥3 条）

- `说明/解释/描述/梳理/分析/讲讲/介绍/帮我解释/先说明` + `别改/别重写/别动/别碰` + `，然后修改 Y`；
- 同一领起 + `不要重写/不要优化/不要完善/不要清理/不要整理/不要替换` + `，然后修改 Y`；
- 后置变体 `修改 Y，说明别改 X`、`修改 Y，解释不要优化 X`、`修改 Y。说明别改 X`；
- 英文 `explain the ban on updating X, then update Y`（含 `should not/must not/no changes` 变体）；
- 同形对照必须保持只读：`说明不要修改 X，然后修改 Y`、`修改 Y，说明不要修改 X`、`修改 Y，报告说别改 X`；
- 对照必须保持授权：`先解释 X，然后修改 Y`、`不修改 X，修改 Y`、`先别改 X，改 Y`、`不要修改 X，然后修改 Y`、`修改 X，删除 Y，更新 Z`。

### 12.3 Test 最小覆盖矩阵（在第十七轮 §11.2 基础上增补）

在第十七轮 §11.2 的 18 项之外，新增：

| # | 维度 | 最小用例（≥） | 期望 |
|---|---|---|---|
| 19 | 解释领起 + 未识别否定（W3R18-01） | 9 领起 × 3 措辞 = 27 句（含源码路径 1、后置 3） | 只读、零授权行、零写 Run |
| 20 | 同形对照（W3R18-01） | `说明不要修改 X，然后修改 Y`、`修改 Y，说明不要修改 X`、`修改 Y，报告说别改 X` | 只读 |
| 21 | 计数对账（W3R18-03） | 文本提取 14 / 8 / 3 / 137 | 与记录一致或已订正 |
| 22 | Orchestrator 授权回归（W3R18-04） | 授权正例 `assess(L2)`→`dispatch backend/implementation` 成功；§19 族不得建 Run | 建 Run / 拒绝 |

### 12.4 残余风险清单（区分已登记与未登记）

**A. 未登记缺陷 —— 必须处理**
1. W3R18-01 否定识别词表缺口 + 解释领起豁免（P1，13 句真实写 Run）。
2. W3R18-02 礼貌领起/加性-连词口径不一致（P2）。
3. W3R18-03 记录计数不实、T26 证据句范围未限定（P2）。
4. W3R18-04 隐藏否定族零断言 + 无 Orchestrator 级用例（P3）。
5. W3R18-05 协议未知字段与 §5 响应对账（P3，承接）。

**B. 已登记 fail-closed 代价 —— 已登记，接受并需 Test 承认**
6. 未登记同义祈使（`重写/润色/rewrite/polish/tweak`）→ 只读 + 澄清（`plan.md:17-18/32`）。
7. 名词短语祈使、轻动词处置式、范围声明、排除式、多目标列表 → 只读 + 澄清（`plan.md:32`，本轮实测 10/10 只读）。
8. 目标优先日常祈使（`X 的错别字麻烦处理下`）→ 只读（T19–T21）。
9. 标记子串导致路径名/复合词误拒（`过时/会议/了解/no-index/yes-notes`）→ 只读（方向安全）。
10. 仓库外目标（`..`/`/`/`~`）→ 只读、不 500（Test 固定）。
11. 礼貌领起 `谢谢，修改 X` → 只读（未登记，方向安全）。
12. 语义分类的最终责任在 WP-04/06 模型 Assessment；本包只承诺已登记语料与形态规则。

**C. 与本包无关或已承接**
13. W3R18-04/05 与 W3R4-05/06/08/10/12/13、W3R13-08/09、W3R14-06/07/08、W3R15-06/07、W3R16-06/07、W3R17-05/06 同项（P3，结算前登记或修复）。
14. 真实无头浏览器攻防（WP-10）；真实 Provider 纵向与 `artifact_write` 工具接线（WP-10/WP-07）。

---

## 13. 方法与边界声明

- **独立上下文**：未读取任何开发/Test 会话；结论只来自仓库文件、`docs/**` 契约与我自建的 6 个脚本（`probe1-failopen` 1 317 例、`probe2-frame-hole` 573 例、`probe2b-negation-gap` 385 组合、`probe2c-variants` 10 例、`probe3-live` 71 例真实 HTTP + Orchestrator、`probe4-registered` 162 例）+ `pre-check`（`87f50e4` 源码副本对照）+ 只读复用的 12 个脚本。全部消费 `pnpm build` 产物；**未 import 任何产品测试文件**（`domain.test.ts` 仅以文本方式提取语料）。
- **实验统计（观测 / 缺陷证据）**：§3 脚本清单、§5 与 §7 的分族统计。
- **对开发方主张的裁决**：**第十七轮四类闭合主张（P1 语境面、逆接连词、误拒/多目标、记录头与绝对表述）成立**；但「未领起的否定 ⇒ 整条消息不授权」只在**已登记否定词表**内成立，词表外的否定（`别`+汉字符号前缀、未登记变更动词、英文 `ban/should not`）在**解释领起豁免**下重开写授权，且 `先|优先` 的新放行使该面扩大。因此 fail-open 方向**仍未闭合**。
- **未做**：真实无头浏览器执行、真实 Provider 纵向、Docker 容器内复验、故障注入下的孤儿 blob 复验、`pnpm test:e2e`/`test:acceptance`（脚本按设计指向 WP-09/WP-10，未实现）。
- **未改仓库**：本轮只覆盖写入 `.agentdev/work/WP-03/review.md`（本报告）；除该文件外 `git status --porcelain` 为空，`HEAD` 仍为 `b3624cb306276c47de70809db852f51e54fcd601`，全部 6 条契约命令在上述工作树上执行。`/tmp/w3r18/pre-requests.ts` 是 `87f50e4` 版 `requests.ts` 的 `/tmp` 副本，**不是**对仓库文件的修改。

---

## 附十七：第十七轮报告（保留）

# WP-03 独立 Review 报告（第十七轮）

- 评审对象：工作包 WP-03「直接协作与说明产物」
- 评审轮次：**第十七轮**（第一～十六轮摘要见文末「附一～附十六」，全部保留）
- 冻结点 / HEAD：`git rev-parse HEAD` = `87f50e4e8f99cec1fd8948d96e731a184576b03c`（= 任务下达的 `87f50e4`，**无漂移**）
- 工作树：全部契约命令执行前后 `git status --porcelain` 为空；除本报告外无未提交修改
- 评审角色：Review（独立上下文；未读取任何开发/Test 会话；只依据仓库文件、契约文档与我自建的 `/tmp/w3r17/` 5 个脚本 + 只读复用 `/tmp/w3r16|w3r15|w3r14|w3r13/` 的 13 个脚本）
- 工具：`node v24.8.0`、`pnpm 12.3.4`、macOS 宿主；全部脚本消费 `pnpm build` 产物（`packages/domain/dist`、`packages/core/dist`、`apps/daemon/dist`、`packages/storage/dist`），**未 import 任何产品测试文件**（`domain.test.ts` 仅以文本方式提取语料）
- 记录哈希（`git hash-object`，前 8 位）：`packages/domain/src/requests.ts` **`2f5ad35c`**（第十六轮 `c9a2dfc9`）、`packages/domain/test/domain.test.ts` **`9505c791`**（第十六轮 `21634077`）、`apps/daemon/src/server.ts` `3a348304`、`packages/core/src/messages.ts` `283d4c04`、`packages/core/src/preview.ts` `803b502a`、`packages/core/src/artifacts.ts` `057ff403`、`packages/core/src/attachments.ts` `3ee94838`（五个文件与第十三～十六轮**逐字相同**）、`.agentdev/work/WP-03/plan.md` **`8986875e`（与第十一～十六轮逐字相同，仍未改动）**、`.agentdev/work/WP-03/implementation.md` `682e93ab`
- 变更范围：`8929ffe`（`requests.ts` +116/−41、`domain.test.ts` +12）、`87f50e4`（`requests.ts` +5/−1、`implementation.md` +11）。`packages/core/src/**`、`apps/daemon/src/**`、`docs/**`、`plan.md` **零改动**
- 权威依据：`AGENTS.md`、`docs/INDEX.md`、`docs/rules/{workflow,agents}.md`、`docs/product/experience.md`（§3）、`docs/architecture/{data,protocol,execution,reliability}.md`、`docs/delivery/{implementation,acceptance}.md`（AC-001..006/052/076/084）、`.agentdev/work/WP-03/{plan,implementation,review}.md`、`packages/**`、`apps/daemon/**`、相关测试

---

## 1. 结论

**FAIL（不能进入独立 Test；按 `docs/rules/workflow.md` §6 走 `Blocking Review Finding → Develop → Independent Review`）。**

本轮判 **FAIL（0×P0、1×P1、3×P2、2×P3）**。

T25 的两条修复**大部分成立**，但**越权（fail-open）方向并未按结构关闭**：

- **成立的部分（可复核的真实改善）**：
  - **第十六轮登记的 18 句 P1 全部归零**：`/tmp/w3r16/probe5-http.mjs` 在本轮 build 上 **fail-open 0**、`/tmp/w3r16/probe6-e2e.mjs` **非命令建立写 Run 0**（第十六轮为 25/15）。7 个标记族（疑问/条件/意见/引用/建议/前置条件/解释领起+条件）确实被「标记并集」覆盖。
  - **逆接连词裸 `要` 闭合（W3R16-02）**：`但要修改 X`、`而是要更新 X`、`不过要删除 Y`、`但是要修复 X` **全部只读**；`ADVERB_LEAD_PATTERN` 长优先顺序已修（`但是` 在 `但` 前）。
  - **加性片段闭合（W3R16-03 的加性面）**：`也修改 X`、`再更新 X`、`然后修改 X`、`同时也要改 X`、`另外要更新 X`、`顺便修改 X`、`整条消息以连词开头` **全部只读**。
  - **登记语料零回归**：文本提取后逐句复跑 **15 正 + 113 负，0 偏差**（第十六轮 15 + 104；T25 新增 9 条负例已落库）。
  - **写范围无扩张**：510 例作用域交叉 + 102 例「授权路径 ⊆ 消息点名路径」全部成立；第十三轮 29 例作用域脚本复跑 **0 扩张**。
  - **前轮 P0/P1 无回归**：`/tmp/w3r14/probe6-prior.mjs` **17/17**；客户端注入面 **0 通路**（11 项）；仓库外目标 5/5 只读不 500。
- **不成立的部分（本轮 P1）**：
  **「拒绝」这一良性类别仍是**关键词命中**而非类别判定**：`classSuppressed` 只要子句命中 `NEGATION_PATTERNS`（`不要/别/don't…` 出现在子句**任意位置**即可）就把它当成用户拒绝而从抑制中豁免。于是一条**否定式陈述/报告/前提**（没有任何疑问/条件/意见/引用标记）会让其后的并列连词命令重新获得写授权。`报告说不要修改 docs/PLAN.md，然后修改 docs/INDEX.md`、`文档写着不要修改 …`、`需求里写着不要修改 …`、`评审说/规则要求/它说不要修改 …`、`在你不要修改 … 的前提下，然后 …`、`由于/既然不要修改 …`、`the report says don't update …, then update …`、`provided/given that you don't update …, then update …` 等 **13 句在真实 HTTP 上落库 Authorization（L2 + 1 授权行 + 1 assessment），并经真实 `Orchestrator` 建立真实 `backend:implementation:queued` 写 Run（含 `packages/core/src/orchestrator.ts` 源码路径）**。
  这是第十六轮 P1（W3R16-01，否定+标记伪装成拒绝）的**同一根因**：上一轮修好了「标记」侧，**没有修「拒绝类别」侧**。

本结论落在本包验收面（AC-004 负例、AC-005 授权边界、`workflow.md` §1/§6），**以真实 HTTP + 真实 Orchestrator 端到端可复现**，阻断 Test。

| 维度 | 第十六轮 | 第十七轮 |
|---|---|---|
| 动词优先无尾文法 | 保持关闭 | **保持关闭** |
| 前件 + 承接副词 / 并列连词 | 部分关闭 / 归零 | **保持关闭** |
| 情态 `需要/应该/必须/得/该`、裸 `要`（连词/副词/逆接连词） | 逆接连词 3 句开 | **归零（T25 关闭）** |
| 问句/条件/意见/引用/建议/前置条件（**含否定+标记**） | 18 句开 | **归零（T25 关闭）** |
| **否定式陈述/报告/前提（无任何标记）** | 未单列 | **13 句开（W3R17-01 新）** |
| 加性片段（`也/再/然后/同时…修改 X`） | 11 句授权 | **归零** |
| 逆接连词片段（`但修改 X`/`但是修改 X`） | 未单列 | **仍授权（W3R17-02，B 档）** |
| 拒绝纠正 `别改 Y，改 X` / `不要改 Y，改 X` | 授权 | **授权（保持）** |
| 拒绝纠正 `不修改 Y，修改 X` / `先别改 Y，改 X` | 误拒 | **仍误拒（W3R17-03）** |
| 混合意图 `解释 X 并修复 Y` / `explain X and fix Y` | 授权 | **授权（保持）** |
| 混合意图 `先解释 X，然后修改 Y` | 误拒 | **仍误拒（W3R17-03）** |
| 多目标/多子句静默部分授权 | 逗号多子句仍部分授权 | **仍部分授权（W3R17-03）** |
| 写范围超出命令目标 | 未发现 | **未发现（0/510 + 102/102 包含）** |
| 客户端注入面 | 无通路（11 项） | **无通路（11 项）** |
| 仓库外目标 | 只读、不 500 | **只读、不 500** |
| 前轮 P0/P1 复验 | 17/17 | **17/17** |
| 登记语料 | 15 正 + 104 负 | **15 正 + 113 负，0 偏差** |
| P1 数量 | 2 | **1（同一根因的残留通道）** |

---

## 2. 契约命令原始结果（本轮实跑）

执行目录：仓库根；在 `HEAD=87f50e4`、工作树干净时执行；`pnpm build` 产物由本轮 build 生成。逐条串行，原始日志：`/tmp/w3r17/commands.log`。

| 命令 | 退出码 | 原始结果要点 |
|---|---|---|
| `pnpm typecheck` | **0** | `tsc -p tsconfig.json --pretty false`，无输出 |
| `pnpm lint` | **0** | `Checking formatting...` / `All matched files use Prettier code style!` |
| `pnpm test:unit` | **0** | `Test Files  19 passed (19)`、`Tests  289 passed (289)`（含 `apps/daemon/test/server.test.ts (17 tests)`） |
| `pnpm test:integration` | **0** | `Test Files  10 passed (10)`、`Tests  124 passed (124)` |
| `pnpm docs:check` | **0** | `docs:check ok — 15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages` |
| `pnpm build` | **0** | `pnpm -r build`，**8** 个 workspace `build: Done`：`contracts, cli, domain, storage, core, daemon, pi-runtime, runner` |

`git status --porcelain`（写入本报告前）：**空输出**；`HEAD` 全程 `87f50e4e8f99cec1fd8948d96e731a184576b03c`。
计数对账：`implementation.md` T25（`:296`）的 `289 / 124 / 8 / docs:check ok` 与实测**一致**；但「新增第十六轮 9 条必须只读」只覆盖**标记族**，未覆盖本轮 §4 的 13 句（见 W3R17-05）。

**命令全绿不等于必验范围成立**：本轮 13 句越权与 4 句误拒在仓库测试内**零断言**；`Orchestrator` 仍不出现在 `apps/daemon/test/server.test.ts`、`packages/core/test/artifacts.test.ts`（W3R4-05 承接）。

---

## 3. 方法

- **系统性交叉语料**（`/tmp/w3r17/probe1-corpus.mjs`，自建，**13 848 例**）：把 22 个 A 档非命令族（陈述/完成体/条件前件/条件后件/疑问/选择/意见/建议/片段/模态/参照/引用/否定+标记 7 族）与 6 条真命令在「首位 / 连词续接 / 后置」三种位置做笛卡尔积。位置选择保证实现自己的 `allowed` 门是**打开**的，因此探测的是抑制逻辑本身而不是被误关的门。命令自检 `commandSanityFailures=0`（探针非空转）。
- **定界探针**（`probe2-framing.mjs`，31 例）与**写范围探针**（`probe4-scope.mjs`，510 + 102 例）。
- **真实 HTTP + 真实 Orchestrator**（`probe3-live.mjs`，39 例）：真实 loopback daemon（真实 SQLite + 真实 blob + Bearer），逐句测 `authorization` 行数、Work `level/intent/writePaths`、`assessment` 行数，再走 Core 自己的 `assess` → Chief `dispatch(analysis)` → `dispatch(backend/implementation)`。
- **修复方向验证**（`probe5-fixcheck.mjs`）：仅在 `/tmp/w3r17/fixed-requests.mjs`（**`dist/requests.js` 的副本**）上验证，**未修改仓库任何文件**。
- **只读复用**：`/tmp/w3r16/{probe1-corpus(223),probe2-launder(110),probe3-smuggle(34),probe5-http(49),probe6-e2e(25),probe7-escape(12)}`、`/tmp/w3r15/{probe1-corpus(143),probe4-registered}`、`/tmp/w3r14/{probe1-corpus(201),probe5-injection(11),probe6-prior(17)}`、`/tmp/w3r13/{probe7-registered,probe8-scope(29)}`。

---

## 4. 越权（fail-open）方向：独立穷举核验

### 4.1 口径声明（先声明后实测）

- **缺陷（A 档）**：句子含有一条**非命令、且不属于实现自己声明的四个良性类别**（命令/拒绝/纯礼貌/显式解释请求）的子句，却在 `routeMessage` 上产生 `explicitAuthorization=true` 并落到 `delivery` 写 Work。该判定直接引用模块自己的契约（`requests.ts:8-11`「a change is authorized **only** when the clause is exactly a command…everything else…is read-only」）与 T24/T25 记录（「其余任何子句…⇒ 整条消息不授权；类别规则作为第二道」）。
- **非缺陷（已声明代价）**：未登记同义变更词（`重写/润色/polish`）、名词短语祈使（`修改 X 中的错别字`）、目标优先日常祈使、多目标列表与排除式 → 只读 + 澄清（`plan.md:17-18`、T19–T25）。
- **非缺陷（真祈使/混合）**：`并/and/然后` 连接的两个真祈使；显式解释请求 + 同消息内真命令（`解释 X 并修复 Y`）。
- **B 档（形态可辩）**：以逆接连词开头的**单句片段**（`但修改 X`/`但是修改 X`）——可读作省略主语的祈使，也可读作承接片段，单列不计入 A 档。
- **判定分档**：A 明确非命令（计入缺陷）；B 形态可辩（单列）；C 真祈使；F 已声明 fail-closed。

### 4.2 语料与结果总表（全部消费 `pnpm build` 产物）

| 脚本 | 观测 | 结果 |
|---|---|---|
| `probe1-corpus.mjs`（自建，13 848 例） | **A 档 FAIL-OPEN 117**（去重后仅 2 个句式族：`modal/务必修好 X` 系**我方语料误判**（`务必`是强调祈使，已剔除）；`neg-quote/报告说不要修改 Y` 系**真缺陷**） | A 档扣掉误判后 = **W3R17-01** |
| `probe2-framing.mjs`（自建，31 例：报告体/前提体/英文） | **20 例越权**（13 条新 + 3 条前提 + 3 条英文；含 `报告说…`、`文档写着…`、`需求里写着…`、`评审说…`、`规则要求…`、`它说…`、`在你…的前提下`、`由于…`、`既然…`、`the report says don't…`、`provided that you don't…`、`given that you don't…`） | **W3R17-01** |
| `probe3-live.mjs`（自建，39 例真实 HTTP + 真实 Orchestrator） | **fail-open over HTTP 16**（13 N1 + 2 逆接连词 B 档 + 1 多子句部分）；**真实 `backend/implementation` 写 Run 16**；登记/文档化正例 **全通**；误拒 **3** | **W3R17-01/02/03** |
| `probe4-scope.mjs`（自建，510 作用域交叉 + 102 包含性） | **扩张 0**；granted ⊆ message-named **102/102** | 写范围无扩张 |
| `/tmp/w3r16/probe1-corpus.mjs`（复用，223 句） | **FAIL-OPEN 0**、FALSE-REJECT 4、UNEXPECTED-WRITE 1、AMBIG-WRITE 4 | 第十六轮 18 句归零 |
| `/tmp/w3r16/probe2-launder.mjs`（复用，110 句） | **FAIL-OPEN 0**、FALSE-REJECT 5、AMBIG-WRITE 10 | 洗白面关闭 |
| `/tmp/w3r16/probe3-smuggle.mjs`（复用，34 句） | **授权 34→12**；12 中 7 条为登记正例（拒绝纠正）、2 条为纯礼貌+真命令、3 条为「解释领起」混合意图 | 第十六轮 26 → 12（无明确缺陷） |
| `/tmp/w3r16/probe5-http.mjs`（复用，49 句真实 HTTP） | **fail-open 0**（第十六轮 25）；误拒 4 | 第十六轮登记句闭合 |
| `/tmp/w3r16/probe6-e2e.mjs`（复用，25 句真实 Orchestrator） | **非命令写 Run 0**（第十六轮 15）；正例漏建 2 | 第十六轮登记句闭合 |
| `/tmp/w3r16/probe7-escape.mjs`（复用，12 项） | 越界 5/5 只读不 500；未知字段/`targetRole`/`authorization` **202 静默忽略、零授权行** | 承接 W3R17-06 |
| `/tmp/w3r15/probe1-corpus.mjs`（复用，143 句 hold-out） | **fail-open 1**（仅多子句部分授权）、false-reject 3、ambiguous 2 | W3R17-03 |
| `/tmp/w3r14/probe1-corpus.mjs`（复用，201 句 hold-out） | **FAIL-OPEN 0**、FALSE-REJECT 4、PARTIAL 0 | 无回归 |
| `/tmp/w3r15/probe4-registered.mjs`、`/tmp/w3r13/probe7-registered.mjs`（复用） | 登记 **15 正 + 113 负**，**0 偏差** | 回归网成立 |
| `/tmp/w3r14/probe5-injection.mjs`（复用，11 注入） | 0 授权行、0 越权 Work、0 L3 Work | 注入面无通路 |
| `/tmp/w3r14/probe6-prior.mjs`（复用，17 项前轮 P0/P1） | **17/17 通过** | 无回归 |
| `/tmp/w3r13/probe8-scope.mjs`（复用，29 项作用域） | **0 扩张**；逗号多子句 1 项部分授权 | W3R17-03 |
| `probe5-fixcheck.mjs`（自建，修复方向） | 见 §4.5 | 修复方向有效 |

### 4.3 实证证据句（A 档，全部消费构建产物）

```
报告说不要修改 docs/PLAN.md，然后修改 docs/INDEX.md                    -> AUTHORIZES docs/INDEX.md   ← 陈述/报告 + 否定
报告说不要修改 docs/PLAN.md，然后修改 packages/core/src/orchestrator.ts -> AUTHORIZES 源码路径        ← 同上
文档写着不要修改 docs/PLAN.md，然后修改 docs/INDEX.md                   -> AUTHORIZES
需求里写着不要修改 docs/PLAN.md，然后修改 docs/INDEX.md                 -> AUTHORIZES
评审说不要修改 docs/PLAN.md，然后修改 docs/INDEX.md                     -> AUTHORIZES
规则要求不要修改 docs/PLAN.md，然后修改 docs/INDEX.md                   -> AUTHORIZES
它说不要修改 docs/PLAN.md，然后删除 docs/DESIGN.md                      -> AUTHORIZES docs/DESIGN.md
在你不要修改 docs/PLAN.md 的前提下，然后修改 docs/INDEX.md              -> AUTHORIZES                 ← 前提/条件
由于不要修改 docs/PLAN.md，然后修改 docs/INDEX.md                       -> AUTHORIZES                 ← 前提
既然不要修改 docs/PLAN.md，然后修改 docs/INDEX.md                       -> AUTHORIZES                 ← 前提
the report says don't update docs/PLAN.md, then update docs/INDEX.md   -> AUTHORIZES                 ← 英文报告体
provided that you don't update docs/PLAN.md, then update docs/INDEX.md -> AUTHORIZES                 ← 英文前提
given that you don't update docs/PLAN.md, then update docs/INDEX.md    -> AUTHORIZES                 ← 英文前提
```

**同形反向对照（证明根因是「拒绝」关键词判定，而不是标记词表）**

```
报告提到需要修改 docs/PLAN.md，然后修改 docs/INDEX.md   -> 只读   （登记语料；陈述 ⇒ classSuppressed）
需求里写着要修改 docs/PLAN.md，然后修改 docs/INDEX.md   -> 只读   （同上）
报告说不要修改 docs/PLAN.md，然后修改 docs/INDEX.md     -> AUTHORIZES（同一「报告体」，只因含「否定+变更动词」被当成拒绝而豁免）
如果不要修改 docs/PLAN.md，然后修改 docs/INDEX.md       -> 只读   （条件标记命中 ⇒ 抑制，说明标记面已修好）
不要修改 docs/PLAN.md，然后修改 docs/INDEX.md           -> AUTHORIZES（登记正例：用户直接拒绝 + 纠正）
```

### 4.4 真实 HTTP + 真实 Orchestrator（`probe3-live.mjs`）

13 句 N1 全部：HTTP **202**、`authorizationId` 非空、新增 **1 条 `authorization` 行**、新 Work `level=["L2","none"]`、`intent=["delivery","assist"]`、`writes` 为句中路径、写入 **1 条 `assessment`**，并经 `assess`（L2 + 授权通过 `verifyAuthorization`）→ Chief `dispatch` → **真实 `backend:implementation:queued` 写 Run**。其中 `报告说不要修改 docs/PLAN.md，然后修改 packages/core/src/orchestrator.ts` 建立**源码**写 Run。
对照：登记负例 5/5 只读（`authId=null`、`level=none`、零授权行、零 Run）；**文档化正例 12/12 授权并建写 Run**。

### 4.5 危害上界与修复方向验证

- **危害上界**：越权范围恒等于句中**被点名的那一个路径**，`operations=['read','edit']`、`networkTargets=[]`；510 例作用域交叉 **0 扩张**、102/102 授权路径均 ⊆ 消息点名路径；环境/网络/越界路径仍被 `verifyAuthorization` 拒绝。目标不限 `docs/`：源码路径同样可授权并建立真实 `backend:queued` 写 Run。危害是「用户只是报告/加前提，却产生可执行的**源码**写授权与真实写 Run」，属 `workflow.md` §6 的 P1 + AC-004 负例失败；无环境/网络/数据删除通路，不构成 P0。
- **修复方向（已在 `/tmp` 副本上验证，未改仓库）**：把「拒绝」从**子句任意位置命中 `NEGATION_PATTERNS`** 收窄为**拒绝标记领起子句**（剥离 `请/麻烦/…` 礼貌前缀后以 `不要|不用|不需要|无需|先不|暂不|不必|不想|不愿|请勿|切勿|禁止|严禁|不许|不准|暂缓|延后|推迟|别|do not|don't|…` 开头）。实测（`probe5-fixcheck.mjs`）：
  - **W3R17-01 通道 13/13 全部关闭**；
  - 登记语料 **15 正 + 113 负 0 回归**；文档化正例 **12/12 不丢**；
  - 复用 hold-out 全部不劣化：r14 201 例 `FAIL-OPEN 0`、r15 143 例 `fail-open 1`（第三轮既知的多子句部分）、r16 223 例 `FAIL-OPEN 0` 且 `AMBIG-WRITE 4→2`、r16 launder 110 例 `FAIL-OPEN 0`、r16 smuggle 34 例仍 12（不回归）。
  - 注意取舍：`先别改 Y，改 X` 本已误拒，收窄后仍误拒（方向一致，无新增回归）；`不要修改 Y，然后修改 X` 等登记正例不受影响。

---

## 5. 写范围恒等复核

- **扩张方向：未发现缺陷。** `pathsIn(core).includes(target)` 仍保证写范围 ⊆ 句中路径；510 例交叉探测中，凡授权者其写路径恒等于其命令子句点名的路径，**没有一例**落到只有非命令子句才点名的路径；102/102 授权路径包含于消息点名路径。
- `修改 Y 而不是 X`、`update Y instead of X`、`参考 X 修改 Y`、`修改 Y 参考 X`、`把 Y 参照 X 改掉`、`把 X 和 Y 都改掉`、`修改 X、Y`、`修改 X and Y` → 全部只读（0 扩张）。
- `修改 Y，不要动 X` → 仅授权 Y。越界目标（`../`、`/etc/`、`~/.ssh/`、`docs/../../`）→ 只读、零授权行、无 500。
- **遗留（非扩张）**：`修改 X，删除 Y，更新 Z` → 仅 `["X"]`（逗号多子句**静默部分授权**，第十五/十六轮既知）→ W3R17-03。
- 边界示例（无需修复，Test 应固定预期）：`修改 ./docs/INDEX.md` 授权**逐字**目标 `./docs/INDEX.md`（同仓库内、非越界）。

---

## 6. 文档化正例复核（`probe3-live.mjs`，真实 HTTP + 真实 Orchestrator）

| 场景 | 用例 | 结果 |
|---|---|---|
| **严格命令** | `修改 docs/INDEX.md`、`修复 docs/INDEX.md`、`update docs/INDEX.md` | 授权 + 真实写 Run，写范围恒为 1 |
| **处置式** | `把 docs/INDEX.md 改掉`、`将 docs/PLAN.md 删除`、`对 docs/PLAN.md 修改` | 授权 + 真实写 Run |
| **混合意图** | `解释 docs/INDEX.md 并修复 docs/PLAN.md`、`explain docs/DESIGN.md and fix docs/PLAN.md` | assist + delivery 两 Work，仅 delivery 授权 |
| **拒绝纠正** | `不要修改 docs/PLAN.md，但要修复 docs/INDEX.md`、`别改 docs/PLAN.md，改 docs/INDEX.md`、`don't fix docs/PLAN.md, fix docs/INDEX.md` | 授权且写范围仅 INDEX |
| **礼貌尾** | `修改 docs/INDEX.md。谢谢` | 授权 |
| **多命令并列** | `修复 docs/INDEX.md，删除 docs/PLAN.md` | 授权（写范围含两个真命令目标） |
| **登记正例（文本提取）** | 15 条 | 逐句授权，`writePaths` 长度恒为 1，0 偏差 |
| **登记负例（文本提取）** | 113 条 | 逐句只读，0 偏差 |
| **已声明 fail-closed（方向安全）** | `修改 X 中的错别字`、`fix the typo in X`、`把 X 里的错别字改掉`、`对 X 进行修改`、`X 的错别字麻烦处理下`、`重写/润色/rewrite/polish`、`修改 X、Y`、`修改 X 而不是 Y`、`修改 ../secret.md` | 只读 + 澄清（不产生越权） |
| **误拒（未闭合，W3R17-03）** | `不修改 docs/PLAN.md，修改 docs/INDEX.md`、`先别改 docs/PLAN.md，改 docs/INDEX.md`、`先解释 docs/INDEX.md，然后修改 docs/PLAN.md` | 只读（HTTP `authId=null`、零授权行、零写 Run） |

---

## 7. 客户端注入面、仓库外目标、前轮 P0/P1 无回归

### 7.1 注入面（`/tmp/w3r14/probe5-injection.mjs`，真实 HTTP，只读复用）

| 注入 | HTTP | 库结果 |
|---|---|---|
| `workItems:[…×50]` / `works:[…×50]` | 202（静默忽略） | workDelta=1、authDelta=0、无 write |
| `authorization:{scope:{…}}` / `{operations:['deploy']}` | 202（忽略） | authDelta=0、`authorizationId=null` |
| `grants:[…]` / `scope+level+intent` | 202（忽略） | 零授权行、无 L3 Work |
| `targetWorkId`（不存在/跨会话） | **404 / 403** | 零副作用 |
| 未知字段 `foo`/`targetRole`/`ownerUserId` | 202（**静默忽略**） | 无副作用（承接 `protocol.md` §1，W3R17-06） |
| 空 body / 缺 `conversationId` / 未知 `conversationId` | **400 / 400 / 404** | 零副作用 |

**结论：wire 层不存在 `authorization`/`workItems`/`works`/`grants`/`scope`/`level`/`intent` 通路，11 项注入零授权行、零越权 Work，无回归。`apps/daemon/src/server.ts` 哈希 `3a348304` 与第十三～十六轮逐字相同（零改动）。**

### 7.2 仓库外目标（`/tmp/w3r16/probe7-escape.mjs`）

`修改 ../secret.md`、`修改 /etc/hosts.md`、`修改 ~/.ssh/config.md`、`修改 docs/../../secret.md`、`update ../secret.md` → HTTP **202**、**零授权行**、`authId=null`、**无 500**。**闭合保持。**

### 7.3 前轮 P0/P1 复核（`/tmp/w3r14/probe6-prior.mjs`，**17/17**）

| 项目 | 本轮实测 | 状态 |
|---|---|---|
| W3-01 下载 token 可预测/先于认证（P0） | token 不内嵌 artifactId；首次 200、二次 403 | 无回归 |
| W3-02 产物读取无主体维度（P0） | 预览走 `assertReadable`；CSP 逐字、sandbox、`credentials: omit`、无 `set-cookie`、`nosniff` 全成立 | 无回归 |
| W3R3-01 授权 capability 缺口致死锁（P1） | 正例 `assess`/`dispatch` 全通（含 `readPaths`+`read`） | 无回归 |
| W3R3-06 CSP 单头/逐字相等（P2） | `preview.ts` 哈希 `803b502a` 未变 | 无回归 |
| W3R4-03 `assertGrantWithinMessage` 约束 `readPaths` | 代码仍在（`messages.ts`）；HTTP `authorization` 注入被忽略 | 无回归 |
| W3R4 `targetWorkId` 跨会话 / 追发不改写 Work | 跨 Conversation → **403**；追发后 `level`/`authorizationRef` 不变 | 无回归 |
| W3R7-01 只读请求词授权（P1） | `帮我看一下/请评估/列出/总结/检查` 全只读 | 无回归 |
| W3R7-03 混合否定+指令（P1） | `不要修改 A，但要修复 B`、`别改 A，改 B` 授权 B | 保持 |
| W3R13/14 P1 组（尾巴/选择/条件复位/连词/情态） | hold-out 201 例 `FAIL-OPEN 0` | 已闭合 |
| **W3R16-01（P1，标记豁免）** | 18/18 登记句只读；HTTP fail-open 0、e2e 写 Run 0 | **标记面闭合；类别面残留 → W3R17-01** |
| **W3R16-02（P1，逆接连词裸 `要`）** | `但要修改 X`/`而是要更新 X`/`不过要删除 Y`/`但是要修复 X` 全只读 | **已闭合** |
| W3R16-03（P2，承接片段） | 加性面归零；**逆接连词面仍授权** | **部分闭合 → W3R17-02** |
| W3R16-04（P2，误拒/混合/多目标） | 3 句仍误拒；多子句仍部分授权 | **未闭合 → W3R17-03** |
| W3R16-05（P2，记录） | 见 §8 | **未闭合 → W3R17-04** |
| 登记语料 15 正 + 113 负 | **0 偏差** | 无回归 |
| `packages/core/**`、`apps/daemon/src/**`、`preview.ts` | 哈希与第十三～十六轮逐字相同 | 零改动 |

**未闭合承接**（P3）：W3R4-05/W3R15-06/W3R16-06（无 Orchestrator 授权回归用例）、W3R4-06/W3R15-07/W3R16-07（`protocol.md` §5 未对账）、W3R4-08（`StorageError` 映射粗）、W3R4-10（`targetWorkId` 归属只覆盖 message 来源）、W3R4-12（multipart 多文件 / `projectId`）、W3R4-13（错误响应非 §1 封装）。

---

## 8. 记录与实现一致性核对（逐条复核表）

| 记录主张（来源） | 实测 | 结论 |
|---|---|---|
| 冻结 `HEAD=87f50e4` | 一致，`git status` 干净 | **准确** |
| T25「标记并集与类别规则并存：疑问/选择/征询/评价/条件/假设/前置条件出现在任何子句…⇒ 整条消息不授权」 | **标记面准确**（7 族 18 句归零）；**类别面不成立**——`报告说不要修改 Y` 是陈述子句，类别规则本应抑制，却因命中 `NEGATION_PATTERNS` 被当成「拒绝」而豁免 | **部分成立（W3R17-01/04）** |
| T25「类别规则作为第二道（非命令/拒绝/礼貌/解释请求的子句亦抑制）」 | 「拒绝」判定是子句**任意位置**的关键词命中（`requests.ts:325`），不是类别判定 | **不成立（W3R17-01）** |
| T25「逆接连词后的裸 `要` 仅在紧接拒绝子句时按纠正处理；`但要修改 X` 单独出现只读」 | 一致（4/4 只读） | **准确** |
| T25「加性片段不独立成句；整条消息以连词开头（`然后修改 X`）同样只读」 | 加性面一致；**逆接连词 `但修改 X`/`但是修改 X` 不在 `leadingConjunction` 列表内，仍授权** | **不完整（W3R17-02）** |
| T25「修 `但是/但` 交替顺序（长优先）」 | 一致（`但是要修复 X` 现在只读） | **准确** |
| T25「新增第十六轮 9 条必须只读」 | 登记负例 104→**113**（+9），实测 0 偏差 | **准确** |
| T25「外置语料 40 条 0 fail-open」 | 仓库内**无可复现的 40 条语料文件**（`find` corpus/语料 = 0 命中）；第十四轮 hold-out 复跑仍有 1 句部分授权 | **不可复现（W3R17-04）** |
| T25「unit 289 / integration 124 / build 8 / docs:check ok」 | 与实测**一致**（另测 daemon 17 例） | **准确** |
| `implementation.md:3` `planVersion: 1` | `plan.md:3` 为 `planVersion: 2` | **记录头未同步（W3R17-04）** |
| `plan.md` 是否登记 T21–T25 的新代价 | 哈希 `8986875e` 与第十一～十六轮**逐字相同**；只保留 `:17-18` 的一般性边界声明 | **未登记（W3R17-04）** |
| `implementation.md:11/:113/:177/:249/:261` 的「一律/永不/按结构关闭」 | `:261`「fail-open 方向现已按结构关闭」被 §4 证伪；`:113`「永不下发写授权」、`:177`「其余一律只读」、`:249`「非命令永不授权」、`:11`「一律 INTERNAL_ERROR」原文仍在 | **名实不符（W3R17-04）** |
| T25「对任何不确定一律 fail-closed」（`plan.md:18`） | 13 句「不确定」未 fail-closed，反而授权 | **不成立（W3R17-01/04）** |
| T25 待办「`../` 越界改为 `VALIDATION_ERROR`」 | 实现为**只读**（不报 `VALIDATION_ERROR`），第十六轮已指出待办陈旧，本轮仍未订正 | **记录陈旧（W3R17-04）** |
| T24/T25 的「纠正例外收窄」 | 一致（`也不要修改 X`、`顺便修改 X` 只读） | **准确** |
| 处置式正例 `对 Y 进行修改` | 仍只读；`domain.test.ts` 仍为 `对 docs/PLAN.md 修改` | **未登记（W3R17-05）** |
| HTTP/Core 测试混合意图正例措辞 | `apps/daemon/test/server.test.ts`、`packages/core/test/artifacts.test.ts` 仍为 `explain the routing rules and 修复 docs/INDEX.md`（英文原例未恢复） | **测试覆盖收缩（W3R17-05）** |

**记录侧硬约束（对 Test 有直接影响）**：`implementation.md:261` 宣称「fail-open 方向现已按结构关闭」，`:249` 宣称「非命令永不授权」。若 Test 据此设计负例，§4.3 的 13 句会被判为「预期只读」而漏报。

---

## 9. 新 Findings（W3R17-xx）

### W3R17-01 [P1] 「拒绝」类别仍是关键词命中：否定式陈述/报告/前提被误判为用户拒绝，含否定但无标记的非命令子句重开写授权

- **位置**：`packages/domain/src/requests.ts:325`（`const refusal = matches(NEGATION_PATTERNS, clause.text)`）、`:358`（`classSuppressed` 的 `!refusal` 豁免）、`:109-113`（`NEGATION_PATTERNS` 覆盖**子句任意位置**的 `不要/不用/不需要/无需/先不/暂不/不必/不想/不愿/请勿/切勿/禁止/严禁/不许/不准/暂缓/延后/推迟/别` 与英文 `do not/don't/never/no need to/…`）。第十六轮修复只把「标记并集」叠加回来，**没有改变「拒绝」的判定方式**。
- **实测（全部消费构建产物）**：
  - `/tmp/w3r17/probe2-framing.mjs`：31 例中 **20 例越权**（13 条新框架句 + 谓词/前提/英文变体）；
  - `/tmp/w3r17/probe1-corpus.mjs`：13 848 例交叉，去重后 A 档缺陷族唯一为 `报告说不要修改 Y`（`neg-quote`）；
  - `/tmp/w3r17/probe3-live.mjs`：13 句在**真实 HTTP** 上 `authorizationId` 非空、**+1 授权行**、`level=["L2"]`、`assessment=1`，并经**真实 Orchestrator** 建立**真实 `backend:implementation:queued` 写 Run**（其中 1 句为 `packages/core/src/orchestrator.ts` 源码路径）。
- **证据句**：`报告说不要修改 docs/PLAN.md，然后修改 docs/INDEX.md`、`文档写着不要修改 docs/PLAN.md，然后修改 docs/INDEX.md`、`需求里写着不要修改 docs/PLAN.md，然后修改 docs/INDEX.md`、`评审说不要修改 docs/PLAN.md，然后修改 docs/INDEX.md`、`规则要求不要修改 docs/PLAN.md，然后修改 docs/INDEX.md`、`它说不要修改 docs/PLAN.md，然后删除 docs/DESIGN.md`、`在你不要修改 docs/PLAN.md 的前提下，然后修改 docs/INDEX.md`、`由于不要修改 docs/PLAN.md，然后修改 docs/INDEX.md`、`既然不要修改 docs/PLAN.md，然后修改 docs/INDEX.md`、`the report says don't update docs/PLAN.md, then update docs/INDEX.md`、`provided that you don't update docs/PLAN.md, then update docs/INDEX.md`、`given that you don't update docs/PLAN.md, then update docs/INDEX.md`；变体 `…，但修改/并且修改/同时修改/而且修改/并修改 Y` 同族成立。
- **判别依据（同形反向）**：`报告提到需要修改 Y，然后修改 X`（登记负例）只读 vs `报告说不要修改 Y，然后修改 X` 授权；`如果不要修改 Y，然后修改 X`（条件标记命中）只读 vs `在你不要修改 Y 的前提下，然后修改 X` 授权。差别只在**是否含否定+变更动词**，证明根因就是「拒绝」的关键词判定，不是标记覆盖不足。
- **修复方向（`/tmp/w3r17/probe5-fixcheck.mjs` 已验证，未改仓库）**：把 `refusal` 收窄为「拒绝标记领起子句」（剥离礼貌前缀后以 `不要|不用|…|别|do not|don't|…` 开头）。实测：**通道 13/13 关闭**，登记 15 正 + 113 负 **0 回归**，文档化正例 **12/12 不丢**，r14/r15/r16/r16-launder/r16-smuggle hold-out **均不劣化**（r16 AMBIG-WRITE 4→2）。
- **验收面**：AC-004 负例失败、AC-005 授权边界失败；`workflow.md` §1「执行消息可直接授权明确目标」被扩大到「陈述/前提 + 命令句」。

### W3R17-02 [P2] 逆接连词开头的单句片段仍被归一成命令（`但修改 X`、`但是修改 X`）

- **位置**：`requests.ts:438`（`leadingConjunction` 列表为 `并且|而且|然后|同时|并|也|再|就|则|另外|顺便|顺手`，**不含** `但|但是|而是|不过`）；`:239-240`（`ADVERB_LEAD_PATTERN` 无条件剥离逆接连词）。
- **实测**：`/tmp/w3r17/probe4-scope.mjs` 与 `probe3-live.mjs`：`但修改 docs/INDEX.md`、`但是修改 docs/INDEX.md` → HTTP 落库授权、真实写 Run；而同一形态的加性片段（`然后修改 X`、`也修改 X`、`同时也修改 X`）已只读。第十六轮列为 B 档（W3R16-03）的「承接片段」只关掉了加性一半。
- **性质**：B 档（可读作省略主语的祈使），方向与 T25 自述「整条消息以连词开头同样只读」不一致；**不构成 P1**，但需产品口径：或收窄为澄清，或在 `plan.md` 显式登记该例外。
- **口径不一致附例**：`谢谢，然后修改 docs/INDEX.md`、`麻烦了，然后修改 docs/INDEX.md` → 授权；而登记的 fail-closed 是 `谢谢，修改 docs/INDEX.md` → 只读。同一语义两种结果。

### W3R17-03 [P2] 误拒与混合意图回归未闭合 + 逗号多子句静默部分授权（W3R15-03/W3R16-04 延续）

- **实测**（`probe3-live.mjs`、`/tmp/w3r15/probe1-corpus.mjs`、`probe4-scope.mjs`）：
  - `不修改 docs/PLAN.md，修改 docs/INDEX.md`、`先别改 docs/PLAN.md，改 docs/INDEX.md`：第十五轮 W3R15-03 明确要求闭合，**仍只读**（HTTP `authId=null`、e2e 无写 Run）；
  - `先解释 docs/INDEX.md，然后修改 docs/PLAN.md`：**仍只读**（`先` 使 `EXPLANATION_LEAD_PATTERN` 不命中，首子句被判为片段并抑制整条消息）——落在 **AC-006 混合意图**验收面；
  - `修改 docs/INDEX.md，删除 docs/PLAN.md，更新 docs/PLAN.md`／`修改 X，删除 Y，更新 Z`：逗号多子句**静默部分授权**（仅首个目标），与 `and` 版「整体只读」口径不一致。
- **性质**：均 fail-closed（无越权），但 `先解释…然后修改` 是**可用性回归**且落在 AC-006；多目标是口径不一致。
- **修复方向**：`EXPLANATION_LEAD_PATTERN` 允许 `先|请先|先帮我` 等前导；纠正例外改为「对变更动词的直接否定」判据；逗号/`and`/处置式多目标统一策略并在记录中固定。

### W3R17-04 [P2] 记录名实不符（W3R14-05/W3R15-05/W3R16-05 加重）

- **实测**：见 §8 表。要点：①T25「类别规则」的「拒绝」豁免与实现不符，并直接导致 W3R17-01；②`:261`「按结构关闭」、`:249`「非命令永不授权」、`:113`「永不下发写授权」、`:177`「其余一律只读」、`:11`「一律 INTERNAL_ERROR」等绝对表述仍在；③`plan.md` 哈希 `8986875e` 未改动，planVersion 仍为 2，T21–T25 的具体代价未登记；④`implementation.md:3` 仍 `planVersion: 1`；⑤「外置语料 40 条 0 fail-open」不可复现；⑥`../` 越界诊断待办与「只读」实现不符。
- **性质**：不单独阻断，但**直接影响 Test 基线**——若 Test 以「fail-open 已按结构关闭」为前提设计负例，§4.3 的 13 句会被判为「预期只读」而漏报。
- **建议**：把绝对表述限定为「已登记语料范围内」；`plan.md` 升版（planVersion 3）登记 T21–T25 与 W3R17-01/02/03 的实际代价与口径；同步 `implementation.md:3` 头；订正计数（15 正 + 113 负）；删除不可复现的「40 条」；订正陈旧待办。

### W3R17-05 [P3] 回归网缺口 + 正例覆盖收缩未恢复（W3R4-05/W3R14-06/07/W3R15-06/W3R16-06 延续）

- **实测**：`grep -rn "报告说不要修改\|文档写着不要修改\|在你不要修改\|the report says don't\|provided that you don't" packages/*/test apps/*/test` = **0 命中**——W3R17-01 的 13 句**零断言**；`Orchestrator` 仍不出现在 `apps/daemon/test/server.test.ts`、`packages/core/test/artifacts.test.ts`；`domain.test.ts` 处置式正例仍为 `对 docs/PLAN.md 修改`（`对 X 进行修改` 未恢复）；HTTP/Core 混合意图英文正例仍为 `explain the routing rules and 修复 docs/INDEX.md`。
- **性质**：不阻断（P1 已由自建脚本 + 真实 HTTP/e2e 证明），但修复轮必须以回归断言固化，并恢复被收缩的正例覆盖。

### W3R17-06 [P3] 协议对账与 wire 语义承接（W3R4-06/08/10/12/13、W3R9-05、W3R10-06、W3R12-07、W3R13-09、W3R14-08、W3R15-07、W3R16-07 延续）

- **实测**（`probe7-escape`）：未知字段 `foo`、`targetRole`（含非法枚举值）、`level`/`intent`、`authorization` 注入均 **202 静默忽略**，而 `protocol.md` §1 要求未知字段返回 `VALIDATION_ERROR`；`protocol.md:46` 把 `targetRole?:Role` 列为 `conversation.message.send` 合法参数，daemon 不读取；响应含 `workIds`/`authorizationId`，§5 表只列 `{messageId,workId,state,version}`（加法扩展未对账）。
- **同批承接**：`POST /artifacts/upload` 的 multipart `projectId` 被忽略、多文件只保留最后一个；`StorageError` 映射；`targetWorkId` 归属（只覆盖 message 来源）；错误响应非 §1 封装。**新增边界示例**：`修改 ./docs/INDEX.md` 授权逐字目标 `./docs/INDEX.md`（同仓库内、非越界），Test 应固定预期。

---

## 10. 计数与阻断判定

| 严重度 | 数量 | 编号 | 是否阻断 |
|---|---|---|---|
| P0 | 0 | — | — |
| **P1** | **1** | W3R17-01（「拒绝」关键词判定：否定式陈述/报告/前提重开写授权，13 句，真实 HTTP + 真实写 Run，含源码路径） | **阻断** |
| P2 | 3 | W3R17-02（逆接连词片段，B 档 + 口径不一致）、W3R17-03（误拒/混合意图/多子句部分授权，未闭合）、W3R17-04（记录/plan 名实不符，影响 Test 基线） | 不单独阻断，须随修复轮订正 |
| P3 | 2 | W3R17-05（回归网缺口 + 正例覆盖收缩）、W3R17-06（协议对账） | 不阻断，承接 Test |

- 唯一 P1 **落在本包验收面**：AC-004 负例被证伪、AC-005 授权边界被证伪；以真实 HTTP + 真实 `Orchestrator` 证明可派发真实 Backend 写 Run（含源码路径）。
- 失败路由：`Blocking Review Finding → Develop → Independent Review`（`docs/rules/workflow.md` §6）。
- 前轮 P1 的本轮裁定：**W3R16-01 的标记面已闭合、类别面残留（→ W3R17-01）**；**W3R16-02 已闭合**；**W3R16-03 加性面已闭合、逆接连词面残留（→ W3R17-02）**；**W3R15-03/W3R16-04 未修（→ W3R17-03）**；W3R16-05/06/07 未订正（→ W3R17-04/05/06）。

---

## 11. 能否进入独立 Test —— **不能**

**判据**：`docs/rules/workflow.md` §6「P0/P1 阻断」。唯一 P1 即可端到端复现（`probe3-live`：13 句 → 授权行 + L2 delivery + assessment + 真实 `backend:implementation` 写 Run）。**必须先走 `Develop → Independent Review`。**

### 11.1 修复轮最低要求

1. **修 W3R17-01**：把「拒绝」从**子句任意位置命中 `NEGATION_PATTERNS`** 收窄为**拒绝标记领起子句**（或等价的类别判定：否定必须是该子句的主谓，而不是引述/前提中的子串）。`/tmp/w3r17/probe5-fixcheck.mjs` 已验证该方向 13/13 关闭且登记语料 0 回归；**必须同时把 §4.3 的 13 句落成长期断言**。
2. **修 W3R17-02 定口径**：`但修改 X`/`但是修改 X`/`谢谢，然后修改 X` 或收窄为澄清，或在 `plan.md` 显式登记为 B 档例外；不得继续与「整条消息以连词开头同样只读」自述矛盾。
3. **修 W3R17-03**：`不修改 Y，修改 X`、`先别改 Y，改 X`、`先解释 X，然后修改 Y` 授权；统一逗号/`and`/处置式的多目标口径。
4. **订正 W3R17-04**：`plan.md` 升版登记 T21–T25 与本轮实际代价；同步 `implementation.md:3` 头与计数（15 正 + 113 负）；删除/限定绝对表述；删除不可复现的「40 条」；订正陈旧待办。
5. **补 W3R17-05**：把 §4.3 的 13 句、§6 的正例与 §11.2 的矩阵落成长期断言；恢复 `对 X 进行修改` 与英文混合意图正例覆盖；补 `assess(L2)` → `dispatch(backend/implementation)` 成功 / grant 外路径与 `deploy`/`network` 拒绝的产品用例。

以下句式必须只读并落成长期断言（W3R17-01）：

- `报告说/文档写着/需求里写着/评审说/规则要求/它说 不要修改 X，然后修改 Y`（含源码路径变体）；
- `在你不要修改 X 的前提下/由于/既然 不要修改 X，然后修改 Y`；
- `the report says don't update X, then update Y`、`provided that you don't update X, then update Y`、`given that you don't update X, then update Y`；
- 对照必须保持只读：`报告提到需要修改 X，然后修改 Y`、`如果不要修改 X，然后修改 Y`、`assuming you never update X, then update Y`；
- 对照必须保持授权：`不要修改 Y，然后修改 X`、`不要修改 Y，但要修复 X`、`别改 Y，改 X`。

### 11.2 Test 最小覆盖矩阵（修复轮后必须覆盖）

| # | 维度 | 最小用例（≥） | 期望 |
|---|---|---|---|
| 1 | **否定式陈述/报告/前提（W3R17-01，新增）** | 报告体 6 + 前提体 3 + 英文 3（共 12–13 句，含源码路径 1） | 全部只读，零授权行，零 `delivery` Work，零写 Run |
| 2 | 同形对照（W3R17-01） | `报告提到需要修改 X，然后修改 Y`、`如果不要修改 X，然后修改 Y`、`assuming you never update X, then update Y` | 只读 |
| 3 | 拒绝纠正（回归） | `不要修改 Y，然后修改 X`、`不要修改 Y，但要修复 X`、`别改 Y，改 X`、`don't fix Y, fix X` | 授权且写范围仅 Y/正确目标 |
| 4 | 逆接连词片段（W3R17-02） | `但修改 X`、`但是修改 X`、`而是要更新 X`、`谢谢，然后修改 X` | 与产品口径一致 |
| 5 | 加性片段（回归） | `也/再/就/则/另外/同时/并且/而且/然后 修改 X`、`然后修改 X` | 只读 |
| 6 | 标记族伪装（回归） | 第十六轮 18 句（问/条件/意见/引用/建议/前置条件 + 否定） | 只读 |
| 7 | 逆接连词裸 `要`（回归） | `但要修改 X`、`而是要更新 X`、`不过要删除 Y` | 只读 |
| 8 | 误拒（W3R17-03） | `不修改 Y，修改 X`、`先别改 Y，改 X`、`先解释 X，然后修改 Y` | 授权 |
| 9 | 混合意图（AC-006） | `解释 X 并修复 Y`、`explain X and fix Y` | assist + delivery，写范围仅 Y |
| 10 | 多目标口径（W3R17-03） | 中文列表 / `and` / 逗号多子句 / 处置式四种 | 与记录声明的单一口径一致 |
| 11 | 写范围恒等 | `修改 Y 而不是 X`、`参考 X 修改 Y`、`修改 Y，不要动 X`、越界 5 例 | 不扩张；越界只读且不 500 |
| 12 | 文档化正例 | 15 登记正例 + 处置式 + 礼貌尾 + 多命令并列 | 逐句授权，写范围恒为 1 |
| 13 | 登记语料 | 15 正 + 113 负 | 逐句成立 |
| 14 | HTTP 端到端（≥3 句/族） | 1/2/3/4 组经 `POST conversation.message.send` | 只读组 `authorizationId=null`、`level=none`、零授权行；正例组 L2 + 授权行 |
| 15 | **Orchestrator 回归（仍未闭合）** | 授权正例 `assess(L2)` → `dispatch backend/implementation` 成功；1/2/4 组不得建 Run；grant 外路径 + `deploy`/`network` → `NOT_AUTHORIZED` | 建 Run / 拒绝 |
| 16 | 注入面不回归 | `workItems/works/authorization/grants/scope/level/intent/targetRole/ownerUserId` 注入 | 全部忽略且零授权 |
| 17 | 前轮 P0/P1 | 下载 token 一次性、预览 ACL/CSP 逐字、`assertGrantWithinMessage`、跨会话 `targetWorkId`、追发不改写 Work | 无回归（`probe6` 17/17 已通过） |
| 18 | 附件/产物面 | 上传限制/TTL/重复绑定、版本链/失效、预览截断、单次下载 | 无回归（本轮未动，抽验即可） |

### 11.3 残余风险清单（区分已登记与未登记）

**A. 未登记缺陷 —— 必须处理（P1 阻断；P2/P3 随修复轮订正）**
1. W3R17-01 「拒绝」关键词判定：否定式陈述/报告/前提重开写授权（13 句；真实 HTTP 13、真实写 Run 13，含源码路径）。
2. W3R17-02 逆接连词片段授权（`但修改 X`/`但是修改 X`，B 档，非 A 档）。
3. W3R17-03 误拒与混合意图回归（3 句，含 AC-006）+ 逗号多子句部分授权。
4. W3R17-04 记录/plan 名实不符（含不可复现的「40 条」、陈旧待办、未同步的 `planVersion` 头与计数、绝对表述）。
5. W3R17-05 回归网缺口与正例覆盖收缩。
6. W3R17-06 协议对账与 wire 语义。

**B. 已登记 fail-closed 代价 —— 已登记，接受并需 Test 承认**
7. 未登记同义祈使（`重写/润色/rewrite/polish/tweak`）→ 只读 + 澄清（`plan.md:17-18`）。
8. 名词短语祈使（`修改 X 中的错别字`、`fix the typo in X`、`把 X 里的错别字改掉`、`对 X 进行修改`、`更新 X 的说明`）→ 只读 + 澄清（T21/T22/T25 概括声明，未逐项登记）。
9. 目标优先日常祈使（`X 的错别字麻烦处理下`）→ 只读 + 澄清（T19/T20/T21）。
10. 中文多目标列表与排除式（`修改 X、Y`、`修改 X 而不是 Y`）→ 只读；`and` 版同口径只读；逗号多子句仍部分授权（见 W3R17-03）。
11. 标记子串导致路径名/复合词误拒（`过时/会议/了解/no-index/yes-notes`）→ 只读（方向安全）。
12. 仓库外目标（`..`/`/`/`~`）→ 只读、不 500（已闭合，需 Test 固定）。
13. 语义分类的最终责任在 WP-04/06 模型 Assessment；本包只承诺已登记语料与形态规则。

**C. 与本包无关或已承接**
14. W3R17-05/06 与 W3R4-05/06/08/10/12/13、W3R13-08/09、W3R14-06/07/08、W3R15-06/07、W3R16-06/07 同项（P3，结算前登记或修复）。
15. 真实无头浏览器攻防（WP-10）；真实 Provider 纵向与 `artifact_write` 工具接线（WP-10/WP-07）。

### 11.4 承接包（交下一轮 Develop / Test）

- 修复目标（按优先级）：W3R17-01 → W3R17-02（口径） → W3R17-03 → W3R17-04（记录） → W3R17-05（回归网） → W3R17-06（协议）。
- 验收脚本模板：`/tmp/w3r17/probe2-framing.mjs`（定界）、`probe3-live.mjs`（真实 HTTP + Orchestrator）、`probe4-scope.mjs`（写范围）、`probe5-fixcheck.mjs`（修复方向，13/13 关闭 + 登记语料 0 回归），配合 `/tmp/w3r15/probe4-registered.mjs`（登记语料）与 `/tmp/w3r14/probe6-prior.mjs`（前轮 P0/P1）。
- Test 轮若在修复前执行，必须把 §4.3 的 13 句与 W3R17-02/03 纳入 not_covered 并显式标注，不得按「fail-open 已按结构关闭」放行。

---

## 12. 方法与边界声明

- **独立上下文**：未读取任何开发/Test 会话；结论只来自仓库文件、`docs/**` 契约与我自建的 5 个脚本（`probe1-corpus` 13 848 例、`probe2-framing` 31 例、`probe3-live` 39 例真实 HTTP + Orchestrator、`probe4-scope` 510 + 102 例、`probe5-fixcheck` 修复方向）+ 只读复用的 13 个脚本。全部消费 `pnpm build` 产物；**未 import 任何产品测试文件**（`domain.test.ts` 仅以文本方式提取语料）。
- **实验统计（观测 / 缺陷证据）**：见 §4.2 总表。
- **对开发方主张的裁决**：**大部分成立**。「标记并集」确实关闭了第十六轮登记的 18 句（HTTP fail-open 25→0、e2e 15→0），「逆接连词裸 `要`」与「加性片段」也闭合。但「类别规则作为第二道」不成立：`classSuppressed` 的「拒绝」豁免仍是关键词命中，导致**否定式陈述/报告/前提**这一未登记但同根因的通道仍然 fail-open。因此**越权方向并未按结构关闭**，只是把可达面从「否定 + 标记」缩到「否定 + 无标记陈述」。
- **未做**：真实无头浏览器执行、真实 Provider 纵向、Docker 容器内复验、故障注入下的孤儿 blob 复验、`pnpm test:e2e`/`test:acceptance`（脚本按设计指向 WP-09/WP-10，未实现）。
- **未改仓库**：本轮只覆盖写入 `.agentdev/work/WP-03/review.md`（本报告）；除该文件外 `git status --porcelain` 为空，`HEAD` 仍为 `87f50e4e8f99cec1fd8948d96e731a184576b03c`，全部 6 条契约命令在上述工作树上执行。`/tmp/w3r17/fixed-requests.mjs` 是 `dist/requests.js` 的 `/tmp` 副本，**不是**对仓库文件的修改。

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

## 附十五：第十五轮摘要（保留）

第十五轮（报告冻结于 `351b851`，**被审代码树 `d2e4ff5`**，第十五轮修复提交为 `90ce877` + `f9337c9`）结论 **FAIL（0×P0、2×P1、3×P2、2×P3）**：

- **W3R15-01 [P1]** 前件门只关掉了承接副词、未关掉并列连词：`然后/并且/同时/而且/并/and/then` 在 `allowed = index === 0 || clause.conjunction` 下无条件放行，未登记前件 + 连词重开 W3R14-01（G1 20/41 fail-open；HTTP 17、e2e 8，含源码路径）——**第十六轮判定：T24 以「子句类别」关闭了连词形态（归零），但同一实现把抑制并集改成类别豁免，等价通道以「否定 + 变更动词」伪装成拒绝子句重开 → W3R16-01**。
- **W3R15-02 [P1]** 裸 `要` 仍被 `ADVERB_LEAD_PATTERN` 的 `(?:要)?` 剥除，且 `previousWasRefusal` 以 `NEGATION_PATTERNS` 为唯一判据（把 `不用改 X` 这类陈述也算拒绝），`另外要更新 X`、`也要修改 X`、`但要修改 X`、`目前不用改 X，也要更新 Y` 等 7 句越权——**第十六轮判定：连词/副词形态已闭合（`另外要更新 X`、`也要修改 X` 等 6 句只读）；逆接连词形态 `但要修改 X` 仍授权，未满足「仅在拒绝子句后剥离」的要求 → W3R16-02**。
- **W3R15-03 [P2]** 拒绝纠正不完整：`不修改 Y，修改 X`、`先别改 Y，改 X` 仍只读——**第十六轮仍未修 → W3R16-04**。
- **W3R15-04 [P2]** 多目标/多子句静默部分授权（`修改 X and Y`、`修改 X，删除 Y，更新 Z`）——**第十六轮：`and` 版改为只读（与声明一致），逗号多子句仍部分授权 → W3R16-04**。
- **W3R15-05 [P2]** 记录名实不符：T23「情态词不再被剥离」与实现不符、T23「外置语料 40 条 0 fail-open」不可复现、T21/T22 计数未订正、`implementation.md:3` 仍 `planVersion: 1`、`plan.md` 未改动、绝对表述仍在——**第十六轮 T24 新增「其余任何子句 ⇒ 不授权」「不依赖条件词表」两条不成立主张，并被 `90ce877` 提交信息放大 → W3R16-05**。
- **W3R15-06 [P3]** 回归网缺口 + 正例覆盖收缩（英文混合意图、`对 X 进行修改`）——**第十六轮仍在 → W3R16-06**。
- **W3R15-07 [P3]** 协议对账与 wire 语义承接（未知字段 202 静默忽略等）——**第十六轮仍在 → W3R16-07**。
- 第十五轮以自建 5 个脚本（`/tmp/w3r15/probe1..5`）+ 复用脚本取证：143 句自建语料 31 A 档 + 3 PARTIAL + 2 误拒 + 7 B 档；HTTP 45 句 24 句落库授权；真实 Orchestrator 28 句 14 句建立写 Run；第十四轮 hold-out 201 句复跑 6 fail-open + 2 partial；登记 14 正 + 89 负 0 偏差；客户端注入 0 通路；前轮 P0/P1 17/17。
- 第十五轮的两位对立方（开发 vs 评审）共同根因：**「形态判定退化为词表/前缀枚举」**；第十六轮进一步证明，把「抑制并集」替换为「类别豁免」会以新的等价通道（否定/解释领起伪装）重开同一方向。

## 附十六：第十六轮摘要（保留）

第十六轮（报告冻结于 `f9337c9`，**被审代码树同为 `f9337c9`**，第十六轮修复提交为 `8929ffe` + `87f50e4`）结论 **FAIL（0×P0、2×P1、3×P2、2×P3）**：

- **W3R16-01 [P1]** 「子句类别」把原本的抑制并集改成类别豁免：命中 `NEGATION_PATTERNS` 或 `EXPLANATION_LEAD` 的问句/条件/意见/引用/建议/前置条件被当成「拒绝/显式解释请求」而不再抑制整条消息（`不用改 X 的话，然后修改 Y` 等 18 句 A 档；HTTP 19、e2e 12，含源码路径；base `d2e4ff5` 只读 → `f9337c9` 授权）——**第十七轮判定：标记面已闭合（7 族 18 句在真实 HTTP 上 fail-open 0、e2e 写 Run 0）；但同一「拒绝」豁免未改，否定式陈述/报告/前提通道重开 → W3R17-01（P1）**。
- **W3R16-02 [P1]** 裸 `要` 的逆接连词形态仍授权（`但要修改 X`、`而是要更新 X`、`不过要删除 Y`；`normalizeCore` 与前一子句无关地剥离裸 `要`，且 `但/但是` alternation 顺序使 `但是要修复 X` 反而只读）——**第十七轮判定：已闭合（4/4 只读，长优先顺序已修）**。
- **W3R16-03 [P2]** 承接副词/连词开头的**单句片段**仍被归一成命令（`也修改 X`、`同时也修改 X`、`然后修改 X` 等；B 档，非回归）——**第十七轮判定：加性面已闭合（`也/再/然后/同时/并且/而且/另外/顺便` 全只读）；逆接连词面 `但修改 X`/`但是修改 X` 仍授权 → W3R17-02**。
- **W3R16-04 [P2]** 误拒与混合意图回归（`不修改 Y，修改 X`、`先别改 Y，改 X`、`先解释 X，然后修改 Y`、`修改 Y，X 保持不动`）+ 逗号多子句仍静默部分授权——**第十七轮仍未修 → W3R17-03**。
- **W3R16-05 [P2]** 记录名实不符：T24「其余任何子句 ⇒ 不授权」「不依赖条件词表」与 `90ce877` 提交信息被证伪；`plan.md` 哈希 `8986875e` 未改动；`implementation.md:3` 仍 `planVersion: 1`；「外置语料 40 条 0 fail-open」不可复现；`../` 待办陈旧；计数未更新；绝对表述仍在——**第十七轮：T25 新增「类别规则作为第二道」的不成立主张，其余仍未订正 → W3R17-04**。
- **W3R16-06 [P3]** 回归网缺口 + 正例覆盖收缩（18 句零断言；无 Orchestrator 授权用例；`对 X 进行修改` 与英文混合意图正例未恢复）——**第十七轮仍在，且 W3R17-01 的 13 句同样零断言 → W3R17-05**。
- **W3R16-07 [P3]** 协议对账与 wire 语义承接（未知字段 202 静默忽略、响应字段多于协议表、multipart/`projectId`、`StorageError` 映射、`targetWorkId` 归属、错误响应非 §1 封装）——**第十七轮仍在 → W3R17-06**。
- 第十六轮以自建 8 个脚本（`/tmp/w3r16/probe1..8`）+ 只读复用 5 个脚本取证：223 句 A 档 0、110 句洗白族 1、34 句类别伪装 26 授权；HTTP 49 句 25 落库授权；真实 Orchestrator 25 句 15 建写 Run；登记 15 正 + 104 负 0 偏差；客户端注入 0 通路；前轮 P0/P1 17/17。
- 第十六轮的共同根因：**「抑制」被拆成「标记并集」与「类别豁免」两套判据，而类别豁免中的「拒绝」是关键词命中**；第十七轮证明标记并集有效，但「拒绝」关键词命中仍以「否定 + 无标记陈述」的形式重开同一 fail-open 方向。
