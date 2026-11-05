# WP-00 独立 Review（Review 角色）

- 工作包：WP-00 工具链与执行底座（`docs/delivery/implementation.md` §2）
- 关联验收：AC-048、AC-066、AC-067（`docs/delivery/acceptance.md`）
- 依据：`docs/INDEX.md`、`docs/rules/workflow.md`、`docs/rules/agents.md`、`docs/architecture/execution.md`、`docs/architecture/ARCHITECTURE.md`、`docs/delivery/implementation.md`、`docs/delivery/acceptance.md`、`.agentdev/work/WP-00/plan.md`
- 评审对象：已暂存但未提交的 WP-00 产物
- **冻结点**：`git write-tree` = `9d38908e7f1fe6accb3aec34d410b40835570392`（57 个已暂存文件，+8019 行；`git diff` 对已暂存文件为空）
- 评审日期：2026-09-11（本机 macOS arm64）

## 0. 评审方式与冻结说明

- 所有结论来自本次在磁盘/命令输出上重新读取与重新执行的结果。
- 未使用开发方自述作为证据。为核对「交付诚实性」，我阅读了 `.agentdev/work/WP-00/implementation.md` 与 `plan.md`，但只把它们当作**被检验的声明**，不作为通过依据。
- **未读取** `.agentdev/work/WP-00/test-report.md`（Review 输入不含 Test 产物；该文件在评审期间出现，属并发写入）。
- 工件在评审期间发生过写入：`implementation.md` 于 00:26:54 进入暂存区（评审开始之后）；代码/测试/配置文件最后修改时间均 ≤ 00:22:36，早于本次评审的全部读取，故代码结论对当前字节有效。`test-report.md` 在评审收尾时出现，未纳入。
- 我只写了本文件；未修改任何源码、配置或测试。

## 1. 逐 AC 结论

| AC | 结论 | 依据 |
|---|---|---|
| AC-048 Workspace 边界 | **PARTIAL（不通过）** | 容器隔离与「缺环境拒绝」可复现；但 `doctor` 的 `executionReady` 只校验镜像**标签存在**，任意未加固镜像都会得到 `executionReady=true`（D2）。Broker/按角色只读挂载属 WP-07 |
| AC-066 SDK 契约 | **FAIL** | 创建/工具/abort/dispose/订阅/资源控制可复现；**压缩**的必需失败测试是同义反复（D1，blocker）、**流式**零覆盖（D3）、**恢复**未真正验证（D4） |
| AC-067 扩展故障 | **PARTIAL** | 注册表层三态测试非空转、可复现；但交付物中不存在任何配置入口，`startupBlocked`/`missingCapabilities`/未知 ID 拒绝在真实启动路径上不可达（D5） |

### 1.1 WP-00「本包必验范围」逐项

| 必验项 | 结论 | 证据 |
|---|---|---|
| 镜像/权限探测 | **PARTIAL** | 容器 9 个负例全部实测通过（含正向对照）；`doctor` 的镜像判定只是标签存在性（D2） |
| Pi SDK 生命周期与资源加载 | **PARTIAL** | 真实 SDK 0.85.1、无 mock、离线语义在 SDK 源码层核实；压缩测试空转（D1）、流式无覆盖（D3） |
| Critical/可选扩展注册 | **PASS（库层）** | 三态与未知 ID 的单元测试逻辑非空转；真实启动路径不可达（D5） |
| 必需失败测试：依赖安装 | **PASS** | `pnpm install --frozen-lockfile` 退出 0，供应链策略通过 |
| 必需失败测试：SDK 创建/取消/压缩/资源控制 | **FAIL** | 创建/取消/资源控制有负例；**压缩项缺失**（D1） |
| 必需失败测试：只读挂载负例 | **PASS** | 只读挂载写入被拒 + 可写挂载正向对照（实测通过） |

## 2. 执行的命令与结果（全部为本次重新执行）

| 命令 | 退出码 | 关键输出 |
|---|---|---|
| `pnpm --version` | 0 | `12.3.4`（`~/.local/bin/pnpm`） |
| `pnpm install --frozen-lockfile` | 0 | `Lockfile is up to date, resolution step is skipped`；`Lockfile passes supply-chain policies` |
| `pnpm typecheck` | 0 | `tsc -p tsconfig.json --pretty false`，无输出 |
| `pnpm lint` | 0 | ESLint 无输出 + `All matched files use Prettier code style!` |
| `pnpm docs:check` | 0 | `docs:check ok — 15 documents, 54 internal links, 94 acceptance cases, 9 requirements, 11 work packages` |
| `pnpm test:unit` | 0 | `8 passed (8)` / `97 passed (97)`，2.97s |
| `pnpm test:integration` | 0 | `4 passed (4)` / `33 passed (33)`，56.37s（含 9 个容器用例 54.97s） |
| `pnpm build` | 0 | contracts / pi-runtime / runner / cli 全部 `Done` |
| `pnpm test:e2e` / `test:acceptance` / `test:live` | 1 / 1 / 1 | `NOT_IMPLEMENTED: command … lands with WP-09/WP-10`（不伪造通过，符合契约） |
| `node apps/cli/dist/cli.js doctor --json` | 0 | `executionReady: true`，`blockers: []`，imageId `sha256:ffb122b2…`，pnpm `12.3.4`，pi-sdk `0.85.1` |
| `node apps/cli/dist/cli.js doctor` | 0 | 人类可读报告，`execution ready: yes` |
| `node apps/runner/dist/cli.js … --self-check` | 0 | `{"type":"attempt.ready",…,"provider":"amazon-bedrock","modelId":"amazon.nova-lite-v1:0","tools":[]}` |
| 同上，`--provider nope --model nope` | 1 | `{"type":"attempt.error","code":"MODEL_UNAVAILABLE","message":"model nope/nope is not in the catalog"}` |
| `docker run … id -u` 等 9 项容器检查 | — | 由 `pnpm test:integration` 覆盖，全部通过 |

