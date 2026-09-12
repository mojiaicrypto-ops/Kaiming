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
  - 原子性：`UPDATE ... WHERE consumed_at IS NULL` 的行数即原子认领；并发双消费（第二次连接握手进入同一进程事务）只有一次执行、一次重放。
  - 撤权：把 `expiresAt` 置为纪元并写 `consumedAt`（不写 `consumedByOperationId`），因此后续使用拒绝而已完成事务仍可重放。
- 回归网：`packages/core/test/grants.test.ts`（28 例）、`packages/domain/test/permission-delivery.test.ts`（19 例）。

## T2 SecretStore 与泄漏防护（AC-051）

- `core/secrets.ts`：内存 `SecretStore`（值存于 ECMAScript `#private` 字段）+ `redact`/`redactValue`/`scanForLeaks`/`hasLeaks`/`containsSecret`/`secretEnvName`/`gatewaySecretResolver`。
  - `resolve(ref, context)` **先跑 Grant 校验**（`secret` 操作 + 精确 ref + 角色/阶段/Run/使用时刻）再查注册项，因此未授权者得到 `NOT_AUTHORIZED`（不存在性不可探测），已授权者未知 ref 得 `NOT_FOUND`；过期/撤权 ⇒ `AUTH_EXPIRED`。
  - `environmentFor(context, refs)` 只注入**被请求且已授权**的 secret；任一被拒则整体拒绝（不产生部分/未授权凭证）。
  - 查询面（`has`/`refs`/`list`、`JSON.stringify(store)`）永不返回值；`maskAll`/`scanAll` 供审计路径遮蔽/检测。
  - 脱敏覆盖嵌套对象/数组/键名/Map/Set/Date/`Error`（含 name/message/stack/cause），最长值优先替换，输入不被修改；`scanForLeaks` 只报告路径 + `secretIndex` + 遮蔽预览，绝不返回值。
- 回归网：`secrets.test.ts`（26 例）、`secrets.integration.test.ts`（5 例，真实 SQLite + GrantStore + 真实 node 子进程）。

## T3 Broker、文件/网络边界与测试环境（AC-048/AC-050）

- `core/broker.ts`：`Broker.invoke` 顺序为「规范化输入 Hash → 形状校验 → 角色写入门禁 → 文件目标 realpath 校验（允许根 + 保护路径）→ 网络策略 → 执行模式检查 → 交给 `GrantStore.consumeOnce`」；准入调用写 `tool_operation` 行 + `tool.invoked` 事件，任何拒绝在副作用前写 `tool.refused` 并返回契约错误码；无内置执行器的工具体抛 `INVALID_STATE` 使事务回滚（不伪造结果）。
  - 模式：`container` 使用 WP-00 执行镜像，失败**绝不回退 host**（Docker 探测失败 ⇒ `PROVIDER_UNAVAILABLE` 并原样给出原因）；`planContainerRun` 产出 `--read-only`、`--tmpfs`、`--cap-drop=ALL`、no-new-privileges、`--pids-limit 256`、`--memory 2g`、`--cpus 2`、`--user 10001:10001`、根挂载 `:ro`，默认 `--network none`。
  - 文件边界：解析含不存在的末段路径的符号链接祖先，符号链接/`..`/绝对逃逸在准入前拒绝并在读写时复查；`protectedPaths` 让 Review Run 在两种模式下都读不到运行库。
  - 网络：`NetworkPolicy` 拒绝 loopback/私网/link-local/CGNAT/元数据地址（除非精确授权 host 或 host:port）；`GuardedRequester` 用 `redirect:'manual'` 对每一跳校验后再取，302 到 `169.254.169.254` 在第 2 跳被拒且不跟随。
- `core/test-environment.ts`：`TestEnvironmentManager` 从专用端口段分配端口（跳过保留的 dev 端口与自身在用端口），在新建临时目录里放 `test.sqlite`，以独立进程组启动命令并等待端口就绪，用 `AGENTDEV_TEST_DB`/`AGENTDEV_TEST_PORT` 在该环境内运行命令；清理任一步失败都上报 `RECOVERY_REQUIRED` 并给出具体失败项（同时继续尝试其余步骤）。
- 回归网：`broker.test.ts`（24 例）、`broker.integration.test.ts`（6 例，含真实 Docker 只读读取与非 root 账户）。

## T4 信任与 Skill/扩展加载边界（AC-053）

