# WP-11 独立 Test 报告（运行时与 Runner 执行器）

- 测试对象：**WP-11 运行时与 Runner 执行器（A1 + A2）**，即 `apps/cli` 的 `start/stop/status/open` 运行时入口、`apps/daemon` 宿主与执行栈接线、`packages/core` 的 `RunnerSupervisor` / `RunRecoveryService` / Attempt capability / 回环模型网关。
- 代码冻结点：commit `a54ff171330e5b26593825e55f82ba94e8a12c6f`，tree `1ce9579ad00dffd123ab9aacd42a04932383ed2e`（与本轮开始、结束两次核对一致；测试期间 HEAD 与 tree 未变）。
- 环境：macOS，`node v24.8.0`，`pnpm 12.3.4`；`pnpm build` 后以 `apps/cli/dist/cli.js` 为主入口，`AGENTDEV_DAEMON_ENTRY` / `AGENTDEV_RUNNER_ENTRY` 走源码引导（`scripts/lib/e2e-runtime.mjs`）；集成测试 `--maxWorkers=2`。
- 权威依据：`docs/architecture/reliability.md` §1/§2/§3/§6/§7、`docs/architecture/execution.md` §1/§2/§7、`docs/architecture/ARCHITECTURE.md` §1/§2/§5、`docs/architecture/protocol.md` §2/§3/§4、`docs/delivery/acceptance.md` AC-055/056/057/058/059/064、`docs/rules/{workflow,agents}.md`、`AGENTS.md`。
- 唯一写入：本文件 `.agentdev/work/WP-11/test.md`。所有实验脚本、原始输出与截图式日志在 `/tmp/wp11test/`（A1：`a1/`；A2：`a2/`）。`pnpm test:e2e` / `pnpm test:live` 改写的 `.agentdev/work/WP-10/{e2e,live}*` 已 `git checkout --` 还原，最终工作树除本报告与上游既有的 `review-round5.md`（未跟踪）外干净。
- 独立性：未读取任何开发聊天、transcript 或 session log；所有结论均由本报告作者亲自执行的命令与实验产出。

## 0. Review 门禁与测试范围

**门禁通过。** `.agentdev/work/WP-11/review-round5.md` 的冻结点与本轮一致：

```text
$ git rev-parse HEAD
a54ff171330e5b26593825e55f82ba94e8a12c6f
$ git rev-parse HEAD^{tree}
1ce9579ad00dffd123ab9aacd42a04932383ed2e
$ git status --porcelain
?? .agentdev/work/WP-11/review-round5.md          # 上游 Review 的产物，非本 Test 写入
$ git log --oneline -3
a54ff17 fix(core,daemon): adopt the resumed Attempt and give a parked Run a product action
bf97473 fix(core): give a parked Run a real product path and close the round-3 findings
302b382 fix(core,daemon,cli): close the WP-11 review round-2 findings
```

review-round5 结论为 **PASS（不阻断独立 Test）**，0×P1 / 3×P2（WP11R5-01/02/03）/ 2×P3（WP11R5-04/05）；历史轮次 `review.md` FAIL、`review-round2.md` PASS、`review-round3.md` FAIL、`review-round4.md` FAIL 与本 Test 的观察一致（第 4 轮 P1「采纳分支反把 Run 判 failed」在真实路径上已不可复现，见 §5.1）。

覆盖的验收面：AC-055（幂等接受）、AC-056（Mailbox 非阻塞）、AC-057（Runner 失联）、AC-058（过期结果）、AC-059（背压）、AC-061（启动恢复）、AC-064（备份恢复）与本轮最接近的能力面；A1 另有 `reliability.md` §7 的 CLI 命令契约、`protocol.md` §2 的鉴权与回环要求。

## 1. 本轮结论摘要

