# WP-07 独立 Review 报告（权限、工具和测试环境）

## 0. 元数据与冻结点

| 项 | 值 |
|---|---|
| 冻结点（task 指定） | `45cd1b3` |
| `git rev-parse HEAD` | `45cd1b32fc36b49fe52bebcb78a660ca6400e2ed`（`45cd1b3`） |
| `git rev-parse 45cd1b3^{tree}` | `170200bc521ed283b81b6336e75e4b19d61a2ed6` |
| `git status --porcelain`（报告写入前） | 空（工作树干净；`pnpm build` 的 `dist` 为 gitignore 产物，未污染） |
| Review 写入范围 | 仅 `.agentdev/work/WP-07/review.md`；所有探针与日志在 `/tmp/wp07r/` |
| 开发/Test 聊天 | 未读取；证据仅来自仓库文件、`dist` 构建产物与本次独立探针 |
| Docker | 守护进程 **UP**；执行镜像 `agentdev/exec:0.0.0`（`edd3aa5051c7`）在位；`pnpm test:integration` 真实容器用例实际执行（无 skip） |
| 探针宿主 | macOS arm64 / Node 24.8.0（无 `/proc`，相关逃逸按绝对路径通用规则覆盖） |

被审文件 Hash（`git hash-object` = 仓库 blob SHA-1；`shasum -a 256` = 工作树字节）：

| 文件 | git blob | sha256 |
|---|---|---|
| `packages/core/src/grants.ts` | `541ec0e330d1b4093cc5558b988795aae7b05a30` | `fd17b15115e5658fc8146c6d86cac4c3003af8fd86a666b168289a5e0f771e73` |
| `packages/core/src/secrets.ts` | `d574ac952aa4ca7a3bdf6d9bb92eff6484091ffa` | `316ad9a65f5c7d4806cf1bff0ff606c233ee5e8abc87d176d3a5261eb788e6d9` |
| `packages/core/src/broker.ts` | `65ca08993fddd0c6e0288a80d3cf3fb54f1d8a61` | `9652c80966d36256deff632f902170ceb34a5a13cb20225db360ae31f4946902` |
| `packages/core/src/test-environment.ts` | `3ea934da1ed30bad7df2384614dfc922aff7dd9d` | `964133c6c26537eb2e4a3d0264c29cfe7475d2f619f5fa6a533d5c8904360f03` |
| `packages/domain/src/permission.ts` | `d7cfeeeb4ddaee123fd94297cd8779fdd357ae11` | `b95b2872cf72abeba08cba4e5c38968a655e92782e9fe7801f42c3dfdf73d1c8` |
| `packages/pi-runtime/src/extensions.ts` | `ddcad9b860d40c9468c9d0a233d3683de83e1f8b` | `6ad0f4556ce77ef1c8451aaf1e0739c252bb46853900af55b034f369a83c6a41` |
| `packages/core/test/permissions-failures.test.ts` | `f98e6855b586b4430ab4b631ac564baa1bbf1f94` | `5242df5c015db5ba6c10e82a3ebe7e09dc7930869c5c4a827e31dcff9aafc78f` |
| `packages/core/test/permissions.integration.test.ts` | `4f0e94317f0e6c3efa119a311249792bc8790e31` | `c1b28efbb10a790f6e80ff61ff82d91200a4ee70285b574cfe3e0b6a095db2c3` |
| `packages/core/test/grants.test.ts` | `1c6e0d6851039437df7650a7d39dd810eb4e4309` | `cf42e6981f08882b1b7682c2a392daa38fc238a9413e1945e43265eb373b1e59` |
| `packages/core/test/secrets.test.ts` | `64e956f0cee4ad0aba8a317825b1bfc673576da7` | `c5f5e24109271964991905176bbad6da4cf2a5e998595584e1e41743e4e40b46` |
| `packages/core/test/broker.test.ts` | `b1032ee2c578c0865a734fa2a0501594146f6caf` | `8bf530271efeb74812497500f807f8af78a8ee4ed5594c110745c89a8efce753` |
| `packages/core/test/secrets.integration.test.ts` | `4ba7976e87bf412d92494961f651e9ad7d80e5fb` | `966ff26544b9fb084a3c64656735b89bef10c089be9e1299868537b71e5ead23` |
| `packages/core/test/broker.integration.test.ts` | `02f20f6bc1e61e26038f9689b9bd14a66d583370` | `12f0109ec23dfa4fa705c2b9375f101cc3af79a16b06494978ba85b88fc791ac` |
| `packages/domain/test/permission-delivery.test.ts` | `d7b67ae1a596ba110c9bd2bf1d1d98587fd0fee6` | `cc75be1190d21b79bbadc11551927ec9382c534ed8ee530f24ba4b4439f9c26b` |
| `packages/pi-runtime/test/trust.test.ts` | `e5a727e5b42a0cfabbd16f12ee9e5029b68195df` | `b12d0c956b937007a61558668de6261034631c2569424f70a4ce5f518a778637` |
| 依赖件 `packages/core/src/{auth,run-lifecycle,dispatcher}.ts`、`packages/storage/src/schema.ts`、`packages/contracts/src/errors.ts`、`apps/cli/src/doctor.ts` | 见 §7 附注（未改动） | — |

