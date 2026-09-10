# WP-00 独立 Test 报告（工具链与执行底座）

- role: test（独立验证；未读取任何开发聊天，输入仅为正式文档、冻结代码与本机实测输出）
- work package: WP-00（`docs/delivery/implementation.md` §2）
- 关联验收：AC-048、AC-066、AC-067（`docs/delivery/acceptance.md`）
- 本包必验范围：镜像/权限探测、Pi SDK 生命周期与资源加载、Critical/可选扩展注册
- 必需失败测试：依赖安装、SDK 创建/取消/压缩、资源控制、只读挂载负例
- 执行时间：2026-09-11 00:26–00:34（本机时区）
- 结论：**FAIL**（见 §8；行为层面未发现真实产品缺陷，FAIL 由必需失败测试证据无效与交付接口缺陷导致）

## 0. 输入与证据绑定

| 项 | 值 |
|---|---|
| `git rev-parse HEAD` | `6cdbb752c62d1fcaef9bf7a2209353a6a500333e`（仅文档基线提交） |
| 工作树状态 | WP-00 全部产出**已 staged、未 commit**：`git status --porcelain` = 57 条，全部 `A ` |
| 测试期间索引变动 | 开始时 `.agentdev/work/WP-00/implementation.md` 为 untracked，结束时已变为 staged；**源码/配置/测试文件未变** |
| 被测代码树 digest | `git ls-files -s`（排除 `.agentdev/`）排序后 sha256 = `b34d688d74896cb7fefb77aac5b85eb58dff52d42e8c223a13e44b60b6b4b8fb` |
| 最新源码 mtime | 00:25:10（`apps/cli/test/container.integration.test.ts`）；全部测试命令在该时刻之后运行 |
| node | v24.8.0 |
| pnpm | 12.3.4（`/Users/huyaohua/.local/bin/pnpm`，实为 Mach-O 二进制） |
| PATH 说明 | 默认 PATH 已将 `~/.local/bin` 置于 `/opt/homebrew/bin` 之前；`/opt/homebrew/bin/pnpm --version` 实测抛 `ERR_MODULE_NOT_FOUND`（cjs loader 崩溃），即文档描述的"坏 shim"确实存在但不被命中 |
| Docker | 28.4.0（daemon 可达） |
| git | 2.39.3 (Apple Git-146) |
| 执行镜像 | `agentdev/exec:0.0.0` → imageId `sha256:ffb122b2e4f2f5463692af3ac4a0df8be1437fce26a7dab6ce3097dbf29a21ff`，digest `agentdev/exec@sha256:ffb122b2…a21ff`（**重建后**；首次 `doctor` 记录为 `sha256:8fc05469596d…16d4b`，见 F5） |
| 原始日志与复现脚本 | `/tmp/wp00-test/**`（下表逐个给出 sha256） |

所有命令均以 `export PATH="$HOME/.local/bin:$PATH"` 执行。未修改仓库源码、配置、测试或文档；仓库内仅新增本文件。

## 1. 文档化工程命令（`docs/delivery/implementation.md` §3）

| 命令 | 退出码 | 关键输出 | 原始日志 sha256 | 结果 |
|---|---|---|---|---|
| `pnpm install --frozen-lockfile` | 0 | `Scope: all 5 workspace projects` / `Lockfile is up to date, resolution step is skipped` / `Done in 67ms using pnpm v12.3.4` | `f89d23e7d3d0f3d06227bd28a37b81873f59c012576b9576804c858e3fe11da5` | pass |
| `pnpm typecheck` | 0 | `tsc -p tsconfig.json --pretty false`（无输出） | `4a1f5fa02320512237e4fb1db6aad394a9f541d8f5a6b54738d6e9f401627a66` | pass |
| `pnpm lint` | 0 | `All matched files use Prettier code style!` | `8977c4f1c41d122d2d741af4ce6b7b14c72a29311a91f11e5877dfcb1458b90c` | pass |
| `pnpm test:unit` | 0 | `Test Files 8 passed (8)` / `Tests 97 passed (97)` | `82d3ec9f4462193f5ba08c15cf4099341c2a692780d41793523f79ce3d73394e` | pass |
| `pnpm test:integration` | 0 | `Test Files 4 passed (4)` / `Tests 33 passed (33)`（含 9 个容器用例，49.56s） | `343735e9cf5a7d6e05a77d4c97387c94f70009e72ca28811d78bfba97ac33875` | pass |
| `pnpm docs:check` | 0 | `docs:check ok — 15 documents, 54 internal links, 94 acceptance cases, 9 requirements, 11 work packages` | `10e3a044e771c7bb328e66b1a3b533b7e2a561502e1885055b5a4cbbfeb37279` | pass |
| `pnpm build` | 0 | 4 个包 `tsc -p tsconfig.build.json` 全部 `Done` | `52ef9c11dbe400ee5bbb9f17362c3305993d1f7b54f89c72aba0d4b44c4d2b16` | pass |
| `pnpm test:e2e` | **1** | `NOT_IMPLEMENTED: command test:e2e is not implemented yet; it lands with WP-09` | `b67835ab7e846add4959adec710f3ee00448138ebf9dfce76bc85ef08778dced` | pass（按契约必须失败） |
| `pnpm test:acceptance` | **1** | `NOT_IMPLEMENTED: command test:acceptance is not implemented yet; it lands with WP-10` | `64f75755d917ff9761be44bff16d01e39a8a13f52c3b3a16ea215a3102e16a81` | pass（按契约必须失败） |
| `pnpm test:live` | **1** | `NOT_IMPLEMENTED: command test:live is not implemented yet; it lands with WP-10` | `bebcab380b7f0c03e0b60b605a9ff288602e6672e68ba515c1a8ee87488c7958` | pass（按契约必须失败） |

