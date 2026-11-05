# WP-12 宿主优先执行模型：实现记录

- 状态：**实现完成，全门禁绿（acceptance 94/94 PASS 94 / ACCEPTED 0 / FAIL 0 / MISSING 0，exit 0）**
- 依据：`.agentdev/work/WP-12/docs-simplification.md`（§3 AC 解释清单为产品负责人批准的方向）+ 修订后的 `docs/architecture/execution.md`、`docs/rules/agents.md`、`docs/rules/workflow.md`、`docs/architecture/{protocol,reliability}.md`
- 基线：`9c10d93`，未提交（本记录只加文件，不 `git commit`）

## 1. 新的默认路径（一句话）

**所有角色、所有 permissionMode 默认在宿主执行**：工具直接跑在用户仓库（按 Task 分离时是该 Task 自己的 Git worktree），`read/search/edit/write/bash/git`、构建、测试、依赖安装与公网/本地网络全部可用；容器只是**可选的按项目运行环境**，只能由栈的显式 `mode: 'container'` 选择，绝不作为每次工具调用的要求。

## 2. 逐 gap 改了什么

### Gap 1 — 默认执行底座切到宿主（`main.ts` / `tool-handler.ts`）

- `tool-handler.ts` `executionModeForPermissionMode()`：三种 permissionMode 一律返回 `'host'`（返回值类型收窄为 `'host'`），并说明"没有任何 permissionMode 选择容器"。
- `tool-handler.ts` 删除 Review/Test 的容器硬钉（旧 `callIsReadOnly(role) ? 'container' : policyMode`）：`const callMode = policyMode`。独立性改由独立 Run/Session/冻结输入/工具集 + 路径边界保证（`agents.md` §1）。
- `main.ts`：注释与装配改为"host 是文档默认；要容器就显式传 `mode:'container'`"；并把同一个 `toolMode` 也传给 Broker（`broker: { mode: toolMode, ... }`），使工具桥与 Core 侧声明式 Test 命令用同一个底座。
- 容器路径仍可用：`ToolHandlerOptions.mode`、`ProjectExecutionOptions.broker.mode`、`ToolInvocation.mode` 三个显式入口保留，`broker.integration.test.ts` / `tool-http.integration.test.ts` / `apps/cli/test/container.integration.test.ts` 继续在真实 Docker 上验证它。

### Gap 2 — 声明式 Test 命令与"缺 Docker 即拒绝"（`broker.ts` / `execution.ts`）

- `Broker.runDeclaredTestCommand()`：模式由 `input.mode ?? this.defaultMode` 决定（默认 `'host'`），**不再固定 `'container'`**；只在显式 `mode==='container'` 时探测 Docker，缺 Docker 才 `PROVIDER_UNAVAILABLE`（明确"显式容器模式不回退宿主"）。成功后返回真实 `mode`；`test.command_executed` 审计新增 `mode`（`data.md` §3 `Env`：命令真正运行的环境）。
- `execution.ts` `executeTestEvidence()`：把栈的模式传给 `runDeclaredTestCommand`，命令在冻结工作目录（`cwd = roots[0]`）的宿主进程组里逐条执行；`executionImage` 只在容器模式写入，`result` 事实行改为 `mode=host|container`（宿主不再出现误导性的 `image=`）。
- `broker.invoke` 第 5 步的容器分支注释明确：这条分支只服务**显式容器调用**；缺 Docker 不阻断任何默认路径。

### Gap 3 — 出口 sidecar 降级为可选容器环境（`egress*.ts`）

