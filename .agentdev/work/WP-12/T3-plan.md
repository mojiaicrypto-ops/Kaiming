# WP-12 T3 实施计划：Runner 工具桥（Broker + Grants + permission + 路径/网络/进程策略 + 审计）

- 状态：Planning（待用户对 §9 待决问题表态后开工）
- 上级依据：`.agentdev/work/WP-12/plan.md` §4 T3 行、§2 DoD 第 4 条、§3 D3/D4/D5；`.agentdev/work/WP-12/api-gap-audit.md` §1.4/§2.1/§3-1；`.agentdev/work/WP-12/T2-review-security.md` G1.2 前置条件。
- 正式契约：`docs/architecture/execution.md`（全文：§1 环境、§2 拓扑与 Secret、§3 挂载/角色 ACL、§4 网络与操作授权、§5 真实验证、§7 Pi 与扩展契约）；`docs/architecture/protocol.md` §1/§4/§5/§6/§7；`docs/architecture/reliability.md` §1/§2/§3/§6/§7；`docs/architecture/data.md` §1 行 36/41；`docs/rules/workflow.md` §2–§7；`docs/rules/agents.md` §1/§3/§4/§5/§6；`docs/delivery/acceptance.md` AC-004/011/013/033/048/049/050/051/080/081/082/085；`docs/delivery/implementation.md` §3。
- 约束：不改本文件以外的任何文件；不新增运行时依赖；`pnpm` 十条契约命令名不变；不用播种行测试充当证明；产品行为冲突只登记待决问题，不自行裁定。
- 未执行声明：本计划为只读产物，**未运行**任何测试套件（其它车道在跑）；全部结论来自读源码 + 只读命令 + 一次只读的 Docker 探测（见 F14）。

---

## 1. 现状证据（逐条核对；与任务书不一致处已修正）

### 1.1 任务书给定事实的核对

| # | 事实 | 判定 | 证据（file:line） |
|---|---|---|---|
| F1 | `tool.execute` 文档化但无端点；`BUILTIN_TOOLS = []`，模型会话无任何工具 | **成立** | `docs/architecture/protocol.md:125`；`apps/runner/src/cli.ts:115`、`:161`；`grep -rn "tool\.execute" apps packages` 生产源码 0 处 |
| F2 | `packages/core/src/broker.ts` 已有策略原语但无运行期接线 | **成立** | 策略：`broker.ts:275/290/299/304/314/433`（角色/能力/根/符号链接）、`:931`（NetworkPolicy）、`:1334`（GuardedRequester）、`:1508`（planContainerRun）、`:236`（docker 探测）。接线：`grep -rn "new Broker("` 仅命中 `packages/core/test/broker.test.ts:334`、`broker.integration.test.ts:179`、`permissions.integration.test.ts:284/677/746`、`permissions-failures.test.ts:294`；`packages/core/src/index.ts:45` 只是再导出 |
| F3 | **修正**：T2 安全复查写的铸造入口名是 `GrantService.issue`（`grants.ts:456/536`）；代码中类名是 **`GrantStore`**，`issue` 在 `packages/core/src/grants.ts:456` | 名字修正，结论不变：**无任何生产路径铸造 Grant** | `grep -rn "GrantStore" apps` → 0 处；唯一构造都在 `packages/core/test/*` 与 `packages/core/src/grants.ts:426` 自身 |
| F4 | `permission.request`/`permission.respond` 无 handler，`permission.resolved` 从不发出 | **成立** | `grep -rn "permission.request\|permission.respond\|permission.resolved" apps packages --include=*.ts` → 生产源码 0 处；`docs/architecture/protocol.md:71-72`、`:133` |
| F5 | WP-11 的能力网关与控制端点：loopback + 每次调用复检 attempt/epoch | **成立** | `packages/core/src/control-http.ts:118`（3 条路径）、`:281-339`（authenticate：token→Run→终态→Attempt→状态→epoch）、`packages/core/src/execution.ts:254`（控制端点）、`:306`（Attempt 结束撤销 capability） |
| F6 | Runner 从 0600 `models.json` 读 capability | **成立** | `apps/runner/src/cli.ts:125-141`；写侧 `apps/daemon/src/runner-spawn.ts:86-113`；argv 不含 token（`runner-spawn.ts:215-220`） |
| F7 | `packages/workspace` 实现 Git/worktree；`execution.md` 固定工具清单与“Git ref 修改只由 Workspace 完成” | **成立** | `packages/workspace/src/git-port.ts:385`（commit）、`packages/workspace/src/cas.ts:1925-1940`（`update-ref` CAS）、`packages/workspace/src/worktree.ts:757`（`createWorktreeManager`）、`:1039`（lease 资源名）；`docs/architecture/execution.md:53` |

### 1.2 计划必须处理的新增阻断事实（本计划新发现）

| # | 事实 | 影响 | 证据 |
|---|---|---|---|
| **F8** | **Runner 的控制工具现在是“死的”**：Pi SDK 的 `tools` 既是 `allowedToolNames` 又决定初始激活集合，`customTools` 会被该允许集过滤后**直接丢弃**。`prepare-run.ts:95` 传的是 `frozen.profile.toolSubset`，而 `BUILTIN_TOOLS` 为空、profile 默认可为空列表 → `stage_yield`/`assessment_submit`/`agent_dispatch` 既未注册也不会激活，真实模型根本调不到。T2 只能靠“直连端点”的测试通过，不能证明模型可提交 | T3 必须让**角色工具注册表**成为允许集来源；`toolSubset` 只做收窄；并让 Runner 断言实际激活集合，不一致即失败（不许静默） | `packages/pi-runtime/src/session.ts:198-199`（`customTools` + `tools`）；锁定的 SDK 0.85.1：`dist/core/sdk.js:141`（`allowedToolNames = options.tools ?? …`）、`:144`（`initialActiveToolNames`）、`dist/core/agent-session.js:2112-2118`（`allCustomTools … .filter((tool) => isAllowedTool(tool.definition.name))`）、`:2110`（`isAllowedTool`）；`apps/daemon/src/prepare-run.ts:95`；`apps/runner/src/attempt.ts:156-174`、`:235-245` |
| **F9** | `defaultProcessRunner` 是 `spawnSync`：阻塞 daemon 事件循环，无进程组、无超时升级、无取消 | 与 `AC-056`（mailbox 1s 内应答）、`reliability.md:13`（心跳/冻结新工具）与 `reliability.md:53`（SIGTERM→10s→SIGKILL 进程树）冲突；T3 必须新增**异步**进程端口 | `packages/core/src/broker.ts:200-218`；`packages/core/src/supervisor.ts:1079`（`terminate` 只杀 Runner 子进程本身，不管 daemon 侧工具进程） |
| **F10** | `Work.baseRevision` 只有读方、没有写方；`PlanGateService.requestCodeWrite` 对无 `baseRevision` 的 Work 恒返回 `GATE_NOT_READY` | AC-013「无批准 Plan 的代码写请求 → Broker GATE_NOT_READY 且源码 Hash 不变」当前**无法在不改 Work 创建路径的前提下满足** | `packages/core/src/gates.ts:742`、`:764-777`；`grep -rn "baseRevision" packages/core/src messages` 无写入点（`grep -rn "baseRevision" --include=*.ts packages/core/src apps/daemon/src` 仅 gates/decisions/recovery/findings 读） |
| **F11** | 事件 `tool.invoked`/`tool.refused` 未进 `protocol.md` §7 事件表 | 审计行存在但文档面漂移 | `packages/core/src/broker.ts:112`、`:1990`、`:2289`；`docs/architecture/protocol.md:133` |
| **F12** | `AttemptCapability` 无 `allowedMethods` 字段，但 `execution.md:13` 要求 capability 绑定 allowed methods | 目前靠端点按路径/角色兜；T3 要把“这张 capability 能调哪些内部方法”显式化 | `packages/core/src/capabilities.ts:22-31`；`docs/architecture/execution.md:13` |
| **F13** | `policy.permissionMode`（`workspace/autonomous/full_access`）配置面存在、**运行期无人读** | T3 是第一个需要它的切片：决定“哪些操作要用户逐次批准” | 写：`packages/core/src/config.ts:93/173/298-300`；读：`grep -rn "permissionMode" packages apps --include=*.ts` 无消费点 |
| **F14** | 本机 Docker **可用**：`docker version` → `28.4.0`（exit 0）；固定执行镜像已存在：`agentdev/exec:0.0.0`（image id `edd3aa5051c7`） | 容器模式的**工具执行**在本机可实现并可真实测试；缺口只剩 socket 代理与容器化 Runner（见 §8） | 只读命令输出；`docker/Dockerfile`、`docker/run-agentdev.sh`；`apps/cli/src/doctor.ts:206`（probeDocker 报 imageId/digest） |
| **F15** | T2 修复轮已落地部分内容（计划要避开重复劳动）：`controlTools` 已按 role 分工具（P2-3 已修）；控制端点已支持 413、未知字段拒绝、scope 路径入口校验 | T3 不要重做这些；`packages/core/src/control-http.ts` 与 `apps/runner/src/control-client.ts` 仍在 T2 车道手上 | `apps/runner/src/control-client.ts:188`、`:341`；`packages/core/src/control-http.ts:172-177`、`:199-207`、`:228-253`；`git status` 显示 `packages/core/src/control-http.ts` 为未跟踪新文件 |

