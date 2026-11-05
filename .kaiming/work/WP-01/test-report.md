# WP-01 测试报告（数据、状态与协议核心）

- 角色：Test（独立上下文；不读取开发聊天，不把历史 test-report 当作通过依据）
- 状态：`Testing` → 结论 `PASS`（就 WP-01「本包必验范围」与退出条件；AC 子句与 P3 残留见 §8）
- 声明：本文所有退出码、计数与断言均为本机在**当前 HEAD 树**上实际执行所得；未执行者显式标 `not_covered`，不以「应该通过」代替。本报告为对 `.agentdev/work/WP-01/test-report.md` 的**完整替换**（旧报告绑定 tree `981746c…`，已不代表 HEAD；其内容保留在 git 历史）。
- 依据：`AGENTS.md`、`docs/INDEX.md`、`docs/rules/workflow.md` §6/§7、`docs/delivery/implementation.md` §2 WP-01/§3/§4、`docs/delivery/acceptance.md` AC-023/024/055/056/059/060/065/078/092、`docs/architecture/{data.md,protocol.md,reliability.md}`、`.agentdev/work/WP-01/{plan.md,implementation.md,discovery.md,review.md}`。

## 1. 复核对象

| 项 | 值（实测） |
|---|---|
| commit | `e02fb8e6c4972e41f5aba9695d765a9f25723eec` |
| tree | `c201f4276c1507fd41f0dd860df91d915c86ac6c` |
| 记录命令 | `git rev-parse HEAD && git rev-parse HEAD^{tree} && git status --short` → 前两行为上述值，第三行**无输出**（工作区干净） |
| parent | `9c634f0ed6232902c5aa46820ccc64c839873849`（`fix(wp-01): 复评 NF-01/NF-03 与记录计数、Discovery 归档`） |
| HEAD 主题 | `fix(wp-01): 二次复评 NF2-01/02/03 与计数修正` |
| 上游对象 | `8e96ee2`（tree `f1589696…`）第一轮修复；`c3a581f`（tree `196f56ff…`）首次 Review 对象 |
| 工作树 | 开始与命令执行期间干净；测试期间**另一 Review 角色**并发向 `.agentdev/work/WP-01/review.md` 追加 §4（mtime `09:27:21`），`packages/`、`apps/`、`docs/`、根配置均无改动（`git diff --name-only -- packages apps docs package.json pnpm-lock.yaml pnpm-workspace.yaml vitest.config.ts tsconfig.json` 为空） |
| 最终工作区 | ` M .agentdev/work/WP-01/review.md`（Review 角色写入，非本角色）、` M .agentdev/work/WP-01/test-report.md`（本报告） |

并发 Review §4 已实测同一 HEAD/tree 并给出 **PASS**（5 项 P3 非阻断：NF3-01…NF3-05），本 Test 报告独立复跑全量命令、五项必需失败测试、三轮修复与三个自建探针，结论与其一致。

## 2. 环境

| 项 | 值（实测） |
|---|---|
| OS | Darwin 25.5.0（macOS，arm64；主机 `huyaohuadeMacBook-Pro.local`） |
| node | `v24.8.0`（`/opt/homebrew/bin/node`） |
| pnpm | `12.3.4`（`/Users/huyaohua/.local/bin/pnpm`；每次执行前 `export PATH="$HOME/.local/bin:$PATH"`） |
| Docker | `Docker version 28.4.0, build d8eb465f86`；ServerVersion `28.4.0`；driver `overlayfs`（容器集成测试**真实运行**） |
| git | `git version 2.39.3 (Apple Git-146)` |
| better-sqlite3 | `13.0.3`；SQLite `3.53.4`（`select sqlite_version()` 实测） |
| vitest | `5.0.0`（`--project unit` / `--project integration`；跑源码，不跑 dist） |
| 仓库外探针 | `/tmp/wp01-t9/probes/`（`pnpm build` 产物 `packages/*/dist` 为被测对象，见 §7） |

## 3. 命令结果表（命令 / 退出码 / 计数）