## 1. 结论（verdict）

**FAIL** —— 在 WP-07 的包验收面（`packages/core` 的 `Broker`/`GrantStore`/`SecretStore`/`TestEnvironmentManager` 公共 API + `packages/domain` 的 Grant 判定 + `packages/pi-runtime` 的信任加载器 + 真实 SQLite/真实子进程/真实 Docker）上复现出 **3 个 P1**：

- **W7R1-01（P1）** 私网/loopback 边界只按**字面量**判定，从不解析 DNS；一个解析到 `127.0.0.1` 的域名（`localtest.me`）被判定为公网，真实 `fetch` 实际打到了本机监听端口，302 重定向链同样被打通。违反 `execution.md` §4「校验…DNS解析后的目标IP…重定向每跳重验」与 AC-048。
- **W7R1-02（P1）** IPv4-mapped IPv6 在 URL 中被 WHATWG 规范化成 `::ffff:7f00:1`，而 `isPrivateIpv6` 的 mapped 分支只匹配点分四段写法，导致 `http://[::ffff:127.0.0.1]/`、`http://[::ffff:7f00:1]/` 等 loopback/私网字面量被放行。违反 AC-048。
- **W7R1-03（P1）** 信任后的 Skill 加载：选中**目录**时 `resolveSkillDocument` 直接拼接 `SKILL.md` 而不再做 realpath 与包含性校验，一个 `SKILL.md` 符号链接指向仓库外时会被真实读取并以 `loaded` 记入 trace（无拒绝、无逃逸审计）。违反 AC-053 的「path/symlink escapes are refused with an auditable trace entry per decision」。

另有 **4 个 P2、6 个 P3**（非阻断但真实，见 §5）。

**能否进入独立 Test：否。** 必须返回 Develop 修复 P1（建议同批处理 P2），修复后重新走独立 Review。

## 2. 契约命令原始结果

| 命令 | 原始结果 | 结论 |
|---|---|---|
| `pnpm typecheck` | `tsc -p tsconfig.json --pretty false`；`TYPECHECK_EXIT=0` | 通过 |
| `pnpm lint` | `node scripts/lint.mjs`；`Checking formatting... All matched files use Prettier code style!`；`LINT_EXIT=0` | 通过 |
| `pnpm test:unit` | `Test Files 44 passed (44)` / `Tests 872 passed (872)` / Duration 11.19s；`UNIT_EXIT=0` | 通过（与 implementation.md T6 的 44/872 一致） |
| `pnpm test:integration` | `Test Files 14 passed (14)` / `Tests 152 passed (152)` / Duration 21.99s；`INTEGRATION_EXIT=0`；容器用例真实执行（如 `✓ runs a container read through Docker and reports the real non-root account 5264ms`、`✓ drops every Linux capability`、`✓ has no network access but a working name resolver`、`✓ applies the pid and memory limits`），无 skip | 通过（与 T6 的 14/152 一致） |
| `pnpm docs:check` | `docs:check ok — 15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages`；`DOCS_EXIT=0` | 通过 |
| `pnpm build` | `pnpm -r build`：contracts/pi-runtime/domain/knowledge/storage/workspace/core/cli/daemon/runner 共 10 workspace 全 `Done`；`BUILD_EXIT=0` | 通过（10 workspace 与 T6 一致） |

原始日志：`/tmp/wp07r/cmd_typelint.log`、`/tmp/wp07r/cmd_rest.log`。

命令尾部原始输出：

```
$ pnpm typecheck
TYPECHECK_EXIT=0
$ pnpm lint
Checking formatting...
All matched files use Prettier code style!
LINT_EXIT=0
 Test Files  44 passed (44)
      Tests  872 passed (872)
UNIT_EXIT=0
 Test Files  14 passed (14)
      Tests  152 passed (152)
INTEGRATION_EXIT=0
docs:check ok — 15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages
DOCS_EXIT=0
apps/runner build: Done
BUILD_EXIT=0
```

