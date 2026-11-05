# WP-07 独立 Test 报告（权限、工具和测试环境）

- 测试对象：工作包 WP-07「权限、工具和测试环境」
- 冻结点（task 指定）：`96e196b`；`git rev-parse HEAD` = `96e196b4a4ac6de46d2eee38614e2813d9a37203`（吻合）
- `git rev-parse 96e196b^{tree}` = `98ff1930c8252a49124433ec9e1b124ae6d2eb15`
- `git status --porcelain`（本次 Test 写入前）= ` M .agentdev/work/WP-07/review.md`（**非空**：第 4 轮 Review 报告是在冻结点提交之后**追加到工作树**的；见 §6-R1）
- 测试角色：**Test**（独立上下文；未读取任何开发/Test 或 Review 聊天/会话；仅依据仓库文件、git 对象、构建产物与自建探针的原始输出）
- 前置门禁：`.agentdev/work/WP-07/review.md` 第 4 轮（第 785 行起）判定 **PASS**、**0 个 P0/P1**、明确「可以进入独立 Test」；满足 task 规定的「先读 round-4 verdict，若 FAIL 且有 P0/P1 则中止」条件 → 继续测试
- 环境：macOS arm64 / Node `v24.8.0` / pnpm `12.3.4` / Docker `28.4.0`（守护进程 UP，执行镜像 `agentdev/exec:0.0.0` = `edd3aa5051c7`）
- 方法：自建夹具与 8 个探针脚本（`/tmp/wp07t/`），全部**只消费 `packages/*/dist` 构建产物**（绝对路径 import），**不 import 任何产品测试文件**；真实 SQLite（`ProjectStore` 文件）、真实临时仓库/符号链接、真实 `node` 子进程与 `/bin/sh`、跨进程并发（6 个真实 OS 进程）、真实 OS 端口监听、真实本机回环 HTTP 服务器、**真实 Docker**（容器级正负例）。网络结论全部离线（桩 `HostResolver` + 桩/本机 fetcher，不发外部请求）。**未修改仓库任何文件**；唯一写入为本报告
- 权威依据：`docs/delivery/acceptance.md`（AC-048/049/050/051/053/080 原文）、`docs/delivery/implementation.md`（WP-07）、`docs/architecture/{execution,reliability,data}.md`、`docs/product/experience.md`、`docs/rules/agents.md`、`.agentdev/work/WP-07/{plan,implementation,review}.md`、`packages/core/src/{grants,secrets,broker,test-environment}.ts`、`packages/domain/src/permission.ts`、`packages/pi-runtime/src/extensions.ts`

---

## 1. 结论摘要（逐 AC）

| AC | 题目 | 正向 | 负向 | 本轮结论 |
|---|---|---|---|---|
| **AC-048** | Workspace 边界 | 通过 | 通过 | **通过** |
| **AC-049** | Autonomous 范围 | 通过 | 通过 | **通过** |
| **AC-050** | Full Access 门禁 | 通过 | 通过 | **通过**（含 T-01/P3 残余，不阻断） |
| **AC-051** | Secret 隔离 | 通过 | 通过 | **通过** |
| **AC-053** | 信任与资源 | 通过 | 通过 | **通过** |
| **AC-080** | 授权精确绑定 | 通过 | 通过 | **通过** |

- **Test 判定：PASS —— 接受 WP-07 的 AC-048、AC-049、AC-050、AC-051、AC-053、AC-080。**
- 计数：**6 个 AC 通过 / 0 个不通过 / 0 个完全未覆盖**；自建探针 **72 条断言通过、0 条失败**（另 4 条 OBSERVE 记录，见 §5）；契约命令 **6/6 退出 0**。
- 四个必需失败测试（符号链接/私网/重定向、Secret 泄漏、进程清理失败、无 Docker 拒绝）**4/4 独立复现通过**，标题逐字同名。
- 未发现 P0/P1。新增 **4 条 P3**（T-01 实现边界、T-02..T-04 记录/可核验性），均不构成 AC 阻断，路由为「记录并随结算/后续工作包处理」，**不触发 Test Failure 回路**。

---

## 2. 测试环境与复现方式

```text
export PATH="$HOME/.local/bin:$PATH"
cd /Users/huyaohua/huyh/work/aigrouptool && pnpm build   # 探针只消费 packages/*/dist
bash /tmp/wp07t/run-all.sh                               # 逐个探针，日志写 /tmp/wp07t/logs/
```

