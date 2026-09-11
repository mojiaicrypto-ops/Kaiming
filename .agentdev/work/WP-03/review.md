# WP-03 独立 Review 报告（第十二轮）

- 评审对象：工作包 WP-03「直接协作与说明产物」
- 评审轮次：**第十二轮**（第一～十一轮摘要见文末「附一～附十一」，全部保留）
- 冻结点 / HEAD：`git rev-parse HEAD` = `b6357a9f54ba65a820e00c383b56ed0d007a9793`（**与任务下达的 `HEAD=b6357a9` 一致**）；`git diff --name-only d98ac43 HEAD` 只有 `.agentdev/work/WP-03/review.md`，**被审代码树 = `d98ac43`**
- 工作树：本轮全部命令执行前后 `git status --porcelain` 为空；被审代码树（`packages/**`、`apps/**`、`docs/**`）无任何未提交修改（写入本报告后才会出现 ` M .agentdev/work/WP-03/review.md`）
- 评审角色：Review（独立上下文；未读取任何开发/Test 会话；只依据仓库文件、契约文档与 `/tmp/w3r12/` 下我自建的 8 个实验脚本 + 复用 `/tmp/w3r11/` 的 3 个只读回归脚本）
- 工具：`node v24.8.0`、`pnpm 12.3.4`、macOS 宿主
- 记录哈希（`git hash-object`，前 8 位）：`packages/domain/src/requests.ts` **`7ecd54a8`**（T19 修复后）、`packages/domain/test/domain.test.ts` **`1ce35a07`**、`.agentdev/work/WP-03/implementation.md` **`52f22276`**、`.agentdev/work/WP-03/plan.md` `8986875e`（**与第十一轮逐字相同**）、`packages/core/src/messages.ts` `283d4c04`、`packages/core/src/artifacts.ts` `057ff403`、`packages/core/src/attachments.ts` `3ee94838`、`packages/core/src/preview.ts` `803b502a`、`apps/daemon/src/server.ts` `3a348304`
- 变更范围（第十一轮后）：只有 `packages/domain/src/{requests.ts}`、`packages/domain/test/domain.test.ts`、`.agentdev/work/WP-03/implementation.md` 三个 blob 变化。`packages/core/**`、`apps/daemon/**`、`packages/domain/**` 除 `requests.ts` 外、`docs/**`、`plan.md` 在第十一轮与本轮之间**零改动**（哈希逐字相同）→ 核心/HTTP 面的前十轮 P0/P1 只能通过"未改动 + 独立复验"担保（见 §5）。
- 权威依据：`AGENTS.md`、`docs/INDEX.md`、`docs/rules/{workflow,agents}.md`、`docs/product/experience.md`（§3）、`docs/architecture/{data,protocol,execution,reliability}.md`、`docs/delivery/{implementation,acceptance}.md`（AC-001..006/052/076/084）、`.agentdev/work/WP-03/{plan,implementation,review}.md`、`packages/**`、`apps/daemon/**`、相关测试

---

## 1. 结论

**FAIL（不能进入独立 Test；按 `docs/rules/workflow.md` §6 走 `Blocking Review Finding → Develop → Independent Review`）。**

本轮判 **FAIL（0×P0、3×P1、1×P2、3×P3）**。

T19 这次修复**确实关闭了目标优先（target-first）整类越权**，方向是对的、量是实的：以差分解剖（旧树 `1ede8c7` 与新树 `d98ac43` 并跑同一 361 句非命令语料）测得 **111 句从"授权"翻为"只读"、0 句新坏**，其中目标优先九族 211/211 全部只读（`X 尚未修改/正在修改/拒绝修改/可以修改/计划修改` 等 125 模板 + 否定/动相/被动/选择/条件/引用/罗列/英文）；`把/将/对` 处置式从第十一轮的 4/4 误拒变为可用（W3R11-05 已修）；登记语料 86 负 + 19 正 + 3 声明性 fail-closed + 4 作用域 0 偏差；前十轮 P0/P1 无回归。

但**越权方向并未整体关闭**：`COMMAND_LEAD_PATTERN`（`:295-298`）与 `COMMAND_LEAD_EN_PATTERN`（`:300-303`）都是**前缀匹配**（动词 + 紧跟的路径目标），对目标之后的尾巴**没有任何句法守卫**，唯一约束仍是词表 `NON_COMMAND_MARKERS`（`:279-280`）。因此"以变更动词开头 + 紧跟路径"的非命令句依旧直通授权：

- `修改 docs/INDEX.md 是必要的`（陈述）、`修改 docs/INDEX.md 尚未完成`（状态）、`修改 docs/INDEX.md 更合适`（意见）、`删除 docs/INDEX.md 的理由`（名词化）→ 授权；
- `修改 docs/INDEX.md 或重写`、`修改 docs/INDEX.md 划算不划算`、`修改 docs/INDEX.md 好在哪里`（选择/疑问）→ 授权；
- `视情况而定，修改 docs/INDEX.md`、`经批准，修改 docs/INDEX.md`、`收到回复后，修改 docs/INDEX.md`、`等消息，修改 docs/INDEX.md`、`先讨论，再修改 docs/INDEX.md`（条件/前件）→ 授权；
- 英文 `fix docs/INDEX.md was not requested`、`update docs/INDEX.md after discussion`、`update docs/INDEX.md at your discretion` → 授权。

这些句子**不在 T19 声明的 fail-closed 代价里**（声明的代价是"未登记同义祈使 → 只读"），而是相反方向的 fail-open。**全部以真实 HTTP + 真实 `Orchestrator` 证明可派发真实 Backend 写 Run**（本轮 20/20 HTTP 落库授权、10/10 建立 `backend:queued` 写 Run）。根因与第八～十一轮同一句话：**形态判定退化为词表枚举**；第十一轮 §10 明确要求"不能继续靠往 `NON_COMMAND_MARKERS` 里加词"，而 T19 对条件前件恰恰又是加词（`待你/等你/看情况/酌情/发现问题/upon approval/following approval/pending review`），同族下一批变体继续直通。

| 维度 | 第十一轮 | 第十二轮 |
|---|---|---|
| 目标优先模板 | 存在，`COMMAND_TAIL` 80/85 模板越权 | **已删除；目标优先 211/211 只读（关闭）** |
| 目标优先日常祈使 | 2 条已登记正例误拒 | **3 条声明性只读（fail-closed 取舍，见 §6）** |
| 动词优先模板尾守卫 | 无（未单独测） | **仍无：63 句非命令仍授权（新 P1×3）** |
| 处置式 `把/将/对` | 4/4 误拒（P2） | **已修（可用）** |
| 词表单字命中误拒（`过/了/会/被/or/no/yes`） | 16/16 误拒（P2） | **未修：12/16 仍误拒（W3R12-04）** |
| 差分解剖（361 非命令句） | 97 负只修好 1、15 正新坏 4 | **111 修好、0 新坏、63 仍开** |
| 登记语料 86 负 + 19 正 + 3 声明 + 4 作用域 | 86+21+4 成立 | **86+19+3+4 全部成立（0 偏差）** |
| 客户端注入面 | 无通路（11 项） | **无通路（11 项，0 授权/0 越权 Work）** |
| 前轮 P0/P1 复验 | 17/17 通过 | **17/17 通过；core/daemon 零改动** |
| P1 数量 | 3 | **3** |

三条 P1 均落在本包验收面（AC-004 负例、AC-005 授权边界、`workflow.md` §1/§6），**全部以真实 HTTP + 真实 `Orchestrator` 端到端可复现**，**阻断 Test**。

---

## 2. 契约命令原始结果（本轮实跑）

执行目录：仓库根；在 `HEAD=b6357a9`、被审代码树 `d98ac43` 上执行；`pnpm build` 产物 `packages/domain/dist/requests.js` 由本轮 build 生成（时间戳晚于源码）。逐条串行，原始日志在 `/tmp/r12-*.log`。

| 命令 | 退出码 | 原始结果要点 |
|---|---|---|
| `pnpm build` | **0** | `pnpm -r build`，**8** 个 workspace `build: Done`：`contracts, cli, domain, storage, core, daemon, pi-runtime, runner` |
| `pnpm typecheck` | **0** | `tsc -p tsconfig.json --pretty false`，无输出（`/tmp/r12-typecheck.log` 仅 1 行命令回显） |
| `pnpm lint` | **0** | `Checking formatting... All matched files use Prettier code style!` |
| `pnpm test:unit` | **0** | `Test Files 19 passed (19)`、`Tests 289 passed (289)`（Duration 2.96s） |
| `pnpm test:integration` | **0** | `Test Files 10 passed (10)`、`Tests 124 passed (124)`（Duration 34.33s；含 `container.integration.test.ts` 真实容器） |
| `pnpm docs:check` | **0** | `docs:check ok — 15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages` |

`git status --porcelain`（写入本报告前）：**空输出**；`HEAD` 全程 `b6357a9f54ba65a820e00c383b56ed0d007a9793`；`git diff --name-only d98ac43 HEAD` = 仅 `.agentdev/work/WP-03/review.md`。
计数对账：`implementation.md:227`（T19）的 `289 / 124 / 8 / docs:check ok` 与实测**一致**。

