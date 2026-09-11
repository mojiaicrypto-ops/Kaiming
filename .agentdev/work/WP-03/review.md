# WP-03 独立 Review 报告（第十六轮）

- 评审对象：工作包 WP-03「直接协作与说明产物」
- 评审轮次：**第十六轮**（第一～十五轮摘要见文末「附一～附十五」，全部保留）
- 冻结点 / HEAD：`git rev-parse HEAD` = `f9337c97c5632e7da95d2e113402438c8f78c5d2`（= 任务下达的 `f9337c9`，**无漂移**）
- 工作树：全部契约命令执行前后 `git status --porcelain` 为空；除本报告外无未提交修改
- 评审角色：Review（独立上下文；未读取任何开发/Test 会话；只依据仓库文件、契约文档与我自建的 `/tmp/w3r16/` 8 个脚本 + 只读复用 `/tmp/w3r15|w3r14|w3r13/` 的 5 个 hold-out 脚本）
- 工具：`node v24.8.0`、`pnpm 12.3.4`、macOS 宿主；全部脚本消费 `pnpm build` 产物（`packages/domain/dist`、`packages/core/dist`、`apps/daemon/dist`、`packages/storage/dist`），**未 import 任何产品测试文件**（`domain.test.ts` 仅以文本方式提取语料）
- 记录哈希（`git hash-object`，前 8 位）：`packages/domain/src/requests.ts` **`c9a2dfc9`**（第十五轮 `0f71414a`）、`packages/domain/test/domain.test.ts` **`21634077`**（第十五轮 `2cbfbd5f`）、`apps/daemon/src/server.ts` `3a348304`、`packages/core/src/messages.ts` `283d4c04`、`packages/core/src/preview.ts` `803b502a`、`packages/core/src/artifacts.ts` `057ff403`、`packages/core/src/attachments.ts` `3ee94838`（五个文件与第十三～十五轮**逐字相同**）、`.agentdev/work/WP-03/plan.md` **`8986875e`（与第十一～十五轮逐字相同，仍未改动）**、`.agentdev/work/WP-03/implementation.md` `2a3af3f6`
- 变更范围：`90ce877`（`requests.ts` +71/−26 净 +45、`domain.test.ts` +16、`implementation.md` +12）、`f9337c9`（`requests.ts` +6、`domain.test.ts` +4、`implementation.md` +1/−1）。`packages/core/src/**`、`apps/daemon/src/**`、`docs/**`、`plan.md` **零改动**
- 权威依据：`AGENTS.md`、`docs/INDEX.md`、`docs/rules/{workflow,agents}.md`、`docs/product/experience.md`（§3）、`docs/architecture/{data,protocol,execution,reliability}.md`、`docs/delivery/{implementation,acceptance}.md`（AC-001..006/052/076/084）、`.agentdev/work/WP-03/{plan,implementation,review}.md`、`packages/**`、`apps/daemon/**`、相关测试

---

## 1. 结论

**FAIL（不能进入独立 Test；按 `docs/rules/workflow.md` §6 走 `Blocking Review Finding → Develop → Independent Review`）。**

本轮判 **FAIL（0×P0、2×P1、3×P2、2×P3）**。

T24 的两条修复**部分成立**，必须逐条区分：

- **成立的部分（可复核的真实改善）**：
  - **登记语料零回归**：第十五轮登记的 **15 正 + 104 负**（f9337c9 后）在构建产物上逐句复跑 **0 偏差**（`probe4-registered`）；
  - **第十五轮 P1 的主体闭合**：`视具体情况，然后/并且/同时/而且/并修改 X`、`经审批，然后修改 X`、`看结果，然后修复 X`、`depending on the result, then update X` 等第十五轮 20 句 A 档越权**归零**（round-15 hold-out 143 句：fail-open 31 → **2**）；
  - **裸 `要` 的连词/副词形态闭合**：`另外要更新 X`、`也要修改 X`、`目前不用改 X，也要更新 Y`、`暂时不用改 X，另外要更新 Y`、`需求里提到要修改 X，然后也要更新 Y` 全部只读（第十五轮 P1 的 7 句中有 6 句闭合）；
  - **仓库外目标闭合（f9337c9）**：`修改 ../secret.md`、`/etc/hosts.md`、`~/.ssh/config.md`、`docs/../../secret.md` 在真实 HTTP 上 **202 + `authId=null` + 零授权行**，不再 500，也不产生写授权（`probe7-escape`）；
  - **前轮 P0/P1 无回归**：`probe6-prior` **17/17** 通过；`packages/core/**`、`apps/daemon/src/**`、`preview.ts` 哈希与第十三～十五轮逐字相同。
- **不成立的部分（本轮 P1）**：
  1. **T24 的「子句类别」判据把原本的「抑制并集」改成了「类别豁免」，重开了上一轮已关闭的问句/条件/意见/引用/建议/前置条件通道**：只要该子句同时命中 `NEGATION_PATTERNS`（含否定 + 变更动词）或 `EXPLANATION_LEAD`，它就被当作「拒绝 / 显式解释请求」这类良性子句而**不再抑制整条消息**，其后的命令子句照常获授权。`不用改 docs/PLAN.md 的话，然后修改 docs/INDEX.md`（条件）、`不要修改 docs/PLAN.md 吗，然后修改 docs/INDEX.md`（提问）、`不要修改 docs/PLAN.md 是明智的，然后修改 docs/INDEX.md`（意见）、`需求写着"不要修改 docs/PLAN.md"，然后修改 docs/INDEX.md`（引用）、`建议不要修改 docs/PLAN.md，然后修改 docs/INDEX.md`（建议）、`不要修改 docs/PLAN.md 前需要审批，然后修改 docs/INDEX.md`（前置条件）等 **18 句在 `d2e4ff5`（T23）上只读、在 `f9337c9` 上越权**（base→T24 差分，`probe4-diff`）。
  2. **裸 `要` 的逆接连词形态仍未闭合**：`但要修改 X`、`而是要更新 X`、`不过要删除 Y` 仍产生可派发的写授权。第十五轮明确要求「`要` 仅在**前一子句是拒绝**时剥离」，而 `normalizeCore` 实现为「子句本身以逆接连词开头即剥离」，与前一子句无关（`probe1`/`probe2`/`probe5`/`probe6`）。

两条 P1 均落在本包验收面（AC-004 负例、AC-005 授权边界、`workflow.md` §1/§6），**全部以真实 HTTP + 真实 `Orchestrator` 端到端可复现**（含 `packages/core/src/orchestrator.ts` 源码目标与真实 `backend:queued` 写 Run），**阻断 Test**。

| 维度 | 第十五轮 | 第十六轮 |
|---|---|---|
| 目标优先整类 | 已关闭 | **保持关闭** |
| 动词优先无尾文法 | 已关闭 | **保持关闭**（round-15 hold-out 143 句 A 档仅剩 1） |
| 前件 + 承接副词（`就/再/也/但/则`） | 已关闭 | **保持关闭** |
| 前件 + 并列连词（`然后/并且/同时/而且/并/and/then`） | 20 句 fail-open | **归零（T24 关闭）** |
| 情态 `需要/应该/必须/得/该` | 已关闭 | **保持关闭** |
| 情态裸 `要`（连词/副词形态） | 3 开 + 4 纯陈述 | **归零** |
| 情态裸 `要`（逆接连词形态 `但要/而是要/不过要`） | 3 句 fail-open | **3 句仍开（W3R16-02）** |
| 问句/条件/意见/引用/建议/前置条件（**含否定+变更动词**） | 已关闭 | **18 句新越权（W3R16-01，回归）** |
| 承接副词片段（`也/就/再/然后/并/同时…修改 X`） | 未单列 | **11 句授权（W3R16-03，B 档）** |
| 拒绝纠正 `不修改 A，修改 B` / `先别改 A，改 B` | 误拒 | **仍误拒（W3R16-04）** |
| 混合意图 `先解释 X，然后修改 Y` | 授权 | **回归只读（W3R16-04）** |
| 多目标 `and` 静默部分授权 | 3 句 | **`and` 版已只读；逗号多子句仍部分授权（W3R16-04）** |
| 登记语料 | 14 正 + 89 负 | **15 正 + 104 负，0 偏差** |
| 客户端注入面 | 无通路（11 项） | **无通路（11 项）** |
| 仓库外目标 | `../` 返回 500 | **只读、不 500（f9337c9 闭合）** |
| 前轮 P0/P1 复验 | 17/17 | **17/17** |
| P1 数量 | 2 | **2（其一为新引入回归）** |