| # | 能力面（AC） | 正向证据 | 负向/边界证据 | 结论 |
|---|---|---|---|---|
| 1 | `start` 幂等 + 守门 | 首次 start exit 0，`epoch=1`，实例 `daemon=4318/web=4317`；二次 start `{started:false,already:true}` exit 0，pid 不变 | 同一 home 第二个守护进程直接启动 → exit 1 `ALREADY_RUNNING: … (pid 24815, epoch 1)` | **通过** |
| 2 | `status` 只读 | 未运行与运行中均 exit 0（`{running:false}` / `{running:true,health:{ready:true,…}}`） | 记录损坏时 exit 1 + `RUNTIME_RECORD_INVALID` + operationId（不崩） | **通过**（另有 T-04 见 §6） |
| 3 | `open <path>` 幂等（按 canonical root） | 同路径二次 open 同 `projectId`；符号链接与尾斜杠变体均归并到 `/private/tmp/…/repo` 同一 `projectId`；第二个仓库分配独立端口 | 缺参 → `VALIDATION_ERROR` + operationId | **通过** |
| 4 | `stop` 清理 | `runtime.json` 与 `daemon.lock` 均消失，pid 不再存活，admin/实例端口无监听，无 Runner 孤儿；`status` 回到 `running:false` exit 0 | — | **通过** |
| 5 | 跨 restart 记忆 | stop→start 后 `projects.json` 两个 root 被重新打开（实例端口重新分配） | — | **通过** |
| 6 | 陈旧锁接管 + 新 epoch | 注入 dead pid、`epoch=7` 的锁 → start 成功，`epoch=8`，日志 `agentdevd: took over a stale lock from pid 999999 (epoch 7); this daemon now holds epoch 8` | **连续干净重启 epoch 恒为 1**（T-03，§6） | **部分** |
| 7 | admin 面鉴权（`protocol.md` §2） | 无 Bearer → 401 `UNAUTHENTICATED`；错误 Bearer → 401；正确 0600 凭证 → 200 | — | **通过** |
| 8 | 仅回环监听（`reliability.md` §7） | `lsof` 显示 4318/4317/admin/实例端口全部 `TCP 127.0.0.1:<port> (LISTEN)`，无 `*:` 或外部地址 | — | **通过** |
| 9 | `doctor` 尊重 `AGENTDEV_HOME`、识别非 0600 凭证 | 0600 → `installationToken:"ok"`、`executionReady:true`；644 → `"insecure"`、`executionReady:false`、blockers 含「readable by others」、exit 1；换 `AGENTDEV_HOME=/tmp/…/other` → home 随之改变且报告 `missing` | — | **通过** |
| 10 | A2 真实子进程执行（AC-057 正路） | 真实 `apps/runner` 子进程 + 回环模型：Run/Attempt `completed`，**1 次** Provider 调用，usage 16 tokens 入预算，Attempt `runnerId=pid:<子进程>`（≠ harness pid），catalog 含 capability、不含 Provider secret | — | **通过** |
| 11 | capability 闸门（AC-058 侧） | 有效 capability → 200；缺失 → 401；外来 → 401；Run 终态 → 409 `INVALID_STATE`；Attempt 停靠后 → 401「no longer valid」；旧 epoch → 401「epoch 0 does not match …(1)」 | — | **通过** |
| 12 | 冻结模型不被替换 | 请求另一模型 → 409 `CONFIG_INVALID`「frozen to model stub-provider-model; some-other-model was requested」；`/models` 只返回冻结模型 | — | **通过** |
| 13 | SIGKILL → `interrupted` + 新 Attempt（AC-057） | 杀 Runner 子进程 → Run `interrupted`、Attempt `lost`、`newAttemptAdmission.allowed=true`（无需决定）；`resumeParkedRun` → 真实 spawn、Attempt 2 | — | **通过** |
| 14 | 心跳预算（20s 静默） | 静默 Runner（不转发任何消息）→ 22.2s 时日志「silent for over 20000ms」→ Run `recovery_required`、Attempt `lost`、admission 拒绝并要求决定 | — | **通过** |
| 15 | 暂停→恢复（AC-020） | 真 `pauseWork`（Run→`paused`、Attempt `stopped`）→ 真 `resumeWork` 开无主 `starting` Attempt → supervisor **采纳**并 spawn（Attempt 保持 2 个，`pid:74280`），Run 保持 `running`（不 failed），仅新增 1 次 spawn | — | **通过** |
| 16 | `interrupted` 续跑 | `resumeParkedRun` → `{ok:true}`、真实 spawn、Attempt 2 带 `pid` | — | **通过** |
| 17 | `recovery_required` + 决定 续跑 | 进程不可确认 → `recordResumeDecision` 拒绝、admission 拒绝；进程确认死亡 → 决定 accepted、admission 放行、`resumeParkedRun` 真实 spawn | — | **通过** |
| 18 | 发布演练 | `pnpm test:e2e` 21 检查 PASS 17 / FAIL 0 / UNVERIFIED 4，exit 0；`pnpm test:live` 5 checks 0 failed、11 次真实 HTTP 200、exit 0 | — | **通过** |
| 19 | 契约命令 | 10 条命令全部 exit 0，计数与任务给定一致（见 §2） | 集成套件并发跑时曾 2 例失败，串行重跑全绿（§2 说明） | **通过** |
| 20 | 卫生 | Secret 在 `/tmp/wp11test/**`、仓库工作树、`git grep` 中命中数 **0**；无残留进程/端口；工作树仅本报告 | 崩溃的中间轮次留下 14 个 `/var/folders/.../wp11test-*` harness 临时目录，已清理 | **通过** |

**总体：PASS**（详见 §7）。无 AC 级功能失败；发现 3 项 P2 级产品缺陷（其中 2 项落在 release 关键路径上，均不改变 WP-11 的已验收行为）、2 项 P3 级，以及 1 项文档不实，全部登记在 §6。

## 2. 契约命令实际输出

