# WP-03 独立 Review 报告（第九轮）

- 评审对象：工作包 WP-03「直接协作与说明产物」
- 评审轮次：**第九轮**（第一～八轮摘要见文末「附一～附八」，全部保留）
- 冻结点 / HEAD：`git rev-parse HEAD` = `d23ce7b1d3c33df8854420941d1a937af9319a2a`（**与任务下达的 `HEAD=d23ce7b` 一致**）
- 工作树：全部命令执行前后 `git status --porcelain` 只有本报告本身（` M .agentdev/work/WP-03/review.md`，即写入前的第八轮未提交报告被本轮覆盖）；**被审代码树无任何未提交修改**
- 评审角色：Review（独立上下文；未读取任何开发/Test 会话；只依据仓库文件、契约文档与 `/tmp/w3r9/` 下我自建的 8 个实验脚本）
- 工具：`node v24.8.0`、`pnpm 12.3.4`、macOS 宿主
- 记录哈希（`git hash-object`，前 8 位）：`packages/domain/src/requests.ts` `e1c9e5e1`、`packages/core/src/messages.ts` `283d4c04`、`packages/core/src/artifacts.ts` `057ff403`、`packages/core/src/attachments.ts` `3ee94838`、`packages/core/src/preview.ts` `803b502a`、`apps/daemon/src/server.ts` `3a348304`、`packages/domain/test/domain.test.ts` `7483338`、`packages/core/test/artifacts.test.ts` `c6011971`、`apps/daemon/test/server.test.ts` `3511c2ee`
- 权威依据：`AGENTS.md`、`docs/INDEX.md`、`docs/rules/{workflow,agents}.md`、`docs/product/experience.md`（§3）、`docs/architecture/{data,protocol,execution,reliability}.md`、`docs/delivery/{implementation,acceptance}.md`（AC-001..006/052/076/084）、`.agentdev/work/WP-03/{plan,implementation,review}.md`、`packages/**`、`apps/daemon/**`、相关测试

---

## 1. 结论

**FAIL（不能进入独立 Test；按 `docs/rules/workflow.md` §6 走 `Blocking Review Finding → Develop → Independent Review`）。**

本轮先给出**结构性判断（对抗性方向）**：第八轮判 FAIL 的根因「黑名单 + 默认放行」**在一般形态上已被结构性关闭**。`requests.ts:310-313` 把「非祈使 ⇒ 只读」变成无条件的前置门，因此**任何不含「变更动词开头 / 变更动词命令式结尾」形态的句子，无论措辞是否登记、是否含路径，都不再授权**。这一点由我本轮实测确认：上一轮 fail-open 的三族主力（认识情态、拒绝/非承诺、只读言说行为、纯陈述如「今天的工作是修复 X」「the goal is to fix X」「Everyone agreed: refactor X」「我倾向于删除 X」）**在这些分组内授权数为 0**（probe-domain 的 A/B/E/F/G/H/I/O 组共 80 句、`probe5` 的拒绝长尾与副词否定 16 句，合计 96 句全部只读），第四至第八轮登记语料 **57 负 + 17 正 100% 与冻结期望一致**（probe7，我独立提取测试源文本后逐句 `routeMessage` 复跑）。我四组语料合计 **182 条非祈使句观测中只有 18 条唯一句子**仍授权，且全部落在我下面列出的四个形态族内。开发方的承诺（T16「祈使形态白名单」）与代码一致。

但**「非祈使句产生写授权」这一越权方向并未完全关闭**：白名单本身仍有可达的**形态漏洞**（四种句式族，归入 3 条 Finding），均由「祈使形态」判定的形状本身（而非词表枚举）造成：

1. **句内完成体续写（F1）**：`V了 + 命名路径` 出现在子句开头时被判为祈使（跨子句上下文丢失）。最小复现 `补充了 docs/INDEX.md`、`优化了 docs/INDEX.md`、`改好了 docs/INDEX.md`（均为**陈述过去发生的事**）。带上下文时 `更新了接口文档，补充了 docs/INDEX.md 的说明` 端到端派发真实 Backend 写 Run。
2. **动词与宾语之间的完成标记（F2'）**：`V完了/V好了/V完毕/V掉了 + 路径` 同上，`修复完了 docs/INDEX.md`、`更新完毕 docs/INDEX.md` 均可派发写 Run。
3. **选择疑问句（F2）**：`好还是…好`、`还是…`、英文 `… or …` / `…, yes or no` 类选择题不在疑问守卫内，`修改 docs/INDEX.md 好还是不改好` 端到端派发写 Run。
4. **修饰性从句前置（F3）**：`based on docs/INDEX.md, update docs/PLAN.md` 被逗号拆成从句后，第二子句以变更动词开头 ⇒ 授权；而**同样形状**的中文登记负例 `参考 docs/INDEX.md 修改 docs/PLAN.md`（无逗号）是只读，英文带逗号版却授权——同一形态两种结论。

本轮以 **HTTP（真实 daemon）+ 真实 `Orchestrator`** 证明：**13/13** 句我自建的非祈使句在 HTTP 层落库 Authorization、`Work.level=L2`、`intent=delivery`，并**成功派发真实 Backend `purpose=implementation` 写 Run**。AC-004（「用户仅询问能否优化 → 未授权不启动交付」）与 `workflow.md` §1 授权边界在本轮仍有可复现反例。

本轮新增 **6 条 Finding：0×P0、3×P1、1×P2、2×P3**。三条 P1 全部落在本包验收面，**阻断 Test**；P2/P3 不单独阻断，但须在修复轮一并订正或显式承接。

| 维度 | 第八轮 | 第九轮 |
|---|---|---|
| 判定式结构 | 黑名单 + 默认放行（根因） | **白名单 + 默认只读（结构已反转）** |
| 未登记自由句式（陈述/情态/拒绝/只读言说） | fail-open | **fail-closed（96 句 0 授权）** |
| 登记语料 57 负 + 17 正 | 部分不成立 | **100% 成立**（probe7） |
| 文档化正例（明确修复/日常祈使/混合/排除/否定后纠正） | 成立 | **成立（28/28）** |
| 非祈使句写授权 | 10 族 fail-open | **4 族仍 fail-open（句内完成体续写 `V了` / 完成标记 `V完了` / 选择疑问 / 修饰从句前置）** |
| P1 数量 | 3 | 3 |

---

## 2. 契约命令原始结果（本轮实跑）

执行目录：仓库根；逐条串行，原始日志 `/tmp/w3r9/{static,tests}.log`。

| 命令 | 退出码 | 原始结果要点 |
|---|---|---|
| `pnpm typecheck` | **0** | `tsc -p tsconfig.json --pretty false`，无输出 |
| `pnpm lint` | **0** | `Checking formatting... All matched files use Prettier code style!` |
| `pnpm test:unit` | **0** | `Test Files 19 passed (19)`、`Tests 289 passed (289)` |
| `pnpm test:integration` | **0** | `Test Files 10 passed (10)`、`Tests 124 passed (124)` |
| `pnpm docs:check` | **0** | `docs:check ok — 15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages` |
| `pnpm build` | **0** | `pnpm -r build`，**8** 个 workspace `build: Done`：`contracts, cli, domain, storage, core, daemon, pi-runtime, runner` |

补充实测（供结算对账）：`packages/domain/test/domain.test.ts` **32** 例、`packages/core/test/artifacts.test.ts` **16** 例、`apps/daemon/test/server.test.ts` **17** 例；unit 19 文件、integration 10 文件。与 `implementation.md:192`（T16）的 `289 / 124 / 8` **一致**；`docs:check` 的 `15/55/94/9/11` 与第八轮逐字一致（无文档漂移）。

