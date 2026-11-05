# WP-04 结算（Settlement）

- 工作包：WP-04 知识与新旧项目（`docs/delivery/implementation.md`）
- 等级：L2；Plan `.agentdev/work/WP-04/plan.md`（planVersion 1）
- 关联验收：AC-025、AC-026、AC-027、AC-028、AC-029、AC-037、AC-038、AC-039、AC-040、AC-042、AC-086、AC-087、AC-088、AC-092、AC-093
- 基线提交：`5171ef2`（WP-03 结算）
- **验证代码树：commit `88a5690`，tree `2a79088b93ee8c997bf7061bc2f467024e9d620b`**
- 证据提交：`96a2f5c` + `1f815d4`（独立 Test 第一/二轮报告，均 PASS）、`f80092f`/`909a49b`（Review 第二/三轮）、第四轮 Review 报告（追加于 `review.md`）；本结算提交只新增/更新 `.agentdev/work/WP-04/` 与 `docs/INDEX.md`，**代码树未变**
- 证据目录：`.agentdev/work/WP-04/`（plan / implementation / review / test / settlement；发现项按 T1～T13 记入 `implementation.md`）
- 冻结提交总数：`5171ef2..88a5690` 共 10 个提交；Diff **29 个路径、+14173/−0**

## 1. 实际 Diff

| 类别 | 内容 |
|---|---|
| 新 workspace | `packages/knowledge`（`@agentdev/knowledge`）、`packages/workspace`（`@agentdev/workspace`）；根 `tsconfig.json` 与 `vitest.config.ts` 的路径别名、`pnpm-lock.yaml` 的 link 记录；构建由 8 个 workspace 变为 **10** |
| 知识层 | `model.ts`（Feature 字段/枚举/关系/空值标记）、`feature-format.ts`（Markdown 解析 + `context.md` §2 全部校验规则、`parseFeatureSet` 重复 ID 检测、占位符 vs 内联 HTML 判别）、`relations.ts`（来源解析与断链诊断）、`projection.ts`（索引/README/CODE_MAP/PROJECT 渲染、`ProjectionCache`、stale 保留、断链门禁 `deliveryBlockedByLinks`）、`views.ts`（design/delivered/work 三视图、差距、observed/confirmed）、`requirements-pool.ts`（需求池解析、组合 Hash、导入幂等、逐条冲突、历史摘要） |
| 工作区层 | `git-port.ts`（`GitPort`/`NodeGitPort`/`MemoryGitPort`）、`scan.ts`（realpath/嵌套仓库/排除/40 文件 512 KiB 预算/10000 条分页索引/候选知识与候选文档、`(root)` 模块键、`emptyProject` 语义、document-root 逃逸拒绝）、`initialize.ts`（状态机、JSON/内存状态存储、Hash 恢复、内容冲突不覆盖、脏工作区门禁、无 Git 授权门禁、`investigateMore`/`confirmNoCapability`、Ready 最小门禁） |
| 测试 | `packages/knowledge/test/**`（5 文件）、`packages/workspace/test/**`（2 文件） |
| 记录 | `.agentdev/work/WP-04/**`（4 轮独立 Review、2 轮独立 Test、T1～T13） |

`docs/` 只在本次结算更新 `docs/INDEX.md` 的实现状态（技术事实/索引更新，无产品语义或规则改动）。

## 2. 工程命令结果（独立 Test 第二轮，tree `2a79088b`）

| 命令 | 退出 | 结果 |
|---|---|---|
| `pnpm typecheck` | 0 | strict 无错误 |
| `pnpm lint` | 0 | Prettier + 类型感知规则通过 |
| `pnpm test:unit` | 0 | 26 文件 / **431** 用例 |
| `pnpm test:integration` | 0 | 10 文件 / **124** 用例（含真实 Docker 容器；第二轮宿主负载回落后全通过） |
| `pnpm docs:check` | 0 | 15 documents / 55 links / 94 AC / 9 REQ / 11 WP |
| `pnpm build` | 0 | **10** workspace |
| `pnpm test:e2e` / `test:acceptance` / `test:live` | 1 | 按契约 `NOT_IMPLEMENTED`（WP-09 / WP-10） |

Test 自建实验（`/tmp/wp04t2/`，外置夹具、不 import 产品测试文件、真实临时目录与真实 `git`）：**9 组 / 697 断言 / 0 失败**。

### 必需失败测试（`docs/delivery/implementation.md` WP-04）

| 必需失败测试 | 覆盖证据 |
|---|---|
| 初始化中断 | `initialize.test.ts` + Test exp6：注入写失败 → `interrupted`（recoverable）、回执保留、`resume` 按内容 Hash 续写至 Ready；内容冲突不覆盖且处置前拒绝 resume |
| 非法 Feature | `feature-format.test.ts`（45 例）+ Test exp4：12 类非法格式全部 `KNOWLEDGE_INVALID` 并指名字段；不发布、保留最后有效并标 stale |
| 重复 ID | `parseFeatureSet` 重复 ID 检测 + Test exp4：两份同 ID 文档都被排除、绝不合并 |
| 断链 | `relations.test.ts` + `projection.test.ts` + Test exp3：关系目标/来源/证据引用不可解析 → 诊断；命中当前需求时 `deliveryBlockedByLinks=true` |
| 代码设计冲突 | `scan.ts detectKnowledgeConflicts` + `initialize.test.ts` + Test exp6：已确认文档与观察事实冲突 → Confirming 阻断、候选保持 `design=unconfirmed`、逐条用户决定后才继续 |

## 3. 独立验证

