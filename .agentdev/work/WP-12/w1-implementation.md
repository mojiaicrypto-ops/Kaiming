# WP-12 W1 实施记录：第一期权限模型（permission phase 1）

- 状态：Developing（实现 + 真实 drill 已完成；等待独立 Review/Test）
- 依据：`.agentdev/work/WP-12/T3-implementation.md` **附录 A**（A.1–A.8，已冻结）、`.agentdev/work/WP-12/product-completion-plan.md` §3（W1a/W1b 拆分）与 §5（单一写者、无迁移/无表列、每流独立 Review+Test）。
- 本轮把 W1a（`strict` 落地）与 W1b（`configPolicy` 档位小增量）**一并**落地，因为两者共用同一张表与同一个配置模型，分开做会先写一遍再改一遍。
- 边界声明：`apps/web/**`、`packages/workspace/**`、`packages/core/src/{integrate,settlement,task-candidate}.ts`、`docs/delivery/**`、`docs/product/**` **未改动**；无新运行时依赖；无迁移、无表列。

---

## 1. 变更清单（文件 → 改了什么）

| 文件 | 变更 |
|---|---|
| `packages/contracts/src/enums.ts` | 新增 `configPolicySchema = z.enum(['strict','test'])` + `ConfigPolicy`（无 `open` 档） |
| `packages/contracts/src/entities/structures.ts` | `configPatchSchema.configPolicy?`（与 `permissionMode` 同一 ConfigPatch 面，不新增协议方法）；`policyConfigSchema.configPolicy`（策略文档内，随 `policyHash` 与 Run 的 `policy` 上下文冻结） |
| `packages/core/src/config.ts` | `DEFAULT_POLICY.configPolicy='strict'`（全局默认）；TOML 读写含 `configPolicy`；`update()` 支持 patch；`normalizePolicyTier()` 把旧 `config.toml`（无该键）按 `strict` 归一，不静默改文件 |
| `packages/core/src/permissions.ts` | **冻结敏感文件表** `SENSITIVE_FILE_PATTERNS`（A.2 全表）、`APPLICATION_CONFIG_PATTERNS`（A.7 子集）、`matchSensitiveFile()`（basename/路径两套匹配、`*` 不跨 `/`）、`decideSensitiveAccess(path, tier)`、`sensitiveFileRefusalMessage()`（含"不要重试"）、`SENSITIVE_FILE_TODO_KIND='sensitive_file'` |
| `packages/core/src/tools.ts` | 准入层新增：`sensitiveGate()`（read/search/edit/**write** 共用一处，A.2/A.3）；`shellUrlLiterals()` + `shellDeleteTarget()` + `isInsideWorkspace()`；`bash` 的工作区外删除守卫、Git 引用守卫文案补"不要重试"；`ToolPlanRefusal`（新增 `approvable`/`sensitive`/`refusalPaths`）；`runSearchTool` 遍历时按档位跳过清单文件（"search 不同表生效等于没拦"）；`ToolPlanCode` 扩到含 `CONTEXT_FORBIDDEN` |
| `packages/core/src/broker.ts` | `ToolInvocation.configPolicy?`、`ToolContext.sensitiveTier`（搜索遍历用），默认 `strict` |
| `packages/core/src/tool-http.ts` | **缺陷修复**：`handleToolExecute` 的 `ProtocolError` 分支此前**丢弃 `details`**，`errorBody(code,message,error.details)` 补齐——否则 Runner 拿不到 `approvable`，类型化拒绝无法区分"可批准"与"终局" |
| `apps/daemon/src/tool-handler.ts` | `ToolHandlerOptions.configPolicy/policyRevision`（默认 `strict`/`0`）；`planToolCall` 传档位；敏感文件拒绝 **落 `chief_action_required(kind='sensitive_file')` 用户待办**（按 `(work,path,pattern)` 幂等）并继续；`bash` 字面 URL 交 `broker.networkPolicy().decide()` 判定（环回/私网/元数据 → `CONTEXT_FORBIDDEN` + `approvable:false`）；broker 调用带 `configPolicy`；**`writableRoots:[root]`（非只读角色）**；`test` 档放行写 `tool.listed_file_allowed` 审计（path/pattern/operation/configPolicy/policyRevision）；所有拒绝详情带 `approvable` |
| `apps/daemon/src/main.ts` | 从项目策略读 `configPolicy` 与 `policyRevision` 传入 handler（与 `permissionMode` 同处、同模型） |
| `apps/runner/src/tool-client.ts` | **退掉正常路径的逐次审批**：`errorOf()` 读 `details.approvable`；`execute()` 仅在 `NOT_AUTHORIZED` **且 `approvable !== false`** 时才 POST `permission.request`，硬拦直接把类型化拒绝交给模型（模块头注释同步改写） |
| `apps/cli/src/doctor.ts` | `PolicyProbe` + `probePolicy()`；报告新增 `policy` 行：`configPolicy` 值 + 来源（project/global/default）；非 `strict` 以 `WARN` 开头并写明"本项目允许读取应用配置…"；项目配置不可读时打印文件名与原因而非默认值 |
| 测试 | `packages/core/test/permissions-bridge.test.ts`（+5 表/档位用例，20 passed）；`packages/core/test/tools.test.ts`（+8 准入守卫用例，24 passed）；`apps/runner/test/tool-client.test.ts`（+1 硬拦不触发审批，17 passed）；`apps/daemon/test/tool-handler.integration.test.ts`（**+9 W1 纵向 drill**，30 passed）；`apps/cli/test/doctor.integration.test.ts`（+3 档位可见性，12 passed） |
| 文档 | `docs/architecture/execution.md`（§2 第一期权限语义三条硬拦 + 档位；§7 工具/权限边界落点与两个审计事件）；`docs/architecture/protocol.md`（§4 permission 第一期语义、§5 ConfigPatch 允许 `configPolicy`、§7 事件表 + `details` 说明 + 错误表）；`docs/operations/installation.md`（doctor 的 `policy` 行与档位可见性） |

### 1.1 与声明范围的偏差（如实登记）

- `packages/contracts/src/{enums,entities/structures}.ts` 与 `packages/core/src/config.ts` 不在任务书列出的文件清单里，但 `configPolicy` 要求"与 `permissionMode` 同一处配置模型、全局默认 + 项目覆盖、随 Run 冻结、仅人可设"，这只能落在策略文档与 ConfigStore 上。三个文件都只做了**加字段**的最小改动（无迁移、无表列），且当前无其他车道在制（树干净、十条契约命令全过）。
- `packages/core/src/tool-http.ts` 的 `details` 修复同样在清单外，但清单内的 `apps/runner/src/tool-client.ts` 依赖它：不修则 `approvable` 永远到不了 Runner，本切片的"退掉逐次审批"无法成立。
- `packages/core/src/broker.ts` 在清单内，只加了两个可选字段与一处 `sensitiveTier` 赋值。

---

## 2. 新语义 / 退掉的语义

### 2.1 现在自动放行（Plan/授权时信封内，**零提示**）

`read` / `search` / `edit` / `write` / `artifact_write` / `bash` / `git`，路径在 Work 授权（`scope.readPaths/writePaths`）内即直接执行：端点 → handler → Broker → 真实文件/进程。审计保留（`tool.invoked`、`tool_operation`、读账本）。**"零提示"的可观测判据**：没有 `decision.created`、没有 `permission.resolved`、Run 不进 `waiting_permission`（drill 逐条断言）。

### 2.2 三条硬拦（类型化拒绝、`approvable:false`、不悬挂）

| 硬拦 | 码 | 用户面 | 审计 |
|---|---|---|---|
| 敏感文件（A.2 全表）的 read/search/edit/write | `CONTEXT_FORBIDDEN` | `chief_action_required(kind='sensitive_file')` 待办，Run 继续 | 端点 `tool.refused` |
| `bash` 字面 URL 命中环回/私网/链路本地/CGNAT/元数据 | `CONTEXT_FORBIDDEN` | 无（终局） | 端点 `tool.refused` |
| 工作区外删除；Git 引用变更（push/reset/update-ref，含 `bash` 拼写） | `NOT_AUTHORIZED` | 无（终局） | 端点 `tool.refused` |

三条的拒绝文案都写明"**不要重试**"；敏感文件那条另写明"请你本人处理"。Runner 侧 `approvable === false` 时**不**POST `permission.request`。

### 2.3 `configPolicy` 档位

- `strict`（全局默认）：A.2 全表拒绝。
- `test`：额外放行 `application*.yml|properties`、`bootstrap*.yml|properties`、`*.properties`、`*.conf`；**凭据档（`.env*`/`.netrc`/`.npmrc`/`.pypirc`/`.pgpass`/`.my.cnf`/`.docker/config.json`/`kubeconfig`/`.aws/**`/`.ssh/**`/`.vault-token`/`.terraformrc`/`*.tfvars`）与纯密钥材料（`*.pem`/`*.key`/`*.p12`/`*.pfx`/`*.jks`/`id_rsa*`/`id_ed25519*`）仍拒**。
- 生效面：全局默认 `strict` → 项目覆盖（`<git-root>/.agentdev/config.toml` `[policy] configPolicy`）→ daemon 装配时读入 handler；值进 `policyHash` 与 Run 的 `policy` 上下文（不新增列、不新增方法）。**agent 无入口**。
- 可见性：`doctor` 的 `policy` 行（非 `strict` 为 `WARN` + 中文说明）、`config.get` 的 `policy`（项目设置页已渲染整个 policy 对象）、验收报告（`policyHash` 随 `VerificationManifest` 绑定）。
- 放行审计：`tool.listed_file_allowed`（`path`/`pattern`/`operation`/`configPolicy`/`policyRevision`）。

### 2.4 退掉（代码保留、策略不再触发）

逐次 `permission.request` → `waiting_permission` → `permission.respond` → `once`+`inputHash` 放行这一整套**仍在码内**（`permissions.ts`、`protocol.ts`、端点、WebUI 按钮都未删），但常规流程不再走到它：信封内操作有 Grant；硬拦是终局；只有"环境操作且 `approvable !== false`"才会请求审批。回滚 = 把策略切回逐次审批（代码在），符合 product-completion-plan §6。

**保留**：角色工具面隔离、类型化拒绝、审计事件、读账本、预算上限、容器执行（A.4 的"保留"清单，逐项未动）。

---

## 3. 验收口径变更（**明确记录**：AC 文本未改）

- **AC-049「Autonomous范围」**："范围内继续，超范围权限决定"照旧成立，但"范围"的解释固定为 **Plan/授权时授予的信封（路径 + 操作）**：信封内**直接执行、不再逐次询问**；"超范围"仍由 Grant/readScope/Plan 门拒绝。原先把"超范围=一次权限决定"读成"每次环境操作都要一次决定"，第一期不再这样读。证据形状从"申请→批准→放行"变为"**信封内零提示执行 + 终局拒绝**"。
- **AC-048「Workspace边界」**："目录/网络越权"的证据改为四类可观测拒绝：**越信封**（`CONTEXT_FORBIDDEN`/`NOT_AUTHORIZED`/`GATE_NOT_READY`）、**私网/环回/元数据**（`CONTEXT_FORBIDDEN`）、**敏感文件读**（`CONTEXT_FORBIDDEN` + 用户待办）、**工作区外删除/Git 引用变更**（`NOT_AUTHORIZED`）。AC 文本一字未改，改的是解释与证据映射；`docs/delivery/acceptance.md` 按工作流归 Settlement，本切片未改。
- 独立证据入口不变：drill 用例题名带 `AC-048`/`AC-049`，验收器按 Vitest `fullName` 映射（`scripts/lib/acceptance-evidence.mjs`）。**`scripts/lib/drill-acs.mjs` 未改且不应改**：该文件只登记 UNVERIFIED/MISSING 的已接受缺口，为 AC-048/049 追加条目会把已 PASS 的 AC 降级。

---

## 4. 原始证据（真实命令与结果）

### 4.1 定向 drill（W1，真实 SQLite + 真实工作区 + 真实 Broker/Grant + 真实端点 + 真实容器）

`pnpm exec vitest run --project integration apps/daemon/test/tool-handler.integration.test.ts` → **30 passed**，其中新 `first-phase permission model (附录 A)` 9 例：

| 用例 | 真实断言 |
|---|---|
| 敏感文件 read 被拒 | HTTP 403 `CONTEXT_FORBIDDEN`；`details.approvable=false`、`pattern='.env*'`、`path='.env'`；`chief_action_required(kind='sensitive_file')` 1 条含 path/pattern/action/configPolicy=strict/policyRevision=7；端点 `tool.refused` 1 条（`layer='endpoint'`），其 JSON **不含** `.env` 内容；`tool_operation` 0 行 |
| 敏感文件 search + edit 被拒 | 两例 `CONTEXT_FORBIDDEN`、`details.action` 分别为 `search`/`edit`；`.env` 文件内容未被改写；三次拒绝只落 **1 条**待办（幂等） |
| 环回/元数据被拒 | `curl http://127.0.0.1:51234/...` 与 `curl http://169.254.169.254/...` 各 403 `CONTEXT_FORBIDDEN`、`approvable=false`、`details.network` 为原 URL、消息含 `loopback`；2 条 `tool.refused`；`tool_operation` 0 行 |
| 工作区外删除 | `rm -f <tmpdir>/...` → 401 `NOT_AUTHORIZED`，消息含"do not retry"与目标路径；工作区内 `rm -rf build` 真实执行（stdout 含 `removed`） |
| 信封内零提示 | 真实 `read`（返回真实文件内容）+ 真实 `bash`（stdout `in-envelope-ok`）均 200；`decisions` 仅 1 行（夹具预置）；Run 仍 `running`；事件名含 `tool.invoked`，**不含** `decision.created`/`permission.resolved` |
| 信外写 fail-closed | `write` → 409 `GATE_NOT_READY`，文件内容不变，无新决定、Run 仍 `running` |
| `test` 档放行 + 审计 | 同文件 `strict` 403、`test` 200 且返回真实配置内容（`port: 8080`）；`tool.listed_file_allowed` 1 条含 `path='src/application.yml'`、`pattern='application*.yml'`、`configPolicy='test'`、`policyRevision=7` |
| **真实容器**信封内写 | `mode='container'` + `writableRoots:[root]`，真实 `agentdev/exec:0.0.0`：容器内 `printf … > src/from-container.txt && cat` → `status=0`、stdout `in-container`，宿主挂载目录真实出现该文件；`planContainerRun` 断言 mounts 仅 `[workspace → /workspace:rw]`、`--network none`、`--user 10001:10001`、`--read-only` |

### 4.2 全量门禁（串行，无并发写者）

| 命令 | 退出码 | 结果 |
|---|---|---|
| `pnpm typecheck` | 0 | 无诊断 |
| `pnpm lint` | 0 | `All matched files use Prettier code style!`，0 error |
| `pnpm test:unit` | 0 | `Test Files 77 passed (77)`、`Tests 1446 passed (1446)`，16.99s |
| `pnpm test:integration` | 0 | `Test Files 56 passed (56)`、`Tests 534 passed (534)`，223.87s（真实 Git/进程/Docker/daemon；含上面的真实容器例） |
| `pnpm docs:check` | 0 | `16 documents, 67 internal links, 94 acceptance cases, 9 requirements, 11 work packages` |
| `node scripts/e2e.mjs` | 0 | `26 checks — PASS 25 / FAIL 0 / UNVERIFIED 1`（唯一 UNVERIFIED 为 `provider.fact-and-unknown`，条件 `provider-absent`）；`31 ACs accounted for by the drill` |
| `node scripts/acceptance.mjs` | **0** | **`acceptance: 94/94 ACs accounted — PASS 94 / ACCEPTED 0 / FAIL 0 / MISSING 0`**；`acceptance: OK — every AC is PASS or a registered, condition-checked accepted gap` |

**本轮全量 integration 首跑的一条红已定性为负载型 flake（非本切片）**：`apps/cli/test/ops.integration.test.ts` 的 `refuses a restore whose target already holds an active Project` 在首跑全量时 `agentdev start` 返回 1，单文件复跑 1/1 通过、随后全量复跑 56/56 全绿。已登记的同类抖动见 `T3-implementation.md` §6.2（并发/负载下的真实进程探针 flake）。

### 4.3 验收报告的新行（形状未变）

`AC-048` / `AC-049` 仍为 `PASS / test-name`，证据文件列表新增/更新为 `apps/daemon/test/tool-handler.integration.test.ts`（W1 drill 9 例，题名带 AC）与 `packages/core/test/{permissions-bridge,tools}.test.ts`、`apps/runner/test/tool-client.test.ts`。**没有任何 AC 变成 UNVERIFIED/MISSING/ACCEPTED**，因此 `drill-acs.mjs` 无新增；`94/94 — PASS 94 / ACCEPTED 0 / FAIL 0 / MISSING 0` 逐字保持。

---

## 5. 前提诚实性（A.4 的"不能省"逐条核对）

| 前提 | 现状 | 结论 |
|---|---|---|
| 工具在容器内 | `executionModeForPermissionMode`：`workspace`/`autonomous` → container，Review/Test **任何模式**都钉 container；无 Docker → `PROVIDER_UNAVAILABLE` **不降级宿主** | ✅ 满足（真实容器例已跑） |
| 只挂工作区 | `planContainerRun` 只挂 caller roots + report roots；drill 断言 mounts 恰为 `[workspace]` | ✅ 满足 |
| 非 root | `--user 10001:10001` | ✅ 满足 |
| 无宿主 home / 无 docker socket / 无守护数据目录 | 计划里不存在这些挂载；数据目录被 `deriveProtectedPaths` 保护而非挂载 | ✅ 满足 |
| **Runner 本身是否入容器** | **否**，Runner 是宿主 Node 进程（`runner-spawn.ts`），只有工具在容器内 | A.4 明确"Runner 是否入容器属第二期加固"，本切片不在其列 |

**结论：A.4 的五条硬前提在 `workspace`/`autonomous` 模式下成立，本切片没有以任何方式放宽它们。**

**但发现并修复了一处会破坏"工具在容器内也能干活"的装配缺口（原先未登记）**：`apps/daemon/src/tool-handler.ts` 从不传 `writableRoots`，于是容器模式下工作区被挂成 `ro`，Developer 的 `write`/`edit` 会以 `INTERNAL_ERROR` 失败（写不进只读挂载）。现在对**非只读角色**传 `writableRoots:[root]`；Review/Test 仍无源码可写根（它们只能写 report/scratch 根）。这是"容器内真实执行"的前提，不修则本切片的"信封内写"只能靠宿主模式成立。

---

## 6. 残余风险（规格要求如实登记）

1. **删工作区内未提交内容会真丢**（A.5-3）：工作区删除被允许，兜底是 Git + 每任务工作区 + 交付 CAS；三者都覆盖不到的未提交内容无法恢复。**当前每 Task 工作区未接线**（Q-T3-8=A，所有 Run 用项目根），因此"兜底"里的第二层目前不成立，实际只有 Git 与交付 CAS。这是 W1 相关的真实放大项，归属 T10。
2. **`test` 档 = 仓库内容可读 + 网络开**（A.5-1/2、A.7 末段）：`application*`/`bootstrap*`/`properties`/`conf` 可读可搜可改，配置里若内嵌凭据即可被读出并（在网络可达时）外传；提示注入亦可诱导把可读内容发往公网。无法归零，靠"非 `strict` 显著标记 + 每次放行审计"事后识别。
3. **拒绝必须告知模型不要重试**（A.5-4）：三类硬拦的文案都写了，但模型仍可能换个拼写重试；同一文件的待办按 `(work,path,pattern)` 幂等，重试不会堆待办，也不会改变结论。
4. **`bash` 内的网络与删除是"字面扫描 + 容器边界"，不是解析器**：只有 `http(s)://…` 字面量走 `NetworkPolicy`；拼接出来的目标在容器 `--network none`（无代理时）下仍不可达，但这条保障来自容器而不是准入层。删除守卫只看第一个非选项参数上的绝对路径；`find … -delete`、脚本内 `rm` 等拼写不在其列（容器/宿主根边界仍是最终约束）。
5. **网络"开"只完成了一半**：A.1-1 要求默认允许公网出网，但当前容器 `--network none`、且 daemon 未配置 Core 受控代理（`networkProxy` 未设），因此**容器内的公网出网实际上被拒**（`PROVIDER_UNAVAILABLE`）。本切片交付的是"硬拦正确"，不是"公网可用"；后者需要容器内 Unix-socket 代理（W6/T10）。宿主 `full_access` 模式下网络由其账户决定，准入层只拦字面环回/私网/元数据。
6. **`configPolicy` 的"随 Run 冻结"是策略文档级，不是 config 快照级**：`ConfigStore.freeze` 只冻结 profile/provider/model，**不含 policy**（既有事实，非本切片引入）。档位进入 `policyHash` 与 Run 的 `policy` 上下文，daemon 在装配时读一次；运行中改项目配置不改已开项目的 handler 行为，直到 reopen/重启。若要"每个 Run 独立冻结档位"，需要把 policy 纳入 config 快照（牵涉 `config.ts`/`orchestrator.ts`，本切片不做）。
7. **`bash`/`git` 的读取不进读账本**：既有缺口，不变；敏感文件守卫在准入层、与账本无关。
8. **`test` 档放行也适用于 `write`/`edit`**：A.7 只写"可读/可搜/可编辑"，实现对 `write` 也放行（新建同族文件）。若产品要求 `test` 档只读不放写，需要一次产品决定。

---

## 7. 未做 / 留待

- **`apps/web/**` 未改**（任务书要求）：设置页已能显示 `policy.configPolicy`（`views.ts` 透传整个 policy 对象），但"敏感文件请你本人处理"待办的专门渲染面属 W2/T4。
- **`docs/delivery/acceptance.md` 未改**：AC-048/049 的解释变更按工作流归 Settlement 统一登记；本记录 §3 已把解释与证据映射写清楚。
- **`scripts/**` 未改**：`drill-acs.mjs` 无新增（理由见 §3），e2e/acceptance 的 JSON 由脚本自身刷新。
- **A.8 三条二期备选（Core 侧恢复审批、特权操作声明式化、凭据代理注入）未实现**，本切片不新增设计提案。
- **`open` 档、"环境类型"字段、打码/掩码档**：按 A.3/A.7 **刻意不做**。
- **真实 Provider 纵向演练（`pnpm test:live`）未跑**：需持钥者 Provider；与 W1 的证据链无关（W1 证据全部落在真实 daemon/Broker/容器上，不依赖模型）。

## 8. 交还声明

- 本切片改动的全部文件（§1）**无进一步改动计划**，可交还；`tool-handler.ts`/`main.ts`/`tool-client.ts`/`doctor.ts` 的下一个写者可直接接手。
- 若 Review 判定 §1.1 的三个清单外文件必须回退，**最小回退集**是 `packages/contracts/src/{enums,entities/structures}.ts` + `packages/core/src/config.ts`（档位落回代码内硬编码默认 `strict`，代价是失去"项目级覆盖 + 可见性"），`tool-http.ts` 的 `details` 修复无法回退——回退后类型化拒绝不可达 Runner。