补充实测（非工作包自带测试）：

- **lint 非空转**：注入 `any` + 未使用变量 → `eslint exit=1`，命中 `no-explicit-any`、`no-unused-vars`、`no-unsafe-assignment`（类型感知规则确实生效）；干净输入 → `exit=0`。
- **TS 6 预载是承重的**：去掉预载后 `eslint exit=2`，报 `typescript-eslint does not support TS 7.0.`；加载时 `require('typescript/package.json').version` = `6.0.3`，而根 `node_modules/typescript` = `7.0.2`。
- **网络隔离非空转**：镜像内 `getent` 存在（`/usr/bin/getent`），`--network none` 下 `getent hosts localhost` → rc=0，`getent hosts registry.npmjs.org` → rc=2；同镜像 `--network bridge` 正向对照解析成功（rc=0）→ 该负例当前不空转。
- **离线语义（SDK 源码层）**：`…/pi-coding-agent/dist/core/model-runtime.js:88` `modelNetworkEnabled = process.env.PI_OFFLINE === undefined`；`:91` `refreshFromNetwork = modelNetworkEnabled && options.allowModelNetwork === true`；`:100` `refreshOnCreate !== false` 才 `refresh()`；`:76` `modelsPath === null → undefined`（不读用户 `models.json`，改用 `InMemoryCodingAgentModelsStore`）。适配器默认 `allowModelNetwork:false`、`modelsPath:null`、`InMemoryCredentialStore`，且 `createAgentSession` 只在使用方未提供 `resourceLoader` 时才 `new DefaultResourceLoader()`（`dist/core/sdk.js:75-78`）——适配器把 `resourceLoader` 设为必填，默认发现确实被禁用。

## 3. 缺陷清单

### D1 [blocker] 「压缩」必需失败测试是同义反复

- 位置：`packages/pi-runtime/test/session.integration.test.ts:124-134`（判定在 `:131-132`）
- 事实：`outcome` 由 `compact().then(() => 'resolved', () => 'rejected')` 构造，只可能取两个值，而断言 `expect(['resolved','rejected']).toContain(outcome)` 恰好只接受这两个值——**无论 `compact()` 成功、失败、还是被改成空实现，该断言恒为真**。
- 最小复现（我用 dist 直接探测）：空会话上 `compact()` 实际 **reject**，`Error: Nothing to compact (session too small)`；即「成功/失败都算过」掩盖了真实行为。
- 附带：`:126-127` 注释「the SDK reports the no-op」与实测不符（SDK 抛错）。
- 违反：WP-00「必需失败测试：…SDK创建/取消/**压缩**/资源控制」与退出条件「本包必验范围全部通过」。
- 修复方向：断言真实契约（空会话必定 reject 且错误含义为“过小”，或注入可压缩历史后断言 `CompactionResult` 字段），并保留一条会因回归而失败的负例。

### D2 [major] `doctor` 对未加固镜像也判 `executionReady=true`

- 位置：`apps/cli/src/doctor.ts:141-170`（`probeDocker`，仅 `docker image inspect` 取 Id/digest）、`:226-228`（唯一 Docker blocker 条件）、`:241`（`executionReady = blockers.length === 0`）
- 最小复现（本次实测，探针镜像已删除、真实镜像未受影响）：
  1. `echo "not a hardened image" | docker import - agentdev/exec:probe-bogus` → 生成 `user=`（root）、无 node/git 的镜像；
  2. `buildDoctorReport({imageTag:'agentdev/exec:probe-bogus', …})` → `docker.status=ok`、`executionReady=true`、`blockers=[]`。
- 影响：AC-048 证据行含 `doctor`；用户看到 `execution ready: yes` 时，产品并未确认该标签指向的是 `docker/Dockerfile` 构建的加固镜像。digest 只被**记录**、从未与任何期望值比对。
- 佐证：评审期间 `agentdev/exec:0.0.0` 的 imageId 由 `sha256:8fc05469…` 变为 `sha256:ffb122b2…`，`doctor` 无任何提示。
- 修复方向：`doctor` 内做能力探针（如 `docker run --rm <image> id -u` 断言 10001）或与配置中记录的期望 digest 比对。