**命令全绿不等于必验范围成立**：`grep -rn "尚未修改\|正在修改\|拒绝修改\|计划修改\|可以修改\|抑或\|要不然\|待你确认\|看情况\|upon approval\|pending review" packages/*/test apps/*/test` 仍只有 **1** 处命中（`domain.test.ts:414` 的一句**注释**，不是断言）；`Orchestrator` 仍不出现在 `apps/daemon/test/server.test.ts`、`packages/core/test/artifacts.test.ts`（W3R4-05 延续）。本轮三条 P1 的**全部证据句零断言**，越权、误拒与端到端证据均由我自建脚本（`/tmp/w3r12/`、`/tmp/w3r11/`）建立。

---

## 3. 越权方向（独立穷举核验）

### 3.1 口径声明（先声明后实测）

- **缺陷（fail-open）**：句子**不是祈使指令**（陈述/完成体/被动/疑问/反问/选择疑问/条件前件与后件/引用/名词化/无标点罗列/征询），却在 `routeMessage` 上产生 `explicitAuthorization=true`（`writePaths` 非空）。
- **非缺陷（已声明代价，planVersion 2 + T19）**：未登记**同义变更词**（`重写/润色/rewrite/polish/tweak`）落只读 + 澄清；**目标优先日常祈使**（`X 的错别字麻烦处理下`）落只读 + 澄清；处置式要求变更动词收尾（`把 X 改成新版本` 落只读）。
- **非缺陷（真祈使）**：`并/and` 连接的两个真祈使（`修改并删除 X`、`fix X and update Y`）算命令，不计缺陷（第十二轮口径，见 §3.5）。
- **判定原则**：本轮对"是否非命令"按语义从严三档标注 —— **A 明确非命令**（陈述/条件/选择/名词化/疑问）、**B 形态可辩**（可作祈使读，但更自然读作状态/意见）、**C 真祈使**。只有 A 计入缺陷。

### 3.2 语料与结果总表（`probe1-corpus.mjs`，361 句，全部消费 `pnpm build` 产物）

| 族 | 句数 | 授权 | 判定 | 类别 |
|---|---|---|---|---|
| A1 目标优先陈述（25 谓词 × 5 动词） | 125 | **0** | 关闭 | — |
| A2 目标优先否定 | 14 | **0** | 关闭 | — |
| A3 目标优先动相 | 11 | **0** | 关闭 | — |
| A4 目标优先被动 | 9 | **0** | 关闭 | — |
| A5 目标优先选择/疑问尾 | 20 | **0** | 关闭 | — |
| A6 目标优先条件 | 8 | **0** | 关闭 | — |
| A7 目标优先引用/名词化 | 6 | **0** | 关闭 | — |
| A8 目标优先无标点罗列 | 4 | **0** | 关闭 | — |
| A9 目标优先英文 | 14 | **0** | 关闭 | — |
| **B1 动词优先 + 陈述/状态尾** | 23 | **18** | **越权** | **A（全部）** |
| **B2 动词优先 + 选择/意见尾** | 23 | **7** | **越权** | A（5）/B（2） |
| **B6 动词优先 + 条件尾** | 8 | **3** | **越权** | A |
| B3 动词优先 + 夹问句词 | 17 | **0** | 关闭 | — |
| B4 动词优先 + 被动 | 4 | **0** | 关闭 | — |
| B5 动词优先 + 引用 | 4 | **0** | 关闭 | — |
| **C1 条件前件（中文）** | 23 | **15** | **越权** | A（12）/B（3） |
| **C2 条件前件（英文）** | 11 | **4** | **越权** | A（3）/B（1） |
| **C3 条件后件/条件+命令单子句** | 7 | **2** | **越权** | A |
| **D2 中英混合** | 17 | **10** | **越权** | A（8）/B（2） |
| **E1 动词优先 + 名词化** | 6 | **3** | **越权** | A（3） |
| D1 无标点/多动词/混合连接 | 7 | 1 | 非缺陷 | C（`fix X and update Y` 真祈使） |
| **合计** | **361** | **63** | **62 缺陷 + 1 真祈使** | |

**余量设计说明**：A 档 211 句覆盖任务点名的"目标优先陈述/否定/动相、选择疑问尾、条件前件、被动、完成体、引用、无标点罗列、夹问句词、多动词、中英混合"在**目标优先**方向上的全部形态，0 泄漏；62 缺陷全部落在**动词优先 + 尾巴**与**未登记条件前件**两个方向。

### 3.3 目标优先方向：已关闭（可核查的进步）

- 第十一轮 85 模板的 `X <谓词>修改` 家族本轮 **125/125 只读**（含 `尚未/未/没/还没/正在/计划/打算/准备/可以/允许/支持/同意/拒绝/想/决定/考虑/值得/会/要/需要/应该/必须/得到/已经/刚`）。
- 最刺眼的两句 `docs/INDEX.md 拒绝修改`、`docs/INDEX.md 正在修改` 均只读（`COMMAND_TAIL_PATTERN` 已删除，`requests.ts` 不再含该常量）。
- `AGENTS.md`/`workflow.md` §1「执行消息可直接授权明确目标」在目标优先方向不再被陈述/状态/许可/拒绝句冒充。

### 3.4 残留越权（62 句，全部 A/B 档；证据句）

**（1）动词优先 + 非命令尾巴 —— 陈述/状态/意见/名词化**（B1/E1，21 句）
`修改 docs/INDEX.md 尚未完成`、`修改 docs/INDEX.md 未完成`、`修改 docs/INDEX.md 还没完成`、`修改 docs/INDEX.md 正在进行`、`修改 docs/INDEX.md 完成`、`修改 docs/INDEX.md 结束`、`修改 docs/INDEX.md 到一半`、`修改 docs/INDEX.md 的计划还没有定`、`修改 docs/INDEX.md 由你决定`、`修改 docs/INDEX.md 是必要的`、`修改 docs/INDEX.md 没有必要`、`修改 docs/INDEX.md 不太合适`、`修改 docs/INDEX.md 没意义`、`修改 docs/INDEX.md 更合适`、`修改 docs/INDEX.md 更简单`、`修改 docs/INDEX.md 更省事`、`修改 docs/INDEX.md 更划算`、`删除 docs/INDEX.md 的理由`、`修复 docs/INDEX.md 的方法`、`修改 docs/INDEX.md 的影响`、`修改 docs/INDEX.md 的必要性`。

**（2）动词优先 + 选择/疑问尾巴**（B2 + 补测，10 句）
`修改 docs/INDEX.md 或重写`、`修改 docs/INDEX.md 或保留`、`修改 docs/INDEX.md 划算不划算`、`修改 docs/INDEX.md 好在哪里`、`修改 docs/INDEX.md 算不算必要`、`修改 docs/INDEX.md 到底值不值`、`update docs/INDEX.md 或重写`、`update docs/INDEX.md 或保留`、`update docs/INDEX.md 更合适`、`fix docs/INDEX.md versus rewriting it`。

**（3）条件前件（未登记变体）**（C1/C2/C3，21 句）
`视情况而定，修改 X`、`视情况，修改 X`、`在确认之前，修改 X`、`经批准，修改 X`、`审批通过后，修改 X`、`收到回复后，修改 X`、`等消息，修改 X`、`等通知，修改 X`、`先讨论，再修改 X`、`先确认一下，修改 X`、`先跟你确认，修改 X`、`评估完，修改 X`、`待我确认，修改 X`、`待批准，修改 X`、`视结果，修改 X`、`出错就，修改 X`、`失败就，修改 X`、`as soon as possible, update X`、`at your discretion, update X`、`after discussion, update X`、`depending on the result, update X`。

**（4）中英混合**（D2，10 句）：`update docs/INDEX.md 尚未完成`、`update docs/INDEX.md 未完成`、`update docs/INDEX.md 更简单`、`fix docs/INDEX.md 尚未完成`、`fix docs/INDEX.md was not requested`、`fix docs/INDEX.md and update docs/PLAN.md`（后者是真祈使，非缺陷）、`update docs/INDEX.md may be needed`、`update docs/INDEX.md seems right`。

### 3.5 差分解剖：T19 到底改了什么（`probe8-diff.mjs`）

把旧代码树 `1ede8c7` 的 `packages/domain/src/requests.ts` 用 `git show` 导出到 `/tmp/w3r12/old/`，通过 Node 24 的 TypeScript 类型剥离直接运行（仅把唯一的运行时 import `emptyScope` 本地化），与新构建产物并跑同一 361 句非命令语料：

- **负向 361 句**：**both open（修复后仍开）63**、**old open → new closed（修好）111**、**old closed → new open（新坏）0**、both closed 187。
- 修好的 111 句全部来自目标优先族（A1=85、A2=5、A3=1、A4=3、A6=1）加本轮新增词表的少数动词优先族（B2=7、C1=5、C2=3、C3=1）——即 T19 的 **a) 删除目标优先模板 + b) 扩充标记与条件词表** 两件事都真实生效。
- 仍开的 63 句全部来自**动词优先 + 尾巴**与**条件前件**族（B1=18、B2=7、B6=3、C1=15、C2=4、C3=2、D1=1、D2=10、E1=3）——即这两族在旧树同样 fail-open，本轮**没有触碰其结构**。

**裁决**：T19 的"只保留两类**结构上不可能与陈述混淆**的命令"对处置式成立、对动词优先模板**不成立**。`COMMAND_LEAD_PATTERN` 是 `^VERB_GROUP…(PATH_TOKEN_SOURCE)` 的**前缀**匹配（无 `$`、无尾守卫），`COMMAND_LEAD_EN_PATTERN` 只要求动词后 120 字符内出现路径；"动词 + 路径"之后可以接任意非命令内容，除非命中 `NON_COMMAND_MARKERS` 词表。这与第八、九、十、十一轮同根因（**形态判定退化为词表枚举**），且本轮证明它继续向"误放"一侧泄漏（误拒一侧见 §4）。

