# WP-00 Discovery 记录

规则依据：`docs/rules/workflow.md` §"Discovery：defect、technical_correction、product_change、followup、blocking_risk。保存证据、影响、建议、实际路由、关联Finding/Decision。缺陷和范围内技术修正自动返工；产品变化给出本次处理/以后处理/不采纳。"

本文件记录 WP-00 期间的缺陷、范围内技术修正与移交后续工作包的跟进项。所有"实际路由"均为已执行的动作。

## DC-01 technical_correction：pnpm 与 corepack 不兼容

- 证据：本机 `/opt/homebrew/bin/pnpm`（corepack 0.34.0 shim）执行报 `Error: Cannot find module '.../corepack/v1/pnpm/12.3.4/bin/pnpm.cjs'`；pnpm 12 发布物为 `bin/pnpm.mjs` + 原生启动器。
- 影响：`pnpm install --frozen-lockfile` 等全部契约命令无法运行；`npm i -g pnpm@12.3.4` 因 `EEXIST: /opt/homebrew/bin/pnpm` 失败。
- 建议/实际路由：不改动全局 corepack（避免影响用户其他仓库），以 `npm i -g --prefix "$HOME/.local" pnpm@12.3.4` 安装并用 `PATH="$HOME/.local/bin:$PATH"` 运行；`doctor` 探测并报告 pnpm 的实际路径与版本，不匹配即 `executionReady=false`。已在 `implementation.md` §4 记录。
- 关联：WP-00 退出条件"依赖安装"；`apps/cli/src/doctor.ts:probePnpm`。

## DC-02 technical_correction：TypeScript 7 不提供 JS 编译器 API，typescript-eslint 拒绝加载

- 证据：`pnpm lint` 曾以 `Error: typescript-eslint does not support TS 7.0.` 退出 2；`node_modules/typescript@7.0.2/lib` 只有 `tsc.js`/`getExePath.js`/`version.cjs`（原生移植，无 `typescript.js`）；`typescript-eslint@8.70.0` 的 peer 范围为 `>=4.8.4 <6.1.0`。
- 影响：文档钉定的 `typescript@7.0.2` 与 `typescript-eslint@8.70.0` 不能直接共存，`pnpm lint` 无法通过（契约要求退出 0 且保持类型感知）。
- 建议/实际路由：保留钉定的 `typescript@7.0.2` 供 `typecheck`/`build`（实测仍为该版本）；仅新增 devDependency `typescript-lint`（`npm:typescript@6.0.3`，落在 lint 支持范围内），由 `scripts/lint.mjs` + `scripts/typescript-6-preload.cjs` 在该进程内把 `typescript` 及其子路径解析到 TS 6。预载是承重的：移除后 lint 立即以 TS 7 守卫错误退出；devDependencies 因此存在两份 TypeScript，属已知偏差。
- 影响面：仅 lint 进程；不改产品契约、不改钉定版本、不影响构建产物。
- 关联：`implementation.md` §4.1；plan.md §6 风险项。

## DC-03 technical_correction：pnpm 12 把"被忽略的构建脚本"当致命错误

- 证据：`pnpm install` 报 `ERR_PNPM_IGNORED_BUILDS: @google/genai@1.52.0, esbuild@0.28.1, protobufjs@7.6.6`；pnpm 自动在 `pnpm-workspace.yaml` 写入占位 `allowBuilds`。
- 影响：依赖安装不通过，`--frozen-lockfile` 无法保持一致。
- 建议/实际路由：显式声明 `allowBuilds: {'@google/genai': false, esbuild: false, protobufjs: false}`（供应链最小化；已确认 `@esbuild/darwin-arm64` 预编译二进制可用，`esbuild --version` 返回 0.28.1）。`pnpm install --frozen-lockfile` 退出 0。
- 关联：WP-00 "固定依赖"。

## DC-04 defect：压缩失败测试同义反复（Review D1 / Test F1）

- 证据：`packages/pi-runtime/test/session.integration.test.ts` 原先将 `compact()` 结果映射为 `'resolved' | 'rejected'` 后断言 `toContain` 于同一集合，恒真；独立复现显示空会话 `compact()` 实际 reject（`Nothing to compact (session too small)`）。
- 影响：违反 WP-00 "必需失败测试：…SDK 创建/取消/压缩"，压缩行为回归不会被发现。
- 建议/实际路由：改为 `await expect(session.compact()).rejects.toThrow(/compact/i)`，并修正与事实不符的注释；Test 复测时通过"人为破坏必失败"验证其有效性。
- 关联：Review D1（blocker）、Test F1（blocking）。

## DC-05 defect：doctor 仅凭镜像标签判定环境就绪（Review D2）

