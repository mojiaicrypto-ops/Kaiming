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

---
---

# WP-07 独立 Review 报告 · 第 2 轮（Review Round 2）

> 第 1 轮报告（第 1–263 行）保持原样未改；本文件自第 264 行起追加第 2 轮内容。已用 `git diff` 与 `git show HEAD:.agentdev/work/WP-07/review.md` 逐字节比对确认第 1 轮无改动（见 §0）。

## 0. 元数据与冻结点

| 项 | 值 |
|---|---|
| 冻结点（task 指定） | `c7400d7` |
| `git rev-parse HEAD` | `c7400d71c925b53117ed2e139b4b03c14a6f4f31` |
| `git rev-parse c7400d7^{tree}` | `744b9828fc3ef0e82be9be6189a2bd70982a02be` |
| `git status --porcelain`（报告写入前） | 空（工作树干净） |
| 第 1 轮 review.md 完整性 | `shasum -a 256` = `2f14b463894d646c0a722cee44eaad7bf1264a7e905ea3ad63734434a10eceac`，与 `git show HEAD` 一致；第 1–263 行逐字节未改 |
| Review 写入范围 | 仅 `.agentdev/work/WP-07/review.md`；全部探针/日志在 `/tmp/wp07r2/` |
| 开发/Test 聊天 | 未读取；证据仅来自仓库文件、`dist` 构建产物、真实 OS 进程/SQLite/Docker 与本次独立探针 |
| Docker | 守护进程 **UP**；执行镜像 `agentdev/exec:0.0.0`（`edd3aa5051c7`）在位；`pnpm test:integration` 真实容器用例实际执行（无 skip） |
| 探针宿主 | macOS arm64 / Node v24.8.0（无 `/proc`） |

被审文件 Hash（`git hash-object` = 仓库 blob SHA-1）：

| 文件 | git blob |
|---|---|
| `packages/core/src/grants.ts` | `f08fd2825c6266e8d769ba8d7b7b041ac3794553` |
| `packages/core/src/secrets.ts` | `d574ac952aa4ca7a3bdf6d9bb92eff6484091ffa` |
| `packages/core/src/broker.ts` | `e0460c96ff7906975737e6cabc409aab67461de8` |
| `packages/core/src/test-environment.ts` | `dfbca067cf8cff6a6e5a7fc3771232d76f0a42fe` |
| `packages/domain/src/permission.ts` | `8e7677b22b86cc9b4ac5ad226be271d14c0b2ec9` |
| `packages/pi-runtime/src/extensions.ts` | `6dd9b76905931f6c95176de62cbaf6c2646437fe` |
| `packages/core/test/permissions-failures.test.ts` | `4febfbfed1ad8256de41062e7020a3d65375ec02` |
| `packages/core/test/broker.test.ts` | `e309cc6c1a14c58611096a017f3d978c58a2930f` |
| `packages/core/test/grants.test.ts` | `8a9b8e0a84eb0ed5211da078aa1c11f4cc8d6edb` |
| `packages/pi-runtime/test/trust.test.ts` | `009ac21399650c5957b52e6ce3a8b541792ae93c` |
| `packages/core/test/permissions.integration.test.ts` | `70541ff38fb2f414a689d2f1a1508f103737adfb` |
| `packages/core/test/broker.integration.test.ts` | `86cdfc38880e1016db9235cc4cc497da01d4f243` |
| `packages/domain/test/permission-delivery.test.ts` | `4fe3ff8161dd167472dbe123fc30e51cb6280637` |
| `.agentdev/work/WP-07/implementation.md` | `a956de30f0b41bff23797141a7edc168192de7b5` |

## 1. 结论（verdict）

**FAIL** —— 第 1 轮的 3 个 P1、4 个 P2、6 个 P3（W7R1-01..13）**全部关闭且经独立探针复现为已修复**；但本轮在**同一验收面**上发现 **1 个新的 P1（W7R2-01）**：Review/Test 这类只读角色可以通过 `bash`（`git` 同理）在 host 模式写入源码，且容器模式下调用方传入的 `writableRoots` 会把源码以 `rw` 挂载。该行为直接违反 AC-050「Review/Test 仍隔离」与 `execution.md` §1「确保源码只读」，并使 `implementation.md` T7/W7R1-13「对 review/test，写操作仅在 writeRoots 内放行」成为代码不支持的声明。

另有 **3 个 P2、6 个 P3**（非阻断，见 §7）。

**能否进入独立 Test：否。** 新的 P1 在本包验收面上稳定复现，按规则 Verdict=FAIL，返回 Develop 修复后再走独立 Review。

## 2. 契约命令原始结果

全部命令在冻结点 `c7400d7`（tree `744b9828`）工作树干净状态下真实执行一次；原始日志 `/tmp/wp07r2/logs/commands.log`。

| 命令 | 原始结果 | 结论 |
|---|---|---|
| `pnpm typecheck` | `$ tsc -p tsconfig.json --pretty false`；`TYPECHECK_EXIT=0` | 通过 |
| `pnpm lint` | `$ node scripts/lint.mjs`；`All matched files use Prettier code style!`；`LINT_EXIT=0` | 通过 |
| `pnpm docs:check` | `docs:check ok — 15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages`；`DOCS_EXIT=0` | 通过 |
| `pnpm build` | `pnpm -r build`：contracts/pi-runtime/domain/knowledge/storage/workspace/core/cli/daemon/runner 共 10 workspace 全 `Done`；`BUILD_EXIT=0` | 通过 |
| `pnpm test:unit` | `Test Files 44 passed (44)` / `Tests 885 passed (885)` / Duration 12.45s；`UNIT_EXIT=0` | 通过（与 implementation.md T7 的 44/885 一致） |
| `pnpm test:integration` | `Test Files 14 passed (14)` / `Tests 156 passed (156)` / Duration 21.81s；`INTEGRATION_EXIT=0`；容器用例真实执行（`✓ runs a container read through Docker and reports the real non-root account 4793ms`、`✓ keeps the root filesystem read-only`、`✓ drops every Linux capability`、`✓ has no network access but a working name resolver`、`✓ applies the pid and memory limits`），无 skip | 通过（与 T7 的 14/156 一致） |

命令尾部原始输出：

```
$ pnpm typecheck
TYPECHECK_EXIT=0
$ pnpm lint
Checking formatting...
All matched files use Prettier code style!
LINT_EXIT=0
$ pnpm docs:check
docs:check ok — 15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages
DOCS_EXIT=0
apps/daemon build: Done
apps/runner build: Done
BUILD_EXIT=0
 Test Files  44 passed (44)
      Tests  885 passed (885)
UNIT_EXIT=0
 Test Files  14 passed (14)
      Tests  156 passed (156)
INTEGRATION_EXIT=0
```

### 2b. 四个必需失败测试 + AC 代表切片的重跑（仓库自带用例）

针对 AC-048..051/053/080 的代表切片，单独重跑仓库自带用例（`/tmp/wp07r2/logs/ac-slice.log`）：

| 批次 | 结果 | 退出码 |
|---|---|---|
| unit：`permissions-failures.test.ts`(4) + `broker.test.ts`(32) + `grants.test.ts`(31) + `secrets.test.ts`(27) + `permission-delivery.test.ts`(20) + `trust.test.ts`(14) | `Test Files 6 passed (6)` / `Tests 128 passed (128)` | `AC_UNIT_EXIT=0` |
| integration：`permissions.integration.test.ts`(11) + `broker.integration.test.ts`(8) + `secrets.integration.test.ts`(5) | `Test Files 3 passed (3)` / `Tests 24 passed (24)` | `AC_INTEGRATION_EXIT=0` |

逐文件用例数与 `implementation.md` T7 的计数**全部一致**（grants 31、broker 32、secrets 27、permission-delivery 20、trust 14、failures 4、permissions.integration 11、broker.integration 8、secrets.integration 5），未发现 T7 计数虚报。

## 3. 方法（每个脚本与用例数）

全部探针消费**已构建产物**（`packages/*/dist/index.js` 绝对路径导入），不 import 任何产品测试文件；真实 SQLite、真实 `node` 子进程、真实临时仓库/符号链接、真实 OS 端口监听、真实第二 OS 进程（跨进程重放）、真实 Docker（仅仓库自带集成套件）。所有网络探针**离线**：使用桩解析器（`HostResolver`）与桩 fetcher，不发外部请求。脚本与日志在 `/tmp/wp07r2/`，一键脚本 `/tmp/wp07r2/run-all.sh`，全量日志 `/tmp/wp07r2/logs/all.log`。

| 脚本 | 用例数 | 覆盖 |
|---|---|---|
| `probe-network.mjs` | 32 | W7R1-01（DNS 解析私网/多答案/不可解析/每跳）、W7R1-02（hex/点分 mapped、NAT64、私网/公网字面量矩阵、zone id、6to4）、W7R1-07（scheme、opt-in、重定向降级、userinfo）、TOCTOU、Broker 准入时 DNS |
| `probe-skill.mjs` | 12 | W7R1-03（目录/文件/目录本身符号链接逃逸、合法技能加载、未信任零读）、W7R1-12（未选中/不支持 apiVersion/激活异常/正常激活）、仓库扩展白名单 |
| `probe-broker.mjs` | 16 | W7R1-04（派生根、review/developer 读运行库、container 模式、正例）、W7R1-13（report root 写放行、源码拒绝、越界拒绝、无声明 fail-closed、test 角色）、W7R1-09（stdin/base64、shell 引号）、四个必需失败测试独立复现 |
| `probe-testenv.mjs` | 6 | W7R1-05（OS 占用端口跳过、早死报 failed、两 manager 不共享端口、保留端口 fail-closed）、假就绪、端口认领泄漏 |
| `probe-grants.mjs` | 9 | W7R1-06（checkCoverage/findGrantFor/networkCovered 绑定）、W7R1-10（**真实第二 OS 进程**重放）、显式内存 sink 的 RECOVERY_REQUIRED、陈旧清单缓存、null 结果、离线 GC、清单增长、并发写清单 |
| `probe-ac.mjs` | 11 | AC-048/049/050/051/053/080 代表正负例（含真实 `node` 子进程接收诱饵、容器计划加固标志、once 绑定与兄弟隔离） |
| `probe-bash.mjs` | 5 | **新 P1**：只读角色的 bash/git 写通道、容器 `writableRoots` 提权、默认 ro 对照 |
| **合计** | **91** | 其中 15 条断言失败 = 本轮缺陷/残余证据（其余 76 条通过） |

