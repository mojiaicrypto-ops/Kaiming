# WP-07 实现记录（权限、工具和测试环境）

- planVersion: 1（`.agentdev/work/WP-07/plan.md`）
- 依赖：WP-00（工具链/镜像/doctor，`79d5895`）、WP-02（`f9b61e0`）；基线 WP-06 结算 `91581cb`（代码树 `b0d226f`）
- 实现位置：`packages/core/src/{grants,secrets,broker,test-environment}.ts`、`packages/domain/src/permission.ts`、`packages/pi-runtime/src/extensions.ts`

## T1 Grant 生命周期与 `once` 事务（AC-049/AC-080）

- `domain/permission.ts`（扩展既有规则，保留原导出与行为）：`evaluateGrant` 只做准入判定（重放先于过期检查：已完成的 `once` 事务在过期后仍可重放且要求同一 `runId` 与已记录的 `consumedByOperationId`）；新增 `grantDenialCode`/`grantDenialField`/`revocationTime`/`validateGrantIssueRequest`/`targetWithinWorkScope`/`operationWithinWorkScope` 与 `GrantWorkScope`/`GrantIssueRequest` 类型。
- `core/grants.ts`：`GrantStore`（`issue`/`currentRunGrants`/`currentWorkGrants`/`grantHistory`/`grantForToolOperation`/`findGrantFor`/`checkCoverage`/`consumeOnce`/`revoke`）、`InMemoryDeferredResultStore`、`GRANT_EVENTS`。
  - 签发在同一事务内校验 Work（存在且 `running`）、引用的 Decision、Run 归属的 Work、角色确实在派发、目标/操作在 Work 范围内；拒绝时零写入（`VALIDATION_ERROR`/`INVALID_STATE`/`NOT_AUTHORIZED`/`MISSING_CONTEXT`）。
  - `once` 绑定 `operation + (runId, toolOperationId, inputHash)`：首次消费执行一次并把结果写入 tool_operation 的 `resultRef`；同输入重试**返回原结果且不重放执行**（执行计数与单行断言）；不同 inputHash 或不同 toolOperation ⇒ `IDEMPOTENCY_CONFLICT` 且零消费；已完成事务在过期后仍重放。
  - 兄弟隔离：`run` 作用域或被消费的 `once` Grant 对同 Work 同角色的另一 Run 一律拒绝（零副作用），`work`/`project` 作用域两 Run 均可使用。
  - 原子性：`UPDATE ... WHERE consumed_at IS NULL` 的行数即原子认领；单进程并发双消费（第二条连接经 `worker_threads` 在同一 SQLite 文件上握手，落点在本进程事务持写锁期间）只有一次执行。**跨进程**并发的执行唯一性由同一守卫 UPDATE 保证；失败方能否重放原结果取决于结果存储——T3 起默认接持久 blob 结果存储（见 T7/W7R1-10），因此另一进程可重放；若调用方显式注入进程内 sink，则失败方按契约报 `RECOVERY_REQUIRED`（`grants.test.ts` 两条用例分别证明）。
  - 撤权：把 `expiresAt` 置为纪元并写 `consumedAt`（不写 `consumedByOperationId`），因此后续使用拒绝而已完成事务仍可重放。
- 回归网：`packages/core/test/grants.test.ts`（31 例）、`packages/domain/test/permission-delivery.test.ts`（20 例）。

## T2 SecretStore 与泄漏防护（AC-051）

- `core/secrets.ts`：内存 `SecretStore`（值存于 ECMAScript `#private` 字段）+ `redact`/`redactValue`/`scanForLeaks`/`hasLeaks`/`containsSecret`/`secretEnvName`/`gatewaySecretResolver`。
  - `resolve(ref, context)` **先跑 Grant 校验**（`secret` 操作 + 精确 ref + 角色/阶段/Run/使用时刻）再查注册项，因此未授权者得到 `NOT_AUTHORIZED`（不存在性不可探测），已授权者未知 ref 得 `NOT_FOUND`；过期/撤权 ⇒ `AUTH_EXPIRED`。
  - `environmentFor(context, refs)` 只注入**被请求且已授权**的 secret；任一被拒则整体拒绝（不产生部分/未授权凭证）。
  - 查询面（`has`/`refs`/`list`、`JSON.stringify(store)`）永不返回值；`maskAll`/`scanAll` 供审计路径遮蔽/检测。
  - 脱敏覆盖嵌套对象/数组/键名/Map/Set/Date/`Error`（含 name/message/stack/cause），最长值优先替换，输入不被修改；`scanForLeaks` 只报告路径 + `secretIndex` + 遮蔽预览，绝不返回值。
- 回归网：`secrets.test.ts`（27 例）、`secrets.integration.test.ts`（5 例，真实 SQLite + GrantStore + 真实 node 子进程）。

## T3 Broker、文件/网络边界与测试环境（AC-048/AC-050）

- `core/broker.ts`：`Broker.invoke` 顺序为「规范化输入 Hash → 形状校验 → 角色写入门禁 → 文件目标 realpath 校验（允许根 + 保护路径）→ 网络策略 → 执行模式检查 → 交给 `GrantStore.consumeOnce`」；准入调用写 `tool_operation` 行 + `tool.invoked` 事件，任何拒绝在副作用前写 `tool.refused` 并返回契约错误码；无内置执行器的工具体抛 `INVALID_STATE` 使事务回滚（不伪造结果）。
  - 模式：`container` 使用 WP-00 执行镜像，失败**绝不回退 host**（Docker 探测失败 ⇒ `PROVIDER_UNAVAILABLE` 并原样给出原因）；`planContainerRun` 产出 `--read-only`、`--tmpfs`、`--cap-drop=ALL`、no-new-privileges、`--pids-limit 256`、`--memory 2g`、`--cpus 2`、`--user 10001:10001`、根挂载 `:ro`，默认 `--network none`。
  - 文件边界：解析含不存在的末段路径的符号链接祖先，符号链接/`..`/绝对逃逸在准入前拒绝并在读写时复查；`protectedPaths` 让 Review Run 在两种模式下都读不到运行库。
  - 网络：`NetworkPolicy` 拒绝 loopback/私网/link-local/CGNAT/元数据地址（除非精确授权 host 或 host:port）；`GuardedRequester` 用 `redirect:'manual'` 对每一跳校验后再取，302 到 `169.254.169.254` 在第 2 跳被拒且不跟随。
- `core/test-environment.ts`：`TestEnvironmentManager` 从专用端口段分配端口（跳过保留的 dev 端口与自身在用端口），在新建临时目录里放 `test.sqlite`，以独立进程组启动命令并等待端口就绪，用 `AGENTDEV_TEST_DB`/`AGENTDEV_TEST_PORT` 在该环境内运行命令；清理任一步失败都上报 `RECOVERY_REQUIRED` 并给出具体失败项（同时继续尝试其余步骤）。
- 回归网：`broker.test.ts`（32 例）、`broker.integration.test.ts`（8 例，含真实 Docker 只读读取与非 root 账户）。

## T4 信任与 Skill/扩展加载边界（AC-053）