## 3. 方法（每个脚本与用例数）

全部探针消费**已构建产物**（`packages/*/dist/index.js` 绝对路径导入），不 import 任何产品测试文件；真实 SQLite、真实 `node` 子进程、真实临时仓库、真实符号链接、真实 HTTP 监听（Docker 仅在包自带集成测试与计划断言层面使用）。脚本与日志位于 `/tmp/wp07r/`，汇总运行脚本 `/tmp/wp07r/run-all.sh`，全量日志 `/tmp/wp07r/logs/all.log`。

| 脚本 | 用例数 | 覆盖 |
|---|---|---|
| `probe-ac049.mjs` | 9 | 范围正例+审计；越界目标/越界操作/过期/错角色/错阶段/撤权；签发越界与未知 Run 零写入 |
| `probe-ac080.mjs` | 7 | once 一次性执行与重放、异 inputHash 拒绝、操作绑定、兄弟 Run（未消费/已消费）、work 作用域双 Run 可用、8 进程并发双消费 |
| `lib/consume-worker.mjs` | 8 子进程 | 跨进程并发消费真实 `GrantStore.consumeOnce` |
| `probe-ac048.mjs` | 13 | 真实无 Docker 探测与注入探测拒绝（无 host 回退）、符号链接/`..`/绝对路径/符号链接祖先+不存在文件 在 host+container 两模式共 8 例、根内路径放行、容器计划加固 |
| `probe-ac050.mjs` | 9 | review/test host 写入拒绝、run 库读取（无 Grant/有 Grant）、`protectedPaths` 生效、host 模式 Grant 与越界仍生效 |
| `probe-ac051.mjs` | 8 | 授权子进程真实拿到诱饵、兄弟/过期/跨 audience/未授权 ref 拒绝、日志/Artifact/UI/Grant/Store JSON/事件无泄漏、嵌套对象/数组/Map/Set/键名/Error 检出与脱敏 |
| `probe-ac053.mjs` | 8 | 未信任不执行（marker+import/read 探针零调用）、信任后仅选中+白名单执行（marker 证明）、未选中/未发布/配置项拒绝、`..` 与符号链接逃逸、trace 有序且带原因 |
| `probe-failures.mjs` | 4 | 四个必需失败测试的独立复现（标题逐字同名） |
| `probe-falsify.mjs` | 16 | 网络（字面量、IPv4-mapped IPv6、DNS、真实 fetch、重定向、scheme、userinfo、精确授权）、文件（硬链接、根内符号链接正例）、测试环境（占用端口、跨 manager 端口复用、DB 隔离）、容器回退 |
| `probe-extra.mjs` | 3 | Skill 文档符号链接逃逸、`findGrantFor`/`checkCoverage` 重放分支 |

合计 **77 个用例**；其中 13 个「按契约断言、如实记录反例」的失败即 §5 的缺陷证据（其余 64 例通过）。

## 4. 逐 AC 结论