辅助：`lib/fixture.mjs`（harness）、`lib/replay-worker.mjs`（第二进程重放）、`lib/manifest-writer.mjs`（并发清单写者）。

## 4. 第 1 轮 Finding 关闭核验（W7R1-01..13）

| 编号 | 严重度 | 关闭判定 | 独立证据（本轮到具体用例） |
|---|---|---|---|
| W7R1-01 DNS 私网绕过 | P1 | **关闭** | `probe-network` 01.a–01.j：`decide()` 对解析到 `127.0.0.1`/`::1`/RFC1918/CGNAT/metadata 的名字一律 `NOT_AUTHORIZED`；多答案中任一私网即拒；不可解析即拒；`GuardedRequester` 对私网名**零 fetcher 调用**；公网 302 → 私网名的第 2 跳被拒且只 fetch 了首跳；公网名仍可达（非空洞） |
| W7R1-02 mapped IPv6 | P1 | **关闭** | `probe-network` 02.a–02.f：`::ffff:7f00:1`、`::ffff:a00:5`、`::ffff:a9fe:a9fe`、`::ffff:c0a8:101`、`::ffff:6440:1`、`::ffff:0:0` 与点分形式全部判内网；`::ffff:8.8.8.8`/`::ffff:808:808` 仍判公网；URL 规范化形式在策略处拒绝；公网 mapped **被精确授权时**仍放行；`ipv6Bytes` 对 hex/点分解码一致 |
| W7R1-03 SKILL.md 符号链接逃逸 | P1 | **关闭** | `probe-skill` 03.a：选中目录的 `SKILL.md` 指向仓库外 ⇒ `readSkillFile` **零调用**、`loadedSkills` 空、trace `refused/VALIDATION_ERROR`，trace 不含外部技能名；03.b 合法技能正常 `loaded`；03.c 指向根内的符号链接仍放行（规则是包含性而非禁符号链接）；03.d 选中文件符号链接逃逸同样零读；03.f 选中目录本身是逃逸符号链接也拒绝 |
| W7R1-04 运行库默认保护 | P2 | **关闭** | `probe-broker` 04.a：不传任何 `protectedPaths`，`broker.protectedRoots` = `[<dataDir>, <dataDir>/project.sqlite]`；04.b/04.c：review 与 developer 的受权 Grant 读 `project.sqlite` 均 `NOT_AUTHORIZED`、零 `tool_operation` 行；04.d：container 模式同样在**任何进程启动前**拒绝；04.e：同一 Grant 仍可读普通源码文件（非空洞） |
| W7R1-05 端口分配/就绪 | P2 | **关闭**（三点断言） | `probe-testenv` 05.a：OS 已占用端口被跳过（真实监听器占 48100，分配 48101 且就绪归属为该环境）；05.b：早死子进程 ⇒ `INVALID_STATE`（reason 含 `exited with code 3`）、状态 `failed`；05.c：两 manager 同区间得 48200/48201；05.f：保留端口不给（fail-closed）。残余见 W7R2-07/08 |
| W7R1-06 replay/覆盖绑定 | P2 | **关闭** | `probe-grants` 06.a：同一绑定 `checkCoverage=true`，异 operation/role/stage/run 全 `false`，`findGrantFor` 为 `undefined`；06.b：已消费的 secret once Grant 不再覆盖 `network` 查询 |
| W7R1-07 明文 http | P2 | **关闭** | `probe-network` 07.a：同目标 https 放行、http 拒绝且 reason 含 `https is required`；07.b：http 需 `allowInsecureHttp` **且**精确目标授权（无 opt-in 拒、异端口拒、有 opt-in 无授权拒）；07.c：`file:`/`ftp:`/`gopher:` 拒绝；07.d：https→http 重定向被拒且只 fetch 首跳；07.e：显式 opt-in 下受权明文重定向可走通；07.f：`public.example@127.0.0.1` 的 userinfo 伪装被按 host 判定拒绝 |
| W7R1-08 硬链接限制 | P3 | **关闭（按记录）** | `packages/core/src/broker.ts:382-389` 注释明确「路径包含性规则、非 inode 规则，不声称阻断」；`execution.md` §3 无硬链接 AC；本轮不重复主张阻断 |
| W7R1-09 here-doc 逃逸 | P3 | **关闭** | `probe-broker` 09.a：payload 含独立行 `AGENTDEV_EOF` 与 `echo should-not-run`，命令串**既不含**分隔符也不含 echo、含 `base64 -d >`，stdin 等于 payload 的 base64（内容经 stdin 传递）；09.b：带单引号的路径被正确 `'\''` 转义 |
| W7R1-10 跨进程重放 | P3 | **关闭** | `probe-grants` 10.a：**真实第二个 OS 进程**（`spawnSync node lib/replay-worker.mjs`，不同 pid）打开同一数据目录，`outcome=replayed`、`executorCalls=0`、结果 = 首进程记录值、副作用文件未被二次写；10.b：显式注入全新内存 sink 时仍如实 `RECOVERY_REQUIRED`（缺失结果路径未被掩盖） |
| W7R1-11 记录不一致 | P3 | **关闭** | 逐文件用例数与本轮 vitest 输出全部一致（见 §2b）；`grants.ts:637-647` 注释已改为「事务**提交**该 prepared 行」；T5 不再含「三处临时改动」不可核验表述，替换为具名突变实验（本轮未重做突变，见 §11） |
| W7R1-12 未选中内置扩展 | P3 | **关闭** | `probe-skill` 12.a：未选中 ⇒ `skipped` + `code: undefined` + reason 含 `not-selected`；12.b：不支持 apiVersion 仍 `refused/VALIDATION_ERROR`；12.c：选中项激活抛异常 ⇒ `refused/INTERNAL_ERROR`；12.d：选中且支持 ⇒ `loaded` |
| W7R1-13 review/test 报告写入 | P3 | **关闭（对 write/edit 操作）** | `probe-broker` 13.a：review 在声明的 report root 内写成功并落盘、写源码 `NOT_AUTHORIZED` 且源码字节不变；13.b：越出 report root 的写拒绝；13.c：未声明 `writableReportRoots` 时 fail-closed；13.d：test 角色同样放行、developer 写源码不受影响。**但 `bash`/`git` 通道仍可写（新 P1，见 W7R2-01）** |

**小结：W7R1-01..13 全部关闭**；其中 W7R1-05 与 W7R1-13 的关闭存在本轮新发现的残余面，已分别登记为 W7R2-07/08 与 W7R2-01。

## 5. 逐 AC 结论

| AC | 结论 | 依据 |
|---|---|---|
| **AC-048 Workspace 边界** | **部分不通过（P2 残余，非本轮阻断项）** | 通过：无 Docker ⇒ `PROVIDER_UNAVAILABLE`、原样原因、零进程、零行、绝不回退 host（REQ-4）；符号链接在 host/container 两模式均 `NOT_AUTHORIZED`（AC-048.n1）；容器计划含 `--read-only`/`--tmpfs`/`--cap-drop=ALL`/`no-new-privileges`/`--pids-limit 256`/`--memory 2g`/`--cpus 2`/`--user 10001:10001`/`:ro`/默认 `--network none`（AC-048.p1）；DNS 私网、mapped IPv6、明文 http、重定向每跳均按第 1 轮要求关闭。**残余**：`Broker.invoke` 的准入（第 4 步）用同步 `checkTarget`，对「解析后才是私网」的目标**先准入并消费 Grant/落 tool_operation 行**，DNS 只在传输时判定（W7R2-02）；解析与连接之间存在 TOCTOU，未把连接钉在已校验地址（W7R2-03） |
| **AC-049 Autonomous 范围** | **通过** | `probe-ac` AC-049.p1：范围内调用执行并落 `tool_operation finished` + `grant.issued`/`tool.invoked`；AC-049.n1：越界目标/错 operation/过期 Grant 分别 `NOT_AUTHORIZED`/`NOT_AUTHORIZED`/`AUTH_EXPIRED`，零 `tool_operation` 行 |
| **AC-050 Full Access 门禁** | **不通过（P1）** | 通过：host 模式 review 的 `write` 操作被拒且源码不变；review 读运行库被拒；`protectedPaths` 结构性派生（W7R1-04 关闭）。**不通过**：只读角色的写门禁只覆盖 `WRITE_OPERATIONS`（`write`/`edit`/`artifact_write`/`delete_data`/`push`/`deploy`），不含 `bash`/`git`；一个 `bash` Grant 即可在 host 模式写入源码，容器模式又因调用方 `writableRoots` 被 `rw` 挂载（W7R2-01） |
| **AC-051 Secret 隔离** | **通过** | `probe-ac` AC-051.p1：诱饵经真实 `node` 子进程送达已授权 Run；兄弟 Run 注入整体拒绝（`NOT_AUTHORIZED`）且子进程拿不到；AC-051.n1：`JSON.stringify(store)`/`list()`/`refs()`/`has()` 均不含明文；`probe-broker` REQ-2：日志/嵌套 UI payload 命中 ≥3 处，`maskAll`/`redactValue` 后零命中，store JSON/清单/refs 无泄漏 |
| **AC-053 信任与资源** | **通过** | `probe-skill` 03.e：未信任项目零 import、零读 Skill、零采纳配置，trace 全为 skip；03.a/03.f：逃逸符号链接零读并 `refused/VALIDATION_ERROR`；03.h：信任后仓库扩展必须「显式选中 ∧ 发布白名单」才 import（marker/import 计数证明仅 1 次），未选中 `NOT_AUTHORIZED`、未发布 `VALIDATION_ERROR`；`probe-ac` AC-053.p1 同结论 |
| **AC-080 授权精确绑定** | **通过（含跨进程）** | `probe-ac` AC-080.p1：首次 `executed`、同输入 `replayed` 且执行计数=1、异 inputHash `IDEMPOTENCY_CONFLICT`；AC-080.n1：兄弟 Run 对 once/run Grant 均 `NOT_AUTHORIZED`（fields=['runId']）；AC-080.p2：work 作用域两 Run 均可用；`probe-grants` 10.a：真实第二进程 `replayed` 且不重放执行。残余：持久结果存储的多写者一致性（W7R2-04） |

