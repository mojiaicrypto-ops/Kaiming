# 本地模型凭证配置

`model.json` 供真实模型检查（`npm run check:model`）使用，**已被 .gitignore 忽略**，不会提交。
复制 `model.example.json` 为 `model.json` 后填写即可。

**用哪套协议由 `provider` 决定，key 必须与之一致**：

| 你的 key 类型 | 写法 | 说明 |
|---|---|---|
| Anthropic 官方 key（`sk-ant-...`） | `provider: "anthropic"` + `env.ANTHROPIC_API_KEY` | 走 Anthropic Messages 协议，请求头 `x-api-key` |
| OpenAI 官方 key（`sk-...`） | `provider: "openai"` + `env.OPENAI_API_KEY` | 走 OpenAI Chat Completions/Responses 协议，请求头 `Authorization: Bearer` |
| 第三方或本地 OpenAI 兼容端点 | `provider` 自取名 + `endpoint` 块 | 必须写 `endpoint.api = "openai-completions"`，key 放进 `endpoint.apiKey` |

## 字段

- `provider`、`model`：必填，且必须在 Pi 的模型目录里存在（用 `endpoint` 时按你写的 id 注册）。
- `env`：可选，填写后只对本次检查进程生效（用于把 provider 需要的 API key 变量交给 Pi）。
- `endpoint`：可选，仅 OpenAI 兼容/本地端点需要；填写后会写入临时的 `models.json`。
  云端官方服务**不要**填它——那会覆盖内置目录里该模型的元数据。

## 填写后

```bash
cd devagent && npm run check:model
```

它会用真实模型验证：模型可达、模型真的调用提问工具向你提问、你的回答回到模型、以及两条与宿主界面相关的结论在真实模型下依然成立。
key 填错时会直接显示上游的明确错误（例如 `401 authentication_error: invalid x-api-key`）并以非零码退出。