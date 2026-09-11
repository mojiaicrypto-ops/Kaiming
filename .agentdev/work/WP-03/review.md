# WP-03 独立 Review 报告（第十三轮）

- 评审对象：工作包 WP-03「直接协作与说明产物」
- 评审轮次：**第十三轮**（第一～十二轮摘要见文末「附一～附十二」，全部保留）
- 冻结点 / HEAD：`git rev-parse HEAD` = `9ebb5a687ada6e6358d0c5a011f38ad83ab89626`（**与任务下达的 `HEAD=9ebb5a6` 一致**）；`git diff --name-only 6f48d26 HEAD` 只有 `.agentdev/work/WP-03/review.md`，**被审代码树 = `6f48d26`**
- 工作树：本轮全部命令执行前后 `git status --porcelain` 为空；被审代码树（`packages/**`、`apps/**`、`docs/**`）无未提交修改（写入本报告后才会出现 ` M .agentdev/work/WP-03/review.md`）
- 评审角色：Review（独立上下文；未读取任何开发/Test 会话；只依据仓库文件、契约文档与 `/tmp/w3r13/` 下我自建的 6 个实验脚本 + 复用 `/tmp/w3r12/`、`/tmp/w3r11/` 的只读回归脚本）
- 工具：`node v24.8.0`、`pnpm 12.3.4`、macOS 宿主
- 记录哈希（`git hash-object`，前 8 位）：`packages/domain/src/requests.ts` **`8fc2d5fe`**（T20 修复后）、`packages/domain/test/domain.test.ts` **`e83e0e7c`**、`apps/daemon/test/server.test.ts` `de5c4e81`、`.agentdev/work/WP-03/implementation.md` **`64469f6c`**、`.agentdev/work/WP-03/plan.md` **`8986875e`**（**与第十一、十二轮逐字相同，未改动**）、`packages/core/src/messages.ts` `283d4c04`、`packages/core/src/artifacts.ts` `057ff403`、`packages/core/src/attachments.ts` `3ee94838`、`packages/core/src/preview.ts` `803b502a`、`apps/daemon/src/server.ts` `3a348304`、`packages/core/src/orchestrator.ts` `828dde58`
- 变更范围（第十一轮 `d98ac43` 之后，即提交 `6f48d26`）：只有 `packages/domain/src/requests.ts`、`packages/domain/test/domain.test.ts`、`apps/daemon/test/server.test.ts`、`.agentdev/work/WP-03/implementation.md` 四个 blob 变化。`packages/core/**`、`apps/daemon/src/**`、`packages/domain/**` 除 `requests.ts` 外、`docs/**`、`plan.md` **零改动**（哈希与第十二轮逐字相同）→ 核心/HTTP 面的前十轮 P0/P1 只能通过「未改动 + 独立复验」担保（见 §6）。
- 权威依据：`AGENTS.md`、`docs/INDEX.md`、`docs/rules/{workflow,agents}.md`、`docs/product/experience.md`（§3）、`docs/architecture/{data,protocol,execution,reliability}.md`、`docs/delivery/{implementation,acceptance}.md`（AC-001..006/052/076/084）、`.agentdev/work/WP-03/{plan,implementation,review}.md`、`packages/**`、`apps/daemon/**`、相关测试

---

## 1. 结论

**FAIL（不能进入独立 Test；按 `docs/rules/workflow.md` §6 走 `Blocking Review Finding → Develop → Independent Review`）。**

本轮判 **FAIL（0×P0、4×P1、2×P2、3×P3）**。

T20 把判定从「黑名单 + 默认放行」改为 **sound 文法**（只授权「变更动词 + 路径目标（+有界无路径尾部）」与 `把/将/对 + 目标 + … + 变更动词`），**方向正确、且目标优先（target-first）整类确实关闭**：

- 我自建的 197 句 hold-out 语料中，目标优先九族（陈述/否定/动相/被动/选择/条件/引用/罗列/英文）**86/86 只读，0 泄漏**（第十二轮该方向尚开 41 句）。
- 第十二轮的 361 句语料复跑：授权从 **63 降到 35**，其中目标优先 211/211 全关；`修改 X 尚未完成`、`修改 X 是必要的`、`X 拒绝修改`、`视情况而定，修改 X`、`fix X was not requested` 等登记原句已修。
- 登记回归网（12 正 + 77 负，独立提取复跑）**0 偏差**；文档化正例（动词优先 12/12、处置式、混合意图）全部可用。
- 客户端注入面 11 项 **0 通路**；前十二轮 P0/P1 复验 **17/17 通过**；六条契约命令全绿。

但 **sound 只成立到「动词之后没有尾巴」为止**：`LEAD_COMMAND_PATTERN` / `LEAD_COMMAND_EN_PATTERN` 允许目标之后接 **最多 16（英 12）个任意非句末标点字符的尾巴**，而该尾巴唯一的守卫仍是词表 `NON_COMMAND_MARKERS`（`requests.ts:175-176`）。因此**一切未登记谓词尾巴的陈述/意见/名词化句继续直通写授权**（本轮 hold-out **54 句 A 档非命令授权**；HTTP 22/22 落库授权；真实 Orchestrator 12/12 建立 `backend:queued` 写 Run）。条件前件仍是加词（`视情况` 命中、`视具体情况` 不命中），且在「条件子句被抑制后下一子句」处有一个**结构性复位缺陷**（`requests.ts:348`）——`经批准，修改 X，删除 Y` 会给 Y 发写授权。

| 维度 | 第十二轮 | 第十三轮 |
|---|---|---|
| 目标优先整类 | 已关闭（211/211） | **保持关闭（本轮 86/86 + 上轮 211/211）** |
| 动词优先无尾守卫 | 63 句非命令仍授权（3×P1） | **改为「有界尾巴」，但守卫仍是词表：54 句 A 档仍授权（新 P1）** |
| 英文 `fix X was not requested` | 授权 | **已修** |
| 条件前件 | 靠加词，21 句泄漏 | **仍靠加词：`视具体情况/经审批/先确认/收到消息后/after review/depending on…` 等 13 句泄漏；另有复位缺陷** |
| 选择/疑问尾 | `或`/A-not-A/`更合适` 等泄漏 | **登记原句已修；`算不算必要/有何意义/好在哪/更简单/更省事` 仍泄漏** |
| 处置式 `把/将/对` | 可用（5/6） | **可用；但多目标处置式只授权首个目标（P2）** |
| 写范围扩张到参照/保留目标 | 未测 | **未发现扩张（本轮 19 项作用域实验 0 扩张；仅见「首目标部分授权」）** |
| 误拒（`过/了/会/被/or/no/yes` 子串） | 12/16 | **未修：12/16（P2）** |
| 登记语料 | 86 负 + 19 正 + 3 声明 + 4 作用域 | **12 正 + 77 负，0 偏差（记录称 71 负，见 W3R13-07）** |
| 客户端注入面 | 无通路（11 项） | **无通路（11 项，0 授权/0 越权 Work）** |
| 前轮 P0/P1 复验 | 17/17 | **17/17；core/daemon src 零改动** |
| P1 数量 | 3 | **4** |

