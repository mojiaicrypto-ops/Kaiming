# WP-12 T5 实施计划：单入口多项目与项目初始化

- 状态：Planning（待用户对「待决问题」表态）
- 上级依据：`.agentdev/work/WP-12/plan.md` §4 T5 行（L69）、§2 DoD 第 6 条（L34）、§3 D4/D5/D8/D9/D12；`.agentdev/work/WP-12/api-gap-audit.md` §1.1（L33–44）、§2.3、§3 第 5 条；`docs/architecture/ARCHITECTURE.md` §1（L7–17）、§2（L19–38）、§4（L50）、§5（L88）；`docs/architecture/protocol.md` §1（L11）、§2（L17–33）、§3（L37–52）、§7（L142–146）；`docs/architecture/reliability.md` §7（L61–69）、§9（L79–91）；`docs/product/experience.md` §1（L7/L18）、§4（L47）；`docs/product/requirements.md` §1–§5；`docs/delivery/acceptance.md` AC-023/024/025/026/027/028/029/034/060/082/087/088/089。
- 约束：**只读仓库**；本文件是唯一写入目标。不改 `packages/**`、`apps/**`、`scripts/**`、`docs/**`；不新增运行时依赖；不改十条 `pnpm` 契约命令名；不新增/修改 AC 与产品行为（发现文档与代码冲突一律登记为待决问题，不代为裁定）。

---

## 1. 现状证据（逐条核对代码，含修正）

| # | 事实 | 证据（file:line） |
|---|---|---|
| E1 | 多项目**已由宿主进程实现**：`main.ts` 内一个 `instances[]` + 每项目一对 `daemon`/`web` 端口。但第 2 个及以后项目的 `webPort` 走 `0`（临时端口），只有第 1 个项目用 4318/4317。 | `apps/daemon/src/main.ts:261-341`、`:343-361`（`instances.length === 0` 分支在 `:351-356`）；`apps/daemon/src/bootstrap.ts:270-288` |
| E2 | **第 2 个项目 BFF 的 Origin 白名单是错的**：`bootstrap` 未收到 `allowedOrigins`，一律回退 `[DEFAULT_WEB_ORIGIN]`（`http://127.0.0.1:4317`），而它自己监听在临时端口。于是该 BFF 的浏览器写请求与 `/ws` 升级会被自身 Origin 校验拒绝。这不是「缺功能」，是现存缺陷。 | `apps/daemon/src/bootstrap.ts:152`、`:275-288`；`apps/web/src/app.ts:202-205`、`:413`、`:217-222`；`apps/daemon/src/main.ts:208-211`（全安装共享一个 `AuthService`，白名单只有 4317） |
| E3 | `/projects` 页只渲染**一个**项目：数据来自本 daemon 的 `project.snapshot.get`，列表被硬编码成 `[project]`；无项目切换器；导航链接都是同 origin 相对路径。 | `apps/web/src/app.ts:513-543`（`:535`）；`apps/web/src/pages.ts:159-207`（`:177`）；`apps/web/src/shell.ts:70-127`、`:234`、`:265-267` |
| E4 | `project.list` 只能列出**本 store 的 1 行**；`project.open` 只接受本 daemon 已持有的 root，其它 root 一律 `NOT_FOUND`。 | `apps/daemon/src/protocol.ts:1053-1065`、`:1067-1097` |
| E5 | 跨项目 id 在 daemon 边界被硬拒绝，这是隔离的既有承重墙。 | `apps/daemon/src/protocol.ts:812-822`（`needsProject && projectId !== this.projectId → NOT_FOUND`） |
| E6 | `project.create/clone/trust/close/initialize` **全仓无实现**；唯一开户入口是回环 admin 面 `POST /projects`（只有 `root`/`trust`），CLI `open` 走它。 | `apps/daemon/src/main.ts:615-658`；`apps/cli/src/cli.ts:242-276`；`api-gap-audit.md:37-41` |
| E7 | `trust` **只写不读**：开户时落 `projects.trust`，之后无任何准入/门禁消费它（`grep` 生产源码仅写入点与回显点）。「撤销信任停止新准入」无实现。 | `apps/daemon/src/main.ts:358`；`apps/daemon/src/bootstrap.ts:186-196`；`apps/daemon/src/protocol.ts:1095`、`:3992` |
| E8 | `packages/workspace/src/initialize.ts` 状态机**完备但零生产调用方**：`createInitializer` 只被测试引用；`checkDeliveryReadiness`（脏工作区/无 Git 阻断）与 `evaluateReadyGate` 同样无生产调用方。Node 版 `GitPort`/`FileSystemPort` 工厂齐备。 | `packages/workspace/src/initialize.ts:931`、`:505`、`:593`、`:95`、`:1044`；`packages/workspace/test/initialize.test.ts`、`packages/core/test/wp08.integration.test.ts:1194-1254`（仅测试） |
| E9 | 初始化状态存储是**无锁 JSON 读改写**（`save` 整文件覆写），并发初始化会丢更新。 | `packages/workspace/src/initialize.ts:399-460` |
| E10 | **首次 open 无需求导入**：`openRoot` 无导入步骤；`parseRequirementPool`/`importRequirementPool`（`.agentdev/requirements` 解析/导入）无生产调用方。 | `apps/daemon/src/main.ts:343-361`；`packages/knowledge/src/requirements-pool.ts:719`、`:997`、`:1167` |
| E11 | 需求池的**库能力已齐备**：`RequirementProjection.import` 落投影并发 `requirement.imported`；双文件+索引提交、`requirement.continue`、`requirement.save.retry` 都有实现，只差「首次 open / 显式 import」的调用方。 | `packages/core/src/requirements.ts:96-220`（事件 `:174`/`:191`）；`packages/core/src/requirement-save.ts:2700`；`packages/core/src/requirement-continue.ts` |
| E12 | **现有 AC-023/025–029/034/087–089 的证据全部是库级测试或播种行**，不能当作产品路径证据：AC-087/089 的关键证据 `apps/daemon/test/protocol.integration.test.ts:655-692` 用 `seedRequirement`，`apps/web/test/workbench.integration.test.ts` 同样播种；AC-023 只有 `packages/core/test/identity.integration.test.ts`。 | `.agentdev/work/WP-12/acceptance-results.json`（对应条目 evidence）；`apps/daemon/test/protocol.integration.test.ts:655`、`apps/web/test/helpers.ts:448-473`（`seedRequirement`） |
| E13 | `project.created`、`operation.failed`、`initialization.progress/completed` **从未发出**；`EventHub` 是每项目一个，事件必须挂在某个 `projectId` 的流上——项目生命周期事件在「项目尚不存在」时**没有归属流**。 | `api-gap-audit.md:106`、`:116`、`:120`；`apps/daemon/src/bootstrap.ts:207`（`new EventHub({ store })`）；`packages/core/src/events.ts` |
| E14 | 只有**home 级**单实例锁（`daemon.lock` + epoch），**没有 per-Git-root 锁**；`reliability.md` §7「daemon 获取每 Project 文件锁」未实现。两个不同 `AGENTDEV_HOME` 的安装可同时打开同一 Git 根。 | `packages/core/src/runtime.ts:204-252`；`apps/daemon/src/main.ts:319-341`（去重仅进程内 `instances.find`） |
| E15 | 注册表是**整文件 strict schema**，且消失的 root 会让启动整体抛错：`readProjectRegistry` 一处校验失败 → 启动失败；`resolveProjectIdentity` 对不存在的路径直接 `realpathSync` 抛 ENOENT。 | `packages/core/src/runtime.ts:292-314`；`packages/core/src/identity.ts:66-68`；`apps/daemon/src/main.ts:323`、`:537-548`、`:574-578` |
| E16 | daemon 的 `/rpc` 与 `/ws` **都接受安装凭证 Bearer**；`/ws` 的 bearer 分支只要求 Origin 非空、不查白名单。这让「一个 BFF 按项目转发到多个 daemon」在传输层已经可行。 | `apps/daemon/src/protocol.ts:643-649`、`:685-699`；`apps/web/src/daemon.ts:389-399`（桥已用 `Authorization: Bearer`） |
| E17 | 浏览器客户端从不发 `project.*`；`/projects` 是纯 SSR；WS 订阅里已带 `projectId`（`shell.dataset.project`）。 | `apps/web/public/app.js:301`、`:482`、`:510-524`；`grep project.list apps/web/public/app.js` 无命中 |
| E18 | 契约形状：`project.*` 在 `protocol.md` §3；`project.created`/`operation.failed`/`initialization.*` 在 §7；§1 规定「全局方法省略 projectId，Project 方法必填 projectId」。`project.trust/close/initialize` 的 params 里**没有 projectId**。`project.create` 的 `name` 在数据模型里**无处存放**（`project` 表无 name 列，`ProjectSummary.name` 由 `basename(root)` 推导，注册表条目也无 name）。 | `docs/architecture/protocol.md:11`、`:37-46`、`:142`；`packages/contracts/src/entities/project.ts:38-51`、`:138-150`；`packages/contracts/src/runtime.ts:69-87`；`apps/daemon/src/protocol.ts:3987-3996` |

