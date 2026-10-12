# Implementation · devagent-p7-model-config-20261010

需求背景见 `plan.md`（R5/`runtime-contract.md:146`、P-05、AC-27 明确要求系统支持"编辑 provider + 按角色/项目配置模型"；此前只有 `config.get`）。

## 1. 实现

- **存储（schema v7 → v8）**：新增 `providers`（providerId/baseUrl/api/models/credentialRef/revision/时间）与 `model_overrides`（scope='role'|'project' + scopeId/providerId/modelId/revision，主键 (scope,scopeId)）。`SCHEMA_VERSION` 7→8，新增 `migrateV7ToV8()` 并接进 1→…→7 的每条迁移链；全新库由 `SCHEMA_SQL` 直接建表。`Store` 新增 `saveProvider/getProvider/listProviders/saveModelOverride/getModelOverride/listModelOverrides`，全部按 revision CAS（`expectedRevision:null` 表示必须不存在）。
- **私有凭证（键永不入库、永不回显）**：`src/runtime/provider-store.ts` 把 provider 定义**合并**写入 `<agentDir>/models.json`（Pi 自己的形态，0600、临时文件 + rename 原子替换），库里只记 `credentialRef = models.json#providers.<id>`。更新时可以只改目录/模型清单而沿用已有 key。
- **`config.save`**（write，需 CSRF）：`value.kind='provider'` 保存 provider 定义；`value.kind='model'` + 恰好一个 `roleId`/`projectId` 保存赋值。校验 providerId 形态、baseUrl、models 非空、provider 必须已配置、model 必须在该 provider 的清单内、项目必须存在；`expectedRevision` 必须是整数或 null。响应只含 `credentialRef`/`revision`/`models` 与 `credentials:{mode:'reference',inResponse:false}`。
- **`config.get`**：生效配置改由**存储**解析（role 覆盖 → project 覆盖 → server 默认），并额外列出现有 providers（含 `credentialConfigured`，无 key）。
- **`config.test`**：真实试连。先用 SDK 目录/凭证可用性判断（与 runner 同判据），再对可用选择发起**一次真实的一 token 调用**（SDK `completeSimple`，8s 上限），如实返回 `available` 与原因（上游错误原文、不在目录、无可用凭证、超时）。不保存任何配置、不创建会话、不回显密钥。
- **认领时解析（R5）**：把"存储覆盖 → 生效配置"收敛成**唯一实现** `resolveStoredConfig()`（`src/runtime/config.ts`），`config.get`/`config.test` 与 `main.ts` 的 runner `resolveConfig` 共用；runner 的解析签名增加 `projectId`（`resolveConfig(roleId, projectId)`），因为项目覆盖离开项目无法解析。

## 2. 本轮验收发现并修掉的缺陷（P7-e）

- **现象**：`config.get` 已按角色覆盖报告 `deepseek-chat`，但真实运行仍用 server 默认 `deepseek-flash`——**页面说的和实际跑的不是一回事**。
- **证据（同一会话，同一覆盖）**：
  - `p7-5`（覆盖前）`effectiveConfig` → `deepseek-flash / source=server`
  - `p7-9`（覆盖已保存、但修复前认领）→ `deepseek-flash / source=server`（缺陷）
  - `p7-20`（修复后认领）→ **`deepseek-chat / source=role`**；Pi 原生历史里该轮 `message.model = "deepseek-chat"`，即真正回答的模型就是被覆盖的模型
- **根因**：`startWorkbench` 的 `resolveConfig: (roleId) => resolveEffectiveConfig({roleId, server})` 从不查存储；同一段"role→project→server"的拼装逻辑在 RPC 层和 runner 层各写了一遍，于是漂移。
- **修复**：抽出 `resolveStoredConfig()` 单一实现，两条路径共用；runner 认领时带上 projectId。补测试：`test/provider-config.test.ts` 里直接断言该函数在 role/project 两种作用域下的优先级与回退。

## 2b. 自查发现的接线断裂

改写 `main.ts` 的 `resolveConfig` 时，我用整段替换把 `InputRunner` 的 `onEvent` 发布接线一并删掉了：runner 照常运行（输入 completed、历史里有回复），但事件永不进入会话流，页面表现为"提交后什么都不出现"。`tsc` 不会报（该选项可选），单元测试全绿（它们各自搭栈、不经过入口），只有浏览器验收用例与真实实例上的观察抓到。修复后新增 `test/workbench-entry.test.ts`：用 `startWorkbench` 真跑一次输入，断言读者收到 `agent_start`/`message_end` 且历史里有 assistant 消息；经变异验证（删掉 `onEvent` 即失败）。

## 2c. 独立复核后的修复与遗留（见 review.md）