---

## 2. 契约命令原始结果（本轮实跑）

执行目录：仓库根；在 `HEAD=f9337c9`、工作树干净时执行；`pnpm build` 产物由本轮 build 生成。逐条串行，原始日志：`/tmp/w3r16/contract.log`。

| 命令 | 退出码 | 原始结果要点 |
|---|---|---|
| `pnpm build` | **0** | `pnpm -r build`，**8** 个 workspace `build: Done`：`contracts, cli, domain, storage, core, daemon, pi-runtime, runner` |
| `pnpm typecheck` | **0** | `tsc -p tsconfig.json --pretty false`，无输出 |
| `pnpm lint` | **0** | `All matched files use Prettier code style!` |
| `pnpm test:unit` | **0** | `Test Files 19 passed (19)`、`Tests 289 passed (289)` |
| `pnpm test:integration` | **0** | `Test Files 10 passed (10)`、`Tests 124 passed (124)` |
| `pnpm docs:check` | **0** | `docs:check ok — 15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages` |

`git status --porcelain`（写入本报告前）：**空输出**；`HEAD` 全程 `f9337c97c5632e7da95d2e113402438c8f78c5d2`。
计数对账：`implementation.md` T24（`:284`）的 `289 / 124 / 8 / docs:check ok` 与实测**一致**。但本提交仍未把 §4 的 18 句新越权语料落入断言（见 W3R16-06）。

**命令全绿不等于必验范围成立**：本轮全部越权与误拒证据在仓库测试内**零断言**；`Orchestrator` 仍不出现在 `apps/daemon/test/server.test.ts`、`packages/core/test/artifacts.test.ts`（W3R4-05 承接）。

---

## 3. 方法：base / T24 差分

为把「T24 是否真正关闭方向」与「是否引入回归」分开，我把 `351b851`（= `d2e4ff5` 代码树）的 `packages/domain/src/requests.ts` 提取到 `/tmp/w3r16/base-requests.ts`（仅把 `@agentdev/contracts` 导入改为构建产物绝对路径），用 Node 类型擦除直接运行，与 `f9337c9` 的 `packages/domain/dist` 逐句对比。**这是本轮全部「回归」判定的证据基础，未修改任何仓库文件。**

---

## 4. 越权（fail-open）方向：独立穷举核验

### 4.1 口径声明（先声明后实测）

- **缺陷（fail-open，A 档）**：句子整体不是祈使指令（条件门控 / 陈述 / 状态 / 意见 / 评价 / 引用 / 建议 / 提问 / 前置条件），却在 `routeMessage` 上产生 `explicitAuthorization=true` 并落到 `delivery` 写 Work。
- **非缺陷（已声明代价，planVersion 2 / T19–T24）**：未登记同义变更词（`重写/润色/polish`）、名词短语祈使（`修改 X 中的错别字`、`fix the typo in X`、`把 X 里的错别字改掉`、`对 X 进行修改`）、目标优先日常祈使、排除式（`修改 Y 而不是 X`）、多目标列表 → 只读 + 澄清。
- **非缺陷（真祈使 / 混合）**：`并/and` 连接的两个真祈使；显式祈使子句 + 同消息内的陈述/条件子句（其授权目标就是用户祈使点名的目标）。
- **B 档（形态可辩）**：`也修改 X`、`然后修改 X`、`但要修改 X` 这类**单句片段**——可读作省略主语的祈使，也可读作陈述/承接片段。本轮单列，不混入 A 档。
- **判定分档**：A 明确非命令（计入缺陷）；B 形态可辩（单列）；C 真祈使；F 已声明 fail-closed。

### 4.2 语料与结果总表（全部消费 `pnpm build` 产物）

| 脚本 | 观测 | 结果 |
|---|---|---|
| `probe1-corpus.mjs`（自建，223 句，12 族：中英文陈述/条件前件/条件后件/疑问/选择/意见/片段/模态/承接副词/引用/排除/多目标/中英混合/拒绝纠正/严格命令/声明代价/越界） | **FAIL-OPEN 0**、FALSE-REJECT 4、UNEXPECTED-WRITE 1、AMBIG-WRITE 22 | 第十五轮的 31 句 A 档归零 |
| `probe2-launder.mjs`（自建，110 句：逆接连词、副词/连词前缀、陈述归一、良性前件、条件伪装、引用/排除、文档化正例） | **FAIL-OPEN 1**（`同时也修改 X`）、FALSE-REJECT 3、AMBIG-WRITE 27 | B 档残留 |
| `probe3-smuggle.mjs`（自建，34 句：抑制类别伪装成良性类别） | **26 句授权**（含 6 提问 + 2 条件 + 3 意见 + 3 引用 + 4 说明领起 + 8 纠正） | **W3R16-01** |
| `probe4-diff.mjs`（自建，50 句 base↔T24 差分） | **NEW-FAIL-OPEN 18**、NEW-FALSE-REJECT 6、SCOPE-CHANGE 0 | **W3R16-01/02/04** |
| `probe5-http.mjs`（自建，49 句真实 daemon：真实 SQLite + 真实 blob + Bearer） | **25 句非命令落库授权**（L2 + 1 授权行 + 1 assessment），4 句正例误拒 | **W3R16-01/02/03/04** |
| `probe6-e2e.mjs`（自建，25 句真实 HTTP → 真实 `assess` → 真实 `dispatch`） | **15 句非命令各建立 1 个真实 `backend:queued` 写 Run**（含 `packages/core/src/orchestrator.ts`）；2 句应授权者无写 Run | **W3R16-01/02/03/04** |
| `probe7-escape.mjs`（自建，12 项：越界目标 + wire 语义） | 越界 5/5 只读不 500；未知字段/`targetRole`/`authorization` 注入 **202 静默忽略、零授权行** | f9337c9 闭合；W3R16-07 |
| `/tmp/w3r15/probe1-corpus.mjs`（复用，143 句第十五轮 hold-out） | **fail-open 2**（`但要修改 X`、逗号多子句部分授权）、false-reject 3、ambiguous 2 | W3R16-02/04 |
| `/tmp/w3r14/probe1-corpus.mjs`（复用，201 句第十四轮 hold-out） | **FAIL-OPEN 1**（`但要修改 X` 族）、FALSE-REJECT 4、PARTIAL 0 | W3R16-02/04 |
| `/tmp/w3r15/probe4-registered.mjs`（复用） | 登记 **15 正 + 104 负**，**0 偏差** | 回归网成立 |
| `/tmp/w3r14/probe5-injection.mjs`（复用，11 注入） | 0 授权行、0 越权 Work、0 L3 Work | 注入面无通路 |
| `/tmp/w3r14/probe6-prior.mjs`（复用，17 项前轮 P0/P1） | **17/17 通过** | 无回归 |
| `/tmp/w3r13/probe8-scope.mjs`（复用，29 项作用域） | **0 扩张**；逗号多子句 1 项部分授权 | §5 |

### 4.3 实证证据句（A 档，均为 base 只读 → T24 授权）