- `pi-runtime/extensions.ts` 新增 `loadTrustedExtensions`（既有 `activateExtensions`/内置白名单语义不变）：
  - **未信任**项目在该路径上严格只读：不 import 任何仓库模块、不读 Skill、不采纳仓库配置（无 fs 访问），每个候选/配置/Skill 都记为 `skipped` + `NOT_AUTHORIZED` + 精确原因（`untrusted-project: …`），`readOnly: true`。
  - **已信任**后：仓库扩展必须**同时**被显式选择且在发布白名单内才可加载；否则 `NOT_AUTHORIZED`（not-selected）或 `VALIDATION_ERROR`（not-in-builtin-whitelist）；路径逃逸（含经 realpath 的符号链接）⇒ `VALIDATION_ERROR`（path-escape）；仓库配置永远记为 skipped（配置永不权威）；只有被显式选择的 Skill 在信任后被读取，且必须解析在项目/agent 根内。
  - 每次判定进入有序 `trace`（seq/kind/id/origin/decision/path/code/reason），每个拒绝都带契约 `ErrorCode`；import/读取失败不吞，转为带原因的拒绝。
- 回归网：`pi-runtime/test/trust.test.ts`（14 例，真实临时仓库；fixture 模块 import 时会写 `pwned.marker`，用文件系统证明「是否被 import」）。

## T5 集成与必需失败测试

- `packages/core/test/permissions.integration.test.ts`（11 例，integration 项目）：AC-049/080（范围内执行并审计；越界/过期/兄弟 Run 拒绝且零执行零写入；`once` 重放与不同 inputHash 的 `IDEMPOTENCY_CONFLICT` 且有真实落盘副作用）、AC-048/050（review/test Run 在 host 与 container 两种模式下读冻结输入、拒绝源码/DB 读取；验证者报告写入只在声明的报告根内放行、源码仍只读；运行库默认受结构保护）、AC-051（诱饵经真实 node 子进程到达已授权子进程；未授权兄弟拿不到；Artifact 行/事件流/grant 行/UI payload/store JSON/host 环境/仓库均无泄漏）、AC-053（未信任仓库自动加载模块不写 marker；信任后只加载被选且白名单内的资源）。
- `packages/core/test/permissions-failures.test.ts`（4 例）：**符号链接/私网/重定向**、**Secret 泄漏**、**进程清理失败**、**无 Docker 拒绝**，标题逐字命名。
- 回归敏感性（可核验，替代早前「三处临时改动…」的不可核验表述；本轮实际执行的突变-还原实验）：
  1. 把 `GuardedRequester` 每跳的 `policy.decide(...)` 换回同步 `policy.checkUrl(...)`（移除 DNS 解析）⇒ `broker.test.ts › refuses a hostname that DNS resolves into loopback, with no transport call (W7R1-01)` **失败**（1 failed | 5 passed）。
  2. 从 `evaluateGrant` 的 replay 分支删除 `role`/`stage`/`operation` 比较（恢复旧行为）⇒ `permission-delivery.test.ts › binds a replay to the full operation/role/stage triple, not just the run (W7R1-06)` **失败**（1 failed | 50 passed）。
  3. 同时移除只读角色门禁与「只读角色写入仅限 writeRoots」的约束（恢复 `review` 可写任意 roots 的旧行为）⇒ `broker.test.ts › allows a Review report write root while refusing source (W7R1-13)` **失败**（1 failed | 5 passed）。
  三次突变均已还原，源码与上表一致。

## T6 验证与本轮状态

- 契约命令（本记录时点）：`pnpm typecheck` 0；`pnpm lint` 0；`pnpm test:unit` **44 文件 / 872 用例**；`pnpm test:integration` **14 文件 / 152 用例**（含真实 Docker）；`pnpm build` **10 workspace**；`pnpm docs:check` ok。
- 该时点数字现已被 T7 取代（T7 修复后为 44/885 与 14/156）；T6 保留为修复前的历史记录。
- 已登记残余（供 Review/Test 判定，均为承接而非静默）：
  1. `grant.revokedAt` 不是契约列，撤权复用 `consumedAt` + 纪元 `expiresAt`（`consumedByOperationId` 保持未设以区分已完成）；新增真列需 contracts/schema/migration 与 `data.md` 更新（本包外）。
  2. `consumeOnce` 在事务内执行工具（失败回滚、零残留），但长任务会持写锁；如需「提交后执行」变体，`prepared`/`finished` 行形状已支持。
  3. 网络工具传输是异步而 `consumeOnce` 执行器同步：Broker 对无 `run()` 体的 `network` 操作拒绝（`INVALID_STATE`，事务回滚），真实传输经 `GuardedRequester` 暴露；跨 HTTP 调用的同步 `once` 原子消费需要 T1 侧尚未暴露的 Grant API 接缝。
  4. ~~容器内文件写使用 here-doc，内容含分隔符行需转义~~ **已在 T7/W7R1-09 修复**：容器写改为 base64 经 stdin 送入（无分隔符可伪造），残余关闭。
  5. Secret 注入到工具子进程环境由 T2 的 SecretStore 提供，但**尚未接线进 Broker**；Broker 构造上不读/不记录/不持久化 secret（审计行只含 operation/inputHash/targets/grant 引用）。
  6. `gatewaySecretResolver` 是 WP-09 把某个 Run 的授权上下文绑到 Gateway 单参 `SecretResolver` 的适配点，接线属 WP-09。
  7. 持久化 Secret 后端（Keychain / 0600 加密文件 + 备份导出）属安装/部署范围；`SecretStore.put` 是注册接缝。
  8. `loadTrustedExtensions` **尚未接入 session 创建**（`apps/runner` 仍直接调 `activateExtensions`），接线属 WP-08/runner；`PiRuntimeErrorCode` 无 `NOT_AUTHORIZED`/`VALIDATION_ERROR`，当前以显式结果对象携带契约码，如经协议暴露需在调用点映射或扩展该枚举。
  9. 仓库扩展**发现**（解析 `.pi/extensions.json` 等）有意未实现：调用方传入只读观察到的候选，两种信任状态下都不采纳配置；未信任项目在该路径上从不扫描。
  10. 发布的可选扩展白名单仍为空（`execution.md` §7 未变），生产上仓库扩展无法满足「内置列表」，正向路径经 `manifest` 接缝（测试提供白名单项）验证。

## T7 Review 第 1 轮修复（W7R1-01..13）

冻结点/审查报告：`45cd1b3`（blob `170200bc…`）上的 `.agentdev/work/WP-07/review.md`。本轮只改本包归属文件；每条修复都配一条**在旧行为下会失败**的回归用例，并已用「突变-还原」验证（见 T5 末节）。

### W7R1-01（P1）网络边界不解析 DNS

- **改了什么**：`packages/core/src/broker.ts` 引入可注入 DNS 端口 `HostResolver`（默认 `defaultHostResolver` = `dns.lookup(..., {all:true})`）与 `resolvesToPrivateAddress`；`NetworkPolicy` 新增 `decide({url|host,port})` 异步判定，`GuardedRequester` 每一跳（含重定向后的新 URL）都改走它；**任一**解析结果落在 loopback/私网/link-local/CGNAT/metadata 即拒绝，解析失败/不可分类也拒绝（不再把「无法分类」当公网）。`BrokerOptions.resolver` 透传，`NetworkPolicy` 的同步 `checkUrl`/`checkTarget` 保留（`Broker.invoke` 仍是同步入口，同步面按构造性内网名 + 精确授权判定，真实传输一律走异步面）。
- **回归测试**：`packages/core/test/broker.test.ts › refuses a hostname that DNS resolves into loopback, with no transport call (W7R1-01)`——桩解析器 `localtest.example → 127.0.0.1/::1`、`public.example → 93.184.216.34`（离线、无外部网络）。断言：首次请求被拒且 **fetcher 从未被调用**；`public.example` 302 到 `localtest.example` 时只 fetch 了首跳，第二跳 `allowed:false` 且 `blockedUrl` 指向该名。旧行为下该用例失败（旧 `checkUrl` 对 hostname 放行）。
- **记录修正**：`T3` 的「网络：…拒绝 loopback/私网…」补上「每跳先解析、任一结果内网即拒」，模块 docstring 同步。

