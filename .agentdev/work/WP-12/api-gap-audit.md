# WP-12 文档表面 vs 实现表面 差距审计（api-gap-audit）

版本：1.0（只读审计，2026-09-14）
审计对象：`docs/architecture/protocol.md`（工作树版本，含新增 5 行 `secret.*`）、`docs/architecture/reliability.md`、`docs/product/{experience,requirements}.md`、`docs/delivery/acceptance.md` 与当前代码树。

## 0. 方法、范围与未执行项

**文档侧权威行**：`protocol.md` §2（L25–31）、§3（L37–50）、§4（L56–79）、§5（L89–105）、§6（L117–127）、§7（L133–135）、§8（L141–151）；`reliability.md` L65（CLI 命令契约）；`requirements.md` L57/L81（Git 保存与推送展示）；`experience.md` §4/§5/§6（看板、决定、Live）。

**实现侧取面**：
- `apps/daemon/src/protocol.ts`：`GLOBAL_METHODS` L269–287、`WRITE_METHODS` L290–309、`LEDGER_WRAPPED_METHODS` L327–338、`NON_TRANSACTIONAL_LEDGER_METHODS` L348，分发表 `dispatchUnwrapped` L850–959，WS 方法 L3853–3882。
- `apps/daemon/src/server.ts`：HTTP 路由 L147/154/176/200/207/216/220/226/248/268。
- `apps/daemon/src/main.ts`：回环 admin 面 L505/523/527/574/636/673。
- `apps/daemon/src/control-handler.ts`：`assessmentSubmit`/`agentDispatch`/`stageSubmit` L209–303、`onAttemptResult` L305–325。
- `packages/core/src/control-http.ts`：`CONTROL_PATHS` L114–118（只有 3 条）。
- `apps/web/src/app.ts`：BFF `READ_ONLY` 写门禁名单 L108–137、页面路由 `pageOf` L161–184、`/rpc` L294。
- `apps/cli/src/cli.ts`：命令表 L82–118、`USAGE` L28–45。

**方法**：逐条对照文档行与分发表/处理器；对“缺失”结论另做**整仓搜索**（`grep -rn --include=*.ts --include=*.mjs` 覆盖 `packages/*/src apps/*/src scripts`，并单独确认 `apps/*/test packages/*/test tests scripts` 中是否只有种子/桩），因此下文“absent”= 生产源码无实现，不只是分发表缺 case。

**未执行（诚实声明）**：未运行 `pnpm test:unit`/`test:integration`/`test:e2e`/`test:acceptance`（其他车道正在运行）。只用仓库自带 esbuild（`node_modules/.pnpm/esbuild@0.28.1`）对 6 个关键文件做了语法解析检查，全部通过，**未发现半写文件**；`git status` 显示 30+ 文件处于多车道并行修改中（`protocol.ts` 已从 4483 行变为 4501 行），本文结论以读取时刻的工作树为准。

**计数（本文表格口径）**：文档有/实现完全没有 = **29**；文档名·形状 ≠ 实现 = **13**；实现有/文档无 = **33**（方法 13 + HTTP/CLI 12 + 事件 8）；文档事件从未发出 = **10**。

---

## 1. 总表

状态记号：`缺` = 完全缺失；`形` = 实现于别的名字/形状；`有` = 已实现且名字一致；`多` = 实现有、文档无。

### 1.1 §3 Project 与 Conversation（protocol.md L37–50）

| 文档方法 | 文档行 | 实现状态 | 实现位置 | 依赖 AC | 阻断可用路径？ | 建议切片 |
|---|---|---|---|---|---|---|
| project.list | 39 | 有 | protocol.ts L863 | AC-023 | 否 | — |
| project.open | 40 | 有（仅本 daemon 已持有的 root） | protocol.ts L865/L979–1009 | AC-023/024 | 否（但无法开新项目，见下） | T5 |
| project.create | 41 | **缺** | absent（整仓搜索 0 处；仅 `runtime.open` 在 main.ts L527 的 admin 面） | AC-023/025 | 是：WebUI 无法新建/切换项目 | T5 |
| project.clone | 42 | **缺** | absent；`operation.failed` 因此永不发出 | AC-023 | 是（Clone 导入需求池不可达） | T5 |
| project.trust | 43 | **缺** | absent；trust 只在 `POST /projects`（main.ts L527/L551）开户时定 | AC-053 | 否（可开户时定 trust，但无法事后撤销） | T5 |
| project.close | 44 | **缺** | absent；`instance.close()` 只在 main.ts L295 停机时调用 | AC-023 | 否 | T5 |
| project.initialize | 45 | **缺** | absent；`packages/workspace/src/initialize.ts` 状态机无任何生产调用方（整仓 0 处 import） | AC-025/026/027/029/079 | 是：空项目/旧项目初始化不可达 | T5 + T8（初始化接线） |
| project.snapshot.get | 46 | 有 | protocol.ts L867 | AC-068 | 否 | — |
| conversation.list/create/get | 47–49 | 有 | protocol.ts L869–874 | AC-069/072 | 否 | — |
| conversation.message.send | 50 | 有 | protocol.ts L875/L1617 | AC-084 | 否 | — |

