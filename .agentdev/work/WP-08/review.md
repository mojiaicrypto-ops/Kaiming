# WP-08 独立 Review 报告（集成、结算与恢复）

## 0. 元数据

| 项 | 值 |
|---|---|
| 工作包 | WP-08 集成、结算与恢复 |
| Review 角色 | 独立 Review（独立上下文；未读取任何开发/Test 聊天或会话） |
| 冻结提交 | `edf1777`（task-issued freeze point） |
| `git rev-parse HEAD` | `edf1777b36c6aa05291d58c73024f6ea9dc0d5dd` |
| `git rev-parse edf1777^{tree}` | `71ef39158bdabaf1c06e737ae5a920f04af2627e` |
| `git status --porcelain` | 空（唯一新增文件为本报告 `.agentdev/work/WP-08/review.md`） |
| 平台 | macOS arm64，Node v24.8.0，pnpm 12.3.4，真实 `git`，真实 SQLite（`node:sqlite`）；未使用 Docker |
| 探针目录 | `/tmp/wp08r/`（只消费 `packages/*/dist` 构建产物，从不 import 产品测试文件） |
| 判定 | **FAIL**（P1 可复现；见 §6、§8） |

### 受审文件哈希（SHA256，冻结提交实际内容）

```
6fde2dea017890e8fb7e44cd5789fe3411590e54fe204dcbae186fd099979a14  packages/workspace/src/worktree.ts
d7d988e2c478238b58896419fecbdd31c8ef64010c41a6907890f2578cc85cc7  packages/workspace/src/cas.ts
eb6a138e9ec25af3e7dea41ab0bb70555eb9f68220dd7a1c50b56eb94ebe9b72  packages/core/src/requirement-save.ts
4d0f5ef7bde7864534bbb006c187814d6880fa3579858f8a6602a0089f216adf  packages/core/src/recovery.ts
f13ac8fbd0ee5dd578a5c8aac131f010eb308572f3ccdd57f29ffab4d8eee511  packages/core/src/settlement.ts
f17040a5f726393ffca0349b9279cd62cfc9a36af76bcc0165d7b083f1ffe03c  packages/workspace/test/worktree.test.ts
f60f70d3e3ed43d463833d2fbb08136c16f94d93782633c7dc4fb081eedaba80  packages/workspace/test/cas.integration.test.ts
22d60e282b059c53ef93b8405fc8c5a832a6f6d293ca1a79ee42bb5f30c4fd43  packages/core/test/requirement-save.test.ts
d4cc0fe50a004139fab0d30bccb4a8bea324581635de7478b71ead4727a82263  packages/core/test/requirement-save.integration.test.ts
94fa027fc9a0274420fa4ee092655a56479e3eb929f5b9f2e21239e605118ad0  packages/core/test/recovery.test.ts
80e6e3c8e4133216ef73cdf53bdc00ed95252db1a1862d75437a3f30764d4341  packages/core/test/settlement.integration.test.ts
011279c6f8c1964403177bada1804a8cc12713f4b9edcf3ed099f6e710f1fadd  packages/core/test/backup.integration.test.ts
4411d8711a915ede8aaff493e0db447936ca2cf8846edd9d060209cc0e9cbf33  packages/core/test/wp08.integration.test.ts
fb5cf9f26b42087db2cb50994b82acc7335bd0ef5b0fc95e09d4248e3c67eecc  packages/core/test/wp08-failures.test.ts
c31bd96d47bc9d55e6116633fe97072f4fe93786b40107c03488d2b0ab67fdbc  packages/workspace/src/git-port.ts
1e4ca4491babe4ec77fc4ffde5c628ea585964cac02c254607a553708253d87d  packages/core/src/run-lifecycle.ts
ab3d0de245895458869bb021a9f9688212571e3174c5c932a9ea12b5d267c9a3  packages/core/src/findings.ts
283e6fa0158cf0f81b73fe1c517400f6482bb14600356c5a3bae533534a91f95  packages/core/src/gates.ts
97677f28e79363bf6bb3f6a193eec4a4183da6e4585051e1440a49eb4f040503  packages/core/src/requirements.ts
5b7c1d436a44ea07337ab85bf604fbcafb0ebd561cb72db7d168b88302aa2506  packages/storage/src/schema.ts
acea1f0418cdc17500e3ab3c18ea5106560967dd8233ab0134672ba11f548558  packages/storage/src/leases.ts
71c997166101a2f01d778662fe0caf4ad3d6df248b4b1d0f5e23fc471f1b2bdc  packages/knowledge/src/projection.ts
b8c877127db5fcf6b97ae202a7dbd0d1d54d6b624b3ba1f56f41aed17ccf37b4  packages/core/package.json
```

### 已加载依据

`AGENTS.md`、`docs/INDEX.md`、`docs/rules/{workflow,agents}.md`、`docs/architecture/{execution,reliability,data}.md`、`docs/product/{knowledge,requirements}.md`、`docs/delivery/acceptance.md`（AC-020/021/022/029/041/054/057/058/061/062/063/064/081/082/083/090/091/093/094 全文）、`docs/delivery/implementation.md`（WP-08）、`.agentdev/work/WP-08/{plan,implementation}.md`，以及受审代码与其回归网。
刻意排除：任何开发/Test 会话或聊天、`webui/`、历史任务记录。