| # | 命令 | 退出码 | 计数（实测） |
|---|---|---|---|
| 1 | `pnpm install --frozen-lockfile` | **0** | 8 个 workspace project；`Lockfile is up to date, resolution step is skipped`；`Done in 109ms` |
| 2 | `pnpm typecheck` | **0** | `tsc -p tsconfig.json --pretty false` 无输出（strict 无错误） |
| 3 | `pnpm lint` | **0** | `All matched files use Prettier code style!` |
| 4 | `pnpm test:unit` | **0** | **13 文件 / 173 用例**通过（Duration 7.80s） |
| 5 | `pnpm test:integration`（全量，含真实 Docker） | **0** | **10 文件 / 124 用例**通过（Duration 92.47s；doctor 8、container 9 为真实 Docker 路径，45.9s/90.6s） |
| 6 | `pnpm docs:check` | **0** | `15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages` |
| 7 | `pnpm build` | **0** | 7 个包构建完成：contracts、cli、pi-runtime、domain、storage、core、runner |
| 8 | `pnpm test:e2e` | **1** | `NOT_IMPLEMENTED: command test:e2e is not implemented yet; it lands with WP-09`（字面核对通过） |
| 9 | `pnpm test:acceptance` | **1** | `NOT_IMPLEMENTED: … test:acceptance … lands with WP-10`（字面核对通过） |
| 10 | `pnpm test:live` | **1** | `NOT_IMPLEMENTED: … test:live … lands with WP-10`（字面核对通过） |
| 11 | 五个失败场景按名过滤（9 条 `vitest -t`） | **0** | 每条 `1 passed`（其余 skip），见 §5 |
| 12 | 三轮修复按名过滤（7 条 `vitest -t`） | **0** | 每条 `1 passed`（其余 skip），见 §6 |
| 13 | 自建探针 A/B/C + 冻结 checksum 复核 | **0** | 探针 A 7/7、B 6/6、C 7/7 通过；checksum `match:true`，见 §7 |

integration 逐文件计数（与运行一致）：migrations **17**、ledger **22**、dispatcher **10**、events-hub **18**、requirements **10**、identity **9**（WP-01 六文件合计 86）；session **11**、attempt **10**、doctor **8**、container **9**（WP-00 四文件 38）；86+38=**124**。与 `implementation.md` §T3/T4/T6/projection 计数一致。

## 4. 验收对照（AC-023/024/055/056/059/060/065/078/092）

