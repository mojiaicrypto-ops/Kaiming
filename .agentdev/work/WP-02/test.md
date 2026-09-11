# WP-02 独立 Test 报告（主管与独立Agent调度）

- 测试对象：工作包 WP-02「主管与独立Agent调度」
- **本轮：第二轮独立 Test**（第一轮判 FAIL：T-01/P1；开发修复后重新验收）
- 代码冻结点：`cbf7471aa01c260c01bf24011709dd6e785fb1a9`（`fix(core): close WP-02 review-18 findings (R18-01..R18-05)`）
- 仓库 HEAD：`a0b522dfe793b5a115d3740b136e83816ce15382`（`docs(review): WP-02 independent review report, round 18 (PASS)`）
  - `git diff --stat cbf7471 HEAD` 仅 `review.md`（+116/−114），**代码树 = `cbf7471`**（`git status --porcelain` 全程无输出，干净）
  - 说明：任务给定期望 `HEAD=cbf7471`；实际 HEAD 是 `cbf7471` 之上一个**仅改文档**的提交，代码内容与 `cbf7471` 逐字节一致，故等价。见 §7-O1。
- 测试角色：**Test**（独立上下文；未读取任何开发对话或 Review 会话；只依据仓库文件、git 对象与我自建的实验脚本及其原始输出）
- 测试方法：在 `/tmp/wp02t2/` 自建夹具与 8 组实验脚本（`lib.mjs`、`exp1..exp8.mjs`），全部通过 `/tmp/wp02t2/node_modules/@agentdev/*` 软链解析 `pnpm build` 产出的 `packages/*/dist`；**不 import 任何产品测试文件**；**未修改仓库任何文件**（唯一写入为本报告）
- 环境：`node v24.8.0`、`pnpm 12.3.4`、macOS（Darwin，宿主执行）；真实 SQLite（`ProjectStore`）+ 真实 `config.toml` + 内容寻址快照 + 注入式 stub transport（无真实网络）
- 权威依据：`docs/delivery/acceptance.md`（AC-043/044/045/046/047/082 原文）、`docs/delivery/implementation.md`、`AGENTS.md`、`docs/rules/{workflow,agents}.md`、`.agentdev/work/WP-02/{plan,discovery,implementation,review,test}.md`、`packages/core/src/**`、`packages/contracts/src/**`

---

## 0. 第一轮结论摘要（保留；完整原文见 `git show b9a2d12:.agentdev/work/WP-02/test.md`）

第一轮冻结点 `17dfe26`，结论 **FAIL**：

| AC | 题目 | 第一轮结论 |
|---|---|---|
| AC-043 | 独立模型 | **不通过**（T-01/P1 阻断） |
| AC-044 | 配置冻结 | 通过 |
| AC-045 | 主控分派 | 通过 |
| AC-046 | Join 和失败 | 通过 |
| AC-047 | 结构化交付 | 通过 |
| AC-082 | 重启保留窄范围 | 通过（工具层负例 UNVERIFIED，归 WP-07） |

- 第一轮自建实验 51 断言 0 失败；6 条契约命令退出 0（unit 251、integration 124）。
- **T-01（P1）**：`ConfigStore.freeze` 把「Provider 没有 `secretRef`」（合法的本地/无鉴权端点）冻结成 JSON `null`，而 `ModelGateway.complete` 以 `secretRef === undefined` 判断「无需 Secret」，`null !== undefined` 被当成「Secret 不可用」→ 该 Run 的**每一次**模型调用都返回 `CONFIG_INVALID: secret null is not available`，transport 调用 0 次。产品测试夹具全部带 `secretRef`，故 251 单测未覆盖。
- 第一轮另记 2 条 P3 观察：①「模型不支持该 reasoning」在 `resolve` 返回 `CONFIG_INVALID`、在 `dispatch` 映射为 `PROVIDER_UNAVAILABLE`；②`frozenProfileOf` 对快照缺失抛 `STALE_ARTIFACT` 而非 `NOT_FOUND`。
- 第一轮未覆盖：真实 Provider、daemon HTTP/WS 协议面、Docker/工具层权限（分别承接 WP-10/WP-09/WP-07）。