均在本仓库根、无并发进程干扰下执行。

| 命令 | exit | 观察到的计数/结果 | 日志 |
|---|---|---|---|
| `pnpm install --frozen-lockfile` | 0 | `Lockfile is up to date, resolution step is skipped`，13 个 workspace 项目 | `/tmp/wp11test/install.log` |
| `pnpm typecheck` | 0 | 无错误输出 | `/tmp/wp11test/typecheck.log` |
| `pnpm lint` | 0 | `All matched files use Prettier code style!` | `/tmp/wp11test/lint.log` |
| `pnpm test:unit` | 0 | **Test Files 59 passed (59) / Tests 1155 passed (1155)**，33.56s | `/tmp/wp11test/unit.log` |
| `pnpm test:integration -- --maxWorkers=2` | 0 | **Test Files 29 passed (29) / Tests 323 passed (323)**（第二次串行运行；见下） | `/tmp/wp11test/integration2.log` |
| `pnpm docs:check` | 0 | `docs:check ok — 15 documents, 54 internal links, 94 acceptance cases, 9 requirements, 11 work packages` | `/tmp/wp11test/docs.log` |
| `pnpm build` | 0 | 11 个 package/app 全部 `Done` | `/tmp/wp11test/build.log` |
| `pnpm run doctor`（产品 doctor） | 0 | `node 24.8.0 ok`、`pnpm 12.3.4 ok`、`git 2.39.3 ok`、`pi-sdk 0.85.1 ok`、`docker 28.4.0 ok`、两个目录 `ok`、端口 4317/4318 `free`、`runtime … credential missing, not running`、`execution ready: yes` | `/tmp/wp11test/doctor-product.log` |
| `pnpm doctor` | 0 | **注意：这是 pnpm 内置命令，不是产品 doctor**（`pnpm help doctor` → “Run diagnostics on the pnpm installation and environment”），输出为 pnpm 自身版本/缓存/registry 诊断 | `/tmp/wp11test/doctor.log` |
| `pnpm test:e2e` | 0 | `e2e: 21 checks — PASS 17 / FAIL 0 / UNVERIFIED 4`；`24 ACs accounted for` | `/tmp/wp11test/e2e.log` |
| `pnpm test:live`（真实 DeepSeek） | 0 | `live: 5 passed / 0 failed / 2 unverified; 11 call(s), HTTP 200×11, 41320ms total, 0 failed` | `/tmp/wp11test/live.log` |

**集成套件第一次运行失败的解释（如实登记）**：首次 `pnpm test:integration -- --maxWorkers=2` 得到 `1 failed | 28 passed (29)` / `2 failed | 321 passed (323)`，失败用例为 `apps/cli/test/runtime.integration.test.ts` 的两条（`expected 1 to be +0`）。原因经查是本 Test 自己的 A1 实验同时在跑，占用了该用例依赖的默认端口 4318（`start` 的 `waitForRuntime` 轮询到超时 → CLI exit 1）。在无并发占用时：该文件单独运行 4/4 通过；整套串行重跑 29/29、323/323 通过。因此该失败是**测试环境并发干扰，不是产品缺陷**；登记于此以免被误读为契约命令红灯。

## 3. A1 运行时入口实测

脚本：`/tmp/wp11test/a1/run-a1.sh`（主流程）、`run-a1b.sh`（陈旧锁/doctor）、`run-a1c.sh`（epoch/残留记录）、`run-a1e.sh`（损坏记录失败模式）。原始输出：对应 `.log`。以真实 Git 仓库 + 临时 `AGENTDEV_HOME` + `apps/cli/dist/cli.js` 驱动；守护进程用 `AGENTDEV_DAEMON_ENTRY` 指向 `apps/daemon/src/main.ts` 的源码引导（与 CLI 集成测试同一装载器）。

### 3.1 启停、幂等、状态、清理

```text
$ AGENTDEV_HOME=/tmp/wp11test/a1/home node apps/cli/dist/cli.js status      # 未运行
{ "ok": true, "running": false, "home": "/tmp/wp11test/a1/home" }          exit=0

$ node apps/cli/dist/cli.js start --root /private/tmp/wp11test/a1/repo
{ "ok": true, "started": true, "pid": 18037, "epoch": 1,
  "instances": [{ "projectId": "f3afa957…", "root": "/private/tmp/wp11test/a1/repo",
                  "daemon": { "host": "127.0.0.1", "port": 4318 },
                  "web":    { "host": "127.0.0.1", "port": 4317 } }] }     exit=0

$ node apps/cli/dist/cli.js start --root /private/tmp/wp11test/a1/repo      # 幂等
{ "ok": true, "started": false, "already": true, … pid 18037 }              exit=0
```

`runtime.json` / `daemon.lock` / `installation-token` 均为 `-rw-------`（0600），home 与 `logs/`、`projects/` 为 `drwx------`（0700）。`stop` 后：

