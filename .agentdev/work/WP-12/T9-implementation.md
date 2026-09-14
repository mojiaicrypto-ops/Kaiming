# WP-12 T9 实现记录：补齐 knowledge/recovery 两个持久事件发射点

- 任务：`.agentdev/work/WP-12/api-gap-audit-2.md` §3.1 / §6.2 中「从未发出的持久事件」里属于知识/恢复服务的两个：`knowledge.updated`、`recovery.report_ready`。
- 依据 Plan：`.agentdev/work/WP-12/plan.md` §4 T9 行 + §3 D9（「持久事件一律补发射点」）。本记录为该任务的实现与证据记录，不新增产品行为、不新增契约命令。
- 状态：Developing（本记录只声明已执行证据；独立 Review / Test 未执行，见 §7）。
- 改动文件（5，全部在授权范围内）：
  - `packages/core/src/settlement.ts`
  - `packages/core/src/recovery.ts`
  - `packages/core/test/settlement.integration.test.ts`
  - `packages/core/test/recovery.test.ts`
  - `packages/core/test/events-hub.integration.test.ts`
- 未改动：`docs/architecture/protocol.md`（§7 没有名字/形状写错，见 §5 裁决）、`apps/**`、`packages/knowledge/**`（无需改：投影写入发生在 core 的 SQLite 投影缓存）、`scripts/**`、`tests/browser/**`、`docs/delivery/acceptance.md`。

## 1. 结论摘要

| 事件 | 真实转换 | 发射点 | 事务 | 测试 | 状态 |
|---|---|---|---|---|---|
| `knowledge.updated` | 知识投影被重新发布（`feature_projection` 行集被真实替换） | `packages/core/src/settlement.ts` `createSqliteProjectionCache().put()`（L207–L250） | 与行写入同一 `withTransaction`（L216） | `settlement.integration.test.ts:503` | 已发射（库级真实 SQLite 路径） |
| `recovery.report_ready` | 重启恢复为某个 Run 生成并持久化 `RecoveryReport` | `packages/core/src/recovery.ts` `RunRecoveryService.recordRestart()`（L982–L1052） | 与 `recover` operation 行写入同一 `withTransaction`（L1013） | `recovery.test.ts:799` | 已发射（真实 store + 真实重启驱动 + 真实 EventHub 投递） |

两个事件名均按 `protocol.md` §7 的既有字面量发射，未新造事件名；`data` 为「变更后实体摘要 + 引用」，完整内容仍由 `get`（`knowledge.get` / 报告引用）获取。

## 2. `knowledge.updated`

### 2.1 真实转换与发射点

- 文档语义：`docs/product/knowledge.md` §3/§6「正式功能现状在结算时更新」「Settlement 执行更新」；`docs/architecture/data.md` §6「SQLite 的需求事实投影以 Git Hash 重建」；`workflow.md` §7「Settlement 核对…失效知识…最终文档 Revision」。即：**知识真正对读面可见，发生在投影被发布的那一刻**。
- 代码现状：唯一把知识写进本地状态的生产函数是 `createSqliteProjectionCache()`（`settlement.ts` L130 起）的 `put()`；它是 `docs/architecture/protocol.md` §4 的 `knowledge.list`/`knowledge.get` 读取的 `feature_projection` 表（`apps/daemon/src/protocol.ts:1637/1674`）。`applyKnowledgePatch()`（`settlement.ts` L529 起，"The knowledge patch"）与 `buildProjection()`（`packages/knowledge/src/projection.ts:742`）都汇聚到 `cache.put()`。
- 发射点：`put()` 内，写入 `feature_projection` 行之后、同一个 `withTransaction(store.db, ...)` 之内追加 `knowledge.updated`（L235–L249）。满足「与状态写入同一事务」。
- 恰好一次：`put()` 每次调用最多发射一次；`applyKnowledgePatch`/`buildProjection` 的发布路径每次转换调用一次 `put()`。
- **「无更新即无事件」负例**：新增 `unchanged(revision, projection)`（L183）逐行比较 `(featureId, documentPath, documentHash, fields, relations, state)`。同一 revision 重复发布完全相同的内容时不重写行、不发射事件；被 `buildProjection` 拒绝的非法知识根本不调用 `put()`（只 `markStale`），因此也不发射。`markStale` 之后重新发布为 `valid` 会发射（可见性真实改变）。