### D3 [major] AC-066「流式」零覆盖

- 位置：`packages/pi-runtime/src/session.ts:115-147`（`toPiSessionEvent`，含 `message_update → text_delta/thinking_delta`、`tool_execution_*`、`compaction_*`、`queue_update`）
- 事实：全部测试中没有任何一处驱动模型轮次或构造 SDK 事件；`grep -rn "text_delta" packages/*/test apps/*/test` 无命中。这些分支只有 `raw` 兜底被间接执行。
- 影响：AC-066 明确包含「流式」；WP-00 必验范围（生命周期与资源加载）可以解释为不覆盖内容流，但 AC 本身在此期间无法签署，且实现记录未披露该缺口。
- 修复方向：用桩 ModelRuntime/事件注入驱动 `toPiSessionEvent` 的每条分支（单元级即可），或在 WP-10 之前明确记为未覆盖。

### D4 [major] 「恢复」测试无法区分“已接线”与“被忽略”

- 位置：`packages/pi-runtime/test/session.integration.test.ts:154-180`（`storedFile` 在 `:156` 构造，`sessionDir` 从未创建）
- 最小复现（探测）：`sessionDir`/`storedFile` 均不存在即调用 `createSession({resumeFrom: storedFile, sessionDir})` → 成功返回**全新** sessionId，`sessionFile()` 指向该路径但文件始终不存在。断言只有「sessionId 形如 UUID」与「工具 allowlist 生效」——把 `resumeFrom` 换成任意不存在的路径、甚至忽略该参数，断言同样通过。
- 诚实性：`implementation.md` §4.4 已如实披露「带历史的恢复属 WP-10」，故不是隐瞒；但测试名与 §3 的「验证…恢复」措辞高于实际证据。
- 修复方向：改为断言可观察的恢复语义（写入一条真实历史后断言 messageCount/内容），或把测试改名为「容忍缺失的会话文件」并在 AC 证据中登记未覆盖。

### D5 [major] AC-067 在交付物中无任何可达路径

- 位置：`apps/runner/src/attempt.ts:72-85`（硬编码 `providedCapabilities: ['policy','context','artifact','events','dispatch']`，且从不传 `requested`）；`packages/pi-runtime/src/extensions.ts:87-101`（未知 ID 抛错）、`:136-143`（`startupBlocked`/`missingCapabilities`）
- 事实：`grep` 显示 `activateExtensions` 的调用者只有测试与 `attempt.ts`；`attempt.ts` 不传 manifest/requested，且 `BUILTIN_EXTENSIONS` 为空 → 真实 Runner 启动时 `disabled` 恒为空、`startupBlocked` 恒 false、`missingCapabilities` 恒为 `[]`；`fail('CRITICAL_EXTENSION_FAILED', …)` 为死代码。
- 影响：注册表逻辑本身正确且测试非空转（PASS），但「配置未知 ID → 拒绝启动」在 WP-00 交付物中无法端到端复现。文档把扩展清单/配置划给后续包，故这是**范围缺口**而非编造；必须在 WP-10 前补齐配置入口并重验。
- 修复方向：由 WP-01/WP-02 提供扩展配置并按 Attempt 传入；在此之前 AC-067 只能记为部分验证。

### D6 [minor] 源码注释伪造文档引文

- 位置：`apps/runner/src/attempt.ts:4-7`，声称引用 `docs/architecture/execution.md` §2：
  「每次Attempt使用独立Run/Session/Context/进程；一次Attempt一个写者；Epoch单调递增；…重连补发由EventHub负责。」
- 事实：`grep -rn "一次Attempt一个写者\|Epoch单调递增\|重连补发由EventHub" docs/` 无命中；`execution.md` §2 无此段。
- 影响：把不存在的规范文本当作实现依据，属于依据可追溯性缺陷（内容本身与工作包设计一致）。
- 修复方向：改为指向真实条款（如 `reliability.md` §2 的 late-event/epoch 与 `execution.md` §1 的隔离要求），或改写为设计说明而非引文。

### D7 [minor] `PROVIDER_UNAVAILABLE` 无条件标记可重试

- 位置：`packages/contracts/src/errors.ts:71`（`retryable: true`）；被 `packages/contracts/test/errors.test.ts:20-23` 固化为「只有 BUSY 与 PROVIDER_UNAVAILABLE 可重试」
- 对照：`docs/architecture/protocol.md` §7「仅BUSY和已知无副作用的Provider瞬时错误retryable=true」——文档把可重试性绑定到**成因**（瞬时且无副作用），而该错误码同时覆盖文档自己标注的「配置/恢复」情形。
- 影响：配置类故障（密钥缺失/失效）会被客户端当作可重试。
- 修复方向：按 `details` 区分瞬时与配置，或拆码；至少在注释中登记该简化及其与 §7 的偏差。

### D8 [minor] 共享限额中出现了文档未规定的固定值/下界

