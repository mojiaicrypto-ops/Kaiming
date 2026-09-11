# WP-03 独立 Review 报告（第七轮）

- 评审对象：工作包 WP-03「直接协作与说明产物」
- 评审轮次：**第七轮**（第一～六轮摘要见文末「附一～附六」，全部保留）
- 冻结点 / HEAD：`git rev-parse HEAD` = `8f8b2dffd13f235297b7f5a1d8ec9f10331637a5`（**与任务下达的 `HEAD=8f8b2df` 一致**，第七轮首次无冻结点漂移）
- 工作树：全部命令前后、本报告写入前 `git status --porcelain` 均为**空**
- 评审角色：Review（独立上下文；未读取任何开发/Test 会话；只依据仓库文件、契约文档与 `/tmp/w3r7/` 下我自建的 9 个实验脚本）
- 工具：`node v24.8.0`、`pnpm 12.3.4`、macOS 宿主
- 记录哈希（`git hash-object`，前 8 位）：`packages/domain/src/requests.ts` `be52ad9f`、`packages/core/src/messages.ts` `4220aac5`、`packages/core/src/preview.ts` `803b502a`、`packages/core/src/artifacts.ts` `057ff403`、`packages/core/src/attachments.ts` `3ee94838`、`apps/daemon/src/server.ts` `f5aab4f5`、`packages/domain/test/domain.test.ts` `0a81588f`、`packages/core/test/artifacts.test.ts` `c6011971`、`apps/daemon/test/server.test.ts` `6d8a9244`、`.agentdev/work/WP-03/plan.md` `8986875e`、`.agentdev/work/WP-03/implementation.md` `d9c6ab74`、`docs/architecture/protocol.md` `edbba2b8`、`docs/architecture/execution.md` `7ef649f4`、`docs/delivery/acceptance.md` `c0340ef4`
- 权威依据：`AGENTS.md`、`docs/INDEX.md`、`docs/rules/{workflow,agents}.md`、`docs/product/experience.md`（§3）、`docs/architecture/{data,protocol,execution,reliability}.md`、`docs/delivery/{implementation,acceptance}.md`（AC-001..006/052/076/084）、`.agentdev/work/WP-03/{plan,implementation,review}.md`、`packages/**`、`apps/daemon/**`、相关测试

---

## 1. 结论

**FAIL（不能进入独立 Test；按 `docs/rules/workflow.md` §6 走 `Blocking Review Finding → Develop → Independent Review`）。**

第六轮对抗性四项中 **1 项真修好、2 项部分、1 项名义修好但记录不自洽**；planVersion 2 声明的判定边界**部分与实现一致、部分与实现和记录相反**；前六轮 P0/P1 **未见回归**（六条契约命令全绿，W3-01/02/04/05/06、W3R3-01 端到端可用性全部复现通过）。

| 第六轮对抗项 | 要求 | 本轮实测 |
|---|---|---|
| 陈述/完成体/认识情态只读 | 真修 | **部分**——`domain.test.ts` 登记的 27 句负例 + 11 句正例**双向全对**（27/27、11/11）；但同类变体仍 fail-open：完成体 9/9 越权、`谁/哪些/几点` 疑问越权、英文 `The fix needed in…`/`needs a fix` 越权，HTTP 端到端 3/3 派发写 Run（**W3R7-02，P1**）。根因是 `\b(?:已经|已|刚才|刚刚)` 在中文语境恒不匹配（正则缺陷，`requests.ts:75`） |
| 日常祈使句授权 | 真修 | **登记 3 句全对**，类探针 5/6；`顺手把 X 的笔误修一下`/`修一下 X`/`在 X 里补一行` 仍误拒（未登记同义变更词，属 boundary 声明的残余代价） |
| `workItems` 空 scope | 真修 | **已修**（同 intent 多项不再产生空 scope；对照第六轮 probeF3 的第一项 L2/第二项 none+空 scope，本轮两项都带 `writePaths`）——但引出副作用 **W3R7-04（P3）** |
| 记录措辞 | 订正 | **部分**——T12:130/T13:143 已撤回「永不下发」，但 T11:113 仍保留该绝对句；T13:140 新写「陈述、完成体与认识情态**一律**只读」与实测相反；planVersion 2 的「不确定一律 fail-closed」与实现相反（**W3R7-03，P2**） |

**本轮同时发现一条由 848b5c4 修复引入的 P1 回归**：为支持「日常祈使句」而新增的 `REQUEST_ACTION_PATTERN`（`requests.ts:83-84`）把**只读请求词与礼貌词**（`看一下/检查一下/帮忙/帮我/麻烦/请`）当作「修改动词」参与授权判定，于是「看一眼 `docs/INDEX.md`」「请查看 `docs/INDEX.md`」「帮我总结 `docs/INDEX.md`」「请评估 `docs/INDEX.md`」等**纯查看/评估请求**会落库写授权、建 L2 delivery Work、并可真实派发 Backend 写 Run（**W3R7-01，P1**）。对照实验：同一批句子在 `7c01c9d` 全部**不**授权，在 `848b5c4` 全部授权——这是**回归**，不是「未登记的新句式」。

本轮新增 **6 条 Finding：0×P0、3×P1、1×P2、3×P3**。三条 P1 全部落在本包验收面（AC-004 负例、AC-005 正例），违反不可覆盖的授权/Gate 规则，**阻断 Test**。

---

## 2. 契约命令原始结果（本轮实跑）

执行目录：仓库根；逐条命令串行执行，原始日志 `/tmp/w3r7/{typecheck,lint,test-unit,test-integration,docs-check,build}.log`、`/tmp/w3r7/run.sh`。

| 命令 | 退出码 | 原始结果要点 |
|---|---|---|
| `pnpm typecheck` | **0** | `tsc -p tsconfig.json --pretty false`，无输出 |
| `pnpm lint` | **0** | `Checking formatting... All matched files use Prettier code style!` |
| `pnpm test:unit` | **0** | `Test Files 19 passed (19)`、`Tests 288 passed (288)`（2.67s） |
| `pnpm test:integration` | **0** | `Test Files 10 passed (10)`、`Tests 124 passed (124)`（28.87s，含真实容器/镜像用例） |
| `pnpm docs:check` | **0** | `docs:check ok — 15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages` |
| `pnpm build` | **0** | `pnpm -r build`，**8** 个 workspace `build: Done`：`contracts, cli, domain, storage, core, daemon, pi-runtime, runner` |

`git status --porcelain` 在全部命令前后均为空；`HEAD` 全程 `8f8b2dffd13f235297b7f5a1d8ec9f10331637a5`。

补充实测（供结算对账）：`packages/domain/test/domain.test.ts` **32** 例、`packages/core/test/artifacts.test.ts` **16** 例、`apps/daemon/test/server.test.ts` **16** 例；unit 19 文件、integration 10 文件。`implementation.md:145`（T13）的 `unit 288 / integration 124 / build 8` 与实测**一致**。