四条 P1 均落在本包验收面（AC-004 负例、AC-005 授权边界、`workflow.md` §1/§6），**全部以真实 HTTP + 真实 `Orchestrator` 端到端可复现**，**阻断 Test**。

---

## 2. 契约命令原始结果（本轮实跑）

执行目录：仓库根；在 `HEAD=9ebb5a6`、被审代码树 `6f48d26` 上执行；`pnpm build` 产物由本轮 build 生成。逐条串行，原始日志：`/tmp/r13-{typecheck,lint,unit,integration,docs,build2}.log`。

| 命令 | 退出码 | 原始结果要点 |
|---|---|---|
| `pnpm typecheck` | **0** | `tsc -p tsconfig.json --pretty false`，无输出（日志仅 1 行命令回显） |
| `pnpm lint` | **0** | `Checking formatting... All matched files use Prettier code style!` |
| `pnpm test:unit` | **0** | `Test Files 19 passed (19)`、`Tests 289 passed (289)`（Duration 2.95s） |
| `pnpm test:integration` | **0** | `Test Files 10 passed (10)`、`Tests 124 passed (124)`（Duration 21.37s；含 `container.integration.test.ts` 真实容器 9 例） |
| `pnpm docs:check` | **0** | `docs:check ok — 15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages` |
| `pnpm build` | **0** | `pnpm -r build`，**8** 个 workspace `build: Done`：`contracts, cli, domain, storage, core, daemon, pi-runtime, runner` |

`git status --porcelain`（写入本报告前）：**空输出**；`HEAD` 全程 `9ebb5a687ada6e6358d0c5a011f38ad83ab89626`；`git diff --name-only 6f48d26 HEAD` = 仅 `.agentdev/work/WP-03/review.md`。
计数对账：`implementation.md` T20（`:239`）的 `289 / 124 / 8 / docs:check ok` 与实测**一致**。

**命令全绿不等于必验范围成立**：T20 的四条 P1 证据句在仓库测试内**零断言**（`grep -rn "是不明智的\|算不算必要\|有何意义\|视具体情况\|经审批\|先确认\|收到消息后\|seems right\|was skipped" packages/*/test apps/*/test` 无命中）；`Orchestrator` 仍不出现在 `apps/daemon/test/server.test.ts`、`packages/core/test/artifacts.test.ts`（W3R4-05 / W3R12-06 延续）。本轮全部越权、误拒与端到端证据由我自建脚本建立。

---

## 3. 越权方向：独立穷举核验

### 3.1 口径声明（先声明后实测）

- **缺陷（fail-open）**：句子**不是祈使指令**（陈述/意见/名词化/疑问/反问/选择/条件前件/引用/排除），却在 `routeMessage` 上产生 `explicitAuthorization=true`（`writePaths` 非空）。
- **非缺陷（已声明代价，T19/T20 + planVersion 2）**：未登记**同义变更词**（`重写/润色/rewrite/polish`）落只读 + 澄清；**目标优先日常祈使**（`X 的错别字麻烦处理下`）落只读 + 澄清；多目标中文列表（`修改 X、Y`）与排除式（`修改 X 而不是 Y`）落只读 + 澄清。
- **非缺陷（真祈使）**：`并/and` 连接的两个真祈使（`修改 X 并删除 Y`）算命令；据此授权的两个路径**不计**扩张（各自子句各自目标）。
- **判定分档**：A 明确非命令（计入缺陷）；B 形态可辩（可作祈使读，单列不计入 P1 计数）；C 真祈使；F 已声明 fail-closed（只读即符合预期）。

### 3.2 语料与结果总表（`/tmp/w3r13/probe1-corpus.mjs`，197 句，全部消费 `pnpm build` 产物）

| 族 | 句数 | 授权 | 判定 |
|---|---|---|---|
| A1 目标优先陈述（34 谓词） | 34 | **0** | 关闭 |
| A2 目标优先否定 | 8 | **0** | 关闭 |
| A3 目标优先动相 | 7 | **0** | 关闭 |
| A4 被动 | 6 | **0** | 关闭 |
| A5 目标优先选择/疑问 | 6 | **0** | 关闭 |
| A6 条件/假设 | 6 | **0** | 关闭 |
| A7 引用/名词化/主题 | 9 | **0** | 关闭 |
| A8 无标点/多动词罗列 | 4 | **0** | 关闭 |
| A9 目标优先英文 | 6 | **0** | 关闭 |
| **B1 动词优先 + 陈述/意见/名词化尾** | 28 | **23** | **越权（全部 A）** |
| **B2 动词优先 + 选择/疑问尾** | 11 | **3** | **越权（A）** |
| B3 动词优先 + 夹问句词（已登记） | 7 | 0 | 关闭 |
| **B4 条件前件变体** | 15 | **15** | **越权（13 A + 2 B）** |
| **B5 条件子句后的复位** | 4 | **4** | **越权（A）** |
| **B6 英文动词优先 + 短陈述尾** | 9 | **6** | **越权（A）** |
| **B7 中英混合尾** | 5 | **4** | **越权（A）** |
| **B8 引号/括号** | 5 | **1** | **越权（A）** |
| B9 排除/保留/多目标 | 6 | 2 | 1 正确（`修改 Y，不要动 X` 只授权 Y）+ 1 部分授权（P2） |
| C 真祈使（必须授权） | 14 | **14** | 正确 |
| D 已声明 fail-closed（应只读） | 7 | **0** | 正确 |
| **合计** | **197** | **72** | **54 句 A 档缺陷 + 2 B + 1 正确 + 1 部分授权 + 14 正例** |

另：第十二轮 361 句语料在 `6f48d26` 上复跑（`/tmp/w3r12/probe1-corpus.mjs` 指向本轮 build）：授权 **63 → 35**，目标优先九族 0，仍开者为 B1=11、B2=2、B6=3、C1=9、C2=3、C3=2、D2=2、E1=2——**与第十二轮点名的越权家族完全同族**。

### 3.3 残留 fail-open（A 档，证据句）

**（1）有界尾巴仍是词表：陈述/意见/名词化（B1/B7/B8，28 句）**