### 1.2 §4 工作、需求与决定（protocol.md L56–79）

| 文档方法 | 文档行 | 实现状态 | 实现位置 | 依赖 AC | 阻断可用路径？ | 建议切片 |
|---|---|---|---|---|---|---|
| command.get | 58 | **缺** | absent；存储层已有 `commands.lookup`（storage/src/commands.ts L134）但无分发 case；客户端与 BFF 却把它列为只读（client/src/commands.ts L45、web/src/app.ts L110） | AC-055 | 否（同键重发已由账本覆盖），但“按幂等键查结果”的文档路径不可用 | T8 |
| work.list/get | 59 | 有 | protocol.ts L885–888 | AC-068 | 否 | — |
| work.pause / work.resume / work.cancel | 60 | **形** | 合并进 `work.control`（protocol.ts L889/L1790–1953，action=`pause/resume/cancel`） | AC-020/021 | 否 | T8（命名对齐或改文档） |
| work.retry | 61 | **缺** | absent；无任何 `work.retry`/重试入口 | AC-017 | 否（返工由 Finding/Chief 链覆盖） | T8 |
| work.budget.update | 62 | **缺** | absent；`store.budgets.update` 只有内核调用（run-lifecycle.ts L88/99/503、gates.ts L694） | AC-022 | 是：用户无法在 BUDGET_EXCEEDED 后加预算 | T8 |
| requirement.list/get | 63 | 有（get 缺正文，见 2.9） | protocol.ts L891–894/L1302–1331 | AC-088/090 | — | T4 |
| requirement.create | 64 | **形** | `requirement.save`（无 requirementId 即新建，protocol.ts L895/L2165–2186） | AC-090/093 | 否 | T2/T8（命名） |
| requirement.update | 65 | **形** | `requirement.save`（带 requirementId，L896/L2166–2248） | AC-090/094 | 否 | T2/T8（命名） |
| requirement.import | 66 | **缺** | absent；仅契约枚举 `requirement_import`（contracts/src/entities/run.ts L245）与表 CHECK（storage/src/schema.ts L397）。冲突检测在 save 内（requirement-save.ts L2290–2302），但**无显式导入/解除冲突入口** | AC-087/092/093 | 是：AC-092“用户修复 Git 后显式导入解除冲突”不可达 | T2/T8（需求池协议面） |
| requirement.start | 67 | **缺** | absent；无“Queued→预分配 workId→Git active→准入 Run”的入口 | AC-005/089 | 是：看板“启动”语义无服务端命令 | T2/T8 |
| requirement.pause / resume / cancel | 68 | **形** | `work.control`（pause/resume 带 workId；cancel 带 requirementId 处理无 Work 的 Queued，protocol.ts L1920–1946/L1963+）；`requirement.resume` 的 needs_replan 分支由 `requirement.continue` 承担（L899/L2306） | AC-020/021/068/089 | 否 | T8（命名） |
| requirement.archive / restore | 69 | **缺** | absent；**但 WebUI 归档按钮真的调用 `requirement.archive`**（apps/web/public/app.js L154），daemon 返回 NOT_FOUND（apps/web/test/workbench.integration.test.ts L2322 把该 NOT_FOUND 写成期望） | AC-021/068/088 | **是：归档按钮是死按钮** | T4（UI）+ T2/T8（命令） |
| decision.submit | 70 | **形** | `decision.resolve`（protocol.ts L944/L2706） | AC-015/016/074 | 否 | T8（命名） |
| permission.request | 71 | **缺** | absent；`decision` 表有 `permission` kind（contracts/enums.ts L54）但无请求入口 | AC-049/050/080 | 是：Run 无法通过协议请求授权 | T3 |
| permission.respond | 72 | **缺** | absent；用户侧改用 `decision.resolve`，但 `permission.resolved` 事件从不发出 | AC-049/050/080 | 否（有替代），事件面缺失 | T3 |
| recovery.inspect | 73 | **缺** | absent；`RunRecoveryService` 只有 `recordResumeDecision`/`resumeParkedRun`（core/src/recovery.ts L379、supervisor.ts L438/456） | AC-057/061/082 | 否（走 work.control resume） | T8 |
| recovery.resolve | 74 | **形（部分）** | `work.control resume`（protocol.ts L1885–1901）+ findings 决策选项 `resume/accept_cancel/abandon`（core/src/findings.ts L2545）；无 `recovery.resolve` 命令、无 `recovery.report_ready` | AC-021/057/061 | 否 | T8 |
| task.list / task.get | 75 | **缺** | absent；客户端列为只读（client/src/commands.ts L54–55），daemon 无 case | AC-081 | 是（且见 §2.8：Task 从不被创建） | T2/T8 |
| run.list / run.get | 76 | 有 | protocol.ts L901–904 | AC-057 | 否 | — |
| run.pause / run.resume / run.cancel | 77 | **缺** | absent；Runs 页按钮实际发 `work.control`（apps/web/public/app.js L1477） | AC-020/021 | 否（Work 级替代） | T8 |
| plan.current / plan.approve | 78–79 | 有 | protocol.ts L938–941/L2354/L2493 | AC-013/014/044 | 否 | — |

