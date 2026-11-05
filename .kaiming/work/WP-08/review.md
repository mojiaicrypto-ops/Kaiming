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

---

# WP-08 独立 Review 报告（第二轮：W8R1-01..08 收口复核与回归搜寻）

## R2-0. 元数据（round 2）

| 项 | 值 |
|---|---|
| 工作包 | WP-08 集成、结算与恢复 |
| Review 角色 | 独立 Review（独立上下文；未读取任何开发/Test 聊天或会话） |
| 轮次 | 第二轮（复核 round 1 的 8 条 finding 收口 + 回归搜寻） |
| 冻结提交 | `dbfa9af`（task-issued freeze point） |
| `git rev-parse HEAD` | `dbfa9aff6624df717e61e0da64aedca372ef5e47` |
| `git rev-parse dbfa9af^{tree}` | `6c8f6c915a42192061b2edea7c111d23d3c17a9b` |
| `git status --porcelain` | 空（唯一变更为本报告尾部追加） |
| 平台 | macOS arm64，Node v24.8.0，pnpm 12.3.4，真实 `git`，真实 SQLite（`node:sqlite` / better-sqlite3）；未使用 Docker |
| 探针目录 | `/tmp/wp08r2/`（只消费 `packages/*/dist` 构建产物，从不 import 产品测试文件） |
| 判定 | **FAIL**（P1 可复现：W8R2-01；见 R2-5、R2-6） |
| round 1 保留 | §0–§10（原 34952 字节）逐字保留；本轮仅追加。`git diff --numstat` = `N 0 .agentdev/work/WP-08/review.md`（新增 N 行、删除 0 行），见 R2-1 |

### 受审文件哈希（SHA256，冻结提交 `dbfa9af` 实际内容）

```
f8d47a161e7eed0d92c6634434f5568c4220d6b05bbdc1bc31a3a02f79e529da  packages/workspace/src/worktree.ts
ddb3b1df3bfa68757dc7ccc1789eb545972efbfd0b235345e81d54fc7e83efe2  packages/workspace/src/cas.ts
882bd85454118a142dcdaf911b17b4029b328a3c758fcbb49a37abbb039064f1  packages/core/src/requirement-save.ts
fc0531977514c87f6bbe379f7fbbaeec718844c28d8e8a31b9810f244fdec131  packages/core/src/recovery.ts
e322d87a5b7ee6d5a9426ac4071b302742dfa3eab7d5ab6461ca011e6a7ee0a4  packages/core/src/settlement.ts
7efd540361c43411f45acc66ee4c6605722f766eb2040471cc96546fd88c5222  packages/core/src/run-lifecycle.ts
f3edbabf1a85c34663932847aa9799e52b077eeca88c4b5a0a95aab8586a8674  packages/core/src/findings.ts
33e6053e08e5206a13fbabbef5e2ed073ed255db039cf6679ab451a01e05e1f8  packages/workspace/test/worktree.test.ts
2f024f05c7368d8b82c406b81130a3b1cbca5d1b05a32b6ad0e90a63f1980088  packages/workspace/test/cas.integration.test.ts
8967a9efbfd88fde156206dba89c69abaf1b53a08523a0e8656bbe318027918e  packages/core/test/requirement-save.test.ts
21405dde553f8337b77eeae661ff121a3b84d9102a64f0a9651613329c99115b  packages/core/test/requirement-save.integration.test.ts
b3787b5dbb331943e58142c56a786a547f5b3f7fba9095aa1b2bebdc401a27a1  packages/core/test/recovery.test.ts
3797b27071389beaa128b94c8e3c78f3bd08bf17f4699fb6dfeca29b55888b9d  packages/core/test/settlement.integration.test.ts
cdbbbbb046dbd859690fa56f60e14103b4db9e36838d8c82d42b124414cf6575  packages/core/test/backup.integration.test.ts
eeb692c5c404cada3a4f0058fd72037cccac71cacf67f1ba21e416bdc7b45245  packages/core/test/wp08.integration.test.ts
d00fd55b44f4cd8bf3976fef91d1ed9f161061e5d6c16e403184b685706e15b5  packages/core/test/wp08-failures.test.ts
```

### 已加载依据

`AGENTS.md`、`docs/INDEX.md`、`docs/rules/{workflow,agents}.md`、`docs/architecture/{reliability,data,execution}.md`、`docs/product/{knowledge,requirements}.md`、`docs/delivery/acceptance.md`（AC-020/021/022/029/041/054/057/058/061/062/063/064/081/082/083/090/091/093/094 全文）、`docs/delivery/implementation.md`（WP-08）、`.agentdev/work/WP-08/{plan,implementation,review}.md`，以及 `dbfa9af` 的受审源码与回归网。
刻意排除：任何开发/Test 会话或聊天、`webui/`、历史任务记录。

---

## R2-1. 契约命令原始结果（`dbfa9af` 工作树根目录，顺序执行）

日志全文 `/tmp/wp08r2/contract.log`；每行 `EXIT_CODE` 为真实退出码。

| # | 命令 | 退出码 | 原始结果（关键行） |
|---|---|---|---|
| 1 | `pnpm typecheck` | 0 | `tsc -p tsconfig.json --pretty false`，无输出（real 1.35s） |
| 2 | `pnpm lint` | 0 | `Checking formatting...` / `All matched files use Prettier code style!`（real 15.76s） |
| 3 | `pnpm test:unit` | 0 | `Test Files 48 passed (48)` / `Tests 971 passed (971)`，Duration 10.94s |
| 4 | `pnpm test:integration` | 0 | `Test Files 20 passed (20)` / `Tests 215 passed (215)`，Duration 56.59s（含真实容器用例） |
| 5 | `pnpm docs:check` | 0 | `docs:check ok — 15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages` |
| 6 | `pnpm build` | 0 | `Done` ×10：contracts、domain、knowledge、storage、workspace、core、pi-runtime、cli、daemon、runner（real 3.40s） |

WP-08 相关测试文件逐文件用例数（本次独立复跑，与 `implementation.md` T6 声明逐项吻合）：

| 文件 | 用例数 | 文件 | 用例数 |
|---|---|---|---|
| `workspace/test/worktree.test.ts` | 10 | `core/test/backup.integration.test.ts` | 6 |
| `workspace/test/cas.integration.test.ts` | 15 | `core/test/settlement.integration.test.ts` | 10 |
| `core/test/requirement-save.test.ts` | 22 | `core/test/wp08.integration.test.ts` | 12 |
| `core/test/requirement-save.integration.test.ts` | 15 | `core/test/wp08-failures.test.ts` | 5 |
| `core/test/recovery.test.ts` | 18 | | |

**五项必需失败测试**（`pnpm vitest run --project unit packages/core/test/wp08-failures.test.ts`）：`Tests 5 passed (5)` —— Task 合并冲突 / CAS 失败 / ref 后崩溃 / 取消未知副作用 / 备份演练 全部通过。

**round 1 逐字保留校验**：`git show HEAD:.agentdev/work/WP-08/review.md` 与追加前工作树文件同为 34952 字节；追加后 `git diff --numstat -- .agentdev/work/WP-08/review.md` 的删除计数为 0（仅新增本 round 2 段落）。

---

## R2-2. 方法

9 个脚本位于 `/tmp/wp08r2/`，全部通过 `packages/*/dist/index.js` 消费**构建产物**；真实临时 Git 仓库（`worktree add` / `commit` / `update-ref` / `cherry-pick` / `clone`）与真实 SQLite（`ProjectStore`）承载集成状态；脚本自实现断言与故障注入，从不 import 任何产品测试文件；每个脚本自建 fixture（另一服务器的提交、崩溃点、竞争 ref 移动）。

| 脚本 | 覆盖 | 结果 |
|---|---|---|
| `a-cas.mjs` | W8R1-01（无候选拒绝 / 竞争移动 / 成功与重放）、AC-093 半对拒绝、候选基点反证 | checks=22，failures=3（全部属 W8R2-01） |
| `b-save.mjs` | W8R1-02/03、AC-090 投影修复重试、AC-093 组合 hash 独立复算、W8R2-01 两段反证、W8R2-06 反证 | checks=38，failures=9（W8R2-01×7、W8R2-06×2） |
| `c-recovery.mjs` | W8R1-04（活进程停放、beginAttempt/resumeWork 拒绝、决策放行、确认已死放行）、租约单写者、AC-061/058/082 反证、W8R2-03 反证 | checks=31，failures=1（W8R2-03） |
| `d-settlement.mjs` | W8R1-06/08（直连 + recover 两路）、AC-063 ref 后崩溃/重放、AC-041 知识补丁 + 冷启动查询 + 非法知识 | checks=29，failures=0 |
| `e-backup.mjs` | AC-064 backup→新目录 restore、活动 Run 需恢复、租约/grant 回收、缺 Secret 阻断、W8R1-05 非仓库目标拒绝 + **同仓库另一真实副本** relocate 成功 | checks=23，failures=0 |
| `f-integration.mjs` | AC-081 血缘（含失效/缺冻结输入）、AC-062 冲突与修复任务、W8R1-07 完成门禁、AC-090/091 锁、W8R2-02 反证 | checks=30，failures=1（W8R2-02） |
| `g-flow.mjs` | AC-020 暂停恢复、AC-021 未知副作用取消、AC-022 预算原子拒绝、AC-029 初始化中断/冲突 | checks=33，failures=0 |
| `h-casthrow.mjs` | 候选 tree 读取失败时的 CAS 返回契约 | checks=2，failures=1（W8R2-04） |
| `i-cas-journal-crash.mjs` | journal 记录 target 与 ref 交换之间的崩溃重试（AC-090「在 Git CAS 前后注入退出并重试」） | checks=7，failures=2（W8R2-05） |

合计 **215 项断言，17 项失败**，全部归属 R2-5 的六条 finding（10 + 1 + 1 + 1 + 2 + 2）。

反证手法：
- **真实 Git 竞态注入**：包装 `CasJournal.save`，在 CAS「比较」之后、「交换」之前用真实 `update-ref` 移动交付 ref；包装 `WorktreeGitPort.updateRef` 在 ref 交换处抛出，模拟进程在 journal 记录 target 之后崩溃。
- **崩溃残留状态**：按默认 `keepWorktree=true` 的真实残留 worktree（停在旧基点）直接构造「提交后崩溃」现场，不依赖任何注入。
- **端口故障注入**：注入 `commitPaths` 首次失败（留下 worktree）、注入 `mergeTree` 失败、注入 `requirements` 投影写入失败。
- **状态机反证**：在恢复判定 `newAttemptAllowed:false` 之后，直接走产品自身的 `RunLifecycle.beginAttempt` / `FindingService.resumeWork` 尝试开新 Attempt；以及在**同一 Work 的另一 Run 的**恢复决策之后重读准入。
- **过期工作树**：detached worktree 提交后只 `update-ref`、不 checkout，制造「ref 领先工作树」的真实状态。

---

## R2-3. W8R1-01..08 收口逐条复核

| finding | 严重性 | 收口结论 | 独立证据 |
|---|---|---|---|
| W8R1-01 无候选版本时 CAS 用 `git commit` 推进交付分支 | P2 | **已关闭** | `a-cas` 15 项：无 `candidateRevision` → `VALIDATION_ERROR`、交付工作树无提交（`commitCount` 不变）、已暂存记录文件仍为未提交、无完成事件；竞争移动 → `VERSION_CONFLICT`、`actualRevision` 为竞争者、分支未动、无事件；成功路径一次 `update-ref` + 一条事件；同 operationId 重放 `reused:true` 且零新增事件。代码：`cas.ts:1386-1401`（候选必需）、`1578-1583`（唯一 ref 写入点） |
| W8R1-02 需求池读工作树而非目标修订 | P1 | **已关闭** | `b-save` 前 6 项：v2 由另一服务器提交并移动 ref、工作树仍 v1 时，带 v1 期望的保存被 `REQUIREMENT_CONFLICT` 拒绝；分支停在 v2、提交数不变、修订处 v2 正文完整。代码：`requirement-save.ts:1267`（按交付 ref 解析）、`1812-1816`（按 revision 比较）、`612-634`（`readBlobAt` 无 `readFileSync` 回退，`RequirementPoolGitPort.readBlob` 为必需端口） |
| W8R1-03 HEAD 独有记录抛未捕获 `ENOENT` | P1 | **已关闭** | `b-save`：`save()` 直接调用（不包 `expect`）未抛异常，返回 `REQUIREMENT_CONFLICT` 且消息含 `.agentdev/requirements/<id>`；分支未动。代码：`1135-1145`（外层 catch→`unexpectedFailure`）、`620-632`（读失败/缺 blob → 结构化 `INTERNAL_ERROR`/`REQUIREMENT_CONFLICT`）。另：正文变更确实改变组合 `recordHash`（提交字节独立复算 = `requirementRecordHash(sha256(metadataJson), sha256(normalize(content)))`） |
| W8R1-04 parked Run（旧进程存活）仍可开新 Attempt | P1 | **已关闭（含 1 条 P2 残余，见 W8R2-03）** | `c-recovery` 15 项：活进程 → park `interrupted` + `newAttemptAllowed:false`；`beginAttempt` 抛 `RECOVERY_REQUIRED`、Attempt 仍 1 条、Run 仍 `interrupted`、worktree 租约 0 行（未交给第二个 owner，且持有期间第二次 acquire 被拒）；`resumeWork` 返回 `RECOVERY_REQUIRED` 且不建 Attempt；判定**之后**的 `decision(kind='recovery',choice='resume')` 才放行（Attempt #2、epoch 1、租约恰好 1 个 owner）；确认已死直接放行；判定**之前**的决策不生效。代码：`recovery.ts:276-321`、`run-lifecycle.ts:118-131`、`findings.ts:1693-1705` |
| W8R1-05 relocate 先改根后体检、无回滚 | P2 | **已关闭（并用更强正例复验）** | `e-backup`：空目录 + `move:false` → `INVALID_STATE`、消息含「根映射未改写」，重开 store 断言 `root`/`gitRoot` 未变；随后 relocate 到**同仓库的另一真实 `git clone`**（不同目录、同 revision/tree、干净工作树）→ `ok:true`、映射改写、`doctor.ok`。代码：`recovery.ts:2114-2169`（先读记录绑定 → 校验目标 → 才改映射，失败回滚） |
| W8R1-06 结算完成后不清 `phase` | P3 | **已关闭** | `d-settlement`：直连 `settle()` 与 ref 后 `recover()` 两条路径均 `lifecycle==='completed'` 且 `phase===undefined`。代码：`settlement.ts:1252-1266` |
| W8R1-07 空变更集冒充代码验证、`codeStartRevision` 不被读取 | P3 | **已关闭** | `f-integration` 5 项：空变更集 → `GATE_NOT_READY`（消息含「变更集为空」）；`codeStartRevision===finalRevision` / `null` → `GATE_NOT_READY`；成功结果回报 `codeStartRevision`；metadata-only → `GATE_NOT_READY`。代码：`requirement-save.ts:853-878` |
| W8R1-08 `SettlementOutcome.tree` 两路径语义不同 | P3 | **已关闭** | `d-settlement` 6 项：直连与 recover 均 `commitTree===git rev-parse <rev>^{tree}`、`codeTreeHash===deliveredCodeTreeHash(...)`、二者互不相等；`settlement.completed` 事件与 `operation.stepResults` 同时带两字段；重放零新增事件、零新增提交 |