- 位置：`packages/contracts/src/limits.ts:42`（`providerRetries: limit(2, 2, 2, …, true)`）、`:43`（`shellTimeoutSec` 的 `min=1`）
- 对照：`docs/architecture/ARCHITECTURE.md` §5 只为 `providerRetries` 给出默认 2 与语义，未给范围；`shellTimeoutSec` 只给默认 120 与「可授权到 1800」；文档只把 `taskWriterCount`（单写者）一类称为「固定常量」。
- 影响：把未记载的解释（不可覆盖、下界 1）固化进所有层共用的 Schema，后续 WP 难以区分「规范要求」与「WP-00 选择」。同一处理还见于 `heartbeatSec`/`leaseSec`/`cancelGraceSec`/`idleSessionTtlSec`/`mailbox*`/`connectionQueue*`/`requestLimitBytes`/`eventRetentionDays`（均 `fixed: true`）。
- 修复方向：在这些条目上标注「WP-00 解释，非文档明示」，或在 Plan/实现记录中登记为待确认项。

### D9 [minor] Runner「事件序号单调」测试空转

- 位置：`apps/runner/test/attempt.integration.test.ts:129-137`
- 事实：该用例只做 `start()` + `shutdown`，期间不产生 `attempt.event`。我用 dist 直接探测：消息序列为 `attempt.ready, attempt.result`，**attempt.event 计数 = 0**；于是 `seqs = []`，两条断言对空数组恒真。
- 影响：即使事件转发完全失效，该测试仍通过。
- 修复方向：先断言 `events.length > 0`（需注入可产生事件的最小桩），再断言单调与唯一。

### D10 [minor] 网络隔离负例只断言非零退出

- 位置：`apps/cli/test/container.integration.test.ts:133-136`
- 事实：当前不空转（我已验证 `getent` 存在、localhost 可解析、外部解析失败、bridge 对照成功），但测试本身若在缺少 `getent` 的镜像上运行会因「命令不存在」而通过。
- 修复方向：加 `command -v getent` 前置断言或改用镜像自带工具的确定性失败码。

### D11 [minor] 交付的容器入口只有可写挂载

- 位置：`docker/run-agentdev.sh:17`（`--volume "$WORKSPACE:/workspace:rw"`）；只读路径仅存在于测试内联参数 `apps/cli/test/container.integration.test.ts:110-117`
- 对照：`docs/architecture/execution.md` §3/§5 要求 Review 读冻结源码、源码只读；§1 的加固已由脚本固化。
- 影响：WP-00 无「按角色只读挂载」策略（WP-07 范围），因此 AC-048 的「源码只读者不可写」在本包只能证明**能力具备**，不能证明**策略生效**。

### D12 [minor] 同一数字有两个来源

- 位置：`packages/contracts/src/primitives.ts:77`（`MAX_ARRAY_ITEMS = 1000`）与 `packages/contracts/src/limits.ts:110`（`PROTOCOL_LIMITS.maxArrayItems = 1000`）
- 影响：`scopeSchema` 用前者、`pageSchema` 用后者，未来可能漂移；`data.md` §1 只规定一个数。

### D13 [minor] 技术修正缺少正式记录

- 事实：`plan.md` §6 承诺「若某工具不可用则记录技术修正并显式固定替代版本」；`scripts/lint.mjs:1-8`、`scripts/typescript-6-preload.cjs:1-12`、`implementation.md` §4.1 均已说明，但 `.agentdev/work/WP-00/` 下没有对应的 Discovery/技术修正记录（`rules/workflow.md` §6 `kind=technical_correction`）。
- 影响：流程可追溯性，非功能缺陷。

## 4. 工具链偏差（TypeScript 6 供给 lint）的判定

**结论：可接受，且已被诚实记录；但需补一条技术修正记录。**

理由与证据：

1. 钉定版本未被替换：根 `node_modules/typescript` = `7.0.2`，`typecheck`/`build` 均由 `tsc` 7.0.2 执行（本次实测均通过）。ESLint 不是 `ARCHITECTURE.md` §3 钉定的依赖，文档未对 lint 用的编译器 API 作规定。
2. 重定向是承重且**进程内限定**的：`scripts/lint.mjs:26-33` 只在 lint 子进程注入 `NODE_OPTIONS=--require=scripts/typescript-6-preload.cjs`；去掉它 ESLint 直接失败（`exit=2`，`typescript-eslint does not support TS 7.0.`），加上后类型感知规则确实命中（注入违规 → `exit=1`）。
3. 记录充分性：`scripts/typescript-6-preload.cjs:1-12` 说明了原因（TS 7 原生移植不再提供 JS 编译器 API，typescript-eslint 支持范围 `>=4.8.4 <6.1.0`）与范围（仅 lint 进程）；`plan.md` §6 预告了该风险；`implementation.md` §4.1 明确记录。
4. 残余成本（应在结算前登记）：devDependencies 因此存在两份 TypeScript（7.0.2 + `typescript-lint` 别名 6.0.3）；lint 门禁的类型判断与 build 使用不同编译器版本；待 typescript-eslint 支持 TS 7 后应移除该别名与预载。