### 四个必需失败测试（独立复现）

| 必需失败测试 | 独立复现（`probe-broker.mjs`） |
|---|---|
| 符号链接/私网/重定向 | **通过** REQ-1：符号链接读 `NOT_AUTHORIZED` 且外部文件不变；私网字面量准入拒绝；公网→私网字面量 302 第 2 跳拒绝且 `hops` 只有首跳 fetch |
| Secret 泄漏 | **通过** REQ-2：scan 命中日志 1 处、嵌套 payload 2 处；store JSON/list/refs 无明文；mask/redact 后零命中 |
| 进程清理失败 | **通过** REQ-3：真实子进程 + 注入 SIGTERM/SIGKILL 失败与目录删除失败 ⇒ `RECOVERY_REQUIRED`，`failures` 逐条列出（SIGTERM/SIGKILL/still alive/removing）、状态 `cleanup_failed`；REQ-3b 真实环境仍能正常清理 |
| 无 Docker 拒绝 | **通过** REQ-4：`PROVIDER_UNAVAILABLE`、原样原因、`fields=['mode']`、零进程、零 `tool_operation` 行 |

## 6. Findings（第 2 轮新增）

### W7R2-01（P1）只读角色可通过 `bash`/`git` 写源码；容器模式下 `writableRoots` 会把源码 `rw` 挂载

- 位置：`packages/core/src/broker.ts:263-270`（`WRITE_OPERATIONS` 不含 `bash`/`git`）、`packages/core/src/broker.ts:1468-1486`（写门禁与 `access` 推导）、`packages/core/src/broker.ts:1733-1745`（host `runCommand` 直接 `/bin/sh -lc`，无文件边界）、`packages/core/src/broker.ts:1759-1768`（`writableRoots: [...(invocation.writableRoots ?? []), ...reportRoots]` 未对只读角色收紧）
- 契约/AC：AC-050「宿主开发执行；When 尝试绕Review或读验证者无权数据；Then 领域Gate保留，Review/Test仍隔离」；`docs/architecture/execution.md` §1「Review与Test…确保**源码**只读」、§3 角色表只给 Review/Test「自己报告与检查临时目录」；`implementation.md:138`（T7/W7R1-13）声称「对 review/test，写操作仅在 `writeRoots` 内放行」。
- 复现：`node /tmp/wp07r2/probe-bash.mjs`（日志 `/tmp/wp07r2/logs/probe-bash.log`）：
  - `W7R2-BASH-HOST`：签发 `role=review, stage=review, operation=bash, targets=['src/feature.ts']` 的 run Grant（签发成功），以 `operation:'bash'`、`roots:[workspace]`、`input.command = "printf 'pwned-by-review' > <workspace>/src/feature.ts"` 调用 ⇒ `outcome.ok=true/executed`，文件内容变为 `pwned-by-review`。
  - `W7R2-BASH-NOROOTS`：同一调用**完全不声明 roots/targets** 也 `executed`，源码被改为 `pwned-no-roots`（`bash` 在 `requiresRoots` 之外，无任何文件检查）。
  - `W7R2-BASH-CONTAINER`：container 模式 + 调用方 `writableRoots:[workspace]` ⇒ `docker run … --volume <workspace>:/workspace:rw`（源码 rw 挂载），命令 `touch src/feature.ts`。
  - `W7R2-BASH-HOST2`：把 `access:'write'` 显式传在 `bash` 上会被拒（因只读角色门禁/校验），即**该写通道无法被声明式地拦截**，只能靠调用方不声明写——而 `bash` 本就不在写操作集合内，默认 `access='read'`。
  - 对照：`W7R2-BASH-CONTAINER2` 不传 `writableRoots` 时源码为 `:ro`，说明容器默认加固本身有效，缺口在 host 模式与调用方可任填的 `writableRoots`。
- 观测 vs 期望：观测为只读角色真实写入被验证的源码（host 模式），以及源码被以 rw 挂载进「隔离」容器；期望 Review/Test 在**所有模式**下都写不到源码/验证输入，`writableRoots` 对只读角色必须被忽略或收窄到 report root。
- 修复方向：(a) 对只读角色禁用/降权 `bash`/`git`（或强制其容器化并把源码只读挂载），(b) `containerPlan` 对只读角色忽略调用方 `writableRoots`（只允许 report roots），(c) 把「写」判定从 operation 名单改为「是否可能修改文件系统」的显式工具分类，禁止用 `access` 参数自证清白，(d) 文档要么收紧为「host 模式仅 Full Access 角色可用」，要么修掉实现。

### W7R2-02（P2）准入在 DNS 校验之前：解析后才是私网/不可解析的目标会被准入并消费 Grant

- 位置：`packages/core/src/broker.ts:1526-1530`（`Broker.invoke` 第 4 步用同步 `this.networkPolicy(invocation).checkTarget(...)`）、`packages/core/src/broker.ts:944-948`（`decideSync` 只能判字面量/构造性内网名）、`packages/core/src/broker.ts:814-821`（`checkUrl` 同步）
- 契约/AC：`execution.md` §4「网络工具在**执行前**校验 scheme=https、DNS 解析后的目标 IP、重定向每跳重验」；AC-048「Given 无Docker或目录/网络越权；When **准入**/执行；Then …阻止越权」；第 1 轮 W7R1-01 修复方向明确写「在**准入**与每一跳前 `NOT_AUTHORIZED` 拒绝」。
- 复现：`node /tmp/wp07r2/probe-network.mjs` 用例 `W7R1-01.k`/`AC-048.x`/`AC-048.y`：
  - `policy.checkTarget({url:'https://localtest.example/'})`（桩解析器解析到 `127.0.0.1`）⇒ `{ok:true}`；异步 `decide()` 同 URL ⇒ `NOT_AUTHORIZED`。
  - `AC-048.x`：一次性 `network` Grant 绑定 `localtest.example`，`Broker.invoke` 返回 `ok:true, outcome:'executed'`，`grant.consumedAt` 已被写入，落 `tool_operation` 行；真实 fetch 次数 0（传输层拒绝）——即**准入、Grant 消费与审计行都发生在 DNS 校验之前**，仅传输被拦。
  - `AC-048.y`：不可解析的 `nope.example` 同样被准入（`ok:true/executed`），只有传输层拒绝。
  - 对照 `AC-048.z`：字面量 `169.254.169.254` 在准入处即拒绝，说明缺口仅在「需要解析的名字」。
- 观测 vs 期望：观测为「传输拒绝、准入通过」（且 `once` Grant 已被消费）；期望在执行前（准入处）用异步决议拒绝，Grant 与 `tool_operation` 零副作用。此外任何不经 `ToolContext.request` 的工具主体（`run()` 自建 `fetch`）会完全绕过该 DNS 守卫。
- 修复方向：把 `Broker.invoke` 改成异步入口（或在 `BrokerOptions` 上强制注入「先决议后消费」的包装），在 `consumeOnce` 之前 await `networkPolicy.decide()`；同步面仅保留给不触网的操作。

### W7R2-03（P2）DNS TOCTOU：守卫校验的地址没有钉在连接上

- 位置：`packages/core/src/broker.ts:1036-1057`（`GuardedRequester.request` 先 `policy.decide` 再 `fetcher(current, {method, redirect:'manual', headers})`，只传 URL）、`packages/core/src/broker.ts:982-998`（`NetworkFetcher`/`defaultNetworkFetcher` 无 `dispatcher`/`agent`/`lookup` 等地址绑定位）、`packages/core/src/broker.ts:680-693`（默认解析器独立于传输）
- 契约/AC：`execution.md` §4「DNS解析后的目标IP」；第 1 轮 W7R1-01 修复方向「**把连接钉在已校验的地址上（避免 TOCTOU）**」——本项未实现。
- 复现：`probe-network.mjs` 用例 `W7R2-TOCTOU`（离线、建模 DNS rebinding）：桩解析器对守卫返回公网 `93.184.216.34`，传输侧第二次解析返回 `127.0.0.1`；观测 `ok:true` 且 `connectedTo='127.0.0.1'`——守卫放行了请求，传输实际连到 loopback。`W7R2-TOCTOU2` 记录结构事实：fetcher 收到的 init 仅为 `{method, redirect:'manual', headers:{}}`，**没有任何已校验地址**。
- 观测 vs 期望：观测为「校验用地址 A、连接用地址 B」；期望连接绑定到已校验地址（自定义 agent/`lookup`）或在解析结果为多答案时只连已校验的那个。
- 修复方向：为 `NetworkFetcher` 增加地址绑定（`undici` `Agent`/`connect.lookup` 或自定义 `dispatcher`），把 `decide` 返回的地址钉进连接；至少在文档与 AC 中明确该 TOCTOU 为已接受风险。

### W7R2-04（P2）持久延迟结果存储不是多写者安全的：陈旧清单缓存 + 并发写丢条目

- 位置：`packages/core/src/grants.ts:240-259`（`readManifest` 在首次 `put` 后缓存 `this.manifest`，此后**永不重读**）、`packages/core/src/grants.ts:265-271`（`writeManifest` 用「读-改-写 + tmp/rename」，无锁、无 CAS）、`packages/core/src/grants.ts:221-238`（`put`/`get`）
- 契约/AC：AC-080「once … 原子消费且**重试原操作返回原结果**」；`implementation.md:122`（T7/W7R1-10）声称持久存储使「第二个进程重放同一 tool operation 时能解析到持久结果」。
- 复现：`probe-grants.mjs`：
  - `W7R2-STALE`：同一数据目录上两个 `ProjectStore`/sink（建模长生命周期进程与其他写者）。A 先 `put`（缓存清单），随后 B `put`；`A.get(refB)` ⇒ `undefined`（陈旧缓存），而 `B.get(refA)` 与 `B.get(refB)` 均正常。经完整 `GrantStore` 复现即「A 侧重放 B 执行过的 once ⇒ `RECOVERY_REQUIRED`」。
  - `W7R2-CONCURRENT-MANIFEST`：两个真实子进程各写 25 条，最终清单只有 **26/50** 条（24 条丢失）——丢失的 `resultRef` 永远无法重放。
