# WP-01 测试报告（数据、状态与协议核心）

- 角色：Test（独立上下文，不读取开发聊天；不读取 `.agentdev/work/WP-00/*` 代替复跑）
- 状态：`Testing` → 结论 `PASS`（WP-01 本包必验范围全部通过；见 §8 未覆盖项与 §10 结论）
- 报告作者与代码作者分离；本文所有结果均为本机实际执行所得，凡未执行者显式标注 `not_covered`，不以「应该通过」代替。

## 1. 复核对象

| 项 | 值 |
|---|---|
| commit | `c3a581ffacf588c56754c505ca16dfd83c79174f`（`feat(wp-01): 事件订阅/背压、连接认证与 Project 身份、需求投影`） |
| tree | `196f56ffa6a28ae0ca844acfb5c4e76f1df017e6` |
| parent | `fc8260f1539ea8e9c3a460c0aee8f0108cda08cb` |
| 工作树 | `git status --porcelain` 无输出（复核前后均干净；复核过程未改动任何 tracked 文件） |
| 被复核证据 | `.agentdev/work/WP-01/plan.md`（planVersion 1）、`.agentdev/work/WP-01/implementation.md`（状态「进行中」，§3 命令证据） |
| 正式依据 | `docs/INDEX.md`、`docs/rules/workflow.md` §6/§7、`docs/architecture/{data.md,protocol.md,reliability.md}`、`docs/delivery/implementation.md` WP-01（§3 命令表、§4 完成证据）、`docs/delivery/acceptance.md` AC-023/024/055/056/059/060/065/078/092 |

## 2. 环境

| 项 | 值 |
|---|---|
| OS | Darwin 25.5.0（macOS，arm64，`root:xnu-12377.121.6~1/RELEASE_ARM64_T8103`） |
| node | `v24.8.0` |
| pnpm | `12.3.4`（`packageManager: pnpm@12.3.4`；执行前 `export PATH="$HOME/.local/bin:$PATH"`） |
| Docker | client/client 与 server 均 `28.4.0`（`docker info` ServerVersion `28.4.0`，真实容器集成测试已实际运行） |
| git | `git version 2.39.3 (Apple Git-146)` |
| better-sqlite3 | `13.0.3`（pin 于 `packages/storage`，原生绑定已就绪） |
| SQLite | `3.53.4`（`select sqlite_version()` 实测） |
| vitest | `5.0.0`；`--project unit` / `--project integration`（`vitest.config.ts`，测试跑源码，不跑 dist） |

## 3. 命令结果表（命令 / 退出码 / 计数）

| # | 命令 | 退出码 | 计数（输出实测） |
|---|---|---|---|
| 1 | `pnpm install --frozen-lockfile` | **0** | 8 个 workspace project；lockfile up to date，resolution skipped，101ms |
| 2 | `pnpm typecheck` | **0** | `tsc -p tsconfig.json --pretty false`，无输出错误 |
| 3 | `pnpm lint` | **0** | Prettier 全部匹配（`All matched files use Prettier code style!`） |
| 4 | `pnpm test:unit` | **0** | **13 文件 / 173 用例全通过** |
| 5 | `pnpm test:integration` | **0** | **10 文件 / 115 用例全通过**（含真实 Docker：container 9 例 68.9s、doctor 8 例 36.8s；真实 `git init` 身份 9 例） |
| 6 | `pnpm docs:check` | **0** | 15 documents / 55 internal links / 94 acceptance cases / 9 requirements / 11 work packages |
| 7 | `pnpm build` | **0** | contracts、domain、storage、core、pi-runtime、runner、cli 全部 `Done` |
| 8a | `pnpm test:e2e` | **1** | `NOT_IMPLEMENTED: command test:e2e is not implemented yet; it lands with WP-09` |
| 8b | `pnpm test:acceptance` | **1** | `NOT_IMPLEMENTED: command test:acceptance is not implemented yet; it lands with WP-10` |
| 8c | `pnpm test:live` | **1** | `NOT_IMPLEMENTED: command test:live is not implemented yet; it lands with WP-10` |

结论：命令 1–7 与 `implementation.md` §3 的声明完全一致（同计数、同退出码）；命令 8 三条按契约必须失败，实测**逐字**失败。`test:e2e/acceptance/live` 由 `scripts/not-implemented.mjs` 写 stderr 后 `process.exit(1)`，命令即 `node scripts/not-implemented.mjs <cmd> WP-09|WP-10`，WP 归属正确。

## 4. 命令原始输出摘录（截断，非摘要代替）