**结论：8/8 收口在代码与测试中均成立**，且 5 项必需失败测试独立复跑通过。

---

## R2-4. 逐 AC 结论（本轮指定切片）

| AC | 结论 | 证据要点 |
|---|---|---|
| AC-020 暂停恢复 | **passed** | 暂停关闭 live Attempt + 冻结写准入；恢复恰开 1 个新 Attempt，且在新 Attempt ready 前不放开写（`g-flow`） |
| AC-021 取消需求 | **passed** | 未知副作用 → `blocked(recovery)`、Requirement 保持 active、未集成；`accept_cancel` → cancelled、Requirement 落 cancelled、仍无写准入；已交付的先前提交不回滚（`g-flow`） |
| AC-022 预算止损 | **passed** | 超限 `BUDGET_EXCEEDED`、`tokensReserved` 仍 0、无 Artifact；限额内预留 60；第二次超限再拒且预留不变（`g-flow`） |
| AC-029 初始化冲突中断 | **passed** | 第 3 次写入中断 → `failed/interrupted` 且 `recoverable:true`、已写 2 份；新进程 `resume` 按 receipt 续写至 done 且不动交付 ref；用户自维护 `PROJECT.md` → `content-conflict`、字节原样保留、不再写后续文档、`resume` 拒绝（`g-flow`） |
| AC-041 知识结算 | **passed** | 补丁更新正文/入口/失效说明，只经 `applyKnowledgePatch` 发布；冷启动 `queryFeatureView(view=delivered)` 找到新行为与新入口；非法文档 `KNOWLEDGE_INVALID`、不发布、保留最后有效并标 stale（`d-settlement`） |
| AC-054 UI 断开 | **not_covered** | 属 WP-09（与 `implementation.md` T5 残余 9 一致） |
| AC-057 Runner 失联 | **passed（本包必验面）** | 租约过期轮转、旧 epoch/取消/新决定后结果拒绝并留诊断；本次重点的「旧进程未确认终止 ⇒ 不开新 Attempt / 不双写」在 `beginAttempt`/`resumeWork` 上成立。残余：W8R2-03（Work 级决策会一并解除其他 Run 的阻断） |
| AC-058 过期结果 | **passed** | 旧 epoch 成功被拒（`accepted:false`），`stage.result_rejected` 诊断持久保留（`c-recovery`） |
| AC-061 启动恢复 | **passed** | 新心跳 + 进程已死仍 park `interrupted`；等值/更旧 daemon epoch 被 `VERSION_CONFLICT` 围栏；host epoch 前进（`c-recovery`） |
| AC-062 集成冲突 | **passed** | 两已通过 Task 冲突 → `TASK_MERGE_CONFLICT`、HEAD 不动、无完成事件、独立修复 Task（依赖双方、`requiresFreshVerification:true`、`committed:false`、冲突产物 SHA256、确定性 id，重试同 id）；最终集成跳过已合并祖先且祖先只出现一次（`f-integration`） |
| AC-063 部分结算 | **passed** | ref 后崩溃 `recover` 复用提交、不新增提交、恰一条 `settlement.completed`；重放零新增事件（`d-settlement`） |
| AC-064 备份恢复 | **passed** | 新目录 restore 逐文件/逐 blob 哈希校验一致、tree 与知识工作树干净、活动 Run park `interrupted`（Attempt `lost`）、租约清零、grant 撤销、缺 Secret → `blocked` 且 `executionReady:false`；manifest 只存 secret 标识不含值（`e-backup`） |
| AC-081 Task 依赖输入 | **passed** | `dependencyRevision`/`dependencyManifestRefs` 精确；未记录冻结输入或缺 manifest ref → `GATE_NOT_READY`；祖先 revision 变化 → `STALE_ARTIFACT`+`invalidated`；最终集成不重复应用祖先（`f-integration`） |
| AC-082 重启保留窄范围 | **passed** | 冻结 DispatchSnapshot 的窄 Scope 在恢复后保持、Work 宽范围标 `workScopeIgnored`；范围外路径/操作拒绝；快照缺失 `STALE_ARTIFACT`（`c-recovery`） |
| AC-090 需求保存时机 | **passed（正常/重试/投影修复路径）** | 保存报告 branch/ref/commit/previousCommit/未推送状态；投影失败 → `RECOVERY_REQUIRED`（`branchUntouched:false`、`repairOnly:true`），重试 `projection_repaired`、复用同一提交、无第二提交、无第二事件。**残余：W8R2-05**（journal 记录 target 与 ref 交换之间的崩溃无法用同一 operationId 恢复） |
| AC-091 崩溃与交付竞争 | **partial** | metadata-only 不冒充代码验证、旧基线交付与新需求池共存的正例均通过；但**代码交付路径并不取得共享集成锁**（W8R2-02，实测持锁时 `runIntegration` 照常推进 ref），且保存重试路径存在 W8R2-01 的静默丢弃 |
| AC-093 目录与正文一致性 | **passed** | 两文件共享版本、组合 `recordHash` 由提交字节独立复算吻合、正文变更递增版本且 hash 改变、半对记录在 CAS 前被拒、分支不动、无事件（`b-save`、`a-cas`）。残余：W8R2-06（写回工作树无脏检查） |
| AC-094 需求正文保存与并发 | **passed（读取源）/ P1 于崩溃重试** | 「陈旧工作树不得覆盖新记录」已成立（W8R1-02 关闭）；但崩溃重试会丢弃交付分支上的新提交（W8R2-01） |

---

## R2-5. 新发现（W8R2-xx）

### W8R2-01（P1，阻断）— 崩溃重试复用陈旧 save worktree，且 CAS 不校验候选基点，静默把交付分支回退到旧基线（丢弃已集成提交）

- **位置**：`packages/core/src/requirement-save.ts:1913-1917`（`prepareWorktree` 只要路径相同就直接复用 worktree，从不校验其 HEAD 是否等于 `baseRevision`；`worktreePathFor` = `<worktreeRoot>/<operationId>`，见 `2133-2135`）；`packages/core/src/requirement-save.ts:1093`（`keepWorktree = options.keepWorktree ?? true`，**默认保留**残留 worktree）；`packages/workspace/src/cas.ts:1560-1602`（`integrate()` 只用 `update-ref <ref> <new> <old>`，**从不校验 `candidateRevision` 是否为 `expectedRevision` 的后代**，`isAncestor` 只出现在 `prepareDependencies`，`cas.ts:658`）。
- **复现**（两种，均真实 Git + 真实 SQLite）：
  1. `node /tmp/wp08r2/b-save.mjs`「W8R2 stale-basis」段：默认 `keepWorktree` 下，`op-rx-2` 的 `commitPaths` 首次失败 → worktree 留在旧基点；随后一个代码交付把 `agentdev/main` 推进到 `b2`（`src/orders.ts = ["integrated"]`）；用同一 operationId 重试保存 → **返回 `status:'saved'`**，`ref` 变成该重试的新提交，`b2` 不再是分支祖先，`src/orders.ts` 回退为 `[]`，工作树同样回退。
  2. 同脚本「W8R2b」段（**零注入**）：直接构造崩溃残留现场（`<dataDir>/save-worktrees/op-crash-2` 停在基点 `b1`），再让代码交付推进 ref，然后调用 `save()` → 同样 `saved` 且丢弃 `delivery` 提交。
  3. CAS 层最小反证 `/tmp/wp08r2/a-cas.mjs`「W8R2 candidate-basis」段：`expectedRevision=b2`（ref 当前值）而 candidate 由旧基点提交 → `integrate()` 返回 `ok:true`、发 1 条完成事件、`b2` 从分支消失。
- **观测 vs 期望**：观测 = 交付 ref 静默丢弃已集成提交、`src/` 源码回退、调用方得到「已保存」；期望 = `reliability.md` §4 步骤 2/8（候选必须由 `expectedRevision` 生成，ref 仅由 `update-ref` 按 expected-old 移动）与 AC-090/AC-091「重试不产生重复提交、不静默丢内容」；`reliability.md` §2/§4 也要求集成建立在捕获的 `expectedHead` 之上。
- **契约/AC 条款**：AC-090、AC-091、AC-094、AC-062（CAS 保护 HEAD）、`reliability.md` §4/§5。
- **修复方向**：① `cas.integrate()` 在交换前要求 `git merge-base --is-ancestor <expectedRevision> <candidateRevision>`（或校验候选 tree 含 expected 的非池路径），不成立返回 `STALE_ARTIFACT`；② `prepareWorktree` 对已存在的 worktree 校验 HEAD/基点，不等于 `baseRevision` 时拒绝或 `reset --hard <baseRevision>` 后使用；③ `keepWorktree` 默认改为 `false`，或把复核基点作为复用的前置条件；④ `packages/workspace/src/worktree.ts:785-813` 的 `WorktreeManager.create` 也用路径复用而非基点校验，应一并收紧。

### W8R2-02（P2）— 代码交付路径不取得 Project 集成锁（AC-091 的「保存与交付同一把锁」只有一半）

- **位置**：全仓 `ProjectIntegrationLock|integrationLockResource` 只在 `packages/core/src/requirement-save.ts:1122`（`save()` 取锁）出现；`packages/workspace/src/cas.ts:1085`（`runIntegration` → `cas.integrate`）与 `packages/core/src/settlement.ts:1027`（`settle`）没有任何取锁调用（`grep -rn "ProjectIntegrationLock" packages/*/src apps/*/src` 除 requirement-save 外为空）。
- **复现**：`node /tmp/wp08r2/f-integration.mjs`「W8R2 lock scope」段：先让 `lock.acquire({ownerAttemptId:'save-op'})` 成功（模拟需求保存持锁），随后调用真实 `runIntegration()` → `ok:true` 且交付 ref 被推进。
- **观测 vs 期望**：观测 = 持锁期间代码交付照常集成并移动 ref；期望 = AC-091 Given「需求保存与代码交付共享 Project 集成锁」、`implementation.md` T2「`ProjectIntegrationLock`（共享资源 `integration:<projectId>`，需求保存与代码交付同一把锁）」。产品测试 `wp08.integration.test.ts:1601` 的「delivery takes the lock first」是**手工** `d.lock.acquire(...)`，并不构成「交付路径取锁」的证据。
- **影响**：不造成数据丢失（CAS expected-old 会拒绝其一并保留候选）；但保存与交付之间的互斥、以及「新代码提交自动包含最新需求池」的时序保证在实现层缺失，二者只能靠 CAS 冲突后重新集成。
- **修复方向**：把集成锁下沉到交付入口（`runIntegration`/`SettlementService`）或由 daemon 的集成命令事务持有 `integration:<projectId>`；同时把产品测试改为验证交付路径自身取锁（当前为手工取锁）。

### W8R2-03（P2）— 新 Attempt 准入是「Work 级决策」而非「Run/判定级」，一条写给别的 Run 的 resume 决策会解除本 Run 的活进程阻断

- **位置**：`packages/core/src/recovery.ts:292-310`（解除阻断只按 `work_id = ? AND kind='recovery'` + `choice='resume'` + `created_at > verdict.occurredAt` 查找，不绑定 `runId`/`verdictEventId`）。
- **复现**：`node /tmp/wp08r2/c-recovery.mjs`「W8R2 sibling-decision scope」段：同一 Work 的两个 Run——Run A 记录一条恢复决策（对应 Work 级取消/恢复），Run B 因**自身进程存活**被 park `interrupted`（`newAttemptAllowed:false`）；在 B 的判定之后插入该决策 → `newAttemptAdmission(runIdB) = {allowed:true, resolvedByDecisionId:<A 的决策>}`，`beginAttempt` 放行。
- **观测 vs 期望**：观测 = 「旧进程未确认终止」的 Run 因一条并非针对它的恢复决策而获得新 Attempt；期望 = AC-057「无重复副作用或双写者」、`reliability.md` §2「旧进程未确认终止时不把工作区授予新写者」、`workflow.md` §5.1「所有适用阻断关闭才恢复」。W8R1-04 的执行侧闸门是真实存在的，但准入规则的范围过宽。
- **修复方向**：把决策与判定绑定（决策 `targetRef.id` = runId 或持久化 `verdictEventId`），或要求 Work 内**每个**被阻断 Run 都有一条晚于其判定的 resume 决策；至少在 `NewAttemptAdmission` 返回 `resolvedByDecisionId` 时校验该决策覆盖本 Run。

### W8R2-04（P3）— `createCasService().integrate()` 在候选 tree 不可读时抛异常而非返回拒绝（`settle()` 无 catch）

- **位置**：`packages/workspace/src/cas.ts:1562-1564`（`requireGit(git.mergeTree(...), 'INTERNAL_ERROR', …)` 抛出 `WorkspaceError`，不在任何 try/catch 内），而 `integrate` 的返回类型是 `CasOutcome`；`packages/core/src/settlement.ts:1027` 直接调用且未捕获。
- **复现**：`node /tmp/wp08r2/h-casthrow.mjs`（注入 `mergeTree` 失败）→ `threw = WorkspaceError: 读取候选 tree 失败…`，`outcome = null`；ref 未被污染。
- **观测 vs 期望**：观测 = 公共 API 抛出未声明异常；期望 = 与同函数其他失败一致返回结构化 `INTERNAL_ERROR` 拒绝（`settle()` 的返回类型同样是结果联合）。
- **修复方向**：把该处改为 `const tree = git.mergeTree(...); if (!tree.ok || tree.value === null) return refusal('INTERNAL_ERROR', …)`；或给 `settle()` 加与 `save()` 等价的外层 catch。

### W8R2-05（P2）— CAS journal 已记录 target、ref 尚未交换这一崩溃窗口无法用同一 operationId 恢复（「Git commit 存在则复用」未实现）