---

## 1. 契约命令原始结果

全部命令在本冻结提交的工作树的根目录执行；日志全文 `/tmp/wp08r/contract.log`。

| # | 命令 | 退出码 | 原始结果（关键行） |
|---|---|---|---|
| 1 | `pnpm typecheck` | 0 | `tsc -p tsconfig.json --pretty false`，无输出 |
| 2 | `pnpm lint` | 0 | `All matched files use Prettier code style!` |
| 3 | `pnpm test:unit` | 0 | `Test Files 48 passed (48)` / `Tests 967 passed (967)`，Duration 10.98s |
| 4 | `pnpm test:integration` | 0 | `Test Files 20 passed (20)` / `Tests 208 passed (208)`，Duration 44.19s（含真实容器用例） |
| 5 | `pnpm docs:check` | 0 | `docs:check ok — 15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages` |
| 6 | `pnpm build` | 0 | `Done` ×10：contracts、domain、knowledge、storage、workspace、core、pi-runtime、cli、daemon、runner |

受审文件相关的原始用例数：`worktree.test.ts` 10、`cas.integration.test.ts` 13、`requirement-save.test.ts` 19、`requirement-save.integration.test.ts` 12、`recovery.test.ts` 17、`settlement.integration.test.ts` 10、`backup.integration.test.ts` 5、`wp08.integration.test.ts` 11、`wp08-failures.test.ts` 5（与实现记录逐项吻合）。

---

## 2. 方法

每个脚本都放在 `/tmp/wp08r/`，通过 `packages/*/dist/index.js` 消费构建产物；真实临时 Git 仓库（`node worktree add` / `commit` / `update-ref` / `cherry-pick`）与真实 SQLite（`node:sqlite` / `ProjectStore`）承载集成状态；脚本自行实现断言与故障注入，不 import 任何产品测试文件。

| 脚本 | 覆盖 | 结果 |
|---|---|---|
| `p1-cas.mjs` | AC-094/093：一对文件单提交、共享版本、组合 hash、半对拒绝、陈旧写者拒绝且分支不动、幂等重放 | checks=27，failures=0 |
| `p1b-race.mjs` | 反证：无 `candidateRevision` 路径下 ref 只由 `update-ref` 移动；有 `candidateRevision` 路径的读-改竞态 | checks=12，failures=0（Case A 观测即 W8R1-01） |
| `p2-save.mjs` | AC-090：分支/提交/未推送状态、`requirement.saved`、投影失败→`RECOVERY_REQUIRED`→重试只补投影不产生第二提交 | checks=31，failures=0 |
| `p3-stale.mjs` | 反证：工作树陈旧时 HEAD 已前进的记录是否被拒；HEAD 有记录而工作树缺失时的行为 | checks=14，failures=2（W8R1-02、W8R1-03） |
| `p4-recovery.mjs` | AC-057/058/061/082：租约轮转、真实进程核对、旧 epoch 拒绝保留诊断、窄 Scope、daemon epoch 围栏 + 双写者反证 | checks=46，failures=1（W8R1-04） |
| `p5-settlement.mjs` | AC-041 知识补丁+冷启动；AC-063 结算/ref 后崩溃/重放一次事件；`SettlementOutcome.tree` 语义 | checks=33，failures=1（W8R1-06） |
| `p6-backup.mjs` | AC-064：backup→新目录 restore 一致性、活动 Run 需恢复、租约/grant 撤销、缺 Secret 阻断、篡改/不完整拒绝、relocate + 非仓库目标反证 | checks=44，failures=2（W8R1-05） |
| `p7-integration.mjs` | AC-081 血缘、AC-062 冲突修复 Task、AC-091 共享锁/池随代码提交、metadata-only 拒绝 + 空变更集反证 | checks=49，failures=1（W8R1-07） |
| `p8-flow.mjs` | AC-020 暂停/恢复、AC-021 取消未知副作用、AC-022 预算原子拒绝、AC-029 初始化中断按 Hash 续写与冲突不覆盖 | checks=38，failures=0 |

合计 294 项断言，7 项失败；失败全部归属 §6 的 finding 或 §7 的记录观察。原始输出保存为 `/tmp/wp08r/p1-cas.out` … `/tmp/wp08r/p8-flow.out`。

反证手法：
- **真实 Git 竞态注入**：包装 `CasJournal.save`，在 CAS「比较」与「提交/ref 更新」之间移动 ref，或让竞争者提交，观察分支是否被覆盖。
- **故障注入**：在投影写入处注入异常（`RECOVERY_REQUIRED` 路径）、在 `FileSystemPort.writeFile` 第 3 次调用抛错（初始化写崩溃）、在 `update-ref` 前观察 ref 已指向的位置。
- **陈旧工作树**：用 detached worktree 提交后 `update-ref` 移动交付分支而不 checkout，制造「HEAD 领先工作树」的真实状态（等价于 fetch/其他服务器提交）。
- **状态机反证**：在恢复服务报告 `newAttemptAllowed:false` 之后，直接走产品自身的 `RunLifecycle.beginAttempt` / `findings.resumeWork` 路径尝试开新 Attempt。