| 脚本 | 断言/OBSERVE | 覆盖 |
|---|---|---|
| `/tmp/wp07t/lib/harness.mjs` | 基础设施 | 真实 `ProjectStore`（dataDir + workspace + frozen + report 根）、Work/Task/4×Run/Attempt/Decision、`GrantStore`/`Broker`/`SecretStore` 夹具、断言与报告器 |
| `/tmp/wp07t/lib/consume-worker.mjs` | 基础设施 | 第二个真实 OS 进程打开同一数据目录，对同一 `once` Grant 竞争 `consumeOnce` |
| `probe-ac048.mjs` | **15 / 0 failed** | 无 Docker 拒绝（真实 PATH 探测 + 注入探测）、逃逸矩阵（符号链接/`..`/绝对/符号链接祖先）host+container 各读/写、根内符号链接正例、容器加固计划、私网字面量/mapped IPv6/NAT64/DNS/不可解析/重定向每跳/scheme/精确授权、真实 Docker 容器读与只读挂载负例 |
| `probe-ac049.mjs` | **9 / 0** | 范围内执行+审计；越界目标/错操作/过期/错角色/错阶段/撤权拒绝；签发越界/未知 Run 零写入；work 作用域双 Run 正例 |
| `probe-ac050.mjs` | **13 / 0**（+2 OBSERVE） | host/container 下 review 与 test 写源码拒绝、运行库默认结构保护、无 Grant 拒绝、report 根内写放行、越界/符号链接/`..` 逃逸拒绝、`ctx.writeFile`/`ctx.run` 工具体边界、容器 `writableRoots` 剥离 |
| `probe-ac051.mjs` | **7 / 0** | 诱饵经真实 `node` 子进程送达授权 Run；兄弟/过期/撤权/跨 audience/未授权 ref 拒绝；混合 refs 整体拒绝；日志/Artifact/UI/grant 行/事件/store JSON/宿主环境零泄漏；扫描器命中嵌套/键名/Map/Set/Error 且 preview 不回显 |
| `probe-ac053.mjs` | **6 / 0**（+1 OBSERVE） | 未信任零 import/零读 Skill/零采纳配置；信任后仅「显式选中 ∧ 发布白名单」加载（marker 证明真实 import）；未选中/未发布拒绝；目录/文件/`..`/绝对符号链接逃逸零读并带 trace；空 projectRoot 契约错误 |
| `probe-ac080.mjs` | **10 / 0** | once 全绑定、同输入幂等重放、异 inputHash 冲突、`null` 重放、兄弟隔离、work 作用域双 Run、**6 个真实进程并发**只执行一次 + 新进程重放、显式内存 sink 如实 `RECOVERY_REQUIRED` |
| `probe-failures.mjs` | **5 / 0** | 四个必需失败测试（标题逐字）+ 真实环境清理控制组 |
| `probe-carry.mjs` | **7 / 0**（+2 OBSERVE） | T5..T9 残余登记与行为：runner 未接线、持久 Secret 后端、GC/清单布局、结果增长、硬链接边界、容器级负例、transport pin 契约、legacy 清单兼容、stale `prepared` |
| **合计** | **72 PASS / 0 FAIL / 4 OBSERVE** | `PROBES_STATUS=0` |

脚本与日志：`/tmp/wp07t/{run-all.sh,probe-*.mjs,lib/}`、`/tmp/wp07t/logs/{all.log,probe-*.log,commands.log,notimplemented.log}`。

---

## 3. 契约命令原始结果与仓库状态

全部命令在冻结点 `96e196b`（tree `98ff1930`）工作树上真实执行一次；原始日志 `/tmp/wp07t/logs/commands.log`。

| 命令 | 原始结果 | 退出码 |
|---|---|---|
| `pnpm typecheck` | `$ tsc -p tsconfig.json --pretty false`；无输出 | **0** |
| `pnpm lint` | `$ node scripts/lint.mjs`；`Checking formatting...` / `All matched files use Prettier code style!` | **0** |
| `pnpm test:unit` | `Test Files 44 passed (44)` / `Tests 916 passed (916)` | **0** |
| `pnpm test:integration` | `Test Files 15 passed (15)` / `Tests 157 passed (157)`；容器用例**真实执行、无 skip**（`runs a container read through Docker and reports the real non-root account 4493ms`、`runs as the non-root execution account 1194ms`、`keeps the root filesystem read-only`、`drops every Linux capability 1640ms`、`has no network access but a working name resolver 3354ms`、`applies the pid and memory limits 4284ms`） | **0** |
| `pnpm docs:check` | `docs:check ok — 15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages` | **0** |
| `pnpm build` | `pnpm -r build`：contracts/domain/storage/workspace/knowledge/pi-runtime/core/cli/daemon/runner 共 **10 workspace** 全 `build: Done` | **0** |
| `pnpm test:e2e` | `NOT_IMPLEMENTED: command test:e2e is not implemented yet; it lands with WP-09` | 1（按契约） |
| `pnpm test:acceptance` | `NOT_IMPLEMENTED: command test:acceptance is not implemented yet; it lands with WP-10` | 1（按契约） |
| `pnpm test:live` | `NOT_IMPLEMENTED: command test:live is not implemented yet; it lands with WP-10` | 1（按契约） |

命令尾部原始输出：

```text
$ pnpm typecheck
EXIT(pnpm typecheck)=0
$ pnpm lint
Checking formatting...
All matched files use Prettier code style!
EXIT(pnpm lint)=0
docs:check ok — 15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages
EXIT(pnpm docs:check)=0
apps/runner build: Done
EXIT(pnpm build)=0
 Test Files  44 passed (44)
      Tests  916 passed (916)
EXIT(pnpm test:unit)=0
 Test Files  15 passed (15)
      Tests  157 passed (157)
EXIT(pnpm test:integration)=0
```

仓库状态：