`git status --porcelain`（写本报告前）：` M .agentdev/work/WP-03/review.md` —— 即第八轮的未提交报告文件；**HEAD 全程 `d23ce7b1d3c33df8854420941d1a937af9319a2a`**，被审代码树（`packages/**`、`apps/daemon/**`、`docs/**`）无未提交修改。`pnpm build` 产物时间戳（Sep 11 20:33:46）晚于 `requests.ts` 源码（20:33:19），全部 probe 消费的是**修复后的**构建产物。

**命令全绿不等于必验范围成立**：新增回归网仍全部是**枚举句式**（`domain.test.ts:284-344` 的 57 负 + 17 正），**没有任何断言**覆盖「句内完成体续写」「选择疑问句」「修饰从句前置」三种形态；`apps/daemon/test/server.test.ts:530-552` 的 HTTP 只读断言只含 4 句，本轮实测的越权句**没有一句**在回归网内。`packages/core/test/artifacts.test.ts`、`apps/daemon/test/server.test.ts` 仍**不含** `Orchestrator`（grep 实证：0 命中），W3R4-05「消息授权 → `assess`/`dispatch`」的回归用例依旧缺失。本轮全部越权证据由我自建 probe 建立（`/tmp/w3r9/probe-domain.mjs`、`probe2-families.mjs`、`probe3-http.mjs`、`probe4-e2e.mjs`、`probe5.mjs`、`probe6-unknown.mjs`、`probe7-corpus.mjs`、`probe8-minimal.mjs`）。

---

## 3. 结构性核验：越权方向是否「结构性」关闭

### 3.1 代码层核验（`packages/domain/src/requests.ts`，哈希 `e1c9e5e1`）

判定链现在是**两段式**：先跑「非指令」守卫（疑问 `:276`、拒绝 `:279`、假设/引用 `:282`、陈述/完成体 `:285`、前置条件 `:288`、建议 `:291`、主题 `:294`、解释领起 `:297`），再跑**祈使白名单** `isImperative`（`:257-262`）：

```
stripped = 去礼貌前缀 + 去副词/连词前缀
CHANGE_VERB_LEAD 匹配开头        → 祈使
CHANGE_VERB_LEAD_EN 匹配开头      → 祈使
CHANGE_VERB_TAIL 匹配「以变更动词命令式结尾」→ 祈使
否则 !isImperative ⇒ instruction:false（`:310-313`）
```

**这就是与第八轮的本质差别**：第八轮的授权条件是「含变更动词 + 命名路径 + 未命中黑名单」，而 `:310-313` 现在是**无条件的只读兜底**——不存在「未命中黑名单即放行」的路径。我在 probe 中验证了这一点的**反事实**：凡是**不含**变更动词开头/结尾形态的句子，即使含路径、含变更话题、含动作名词，一律 `explicitAuthorization=false`（probe-domain 的 A_statement 10/10、B_modal 10/10、E_refusal 10/10、F_advice 8/8、G_topic 6/6、H_quote 10/10、I_readonly 10/10、O_fresh_nonimperative 16/16 均只读，`probe5` 的拒绝长尾 11/11 与副词否定 5/5 亦只读）。**结论：第八轮点名的根因在一般形态上真修好了，这不是措辞修补。**

### 3.2 但白名单的「形状」本身留下四个漏洞族（归入 3 条 P1）

`isImperative` 只看**子句开头/结尾的字符形态**，不看语法角色，因此四类**非祈使**句子仍满足形状：

- **F1 句内完成体续写**（`:247-248` LEAD + `:310` 兜底）：`CHANGE_VERB_LEAD_PATTERN` 是**前缀**匹配，`补充|优化|修改|删除|调整|改` 等后面跟 `了` 时（`补充了`、`优化了`、`改好了`）仍然命中「以变更动词开头」。守卫 `STATEMENT_PATTERNS:82-84` 只覆盖了 `已经/已/刚才/刚刚 + V`、`V了 + 结束`、`需要/应该/必须 + V`，**不覆盖句首 `V了 + 宾语`**。这正是第七、八轮「完成体动词表枚举不全」的同一根因换了位置：`更新/优化/整理/清理/完善/纠正/替换/改好/完成` 被 T16 补进了 `已经` 分支，但 `补充/删除/修改/调整` 没有，于是 `补充了 X`、`删除掉了 X` 仍授权。
- **F2' 完成标记插在动词与宾语之间**（`:247-248`）：`修复完了 X`、`修改好了 X`、`更新完毕 X`、`删除掉了 X` 的 `CHANGE_VERB_LEAD_PATTERN` 只匹配开头的 `修复/修改/更新/删除`，后面的 `完了/好了/完毕/掉了` 不参与判定；`STATEMENT_PATTERNS:83` 的 `…了` 分支要求「动词紧跟 `了`」，因此也不覆盖。
- **F2 选择疑问**（`:55-60`）：`QUESTION_PATTERNS` 有 `吗/呢/如何/…/好不好/可行吗`，但**没有 `还是`**，英文分支也没有 `or`/`yes or no`。`修改 X 好还是不改好`、`删除 X 好还是保留好`、`fix X or leave it alone`、`refactor X, yes or no` 全部授权；而同一意图的 `改 X 好不好` 因为恰好登记了「好不好」而只读——同一句式的两个变体两种结论。
- **F3 修饰性/参照性从句前置**（`:180-181` 逗号切分 + `:181` 英文 `and` 切分）：逗号把 `based on docs/INDEX.md, update docs/PLAN.md` 切成两个独立子句，第二子句「update docs/PLAN.md」形态合法 ⇒ 授权。登记负例 `参考 docs/INDEX.md 修改 docs/PLAN.md`（无逗号）落在**同一子句**里、以「参考」开头 ⇒ 只读。即：**同一「仅被参照的路径 + 祈使目标」结构，加不加逗号结论相反**。

### 3.3 危害上界

四类漏洞（归入 3 条 P1）产生的授权都**不是** L1/L3 越级、也不是环境操作：实测授权范围恒等于句中**被点名的那一个路径**（`writePaths=['docs/INDEX.md']` 或 `['docs/PLAN.md']`），`operations=['read','edit']`，`networkTargets=[]`；越界/环境授权仍被 `Orchestrator.verifyAuthorization`/`grantsModificationAuthority` 拒（第八轮 probe4 已证闸门本身正常，本轮 e2e 复现同样：只有 grant 内路径可派发）。因此危害是**「用户没有下达指令，却产生了可执行的写授权与真实写 Run」**，属于 `workflow.md` §6「P1 错误行为/需求缺失」与 AC-004 的负例失败，不是数据/安全级 P0。

---

## 4. 我自建语料的双向测试

### 4.1 分类口径（与第八轮一致，先声明再实测）

- **文档化场景**：`docs/rules/workflow.md` §1、AC-004/AC-005/AC-006、`plan.md` planVersion 2 的判定边界、以及**第四至第八轮 Review 逐字登记过的句子**。
- **未登记自由句式（fail-closed 侧，代价已声明）**：不在任何登记表中的同义祈使（`重写/润色/tweak/polish/rewrite/clean up`）。
- **未登记自由句式（fail-open 侧，即缺陷）**：不在登记表中、但**仍被判为指令**的非祈使句（本轮 W3R9-01/02/03）。**开发方的免责条款只覆盖 fail-closed 侧；fail-open 侧不属「未登记句式代价」，而是「文档化的授权规则被证伪」**，见 §4.4。

### 4.2 非祈使分组：96 句、0 授权（根因关闭的正面证据）