---

## 3. 逐 AC 结论

| AC | 结论 | 证据要点 |
|---|---|---|
| AC-020 暂停恢复 | **passed**（服务层） | `pauseWork` 关闭 Attempt、关闭写准入；`resumeWork` 新 Attempt，ready 后写准入重开（`p8-flow`） |
| AC-021 取消需求 | **passed**（服务层） | 未知副作用 → `blocked(recovery)`、Requirement 保持 active、ref 不回滚；`accept_cancel` → cancelled，Requirement 落库 cancelled（`p8-flow`；`wp08-failures` 同名用例） |
| AC-022 预算止损 | **passed** | `PlanGateService.submitPlan` 超限 `BUDGET_EXCEEDED`，预留为 0、无 Artifact；第二次预留不静默加额（`p8-flow`） |
| AC-029 初始化冲突中断 | **passed** | JSON 状态存储在写崩溃后 `resume` 到 ready，前两份文档字节不变；冲突文档报 `content-conflict` 且原文逐字节保留（`p8-flow`） |
| AC-041 知识结算 | **passed** | 补丁更新正文/关系/入口/失效说明，只经 `buildProjection` 发布；冷启动查询找到新行为、新入口、失效说明与约束；非法知识 `KNOWLEDGE_INVALID`、保留最后有效并标 stale（`p5-settlement`） |
| AC-054 UI 断开 | **not_covered** | 属 WP-09（见 §9） |
| AC-057 Runner 失联 | **partial / P1** | 租约过期轮转、旧持有者不能释放新租约、无重复副作用（passed）；但「无重复副作用或双写者」在 `starting` 活跃进程场景被反证（W8R1-04） |
| AC-058 过期结果 | **passed** | 旧 epoch / 取消后 / 新决定后的成功均被拒，`supersededBy` 正确，诊断事件保留、Run 状态与 stage_result 未被改写（`p4-recovery`） |
| AC-061 启动恢复 | **passed** | 新心跳+进程已死仍 park `interrupted`；进程存活/不可确认 → `recovery_required`；`recoverAfterRestart` 的 host epoch 围栏拒绝等值/更旧 epoch（`p4-recovery`） |
| AC-062 集成冲突 | **passed** | 两已通过 Task 冲突 → `TASK_MERGE_CONFLICT`、HEAD 不动、独立修复 Task（依赖双方、`requiresFreshVerification:true`、确定性 UUIDv7 id、冲突产物哈希），重试产生同一 id（`p7-integration`） |
| AC-063 部分结算 | **passed** | ref 已移动后 `recover` 复用提交、补齐状态、恰好一次 `settlement.completed`；重放不再发事件、不再建提交（`p5-settlement`） |
| AC-064 备份恢复 | **passed（AC 条款）** | 新目录 restore 的 hash/知识/证据一致、活动 Run park `interrupted`、租约与 grant 撤销、缺 Secret 阻断、篡改/不完整拒绝、relocate 成功路径 re-check；但 `move:false` 目标非仓库时反证见 W8R1-05 |
| AC-081 Task 依赖输入 | **passed** | `dependencyRevision`/`dependencyManifestRefs` 精确；缺冻结输入或 manifest ref → `GATE_NOT_READY`；祖先变化 → `STALE_ARTIFACT`+`invalidated`；最终集成跳过已合并祖先、祖先变更只出现一次（`p7-integration`） |
| AC-082 重启保留窄范围 | **passed** | 冻结窄 Scope 生效、Work 宽范围记为 ignored、越界路径/操作拒绝、快照缺失或哈希不符 `STALE_ARTIFACT`（`p4-recovery`） |
| AC-083 组合及文档 Finding | **partially covered** | 产品集成测试的 document 路线含无 `taskId` Finding 与独立 Review/Test 关闭；本次 Review 未另写独立探针（见 §10） |
| AC-090 需求保存时机 | **passed（正常与重试路径）** | `saved` 报告 branch/ref/commit/previousCommit/unpushed；Git 已提交后重试 `projection_repaired`、复用提交、无第二提交；失败回传 `requirement.save.retry`（`p2-save`、`p3-stale` Case B）；但工作树陈旧/缺失时见 W8R1-02/03 |
| AC-091 崩溃与交付竞争 | **passed** | `integration:<projectId>` 单锁串行化保存与交付、并发保存 `BUSY` 且不写库；代码交付基于当前基线，新提交同时含代码改动与最新需求池、需求不重复；metadata-only 变更 `GATE_NOT_READY`（`p7-integration`） |
| AC-093 目录与正文一致性 | **passed（一致性）+ P1（读取源）** | 两文件共享版本、marker 一致、组合 hash 由提交字节独立复算吻合、半对拒绝；但池读取以工作树为源（W8R1-02/03） |
| AC-094 正文保存与并发 | **failed（P1）** | 组合 recordHash 校验存在，但比较读取的是工作树字节；陈旧工作树下旧投影成功覆盖其他服务器的更新记录（W8R1-02）。半对/陈旧写者/幂等/分支保护本身 passed |