### 3.6 HTTP 端到端（`probe3-http.mjs`，真实 daemon：真实 SQLite + 真实 blob + Bearer 链路）

30 句：**20/20 A 档非命令 fail-open** —— HTTP 202、`authorizationId` 非空、新增 1 条 `authorization` 行、新 Work `level=["L2"]`、`intent=["delivery"]`、`writePaths=["docs/INDEX.md"]`、写入 1 条 `assessment`。代表句：`修改 docs/INDEX.md 是必要的`、`修改 docs/INDEX.md 或重写`、`修改 docs/INDEX.md 更合适`、`删除 docs/INDEX.md 的理由`、`视情况而定，修改 docs/INDEX.md`、`经批准，修改 docs/INDEX.md`、`收到回复后，修改 docs/INDEX.md`、`等消息，修改 docs/INDEX.md`、`在确认之前，修改 docs/INDEX.md`、`先讨论，再修改 docs/INDEX.md`、`fix docs/INDEX.md was not requested`。对照组：6 条登记负例 6/6 只读（`authId=null`、`level=none`、零授权行）；4 条正例 4/4 授权。

### 3.7 真实 Orchestrator 端到端（`probe4-e2e.mjs`）

17 句：**10/10 A 档非命令各建立 1 个真实 `backend/implementation` 写 Run**（`writeRuns=["…:backend:queued"]`），全部经 `assess`（L2 + `authorizationRef` 通过 `verifyAuthorization`）与 Chief 父 Run。否定对照组 3 条仅建 `assist:none-scope`；正例 4/4 建写 Run（`解释 X 并修复 Y` 为 assist + backend 各一）。→ **准入闸门正常，越权来自授权判定本身。**

### 3.8 危害上界

越权授权的范围恒等于句中**被点名的那一个路径**，`operations=['read','edit']`、`networkTargets=[]`；环境/网络/越界路径仍被 `Orchestrator.verifyAuthorization` 拒绝。危害是"用户只是陈述/提问/给条件，却产生了可执行的写授权与真实写 Run"，属 `workflow.md` §6 的 P1（错误行为/需求缺失）+ AC-004 负例失败，**不是数据/安全级 P0**。

---

## 4. 文档化正例与 fail-closed 取舍复核（`probe2-positives.mjs`）

- **动词优先命令 13/13 授权**（含 `修复 docs/INDEX.md 中的错别字`、`删除 X 的旧内容`、`清理 X 的重复段落`、`更新 X 的说明`、中英）。
- **处置式 5/6 授权**：`把 X 里的错别字改掉`、`请把 X 里的错别字改掉`、`将 X 删除`、`对 X 进行修改`、`对 X 做一次完整更新` 全通（**W3R11-05 已修**）；`麻烦把 docs/PLAN.md 里过时的段落清理一下` 被 `过` 单字命中误拒（W3R12-04）。
- **混合意图与作用域 5/5**：`解释 X 并修复 Y`（HTTP 建 2 Work，写范围只含 Y）、`先解释 X，再修改 Y`、`别改 A，改 B`、`不要修改 A，但要修复 B`、`修改 A 而不是 B`、`参考 X，修改 Y`、`regarding X, fix Y`、`修改 X、Y` 全部只读/授权正确，作用域断言 4+1/4+1 成立。
- **声明性 fail-closed 7/7 只读**：`docs/INDEX.md 的错别字麻烦处理下`、`请帮忙处理`、`接口说明更新一下`（T19 三条）+ `重写/润色/rewrite/polish`（planVersion 2 同义动词）全部只读。**方向为 fail-closed，不产生越权。**
- **合法祈使误拒 12/16**（`probe10` 复用）：`删除 X 的过时内容`、`清理 X 的过时段落`、`更新 X 里过时的接口说明`、`修改 docs/过时说明.md`、`修改 docs/会议.md`、`修改 docs/了解.md`、`修改 docs/被删说明.md`、`update docs/a-or-b.md`、`fix docs/no-index.md`、`fix docs/yes-notes.md` 全被拒（`过/了/会/被/or/no/yes` 子串命中）；`把 docs/INDEX.md 改成新版本` 因处置式要求动词收尾被拒。全部 fail-closed，无越权，但属"合法祈使被误拒"（W3R12-04）。

---

## 5. 客户端注入面与前轮 P0/P1 无回归复核

### 5.1 注入面（`probe5-injection.mjs`，真实 HTTP；复用第十一轮脚本，路径指向本轮 build）

| 注入 | HTTP | 库结果 |
|---|---|---|
| `workItems:[…×50]` / `works:[…×50]` | 202（静默忽略） | workDelta=1（仅路由产出）、authDelta=0、无 write |
| `authorization:{scope:{writePaths:['packages/core/src'],operations:['read','edit']}}` | 202（忽略） | authDelta=0、`authorizationId=null` |
| `authorization:{operations:['deploy']}` | 202（忽略） | 零授权行 |
| `grants:[{operation:'edit',targets:[…]}]` | 202（忽略） | 零授权行 |
| `scope:{writePaths:['packages/core']}` + `level:'L3'` + `intent:'operation'` | 202（忽略） | 零授权行、无 L3 Work |
| `targetWorkId`（不存在） | **404** `{ok:false,error}` | 零副作用 |
| 未知字段 `foo`/`targetRole`/`ownerUserId` | 202（**静默忽略**） | 无副作用（W3R12-07 承接 `protocol.md` §1/§3） |
| 空 body / 缺 `conversationId` / 未知 `conversationId` | **400 / 400 / 404** | 零副作用 |

**结论：wire 层不存在 `authorization`/`workItems`/`works`/`grants`/`scope`/`level`/`intent` 通路，11 项注入零授权行、零越权 Work，无回归。** `apps/daemon/src/server.ts:171-180` 只读取 `conversationId/body/attachmentIds/targetWorkId`，`authorization` 字段只存在于 Core 的 dispatcher 参数（daemon 不转发）。

### 5.2 前轮 P0/P1 复核表（`probe6-prior.mjs`，17/17 通过）

| 项目 | 本轮实测 | 状态 |
|---|---|---|
| W3-01 下载 token 可预测/先于认证（P0） | token 不内嵌 artifactId；首次 200、二次 403 | 无回归 |
| W3-02 产物读取无主体维度（P0） | 预览走 `assertReadable`；CSP 逐字、sandbox、`credentials: omit`、无 `set-cookie`、`nosniff` 全成立 | 无回归 |
| W3R3-01 授权 capability 缺口致死锁（P1） | `probe4` 中正例 `assess`/`dispatch` 全通（含 `readPaths`+`read`） | 无回归 |
| W3R3-06 CSP 单头/逐字相等（P2） | `preview.ts` 哈希 `803b502a` 与第十一轮相同；头逐字等于 `PREVIEW_CSP` | 无回归 |
| W3R4-03 `assertGrantWithinMessage` 约束 `readPaths` | 代码仍在（`messages.ts:360-384`）；HTTP `authorization` 注入被忽略 | 无回归 |
| W3R4 review `targetWorkId` 跨会话 | 跨 Conversation 目标 Work → **403 `NOT_AUTHORIZED`** | 无回归 |
| W3R4 review 追发不改写 Work | 追发后 `level`/`authorizationRef` 不变、`authorizationId=null` | 无回归 |
| W3R5-01 非执行消息产生写授权（P1） | 目标优先族已闭合；**动词优先尾巴/条件前件族仍开（W3R12-01/02/03）** | **部分未闭合** |
| W3R7-01 只读请求词授权（P1） | `看一下/检查/评估/总结/列出` 全只读 | 无回归 |
| W3R7-03 混合否定+指令误拒（P1） | `别改 A，改 B`、`不要修改 A，但要修复 B` 只授权 B | 无回归 |
| A1 目标级排除 / A2 中文混合 / A3 纯建议（P1） | 4/4 作用域、混合 2/2、建议全只读 | 无回归 |
| 登记语料 86 负 + 19 正 + 3 声明 + 4 作用域 | `probe7-corpus` **0 偏差** | 无回归 |
| 第十一轮 hold-out（`probe9` 复用） | round-10 登记样本 **0/13** 开；hold-out **2/20** 开（原 16/20） | 大幅收窄、未清零 |

**未闭合承接**（P3，不单独阻断）：W3R4-05（无 Orchestrator 授权回归用例）、W3R4-06（`protocol.md` §5 未对账）、W3R4-08（`StorageError` 映射粗）、W3R4-10（`targetWorkId` 归属只覆盖 message 来源）、W3R4-12（multipart 多文件 / `projectId`）、W3R4-13（错误响应非 §1 封装）。

---

## 6. 记录与实现一致性核对

