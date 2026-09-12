# WP-06 实现 Plan（分级交付与独立验证）

- planVersion: 1
- workId: WP-06
- level: L2（在 `packages/domain` 增补交付规则、在 `packages/core` 增补 Gate/Finding/Decision/等级升级/需求继续的协调层；按 `docs/rules/workflow.md`、`docs/product/requirements.md`、`docs/architecture/{data,execution,reliability}.md` 既有定义实现，不改产品语义）
- authorization_ref: 用户目标轮次「继续」（2026-09-11）；上级授权为「我要完全实现这个产品，让你来实现」
- productRef: 无独立 Requirement；行为依据为 `docs/delivery/implementation.md` WP-06 与关联 AC（AC-007–022、AC-083、AC-089）
- 依赖：WP-02（Orchestrator/Run/Join，结算 `f9b61e0`）、WP-05（Context 层，结算 `681450d`，代码树 `0e047ab`）
- 基线：WP-05 结算提交 `681450d`

## 1. goal

让「分级交付」真实可用：L1 走一句话 Plan 的内部 Work/Task（无 Planning/Test Run、无看板建单、到 CAS 与 CompletionManifest 为止），L2/L3 走 Requirement/DAG 与 Plan/Develop/Review/Test/Settlement 的阶段 Manifest 链（L3 另有授权、回退、逐项审核与恢复演练证据）；document 路线只产出候选 Diff 并走独立 Review/Settlement；无批准 Plan 的写请求 `GATE_NOT_READY` 且源码 Hash 不变，合规 Plan 自动批准并留下依据；执行中的行为选择产生 Decision 并按「本次/以后/不采纳」分支推进，旧受影响证据失效；Finding 由 Review 触发、退回开发后必须新独立 Review/Test（Developer 不能自证），Test 的 `not_covered`/`blocked` 阻断完成；暂停/取消走安全点与子 Run 级联；预算并发预留超额原子拒绝；无 Task 文档的 Finding 绑定 Review 目标/Manifest，无需伪造 taskId；Git 中 active 需求可「待继续」并在用户继续后新建 Work 重新规划。

## 2. scope

writePaths:

- `packages/domain/src/delivery.ts`（新增：L1 边界与资格、等级升级判定、阶段顺序与 Gate 就绪、Decision 分支、Finding 生命周期、预算预留规则）
- `packages/domain/src/index.ts`、`packages/domain/test/**`
- `packages/core/src/gates.ts`、`packages/core/src/findings.ts`、`packages/core/src/decisions.ts`、`packages/core/src/requirement-continue.ts`、`packages/core/src/index.ts`、`packages/core/test/**`
- 必要时 `packages/contracts/src/{entities,enums,errors}.ts` 仅补既有字段/枚举（不改语义）
- `.agentdev/work/WP-06/**`

readPaths: `docs/**`、`packages/**`、`apps/**`
不可写：`webui/**`、`docker/**`、`docs/**`（除结算时更新 `docs/INDEX.md`）

## 3. tasks（DAG）

| id | role | goal | dependsOn | acceptanceIds |
|---|---|---|---|---|
| T1 | backend | `domain/delivery.ts`：L1 资格与边界（≤3 文件/≤20 行、无逻辑改动；一字符高风险 ⇒ L3 不降级）、超 L1 升级判定（Diff 超界/逻辑改动 ⇒ L2/L3 + 同 Work 关联 Requirement + 补齐 Gate + 拒绝旧 Plan）、阶段顺序与阶段 Manifest 有效性（Plan/Develop/Review/Test/Settlement；document 路线无代码测试/开发 Requirement）、Gate 就绪（无批准 Plan 的写请求 `GATE_NOT_READY`；合规 Plan 自动批准依据）、Decision 分支（本次 ⇒ 新 Product/Plan + 旧证据失效；以后 ⇒ Queued；不采纳 ⇒ 原因 + 当前验收不变）、Finding 生命周期（Review 触发、退回开发、Developer 不得自证、修复后旧结果失效、`not_covered`/`blocked` 阻断、无 taskId 绑定 Review 目标/Manifest）、预算预留（并发接近上限的原子拒绝与用户加额后继续） | — | AC-007..009, AC-012..019, AC-022, AC-083 |
| T2 | backend | `core/gates.ts` + `core/decisions.ts`：Gate/PlanRef 持久化与批准依据、写请求前的 Gate 校验（拒绝时源码 Hash 前后不变）、等级升级与 Requirement 关联、Decision 落库与 Product/Plan 版本推进、受影响证据失效标记 | T1 | AC-009, AC-013..016 |
| T3 | backend | `core/findings.ts` + `core/requirement-continue.ts`：Finding 提交/退回/关闭与新独立 Review/Test 的 Run 链（无 taskId 也能绑定 Review 目标/Manifest）、Test 未覆盖/阻塞的完成门禁、暂停/取消（安全点、子 Run 级联、cancelling/recovery→cancelled、成果保留不集成）、AC-089「待继续」与新 Work 重新规划 | T1, T2 | AC-017..021, AC-083, AC-089 |
| T4 | backend | 集成与必需失败测试（真实 SQLite ProjectStore + 契约桩，覆盖 L1 全链、L2 阶段链、document 路线、L3 授权/回退证据、Finding 闭环、暂停取消、预算并发），含**一字符高风险、超 L1 升级、过期 Plan、修复后证据失效、未覆盖阻断**五项必需失败测试 | T1–T3 | 全部 |
| T5 | backend | 独立 Review（fresh context）+ 修复 + 独立 Test + 结算 | T1–T4 | 全部 |

## 4. 接口与数据影响

- 复用 `packages/domain` 的 transitions/permission/dispatch/requirement 与 `packages/core` 的 `ProjectStore`、`StageGate`、`RunLifecycle`、`JoinCoordinator`、`RequirementProjection`。
- 新增 Core 协调模块与导出；仅在确需时补 contracts 既有字段/枚举；不新增协议方法（HTTP/WS 接线属 WP-09）。
- Run 工具与 Git 最终提交使用契约桩（本包只验证领域规则与阶段链），完整交付链在 WP-08/WP-10 复验。

## 5. 验证策略

- 单元：L1 边界与升级矩阵、Gate 正负例（无批准 Plan/过期 Plan/合规自动批准）、Decision 三分支与证据失效、Finding 生命周期与角色负例、`not_covered`/`blocked` 门禁、预算并发原子性、阶段顺序与 Manifest 链、document 路线无开发 Requirement。
- 集成（真实 SQLite）：L1 全链（无 Planning/Test Run）、L2 阶段链、document 候选 Diff 链、L3 授权/回退证据、Finding 退回→新 Review/Test 闭环、暂停→恢复新 Attempt、取消级联、AC-089 继续流程。
- 必需失败测试见上表 T4。
- 退出：本包必验范围通过；真实领域规则与角色契约检查通过；实际交付结果由 WP-08 串联验证。