| AC | 结论 | 依据 |
|---|---|---|
| **AC-048 Workspace 边界** | **不通过** | 通过：无 Docker 时容器模式以 `PROVIDER_UNAVAILABLE` 拒绝且原样带出探测原因、绝不回退 host（真实 `PATH` 抽掉 docker 与注入探针两例均无进程启动、无 `tool_operation` 行）；符号链接/`..`/绝对路径/符号链接祖先+不存在文件在 host 与 container 两模式共 8 例全部 `NOT_AUTHORIZED` 且零执行；容器计划含 `--read-only`、`--tmpfs /tmp:rw,noexec,nosuid,size=256m`、`--cap-drop=ALL`、`no-new-privileges`、`--pids-limit 256`、`--memory 2g`、`--cpus 2`、`--user 10001:10001`、挂载 `:ro`、默认 `--network none`；仓库自带集成测试在真实容器验证只读 rootfs/cap-drop/非 root/无网络/pid+内存。**不通过点**：私网边界被 W7R1-01（DNS 名）与 W7R1-02（IPv4-mapped IPv6）绕过；`http:` 被接受（W7R1-07） |
| **AC-049 Autonomous 范围** | **通过** | 范围内调用执行并审计（`tool_operation` finished + `grant.issued`/`tool.invoked`，且只有这两条事件）；越界目标、越界操作、过期 Grant、错角色、错阶段、撤权 Grant 均带契约码拒绝且零执行/零行/零文件改动；签发阶段越界目标与未知 Run 也零写入。查询面缺陷另记 W7R1-06（不影响消费路径） |
| **AC-050 Full Access 门禁** | **不通过** | 通过：host 模式下 review/test 的写操作被角色门禁拒绝（`fields=['role']`、源文件逐字节不变、不留行）；无 Grant 时 review 读不到源与运行库；developer 无 Grant 被拒、有 Grant 放行；越界写目标被拒；`protectedPaths` 接通后在 host/container 均拒绝。**不通过点**：运行库默认**不受结构保护**——只要签发一张覆盖 `dev.sqlite` 的 review Grant（Work scope 含该路径即可签发），host 模式即真实读出 `SQLITE-RUN-DB`（W7R1-04） |
| **AC-051 Secret 隔离** | **通过** | 诱饵经真实 `node` 子进程送达授权 Run；兄弟 Run 注入整体拒绝且其真实子进程环境无诱饵；过期 Grant `AUTH_EXPIRED`、跨 audience `NOT_AUTHORIZED`、未授权 ref 不可枚举（先鉴权后 `NOT_FOUND`）；诱饵不在日志、Artifact 行、UI payload、grant 行、事件流、`JSON.stringify(store)`/`list()`/`refs()` 中，host 环境与仓库文件亦无；扫描器在嵌套对象/数组/Map/Set/泄漏键名/Error.message+stack/日志行全部命中且 preview 不回显明文，脱敏后零命中（非空真） |
| **AC-053 信任与资源** | **不通过** | 通过：未信任仓库的自动加载模块不 import（注入 import/read 探针零调用 + marker 文件不存在）、配置项不采纳、选中 Skill 不读取；信任后仅「显式选中 ∧ 发布白名单」的仓库扩展 import（marker 证明）并被加载，未选中项被拒、未发布项 `VALIDATION_ERROR`、`..` 与**文件**符号链接逃逸被拒；trace 有序（seq 1..n）、每条带原因。**不通过点**：选中**目录**内 `SKILL.md` 为符号链接指向仓库外时被真实读取并记 `loaded`（W7R1-03） |
| **AC-080 授权精确绑定** | **通过**（本进程消费路径） | once 绑定 operation+`(runId, toolOperationId, inputHash)`：首次执行一次、同输入重试 `replayed` 返回原结果且执行器计数=1、异 inputHash `IDEMPOTENCY_CONFLICT` 且副作用仅一次、异操作拒绝；兄弟 Run 对未消费与已消费 once/run Grant 均被拒且拿不到结果；work 作用域两 Run 均可用；8 个真实进程并发抢同一 once Grant 只执行 1 次（`BEGIN IMMEDIATE` 串行 + 守卫 UPDATE 行数）。跨进程「重放原结果」需持久 result store（W7R1-10，残余）；查询面 W7R1-06 |

### 四个必需失败测试（`docs/delivery/implementation.md` WP-07）现实性与复现

| 必需失败测试 | 仓库内是否命名存在 | 独立复现 |
|---|---|---|
| 符号链接/私网/重定向 | 是，`packages/core/test/permissions-failures.test.ts` 标题逐字命名 | 通过（符号链接读写拒绝且外部文件不变；loopback 字面量策略拒绝且不 fetch；公网→私网 302 第二跳被拒、hops=[true,false]） |
| Secret 泄漏 | 是，同上 | 通过（检出≥3 处、脱敏后零命中、store JSON/list 不含明文） |
| 进程清理失败 | 是，同上 | 通过（`RECOVERY_REQUIRED` + SIGTERM/SIGKILL/仍存活/删目录 四类失败全列出、状态 `cleanup_failed`；真实环境仍能正常清理） |
| 无 Docker 拒绝 | 是，同上 | 通过（`PROVIDER_UNAVAILABLE`、原样原因、`fields=['mode']`、零进程、零行、计划仍加固） |

## 5. Findings

### W7R1-01（P1）私网边界不解析 DNS，解析到 loopback/私网的域名被放行

- 位置：`packages/core/src/broker.ts:409-425`（`isPrivateAddress`）、`packages/core/src/broker.ts:531-539`（`decide`）、`packages/core/src/broker.ts:594-666`（`GuardedRequester`）
- 契约/AC：`docs/architecture/execution.md` §4「校验scheme=https、**DNS解析后的目标IP**、重定向每跳重验，禁止默认访问loopback/私网/metadata」；AC-048。
- 复现：`node /tmp/wp07r/probe-falsify.mjs`（用例 3/4/5），日志 `/tmp/wp07r/logs/probe-falsify.log`。
  - `checkUrl('http://localtest.me/')` → `{"ok":true}`（本机解析 `localtest.me → 127.0.0.1`）。
  - 真实 `GuardedRequester`（默认 `fetch`）请求 `http://localtest.me:<port>/private` → `ok:true, status:200, body:"loopback-payload:/private"`，`hops=[{allowed:true}]`——请求真的打到了 127.0.0.1 上的监听器。
  - 302 链：`http://localtest.me:<port>/start` → Location 指向 `http://localtest.me:<port>/private` → 被跟随，`hops` 两跳均 `allowed:true`，返回 `private-payload`。