- `apps/daemon/src/egress.ts`：`EgressService` 头部文档改写为"属于可选容器运行环境"；`ensure()` 成为**唯一**入口——首次真正需要容器环境时才绑定 Core 代理、再起 sidecar（`main.ts` 删除了启动时的 `await egress.start()`）。默认宿主路径不打开任何监听、不创建任何容器。
- 保留：`packages/core/src/egress.ts` 的 `NetworkPolicy`/`createEgressPolicy`（准入层守卫，宿主路径同样使用）、`EgressProxy`、`EGRESS_SIDECAR_SOURCE`、`egress-channel.ts` 全部原样，容器环境启用时可用；`apps/daemon/src/main.ts` 仍把 `egress` 交给 Broker，只是不再默认启动。
- 硬拒清单未变：`NetworkPolicy` 只拒两项（守护实际绑定端口、云元数据地址，含 IPv4-mapped/NAT64 拼写），公网/`127.0.0.1:3000`/内网私服默认通；admission 层对 `bash` 字面 URL 的判定保留，拒绝与放行都写审计（`tool.refused`/`tool.invoked`）。

### Gap 4 — doctor 把 Docker 当可选能力（`apps/cli/src/doctor.ts`）

- `buildDoctorReport()` 删除两条 Docker blocker（daemon 不可达 / image 缺失），只保留真实阻塞项（node/pnpm/git/Pi SDK、目录可写、凭证 0600）。
- `renderDoctorReport()` 把 docker 行渲染为 `info`（不是 `FAIL`），非 `ok` 时附"optional: the host coding path needs no container"；`executionReady` 文档改为"Attempt 真正需要的能力（Docker 不在其中）"。

### Gap 5 — 审批面收窄到不可逆操作 + 信封授予 shell/network/secret

- `packages/domain/src/routing.ts`：`ENVIRONMENT_OPERATIONS` 收窄为 `['push','deploy','delete_data']`；新增 `ENVELOPE_OPERATIONS = ['bash','network','secret']`（保证"12 个 operation 恰好分类一次"的域测试仍成立）；`touchesRunningEnvironment` 只对不可逆项与显式 `networkTargets` 为真。
- `packages/core/src/permissions.ts`：`PERMISSION_OPERATIONS` = 不可逆三项；新增 `RUN_ENVELOPE_OPERATIONS = ['bash','git','network','secret']`；`ensureRunGrants()` 从"Work 自己的 scope ∪ 未撤销 authorization"取信封，除文件操作外还铸造 `bash/git`（targets = 授权路径）与 `network/secret` 这些**信封内直接执行**的 run Grant。
- `packages/core/src/orchestrator.ts`：`ENVIRONMENT_OPERATIONS` 收窄为不可逆三项；`DERIVABLE_OPERATIONS` 与 `operationsForPaths()` 让"路径 → 编码信封"包含 `git/bash/network/secret`，因此消息授权的 Work 也能铸造 shell Grant（这正是宿主编码路径此前仍被逐次审批挡住的地方）。
- `packages/core/src/messages.ts`（**相邻必要改动，见 §5**）：`grantedByMessage()` 的信封与 derived 信封对齐（read/search/edit/write/git/bash/network/secret/artifact_write）；`assertGrantWithinMessage()` 只拒"信外路径 / 不可逆操作 / networkTargets"，不再把 `bash/network/secret` 当越权。
- `permission.request`/`permission.respond`/`once`+`inputHash` **保留**（未新增/删除协议方法），但拒绝现在携带 `approvable:false`（`requiresPerOccurrenceApproval` 只对不可逆项为真），Runner 不再为信封内操作开审批；正常编码路径不再出现 `waiting_permission`。

### Gap 6 — 测试按新证据形状重指（未删任何守卫证明）