## 5. 我无法验证的声明

1. 当前 `agentdev/exec:0.0.0` 标签是否**逐字对应** `docker/Dockerfile` 的构建产物：镜像 ID 在评审期间变化且无期望 digest 可比对；我只验证了它运行时的加固行为与 uid 10001。
2. 未执行 `docker/build-image.sh`（避免联网与扰动被评审环境），因此镜像**可重建性**未验证。
3. `pi-coding-agent@0.85.1` / `pi-ai@0.85.1` 与锁文件是否与 npm 注册表的发布物一致：离线只读 `node_modules` 与 `pnpm-lock.yaml`，未访问注册表。
4. 干净机器/CI 上的 `pnpm install --frozen-lockfile` 可复现性：本次是在已有 `node_modules` 上执行（`Lockfile is up to date`）。
5. 真实模型路径（流式输出、有内容的压缩、带历史的恢复、Provider 鉴权、无凭证时的完整失败语义）：用户尚未提供 Provider，WP-00 未执行，本次无法复现。
6. `toolchain.ts:57-61` 把 `test:integration` 的用途写作「SQLite/Git/Pi/WS/容器集成全通过」，但当前只有 Pi/doctor/容器；SQLite/Git/WS 属后续工作包，该描述目前高于实际。
7. 「失败无残留工具进程」这一集成约束未被任何测试覆盖。
8. 除 D1/D9（已用探针证明空转）与 lint 非空转（已用注入证明）外，其余「回归即失败」的非空转判断为**代码路径分析**，我没有做变异测试。

## 6. 已复现为正确的部分（供修复时保留）

- 契约保真：31 组枚举逐一对照 `data.md`/`workflow.md`/`agents.md` 无误（含 8 角色、13 RunStatus、6 AttemptStatus、5 TaskStage、7 BlockerKind、10 Purpose、12 ArtifactKind、CheckResult `passed/failed/not_covered/blocked`、`stage_result` `success/needs_input/failed`）；25 个错误码与 `protocol.md` §7/§8、`requirements.md` 一致；信封/写命令字段/分页/hello 与 `protocol.md` §1 一致；未知字段被拒绝、`params` 与 `method` 均必填（实测）。
- 限额来源可核对：`globalConcurrentRunners 8 (1–32)`、`projectConcurrentRunners 4 (1–16)`、`roleConcurrency 2 (1–8)`、`workInputOutputTokens 500000 (1e3–1e7)`、`workActiveTimeSec 7200 (60–86400)`、`reviewRepairRounds 3 (0–10)`、上下文 64000/24000/16000/4096–2000000/reserved 4096、初始化 40 文件/512KiB/10000 条、附件 5/20MiB/50MiB/24h、预览 1MiB/2000 行/60s、消息 64000、幂等键 1–128、分页 50/200/1000、认证 24h/5 次——均与 `ARCHITECTURE.md` §5、`agents.md` §6、`knowledge.md` §5、`experience.md` §3、`protocol.md` §1/§2 一致。
- Pi 适配确实使用真实 SDK 0.85.1：无 `vi.mock`/`vi.spyOn` 命中；`getActiveToolNames()`、`compact(customInstructions?)`、`SessionManager.open` 等符号在 SDK d.ts 中存在；工具 allowlist 生效（`agentdev_probe` 在、`bash/edit/write` 不在）。
- 离线与凭证隔离：见 §2 补充实测（`model-runtime.js:76/88/91/100`、`sdk.js:75-78`、`InMemoryCredentialStore`）。
- 资源控制：显式 loader 只在 `skillPaths` 非空时 `loadSkills({includeDefaults:false})`；未选择资源不可用；不信任 Project 拒绝项目文件并给出诊断；`extendResources` 只记录不加载；`reload()` 不扩面——单测非空转。
- 容器加固（实测）：非 root uid=10001；根文件系统只读（`Read-only file system`）；`/tmp` tmpfs 可写；`:ro` 挂载写入被拒且有 `:rw` 正向对照；`CapEff=0`；`--network none` 下外部 DNS 失败而同镜像 bridge 模式可解析；`pids.max=256`、`memory.max=2147483648`。
- `doctor` 如实报告真实环境（node 24.8.0 / pnpm 12.3.4 含路径 / git 2.39.3 / pi-sdk 0.85.1 含路径 / docker 28.4.0 含 tag+id+digest / 目录可写 / 端口状态），镜像缺失或目录不可写时 `executionReady=false` 且退出 1（实测）。
- 未实现命令按契约失败（`NOT_IMPLEMENTED`，退出 1），不伪造通过。

## 7. 结论

**FAIL**

