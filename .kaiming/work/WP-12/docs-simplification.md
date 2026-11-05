# WP-12 文档简化：宿主优先执行模型

- 状态：**文档修订完成，等待产品负责人确认 AC 解释清单（§3）**
- 决定来源：产品负责人——AgentDev 是运行在用户自己机器上、面向用户自己项目的**编码Agent**，不是运行时/沙箱产品；不再把隔离当作强制。对齐主流编码Agent（Claude Code、Codex CLI）：直接在仓库里工作 + 务实的守卫；容器只用在真正有帮助的地方（跑项目：服务、数据库、测试套件、依赖校验）。
- 约定：本文只记录**改了什么、为什么、还剩什么**；不新增机制、不新增必填配置、不新增协议方法或事件名。记录类文档（INDEX 工作包历史、`settlement.md`）只加注、不改写。

## 1. 目标模型（本次写入文档的版本）

1. **默认在宿主执行**：在用户仓库内；按 Task 分离时在该 Task 自己的 Git worktree/分支。不装 Docker 不损失编码路径，也不构成准入拒绝。
2. **守卫，不是沙箱**：路径边界（写入不超项目根/该 Task 的 worktree）+ 一张小的硬拒清单（凭据形态文件；工作区外删除；Agent 自行发起的 Git 引用变更）+ 什么跑了、什么被拒的审计链。
3. **审批只用于不可逆操作**（推送交付分支/部署/删除数据）；已批准范围内的一切不再打断用户。
4. **容器是可选的项目运行环境**（测试 suites/服务/数据库/依赖校验），按项目选择，不是 Agent 工作的前提，**绝不作每次工具调用的要求**。
5. **Full Access 保留**为用户显式选择，并写明风险。
6. 保留：Task worktree/分支、交付 CAS、读账本、预算、按角色的工具集、审计事件。

## 2. (a) 被降级或删除的内容及原因