### 4.1 `pnpm install --frozen-lockfile` → 退出 0

```
Scope: all 8 workspace projects
✓ Lockfile passes supply-chain policies (verified 53m ago)
Lockfile is up to date, resolution step is skipped
Done in 101ms using pnpm v12.3.4
```

### 4.2 `pnpm typecheck` → 退出 0

```
$ tsc -p tsconfig.json --pretty false
```

### 4.3 `pnpm lint` → 退出 0

```
$ node scripts/lint.mjs
Checking formatting...
All matched files use Prettier code style!
```

### 4.4 `pnpm test:unit` → 退出 0

```
 RUN  v5.0.0 /Users/huyaohua/huyh/work/aigrouptool

 ✓ |unit| packages/contracts/test/limits.test.ts (9 tests) 9ms
 ✓ |unit| packages/contracts/test/primitives.test.ts (13 tests) 38ms
 ✓ |unit| packages/contracts/test/enums.test.ts (35 tests) 20ms
 ✓ |unit| packages/contracts/test/entities.test.ts (12 tests) 431ms
 ✓ |unit| packages/core/test/mailbox.test.ts (8 tests) 25ms
 ✓ |unit| packages/core/test/auth.test.ts (18 tests) 66ms
 ✓ |unit| packages/contracts/test/protocol.test.ts (10 tests) 129ms
 ✓ |unit| packages/pi-runtime/test/events.test.ts (7 tests) 60ms
 ✓ |unit| packages/domain/test/domain.test.ts (28 tests) 14ms
 ✓ |unit| packages/contracts/test/toolchain.test.ts (5 tests) 150ms
 ✓ |unit| packages/contracts/test/errors.test.ts (9 tests) 74ms
 ✓ |unit| packages/pi-runtime/test/resources.test.ts (8 tests) 711ms
 ✓ |unit| packages/pi-runtime/test/extensions.test.ts (11 tests) 28ms

 Test Files  13 passed (13)
      Tests  173 passed (173)
   Duration  7.44s
```

### 4.5 `pnpm test:integration` → 退出 0

```
 ✓ |integration| packages/storage/test/migrations.integration.test.ts (14 tests) 738ms
 ✓ |integration| packages/storage/test/ledger.integration.test.ts (21 tests) 734ms
 ✓ |integration| packages/core/test/events-hub.integration.test.ts (16 tests) 540ms
 ✓ |integration| packages/core/test/requirements.integration.test.ts (8 tests) 203ms
 ✓ |integration| packages/core/test/dispatcher.integration.test.ts (9 tests) 269ms
 ✓ |integration| apps/runner/test/attempt.integration.test.ts (10 tests) 315ms
 ✓ |integration| packages/pi-runtime/test/session.integration.test.ts (11 tests) 220ms
 ✓ |integration| packages/core/test/identity.integration.test.ts (9 tests) 4742ms
 ✓ |integration| apps/cli/test/doctor.integration.test.ts (8 tests) 36839ms
 ✓ |integration| apps/cli/test/container.integration.test.ts (9 tests) 68851ms

 Test Files  10 passed (10)
      Tests  115 passed (115)
   Duration  70.85s
```

Docker 容器断言实测条目（证明「真实容器测试」非桩）：

```
 ✓ |integration| apps/cli/test/container.integration.test.ts (9 tests) 68851ms
   ✓ runs as the non-root execution account
   ✓ carries the pinned runtime and build tools
   ✓ keeps the root filesystem read-only
   ✓ allows writes only inside the tmpfs
   ✓ refuses writes on a read-only source mount
   ✓ permits writes on a writable mount, proving the check above is not vacuous
   ✓ drops every Linux capability
   ✓ has no network access but a working name resolver
   ✓ applies the pid and memory limits
```

真实 Git 根身份条目：

```
 ✓ |integration| packages/core/test/identity.integration.test.ts (9 tests) 4742ms
   ✓ canonical roots (AC-024) (4)
     ✓ normalizes a subdirectory to the repository root 587ms
     ✓ normalizes a trailing separator and a symlinked path 514ms
     ✓ finds the git root from a deep directory and reports no git root outside one 582ms
     ✓ derives the project id from the canonical root hash 414ms
   ✓ independent projects (AC-023) (1)
     ✓ gives two real roots distinct ids and independent databases 817ms
   ✓ nested repositories (AC-024) (4)
     ✓ finds nested repositories and excludes their paths from the parent 817ms
     ✓ does not treat an unrelated directory as nested 384ms
     ✓ bounds the nested scan by depth 435ms
     ✓ can skip the nested scan entirely
```