三条未实现命令均为静默通过的反面：退出码 1 且错误信息点名归属工作包，未见任何伪造成功输出。

## 2. AC-048 Workspace 边界（镜像/权限探测 + 只读挂载负例）

### 2.1 doctor 探测（真实环境）

命令：

```
node apps/cli/dist/cli.js doctor --json
```

- 退出码：0（仅当 `executionReady=true`）
- 关键输出：`executionReady: true`、`blockers: []`；node 24.8.0 ok / pnpm 12.3.4 ok（path `~/.local/bin/pnpm`）/ git ok / pi 0.85.1 ok / docker 28.4.0 ok + imageId / 目录 `~/.agentdev` 与仓库根 writable / 端口 4317、4318 free
- 日志 sha256：`d282c6ffd6caf87247f7d818d40a165a9320d5c5d9441d0a7037732f1bcec3b1`
- 结果：**pass**

### 2.2 doctor 负例与正控（独立复现，非仓库测试）

脚本 `/tmp/wp00-test/falsify-doctor-compact.mjs`（`node …` 退出码 0，5/5 通过）：

| 检查 | 观察 | 结果 |
|---|---|---|
| 正控：真实工作区 | `executionReady=true blockers=[]` | pass |
| 负例：镜像不存在（`imageTag=agentdev/exec:0.0.0-test-missing`） | `executionReady=false`，blocker 含 `No such image` | pass |
| 负例：dataDir 无法创建（父路径被普通文件占用） | `executionReady=false`，blocker 含 `directory not writable` | pass |
| 负例：`probeDirectory` 指向不存在目录 | `writable=false`（ENOENT） | pass |

### 2.3 容器加固负例（独立复现，含正控）

命令模板：`docker run --rm --read-only --tmpfs /tmp:rw,noexec,nosuid,size=256m --cap-drop=ALL --security-opt no-new-privileges --pids-limit 256 --memory 2g --cpus 2 --network none [extra] agentdev/exec:0.0.0 -lc '<cmd>'`

| 检查 | 命令要点 | 退出码 | 关键输出 | 结果 |
|---|---|---|---|---|
| 非 root 账户 | `id -u` | 0 | `10001` | pass |
| 根文件系统只读（负例） | `touch /nope` | 1 | `Read-only file system` | pass |
| tmpfs 可写（正控） | `echo ok > /tmp/s && cat /tmp/s` | 0 | `ok` | pass |
| 只读源挂载（负例） | `--volume <tmp>:/workspace:ro` + `echo x > /workspace/f` | 1 | `Read-only file system` | pass |
| 可写源挂载（正控，证明上条非空洞） | `--volume <tmp>:/workspace:rw` + 同上 | 0 | `x` | pass |
| capability 全丢 | `grep CapEff /proc/self/status` | 0 | `CapEff: 0000000000000000` | pass |
| 无网络（DNS 负例） | `getent hosts registry.npmjs.org` | 2 | 无输出 | pass |
| 无网络（真实连接负例） | `node -e "fetch('https://example.com')…"` | 0 | `blocked:TypeError`（主动连接失败，非 DNS 假象） | pass |
| pid 上限 | `cat /sys/fs/cgroup/pids.max` | 0 | `256` | pass |
| 内存上限 | `cat /sys/fs/cgroup/memory.max` | 0 | `2147483648` | pass |

补充：`docker/run-agentdev.sh /tmp/wp00-test/rw-mnt 'echo script-ok && id -u'` **直接调用失败**（exit 126 `Permission denied`），改用 `bash docker/run-agentdev.sh …` 后 exit 0、输出 `script-ok` / `10001` —— 见 F4。

## 3. AC-066 SDK 契约（Pi SDK 生命周期与资源加载）

### 3.1 runner 自检（文档指定命令）

```
node apps/runner/dist/cli.js --attempt-id t-1 --epoch 1 --provider deepseek --model deepseek-v4-pro \
  --cwd /tmp/wp00-test/cwd --agent-dir /tmp/wp00-test/agent --tools read --trusted --self-check
```

- 退出码：0
- 输出：`{"v":1,"attemptId":"t-1","epoch":1,"type":"attempt.ready","sessionId":"01a08c5d-…","provider":"deepseek","modelId":"deepseek-v4-pro","tools":["read"]}`
- 日志 sha256：`6c0d4aa4f86325a636696ca9327118e991c98c98a862fe69172b0d06518f5e69`
- 结果：**pass**

