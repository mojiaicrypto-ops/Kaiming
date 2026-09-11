# WP-02 实现 Plan（主管与独立Agent调度）

- planVersion: 1
- workId: WP-02
- level: L2（新增 Core 调度/配置/网关模块与冻结快照；涉及身份权限与模型配置，但按 `docs/rules/agents.md`、`protocol.md`、`data.md` 既有定义实现，不改产品语义）
- authorization_ref: 用户目标轮次「继续」（2026-09-11）；上级授权为「我要完全实现这个产品，让你来实现」
- productRef: 无独立 Requirement；行为依据为 `docs/delivery/implementation.md` WP-02 与关联 AC
- 依赖：WP-01（已完成，结算提交 `b9df25e`，验证代码树 `c201f42`）

## 1. goal

让 Chief 能在同一套事务与事件语义上完成「评估 → 选择上下文 → 冻结 Dispatch → 建立独立专业 Run → 收敛结果」的调度闭环：角色配置按继承顺序解析并在 Run 上冻结、专业 Run 与 Chief Run 的父子与权限边界不可绕过、Join 与局部失败可由 Chief 汇总、结构化交付不可用口头替代、等待中的父 Run 仍可接消息。Provider/模型真实调用不在本包（WP-10）。

## 2. scope

writePaths:

- `packages/core/src/config.ts`（新增：全局/Project 配置读写、revision、继承解析、ConfigSnapshot 冻结）
- `packages/core/src/toml.ts`（新增：`~/.agentdev/config.toml` 与 Project 覆盖所需的最小 TOML 子集读写）
- `packages/core/src/model-gateway.ts`（新增：按冻结快照解析 Provider/模型、能力校验、连接测试缝）
- `packages/core/src/orchestrator.ts`（新增：Assessment 记录、DispatchSpec 校验与冻结、Run 建立、`request_dispatch` 与 `chief_action_required`）
- `packages/core/src/join.ts`（新增：Join/父唤醒/局部失败/等待中接消息）
- `packages/core/src/stage.ts`（新增：StageResult 契约、修正一次、二次 Schema 错误 `contract_violation`）
- `packages/core/src/index.ts`、`packages/domain/src/**`（仅补齐缺失判定）、`packages/contracts/src/entities/structures.ts`（仅在发现 Schema 缺口时）
- `packages/core/test/**`（新增测试）
- `.agentdev/work/WP-02/**`（过程记录）

readPaths: `docs/**`（主要 `rules/agents.md`、`rules/workflow.md`、`architecture/{ARCHITECTURE,data,protocol,reliability,context}.md`、`delivery/{implementation,acceptance}.md`）
不可写：`docs/**`（除结算时更新 `docs/INDEX.md` 的实现状态事实）、`packages/storage`、`packages/contracts`（除上述缺口）、`webui/**`、`docker/**`

## 3. tasks（DAG）

