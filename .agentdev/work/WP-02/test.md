# WP-02 独立 Test 报告（主管与独立Agent调度）

- 测试对象：工作包 WP-02「主管与独立Agent调度」
- 冻结提交：`17dfe264114aa61bc177f12e096e5abbd0ef30e0`（`docs(review): WP-02 independent review report, round 17 (PASS)`）
- 测试角色：**Test**（独立上下文；未读取任何开发对话或 Review 会话，只依据仓库中被冻结的文件、我自己的实验脚本与命令原始输出）
- 测试方法：在 `/tmp/wp02test/` 自建夹具与 5 组实验脚本（`lib.mjs`、`exp1..exp5.mjs`、两个探针），全部通过软链解析 `pnpm build` 产出的 `packages/*/dist`；**不 import 任何产品测试文件**，**未修改仓库任何文件**（唯一写入为本报告 `.agentdev/work/WP-02/test.md`）
- 环境：`node v24.8.0`、`pnpm 12.3.4`、macOS（Darwin，宿主执行）；真实 SQLite（`ProjectStore`）+ 真实 `config.toml` 文件 + 内容寻址快照 + 注入式 stub transport（无真实网络）
- 权威依据：`docs/delivery/acceptance.md`（AC-043/044/045/046/047/082 原文）、`docs/delivery/implementation.md`（§2 WP-02、§3 工程检查命令、§4 完成证据）、`AGENTS.md`、`docs/rules/{workflow,agents}.md`、`.agentdev/work/WP-02/{plan,discovery,implementation,review}.md`、`packages/contracts/src/**`（Schema 原文）、`packages/core/src/**`（被测量实现）

---

## 1. 结论摘要

| AC | 题目 | 正向 | 负向 | 结论 |
|---|---|---|---|---|
| AC-043 | 独立模型 | 通过 | 通过 | **不通过**（存在 1 个阻断缺陷 T-01） |
| AC-044 | 配置冻结 | 通过 | 通过 | **通过** |
| AC-045 | 主控分派（含权限负例） | 通过 | 通过 | **通过** |
| AC-046 | Join 和失败 | 通过 | 通过 | **通过** |
| AC-047 | 结构化交付（口头完成与两次 Schema 错误） | 通过 | 通过 | **通过** |
| AC-082 | 重启保留窄范围 | 部分通过 | 部分未覆盖 | **通过**（工具层负例 UNVERIFIED，归 WP-07） |

**Test 判定：FAIL（不接受 WP-02 的 AC-043）**

- 自建实验断言：`exp1` 13/13、`exp2` 6/6、`exp3` 16/16、`exp4` 9/9、`exp5` 7/7，合计 **51 条断言 0 失败**（其中 `exp2` 全部用于固定 T-01 缺陷）。
- 契约命令：`typecheck`、`lint`、`test:unit`、`test:integration`、`docs:check`、`build` 全部退出 0。
- 唯一阻断问题：**T-01（P1）未配置 `secretRef` 的 Provider 无法完成任何模型调用**——`ConfigStore.freeze` 把缺省的 `secretRef` 冻结为 JSON `null`，`ModelGateway.complete` 随即以 `CONFIG_INVALID: secret null is not available` 拒绝该 Run 的每一次调用。产品测试全部使用带 `secretRef` 的 Provider，因此 251 单测 / 124 集成全绿仍未覆盖此路径。
- 另有 2 条 P3 观察（不影响判定）：`resolve` 与 `dispatch` 对「模型不支持该 reasoning」返回不同错误码；`frozenProfileOf` 对「快照缺失」抛 `STALE_ARTIFACT` 而非 `NOT_FOUND`。

---

## 2. 测试环境与复现方式

```text
export PATH="$HOME/.local/bin:$PATH"
mkdir -p /tmp/wp02test/node_modules/@agentdev
for p in contracts domain storage core pi-runtime; do
  ln -sfn /Users/huyaohua/huyh/work/aigrouptool/packages/$p /tmp/wp02test/node_modules/@agentdev/$p
done
cd /Users/huyaohua/huyh/work/aigrouptool && pnpm build      # 实验只消费 dist
cd /tmp/wp02test && node exp1.mjs && node exp2.mjs && node exp3.mjs && node exp4.mjs && node exp5.mjs
```