### 1.3 关键契约行（引用口径）

- `execution.md:11`「容器经仅挂载的Unix Socket代理访问Gateway/Tool Broker，未挂载宿主网络和Docker Socket」；`:13`「Capability绑定…allowed methods…；Broker重新校验，Runner不能声明自己是Chief。Core直接处理文件和领域工具；Shell请求由Supervisor另起工具容器」；`:27`「文件工具拒绝相对路径逃逸、符号链接逃逸、嵌套仓库逃逸；…通过open时再校验真实路径与快照避免仅检查字符串」；`:31`「once在准入时消耗，结果不确定不重新消费再执行」；`:41`「Shell超时终止进程组，清理失败记录recovery」；`:53`「工具：read/search/context_request/artifact_write；修改角色另有edit/write/bash/git；Chief有assessment_submit/agent_dispatch/decision_request；专业角色有stage_yield/request_dispatch。Shell和Git均走Broker；Git ref修改只由Workspace服务完成」；`:51`「角色工具完全由注册表构造」。
- `protocol.md:115`「内部接口必须有attempt capability；客户端不得直接调用。所有调用带operationId以便重派去重」；`:125` `tool.execute*` 参数 `attemptId,epoch,toolName,args,expectedInputHash?`，结果「accepted或工具结果Ref」；`:81` once 必须 `runId/toolOperationId/inputHash`；`:137` 错误码表。
- `reliability.md:15`「所有工具记录prepared→started→finished，保存operationId、输入Hash、目标路径、结果Hash/错误。once Grant的消费与prepared在同一事务…已finished的相同operationId返回原结果；started且结果未知的写入不重放」；`:13`「20秒无心跳标interrupted，冻结新工具…撤销Capability并终止旧执行」；`:53` 取消时进程树升级。
- `data.md:41` `tool_operation` 行语义；`data.md:36` grant 全匹配；`data.md:55` `Scope.operations` 仅取 `read/search/artifact_write/edit/write/bash/git/network/secret/push/deploy/delete_data`。

---

## 2. 目标（T3 的可验收定义）

在一个真实 Git 项目上，**不播种任何行**，从一条用户执行指令出发：

1. 专业 Run（backend/frontend）拿到**真实工具**：`read`/`search`/`edit`/`write`/`bash`/`git` 在角色注册表∩授权范围内可用；review/test 只拿到 `read`/`search`（+受控报告目录写）且任何写都被拒。
2. 每个工具调用**只由 Core 的 Broker 执行**：路径先按解析后真实路径校验根/保护路径/符号链接；角色写门在 host 模式同样生效；`bash` 由 daemon 侧异步子进程按模式（container/host）执行；网络请求只走 `GuardedRequester`（私网/metadata/NAT64/IPv4-mapped 全拒）。
3. 每次调用有**审计行**：`tool_operation`（prepared→finished/unknown）+ `tool.invoked`/`tool.refused` 事件，含 operationId、inputHash、targets、code、mode。
4. 未获授权的操作走**真实权限链**：端点返回带 `toolOperationId`/`inputHash` 的 `NOT_AUTHORIZED` → Run 进 `waiting_permission`、Work 记 blocker → WebUI Inbox 出现 `kind=permission` 决定 → 用户批准后**铸造** `once` Grant（绑定 operation+toolOperationId+inputHash，原子消费，AC-080）→ 下一次同一调用放行并返回真实结果；`permission.resolved` 事件发出；Attempt 结束撤销该 Run 的 Grant。
5. 失败可恢复：工具崩溃/超时/取消（SIGTERM→10s→SIGKILL 进程组）/Runner 死亡/daemon 重启/非幂等副作用各有明确终态与 `tool_operation.state`，不伪装成功、不重复执行。
6. 文档面与实现面对齐：`tool.execute` 端点、`permission.*`、工具事件名在 `protocol.md` 内有唯一定义（见 Q-T3-6）。

---

## 3. 工具清单与映射（问题 1）

### 3.1 角色 → 工具清单

`execution.md:53` + `rules/agents.md` §1 的写入边界：

| Pi 工具名（= `Scope.operations` 名） | Broker operation | 能力 | chief | product/planning | backend/frontend | review | test | settlement |
|---|---|---|---|---|---|---|---|---|
| `read` | `read` | read-only | ✓（只读调查） | ✓ | ✓ | ✓ | ✓ | ✓ |
| `search` | `search` | read-only | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `edit` | `edit` | mutating | ✗ | ✗ | ✓ | ✗ | ✗ | ✓（仅授权候选文档路径） |
| `write` | `write` | mutating | ✗ | ✗ | ✓ | ✗ | ✗ | ✓（仅授权候选文档路径） |
| `bash` | `bash` | mutating（任意命令） | ✗ | ✗ | ✓（须环境 Grant） | ✗ | ✗ | ✗ |
| `git` | `git` | mutating（受子命令白名单限制，见 §5/D-T3-6） | ✗ | ✗ | ✓ | ✗（只读子命令可由 `bash` 代替→仍被角色门拒） | ✗ | ✗ |
| `artifact_write` | `artifact_write` | 领域工具（Core 直接处理） | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `context_request` | `context.request`（§6） | read-only | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `stage_yield` | `stage.submit` | 控制 | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `request_dispatch` | `agent.request_dispatch`（§6） | 控制 | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `assessment_submit` | `assessment.submit` | 控制 | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| `agent_dispatch` | `agent.dispatch` | 控制 | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| `decision_request` | `decision.request`（新增内部方法，见 D-T3-2） | 控制 | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |

说明：
- `read`/`search`/`edit`/`write`/`bash`/`git` 的 Pi 工具名**必须与 `execution.md:53` 和 `Scope.operations` 同名**：`tools` 允许集里出现 `bash` 而我们的 `bash` 工具叫别的名字时，Pi 会激活**SDK 自带 bash**（`sdk.js:141/144` 把 `tools` 当允许集，内置 `read/bash/edit/write` 在默认定义表中），等于绕过 Broker。同名注册会让自定义工具覆盖内置定义（`agent-session.js:2112-2118` 先按允许集过滤内置定义，再 `definitionRegistry.set(name, custom)`），这正是我们要的“文档工具集唯一权威”。
- review/test 的工具注册表里**根本不注册** `edit/write/bash/git`（与 `broker.ts:1845-1867` 的角色门构成双层防御）。
- `artifact_write` 不经 Broker：`execution.md:13`「Core直接处理文件和领域工具」。它仍走同一端点做 attempt/epoch 认证与限额，由 daemon handler 调 `ArtifactService.createAgent`（`packages/core/src/artifacts.ts:74`）并落 `artifact.created`。
- `decision_request` 与 `request_dispatch` 目前没有端点（`control-http.ts:118` 只有 3 条路径；`orchestrator.requestDispatch` 存在但无生产调用方，见 `api-gap-audit.md` §1.4 行 121）。T3 只需保证 Chief 会话**注册** `decision_request`（本切片真正用到它的是“权限被拒/需用户选择”的 Chief 侧表达），`request_dispatch` 端点可留给 T2/T8（登记为 T3 非目标）。

### 3.2 `BUILTIN_TOOLS = []` 怎么变成真实注册表