### 2.2 entityId / entityVersion / data

`protocol.md` §7 只规定信封（`entityId`、`entityVersion`、`data` 为「变更后实体摘要及产物/错误引用」），未对 `knowledge.updated` 规定具体字段，因此按 §7 信封约定与同类先例（`provider.test_completed` 用「拥有该子实体的配置版本」，`apps/daemon/src/protocol.ts:5136`）取值：

- `entityId` = `store.projectId`（32 hex，符合 `entityIdSchema` 的 projectId 形式）：知识集属于 Project。
- `entityVersion` = 该 Project 行的当前 `version`（缺失时取 1）。
- `data` = `{projectId, revision, codeTreeRevision, state, featureIds[], featureCount, documentHashes{}}`：变更后投影的摘要。`featureIds` 排序稳定；`documentHashes` 是用于漂移检测的正文 Hash。
- 未新增 payload 键以外的东西：这些键是同一份投影对象上本来就有的字段名（`KnowledgeProjection.revision/codeTreeRevision/state/documentHashes`、`ProjectedFeature.featureId`）。

### 2.3 测试（真实 SQLite，非测试内直插）

`packages/core/test/settlement.integration.test.ts`：`describe('Knowledge patch through the projection rules (AC-041)')` 内新增

```
it('emits knowledge.updated once on the real projection write and never without a change')  // L503
```

- harness 是真 Git 仓库 + 真 `project.sqlite`（`Store.open`），patch 走 `buildKnowledgePatch` → `applyKnowledgePatch` → `buildProjection` → `cache.put`，缓存是 `createSqliteProjectionCache({store})`。
- 断言：更新前 0 条；更新后**恰好 1 条**；`entityId`=projectId、`entityVersion`=Project 行 version；`data.revision/codeTreeRevision/state/featureCount/featureIds`；`data.documentHashes[FEATURE_PATH]` 等于 `cache.get(...)` 存下的 `documentHash`（事件摘要与落库状态一致）。
- 负例 A：同 patch 再发布一次 → 仍 1 条（无更新无事件）。
- 负例 B：非法知识（`implementation=shipped`）在新 revision 上被拒 → 仍 1 条（拒绝发布不发射）。

## 3. `recovery.report_ready`

### 3.1 真实转换与发射点

- 文档语义：`docs/architecture/reliability.md` §6 `RecoveryReport={workId,operationId,expectedVersions,runnerState,leases,gitHeads,diffRefs,toolOutcomes,externalEffects,unknowns,recommendedActions,hash}`「用户或 Core 可确定的只读/原子文件恢复不需要新增风险授权；未知副作用处置由用户选 resume/accept_cancel/abandon」；§7「收到 SIGKILL 或断电后按恢复流程核对，旧 Running 不可直接显示继续运行」。
- 真实转换：daemon 启动时 `apps/daemon/src/main.ts:509` → `packages/core/src/execution.ts:473` → `RunnerSupervisor.start()`（`supervisor.ts:338`）→ `RunRecoveryService.recoverAfterRestart(hostEpoch)`（`recovery.ts:482`）。它对每个仍可能存活的 Run 先 `buildReport()`（报告描述「重启发现的状态」，在任何 park 之前生成），再 `apply()` park，最后 `recordRestart()` 落一条 `recover` operation 行并记录 `reportHashes`。
- 发射点：`recordRestart()` 内（`recovery.ts:982`），与 `recover` operation 行写入同一 `withTransaction`（`recovery.ts:1013`），对**每份 report 恰好发射一次** `recovery.report_ready`（L1030–L1052）。
- 为什么不在 `buildReport()` 里发射：`buildReport()` 是纯读（公开方法），多次调用会重复发射，且没有可解析的落库地址；「报告就绪」的判定取「它已被持久记录」，因此挂在 `recordRestart()` 的事务里。
- 恰好一次：同一 host epoch 重复重启被 `VERSION_CONFLICT` 拒绝；新 epoch 的第二次重启已无 resumable Run（`inspectActive()` 过滤 `RESUMABLE_STATUSES`），`reports` 为空 → 不发射。
- 未覆盖：`restore`/`relocate` 路径（`recovery.ts:parkAll`）只调 `recoverRun()`、**不生成 report**，因此不发该事件——符合「data 必须带 report 引用」的语义，已在 §5 报告。

