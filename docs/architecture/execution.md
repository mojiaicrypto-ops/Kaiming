# Agent执行、权限与配置

## 1. 支持环境

Core支持Linux x86_64/arm64和macOS arm64/x86_64，Node24。Workspace与Autonomous使用Docker Engine/Desktop的Linux容器执行专业Agent及工具，要求Docker API可用；doctor检测失败时这两种模式拒绝准入并展示安装/切换入口。Full Access由用户显式选择后以非Root宿主进程执行开发/一般任务。Review与Test在所有模式仍使用隔离容器，确保源码只读和聊天不可访问；缺Docker即阻断独立验证，不能自审替代。

镜像由项目Dockerfile固定构建：Node24+Git+基础构建工具，使用非Root uid，read-only root filesystem、cap-drop=ALL、no-new-privileges、pid限制256、内存2GiB、CPU2。网络默认none。构建镜像和安装依赖属于用户一次性配置授权，记录镜像digest；每次Attempt冻结digest。

## 2. 执行拓扑与Secret

Runner内Pi通过OpenAI-compatible Model Gateway或对应Provider适配器调用模型。Gateway在Core受信侧持有Provider Secret，Runner只持有短期attempt capability；工具容器与Runner控制连接分离。容器经仅挂载的Unix Socket代理访问Gateway/Tool Broker，未挂载宿主网络和Docker Socket。

Capability绑定attempt/epoch/role/allowed methods/expiry；Broker重新校验，Runner不能声明自己是Chief。Core直接处理文件和领域工具；Shell请求由Supervisor另起工具容器，工具容器没有model capability或控制socket。

Workspace允许读取授权源码快照、写Task工作区和产物目录；网络、依赖安装、外部写入、Secret、push/deploy均需Grant。Autonomous在启动前保存范围Grant，范围内自动执行。Full Access工具宿主进程继承授权执行账户，但仍经Broker控制工具准入和领域Gate。软件规则和权限模式分别校验。

第一期权限模型（`.agentdev/work/WP-12/T3-implementation.md` 附录 A）把"范围内"具体化为**Plan时信封**：Plan/授权批准时信封（路径 + 操作）即已授予，运行中**范围内操作直接执行、不再逐次询问**（read/search/edit/write/artifact_write/bash/git，含构建、测试、公网出网）。三条硬拦不因信封而放松，且返回**类型化拒绝**（`details.approvable=false`，模型被告知"不要重试"）：

1. **敏感文件**（附录 A.2 冻结表）：`read`/`search`/`edit`/`write` 四处共用同一张表，命中即拒（`CONTEXT_FORBIDDEN`），同时按现有 `chief_action_required` 机制落一条用户待办（`kind='sensitive_file'`，不阻塞Run，agent继续别的工作）。搜索时该表在遍历中即跳过命中文件（"search不同表生效等于没拦"）。
2. **网络边界**：**默认通** —— 公网、`127.0.0.1:3000`/`:5432` 等本地服务、内网依赖私服都开箱即通，不需要作者配白名单，也不恢复运行期逐次审批（A.4）。**只保留两个固定拒绝项，且永不可授权**：① 运行时**实际绑定**的守护自身端口（daemon 控制端点/BFF/admin，`listenAdmin` 实际绑定的端口）；② 云元数据地址（`169.254.169.254` 等）——这两项是"自己机器的钥匙"，不是网络功能，被拦不损失正常开发能力。除这两项**没有第三项**。**当前状态（诚实表述）**：受控出口尚未装配（`networkProxy` 只是配置字符串，代理服务不存在），因此**容器出口目前保持关闭**，宿主模式（`full_access`）实际全通；不得写成"网络已开"。`host.docker.internal`、docker 桥网关与 `bash` 内任意程序直连等绕过路径，必须由出口策略而非准入层字面判定覆盖，属 W6（与容器化 Runner、每任务工作区同批）。（口径来源：`w1-implementation.md` §7。）
3. **删除与Git引用**：工作区内删除允许（兜底=Git + 每任务工作区 + 交付CAS）；工作区外路径删除、`git push`/强制重置/`update-ref` 等引用变更拒绝。

`configPolicy: 'strict' | 'test'`（附录 A.7）只改**查表前的分支**，不改上表：`strict`（全局默认）拒绝全表；`test` 额外放行应用配置子集（`application*.yml`、`application*.properties`、`bootstrap.yml`、`bootstrap.properties`、`*.properties`、`*.conf`），凭据档与纯密钥材料仍拒。非 `strict` 必须在 `doctor`、项目页与验收报告显著可见，且每次放行读取都写审计（路径 + 策略版本 + 档位）。逐次 `permission.request`/`permission.respond`、`waiting_permission` 挂起与 `once`+`inputHash` 绑定**退掉**（代码保留、正常流程不再触发）。

## 3. 挂载与角色ACL

