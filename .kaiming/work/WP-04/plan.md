# WP-04 实现 Plan（知识与新旧项目）

- planVersion: 1
- workId: WP-04
- level: L2（新增 `packages/knowledge`、`packages/workspace` 与需求池读入，按 `docs/product/knowledge.md`、`docs/product/requirements.md`、`docs/architecture/{context,data,ARCHITECTURE}.md` 既有定义实现，不改产品语义）
- authorization_ref: 用户目标轮次「继续」（2026-09-11）；上级授权为「我要完全实现这个产品，让你来实现」
- productRef: 无独立 Requirement；行为依据为 `docs/delivery/implementation.md` WP-04 与关联 AC（AC-025–029、AC-037–040、AC-042、AC-086–088、AC-092、AC-093）
- 依赖：WP-01（数据/状态/协议核心）、WP-02（已完成，结算提交 `f9b61e0`）
- 基线：WP-03 结算提交 `5171ef2`（代码树 `7512159`）

## 1. goal

让「知识」与「新旧项目初始化」真实可用：Feature 的规范 Markdown（字段表 + 固定标题）可解析、校验、投影为索引与三视图（design/delivered/work），非法知识拒绝发布并保留最后有效投影标 stale；关系与来源可解析、断链成为诊断；旧项目可预算内调查并生成候选知识（含 observed/confirmed 分离、未知显式列出），初始化状态机可中断恢复、冲突不覆盖、脏工作区阻断、无 Git 只允许只读调查；可迁移需求池（`requirement.json` + `content.md` + `README.md`）可解析、导入、幂等与冲突逐条显示，正文与目录版本一致。

### 判定边界（必须与 Review/Test 对齐的口径）

- 本包只实现**知识层**：解析/校验/投影/视图/候选生成/需求池读入。**正式 Git 提交与初始化写入的最终事务**由 WP-08/WP-10 验证；本包对写入使用可替换的 Port（契约桩：`GitPort`/`WritePort`），并以 file 层实现和内存桩各自验证。
- 初始化「写入」阶段在本包内以 Port 实现（真实文件写入 + 幂等/Hash 校验；Git 命令经 Port，可用桩替代）。
- 断链与非法知识的方向是 **fail-closed**：非法 → 不发布新投影、保留最后有效并标 `stale`、`KNOWLEDGE_INVALID`；断链 → 诊断，影响当前需求时阻断。

## 2. scope

writePaths:

- `packages/knowledge/**`（新增：Feature Markdown 解析与校验、投影与索引、三视图、关系与来源解析、扫描与候选生成、初始化状态机、需求池解析/导入）
- `packages/workspace/**`（新增：Git/Worktree 端口与最小实现、路径与仓库识别 realpath/nested、扫描排除）
- `packages/contracts/src/entities/{system,structures}.ts`（仅补齐知识/需求池必要字段，不改既有语义）
- `packages/contracts/src/errors.ts`（补齐 `KNOWLEDGE_INVALID`、`REQUIREMENT_CONFLICT` 等已列错误码）
- `packages/storage/src/tables.ts` / `migrations.ts`（`feature_projection` 等 knowledge 表若缺失则补齐）
- `packages/*/test/**`、`apps/daemon/test/**`（新增测试）
- `.agentdev/work/WP-04/**`（过程记录）

readPaths: `docs/**`、`packages/**`、`apps/**`
不可写：`webui/**`、`docker/**`、`docs/**`（除结算时更新 `docs/INDEX.md`）

## 3. tasks（DAG）