```text
runtime.json exists: NO      daemon.lock exists: NO      daemon pid alive: NO
$ lsof -nP -iTCP:52547 -sTCP:LISTEN   → （空，端口释放）
$ ps … | grep -E 'apps/runner|runner/dist'   → (none)     # 无 Runner 孤儿
$ node apps/cli/dist/cli.js status  → { "ok": true, "running": false }      exit=0
```

跨重启记忆：`stop` → 空参 `start` 后，`runtime.json.instances` 重新包含 `repo` 与 `repo2` 两个 root（端口重新分配为 4318/4317 与 52607/52608），证明按 `projects.json` 注册表恢复。

### 3.2 canonical root 幂等

`open` 依次对 `/private/tmp/wp11test/a1/repo`、同一路径、符号链接 `…/link/repo-link`（→ 该 repo）、`/private/tmp/wp11test/a1/repo/`（尾斜杠）调用，四次返回**同一** `projectId=f3afa95732337fbf8968a82211d449b1` 与同一实例；`repo2` 得到独立 `projectId=612e7bf2…` 与独立端口。`projects.json` 仅落两个 canonical root。

### 3.3 第二个守护进程被拒

```text
$ node apps/daemon/dist/main.js --home /tmp/wp11test/a1/home
ALREADY_RUNNING: agentdevd is already running for /tmp/wp11test/a1/home (pid 24815, epoch 1)
[exit=1]
```

### 3.4 陈旧锁接管（新 epoch）

注入 dead pid + `epoch=7` 的 `daemon.lock` 后 `start`：

```text
injected: { "v": 1, "pid": 999999, "epoch": 7, "startedAt": "1970-01-01T00:00:00.000Z" }
start exit=0   epoch=8
agentdevd: took over a stale lock from pid 999999 (epoch 7); this daemon now holds epoch 8
```

### 3.5 admin 鉴权与回环

```text
$ curl -s -o … -w '%{http_code}' http://127.0.0.1:52547/health                      → 401
  {"ok":false,"error":{"code":"UNAUTHENTICATED","message":"the installation credential is required"}}
$ curl … -H 'Authorization: Bearer deadbeef' …                                      → 401
$ curl … -H "Authorization: Bearer $CRED" …                                         → 200
  {"ok":true,"ready":true,"version":"0.1.0","epoch":1,"pid":18037,…,
   "execution":{"enabled":true,"live":0}}
```

`lsof -p <pid> -a -iTCP -sTCP:LISTEN` 的全部 4 个套接字（4318、4317、admin、第二个实例 daemon/web）都是 `TCP 127.0.0.1:<port> (LISTEN)`，无 `*:` 绑定。凭证经掩码读取，未回显。

### 3.6 doctor

```text
# 0600 凭证
runtime probe: { "home": "/tmp/wp11test/a1b/home", "installationToken": "ok",
                 "running": false, "instances": 0 }        executionReady: true   blockers: []
# 644 凭证
-rw-r--r-- /tmp/wp11test/a1b/home/installation-token
runtime probe: { … "installationToken": "insecure" … }     executionReady: false
blockers: ["installation credential /tmp/wp11test/a1b/home/installation-token is readable by others"]
doctor exit=1
# 换成另一个 AGENTDEV_HOME
AGENTDEV_HOME=/tmp/wp11test/a1b/other → probe.home="/tmp/wp11test/a1b/other", "missing"
```

（守护进程自身在 644 凭证下仍可启动——凭证模式只在 doctor 与 CLI `readCredential` 侧强制；这不是本轮要求项，登记为观察。）

## 4. A2 执行器实测（真实 Runner 子进程 + 真实模型通路）

脚本：`/tmp/wp11test/a2/a2-executor.mjs`（31 项检查，**31/31 PASS**，日志 `a2-final.stdout`）、`diag.mjs` / `diag-s4.mjs`（诊断）、`a2c-protocol.mjs`（协议面，§5）。栈的组装方式与 `apps/daemon/src/main.ts` 相同：真 `ProjectStore` + `ConfigStore`/`SnapshotWriter` + `RunLifecycle` + `RunRecoveryService(createNodeProcessProbe)` + `RunnerSupervisor` + `createChildRunnerSpawnPort`（真子进程，源码模式 `apps/runner/src/cli.ts`）+ `createPrepareRun` + `createModelGatewayProxy` + `OpenAiCompatibleTransport` → 回环 Provider 桩。

### 4.1 正路：一次真实 Attempt 跑完