### 3.2 会话生命周期与资源加载（独立复现）

脚本 `/tmp/wp00-test/falsify-session-resources.mjs`（7/7 通过）与 `/tmp/wp00-test/probe-lifecycle.mjs`：

| 检查 | 观察 | 结果 |
|---|---|---|
| 显式工具白名单 | `toolNames=['read','agentdev_probe']` → `activeToolNames=["read","agentdev_probe"]`；`bash/edit/write` 不在其中；未点名的自定义工具 `agentdev_forbidden` 不可用 | pass |
| 空白名单 | `activeToolNames=[]` | pass |
| 目录中两个 skill，仅选其一 | 选中 `selected/` → `loaded=["alpha-skill"]`，磁盘上同样存在的 `unselected/beta-skill` **不可用** | pass |
| 未给选择即无可发现资源 | 无 `skillPaths` → `loaded=[]`（`includeDefaults:false` 生效） | pass |
| `extendResources()` 不能扩权 | 追加请求后 `getSkills()` 仍只有 `alpha-skill` | pass |
| 未信任项目 | skill 全不加载 + 警告；传 `agentsFiles` 抛 `UNTRUSTED_RESOURCE` | pass |
| 未配置模型 | `MODEL_UNAVAILABLE`，不静默替换 | pass |
| 创建/订阅/取消订阅/dispose | 均可执行，dispose 后操作抛 `SESSION_CLOSED` | pass |
| abort | 空转会话 `abort()` resolved；runner 收 `attempt.abort` 后输出 `attempt.result cancelled`，进程 exit 1 | pass |
| 陈旧 epoch | `epoch:99` 的 abort 被丢弃（无 result 帧），`epoch:1` 才生效 | pass |
| steer / followUp | 空闲会话上均 resolved（行为正确性属 WP-05/10） | pass |
| 扩展事件订阅 | 无模型轮次时事件数 = 0（离线不可触发，见 F3） | not_covered |
| 会话历史恢复 | `resumeFrom` 指向从未写入的文件时**静默新建会话**（新 sessionId，`sessionFile` 指向该未写入路径），未恢复任何历史 | not_covered（见 F3） |
| SDK 类型收敛（ARCHITECTURE §3） | 全仓仅 `packages/pi-runtime/src/{session,resources}.ts` 真正 `import` SDK；`packages/contracts/src/toolchain.ts`、`apps/cli/src/doctor.ts` 只以字符串常量引用包名/清单路径 | pass |

### 3.3 必需失败测试：依赖安装

在 `/tmp` 的源码副本中复现（不改仓库）：

| 步骤 | 命令 | 退出码 | 观察 | 结果 |
|---|---|---|---|---|
| 正控：副本未改动 | `pnpm install --frozen-lockfile` | 0 | `Done in 1.1s using pnpm v12.3.4` | pass |
| 负例：给 `package.json` 加未锁定依赖 `left-pad@1.3.0` | 同上 | **1** | `Error: ERR_PNPM_OUTDATED_LOCKFILE`（日志 sha256 `fad9554f944123e61bfa216d8af3b93f35893bcb9017cc54aa347ac3646ec061`） | pass |
| 负例：执行镜像缺失 | `buildDoctorReport({imageTag:'agentdev/exec:0.0.0-test-missing'})` | n/a | `executionReady=false` + blocker | pass |
| 负例：只读挂载写入 | 见 §2.3 | 1 | `Read-only file system` | pass |

### 3.4 必需失败测试：SDK 压缩 —— **证据无效（F1）**

仓库用例 `packages/pi-runtime/test/session.integration.test.ts:124-134` 的断言为：

```ts
const outcome = await session.compact().then(() => 'resolved' as const, () => 'rejected' as const);
expect(['resolved', 'rejected']).toContain(outcome);
```

该断言**恒真**。实测空会话 `compact()` 的真实结果是 `rejected: Error: Nothing to compact (session too small)`，即"压缩必然抛错"这一回归也会通过此用例。结果：**fail（必需失败测试未成立）**，复现脚本 `/tmp/wp00-test/falsify-doctor-compact.mjs`。

## 4. AC-067 扩展故障（Critical/可选扩展注册）

独立脚本 `/tmp/wp00-test/falsify-extensions.mjs`（5/5 通过）：

| 检查 | 观察 | 结果 |
|---|---|---|
| 出厂可选白名单为空 | `BUILTIN_EXTENSIONS.length=0` | pass |
| 未知扩展 id 拒绝 | `PiRuntimeError/UNKNOWN_EXTENSION: unknown extension id(s): evil-third-party` | pass |
| Critical 扩展失败 | `startupBlocked=true`、`active=[]`、`disabled=[{id:'core-policy',critical:true,reason:'policy backend unavailable'}]` | pass |
| 可选扩展失败只禁用自身 | `startupBlocked=false`、`active=["extra-report"]`、`disabled=[{id:'extra-fails',reason:'boom'}]` | pass |
| 不支持的 apiVersion | 仅该条 `disabled`，`startupBlocked=false`（仓库单测覆盖，独立复现一致） | pass |
| runner 实际启动调用 | `activateExtensions({providedCapabilities:[policy,context,artifact,events,dispatch]})` → `startupBlocked=false`、`missingCapabilities=[]` | pass |