脚本清单（全部由 Test 自建，与产品测试无关）：

| 脚本 | 覆盖 | 结果 |
|---|---|---|
| `/tmp/wp02test/lib.mjs` | 世界夹具：独立临时目录 + 真实 SQLite + 真实 config.toml + 快照 + stub transport；`reopen()` 模拟 daemon 重启 | 基础设施 |
| `/tmp/wp02test/exp1.mjs` | AC-043 正/负、AC-044 配置版本与冻结 | 13 passed / 0 failed |
| `/tmp/wp02test/exp2.mjs` | T-01 缺陷隔离（无 `secretRef` 的 Provider）+ 对照组 | 6 passed / 0 failed |
| `/tmp/wp02test/exp3.mjs` | AC-045 分派与权限负例、AC-046 Join 与局部失败 | 16 passed / 0 failed |
| `/tmp/wp02test/exp4.mjs` | AC-047 结构化交付正/负例 | 9 passed / 0 failed |
| `/tmp/wp02test/exp5.mjs` | AC-082 窄范围与重启、AC-047 重启后两击计数 | 7 passed / 0 failed |
| `/tmp/wp02test/probe-secret.mjs`、`probe-testconn.mjs`、`probe-reject.mjs` | T-01 根因探针、`provider.test` 对照、事件形状探针 | 见 §5 |

原始日志：`/tmp/wp02test/{exp1,exp2,exp3,exp4,exp5}.log`、`/tmp/wp02test-unit.log`、`/tmp/wp02test-integration.log`、`/tmp/wp02test-lint-docs-build.log`。

---

## 3. 契约命令原始结果（在冻结提交上实跑）

| 命令 | 退出码 | 原始结果要点 |
|---|---|---|
| `pnpm typecheck` | **0** | `tsc -p tsconfig.json --pretty false`，无输出 |
| `pnpm lint` | **0** | `Checking formatting...` / `All matched files use Prettier code style!` |
| `pnpm test:unit` | **0** | `Test Files 17 passed (17)` / **`Tests 251 passed (251)`** / Duration 14.06s |
| `pnpm test:integration` | **0** | `Test Files 10 passed (10)` / **`Tests 124 passed (124)`** / Duration 50.10s（含真实 Docker 容器与 doctor 检查） |
| `pnpm docs:check` | **0** | `docs:check ok — 15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages` |
| `pnpm build` | **0** | `packages/{contracts,domain,storage,core,pi-runtime}`、`apps/{cli,runner}` 共 7 个 workspace `build: Done` |
| `git status --porcelain` | — | 命令前后均**无输出**（干净；`build` 只写被 `.gitignore:2 dist/` 忽略的产物） |
| `git rev-parse HEAD` | — | `17dfe264114aa61bc177f12e096e5abbd0ef30e0`（= 冻结点） |
| 残留检查 | — | 命令后 `pgrep -fl 'vitest\|agentdev'` 无输出；`docker ps -a` 仅见与本次无关的既有容器 |

---

## 4. 逐条 AC 证据

### AC-043 独立模型 —— 不通过（T-01）

> Given 角色配置不同Provider；When Chief触发各角色；Then 实际配置与角色一致，所有专业Run独立。证据：Config/Snapshot/Run。

**正向（`exp1` P1–P6，`exp3` P2）**