- **位置**：`packages/core/src/requirement-save.ts:1273-1290`（`repairOnly` 要求 `journal.targetRevision === headRevision`，即 ref **已经**移动；ref 未移动时走普通路径）、`1913-1917`（复用停在候选提交上的残留 worktree，导致再次 `git commit` 无内容可提交）、`packages/workspace/src/cas.ts:1502-1511`（journal 已有 `targetRevision` 且与本次候选不同 → `IDEMPOTENCY_CONFLICT`）。对照：`packages/core/src/settlement.ts:1124-1153` 对 `recover()` 实现了「ref 未移动则用 journal 候选完成交换」，需求保存侧没有等价路径。
- **复现**：`node /tmp/wp08r2/i-cas-journal-crash.mjs`（在 `updateRef` 处抛出，模拟进程崩溃；journal 已写 `targetRevision`，ref 仍在基线）：重试同 operationId 且正文一致 → `INTERNAL_ERROR: 需求保存提交失败`；正文略变 → `IDEMPOTENCY_CONFLICT: operationId … 已提交 <C1>，与本次候选 <C2> 不一致`。两条路径下 ref 都停在基线，journal 里的提交永远不会被安装；该 operationId 永久卡住。
- **观测 vs 期望**：观测 = 崩溃点之后无法恢复、且会再产生一个游离提交；期望 = `reliability.md` §5「崩溃重启逐步核对：Artifact 存在且 Hash 一致则复用；Git commit 存在则复用；ref 已指向目标则补记完成」、AC-090/AC-091「在 Git CAS 前后注入退出并重试」、WP-08 退出条件「部分提交恢复不重复执行」。
- **修复方向**：在 `RequirementSaveService` 增加与 `settlement.recover()` 对称的分支：`journal.state==='pending' && journal.targetRevision !== undefined && headRevision === journal.expectedRevision` ⇒ 直接用 journal 的候选调用 CAS 完成交换并补投影（不得新建提交）；同时让 `prepareWorktree` 在基点不符时先复位（与 W8R2-01 同源）。

### W8R2-06（P3）— 保存路径无条件把提交字节写回交付工作树，未提交的本地编辑被静默替换（AC-028 的脏工作区保护未覆盖该路径）

- **位置**：`packages/core/src/requirement-save.ts:1965-1973`（`refreshWorkingTree` 无条件 `writeRecord(repoRoot, …)`，`writeRecord` 见 `1951-1955`），调用点 `1429`；全路径没有 `statusPorcelain` 脏检查。
- **复现**：`node /tmp/wp08r2/b-save.mjs`「W8R2-06」段：v1 保存后手工改写 `.agentdev/requirements/<id>/content.md`（未提交，`git status` 可见），再以 v2 正文保存 → 磁盘文件变为 v2 的 API 正文，本地编辑消失，结果仍为 `status:'saved'`。
- **观测 vs 期望**：观测 = 未提交本地内容被覆盖且无任何诊断；期望 = AC-028「用户文件未提交 ⇒ 保留数据并阻断到明确处置」（至少对将被覆盖的具体路径给出门禁或诊断）。
- **修复方向**：写回前对目标路径做 `statusPorcelain` 校验（脏则拒绝或先让用户处置/备份差异），或改为只更新索引/工作树的“干净子集”，并对被覆盖的差异写出诊断事件。

---

## R2-6. 计数与阻断表

| 项 | 数量 |
|---|---|
| 独立探针脚本 | 9 |
| 独立探针断言 | 215 |
| 失败断言 | 17（W8R2-01×10、W8R2-02×1、W8R2-03×1、W8R2-04×1、W8R2-05×2、W8R2-06×2） |
| P0 | 0 |
| P1 | 1（W8R2-01） |
| P2 | 3（W8R2-02、W8R2-03、W8R2-05） |
| P3 | 2（W8R2-04、W8R2-06） |
| 阻断 finding | 1（W8R2-01） |
| W8R1 收口复核 | 8/8 已关闭 |
| 五项必需失败测试 | 5/5 通过（独立复跑） |
| 契约命令 | 6/6 退出码 0 |

| 门禁问题 | 结果 |
|---|---|
| 契约命令是否全绿 | 是（typecheck/lint/unit 971/integration 215/docs:check/build 10） |
| W8R1-01..08 是否真正收口 | 是（逐条独立探针 + 代码位置复核） |
| 声明与代码是否一致 | 否（T2「需求保存与代码交付同一把锁」不成立 → W8R2-02；T1「候选由调用方提供 + 仅 update-ref 移动 ref」成立，但**缺少候选基点校验** → W8R2-01） |
| 是否存在未登记的水平缺口 | 是（W8R2-01/02/03/05/06 未登记；W8R2-04 未登记） |
| 是否存在阻塞缺陷 | 是（1 × P1） |

**能否进入独立 Test：否（阻塞）。** 依据 `docs/rules/workflow.md`：P0/P1 阻断，须走 `Develop → 新独立 Review → Test`。建议优先级：W8R2-01（P1，静默丢弃已集成提交；修 CAS 基点校验 + worktree 基点校验/默认不保留）→ W8R2-05（同一崩溃家族的恢复路径）→ W8R2-02（把集成锁落到交付入口）→ W8R2-03（决策与判定/Run 绑定）→ W8R2-04/06。修复后代码树哈希必然变化，需重做一轮独立 Review 才能进入 Test。

---

## R2-7. 记录对账（`implementation.md` T1..T6 与代码）

**准确的部分**

- T5 的命令数字与本次独立复跑完全一致：unit 48 文件/971 用例、integration 20 文件/215 用例、build 10 workspace、docs:check ok；逐文件用例数与 T6 列举一致（见 R2-1）。
- T6 的 8 条修复描述与代码一一对应：`cas.ts:1386-1401`（候选必需）、`requirement-save.ts:1267/1812-1816/612-634`（按 ref 与 revision 读取）、`1135-1145`（`save()` 不抛异常）、`recovery.ts:276-321` + `run-lifecycle.ts:118-131` + `findings.ts:1693-1705`（准入闸门）、`recovery.ts:2114-2169`（relocate 先校验后改根 + 回滚）、`settlement.ts:1252-1266`（清 `phase`）、`requirement-save.ts:853-878`（空变更集/空范围拒绝）、`settlement.ts` 的 `commitTree`/`codeTreeHash` 双字段（`972-983`、`1050-1062`、`1102-1123`、`1283-1287`、`1307-1308`）。
- T6 记录更正项与代码一致：CAS 描述已改为「安装调用方提供的候选提交」（`cas.ts:1554-1560`）；失实注释已删除，改述为按交付 ref 修订读取（`requirement-save.ts:605-611`）；`SettlementOutcome` 双字段与事件同步（`settlement.ts:1283-1287`）。
- T5 残余核对：1（`WorktreeLeaseStore` 未落 `lease` 表——`worktreeLeaseResource` 在 product 源码中无消费者）属实；2（无生产 SQLite `CasJournal`/`CasEventPort` 实现，只有 `createMemoryCasJournal`）属实；3（`createRepairTask` 仅在 `cas.ts:892` 内部使用，无 Artifact 落库与派发）属实；4（备份只存 secret 标识，本次 AC-064 探针确认 manifest 不含值）属实；5（`apps/` 下 `backupProject|restoreProject|relocateProject|recoverAfterRestart` 零引用）属实；6（`packages/workspace/src/backup.ts` 不存在）属实；7（`parseRunnerPid` 对容器/远端标识返回 `null` 并按不可确认 fail-closed）属实；9（AC-054 属 WP-09）属实。
- T6 末尾登记的两条边界属实：解除阻断目前只认 `decision(kind='recovery',choice='resume')`（CLI/BFF 入口未接线），以及 `interrupted` 不在 `RESUMABLE_STATUSES`（`recovery.ts:214-219`）因而不会被后续 `recoverAfterRestart` 重新核对（已 park 者不重复处理）。后者是**已如实披露的 fail-closed 代价**，不计为新 finding，但意味着「旧进程事后确认已死」也必须靠一条人工决策放行。

**不准确/未登记的部分**

- T2「`ProjectIntegrationLock`（共享资源 `integration:<projectId>`，需求保存与代码交付同一把锁）」：代码侧只有需求保存取锁，交付路径无取锁调用（W8R2-02）。
- T1/`cas.ts` 模块头「CAS 保护 HEAD / 候选由调用方提供」：缺少候选基点（后代）校验，因而在崩溃重试场景下不保护已集成提交（W8R2-01）。
- 未登记的缺口：requirement save 的 worktree 基点复用与 `keepWorktree` 默认保留（W8R2-01）、journal 已记 target 而 ref 未交换的恢复缺口（W8R2-05）、准入决策的 Work 级范围（W8R2-03）、`integrate` 的抛异常路径（W8R2-04）、写回工作树无脏检查（W8R2-06）。

---

## R2-8. 覆盖限制

1. **AC-054 不可在本包验证**：BFF/浏览器断开与水位同步属 WP-09，本包无 HTTP/WS 接线，故 `not_covered`（与记录一致）。
2. **AC-083 仅间接覆盖**：document 路线与无 `taskId` 的 Finding 关闭由 `wp08.integration.test.ts` 断言并通过；本轮未另写独立探针验证 Finding 目标绑定/`manifestId` 的数据库约束。
3. **UI/接线层未验证**：AC-090/091 的分支、提交、未推送状态只在 `RequirementSaveService` 返回结构层验证；`apps/cli`/`apps/daemon` 与 BFF/UI 接线按 T5 残余 5 尚未落地，因此本报告的 W8R2-01/05 是**服务 API 层**的可复现缺陷（按 AC-090/091 的文档用法即可触发），不是端到端 CLI 演练。
4. **容器与环境**：WP-08 不需要 Docker；`pnpm test:integration` 中的容器用例在本机通过，但非本包重点，未做额外反证。
5. **并发时序**：除 CAS 读后写、锁竞争与准入判定外，未做多进程并发压测；AC-091 的并发验证在单进程内以真实 SQLite + 真实 Git 状态观测完成。
6. **备份范围**：未验证 `.agentdev/work` 等本机过程目录在“未提交”状态下的备份（实现只复制 DB、`blobs`、`documentRoot` 知识树与 git bundle）；`knowledge.treeHash` 被记录但 restore 只逐文件校验、未重新汇总该 aggregate（弱校验，未构成 AC 失败）。
7. **Secret**：按设计只验证“缺 Secret 阻断”与“清单不含值”，未演练 secret 的加密导出/导入（T5 残余 4）。
8. **ref 交换前崩溃的覆盖**：W8R2-05 以“在 `updateRef` 处抛出”等价模拟进程在该窗口死亡，未使用真实 `SIGKILL`（同一可观测状态）；其余崩溃点（提交后、ref 后）由产品测试与 `d-settlement`/`i-cas-journal-crash` 交叉覆盖。
9. **一次性工具副作用披露**：本轮未使用子代理、未在仓库根写入任何临时文件；唯一写入为本报告追加，`git status --porcelain` 除该文件外为空。

---

## R2-9. 结论

W8R1-01..08 的八条修复**全部真实收口**：本轮用独立探针（真实临时仓库 + 真实 SQLite，215 项断言）逐条复现了正确行为，五项必需失败测试独立复跑通过，六项契约命令全绿，`implementation.md` T6 的记录在修复范围内与代码一致。但本轮新发现 **1 项 P1**：崩溃重试会复用停在旧基点的 save worktree，而 CAS 不校验候选是否为 `expectedRevision` 的后代，于是交付分支被静默回退到旧基线、已集成提交（含源码改动）被丢弃，调用方仍收到 `status:'saved'`（两段独立复现，其中一段零注入）。另有 3 项 P2（交付路径不取集成锁、准入决策的 Work 级范围、journal 与 ref 之间的崩溃窗口不可恢复）与 2 项 P3（`integrate` 抛异常路径、写回工作树无脏检查）。

**判定 FAIL，不允许进入独立 Test**；须 `Develop → 新独立 Review → Test`。修复 W8R2-01（及同源的 W8R2-05）后，本报告的 §R2-3 收口结论仍可作为下一轮的起点，但 R2-5 的 finding 需逐条复核关闭。

---

# WP-08 独立 Review 报告（第三轮：W8R2-01..06 收口复核与回归搜寻）

## R3-0. 元数据（round 3）

| 项 | 值 |
|---|---|
| 工作包 | WP-08 集成、结算与恢复 |
| Review 角色 | 独立 Review（独立上下文；未读取任何开发/Test 聊天或会话） |
| 轮次 | 第三轮（复核 round 2 的 6 条 finding 收口 + 新缺陷搜寻） |
| 冻结提交 | `7b0fd20`（task-issued freeze point） |
| `git rev-parse HEAD` | `7b0fd200a1cdbc8bc637126d5a7df8a55a95ebdc` |
| `git rev-parse 7b0fd20^{tree}` | `cc350c5232c63e669eda24c0e52eb7f39ec3344d` |
| `git status --porcelain` | 空（唯一变更为本报告尾部追加；追加前工作树无任何修改） |
| 平台 | macOS arm64，Node v24.8.0，pnpm 12.3.4，真实 `git`，真实 SQLite（`node:sqlite`，经 `ProjectStore`/`LeaseStore`） |
| 探针目录 | `/tmp/wp08r3/`（只消费 `packages/*/dist` 构建产物，从不 import 产品测试文件） |
| 判定 | **PASS**（0 × P0、0 × P1；6 条非阻断 finding：3 × P2、3 × P3） |
| round 1–2 保留 | §0–§10 与 R2-0–R2-9 逐字保留（追加前 70939 字节，SHA256 `808af3eb266aa8833a1fcfe571ff3a3ea032066d178786e9e9a94ccc84506157`）；本轮仅追加，删除计数为 0 |
| 一次性工具副作用 | 本轮未使用任何子代理；仓库内唯一写入为本报告追加，`git status --porcelain` 除该文件外为空 |

### 受审文件哈希（SHA256，冻结提交 `7b0fd20` 实际内容）