WP-00 的工程底座、契约保真、真实 SDK 集成与容器隔离证据整体扎实且可复现，但存在 1 个 blocker（D1：WP-00 必需失败测试「压缩」为同义反复，恒真）与 4 个 major（D2 doctor 对未加固镜像判 ready、D3 流式零覆盖、D4 恢复测试无效、D5 AC-067 无可达配置路径），因此不满足 WP-00 退出条件「本包必验范围全部通过」，AC-066 不通过、AC-048/AC-067 仅部分通过，不能进入结算。

## 复审（修订 T2）

- 复审对象冻结点：`git write-tree` = `a901b1260e13c1436c00e9e138df268549b546a6`（61 个已暂存文件，+8832 行；`git diff` 对已暂存文件为空，无未跟踪文件）
- 上一轮冻结点：`9d38908e7f1fe6accb3aec34d410b40835570392`（57 files，+8019）
- 方法：只依据磁盘代码、测试与命令输出；每条修复都用独立复现命令核对，不采信修订说明。`plan.md`/`implementation.md` 仍只作为被检验的声明；本轮同样**未读取** `test-report.md`。
- 本次未改动任何仓库文件，仅在文件末尾追加本节。
- 环境提示（非代码缺陷，见 N3）：复审期间并发写入仍在发生——`agentdev/exec:0.0.0` 于本地 00:55:36 被指向一个 `docker import` 出来的 9.08 kB 镜像（`sha256:bcd3a2e2…`，同时挂着 `agentdev/exec:fake-probe`），真实 860 MB 镜像现存于 `agentdev/exec:real-backup`（`sha256:edd3aa50…`）。因此**当前** `doctor` 判定 `executionReady=false`；本轮“全绿”的集成套件运行发生在标签仍指向真实镜像期间（容器用例断言 uid=10001/node v24 全部通过可证）。

### R1. 复跑的命令与结果

| 命令 | 退出码 | 关键输出 |
|---|---|---|
| `pnpm install --frozen-lockfile` | 0 | 锁文件一致、供应链策略通过 |
| `pnpm typecheck` | 0 | 无错误（strict；SDK 字段名受此门禁保护） |
| `pnpm lint` | 0 | `All matched files use Prettier code style!` |
| `pnpm docs:check` | 0 | `15 documents, 54 internal links, 94 acceptance cases, 9 requirements, 11 work packages` |
| `pnpm build` | 0 | contracts / pi-runtime / runner / cli 全部 Done |
| `pnpm test:unit` | 0 | **9 files / 105 tests**（上一轮 8/97；新增 `events.test.ts`） |
| `pnpm test:integration` | 0 | **4 files / 38 tests**（上一轮 4/33；session 11、runner 10、doctor 8、container 9 全通过） |
| `pnpm test:e2e` / `test:acceptance` / `test:live` | 1 / 1 / 1 | 仍为 `NOT_IMPLEMENTED: … lands with WP-09/WP-10`（未回归） |
| `node apps/cli/dist/cli.js doctor` / `--json` | 1 / 1 | 当前环境如实拒绝：`execution ready: no` + blocker（见 N3） |
| runner `--self-check`（真实离线会话） | 0 | `{"type":"attempt.ready",…,"tools":["read"],"droppedTools":[]}` |
| runner `--self-check --extension not-shipped` | 1 | `{"type":"attempt.error","code":"UNKNOWN_EXTENSION","message":"unknown extension id(s): not-shipped"}` |
| runner `--self-check --tools read,agentdev_probe` | 0 | `tools:["read"]`、`droppedTools:["agentdev_probe"]` |

耗时观察：container 套件 55s → 233s、doctor 套件 4s → 116s。除机器并发负载外，`buildDoctorReport` 现在每次都会真实启动一个容器（见 N4）。

### R2. 逐项修复状态