| AC | 判定 | 证明用例 / 命令（实测） |
|---|---|---|
| **AC-023 无注册多项目** | passed | `packages/core/test/identity.integration.test.ts:98`「gives two real roots distinct ids and independent databases」：两个真实 `git init` 根 id 不同、各自 SQLite 只有自己的 project 行、`find(alpha.projectId)` 在 beta 库为 `undefined`、trust 互异。独立探针 A 复现两个真实 Git 根 id 不同（`5e424e01…` vs `287942ea…`）。**子句「切换不影响运行」属 daemon/UI，未覆盖（WP-09/WP-10）**。 |
| **AC-024 路径识别** | passed | 同文件「normalizes a subdirectory to the repository root」「normalizes a trailing separator and a symlinked path」「finds the git root from a deep directory…」「derives the project id from the canonical root hash」，以及「finds nested repositories and excludes their paths from the parent」「bounds the nested scan by depth」「can skip the nested scan entirely」。独立探针 A：子目录/符号链接/尾分隔符均归一到同一 id。**文件工具层的父访问排除归 WP-07**。 |
| **AC-055 幂等接受** | passed | dispatcher 写路径 5 用例：`applies one write, then replays the same result for the same key`（重放同一响应、domain 行只写一次、`events.latestCursor()===1`、outbox `{pending:1}`）、`refuses the same key with a different payload`（`IDEMPOTENCY_CONFLICT`，行未变）、`reports a version conflict…`、`rolls back the ledger, events and outbox when the handler fails`、`answers BUSY…`；ledger 3 用例：`replays the original result for the same key and payload`（`kind:'replay'`、`effects===1`）、`refuses the same key with a different payload or another caller`、`scopes lookup to the calling subject…`。独立探针 B：同键同载荷重发后 `event=1 / outbox=1 / command=1`、`tokensUsed=5`、响应逐字节相同。**真实 WS 断线重连属 WP-09/WP-10**。 |
| **AC-056 Mailbox非阻塞** | passed | `packages/core/test/mailbox.test.ts:55`「answers a new command while a long effect is still running (AC-056)」：effect 在飞时命令被准入并返回、`elapsed < 1000`、`activeEffects()` 仍含长调用；`:20`「runs commands one at a time in submission order」`peak===1`；`dispatcher.integration.test.ts:317`「answers a command within a second while a model call is in flight」`elapsed < 1000`。**真实模型/工具长调用归 WP-02/WP-10（本包用受控桩）**。 |
| **AC-059 背压** | passed | `events-hub.integration.test.ts:321` 三用例：`coalesces transient frames once the soft limit is crossed`（软限后合并临时帧，`merged/coalesced` 与最终 frames 断言）、`closes the connection at the hard limit without dropping durable events`（`HARD_LIMIT`、`closed===['slow']`、`subscriptionCount()===0`，但持久事件仍在库并被新订阅 `fast` 读回 1 条 —— 其他 Run 继续）、`keeps default limits at the documented 2 MiB / 8 MiB`。**真实慢连接大 Token 量端到端投递归 WP-09/WP-10**。 |
| **AC-060 范围订阅** | passed | 同文件 `scope change (AC-060)`：「answers a fresh snapshot at a new watermark and covers later events」（过滤后 ACK → 扩大范围为 `summary` → 返回 `snapshot`+新水位 C，C 之后事件覆盖新增范围，`widened.cursor===outside`）；`requires a resync when the cursor was truncated`（截断游标 → `RESYNC_REQUIRED`）；`refuses a backward ack and clamps to the watermark`；`tests` 中 `reports an empty batch with its scan watermark`。**浏览器重订阅/UI 重同步归 WP-09**。 |
| **AC-065 Migration** | passed | `migrations.integration.test.ts`：`applies the core schema and records a checksum`、`is idempotent on the second start`、`applies the documented pragmas`、`backs up before pending work and writes a usable copy`、`stops on a checksum mismatch instead of starting`（`MIGRATION_CHECKSUM_MISMATCH`）、`refuses a database written by a newer build`（`SCHEMA_VERSION_AHEAD`）、`rolls a failed migration back and reports its version`（`MIGRATION_FAILED`、ledger 仍 `[1]`、无遗留表）、`successive upgrades` 2 用例、`freezes migration 0001…`。独立探针 C：第二次升级生成 `pre-migration-v1.sqlite`（可用、ledger=[1]），0 字节残留被替换为可用副本（ledger=[1,2]、无 `.partial`）。**「错误停止、不运行 Agent」的 daemon 行为与真实 restore 演练归 WP-09/WP-10**。 |
| **AC-078 认证生命周期** | passed | `packages/core/test/auth.test.ts` **18 用例**：`is created 0600 and shown exactly once`、`re-tightens a credential file whose mode was loosened`、`verifies the Bearer header and rejects malformed ones`、`exchanges the installation token for a strict session cookie`（HttpOnly/SameSite）、`marks the cookie Secure on a remote deployment`、`rejects a wrong token with 401`、`limits failures to five per IP per minute`(429)、`refuses a non-loopback http origin but accepts https`、`requires a matching CSRF token for writes`、`refuses an unknown cookie and an expired session`、`rejects a mismatched Origin…`、`honours an explicit origin allowlist`、`clears the session on logout and expires the cookie`、`drops only expired sessions when sweeping`。**真实 HTTP/WS Origin 关闭与「后台 Work 保留」归 WP-09**（本包为无真实服务的单元/组件级）。 |
| **AC-092 需求导入冲突与幂等** | passed | `requirements.integration.test.ts` 10 用例：`imports the same record twice without a second write`（幂等，无第二次写）、`refuses the same recordVersion with different content`（`REQUIREMENT_CONFLICT`，行未变，仅 `requirement.save_failed` 事件）、`treats an older recordVersion as a conflict, not a downgrade`、`rejects a malformed record before touching the database`、`hashes the exact requirement.json bytes when the caller supplies them`、`hashes metadata separately from the body`，以及修复后路径用例（§6）。**Git 往返/跨服务器 recordHash 与显式导入解除冲突归 WP-04/WP-08（DC-23）；调用方必须传目录便携路径与原始字节**。 |

