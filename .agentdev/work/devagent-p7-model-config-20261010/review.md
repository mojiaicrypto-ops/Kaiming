# Review · devagent-p7-model-config-20261010

独立上下文复核（`P7Verify`），只按 `runtime-contract.md` 的 `config.get/save/test` 行与 R5、P-05、AC-27 核对记录、代码与真实实例（4310，数据 `/tmp/p6/data`）。

## Round 1 · P7Verify · result: failed（2 项阻断）

```yaml
confirmed:
  - "密钥不外泄到服务端面：state.db/-wal 中 grep 'sk-' = 0；config.* 响应只有 credentialRef/credentialConfigured；models.json 为 -rw------- 且正是 Pi 读取的文件（真实 config.test 经它完成一次一 token 调用）"
  - "CAS：provider 与赋值都按 revision 校验（实跑 chief 覆盖 expectedRevision 1 → revision 2）；未知 provider/model、双作用域/缺作用域被拒且赋值被拒时原状态不变"
  - "迁移链完整（新库直建 v8、各版本路径都到 v8；store 测试改用 SCHEMA_VERSION 而非字面量）"
  - "解析实现唯一（resolveEffectiveConfig + resolveStoredConfig；main.ts:92 与 methods.ts:29/78 共用）"
  - "认领时解析已取证：p7-20（覆盖 rev1=deepseek-chat 下认领）effectiveConfig={deepseek-chat, source=role} 且 Pi 历史 message.model=deepseek-chat；其后四次认领在覆盖改回 deepseek-flash 后都记 source=role；修复前 p7-9 记 source=server，正好记录被修的缺陷"
  - "两个新测试非空转（9/9；workbench-entry 用 startWorkbench + 真实 SSE 读者，agent_start/message_end 只能经 onEvent 到达流）"
blocking:
  - id: B1
    verdict: confirmed
    claim: "provider 密钥进入了会话转录：Agent 的内建 read 读了 <agentDir>/models.json，toolResult（含 apiKey）写进 Pi 历史并推送给页面读者——违反 P-05「凭证不出现在对话…或正常读取结果中」、AC-27「正常读取无凭证」、runtime-contract.md:7"
    evidence: "sessions/2026-10-10T03-04-28-720Z_….jsonl:115 toolCall read {\"path\":\"/tmp/p6/data/models.json\"} → :118 toolResult 含 \"apiKey\": \"sk-7a25…\"；同一输入轮内 17:10:54 又读一次；该历史每轮都回放给上游。runner.ts:301-306 允许 Pi 内建工具且无路径约束（session.cwd 是项目，read 却达到了数据目录）"
    remediation: "按项目归属约束 Agent 的文件工具（宿主自有的 read/write/edit，拒绝 session.cwd 之外的 realPath），或让密钥根本不出现在模型可读的文件里（改用 SDK 的 CredentialStore 接非文件存储）"
  - id: B2
    verdict: overclaimed
    claim: "config.test 探到的状态与真实运行不同：runner 的 PiRuntimeFactory 缓存一个 ModelRuntime 且从不重载，保存后的 provider 由 config.test 报 available，但每次认领都 blocked（'has no usable credential'）直到重启——违反 R5「后续 queued 可用新配置」与记录里『试连探到的就是运行用的』"
    evidence: "复核者用脚本复现：已热身工厂 isAvailable(second)=false（写入后仍 false），而新建工厂 same moment = true；代码 pi-runtime.ts:58-72（缓存且 src 内无 refresh 调用）、methods.ts:86（config.test 每次新建工厂）、SDK model-runtime.js:581-582（refresh 是唯一重载路径）、runner.ts:143-148（阻塞）"
```

## 处理

- **B2 已修**：`PiRuntimeFactory.reload()` 重新读取凭证/目录文件；`config.save` 保存 provider 后 **await** 该重载（`main.ts` 把 runner 用的同一个 factory 注入 core methods），`config.test` 也先重载再探、并复用同一运行时（不再另建只能自己看到的运行时）。新增用例复现复核者的场景：热身 → 写入 → 仍 false → reload → true（`provider-config.test.ts`，9/9）。
- **B1 未修，如实标为阻断**：见下节"待决策"。
  - 已核实的事实：密钥必须放在 Pi 能读到的文件里（`models.json`），而角色带有 `read`/`bash`（developer/reviewer 等），**任何路径约束都能被 `bash` 绕过**；因此"Agent 读不到凭证"在现状下只有两条真出路：(a) 收缩角色工具集（去掉 bash，宿主自有 read/write/edit 限定在 session.cwd 内）；(b) 进程级隔离/沙箱，或把密钥移到 Agent 进程读不到的存储（SDK CredentialStore + 操作系统密钥链/仅服务端口令）。
  - 两者都改变产品可见行为（谁还能跑命令、密钥存在何处），属产品/设计决定，不在本切片内自行选定。

## 待用户决策（B1）

1. **收缩工具集**：只读/写/编辑限定在项目目录内，去掉或按角色收紧 `bash`——最贴合产品"Agent 在项目里工作"的语义，但 developer 失去跑测试/构建的命令能力。
2. **密钥换通道**：保留 bash，改用 SDK `CredentialStore` 把密钥放在 Agent 读不到的地方（操作系统密钥链，或仅服务端进程持有的存储）；不改工具集，但引入平台相关的凭证依赖。
3. **接受并明示**：Agent 以操作者权限运行，能读到本机可读的任何文件；在部署说明里明示该边界，并移除"凭证不会进入读取结果"的承诺（需改产品文档，属需求变更）。

## B1 的处置（用户决策：半防护 + 文档如实写边界）