### 3.2 entityId / entityVersion / data / reportRef

`protocol.md` §4 给了 `recovery.inspect* | workId | accepted；recovery.report_ready` 与 `recovery.resolve* | workId,reportRef:Ref,…`，因此 `data` 必须给出可核对的 `reportRef`。§7 信封约定下取：

- `entityId` = `report.operationId`（= `run.id`，UUIDv7）：报告针对的那个 Run。
- `entityVersion` = `report.expectedVersions.run`：报告生成时（park 之前）该 Run 的版本，也就是 `recovery.resolve` 要核对的目标版本。
- `data` = `{runId, workId, hostEpoch, reportRef, reportHash, expectedVersions, runnerState, recommendedActions, requiresRecoveryDecision, newAttemptAllowed, unknownCount, externalEffectCount}`。其中 `runnerState/expectedVersions/recommendedActions` 与 `RecoveryReport` 同名字段逐一对应，其余是计数/判定摘要。
- `reportRef` = `{id: <recover operation 行 id>, version: 1, hash: report.hash}`：`id` 是真实 UUIDv7、`hash` 是 `reliability.md` §6 的 `RecoveryReport.hash`（报告是内容寻址的）。地址可解析：`stepResults.reports[]` 同时落 `{runId, workId, hash, reportRef}`（保留原 `reportHashes` 不删）。
- `data.workId` / `entityId` 使 `EventHub.matchesScope()` 的 `work` 与 `run` 范围都能收到该事件（见 §4）。

### 3.3 测试（真实 store + 真实重启驱动 + 真实 EventHub）

`packages/core/test/recovery.test.ts` 新增

```
it('announces each restart report once with a resolvable report reference (AC-061)')  // L799
```

- 真 `project.sqlite`（`Store.open`）、真 `RunRecoveryService`，驱动就是 daemon 启动调用的 `recoverAfterRestart(hostEpoch)`。
- 场景：Run 为 `running`、旧进程 `pid:1000` 仍存活 → park 为 `recovery_required`、`requiresRecoveryDecision=true`（正是需要人处置、因而需要「报告就绪」的情形）。
- 断言：`recovery.report_ready` **恰好 1 条**；`entityId`=RUN_ID、`entityVersion`=报告的目标 run 版本；`data.reportHash`=报告 hash、`data.runnerState/recommendedActions/unknownCount` 与报告一致、`requiresRecoveryDecision=true`、`newAttemptAllowed=false`；`reportRef.hash`=报告 hash、`reportRef.version=1`、`reportRef.id` 是 UUIDv7 且能在 `operation` 表按 `kind='recover'` 读回、`stepResults.reports` 含同一 hash；用真 `EventHub` 在重启前订阅 `run`/`work` 范围，`poll()` 都能收到该事件；第二次重启（新 epoch，无存活 Run）不再发射。

## 4. 投递面（要求 4）：现有 EventHub 是否通用投递新持久事件

**结论：是，通用投递，不需要并行机制，本次未新增任何投递代码。**

- `EventHub.poll()`（`events-hub.ts:330`）与 `subscribe()`（`:242`）直接 `store.events.readAfter(cursor)`，只用 `matchesScope()` 过滤，**没有任何事件名白名单**。因此任何新持久事件名（含本次两个）自动进入 cursor 流。
- `matchesScope()`（`:512`）：`summary` 全收；`work` 收 `entityId===workId` 或 `data.workId===workId`；`run` 同理。
  - `recovery.report_ready`：`entityId=runId` + `data.workId` → `run` 与 `work` 范围都收（测试已证）。
  - `knowledge.updated`：`entityId=projectId`、data 无 `workId` → **只有 `summary` 范围收**。`protocol.md` §2 的范围只有 `summary/conversation/work/run`，**没有 `knowledge` 范围**；知识是项目级事实，所以这是「缺一个 knowledge 订阅范围」而不是「缺投递机制」。本次按任务要求只报告、不新建机制。
- 证据：`packages/core/test/events-hub.integration.test.ts:448` 新增

```
describe('new persistent event names (WP-12 T9)')
it('delivers an unknown event name through the ordinary cursor path and scopes it by data')
```