---

## 4. 设计反证清单（按任务要求逐项）

| 反证目标 | 结果 |
|---|---|
| CAS 竞态（两写者、读后 ref 移动、force 路径） | 有 `candidateRevision` 的路径：读后 ref 移动被 `VERSION_CONFLICT` 拒绝，分支未被覆盖，无事件（`p1b` Case B）。无 `candidateRevision` 的路径：ref 由 `git commit` 在仓库工作树直接推进，竞态被静默吸收（**W8R1-01**）。代码中不存在 force/push 路径，`update-ref` 是唯一显式 ref 写入点（`worktree.ts:355-359`） |
| 依赖血缘缺口（祖先变了但 B 仍验证通过、manifest ref 缺失） | 未发现：祖先 revision 变化 → `invalidated:true`+`STALE_ARTIFACT`；manifest ref 缺失 → `GATE_NOT_READY`（`p7`） |
| 绕过锁（无锁并发保存/交付、重复释放锁） | 未发现绕过：资源名一致、被持有时 `BUSY`、重复释放返回 `false` 且不误删他人租约（`p7`、`p4`）。注意：同 `operationId` 的并发 `save()` 因 `ownerAttemptId=operationId`、`epoch=1` 默认可重入（§6 W8R1-07 之外的设计弱点，未单独记为 finding，建议随 W8R1-04 一并收紧） |
| 投影/Git 分歧（投影比 Git 新，或反之） | 投影刷新失败 → `RECOVERY_REQUIRED`，重试只补投影（passed）。反向（Git 比投影/工作树新）暴露 **W8R1-02/03** |
| 恢复信任持久字段 | 未发现：进程身份与 epoch 均实测，持久心跳与状态不作为存活证据（`p4`） |
| 旧 epoch 结果覆盖新决定 | 未发现：epoch/取消/新决定三闸拒绝并保留诊断（`p4`） |
| 重复完成事件 | 未发现：CAS 层 `state==='completed'` 守卫、结算层按 `operationId` 扫描去重、重放零新增（`p1`、`p5`） |
| 备份/恢复 hash 缺口（blob、知识、git ref、secret） | 未发现漏洞：文件逐项哈希+字节数、blob 证据哈希、git bundle 全 refs 恢复、secret 只存标识且缺凭证阻断；`knowledge.treeHash` 被记录但无读者（属弱校验，未构成 AC 失败） |
| 恢复期双写者 | **发现（W8R1-04）** |
| relocate 复检 | **发现（W8R1-05）** |
| implementation.md T1..T5 与代码不符处 | T1「只用 `update-ref <ref> <new> <old>` 移动 ref」对无 `candidateRevision` 分支不成立（**W8R1-01**）；其余 T1–T5 陈述与代码一致（见 §9） |

---

## 5. Findings

严重性口径（`docs/rules/workflow.md` §6）：P0 数据/安全或关键不可用；P1 错误行为/需求缺失；P2 局部质量/维护；P3 建议。

### W8R1-01（P2，非阻断但需修）— 无候选版本时 CAS 用 `git commit` 直接推进交付分支，绕过 expected-old 保护

- **位置**：`packages/workspace/src/cas.ts:1555`（`const commit = git.commitPaths(repoRoot, request.message, poolPaths);`）、`packages/workspace/src/worktree.ts:404-405`（`git commit -m <msg> -- <paths>`）。
- **复现**：`/tmp/wp08r/p1b-race.mjs` Case A（`node p1b-race.mjs`）。
- **观测**：调用方不传 `candidateRevision` 时，`integrate()` 在仓库工作树执行 `git commit`，该命令移动 `refs/heads/agentdev/main` 本身。注入的竞争者在「比较」之后、「提交」之前移动 ref，CAS 直接在其之上提交；随后 `update-ref` 因 expected-old 失配而失败，代码走 `raced === targetRevision` 分支返回成功，`refUpdated=false`，仍发出 1 条完成事件。观测到 `refAtCommitStep == target`（ref 在 `update-ref` 之前已指向目标）、`competitor` 成为新提交的祖先、`branchUntouched` 语义失效。
- **期望**：`reliability.md` §4 步骤 8 与 AC-062/AC-094 的「CAS 保护 HEAD」要求交付 ref 只由 `git update-ref <ref> <new> <expected>` 移动；`implementation.md` T1 明确写「只用 `update-ref <ref> <new> <old>` 移动 ref」。
- **影响面**：产品内三处 CAS 调用点（`requirement-save.ts:1659`、`settlement.ts:985`、`settlement.ts:1079`）都传 `candidateRevision`，因此 WP-08 的 AC 流程未被绕过；但导出的 `createCasService().integrate()` 是公共 API，该分支的契约与实现不符，且在该分支崩溃会留下未被引用的游离提交（journal 尚未记录 `targetRevision`）。
- **修复方向**：删除该 `git commit` 回退，要求调用方必须提供 `candidateRevision`（或先 `git commit-tree` 生成候选提交再 `update-ref <ref> <new> <old>`）；在候选与 journal 之间保持「先记录目标提交、后动 ref」。