### W7R1-02（P1）IPv4-mapped IPv6 十六进制形式绕过

- **改了什么**：`isPrivateIpv6` 不再用字符串前缀，改为 `ipv6Bytes()` 展开 16 字节后按数值区间判定（`fe80::/10`、`fc00::/7`、`ff00::/8`、`2001:db8::/32`、`::`/`::1`），并把 `::ffff:0:0/96` 映射形式与 `64:ff9b::/96` NAT64 解出低 32 位后套用**完整 IPv4 规则**；`isPrivateIpv4` 补齐 `0.0.0.0/8`、`169.254/16`、`100.64/10`、`192.0.0/24`、`198.18/15`、`198.51.100/24`、`203.0.113/24`、`224/4` 与 `240/4`。嵌入点分四段（`::ffff:127.0.0.1`）同样解析。
- **回归测试**：`broker.test.ts › classifies the hexadecimal IPv4-mapped IPv6 forms the URL parser produces (W7R1-02)`——断言 `new URL('http://[::ffff:127.0.0.1]/').hostname === '[::ffff:7f00:1]'`，并对 `::ffff:7f00:1`、`::ffff:a00:5`、`::ffff:a9fe:a9fe`、`::ffff:c0a8:101`、`::ffff:6440:1`、`::ffff:0:0`、`64:ff9b::7f00:1` 及点分形式判内网，`::ffff:8.8.8.8`/`::ffff:808:808` 判公网。旧行为下十六进制形式判为公网 ⇒ 失败。

### W7R1-03（P1）选中目录的 SKILL.md 符号链接逃逸

- **改了什么**：`packages/pi-runtime/src/extensions.ts` 的 `resolveSkillDocument(path, allowedRoots)` 在拼接 `SKILL.md` 之后同样 `realpath` + `isInside(canonicalSkillRoots)` 复检，未通过返回 `undefined`，因此调用方记 `refused`/`VALIDATION_ERROR`（`skill-unreadable`）且**零读取**；目录选择与文件选择走同一条安全路径。
- **回归测试**：`packages/pi-runtime/test/trust.test.ts › refuses a symlinked SKILL.md inside a selected directory (W7R1-03)`——仓库内 `skills/linked-skill/SKILL.md` 符号链接到仓库外文档；断言 `readSkillFile` 零调用、`loadedSkills` 为空、trace 为 `refused`/`VALIDATION_ERROR`，且整条 trace 不含外部技能名。旧行为下会真实读取并记 `loaded` ⇒ 失败。

### W7R1-04（P2）运行库默认不受结构保护

- **改了什么**：`Broker` 构造时用 `deriveProtectedPaths(store, dataDir, extra)` 派生保护根：**配置数据目录**（`BrokerOptions.dataDir ?? store.dataDir`，含 `project.sqlite`、`blobs/`、迁移备份）与 store 文件本身，再并入调用方传入的 `protectedPaths`（只能收紧，不能放宽）。拒绝优先报「inside protected root」，因此不依赖调用方是否记得传参。新增只读属性 `protectedRoots` 便于审计。
- **回归测试**：`broker.test.ts › protects the run database without any caller-declared protected path (W7R1-04)`（不传 `protectedPaths`，断言派生根包含数据目录与 `project.sqlite`，`resolveWithinRoots` 报 `protected root`）与 `packages/core/test/permissions.integration.test.ts › refuses the run database to a verifier without any caller-declared protected path (W7R1-04)`（真实 `ProjectStore` 文件 + 真实 Grant，端到端 `NOT_AUTHORIZED` 且零 `tool_operation` 行）。旧行为下 `protectedPaths` 为空 ⇒ 读取成功 ⇒ 失败。

### W7R1-05（P2）端口分配不探测 OS、就绪不校验归属

- **改了什么**：`packages/core/src/test-environment.ts` 的端口端口新增 `portAvailable(port): Promise<boolean>`（默认实现 `portBindable`：绑定成功后立刻释放；占用由 `error` 事件异步上报，因此必须 await，早前的同步 `listen()` try/catch 永远返回 true）。`allocatePort` 变为异步，逐个跳过保留 dev 端口、本 manager 已用端口、**进程级 `claimedPorts` 注册表**中其他 manager 已认领的端口，并对 OS 探测；`create` 相应变为 `async create(...): Promise<CreateOutcome>`。`waitForPort` 先查子进程是否已退出，端口可连后仍在 settle 窗口复查明子进程存活，死亡即报 `INVALID_STATE`（`… exited with code … before it owned host:port …`），绝不报 running；`cleanup` 释放进程级认领。
- **回归测试**：单元 `broker.test.ts › skips a port the OS has already taken and one a sibling manager holds (W7R1-05)`（真实 `net` 监听器占用端口 + 两个 manager 不同端口）；`broker.test.ts › reports a child that dies before readiness as failed, never running (W7R1-05)`；集成 `broker.integration.test.ts › never hands the same port to a second manager, and skips an occupied one (W7R1-05)`（真实子进程各听各的端口 + 真实占用端口被跳过）。旧行为下占用端口被直接发出、manager 间复用 ⇒ 用例失败。

### W7R1-06（P2）replay 分支与覆盖查询忽略 operation/role/stage

- **改了什么**：`packages/domain/src/permission.ts` 的 `evaluateGrant` replay 分支补齐 `role`/`stage`/`operation` 全绑定比较（run/toolOperation/inputHash 原有）；`packages/core/src/grants.ts` 的 `matchingGrants` 在 `evaluateGrant` 之前先按 `operation`/`role`/`stage` 过滤，因此 `findGrantFor`/`checkCoverage`/`Broker.networkCovered` 的预判不再被已消费的异绑定 Grant 污染。
- **回归测试**：`packages/domain/test/permission-delivery.test.ts › binds a replay to the full operation/role/stage triple, not just the run (W7R1-06)`（三种错绑定均不再 `replay:true`，精确绑定仍重放）与 `packages/core/test/grants.test.ts › does not let a consumed once grant cover a different operation/role/stage (W7R1-06)`（同绑定 `checkCoverage` 为 true，异 operation/role 为 false 且 `findGrantFor` 为 `undefined`）。旧行为下后者全为 true ⇒ 失败。

### W7R1-07（P2）网络策略接受明文 http

- **改了什么**：`NetworkPolicy` 新增 `allowInsecureHttp`（默认 false）与 `checkScheme`：https 放行；其它 scheme 精确拒绝；**http 仅在「该精确目标已被显式授权」且「调用方显式开启明文」时放行**。判定顺序为先地址后 scheme，因此内网目标仍报内网原因。`BrokerOptions.allowInsecureHttp` 透传。
- **回归测试**：`broker.test.ts › refuses an authorized private literal over plain http unless plaintext was enabled (W7R1-07)`（`https://public.example` 放行、`http://public.example` 拒绝且 reason 含 `https is required`；`127.0.0.1:8080` 上 https 放行、http 拒绝、显式 opt-in 后 http 放行）。旧行为下 `http://example.com/` 直接放行 ⇒ 失败。集成套件的本地 loopback 明文测试端点显式设置 `allowInsecureHttp: true`。