- 观测 vs 期望：观测为跨「进程代际/并发写」的结果不可解析或条目丢失；期望任何写者写入的结果对同目录的所有进程立即可解析。
- 修复方向：`get` 每次读取（或按 mtime/版本失效）清单，`put` 用文件锁或单行插入式存储（每结果一个文件，manifest 仅作索引且以原子 append/逐条文件代替整体重写）。

### W7R2-05（P3）注入的解析器抛异常会逃逸为异常，而不是契约拒绝

- 位置：`packages/core/src/broker.ts:702-722`（`resolvesToPrivateAddress` 直接 `await resolver.resolve(...)`，无 try/catch；只有 `defaultHostResolver` 自己 catch）
- 契约/AC：`execution.md` §4（网络越权应被拒绝）；AC-048；该函数 docstring 自称「Returning a *reason* instead of throwing keeps a resolution failure a refusal rather than an escaped exception」。
- 复现：`probe-network.mjs` `W7R1-01.g`：`new NetworkPolicy({resolver:{resolve(){throw new Error('resolver exploded')}}})` ⇒ `decide()` 抛出 `resolver exploded`；`GuardedRequester.request` 同样会把异常抛给调用方而非返回 `{ok:false, code}`。
- 观测 vs 期望：观测为异常逃逸（可能被上层当成内部错误/崩溃）；期望按不可解析处理并返回带原因的策略拒绝。
- 修复方向：在 `resolvesToPrivateAddress`（或 `decideHost`）内 try/catch，把异常转为 `NOT_AUTHORIZED` + reason。

### W7R2-06（P3）仅解码 `64:ff9b::/96`；RFC 8215 本地用途 NAT64 `64:ff9b:1::/48` 被判公网

- 位置：`packages/core/src/broker.ts:635-644`
- 契约/AC：`execution.md` §4「禁止默认访问 loopback/私网/metadata」；AC-048；第 1 轮 W7R1-02 修复方向「含 `::ffff:0:0/96`、`64:ff9b::/96` NAT64 等」。
- 复现：`probe-network.mjs` `W7R1-02.h`：`classifyAddressLiteral('64:ff9b:1::7f00:1')===false`、`classifyAddressLiteral('64:ff9b:1::a00:1)===false`（本地 NAT64 前缀 + 内嵌 `127.0.0.1`/`10.0.0.1` 被判公网）。对照 `64:ff9b::7f00:1` 已正确判内网。
- 观测 vs 期望：观测为在启用本地用途 NAT64 的网络里可经翻译器抵达内网；期望解出 `64:ff9b:1::/48` 的内嵌 IPv4 后套用 IPv4 规则（或在文档登记为已知边界）。
- 修复方向：扩展 NAT64 前缀集合（RFC 8215 本地前缀可按配置注入）；对无法判定的内嵌 IPv4 一律按内网处理更安全。

### W7R2-07（P3）就绪仍靠「端口可连 + 子进程存活」推断，外部监听器可冒充本环境

- 位置：`packages/core/src/test-environment.ts:661-671`（`waitForPort`：`portOpen` 为真且 `handle.exited()` 为假即 `ok`）、`packages/core/src/test-environment.ts:582-596`（`allocatePort` 的 OS 探测与子进程 bind 之间存在窗口）
- 契约/AC：`execution.md` §5「服务端口由Supervisor动态分配…清理端口/容器/临时DB」；WP-07 输出「隔离DB/端口」；第 1 轮 W7R1-05 期望「就绪必须属于本环境启动的子进程」。
- 复现：`probe-testenv.mjs` `W7R1-05.d`：`create()` 分配端口后、`start()` 前，用真实 `net` 服务器占用该端口，再启动一个**从不监听**但存活的子进程（`setTimeout(()=>{},60000)`）⇒ `start.ok=true`、状态 `running`、`childAlive=true`（环境自己的命令从未 bind）。
- 观测 vs 期望：观测为把外部监听器当成自己的就绪环境；期望 `start` 返回 `INVALID_STATE`（无法证明端口归属）。
- 修复方向：就绪需归属证据（子进程经私有通道回报、或对比 socket inode/`lsof` 属主、或让子进程在 stdout 打印随机 token 且 Core 连上后校验），Port 探测与 bind 之间的窗口用「子进程自己 bind 成功才报告」的方式闭合。

### W7R2-08（P3）`create` 在认领端口后抛异常会永久泄漏该端口

- 位置：`packages/core/src/test-environment.ts:582-596`（`allocatePort` 先 `usedPorts.add`/`claimedPorts.add`）、`packages/core/src/test-environment.ts:355-366`（`create` 在 `allocatePort` 之后调用 `this.ports.createDir`，无 try/finally 释放）
- 契约/AC：`execution.md` §5（端口/临时资源必须清理）；AC-048/050 的隔离承诺。
- 复现：`probe-testenv.mjs` `W7R1-05.e`：注入 `createDir` 抛 `ENOSPC` 的端口实现；`create()` 抛出后 `claimedTestPorts()` 仍含该端口（`claimed:[48300]`），后续 `manager.create({portRange:{min:48300,max:48300}})` 失败 `PROVIDER_UNAVAILABLE`（进程级认领无法回收）。
- 观测 vs 期望：观测为该端口在本进程内永久不可用；期望异常路径释放认领（try/finally）并把失败以结果对象返回。
- 修复方向：`create` 用 try/finally→`releasePort`（或把 `createDir` 失败转成返回的 `PROVIDER_UNAVAILABLE`），并让 `claimedPorts` 只在真正持有环境时保留。

### W7R2-09（P3）合法工具结果 `null` 无法重放：持久值被当成「缺失」

- 位置：`packages/core/src/grants.ts:221-238`（`put` 用 `JSON.stringify(value ?? null)` 存 `'null'`；`get` 对 `JSON.parse` 得到的 `null` 返回 `undefined`）、`packages/core/src/grants.ts:176-188`（`InMemoryDeferredResultStore.get` 对 `undefined` 值同样返回 `undefined`）、`packages/core/src/grants.ts:848-858`（`replayOperation` 把 `undefined` 当不可解析）
- 契约/AC：AC-080「重试原操作返回原结果」；`implementation.md:12`（T1）「同输入重试**返回原结果且不重放执行**」。
- 复现：`probe-grants.mjs` `W7R2-NULL`：once Grant 的 executor 返回 `null`，首次 `executed`（`result:null`），同输入重试抛 `ProtocolError RECOVERY_REQUIRED … references result …, which the result store cannot resolve`。
- 观测 vs 期望：观测为把已记录的 `null` 结果当成缺失、报恢复态；期望重放 `null`。（`undefined` 结果同理。）
- 修复方向：给结果存储加「是否存在」的显式信号（`has(ref)` 或存 `{present:true,value}` 包装），`null`/`undefined` 与缺失区分。

### W7R2-10（P3）离线 blob GC 会删掉延迟结果 blob；清单随结果数线性增长且每次整体重写

- 位置：`packages/core/src/grants.ts:191-194` + `packages/storage/src/blobs.ts:48-53`（`DEFERRED_RESULT_MANIFEST` 经 `BlobStore.resolve` 落在 `<dataDir>/deferred-results/index.json`，**不在** `blobs/` 下，而结果 blob 在 `<dataDir>/blobs/<xx>/<hash>`）、`packages/storage/src/blobs.ts:147-155`（`collectGarbage` 只按调用方引用集合清扫 `blobs/**`）、`packages/core/src/grants.ts:265-271`（每次 put 重写整个清单）
- 契约/AC：`data.md` §4 离线 GC；AC-080 重放；`implementation.md:158` 残余 #6 已登记「`blobs.collectGarbage` 的引用集合目前只读数据库列，尚未把该清单纳入」。
- 复现：`probe-grants.mjs`：`W7R2-GC`：执行一次 once 后用 `store.blobs.collectGarbage(new Set())`（DB 派生引用集）⇒ 结果 blob 被删（`removed:1`）、清单文件仍在，随后重放 `RECOVERY_REQUIRED`。`W7R2-GROWTH`：40 条结果时清单从 116B 增到 4601B（每次 put 全量重写）。
- 观测 vs 期望：观测为离线 GC 后历史 once 结果不再可重放（记录已登记，但风险确认为真）；期望 GC 的引用集合包含清单及其引用的 blob，或结果存储改用数据库列/内容寻址引用。
- 修复方向：把 `deferred-results` 清单纳入 GC 引用根（并在 `data.md` 登记）；长期用数据库列或每结果一文件避免整体重写。

## 7. 记录对账（implementation.md T1..T7 ↔ 代码）

- **T1–T4 与 T7 的主要机制与代码一致**：Grant 生命周期/once 全绑定与原子认领、撤权编码、SecretStore 先鉴权后查 ref、Broker 准入顺序与「无 Docker 不回退」、容器加固计划、每跳网络决议、测试环境清理失败上报、Trust/Skill 边界与 trace、W7R1-04/09/10/12/13 的修复代码位置——本轮均在独立探针中复现。
- **T7 计数全部可核验**：44/885、14/156 与逐文件用例数（§2b）与记录一致；W7R1-11 修正项成立。
- **T7 记录中被代码否证的一处**：`implementation.md:138`「对 review/test，写操作仅在 `writeRoots` 内放行」——对 `bash`/`git` 不成立（W7R2-01），且 T3「源码只读」在 host 模式与「调用方 `writableRoots`」下不成立。
- **T3 网络条目的措辞**：「每跳先解析」已成立，但「准入」处未解析（W7R2-02），且未做地址钉扎（W7R2-03）；记录未声称后者，属**未覆盖边界**而非虚假声明。
- **T7 残余 #6（GC）**：本轮确认其后果（结果 blob 被删、重放失败），并补充「清单本身因位于 `<dataDir>/deferred-results/` 而不会被 GC 删除」这一细节。
- **T5 的三次「突变-还原」实验**：本轮的独立探针已在行为层面复现这些用例所要保护的性质（W7R1-01/06/13 的关键分支均被显式失败断言覆盖），但**未**在源码上重做突变（Review 不得改源码；见 §11 覆盖限制）——该实验仍属开发者自述。
- 未发现把未实现行为说成已实现的夸大；主要问题仍是「已实现但边界有洞」（W7R2-01 为重）。