- 观测 vs 期望：观测为放行并真实出网到 loopback；期望在准入与每一跳前 `NOT_AUTHORIZED` 拒绝、不发出请求。
- 修复方向：每跳 fetch 前对 hostname 做 `dns.lookup(..., {all:true})`，对**全部**解析地址套用私网分类，并把连接钉在已校验的地址上（避免 TOCTOU）；无法分类的域名按不透明处理（保守拒绝），或要求显式 target 授权。

### W7R1-02（P1）IPv4-mapped IPv6 字面量绕过私网判定

- 位置：`packages/core/src/broker.ts:439-449`（`isPrivateIpv6`）
- 契约/AC：`execution.md` §4（禁止默认访问 loopback/私网）；AC-048。
- 复现：`/tmp/wp07r/probe-falsify.mjs` 用例 1/2。
  - `new URL('http://[::ffff:127.0.0.1]/').hostname === '[::ffff:7f00:1]'`（WHATWG 规范化）；`isIP('::ffff:7f00:1')===6`，但 mapped 分支只匹配点分四段，`fe8/fc/fd` 前缀均不匹配 ⇒ `isPrivateAddress('::ffff:7f00:1')===false`。
  - `checkUrl('http://[::ffff:7f00:1]/')` 与 `checkUrl('http://[::ffff:127.0.0.1]/')` 均 `{"ok":true}`。
- 观测 vs 期望：观测放行 loopback；期望拒绝。影响面覆盖所有 `::ffff:0:0/96` 映射写法（含私网 `::ffff:a00:1`）。
- 修复方向：把 IPv6 展开为 16 字节后按数值区间分类（含 `::ffff:0:0/96`、`64:ff9b::/96` NAT64 等），不要依赖字符串前缀。

### W7R1-03（P1）信任后 Skill 文档符号链接逃逸：仓库外 `SKILL.md` 被读取并记为 loaded

- 位置：`packages/pi-runtime/src/extensions.ts:518`（调用 `resolveSkillDocument`）、`packages/pi-runtime/src/extensions.ts:634-643`（目录直接 `join(path,'SKILL.md')` 且无 realpath/包含性复检）、`packages/pi-runtime/src/extensions.ts:531-543`（真实读取并记 `loaded`）
- 契约/AC：AC-053「path/symlink escapes are refused with an auditable trace entry per decision」；`execution.md` §3 符号链接逃逸拒绝。
- 复现：`node /tmp/wp07r/probe-extra.mjs`（用例 1）。
  - 观测：`loadedSkills=[{"name":"outside-secret-skill",...}]`，trace 为 `{"kind":"skill","decision":"loaded","code":undefined,"reason":"trusted-project: skill was explicitly selected"}`，`path` 是符号链接本身而非其目标；仓库外文件内容被真实读取进 Skill。
  - 对比：把技能路径直接指向符号链接**文件**时被正确拒绝（`skill-unreadable: the skill resolves outside the allowed roots`），说明校验只覆盖了最终路径本身，漏掉「目录 + 文档」这一跳。
- 期望：读取前对最终文档 realpath 后复检包含性，逃逸以 `refused/VALIDATION_ERROR(path-escape)` 入 trace 且零读取。
- 修复方向：`resolveSkillDocument` 返回后再 `canonicalize` 并检查 `canonicalSkillRoots`；对目录内文档同样应用 `isInside`。

### W7R1-04（P2）运行数据库默认不受保护：验证者角色的受权 Grant 可直接读运行库

- 位置：`packages/core/src/broker.ts:904`（`protectedPaths` 默认 `[]`）、`packages/core/src/broker.ts:368-375`（仅对调用方传入的 protected 根生效，且以 `canonicalExisting` 相对 `process.cwd()` 解析）
- 契约/AC：AC-050「读验证者无权数据（例如运行库）…Review/Test仍隔离」；`execution.md` §3「运行数据库、其他Session/Transcript、全局SecretStore不挂载到Agent或工具」。
- 复现：`node /tmp/wp07r/probe-ac050.mjs` 用例 4。
  - 观测：签发 `role=review, stage=review, operation=read, targets=['dev.sqlite']` 的 run Grant 成功（`grant issuance => "read"`），随后 `Broker.invoke` **ADMITTED**，`result="SQLITE-RUN-DB\n"`，并落 `tool_operation` finished 行。
  - 对照：传入 `protectedPaths:[<abs>/dev.sqlite]` 后 host/container 均拒绝（用例 5 通过）。
