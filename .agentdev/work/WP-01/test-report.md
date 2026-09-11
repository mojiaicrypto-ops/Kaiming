# WP-01 测试报告（数据、状态与协议核心）

- 角色：Test（独立上下文；不读取开发聊天，不把 `.agentdev/work/WP-00/*` 的历史结论当作本包证据；不读取本文之前的历史 test-report 作为通过依据）
- 状态：`Testing` → 结论 `PASS`（就 WP-01「本包必验范围」与退出条件；AC-078/AC-092 的子句未覆盖见 §8）
- 声明：本文所有计数、退出码与断言均为本机在**当前 HEAD 树**上实际执行所得；未执行者显式标 `not_covered`，不以「应该通过」代替。本报告为对 `/Users/huyaohua/huyh/work/aigrouptool/.agentdev/work/WP-01/test-report.md` 的完整替换（旧报告绑定 tree `196f56ff…`，已不再代表 HEAD）。

## 1. 复核对象

| 项 | 值（实测） |
|---|---|
| commit | `9c634f0ed6232902c5aa46820ccc64c839873849` |
| tree | `981746cbd665339a1ecdf09bbb627b1bfb0ab38a` |
| 命令 | `git rev-parse HEAD && git rev-parse HEAD^{tree} && git status --short` → 前两行如上，第三行无输出 |
| parent | `8e96ee2df29db589653e9fbfedd0569ea3217a96`（`fix(wp-01): 独立 Review 发现的两项 P1 与相关 P2/P3`） |
| HEAD 主题 | `fix(wp-01): 复评 NF-01/NF-03 与记录计数、Discovery 归档` |
| 工作树 | 复跑开始时干净（仅本报告写入后出现 ` M .agentdev/work/WP-01/test-report.md`）；未改动 `packages/`、`apps/`、`docs/` 与根配置 |
| 被复核证据 | `.agentdev/work/WP-01/{plan.md,implementation.md,discovery.md,review.md}` |
| 正式依据 | `AGENTS.md`、`docs/INDEX.md`、`docs/rules/workflow.md` §6/§7、`docs/architecture/{data.md,protocol.md,reliability.md}`、`docs/delivery/implementation.md` §2 WP-01/§3/§4、`docs/delivery/acceptance.md` AC-023/024/055/056/059/060/065/078/092 |

被复核的「新增修复」四项目标（复评 NF-01/NF-02 与 T8 的 T8 两项 P1）在本次全部实测：需求记录路径为文档目录、事件 append 失败不留投影行、连续迁移不因备份文件冲突、冻结 0001 checksum 一致（§5.3、§6、§7）。

## 2. 环境

| 项 | 值（实测） |
|---|---|
| OS | Darwin 25.5.0（macOS，arm64，`root:xnu-12377.121.6~2/RELEASE_ARM64_T8103`；主机名 `huyaohuadeMacBook-Pro.local`） |
| node | `v24.8.0`（`/opt/homebrew/bin/node`） |
| pnpm | `12.3.4`（`/Users/huyaohua/.local/bin/pnpm`；执行前均 `export PATH="$HOME/.local/bin:$PATH"`；`packageManager: pnpm@12.3.4`） |
| Docker | `Docker version 28.4.0, build d8eb465f86`；`docker info` ServerVersion `28.4.0`，驱动 `overlayfs`（真实容器集成测试已实际运行） |
| git | `git version 2.39.3 (Apple Git-146)` |
| better-sqlite3 | `13.0.3`（pin 于 `packages/storage`） |
| SQLite | `3.53.4`（`select sqlite_version()` 实测） |
| vitest | `5.0.0`（`--project unit` / `--project integration`；测试跑源码，不跑 dist） |
| 构建产物 | `pnpm build` 已执行；仓库外探针以 `packages/*/dist` 为被测对象（§7） |

## 3. 命令结果表（命令 / 退出码 / 计数）

| # | 命令 | 退出码 | 计数（实测） |
|---|---|---|---|
| 1 | `pnpm install --frozen-lockfile` | **0** | 8 个 workspace project；lockfile up to date，resolution skipped，132ms |
| 2 | `pnpm typecheck` | **0** | `tsc -p tsconfig.json --pretty false`，无错误输出 |
| 3 | `pnpm lint` | **0** | Prettier 全匹配（`All matched files use Prettier code style!`） |
| 4 | `pnpm test:unit` | **0** | **13 文件 / 173 用例全通过** |
| 5 | `pnpm test:integration` | **0** | **10 文件 / 122 用例全通过**（含真实 Docker：container 9 例 41.9s、doctor 8 例 17.3s） |
| 6 | `pnpm docs:check` | **0** | 15 documents / 55 internal links / 94 acceptance cases / 9 requirements / 11 work packages |
| 7 | `pnpm build` | **0** | contracts、domain、storage、core、pi-runtime、cli、runner 全部 `Done` |
| 8a | `pnpm test:e2e` | **1** | `NOT_IMPLEMENTED: command test:e2e is not implemented yet; it lands with WP-09` |
| 8b | `pnpm test:acceptance` | **1** | `NOT_IMPLEMENTED: command test:acceptance is not implemented yet; it lands with WP-10` |
| 8c | `pnpm test:live` | **1** | `NOT_IMPLEMENTED: command test:live is not implemented yet; it lands with WP-10` |

逐文件计数（实测）：