```text
tick: {"claimed":["01a09eb8-a848-…"],"parked":[],"live":1}
PASS S1.3 Run completed            :: status=completed
PASS S1.4 exactly one Attempt      :: attempts=1
PASS S1.5 Attempt completed        :: status=completed
PASS S1.6 Attempt records pid:<n>  :: runnerId=pid:68108
PASS S1.7 exactly one provider call:: calls=1
PASS S1.8 usage booked into the budget :: tokensUsed=16
PASS S1.9 Attempt pid is the Runner child, not this process :: attemptPid=68108 harnessPid=67974
PASS S1.10 catalog carries the capability :: url=http://127.0.0.1:53254
PASS S1.11 catalog never carries the Provider secret
PASS S1.12 Provider saw the secret from Core (not from the Runner) :: auth=present: Bearer stub-***
```

即：**恰好一次 spawn**、**Attempt 记录子进程 pid**（非 daemon/harness 自身 pid）、Provider 的 usage 真实入账、Runner 侧 `models.json` 只有 capability 而没有 Provider secret。

### 4.2 杀 Runner → 停靠中断 → 允许新 Attempt

```text
PASS S3.2 live capability accepted :: status=200
  killing runner child pid 57765
PASS S3.3 Run parked as interrupted :: status=interrupted
PASS S3.4 Attempt parked as lost    :: status=lost
PASS S3.5 a later Attempt is allowed:: {"allowed":true,"requiresRecoveryDecision":false,…}
PASS S3.6 the dead Attempt capability is inert
   :: status=401 {"code":"NOT_AUTHORIZED","message":"Attempt … is lost; its capability is no longer valid"}
PASS S3.7 interrupted Run resumes into a real spawn :: {"ok":true,"attemptId":"…"}
PASS S3.8 the resumed Run has 2 Attempts :: n=2
```

### 4.3 静默 Runner 的 20s 心跳预算

用「真子进程但不向 supervisor 转发任何消息」的 spawn 包装，以产品同款周期 tick（`tickMs:2000`）驱动：

```text
t=2s … t=20s run=running attempt=starting runnerId=pid:71490 heartbeat=07:09:38.478 live=1
t=22s supervisor: … silent for over 20000ms
t=22s supervisor: parked … as recovery_required
t=22s run=recovery_required attempt=lost live=0
admission {"allowed":false,"requiresRecoveryDecision":true,"code":"RECOVERY_REQUIRED", …}
```

（本项最初被我的 harness 误判为失败，因为单次 `tick()` 后我用 60s 间隔等待；诊断脚本证明产品行为正确——预算 20s、实际 22.2s 停靠。此处登记以避免误读。）

### 4.4 capability / 网关负向闸门

```text
PASS S2.1 missing capability refused  :: 401 {"code":"NOT_AUTHORIZED","message":"a capability is required"}
PASS S2.2 foreign capability refused  :: 401
PASS S2.3 terminal-Run capability refused :: 409 {"code":"INVALID_STATE","message":"Run … is completed"}
PASS S5.1 a different model is refused with CONFIG_INVALID
   :: 409 {"message":"Run … is frozen to model stub-provider-model; some-other-model was requested"}
PASS S5.2 /models only advertises the frozen model :: ["stub-provider-model"]
PASS S5.3 old-epoch capability refused
   :: 401 {"message":"the capability epoch 0 does not match Attempt …(1)"}
```

### 4.5 并发/容量与重启核对

`projectConcurrentRunners` / `roleConcurrency` / Chief 优先由单元套件（1155 例全绿）覆盖；本轮 A2 实验以单 Run 序列验证了 slot 释放（S1 完成后 `live=0` 且后续 Run 可被认领）。**未**用真实多 Runner 并发压测（见 §6）。

## 5. 恢复路径与已知残余复核（round-5 的 3×P2 / 2×P3）

### 5.1 第 4 轮 P1（采纳分支）已关闭——我自己的复现

真 `pauseWork` → 真 `resumeWork` → supervisor 采纳（`/tmp/wp11test/a2/a2b-final.stdout`，**21/21 PASS**）：

```text
P1.2 Work paused :: ok=true, run→paused, stoppedAttemptIds=[…], checkpointRef/barrierRef 均落
P1.3 resumeWork opened exactly one new starting Attempt with no runnerId
   :: {"run":"running","attempts":[[1,"lost","pid:74279",0],[2,"starting",null,1]]}
P1.4 the supervisor ADOPTS the opened Attempt (no third Attempt)
   :: [[1,"lost","pid:74279",0],[2,"starting","pid:74280",1]]
P1.5 the adopted Attempt is spawned and records pid:<n> :: pid:74280
P1.6 the Run stays running (not failed)
P1.7 exactly one extra spawn :: spawns 1→2
```

`interrupted` 与 `recovery_required`+决定 两条恢复路径同样以真实 spawn 收口（P2.1/P2.2、P3.5–P3.8）。**WP11R4-01（P1）在本 Test 的真实路径上不可复现，确认关闭。**

### 5.2 WP11R5-01（P2）`work.control resume` 非原子——**确认成立**

`/tmp/wp11test/a2/a2c-protocol.mjs`：真 `WorkbenchProtocol` + 真 `RunnerSupervisor` 作为 `runRecovery` 端口，同一 Work 下两个 `interrupted` Run，第二个 `resumeParkedRun` 注入 `BUSY`：