### W7R1-08（P3）根内硬链接可读根外内容（已知限制，文档化）

- **改了什么**：`resolveWithinRoots` 的文档注释明确这是**路径包含性**规则而非 inode 规则：根内硬链接指向的 inode 可能同时被根外链接，「任何基于路径的检查都无法识别」；创建该链接本身已需要根内写权；`execution.md` §3 只承诺拒绝相对路径/符号链接/嵌套仓库逃逸，**没有 AC 覆盖硬链接**，因此这里记录边界而**不声称已阻断**。
- **记录**：本 T7 条目即该限制的登记；未新增用例（用例只会固化「未阻断」，不构成承诺）。

### W7R1-09（P3）容器 here-doc 分隔符可逃逸为容器内命令

- **改了什么**：`Broker.containerWrite` 改为 `base64 -d > <shell-quoted target>`，内容以 base64 经**子进程 stdin** 送入（`ProcessRunOptions.stdin` → `spawnSync({input})`）；命令里不再出现内容，分隔符无法伪造。
- **回归测试**：`broker.test.ts › passes container content over stdin, so a delimiter line cannot become a command (W7R1-09)`——payload 含单独一行 `AGENTDEV_EOF` 与后续 `echo should-not-run`；断言命令串既不含 `AGENTDEV_EOF` 也不含 `should-not-run`、含 `base64 -d >`，且 stdin 等于 payload 的 base64。旧行为下命令串含 `AGENTDEV_EOF` ⇒ 失败。

### W7R1-10（P3）跨进程并发只有「执行一次」成立

- **改了什么**：`packages/core/src/grants.ts` 新增 `ProjectStoreDeferredResultStore`（结果写 `ProjectStore.blobs`，`resultRef` 仍是 UUIDv7 以满足契约，UUID → blob `relativePath` 存在 `deferred-results/index.json` 清单，经临时文件 + 原子 rename 更新），并**把它设为 `GrantStore` 的默认结果存储**；`InMemoryDeferredResultStore` 保留为显式选择（用于单进程或证明缺失结果路径）。因此第二个进程重放同一 tool operation 时能解析到持久结果，而不是 `RECOVERY_REQUIRED`。
- **回归测试**：单元 `packages/core/test/grants.test.ts › replays the recorded result from a second store, rather than RECOVERY_REQUIRED`（独立打开的 `GrantStore` 解析同一结果，且断言结果 blob 与清单存在）与 `… › reports RECOVERY_REQUIRED only for a sink that cannot resolve the reference`（显式注入全新进程内 sink 时仍如实报 recovery）；集成 `broker.integration.test.ts › replays a once result in a separate OS process through the durable store (W7R1-10)`——真实 `node` 子进程打开同一数据目录，`outcome: "replayed"`、`executed: 0`、结果等于首进程记录值。旧行为下子进程抛 `RECOVERY_REQUIRED` ⇒ 失败。
- **记录修正**：T1 并发条目改写为「单进程第二条连接握手落在同一事务」并把「跨进程重放」明确为依赖持久结果存储（现已接线）。

### W7R1-11（P3）实现记录不一致

- **改了什么**：修正 `implementation.md`：`secrets.test.ts` 27 例（原写 26）；T1 并发描述（见上）；`grants.ts` 中 `prepared` 行注释改为「事务**提交**该 `prepared` 行（正常返回不是回滚）」，与 `claimed.changes !== 1` 分支的实际语义一致；T5「三处临时改动」不可核验声明删除，替换为**本轮实际执行的突变-还原实验**（3 条，含失败用例名与计数，见 T5 末节）。测试计数同步更新：`grants.test.ts` 31、`broker.test.ts` 32、`broker.integration.test.ts` 8、`permissions.integration.test.ts` 11、`permission-delivery.test.ts` 20、`trust.test.ts` 14。
- **回归测试**：无（记录类修复）；可核验性由 T5 突变实验与本 T7 的计数提供。

### W7R1-12（P3）未选中内置扩展被记为 refused + INTERNAL_ERROR

- **改了什么**：`extensions.ts` 中内置扩展的 trace 判定改为：未选中/默认关闭 ⇒ `skipped` 且 `code: undefined`、原因 `not-selected: disabled`；`apiVersion` 不匹配仍是 `refused`/`VALIDATION_ERROR`；其余激活异常仍是 `refused`/`INTERNAL_ERROR`。
- **回归测试**：`packages/pi-runtime/test/trust.test.ts › still activates the shipped release whitelist, which is not repository content`（新增 `other-builtin`，断言 `skipped` + 无 code + reason 含 `not-selected`，且 `refused` 为空）与集成 `permissions.integration.test.ts › does not execute an untrusted repository auto-load extension…`（原「refused」期望更正为 `skipped`/无 code，属**编码 bug 的旧期望**，已在 T7 说明）。

### W7R1-13（P3）review/test 的写入被一律拒绝

- **改了什么**：`BrokerOptions.writableReportRoots` 声明 `execution.md` §3 划给 Review/Test 的报告与检查临时目录。对 review/test，写操作仅在 `writeRoots` 内放行；`resolveWithinRoots` 在提供 `writeRoots` 时**只**以 `writeRoots` 为可写边界（源码 roots 仍可读但不可写），`contextFor` 的 open 时复查同规则；容器模式把报告根作为额外 `rw` 挂载。未声明 `writableReportRoots` 时保持原 fail-closed 行为。
- **回归测试**：`broker.test.ts › allows a Review report write root while refusing source (W7R1-13)`（报告写入成功且文件落盘；源码写入拒绝且 reason 含 `report/scratch root`、文件不变）与集成 `permissions.integration.test.ts › writes a Review report inside its declared report root and never the source (W7R1-13)`（真实 store；源码与 `dev.sqlite` 均拒绝）。旧行为下报告写入被拒、而门禁一旦放开源码也可写 ⇒ 用例失败。

### T7 验证数字（本轮，全部命令真实执行）

| 命令 | 结果 |
|---|---|
| `pnpm typecheck` | 通过（`tsc -p tsconfig.json --pretty false`，退出 0） |
| `pnpm lint` | 通过（Prettier 全部匹配） |
| `pnpm test:unit` | **44 文件 / 885 用例全部通过**（修复前 872，新增 13） |
| `pnpm test:integration` | **14 文件 / 156 用例全部通过**（修复前 152，新增 4；Docker 用例真实执行） |
| `pnpm build` | 10 workspace 全部 Done |

### T7 新登记残余

1. **硬链接（W7R1-08）在任何路径包含性模型下不可阻断**：已作为已知限制写入 `resolveWithinRoots` 注释与 T7，不声称阻断；无 AC 覆盖。
2. **报告/临时根需要调用方声明**：`writableReportRoots` 未接线时 review/test 写入仍 fail-closed；把「哪一个目录是本 Run 的报告根」接入 Runner 属 WP-08。
3. **`protectedPaths` 的默认保护跟随构造参数**：`deriveProtectedPaths` 用 `BrokerOptions.dataDir ?? store.dataDir`；若调用方把 store 与 dataDir 指向不同位置，保护跟随该参数。调用方不得传入与运行库无关的目录来放宽保护（本包测试不这么做）。
4. **`create` 变为异步**（`Promise<CreateOutcome>`）：OS 端口探测本质异步，同步 API 无法在不骗人的情况下探测占用；非本包调用方（apps）如已接线需相应 `await`（当前仓库内调用点仅为测试）。
5. **明文 http 需双重显式**：`allowInsecureHttp` + 精确目标授权；容器/代理路径默认仍是 https。
6. **跨进程重放的持久化范围**：结果落 `ProjectStore.blobs` 的 `deferred-results/`，随项目状态目录一起备份/GC；`blobs.collectGarbage` 的引用集合目前只读数据库列，尚未把该清单纳入（离线 GC 属运维范围）。

