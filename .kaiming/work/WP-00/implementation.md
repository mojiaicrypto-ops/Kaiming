# WP-00 实现记录（Develop）

- 工作包：WP-00 工具链与执行底座（`docs/delivery/implementation.md` §2）
- 等级：L2（授权引用与 Plan 见 `plan.md`；授权原文「同意先实现工具链与执行底座」，2026-09-11）
- 关联验收：AC-048、AC-066、AC-067
- 基线：`6cdbb75`（docs/webui/AGENTS.md）；本包全部为新增文件，未修改基线文档
- 日期：2026-09-11

## 1. 实际产出

### 1.1 根工程

| 文件 | 说明 |
|---|---|
| `package.json` | pnpm 12.3.4 / Node ≥24 固定；`install/typecheck/lint/test:unit/test:integration/test:e2e/test:acceptance/test:live/docs:check/build` 十个契约命令；未实现命令统一 `NOT_IMPLEMENTED` |
| `pnpm-workspace.yaml` | `packages/*`、`apps/*`；`allowBuilds` 显式关闭 `@google/genai`/esbuild/protobufjs 的安装脚本（pnpm 12 将忽略的构建视为致命错误） |
| `tsconfig.base.json` / `tsconfig.json` | ES2023 + NodeNext + strict + exactOptionalPropertyTypes；TypeScript 7 已移除 `baseUrl`，改用相对 `paths` |
| `vitest.config.ts` | `unit`（`*.test.ts`）与 `integration`（`*.integration.test.ts`）两个 project；别名指向包源码 |
| `eslint.config.js` | 类型感知 lint + Node 全局；`.cjs` 允许 `require` |
| `scripts/` | `docs-check.mjs`、`not-implemented.mjs`、`clean.mjs`、`lint.mjs`、`typescript-6-preload.cjs` |

### 1.2 packages/contracts

文档契约的 Schema 层：`primitives`（UUIDv7、FeatureId、ProjectId、SHA256、Git revision、仓库相对路径、ref、operation、scope）、`enums`（角色/状态/产物/证据等）、`limits`（`LIMITS`/`CONTEXT_LIMITS`/`INITIALIZATION_BUDGET`/`ATTACHMENT_LIMITS`/`ARTIFACT_LIMITS`/`PROTOCOL_LIMITS`/`AUTH_LIMITS`，含 `taskWriterCount=1`、`providerRetries=2` 等固定值）、`errors`（25 个错误码与重试性）、`protocol`（信封、写命令字段、分页、hello）、`toolchain`（Node 下限、pnpm 版本、钉定依赖、工程命令）。81 个单元测试（errors 含重试性一致性用例）。

### 1.3 packages/pi-runtime（唯一引用 Pi SDK 的包）

- `session.ts`：`PiSessionFactory` + `PiSessionHandle`，暴露 create/prompt/steer/followUp/abort/compact/dispose/subscribe/sessionFile；模型经 `ModelRuntime` 显式解析（离线目录、内存凭证、`allowModelNetwork:false`），未知 provider/model 抛 `MODEL_UNAVAILABLE`；订阅每次重建；SDK 事件映射为自有 `PiSessionEvent`（SDK 类型不外泄）。
- `resources.ts`：`ExplicitResourceLoader` + `createExplicitResources`，只加载调用方显式选择的 Skill/项目文件/系统提示词，`includeDefaults:false`；不信任的 Project 不加载 Skill，传入项目文件直接抛 `UNTRUSTED_RESOURCE`；`extendResources` 只记录不加载。
- `extensions.ts`：内置扩展白名单注册表（P0 默认为空）、`CRITICAL_CAPABILITIES`（policy/context/artifact/events/dispatch）、未知 ID 拒绝、Critical 失败阻断启动、可选失败仅禁用自身、apiVersion 不匹配按该条目失败。
- `errors.ts`：`PiRuntimeError` 与错误码。

### 1.4 apps/runner

`attempt.ts`（单 Attempt 进程：扩展门禁 → 显式资源 → Pi 会话 → 事件流 → 结果上报；attemptId+epoch 校验，过期消息丢弃；一次 Attempt 一个写者，不触碰 SQLite；扩展 manifest/激活钩子与 `buildSession` 测试缝）、`ipc.ts`（zod 严格校验的换行 JSON 协议，`attempt.ready` 含 `droppedTools`）、`cli.ts`（`--self-check` 走完整启动路径后退出；`--extension <id>` 触发未知 ID 拒绝）。