**但"Critical 失败阻断一次 Attempt 启动"无法端到端验证（F2）**：`apps/runner/src/attempt.ts:73-75` 调用 `activateExtensions()` 时不传 `manifest`，出厂清单为空，CLI 也没有任何扩展配置入口（实测 `--extension core-policy` → `Unknown option '--extension'`，exit 2）。因此 `CRITICAL_EXTENSION_FAILED` 分支只有源码阅读 + 注册表单测证据，没有 runner 级可执行证据。结果：该子项 **not_covered**。

## 5. 我设计并执行的额外尝试证伪（全部未能证伪实现）

| # | 尝试证伪的对象 | 手段 | 结果 |
|---|---|---|---|
| 1 | 扩展注册表三态 | 自带 manifest + 抛错 activate（不依赖仓库测试） | 未证伪；5/5 符合契约 |
| 2 | 未知扩展 id | 直接调用注册表 | 未证伪；`UNKNOWN_EXTENSION` |
| 3 | 工具白名单 | 两个自定义工具 + 内置工具名对照 | 未证伪；白名单外一律不可用 |
| 4 | 资源选择隔离 | 磁盘上放两个 skill 只选其一（仓库测试只有单 skill，无法区分"只选"与"全发现"） | 未证伪；未选者不可用 |
| 5 | 资源扩权 | `extendResources()` 后复查 | 未证伪；不扩权 |
| 6 | 未信任项目 | skill + agentsFiles 两路 | 未证伪；不加载 + 抛错 |
| 7 | 容器加固（含正控） | 自建 docker 调用，不复用仓库测试 | 未证伪；负例全部按预期失败，正控成功 |
| 8 | 网络隔离 | `getent`（DNS）与 `node fetch`（真实连接）双路 | 未证伪；均被阻断 |
| 9 | 依赖安装门禁 | 在 /tmp 副本中制造锁文件漂移 | 未证伪；`ERR_PNPM_OUTDATED_LOCKFILE` |
| 10 | doctor 判定 | 缺镜像 / 不可写目录 / 缺目录 三负例 + 真环境正控 | 未证伪；如实拒绝就绪 |
| 11 | runner 失败先行 | 未知模型、陈旧 epoch、未知选项 | 未证伪；`MODEL_UNAVAILABLE` exit 1、陈旧帧被丢弃、未知选项 exit 2 |
| 12 | SDK 类型收敛 | 全仓 grep `@earendil-works` 的真实 import | 未证伪；仅 pi-runtime 导入 |
| 13 | 图像 digest 冻结 | 连续 3 次重建镜像比对 imageId | **证伪**（F5）：三次构建得到三个不同 imageId |

## 6. Findings

| ID | 严重性 | 判定 | 描述与最小复现 |
|---|---|---|---|
| F1 | P2（影响验收证据，阻断） | defect（测试有效性） | **必需失败测试"SDK 压缩"是同义反复**。`packages/pi-runtime/test/session.integration.test.ts:132` 的 `expect(['resolved','rejected']).toContain(outcome)` 恒真。复现：`node /tmp/wp00-test/falsify-doctor-compact.mjs` → `INFO session.compact() on an empty session actually rejected: Error: Nothing to compact (session too small)`。影响：WP-00 退出条件"必需失败测试：…SDK 创建/取消/压缩…"未成立。 |
| F4 | P2（交付接口，阻断） | defect | **`docker/run-agentdev.sh` 缺执行位**：`git ls-files -s` → `100644`（对比 `docker/build-image.sh` = `100755`）；按文件头文档直接调用 `docker/run-agentdev.sh <dir> <cmd>` → exit 126 `Permission denied`。复现：`./docker/run-agentdev.sh /tmp/x 'id -u'`。临时绕过：`bash docker/run-agentdev.sh …`（已验证 exit 0）。 |
| F2 | P2（验证覆盖） | not_covered | **runner 级 Critical 扩展阻断无端到端证据**。复现：`node apps/runner/dist/cli.js … --self-check --extension core-policy` → `Unknown option '--extension'` exit 2；`BUILTIN_EXTENSIONS=[]`；`attempt.ts` 不传 manifest。AC-067 的"Critical 阻断 Attempt"本包内不可执行，仅注册表单测 + 源码。 |
| F3 | P2（验证覆盖） | not_covered | **AC-066 的"流式"与"恢复"本包未验证**。离线订阅事件数 = 0；`resumeFrom` 指向未写入文件时静默新建会话（新 sessionId），仓库用例名 *"opens a stored session file through a new factory instance"* 实际未恢复任何历史（其注释亦自认）。`pnpm test:live` = NOT_IMPLEMENTED（WP-10），故本包内无法补证。 |
| F5 | P3（观察/风险） | doubt | **镜像构建不可复现**：同一 Dockerfile 连续构建得到 `sha256:8fc0…`（首次 doctor）、`sha256:ffb1…`（重建）、`sha256:bab7…`、`sha256:bcd1…`（探针）四个 imageId。`doctor` 只报告"当前"digest，WP-00 无 Attempt 级 digest 冻结与记录；AC-048/execution.md §1"每次 Attempt 冻结 digest"目前只是环境报告。复现：`bash docker/build-image.sh` 两次比对 `docker image inspect --format '{{.Id}}'`。 |
| F6 | P3（观察） | doubt | **无法解析的工具名被静默丢弃**：`--tools read,search` → ready 帧 `tools:["read"]`，stderr 0 字节，无任何诊断。收窄权限本身是 fail-safe，但角色配置的能力未被交付且无提示。复现：`node apps/runner/dist/cli.js … --tools read,search --self-check`。 |
| F7 | P3（测试设计） | weak evidence | 仓库用例 *"loads only the skills the caller selected"* 的磁盘上只有一个 skill，无法区分"仅加载所选"与"全量发现"；独立双 skill 复现证明**行为正确**（§3.2），仅仓库证据偏弱。 |