**核对结论**：任务书列出的缺口全部成立；需要修正/加强的表述有三条——①「多项目不可用」的直接原因之一是 E2 的 Origin 白名单缺陷，而不只是「没有 UI」；②「文档有实现无」的 `project.*` 里，`name`（E18）与 `grantId`（见 Q4）连**存放/校验位置**都没有；③`initialization.*` 事件的归属流（E13）是 T5 自己必须解决的问题，不能推给 T9。

---

## 2. 目标（T5 的可验收定义）

在一台安装（一个 daemon 宿主 + **一个** BFF 入口）上打开两个真实 Git 项目后：

1. 浏览器**登录一次**；`/projects` 列出该安装已注册/已打开的全部项目（含未打开的可发现条目），可切换；切换改变观察范围，不改变后台工作（`experience.md:18`）。
2. 每个页面（看板/需求/Chief/Runs/Files/Inbox）在切换后只呈现**该项目**的真实数据；用另一个项目的 projectId 请求任何读/写，得到 `NOT_FOUND`（或 `CONTEXT_FORBIDDEN`），**不返回对方任何内容**（AC-034）。
3. `project.create/clone/trust/close/initialize` 是真实可调用的协议方法：形状与 `protocol.md` §3 一致，成功/失败/事件可观察；`project.created`、`operation.failed`、`initialization.progress/completed` 有真实发射点。
4. 空目录 `create` 建出初始 Git 与 `agentdev/main` 交付分支（AC-025）；旧项目 `initialize` 在预算内调查、来源/未知明确、代码不移动（AC-026）；无 Git 目录先只读问答、正式写入前取得 Git 初始化授权（AC-027）；脏工作区保留数据并给出逐路径 Hash 报告（AC-028）；写入中断后重试按 Hash 恢复、冲突不覆盖（AC-029）。
5. 第二个安装（新 `AGENTDEV_HOME` + 空 SQLite）`clone` 同一仓库后，`queued/active/completed/cancelled/archived` 需求全部可见，`active` 标「待继续」且不启动 Run（AC-087/088/089），全程**不播种任何需求行**。
6. `packages/workspace/src/initialize.ts` 有生产调用方；`pnpm typecheck|lint|test:unit|test:integration|test:e2e` 全绿。

---

## 3. 切换方案对比与推荐

### 3.1 三个候选

- **(a) 浏览器跳到目标项目自己的 BFF/daemon 端口对**：UI 列项目 → `location.assign('http://127.0.0.1:<webPort>/projects/<id>/chief')`。
- **(b) 一个 BFF 多路复用到多个 daemon，各自会话/凭证**：BFF 同时持有 N 个上游连接与 N 套 daemon 会话；浏览器一个 WS 承载所有项目的订阅。
- **(c) 一个 BFF 保持单一 origin，按项目代理到所选项目的 daemon**：浏览器一个会话、一个 origin、一个 WS（绑定当前项目）；BFF 按 `envelope.projectId`（`/rpc`）或页面路径/`/ws?projectId=`（订阅）选择目标。

### 3.2 逐项对照（含「各方案会坏在哪」）