- 新文件 **`apps/runner/src/tools.ts`**：`ROLE_TOOL_REGISTRY: Record<Role, readonly ToolSpec[]>`，`ToolSpec = { name, operation, capability, label, description, parameters（typebox）, mutating }`。纯数据 + schema，不含策略（策略只在 Core）。
- **`packages/pi-runtime/src/session.ts`**：`PiToolSpec.execute` 增加第三个入参 `toolCallId`（SDK 已给：`session.ts:112` 现在把它丢掉了）。这是幂等键的自然来源（见 §4.3）。
- **`apps/runner/src/cli.ts`**：`BUILTIN_TOOLS` 从 `[]` 改为“按 `role` 从注册表取”；`--tools` 的语义从“工具全集”改为“profile 的收窄列表”。
- **`apps/runner/src/attempt.ts:156-174`**：`customTools = registry(role) ∪ controlTools(role)`；`toolNames`（allowlist）= `(registry(role) ∪ controlTools(role)) ∩ (profileSubset ∪ controlTool 名)`。
- **`apps/daemon/src/prepare-run.ts:95`**：注释与字段名同步（`tools` = profile 收窄列表），不再声称“工具不可用”（`:57` 的提示词必须改掉）。
- **profile 没请求的工具怎么办**（问题 1 的最后一问）：
  - 不在角色注册表里的名字：**永不注册**（SDK 允许集过滤 + 注册表构造时就拒绝）；
  - 在注册表里但 profile 的 `toolSubset` 未列：若 `toolSubset` 非空，则该工具不激活（收窄有效）；若 `toolSubset` 为空列表，按 D-T3-1（Q-T3-2 待决）取“注册表默认集”；
  - `toolSubset` 里出现角色不该有的名字（如 review 请求 `bash`）：Attempt **启动失败**（`ATTEMPT_START_FAILED`），不静默丢弃（与 `attempt.ts:235-245` 上报 `droppedTools` 同精神，但从“上报”升级为“拒启”）；
  - Runner 启动后断言 `session.activeToolNames()` **恰好等于**计算出的允许集；多出任何名字（例如 SDK 内置 `bash` 因配置漂移被激活）即失败退出。

---

## 4. `tool.execute` 端点（问题 2）

### 4.1 请求/响应

- 路径：`POST /control/tool.execute`（与现有三条控制路径同端点，复用同一 `authenticate`；见 D-T3-3 的取舍）。PUT 到 `CONTROL_PATHS`，`CONTROL_FIELDS` 增加：
  `['attemptId','epoch','toolName','args','toolOperationId','expectedInputHash','timeoutMs']`。
- 请求体：
  ```json
  {"attemptId":"<uuidv7>","epoch":3,"toolOperationId":"<uuidv7>","toolName":"edit",
   "args":{"path":"src/theme.ts","content":"..."},
   "expectedInputHash":"<sha256 hex>","timeoutMs":120000}
  ```
  - `toolName` 只允许该 role 注册表内的名字，否则 `VALIDATION_ERROR`（未知字段同样 `VALIDATION_ERROR`，沿用 `control-http.ts:199-207` 的风格）。
  - `args` 由各工具 schema 校验（`packages/contracts` 里新增 `toolArgsSchemas`，服务端/客户端共用一套，避免两份 schema）。
  - `toolOperationId`/`expectedInputHash`：由 Runner 生成/计算（见 4.3），缺失时服务端生成（生成的 id 在响应里回传）。
- 成功响应（`status:'executed'|'replayed'`）：
  ```json
  {"v":1,"status":"executed","mode":"host","operation":"edit","toolOperationId":"<uuidv7>",
   "inputHash":"<sha256>","grantId":"<uuidv7>","result":{"written":1},
   "resultRef":"<uuidv7>|null","truncated":false,"durationMs":42}
  ```
- 拒绝响应沿用 `{error:{code,message,details}}` + `statusForControlCode`（`control-http.ts:142`）。
- 结果回传模型：**内联**（`result` 即工具文本），超限时写 `ProjectStoreDeferredResultStore`（`grants.ts:286`）并把 `resultRef` + 截断预览内联返回；`truncated:true` 时工具文本明确标注“完整结果在 resultRef”（Q-T3-1 决定是否再补一个读取端点）。

### 4.2 attempt + epoch 绑定与审计

- 认证沿用 `control-http.ts:281-339` 的六步顺序（token→Run→Run 终态→Attempt→Attempt 状态→`ownerEpoch+1`），拒绝时**撤销 capability**。
- 端点把 `caller`（runId/attemptId/epoch/role）作为唯一身份，绝不接受 body 里的身份字段改变归属（`validateInvocation` 已按 invocation 检查 `broker.ts:2318-2337`）。
- 审计：`Broker.invoke` 已写 `tool.invoked`（`broker.ts:1990`）与 `tool.refused`（`:2289`）；**端点层自身的拒绝**（未知工具、超限、body 非法、未认证）也必须补一条 `tool.refused`（新代码，理由：`execution.md:41` 与 AC-048 要求“被拒也有审计”），`details` 只含 operation/targets/code，不含 args 原文。
- 失败断言：审计行必须出现在**执行之前**（prepared 行与 once 消费同事务，`reliability.md:15`；`grants.ts:818-865`）。

### 4.3 幂等（`expectedInputHash`）

- 输入哈希：`sha256(canonicalJson(args))`。`canonicalJson` 目前只在 `packages/core/src/dispatcher.ts:88`；Runner 不能依赖 `@agentdev/core`（会带进 storage/sqlite）。**决定 D-T3-4**：把纯函数 `canonicalJson` 移到 `packages/contracts/src/canonical.ts`（浏览器安全，`packages/client` 也可用），core 从 contracts 再导出以兼容；Runner 用 `node:crypto` 算 sha256。
- `toolOperationId` 由 Runner 稳定派生：`uuidv7From(sha256(`${attemptId}|${role}|${toolName}|${toolCallId}`))`（`toolCallId` 从 Pi SDK 传来，见 3.2）。同一次工具调用的传输重试复用同一 id 与同一 `expectedInputHash`。
- 语义（全部已有实现，端点只做透传）：
  - 同 `toolOperationId` + 同 inputHash：`finished` 且有 `resultRef` → 返回 `status:'replayed'` 与原结果（`grants.ts:946-957`、`:1089-1120`）；`once` Grant 已消费 → `evaluateGrant` 的 replay 分支放行（`packages/domain/src/permission.ts:168-185`）；
  - 同 id + 不同 inputHash → `IDEMPOTENCY_CONFLICT`（`grants.ts:946-954`）；
  - `state:'unknown'` → `RECOVERY_REQUIRED`（`grants.ts:958-966`）；
  - `expectedInputHash` 与服务端计算不一致 → `IDEMPOTENCY_CONFLICT`（新代码，端点层）。
- Runner 侧：控制客户端现有 30s 超时（`control-client.ts:56`）**不适用**于工具（bash 可到 1800s）。新 `apps/runner/src/tool-client.ts` 用工具级超时 + `signal`（Pi SDK 的 abort）；超时**只重试一次**且仅当未收到任何响应体（复用同 id），收到拒绝不重试。

### 4.4 拒绝码、限额、时间限制

| 码 | 触发 | 来源 |
|---|---|---|
| `VALIDATION_ERROR` | body 形状/未知字段/args schema/未知 toolName/`expectedInputHash` 不匹配/超 body 上限 | 端点 + `broker.ts:1833` |
| `NOT_AUTHORIZED` | 无 Grant、根外路径、保护路径、只读角色写、任意命令工具、私网/metadata 目标、`~`/`..`/绝对路径 | `broker.ts:1845-1919`、`resolveWithinRoots:433`、`NetworkPolicy:931` |
| `AUTH_EXPIRED` / `UNAUTHENTICATED` | capability 过期/无效 | `control-http.ts:287-290` |
| `NOT_FOUND` | Run/Attempt 不存在、未知路径 | `control-http.ts:293-307` |
| `IDEMPOTENCY_CONFLICT` | 同 id 异 inputHash；expectedInputHash 不符 | `grants.ts:946`；端点 |
| `RECOVERY_REQUIRED` | `tool_operation.state='unknown'` 或 resultRef 不可解析 | `grants.ts:958-966`、`:1101-1111` |
| `INVALID_STATE` | Run/Attempt 终态；operation 无内置 executor | `control-http.ts:298-302`；`broker.ts:2051` |
| `GATE_NOT_READY` | 写操作无有效批准 Plan（AC-013） | `gates.ts:742`；**前置依赖 F10** |
| `BUDGET_EXCEEDED` | Grant `limits.maxCalls/maxBytes/maxDurationSec` 超出 | **新代码**：`evaluateGrant`（`domain/permission.ts:167-237`）**不校验 limits**，仅 `broker.networkCovered:2265` 读 `limits['network']` |
| `PROVIDER_UNAVAILABLE` | container 模式无 Docker；container 网络无 Core 代理 | `broker.ts:1923-1944` |
| `INTERNAL_ERROR` | 端点未预期异常（不泄栈） | `control-http.ts:383-387` |