```
d1cf229740c46f9cf3fdea9c8ba833ae48851bfb54b51f373ff5adfcd4344f04  packages/workspace/src/worktree.ts
a2d0215e94559743dddc7f2717198e0bc22e6de0835e802d4c9108420c9a23fe  packages/workspace/src/cas.ts
d0f772b9c4b5d8cac09e69ef4ddba22eab272877772937fa1f5359acdb197c34  packages/core/src/requirement-save.ts
05ddb9d9ef75b2076968345dedfe8dd501ad7fe0f464cbf3a36f82a3eee43941  packages/core/src/recovery.ts
cc9f340b80d26c932a8498de2fada40c8a2c4585a7b80d1c7d43be8eff2e82e9  packages/core/src/settlement.ts
0c3d24d7befa8b81377b804e9dadf182a17f626057ff97d708687ba333a23821  packages/workspace/test/worktree.test.ts
d6e9cf2a50694604168d9ebf762c1e045484af6b01040d6b5cece5bc0eaf544c  packages/workspace/test/cas.integration.test.ts
5d9bc87b2e20cac4f81cd4bdda43146e8c228e187e0a39d34d2d5bdfaec5d7cc  packages/core/test/recovery.test.ts
a6ebb5952f1b9ccca9399497c8ec3f120db3069df4e14dde4dd52139758d2174  packages/core/test/requirement-save.integration.test.ts
d247ad24452368a3c1341e0be0c5722f6cfab2fe9921b269e7f2a3925619ff7f  packages/core/test/settlement.integration.test.ts
605d9974a878237ba8a1e9b684e9bb7afdec24c88b983f955cb410a273f6209a  packages/core/test/wp08.integration.test.ts
3950267f68c8681b3c44f46fe3ce6db387af1cf0cf16a172451361eace46f8f1  packages/core/test/wp08-failures.test.ts
```

### 已加载依据

`AGENTS.md`、`docs/INDEX.md`、`docs/rules/{workflow,agents}.md`、`docs/architecture/{reliability,data,execution}.md`、`docs/product/{knowledge,requirements}.md`、`docs/delivery/acceptance.md`（AC-020/021/022/029/041/054/057/058/061/062/063/064/081/082/083/090/091/093/094）、`docs/delivery/implementation.md`（WP-08）、`.agentdev/work/WP-08/{plan,implementation,review}.md`（T7 与 round 1–2 报告），以及 `7b0fd20` 的受审源码与回归网。
刻意排除：任何开发/Test 会话或聊天、`webui/`、历史任务记录。

---

## R3-1. 契约命令原始结果（`7b0fd20` 工作树根目录，顺序执行）

日志全文 `/tmp/wp08r3/contract.log`；`EXIT_CODE` 为真实退出码。

| # | 命令 | 退出码 | 原始结果（关键行） |
|---|---|---|---|
| 1 | `pnpm typecheck` | 0 | `tsc -p tsconfig.json --pretty false`，无输出（real 1.30s） |
| 2 | `pnpm lint` | 0 | `Checking formatting...` / `All matched files use Prettier code style!`（real 15.32s） |
| 3 | `pnpm test:unit` | 0 | `Test Files 48 passed (48)` / `Tests 973 passed (973)`，Duration 11.42s |
| 4 | `pnpm test:integration` | 0 | `Test Files 20 passed (20)` / `Tests 222 passed (222)`，Duration 69.35s（含真实容器用例） |
| 5 | `pnpm docs:check` | 0 | `docs:check ok — 15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages` |
| 6 | `pnpm build` | 0 | `Done` ×10：contracts、domain、knowledge、storage、workspace、core、pi-runtime、cli、daemon、runner（real 2.98s） |

**WP-08 相关测试文件逐文件用例数（本轮独立复跑，与 `implementation.md` T7 声明逐项吻合）**

| 文件 | 用例数 | 文件 | 用例数 |
|---|---|---|---|
| `workspace/test/worktree.test.ts` | 11（T6 后 +1） | `core/test/settlement.integration.test.ts` | 11（+1） |
| `workspace/test/cas.integration.test.ts` | 17（+2） | `core/test/wp08.integration.test.ts` | 12（改写，数目不变） |
| `core/test/recovery.test.ts` | 19（+1） | `core/test/wp08-failures.test.ts` | 5 |
| `core/test/requirement-save.integration.test.ts` | 19（+4） | | |

**五项必需失败测试**（`pnpm vitest run --project unit packages/core/test/wp08-failures.test.ts`）：`Tests 5 passed (5)` —— `Task 合并冲突` / `CAS 失败` / `ref 后崩溃` / `取消未知副作用` / `备份演练` 全部通过（日志 `/tmp/wp08r3/slice.log`）。

**代表性 AC 切片**（`/tmp/wp08r3/slice.log`，与探针结果互为交叉验证）：`wp08.integration.test.ts` 12/12（AC-029/041/081/083/091/020/021/022）、`cas.integration.test.ts` 17/17（AC-062/081/094 与 W8R1-01/W8R2-01/W8R2-04 回归）、`requirement-save.integration.test.ts` 19/19（AC-090/091/093/094）、`settlement.integration.test.ts` 11/11（AC-041/063 与 W8R2-02 锁）、`recovery.test.ts` 19/19（AC-057/058/061/082）。

---

## R3-2. 方法

7 个脚本位于 `/tmp/wp08r3/`，全部通过 `packages/*/dist/index.js` 消费**构建产物**；真实临时 Git 仓库（`worktree add` / `commit` / `update-ref` / `cherry-pick` / `fetch` / `reset --hard` / `checkout`）与真实 SQLite（`ProjectStore` + `LeaseStore`）承载集成状态；脚本自实现断言与故障注入，从不 import 任何产品测试文件。

| 脚本 | 覆盖 | 结果 |
|---|---|---|
| `a-cas-basis.mjs` | W8R2-01 CAS 层（非后代候选拒绝、正常后代路径、重放、无候选、无关历史、等值候选） | checks=20，failures=0 |
| `b-save-rewind.mjs` | W8R2-01 save 层（陈旧 worktree 复位、注入失败后的重试）、W8R2-06 脏写回、AC-090/AC-093 切片、锁释放、**W8R3-03 反证** | checks=47，failures=2（W8R3-03） |
| `c-lock.mjs` | W8R2-02（交付自身取锁、结算/恢复取锁、失败释放、跨实例同资源）、**W8R3-05/06 反证** | checks=25，failures=0（2 项为阳性反证） |
| `d-admission.mjs` | W8R2-03（Run/verdict 绑定、兄弟 Run、Work 级、时序、已确认死亡）、**W8R3-04 反证** | checks=18，failures=1（W8R3-04） |
| `e-journal.mjs` | W8R2-05（崩溃窗口同正文恰好一次、改正文精确冲突、随后原正文可完成）、**W8R3-01 反证** | checks=23，failures=3（W8R3-01） |
| `f-struct.mjs` | W8R2-04（CAS 结构化拒绝 ×2、settle 结果联合、ref 后抛异常走恢复） | checks=16，failures=0 |
| `h-hunt.mjs` | **W8R3-02 反证**、抛异常时的锁释放、依赖血缘、完成事件唯一性 | checks=11，failures=0（1 项为阳性反证） |

合计 **160 项断言，6 项失败**，全部归属本轮 3 条 finding（W8R3-01 ×3、W8R3-03 ×2、W8R3-04 ×1）；W8R3-02/05/06 以「阳性反证」形式记录（反证成立即 PASS）。原始输出保存为 `/tmp/wp08r3/*.out`。

反证手法：
- **真实 Git 基点伪造**：用 `git worktree add <path> <old-base>` + `commitPaths` 造出「停在旧基点的候选」，再以真实 `update-ref` 推进交付分支，观察 CAS 是否接受陈旧候选。
- **崩溃残留现场（零注入）**：直接在 `<dataDir>/save-worktrees/<op>` 停放一个旧基点 worktree，再用真实提交推进 ref，随后用同一 operationId 重试。
- **锁竞争**：真实 SQLite `lease` 行 + `ProjectIntegrationLock` 持锁，分别在 `runIntegration`、`SettlementService.settle/recover` 上观测 `BUSY` 与释放。
- **准入反证**：同一 Work 两个 Run 各自因真实进程探针存活被 park，分别写 Run 级 / verdict 事件级 / Work 级 / 兄级恢复决策后重读 `newAttemptAdmission` 与 `RunLifecycle.beginAttempt`。
- **崩溃窗口**：包装 `NodeWorktreeGitPort.updateRef` 抛出，模拟进程在 journal 记录 target 之后、ref 交换之前死亡；随后同操作重试。
- **端口故障注入**：`mergeTree` 失败、`isAncestor` 失败、`cherry` 抛异常、`integrate` 前后抛异常、把写回目标路径变成目录以触发真实 `EISDIR`。

---

## R3-3. W8R2-01..06 收口逐条复核

| finding | 严重性 | 收口结论 | 独立证据 |
|---|---|---|---|
| W8R2-01 陈旧候选静默回退交付分支 | P1 | **已关闭** | `a-cas-basis` 20 项：正常后代候选一次 `update-ref` + 一条完成事件 + 重放零新增（A1）；非后代候选 `STALE_ARTIFACT`、分支停在已集成提交、该提交仍是祖先、`src/orders.ts` 内容未回退、无完成事件、journal 未被污染，随后同 operationId 用真后代候选仍成功（A2）；等值候选被接受为 no-op、无关历史候选结构化拒绝且分支不动（A3）。`b-save-rewind`：手工停放旧基点 save worktree 后让真实交付推进 ref，重试 `saved` 且**只多 1 个提交**、交付提交仍是祖先、集成源码仍在（B2）；注入 `commitPaths` 首次失败（`keepWorktree:true`）后同样前移（B2b）。代码：`cas.ts:1667-1691`（`merge-base --is-ancestor`，失败/非后代分别 `INTERNAL_ERROR`/`STALE_ARTIFACT`）、`requirement-save.ts:2186-2199`（复用前 `resetHard` 到 `baseRevision`）、`requirement-save.ts:1136`（`keepWorktree` 默认 `false`）、`worktree.ts:815-830`（`WorktreeManager.create` 复用即复位） |
| W8R2-02 交付路径不取共享集成锁 | P2 | **已关闭** | `c-lock` 25 项：持 `integration:<projectId>` 时 `runIntegration` 返回 `BUSY`（含 `heldBy`）、分支停在基线、零事件，释放后同一交付 `integrated` 且提交含任务改动（C1）；`settle` 与 `recover` 双双 `BUSY`、ref 未动、无 `settlement.completed`，释放后结算完成且恰一条事件、并把锁还给他人（C2）；结构化失败与**抛异常**两种失败后锁都空闲，后续交付仍成功（C3/H2，`cas.ts:967-993` 的 `try/finally`）；独立实例持同一 SQLite 资源时保存与交付都 `BUSY`（C4）。代码：`cas.ts:904`（`lock` 必填）、`settlement.ts:1049-1074` 与 `1160-1179`（settle/recover 取锁 + `1075`/`1180` 的 `recoverUnderLock` 不重入） |
| W8R2-03 准入决策是 Work 级 | P2 | **已关闭（含 1 条 P3 残余 W8R3-04）** | `d-admission` 18 项：同 Work 两 Run 均因活进程 park，写给 Run A 的 resume 决策只放行 A，Run B 仍 `RECOVERY_REQUIRED`、`beginAttempt` 抛错、Attempt 仍 1 条、状态仍 `interrupted`；改用 Run B 的 `verdictEventId` 作为 `targetRef.id` 才放行 B 并开出 Attempt #2/epoch 1（D1）；Work 级决策不再解除任何 Run（D2）；判定之前的 Run 级决策无效（D3）；确认已死无需决策直接放行（D4）。代码：`recovery.ts:298-313`（`targetRef.id === runId \|\| === verdict.eventId`） |
| W8R2-04 `integrate()` 抛异常、`settle()` 无 catch | P3 | **已关闭** | `f-struct` 16 项：注入 `mergeTree` 失败 → `integrate` 不抛、返回 `INTERNAL_ERROR` + diagnostics + `branchUntouched`，ref 未动、零事件（F1）；注入 `isAncestor` 失败 → 同样结构化拒绝（F2）；CAS 在 ref 前抛异常 → `settle` 返回结构化 `INTERNAL_ERROR`（F3）；CAS 在 ref 后抛异常 → `settle` 走 `recoverUnderLock` 完成结算、恰一条事件（F4）。代码：`cas.ts:1720-1740`、`settlement.ts:1088-1090` |
| W8R2-05 journal 已记 target、ref 未交换不可恢复 | P2 | **已关闭（含 1 条 P2 残余 W8R3-01）** | `e-journal`：在 `updateRef` 处崩溃后 journal `pending` + `targetRevision`、ref 仍在基线、零事件；同正文重试 `saved` 且 `git.commit === journal`、分支只多 1 个提交、恰 1 条 CAS 完成事件 + 1 条 `requirement.saved`；再重放 `projection_repaired` 且零新增（E1）；改正文重试 `IDEMPOTENCY_CONFLICT`，消息含 operationId、recorded revision 与 recordHash，ref 未动，随后用原正文仍能完成（E2）。代码：`requirement-save.ts:1339-1358` + `1675-1705`（`installJournaledCommit`）、`cas.ts:1633-1637`（`installable`） |
| W8R2-06 写回覆盖未提交本地修改 | P3 | **已关闭（含 W8R3-02/03 两条残余）** | `b-save-rewind` B3：v1 保存后手工改写 `content.md`（真实 `git status` 脏），v2 保存返回 `RECOVERY_REQUIRED` + `repairOnly:true`、磁盘字节逐字保留、写 `requirement.save_worktree_overwrite_blocked` 诊断、Git 已提交 v2；把本地编辑还原为基线字节后 repair-only 重试 `projection_repaired`、零新增提交、磁盘等于提交字节。代码：`requirement-save.ts:2252-2268` + `2280-2311`（目标路径白名单 + porcelain 第二列 + 字节三态判定）、`dirtyWorktreeRefusal` `2317-2360` |

**结论：W8R2-01..06 六条修复在代码与独立探针中均真实成立**；五项必需失败测试独立复跑通过；T7 声明的 API 收紧（`RunIntegrationOptions.lock` 必填、`resetHard` 端口、`keepWorktree` 默认 false）与代码一致。

---

## R3-4. 逐 AC 结论（本轮指定切片）