```
不用改 docs/PLAN.md 的话，然后修改 docs/INDEX.md      base=只读  T24=AUTHORIZES   ← 条件（W3R16-01）
不用改 docs/PLAN.md 之后，修改 docs/INDEX.md          base=只读  T24=AUTHORIZES   ← 条件
不要修改 docs/PLAN.md 吗，然后修改 docs/INDEX.md      base=只读  T24=AUTHORIZES   ← 提问
不要修改 docs/PLAN.md 可以吗，修改 docs/INDEX.md      base=只读  T24=AUTHORIZES   ← 提问
禁止修改 docs/PLAN.md 吗，然后修改 docs/INDEX.md      base=只读  T24=AUTHORIZES   ← 提问
不要修改 docs/PLAN.md 是明智的，然后修改 docs/INDEX.md base=只读  T24=AUTHORIZES   ← 意见
禁止修改 docs/PLAN.md 属于越权，然后修改 docs/INDEX.md base=只读  T24=AUTHORIZES   ← 意见
不要修改 docs/PLAN.md 是必要的，然后修改 docs/INDEX.md base=只读  T24=AUTHORIZES   ← 意见
"不要修改 docs/PLAN.md"，然后修改 docs/INDEX.md       base=只读  T24=AUTHORIZES   ← 引用
需求写着"不要修改 docs/PLAN.md"，然后修改 docs/INDEX.md base=只读 T24=AUTHORIZES   ← 引用
你提到不要修改 docs/PLAN.md，然后修改 docs/INDEX.md   base=只读  T24=AUTHORIZES   ← 引用
建议不要修改 docs/PLAN.md，然后修改 docs/INDEX.md     base=只读  T24=AUTHORIZES   ← 建议
关于不要修改 docs/PLAN.md 的建议，然后修改 docs/INDEX.md base=只读 T24=AUTHORIZES  ← 主题/建议
不要修改 docs/PLAN.md 前需要审批，然后修改 docs/INDEX.md base=只读 T24=AUTHORIZES  ← 前置条件
说明 docs/PLAN.md 的话，然后修改 docs/INDEX.md        base=只读  T24=AUTHORIZES   ← 解释领起 + 条件
但要修改 docs/INDEX.md                              base=授权  T24=AUTHORIZES   ← 第十五轮 P1 未闭合（W3R16-02）
而是要更新 docs/INDEX.md                            base=授权  T24=AUTHORIZES   ← 同上
不过要删除 docs/PLAN.md                             base=授权  T24=AUTHORIZES   ← 同上
同时也修改 docs/INDEX.md                            base=授权  T24=AUTHORIZES   ← B 档片段（W3R16-03）
```

**同形反向对照（证明根因是「类别豁免」而不是「条件词表」）**

```
视具体情况，然后修改 X        -> 只读      （T24 的类别规则生效：片段 ⇒ 抑制）
不用改 X 的话，然后修改 X      -> AUTHORIZES （同一「条件」，但命中 NEGATION ⇒ 被当成拒绝 ⇒ 豁免）
不要修改 X 吗，然后修改 X      -> AUTHORIZES （同一「提问」，但命中 NEGATION ⇒ 被当成拒绝 ⇒ 豁免）
不要修改 X 是明智的，然后修改 X -> AUTHORIZES （同一「意见」，但命中 NEGATION ⇒ 被当成拒绝 ⇒ 豁免）
另外要更新 X                  -> 只读      （T24 已修）
但要修改 X                    -> AUTHORIZES （逆接连词形态仍剥离裸 `要`）
但是要修复 X                  -> 只读      （`ADVERB_LEAD_PATTERN` alternation 先匹配 `但`，`是` 残留 ⇒ 更严，形态不一致）
```

### 4.4 HTTP 端到端（`probe5-http.mjs`，真实 daemon）

49 句：**25 句非命令落库授权** —— HTTP 202、`authorizationId` 非空、新增 1 条 `authorization` 行、新 Work `level=["L2"]`、`intent=["delivery"]`、`writes` 为句中路径、写入 1 条 `assessment`。A 档 19 句（`W3R16-01`）、B 档 3 句（`W3R16-02` 的逆接连词）+ 3 句（`W3R16-03` 副词片段）。
对照组：登记负例 9/9 只读（`authId=null`、`level=none`、零授权行）；登记正例 9/9 授权；**4 句误拒**（`不修改 Y，修改 X`、`先别改 Y，改 X`、`先解释 X，然后修改 Y`、`修改 Y，X 保持不动`）。
其中 `不用改 docs/PLAN.md 的话，然后修改 packages/core/src/orchestrator.ts` 落库授权 `packages/core/src/orchestrator.ts`（源码路径）。

### 4.5 真实 Orchestrator 端到端（`probe6-e2e.mjs`）

25 句：**15 句非命令各建立 1 个真实 `backend/implementation` 写 Run**（`writeRuns=["…:backend:queued:writes=[…]"]`），全部经 `assess`（L2 + `authorizationRef` 通过 `verifyAuthorization`）与 Chief 父 Run；其中 12 句属 `W3R16-01`、2 句属 `W3R16-02`、1 句属 `W3R16-03`，且 `不用改 docs/PLAN.md 的话，然后修改 packages/core/src/orchestrator.ts` 建立**源码**写 Run。否定对照组 3/3 只读；正例 5/5 建写 Run；**2 句登记/回归正例误拒**。→ **准入闸门正常，越权来自授权判定本身。**

### 4.6 危害上界

- 越权范围恒等于句中**被点名的那一个路径**，`operations=['read','edit']`、`networkTargets=[]`；环境/网络/越界路径仍被 `verifyAuthorization` 拒绝（作用域实验 **0 扩张**）。
- 目标不限 `docs/`：源码路径同样可授权并建立真实 `backend:queued` 写 Run（已实测）。
- 危害是「用户只是陈述/加条件/提问，却产生可执行的**源码**写授权与真实写 Run」，属 `workflow.md` §6 的 P1（错误行为/需求缺失）+ AC-004 负例失败；无环境/网络/数据删除通路，不构成 P0。

---

## 5. 写范围恒等复核（`probe8-scope.mjs` 在本轮 build 上复跑）

- **扩张方向：未发现缺陷。** `pathsIn(core).includes(target)` 仍保证写范围 ⊆ 句中路径；新增的 18 句越权的目标都是第二子句点名的路径，被否定/条件的路径（`Y`）未进入 `writePaths`。
- `修改 Y，X 保持不动`、`修改 Y，不要动 X` → 仅授权 Y；`参考 X 修改 Y`、`修改 Y 而不是 X`、`update Y instead of X`、`把 Y 参照 X 改掉`、`把 X 和 Y 都改掉` → 全部只读。
- **部分授权仍在**：`修改 X，删除 Y，更新 Z` → 仅 `["X"]`（逗号多子句）；`修改 X and Y`、`delete X and Y` 本轮已改为**只读**（与声明一致），但 `修复 X，删除 Y` 是登记正例（只授权 X）。→ 口径不一致延续（W3R16-04）。

---

## 6. 文档化正例与 fail-closed 取舍复核

- **必须授权正例（登记 15 条）**：文本提取（`probe4-registered`，引号感知、**不 import** 测试文件）后逐句用**构建产物**复跑 → **15/15 授权，`writePaths` 长度恒为 1，0 偏差**。
- **严格命令/处置式**：`修复/修改/更新/处理/删除/清理 X`、`fix/update X`、`把 X 改掉`、`将 Y 删除`、`对 Y 修改` **全部可用**。
- **混合意图**：`解释 X 并修复 Y`、`explain X and fix Y` 可用（HTTP 建 2 Work）；**`先解释 X，然后修改 Y` 回归只读**（base 授权；`先` 使 `EXPLANATION_LEAD_PATTERN` 不命中，首子句被判为「片段」而抑制整条消息）——W3R16-04。
- **拒绝纠正**：`不要修改 Y，但要修复 X`、`别改 Y，改 X`、`不要改 Y，改 X`、`don't fix Y, fix X` 授权且范围仅 X；**`不修改 Y，修改 X`、`先别改 Y，改 X` 仍只读**（W3R16-04/第十五轮 W3R15-03）。
- **礼貌尾**：`修改 X。谢谢` 授权；`谢谢，修改 X`、`麻烦了，修改 X` 只读（fail-closed，未登记）。
- **已声明 fail-closed（8/8 只读）**：`修改 X 中的错别字`、`fix the typo in X`、`把 X 里的错别字改掉`、`对 X 进行修改`、`X 的错别字麻烦处理下`、`重写 X`、`rewrite X`、`润色 X`。**方向为 fail-closed，不产生越权。**
- **仓库外目标（f9337c9 新增）**：`修改 ../secret.md`、`修改 /etc/hosts.md`、`修改 ~/.ssh/config.md`、`修改 docs/../../secret.md`、`update ../secret.md` → 只读、零授权、无 500（`probe7-escape`）。**闭合成立。**