### 1.3 §5 知识、文件、产物与配置（protocol.md L89–105）

| 文档方法 | 文档行 | 实现状态 | 实现位置 | 依赖 AC | 阻断可用路径？ | 建议切片 |
|---|---|---|---|---|---|---|
| knowledge.list / knowledge.get | 91–92 | 有 | protocol.ts L878–881 | AC-037/038/041 | 否 | — |
| context.preview | 93 | **缺** | absent；`ContextBuilder` 在 core/src/context，但无预览方法；客户端却列为只读（commands.ts L60） | AC-030/031/032/036/079 | 否（模型侧上下文仍工作），但文档化的预览面不存在 | T8 |
| file.list / file.read | 94 | **缺** | absent；BFF 用自带只读端口顶替（apps/web/src/files.ts L10–13 明确登记为 out-of-slice gap） | AC-077 | 否（WebUI 文件页可用） | T4/T8 |
| artifact.list / artifact.get | 95 | 有 | protocol.ts L906–909 | AC-002/070 | 否 | — |
| artifact.download.prepare | 96 | 有 | protocol.ts L910/L1429 | AC-002/070 | 否 | — |
| config.get | 97 | 有（键名不同，见 1.6） | protocol.ts L919/L1564 | AC-043/044 | 否 | — |
| config.update | 98 | **形** | `config.save`（protocol.ts L921/L2844） | AC-075 | 否 | T8（命名） |
| provider.upsert / provider.test | 99–100 | 有 | protocol.ts L933–936/L3029/L3091 | AC-043/044 | 否 | — |
| secret.set / secret.delete / secret.list | 101–103 | 有 | protocol.ts L926–931/L2936/L2970/L2990 | AC-051 | 否 | — |
| extension.list | 104 | **缺** | absent；`BUILTIN_EXTENSIONS = []`（pi-runtime/src/extensions.ts L46），客户端/BFF 却列为只读（commands.ts L66、app.ts L131） | AC-053/067 | 否（P0 清单为空） | T8 |
| extension.set | 105 | **缺** | absent（整仓 0 处） | AC-067 | 否 | T8 |

### 1.4 §6 Chief 与 Runner 内部方法（protocol.md L117–127）

