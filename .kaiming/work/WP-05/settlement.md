# WP-05 结算（Settlement）

- 工作包：WP-05 Context隔离与冷启动（`docs/delivery/implementation.md`）
- 等级：L2；Plan `.agentdev/work/WP-05/plan.md`（planVersion 1）
- 关联验收：AC-030、AC-031、AC-032、AC-033、AC-034、AC-035、AC-036、AC-079、AC-085、AC-093
- 基线提交：`ce8c64d`（WP-04 结算）
- **验证代码树：commit `0e047ab`，tree `da20f0c5ef8743164cc39f5847a11821d895ab1b`**
- 证据提交：`164a34f`（Review 第三、四轮报告）、独立 Test 报告（`test.md`，本结算随附）；本结算提交只新增/更新 `.agentdev/work/WP-05/` 与 `docs/INDEX.md`，**代码树未变**
- 证据目录：`.agentdev/work/WP-05/`（plan / implementation T1～T9 / review 第 1～4 轮 / test / settlement）
- 冻结提交总数：`ce8c64d..0e047ab` 共 7 个提交；Diff **7 个源码/测试文件 + 1 个记录文件（首个提交）**，新增约 4.6k 行

## 1. 实际 Diff

| 类别 | 内容 |
|---|---|
| Context 基础 | `packages/core/src/context/types.ts`（角色/阶段/来源类别/ReadScope/ResolvedSource/ContextSnapshot/ContextGap、transcript 拒绝清单、artifact 生产阶段表）、`acl.ts`（角色×阶段 ACL、readScope、逐条拒绝与原因）、`requirements.ts`（19 个合法 role:stage 的必需项表、AC-079 正负例、选择 reason 缺口检查） |
| ContextBuilder | `builder.ts`（选择校验 → ACL 授权先于解析 → revision/version/path/hash 身份钉死 → 预算记账与丢弃记录 → 必需项评估 → 内容寻址不可变快照冻结；端口异常一律封闭 `INTERNAL_ERROR`；不自动展开模块） |
| read ledger | `ledger.ts`（scope 内追加、seq/path/revision/hash/reason/size、预算先 initial 后 expansion、`context.request`+grant 扩展且不得丢永久拒绝、`seal()`/`verifySeal()` 封口与旧 Hash 拒绝、冻结深拷贝读取面） |
| Checkpoint | `checkpoint.ts`（`context.md` §5 全字段 + 归属身份 + 显式 approval；只读本 Run；会话轮换；Compaction 不改批准状态；历法时间严格校验；`summaryOf` 无 approval 字段） |
| 冷启动 | `cold-start.ts`（种子 = 固定规则 + Project 概览 + 领域摘要 + 可选恢复位；按 §1 顺序的有理由选择；20 份无关文档不注入；transcript 双重把关 + realpath 包含性；仅从已准入 Feature 作答） |
| 测试 | `packages/core/test/context-{acl,requirements,builder,ledger,checkpoint,cold-start}.test.ts`（213 例） |
| 记录 | `.agentdev/work/WP-05/**`（4 轮独立 Review、1 轮独立 Test、T1～T9） |

`docs/` 只在本次结算更新 `docs/INDEX.md` 的实现状态（技术事实/索引更新，无产品语义或规则改动）。

## 2. 工程命令结果（独立 Test，tree `da20f0c5`）

| 命令 | 退出 | 结果 |
|---|---|---|
| `pnpm typecheck` | 0 | strict 无错误 |
| `pnpm lint` | 0 | Prettier + 类型感知规则通过 |
| `pnpm test:unit` | 0 | 32 文件 / **644** 用例 |
| `pnpm test:integration` | 0 | 10 文件 / **124** 用例（含 9 例真实 Docker 容器） |
| `pnpm docs:check` | 0 | 15 documents / 55 links / 94 AC / 9 REQ / 11 WP |
| `pnpm build` | 0 | 10 workspace |
| `pnpm test:e2e` / `test:acceptance` / `test:live` | 1 | 按契约 `NOT_IMPLEMENTED`（WP-09 / WP-10） |

Test 自建实验（`/tmp/wp05t/`，外置夹具、不 import 产品测试文件）：**11 组 + 4 个最小复现，307 断言**（306 通过，唯一失败为 T-01 的证据断言）。

### 必需失败测试（`docs/delivery/implementation.md` WP-05）

| 必需失败测试 | 覆盖证据 |
|---|---|
| 跨项目/Transcript 攻击 | ACL/ledger/cold-start 三处独立复现：跨 Project 先于路径判断拒绝且无正文；transcript 对全角色×阶段拒绝、review/test 连 message 正文也拒；误导聊天不改变冷启动答案（容器挂载级负例承接 WP-07） |
| Snapshot 失效 | 源文件改动后重建 ⇒ `STALE_ARTIFACT`，已冻结目录字节不变；声明 hash/version/revision 与解析结果不一致一律拒绝且不落快照 |
| 预算不足 | 必需源超限 ⇒ `BUDGET_EXCEEDED` 点名 ref+缺口，可选源超限入 excluded/unknowns，0 预算封闭，非法预算 `VALIDATION_ERROR`，绝不全库注入 |
| 冷启动关联召回 | 固定样例（订单/支付/会话）召回当前取消行为、支付约束、测试路径与已知差距；20 份无关文档 0 注入；预算不足的 Feature 不以未计费正文出现 |

## 3. 独立验证

- **Review**：4 轮独立 Review（round 1 FAIL 3×P1；round 2 FAIL 2×P1；round 3 PASS；focused round 4 PASS）。所有 P1 均由下一轮独立复核为闭合。
- **Test**：1 轮独立 Test **PASS**（10/10 AC 通过；1×P2 + 3×P3 带账）。
- 关键 P1 闭合：覆盖层不得替换选择声明的 path/hash/version（AC-030/093）、冷启动语料符号链接逃逸、artifact 类别与路径不一致导致的未来产物读取。