### 4.6 `pnpm docs:check` → 退出 0

```
$ node scripts/docs-check.mjs
docs:check ok — 15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages
```

### 4.7 `pnpm build` → 退出 0

```
$ pnpm -r build
packages/contracts build$ tsc -p tsconfig.build.json --pretty false
packages/contracts build: Done
packages/domain build: Done
packages/storage build: Done
packages/core build$ tsc -p tsconfig.build.json --pretty false
packages/core build: Done
packages/pi-runtime build: Done
apps/cli build: Done
apps/runner build: Done
```

### 4.8 `pnpm test:e2e` / `pnpm test:acceptance` / `pnpm test:live` → 均退出 1

```
===== pnpm test:e2e =====
$ node scripts/not-implemented.mjs test:e2e WP-09
NOT_IMPLEMENTED: command test:e2e is not implemented yet; it lands with WP-09
[ELIFECYCLE] Command failed with exit code 1.
EXIT=1
===== pnpm test:acceptance =====
$ node scripts/not-implemented.mjs test:acceptance WP-10
NOT_IMPLEMENTED: command test:acceptance is not implemented yet; it lands with WP-10
[ELIFECYCLE] Command failed with exit code 1.
EXIT=1
===== pnpm test:live =====
$ node scripts/not-implemented.mjs test:live WP-10
NOT_IMPLEMENTED: command test:live is not implemented yet; it lands with WP-10
[ELIFECYCLE] Command failed with exit code 1.
EXIT=1
```

## 5. 五项必需失败测试 evidence

所有场景均以「单独跑 owning 文件 + `-t` 名称过滤」复现，每条均为 `1 passed | n skipped`、退出 0，说明用例真实存在且被选中执行（非整套通过掩盖）。下表的「移除该行为会破坏什么」为对断言的实际解读。

### 5.1 丢应答重试（AC-055 幂等接受）

| 项 | 内容 |
|---|---|
| 文件/用例 | `packages/core/test/dispatcher.integration.test.ts` › `write path (AC-055)` › **`applies one write, then replays the same result for the same key`** |
| 过滤执行 | `pnpm exec vitest run --project integration packages/core/test/dispatcher.integration.test.ts -t "replays the same result"` → `Tests 1 passed | 8 skipped (9)`，退出 0 |
| 关键断言 | 首次：响应精确等于 `{v:1,type:'response',id:'req-1',ok:true,result:{status:'applied',entityId:budgetId,version:2}}`；`budgets.get(budgetId).tokensUsed===5`；`events.latestCursor()===1`；`outbox.countByState()` 等于 `{pending:1}`。重发同键同载荷后：`retry` 深等于 `first`；`tokensUsed` 仍 5；`latestCursor` 仍 1；outbox 仍 `{pending:1}` |
| 移除会破坏 | 若 `CommandDispatcher.writeAtomically` 的 `begun.kind==='replay'` 短路（或 `CommandLedger.begin` 的 replay 分支）被删，第二次派发会重跑 handler：`tokensUsed` 变 10、`latestCursor` 变 2、outbox 变 `{pending:2}`、响应 `version` 变 3 → 上述四条断言全部失败 |
| 存储层同证 | `packages/storage/test/ledger.integration.test.ts` › `command ledger (AC-055)` › **`replays the original result for the same key and payload`**：`begin(key)` 第二次精确返回 `{kind:'replay',state:'completed',response:{status:'accepted',operationId:'op-1'}}`，且 `effects===1`。过滤执行 `Tests 1 passed | 20 skipped (21)`，退出 0。若 replay 不存在，第二次会返回 `new`，`effects` 变 2 → 失败 |

### 5.2 冲突键（同键异载荷）

