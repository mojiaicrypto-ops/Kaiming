# WP-02 结算（Settlement）

- 工作包：WP-02 主管与独立Agent调度（`docs/delivery/implementation.md`）
- 等级：L2；Plan `.agentdev/work/WP-02/plan.md`（planVersion 4）
- 关联验收：AC-043、AC-044、AC-045、AC-046、AC-047、AC-082
- 基线提交：`b9df25e`（WP-01 结算）
- 验证代码树：commit `cbf7471`，tree `3b88f81545cbde8654c87370312d4b98d68eb413`
- 证据提交：`267751a`（Test 第二轮报告）、`4a03dcd`（Review 第十九轮报告）；本结算提交只新增/更新 `.agentdev/work/WP-02/` 与 `docs/INDEX.md`，**代码树未变**（结算前的最后一次代码改动是 `cbf7471`，其后的提交均为评审/测试报告与注释级更正）
- 证据目录：`.agentdev/work/WP-02/`（plan / implementation / discovery / review / test / settlement）
- 冻结提交总数：`b9df25e..cbf7471` 共 36 个提交；Diff 82 个路径、+19865/−2

## 1. 实际 Diff

`b9df25e..cbf7471` 分四类：

| 类别 | 内容 |
|---|---|
| 契约与领域 | `packages/contracts/src/entities/{structures,run,work}.ts`（DispatchSpec/DispatchSnapshot/ContextSelection/StageResult/ConfigDocument、Run 快照引用、授权操作枚举）、`packages/domain/src/routing.ts` 等（等级路由、风险词表、操作分类） |
| Core 编排 | `packages/core/src/orchestrator.ts`（Assessment 与路由底线、DispatchSpec 冻结与准入、Run 建立、`request_dispatch`/`chief_action_required`、授权核对）、`join.ts`（Join/失败/父唤醒/幂等待办）、`stage.ts`（StageResult、修正一次、二次错误 `contract_violation`）、`run-lifecycle.ts`（Run 起止/取消级联/预算预留与核销/`reconcile`）、`snapshots.ts`（内容寻址快照）、`config.ts`（全局/项目配置、角色 Profile 解析与冻结、凭证可用性）、`model-gateway.ts`（模型网关与可用性）、`events.ts`（事件分页扫描）、`toml.ts`（最小 TOML 子集） |
| 测试 | `packages/core/test/**`、`packages/contracts/test/**`、`packages/domain/test/**`（unit 17 文件/255 用例） |
| 记录 | `.agentdev/work/WP-02/**`（19 轮 Review、2 轮 Test、76 条 Discovery） |

`docs/` 只在本次结算更新 `docs/INDEX.md` 的实现状态（技术事实/索引更新，无产品语义或规则改动）。

## 2. 工程命令结果（独立 Test 第二轮，tree `3b88f81`）

| 命令 | 退出 | 结果 |
|---|---|---|
| `pnpm typecheck` | 0 | strict 无错误 |
| `pnpm lint` | 0 | 类型感知 ESLint + Prettier 通过 |
| `pnpm test:unit` | 0 | 17 文件 / 255 用例 |
| `pnpm test:integration` | 0 | 10 文件 / 124 用例（含真实 Docker 容器） |
| `pnpm docs:check` | 0 | 15 documents / 55 links / 94 AC / 9 REQ / 11 WP |
| `pnpm build` | 0 | contracts/domain/storage/core/pi-runtime/runner/cli 7 workspace |
| `pnpm test:e2e` | 1 | `NOT_IMPLEMENTED … lands with WP-09`（按契约失败） |
| `pnpm test:acceptance` | 1 | `NOT_IMPLEMENTED … lands with WP-10` |
| `pnpm test:live` | 1 | `NOT_IMPLEMENTED … lands with WP-10` |

Tester 自建实验（`/tmp`，不 import 产品测试）：73 断言 0 失败，覆盖 6 条 AC 的正负例。

### 必需失败测试（`docs/delivery/implementation.md` 第 44 行）