- `P1/P2`：两个 Provider（A：`openai-compatible`，`http://127.0.0.1:1111`；B：`anthropic`，`http://127.0.0.1:2222`，`secretRef=ANTHROPIC_KEY`）。`resolve('backend')` → A/`model-a`/`reasoning=low`；`resolve('review')` → B/`model-b`/`reasoning=high`。逐字段 `sources` 全为 `globalRole`，证明来自全局角色 Profile 层。
- `P3`：`effectiveContextLimit = min(profile.contextLimit, window − maxOutput − 4096)` → backend 32000、review 48000，与 `agents.md` §6 一致。
- `P4`：一次 Chief 分派创建 4 个 Run（chief/backend/review/test），**4 个互不相同的 `configSnapshotId`**，3 个专业 Run 的 `parentRunId` 全部等于同一个 Chief Run，`work_id` 下共 4 行。
- `P5`：`gateway.frozenProfileOf(run)` 读回的 provider/model **与该角色实际配置一致**（backend=A/model-a，review=B/model-b），无隐式换模型。
- `P6`：stub transport 收到的两次调用分别携带 `(A, model-a, http://127.0.0.1:1111, contextLimit=32000)` 与 `(B, model-b, http://127.0.0.1:2222, contextLimit=48000)`——每个专业 Run 只走自己的 Provider/模型/上下文预算。

**负向（`exp1` N1–N4，`exp2` D1–D6）**

- `N1`：模型 `model-b` 只支持 `off/high`，把 review 配成 `medium` 后 `resolve` 返回 `CONFIG_INVALID`、`dispatch` 抛 `PROVIDER_UNAVAILABLE`，Run 数不变（未降级、未放行）。
- `N3`：未配置的 providerId 与 `enabled:false` 的 Provider 都 fail-closed 为 `PROVIDER_UNAVAILABLE`。
- `N2`：`profileRevision` 过期（4,000,000 vs 当前 5,000,000）被拒（`VALIDATION_ERROR`），未创建 Run。
- `N4`：引用不存在的 config 快照硬失败（`STALE_ARTIFACT`），不会猜一个 Profile。

**T-01（P1，阻断）未配置 `secretRef` 的 Provider 无法完成任何模型调用**

`exp2` 使用「本地/无鉴权 openai-compatible 端点」这一合法配置（`providerInputSchema.secretRef` 为可选字段）：

| 断言 | 观察值 |
|---|---|
| `D1` Provider 未配 secretRef 仍可 `availability`/`dispatch` | `availability('backend').ok === true`，Run 正常创建，`configSnapshotId` 为 64 位 hash |
| `D2` 冻结投影把缺省写成 `null` | 快照 payload：`{"providerId":"…e71","type":"openai-compatible","baseUrl":"http://127.0.0.1:1111","secretRef":null}`（`FrozenProvider` 的声明是 `secretRef?: string`） |
| `D3` `complete()` 被拒 | `{ok:false, code:'CONFIG_INVALID', retryable:false, message:'secret null is not available'}`，transport 调用次数 **0** |
| `D4` 对照组（同流程但配 secretRef） | `{ok:true,…}`，transport 收到 `apiKey='stub-secret:PROVIDER_A_KEY'` |
| `D5` 负例对照（secretRef 存在但取不到值） | 正确拒绝 `CONFIG_INVALID: secret MISSING_KEY is not available`，无 transport 调用 |
| `D6` 重启后复现 | 关库重开后同样返回 `secret null is not available`，快照仍为 `secretRef:null` |

根因（`packages/core/src/config.ts`，`freeze`）：

```ts
provider: {
  providerId: provider.providerId,
  type: provider.type,
  baseUrl: provider.baseUrl,
  secretRef: provider.secretRef ?? null,   // ← 缺省被写成 JSON null
},
```

而 `packages/core/src/core/model-gateway.ts`（`complete`）用 `undefined` 表达「无需 Secret」：

```ts
const apiKey =
  frozen.provider.secretRef === undefined
    ? undefined
    : this.secrets?.resolve(frozen.provider.secretRef);
if (frozen.provider.secretRef !== undefined && apiKey === undefined) { /* 拒绝 */ }
```

`null !== undefined`，于是「不需要 Secret」被误判成「Secret 取不到」。`provider.test` 走的是**实时配置**而非冻结快照（`testConnection` 直接读 `config.provider(...)`），因此同一条无 Secret 配置在 `probe-testconn.mjs` 中得到 `{"ok":true,"latencyMs":0}`——同配置两条路径结论相反，进一步证明问题出在冻结投影而非鉴权语义。