| AC | 结论 | 证据要点 |
|---|---|---|
| AC-020 暂停恢复 | **passed** | `wp08.integration.test.ts`「still holds pause/resume … after an integrated delivery」通过；恢复准入受 W8R2-03 的 Run 绑定约束（`d-admission` D1/D4） |
| AC-021 取消未知副作用 | **passed** | 必需失败测试「取消未知副作用」5/5 中的一项；`blocked(recovery)`、Requirement 保持 active、不集成 |
| AC-022 预算止损 | **passed** | `wp08.integration.test.ts` 预算原子拒绝并在集成后保持拒绝 |
| AC-029 初始化冲突中断 | **passed** | `wp08.integration.test.ts` 中断按 Hash 续写、冲突不覆盖 |
| AC-041 知识结算 | **passed** | `wp08.integration.test.ts` 知识补丁 + 冷启动查询；`settlement.integration.test.ts` 11/11 |
| AC-054 UI 断开 | **not_covered** | 属 WP-09（与 T7 残余 9 一致） |
| AC-057 Runner 失联/双写者 | **passed（本包必验面）** | 活进程 park 后 `beginAttempt`/`resumeWork` 被拒、租约不交给第二 owner；Run 绑定决策才放行；确认已死直接放行（`d-admission` D1–D4）。残余 W8R3-04（25 条决策窗口）与 W8R3-07 记录说明（见 R3-7） |
| AC-058 过期结果 | **passed** | `recovery.test.ts` 19/19（旧 epoch 拒绝保留诊断） |
| AC-061 启动恢复 | **passed** | `recovery.test.ts`（等值/更旧 daemon epoch 围栏） |
| AC-062 集成冲突 | **passed** | `cas.integration.test.ts` 修复 Task 独立性、HEAD 保护；`h-hunt` H3 血缘 |
| AC-063 部分结算 | **passed** | `settlement.integration.test.ts` + 必需失败测试「ref 后崩溃」；`f-struct` F4（ref 后抛异常仍恰一条事件） |
| AC-064 备份恢复 | **passed（产品集成套件）** | `backup.integration.test.ts` 计入 `tests 222`；必需失败测试「备份演练」通过。本轮未另写独立备份探针（见 R3-8） |
| AC-081 Task 依赖输入 | **passed** | `cas.integration.test.ts` 依赖血缘 6 项 + `h-hunt` H3（变更祖先 `STALE_ARTIFACT`+`invalidated`、缺 manifest ref `GATE_NOT_READY`） |
| AC-082 重启保留窄范围 | **passed** | `recovery.test.ts` 19/19 |
| AC-090 需求保存时机 | **passed** | `b-save-rewind` B1/B2/B2b/B4：正常前移、陈旧 worktree 复位后前移、投影失败 repair-only 重试复用提交零新增、恰一条 `requirement.saved`。残余 W8R3-01/02/03 |
| AC-091 崩溃与交付竞争 | **passed** | `c-lock` C1–C4：交付自身取锁、结算同锁、失败释放、保存与交付同资源。残余 W8R3-05/06（锁身份） |
| AC-093 目录与正文一致性 | **passed** | B4 组合 `recordHash` 由提交字节独立复算吻合；半对/陈旧/HEAD-only 由产品套件覆盖 |
| AC-094 正文保存与并发 | **passed** | `cas.integration.test.ts` 17/17（含 W8R1-02 按 ref 修订读取）+ `a-cas-basis` A2（陈旧候选不再回退分支） |

---

## R3-5. 新发现（W8R3-xx）

严重性口径（`docs/rules/workflow.md` §6）：P0 数据/安全或关键不可用；P1 错误行为/需求缺失；P2 局部质量/维护；P3 建议。**本轮无 P0/P1。**

### W8R3-01（P2）— `installJournaledCommit` 的正文核对以「记录路径」为键：崩溃 operationId 被用于另一条需求时，静默安装 journal 里的旧记录并回报 `saved`

- **位置**：`packages/core/src/requirement-save.ts:1686-1705`（`journaledRecordHash(journal, prepared.directoryPath)` 找不到同一路径时返回 `null`，核对被跳过）、`1685`/`1818-1830`；入口 `1339-1358`；CAS 放行 `packages/workspace/src/cas.ts:1633-1637`（`installable` 只比较 state/expected/target，不看 payload）。
- **复现**：`node /tmp/wp08r3/e-journal.mjs` 的 E3 段（真实仓库 + 真实 SQLite）：`op-e3` 保存需求 A 时在 `updateRef` 处崩溃（journal `pending` + target，ref 未动）；随后用**同一 `op-e3`**、需求 B（不同 id/路径）调用 `save()`。
- **观测**：`save()` 返回 `status:'saved'`、`recordPath` 为 B、`recordVersion:1`、`commit` = journal 里的 A 提交；交付分支该提交只含 A 的记录（`hasOther:false`，`hasFirst:true`）；本机投影写入 B 的行且其 `portableRef.revision` = 该修订（该修订并不含 B）；工作树被写入 B 的未提交文件；并发出 1 条 `requirement.saved`。
- **期望**：`reliability.md` §5「用相同 operationId 恢复不产生重复完成事件」与 §9「重试核对 operationId/目标 Hash，不产生重复需求或重复事件」；同函数对**同一路径的正文变化**已返回精确 `IDEMPOTENCY_CONFLICT`（E2），换一条记录是更强的 payload 变化，应同样拒绝。
- **修复方向**：把核对从「按路径查 hash」提升为「按操作身份核对」——`journal.stepResults.requirementRecords` 必须恰含本次 `prepared.directoryPath` 且 hash 相等（缺该路径即 `IDEMPOTENCY_CONFLICT`），或在 CAS journal 中记录 `requirementId`/`recordPath` 并与本次请求比对；同时不允许在核对失败时继续 `refreshWorkingTree`/`refreshProjection`。
- **影响面**：仅需调用方复用 operationId（跨 requirement）。分支本身不含错误内容（A 的记录是正确的 journal 目标），因此不是数据丢失，而是**夸大记录**（投影、事件、返回值都宣称 B 已提交）+ 工作树/分支不一致。

### W8R3-02（P2）— 非脏原因的工作副本写回失败只记诊断，`save()` 仍报 `saved` 并刷新投影，工作副本与分支长期分叉

- **位置**：`packages/core/src/requirement-save.ts:1496-1537`（`refreshWorkingTree` 抛出的非 `DeliveryWorktreeDirtyError` 只 `appendDiagnostic(REQUIREMENT_WORKTREE_REFRESH_FAILED_EVENT)`，随后照常 `finishSave`）、`1799`（`installJournaledCommit` 同形）。
- **复现**：`node /tmp/wp08r3/h-hunt.mjs` H1：把写回目标 `.agentdev/requirements/<id>/content.md` 预先建成**目录**（真实 `EISDIR`），再 `save()`。
- **观测**：`save()` 返回 `ok:true, status:'saved'`，`requirement.save_worktree_refresh_failed` 恰 1 条；投影行 `portableRef.revision` = 分支修订；而工作副本的 `content.md` 不是文件（读失败），提交字节从未落到工作副本。R2 的 W8R2-06 又把这个分叉状态判成「未提交的本地修改」并在 repair 里永久拒绝（见 W8R3-03），因此该组合会卡住后续保存。
- **期望**：`reliability.md` §9「核对文件 Hash 后提交本机投影/version 和 requirement.saved」——既已核对文件 Hash 才报 `saved`，写回失败就不应同时宣称工作副本已一致；AC-028 要求「保留数据并阻断到明确处置」。至少应返回 `RECOVERY_REQUIRED`（repair-only）而不是 `saved`，让修复路径显式重试写回。
- **修复方向**：把非脏写回失败也升级为 `RECOVERY_REQUIRED`（`repairOnly:true`、`branchUntouched:false`、operation 置 `projectionFailed`），由 repair 路径重试；或在 `finishSave` 前校验三个目标路径的磁盘字节等于提交字节，不一致则拒绝报告 `saved`。

### W8R3-03（P2）— W8R2-06 的脏判定把「干净但停在另一修订的工作树」判成本地修改，提交后拒绝写回且 repair 重试不收敛

- **位置**：`packages/core/src/requirement-save.ts:2300-2311`（字节三态判定只与 `baselineRevision` 的 blob 比较，未区分「本地未提交编辑」与「命中另一提交的干净检出」）、`2252-2268`；修复路径的固定拒绝点 `1639-1660`（消息「本机投影修复失败」）。
- **复现**：`node /tmp/wp08r3/b-save-rewind.mjs` B3b：正常保存 v1、v2 后，在交付工作树上 `git checkout -f --detach <v1>`（`git status --porcelain` 为空、无任何未提交改动，交付 ref 仍为 v2、投影仍为 v2），再以期望 v2 保存 v3。
- **观测**：`save()` 已把 v3 提交到分支，却返回 `RECOVERY_REQUIRED`，消息称 `content.md、requirement.json、README.md 有未提交的本地修改`（实际工作树是干净的）；同一输入的 repair-only 重试（`journal.targetRevision === headRevision`）再次因同样判定拒绝，磁盘仍停在 v1 字节，**无法收敛**；期间本机投影仍为 v2，而分支已是 v3。
- **期望**：AC-028 的「用户文件未提交」与本状态无关；AC-090 的 repair-only 重试应能补齐投影与工作副本。判定的语义应是「路径内容既不等于将写入的字节、也不等于**任何已提交修订**的字节」，或至少先确认该路径处于已提交状态（例如与 `HEAD`/index 一致）才判定脏。
- **修复方向**：在字节判定之外要求 porcelain **第二列**非空或 index/worktree 与 `HEAD` 不一致（当前只用第一列过滤，等价于放弃这项检查）；或对「与基线 blob 不等」的情形再取一次 `readBlob(repoRoot, HEAD, path)`（工作树实际检出的修订）比较，相等即视为干净检出而非本地编辑。

### W8R3-04（P3）— 新 Attempt 准入只扫描最近 25 条恢复决策：有效 Run 级决策可被后续无关决策挤出，已放行的 Run 重新被阻断

- **位置**：`packages/core/src/recovery.ts:298-313`（`store.decisions.list({ where: 'work_id = ? AND kind = ?', orderBy: 'created_at DESC', limit: 25 })` 之后才做决策绑定过滤）。
- **复现**：`node /tmp/wp08r3/d-admission.mjs` D5：Run 因活进程 park 后写入一条 Run 级 `choice:'resume'` 决策（准入 `allowed:true`），随后为同一 Work 写 25 条 Work 级恢复决策。
- **观测**：`newAttemptAdmission(runId)` 由 `allowed:true` 翻回 `allowed:false, code:'RECOVERY_REQUIRED'`——与判定绑定的那条决策落在 `limit:25` 窗口之外。
- **期望**：准入是对「是否已有针对本 Run 的、晚于判定的 resume 决策」的存在性判断，不应随同一 Work 的无关决策数量变化（`reliability.md` §5：恢复判定与处置可审计、可重复）。
- **修复方向**：把绑定条件下推到查询（`AND choice='resume' AND (target_ref_id = ? OR target_ref_id = ?)`）或先按 `target_ref_id` 过滤再取最新；至少去掉 `limit` 或改为按判定游标分页扫描。
- **影响面**：需要同一 Work 累计 >25 条恢复决策（当前 CLI/BFF 入口未接线，实际量级有限），因此 P3。

### W8R3-05（P3）— 集成锁对「同 owner id + 同 epoch」可重入：保存与交付共用 operationId 时互斥失效

- **位置**：`packages/storage/src/leases.ts:60-61`（`sameOwner && existing.epoch === input.epoch` 直接放行）、`packages/core/src/requirement-save.ts:1163`（保存默认 `ownerAttemptId = operationId`）、`packages/workspace/src/cas.ts:968`（交付默认 `ownerAttemptId = operationId`）。
- **复现**：`node /tmp/wp08r3/c-lock.mjs` C5：以 `ownerAttemptId='shared-owner'` 持 `integration:<projectId>`，再以 `ownerAttemptId='shared-owner'` 调用 `runIntegration`。
- **观测**：交付未被拒绝（`ok:true`），在「持锁者」仍处临界区时推进了交付 ref。
- **期望**：AC-091「需求保存与代码交付共享 Project 集成锁」的互斥不应取决于调用方是否恰好复用同一 owner id；保存与交付的 owner 命名空间应可区分（如 `save:<op>` / `integrate:<op>` / `settle:<op>`）。
- **缓解事实**：若真的复用同一 operationId，CAS journal 的 `kind`/`ref` 检查随后会以 `IDEMPOTENCY_CONFLICT` 拒绝（`cas.ts:1589-1595`），因此实际影响有限；但锁层面的保证并不成立。
- **修复方向**：由服务在 owner id 前拼接子系统前缀（或对锁增加 `purpose`/`kind` 维度），使默认路径不可能发生跨子系统 owner 碰撞。

### W8R3-06（P3）— 交付锁是注入式实例：传入独立锁对象即可在共享资源被持有时完成交付

- **位置**：`packages/workspace/src/cas.ts:836-843`（`CasIntegrationLock` 结构端口 + `createMemoryIntegrationLock`）、`cas.ts:904`（`lock` 仅要求「是某个 CasIntegrationLock」，不与 `integration:<projectId>` 绑定）。
- **复现**：`node /tmp/wp08r3/c-lock.mjs` C6：用 `store.leases` 持 `integration:<projectId>`，同时把 `createMemoryIntegrationLock(projectId)` 传给 `runIntegration`。
- **观测**：交付 `ok:true` 并移动 ref——两把锁是不同互斥量；`implementation.md` T7 称「core 的 `ProjectIntegrationLock` 直接满足」结构端口，但没有任何断言保证交付侧的锁**就是**保存/结算使用的那把。
- **期望**：AC-091 的「同一把锁」应是实现可验证的属性，而不是调用方的约定；`reliability.md` §4/§9 的集成互斥在换一个锁实例后不应消失。
- **修复方向**：让 `runIntegration` 接受 `projectId` 并从受控的 `leases` 端口自建锁（或在选项上断言 `lock.resource === integrationLockResource(projectId)`），`createMemoryIntegrationLock` 仅保留给真正的无库单测并在类型/命名上隔离。

---

## R3-6. 计数与阻断表

| 项 | 数量 |
|---|---|
| 独立探针脚本 | 7 |
| 独立探针断言 | 160 |
| 失败断言 | 6（W8R3-01 ×3、W8R3-03 ×2、W8R3-04 ×1） |
| P0 | 0 |
| P1 | 0 |
| P2 | 3（W8R3-01、W8R3-02、W8R3-03） |
| P3 | 3（W8R3-04、W8R3-05、W8R3-06） |
| 阻断 finding | 0 |
| W8R2-01..06 收口复核 | 6/6 已关闭 |
| 五项必需失败测试 | 5/5 通过（独立复跑） |
| 契约命令 | 6/6 退出码 0 |

| 门禁问题 | 结果 |
|---|---|
| 契约命令是否全绿 | 是（typecheck / lint / unit 973 / integration 222 / docs:check / build 10） |
| W8R2-01..06 是否真正收口 | 是（逐条独立探针 + 代码位置复核 + 每条回归用例改名复核） |
| 声明与代码是否一致 | 基本一致：T7 的全部修复描述、API 收紧与残余（含 `openRecoveryDecision` 仍写 Work 级 `targetRef`）均与代码吻合；未发现失实声明 |
| 是否存在未登记的水平缺口 | 是（W8R3-01/02/03/04/05/06 六条均未在 T7 登记） |
| 是否存在阻塞缺陷 | 否（无 P0/P1） |