| 文件 | 旧断言 | 新证据 |
|---|---|---|
| `apps/daemon/test/tool-handler.integration.test.ts` | workspace/autonomous→container | 三种模式→host；并把"Review 钉容器"改写为"Review 在宿主运行 + 工具集拒绝 write"（AC-050） |
| `packages/core/test/tool-http.integration.test.ts` | 真实容器跑 `mode:'container'` 的审批链 | 真实容器路径保留；新增"信封内 bash 无审批直接执行、无新 permission Decision、Run 不 park、同 operation 不同 hash 仍 `IDEMPOTENCY_CONFLICT`"（AC-049/AC-080） |
| `apps/daemon/test/tool-permission-runner.integration.test.ts` | 真 Runner 被拒→记录→批准→重试执行 | 真 Runner 的 bash 由 run-scope shell Grant **无提示**执行、无 permission Decision、`tool_end` 照常；同 operation 不同参数仍 `IDEMPOTENCY_CONFLICT`（AC-049/AC-080） |
| `packages/core/test/broker.integration.test.ts` | 声明命令固定容器 | 默认宿主执行（`mode='host'`、审计含 `mode:'host'`）；显式 `mode:'container'` 单独一条真实 Docker 用例 |
| `apps/cli/test/container.integration.test.ts` | 缺 Docker 直接失败 | `describe.skipIf(!imagePresent)`：可选容器环境缺失即跳过；镜像加固负例全部保留 |
| `apps/cli/test/doctor.integration.test.ts` | 缺镜像→`executionReady:false` | 缺镜像/能力不符只报告（`docker.status != 'ok'`、`detail` 保留），`executionReady` 仍为 `true`；真实 blocker（目录不可写、凭证可读）负例保留 |
| `packages/core/test/{broker,permissions-failures}.test.ts` | 无 Docker 即拒绝（旧模型注释） | 用例保留为"**显式容器模式**缺 Docker 拒绝、不回退宿主"的证据 |
| `packages/core/test/{orchestrator,permissions-bridge,artifacts}.test.ts`、`packages/domain/test/domain.test.ts`、`apps/daemon/test/assessment-dispatch.integration.test.ts` | 派生信封只含文件操作 | 信封含编码执行面但不含不可逆项；域分类测试加 `ENVELOPE_OPERATIONS` |

**仍然被证明的守卫（回归即失败）**：项目根/信外路径越权写入、凭据形态文件读取/搜索/写、工作区外删除、`git push`/ref 变更、未审阅交付、两固定网络拒绝项、超预算、read ledger；可写路径负例与"只读角色不可写"仍由工具集与路径边界覆盖。

## 3. 保留未动的部分

Task worktree/单写者租约、交付 CAS（`refs/heads/agentdev/main` 只由 Workspace 服务 CAS）、读账本与 Snapshot、预算与公平调度、按角色工具集、全部审计事件名与字段、凭据形态文件冻结表与 `configPolicy: strict|test`、不可逆操作的 `once`+`inputHash` 绑定、可选容器环境（含 egress）。`docs/**`、`docs/delivery/**`、`docs/product/**`、`apps/web/**`、`packages/workspace/**`、`scripts/lib/drill-acs.mjs` 未改。

## 4. 真实命令输出（最终代码树）

| 门禁 | 命令 | 结果 |
|---|---|---|
| 类型 | `pnpm typecheck` | exit 0（无输出） |
| 风格 | `pnpm lint` | exit 0（eslint + prettier "All matched files use Prettier code style!"） |
| 单测 | `pnpm test:unit` | exit 0：`Test Files 79 passed (79)` / `Tests 1481 passed (1481)` |
| 集成 | `pnpm test:integration` | exit 0：`Test Files 57 passed (57)` / `Tests 543 passed (543)`（212s） |
| e2e | `pnpm test:e2e` | exit 0：`27 checks — PASS 26 / FAIL 0 / UNVERIFIED 1`（UNVERIFIED = AC-001 真实 Provider 半边，由 live 关闭）；`31 ACs accounted for by the drill` |
| live（真 Provider） | `node scripts/live.mjs --no-write` ×3（最终树） | 三次均 exit 0：`live: 7 passed / 0 failed / 0 unverified; 13 call(s), HTTP 200×13`，用时 41.3s / 38.9s / 36.9s。每次 7 条链：`provider.connectivity`、`drill.html-explanation`(AC-001)、`drill.l1-typo`(AC-007)、`drill.l2-delivery`(AC-010/037/041/043)、`drill.runtime-attempt`(AC-057)、`drill.message-to-stage`(AC-003/005/069)、`drill.session-streaming`(AC-066) 全 PASS。`drill.message-to-stage` 的 Test 证据为宿主真实执行：`"environmentRef":"host:darwin/arm64/node-24"`、声明命令 exit 0、`mode host`、`outputRef` 指向真实 artifact |
| 验收 | `node scripts/acceptance.mjs`（带真实 Provider，脚本自跑 e2e+live） | exit 0：`acceptance: pnpm test:e2e exit=0` / `pnpm test:live exit=0` / `acceptance: 94/94 ACs accounted — PASS 94 / ACCEPTED 0 / FAIL 0 / MISSING 0` / `evidence levels — product-path 53 / library-level 41 / environment-limited 0` / `acceptance: OK` |