用未在 hub 代码中登记过的两个名字 append 后，`poll()` 按 cursor 顺序全量投递、`scannedThrough`/`ack` 水位正确，并断言 `knowledge.updated` 不匹配 `work` 范围、`recovery.report_ready` 匹配 `work`/`run` 范围。

## 5. 冲突与裁决（`protocol.md` 是否要改）

### 5.1 `recovery.report_ready` 的文档触发点与真实转换不一致（**需上层裁决，本次按可靠性文档实现**）

- 文档触发点（`protocol.md:73`）：`recovery.inspect* | workId | accepted；recovery.report_ready` —— 事件挂在 **`recovery.inspect` 命令**上。
- 代码现实：`recovery.inspect` **整仓不存在**（审计 §2.1，归属 T4b）；真实产生并持久化报告的是启动恢复 `recoverAfterRestart()`（`reliability.md` §6/§7）。
- 两个选项：
  - **选项 A（文档字面）**：等 T4b 实现 `recovery.inspect`，由该命令发射。代价：事件要等 T4b；且 `recovery.inspect` 是读命令，按本仓库「读不发持久事件、每次转换恰好一次」的规则，读命令为同一份报告反复发事件会违反恰好一次。
  - **选项 B（本次实现）**：在报告真正被持久记录的转换处发射（启动恢复），每次重启每份报告恰好一次，且带可解析 `reportRef`。代价：`protocol.md:73` 的措辞需要补一句「启动恢复也发该事件」。
- 本次取 **B**：任务明确要求「`recovery.report_ready` 必须在报告按 `reliability.md` 真正就绪时发射，data 带报告引用」。**给 T4b 的注意**：若后续实现 `recovery.inspect`，不要让它对 `recoverAfterRestart` 已发射的同一份报告重复发射（同一转换只发一次）。

### 5.2 `knowledge.updated` 与 `protocol.md` §7

- §7 只列了事件名，未规定 `entityId/entityVersion/data` 形状；没有「文档写了但实现是别的名字」的情形，也没有写错的形状。按任务要求 5：**不改文档**。
- 真实缺口（不是文档错误，是接线缺口，归属 T5/结算接线切片）：`applyKnowledgePatch()` 目前**没有生产调用方**——`SettlementService` 在 `apps/daemon/src/bootstrap.ts:218` 被 `new` 出来后既没赋给 `services` 也没被 protocol 使用（`grep -rn "settlement" apps/daemon/src/*.ts` 无第三处命中）。因此 `knowledge.updated` 的发射点已经是生产代码（`createSqliteProjectionCache().put`），但「谁在 daemon 里调用它」仍缺。本次范围不含 `apps/**`，未接线；**不得据此宣称端到端可用**。

## 6. 反向排查（要求 6）：还有没有属于知识/恢复、且从未发射的文档事件

- 复核审计 §3.1 的「从未发出持久事件（6）」：`project.created`、`operation.failed`、`initialization.progress`、`initialization.completed`、`knowledge.updated`、`recovery.report_ready`。
  - 前四个按审计与任务书归属 **T5（多项目/初始化）**，不属知识/恢复服务（分别是项目创建、项目 clone/initialize 失败、初始化进度/完成）。
  - 后两个即本切片，已实现。
- 整仓复核（本工作树，排除 `dist`）：
  `project.created`=0、`initialization.progress`=0、`initialization.completed`=0、`operation.failed`=0、`knowledge.updated`=0→1、`recovery.report_ready`=0→1。
- 知识/恢复服务内「实现有、文档 §7 无」的既有事件（`run.recovered`、`stage.result_rejected`、`settlement.completed`）均有真实发射点，不是「从未发出」，本次不动；其中 `settlement.completed`（`settlement.ts:63`）、`run.recovered`（`recovery.ts:86`）、`stage.result_rejected`（`recovery.ts:92`）仍未被 §7 收录，属「补文档」类（审计 §3.3），不在本切片结论内。
- **反向结论：没有第三个属于知识/恢复服务的「从未发射」文档事件需要纳入。**

## 7. 未完成 / 未验证（诚实声明）