---

## 1. 本轮结论摘要

| AC | 题目 | 正向 | 负向 | 本轮结论 | 与第一轮 |
|---|---|---|---|---|---|
| AC-043 | 独立模型 | 通过 | 通过 | **通过** | **推翻第一轮**（T-01 已修） |
| AC-044 | 配置冻结 | 通过 | 通过 | **通过** | 一致 |
| AC-045 | 主控分派（含权限负例） | 通过 | 通过 | **通过** | 一致 |
| AC-046 | Join 和失败 | 通过 | 通过 | **通过** | 一致（本轮补 5 条边界负例） |
| AC-047 | 结构化交付 | 通过 | 通过 | **通过** | 一致 |
| AC-082 | 重启保留窄范围 | 通过 | 部分 | **通过**（工具层负例 UNVERIFIED） | 一致 |

**Test 判定：PASS（第二轮）——接受 WP-02 的 AC-043/044/045/046/047/082。**

- T-01 **真修好**：无 `secretRef` 的 Provider 端到端可 `availability`→`dispatch`→冻结快照→`complete()` 成功，重启后仍成功；冻结载荷不含 `secretRef`、不含任何 `null` 字面量；`testConnection` 同结论（§4）。
- 第十八轮对抗性补修四项**全部行为可验证**：`FrozenProvider` 投影单一化（`resolve` 与 `freeze→readFrozen` 一致）、`readFrozen` 归一历史 `null`、`availability` 在注入 `SecretResolver` 时校验凭证（悬空凭证在**准入阶段**被拒且不产生 Run/快照）、冻结 `model` 保留价格字段（§4/§6）。
- 未发现新增回归：6 条契约命令 6/6 退出 0，`pnpm test:unit` 255、`pnpm test:integration` 124，自建实验 **73 条断言 0 失败**。
- 最重要的问题（**非阻断**）：见 §7-O1——被测代码 `cbf7471` **晚于** HEAD 上 `review.md` 所声明的冻结点（`b9a2d12`），且该 Review 报告不含 `R18-05`；即本轮的代码改动没有与之配套的独立 Review 产物。按 `workflow.md`「Review/Test 之后的代码改动需回到独立 Review」，`cbf7471` 应在结算前补一次独立 Review（第十九轮）。这不影响本轮 Test 对行为的接受。
- 计数：**6 个 AC 通过 / 0 个不通过 / 0 个完全未覆盖**，其中 AC-082 含 1 项 UNVERIFIED（工具层负例，承接 WP-07）。

---

## 2. 测试环境与复现方式

```text
export PATH="$HOME/.local/bin:$PATH"
mkdir -p /tmp/wp02t2/node_modules/@agentdev
for p in contracts domain storage core pi-runtime; do
  ln -sfn /Users/huyaohua/huyh/work/aigrouptool/packages/$p /tmp/wp02t2/node_modules/@agentdev/$p
done
cd /Users/huyaohua/huyh/work/aigrouptool && pnpm build      # 实验只消费 dist
cd /tmp/wp02t2 && for e in 1 2 3 4 5 6 7 8; do node exp$e.mjs; done
```

| 脚本 | 覆盖 | 结果 |
|---|---|---|
| `/tmp/wp02t2/lib.mjs` | 世界夹具：独立临时目录 + 真实 SQLite + 真实 config.toml + 内容寻址快照 + stub transport；`reopen()` 模拟 daemon 重启；原始 SQLite payload 读取 | 基础设施 |
| `exp1.mjs` | AC-043 正/负 + AC-044 冻结/版本 | **15 passed / 0 failed** |
| `exp2.mjs` | T-01 端到端（无 secretRef，含重启）、悬空凭证准入、历史 `null` 兼容、正常 secretRef | **14 / 0** |
| `exp3.mjs` | AC-045 分派与权限负例、AC-046 Join 与局部失败 | **16 / 0** |
| `exp4.mjs` | AC-047 结构化交付正/负例 | **9 / 0** |
| `exp5.mjs` | AC-082 窄范围与重启、AC-047 重启后两击计数 | **7 / 0** |
| `exp6.mjs` | 对抗性补修复核：单一投影、价格字段、匿名 `testConnection`、悬空 `testConnection`、历史 null 不再冒充 Secret、显式 `undefined` | **6 / 0** |
| `exp7.mjs` | AC-046 边界负例：orphan/NOT_FOUND/非 Chief 父级/fire-and-forget 失败/waiting→running | **5 / 0** |
| `exp8.mjs` | 凭证吊销与轮换（活动 Run 失败闭合、零 transport 调用、恢复后可再调用） | **1 / 0** |
| **合计** | | **73 passed / 0 failed** |

