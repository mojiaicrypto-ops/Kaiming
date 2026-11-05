# Test Report · devagent-real-model-20261005

```yaml
test:
  task: devagent-real-model-20261005
  environment:
    runtime: node v24.8.0；@earendil-works/pi-coding-agent 1.0.0（精确固定）
    model: deepseek-flash（用户凭证，经 devagent/config/model.json 提供；文件 gitignored，密钥未进入任何记录）
    command: cd devagent && npm run check:model
  runs:
    - command: node checks/real-model.ts
      result: passed
      exit_code: 0
      evidence: "4/4 通过，用时 2.67s"
  key_evidence:
    - "真实模型可达且正常收口：stopReason=stop、elapsedMs=1689、无 providerError、回复『你选择的是 **B**。』"
    - "模型真的使用了移植版 question 工具：requests=1、method=select、options=[A,B]"
    - "宿主答复回到模型：最终回复明确包含所选项 B"
    - "适配器结论在真实模型下成立：工具结果 toolText 含 notify=ok、tuiError=getAllThemes(): the browser host has no Pi TUI surface、themeAbsent=true，且宿主 notify 记录 1 条"
  not_covered:
    - area: "浏览器产品验收（P6）与端到端产品流程"
      reason: "尚无浏览器工作台；本检查只覆盖真实模型 + SDK 交互管道"
      disposition: pending
    - area: "PI-01 压缩/分支关联、PI-07 配置变化冷恢复、PI-09 并发容量、PI-03/PI-04/PI-06"
      reason: "不在本次验证范围"
      disposition: pending
    - area: "长期多轮真实模型行为（模型是否恰当地使用 question、是否遵守项目规则）"
      reason: "本次只做一次受控往返；行为面需 I4 场景表逐项验证"
      disposition: pending
  result: passed
```

## 复现

```bash
# 1. 在 devagent/config/model.json 填入可用凭证（该文件已被 .gitignore 忽略）
# 2. 运行
cd devagent && npm run check:model
```

未填凭证或凭证错误时：脚本以非零码退出，并直接显示上游错误（例如 `401 authentication_error: invalid x-api-key`），不会给出通过结论。