- **未执行独立 Review 与独立 Test**（工作流门禁要求由不同上下文执行）；本记录只提供实现与已执行命令证据，状态停在 `Developing`。
- 并发写入提醒：本切片进行期间另有车道持续编辑 `packages/core/src/settlement.ts`（追加 Requirement 完成摘要相关代码）与 `apps/daemon/**`。本切片改动位于 `settlement.ts` L84/L163–L250，在上述并发编辑后仍完整存在（§8.7 复核），本切片自己的测试在其后重跑仍全绿。
- 最终态（21:0x）：`pnpm typecheck` **exit 0**；`pnpm docs:check` **exit 0**；`pnpm test:unit` 75 files / 1405 tests **exit 0**；本切片三个测试文件定向重跑 **exit 0**。
- 定向 eslint 在**最终一轮**为 exit 1，但 2 条错误都在另一车道并发追加的块里（`settlement.integration.test.ts` L1137/L1244，见 §8.6）；本切片自己的行在上一轮为 exit 0，prettier 全绿。
- 完整 `pnpm test:integration` 最终一轮 **exit 1：2 failed / 457 passed（44 files）**，两条失败**都在 `apps/daemon/test/**`**，属并发车道，不是本切片：
  - `apps/daemon/test/tool-bridge.integration.test.ts`（T3b，真实 Runner 子进程）——`timed out waiting for the Chief assessment`，日志含 `INVALID_STATE: Work … is queued; only a running Work may mint a Grant`；
  - `apps/daemon/test/zzz-t2-diag.integration.test.ts`（另一车道的诊断副本，同名用例）。
  本切片新增/修改的三个测试文件在同一轮中全绿；最终一轮里 `packages/core/test/settlement.integration.test.ts` 也全绿（该文件里另一车道新增的 `describe('settlement completes the Requirement through the pool Git save (protocol.md §8)')` 在稍早一轮曾因 `finalTree 不是 SHA256：<Git OID>` 失败，属其自身在写，非本切片）。
- `docs/architecture/protocol.md` 未改（§5.2）；`docs/delivery/acceptance.md` 未改（Settlement 登记证据）。
- 临时流 `token.delta`/`log.delta`/`heartbeat`（审计 §3.2）归属本 T9 任务的其余部分，**本次未做**，需另开裁决（实现或文档降级）。

## 8. 证据：命令与真实输出

工作目录 `/Users/huyaohua/huyh/work/aigrouptool`；每条命令前 `export PATH="$HOME/.local/bin:$PATH"`。

### 8.1 `pnpm typecheck`

```
$ pnpm typecheck
$ tsc -p tsconfig.json --pretty false
[exit: 0]
```

（期间另一车道一度在 `apps/daemon/src/protocol.ts`、`apps/daemon/src/main.ts`、`packages/core/src/settlement.ts` 留下 12 条在写错误，已由其修复；本切片文件在所有轮次中均无错误。）

### 8.2 定向测试（本切片新增/修改）

```
$ pnpm test:unit packages/core/test/recovery.test.ts
 ✓ |unit| packages/core/test/recovery.test.ts (21 tests) 213ms
 Test Files  1 passed (1)
      Tests  21 passed (21)
exit=0

$ pnpm test:integration packages/core/test/settlement.integration.test.ts packages/core/test/events-hub.integration.test.ts
 Test Files  2 passed (2)
      Tests  31 passed (31)
exit=0

$ pnpm test:integration -t "knowledge.updated"
 Test Files  1 passed | 42 skipped (43)
      Tests  1 passed | 455 skipped (456)
exit=0
```

（改动前 `recovery.test.ts` 为 20 tests，现在 21；`events-hub.integration.test.ts` 由 18 增至 19；`settlement.integration.test.ts` 由 11 增至 12。以上计数用 `git show HEAD:<file> | grep -cE '^\s+it\('` 与工作树对比核过。）

### 8.3 `pnpm test:unit`（全量）

```
$ pnpm test:unit
 Test Files  75 passed (75)
      Tests  1405 passed (1405)
[exit: 0]
```

### 8.4 `pnpm test:integration`（全量，最终一轮）

```
$ pnpm test:integration
 FAIL  |integration| apps/daemon/test/tool-bridge.integration.test.ts > tool bridge vertical drill (T3b) > reads and edits a real file through the Broker, with a real Runner child
 FAIL  |integration| apps/daemon/test/zzz-t2-diag.integration.test.ts > tool bridge vertical drill (T3b) > reads and edits a real file through the Broker, with a real Runner child
 Test Files  2 failed | 42 passed (44)
      Tests  2 failed | 457 passed (459)
[exit: 1]
```