脚本与日志：`/tmp/wp02t2/{lib,exp1..exp8}.mjs`、`/tmp/wp02t2/logs/{exp1..exp8}.log`、`/tmp/wp02t2/commands.log`、`/tmp/wp02t2/probe-d6.mjs`。

---

## 3. 契约命令原始结果与仓库状态

执行方式：`export PATH="$HOME/.local/bin:$PATH"`，仓库根目录按序执行（日志 `/tmp/wp02t2/logs/`）。

| 命令 | 退出码 | 原始结果要点 |
|---|---|---|
| `pnpm typecheck` | **0** | `tsc -p tsconfig.json --pretty false`，无输出 |
| `pnpm lint` | **0** | `Checking formatting...` / `All matched files use Prettier code style!` |
| `pnpm test:unit` | **0** | `Test Files 17 passed (17)` / **`Tests 255 passed (255)`** |
| `pnpm test:integration` | **0** | `Test Files 10 passed (10)` / **`Tests 124 passed (124)`**（含真实 Docker 容器与 doctor 检查） |
| `pnpm docs:check` | **0** | `docs:check ok — 15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages` |
| `pnpm build` | **0** | `packages/{contracts,domain,storage,core,pi-runtime}`、`apps/{cli,runner}` 共 7 个 workspace `build: Done` |
| `git status --porcelain` | — | 命令前后均**无输出**（干净；`build` 只写被 `.gitignore` 忽略的 `dist/`） |
| `git rev-parse HEAD` | — | `a0b522dfe793b5a115d3740b136e83816ce15382`；`git diff --stat cbf7471 HEAD` 仅 `review.md` |

命令原始尾部：

```text
$ pnpm typecheck            → (no output) / TYPECHECK_EXIT=0
$ pnpm lint                 → All matched files use Prettier code style! / LINT_EXIT=0
$ pnpm test:unit            → Test Files 17 passed (17) / Tests 255 passed (255) / UNIT_EXIT=0
$ pnpm test:integration     → Test Files 10 passed (10) / Tests 124 passed (124) / INTEGRATION_EXIT=0
$ pnpm docs:check           → docs:check ok — 15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages / DOCS_EXIT=0
$ pnpm build                → 7 workspace build: Done / BUILD_EXIT=0
$ git status --porcelain    → (empty, clean)
```

---

## 4. T-01 复核（逐项；第一轮 D1–D6 是否闭合）

修复后的独立观察值（本轮）：

| 第一轮断言 | 本轮观察值（原始输出） | 判定 |
|---|---|---|
| D1 未配 `secretRef` 仍可 `availability`/`dispatch` | `exp2` A1 活配置无 `secretRef` own key；A2 Chief/专业 Run 均创建（`configSnapshotId` 64 位 hash） | 保持 ✓ |
| D2 冻结投影把缺省写成 `null` | **已反转**：`exp2` A3 `readFrozen().provider` 键恰为 `baseUrl,providerId,type`；A4 原始 SQLite payload 不含 `secretRef`、不含 `null`；`exp1` P7 同 | **修好 ✓** |
| D3 `complete()` 被拒 | **已反转**：`exp2` A5 `{ok:true,...}`、transport 恰 1 次、请求**无 `apiKey` 键**；`exp8` E1 正常带 key | **修好 ✓** |
| D4 对照组（配 `secretRef`） | `exp2` B3 payload 含 `"secretRef":"GOOD_KEY"`、下发 `apiKey:'sk-good'`；`exp1` P6 下发 `stub-secret:ANTHROPIC_KEY` | 不受影响 ✓ |
| D5 负例（`secretRef` 存在但取不到值） | `exp2` B1 `CONFIG_INVALID: secret MISSING_KEY is not available`；B2 准入即拒、Run 与快照数不变；`exp8` E1 活动 Run 缺凭证时 0 次 transport 调用 | 不受影响 ✓ |
| D6 重启后复现 | **已反转**：`exp2` A6 关库重开后 `recoveryView` 的 provider 无键、`complete()` 成功、原始 payload 无 `secretRef`/`null` | **修好 ✓** |