- 期望：运行库（以及本项目 DB/transcript/secret store）对任何角色默认不可读；`protectedPaths` 只是额外收紧而非唯一防线。
- 修复方向：Core 侧推导默认保护集合（项目 DB、blob 根、其他 Session/Transcript），要求绝对路径或相对 `codeRoot` 解析，并在 `Broker` 构造时强制注入；验证者对 protected 根一律拒绝。

### W7R1-05（P2）端口分配不探测 OS、就绪判定不校验归属：可把外部监听器当成自己的测试环境

- 位置：`packages/core/src/test-environment.ts:507-515`（`allocatePort` 只跳过 `reserved` 与本 manager 的 `usedPorts`）、`packages/core/src/test-environment.ts:544-569`（`waitForPort` 只要端口可连即 `ok`）
- 契约/AC：`execution.md` §5「服务端口由Supervisor动态分配…清理端口/容器/临时DB」；WP-07 输出「隔离DB/端口」。
- 复现：`node /tmp/wp07r/probe-falsify.mjs` 用例 12/12b。
  - 用例 12：`create({portRange:{min:occupied,max:occupied}})` 把 OS 已占用端口发给环境；`start` 返回 `state:"running"`；700ms 后 `childAlive=false` 且 `portOwner="decoy"`——环境自己的命令已死，却报告就绪。
  - 用例 12b：manager A 真实运行在 4690，manager B 也拿到 4690，`start` 报 running，`portOwner="a"`（B 的「就绪」环境实际是 A 的监听器）。
  - 用例 13：两个 manager 均分配 4600。
- 期望：端口分配前探测 OS 空闲；就绪必须属于本环境启动的子进程，否则 `INVALID_STATE/PROVIDER_UNAVAILABLE`，绝不报告 running。
- 修复方向：以「绑定 0 端口或显式探测」取得空闲端口并跨 manager 共享注册；就绪阶段校验端口属主（例如要求子进程在私有通道回报，或比对 `lsof`/socket inode），避免跨 Attempt 复用与假就绪。

### W7R1-06（P2）`findGrantFor`/`checkCoverage` 把已消费 once Grant 报成覆盖了不同 operation/role/stage

- 位置：`packages/domain/src/permission.ts:162-175`（replay 分支未比较 `role`/`stage`/`operation`）、`packages/core/src/grants.ts:419-427`（`matchingGrants` 仅按 `work_id` 过滤后再交给 `evaluateGrant`）；被 `packages/core/src/broker.ts:1268-1286`（`networkCovered`）使用
- 契约/AC：AC-049/AC-080 的全绑定准入（「全匹配后才准入」）；`data.md` §2 grant 全字段匹配。
- 复现：`node /tmp/wp07r/probe-extra.mjs`（用例 2）。观测：消费一张 `operation='secret'` 的 once Grant 后，`checkCoverage(operation:'read', role:'backend')` → `true`，`checkCoverage(operation:'secret', role:'review')` → `true`，`stage:'review'` → `true`；用例 3 说明同一绑定下的重放判定是正确的（`true`），即缺陷只在 replay 分支漏比较。
- 期望：不同 operation/role/stage 一律 `false`（消费路径本身安全，因为 `boundGrant` 已预过滤，但查询面与 `networkCovered` 的预判被污染）。
- 修复方向：replay 分支补齐 `role`/`stage`/`operation` 相等比较（或在 `matchingGrants` 中先按三者过滤）；`networkCovered` 应要求精确 operation 与 `limits.network`。

### W7R1-07（P2）网络策略接受明文 `http:`

- 位置：`packages/core/src/broker.ts:515-521`
- 契约：`execution.md` §4「校验scheme=https」。
- 复现：`checkUrl('http://example.com/')` → `{"ok":true}`。
- 修复方向：默认仅 `https:`；确需明文时要求针对精确目标的显式授权并在 Grant `limits` 中记录。

### W7R1-08（P3）根内硬链接可读取根外内容

