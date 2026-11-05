# WP-11 结算（Settlement）

- 工作包：WP-11 运行时与 Runner 执行器（A1 + A2），`docs/delivery/implementation.md` 之后的运行时切片
- 等级：L2；Plan `.agentdev/work/WP-11/plan.md`（planVersion 1，决定 D1–D5）
- 用户决定：先做 A1+A2（真实启动入口 + Runner 执行器），让 daemon 自己能执行 Agent
- 基线提交：`263aa40`（WP-10 结算）
- **验证代码树：commit `a54ff17`（tree `1ce9579`；Review 第 5 轮 PASS 与独立 Test PASS 均冻结于此）**
- 独立验证：Review 第 1 轮 **FAIL**（3×P1/8×P2/6×P3）→ 第 2 轮 **PASS**（4×P2/3×P3）→ 第 3 轮 **FAIL**（1×P1/1×P2/3×P3）→ 第 4 轮 **FAIL**（1×P1/1×P2/2×P3）→ 第 5 轮 **PASS**（3×P2/2×P3）；独立 Test PASS（唯一冻结点 a54ff17 / tree 1ce9579；31/31 A2 checks、21/21 恢复路径 checks、无 AC 级失败）
- 交付范围：A1（状态目录/单实例锁/daemon 宿主/CLI `start|stop|status|open`/doctor/launchd+systemd 模板）与 A2（RunnerSupervisor、心跳与恢复、真实 Runner 子进程、Attempt capability、Core 侧模型网关端点、产品自有 HTTP 传输、daemon 执行接线）

## 1. 实际交付

| 类别 | 内容 |
|---|---|
| 运行时状态 | `packages/contracts/src/runtime.ts`（`~/.agentdev` 契约、`AGENTDEV_HOME` 覆盖、runtime.json/daemon.lock/projects.json/installation-token 路径与 Schema）、`packages/core/src/runtime.ts`（0700/0600 原子写、epoch 围栏单实例锁、运行记录、project 注册表、安装凭证读取） |
| daemon 宿主 | `apps/daemon/src/bootstrap.ts`（真实组装一个 ProjectRuntime）、`apps/daemon/src/main.ts`（抢锁→迁移→打开项目→写运行记录→回环 admin 面→优雅停止）、`/health` 含 `execution` |
| CLI | `agentdev start/stop/status/open <path>`（幂等、错误码、日志尾巴）、`doctor` 运行时探针、`apps/cli/templates/{com.agentdev.daemon.plist,agentdev.service}` |
| 执行器 | `packages/core/src/supervisor.ts`（认领/epoch/spawn/ready/事件/结果/心跳/停靠/并发/usage 结算）、`packages/contracts/src/runner-ipc.ts`（IPC 上移 + `attempt.heartbeat`）、`apps/runner` 心跳、`PiSessionHandle.isIdle()` 与「等待回合结束」 |
| 模型通路 | `packages/core/src/capabilities.ts`、`gateway-http.ts`（OpenAI 兼容端点、capability 鉴权、冻结模型、SSE/JSON、拒绝日志、usage 回报）、`transport-http.ts`（node:http(s)、凭证遮蔽、reasoning 回退）、`apps/daemon/src/{prepare-run,runner-spawn}.ts` |
| 执行接线 | `packages/core/src/execution.ts`（每项目执行栈、按 Run 的 grants 授权 Secret、usage 账本）+ `apps/daemon/src/main.ts` 的启停接线 |
| 证据 | `pnpm test:e2e` 新增 `runtime.executes-attempt`（21 项检查、24 AC）；`pnpm test:live` 新增 `drill.runtime-attempt`（5 项检查，真实 Provider） |

## 2. 工程命令结果（验证代码树 `b71c8f5`）

| 命令 | 退出 | 结果 |
|---|---|---|
| `pnpm typecheck` | 0 | strict 无错误 |
| `pnpm lint` | 0 | ESLint + Prettier |
| `pnpm test:unit` | 0 | 59 文件 / 1155 用例 |
| `pnpm test:integration` | 0 | 29 文件 / 323 用例（真实 SQLite/Git/HTTP/WS/子进程；首次并发跑出现 2 例端口冲突，串行重跑全绿，属测试环境干扰） |
| `pnpm test:e2e` | 0 | 21 检查（PASS 17 / FAIL 0 / UNVERIFIED 4），覆盖 24 个 AC |
| `pnpm test:live` | 0 | 5 检查全通过（HTML / L1 / L2+结算 / 运行时真实 Attempt），真实 Provider，11 次 HTTP 200 |
| `pnpm docs:check` | 0 | 链接与索引一致 |
| `pnpm build` | 0 | 12 workspace |
| `pnpm doctor` | 0 | `executionReady=true` |

## 3. 真实运行暴露并修复的缺陷

1. `PiSessionHandle` 缺 `isIdle()`：SDK 的 `prompt()` 只表示「回合受理」，Runner 原先会在模型调用发生前结束 Attempt 并报 completed。
2. 网关端点只接受字符串 `content`，而 Pi SDK 发多模态数组 → 真实调用全部被拒（且拒绝是静默的）。
3. usage 在运行中 `reconcile`（只允许终态）→ 端点 500 → SDK 重试 4 次、Provider 被重复计费；改为 `RunUsageLedger` 结算时入账。
4. Attempt 的 `runnerId` 记录的是 daemon pid 而非 Runner 子进程 pid → 恢复探测永远认为「进程存活」，AC-057 无法判定；spawn 后改写为子进程 pid。
5. 源码模式下 Node 类型擦除不支持 TS 参数属性（真实启动路径触发）；e2e harness 的 `ConfigStore` 未接 `SnapshotWriter`（`freeze` 不可用）。