```text
before: runs=[interrupted(attempts:[failed,pid:2000001]), interrupted(attempts:[failed,pid:2000001])]
call order: ["resume:2018a1","resume:4faabe"]
error: BUSY: injected BUSY on the second Run
after: [{status:"running", attempts:[[1,"failed","pid:2000001"],[2,"starting","pid:999999"]]},
        {status:"interrupted", attempts:[[1,"failed","pid:2000001"]]}]
```

即命令整体返回失败，但第一个 Run 已被**真实续跑**（新 Attempt 2 + Run→running），第二个未动。**判定：P2 成立，维持 round-5 结论**；影响面是「失败语义在不同失败次序下不一致」——同一入口在首个检查即失败时确实什么都不写（round-5 的 P1 情形），在中途失败时却已部分写入。它不产生双写者或假完成，但会让操作者在对失败命令做盲重试时对状态产生误判。**不阻断 release**（产品能力面不受影响），但应在结算前或紧随其后的修复轮关闭（建议：把「写决定 + 续跑」收成一个可整体回滚的操作，或在响应里返回已处理的 run 列表使失败可续做）。

### 5.3 WP11R5-02（P2）`applied` 响应形状与事件偏离 `protocol.md` §4——**确认成立**

```text
result: {"status":"applied","operationId":"…","workId":"…","version":1,
         "resumedRunIds":["01a09ec5-…"]}
work.control_changed events for the resumed Work: {"n":0}
```

`protocol.md` §4 对 `work.control resume*` 的契约为 `accepted；work.control_changed`，而该分支返回 `applied` + `resumedRunIds` 且**不写事件**。**判定：P2 成立**；对以事件流驱动 UI 的客户端（`project.subscribe` 的 replay 契约）而言，一个 Run 从停靠变为 running 却没有任何事件，界面只能靠轮询或后续事件间接发现。**不阻断 release**（daemon 侧行为正确、状态持久化正确），但与文档不符，应在补齐事件或更新文档二者中择一。

### 5.4 WP11R5-03（P2）spawn/prepare 失败后的「不可恢复死角」——**确认成立（且在真实 probe 下更严重）**

A2B 的 P4 段用**真实 `createNodeProcessProbe`**，注入「prepare 抛错」（真实触发点：`createPrepareRun` 在 config snapshot 缺失时抛错、`mkdirSync`/`writeAttemptCatalog` 落盘失败、`spawn` ENOENT/EAGAIN）：

```text
after prepare failure: {"run":"recovery_required","attempts":[[1,"failed","pid:pending",0]], admission:{allowed:false,…}}
PASS P4.3 no product action can restart the Run
   :: resumeParkedRun=RECOVERY_REQUIRED recordResumeDecision=RECOVERY_REQUIRED
      pauseWork=RECOVERY_REQUIRED resumeWork=INVALID_STATE
PASS P4.4 cancelWork is the only way out :: {"ok":true}
```

根因链（我逐段读码确认，非引用 Review 结论）：`RunnerSupervisor.claim()` 的失败分支把悬空 Attempt 标 `failed` 并 `park()`（`supervisor.ts:576-594`）；该 Attempt 的 `runnerId` 要么为 `null`（采纳路径，`spawnRun` 采纳时不写 `runnerId`，`:613-624`）要么为 `pid:pending`（`beginAttempt` 路径）；真实 `createNodeProcessProbe` 对二者都经 `parseRunnerPid` 得 `null` → `ProcessProbe.probe` 返回 `null` → `inspectRun` 的 `processAlive=null`（`recovery.ts:779`）→ `recordResumeDecision` 因 `processAlive !== false` **永久拒绝**（`recovery.ts:379-420`）→ `newAttemptAdmission` 恒 false → `resumeParkedRun`、`pauseWork`、`resumeWork` 全部拒绝。`.agentdev/work/WP-11/implementation.md` T12 写「把悬空 Attempt 标 failed 并停靠 Run，**保留可重试路径**」，与上述事实不符。

**反证与我自己的修正（避免过度声明）**：若把 probe 换成「对任何输入都返回 false」的注入实现，同一 `pid:pending` 停靠 Run 可被 `work.control resume` 成功续跑（`a2c-protocol.mjs` C3 首次运行即如此）。因此死角的**精确条件**是「悬空 Attempt 无可用 pid + 真实进程探针」，而生产装配固定用 `createNodeProcessProbe`（`apps/daemon/src/main.ts` → `createProjectExecution`），故真实产品路径上该死角成立。触发概率取决于 prepare/spawn 失败频率，属可恢复性缺陷而非数据损坏。