| id | role | goal | dependsOn | acceptanceIds |
|---|---|---|---|---|
| T1 | backend | `knowledge/feature-format`：Markdown 解析（标题 + 表头，不执行内联 HTML）、字段模型、枚举、必填标题、`owner_document` 一致性、证据规则（confirmed/passed/investigated 的来源要求）、重复 ID/未知枚举/缺标题 ⇒ `KNOWLEDGE_INVALID` | — | AC-040, AC-086, AC-042 |
| T2 | backend | `knowledge/projection`：由 Git 正式文件构建投影（features 索引、README、CODE_MAP、PROJECT 入口）、`feature_projection` 以 revision+featureId 缓存、非法时保留最后有效并标 `stale` | T1 | AC-037, AC-040 |
| T3 | backend | `knowledge/views`：design/delivered/work 三视图与差距、observed vs confirmed、Work 覆盖层 | T2 | AC-037, AC-038, AC-042 |
| T4 | backend | `knowledge/relations`：关系四列解析、来源解析（Git 路径/Decision/Artifact）、断链诊断与阻断判定 | T1 | AC-039, AC-040 |
| T5 | backend | `workspace/scan`：realpath/嵌套仓库识别、排除规则、预算（40 文件 / 512 KiB、索引 10000 条分页）、候选 Feature 与初始化候选文档（PROJECT/INDEX/CODE_MAP/features/README），不更新交付 ref | T1 | AC-026, AC-027, AC-042 |
| T6 | backend | `workspace/initialize`：状态机 Identifying→Mapping→Confirming→Writing→Ready（Blocked/Failed）、中断后按 Hash 恢复、冲突不覆盖、脏工作区阻断、无 Git 只读 | T5 | AC-025, AC-027, AC-028, AC-029 |
| T7 | backend | `knowledge/requirements-pool`：`requirement.json` + `content.md` + `README.md` 解析、组合 Hash 与版本一致性、导入幂等、`REQUIREMENT_CONFLICT` 逐条、缺失/坏 Hash/Git 忽略/旧格式诊断 | T1 | AC-087, AC-088, AC-092, AC-093 |
| T8 | backend | 必需失败测试 + 独立 Review（fresh context）与修复 + 独立 Test + 结算 | T1–T7 | 全部 |

### 必需失败测试（`docs/delivery/implementation.md` WP-04）

| 必需失败测试 | 归属 |
|---|---|
| 初始化中断 | T6（Writing 中断 → 重试按 Hash 恢复、冲突不覆盖、Ready 最小门禁） |
| 非法 Feature | T1/T2（重复 ID、未知枚举、缺标题、证据不足 ⇒ `KNOWLEDGE_INVALID`、不发布、stale） |
| 重复 ID | T1（同一 revision 两个同 ID 文档） |
| 断链 | T4/T7（来源/关系/需求 README 缺失或坏 Hash → 诊断、按影响阻断） |
| 代码设计冲突 | T3/T5（observed vs confirmed 差距、不擅自认可行为） |

## 4. 接口与数据影响

- 新增 `@agentdev/knowledge`（解析/投影/视图/关系/需求池）与 `@agentdev/workspace`（Git/Worktree 端口、扫描、初始化）。
- 复用既有 `ProjectStore`（SQLite）与 `BlobStore`；新增 `feature_projection` 缓存表（revision+featureId 主键）与需求池导入记录，若 `data.md` §2 已列则按其定义补齐。
- 写入经 Port：`GitPort`（rev-parse/状态/提交/分支）、`FilePort`（读/写/Hash）；真实实现与内存桩并存，便于 WP-08/WP-10 复验。
- 不新增协议方法（知识查询经 Core 内部 API；HTTP/WS 面由 WP-04 之后的接线包负责）。

## 5. 验证策略

- 单元：Feature 解析正负例矩阵（必填字段/标题/枚举/owner_document/证据规则/重复 ID/未知枚举）、关系与来源断链、投影缓存与 stale、三视图分离、扫描预算与排除、初始化状态机与中断恢复、需求池解析/幂等/冲突。
- 集成（真实文件系统 + 真实 SQLite）：临时 Git 仓库（真实 `git` 命令）上的扫描 → 候选 → 写入 → 投影 → 查询；需求池 Clone 导入演练（无原数据库）。
- 必需失败测试见上表。
- 退出：本包必验范围通过；候选知识、投影与读取/写入保护组件通过独立 Review/Test；集成发布留待 WP-08。