| 文档方法 | 文档行 | 实现状态 | 实现位置 | 依赖 AC | 阻断可用路径？ | 建议切片 |
|---|---|---|---|---|---|---|
| assessment.submit | 119 | 有 | control-http.ts L317；control-handler.ts L210 | AC-045/047 | 否 | — |
| agent.dispatch | 120 | 有 | control-http.ts L339；control-handler.ts L242 | AC-003/045 | 否 | — |
| agent.request_dispatch | 121 | **缺（协议面）** | Core 有 `orchestrator.requestDispatch`（orchestrator.ts L1080）与 `dispatchRequestSchema`（contracts structures.ts L258），但 control-http 只有 3 条路径（L114–118），无端点 | AC-045 | 否（Chief 可自带 dispatch），但“专业角色请求角色”不可达 | T2/T3 |
| context.request | 122 | **缺（协议面）** | Core 有只读账本 `createReadLedger`（context/ledger.ts L824）但**整仓无生产调用方** | AC-032/085 | 否（但追加读取能力未接线） | T2/T3 |
| runner.ready | 123 | **形** | 走 Runner IPC `attempt.ready`（contracts/src/runner-ipc.ts L38；supervisor.ts L814），非 capability 认证的协议方法 | AC-057/061 | 否 | T8（形状对齐/改文档） |
| runner.heartbeat | 124 | **形** | IPC `attempt.heartbeat`（runner-ipc.ts L50；supervisor.ts L802）；客户端却把 `runner.heartbeat` 列为只读（commands.ts L67） | AC-057 | 否 | T8 |
| tool.execute | 125 | **缺** | absent；`packages/core/src/broker.ts` 只有库，无端点；`apps/daemon/src/server.ts` 无工具路由 | AC-048/049/050/051/080/082 | **是：Runner 无法读写代码/执行命令** | **T3（最高优先）** |
| stage.submit | 126 | 有（Pi 工具名 `stage_yield`） | control-http.ts L359；control-handler.ts L256 | AC-047 | 否 | — |
| runner.stopped | 127 | **形** | IPC `attempt.result`（runner-ipc.ts L66），非协议方法 | AC-057/058 | 否 | T8 |

### 1.5 §7 事件（protocol.md L133/L135）

| 文档事件 | 文档行 | 实现状态 | 实现位置 | 依赖 AC | 阻断可用路径？ | 建议切片 |
|---|---|---|---|---|---|---|
| project.created | 133 | **缺** | absent（整仓 0 处，仅作为字符串出现在错误文案 apps/web/src/daemon.ts L790 的无关处） | AC-023/025 | 否（因 project.create 缺失） | T5 |
| message.received / processed / failed | 133 | 有 | protocol.ts L1676；daemon/src/message-state.ts L52 | AC-069 | 否 | — |
| assessment.saved | 133 | 有 | core/src/orchestrator.ts L525 | AC-045 | 否 | — |
| requirement.changed / saved / save_failed / imported | 133 | 有 | gates.ts L1346、requirement-save.ts L88/L2750、requirements.ts L147/L174 | AC-090/092 | 否 | — |
| work.control_changed | 133 | 有 | findings.ts L1597/1755/1846/1956/2606 | AC-020/021 | 否 | — |
| run.queued / started / ended | 133 | 有 | orchestrator.ts L1055；run-lifecycle.ts L153/291/391 | AC-057 | 否 | — |
| stage.completed / failed | 133 | 有 | stage.ts L208 | AC-047 | 否 | — |
| artifact.created / invalidated | 133 | 有 | artifacts.ts L213/L164 | AC-002/070 | 否 | — |
| decision.created / resolved | 133 | 有 | decisions.ts L327；protocol.ts L2795 | AC-015/016/074 | 否 | — |
| permission.resolved | 133 | **缺** | absent（整仓 0 处） | AC-049/050/080 | 是（权限请求链缺失的一半） | T3 |
| initialization.progress / completed | 133 | **缺** | absent（整仓 0 处） | AC-025/026/029/079 | 是（初始化不可达） | T5/T8 |
| recovery.report_ready | 133 | **缺** | absent（整仓 0 处） | AC-057/061 | 否（resume 旁路可用） | T8 |
| knowledge.updated | 133 | **缺** | absent；结算走投影与 `requirement.changed` | AC-041/085 | 否（投影仍更新） | T8 |
| provider.test_completed | 133 | 有 | protocol.ts L3150 | AC-043/075 | 否 | — |
| operation.failed | 133 | **缺** | absent（整仓 0 处） | AC-023/055 | 否 | T5/T8 |
| chief_action_required | 133 | 有 | orchestrator.ts L1193；join.ts L247 | AC-045/046 | 否 | — |
| token.delta / log.delta / heartbeat（临时流） | 135 | **缺** | absent（整仓 0 处）；daemon 只发 `hello`/`event`/`batch_end`/`response`/`close`（protocol.ts L3737/3759/3340/3772/3945） | AC-071/073 | 否（Live 面板退化为事件列表，无 token/日志流） | T8（或改文档） |