| 位置 | 原文（旧模型） | 处置 | 原因 |
|---|---|---|---|
| `execution.md` §1 | Workspace/Autonomous 用 Docker 容器执行；doctor 失败即拒绝准入；Review/Test 在所有模式用隔离容器，缺 Docker 即阻断独立验证 | 改为"默认宿主执行；容器是可选项目运行环境；不装 Docker 不损失编码路径"；删除"缺环境即拒绝准入" | 隔离不再是前提；独立验证由独立 Run/Session/输入/工具集保证（`agents.md` §1） |
| `execution.md` §1 | 固定镜像规格：非 Root uid、read-only rootfs、cap-drop=ALL、no-new-privileges、pid/内存/CPU 上限 | 删除为必需配置；改为"项目选择容器时其加固参数由项目自行决定，Core 不把某套参数作为准入条件" | 不再规定一套必填的隔离参数 |
| `execution.md` §2 | 受控出口：容器 `--network none` + 命名卷 Unix Socket + egress sidecar + Core 代理；"仅能到代理"是结构性的 | 删除；改为宿主网络默认通 + 准入层"识别与审计"（守卫而非出口控制），残余风险如实登记；旧实装降级为历史记录 | 默认执行在宿主，结构性的每次调用出口不再成立；两个固定拒绝项保留 |
| `execution.md` §2 | `permission.request` 覆盖 `bash`/`network`/`secret`/`push`/`deploy`/`delete_data` 的逐次审批 | 降级为**只服务不可逆操作**（推送交付分支/部署/删除数据）；`bash`/`network`/`secret` 归入信封内直接执行 | 审批只用于不可逆操作 |
| `execution.md` §5 | Test 命令在"同一隔离容器路径（`--network none` + 命名卷出口 + 只读工作区挂载 + 加固参数）"执行 | 改为"在冻结输入的工作目录逐条执行（默认宿主；项目声明容器运行环境时在该环境内）" | 容器是可选运行环境，不是 Test 的门槛 |
| `execution.md` §5 | `TestEnvironmentManager` 的宿主端口/DB 认领在容器风格下"不适用" | 反转为：默认宿主执行下**直接适用**；项目用容器跑服务/数据库时该项目自身管理端口/DB，宿主侧无资源可认领 | 宿主成为默认后，原有管理器正是对应机制，保留 |
| `execution.md` §3 | "运行数据库、其他 Session/Transcript、全局 SecretStore **不挂载**到 Agent 或工具" | 改为"不进入任何角色的**路径边界或上下文**" | 宿主执行没有"挂载"这个边界，边界由路径与上下文 ACL 表达 |
| `protocol.md` §4 权限语义 | "第一期权限语义"整段：逐次审批类环境操作、受控出口已装配、容器恒为 `--network none` | 重写为简化模型：信封内直接执行；审批只用于不可逆操作；硬拒清单；网络默认通；容器不承载工具调用 | 与 `execution.md` 对齐 |
| `protocol.md` §6 | 错误映射含"无 Docker 或容器无代理 / PROVIDER_UNAVAILABLE"、"私网目标" | 删除"无 Docker"与"私网目标"；保留 `PROVIDER_UNAVAILABLE` 仅指 Provider 不可用 | 缺 Docker 不再是一种拒绝；私网默认通 |
| `reliability.md` §2/§7 | "核对进程/容器""回收容器/进程""Docker、项目依赖和 Provider 探测分别影响 executionReady" | 改为进程（容器环境含容器）；Docker 只在项目声明容器环境时影响该环境可用性，不阻断编码路径与需求池查看 | 同上 |
| `agents.md` §1 | Review 独立性只由 Run/Session/输入/权限保证（未说明执行底座） | 追加"默认在宿主执行；容器只是可选运行环境，不承载工具调用，也不是角色准入前提" | 明确角色规则不再依赖容器 |
| `workflow.md` §2 | 未说明审批范围 | 追加"已批准范围内直接执行，只有不可逆操作需要用户明确批准" | 审批只用于不可逆操作 |
| `experience.md` §5 | "Permission 显示操作、目标、期限和影响"；Automatic/DecisionRequired 含"超权限" | 改为 Permission 只用于不可逆操作；DecisionRequired 用"不可逆操作"替换"超权限" | 用户可见的打断点收窄 |
| `PRODUCT.md` §6 | "Workspace/Autonomous/Full Access 执行模式" | 改为"宿主优先执行（容器为项目可选运行环境）与显式 Full Access 模式" | 产品面口径 |
| `ARCHITECTURE.md` §1/§6 | §6 称 execution.md 为"平台、工具隔离……测试环境" | §1 加"默认宿主执行，容器可选"；§6 描述改为"工具边界与守卫、可选容器环境" | 架构总览一致 |
| `installation.md` §1 | "Docker 提供执行隔离（无 Docker 不回落宿主执行）"；doctor 把 Docker 当就绪条件 | 改为"Docker 不是前置条件；只有项目选择容器运行时才需要"；doctor"在可用时报告 Docker" | 安装前提 |
| `implementation.md` WP-00/WP-07/§3 | "固定执行镜像"、只读挂载负例、"容器/宿主模式、网络代理、隔离 DB/端口"、"无 Docker 拒绝"、"test:integration 含容器" | 降级为可选项与"项目声明容器环境时另验"；删除"无 Docker 拒绝" | 交付计划不再把隔离设为必验项；AC 映射未改 |
| `INDEX.md` §实现起点 | WP-00/06/07 的"容器隔离负例""无 Docker 绝不回退""含真实容器"等 | **不改写**；只在索引末尾加"执行模型修订"注，指向本文 | 记录是历史 |
| `data.md` §3 `Env` | "命令实际运行的**容器镜像**与 Runner 描述串同时写入 result" | 改为"命令实际运行的**环境**（宿主，或项目声明的容器镜像）" | 命令默认在宿主运行，容器只是可选环境 |
| `.agentdev/work/WP-12/settlement.md` §5 | "第 2 期：容器化 Runner 与每 Task 工作区" | **不改写**；加一段注：该目标不再成立 | 记录是历史 |

## 3. (b) 有意保留的内容及原因

