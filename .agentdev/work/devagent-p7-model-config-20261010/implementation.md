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

## 3. 未做（如实登记）

- **前端配置入口**：按用户本轮明确要求，本期界面不需要编辑入口。`config.get/save/test` 已经是可用的系统能力；Settings/Agents 继续只读展示生效配置、来源与 provider 可用性。（P6 中删掉的那两个"点不开的 mock 对话框"保持删除。）
- **删除覆盖**：没有 `config.delete`；撤销一个覆盖目前等于把它改回服务器默认值（经 CAS）。契约未要求删除语义，故未自行新增方法。
- **密钥加密/轮换**：首版明文存于服务器私有目录（0600），与既有 `auth.json`/`models.json` 一致；契约只要求"密钥保存 Server 私有目录、查询只返引用"。