### W8R1-02（P1，阻断）— 需求池读取以工作树为源，陈旧工作树下旧投影可覆盖其他服务器的新记录（违反 AC-094）

- **位置**：`packages/core/src/requirement-save.ts:598-616`（`readBlobAt` 的 `readFileSync(join(input.repoRoot, path))` 回退，注释 613-614 声称「save path checks the committed bytes out first」，但全文件无任何 checkout）、`requirement-save.ts:1740-1743`（`compareExpectation` 以 `this.worktrees` 为池读取端口，而 `WorktreeGitPort` 没有 `readBlob`）。
- **复现**：`/tmp/wp08r/p3-stale.mjs` Case A。
- **观测**：先正常保存 v1（工作树与 HEAD 均为 v1）；另一服务器把同一需求的 v2（正文不同）提交到交付 ref 并移动 ref，但**不**更新工作树（等价于 fetch/远端提交落地）；本机投影仍为 v1。调用 `save()` 并声明 `expected {recordVersion:1, recordHash:<v1>}`：返回 `ok:true, status:'saved'`，`previousCommit` 已是其他服务器的提交，新提交把 v2 覆盖为本地 v2。基线明明已前进，却未返回 `REQUIREMENT_CONFLICT`。
- **期望**：`docs/architecture/reliability.md` §9「取得集成锁后，先将当前 HEAD 的目标记录与预期值核对」、`data.md` §6「Git 内容比较使用 recordVersion/recordHash」、AC-094「When 保存旧元数据…Then 组合 recordHash 校验拒绝旧投影覆盖」；`requirement-save.ts:1231` 的注释也自称「compared against the *directory* record hash at HEAD」。
- **影响面**：AC-094 核心条款；多服务器/多 checkout 场景下的静默丢失更新。
- **修复方向**：为 `RequirementPoolGitPort` 注入真实 blob 读取（`git show <rev>:<path>` 或 `cat-file blob`），让 `readRequirementPoolAtRevision` 真正按 revision 读取；或在比较前显式 `git checkout`/`read-tree` 保证工作树与 HEAD 一致并断言二者相同。删除/更正 613-614 行与 1231 行的失实注释。

### W8R1-03（P1，阻断）— HEAD 含工作树缺失的记录时 `save()` 抛出未捕获的 `ENOENT`（违反 AC-093 的逐条冲突要求）

- **位置**：同 W8R1-02（`requirement-save.ts:615` 的 `readFileSync`）。抛出点：`RequirementSaveService.save → saveUnderLock → compareExpectation → readRequirementPoolAtRevision → readBlobAt`。
- **复现**：`/tmp/wp08r/p3-stale.mjs` Case C。
- **观测**：另一服务器新增一条需求记录并移动交付 ref（工作树未 checkout）。调用 `save()` 创建**另一条**需求时，进程抛出 `Error: ENOENT: no such file or directory, open '<root>/.agentdev/requirements/<id>/requirement.json'` 并终止，公共 API 没有返回任何结构化结果。
- **期望**：`docs/product/requirements.md` §4「缺任一文件、Hash 不一致、重复 ID 或未知 Schema 标该条冲突，展示路径及可读原文，不静默补空正文」与 AC-093「其他错误逐条明确显示」；`save()` 的返回类型是 `RequirementSaveOutcome`，不应抛出文件系统错误。
- **修复方向**：同 W8R1-02；此外对 blob 读取失败改为结构化 `REQUIREMENT_CONFLICT`/`INTERNAL_ERROR` 结果（带路径），而不是让 `readFileSync` 异常逃逸。

### W8R1-04（P1，阻断）— 恢复报告的 `newAttemptAllowed:false` 无任何执行侧消费者，`interrupted` Run 可在旧进程确认存活时开新 Attempt（违反 AC-057「无重复副作用或双写者」）

