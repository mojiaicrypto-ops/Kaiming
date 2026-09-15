# WP-12 产品形态完成计划（最新，取代此前逐车道计划的收口部分）

状态：`Awaiting Plan Confirmation`（未开工；本文件只为核实与批准）
编制依据：`hardening-plan.md`（G1–G14 分组与 §3 诚实排除）、`T3-implementation.md` §11–§12 与 **附录 A（第一期权限规格，已冻结）**、以及本轮关于权限/密钥/网络/删除的讨论结论。
权限相关的最新口径以本计划 §3 与 `T3-implementation.md` 附录 A 为准；与之冲突的早期描述作废。

---

## 1. 目标与完成判据（"完整产品形态"的可观测定义）

**目标**：交付一个可按产品设计完整运营的形态——用户提需求、Chief 派发、专业 Agent 在隔离环境里长时间自主执行、交付经独立 Review/Test/Settlement 收口，全程可审计、可恢复、可运维。

**完成判据（七条全绿才算完成，缺一即未完成）**

1. **证据完整**：94 条 AC 全部有结论——产品路径 PASS，或按 `hardening-plan.md` §3 逐条写明"库级即正确层级 / 环境受限 / 已登记缺口（附用户决定）"；无未登记 FAIL/UNVERIFIED/MISSING。
2. **真实交付成功**：真实 Provider 下 L1/L2 纵向演练以**阶段成功**结束（不是 `stage.failed`），交付物可复核。
3. **用户面完整**：Inbox 能渲染并处理 permission / decision / 各类待办（含第一期新增的"敏感文件请你本人处理"待办）；board、Run 详情、项目切换与多项目隔离可用。
4. **隔离可信**：工具在容器内、只挂工作区、非 root、无宿主 home/守护数据目录；Runner 与每任务工作区达到"多任务并发不互写"。
5. **运维可用**：backup / restore / relocate、迁移保护、需求池随 Git 迁移均有真实复验。
6. **门禁可信**：干净树上一次跑通 `pnpm test:acceptance`（含浏览器与离线 drill），无并发写者、无偶发失败，证据绑定同一提交。
7. **文档同步**：协议/架构/验收/实施/Code Map/INDEX 与实际一致，Settlement 归档完成。

---

## 2. 现状（事实，作为计划起点）

- 已闭环：主链路（消息→Chief→派生授权→派发→真 Runner 子进程→真 Broker/账本→交付或拒绝）；角色工具面隔离；类型化拒绝；审计事件；读账本封条；进程组回收与 Grant 撤销；容器内工具执行（真 Docker）；多项目/初始化/单入口 BFF（T5）；运维原语（T6）在制。
- 已冻结未实施：**第一期权限规格** = `T3-implementation.md` 附录 A（三开关 + 敏感文件清单 + `configPolicy: strict|test`）。当前仍按旧逐次审批路径存在，但发布路径已不依赖它。
- 已知待关闭（本计划的工作量）：
  1. 拒绝后真子进程停摆（Runner/网关侧，发布期一条红在收口：`tool-permission-runner` 竞态）；
  2. 两条整机负例缺位（AC-046 并行子任务失败、AC-047 口头完成/两次不规范）；
  3. 验收在并行负载下偶发 1 例失败（AC-027 初始化、AC-054 水位类）；
  4. 隔离加固：Runner 入容器、容器内 Unix-socket 代理、每任务独立工作区；
  5. 真实 Provider 演练只证"链路成立"，未证"阶段成功"；
  6. 若干产品面缺口待裁决（§5 W8）。

---

## 3. 权限工作流（第一期，规格已冻结，不再讨论）

按 `T3-implementation.md` 附录 A 执行，分两步落地、可独立验收：

- **W1a（`strict` 落地）**：① 敏感文件表落到准入层（读/搜/编辑共用一处），命中即类型化拒绝 + 用户待办；② 环境操作"信封内自动放行"（不再触发逐次审批，审计保留）；③ 环回/私网/元数据与破坏性 Git 引用硬拦；④ 拒绝对数审计 + 验收口径同步（AC-049 按"Plan 时信封授权"解释；AC-048 证据改为越信封/私网/环回/敏感文件）。
- **W1b（档位小增量）**：`configPolicy: strict | test`（全局默认 `strict`、项目级覆盖、随 Run 冻结、仅人可设）；`test` 档放行应用配置、仍拒凭据档与纯密钥材料；非 `strict` 在 doctor/项目页/验收报告显著标记；放行同样审计。一对正负例。
- **W1 明确不做**：`open` 档、"环境类型"字段、打码/掩码档（先紧后按审计放宽，见附录 A.3）。
- **退掉**：逐次 `permission.request/respond`、`waiting_permission` 挂起与恢复、`once`+`inputHash` 绑定路径（代码保留、策略不再触发，第二期再删）。

## 4. 其余工作流