| 记录项 | 实测 | 结论 |
|---|---|---|
| T19「任何非命令形态（含目标优先日常祈使）一律只读并请求澄清」 | 目标优先族确实只读；但 **62 句动词优先/条件前件非命令仍授权** | **不准确（W3R12-05）** |
| T19「只保留两类结构上不可能与陈述混淆的命令」 | 处置式成立；**动词优先模板对尾巴无守卫，仍与陈述混淆**（§3.5） | **不准确（W3R12-01/02/03）** |
| T19「取消目标优先模板」 | `requests.ts` 已无 `COMMAND_TAIL_PATTERN`，仅有 `COMMAND_LEAD*` + `COMMAND_DISPOSAL` | **准确** |
| T19「对应的动词优先表达与处置式均正常授权」 | `修复 X 中的错别字`、`把 X 里的错别字改掉` 均授权（`probe2`）；处置式 5/6（`过时` 误拒） | **基本准确（1 例 fail-closed）** |
| T19「已写入回归测试与 planVersion 2 的残余风险」 | 测试侧有 3 条声明性断言（`:416-427`）；**`plan.md` 哈希 `8986875e` 与第十一轮逐字相同、未改动**，planVersion 2 未登记该取舍 | **不准确（W3R12-05）** |
| T19「86 负 + 19 正 + **7 条声明性 fail-closed** + 作用域断言」 | 独立提取：**86 负 + 19 正 + 3 条声明性 fail-closed + 4 作用域**；"7" 不可复现（3+4 的作用域合计为 7，疑为口径混算） | **不准确（W3R12-05）** |
| T19「外置语料（79/35/32 条）与新增第十一轮语料（25 条）全部符合预期」 | 仓库内**无**对应语料文件（`find … -iname '*corpus*'` = 0）；第十一轮 §9.1 要求的新增语料为 17+7+8=32 句，记录的"25 条"无出处 | **不可复现（W3R12-05）** |
| T19/T18「守卫扩展 `…/一旦/的话/之后/以后/确认后/经确认/完毕/vs./or/yes/no/whether` 等一律视为非命令」 | `视情况而定/经批准/审批通过后/收到回复后/等消息/在确认之前` 等同类不进守卫 | **不准确（W3R12-03）** |
| `implementation.md:3` `planVersion: 1` | `plan.md:3` 为 `planVersion: 2` | **记录头未同步（W3R12-05，第五轮延续）** |
| `implementation.md:113`「永不下发写授权」、`:140/:177/:186`「一律只读」 | `:176`（T15）声称"不再出现「一律/永不」的绝对表述"，原文仍在；且"解释句、疑问句、否定句永不下发写授权"被 `修改 X 尚未完成`/`修改 X 就…` 类反例证伪 | **名实不符（W3R12-05）** |
| planVersion 2「未登记的措辞可能落到只读路线（fail-closed）」 | 方向成立；但**未声明** verb-first 尾巴越权与目标优先整类只读这两个实际后果 | **不完整（W3R12-05）** |
| 第八轮报告 `domain.test.ts` 哈希 `7483338` 笔误 | 未订正（实际 `1ce35a07`） | 延续（W3R12-05） |
| T18 自述（`:211`「严格命令模板」、`:213`「任一子句是疑问/选择/征询 ⇒ 整条消息不授权」「条件子句使其下一子句同样非命令」） | 第十一轮已证伪，T19 未订正 | 延续（W3R12-05） |

**记录侧硬约束（对 Test 有直接影响）**：T19 的"任何非命令形态一律只读"与实测不符；若 Test 以 T19 为准，会把 §3.4 的 62 句越权当成"预期只读"而漏报，也会把目标优先只读误判为回归。

---

## 7. 新 Findings（W3R12-xx）

### W3R12-01 [P1] 动词优先模板**无尾守卫**：陈述/状态/意见/名词化尾巴仍产生写授权并可派发真实写 Run（W3R11-01 族延续）

- **位置**：`packages/domain/src/requests.ts:295-298`（`COMMAND_LEAD_PATTERN`，`^VERB_GROUP…(PATH_TOKEN_SOURCE)` 前缀匹配、无 `$`）、`:300-303`（`COMMAND_LEAD_EN_PATTERN`，动词后 120 字符内含路径即匹配）、`:279-280`（`NON_COMMAND_MARKERS`，目标之后唯一的守卫）、`:325-336`（`isImperative`）。
- **实测（我自建，未登记）**：`probe1` B1 **18/23**、E1 **3/6** 授权；代表句 `修改 docs/INDEX.md 是必要的`（陈述）、`修改 docs/INDEX.md 尚未完成`/`未完成`/`完成`/`结束`（状态）、`修改 docs/INDEX.md 更合适`/`更简单`（意见）、`删除 docs/INDEX.md 的理由`/`修改 docs/INDEX.md 的必要性`（名词化）、`修改 docs/INDEX.md 由你决定`（交办陈述）、`fix docs/INDEX.md was not requested`（英文被动陈述）。
- **判别依据**：这些句子的主语/话题是"修改（这件事）"，动词 + 路径只是从句/动名词的一部分，不是对执行者的祈使；`X 尚未修改`（第十一轮已登记负例）与 `修改 X 尚未完成` 是同一语义的两种语序，后者却直通。`workflow.md` §1 只授权"执行消息"。
- **端到端**：`probe3` HTTP 全部落库授权（L2 + 1 授权行 + 1 assessment）；`probe4` 建立真实 `backend/implementation` 写 Run。
- **修复方向（结构性）**：不要继续加词。要么给动词优先模板加**尾锚/受事短语约束**（目标之后只允许 `的<受事名词>` 白名单或命令粒子、句末标点），要么先无条件拒绝含"谓词性状语尾"（`是…的`/`尚未/未/没/还没/正在/完成/结束/到一半`/`由你决定`/比较级 `更…`）的子句；两者都可保证 `修改 X`、`删除 X 的旧内容`、`更新 X 的说明` 仍授权。
- **验收面**：AC-004 负例失败；`workflow.md` §1「执行消息可直接授权明确目标」被扩大到"陈述/意见/名词化"。

### W3R12-02 [P1] 选择/疑问尾的未登记变体仍产生写授权并可派发真实写 Run（W3R11-02 族延续）

- **位置**：`requests.ts:126-129`（`CHOICE_PATTERNS`）、`:55-60`（`QUESTION_PATTERNS`）、`:279-280`（选择/疑问词表）、`:295-303`（前缀模板）。
- **实测**：`probe1` B2 **7/23** + 补测 3 句授权：`修改 X 或重写`、`修改 X 或保留`（`或` 单字不在词表；`重写/保留` 非登记动词）、`修改 X 划算不划算`、`修改 X 好在哪里`、`修改 X 算不算必要`、`修改 X 到底值不值`、`update X 或重写`、`UPDATE X 更合适`、`fix X versus rewriting it`。对照：`修改 X 抑或重写`、`修改 X 也可以`、`修改 X 更好`、`修改 X 还是重写` 已只读（新词表生效）——**同形态因是否命中词表而结论相反**。
- **端到端**：`probe3` 4/4 落库；`probe4` 4/4 建写 Run。
- **修复方向**：把"选择/征询形态"整体并入疑问门（`(?:还|或)是?`、`或`+非登记动词、`A不A`/`A没A`/`A不必要`、`好在哪里/算不算/值不值`、`either/vs\.?/versus/or`），并让 `interrogative` 门与 `NON_COMMAND_MARKERS` 的选择子集共用同一张表。
- **验收面**：同 W3R12-01。

### W3R12-03 [P1] 条件前件的未登记变体仍产生写授权并可派发真实写 Run（W3R11-03 族延续）

- **位置**：`requests.ts:137-140`（`CONDITION_PATTERNS`）、`:143-148`（`HYPOTHETICAL_PATTERNS`）、`:116-120`（`PRECONDITION_PATTERNS`）、`:427-440`（`conditional` 继承）。
- **第十一轮状态**：W3R11-03 的 8 条登记原句**已修**（`probe9` 只读）。
- **本轮实测**：`probe1` C1 **15/23**、C2 **4/11**、C3 **2/7**：`视情况而定，修改 X`、`视情况，修改 X`、`在确认之前，修改 X`、`经批准，修改 X`、`审批通过后，修改 X`、`收到回复后，修改 X`、`等消息/等通知，修改 X`、`先讨论，再修改 X`、`先确认一下，修改 X`、`先跟你确认，修改 X`、`评估完，修改 X`、`待我确认，修改 X`、`待批准，修改 X`、`视结果，修改 X`、`出错就，修改 X`、`失败就，修改 X`、`as soon as possible, update X`、`at your discretion, update X`、`after discussion, update X`、`depending on the result, update X`。英文 `upon approval/following approval/pending review` 已只读，其中文孪生 `经批准/审批通过后` 却授权。
- **根因**：条件身份仍由词表决定；T19 对条件族**继续加词**（`待你/等你/看情况/酌情/发现问题/upon approval/following approval/pending review`），未实现第十一轮 §10 要求的"前件形态判定"。`conditional` 继承只作用于**下一子句**，因此单子句尾巴（B6：`修改 X 视情况而定`、`修改 X 看情况`、`修改 X 待你确认`）也无人守卫。
- **端到端**：`probe3` 9/9 落库；`probe4` 4/4 建写 Run。
- **修复方向（结构性）**：前件判定改为"该子句**不含变更动词 + 命名目标**且以 `待/等/经/通过/收到/…就/…后/…之前/看…/视…/…的话/once/after/upon/following/pending/at your` 等收束，并以逗号或 `就` 与后件相连"⇒ 整条消息的条件前件身份；不再逐词枚举。
- **验收面**：同 W3R12-01。

### W3R12-04 [P2] 合法祈使仍被**标记子串/收尾约束**误拒（W3R11-04 未修；W3R11-05 已修）

