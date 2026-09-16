# Agent执行、权限与配置

## 1. 支持环境与执行默认

Core支持Linux x86_64/arm64和macOS arm64/x86_64，Node24。**默认在宿主执行**：专业Agent的工具在用户仓库内运行；按Task分离时，运行范围是该Task自己的Git worktree/分支（§3）。不装Docker不损失编码路径——`read`/`search`/`edit`/`write`/`bash`/`git` 与构建、测试、依赖安装都在宿主可用，**没有"缺环境即拒绝准入"**。

**容器是可选的项目运行环境，不是Agent工作的前提**：项目可以声明用容器跑测试套件、服务、数据库或依赖校验；此时容器由项目自身的Dockerfile/编排启动，按项目逐一选择，**绝不作为每次工具调用的要求**（§5）。没有容器时，这些命令按项目声明（`policy.testCommands`）在宿主执行。项目选择容器时其加固参数（read-only rootfs、cap-drop、非root、网络范围等）由项目自行决定，Core不把某套参数作为准入条件。

Full Access仍是用户显式选择的模式，以执行账户的宿主进程运行：放宽守卫但不跳过领域Gate与审计，风险由用户承担（§2）。旧模型中"Workspace/Autonomous 必须容器""Review/Test 缺Docker即阻断独立验证"的规则不再成立：独立验证由独立Run/Session/输入/工具集保证（`agents.md` §1），不由容器保证。

## 2. 执行拓扑、权限与Secret

Runner内Pi通过OpenAI-compatible Model Gateway或对应Provider适配器调用模型。Gateway在Core受信侧持有Provider Secret，Runner只持有短期attempt capability；工具执行与Runner的控制连接分离，工具进程不持有模型capability或控制socket。

Capability绑定attempt/epoch/role/allowed methods/expiry；Broker重新校验，Runner不能声明自己是Chief。Core直接处理文件和领域工具；Shell请求由Supervisor另起工具进程（项目选择容器运行环境时为该环境中的进程），工具进程没有model capability或控制socket。

默认执行模式（Workspace/Autonomous）都在宿主进行：读取授权源码快照、写Task工作区和产物目录；信封内操作直接执行、不再逐次询问。Autonomous在启动前保存范围Grant，范围内自动执行。Full Access以执行账户的宿主进程运行，仍经Broker控制工具准入和领域Gate，并保留审计。软件规则和权限模式分别校验。

权限模型（`.agentdev/work/WP-12/T3-implementation.md` 附录 A）把"范围内"具体化为**Plan时信封**：Plan/授权批准时信封（路径 + 操作）即已授予，运行中**范围内操作直接执行、不再逐次询问**（read/search/edit/write/artifact_write/bash/git，含构建、测试、依赖安装、公网与本地网络访问）。**审批只出现一次：不可逆操作**——把交付分支推送到远端、部署/发布、删除数据；未获批准前返回可批准的类型化拒绝（`details.approvable=true`），用户批准后该具体操作按 `once` 执行。三条硬拦不因信封或批准而放松，且返回**类型化拒绝**（`details.approvable=false`，模型被告知"不要重试"）：