- 位置：`packages/core/src/broker.ts:296-377`（仅字符串/realpath 路径限定）
- 复现：`probe-falsify.mjs` 用例 9。`linkSync(outside/secret.txt, workspace/hardlink.txt)` 后 Broker 读 `hardlink.txt` 返回 `"outside-the-workspace\n"`。
- 说明：硬链接不是路径逃逸（inode 确实在根内，且创建硬链接需要先具备写权），任何基于路径的包含性检查都无法识别；`execution.md` §3 只承诺拒绝相对路径/符号链接/嵌套仓库逃逸，无对应 AC 条款。记录为已知限制，不阻断。
- 修复方向（纵深）：读写统一 `O_NOFOLLOW`，对可写目标做 `stat.nlink>1` 诊断；限制工具层的链接创建（`ln`）为显式授权操作。

### W7R1-09（P3）容器写入的 here-doc 分隔符可被内容逃逸为容器内命令

- 位置：`packages/core/src/broker.ts:1235-1249`（`containerWrite`）
- 复现：构造 `content` 含单独一行 `AGENTDEV_EOF` 即可提前结束 here-doc（未在测试覆盖；implementation.md 残余 #4 自认）。
- 影响：仅容器内（只读 rootfs、cap-drop、无网络），影响有限。
- 修复方向：内容 base64 编码后 `base64 -d > file`，或改用 `docker cp`/`exec` 传文件。

### W7R1-10（P3）跨进程并发只有「执行一次」成立；「重放原结果」依赖尚未接线的持久 result store

- 位置：`packages/core/src/grants.ts:723-766`（`replay`/`replayOperation`）、`packages/core/src/grants.ts:174-186`（`InMemoryDeferredResultStore`）
- 复现：`probe-ac080.mjs` 并发用例（8 个真实进程，各自打开同一 SQLite）。观测 `executed=1 replayed=0 threw=7 effectLines=1`，7 个失败者均为 `RECOVERY_REQUIRED: tool operation ... references result ..., which the result store cannot resolve`。
- 契约/记录差异：`implementation.md:14` 称并发双消费「只有一次执行、**一次重放**」，该描述只在共享持久 result store 接线后成立；仓库自带并发用例（`packages/core/test/grants.test.ts:967-1030`）用 worker 线程第二条连接只断言 `changes=0`，从未走真实 `consumeOnce` 的重放路径。
- 修复方向：把结果（或 blob 引用）在 `finishOperation` 内持久化到 `tool_operation`/blob，使跨进程 replay 可解析；实现记录改为「一次执行；失败者按持久 result store 决定重放或 `RECOVERY_REQUIRED`」。

### W7R1-11（P3）实现记录与代码/事实的少量不一致

- `implementation.md:25` 称 `secrets.test.ts`「26 例」，实际 vitest 为 **27**（`/tmp/wp07r/cmd_rest.log:52`）。
- `implementation.md:14` 的并发描述不准确（见 W7R1-10）；`packages/core/src/grants.ts:540-546` 注释称「the transaction rolls the prepared row back」，但返回 `refuse` 是正常返回，`withTransaction` 会提交该 `prepared` 行（当前单进程 `BEGIN IMMEDIATE` 形态下几乎不可达，但注释与语义不符）。
- `implementation.md:48`「三处临时改动…被对应用例抓到并已还原」无法从仓库证据验证（未读开发聊天），属不可核验声明。

### W7R1-12（P3）已发布但未选中的内置扩展被记成 `refused` + `INTERNAL_ERROR`

- 位置：`packages/pi-runtime/src/extensions.ts:597-612`
- 复现：`probe-ac053.mjs` 用例 2。观测 trace 项 `{"id":"other-builtin","origin":"builtin","decision":"refused","code":"INTERNAL_ERROR","reason":"disabled"}`。
- 影响：审计轨迹把「未选择/默认关闭」这一非错误决策标成内部错误，与仓库扩展的 `NOT_AUTHORIZED(not-selected)` 语义不一致，会误导 Review/Test 的证据判读。
- 修复方向：`disabled` 且非 apiVersion 不匹配时记 `skipped`（或 `NOT_AUTHORIZED`），仅真正的激活异常记 `refused`/`INTERNAL_ERROR`。

### W7R1-13（P3）Broker 拒绝 review/test 的一切写入，包括 `execution.md` §3 划给 Review 的报告与检查临时目录