- **位置**：`requests.ts:279-280`（裸 `了`、`过`、`会`、`被`、`or`、`yes`、`no` 等）+ `:319`/`:327`（对整子句 `test`）；`:312-315`（`COMMAND_DISPOSAL_PATTERN` 要求变更动词收尾）。
- **实测（`probe10` 复用 + 本轮补测）**：**12/16 误拒**：`删除 docs/INDEX.md 的过时内容`、`清理 docs/PLAN.md 的过时段落`、`更新 docs/INDEX.md 里过时的接口说明`、`修改 docs/过时说明.md`、`修改 docs/了解.md`、`修改 docs/会议.md`、`修改 docs/被删说明.md`、`update docs/a-or-b.md`、`fix docs/no-index.md`、`fix docs/yes-notes.md`、`麻烦把 docs/PLAN.md 里过时的段落清理一下`、`把 docs/INDEX.md 改成新版本`（动词不收尾）。
- **性质**：全部 fail-closed（不产生越权），但属"合法祈使被误拒"，抬高 AC-005 的交互成本；`过时内容` 是第十轮起就点名的文档化措辞。**W3R11-05 的处置式本身已修**（4 条代表句全通），本条只余标记子串与收尾约束。
- **修复方向**：标记判定按词边界/句法位置收窄（`过` 仅当动词后、`被/会` 仅在动词前、英文 `or/no/yes` 要求不与路径词元相邻），或先剥离 `的…名词` 修饰段与目标词元再判定；处置式允许 `把 X 改成<非路径宾语>`（动词不必在句末）。
- **验收面**：不阻断；随修复轮订正。

### W3R12-05 [P3] 记录名实不符：T19 声明与实现/测试不一致，`planVersion 2` 未登记取舍

- **实测**：见 §6 表。要点：① T19「任何非命令形态一律只读」被 62 句证伪；② T19「已写入 … planVersion 2 的残余风险」不成立（`plan.md` 哈希 `8986875e` 与第十一轮逐字相同，未改动）；③「7 条声明性 fail-closed」实为 **3** 条断言（`domain.test.ts:417-419`）；④「外置语料 79/35/32」「第十一轮语料 25 条」仓库内无文件、不可复现；⑤ `implementation.md:3` 仍 `planVersion: 1`；⑥ `:176` 声称绝对表述已删，`:113/:140/:177/:186` 的「永不/一律」仍在；⑦ T18 自述与第八轮哈希笔误未订正。
- **性质**：记录名实不符（连续第六轮）。不单独阻断，但 Test 若以 T19 为准会漏报 §3.4 的 P1。
- **建议**：把绝对表述限定为"已登记语料范围内"；把目标优先只读 + verb-first 尾巴两处实际后果写入 `plan.md` planVersion 2 残余风险；同步 `planVersion` 头；把"7 条"改为实测 3 条；把外置语料落进仓库或删除该证据声明；订正第八轮哈希笔误。

### W3R12-06 [P3] 回归网缺口：第十一轮点名的 32 句零断言，授权→`assess`/`dispatch` 仍无产品用例

- **实测**：`grep -rn` 第十一轮要求的新增句（`尚未修改/正在修改/拒绝修改/抑或/要不然/待你确认/看情况/upon approval/pending review`…）= **1 处注释、0 处断言**；`packages/domain/test/domain.test.ts` 新增的只有 3 条声明性 fail-closed（`:416-427`）与 2 条删除的正例；`grep -rl Orchestrator apps/daemon/test packages/core/test/artifacts.test.ts` = **0**（W3R4-05 延续）。
- **性质**：不阻断（P1 已由我自建脚本证明），但修复后必须以回归断言固化：目标优先 3 族、verb-first 尾巴 4 族、条件前件 2 族、处置式正例、以及"授权正例 → `assess(L2)` → `dispatch(backend/implementation)` 成功 / 越界 grant 拒绝"。
- **承接**：与 W3R11-07、W3R10-05、W3R4-05 同项。

### W3R12-07 [P3] 协议对账与 wire 语义承接（W3R11-08 / W3R4-06/08/10/12/13 延续）

- **未知字段**：`foo:1`/`targetRole:'backend'`/`ownerUserId:'attacker'` 仍 **202 静默忽略**，而 `protocol.md` §1 要求未知字段返回 `VALIDATION_ERROR`；`protocol.md` §3 把 `targetRole?:Role` 列为 `conversation.message.send` 的合法参数，而 daemon 不读取它（呈现为"文档化参数被静默丢弃"）。
- **响应形状**：`conversation.message.send` 响应含 `workIds`/`authorizationId`，`protocol.md` §3 只列 `{messageId,workId,state,version}`（加法扩展未在文档侧对账）。
- **同批承接**：W3R4-06/08/10/12/13（`StorageError` 映射、`targetWorkId` 归属、multipart 多文件、错误响应非 §1 封装）。

---

## 8. 计数与阻断判定

| 严重度 | 数量 | 编号 | 是否阻断 |
|---|---|---|---|
| P0 | 0 | — | — |
| **P1** | **3** | W3R12-01（verb-first 无尾守卫：陈述/意见/名词化）、W3R12-02（选择/疑问尾变体）、W3R12-03（条件前件变体） | **阻断** |
| P2 | 1 | W3R12-04（合法祈使误拒：标记子串 + 处置式收尾；fail-closed，W3R11-04 未修/W3R11-05 已修） | 不单独阻断，须随修复轮订正 |
| P3 | 3 | W3R12-05（记录名实不符/planVersion 2 未登记取舍）、W3R12-06（回归网缺口/无 Orchestrator 用例）、W3R12-07（协议对账） | 不阻断，承接 Test |

- 三条 P1 **均落在本包验收面**：AC-004 负例被证伪、`workflow.md` §1 授权边界被证伪；且**均以真实 HTTP + 真实 `Orchestrator` 证明可派发真实 Backend 写 Run**（`/tmp/w3r12/probe4`，10 条）。
- 失败路由：`Blocking Review Finding → Develop → Independent Review`（`docs/rules/workflow.md` §6）。
- 第十一轮 3 条 P1 的本轮裁定：**W3R11-01 的登记形态（目标优先）已整类关闭，但同族"动词优先 + 陈述尾"仍开（→ W3R12-01）**；**W3R11-02 的 6 条登记原句已修，同族选择/疑问变体仍开（→ W3R12-02）**；**W3R11-03 的 8 条登记原句已修，同族条件前件仍开（→ W3R12-03）**。W3R11-05 已修；W3R11-04 未修（→ W3R12-04）。

---

## 9. 能否进入独立 Test —— **不能**

**判据**：`docs/rules/workflow.md` §6「P0/P1 阻断」。三条 P1 中任意一条即足以阻断，且均可端到端复现。**必须先走 `Develop → Independent Review`。**

### 9.1 修复后重评的最低要求（回归网）

以下新增句必须只读（并落成长期断言，**注意与已声明 fail-closed 区分**）：

1. **动词优先 + 陈述/状态尾（W3R12-01）**：`修改 X 是必要的`、`修改 X 不必要`、`修改 X 尚未完成`、`修改 X 完成`、`修改 X 由你决定`、`修改 X 更合适`、`删除 X 的理由`、`修改 X 的必要性`、`fix X was not requested`、`update X may be needed`、`update X seems right`。
2. **选择/疑问尾（W3R12-02）**：`修改 X 或重写`、`修改 X 或保留`、`修改 X 划算不划算`、`修改 X 好在哪里`、`修改 X 算不算必要`、`fix X versus rewriting it`、`update X 或重写`。
3. **条件前件（W3R12-03）**：`视情况而定，修改 X`、`经批准，修改 X`、`审批通过后，修改 X`、`收到回复后，修改 X`、`等消息，修改 X`、`在确认之前，修改 X`、`先讨论，再修改 X`、`出错就，修改 X`、`after discussion, update X`、`at your discretion, update X`、`depending on the result, update X`。
4. **不得回归（负例）**：十轮登记原句（`更新 X 还是新建一个文档`、`修 X 行不行`、`修改 X 该不该`、`一旦确认，修复 X`、`after you confirm, update X`…）仍只读；86 条登记负例逐句成立。
5. **不得回归（正例）**：登记 19 条正例逐句授权；`删除 X 的旧内容`、`清理 X 的重复段落`、`把 X 里的错别字改掉`、`请把 X 里的错别字改掉`、`将 X 删除`、`对 X 进行修改` 必须授权且 `writePaths` 只含目标；`删除 X 的过时内容`、`修改 docs/过时说明.md` 应随 W3R12-04 修复后授权。
6. **已声明 fail-closed（断言只读，不算缺陷）**：`docs/INDEX.md 的错别字麻烦处理下` 等目标优先祈使、`重写/润色/rewrite/polish` 未登记同义动词。

### 9.2 Test 最小覆盖矩阵（修复轮后必须覆盖）