| 维度 | (a) 切换 origin | (b) 单 BFF 并发多路复用 | (c) 单 BFF 单 origin 代理 |
|---|---|---|---|
| 与 `ARCHITECTURE.md` §1/§2、`protocol.md` §2 一致 | **不一致**：文档只有一个 `agentdev-web` 与对外只暴露一个 BFF；实现要对外暴露 N 个 BFF 端口 | 一致（一个 BFF） | 一致（一个 BFF、一个 origin） |
| 浏览器会话 | cookie 不按端口隔离（RFC6265 按 host），但**每个 BFF 各有 `WebSessionStore`**（`bootstrap.ts:283`），切过去必然重新登录；要免登录必须把 `WebSessionStore` 从 main.ts 注入共享 | 天然一个会话 | 天然一个会话 |
| Origin/CSRF | **会坏**：每个 BFF 必须允许自己的真实 origin（现为 4317 常量，E2）；全安装共享的 `AuthService` 白名单也要容纳 N 个动态端口，而该白名单在项目监听前就固定（`main.ts:208-211`）；`/ws` 升级校验 `allowed.includes(origin)` 同样受影响 | 不变（一个 origin） | **不变**（一个 origin，`app.ts:413`、`:217` 原样） |
| 订阅游标/水位 | 每 origin 独立，无跨项目游标；代价是切项目=换 origin，live 面板整体重置 | 需要「按项目分别维护 cursor/水位 + 单 WS 多路分发」的新语义，光标越界风险最高 | WS 在升级时即绑定一个项目（`/ws?projectId=`），游标天然不跨项目；切项目=整页导航=新 WS+snapshot |
| Artifact URL | 相对路径自动指向当前 origin，**无需改动** | `/artifacts/*` 无 projectId，必须新增「这个 token/artifact 属于哪个项目」的解析 | 同 (b)：需在 BFF 自有 URL 里带上项目上下文（见 Q6） |
| Live 事件 | 每个端口各自流；非当前项目不观察 | 可同时观察所有项目（非文档要求） | 只流当前项目（符合 `experience.md:18` 的「改变观察范围」） |
| 隔离承重墙 | 端口+进程内 store 天然隔离，但**第 2 个项目 BFF 当前是坏的**（E2） | 依赖 BFF 路由正确性；daemon 侧 `protocol.ts:812-822` 仍是兜底 | 同 (b)，且 daemon 侧兜底同样生效 |
| 工作量/风险 | BFF 侧改动最小，但要求改 `AuthService`/`bootstrap` 的 Origin 机制（跨 packages/core），且项目越多对外端口越多 | BFF 并发多路复用 + 多项目事件循环，最大 | BFF 改成「按项目选目标」+ 单 BFF 由宿主创建；改动集中在 `apps/web/**`（本切片可写）与 `main.ts`/`bootstrap.ts` |

### 3.3 推荐：**(c)**，并说明为什么不是 (a)

**推荐 (c)**，理由按优先级：

1. **只有 (c) 同时满足「单入口」与「Origin/CSRF 校验不变」**：T5 行原文要求「BFF 增加项目选择与切换（含 CSRF/Origin 校验不变）」，等价于保持一个 origin；`protocol.md` §2 只给了一个 BFF 地址（4317），`ARCHITECTURE.md:17` 明确 Web「只提供静态界面、认证代理和授权 Artifact 转发」。
2. **(a) 的真实代价被低估**：它不仅要共享会话存储，还要把全安装的 `AuthService` 白名单改成「多动态端口」（`main.ts:208-211` 在监听前固定），或给每个项目独立 `AuthService`；并且第 2 个项目 BFF 目前**已经是坏的**（E2），修它等于同时改 `packages/core` 的认证语义。对外暴露 N 个 BFF 端口也与反向代理只暴露一个 BFF 的部署规范冲突（`reliability.md:69`）。
3. **(b) 的额外能力（同时观察多个项目）不是契约要求**：`experience.md:18` 只说切换改变观察范围。多路复用会把 cursor/水位、`subscription.set` 跨目标、桥接连接生命周期一次性带入 T5，风险最大。
4. **(c) 的传输层已经就绪**：`/rpc` 与 `/ws` 都接受安装凭证 Bearer（E16），`BridgeConnection` 本身就是「一个 target、一个上游 socket」（`daemon.ts:372-399`），把 target 从「进程常量」改成「按请求/按连接解析」是局部改动。
5. **(c) 的隔离是「双保险」**：BFF 按项目选目标 + daemon 端 `projectId !== this.projectId → NOT_FOUND`（`protocol.ts:812-822`）。即使 BFF 路由写错，最坏结果是 `NOT_FOUND`，不是串数据。

**(c) 的已知代价（必须写进实现与测试）**：
- `WebSession` 现在只有一个 `daemonCookie/csrfToken`（`apps/web/src/sessions.ts:20-30`），要扩成按目标缓存的 daemon 会话表；BFF 用安装凭证为每个目标静默 `daemonLogin`（凭证已在 `DaemonTarget.bearer`），保留「session 作为审计主体」的语义（`protocol.md:21`）。
- BFF 自有的 `/artifacts/*` 路由必须携带项目上下文（现为 `/artifacts/<id>/preview`、`/artifacts/download/<token>`，`views.ts:556`、`app.js:1308`）；见 Q6。
- `/ws` 需要在握手时知道项目（建议 `/ws?projectId=<32hex>`，绑定在连接上，切项目走整页导航）。
- `main.ts` 改为「所有项目 `withWeb:false` + 宿主创建一个 BFF」；`bootstrap.withWeb` 仅保留给演练/测试。

### 3.4 隔离的「按设计不泄漏」论证 + AC-034 必测项

承重墙（每一条都可指向代码）：

| 资源 | 隔离机制 | 证据 |
|---|---|---|
| SQLite | 每项目独立 `ProjectStore`，文件在 `~/.agentdev/projects/<projectId>/` | `bootstrap.ts:162-172`；`contracts/runtime.ts:179-182` |
| 事件游标 | 每项目独立 `EventHub`，cursor 只在其 store 的 `events` 序列内有意义 | `bootstrap.ts:207`；`protocol.ts:1099-1112`（`cursor: events.watermark()`） |
| 事件订阅 | 连接绑定一个 daemon；跨项目 id 直接 `NOT_FOUND` | `protocol.ts:812-822`、`:3846-3965` |
| Artifact/下载 token | `BlobStore`、`ArtifactService`、`DownloadTokenStore` 均按项目目录构造 | `bootstrap.ts:182`、`:205-206` |
| 附件 | `AttachmentService` 按项目 store；owner 是安装身份但行在项目库 | `bootstrap.ts:204`；`protocol.md:21` |
| 会话 | 单用户安装，会话不是隔离边界；隔离靠「项目选择 + daemon 端 id 校验」 | `protocol.md:19-21`；`protocol.ts:812-822` |
| 文件只读预览 | BFF 的 `NodeFilePort` 以 `project.snapshot.get` 的 root/revision 为根，且有 boundary 校验 | `apps/web/src/app.ts:661-719`；`apps/web/src/files.ts` |
| Watchers | 无 fs watcher；Runner/Worktree 根在项目 `dataDir` 下 | `bootstrap.ts:233`；`main.ts:384` |