### 1.6 实现有、文档无（`多`）

| 实现项 | 实现位置 | 说明 | 建议 |
|---|---|---|---|
| `projects`（`project.list` 别名） | protocol.ts L862/L271 | 聚合面 | 补文档或删别名 |
| `board` / `inbox` / `agents` / `settings` | protocol.ts L883–918 | 页面聚合查询，`experience.md` 有行为描述但 `protocol.md` 无方法 | 补协议文档 |
| `config.test` | protocol.ts L923/L2889 | 未文档化；T2 亦登记 `provider.test` 的 “accepted 窄读法”待产品确认 | 补文档+待决定 |
| `ui.translate` | protocol.ts L952/L3248 | §5 表无此方法（仅 `experience.md` L65 提两种语言） | 补文档（见 2.10） |
| `backup.run` / `restore.run` | protocol.ts L947–950 | `reliability.md` L65 只有 CLI 面 | 补文档 |
| `finding.submit` | protocol.ts L942/L2649 | §4 表无 finding 方法 | 补文档 |
| `work.control` / `requirement.save` / `requirement.continue` | protocol.ts L889/895/899 | 真实方法名，与文档的细粒度命令不一致 | 决定哪边权威 |
| HTTP `POST /conversation.message.send`（legacy） | server.ts L268 | 与 `/rpc` 并存 | 决定保留与否 |
| HTTP `POST /artifacts/download.prepare` | server.ts L248 | 方法已文档化，路由为额外通道 | 补文档 |
| admin `GET /health`、`GET /projects`、`POST /projects`、`POST /secret`、`DELETE /secret`、`POST /stop` | main.ts L505/523/527/574/636/673 | CLI `open/status/stop/secret` 使用；`protocol.md` 无此面 | 在 reliability/installation 补文档 |
| BFF `POST /api/auth/login`、`POST /api/auth/logout`、`GET /api/session` | apps/web/src/app.ts L252/261/275 | 浏览器兼容别名 | 补文档 |
| CLI `agentdev secret rotate <ref>` | cli.ts L40；secret.ts L189 | `reliability.md` L65 只列 set/list/delete | 补文档 |
| 事件 `conversation.created` | protocol.ts L1064 | §7 未列 | 补文档 |
| 事件 `finding.created/addressed/verified/accepted_risk` | findings.ts L707/843/1004/1051 | §7 未列 | 补文档 |
| 事件 `delivery.write_admitted/work_completed/level_upgraded` | gates.ts L935/1091、findings.ts L1369 | §7 未列 | 补文档 |

---

## 2. 逐区证据与判定

### 2.1 可用路径判定（用户配置 Provider → 发消息 → 真正干活）

- 配置 Provider：**通**。设置页发 `provider.upsert`（public/app.js L796，附带 `secret`），`provider.test` 发事件（protocol.ts L3091/L3150），`secret.*` 已实现且按安装级 ACL（L2937/2974/2991 调 `requireInstallationCaller`）。
- 发消息 → Chief：**通**。`conversation.message.send` 在同一事务里入队 Chief Run（protocol.ts L1690/L1718），消息状态 `received→processing→processed/failed` 由 supervisor 回调驱动（main.ts L395–397；message-state.ts L52）。
- 真正干活：**断**。`tool.execute` 无端点，`BUILTIN_TOOLS` 为空数组（apps/runner/src/cli.ts L115，L161 注册为空），`broker.ts` 只有库。专业 Run 拿到 `stage_yield` 控制工具却不能读文件、编辑或执行命令。这是唯一“产品核心承诺直接不成立”的缺口，归 **T3**。

### 2.2 Task 实体从不被创建（整仓结论）

生产源码里**没有任何 `tasks.insert`**（`grep -rn "tasks\.insert" --include=*.ts --include=*.mjs .` → 命中 `scripts/e2e.mjs:1360`、`scripts/lib/live-drills.mjs:417/866`、以及 5 个测试文件；`packages/*/src`、`apps/*/src` 命中 0）。