影响：任何配置了无鉴权/本地 Provider 的角色，其 Run 能入队、能查快照、能显示独立模型，但**每一次真实模型调用都会失败**，且错误信息把「未配置 Secret」误导为「Secret 不可用」；该状态与 AC-043「实际配置与角色一致、所有专业 Run 独立可运行」以及 `agents.md` §5 的可用性判定不符。覆盖缺口：`packages/core/test/{config,model-gateway}.test.ts` 的 Provider 夹具都带 `secretRef: 'local-secret'`，所以 251 单测全绿也未触及。

建议承接：WP-02 内修复（`secretRef: provider.secretRef ?? null` → 省略该键或写 `undefined`，并补一条「无 secretRef 的 Provider 可完成调用」的正例与「`secretRef` 为 null 的形状」负例），修复后按规则回到独立 Review 再重新 Test。真实 Provider 纵向验证仍归 WP-10。

### AC-044 配置冻结 —— 通过

> Given 活动Run已创建；When 修改模型或恢复继承；Then 仅新Run生效，原Run配置可查询，无隐式换模型。证据：配置版本测试。

- `exp1` `P7`：创建 Run 后执行 `config.update` 把 backend 从 A/`model-a`/low 改为 B/`model-b`/high；再次 `frozenProfileOf(旧 Run)` 仍为 **A/`model-a`/low**，`revision` 不变（3,000,000）——活动 Run 无隐式换模型。
- `exp1` `P8`：同一时刻 `resolve('backend')` 返回 B/`model-b`/high；新建 Run 得到**新的** `configSnapshotId` 并使用 B——**仅新 Run 生效**。
- `exp1` `P9`：旧 `config` 快照行仍可按 hash 查询（`snapshots.read(id).type === 'config'`，`payload.revision` 仍为旧值），`snapshot` 主键即内容 hash（`row.hash === run.configSnapshotId`），对当前配置再次 `freeze` 得到不同 hash——快照内容寻址、不可变。
- 配置版本：`versionOf('global')` 从 3 递增，`layerRevision = global.version × 1_000_000 + project.version` 出现在快照 `revision` 中；`profileRevision` 过期被拒（`exp1` `N2`）。
- 负向：`exp1` `N4` 缺少冻结快照时硬失败（`STALE_ARTIFACT`，非静默重建），不存在「回落到实时配置」的路径；`exp5` `P4` 重复写同一 dispatch 快照返回 `created:false` 且 hash 不变（幂等）。
- UNVERIFIED：真实 Provider 的请求级模型确认（无 stub 的真实 HTTP 调用）不在 WP-02 范围，归 **WP-10**。

### AC-045 主控分派 —— 通过

> Given 专业Agent请求其他角色；When 调用request_dispatch；Then 只产生Chief待办；Chief选择Context并派发，无孙Run。证据：权限负例。

- `exp3` `P1`：专业 Run（backend）调用 `requestDispatch` → 返回 `disposition:'chief_action_required'`；**请求前后 Work 下 Run 数不变**（2→2）；事件日志新增 1 条 `chief_action_required`，其 `data` 含 `reason:'agent_dispatch'`、`role:'review'`、`requestedBy:调用者 Run`、`operationId`、`fingerprint`。
- `exp3` `P2`：Chief 亲自 `dispatch` 后才产生 Run，且它是 Chief 的直接子级（`parentRunId === chief.id`，`workId` 相同），`contextSnapshotId` 指向一条真实 `context` 快照——「Chief选择Context并派发」。
- `exp3` `N0`：**Chief 自身**调用 `request_dispatch` 被拒（`VALIDATION_ERROR: a Chief Run dispatches directly`），不产生待办。
- `exp3` `N1`：由**专业 Run** 作父级派发 → `NOT_AUTHORIZED`，无孙 Run（Work 下 Run 数不变）。
- `exp3` `N2`：把**另一个 Work 的 Chief Run** 当父级 → `NOT_AUTHORIZED`（同 Work 不变式）。
- `exp3` `N3`：伪造 `authorizationRef` → `NOT_AUTHORIZED`，未冻结任何东西。
- `exp3` `N4`：L3 Work 无授权引用 → `NOT_AUTHORIZED: L3 requires an explicit authorizationRef`。
- `exp3` `N5`：`none` 级 Work 派发 `write`+`writePaths` 或 `deploy` → `NOT_AUTHORIZED`；`artifact_write` 被允许（与第十七轮 R16-01 的修复一致）。
- UNVERIFIED：`assessment.submit` / `agent.dispatch` / `agent.request_dispatch` 的 **daemon HTTP/WS 协议面**（信封、认证、幂等键）不在 WP-02 本包必验范围，其内核已由本包实现；协议面验收归 **WP-10**（本包仅验证 Core 内核，与 `implementation.md` WP-02「用固定 ContextSelection 和角色结果桩」一致）。