未发现 P0/P1。

## 7. 明确未能验证的声明

1. AC-066 的**真实模型流式事件**（`text_delta`/`tool_*`/`compaction_*` 实际投递）与**会话历史恢复**——需真实 Provider，`pnpm test:live` 按设计返回 NOT_IMPLEMENTED（WP-10）。
2. AC-067 的**runner 级 Critical 扩展阻断 Attempt 启动**——缺少扩展配置入口，无法在 WP-00 触发（F2）。
3. 容器加固在 **Workspace/Autonomous 模式的 Supervisor 准入路径**上的强制力（本包只交付镜像与探测，Supervisor 属 WP-07）。
4. `doctor` 对 **Provider/模型可达性**的探测（本包无该探测项，属后续 WP）。
5. 镜像 digest 的**长期稳定性**：因构建不可复现（F5），任何"已冻结 digest"在重建后必然失配，本包无对应机制可验证。

## 8. 结论

**FAIL**（行为层面未发现真实产品缺陷：文档化命令、doctor 探测、容器加固负例+正控、SDK 生命周期、工具/资源隔离、扩展注册表三态均按契约通过；FAIL 由 F1 使"SDK 压缩"这一必需失败测试失效、F4 使文档化入口 `docker/run-agentdev.sh` exit 126、以及 F2/F3 两项子声明在 WP-00 内不可验证所致。）

建议的最小修复：F1 改为断言"空会话 compact 必须抛出且不破坏会话"（或改为 filled-session 用例并入 WP-05）；F4 `chmod +x docker/run-agentdev.sh` 并重新 staged；F2 为 runner 增加扩展配置入口（或把该子项显式标为 WP-07 复验）；F3/F5/F6 至少记入已知差距或发布回归说明。

## 复测（修订 T2）

- 复测时间：2026-09-11 00:52–01:05（本机时区）
- 复测角色：test（独立复跑；未读取开发聊天，修复声明一律以本机实测为准）
- 修复声明范围：F1、F4、F2、F6、F7（F3/F5 未在修复清单内）

### T2.0 输入冻结与漂移声明

| 项 | 值 |
|---|---|
| 指定冻结点 | `git write-tree` = `a901b1260e13c1436c00e9e138df268549b546a6` |
| 复测开始实测 | `git write-tree` = `a901b126…` ✅ 一致；`git diff --stat` 为空（工作树 == 索引）；`git status --porcelain` = 61 条全部 `A ` |
| HEAD | `6cdbb752c62d1fcaef9bf7a2209353a6a500333e`（未变，仍无新 commit） |
| ⚠️ 复测期间漂移 | 复测后段有其他角色并行写入：`01:01:50` 写 `.agentdev/work/WP-00/review.md`；`01:04:38` 改 `apps/cli/src/doctor.ts`、`packages/contracts/src/{errors,limits}.ts`、`packages/contracts/test/errors.test.ts`，并新增 `.agentdev/work/WP-00/discovery.md`。复测结束时实测 `git write-tree` = `f77be4ec6913e6cab44be9f350fdced57ebf027b` ≠ 指定冻结点 |
| 结论绑定 | 本 §复测 的全部结论只对 **`a901b126…` 的内容**成立（该内容在 00:52 确认工作树与索引一致，且所有命令在该时点之后、`01:04:38` 编辑之前运行完毕）。`01:04:38` 之后的改动**未经本次复测**；仅供参考的快照检查见 T2.9 |

环境（复测时实测）：node v24.8.0；pnpm 12.3.4（`~/.local/bin/pnpm`）；Docker 28.4.0；git 2.39.3。执行镜像在复测中经 `./docker/build-image.sh` 重建（作为 F4 的对照），当前 `agentdev/exec:0.0.0` imageId = `sha256:edd3aa5051c78b213fda3115b701110e109d857b6ff3d2e20ae23f4f4a685676`，digest = `agentdev/exec@sha256:edd3aa50…a685676`（F5 未修复：连续构建仍得到不同 imageId）。

