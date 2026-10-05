# Settlement Report · devagent-marker-notice-ui-mode-20261005

```yaml
settlement:
  task: devagent-marker-notice-ui-mode-20261005
  stable_facts:
    - "两种会话记录用两个名字：`agentdev.input-marker`（输入书签，Pi 自定义条目，不进模型上下文）与 `agentdev.input-notice`（恢复/控制通知，custom message，进模型上下文）。按书签名扫描不会再命中通知（PI-01 断言）"
    - "浏览器宿主的交互开关是**是否绑定 UI 适配器**，不是 mode 字符串：实测绑定 + `rpc`、绑定 + `print` 都可交互，未绑定时 ctx.hasUI=false；与固定版本 `hasUI()`（只判断 uiContext 是否绑定）一致。mode 只按真实身份声明"
    - "**宿主 UI 适配器必须是普通对象**：SDK 用 `{ ...ui, select, confirm, input, editor, custom }` 包装 uiContext，类实例的原型方法会在包装后丢失（实测 notify → undefined，工具随即抛 TypeError）"
    - "交互往返实测：确认返回 true/false、选择返回所选值/undefined、输入返回文本/undefined；模型可见结果携带宿主分配的 interactionId；等待交互时会话保持被占用（工具入口与答案 pending 期间均为 idle=false）；交互不额外产生模型调用"
    - "UI 表面实测：包装后 notify 仍可用并记录；TUI-only 方法调用时抛适配器自己的错误；theme 无法真实提供（展开会求值 getter），显式给 undefined 并在 PI-08 F 中实测该事实"
    - "证据边界：真实 SDK 机制路径 + 本地 stub 端点；真实模型行为（I4）与浏览器产品验收（P6）未取证"
  updated:
    - "docs/technicalnew/runtime-contract.md：R4 行（绑定适配器是必需动作、mode 只声明身份、适配器必须是普通对象）与书签/通知两个名称"
    - "docs/technicalnew/messaging-and-collaboration.md：M3 恢复通知名称；M5 绑定段落（必须绑定适配器 + 普通对象要求）"
    - "docs/technicalnew/validation.md：实施证据边界（机制层证据与仍未取证项）"
    - "devagent/spikes/harness/{host-ui.ts,question-tool.ts}、devagent/spikes/{pi-01-input-correlation.ts,pi-08-host-ui.ts}、devagent/spikes/harness/pi-env.ts：拆名常量 + 宿主适配器 + 移植版 question 工具 + 交互试验"
    - ".agentdev/work/devagent-marker-notice-ui-mode-20261005/：plan/implementation/test/review/settlement"
  proposed_for_confirmation:
    - "建议在 docs/technicalnew/implementation-checks.md 的 PI-08 行补两条检查要求：适配器必须实现为普通对象（对象展开会丢原型成员）；交互可用性由「是否绑定适配器」决定，mode 只作身份声明。未自行改动该文件"
  indexes_updated:
    - none   # docs/INDEX.md 无需变更；未新增正式文档
  archived:
    - .agentdev/work/devagent-marker-notice-ui-mode-20261005/
  no_change:
    - "docs/productnew/**（产品行为未变：用户看到的交互方式不变）"
    - "oldcode/、docs/old/、docs/architecturenew/、webui/（按 AGENTS.md 排除）"
  completion_gate: passed   # 独立审阅 Round 1 failed → 修复 → Round 2 passed → 增量复核 passed；本记录随本任务提交
```