| 项 | 状态 | 独立证据（文件:行 + 复现） |
|---|---|---|
| D1 压缩测试同义反复 [blocker] | **fixed** | `packages/pi-runtime/test/session.integration.test.ts:124-132` 改为 `await expect(session.compact()).rejects.toThrow(/compact/i)`；独立复现：空会话 `compact()` → `REJECTED: Nothing to compact (session too small)`，`/compact/i` 匹配成立；若压缩改为 resolve 该断言必失败。注释已与实测一致 |
| D2 doctor 接受未加固镜像 [major] | **fixed** | `apps/cli/src/doctor.ts:145-170` 新增 `probeImageCapability()`（`docker run --rm --network none <tag> -lc 'node --version && id -u'`，要求 v24.x 且 uid=10001），`:173-216` `probeDocker` 依据其结论返回 `ok`/`mismatch`，`:272` 将 mismatch 计入 blockers。独立复现（我自建的无头镜像）：`probeImageCapability('agentdev/exec:rr-neg')` → 返回失败原因、`probeDocker(...).status='mismatch'`、`buildDoctorReport(...).executionReady=false` 且 blocker 指向该镜像；真实镜像 → `undefined`。**现场复现**：并发方把 `0.0.0` 换成导入镜像后，`doctor --json` → `docker.status: mismatch`、`executionReady: false`、退出 1——上一轮的假阳性已被正确拒绝 |
| D3 流式零覆盖 [major] | **fixed** | 映射抽到 `packages/pi-runtime/src/events.ts:31-63`，`src/session.ts:26,228` 实际调用（`session.ts` 已无重复映射）；`test/events.test.ts:14-85` 覆盖 lifecycle、`text_delta`、`thinking_delta`、未建模 assistant 更新→raw、tool_start/end、compaction_start/end、queue_update、未知类型→raw。我另行核对了 SDK 真实字段（`pi-agent-core/dist/types.d.ts:392-415` 的 `assistantMessageEvent`/`delta`/`toolName`/`isError`，`pi-coding-agent/dist/core/agent-session.d.ts:43-70` 的 `messages`/`steering`/`followUp`），测试夹具与真实 SDK 形状一致，且字段改名会被 `typecheck` 拦下 |
| D4 恢复测试无法区分接线/忽略 [major] | **fixed（就命名与声明而言）** | `session.integration.test.ts:152` 改名 `wires the resume path for a stored session file`，`:155-160` 明确写“不声称恢复历史”、“历史恢复与实时流由 WP-10 复验”。测试断言不变，但现在与证据强度一致；历史恢复本身在 WP-00 仍属未验证（见 R4） |
| D5 AC-067 无可达路径 [major] | **fixed** | `apps/runner/src/attempt.ts:58-63` 新增 `extensionRequests` 与测试缝，`:120-143` 带 `requested` 调用并在 try/catch 中把 `UNKNOWN_EXTENSION` / `CRITICAL_EXTENSION_FAILED` 上报后**不创建会话**；`apps/runner/src/cli.ts:42,74` 新增 `--extension <id>`。独立复现（真实二进制）：`--extension not-shipped` → 退出 1、`code=UNKNOWN_EXTENSION`；测试 `apps/runner/test/attempt.integration.test.ts:206-239`（Critical 阻断且 `sessionBuilt=false`）、`:241-258`（未知 ID 拒绝）通过。残余：发布白名单为空，Critical 失败端到端只能经测试缝触发（文档已把白名单划给后续包，属可接受缺口） |
| D6 伪造文档引文 [minor] | **fixed** | 旧引文 grep 无命中；`attempt.ts:4-10` 改为可核对引用，我逐条在 docs 中验到原文：`ARCHITECTURE.md:33`（单Attempt、Pi Adapter、IPC）、`:46`（会话恢复/SessionManager/订阅重建）、`reliability.md:13`（每次Attempt分配递增epoch）、`execution.md:55`（Core Critical能力五项、配置未知ID拒绝、失败只禁用自身） |
| D7 PROVIDER_UNAVAILABLE 无条件可重试 [minor] | **fixed** | `packages/contracts/src/errors.ts:71-74` 静态 `retryable:false` 并写明 protocol.md §7 依据；`:98-111` 新增 `CONDITIONAL_RETRYABLE_CODES` 与 `isRetryable(code,{providerTransient})`；`test/errors.test.ts:16-25` 断言“仅 BUSY 无条件可重试”“provider 瞬时错误才可重试”“其它码不受该标志影响” |
| D8 未记载的 fixed/下界 [minor] | **partially fixed** | `packages/contracts/src/limits.ts:44-49` 补了 ARCHITECTURE.md §5 出处，我核到原文：`ARCHITECTURE.md:67-68`（`providerRetries | 2 | 两次重试，退避2s/8s；仅可重试瞬时错误`、`shellTimeoutSec | 120 | 单操作可授权到1800`）——引文属实。但 `shellTimeoutSec.min=1` 仍是文档未规定的编码选择，且 §5 只把“如单写者”称为固定常量（`ARCHITECTURE.md:77`），其余 12 个无范围条目仍一律 `fixed:true`；注释“fixes both values exactly”强于原文（§5 给的是默认值与上限）。属可接受解释，但仍是解释 |
| D9 序号测试空转 [minor] | **fixed** | `apps/runner/test/attempt.integration.test.ts:180-194` 注入脚本化会话（缝在 `attempt.ts:79`），真实发出 3 个事件后断言 `seq === [0,1,2]` 并核对第 2 个事件负载；事件未转发时空数组必然不等 |
| D10 网络负例只断言非零退出 [minor] | **fixed** | `apps/cli/test/container.integration.test.ts:133-141` 先做正向对照 `getent hosts localhost`（`code=0` 且 stdout 含 localhost），再断言外部解析失败 |
| D11 交付入口只有可写挂载 [minor] | **fixed** | `docker/run-agentdev.sh:1-12` 注释说明“本 helper 跑 Task worktree 故 rw；只读源码挂载与按角色 ACL 是 Supervisor 策略，随 WP-07 落地”；`git ls-files -s` 记录 `100755`：`docker/build-image.sh`、`docker/run-agentdev.sh`、`scripts/lint.mjs` |
| D12 1000 有两个来源 [minor] | **fixed** | `limits.ts:1` 引入、`:116` `maxArrayItems: MAX_ARRAY_ITEMS`，唯一来源为 `primitives.ts:77` |
| D13 缺技术修正记录 [minor] | **not fixed** | `.agentdev/work/WP-00/discovery.md` **未见**（目录内容：plan.md、implementation.md、review.md、test-report.md、verify.log、verify2.log）。TS6-lint 偏差的依据仍只在代码注释、`plan.md` §6、`implementation.md` §4.1 |
| F4 脚本执行位 | **fixed** | 同 D11：`100755` 已入库 |
| F6 未激活工具被静默丢弃 | **fixed** | `apps/runner/src/ipc.ts:38-39` 新增必填 `droppedTools`；`attempt.ts:169-171` 计算差集。独立复现：`--tools read,agentdev_probe` → `droppedTools:["agentdev_probe"]`，仅 `read` → `[]`。测试 `attempt.integration.test.ts:260-272` |
| F7 资源选择测试不足 | **fixed** | `packages/pi-runtime/test/resources.test.ts:35-49` 在磁盘再建 `other-skill`（`:39`），断言只加载 `demo-skill` 且渲染中不含 `other-skill`——若 loader 回退为自动发现该断言必失败 |