- `pi-runtime/extensions.ts` 新增 `loadTrustedExtensions`（既有 `activateExtensions`/内置白名单语义不变）：
  - **未信任**项目在该路径上严格只读：不 import 任何仓库模块、不读 Skill、不采纳仓库配置（无 fs 访问），每个候选/配置/Skill 都记为 `skipped` + `NOT_AUTHORIZED` + 精确原因（`untrusted-project: …`），`readOnly: true`。
  - **已信任**后：仓库扩展必须**同时**被显式选择且在发布白名单内才可加载；否则 `NOT_AUTHORIZED`（not-selected）或 `VALIDATION_ERROR`（not-in-builtin-whitelist）；路径逃逸（含经 realpath 的符号链接）⇒ `VALIDATION_ERROR`（path-escape）；仓库配置永远记为 skipped（配置永不权威）；只有被显式选择的 Skill 在信任后被读取，且必须解析在项目/agent 根内。
  - 每次判定进入有序 `trace`（seq/kind/id/origin/decision/path/code/reason），每个拒绝都带契约 `ErrorCode`；import/读取失败不吞，转为带原因的拒绝。
- 回归网：`pi-runtime/test/trust.test.ts`（13 例，真实临时仓库；fixture 模块 import 时会写 `pwned.marker`，用文件系统证明「是否被 import」）。

## T5 集成与必需失败测试

- `packages/core/test/permissions.integration.test.ts`（9 例，integration 项目）：AC-049/080（范围内执行并审计；越界/过期/兄弟 Run 拒绝且零执行零写入；`once` 重放与不同 inputHash 的 `IDEMPOTENCY_CONFLICT` 且有真实落盘副作用）、AC-048/050（review/test Run 在 host 与 container 两种模式下读冻结输入、拒绝源码/DB 读取与一切写；验证者报告写入被只读角色门禁拒绝且不留文件/行）、AC-051（诱饵经真实 node 子进程到达已授权子进程；未授权兄弟拿不到；Artifact 行/事件流/grant 行/UI payload/store JSON/host 环境/仓库均无泄漏）、AC-053（未信任仓库自动加载模块不写 marker；信任后只加载被选且白名单内的资源）。
- `packages/core/test/permissions-failures.test.ts`（4 例）：**符号链接/私网/重定向**、**Secret 泄漏**、**进程清理失败**、**无 Docker 拒绝**，标题逐字命名。
- 回归敏感性：三处临时改动（移除 `resolveWithinRoots` 的 realpath、移除 `once` 的 inputHash 比较、关闭只读角色门禁）分别被对应用例抓到并已还原。

## T6 验证与本轮状态

- 契约命令（本记录时点）：`pnpm typecheck` 0；`pnpm lint` 0；`pnpm test:unit` **44 文件 / 872 用例**；`pnpm test:integration` **14 文件 / 152 用例**（含真实 Docker）；`pnpm build` **10 workspace**；`pnpm docs:check` ok。
- 已登记残余（供 Review/Test 判定，均为承接而非静默）：
  1. `grant.revokedAt` 不是契约列，撤权复用 `consumedAt` + 纪元 `expiresAt`（`consumedByOperationId` 保持未设以区分已完成）；新增真列需 contracts/schema/migration 与 `data.md` 更新（本包外）。
  2. `consumeOnce` 在事务内执行工具（失败回滚、零残留），但长任务会持写锁；如需「提交后执行」变体，`prepared`/`finished` 行形状已支持。
  3. 网络工具传输是异步而 `consumeOnce` 执行器同步：Broker 对无 `run()` 体的 `network` 操作拒绝（`INVALID_STATE`，事务回滚），真实传输经 `GuardedRequester` 暴露；跨 HTTP 调用的同步 `once` 原子消费需要 T1 侧尚未暴露的 Grant API 接缝。
  4. 容器内文件写使用 here-doc，内容含分隔符行需转义（未被测试覆盖，不在必需行为内）。
  5. Secret 注入到工具子进程环境由 T2 的 SecretStore 提供，但**尚未接线进 Broker**；Broker 构造上不读/不记录/不持久化 secret（审计行只含 operation/inputHash/targets/grant 引用）。
  6. `gatewaySecretResolver` 是 WP-09 把某个 Run 的授权上下文绑到 Gateway 单参 `SecretResolver` 的适配点，接线属 WP-09。
  7. 持久化 Secret 后端（Keychain / 0600 加密文件 + 备份导出）属安装/部署范围；`SecretStore.put` 是注册接缝。
  8. `loadTrustedExtensions` **尚未接入 session 创建**（`apps/runner` 仍直接调 `activateExtensions`），接线属 WP-08/runner；`PiRuntimeErrorCode` 无 `NOT_AUTHORIZED`/`VALIDATION_ERROR`，当前以显式结果对象携带契约码，如经协议暴露需在调用点映射或扩展该枚举。
  9. 仓库扩展**发现**（解析 `.pi/extensions.json` 等）有意未实现：调用方传入只读观察到的候选，两种信任状态下都不采纳配置；未信任项目在该路径上从不扫描。
  10. 发布的可选扩展白名单仍为空（`execution.md` §7 未变），生产上仓库扩展无法满足「内置列表」，正向路径经 `manifest` 接缝（测试提供白名单项）验证。