限额与时间：
- body：沿用 `maxBodyBytes`（默认 1MiB，`control-http.ts:367`；`LIMITS.requestLimitBytes` 同为 1MiB）。
- 结果：内联上限 `TOOL_RESULT_INLINE_BYTES = 64 * 1024`，超出落 deferred result + 截断预览（`truncated:true`）。
- 时间：默认取 `LIMITS.shellTimeoutSec.default`（120s，`packages/contracts/src/limits.ts:56`），Grant `limits.maxDurationSec` 可放宽到 1800，`timeoutMs` 不得超过该上限。
- 取消：请求 socket `close`/`aborted` → 杀工具进程组并把 `tool_operation` 标 `unknown`（见 §7）。

---

## 5. 路径/网络/进程策略“落在端点”（问题 3）

原则：**端点只做认证、身份、限额、编排；策略判断一律复用现有纯函数**，不写第二套规则。

### 5.1 复用（不重写）

| 关注点 | 复用函数/类 | 位置 |
|---|---|---|
| 根/保护路径/符号链接/`..`/绝对路径 | `resolveWithinRoots`（读与写在 `open` 时各校验一次）、`isWithinRoot`、`canonicalExisting`、`resolveRealPath` | `broker.ts:433`、`:387`、`:372`、`:400` |
| 受保护根（run DB/其他 session） | `deriveProtectedPaths`（构造期派生，调用方无法放宽） | `broker.ts:1651` |
| 只读角色 | `isReadOnlyRole`、`toolCapability`、`isArbitraryCommandOperation`、`reportWriteRootsFor` | `broker.ts:277/304/309/1667` |
| 网络 | `NetworkPolicy`（scheme/DNS 后 IP/重定向每跳/私网/metadata/NAT64/IPv4-mapped）、`GuardedRequester`、`defaultNetworkFetcher` 的 pin 地址 | `broker.ts:931/1334/1239` |
| 容器计划 | `planContainerRun`、`containerMountTarget`、`EXEC_IMAGE` | `broker.ts:1508/1496/1552` |
| Docker 可用性与 digest | `probeDockerAvailability` / `apps/cli/src/doctor.ts:206` 的 `probeDocker` | `broker.ts:236` |
| 准入与 once 原子消费 | `Broker.invoke` → `GrantStore.consumeOnceAsync` → `prepareOnce` 的守卫式 UPDATE | `broker.ts:1814`、`grants.ts:753/818` |
| 角色/阶段授权 | `validateGrantIssueRequest`、`evaluateGrant`、`scopeBindingsSatisfied` | `packages/domain/src/permission.ts:323/167/244` |

### 5.2 必须新写

| 新件 | 位置 | 说明 |
|---|---|---|
| `AsyncProcessRunner`（真实异步子进程） | `packages/core/src/process-async.ts`（新）或 `broker.ts` 内新增端口 | `spawn(..., {detached:true})`；`timeoutMs`；`SIGTERM`→`cancelGraceSec`→`SIGKILL(-pgid)`；`AbortSignal`；登记/注销活进程（供 Attempt 结束清理）。**不得**用 `spawnSync`（F9） |
| `ToolContext.runAsync`（或把 `execute` 改 async） | `broker.ts:1591`（`ToolContext`）、`:2023`（`execute`） | 现接口是同步 `run(command): ProcessResult`，无法 await；`Broker.invoke` 已是 async，`consumeOnceAsync` 已 await executor（`grants.ts:762`），所以只需让 `execute` 走 async 分支 |
| 工具进程登记表 | `packages/core/src/tool-processes.ts`（新） | 以 `(attemptId)` 为键，暴露 `kill(attemptId, signal)`；daemon 在取消/心跳丢失/关闭时调用（呼应 `reliability.md:13/53`） |
| 活动工具计数与 limits 执行 | `packages/core/src/tool-limits.ts`（新）或 `permissions.ts` 内 | `maxCalls/maxBytes/maxDurationSec`；超限 `BUDGET_EXCEEDED`（F：`evaluateGrant` 不校验 limits） |
| 写操作 Plan 门 | `apps/daemon/src/tool-handler.ts` 内调 `PlanGateService.requestCodeWrite` | AC-013；前置 F10（`work.baseRevision` 无写方） |
| 端点层拒绝审计 | `packages/core/src/tool-http.ts` | 未认证/未知工具/限额拒绝也要 `tool.refused` |
| `~` 归一化入口校验 | `tool-http.ts`（复用 `control-http.ts:228-253` 的 `assertScopePaths` 思路） | `repoPathSchema` 已拒绝对路径/`..`/NUL（`packages/contracts/src/primitives.ts:67-81`）；`~` 与盘符由端点入口拒（T2 复查 P3-7 同类问题） |
| Git 子命令白名单 | `apps/daemon/src/tool-handler.ts` + `apps/runner/src/tools.ts`（描述） | 只放 `status/diff/log/show/rev-parse/ls-files/blame` 等只读子命令；`commit/update-ref/push/reset/checkout -B/merge/rebase` 一律 `NOT_AUTHORIZED`（`execution.md:53`） |

宿主路径 → 容器路径映射、容器 `base64 -d` 写、`--read-only`/`cap-drop=ALL`/`pids-limit`/`--network none` 已由 `broker.ts:2162-2246` 与 `planContainerRun` 完成，T3 只提供正确的 `roots`/`writableRoots`/`mode`。

---

## 6. Grants 与 permissions 全生命周期（问题 4）

### 6.1 已有 vs 新增（一句话资产表）

| 环节 | 现状 | T3 |
|---|---|---|
| Grant 铸造 `GrantStore.issue` | **已有**（`grants.ts:456`），但**无生产调用方**（F3） | 新增 `ToolGrantService`（见下）成为唯一生产调用方 |
| once 原子消费 + 重放 | **已有且完整**（`grants.ts:818/895/988/1040/1135`；`domain/permission.ts:167`） | 端点只传 `toolOperationId`/`inputHash` |
| `tool_operation` 行 | **已有**（`prepared→finished→unknown`，`grants.ts:921-1021`） | 端点必须为每次调用生成/透传 id |
| `permission.request` / `permission.respond` | **完全没有**（F4） | 新增协议方法 + handler |
| `permission.resolved` 事件 | **从不发出**（F4） | 新增发射点 |
| 权限决定 UI | **已有**：`inbox` 读 `decisions` 并按 `choices` 渲染按钮（`apps/daemon/src/protocol.ts:1457-1478`、`apps/web/src/pages.ts:995-1013`），按钮发 `decision.resolve`（`apps/web/public/app.js:1345-1360`） | 只需让 `permission.request` 建 `kind='permission'` 的 Decision，`approve/deny` 即为 choices |
| Work blocker 挂接/解除 | **已有范式**：`findings.ts:1822`（挂）、`:1926`（摘） | 权限服务复用同一模式 |
| Run `waiting_permission` 状态 | 枚举/迁移表已有（`contracts/src/enums.ts:83`、`domain/src/transitions.ts:58/69`），**无状态写入方** | 新增（`RunLifecycle` 或权限服务内的 `runs.update`） |
| 工具 audience 秘钥注入 | `SecretStore.resolve`/`environmentFor` + 私有 `admit`/`scopeAllows` 已有（`secrets.ts:312/326/396/443`），无生产调用 | bash 工具按 Grant 注入子进程 env（不落日志/产物） |
| Attempt 结束撤销 | capability 撤销已有（`execution.ts:306`） | 追加：撤销该 Run 的 Grant（`GrantStore.revoke`，`grants.ts:1135`）+ 杀活动工具进程 |
| 操作信封 | `GrantStore.workScope` **只并 paths、不并 operations**（`grants.ts:574-591`） | 见 D-T3-5：必须并 `authorization.operations`，否则 bash/network/secret 的 Grant 永远铸不出来 |

### 6.2 谁铸造 Grant（两个来源）

1. **Run 启动时的文件范围 Grant（`run` scope）**：`ToolGrantService.ensureRunGrants({run, attempt})` 在 Attempt 启动时（`prepare-run`/端点首调）读该 Work 未撤销的 `authorization` 行（`store.authorizations.list`），对 `read/search/edit/write/artifact_write` 各铸一条 `scope='run'`、`runId` 绑定、`targets` = 授权路径、`expiresAt` = Attempt 结束 + 宽限、`decisionId` = 该授权行来源的 decision 或 Work 的 `sourceRef` 对应的 decision（`grant.decision_id` 是外键，**必须存在**；`grants.ts:481-488`）。若无可用 decision，用 `authorization` 的 provenance 建一条 `kind='start'` 或 `product` 的已接受 Decision 行——这一步是 T3 与 T2 的接口点，需 T2 确认（Q-T3-4 之一）。
2. **环境操作 Grant（`once` scope）**：只有用户对 `permission.request` 批准后才铸造；`scope='once'`（默认）或 `run`（用户选择“本次运行内允许”），绑定 `operation + runId + toolOperationId + inputHash`（`protocol.md:81`）。

