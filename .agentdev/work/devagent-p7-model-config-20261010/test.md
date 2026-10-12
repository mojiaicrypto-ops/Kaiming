# Test · devagent-p7-model-config-20261010

判据：`docs/technicalnew/runtime-contract.md` 的 `config.get/save/test` 行与 R5、产品 P-05、AC-27。

## 1. 自动化

```
tsc --noEmit                       0
npm test                           218/218（21 文件）
npx playwright test                8 passed（真实 Chromium + 真实服务进程 + stub 模型端点）
npm run check:prompts              15/15
npm run spikes                     47/47
node web/styles/verify-selectors.mjs  485/485（extra 0）
node checks/runner-real-model.ts   4/4（真实模型）
```

新增用例（`test/provider-config.test.ts`，8 项）：provider 建立/revision CAS/合并写入（沿用已有 key）/密钥不入库不入响应/文件权限 0600；角色与项目赋值的 CAS、未知 provider、未知 model、同时给两个作用域、缺作用域、跨项目；`resolveStoredConfig` 的 role→project→server 优先级与回退；`config.test` 对不可达端点的真实失败与对生效配置的解析。另有 `test/workbench-entry.test.ts`（1 项）：用 `startWorkbench` 组合根真跑一次输入，断言读者在流上收到 `agent_start`/`message_end` 且历史里真有 assistant 消息——**经变异验证**（删掉入口里的 `onEvent` 发布，该用例失败）。

## 2. 真实运行（端口 4310，数据目录 `/tmp/p6/data`）

- `config.save` 保存 provider（deepseek，含两个模型）→ 响应只有 `credentialRef: "models.json#providers.deepseek"` 与 `revision`，无 key；`/tmp/p6/data/models.json` 权限 `-rw-------`（0600）、含 key；`state.db` 里 `grep -c 'sk-'` = **0**。
- `config.save` 角色赋值（reviewer → deepseek-chat）→ `config.get {roleId:reviewer}` 返回 `source: "role"`、`modelId: "deepseek-chat"`、providers 列表（`credentialConfigured: true`，无 key）。
- `config.test {providerId:deepseek, modelId:deepseek-chat}` → 1.0s 内 `available: true`、`detail: "deepseek/deepseek-chat answered a one-token request"`（**真实一试连**）；`{modelId:no-such-model}` → `available: false`、`is not in the catalog`。
- **认领时解析（R5）**：同一会话、同一覆盖下三次运行的 `session_inputs.effectiveConfig`：
  - `p7-5`（覆盖前）→ `deepseek-flash / source=server`
  - `p7-9`（覆盖已保存、但修复前认领）→ `deepseek-flash / source=server` ← 缺陷
  - `p7-20`（修复后认领）→ **`deepseek-chat / source=role`**，且 Pi 原生历史该轮 `message.model = "deepseek-chat"`
- CAS 实跑：`config.save {expectedRevision:1, roleId:chief, …deepseek-flash}` → `revision: 2`（把覆盖改回默认）；未知模型若不在 provider 清单内则在保存阶段就被拒。

## 3. 本轮发现并修掉的缺陷

1. **覆盖不生效（R5 违背）**：`config.get` 说角色用 deepseek-chat，实际运行仍用服务器默认。根因是 runner 的 `resolveConfig` 从不查存储，且同一段解析逻辑在 RPC 层重复实现了一遍。修复：抽出唯一实现 `resolveStoredConfig()`，两条路径共用，runner 认领时带上 projectId（见 §2 的三条 effectiveConfig 证据）。
2. **组合根静默断裂（本轮自查发现）**：我在改写 `main.ts` 时误删了 `InputRunner` 的 `onEvent` 发布接线——runner 照跑，但事件永不进入会话流，页面表现为"输入提交后什么都不出现"。单元测试全绿（它各自搭栈，不经过入口），只有浏览器验收用例抓到。修复后补了一个**走组合根**的用例并做变异验证（见 §1）。

## 4. 未执行 / 未做

- **前端配置入口**：按用户本轮明确要求不做；`config.save/test` 只在 RPC 层可用。
- **删除覆盖**：无 `config.delete`；撤销 = 改回默认值（本页 §2 实跑演示）。
- **密钥加密/轮换**：明文于服务器私有目录（0600），与既有 `auth.json`/`models.json` 同侧；契约只要求私有存放 + 只回引用。
- **上层语义核对（R5 的其余半句）**：**活动输入不受设置变更影响**已由 `p7-9`（覆盖保存后、修复前认领的那次）间接体现；**queued 用新配置、已执行输入恢复用原配置且不可用等待明确变更**这三条尚未专门取证，留待独立审阅后补齐或转入后续切片。
- **未复现观察**：通过页面 seam 直接 `store.startSession()` 新建会话后提交，`sessionView.messages` 有 user+assistant，但 `#projectMessages` 未渲染；走界面输入框的正式路径（浏览器验收用例）8/8 通过。已记录，未定位。

## 5. 独立审阅

见 `review.md`。审阅者应能在 `/tmp/p6/data`（实例 4310，口令 `p6-acceptance`）上复核 §2 的每一条。

## R5 恢复条款的取证状态

- 已取证：后续 queued 用新配置（覆盖前后 `effectiveConfig` 对照 + Pi 原生历史 `message.model`）；`config.save` 后无需重启即可用（`provider-config.test.ts` 的热身 → 写入 → 仍 false → reload → true）。
- 记录面已就位：每个已认领输入 `effectiveConfig`、会话绑定 `configHash`、`session.recovery.inspect` 可读。
- **未取证**："活动输入在保存时不受影响"（无实跑对照）、"恢复已执行输入按原配置且不可用时等明确变更"（本实现不重放旧输入，缺"继续这个输入"的入口，故无落点）。二者都不记为通过。
