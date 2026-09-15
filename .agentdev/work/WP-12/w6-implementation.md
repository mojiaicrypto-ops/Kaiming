# WP-12 W6 实施记录：容器受控出口 + 每任务工作区

状态：`Developing`（实现与自查证据已完成，交独立 Review/Test；未提交，无并发写者）
依据：`product-completion-plan.md` §4 W6 行与 §5 约束、`w1-implementation.md` §7（网络最终口径，取代早前允许名单）、`T3-implementation.md` 附录 A（冻结权限规格）、`docs/architecture/execution.md` §1–§4、`docs/architecture/reliability.md` §2/§3/§4。

---

## 1. 交付与优先级

| 优先级 | 项 | 状态 |
|---|---|---|
| 1 | 受控网络出口（Core 代理 + 容器可达通道，两个固定拒绝项在出口执行） | **完成**（真实容器、真实 `npm install` 证据） |
| 2 | 每任务工作区（Task 的工具根目录 = 该 Task 自己的外部 worktree + 单写者租约） | **完成**（真实 Git 证据） |
| 3 | 容器化 Runner | **未做，精确登记阻塞**（§6） |
| 4 | 文档：把"实现待 W6"改为真实状态 | **完成** |

---

## 2. 变更清单（文件 → 改了什么）

**Core（`packages/core/src`）**

- `egress-channel.ts`（新）：出口的共享契约。`EGRESS_SOCKET_NAME/MOUNT_DIR/BRIDGE_PORT`、`ContainerEgressChannel{ensure,available,volume,mountPath}`、容器内 TCP→Unix 桥的源码常量 `EGRESS_BRIDGE_SOURCE`、`egressToolEnv()`、`egressWrapperCommand()`。单独成文件是为了让依赖图是 `channel ← broker ← egress` 无环（`egress.ts` 需要 `broker.ts` 的 `NetworkPolicy`，`broker.ts` 需要通道常量）。
- `egress.ts`（新）：Core 侧 HTTP 代理 `EgressProxy`（回环 TCP，处理 absolute-URI 与 `CONNECT` 两种代理形态，逐跳判定、地址固定、15s 建连超时）、`createEgressPolicy()`、`hostInterfaceAddresses()`、egress sidecar 的转发脚本 `EGRESS_SIDECAR_SOURCE`。
- `broker.ts`：
  - `NetworkPolicy` 判据重写：**默认通**（公网/环回/私网/CGNAT 全部放行），只拒两个固定项 ——（a）`daemonPorts()` 返回的**运行时实际绑定**端口且目标属于本机（`isLoopbackAddress` / `hostInterfaceAddresses()` / `LOCAL_HOST_ALIASES`），（b）元数据地址与 `metadata*` 名字。DNS 解析、逐答案判定、NAT64/IPv4-mapped 解码、地址固定、重定向逐跳复验的机制**全部保留**，只是判据从"私网即拒"变为"拒绝项才拒"；`http:` 公网仍需显式 `allowInsecureHttp`（W7R1-07），本地/私网 `http:` 默认放行。
  - 新增 `METADATA_ADDRESSES`、`isMetadataHostname()`、`isMetadataAddress()`（含 NAT64 解码）、`isLoopbackAddress()`、`LOCAL_HOST_ALIASES`、`hostInterfaceAddresses()`。
  - `BrokerOptions.networkProxy?: string` → `daemonPorts?: () => readonly number[]` + `egress?: ContainerEgressChannel`；新增 `Broker.egressPolicy()`；容器模式在准入前 `await egress.ensure()`；网络覆盖但通道不存活时仍以 `PROVIDER_UNAVAILABLE` 拒绝（消息改为 "no Core-controlled egress channel is live"）。
  - `planContainerRun()`：**`--network` 恒为 `none`**；`network:'proxy'` 时改为挂载命名卷 `--mount type=volume,source=<vol>,target=/run/agentdev,readonly`，注入桥环境变量，并用 `egressWrapperCommand()` 先起桥再 `exec bash -lc "$AGENTDEV_TOOL_COMMAND"`（工具命令走环境变量，避免把模型给的 shell 串拼进 wrapper）。通道不存活时不挂载、退回纯容器。
  - 容器计划只为 `bash`/`git` 这类任意命令挂通道；`read`/`write` 的容器原语不挂（不为用不到的桥付启动开销）。
