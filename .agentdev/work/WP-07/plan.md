# WP-07 实现 Plan（权限、工具和测试环境）

- planVersion: 1
- workId: WP-07
- level: L2（在 `packages/core` 增补 Broker/Grant/SecretStore，在 `packages/domain` 补全 Grant 判定，在 `packages/pi-runtime` 补 Trust/Skill 加载边界；按 `docs/architecture/{execution,reliability,data}.md`、`docs/rules/agents.md` 既有定义实现）
- authorization_ref: 用户目标轮次「继续」（2026-09-11）；上级授权为「我要完全实现这个产品，让你来实现」
- productRef: 无独立 Requirement；行为依据为 `docs/delivery/implementation.md` WP-07 与关联 AC（AC-048–051、AC-053、AC-080）
- 依赖：WP-00（工具链/镜像/doctor，结算 `79d5895`）、WP-02（Grant/Run，结算 `f9b61e0`）；基线 WP-06 结算 `91581cb`（代码树 `b0d226f`）

## 1. goal

让「授权 → 工具执行 → 审计」这条链路真实可用且边界可验证：Broker 只接受有效 Grant（角色/期限/目标/操作/输入 Hash），同 Work 同角色兄弟 Run 不能窃用、`once` 原子消费且重试原操作返回原结果；无 Docker 或目录/网络越权时直接拒绝，容器与宿主两种模式下源码只读、网络受控（符号链接/私网/重定向一律阻断）、测试环境使用隔离 DB/端口并保证清理；Provider/项目命令凭证只在受权用途注入，UI/Artifact/日志不含 Secret；未信任仓库的自动加载扩展不执行，Trust 后也只启用选定 Skill 与内置资源。

## 2. scope

writePaths:

- `packages/core/src/{grants,secrets,broker,test-environment}.ts`（新增）与 `packages/core/src/index.ts`
- `packages/domain/src/permission.ts`（补全 Grant 判定：once 输入 Hash 绑定、兄弟隔离、过期）
- `packages/pi-runtime/src/{extensions,resources}.ts`（仅补 Trust/Skill 加载边界；不改既有语义）
- 各包 `test/**`（含 `*.integration.test.ts`）
- `.agentdev/work/WP-07/**`

readPaths: `docs/**`、`packages/**`、`apps/**`
不可写：`webui/**`、`docker/**`、`docs/**`（除结算时更新 `docs/INDEX.md`）

## 3. tasks（DAG）

| id | 角色 | goal | dependsOn | acceptanceIds |
|---|---|---|---|---|
| T1 | backend | `domain/permission.ts` 补全 + `core/grants.ts`：Grant 生命周期（签发/查询/撤销/过期），`once` 绑定 `operation + inputHash` 原子消费与幂等重放（同输入返回原结果，异输入拒绝），同 Work 同角色不同 Run 的兄弟隔离（run 级 Grant 不可跨 Run 使用） | — | AC-049, AC-080 |
| T2 | backend | `core/secrets.ts`：SecretStore（按用途/角色注入、引用式 `secretRef`、不落日志/Artifact/UI；诱饵凭证扫描） | T1 | AC-051 |
| T3 | backend | `core/broker.ts` + `core/test-environment.ts`：工具调用准入（Grant 校验 → 容器/宿主模式 → 审计），源码只读、目录/网络边界（符号链接逃逸、私网地址、重定向阻断），无 Docker 拒绝，测试环境隔离 DB/端口与清理（含清理失败检测） | T1, T2 | AC-048, AC-050 |
| T4 | backend | `pi-runtime` Trust/Skill 加载边界：未信任仓库不执行自动加载扩展；Trust 后仅选定 Skill + 内置白名单 | — | AC-053 |
| T5 | backend | 集成与必需失败测试（真实 Docker/宿主进程/Broker/SecretStore） + 独立 Review + 修复 + 独立 Test + 结算 | T1–T4 | 全部 |

### 必需失败测试（`docs/delivery/implementation.md` WP-07）

| 必需失败测试 | 归属 |
|---|---|
| 符号链接/私网/重定向 | T3（符号链接指向仓库外/私网地址/HTTP 重定向到私网一律拒绝且无读取） |
| Secret 泄漏 | T2（诱饵 Secret 不出现在日志/Artifact/UI/子进程环境，除非该用途已授权） |
| 进程清理失败 | T3（清理失败必须被检测并报告为可恢复状态，不静默） |
| 无 Docker 拒绝 | T3（容器模式的 Broker 在无 Docker 时拒绝并给明确原因） |

## 4. 接口与数据影响

- 复用 `grant`/`tool_operation` 等既有表与 `domain/permission.evaluateGrant`；SecretStore 以引用（`secretRef`）为主，不新增明文存储。
- Broker 为 Core 内部 API（HTTP/WS 接线属 WP-09）；容器执行复用 WP-00 的执行镜像与 `doctor` 探测。
- 不新增协议方法；如确需新增表，先确认 `data.md` §2 已列且 schema 缺失，并在记录中登记。

## 5. 验证策略

- 单元：Grant 判定矩阵（角色/期限/目标/操作/输入 Hash/兄弟 Run）、once 消费与重放、Secret 注入与泄漏扫描、Broker 准入与审计、路径/网络边界判定、清理失败检测、Trust/Skill 加载白名单。
- 集成：真实 Docker（无网络、只读 rootfs、非 root、cap-drop）与宿主进程两条模式；测试环境隔离 DB/端口与清理；诱饵凭证端到端扫描。
- 必需失败测试见上表。
- 退出：本包必验范围通过；实际文件/网络边界与界面承诺一致；隔离在所有模式有效；结算与文档入口更新。