- 证据：评审用 `docker import` 生成 root、无 node 的镜像并打上 `agentdev/exec:*` 标签，`doctor` 仍给出 `executionReady=true, blockers=[]`；同时评审期间真实镜像 imageId 变化未被察觉。
- 影响：AC-048 "缺环境拒绝" 可被伪造镜像绕过，属安全边界相关的假通过。
- 建议/实际路由：新增 `probeImageCapability()`，`probeDocker()` 在 inspect 之外实际运行镜像并校验 Node 版本行（`v24.`）与非 root uid（10001），任一不符即 `status=mismatch`；新增测试用 `docker import` 造假镜像断言拒绝，真实镜像仍通过。
- 关联：Review D2（major）；AC-048。

## DC-06 defect：`docker/run-agentdev.sh` 缺少执行位（Test F4）

- 证据：`git ls-files -s` 显示 `100644`（同目录 `build-image.sh` 为 `100755`），按脚本自身文档直接执行退出 126。
- 影响：文档化的入口不可直接用；只读挂载/加固参数的可复现性受影响。
- 建议/实际路由：`chmod +x` 并重新暂存，现为 `100755`；同时补充注释说明只读源挂载策略属 WP-07（`execution.md` §3）。
- 关联：Test F4（blocking）、Review D11（minor）。

## DC-07 defect：扩展门禁在真实启动路径不可达（Review D5 / Test F2）

- 证据：`apps/runner/src/attempt.ts` 原先无 manifest/requested 入参，`BUILTIN_EXTENSIONS` 为空，CLI 无 `--extension`（`Unknown option` 退出 2），`startupBlocked`/未知 ID 分支只能由单测触达。
- 影响：AC-067 "Critical 阻断、未知 ID 拒绝" 缺少真实启动路径证据。
- 建议/实际路由：`AttemptRunner` 增加 `extensionManifest`/`extensionRequests`/`activateExtension` 注入口，`start()` 内捕获扩展激活异常（未知 ID → `UNKNOWN_EXTENSION`，Critical 失败 → `CRITICAL_EXTENSION_FAILED` 且不创建会话）；runner CLI 增加 `--extension <id>`；新增 runner 集成测试覆盖阻断与拒绝，并断言会话构建未被调用。
- 关联：Review D5（major）、Test F2。

## DC-08 defect：源码注释中的文档引文与文档不符（Review D6）

- 证据：`apps/runner/src/attempt.ts` 头部曾以 `execution.md §2` 引述一段文档中不存在的句子（`grep` 无命中）。
- 影响：契约可追溯性受损，误导后续实现者。
- 建议/实际路由：改为可逐字核对的 `ARCHITECTURE.md` §2/§3、`reliability.md` §2、`execution.md` §7 表述。
- 关联：Review D6（minor）。

## DC-09 defect：错误码可重试性与协议 §7 不一致（Review D7）

- 证据：`protocol.md` §7 规定"仅BUSY和已知无副作用的Provider瞬时错误retryable=true"，原静态表将 `PROVIDER_UNAVAILABLE` 无条件标为 `retryable: true`。
- 影响：调用方可能在非瞬时或已有副作用的 Provider 故障上盲目重试。
- 建议/实际路由：静态表 `PROVIDER_UNAVAILABLE.retryable = false`，新增 `CONDITIONAL_RETRYABLE_CODES` 与 `isRetryable(code, {providerTransient})`；只有调用方显式声明无副作用瞬时错误时才返回 true。测试同步更新。
- 关联：Review D7（minor）；AC 相关协议契约。

## DC-10 defect：常量来源重复与出处缺失（Review D8/D12）

- 证据：`maxArrayItems` 在 `primitives.ts`（`MAX_ARRAY_ITEMS`）与 `limits.ts` 各写一次 1000；`providerRetries`/`shellTimeoutSec` 的 fixed/min/max 缺少文档出处注释。
- 影响：常量漂移风险，审查者无法从代码回溯依据。
- 建议/实际路由：`limits.ts` 复用 `MAX_ARRAY_ITEMS`；为 `providerRetries`（ARCHITECTURE.md §5 "2｜两次重试，退避2s/8s"）与 `shellTimeoutSec`（"120｜单操作可授权到1800"）补出处注释。
- 关联：Review D8/D12（minor）。

## DC-11 defect：Runner 事件序号测试空转（Review D9）

- 证据：原测试只发 `attempt.shutdown`，事件数为 0，`seq` 单调性断言在空集合上成立。
- 影响：事件序号/帧封装回归不会被发现。
- 建议/实际路由：新增 `buildSession` 测试缝，注入脚本化会话真实发出 3 个事件后断言 `seq=[0,1,2]` 及事件内容；同时验证订阅在 dispose 时释放。
- 关联：Review D9（minor）。