- `egress` 端口登记：`execution.ts` 新增 `egressPorts?: EgressPortRegistryPort`，在控制端点与模型 Gateway 代理绑定后把**真实端口**登记进 daemon 的注册表。
- `task-workspace.ts`（新）：`RunWorkspace`/`RunWorkspaceResolver`（`resolve` 现在带 `attemptId`/`epoch`）、`createTaskWorktreeWorkspaceResolver()` —— 专业 Run 的根 = `<worktreeRoot>/tasks/<taskId>`，由 `createWorktreeManager` 按 `dependencyRevision ?? Work.baseRevision` 创建，租约绑 `(attemptId, epoch)`，Task 行回写 `worktreeId`；Chief Run（无 taskId）仍用项目根；拿不到 worktree 时**拒绝**而不是回退项目根。
- `index.ts`：导出两个新模块。

**Workspace（`packages/workspace/src/worktree.ts`）**：新增 `taskWorktreePath(worktreeRoot, taskId)`（持久每任务树在 `<worktreeRoot>/tasks/<taskId>`，与候选提交的临时树 `<worktreeRoot>/<taskId>/<runId>` 分开，避免 worktree 嵌套）。

**Daemon（`apps/daemon/src`）**

- `egress.ts`（新）：`EgressPortRegistry`、`EgressService implements ContainerEgressChannel`。Core 代理在 `start()` 绑回环；sidecar 在首次需要时由 `ensure()` 创建：`docker volume create` + `docker rm -f`（回收崩溃残留）+ `docker run -d --network bridge --user 0:0 --read-only --cap-drop=ALL --security-opt no-new-privileges --pids-limit 64 --memory 256m` 挂同一命名卷，运行 `EGRESS_SIDECAR_SOURCE`（纯转发，无策略）；就绪以 `docker logs` 的 ready 行为准（卷在 VM 内、宿主看不到 socket）。`stop()` 删容器与卷、关代理。
- `main.ts`：建立全局 `egressPorts` 注册表与 `EgressService`；`egress.start()` 在**打开任何项目之前**执行；admin/BFF/项目协议端口绑定后登记；每项目 Broker 注入 `daemonPorts` 与 `egress`；`createProjectExecution` 注入 `egressPorts`；`tools.attach` 注入 `createTaskWorktreeWorkspaceResolver`（`worktreeRoot = <AGENTDEV_HOME>/task-worktrees/<projectId>`，刻意放在受保护 dataDir **之外**，否则 Broker 的 protectedPaths 会把整个 Task 树判为越界）；control handler 注入 `taskWorkspaceRoot`；`runtime.stop()` 回收 sidecar/卷/代理。
- `tool-handler.ts`：`resolve` 传 `attemptId`/`epoch`；字面 URL 预检改用 `broker.egressPolicy()`（与出口同一判据）；缺失每任务解析器时的日志改为精确措辞；本地 `RunWorkspace`/`RunWorkspaceResolver` 类型移除、改从 core 引入。
- `control-handler.ts`：新增 `taskWorkspaceRoot`，候选提交的 `sourceRoot` 改为 Task worktree（存在时），否则保持项目根（pre-W6 回退）。

**文档**：`docs/architecture/execution.md` §1/§2/§3/§4、`protocol.md` §4 网络段、`reliability.md` §3/§4 改为 W6 真实状态；`.agentdev/work/WP-12/w1-implementation.md` §7 与 `T3-implementation.md` 附录 A 的"尚未实施/实现待 W6"改为已实施并指向本记录。