1. **凭据形态文件**（附录 A.2 冻结表，如 `.env*`、`*.pem`、`*.key`、`.ssh/**`、`.aws/**`、`.npmrc`、`kubeconfig`）：`read`/`search`/`edit`/`write` 四处共用同一张表，命中即拒（`CONTEXT_FORBIDDEN`），同时按现有 `chief_action_required` 机制落一条用户待办（`kind='sensitive_file'`，不阻塞Run，agent继续别的工作）。搜索时该表在遍历中即跳过命中文件（"search不同表生效等于没拦"）。
2. **网络边界**：**默认通** —— 公网、`127.0.0.1:3000`/`:5432` 等本地服务、内网依赖私服都开箱即通，不需要作者配白名单，也不逐次审批。**只保留两个固定拒绝项，且永不可授权**：① 运行时**实际绑定**的守护自身端口（daemon 控制端点、模型 Gateway 代理、项目协议端口、BFF、admin 面，由监听器绑定时登记而不是常量）；② 云元数据地址（`169.254.0.0/16` 链路本地整段、`100.100.100.200`、`192.0.0.192`、`fd00:ec2::254` 与 `metadata*` 主机名，含 IPv4-mapped 与 NAT64 拼写）——这两项是"自己机器的钥匙"，不是网络功能，被拦不损失正常开发能力。除这两项**没有第三项**。宿主模式下准入层（`tool-handler.ts` 对 `bash` 字面 URL 与 DNS 解析结果的 `NetworkPolicy` 判定）只是**识别与审计**，不是出口控制：裸 socket 可以绕过，该残余风险如实登记（附录 A.5）。项目选择容器环境时，该环境内的网络由项目自身配置决定。（旧"容器出口/sidecar"实装见 `.agentdev/work/WP-12/w6-implementation.md`，仅作历史记录。）`http:` 公网目标仍需显式 `allowInsecureHttp` 授权（W7R1-07），本地/私网 `http:` 属于日常开发默认放行。
3. **删除与Git引用**：工作区内删除允许（兜底=Git + 每任务工作区 + 交付CAS）；工作区外路径删除、以及Agent自己发起的 `git push`/强制重置/`update-ref` 等引用变更拒绝——交付分支的ref变更只由Workspace服务以CAS完成（§7、`reliability.md` §4）。

`configPolicy: 'strict' | 'test'`（附录 A.7）只改**查表前的分支**，不改上表：`strict`（全局默认）拒绝全表；`test` 额外放行应用配置子集（`application*.yml`、`application*.properties`、`bootstrap.yml`、`bootstrap.properties`、`*.properties`、`*.conf`），凭据档与纯密钥材料仍拒。非 `strict` 必须在 `doctor`、项目页与验收报告显著可见，且每次放行读取都写审计（路径 + 策略版本 + 档位）。逐次 `permission.request`/`permission.respond`、`waiting_permission` 挂起与 `once`+`inputHash` 绑定**只服务不可逆操作**（方法保留、正常编码流程不再触发）。

## 3. 挂载与角色ACL

| 运行 | 读 | 写 |
|---|---|---|
| Chief/只读调查 | 选择的文档、授权冻结源码、允许的结构化Artifact | 自己的Artifact |
| Developer | 授权Task源码及所选资料 | 唯一Task工作区（该 Task 自己的外部 Git worktree）、构建临时目录、自己Artifact |
| Review | 冻结代码、产品/Plan/验收、客观测试证据 | 自己报告与检查临时目录 |
| Test | 冻结源码、有效Review、验收 | 构建目录、测试数据和报告 |
| Settlement | 最终Diff及阶段证据、正式文档 | 授权文档候选Worktree、过程报告 |

运行数据库、其他Session/Transcript、全局SecretStore不进入任何角色的路径边界或上下文。文件工具拒绝相对路径逃逸、符号链接逃逸、嵌套仓库逃逸；通过open时再校验真实路径与快照避免仅检查字符串。Review的工具即使运行cat/find也只能看到其授权读范围。

**每任务工作区（W6 实装）**：专业 Run 的 `read/search/edit/write/bash` 根目录是该 Task 自己的外部 Git worktree（`<AGENTDEV_HOME>/task-worktrees/<projectId>/tasks/<taskId>`，由 `packages/core/src/task-workspace.ts` 按 `dependencyRevision ?? Work.baseRevision` 创建），因此"工作区内删除允许"的兜底第二层成立：删除只能落在本 Task 的树里，另一个 Task 的 worktree 与项目根都不在该根路径内，Broker 的文件边界直接拒绝。单写者由两层保证：worktree 租约绑定 `(attemptId, epoch)`（第二个 Attempt 得到 `BUSY`），以及每次工具调用都续期的 Work 级写租约（`data.md` §2 `lease`，进程重启后仍有效）。Chief Run（无 taskId）仍以项目根为根。

## 4. 网络与操作授权

