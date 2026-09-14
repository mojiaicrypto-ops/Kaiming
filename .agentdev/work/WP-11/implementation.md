# WP-11 实现记录（运行时与 Runner 执行器）

- planVersion: 1（`.agentdev/work/WP-11/plan.md`，决定 D1–D5）
- 依赖：WP-00～WP-10（基线 `263aa40`，WP-10 验证代码树 `9f154c3`）
- 本文件按 Task 增量记录；A1（T1–T3）已完成并提交，A2（T4–T6）进行中。

## A1-T1 运行时状态目录与单实例锁

- `packages/contracts/src/runtime.ts`（纯契约）：`AGENTDEV_HOME` 覆盖、`~/.agentdev` 默认、`runtime.json`/`daemon.lock`/`projects.json`/`installation-token`/`logs`/`projects/` 的路径与 zod Schema（拒绝未知键、非回环监听、非 32hex projectId）、`runtimePaths()`/`projectStateDir()`。
- `packages/core/src/runtime.ts`（磁盘侧）：0700/0600 目录与文件、原子写（临时文件 + rename）、**epoch 围栏**的单实例锁（进程已死的陈旧锁可接管并推进 epoch，`releaseDaemonLock` 只允许持有者删除自己的记录）、`runtime.json` 读写清除、按 canonical root 的 Project 注册表（`open` 幂等）、`readInstallationCredential()`（复用 `auth.ts` 的 0600 校验）。
- 测试：`packages/contracts/test/runtime.test.ts`（11 例）+ `packages/core/test/runtime.test.ts`（9 例）：Schema round-trip、二次守护拒绝、陈旧锁接管、epoch 校验释放、损坏记录拒绝、文件模式、注册表幂等。

## A1-T2 daemon 宿主

- `apps/daemon/src/bootstrap.ts`：真实组装一个 Project 的 `ProjectRuntime`——`resolveProjectIdentity`（canonical root/嵌套仓库）→ 每项目状态目录 `~/.agentdev/projects/<projectId>` 下的 `ProjectStore.open`（迁移 + 备份桩）→ `BlobStore`/`ConfigStore`（全局目录 = home）→ Core 服务（Attachment/Artifact/DownloadToken/EventHub/PlanGate/Finding/Decision/RequirementContinuation/CAS/Snapshot/IntegrationLock/Settlement/RequirementSave）→ `WorkbenchProtocol` → `createDaemon`（HTTP+WS）→ `createWebApp`（BFF，Bearer = 安装凭证）。首次打开插入 Project 行（canonical root、gitRoot、`agentdev/main`、`codeRoot=src`、`documentRoot=docs/agentdev`、trust 由调用者决定）。
- `apps/daemon/src/main.ts`：`startRuntime()`——索取单实例锁（陈旧锁记日志）、`AuthService.loadOrCreate`、按注册表或 `--root` 打开项目（首个项目用文档默认端口 4318/4317，其余用系统分配）、写 `runtime.json`、绑定**回环 admin 面**（`GET /health`、`GET /projects`、`POST /projects`、`POST /stop`，全部要求安装凭证 Bearer，恒定时间比较）、SIGTERM/SIGINT 优雅停止（先关 admin 与 BFF，再关各项目监听与数据库，最后清记录 + 按 epoch 释放锁）；`runAsProcess()` 供 dist 入口与开发引导共用；启动失败不留锁与记录；进度日志走 stderr，stdout 只留一条机器可读启动记录。
- 测试：`apps/daemon/test/runtime.integration.test.ts`（5 例）：真实 Git 仓库 + 临时 home 上启动、live 记录、admin 鉴权（无凭证 401）、daemon `/healthz`、真实 `/rpc project.list`、第二个守护拒绝、admin 开第二个项目并落注册表（同 root 幂等）、优雅停止后记录与锁消失、非 Git 目录拒绝且不留锁。

## A1-T3 CLI 命令

- `apps/cli/src/runtime.ts`：`cliHome()`、`readLiveRecord()`、`readCredential()`（0600 校验）、`adminRequest()`（node:http，Bearer）、`spawnDaemon()`（detached，日志写 `~/.agentdev/logs/daemon.log`，入口默认 `apps/daemon/dist/main.js`，可用 `AGENTDEV_DAEMON_ENTRY` 指向源码引导）、`waitForRuntime()`/`waitForStop()`、`daemonLogTail()`；CLI 只依赖 `@agentdev/contracts`（保持 `ARCHITECTURE.md` §2 依赖表）。
- `apps/cli/src/cli.ts`：`start`（幂等；等待 `/health` 就绪；失败输出 `START_TIMEOUT` + 日志尾巴）、`stop`（先请求优雅停，超时 SIGTERM，再超时 SIGKILL，输出 `STOP_TIMEOUT`）、`status`（只读；未运行时 `running:false` 且退出 0）、`open <path>`（未运行时先启动，再经 admin `POST /projects` 打开并打印实例；缺路径 `VALIDATION_ERROR`）。用法文本与 `doctor` 说明同步。
- `apps/cli/src/doctor.ts`：新增 `runtime` 探针（home、凭证模式 ok/missing/insecure、是否在运行、pid/epoch/实例数、损坏记录说明），凭证非 0600 记入 blockers。
- `apps/cli/templates/`：`com.agentdev.daemon.plist`（launchd 用户服务）与 `agentdev.service`（systemd 用户服务），与 `reliability.md` §7 对应。
- 测试：`apps/cli/test/runtime.integration.test.ts`（4 例，真实子进程守护 + 真实 HTTP）：status→start→open（幂等）→status→重复 start→stop 全流程；`start --root`；入口缺失报 `START_FAILED`；`open` 缺参数报 `VALIDATION_ERROR`。`apps/cli/test/doctor.integration.test.ts` 增加运行时探针 3 种状态（新增 1 例）。

## 已跑通的真实路径（开发期手工验证 + 自动化）

- `pnpm build` 后 `node apps/daemon/dist/main.js --home <tmp> --root <git> --trust`：真实启动、写出 `runtime.json`、`/health` 带凭证返回实例、`SIGTERM` 优雅停止后 `runtime.json`/`daemon.lock` 均消失。
- 新增测试：contracts runtime 11、core runtime 9、daemon runtime integration 5、cli runtime integration 4、doctor integration 9（含新增运行时探针）。

## A2 进行中

A2-T4（Supervisor：认领/epoch/capability/spawn/事件/结果/并发）、A2-T5（心跳、interrupted、终止与重启核对）、A2-T6（capability 鉴权的 Core 侧模型网关 + Runner 真实模型通路）尚未实现；完成后本文件续写，并按 Plan §6 进入独立 Review/Test。

## 与既有记录的说明

WP-11 的代码改动会改变 `scripts/lib/acceptance-binding.mjs` 计算的 `codeDigest`，因此 `.agentdev/work/WP-10/` 下记录的 `codeDigest` 从此指向 WP-10 的验证树 `9f154c3`（历史证据，不变）。WP-11 冻结前会重跑契约命令并在本包内重新生成验收记录。