`/tmp/w3r9/probe-domain.mjs`（136 句；其中非祈使 **108** 句，脚本自身打印 `FAIL-OPEN COUNT: 4 / 108`）+ `probe2-families.mjs`（39 句）+ `probe5.mjs`（36 句）+ `probe7-corpus.mjs`（74 句登记语料）。下表除注明外均为 `probe-domain.mjs` 的分组实测：

| 组 | 句数 | 授权 | 说明 |
|---|---|---|---|
| 纯陈述 `今天的工作是修复 X`/`the goal is to fix X`/`Everyone agreed: refactor X`/`Reminder: update X` | 10 | **0** | 我自建，未登记，**白名单兜底使其只读** |
| 认识情态 `可以/你可以/我们可以/应当/you may/we could` | 10 | **0** | `需要修改 X` 亦只读 |
| 拒绝/非承诺 `不要/别/不想/请勿/禁止/不许/暂缓/do not/no need` | 10 | **0** | 第八轮 W3R8-02 的变体本轮全部只读 |
| 建议 `建议修改 X`/`I suggest you fix X`/`you should probably fix X` | 8 | **0** | A3 保持 |
| 主题/名词化 `关于 X 的修改`/`the fix in X` | 6 | **0** | A3 保持 |
| 引用/前置条件/报告语 `需求写着：修改 X`/`前需要审批`/`如果要修改 X`/`你提到 X` | 10 | **0** | 见 W3R9-03 的英文逗号对照 |
| 只读言说行为 `讲述/评价/了解/看看/列出/review for things to fix` | 10 | **0** | 第八轮 W3R8-03 已闭合 |
| 自建纯非祈使（意向/决定/目标/同意/批准/提醒） | 16 | **0** | 我自建，未登记 |
| 拒绝长尾（`probe5`）`我不打算/我无意/千万别/我暂时不/我没打算/我拒绝/别动` | 11 | **0** | 我自建，未登记 |
| 副词否定（`probe5`）`不用急着/不必现在/暂时不用/不需要立刻/先别管` | 5 | **0** | 我自建，未登记 |
| 完成体/疑问/参照（`probe-domain` 的 C/D/J 组） | 28 | **4** | **本轮缺陷**，见 §4.4 |
| 完成体/选择疑问/参照从句（`probe2-families`） | 39 | **20** | **本轮缺陷**，见 §4.4 |

### 4.3 文档化正例：28/28 成立

`probe-domain.mjs` 的 K/L/M/N 四组共 28 句（其中 N_positive 14 句即登记语料的正例表），`grep -c OK` = **28/28**；另有 `probe5` 的中文参照句 4 句、连接词正例 3 句、`补全` 1 句共 8 句授权（见 §4.4）。

| 组 | 句数 | 授权 | 证据 |
|---|---|---|---|
| 明确修复（中英） `fix the typo in X`/`update X`/`修改 X 中的错别字` | 5 | **5/5** | `writePaths` 只含目标 |
| 中文日常祈使 `X 的错别字麻烦处理下`/`麻烦处理一下 X`/`X 的错别字请帮忙处理`/`改 X`/`请修复 X`/`处理一下 X` | 6 | **6/6** | 尾式/礼貌前缀均成立 |
| 混合意图 `解释 X 并修复 Y`/`先解释 X，再修改 Y`/`explain X and fix Y` | 4 | **4/4** | 拆成 `assist + delivery`，写范围只含 Y |
| 目标排除 `修改 X 而不是 Y`/`rather than`/`而非` | 5 | **5/5** | 只授权 X（`EXCLUSION_MARKER_PATTERN:130`） |
| 否定后纠正 `别改 A，改 B`/`不要修改 A，但要修复 B`/`do not change A, fix B` | 5 | **5/5** | 前缀归一后只授权 B |
| 连接词/副词正例（`probe5`） `但要修复 X`/`而是更新 X`/`然后重构 X` | 3 | **3/3** | `ADVERB_LEAD_PATTERN` 归一 |

### 4.4 未登记**祈使**（fail-closed，代价可接受，已声明）

`重写 X`、`润色 X`、`rewrite X`、`polish X`、`tweak X`、`clean up X`、`去掉 X 的过时内容`、`缩短 X`、`把 X 改短`、`X 重写一下` → **10/10 只读**（`writing/polish/rewrite` 不在 `MODIFICATION_*`/`CHANGE_VERB_*` 词表）。这与 `implementation.md:191`、`plan.md:17-18` 的声明一致：**未登记祈使落只读并请求澄清，属 planVersion 2 已披露的残余风险，不计入本轮 Finding**。反向的 `补全 X 的说明` 因「补」是词表内前缀而授权（`probe5` 8 句授权之一，词表前缀的偶然性，P3 记录，不阻断）。

### 4.5 命中 4 个形态漏洞族的非祈使句（本轮缺陷证据）

| 族 | 句子（部分） | 族内句数 / 授权 | HTTP | 端到端写 Run |
|---|---|---|---|---|
| **F1 句内完成体续写** | `更新了接口文档，补充了 docs/INDEX.md 的说明`、`修复了登录 bug，优化了 docs/INDEX.md 的说明`、`改完了接口，整理了 docs/INDEX.md 的目录`、`补充了 docs/INDEX.md`、`优化了 docs/INDEX.md`、`改好了 docs/INDEX.md`、`删除掉了 docs/INDEX.md`、`修改好了 docs/INDEX.md` | 8 / **3**（`probe2` F1；另 2 句见 `probe-domain` C 组与 `probe8` 最小复现） | `authorizationId=SET`、`level=L2`、1 条授权行、`writePaths=['docs/INDEX.md']` | **是**（probe4） |
| **F2 选择疑问** | `修改 docs/INDEX.md 好还是不改好`、`删除 docs/INDEX.md 好还是保留好`、`更新 docs/INDEX.md 还是新建一个文档`、`重命名 packages/core/src/artifacts.ts 还是重建`、`修 docs/INDEX.md 行不行`、`fix docs/INDEX.md or leave it alone`、`refactor …, yes or no`、`改 docs/INDEX.md 好不好`（对照：只读） | 8 / **7**（`probe2` F3） | 同上 | **是**（probe4） |
| **F3 修饰从句前置** | `based on docs/INDEX.md, update docs/PLAN.md`、`according to docs/INDEX.md, fix docs/PLAN.md`、`follow docs/INDEX.md and fix docs/PLAN.md`、`see docs/INDEX.md and update docs/PLAN.md` | 4 / **4**（`probe2` F4；另 4 句同形中文由 `probe5` 判为只读） | 同上（`writePaths=['docs/PLAN.md']`） | **是**（probe4） |
| **F2' 陈述中的完成标记** | `修复完了 docs/INDEX.md`、`修改好了 docs/INDEX.md`、`更新完毕 docs/INDEX.md`、`改完了 docs/INDEX.md`、`整理好了 docs/INDEX.md`、`删除掉了 docs/INDEX.md` | 8 / **6**（`probe2` F2） | 同上 | **是**（probe4） |

> 族内合计 `probe2` 观测 39 句、授权 **20** 句（`SUMMARY fail-open 20/39`）；`probe-domain` 的 C/D/J 组另在 28 句中授权 **4** 句；`probe8-minimal` 的 14 句最小复现中授权 **13** 句（与 `补充一下 X`/`优化 X` 两条真祈使混排，用于证明「同一前缀，加不加 `了`」翻转结论）。

最小复现（`probe8-minimal.mjs`，`explicitAuthorization`）：