## T8 Review 第 2 轮修复（W7R2-01..10）

冻结点/审查报告：`c7400d7`（tree `744b9828`）上的 `.agentdev/work/WP-07/review.md` 第 2 轮（第 264 行起）。本轮仍只改本包归属文件（`packages/core/src/{grants,secrets,broker,test-environment}.ts`、`packages/domain/src/permission.ts`、`packages/pi-runtime/src/extensions.ts` 及其测试；`secrets.ts`/`permission.ts`/`extensions.ts` 本轮无改动）。每条修复配一条**在旧行为下会失败**的回归用例。

### W7R2-01（P1）只读角色经 `bash`/`git` 写源码；容器 `writableRoots` 提权

- **改了什么**：写门禁由「操作名名单」改为**能力分类**（`broker.ts`）。新增 `toolCapability(operation)`（`read`/`search`/`network`/`secret` = `read-only`，**其余一律 `mutating`**，未知名字 fail-closed）与 `isArbitraryCommandOperation`（`bash`/`git`）；删除了旧的 `WRITE_OPERATIONS`/`isWriteOperation`。`access` 缺省由能力推导（`mutating` ⇒ `write`），因此不能把 `bash` 声明成 read 蒙混。对 review/test：任意 `mutating` 工具被拒——`bash`/`git`（任意命令）与**非路径型** mutating 工具（`push`/`deploy`/未知名）无论是否声明 report root 都拒绝（`NOT_AUTHORIZED`，`fields=['role','operation']`），只有「效果就是某个路径」的 mutating 工具（`write`/`edit`/`artifact_write`/`delete_data`）可在声明的 report root 内放行（W7R1-13 语义保留）。`containerPlan` 对只读角色**剥离调用方 `writableRoots`**，只把 `writableReportRoots` 挂 `rw`，源码根恒为 `ro`；host 模式的写复查同样按能力走。
- **回归测试**（`broker.test.ts`）：`refuses a read-only role a host bash write to source, leaving the file intact (W7R2-01)`、`refuses a read-only role a host git write to source (W7R2-01)`（源码字节不变 + 零 `tool_operation`）、`refuses a read-only role a non-path mutating tool even with a report root (W7R2-01)`（`push`：即便声明了 report root 也拒绝，工具体零执行）、`strips caller writableRoots for a read-only role in container mode (W7R2-01)`（`docker run` 参数含 `<ws>:/workspace:ro` 与 report 根 `:rw`，且不含 `<ws>:/workspace:rw`）、`still admits a report write for a read-only role (W7R2-01)`、`still runs an arbitrary-command tool for a write-capable role (W7R2-01)`。旧行为下前四条失败（bash/git/push 被放行；workspace 被 `rw` 挂载）。
- **记录修正**：`implementation.md:138`（T7/W7R1-13）「对 review/test，写操作仅在 `writeRoots` 内放行」现对**所有** mutating 工具成立，且 `bash`/`git` 对只读角色一律拒绝，不再是文档与代码的偏离。

### W7R2-02（P2）准入早于异步 DNS 决议，拒绝目标仍消费 Grant

- **改了什么**：`Broker.invoke` 改为 `async invoke(...): Promise<ToolOutcome>`；准入第 4 步由同步 `checkTarget` 改为 `await networkPolicy(invocation).decide(...)`，因此「解析后才是私网」或「不可解析」的目标在 `consumeOnce` 之前被拒，Grant 不被消费、不写 `tool_operation`。网络决议顺带返回已校验地址供钉扎（见 W7R2-03）。同步 `checkTarget`/`checkUrl` 保留为纯策略快路径。
- **回归测试**（`broker.test.ts`）：`refuses a target whose DNS answer is private before consuming the Grant (W7R2-02)`（桩解析器 `localtest.example → 127.0.0.1`；`NOT_AUTHORIZED`、`consumedAt` 未写、`toolOperations.count()===0`）与 `still admits a public address literal at admission (W7R2-02)`（`93.184.216.34` 字面量仍放行并执行）。
- **调用点适配**：`Broker` 在本仓库内尚无生产调用点（仅测试），`packages/core/test/*` 的 `invoke` 调用点全部改为 `await`；`permissions.integration.test.ts` 的 `Harness.invoke`/`invokeBuiltin` 返回类型改为 `Promise<ToolOutcome>`。

### W7R2-03（P2）DNS TOCTOU：校验地址未钉在连接上

- **改了什么**：`NetworkPolicyDecision` 的 `ok` 分支新增 `addresses`（仅当**真的发生解析**时携带；字面量的 URL host 本身就是地址，无需钉扎）；`classifyHostResolution` 返回已校验地址；`GuardedRequester` 每一跳把 `decision.addresses` 作为 `pinnedAddresses` 传给 `NetworkFetcher`。默认传输 `defaultNetworkFetcher` 在存在钉扎时改用 `node:http(s)` + 只返回该地址的 `lookup`（`pinnedLookup`），因此守卫与连接之间再解析一次也拿不到第二个（私网）地址；未钉扎路径仍走 `fetch`。`decide()` 因授权而提前放行但解析成功时同样返回地址（授权名字也被钉扎）。**残余**：`pinnedAddresses` 是交给注入 fetcher 的约定——调用方自带的 transport 必须自行兑现（见 T8 残余 1）。
- **回归测试**（`broker.test.ts`）：`pins the transport to the address the policy validated (W7R2-03)`（记录 fetcher 收到 `['93.184.216.34']`）、`never lets a rebinding answer reach the second address (W7R2-03)`（解析器第二次返回 `127.0.0.1`；fetcher 记录的实际连接目标是首次校验值，且只发生一次查找）、`connects to the pinned address through the built-in transport (W7R2-03)`（真实本地 HTTP 服务器；`rebind.example` 并不存在于 DNS，只有钉扎地址能解释成功连接）。

### W7R2-04（P2）持久延迟结果存储非多写者安全

- **改了什么**：`packages/core/src/grants.ts` 的 `ProjectStoreDeferredResultStore` 由「共享 manifest + 哈希 blob」改为**每个结果一个文件** `deferred-results/refs/<ref>.json`（临时文件 + 原子 rename，`put` 无读改写）。彻底删除进程内 manifest 缓存：任何写者写入的结果对同目录所有进程**立即可解析**，并发写者不会互相丢条目。旧 manifest（`deferred-results/index.json`）仅保留**只读兼容**路径，使升级前写入的结果仍可解析。
- **回归测试**：单元 `packages/core/test/grants.test.ts › sees another sink's result immediately, with no stale manifest cache (W7R2-04)`（旧行为：sinkA 首次 `put` 后缓存 manifest，读不到 sinkB 的 ref ⇒ 失败）；集成 **新增文件** `packages/core/test/grants.integration.test.ts › loses no entry when two processes write results concurrently (W7R2-04)`（两个真实 `node` 进程各写 25 条，断言 50 个 ref 全部唯一且全部可解析；旧行为下并发读改写 manifest 会丢条目）。