## 5. 五项必需失败测试（按名过滤 + 读断言）

| 失败场景 | 用例（文件:行） | 名过滤结果 | 断言要点（读代码） | 判定 |
|---|---|---|---|---|
| **丢应答重试**（AC-055） | `dispatcher.integration.test.ts:224`、`ledger.integration.test.ts:57` | 各 `1 passed`（9/21 skipped） | dispatcher：首写返回 `applied`；模拟「响应丢失后同请求重发」→ `retry` 与 `first` **完全相等**（`toEqual`）、`tokensUsed` 仍 5、`latestCursor()` 仍 1、outbox 仍 `{pending:1}`。ledger：二次 `begin` 返回 `{kind:'replay', state:'completed', response:{…}}` 且 `effects===1` | passed |
| **冲突键**（dispatcher、ledger） | `dispatcher.integration.test.ts:248`、`ledger.integration.test.ts:88` | 各 `1 passed`（9/21 skipped） | dispatcher：同键不同 payload → `ok:false`、`IDEMPOTENCY_CONFLICT`、`retryable:false`，行仍 5；并断言 `payloadHashOf` 键序无关。ledger：不同 payloadHash → `{kind:'conflict'}`；**另一 caller 同键** → `conflict: belongs to another caller` | passed |
| **慢连接/背压**（AC-059） | `events-hub.integration.test.ts:322`（软限）、`:340`（硬限）、`:362`（默认限值） | 各 `1 passed`（17 skipped） | 软限：跨限后 `coalesced:true`，`take()` 只剩 2 帧且 `merged` 计数正确。硬限：`{accepted:false, closed:true, reason:'HARD_LIMIT'}`、`closed===['slow']`、`subscriptionCount()===0`，但持久事件在库、新订阅仍能 `poll` 到 1 条 —— 证明断开不丢持久事件且其他 Run 继续 | passed |
| **迁移失败**（AC-065） | `migrations.integration.test.ts:203` | `1 passed`（16 skipped） | `MIGRATION_FAILED`（含 `details.version===2`）且 ledger 仍 `[1]`、失败迁移中已建的 `good_table` **不存在**（真实 SQL 失败，非空泛） | passed |
| **长操作不阻塞**（AC-056） | `mailbox.test.ts:55`、`dispatcher.integration.test.ts:317` | 各 `1 passed`（7/9 skipped） | mailbox：`runEffect` promise 未决时提交命令 → `accepted===true`、结果正常、`elapsed<1000`、`activeEffects()` 仍含 `model.call`（命令未排在长任务之后）。dispatcher：`mailbox.runEffect` 在飞时 `dispatch` → `applied`、`elapsed<1000`、`activeEffects()===['model.call:chief']` | passed |

## 6. 三轮 WP-01 修复核对

| 修复轮 | 目标 | 实测证据 | 判定 |
|---|---|---|---|
| 第 1 轮 `8e96ee2` | ①需求记录路径为**目录** `.agentdev/requirements/<id>`；②事件 append 失败**不留投影行** | ①`requirements.integration.test.ts:100` 断言 `portableRef.path === '.agentdev/requirements/<id>'`、`:104` 断言 `sourceRef.path` 同值（名过滤 `1 passed`）；②`:210`「writes the row and its event in one transaction」注入 `events.append` 抛错 → 导入抛 `event log unavailable`，`store.requirements.find(id)` 为 `undefined`，事后重导 verdict `new`（名过滤 `1 passed`） | verified |
| 第 2 轮 `9c634f0` | ①连续迁移不冲突（按来源版本命名）②部分残留被替换、**有效副本被复用** ③冻结 0001 checksum 一致 | ①`:347`「keeps one backup per source version instead of colliding」：v0、v1 副本并存，同版本重跑 `applied:[]`；②`:294`「replaces a partial leftover and reuses a verified copy」：预置 0 字节目标 → 被替换为含 `schema_migrations` 的可用库；再预置带 `sentinel` 表的 v1 副本 → 复用后 `sentinel` 仍在、`step_1` 不存在；③`:375`「freezes migration 0001…」`migrationChecksum(MIGRATIONS[0])` 等于冻结常量（名过滤各 `1 passed`）。另以 node 直接复算：actual===frozen===`8de04150…`（§7） | verified |
| 第 3 轮 `e02fb8e` | events-hub 错误分类负例（`subscribe(afterCursor)` 与 `poll` 均不得把存储错误伪装成 resync） | `events-hub.integration.test.ts:238`「does not disguise a storage failure as a resync request」：以 Proxy 只让 `readAfter` 抛 `disk failure`（`watermark()` 先成功）→ `poll` 抛 `disk failure` 且**不**是 `RESYNC_REQUIRED`；用 `ResyncRequiredError(99,1)` 时仍翻译为 resync。`:270`「classifies errors of a cursor-based subscribe the same way」对 `subscribe({afterCursor})` 做同样两分支断言（名过滤各 `1 passed`）。源码 `events-hub.ts:270/:339` 均 `if (!(error instanceof ResyncRequiredError)) throw error;` | verified |