**必须存在的 AC-034 测试**（产品路径，非库测）：两项目各写一行专属数据后，①按 projectId 交叉读全部 `NOT_FOUND` 且响应体不含对方字段；②A 的 `artifact.download.prepare` token 在 B 的路由上失败；③A 的订阅 cursor 在 B 上不得重放 A 的事件（只能是 snapshot 或 `RESYNC_REQUIRED`）；④BFF 层「请求 B 却被指向 A 的 daemon」时，因 BFF 注入/校验 projectId 而失败关闭（不得静默返回 A 的默认项目数据——这是 (c) 唯一的真实泄漏面，因为 `dispatch` 只在**提供了** projectId 时才做不匹配校验，`protocol.ts:813`）。

### 3.5 失败路线（含用户可见结果）

| 场景 | 现状（证据） | T5 目标行为 |
|---|---|---|
| 项目根消失 | `resolveProjectIdentity` 抛 ENOENT（`identity.ts:66-68`），`startRuntime` 的 roots 循环无逐根容错 → **整个 `agentdev start` 失败**（`main.ts:537-548`、`:574-578`） | 启动跳过并隔离该条目；注册表标 `missing`；`/projects` 显示「路径不存在」；对该项目 `project.open` 返回 `NOT_FOUND` 且带 reason；其它项目照常 |
| 注册表条目损坏 | `readProjectRegistry` 整文件 strict 校验失败 → 启动失败（`runtime.ts:292-314`） | Q2：逐条容错（保留有效条目、隔离坏条目并上报）或维持 fail-closed + 恢复命令 |
| 两个 daemon 争同一 root | 无 per-root 锁（E14）；不同 home 可同时打开，双 SQLite + 双 supervisor 写同一 Git 根 | 在 Git 公共目录加 per-root 锁；第二个打开者得 `PROJECT_ALREADY_OPEN`（附持有 pid/home）；见 Q5 |
| 项目 A 初始化时打开项目 A/B | 初始化状态文件无锁读改写（E9）；无任何「initializing」可见性 | 宿主按 projectId 串行化；重复调用得 `BUSY`（retryable，`protocol.md:146`）；`project.snapshot.get` 暴露 `initialization` 状态与 blocker，准入被阻断 |
| 初始化写入遇到脏工作区/无 Git | 状态机已实现（`initialize.ts:505-565`），但无生产调用方 | `initialize` 返回 blocked + 逐路径 Hash 报告 / Git 初始化授权请求；**只读调查仍可用**（AC-027/028） |
| 项目根在读期间消失 | BFF 的 `safeRead` 把异常变成真实错误码渲染（`app.ts:821-841`） | 保持：页面显示真实 `NOT_FOUND`/`INVALID_STATE`，不编造空状态；运行中的 Run 走既有 recovery |

---

## 4. 项目生命周期命令对照（params/result/events ↔ 已有服务 ↔ 待写）

| 方法 | 文档 params → result/事件 | 已有实现 | T5 待写 |
|---|---|---|---|
| `project.list` | `filter:recent/running/all,limit?,cursor?` → `items<ProjectSummary>`（`protocol.md:39`） | 仅本 store 1 行（`protocol.ts:1053-1065`） | 改为**安装级**：由宿主目录端口列出全部已注册项目 + 已打开实例（`runningRuns`/`executionReady` 只在打开时可算，未打开的按 0/未知诚实标注） |
| `project.open` | `root:string` → `{projectId,version,trust,gitState}`，幂等（`:40`） | 只接受自己持有的 root（`protocol.ts:1067-1097`）；宿主 `openImpl` 已幂等（`main.ts:319-341`） | 委托给宿主目录端口：解析 root → 已在注册表/已打开则幂等返回，否则开户（受 trust 参数与授权约束） |
| `project.create` | `root,name` → `accepted；project.created`（`:41`） | 无 | 空目录校验（AC-025）→ AuthorizationRef → 初始化 Git + 初始 commit + `agentdev/main` 交付分支（复用 `initialize.ts` 的授权/Write 阶段，见 T5.3）→ 开户 → 发 `project.created`。`name` 无处持久化（E18）→ Q1 |
| `project.clone` | `remoteUrl,root,grantId` → `accepted；project.created/operation.failed`（`:42`） | 无 Git clone 端口（`grep clone packages/workspace/src` 无命中） | 新增 clone 端口（`git clone`，无新依赖）；`grantId` 语义无落点（无安装级 Grant 表）→ Q4；成功后走 T5.4 的首次导入 |
| `project.trust` | `trusted:bool` → `applied；撤销信任停止新准入`（`:43`） | 只有开户时写（`bootstrap.ts:193`）；`store.projects.update` 可用（`bootstrap.ts:197-199`） | 更新 `projects.trust` + 注册表；并把 `trust` 接到准入（至少：未信任项目不得 `project.initialize` 写入、不得建 Requirement/派 Run）。**准入点归 T2/T8 还是 T5 → Q7** |
| `project.close` | `{}` → `applied；只移出打开导航，有Run继续`（`:44`） | `unregisterProject` 存在（`runtime.ts:351-359`）；`projects.state='closed'` 可用 | 语义二选一 → Q3 |
| `project.initialize` | `mode:new/legacy,sourceMessageId:ID,budget?{files,bytes}` → `accepted；initialization.progress/completed`（`:45`） | 状态机完备（`initialize.ts:931`）；`StartInitInput` 只取 id/root/documentRoot/branch（`:694-701`）；预算字段名不同（`ScanBudget{maxBodyFiles,maxBodyBytes,maxIndexEntries}`，`scan.ts:275-279`） | 生产接线（T5.3）：`createJsonFileInitStateStore(join(dataDir,'initialization.json'))` + `createNodeWorktreeGitPort()`；`mode` 与扫描结果的一致性校验（Q8）；`budget.files/bytes` → `maxBodyFiles/maxBodyBytes`；驱动相位并发 `initialization.progress`，Ready 发 `initialization.completed`；blocked/failed 原样返回 blocker（Hash 报告/Git 初始化请求/设计冲突） |
| `project.snapshot.get` | `scope` → `{snapshot,cursor}`（`:46`） | 有（`protocol.ts:1099-1112`） | 补安装级/初始化/trust/blocker 字段（`initialization`、`deliveryReadiness`），供 `/projects` 页与 ADM 展示 |
| 事件 `project.created` | `protocol.md:142` | 无（E13） | 在新项目自己的事件流发出（`entityId=projectId`，data 含 root/name/trust）；创建失败时 `operation.failed` 只能落到请求方所在项目或无归属 → Q9 |
| 事件 `initialization.progress/completed` | `protocol.md:142` | 无（E13） | **归 T5**：发射点只能在初始化驱动器里；T9 只做其余事件补齐与校验（D9 不冲突） |
| 事件 `operation.failed` | `protocol.md:142` | 无 | create/clone/initialize 失败时随响应发出（归属见 Q9） |