### 6.3 `permission.request` / `permission.respond`（新）

- `permission.request`（Runner→Core，内部通道；同时按 §4 形状对客户端可用）：
  - 入参按 `protocol.md:71`；服务端**不信任**调用方给的绑定：由 capability 解析 `runId`/`role`/`stage`，`toolOperationId`/`inputHash` 必须是该 Attempt 已在上一次 `tool.execute` 里出现过的（否则 `VALIDATION_ERROR`），targets 必须在 Work 授权路径内（`validateGrantIssueRequest` 的 target 校验）。
  - 行为：建 `decisions` 行 `kind='permission'`、`state='pending'`、`choices=['approve','deny']`、`targetRef={id: toolOperationId, version}`、`actor='user'`；把 decisionId 追加到 `work.blockerIds`；把 Run 置 `waiting_permission`；发 `decision.created`；返回 `{decisionId,version,status:'waiting_permission'}`。
  - Work 状态：仅挂 blocker，不把 Work 置 `blocked`（`workflow.md:47` 允许多个 blocker；`blocked` 会让看板语义变化——登记为 Q-T3-3 的一部分）。
- `permission.respond`（用户/BFF）：校验 `decisionId`/`choice∈choices`/`targetVersion`（复用 `resolveDecision` 的规则，`apps/daemon/src/protocol.ts:2723-2819`），然后：
  - `approve`：`ToolGrantService` 铸 Grant（见 6.2.2）→ 摘 blocker → Run 回 `running` → 发 `permission.resolved`（新增发射点，`protocol.ts:2812` 附近同风格；`api-gap-audit.md` §1.5 要求该事件发出）。
  - `deny`：`decision.state='rejected'` → 摘 blocker → Run 回 `running`，端点对该 toolOperationId 返回可读拒绝（模型可改用其他方式），不进 recovery（`workflow.md:57` 权限拒绝不是瞬时重试对象）。
- Chief 侧的用户决定：`decision_request` 工具 → 新增内部方法 `POST /control/decision.request` → 建 `kind∈{product,risk}` 的 pending Decision（同样进 Inbox），**不**铸 Grant；这样 Chief 可以“请求人类决定”，而权限批准只经 `permission.*`（避免两个入口都能铸 Grant）。

### 6.4 once 绑定 → 原子消费 → 撤销（AC-080）

- 铸造时写入 `runId`+`toolOperationId`+`inputHash`（`grantSchema` 的 superRefine 强制，`packages/contracts/src/entities/run.ts:151-166`）。
- 消费在准入事务内：`prepareOnce` 的 `UPDATE grant … WHERE id=? AND consumed_at IS NULL AND run_id=? AND tool_operation_id=? AND input_hash=?`（`grants.ts:831-863`），与 `prepared` 行同事务提交；不同 Hash 拒绝；并发第二个连接 `IDEMPOTENCY_CONFLICT`。
- 兄弟 Run 窃用：`evaluateGrant` 的 once 分支比 `runId`（`domain/permission.ts:209`），`boundGrant` 的排序保证精确匹配优先（`grants.ts:1040-1074`）。
- 撤销时机：Attempt 进入终态/心跳超时/取消/daemon 关闭 → `capabilities.revoke(attemptId)`（已有）+ 新增 `GrantStore.revoke({grantId, reason})` 遍历 `currentRunGrants(runId)`（`grants.ts:612`；已有查询）。撤销置 `expiresAt=revocationTime()`，已完成的 once 仍可重放（`domain/permission.ts:186-191` 的语义保留）。

### 6.5 secret / environment

- `secret.set` 已支持 `audience:gateway|tool`（`protocol.md:101`；`main.ts:617`）。T3 只实现 **tool audience** 的注入：`operation='secret'` 的工具调用在 Broker 准入后，由端点用 `SecretStore.environmentFor(context, refs)`（`secrets.ts:326`；准入走 `resolve:312` → `admit:396` → `scopeAllows:443`）取值，仅写进该次 bash 子进程的 `env`；值不进 `tool_operation`（只存 hash）、不进事件、不进日志、不进 Artifact（AC-051）。
- Provider/gateway secret 永不出现在工具 env（负例：诱饵扫描，测试复用 `packages/core/test/permissions.integration.test.ts:830/920` 的手法）。

---

## 7. 失败路由（问题 6）

| 场景 | 行为 | 终态/证据 |
|---|---|---|
| 工具崩溃（非 0 退出/信号） | `run` 返回 `ProcessResult`（status/signal/stderr）；`tool_operation` 仍 `finished`，结果体含退出码；模型看到 `isError` 文本（不是异常），`tool.invoked` 已记录 | 审计 + 结果；`Run` 不因此失败（模型可自纠） |
| 工具超时 | `AsyncProcessRunner` 在 `timeoutMs` 后 SIGTERM→`cancelGraceSec`→SIGKILL 进程组；结果体带 `timeout:true` 与退出码；`tool_operation` `finished`（已确定被终止） | 与 `AC-048`/`execution.md:41` 一致 |
| 取消中（用户在工具执行中取消） | `supervisor.cancel`（`supervisor.ts:356-420`）已对 Runner 升级信号；**新增**：daemon 侧 `tool-processes.kill(attemptId)` 杀工具进程组；Runner 收到 `attempt.shutdown` 后 abort Pi 会话 | 结果未知时 `tool_operation.state='unknown'` + `work.blocker(recovery)`，`reliability.md:53` |
| Runner 死亡在工具执行中 | capability 在 `onAttemptEnded` 撤销（`execution.ts:306`）；工具进程立即被 `tool-processes.kill` 清理；`tool_operation` 停在 `prepared`/`started` | 心跳超时→`interrupted`（`reliability.md:13`），新 Attempt 可重放已 `finished` 的结果 |
| daemon 重启 | capability 是内存态→旧 token 全失效（`capabilities.ts:10-15` 注释）；`prepared` 行在重启后**不重放**（`grants.ts:967-978` 对 once 返回 `RECOVERY_REQUIRED`，对可复用 Grant 删残行再执行） | `reliability.md:7`；恢复由 supervisor/recovery 负责（T8 范围） |
| 非幂等工具被模型重复调用（新 toolCallId、同 args） | 视为**独立**调用：新 `toolOperationId` → 新审计行；`once` Grant 已被消费 → `NOT_AUTHORIZED`（fail-closed），模型得到“需重新申请授权”的可读拒绝；`run/work` scope Grant 则允许再次执行 | AC-080 的“once 绑定操作/输入 Hash”；非幂等副作用不静默重放 |
| 已 `finished` 的同 operationId 重试 | 返回原结果（`grants.ts:955-957`、`replayOperation:1089`） | AC-080 |
| 结果不确定性 | `state='unknown'` 永不重放（`grants.ts:958-966`），进 `RECOVERY_REQUIRED`；用户处置走既有 recovery 流程 | `reliability.md:2/15` |
| 工具进行中 daemon 关闭 | `execution.stop()`（`execution.ts:324-327`）顺序：停 supervisor → 关端点；端点关闭前先杀工具进程组并落状态 | 优雅停止 `reliability.md:63` |

---

## 8. 容器模式（问题 5）

- **文档要求**：`execution.md:5` Review/Test 在所有模式用隔离容器；`:1` 镜像固定 + `read-only rootfs`/`cap-drop=ALL`/`no-new-privileges`/pid 256/2GiB/2CPU/网络 none，构建记录 digest、每次 Attempt 冻结 digest；`:11` 容器经**仅挂载的 Unix Socket 代理**访问 Gateway/Tool Broker，不挂宿主网络与 Docker Socket；`:4` 网络工具走 Core 受控代理。
- **本机可实现**（有真实证据）：Docker 可用（28.4.0）、固定镜像已存在（`agentdev/exec:0.0.0`，`edd3aa5051c7`，F14）。因此 T3 可真实实现并测试：
  - `mode='container'` 时 Shell 由 daemon 用 `docker run` 按 `planContainerRun`（`broker.ts:1508`）执行，`--read-only`/`--network none`/cap-drop/pid/mem/cpu 全在；
  - Docker 不可用 → `PROVIDER_UNAVAILABLE` 且**不降级 host**（`broker.ts:1923-1931`，已有）；
  - 网络代理未配置 → 容器网络调用拒绝（`broker.ts:1936-1944`，已有）；
  - 镜像 id/digest 由 `doctor` 与 `probeDocker` 报告，Attempt 冻结值写入 dispatch/尝试快照（新增小改：`EXEC_IMAGE` + `probeDocker().imageDigest` 记入 Attempt 证据字段或 `tool_operation` 的 mode 旁证）。