### W7R2-05（P3）解析器抛异常逃逸为异常

- **改了什么**：`grants.ts` 无改动；`broker.ts` 新增 `safeResolve`，把 `resolver.resolve` 的同步/异步抛出转换为 `{ok:false, reason}`，`classifyHostResolution`/`resolvesToPrivateAddress` 与 `GuardedRequester` 因此把「解析器坏了」按**不可解析**处理，返回 `NOT_AUTHORIZED` + 原因，而不是抛出。
- **回归测试**（`broker.test.ts`）：`turns a throwing resolver into a refusal instead of an exception (W7R2-05)`——`decide()` 与 `GuardedRequester.request()` 均返回带 `resolver exploded` 原因的拒绝，不抛异常。

### W7R2-06（P3）仅解码 `64:ff9b::/96`；本地用途 NAT64 被判公网

- **改了什么**：`broker.ts` 新增 `DEFAULT_NAT64_PREFIXES = ['64:ff9b::/96', '64:ff9b:1::/48']`（RFC 6052 well-known + RFC 8215 local-use，可经 `NetworkPolicy`/`BrokerOptions.nat64Prefixes` 配置）与 CIDR 解析/匹配；`isPrivateIpv6` 对每个命中前缀解出内嵌 IPv4 并套用**完整** IPv4 规则：`/96`（及更长）取末 32 位，短前缀按 bits 48..79（`u` 八位组必须为 0）并同时检查末字；**无法解码一律按内网**。
- **回归测试**（`broker.test.ts`）：`decodes local-use NAT64 prefixes and treats undecodable ones as private (W7R2-06)`——`64:ff9b:1::7f00:1`、`64:ff9b:1::a00:1` 判内网，`64:ff9b::7f00:1` 仍内网，配置前缀 `2001:db8:64::/96` 生效，不可解码布局判内网，且 `NetworkPolicy.decide` 对 `https://[2001:db8:64::7f00:1]/` 拒绝。

### W7R2-07（P3）就绪靠「端口可连 + 子进程存活」，外部监听器可冒充

- **改了什么**：`test-environment.ts` 的 `TestEnvironmentPorts` 新增 `listeningPid(port)` 与 `processDescends(pid, ancestor)`；默认实现 `listeningProcess` 在 macOS/BSD 用 `lsof -sTCP:LISTEN -Fp`，Linux 用 `/proc/net/tcp{,6}` 的 inode 反查 `/proc/<pid>/fd`，`processDescends` 用 `/proc/<pid>/stat` / `ps -o ppid=`。`waitForPort` 在端口可连、子进程存活且跨过 settle 窗口后，还要求套接字属主是该子进程或其**后代**；归属无法证明（探针不可用/无 pid/属主是别人）一律 `INVALID_STATE`，绝不报 running。
- **回归测试**（`broker.test.ts`）：`refuses readiness when the port is owned by an external listener (W7R2-07)`——真实外部 `net` 监听器占用该端口 + 一个存活但从不监听的子进程 ⇒ `start` 返回 `INVALID_STATE` 且 reason 含 `owned by pid`（旧行为：`ok:true`/running）。既有真实子进程用例（unit + integration）继续通过，证明该证明不误伤真就绪。
- **既有 fixture 适配**：`permissions-failures.test.ts` 的「进程清理失败」用例用一个假 `spawn`（从不真正 bind）配合注入监听器，为使该用例仍聚焦清理失败路径，其 fake ports 显式提供 `listeningPid: () => <fake pid>` 与 `processDescends: () => false`。

### W7R2-08（P3）`create` 认领端口后抛异常会永久泄漏

- **改了什么**：`TestEnvironmentManager.create` 把端口认领之后的所有步骤包进 `try`；任何抛出都 `releasePort(port)`（并尽力 `removeDir`），然后**以结果对象**返回 `{ok:false, code:'PROVIDER_UNAVAILABLE', reason:'…ENOSPC…'}`，不再抛异常，也不再让进程级认领存活。
- **回归测试**（`broker.test.ts`）：`releases a claimed port when create fails, so a later create succeeds (W7R2-08)`——注入 `createDir` 抛 `ENOSPC`；断言返回结果对象、`claimedTestPorts()` 不含该端口、同一端口随后可被另一个 manager 成功创建。

### W7R2-09（P3）合法 `null`（或 `undefined`）结果无法重放

- **改了什么**：`DeferredResultStore` 新增 `has(ref): boolean` 作为**存在性**信号（`InMemoryDeferredResultStore` 用 `Map.has`；持久存储以「每 ref 一个文件」为存在标记，并把 `undefined` 显式编码进记录）。`replayOperation` 改为 `if (!results.has(ref)) throw RECOVERY_REQUIRED` 后再取 `get(ref)`，因此已记录的 `null`/`undefined` 正常重放，只有真正缺失才报恢复态。
- **回归测试**（`grants.test.ts`）：`replays a recorded null result instead of reporting it missing (W7R2-09)`（首次 `executed`、`result === null`；重试 `replayed`、`result === null`，旧行为下抛 `RECOVERY_REQUIRED`）与 `replays a recorded undefined result as present (W7R2-09)`。

### W7R2-10（P3）离线 blob GC 删除延迟结果；清单线性增长/整体重写

- **改了什么**：结果文件落在 `deferred-results/refs/`，**不在** `BlobStore.collectGarbage` 唯一清扫的 `blobs/**` 树内；新增 `ProjectStoreDeferredResultStore.referencedPaths()` 与模块级 `deferredResultGcRoots(store)`、`collectProjectGarbage(store, referenced)`，把「延迟结果 + 旧 manifest + 旧 manifest 引用的 blob」并入 GC 引用根。新布局没有共享 manifest，`put` 不再整体重写，清单随结果数线性增长的问题消失（旧 manifest 仅兼容读）。
- **回归测试**（`grants.test.ts`）：`keeps a recorded result alive through an offline blob GC (W7R2-10)`（`blobs.collectGarbage(new Set())` 返回 `[]`，随后重放仍成功；旧行为下结果 blob 被删、重放 `RECOVERY_REQUIRED`）与 `registers the deferred-result records and legacy blobs as GC roots (W7R2-10)`（`deferredResultGcRoots` 含该 ref 文件；`collectProjectGarbage` 保留旧 manifest 引用的 blob）。

### T8 修正的旧期望/记录

1. `grants.test.ts › replays the recorded result from a second store…` 原断言 `store.blobs.has('deferred-results/index.json')`——该期望**编码了 W7R2-04/10 的缺陷布局**（共享 manifest），已改为断言该 `resultRef` 的 per-ref 记录存在（`ProjectStoreDeferredResultStore.has(ref)`）。
2. `broker.test.ts › refuses a container network call when no Core proxy exists…` 与 `› refuses an operation with no built-in executor…` 原用 `https://example.com/`；旧同步准入不解析 DNS、把未知名字当公网，W7R2-02 后改为使用本地桩解析器认识的 `public.example`（fixture，离线）才能走到「无代理拒绝」/「无内置执行器」分支。这是**期望随修复变更**，不是放宽。
3. `permissions-failures.test.ts` 与其余 3 个测试文件的 `invoke` 调用点因 `Broker.invoke` 变为异步而改为 `await`（纯适配，无断言语义变化）；其中「进程清理失败」fake ports 增补归属探针（见 W7R2-07）。
4. T7 残余 #6（GC 未纳入清单）**关闭**：结果已移出 blobs 树，并提供 `collectProjectGarbage` 合并引用根；不再声称「尚未把该清单纳入」。
5. 旧 `implementation.md` 中「跨进程重放依赖 manifest 缓存」的实现细节随 W7R2-04 失效；T7/W7R1-10 的**行为**结论（第二个 OS 进程能重放原结果）仍成立且已由集成用例覆盖。