| # | 维度 | 最小用例（≥） | 期望 |
|---|---|---|---|
| 1 | 目标优先关闭（回归） | 16 谓词 × ≥2 动词（`尚未/正在/拒绝/可以/计划/打算/准备/允许/支持/同意/想/决定/考虑/值得/会/需要`） | 全部只读，零授权行 |
| 2 | 动词优先陈述/意见尾（W3R12-01） | `是必要的/尚未完成/完成/由你决定/更合适/的理由/的必要性` 各 1 | 全部只读 |
| 3 | 选择/疑问尾（W3R12-02） | `或重写/或保留/划算不划算/好在哪里/算不算必要/vs./versus` 各 1 | 全部只读 |
| 4 | 条件前件（W3R12-03） | `视情况而定，/经批准，/审批通过后，/收到回复后，/等消息，/在确认之前，/先讨论，再/after discussion,/at your discretion,` 各 1 | 全部只读 |
| 5 | 误拒修复（W3R12-04） | `删除/清理 X 的过时内容`、`修改 docs/过时说明.md`、`修改 docs/会议.md`、`fix docs/no-index.md`、`把 X 改成新版本` | 授权且 `writePaths` 只含目标 |
| 6 | 处置式不回归 | `把/请把/将/对 X …动词` 各 1 | 授权且写范围只含目标 |
| 7 | 混合意图/排除 | `解释 X 并修复 Y`、`先解释 X，再修改 Y`、`别改 A，改 B`、`修改 A 而不是 B`、`参考 X，修改 Y` | 写范围只含目标 |
| 8 | 完成体/被动/引用/罗列/疑问（回归） | 第九/十/十一轮登记语料抽样（≥23 句） | 全部只读 |
| 9 | 登记语料 | 86 负 + 19 正 + 3 声明性 + 4 作用域 | 逐句成立 |
| 10 | HTTP 端到端（≥3 句/族） | 上述 2/3/4 组经 `POST conversation.message.send` | `authorizationId=null`、`level=none`、零授权行、无 `delivery` Work |
| 11 | **Orchestrator 回归（W3R4-05，仍未闭合）** | 授权正例 `assess(L2)` → `dispatch` `backend/implementation` 成功；grant 外路径 + `deploy`/`network` → `NOT_AUTHORIZED` | 建 Run / 拒绝 |
| 12 | 注入面不回归 | `workItems/works/authorization/grants/scope/level/intent/targetRole/ownerUserId` 注入 | 全部忽略且零授权（未知字段按 W3R12-07 决定后断言 `VALIDATION_ERROR` 或"忽略"） |
| 13 | 前轮 P0/P1 | 下载 token 一次性（W3-01）、预览 ACL（W3-02）、`assertGrantWithinMessage`（W3R4-03）、CSP 逐字（W3R3-06）、跨会话 `targetWorkId`、追发不改写 Work | 无回归（`probe6` 17/17 已通过） |
| 14 | 附件/产物面 | 上传限制/TTL/重复绑定、版本链/失效、预览截断、单次下载 | 无回归（本轮未动，抽验即可） |

### 9.3 残余风险清单（区分文档化缺陷与已声明 fail-closed）

**A. 文档化缺陷 —— 必须修（P1 阻断；P2 随修复轮订正）**
1. W3R12-01 动词优先无尾守卫：陈述/状态/意见/名词化尾巴（B1 18/23、E1 3/6、D2 多数），HTTP 20/20、e2e 10/10 可写。
2. W3R12-02 选择/疑问尾变体（`或`/A-not-A/`更合适`/`好在哪里`/`versus`），HTTP + e2e 可写。
3. W3R12-03 条件前件变体（`视情况而定/经批准/审批通过后/收到回复后/等消息/在确认之前/先讨论再` + 英文 `after discussion/at your discretion/depending on the result`），HTTP + e2e 可写。
4. W3R12-04 合法祈使误拒（12/16，fail-closed，不阻断但影响 AC-005 可用性）。
5. W3R12-05 记录名实不符与"planVersion 2 未登记取舍"（P3，随修复轮订正）。

**B. 已声明 fail-closed 代价 —— 已登记，接受并需 Test 承认**
6. **目标优先日常祈使**（`X 的错别字麻烦处理下`、`X 里的接口说明更新一下` 等整类）→ 只读 + 澄清（`implementation.md` T19、`domain.test.ts:413-427` 3 条断言；**但 `plan.md` planVersion 2 未登记，见 W3R12-05**）。
7. 未登记同义祈使（`重写/润色/rewrite/polish/tweak/去掉/缩短`）→ 只读 + 澄清（`plan.md:17-18`、`implementation.md:191/205`）。
8. 处置式要求变更动词收尾（`把 X 改成新版本`）→ 只读（T19 模板定义）。
9. 标记子串导致路径名/复合词误拒（`过时/会议/了解/被删/a-or-b/no-index/yes-notes`）→ 只读（W3R12-04，方向安全）。
10. 语义分类的最终责任在 WP-04/06 模型 Assessment；本包只承诺已登记语料与形态规则。

**C. 与本包无关或已承接**
11. W3R12-06/07 与 W3R11-06/07/08、W3R4-05/06/08/10/12/13（P3，结算前登记或修复）。
12. 真实无头浏览器攻防（WP-10）；真实 Provider 纵向与 `artifact_write` 工具接线（WP-10/WP-07）。

---

## 10. 方法与边界声明

- **独立上下文**：未读取任何开发/Test 会话；结论只来自仓库文件、`docs/**` 契约与我自建的 11 个脚本（`/tmp/w3r12/` 8 个 + 复用 `/tmp/w3r11/` 3 个只读回归脚本），全部消费 `pnpm build` 产物（`packages/domain/dist/requests.js`、`apps/daemon/dist`、`packages/core/dist`）；**未 import 任何产品测试文件**（`domain.test.ts` 仅以逐行文本方式提取语料，提取后逐句用**构建产物**复跑）。
- **差分解剖方法**：用 `git show 1ede8c7:packages/domain/src/requests.ts` 导出旧实现到 `/tmp/w3r12/old/`，把唯一运行时 import 本地化后通过 Node 24 的类型剥离直接运行，与新构建产物并跑同一 361 句语料；未修改任何仓库文件（`git status` 干净）。
- **实验统计（观测 / 缺陷证据）**：

| 脚本 | 观测 | 缺陷证据 | 对应 |
|---|---|---|---|
| `probe1-corpus.mjs` | 361 非命令句（21 族） | 目标优先 211/211 只读；**63 授权**（62 缺陷 + 1 真祈使） | W3R12-01/02/03/04 |
| `probe2-positives.mjs` | 27 正 + 7 声明性 + 5 作用域 | 正例 26/27（1 例 `过` 误拒）；声明性 7/7 只读；作用域 5/5 | §4, W3R12-04 |
| `probe3-http.mjs` | 30 句真实 HTTP | **20/20 A 档非命令落库授权**（L2 + 1 授权行 + 1 assessment）；登记负例 6/6 只读、正例 4/4 授权 | W3R12-01/02/03 |
| `probe4-e2e.mjs` | 17 句真实 Orchestrator | **10 条非命令各建立真实 `backend/implementation` 写 Run**；正例 4/4 建立；登记负例 3/3 未建立 | W3R12-01/02/03 |
| `probe5-injection.mjs`（复用） | 11 注入项 | 0 授权行、0 越权 Work；未知字段静默忽略 | §5.1, W3R12-07 |
| `probe6-prior.mjs`（复用） | 17 项前轮 P0/P1 | **17/17 通过** | §5.2 |
| `probe7-corpus.mjs` | 登记 86 负 + 19 正 + 3 声明 + 4 作用域 | **0 偏差** | 回归网 |
| `probe8-diff.mjs` | 361 句双树并跑 | **修好 111、仍开 63、新坏 0、两树皆关 187** | §3.5 |
| `/tmp/w3r11/probe1-domain.mjs`（复用） | 141 负 + 28 正 + 4 作用域 | 负向仅 2 开（均为 `并`/`and` 双祈使，真命令）；正向 6 误拒；作用域 4/4 | §4 |
| `/tmp/w3r11/probe9-round10.mjs`（复用） | 13 登记 + 20 hold-out | 登记 **0/13** 开；hold-out **2/20** 开（原 16/20） | W3R12-02/03 |
| `/tmp/w3r11/probe10-falsereject.mjs`（复用） | 18 项 | **12 非对照误拒**；处置式 4/4 已授权 | W3R12-04 |

- **对开发方「取消目标优先模板 = 越权方向收口」主张的裁决**：**方向正确、收口不完整**。删除目标优先模板是对第十一轮结构性根因的正确一步（111 句修好、0 新坏、目标优先 211/211 只读、处置式回归修复），值得肯定；但"只保留结构上不可能与陈述混淆的命令"只对处置式成立：动词优先模板仍是**前缀 + 词表守卫**，目标之后的尾巴（陈述、意见、选择、条件、名词化）继续直通授权，条件前件也仍靠加词而非前件形态。故本轮仍判 **FAIL**，且与第八～十一轮同一根因（**形态判定退化为词表枚举**）——这既不是 planVersion 2 免责的"未登记同义祈使 fail-closed"，也不是"已登记语料"，而是**明确非命令的句子 fail-open**。
- **未做**：真实无头浏览器执行、真实 Provider 纵向、Docker 容器内复验、故障注入下的孤儿 blob 复验、`pnpm test:e2e`/`test:acceptance`（脚本按设计指向 WP-09/WP-10，未实现）。
- **未改仓库**：本轮只覆盖写入 `.agentdev/work/WP-03/review.md`（本报告）；除该文件外 `git status --porcelain` 为空，`HEAD` 仍为 `b6357a9f54ba65a820e00c383b56ed0d007a9793`，全部 6 条契约命令在上述工作树上执行。

---

## 附一：第一轮摘要（保留）