### T2.1 文档化工程命令（全部重新执行，`export PATH="$HOME/.local/bin:$PATH"`）

| 命令 | 退出码 | 关键输出 | 日志 sha256 | 结果 |
|---|---|---|---|---|
| `pnpm install --frozen-lockfile` | 0 | `Lockfile is up to date, resolution step is skipped` / `Done in 88ms using pnpm v12.3.4` | `081f6c4372c5d11f9c7db0d5c3ac8811c279209467cefa1933d066355fc32fd6` | pass |
| `pnpm typecheck` | 0 | 无输出 | `4a1f5fa02320512237e4fb1db6aad394a9f541d8f5a6b54738d6e9f401627a66` | pass |
| `pnpm lint` | 0 | `All matched files use Prettier code style!` | `8977c4f1c41d122d2d741af4ce6b7b14c72a29311a91f11e5877dfcb1458b90c` | pass |
| `pnpm test:unit` | 0 | `Test Files 9 passed (9)` / `Tests 105 passed (105)` | `4ae573f43ac8892c763ed2413f40a4a5d822dca5a7b6bf8a5c6432a56f3285e7` | pass |
| `pnpm test:integration` | 0 | `Test Files 4 passed (4)` / `Tests 38 passed (38)`（含 9 个容器用例） | `33cf8fb8339ed3957aa1cc98fe7db1324bcf8f5c79508f5ea1a4e53be7e9b67f` | pass |
| `pnpm docs:check` | 0 | `docs:check ok — 15 documents, 54 internal links, 94 acceptance cases, 9 requirements, 11 work packages` | `10e3a044e771c7bb328e66b1a3b533b7e2a561502e1885055b5a4cbbfeb37279` | pass |
| `pnpm build` | 0 | 4 包 `tsc -p tsconfig.build.json` 全部 `Done` | `52ef9c11dbe400ee5bbb9f17362c3305993d1f7b54f89c72aba0d4b44c4d2b16` | pass |
| `pnpm test:e2e` | **1** | `NOT_IMPLEMENTED: command test:e2e is not implemented yet; it lands with WP-09` | `b67835ab7e846add4959adec710f3ee00448138ebf9dfce76bc85ef08778dced` | pass（按契约失败） |
| `pnpm test:acceptance` | **1** | `NOT_IMPLEMENTED: command test:acceptance is not implemented yet; it lands with WP-10` | `64f75755d917ff9761be44bff16d01e39a8a13f52c3b3a16ea215a3102e16a81` | pass（按契约失败） |
| `pnpm test:live` | **1** | `NOT_IMPLEMENTED: command test:live is not implemented yet; it lands with WP-10` | `bebcab380b7f0c03e0b60b605a9ff288602e6672e68ba515c1a8ee87488c7958` | pass（按契约失败） |

三者仍以 `NOT_IMPLEMENTED` 退出 1，未出现静默通过。

### T2.2 F1 压缩断言（已修复，含反例实验）

新断言（`packages/pi-runtime/test/session.integration.test.ts:124-132`）：`await expect(session.compact()).rejects.toThrow(/compact/i);` 且 `expect(session.disposed()).toBe(false)`。

实验方法：把源码复制到 `/tmp/wp00-retest/mut`（node_modules 以符号链接指回仓库，vitest 别名解析到副本源码），在副本中修改 `packages/pi-runtime/src/session.ts` 的 `compact()`：

| 步骤 | 对 `compact()` 的实际修改 | 命令 | 退出码 | 观察 | 判定 |
|---|---|---|---|---|---|
| 正控（未改动副本） | 无 | `./node_modules/.bin/vitest run --project integration packages/pi-runtime/test/session.integration.test.ts` | 0 | `Tests 11 passed (11)` | pass |
| 反例 1 | 去掉 `await this.session.compact(...)`，改为 `void instructions; return;`（**永不 reject**） | 同上 | **1** | `× refuses to compact a session that has nothing to compact`；`AssertionError: promise resolved "undefined" instead of rejecting` | **测试真的会失败** ✅ |
| 反例 2 | 改为 `throw new Error('boom')`（**消息不匹配 `/compact/i`**） | 同上 | **1** | `AssertionError: expected [Function] to throw error matching /compact/i but got 'boom'` | **测试真的会失败** ✅ |
| 还原正控 | 用仓库原文件覆盖副本 | 同上 | 0 | `Tests 11 passed (11)` | pass |

日志 sha256：baseline `0d28fdc62b66b66a27be184efd70ea40656d589aa8914d3013990eb94072bc3e`；mutation1 `4d001e95c2954f9bbc223a0bf0e201d5dd1a1de12553beb10b71e20ba51d608d`；mutation2 `13cb6bc77880987d7d134152fc5ccf5ef1e0f41b430c2e1fcb93fc4902ac67be`；restored `5bf7d3843d1eeb804b8f2a61bf751724e05d2e3acd63681c3fddf01b26d26ba0`。
**F1 判定：已修复**（原断言恒真，新断言在两类回归下均失败）。