- **位置**：`packages/core/src/recovery.ts:666-679`（`starting` 的 risky Run 只能 park 成 `interrupted`）、`recovery.ts:696`（`newAttemptAllowed: action === 'park_interrupted' && !risky` 仅出现在返回值里）、`packages/core/src/run-lifecycle.ts:111-119`（`beginAttempt` 只检查 `canTransitionRun(run.status,'starting')`）、`packages/core/src/findings.ts:1733-1734`（Work resume 对 `interrupted`/`recovery_required` 无条件 `beginAttempt`）。全仓 `newAttemptAllowed` 无 recovery.ts 之外的读取点。
- **复现**：`/tmp/wp08r/p4-recovery.mjs`「FALSIFY: is "no double writer" actually enforced after a risky park?」。
- **观测**：`starting` 状态、`runnerId='pid:1000'` 且探针确认进程**存活**的 Run → `recoverRun` 得 `to='interrupted'`、`newAttemptAllowed=false`、`attemptStatus=null`（旧 Attempt 未标 lost）、旧租约已释放。随后 `new RunLifecycle({store}).beginAttempt(RUN_ID)` **成功**：Attempt #2 / epoch 1 建立；旧 Attempt 仍为 `starting` 且 `pid:1000` 存活；同一个 `worktree:task-1` 租约被交给新 Attempt。恢复服务的 `newAttemptAllowed` 未被任何代码用于准入。
- **期望**：AC-057「超 lease/restart ⇒ interrupted/recovery，无重复副作用或双写者」；`reliability.md` §2「旧进程未确认终止时不把工作区授予新写者」；`recovery.ts` 模块头第 13-16 行同一承诺。
- **影响面**：真实双写者路径（两个 Attempt 同时持有同一 worktree 的写入权），是 WP-08 最严重的契约缺口。
- **修复方向**：把「未确认终止」变成可强制的前置——例如在 `recovery_required`/带风险 `interrupted` 的 Run 上持久化禁止新 Attempt 的阻断（`blockerIds` 或专用字段），并让 `RunLifecycle.beginAttempt`/`findings.resumeWork` 在开新 Attempt 前校验该标记与最近 Attempt 的 epoch/进程状态；或在 `beginAttempt` 内对 `interrupted` Run 复用 `RunRecoveryService` 的 `newAttemptAllowed` 判定，仅当旧执行确认终止才放行。另建议在恢复报告中把该判定持久化，而非只放在返回值中。

### W8R1-05（P2）— `relocateProject({move:false})` 接受任意已存在目录，先改根后体检，仍返回 `ok:true`

- **位置**：`packages/core/src/recovery.ts:2102`（`return existsSync(newRoot) ? newRoot : null;`）、`recovery.ts:2040-2044`（`store.projects.update(project.id, {root: relocatedRoot, gitRoot: relocatedRoot}, ...)` 发生在 doctor 之前）、`recovery.ts:2067-2080`（缺失 Secret 只折进 `executionReady`）。
- **复现**：`/tmp/wp08r/p6-backup.mjs`「FALSIFY: relocate onto a directory that is not a Git repository」。
- **观测**：对一个空目录调用 `relocateProject({move:false})`：返回 `ok:true`；`doctor.checks` 显示 `delivery-ref:false tree-binding:false knowledge-clean:false`，`executionReady=false`；同时 Project 行的 `root`/`gitRoot` **已被改写**为这个非仓库目录且无回滚。此后该 Project 无法再以原根打开。
- **期望**：`docs/delivery/implementation.md` WP-08 输出与 AC-064 证据要求「relocate 复检」；`reliability.md` §7/§8 的 relocate/restore 需核对清单与一致性。
- **修复方向**：在改根之前校验目标目录确为该项目仓库（含 `deliveryBranch` 的 ref、tree 与备份清单/记录的 revision 一致），失败即返回 `NOT_FOUND`/`INVALID_STATE` 且不写 Project 行；把根映射更新移到校验通过之后（或放入事务 + 失败回滚）。

### W8R1-06（P3，已登记残余）— 结算完成 Requirement 后不清 `phase`，留下 `lifecycle='completed'` 且 `phase='settle'` 的行

- **位置**：`packages/core/src/settlement.ts:1187-1196`（只写 `lifecycle:'completed'` 与 `finalManifestId`）。
- **复现**：`/tmp/wp08r/p5-settlement.mjs`（AC-063 settle 段的检查）。
- **观测**：`requirement lifecycle=completed phase="settle"`。
- **期望**：`docs/rules/workflow.md` §5.1「Requirement.phase：product、plan、execute、accept、settle；只在 active 使用」。
- **说明**：`implementation.md` T5 残余 8 已登记该事项（“需 schema 所有者决定 raw UPDATE”），故不阻断；但它是真实的状态不一致，建议随本包或 schema 归属方一并收口。

### W8R1-07（P3）— `checkCompletionSettlement` 把空变更集当作有效完成证据，且从不读取 `codeStartRevision`

- **位置**：`packages/core/src/requirement-save.ts:762-766`（`metadataOnly = changedPaths.length > 0 && codePaths.length === 0`）、`requirement-save.ts:838-849`（成功返回）。
- **复现**：`/tmp/wp08r/p7-integration.mjs`「AC-091: a metadata-only change cannot pose as code verification」。
- **观测**：`changedPaths: []` → `ok:true, codeChanged:false`，没有 Manifest 与最终 revision/tree 之外任何“确有代码变更”的证据；入参 `codeStartRevision` 全程未被读取，函数无法验证变更集确实来自 `codeStartRevision..finalRevision`。
- **期望**：AC-091「metadata 变更不冒充代码验证」的同一精神下，零变更同样不构成代码验证；契约（`requirement-save.ts` 注释 704-705、753）声称按 `codeStartRevision..finalRevision` 计算变更集。
- **修复方向**：`changedPaths` 为空时返回 `GATE_NOT_READY`（或在 `codeChanged===false` 时要求显式 Decision）；把 `codeStartRevision` 用于实际 diff 校验，或从签名与注释中移除该字段。