- `plan.approve` 只把 PlanDraft 的 tasks 在内存里取第一条派 Run（protocol.ts L2587–2640），**不落 Task 行**；`tasks` 表只有读路径（protocol.ts L1285、L1371、L3485；findings.ts L631/1665/2441/2450；events-hub.ts L435/446）。
- 后果：`task.list/get` 永远返回空/不存在；看板卡片“已完成/总 Task 数”恒为 0（`emptyTaskCounts`，protocol.ts L1233）；AC-081 的“Task 与 Manifest 有准确 `dependencyRevision`/`dependencyManifestRefs`”没有 Task 载体，只能靠演练手写行（e2e.mjs L1360 正是手动 seed）。
- 归 **T2（Plan→Run 主链落 Task）/T8**。是否要让 Plan 的 task 落库是**产品/契约决定**（`data.md` 有 `task` 表，`plan.approve` 文档不承诺建 Task），本文不代决。

### 2.3 需求池（requirement.*）细节

- `requirement.get`（protocol.ts L1315–1331）返回投影行 `...row` + `work`/`saveState`/`waitingToContinue`/`continuationCandidates`，**不含 `contentMarkdown`**；但 `protocol.md` §8 L149 明确 “get返回完整contentMarkdown，list返回元数据及portableRef，不携带长正文”。`contentMarkdown` 在 daemon 只出现在读记录内部（L2094/L2103）与保存入参（L2177/L2233）。WebUI 详情页正是从 `requirement.get` 取正文（views.ts L662、pages.ts L611–613），因此**需求正文区永远为空**。归 **T4（含 daemon 读面）**。
- `requirement.archive` 被 UI 调用（app.js L154）而 daemon 无 case；`dispatchUnwrapped` 默认抛 `NOT_FOUND`（protocol.ts L954–957）。T4 集成测试把这一 NOT_FOUND 写成期望（workbench.integration.test.ts L2316–2326），说明是**已知但未收口的死按钮**。归 **T4+T2/T8**。
- `requirement.save` 覆盖 create/update（含 `patch.lifecycle`，L2199），但**没有 completion 写入路径**：`patch` 不接受 `completion`/`previousLifecycle`，因此看板“完成”按钮提交 `requirement.save {lifecycle:'completed'}` 被 `VALIDATION_ERROR` 拒绝（测试 L2334–2343 同样把它写成期望）。归 **T2/T8**（或产品决定“完成只能由结算产生”）。
- `requirement.import`：冲突检测/拒绝码在 save 内已实现（requirement-save.ts L399 code 集含 `REQUIREMENT_CONFLICT`、L2290–2302），但**显式导入 / 解除冲突 / 按 revision 重建投影**的入口不存在；`gitRoot` 首次 open 自动导入（§8 L141）也未接线（main.ts `openRoot` L341–359 无导入）。AC-092 的可修复性因此不成立。归 **T2/T8**。

### 2.4 看板/需求读面缺 Git 字段（AC-090）

- 文档侧：`requirements.md` L57「显示保存所在分支/提交和未推送提示」、`reliability.md` L87「UI 显示记录所在 branch/revision 及与 remote 的同步状态」、AC-090 L557「界面展示分支、提交与未推送状态」。
- 实现侧：`board` 卡片（protocol.ts L1208–1239）与 `requirement.get`（L1322–1330）**都不返回 `git`**；`git:{branch,commit,unpushed,...}` 只出现在 `requirement.save` 的结果里（protocol.ts L2280；core/src/requirement-save.ts L1104–1116、L1737）。
- WebUI 已在 `views.ts` L135–142/L647 明确“读面没有 `git.unpushed` 就渲染未上报”，`pages.ts` L305/L566 输出 `data-git-unpushed="unreported"`。T4 报告 §8.1 已把它登记为需 daemon 切片。
- 结论：**尚未满足 AC-090 的界面子句**（分支/提交可由 `portableRef.revision` 近似，未推送状态无数据源）。归 **T4 + daemon 读面小切片**。

### 2.5 `ui.translate` 目录覆盖（AC-073）

