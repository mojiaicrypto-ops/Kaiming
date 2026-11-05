# WP-06 结算（Settlement）

- 工作包：WP-06 分级交付与独立验证（`docs/delivery/implementation.md`）
- 等级：L2；Plan `.agentdev/work/WP-06/plan.md`（planVersion 1）
- 关联验收：AC-007、AC-008、AC-009、AC-010、AC-011、AC-012、AC-013、AC-014、AC-015、AC-016、AC-017、AC-018、AC-019、AC-020、AC-021、AC-022、AC-083、AC-089
- 基线提交：`681450d`（WP-05 结算）
- **验证代码树：commit `b0d226f`，tree `4700ab764a4ed30110c3326ea3ef1fe9765fc266`**
- 证据提交：`793e7c8`（Review 第 4 轮 PASS）与各修复提交；独立 Test 报告 `.agentdev/work/WP-06/test.md`（本轮随附）；本结算提交只新增/更新 `.agentdev/work/WP-06/` 与 `docs/INDEX.md`，**代码树未变**
- 证据目录：`.agentdev/work/WP-06/`（plan / implementation T1～T9 / review 第 1～4 轮 / test / settlement）
- **整改复核说明（Test T-01 [P2]）**：`b0d226f`（W6R4-01/02 修复）晚于第 4 轮 Review 冻结点 `43c10ce`，未再单独开第 5 轮 Review。按 T-01 允许的替代口径**明确记录复用**：该改动正是第 4 轮点名、由 Test 复验的两项，独立 Test（`test.md`，自建 762 断言 0 失败、exp10 对抗旁路 25/25）已独立复现「仅 Test Run 不能完成 L2/L3」与「Review 完成结果字段正确」，并复跑契约命令与集成链。据此不作无证据的 Review 声明，也不把它留作静默缺口。

## 1. 实际 Diff

| 类别 | 内容 |
|---|---|
| 领域规则 | `packages/domain/src/delivery.ts`（新增）：L1 资格与边界（≤3 文件/≤20 行、无逻辑改动；一字符高风险 ⇒ L3 不降级）、等级升级（同 Work 关联 Requirement、旧 Plan stale/invalid、补齐 Gate）、L2/L3/document/operation 阶段链与结构化证据（L3 回退/逐项审核/恢复演练为 Ref）、写入门禁与 Plan 自动批准（含 token 预留）、Decision 三分支与证据失效、Finding 生命周期与完成门禁、**证据有效性 + Revision 血缘共享规则**、写屏障白名单、原子预算预留 |
| Core 协调 | `packages/core/src/gates.ts`（`PlanGateService`：Plan 以 artifact 持久化、批准/失效/版本用不可变 snapshot、决策前后测量源码 Hash 与全表行数、升级 supersede 该 Work 全部批准记录）、`decisions.ts`（`DecisionService`：版本单调、失效证据记录）、`findings.ts`（`FindingService`：提交/修复/验证/完成 + 暂停/恢复/取消与屏障、按 intent 推导完成路线、代码 L2/L3 需 Review+Test 双证据）、`requirement-continue.ts`（`RequirementContinuation`：待继续不建 Run、继续创建 Work+授权+未满足 Gate） |
| 测试 | `packages/domain/test/delivery.test.ts`、`packages/core/test/{gates,decisions,findings,requirement-continue}.test.ts`、`delivery-failures.test.ts`（五项必需失败测试）、`delivery.integration.test.ts`（端到端链） |
| 记录 | `.agentdev/work/WP-06/**`（4 轮独立 Review、1 轮独立 Test、T1～T9） |

`docs/` 只在本次结算更新 `docs/INDEX.md` 的实现状态。

## 2. 工程命令结果（独立 Test，tree `4700ab76`）

| 命令 | 退出 | 结果 |
|---|---|---|
| `pnpm typecheck` | 0 | strict 无错误 |
| `pnpm lint` | 0 | Prettier + 类型感知规则通过 |
| `pnpm test:unit` | 0 | 38 文件 / **757** 用例 |
| `pnpm test:integration` | 0 | 11 文件 / **132** 用例（含真实 Docker 容器 doctor/container） |
| `pnpm docs:check` | 0 | 15 documents / 55 links / 94 AC / 9 REQ / 11 WP |
| `pnpm build` | 0 | 10 workspace |
| `pnpm test:e2e` / `test:acceptance` / `test:live` | 1 | 按契约 `NOT_IMPLEMENTED`（WP-09 / WP-10） |

Test 自建实验（`/tmp/wp06t/`，真实 SQLite ProjectStore/BlobStore + 确定性时钟，不 import 产品测试文件）：**10 组 / 762 断言 / 0 失败**。

### 必需失败测试（`docs/delivery/implementation.md` WP-06）

| 必需失败测试 | 覆盖证据 |
|---|---|
| 一字符高风险 | 域 `classifyChange` + Test exp7：permission/interface/payment 一字符改动 ⇒ L3，行数不可降级 |
| 超 L1 升级 | 域 + core + Test exp2/exp7：≥4 文件/≥21 行或逻辑改动 ⇒ 升级 + 同 Work Requirement + 旧 Plan stale/invalid + 写被拒 |
| 过期 Plan | `delivery-failures.test.ts` + Test exp7：无批准/被取代/异 revision/源码移动 ⇒ `GATE_NOT_READY`，源码 Hash 与行数不变 |
| 修复后证据失效 | Finding 失效修复前 Review/Test 产物；完成与关闭均走共享证据规则，被失效证据不可再用（Test exp4/exp7/exp10） |
| 未覆盖阻断 | `blocked` 永不完成、`not_covered` 逐条需已接受风险处置（Test exp4/exp7） |