---

## 7. 客户端注入面、前轮 P0/P1 无回归

### 7.1 注入面（`probe5-injection.mjs`，本轮 build + 真实 HTTP，只读复用）

| 注入 | HTTP | 库结果 |
|---|---|---|
| `workItems:[…×50]` / `works:[…×50]` | 202（静默忽略） | workDelta=1、authDelta=0、无 write |
| `authorization:{scope:{…}}` / `{operations:['deploy']}` | 202（忽略） | authDelta=0、`authorizationId=null` |
| `grants:[…]` / `scope+level+intent` | 202（忽略） | 零授权行、无 L3 Work |
| `targetWorkId`（不存在/跨会话） | **404 / 403** | 零副作用 |
| 未知字段 `foo`/`targetRole`/`ownerUserId` | 202（**静默忽略**） | 无副作用（承接 `protocol.md` §1/§3，W3R16-07） |
| 空 body / 缺 `conversationId` / 未知 `conversationId` | **400 / 400 / 404** | 零副作用 |

**结论：wire 层不存在 `authorization`/`workItems`/`works`/`grants`/`scope`/`level`/`intent` 通路，11 项注入零授权行、零越权 Work，无回归。`apps/daemon/src/server.ts` 哈希 `3a348304` 与第十三～十五轮逐字相同（零改动）。**

### 7.2 前轮 P0/P1 复核（`probe6-prior.mjs`，**17/17**）

| 项目 | 本轮实测 | 状态 |
|---|---|---|
| W3-01 下载 token 可预测/先于认证（P0） | token 不内嵌 artifactId；首次 200、二次 403 | 无回归 |
| W3-02 产物读取无主体维度（P0） | 预览走 `assertReadable`；CSP 逐字、sandbox、`credentials: omit`、无 `set-cookie`、`nosniff` 全成立 | 无回归 |
| W3R3-01 授权 capability 缺口致死锁（P1） | 正例 `assess`/`dispatch` 全通（含 `readPaths`+`read`） | 无回归 |
| W3R3-06 CSP 单头/逐字相等（P2） | `preview.ts` 哈希 `803b502a` 未变 | 无回归 |
| W3R4-03 `assertGrantWithinMessage` 约束 `readPaths` | 代码仍在（`messages.ts`）；HTTP `authorization` 注入被忽略 | 无回归 |
| W3R4 `targetWorkId` 跨会话 / 追发不改写 Work | 跨 Conversation → **403**；追发后 `level`/`authorizationRef` 不变 | 无回归 |
| W3R7-01 只读请求词授权（P1） | `帮我看一下/请评估/列出/总结/检查` 全只读 | 无回归 |
| W3R7-03 混合否定+指令（P1） | `不要修改 A，但要修复 B`、`别改 A，改 B` 授权 B；`不修改 A，改 B`/`先别改 A，改 B` 仍只读 | **部分闭合（→ W3R16-04）** |
| A1 目标级排除（P1） | `修改 Y 而不是 X` 只读 | 无回归 |
| A2 中文/英文混合意图（P1） | `解释 X 并修复 Y`、`explain X and fix Y` 只授权 Y | 无回归 |
| A3 纯建议（P1） | `请给出 X 的修改建议`、`请列出 X 里的错误` 只读 | 无回归 |
| W3R12/13 动词优先尾、选择/疑问尾、`conditional` 复位、处置式（P1） | 第十三/十四轮登记语料全只读 | 已闭合 |
| W3R14-01（P1） | 承接副词面已关闭；连词面本轮 **归零** | **已闭合** |
| W3R14-02/W3R15-02（P1） | `需要` 面与连词/副词裸 `要` 面已闭合；**逆接连词裸 `要` 面仍开** | **部分闭合（→ W3R16-02）** |
| W3R15-01（P1，连词重开前件门） | T24 关闭；但**同族以「否定+变更动词」伪装为拒绝子句重开** | **形式闭合/实质回归（→ W3R16-01）** |
| W3R15-03/W3R15-04（P2） | 未修 | **未闭合（→ W3R16-04）** |
| 登记语料 15 正 + 104 负 | **0 偏差** | 无回归 |
| `packages/core/**`、`apps/daemon/src/**`、`preview.ts` | 哈希与第十三～十五轮逐字相同 | 零改动 |

**未闭合承接**（P3，不单独阻断）：W3R4-05/W3R15-06/W3R16-06（无 Orchestrator 授权回归用例）、W3R4-06/W3R15-07/W3R16-07（`protocol.md` §5 未对账）、W3R4-08（`StorageError` 映射粗）、W3R4-10（`targetWorkId` 归属只覆盖 message 来源）、W3R4-12（multipart 多文件 / `projectId`）、W3R4-13（错误响应非 §1 封装）。

---

## 8. 记录与实现一致性核对（逐条复核表）

| 记录主张（来源） | 实测 | 结论 |
|---|---|---|
| 冻结 `HEAD=f9337c9` | 一致，`git status` 干净 | **准确** |
| T24「只有命令/拒绝/纯礼貌/显式解释请求是良性子句；其余任何子句（陈述、条件、片段、意见、提问——无论是否在词表中）⇒ 整条消息不授权」 | **证伪**：`不用改 X 的话，然后修改 Y`（条件）、`不要修改 X 吗，然后修改 Y`（提问）、`不要修改 X 是明智的，然后修改 Y`（意见）、`"不要修改 X"，然后修改 Y`（引用）均授权；这些子句确实不属于四类良性子句，却因同时命中 `NEGATION_PATTERNS` 而被豁免 | **不成立（W3R16-01/05）** |
| T24 修复 1「这样…都只读，且**不依赖条件词表**」 | 条件识别对「命中 NEGATION 的条件句」失效；对 `的话/之后` 需靠词表 | **不成立（W3R16-01/05）** |
| `90ce877` 提交信息「closes the preamble/postamble condition channels without a keyword list」 | 同形反向对照与 base 差分证明**未关闭**（18 句回归） | **不成立（W3R16-01）** |
| T24「`normalizeCore` 仅在子句以逆接连词开头时剥离裸 `要`」 | 与实现一致（`:252-256`）；但**与第十五轮要求的「仅当前一子句是拒绝时剥离」不同**，导致 `但要修改 X`（无前文）仍授权 | **实现一致 / 需求未满足（W3R16-02）** |
| T24「`另外要更新 X`、`也要修改 X` 保持陈述并被抑制」 | 一致（只读） | **准确** |
| T24「纠正例外收窄：`也/再/就/则/并且/而且/然后/同时` 开头不允许」 | 一致 | **准确** |
| T24「删除已失效的 `CONDITION_PATTERNS`」 | 一致；但删除后**没有等价的类别覆盖**，直接导致 W3R16-01 的条件通道回归 | **不完整（W3R16-01）** |
| `f9337c9`「含 `..`/`/`/`~` 的目标不被授权，请求只读而不在事务深处失败」 | 一致：HTTP 202、零授权、无 500（5/5） | **准确** |
| `f9337c9`「订正记录中「含名词短语祈使仍授权」的假声明」 | 一致（`implementation.md:226` 已更正） | **准确** |
| T24 待办「`../` 越界改为 `VALIDATION_ERROR`」 | 实现改为**只读**（不报 `VALIDATION_ERROR`），待办条目已过期未订正 | **记录陈旧（W3R16-05）** |
| T24「回归网：新增第十五轮 12 条必须只读 + 1 条必须授权」 | 90ce877 实为 12 负 + 1 正；f9337c9 再加 3 负；登记累计 **15 正 + 104 负**（第十五轮报告口径 14+89） | **计数不完整（W3R16-05）** |
| T24「外置语料 40 条 0 fail-open」 | 仓库内**无可复现的 40 条语料文件**；第十四轮 hold-out 复跑仍有 1 句越权 | **不可复现（W3R16-05）** |
| `implementation.md:3` `planVersion: 1` | `plan.md:3` 为 `planVersion: 2` | **记录头未同步（第五轮延续，W3R16-05）** |
| `plan.md` 是否登记 T21–T24 的新代价 | 哈希 `8986875e` 与第十一～十五轮**逐字相同**；只保留 `:17-18` 的一般性边界声明，未登记连词/裸 `要`/类别豁免/副词片段的具体代价 | **未登记（W3R16-05）** |
| T16「不再出现「一律/永不」的绝对表述」 | `:11`「一律 `INTERNAL_ERROR`」、`:113`「永不下发写授权」、`:177`「其余一律只读」、`:249`「非命令永不授权」、`:261`「fail-open 方向现已按结构关闭」原文仍在 | **名实不符（W3R16-05）** |
| T24「unit 289 / integration 124 / build 8 / docs:check ok」 | 与实测**一致** | **准确** |
| T24「目标必须与消息点名的路径逐字相同」 | `pathsIn(core).includes(target)` 在（`:274`）；`修改 X...` 只读 | **准确** |
| T24「礼貌尾子句忽略」 | `修改 X。谢谢` 授权；`修改 X。不太明智` 只读 | **准确** |
| 处置式正例 `对 Y 进行修改` | 仍只读；`domain.test.ts:295` 仍是 `对 docs/PLAN.md 修改`，未恢复也未逐项登记 | **未登记（W3R16-06）** |
| HTTP/Core 测试混合意图正例措辞 | `apps/daemon/test/server.test.ts:467`、`packages/core/test/artifacts.test.ts:480` 仍为 `explain the routing rules and 修复 docs/INDEX.md`（英文原例未恢复） | **测试覆盖收缩（W3R16-06）** |