Grant字段：scope=once/run/work/project、runId、workId、toolOperationId、operation、targets、role、stage、expiry、limits、decisionId。project范围只对声明role/stage有效；兄弟Run仅在Grant明确覆盖Work/Project和角色时可用。once必须绑定准确toolOperationId和runId；run绑定准确runId，work绑定workId；缺失对应绑定拒绝。once在准入时消耗，结果不确定不重新消费再执行。

网络工具使用Core的 `NetworkPolicy` 守卫：解析后的每个目标IP都过策略，重定向每跳重验，放行与拒绝都写审计；公网、本地服务与内网默认放行，只有守护实际绑定端口与云元数据地址两项**永不可授权**（§2-2）。宿主模式下这是准入层守卫而不是出口控制，裸socket可绕过，残余风险如实登记。发布/Push/数据删除属不可逆操作，须保存操作清单和确认来源（§2 审批）。

Secret按用途使用，模型Secret仅在Gateway；项目命令Secret按Grant短时注入目标工具，不注入所有Agent。日志做敏感字段和已知值遮蔽；输出不含认证Header。Store在macOS使用Keychain，Linux使用0600加密文件，密钥由安装时生成的0600独立主密钥文件或系统credential提供；备份中单独加密导出。

## 5. 真实验证环境

Review源码只读，执行lint/build等需要写输出时先复制到临时目录，并校验输入代码树Hash；任何测试产生的临时文件不回写候选。Test使用同样冻结输入；环境（宿主描述串，或项目声明的容器镜像）、依赖锁Hash、命令、环境键名、退出码、输出Hash写证据。

**Test 阶段执行验收命令（WP-12 W5 实装）**：Test 角色仍无 shell（§7），验收命令来自**项目配置** `policy.testCommands`（`protocol.md` §1 `ConfigPatch` 字段），由 Core 代表 Test Run 执行：`prepare-run.ts` 把该命令集写进 Test Attempt 的 prompt（"只这些、且模型不能自己跑或编造"），Attempt ready 时 `execution.ts` 经 `Broker.runDeclaredTestCommand` 在**冻结输入的工作目录**逐条执行（默认宿主；项目声明容器运行环境时在该环境内），命令必须命中声明集否则 `NOT_AUTHORIZED`；每条的真实退出码与有界 stdout/stderr 落一条 `evidence` Artifact 与 `test.command_executed` 审计事件，合成 `CheckResult`（全 0 = `passed`，任一非 0 = `failed`，无命令 = `not_covered`，无法执行 = `blocked`）。`StageGate` 在 Test stage 提交时用这份 Core 证据**替换**模型可能声称的 `checkResult`，并在证据未就绪或非 `passed` 时拒绝 `success`（`GATE_NOT_READY`，回传真实命令与退出码），因此"模型自称成功"不能通过门禁；**空 `testCommands` 的默认是诚实缺口**：Test 只能记录 `not_covered` 并交 `needs_input`/`failed`，不能以自述成功放行。

**执行环境描述串（W8-1）**：合成 `CheckResult` 的每个 check 取该 Attempt 在 `attempt.ready` 自报的 `host:<platform>/<arch>/node-<major>` / `container:<image>` 描述串作为 `environmentRef`（不再用 Attempt id），与同一 Test Run 冻结的 `VerificationManifest.environmentRef` 是同一个值（`data.md` §3 `Env`），两处可直接比对；命令实际运行的环境与 Runner 描述串同时写入 `result` 的 `image=`/`runner=`。`environmentRef` 的契约类型因此是"非空描述串"而非 UUIDv7（`packages/contracts` `environmentRefSchema`），库级夹具沿用 id 仍可解析，但生产只写描述串。

**`TestEnvironmentManager` 与本执行风格的关系**：该管理器负责宿主侧 OS 端口认领（含就绪归属证明）、attempt 命名测试 DB 与 `RECOVERY_REQUIRED` 清理，适用于"先起长驻服务再跑命令"的项目。**默认宿主执行**下它直接适用；项目选择在容器内运行服务/数据库时，端口与 DB 由项目自身管理，宿主侧没有可认领的资源，该管理器不适用（这不是被绕过，而是没有宿主侧资源）。