两处失败都在 `apps/daemon/test/**`（T3b/诊断副本车道），与本切片文件无关。工作树在并行开发下持续变化（该轮为 44 个 integration 文件、459 条用例），因此该数字是**该时刻**的真实值。

### 8.5 `pnpm docs:check`

```
$ pnpm docs:check
docs:check ok — 16 documents, 65 internal links, 94 acceptance cases, 9 requirements, 11 work packages
[exit: 0]
```

### 8.6 定向 eslint / prettier（本切片文件）

```
$ npx prettier --check packages/core/src/settlement.ts packages/core/src/recovery.ts \
    packages/core/test/settlement.integration.test.ts packages/core/test/recovery.test.ts \
    packages/core/test/events-hub.integration.test.ts
All matched files use Prettier code style!
[exit: 0]

$ NODE_OPTIONS="--require=$PWD/scripts/typescript-6-preload.cjs" npx eslint \
    packages/core/src/settlement.ts packages/core/src/recovery.ts \
    packages/core/test/settlement.integration.test.ts packages/core/test/recovery.test.ts \
    packages/core/test/events-hub.integration.test.ts
/Users/huyaohua/huyh/work/aigrouptool/packages/core/test/settlement.integration.test.ts
  1137:17  error  This assertion is unnecessary …  @typescript-eslint/no-unnecessary-type-assertion
  1244:19  error  This assertion is unnecessary …  @typescript-eslint/no-unnecessary-type-assertion
✖ 2 problems (2 errors, 0 warnings)
[exit: 1]
```

说明：
- 两处 eslint 错误**都不是本切片的行**：本切片在 `settlement.integration.test.ts` 的新增块是 diff hunk `@@ -501,0 +527,73 @@`（L527–L599，即 §2.3 那个用例）；报错的 L1137/L1244 落在 hunk `@@ -989,0 +1088,207 @@`，是另一车道在并发期间追加的 `describe('settlement completes the Requirement through the pool Git save (protocol.md §8)')`。本切片自己的行在早先一轮定向 eslint 中为 **exit 0**。
- 按任务要求「其它车道的失败要点名而不是代修」，本记录不修这两行（该车道正在写同一文件）。
- 直接 `npx eslint` 不走 `scripts/lint.mjs` 的 TS6 preload 会报 `typescript-eslint does not support TS 7.0`（环境级问题，非本切片）；带 preload 才能运行。未执行全仓 `pnpm lint`（其它车道大量未提交改动，其结论不代表本切片）。

### 8.7 并发写入后复核（本切片改动未被覆盖）

```
$ grep -n "KNOWLEDGE_UPDATED_EVENT\|const unchanged\|put(revision, projection)" packages/core/src/settlement.ts
84:export const KNOWLEDGE_UPDATED_EVENT = 'knowledge.updated';
183:  const unchanged = (revision: string, projection: KnowledgeProjection): boolean => {
207:    put(revision, projection) {
235:          name: KNOWLEDGE_UPDATED_EVENT,

$ grep -n "RECOVERY_REPORT_READY_EVENT\|private recordRestart" packages/core/src/recovery.ts
89:export const RECOVERY_REPORT_READY_EVENT = 'recovery.report_ready';
982:  private recordRestart(
1030:          name: RECOVERY_REPORT_READY_EVENT,
```

（另一车道把 `settlement.ts` 的 diff 从本切片的 +75 行扩到 +339 行；上述 grep 与随后的定向测试重跑证明本切片改动仍在且仍绿。）

## 9. 本切片未实现的事件（含归属切片）

| 文档 §7 事件 | 现状 | 归属切片 |
|---|---|---|
| `project.created` | 整仓 0 命中 | T5（多项目/初始化） |
| `operation.failed` | 整仓 0 命中 | T5 |
| `initialization.progress` | 整仓 0 命中 | T5（`packages/workspace/src/initialize.ts` 无生产调用方） |
| `initialization.completed` | 整仓 0 命中 | T5 |
| `token.delta` / `log.delta` / `heartbeat` | 临时流，整仓 0 命中 | T9 余项（本次未做，需裁决实现或文档降级） |
| `knowledge.updated` | **本次已发射**（`settlement.ts:235`） | T9（本切片） |
| `recovery.report_ready` | **本次已发射**（`recovery.ts:1030`） | T9（本切片） |