补充（第一轮未覆盖，直接对应第十八轮补修项）：

- **单一投影（R18-01）**：`exp6` D1 —— 匿名与配密两条路径上，`resolve().resolution.provider` 与 `freeze()->readFrozen()` 的 provider **逐键相等**，匿名投影恰为三键。
- **历史 `null` 归一（R18-02）**：`exp2` C1 手工写入修复前同形 payload（原始串含 `"secretRef":null`）；C2 `readFrozen` 归一为「无 Secret」（无 own key）；C3 该 Run 仍能 `complete()` 成功；`exp6` D5 证明 resolver **从未被以 `null`/`"null"` 查询**（`askedAfter: []`）。
- **准入校验凭证（R18-05 / DC-73）**：`exp2` B1 `availability('review')` → `{ok:false,code:'CONFIG_INVALID',reason:'secret MISSING_KEY is not available'}`；B2 `dispatch` → `PROVIDER_UNAVAILABLE`，且 **Run 数 1→1、快照数 3→3（无任何写入）**。`exp6` D4 `testConnection` 同结论且 0 次 transport 调用。
- **冻结 model 保留价格字段**：`exp6` D2 —— 有价模型冻结后 `inputPricePerMTokens:3`/`outputPricePerMTokens:15` 保留，`resolve` 与 `readFrozen` 一致；无价模型两键均**缺省**（不写 `null`），原始 payload 不含该键。
- **显式 `secretRef: undefined`**：`exp6` D6 —— 活配置行可能仍带值为 `undefined` 的 own key，但 `resolve`/`freeze`/`readFrozen`/TOML/原始 payload **一律省略**该键，行为与「键缺省」完全一致（consumer 全用 `=== undefined`）。
- **凭证吊销/轮换**：`exp8` E1 —— 活动 Run 在凭证可取时带 key 调用；凭证消失时 `CONFIG_INVALID` 且 transport 调用 **0 次**；凭证恢复后同一 Run 用新 key 再次成功。

---

## 5. 逐条 AC 证据

### AC-043 独立模型 —— **通过**

> Given 角色配置不同Provider；When Chief触发各角色；Then 实际配置与角色一致，所有专业Run独立。证据：Config/Snapshot/Run。

**正向**：`exp1` P1–P7。
- P1/P2：Provider A（`openai-compatible`，`http://127.0.0.1:1111`，**无 secretRef**）与 B（`anthropic`，`:2222`，`secretRef=ANTHROPIC_KEY`）分别解析为 backend/review；逐字段 `sources` 全为 `globalRole`。
- P3：`effectiveContextLimit` 取 `min(profile, window−maxOutput−4096)`；backend 32000、review 64000，且超大的 profile 上限被模型上限封顶为 **187904**。
- P4：一次 Chief 分派建立 3 个 Run，3 个互异 `configSnapshotId`，两个专业 Run 的 `parentRunId` 均为同一 Chief Run。
- P5/P6：`frozenProfileOf` 与各角色配置一致；两次调用分别携带 `(A,alpha-model,:1111,contextLimit 32000)` 与 `(B,beta-model,:2222,contextLimit 64000,apiKey stub-secret:ANTHROPIC_KEY)`；**匿名调用请求无 `apiKey` 键**。
- P7：匿名 Run 的原始 config payload 不含 `secretRef`、不含 `null`。
- `exp8` E1：配密 Run 带 key 调用、吊销时失败闭合、轮换后再成功。