| 流 | 内容 | 车道 | 退出判据 |
|---|---|---|---|
| W2 用户面 | Inbox 渲染并处理 permission/decision/待办（含敏感文件待办） | T4 | 真浏览器 e2e 覆盖"出现→处理→消失" |
| W3 整机负例 | `join.sibling-failure`、`stage.contract-violation` 两条 e2e drill | T3 车道（本会话） | 两条检查 PASS 并进逐 AC 映射 |
| W4 真实交付 | live L1/L2 以阶段成功结束；查清 `stage.failed` 根因 | T2 + 持钥者 | `pnpm test:live` 全绿且阶段 success |
| W5 拒绝后停摆 | 复验 W1 后是否消失；仍在则修（含发布期那条红） | Runner/网关车道 | 拒绝后子进程继续下一轮 |
| W6 隔离与容量 | Runner 入容器 + 容器内 socket 代理 + 每任务工作区 | T10 | 多任务并发不互写；越界路径被文件系统层挡住 |
| W7 门禁稳定 | 并行偶发失败定位/根治；"先提交→单次全绿→绑定该提交"固化为流程 | 验收车道 | 连续两次干净树 `test:acceptance` 全绿 |
| W8 产品面裁决 | AC-011 L3 交互面、`context.preview`、`task.list/get`（G10 依赖）、AC-067 扩展面、AC-090 未推送展示、临时流（`token.delta`/`log.delta`/`heartbeat`）逐条裁决"做 / 按现状关闭 / 登记缺口" | 持钥者 | 每条有明确结论并入验收文档 |
| W9 收口 | 证据登记、验收报告、文档与索引同步、Settlement 归档 | Settlement | 完成判据七条全绿 |

## 5. 顺序与约束

1. **先收口发布红**（外部在制）；本计划 W1 不得与其并行改同一批文件。
2. W1a → W1b → W3 → W2/W4 并行 → W6 → W7 → W8 裁决 → W9。W5 视 W1 后复验结果决定是否插入。
3. **单一写者**：`scripts/**`、`apps/daemon/src/protocol.ts`、`apps/daemon/src/{prepare-run,control-handler,main}.ts`、`packages/core/src/context/**` 任一时刻只允许一个车道改；跨车道改动先报持钥者。
4. **无迁移、无表列**：W1–W3 不得新增数据库列/迁移（沿用现有 `tool_operation.targets` 与 Decision 绑定）。
5. **验收流程**：先提交 → 再在干净树跑一次 → 报告绑定该提交；同一批次禁止并发写者、禁止中途 commit。
6. 每个工作流独立 Review + Test；实现者不自证。

## 6. 风险与回滚

| 风险 | 缓解 |
|---|---|
| W1 与发布红并行导致回归 | 严格串行；W1 只在红收口后开工 |
| `strict` 太紧影响自主运行（Java/Spring 配置不可读） | 刻意取舍（附录 A.3）；靠拒绝审计数据放宽；`test` 档给测试环境 |
| 网络开 + 工作区已提交密钥外传 | 敏感文件拒读 + 密钥不进环境；残余风险已知并记录（附录 A.5） |
| 真实 Provider 不可得 → W4 不可验收 | 无 Provider 时 W4 记 UNVERIFIED 并保留已登记豁免，不得以库级证据充抵 |
| 并行偶发失败掩盖真回归 | W7 未完成前，任何单次红都需单独复跑取证再定性 |

**回滚**：各工作流互不依赖；W1 只需把策略从"自动放行"切回逐次审批即恢复旧行为（代码未删）；W1b 只需把 `configPolicy` 置回 `strict`；无数据迁移，无需回滚脚本。

## 7. 非目标（本计划不做）

- 第二期评估项：Core 侧恢复审批、特权操作声明式化、凭据代理注入（附录 A.8）。
- 新增权限档位（`open`）、环境类型字段、打码档。
- 未经裁决就实现 W8 中的产品面缺口。
- 由实现方自行宣布验收通过；结论以独立 Test/Settlement 为准。

## 8. 批准

```yaml
plan:
  task: WP-12 产品形态完成
  goal: 达到 §1 七条完成判据，形成可按产品设计完整运营的形态
  requirements: [AC-003, AC-005, AC-010, AC-027, AC-032, AC-045, AC-046, AC-047, AC-048, AC-049, AC-054, AC-069, AC-080]
  in_scope: [W1 权限第一期, W2 用户面, W3 整机负例, W4 真实交付, W5 拒绝后停摆复验, W6 隔离与容量, W7 门禁稳定, W8 产品面裁决, W9 收口]
  out_of_scope: [附录 A.8 三条二期项, open 档, 环境类型字段, 打码档, 未裁决的实现]
  tasks: 见 §3/§4 各流
  review_focus: [权限收紧与自主运行的平衡, 拒绝后恢复, 隔离边界, 验收门禁可信度]
  test_plan: [pnpm typecheck, pnpm test:unit, pnpm test:integration, node scripts/e2e.mjs, node scripts/acceptance.mjs, pnpm test:live（需持钥者提供 Provider）, pnpm docs:check, pnpm lint]
  document_impact: [docs/architecture/protocol.md, docs/delivery/acceptance.md, docs/INDEX.md, .agentdev/work/WP-12/*]
  risks: 见 §6
  rollback: 见 §6
  approval: pending
```