- unit（13/173）：contracts `protocol`(10)、`errors`(9)、`primitives`(13)、`entities`(12)、`limits`(9)、`enums`(35)、`toolchain`(5)；core `auth`(18)、`mailbox`(8)；domain `domain`(28)；pi-runtime `events`(7)、`resources`(8)、`extensions`(11)。
- integration（10/122）：migrations(16)、ledger(22)、dispatcher(10)、events-hub(17)、requirements(10)、identity(9)、pi-runtime `session`(11)、runner `attempt`(10)、cli `doctor`(8)、cli `container`(9)。

结论：命令 1–7 全部退出 0；命令 8 三条按契约必须失败，实测**逐字**输出 `NOT_IMPLEMENTED` 并指向 WP-09（e2e）/WP-10（acceptance、live），与 `scripts/not-implemented.mjs` 的 `process.exit(1)` 一致。

## 4. 命令原始输出摘录（截断，非摘要代替）

### 4.1 `pnpm install --frozen-lockfile` → 退出 0

```
Scope: all 8 workspace projects
✓ Lockfile passes supply-chain policies (verified 1h ago)
Lockfile is up to date, resolution step is skipped
Done in 132ms using pnpm v12.3.4
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

 ✓ |unit| packages/pi-runtime/test/events.test.ts (7 tests) 4ms
 ✓ |unit| packages/contracts/test/protocol.test.ts (10 tests) 11ms
 ✓ |unit| packages/contracts/test/errors.test.ts (9 tests) 12ms
 ✓ |unit| packages/contracts/test/primitives.test.ts (13 tests) 11ms
 ✓ |unit| packages/contracts/test/entities.test.ts (12 tests) 214ms
 ✓ |unit| packages/core/test/auth.test.ts (18 tests) 48ms
 ✓ |unit| packages/contracts/test/limits.test.ts (9 tests) 6ms
 ✓ |unit| packages/core/test/mailbox.test.ts (8 tests) 20ms
 ✓ |unit| packages/contracts/test/enums.test.ts (35 tests) 7ms
 ✓ |unit| packages/domain/test/domain.test.ts (28 tests) 11ms
 ✓ |unit| packages/contracts/test/toolchain.test.ts (5 tests) 3ms
 ✓ |unit| packages/pi-runtime/test/resources.test.ts (8 tests) 23ms
 ✓ |unit| packages/pi-runtime/test/extensions.test.ts (11 tests) 5ms

 Test Files  13 passed (13)
      Tests  173 passed (173)
   Duration  2.40s
```

### 4.5 `pnpm test:integration` → 退出 0（真实 Docker）

```
 ✓ |integration| packages/storage/test/migrations.integration.test.ts (16 tests) 600ms
 ✓ |integration| packages/storage/test/ledger.integration.test.ts (22 tests) 814ms
 ✓ |integration| packages/core/test/dispatcher.integration.test.ts (10 tests) 191ms
 ✓ |integration| packages/core/test/events-hub.integration.test.ts (17 tests) 349ms
 ✓ |integration| packages/core/test/requirements.integration.test.ts (10 tests) 325ms
 ✓ |integration| packages/core/test/identity.integration.test.ts (9 tests) 3247ms
 ✓ |integration| packages/pi-runtime/test/session.integration.test.ts (11 tests) 218ms
 ✓ |integration| apps/runner/test/attempt.integration.test.ts (10 tests) 292ms
 ✓ |integration| apps/cli/test/doctor.integration.test.ts (8 tests) 17342ms
 ✓ |integration| apps/cli/test/container.integration.test.ts (9 tests) 41897ms

 Test Files  10 passed (10)
      Tests  122 passed (122)
   Duration  42.63s
```

真实容器断言条目（证明「真实 Docker 容器测试」非桩）：

```
 ✓ |integration| apps/cli/test/container.integration.test.ts (9 tests) 41897ms
   ✓ runs as the non-root execution account 3800ms
   ✓ carries the pinned runtime and build tools 4205ms
   ✓ keeps the root filesystem read-only 2099ms
   ✓ allows writes only inside the tmpfs 4400ms
   ✓ refuses writes on a read-only source mount 2946ms
   ✓ permits writes on a writable mount, proving the check above is not vacuous 4248ms
   ✓ drops every Linux capability 3586ms
   ✓ has no network access but a working name resolver 7438ms
   ✓ applies the pid and memory limits 8647ms
```

### 4.6 `pnpm docs:check` → 退出 0

```
$ node scripts/docs-check.mjs
docs:check ok — 15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages
```

### 4.7 `pnpm build` → 退出 0