**记录侧硬约束（对 Test 有直接影响）**：T24 明确宣称「其余任何子句 ⇒ 整条消息不授权」「不依赖条件词表」，`90ce877` 提交信息进一步宣称已关闭条件通道。若 Test 据此设计负例，§4.2 的 18 句会被判为「预期只读」而漏报。

---

## 9. 新 Findings（W3R16-xx）

### W3R16-01 [P1] 「子句类别」把抑制并集改成类别豁免：命中 `NEGATION`/`EXPLANATION_LEAD` 的问句、条件、意见、引用、建议、前置条件重开前件门（`90ce877` 引入的回归）

- **位置**：`packages/domain/src/requests.ts:382-393`（`readings` 与 `suppressed` 的类别豁免）、`:109-113`（`NEGATION_PATTERNS` 覆盖「否定 + 变更动词」，也匹配陈述/提问/条件用法）、`:347-357`（`readClause` 的判定顺序把 NEGATION/EXPLANATION 列为良性）、`:390-393`（`suppressed` 只看 `reading.target===undefined && !refusal && !polite && !explanationLead`）。**被删掉的** `CONDITION_PATTERNS` 与上一版 `suppressed` 的并集（QUESTION/CHOICE/ADVICE/COMMENT/CONDITION/HYPOTHETICAL/PRECONDITION）没有任何等价替代。
- **实测（我自建，未登记）**：`probe4-diff.mjs` base→T24 **NEW-FAIL-OPEN 18/50**；`probe3-smuggle.mjs` 34 句中 26 句授权（提问 6、条件 2、意见 3、引用 3、说明领起 4）；`probe5-http.mjs` 19 句落库授权（L2 + 1 授权行 + 1 assessment）；`probe6-e2e.mjs` **12 句建立真实 `backend:implementation` 写 Run**（含 `packages/core/src/orchestrator.ts`）。
- **证据句**：`不用改 docs/PLAN.md 的话，然后修改 docs/INDEX.md`、`不用改 docs/PLAN.md 之后，修改 docs/INDEX.md`、`不要修改 docs/PLAN.md 吗，然后修改 docs/INDEX.md`、`不要修改 docs/PLAN.md 可以吗，修改 docs/INDEX.md`、`不用改 docs/PLAN.md 吗，然后修改 docs/INDEX.md`、`不需要修改 docs/PLAN.md 是不是更好，然后修改 docs/INDEX.md`、`请勿修改 docs/PLAN.md 吗，然后修改 docs/INDEX.md`、`禁止修改 docs/PLAN.md 吗，然后修改 docs/INDEX.md`、`不要修改 docs/PLAN.md 是明智的，然后修改 docs/INDEX.md`、`禁止修改 docs/PLAN.md 属于越权，然后修改 docs/INDEX.md`、`不要修改 docs/PLAN.md 是必要的，然后修改 docs/INDEX.md`、`"不要修改 docs/PLAN.md"，然后修改 docs/INDEX.md`、`需求写着"不要修改 docs/PLAN.md"，然后修改 docs/INDEX.md`、`你提到不要修改 docs/PLAN.md，然后修改 docs/INDEX.md`、`建议不要修改 docs/PLAN.md，然后修改 docs/INDEX.md`、`关于不要修改 docs/PLAN.md 的建议，然后修改 docs/INDEX.md`、`不要修改 docs/PLAN.md 前需要审批，然后修改 docs/INDEX.md`、`说明 docs/PLAN.md 的话，然后修改 docs/INDEX.md`。
- **判别依据（同形反向 + 时间对照）**：`视具体情况，然后修改 X` 只读 vs `不用改 X 的话，然后修改 X` 授权；且**同一组句子在 `d2e4ff5`（T23）上全部只读**——证明这是 T24 的**回归**，不是「未登记的残余」。根因是把「抑制」从**并集**改成**类别豁免**：良性类别（拒绝/解释/礼貌/命令）无条件免于抑制，于是「否定+变更动词」的问句/条件/意见/引用只要沾上 NEGATION 就被当成拒绝。
- **修复方向（已在 `/tmp` 副本上验证，`probe8-fixcheck.mjs`）**：把上一版的抑制并集**叠加**回类别规则（而不是用类别规则替换它）：
  `suppressed = union(QUESTION, CHOICE, ADVICE, COMMENT, CONDITION, HYPOTHETICAL, PRECONDITION) || 类别规则`。
  实测（变体 B）：**18/18 新越权全部关闭**，同时**登记 15 正 + 104 负 0 偏差**、round-14/15 hold-out 只读语料 0 偏差。注意**不能**把 `STATEMENT_PATTERNS` 并入并集——其 `要 + 变更动词` 子模式会命中 `不要修改 X` 内部，从而误杀登记正例 `不要修改 A，但要修复 B`（我已在 `/tmp` 上以变体 A 复现该副作用）。
- **验收面**：AC-004 负例失败、AC-005 授权边界失败；`workflow.md` §1「执行消息可直接授权明确目标」被扩大到「条件/提问/意见/引用句 + 命令句」。

### W3R16-02 [P1] 裸 `要` 的逆接连词形态仍授权（第十五轮 W3R15-02 未按最低要求闭合）

- **位置**：`requests.ts:252-256`（`normalizeCore`：`if (/^(?:但|但是|而是|不过)/u.test(clause.trim())) core = core.replace(/^要/u,'')`）、`:229-230`（`ADVERB_LEAD_PATTERN` 的 `但|但是|…` alternation 顺序）。
- **实测**：`probe1-corpus` F-fragment `但要修改 X`/`而是要更新 X`/`不过要删除 Y` 授权；round-15 hold-out `FAIL-OPEN 2` 中含此句；HTTP 3 句落库授权；e2e 2 句建立真实写 Run。
- **判别依据**：第十五轮 §10.1 第 2 条明确要求「`要` **仅在「前一子句是拒绝」时**剥离」。当前实现与**前一子句无关**：`但要修改 X` 作为**整条消息的第一子句**（无任何前文、无任何拒绝）仍被剥成 `修改 X` 而授权。对照 `另外要更新 X`（本轮已修，只读）与 `但要修改 X`（仍授权），差别只在逆接连词。
- **附带形态不一致（同根因）**：`ADVERB_LEAD_PATTERN` 的 alternation 先匹配 `但`，`但是` 因此永不生效——`但是修改 X`、`但是要修复 X` 落在 `是…` 前缀上变只读，而 `但修改 X`、`但要修复 X` 授权。同一语义两种结果。
- **修复方向**：把「前一子句是拒绝」作为剥离裸 `要` 的前提（即并入 W3R7-03 的纠正例外），或在授权前对**未归一**文本重跑 `STATEMENT_PATTERNS`；`ADVERB_LEAD_PATTERN` 的长词优先（`但是|而是|不过|但` 排序）一并修正。
- **验收面**：同 W3R16-01。

