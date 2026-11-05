# WP-11 Plan（运行时与 Runner 执行器）

- 责任：Backend（Core/daemon/runner/cli）；验证由独立 Review/Test。
- 依赖：WP-00～WP-10 全部结算（基线 `263aa40`，验证代码树 `9f154c3`）。
- 权威依据：`docs/architecture/ARCHITECTURE.md` §1/§2/§5、`docs/architecture/reliability.md` §1/§2/§3/§7、`docs/architecture/execution.md` §1/§2/§7、`docs/architecture/data.md` §2（`attempt`/`lease`/`outbox`/`operation`/`grant`）、`docs/architecture/protocol.md` §5/§6、`docs/rules/agents.md`、`AGENTS.md`。
- 用户决定（本次会话）：先做 A1+A2 —— **启动入口 + Runner 执行器**，让产品真的能自己启动并自己跑 Agent（而不是只有演练脚本组装）。
- 关联验收：AC-047、AC-055、AC-056、AC-057、AC-058、AC-059、AC-061、AC-064、AC-078、AC-092 的运行时侧；新增验收证据并入 `pnpm test:e2e` / `pnpm test:live`（不新增第 11 条契约命令，见 D2）。

## 1. 现状（为什么需要这个包）

- `apps/daemon` 只组装 HTTP 面；**没有任何地方 spawn `apps/runner`**，也没有 Run 队列 worker。真正把 Core 串起来的是 `scripts/e2e.mjs` / `scripts/live.mjs`：它们在进程内组装 `createDaemon` + `createWebApp`，直接调 `gateway.complete`，并直接插入 Task/Requirement/Work 行（`e2e.md`/`live.md` 已登记为合成输入）。
- `apps/cli` 只有 `doctor`/`version`：用户无法启动服务、无法打开工作台、无法绑定项目。
- `apps/runner` 是真实的一 Attempt 一进程（stdio JSON IPC：`attempt.ready`/`attempt.event`/`attempt.result`/`attempt.error`），但没有执行者；且它用 `PiSessionFactory` 的内存凭证库，**没有模型通路**。
- 因此 `reliability.md` §1/§2/§7 描述的 Claim/lease/epoch/capability/heartbeat/优雅停止/启动核对**都还没有实现**。

## 2. 本包目标（可演示）

1. `agentdev start` 一条命令起 daemon + BFF（真实状态目录、单实例守护），`agentdev open <path>` 绑定项目并给出工作台 URL，`agentdev status` 只读展示，`agentdev stop` 优雅停止；`agentdev doctor` 覆盖新运行时。
2. daemon 启动后按 `reliability.md` §1 核对 outbox/未完成 Run，并按 §2 用 **RunnerSupervisor** 真实执行排队的 Run：认领（30s lease）→ Attempt+epoch+capability → spawn `apps/runner` → `ready` 确认后 Running → 事件转发 → 5s 心跳/20s 无心跳转 `interrupted` → 撤销 capability 并终止旧执行 → 结果落 `stage_result`/Run 终态 → 释放 lease。
3. Runner 有**真实模型通路**：capability 鉴权的 Core 侧网关代理（Provider Secret 只留在 Core），Runner 用短期 capability 调用，真实 Prompt 能跑通一次（不需要演练脚本播种任何行）。
4. 崩溃/重启：SIGKILL 后重启，旧 Running/未完成 claim 被重新核对；无幂等证明的副作用 → `recovery_required`，旧进程未确认终止前不把工作区授予新写者。

## 3. 已确认决定

| # | 决定 | 影响 |
|---|---|---|
| D1 | **不新增第 11 条契约命令**：运行时证据并入既有 `pnpm test:e2e`（离线、真实进程与桩 Provider）与 `pnpm test:live`（真实 Provider、真实 Attempt），并新增 `apps/daemon/test/runtime*.integration.test.ts` 与 `apps/cli/test/*` | `docs/delivery/implementation.md` §3 命令表不变；AC 证据来源仍是这两条命令 |
| D2 | **Supervisor 放 `packages/core`**（ARCHITECTURE §2「调度」），spawn 端口由 daemon 注入（`RunnerSpawnPort`），测试注入假 runner | Core 不直接依赖 `apps/*`，保持可单测 |
| D3 | **模型通路采用 loopback HTTP + attempt capability**（不是 Unix socket）：daemon 在回环上暴露 OpenAI 兼容的 gateway 端点，仅接受本次 Attempt 的短期 capability；`execution.md` §2 的 Unix socket 方案用于**工具容器**，属后续工具执行切片 | 与 `reliability.md` §7「daemon loopback 不公开」一致；Secret 不出 Core |
| D4 | 状态目录 `~/.agentdev`（`ARCHITECTURE.md` §5 的全局配置路径），可用 `AGENTDEV_HOME` 覆盖；运行时文件 `runtime.json`（pid/ports/epoch/startedAt）、`daemon.lock`、`projects.json`（root→projectId 注册表） | CLI 与 daemon 共用同一目录契约；测试用临时 home |
| D5 | 心跳按契约扩展 IPC：新增 `attempt.heartbeat` 消息类型（5s 周期），Supervisor 以「任意消息」作为存活证据，20s 静默 → `interrupted`（模型长调用由 Runner 在等待期间继续发心跳） | `apps/runner/src/ipc.ts` 的协议版本保持 v1、向后兼容新增类型 |