- **Task worktree/分支、单写者与写租约**：多任务并发不互写、"工作区内删除不触及其他 Task"的兜底仍然成立（`execution.md` §3、`reliability.md` §3）。
- **交付 CAS**：交付分支 ref 变更只由 Workspace 服务以 expected-old CAS 完成；Agent 自行 `git push`/`update-ref` 是硬拒（`reliability.md` §4/§9）。
- **读账本（read ledger）、Context ACL、Snapshot**：独立验证与可追溯的读取依据，与执行底座无关。
- **预算与公平调度、按角色的工具集、审计事件**（`tool.invoked`/`tool.refused`/`tool.listed_file_allowed`/`chief_action_required`/`chief.todo_resolved`）：全部保留，未改事件名与字段。
- **凭据形态文件冻结表与 `configPolicy: strict|test`**：作为硬拒清单的执行机制保留。
- **网络两个固定拒绝项**（守护实际绑定端口、云元数据地址）：保留；但明确"宿主模式下是识别与审计，不是出口控制，裸 socket 可绕过"，残余风险登记在附录 A.5。
- **不可逆操作的 `once`+`inputHash` 绑定与 `permission.request` 方法**：保留（不新增、不删除协议方法），但不再出现在常规编码路径。
- **可选容器环境**：保留为项目选择；项目声明容器时其加固与网络由项目决定。

## 4. (c) AC 解释影响清单（**等待产品负责人确认**；未改动 `docs/delivery/acceptance.md` 任何文字）

| AC | 现行文字里受影响的子句 | 新模型下的解释 |
|---|---|---|
| AC-033 独立审核 | 证据："ACL 及**容器**负例" | 独立性证据改为 ACL/上下文 + 工具集负例（聊天对独立角色不可访问、路径边界外读取被拒）；不再要求容器挂载级负例。 |
| AC-034 跨项目隔离 | 证据："API 及**挂载**负例" | 改为 API/ACL 负例（跨 Project 的 SourceRef/Artifact/token 被拒）；不再要求容器挂载负例。 |
| AC-048 Workspace 边界 | "Given **无Docker**或目录/网络越权；Then **缺环境拒绝**；**容器**及 Broker 阻止越权，源码只读者不可写" | 无 Docker **不**构成拒绝；边界证据改为：信外路径/敏感文件/硬拦项被类型化拒绝，只读角色通过工具集与路径边界不可写。 |
| AC-049 Autonomous 范围 | "Then 范围内继续，**超范围权限决定**；过期 Grant 无效" | "范围内继续"不变；"超范围权限决定"改为"超范围被拒绝/交 Chief；只有不可逆操作才产生用户批准"。 |
| AC-050 Full Access 门禁 | "Then 领域 Gate 保留，**Review/Test 仍隔离**" | "隔离"按独立 Run/Session/输入/工具集 + 路径边界解释，不再指容器隔离。 |
| AC-080 授权精确绑定（次要） | once 绑定 operation/inputHash、原子消费 | 机制保留、判定不变；但 once 只由不可逆操作产生，测试场景相应收窄。 |

另需注意（非 AC 文字）：`acceptance.md` §3 测试层把"容器"列为集成层组成部分，并引用"无 Docker 拒绝"的实现；该句不在 AC 定义内，但确认 §4 清单时应一并决定是否重述。

## 5. (d) 代码仍实现旧模型、与修订后文档不一致之处（= 后续工作）

以下均在 `packages/**`、`apps/**`、`tests` 内，本次**未改动**（文档Agent不碰源码/测试/脚本）。按精确位置列出：