| 项 | 值 |
|---|---|
| `git rev-parse HEAD` | `96e196b4a4ac6de46d2eee38614e2813d9a37203`（= 冻结点） |
| `git rev-parse 96e196b^{tree}` | `98ff1930c8252a49124433ec9e1b124ae6d2eb15` |
| `git status --porcelain`（Test 前/后） | ` M .agentdev/work/WP-07/review.md`（第 4 轮 Review 追加，174 行新增；`git diff --stat 96e196b` 仅此一文件） |
| 代码树是否被 Test 改动 | 否（`git diff 96e196b -- .` 只含该报告文件） |
| 分支下逐文件用例数（从契约运行日志提取） | `broker.test.ts` 55、`permissions-failures.test.ts` 4、`grants.test.ts` 39、`secrets.test.ts` 27、`permission-delivery.test.ts` 20、`trust.test.ts` 14；`permissions.integration.test.ts` 11、`broker.integration.test.ts` 8、`secrets.integration.test.ts` 5、`grants.integration.test.ts` 1 |

---

## 4. 逐 AC 证据

### AC-048 Workspace 边界 —— **通过**

> Given 无Docker或目录/网络越权；When 准入/执行；Then 缺环境拒绝；容器及Broker阻止越权，源码只读者不可写。

**无 Docker 拒绝、绝不回退 host（真实 + 注入两条路径）**
- `AC-048.n1`（**真实无 Docker**）：把 `PATH` 指向空目录后调用真实 `probeDockerAvailability` → `{available:false, reason:"spawnSync docker ENOENT"}`；container 模式 `Broker.invoke` → `PROVIDER_UNAVAILABLE`，reason 原样带出并含「does not fall back to host execution」；记录的进程调用中 `docker run` **0** 次、`/bin/sh` **0** 次、`tool_operation` **0** 行。
- `AC-048.n2`（注入探测）：reason 原样透传、`fields=['mode']`、进程调用 **0** 次、零行。

**加固容器计划**
- `AC-048.p1`：`planContainerRun` 的 args 逐项含 `--read-only`、`--tmpfs /tmp:rw,noexec,nosuid,size=256m`、`--cap-drop=ALL`、`--security-opt no-new-privileges`、`--pids-limit 256`、`--memory 2g`、`--cpus 2`、`--network none`、`--user 10001:10001`、`/ws:/workspace:ro`、`/reports:/mnt/agentdev-1:rw`、镜像 `agentdev/exec:0.0.0`。

**目录越权（host + container 双模式，读 + 写）**
- `AC-048.n3.{host,container}.{read,write}`（4 例）：`src/link.txt`（符号链接指向仓库外）、`../wp07t-outside/secret.txt`、绝对路径、`src/ancestor/new-file.txt`（符号链接**祖先** + 不存在末段）**全部** `NOT_AUTHORIZED`，外部文件逐字节不变，`tool_operation` 0 行，工具体零执行。
- 对照 `AC-048.p2`：根内符号链接（指向 `src/feature.ts`）仍可读 → 规则是**包含性**而非「禁符号链接」。

**网络越权（准入前 + 每跳）**
- `AC-048.n4`：`127.0.0.1`、`10.0.0.5`、`169.254.169.254`、`[::1]`、`[::ffff:127.0.0.1]`、`[::ffff:7f00:1]`、`[64:ff9b::7f00:1]`、`[64:ff9b:1::7f00:1]`、`metadata.google.internal`、`localhost` 全部 `NOT_AUTHORIZED`；公网字面量 `93.184.216.34` 放行且携带 pin。
- `AC-048.n5`：解析到 loopback 的名字、多答案含私网的名字、不可解析的名字全部拒绝；**对私网名的 `GuardedRequester` fetcher 调用 0 次**；公网名 302 到 `169.254.169.254` 只 fetch 首跳、第二跳拒绝（`hops` 仅 1 条）。
- `AC-048.n6`：无 opt-in 的私网 `http:` 拒绝（reason 指向私网）、公网 `http://93.184.216.34/` 拒绝且 reason 含 `https is required`、`file:`/`ftp:` 拒绝、错误端口拒绝；**精确授权 + `allowInsecureHttp` 的本地端点被真实 fetch 到**（`local-hit:/authorized`，证明非空洞）。
- `AC-048.n7`：精确授权的**私网名字**放行并 pin `['10.0.0.7']`（未授权同名拒绝）；https→http 的 **302 降级**在第 2 跳拒绝且只 fetch 首跳。

**真实 Docker 容器级负例（自建，非仓库套件）**
- `AC-048.d1`：container 模式真实读 `src/feature.ts` 成功（`docker run` 实际执行）。
- `AC-048.d2`：container 模式对未声明可写的源码根写入失败（`Read-only file system`，`INTERNAL_ERROR`），源码逐字节不变。
- `AC-048.d3`：container 模式 `bash` 真实运行，`id -u` = **10001**，`touch /workspace/src/pwned.txt` 被只读 rootfs 拒绝。

**残余（非阻断）**：容器网络代理（`networkProxy`）本机未配置，未做经代理的真实出网端到端验证（承接 WP-09/WP-10）。

### AC-049 Autonomous 范围 —— **通过**