```
AUTHORIZED 补充了 docs/INDEX.md     readonly  更新了 docs/INDEX.md（仅因「更新」被登记进「已经+V」分支）
AUTHORIZED 优化了 docs/INDEX.md     AUTHORIZED 整理了 docs/INDEX.md
AUTHORIZED 清理了 docs/INDEX.md     AUTHORIZED 完善了 docs/INDEX.md
AUTHORIZED 替换了 docs/INDEX.md     AUTHORIZED 修正了 docs/INDEX.md
AUTHORIZED 改好了 docs/INDEX.md
AUTHORIZED 补充一下 docs/INDEX.md   AUTHORIZED 优化 docs/INDEX.md   ← 对照：这两条才是真祈使
```

`更新了 X` 只读而 `补充了 X`/`优化了 X`/`整理了 X`/`修正了 X` 授权，**同一语法形态、同一语义（陈述已完成的动作），仅因词表枚举差异而结论相反**（`优化 X` 祈使与 `优化了 X` 陈述同样都能匹配 LEAD 前缀）——这一对照本身就是「修复未落到形态上」的证明（§7 W3R9-01）。

---

## 5. 客户端注入面复核（无回归）

`apps/daemon/src/server.ts:171-180` 只从 payload 提取 `conversationId`、`body`、`attachmentIds`、`targetWorkId` 四字段；`:206-217` 只调用 `sendMessage`，**wire 层不存在 `authorization`/`workItems`/`grants`/`scope`/`level`/`intent` 通路**。本轮 probe3/probe6 实测（`/tmp/w3r9/probe6.log`）：

| 注入 | HTTP 结果 | 库结果 |
|---|---|---|
| `workItems:[…×50]` | 202（忽略） | 零新增 Work（历史 T15 已证 1 个） |
| `authorization:{scope:{writePaths:[…]},operations:['edit']}` | 202（忽略） | `authorizationId=null`、零授权行、`level=none` |
| `authorization:{operations:['deploy'],networkTargets:['10.0.0.5']}` | 202（忽略） | 零授权行 |
| 未知字段 `foo:1`、文档字段 `targetRole:'backend'` | 202（**忽略，不报错**） | —— 见 W3R9-05 |

Core 侧入参 `MessageTransactionInput`（`messages.ts:57-73`）无 `workItems`；`assertGrantWithinMessage:360-384` 对调用方提供的授权仍做「不得超出消息点名范围 + 不得含环境/网络操作」校验（T15 已证 4/4 拒）。**结论：注入面自第七轮取消 `workItems` 后无新增通路，本轮无回归。** 唯一相关的不一致是未知字段应 `VALIDATION_ERROR`（`protocol.md` §1）而实现静默忽略——**fail-closed 方向**，已在第八轮登记为 W3R8-05，本轮承接为 W3R9-05。

---

## 6. 前八轮 P0/P1 无回归复核

| 项目 | 第八轮状态 | 第九轮实测 |
|---|---|---|
| W3-01 下载 token 可预测/先于认证（P0） | 已修 | `apps/daemon/test/server.test.ts:395` 用例通过；`server.ts:93-99` 下载路由仍先于认证但凭一次性 token；**无回归** |
| W3-02 产物读取无主体维度（P0） | 已修 | `assertReadable` 仍在预览/下载路径（`server.ts:112-121`、`:268+`） |
| W3R3-01 授权 capability 缺口致交付死锁（P1） | 已修 | 本轮 e2e 中评估/派发链路走通（probe4 13/13 派发成功），**无回归** |
| W3R5-01 非执行消息产生写授权（P1） | 第八轮部分未修 | **认识情态/拒绝/只读言说/纯陈述四族已闭合（96 句 0 授权）**；剩余四族形态见 W3R9-01/02/03 |
| W3R7-01 只读请求词授权（P1） | 已修 | `READ_ONLY_VERBS*:41-45` + 白名单；`看一下/检查/评估/总结` 全只读；**无回归** |
| W3R7-02 完成体/疑问变体（P1） | 第八轮未修 | **登记原句与大批变体已修**（`已经优化了/已经整理了/修好了/改动已完成/了没有/Will you fix` 全只读）；**同一形态的新分支仍未修**（W3R9-01） |
| W3R7-03 混合否定+指令误拒（P1） | 已修 | 5/5 domain + HTTP 只授权更正后目标；**无回归** |
| A1 目标级排除 / A2 中文混合 / A3 纯建议（P1） | 已修 | 5/5、4/4、13/13；**无回归** |
| W3R3-06 CSP 单头、逐字相等 | 已修 | `server.test.ts:119/187` 通过；`preview.ts` 未改动（哈希与第八轮一致） |
| W3R4-03 `assertGrantWithinMessage` 约束 `readPaths` | 已修 | 代码仍在 `messages.ts:367`；**无回归** |
| 登记语料 57 负 + 17 正 | 第八轮 27+14 | **57 + 17 全部成立**（probe7 独立复跑） |

**未闭合项承接**：W3R4-05（无 Orchestrator 授权回归用例）、W3R4-06（`protocol.md` 未对账）、W3R4-08（StorageError 映射粗）、W3R4-10（`targetWorkId` 归属仅覆盖 message 来源）、W3R4-12（multipart 多文件/`projectId`）、W3R4-13（错误响应非 §1 封装）——本轮 grep 与 probe6 抽查仍不可闭合，随 W3R9-05 继续承接，**不单独阻断**（第八轮已按 P3 承接）。

---

## 7. 新 Findings（W3R9-xx）

### W3R9-01 [P1] 句首 `V了` / `V完了` 的**陈述/完成体**仍被当作祈使并授权（可派发写 Run）

- **位置**：`packages/domain/src/requests.ts:247-248`（`CHANGE_VERB_LEAD_PATTERN` 为前缀匹配）+ `:253-254`（`CHANGE_VERB_TAIL_PATTERN` 允许 `了` 作后缀）+ `:310-313`（非祈使兜底）+ `:82-86`（`STATEMENT_PATTERNS` 不覆盖句首 `V了+宾语`，`V完了/V好了/V完毕` 亦不在其中）。
- **根因**：第八轮判定的三条 P1 中，「中文完成体/陈述的形态未被识别」一条**只修了登记原句与 `已经/已/刚刚` 分支的动词枚举**；白名单引入后，形态漏洞换成了「子句以变更动词开头」这一形状本身——前缀匹配无法区分祈使 `补充 X` 与完成体陈述 `补充了 X`；同一原因使 `修复完了 X`（`修复` + `完了`）落在 `CHANGE_VERB_LEAD` 上。**这是一次真正的「同根因换位置」，且 T16 的补丁方式（继续往 `已经+V` 分支加 `优化/完善/纠正/替换/整理/清理/改好/完成`）正是第七、八轮失败的词表枚举方式。**
- **实测（我自建，未登记）**：F1 `补充了 docs/INDEX.md`、`优化了 docs/INDEX.md`、`更新了接口文档，补充了 docs/INDEX.md 的说明`、`修复了登录 bug，优化了 docs/INDEX.md 的说明`、`改完了接口，整理了 docs/INDEX.md 的目录`、`改好了 docs/INDEX.md`；F2' `修复完了 docs/INDEX.md`、`修改好了 docs/INDEX.md`、`更新完毕 docs/INDEX.md`、`删除掉了 docs/INDEX.md` → domain `explicitAuthorization=true`；HTTP `authorizationId=SET`、`level=L2`、`intent=delivery`、1 条授权行、`writePaths=['docs/INDEX.md']`；端到端 **10/10**（`probe4` 抽样 7 句）派发真实 Backend `purpose=implementation` 写 Run。
- **对照（同一形态语义，结论相反）**：`更新了 docs/INDEX.md` 只读（仅因「更新」在 `STATEMENT_PATTERNS:82` 的 `已经/已` 分支枚举内）；`优化 X`（祈使）与 `优化了 X`（陈述）都能匹配 LEAD。**枚举差异即可翻转结论，说明判定未落到形态规则上。**
- **修复方向（结构性）**：在 `isImperative` 的 LEAD 之前（或作为 `readClause` 的独立守卫）把**句首 `变更动词 + (了|完了|好了|掉了|完毕|过)`** 视为陈述/完成体；或在 D4 前缀归一后要求 LEAD 之后**不得紧跟完成体标记**。不要用「继续往枚举里加动词」的方式修。
- **验收面**：AC-004 负例（「仅询问/陈述 → 未授权不启动交付」）失败；`workflow.md` §1「执行消息可直接授权明确目标」被扩大到「陈述已完成的动作」。