---

## 5. 决定与待决问题

### 5.1 本计划内的实现决定（属「接线」，不改产品行为）

- **D-T5-1 切换模型 = (c)**：单 BFF、单 origin、按项目选目标；Origin/CSRF/cookie 语义不变（§3.3）。
- **D-T5-2 生命周期归属**：注册表、端口、锁、`instances` 的唯一写者是**宿主**；新增 `ProjectDirectoryPort`（接口放 `apps/web`/`apps/daemon` 均可，实现只放 `main.ts`），由宿主注入每个项目的 `WorkbenchProtocol` 与 BFF。每个 daemon 的 `project.*` case 只做「参数校验 + 委托 + 事件」，不自己发明第二个运行时（否则违反 `ARCHITECTURE.md:50`「同一 Git 根只打开一个 ProjectRuntime」）。
- **D-T5-3 单入口**：`main.ts` 以 `withWeb:false` 打开全部项目，自己创建一个 BFF（4317）；`bootstrap.withWeb` 保留给 `scripts/**`/测试的独立栈。
- **D-T5-4 切换器数据源**：`/projects` 用「注册表 + 运行中实例」，**不读 `runtime.json`**（它不是协议契约，`contracts/runtime.ts:100-113` 只服务 CLI `status`）。
- **D-T5-5 WS 绑定项目**：`/ws?projectId=<id>` 在升级时解析目标；`project.subscribe` 带的 `projectId` 必须与连接绑定一致，否则 `RESYNC_REQUIRED`/拒绝——这是「游标不跨项目」的结构保证。
- **D-T5-6 BFF 注入 projectId**：对非全局方法，若 `envelope.projectId` 缺失，BFF 用「当前页面的 projectId」补齐；补齐后目标 daemon 仍会做 `projectId !== this.projectId` 校验（`protocol.ts:812-822`）。这是 §3.4 第 ④ 项的落点。
- **D-T5-7 daemon 仍可保留每项目回环监听**：这是实现细节，不作为对外端口暴露；`project.close` 是否停监听见 Q3。
- **D-T5-8 不新增依赖、不改十条命令名**：clone/per-root 锁都用 `node:child_process`/`node:fs`（与既有 `NodeGitPort`/`NodeWorktreeGitPort` 同构）。

### 5.2 需要用户决定的问题（本计划不自行裁定）

- **Q1｜`project.create` 的 `name` 存哪里？**
  - A（推荐）：不落库，`name` 只出现在 `project.created` 事件与响应里；列表名继续 `basename(root)`（`protocol.ts:3987`）——零 schema 变更，与现状一致。
  - B：给 `project` 表 + 注册表条目加 `name`（改 `data.md`/contracts/迁移），列表显示用户命名。
- **Q2｜损坏的 `projects.json`/单个坏条目如何处置？**
  - A（推荐）：逐条容错——保留 schema 合法的条目，把坏条目隔离并在 `/projects`/`status` 上报（注册表是可重建的导航索引，需求事实在 Git，符合 `requirements.md:7`）。
  - B：维持 fail-closed（现状），另加恢复命令。A 更符合「一个坏条目不该让整台安装起不来」；若产品认为注册表不可信即拒绝启动，则选 B。
- **Q3｜`project.close` 语义？**
  - A（推荐，贴文档字面「只移出打开导航，有Run继续」）：标 `state=closed` + 从注册表移除（不再出现在切换器），**监听与执行栈保留**，有 Run 继续；再次 `project.open` 幂等恢复。
  - B：无活动 Run 时彻底停监听并清执行栈，有活动 Run 时才保留。B 会改变「有 Run 继续」的可见性（页面上项目还在但导航消失）。
- **Q4｜`project.clone` 的 `grantId` 指什么？**
  - 现状：Grant 是 Work/Run 级、存在项目库里（`store.grants`）；clone 时项目还不存在，**没有任何可校验的 Grant 来源**。
  - A（推荐）：把 `grantId` 解释为「用户显式授权引用」（AuthorizationRef/Decision id），由宿主记录并在 `operation.failed` 里说明来源；同时把「安装级网络操作授权」补进文档。
  - B：新增安装级 Grant 存储（改 data.md/Schema），clone 走与工具同构的 Grant 校验。B 更一致但超出 T5 且要动数据模型。
- **Q5｜要不要加 per-Git-root 锁？**
  - A（推荐）：加在 Git 公共目录（`git rev-parse --git-common-dir`）下的锁文件，第二个安装打开同一根得 `PROJECT_ALREADY_OPEN`；不污染工作树、不写 `~/.agentdev` 之外的用户文件，符合 `reliability.md:61`「daemon 获取每 Project 文件锁」。
  - B：不加，登记为已知限制（仅在文档写明「同一 Git 根只允许一个安装服务」）。A 直接闭合 AC-023 的产品路径证据。
- **Q6｜(c) 下 BFF 自有 `/artifacts/*` 如何带项目上下文？**
  - A（推荐）：在 BFF 自有 URL 里显式带 projectId（`/artifacts/<projectId>/<id>/preview`、`/artifacts/<projectId>/download/<token>`、`/artifacts/<projectId>/upload`），由 BFF 重写为 daemon 的文档路径——无隐藏路由状态，URL 自解释；daemon 契约（`protocol.md:111`）不变。
  - B：用「当前项目」cookie 做隐式路由。B 改动面更小，但路由依赖 cookie，排障与测试更脆。