修复后 `pnpm typecheck`/`lint`/`test:unit`/`docs:check`/`build`/全量 `test:integration` 全部退出 0，无回归。

## 7. 独立探针（仓库外 `/tmp/wp01-t9/probes/`）

被测对象为 `pnpm build` 的 `packages/*/dist`（与源码同一 HEAD 树），脚本以绝对路径导入，不使用仓库内测试装置。

**探针 A — AC-023/024（`probe-a.mjs`，exit 0，7/7）**：真实 `git init` 两个根 → id 不同；同一根的子目录、尾分隔符、符号链接 → 同一 id。

```
"two git roots give different project ids"        passed  {alpha:"5e424e01c876bdefdb996ca5481c44cd", beta:"287942ea3b6ffb0b0b4e6803b1d5bc3b"}
"a subdirectory normalises to the same id"        passed  {sub:"5e424e01…", alpha:"5e424e01…", normalizedFromSubdirectory:true}
"a symlink of the root normalises to the same id" passed  {viaLink:"5e424e01…", alpha:"5e424e01…"}
"a trailing separator normalises to the same id"  passed  {viaSlash:"5e424e01…"}
"canonicalPath(symlink) equals the real root"     passed  {canonicalPath:"/private/tmp/.../alpha"}
"git root is found from a deep subdirectory"      passed  {found:"/private/tmp/.../alpha"}
"project id is derived from the canonical root hash" passed
failed: 0
```

**探针 B — AC-055（`probe-b.mjs`，exit 0，6/6）**：真实 `ProjectStore` + `CommandDispatcher`，注册写命令（含 events/outbox），同键同载荷 dispatch 两次。

```
"first dispatch applied the write"                 passed  {status:"applied", entityId:"01a08e4a-…", version:2}
"the retry replays the identical response"         passed  (first 与 retry 逐字节相同)
"exactly one event row exists"                     passed  {events:1, outbox:1, commands:1}
"exactly one outbox row exists"                    passed  {events:1, outbox:1, commands:1}
"exactly one command row exists"                   passed  {events:1, outbox:1, commands:1}
"the domain row was written once (tokensUsed=5)"   passed  {tokensUsed:5}
failed: 0
```

**探针 C — AC-065（`probe-c.mjs`，exit 0，7/7）**：`ProjectStore.open` 首次安装 → 合成 0002 第二次升级 → 预置 0 字节 `pre-migration-v2.sqlite` 后第三次升级。

```
"first install takes the v0 pre-migration backup"          passed  {size:8192, integrity:"ok"}
"second upgrade applies migration 2"                       passed  {applied:[2], backupPath:"…/pre-migration-v1.sqlite"}
"second upgrade points at the v1 backup path"              passed
"the v1 backup is a usable copy of the pre-upgrade schema" passed  {size:344064, integrity:"ok", applied:[1]}
"third upgrade applies migration 3"                        passed  {applied:[3], backupPath:"…/pre-migration-v2.sqlite"}
"the 0-byte leftover is replaced by a usable pre-upgrade copy" passed {zeroBefore:0, after:{size:348160, integrity:"ok", applied:[1,2]}}
"no .partial file is left behind"                         passed  {partialExists:false}
failed: 0
```