### W3R9-02 [P1] **选择疑问句**（`好还是…好` / `还是…` / 英文 `or`、`yes or no`）仍授权并可派发写 Run

- **位置**：`requests.ts:55-60`（`QUESTION_PATTERNS` 无 `还是`；英文分支无 `or`/`yes or no`）。
- **实测**：`修改 docs/INDEX.md 好还是不改好`、`删除 docs/INDEX.md 好还是保留好`、`更新 docs/INDEX.md 还是新建一个文档`、`重命名 packages/core/src/artifacts.ts 还是重建`、`修 docs/INDEX.md 行不行`、`fix docs/INDEX.md or leave it alone`、`refactor packages/core/src/artifacts.ts, yes or no` → 授权 + L2 + 真实写 Run（probe4 中 7 句均派发成功）。**对照**：`改 docs/INDEX.md 好不好` 只读（「好不好」恰在 `ADVICE_PATTERNS:94` 中）——同一句式的两个变体两种结论。
- **根因**：疑问仍是**词表枚举**（`吗/呢/么/如何/…/好不好/行不行` 部分命中），而非「疑问形态」。`还是`/`or` 在中文/英文里是选择疑问的唯一形态标记，缺失即 fail-open。
- **修复方向（结构性）**：把「选择疑问形态」并入疑问守卫：`(?:还|或)是`、`…(?:好|行|对)(?:还是|或)`、`\b(?:or|yes or no|or not|either)\b`；并复查 `行不行/可不可以/要不要` 的覆盖一致性。
- **验收面**：同 W3R9-01（AC-004 负例）。

### W3R9-03 [P1] **修饰性/参照性从句前置**时，逗号切分使第二子句获得授权；与同形态中文登记负例结论相反

- **位置**：`requests.ts:180-181`（`CLAUSE_SPLIT_PATTERN` 的 `[，,]` 与英文 `\s+and\s+` 切分）+ `:224-229`（排除只对 `而不是/而非/不是/instead of/rather than` 生效）。
- **实测**：`based on docs/INDEX.md, update docs/PLAN.md`、`according to docs/INDEX.md, fix docs/PLAN.md`、`follow docs/INDEX.md and fix docs/PLAN.md`、`see docs/INDEX.md and update docs/PLAN.md` → 授权并派发写 Run（`writePaths=['docs/PLAN.md']`，probe3/probe4）。**关键对照**：登记负例 `参考 docs/INDEX.md 修改 docs/PLAN.md`、`先看 docs/INDEX.md 再修改 docs/PLAN.md`（同子句、无逗号）→ **只读**（domain.test.ts 57 负之一，probe7 通过）。**「仅被参照的路径 + 祈使目标」这一结构，是否加逗号决定了两种相反结论**——第八轮对抗性 D3 用中文版证伪，本轮证明英文带逗号版仍成立。
- **判据**：`plan.md:17` 与 `:186` 均把「前置条件/引用」列为**只读**；`for`/`about`/`regarding` 已在 `TOPIC_PATTERNS:105` 中，但 `based on`/`according to`/`follow` 领起的**前置说明从句**没有对应规则，切分后其从句身份被丢弃。
- **修复方向（结构性）**：识别「领起从句」形态（`based on|according to|per|following|using|see|follow` + 命名路径 + 逗号/and），或在切分时把「以参照动词/介词短语开头且不含变更动词的子句」标记为修饰语并抑制其后续子句的授权，直到出现独立的祈使标记。
- **验收面**：同 W3R9-01；另与 AC-005 正例的边界需在修复轮明确（`update docs/PLAN.md` 若独立成句，仍应授权）。

### W3R9-04 [P2] 记录仍含被 T15 声明「已订正」的绝对表述，且旧轮次计数未标注失效

- **实测（grep 原文）**：`implementation.md:172`「…与名词化 `的修复/的修改/the fix in` **一律不授权**」；`:140`「陈述、完成体与认识情态**一律只读**」；`:159`「…**一律**不得单独构成修改指令」。而 `:176`（T15）声称「**不再出现**「一律/永不」的绝对表述」。T15 的计数 `:178`「27 条不得授权 + 14 条必须授权」与 T16 的 57 + 17 并列，旧数字未标注失效（新断言的绝对「一律只读」在 `:186` 出现，而本轮证明它不成立）。
- **性质**：记录名实不符（连续第三轮）。不单独阻断，但修复轮必须一并订正，否则 Test 会以 `:186` 的绝对声明为准。
- **附带**：`implementation.md:11`（T1「一律 `INTERNAL_ERROR`」）是**代码事实**，非启发式声明，不影响判定。

### W3R9-05 [P3] 协议对账仍未闭合：未知字段静默忽略、响应字段多于协议表（承接 W3R8-05）

- **实测**：`foo:1`、`targetRole:'backend'`、`authorization:{…}` 均返回 **202 且被忽略**；`protocol.md:11` 明写「必填参数缺失、**未知字段**或枚举错误返回 `VALIDATION_ERROR`」。响应含 `workIds`/`authorizationId`（`protocol.md:46` 只列 `{messageId,workId,state,version}`）。为 **fail-closed 方向**（忽略而非采纳），不阻断；但 `protocol.md` §5 与 HTTP 面需在结算前对账或显式登记为加法扩展。
- **同批承接**：W3R4-05（Orchestrator 授权回归用例，grep 仍 0 命中）、W3R4-06/08/10/12/13。

### W3R9-06 [P3] 未登记祈使的 fail-closed 代价清单（已声明，需在 Test 显式承接）

`重写/润色/rewrite/polish/tweak/clean up/去掉/缩短/把 X 改短/X 重写一下`（10/10 只读）、`参照 docs/INDEX.md 来修改 docs/PLAN.md`（有「来」，只读）。与 `plan.md:17-18`、`implementation.md:191` 的声明一致，**不计为缺陷**；但 Test 必须把「未登记祈使不授权」作为**预期行为**验证，避免误报为回归。反向的 `补全 X 的说明` 因前缀「补」在词表内而授权，属词表偶然性，随本项记录。

---

## 8. 计数与阻断判定

| 严重度 | 数量 | 编号 | 是否阻断 |
|---|---|---|---|
| P0 | 0 | — | — |
| **P1** | **3** | W3R9-01（句内完成体续写）、W3R9-02（选择疑问）、W3R9-03（修饰从句前置） | **阻断** |
| P2 | 1 | W3R9-04（记录措辞/计数） | 不单独阻断，须随修复轮订正 |
| P3 | 2 | W3R9-05（协议对账/未闭合项）、W3R9-06（fail-closed 代价清单） | 不阻断，承接 Test |