`修改 X 是不明智的`、`修改 X 是个错误`、`修改 X 太冒险`、`修改 X 毫无必要`、`修改 X 没有意义`、`修改 X 不太合适`、`修改 X 不合适`、`修改 X 不是好主意`、`修改 X 的原因`、`修改 X 的必要性`、`修改 X 的动机`、`修改 X 的风险`、`修改 X 属于越权`、`修改 X 违反规定`、`修改 X 是浪费时间`、`修改 X 反而更糟`、`修改 X 是个好主意`、`删除 X 的原因`、`更新 X 的必要性`、`修改 X 由团队决定`、`修改 X 是最后手段`、`修改 X 更容易维护`、`修改 X 并未解决问题`、`修改 X 是一个非常不明智而且危险的决定`（尾巴 16 字符内）、`update X 是不明智的`、`fix X 不太合适`、`修改 X was planned`、`update X 的原因`、`修改 X（是不明智的）`。
**关键对照**：`修改 X 是必要的` 已只读（`是必要` 在词表），`修改 X 是不明智的` 授权（不在词表）——同形态因**是否命中词表**而结论相反，说明这不是句法判定。

**（2）条件前件仍是词表（B4，13 句 A）**

`视具体情况，修改 X`（`视情况` 命中、`视具体情况` 不命中）、`看结果，修改 X`、`等通知，修改 X`（`等消息` 命中、`等通知` 不命中）、`经审批，修改 X`（`经批准` 命中、`经审批` 不命中）、`先确认，修改 X`（`先讨论` 命中、`先确认` 不命中）、`先跟你确认，修改 X`、`收到消息后，修改 X`（`收到回复` 命中、`收到消息` 不命中）、`走完流程，修改 X`、`等评估完，修改 X`、`approval pending, update X`、`after approval, update X`、`after review, update X`、`depending on the result, update X`。
第十二轮 361 语料同族仍开：`在确认之前`、`审批通过后`、`先确认一下`、`评估完`、`待我确认`、`待批准`、`视结果`、`出错就`、`失败就`。

**（3）选择/疑问尾变体（B2，3 句 A）**

`修改 X 算不算必要`（`是必要` 命中、`算不算必要` 不命中）、`修改 X 有何意义`、`修改 X 好在哪`；第十二轮同族 `修改 X 更简单`、`修改 X 更省事`。

**（4）英文动词优先 + 短陈述尾（B6，6 句 A）**

`update X not needed`、`update X seems right`、`update X seems wrong`、`update X was planned`、`update X may fail`、`fix X was skipped`。

### 3.4 HTTP 端到端（`/tmp/w3r13/probe3-http.mjs`，真实 daemon：真实 SQLite + 真实 blob + Bearer）

32 句：**22/22 A 档非命令 fail-open** —— HTTP 202、`authorizationId` 非空、新增 1 条 `authorization` 行、新 Work `level=["L2"]`、`intent=["delivery"]`、`writePaths=["docs/INDEX.md"]`、写入 1 条 `assessment`。代表句：`修改 docs/INDEX.md 是不明智的`、`修改 docs/INDEX.md 的必要性`、`修改 docs/INDEX.md 属于越权`、`修改 docs/INDEX.md 算不算必要`、`修改 docs/INDEX.md 有何意义`、`视具体情况，修改 docs/INDEX.md`、`经审批，修改 docs/INDEX.md`、`先确认，修改 docs/INDEX.md`、`收到消息后，修改 docs/INDEX.md`、`after review, update docs/INDEX.md`、`depending on the result, update docs/INDEX.md`、`update docs/INDEX.md seems right`、`update docs/INDEX.md not needed`、`fix docs/INDEX.md was skipped`、`update docs/INDEX.md 是不明智的`、`修改 docs/INDEX.md（是不明智的）`。
对照组：6 条登记负例 6/6 只读（`authId=null`、`level=none`、零授权行）；4 条正例 4/4 授权。

### 3.5 真实 Orchestrator 端到端（`/tmp/w3r13/probe4-e2e.mjs`）

19 句：**12/12 A 档非命令各建立 1 个真实 `backend/implementation` 写 Run**（`writeRuns=["…:backend:queued"]`），全部经 `assess`（L2 + `authorizationRef` 通过 `verifyAuthorization`）与 Chief 父 Run。否定对照组 3/3 只读；正例 4/4 建写 Run。→ **准入闸门正常，越权来自授权判定本身。**

### 3.6 危害上界

越权授权的范围恒等于句中**被点名的那一个路径**（尾部第二个路径会被 `pathsIn(tail)` 拒绝），`operations=['read','edit']`、`networkTargets=[]`（`messages.ts:341-357`），环境/网络/越界路径仍被 `verifyAuthorization` 拒绝（probe8 的 19 项作用域实验 **0 扩张**）。危害是「用户只是陈述/提问/给条件，却产生了可执行的写授权与真实写 Run」，属 `workflow.md` §6 的 P1（错误行为/需求缺失）+ AC-004 负例失败，**不是数据/安全级 P0**。

---

## 4. 写范围恒等复核（`/tmp/w3r13/probe8-scope.mjs`）

- **扩张方向：未发现缺陷。** 参照/保留/排除目标从不进入写范围：
  - `修改 Y 保留 X` → 只读（尾巴含第二路径）；
  - `修改 Y，X 保持不动` → `granted=["Y"]`；
  - `参考 X 修改 Y`、`修改 Y 参考 X`、`基于 X 更新 Y`、`修改 Y 而不是 X`、`更新 Y instead of X` → 全部只读；
  - `把 Y 参照 X 改掉` → `granted=["Y"]`（处置式中段含第二路径也不扩张，因为只捕获首个路径）。
- **边界值**：尾巴 16 字符（ASCII 数字）只读、17 字符只读；但 15 个汉字的谓词（`是一个非常不明智而且危险的决定`）因计入前导空格恰为 16 而授权 → **字符上界挡不住谓词**。
- **两项部分授权（P2，见 W3R13-06）**：`修改 X and Y` → `granted=["X"]`；`把 X 和 Y 都改掉` → `granted=["X"]`。二者都**只授权了命令点名目标中的一个**（不扩张，但静默丢弃第二个目标），与 T20 声明的「多目标列表一律只读」不一致；中文 `修改 X 和 Y`、`修改 X、Y`、`修改 X 以及 Y` 则按声明只读。
- 多子句真祈使（`修改 X 并删除 Y`、`修改 X，删除 Y，更新 Z`）授权各自目标，符合预期（非扩张）。

---

## 5. 文档化正例与 fail-closed 取舍复核

- **动词优先/处置式/混合意图 12/12 授权**（独立提取登记正例并复跑，0 偏差）：`修复 X`、`修改 X 中的错别字`、`更新 X 的说明`、`处理一下 Y 的错别字`、`删除 X 的旧内容`、`清理 Y 的重复段落`、`fix the typo in X`、`update X`、`把 X 里的错别字改掉`、`将 Y 删除`、`对 Y 进行修改`、`不要修改 Y，但要修复 X`；混合 `解释 X 并修复 Y` HTTP 建 2 Work，写范围只含 Y。
- **已声明 fail-closed 7/7 只读**：`X 的错别字麻烦处理下`、`X 里的接口说明更新一下`、`重写 X`、`润色 X`、`polish X`、`修改 Y 而不是 X`、`修改 X、Y`。**方向为 fail-closed，不产生越权。**
- **合法祈使误拒 12/16（P2，W3R12-04 未修）**：`删除 X 的过时内容`、`清理 X 的过时段落`、`更新 X 里过时的接口说明`、`更新 X 里所有过时的链接和说明`、`修改 docs/过时说明.md`、`修改 docs/了解.md`、`修改 docs/会议.md`、`修改 docs/被删说明.md`、`update docs/a-or-b.md`、`fix docs/no-index.md`、`fix docs/yes-notes.md`、`把 X 改成新版本`（处置式要求变更动词收尾）。全部 fail-closed、无越权，但抬高 AC-005 的交互成本。