1. **默认执行底座仍是"按 permissionMode 选容器"**：`apps/daemon/src/main.ts:460` 调用 `executionModeForPermissionMode(permissionMode)`；`apps/daemon/src/tool-handler.ts:195-199` 返回 `workspace/autonomous → 'container'`、`full_access → 'host'`。文档现在要求默认宿主。
2. **Review/Test 被固定钉在容器**：`apps/daemon/src/tool-handler.ts:589-593`（`callIsReadOnly(caller.role) ? 'container' : policyMode`），注释仍写 "Review and Test use the isolated container in **every** mode"。文档现在要求独立性来自 Run/Session/输入/工具集。
3. **无 Docker 即拒绝容器调用且不回退宿主**：`packages/core/src/broker.ts:2595-2605`（`mode==='container'` 且 Docker 不可用 ⇒ `PROVIDER_UNAVAILABLE`，"does not fall back to host execution"）。相关断言：`packages/core/test/broker.test.ts:619`（"No Docker (required failure test)"）、`packages/core/test/permissions-failures.test.ts:636-649`。文档现在要求缺 Docker 不构成拒绝。
4. **声明式 Test 命令被钉在容器**：`packages/core/src/broker.ts:2389/2395/2403`（`runDeclaredTestCommand` 固定 `mode:'container'`），由 `packages/core/src/execution.ts:598-650` 调用。文档现在要求默认在冻结工作目录宿主执行，仅当项目声明容器环境时用容器。
5. **受控出口/sidecar 仍是唯一的容器出口路径**：`apps/daemon/src/egress.ts`、`packages/core/src/egress.ts`、`packages/core/src/egress-channel.ts`；`packages/core/src/broker.ts:2621` 的 `networkCovered` 容器分支。文档现在把容器出口降为可选容器环境的一部分，宿主默认用宿主网络 + 准入层守卫与审计。
6. **doctor 把 Docker 缺失当就绪阻断**：`apps/cli/src/doctor.ts:403`（探测）、`:423-425`（docker 状态/镜像缺失进 `blockers`）、`:445`（`executionReady: blockers.length === 0`）。文档现在要求 Docker 只作报告，不影响编码路径就绪。
7. **`bash`/`network`/`secret` 仍按"逐次审批类环境操作"**：`packages/core/src/permissions.ts:81-91` 的 `PERMISSION_OPERATIONS`（`bash`/`network`/`secret`/`push`/`deploy`/`delete_data`）；镜像常量见 `packages/core/src/orchestrator.ts:281-288` 与 `packages/domain/src/routing.ts:164`（`ENVIRONMENT_OPERATIONS`）。文档现在只要求 `push`/`deploy`/`delete_data`（及交付推送）需批准。
8. **测试仍断言旧模型**（修代码时需一并改）：`apps/daemon/test/tool-handler.integration.test.ts:728-730`（断言 workspace/autonomous ⇒ container）、`packages/core/test/tool-http.integration.test.ts:520-533`（真实容器跑 `mode:'container'`）、`packages/core/test/broker.integration.test.ts:606,695,705`、`apps/cli/test/container.integration.test.ts`。
9. **兼容、无需改**：`apps/runner/src/environment.ts`/`control-client.ts` 的 `environmentRef`（`host:…`/`container:…`）与修订后的 `execution.md` §5、`data.md` `Env` 一致。

建议的后续切片顺序：先 3/5/6（拆掉"缺 Docker 即拒绝"与 doctor 阻断）→ 再 1/2（把默认与 Review/Test 切到宿主，容器改为按项目声明）→ 再 4（声明式 Test 命令走宿主）→ 再 7（审批面收窄）→ 最后统一改测试（8）。AC 文本按 §4 确认后再动。

## 6. 旧措辞 grep 结果（本轮要求）

- `--network none`：**0 处**（已从全部 `docs/**` 删除；仅存在于源码与历史记录）。
- `必须容器`/`容器隔离`/`容器化 Runner`/`隔离容器`：仅 `INDEX.md` 工作包历史与 `execution.md` §1 对"旧规则不再成立"的显式说明；历史不改写。
- `无 Docker`/`缺Docker`/`不回落`/`绝不回退`：`execution.md` §1 仅用于否定（"没有缺环境即拒绝准入"）；`INDEX.md` 历史；**`acceptance.md:305`（AC-048）按要求未改**。
- `TestEnvironmentManager`：仅 `execution.md` §5，已重写为"默认宿主下适用、容器风格由项目自理"。
- `每次工具调用`：`execution.md` §3/§7 与 `reliability.md` §3 指 **Work 级写租约续期**（保留的机制，不是容器）；`execution.md` §1 另有"绝不作为每次工具调用的要求"的新口径。
- `per-call container`：0 处。

## 7. 验证

- `pnpm docs:check`：通过（见交付报告）。
- 未改动：`docs/delivery/acceptance.md`（AC 文字零改动）、`packages/**`、`apps/**`、`tests/**`、`scripts/**`。