| 必需失败测试 | 覆盖 |
|---|---|
| 模型配置冻结 | `orchestrator.test.ts` 过期 `profileRevision` 拒绝、`model-gateway.test.ts` 冻结后改配置只影响新 Run、无 `secretRef` 端点与悬空 `secretRef` 负例 |
| 请求孙 Run 拒绝 | `orchestrator.test.ts` 非 Chief 父级/跨 Work 父级/孙 Run 全部 `NOT_AUTHORIZED`（`isDirectChiefChild`） |
| 父等待可接消息 | `join.test.ts` 父 `waiting_children` 期间 `onChildSettled` 与 `request_dispatch` 仍可服务，待办幂等 |
| 子局部失败 | `join.test.ts` required 子失败 → 兄弟保留、父获全部结果、`blocked` + `chief_action_required`；`contract_violation` 级联取消 |

## 3. 独立验证

| 角色 | 冻结点 | 结论 | 位置 |
|---|---|---|---|
| Review 1–3 | `785bdd6`→`411d04f` | FAIL：R-01…R-13、N-01…N-10、M-01…M-05/D1–D5 | `review.md` §1–3 |
| Review 4–6 | `5a87a86`→`0211ced` | FAIL：Q-01…Q-10/H-01–H-03、R5-01…R5-14/M-1…M-4、R6-01…R6-10 | `review.md` §4–6 |
| Review 7–10 | `4580c02`→`080aa4c` | FAIL：R7-01…R7-09、R8-01…R8-09、R9-01…R9-06、R10-01…R10-07 | `review.md` §7–10 |
| Review 11–16 | `fec9a9d`→`3dc12db` | FAIL×5（R11…R14、R16 对抗性异议）→ R16 评审判 PASS 但对抗性异议成立，已修复 | `review.md` §11–16 |
| Review 17 | `17dfe26`/tree `cbf7471` 前身 | **PASS**：0×P1/0×P2/5×P3，对抗性核验一致 PASS | `review.md` §17 |
| Test 第一轮 | `17dfe26` | **FAIL**：T-01（无 `secretRef` 的 Provider 冻结为 `null` → 每次调用 `CONFIG_INVALID`）；其余 5 条 AC 通过 | `test.md` §1 |
| Review 18 | `b9a2d12`/`3506630` | **PASS**（对抗性核验补出 R18-01/02/05，已在 `cbf7471` 修复） | `review.md` §18 |
| Test 第二轮 | `cbf7471` | **PASS**：6/6 AC 通过（AC-082 含 1 项工具层 UNVERIFIED，承接 WP-07）；73 断言 0 失败 | `test.md` §2 |
| Review 19 | `267751a`/tree `cbf7471` | **PASS**：0×P1、1×P2、2×P3；闭合 Test 第二轮提出的 O1 | `review.md` §19 |

19 轮独立 Review 全部由独立上下文的 Reviewer 执行，Review 均判 FAIL→修复直至 PASS；Test 两轮独立执行（第一轮 FAIL 定位 T-01 并由开发方修复）。Reviewer/Tester 的关键判定均有可复现实验（`/tmp` 自建脚本，不 import 产品测试），并多次做出「回退修复即失败」的因果自证（如 T-01 回退一行使新回归用例变红）。

## 4. 验收对应

- **AC-043 独立模型**：角色级 Profile 指定 Provider/model/reasoning/contextLimit；每个 Run 独立冻结配置快照，Chief 与专业 Run 各自命中自己的 Provider；无 `secretRef` 的合法端点可完成调用，悬空 `secretRef` 在准入阶段即 `PROVIDER_UNAVAILABLE`（不建 Run）。证据：`config` 快照、Run 行、`ModelGateway` 调用请求（Test 第二轮 exp1/exp2）。
- **AC-044 配置冻结**：活动 Run 读冻结快照，改配置/恢复继承只影响新 Run；快照内容寻址、不可变、可复查；过期 `profileRevision` 拒绝、缺失快照 `STALE_ARTIFACT`。证据：配置版本测试与快照读取（Test 第二轮 exp1 P8–P10/N4–N5）。
- **AC-045 主控分派**：专业 Run 只能 `request_dispatch` 产生 `chief_action_required`（不建 Run）；Chief 自选 Context 并派发；孙 Run、非 Chief 父级、跨 Work 父级、伪造/跨 Work/已撤销授权、L3 无授权、`none` 级 Work 的写/环境 scope 全部拒绝；`none` 级 Work 可派发只写自己 Artifact 的 Run。证据：权限负例（Test 第二轮 exp3 P1 与 6 条负例）。
- **AC-046 Join 与失败**：`join=none` 不持有父；`join=all` 等待期父为 `waiting_children` 且仍可服务；required 子失败 → 兄弟保留、父获全部结果（事件携带每个子 Run 的 StageResult 与读账本）、`blocked` + 一次性待办；新 Chief 消息可处理；非终态父被暂停/中断恢复后仍保留待办。证据：并发状态测试（Test 第二轮 exp3 J1–J8、exp7 K1–K5）。
- **AC-047 结构化交付**：口头完成不改变 Run 状态（无 `stage_result` 行）；两次 Schema 错误 → `contract_violation` 终态并级联取消在场子 Run；epoch/尝试/版本守卫与归属伪造拒绝；两击计数由事件日志派生，真实重启后仍生效。证据：StageResult 负例（Test 第二轮 exp4/exp5）。
- **AC-082 重启保留窄范围**：无 Task 调查 Run 只获单文件范围与独立输出 Schema；关库重开后从冻结 dispatch 快照恢复完全一致，Work 宽 scope 不能替代；快照缺失无降级路径（`STALE_ARTIFACT`）。证据：持久快照读取（Test 第二轮 exp5 P1–P4）。**未覆盖**：工具层「读窄范围外文件被拒」的执行期负例需 Broker/容器，承接 WP-07。