### T2.3 F4 执行位（已修复）

| 检查 | 命令 | 退出码 | 输出 | 判定 |
|---|---|---|---|---|
| 索引模式 | `git ls-files -s docker/run-agentdev.sh` | 0 | `100755 c198900d… 0 docker/run-agentdev.sh`（`build-image.sh` 同为 `100755`） | pass |
| 直接调用（此前 exit 126） | `./docker/run-agentdev.sh /tmp/wp00-retest/ws 'echo ok && id -u'` | **0** | `ok` / `10001` | **已修复** ✅ |
| 对照 | `./docker/build-image.sh` | 0 | `tag: agentdev/exec:0.0.0` / `imageId: sha256:edd3aa50…` | pass |

### T2.4 F2 扩展门禁（已修复，三层证据）

| 层 | 命令 | 退出码 | 观察 | 判定 |
|---|---|---|---|---|
| CLI 未知 ID | `node apps/runner/dist/cli.js … --extension not-shipped --self-check` | **1** | `{"type":"attempt.error","code":"UNKNOWN_EXTENSION","message":"unknown extension id(s): not-shipped"}`，**无 `attempt.ready`**，stderr 0 字节 | pass |
| CLI 正控 | 同上不带 `--extension` | 0 | `attempt.ready` 且 `droppedTools:[]` | pass |
| Runner 门禁（会话构建 spy，独立脚本 `/tmp/wp00-retest/verify-extension-gate.mjs`，sha256 `4568e2ed…`） | `node verify-extension-gate.mjs` | 0 | 4/4：未知 ID → `UNKNOWN_EXTENSION` 且 `buildSession` **从未被调用**、无 ready 帧；Critical 失败 → `CRITICAL_EXTENSION_FAILED`（message `critical extension failed: core-policy`）且 `buildSession` 从未被调用；正控（健康 Critical）→ `start()=0` 且会话已建、ready 帧正常；可选失败 → 不阻断 | pass |

`AttemptRunnerDeps.buildSession` 为测试缝，我用自己的 spy 独立构造 `AttemptRunner`，不依赖仓库测试。"Critical 失败在会话创建之前阻断"因此有了可执行证据（此前只有源码 + 注册表单测）。**F2 判定：已修复**（CLI 仍无法配置 manifest，故 Critical 分支只能经 AttemptRunner 缝触发——这是 WP-00 出厂白名单为空的必然结果，不再视为覆盖缺口）。

### T2.5 F6 工具名丢弃（已修复）

命令：`node apps/runner/dist/cli.js … --tools read,search --self-check`

- 退出码 0，输出：`{"type":"attempt.ready",…,"tools":["read"],"droppedTools":["search"]}`，stderr 0 字节。
- 对照：不带 `search` 时 `droppedTools:[]`。
- 判定：**已修复**（不再静默丢弃，`droppedTools` 如实上报）。

### T2.6 doctor 镜像探针（新增 `probeImageCapability`，含假镜像负例）

方法：先 `docker tag agentdev/exec:0.0.0 agentdev/exec:real-backup` 保存真镜像，再把假镜像挂到同一 tag 上（**只信 tag 会被骗**），探针脚本 `/tmp/wp00-retest/probe-image.mjs`（sha256 `b66a6e6a…`）。

| 场景 | `probeImageCapability` | `probeDocker.status` | `doctor --json` | 判定 |
|---|---|---|---|---|
| `docker import` 造假镜像（无 shell） | `"image cannot run the execution probe: Command failed: docker run …"` | `mismatch` | exit **1**，`executionReady=false`，blocker 列出该原因 | pass |
| **更强的假镜像**：`FROM agentdev/exec:real-backup` + `USER root`（有 node 24、有 bash，仅 uid 错） | `"image runs as uid 0, expected 10001"` | `mismatch` | exit **1**，`executionReady=false`，blocker `docker: image runs as uid 0, expected 10001` | pass（证明探针非空洞，不只看"能否启动"） |
| 恢复真镜像后正控 | `undefined`（通过） | `ok` | exit **0**，`executionReady=true`，`blockers=[]`，`imageDigest=agentdev/exec@sha256:edd3aa50…` | pass |

日志 sha256：fake `17193574f1aafaddaaba97533eba2c17d2228c62839634d9726ff044c0a437cd`；root-uid fake `78e83be31b1f13b244a6579a2d6ec66e458660611e34235cbef28e8c811cb690`；restored `5aa7697a2c6566f2a410976ac6614868da11308cf98d973f2e22a669bc6fe08f`。
环境已还原：假镜像 tag（`fake-probe`、`rootprobe`、`real-backup`）已删除，`agentdev/exec:0.0.0` 指回真镜像（imageId `edd3aa50…`；注意此 imageId 是本轮 `build-image.sh` 重建产物，与 T1 记录的 `ffb122b2…` 不同，见 F5）。