```
$ pnpm -r build
packages/contracts build: Done
packages/domain build: Done
packages/storage build: Done
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

方法与判定：每个场景都**单独跑 owning 文件 + `-t` 名称过滤**，确认用例真实存在且被选中执行（`1 passed | n skipped`、退出 0），而不是被整套通过掩盖；随后逐条读断言，写出「移除该行为会破坏什么」。

### 5.1 丢应答重试（AC-055 幂等接受）

| 项 | 内容 |
|---|---|
| 文件/用例 | `packages/core/test/dispatcher.integration.test.ts` › `write path (AC-055)` › **`applies one write, then replays the same result for the same key`** |
| 过滤执行 | `pnpm exec vitest run --project integration packages/core/test/dispatcher.integration.test.ts -t "replays the same result"` → `Tests 1 passed | 9 skipped (10)`，退出 **0** |
| 关键断言 | 首次：响应精确等于 `{v:1,type:'response',id:'req-1',ok:true,result:{status:'applied',entityId:budgetId,version:2}}`；`budgets.get(budgetId).tokensUsed===5`；`commands.lookup(SUBJECT,'test.budget.bump','key-1').state==='completed'`；`events.latestCursor()===1`；`outbox.countByState()` 等于 `{pending:1}`。同键同载荷重发后：`retry` 深等于 `first`；`tokensUsed` 仍 5；`latestCursor` 仍 1；outbox 仍 `{pending:1}` |
| 移除会破坏 | 若 `CommandDispatcher` 的 replay 短路（复用 `CommandLedger.begin` 返回的 `kind:'replay'` 与原 response）被删，第二次派发会重跑 handler：`tokensUsed` 变 10、`latestCursor` 变 2、outbox 变 `{pending:2}`、响应 `version` 变 3 → 上述四条断言全部失败 |
| 存储层同证 | `packages/storage/test/ledger.integration.test.ts` › `command ledger (AC-055)` › **`replays the original result for the same key and payload`**：过滤执行 `-t "replays the original result for the same key and payload"` → `Tests 1 passed | 21 skipped (22)`，退出 **0**；断言第二次 `begin` 精确返回 `{kind:'replay',state:'completed',response:{status:'accepted',operationId:'op-1'}}` 且 `effects===1`。若 replay 不存在，第二次返回 `new`、`effects` 变 2 → 失败 |

### 5.2 冲突键（同键异载荷）

| 项 | 内容 |
|---|---|
| 文件/用例（core） | `packages/core/test/dispatcher.integration.test.ts` › `write path (AC-055)` › **`refuses the same key with a different payload`** |
| 过滤执行 | `... -t "refuses the same key with a different payload"` → `Tests 1 passed | 9 skipped (10)`，退出 **0** |
| 关键断言 | 第二次以 `params:{budgetId,amount:9}` 同键同 method：错误码 `IDEMPOTENCY_CONFLICT` 且 `retryable:false`；`tokensUsed` 仍 5（无第二次副作用）；并断言 `payloadHashOf('test.budget.bump',{budgetId,amount:5})` 与键序颠倒的 `{amount:5,budgetId}` 相等（规范化 Hash） |
| 移除会破坏 | 若无 payloadHash 比较，amount=9 的请求不会被判冲突而会进入 CAS：要么 `tokensUsed` 变 9/14，要么抛 `VERSION_CONFLICT` → `IDEMPOTENCY_CONFLICT` 断言失败；若 Hash 未规范化（键序相关），末条相等断言失败 |
| 文件/用例（storage） | `packages/storage/test/ledger.integration.test.ts` › `command ledger (AC-055)` › **`refuses the same key with a different payload or another caller`** |
| 过滤执行 | `... -t "refuses the same key with a different payload or another caller"` → `Tests 1 passed | 21 skipped (22)`，退出 **0** |
| 关键断言 | 同键异 `payloadHash` 返回 `{kind:'conflict', reason:'idempotency key key-2 was used with a different payload'}`；同键异 `subject` 返回 `{kind:'conflict', reason:'idempotency key key-2 belongs to another caller'}` |
| 移除会破坏 | 无异载荷/异主体判定时两次调用都会返回 `new`，`toEqual({kind:'conflict',...})` 断言失败；跨调用者可冒领已记账命令 |

### 5.3 慢连接 / 背压（AC-059）

| 项 | 内容 |
|---|---|
| 文件 | `packages/core/test/events-hub.integration.test.ts` › `connection back-pressure (AC-059)` |
| 过滤执行 | `pnpm exec vitest run --project integration packages/core/test/events-hub.integration.test.ts -t "back-pressure"` → `Tests 3 passed | 14 skipped (17)`，退出 **0** |
| 用例 a | **`coalesces transient frames once the soft limit is crossed`** — `ConnectionQueue({softBytes:100,hardBytes:400})`：第一次 push `{accepted:true,merged:false,coalesced:false}`；同 key 第二次 `{merged:true}`；第二个 stream key 使队列越软限 → `{coalesced:true}`；`take()` 只返回 2 帧，`merged` 分别为 2 与 1，`queue.bytes===0` |
| 用例 b | **`closes the connection at the hard limit without dropping durable events`** — `EventHub({queueLimits:{softBytes:10,hardBytes:20}})`；先 `append` 持久事件；`openConnection('slow')`；push 15B 成功；再 push 15B → `{accepted:false,closed:true,reason:'HARD_LIMIT'}`；`onConnectionClosed` 收到 `['slow']`；`subscriptionCount()===0`；随后新建 `fast` 订阅 `poll` 仍能读到 **1 条**持久事件 |
| 用例 c | **`keeps default limits at the documented 2 MiB / 8 MiB`** — `CONNECTION_QUEUE_LIMITS` 等于 `{softBytes:2097152,hardBytes:8388608}` |
| 移除会破坏 | 删软限合并 → `take()` 返回 3 帧、`merged:false` → 用例 a 失败；删硬限断开 → 第二次 push 变 `accepted:true`、连接不被关闭 → 用例 b 前四条断言失败；改默认值 → 用例 c 失败。用例 b 先 `append` 再触发断开，证明断开的是连接输出队列而非事件日志（「关键事件持久、其他订阅继续」） |
| 残留 | 真实 WebSocket 帧发送与真实慢客户端 TCP 属 **WP-09**（§8）。 |

### 5.4 迁移失败（AC-065）

| 项 | 内容 |
|---|---|
| 文件 | `packages/storage/test/migrations.integration.test.ts` |
| 用例 a | **`stops on a checksum mismatch instead of starting`** — `-t "stops on a checksum mismatch"` → `1 passed | 15 skipped (16)`，退出 **0**。迁移后把 `schema_migrations.checksum` 改为 `'0'×64`，再次 `migrate()` 抛 `code:'MIGRATION_CHECKSUM_MISMATCH'` |
| 用例 b | **`refuses a database written by a newer build`** — `-t "refuses a database written by a newer build"` → `1 passed | 15 skipped (16)`，退出 **0**。插入 `version=99` 后 `verifyMigrations(db)` 抛 `code:'SCHEMA_VERSION_AHEAD'` |
| 用例 c | **`rolls a failed migration back and reports its version`** — `-t "rolls a failed migration back"` → `1 passed | 15 skipped (16)`，退出 **0**。迁移 0002 SQL 为 `CREATE TABLE good_table (...); THIS IS NOT SQL;`；抛 `StorageError` 且 `code==='MIGRATION_FAILED'`、`details.version===2`；`readAppliedMigrations` 仍为 `[1]`；`good_table` 在 `sqlite_master` 中不存在（无部分建表残留） |
| 移除会破坏 | 删 checksum 校验 → 用例 a 的 `toThrowError` 落空；删版本超前校验 → 用例 b 落空；迁移不逐条事务化 → 用例 c 的 `good_table` 存在且 version 被记录 → 失败。另两条补充 AC-065：`applies the core schema and records a checksum`、`backs up before pending work and writes a usable copy` |

### 5.5 长操作不阻塞（AC-056）

| 项 | 内容 |
|---|---|
| 文件/用例（unit） | `packages/core/test/mailbox.test.ts` › `ProjectMailbox` › **`answers a new command while a long effect is still running (AC-056)`** |
| 过滤执行 | `pnpm exec vitest run --project unit packages/core/test/mailbox.test.ts -t "answers a new command while a long effect is still running"` → `Tests 1 passed | 7 skipped (8)`，退出 **0** |
| 关键断言 | `runEffect({label:'model.call'})` 保持未完成；此时 `submitCommand({operation:'work.cancel'})` 被准入并完成，返回 `'cancelled'`，`elapsed < 1000ms`；长效果仍在飞 `activeEffects()` 等于 `['model.call']`；第二条命令也直接通过；释放后 `activeEffects()` 为 `[]` |
| 移除会破坏 | 若 `runEffect` 与短命令共用同一串行队列，短命令的 completion 只能等长效果释放才 resolve → `elapsed` 不再 `< 1000`（测试失败），`activeEffects` 断言时序改变 |
| dispatcher 侧同证 | `packages/core/test/dispatcher.integration.test.ts` › `long operations do not block commands (AC-056)` › **`answers a command within a second while a model call is in flight`**；过滤执行 `-t "answers a command within a second while a model call is in flight"` → `Tests 1 passed | 9 skipped (10)`，退出 **0**。断言：`mailbox.runEffect({label:'model.call:chief'})` 在飞时，dispatcher 写请求 1 秒内返回 `{ok:true,result:{status:'applied'}}`，`elapsed<1000`，`activeEffects()` 等于 `['model.call:chief']` |

## 6. 新增 WP-01 修复复核（复评 NF-01/NF-02 与 T8 两项 P1）

### 6.1 需求记录路径为文档目录（`data.md` §6 / `requirements.md` §1）

- 源码：`packages/core/src/requirements.ts:31` `REQUIREMENT_RECORD_DIR = (id) => \`.agentdev/requirements/${id}\``，`:241` 以它为 `portableRef.path` 默认值，`:234` 使 `sourceRef.path` 指向同一目录。
- 过滤执行：`pnpm exec vitest run --project integration packages/core/test/requirements.integration.test.ts -t "creates a local row and reports a needs_replan record"` → `Tests 1 passed | 9 skipped (10)`，退出 **0**。
- 断言（`requirements.integration.test.ts:100-106`）：`outcome.row?.portableRef.path === \`.agentdev/requirements/${REQUIREMENT_ID}\``（目录、含 `.agentdev/` 前缀），`sourceRef` 同路径且 `hash===recordHash`。**若退回单文件 `requirements/<id>/requirement.json`（旧缺陷），该断言即刻失败。**