## 8. 判定计数与阻断

| 严重度 | 第 1 轮 | 第 2 轮新增 | 阻断 |
|---|---|---|---|
| P0 | 0 | 0 | — |
| P1 | 3（全部关闭） | **1（W7R2-01）** | **是** |
| P2 | 4（全部关闭） | **3（W7R2-02/03/04）** | 否（记录并建议同批修复） |
| P3 | 6（全部关闭） | **6（W7R2-05..10）** | 否 |

- 关闭率：第 1 轮 13/13（100%）。
- 探针规模：7 个脚本 / **91** 用例；其中 15 条为缺陷/残余证据、76 条通过。
- 契约命令：6/6 退出 0；仓库 AC 切片重跑 unit 6 文件/128 例、integration 3 文件/24 例全通过。

## 9. 决定

**不能进入独立 Test。** 第 1 轮的 3 个 P1 与全部 P2/P3 已关闭并复现，但本轮在 WP-07 验收面上新增可稳定复现的 **P1（W7R2-01：只读角色经 `bash`/`git` 写源码、容器 `writableRoots` 提权）**，按规则 Verdict=FAIL，返回 Develop 修复；建议同批修复 3 个 P2（尤其 W7R2-01 同源的写边界建模与 W7R2-03 DNS 钉扎），修复后重新走独立 Review。P3 记录不阻断。

## 10. 覆盖限制（coverage limits）

1. 未读取任何开发/Test 聊天或会话；实现意图仅按正式文档与代码推断。
2. T5 的「突变-还原」实验未由本轮独立重做（Review 写入范围仅限本报告，不得改源码）；其保护性质由本轮的独立行为探针覆盖，但「用例在旧行为下会失败」仍属开发者自述。
3. DNS TOCTOU（W7R2-03）在离线环境下以「第二次解析」建模证明，未用真实可重绑定域名（无外部网络，且不宜改宿主解析）；其结构事实（fetcher 只收到 URL、无地址绑定位）已直接断言。
4. 容器侧仅在本轮用**真实 Docker** 跑了仓库自带集成套件（只读 rootfs/无网络/cap-drop/非 root/pid+内存，14 文件/156 例）；W7R2-01 的容器变体通过 `docker run` 参数（`:rw` 挂载）断言，未另起容器实测写盘；容器**网络代理**（`networkProxy`）本机未配置，未做真实出网经代理的端到端验证。
5. 跨进程验证使用真实第二 OS 进程（重放）与两个并发真实子进程（清单写者），但仍是单机、同一 SQLite 文件；无跨主机、无 `busy_timeout` 超时、无文件锁竞争的长时压测。
6. `pnpm test:integration` 按任务要求只运行一次；AC 切片为另一次定向重跑；未做 flakiness 重复。
7. 硬链接逃逸（W7R1-08）在路径包含性模型下仍不可阻断，按记录不主张阻断；macOS 无 `/proc`，`/proc` 类逃逸未单独探针。
8. `loadTrustedExtensions` 仍未接入 `apps/runner`（`implementation.md` 残余 #8，本轮未复核其接线），AC-053 只在加载器 API 面验证。
9. 未调用真实模型/Provider；`gatewaySecretResolver` 接线属 WP-09。
10. 持久化 Secret 后端（Keychain/加密文件）属安装范围，未验证。
11. NAT64 本地前缀（W7R2-06）的「可达内网」结论依赖目标网络确实部署本地用途 NAT64；本轮只断言分类结果（被判公网），未构造真实 NAT64 网络。

---

# WP-07 独立 Review 报告 · 第 3 轮（Review Round 3）

> 第 1 轮（第 1–263 行）与第 2 轮（第 264–549 行）报告保持原样未改；本文件自第 550 行起追加第 3 轮。已用 `git show HEAD:.agentdev/work/WP-07/review.md | shasum -a 256` 与本地文件前 549 行逐字节比对确认（见 §0）。

## 0. 元数据与冻结点

| 项 | 值 |
|---|---|
| 冻结点（task 指定） | `b1c5328` |
| `git rev-parse HEAD` | `b1c5328e4b6e11e73033e1b537c9d7c97cdbd6aa` |
| `git rev-parse b1c5328^{tree}` | `801f2464dec0bdf29af5349b833cc989b51267b5` |
| `git status --porcelain`（Review 写入前） | 空（工作树干净） |
| 第 1–2 轮 review.md 完整性 | 前 549 行 `shasum -a 256` = `6f6e85ea20030e6b5f2d76b6559f94b63cb8d55980eaeb36850e31dd91611e22`，与 `git show HEAD:.agentdev/work/WP-07/review.md` 一致（逐字节未改） |
| Review 写入范围 | 仅 `.agentdev/work/WP-07/review.md`；全部探针/日志在 `/tmp/wp07r3/` |
| 开发/Test 聊天 | 未读取；证据仅来自仓库文件、`dist` 构建产物、真实 SQLite/子进程/Docker 与本次独立探针 |
| Docker | 守护进程 **UP**（Server 28.4.0）；执行镜像 `agentdev/exec:0.0.0`（`sha256:edd3aa5051c7…`）在位；`pnpm test:integration` 的容器用例真实执行（无 skip） |
| 探针宿主 | macOS arm64 / Node v24.8.0（无 `/proc`，归属探针走 `lsof`） |

被审文件 Hash（`git hash-object` = 仓库 blob SHA-1）：

| 文件 | git blob |
|---|---|
| `packages/core/src/broker.ts` | `06b4c79711e6f40bac09539656872fdd8e07b2bb` |
| `packages/core/src/grants.ts` | `c829c9b338b2ecc1b5c9fa1712544563ddbc04ba` |
| `packages/core/src/test-environment.ts` | `d80ca603f07ae383d98896a1e874736261e6d8df` |
| `packages/core/src/secrets.ts` | `d574ac952aa4ca7a3bdf6d9bb92eff6484091ffa` |
| `packages/domain/src/permission.ts` | `8e7677b22b86cc9b4ac5ad226be271d14c0b2ec9` |
| `packages/pi-runtime/src/extensions.ts` | `6dd9b76905931f6c95176de62cbaf6c2646437fe` |
| `.agentdev/work/WP-07/implementation.md` | `5e8097d597b682e8674e4a5457659c3a726d9174` |

## 1. 结论（verdict）

**PASS** —— 第 2 轮的 **1 个 P1（W7R2-01）与 3 个 P2、6 个 P3（W7R2-01..10）全部关闭**，并由本轮独立探针逐条复现为已修复；四个必需失败测试（符号链接/私网/重定向、Secret 泄漏、进程清理失败、无 Docker 拒绝）与 AC-048..051/053/080 代表切片全部通过；6 条契约命令全部退出 0。

本轮在**同一验收面**上新增 **2 个 P2、3 个 P3（W7R3-01..05）**，均为非阻断缺陷/记录不一致（详见 §6）：
- P2：只读角色的 `run` 工具体仍可绕过能力分类写源码/执行 shell（W7R3-01）；异步 `run` 体未被 await，结果被记录为 Promise、重放得到 `{}`、失败体被记为 finished 并产生未处理拒绝（W7R3-02）。
- P3：传输失败逃逸为异常（W7R3-03）；`portAvailable` 抛异常逃出 `create()`（W7R3-04）；字面量目标实际带 pin，与注释/T8 残余声明不符（W7R3-05）。

**能否进入独立 Test：可以。** 无 P0/P1 可复现；按任务规则 P2/P3 记录不阻断，建议随 Test 反馈回 Develop 一并修复。

## 2. 契约命令原始结果

全部命令在冻结点 `b1c5328`（tree `801f2464`）工作树干净状态下真实执行一次；原始日志 `/tmp/wp07r3/logs/commands.log`。

| 命令 | 原始结果 | 结论 |
|---|---|---|
| `pnpm typecheck` | `$ tsc -p tsconfig.json --pretty false`；`EXIT=0` | 通过 |
| `pnpm lint` | `$ node scripts/lint.mjs`；`Checking formatting...`；`All matched files use Prettier code style!`；`EXIT=0` | 通过 |
| `pnpm test:unit` | `Test Files 44 passed (44)` / `Tests 905 passed (905)` / Duration 12.28s；`EXIT=0` | 通过（与 `implementation.md` T8 的 44/905 一致） |
| `pnpm test:integration` | `Test Files 15 passed (15)` / `Tests 157 passed (157)` / Duration 23.67s；`EXIT=0`；容器用例真实执行（`✓ runs as the non-root execution account`、`✓ keeps the root filesystem read-only`、`✓ drops every Linux capability`、`✓ has no network access but a working name resolver`、`✓ applies the pid and memory limits`），无 skip | 通过（与 T8 的 15/157 一致） |
| `pnpm docs:check` | `docs:check ok — 15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages`；`EXIT=0` | 通过 |
| `pnpm build` | `pnpm -r build`：contracts/pi-runtime/domain/knowledge/storage/workspace/core/cli/daemon/runner 共 10 workspace 全 `Done`；`EXIT=0` | 通过 |

命令尾部原始输出：

```
$ pnpm typecheck
EXIT(pnpm typecheck)=0
$ pnpm lint
Checking formatting...
All matched files use Prettier code style!
EXIT(pnpm lint)=0
docs:check ok — 15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages
EXIT(pnpm docs:check)=0
packages/core build: Done
apps/daemon build: Done
apps/runner build: Done
EXIT(pnpm build)=0
 Test Files  44 passed (44)
      Tests  905 passed (905)
EXIT(pnpm test:unit)=0
 Test Files  15 passed (15)
      Tests  157 passed (157)
EXIT(pnpm test:integration)=0
```

### 2b. 四个必需失败测试 + AC 代表切片的重跑（仓库自带用例）

日志 `/tmp/wp07r3/logs/ac-unit.log`、`/tmp/wp07r3/logs/ac-integration.log`：