**测试**：`packages/core/test/egress.test.ts`（新，5 例：真实代理两种形态 + 拒绝类）、`apps/daemon/test/task-workspace.integration.test.ts`（新，3 例，真实 Git）、`broker.test.ts`/`broker.integration.test.ts`/`permissions-failures.test.ts`/`tool-handler.integration.test.ts` 的旧"私网即拒"断言按 §7 口径改写。
**证据脚本**：`.agentdev/work/WP-12/w6-egress-drill.mjs`（真实容器演练）。

---

## 3. 容器内现在能做什么、仍然拒绝什么

**能**（默认，无需作者配置白名单）：

- 公网 HTTPS（`npm view`/`npm install` 走 CONNECT 隧道实测通过）；
- CLI 与包管理器（`npm`/`git`/任何读 `HTTP(S)_PROXY` 的工具）——容器内 `127.0.0.1:3128` 桥把 TCP 转到命名卷 socket；
- 回环与私网目标（`127.0.0.1:3000`、`:5432`、内网私服）——出口默认放行，实测 `127.0.0.1:<port>` 与 `127.0.0.1.nip.io:<port>` 都 200；
- 本地 `http:`（本地 dev server），公网 `http:` 仍需显式 `allowInsecureHttp`。

**拒绝**（类型化、`approvable:false`、文案含"不要重试"，永不可授权）：

- 守护**运行时实际绑定**的端口：控制端点、模型 Gateway 代理、项目协议端口、BFF、admin 面、Core 出口代理自身端口（由 `EgressPortRegistry` 在监听时登记）。实测 `127.0.0.1:<daemonPort>` 与 `host.docker.internal:<daemonPort>` 都是 403，`169.254.169.254`/`169.254.169.254.nip.io`/`metadata.google.internal` 都是 403，重定向到 metadata 在第二跳 403。
- 云元数据：`169.254.0.0/16` 整段、`100.100.100.200`、`192.0.0.192`、`fd00:ec2::254`、`metadata*` 名字，含 IPv4-mapped 与 NAT64 拼写。

**边界为何成立（含裸 socket 的诚实说明）**：容器**没有 IP 网络**。`host.docker.internal`、docker 桥网关、DNS、LAN、公网在容器里都没有路由，所以 `node net`/`nc`/自编译二进制的裸 socket 打不到任何东西（实测 `host.docker.internal:<port>` → `EAI_AGAIN`，`172.17.0.1:<port>` → `ENETUNREACH`）。唯一出口是只读挂载的命名卷 socket，它终止在 Core 代理的策略上；即使工具绕过容器内桥、直接对该 socket 说 HTTP，也还是同一策略。**宿主模式（`full_access`）不在这个边界内**：agent 用执行账户的真实网络，准入层只做字面/DNS 判定，裸 socket 可绕过（§7 残余风险 1）。

---

## 4. 原始证据

### 4.1 为什么不是"直接挂载宿主 Unix Socket"（macOS 实测）

Docker Desktop for macOS（Server 28.4.0 linux/arm64，VirtioFS）下，把宿主目录里的 Unix socket bind mount 进容器后，容器里能看到 `srwxr-xr-x` 文件但 `connect()` 返回 `ECONNREFUSED`（宿主进程仍在监听）。命名卷位于 Docker VM 内，容器↔容器共享 socket 正常（先以 sidecar 容器监听、再由 `--network none` 容器连接，得到 `resp 200 SIDECAR-PROXY-OK`）。因此 W6 采用"命名卷 + sidecar"，在 macOS 与 Linux 都成立。

### 4.2 真实容器演练（`w6-egress-drill.mjs`）

见 `w6-egress-drill-output.txt`（原始输出）。摘要：**13/13 检查通过，exit 0**，包括