> Given 已授权Work角色/期限/目标；When 范围内外操作；Then 范围内继续，超范围权限决定；过期Grant无效。

- `AC-049.p1`：范围内 `read` 执行并返回真实文件内容；审计为 `tool_operation.state='finished'` + 有 `resultRef` + `grantId`/`inputHash` 绑定，事件流恰为 `grant.issued`、`tool.invoked`（无 `tool.refused`）。
- `AC-049.n1`：越界目标 `NOT_AUTHORIZED`（reason 点名 target），工具体零执行、零行。
- `AC-049.n2`：对只读 Grant 发起 `write` → `NOT_AUTHORIZED`，源码不变、零行。
- `AC-049.n3`：过期 Grant → `AUTH_EXPIRED`、零行。
- `AC-049.n4/n5`：错角色 / 错阶段 → `NOT_AUTHORIZED`、零行。
- `AC-049.n6`：撤权后 → `AUTH_EXPIRED`、零行。
- `AC-049.n7`：签发阶段的越界目标、未知 Run、非 Scope 操作**全部拒绝**，Grant 行数与事件数不变（零写入）。
- `AC-049.p2`：work 作用域 Grant 对同 Work 两个 Run 均可用（非空洞）。

### AC-050 Full Access 门禁 —— **通过（含 T-01/P3 残余）**

> Given 宿主开发执行；When 尝试绕Review或读验证者无权数据；Then 领域Gate保留，Review/Test仍隔离。

- `AC-050.n1.{review,test}`：host 模式持有 write Grant 也写不到源码（reason 明确「may only write inside its report/scratch root」），源码不变、零行。
- `AC-050.n2`：host 模式 review 读运行库被拒（reason 含 `inside protected root`）；`protectedRoots` = `[<dataDir>, <dataDir>/project.sqlite]`（**调用方未传 `protectedPaths`**）。
- `AC-050.n3`：container 模式同一读取在任何进程启动前拒绝（进程调用 0 次）。
- `AC-050.n4`：无 Grant 的 review 读源码 → `NOT_AUTHORIZED`。
- `AC-050.p1`：developer 真实读取成功；review 在声明的 report 根内 `write` 成功且落盘 `REPORT-BODY`，源码不变（**非空洞**）。
- `AC-050.n5/n10`：report 根之外的写、report 根内**符号链接指向源码**、`reports/../src/feature.ts` 全部拒绝，源码不变。
- `AC-050.n6`：review 的 `read` 调用体 `ctx.writeFile(source)` → `NOT_AUTHORIZED`（源码不变、零行）。
- `AC-050.n7`：review 的 `read` 调用体 `ctx.run(...)` → `NOT_AUTHORIZED`（reason 含 `cannot execute shell commands`），marker 不存在。
- `AC-050.n8`：**被准入的 report 写体**内嵌 `ctx.run(...)` 同样拒绝，marker 与 report 均未产生（第 3 轮 W7R3-01 的逃逸路径已封）。
- `AC-050.n9`：`bash`/`git`/`push`/`deploy`/未知操作对 review 全部 `NOT_AUTHORIZED`；`delete_data` 对源码目标拒绝、内置执行器空目标路径 `INVALID_STATE`，源码不变。
- `AC-050.n11`：container 模式 + 调用方 `writableRoots:[workspace]` → 真实 `docker run` 参数为 `…:/workspace:ro`，**无 `:rw`**（只读角色剥离调用方 writableRoots）。
- **残余 T-01（P3）**：只读角色 + 「路径型 mutating 操作」+ **空 targets** 时，因已配置 report 根而通过角色门禁（内置执行器仍 `INVALID_STATE`，`ToolContext` 的写/命令仍受 report 根与只读桩约束）→ 见 §5 T-01。

### AC-051 Secret 隔离 —— **通过**

> Given Provider和项目命令凭证；When 模型/工具运行；Then 只在受权用途注入，UI/Artifact/日志不含已知Secret。

- `AC-051.p1`：授权 Run 的 `environmentFor` 返回诱饵环境变量，**真实 `node` 子进程**读出 `decoy-credential-9f2c-never-in-a-payload`；宿主 `process.env` 无该变量。
- `AC-051.n1`：兄弟 Run 注入整体 `NOT_AUTHORIZED`，其子进程路径不产生任何环境（`<refused>`）；授权 Run 同刻仍可注入。
- `AC-051.n2`：过期 / 撤权 Grant 均 `AUTH_EXPIRED`。
- `AC-051.n3`：跨 audience（gateway 注册项经 tool 通道）`NOT_AUTHORIZED`；未授权者查「存在的 ref」与「不存在的 ref」得到**同一** `NOT_AUTHORIZED`（先鉴权后查，不可枚举）；`JSON.stringify(store)`、`refs()`、`list()`、`has()` 不含任何明文。
- `AC-051.n4`：扫描器在原始日志/嵌套 UI payload 命中 1/2 处，在嵌套对象+数组+**键名**+`Map`+`Set`+`Error.message/stack` 命中 6 处；`preview` 回显被遮蔽；`redact`/`redactValue` 后零命中；`grant` 行、事件流、Artifact 行、仓库文件均无明文。
- `AC-051.n5`：无任何 Grant 时 `resolve`/`environmentFor` 一律 `NOT_AUTHORIZED`。
- `AC-051.n6`：混合请求（一个已授权 + 一个未授权 ref）**整体拒绝**，不产生部分环境，且拒绝结果串不含未授权凭证值。
- **残余（已登记，非本包 AC 面）**：持久化 Secret 后端（Keychain / 0600 加密文件）与 `gatewaySecretResolver` 接线属安装范围 / WP-09；本包只验证内存 `SecretStore` 接缝（见 §7）。