- **已修（B2）**：复核发现 `config.test` 探到的状态与真实运行不同——runner 的工厂缓存一个运行时且从不重载，于是"保存后用 config.test 说可用、认领时却 blocked 直到重启"。修复：`PiRuntimeFactory.reload()` 重读凭证/目录；`config.save` 写入 provider 后 await 重载（runner 用的同一 factory 由 `main.ts` 注入 core methods）；`config.test` 先重载再探且复用同一运行时。新增用例复现并固定该场景（热身 → 写入 → 仍 false → reload → true）。
- **B1 处置（用户选择"半防护 + 文档如实写边界"）**：新增 `src/runtime/tool-guard.ts` —— 一个 Pi 扩展，在任何工具执行前拦截：带路径参数的文件工具（read/edit/write/ls/find/grep）只要指向服务器私有目录（数据目录/凭证目录，含经 realpath 解析的符号链接）就**拒绝执行并说明原因**；shell 工具（bash/powershell）若命令文本里出现私有目录路径也拒绝。runner 对每个会话无条件安装该守卫（`privateDirs` 由入口传入，取数据目录与凭证目录的并集）。文档按事实改写：`project-workspace.md` 的 P-05 条款改为"凭证不出现在产品自身的读取面（对话事件/报告/知识/需求/成果/接口响应）+ 模型文件工具不得读私有存储"，并明示边界（shell 与操作者同权限，刻意绕过仍可读本机文件，需更强保证则另立沙箱需求）；`devagent/README.md` 增加同样的说明与 `config.*` 接口用法。
  - 证据：`test/tool-guard.test.ts`（9 项：绝对/相对路径、ls/grep/edit、项目内放行、bash 文本、符号链接、无私有目录时不设防、Pi 归一化的各种写法 `@`/`file://`/`@file://`/`@file://localhost`/Unicode 空格、未存在路径经符号链接祖先）；`test/workbench-entry.test.ts` 的真实运行用例——脚本模型对凭证文件**真实路径**依次用 5 种写法各 `read` 一次，断言 5 次都被拒且转录**不含** stub 密钥。
  - 守卫的写法归一化与 Pi 自身**同序**（去 Unicode 空格 → 去掉一个 `@` → 展开 `~/` → `file://` 转路径 → 解析），第三轮复核正是抓到"先转 URL 再去 `@`"导致 `@file://…` 漏过；`privateDirs` 与相对 `AGENTDEV_DATA_DIR` 都在入口解析为绝对路径。
  - 证据（本轮，commit `ab4acb2` 与之后）：`tsc 0`；`npm test 227/227（22 文件，其中 tool-guard 9、workbench-entry 2、provider-config 9）`；`playwright 8 passed`；`prompts 15/15`；`selectors 485/485`。
  - 仍未关闭的部分（如实登记）：这不是沙箱，`bash` 通过其他写法仍可能读到同一文件；"凭证不出现在对话"在产品自身上下文成立，在"刻意越权的命令"上不成立——这正是 P-05 改写后的措辞。
- **（历史，已由上述处置覆盖）B1 原判**：Agent 的内建 `read` 读到了 `<agentDir>/models.json`，含 key 的 toolResult 进入 Pi 历史与页面流。密钥必须待在 Pi 能读的文件里，而角色带有 `bash`，任何路径约束都能被绕过——真正的出路是收缩工具集或换凭证通道（或接受并以文档明示），属产品/设计决定，见 review.md「待用户决策」。

## 2d. R5 三句的逐句落地状态（如实）

| R5 句子 | 本实现的落点 | 证据 |
|---|---|---|
| 活动输入不受设置变更影响 | 运行中的会话在认领时锁定模型对象，`config.save` 只重载工厂（针对下一次认领） | **实跑取证**：`workbench-entry.test.ts` 第三例——让运行停在 `question` 上，此时保存 provider（加入第二个模型）并把项目覆盖指到 `stub-2`，再回答；该输入的第二轮模型请求仍是 `stub-1`，其 `effectiveConfig` 记为 `stub-1 / source=server`（并未被中途改写） |
| 后续 queued 可用新配置 | `config.save` await 工厂 `reload()` 后，下一次认领用新配置 | 实跑 `effectiveConfig` 覆盖前后对照（`deepseek-flash/server` → `deepseek-chat/role`）+ Pi 原生历史 `message.model` |
| 原已执行输入恢复时用原配置，不可用等待明确变更，不静默换模型 | 每个已认领输入记 `effectiveConfig`（脱敏配置 + 请求/生效工具名，`store.recordEffectiveConfig`），`session.input.get` 现在**返回**该记录（脱敏，无凭证），会话绑定另记 `configHash` | 记录面可读：`session.input.get` 的 `effectiveConfig`（`modelId/providerId/source/工具名`）已在实跑用例中断言；`session.recovery.inspect` 另给 `configHash` |

**边界（不冒充）**：本实现不重放被中断的输入——S7 要求先核实并 `session.recovery.resolve` 关闭，后续工作由**新输入**接续，新输入按当前（操作者显式保存过的）配置解析。所以"不静默换模型"在这里成立的方式是"从不重放旧输入 + 旧输入的真实配置可查"；"恢复时按原配置、不可用则等明确变更"的**比较与拒绝**逻辑要等出现"继续这个输入"的入口才有落点——届时必须读 `effectiveConfig`，不可用则按 `MODEL_UNAVAILABLE` 排队而不是换模型。本条按未取证登记。

## 3. 未做（如实登记）

- **前端配置入口**：按用户本轮明确要求，本期界面不需要编辑入口。`config.get/save/test` 已经是可用的系统能力；Settings/Agents 继续只读展示生效配置、来源与 provider 可用性。（P6 中删掉的那两个"点不开的 mock 对话框"保持删除。）
- **删除覆盖**：没有 `config.delete`；撤销一个覆盖目前等于把它改回服务器默认值（经 CAS）。契约未要求删除语义，故未自行新增方法。
- **密钥加密/轮换**：首版明文存于服务器私有目录（0600），与既有 `auth.json`/`models.json` 一致；契约只要求"密钥保存 Server 私有目录、查询只返引用"。