### AC-046 Join 和失败 —— 通过

> Given 两个子Run且一个required失败；When 等待all；Then 兄弟保留，父可获全部结果，相关Gate阻断；新Chief消息可处理。证据：并发状态测试。

- `exp3` `J1`：Chief Run 派发 3 个子 Run——2 个 `join=all`（`requiredChild:true`）+ 1 个 `join=none`；`childIds` 记录全部 3 个。
- `exp3` `J2`：1 个子 Run 完成、另 1 个仍在运行 → `onChildSettled` 返回 `kind:'waiting'`，`pending` 精确列出未完成的 `join=all` 子级，父 Run 状态变为 `waiting_children`；`join=none` 子级不持有父级。
- `exp3` `J3`：等待中的父 Run 仍可服务（`recoveryView` 可取回其状态与冻结 scope），`waiting_children` 不是锁。
- `exp3` `J4`：required 子级 `failed` → 返回 `kind:'blocked'`，`failedRequired` 只含失败子级，**成功的兄弟子级仍在 `children` 中且状态为 `completed`**，`chiefTodo` 为非空 cursor；`state()` 亦为 `blocked`。
- `exp3` `J5`：blocked 结果携带**全部 3 个子级结果**（父可获全部结果），状态集合为 `completed,failed,queued`。
- `exp3` `J6`：重复调用 `onChildSettled` **不会重复产生** Chief 待办（`reason:'required_child_failed'` 计数恒为 1，幂等）。
- `exp3` `J7`：Gate 阻断后仍可创建新的 Chief Run 处理（新消息可处理）。
- `exp3` `J8`：只要 required 子级已失败，`state()` 永不返回 `ready`。

### AC-047 结构化交付 —— 通过

> Given 专业Agent口头完成或两次Schema错误；When 提交；Then 口头不通过，二次错误contract_violation。证据：stage结果负例。

- `exp4` `P1`：Schema 合法提交被接受，`stage_result` 行的 `runId`/`attemptId` 来自 capability，`taskId` 由 Run 派生。
- `exp4` `P2`：只「口头声称完成」的 Run 状态仍为 `running`，`stage_result` 表 0 行——**口头完成不通过**。
- `exp4` `N1`：第 1 次不合法提交 → `VALIDATION_ERROR` + `correctionsRemaining:1`，Run 仍 `running`，无行落库（允许修正一次）。
- `exp4` `N2`：第 2 次不合法提交 → `CONTRACT_VIOLATION` + `rejections:2` + `runStatus:'contract_violation'`，Run 终态为 `contract_violation`，无 `stage_result` 行。
- `exp4` `N3`：violation 之后再提交（即便内容合法）→ `INVALID_STATE`，终态不可被复活。
- `exp4` `N4`：payload 伪造 `runId` 等 server-owned 字段 → `NOT_AUTHORIZED`，未落库。
- `exp4` `N5`/`N6`：借用其它 Run 的 Attempt → `NOT_AUTHORIZED`；epoch 过期 → `STALE_ARTIFACT`。
- `exp4` `P3` / `exp5` `P5`：两次 Schema 错误在事件日志中留下 `stage.failed{outcome:'schema_invalid', rejection:1, correctionsRemaining:1}` 与 `{rejection:2, correctionsRemaining:0}`，`rejections(attemptId)` 由日志派生；**在两次提交之间真实关库重启**后计数仍为 1，第 2 次提交仍判 `contract_violation`——两击规则不依赖内存。
- `exp5` `P6`：同一重启之后，合法交付仍被接受（对照，证明上述不是「重启即拒绝」）。