---

## 6. 客户端注入面与前轮 P0/P1 无回归复核

### 6.1 注入面（`/tmp/w3r13/probe5-injection.mjs`，真实 HTTP）

| 注入 | HTTP | 库结果 |
|---|---|---|
| `workItems:[…×50]` / `works:[…×50]` | 202（静默忽略） | workDelta=1（仅路由产出）、authDelta=0、无 write |
| `authorization:{scope:{writePaths:['packages/core/src'],operations:['read','edit']}}` | 202（忽略） | authDelta=0、`authorizationId=null` |
| `authorization:{operations:['deploy']}` | 202（忽略） | 零授权行 |
| `grants:[{operation:'edit',targets:[…]}]` | 202（忽略） | 零授权行 |
| `scope:{writePaths:['packages/core']}` + `level:'L3'` + `intent:'operation'` | 202（忽略） | 零授权行、无 L3 Work |
| `targetWorkId`（不存在） | **404** `NOT_FOUND` | 零副作用 |
| 未知字段 `foo`/`targetRole`/`ownerUserId` | 202（**静默忽略**） | 无副作用（承接 `protocol.md` §1/§3，W3R13-09） |
| 空 body / 缺 `conversationId` / 未知 `conversationId` | **400 / 400 / 404** | 零副作用 |

**结论：wire 层不存在 `authorization`/`workItems`/`works`/`grants`/`scope`/`level`/`intent` 通路，11 项注入零授权行、零越权 Work，无回归。** `apps/daemon/src/server.ts:171-180` 只读取 `conversationId/body/attachmentIds/targetWorkId`。

### 6.2 前轮 P0/P1 复核（`/tmp/w3r13/probe6-prior.mjs`，17/17 通过）

| 项目 | 本轮实测 | 状态 |
|---|---|---|
| W3-01 下载 token 可预测/先于认证（P0） | token 不内嵌 artifactId；首次 200、二次 403 | 无回归 |
| W3-02 产物读取无主体维度（P0） | 预览走 `assertReadable`；CSP 逐字、sandbox、`credentials: omit`、无 `set-cookie`、`nosniff` 全成立 | 无回归 |
| W3R3-01 授权 capability 缺口致死锁（P1） | `probe4` 正例 `assess`/`dispatch` 全通（含 `readPaths`+`read`） | 无回归 |
| W3R3-06 CSP 单头/逐字相等（P2） | `preview.ts` 哈希 `803b502a` 与第十二轮相同；头逐字等于 `PREVIEW_CSP` | 无回归 |
| W3R4-03 `assertGrantWithinMessage` 约束 `readPaths` | 代码仍在（`messages.ts:360-384`）；HTTP `authorization` 注入被忽略 | 无回归 |
| W3R4 review `targetWorkId` 跨会话 | 跨 Conversation 目标 Work → **403 `NOT_AUTHORIZED`** | 无回归 |
| W3R4 review 追发不改写 Work | 追发后 `level`/`authorizationRef` 不变、`authorizationId=null` | 无回归 |
| W3R7-01 只读请求词授权（P1） | `看一下/检查/评估/总结/列出` 全只读 | 无回归 |
| W3R7-03 混合否定+指令误拒（P1） | `别改 A，改 B`、`不要修改 A，但要修复 B` 只授权 B | 无回归 |
| A1 目标级排除 / A2 中文混合 / A3 纯建议（P1） | 排除/保留 0 扩张、混合 2/2、建议全只读 | 无回归 |
| W3R12-01 动词优先尾越权（P1） | 目标优先整类已关，**动词优先尾巴仍开** | **未闭合（→ W3R13-01）** |
| W3R12-02 选择/疑问尾（P1） | 登记原句已修，同族变体仍开 | **部分未闭合（→ W3R13-03）** |
| W3R12-03 条件前件（P1） | 登记原句已修，同族变体 + 复位缺陷仍开 | **部分未闭合（→ W3R13-02/04）** |
| W3R12-04 合法祈使误拒（P2） | **12/16 仍误拒** | **未修（→ W3R13-05）** |
| 登记语料 12 正 + 77 负 | `probe7` **0 偏差** | 无回归 |
| `packages/core/**`、`apps/daemon/src/**`、`preview.ts` | 哈希与第十二轮逐字相同 | 零改动 |

**未闭合承接**（P3，不单独阻断）：W3R4-05/W3R12-06（无 Orchestrator 授权回归用例）、W3R4-06/W3R12-07（`protocol.md` §5 未对账）、W3R4-08（`StorageError` 映射粗）、W3R4-10（`targetWorkId` 归属只覆盖 message 来源）、W3R4-12（multipart 多文件 / `projectId`）、W3R4-13（错误响应非 §1 封装）。

---

## 7. 记录与实现一致性核对

| 记录项 | 实测 | 结论 |
|---|---|---|
| T20「只授权两类子句…其余（陈述/疑问/选择/条件/引用/排除/多目标/丰富措辞）**一律只读**」 | 197 句 hold-out 中 **54 句 A 档非命令仍授权**；HTTP 22/22、e2e 12/12 | **不准确（W3R13-01..04）** |
| T20「尾部不得超过 16 字符、不得含第二个路径、不得含非命令标记」 | 长度与前两子句成立；「不得含非命令标记」是**词表**，未登记谓词仍放行（`是不明智的` vs `是必要的`） | **不准确（W3R13-01）** |
| T20「疑问/选择/建议出现在任一子句 ⇒ 整条消息不授权」 | 只对**词表命中**者成立：`算不算必要/有何意义/好在哪` 不命中即授权 | **不准确（W3R13-03）** |
| T20「条件子句使其下一子句同样非命令」 | 下一子句确被抑制，但**再下一子句会因 `requests.ts:348` 复位而授权**（`经批准，修改 X，删除 Y` → Y） | **不完整（W3R13-04）** |
| T20「明确取舍（**记录与 plan 一致**）」 | `plan.md` 哈希 `8986875e` 与第十一、十二轮逐字相同、**未改动**；planVersion 2 未登记目标优先祈使/多目标/排除式这三个具体 fail-closed 代价，也未登记动词优先尾巴的实际后果 | **不准确（W3R13-07）** |
| T20「回归网重写为 12 正 + **71** 负」 | 独立提取（处理 `don't` 的双引号项）：**12 正 + 77 负**，0 偏差；"71" 不可复现 | **不准确（W3R13-07）** |
| T20「unit 289 / integration 124 / build 8 / docs:check ok」 | 与实测**一致** | **准确** |
| T20「英文捕获形态必须真的是路径（`fix X was not requested` 不再把 `not` 当目标）」 | `pathsIn(target)` 校验在（`:248`）；该句已只读 | **准确** |
| T20「目标优先模板取消、处置式保留」 | `requests.ts` 无 `COMMAND_TAIL_PATTERN`；处置式可用 | **准确** |
| `implementation.md:3` `planVersion: 1` | `plan.md:3` 为 `planVersion: 2` | **记录头未同步（W3R13-07，第五轮延续）** |
| `implementation.md:113/:140/:177/:186`「永不下发写授权 / 一律只读」 | `:176`（T15）声称不再出现绝对表述，原文仍在；且被 `修改 X 尚未完成`/`修改 X 算不算必要` 证伪 | **名实不符（W3R13-07）** |
| planVersion 2「未登记的措辞可能落到只读路线（fail-closed）或（在未登记的同义变更词 + 命名路径下）产生授权」 | 前半句方向成立；后半句不成立（`重写 X` 实测只读）；且未声明 verb-first 尾巴越权 | **不完整（W3R13-07）** |
| 第八轮报告 `domain.test.ts` 哈希 `7483338` 笔误 | 未订正（实际 `e83e0e7c`） | 延续（W3R13-07） |