### 6.2 事件 append 失败不留投影行（原子性）

- 源码：`packages/core/src/requirements.ts:113` `return withTransaction(this.store.db, () => this.apply(input))`，行写入与 `events.append` 同事务。
- 过滤执行：`... -t "writes the row and its event in one transaction"` → `Tests 1 passed | 9 skipped (10)`，退出 **0**。
- 断言（`:210-226`）：注入 `events.append` 抛 `'event log unavailable'` → `failing.import` 抛出该错；`store.requirements.find(REQUIREMENT_ID)` 为 `undefined`（无「有行无事件」半写）；再以正常 projection 重试 `verdict==='new'`。**若去掉 `withTransaction` 包裹，行会残留 → 第一条断言失败。**

### 6.3 连续迁移不因备份文件冲突（复评 NF-01）

- 源码：`packages/storage/src/migrations.ts:153-159`（无回调但有 `backupPath`/`backupDir` 时调用 `backupDatabase`，文件名为 `pre-migration-v<来源版本>.sqlite`，已存在则复用）；`packages/storage/src/store.ts:173` 默认 `backupDir = <dataDir>/backups`。
- 过滤执行：`pnpm exec vitest run --project integration packages/storage/test/migrations.integration.test.ts -t "keeps one backup per source version"` → `Tests 1 passed | 15 skipped (16)`，退出 **0**。
- 断言（`:294-318`）：`runMigrations([m1],{backupDir})` → `[1]`；再 `runMigrations([m1,m2],{backupDir})` → `[2]`；`backups/pre-migration-v0.sqlite` 与 `backups/pre-migration-v1.sqlite` 同时存在；同版本重跑 `applied===[]`（复用副本、不冲突）。**若备份名固定为 `pre-migration.sqlite`，第二次升级会在 `VACUUM INTO` 处抛 `SqliteError: output file already exists` → 用例失败。** 独立复现见 §7 探针 C。

