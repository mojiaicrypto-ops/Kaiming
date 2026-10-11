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
- 证据：`test/tool-guard.test.ts` 5 项；`test/workbench-entry.test.ts` 的真实运行用例（模型读凭证文件被拒、转录不含密钥）。
- 明确不承诺的部分：命令执行没有沙箱，刻意绕过的 shell 仍可读本机文件；需要更强保证时按沙箱单独立项。

## Round 2 · 增量复核 · 待发起

（复核者应验：B2 的 reload 语义、B1 的守卫是否真的拦住文件工具与显然的 shell 命令、改写后的文档是否与代码一致、以及新测试是否非空转。）