## 3. 独立验证

- **Review**：4 轮独立 Review（round 1 FAIL 2×P1；round 2 FAIL 1×P1；round 3 FAIL 1×P1；round 4 **PASS**）。每轮 P1 均由下一轮独立复核为闭合；round 4 另记 1×P2/1×P3，已在本轮修复并由 Test 独立复验（见文首整改复核说明）。
- **Test**：1 轮独立 Test **PASS**（AC-007～022、083、089 全部接受；AC-011/AC-022 的「真实迁移输出/完成期预算复核」标 UNVERIFIED 并承接 WP-08/WP-10；1×P2 + 3×P3 带账）。
- 关键收敛：从「补丁式修洞」转为**单一共享原语**（证据有效性 + Revision 血缘 + 写屏障白名单 + 按 intent 推导完成路线），两轮内把证据生命周期类 fail-open 收敛到 0。

## 4. 验收对应

| AC | 结论 | 主要证据 |
|---|---|---|
| AC-007 L1 错字 | 通过 | 一句话 Plan 内部链到 CompletionManifest + 契约 CAS 桩；无 Planning/Test Run、无看板/Requirement 建单 |
| AC-008 一字语义 | 通过 | 一字符权限/金额/接口 ⇒ L3，行数不可降级 |
| AC-009 L1 升级 | 通过 | 超界/逻辑改动升级、同 Work 关联 Requirement、旧 Plan stale+invalid（含无 baseRevision 形状） |
| AC-010 标准交付 | 通过 | L2 阶段链与双证据完成门（Review+Test） |
| AC-011 L3 | 通过（真实演练 UNVERIFIED） | 授权/回退/逐项审核/恢复演练均需结构化 Ref；真实迁移与恢复输出承接 WP-08/WP-10 |
| AC-012 Document 路线 | 通过 | 候选 Diff + 独立 Review + Settlement，无代码测试、无开发 Requirement |
| AC-013 Gate | 通过 | 无批准/过期 Plan ⇒ `GATE_NOT_READY` 且零写入；授权撤销/收窄拒绝；源码移动检测可达 |
| AC-014 自动批准 | 通过 | 合规 Plan 自动批准 + 依据 + token 预留；越界/产品变化/异 revision 拒绝 |
| AC-015/016 Decision | 通过 | now ⇒ 新版本 + 证据失效；later ⇒ Queued；decline ⇒ 原因 + 验收不变 |
| AC-017/018 Finding | 通过 | 自动返工、失效旧证据、Developer 不得自证、Revision 绑定 + 结论 passed 才 verified |
| AC-019 未覆盖 | 通过 | `blocked`/`not_covered`/未关闭阻塞 Finding 阻断完成；代码 L2/L3 需 Review+Test |
| AC-020/021 暂停取消 | 通过 | 安全点暂停、版本校验后新 Attempt、级联取消保留产物不集成；写屏障白名单 |
| AC-022 预算 | 通过（完成期复核 UNVERIFIED） | 超额原子拒绝、批准即预留、返工额度耗尽拒绝；完成期 used+reserved 复核承接 WP-08 |
| AC-083 组合 Finding | 通过 | 无 taskId 绑定 Review 目标/Manifest；外来 Task/Developer 提 Finding 拒绝 |
| AC-089 继续需求 | 通过 | 待继续纯投影、不建 Run、继续创建新 Work+本地授权+未满足 Gate、不复用旧验证 |

## 5. 未决项与承接包（显式登记）

| 项 | 性质 | 承接 |
|---|---|---|
| 真实 Git CAS、CompletionManifest/VerificationManifest 写入方与清单覆盖度核对 | 未接线 | WP-08 / WP-10 |
| AC-011 真实迁移/回退执行与恢复演练记录、AC-022 完成期预算复核 | UNVERIFIED | WP-08 / WP-10 |
| Broker/Grant/容器工具级写准入、Attempt epoch 语义统一（Test T-04） | 未实现 | WP-07 |
| operation 路线 Verify 证据规则、完成事件 schema 扩展、`CompletedTestEvidence` 命名、Review 结论细分 | P3 已登记 | WP-08 |
| 无 baseRevision 的需求继续形状写入/完成 fail-closed；intent 与 route 对齐 | 已登记 | WP-08 |
| Test T-02（空 `uncovered` 的 `not_covered` 无可处置条目）、T-03（未知 state 兜底） | P3 观察 | 后续修复轮 |
| 容器挂载级隔离负例、HTTP/WS/BFF、真实 Provider 纵向 | 未实现 | WP-07 / WP-09 / WP-10 |

## 6. 完成清单（CompletionManifest）

- [x] Plan 与实现记录（T1～T9）齐备，含全部残余与承接登记
- [x] 4 轮独立 Review（末轮 PASS）与 1 轮独立 Test（PASS）落库；`b0d226f` 的整改由 Test 独立复验并按 T-01 口径明确记录复用
- [x] 六条契约命令在冻结树上退出 0（含真实容器集成 132/132）；`e2e/acceptance/live` 按设计 `NOT_IMPLEMENTED`
- [x] 五项必需失败测试独立复现
- [x] AC-007～022、083、089 有证据（AC-011/AC-022 的 UNVERIFIED 项明确登记）
- [x] `docs/INDEX.md` 实现状态更新（本次结算唯一 docs 变更）