**负向**：`exp1` N1–N3。
- N1：`model-b` 只支持 `off/high`，配成 `medium` → `resolve` `CONFIG_INVALID`、`dispatch` `PROVIDER_UNAVAILABLE`，Run 数不变。
- N2：未配置 providerId → `PROVIDER_UNAVAILABLE`。
- N3：`enabled:false` → `PROVIDER_UNAVAILABLE`（reason 含 `disabled`）。

**UNVERIFIED**：真实 HTTP Provider 的模型调用（usage/reasoning 映射/网络错误）——WP-02 使用注入式 stub，真实纵向归 **WP-10**。

### AC-044 配置冻结 —— **通过**

> Given 活动Run已创建；When 修改模型或恢复继承；Then 仅新Run生效，原Run配置可查询，无隐式换模型。证据：配置版本测试。

- `exp1` P8：创建 Run 后改 backend 为 B/beta-model/high，旧 Run 的 `frozenProfileOf` 仍为 **A/alpha-model**，无隐式换模型；同一时刻 `resolve` 已是 B。
- P9：新建 Run 得到**新** `configSnapshotId` 并使用新配置。
- P10：旧 `config` 快照仍可按 hash 读取（`type==='config'`），再次 `freeze` 得到不同 hash；内容寻址不可变。
- 负向 N4：过期 `profileRevision`（4,000,000 vs 5,000,000）→ `VALIDATION_ERROR`，未创建 Run（Run 数不变）。
- 负向 N5：Run 指向缺失 config 快照 → `STALE_ARTIFACT`（硬失败，不回落实时配置）。
- 第一轮 P3 观察②在本轮复现：`frozenProfileOf` 对缺失快照抛 `STALE_ARTIFACT`，非 `NOT_FOUND`（见 §6）。
- **UNVERIFIED**：真实 Provider 的请求级模型确认 → **WP-10**。

### AC-045 主控分派 —— **通过**

> Given 专业Agent请求其他角色；When 调用request_dispatch；Then 只产生Chief待办；Chief选择Context并派发，无孙Run。证据：权限负例。

- `exp3` P1：专业 Run 调用 `requestDispatch` → `disposition:'chief_action_required'`，**请求前后 Run 数 2→2**；事件 `chief_action_required` 的 `data` 含 `reason:'agent_dispatch'`、`requestedBy`、`operationId`、`fingerprint`。
- P2：Chief 亲自 `dispatch` 后才产生 Run，且为 Chief 直接子级，`contextSnapshotId` 指向真实 `context` 快照。
- 负向 N0：**Chief 自身** `request_dispatch` → `VALIDATION_ERROR: a Chief Run dispatches directly`，不产生待办。
- N1：专业 Run 作父级派发 → `NOT_AUTHORIZED`，无孙 Run（Run 数不变）。
- N2：另一 Work 的 Chief 作父级 → `NOT_AUTHORIZED`（同 Work 不变式）。
- N3：伪造 `authorizationRef` → `NOT_AUTHORIZED`，未冻结任何东西。
- N4：L3 Work 无授权引用 → `NOT_AUTHORIZED: L3 requires an explicit authorizationRef`。
- N5：`none` 级 Work 派发 `write`+`writePaths` 或 `deploy` → `NOT_AUTHORIZED`；`artifact_write` 被允许。
- **UNVERIFIED**：`assessment.submit`/`agent.dispatch`/`agent.request_dispatch` 的 daemon HTTP/WS 协议面（信封、认证、幂等键、错误码映射）→ **WP-09/WP-10**（本包按 `implementation.md` 只验 Core 内核）。

### AC-046 Join 和失败 —— **通过**

> Given 两个子Run且一个required失败；When 等待all；Then 兄弟保留，父可获全部结果，相关Gate阻断；新Chief消息可处理。证据：并发状态测试。