**记录侧硬约束（对 Test 有直接影响）**：T20 的「其余一律只读」与实测不符；若 Test 以 T20 为准，会把 §3.3 的 54 句越权判为「预期只读」而漏报。

---

## 8. 新 Findings（W3R13-xx）

### W3R13-01 [P1] 动词优先「有界尾巴」的守卫仍是词表：意见/陈述/名词化尾巴继续产生写授权并可派发真实写 Run（W3R12-01 族延续）

- **位置**：`packages/domain/src/requests.ts:198-201`（`LEAD_COMMAND_PATTERN`，目标后 `([^，。；！？]{0,16})$`）、`:203-206`（`LEAD_COMMAND_EN_PATTERN`，12 字符尾）、`:250`（尾巴只查「无第二路径 + 无词表标记」）、`:175-176`（`NON_COMMAND_MARKERS`）。
- **实测（我自建，未登记）**：`probe1` B1 **23/28**、B6 **6/9**、B7 **4/5**、B8 **1/5**。代表句：`修改 X 是不明智的`、`修改 X 是个错误`、`修改 X 不太合适`、`修改 X 的原因`、`修改 X 的必要性`、`修改 X 属于越权`、`修改 X 由团队决定`、`修改 X 是一个非常不明智而且危险的决定`（尾巴恰 16 字符）、`update X seems right`、`update X not needed`、`fix X was skipped`、`update X 是不明智的`、`修改 X（是不明智的）`。
- **判别依据**：这些句子的主语/话题是「修改（这件事）」或「修改 X 与否」，尾巴是谓语或名词化中心语，不是对执行者的祈使；对照第十一轮已登记负例 `X 尚未修改`，`修改 X 尚未完成` 是同一语义的两种语序。
- **端到端**：`probe3` HTTP 全部落库授权（L2 + 1 授权行 + 1 assessment）；`probe4` 建立真实 `backend/implementation` 写 Run（12/12）。
- **修复方向（结构性，勿再加词）**：把「目标 + 任意 ≤16 字符尾」改成**尾巴白名单**——允许项只应是闭合集合：空尾、句末标点、或 `的/中/里/内 + <受事名词白名单>`（如 错别字/段落/说明/旧内容/重复段落）；未命中的尾巴一律 fail-closed 并请求澄清。这样 `修改 X 中的错别字` 保持授权，`修改 X 的原因/是不明智的` 落到澄清。或更保守：**只授权 `V X`**（无尾），把带尾表达统一交给澄清。
- **验收面**：AC-004 负例失败；`workflow.md` §1「执行消息可直接授权明确目标」被扩大到「陈述/意见/名词化」。

### W3R13-02 [P1] 条件前件仍是词表枚举，未登记变体继续产生写授权（W3R12-03 族延续）

- **位置**：`requests.ts:155-158`（`CONDITION_PATTERNS`）、`:334-347`（`conditional` 计算与继承）。
- **实测**：`probe1` B4 **15/15** 授权（13 句明确条件 + 2 句 B 档），代表句：`视具体情况，修改 X`、`看结果，修改 X`、`等通知，修改 X`、`经审批，修改 X`、`先确认，修改 X`、`先跟你确认，修改 X`、`收到消息后，修改 X`、`走完流程，修改 X`、`等评估完，修改 X`、`approval pending, update X`、`after approval, update X`、`after review, update X`、`depending on the result, update X`。第十二轮 361 语料同族仍开 9（C1）+3（C2）+2（C3）。
- **根因**：条件身份由词表决定（`视情况` 命中 / `视具体情况` 不命中；`等消息` / `等通知`；`经批准` / `经审批`；`先讨论` / `先确认`；`收到回复` / `收到消息`）。第十一轮 §10 曾明确要求「不能继续靠往词表里加词」，T20 仍以加词收口。
- **端到端**：`probe3` 5/5 落库；`probe4` 4/4 建写 Run。
- **修复方向（结构性）**：把「前件」判定从词表改为**位置 + 结构**：命令模板只允许出现在**消息首子句**、或出现在**显式并列连词**（`并/并且/然后/再/and/then`）引导的子句；任何由其他子句（非命令、非并列）领起的命令子句一律视为受门前件 → 只读 + 澄清。该规则对 `视具体情况，`、`after review,`、`先确认，` 一律成立，不需要枚举条件词。
- **验收面**：同 W3R13-01。

### W3R13-03 [P1] 选择/疑问尾的未登记变体仍产生写授权（W3R12-02 族延续）

- **位置**：`requests.ts:149-152`（`CHOICE_PATTERNS`）、`:95-100`（`QUESTION_PATTERNS`）、`:175-176`（标记词表）。
- **实测**：`probe1` B2 3 句授权：`修改 X 算不算必要`、`修改 X 有何意义`、`修改 X 好在哪`；第十二轮同族 `修改 X 更简单`、`修改 X 更省事`。对照 `修改 X 是必要的`/`修改 X 划算不划算`/`修改 X 好在哪里` 已只读——**同形态因是否命中词表而结论相反**。
- **端到端**：`probe3` 3/3 落库；`probe4` 2/2 建写 Run。
- **修复方向**：把「选择/征询形态」整体并入疑问门：`A不A`/`A不A必要`/`有无X`/`有何X`/`好在哪`/`值不值`/`更[简省划]`；且疑问门应与标记门共用同一张表，避免两处漂移。若改为 §W3R13-01 的尾巴白名单，本条自动闭合（这些尾巴都不在白名单内）。
- **验收面**：同 W3R13-01。