### W3R16-03 [P2] 承接副词/连词开头的**单句片段**仍被归一成命令（`也修改 X`、`同时也修改 X`…）

- **位置**：`requests.ts:229-230`（`ADVERB_LEAD_PATTERN` 无条件剥离 `也|就|再|然后|并且|同时|而且|并|另外|先|特别|重点|…`）。
- **实测**：`probe2-launder` ADVONLY 族 12/20 授权；`probe1-corpus` F-fragment/H-adverb 共 22 句 AMBIG-WRITE；HTTP 3 句落库授权、e2e 1 句写 Run。**证据句**：`也修改 X`、`同时也修改 X`、`然后修改 X`、`并修改 X`、`另外修改 X`、`先修改 X`、`特别修改 X`、`重点修改 X`。
- **性质**：与 base **相同**（非回归）；这些片段可读作省略主语的祈使，因此列 **B 档**，不并入 A 档。但它们确实违背 T24 自己的表述「其余任何子句 ⇒ 整条消息不授权」，且与已修好的「前件 + 连词」形态（`视具体情况，然后修改 X` 只读）判据不一致。
- **修复方向**：或明确把「单句以承接副词/连词开头」也登记为 fail-closed 代价并写进 `plan.md`/回归网，或收窄为「首子句不得由承接副词引入」（把该形态记为澄清）。需产品口径。

### W3R16-04 [P2] 误拒与混合意图回归：`不修改 Y，修改 X`、`先别改 Y，改 X`、`先解释 X，然后修改 Y`、`修改 Y，X 保持不动`；逗号多子句仍静默部分授权

- **位置**：`requests.ts:409-414`（纠正例外的 `adversative || !/^(?:也|再|就|则|并且|而且|然后|同时)/` 判定）、`:282-283`（`EXPLANATION_LEAD_PATTERN` 不允许 `先/请先` 等前导副词）、`:390-393`（任何非良性子句 ⇒ 整条抑制）、`CLAUSE_SPLIT_PATTERN`（逗号不构成 conjunction）。
- **实测（`probe4-diff` NEW-FALSE-REJECT 6；`probe1-corpus` FALSE-REJECT 4；`probe7-prior2` 4 项）**：
  - `不修改 docs/PLAN.md，修改 docs/INDEX.md`、`先别改 docs/PLAN.md，改 docs/INDEX.md`：第十五轮 W3R15-03 要求闭合，**仍未修**（HTTP `authId=null`、e2e 无写 Run）；
  - `先解释 docs/INDEX.md，然后修改 docs/PLAN.md`：**新回归**——base 授权 `docs/PLAN.md`，T24 只读（`先` 使 `EXPLANATION_LEAD_PATTERN` 不命中，首子句被判为片段并抑制整条消息）；同族 `先说明 X，然后修复 Y` 同样回归。这是**文档化「混合意图」（AC-006）**的常见表达；
  - `修改 docs/PLAN.md，docs/INDEX.md 保持不动`：base 授权 `docs/PLAN.md`，T24 只读（整条抑制）；第十五轮曾列为正例/作用域样例；
  - `修改 X，删除 Y，更新 Z` → 仍只授权 `X`（静默丢弃其余目标）；`修改 X and Y` 本轮已改为只读，与逗号形态口径不一致。
- **性质**：均为 fail-closed（无越权），但其中 `先解释…然后修改` 是**可用性回归**且落在 AC-006 验收面；`不修改…修改` 是上一轮明确点名的未闭合项。
- **修复方向**：`EXPLANATION_LEAD_PATTERN` 允许 `先|请先|先帮我` 等前导；纠正例外改为「对变更动词的直接否定」判据；多目标口径统一（逗号/`and`/处置式取同一策略）并在记录中固定。

### W3R16-05 [P2] 记录名实不符并新增不准确项（W3R14-05/W3R15-05 加重）

- **实测**：见 §8 表。要点：①T24「其余任何子句 ⇒ 不授权」「不依赖条件词表」与 `90ce877`「closes the condition channels」**被 §4 证伪**；②`但要修改 X` 仍授权，记录未披露裸 `要` 的逆接连词通道；③`plan.md` 哈希 `8986875e` **未改动**，T21–T24 的具体代价未登记（仅保留 `:17-18` 一般性声明）；④`implementation.md:3` 仍 `planVersion: 1`；⑤T24「外置语料 40 条 0 fail-open」不可复现；⑥T24 待办「`../` 越界改为 `VALIDATION_ERROR`」与 f9337c9 的「只读」实现不符；⑦计数未随 f9337c9 更新（实为 15 正 + 104 负）；⑧`:11/:113/:177/:249/:261` 的「一律/永不/按结构关闭」绝对表述仍在。
- **性质**：不单独阻断，但**直接影响 Test 基线**——若 Test 以「条件通道已按结构关闭」为前提设计负例，本轮 18 句 P1 会被判为「预期只读」而漏报。
- **建议**：把绝对表述限定为「已登记语料范围内」；把 W3R16-01/02/03/04 的实际后果写入 `plan.md`（planVersion 3）并同步 `implementation.md:3` 头；订正计数；明确「结构性」仅指**命令内部文法**，不覆盖类别豁免、逆接连词与承接副词前缀。

### W3R16-06 [P3] 回归网缺口 + 正例覆盖收缩未恢复（W3R14-06/07、W3R15-06 延续）

- **实测**：`grep -rn "不要修改.*吗\|不用改.*的话\|是明智的，然后\|你提到不要修改\|建议不要修改\|说明 docs/PLAN.md 的话\|同时也要修改\|先解释\|保持不动" packages/*/test apps/*/test` = **0 命中**——本轮 18 句 P1 与 4 句误拒**零断言**；`Orchestrator` 仍不出现在 `apps/daemon/test/server.test.ts`、`packages/core/test/artifacts.test.ts`；`domain.test.ts:295` 仍为 `对 docs/PLAN.md 修改`；`apps/daemon/test/server.test.ts:467`、`packages/core/test/artifacts.test.ts:480` 仍为 `explain the routing rules and 修复 docs/INDEX.md`。
- **性质**：不阻断（P1 已由自建脚本 + base 差分证明），但修复轮必须以回归断言固化，并恢复被收缩的正例覆盖。**承接**：与 W3R4-05 同项。

### W3R16-07 [P3] 协议对账与 wire 语义承接（W3R4-06/08/10/12/13、W3R9-05、W3R10-06、W3R12-07、W3R13-09、W3R14-08、W3R15-07 延续）

- **实测**（`probe7-escape`）：未知字段 `foo`、`targetRole`（含非法枚举值 `not-a-role`）、`level`/`intent`、`authorization` 注入均 **202 静默忽略**，而 `protocol.md` §1 要求未知字段返回 `VALIDATION_ERROR`；`protocol.md:46` 把 `targetRole?:Role` 列为 `conversation.message.send` 合法参数，daemon 不读取；响应含 `workIds`/`authorizationId`，§5 表只列 `{messageId,workId,state,version}`（加法扩展未对账）。
- **同批承接**：`POST /artifacts/upload` 的 multipart `projectId` 被忽略、多文件只保留最后一个；`StorageError` 映射、`targetWorkId` 归属（只覆盖 message 来源）、错误响应非 §1 封装。
- **本轮观察（新增）**：`修改 ./docs/INDEX.md` 会授权**逐字**目标 `./docs/INDEX.md`（同仓库内、非越界），可作为「目标逐字相等」口径的边界示例，无需修复但应在 Test 中固定预期。

