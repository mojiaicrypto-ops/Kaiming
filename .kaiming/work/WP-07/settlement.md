# WP-07 结算（Settlement）

- 工作包：WP-07 权限、工具和测试环境（`docs/delivery/implementation.md`）
- 等级：L2；Plan `.agentdev/work/WP-07/plan.md`（planVersion 1）
- 关联验收：AC-048、AC-049、AC-050、AC-051、AC-053、AC-080
- 基线提交：`91581cb`（WP-06 结算）
- **验证代码树：commit `96e196b`，tree `98ff1930c8252a49124433ec9e1b124ae6d2eb15`**
- 证据提交：`b256602`（Review 第 3 轮 PASS）、`473ae05`（Review 第 4 轮 PASS + Test 报告 + 残余登记）；本结算提交只新增/更新 `.agentdev/work/WP-07/` 与 `docs/INDEX.md`，**代码树未变**
- 证据目录：`.agentdev/work/WP-07/`（plan / implementation T1～T10 / review 第 1～4 轮 / test / settlement）
- 冻结提交总数：`91581cb..96e196b` 共 7 个提交；Diff **21 个路径、+14736/−12**

## 1. 实际 Diff

| 类别 | 内容 |
|---|---|
| Grant/权限 | `packages/domain/src/permission.ts`（签发信封校验、拒绝码映射、重放/过期语义）、`packages/core/src/grants.ts`（`GrantStore`：签发/查询/撤权/覆盖、`once` 绑定 `operation+inputHash` 原子认领与幂等重放、兄弟 Run 隔离、`consumeOnceAsync` 提交后 await、每引用一文件的持久结果存储与 GC 引用根） |
| Secret | `packages/core/src/secrets.ts`（Grant 校验后解析、按用途注入环境、脱敏与泄漏扫描、`gatewaySecretResolver` 适配点） |
| Broker/环境 | `packages/core/src/broker.ts`（能力分类准入、`tool_operation` 审计、容器/宿主模式、realpath 文件边界、逐跳网络策略 + 地址钉扎 + NAT64/mapped IPv6/https、只读角色报告写边界、容器写经 stdin）、`packages/core/src/test-environment.ts`（OS 端口探测与进程级认领、就绪归属证明、隔离 DB/端口、清理失败上报 `RECOVERY_REQUIRED`） |
| 信任/资源 | `packages/pi-runtime/src/extensions.ts`（`loadTrustedExtensions`：未信任零加载、信任后仅「显式选中 ∧ 白名单」、路径/符号链接逃逸拒绝、可审计 trace） |
| 测试 | `packages/core/test/{grants,secrets,broker,permissions-failures,permissions.integration,secrets.integration,broker.integration,grants.integration}.test.ts`、`packages/domain/test/permission-delivery.test.ts`、`packages/pi-runtime/test/trust.test.ts` |
| 记录 | `.agentdev/work/WP-07/**`（4 轮独立 Review、1 轮独立 Test、T1～T10） |

## 2. 工程命令结果（独立 Test，tree `98ff1930`）

| 命令 | 退出 | 结果 |
|---|---|---|
| `pnpm typecheck` | 0 | strict 无错误 |
| `pnpm lint` | 0 | 通过 |
| `pnpm test:unit` | 0 | 44 文件 / **916** 用例 |
| `pnpm test:integration` | 0 | 15 文件 / **157** 用例（含真实容器：只读 rootfs、cap-drop、非 root、无网络、pid/内存限制） |
| `pnpm docs:check` | 0 | 15 documents / 55 links / 94 AC / 9 REQ / 11 WP |
| `pnpm build` | 0 | 10 workspace |
| `pnpm test:e2e` / `test:acceptance` / `test:live` | 1 | 按契约 `NOT_IMPLEMENTED`（WP-09 / WP-10） |

Test 自建实验（`/tmp/wp07t/`，真实 SQLite、真实子进程、真实 Docker，不 import 产品测试文件）：**12 组 / 72 通过 / 0 失败 / 4 观察**。

### 必需失败测试（`docs/delivery/implementation.md` WP-07）