### 6.4 冻结的 0001 checksum 一致（复评 NF-02）

- 源码：`packages/storage/test/migrations.integration.test.ts:321-333` 把 `migrationChecksum(MIGRATIONS[0])` 钉为常量 `8de041504378a4caf4292a38f6d542100c7b97fe90a4e560d43a623fc98e2dff`。
- 过滤执行：`... -t "freezes migration 0001"` → `Tests 1 passed | 15 skipped (16)`，退出 **0**。
- 独立复核：§7 探针 C 用 `node:crypto` 直接重算 `SHA256(\`${version}\\0${name}\\0${sql}\`)`，结果与测试常量、`migrationChecksum()` 三者一致。仓库 `MIGRATIONS.length===1`，即当前仅 0001。

## 7. 独立探针（开发者未编写，在仓库外 `/tmp/wp01-probes/` 针对 `pnpm build` 产物运行）

三个探针均导入 `/Users/huyaohua/huyh/work/aigrouptool/packages/*/dist`（非 vitest 源码路径），脚本不落入仓库。全部退出 0。

### 探针 A — AC-023/024：两个真实 Git 根 → 不同 projectId；子目录与符号链接归一 → 同一 id

- 命令：`cd /tmp/wp01-probes && node probe-a.mjs`（真实 `git init` + commit 两个根；用 `resolveProjectIdentity`/`isSameProject`，另以 `node:crypto` 独立重算 `SHA256(realpath)[0:32]` 对照）
- 退出码：**0**；末行 `PROBE_A_PASS`
- 实测输出（节选）：

```json
{
  "alphaProjectId": "d13643a97c3fcbc0e2ff3d20ba55bbeb",
  "betaProjectId":  "3c026a8d5794d17703f7c344d7b4e06a",
  "subdirProjectId": "d13643a97c3fcbc0e2ff3d20ba55bbeb",
  "symlinkProjectId": "d13643a97c3fcbc0e2ff3d20ba55bbeb",
  "checks": {
    "two_roots_distinct_ids": true,
    "subdir_same_id": true,
    "subdir_canonical_root_equals_alpha": true,
    "subdir_flag_true": true,
    "symlink_same_id": true,
    "trailing_separator_same_id": true,
    "alpha_id_matches_independent_sha256": true,
    "beta_id_matches_independent_sha256": true,
    "ids_are_32_hex": true,
    "git_root_reported": true
  }
}
PROBE_A_PASS
```

- 判读：两真实根 id 不同（`d136…` vs `3c02…`）；`alpha/src/deep` 与指向 `alpha` 的符号链接均归一为同一 `projectId` 与同一 `canonicalRoot`；尾斜杠同样归一；id 与独立 SHA256 前 32 位一致。**passed**。

### 探针 B — AC-055：同键同载荷重放 → 恰好 1 event / 1 outbox

- 命令：`cd /tmp/wp01-probes && node probe-b.mjs`（真实 `CommandDispatcher` + `ProjectStore` + 真实 SQLite 文件；行数用裸 SQL `SELECT COUNT(*)` 读取，不经过应用自身 helper）
- 退出码：**0**；末行 `PROBE_B_PASS`
- 实测输出（节选）：

```json
{
  "retry": { "v":1,"type":"response","id":"probe-req","ok":true,
    "result": { "status":"applied","entityId":"01a08e42-19dc-7591-9f96-321cd73b5e15","version":2 } },
  "conflict": { "v":1,"type":"response","id":"probe-req-2","ok":false,
    "error": { "code":"IDEMPOTENCY_CONFLICT",
      "message":"idempotency key probe-key-1 was used with a different payload","retryable":false } },
  "handlerRuns": 1,
  "tokensUsed": 7,
  "rawCounts": {
    "afterFirst":    { "event":1, "outbox":1, "budget":1 },
    "afterRetry":    { "event":1, "outbox":1, "budget":1 },
    "afterConflict": { "event":1, "outbox":1, "budget":1 }
  },
  "checks": {
    "first_is_applied": true, "retry_response_identical": true,
    "after_first_exactly_one_event": true, "after_first_exactly_one_outbox": true,
    "after_retry_still_one_event": true, "after_retry_still_one_outbox": true,
    "handler_ran_exactly_once": true, "delta_applied_once": true,
    "conflict_is_idempotency_conflict": true,
    "conflict_added_no_event": true, "conflict_added_no_outbox": true,
    "conflict_added_no_domain_row": true
  }
}
PROBE_B_PASS
```