- **Q7｜「未信任/脏工作区阻断交付」落在哪一层？**
  - A（推荐）：T5 只把阻断接到 `project.initialize` 与 `project.snapshot.get`（可见 blocker + Hash 报告）；真正的 **Run 准入阻断**（AC-028 的「启动交付被阻断」）归 T2/T8 的准入门禁，T5 提供 `trust`/`deliveryReadiness` 两个事实源。
  - B：T5 连准入门禁一起改（跨 `packages/core` 的 Gate/Supervisor 准入路径）。B 让 AC-028 一次闭合，但把 T5 扩到另一条主链。
- **Q8｜`project.initialize` 的 `mode:new/legacy` 是权威还是提示？**
  - A（推荐）：`mode` 是提示，最终以扫描结果为准（空目录/有内容/无 Git 由 `investigateWorkspace` 与 `checkDeliveryReadiness` 判定）；与 `mode` 矛盾时返回 `INVALID_STATE` 并给出实际扫描事实，失败关闭。
  - B：`mode` 权威——`new` 时强制建仓初始化，有内容也照做（`ARCHITECTURE.md:52` 禁止自动清理，风险高）。
- **Q9｜无项目时可归属的事件怎么办？**
  - `project.created` 可发到新项目自己的流；但 `operation.failed`（create/clone 失败）在「项目还没建出来」时没有归属流。
  - A（推荐）：失败只走响应封套（`operation.failed` 仅在有可归属项目时发出，如 clone 到已打开项目的子路径、trust/close/initialize 失败），并在 `docs` 里补一句归属规则。
  - B：新增安装级事件流（改 `data.md`/EventHub 模型）。

---

## 6. 任务分解（6 个子任务，顺序执行；每个可独立 Review）

> 每个子任务的退出条件都要用**当次运行**的真实命令输出支撑；「禁止播种行」在 T5.4/T5.6 是硬约束。

### T5.1 宿主项目目录与生命周期核心（不改 wire 面）
- 内容：新增 `apps/daemon/src/project-directory.ts`，实现 `ProjectDirectoryPort`：`list()` / `resolveTarget(projectId)` / `open(root,{trust})` / `create(root,name)` / `clone(remoteUrl,root,grantId)` / `trust(projectId,trusted)` / `close(projectId)` / `initialize(projectId,input)`；把 `main.ts` 现有 `openImpl`/`openRoot`（`main.ts:319-519`）搬进来，保留 registry 写入（`registerProject`/`unregisterProject`）、`runtime.json` 记录、按 projectId 的串行化（`Map<projectId, Promise>`）与 per-root 锁（按 Q5）。admin `POST /projects` 改为调用目录，保持向后兼容。
- 退出条件：真实 `startRuntime` 在两个临时 Git 仓库上 `open` 两个项目；`create` 在空目录建出 Git + `agentdev/main`；`trust` 翻转 `projects.trust` 行；`close` 标 `closed` 并移出注册表；重复 `open` 幂等；`runtime.json`/`projects.json` 与内存 `instances` 一致。
- 证明测试：`apps/daemon/test/project-lifecycle.integration.test.ts`（新增，真实 SQLite/Git/临时 home）。
- 触及文件：`apps/daemon/src/project-directory.ts`（新）、`apps/daemon/src/main.ts`、必要时 `packages/core/src/runtime.ts`（仅补 per-root 锁辅助，若 Q5 选 A）。

### T5.2 协议面：`project.*` 命令与三类事件
- 内容：`WorkbenchProtocol` 增加 `attachProjectDirectory(port)`（与 `attachOrchestrator` 同构，`protocol.ts:628-635`）；`GLOBAL_METHODS` 收 `project.list/create/clone/trust/close/initialize`；`WRITE_METHODS` 收 `project.create/clone/trust/close/initialize`；`dispatchUnwrapped` 增加对应 case（委托目录端口，返回 `accepted+operationId` 或 `applied`）；在项目自身事件流发 `project.created`，失败发 `operation.failed`（归属见 Q9）；`project.snapshot.get` 补 `initialization`/`deliveryReadiness`/`trust`。
- 退出条件：真 daemon 上 `project.list` 返回安装内全部项目；`project.trust/close` 落库并可读回；`project.create` 后能读到 `project.created` 事件；`project.open` 对未持有 root 仍按文档返回可开户结果而非 `NOT_FOUND`。
- 证明测试：`apps/daemon/test/protocol.integration.test.ts` 扩充（真实 store，不播种 project 行）。
- 触及文件：`apps/daemon/src/protocol.ts`（**与 T3 争用，见 §8**）、`apps/daemon/src/main.ts`（注入一行）。
- 依赖：T5.1。

### T5.3 `project.initialize` 生产接线 + 初始化事件（AC-025/026/027/028/029）
- 内容：新增 `apps/daemon/src/initialize-driver.ts`：`createInitializer({store: createJsonFileInitStateStore(join(dataDir,'initialization.json')), git: createNodeWorktreeGitPort(), documentRoot, branch})`；`mode` 与扫描结果一致性校验（Q8）；`budget{files,bytes}` → `ScanBudget`；串行驱动 `step` 并在每相位发 `initialization.progress`、Ready 发 `initialization.completed`；blocked 原样返回 `dirty-workspace`（逐路径 Hash）/`git-initialization`（授权请求）/设计冲突；`create` 复用同一驱动完成「初始 Git + 交付分支 + 首份候选文档」。
- 退出条件：真实空目录 `create` 后存在初始 commit 与 `agentdev/main`；无 Git 目录 `initialize` 返回 git-init 授权请求，授权后到 Ready；脏工作区返回 Hash 报告且不改任何文件、只读 `investigate` 仍成功；中断写入后 `resume` 按 Hash 跳过已写文件、冲突文件不覆盖；事件顺序与「先落库后发事件」正确。
- 证明测试：`apps/daemon/test/project-initialization.integration.test.ts`（新增，真实 Git/FS，无 Provider）。
- 触及文件：`apps/daemon/src/initialize-driver.ts`（新）、`apps/daemon/src/project-directory.ts`、`apps/daemon/src/protocol.ts`（1 个 case，随 T5.2）。