| 项 | 内容 |
|---|---|
| 文件/用例（core） | `packages/core/test/dispatcher.integration.test.ts` › `write path (AC-055)` › **`refuses the same key with a different payload`** |
| 过滤执行 | `... -t "refuses the same key with a different payload"` → `Tests 1 passed | 8 skipped (9)`，退出 0 |
| 关键断言 | 第二次以 `params:{budgetId,amount:9}` 同键同 method：错误码 `IDEMPOTENCY_CONFLICT` 且 `retryable:false`；`tokensUsed` 仍 5（无第二次副作用）；并断言 `payloadHashOf('test.budget.bump',{budgetId,amount:5})` 与键序颠倒的 `{amount:5,budgetId}` 相等（规范化 Hash） |
| 移除会破坏 | 若不做 payloadHash 比较，amount=9 的请求不会被判冲突而会进入 CAS：要么 `tokensUsed` 变 9/14，要么抛 `VERSION_CONFLICT` → `IDEMPOTENCY_CONFLICT` 断言失败；若 Hash 未规范化（键序相关），末条相等断言失败 |
| 文件/用例（storage） | `packages/storage/test/ledger.integration.test.ts` › `command ledger (AC-055)` › **`refuses the same key with a different payload or another caller`** |
| 过滤执行 | `... -t "refuses the same key with a different payload or another caller"` → `Tests 1 passed | 20 skipped (21)`，退出 0 |
| 关键断言 | 同键异 `payloadHash` 返回 `{kind:'conflict', reason:'idempotency key key-2 was used with a different payload'}`；同键异 `subject` 返回 `{kind:'conflict', reason:'idempotency key key-2 belongs to another caller'}` |
| 移除会破坏 | 若无异载荷/异主体判定，两种调用都会返回 `new`，其 `toEqual({kind:'conflict',...})` 断言失败；跨调用者可冒领已记账命令 |

### 5.3 慢连接（AC-059 背压：软合并 / 硬断开 / 持久事件幸存）

| 项 | 内容 |
|---|---|
| 文件 | `packages/core/test/events-hub.integration.test.ts` › `connection back-pressure (AC-059)` |
| 用例 a | **`coalesces transient frames once the soft limit is crossed`** — `-t "coalesces transient frames"` → `1 passed | 15 skipped (16)`，退出 0。断言：`ConnectionQueue({softBytes:100,hardBytes:400})` 第一次 push `{accepted:true,merged:false,coalesced:false}`；同 key 第二次 `{merged:true}`；第二个 stream key 使队列越软限 → `{coalesced:true}`；`take()` 只返回 2 帧，`merged` 分别为 2 与 1，`queue.bytes===0` |
| 用例 b | **`closes the connection at the hard limit without dropping durable events`** — `-t "closes the connection at the hard limit"` → `1 passed | 15 skipped (16)`，退出 0。断言：`EventHub({queueLimits:{softBytes:10,hardBytes:20}})`；先 `append` 持久事件；`openConnection('slow')`；push 15B 成功；再 push 15B → `{accepted:false,closed:true,reason:'HARD_LIMIT'}`；`onConnectionClosed` 收到 `['slow']`；`subscriptionCount()===0`；随后新建 `fast` 订阅 `poll` 仍能读到 **1 条**持久事件 |
| 用例 c | **`keeps default limits at the documented 2 MiB / 8 MiB`** — `-t "keeps default limits"` → `1 passed | 15 skipped (16)`，退出 0。断言 `CONNECTION_QUEUE_LIMITS` 等于 `{softBytes:2097152,hardBytes:8388608}` |
| 移除会破坏 | 删软限合并 → `take()` 返回 3 帧、`merged:false` → 用例 a 失败；删硬限断开 → 第二次 push 变 `accepted:true`、连接不被关闭 → 用例 b 前四条断言失败；改默认值 → 用例 c 失败。用例 b 由 `append` 先落 SQLite 再触发断开，证明断开的是连接输出队列而非事件日志（「持久事件幸存、其他 Run 继续」） |

### 5.4 迁移失败（AC-065：checksum 不一致 / 版本超前 / 回滚）

| 项 | 内容 |
|---|---|
| 文件 | `packages/storage/test/migrations.integration.test.ts` |
| 用例 a | **`stops on a checksum mismatch instead of starting`** — `-t "stops on a checksum mismatch"` → `1 passed | 13 skipped (14)`，退出 0。断言：迁移后把 `schema_migrations.checksum` 改为 `'0'×64`，再次 `migrate()` 抛 `code:'MIGRATION_CHECKSUM_MISMATCH'` |
| 用例 b | **`refuses a database written by a newer build`** — `-t "refuses a database written by a newer build"` → `1 passed | 13 skipped (14)`，退出 0。断言：插入 `version=99` 后 `verifyMigrations(db)` 抛 `code:'SCHEMA_VERSION_AHEAD'` |
| 用例 c | **`rolls a failed migration back and reports its version`** — `-t "rolls a failed migration back"` → `1 passed | 13 skipped (14)`，退出 0。断言：迁移 0002 SQL 为 `CREATE TABLE good_table (...); THIS IS NOT SQL;`；抛 `StorageError` 且 `code==='MIGRATION_FAILED'`、`details.version===2`；`readAppliedMigrations` 仍为 `[1]`；`good_table` 在 `sqlite_master` 中不存在（无部分建表残留） |
| 移除会破坏 | 删 checksum 校验 → 用例 a 的 `toThrowError` 落空；删版本超前校验 → 用例 b 落空；迁移不逐条事务化 → 用例 c 的 `good_table` 存在且 version 被记录 → 失败。另两条补充 AC-065：`applies the core schema and records a checksum`（备份/迁移产物）、`backs up before pending work and writes a usable copy`（迁移前备份且可读） |