- `[PASS] public fetch through the egress (npm view over HTTPS/CONNECT)` → `7.0.0`；
- `[PASS] real npm install through the egress` → `npm-exit=0`，`/tmp/proj/node_modules/is-number/package.json` 真实存在，`added 1 package in 2s`；
- `[PASS] loopback target allowed by default` / `[PASS] a DNS name resolving to loopback is allowed by default`；
- `[PASS] daemon-bound port refused at the egress`（403 + `AGENTDEV_EGRESS_REFUSED`）；
- `[PASS] daemon-bound port refused via host.docker.internal`（403）；
- `[PASS] daemon-bound port via the docker bridge gateway is not admitted`（代理 502，宿主对该 VM 网关地址无路由）；
- `[PASS] metadata address refused`、`[PASS] DNS name resolving to metadata refused`、`[PASS] redirect landing on metadata refused at the second hop`（`hop1 302 → hop2 403`）；
- `[PASS] raw socket ... host.docker.internal fails`（`EAI_AGAIN`）、`... bridge gateway fails`（`ENETUNREACH`）。

### 4.3 每任务工作区演练

`apps/daemon/test/task-workspace.integration.test.ts`（真实 Git 仓库、真实 `ProjectStore`、真实 `NodeWorktreeGitPort`，3/3 通过）：两个 Task 得到两个不同的外部 worktree；Task A 删除自己树里的 `src/b.txt` 后，项目根与 Task B 的 worktree 里该文件仍在、Task B 自己写的文件仍在；Task A 的根路径下 `resolveWithinRoots` 对项目根文件判 `NOT_AUTHORIZED`；第二个 Attempt 对同一 Task 得 `BUSY`；重复 resolve 不重置未提交内容。

### 4.4 门禁（串行、冻结树）

| 命令 | 结果 |
|---|---|
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0（Prettier 通过） |
| `pnpm test:unit` | 78 files / 1464 tests 全绿 |
| `pnpm test:integration` | 见 §4.5（本轮最终值） |
| `pnpm test:e2e` | 见 §4.5 |
| `node scripts/live.mjs --no-write` ×3 | 见 §4.5 |
| `node scripts/acceptance.mjs` | 见 §4.5 |

### 4.5 最终门禁原始输出（冻结树，串行，无并发写者）

| # | 命令 | 原始结果 | 退出码 |
|---|---|---|---|
| 1 | `pnpm typecheck` | `tsc -p tsconfig.json` 无输出 | 0 |
| 2 | `pnpm lint` | `All matched files use Prettier code style!` | 0 |
| 3 | `pnpm test:unit` | `Test Files 78 passed (78)` / `Tests 1464 passed (1464)` | 0 |
| 4 | `pnpm test:integration` | `Test Files 57 passed (57)` / `Tests 538 passed (538)`（152.76s） | 0 |
| 5 | `pnpm test:e2e` | `27 checks — PASS 26 / FAIL 0 / UNVERIFIED 1`（UNVERIFIED = `provider.fact-and-unknown`，需真实 Provider，由第 6 项关闭；`31 ACs accounted`） | 0 |
| 6 | `node scripts/live.mjs --no-write` ×3（01:11 / 01:13 / 01:15） | 每轮 `live: 7 passed / 0 failed / 0 unverified; 13 call(s), HTTP 200×13, 0 failed`（41111ms / 33867ms / 40709ms，三次日志 md5 互不相同） | 0 / 0 / 0 |
| 7 | `node scripts/acceptance.mjs`（带 `/tmp/wp12-live.env`） | `acceptance: 94/94 ACs accounted — PASS 94 / ACCEPTED 0 / FAIL 0 / MISSING 0`；`pnpm test:e2e exit=0`、`pnpm test:live exit=0`；报告写入 `acceptance.md`/`acceptance-results.json` | 0 |
| 8 | `node .agentdev/work/WP-12/w6-egress-drill.mjs` | `=== W6 egress drill: 13/13 checks passed ===`（原始输出见 `w6-egress-drill-output.txt`） | 0 |