| 运行 | 读 | 写 |
|---|---|---|
| Chief/只读调查 | 选择的文档、授权冻结源码、允许的结构化Artifact | 自己的Artifact |
| Developer | 授权Task源码及所选资料 | 唯一Task工作区、构建临时目录、自己Artifact |
| Review | 冻结代码、产品/Plan/验收、客观测试证据 | 自己报告与检查临时目录 |
| Test | 冻结源码、有效Review、验收 | 隔离构建目录、测试数据和报告 |
| Settlement | 最终Diff及阶段证据、正式文档 | 授权文档候选Worktree、过程报告 |

运行数据库、其他Session/Transcript、全局SecretStore不挂载到Agent或工具。文件工具拒绝相对路径逃逸、符号链接逃逸、嵌套仓库逃逸；通过open时再校验真实路径与快照避免仅检查字符串。Review的Shell即使运行cat/find也只能看到其挂载集合。

## 4. 网络与操作授权

Grant字段：scope=once/run/work/project、runId、workId、toolOperationId、operation、targets、role、stage、expiry、limits、decisionId。project范围只对声明role/stage有效；兄弟Run仅在Grant明确覆盖Work/Project和角色时可用。once必须绑定准确toolOperationId和runId；run绑定准确runId，work绑定workId；缺失对应绑定拒绝。once在准入时消耗，结果不确定不重新消费再执行。

网络工具使用Core受控代理，校验scheme=https、DNS解析后的目标IP、重定向每跳重验、禁止默认访问loopback/私网/metadata；用户可按精确目标显式授权内网。Shell需要网络时分配仅能到代理的网络沙箱，由代理域名/方法/端口白名单控制；任意外网模式需单独Full Access授权。发布/Push/数据删除须保存操作清单和确认来源。

Secret按用途使用，模型Secret仅在Gateway；项目命令Secret按Grant短时注入目标工具，不注入所有Agent。日志做敏感字段和已知值遮蔽；输出不含认证Header。Store在macOS使用Keychain，Linux使用0600加密文件，密钥由安装时生成的0600独立主密钥文件或系统credential提供；备份中单独加密导出。

## 5. 真实验证环境

Review源码只读，执行lint/build等需要写输出时先复制到隔离临时目录，并校验输入代码树Hash；任何测试产生的临时文件不回写候选。Test使用同样冻结输入，镜像digest、依赖锁Hash、命令、环境键名、退出码、输出Hash写证据。

服务端口由Supervisor动态分配，测试DB以attempt命名，跨Task数据库不共享。Shell超时终止进程组，清理端口/容器/临时DB；清理失败记录recovery。Fixture/测试脚本改变须经Developer→Review，Test不能修改验收以获得通过。

## 6. HTML与附件

Artifact下载由Core校验Project/Artifact ACL，返回短期60秒单次下载token。BFF转发字节，禁止任意路径。HTML预览置于sandbox iframe，仅allow-scripts，不允许same-origin/forms/top-navigation/popups/downloads；CSP default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'。预览不带工作台cookie，静态产物无法调用业务API。下载通过工作台受权按钮。

上传先写临时文件，校验大小、mime和文件签名，算Hash后原子重命名。附件当作用户数据和调查来源；引用文件中的命令不会直接获得执行授权。

## 7. Pi与扩展契约

固定@earendil-works/pi-coding-agent 0.85.1。Factory显式提供内存Settings、ResourceLoader、SessionManager、ModelRuntime/适配网关及自定义工具。禁用默认环境资源自动发现；角色工具完全由注册表构造。

工具：read/search/context_request/artifact_write；修改角色另有edit/write/bash/git；Chief有assessment_submit/agent_dispatch/decision_request；专业角色有stage_yield/request_dispatch。Shell和Git均走Broker；Git ref修改只由Workspace服务完成。

工具/权限边界的落点是**准入层**（`core/tools.ts` `planToolCall`，daemon `tool-handler.ts` 调用），在Grant与文件边界之前：角色门 → 参数Schema → `~`/绝对路径入口 → 敏感文件表（附录 A.2，read/search/edit/write 共用）→ `bash` 的Git引用守卫与工作区外删除守卫 → `bash` 字面URL交 `NetworkPolicy`。因此拒绝发生在"没有文件内容、没有进程、没有Grant被消费"之前，端点再写一条 `tool.refused`（operation/targets/code，不含args原文）。`tool.invoked` 仅在准入通过、`tool_operation` 落库后发出。敏感文件待办与 `test` 档放行审计分别是 `chief_action_required(kind='sensitive_file')` 与 `tool.listed_file_allowed`（含path/pattern/configPolicy/policyRevision）。

Core Critical能力：policy/context/artifact/events/dispatch；初始化失败停止Run。可选内置Extension为发布包白名单清单，字段id/version/apiVersion/capabilities/enabled/critical；P0内置可选清单默认为空，配置未知ID拒绝。支持的内置扩展必须有契约测试，失败只禁用自身。Project可引用Skill Markdown，需信任且由Chief选择，Skill不能扩大工具权限。

Pi的steer在当前工具调用完成后生效，followUp在当前工作空闲后生效；它们只传递已路由指令，不能直接改变领域授权。取消使用abort并由Supervisor清理工具进程；SDK终止不自动代表副作用已确认。