## 4. 工作分解与退出条件

| Task | 内容 | 退出条件 |
|---|---|---|
| A1-T1 | 状态目录与单实例守护：`runtime-home`（路径/格式）落在 `packages/contracts`，`daemon.lock`（含 epoch）、`runtime.json`、`projects.json`；权限与原子写 | 单测：并发 start 只允许一个持有者；陈旧锁（pid 不存在）可接管并记录 |
| A1-T2 | `apps/daemon/src/main.ts` 宿主：加载全局配置（`~/.agentdev/config.toml`，缺省端口）、迁移并打开已注册 Project、启动 `createDaemon` + `createWebApp`、写 `runtime.json`、`/healthz.ready`、SIGTERM/SIGINT 优雅停止（停止准入 → 落 mailbox/outbox → 请求 Runner 安全停 → 关闭数据库） | 集成测试：start→`/healthz.ready`=true→stop；重复 start 报 `ALREADY_RUNNING` 非 0 |
| A1-T3 | CLI `start/stop/status/open <path>` + `doctor` 扩展 + launchd/systemd 模板 | `apps/cli/test/` 集成测试：start/status/stop 全流程；错误码与 operationId 输出；`open` 打印项目 URL |
| A2-T4 | RunnerSupervisor：outbox/Run 认领（30s lease）、Attempt+epoch+capability、spawn `apps/runner`、`ready` 校验（epoch/进程身份/环境）、事件转发（EventHub + Attempt 流）、结果落 `stage_result`/Run 终态、lease 释放、并发上限（`projectConcurrentRunners=4`、Chief 预留、`roleConcurrency=2`） | 集成测试：假 Runner 端口全流程；并发上限生效；Chief 槽优先 |
| A2-T5 | 心跳与恢复：`attempt.heartbeat`、20s 静默转 `interrupted`、撤销 capability、SIGTERM→10s→SIGKILL、`ownerEpoch` fencing、重启核对未完成 claim、`recovery_required` | 集成测试：杀 Runner 进程 → Run `interrupted` 且不重复执行；重启后未完成 claim 被重新核对；旧 epoch 的迟到消息被丢弃 |
| A2-T6 | 模型通路：Core 侧 capability 鉴权网关端点（OpenAI 兼容，代理到真实 `ModelGateway`，Secret 不出 Core）+ Runner 侧 `--gateway-url/--gateway-token` 与会话装配（临时 models.json 指向该端点） | `pnpm test:e2e` 新增检查：真实 daemon+supervisor+runner 子进程 + 桩 Provider 完成一次 Attempt；`pnpm test:live` 新增检查：真实 Provider 完成一次真实 Attempt（无播种行） |

## 5. 本包必验范围与通过条件

1. `agentdev start/stop/status/open` 真实可用：临时 home 下全流程；重启后 `status` 一致；`stop` 后端口释放。
2. Supervisor 真实执行：**不播种任何行**的情况下，一条用户消息经真实 daemon 产生真实 Run → 真实 `apps/runner` 子进程 → 真实模型调用（live 用真实 Provider，e2e 用桩并断言桩被真实调用）→ Attempt 终态与事件可查。
3. 失败与恢复：Runner 启动失败/崩溃/静默、capability 过期、epoch 迟到消息、并发超限都被真实执行并断言；无幂等证明的副作用标 `recovery_required` 且不自动重放。
4. 优雅停止：`stop` 期间新工具准入停止、Runner 收到安全停、Checkpoint/数据库关闭、非 0 退出带 error code 与 operationId。
5. 回归：既有十条命令保持全绿，`pnpm test:acceptance` 的 94/94 与 8 项已登记豁免不变（新能力不降低既有口径）。

## 6. 门禁与失败路由

Plan（本文件）→ Develop（A1-T1…A2-T6，分阶段提交）→ 独立 Review（独立上下文）→ 修复轮 → 独立 Test → Settlement（`.agentdev/work/WP-11/settlement.md` + `docs/INDEX.md`）。
阻断性 Review 发现 ⇒ 回 Develop ⇒ 重新独立 Review；Test 期间任何代码改动 ⇒ 回 Develop ⇒ 重新 Review ⇒ 重新 Test。

## 7. 明确非目标（本包不做）

- 工具容器与每 Task worktree 的真实工具执行（`execution.md` §1/§3 的容器挂载、只读 Review 容器）—— 属 A4/A5 切片。
- 备份/恢复/迁移的 CLI 与 UI（A5）。
- AC-090 界面子句、`completed`/`archive` 协议接线、浏览器侧验证（A6）。
- 多用户/远程访问：daemon 只监听回环，远程经反向代理（本包只实现前者）。
- 不引入新的第三方依赖（`packages/client`/CLI 的零依赖风格保持）。