### AC-053 信任与资源 —— **通过**

> Given 未信任仓库有自动加载扩展；When open/createSession；Then 不执行，Trust后也只有选择的Skill/内置资源可用。

- `AC-053.n1`（未信任，真实磁盘证明）：`readOnly=true`；`importModule` 与 `readSkillFile` 调用 **0** 次；仓库扩展模块写入的 marker 文件**不存在**；`loadedExtensions`/`loadedSkills` 为空；trace 有序（seq 1..n）、每条有理由、全部非 `loaded`（config/ext/skill 三项 `skipped`+`NOT_AUTHORIZED`）。
- `AC-053.p1`（信任后真加载）：显式选中 ∧ 发布白名单 ⇒ `importModule` 恰 1 次、marker 文件真实出现、`loadedExtensions` 含 `{origin:'repository'}`；选中的 Skill 被真实读取并加载；`refused` 为空；trace seq 连续；`path` 指向 `ext/auto.mjs`。
- `AC-053.n2`：信任但未选中 ⇒ `refused`/`NOT_AUTHORIZED(not-selected)`；仓库配置恒 `skipped`（配置不权威）；选中但不在发布白名单 ⇒ `refused`/`VALIDATION_ERROR(not-in-builtin-whitelist)`。
- `AC-053.n3`：选中的**目录内 `SKILL.md` 符号链接指向仓库外**、直接指向该符号链接文件、`..` 逃逸、绝对路径逃逸 —— 4/4 `refused`/`VALIDATION_ERROR`，`readSkillFile` **0** 次、`loadedSkills` 为空（第 1 轮 W7R1-03 的漏洞保持关闭）。
- `AC-053.n4`：选中的**目录本身**是指向仓库外的符号链接 ⇒ 零读、`refused`。
- `AC-053.n5`：空 `projectRoot` ⇒ `PiRuntimeError CONTRACT_VIOLATION`（调用方错误，不进 trace）。
- **残余（已登记）**：`loadTrustedExtensions` 尚未接入 `apps/runner`（该文件仍调用 `activateExtensions`，见 §6-C1）；AC-053 只在加载器 API 面验证。

### AC-080 授权精确绑定 —— **通过**

> Given 同Work两个同角色Run，once工具响应丢失；When 兄弟窃用run Grant或重试once；Then 兄弟拒绝；once绑定操作/输入Hash，原子消费且重试原操作返回原结果。

- `AC-080.p1`：`once` 首次 `executed`；同 `(runId, toolOperationId, inputHash)` 重试 `replayed` 且**返回原结果**、执行器计数 1、`tool_operation` 1 行。
- `AC-080.n1`：同 `toolOperationId` 不同 input ⇒ `IDEMPOTENCY_CONFLICT`、副作用仅 1 次、1 行。
- `AC-080.n2`：兄弟 Run 使用未消费的 run 级/once Grant ⇒ `NOT_AUTHORIZED`（reason `once grant belongs to another run`），兄弟工具体零执行；所有者随后成功消费。
- `AC-080.n3`：已消费 once Grant 仍覆盖**同一全绑定**查询（`checkCoverage=true`，含 operation/role/stage/toolOperationId/inputHash），对**异 operation** 为 `false`（W7R1-06 修复保持）。
- `AC-080.p2`：`work` 作用域 Grant 对两个兄弟 Run 均可用。
- `AC-080.p3`：合法 `null` 结果首次 `executed`、重试 `replayed` 且仍为 `null`（W7R2-09 修复保持）。
- `AC-080.n4`：显式注入全新内存 sink 时，重放如实抛 `ProtocolError RECOVERY_REQUIRED`（缺失路径未被掩盖）。
- `AC-080.p4`（**真实跨进程原子消费**）：6 个真实 `node` 进程（互异 pid）同时 `consumeOnce` 同一 once Grant ⇒ `executed=1 / replayed=5 / refused=0 / threw=0`，副作用文件恰 1 行。
- `AC-080.p5`：此后**新的 OS 进程**重放同一 tool operation ⇒ `replayed`、`executed=0`、结果等于原记录值、副作用仍 1 行。
- `AC-080.n5`：once 被 Run A 消费后，Run B 用**全新 toolOperationId** 再取 ⇒ 拒绝（`IDEMPOTENCY_CONFLICT`，见 `domain/permission.ts:193-197` 的已消费语义）、副作用仍 1 次、`tool_operation` 仍 1 行。

### 四个必需失败测试（`docs/delivery/implementation.md` WP-07）

仓库内逐字同名存在于 `packages/core/test/permissions-failures.test.ts`（第 345/451/503/621 行）；本轮由自建 `probe-failures.mjs` **独立复现**：