### W3R13-04 [P1] 条件子句被抑制后会复位 `conditional`，使条件消息的后继命令获得写授权（结构性缺陷）

- **位置**：`requests.ts:338-349`，尤其 `:348` `if (reading.target !== undefined) conditional = false;`。
- **实测**：`经批准，修改 X，删除 Y` → `writes=["docs/PLAN.md"]`、HTTP L2 + 1 授权行 + 1 assessment、e2e 建 `backend/queued` 写 Run；`视情况而定，修改 X，删除 Y`、`先讨论，再修改 X，然后删除 Y`、`待你确认，修改 X，更新 Y` 同样成立（`probe1` B5 4/4）。
- **判别依据**：整条消息的首子句是条件前件，代码自己已把中间的命令子句降级为只读（`conditional===true`），却在同一轮无条件复位，使第三个子句重新获得授权。这与 `workflow.md` §1「执行消息可直接授权明确目标」及第十二/十三轮把条件视为非命令的口径都冲突。
- **修复方向**：抑制一个命令子句时**不得**复位 `conditional`（只有真正授权成功时才复位），或把 §W3R13-02 的「位置 + 结构」规则作为唯一门前件判定并删除 `conditional` 继承机制。
- **验收面**：同 W3R13-01；且这条是**任何词表扩充都无法修好**的结构缺陷。

### W3R13-05 [P2] 合法祈使被标记子串/收尾约束误拒（W3R12-04 未修）

- **位置**：`requests.ts:175-176`（裸 `了`、`过`、`会`、`被`、`or`、`yes`、`no` 对整子句 `test`）+ `:208-211`（处置式要求变更动词收尾）。
- **实测（复用 `probe10`）**：**12/16 误拒**：`删除 X 的过时内容`、`清理 X 的过时段落`、`更新 X 里过时的接口说明`、`更新 X 里所有过时的链接和说明`、`修改 docs/过时说明.md`、`修改 docs/了解.md`、`修改 docs/会议.md`、`修改 docs/被删说明.md`、`update docs/a-or-b.md`、`fix docs/no-index.md`、`fix docs/yes-notes.md`、`把 X 改成新版本`。
- **性质**：全部 fail-closed（不产生越权），但属「合法祈使被误拒」，抬高 AC-005 交互成本；`过时内容` 是第十轮起点名的文档化措辞。
- **修复方向**：标记判定按词边界/句法位置收窄（`过` 仅当动词后、`被/会` 仅在动词前、英文 `or/no/yes` 要求不与路径词元相邻），或先剥离 `的…名词` 修饰段与目标词元再判定；处置式允许 `把 X 改成<非路径宾语>`。
- **验收面**：不单独阻断；随修复轮订正。

### W3R13-06 [P2] 多目标命令出现「静默部分授权」，与声明的多目标 fail-closed 不一致

- **位置**：`requests.ts:276-277`（子句切分只处理 `，；。!！`、` and / then `、`并且/然后/同时/而且`、`并+动词`）+ `:208-211`（处置式中段不校验第二路径）。
- **实测**：`修改 X and Y` → `granted=["X"]`（英文 `and` 切分后第二子句无动词，被当成只读说明）；`把 X 和 Y 都改掉` → `granted=["X"]`（处置式只捕获首个路径）。而 `修改 X 和 Y`、`修改 X、Y`、`修改 X 以及 Y` 按声明**整体只读**。
- **性质**：授权范围是用户点名目标的**子集**，不构成越权（无害上界），但会静默丢弃第二个目标，且与 T20/planVersion 2 的「多目标列表一律只读并澄清」声明冲突。
- **修复方向**：让处置式与中文列表一致——中段出现第二个路径即判非命令（只读 + 澄清），或对 `and` 也做与 `和` 一致的多目标判定。
- **验收面**：不单独阻断；Test 须区分「只读澄清」与「部分授权」两种口径。

### W3R13-07 [P3] 记录名实不符：T20 声明与实现/测试/plan 不一致（连续第七轮）

- **实测**：见 §7 表。要点：①「其余一律只读」被 54 句 A 档证伪；②「记录与 plan 一致」不成立（`plan.md` 哈希 `8986875e` 未改动，未登记目标优先/多目标/排除式代价与 verb-first 尾巴后果）；③「71 条必须只读」实际 77 条；④ `implementation.md:3` 仍 `planVersion: 1`；⑤ `:176` 声称绝对表述已删，`:113/:140/:177/:186` 的「永不/一律」仍在；⑥ 第八轮哈希笔误未订正；⑦ T20 自述「尾部不得含非命令标记」把词表当句法保证。
- **性质**：不单独阻断；但 Test 若以 T20 为准会漏报 P1。
- **建议**：把绝对表述限定为「已登记语料范围内」；把本轮四类实际后果（verb-first 尾巴 fail-open、条件词表 + 复位、选择尾、多目标部分授权）写入 `plan.md` planVersion 2/3 残余风险；同步 `planVersion` 头；把「71」改为实测 77；订正第八轮哈希笔误。

### W3R13-08 [P3] 回归网缺口：四条 P1 的证据句零断言，授权→`assess`/`dispatch` 仍无产品用例

- **实测**：`grep -rn` 本轮代表句（`是不明智的/算不算必要/有何意义/视具体情况/经审批/先确认/收到消息后/seems right/was skipped`）在 `packages/*/test`、`apps/*/test` **0 命中**；`grep -rl Orchestrator apps/daemon/test packages/core/test/artifacts.test.ts` = **0**（W3R4-05 延续）。
- **性质**：不阻断（P1 已由我自建脚本证明），但修复后必须以回归断言固化：尾巴白名单的负例/正例、条件前件的位置规则、复位缺陷、选择尾、以及「授权正例 → `assess(L2)` → `dispatch(backend/implementation)` 成功 / 越界 grant 拒绝」。
- **承接**：与 W3R12-06、W3R11-07、W3R10-05、W3R4-05 同项。

### W3R13-09 [P3] 协议对账与 wire 语义承接（W3R12-07 / W3R4-06/08/10/12/13 延续）

- **未知字段**：`foo:1`/`targetRole:'backend'`/`ownerUserId:'attacker'` 仍 **202 静默忽略**，而 `protocol.md` §1 要求未知字段返回 `VALIDATION_ERROR`；`protocol.md:46` 把 `targetRole?:Role` 列为 `conversation.message.send` 的合法参数，daemon 不读取（文档化参数被静默丢弃）。
- **响应形状**：`conversation.message.send` 响应含 `workIds`/`authorizationId`，`protocol.md:46` 只列 `{messageId,workId,state,version}`（加法扩展未对账）。
- **同批承接**：`POST /artifacts/upload` 的 multipart `projectId` 字段被忽略、多文件只保留最后一个（`parseMultipart` 覆盖 `file`）；`StorageError` 映射、`targetWorkId` 归属、错误响应非 §1 封装。