### T8 新登记残余

1. **W7R2-03 钉扎依赖 transport 兑现 `pinnedAddresses`**：内建传输用 `lookup` 真正钉扎；调用方注入的 `NetworkFetcher` 会收到该 pin，但 Broker 无法强制其使用（这是接缝契约）。另外**字面量目标同样携带它自身的地址**（URL host 即地址；返回该地址使内建传输钉在已校验的字面量上，行为更保守——早前此处「字面量不带 pin」的表述有误，已由 W7R3-05 更正）。而 `ToolInvocation.run` 体若自建传输会绕过 `GuardedRequester`——准入阶段仍会按 W7R2-02 解析并拒绝私网目标，但「工具体自己发起的第二次连接」不在本包的守卫范围内。
2. **W7R2-07 归属证明依赖 OS 探针**：macOS/BSD 需 `lsof`、Linux 需 `/proc`；两者都不可用或 `lsof` 无权看到属主时无法证明归属，`start` 以 `INVALID_STATE` fail-closed（可能对特殊宿主产生假阴性——按设计不猜测）。
3. **W7R2-04 布局是单向兼容**：新版本仍能读旧 manifest，但旧版本进程读不到新写入的 per-ref 结果；滚动升级期间不应混跑两个版本。
4. **W7R2-01 能力清单是封闭集合**：新增只读工具名必须显式加入 `READ_ONLY_OPERATIONS`，否则按 mutating fail-closed（`delete_data`/`push`/`deploy` 仍为 mutating）。
5. **W7R2-08 API 变化**：`create` 失败路径由「抛出」改为「返回 `PROVIDER_UNAVAILABLE` 结果对象」（空目录等成功语义不变）；调用方需按既有 `CreateOutcome` 分支处理。

### T8 验证数字（本轮，全部命令真实执行）

| 命令 | 结果 |
|---|---|
| `prettier --write`（本包归属文件） | 全部符合 Prettier |
| `pnpm typecheck` | 退出 0 |
| `pnpm lint` | 退出 0（ESLint + `All matched files use Prettier code style!`） |
| `pnpm test:unit` | **44 文件 / 905 用例全部通过**（T7 为 885；本轮 +20：broker W7R2 15 例 + grants W7R2 5 例） |
| `pnpm test:integration` | **15 文件 / 157 用例全部通过**（T7 为 14/156；新增 `grants.integration.test.ts` 1 例并发写者；真实 Docker 用例实际执行，无 skip） |
| `pnpm build` | 10 workspace 全部 Done |

## T9 Review 第 3 轮修复（W7R3-01..05）

冻结点/审查报告：`b1c5328`（tree `801f2464`）上的 `.agentdev/work/WP-07/review.md` 第 3 轮（第 553 行起）。本轮只改本包归属文件（`packages/core/src/{broker,grants,test-environment}.ts` 及其测试；`secrets.ts` 本轮无改动），并按任务要求把 T9 追加进本记录。每条修复配一条**在旧行为下会失败**的回归用例，且已用「突变-还原」逐条验证（见每条末的「突变验证」）。

### W7R3-01（P2）只读角色的 `run` 工具体可经 `ctx.writeFile`/`ctx.run` 写源码

- **改了什么**：`packages/core/src/broker.ts` 的 `contextFor`。
  - `writeFile` 对只读角色的边界**不再由调用声明的 `access` 推导**：`operation:'read'` 的调用声明 `access:'read'`，旧代码因此得到空的 `writeRoots`，把限制丢掉。现在只读角色的任何 `writeFile` 一律以 `BrokerOptions.writableReportRoots` 为唯一可写边界；未配置报告根时直接以 `NOT_AUTHORIZED` 拒绝，源码路径（含经符号链接解析）一律拒绝。
  - 只读角色注入的 `context.run` 改为 fail-closed 桩 `refuseReadOnlyCommand`：调用即抛 `ProtocolError('NOT_AUTHORIZED', "… cannot execute shell commands")`，不再是可执行的 `/bin/sh -lc`。写角色仍拿到真正的 `runCommand` 与 `writeFile`（能力未变）。
- **回归测试**（`packages/core/test/broker.test.ts`）：`refuses a read-only role writeFile to source from a read body, leaving the file intact (W7R3-01)`、`refuses a read-only role ctx.run from a read body, leaving the file intact (W7R3-01)`、`refuses ctx.run inside an admitted report write body for a read-only role (W7R3-01)`、`still admits a report-root body write for a read-only role (W7R3-01)`、`still gives a write-capable role both writeFile and run (W7R3-01)`。
- **突变验证**：把只读写分支的条件短路为 `false` ⇒ writeFile 用例失败（源码被改）；把 `run` 桩换回 `runCommand` ⇒ 两条 `ctx.run` 用例失败（源码被改）。均已还原。

### W7R3-02（P2）异步 `run` 工具体未被 await

- **改了什么**：`packages/core/src/grants.ts` 新增 `GrantStore.consumeOnceAsync`，把消费拆成三段：事务一（`prepareInTransaction`）完成绑定判定、写 `prepared` 行并**原子**认领 `once` Grant 后提交；工具执行移到事务**之外** `await request.executor()`；事务二（`finishOperation`）记录已 await 的结果并置 `finished`。执行体 reject 时 `rollbackPrepared` 在第三段事务里清空 `consumed_at`/`consumed_by_operation_id` 并删除 `prepared` 行，因此失败执行不消费 Grant、不留 `finished`、可重试；rejection 原样上抛给已 await 的调用方，不会成为未处理拒绝。`Broker.invoke` 改调 `consumeOnceAsync`。同步 `consumeOnce` 仍是原语义，但补一道 fail-closed 守卫：执行器返回 thenable 时抛 `ProtocolError('INVALID_STATE', …)`，事务回滚（旧代码会把 `Promise` 当结果记下）。
- **回归测试**（`packages/core/test/grants.test.ts`）：`awaits an async body, records its resolved value and replays it (W7R3-02)`（首次 `executed`/结果为解析值/`finished`；同输入重放同一 `resultRef` 与解析值，执行计数 1）、`consumes nothing and leaves nothing finished when an async body rejects (W7R3-02)`（reject 上抛、无 `unhandledRejection`、`consumedAt` 未写、`toolOperations.count()===0`、随后重试成功）、`refuses a thenable from the synchronous path instead of recording it (W7R3-02)`。
- **突变验证**：删除同步 thenable 守卫 ⇒ 同步路径用例失败；把 `await request.executor()` 改回直接取值 ⇒ 两条异步用例失败（结果被记成 Promise，并出现未处理拒绝）。均已还原。
- **接口影响**：`GrantConsumeRequest.executor` 仍为 `() => unknown`；需要异步工具的调用方走 `consumeOnceAsync`，同步 API 对 thenable fail-closed（记录见 T9 残余）。

### W7R3-03（P3）传输错误被重新抛出