### 1.7 packages/pi-runtime 事件映射

`events.ts`：SDK 事件 → 自有 `PiSessionEvent`（agent/turn 生命周期、text_delta、thinking_delta、tool_start/end、compaction_start/end、queue_update、未知类型 raw），SDK 类型不外泄。

### 1.5 apps/cli

`doctor.ts`：真实探测 Node/pnpm（含 `~/.local/bin/pnpm` 回退与 corepack 坏 shim 报错）、git、Pi SDK 版本、Docker 守护进程与固定镜像 digest 及**镜像运行能力**（实际运行镜像校验 Node v24.x 与 uid 10001，防止仅凭标签误判）、目录权限、端口占用；能力缺失时 `executionReady=false`、退出码 1、列出 blockers。`cli.ts`：`doctor [--json]`、`version`。

### 1.6 docker

`Dockerfile`：Node 24 slim + git/openssh/make/g++/python3/ripgrep，非 root uid 10001。`build-image.sh` 输出 imageId/repoDigest；`run-agentdev.sh` 固化 read-only rootfs、cap-drop=ALL、no-new-privileges、pids 256、内存 2g、CPU 2、`--network none`。

## 2. 检查命令与结果（2026-09-11，本机）

| 命令 | 结果 |
|---|---|
| `pnpm install --frozen-lockfile` | 退出 0（锁文件一致，供应链策略通过） |
| `pnpm typecheck` | 退出 0（strict，无错误） |
| `pnpm lint` | 退出 0（类型感知 ESLint + Prettier 检查） |
| `pnpm test:unit` | 9 文件 / 107 用例全部通过 |
| `pnpm test:integration` | 4 文件 / 38 用例全部通过（含 9 个容器隔离负例） |
| `pnpm docs:check` | `15 documents, 54 internal links, 94 acceptance cases, 9 requirements, 11 work packages` |
| `pnpm build` | contracts/pi-runtime/runner/cli 全部产出 dist |
| `pnpm test:e2e` / `test:acceptance` / `test:live` | 按契约失败：`NOT_IMPLEMENTED ... lands with WP-09/WP-10` |

真实环境探测（`node apps/cli/dist/cli.js doctor`）：

```
ok node 24.8.0 (>= 24.0.0)   ok pnpm 12.3.4 [/Users/huyaohua/.local/bin/pnpm]
ok git 2.39.3                ok pi-sdk 0.85.1
ok docker 28.4.0 [image agentdev/exec:0.0.0 sha256:8fc05469596d
                  digest agentdev/exec@sha256:8fc05469596d41e852caf4039e4bd9e0544fcd93c6dd93b4e62b60aa9cd16d4b]
ok dir ~/.agentdev           ok dir <repo>
info port 4317 free          info port 4318 free
execution ready: yes          (exit 0)
```

Runner 真实进程（`dist/cli.js --self-check`，离线目录，无网络）：

```
{"v":1,"attemptId":"ev-1","epoch":1,"type":"attempt.ready","sessionId":"01a08c5a-...",
 "provider":"amazon-bedrock","modelId":"amazon.nova-2-lite-v1:0","tools":["read"]}
exit=0
```

无凭证时失败如实上报（不伪造成功，不挂起）：

```
{"type":"attempt.result","status":"failed","message":"No API key found for amazon-bedrock. ..."}
runner exit=1
```

## 2.1 修订 T2（Review/Test 返工）

独立 Review 给出 FAIL（1 blocker + 4 major + 9 minor），独立 Test 给出 FAIL（2 项阻塞 + 5 项次要）。已修复项与证据见 `discovery.md` DC-04 … DC-13，摘要：

- 压缩用例由同义反复改为 `rejects.toThrow(/compact/i)`（DC-04）；
- `doctor` 增加镜像运行能力探测与造假镜像负例（DC-05）；
- `docker/run-agentdev.sh` 补执行位并注明只读挂载归属（DC-06）；
- Runner 扩展门禁可达：manifest/激活钩子测试缝 + `--extension`，新增阻断/拒绝/工具丢弃测试（DC-07、DC-12）；
- 注释引文、错误码可重试性、常量出处、事件序号测试、Skill 选择测试按评审意见修正（DC-08 … DC-11、DC-13）；
- 复审追加项（N1/N2/N5、D8 残余）见 DC-17：`isRetryable()` 由条件码常量驱动并加一致性测试、镜像探针失败信息区分原因、明确"能力 vs 加固"职责、常量出处注释与 `fixed` 语义说明；
- 流式端到端与带历史恢复、镜像 Attempt 级 digest 冻结记为 followup（DC-14、DC-15）。