**冻结 checksum 独立复算**（node 直接调用 dist 的 `migrationChecksum`）：

```
{"version":1,"name":"0001-core-schema",
 "actual":"8de041504378a4caf4292a38f6d542100c7b97fe90a4e560d43a623fc98e2dff",
 "frozen":"8de041504378a4caf4292a38f6d542100c7b97fe90a4e560d43a623fc98e2dff","match":true}
```

探针未覆盖的**合法边界**（非缺陷，见 §8）：探针 C 走生产默认 `backupDir` 版本化命名路径；显式 `backupPath` 且无 hook 的跨来源版本复用（Review §4 NF3-01）未被本探针覆盖。

## 8. 未覆盖项与归属

| # | 未覆盖项 | 归属工作包 |
|---|---|---|
| 1 | AC-023「切换不影响运行」：需真实 daemon/UI 多项目切换；本包只验证两 Git 根 id 与数据独立 | WP-09 / WP-10 |
| 2 | AC-024 嵌套仓库「排除父访问」在文件工具层的**强制**（本包只验证扫描与排除集合） | WP-07 |
| 3 | AC-055 真实断线/重连（WS/浏览器）路径；本包为协议级幂等重放 | WP-09 / WP-10 |
| 4 | AC-056 真实长模型/工具调用；本包用受控 effect 桩 | WP-02 / WP-10 |
| 5 | AC-059 真实慢连接大 Token 量端到端投递；本包验证 ConnectionQueue/EventHub 负载语义 | WP-09 / WP-10 |
| 6 | AC-060 浏览器重订阅与 cursor 过期后的 UI 重同步 | WP-09 |
| 7 | AC-065 daemon「显示版本、不启动 Runner」行为与真实 backup/restore 演练；本包为库级异常与回滚 | WP-09 / WP-10 |
| 8 | AC-078 真实 HTTP/WS Origin 关闭、cookie 生命周期与「后台 Work 保留」；本包为无真实服务的认证单元/组件 | WP-09 |
| 9 | AC-092 Git 往返、跨服务器 `recordHash` 与显式导入解除冲突；本包为本地投影/幂等/冲突（调用方义务 DC-23） | WP-04 / WP-08 |
| 10 | 真实 Provider 纵向演练（`test:e2e`/`test:acceptance`/`test:live` 仍 NOT_IMPLEMENTED） | WP-09 / WP-10 |
| 11 | NF3-01（P3，Review §4）：显式 `backupPath` 且无 hook 时复用判定不校验来源版本；生产默认路径不受影响，仓库无该用法 | WP-01 后续小修 / WP-09 接线 |
| 12 | NF3-02（P3）：1 字节残留被 SQLite 视为空库而判为「可用」；生产路径已改用 `.partial`+rename，不再产生 | WP-01 后续小修 |
| 13 | NF3-03（P3）：复用分支不清理陈旧 `.partial`（垃圾文件，无正确性影响） | WP-01 后续小修 |
| 14 | NF3-04（P3）：`:memory:` + `backupPath` 抛裸 `ENOENT`（仓库无该用法） | WP-01 后续小修 |
| 15 | NF3-05（流程）：旧 Test 报告绑定 `9c634f0`；本报告即其重跑与重绑定 | 已由本报告关闭 |

## 9. 结论

**PASS**（WP-01 本包必验范围与退出条件成立）。