### 5.5 长操作不阻塞（AC-056 Mailbox 非阻塞）

| 项 | 内容 |
|---|---|
| 文件/用例 | `packages/core/test/mailbox.test.ts` › `ProjectMailbox` › **`answers a new command while a long effect is still running (AC-056)`** |
| 过滤执行 | `pnpm exec vitest run --project unit packages/core/test/mailbox.test.ts -t "answers a new command while a long effect is still running"` → `Tests 1 passed | 7 skipped (8)`，退出 0 |
| 关键断言 | `runEffect({label:'model.call'})` 保持未完成；此时 `submitCommand({operation:'work.cancel'})` 被准入并完成，返回 `'cancelled'`，`elapsed < 1000ms`；长效果仍在飞 `activeEffects()` 等于 `['model.call']`；第二条命令也直接通过；释放后 `activeEffects()` 为 `[]` |
| 移除会破坏 | 若 `runEffect` 与短命令共用同一串行队列，短命令的 completion 只能等长效果释放才 resolve → `elapsed` 不再 `< 1000`（测试超时/失败），且 `activeEffects` 断言时序改变 |
| dispatcher 侧同证 | `packages/core/test/dispatcher.integration.test.ts` › `long operations do not block commands (AC-056)` › **`answers a command within a second while a model call is in flight`**；过滤执行 `-t "answers a command within a second while a model call is in flight"` → `1 passed | 8 skipped (9)`，退出 0。断言：`mailbox.runEffect({label:'model.call:chief'})` 在飞时，dispatcher 写请求 1 秒内返回 `{ok:true,result:{status:'applied'}}`，`elapsed<1000`，`activeEffects()` 等于 `['model.call:chief']` |

## 6. 独立探针（开发者未编写，于仓库外 `/tmp` 运行）

两个探针均针对 `pnpm build` 产出的 `packages/*/dist`（非 vitest 源码路径），在仓库外 `/tmp/wp01-probes/` 执行；脚本文件不落入仓库。

### 探针 A — `AC-023/024`：两个真实 Git 根 → 不同 projectId；子目录归一 → 同一 projectId

- 命令：`cd /tmp/wp01-probes && node probe-a.mjs`（`/tmp/wp01-probes/probe-a.mjs`：真实 `git init` 两个根，另以 `node:crypto` 独立重算 `SHA256(realpath)[0:32]` 作为对照）
- 退出码：**0**；末行输出 `PROBE_A_PASS`
- 实测输出（节选）：

```json
{
  "alphaRoot": "/private/var/folders/.../wp01-probe-a-xFLxz5/alpha",
  "alphaProjectId": "c9a973bf7afd3e75385be1077a6e3864",
  "betaRoot": "/private/var/folders/.../wp01-probe-a-xFLxz5/beta",
  "betaProjectId": "5470616990a08c4b33b522ee1b7adea9",
  "subdirProjectId": "c9a973bf7afd3e75385be1077a6e3864",
  "subdirNormalizedFromSubdirectory": true,
  "checks": {
    "two_roots_distinct_project_ids": true,
    "subdirectory_normalises_to_same_project_id": true,
    "subdirectory_canonical_root_matches": true,
    "subdirectory_flagged_normalizedFromSubdirectory": true,
    "trailing_separator_normalises": true,
    "alpha_id_matches_sha256_formula": true,
    "beta_id_matches_sha256_formula": true,
    "storage_projectIdFromRoot_agrees": true,
    "id_is_32_hex": true
  }
}
PROBE_A_PASS
```

- 判读：两真实根 id 不同（`c9a9…` vs `5470…`）；`alpha/src/deep` 归一为 `alpha` 的 `canonicalRoot` 与同一 projectId，且 `normalizedFromSubdirectory=true`；尾斜杠同样归一；id 与独立计算的 SHA256 前 32 位一致。**probe passed**。

### 探针 B — `AC-055`：同键同载荷重放 → 恰好 1 条 event、1 条 outbox