**命令全绿不等于必验范围成立**：288 个单测中，路由相关的新增断言仍是**枚举句式**（`domain.test.ts:284-344` 的 27 负 + 11 正），没有任何用例覆盖「只读请求词族」「完成体变体」「混合否定+指令」；`packages/core/test/artifacts.test.ts` 与 `apps/daemon/test/server.test.ts` 均**不含** `Orchestrator`（grep 实证），因此仍然没有「消息授权 → `assess`/`dispatch`」的回归用例（W3R4-05 未闭合）。本轮断言全部由我自建 probe 建立。

---

## 3. 第六轮对抗性逐条复核（含代码位置）

判定口径：**已修** = 本轮观察到期望行为；**部分** = 主行为成立但有可指认残差；**未修** = 行为仍缺失；**名实不符** = 记录/边界声明与代码或实测相反。

| # | 第六轮对抗项 | 判定 | 证据（文件:行 + 实测） |
|---|---|---|---|
| 1 | 陈述/完成体只读 | **部分** | `requests.ts:74-80`（`STATEMENT_PATTERNS`）、`:189-191`（命中即只读）。登记句 27/27 负例全部不授权（含 `我已经修改了 X`、`刚修复了 X`、`I already fixed X`、`X 需要修改`、`是否应该修改 X`、`是否需要更新 X`、`麻烦评估一下 X 是否需要修改`）。但**同类完成体变体 9/9 仍授权**（probe5 P5.2）：`我已经改好了 X`、`已经改好 X`、`已改好 X`、`我刚刚改完 X`、`我已经处理了 X`、`已经优化了 X`、`刚刚补充了 X`、`我已删除 X`、`我已经把 X 的链接补上了`；HTTP+端到端 3/3 可派发写 Run（probe4 P4.2）→ **W3R7-02** |
| 2 | 认识情态只读 | **部分** | 登记句与中文变体 8/8 通过；英文 `docs/INDEX.md should be updated`、`needs to be fixed` 通过，但 `docs/INDEX.md probably needs a fix` 仍授权（`STATEMENT_PATTERNS` 的英文备选只覆盖 `needs? (to be )?fixed/changed/updated`，不覆盖名词 `a fix`）→ 并入 **W3R7-02** |
| 3 | 日常祈使句授权 | **已修（登记集）** | `requests.ts:83-84`（`REQUEST_ACTION_PATTERN`）、`:194-197`。登记 3 句（`X 的错别字麻烦处理下`、`麻烦处理一下 X 里的错别字`、`X 的错别字请帮忙处理`）HTTP 均授权且 `operations=['read','edit']`（probe2 C）；类探针 5/6（`把 X 的错字改一下`/`请把 X 更新一下`/`帮我把 X 里的链接补上`/`把 X 中的英文改成中文` 通过；`顺手把 X 的笔误修一下` 不授权） |
| 4 | `workItems` 第二个同 intent 项 scope 为空 | **已修（引出副作用）** | `messages.ts:177-185`（`scopeFor` 回落 `matching.at(-1)?.scope`）。probe2 E：同 intent 三项→ `writePaths=['docs/INDEX.md']` 三项皆有，**零空 scope**；HTTP 复核 `empty-scope Works=0`。副作用：额外项带 `writePaths` 但 `level=none`、无 `authorizationRef`，`assess` 直接 `VALIDATION_ERROR ... is none and cannot declare a write or environment scope`（probe4 P4.3）→ **W3R7-04** |
| 5 | 记录中「永不下发写授权」措辞不实 | **部分** | `implementation.md:130`（T12「**但不宣称「永不下发」**」）、`:143`（T13「不再宣称启发式判定「永不」误判」）已撤回；但 `:113`（T11）仍原文保留「解释句、疑问句、否定句…**永不下发写授权**」且未就地标注失效；同时 `:140`（T13）新增更强断言「陈述、完成体与认识情态**一律**只读」，被本轮 9 个完成体反例证伪 → **W3R7-03** |

**第六轮对抗性另补项**（`7c01c9d` 时点名、T13 声称修复的其它项）复核：CSP 单头**已真修**（probe4 P4.1：wire 上恰一个 `content-security-policy`，与 `execution.md:45` 逐字相等；`x-agentdev-preview-sandbox=allow-scripts`、`preview-credentials=omit`）；`readPaths` 越界注入**已修**（probe3 P3.2：`NOT_AUTHORIZED`，且消息一致授权仍接受）；`workItems` 上限**已修**（4→202、5/50→400 且零写入）；daemon 不接受客户端 `authorization` **保持**。

---

## 4. 已登记语料双向复核与 planVersion 2 边界一致性

### 4.1 `domain.test.ts` 登记表：双向 27/27 + 11/11 全对

从 `packages/domain/test/domain.test.ts` **按文本**提取两个 `for (const body of [...])` 句式表（未 import 测试模块），逐句跑 `pnpm build` 产物 `packages/domain/dist/index.js`：

| 方向 | 句数 | 结果 |
|---|---|---|
| 负例（不得授权：疑问/拒绝/假设/引用/陈述/完成体/认识情态） | 27 | **27/27** `explicitAuthorization=false` 且所有 `writePaths` 为空 |
| 正例（必须授权：明确指令 + 日常祈使句） | 11 | **11/11** `explicitAuthorization=true` 且首项 `writePaths>0` |

HTTP 端复核同向一致：负例 27/27 无授权行、`level=none`；正例 11/11 建授权行（`operations=['read','edit']`、`readPaths==writePaths==` 命名路径、`level=L2`、Work 与授权 scope 一致）（probe2 B/C）。

**结论：以 `domain.test.ts` 句式表为「已登记语料」，双向判定正确。**

### 4.2 以**报告登记**的越权语料为准：未双向正确（7/17 + 1/11 仍不成立）

planVersion 2 的原文是「负向覆盖**已登记的越权语料**」。项目里最早、最完整登记越权语料的地方是第五轮 Review 报告（即本文件的前身，`.agentdev/work/WP-03/review.md` §6.1/§6.2，仍保留在附五）。按该语料逐句复核（probe7/probe8）：

| 语料来源 | 句数 | 本轮仍不成立 | 逐字残留 |
|---|---|---|---|
| 第五轮 §6.1 越权语料（17 句，须不授权） | 17 | **7** | `修改 docs/INDEX.md 了没有`、`Will you fix docs/INDEX.md`、`Any thoughts on the fix for docs/INDEX.md`、`The explanation for the fix in docs/INDEX.md`、`docs/INDEX.md needs a fix`、`The fix needed in docs/INDEX.md`、`我不想修改 docs/INDEX.md` |
| 第五轮 §6.2 误拒语料（11 句，须授权） | 11 | **1** | `别改 docs/INDEX.md，改 docs/PLAN.md` |
| 第六轮补充语料 A3（20 句，须不授权） | 20 | **8** | `Will you please fix…`、`Has the typo in … been fixed`、`Were you asked to fix…`、`Shall we update…`、`May I ask you to fix…`、`暂且别改…`、`千万别说要改…`、`我建议对…的修改再等等` |

7 句越权残留中 4 句是第五轮报告**逐字登记**的原句（`修改…了没有`、`Will you fix…`、`The fix needed in…`、`docs/INDEX.md needs a fix`），却在第六轮被从回归网中**剔除**：`domain.test.ts` 登记表只收了第五轮 17 句中的 10 句。因此「负向覆盖已登记越权语料」这一声明**与事实不符**。

