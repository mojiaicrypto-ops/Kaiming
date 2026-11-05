# Settlement Report · devagent-bootstrap-p0-20261004

```yaml
settlement:
  task: devagent-bootstrap-p0-20261004
  stable_facts:
    - "新工程根：仓库根下 devagent/（单包、ESM、TypeScript strict、Node >= 22.19）；依赖精确固定 @earendil-works/pi-coding-agent 1.0.0（package-lock.json 锁定），@types/node + typescript 为开发依赖"
    - "试验入口：devagent/spikes/（harness/pi-env.ts 提供临时 cwd/agentDir/sessionDir + 本地 OpenAI 兼容 stub 端点）；npm run typecheck / npm run spikes"
    - "P0 门禁 PI-01/02/05/07 的可运行部分已取真实运行证据：36/36 断言（PI-01 17、PI-02 5、PI-05 5、PI-07 9），临时目录零残留"
    - "七条实现注意项（prompt() resolve≠成功；getSessionFile() 预留路径；append-only 单链下 marker 采用首个 role=user 后代定位；同名 customType 两种条目按 entry.type 区分；事件顺序与 agent_settled 语义；工具内 ctx.abort + 外层 isIdle；会话隔离不触全局 cwd/env）"
    - "证据边界：真实 SDK 机制路径 + stub 端点；真实模型行为（I4）与产品验收（P6）未取证，需模型凭证"
    - "未覆盖并已记录：PI-01 压缩/分支关联、PI-07 冷恢复重建子项、PI-08、PI-09、I4/P6"
  updated:
    - "AGENTS.md：声明唯一实施依据 docs/productnew + docs/technicalnew，排除 oldcode/、docs/old/、docs/architecturenew/"
    - ".agentdev/work/devagent-bootstrap-p0-20261004/：plan.md、sdk-surface.md、implementation.md、test.md、review.md、settlement.md"
  proposed_for_confirmation:
    - "契约差异（I5 上报，未自行修改）：R4/M3 让同一个 customType `agentdev.input` 同时承担 `custom`（标记，不进上下文）与 `custom_message`（通知，进上下文）两种条目；建议改为两个 customType（如 agentdev.input-marker / agentdev.input-notice），否则扫描标记必须额外按 entry.type 过滤"
    - "契约补充建议：把 inputEntryId 的定位规则写明为『该 input 的 marker 子树内第一个 role=user 的 message』，并注明会话条目是 append-only 单链（后续输入的 marker 会嵌套在先前 marker 子树内）"
    - "待 PI-08 取证后补充：ExtensionBindings.mode 在浏览器宿主的取值（types 注明 dialog-capable 仅 TUI/RPC）"
    - "【2026-10-05 已处理】上两条经用户确认并实施：书签/通知改名为 agentdev.input-marker / agentdev.input-notice；PI-08 实测交互开关是『是否绑定 UI 适配器』（mode 不是开关），契约已更新。本记录中出现的旧名 agentdev.input 均指拆名前名称。见 .agentdev/work/devagent-marker-notice-ui-mode-20261005/"
  indexes_updated:
    - none   # 本次不新增正式文档；docs/INDEX.md 与 docs/technicalnew 契约未变
  archived:
    - .agentdev/work/devagent-bootstrap-p0-20261004/
  no_change:
    - "docs/productnew/**、docs/technicalnew/**（只读核对，未改动）"
    - "docs/architecturenew/、docs/old/、oldcode/、webui/（按 AGENTS.md 排除）"
  completion_gate: passed   # Round 1 failed → 修复 → Round 2 passed → 模板增量 → Round 3 passed；本记录与 devagent/** 同次提交
```