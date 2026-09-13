# WP-09 结算（Settlement）

- 工作包：WP-09 完整Web工作台（`docs/delivery/implementation.md`）
- 等级：L2；Plan `.agentdev/work/WP-09/plan.md`（planVersion 1）
- 关联验收：AC-054、AC-068～AC-078、AC-084、AC-087～AC-090、AC-093
- 基线提交：`d6c766b`（WP-08 结算）
- **验证代码树：commit `e9e237d`，tree `a4f9fd99cfa46e30938f4dac8a3fa14f317f6e04`**
- 证据提交：`4324602`（Review 第 3 轮 PASS + Test 第 2 轮 PASS + 残余登记）；本结算提交只新增/更新 `.agentdev/work/WP-09/` 与 `docs/INDEX.md`，**代码树未变**
- 证据目录：`.agentdev/work/WP-09/`（plan / implementation T1～T6 / review 第 1～3 轮 / test 第 1～2 轮 / settlement）
- 冻结提交总数：`d6c766b..e9e237d` 共 5 个提交；Diff **52 个路径、+26423/−273**；新增 workspace `packages/client`、`apps/web`（工程 10 → 12 个 workspace）

## 1. 实际 Diff

| 类别 | 内容 |
|---|---|
| 客户端 | `packages/client/src/{connection,commands,subscriptions,index}.ts`：连接状态机与有界指数退避、幂等键写重放（`WriteReceipt.replayed`）、订阅水位与 `resume(since)` 精确补齐、越权/跨 Project 订阅本地拒绝、鉴权错误不重试 |
| 协议面 | `apps/daemon/src/protocol.ts`：全部工作台查询与命令（含 `plan.current`、`conversation.create`、`requirement.save(+retry)`、`work.control`、`plan.approve`、`finding.submit`、`decision.resolve`、`config.save/test`、`backup/restore.run`、`ui.translate`）、统一写命令幂等账本、真实 `EventHub` 上的 `/ws` 水位订阅；`server.ts` 的 `/rpc`、`/auth/login|logout`、`upgrade`；**单一安装用户身份**（会话仅作审计 subject） |
| Web | `apps/web/src/**`（零依赖 BFF：HttpOnly 会话、精确 Origin 写校验、`/rpc` 与 `/ws` 桥、只读文件访问）与 `apps/web/public/**`（九面零依赖 UI、面板三态、ARIA/键盘/i18n、Plan 版本与过期禁用、截断与一次性下载、Inbox 去重、Provider 校验保留输入、附件首条消息绑定） |
| 记录 | `.agentdev/work/WP-09/**`（3 轮独立 Review、2 轮独立 Test、T1～T6） |

## 2. 工程命令结果（独立 Test 第二轮，tree `a4f9fd99`）

| 命令 | 退出 | 结果 |
|---|---|---|
| `pnpm typecheck` | 0 | strict 无错误 |
| `pnpm lint` | 0 | 通过 |
| `pnpm test:unit` | 0 | 55 文件 / **1105** 用例（8 次默认并发采样全绿） |
| `pnpm test:integration --maxWorkers=4` | 0 | 26 文件 / **311** 用例（真实 SQLite + 真实 HTTP/WS，含真实 createDaemon + 真实 BFF） |
| `pnpm docs:check` | 0 | 15 documents / 55 links / 94 AC / 9 REQ / 11 WP |
| `pnpm build` | 0 | **12** workspace |
| `pnpm test:e2e` / `test:acceptance` / `test:live` | 1 | 按契约 `NOT_IMPLEMENTED`（WP-10） |

Test 自建实验（`/tmp/wp09t2/`，真实 Git/SQLite/createDaemon/BFF，不 import 产品测试文件）：**13 组 / 397 判定 / 396 通过**（唯一失败为 P3 T2-01）。

### 必需失败测试（`docs/delivery/implementation.md` WP-09）