### T5.4 首次 open 的需求池导入（AC-087/088/089）
- 内容：新增 `apps/daemon/src/requirement-import.ts`：按文档分支选择（优先本地 `agentdev/main`，其次 `origin/agentdev/main`，都无则当前 HEAD；`requirements.md:61`、`ARCHITECTURE.md:52`）读 `.agentdev/requirements` → `parseRequirementPool` → `importRequirementPool` → 逐条 `RequirementProjection.import`（`core/src/requirements.ts:96-220`）并保持 `active → needs_replan`/`waitingToContinue`、`completed/cancelled/archived` 摘要与 `evidenceAvailability`；`project.open`（含 clone/create 后）自动触发一次，不要求 Provider（`protocol.md:150`）；导入摘要进 `project.snapshot.get`。
- 退出条件：仓库 A 用真实保存路径提交 queued/active/completed/cancelled/archived 五种记录后，把仓库 `git clone` 到**第二个 home**、空 SQLite 打开，`requirement.list/get` 能读出五条且 `active` 标待继续、不启动 Run；**测试全程无 `store.requirements.insert`**；缺文件/重复 ID/Hash 不一致逐条冲突且有效条目仍可见。
- 证明测试：`apps/daemon/test/requirement-import.integration.test.ts`（新增，真实 Git clone + 第二 home）。
- 触及文件：`apps/daemon/src/requirement-import.ts`（新）、`apps/daemon/src/project-directory.ts`、`apps/daemon/src/protocol.ts`（snapshot 字段，随 T5.2）。

### T5.5 单入口 BFF：目标路由 + 项目切换器
- 内容：`apps/web/src/app.ts` 的 `WebAppOptions` 增加 `projects: ProjectDirectoryPort` 与「默认目标」；`/rpc` 解析 `envelope.projectId` 选目标（缺失则注入当前页 projectId，D-T5-6），未知项目 `NOT_FOUND`；`/ws?projectId=` 绑定目标；`/artifacts/*` 带项目上下文（Q6-A）；`/projects` 改为列出安装内全部项目（含未打开的可发现条目 + 打开/创建/Clone 入口）并渲染切换器；`sessions.ts` 的 `WebSession` 扩成按目标缓存的 daemon 会话（BFF 用安装凭证静默 `daemonLogin`）；`pages.ts`/`shell.ts` 增加切换控件与状态（活动项目高亮、未打开/未信任/初始化中标签）；`apps/web/public/app.js` 的 `/ws` 带上当前 projectId。
- 退出条件：一个 BFF + 两个真实 daemon，登录一次即可切换；每个页面只显示所选项目数据；把 B 的 projectId 发给指向 A 的 daemon 必失败关闭；`/projects` 列出两个项目且能打开第三个。
- 证明测试：`apps/web/test/multi-project.integration.test.ts`（新增，真实两 daemon + 真 BFF）。
- 触及文件：`apps/web/src/{app,sessions,daemon,pages,shell}.ts`、`apps/web/public/app.js`、`apps/daemon/src/main.ts`（创建单 BFF）、`apps/daemon/src/bootstrap.ts`（`withWeb:false` 路径）。

### T5.6 真实端到端与浏览器证据 + 验收登记
- 内容：`scripts/e2e.mjs` 增加「两项目 + `project.create` + 切换 + 隔离」检查；`tests/browser/` 增加切换规格（登录一次 → `/projects` → 切到 B → 看板/Runs 显示 B 数据且无 A 痕迹 → 切回 A）；把 AC-023/025/026/027/028/029/034/087/088/089 的证据映射从库级/播种测试改到上述真实测试（`scripts/lib/acceptance-registry.mjs`）。
- 退出条件：`pnpm test:e2e`、`pnpm test:browser` 新增检查通过并写入当次运行证据；旧播种证据不再作为这些 AC 的唯一依据。
- 证明测试：`node scripts/e2e.mjs`、`pnpm test:browser`。
- 触及文件：`scripts/e2e.mjs`、`tests/browser/ac-projects-switch.spec.mjs`（新）、`scripts/lib/acceptance-registry.mjs`。
- 依赖：T5.5；`scripts/**` 与 live 演练切片串行（§8）。

---

## 7. 测试策略（最小真实集合；逐条标 AC）

| # | 测试（真实 daemon / SQLite / Git / Chromium） | 证明什么 | 覆盖 AC |
|---|---|---|---|
| 1 | `apps/daemon/test/project-lifecycle.integration.test.ts`（新） | 开户/信任/关闭/幂等 + 注册表与 `runtime.json` 一致 + `create` 建 Git 与交付分支 | AC-023、AC-025 |
| 2 | `apps/daemon/test/project-initialization.integration.test.ts`（新） | `initialize` 全相位、blocked/恢复、Hash 报告、冲突不覆盖、事件顺序 | AC-025、AC-026、AC-027、AC-028、AC-029 |
| 3 | `apps/daemon/test/requirement-import.integration.test.ts`（新） | clone 到第二 home 后需求池可见、active 待继续不启动 Run、逐条冲突 | AC-087、AC-088、AC-089 |
| 4 | `apps/daemon/test/project-isolation.integration.test.ts`（新） | 交叉读全 `NOT_FOUND`、token/cursor 不跨项目、无对方字段 | AC-034（产品路径）、AC-023 |
| 5 | `apps/web/test/multi-project.integration.test.ts`（新） | 单 BFF/单会话切换、目标路由正确、误路由失败关闭、`/projects` 发现未打开项目 | AC-023、AC-034 |
| 6 | `tests/browser/ac-projects-switch.spec.mjs`（新，真 Chromium） | 真实浏览器里登录一次切两项目、页面数据不串、Live 只流当前项目 | AC-023、AC-034、AC-060（订阅不跨项目） |
| 7 | `scripts/e2e.mjs` 新检查 | 无头端到端：`project.create` + 两项目切换 + 隔离 | AC-023、AC-025 |

**明确不得作为证据的既有测试（须在 T5.6 改标）**：`apps/daemon/test/protocol.integration.test.ts:655`（`seedRequirement`）、`apps/web/test/workbench.integration.test.ts`（播种需求/Work/Run）、`tests/browser/stack-runtime.mjs:145-213`（夹具播种）、`scripts/e2e.mjs` 的 `seedWork` 路径、`tests/browser/stack-runtime.mjs` 里的 Requirement 行插入。库级测试（`identity.integration.test.ts`、`initialize.test.ts`、`requirements-pool.test.ts`）保留为单元层证据，但不再单独支撑 AC-023/025–029/087–089。