- `exp3` J1：3 个子 Run（2×`join=all`+required，1×`join=none`），Chief `childIds` 记录全部。
- J2：1 完成、另 1 仍运行 → `onChildSettled` 返回 `waiting`，`pending` 精确为未完成的 `join=all` 子级，父 Run 变 `waiting_children`；`join=none` 不持有父级。
- J3：等待中的父 Run 的 `recoveryView`/`state` 仍可取回（`waiting_children` 不是锁）。
- J4：required 子级 `failed` → `blocked`，`failedRequired` 只含失败者，**成功兄弟仍在 `children` 且 `completed`**，`chiefTodo` 非空。
- J5：blocked 携带**全部 3 个子级结果**。
- J6：重复 `onChildSettled` 不重复产生 Chief 待办（`required_child_failed` 恒 1，幂等）。
- J7/J8：Gate 阻断后仍可新建 Chief Run；required 失败后 `state()` 永不返回 `ready`。
- 本轮新增负例 `exp7`：K1 无父 Run → `orphan`；K2 未知子级 → `NOT_FOUND`；K4 非 Chief 父级 → `NOT_AUTHORIZED`；K3 失败的 `join=none` 子级 → 产生 `fire_and_forget_child_failed` 待办但**不阻断 Gate**（`kind:'ready'`）；K5 控制组：`waiting_children`→required 完成后回到 `running`。

### AC-047 结构化交付 —— **通过**

> Given 专业Agent口头完成或两次Schema错误；When 提交；Then 口头不通过，二次错误contract_violation。证据：stage结果负例。

- `exp4` P1：合法提交落库，`runId`/`attemptId` 来自 capability，`taskId` 由 Run 派生。
- P2：仅口头声称完成的 Run 仍 `running`，`stage_result` 0 行。
- N1：第 1 次不合法 → `VALIDATION_ERROR`+`correctionsRemaining:1`，Run 仍 `running`，无行落库。
- N2：第 2 次不合法 → `CONTRACT_VIOLATION`+`rejections:2`+`runStatus:'contract_violation'`。
- N3：violation 后（即便合法）→ `INVALID_STATE`，终态不可复活。
- N4：payload 伪造 server-owned 字段 → `NOT_AUTHORIZED`；N5：借用他人 Attempt → `NOT_AUTHORIZED`；N6：epoch 过期 → `STALE_ARTIFACT`。
- P3 / `exp5` P5/P6：两击计数由事件日志派生，**真实关库重启**后仍为 1，第 2 次提交仍判 violation，合法交付仍被接受。

### AC-082 重启保留窄范围 —— **通过（含 1 项 UNVERIFIED）**

> Given 无Task调查Run只获一个文件范围；When 重启恢复后试读其他Work文件；Then 按DispatchSnapshot保持窄权限和输出Schema，Work宽范围不能替代。证据：持久快照/工具负例。

- `exp5` P1：Work scope 故意很宽（3 条 readPaths），无 Task（`taskId===undefined`）的调查 Run 只获 `readPaths:['packages/core/src/join.ts']` 与独立输出 Schema `[stage_result,analysis_note]`。
- S1：窄范围外的真实文件存在于磁盘，使负例有意义。
- P2：**关库重开**后 `recoveryView` 恢复出**完全相同**的 `effectiveScope` 与 `requiredOutputSchemas`，`dispatchSnapshot.hash === run.dispatchSnapshotId`。
- P3：恢复出的 scope 严格窄于 Work scope（1 ≠ 3 条路径），**Work 宽范围未替代窄权限**。
- N1：dispatch 快照缺失的 Run 无法恢复（`NOT_FOUND`/`STALE_ARTIFACT`），无「回落 Work 宽范围」路径。
- P4：dispatch 快照内容寻址、幂等不可变（重写同 payload → `created:false`，hash 不变）。
- **UNVERIFIED（明确标注）**：「重启后试读其他 Work 文件被拒绝」的**工具层**负例无法在 WP-02 执行——真正执行 read 拒绝的 Broker/容器工具门禁由 **WP-07** 实现，WP-02 只提供并冻结该门禁所依据的权威（本轮已实测该权威在重启后不变且不可被 Work 宽范围替代）。承接：**WP-07**，发布回归见 **WP-10**。