## 4. 已知限制与残余（未声称完成）

1. **Provider Secret 持久化未实现**：`SecretStore` 仅进程内，没有 Keychain/0600 加密文件与 CLI/UI 注册路径；`agentdev start` 下真实 Provider 需要先有授权路径（当前演练用真实 grant/decision 行）。
2. 工具桥接未实现（`apps/runner` 的 `BUILTIN_TOOLS` 为空），运行时 Attempt 无工具。
3. 运行时 Attempt 的 cwd 为项目根；每 Task worktree 属后续切片；prompt 为 Work goal + 角色/阶段契约，非完整 ContextBuilder 装配。
4. 每个打开的项目各有一对 daemon/BFF 监听（首个用文档默认 4318/4317）；单端口项目切换器未实现。
5. 多项目/远程部署（反向代理 TLS）、备份/恢复/迁移 CLI 面仍未交付（`release.md` §5 登记）。
6. **Review 第 5 轮登记的残余（PASS，不阻断）**：
   - WP11R5-01（P2）`work.control resume` 的恢复分支非原子：多个停靠 Run 时先写的决定/先起的 Attempt 不会回滚（错误路径应零状态变化）。
   - WP11R5-02（P2）执行器恢复分支返回 `{status:'applied',…,resumedRunIds}`，与 `protocol.md` §3/§4 记录的形状（`accepted` + `work.control_changed`）不一致。
   - WP11R5-03（P2）spawn/prepare 失败会把 Run 停靠成 `recovery_required`，但该 Attempt 无 `runnerId`（探针永远 `null`），因此 `recordResumeDecision`/`resumeParkedRun` 永久拒绝——只能取消；T12 所称「保留可重试路径」在当时不成立。
   - WP11R5-04（P3）采纳分支不推进 Run 状态、且绕过 `newAttemptAdmission`（当前不可达，纵深防御项）。
   - WP11R5-05（P3）T12 的「AC-020 用例已改名」记录不实（该文件未在修复提交中改动）。
7. 另有已登记残余：`attempt.result` 正文不落 `stage_result`；Run 在 `beginAttempt` 即为 running（`ready` 只作用于 Attempt）；`resumeTx` 纯证据依赖（无 `run.recovered` 的 `recovery_required` 可续跑，当前不可达）。
8. **独立 Test 登记的新残余（不阻断 release）**：
   - `daemon.lock` 的 epoch 在「干净 stop → start」之间不单调（stop 删锁，`(existing?.epoch ?? 0)+1` 恒为 1；只有陈旧锁接管才推进）。当前 hostEpoch 带时间戳，因此没有实际的围栏绕过，属语义缺陷。
   - 残留/损坏的 `runtime.json`（如 `admin.port=0` 或非法 JSON）会让 `agentdev start` 未捕获崩溃且**无 operationId**（`cli.ts` 的 `waitForRuntime→readLiveRecord` 未包 try/catch；`status`/`open` 已包）。删除该文件即恢复。
   - WP11R5-03 精确化：悬空 Attempt 无可用 pid + 真实进程探针 ⇒ `recordResumeDecision` 永久拒绝，只能 `cancelWork`（注入恒 false 探针时可续跑；生产固定用真探针）。
   - **T-05（证据缺口）**：两个发布演练确实驱动产品执行器，但都直接播种 Work/Run 行；现有发布证据里没有「用户消息 → Chief 路由 → Work/Run → 真实 Runner」的**完整**端到端链路（两端各有证据、合成缺位）。
   - 未验证：真实多 Runner 并发上限、A1 `stop` 期间活跃 Runner 的回收（该场景执行栈为空）。

## 4b. 修复轮历史（可审计）

| 轮次 | 结论 | 修掉的关键缺陷 |
|---|---|---|
| 1 | FAIL | 迟到结果崩溃 daemon、探针无法确认 Runner 死亡、capability 停靠后仍可用；另 8 个 P2（停靠语义、优雅停止、doctor/注册表/锁/子进程环境等） |
| 2 | PASS | —（复核确认 13 项关闭，登记孤儿停止、恢复路径、迟到结果改写、operationId 四项 P2） |
| 3 | FAIL | 恢复路径无人调用（`resumeWork` 硬拒绝）；`START_FAILED` 缺 operationId；续跑不复核进程/绕过并发；决定行 ref 合成 |
| 4 | FAIL | 采纳分支对 `running` Run 再 `beginAttempt` 导致续跑被误判 failed（真实回归）；并补齐协议层恢复动作 |
| 5 | PASS | —（确认 P1 关闭；登记 3×P2：恢复分支非原子、响应形状、spawn 失败死路） |

## 5. 复盘（流程改进）

- **执行器必须由产品自己拥有**：WP-10 的证据由演练脚本组装并直接调模型；本包把组装与调度搬进 daemon（`execution.ts`/`supervisor.ts`），演练改为驱动产品，才让「真的能跑 Agent」可证。
- **真实运行才会暴露真实缺陷**：本轮 5 个缺陷（idle 语义、多模态 content、运行中结算导致重试计费、runnerId pid、参数属性）全部只在真实子进程 + 真实/桩 Provider 路径上出现。
- **信任边界要显式**：Secret 只留 Core，Runner 只拿 attempt capability；capability 与冻结模型都由端点复核，拒绝必须留日志。
- **记录仍要随运行刷新**：`implementation.md` 的数值与检查数量在每次运行后更新。

## 6. 知识入口更新

- `docs/INDEX.md`：新增 WP-11 状态段（运行时入口与执行器、证据与残余）。
- `.agentdev/work/WP-11/`：plan / implementation（T1–T8）/ review / test / settlement。
