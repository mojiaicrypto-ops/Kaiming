# WP-00 实现 Plan（工具链与执行底座）

- planVersion: 1
- workId: WP-00
- level: L2（新增工程与包，无身份/权限/Secret/数据删除/部署语义；不改公开协议）
- authorization_ref: 用户目标轮次「同意先实现工具链与执行底座」（2026-09-11）
- productRef: 无独立 Requirement；行为依据为 `docs/delivery/implementation.md` WP-00 与关联 AC

## 1. goal

建立可运行的工程底座：固定依赖与工程命令、共享 Schema 基础、Pi 运行时适配与资源加载、单 Attempt Runner 骨架、真实能力探测 `doctor` 与固定 Docker 镜像；使后续 WP-01–10 有可编译、可测试、可验证的接口面。

## 2. scope

writePaths:

- `package.json`、`pnpm-workspace.yaml`、`pnpm-lock.yaml`、`tsconfig*.json`
- `vitest.config.ts`、`eslint.config.js`、`.prettierrc.json`、`.prettierignore`、`.gitignore`
- `packages/contracts/**`、`packages/pi-runtime/**`
- `apps/runner/**`、`apps/cli/**`
- `scripts/**`、`docker/**`
- `.agentdev/work/WP-00/**`（过程记录）

readPaths: `docs/**`（主要 `INDEX.md`、`delivery/implementation.md`、`delivery/acceptance.md`、`architecture/execution.md`、`architecture/ARCHITECTURE.md`、`rules/agents.md`）
不可写：`docs/**`（正式文档变更走文档路线，本 Plan 不含）、`webui/**`

## 3. tasks（DAG）

| id | 角色 | goal | dependsOn | acceptanceIds |
|---|---|---|---|---|
| T1 | backend | 根工程与固定依赖、工程命令脚本、lint/format/tsconfig | — | AC-048 |
| T2 | backend | `packages/contracts` 基础 Schema：通用类型、枚举、限额默认值、协议错误码 | T1 | AC-066 |
| T3 | backend | `packages/pi-runtime`：Factory/ResourceLoader/Session 生命周期适配与工具桥 | T2 | AC-066 |
| T4 | backend | 扩展注册表：critical 阻断、可选独立禁用、未知 ID 拒绝 | T3 | AC-067 |
| T5 | backend | `apps/runner`：单 Attempt、capability/epoch 校验骨架、IPC | T3 | AC-066 |
| T6 | backend | `apps/cli doctor`：Node/pnpm/Docker/Git/Pi/目录权限/端口真实探测 | T1 | AC-048 |
| T7 | backend | Docker 固定镜像与只读挂载负例 | T6 | AC-048 |
| T8 | backend | `docs:check` 与根命令接通、单元/集成测试落地 | T2,T5,T7 | AC-048,066,067 |

checks: `pnpm install --frozen-lockfile`、`pnpm typecheck`、`pnpm lint`、`pnpm test:unit`、`pnpm test:integration`、`pnpm docs:check`、`pnpm build`

## 4. 接口/数据影响

- 新增共享 Schema 包 `@agentdev/contracts`：通用类型（ID/Hash/Time/Path/Ref/SourceRef/Scope）、状态与角色枚举、限额默认值表、协议错误码与 Envelope。**只新增，不改动既有契约**；枚举取值严格照 `architecture/data.md`、`rules/workflow.md`。
- 新增 `@agentdev/pi-runtime`：对外暴露 Session 生命周期 API 与扩展注册表，内部唯一引用 Pi SDK 类型（`architecture/ARCHITECTURE.md` §3 约束）。
- 新增 `apps/runner`、`apps/cli`：进程入口，不接触仓储数据；本包不产生 SQLite schema（WP-01 负责）。
- 无数据迁移、无对外协议变更。

## 5. 验证策略

- 单元：Schema 正负例（未知枚举拒绝、精确版本/路径约束）、限额默认值与上下界、错误码清单完整性、扩展注册表三态。
- 集成：真实 Pi SDK 的 create/stream/tool/abort/compact/resume/subscribe 与 ResourceLoader 显式资源（注入内存 Settings 与桩 ModelRuntime，不依赖真实 Provider）；`doctor` 在真实环境探测 Node/pnpm/Docker/Git 与目录权限；Docker 只读挂载/非 root/无网络负例。
- 失败测试（必需）：缺依赖安装失败可诊断、SDK 创建/取消/压缩、资源控制负例（未选择资源不可用）、只读挂载写入被拒。
- 不做出：不实现领域 Gate、知识、交付流程（WP-01+）。

## 6. 风险与回退

- 风险：pnpm 12 与 corepack 0.34 不兼容（实测确认）→ 采用用户前缀安装 `~/.local/bin/pnpm`，`doctor` 校验版本并把不匹配报告为可操作项。
- 风险：TypeScript 7 / Vitest 5 / ESLint 组合兼容性未知 → 先最小组合跑通，若某工具不可用则记录技术修正并显式固定替代版本（不改产品契约）。
- 风险：Docker 镜像构建需拉取基础镜像 → 失败时保留镜像定义与探测代码，doctor 如实报告 `dockerReady=false`，不伪造通过。
- 回退：全部为本包新增文件，回退方式为删除 `packages/`、`apps/`、`scripts/`、`docker/` 与根配置，仓库回到基线提交 `6cdbb75`。

## 7. 结算

代码、Schema、测试与工程命令接通后，由独立 Review 与 Test 复核本包必验范围，产出 `.agentdev/work/WP-00/{implementation,review,test-report,settlement}.md` 与 AC 证据。