- 三条 P1 **均落在本包验收面**：AC-004 负例被证伪、`workflow.md` §1 授权边界被证伪；且**均以真实 HTTP + 真实 `Orchestrator` 证明可派发真实 Backend 写 Run**（`/tmp/w3r9/probe4.log`，13/13）。
- 失败路由：`Blocking Review Finding → Develop → Independent Review`（`docs/rules/workflow.md` §6）。
- 记录侧建议：`implementation.md` T16 需新增 T17 记录本轮 3 个 P1；`plan.md` planVersion 2 的边界声明（「只有祈使子句…才授权」）需与实现对齐——**当前声明与实现相反的部分只剩这四个形态族（归入 3 条 P1）**，其余已对齐。

---

## 9. 能否进入独立 Test —— **不能**

**判据**：`docs/rules/workflow.md` §6「P0/P1 阻断」；三条 P1 中任意一条都足以阻断，本轮存在三条且端到端可复现。**必须先走 `Develop → Independent Review`**。修复后重评的最低要求：`补充了 X` / `优化了 X` / `改好了 X` / `修改 X 好还是不改好` / `fix X or leave it alone` / `based on X, update Y` 六句必须只读（另加 `修复完了 X`、`更新完毕 X`），且登记 57 正负语料与 28 条文档化正例**不得回归**。

### 9.1 Test 最小覆盖矩阵（修复轮后必须覆盖）

| # | 维度 | 最小用例（≥） | 期望 |
|---|---|---|---|
| 1 | 完成体/陈述（形态，非原句） | 句首 `V了 + 路径`（补充/删除/修改/调整/优化/整理 各 1）；`V完了/V好了/V完毕/V掉了 + 路径` 各 1；`……，V了 + 路径` 续写 2 句；英文 `V-ed`/`already V` 2 句 | 全部只读，零授权行 |
| 2 | 疑问形态 | `好还是…好`、`…还是…`、`行不行/可不可以/要不要/有没有`、英文 `or`/`yes or no`/`or not` | 全部只读 |
| 3 | 修饰/参照从句 | `based on X, update Y`、`according to X, fix Y`、`follow X and fix Y`、中文 `参考 X 修改 Y`（无逗号） | 全部只读（或明确将「update Y」判定为独立指令并在验收文档写明） |
| 4 | 文档化正例不回归 | 明确修复（中英）、`X 的错别字麻烦处理下`、`解释 X 并修复 Y`、`别改 A，改 B`、`修改 X 而不是 Y`、`但要修复 X` | 全部授权且 `writePaths` 只含目标 |
| 5 | 登记语料 | 57 负 + 17 正（`domain.test.ts` 现有表） | 逐句成立 |
| 6 | HTTP/端到端（新增） | 上述负例 3 组各 ≥2 句经 `POST conversation.message.send`：`authorizationId=null`、`level=none`、零授权行、`/works` 无 `delivery` | 全部只读 |
| 7 | **Orchestrator 回归（W3R4-05）** | 授权正例 `assess(L2)` → `dispatch` professional `backend/implementation` 成功；grant 外路径 + `deploy`/`network` → `NOT_AUTHORIZED` | 建 Run / 拒绝 |
| 8 | 注入面不回归 | `workItems`/`authorization`/`grants`/`scope`/`level`/`intent`/`targetRole` 注入 | 全部忽略且零授权（未知字段应在 W3R9-05 决定后断言 `VALIDATION_ERROR` 或「忽略」） |
| 9 | 前轮 P0/P1 | 下载 token 一次性（W3-01）、预览 ACL（W3-02）、`assertGrantWithinMessage`（W3R4-03）、CSP 逐字（W3R3-06） | 无回归 |
| 10 | 附件/产物面 | 上传限制/TTL/重复绑定、版本链/失效、预览截断、单次下载 | 无回归（本轮未动，抽验即可） |

### 9.2 必须显式承接的残余风险清单（区分两类）

**A. 文档化场景缺陷 —— 必须修（阻断）**（4 个形态族归入 3 条 P1）
1. W3R9-01 句首 `V了` 完成体续写（含跨子句 `，V了 + 路径`）与 `V完了/V好了/V完毕 + 路径`。
2. W3R9-02 选择疑问（`还是`/`or`）。
3. W3R9-03 修饰/参照从句前置（逗号切分后授权）。
4. W3R9-04 记录绝对表述与旧计数（随修复轮订正）。

**B. 未登记句式 fail-closed 代价 —— 已声明，接受并需 Test 承认**
5. `重写/润色/rewrite/polish/tweak/clean up` 等未登记祈使 → 只读 + 澄清（`plan.md:17-18`、`implementation.md:191`）。
6. `参照 X 来修改 Y`（含「来」等插入成分）→ 只读。
7. 词表前缀的偶然性（`补全 X` 授权、`重写 X` 不授权）；`更新 X 的说明` 与 `说明 X 的更新` 的不对称。
8. 语义分类的最终责任在 WP-04/06 模型 Assessment（本包只承诺已登记语料与形态规则）。

**C. 与本包无关或已承接**
9. 真实无头浏览器攻防（WP-10）；真实 Provider 纵向与 `artifact_write` 工具接线（WP-10/WP-07）。
10. W3R9-05 协议对账与 W3R4-05/06/08/10/12/13 未闭合项（P3，结算前登记或修复）。

---

## 10. 方法与边界声明

- **独立上下文**：未读取任何开发/Test 会话对话；结论只来自仓库文件、`docs/**` 契约与我自建的 8 个脚本（`/tmp/w3r9/{probe-domain,probe2-families,probe3-http,probe4-e2e,probe5,probe6-unknown,probe7-corpus,probe8-minimal}.mjs`），全部消费 `pnpm build` 产物；**未 import 任何产品测试文件**（`domain.test.ts` 仅以文本方式提取语料表，且提取后逐句用**构建产物**复跑，不执行产品测试代码）。
- **实验统计（观测 / 失败）**：

| 脚本 | 观测 | 失败（即产品缺陷证据） | 对应 |
|---|---|---|---|
| `probe-domain.mjs`（136 句：108 非祈使 + 28 正例） | 136 | 非祈使 **4** 越权；28 正例 28/28 通过 | W3R9-01（2）、W3R9-02（1）、W3R9-03（1） |
| `probe2-families.mjs`（39 句：F1–F4 28 句 + 控制组 11 句） | 39 | **20** 越权（F1 3、F2 6、F3 7、F4 4；控制组 0） | W3R9-01（F1/F2'）、W3R9-02（F3）、W3R9-03（F4） |
| `probe3-http.mjs`（HTTP 6 句） | 6 | 5 越权（`authorizationId=SET`/`level=L2`/1 授权行） | W3R9-01/02/03 |
| `probe4-e2e.mjs`（端到端派发 13 句 + 1 正例对照） | 14 | **13/13 非祈使句派发真实 Backend 写 Run**；AC-005 正例 1/1 成功 | W3R9-01/02/03 |
| `probe5.mjs`（36 句：拒绝长尾/未登记祈使/副词否定/中文参照/连词） | 36 | 0 缺陷（8 句授权：4 中文参照 + 3 连词 + 1 `补全`；28 句只读） | W3R9-06 记录 |
| `probe6-unknown.mjs`（注入面 + 协议对账 4 项） | 4 | 0 授权；4 项均「静默忽略」（未知字段未按 §1 报错） | W3R9-05 |
| `probe7-corpus.mjs`（登记语料独立复跑） | 74（57 负 + 17 正） | **0** | 登记语料 100% 成立 |
| `probe8-minimal.mjs`（最小复现 14 句） | 14 | **13** 越权（1 句只读为 `更新了` 对照） | W3R9-01（形态对照） |
- **未做**：真实无头浏览器执行、真实 Provider 纵向、Docker 容器内复验、故障注入下的孤儿 blob 复验、`pnpm test:e2e`/`test:acceptance`（脚本按设计指向 WP-09/WP-10，未实现）。
- **未改仓库**：本轮只覆盖写入 `.agentdev/work/WP-03/review.md`（本报告）；除该文件外 `git status --porcelain` 为空，`HEAD` 仍为 `d23ce7b1d3c33df8854420941d1a937af9319a2a`，全部 6 条契约命令在上述工作树上执行。
- **对开发方「结构性」主张的裁决**：**一半成立**——「黑名单 + 默认放行」确实被反转为「白名单 + 默认只读」，这是真实的结构改进，本轮给出正面证据（`probe-domain` 的非祈使分组 96/96 只读、登记 57+17 语料全绿、28 条文档化正例全绿）；但**白名单的形态判定本身仍有四个可达漏洞族**（`probe2` 28 句同族语料中 20 句越权、`probe4` 13/13 可派发真实写 Run），其危害方向仍是「非祈使句产生写授权」，故本轮仍判 **FAIL**，而不是「未登记句式免责」可以覆盖的残余。