第一轮（报告冻结于 `a946ed6`，被审代码树 `fd90fef`）结论 **FAIL**：必验范围「实现完整直接协作与产物路线，附件暂存/绑定、隔离预览可实际运行」不成立，新增 14 条 Finding —— **2×P0、5×P1、5×P2、2×P3**；P0/P1 全部阻断，P2 的 W3-06 因影响 AC-002 阻断。要点：下载 token 可预测且下载路由先于认证（W3-01 P0）；产物读取无主体维度（W3-02 P0）；owner 由 sessionId 派生（W3-03 P1）；消息正文未写 blob（W3-04 P1）；未知会话上传 500（W3-05 P1）；失效产物仍可预览（W3-06）；AC-006 未实现（W3-07 P1）；用户消息不建 Authorization（W3-08 P1）；token 只增不减/`prune` 无调用方（W3-09）；归档会话仍接受上传（W3-10）；`expireStale` 无调用方（W3-11）；错误响应无 §1 封装（W3-12）；记录不一致（W3-13）；浏览器级攻防未验（W3-14，承接 WP-10）。另 5 项对抗性（内联预览字节上限、文件签名、`targetWorkId` 归属、隔离只靠客户端头、失败上传孤儿 blob 与 staged 无上限）。

## 附二：第二轮摘要（保留）

第二轮（报告冻结于 `8e4efc1`，被审代码树与 HEAD 同为 `a946ed6`）结论 **FAIL**：主要判据 W3R2-01（AC-006 未实现）与 W3R2-02（AC-005 未实现），另 2×P2（W3R2-03 CSP 漂移、W3R2-04 StorageError 映射/回显）、9×P3（W3R2-05..13）。第二轮对抗性 7 项：1/3/4/5/7 已修，2 部分（语义可辩护），6 已修但无测试守护。六条契约命令全绿但不足以支撑必验范围。

## 附三：第三轮摘要（保留）

第三轮（报告冻结于 `35e8674`，被审代码树 `d71dc07`）结论 **FAIL**：AC-005 的授权机制（`routeMessage`、消息级 Authorization 行、`work.authorizationRef`、Assessment、混合意图多 Work 与独立 scope）全部**落库**且成立，但 `grantedByMessage` 生成 `readPaths:['docs']` + `operations:['edit']` 的自相矛盾授权，使绑定它的 Work 的任何 Run/Assessment 都被 `capabilityGaps:['readPaths without a read operation']` 拒绝——交付路线在准入即死锁（W3R3-01 P1）。新增 **1×P1、5×P2、8×P3**；对抗性另指出疑问句被当作执行消息、HTTP 客户端可自报 `authorization`（甚至 `deploy`）。失败路由 `Blocking Review Finding → Develop → Independent Review`。

| 三轮编号 | 严重度 | 摘要 | 第十二轮状态 |
|---|---|---|---|
| W3R3-01 | P1 | 授权 capability 缺口 → 交付死锁 | 已修（probe4 正例评估/派发走通） |
| W3R3-02 | P2 | 授权绑定 `works[0]` | 已修 |
| W3R3-03 | P2 | 授权自相矛盾 | 已修 |
| W3R3-04 | P2 | HTTP 响应不含 `workIds`/`authorizationId` | 响应已含；`protocol.md` 仍未对账（W3R12-07） |
| W3R3-05 | P2 | 同 intent 重复共享 scope | 已修（`workItems` 取消后不再适用） |
| W3R3-06 | P2 | CSP 与 `execution.md` §6 漂移 | 已修且逐字相等 |
| W3R3-07 | P2 | StorageError 映射过宽 + 回显 | 回显已修；映射细分仍缺（W3R12-07） |
| W3R3-08/09/10/11/12/13/14 | P3 | validity/归属/owner 派生/prune/证据/数字/协议项 | 部分未闭合（W3R12-07） |

## 附四：第四轮摘要（保留）

第四轮（报告冻结于 `fd0a893`，被审代码树 `3f52fbf`）结论 **PASS（0×P1、3×P2、11×P3）**，但同轮对抗性核验以 HTTP 端到端证伪「越权已闭合」：`explain why … needs a fix`、`don't fix …`、`不要修改 …`、`I am not asking you to fix …` 等仍生成写授权并可派发写 Run；另指出 `targetWorkId` 可改写已有 Work 的 level/authorizationRef、`Content-Security-Policy-Sandbox` 不是标准头、消息授权 L1 与 `routingFloor` 的 L2 不一致、`workItems:[null]`/`intent:'operation'` 造成 500 或非法 Work。

| 四轮编号 | 严重度 | 摘要 | 第十二轮状态 |
|---|---|---|---|
| W3R4-01 | P2 | 同 intent 多 Work 共用 scope | 已修（`workItems` 取消后不再适用） |
| W3R4-02 | P2 | `workItems` 把授权挂到只读 Work | 已修（字段取消） |
| W3R4-03 | P2 | `assertGrantWithinMessage` 不约束 `readPaths` | 已修（probe6 复核） |
| W3R4-04 | P3 | `workItems` 未校验 → 500 | 已修（字段取消） |
| W3R4-05 | P3 | 无 Orchestrator 授权回归用例 | 未修（W3R12-06；grep 仍 0 命中） |
| W3R4-06 | P3 | `protocol.md` 未对账 | 未修（W3R12-07） |
| W3R4-07 | P3 | `message.received` 缺 `workIds`/`authorizationId` | 已修 |
| W3R4-08 | P3 | `StorageError` 映射粗 | 未修（W3R12-07） |
| W3R4-09 | P3 | 记录数字不符 | 本轮数字一致；`planVersion` 头未同步见 W3R12-05 |
| W3R4-10 | P3 | `targetWorkId` 归属只覆盖 message 来源 | 未修（W3R12-07） |
| W3R4-11 | P3 | 失败发送孤儿 blob | 第十二轮不可复现（记录承接） |
| W3R4-12 | P3 | multipart 多文件 / `projectId` | 未修（W3R12-07） |
| W3R4-13 | P3 | 错误响应非 §1 封装 | 未修（W3R12-07） |
| W3R4-14 | P3 | 冻结点与任务不一致 | 第十二轮一致（`HEAD=b6357a9`） |

## 附五：第五轮摘要（保留）

第五轮（报告冻结于 `fd0a893`，被审代码树 `3f52fbf`）结论 **FAIL（0×P0、2×P1、2×P2、5×P3）**：

- **W3R5-01 [P1]** 非执行消息（中英文疑问、否定、陈述、名词化解释）仍产生可用写授权并可派发写 Run（17 个新句式，HTTP 端到端验证）。
- **W3R5-02 [P1]** 明确指令被判为拒绝/解释：裸单字 `别` 命中「错别字/识别/特别/分别」、`说明/介绍` 名词化被当解释、`、` 不参与分词、逗号列表只授权首项（7 例误拒）。
- **W3R5-03 [P2]** 无效 `Content-Security-Policy-Sandbox` 头仍在 wire 上，修复记录与提交信息不实（第七轮已订正并实测单头）。
- **W3R5-04 [P2]** 调用方 `authorization.readPaths` 不受消息范围约束（latent；第七轮已修）。
- **W3R5-05..09 [P3]** `targetWorkId` 归属、孤儿正文 blob、记录数字、前轮剩余项、冻结点漂移。
- 同轮确认已修：`pathsIn` 线性化、`targetWorkId` 不改写目标 Work、消息授权 L2 与 `routingFloor` 一致、`workItems` 逐项校验。

第五轮 §6.1 的 17 句越权语料，**第十二轮以 `d98ac43` 复跑全部只读**；§6.2 的 11 句误拒语料剩 1 句（`docs/INDEX.md 的说明需要修改一下`）为 fail-closed。

## 附六：第六轮摘要（报告缺档）

第六轮 Reviewer **未产出报告**（报告文件为空，`HEAD=7c01c9d` 时无 Review 结果入库）。同轮对抗性核验以 `7c01c9d` 为冻结点独立复现，确认第五轮点名的误拒/CSP/`readPaths` 三组已闭合，但补出：陈述/完成体与认识情态（`我已经修改了 X`、`刚修复了 X`、`I already fixed X`、`X 需要修改`、`是否应该修改 X`、`是否需要更新 X`、`麻烦评估一下 X 是否需要修改`）仍产生可派发写授权；`docs/INDEX.md 的错别字麻烦处理下` 等日常祈使句不授权；`workItems` 第二个同 intent 项 scope 为空；记录中「永不下发写授权」措辞不实；另补 `workItems` 无数量上限、`别改 A，改 docs/plan.md` 误拒、CSP 第二头名残留、`assertGrantWithinMessage` 未约束 `readPaths`。

## 附七：第七轮摘要（保留）

第七轮（报告冻结于 `8f8b2df`，被审代码树与之相同）结论 **FAIL（0×P0、3×P1、1×P2、3×P3）**：

- **W3R7-01 [P1]** 只读请求词（`看一下/检查一下/帮忙/帮我/麻烦/请` + 命名路径）获得写授权并可派发写 Run（`848b5c4` 引入的回归；对照 `7c01c9d` 不授权）——**第十二轮判定已修，无回归**。
- **W3R7-02 [P1]** 中文完成体因 `\b` 在 Han 语境恒不匹配而形同虚设；中文疑问缺 `谁/哪些/几点`；英文 `needs a fix`/`The fix needed in…` 未覆盖——**第十二轮判定：目标优先登记原句与大批变体已修；动词优先/条件前件形态仍未修（W3R12-01/02/03）**。
- **W3R7-03 [P1]** `别改 A，改 B`、`不要修改 A，但要修复 B` 等混合指令误拒（AC-005/006 正例失败）——**第十二轮判定已修，无回归**。
- **A1 [P1 对抗性]** 被排除目标仍获写授权（`修改 docs/PLAN.md 而不是 docs/INDEX.md`）——**第十二轮判定已修**。
- **A2 [P1 对抗性]** 中文混合意图不拆分（`解释 X 并修复 Y`）——**第十二轮判定已修**。
- **A3 [P1 对抗性]** 纯建议请求授权（`请给出 docs/INDEX.md 的修改建议`）——**第十二轮判定已修**。
- **W3R7-04 [P2]** 边界声明/记录措辞不实——**第十二轮仍未订正（W3R12-05）**。
- **W3R7-05 [P3]** `workItems` 回落 scope 产生不可执行 Work——**第十二轮不可复现（字段已取消）**。
- **W3R7-06 [P3]** 前轮未闭合项与记录数字——**第十二轮仍在（W3R12-06/07）**。