### T2.7 F7 资源选择（已修复）

| 检查 | 手段 | 结果 |
|---|---|---|
| 仓库用例 | `packages/pi-runtime/test/resources.test.ts:35-50` 现在磁盘上有 `demo-skill` 与 `other-skill` 两个 skill，仅选 `demo-skill` 目录 | pass（`pnpm test:unit` 内含） |
| 独立复跑 | `/tmp/wp00-test/falsify-session-resources.mjs`（两个根、只选其一） | 7/7 pass；`loaded=["alpha-skill"] onDisk=["alpha-skill","beta-skill"]` |
| **反例实验** | 副本中把 `loadSkills` 的 `skillPaths` 改为 `[join(cwd,'skills')]`（忽略选择、扫描全部） | `× loads only the skills the caller selected`，退出码 **1**（`Tests 2 failed | 6 passed`），日志 sha256 `256b35aea2b3a6b3a4db1d35b04f50fc9ed5e1502527152204e6f52695d266b3` |

**F7 判定：已修复**（新用例对"忽略选择"的回归确实会失败）。

### T2.8 AC 与必需失败测试复测矩阵

| 项 | 覆盖内容 | 结果 |
|---|---|---|
| AC-048 Workspace 边界 | `doctor --json`（真实环境 ready + 假镜像两种负例拒绝）；容器加固 9 用例经 `pnpm test:integration` 在本冻结点重跑通过；`run-agentdev.sh` 直接可执行 | **pass** |
| AC-066 SDK 契约 | 创建/订阅/abort/dispose、未知模型拒绝、工具白名单精确、资源选择与不可扩权、未信任项目拒绝、**压缩负例（含反例实验）**、依赖安装失败（`ERR_PNPM_OUTDATED_LOCKFILE`，T1 已证，本轮 `install --frozen-lockfile` 正控通过） | **pass（部分）**：流式事件与会话历史恢复仍未覆盖（F3，需 WP-10 `test:live`） |
| AC-067 扩展故障 | 未知 ID → `UNKNOWN_EXTENSION` 且不建会话；Critical 失败 → `CRITICAL_EXTENSION_FAILED` 且不建会话；可选失败仅禁用自身；空白名单 | **pass** |
| 必需失败测试：依赖安装 | 正控 exit 0；锁文件漂移 → `ERR_PNPM_OUTDATED_LOCKFILE`（T1 复现，本轮锁文件未变） | pass |
| 必需失败测试：SDK 创建/取消/压缩 | 未知模型拒绝；abort 生效；陈旧 epoch 丢弃；**压缩断言现可失败**（T2.2 两个反例） | pass |
| 必需失败测试：资源控制 | 未选 skill 不可用、无自动发现、不可扩权、未信任拒绝（仓库用例 + 独立脚本 + F7 反例） | pass |
| 必需失败测试：只读挂载负例 | 只读 rootfs / 只读挂载写入失败 + tmpfs / 可写挂载正控（T1 独立复现；本轮经 `test:integration` 容器套件重跑） | pass |

### T2.9 未修复项与本次复测未覆盖项

1. **F3（既有，未在修复清单）**：AC-066 的"真实模型流式事件"与"会话历史恢复"仍不可离线验证；`pnpm test:live` 按设计 `NOT_IMPLEMENTED`（WP-10）。本次复测**未**将其转为已覆盖。
2. **F5（既有，未在修复清单）**：镜像构建仍不可复现——本轮 `build-image.sh` 重建后 imageId 由 `ffb122b2…` 变为 `edd3aa50…`；`doctor` 只报告当前 digest，仍无 Attempt 级 digest 冻结。
3. **新观察（流程风险）**：复测期间工作树/索引被并行修改（`a901b126…` → `f77be4ec…`，01:01:50 与 01:04:38），故"冻结点"在复测中途失效。若需对新改动出结论，必须重新冻结并复测。
4. 仅供参考（**不作为本次复测证据**）：对复测结束时的未冻结工作树（索引 `f77be4ec…`）跑 `pnpm typecheck` = exit 0、`pnpm test:unit` = exit 0（9 files / 107 tests），日志 `/tmp/wp00-retest/info-typecheck.log`、`info-unit.log`。

### 复测结论

**RE-TEST: PASS** —— 在冻结点 `a901b1260e13c1436c00e9e138df268549b546a6` 上：F1（压缩断言恒真）、F4（脚本缺执行位）、F2（runner 扩展门禁不可达）、F6（工具名静默丢弃）、F7（选择用例无法区分"只选"与"全发现"）五项均独立复现为已修复（每项都做了反例/负例实验，非依赖修复声明）；全部文档化命令与三条 `NOT_IMPLEMENTED` 契约保持正确；仍**未覆盖**的是 AC-066 的真实模型流式与历史恢复（F3，依赖 WP-10 `test:live`），F5（镜像构建不可复现）仍为未修复的观察项；复测期间发生的并行改版（`f77be4ec…`）不在本结论范围内。