---

## 附一：第一轮摘要（保留）

第一轮（报告冻结于 `a946ed6`，被审代码树 `fd90fef`）结论 **FAIL**：必验范围「实现完整直接协作与产物路线，附件暂存/绑定、隔离预览可实际运行」不成立，新增 14 条 Finding —— **2×P0、5×P1、5×P2、2×P3**；P0/P1 全部阻断，P2 的 W3-06 因影响 AC-002 阻断。要点：下载 token 可预测且下载路由先于认证（W3-01 P0）；产物读取无主体维度（W3-02 P0）；owner 由 sessionId 派生（W3-03 P1）；消息正文未写 blob（W3-04 P1）；未知会话上传 500（W3-05 P1）；失效产物仍可预览（W3-06）；AC-006 未实现（W3-07 P1）；用户消息不建 Authorization（W3-08 P1）；token 只增不减/`prune` 无调用方（W3-09）；归档会话仍接受上传（W3-10）；`expireStale` 无调用方（W3-11）；错误响应无 §1 封装（W3-12）；记录不一致（W3-13）；浏览器级攻防未验（W3-14，承接 WP-10）。另 5 项对抗性（内联预览字节上限、文件签名、`targetWorkId` 归属、隔离只靠客户端头、失败上传孤儿 blob 与 staged 无上限）。

## 附二：第二轮摘要（保留）

第二轮（报告冻结于 `8e4efc1`，被审代码树与 HEAD 同为 `a946ed6`）结论 **FAIL**：主要判据 W3R2-01（AC-006 未实现）与 W3R2-02（AC-005 未实现），另 2×P2（W3R2-03 CSP 漂移、W3R2-04 StorageError 映射/回显）、9×P3（W3R2-05..13）。第二轮对抗性 7 项：1/3/4/5/7 已修，2 部分（语义可辩护），6 已修但无测试守护。六条契约命令全绿但不足以支撑必验范围。

## 附三：第三轮摘要（保留）

第三轮（报告冻结于 `35e8674`，被审代码树 `d71dc07`）结论 **FAIL**：AC-005 的授权机制（`routeMessage`、消息级 Authorization 行、`work.authorizationRef`、Assessment、混合意图多 Work 与独立 scope）全部**落库**且成立，但 `grantedByMessage` 生成 `readPaths:['docs']` + `operations:['edit']` 的自相矛盾授权，使绑定它的 Work 的任何 Run/Assessment 都被 `capabilityGaps:['readPaths without a read operation']` 拒绝——交付路线在准入即死锁（W3R3-01 P1）。新增 **1×P1、5×P2、8×P3**；对抗性另指出疑问句被当作执行消息、HTTP 客户端可自报 `authorization`（甚至 `deploy`）。失败路由 `Blocking Review Finding → Develop → Independent Review`。

| 三轮编号 | 严重度 | 摘要 | 第九轮状态 |
|---|---|---|---|
| W3R3-01 | P1 | 授权 capability 缺口 → 交付死锁 | 已修（第九轮 e2e 派发走通） |
| W3R3-02 | P2 | 授权绑定 `works[0]` | 已修 |
| W3R3-03 | P2 | 授权自相矛盾 | 已修 |
| W3R3-04 | P2 | HTTP 响应不含 `workIds`/`authorizationId` | 响应已含；`protocol.md` 仍未对账（W3R9-05） |
| W3R3-05 | P2 | 同 intent 重复共享 scope | 已修（`workItems` 取消后不再适用） |
| W3R3-06 | P2 | CSP 与 `execution.md` §6 漂移 | 已修且逐字相等 |
| W3R3-07 | P2 | StorageError 映射过宽 + 回显 | 回显已修；映射细分仍缺（W3R9-05） |
| W3R3-08/09/10/11/12/13/14 | P3 | validity/归属/owner 派生/prune/证据/数字/协议项 | 部分未闭合（W3R9-05） |

## 附四：第四轮摘要（保留）

第四轮（报告冻结于 `fd0a893`，被审代码树 `3f52fbf`）结论 **PASS（0×P1、3×P2、11×P3）**，但同轮对抗性核验以 HTTP 端到端证伪「越权已闭合」：`explain why … needs a fix`、`don't fix …`、`不要修改 …`、`I am not asking you to fix …` 等仍生成写授权并可派发写 Run；另指出 `targetWorkId` 可改写已有 Work 的 level/authorizationRef、`Content-Security-Policy-Sandbox` 不是标准头、消息授权 L1 与 `routingFloor` 的 L2 不一致、`workItems:[null]`/`intent:'operation'` 造成 500 或非法 Work。

| 四轮编号 | 严重度 | 摘要 | 第九轮状态 |
|---|---|---|---|
| W3R4-01 | P2 | 同 intent 多 Work 共用 scope | 已修（`workItems` 取消后不再适用） |
| W3R4-02 | P2 | `workItems` 把授权挂到只读 Work | 已修（字段取消） |
| W3R4-03 | P2 | `assertGrantWithinMessage` 不约束 `readPaths` | 已修（代码仍在，probe6 复核） |
| W3R4-04 | P3 | `workItems` 未校验 → 500 | 已修（字段取消） |
| W3R4-05 | P3 | 无 Orchestrator 授权回归用例 | 未修（W3R9-05；grep 仍 0 命中） |
| W3R4-06 | P3 | `protocol.md` 未对账 | 未修（W3R9-05） |
| W3R4-07 | P3 | `message.received` 缺 `workIds`/`authorizationId` | 已修 |
| W3R4-08 | P3 | `StorageError` 映射粗 | 未修（W3R9-05） |
| W3R4-09 | P3 | 记录数字不符 | 未修（W3R9-04/05） |
| W3R4-10 | P3 | `targetWorkId` 归属只覆盖 message 来源 | 未修（W3R9-05） |
| W3R4-11 | P3 | 失败发送孤儿 blob | 第九轮不可复现（记录承接） |
| W3R4-12 | P3 | multipart 多文件 / `projectId` | 未修（W3R9-05） |
| W3R4-13 | P3 | 错误响应非 §1 封装 | 未修（W3R9-05） |
| W3R4-14 | P3 | 冻结点与任务不一致 | 第九轮一致（`HEAD=d23ce7b`） |

## 附五：第五轮摘要（保留）

第五轮（报告冻结于 `fd0a893`，被审代码树 `3f52fbf`）结论 **FAIL（0×P0、2×P1、2×P2、5×P3）**：