- **环境受限缺口（必须登记，不假装实现）**：
  1. **容器内 Unix Socket 代理不存在**：`containerPlan` 只用 env `AGENTDEV_NETWORK_PROXY` 表达“有代理”（`broker.ts:2186-2188`），没有真实 socket 代理进程；因此容器化工具**不能**访问 Gateway/Tool Broker。→ 本切片结论：容器模式只跑**不需要 Core 连接**的工具（文件读写 + 无网络 bash）；需要 Core 代理的能力登记为缺口。
  2. **Review/Test 的 Runner 本身未容器化**：Runner 仍是宿主子进程（`runner-spawn.ts:221-225`），隔离只靠 Broker 角色门；`execution.md:5` 的“所有模式仍使用隔离容器”未满足 → 登记缺口（属 T10/后续容器的范围）。
  3. **依赖下载/镜像构建**：仓库有“不外部下载”的历史约束；本计划**不**新增镜像构建或拉取，只用已存在的 `agentdev/exec:0.0.0`；若本机镜像缺失，容器模式测试按既有约定登记 UNVERIFIED。
  4. **每次 Attempt 冻结 digest** 目前无持久字段承载（Task/Dispatch 有 `imageDigest` 类字段吗？无）→ 要么加 Attempt 证据字段（新 Schema，需产品/契约确认），要么仅在 `tool_operation` 的 mode/审计里记 digest，登记为 Q-T3-7。

---

## 9. 决定与待决问题

### 9.1 计划内实现决定（不改产品行为，属“接线/补齐既有契约”）

- **D-T3-1（工具注册表是权威，`toolSubset` 只收窄）**：依据 `execution.md:51`「角色工具完全由注册表构造」；空 `toolSubset` 视为“该角色注册表默认集”，非空则取交集；生成物中的额外工具名一律拒启（F8）。
- **D-T3-2（权限只经 `permission.*`，Chief 的 `decision_request` 建普通决定）**：避免两条路径都能铸 Grant。
- **D-T3-3（`tool.execute` 挂现有控制端点）**：一个 capability 通道、一套 `authenticate`（`control-http.ts:281`），不复制安全关键代码；代价是要改 T2 占用的 `control-http.ts`（顺序见 §12）。
- **D-T3-4（`canonicalJson` 移到 contracts）**：两端哈希必须逐字节一致；Runner 不引入 `@agentdev/core`。
- **D-T3-5（`workScope` 并 `authorization.operations`）**：`grant` 的 `operation` 必须落在 Work 操作信封内（`validateGrantIssueRequest`，`domain/permission.ts:336`），而现在的 `workScope` 只并 paths（`grants.ts:574-591`）；`Authorization` 行本身带 `operations`（`contracts/src/entities/work.ts:136`）。不并的话，用户批准 bash/network/secret 也铸不出 Grant。
- **D-T3-6（`git` 工具只放只读子命令）**：`execution.md:53`「Git ref修改只由Workspace服务完成」；ref 改动只经 `packages/workspace`（`cas.ts:1925`、`worktree.ts:374`）。
- **D-T3-7（宿主 vs 容器由 policy/模式决定，默认 host）**：`execution.md:1/15`；`permissionMode` 目前无消费点（F13），T3 先按“显式运行参数或默认 host”实现，不在本切片发明模式语义。
- **D-T3-8（不做播种证明）**：集成测试从 `sendMessage`（`packages/core/src/messages.ts:81`）→ Chief 评估（或直接 `Orchestrator.assessWithDerivation`+`dispatchProfessional`，二者都是真实生产路径）产生 Work/Run/授权；绝不用 `works.insert`/`runs.insert` 造场景充当 AC 证据。

### 9.2 需用户/产品决定（本计划不自行裁定；每条两选项 + 建议）

| ID | 问题 | 选项 | 建议 |
|---|---|---|---|
| Q-T3-1 | `tool.execute` 的文档结果行写「accepted或工具结果Ref」，而 Pi 工具调用是请求/应答语义 | **A**（推荐）：同步返回内联结果 + 超限 `resultRef`；把 `protocol.md:125` 的 `accepted` 读法限定为“本切片工具集内不存在长操作”，并在文档补一句 | A。B（返回 `accepted`+轮询读取端点）要新增一个未文档化的读面与模型侧轮询语义，产品面变大 |
| Q-T3-2 | `Profile.toolSubset` 语义（现为自由列表，默认可能为空） | **A**（推荐）：空=注册表默认集，非空=收窄；**B**：`toolSubset` 为权威，空=无工具（即当前“死工具”行为） | A。`execution.md:51` 说工具由注册表构造；B 会让默认安装永远没有工具 |
| Q-T3-3 | 各 `permissionMode` 下哪些操作必须**逐次**用户批准（产品行为） | **A**（推荐）：`workspace`=文件写按已授权路径的 run Grant 自动准入，环境操作（bash/git/network/secret/push/deploy/delete_data）一律逐次批准；`autonomous`=范围内预授权；`full_access`=宿主执行但仍守角色/领域 Gate。**B**：连文件写也逐次批准（提示轰炸） | A。与 `AC-049`「范围内继续，超范围权限决定」、`execution.md:15` 一致 |
| Q-T3-4 | AC-013 的 Broker 写门需要 `work.baseRevision`，但当前无写方（F10）；`ToolGrantService` 还需要一个可引用的 `decisionId` 才能铸造文件范围 Grant（`grant.decision_id` 外键） | **A**（推荐）：T3 内补两处小接线——Work 创建时绑定 `baseRevision`（消息/评估路径），Run 启动时用来源消息/授权 provenance 建一条已接受 Decision 作为 Grant 依据。**B**：把两处都推给 T2/T8，T3 只做工具桥并把 AC-013 标记 UNVERIFIED | A。两处都是“补齐既有契约”（`data.md` 的 Work 有 `baseRevision`，`grant` 有 `decisionId`），不是新产品行为 |
| Q-T3-5 | `execution.md:53`「Git ref修改只由Workspace服务完成」与 `bash` 可在工作区内写 `.git` 的事实 | **A**（推荐）：把不变量定在**交付 ref**上——`agentdev/main` 只由 `packages/workspace` 的 CAS 移动（已实现），`git` 工具限只读子命令，`bash` 能写工作区 `.git` 作为已登记残余（集成按 `dependencyRevision` 重算 Diff，不采信工作区 ref）。**B**：把工作区 `.git` 以只读挂载进工具容器（需要先解决容器缺 socket 代理与 worktree 布局） | A。B 才是“完全一致”，但依赖 §8 的容器缺口，成本与风险更大 |
| Q-T3-6 | `tool.invoked`/`tool.refused` 未进 `protocol.md` §7 事件表（F11） | **A**（推荐）：把两个事件名补进 §7（实现已存在，文档补记）。**B**：改名成 §7 已有名字（无合适语义） | A。属文档与实现对齐（WP-12 D8 的“实现有文档无靠补文档”） |
| Q-T3-7 | Attempt 级镜像 digest 冻结无持久字段（§8-4） | **A**（推荐）：本切片在 `tool_operation` 审计与 `doctor` 里记录实际 digest，Attempt Schema 冻结留待容器切片。**B**：本切片给 Attempt/Dispatch 加 `imageDigest` 字段（改契约） | A。避免为容器缺口扩张数据契约 |
| Q-T3-8 | 每 Task worktree（`prepare-run.ts:10-11` 明确留给工具切片）依赖 Task 落库，而 Task 当前无生产写入方（审计 §2.2） | **A**（推荐）：新增 `RunWorkspace` 解析器——Run 有 `taskId` 且有 Task 行时用 `worktreeManager.create/lease`（`worktree.ts:670/757`，单写者 lease），否则在 `workspace`/`full_access` 模式下用项目根 + 该 Work 的单写者 lease，并登记“Task worktree 未接线”缺口。**B**：先等 Task 落库（T2 D10/T8）再做工具桥 | A。否则 T3 被一个非本切片的产品决定无限期阻塞；B 更严格但会让“真实改代码”继续不可用 |

---

## 10. 任务分解（7 个子任务，顺序执行，各自可独立 Review）

> 每个子任务的“退出条件”都要用**当次运行的真实输出**支撑；禁止播种行证据。