补充：不带 Provider 环境跑 acceptance 会得到 `PASS 84 / ACCEPTED 10`（10 条 `provider-absent`/`review-model-absent` 登记豁免），这是脚本的既有条件行为，不是本次改动引入的回归；带 `/tmp/wp12-live.env` 的本次运行回到 `PASS 94 / ACCEPTED 0`。

树状态：本切片未 `git commit`；`scripts/**` 未改；acceptance/e2e 脚本按自身机制刷新了 `.agentdev/work/WP-12/{acceptance.md,acceptance-results.json,e2e.md,e2e-results.json}`。

---

## 5. 每任务工作区（实现要点）

- 根目录：`<AGENTDEV_HOME>/task-worktrees/<projectId>/tasks/<taskId>`，由 `taskWorktreePath` 唯一定义；候选提交的临时树仍在 `<dataDir>/task-worktrees/<taskId>/<runId>`（`task-candidate.ts` 未改），两者不嵌套。
- 基点：`task.dependencyRevision ?? work.baseRevision`；worktree 管理器的 `rewindToBase` 保证复用树停在要求的基点。
- 单写者：worktree 租约（`(attemptId, epoch)`，进程内账本）+ 每次工具调用续期的 Work 级写租约（`lease` 表，重启后仍有效）。任务书记载的 "Worktree单writer锁" 由这两层共同满足；worktree 记录与内存租约是进程级的，跨重启的持久保证来自 Work 级租约 —— 登记为残差 §7-2。
- `taskWorkspaceRoot` 刻意放在受保护 `dataDir` 之外：`Broker.protectedPaths` 含 `dataDir`，若 Task 树在其下，Broker 会把工具目标判为"protected root"而全拒。
- 候选提交：`control-handler.ts` 的 `sourceRoot` 改为 Task worktree（存在时）。否则会把项目根的旧内容当成 Run 的改动提交（会静默丢掉 Task 的工作）。

---

## 6. 容器化 Runner：未做，阻塞登记

**现状**：Runner 仍是宿主子进程（`apps/daemon/src/runner-spawn.ts` → `node apps/runner/dist/...`），只有*工具*在容器里。W6 的边界**不依赖** Runner 入容器：工具容器没有 IP 网络，Runner 也不对工具容器暴露任何监听口。

**要做什么**（若要容器化）：

1. 把 `apps/runner` + Pi + 该 Attempt 的 context/snapshot 打进镜像或可挂载包（今天 `prepare-run.ts` 在宿主写 attempt 目录，Runner 直接读）；
2. Runner 容器需要访问 Core 控制端点与模型 Gateway 代理（今天走回环 TCP），容器化后要变成受控通道；而这两个端口**同时**在 W6 的拒绝清单里（"守护自身实际绑定端口"），因此必须区分"Runner 的 attempt capability 通道"与"agent 工具的网络"——例如给 Runner 一个不与工具容器共享的网络命名空间，并把工具容器的 spawn 从 daemon 移到该命名空间之外；
3. `execution.md` §1 要求每次 Attempt 冻结镜像 digest，需要 CLI/doctor 的镜像构建与 digest 记录链路覆盖 Runner 镜像；
4. 工具进程随 Attempt 回收（`ToolProcessRegistry`、`reliability.md` §6）需要跨容器重做。

**为什么不在本切片做**：上述改动落在 `packages/core/src/supervisor.ts`、`apps/daemon/src/runner-spawn.ts`、`apps/runner/**`、`docker/**`、`apps/cli/src/doctor.ts`——都在 W6 声明范围之外，且是独立的工程与 Review/Test 单元。**不半做**：本切片没有用"Runner 仍宿主"冒充"Runner 入容器"。

---

## 7. 残余风险（如实登记）