- 十个工程命令按契约执行：1–7 退出 0 且计数如上；8–10 均退出 **1** 且**字面**返回 `NOT_IMPLEMENTED` 并分别点名 WP-09（e2e）/WP-10（acceptance、live），与 `docs/INDEX.md`、`implementation.md` 现状一致。
- 五项必需失败测试（丢应答重试、冲突键、慢连接/背压、迁移失败、长操作不阻塞）经名过滤与断言逐条核对，全部通过且非空泛（断言直接约束被测行为）。
- 三轮修复（`8e96ee2`/`9c634f0`/`e02fb8e`）逐项 verified：需求记录目录路径、事件失败不留投影行、连续迁移不冲突、部分残留替换与有效副本复用、冻结 0001 checksum 一致、events-hub 两条错误分类负例。
- 三个自建探针（仓库外）全部通过：两 Git 根独立/路径归一；同键重发仅 1 event+1 outbox+1 command；第二次升级备份可用且 0 字节残留被替换。
- 全量 `test:integration` 含真实 Docker 容器用例（9 条）通过；未出现残留工具进程导致失败。
- 未覆盖项均为真实端到端/上层工作包范围并已标明归属；Review §4 的 5 项 P3 不阻断 WP-01 验收。**本报告绑定 tree `c201f4276c1507fd41f0dd860df91d915c86ac6c`，关闭 NF3-05 的 Test 重绑定要求**；进入 Settlement 前如代码树再变，须重新独立 Test。

## 10. 原始命令摘录（逐条，已裁剪）

```
$ git rev-parse HEAD && git rev-parse HEAD^{tree} && git status --short
e02fb8e6c4972e41f5aba9695d765a9f25723eec
c201f4276c1507fd41f0dd860df91d915c86ac6c
                                        # 第三行无输出

$ pnpm install --frozen-lockfile          # INSTALL_EXIT=0
Scope: all 8 workspace projects
✓ Lockfile passes supply-chain policies (verified 1h ago)
Lockfile is up to date, resolution step is skipped
Done in 109ms using pnpm v12.3.4

$ pnpm typecheck                          # TYPECHECK_EXIT=0
$ tsc -p tsconfig.json --pretty false

$ pnpm lint                               # LINT_EXIT=0
$ node scripts/lint.mjs
Checking formatting...
All matched files use Prettier code style!

$ pnpm test:unit                          # UNIT_EXIT=0
 ✓ |unit| packages/contracts/test/entities.test.ts (12 tests)
 ✓ |unit| packages/core/test/auth.test.ts (18 tests)
 ✓ |unit| packages/core/test/mailbox.test.ts (8 tests)
 ✓ |unit| packages/domain/test/domain.test.ts (28 tests)
 ... (13 files)
 Test Files  13 passed (13)
      Tests  173 passed (173)
   Duration  7.80s

$ pnpm test:integration                   # INTEGRATION_EXIT=0
 ✓ |integration| packages/storage/test/migrations.integration.test.ts (17 tests)
 ✓ |integration| packages/storage/test/ledger.integration.test.ts (22 tests)
 ✓ |integration| packages/core/test/dispatcher.integration.test.ts (10 tests)
 ✓ |integration| packages/core/test/events-hub.integration.test.ts (18 tests)
 ✓ |integration| packages/core/test/requirements.integration.test.ts (10 tests)
 ✓ |integration| packages/core/test/identity.integration.test.ts (9 tests)
 ✓ |integration| packages/pi-runtime/test/session.integration.test.ts (11 tests)
 ✓ |integration| apps/runner/test/attempt.integration.test.ts (10 tests)
 ✓ |integration| apps/cli/test/doctor.integration.test.ts (8 tests)
 ✓ |integration| apps/cli/test/container.integration.test.ts (9 tests)
 Test Files  10 passed (10)
      Tests  124 passed (124)
   Duration  92.47s (tests 88%, transform 6%, import 6%)

$ pnpm docs:check                         # DOCSCHECK_EXIT=0
$ node scripts/docs-check.mjs
docs:check ok — 15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages

$ pnpm build                              # BUILD_EXIT=0
$ pnpm -r build
packages/contracts build: Done / apps/cli build: Done / packages/pi-runtime build: Done
packages/domain build: Done / packages/storage build: Done / packages/core build: Done
apps/runner build: Done

$ pnpm test:e2e                           # EXIT=1
$ node scripts/not-implemented.mjs test:e2e WP-09
NOT_IMPLEMENTED: command test:e2e is not implemented yet; it lands with WP-09
[ELIFECYCLE] Command failed with exit code 1.

$ pnpm test:acceptance                    # EXIT=1
$ node scripts/not-implemented.mjs test:acceptance WP-10
NOT_IMPLEMENTED: command test:acceptance is not implemented yet; it lands with WP-10
[ELIFECYCLE] Command failed with exit code 1.

$ pnpm test:live                          # EXIT=1
$ node scripts/not-implemented.mjs test:live WP-10
NOT_IMPLEMENTED: command test:live is not implemented yet; it lands with WP-10
[ELIFECYCLE] Command failed with exit code 1.
```