**能否进入独立 Test：能（PASS）。** 依据 `docs/rules/workflow.md` 的失败路由（P0/P1 阻断），本轮无 P0/P1，六条非阻断 finding 可带入 Test 由 Test 报告决定是否作为残余登记或退回修复。建议优先级：W8R3-01（静默安装错误记录 + 夸大 `saved`，修核对键）→ W8R3-03/02（脏判定误报与写回失败仍报 `saved`，同一段代码）→ W8R3-04/05/06（准入窗口与锁身份，均为加固）。若 Developer 在 Test 前改动代码，代码树哈希必然变化，须重做一轮独立 Review 才能更新本判定。

---

## R3-7. 记录对账（`implementation.md` T7 与代码）

**准确的部分**

- T7 命令数字与本次独立复跑完全一致：unit 48 文件/973、integration 20 文件/222、build 10 workspace、docs:check ok；逐文件增量（worktree +1→11、recovery +1→19、cas +2→17、requirement-save.integration +4→19、settlement.integration +1→11）逐项吻合。
- T7 逐条修复描述与代码一一对应：`cas.ts:1667-1691`（后代校验）、`1633-1637`（`installable`）、`1720-1740`（tree 读取结果化）、`967-993` + `904`（交付取锁/必填）；`requirement-save.ts:1136`（`keepWorktree` 默认 false）、`2189-2200`（worktree 复位）、`1339-1358`/`1675-1705`（journaled install）、`2252-2268`/`2280-2311`（脏写回）；`recovery.ts:298-313`（Run 绑定）；`settlement.ts:1064-1084`/`1157-1180`（settle/recover 取锁 + `recoverUnderLock` + catch 恢复）。
- T7 的反证声明（「把对应修复临时还原为旧行为后各自回归用例由通过转失败」）与各文件新增用例名称、断言内容一致（`cas.integration.test.ts` 的 W8R2-01/W8R2-04 两例、`requirement-save.integration.test.ts` 的 4 例 W8R2-01/05/06、`settlement.integration.test.ts` 的 W8R2-02 一例、`worktree.test.ts` 与 `recovery.test.ts` 各一例）。
- T7 末条残余属实：`openRecoveryDecision`（`findings.ts:2532-2549`）是全仓唯一的 recovery 决策生产者，且写入 Work 级 `targetRef.id`；在新绑定规则下它无法解除任何 Run 的活进程阻断（grep 全仓无第二处 `kind:'recovery'` 插入点）。**记录框架偏窄**：这不是「CLI/BFF 接线」问题，而是 core 侧缺少 Run 级决策入口；建议下轮至少把该残余改写为 core 缺口并给出明确的 Run 级决策 API。
- T7 关于「`interrupted` 不在 `RESUMABLE_STATUSES`，已 park 者不重复处理」的边界与代码一致。

**不准确/未登记的部分**

- 未登记缺口：W8R3-01（journaled install 的记录身份核对）、W8R3-02（写回失败仍报 `saved`）、W8R3-03（脏判定误报与 repair 不收敛）、W8R3-04（准入 25 条窗口）、W8R3-05（owner 碰撞可重入）、W8R3-06（锁实例身份）。
- 未见夸大：T7 未声称 AC-054 覆盖，也未把残余 1–7/9 说成已收口；命令数字、反证声明与代码状态均可核对为真。

---

## R3-8. 覆盖限制

1. **AC-054 不可在本包验证**：BFF/浏览器断开与水位同步属 WP-09，本包无 HTTP/WS 接线，故 `not_covered`（与 T7 残余 9 一致）。
2. **AC-083 仅间接覆盖**：document 路线与无 `taskId` 的 Finding 关闭由 `wp08.integration.test.ts`（12/12）断言通过；本轮未另写独立探针验证 Finding 目标绑定/`manifestId` 的数据库约束。
3. **接线层未验证**：`apps/cli` 的 backup/restore/relocate 与 `apps/daemon` 的 `recoverAfterRestart`、Run 级恢复决策入口均未接线（T5 残余 5、T7 末条）；本报告全部 finding 均为**服务 API 层**的可复现行为，不是端到端 CLI 演练。
4. **AC-064 备份/恢复**本轮未另写独立探针，只依赖 `pnpm test:integration`（含 `backup.integration.test.ts`）与五项必需失败测试中的「备份演练」；R2 的 `e-backup.mjs` 结论未被本轮重新取证。
5. **恢复的进程身份用确定性的内存探针**（`createMemoryProcessProbe`），未使用真实容器/远端身份；`parseRunnerPid` 对容器标识返回 `null` 的 fail-closed 行为未在本轮复现。
6. **并发为单进程观测**：锁竞争、CAS 竞态与准入判定都在单进程内以真实 SQLite + 真实 Git 状态观测完成，未做多进程并发压测，因此 W8R3-05/06 的「真实两进程」形态未取证。
7. **崩溃注入是异常模拟**：W8R2-05/W8R2-04 的崩溃点是包装端口抛异常（与真实 `SIGKILL` 的可观测残留状态等价），未用真实 `SIGKILL`。
8. **W8R3-02 的触发是注入式**：把写回目标变成目录以得到真实 `EISDIR`；真实 `ENOSPC`/`EACCES` 未演练。W8R3-03 的复合触发链（先 W8R3-02 的写回失败、再被判脏而 repair 不收敛）只做了状态推理，未端到端串起。
9. **Secret/密钥导出未演练**（T5 残余 4）：只沿用产品套件的「缺 Secret 阻断」结论。
10. **一次性工具副作用披露**：本轮未使用子代理、未在仓库根写入任何临时文件；所有脚本与输出位于 `/tmp/wp08r3/`，仓库内唯一写入为本报告追加（其余路径未触碰，`git status` 可复核）。

---

## R3-9. 结论

W8R2-01..06 的六条修复**全部真实收口**：本轮用 7 个独立探针、160 项断言（真实临时 Git 仓库 + 真实 SQLite，只消费构建产物）逐条复现了修复后的正确行为——陈旧候选不再能回退交付分支、陈旧 save worktree 会被复位并继续前移、交付与结算都取得共享集成锁且失败也释放、恢复决策与 Run/判定绑定、崩溃窗口内的 journal 提交恰好安装一次、候选 tree 不可读时仍是结构化拒绝；五项必需失败测试 5/5 通过，六项契约命令全绿，T7 的记录在修复范围内与代码逐条吻合。

本轮未发现 P0/P1；新登记 6 条非阻断缺陷：3 × P2（journaled install 的记录身份核对缺口导致静默错误安装与夸大 `saved`；写回失败只记诊断却报 `saved`；脏判定把干净的其他修订检出误判为本地修改且 repair 不收敛）与 3 × P3（准入只扫 25 条决策、锁对同 owner 可重入、交付锁实例身份无约束）。这些均属修复的边界与加固，不改变 AC-090/091/094/057 的主体行为。

**判定 PASS：允许进入独立 Test**（无 P0/P1）。Test 请覆盖本报告 R3-5 的六条残余、R3-8 的覆盖限制（尤其 AC-064 与接线层），并在 Test 报告中登记是否要求退回修复；若 Test 期间发生任何代码改动，须按 `Develop → 新独立 Review → Test` 重走。

---

# WP-08 独立 Review 报告（第四轮：T8 收口复核与回归搜寻）

## R4-0. 元数据（round 4）

| 项 | 值 |
|---|---|
| 工作包 | WP-08 集成、结算与恢复 |
| Review 角色 | 独立 Review（独立上下文；未读取任何开发/Test 聊天或会话） |
| 轮次 | 第四轮（冻结 7422646 的 T8 收口复核 + 回归搜寻） |
| 冻结提交 | `7422646`（task-issued freeze point） |
| `git rev-parse HEAD` | `7422646e27b13144e429ccb5906919122b65a6b3` |
| `git rev-parse 7422646^{tree}` | `fda94c51771ba5dd572df93c872ca8e6bc3eb221` |
| `git status --porcelain` | ` M .agentdev/work/WP-08/review.md`、` M .agentdev/work/WP-08/test.md`（round-3 Review 与 round-2 Test 的未提交追加；**代码树与冻结提交一致，无源码改动**） |
| 平台 | macOS arm64，Node v24.8.0，pnpm 12.3.4，Git 2.39.3（真实 `git`），真实 SQLite（`node:sqlite`，经 `ProjectStore`/lease 行） |
| 探针目录 | `/tmp/wp08r4/`（5 个脚本，只消费 `packages/*/dist` 构建产物，从不 import 产品测试文件） |
| 判定 | **PASS**（0 × P0、0 × P1、0 × P2；2 × P3 新增非阻断 finding） |
| round 1–3 保留 | §0–§10、R2-0–R2-9、R3-0–R3-9 逐字保留（追加前 105109 字节，SHA256 `060deb7e606567f20ca9413a804b83c366050a4e7fce40cdbf8755c1d1ae491d`）；本轮仅追加，删除计数为 0 |
| 一次性工具副作用 | 本轮未使用任何子代理；仓库内唯一写入为本报告追加，`git status --porcelain` 除 `review.md`/`test.md` 外为空 |

### 受审文件哈希（SHA256，冻结提交 `7422646` 实际内容）

```
326108c7013f4ceb0e7be90015d97e6c1e119dc0e89cd17f41f630016ab99f6d  .agentdev/work/WP-08/implementation.md
d3a82ceb2c684362794ed34053c22fee4256e55e7ac778724ac27445c2461228  packages/workspace/src/cas.ts
951d471696322edeac53036738552eb22e4c19bbc1360665ff68830f80bd2149  packages/core/src/requirement-save.ts
34708def4f5391d1a4ff8dda9d60028dfb8c6ebd9445b3b352f73c0c4b0f9bba  packages/core/src/recovery.ts
df4745dca9967ab8cec6d67beea2d25e64d14c00c428756e25deeaaaf9d9870f  packages/core/src/settlement.ts
a02646b6a5b5007f42f1ba16fc92ba12dbd49d71340b8039903ce0f9be75b735  packages/workspace/test/cas.integration.test.ts
e0a1ae301cd55fc271b51bb885c4c689f12f15fbc5441c8f2afb8b85f30fccb1  packages/core/test/requirement-save.integration.test.ts
a57e13df8153ec44141861325bdd9066eca959aebad510a444f8a72d5f18b6c8  packages/core/test/recovery.test.ts
2cf43dfb89a12b175073036ba18c94d793b734e543507f2c91fc2a7f8c49f28c  packages/core/test/wp08-failures.test.ts
9f5b359d8299f48a8b0b3686cc456a79a5dd7829473209ce8dfdaa5f9f926036  packages/core/test/wp08.integration.test.ts
d1cf229740c46f9cf3fdea9c8ba833ae48851bfb54b51f373ff5adfcd4344f04  packages/workspace/src/worktree.ts（T8 未改动；`resetHard` 仍为 `reset --hard` + `clean -fd`）
```

### 已加载依据

`AGENTS.md`、`docs/INDEX.md`、`docs/rules/{workflow,agents}.md`、`docs/architecture/{reliability,data,execution}.md`、`docs/product/{knowledge,requirements}.md`、`docs/delivery/acceptance.md`（AC-020/021/022/028/029/041/054/057/058/061/062/063/064/081/082/083/090/091/093/094）、`docs/delivery/implementation.md`（WP-08）、`.agentdev/work/WP-08/{plan,implementation}.md`（T8）与 round 1–3 报告，以及 `7422646` 的受审源码、`7b0fd20..7422646` 完整 diff 与回归网。
刻意排除：任何开发/Test 会话或聊天、`webui/`、历史任务记录、`/tmp/wp08r4/` 中开发侧遗留的一次性脚本（`falsify*.py`、`*.snap`）。

---

## R4-1. 契约命令原始结果（`7422646` 工作树根目录，顺序执行）

日志全文 `/tmp/wp08r4/contract.log`；`EXIT_CODE` 为真实退出码。

| # | 命令 | 退出码 | 原始结果（关键行） |
|---|---|---|---|
| 1 | `pnpm typecheck` | 0 | `tsc -p tsconfig.json --pretty false`，无输出 |
| 2 | `pnpm lint` | 0 | `Checking formatting...` / `All matched files use Prettier code style!`（ESLint 无告警） |
| 3 | `pnpm test:unit` | 0 | `Test Files 48 passed (48)` / `Tests 975 passed (975)` |
| 4 | `pnpm test:integration` | 0 | `Test Files 20 passed (20)` / `Tests 233 passed (233)`（含真实容器与临时 Git 仓库） |
| 5 | `pnpm docs:check` | 0 | `docs:check ok — 15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages` |
| 6 | `pnpm build` | 0 | `build: Done` ×10：contracts、domain、knowledge、storage、workspace、core、pi-runtime、cli、daemon、runner |

**与 `implementation.md` T8 声明的数字对账**

| 项 | T8 声明 | 本轮独立复跑 | 结论 |
|---|---|---|---|
| unit | 48 文件 / 975 用例（973 → +2） | 48 / 975 | 吻合 |
| integration | 20 文件 / 233 用例（222 → +11） | 20 / 233 | 吻合 |
| build | 10 workspace | 10 × `Done` | 吻合 |
| docs:check | ok | ok（同数字） | 吻合 |

**WP-08 相关测试文件逐文件用例数（`/tmp/wp08r4/r4-slice.log`）**

| 文件 | 用例数 | 文件 | 用例数 |
|---|---|---|---|
| `workspace/test/cas.integration.test.ts` | 22（+5：T-01/T-02/T-04/W8R3-05/W8R3-06） | `core/test/wp08.integration.test.ts` | 12 |
| `core/test/requirement-save.integration.test.ts` | 25（+6：W8R3-01/02/03、T-03×2、T-05） | `core/test/settlement.integration.test.ts` | 11 |
| `core/test/recovery.test.ts` | 20（+1：W8R3-04） | `core/test/wp08-failures.test.ts` | 6（5 项必需 + T-01 收敛） |

**五项必需失败测试**（`pnpm vitest run --project unit packages/core/test/wp08-failures.test.ts`）：`Test Files 1 passed`、`Tests 6 passed (6)`，退出码 0 —— Task 合并冲突 / CAS 失败 / ref 后崩溃 / 取消未知副作用 / 备份演练 **5/5 通过**，另加 T-01 的 Manifest 收敛回归。