**判定：P2 成立，且比 round-5 的描述更明确**。是否阻断 release：**不阻断**——它不产生双写者与假完成，Work 可由 `cancelWork` 收敛，且 WP-11 已验收的停靠/准入语义（AC-057）仍然成立；但它确实削弱了 AC-057「recovery 有出路」的可用性。建议在结算前关闭（最小修法：park 前为「从未启动进程」的失败 Attempt 落一个可解析的终止事实，或允许 `recordResumeDecision` 对 `runnerId==null && attempt.status==='failed'` 的 Run 放行），否则应在 WP-11 的记录中把 T12 措辞改为与实现一致并登记为已知缺口。

### 5.5 WP11R5-04（P3）采纳分支不查准入、queued Run 被采纳——**确认不可达，维持登记**

我复核了「`queued` Run + 无主 `starting` Attempt」这一组合的产生路径：`resumeTx` 只在 Work 从 `paused` 恢复时**直接追加 Attempt**并把 Run 置 `running`（`findings.ts:1722-1738`，注释明说 `RUN_TRANSITIONS` 不允许 `paused→starting`），因此该 Attempt 总是伴随一个 `running` Run 出现；`work.control resume` 的续跑分支也只处理已 `interrupted`/`recovery_required` 的 Run。我未能在真实产品路径构造出 `queued` Run + 无主 Attempt 的组合，故同意「当前不可达」的登记，并同意采纳分支未查准入属纵深防御缺口。

### 5.6 WP11R5-05（P3）T12 记录与 git 事实不符——**确认成立**

`git diff --stat bf97473..a54ff17` 不含 `packages/core/test/findings.test.ts`（我核对了 `review-round5.md` 的同一 diffstat），而 `.agentdev/work/WP-11/implementation.md` T12 表格称该用例「改名为…」。**判定：记录不实，P3 成立**，属文档口径问题，不阻断 release，但应在结算时更正，以免后续轮次把「未做之事」当成已完成。

## 6. 未覆盖 / 未验证 / 残余

按「登记而非隐藏」原则列出：

**T-01（P2，新发现）`work.control resume` 非原子部分写入**：见 §5.2。证据 `a2c-protocol.mjs` C1。

**T-02（P2，新发现）`work.control resume` 返回 `applied`+`resumedRunIds` 且不写 `work.control_changed`**：见 §5.3。证据 `a2c-protocol.mjs` C2。

**T-03（P2，新发现）锁 epoch 跨干净重启不单调**：连续三次「同一 home 上 stop → start」，`runtime.json.epoch` 均为 **1**（`run-a1c.sh` C1/C2）。原因：`stop` 删除 `daemon.lock`，`acquireDaemonLock` 以 `(existing?.epoch ?? 0) + 1` 计算（`packages/core/src/runtime.ts:185`），没有锁可读时回到 1；只有「陈旧锁接管」才会推进（实测 7→8，§3.4）。**影响判定**：当前不构成围栏绕过——supervisor 的 hostEpoch 是 `host-<pid>-<epoch>-<ISO 时间戳>`（`apps/daemon/src/main.ts`），时间戳仍严格递增；但 `runtime.json.epoch` 作为对外可见的围栏标识被重复使用，与 `reliability.md` §7 的 epoch 语义相冲，属「语义缺陷、当前无实际危害」。建议改为把 epoch 持久化到独立的高水位文件，或在文档中明确 epoch 的作用域限于单次锁持有期。**不阻断 release**。

**T-04（P2，新发现）残留/损坏 `runtime.json` 使 `agentdev start` 未捕获崩溃且无 operationId**：`run-a1c.sh` D1/D2、`run-a1e.sh` E1/E2。两种输入都复现：(a) `admin.port=0` 的 schema 非法记录（守护进程在打开项目时先 `writeRecord()`，此时 admin 监听尚未绑定，`admin.port` 仍为 0；随后若在 `listenAdmin` 绑定前进程死亡，即留下该记录）；(b) 非法 JSON。此时 `agentdev start` 在其幂等检查里调用 `waitForRuntime → readLiveRecord`，该调用**不在 try/catch 内**（`apps/cli/src/cli.ts:193`；对照 `status`/`open` 都包了 try/catch），于是抛出未捕获异常：`Error: runtime record … does not match the contract: admin.port: Too small: expected number to be >=1`，**stderr 无 `operationId`、无 error code 结构**（`grep -c operationId` = 0），违反 `reliability.md` §7「失败退出非零并输出 error code 和 operationId」。删除该文件后 `start` 恢复正常。**不阻断 release**（可人工修复、不损坏数据），但建议把幂等检查的读取纳入统一失败包装，与 `status`/`open` 一致。