---

## 6. 对第一轮每条结论的独立复核

| 第一轮结论 | 本轮独立复核 | 裁定 |
|---|---|---|
| T-01（P1）：无 `secretRef` 的 Provider 每次调用 `CONFIG_INVALID` | 写入端已省略该键（`exp2` A3/A4、`exp1` P7）；端到端可调用（`exp2` A2/A5）；重启后仍可（A6）；历史 `null` 兼容（C1–C3）；resolver 从不被以 `null` 查询（`exp6` D5） | **推翻（已修好）** |
| AC-043 不通过 | 现已通过（§5） | **推翻** |
| AC-044 通过 | 复现 P8/P9/P10 与 N4/N5，结论不变 | 一致 |
| AC-045 通过 | 复现 P1/P2 与 N0–N5，结论不变 | 一致 |
| AC-046 通过 | 复现 J1–J8，另补 K1–K5 边界负例，结论不变 | 一致 |
| AC-047 通过 | 复现 P1/P2 与 N1–N6、重启两击，结论不变 | 一致 |
| AC-082 通过（工具层 UNVERIFIED） | 复现 P1–P4 与 N1，UNVERIFIED 依旧 | 一致 |
| P3 观察①：`resolve`→`CONFIG_INVALID` 而 `dispatch`→`PROVIDER_UNAVAILABLE` | 本轮独立复现（`exp1` N1 观察值）。属错误码/可观测性差异，非行为缺陷；建议归 WP-10 协议面统一 | **成立（非阻断）** |
| P3 观察②：`frozenProfileOf` 缺快照抛 `STALE_ARTIFACT` 非 `NOT_FOUND` | 本轮独立复现（`exp1` N5）。与缓存/恢复语义相关，非阻断 | **成立（非阻断）** |

---

## 7. 本轮观察（不计为 AC 阻断项）

**O1（流程/追溯，建议结算前处理）——被测代码无配套的独立 Review 产物。**
git 事实：`git log --oneline` 为 `a0b522d(review doc) → cbf7471(fix) → b9a2d12(test doc) → 3506630(T-01 fix)`；HEAD 上 `review.md` 自述「冻结点 `b9a2d12`、父提交 `3506630`」，其 §1 计 `0×P1、2×P2（R18-01、R18-02）、2×P3（R18-03、R18-04）`；`grep R18-05 review.md` **无匹配**，`R18-05`/DC-73 仅出现在 `cbf7471` 写入的 `discovery.md`/`implementation.md`。即：本轮实测的代码（`cbf7471`：`availability` 凭证校验、`readFrozen` 归一、价格字段、单一投影）**晚于**该 Review 的冻结点，且对应的 `R18-05` 未进入 Review 报告。按 `docs/rules/workflow.md` 的「Review/Test 后的代码改动回到独立 Review」，建议在结算前对 `cbf7471` 补一次独立 Review（第十九轮）。**这不改变本轮 Test 的行为判定**（相关行为已由 73 条断言覆盖且通过）。

**O2（P3，既有、已登记）——`readFrozen` 不做载荷 Schema 校验。**
`exp2` C5：手工快照缺 `provider` 字段时，`readFrozen` 抛原生 `TypeError: Cannot destructure property 'secretRef' of 'payload.provider' as it is undefined.`，而非结构化错误。`cbf7471` 已归一 `secretRef` 的 `null`，但未引入运行时校验。Review R18-02 已登记，承接 WP-08/WP-09 读取面统一处理。非阻断。

**O3（P3，新增细节）——显式 `secretRef: undefined` 在活配置行留下值为 `undefined` 的 own key。**
`exp6` D6 + `probe-d6.mjs`：`upsertProvider({...provider, secretRef: undefined})` 后活配置行 `hasOwnProperty('secretRef')===true` 但值为 `undefined`；`resolve`/`freeze`/`readFrozen`/TOML/原始 payload 一律省略，全部 consumer 以 `=== undefined` 判定，行为等价。纯外观差异，不影响验收。