- 判读：首次写入 1 event / 1 outbox；同键同载荷重放返回逐字段相同响应，三张表各仍 1 行，handler 只执行 1 次，`tokensUsed` 只加一次（7）；同键异载荷返回 `IDEMPOTENCY_CONFLICT` 且不新增任何行。**passed**。

### 探针 C — AC-065：第二次升级的迁移前备份不冲突 + 0001 checksum 独立重算

- 命令：`cd /tmp/wp01-probes && node probe-c.mjs`（合成 m1/m2/m3 走真实 `runMigrations`；另测真实 `ProjectStore.open` 的默认备份接线；用 `node:crypto` 独立重算 0001 校验和）
- 退出码：**0**；末行 `PROBE_C_PASS`
- 实测输出（节选）：

```json
{
  "applied": [[1],[2],[3],[]],
  "backupExists": [true, true, true],
  "backups": [
    { "ok": true, "tables": [] },
    { "ok": true, "tables": ["step_1"] },
    { "ok": true, "tables": ["step_1","step_2"] }
  ],
  "defaultBackupExists": true,
  "defaultBackupUsable": true,
  "reportedChecksum":    "8de041504378a4caf4292a38f6d542100c7b97fe90a4e560d43a623fc98e2dff",
  "independentChecksum": "8de041504378a4caf4292a38f6d542100c7b97fe90a4e560d43a623fc98e2dff",
  "checks": {
    "first_upgrade_applied": true, "second_upgrade_applied": true, "third_upgrade_applied": true,
    "resumed_attempt_applied_nothing": true,
    "v0_backup_exists": true, "v1_backup_exists": true, "v2_backup_exists": true,
    "v0_backup_is_pre_migration_empty": true,
    "v1_backup_has_step_1_only": true,
    "v2_backup_has_step_1_and_2": true,
    "store_open_default_backup_written": true, "store_open_default_backup_usable": true,
    "frozen_checksum_matches_reported_constant": true,
    "independent_sha256_matches_frozen_constant": true,
    "migrations_length_is_one": true
  }
}
PROBE_C_PASS
```

- 判读：连续三次升级各自留下 `pre-migration-v0/v1/v2.sqlite`，均为可读 SQLite，且内容确为**升级前**状态（v0 无业务表、v1 仅 `step_1`、v2 含 `step_1+step_2`）；同版本重跑不再备份、不冲突（`applied=[]`）；真实 `ProjectStore.open` 默认写出并可用 `backups/pre-migration-v0.sqlite`；0001 校验和独立重算一致。**passed**。
- 说明：`not_covered` 项——「迁移失败后守护进程显示版本且不启动 Runner」的进程级行为属 WP-09/WP-10，本探针只到库级。

## 8. 验收对照（AC-023/024/055/056/059/060/065/078/092）

判定规则：`passed` = 该 AC 在 **WP-01 本包必验范围**内各行为均有已执行证据；`not_covered` = 至少一条 Then 子句在本仓库当前不存在可执行证据（附后续归属 WP）。所有 `passed` 项在 §4–§7 均有对应命令输出。

