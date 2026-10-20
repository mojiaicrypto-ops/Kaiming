# 模型配置矩阵 · 后端需改（待实施）

日期：2026-10-21。场景来自用户确认：*test 角色全局配置 gpt-6；某项目里可单独把 test 配成 gpt-5；每个角色都能单独配置。*
UI 先按此场景设计，本文档记录达成该场景所需的后端改动，实施前逐项核对。

## 现状（代码事实）

| 事实 | 位置 |
|---|---|
| 覆盖存储为 `(scope, scopeId)` 主键，`scope ∈ {'role','project'}` | `src/store/store.ts` `model_overrides` |
| 解析顺序：**role 覆盖 → project 覆盖 → server 默认**，取第一个非空 | `src/runtime/config.ts` `resolveEffectiveConfig` |
| `config.save` 的 `kind=model` 要求 roleId 与 projectId **恰好给一个** | `src/server/methods.ts` `saveModelAssignment` |
| `config.get` 只返回单个角色的生效配置 + 全量 providers | `src/server/methods.ts` `readConfig` |
| 未找到列表方法：`listModelOverrides` 只在 store 内可用，RPC 无入口 | 同上 |
| `config.get` 的 `effective` 无"被哪一级覆盖"的完整来源链，只有 `source: role\|project\|server` | `redactEffectiveConfig` |

## 与目标场景的三个差距

| 差距 | 现象 | 影响 |
|---|---|---|
| **G-C1 优先级方向** | 现在角色级压过项目级：设了全局 `test=gpt-6` 后，项目里把 `test` 配成 `gpt-5` 不会生效 | 目标场景**当前做不到** |
| **G-C2 覆盖维度** | 只有"整项目一套"和"整角色一套"，没有"项目 × 角色" | 项目 A 里 test=gpt-5、develop=gpt-6 无法表达 |
| **G-C3 读取接口** | 无批量读取；界面要显示 7 角色 × N 项目的矩阵，只能逐个角色调 `config.get` | N 项目 × 7 角色 = N×7 次请求，且拿不到覆盖值本身 |

## 需改项（按最小改动排序）

### 1. 解析顺序改为 project+role → project → role → server

- `model_overrides` 增加 `scope='project_role'`，`scopeId` 形如 `<projectId>/<roleId>`（或加一列 `roleId`）。
- `resolveEffectiveConfig` 增加 `projectRoleOverrides` 入参，顺序：`projectRole ?? project ?? role ?? server`。
- `source` 增加 `'project_role'`。
- 迁移：现有 `role`/`project` 记录语义不变（仍作回退层），不需要数据迁移。

### 2. `config.save` 允许同时给 roleId 与 projectId

- 现有校验"恰好一个"改为：至少一个；两个都给 = 保存项目×角色覆盖。
- `expectedRevision` 语义不变（按 `(scope, scopeId)` 版本）。
- 增加"清除覆盖"的明确操作（删除行），避免用空值表达。

### 3. 新增只读配置矩阵查询

```
config.matrix({ projectId? })
→ {
    providers: [{ providerId, models: [{id,name}] }],
    server: { providerId, modelId },                    // 服务端默认
    roles: [{
      roleId,
      roleOverride: { providerId, modelId, revision } | null,
      effectiveHere: { providerId, modelId, source },   // 在 projectId 下的生效值
    }],
    projectOverride: { providerId, modelId, revision } | null,
    projectRoleOverrides: [{ roleId, providerId, modelId, revision }]
  }
```

- 一次请求供给设置页整张表；`source` 取值 `project_role | project | role | server`。
- 只读，无新协议；`config.get` 保留（单角色诊断与试连用）。

### 4. 试连语义确认

- `config.test` 支持显式 `{providerId, modelId}`，可对"尚未保存的候选"试连——UI 的"测试"按钮无需额外接口。
- 需要新增的是**按覆盖层级试连**无需改动：显式选择已覆盖该用途。

## 不做

- 不做按 provider 限流、配额、成本统计。
- 不做按 Task/按会话临时指定模型（属于另一层需求）。
- 不改 Pi 侧原始配置文件格式。

## 与 UI 的对应

| UI 区域 | 依赖改动 |
|---|---|
| 设置 → 模型：全局默认 + 角色行 | 3（矩阵查询） |
| 项目设置 → 模型：项目默认 + 每角色覆盖 | 1、2、3 |
| 行内"来源"标记（继承自全局 / 本项目指定） | 1（`source` 取值） |
| "恢复继承"按钮 | 2（清除操作） |
| 编辑时"测试" | 无（现有 `config.test`） |