---

## 10. 计数与阻断判定

| 严重度 | 数量 | 编号 | 是否阻断 |
|---|---|---|---|
| P0 | 0 | — | — |
| **P1** | **2** | W3R16-01（类别豁免回归：条件/提问/意见/引用重开前件门，18 句）、W3R16-02（裸 `要` 逆接连词形态仍授权，第十五轮 P1 未闭合） | **阻断** |
| P2 | 3 | W3R16-03（承接副词片段，B 档）、W3R16-04（误拒与混合意图回归 + 多目标口径）、W3R16-05（记录/plan 名实不符，影响 Test 基线） | 不单独阻断，须随修复轮订正 |
| P3 | 2 | W3R16-06（回归网缺口 + 正例覆盖收缩）、W3R16-07（协议对账） | 不阻断，承接 Test |

- 两条 P1 **均落在本包验收面**：AC-004 负例被证伪、AC-005 授权边界被证伪；均以真实 HTTP + 真实 `Orchestrator` 证明可派发真实 Backend 写 Run（含源码路径）。
- 失败路由：`Blocking Review Finding → Develop → Independent Review`（`docs/rules/workflow.md` §6）。
- 前轮 P1 的本轮裁定：**W3R14-01、W3R15-01（连词面）已闭合**；**W3R14-02/W3R15-02 部分闭合（连词/副词裸 `要` 面关闭，逆接连词面仍开 → W3R16-02）**；**W3R15-01 的关闭以「类别豁免」实现，等价通道以否定伪装重开（→ W3R16-01）**；W3R13-05/W3R14-06/W3R15-03 未修（→ W3R16-04）。

---

## 11. 能否进入独立 Test —— **不能**

**判据**：`docs/rules/workflow.md` §6「P0/P1 阻断」。两条 P1 中任意一条即足以阻断，且均可端到端复现。**必须先走 `Develop → Independent Review`。**

### 11.1 修复轮最低要求

1. **恢复抑制并集**（修 W3R16-01）：`suppressed = union(QUESTION, CHOICE, ADVICE, COMMENT, CONDITION, HYPOTHETICAL, PRECONDITION) || 类别规则`；**不得**把 `STATEMENT_PATTERNS` 直接并入并集（其 `要 + 变更动词` 子模式会误杀 `不要修改 A，但要修复 B`，已在 `/tmp` 变体 A 复现）。并保留 `说明 … 的话` 这类「解释领起 + 条件」的抑制。
2. **逆接连词剥离裸 `要` 需有前提**（修 W3R16-02）：仅当前一子句是拒绝（或并入 W3R7-03 纠正例外）时剥离；同时修正 `ADVERB_LEAD_PATTERN` 的 `但/但是` alternation 顺序。
3. **修误拒与混合意图回归**（修 W3R16-04）：`不修改 Y，修改 X`、`先别改 Y，改 X` 授权；`先解释 X，然后修改 Y` 恢复 assist+delivery；统一多目标口径（逗号/`and`/处置式）。
4. **承接副词片段定口径**（修 W3R16-03）：或收窄为澄清，或在 `plan.md` 显式登记为 fail-closed/B 档。
5. **记录同步**（修 W3R16-05）：`plan.md` 升版登记本轮全部新代价与口径；订正 `implementation.md:3` 头与计数（15 正 + 104 负）；删除/限定绝对表述；删除不可复现的「40 条」；订正「`../` 改为 `VALIDATION_ERROR`」的陈旧待办。
6. **回归网补全**（修 W3R16-06）：把 §4.3 的 18 句 A 档、§6 的正例、§11.2 的矩阵落成长期断言；恢复英文混合意图与 `对 X 进行修改` 正例覆盖；补 `assess(L2)` → `dispatch(backend/implementation)` 成功 / grant 外路径与 `deploy`/`network` 拒绝的产品用例。

以下新增句必须只读并落成长期断言：

- **抑制类别伪装族（W3R16-01）**：`不用改 X 的话，然后修改 Y`、`不用改 X 之后，修改 Y`、`不要修改 X 吗，然后修改 Y`、`不要修改 X 可以吗，修改 Y`、`不用改 X 吗，然后修改 Y`、`不需要修改 X 是不是更好，然后修改 Y`、`请勿修改 X 吗，然后修改 Y`、`禁止修改 X 吗，然后修改 Y`、`不要修改 X 是明智的，然后修改 Y`、`禁止修改 X 属于越权，然后修改 Y`、`不要修改 X 是必要的，然后修改 Y`、`"不要修改 X"，然后修改 Y`、`需求写着"不要修改 X"，然后修改 Y`、`你提到不要修改 X，然后修改 Y`、`建议不要修改 X，然后修改 Y`、`关于不要修改 X 的建议，然后修改 Y`、`不要修改 X 前需要审批，然后修改 Y`、`说明 X 的话，然后修改 Y`。对照 `视具体情况，然后修改 Y`（只读）与 `不要修改 X，但要修复 Y`（授权 Y）。
- **逆接连词裸 `要`（W3R16-02）**：`但要修改 X`、`而是要更新 X`、`不过要删除 Y` 应只读；对照 `不要修改 Y，但要修复 X` 保持授权。
- **不得回归（正例）**：登记 15 条逐句授权且写范围只含命令自身目标；`不修改 Y，修改 X`、`先别改 Y，改 X`、`别改 Y，改 X`、`不要改 Y，改 X`、`don't fix Y, fix X`、`不要修改 Y，但要修复 X` 授权 X；`解释 X 并修复 Y`、`explain X and fix Y`、`先解释 X，然后修改 Y`、`把 X 改掉`、`将 Y 删除`、`对 Y 修改`、`修改 X。谢谢`。
- **已声明 fail-closed（断言只读，不算缺陷）**：`修改 X 中的错别字`、`fix the typo in X`、`把 X 里的错别字改掉`、`对 X 进行修改`、`X 的错别字麻烦处理下`、`重写/润色/rewrite/polish`、`修改 X、Y`、`修改 X 而不是 Y`、`修改 ../secret.md`、`修改 /etc/hosts.md`、`修改 ~/.ssh/config.md`。
- **B 档待产品口径（先登记，再决定收窄）**：`也修改 X`、`同时也修改 X`、`然后修改 X`、`并修改 X`、`另外修改 X`、`但要修改 X`。

### 11.2 Test 最小覆盖矩阵（修复轮后必须覆盖）