## 4. 验收对应

| AC | 题目 | 结论 | 主要证据 |
|---|---|---|---|
| AC-030 | Chief选上下文 | 通过 | 选择逐字节冻结、身份（path/version/revision/hash）由选择钉死、冻结目录不可变、重复冻结幂等 |
| AC-031 | 缺上下文 | 通过 | 缺有效 Plan ⇒ `MISSING_CONTEXT` 点名缺口且不落快照；断言不能顶替 artifact 类必需项 |
| AC-032 | 追加读取 | 通过 | scope 内有理由追加并记账；更广读取只经 `context.request`+grant，且授权不得丢永久拒绝 |
| AC-033 | 独立审核 | 通过（含承接） | transcript 全角色拒绝、review/test 无 message 正文、返回对象无聊天正文、误导聊天不影响答案；容器挂载负例承接 WP-07 |
| AC-034 | 跨项目隔离 | 通过（含承接） | 跨 Project 在任何路径/类别判断前拒绝且无正文、resolver 0 次；外来 Run/Project/Work/角色读 Checkpoint 无内容 |
| AC-035 | 会话轮换 | 通过 | §5 全字段往返、轮换只换 Session、Compaction/Summary 不改批准状态；落库承接 WP-08 |
| AC-036 | 预算不足 | 通过 | 报告具体缺口、丢弃项入 excluded/unknowns、0 预算封闭、拒绝全库注入 |
| AC-079 | 初始阶段上下文 | 通过 | 四个 bootstrap 正例（空项目 initialize/Product/Planning 有 ProductDefinition/L1 仅 CompactPlan）与四个真缺上游负例；表内无未来产物依赖 |
| AC-085 | 证据读取封口 | 通过 | 封口绑定末 seq/hash；封口后再读/再请求 `INVALID_STATE`；旧 seq/错 hash `STALE_ARTIFACT`；重复封口幂等 |
| AC-093 | 需求目录与正文一致性 | 通过（本包负责面） | 同 Revision 两源按该 revision 冻结；跨 revision/改字节 ⇒ `STALE_ARTIFACT`；声明 hash 钉住内容；原子提交与 UI 演练属 WP-04/WP-08 |

## 5. 未决项与承接包（显式登记）

| 项 | 性质 | 承接 |
|---|---|---|
| **T-01**：默认 `document-root=docs/agentdev` 的正式概览未被 `PATH_INPUT_RULES` 映射到 `projectOverview`，Product 阶段被迫自报 `bootstrapObservation` | P2，fail-closed，一行目录映射 + 回归用例 | WP-08 接线前的小修 |
| **T-02**：`Checkpoint.stage` 只校验非空不校验词表 | P3 | WP-08 状态存储 |
| **T-03**：`implementation.md` 残余 10 与代码（extraTokens 已按 4096–2000000 校验）措辞不一致 | P3 记录 | 本结算已订正（见 T9 + 本文件） |
| **T-04**：`buildContext` 返回的 `ContextSnapshot` 未深冻结、`selection` 与调用方同引用 | P3（磁盘冻结树只有 hash，不受影响） | WP-08 接线时深冻结 |
| **W5R4-01**：gate 提供的角色契约以 `gates.policyRevision` 冻结而 `version` 固定为 `'1'` | P3，fail-closed | WP-08 传真实 policyRevision |
| **W5R4-02**：额外（仅 `contextSources`）提供的 message/artifact 句柄丢失 sender/artifactClass 元数据 | P3，fail-closed，有文档化绕行 | WP-08 |
| **W5R2-12**：transcript 路径网仍是名称族（未做语义分类） | P3，结构防线（kind/corpus/realpath）仍在 | 语义/DLP 演进 |
| **W5R1-13**：Checkpoint 读者 Run capability/epoch 绑定 | P3 | WP-01 / WP-07 |
| **容器挂载级负例**（AC-033/AC-034 的「ACL及容器负例」「挂载负例」） | UNVERIFIED | WP-07 |
| Checkpoint 落库（`attempt.checkpoint_ref/session_ref`、`snapshot(type='checkpoint')`）、`stage_result.read_ledger_*` 与 `SnapshotWriter.freeze('context', …, {identityPayload})` 的真实接线 | 未接线 | WP-08 / WP-09 |
| readBudget 的最终上界 `min(Profile.contextLimit, 模型窗口−maxOutput−4096)` | 缺 Profile 输入 | WP-08 / WP-09 |
| 真实两轮交付后的冷启动召回质量、真实 Agent Review 闭环、`test:e2e/acceptance/live` | 未实现 | WP-08 / WP-09 / WP-10 |

## 6. 完成清单（CompletionManifest）

- [x] Plan 与实现记录（T1～T9）齐备，含全部 fail-closed 代价、残余边界与承接登记
- [x] 4 轮独立 Review（末两轮 PASS）与 1 轮独立 Test（PASS）报告落库；代码树在 Test 后未变（`0e047ab` / tree `da20f0c5`）
- [x] 六条契约命令在冻结树上退出 0（含真实容器集成 124/124）；`e2e/acceptance/live` 按设计 `NOT_IMPLEMENTED`
- [x] 四项必需失败测试独立复现
- [x] AC-030～036、079、085、093 有证据（AC-033/034 的容器挂载级负例明确标 UNVERIFIED 并承接 WP-07）
- [x] `docs/INDEX.md` 实现状态更新（本次结算唯一 docs 变更）