**O4（边界，已由 DC-73 声明）——未注入 `SecretResolver` 时准入放行、调用失败闭合。**
`exp2` B5：无 resolver（`options.secrets===null`）时 `availability` 放行（`ok:true`），但同一 Run 的 `complete()` 对已声明的 `secretRef` 返回 `CONFIG_INVALID` 且 0 次 transport 调用。这是 DC-73 记录的 WP-07 边界（Secret 存储未知），签发/消费 `once` 授权归 **WP-07**。

---

## 8. 未覆盖与剩余风险

| 项 | 状态 | 原因 | 承接工作包 |
|---|---|---|---|
| 真实 Provider 模型调用（reasoning 映射、真实 usage、限流/超时） | **UNVERIFIED** | WP-02 必验范围明确使用固定 ContextSelection 与角色结果桩，transport 为注入式 stub | WP-10 |
| daemon HTTP/WS 协议面（`assessment.submit`/`agent.dispatch`/`agent.request_dispatch`/`stage.submit` 的信封、认证、幂等键、错误码映射） | **UNVERIFIED** | 本轮只测 Core 内核；BFF/WS 路由属完整 Web 工作台 | WP-09 / WP-10 |
| 工具层「重启后试读窄范围外文件被拒」负例 | **UNVERIFIED** | 执行面（Broker/容器/Grant）在 WP-07 才存在；本包只冻结权威 | WP-07，回归见 WP-10 |
| Docker/容器执行面（Run 真正在容器中读写） | 未覆盖 | 同上 | WP-07 / WP-10 |
| `test:e2e` / `test:acceptance` / `test:live` | 未覆盖（按设计） | 三者指向 `scripts/not-implemented.mjs`，分别标注 WP-09/WP-10 | WP-09 / WP-10 |
| 真实并发（多进程/多 daemon 同时 Join、超 lease 恢复） | 未覆盖 | WP-02 只做单进程内状态机 | WP-08 |
| `readFrozen` 对任意畸形载荷的完整 Schema 校验 | 未覆盖（观察 O2） | 见 Review R18-02 | WP-08 / WP-09 |

剩余风险：`cbf7471` 的代码改动尚未经独立 Review（O1），若结算前不补，将出现「未经 Review 的代码进入验收」的流程缺口；其余为已登记、按包承接的功能边界，本轮未观察到回归。

---

## 9. 结论

- **AC-043 通过**（T-01/P1 已真修好，第一轮结论被推翻）。
- **AC-044、AC-045、AC-046、AC-047、AC-082 通过**（AC-082 的工具层负例 UNVERIFIED，承接 WP-07）。
- 计数：**6 个 AC 通过 / 0 个不通过 / 0 个完全未覆盖**；自建实验 **73 条断言通过、0 条失败**；契约命令 **6/6 退出 0**（typecheck 0、lint 0、unit 255、integration 124、docs:check ok、build Done）；`git status` 干净。
- 最重要的问题：**O1（流程/追溯）**——`cbf7471` 晚于 HEAD `review.md` 声明的冻结点且 `R18-05` 未进入 Review 报告，建议结算前补一次独立 Review（第十九轮）；其余为 P3 观察，均不阻断。
- 未发现 T-01 修复或第十八轮补修引入的新回归。
- **Test 判定：PASS（第二轮）——接受 WP-02 的 AC-043/044/045/046/047/082。**

---

### 附：本轮自建实验断言清单（全部 0 失败）

```text
exp1 (AC-043/AC-044)        15 passed / 0 failed
exp2 (T-01 端到端/准入)     14 passed / 0 failed
exp3 (AC-045/AC-046)        16 passed / 0 failed
exp4 (AC-047)                9 passed / 0 failed
exp5 (AC-082/重启两击)       7 passed / 0 failed
exp6 (对抗性补修复核)        6 passed / 0 failed
exp7 (AC-046 边界负例)       5 passed / 0 failed
exp8 (凭证吊销/轮换)         1 passed / 0 failed
------------------------------------------------
合计                        73 passed / 0 failed
```
