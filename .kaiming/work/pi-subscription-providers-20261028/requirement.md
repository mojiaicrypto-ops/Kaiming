# 待实现需求 · 订阅账号接入（Claude Pro/Max、ChatGPT）

状态：**pending（待实现，未设计确认）**
记录日期：2026-10-28
来源：用户要求在实现前先记录为待实现需求；此前已完成 Pi provider 能力核对。
关联缺口：[S8](../../../docs/technicalnew/gap-register.md)

## 目标

用户能在工作台内通过订阅账号使用模型，而不只依赖自定义 API key：

- Anthropic：Claude Pro/Max（Pi provider `anthropic`，OAuth，`isSubscription=true`）；
- OpenAI：ChatGPT Plus/Pro（Pi provider `openai`，`Sign in with ChatGPT`，`isSubscription=true`）；
- `openai-codex` 仅作为旧账号兼容，不作为新接入的首选。

登录后该账号的模型出现在现有模型选择中，可按全局角色、项目默认、项目角色分配；运行、刷新 token、失败提示与退出登录都可用。

## 当前事实（已核对）

- Pi 1.0.0 已内置上述 OAuth provider，凭据写入 `<agentDir>/auth.json`，由 SDK 自动刷新。
- 本工作台 `PiRuntimeFactory.runtime()` 已把 `<agentDir>/auth.json` 传给 `ModelRuntime.create`，所以运行链路已经能解析订阅凭据。
- 当前设置页的 provider 表单要求 `baseUrl + api + models + apiKey`，并写入 `models.json`；模型分配又要求 SQLite `providers` 行先存在。
- 没有 `auth.login` / `auth.logout` / 登录状态查询方法，也没有订阅账号 UI。
- 当前 `.agentdev-data/auth.json` 为空，尚无订阅凭据。

## 范围

包含：

- 认证：查询 provider 支持的登录方式；启动 OAuth 登录；处理浏览器回调、设备码、复制 code 三种交互；取消；退出登录；查询“已连接/需要重新登录/订阅/未配置”。
- 订阅 provider 表达：登录成功后生成可分配的 provider/model 行，不写 `models.json`、不要求 `apiKey`；模型列表取自 Pi 内置 catalog。
- 模型选择：现有三层（全局角色、项目默认、项目角色）继续可用；订阅模型与 API-key 模型可并存。
- 运行：沿用 Pi `ModelRuntime` 的 OAuth 解析与刷新；不新增第二套 token 管理。
- 安全：token 只存 `auth.json`（0600）；API/日志/报告/错误消息不返回 token；登录状态只返回非秘密信息。
- 用量：订阅调用如实记录 token 用量并标记订阅；不把 token 数当实际账单金额。

不包含：

- 修改 Pi SDK 的 OAuth 实现或自建 token 刷新；
- 多账号并存、团队账号、额度/套餐/账单页；
- 把 Claude Code/Codex 的本地登录文件直接复制进来；
- 现有 API-key provider 表单的行为改变。

## 行为与异常

- 用户选择“Claude Pro/Max”或“ChatGPT”登录 → 服务端启动 Pi OAuth，向界面给出可打开的 URL、设备码或提示输入；界面不接触 token。
- 浏览器回调可达本机时自动完成；远程/无头环境下可粘贴最终 redirect URL 或 authorization code，流程与 Pi 一致。
- 登录成功 → 保存 `auth.json`，模型选择中可见该 provider 的 catalog 模型；无需重启工作台，下一次输入即可使用。
- token 过期 → SDK 自动刷新；刷新失败 → 模型可用性检查返回“需要重新登录”，不静默换用别的模型。
- 退出登录 → 删除该 provider 的凭据，已分配的模型保留但显示不可用，运行前明确阻断；不删除历史和用量。
- 登录取消/超时/回调 state 不匹配 → 如实返回，不写入半份凭据。
- 浏览器在另一台机器或回调端口不可用 → 必须提供复制 code/设备码路径，不能只支持本机回调。
- 订阅与 API key 同时存在 → 用户可区分当前实际用的是哪一种；不自动覆盖现有 API-key provider 配置。

## 验收

1. 设置页登录 Claude Pro/Max，完成 OAuth；刷新页面后状态仍为已连接，模型选择出现 Anthropic 模型。
2. 登录 ChatGPT（`openai`），完成 `Sign in with ChatGPT`；模型选择出现 OpenAI 模型，且不要求填写 API key。
3. 分别把两种订阅模型分配给一个角色，提交消息；真实返回成功，用量记录包含 provider/model 与 token。
4. 删除/使 `auth.json` 中该 provider 凭据失效，重新打开设置页：显示需要重新登录；不显示成功；运行该模型被明确阻断。
5. 退出登录：`auth.json` 对应项删除，API 响应和日志中无 token；模型行显示不可用。
6. 远程/无头场景使用复制 code 或设备码完成登录，不依赖服务端 localhost 回调。
7. `auth.json` 权限为 0600；API 响应、错误、报告、SQLite 中均无 access/refresh token。
8. 订阅调用在用量页标为订阅，金额不冒充实际账单。

## 来源与决定

- 用户 2026-10-28 明确要求先记录为待实现需求，不立即实现。
- Pi 1.0.0 `ModelRuntime` 已提供 `login/logout/isUsingSubscription/getProviderAuthStatus`；provider 元数据实测：
  - `anthropic` → `Anthropic (Claude Pro/Max)`；
  - `openai` → `OpenAI (ChatGPT subscription)` / `Sign in with ChatGPT`；
  - `openai-codex` → legacy。
- 本工作台运行时已读 `auth.json`；缺口集中在设置/认证层。

## 未知（是否阻止实现）

- 浏览器回调在远程部署下如何暴露（反向代理、回调端口、设备码优先级）——不阻止，需在设计中选一种。
- 订阅账号的提供商条款/额度是否允许该用法——需用户确认，不作为程序能力假设。
- 是否允许同一 provider 多账号——首版可不支持；不阻止。
- 订阅调用的成本展示口径——可先标订阅，不阻止。

## 完成摘要

尚未实施。
