# Agent执行、权限与配置

## 1. 支持环境

Core支持Linux x86_64/arm64和macOS arm64/x86_64，Node24。Workspace与Autonomous使用Docker Engine/Desktop的Linux容器执行专业Agent及工具，要求Docker API可用；doctor检测失败时这两种模式拒绝准入并展示安装/切换入口。Full Access由用户显式选择后以非Root宿主进程执行开发/一般任务。Review与Test在所有模式仍使用隔离容器，确保源码只读和聊天不可访问；缺Docker即阻断独立验证，不能自审替代。

镜像由项目Dockerfile固定构建：Node24+Git+基础构建工具，使用非Root uid，read-only root filesystem、cap-drop=ALL、no-new-privileges、pid限制256、内存2GiB、CPU2。**容器的 IP 网络恒为 `--network none`**（W6）：出网只有受控出口（见 §2/§4），这样容器对宿主、`host.docker.internal`、docker 桥网关、内网与公网都没有路由。构建镜像和安装依赖属于用户一次性配置授权，记录镜像digest；每次Attempt冻结digest。

## 2. 执行拓扑与Secret

Runner内Pi通过OpenAI-compatible Model Gateway或对应Provider适配器调用模型。Gateway在Core受信侧持有Provider Secret，Runner只持有短期attempt capability；工具容器与Runner控制连接分离。工具容器未挂载宿主网络和Docker Socket。

**受控出口（W6 实装，取代"仅挂载宿主 Unix Socket"的早期表述）**：容器内工具的网络出口是一条**命名卷里的 Unix Socket**——`docker run --network none` 挂载只读卷 + 容器内 `127.0.0.1:3128` 桥（`HTTP(S)_PROXY` 指向它）→ 同一命名卷的 **egress sidecar** 容器（`--network bridge`、无宿主挂载、无 Docker Socket、cap-drop=ALL、非特权 root）→ 宿主回环上的 **Core egress 代理**（`packages/core/src/egress.ts`）。最后一跳才是策略执行点：代理按 `NetworkPolicy` 决定是否建连，并在建连前完成 DNS 解析与地址固定。之所以不是"直接挂载宿主 Unix Socket"：Docker Desktop for macOS 的 VirtioFS 只能呈现 socket inode、`connect(2)` 不能到达宿主进程（实测见 `.agentdev/work/WP-12/w6-implementation.md` §4.1），命名卷位于 Docker VM 内，容器↔容器共享 socket 在 macOS 与 Linux 都成立。sidecar 转发到宿主用 `host.docker.internal`（Linux 上回退到自身默认网关），Core 代理对两种拼写一视同仁。

Capability绑定attempt/epoch/role/allowed methods/expiry；Broker重新校验，Runner不能声明自己是Chief。Core直接处理文件和领域工具；Shell请求由Supervisor另起工具容器，工具容器没有model capability或控制socket。

Workspace允许读取授权源码快照、写Task工作区和产物目录；网络、依赖安装、外部写入、Secret、push/deploy均需Grant。Autonomous在启动前保存范围Grant，范围内自动执行。Full Access工具宿主进程继承授权执行账户，但仍经Broker控制工具准入和领域Gate。软件规则和权限模式分别校验。

第一期权限模型（`.agentdev/work/WP-12/T3-implementation.md` 附录 A）把"范围内"具体化为**Plan时信封**：Plan/授权批准时信封（路径 + 操作）即已授予，运行中**范围内操作直接执行、不再逐次询问**（read/search/edit/write/artifact_write/bash/git，含构建、测试、公网出网）。三条硬拦不因信封而放松，且返回**类型化拒绝**（`details.approvable=false`，模型被告知"不要重试"）：