| 必需失败测试 | 独立复现结果 |
|---|---|
| **符号链接/私网/重定向** | 通过：仓库外符号链接读 `NOT_AUTHORIZED`；`169.254.169.254` 策略拒绝且 transport 调用 0 次；公网 302 → 私网字面量第 2 跳拒绝（`hops=[首跳]`） |
| **Secret 泄漏** | 通过：扫描器命中 3 处、脱敏后零命中；store JSON/list、grant 行、事件流、仓库文件均无明文；preview 不回显 |
| **进程清理失败** | 通过：注入 SIGTERM/SIGKILL 失败 + 目录删除失败 + 组仍存活 ⇒ `RECOVERY_REQUIRED`、`failures` 逐条列出（SIGTERM/SIGKILL/still alive/removing）、状态 `cleanup_failed`；控制组真实环境仍 `stopped` |
| **无 Docker 拒绝** | 通过：`PROVIDER_UNAVAILABLE`、原样原因、`fields=['mode']`、零进程、零 `tool_operation` 行、绝不回退 host |

---

## 5. Findings（本轮新增，全部 P3，非阻断）

### T-01（P3）只读角色的「路径型 mutating 操作 + 空 targets」通过角色门禁

- 位置：`packages/core/src/broker.ts:1845-1867`（角色写门禁只判能力/是否路径型/是否存在 report 根，不校验是否有可约束的 target）、`packages/core/src/broker.ts:1905-1911`（`requiresRoots` 被 `writeRoots` 满足）、`packages/core/src/broker.ts:2023-2056`（无内置执行器时才 `INVALID_STATE`）。
- 契约/AC：AC-050「Review/Test仍隔离」；`execution.md` §3 只给 Review/Test「自己报告与检查临时目录」；代码注释自述「only a mutating tool **whose whole effect is a path** can be confined to a declared report root」。
- 复现：`node /tmp/wp07t/probe-ac050.mjs` 用例 `AC-050.n9.observation-T01`（日志 `/tmp/wp07t/logs/probe-ac050.log`），另有定向脚本 `/tmp/wp07t/dbg-delete.mjs`：

  | 调用（`role:'review'`，已配置 report 根） | 观测 | 期望 |
  |---|---|---|
  | `delete_data`, `targets:['src/feature.ts']`, 带工具体 | `NOT_AUTHORIZED`（源码不变） | 同 |
  | `delete_data`, `targets:[]`, **内置**执行器 | `INVALID_STATE`、零行、fail-closed | 同 |
  | `delete_data`, `targets:[]`, **调用方工具体** | **`ADMITTED`（executed，落 1 行）** | 拒绝（没有可校验的路径，无法证明「限制在 report 根内」） |

- 观测 vs 期望：观测为「无 target 时门禁依据 `writeRoots` 非空即放行」；期望无 target 的路径型 mutating 操作对只读角色 fail-closed（或要求显式 target）。
- 影响与严重度依据：**不是可利用的越权**——(a) 角色门禁之前/之后的 `ToolContext` 仍然受限：`ctx.writeFile` 对只读角色恒以 `writableReportRoots` 为界、`ctx.run` 是 `NOT_AUTHORIZED` 桩、`ctx.readFile` 需 `roots`；(b) 内置执行器路径 fail-closed；(c) `ToolInvocation.run` 由 Core 工具层提供、仓库内 `Broker.invoke` 无生产调用点。与 Review 第 3 轮把同类「工具体通道」记 P2 的依据一致，但本条的逃逸面更窄（上下文不可越界），故记 **P3**。
- 修复方向：把「路径型」判定改为「`targets.length > 0` 且每个 target 解析后都在 report 根内」，否则对只读角色直接 `NOT_AUTHORIZED`。

### T-02（P3，记录/流程）W7R4-01 只登记在工作树 review.md，未进入 implementation.md；且第 4 轮 Review 报告未提交

- 位置：`.agentdev/work/WP-07/review.md`（工作树，第 919-926 行）与 `.agentdev/work/WP-07/implementation.md`（HEAD，T9 残余 #4）。
- 事实：`git show HEAD:.agentdev/work/WP-07/review.md` **781 行（3 轮）**，工作树 **955 行（4 轮）**；`git rev-parse HEAD:.agentdev/work/WP-07/implementation.md` = `f5b154ad…` 与工作树一致（implementation.md 未改）。`implementation.md` 中 **无** `W7R4-01` 字样，T9 残余 #4 只覆盖「并发同 toolOperationId 在 await 窗口内得到 `RECOVERY_REQUIRED`」，未覆盖「窗口不结束（悬挂/进程中断）且无 resume/补偿 API」。
- 独立复现（`probe-carry.mjs` `CARRY.stalePrepared`）：once Grant + 永不 settle 的异步体 ⇒ 80 ms 后 Grant `consumedAt` 已写、`tool_operation.state='prepared'`、执行次数 1；同 `toolOperationId` 重试 ⇒ `RECOVERY_REQUIRED`（reason「has no recorded result; the original outcome cannot be replayed」）。与 W7R4-01 的描述一致，**fail-closed**。
- 影响：不阻断（P3，行为 fail-closed），但「Test 所依据的 PASS 报告与 W7R4-01 登记只存在于未提交的工作树」属流程/追溯缺口。建议：把第 4 轮报告提交，并在 T9 残余 #4 补一句悬挂/中断情形与缺恢复入口。