五项必需失败测试（按名过滤，退出码均为 0；`1 passed` + 其余 skipped）：

```
### 1 丢应答重试 dispatcher
 ✓ |integration| …dispatcher.integration.test.ts > write path (AC-055) > applies one write, then replays the same result for the same key 60ms
      Tests  1 passed | 9 skipped (10)
### 1 丢应答重试 ledger
 ✓ |integration| …ledger.integration.test.ts > command ledger (AC-055) > replays the original result for the same key and payload 19ms
      Tests  1 passed | 21 skipped (22)
### 2 冲突键 dispatcher
 ✓ |integration| …dispatcher.integration.test.ts > write path (AC-055) > refuses the same key with a different payload 45ms
      Tests  1 passed | 9 skipped (10)
### 2 冲突键 ledger
 ✓ |integration| …ledger.integration.test.ts > command ledger (AC-055) > refuses the same key with a different payload or another caller 16ms
      Tests  1 passed | 21 skipped (22)
### 3 背压 soft / hard
 ✓ |integration| …events-hub.integration.test.ts > connection back-pressure (AC-059) > coalesces transient frames once the soft limit is crossed 30ms
 ✓ |integration| …events-hub.integration.test.ts > connection back-pressure (AC-059) > closes the connection at the hard limit without dropping durable events 43ms
      Tests  1 passed | 17 skipped (18)   (各)
### 4 迁移失败
 ✓ |integration| …migrations.integration.test.ts > migrations > rolls a failed migration back and reports its version 32ms
      Tests  1 passed | 16 skipped (17)
### 5 长操作不阻塞 mailbox / dispatcher
 ✓ |unit| …mailbox.test.ts > ProjectMailbox > answers a new command while a long effect is still running (AC-056) 4ms
      Tests  1 passed | 7 skipped (8)
 ✓ |integration| …dispatcher.integration.test.ts > long operations do not block commands (AC-056) > answers a command within a second while a model call is in flight 44ms
      Tests  1 passed | 9 skipped (10)
```

三轮修复（按名过滤，退出码均为 0）：

```
### F1a 需求记录路径
 ✓ |integration| …requirements.integration.test.ts > requirement projection > creates a local row and reports a needs_replan record without a Work 22ms
### F1b 事件append失败不留投影行
 ✓ |integration| …requirements.integration.test.ts > requirement projection > writes the row and its event in one transaction 20ms
### F2a 部分残留替换+有效副本复用
 ✓ |integration| …migrations.integration.test.ts > successive upgrades > replaces a partial leftover and reuses a verified copy 12ms
### F2b 连续迁移不冲突
 ✓ |integration| …migrations.integration.test.ts > successive upgrades > keeps one backup per source version instead of colliding 10ms
### F2c 冻结0001 checksum
 ✓ |integration| …migrations.integration.test.ts > frozen migrations > freezes migration 0001 and requires later changes to append a migration 6ms
### F3a events-hub poll 分类
 ✓ |integration| …events-hub.integration.test.ts > scope change (AC-060) > does not disguise a storage failure as a resync request 24ms
### F3b events-hub subscribe 分类
 ✓ |integration| …events-hub.integration.test.ts > scope change (AC-060) > classifies errors of a cursor-based subscribe the same way 34ms
      Tests  1 passed | N skipped   (每条)
```

自建探针与 checksum（仓库外 `/tmp/wp01-t9/probes/`，退出码均为 0；原始 JSON 见 §7）：

```
$ node probe-a.mjs    # PROBE_a_EXIT=0   A 7/7 passed, failed: 0
$ node probe-b.mjs    # PROBE_b_EXIT=0   B 6/6 passed, failed: 0
$ node probe-c.mjs    # PROBE_c_EXIT=0   C 7/7 passed, failed: 0
$ node -e "…migrationChecksum(MIGRATIONS[0])…"   # match:true  8de04150…
```