- **Review**：4 轮独立 Review（round 1 FAIL 1×P1；round 2 FAIL 1×P1；round 3 PASS；round 4 PASS）。关键 P1 均由下一轮独立复核为闭合：根级项目 Ready 死锁（W4R1-01）、预算耗尽被当作「明确空项目」（W4R2-01）。
- **Test**：2 轮独立 Test 均 **PASS**（第一轮 14/15 AC 通过 + 2×P2；第二轮在修复树上 14/15 AC 通过 + 1×P3），5 项必需失败测试全部独立复现。
- **口径与残余**：`implementation.md` T9～T13 逐条登记承接项与 fail-closed 代价；无 P0/P1 遗留。

## 4. 验收对应

| AC | 题目 | 结论 | 主要证据 |
|---|---|---|---|
| AC-025 | 空项目 | 通过 | 空目录 → `git init -b agentdev/main` + 空初始提交 + 四入口候选文档；设计仍 `unconfirmed` |
| AC-026 | 旧项目初始化 | 通过 | 预算内调查（≤40 文件 / 512 KiB）、来源 `git:<sha>:<path>`、未知显式、代码零移动、无交付 Requirement |
| AC-027 | 目录项目 | 通过 | 无 Git 只读调查可用；正式写入前返回 `NOT_AUTHORIZED` + Git 初始化请求 |
| AC-028 | 脏工作区 | 通过 | 逐路径 sha256 阻断交付、内容零改动、只读调查不受影响、假称已提交被拒 |
| AC-029 | 初始化冲突中断 | 通过 | Hash 恢复、冲突不覆盖、Ready 六项最小门禁 |
| AC-037 | 当前功能 | 通过 | 冷启动单次 `delivered` 查询得到最新行为与约束，不注入无关文档 |
| AC-038 | 状态分离 | 通过 | design/delivered/work 严格分离，Work 覆盖层不污染其他视图 |
| AC-039 | 语义关系 | **部分通过** | 关系/来源/断链诊断与需求范围阻断成立；将约束注入 ContextSelection/Snapshot 属 WP-02 AC-030 与 WP-05 |
| AC-040 | 非法知识 | 通过 | 非法格式拒绝发布、保留最后有效并标 stale；断链为诊断、命中当前需求时阻断 |
| AC-042 | 观察与意图 | 通过 | `observed_not_confirmed`/`confirmed_not_observed` 分离，观察不擅自认可为意图 |
| AC-086 | 功能状态证据 | 通过 | confirmed/passed/investigated 的证据与 Revision 规则正负例齐全 |
| AC-087 | 需求池随 Git 迁移 | 通过（Git 面） | 真实 `git clone` 到空白服务器后恢复需求 ID/目标/范围/验收/结论，无需重新初始化 |
| AC-088 | 历史需求展示 | 通过（Git 面） | completed/cancelled/archived 摘要、取消原因、归档前状态保留；标「详细证据未迁移」且不计本机验证 |
| AC-092 | 需求导入冲突与幂等 | 通过（Git 面） | 6 类冲突逐条 `REQUIREMENT_CONFLICT`、两次导入幂等、本机版本与记录版本分离 |
| AC-093 | 需求目录与正文一致性 | 通过（解析面） | 两文件共享版本、组合 Hash 随正文变化、README 可重建、缺失/坏 Hash/旧格式逐条明示 |

## 5. 未决项与承接包（显式登记）

| 项 | 性质 | 承接 |
|---|---|---|
| `feature_projection` 的 SQLite 落地、交付分支提交/CAS、候选文档结算 | 未实现 | WP-08 |
| `requirement.save` 的 Git 原子提交与保存竞争/崩溃恢复 | 未实现 | WP-05 / WP-08 |
| 约束与来源注入 ContextSelection/Snapshot（AC-039 选择链路） | 未接线 | WP-02 AC-030 / WP-05 |
| 需求两文件同 Revision 在 Product/Plan 装载时的冲突拦截 | 未接线 | WP-05 / WP-06 |
| 需求池独立 SQLite + Core/UI 端到端演练（W4R1-03） | 未落地 | WP-08 / WP-10 |
| `document-root` 逃逸在工厂构造期抛 `WorkspaceError`（W4R4-05） | 已登记口径（fail-closed） | WP-08 协议层翻译为 `VALIDATION_ERROR` |
| 阻断态重复 `step` 仍追加证据行（W4R3-07） | P3 已登记 | WP-08 状态存储 |
| **T2-01**：全小节占位符校验对散文中的裸 `<`/`>` 与 HTML 注释过度拒绝（fail-closed，无 fail-open） | P3 已登记 | WP-05/WP-08 前的后续修复轮 |
| 真实 Provider 纵向、HTTP/WS 接线、Docker 集成性能（宿主高负载下 Docker 用例曾 180s 超时） | 未实现 / 环境观测 | WP-09 / WP-10 |

## 6. 完成清单（CompletionManifest）

- [x] Plan 与实现记录（T1～T13）齐备，含全部 fail-closed 代价、残余边界与承接登记
- [x] 4 轮独立 Review（末两轮 PASS）与 2 轮独立 Test（均 PASS）报告落库，代码树在最后一轮 Test 后未变（`88a5690` / tree `2a79088b`）
- [x] 六条契约命令在冻结树上退出 0（第二轮 Test 时 Docker 集成 124/124 全通过）；`e2e/acceptance/live` 按设计 `NOT_IMPLEMENTED`
- [x] 五项必需失败测试独立复现
- [x] AC-025～029、037/038/040/042、086～088、092/093 有证据；AC-039 明确登记为部分覆盖并承接 WP-02/WP-05
- [x] `docs/INDEX.md` 实现状态更新（本次结算唯一 docs 变更）