**代表性 AC 切片**（`/tmp/wp08r4/r4-slice.log`）：`wp08.integration` 12/12、`cas.integration` 22/22、`requirement-save.integration` 25/25、`settlement.integration` 11/11（合计 `Tests 70 passed (70)`）、`recovery.test` 20/20，全部退出码 0。

---

## R4-2. 方法（round 4）

5 个独立脚本位于 `/tmp/wp08r4/`（另含与被审代码无关的 `lib.mjs` 断言/夹具库），全部通过 `packages/*/dist/index.js` 消费**构建产物**；真实临时 Git 仓库（`init` / `worktree add` / `commit` / `update-ref` / `cherry-pick` / `checkout --detach` / 真实脏状态）与真实 SQLite（`ProjectStore` + `lease` 行）承载状态；脚本自实现断言与故障注入，从不 import 任何产品测试文件。

| 脚本 | 覆盖 | 结果（`/tmp/wp08r4/*.out`） |
|---|---|---|
| `r4-01-t01-t02.mjs` | T-01 收敛 + 最终 Manifest、T-02 缺失 revision 的 Gate 拒绝 | checks=18，failures=0 |
| `r4-02-save-path.mjs` | W8R3-01/02/03、T-05、T-03（读取器 + 保存路径） | checks=41，failures=0 |
| `r4-03-cas-lock.mjs` | T-04 候选成对核对（含正例）、W8R3-05 三子系统 owner 前缀、W8R3-06 锁身份（含正例） | checks=19，failures=0 |
| `r4-04-admission.mjs` | W8R3-04 决策窗口 + Run/verdict/Work 绑定与 choice/时序回归（D1–D7） | checks=24，failures=0 |
| `r4-05-hunt.mjs` | AC-028 脏保护回归（H1–H3）、AC-063 ref 后崩溃重放（H4）、`supersedes` 畸形输入与依赖边搜寻（H5–H6） | checks=23，failures=5（全部归属 R4-5 的 2 条 finding） |

合计 **125 项断言，5 项失败**；W8R3/T/回归项全部为阳性（修复后行为成立），失败项全部是新搜寻出的 `supersedes` 边界。

反证与故障注入手法：
- **崩溃窗口（零 mock 语义）**：包装 `WorktreeGitPort.updateRef` 在真实 `git update-ref` 成功之后抛异常，得到「commit 已存在、ref 已交换、状态未写」的真实残留现场（W8R3-01 用「交换前抛异常」，H4 用「交换后抛异常」）。
- **真实文件系统失败**：把写回目标 `content.md` 预建成目录以触发真实 `EISDIR`（W8R3-02）。
- **真实脏状态**：手工改写 `content.md`（工作树列 ` M`）、`git add` 后未提交（索引列 `M `）、未跟踪草稿（`??`）三种形态分别验证 AC-028（H1–H3）。
- **锁竞争**：真实 SQLite `lease` 行 + `ProjectIntegrationLock`；保存/交付/结算分别以包装锁记录 `acquire` 的 owner（`save:` / `integrate:` / `settle:`），并在同一资源上观测 `BUSY` 与释放。
- **准入反证**：同一 Work 两个 Run 因真实进程探针存活被 park，随后写入 Run 级 / verdict 事件级 / 兄弟 Run / Work 级决策，并在 200 条后续无关决策压力下重读 `newAttemptAdmission` 与 `RunLifecycle.beginAttempt`。
- **候选树核对**：真实提交只含 `requirement.json` 的候选 vs 成对候选（T-04 负例 + 正例）。
- **畸形输入搜寻**：`supersedes` 指向不存在的 Task / 指向自身 / 第三方 Task 依赖被取代路线（H5–H6）。

---

## R4-3. T8 收口逐条复核（T-01..T-05、W8R3-01..06）

| finding | 严重性 | 收口结论 | 独立证据（本轮探针，均为阳性） |
|---|---|---|---|
| T-01 修复回路不收敛 | P2 | **已关闭** | `r4-01`：两真实 Task 冲突 → `TASK_MERGE_CONFLICT` + 修复 Task（`dependsOn=[task-a,task-c]`）、分支停在基线、零事件；仅传 `repairIntegrationTask({repair, revision})` → `ok:true`、`supersededTaskIds=["task-a","task-c"]`、`appliedTaskIds=[修复 Task id]`、被取代路线 `commit:null`、最终 revision 含 `"resolved"`、两条路线 revision 均非最终 revision 的祖先、分支恰 3 个提交、**恰 1 条完成事件**；`buildFinalManifest` 记录的 `finalRevision` 即修复后 revision，而修复前 revision 报 `STALE_ARTIFACT`。代码：`cas.ts:1438`（`repairIntegrationTask`）、`652-755`（`planIntegration` 的 `supersedes` 剔除）、`1159-1170`（被取代项从不回放） |
| T-02 缺失 revision 报 `INTERNAL_ERROR` | P3 | **已关闭** | `r4-01`：仓库中不存在的 revision → `GATE_NOT_READY`、`conflict.reason='revision'`、`conflict.taskId='task-ghost'`、`branchUntouched:true`、分支仍 1 个提交、零事件、**无 `repair`**（不再伪造修复 Task）。代码：`cas.ts:1135-1147` |
| T-03 池读取器无逐条冲突通道 | P3 | **已关闭** | `r4-02`：只含 `requirement.json` 的提交 → `records.length=0` 且 `conflicts=[{reason:'missing-content', recordPath, paths:[…,content.md]}]`；保存同一 id → `REQUIREMENT_CONFLICT` 且点名路径、分支不动；`metadata.contentHash` 与正文不符 → `hash-mismatch` 且记录仍可读、组合 Hash 由读取器重算。代码：`requirement-save.ts:634-731`（读取器）、`2219-2241`（保存路径冲突） |
| T-04 半对检查只校验路径形状 | P3 | **已关闭** | `r4-03`：候选提交物理上只含 `requirement.json` → `VALIDATION_ERROR`、消息点名 `…/content.md`、分支不动、零事件；**正例**（候选同时含两文件）正常 `completed` 并恰 1 条事件，证明不是过度拒绝。代码：`cas.ts:1736-1761`（`pathAtRevision` 逐文件核对） |
| T-05 陈旧投影被误判为本地修改 | P3 | **已关闭** | `r4-02`：另一服务器提交 v2 并移动 ref（本机未 checkout，porcelain 为索引侧 `D ` + `??`）→ `explicitRepair:true` 保存 → `status:'saved'`、`previousCommit` 为对方提交、磁盘字节等于提交字节、本机投影前移。代码：`requirement-save.ts:2434-2530`（按「HEAD / 本机投影修订」解释字节） |
| W8R3-01 journaled install 以记录路径为键 | P2 | **已关闭** | `r4-02`：`op-r4-journal` 保存需求 A 于 `updateRef` 崩溃（journal `pending` + target、ref 未动）→ 同一 operationId 保存需求 B → `IDEMPOTENCY_CONFLICT`、消息点名「未记录记录路径 …/RID2」、分支停在基线、提交数 1、B 无投影、零 `requirement.saved`；随后用**健康服务**以原记录重试 → 仍能安装 journal 中的提交（`status:'saved'`），即收紧未把崩溃窗口变成永久卡死。代码：`requirement-save.ts:1789-1815`、`1944-1973` |
| W8R3-02 非脏写回失败仍报 `saved` | P2 | **已关闭** | `r4-02`：真实 `EISDIR` → `RECOVERY_REQUIRED` + `operation.repairOnly:true` + `branchUntouched:false` + 消息含「写回失败」；投影**未**前移、无 `requirement.saved`、有 1 条 `requirement.save_worktree_refresh_failed`；修复文件系统后同 operationId 重试 → `projection_repaired`、零新增提交、磁盘字节等于提交字节。代码：`requirement-save.ts:1597-1629`、`1913-1930`、`2555-2600`（`worktreeRefreshRefusal`） |
| W8R3-03 干净但停在另一修订被判脏且不收敛 | P2 | **已关闭** | `r4-02`：v1/v2 保存后 `checkout -f --detach v1`（porcelain 为空、ref 仍 v2）→ 保存 v3 → `saved`、磁盘等于提交字节、工作树 HEAD 复位到 v3、随后 v4 仍 `saved`（分支未领先）。代码：`requirement-save.ts:2429-2439`（干净早退）与 `2532-2600`（`rewindCleanCheckout`，仅干净且 detached/交付分支时 `resetHard`，绝不移动其他分支） |
| W8R3-04 准入只扫描最近 25 条决策 | P3 | **已关闭** | `r4-04`：D5（25 条无关决策）与 D6（**200** 条后续决策、含 Run-A 自身与兄弟 Run 目标）下 `newAttemptAdmission(runA).allowed===true` 且 `beginAttempt` 开出 Attempt #2/epoch 1；D7 证明 `accept_cancel` 与兄弟 Run 的 `resume` 都不放行本 Run，兄弟自身正常放行。代码：`recovery.ts:300-315`（`json_extract(target_ref,'$.id') IN (?,?)` 下推查询、去掉 `limit:25`） |
| W8R3-05 同 owner+epoch 可重入 | P3 | **已关闭** | `r4-03`：保存路径 acquire 记录为 `save:op-shared`、交付为 `integrate:op-shared`、结算为 `settle:op-shared`；`save:op-shared` 持真实 `lease` 行时同一 raw id 的交付返回 `BUSY`（`heldBy.ownerAttemptId='save:op-shared'`）且分支不动。代码：`requirement-save.ts:1252-1256`、`cas.ts:1041-1043`、`settlement.ts:1050-1052` |
| W8R3-06 交付锁是注入式实例 | P3 | **已关闭** | `r4-03`：core/workspace 的资源名与 `createMemoryIntegrationLock` 三者一致（`integration:<projectId>`）；传另一 Project 的锁 → `INVALID_STATE`、消息含期望资源名、分支与事件零改动；真实 Project 锁被 `save:` 持有时交付 `BUSY`，释放后同一交付 `integrated` 且恰 1 条事件。代码：`cas.ts:930-940`、`1009-1040`、`871-873` |

**结论：T8 声明的 11 条收口（Test T-01..T-05 与 Review W8R3-01..06）在代码与独立探针中全部真实成立**；11/11 条各有至少 1 项本轮独立阳性证据；无一条仅凭声明接受。

---

## R4-4. 逐 AC 结论（本轮指定切片）

| AC | 结论 | 证据要点 |
|---|---|---|
| AC-020 暂停恢复 | **passed** | `wp08.integration.test.ts` 12/12 重跑通过（含集成后暂停/恢复）；准入受 W8R3-04 的 Run 绑定约束（`r4-04` D1/D4） |
| AC-021 取消未知副作用 | **passed** | 必需失败测试「取消未知副作用」6/6 套件中通过；`blocked(recovery)`、不集成 |
| AC-022 预算止损 | **passed** | `wp08.integration.test.ts` 预算原子拒绝用例通过 |
| AC-028 脏工作区保护 | **passed（本轮重点回归）** | `r4-05` H1（工作树 ` M` 编辑）、H2（`git add` 后未提交）、H3（未跟踪草稿）三种形态均 `RECOVERY_REQUIRED` 且字节逐字保留、有 1 条 `requirement.save_worktree_overwrite_blocked`；重写后的判定未削弱该保护 |
| AC-029 初始化冲突中断 | **passed** | `wp08.integration.test.ts` 通过 |
| AC-041 知识结算 | **passed** | `wp08.integration.test.ts` + `settlement.integration.test.ts` 11/11 |
| AC-054 UI 断开 | **not_covered** | 属 WP-09（与 T5 残余 9 一致，无 HTTP/WS 接线） |
| AC-057 Runner 失联/双写者 | **passed** | `r4-04` D1–D7（24 项）：活进程 park 后 `beginAttempt` 被拒、绑定 Run/verdict 的 resume 决策才放行、Work 级与兄弟 Run 决策不放行、200 条决策压力下不放回阻断、确认已死直接放行；`recovery.test.ts` 20/20 |
| AC-058 过期结果 | **passed** | `recovery.test.ts` 20/20（旧 epoch 拒绝保留诊断） |
| AC-061 启动恢复 | **passed** | `recovery.test.ts` 20/20（daemon epoch 围栏） |
| AC-062 集成冲突 | **passed（本轮重点）** | `r4-01`：冲突识别、修复 Task 独立性与依赖、HEAD 保护、**修复回路收敛**、最终 Manifest 记录修复 revision；`cas.integration.test.ts` 22/22（含 T-01/T-02 新回归） |
| AC-063 部分结算 | **passed（本轮独立复现）** | `r4-05` H4：真实 ref 交换后抛异常 → journal `pending` + target、零事件；重试复用同一提交补齐状态、**恰 1 条完成事件**、再次重放零新增（`reused:true`）；必需失败测试「ref 后崩溃」通过 |
| AC-064 备份恢复 | **passed（产品套件）** | 必需失败测试「备份演练」通过；本轮未另写独立备份探针（见 R4-8） |
| AC-081 Task 依赖输入 | **passed（产品套件）** | `cas.integration.test.ts` 依赖血缘 6 例通过；`r4-01` 的 `dependencyRevision` 基点与祖先判定一致 |
| AC-082 重启保留窄范围 | **passed** | `recovery.test.ts` 20/20 |
| AC-090 需求保存时机 | **passed** | `r4-02`：W8R3-02（Git 已提交 → repair-only 重试、零新增提交、磁盘一致）、W8R3-03（复位后收敛）、T-05（陈旧投影仅补投影）；`requirement-save.integration.test.ts` 25/25 |
| AC-091 崩溃与交付竞争 | **passed** | `r4-03`：`save:`/`integrate:`/`settle:` 三 owner、`integration:<projectId>` 锁身份、持锁 `BUSY`、释放后交付、失败释放；`settlement.integration.test.ts` 11/11 |
| AC-093 目录与正文一致性 | **passed** | `r4-02` T-03（`missing-content` / `hash-mismatch` 逐条冲突 + 保存拒绝）、`r4-03` T-04（候选必须真含两文件） |
| AC-094 正文保存与并发 | **passed** | `r4-03` T-04 负例（半对候选不能移动 ref）+ 正例；`cas.integration.test.ts` 22/22（含 W8R1-02 按 ref 修订读取） |

---

## R4-5. 新发现（W8R4-xx）

严重性口径（`docs/rules/workflow.md` §6）：P0 数据/安全或关键不可用；P1 错误行为/需求缺失；P2 局部质量/维护；P3 建议。**本轮无 P0/P1/P2。**

### W8R4-01（P3）— 新增的 `supersedes` 契约没有输入校验：自取代会把「什么都没集成」报告成 `ok:true` 的成功，未知 id 会伪造一条空 revision 的 applied 记录