### W8R1-08（P3）— `SettlementOutcome.tree` 在直连结算与崩溃恢复两条路径语义不同

- **位置**：`packages/core/src/settlement.ts:1013-1014`（直连把 CAS 的 Git tree OID 作为 `tree` 返回）与 `settlement.ts:1041-1042`（恢复优先用持久化的 SHA256 `codeTree`）。
- **复现**：`/tmp/wp08r/p5-settlement.mjs` 末节。
- **观测**：同一次交付，`settle().tree = 5022ae…`（`git rev-parse <rev>^{tree}` 的 Git tree OID），而传入并经 `deliveredCodeTreeHash` 计算的 codeTree 为 `33d27e…`（SHA256）；`recover().tree` 返回的是后者。`settlement.completed` 事件的 `data.tree` 也因此随路径改变含义，且 operation 行先存 SHA256 后被改写为 OID。
- **期望**：同一字段应在两条路径上含义一致（`data.md` 中 `codeTree` 是 SHA256；Git tree OID 是另一种标识）。
- **修复方向**：区分 `treeOid` 与 `codeTree` 两个字段，或在 `finish()` 前统一换算为 codeTree（用 `deliveredCodeTreeHash`），并把 operation/事件字段固定为同一种。

---

## 6. 计数与阻断表

| 项 | 数量 |
|---|---|
| 独立探针断言 | 294 |
| 失败断言 | 7（其中 1 项为“空变更集”反证，另 1 项为 `phase` 残余） |
| P0 | 0 |
| P1 | 3（W8R1-02、W8R1-03、W8R1-04） |
| P2 | 2（W8R1-01、W8R1-05） |
| P3 | 3（W8R1-06、W8R1-07、W8R1-08） |
| 阻断 finding | 3（全部 P1） |

| 门禁问题 | 结果 |
|---|---|
| 契约命令是否全绿 | 是（typecheck/lint/unit/integration/docs:check/build 全 0） |
| Plan 是否覆盖实际改动 | 是（`worktree,cas,requirement-save,recovery,settlement` + 测试；`packages/workspace/src/backup.ts` 未落地但已在残余 6 登记） |
| 声明与代码是否一致 | 否（T1「只用 update-ref 移动 ref」不成立 → W8R1-01） |
| 是否存在未登记的水平缺口 | 是（W8R1-01/02/03/04/05 均未登记） |
| 是否存在阻塞缺陷 | 是（3 × P1） |

**能否进入独立 Test：否（阻塞）。** 依据 `docs/rules/workflow.md`：P0/P1 阻断，须 `Develop → 独立 Review → Test`。建议 Developer 优先修 W8R1-02/03（同源，AC-094/AC-093 直接相关）与 W8R1-04（AC-057 双写者），三项修复后由新的独立 Review 复核；W8R1-01/05 至少应同批修掉或由用户显式接受风险并登记。修复后本报告需重做（代码树哈希变化）。

---

## 7. 反证中未发现问题的项（供 Test 复验时参考）

- 组合 `recordHash` 公式与提交字节完全吻合：`metadata.contentHash == sha256(含 marker 的 content.md)`，`recordHash == requirementRecordHash(metadataHash, contentHash)`（`p1`）。
- 半对文件永不提交：`requirementPoolPaths` 抛错、`integrate` 返回 `VALIDATION_ERROR`、分支与提交数不变（`p1`）。
- 陈旧写者 `VERSION_CONFLICT` + `branchUntouched:true` + `actualRevision` 准确、无第二完成事件（`p1`）。
- `requirement.save.retry` 的恢复对象、`repairOnly` 与投影失败后的“只补投影”语义正确（`p2`）。
- 租约三元组释放不会误删他人租约、二次释放返回 `false`（`p4`）。
- 迟到结果拒绝保留诊断事件、不改写 Run 与 `stage_result`（`p4`）。
- 窄 Scope 在重启后不被 Work 宽范围替代；快照缺失/哈希不符 fail-closed（`p4`）。
- 结算的事件唯一性与提交复用（含重放）（`p5`）。
- 备份/恢复的哈希一致性与缺 Secret 阻断（`p6`）。
- 集成冲突的修复 Task 独立性与确定性 id、HEAD 保护（`p7`）。

---

## 8. 记录对账（implementation.md / plan.md 与代码）

**准确的部分**

- T5 的契约命令数字与实际一致：unit 48 文件/967 用例、integration 20 文件/208 用例、build 10 workspace、docs:check ok（本次 Review 独立复跑）。
- T1–T4 的模块与接口位置描述与代码一致（`worktree.ts`/`cas.ts`/`requirement-save.ts`/`recovery.ts`/`settlement.ts`，以及 `WorktreeGitPort`、`CasJournal`/`CasEventPort`、`ProjectIntegrationLock`、`RunRecoveryService`、`SettlementService`）。
- `packages/core/package.json` 新增 `@agentdev/knowledge`、`@agentdev/workspace` 与 `pnpm-lock.yaml` importer 变更确实在提交 `edf1777` 中（`git show --stat` 含这两个文件）。
- 残余 5（`apps/cli` 的 backup/restore/relocate 与 daemon 的重启恢复未接线）：`grep -rn "backupProject|restoreProject|relocateProject|recoverAfterRestart" apps/` 为空，属实。
- 残余 6（`packages/workspace/src/backup.ts` 未落地，备份全在 `core/recovery.ts`）：属实。
- 残余 8（结算不清 `phase`）：复现属实（W8R1-06）。
- 残余 9（AC-054 属 WP-09，本包未覆盖）：`implementation.md` 明确声明，属实。