- 代码：`src/runtime/tool-guard.ts`（`createPrivatePathGuard`）在 `tool_call` 前拦截指向服务器私有目录的文件工具与写了该目录路径的 shell 命令；`runner.ts` 对每个会话无条件安装，`main.ts` 传入数据目录与凭证目录。
- 文档：`productnew/modules/project-workspace.md` 的 P-05 条款按事实改写（产品自身读取面 + 模型文件工具 + 明示 shell 边界）；`devagent/README.md` 记同一边界与 `config.*` 用法。
- 证据：`test/tool-guard.test.ts` 7 项；`test/workbench-entry.test.ts` 的真实运行用例（模型读凭证文件被拒、转录不含密钥）。
- 明确不承诺的部分：命令执行没有沙箱，刻意绕过的 shell 仍可读本机文件；需要更强保证时按沙箱单独立项。

## Round 2 · P7Delta · result: failed（2 项新阻断，均已修）

```yaml
closed:
  - "B2 关闭：保存后 reload 经 runner 用的同一 factory；config.save await 后才回；config.test 复用该运行时（复核者引 pi-runtime.ts:81-84 / main.ts:70,73-85 / runner.ts:146 / methods.ts:197 / rpc.ts:140）"
new_blocking:
  - id: B1-a
    verdict: confirmed
    claim: "守卫只认绝对路径：@ 前缀、file://、~/ 这些 Pi 自己会归一化的写法直接绕过，端到端复现 STUB KEY IN TRANSCRIPT: true"
    fix: "normalize() 先镜像 Pi 的输入归一化（去 @、展开 ~/、file://→路径），再 realpath；测试补 @/file:// 两形与一个端到端用例（脚本模型用 @ 形式读凭证文件）"
  - id: B1-b
    verdict: confirmed
    claim: "realpath 失败（目标还不在）时退化为字符串比较 → <project>/plink/extensions/evil.ts（plink 指向数据目录）被放行，Pi 的 write 真在私有目录里建了文件；而 Pi 会自动加载 <agentDir>/extensions/*"
    fix: "resolveThroughAncestors()：把最深的已存在祖先 realpath 后再接回剩余部分；测试补 dangling-symlink 写用例"
new_non_blocking:
  - id: B2-narrow
    claim: "config.test 仍用自己新建的 factory → 手工编辑 models.json（README §3 的首选流程）时 config.test 说可用、运行仍用旧缓存"
    fix: "core methods 支持注入 probeModel；main.ts 注入 runner 的同一 factory，config.test 先 reload 再探"
  - id: B1-c
    claim: "相对的 AGENTDEV_DATA_DIR 会让守卫失效（私有目录按 session cwd 解析，永远匹配不到）"
    fix: "入口 resolve(process.cwd(), env ?? '.agentdev-data')；privateDirs 在入口与守卫内都按服务器 cwd 解析成绝对路径"
```

修复后证据：`tsc 0`；`npm test 227/227（22 文件，含 tool-guard 7 项、entry 2 项、provider-config 9 项）`；`playwright 8 passed`（commit `ab4acb2`）。

## Round 3 · P7Delta2 · result: failed（1 项新阻断，已修）

```yaml
closed:
  - "B1-b 真关闭：real 路径比较拦住了经符号链接祖先的未存在路径与现存链接，且未见误杀"
  - "B2-narrow 关闭（probeModel 注入 runner 同一 factory）；B1-c 关闭（入口解析相对数据目录）"
new_blocking:
  - id: B1-a'
    verdict: confirmed
    claim: "归一化次序写反：守卫先转 file:// 再去 @，而 Pi 是先去 @ 再转 URL —— `@file://<abs>`（含 localhost 主机）仍被放行，真实运行可读到凭证文件"
    fix: "normalizeInput 改成与 Pi 同序（Unicode 空格 → 去一个 @ → 展开 ~/ → file:// 转路径 → 解析）；单测补 @file://、@file://localhost、Unicode 空格；端到端用例改为对同一真实路径依次用 5 种写法各读一次，断言 5 次全被拒且转录不含密钥"
non_blocking: "记录里的计数偏差（tool-guard 项数、provider-config 项数、全量项数）已按实测更正"
```

修复后证据：`tsc 0`；`npm test 227/227（22 文件）`；`playwright 8 passed`。

## Round 4 · P7Delta3 · result: **passed**

```yaml
closed:
  - "B1-a' 关闭：以逐字复制的 SDK `normalizePath`/`resolveReadPathAsync` 与真实 `privatePathBlockReason` 跑形状矩阵（plain/@/@@/file:///@file:///@file://localhost/file://localhost/file://// 带 query 与 fragment/%2ejson/尾随空格/../data/@../data），`insidePrivate && guard=allow` 为 0 形；两层都放行的形态要么落在私有目录外，要么在 Pi 侧直接抛错（没有工具执行）"
  - "端到端用例真实：5 次独立的脚本工具调用；两种绕过下都会失败（拒绝计数从 5 掉下来、或 createStubEnv 的真实凭证文本进转录）"
  - "无误杀：没有任何 Pi 本可打开的合法读取被拒绝（唯一差异是守卫先 trim，且那只拒绝 Pi 自己也会 ENOENT 的调用）"
non_blocking_fixed:
  - "记录笔误：tool-guard 用例数被上一轮改成 9（实际 7）；已在 review.md/implementation.md/settlement.md 按各时点真实值更正"
  - "守卫未镜像 Pi 的 Windows 专有归一化；已在 README 边界段与守卫头部注明本工作台只在 POSIX 部署（不在产品契约里为未部署平台预留代码）"
```

```yaml
result: passed
blocking: none
```