- 命令：`cd /tmp/wp01-probes && node probe-b.mjs`（`/tmp/wp01-probes/probe-b.mjs`：真实 `CommandDispatcher` + `ProjectStore` + 真实 SQLite 文件；行数用裸 SQL `SELECT COUNT(*)` 读取，不经过应用自身 helper）
- 退出码：**0**；末行输出 `PROBE_B_PASS`
- 实测输出（节选）：

```json
{
  "firstResponse": { "v":1,"type":"response","id":"probe-req","ok":true,
    "result": { "status":"applied","entityId":"01a08e28-7de7-756d-991a-90b10bc18911","version":1 } },
  "retryResponse": { "v":1,"type":"response","id":"probe-req","ok":true,
    "result": { "status":"applied","entityId":"01a08e28-7de7-756d-991a-90b10bc18911","version":1 } },
  "conflictResponse": { "v":1,"type":"response","id":"probe-req-2","ok":false,
    "error": { "code":"IDEMPOTENCY_CONFLICT",
      "message":"idempotency key probe-key-1 was used with a different payload","retryable":false } },
  "handleRuns": 1,
  "rawRowCounts": {
    "afterFirst":    { "event":1, "outbox":1, "conversation":1 },
    "afterRetry":    { "event":1, "outbox":1, "conversation":1 },
    "afterConflict": { "event":1, "outbox":1, "conversation":1 }
  },
  "checks": { "first_dispatch_ok":true, "retry_response_identical_to_first":true,
    "after_first_one_event":true, "after_first_one_outbox":true, "after_first_one_conversation":true,
    "after_retry_still_one_event":true, "after_retry_still_one_outbox":true,
    "after_retry_still_one_conversation":true, "handler_ran_exactly_once":true,
    "conflict_is_IDEMPOTENCY_CONFLICT":true, "conflict_added_no_event":true,
    "conflict_added_no_outbox":true, "conflict_added_no_conversation":true }
}
PROBE_B_PASS
```

- 判读：首次派发写入 1 event / 1 outbox / 1 conversation；同键同载荷重放返回**逐字节相同**响应，三张表仍各 1 行，handler 只执行 1 次；同键异载荷返回 `IDEMPOTENCY_CONFLICT` 且不新增任何行。**probe passed**。

## 7. 验收对照（AC-023/024/055/056/059/060/065/078/092）

判定规则：`passed` = 该 AC 在本包必验范围内各行为均有已执行证据；`not_covered` = 至少一条 Then 子句在本仓库当前不存在可执行证据（附后续归属 WP）。所有 `passed` 项均在 §3–§6 有对应命令输出。