### T3.1 角色工具注册表 + Runner 工具面（解 F8）
- 内容：新增 `apps/runner/src/tools.ts`（注册表 + 各工具 typebox schema + 是否 mutating）；`packages/pi-runtime/src/session.ts` 的 `PiToolSpec.execute` 增加 `toolCallId`；`apps/runner/src/cli.ts` 用注册表构造 `BUILTIN_TOOLS`（角色化）；`apps/runner/src/attempt.ts` 计算并断言允许集；`apps/daemon/src/prepare-run.ts:95` 语义与提示词同步（`:57`）；`packages/contracts/src/entities/structures.ts` 或新 `tool-args.ts` 放共用 args schema。
- 退出条件：对每个 role，一个**真实** Pi 会话（`models.json` 指向桩 gateway，无网络）报告的 `activeToolNames()` 恰好等于期望集合；review/test 集合不含 `edit/write/bash/git`；`toolSubset=['read']` 时只剩 `read`+该角色控制工具；`toolSubset=['bash']`（review）导致启动失败。
- 证明测试：`apps/runner/test/tools.test.ts`（新，真实 `PiSessionFactory` + `createExplicitResources`，断言 `activeToolNames()`）；扩充 `apps/runner/test/control-client.test.ts`（role 断言按真实 role 传参）。

### T3.2 `tool.execute` 端点 + 异步进程 + 审计（Core 侧）
- 内容：新增 `packages/core/src/tool-http.ts`（路径/字段/schema 校验/限额/`tool.refused` 补审计；认证与状态码复用 `control-http.ts` 的实现，抽公共小函数或直接引用同端点）；`packages/core/src/process-async.ts` + `packages/core/src/tool-processes.ts`；`broker.ts` 的 `ToolContext.run` 增加异步通道；`packages/core/src/index.ts` 导出；`packages/core/src/execution.ts` 装配（与 T2 抢占点，见 §12）。
- 退出条件：真实 HTTP 端点 + 真实 `Broker` + 真实 `GrantStore`：`read` 读到真实文件内容；同 id 重试返回 `replayed` 且文件未被二次处理；同 id 异 args → `IDEMPOTENCY_CONFLICT`；未认证/未知工具/超 body 各有 `tool.refused` 审计且无副作用；一次 2s 的 bash 期间 daemon 心跳回调仍按 5s 触发（证明不阻塞事件循环）。
- 证明测试：`packages/core/test/tool-http.test.ts`（真实 `node:http` 端口 + 真实 SQLite）；`packages/core/test/process-async.test.ts`（真实子进程：超时/进程组 SIGKILL/abort）。

### T3.3 路径/网络/角色/Plan 门在端点生效
- 内容：端点把 `roots`（RunWorkspace 根）、`writableRoots`（review/test 报告根）、`protectedPaths`、`mode`、`allowedNetworkTargets`（来自 Grant）传给 Broker；`~`/盘符/空路径入口校验；写操作调用 `PlanGateService.requestCodeWrite`（AC-013，依赖 Q-T3-4）；`git` 子命令白名单。
- 退出条件：真实符号链接逃逸、`..`、绝对路径、`~`、运行数据库读取、review 角色写源文件**全部被端点拒绝**且目标文件 hash 不变；私网字面量/metadata/NAT64/IPv4-mapped 目标在**发出请求前**被拒；无批准 Plan 的 `edit` 返回 `GATE_NOT_READY`。
- 证明测试：`packages/core/test/tool-http.integration.test.ts`（真实临时 Git 仓库 + 真实符号链接 + 真实 SQLite）；复用并扩充已有库级用例（`packages/core/test/broker.test.ts:542/563/580/1024`、`permissions-failures.test.ts:345`）作为回归，不重复造。

### T3.4 Grant 铸造 + permission 全链（含 read ledger 与 stage 封口）
- 内容：新增 `packages/core/src/permissions.ts`（`ToolGrantService`：run 范围 Grant 引导、`permission.request`/`respond` 服务、`permission.resolved` 发射、Attempt 结束撤销、`tool-audience` 秘钥注入）；`grants.ts` 的 `workScope` 并 `authorization.operations`（D-T3-5）；`RunLifecycle` 或服务内 `waiting_permission` 写入；`apps/daemon/src/tool-handler.ts`（`artifact_write` → `ArtifactService`、bash env 注入、Git 白名单）；`apps/daemon/src/protocol.ts` 注册 `permission.request`/`permission.respond`（T2 冲突点）；`createReadLedger`（`packages/core/src/context/ledger.ts:824`）按 Attempt 创建、每次 `tool.execute` append、`stage.submit` 校验 seq/hash 封口（AC-085，当前 `stage.ts:217` 只回显不校验）。
- 退出条件：一次未授权 `edit` → `NOT_AUTHORIZED` + pending permission 决定 + `waiting_permission` + Work blocker；UI `inbox` 可读到该决定并有 `approve/deny` 按钮（真实 daemon+BFF）；批准后铸出 `once` Grant（`runId`/`toolOperationId`/`inputHash` 全绑定）、发出 `permission.resolved`、下一次同一调用成功且 `tool_operation` `finished`；`deny` 路径不进 recovery；Attempt 结束后 `findGrantFor` 不再放行；stage 提交用旧 seq/hash → 拒绝。
- 证明测试：`apps/daemon/test/tool-bridge.integration.test.ts`（新，真实 daemon + supervisor + 桩 Provider + 真实 HTTP；从 `sendMessage` 起，无播种）；`packages/core/test/permissions-bridge.test.ts`（Grant 铸造/撤销/limits `BUDGET_EXCEEDED`/read ledger 封口）。

### T3.5 容器/宿主执行模式（含环境受限缺口登记）
- 内容：端点按 `mode` 选择 `docker run`（复用 `planContainerRun`/`EXEC_IMAGE`）或宿主 `spawn`；容器工具不接 Core 代理时拒绝；digest 记入审计；缺口写入本计划 §8 与残差表。
- 退出条件：`mode='container'` 时真实在 `agentdev/exec:0.0.0` 内执行 `cat`/`printf` 并写回挂载目录；`--network none` 下容器内 `curl` 失败；注入“无 Docker”探针 → `PROVIDER_UNAVAILABLE` 且**未**发生宿主执行（用进程记录器断言）；宿主模式 review 写源被拒（AC-050）。
- 证明测试：`packages/core/test/tool-container.integration.test.ts`（真实 docker；镜像缺失时显式 UNVERIFIED，不伪通过）。

### T3.6 失败路由与清理
- 内容：`tool-processes` 与 supervisor 生命周期挂钩（取消/心跳丢失/`onAttemptEnded`/`execution.stop`）；`unknown` 状态落库；结果不确定 → `RECOVERY_REQUIRED`；daemon 重启后不重放 `prepared`；非幂等重复调用策略（§7）。
- 退出条件：取消发生在 bash 执行中 → `SIGTERM`→（≤10s）`SIGKILL` 进程树，pgrep 断言无残留、端口/临时目录清理；kill 前取消 → `tool_operation.state='unknown'` → `RECOVERY_REQUIRED`；重启后同 id 请求返回 `RECOVERY_REQUIRED`/原结果（取决于 state），无二次执行。
- 证明测试：`packages/core/test/supervisor-tools.integration.test.ts`（真实 Runner 子进程 + 会 sleep 的工具）；`packages/core/test/tool-recovery.integration.test.ts`（重开 SQLite 验证不重放）。

### T3.7 e2e / live 纵向演练 + 文档对齐
- 内容：`scripts/e2e.mjs`（桩 Provider 按请求返回工具调用序列）+ `scripts/lib/e2e-checks.mjs` 新检查；`scripts/lib/live-drills.mjs` 新增真实 Provider 的 L2 演练（读+改+提交 stage 结果）；`docs/architecture/protocol.md` 补 `tool.execute` 结果口径与工具事件（按 Q-T3-1/Q-T3-6 的决定）。
- 退出条件：`pnpm test:e2e` 新检查通过（消息→Chief→专业 Run→真实 Runner 子进程→经 Broker 读/改工作区文件→`changedPaths` 回看板；撤销 Grant 后同调用立即被拒）；`pnpm test:live` 在配置真实 Provider 时通过，未配置时按既有约定 `EXIT_UNVERIFIED`。
- 证明测试：`node scripts/e2e.mjs`、`node scripts/live.mjs`（证据写入既有报告）。

---

## 11. 测试策略（最小、真实、非播种）

### 11.1 单元（策略纯函数；已有大量覆盖，只补新件）

| 文件 | 证明 | AC |
|---|---|---|
| `apps/runner/test/tools.test.ts`（新） | 角色注册表与允许集（F8 回归杀手） | AC-048/050（角色工具面） |
| `packages/core/test/process-async.test.ts`（新） | 超时、进程组 SIGTERM→SIGKILL、abort | AC-048、`reliability.md:53` |
| `packages/core/test/permissions-bridge.test.ts`（新） | Grant 铸造绑定、limits 超限 `BUDGET_EXCEEDED`、撤销、read ledger 封口 | AC-049/080/085 |
| 既有 `packages/core/test/broker.test.ts` / `permissions*.test.ts` | 策略原语回归（不改断言） | AC-048/049/050/051/053/080 |