- 文档侧：`protocol.md` §5 **没有** `ui.translate`；`experience.md` L65 只固定 en/简体两种界面语言且不翻译项目内容。
- 实现侧：daemon 目录 `UI_STRINGS`（protocol.ts L369–423）共 **29** 键；WebUI 字典（`apps/web/src/i18n.ts` L34+）共 **259** 键，WebUI 正文实际调用 `t('...')` 的**去重键 154 个**，其中 **144 个**不在 daemon 目录里（对比命令：`comm -23 <(UI 用键) <(daemon 目录键)`）。
- 客户端已用内嵌字典回退并“字典优先”（public/app.js L270–274），所以**功能不阻断**，但每次切语言会对 144 个键发 `ui.translate`，逐个得 `NOT_FOUND`（protocol.ts L3265–3268），产生噪声与日志。
- 归 **T2 释放 `protocol.ts` 后的小切片**（WP-12 plan D7），或产品明确“界面字典由 UI 自持”。

### 2.6 内部方法的形状差异（§6 vs Runner IPC）

- `runner.ready/heartbeat/stopped` 在实现中是父子进程 IPC 消息 `attempt.ready` / `attempt.heartbeat` / `attempt.result`（contracts/src/runner-ipc.ts L38/50/66；supervisor.ts L802/814），**不是** §6 要求的 attempt-capability 协议方法；`control-http.ts` 只暴露 `assessment.submit`/`agent.dispatch`/`stage.submit`（L114–118）。
- 但客户端只读名单里却写了 `runner.heartbeat`（client/src/commands.ts L67）——即“文档名存在、实现名不同、客户端按文档名列名单”的三方不一致。
- 判定：不是缺失，而是**形状漂移**；要么把 IPC 通道写进文档，要么补 capability 协议面。归 **T8**（属产品/架构决定，本文不代决）。

### 2.7 HTTP 面覆盖（§5 散文 + admin）

- 已实现且与文档一致：`GET /healthz`（server.ts L147，只回 version/ready）、`POST /rpc`（L154）、`POST /auth/login`（L176，含 429 限流）、`POST /auth/logout`（L200）、`GET /artifacts/download/:token`（L207，先于鉴权）、`POST /artifacts/upload`（L216）、`DELETE /artifacts/uploads/:id`（L220）、`GET /artifacts/:id/preview`（L226）、`POST /artifacts/download.prepare`（L248）。
- admin 面（`agentdev open/status/stop/secret` 用）：`GET /health`、`GET /projects`、`POST /projects`、`POST /secret`、`DELETE /secret`、`POST /stop`（main.ts L505/523/527/574/636/673）——**文档无此面**（`reliability.md` 只写 CLI 命令）。
- BFF 自身路由：`/healthz`、`/auth/login|/api/auth/login`、`/auth/logout|/api/auth/logout`、`/assets/*`、`/api/session`、`/rpc`（app.ts L247/252/261/270/275/294）。注意 **BFF 的 `READ_ONLY` 不是白名单拦截**：它只决定是否要求精确 Origin（app.ts L398），未知方法一律当写处理并转发，因此 **BFF 不会拦截** `task.list`/`extension.list`/`command.get`，是 daemon 才返回 NOT_FOUND。

### 2.8 角色画像与“独立审核模型”（AC-043/044）

- 文档侧：`agents.md` L16/L61/L63 要求角色 Provider/Model/Reasoning 独立可配；AC-043 要求“角色配置不同 Provider”。
- 实现侧：配置面**存在**——`config.get` 返回 `defaultProfile` + `roleProfiles`（protocol.ts L1582–1583，键名与文档 §5 的 `profiles` 不同），`config.update`→`config.save` 支持 `roleOverrides`（core/src/config.ts L283–294，patch 键与 §5 L107 一致）。
- 判定：能力已有，**发布态未配置独立 Review/Test 模型**；AC-043 在最近一次验收聚合中为 UNVERIFIED（`.agentdev/work/WP-12/acceptance-results.json` 第 42 项），WP-10 已登记为 accepted risk。这是**待用户/产品决定**，不是代码缺口。归 **T1/T2 配置面 或 产品决定**。

---

## 3. 先修哪些才能算功能完备（有序）