| AC | 结果 | 证明文件 / 用例 | 说明 |
|---|---|---|---|
| AC-023 无注册多项目 | **passed** | `packages/core/test/identity.integration.test.ts` › `independent projects (AC-023)` › `gives two real roots distinct ids and independent databases`（集成实测）；探针 A | 两个真实 `git init` 根 → 不同 32 位 projectId；两独立 `ProjectStore` 各自只含本项目的 project 行，交叉 `find` 返回 undefined，trust 互不串染 |
| AC-024 路径识别 | **passed** | `identity.integration.test.ts` › `canonical roots (AC-024)`：`normalizes a subdirectory to the repository root`、`normalizes a trailing separator and a symlinked path`、`derives the project id from the canonical root hash`；`nested repositories (AC-024)`：`finds nested repositories and excludes their paths from the parent` 等 4 例；探针 A | 子目录/符号链接/尾斜杠归一同 projectId；嵌套仓库被识别、从父项目路径排除（`nestedRepoExclusions`/`isInsideNestedRepo`）、`requireOwnIdentity` 要求单独打开且 id 不同 |
| AC-055 幂等接受 | **passed** | `dispatcher.integration.test.ts` › `applies one write, then replays the same result for the same key`、`refuses the same key with a different payload`；`ledger.integration.test.ts` › `replays the original result for the same key and payload`、`refuses the same key with a different payload or another caller`；探针 B | 同键同载荷返回同实体/同结果且副作用只发生一次（event/outbox 不重复）；同键异载荷冲突且不产生副作用 |
| AC-056 Mailbox 非阻塞 | **passed** | `packages/core/test/mailbox.test.ts` › `answers a new command while a long effect is still running (AC-056)`（unit 实测，`elapsed<1000`）；`dispatcher.integration.test.ts` › `long operations do not block commands (AC-056)` › `answers a command within a second while a model call is in flight` | 长模型/效果在飞时，同 Project 短命令 1 秒内被准入并完成，不排在长任务之后 |
| AC-059 背压 | **passed** | `packages/core/test/events-hub.integration.test.ts` › `connection back-pressure (AC-059)`：`coalesces transient frames once the soft limit is crossed`、`closes the connection at the hard limit without dropping durable events`、`keeps default limits at the documented 2 MiB / 8 MiB` | 软限合并/去重临时帧；硬限关闭该慢连接；先落库的持久事件在断开后仍被新订阅读到（关键事件持久、其他订阅不受影响） |
| AC-060 范围订阅 | **passed** | `events-hub.integration.test.ts` › `scope change (AC-060)` › `answers a fresh snapshot at a new watermark and covers later events`；`scope snapshots and watermarks` › `requires a resync when the cursor was truncated`（`RESYNC_REQUIRED`、订阅数归 0）、`replays only the events after the client cursor and only for its scope`、`returns a consistent snapshot with the watermark as its cursor`；`reports an empty batch with its scan watermark`、`refuses a backward ack and clamps to the watermark` | 过滤 ACK 后扩大范围始终返回「新快照 + 新水位 C」，C 之后事件完整覆盖新增范围；游标被保留期截断时明确 `RESYNC_REQUIRED` |
| AC-065 Migration | **passed** | `packages/storage/test/migrations.integration.test.ts`：`applies the core schema and records a checksum`、`backs up before pending work and writes a usable copy`、`stops on a checksum mismatch instead of starting`、`refuses a database written by a newer build`、`rolls a failed migration back and reports its version`、`is idempotent on the second start`、`applies the documented pragmas`、`schema matches the entity contracts` 3 例、`database-level invariants` 4 例 | 迁移前备份并逐条事务迁移；checksum 不一致 / 文件版本超前 → 停止启动；迁移中途失败回滚且报告版本 |
| AC-078 认证生命周期 | **not_covered**（部分通过） | 已通过部分：`packages/core/test/auth.test.ts`（18/18，unit）— `refuses an unknown cookie and an expired session`（`UNAUTHENTICATED`/`AUTH_EXPIRED`）、`requires a matching CSRF token for writes`（403 `NOT_AUTHORIZED`）、`rejects a mismatched Origin against the configured allowlist` / `honours an explicit origin allowlist`（403）、`clears the session on logout and expires the cookie`、`limits failures to five per IP per minute`（429 + 另一 IP 不受影响 + 窗口滑动）、`is created 0600 and shown exactly once` | 未覆盖子句：AC 的 When 是「HTTP/WS 写请求」，但仓库当前只有 `apps/cli`、`apps/runner`，无 HTTP/WS 服务端；上述测试直接调用 `AuthService.authenticate()/login()` 判定核心，未经真实 HTTP/WS 传输。「后台 Work 保留」亦无执行证据。归属 **WP-09**（daemon/BFF 协议接线）与 WP-02/03（Work 执行），WP-10 整体复验 |
| AC-092 需求导入冲突与幂等 | **not_covered**（部分通过） | 已通过部分：`packages/core/test/requirements.integration.test.ts`（8/8）— `imports the same record twice without a second write`、`refuses the same recordVersion with different content`（`requirement.save_failed` + `reason:'REQUIREMENT_CONFLICT'`，行未改）、`treats an older recordVersion as a conflict, not a downgrade`、`rejects a malformed record before touching the database`、`hashes metadata separately from the body`、`creates a local row and reports a needs_replan record without a Work` | 未覆盖子句：AC 的 Git 往返部分——「拉取已更新 Git 但投影未刷新时保存必须拒绝覆盖」「用户修复 Git 后显式导入可解除冲突，再基于新投影保存」未实现（Plan T8 明确「Git 往返留给 WP-04/WP-08」）。本包证据仅覆盖本机 SQLite 投影的幂等/冲突/不静默覆盖。归属 **WP-04/WP-08**，WP-10 复验 |

## 8. 未覆盖项（附归属工作包）