| id | 角色 | goal | dependsOn | acceptanceIds |
|---|---|---|---|---|
| T1 | backend | `core/config`：配置读写（TOML 子集、revision、边界校验）、继承解析（Run 参数→Project 覆盖→全局角色 Profile→全局默认模型）、能力校验（reasoning 受模型支持、contextLimit=min(profile,窗口−输出−4096)）、`config` 快照冻结 | — | AC-043, AC-044 |
| T2 | backend | `core/model-gateway`：由冻结快照解析 provider/model（禁止隐式换模型）、无可模型时 Work=blocked(provider)、连接测试缝（最小请求 stub，真实调用 WP-10） | T1 | AC-043, AC-044 |
| T3 | backend | `core/orchestrator`：Assessment 记录（不可变行 + `assessment.saved`）、等级判定复用 domain、修改授权与 L3 显式授权校验 | T1 | AC-045 |
| T4 | backend | `core/orchestrator`：DispatchSpec 校验与 `dispatch` 快照冻结（authRef/effectiveScope/输出 Schema/hash）、建立 Run（queued + `run.queued`、冻结三个快照 id）、父子不变式（仅 Chief 直接子级、同 Work、purpose×role 矩阵）、预算分配 | T2, T3 | AC-043, AC-045 |
| T5 | backend | `core/join`：join=none/all、父 Run 进入 waiting_children、子终态汇总（兄弟结果保留）、required 失败阻断 Gate 并产生 `chief_action_required`、等待中仍可接新消息 | T4 | AC-046 |
| T6 | backend | `core/orchestrator`：`request_dispatch`（专业 Agent）只产生 `chief_action_required` 持久事件与 Chief 待办，绝不创建孙 Run；非 Chief 父 Run 的分派请求拒绝 | T4 | AC-045 |
| T7 | backend | `core/stage`：StageResult 校验（status/summary/refs/ledger hash）、口头完成不改变状态、Schema 首次失败允许修正、二次失败 Attempt `contract_violation` 且 Run failed | T4 | AC-047 |
| T8 | backend | 重启窄范围：DispatchSnapshot 重载后 effectiveScope/输出 Schema 不变，Work 级宽范围不能替代（工具层负例归 WP-07） | T4 | AC-082 |
| T9 | backend | 测试与记录：失败测试（模型配置冻结、请求孙Run拒绝、父等待可接消息、子局部失败）、单元/集成、`docs/INDEX.md` 状态、结算材料 | T5,T6,T7,T8 | AC-043–047, AC-082 |

## 4. 接口与数据影响

- 新增 `ConfigStore`（`<globalDir>/config.toml` 与 `<projectStateDir>/config.toml`）、`resolveProfile`、`freezeConfigSnapshot`；新增 `snapshot` 行（type=config）与 revision 递增。
- 新增 `ModelGateway`（transport 注入，无真实网络调用）。
- 新增 `Orchestrator`：写入 `assessment`、`snapshot`(dispatch/config)、`run`、`event`；读取 `work`/`budget`/`task`。
- 不新增表、不改公开协议方法签名（`assessment.submit`、`agent.dispatch`、`agent.request_dispatch`、`stage.submit` 按 `protocol.md` §6 实现内核）。

## 5. 验证策略与必需失败测试

- 单元：TOML 子集读写与拒绝非法构造、配置继承与能力校验、快照冻结不可变、Join 判定。
- 集成（真实 SQLite）：Assessment→Dispatch→Run 全链事件与行、三个快照 id 冻结、父子不变式、Join 汇总与局部失败、request_dispatch 仅产生 Chief 待办、StageResult 两次 Schema 错误 → `contract_violation`。
- 必需失败测试：**模型配置冻结**（活动 Run 配置可查且不被后续修改影响，仅新 Run 生效；不支持 reasoning 值的配置被拒）、**请求孙Run拒绝**（专业 Run 的 request_dispatch 不产生 Run；父非 Chief 的分派被拒）、**父等待可接消息**（waiting_children 的 Chief Run 仍可接命令且不被阻塞）、**子局部失败**（一个 required 子失败：兄弟保留、父获全部结果、Gate 阻断）。
- 契约命令：`pnpm typecheck`、`pnpm lint`、`pnpm test:unit`、`pnpm test:integration`、`pnpm docs:check`、`pnpm build` 全部退出 0；`test:e2e|acceptance|live` 保持 NOT_IMPLEMENTED。
- 独立 Review/Test 在冻结点上复核（独立上下文，不读开发聊天）。

## 6. 风险与回退

- 风险：TOML 手写解析子集可能误读外部文件 → 只接受本模块写出的构造，遇不支持语法返回 `CONFIG_INVALID` 而不猜测；有测试覆盖。
- 风险：配置继承层数多易出偏差 → 解析结果带 `sourceOf` 逐字段来源，测试逐层断言。
- 风险：把 WP-05 的 ContextBuilder 职责误并入本包 → 本包只校验/冻结 `ContextSelection`，不解析知识内容。
- 回退：删除本包新增文件与 `index.ts` 导出即回到 WP-01 结算树；无新表、无数据迁移。