| AC | 结果 | 证明文件 / 用例 | 说明 |
|---|---|---|---|
| AC-023 无注册多项目 | **passed** | `packages/core/test/identity.integration.test.ts` › `independent projects (AC-023)` › `gives two real roots distinct ids and independent databases`（整文件 9/9 通过）；探针 A | 两个真实 `git init` 根 → 不同 32 位 projectId；两独立 `ProjectStore` 各自只含本项目行，交叉 `find` 返回 undefined。“切换不影响运行”的运行时子句无入口，归 **WP-09/WP-10**（§9.1） |
| AC-024 路径识别 | **passed** | `identity.integration.test.ts` › `canonical roots (AC-024)`（`normalizes a subdirectory to the repository root`、`normalizes a trailing separator and a symlinked path`、`derives the project id from the canonical root hash`）与 `nested repositories (AC-024)` 4 例；过滤 `-t "AC-023|AC-024"` → `9 passed (9)`；探针 A | 子目录/符号链接/尾斜杠归一同 projectId；嵌套仓库被识别并从父路径排除（`nestedRepoExclusions`/`isInsideNestedRepo`/`requireOwnIdentity`），嵌套 id 不同 |
| AC-055 幂等接受 | **passed** | `dispatcher.integration.test.ts` › `applies one write, then replays the same result for the same key`、`refuses the same key with a different payload`；`ledger.integration.test.ts` › `replays the original result for the same key and payload`、`refuses the same key with a different payload or another caller`；探针 B | 同键同载荷返回同实体/同结果且副作用只发生一次（event/outbox 不重复，裸 SQL 计数确认）；同键异载荷冲突且不产生副作用 |
| AC-056 Mailbox 非阻塞 | **passed** | `packages/core/test/mailbox.test.ts` › `answers a new command while a long effect is still running (AC-056)`（`elapsed<1000`）；`dispatcher.integration.test.ts` › `long operations do not block commands (AC-056)` › `answers a command within a second while a model call is in flight` | 长模型/效果在飞时，同 Project 短命令 1 秒内被准入并完成，不排在长任务之后 |
| AC-059 背压 | **passed** | `packages/core/test/events-hub.integration.test.ts` › `connection back-pressure (AC-059)`：`coalesces transient frames once the soft limit is crossed`、`closes the connection at the hard limit without dropping durable events`、`keeps default limits at the documented 2 MiB / 8 MiB`（过滤 `-t "back-pressure"` → `3 passed | 14 skipped`） | 软限合并/去重临时帧；硬限关闭慢连接；先落库的持久事件在断开后仍被新订阅读到（关键事件持久、其他订阅不受影响）。真实 WS 帧发送归 **WP-09** |
| AC-060 范围订阅 | **passed** | `events-hub.integration.test.ts` › `scope change (AC-060)` › `answers a fresh snapshot at a new watermark and covers later events`；`scope snapshots and watermarks` › `requires a resync when the cursor was truncated`（`RESYNC_REQUIRED`、订阅数归 0）、`replays only the events after the client cursor and only for its scope`、`returns a consistent snapshot with the watermark as its cursor`；`reports an empty batch with its scan watermark`、`refuses a backward ack and clamps to the watermark`（过滤 `-t "AC-060"` → `6 passed | 11 skipped`） | 过滤 ACK 后扩大范围始终返回「新快照 + 新水位 C」，C 之后事件完整覆盖新增范围；游标被保留期截断时明确 `RESYNC_REQUIRED` |
| AC-065 Migration | **passed** | `packages/storage/test/migrations.integration.test.ts`：`applies the core schema and records a checksum`、`backs up before pending work and writes a usable copy`、`stops on a checksum mismatch instead of starting`、`refuses a database written by a newer build`、`rolls a failed migration back and reports its version`、`keeps one backup per source version instead of colliding`、`freezes migration 0001 and requires later changes to append a migration`、`is idempotent on the second start`、`applies the documented pragmas`、`schema matches the entity contracts` 3 例、`database-level invariants` 4 例（整文件 16/16）；探针 C | 迁移前备份（按来源版本命名，连续升级不冲突）并逐条事务迁移；checksum 不一致 / 文件版本超前 → 停止启动；迁移中途失败回滚且报告版本；0001 checksum 冻结且独立重算一致 |
| AC-078 认证生命周期 | **not_covered**（部分通过） | 已通过部分：`packages/core/test/auth.test.ts`（18/18，unit）— 过滤 `-t "request authentication"` → `7 passed | 11 skipped`；代表用例 `refuses an unknown cookie and an expired session`（`UNAUTHENTICATED`/`AUTH_EXPIRED`）、`requires a matching CSRF token for writes`（403 `NOT_AUTHORIZED`）、`rejects a mismatched Origin against the configured allowlist`、`limits failures to five per IP per minute`、`is created 0600 and shown exactly once` | 未覆盖子句：AC 的 When 是「HTTP/WS 写请求」，但仓库当前只有 `apps/cli`、`apps/runner`，无 HTTP/WS 服务端；上述测试直接调用 `AuthService`，未经真实 HTTP/WS 传输；「后台 Work 保留」亦无执行证据。归属 **WP-09**（协议/BFF 接线）与 WP-02/03（Work 执行），**WP-10** 整体复验 |
| AC-092 需求导入冲突与幂等 | **not_covered**（部分通过） | 已通过部分：`packages/core/test/requirements.integration.test.ts`（10/10）— `imports the same record twice without a second write`、`refuses the same recordVersion with different content`（`requirement.save_failed` + `reason:'REQUIREMENT_CONFLICT'`，行未改）、`treats an older recordVersion as a conflict, not a downgrade`、`rejects a malformed record before touching the database`、`hashes the exact requirement.json bytes when the caller supplies them`、`writes the row and its event in one transaction`、`creates a local row and reports a needs_replan record without a Work` | 未覆盖子句：Git 往返——「拉取已更新 Git 但投影未刷新时保存必须拒绝覆盖」「用户修复 Git 后显式导入可解除冲突，再基于新投影保存」，以及 `REQUIREMENT_PATH_IGNORED`/`LEGACY_REQUIREMENT_FORMAT`。Plan T8 明确「Git 往返留给 WP-04/WP-08」。归属 **WP-04/WP-08**，**WP-10** 复验 |

## 9. 未覆盖项（附归属工作包）

1. **AC-078 的传输层子句**：真实 HTTP/WS 写请求的拒绝与「后台 Work 保留」。`apps/` 仅 `cli`、`runner`，无 daemon/BFF/WS 服务端；`AuthService` 只做请求判定。归属 **WP-09**（协议与 BFF 接线）；「后台 Work 保留」另需 WP-02/03，最终 **WP-10** 复验。
2. **AC-092 的 Git 往返子句**：投影未刷新时保存拒绝覆盖、修复 Git 后显式导入解除冲突、`REQUIREMENT_PATH_IGNORED`/`LEGACY_REQUIREMENT_FORMAT`。`packages/core/src/requirements.ts` 只处理本机投影判定。归属 **WP-04/WP-08**，**WP-10** 复验。
3. **AC-023「切换不影响运行」**：现有证据是两个独立 store 并存互不串染；真实运行中切换打开项目（运行时路由/生命周期）尚无入口。归属 **WP-09/WP-10**。
4. **EventHub/ConnectionQueue 的真实 WS 传输绑定**：`packages/core/src/events-hub.ts` 为内存订阅 + SQLite 事件日志，`ConnectionQueue` 为进程内输出队列，无真实 WebSocket 连接/帧发送。归属 **WP-09**。
5. **迁移失败的进程级守护**：「显示版本、不启动 Runner」库级已具备（`SCHEMA_VERSION_AHEAD`/`MIGRATION_CHECKSUM_MISMATCH`/`MIGRATION_FAILED`），但 daemon 启动路径行为属 **WP-09/WP-10**。
6. **真实 Provider 纵向任务与三条命令**：`pnpm test:e2e`（WP-09）、`pnpm test:acceptance`（WP-10）、`pnpm test:live`（WP-10）按契约 `NOT_IMPLEMENTED` 退出 1（§4.8）。
7. **`docs/INDEX.md`「实现起点」状态**：该节仍称「Core、…协议与存储…仍未实现」，与 WP-01 已落地的 `packages/{domain,storage,core}` 不一致；`pnpm docs:check` 只校验链接/引用完整性，不校验该叙述。属 **Settlement** 待办，非本包命令或 AC 失败；本次复核不改 `docs/**`。
8. **跨服务器 `metadataHash` 取文件字节的调用方**：`metadataHashOf(...,rawMetadata)` 能力已具备并有测试，但 Git 读取方不存在（WP-04/WP-08）。