- **位置**：`packages/workspace/src/cas.ts:660-665`（`superseded` 集合与 `activeTasks` 过滤）、`750`（`supersededTaskIds` 原样返回）、`1159-1170`（`integrateTasks` 为每个 `supersededTaskIds` 伪造 applied 条目，`revision` 取不到时为 `''`）；入口 `cas.ts:1438-1456`（`repairIntegrationTask`）。
- **复现**：`node /tmp/wp08r4/r4-05-hunt.mjs` 的 H5 段（真实临时 Git 仓库 + 真实 CAS）：
  - 自取代：`tasks:[{taskId:'task-self', …, supersedes:['task-self']}]` → `plan.supersededTaskIds=['task-self']`、`plan.order=[]`；`runIntegration` 返回 **`{ok:true, outcome:'noop', revision:<targetRevision>}` 且发出 1 条 CAS 完成事件**（实测 `{"ok":true,"code":"noop","revision":"967346f7…","events":1}`）。
  - 未知 id：`supersedes:['task-not-requested']` → `plan.supersededTaskIds=['task-not-requested']`，`runIntegration` 的 `applied` 里出现 `{"taskId":"task-not-requested","revision":"","commit":null,"superseded":true}`，而该 Task 从未出现在请求里。
- **观测 vs 期望**：期望 `supersedes` 的每个 id 都属于本次请求且不得自指；违反时应在任何回放前以结构化 `VALIDATION_ERROR` / `INVALID_STATE` 拒绝，且**绝不能**在没有集成任何东西时发出完成事件或写出空 revision 的 applied 记录。观测为静默接受：自取代被当作「已集成（noop）」并写完成事件；未知 id 生成幽灵 applied 条目（`revision:''`），污染调用方的血缘输入。
- **AC/条款**：AC-062（`reliability.md` §4「独立修复任务并重新验证最终组合」）；`reliability.md` §5（完成事件与 operation 记录必须对应真实集成）；`workflow.md` §6/§7（不得把未发生的结果报告为已完成）。
- **修复方向**：在 `planIntegration`（或 `integrateTasks` 入口）校验：`supersedes` 的每个 id 必须出现在 `request.tasks` 中、不得等于自身 id，且被取代的 Task 必须真的在本次计划里；违反即 `VALIDATION_ERROR`。同时把 `integrateTasks:1159-1170` 的 applied 条目改为只在 `request.tasks` 里确实存在该 id 时生成，并为「计划里没有任何可回放 Task 且请求非空」增加显式拒绝而非 `noop` 成功。
- **影响面**：`supersedes` 是本轮（T8）新增的 API 面，当前唯一生产者 `repairIntegrationTask` 只写 `repairTask.dependsOn`（合法），生产侧无调用点（T5 残余 3），故为加固性 P3，不阻断验收。

### W8R4-02（P3）— 被取代路线的第三方依赖被「删除」而非「改指取代者」，回放顺序退化为输入顺序

- **位置**：`packages/workspace/src/cas.ts:671`（`dependsOn: task.dependsOn.filter((taskId) => activeIds.has(taskId))`）；相关语义声明在同函数 `668-670` 与 `IntegrationTask.supersedes` 的文档注释（`cas.ts:582-591`：被取代的依赖「由取代者满足」）。
- **复现**：`node /tmp/wp08r4/r4-05-hunt.mjs` 的 H6 段：`task-b`（`dependsOn:['task-a']`、`dependencyRevision=routeA`）+ `task-repair`（`supersedes:['task-a']`）→ `plan.order = ["task-b","task-repair"]`（期望 `task-repair` 在 `task-b` 之前）。
- **观测 vs 期望**：期望 `task-b` 对 `task-a` 的依赖由取代者 `task-repair` 承接（保留边并指向取代者），使最终组合先落地取代结果、再回放依赖它的 Task；观测为边被直接删除，`orderTasks` 只按输入顺序排列，依赖顺序保证消失。
- **AC/条款**：AC-062；`reliability.md` §4（按依赖顺序重放并在冲突时给出正确的组合）；与 W8R4-01 同属 T-01 新增语义的边界。
- **修复方向**：在 `planIntegration` 先建立 `supersededId → supersedingTaskId` 映射，把 `dependsOn` 中命中映射的条目替换为取代者 id（而非 `filter` 删除），仅删除既不在 `activeIds`、也不在映射里的条目；`orderTasks` 因此仍能得到「取代者 → 依赖方」的拓扑序。
- **影响面**：需要调用方在同一请求里同时传「取代者」和「依赖被取代路线的第三方 Task」；当前无生产调用点（T5 残余 3）。在改动互不重叠时结果巧合正确，在改动重叠时 `TASK_MERGE_CONFLICT` 的 `conflictingTaskIds`/修复 Task 依赖集会描述错误的组合，故按 P3 登记。

---

## R4-6. 计数与阻断表

| 项 | 数量 |
|---|---|
| 独立探针脚本 | 5 |
| 独立探针断言 | 125 |
| 失败断言 | 5（全部归属 W8R4-01 ×4、W8R4-02 ×1） |
| P0 | 0 |
| P1 | 0 |
| P2 | 0 |
| P3 | 2（W8R4-01、W8R4-02） |
| 阻断 finding | 0 |
| T8 收口复核（T-01..05 + W8R3-01..06） | 11/11 已关闭（逐条独立阳性证据） |
| 五项必需失败测试 | 5/5 通过（套件 6/6，独立复跑） |
| 代表性 AC 切片 | 90 用例通过（integration 70 + unit 20），退出码全 0 |
| 契约命令 | 6/6 退出码 0 |

| 门禁问题 | 结果 |
|---|---|
| 契约命令是否全绿 | 是（typecheck / lint / unit 975 / integration 233 / docs:check / build 10） |
| T-01..T-05、W8R3-01..06 是否真正收口 | 是（11/11，逐条独立探针 + 代码位置复核 + 正例/负例配对） |
| 声明与代码是否一致 | 一致：T8 的修复描述、API 收紧（`projectId` 必填、`supersedes`/`superseded`/`supersededTaskIds`/`GATE_NOT_READY`、`conflicts` 必填、`repairIntegrationTask`/`integrationLockResourceName` 导出、`save:`/`integrate:`/`settle:` 前缀）与残余登记均可核对；测试用例数增量（unit +2、integration +11）与逐文件吻合；既有测试仅做 `projectId` 机械适配，未见旧期望被放宽 |
| 是否存在未登记的水平缺口 | 是，仅 2 条 P3（W8R4-01/02），均属 T8 新增 `supersedes` 语义的边界，且已在报告中给出复现与修复方向 |
| 是否存在阻塞缺陷 | 否（无 P0/P1/P2） |

**能否进入独立 Test/结算：能（PASS）。** 依据 `docs/rules/workflow.md` 的失败路由（P0/P1 阻断），本轮无 P0/P1；T8 的 11 条修复全部真实收口，六项契约命令全绿，五项必需失败测试与代表性 AC 切片独立复跑通过。新增 2 条 P3 建议与既有残余一并登记进结算：`supersedes` 输入校验（W8R4-01）与依赖改指（W8R4-02）建议随 `createRepairTask`/`runIntegration` 的接线（T5 残余 3）一并收口。**本报告写入前代码树未被改动**（HEAD 仍为 `7422646`，`git status` 仅含报告追加）；若在 Test/结算前发生任何代码改动，冻结哈希即失效，必须重走 `Develop → 新独立 Review → Test`。

---

## R4-7. 记录对账（`implementation.md` T8 与代码）

**准确的部分**

- T8 的命令数字与逐文件增量与本次独立复跑**逐项吻合**：unit 48/975、integration 20/233、build 10、docs:check ok；新增回归用例 13 例（unit +2、integration +11：`cas.integration` +5、`requirement-save.integration` +6）与实测逐文件计数一致。
- T8 逐条修复描述与代码一一对应：`cas.ts:1736-1761`（T-04 候选成对核对）、`1135-1147`（T-02 Gate 分类）、`652-755` + `1159-1170` + `1438-1456`（T-01 取代式收敛）；`requirement-save.ts:634-731`（T-03 读取器）、`1789-1815`（W8R3-01 记录身份核对）、`1597-1629`/`1913-1930`/`2555-2600`（W8R3-02 repair-only 写回失败）、`2429-2439`/`2532-2600`（W8R3-03/T-05 干净检出复位与字节判定重写）；`recovery.ts:300-315`（W8R3-04 查询下推）；`settlement.ts:1050-1052` 与 `requirement-save.ts:1252-1256`、`cas.ts:1041-1043`（W8R3-05）；`cas.ts:930-940`/`1009-1040`（W8R3-06）。
- API 收紧与代码一致：`RunIntegrationOptions.projectId` 必填（缺省时资源名不匹配即 `INVALID_STATE`，fail-closed）；`IntegrationTask.supersedes?`、`AppliedIntegrationTask.superseded?`、`IntegrationPlan.supersededTaskIds`、成功分支 `supersededTaskIds`、新增 `GATE_NOT_READY` 分支；`RequirementPoolAtRevision.conflicts` 必填；导出 `repairIntegrationTask`、`integrationLockResourceName`（探针均从 dist 导入成功）。
- 「无旧期望被更正、仅补 `projectId`」属实：`wp08.integration.test.ts` 的 diff 只有 3 处 `projectId:` 插入；`cas.integration.test.ts` / `requirement-save.integration.test.ts` / `wp08-failures.test.ts` 的 diff 为纯新增用例 + 机械补参，未见断言放宽或删除。
- T8 的残余登记（修复 Task 的调用约定无产品接线、缺失 revision 选择 Gate 失败而非修复 Task、锁端口无 `purpose` 维度、T-03 冲突列表的导入路径未接线、既有 T5/T7 残余不变）与代码状态一致，未见夸大。

**不准确/未登记的部分**

- 未登记：W8R4-01（`supersedes` 无输入校验）、W8R4-02（被取代路线的第三方依赖被删除而非改指）——两者都是 T8 新增语义的边界，T8 正文未提及。
- T8 的「逐条把修复临时还原为旧行为 → 对应回归用例失败」反证声明属开发侧证据，本轮未复现该手法（见 R4-8），本轮以修复后行为的独立阳性证据替代；不构成失实声明。

---

## R4-8. 覆盖限制

1. **AC-054 不可在本包验证**：BFF/浏览器断开与水位同步属 WP-09，本包无 HTTP/WS 接线，故 `not_covered`（与 T8/T5 残余 9 一致）。
2. **AC-064 与备份演练本轮未另写独立探针**：只重跑产品套件（`wp08-failures` 6/6 含「备份演练」、integration 233/233 含 `backup.integration.test.ts`）；R2 Test 的独立备份结论未被本轮重新取证。
3. **崩溃注入是异常模拟**：W8R3-01 与 H4 用端口抛异常（交换前/交换后）制造与真实 `SIGKILL` 等价的残留状态，未使用真实 `SIGKILL`；异常可能比真实崩溃多一次栈展开，故「崩溃后 journal 状态」以磁盘/内存端口读数为准。
4. **并发为单进程观测**：W8R3-05/06 的锁竞争在单进程内以真实 SQLite `lease` 行 + 真实锁实例观测（含跨实例同资源与 owner 前缀），未做两个 OS 进程的真实竞争压测。
5. **T8 的反证声明未独立复现**：本轮未逐条把实现还原为旧行为重跑其回归用例（属开发侧反证）；改为对修复后行为独立取证（11/11）。
6. **接线层未验证**：`apps/cli`/`apps/daemon` 的 backup/restore/relocate、Run 级 recovery 决策入口、修复 Task 派发仍未接线（T5/T7/T8 残余），本报告全部结论均为**服务 API 层**行为。
7. **`runIntegration` 的「同 operationId 成功重放」不可幂等复现（观察，非 finding）**：交付路径每次都重新 `cherry-pick` 生成新候选提交，若在 CAS 成功后（调用方尚未记录）用同一 operationId 重放，`cas.ts:1782` 的候选一致性检查会返回 `IDEMPOTENCY_CONFLICT`（ref 不动、无新增事件、无重复副作用，属 fail-closed；实测 `r4-01` 的重放检查）。该行为在 T8 之前即存在（不在本轮 diff 内），CAS 端口本身对「同一候选」是幂等的（`r4-05` H4 两次重放均 `reused:true` 且恰 1 条事件）；本轮按覆盖限制记录，不判为缺陷。
8. **畸形输入搜寻只覆盖 `supersedes`**：`planIntegration`/`integrateTasks` 的其他输入组合（空 Task 列表、重复 taskId、`dependsOn` 指向自身）未系统化搜寻。
9. **`resetHard` 的副作用未做极限演练**：W8R3-03 的复位路径只验证「干净 + detached/交付分支」；「干净 + 其他分支」分支被显式跳过（代码 review 确认），未构造真实多分支工作树。

---

## R4-9. 结论

T8 的 11 条收口**全部真实成立**：本轮用 5 个独立探针、125 项断言（真实临时 Git 仓库 + 真实 SQLite，只消费构建产物）逐条复现了修复后的正确行为——两冲突 Task 经独立修复 Task 的 `supersedes` 收敛为单一最终组合、最终 Manifest 记录修复 revision 且修复前 revision 失效；缺失冻结 revision 变成可处置的 `GATE_NOT_READY`；跨记录的崩溃 operationId 被 `IDEMPOTENCY_CONFLICT` 拒绝且原记录仍可安装；写回失败不再冒充 `saved`；干净停在旧修订的工作树被复位并持续收敛；陈旧投影被识别为补投影而非本地修改；准入决策绑定 Run/verdict 并在 200 条决策压力下不翻回阻断；保存/交付/结算三 owner 前缀与 `integration:<projectId>` 锁身份可验证。五项必需失败测试 6/6、代表性 AC 切片 90 例、六项契约命令全绿，均独立复跑通过。

本轮未发现 P0/P1/P2；新登记 **2 条 P3**（`supersedes` 缺少输入校验导致自取代被报成成功、未知 id 生成幽灵 applied 记录；被取代路线的第三方依赖被删除而非改指），均为 T8 新增语义的加固边界，不改变 WP-08 已验收行为。

**判定 PASS：允许进入独立 Test/结算**（无 P0/P1）。建议结算时把 W8R4-01/02 与既有 T5/T7/T8 残余一并登记，并在 `createRepairTask`/`runIntegration` 的生产接线（T5 残余 3）阶段补上 `supersedes` 校验与依赖改指；若 Test/结算期间发生任何代码改动，须按 `Develop → 新独立 Review → Test` 重走。