1. **敏感文件**（附录 A.2 冻结表）：`read`/`search`/`edit`/`write` 四处共用同一张表，命中即拒（`CONTEXT_FORBIDDEN`），同时按现有 `chief_action_required` 机制落一条用户待办（`kind='sensitive_file'`，不阻塞Run，agent继续别的工作）。搜索时该表在遍历中即跳过命中文件（"search不同表生效等于没拦"）。
2. **网络边界**：**默认通** —— 公网、`127.0.0.1:3000`/`:5432` 等本地服务、内网依赖私服都开箱即通，不需要作者配白名单，也不恢复运行期逐次审批（A.4）。**只保留两个固定拒绝项，且永不可授权**：① 运行时**实际绑定**的守护自身端口（daemon 控制端点、模型 Gateway 代理、项目协议端口、BFF、admin 面，以及 Core 出口代理自己的端口——全部由监听器绑定时登记进 `EgressPortRegistry`，不是常量）；② 云元数据地址（`169.254.0.0/16` 链路本地整段、`100.100.100.200`、`192.0.0.192`、`fd00:ec2::254` 与 `metadata*` 主机名，含 IPv4-mapped 与 NAT64 拼写）——这两项是"自己机器的钥匙"，不是网络功能，被拦不损失正常开发能力。除这两项**没有第三项**。**实现（W6，已完成）**：容器出口经 §2 的受控出口，**两个拒绝项在出口处执行**（`EgressProxy` + `NetworkPolicy`），准入层（`tool-handler.ts` 对 `bash` 字面 URL 的预检）与出口共用同一 `NetworkPolicy` 实例来源，不会互相矛盾。绕过路径的覆盖：`host.docker.internal` 作为**名字别名**在解析前即被拒绝；docker 桥网关在 Linux 上是宿主 `docker0` 地址（命中本机地址判定）而在 macOS 上不是宿主地址、代理无法建连（502），两条路都不放行；DNS 解析到拒绝地址在**每个解析答案**上判定；重定向每一跳都是新请求（HTTPS 是新的 CONNECT），因此在落点那一跳被拒。**未被代理覆盖的部分要如实说明**：容器内任意程序（`node net`/`nc`/自编译二进制）的裸 socket 拿不到任何 IP 路由（`--network none`），这是边界成立的原因；宿主模式（`full_access`）下 agent 用执行账户的真实网络，准入层的字面/DNS 判定只是识别能力而不是出口控制，裸 socket 仍可绕过——该残余风险在附录 A.5 与 `w6-implementation.md` §7 登记。`http:` 公网目标仍需显式 `allowInsecureHttp` 授权（W7R1-07），本地/私网 `http:` 属于日常开发默认放行。（口径来源：`w1-implementation.md` §7；实现与实测见 `w6-implementation.md`。）
3. **删除与Git引用**：工作区内删除允许（兜底=Git + 每任务工作区 + 交付CAS）；工作区外路径删除、`git push`/强制重置/`update-ref` 等引用变更拒绝。

`configPolicy: 'strict' | 'test'`（附录 A.7）只改**查表前的分支**，不改上表：`strict`（全局默认）拒绝全表；`test` 额外放行应用配置子集（`application*.yml`、`application*.properties`、`bootstrap.yml`、`bootstrap.properties`、`*.properties`、`*.conf`），凭据档与纯密钥材料仍拒。非 `strict` 必须在 `doctor`、项目页与验收报告显著可见，且每次放行读取都写审计（路径 + 策略版本 + 档位）。逐次 `permission.request`/`permission.respond`、`waiting_permission` 挂起与 `once`+`inputHash` 绑定**退掉**（代码保留、正常流程不再触发）。

## 3. 挂载与角色ACL

| 运行 | 读 | 写 |
|---|---|---|
| Chief/只读调查 | 选择的文档、授权冻结源码、允许的结构化Artifact | 自己的Artifact |
| Developer | 授权Task源码及所选资料 | 唯一Task工作区（该 Task 自己的外部 Git worktree）、构建临时目录、自己Artifact |
| Review | 冻结代码、产品/Plan/验收、客观测试证据 | 自己报告与检查临时目录 |
| Test | 冻结源码、有效Review、验收 | 隔离构建目录、测试数据和报告 |
| Settlement | 最终Diff及阶段证据、正式文档 | 授权文档候选Worktree、过程报告 |

运行数据库、其他Session/Transcript、全局SecretStore不挂载到Agent或工具。文件工具拒绝相对路径逃逸、符号链接逃逸、嵌套仓库逃逸；通过open时再校验真实路径与快照避免仅检查字符串。Review的Shell即使运行cat/find也只能看到其挂载集合。