## 10. 复核过程中的观察（不影响判定）

- `implementation.md` §3 的集成计数「10 文件 / 115 用例（14 迁移 + 21 仓储/账本 + 9 分发 + 16 事件订阅 + 9 身份 + 8 需求投影）」既与括注（相加 77）自相矛盾，也与本次实测 **122**（16/22/10/17/10/9/11/10/8/9）不符；`:65`「dispatcher 10」、`:109`「需求投影 10」已更新，但 §3 汇总行仍过期。属结算（Settlement）待办，不是命令或 AC 失败。
- `packages/storage/test/migrations.integration.test.ts` 的 `backups` 命名（`pre-migration-v<来源版本>.sqlite`）与 `discovery.md` DC-21 描述一致；探针 C 使用合成 0002/0003 复现，仓库当前确只有 0001（`MIGRATIONS.length===1`），故「第二次升级」在当前测试集内不会被自然触发，只能由该专用用例与仓库外探针覆盖。
- 本次复核仅新建/替换 `.agentdev/work/WP-01/test-report.md` 一个 tracked 文件；命令执行前后 `git status --short` 除该文件外为空，未触碰 `packages/`、`apps/`、`docs/` 与根配置。

## 11. 结论

**PASS**（就 WP-01「本包必验范围全部通过」与 `implementation.md` §3 的退出条件而言）。

- 8 类必需命令全部按契约表现：1–7 退出 0（unit 13/173、integration 10/122，含真实 Docker 容器 9 例）；`test:e2e`/`test:acceptance`/`test:live` 逐字 `NOT_IMPLEMENTED` 退出 1 并分别指向 WP-09/WP-10（§3、§4）。
- 五项必需失败测试（丢应答重试、冲突键、慢连接、迁移失败、长操作不阻塞）均真实存在，单独名称过滤复跑各 `1 passed`（慢连接为 `3 passed`），断言与「移除即失败」路径已逐条核对（§5）。
- 四项新增修复均独立复跑通过：需求记录路径为 `.agentdev/requirements/<id>` 目录、事件 append 失败不留投影行、连续迁移备份按来源版本命名不冲突、0001 checksum 冻结且独立重算一致（§6）。
- 三个仓库外独立探针全部通过：真实 Git 根身份归一（AC-023/024）、同键重放仅 1 event/1 outbox（AC-055）、第二次升级备份与冻结校验和（AC-065）（§7）。
- 9 项关联 AC 中 7 项 `passed`；AC-078、AC-092 因「传输层 / Git 往返」子句在当前仓库无可执行证据判为 `not_covered`（部分行为已通过），其剩余子句归属 **WP-09**（AC-078）与 **WP-04/WP-08**（AC-092），并按 `implementation.md`「发布回归统一在 WP-10」在 WP-10 复验。
- 按 `docs/rules/workflow.md` §6，`not_covered` 项放行需用户明确风险处置；本判定仅指 WP-01 本包必验范围与退出条件，不等价于 WP-10 整体发布验收。

## 附：证据文件索引（本次实测）

| 文件 | 实测规模/命令 | 关联 |
|---|---|---|
| `packages/core/test/dispatcher.integration.test.ts` | 10 例通过；过滤 4 次各 1 passed | AC-055、AC-056 |
| `packages/storage/test/ledger.integration.test.ts` | 22 例通过；过滤 2 次各 1 passed | AC-055、AC-065 |
| `packages/core/test/events-hub.integration.test.ts` | 17 例通过；`-t back-pressure` 3 passed，`-t AC-060` 6 passed | AC-059、AC-060 |
| `packages/storage/test/migrations.integration.test.ts` | 16 例通过；过滤 4 次各 1 passed | AC-065、NF-01/NF-02 |
| `packages/core/test/mailbox.test.ts` | 8 例通过；过滤 1 次 1 passed | AC-056 |
| `packages/core/test/identity.integration.test.ts` | 9 例通过；`-t "AC-023|AC-024"` 9 passed | AC-023、AC-024 |
| `packages/core/test/requirements.integration.test.ts` | 10 例通过；过滤 2 次各 1 passed | AC-092（投影部分） |
| `packages/core/test/auth.test.ts` | 18 例通过；`-t "request authentication"` 7 passed | AC-078（判定核心） |
| `/tmp/wp01-probes/probe-a.mjs` | 退出 0，`PROBE_A_PASS` | AC-023/024 |
| `/tmp/wp01-probes/probe-b.mjs` | 退出 0，`PROBE_B_PASS` | AC-055 |
| `/tmp/wp01-probes/probe-c.mjs` | 退出 0，`PROBE_C_PASS` | AC-065、NF-01/NF-02 |