- **改了什么**：`packages/core/src/broker.ts` 的 `GuardedRequester.request` 用 `try/catch` 包住 `this.fetcher(...)` 与 `response.text()`；`ECONNREFUSED` 等传输/读取失败返回闭合的 `NetworkFetchOutcome`：`{ok:false, code:'PROVIDER_UNAVAILABLE', reason:'… failed: <原原因>', blockedUrl: <当前跳>, hops}`，不再让异常逃逸。
- **回归测试**：`turns a transport error into a structured refusal (W7R3-03)`（fetcher 抛 `connect ECONNREFUSED …`；断言结果对象、code、原因与 `blockedUrl`，且不抛）。**突变验证**：让 catch 重新 `throw error` ⇒ 用例失败（reject）。已还原。

### W7R3-04（P3）端口探测抛异常逃出 `create()`

- **改了什么**：`packages/core/src/test-environment.ts` 的 `create` 把 `await this.allocatePort(...)` 包进 `try/catch`；探测抛异常时返回与其它创建失败**相同形状**的结果对象 `{ok:false, code:'PROVIDER_UNAVAILABLE', reason:'test environment port probe failed …: <原原因>'}`，不再 reject。认领发生在探测成功之后，因此该路径本就没有泄漏，`claimedTestPorts()` 保持不变。`TestEnvironmentPorts.portAvailable` 的文档同步说明「抛出的探针按探测失败处理」。
- **回归测试**：`returns a PROVIDER_UNAVAILABLE result when the port probe throws (W7R3-04)`（注入抛异常的 `portAvailable`；断言结果对象、`PROVIDER_UNAVAILABLE`、原因含 `probe exploded`、端口未被认领）。**突变验证**：让 catch 重新 `throw error` ⇒ 用例失败（reject）。已还原。

### W7R3-05（P3）字面量目标实际带 pin，与注释/T8 残余不符

- **改了什么**：选择**保留 pin**（更保守）并修正措辞，不改行为：`packages/core/src/broker.ts` 中 `NetworkPolicyDecision.ok.addresses` 的注释改为「字面量携带自身规范化地址，用于把内建传输钉在已校验值上（W7R3-05）」，`classifyHostResolution` 的字面量分支补注释；`implementation.md` T8 残余 1 中「字面量目标不带 pin」更正为「字面量目标同样携带它自身的地址」。
- **回归测试**（记录类修复，按任务要求为 regression-free）：`carries a literal target its own address, pinning the transport (W7R3-05)`——`new NetworkPolicy({}).decide({url:'https://93.184.216.34/'})` 为 `ok:true` 且 `addresses === ['93.184.216.34']`。

### T9 修正的旧期望/记录

1. `implementation.md` T8 残余 1 的「字面量目标不带 pin（URL host 即地址）」与代码不符（W7R3-05）；已按「保留 pin」更正为「字面量同样携带其自身地址」。
2. T9 未修改任何既有测试期望：现有 905 条 unit 用例与 157 条 integration 用例全部原样通过；本轮只是**新增** 11 条 unit 用例（`broker.test.ts` 47→55、`grants.test.ts` 36→39）。旧行为下会失败的新用例由上面的「突变-还原」逐条证明。

### T9 新登记残余

1. **Broker 对工具体的非 `ProtocolError` 失败仍会抛出**：`consumeOnceAsync` 会把 rejection 补偿后原样上抛，`Broker.invoke` 只把 `ProtocolError` 转成契约拒绝。因此 `ctx.writeFile`/`ctx.run` 这类自带契约码的拒绝是结构化拒绝，而工具体抛出的普通 `Error` 仍会从 `invoke` 冒泡（调用方 await 得到，不会成为未处理拒绝）。把任意工具体异常也映射为契约码不在本轮范围。
2. **`consumeOnceAsync` 的补偿会二次递增 `grant.version`**：认领与回滚各写一次 `version = version + 1`；`version` 是审计计数而非业务字段，回滚后 `consumed_at` 已清空、Grant 可再次认领，行为正确，但审计上会看到两次版本变化。
3. **同步 `consumeOnce` 不再接受 thenable 执行器**：这是有意收紧（旧行为静默记录 `Promise`）；需要异步工具的调用方必须改用 `consumeOnceAsync`。
4. **异步执行期间 `prepared` 行可见**：并发同 `toolOperationId` 的调用在 await 窗口内会得到 `RECOVERY_REQUIRED`（其结果尚未记录），这是 fail-closed 而非重复执行；窗口内的等待不属于重放路径。

### T9 验证数字（本轮，全部命令真实执行）

| 命令 | 结果 |
|---|---|
| `prettier --write`（本包归属文件 + 本记录） | 全部符合 Prettier |
| `pnpm typecheck` | 退出 0 |
| `pnpm lint` | 退出 0（ESLint + `All matched files use Prettier code style!`） |
| `pnpm test:unit` | **44 文件 / 916 用例全部通过**（T8 为 905；本轮 +11：broker W7R3-01 5 例 + W7R3-03/04/05 各 1 例 = 8，grants W7R3-02 3 例） |
| `pnpm test:integration` | **15 文件 / 157 用例全部通过**（与 T8 相同；真实 Docker 用例实际执行，无 skip） |
| `pnpm build` | 10 workspace 全部 Done |


## T10 独立 Test（PASS）与残余登记

- 第四轮聚焦 Review 判 **PASS**（0×P0、0×P1）：W7R3-01/02（P2）与 W7R3-03/04/05（P3）共 5/5 独立复现为关闭；新增一条非阻断 **W7R4-01 [P3]**。
- 独立 Test 判 **PASS**：AC-048/049/050/051/053/080 全部接受；自建 12 组探针 72 通过 / 0 失败 / 4 观察；四个必需失败测试独立复现；六条契约命令退出 0（unit 44 文件/916、integration 15 文件/157 含真实容器、build 10 workspace、docs:check ok）。
- 本轮登记残余（供结算与后续工作包）：
  1. **W7R4-01 [P3]**：工具体永不 settle（或进程在 await 窗口中断）时，`once` Grant 保持已认领、`tool_operation` 停在 `prepared`，同 `toolOperationId` 重试得 `RECOVERY_REQUIRED`，且无公开的 resume/超时回滚入口。方向 fail-closed（不重复执行、不伪造 finished），协调入口建议随 WP-08 恢复路径补齐。
  2. **T-01 [P3]**：只读角色 + 路径型 mutating 操作 + 空 `targets` 会通过角色门禁（`ADMITTED`），但内置执行器对该操作返回 `INVALID_STATE`，且 `ToolContext` 仍受报告根与只读 `run` 桩约束，故不构成写通道；后续可在能力分类里对「mutating 且无路径」一律拒绝。
  3. **T-03/T-04 [P3，可核验性]**：T5/T7/T9 记录的「突变-还原」实验与 T8 的历史逐文件计数无法仅凭当前树核验（Review/Test 不得改源码）；当前树计数与 T9 声明一致（broker 55、grants 39）。后续记录只写可由仓库直接核验的证据。
  4. **既有限制（按记录接受）**：根内硬链接可读根外 inode（W7R1-08，无 AC 覆盖）；注入 fetcher 收到 pin 但 Broker 无法强制其兑现（T8 残余 1）；容器网络代理 `networkProxy` 未配置；`loadTrustedExtensions` 尚未接入 `apps/runner`（属 WP-08）；持久化 Secret 后端属安装范围；Linux `/proc` 端口归属分支未在本机（macOS）执行。