一次真实 Provider 抖动（非代码）：`live` 第 2 次 `drill.l1-typo` 报 `PROVIDER_UNAVAILABLE ... read ETIMEDOUT`（HTTP 0，6 call 中第 6 个），随后重跑三次全绿；`live-2` 报告与本记录一并留档说明。

## 5. AC 证据形状的说明（按 §3 批准的解释清单）

- **AC-048**：`acceptance.md` 文字未改。无 Docker **不**构成拒绝——doctor 现在只报告；边界证据仍是类型化拒绝（信外路径/敏感文件/工作区外删除/Git ref）+ 只读角色不可写。
- **AC-049 / AC-080**："范围内继续"由信封 run Grant 直接执行证明；"超范围权限决定"改为"超范围被拒/不可逆操作才产生批准"。`once`+`inputHash` 绑定与原子消费机制保留，协议层 `permission.request`/`respond` 用例（`tool-permission.integration.test.ts`）继续证明它；端点/真 Runner 用例改为证明"信封内无提示执行 + 同 operation 不同 hash 仍冲突"。
- **AC-050**：独立性按独立 Run/Session/输入/工具集 + 路径边界解释；用例改为"缺 Docker 时 Review 读仍在宿主执行，且 Review 工具集拒绝 write"。
- **AC-033 / AC-034**：本切片未改其证据（ACL/上下文负例），无需重述。
- `scripts/lib/drill-acs.mjs` 未改（append-only 要求）；`docs/delivery/acceptance.md` 未编辑（`git status` 无该文件）。

## 6. 越出文件清单的两处改动（如实登记）

1. `packages/core/src/messages.ts`：消息授权的信封原来只含 `read/edit`，而 derived 信封含完整编码执行面；不改它，**所有"消息里点名了文件"的 Work（最常见路径）仍拿不到 bash**，宿主优先的编码路径等于没通。这是 gap 5 的必要相邻面。
2. `scripts/lib/live-drills.mjs`（1 处断言）：`result.includes('image=')` → `result.includes('mode=') && result.includes('runner=')`，与 `data.md` §3 `Env` 的修订一致（宿主运行不再有镜像事实，环境由 runner 描述串 + mode 表达）。

## 7. 遗留 / 残余（不阻碍本切片）

- `permission.request`/`respond` 在协议层仍可对任意 operation 记录决定（方法按文档"保留"）；模型侧正常路径不再到达它。今日 Broker 没有 `push/deploy/delete_data` 工具，因此"不可逆操作审批 UI"保留但没有活的不可逆动作可演练；交付分支推送仍由 Workspace 服务 CAS 完成。
- 信封铸造的 `secret` Grant 无 targets（Scope 没有 secret refs 字段），所以不会凭空注入凭据；要注入具名 ref 仍走一次显式授权绑定。
- 容器的"按项目选择"目前是**显式栈模式**（`createToolHandler({mode:'container'})` / `ProjectExecutionOptions.broker.mode`），没有新增用户可见的项目配置字段——`protocol.md` §1 的 `ConfigPatch` 是固定集合，简化决定也要求不新增必填配置。
- 宿主网络守卫是准入层"识别与审计"，裸 socket 可绕过；该残余风险按 `execution.md` 附录 A.5 如实登记，未在本切片解决。
- 未做（也不在本切片）：`git` 工具在信封内的端到端启用（`git` 现在会被铸造 run Grant，但没有专门的 drill 覆盖它）、`TaskEnvironmentManager` 在新默认下的端到端演练。