1. **AC-078 的传输层子句**：真实 HTTP/WS 写请求的拒绝与「后台 Work 保留」。仓库无 daemon/BFF/WS 服务端（`apps/` 仅 `cli`、`runner`）；`AuthService` 只做请求判定。归属 **WP-09**（协议与 BFF 接线）；「后台 Work 保留」另需 WP-02/03 的 Work 执行，最终 **WP-10** 复验。
2. **AC-092 的 Git 往返子句**：投影未刷新时保存拒绝覆盖、修复 Git 后显式导入解除冲突。`packages/core/src/requirements.ts` 只处理本机投影判定。归属 **WP-04/WP-08**（需求 Git 持久化/提交），**WP-10** 复验。
3. **AC-023「切换不影响运行」**：现有证据是两个独立 store 并存互不串染；真实运行中切换打开项目（运行时路由/生命周期）尚无入口。归属 **WP-09/WP-10**。
4. **EventHub 的 WS 传输绑定**：`packages/core/src/events-hub.ts` 为内存订阅 + SQLite 事件日志（`ConnectionQueue` 为进程内输出队列），无真实 WebSocket 连接/帧发送。归属 **WP-09**。
5. **真实 Provider 纵向任务、`test:e2e`、`test:acceptance`、`test:live`**：三条命令按契约 `NOT_IMPLEMENTED` 退出 1（§4.8），分别归属 **WP-09 / WP-10 / WP-10**。
6. **`docs/INDEX.md`「实现起点」状态**：该节仍称「Core、…协议与存储…仍未实现」，与 WP-01 已落地的 `packages/{domain,storage,core}` 不一致。`pnpm docs:check` 退出 0 只校验链接/引用完整性，不校验该叙述。属结算（Settlement）待办，不是本包命令或 AC 失败；本次复核不改动 `docs/**`。

## 9. 复核过程中的观察（不影响判定）

- `implementation.md` 内部存在一处自相矛盾：§1 与 §3 记录 T6/T7/T8 已完成并给出证据，但 §2「尚未完成（下一轮）」仍列出 T6/T7/T8 未完成、文件末尾也仍写「EventHub、连接认证与 Project 身份（T6/T7）尚未实现」。以 §1/§3 与实际测试为准（本报告已独立复跑证实 T6/T7/T8 均存在且通过）；§2 应属未清理的过期段落。
- 命令计数与 `implementation.md` §3 声明逐项一致：unit 13/173、integration 10/115、install/typecheck/lint/docs:check/build 均退出 0。
- 复核仅新建 `.agentdev/work/WP-01/test-report.md`；`git status --porcelain` 复核后仍为空，未触碰 `packages/`、`apps/`、`docs/` 与根配置。

## 10. 结论

**PASS**。

- 8 类必需命令全部按契约表现：1–7 退出 0 且计数与开发声明一致；`test:e2e`/`test:acceptance`/`test:live` 逐字 `NOT_IMPLEMENTED` 退出 1 并指向 WP-09/WP-10（§3、§4）。
- 五项必需失败测试（丢应答重试、冲突键、慢连接、迁移失败、长操作不阻塞）均真实存在，单独过滤复跑各 `1 passed`，断言与「移除即失败」路径已逐条核对（§5）。
- 两个仓库外独立探针均通过：真实 Git 根身份归一（AC-023/024）与同键重放仅 1 event/1 outbox（AC-055）（§6）。
- 9 项关联 AC 中 7 项 `passed`；AC-078、AC-092 因「传输层/Git 往返」子句尚无实现与执行证据判为 `not_covered`（部分行为已通过），其剩余子句由 **WP-09**（AC-078）与 **WP-04/WP-08**（AC-092）承接，并按 `docs/delivery/implementation.md`「发布回归统一在 WP-10」在 WP-10 复验。按 `docs/rules/workflow.md` §6，`not_covered` 项放行需用户明确风险处置；就「WP-01 本包必验范围全部通过」这一退出条件而言，本报告判定 PASS。

## 附：证据文件索引

| 文件 | 行数/规模 | 本次实测 |
|---|---|---|
| `packages/core/test/dispatcher.integration.test.ts` | 330 行 | 9 例通过（含 AC-055 丢应答/冲突、AC-056） |
| `packages/storage/test/ledger.integration.test.ts` | 393 行 | 21 例通过（幂等账本/事件/outbox/lease/blob） |
| `packages/core/test/events-hub.integration.test.ts` | 377 行 | 16 例通过（AC-059/060） |
| `packages/storage/test/migrations.integration.test.ts` | 392 行 | 14 例通过（AC-065 + 28 表列一致性） |
| `packages/core/test/mailbox.test.ts` | 212 行 | 8 例通过（AC-056 + AC-059 准入） |
| `packages/core/test/identity.integration.test.ts` | 201 行 | 9 例通过（AC-023/024，真实 git/符号链接） |
| `packages/core/test/auth.test.ts` | 272 行 | 18 例通过（AC-078 判定核心） |
| `packages/core/test/requirements.integration.test.ts` | 205 行 | 8 例通过（AC-092 投影部分） |