### AC-082 重启保留窄范围 —— 通过（含 1 项 UNVERIFIED）

> Given 无Task调查Run只获一个文件范围；When 重启恢复后试读其他Work文件；Then 按DispatchSnapshot保持窄权限和输出Schema，Work宽范围不能替代。证据：持久快照/工具负例。

- `exp5` `P1`：Work 的 scope 故意很宽（`readPaths:["src/**","docs/**","packages/**"]`，`writePaths:["src/**"]`，`operations:["read","search","edit","write"]`）；派发的**无 Task**（`taskId === undefined`）调查 Run 只获得 `readPaths:["packages/core/src/join.ts"]` 与独立输出 Schema `[{kind:'stage_result'},{kind:'analysis_note'}]`。
- `exp5` `S1`：在磁盘上确实存在窄范围之外的真实文件（`<projectRoot>/src/other.ts`），使负例有意义。
- `exp5` `P2`：**关库并重开**（模拟 daemon 重启）后，`recoveryView(runId)` 从冻结 dispatch 快照恢复出**完全相同的** `effectiveScope` 与 `requiredOutputSchemas`，且 `dispatchSnapshot.hash === run.dispatchSnapshotId`；`profile` 亦来自冻结 config 快照。
- `exp5` `P3`：恢复出的 scope 严格窄于 Work scope（1 条路径 ≠ 3 条路径），**Work 宽范围没有替代窄权限**。
- `exp5` `N1`：dispatch 快照缺失的 Run 无法恢复（`NOT_FOUND`/`STALE_ARTIFACT`），不存在「回落到 Work 宽范围」的降级路径。
- `exp5` `P4`：dispatch 快照内容寻址、幂等不可变（重写同 payload → `created:false`，hash 不变）。
- **UNVERIFIED（明确标注）**：「重启后试读其他 Work 文件被拒绝」的**工具层**负例**无法在 WP-02 执行**：真正执行 read 拒绝的 Broker/容器工具门禁由 **WP-07「权限、工具和测试环境」**（输出：Broker、Grant、容器/宿主模式）实现，WP-02 只提供该门禁必须依据的冻结权威（`effectiveScope` + 输出 Schema），本次已实测该权威在重启后不变且不可被 Work 宽范围替代。承接工作包：**WP-07**（执行面负例），发布回归见 **WP-10**。

---

## 5. T-01 的补充探针（根因与对照）

```text
$ cd /tmp/wp02test && node probe-secret.mjs
--- in-memory provider row A ---
{ "providerId": "…e71", "type": "openai-compatible", "baseUrl": "http://127.0.0.1:1111", "enabled": true, "models": [...] }
secretRef own key? false                     # 内存中的 ConfigDocument 正确省略了该键
--- config.toml on disk ---
[[providers]]
providerId = "…e71"
type = "openai-compatible"
baseUrl = "http://127.0.0.1:1111"
enabled = true                               # 磁盘上的 TOML 也正确省略
--- frozen provider ---
{"baseUrl":"http://127.0.0.1:1111","providerId":"…e71","secretRef":null,"type":"openai-compatible"}
hasOwn secretRef? true                       # 只有“冻结”这一步把它变成了 null
complete result {"ok":false,"code":"CONFIG_INVALID","message":"secret null is not available"}
--- reopen and re-read config ---
{"providerId":"…e71",…}                      # 重启后实时配置依旧没有 secretRef
complete after reopen {"ok":false,"code":"CONFIG_INVALID","message":"secret null is not available"}

$ cd /tmp/wp02test && node probe-testconn.mjs
testConnection (live config, no secretRef): {"ok":true,"latencyMs":0}
transport calls after testConnection: 1      # 实时配置路径正常 → 问题只在冻结投影
```

---

## 6. 未覆盖与剩余风险