## 3. 验收对应

- **AC-048 Workspace 边界**：`doctor` 真实探测依赖/镜像/digest/目录/端口并在缺环境时拒绝（`executionReady=false`、退出 1）；容器测试断言只读 rootfs、只读挂载、非 root uid、cap-drop=ALL、无网络、pids/memory 上限，并各配正向对照；`apps/cli/test/doctor.integration.test.ts`、`apps/cli/test/container.integration.test.ts`。
- **AC-066 SDK 契约**：`packages/pi-runtime/test/session.integration.test.ts` 对真实 SDK 0.85.1 验证创建（离线目录、内存 Settings/Session Manager）、工具 allowlist、订阅/取消订阅、abort、compact、dispose 后拒绝操作、模型缺失拒绝、持久化会话文件打开；资源显式选择与未选择资源不可用见 `test/resources.test.ts`。
- **AC-067 扩展故障**：`packages/pi-runtime/test/extensions.test.ts` 验证未知 ID 拒绝、Critical 阻断、可选独立禁用、apiVersion 失败、能力缺失报告；Runner 侧门禁由 `apps/runner/test/attempt.integration.test.ts` 用注入 manifest 验证 "Critical 失败不创建会话" 与 "未知 ID 拒绝"，CLI 提供 `--extension` 入口。
- **流式映射**：`packages/pi-runtime/test/events.test.ts` 覆盖全部映射分支；端到端流式与带历史恢复见 DC-14（WP-10 复验）。

## 4. 偏差与说明

详见 `discovery.md`（technical_correction/defect/followup 分类记录）。

1. **typed lint 的 TypeScript API**：TypeScript 7 是原生移植，不再提供 JavaScript 编译器 API，`typescript-eslint@8.70.0` 明确拒绝（其支持范围 `>=4.8.4 <6.1.0`）。产品钉定的 `typescript@7.0.2` 保留给 `typecheck`/`build`；`pnpm lint` 通过 `scripts/lint.mjs` + `scripts/typescript-6-preload.cjs` 仅在该进程内把 `typescript` 解析到 `typescript-lint`（`npm:typescript@6.0.3`），使类型感知规则可用。`typescript-lint` 是新增的 lint 专用 devDependency，不改动钉定版本。
2. **pnpm 解析**：本机默认 PATH 上的 `pnpm` 是 corepack 0.34.0 的坏 shim（pnpm 12 已改为原生启动器），已按非破坏方式安装到 `~/.local/bin`；`doctor` 会报告实际解析路径，未改动全局 corepack。
3. **`~/.agentdev`**：`ARCHITECTURE.md` §… 规定全局配置位于 `~/.agentdev/config.toml`，doctor 作为装配前检查会创建该目录后再验证可写性；工作区目录只验证不创建。
4. **恢复（resume）范围**：离线观察到 SDK 只有在记录到真实轮次后才落盘会话文件，`SessionManager.open` 对空文件会新建 sessionId。因此 WP-00 只验证恢复路径可用（会话可用、工具 allowlist 生效），带历史的恢复与压缩语义属 AC-066 完整行为，按工作包约定在 WP-10 复验。
5. **未实现命令**：`test:e2e`/`test:acceptance`/`test:live` 仍按契约失败，不伪造通过。

## 5. 未覆盖 / 后续

- 真实 Provider 纵向任务（用户尚未提供 baseUrl+model+密钥注入方式）。
- web/daemon/domain/storage/core 等其余包，属 WP-01 起的范围。
- 角色自定义工具桥接（`PiToolSpec` 已可用，实际角色工具随相应工作包落地）。

## 6. 回退

本包全部为新增文件（`packages/`、`apps/`、`docker/`、`scripts/` 与根配置），删除即可回到 `6cdbb75` 基线；`typescript-lint` 与 `pnpm-lock.yaml` 一并还原。