## 附八：第八轮摘要（保留）

第八轮（报告冻结于 `c82169bc72bbcf8395fb2b00584db8e0b3c60b72`）结论 **FAIL（0×P0、3×P1、1×P2、1×P3）**：

- **W3R8-01 [P1]** 中文完成体/陈述的**形态**未被识别：`已经优化了 X`、`已经整理了 X`、`已经修好了 X`、`改动已完成：X`、`我把它改好了：X` 等 12 个变体仍授权 —— **第十二轮判定：已修（全部只读）**。
- **W3R8-02 [P1]** 拒绝与非承诺、以及部分疑问句仍授权（`我不想修改 X`、`别急着修改 X`、`请勿修改 X`、`修改 X 了没有`、`Will you fix X`、`Shall we update X` 等）—— **第十二轮判定：拒绝/普通疑问已修；动词优先选择尾仍未修（W3R12-02）**。
- **W3R8-03 [P1]** 只读言说行为（解释/评价/了解/请教）中嵌入变更动词即授权 —— **第十二轮判定已修（10/10 只读）**。
- **W3R8-04 [P2]** 记录与实现不一致 —— **第十二轮仍未订正（W3R12-05）**；本轮计数 86+19+3 已与实测一致，绝对表述仍在（`:113/:140/:177/:186`）。

## 附九：第九轮摘要（保留）

第九轮（报告冻结于 `d23ce7b1d3c33df8854420941d1a937af9319a2a`；被审代码树同为 `d23ce7b`）结论 **FAIL（0×P0、3×P1、1×P2、2×P3）**，全部以真实 HTTP + 真实 Orchestrator 取证：

- **W3R9-01 [P1]** 句首 `V了` / `V完了` 的**陈述/完成体**仍被当作祈使并授权（`补充了 X`、`优化了 X`、`改好了 X`、`修改好了 X`、`删除掉了 X`、跨子句 `更新了接口文档，补充了 X 的说明`）——**第十二轮判定：已修（复跑 23 句完成体语料全只读）**。
- **W3R9-02 [P1]** **选择疑问句**（`修改 X 好还是不改好`、`修 X 行不行`、`fix X or leave it alone`、`refactor …, yes or no`）仍授权 —— **第十二轮判定：登记原句已修；同族登记外变体仍越权（→ W3R12-02）**。
- **W3R9-03 [P1]** **修饰性/参照性从句前置**（`based on X, update Y`）因逗号切分授权了参照路径 —— **第十二轮判定：已按 T17 新口径关闭（参照只授权自身命名目标；4/4 作用域断言 + 10 变体；X 从不入写范围）**。
- **W3R9-04 [P2]** 记录绝对表述与旧计数 —— **第十二轮仍未订正（W3R12-05）**。
- **W3R9-05 [P3]** 协议对账（未知字段静默忽略、响应字段多于协议表）—— **第十二轮仍在（W3R12-07）**。
- **W3R9-06 [P3]** 未登记祈使 fail-closed 代价清单 —— **第十二轮仍在**。

## 附十：第十轮摘要（保留）

第十轮（报告冻结于 `e384dd10b84a1e6bfcf1612ad9f5dc706e232590`，**被审代码树 `0fb5c71`**，第十轮修复提交为 `1ede8c7`）结论 **FAIL（0×P0、2×P1、1×P2、3×P3）**：

- **W3R10-01 [P1]** 选择疑问/征询语气的**变体**仍产生写授权并可派发真实写 Run（`更新 X 还是新建一个文档`、`修 X 行不行`、`修改 X 该不该`、`修改 X 哪个更好`、`修改 X 抑或重写`、`fix X vs. leave it`、`refactor X, yes or no` 等；自建矩阵 14/36 fail-open）——**第十二轮判定：登记原句 6 条已修；同族 hold-out 仍越权（→ W3R12-02）**。
- **W3R10-02 [P1]** 不触发条件继承的**条件前件**变体仍产生写授权并可派发真实写 Run（`一旦确认，修复 X`、`经确认后，修改 X`、`有错误的话，修复 X`、`once approved, fix X`、`after you confirm, update X`）——**第十二轮判定：登记原句 5 条已修；同族 hold-out 仍越权（→ W3R12-03）**。
- **W3R10-03 [P2]** `NON_COMMAND_MARKERS` 的**单字命中**误杀文档化正例（`删除 X 的过时内容`、`清理 X 的过时内容` 等）——**第十二轮判定：未修（路径名含 `过/了/会/被/or/no` 亦被拒；→ W3R12-04）**；注：第十轮报告"`删除过期内容` 是 `experience.md` §3 规范动作"的前提不成立（`grep -rn "过时" docs/` = 0 命中），但误拒事实成立。
- **W3R10-04 [P3]** 记录仍含绝对表述与旧轮次计数（`implementation.md:113/:140/:186`）——**第十二轮仍未订正（→ W3R12-05）**。
- **W3R10-05 [P3]** 回归网缺口：选择疑问/条件前件/复合词误拒零断言，授权→`assess`/`dispatch` 无产品用例——**第十二轮仍在（→ W3R12-06）**。
- **W3R10-06 [P3]** 协议对账（未知字段静默忽略、响应字段多于协议表）与第八轮报告哈希笔误 —— **第十二轮仍在（→ W3R12-05/07）**。
- 第十轮以自建 8 个脚本（`/tmp/w3r10/probe1..8`）取证：非祈使 150/165 只读、15 越权；HTTP 7 条落库授权；真实 Orchestrator 7 条建立写 Run；登记 71 负 + 19 正 + 4 作用域 0 偏差；客户端注入 0 通路。

## 附十一：第十一轮摘要（保留）

第十一轮（报告冻结于 `7b0e6b5a8c5823a329d9781155ceabddab36b44e`，**被审代码树 `1ede8c7`**，第十一轮修复提交为 `d98ac43`）结论 **FAIL（0×P0、3×P1、2×P2、4×P3）**：

- **W3R11-01 [P1]** 目标优先的**陈述/状态/计划/许可/拒绝**句仍产生写授权并可派发真实写 Run（`X 尚未修改`、`X 正在修改`、`X 计划修改`、`X 可以修改`、**`X 拒绝修改`**、`X 想修改`、`X 决定修改`、`X 有错误就修复`；模板矩阵 A 85 探测 / **80 授权**）——**第十二轮判定：目标优先整类已关闭（211/211 只读；→ 但动词优先陈述尾仍开，W3R12-01）**。
- **W3R11-02 [P1]** **选择疑问/问句尾**的未登记变体仍产生写授权并可派发真实写 Run（`修改 X 哪个更好`、`修改 X 抑或重写`、`修改 X 要不然保留`、`修改 X 也可以`、`修改 X 的哪个部分`、`fix X versus rewriting it`；hold-out 7/9 开）——**第十二轮判定：登记原句已修；同族 `或`/A-not-A/`更合适` 仍开（→ W3R12-02）**。
- **W3R11-03 [P1]** **条件前件**的未登记变体仍产生写授权并可派发真实写 Run（`待你确认，修改 X`、`看情况，修改 X`、`发现问题，修改 X`、`upon approval, update X`、`pending review, update X`；hold-out 9/11 开）——**第十二轮判定：上述登记原句已修；同族 `视情况而定/经批准/审批通过后/收到回复后/等消息` 仍开（→ W3R12-03）**。
- **W3R11-04 [P2]** `NON_COMMAND_MARKERS` 单字/子串命中误杀合法祈使（含目标路径本身，16/16 误拒）——**第十二轮判定：未修（→ W3R12-04）**。
- **W3R11-05 [P2]** 中文 `把/将/对`（处置式）祈使在第十轮重写中回归为误拒（4/4）——**第十二轮判定：已修（处置式 5/6 可用，余 1 例 `过` 误拒归 W3R12-04）**。
- **W3R11-06 [P3]** 记录绝对/失真表述、旧计数、未同步头、不可复现外置语料 —— **第十二轮仍未订正（→ W3R12-05）**。
- **W3R11-07 [P3]** 回归网缺口：三条 P1 的全部证据句零断言，授权→`assess`/`dispatch` 仍无产品用例 —— **第十二轮仍在（→ W3R12-06）**。
- **W3R11-08 [P3]** 协议对账与 wire 语义承接 —— **第十二轮仍在（→ W3R12-07）**。
- 第十一轮以自建 10 个脚本（`/tmp/w3r11/probe1..10`）取证：141 负向 21 越权；模板矩阵 A 80/85、B 6/17、C 8/34、C-EN 4/9；HTTP 16/16 落库授权；真实 Orchestrator 12 条建立写 Run；登记 86 负 + 21 正 + 4 作用域 0 偏差；客户端注入 0 通路；差分解剖 97 负只修好 1、15 正新坏 4。