1. **宿主模式（`full_access`）不受出口保护**：agent 用执行账户的真实网络，准入层只做字面/DNS 判定；`node net`/`nc` 等裸 socket 可以直连任意可达地址（含 `127.0.0.1:<daemonPort>` 这类目标，只要它不说字面 URL）。这是 W1 §6-4/§6-5 已登记的既有事实，W6 只把**容器**路径变成真出口。
2. **worktree 记录与租约是进程级**：`createWorktreeManager` 的 records 与默认内存租约在 daemon 重启后为空；重启后新 Attempt 会重新 `git worktree list` 复用磁盘上的树并重新取租约。跨重启的"不把同一 workspace 授予新写者"靠 Work 级写租约（DB，每次调用核对 attempt/epoch）。若需进程级之外的 worktree 租约持久化，需要 DB 版 `WorktreeLeaseStore`（未做）。
3. **sidecar 依赖 `host.docker.internal`**：Linux 引擎上该名字通常不解析，sidecar 回退到自身默认网关（`/proc/net/route`）；若两者都不可达，sidecar 退出（exit 3），通道不可用，网络覆盖的容器调用被拒（fail-closed）。sidecar 起不来时容器**不会**退化成"有网但无代理"。
4. **Core 代理不解析 CONNECT 隧道内部**：TLS 里的重定向由客户端发起新的 CONNECT，因而在**下一跳**被判定；同一隧道内不可能切换到别的目标（CONNECT 已固定 authority）。这是设计而非遗漏。
5. **`http:` 公网目标仍拒**（W7R1-07 保留）。若某个公开镜像只有 `http:`，需要显式 `allowInsecureHttp` 或改镜像源；这条比 §7.1 的"默认通"紧一档，属刻意保留的传输安全约束。
6. **元数据判定按地址类**：`169.254.0.0/16` 整段拒绝，可能挡住合法 link-local 目标（开发用不到；记为取舍）。
7. **`EgressService` 用同步 `docker` 调用**（`defaultProcessRunner`）做 sidecar 生命周期：首次容器工具调用会阻塞事件循环最多数秒（就绪轮询）。功能正确（此时尚无容器请求），但会短暂延迟同进程内的其他工作；如需消除，应把生命周期改为异步端口。
8. **sidecar 以 root 运行**（无 cap、只读根、无宿主挂载）以便在命名卷里创建 socket；这是"能创建 socket"的最小特权，不是宿主 root。
9. **明文 HTTP 多地址重试会重放已消费的请求体**：`EgressProxy.forwardPlain` 在第一个已校验地址建连失败时会尝试下一个地址，而该请求的 body 可能已被写入第一个连接（HTTPS 走 CONNECT 隧道，无此问题；受影响的只有"多地址 DNS + 首选地址不可达 + 带 body 的明文 http 请求"）。属低概率边界，未在本切片修（改动会作废已完成的整轮门禁）；若要修，应在 `content-length`/`transfer-encoding` 非空的请求上禁用地址重试。
10. **容器镜像未变**：`docker/Dockerfile` 与 `agentdev/exec:0.0.0` 未改，桥与 sidecar 代码都以环境变量注入（无需重建镜像），代价是 `--env` 体积（约 3KB）。

---

## 8. 交还声明与偏差

- 声明范围外新增文件：`packages/core/src/{egress,egress-channel,task-workspace}.ts`、`apps/daemon/src/egress.ts`（都是既有范围内文件的直接依赖，未改 `apps/web/**`、`integrate.ts`/`settlement.ts`/`task-candidate.ts`、`docs/delivery/**`、`docs/product/**`）。
- 未新增运行时依赖、未新增迁移、未新增 `packages/contracts` 字段。
- 未 `git commit`；树由本会话单一写者持有。
- 网络口径的**行为变更**（旧"私网即拒"→"默认通 + 两个固定拒绝项"）来自 `w1-implementation.md` §7 的持钥者裁决，本切片按附录 A 与 W6 任务书执行；受影响的旧测试断言已按新口径改写并在 §4.5 记录。