### T-03（P3，可核验性）T5/T7/T9 的「突变-还原」实验仍属开发者自述

- 位置：`implementation.md:48-52`（T5 三条具名突变与失败计数）、`implementation.md:254/260/266/271`（T9 每条「突变验证」）。
- 事实：Test 不得修改源码，本轮**未**在源码上重做突变；其保护性质只由行为探针覆盖（W7R1-01/06/13、W7R3-01..05 对应的正负断言本轮全部独立复现通过）。「用例在旧行为下会失败」仍不可从仓库证据核验。
- 影响：不影响 AC 判定（行为面已独立验证），记录为可核验性残余；建议后续由 Develop 提供可复跑脚本或把突变实验改为可存档的补丁/patch。

### T-04（P3，可核验性）T8 的历史逐文件计数（broker 47 / grants 36）无法从当前树核验

- 位置：`implementation.md:240`（T8 声称本轮 +20：broker 47、grants 36）。
- 事实：当前树实测 `broker.test.ts` **55**、`grants.test.ts` **39**，与 T9 的声明（T9:297「47→55、36→39」）完全一致；T8 的历史值需要 `b1c5328` 的历史文件才能核验，本轮未 checkout 历史版本（避免污染工作树）。
- 影响：T9 与当前事实**逐项吻合**；仅历史差值不可核验，不阻断。

### 已登记、按记录接受、不计为缺陷的边界（供结算参考）

- **硬链接（W7R1-08）**：`probe-carry.mjs` `CARRY.hardlink` 观测到根内硬链接可读出根外 inode 内容（`resolvedInsideRoot=true`、`contentReadThroughHardLink='OUTSIDE-THE-WORKSPACE\n'`）；`broker.ts` 注释与 T7 残余均明确「路径包含性规则、非 inode 规则、不声称阻断」，`execution.md` §3 只承诺拒绝相对路径/符号链接/嵌套仓库逃逸，**无 AC 覆盖** → 记录为已知限制，不阻断。
- **transport pin 是 fetcher 契约（T8 残余 #1）**：`CARRY.transportPin` 证明注入 fetcher **收到** `pinnedAddresses=['93.184.216.34']`，内建传输经 pin 真实连到本机服务器；Broker 无法强制调用方 fetcher 兑现该 pin —— 与登记一致，不阻断。
- **离线 GC / 清单布局（W7R2-04/10）**：`CARRY.results` 证明 `blobs.collectGarbage(new Set())` 删除 0 项、结果仍可重放、40 次 `put` 生成 40 个独立文件且无共享 `index.json`；`CARRY.legacyManifest` 证明旧 `deferred-results/index.json` 布局仍可解析且其清单/blob 已进入 GC 引用根。
- **持久 Secret 后端（T6 残余 #7）**：`CARRY.durableSecret` 证明 `secrets.ts` 无任何文件系统后端（内存实现）、`dataDir` 内无任何文件含明文、登记在案。

---

## 6. 记录对账（implementation.md / review.md ↔ 代码与事实）

- **C1（承接项登记确认）**：task 要求确认的 T5..T9 承接项**均已登记**且本轮逐项核验：
  1. `loadTrustedExtensions` 未接线（T6 残余 #8）：`apps/runner/src/attempt.ts` 有 2 处 `activateExtensions`、0 处 `loadTrustedExtensions`；`apps/**` 无任何生产文件引用该加载器 → AC-053 只在加载器 API 面成立（§7）。
  2. 持久 Secret 后端（T6 残余 #7）：存在且如实（内存实现 + 安装范围承接）。
  3. GC / 清单布局（T7 残余 #6 → W7R2-10 关闭）：已实现 `deferredResultGcRoots`/`collectProjectGarbage` 与 per-ref 布局，行为实测通过。
  4. 延迟结果增长（W7R2-10）：无共享清单、线性文件数，实测通过。
  5. 硬链接（T7 残余 #1 / W7R1-08）：如实登记为不可阻断的已知限制。
  6. 容器级逐例负例（Review 第 4 轮覆盖限制 #4）：本轮自建 4 条真实 Docker 负例（AC-048.d1/d2/d3、AC-050.n11）**关闭该覆盖限制**。
  7. transport pin 作为 fetcher 契约（T8 残余 #1）：如实登记并实测（注入 fetcher 收到 pin，内建传输兑现）。
- **C2（数字对账）**：`pnpm test:unit` 44/916、`pnpm test:integration` 15/157、`pnpm build` 10 workspace 与 `implementation.md` T9 及 Review 第 4 轮声明**逐项一致**；逐文件用例数（broker 55、grants 39、secrets 27、failures 4、permission-delivery 20、trust 14、permissions.integration 11、broker.integration 8、secrets.integration 5、grants.integration 1）与 T9 记录一致。
- **C3（未发现夸大）**：本轮未发现「未实现却声明已实现」；发现的是 1 条边界缺口（T-01）与记录/可核验性问题（T-02..T-04）。Review 第 4 轮把 W7R3-01..05 关闭并声明「可以进入独立 Test」，与本轮独立复现一致。
- **R1（冻结点一致性）**：`HEAD = 96e196b`、`96e196b^{tree} = 98ff1930`，与 task 及 Review 第 4 轮一致；工作树唯一差异是 Review 第 4 轮追加的 174 行（`git diff --stat 96e196b` 仅 `review.md`）。代码树未被 Test 改动。