## DC-12 defect：未激活工具被静默丢弃（Test F6）

- 证据：`--tools read,search` 时 `search` 既不存在于 active 列表也无任何诊断输出。
- 影响：配置错误不可见，与"缺配置明确阻断/如实报告"的取向不符。
- 建议/实际路由：`attempt.ready` 新增 `droppedTools` 字段（IPC schema + 测试），请求但未激活的工具显式上报。
- 关联：Test F6（P3）。

## DC-13 defect：选择类测试单例化、无法区分"按选择加载"与"自动发现"（Test F7）

- 证据：原 Skill 测试磁盘上只有一个 Skill。
- 影响：即使实现退化为目录发现，测试仍会通过。
- 建议/实际路由：测试改为磁盘放两个 Skill、只选其一，并断言另一个不可用。
- 关联：Test F7（P3）。

## DC-17 defect：复审 N1/N2/N5 与 D8 残余

- 证据（复审 R 章节）：N1 `CONDITIONAL_RETRYABLE_CODES` 无引用且静态 `retryable` 与 `isRetryable()` 可能不一致；N2 镜像探针失败信息不区分"无法运行探针"与"版本/用户不符"；N5 探针验证的是能力而非加固；D8 残余为 `shellTimeoutSec.min=1` 属实现选择、以及"文档给出单一数值"的条目一律标 `fixed` 缺少说明。
- 影响：均为可读性/一致性层面的次要问题，不影响行为正确性。
- 建议/实际路由：
  - N1：`isRetryable()` 改为由 `CONDITIONAL_RETRYABLE_CODES` 驱动，并新增一致性测试（对每个错误码断言 `isRetryable(code) === ERROR_SPECS[code].retryable`）与条件码测试，消除两个入口分叉。
  - N2：探针 catch 分支优先使用子进程 stderr 首行，明确区分"镜像根本起不来"与"版本/用户不符"。
  - N5：`probeImageCapability` 文档注明它只验证能力，加固由 `container.integration.test.ts` 按 Supervisor 参数证明；两者职责分离并写入 `implementation.md`。
  - D8：`limits.ts` 注释改为与 `ARCHITECTURE.md` §5 原文一致，说明 `shellTimeoutSec.min=1` 是实现选择；`LimitBounds.fixed` 增加语义说明（§5 以单写者为例，非穷举；文档给出单一数值的条目 min=max，任何覆盖都无效故标 fixed）。
- 关联：复审 N1/N2/N5、D8（残余登记，不阻塞 RE-REVIEW PASS）。

## DC-14 followup：流式与带历史恢复需真实模型，移交 WP-10 复验（Test F3 / Review D3/D4）

- 证据：离线观察到 SDK 仅在记录真实轮次后才落盘会话文件，`SessionManager.open` 对空文件会新建 sessionId；无凭证时 `prompt()` 立即以 "No API key found" 失败。
- 影响：AC-066 的"流式"端到端与"恢复历史"在 WP-00 无法真实验证。
- 实际路由：WP-00 覆盖映射层（`events.test.ts` 全分支）与恢复路径接线（测试改名并写明不声称恢复历史）；端到端流式与带历史恢复按工作包约定在 WP-10 用真实 Provider 复验。`pnpm test:live` 当前按契约返回 NOT_IMPLEMENTED。
- 关联：AC-066 发布回归；`implementation.md` §5。

## DC-15 followup：镜像构建可复现性与 Attempt 级 digest 冻结（Test F5）

- 证据：同一 Dockerfile 的多次构建产生不同 imageId（`8fc05469…`、`ffb122b2…`、`bab7…` 等）。
- 影响：`execution.md` §1 "每次Attempt冻结digest" 目前只有 doctor 报告当前 digest，尚无 Attempt 级冻结机制。
- 实际路由：属 WP-07（容器/宿主模式、Grant 与隔离）与 WP-08（结算与 Manifest）范围；WP-00 只提供镜像定义、构建脚本与 digest 探测。已在 `implementation.md` §5 记为未覆盖项。
- 关联：Test F5（P3）。

## DC-16 technical_correction：doctor 创建全局数据目录

- 证据：本机不存在 `~/.agentdev`，首次 `doctor` 报 `directory not writable`（ENOENT）并拒绝就绪；`ARCHITECTURE.md` §… 规定全局配置位于 `~/.agentdev/config.toml`。
- 影响：装配前检查在全新机器上总是失败，用户无法据此判断真实问题。
- 建议/实际路由：`probeDirectory(path, {create:true})` 用于全局数据目录（产品自有的首次运行目录），工作区目录只验证不创建；测试覆盖"目录确实无法创建"的负例（用同名普通文件阻断）。
- 关联：`implementation.md` §4.3；AC-048。