| 批次 | 结果 | 退出码 |
|---|---|---|
| unit：`permissions-failures.test.ts`(4) + `broker.test.ts`(47) + `grants.test.ts`(36) + `secrets.test.ts`(27) + `permission-delivery.test.ts`(20) + `trust.test.ts`(14) | `Test Files 6 passed (6)` / `Tests 148 passed (148)` | `0` |
| integration：`permissions.integration.test.ts`(11) + `broker.integration.test.ts`(8) + `secrets.integration.test.ts`(5) + `grants.integration.test.ts`(1) | `Test Files 4 passed (4)` / `Tests 25 passed (25)` | `0` |

逐文件用例数与 T8 记录一致（broker 47、grants 36、failures 4、permissions.integration 11、broker.integration 8、secrets.integration 5、grants.integration 1）；unit 切片 128→148、integration 切片 24→25 与 T8 的 +20/+1 一致。

## 3. 方法（每个脚本与用例数）

全部探针消费**已构建产物**（`packages/*/dist/index.js` 绝对路径导入），不 import 任何产品测试文件；真实 SQLite（`ProjectStore` 文件）、真实 `node` 子进程、真实第二/第三个 OS 进程、真实 OS 端口监听器、真实本机回环 HTTP 服务器、真实 Docker（仅仓库自带集成套件）。所有网络探针**离线**：桩解析器（`HostResolver`）与桩/本机 fetcher，不发外部请求。脚本与日志在 `/tmp/wp07r3/`，一键脚本 `/tmp/wp07r3/run-all.sh`，全量日志 `/tmp/wp07r3/logs/all.log`。

| 脚本 | 用例数 | 覆盖 |
|---|---|---|
| `probe-capability.mjs` | 16 | W7R2-01（host bash/git、无 roots、access=write、容器 rw 剥离、容器内 bash 拒绝、report-root 正例、源码拒绝、写角色可用、未知工具 fail-closed、非路径 mutating、`push`、符号链接逃逸、`..` 逃逸）+ W7R3-01 两条 hunt |
| `probe-network3.mjs` | 15 | W7R2-02（私网/不可解析准入前拒绝 + Grant 未消费 + 零行、公网正例、授权名带 pin、rebinding 在传输跳拒绝）、W7R2-03（fetcher 收到 pin、内建传输连到 pin、第二地址不可达、重定向每跳）、W7R2-05（解析器抛异常）、W7R2-06（NAT64 本地前缀/可配置前缀/不可解码 fail-closed）+ 传输异常 hunt |
| `probe-grants3.mjs` | 9 | W7R2-04（同目录两 store 立即可见、两并发进程 50 条零丢失、旧 manifest 只读兼容）、W7R2-09（null/undefined 重放、缺失 ref 仍 RECOVERY_REQUIRED）、W7R2-10（离线 GC 不删活结果、GC 引用根含 per-ref 与旧 manifest blob、无共享 manifest 增长） |
| `probe-testenv3.mjs` | 9 | W7R2-07（外部监听器 + 存活非监听子进程 ⇒ INVALID_STATE、真监听正例、探针不可用/外部 pid fail-closed、后代进程绑定正例、监听错端口不 running）、W7R2-08（createDir 抛错释放端口并返回结果对象、cleanup 后端口可复用）+ `portAvailable` 抛异常 hunt |
| `probe-ac.mjs` | 11 | AC-048.p1/n1、AC-049.p1/n1、AC-050.n1、AC-051.p1/n1、AC-053.p1、AC-080.p1/n1/p2 |
| `probe-broker.mjs` | 16 | **四个必需失败测试**（REQ-1 符号链接/私网/重定向、REQ-2 Secret 泄漏、REQ-3 进程清理失败、REQ-4 无 Docker 拒绝 + REQ-3b 控制组）与 W7R1-04/09/13 回归 |
| `probe-async.mjs` | 4 | W7R3-02（异步体结果=Promise、重放 `{}`、失败体 finished + 未处理拒绝）与 W7R3-01（被准入的 report 写体内嵌 shell 写源码） |
| `probe-records.mjs` | 5 | T8 记录对账：能力分类矩阵、导出面、`Broker.invoke` 为 AsyncFunction、同步 `checkTarget` 残余、字面量 pin 与注释不符 |
| **合计** | **85** | 其中 **9** 条断言失败 = 本轮 5 个新 Finding 的证据（其余 76 条通过） |

## 4. 第 2 轮 Finding 关闭核验（W7R2-01..10）

| 编号 | 严重度 | 关闭判定 | 独立证据（本轮到具体用例） |
|---|---|---|---|
| W7R2-01 只读角色经 bash/git 写源码；容器 `writableRoots` 提权 | P1 | **关闭** | `probe-capability` 01.a/01.b/01.c/01.d：review 的 `bash`/`git`（含不声明 roots、显式 `access:'write'`）一律 `NOT_AUTHORIZED`、源码字节不变、零 `tool_operation`；01.e：容器模式挂载 `…:/workspace:ro` + `…/reports:/mnt/agentdev-1:rw`，无 `<ws>:/workspace:rw`；01.f：容器内 bash 在任何 `docker` 进程前被拒；01.g：report root 内写仍 `executed` 并落盘；01.h/01.m/01.n：源码、report root 内符号链接、`reports/../src/feature.ts` 均拒绝且源码不变；01.i：backend 的 `bash`/`git` 仍 `executed`；01.j/01.k：未知名（`frobnicate`）与 `push` 对只读角色 fail-closed；01.l：写角色对未在 Work 范围内的未知操作也不静默执行（签发即被范围拒绝、准入无 Grant） |
| W7R2-02 准入早于 DNS、拒绝仍消费 Grant | P2 | **关闭** | `probe-network3` 02.a：`localtest.example→127.0.0.1` 在准入即 `NOT_AUTHORIZED`，`consumedAt=null`、`toolOperations=0`、工具体零执行；02.b：不可解析名同样；02.c：公网字面量仍 `executed` 且消费 + 1 行（非空洞）；02.d：精确授权名仍准入且 fetcher 收到 pin `['127.0.0.1']`；02.e：rebinding（首次公网、二次私网）在传输跳被拒、`fetches=0` |
| W7R2-03 DNS TOCTOU、未钉扎地址 | P2 | **关闭** | `probe-network3` 03.a：fetcher 收到 `pinnedAddresses=['93.184.216.34']`；03.b：内建传输经 pin 连到本机服务器（`rebind.test` 在 DNS 中不存在，只能由 pin 解释）`status=200`、`serverHits=1`、`resolutions=1`；03.c：首次答案公网 + 本机 server 在第二答案地址上 ⇒ `serverHits=0`、`resolutions=1`（未触及第二地址）；03.e：302 到私网名第 2 跳拒绝且只 fetch 首跳 |
| W7R2-04 持久延迟结果非多写者安全 | P2 | **关闭** | `probe-grants3` 04.a：同目录两个 store 互见对端结果（无陈旧缓存）；04.b：两个真实子进程各写 25 条 ⇒ `refs=50/unique=50/missing=0/files=50`，第三 store 全部可解析；04.c：旧 `deferred-results/index.json` 布局仍只读可解析 |
| W7R2-05 解析器抛异常逃逸 | P3 | **关闭** | `probe-network3` 05.a：`decide()` 返回 `NOT_AUTHORIZED`（reason 含 `resolver exploded`），`GuardedRequester.request()` 返回 `{ok:false}` 而非抛出；05.b：Broker 准入同样拒绝、无异常、Grant 未消费 |
| W7R2-06 本地用途 NAT64 被判公网 | P3 | **关闭** | `probe-network3` 06.a：`64:ff9b:1::7f00:1`、`64:ff9b:1::a00:1`、`64:ff9b::7f00:1` 均 `true`，`NetworkPolicy.decide('https://[64:ff9b:1::7f00:1]/')` 拒绝；06.b：可配置前缀 `2001:db9:64::/96` 生效（默认前缀下同地址为 `false`）、不可解码布局判内网（fail-closed） |
| W7R2-07 就绪归属不能证明 | P3 | **关闭** | `probe-testenv3` 07.a：真实外部监听器占住 `127.0.0.1:49300` + 存活但从不监听的子进程 ⇒ `INVALID_STATE`，reason 含 `owned by pid 53977, not by the started command (pid 53997)`、状态 `failed`；07.b：真监听子进程仍 `running`（owner=childPid，非空洞）；07.c：探针不可用 ⇒ `INVALID_STATE`；07.d：外部 pid 999999 ⇒ `INVALID_STATE`；07.e：`sh -c node` 的后代进程绑定仍 `running`（所有权按进程树，不误伤）；07.f：监听错端口 1.5s 后 `PROVIDER_UNAVAILABLE`/`failed` |
| W7R2-08 `create` 认领端口后抛异常泄漏 | P3 | **关闭** | `probe-testenv3` 08.a：注入 `createDir` 抛 `ENOSPC` ⇒ 返回结果对象 `PROVIDER_UNAVAILABLE`、`claimedTestPorts()` 不含 49310、随后同端口 `create` 成功；08.b：`cleanup` 释放进程级认领后同端口可复用 |
| W7R2-09 合法 `null` 结果无法重放 | P3 | **关闭** | `probe-grants3` 09.a：once 体返回 `null` ⇒ 首次 `executed`/`result=null`，重试 `replayed`/`result=null`；09.b：`undefined` 同样 `replayed`；09.c：显式注入全新内存 sink 时仍如实 `RECOVERY_REQUIRED`（缺失路径未被掩盖） |
| W7R2-10 离线 GC 删除延迟结果 | P3 | **关闭** | `probe-grants3` 10.a：`blobs.collectGarbage(new Set())` 返回 `[]`（结果文件在 `blobs/**` 之外），随后重放 `replayed`/`{sentinel:true}`；10.b：`deferredResultGcRoots` 含 per-ref 记录与旧 manifest，`collectProjectGarbage` 保留旧 manifest 引用的 blob 且已无共享 manifest；10.c：40 次 `put` ⇒ 40 个 per-ref 文件、无 `index.json`、ref 全唯一 |

**小结：W7R2-01..10 全部关闭**（10/10），无一条需要重开。

## 5. 逐 AC 结论