**不准确/缺失的部分**

- T1「**只用 `update-ref <ref> <new> <old>` 移动 ref**」：对 `candidateRevision === undefined` 的 CAS 分支不成立（W8R1-01）。
- `requirement-save.ts:613-614` 与 `1231` 的注释声称池读取按 HEAD 且「save path checks the committed bytes out first」：代码中不存在任何 checkout，生产路径实际读工作树（W8R1-02/03）。
- 未登记的水平缺口：池读取源（W8R1-02/03）、恢复后双写者（W8R1-04）、relocate 非仓库目标改根（W8R1-05）、空变更集通过（W8R1-07）、`SettlementOutcome.tree` 双语义（W8R1-08）。
- **五项必需失败测试**：确实存在且命名一致，位于 `packages/core/test/wp08-failures.test.ts`（`Task 合并冲突`、`CAS 失败`、`ref 后崩溃`、`取消未知副作用`、`备份演练`），本次运行 5/5 通过，我另用独立探针覆盖了同样五个场景。
- **AC-054 是否夸大**：`implementation.md` 未夸大——T5 残余 9 明确写「AC-054（BFF/浏览器断开继续）属 WP-09，本包未覆盖」。但 `.agentdev/work/WP-08/plan.md` 的 T4 `acceptanceIds` 把 AC-054 列入（与 `implementation.md` 的 WP-08 关联验收列表同步照抄），而 WP-08 的「本包必验范围」并不包含它；这是一处 plan 层面的轻微过度映射，建议在结算时把 AC-054 标为承接项而非本包验收项。除此之外未发现夸大：T5 的测试数字、残余清单与代码实际状态一致。

---

## 9. 覆盖限制

1. **AC-054 不可在本包验证**：BFF/浏览器断开与水位同步属 WP-09，本包无 HTTP/WS 接线，故 `not_covered`（与记录一致）。
2. **AC-083 仅间接覆盖**：document 路线与无 `taskId` Finding 的关闭由 `wp08.integration.test.ts` 断言并通过；本次 Review 未另写独立探针验证 Finding 目标绑定/`manifestId` 的数据库约束，属部分覆盖。
3. **UI 层未验证**：AC-090 的“分支/提交/未推送状态”只在 `RequirementSaveService` 返回结构层验证；`webui/` 为 Mock，BFF/UI 显示属 WP-09。
4. **容器与环境**：WP-08 不需要 Docker；`pnpm test:integration` 中的容器用例（broker/permissions/cli）在本机通过，但非本包重点，未做额外反证。
5. **备份范围**：未验证 `.agentdev/work` 等本机过程目录在“未提交”状态下的备份（实现只复制 DB、`dataDir/blobs`、`documentRoot` 下的知识树与 git bundle）；本仓库中 `.agentdev/work` 受 Git 跟踪，故该风险取决于用户项目配置，未记为 finding。
6. **Secret 值**：按设计只验证了“缺 Secret 阻断”与“清单不含值”，未演练 secret 的加密导出/导入（实现记录残余 4 已说明）。
7. **`p1-cas.mjs` 初版的竞态注入无效**（竞争者 `update-ref` 的 expected-old 已失配），该段已删除，竞态结论以 `p1b-race.mjs` 为准；本报告只引用清理后的结果。
8. **并发时序**：除 CAS 读后写与锁竞争外，未做真多进程并发压测；AC-091 的并发验证在单进程内通过锁与状态观测完成。
9. **一次性工具副作用（需如实披露）**：本 Review 曾用 4 个只读分析子代理并行阅读代码。其中一个代理违反只读边界，在仓库根写入了 `WP-08-cas-worktree-API-报告.md`；已删除并复核 `git status --porcelain` 为空，冻结代码树未被修改。其余 3 个代理确认未写任何文件。该事件不影响受审文件哈希，但记录在此以保证过程可审计。

---

## 10. 结论

WP-08 的骨架与绝大多数验收行为是真实、可复现、且以真实 Git/SQLite 为证据的（AC-020/021/022/029/041/057/058/061/062/063/064/081/082/090/091/093 的绝大多数正例均通过我的独立探针）。但存在 3 项 P1 可复现缺陷：需求池读取源错误导致 AC-094 的“旧投影不得覆盖”在陈旧工作树下失效（并在缺失文件时抛出未捕获异常，AC-093），以及恢复后仍可对确认存活的旧执行开启新 Attempt 形成双写者（AC-057）。另有 2 项 P2 与 3 项 P3。**判定 FAIL，不允许进入独立 Test**；须 `Develop → 新独立 Review → Test`。