### 11.2 集成（真实 FS/Git/进程/HTTP；主证据）

| 文件 | 真实物 | 证明 | AC |
|---|---|---|---|
| `packages/core/test/tool-http.test.ts`（新） | 真实 `node:http` + SQLite + 真实文件 | 端点契约：形状/幂等/审计/限额/拒绝码 | AC-048/080 |
| `packages/core/test/tool-http.integration.test.ts`（新） | 真实临时 Git 仓库 + 符号链接 + 保护路径 | 根/符号链接/`..`/`~`/保护路径/角色写门 | AC-048/050 |
| `packages/core/test/tool-container.integration.test.ts`（新） | 真实 Docker + 固定镜像 | 容器隔离、无网络、无 Docker 拒绝不降级 | AC-048 |
| `apps/daemon/test/tool-bridge.integration.test.ts`（新） | 真实 daemon + supervisor + **真实 Runner 子进程** + 桩 Provider | 消息→Chief→专业 Run→工具读写→permission 链→看板；无播种 | AC-004/013/049/080/082 |
| `packages/core/test/supervisor-tools.integration.test.ts`（新） | 真实 Runner 子进程 + 长工具 | 取消/超时/进程树清理 | AC-048、reliability §6 |
| `packages/core/test/tool-recovery.integration.test.ts`（新） | 重开 SQLite | 重启不重放、`unknown`→`RECOVERY_REQUIRED` | AC-080/082 |

### 11.3 契约命令

- `pnpm test:e2e`：新增“真实 Runner 经 Broker 改工作区 + Grant 撤销即拒”检查（服务端全链 + 既有 Chromium 套件不受影响）。
- `pnpm test:live`：真实 Provider 的 L2 演练（工具真实读写代码）；未配置 Provider 时显式 UNVERIFIED（`scripts/live.mjs:47`）。
- `pnpm test:acceptance`：把上表新增证据绑定到 AC-048/049/050/051/080/085；**AC-013 在 Q-T3-4 选 A 前保持 UNVERIFIED**（F10）。
- 全程不改 `pnpm` 十条命令名与 `docs/delivery/implementation.md:147-158`。

### 11.4 AC 覆盖声明（本切片能合法主张的）

| AC | 由哪个子任务/测试覆盖 | 备注 |
|---|---|---|
| AC-048 Workspace 边界 | T3.2/T3.3/T3.5 + 集成测试 | 容器 + Broker + 缺环境拒绝 |
| AC-049 Autonomous 范围 | T3.4 + 集成测试 | once/run/work/过期 Grant 正负例 |
| AC-050 Full Access 门禁 | T3.3/T3.5 | 宿主模式 review/test 仍只读 |
| AC-051 Secret 隔离 | T3.4 | tool audience 注入 + 诱饵扫描；provider secret 不入工具 env |
| AC-013 无效 Plan | T3.3（依赖 Q-T3-4） | 现在不成立，见 F10 |
| AC-080 授权精确绑定 | T3.2/T3.4/T3.6 | 端点 + once 原子消费 + 重放 |
| AC-082 重启保留窄范围 | T3.6 | 冻结 snapshot + 窄 Grant 恢复 |
| AC-085 证据读取封口 | T3.4 | read ledger append + stage 封口校验 |
| AC-004/011/033/081 | **不在本切片主张** | AC-004 由 T2 派生授权覆盖；AC-033 的“聊天不可访问”需要容器化 Runner（§8）；AC-081 需要 Task 落库（Q-T3-8）；AC-011 属 L3 操作路线 |

---

## 12. 与 T2 的文件冲突与顺序（问题 8）

`git status` 显示 T2 当前占用：`packages/core/src/{control-http,orchestrator,execution,supervisor,model-gateway,secrets,runtime,index}.ts`、`apps/daemon/src/{main,protocol,prepare-run,runner-spawn,server,bootstrap}.ts`、`apps/daemon/src/{control-handler,message-state}.ts`（未跟踪）、`packages/core/src/secret-repository.ts`（未跟踪）。任务书点名的四个文件之外还有 `main.ts`/`prepare-run.ts`/`supervisor.ts`/`index.ts`。

顺序规则（同一文件同时只有一个写者）：

| 阶段 | T3 可动 | 必须等 T2 冻结后才动 | 说明 |
|---|---|---|---|
| S0（可立即开工） | `apps/runner/src/tools.ts`（新）、`apps/runner/src/tool-client.ts`（新）、`packages/pi-runtime/src/session.ts`、`packages/contracts/src/canonical.ts`（新）、`packages/core/src/process-async.ts`（新）、`packages/core/src/tool-http.ts`（新）、`packages/core/src/tool-processes.ts`（新）、`packages/core/src/permissions.ts`（新）、`apps/daemon/src/tool-handler.ts`（新）、测试新文件 | — | 全部新文件或 T2 不碰的包（`pi-runtime`、`contracts`）；T3.1 的注册表工作与 T3.2 的核心逻辑可先落地 |
| S1（T2 冻结 `control-http.ts` 后） | 给 `CONTROL_PATHS`/`CONTROL_FIELDS` 加 `tool.execute` | `packages/core/src/control-http.ts` | D-T3-3；若想零冲突，可先让 `tool-http.ts` 独立监听同端口段的另一路径并在 S1 合并成单端点 |
| S2（T2 冻结 `execution.ts`/`main.ts` 后） | 装配端点 + handler + `tool-processes` 生命周期钩子 | `packages/core/src/execution.ts`、`apps/daemon/src/main.ts` | T3.2/T3.4/T3.6 的接线点；建议 T2 完成修复轮后一次性交接 |
| S3（T2 冻结 `protocol.ts` 后） | 注册 `permission.request`/`permission.respond` + 事件发射 | `apps/daemon/src/protocol.ts` | 也可由 T2 顺手加两个 case（T3 提供 handler 与新模块），由父代理决定 |
| S4 | `prepare-run.ts:95` 语义注释/提示词（`prepare-run.ts` 亦被 T2 改） | `apps/daemon/src/prepare-run.ts` | 与 T3.1 配套；若 S4 未到，T3.1 的注册表可以先在 Runner 内生效（Runner 自己算允许集，不依赖 daemon 传值） |
| S5 | `scripts/e2e.mjs`、`scripts/lib/e2e-checks.mjs`、`scripts/lib/live-drills.mjs` | （检查当前是否被其它车道占用） | T3.7 |

风险提示：`packages/core/src/grants.ts` 目前**未被 T2 修改**（`git status` 无该文件），D-T3-5 的 `workScope` 改动归 T3；但 `workScope` 被 T2 的派生授权路径间接依赖，落地后需要 T2 侧重跑 `orchestrator`/`assessment-dispatch` 相关用例。

---

## 13. 非目标

- 不做 T2 的消息→Chief→Plan 主链、不重做 T2 已修的 `control-http` 校验（F15）。
- 不实现 `agent.request_dispatch`/`context.preview`/`file.list|read`/`command.get` 等本审计外的协议面（T8）。
- 不实现容器内 Unix Socket 代理、不容器化 Runner、不构建/拉取镜像（§8 缺口，登记）。
- 不新增运行时依赖（`node:child_process`/`node:crypto`/`node:fs` 与既有 workspace 包足够）；不新增 `pnpm` 命令；不改 `docs/product/*` 与 AC 基线。
- 不做 Task worktree 的完整依赖链（AC-081）；T3 只提供 `RunWorkspace` 解析与单写者 lease，缺口登记（Q-T3-8）。
- 不做网络工具的完整代理实现（push/deploy/依赖安装）；这些操作在本切片一律 `NOT_AUTHORIZED`（无 Grant 时）。

---

## 14. 待补证据清单（开工前需 T2/父代理确认）

1. `apps/runner` 是否允许新增对 `@agentdev/contracts` 之外包的依赖？（本计划答案：不允许；`canonicalJson` 走 contracts。）
2. T2 何时冻结 `control-http.ts`/`execution.ts`/`main.ts`/`protocol.ts`（决定 S1–S4 的交接窗口）。
3. Q-T3-4 若选 A（推荐），谁改 `messages.ts`/Work 创建路径绑定 `baseRevision`（T2 还是 T3）。
4. Q-T3-8 若选 A（推荐），`RunWorkspace` 的 lease 资源名（`integration:<projectId>` 之外的 Work 级单写者锁）由谁定义。