### R3. 新发现的问题

- **N1 [minor]** `CONDITIONAL_RETRYABLE_CODES`（`errors.ts:98`）无任何引用（连测试也未使用）；同时 `ERROR_SPECS.PROVIDER_UNAVAILABLE.retryable=false` 与 `isRetryable()` 可能返回 true 并存——只读静态字段的调用方仍会少报可重试性。修复方向：让 `ERROR_SPECS` 派生自单一事实源，或在类型上把条件可重试码标出。
- **N2 [minor]** `probeImageCapability`（`doctor.ts:145-170`）用 `-lc`，因此探针要求镜像内有登录 shell；失败信息统一为“cannot run the execution probe”，无法区分“无 shell / 无 node / uid 不符”。当前实现功能正确，仅诊断粒度。
- **N3 [环境，非代码]** `agentdev/exec:0.0.0` 当前指向导入的空镜像（`sha256:bcd3a2e2…`，9.08 kB，RepoTags 含 `agentdev/exec:fake-probe`），真实镜像在 `agentdev/exec:real-backup`（`sha256:edd3aa50…`，860 MB）。这是并发验证留下的状态：任何后续容器套件都会因环境而非代码失败。**需在继续验证前把标签恢复**。附带：imageId/digest 仍只被“记录”，从未与期望值比对（“每次Attempt冻结digest”属 WP-07），且镜像在本次复审期间至少变更过两次（`8fc05469…` → `ffb122b2…` → `edd3aa50…`/`bcd3a2e2…`）。
- **N4 [minor]** `doctor` 现在每次判定都真实启动容器（`probeImageCapability`），使每份报告增加 2–5s；`buildDoctorReport` 也被 `doctor.integration.test.ts` 调用 4 次，套件耗时由 4s 升至 116s。若 daemon 热路径频繁调用需考虑缓存。
- **N5 [minor，范围提示]** D2 的探针验证的是**能力**（能跑 node、以 10001 运行），不是**加固**：一个 uid=10001 但根文件系统可写或保留 capability 的镜像仍会通过 `doctor`。加固本身由容器套件证明（通过），故 AC-048 的“源码只读者不可写”仍待 WP-07 策略落地。

### R4. 仍未验证 / 需带入结算的项

1. AC-066 的**历史恢复**与**端到端实时流**：本包明确不做，按工作包约定在 WP-10 复验（D4 已如实声明）。
2. Critical 扩展失败在**发布路径**上不可达（白名单为空），仅测试缝可达；WP-10 需端到端复验 AC-067。
3. D8 残余（`shellTimeoutSec.min=1`、无范围条目的 `fixed:true`）需在结算记录中显式登记为 WP-00 解释。
4. **D13：结算前必须写入技术修正/缺陷记录**（含 TS6-lint 供给、本节 N1/N5 的处置）。
5. N3：恢复 `agentdev/exec:0.0.0` 标签后再跑任何容器套件；镜像 digest 的“冻结/比对”仍属后续包。

### R5. 复审结论

上一轮的 1 个 blocker（D1）与 4 个 major（D2–D5）均已按磁盘证据独立复现为已修复：D1 的压缩负例现在会真实失败、D2 现在能拒绝“带标签但不是执行镜像”的情况（含并发方制造的现场样本）、D3 的流式映射有非空转分支覆盖且字段与真实 SDK 一致、D4 的声明与证据强度对齐、D5 的未知扩展 ID 在真实 CLI 上可复现拒绝且不创建会话。全量命令（install/typecheck/lint/docs:check/build/unit 105/integration 38）退出码均为 0，未实现命令仍按契约失败。遗留问题只有 minor 级：D8 部分修复、D13 未见记录、N1/N2/N4/N5，以及 N3 的环境标签状态。这些不构成结算阻塞，但 D13 与 N3 必须在结算/继续验证前处理。

**RE-REVIEW: PASS**