| 必需失败测试 | 覆盖证据 |
|---|---|
| 持续对话 | 消息创建真实 Work + 状态渲染 + Chief 路由（probeB） |
| 过期卡片 | `?planVersion=` 历史版本渲染 `data-expired=true` 且批准禁用，强批 409（probeA） |
| 窄屏焦点 | 三态面板、顶栏先于 dock、`toggle.focus()`；**残余 T2-01**（关闭控件不回焦） |
| 断连 | 同一浏览器 socket 观察 `bridge.reconnecting → bridge.open` 并按水位补齐，零重复（probeA） |
| 配置失败 | 非法 patch 422 + `preservedInput`、活动 revision 不变、provider 失败 `PROVIDER_UNAVAILABLE`（probeD） |
| 订阅扩大 | 跨 Project/越权订阅拒绝且 details 不泄漏本机 id、客户端本地零请求（probeI） |

## 3. 独立验证

- **Review**：3 轮独立 Review（round 1 FAIL 2×P1 + 6×P2 + 4×P3；round 2 PASS + 4×P2/2×P3；round 3 聚焦 **PASS**，0×P0/P1，2×P2 + 1×P3）。
- **Test**：2 轮独立 Test（第 1 轮 **FAIL** T-01/P1：经 BFF 上传的附件无法随经 BFF 发送的首条消息绑定，根因是会话派生身份与安装用户身份不一致；第 2 轮 **PASS**，全部 AC 接受）。
- 关键收敛：单一安装用户身份统一（消除附件属主不一致）；Plan 批准可达且过期卡片可见（消除两个 P1）；写命令幂等账本统一；取消/更新保真（不再清空未命名字段）；需求池读取按目标 revision。

## 4. 验收对应

| AC | 结论 | 主要证据 |
|---|---|---|
| AC-054 | 通过 | BFF 桥断连自动重连 + 水位补齐零重复；后台 Work 不受影响 |
| AC-068～072 | 通过 | 看板身份/L1 排除/Queued 无 Work 取消；持续对话；Plan 版本与过期；面板三态与归属 |
| AC-073 | 通过（实机遍历留 WP-10） | 语言切换、项目内容不翻译、ARIA/键盘、批准原因本地化 |
| AC-074/075 | 通过 | Inbox 去重与过期禁用；配置校验保留输入且活动 revision 不变 |
| AC-076/077/078 | 通过 | 附件限制与穿透拒绝；分支预览根边界只读；认证生命周期与 Origin/过期会话 |
| AC-084 | 通过 | 经 BFF 上传 → 经 BFF 首条消息原子绑定 + user Artifact（第 1 轮 P1 已修） |
| AC-087～090 | 通过 | 需求池随 Git 迁移/历史展示/继续；保存仅在 Git 与投影一致后可见 |
| AC-093 | 通过 | 两文件共享版本与组合 Hash、结构非法拒绝且分支不动 |

## 5. 未决项与承接包（显式登记）

| 项 | 性质 | 承接 |
|---|---|---|
| T2-01（窄屏关闭控件不回焦）、W9R3-01（unit 端口竞态）、W9R3-03（`git show` 加固） | P3/P2 登记 | 后续修复轮 |
| W9R3-02：协议面 `completed`/`archive` 写入不可达 | P2 登记 | 后续修复轮或文档对账 |
| 无头浏览器焦点/ARIA 实机遍历、像素级证据 | 未覆盖 | WP-10 |
| 真实 Provider 纵向、`test:live` | 未覆盖 | WP-10（需用户提供 Provider 配置） |
| `apps/web` 直接依赖声明、`requirement.save.retry` 探针 | 登记 | 后续 |

## 6. 完成清单（CompletionManifest）

- [x] Plan 与实现记录（T1～T6）齐备，含全部残余与承接登记
- [x] 3 轮独立 Review（末轮聚焦 PASS）与 2 轮独立 Test（末轮 PASS）落库，代码树在末轮 Test 后未变（`e9e237d` / tree `a4f9fd99`）
- [x] 六条契约命令在冻结树上退出 0；`e2e/acceptance/live` 按设计 `NOT_IMPLEMENTED`
- [x] 六项必需失败测试存在且行为独立复现（T2-01 为 AC-071 的 P3 残余）
- [x] AC-054、AC-068～078、AC-084、AC-087～090、AC-093 有证据
- [x] `docs/INDEX.md` 实现状态更新（本次结算唯一 docs 变更，同时修正协议接线漂移）
