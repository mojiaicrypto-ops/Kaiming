# Plan · devagent-p7-model-config-20261010

## 1. 事实（证据）——需求确实要求系统支持，当前只实现了一半

**产品需求**
- `docs/productnew/README.md:101`：**模型设置**——"配置默认模型，**按专业角色或项目调整**，检查实际可用性"。
- `docs/productnew/modules/project-workspace.md:45-51`（P-05）：默认模型供各角色使用；"**用户可按角色设置，也可针对某个项目调整**"；"当前工作显示实际使用配置；更改不悄悄替换已经开始的工作"；"配置无效或模型不可用时，提示具体原因和**设置入口**……**不暗中改用另一个模型**"。
- `docs/productnew/journeys.md:7`（J-01）："工作台给出**模型设置入口**，用户配置默认模型并检查可用性。"
- `docs/productnew/acceptance.md:39`（AC-27）："按说明进入并**配置默认和角色/项目模型**，试无效配置与不可用模型"→"模型实际检查有结果、**覆盖设置可辨认**；输入保留、**当前工作不静默换模型**"。

**技术契约**
- `docs/technicalnew/runtime-contract.md:47`（R1 方法表）：`config.get/save/test`，参数 `projectId?、roleId?`；`save: expectedRevision/value`；`test: 配置引用`；返回"脱敏有效配置、版本/实际试连结果；**密钥仅保存私有凭证引用**"。
- `runtime-contract.md:146`（R5）："配置服务**至少**支持**读取脱敏有效配置、保存预期版本的项目/角色覆盖、试连并返回实际 provider/model 与错误**。密钥保存 Server 私有目录，查询只返引用/可用性……对应 AC-27。"
- `runtime-contract.md:7`："模型/凭证设置使用配置服务，私有凭证不进入响应。"
- `runtime-contract.md:144`（R5）：认领时解析角色/项目/Server 覆盖并固定 `effectiveConfigHash` 与 `credentialRef`；活动输入不受设置变更影响；后续 queued 用新配置；已执行输入恢复用原配置，**不可用则等待明确变更，不静默换模型**。
- `architecture.md:117`："凭证只存 Server 私有存储。"

**用户本轮确认的两层**，按契约词汇即：(1) provider 定义（baseUrl/api/密钥/模型清单，密钥进 Server 私有存储、只回引用）；(2) **角色覆盖**（角色 → provider/model）与**项目覆盖**（项目 → provider/model）。

**当前实现（`61e5924`/`c345c6b` 上实测）**
- `config.get` 存在且诚实：`src/server/methods.ts:19-51` 返回脱敏生效配置 + `credentials:{mode:'reference',inResponse:false}`；项目覆盖处注明"stored with config.save (a later slice)"。
- 解析函数支持三层：`src/runtime/config.ts:38-58`（role → project → server），`redactEffectiveConfig` 已脱敏。
- **缺**：`config.save`、`config.test`、覆盖的持久化、provider 定义与私有凭证的写入路径、`credentialRef`。`roleOverrides` 只是构造参数，服务端未接任何来源。
- 结论：**AC-27 的"配置角色/项目模型 + 试无效配置"这半条目前不满足契约**；P6 记录里把 AC-27 记为"部分 pass"是对的。

## 判决（范围）

- 本轮实现**系统侧**：provider 定义的存取（密钥进 Server 私有存储）、角色/项目覆盖、`config.save`（CAS）、`config.test`（真实试连）、`config.get` 读真实存储。
- 本期**不做前端配置入口**（用户明确接受）：Settings/Agents 继续只读展示生效配置与来源；等界面需求另立切片时再做。
- 不做：多用户/权限、远程密钥托管、模型路由策略、按任务类型选模型。

## 切片

```yaml
- id: P7-a 存储（schema v7 → v8）
  change: providers(id, baseUrl, api, models JSON, credentialRef, revision, createdAt, updatedAt) 与 model_overrides(scope='role'|'project', scopeId, providerId, modelId, revision, createdAt, updatedAt)，主键 (scope, scopeId)；密钥写入 <dataDir>/credentials.json(0600)，库里只留 credentialRef
  verify: 单元测试（迁移、CAS、唯一性、重启后仍在）；app 版本面（no model）不受影响
- id: P7-b config.save
  change: value.kind = provider | role-override | project-override；写操作（CSRF/R6 形状）；expectedRevision CAS；provider 必须存在且模型在其清单内；密钥只进私有文件、响应只回引用与 version
  verify: 单测（CAS 冲突 409、未知 provider 400、密钥不出现在任何响应/DB）；真实 HTTP 调用
- id: P7-c config.test
  change: 对给定 provider/model 或 projectId/roleId 的生效配置做真实试连（ModelRuntime.create({allowModelNetwork:true, modelRefreshTimeoutMs}) + getAvailable()），返回实际 provider/model、available、失败原因；不写任何配置、不调用模型会话
  verify: 真实 deepseek 试连通过；故意错 key / 不存在模型返回真实错误
- id: P7-d config.get 接存储
  change: role/project 覆盖来自库（不再用构造参数），source 仍如实标 role/project/server；响应仍不含任何密钥
  verify: 保存后 get 反映覆盖且 source 正确；删掉覆盖回落 server
- id: P7-e 认领语义核对
  change: 认领时用当时覆盖解析并固定 configHash/credentialRef（已存在）；核对"活动输入不受影响、queued 用新配置、恢复用原配置且不可用等待"
  verify: 单测 + 真实运行
- id: P7-f 记录与审阅
  change: implementation/test/review/settlement；技术文档如需补充以实际实现为准
  verify: 独立上下文复核
```

## 明确不做

- 前端 provider/角色编辑界面（用户明确本期可以没有）；不新增协议（沿用 `config.*` 三个方法名与 R6 错误形状）。
- 不把密钥写进项目目录或任何响应；不做密钥轮换/加密存储（首版私有目录 + 0600，如实说明）。

## 风险

- Pi 的 `models.json`/`auth.json` 是 SDK 的形态：我们对 provider 的写入要与它一致（`providers.<id>.{baseUrl,api,apiKey,models[]}`），否则试连与真实运行会不一致。
- 覆盖变更与已开始工作的关系容易"看起来对"：必须有可复现证据（认领时固定 hash、queued 用新配置）。