| AC | 结论 | 依据 |
|---|---|---|
| **AC-048 Workspace 边界** | **通过** | `probe-ac` AC-048.p1：容器计划含 `--read-only`/`--tmpfs`/`--cap-drop=ALL`/no-new-privileges/`--pids-limit 256`/`--memory 2g`/`--cpus 2`/`--user 10001:10001`/`:ro`/默认 `--network none`；AC-048.n1：符号链接在 host/container 两模式均 `NOT_AUTHORIZED` 且零读；`probe-network3`：私网/不可解析/rebinding/重定向/明文 http 与 NAT64 全在准入或每跳被拒；`probe-broker` REQ-4：无 Docker ⇒ `PROVIDER_UNAVAILABLE`、零进程、零行、绝不回退 host。残余（非阻断）：传输错误抛出（W7R3-03）与工具体自建传输（T8 残余 1，已登记） |
| **AC-049 Autonomous 范围** | **通过** | `probe-ac` AC-049.p1：范围内调用执行并落 `tool_operation finished` + `grant.issued`/`tool.invoked`；AC-049.n1：越界目标/错 operation/过期 Grant 分别拒绝（`NOT_AUTHORIZED`/`NOT_AUTHORIZED`/`AUTH_EXPIRED`），零 `tool_operation` 行 |
| **AC-050 Full Access 门禁** | **通过（含 P2 残余）** | `probe-ac` AC-050.n1：host 模式 review 写源码被拒且源码不变、读运行库被拒；`probe-capability` 01.a–01.n：bash/git/未知/非路径 mutating 全拒、report root 边界（含符号链接与 `..` 逃逸）成立、容器 rw 剥离、写角色不受影响。**残余（P2，W7R3-01）**：只读角色的 `run` 工具体经 `ToolContext.writeFile`/`run` 仍可写源码/执行 shell；因该体由 Core 提供、当前无生产调用点，故记 P2 而非阻断 |
| **AC-051 Secret 隔离** | **通过** | `probe-ac` AC-051.p1/n1：诱饵经真实 node 子进程送达已授权 Run，兄弟 Run `NOT_AUTHORIZED` 且拿不到；查询面/`JSON.stringify`/`list`/`refs` 零明文；`probe-broker` REQ-2：日志/嵌套 UI payload 命中，`maskAll`/`redactValue` 后零命中，store JSON/list 无泄漏 |
| **AC-053 信任与资源** | **通过** | `probe-ac` AC-053.p1：未信任项目零读零 import，信任后仅「显式选中 ∧ 发布白名单」才 import（import 计数=1）；`probe-broker`/T7 回归：逃逸符号链接零读 `refused/VALIDATION_ERROR`；`trust.test.ts` 14 例全通过 |
| **AC-080 授权精确绑定** | **通过（含 P2 残余）** | `probe-ac` AC-080.p1：首次 `executed`、同输入 `replayed` 且执行计数=1、异 inputHash `IDEMPOTENCY_CONFLICT`；AC-080.n1：兄弟 Run 对 once/run Grant 均拒绝（`fields=['runId']`）；AC-080.p2：work 作用域两 Run 均可用；`probe-grants3`：跨进程/多写者重放与 `null` 重放成立。**残余（P2，W7R3-02）**：异步 `run` 工具体的结果被记录为 Promise，`once` 重放得到 `{}`（同步体不受影响） |

### 四个必需失败测试（独立复现 + 仓库自带）

| 必需失败测试 | 独立复现（`probe-broker.mjs`） | 仓库用例 |
|---|---|---|
| 符号链接/私网/重定向 | **通过** REQ-1：符号链接读 `NOT_AUTHORIZED` 且外部文件不变；私网字面量准入拒绝；公网→私网 302 第 2 跳拒绝且 `hops` 只有首跳 | `permissions-failures.test.ts`(4) + `broker.test.ts` 相关例 |
| Secret 泄漏 | **通过** REQ-2：scan 命中日志 1 处、嵌套 payload 2 处；store JSON/list/refs 无明文；mask/redact 后零命中 | 同上 |
| 进程清理失败 | **通过** REQ-3：真实子进程 + 注入 SIGTERM/SIGKILL 与目录删除失败 ⇒ `RECOVERY_REQUIRED`、`failures` 逐条列出、状态 `cleanup_failed`；REQ-3b 真实环境正常清理 | 同上（标题逐字含「进程清理失败」） |
| 无 Docker 拒绝 | **通过** REQ-4：`PROVIDER_UNAVAILABLE`、原样原因、`fields=['mode']`、零进程、零 `tool_operation` 行 | 同上 |

## 6. Findings（第 3 轮新增）

### W7R3-01（P2）只读角色的 `run` 工具体仍可写源码/执行 shell —— 能力分类只看 `operation` 名

- 位置：`packages/core/src/broker.ts:290`（`READ_ONLY_OPERATIONS` = read/search/network/secret）、`packages/core/src/broker.ts:304-306`（`toolCapability` 按 **operation 名**分类）、`packages/core/src/broker.ts:1811-1836`（角色门禁只判 operation 能力）、`packages/core/src/broker.ts:1989-1990`（`execute` 无条件执行 `invocation.run(context)`）、`packages/core/src/broker.ts:2057-2081`（`ToolContext` 对任何角色都暴露 `writeFile`/`run`；`writeFile` 的 open 时复查用 `access` 推导的 roots，`broker.ts:2042-2056`）
- 契约/AC：AC-050「Review/Test 仍隔离」；`docs/architecture/execution.md` §1「确保**源码**只读」、§3 角色表只给 Review/Test「自己报告与检查临时目录」；`implementation.md:166`（T8）声称「对 review/test：**任意** mutating 工具被拒」。
- 复现（离线、真实文件）：
  - `node /tmp/wp07r3/probe-capability.mjs` 用例 `W7R2-01.o`：签发 `role=review, operation=read, targets=[src/feature.ts]` 的 run Grant，以 `run: (ctx) => ctx.writeFile(<ws>/src/feature.ts, 'pwned-via-run-writeFile')` 调用 ⇒ `outcome=executed`，源码变为 `pwned-via-run-writeFile`。
  - 同脚本 `W7R2-01.p`：`run: (ctx) => ctx.run("printf 'pwned-via-run-shell' > <ws>/src/feature.ts")` ⇒ 源码变为 `pwned-via-run-shell`（host 模式 `/bin/sh -lc`，无任何文件边界）。
  - `node /tmp/wp07r3/probe-async.mjs` 用例 `W7R3-BODY.a`：review 被**准入**的 report-root 写（`operation=write`，report root 内）内嵌 `ctx.run(...)` ⇒ 源码被改（即 report 写通道本身可携带任意命令）。
- 观测 vs 期望：观测为「只读角色的写通道只要换成 `run` 工具体即可绕过能力门禁」；期望 Review/Test 在**所有**工具体下都写不到源码/验证输入，`ToolContext` 不向只读角色提供未受限的 `run`，且 `writeFile` 对只读角色恒以 `writeRoots` 为界。
- 严重度依据：`ToolInvocation.run` 是公开 API（`broker.ts:1556`）且是 `network`/`secret` 等只读操作既定接缝，但该体由 Core 工具层提供、当前仓库 `Broker.invoke` 无生产调用点（`grep -rn "\.invoke(" apps packages --include=*.ts` 仅测试），Agent 无法仅凭工具输入构造该体，故非现网可利用漏洞 ⇒ P2。
- 修复方向：(a) 只读角色不注入 `context.run`（或注入即抛 `NOT_AUTHORIZED`）；(b) `context.writeFile` 对只读角色与 `access` 无关地限定在 `writeRoots`，无 report root 即拒绝；(c) 或在 `invocation.run !== undefined` 时按「任意命令能力」分类并拒绝只读角色；文档同步收紧 T8 的「任意 mutating 工具被拒」。

### W7R3-02（P2）异步 `run` 工具体未被 await：结果记录为 Promise、重放得到 `{}`、失败体记为 finished 并产生未处理拒绝

- 位置：`packages/core/src/broker.ts:1556`（`readonly run?: (context: ToolContext) => unknown`，允许返回 Promise）、`packages/core/src/broker.ts:1989-1990`（`execute` 直接 `return invocation.run(context)`）、`packages/core/src/grants.ts:871-872`（`const executed = request.executor(); const resultRef = results.put(executed);`，无 await）、`packages/core/src/grants.ts:270-282`（持久存储 `JSON.stringify({present:true, value})` 把 Promise 写成 `{}`）
- 契约/AC：AC-080「once … 原子消费且**重试原操作返回原结果**」；`implementation.md:12`（T1）「同输入重试**返回原结果且不重放执行**」；`reliability.md` §2（未知/失败结果不得当成完成）。`implementation.md:61`（T6 残余 #3）已登记「执行器同步 vs 传输异步」的接缝限制，但未登记本条的后果。
- 复现（离线、真实 SQLite）：
  - `node /tmp/wp07r3/probe-async.mjs` 用例 `W7R3-ASYNC.a`：`once` Grant + 异步体（10ms 后返回 `'SENTINEL-ASYNC'`）⇒ 首次 `executed`、`typeof result.then === 'function'`；同输入重试 `replayed` 但 `result === {}`（观测输出 `retryResult:{}`、`retryResultType:"object"`）——记录的「原结果」已不是工具返回值。
  - 用例 `W7R3-ASYNC.b`：异步体 10ms 后抛 `tool body exploded` ⇒ `invoke` 仍返回 `outcome=executed`，`tool_operation.state=finished`（`resultRef` 指向 `{}`），随后进程收到未处理拒绝 `tool body exploded`；本轮在未加处理器时已实际观察到 Node `triggerUncaughtException` 终止进程（`probe-network3` 首次运行）。
- 观测 vs 期望：观测为「结果=Promise、重放=`{}`、失败体=已完成、拒绝未处理」；期望在记录结果前 await 工具体（或显式拒绝返回 thenable 的体），失败体不得留下 `finished`，`once` 重试必须返回原结果。
- 修复方向：把执行移出同步事务（先提交 `prepared` → await 体 → 再写 `finished`/`resultRef`），或对返回 thenable 的体 fail-closed（`VALIDATION_ERROR`/`INVALID_STATE` + 回滚）；`GrantConsumeRequest.executor` 与 `ToolInvocation.run` 的类型应收紧为同步，或在文档中明确异步体不受支持（当前实现是**静默损坏**，不是明确拒绝）。