| # | 维度 | 最小用例（≥） | 期望 |
|---|---|---|---|
| 1 | **抑制类别伪装（W3R16-01，新增）** | 条件/提问/意见/引用/建议/前置条件各 ≥2（共 18 句） | 全部只读，零授权行，零 `delivery` Work |
| 2 | 逆接连词裸 `要`（W3R16-02） | `但要修改 X`、`而是要更新 X`、`不过要删除 Y` 各 1；对照 `不要修改 Y，但要修复 X` | 前 3 只读；对照授权 X |
| 3 | 承接副词片段（W3R16-03） | `也/就/再/然后/并/同时/另外/先修改 X` 各 1 | 与产品口径一致（当前授权 → 需登记或收窄） |
| 4 | 前件 + 连词/副词（回归） | `视具体情况，然后/并且/同时/并修改 X`、`视具体情况，就/再/也/但修改 X` 各 1 | 只读 |
| 5 | 情态（回归） | `但需要修改 X`、`另外需要修改 X`、`另外要更新 X`、`也要修改 X`、`目前不用改 X，也要更新 Y` 各 1 | 只读 |
| 6 | 后置条件（回归） | `修改 X，如果没问题`、`修改 X，一旦确认`、`修改 X，但是可能需要审批` 各 1 | 只读 |
| 7 | 否定后纠正（W3R16-04） | `别改 Y，改 X`、`不要改 Y，改 X`、`不修改 Y，修改 X`、`先别改 Y，改 X`、`don't fix Y, fix X`、`不要修改 Y，但要修复 X` 各 1 | 授权且写范围仅 X |
| 8 | 混合意图（W3R16-04） | `解释 X 并修复 Y`、`explain X and fix Y`、`先解释 X，然后修改 Y` 各 1 | assist + delivery，写范围仅 Y |
| 9 | 多目标口径（W3R16-04） | 中文列表 / `and` / 逗号多子句 / 处置式四种 | 与记录声明的单一口径一致 |
| 10 | 目标优先关闭（回归） | 16 谓词 × ≥2 动词 | 只读 |
| 11 | 尾巴/选择/条件复位（回归） | 第十三/十四轮登记负例 | 只读，零授权行 |
| 12 | 处置式/排除/越界 | `把 X 改掉`、`将 Y 删除`、`对 Y 修改`、`修改 Y 而不是 X`、`修改 ../secret.md` | 授权仅目标；排除式与越界只读，越界不 500 |
| 13 | 登记语料 | 15 正 + 104 负 | 逐句成立 |
| 14 | HTTP 端到端（≥3 句/族） | 上述 1/2/3/7 组经 `POST conversation.message.send` | 只读组 `authorizationId=null`、`level=none`、零授权行、无 `delivery` Work |
| 15 | **Orchestrator 回归（仍未闭合）** | 授权正例 `assess(L2)` → `dispatch backend/implementation` 成功；上述 1/2 组不得建 Run；grant 外路径 + `deploy`/`network` → `NOT_AUTHORIZED` | 建 Run / 拒绝 |
| 16 | 注入面不回归 | `workItems/works/authorization/grants/scope/level/intent/targetRole/ownerUserId` 注入 | 全部忽略且零授权（未知字段按 W3R16-07 决定后断言） |
| 17 | 前轮 P0/P1 | 下载 token 一次性、预览 ACL/CSP 逐字、`assertGrantWithinMessage`、跨会话 `targetWorkId`、追发不改写 Work | 无回归（`probe6` 17/17 已通过） |
| 18 | 附件/产物面 | 上传限制/TTL/重复绑定、版本链/失效、预览截断、单次下载 | 无回归（本轮未动，抽验即可） |

### 11.3 残余风险清单（区分已登记与未登记）

**A. 未登记缺陷 —— 必须处理（P1 阻断；P2/P3 随修复轮订正）**
1. W3R16-01 类别豁免回归（18 句 A 档；HTTP 19、e2e 12，含源码路径，base 只读）。
2. W3R16-02 逆接连词裸 `要` 仍授权（3 句；HTTP 3、e2e 2；第十五轮 P1 未按最低要求闭合）。
3. W3R16-03 承接副词片段授权（12 句；B 档，非回归，但违背 T24 自述口径）。
4. W3R16-04 误拒与混合意图回归（4 句；含 AC-006 的 `先解释…然后修改`）+ 多目标口径不一致。
5. W3R16-05 记录/plan 名实不符（含不可复现的「40 条 0 fail-open」、陈旧待办、未同步的 `planVersion` 头与计数）。
6. W3R16-06 回归网缺口与正例覆盖收缩。
7. W3R16-07 协议对账与 wire 语义。

**B. 已登记 fail-closed 代价 —— 已登记，接受并需 Test 承认**
8. 未登记同义祈使（`重写/润色/rewrite/polish/tweak`）→ 只读 + 澄清（`plan.md:17-18`）。
9. 名词短语祈使（`修改 X 中的错别字`、`fix the typo in X`、`把 X 里的错别字改掉`、`对 X 进行修改`、`更新 X 的说明`）→ 只读 + 澄清（T21/T22/T24-f9337c9 概括声明，仍未逐项登记）。
10. 目标优先日常祈使（`X 的错别字麻烦处理下`）→ 只读 + 澄清（T19/T20/T21）。
11. 中文多目标列表与排除式（`修改 X、Y`、`修改 X 而不是 Y`）→ 只读；`修改 X and Y` 本轮同口径为只读；逗号多子句仍部分授权（见 W3R16-04）。
12. 标记子串导致路径名/复合词误拒（`过时/会议/了解/no-index/yes-notes`）→ 只读（方向安全）。
13. 仓库外目标（`..`/`/`/`~`）→ 只读、不 500（f9337c9 新增，**已闭合**，需 Test 固定）。
14. 语义分类的最终责任在 WP-04/06 模型 Assessment；本包只承诺已登记语料与形态规则。

**C. 与本包无关或已承接**
15. W3R16-06/07 与 W3R4-05/06/08/10/12/13、W3R13-08/09、W3R14-06/07/08、W3R15-06/07 同项（P3，结算前登记或修复）。
16. 真实无头浏览器攻防（WP-10）；真实 Provider 纵向与 `artifact_write` 工具接线（WP-10/WP-07）。

### 11.4 承接包（交下一轮 Develop / Test）

- 修复目标（按优先级）：W3R16-01 → W3R16-02 → W3R16-04 → W3R16-03（口径） → W3R16-05（记录） → W3R16-06（回归网） → W3R16-07（协议）。
- 建议以 `/tmp/w3r16/probe4-diff.mjs`（base↔修复 差分）、`probe3-smuggle.mjs`（类别伪装）、`probe5-http.mjs`/`probe6-e2e.mjs`（真实 HTTP/Orchestrator）作为修复轮的验收脚本模板；`probe8-fixcheck.mjs` 展示了「并集 + 类别规则」变体可 18/18 关闭且登记语料 0 偏差。
- Test 轮若在修复前执行，必须把 §11.1 的 18 句与 4 句误拒纳入 not_covered 并显式标注，不得按「条件通道已按结构关闭」放行。

---

## 12. 方法与边界声明

- **独立上下文**：未读取任何开发/Test 会话；结论只来自仓库文件、`docs/**` 契约与我自建的 8 个脚本（`probe1-corpus` 223 句、`probe2-launder` 110 句、`probe3-smuggle` 34 句、`probe4-diff` 50 句 base↔T24、`probe5-http` 49 句真实 HTTP、`probe6-e2e` 25 句真实 Orchestrator、`probe7-escape` 12 项、`probe8-fixcheck` 修复方向验证）+ 只读复用 `/tmp/w3r15/probe1-corpus.mjs`（143 句）、`probe4-registered.mjs`、`/tmp/w3r14/probe1-corpus.mjs`（201 句）、`probe5-injection.mjs`（11 注入）、`probe6-prior.mjs`（17 项）、`probe7-prior2.mjs`（23 项）、`/tmp/w3r13/probe8-scope.mjs`（29 项）。全部消费 `pnpm build` 产物；**未 import 任何产品测试文件**（`domain.test.ts` 仅以文本方式提取语料）。
- **实验统计（观测 / 缺陷证据）**：见 §4.2 总表。
- **对开发方主张的裁决**：**部分成立**。「连词前件」「连词/副词裸 `要`」「仓库外目标」三组可复核闭合；但「其余任何子句 ⇒ 整条消息不授权」「不依赖条件词表」被 **18 句 base↔T24 差分**证伪（类别豁免重开问句/条件/意见/引用/建议/前置条件），且第十五轮明确要求的「裸 `要` 仅在拒绝子句后剥离」未落地。根因与第十三～十五轮一致，仍是**形态判定在词表/前缀与类别豁免之间移动边界**。
- **未做**：真实无头浏览器执行、真实 Provider 纵向、Docker 容器内复验、故障注入下的孤儿 blob 复验、`pnpm test:e2e`/`test:acceptance`（脚本按设计指向 WP-09/WP-10，未实现）。
- **未改仓库**：本轮只覆盖写入 `.agentdev/work/WP-03/review.md`（本报告）；除该文件外 `git status --porcelain` 为空，`HEAD` 仍为 `f9337c97c5632e7da95d2e113402438c8f78c5d2`，全部 6 条契约命令在上述工作树上执行。`/tmp/w3r16/fixed-requests.ts`、`base-requests.ts` 均为 `/tmp` 副本，**不是**对仓库文件的修改。

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