---

## 7. 未覆盖与剩余风险

| 项 | 状态 | 原因 | 承接 |
|---|---|---|---|
| 真实 DNS / 真实出网 | 未覆盖 | 全部网络探针离线（桩 `HostResolver` + 桩/本机 fetcher），确定性优先 | 发布回归 WP-10 |
| 容器网络代理（`networkProxy`）经代理真实出网 | 未覆盖 | 本机未配置 Core 代理 | WP-09 / WP-10 |
| 持久化 Secret 后端（Keychain / 0600 加密文件 + 备份导出） | 未覆盖 | `secrets.ts` 明确为内存实现，属安装/部署范围 | 安装范围 / WP-08 |
| `gatewaySecretResolver` 接入 Model Gateway | 未覆盖 | 属 WP-09 接线 | WP-09 |
| AC-053 经真实 session 创建路径 | 未覆盖 | `loadTrustedExtensions` 未接入 `apps/runner`（T6 残余 #8） | WP-08 / runner 接线 |
| 真实模型 / Provider 调用 | 未覆盖 | 非本包范围 | WP-10 |
| Linux `/proc` 端口归属分支 | 未覆盖 | 宿主为 macOS（`listeningProcess` 走 `lsof`）；真实环境启动/清理控制组在本机执行 | WP-10（Linux CI） |
| 跨主机 / 分布式并发、长时压测、SQLite `busy_timeout` 超时路径 | 未覆盖 | 单机 6 进程并发已覆盖「只执行一次 + 可重放」 | WP-08 |
| 源码级「突变-还原」重做 | 未覆盖 | Test 不得改源码（T-03） | Develop 提供可复跑补丁 |
| `pnpm test:e2e` / `test:acceptance` / `test:live` | 未覆盖（按设计） | 契约函数返回 `NOT_IMPLEMENTED`（WP-09/WP-10） | WP-09 / WP-10 |
| `Broker.invoke` 无生产调用点 | 限制 | 仓库内仅测试调用；端到端接线后仍需回归 | WP-08/WP-09 + WP-10 |

对 AC 判定的影响：以上项均位于**包外接线/环境**层；AC-048/049/050/051/053/080 的**行为面**已在本包公共 API + 真实 SQLite/子进程/Docker 上以正负例覆盖并通过。因此「未覆盖」不降低本轮 AC 判定，但 AC-053 与 AC-051 的最终端到端承诺需在接线后由 WP-10 复验。

---

## 8. 结论

- **AC-048 通过**：无 Docker 拒绝且绝不回退 host（真实 + 注入）、容器计划加固、符号链接/`..`/绝对/符号链接祖先逃逸在 host+container 双模式双读写 8 例全拒、私网/mapped IPv6/NAT64/DNS/重定向每跳/scheme 全拒（含精确授权私网与 https→http 降级）、真实 Docker 三条容器级负例。
- **AC-049 通过**：范围内执行并审计；越界/错操作/过期/错角色/错阶段/撤权六类拒绝且零副作用；签发越界零写入。
- **AC-050 通过**：host 与 container 下 review/test 对源码、运行库、report 根之外、工具体写/命令通道全部隔离；report 根内写放行且源码只读；容器 `writableRoots` 对只读角色剥离。残余 **T-01（P3）**。
- **AC-051 通过**：诱饵仅到达授权 Run（真实子进程），兄弟/过期/撤权/跨 audience/未授权 ref/混合请求全部拒绝；日志、Artifact、UI、grant 行、事件流、store JSON、宿主环境零泄漏；扫描与脱敏非空洞。
- **AC-053 通过**：未信任零 import/零读/零采纳（marker 与调用计数双向证明）；信任后仅「显式选中 ∧ 发布白名单」加载；路径/符号链接逃逸零读并带 trace。
- **AC-080 通过**：once 全绑定、原子消费（6 个真实进程只执行一次）、同输入幂等重放（含 `null`、跨进程）、异输入/异操作/兄弟 Run 拒绝、work 作用域双 Run 可用。
- 计数：**6/6 AC 通过**；契约命令 **6/6 退出 0**（unit 44/916、integration 15/157 含真实 Docker）；四个必需失败测试 **4/4 通过**；自建探针 **72 条断言通过、0 条失败**；未发现 P0/P1；新增 4 条 P3（T-01 实现边界，T-02..T-04 记录/可核验性），均不阻断，建议随结算或后续工作包处理。
- 未读取任何开发/Review 会话；未修改仓库源码或测试；唯一写入为本报告。

**Test 判定：PASS —— 接受 WP-07 的 AC-048、AC-049、AC-050、AC-051、AC-053、AC-080。**