---

## 9. 计数与阻断判定

| 严重度 | 数量 | 编号 | 是否阻断 |
|---|---|---|---|
| P0 | 0 | — | — |
| **P1** | **4** | W3R13-01（有界尾巴仍是词表：意见/陈述/名词化）、W3R13-02（条件前件词表）、W3R13-03（选择/疑问尾变体）、W3R13-04（`conditional` 复位缺陷） | **阻断** |
| P2 | 2 | W3R13-05（合法祈使误拒 12/16；fail-closed）、W3R13-06（多目标静默部分授权） | 不单独阻断，须随修复轮订正 |
| P3 | 3 | W3R13-07（记录名实不符/plan 未同步）、W3R13-08（回归网缺口/无 Orchestrator 用例）、W3R13-09（协议对账） | 不阻断，承接 Test |

- 四条 P1 **均落在本包验收面**：AC-004 负例被证伪、`workflow.md` §1 授权边界被证伪；均以真实 HTTP + 真实 `Orchestrator` 证明可派发真实 Backend 写 Run。
- 失败路由：`Blocking Review Finding → Develop → Independent Review`（`docs/rules/workflow.md` §6）。
- 第十二轮 3 条 P1 的本轮裁定：**W3R12-01 的登记原句与目标优先整类已修，但同族「动词优先 + 未登记尾巴」仍开（→ W3R13-01）**；**W3R12-02 登记原句已修，同族选择/疑问尾仍开（→ W3R13-03）**；**W3R12-03 登记原句已修，同族条件前件仍开且新增复位缺陷（→ W3R13-02/04）**。W3R12-04 未修（→ W3R13-05）。

---

## 10. 能否进入独立 Test —— **不能**

**判据**：`docs/rules/workflow.md` §6「P0/P1 阻断」。四条 P1 中任意一条即足以阻断，且均可端到端复现。**必须先走 `Develop → Independent Review`。**

### 10.1 修复后重评的最低要求

修复轮必须至少做以下二选一的结构性改造（而不是继续加词），并保留全部已登记正例：

1. **尾巴白名单**（修 W3R13-01/03）：目标之后只允许空尾、句末标点，或闭合的 `的/中/里/内 + <受事名词白名单>`；其余尾巴一律只读 + 澄清。
2. **位置 + 结构门前件**（修 W3R13-02/04）：命令模板只允许出现在首子句或显式并列连词引导的子句；抑制一个命令子句时不得复位 `conditional`；删除对条件词表的依赖，或至少让「未命中的前件子句」也构成门。

以下新增句必须只读并落成长期断言（与已声明 fail-closed 区分）：

- **尾巴族**：`修改 X 是不明智的`、`修改 X 是个错误`、`修改 X 不太合适`、`修改 X 的原因`、`修改 X 的必要性`、`修改 X 属于越权`、`修改 X 由团队决定`、`修改 X 是一个非常不明智而且危险的决定`、`update X seems right`、`update X not needed`、`fix X was skipped`、`update X 是不明智的`、`修改 X（是不明智的）`。
- **条件族**：`视具体情况，修改 X`、`看结果，修改 X`、`等通知，修改 X`、`经审批，修改 X`、`先确认，修改 X`、`先跟你确认，修改 X`、`收到消息后，修改 X`、`走完流程，修改 X`、`等评估完，修改 X`、`after review, update X`、`after approval, update X`、`depending on the result, update X`。
- **复位族**：`经批准，修改 X，删除 Y`、`视情况而定，修改 X，删除 Y`、`先讨论，再修改 X，然后删除 Y`、`待你确认，修改 X，更新 Y`。
- **选择族**：`修改 X 算不算必要`、`修改 X 有何意义`、`修改 X 好在哪`、`修改 X 更简单`、`修改 X 更省事`。
- **不得回归（负例）**：77 条登记负例逐句成立；目标优先九族抽样（`X 尚未修改`、`X 拒绝修改`、`X 正在修改`）仍只读。
- **不得回归（正例）**：12 条登记正例逐句授权且 `writePaths` 只含命令自身目标；`删除 X 的过时内容`、`修改 docs/过时说明.md`、`把 X 改成新版本` 应随 W3R13-05 修复后授权。
- **多目标口径**：`修改 X、Y`、`修改 X 和 Y`、`修改 X and Y`、`把 X 和 Y 都改掉` 统一为只读 + 澄清（或统一为「各子句各自目标」，必须与记录一致）。
- **已声明 fail-closed（断言只读，不算缺陷）**：`X 的错别字麻烦处理下`、`X 里的接口说明更新一下`、`重写/润色/polish`、排除式。

### 10.2 Test 最小覆盖矩阵（修复轮后必须覆盖）

| # | 维度 | 最小用例（≥） | 期望 |
|---|---|---|---|
| 1 | 尾巴白名单（W3R13-01） | `是必要的`（白名单外应只读）对比 `中的错别字`（授权）；`是不明智的/的原因/的必要性/属于越权/seems right/not needed` 各 1 | 前者只读、后者授权且写范围仅目标 |
| 2 | 条件前件（W3R13-02） | `视具体情况，/看结果，/等通知，/经审批，/先确认，/收到消息后，/after review,/depending on the result,` 各 1 | 全部只读 |
| 3 | 条件复位（W3R13-04） | `经批准，修改 X，删除 Y` 等 4 句 | 只读，零授权行 |
| 4 | 选择/疑问尾（W3R13-03） | `算不算必要/有何意义/好在哪/更简单/更省事` 各 1 | 只读 |
| 5 | 目标优先关闭（回归） | 16 谓词 × ≥2 动词 | 只读 |
| 6 | 误拒修复（W3R13-05） | `删除/清理 X 的过时内容`、`修改 docs/过时说明.md`、`修改 docs/会议.md`、`fix docs/no-index.md`、`把 X 改成新版本` | 授权且写范围只含目标 |
| 7 | 处置式/混合/排除 | `把 X 里的错别字改掉`、`解释 X 并修复 Y`、`不要修改 Y，但要修复 X`、`修改 Y 而不是 X` | 授权且写范围仅目标；排除式只读 |
| 8 | 多目标口径（W3R13-06） | 中/英/处置式三种多目标表达 | 与记录声明一致（全只读或各子句各自目标） |
| 9 | 登记语料 | 12 正 + 77 负 | 逐句成立 |
| 10 | HTTP 端到端（≥3 句/族） | 上述 1/2/3/4 组经 `POST conversation.message.send` | `authorizationId=null`、`level=none`、零授权行、无 `delivery` Work |
| 11 | **Orchestrator 回归（仍未闭合）** | 授权正例 `assess(L2)` → `dispatch backend/implementation` 成功；grant 外路径 + `deploy`/`network` → `NOT_AUTHORIZED` | 建 Run / 拒绝 |
| 12 | 注入面不回归 | `workItems/works/authorization/grants/scope/level/intent/targetRole/ownerUserId` 注入 | 全部忽略且零授权（未知字段按 W3R13-09 决定后断言） |
| 13 | 前轮 P0/P1 | 下载 token 一次性、预览 ACL/CSP 逐字、`assertGrantWithinMessage`、跨会话 `targetWorkId`、追发不改写 Work | 无回归（`probe6` 17/17 已通过） |
| 14 | 附件/产物面 | 上传限制/TTL/重复绑定、版本链/失效、预览截断、单次下载 | 无回归（本轮未动，抽验即可） |

