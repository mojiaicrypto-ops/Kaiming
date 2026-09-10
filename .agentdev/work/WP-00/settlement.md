# WP-00 结算（Settlement）

- 工作包：WP-00 工具链与执行底座（`docs/delivery/implementation.md` §2）
- 等级：L2；Plan `.agentdev/work/WP-00/plan.md`（授权原文「同意先实现工具链及执行底座」→ 用户原话「同意先实现工具链与执行底座」，2026-09-11）
- 关联验收：AC-048、AC-066、AC-067
- 基线提交：`6cdbb752c62d1fcaef9bf7a2209353a6a500333e`
- 验证代码树：`git write-tree` = `5c9aa584409c303972082a5ea2d891ad66341fd5`（63 文件，+9216/-1）
- 证据目录：`.agentdev/work/WP-00/`（plan / implementation / discovery / review / test-report / verify2.log）

## 1. 实际 Diff

新增 63 个路径，无删除、无基线文档改写：

| 范围 | 内容 |
|---|---|
| 根工程 | `package.json`（十个契约命令）、`pnpm-workspace.yaml`、`tsconfig.base.json`、`tsconfig.json`、`vitest.config.ts`、`eslint.config.js`、`.prettierrc.json`、`.prettierignore`、`.gitignore` |
| `scripts/` | `docs-check.mjs`、`not-implemented.mjs`、`clean.mjs`、`lint.mjs`、`typescript-6-preload.cjs` |
| `packages/contracts` | primitives/enums/limits/errors/protocol/toolchain Schema 与 81 个单元测试 |
| `packages/pi-runtime` | `session.ts`（Factory/Handle）、`resources.ts`（显式 ResourceLoader）、`extensions.ts`（内置扩展注册表）、`events.ts`（SDK 事件映射）、`errors.ts`、`index.ts` |
| `apps/runner` | `attempt.ts`（单 Attempt 进程 + 扩展门禁 + 会话缝）、`ipc.ts`（zod 严格 IPC）、`cli.ts` |
| `apps/cli` | `doctor.ts`（依赖/镜像/目录/端口探测 + 镜像运行能力校验）、`cli.ts` |
| `docker/` | `Dockerfile`、`build-image.sh`（100755）、`run-agentdev.sh`（100755） |
| 文档入口 | `docs/INDEX.md`「实现起点」按实际状态更新（仅实现状态事实，无产品语义/规则改动） |
| 工作记录 | `.agentdev/work/WP-00/{plan,implementation,discovery,review,test-report}.md`、`verify*.log` |

`docs/` 其余 14 个文档、`webui/index.html`、`AGENTS.md` 未改动；无数据迁移、无对外协议变更、无 SQLite schema。

## 2. 工程命令结果（`verify2.log`，T4 代码，2026-09-11）

| 命令 | 退出 | 结果 |
|---|---|---|
| `pnpm install --frozen-lockfile` | 0 | 锁文件一致，供应链策略通过 |
| `pnpm typecheck` | 0 | strict 无错误（TypeScript 7.0.2） |
| `pnpm lint` | 0 | 类型感知 ESLint + Prettier 检查通过 |
| `pnpm test:unit` | 0 | 9 文件 / 107 用例 |
| `pnpm test:integration` | 0 | 4 文件 / 38 用例（session 11、runner 10、doctor 8、container 9） |
| `pnpm docs:check` | 0 | 15 documents / 55 internal links / 94 AC / 9 REQ / 11 WP |
| `pnpm build` | 0 | contracts、pi-runtime、runner、cli 产出 dist |
| `pnpm test:e2e` | 1 | `NOT_IMPLEMENTED … lands with WP-09`（按契约失败） |
| `pnpm test:acceptance` | 1 | `NOT_IMPLEMENTED … lands with WP-10` |
| `pnpm test:live` | 1 | `NOT_IMPLEMENTED … lands with WP-10` |

真实环境探测（`agentdev doctor`）：node 24.8.0、pnpm 12.3.4（`~/.local/bin/pnpm`）、git 2.39.3、Pi SDK 0.85.1、Docker 28.4.0、镜像 `agentdev/exec:0.0.0`（imageId/digest 见 `verify2.log` 与 doctor 输出）、`~/.agentdev` 与工作区可写、端口 4317/4318 空闲、`execution ready: yes`（退出 0）。镜像缺失、镜像非执行契约（`docker import` 假镜像 / root 变体）、数据目录不可创建时均 `executionReady=false` 且退出 1。

Runner 真实进程：`--self-check` 输出 `attempt.ready` 且退出 0；无凭证 `prompt` 输出 `attempt.result failed`（`No API key found …`）且退出 1；未知扩展 ID 退出 1（`UNKNOWN_EXTENSION`）。

## 3. 独立验证

| 角色 | 冻结点 | 结论 | 位置 |
|---|---|---|---|
| Review | `a901b126…`（T2） | **RE-REVIEW: PASS**（原 FAIL：1 blocker + 4 major + 9 minor → D1–D7、D9–D12 与 F4/F6/F7 已修复；D8 partially；D13 记录已补） | `review.md` §"复审（修订 T2）" |
| Test | `a901b126…`（T2） | **RE-TEST: PASS**（F1 用两类突变反例证明断言有效；F2/F4/F6/F7 与 doctor 镜像探针均经独立负例/正控证实）；F3 未覆盖、F5 未修复 | `test-report.md` §"复测（修订 T2）" |

