# WP-10 实现记录（发布整体验收）

- planVersion: 0（本包为发布验收；无独立 plan，按 `docs/delivery/implementation.md` WP-10 与验收文档执行）
- 依赖：WP-00～WP-09（全部已结算，末包 WP-09 结算 `508bfaf`，代码树 `e9e237d`）
- 关联验收：AC-001～AC-094 全部
- **产品决定（经用户确认）**：不引入 Playwright/浏览器下载；`test:e2e` 以真实 Core + 真实 BFF + 真实 HTTP/WS 的无头端到端实现，浏览器级像素/焦点证据登记为 UNVERIFIED。

## T1 验收聚合运行器（`pnpm test:acceptance`）

- `scripts/acceptance.mjs` + `scripts/lib/{acceptance-registry,acceptance-evidence,acceptance-report}.mjs`：
  - 解析 `docs/delivery/acceptance.md` 得到 AC-001～AC-094 精确注册表（校验重复/缺口/越界）。
  - 通过 pnpm 的 `node_modules/.bin/vitest` shim 运行真实 unit/integration 项目（保证 worker 线程的 NODE_PATH 可达），把每个已执行测试映射到它证明的 AC（来源：测试名中的 AC id、测试文件中的 AC id、可审计的补充映射 AC-004/067/086）。
  - 合并演练报告（`--drill-report` / `AGENTDEV_DRILL_REPORTS` / `.agentdev/work/WP-10/drills/*.json`）：演练 FAIL 覆盖套件 PASS，演练 PASS 可关闭离线套件无法触达的 AC。
  - 失败闭合：任一 AC FAIL、任一必需 AC 无结果、或某失败测试无法映射 ⇒ 退出非 0；UNVERIFIED 必须点名缺失的环境/Provider/浏览器并写入报告。
  - 结果：**94/94 已计账；PASS 93 / FAIL 0 / UNVERIFIED 1（AC-001 需真实 Provider）**，退出 0；报告写入 `.agentdev/work/WP-10/acceptance.md`（含逐 AC 表、原始套件结果、UNVERIFIED 原因、映射审计与机器可读 JSON）。

## T2 无头端到端运行器（`pnpm test:e2e`）

- `scripts/e2e.mjs` + `scripts/lib/{e2e-runtime,e2e-checks}.mjs`：在同一进程内启动**真实栈**（真实临时 Git 项目 + 真实 SQLite `ProjectStore` + 真实 Core 服务 + 真实 `createDaemon`(HTTP `/rpc`、`/ws`) + 真实 `createWebApp` BFF，loopback 随机端口），用 Node 内建的浏览器形态客户端（`node:http` + 手写 RFC6455 + multipart）驱动；`e2e-runtime` 用 Node 24 原生类型剥离把 `@agentdev/*` 解析到**当前源码**（不依赖 `dist`）。
- 20 项检查（首个失败即带原始证据退出非 0）：登录/Cookie/Origin 生命周期、需求保存到 Git、看板规则、Chief 路由消息、Plan 批准与过期卡片、Inbox 去重、配置校验保留输入、经 BFF 上传 + 首条消息绑定、分支预览边界、九面真实读数与 Live 面板、事件水位重连、**L2 交付链**（真实 Work/Requirement/Task + 真实规划 Run + 真实 Plan 批准 + 真实 detached worktree 候选提交 + 5 次真实 `StageGate.submit` + 产品自身 `evaluateStageChain` 顺序校验）、**结算**（真实 CompletionManifest 冻结 + CAS + 完成事件 + Requirement completed）、**知识补丁与冷启动**、Provider 桩零调用。
- 结果：**20 项检查 PASS 16 / FAIL 0 / UNVERIFIED 4；覆盖 23 个 AC**，退出 0；写入 `.agentdev/work/WP-10/{e2e-results.json,e2e.md}` 并被验收聚合自动合并。

## T3 真实 Provider 纵向与发布演练（`pnpm test:live`）