| 项 | 状态 | 原因 | 承接工作包 |
|---|---|---|---|
| 真实 Provider 的模型调用纵向验证（含 reasoning 映射、真实 usage、限流/超时） | **UNVERIFIED** | WP-02 本包必验范围明确「用固定 ContextSelection 和角色结果桩」，`ModelGateway` 的 transport 为注入式 stub；真实 HTTP 客户端属发布纵向演练 | WP-10（必需失败测试含「真实 Provider 任务」） |
| daemon HTTP/WS 协议面（`assessment.submit` / `agent.dispatch` / `agent.request_dispatch` / `stage.submit` 的信封、认证、幂等键、错误码映射） | **UNVERIFIED** | 本次只测 Core 内核（`Orchestrator`/`StageGate`/`JoinCoordinator` 直接调用）；BFF/WS 路由属完整 Web 工作台 | WP-09（界面）、WP-10（发布回归） |
| 工具层「重启后试读窄范围外文件被拒」负例 | **UNVERIFIED** | 执行面（Broker/容器/Grant）在 WP-07 才存在；本包只冻结权威 | WP-07，回归见 WP-10 |
| Docker/容器执行面（Run 真正在容器中读写） | 未覆盖 | 同上，且 `implementation.md` WP-02 未要求 | WP-07/WP-10 |
| `test:e2e` / `test:acceptance` / `test:live` | 未覆盖（按设计） | 根 `package.json` 中三者指向 `scripts/not-implemented.mjs`，分别标注 WP-09/WP-10；与 `.agentdev/work/WP-02/plan.md` §5 的声明一致 | WP-09/WP-10 |
| 真实并发（多进程/多 daemon 同时 Join、超 lease 恢复） | 未覆盖 | WP-02 只做单进程内状态机；租约、heartbeat、崩溃恢复属恢复与集成包 | WP-08（`reliability.md` §2） |
| T-01 修复后的回归 | 未覆盖 | 依赖开发修复 | WP-02 → 独立 Review → 重新 Test |

剩余风险：T-01 一旦带着「Provider 无 secretRef」配置进入真实使用，表现为**所有模型调用失败且错误信息方向错误**（把「不需要 Secret」报成「Secret 不可用」）；由于 251 单测与 124 集成测试均使用带 `secretRef` 的夹具，现有测试套件对这一路径完全无覆盖，回归风险高。

---

## 7. 结论

- **AC-043 不通过**（T-01，P1 阻断：无 `secretRef` 的 Provider 无法完成模型调用）。
- **AC-044、AC-045、AC-046、AC-047、AC-082 通过**（AC-082 的工具层负例 UNVERIFIED，已标注承接 WP-07）。
- 计数：**5 个 AC 通过 / 1 个 AC 不通过 / 0 个 AC 完全未覆盖**；自建实验 **51 条断言通过、0 条失败**；契约命令 **6/6 退出 0**（typecheck 0、lint 0、unit 251 passed、integration 124 passed、docs:check ok、build Done）。
- 按 `docs/rules/workflow.md` 的失败路由：本次 Test 失败项为代码缺陷（非产品语义变更），应回到 **Develop 修复 T-01 → 独立 Review → 重新 Test**，不得以「测试套件全绿」替代该路径。
- **Test 判定：FAIL**（对 WP-02 的 AC-043 不予接受）。

---

### 附：命令原始尾部输出

```text
$ pnpm test:unit            → Test Files 17 passed (17) / Tests 251 passed (251) / Duration 14.06s / UNIT_EXIT=0
$ pnpm test:integration     → Test Files 10 passed (10) / Tests 124 passed (124) / Duration 50.10s / INTEGRATION_EXIT=0
$ pnpm lint                 → All matched files use Prettier code style! / LINT_EXIT=0
$ pnpm docs:check           → docs:check ok — 15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages / DOCS_EXIT=0
$ pnpm build                → 7 workspace build: Done / BUILD_EXIT=0
$ pnpm typecheck            → (no output) / TYPECHECK_EXIT=0
$ git status --porcelain    → (empty, clean)
$ git rev-parse HEAD        → 17dfe264114aa61bc177f12e096e5abbd0ef30e0
```