### 10.3 残余风险清单（区分文档化缺陷与已声明 fail-closed）

**A. 文档化缺陷 —— 必须修（P1 阻断；P2 随修复轮订正）**
1. W3R13-01 有界尾巴仍是词表（54 句 A 档；HTTP 22/22、e2e 12/12 可写）。
2. W3R13-02 条件前件词表（13 句 A；HTTP/e2e 可写）。
3. W3R13-03 选择/疑问尾变体（`算不算必要/有何意义/好在哪/更简单/更省事`）。
4. W3R13-04 `conditional` 复位缺陷（词表扩充无法修复）。
5. W3R13-05 合法祈使误拒 12/16（fail-closed，无越权）。
6. W3R13-06 多目标静默部分授权。
7. W3R13-07 记录名实不符与 `plan.md` 未同步。

**B. 已声明 fail-closed 代价 —— 已登记，接受并需 Test 承认**
8. 目标优先日常祈使（`X 的错别字麻烦处理下`、`X 里的接口说明更新一下`）→ 只读 + 澄清（`implementation.md` T19/T20、`domain.test.ts` 负例 2 条；**`plan.md` 仍未登记，见 W3R13-07**）。
9. 未登记同义祈使（`重写/润色/rewrite/polish/tweak`）→ 只读 + 澄清（`plan.md:17-18`）。
10. 多目标中文列表与排除式（`修改 X、Y`、`修改 X 而不是 Y`）→ 只读 + 澄清（T20；**但英文 `and`/处置式不一致，见 W3R13-06**）。
11. 处置式要求变更动词收尾（`把 X 改成新版本`）→ 只读（T19 模板定义；对应 W3R13-05）。
12. 标记子串导致路径名/复合词误拒（`过时/会议/了解/被删/a-or-b/no-index/yes-notes`）→ 只读（W3R13-05，方向安全）。
13. 语义分类的最终责任在 WP-04/06 模型 Assessment；本包只承诺已登记语料与形态规则。

**C. 与本包无关或已承接**
14. W3R13-08/09 与 W3R12-06/07、W3R11-07/08、W3R4-05/06/08/10/12/13（P3，结算前登记或修复）。
15. 真实无头浏览器攻防（WP-10）；真实 Provider 纵向与 `artifact_write` 工具接线（WP-10/WP-07）。

---

## 11. 方法与边界声明

- **独立上下文**：未读取任何开发/Test 会话；结论只来自仓库文件、`docs/**` 契约与我自建的 6 个脚本（`/tmp/w3r13/probe1-corpus`、`probe3-http`、`probe4-e2e`、`probe5-injection`、`probe6-prior`、`probe7-registered`、`probe8-scope`，其中 5/6 从第十二轮模板改写）+ 复用 `/tmp/w3r12/probe1-corpus.mjs`、`/tmp/w3r11/probe10-falsereject.mjs`，全部消费 `pnpm build` 产物（`packages/domain/dist/requests.js`、`apps/daemon/dist`、`packages/core/dist`）；**未 import 任何产品测试文件**（`domain.test.ts` 仅以文本方式用引号感知的 tokenizer 提取语料，提取后逐句用**构建产物**复跑）。
- **实验统计（观测 / 缺陷证据）**：

| 脚本 | 观测 | 缺陷证据 | 对应 |
|---|---|---|---|
| `probe1-corpus.mjs` | 197 句（21 族） | 目标优先 86/86 只读；**54 句 A 档授权**（+2 B、+1 部分授权） | W3R13-01/02/03/04/06 |
| `probe2`（并入 probe1 的 C/D 组） | 14 正 + 7 声明性 | 正例 14/14；声明性 7/7 只读 | §5 |
| `probe3-http.mjs` | 32 句真实 HTTP | **22/22 A 档非命令落库授权**（L2 + 1 授权行 + 1 assessment）；登记负例 6/6 只读、正例 4/4 授权 | W3R13-01/02/03/04 |
| `probe4-e2e.mjs` | 19 句真实 Orchestrator | **12 条非命令各建立真实 `backend/implementation` 写 Run** | W3R13-01/02/03/04 |
| `probe5-injection.mjs` | 11 注入项 | 0 授权行、0 越权 Work；未知字段静默忽略 | §6.1, W3R13-09 |
| `probe6-prior.mjs` | 17 项前轮 P0/P1 | **17/17 通过** | §6.2 |
| `probe7-registered.mjs` | 登记 **12 正 + 77 负** | **0 偏差**（记录称 71 负 → W3R13-07） | 回归网 |
| `probe8-scope.mjs` | 29 项作用域/边界 | **0 扩张**；2 项部分授权；尾巴 16 字符内含谓词仍授权 | §4, W3R13-06 |
| `/tmp/w3r12/probe1-corpus.mjs`（复用） | 361 句旧语料 | 授权 **63 → 35**（目标优先全关，其余同族仍开） | §3.2 |
| `/tmp/w3r11/probe10-falsereject.mjs`（复用） | 18 项 | **12 非对照误拒**；处置式 4/4 授权 | W3R13-05 |

- **对开发方「sound 文法 = 越权方向结构性关闭」主张的裁决**：**目标优先方向成立，越权方向整体不成立**。删除目标优先模板、对尾巴设长度/路径上界、英文必须捕获真路径，都是真实进步（目标优先 86/86 + 211/211 只读，第十二轮语料 63→35，登记正例与处置式保持可用）。但「有界尾巴」并不等于「句法受限」：尾巴谓词仍由**词表**判别，`修改 X 是必要的`（词表内）与 `修改 X 是不明智的`（词表外）结论相反；条件前件同理（`视情况` vs `视具体情况`）。这与第八～十二轮同一根因（**形态判定退化为词表枚举**），因此本轮仍判 **FAIL**。
- **未做**：真实无头浏览器执行、真实 Provider 纵向、Docker 容器内复验、故障注入下的孤儿 blob 复验、`pnpm test:e2e`/`test:acceptance`（脚本按设计指向 WP-09/WP-10，未实现）。
- **未改仓库**：本轮只覆盖写入 `.agentdev/work/WP-03/review.md`（本报告）；除该文件外 `git status --porcelain` 为空，`HEAD` 仍为 `9ebb5a687ada6e6358d0c5a011f38ad83ab89626`，全部 6 条契约命令在上述工作树上执行。

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