**每任务工作区（W6 实装）**：专业 Run 的 `read/search/edit/write/bash` 根目录是该 Task 自己的外部 Git worktree（`<AGENTDEV_HOME>/task-worktrees/<projectId>/tasks/<taskId>`，由 `packages/core/src/task-workspace.ts` 按 `dependencyRevision ?? Work.baseRevision` 创建），因此"工作区内删除允许"的兜底第二层成立：删除只能落在本 Task 的树里，另一个 Task 的 worktree 与项目根都不在该根路径内，Broker 的文件边界直接拒绝。单写者由两层保证：worktree 租约绑定 `(attemptId, epoch)`（第二个 Attempt 得到 `BUSY`），以及每次工具调用都续期的 Work 级写租约（`data.md` §2 `lease`，进程重启后仍有效）。Chief Run（无 taskId）仍以项目根为根。

## 4. 网络与操作授权

Grant字段：scope=once/run/work/project、runId、workId、toolOperationId、operation、targets、role、stage、expiry、limits、decisionId。project范围只对声明role/stage有效；兄弟Run仅在Grant明确覆盖Work/Project和角色时可用。once必须绑定准确toolOperationId和runId；run绑定准确runId，work绑定workId；缺失对应绑定拒绝。once在准入时消耗，结果不确定不重新消费再执行。

网络工具使用Core受控代理：解析后的每个目标IP都过 `NetworkPolicy`，重定向每跳重验，`metadata` 与守护实际绑定端口**永不可授权**；公网、本地服务与内网默认放行（§2-2）。Shell 的网络出口是 §2 的受控出口：容器 `--network none` + 命名卷 socket + sidecar + Core 代理，所以"仅能到代理"是结构性的而不是策略性的。发布/Push/数据删除须保存操作清单和确认来源。

Secret按用途使用，模型Secret仅在Gateway；项目命令Secret按Grant短时注入目标工具，不注入所有Agent。日志做敏感字段和已知值遮蔽；输出不含认证Header。Store在macOS使用Keychain，Linux使用0600加密文件，密钥由安装时生成的0600独立主密钥文件或系统credential提供；备份中单独加密导出。

## 5. 真实验证环境

Review源码只读，执行lint/build等需要写输出时先复制到隔离临时目录，并校验输入代码树Hash；任何测试产生的临时文件不回写候选。Test使用同样冻结输入，镜像digest、依赖锁Hash、命令、环境键名、退出码、输出Hash写证据。

**Test 阶段执行验收命令（WP-12 W5 实装）**：Test 角色仍无 shell（§7），验收命令来自**项目配置** `policy.testCommands`（`protocol.md` §1 `ConfigPatch` 字段），由 Core 代表 Test Run 执行：`prepare-run.ts` 把该命令集写进 Test Attempt 的 prompt（"只这些、且模型不能自己跑或编造"），Attempt ready 时 `execution.ts` 经 `Broker.runDeclaredTestCommand` 在**同一隔离容器路径**（`--network none` + 命名卷出口 + 只读工作区挂载 + 加固参数）逐条执行，命令必须命中声明集否则 `NOT_AUTHORIZED`；每条的真实退出码与有界 stdout/stderr 落一条 `evidence` Artifact 与 `test.command_executed` 审计事件，合成 `CheckResult`（全 0 = `passed`，任一非 0 = `failed`，无命令 = `not_covered`，无法执行 = `blocked`）。`StageGate` 在 Test stage 提交时用这份 Core 证据**替换**模型可能声称的 `checkResult`，并在证据未就绪或非 `passed` 时拒绝 `success`（`GATE_NOT_READY`，回传真实命令与退出码），因此"模型自称成功"不能通过门禁；**空 `testCommands` 的默认是诚实缺口**：Test 只能记录 `not_covered` 并交 `needs_input`/`failed`，不能以自述成功放行。

**执行环境描述串（W8-1）**：合成 `CheckResult` 的每个 check 取该 Attempt 在 `attempt.ready` 自报的 `host:<platform>/<arch>/node-<major>` / `container:<image>` 描述串作为 `environmentRef`（不再用 Attempt id），与同一 Test Run 冻结的 `VerificationManifest.environmentRef` 是同一个值（`data.md` §3 `Env`），两处可直接比对；命令实际运行的容器镜像与 Runner 描述串同时写入 `result` 的 `image=`/`runner=`。`environmentRef` 的契约类型因此是"非空描述串"而非 UUIDv7（`packages/contracts` `environmentRefSchema`），库级夹具沿用 id 仍可解析，但生产只写描述串。