- 位置：`packages/core/src/broker.ts:230-234`、`packages/core/src/broker.ts:950-960`
- 复现：`probe-ac050.mjs` 用例 2/3：即便持有针对 `reports/review.md` 的 write Grant，review Run 仍 `NOT_AUTHORIZED`（`reason` 含 `read-only`），文件未写、无 `tool_operation` 行。
- 契约：`execution.md` §1 要求「Review与Test在所有模式仍使用隔离容器，确保**源码**只读」；§3 角色表却把「自己报告与检查临时目录」列为 Review/Test 的写边界。
- 说明：方向 fail-closed，不构成安全缺陷；但属于文档与实现的偏离，且会使经工具层写报告的路线不可用（若报告只由 Core artifact 服务写则无功能影响）。修复方向：要么在文档明确「工具层对 review/test 全写拒绝」，要么对报告/临时目录以 Grant 精确放行并保留源码只读。

### 判定计数

| 严重度 | 数量 | 阻断 |
|---|---|---|
| P0 | 0 | — |
| P1 | 3 | 是（W7R1-01/02/03） |
| P2 | 4 | 否（记录并建议同批修复：04/05/06/07） |
| P3 | 6 | 否（08/09/10/11/12/13） |

## 6. 记录对账（implementation.md ↔ 代码）

- **T1–T4 的主要机制与代码一致**：Grant 生命周期与 once 绑定、撤权编码（`consumedAt`+纪元 `expiresAt`，`consumedByOperationId` 不设以区分已完成）、SecretStore 的「先鉴权后查 ref」与查询面不返回值、Broker 的准入顺序与「无 Docker 不回退」、容器计划加固、网络按跳校验、测试环境清理失败上报、Trust/Skill 边界与 trace —— 均在本次独立探针中复现。
- **残余登记基本如实**：result store 未接线（#3 相关）、Secret 未接进 Broker（#5）、`gatewaySecretResolver` 属 WP-09（#6）、持久化 Secret 后端属安装范围（#7）、`loadTrustedExtensions` 未接 session（#8，已核实 `apps/runner/src/attempt.ts:122` 仍调用 `activateExtensions`）、仓库扩展发现未实现（#9）、内置白名单为空（#10）——均与代码一致，未发现被隐瞒的已完成声明。
- **不准确处**：并发「一次重放」与 `secrets.test.ts` 用例数（W7R1-10/11）；`grants.ts` 事务回滚注释（W7R1-11）；「三处临时改动」不可核验。
- **四个必需失败测试确实存在且逐字命名**（`packages/core/test/permissions-failures.test.ts`），本次独立复现 4/4 通过。
- **未发现**把未实现行为说成已实现的夸大；主要问题是「已实现但边界有洞」与少量记录不精确。

## 7. 覆盖限制（coverage limits）

1. 未读取任何开发/Test 聊天或会话；实现意图仅按正式文档与代码推断。
2. 未调用真实模型/Provider。Model Gateway 侧 Secret（`gatewaySecretResolver`）按 implementation.md 属 WP-09，本包只验证到适配点与拒绝语义。
3. 持久化 Secret 后端（Keychain / 0600 加密文件 + 备份导出）属安装/部署范围，未验证；只验证内存 `SecretStore` 接缝。
4. `loadTrustedExtensions` **尚未接入** `apps/runner`（残余 #8），因此 AC-053 只在加载器 API 面验证，未经真实 session 创建路径。
5. 容器侧：加固标志在 `planContainerRun` 层断言，且仓库自带集成测试在真实 Docker 中验证了只读 rootfs/无网络/cap-drop/非 root/pid+内存——我未另写一套容器级负例逐条复验；容器**网络代理**（`networkProxy`）本机未配置，故未做真实容器出网经代理的端到端验证。
6. 硬链接逃逸在路径包含性模型下不可完全阻断，只记录；macOS 无 `/proc`，`/proc` 类逃逸未单独探针（由绝对路径/realpath 通用规则覆盖）。
7. DNS 类结论依赖本机可解析 `localtest.me`（实测解析为 `127.0.0.1`）；若目标环境无公共 DNS，该类绕过仍可通过自建解析或 hosts 复现，但本次未在离线环境复验。
8. 并发只覆盖单机 8 进程；无跨主机/分布式与 SQLite `busy_timeout` 超时路径验证。
9. `pnpm test:integration` 只按要求运行一次（Docker UP，14 文件/152 用例、无 skip），未重复运行以排查 flakiness。

## 8. 决定

**不能进入独立 Test。** 3 个 P1（W7R1-01/02/03）在本包验收面上可稳定复现，按规则 Verdict=FAIL，返回 Develop 修复；建议同批修复 4 个 P2（尤其 W7R1-04 运行库默认保护与 W7R1-05 端口归属），随后重新走独立 Review（P3 可记录不阻断）。