1. **T3 Runner 工具桥（`tool.execute` + `permission.request/respond` + `BUILTIN_TOOLS`）**——唯一让“真实干活”成立的一环：当前专业 Run 无任何读/写/bash 工具，AC-048/049/050/051/080/082 都只能靠库级测试。先做它，否则其它补全都无法端到端被验证。
2. **需求池协议面**：`requirement.archive/restore/import/start`，create/update 的正式命名（或改文档），以及 `complete` 的完成写入路径。理由：看板六个动作里 `archive`（现在被 UI 真实调用）是死按钮，`complete` 缺 completion 写入被 `VALIDATION_ERROR` 拒绝，导入/解除冲突（AC-092）无入口——都是用户点和就报错的路径。归 **T2 + T4**。
3. **`requirement.get` 补 `contentMarkdown`**（§8 L149）+ 看板/详情读面补 `git.{branch,commit,unpushed}`。理由：需求详情正文区内空、AC-090 未推送子句无数据源；两处都是 WebUI 直接可见的空白/缺失。归 **T4（含 daemon 读面小切片）**。
4. **Task 实体物化**：`plan.approve`/Chief 派发时把 Plan 的 tasks 落 `task` 表。理由：`task.list/get`、看板 Task 比例、AC-081 的 Task 级依赖血缘全部悬空，目前仅演练脚本手写 seed。归 **T2/T8**（“是否落库”需产品确认）。
5. **单入口多项目 + 初始化**：`project.create/clone/trust/close` 与 `project.initialize`（含 `initialization.progress/completed`）。理由：AC-023 的“open 并切换”、AC-025–029 的空/旧项目初始化在应用内完全不可达；`packages/workspace/src/initialize.ts` 无生产调用方。归 **T5 + T8**。
6. **§6 残余内部方法与事件**：`agent.request_dispatch`、`context.request`（Core 已有实现，缺端点/接线）与 `runner.*` 形状对齐。理由：AC-032/045 的可达性依赖它们。归 **T2/T3/T8**。
7. **控制类命令补齐**：`work.retry`、`work.budget.update`、`run.pause/resume/cancel`、`recovery.inspect`。理由：AC-017/022/020/021 的用户操作在协议面缺失（预算无法追加会直接卡住长任务）。归 **T8**。
8. **读面补齐**：`context.preview`、`file.list/file.read`（daemon 版）、`command.get`。理由：AC-077/030–036 目前靠 BFF 旁路与库级测试；`command.get` 是 §1 明文要求的恢复查询。归 **T4/T8**。
9. **外围**：`extension.list/set`（P0 清单为空，纯文档对齐）、`ui.translate` 目录补键、§7 事件与实际发出的 8 个额外事件对齐。归 **T8 / 文档切片**。

**属于“产品文档不一致、不代决”的项（原文记录，等待决定）**：
- §7 列出的 `project.created`/`operation.failed`/`permission.resolved`/`initialization.progress|completed`/`knowledge.updated`/`recovery.report_ready`/`token.delta`/`log.delta`/`heartbeat` 与实际事件集不一致——是补实现还是裁文档？
- `work.control`/`requirement.save`/`requirement.continue` 与文档细粒度方法名的漂移由哪边权威。
- `requirement.complete` 是否该存在（T4 报告 §8.2 明确“`protocol.md` §4 无 `requirement.complete`，`patch` 也不接受 `completion`”）。
- Plan 的 tasks 是否必须落 `task` 表（影响 Task 实体与 AC-081 口径）。
- `provider.test` “先答 accepted、后台出事件”的窄读法（T2 报告 §10.2）。
- AC-043 独立 Review/Test 模型是否作为发布必验（现为 accepted risk）。
- `ui.translate` 是否应承载完整界面字典，或明确“UI 自持字典”。
- `agentdev secret rotate` 是否补进 `reliability.md` §65 命令契约。

---

## 附录 A：审计用到的只读命令（可复跑）

```bash
# 分发表
grep -n "case '" apps/daemon/src/protocol.ts
# 事件是否被发出（生产源码）
grep -rn --include=*.ts --include=*.mjs "'permission.resolved'" packages/*/src apps/*/src scripts
# Task 是否有生产写入方
grep -rn "tasks\.insert" --include=*.ts --include=*.mjs . | grep -v node_modules
# ui.translate 覆盖
grep -ohE "t\('[a-zA-Z0-9_.:-]+'\)" apps/web/src/*.ts | sed "s/t('//;s/')//" | sort -u | wc -l
# 语法检查（无半写文件）
node_modules/.pnpm/esbuild@0.28.1/node_modules/esbuild/bin/esbuild apps/daemon/src/protocol.ts --outfile=/dev/null
```