- `scripts/live.mjs` + `scripts/lib/{live-transport,live-harness,live-drills,live-report,live-release}.mjs`：
  - 读取 `AGENTDEV_PROVIDER_BASE_URL/MODEL/SECRET`（可选 `_REVIEW_MODEL`、`_CONTEXT_WINDOW`、`_MAX_OUTPUT_TOKENS`）；任一缺失 ⇒ 打印并写入 `UNVERIFIED: real Provider not configured (set …)`、**零网络调用**、退出 3；三者齐备 ⇒ 运行三条纵向演练（HTML 说明 / L1 错字 / L2+结算），仅全通过退出 0。
  - 传输为 Node 内建 OpenAI 兼容 HTTP（`node:http(s)`）并实现 Gateway 的 `GatewayTransport`；凭证在一切失败信息中被遮蔽。
  - `live-harness` 启动真实临时 Git（`agentdev/main`）+ 真实 SQLite + 真实 `createDaemon`/`createWebApp`，配置真实 `ConfigStore` provider 并经真实 `SecretStore`（Work 级 `secret` Grant + `gatewaySecretResolver`）解析凭证，通过真实 `ModelGateway.complete` 带真实冻结快照调用模型。
  - `--release` 运行文档中的十条命令并记录退出码/耗时/尾部，读取验收聚合，跑 `pnpm doctor` 生成部署说明，**内置就绪门禁**：任一命令失败或任一 AC FAIL ⇒ 非 0 并打印最终汇总；写入 `.agentdev/work/WP-10/release.md`。
- 本轮结果（未配置 Provider）：`pnpm test:live` 退出 **3**（明确 UNVERIFIED，零调用）；`node scripts/live.mjs --release` ⇒ **NOT READY**（命令 9/10 ok；AC PASS 93 / FAIL 0 / UNVERIFIED 1；失败命令 `pnpm test:live`），`pnpm doctor` 退出 0（`executionReady=true`）。

## T4 验证与本轮状态

- 契约命令：`pnpm typecheck` 0；`pnpm lint` 0；`pnpm test:unit` **55 文件 / 1105 用例**；`pnpm test:integration` **26 文件 / 311 用例**；`pnpm test:e2e` 通过（20 检查）；`pnpm test:acceptance` 通过（94/94 计账）；`pnpm test:live` 退出 3（Provider 未配置，诚实 UNVERIFIED）；`pnpm docs:check` ok；`pnpm build` **12 workspace**。
- 已登记 UNVERIFIED / 残余：
  1. **AC-001**（自由问答的事实/未知分离）——唯一 UNVERIFIED 的 AC，正是 `pnpm test:live` 在提供 Provider 后关闭的对象。
  2. 浏览器级 AC（AC-002/052/071/073/076 的客户端半边）——按产品决定不引入浏览器；服务端 CSP/sandbox/一次性下载与上传限制已由演练与套件证明。
  3. AC-043 仅在提供独立 Review/Test 模型（`AGENTDEV_PROVIDER_REVIEW_MODEL`）时成立，否则记为 UNVERIFIED。
  4. L1 演练的 Work 等级为直接播种（`AssessmentPayload` 无 L1 判据且 `orchestrator.routingFloor` 将具名写交付抬为 L2，DC-62）；CompactPlan 仍走 `gates.planningRun` 的 Plan 产物路径。
  5. L2 演练的 Requirement 投影为直接播种、批准 Plan 无 `productRef`（ProductDefinition/ContextBuilder 由 WP-05/06 套件证明）。
  6. 演练中的 CAS journal 用内存实现（崩溃注入不在本片范围）。
  7. 部署说明中 `agentdev start/stop/status/open/backup/restore/relocate` 未实现（apps/cli 仅有 doctor/version），已在 `release.md` 标 UNVERIFIED 并给出真实程序化/RPC 入口。
  8. `scripts/not-implemented.mjs` 已无任何根脚本引用（可后续删除）。
  9. e2e 演练发现的产品观察：`requirement.save` 仅更新元数据时会在 `content.md` 追加版本标记（版本配对与组合 Hash 仍有效，解析取首个标记）——登记为残余而非断言掩盖。