**AC-082/AC-060 的既有证据不受影响**（各自已有库级+演练证据）；T5 只新增「订阅不跨项目」的补充断言，不替换。

---

## 8. 非目标

- 不做多用户/远程暴露/多安装同步；不引入云端或外部服务。
- 不做 (b) 的「同时观察多个项目」与单 WS 多路复用；不做 (a) 的多 BFF 对外端口。
- 不新增第 11 条 `pnpm` 命令、不新增运行时依赖、不改十条命令名（D4）。
- 不新增/修改 AC 与产品行为，不改 `docs/**`（含 `protocol.md`/`data.md` 的形状）；`initialize` 的语义、`project.close` 语义、`name`/`grantId` 归属先出待决问题（§5.2）。
- 不做 T4/T4b 的需求卡动作与 `requirement.import` 命令本身（T5 只做首次 open 自动导入；显式 import/解除冲突归 T2/T8）。
- 不做 T6 的 backup/restore/relocate 与 launchd/systemd；不做 T9 的其余事件补齐。

---

## 9. 文件冲突与顺序

| 顺序 | 子任务 | 主改动文件 | 冲突/依赖 | 建议 |
|---|---|---|---|---|
| 1 | T5.1 | `apps/daemon/src/project-directory.ts`（新）、`main.ts` | `main.ts` 同时被 T1/T6 触碰过；只做「搬迁 + 注入」小步 | 先做；不与 `protocol.ts` 冲突 |
| 2 | T5.3、T5.4 | `initialize-driver.ts`/`requirement-import.ts`（新）、`bootstrap.ts`、`protocol.ts`（各 1 个 case + snapshot 字段） | `protocol.ts` **由 T3 工具桥切片持有** | 新模块先行；`protocol.ts` 的少量 hunk 与 T3 约定一个落地窗口，或由 T3 先释放后再合 |
| 3 | T5.2 | `protocol.ts`（`GLOBAL_METHODS`/`WRITE_METHODS`/5 个 case/`attachProjectDirectory`）、`main.ts` | 同上：**必须与 T3 串行** | 与 T5.3/T5.4 的 protocol hunk 合并成一次 patch，减少争用 |
| 4 | T5.5 | `apps/web/**`（本切片可自由改）、`main.ts`、`bootstrap.ts` | T4/T4b 在改 `apps/web` 前端与 `pages/views/i18n`；**需与其约定 `pages.ts`/`shell.ts` 的键位与区块** | T5.5 的 BFF 路由（app/daemon/sessions）与 T4 的页面内容尽量分文件改动；切换器作为 shell 顶栏区块独占 |
| 5 | T5.6 | `scripts/e2e.mjs`、`scripts/lib/acceptance-registry.mjs`、`tests/browser/**` | `scripts/**` **由 live 演练切片持有** | 最后做；`tests/browser/**` 新增文件不冲突 |
| — | Settlement | `docs/INDEX.md`、Code Map、`docs/delivery/implementation.md` §T5（补 BFF 偏差与事件归属） | 按 `settlement.md` 在 Test 之后 | 不在本 Plan 的任务内 |

**门禁**：每子任务走 Plan（本文件 + 块内 compact）→ Develop → 独立 Review（新上下文，不读开发聊天）→ 独立 Test → Settlement；Review Blocking 回 Develop；Test 失败或有代码改动回独立 Review 再测。

---

## 15. 主管裁决（对 §5.2 的 Q1–Q9，实施时以本节为准）

- **Q1 `project.create.name`**：持久化到 `~/.agentdev/projects.json` 的注册表条目（与 root/projectId 同级），并让 `project.list` 返回；不新建存储。
- **Q2 注册表损坏容错**：与 secret 仓库同一策略——**逐条容错**：坏条目跳过并在 `project.list`/doctor 中以 typed 状态可见，其余项目照常打开；不得因为一条坏记录让整个安装起不来。
- **Q3 `project.close` 语义**：**导航级关闭**（释放该项目的内存句柄/订阅/工作目录解析并移出活动集），注册表条目保留；若该项目仍有 live Run，则**拒绝**（typed `INVALID_STATE`），不做隐式停进程。停进程是 `agentdev stop`/daemon 生命周期的职责。
- **Q4 `project.clone.grantId`**：clone 属**环境操作**（网络 + 在项目根之外写目录），必须由用户显式动作铸一次**安装级 Grant**并绑定（操作 + 目标路径 + 远端 URL + 输入 Hash）；`grantId` 即该 Grant 的 id（复用 T3 的 Grant 模型，不新造授权存储）。
- **Q5 每 Git-root 锁**：锁文件放 `~/.agentdev/locks/<canonical-root-hash>.lock`（**不往用户仓库里写文件**），覆盖单安装多项目与多进程竞争；「两个不同 home 的安装同时打开同一 root」登记为已知限制。
- **Q6 产物 URL 的项目上下文**：单 origin 下产物 URL **显式带 projectId**（`/artifacts/<projectId>/…`），预览/下载仍必须同时校验会话与该项目的 ACL；不得靠「当前选中项目」这种隐式状态解析。
- **Q7 脏工作区/未信任的准入拦截**：T5 只负责**产出状态与阻断事实**（trusted/initialized/ready、dirty 的 hash 报告、git-init 阻断项）；真正的**准入拦截**留在 Run 门（T2/T8 的 run gate）执行，两边用同一份状态。
- **Q8 初始化模式权威**：模式由 Core 依据 root 真实状态**推导**（空目录 / 目录有内容 / 既有项目），只有文档明确要求用户选择的破坏性或替换性动作才要求显式批准；不新增「模式」这种用户输入。
- **Q9 项目不存在时的事件归属**：不为「还不存在的项目」新造安装级流。项目创建成功后，`project.created` 发到**该项目自己的事件流**；创建/打开失败的 `operation.failed` 走 **admin 面响应/CLI 错误**（带 error code + operationId），不落任何项目流。
- **补充（对 §7 的现状警告）**：AC-023/025–029/034/087–089 当前 PASS 依赖库级测试与播种行，属「未走产品路径」；T5.6 必须用真实 daemon/真实 Git/真实浏览器替换这些证据，替换前不得声称这些 AC 已在产品路径上验证。