### 4.3 边界声明与实现/记录的一致性逐项判定

| planVersion 2 声明（`plan.md:17-18`） | 实现事实 | 判定 |
|---|---|---|
| 「指令子句 = **修改动词** + 命名路径」 | `requests.ts:194-197` 把 `REQUEST_ACTION_PATTERN`（含只读词 `看一下/检查一下` 与礼貌词 `帮忙/帮我/麻烦/请`）与 `MODIFICATION_PATTERN` 一起当作「修改动词」 | **不一致**（W3R7-01 根因） |
| 「且**不含**疑问/拒绝/假设/引用/**陈述/完成体**标记」 | 中文陈述备选 `\b(?:已经\|已\|刚才\|刚刚)` 在 Han 语境恒不匹配（probe5 P5.1）；`谁/哪些/几点` 不在 `QUESTION_PATTERNS`；否定标记命中整子句即整子句只读 | **不一致**（W3R7-02 根因） |
| 「**正向覆盖文档化场景**（明确修复/混合意图）」 | 明确指令与登记混合意图通过；但 `别改 A，改 B` / `不要修改 A，但要修复 B` / `别动 A，去更新 B` 仍只读（probe9） | **部分不一致**（W3R7-03） |
| 「**负向覆盖已登记越权语料**」 | 见 §4.2：报告登记的 17 句仍有 7 句越权 | **不一致**（W3R7-03） |
| 「对任何**不确定一律 fail-closed**」 | 实现是**黑名单 + 默认放行**：未被任一 block pattern 命中且含变更动词+路径即授权；未登记措辞是 fail-open | **与实现相反**（W3R7-03） |
| 「不承诺覆盖任意新句式」（`plan.md:17`） | 与实现相符，作为**残余风险**成立 | 一致 |
| 「残余风险登记见 T12/T13 与结算材料」 | `implementation.md:130` 有一般性残余风险表述；但 T13:140 的「一律只读」、T12:129「别 仅在词首否定动作」与实测不符 | **部分不一致**（W3R7-03） |

---

## 5. 前六轮 P0/P1 回归复核

**结论：未发现已修项回归**；六条契约命令全绿，`unit` 288（第六轮 T13 亦记录 288）、`integration` 124（与第三～五轮一致）、`build` 8。

| 来源 | 项 | 本轮状态 |
|---|---|---|
| 一轮 P0 | W3-01 下载 token 可预测 | 未回归（probe3 P3.1：43 字符 base64url、不含产物 id 前缀、单次消费 200→403） |
| 一轮 P0 | W3-02 产物读取无主体维度 | 单用户语义保持（预览/下载均先 `assertReadable`，`x-agentdev-preview-credentials: omit`） |
| 一轮 P1 | W3-04 正文未落 blob | 未回归（probe3 P3.1：`message_body` 行 hash 与 blob 内容 sha256 相等、内容等于消息正文） |
| 一轮 P1 | W3-05 未知会话 500 | 未回归（404） |
| 一轮 P1 | W3-06 失效产物仍可预览无标识 | 未回归（`x-agentdev-artifact-validity: invalid`，仍可读） |
| 一轮 P1 | W3-07/08 AC-006/AC-005 机制 | 机制成立（probe2 C、probe6） |
| 三轮 P1 | W3R3-01 授权 capability 缺口 → 交付死锁 | **仍然修好**（probe6：`operations=['read','edit']`、`readPaths==writePaths`；`assess('L1')` 被 floor 拒、`assess(L2)` 通过；grant 内写 Run 派发成功；grant 外写路径 `NOT_AUTHORIZED`；environment 操作 `NOT_AUTHORIZED`） |
| 三轮 P2 | W3R3-06 CSP 漂移 | 已修且**逐字相等**（probe4 P4.1） |
| 四轮 P2 | W3R4-03 `readPaths` 越界 | **已修**（probe3 P3.2） |
| 五轮 P1 | W3R5-01 非执行消息越权 | **未修好**（本轮 W3R7-01/02 取代并扩大） |
| 五轮 P1 | W3R5-02 明确指令误拒 | **部分**（`别改 A，改 B` 仍误拒 → W3R7-03） |

---

## 6. 本轮重点实验（授权判定，三个方向）

### 6.1 新 fail-open 家族：只读请求获得写授权（W3R7-01）

**回归因果实验**（probe `/tmp/w3r7/old/cmp.mjs`，用 Node 原生 TS strip 直接执行 `git show 7c01c9d:packages/domain/src/requests.ts` 与 HEAD 副本）：

| 句式 | `7c01c9d` | `848b5c4`=HEAD |
|---|---|---|
| 看一下 docs/INDEX.md | 不授权 | **授权** |
| 检查一下 docs/INDEX.md | 不授权 | **授权** |
| 帮我检查一下 docs/INDEX.md | 不授权 | **授权** |
| 麻烦看一下 docs/INDEX.md | 不授权 | **授权** |
| 请查看 docs/INDEX.md | 不授权 | **授权** |
| 帮我总结 docs/INDEX.md | 不授权 | **授权** |
| 请评估 docs/INDEX.md | 不授权 | **授权** |
| 麻烦评估 docs/INDEX.md | 不授权 | **授权** |
| 请阅读 docs/INDEX.md | 不授权 | **授权** |

HTTP 端（probe2 A/D，真实 SQLite + 真实 HTTP + 真实 Orchestrator）：

- 11/11 只读请求 → `202`、`authorizationId≠null`、新增 1 条 authorization 行（`readPaths=writePaths=['docs/INDEX.md']`、`operations=['read','edit']`）、Work `intent=delivery, level=L2`。额外两句同样越权：`请参考 docs/INDEX.md 的格式`、`麻烦确认 docs/INDEX.md 的内容`。
- 端到端 3/3：`帮我检查一下 docs/INDEX.md`、`请评估 docs/INDEX.md`、`请总结 docs/INDEX.md` 均可 `assess(L2)` 并成功派发 Backend `purpose=implementation` 写 Run（`status=queued`）。
- 对照的只读句因未命中词表而正确 fail-closed：`分析一下 docs/INDEX.md`、`帮我看看 docs/INDEX.md`、`看一下 docs/INDEX.md 有没有问题`、`请说明 docs/INDEX.md`、`麻烦解释 docs/INDEX.md`（说明该家族由**新加的词表**而非语义判定造成）。

根因：`requests.ts:83-84` 的 `REQUEST_ACTION_PATTERN` 把 `处理|调整|优化|完善|纠正|替换|换成|补上|弄好|搞定|过一遍|处理下|处理一下|看一下|检查一下|帮忙|帮我|麻烦|请` 整体当「动作」，并在 `:194-197` 与 `MODIFICATION_PATTERN` 并列为 `modifies`。其中 `看一下/检查一下` 是**只读动词**，`帮忙/帮我/麻烦/请` 是**礼貌前缀**（可出现在任何请求前），二者任一与命名路径同现即授权。

### 6.2 陈述/完成体/疑问仍 fail-open：`\b` 正则缺陷（W3R7-02）

**根因实验**（probe5 P5.1）：

```
/\b(?:已经|已|刚才|刚刚)\s*(?:修改|修复|更新|改|…)/u
  '我已经改好了 docs/INDEX.md'  -> no match
  '已经改好 docs/INDEX.md'      -> no match
  '已改好 docs/INDEX.md'        -> no match
  \b between 我 and 已: false ; at string start: false
  同模式去掉 \b:            -> true
```

`\b` 是 ASCII 词边界，Han 字符两侧皆非 `\w`，故该备选**在普通中文里恒不匹配**；`我已经修改了 X` 之所以通过，靠的是另一条备选 `(?:修改|修复|…|调整)了`（且该备选的动词表不含 `处理/优化/补充/删除`，也不含 `改好/改完` 形式）。

HTTP + 端到端（probe4 P4.2，全部 `authId≠null`、`level=L2`，并成功派发 Backend 写 Run）：

| 句式 | HTTP | 端到端写 Run |
|---|---|---|
| 我已经改好了 docs/INDEX.md | 授权 | **派发成功** |
| I just fixed docs/INDEX.md | 授权 | **派发成功** |
| 谁改的 docs/INDEX.md | 授权 | **派发成功** |

`何时/何处` 之外的中文疑问词（`谁/哪些/几点`）不在 `QUESTION_PATTERNS`（`requests.ts:46-51`，中文表无 `谁/哪个/哪些/几点`），因此疑问句带变更动词+命名路径即授权：`谁改的 docs/INDEX.md`、`哪些 docs/INDEX.md 的段落要改`、`docs/INDEX.md 几点更新`、`这是谁改的 docs/INDEX.md` 均授权。

### 6.3 反向仍误拒：混合否定+指令与未登记同义变更词（W3R7-03 / 残余风险）

probe9（期望=必须授权，实测不授权）：

| 句式 | 结果 | 归属 |
|---|---|---|
| 别改 docs/INDEX.md，改 docs/PLAN.md | **误拒** | W3R7-03（P1，第六轮已点名） |
| 不要修改 docs/INDEX.md，但要修复 docs/PLAN.md | **误拒** | W3R7-03 |
| 不要修改 docs/INDEX.md，改 docs/PLAN.md | **误拒** | W3R7-03 |
| 别动 docs/INDEX.md，去更新 docs/PLAN.md | **误拒** | W3R7-03 |
| 顺手把 docs/INDEX.md 的笔误修一下 | 误拒 | 残余风险（未登记同义变更词，boundary 已声明代价） |
| 修一下 docs/INDEX.md 的错别字 | 误拒 | 残余风险 |
| 在 docs/INDEX.md 里补一行说明 | 误拒 | 残余风险 |

根因：`readClause` 先判否定（`requests.ts:183-185`），而 `CLAUSE_SPLIT_PATTERN`（`:135-136`）只按句末标点与「，+ then/然后/并且/同时/而且/and」切分，`，改`/`，但`/`，去` 不切分，于是「别改 A，改 B」成为**一个**含否定标记的子句 → 整句只读，B 的目标被吞掉。`修改 docs/PLAN.md 而不是 docs/INDEX.md` 与 `先别改 X，等你确认后修改 Y` 反而通过（后者因「，等」未切分但否定后另有 `修改` 命中且路径被收集）。

### 6.4 仍然闭合的方向（本轮复核通过）

- 客户端无法自报授权：daemon 无 `authorization` 字段（probe3 P3.2），Core 侧 `assertGrantWithinMessage` 拒 `readPaths`/`writePaths`/环境/网络越界，消息一致授权仍接受。
- 写路径/环境越界被拒：probe6 P6.3（`NOT_AUTHORIZED`）。
- 授权自洽且可用：probe6 P6.1/P6.2（`read+edit`、`readPaths==writePaths`、L1 floor 拒绝）。
- 登记正例（含顿号列表、`识别/特别/分别/说明`）与登记负例：见 §4.1。
- `workItems`：上限 4、非法项 400 + 事务回滚零写入、客户端项抑制 delivery（probe2 E）。

---

## 7. AC 复核（AC-001..006/052/076/084）

| AC | 本轮判定 | 依据 |
|---|---|---|
| AC-001 自由问答 | **部分** | 问答建 Work、不建 Requirement 成立；完整「Chief 调查→回答→Work 完成」仍依赖 WP-04/06/07 |
| AC-002 HTML说明 | **部分** | 上传→绑定→user Artifact→受权预览→一次性下载全链路通过（probe3）；失效产物可读且带 validity；内容生产者仍属 WP-04/06 |
| AC-003 按需委派 | **部分（无链路证据）** | `assess`/`dispatch` 链路成立（probe6），但「用户消息→Chief 分派 purpose=analysis/artifact 专业 Run→汇总」仍无端到端证据 |
| AC-004 执行授权边界 | **不通过** | probe2 A/D + probe4 P4.2：只读请求（11 类）与陈述/疑问（3 类）产生真实写授权、L2 delivery Work，并可 `assess` + 派发 Backend 写 Run；「消息与授权记录负例」要求不成立 |
| AC-005 明确启动 | **不通过** | 登记正例成立，但报告登记语料的正例仍失败：`别改 A，改 B` 等 4 例不授权（probe9）；反例失败同 AC-004 |
| AC-006 混合意图 | **部分** | 登记混合意图（解释+修改）通过；「否定一个目标 + 指令另一个目标」的混合消息只读（probe9，W3R7-03）；「解释产物先返回」执行者仍属 WP-04/06/07 |
| AC-052 HTML安全 | **部分（HTTP 契约层）** | probe4 P4.1：唯一 CSP 与 `execution.md:45` 逐字相等、`x-agentdev-preview-sandbox`、`omit`/`no-store`/`nosniff`；真实浏览器攻防仍属 WP-10 |
| AC-076 附件限制 | **通过（服务端）** | probe3 P3.3：第 6 个附件拒、错误 mime 拒、magic-byte 不符拒；残差为 multipart 多文件静默丢弃（W3R7-06） |
| AC-084 首条消息附件 | **通过（本包范围）** | probe3 P3.3：暂存→发送→原子绑定→user Artifact→幂等重放→重复绑定拒绝 |

---

## 8. 新 Findings（W3R7-xx）

严重性口径：P0 数据/安全或关键不可用；P1 错误行为/需求缺失；P2 局部质量/维护问题；P3 建议。P0/P1 阻断；P2/P3 影响验收才阻断。

### W3R7-01 [P1] 只读请求（查看/检查/总结/评估/参考/确认）获得写授权并可派发写 Run（848b5c4 引入的回归）

- 位置：`packages/domain/src/requests.ts:83-84`（`REQUEST_ACTION_PATTERN` 把 `看一下/检查一下/帮忙/帮我/麻烦/请` 当动作）、`:194-197`（与修改动词并列参与 `modifies`）
- 实测：probe2 A `11/11` 越权（HTTP 授权行 + L2 delivery Work）；probe2 D `3/3` 端到端派发写 Run；probe1 P1.5 逐条 `ops=["read","edit"]`
- 回归对照：同一批句在 `7c01c9d` 全部不授权，在 `848b5c4` 全部授权（probe `/tmp/w3r7/old/cmp.mjs`）
- 影响：违反 AC-004（用户仅查看/询问 → 未授权不启动交付）；这是**修复引入的新缺陷**，不属于 planVersion 2 声明的「未登记新句式」残余风险
- 最小修复方向：把 `REQUEST_ACTION_PATTERN` 拆成「变更类请求词」（处理/调整/优化/完善/纠正/替换/补充…）与「只读类请求词/礼貌前缀」两组，只让前者参与 `modifies`；`看一下/检查一下/查看/阅读/参考/确认/核对/审阅/总结/评估/列出/读一遍` 与 `请/麻烦/帮我/帮忙` 单独出现不得授权（礼貌前缀只能修饰已识别的变更动词）

### W3R7-02 [P1] 陈述/完成体与中文疑问句仍 fail-open（`\b` 正则缺陷 + 动词表枚举不全）

- 位置：`requests.ts:75`（`\b(?:已经|已|刚才|刚刚)` 在 Han 语境恒不匹配）、`:76`（`…了` 备选动词表缺 `处理/优化/补充/删除/改好/改完`）、`:79`（英文 `needs a fix`/`the fix needed` 未覆盖）、`:46-51`（中文疑问词缺 `谁/哪个/哪些/几点`）
- 实测：probe5 P5.1 根因（同模式去 `\b` 即匹配）；P5.2 `9/9` 完成体变体授权；P5.3 `4/7` 疑问句授权；probe4 P4.2 `3/3` HTTP + 端到端派发写 Run；probe7 P7.1 第五轮登记语料 `7/17` 仍越权
- 影响：违反 AC-004；与 planVersion 2 的「不含陈述/完成体标记」「不确定一律 fail-closed」及 `implementation.md:140`「陈述、完成体与认识情态一律只读」直接矛盾
- 最小修复方向：删除 `\b`（或用 `(?<![\p{Script=Han}])` 之类的显式边界）；把完成体识别改为「变更动词 + 了/好/完/过/上」的形态而非固定列表；补中文疑问词；对「陈述/完成体标记（已经/已/刚刚/…了/…好/…完/需要/应该/是否）」采用**先检测后放行**的顺序，并把这些句式落成负例测试

### W3R7-03 [P1] 混合否定+指令仍误拒：`别改 A，改 B` 等 4 例不授权（AC-005/AC-006 正例失败）

- 位置：`requests.ts:135-136`（`CLAUSE_SPLIT_PATTERN` 不在 `，改/，但/，去` 处切分）、`:183-185`（否定命中即整子句只读）
- 实测：probe9 —— `别改 docs/INDEX.md，改 docs/PLAN.md`、`不要修改 docs/INDEX.md，但要修复 docs/PLAN.md`、`不要修改 docs/INDEX.md，改 docs/PLAN.md`、`别动 docs/INDEX.md，去更新 docs/PLAN.md` 全部 `authorizationId=null`、Work `level=none`（probe8 HTTP 复现其中第 1 例）；第六轮对抗性 probeA2 已点名第 1 例
- 影响：AC-005（用户明确指定要改的目标 → 原消息作为范围授权）与 AC-006（混合消息拆分）失败；fail-closed 不放大权限，但交付路线无法启动。**注意**：本轮未主张「永不下发」——此条只要求「指令子句中的目标不应被同句否定语吞掉」
- 最小修复方向：子句切分补 `，` + 转折/接续（但/但是/不过/而是/改/去/请改）或改为「按动词短语切分」；否定只否定其**支配的动词短语与目标**，不影响同句其它指令子句

### W3R7-04 [P2] 边界声明与实现/记录不一致（「一律只读」「不确定一律 fail-closed」「负向覆盖已登记越权语料」均不成立）

- 位置：`plan.md:17`（判定边界与「不确定一律 fail-closed」）、`plan.md:18`（负向覆盖已登记越权语料）、`implementation.md:113`（残留「永不下发」）、`:140`（「一律只读」）、`:141`（「使日常祈使句在命名目标时正常授权」表述过宽）
- 实测：§4.2（报告登记 17 句仍 7 句越权、11 句仍 1 句误拒）、§4.3（黑名单+默认放行，非 fail-closed）、§6.2（完成体 9/9 越权）、probe9（`修一下/补一行` 不授权）
- 影响：planVersion 2 明确要求「Review/Test 应针对『已登记语料 + 边界声明』判定」，因此**边界声明本身是 Test 的契约**；声明与实现相反会让 Test 以文档为权威时误判放行（`docs/rules/workflow.md` §6「报告不能以应该通过代替执行」同理）。不单独阻断（已有 3×P1），但必须与 P1 修复同批订正
- 最小修复方向：把声明改为实测口径（「负向覆盖 `domain.test.ts` 登记句式；未登记措辞可能 fail-open，属残余风险，由 WP-04/06 模型 Assessment 与 Test 负例网承接」），或先把 §4.2 的 7+1 句补进登记表；删除/标注 `implementation.md:113`；把 T13:140 改为「新增词表覆盖登记句式，非穷尽」

### W3R7-05 [P3] `workItems` 同 intent 回落 scope 产生「有写 scope 但 level=none、无 authorizationRef」的不可执行 Work

- 位置：`packages/core/src/messages.ts:177-185`（`matching[rank]?.scope ?? matching.at(-1)?.scope`）
- 实测：probe4 P4.3 —— 一个消息 + 2 个 delivery `workItems` → 第 1 项 `level=L2` 且有 `authRef`，第 2 项 `writePaths=['docs/INDEX.md']`、`operations=['read','edit']`、`level=none`、`authRef=null`；对其 `assess(L2)` 直接 `VALIDATION_ERROR ... is none and cannot declare a write or environment scope`。对比第六轮「空 scope」是另一种病态，本次只是换了形态
- 影响：客户端（该字段在 `protocol.md` 未声明）可创建看似有范围、实则永远无法执行的 Work；不放大权限。建议：额外同 intent 项要么回落**只读** scope（不声明写），要么拒绝超出路由项数的 `workItems`

### W3R7-06 [P3] 前轮未闭合项与记录数字（无进展）

- `W3R5-05`：`targetWorkId` 的 `sourceRef.kind≠'message'` 跨会话 Work 仍 `202`（应 403/404）——probe3 P3.4 实测
- `W3R5-06`：被 400 拒的发送仍留下孤儿正文 blob（DB 回滚、blob 不回滚；实测文件数 4→5）——probe3 P3.4
- `W3R4-12`：multipart 两个 file part 静默保留其一（`201`）、未知 `projectId` 上传 `201`——probe3 P3.4
- `W3R4-13`：错误响应体仍为 `{ok:false,error:{…}}`，缺 `protocol.md` §1 的 `v/type/id`——probe3 P3.4
- `W3R4-08`：`StorageError` 仍只分「缺引用→404 / 其余→500」；`VERSION_CONFLICT`/`DUPLICATE_KEY` 未按 `protocol.md` §7 细分
- `W3R4-06`：`protocol.md:46` 仍未声明 `workItems`，返回体未列 `workIds`/`authorizationId`（daemon 实际返回），`targetRole` 有文档无实现
- `W3R4-05`：仍无「消息授权 → `Orchestrator.assess`/`dispatch`」回归用例（`artifacts.test.ts`、`server.test.ts` 均无 `Orchestrator`，grep 实证）
- 记录数字：`implementation.md:46`（T6）仍 `278 passed / 7 workspace`、`:104`（T10）仍 `12 daemon 例`；实测 unit 288（19 文件）、integration 124（10 文件）、build 8、daemon 16

---

## 9. 计数与阻断判定

| 严重性 | 本轮新增 | 编号 | 是否阻断 |
|---|---|---|---|
| P0 | 0 | — | — |
| P1 | **3** | W3R7-01（只读请求获得写授权，848b5c4 回归）、W3R7-02（陈述/完成体/疑问 fail-open，`\b` 缺陷）、W3R7-03（`别改 A，改 B` 混合指令误拒） | **阻断** |
| P2 | 1 | W3R7-04（边界声明与实现/记录不一致） | 影响 Test 契约；随 P1 同批订正 |
| P3 | 3 | W3R7-05（不可执行的回落 scope Work）、W3R7-06（前轮未闭合 + 记录数字） | 不阻断 |

**仍未修好清单（按优先级）**
1. **P1** W3R7-01：只读/礼貌请求（`看一下/检查一下/请/麻烦/帮我` + 命名路径）授权并可派发写 Run（新回归）。
2. **P1** W3R7-02：完成体（`改好了/改完了/已删除/已经处理了`）、中文疑问（`谁/哪些/几点`）、英文（`Will you fix`/`needs a fix`/`The fix needed in`）仍授权；`\b` 使中文陈述备选形同虚设。
3. **P1** W3R7-03：`别改 A，改 B`、`不要修改 A，但要修复 B` 等 4 例混合指令不授权（AC-005/AC-006 正例失败）。
4. **P2** W3R7-04：planVersion 2 的「不确定一律 fail-closed」「负向覆盖已登记越权语料」、T13 的「一律只读」与实现相反；报告登记的 7+1 句未纳入回归网。
5. **P3** W3R7-05（回落 scope 的不可执行 Work）、W3R7-06（`protocol.md` 对账、孤儿 blob、归属、multipart/`projectId`、错误封装、StorageError 映射、记录数字）。

**已修好确认**：第六轮 CSP 单头（逐字相等）、`readPaths` 越界守护、`workItems` 上限、登记陈述/认识情态 27 句负例、登记日常祈使句 3 句正例；一轮 P0/P1、二轮 P1、三轮 P1（W3R3-01）端到端可用性、四轮 P2（W3R4-03）均未回归。

---

## 10. 能否进入独立 Test —— **不能**

- 依据 `docs/rules/workflow.md` §6：P0/P1 阻断。本轮 **3×P1**，且全部直接对应本包验收面：
  - AC-004 负例被证伪两处（只读请求、陈述/疑问）；
  - AC-005/AC-006 正例在混合否定+指令下失败。
- 失败路由：`Blocking Review Finding → Develop → Independent Review`。修复后必须**重新独立 Review**（授权判定是安全边界，不能用开发自测替代），通过后才可进入 Test。

### 10.1 Test 最小覆盖矩阵（修复轮后必须覆盖）

| # | 维度 | 最小用例 | 断言 |
|---|---|---|---|
| 1 | 只读请求负例（W3R7-01） | `看一下 X`、`检查一下 X`、`帮我检查一下 X`、`麻烦看一下 X`、`请查看 X`、`请参考 X`、`帮我总结 X`、`请评估 X`、`麻烦评估 X`、`请阅读 X`、`麻烦确认 X`、`帮我核对/审阅 X`、`请列出 X 的章节`、`帮我把 X 读一遍` | `authorizationId=null`、零新增 authorization 行、所有新 Work `level=none`；至少 3 例继续喂回 `assess`/`dispatch`，断言写 Run 被 `NOT_AUTHORIZED`/`VALIDATION_ERROR` 拒 |
| 2 | 陈述/完成体负例（W3R7-02） | `我已经改好了 X`、`已经改好 X`、`已改好 X`、`我刚刚改完 X`、`我已经处理了 X`、`已经优化了 X`、`刚刚补充了 X`、`我已删除 X`、`我已经把 X 的链接补上了`、`I just fixed X`、`The typo in X was fixed by me`、`docs/INDEX.md has been updated`、`docs/INDEX.md probably needs a fix`、`The fix needed in X`、`X needs a fix` | 同上（含端到端至少 2 例） |
| 3 | 中文/英文疑问负例（W3R7-02） | `谁改的 X`、`这是谁改的 X`、`哪些 X 的段落要改`、`X 几点更新`、`修改 X 了没有`、`Will/Shall/May/Were/Has … X` | 同上 |
| 4 | 第五轮登记语料回归（W3R7-04） | 第五轮 §6.1 的 17 句 + §6.2 的 11 句**逐字**入表 | 负例零授权、正例授权 |
| 5 | 混合否定+指令正例（W3R7-03） | `别改 A，改 B`、`不要修改 A，但要修复 B`、`不要修改 A，改 B`、`别动 A，去更新 B` | 授权仅覆盖 B（`writePaths==[B]`）、`operations=['read','edit']`、A 不在 scope；`assess(L2)` 通过、grant 内写 Run 通过、grant 外拒绝 |
| 6 | 登记正例端到端（AC-005） | `修改 X 中的错别字`、`识别并修复 X`、`特别修改 X`、`分别修复 X 和 Y`、`X 的错别字麻烦处理下` | 授权行、scope=命名路径、`level=L2`、`assess(L2)` 通过、grant 内写 Run 通过、grant 外 `NOT_AUTHORIZED`（本项建立 W3R4-05 的 Orchestrator 回归） |
| 7 | 登记负例端到端（AC-004） | `我已经修改了 X`、`X 需要修改`、`是否应该修改 X`、`I already fixed X`、`不要修改 X`、`如果 X 需要修改，请告诉我` | 零授权行、`level=none`、写 Run 与写文件均被拒 |
| 8 | AC-006 混合意图 | 解释+修改（前置/后置、中英、分号/逗号变体） | 两 Work 独立 scope/budget、解释 Work 零授权、delivery L2 可派发写 Run |
| 9 | `workItems` | 非法项 400 + 回滚零写入；上限 4/5/50；重复 intent 的独立 scope；抑制 delivery；回落项不得产生「有写 scope 但 level=none 且无 authRef」的 Work | 状态码/写入计数/每 Work `level`+`scope`+`authRef` 断言（W3R7-05） |
| 10 | `targetWorkId` | `none`/`L1`/`L2`/`L3` 目标 + 跨会话 message 来源 403 + 非 message 来源（修复后应拒） | level 与 `authorizationRef` 不变、零新增授权 |
| 11 | 预览/CSP（AC-052） | wire 上恰一个标准 `Content-Security-Policy` 且逐字等于 `execution.md:45`；`x-agentdev-preview-sandbox`/`omit`/`no-store`/`nosniff`；validity；1 MiB/2000 行截断头；下载 token 单次 + 60s TTL | 原始响应头逐一断言 |
| 12 | 附件/首条消息（AC-076/084） | 数量 6/单个 >20 MiB/总 >50 MiB/错误 mime/magic 不符；staged→发送→原子绑定→user Artifact→幂等重放→重复绑定拒绝→过期清理 | 服务端拒绝 + 零残留引用 + DB 行断言 |
| 13 | 前轮回归 | token 不可预测、正文 blob、未知会话 404、失效预览 validity、非整数 `artifactVersion` 400、孤儿 blob、multipart 多文件、未知 `projectId`、错误封装、StorageError 映射 | 与 `protocol.md` §1/§7 对账 |

### 10.2 必须显式承接的残余风险清单

1. **启发式路由的固有误判（已由 planVersion 2 声明）**：未登记同义变更词（`修一下`、`补一行`、`弄一下`、`tweak`…）落到只读路线（fail-closed，代价是澄清一轮）；未登记的「同义变更词 + 命名路径」组合仍可能授权。Test 不得把「任意新句式」作为放行条件，但**必须**把修复轮登记的负例网作为放行条件。
2. **模型 Assessment 接管前的窗口**：`routeMessage` 在 WP-04/06 落地前是唯一授权生成者；本轮的三个 P1 说明「关键词黑名单」在双向都会出错，WP-04/06 接管前必须保留确定性负例防线。
3. **单用户语义**：`assertReadable`/owner 派生按安装级单用户实现；多用户需重做（WP-04/06 范围）。
4. **`workItems`/`authorization`/`workIds` 协议化缺口**：daemon 接受未文档化字段；`protocol.md:46` 与 `docs/architecture/protocol.md` §5 需在结算前对账。
5. **真实浏览器攻防与真实 Provider**：AC-052 的浏览器级读 cookie/网络/父页/top-navigation 复验属 WP-10；AC-001/002/003 的内容生产纵向属 WP-04/06/10。
6. **孤儿 blob GC**、`targetWorkId` 归属统一、`StorageError` 映射与 `protocol.md` §1 错误封装：本包未闭合，承接结算或后续包。
7. **记录数字与提交说明**：T6/T10/T11 旧数字、T11:113 的绝对表述、提交信息与代码的对账，须在结算前一次性订正，否则 Test 以文档为权威会误判。

---

## 11. 方法与边界声明

- 独立上下文：未读取任何开发/Test 会话对话；结论只来自仓库文件、`docs/**` 契约与我自建的 9 个脚本（`/tmp/w3r7/harness.mjs`、`probe1..9.mjs`、`/tmp/w3r7/old/cmp.mjs`），全部消费 `pnpm build` 产物（**未 import 任何产品测试文件**；`domain.test.ts` 仅以**文本**方式提取句式表）。
- 实验统计（观测/失败）：

| 脚本 | 观测 | 失败 | 失败对应 |
|---|---|---|---|
| probe1（domain 登记表 + 场景类） | 102（+7 informational） | 20 | W3R7-01（9 只读）、W3R7-02（6 完成体 ZH + 2 EN + 1 疑问 + 1 EN 认识情态）、W3R7-03/残余（1 日常祈使句） |
| probe2（HTTP 授权 + workItems） | 57 | 14 | W3R7-01（A 11 + D 3） |
| probe3（P0/P1 回归 + 第六轮修复 + AC-076/084） | 21 | 1（我脚本的 CSP 正则取整行，probe4 已改正） | 无产品缺陷 |
| probe4（CSP 逐字、陈述变体端到端、scope 回落、事件） | 4 | 3 | W3R7-02（端到端 3） |
| probe5（根因：`\b`、完成体、疑问词、礼貌+只读词） | 26 | 21 | W3R7-02（9 完成体 + 4 疑问 + 8 只读） |
| probe6（授权自洽/floor/grant 覆盖） | 6 | 0 | 无 |
| probe7（第五/六轮语料复跑） | 57 | 17 | W3R7-02（P7.1 的 7）、W3R7-03（P7.2 的 1）、W3R7-02（P7.3 的 8）、T13 点名 1 |
| probe8（第五轮残留 HTTP） | 8 | 8 | W3R7-02（7）、W3R7-03（1） |
| probe9（混合否定/祈使句） | 16 | 7 | W3R7-03（4）、残余风险（3） |
| 合计 | **297** | **91** | 全部与 Findings 或已声明残余风险一一对应 |
- 未做：真实无头浏览器执行、真实 Provider 纵向、Docker 容器内复验、`createMessageOperations` 接线后的越权复现（全仓库无调用方）。
- 未改仓库：本轮只覆盖写入 `.agentdev/work/WP-03/review.md`（本报告）；`git status --porcelain` 在写报告前为空，`HEAD` 仍为 `8f8b2dffd13f235297b7f5a1d8ec9f10331637a5`。

---

## 附一：第一轮摘要（保留）

第一轮（报告冻结于 `a946ed6`，被审代码树 `fd90fef`）结论 **FAIL**：必验范围「实现完整直接协作与产物路线，附件暂存/绑定、隔离预览可实际运行」不成立，新增 14 条 Finding —— **2×P0、5×P1、5×P2、2×P3**；P0/P1 全部阻断，P2 的 W3-06 因影响 AC-002 阻断。要点：下载 token 可预测且下载路由先于认证（W3-01 P0）；产物读取无主体维度（W3-02 P0）；owner 由 sessionId 派生（W3-03 P1）；消息正文未写 blob（W3-04 P1）；未知会话上传 500（W3-05 P1）；失效产物仍可预览（W3-06）；AC-006 未实现（W3-07 P1）；用户消息不建 Authorization（W3-08 P1）；token 只增不减/`prune` 无调用方（W3-09）；归档会话仍接受上传（W3-10）；`expireStale` 无调用方（W3-11）；错误响应无 §1 封装（W3-12）；记录不一致（W3-13）；浏览器级攻防未验（W3-14，承接 WP-10）。另 5 项对抗性（内联预览字节上限、文件签名、`targetWorkId` 归属、隔离只靠客户端头、失败上传孤儿 blob 与 staged 无上限）。

## 附二：第二轮摘要（保留）

第二轮（报告冻结于 `8e4efc1`，被审代码树与 HEAD 同为 `a946ed6`）结论 **FAIL**：主要判据 W3R2-01（AC-006 未实现）与 W3R2-02（AC-005 未实现），另 2×P2（W3R2-03 CSP 漂移、W3R2-04 StorageError 映射/回显）、9×P3（W3R2-05..13）。第二轮对抗性 7 项：1/3/4/5/7 已修，2 部分（语义可辩护），6 已修但无测试守护。六条契约命令全绿但不足以支撑必验范围。

## 附三：第三轮摘要（保留）

第三轮（报告冻结于 `35e8674`，被审代码树 `d71dc07`）结论 **FAIL**：AC-005 的授权机制（`routeMessage`、消息级 Authorization 行、`work.authorizationRef`、Assessment、混合意图多 Work 与独立 scope）全部**落库**且成立，但 `grantedByMessage` 生成 `readPaths:['docs']` + `operations:['edit']` 的自相矛盾授权，使绑定它的 Work 的任何 Run/Assessment 都被 `capabilityGaps:['readPaths without a read operation']` 拒绝——交付路线在准入即死锁（W3R3-01 P1）。新增 **1×P1、5×P2、8×P3**；对抗性另指出疑问句被当作执行消息、HTTP 客户端可自报 `authorization`（甚至 `deploy`）。失败路由 `Blocking Review Finding → Develop → Independent Review`。

| 三轮编号 | 严重度 | 摘要 | 第七轮状态 |
|---|---|---|---|
| W3R3-01 | P1 | 授权 capability 缺口 → 交付死锁 | 已修（probe6 端到端复核仍成立） |
| W3R3-02 | P2 | 授权绑定 `works[0]` | 已修 |
| W3R3-03 | P2 | 授权自相矛盾 | 已修 |
| W3R3-04 | P2 | HTTP 响应不含 `workIds`/`authorizationId` | 响应已含；`protocol.md` 仍未对账（W3R7-06） |
| W3R3-05 | P2 | 同 intent 重复共享 scope | 已修（W3R7-05 为新形态副作用） |
| W3R3-06 | P2 | CSP 与 `execution.md` §6 漂移 | 已修且逐字相等 |
| W3R3-07 | P2 | StorageError 映射过宽 + 回显 | 回显已修；映射细分仍缺（W3R7-06） |
| W3R3-08/09/10/11/12/13/14 | P3 | validity/归属/owner 派生/prune/证据/数字/协议项 | 部分未闭合（W3R7-06） |

## 附四：第四轮摘要（保留）

第四轮（报告冻结于 `fd0a893`，被审代码树 `3f52fbf`）结论 **PASS（0×P1、3×P2、11×P3）**，但同轮对抗性核验以 HTTP 端到端证伪「越权已闭合」：`explain why … needs a fix`、`don't fix …`、`不要修改 …`、`I am not asking you to fix …` 等仍生成写授权并可派发写 Run；另指出 `targetWorkId` 可改写已有 Work 的 level/authorizationRef、`Content-Security-Policy-Sandbox` 不是标准头、消息授权 L1 与 `routingFloor` 的 L2 不一致、`workItems:[null]`/`intent:'operation'` 造成 500 或非法 Work。

| 四轮编号 | 严重度 | 摘要 | 第七轮状态 |
|---|---|---|---|
| W3R4-01 | P2 | 同 intent 多 Work 共用 scope | 已修（第六轮空 scope、本轮 W3R7-05 为回落副作用） |
| W3R4-02 | P2 | `workItems` 把授权挂到只读 Work | 已修 |
| W3R4-03 | P2 | `assertGrantWithinMessage` 不约束 `readPaths` | **已修**（probe3） |
| W3R4-04 | P3 | `workItems` 未校验 → 500 | 已修 |
| W3R4-05 | P3 | 无 Orchestrator 授权回归用例 | 未修（W3R7-06） |
| W3R4-06 | P3 | `protocol.md` 未对账 | 未修（W3R7-06） |
| W3R4-07 | P3 | `message.received` 缺 `workIds`/`authorizationId` | 已修 |
| W3R4-08 | P3 | `StorageError` 映射粗 | 未修（W3R7-06） |
| W3R4-09 | P3 | 记录数字不符 | 未修（W3R7-06） |
| W3R4-10 | P3 | `targetWorkId` 归属只覆盖 message 来源 | 未修（W3R7-06） |
| W3R4-11 | P3 | 失败发送孤儿 blob | 未修（W3R7-06） |
| W3R4-12 | P3 | multipart 多文件 / `projectId` | 未修（W3R7-06） |
| W3R4-13 | P3 | 错误响应非 §1 封装 | 未修（W3R7-06） |
| W3R4-14 | P3 | 冻结点与任务不一致 | 第七轮一致（`HEAD=8f8b2df`） |

## 附五：第五轮摘要（保留）

第五轮（报告冻结于 `fd0a893`，被审代码树 `3f52fbf`）结论 **FAIL（0×P0、2×P1、2×P2、5×P3）**：

- **W3R5-01 [P1]** 非执行消息（中英文疑问、否定、陈述、名词化解释）仍产生可用写授权并可派发写 Run（17 个新句式，HTTP 端到端验证）。
- **W3R5-02 [P1]** 明确指令被判为拒绝/解释：裸单字 `别` 命中「错别字/识别/特别/分别」、`说明/介绍` 名词化被当解释、`、` 不参与分词、逗号列表只授权首项（7 例误拒）。
- **W3R5-03 [P2]** 无效 `Content-Security-Policy-Sandbox` 头仍在 wire 上，修复记录与提交信息不实（第七轮已订正并实测单头）。
- **W3R5-04 [P2]** 调用方 `authorization.readPaths` 不受消息范围约束（latent；第七轮已修）。
- **W3R5-05..09 [P3]** `targetWorkId` 归属、孤儿正文 blob、记录数字、前轮剩余项、冻结点漂移。
- 同轮确认已修：`pathsIn` 线性化、`targetWorkId` 不改写目标 Work、消息授权 L2 与 `routingFloor` 一致、`workItems` 逐项校验。

第五轮 §6.1 的 17 句越权语料与 §6.2 的 11 句误拒语料，**第七轮以 `8f8b2df` 复跑仍分别有 7 句、1 句不成立**（见本报告 §4.2/§6.3，W3R7-02/W3R7-03）。

## 附六：第六轮摘要（报告缺档）

第六轮 Reviewer **未产出报告**（报告文件为空，`HEAD=7c01c9d` 时无 Review 结果入库）。同轮对抗性核验以 `7c01c9d` 为冻结点独立复现，确认第五轮点名的误拒/CSP/`readPaths` 三组已闭合，但补出：陈述/完成体与认识情态（`我已经修改了 X`、`刚修复了 X`、`I already fixed X`、`X 需要修改`、`是否应该修改 X`、`是否需要更新 X`、`麻烦评估一下 X 是否需要修改`）仍产生可派发写授权；`docs/INDEX.md 的错别字麻烦处理下` 等日常祈使句不授权；`workItems` 第二个同 intent 项 scope 为空；记录中「永不下发写授权」措辞不实；另补 `workItems` 无数量上限、`别改 A，改 docs/plan.md` 误拒、CSP 第二头名残留、`assertGrantWithinMessage` 未约束 `readPaths`。

开发方以 `848b5c4` 修复（新增 `STATEMENT_PATTERNS`、`REQUEST_ACTION_PATTERN`、`workItems` scope 回落、回归网扩充），并以 `8f8b2df` 在 `plan.md` 声明 planVersion 2 的判定边界。第七轮对上述各项的逐条复核见本报告 §1/§3：**登记句式已修好；同类变体仍越权（含 `\b` 正则缺陷）；`REQUEST_ACTION_PATTERN` 引入只读请求授权的新 P1 回归；`别改 A，改 B` 仍误拒；边界声明与实现/记录不一致。**