### W7R3-03（P3）传输失败（ECONNREFUSED 等）不是结构化拒绝，而是重新抛出

- 位置：`packages/core/src/broker.ts:1374`（`const response = await this.fetcher(...)` 无 try/catch）、`packages/core/src/broker.ts:1235-1241`（`defaultNetworkFetcher`/`pinnedNodeRequest` 以 reject 结束）
- 契约/AC：AC-048/049 的「失败以契约错误码上报」；`reliability.md` §2。
- 复现：`node /tmp/wp07r3/probe-network3.mjs` 用例 `W7R2-03.d`：fetcher 立即抛 `connect ECONNREFUSED 93.184.216.34:443` ⇒ `GuardedRequester.request()` 抛出该异常（`NetworkFetchOutcome` 的 `{ok:false,code}` 未覆盖此情形）。
- 观测 vs 期望：观测异常逃逸（叠加 W7R3-02 后成为未处理拒绝）；期望闭合为 `NetworkFetchOutcome`（如 `PROVIDER_UNAVAILABLE`/`INVALID_STATE` + 原因），或在类型/文档中明确「传输错误抛出」，让调用方必须显式处理。
- 修复方向：在 `GuardedRequester.request` 包一层 try/catch，把传输错误转成带 code/reason 的拒绝结果。

### W7R3-04（P3）`portAvailable` 探针抛异常会逃出 `create()`（认领前路径）

- 位置：`packages/core/src/test-environment.ts:497`（`allocatePort` 调用在 `try` 之外）、`packages/core/src/test-environment.ts:749`（`if (!(await this.ports.portAvailable(port))) continue;`）、`packages/core/src/test-environment.ts:506`（`try` 从 `createDir` 开始）
- 契约/AC：W7R2-08 的同一契约（`implementation.md:204` 只声称「端口认领**之后**的所有步骤包进 try」，与代码一致，属未覆盖边界）；`execution.md` §5（端口/临时资源失败需可判定）。
- 复现：`node /tmp/wp07r3/probe-testenv3.mjs` 用例 `W7R2-08.c`：注入 `portAvailable: () => { throw new Error('probe exploded') }` ⇒ `create()` 以异常 reject（`threw:"probe exploded"`），而非返回结果对象；无端口泄漏（认领发生在探针之后，`claimedTestPorts()` 不含该端口）。
- 观测 vs 期望：观测异常；期望与 W7R2-08 同样返回 `PROVIDER_UNAVAILABLE` 结果对象，或在 `TestEnvironmentPorts` 文档中明确探针不得抛出。
- 修复方向：把 `allocatePort`（或至少 `portAvailable` 调用）纳入 try/catch，把探针异常转为结果对象。

### W7R3-05（P3）字面量目标实际带 pin，与注释/T8 残余声明不一致

- 位置：`packages/core/src/broker.ts:489-497`（`NetworkPolicyDecision.ok.addresses` 注释「Absent for a literal (whose URL host already *is* the address)」）、`packages/core/src/broker.ts:872`（`classifyHostResolution` 对字面量返回 `{ classification: literal, addresses: [normalized] }`）、`implementation.md:227`（T8 残余 1「另外字面量目标不带 pin（URL host 即地址）」）
- 契约/AC：记录一致性（`implementation.md` ↔ 代码）；AC-048。
- 复现：`node /tmp/wp07r3/probe-records.mjs` 用例 `REC.d`：`new NetworkPolicy({}).decide({url:'https://93.184.216.34/'})` ⇒ `{ok:true, addresses:['93.184.216.34']}`，而注释声称 absent。
- 观测 vs 期望：观测字面量带 pin（行为更保守：内建传输对字面量也走 `pinnedLookup`，无安全缺陷）；期望注释与 T8 残余改成「字面量同样携带其自身地址」，或代码不返回 addresses。
- 修复方向：改注释与 `implementation.md:227`（推荐），或对字面量不返回 `addresses`。

## 7. 记录对账（implementation.md T1..T8 ↔ 代码）

- **T8 验证数字全部可核验**：`pnpm test:unit` 44/905、`pnpm test:integration` 15/157 与实际一致；+20 = `broker.test.ts` 32→47（+15）、`grants.test.ts` 31→36（+5）；集成 +1 = 新增 `grants.integration.test.ts` 1 例；Docker 用例真实执行。
- **T1–T7 主要机制与代码一致**：本轮对 W7R1-04/09/13、W7R2-01..10 的机制逐条独立复现（§4、§5）；`checkTarget` 仍为同步快路径（`broker.ts:1007`）；旧的 `WRITE_OPERATIONS`/`isWriteOperation` 已从 `broker.ts` 删除（domain 的 `WORKSPACE_WRITE_OPERATIONS` 与本包无关）；`Broker.prototype.invoke` 为 `AsyncFunction`，生产代码无 `.invoke(` 调用点（仅测试）。
- **被代码否证/需修正的记录（3 处）**：
  1. `implementation.md:166`「对 review/test：**任意** mutating 工具被拒」——对 `operation` 名为只读、但携带 `run` 工具体的调用不成立（W7R3-01）。
  2. `implementation.md:12`（T1）/AC-080「同输入重试返回原结果」——对异步 `run` 工具体不成立，重放返回 `{}`（W7R3-02）；T6 残余 #3 只登记了同步执行器接缝，未登记该后果。
  3. `implementation.md:227`（T8 残余 1）「字面量目标不带 pin」——代码实际携带 pin（W7R3-05）。
- **T5 的「突变-还原」实验**：本轮的独立行为探针已复现这些用例所要保护的性质（W7R1-01/06/13 的关键分支），但**未**在源码上重做突变（Review 不得改源码；见 §10）——该实验仍属开发者自述。
- **T8 残余 1（注入 fetcher 不兑现 pin）**：本轮确认其为接缝契约（03.c 用内建传输证明第二地址不可达；内建传输之外不做承诺），与记录一致。
- 未发现把未实现行为说成已实现的夸大；本轮问题集中在「已实现但边界有洞」与少量记录漂移。

## 8. 判定计数与阻断

| 严重度 | 第 1 轮 | 第 2 轮新增 | 第 3 轮新增 | 阻断 |
|---|---|---|---|---|
| P0 | 0 | 0 | 0 | — |
| P1 | 3（全部关闭） | 1（W7R2-01，已关闭） | **0** | — |
| P2 | 4（全部关闭） | 3（全部关闭） | **2（W7R3-01/02）** | 否 |
| P3 | 6（全部关闭） | 6（全部关闭） | **3（W7R3-03/04/05）** | 否 |

- 关闭率：第 1 轮 13/13、第 2 轮 10/10（合计 23/23，100%）均由本轮独立复现。
- 探针规模：8 个脚本 / **85** 用例；9 条断言失败 = 5 个新 Finding 的证据，76 条通过。
- 契约命令 6/6 退出 0；AC 切片重跑 unit 6 文件/148 例、integration 4 文件/25 例全通过。

## 9. 决定

**可以进入独立 Test。** 第 2 轮的 1 个 P1 与全部 P2/P3（W7R2-01..10）已关闭并逐条复现；四个必需失败测试与 AC-048..051/053/080 代表切片通过；6 条契约命令全绿；本轮无 P0/P1。新登记的 2 个 P2（W7R3-01 只读角色的 `run` 工具体写通道、W7R3-02 异步工具体的结果记录/重放）与 3 个 P3 按任务规则不阻断，但**应在 Test 阶段一并回 Develop 修复**：W7R3-01/02 涉及 `ToolContext` 与结果记录的契约形状，若不修，接入真实工具层（`network`/自定义工具体）时会使 AC-050/AC-080 在运行期失效。

## 10. 覆盖限制（coverage limits）

1. 未读取任何开发/Test 聊天或会话；实现意图仅按正式文档与代码推断。
2. T5 的「突变-还原」实验未由本轮独立重做（Review 写入范围仅限本报告，不得改源码）；其保护性质由行为探针覆盖，「用例在旧行为下会失败」仍属开发者自述。
3. 容器侧仅用**真实 Docker** 跑了仓库自带集成套件（15 文件/157 例，含只读 rootfs/`cap-drop`/非 root/pid+内存/无网络+可用解析器）；W7R2-01 的容器变体（`writableRoots` 剥离）以 `docker run` 参数断言（`<ws>:/workspace:ro`、report 根 `:rw`），未另起容器实测写盘；容器网络代理（`networkProxy`）本机未配置，未做真实出网经代理的端到端验证。
4. 网络探针全部离线（桩 resolver/fetcher + 本机回环 HTTP 服务器）；`W7R2-03.c` 中直连 `93.184.216.34` 在 5s 内未 settle（记录 `PROBE_TIMEOUT`），「未触及第二地址」由「本机服务器 0 次命中 + 仅发生 1 次解析」证明；未使用真实可重绑定域名。
5. 跨进程验证为同机真实子进程 + 同一 SQLite 文件；无跨主机、无长时压测；进程级 `claimedPorts` 只在本进程内有效（跨进程端口唯一性仍靠 OS 探测）。
6. W7R3-01/02 为库级探针复现；因当前仓库内 `Broker.invoke` 无生产调用点、`run` 体由 Core 提供，未评估 apps 接线后的实际可利用性与严重度（故按 P2 记录）。
7. macOS 无 `/proc`，`test-environment.ts` 的 Linux `/proc` 归属分支未在本机执行；本机归属探针走 `lsof`（可用），`/proc` 路径属静态审阅。
8. 硬链接逃逸（W7R1-08）在路径包含性模型下仍不可阻断，按记录不主张阻断。
9. 未调用真实模型/Provider；`gatewaySecretResolver`/Secret 注入接线属 WP-09；`loadTrustedExtensions` 未接入 session 创建（T6 残余 #8），AC-053 只在加载器 API 面验证。
10. 持久化 Secret 后端（Keychain/加密文件）属安装范围，未验证；契约命令按任务要求各只运行一次（AC 切片为另一次定向重跑），未做 flakiness 重复。