## 5. 未决项与承接包（显式登记）

| 编号 | 内容 | 归属 |
|---|---|---|
| N-11 / DC-27 / RE-06 | 快照引用用 `(type,hash)` 而非 `data.md` 的 `ID` 记法；`run.ts` 三个快照引用为哈希。实现保留，需产品方确认是否回写 `data.md` | **Product decision pending** |
| DC-60 | Assessment 的 `goal`/`scope` 既不落行也不落事件（`data.md` §2 行定义 vs §3 结构定义不一致） | **Product decision pending** |
| DC-64 | 风险旗标词表目前是实现级（`domain/routing.ts`），未登记旗标一律拒绝；是否提为 contracts 枚举 | **Product decision pending** |
| DC-38 | `runParams` 缺少授权来源绑定（`agents.md` §5 的最强配置层） | WP-04 / WP-07 |
| DC-39 | Join 无独立协议事件，读模型（WS/BFF）消费 `chief_action_required` | WP-08 |
| DC-40 / DC-47 | 父 Run 额度 = 在场子 Run 之和（实现约定，无文档依据） | WP-05（如需文档化） |
| DC-41 / DC-45 | Provider 真实用量与 `reconcile` 调用方；未测量用量保持预留 + `costKnown=false` 的核销链路 | WP-10 |
| DC-42 / DC-46 | Work `blocked(provider)` 投影、`dispatch` 不校验 `work.status` | WP-05 |
| DC-48 / DC-55 | `run.ended` 统一形状/顺序语义、超预留 `uncoveredTokens` 不产生 Work 级预算阻断 | WP-05 / WP-08 |
| DC-70 | `config.policy.l3Paths`/`l3Keywords` 无消费方 | WP-04 / WP-05 |
| DC-72 | `none` 级 Work 的等级升级路径（`assess` 不回写 `work.level`） | WP-05 |
| R19-01 | `readFrozen` 对缺 `provider`/`model` 的畸形载荷抛原生 `TypeError`（当前写入方唯一，不可达） | WP-08 / WP-09 |
| R19-03 | `SecretResolver` 的幂等/无副作用/不抛异常隐式契约；真实 Secret 存储需包装 IO 失败 | WP-07 |
| O1（Test 第一轮） | daemon HTTP/WS 协议面与真实 Provider 纵切的验收 | WP-09 / WP-10 |

## 6. 完成清单

- 验证代码树：`cbf7471aa01c260c01bf24011709dd6e785fb1a9`，tree `3b88f81545cbde8654c87370312d4b98d68eb413`。
- 最终文档：`docs/INDEX.md`（本次结算修订实现起点）；证据文档 revision 见各证据提交（`267751a`、`4a03dcd`）。
- 证据 Hash：`review.md`（19 轮，提交 `4a03dcd`）、`test.md`（2 轮，提交 `267751a`）、`discovery.md`/`implementation.md`（DC-37…DC-73、T1…T28，本结算提交）。
- 结论：WP-02 达成 AC-043/044/045/046/047/082（AC-082 的工具层执行负例承接 WP-07）；无未关闭 P1/P2 阻断项；未决项均按上表归属承接或等待产品决定。可进入 WP-03。