**T-05（P3，延续）验收面未端到端覆盖**：`pnpm test:e2e` 的 `runtime.executes-attempt` 与 `pnpm test:live` 的 `drill.runtime-attempt` **确实驱动产品执行器**（真 `createProjectExecution`、生产 `prepare-run`/`runner-spawn`、真 `apps/runner` 子进程、真网关/真 Provider），不是重新实现；但两者都**直接播种 Work/Run 行**（`scripts/e2e.mjs:2360-2450` 的 `seedWork` + `runs.insert`），也就是说没有任何一条发布证据是「用户消息 → 路由 → Work/Run → 真实 Runner」的完整链路。链路两端的配接（`chief.routes-message` 与执行器）各自有证据，合起来没有。**不阻断 release**（Plan D1 把该执行证据定位为运行时侧证据），但若要把 AC-057 说成端到端成立，应补一条从消息驱动的检查。

**T-06（未验证）并发上限**：`projectConcurrentRunners` / `roleConcurrency` / Chief 预留未由本轮用**真实多 Runner 并发进程**压测；仅由单元套件与评审覆盖。

**T-07（未验证）`stop` 期间的真实 Runner 回收**：A1 的 `stop` 场景里执行栈是空的（无活跃 Attempt），因此「优雅停止先 `attempt.shutdown` → SIGTERM → SIGKILL → 确认退出」这一路径本轮未在 A1 单独复核；`e2e`/`live` 的 AC-057 场景覆盖了 kill 侧，但未覆盖 stop 侧。

**T-08（不实记录）**：WP11R5-05 的 T12 口径不实（§5.6）；另 `.agentdev/work/WP-11/implementation.md` T12 关于「保留可重试路径」的表述与 §5.4 实测不符。

**T-09（观察，非缺陷）**：`--no-web` 是守护进程入口的参数，不是 CLI `start` 的参数；`agentdev start --no-web` 返回 `VALIDATION_ERROR`。我最初据此误配了实验（已修正），记录以免重复踩坑。

**T-10（观察）**：`pnpm doctor` 是 pnpm 内置命令；产品 doctor 需用 `pnpm run doctor`。两者都 exit 0。

**已登记未修（上游）**：AC-090 界面子句、结果正文不落 `stage_result`（WP11R1-15/WP11R2-06）、`resumeTx` 的纯证据依赖（WP11R4-04）、Provider Secret 的持久化注册路径缺失——均为 Plan 明确非目标或已登记残余，本轮不重复开列。

**资源残留**：崩溃/被 kill 的中间实验轮次留下 14 个 `/var/folders/.../wp11test-*` harness 临时目录，已全部清理；`/tmp/wp11test/` 为本 Test 的证据目录，按要求保留。仓库内除本报告与上游 `review-round5.md` 外无改动；`HEAD`/tree 与开始一致。

## 7. 结论

**PASS。**

理由：

1. **WP-11 的已验收行为在真实路径上全部成立**（§1 表、§3、§4、§5.1）：`agentdev start/status/open/stop` 真实可用且幂等（含 canonical root 归并、跨重启记忆、端口与锁释放、第二守护拒绝、陈旧锁接管、401/回环约束、doctor 尊重 `AGENTDEV_HOME` 与非 0600 凭证）；supervisor 以**真实 `apps/runner` 子进程**完成了一次真实 Attempt（1 次 Provider 调用、usage 入预算、Attempt 记 `pid:<子进程>`、catalog 不含 Provider secret），SIGKILL 后停靠 `interrupted`/`lost` 且允许新 Attempt，静默 Runner 在 20s 预算后停靠，capability 与冻结模型的所有负向闸门均拒绝。
2. **三条恢复路径以真实 spawn 收口**：`pauseWork→resumeWork`（采纳无主 Attempt、Run 不 failed、恰好一次 spawn）、`interrupted` 续跑、`recovery_required`+决定 续跑。第 4 轮的阻断项（P1）确认关闭。
3. **发布演练与契约命令全绿**：`test:e2e` 21 检查（PASS 17/FAIL 0/UNVERIFIED 4，exit 0）、`test:live` 5 检查（0 failed、11 次真实 HTTP 200、exit 0）、单元 59/1155、集成 29/323、typecheck/lint/build/docs:check/doctor 均 exit 0，计数与任务给定预期一致。
4. **无假完成、无 fail-open、无凭证泄漏、无双写者/双结算**：所有 4 项新发现（T-01…T-04）都是「失败路径的语义与记录」问题——命令部分写入、响应形状与事件缺位、epoch 标识复用、CLI 失败未包装——它们不改变上述已验收行为，也不能被用来宣称某项能力已通过。三份 round-5 P2 全部经我独立复现并确认成立，P3 两项维持登记。
5. **残余已量化并给出精确触发条件**（§6），其中包括一处对产品无危害但会在未来遮蔽问题的记录不实（T-08）。

给后续阶段的建议（不阻断本次 PASS）：优先关闭 §5.2 的原子性、§5.4 的可恢复死角与 T-04 的 CLI 失败包装——这三项都直接落在「失败时用户能否得到可理解、可继续的状态」这一 release 体验面上；`protocol.md` §4 的事件/形状差异（§5.3）可与文档同步择一处理。