复审/复测均在 T2 冻结点上完成。T4 相对 T2 的差异为复审追加项与文案：`isRetryable()` 改由 `CONDITIONAL_RETRYABLE_CODES` 驱动并新增一致性测试（+2 单元用例）、镜像探针失败信息区分原因、探针职责注释、`limits.ts` 出处与 `fixed` 语义注释、docs/INDEX 实现状态、工作记录文档。这些改动由本轮 §2 的同一组命令重跑覆盖（T4 运行后仅剩记录文档与索引改动，已再次以 `docs:check`/`lint`/`typecheck` 退出 0 确认）。

## 4. 验收对应

- **AC-048 Workspace 边界**：`doctor` 真实探测 Node/pnpm/git/Pi/Docker/镜像 digest+运行能力/目录/端口，缺环境拒绝（退出 1、blockers）；容器套件以 Supervisor 参数验证只读 rootfs、只读挂载负例+正向对照、非 root uid 10001、cap-drop=ALL、`--network none`、pids 256、内存 2GiB。
- **AC-066 SDK 契约**：真实 SDK 0.85.1 的创建（离线目录/内存 Settings/SessionManager）、工具 allowlist、订阅/解除、abort、compact（空会话必须 reject）、dispose 后拒绝、未知模型拒绝、恢复路径接线、显式资源选择（未选择资源不可用、不可扩展）、事件映射全分支。流式端到端与带历史恢复按约定在 WP-10 用真实 Provider 复验（`test:live` 现为 NOT_IMPLEMENTED）。
- **AC-067 扩展故障**：库层未知 ID 拒绝、Critical 阻断、可选独立禁用、apiVersion 失败、能力缺失报告；Runner 层未知 ID 与 Critical 失败在真实启动路径阻断且不创建会话。

## 5. 规则与合规核对

- 交付路线：L2 代码路线（Product 已有有效基线 → Plan → Develop → Review → Test → Settlement），Plan 含 goal/scope/写入范围/任务 DAG/验收映射/验证策略/风险与回退。
- Review 与 Test 使用独立 Run/上下文，只读冻结点；Review 未读取 test-report（其报告 §0 声明），Test 未修改任何验收或源码。
- 失败如实上报：未实现的命令以 `NOT_IMPLEMENTED` 失败；缺环境、缺镜像、非执行契约镜像、缺凭证均不伪造通过。
- `docs:check` 通过；本包未改动任何产品语义或规则文档，`docs/INDEX.md` 仅更新实现状态（属索引/技术事实更新，无需新 Product/Plan Gate）。

## 6. 未覆盖、残余与移出本包

| 项 | 处置 |
|---|---|
| AC-066 真实模型流式与带历史恢复（DC-14、Test F3） | 移出：WP-10 真实 Provider 复验；`test:live` 保持 NOT_IMPLEMENTED |
| 镜像构建可复现性与 Attempt 级 digest 冻结（DC-15、Test F5） | 移出：WP-07（容器/Grant）与 WP-08（Manifest/结算）；本包只提供镜像定义、构建脚本与 digest 探测 |
| `shellTimeoutSec.min=1` 与单一数值条目标 `fixed` 的解释（DC-17） | 残余登记，注释已与 `ARCHITECTURE.md` §5 原文对齐 |
| Runner CLI 无 extension manifest 入口（出厂白名单为空） | 记录并解释：受白名单为空的契约约束，Critical 分支经 `AttemptRunner` 注入口验证 |
| 角色自定义工具桥接、其余包（domain/storage/core/web/daemon） | 后续工作包（WP-01 起） |

## 7. 证据 Hash

| 工件 | SHA256 |
|---|---|
| `plan.md` | `6296e2c05fe3cb85ea87417457ee2320289690e3f5d67ad453c6c2b19c823f2a` |
| `implementation.md` | `a5701c165aea7aa7059f6c1a7a2a333fbbcf5d8d8eae7edc44cde0eaf168284f` |
| `discovery.md` | `5d8994f8f636c4827295f7240cdf4add0e4561f33782b81da5fe8beda7c6ace1` |
| `review.md` | `d02d2b8ee93a94eeae1416bed99c92d6d44a5c1203380cae8f5272394fd34270` |
| `test-report.md` | `1ca64e3d76f770b63c6aaaef5df57296840e43e52fc83e8bada3aa9b5db4b3fb` |
| `verify2.log` | `3514fcf4a260e2808cb81fc2853a599acb4703f22e4a2bee6d09d3649cb66d80` |

## 8. 最终完成清单

1. 十个工程命令按契约就位，已实现者为真实通过、未实现者按契约失败（§2）。
2. `contracts`/`pi-runtime`/`runner`/`cli` 基础工程与固定镜像落地，`doctor` 能力探测真实（§1、§2）。
3. AC-048/066/067 在本包必验范围内有真实证据，超出范围的部分已明确移出并记录（§4、§6）。
4. 独立 Review 与 Test 在冻结点 `a901b126…` 上给出一致 PASS，其后差异仅复审追加项与文案并已重跑覆盖（§3）。
5. 回退：删除本包新增路径即回到基线 `6cdbb75`（`plan.md` §6）。

结论：**WP-00 达到退出条件，可进入结算提交。**