**`TestEnvironmentManager` 与本执行风格的关系**：该管理器负责宿主侧 OS 端口认领（含就绪归属证明）、attempt 命名测试 DB 与 `RECOVERY_REQUIRED` 清理。本执行风格是"每条命令一个 `--network none` 容器"：容器不绑定宿主端口、测试 DB 由项目自身在容器内管理，隔离边界是容器本身，生命周期由 `--rm` 与 Broker 的 Attempt 进程注册表（取消/结束时杀掉整个进程组）承担，因此管理器提供的宿主端口/DB 认领在此风格下**不适用**（它不是被绕过，而是没有宿主侧资源可认领）；它仍适用于将来"先起长驻服务再跑命令"的声明式风格（需要先有文档化的服务命令字段）。

服务端口由Supervisor动态分配，测试DB以attempt命名，跨Task数据库不共享。Shell超时终止进程组，清理端口/容器/临时DB；清理失败记录recovery。Fixture/测试脚本改变须经Developer→Review，Test不能修改验收以获得通过。

## 6. HTML与附件

Artifact下载由Core校验Project/Artifact ACL，返回短期60秒单次下载token。BFF转发字节，禁止任意路径。HTML预览置于sandbox iframe，仅allow-scripts，不允许same-origin/forms/top-navigation/popups/downloads；CSP default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'。预览不带工作台cookie，静态产物无法调用业务API。下载通过工作台受权按钮。

上传先写临时文件，校验大小、mime和文件签名，算Hash后原子重命名。附件当作用户数据和调查来源；引用文件中的命令不会直接获得执行授权。

## 7. Pi与扩展契约

固定@earendil-works/pi-coding-agent 0.85.1。Factory显式提供内存Settings、ResourceLoader、SessionManager、ModelRuntime/适配网关及自定义工具。禁用默认环境资源自动发现；角色工具完全由注册表构造。

工具：read/search/context_request/artifact_write；修改角色另有edit/write/bash/git；Chief有assessment_submit/agent_dispatch/decision_request；专业角色有stage_yield/request_dispatch。Shell和Git均走Broker；Git ref修改只由Workspace服务完成。

工具/权限边界的落点是**准入层**（`core/tools.ts` `planToolCall`，daemon `tool-handler.ts` 调用），在Grant与文件边界之前：角色门 → 参数Schema → `~`/绝对路径入口 → 敏感文件表（附录 A.2，read/search/edit/write 共用）→ `bash` 的Git引用守卫与工作区外删除守卫 → `bash` 字面URL交 `NetworkPolicy`。因此拒绝发生在"没有文件内容、没有进程、没有Grant被消费"之前，端点再写一条 `tool.refused`（operation/targets/code，不含args原文）。`tool.invoked` 仅在准入通过、`tool_operation` 落库后发出。敏感文件待办与 `test` 档放行审计分别是 `chief_action_required(kind='sensitive_file')` 与 `tool.listed_file_allowed`（含path/pattern/configPolicy/policyRevision）。

Core Critical能力：policy/context/artifact/events/dispatch；初始化失败停止Run。可选内置Extension为发布包白名单清单，字段id/version/apiVersion/capabilities/enabled/critical。**本发布的可选清单是刻意留空的（WP-00 决定，W8-3 登记）**：`packages/pi-runtime/src/extensions.ts` 的 `BUILTIN_EXTENSIONS` 是空数组，daemon 的 `services.extensions` 没有装配点，所以 `extension.list` 诚实返回空清单（`apiVersion=1`、`items=[]`），`extension.set` 对任何 id 返回 `NOT_FOUND`（"不在本发布白名单内"）；这是"零扩展发布"的真实状态，不是缺实现或占位。**新增一个内置扩展需要**：① 把一条 `BuiltinExtensionSpec`（id/version/apiVersion/capabilities/enabledByDefault/critical）加入 `BUILTIN_EXTENSIONS` 并接到 daemon 的 `services.extensions`；② 在 Runner/Core 侧提供并激活它的 capabilities，`critical` 失败必须停止 Run、可选失败只禁用自身；③ 为该扩展补契约测试（未知 id 拒绝、Critical 失败停止、可选失败隔离三条），并同步 `protocol.md` §5 的 `extension.list/set` 形状与 AC-067 的证据。本切片不做这些实现。Project可引用Skill Markdown，需信任且由Chief选择，Skill不能扩大工具权限。

Pi的steer在当前工具调用完成后生效，followUp在当前工作空闲后生效；它们只传递已路由指令，不能直接改变领域授权。取消使用abort并由Supervisor清理工具进程；SDK终止不自动代表副作用已确认。