- **W3R5-01 [P1]** 非执行消息（中英文疑问、否定、陈述、名词化解释）仍产生可用写授权并可派发写 Run（17 个新句式，HTTP 端到端验证）。
- **W3R5-02 [P1]** 明确指令被判为拒绝/解释：裸单字 `别` 命中「错别字/识别/特别/分别」、`说明/介绍` 名词化被当解释、`、` 不参与分词、逗号列表只授权首项（7 例误拒）。
- **W3R5-03 [P2]** 无效 `Content-Security-Policy-Sandbox` 头仍在 wire 上，修复记录与提交信息不实（第七轮已订正并实测单头）。
- **W3R5-04 [P2]** 调用方 `authorization.readPaths` 不受消息范围约束（latent；第七轮已修）。
- **W3R5-05..09 [P3]** `targetWorkId` 归属、孤儿正文 blob、记录数字、前轮剩余项、冻结点漂移。
- 同轮确认已修：`pathsIn` 线性化、`targetWorkId` 不改写目标 Work、消息授权 L2 与 `routingFloor` 一致、`workItems` 逐项校验。

第五轮 §6.1 的 17 句越权语料，**第九轮以 `d23ce7b` 复跑全部成立**（`修改 X 了没有`、`Will you fix X`、`Any thoughts on the fix for X`、`我不想修改 X` 均已只读）；§6.2 的 11 句误拒语料剩 1 句（`docs/INDEX.md 的说明需要修改一下`）为 fail-closed。

## 附六：第六轮摘要（报告缺档）

第六轮 Reviewer **未产出报告**（报告文件为空，`HEAD=7c01c9d` 时无 Review 结果入库）。同轮对抗性核验以 `7c01c9d` 为冻结点独立复现，确认第五轮点名的误拒/CSP/`readPaths` 三组已闭合，但补出：陈述/完成体与认识情态（`我已经修改了 X`、`刚修复了 X`、`I already fixed X`、`X 需要修改`、`是否应该修改 X`、`是否需要更新 X`、`麻烦评估一下 X 是否需要修改`）仍产生可派发写授权；`docs/INDEX.md 的错别字麻烦处理下` 等日常祈使句不授权；`workItems` 第二个同 intent 项 scope 为空；记录中「永不下发写授权」措辞不实；另补 `workItems` 无数量上限、`别改 A，改 docs/plan.md` 误拒、CSP 第二头名残留、`assertGrantWithinMessage` 未约束 `readPaths`。

## 附七：第七轮摘要（保留）

第七轮（报告冻结于 `8f8b2df`，被审代码树与之相同）结论 **FAIL（0×P0、3×P1、1×P2、3×P3）**：

- **W3R7-01 [P1]** 只读请求词（`看一下/检查一下/帮忙/帮我/麻烦/请` + 命名路径）获得写授权并可派发写 Run（`848b5c4` 引入的回归；对照 `7c01c9d` 不授权）——**第九轮判定已修，无回归**。
- **W3R7-02 [P1]** 中文完成体因 `\b` 在 Han 语境恒不匹配而形同虚设；中文疑问缺 `谁/哪些/几点`；英文 `needs a fix`/`The fix needed in…` 未覆盖——**第九轮判定：登记原句与大批变体已修，但「句首 `V了 + 路径`」形态仍未修（W3R9-01）**。
- **W3R7-03 [P1]** `别改 A，改 B`、`不要修改 A，但要修复 B` 等混合指令误拒（AC-005/006 正例失败）——**第九轮判定已修，无回归**。
- **A1 [P1 对抗性]** 被排除目标仍获写授权（`修改 docs/PLAN.md 而不是 docs/INDEX.md`）——**第九轮判定已修**。
- **A2 [P1 对抗性]** 中文混合意图不拆分（`解释 X 并修复 Y`）——**第九轮判定已修**。
- **A3 [P1 对抗性]** 纯建议请求授权（`请给出 docs/INDEX.md 的修改建议`）——**第九轮判定已修**。
- **W3R7-04 [P2]** 边界声明/记录措辞不实——**第九轮仍未订正（W3R9-04）**。
- **W3R7-05 [P3]** `workItems` 回落 scope 产生不可执行 Work——**第九轮不可复现（字段已取消）**。
- **W3R7-06 [P3]** 前轮未闭合项与记录数字——**第九轮仍在（W3R9-05）**。

开发方以 `c82169b` 修复（删除 `REQUEST_ACTION_PATTERN`、中文陈述去 `\b`、目标级排除、中文混合切分、取消客户端 `workItems`），并以 planVersion 2 声明确定性路由边界。第八轮对上述各项的逐条复核见第八轮报告 §3：**四条真修好、W3R7-02 只修了登记原句、记录措辞未订正；同时以自建双语语料证明「黑名单 + 默认放行」的判定式仍在三族上 fail-open（W3R8-01/02/03，均可派发真实写 Run）。**

## 附八：第八轮摘要（保留）

第八轮（报告冻结于 `c82169bc72bbcf8395fb2b00584db8e0b3c60b72`；该报告以未提交文件形式位于工作树，本轮以本报告覆盖）结论 **FAIL（0×P0、3×P1、1×P2、1×P3）**：

- **W3R8-01 [P1]** 中文完成体/陈述的**形态**未被识别（`\b` 已删但动词表枚举不全）：`已经优化了 X`、`已经整理了 X`、`已经修好了 X`、`改动已完成：X`、`我把它改好了：X` 等 12 个变体仍授权 —— **第九轮判定：这类「`已经/已/刚刚 + V`」变体已修（全部只读）；但同根因移到了「句首 `V了 + 路径`」，见 W3R9-01**。
- **W3R8-02 [P1]** 拒绝与非承诺、以及部分疑问句仍授权（`我不想修改 X`、`我无意修改 X`、`别急着修改 X`、`请勿修改 X`、`禁止修改 X`、`暂缓修改 X`、`修改 X 了没有`、`Will you fix X`、`Shall we update X`、`Were you asked to fix X`、`Might you fix X`）—— **第九轮判定已修**（登记与自建变体 22/22 只读）；疑问的**选择形态**仍未修（W3R9-02）。
- **W3R8-03 [P1]** 只读言说行为（解释/评价/了解/请教）中嵌入变更动词即授权（`请讲述修改 X 的方法`、`请评价修改 X 的做法`、`我想先了解修改 X 的影响` 等）—— **第九轮判定已修**（10/10 只读）。
- **W3R8-04 [P2]** 记录与实现不一致（T15 声称的措辞订正与登记计数均不成立）—— **第九轮仍未订正（W3R9-04）**；本轮计数 57+17 已与实测一致，绝对表述仍在（`:140/:159/:172`）。
- **W3R8-05 [P3]** 前轮未闭合项与协议对账（`protocol.md` 未知字段应 `VALIDATION_ERROR`、`targetWorkId` 归属、multipart/`projectId`、错误封装、StorageError 映射、Orchestrator 回归用例、旧轮次数字）—— **第九轮仍未闭合（W3R9-05）**。
- 第八轮对抗性 D1/D2/D3：D1（只读言说行为+变更话题）、D2（完成体枚举缺口）已修；**D3（仅被参照的路径进入写范围）在中文同子句版已修，英文逗号版仍成立（W3R9-03）**。

开发方以 `d23ce7b` 做结构性修复（祈使形态白名单 + 第四至第八轮 57 负/17 正语料固化为回归测试）。第九轮复核结论见本报告 §3/§9：**结构反转成立、登记语料与文档化正例全绿，但白名单形态仍留四族 fail-open（归入 W3R9-01/02/03），故仍 FAIL。**