服务端口由Supervisor动态分配，测试DB以attempt命名，跨Task数据库不共享。Shell超时终止进程组，清理端口/进程/临时DB（容器环境另回收容器）；清理失败记录recovery。Fixture/测试脚本改变须经Developer→Review，Test不能修改验收以获得通过。

## 6. HTML与附件

Artifact下载由Core校验Project/Artifact ACL，返回短期60秒单次下载token。BFF转发字节，禁止任意路径。HTML预览置于sandbox iframe，仅allow-scripts，不允许same-origin/forms/top-navigation/popups/downloads；CSP default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'。预览不带工作台cookie，静态产物无法调用业务API。下载通过工作台受权按钮。

上传先写临时文件，校验大小、mime和文件签名，算Hash后原子重命名。附件当作用户数据和调查来源；引用文件中的命令不会直接获得执行授权。

## 7. Pi与扩展契约

固定@earendil-works/pi-coding-agent 0.85.1。Factory显式提供内存Settings、ResourceLoader、SessionManager、ModelRuntime/适配网关及自定义工具。禁用默认环境资源自动发现；角色工具完全由注册表构造。

工具：read/search/context_request/artifact_write；修改角色另有edit/write/bash/git；Chief有assessment_submit/agent_dispatch/decision_request；专业角色有stage_yield/request_dispatch。Shell和Git均走Broker；Git ref修改只由Workspace服务完成。

工具/权限边界的落点是**准入层**（`core/tools.ts` `planToolCall`，daemon `tool-handler.ts` 调用），在Grant与文件边界之前：角色门 → 参数Schema → `~`/绝对路径入口 → 敏感文件表（附录 A.2，read/search/edit/write 共用）→ `bash` 的Git引用守卫与工作区外删除守卫 → `bash` 字面URL交 `NetworkPolicy`（默认通，只有两个固定拒绝项）。因此拒绝发生在"没有文件内容、没有进程、没有Grant被消费"之前，端点再写一条 `tool.refused`（operation/targets/code，不含args原文）。`tool.invoked` 仅在准入通过、`tool_operation` 落库后发出。敏感文件待办与 `test` 档放行审计分别是 `chief_action_required(kind='sensitive_file')` 与 `tool.listed_file_allowed`（含path/pattern/configPolicy/policyRevision）。

Core Critical能力：policy/context/artifact/events/dispatch；初始化失败停止Run。可选内置Extension为发布包白名单清单，字段id/version/apiVersion/capabilities/enabled/critical。**本发布的可选清单是刻意留空的（WP-00 决定，W8-3 登记）**：`packages/pi-runtime/src/extensions.ts` 的 `BUILTIN_EXTENSIONS` 是空数组，daemon 的 `services.extensions` 没有装配点，所以 `extension.list` 诚实返回空清单（`apiVersion=1`、`items=[]`），`extension.set` 对任何 id 返回 `NOT_FOUND`（"不在本发布白名单内"）；这是"零扩展发布"的真实状态，不是缺实现或占位。**新增一个内置扩展需要**：① 把一条 `BuiltinExtensionSpec`（id/version/apiVersion/capabilities/enabledByDefault/critical）加入 `BUILTIN_EXTENSIONS` 并接到 daemon 的 `services.extensions`；② 在 Runner/Core 侧提供并激活它的 capabilities，`critical` 失败必须停止 Run、可选失败只禁用自身；③ 为该扩展补契约测试（未知 id 拒绝、Critical 失败停止、可选失败隔离三条），并同步 `protocol.md` §5 的 `extension.list/set` 形状与 AC-067 的证据。本切片不做这些实现。Project可引用Skill Markdown，需信任且由Chief选择，Skill不能扩大工具权限。

Pi的steer在当前工具调用完成后生效，followUp在当前工作空闲后生效；它们只传递已路由指令，不能直接改变领域授权。取消使用abort并由Supervisor清理工具进程；SDK终止不自动代表副作用已确认。