| 必需失败测试 | 覆盖证据 |
|---|---|
| 符号链接/私网/重定向 | 符号链接与 `..` 在 host/container 两模式拒绝且零读取；私网/loopback/元数据（含 DNS 解析结果、IPv4-mapped IPv6、NAT64）与 302 重定向每跳拒绝；明文 http 拒绝 |
| Secret 泄漏 | 诱饵仅到达已授权子进程；兄弟 Run/过期/跨 audience 拒绝；Artifact 行、事件、grant 行、store JSON、UI payload、host 环境、日志均无泄漏；扫描器可检出并脱敏 |
| 进程清理失败 | 临时目录/进程组清理失败上报 `RECOVERY_REQUIRED` 并给出逐条失败；正例（真实子进程）清理成功 |
| 无 Docker 拒绝 | 容器模式在无 Docker 时返回 `PROVIDER_UNAVAILABLE` 并原样给出原因，**零进程、零行、绝不回退 host** |

## 3. 独立验证

- **Review**：4 轮独立 Review（round 1 FAIL 3×P1 + 4×P2 + 6×P3；round 2 FAIL 1×P1 + 3×P2 + 6×P3；round 3 PASS + 2×P2/3×P3；round 4 聚焦 **PASS**，0×P0/0×P1）。所有 P1 及后续 P2 均由下一轮独立复核为关闭。
- **Test**：1 轮独立 Test **PASS**（6/6 AC 接受；4×P3 带账）。
- 关键收敛：网络边界从「字面量判定」→ 解析后逐跳 + 地址钉扎 + 完整 IPv6/NAT64/HTTPS 规则；写边界从「operation 名单」→ **能力分类 + 只读角色工具体约束**；`once` 从「同进程原子」→ 跨进程可重放（每引用一文件）。

## 4. 验收对应

| AC | 结论 | 主要证据 |
|---|---|---|
| AC-048 Workspace 边界 | 通过 | 无 Docker 不回退、容器加固、符号链接/`..`/绝对逃逸、私网/DNS/重定向/NAT64/mapped/明文 http 全拒 |
| AC-049 Autonomous 范围 | 通过 | 范围内执行并审计；越界目标/操作、过期、撤权、错角色拒绝且零副作用 |
| AC-050 Full Access 门禁 | 通过（1×P3 带账） | host/container 两模式 review/test 写源码与运行库拒绝；工具体写/执行边界闭合；报告根写允许 |
| AC-051 Secret 隔离 | 通过 | 诱饵仅达已授权子进程；查询面/日志/Artifact/UI/环境零明文；泄漏可检出 |
| AC-053 信任与资源 | 通过 | 未信任零加载；信任后仅「显式选中 ∧ 白名单」；逃逸拒绝且有 trace |
| AC-080 授权精确绑定 | 通过（1×P3 带账） | `once` 绑定 operation+inputHash、原子认领、幂等重放（含 null 与跨进程）、兄弟隔离 |

## 5. 未决项与承接包（显式登记）

| 项 | 性质 | 承接 |
|---|---|---|
| W7R4-01：工具体悬挂/进程中断时 `once` 停在 `prepared` 且无 resume/超时回滚入口 | P3，fail-closed | WP-08 恢复路径 |
| T-01：只读角色 + 路径型 mutating 操作 + 空 targets 通过门禁（内置执行器拒绝、ToolContext 受限） | P3 | 后续能力分类收紧 |
| T-03/T-04：突变-还原与历史计数不可仅凭当前树核验 | P3，记录 | 后续只登记可直接核验的证据 |
| 根内硬链接可读根外 inode；注入 fetcher 的 pin 是契约而非强制 | 已登记限制 | 记录接受 |
| `loadTrustedExtensions` 接入 `apps/runner`/session 创建 | 未接线 | WP-08 |
| 持久化 Secret 后端（Keychain/0600 加密文件、备份导出）、`gatewaySecretResolver` 接线 | 安装范围 / 未接线 | 安装层 / WP-09 |
| 容器网络代理 `networkProxy`、真实 DNS/出网、Linux `/proc` 归属分支 | 未配置/未在本机执行 | WP-09 / WP-10 |
| Broker 在仓库内无生产调用点；HTTP/WS 面 | 未接线 | WP-08 / WP-09 |

## 6. 完成清单（CompletionManifest）

- [x] Plan 与实现记录（T1～T10）齐备，含全部残余与承接登记
- [x] 4 轮独立 Review（末轮聚焦 PASS）与 1 轮独立 Test（PASS）落库，代码树在 Test 后未变（`96e196b` / tree `98ff1930`）
- [x] 六条契约命令在冻结树上退出 0（含真实容器集成 157/157）；`e2e/acceptance/live` 按设计 `NOT_IMPLEMENTED`
- [x] 四项必需失败测试独立复现
- [x] AC-048/049/050/051/053/080 有证据（P3 项明确登记）
- [x] `docs/INDEX.md` 实现状态更新（本次结算唯一 docs 变更）
